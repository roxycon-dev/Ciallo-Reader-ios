import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBundle } from '@platform/index';
import type { SourceWorkerRequest, SourceWorkerResponse } from '@platform/sourceWorker/protocol';
import { SourceWorkerEngine, EnginePreferences } from '@platform/sourceWorker/engine';

const mocked = vi.hoisted(() => ({ workers: [] as { messages: SourceWorkerRequest[]; terminated: boolean; onmessage: ((event: { data: SourceWorkerResponse }) => void) | null; result(value?: string): void; host(): void }[] }));
vi.mock('@platform/sourceWorker/entry.ts?worker&inline', () => ({ default: class {
  messages: SourceWorkerRequest[] = []; terminated = false; onmessage: ((event: { data: SourceWorkerResponse }) => void) | null = null;
  constructor() { mocked.workers.push(this); }
  postMessage(message: SourceWorkerRequest) { this.messages.push(message); if (message.type === 'boot') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } })); }
  terminate() { this.terminated = true; }
  result(value = 'ok') { const operation = this.messages.filter((message) => message.type === 'operation').at(-1)!; this.onmessage?.({ data: { type: 'result', id: operation.id, ok: true, logged: false, value } }); }
  host() { this.onmessage?.({ data: { type: 'host', id: 999, request: { method: 'http', request: { url: 'https://source.test/image', method: 'GET', headers: {} } } } }); }
} }));
const engines: SourceWorkerEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); mocked.workers.splice(0); vi.useRealTimers(); });
function create(get = async (): Promise<string | null> => null) {
  const secure = { get, set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  const http = { request: vi.fn<PlatformBundle['http']['request']>(async () => ({ status: 200, headers: {}, body: new Uint8Array(), url: 'https://source.test/image' })) };
  const platform = { secure, http } as unknown as PlatformBundle, preferences = new EnginePreferences(secure, `key-${engines.length}`);
  const engine = new SourceWorkerEngine(platform, { sourceKey: `source-${engines.length}`, script: '', runtimeJs: '', insecureTls: false, assets: {} }, preferences, async () => ''); engines.push(engine); return { engine, http };
}
async function until(predicate: () => boolean) { for (let index = 0; index < 50; index++) { if (predicate()) return; await Promise.resolve(); } throw new Error('worker lifecycle did not settle'); }
describe('source Worker lifetime and bounded live realms', () => {
  it('propagates caller cancellation during initialization as AbortError', async () => {
    let finish!: (value: string | null) => void; const { engine } = create(() => new Promise((resolve) => { finish = resolve; })), controller = new AbortController();
    const call = engine.call('test', controller.signal), rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' }); await until(() => finish !== undefined); controller.abort(); await rejected; finish(null); await Promise.resolve(); expect(mocked.workers).toHaveLength(0);
  });
  it('starts at most four Workers and evicts an idle realm before starting the fifth', async () => {
    const first = Array.from({ length: 4 }, () => create().engine), work = first.map((engine) => engine.call('test'));
    await until(() => mocked.workers.length === 4 && mocked.workers.every((worker) => worker.messages.some((message) => message.type === 'operation')));
    const fifth = create().engine.call('next'); await Promise.resolve(); expect(mocked.workers).toHaveLength(4);
    mocked.workers[0]!.result(); await work[0]; await until(() => mocked.workers.length === 5 && mocked.workers[4]!.messages.some((message) => message.type === 'operation'));
    expect(mocked.workers[0]!.terminated).toBe(true); expect(mocked.workers.filter((worker) => !worker.terminated)).toHaveLength(4);
    mocked.workers.slice(1).forEach((worker) => worker.result()); await Promise.all([...work, fifth]);
  });
  it('disposal cancels initialization immediately and cannot start a late Worker after preferences arrive', async () => {
    let finish!: (value: string | null) => void; const { engine } = create(() => new Promise((resolve) => { finish = resolve; }));
    const call = engine.call('test'), rejected = expect(call).rejects.toThrow('书源引擎已释放'); await until(() => finish !== undefined); engine.dispose(); await rejected;
    finish(null); await Promise.resolve(); await Promise.resolve(); expect(mocked.workers).toHaveLength(0);
  });
  it('terminating a Worker cancels its active host HTTP request and never posts a stale response', async () => {
    const { engine, http } = create(); let aborted = false;
    http.request.mockImplementationOnce((request) => new Promise((_resolve, reject) => { request.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); }));
    const call = engine.call('test'), rejected = expect(call).rejects.toThrow('书源引擎已释放'); await until(() => mocked.workers[0]?.messages.some((message) => message.type === 'operation') ?? false);
    mocked.workers[0]!.host(); await until(() => http.request.mock.calls.length === 1); engine.dispose(); await rejected; expect(aborted).toBe(true);
    await Promise.resolve(); expect(mocked.workers[0]!.messages.some((message) => message.type === 'hostResult')).toBe(false);
  });
  it('replays trusted initialization code after idle reclamation and never reclaims an active call', async () => {
    vi.useFakeTimers(); const { engine } = create(); engine.setInitializationCode('restore-verified-user-agent');
    const first = engine.call('first'); await until(() => mocked.workers[0]?.messages.some((message) => message.type === 'operation') ?? false); mocked.workers[0]!.result(); await first;
    await vi.advanceTimersByTimeAsync(20_000); const second = engine.call('second'); await until(() => mocked.workers[0]!.messages.filter((message) => message.type === 'operation').length === 2);
    await vi.advanceTimersByTimeAsync(20_000); expect(mocked.workers[0]!.terminated).toBe(false); mocked.workers[0]!.result(); await second;
    await vi.advanceTimersByTimeAsync(30_001); expect(mocked.workers[0]!.terminated).toBe(true);
    const third = engine.call('third'); await until(() => mocked.workers[1]?.messages.some((message) => message.type === 'operation') ?? false);
    expect(mocked.workers[1]!.messages.find((message) => message.type === 'boot')).toMatchObject({ boot: { initializationCode: 'restore-verified-user-agent' } }); mocked.workers[1]!.result(); await third;
  });
});

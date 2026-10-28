import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVeneraWorker } from '../../src/core/source/veneraWorker';
import type {
  VeneraWorkerFactory,
  VeneraWorkerResponse,
} from '../../src/core/source/veneraTypes';

class MockWorker {
  onmessage: ((event: MessageEvent<VeneraWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emitResponse(data: VeneraWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<VeneraWorkerResponse>);
  }

  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe('veneraWorker', () => {
  let workers: MockWorker[];

  beforeEach(() => {
    workers = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function factory(): MockWorker {
    const w = new MockWorker();
    workers.push(w);
    return w;
  }

  const typedFactory = factory as unknown as VeneraWorkerFactory;

  it('assigns incrementing ids and resolves on matching result', async () => {
    const handle = createVeneraWorker({ workerFactory: typedFactory });
    const worker = workers[0] as MockWorker;

    const p1 = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'x' },
    });
    const p2 = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'y' },
    });

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const msg1 = worker.postMessage.mock.calls[0]?.[0] as { id: number };
    const msg2 = worker.postMessage.mock.calls[1]?.[0] as { id: number };
    expect(msg1.id).toBe(1);
    expect(msg2.id).toBe(2);

    worker.emitResponse({
      type: 'result',
      id: 2,
      ok: true,
      operation: 'search',
      data: { comics: [], maxPage: 0 },
    });
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.data).toEqual({ comics: [], maxPage: 0 });
    }

    worker.emitResponse({
      type: 'result',
      id: 1,
      ok: false,
      operation: 'search',
      error: 'boom',
    });
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error).toBe('boom');
    }

    handle.terminate();
  });

  it('rejects after timeout', async () => {
    vi.useFakeTimers();
    const handle = createVeneraWorker({ workerFactory: typedFactory, timeoutMs: 1000 });

    const p = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'x' },
    });
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;

    handle.terminate();
  });

  it('rejects all pending on worker error', async () => {
    const handle = createVeneraWorker({ workerFactory: typedFactory });
    const worker = workers[0] as MockWorker;

    const p1 = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'x' },
    });
    const p2 = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'loadInfo',
      params: { operation: 'loadInfo', bookId: '1' },
    });

    worker.emitError('worker crashed');
    await expect(p1).rejects.toThrow('worker crashed');
    await expect(p2).rejects.toThrow('worker crashed');

    handle.terminate();
  });

  it('rejects pending on terminate', async () => {
    const handle = createVeneraWorker({ workerFactory: typedFactory });
    const p = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'x' },
    });
    handle.terminate();
    await expect(p).rejects.toThrow(/terminated/);
  });

  it('ignores non-result messages', async () => {
    const handle = createVeneraWorker({ workerFactory: typedFactory });
    const worker = workers[0] as MockWorker;

    const p = handle.send({
      type: 'evaluate',
      script: '',
      sourceKey: 'a',
      operation: 'search',
      params: { operation: 'search', keyword: 'x' },
    });

    worker.emitResponse({ type: 'log', level: 'info', title: 't', content: 'c' });
    worker.emitResponse({ type: 'host-request', requestId: 1, method: 'x', params: {} });

    let settled = false;
    p.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    worker.emitResponse({
      type: 'result',
      id: 1,
      ok: true,
      operation: 'search',
      data: { comics: [], maxPage: 0 },
    });
    const r = await p;
    expect(r.ok).toBe(true);

    handle.terminate();
  });

  it('calls workerFactory to create worker', () => {
    const spy = vi.fn(() => factory() as unknown as Worker);
    createVeneraWorker({ workerFactory: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

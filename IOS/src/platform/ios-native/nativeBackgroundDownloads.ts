import { registerPlugin } from '@capacitor/core';
import type { BackgroundBookDownload } from '@core/download/downloadWorker';
import type { HttpRequest, HttpStreamResponse } from '@platform/interfaces';
import { base64ToBytes } from './capacitorHttpClient';
import { nonThenablePlugin } from './pluginProxy';

type Ready = { state: 'ready'; status: number; headers: Record<string, string>; url: string; size: number };
type Status = Ready | { state: 'missing' } | { state: 'failed'; error: string } | { state: 'running'; written: number; total: number };
interface BackgroundNative {
  start(input: { key: string; url: string; headers: Record<string, string> }): Promise<void>;
  status(input: { key: string }): Promise<Status>;
  read(input: { key: string; offset: number; length: number }): Promise<{ data: string }>;
  stop(input: { key: string; keep: boolean }): Promise<void>;
}

const valid = new Set(['accept', 'accept-encoding', 'user-agent']);
const available = (request: HttpRequest, sourceId: string) => {
  if (sourceId === 'zlibrary' || request.method !== 'GET' || !Object.keys(request.headers ?? {}).every((key) => valid.has(key.toLowerCase()))) return false;
  const url = new URL(request.url);
  return url.protocol === 'https:' && !url.username && !url.password;
};
const abortError = () => new DOMException('下载已暂停', 'AbortError');
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
async function keyOf(id: string) {
  const data = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const pause = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(abortError()); return; }
  const abort = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 500);
  signal?.addEventListener('abort', abort, { once: true });
});

export class NativeBackgroundDownloads implements BackgroundBookDownload {
  constructor(private readonly native: BackgroundNative = nonThenablePlugin(registerPlugin<BackgroundNative>('ReaderBackgroundDownloads'))) {}

  async restorable(id: string): Promise<boolean> {
    const status = await this.native.status({ key: await keyOf(id) });
    return status.state === 'ready' || status.state === 'running';
  }
  async discard(id: string): Promise<void> { await this.native.stop({ key: await keyOf(id), keep: false }); }

  async consume<T>(id: string, sourceId: string, request: HttpRequest, progress: (written: number, total: number) => void,
    consumer: (response: HttpStreamResponse) => Promise<T>): Promise<{ value: T } | null> {
    if (!available(request, sourceId)) return null;
    const key = await keyOf(id), signal = request.signal, native = this.native;
    check(signal);
    let ready: Ready | undefined;
    try {
      await native.start({ key, url: request.url, headers: request.headers ?? {} });
      const deadline = Date.now() + (request.timeoutMs ?? 3_600_000);
      do {
        check(signal);
        const status = await native.status({ key });
        if (status.state === 'ready') { ready = status; break; }
        if (status.state !== 'running') break;
        progress(Math.max(0, status.written), Math.max(0, status.total));
        await pause(signal);
      } while (Date.now() < deadline);
    } catch {
      if (signal?.aborted) { await native.stop({ key, keep: true }); throw abortError(); }
      await native.stop({ key, keep: false }).catch(() => {});
      return null;
    }
    if (signal?.aborted) { await native.stop({ key, keep: true }); throw abortError(); }
    if (!ready || ready.status === 401 || ready.status === 403) {
      // A source can require a shared browser cookie even without explicit
      // credentials. Use its original redirect and cookie policy in that case.
      await native.stop({ key, keep: false }).catch(() => {});
      return null;
    }
    const { status, headers, url, size } = ready;
    if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024 * 1024) throw new Error('后台下载文件大小无效');
    async function* chunks() {
      for (let offset = 0; offset < size; offset += 512 * 1024) {
        check(signal);
        const length = Math.min(512 * 1024, size - offset);
        const data = base64ToBytes((await native.read({ key, offset, length })).data);
        if (data.length !== length) throw new Error('后台下载文件不完整');
        yield data;
      }
    }
    try { return { value: await consumer({ status, headers, url, size, chunks: chunks() }) }; }
    finally { if (!signal?.aborted) await native.stop({ key, keep: false }).catch(() => {}); }
  }
}

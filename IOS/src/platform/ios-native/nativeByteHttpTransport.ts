import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import { base64ToBytes, bytesToBase64, type NativeHttpRequestOptions, type NativeHttpResponse, type NativeHttpTransport } from './capacitorHttpClient';
import { nativeHttpScheduler } from './httpRequestScheduler';

const MAX_BYTES = 512 * 1024 * 1024, CHUNK_BYTES = 512 * 1024;
export interface ByteHttpNative {
  begin(options: { id: string; url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number; redirect: 'follow' | 'manual' | 'error' }): Promise<{ status: number; headers: Record<string, string>; url: string; size: number }>;
  read(options: { id: string; offset: number; length: number }): Promise<{ data: string }>;
  cancel(options: { id: string }): Promise<void>;
  release(options: { id: string }): Promise<void>;
}
function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Owns the whole deadline, including bridge reads. Cancellation rejects the
 * caller and cancels the native socket; cleanup always releases its spool. */
export class NativeByteHttpTransport implements NativeHttpTransport {
  readonly managesTimeouts = true;
  constructor(private readonly native: ByteHttpNative = nonThenablePlugin(registerPlugin<ByteHttpNative>('ReaderHttp'))) {}
  async request(options: NativeHttpRequestOptions): Promise<NativeHttpResponse> {
    const timeoutMs = options.readTimeout ?? options.connectTimeout ?? 30_000;
    const maxBytes = options.maxResponseBytes ?? MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('HTTP 响应大小限制无效');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('HTTP 超时设置无效');
    if (options.signal?.aborted) throw new DOMException('HTTP 请求已取消', 'AbortError');
    const id = requestId(), native = this.native, waiting = new AbortController(), host = new URL(options.url).hostname.toLowerCase();
    let stopped = false, abort!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { abort = reject; });
    const stop = (error: Error) => { stopped = true; waiting.abort(); abort(error); void native.cancel({ id }).catch(() => {}); };
    const onAbort = () => stop(new DOMException('HTTP 请求已取消', 'AbortError'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop(new Error(`HTTP 请求超时（${timeoutMs}ms）`)), timeoutMs);
    let permit: (() => void) | undefined;
    const work = async (): Promise<NativeHttpResponse> => {
      permit = await nativeHttpScheduler.acquire(host, waiting.signal);
      if (stopped) throw new DOMException('HTTP 请求已取消', 'AbortError');
      let body: string | undefined;
      if (options.data !== undefined) {
        if (typeof options.data !== 'string') throw new Error('HTTP 请求体必须为文本或原始字节');
        if (options.dataType === 'file') { if (options.data.length > 44739244) throw new Error('HTTP 请求体超过 32MiB'); body = options.data; }
        else { const bytes = new TextEncoder().encode(options.data); if (bytes.length > 32 * 1024 * 1024) throw new Error('HTTP 请求体超过 32MiB'); body = bytesToBase64(bytes); }
      }
      const response = await native.begin({ id, url: options.url, method: options.method, headers: options.headers ?? {}, timeoutMs, maxBytes,
        redirect: options.redirect ?? (options.disableRedirects ? 'manual' : 'follow'), ...(body === undefined ? {} : { body }) });
      if (stopped) throw new DOMException('HTTP 请求已取消', 'AbortError');
      if (!Number.isSafeInteger(response.size) || response.size < 0 || response.size > maxBytes || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || typeof response.url !== 'string' || !response.headers || typeof response.headers !== 'object' || Array.isArray(response.headers) || Object.values(response.headers).some((value) => typeof value !== 'string')) throw new Error('原生 HTTP 响应信息无效');
      const bytes = new Uint8Array(response.size);
      for (let offset = 0; offset < response.size; offset += CHUNK_BYTES) {
        if (stopped || options.signal?.aborted) throw new DOMException('HTTP 请求已取消', 'AbortError');
        const length = Math.min(CHUNK_BYTES, response.size - offset), part = await native.read({ id, offset, length });
        if (typeof part.data !== 'string' || part.data.length > Math.ceil(CHUNK_BYTES / 3) * 4) throw new Error('原生 HTTP 响应分块无效');
        const chunk = base64ToBytes(part.data); if (chunk.length !== length) throw new Error('原生 HTTP 响应分块不完整'); bytes.set(chunk, offset);
      }
      return { data: null, body: bytes, status: response.status, headers: response.headers, url: response.url };
    };
    try { return await Promise.race([work(), cancelled]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); void native.release({ id }).catch(() => {}); permit?.(); }
  }
}

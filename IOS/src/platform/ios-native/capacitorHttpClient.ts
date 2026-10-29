/** iOS remote requests use ReaderHttp / URLSession with exact entity bytes,
 * a bounded native spool and real cancellation. Bundled assets and browser
 * preview use fetch. Legacy transport encoding helpers remain for injected
 * adapters; production native responses carry bytes directly. */
import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';

/** Android `SharedHttpTransport` 的默认 `Accept`。 */
export const DEFAULT_HEADERS: HttpHeader = {
  Accept: 'application/json, text/plain, */*',
};

/** Transport adapter options; AbortSignal remains inside JavaScript. */
export interface NativeHttpRequestOptions {
  signal?: AbortSignal;
  redirect?: 'follow' | 'manual' | 'error';
  disableRedirects?: boolean;
  url: string;
  method: string;
  headers?: Record<string, string>;
  /** 原生侧只接受 string / JSON；二进制走 `dataType: 'file'` + base64。 */
  data?: unknown;
  dataType?: 'file' | 'formData';
  responseType?: 'arraybuffer' | 'blob' | 'json' | 'text' | 'document';
  connectTimeout?: number;
  readTimeout?: number;
}

/** Production uses body bytes; data supports existing injected adapters. */
export interface NativeHttpResponse {
  body?: Uint8Array;
  /** `arraybuffer`/`blob` → base64 字符串；`application/json` → 已解析的 JS 值。 */
  data: unknown;
  status: number;
  /** iOS 侧 `lowerCaseHeaderDictionary` 已把键小写化。 */
  headers?: Record<string, string>;
  url?: string | null;
}

export interface NativeHttpTransport {
  managesTimeouts?: boolean;
  request(options: NativeHttpRequestOptions): Promise<NativeHttpResponse>;
}

/** 原生运行时下 `CapacitorHttp` 缺失时的显式错误（不静默降级到 fetch）。 */
export const NATIVE_HTTP_UNAVAILABLE =
  'ReaderHttp 原生传输层不可用，请检查 URLSession 插件注册与 WKWebView 桥接。';

export interface CapacitorHttpClientOptions {
  /** 注入原生传输层（单测 / 将来换其它原生实现）。 */
  transport?: NativeHttpTransport;
  /** 强制走 `fetch`（只在浏览器 dev / Playwright 用；原生运行时忽略）。 */
  forceFetch?: boolean;
}

/** 原生运行时判定：`Capacitor.isNativePlatform() === true`。 */
async function isNativeRuntime(): Promise<boolean> {
  try {
    const mod = (await import('@capacitor/core')) as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    return mod.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

let cachedTransport: NativeHttpTransport | null = null;

/** Load the registered byte-preserving plugin only on native iOS. */
export async function loadNativeHttpTransport(): Promise<NativeHttpTransport | null> {
  if (cachedTransport !== null) return cachedTransport;
  if (!(await isNativeRuntime())) return null;
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isPluginAvailable('ReaderHttp')) return null;
  const { NativeByteHttpTransport } = await import('./nativeByteHttpTransport');
  cachedTransport = new NativeByteHttpTransport();
  return cachedTransport;
}

/** 仅供单测复位模块级缓存。 */
export function resetNativeHttpTransportCache(): void {
  cachedTransport = null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * `NativeHttpResponse.data` → `HttpResponse.body: Uint8Array`。
 * iOS `buildResponse`：JSON content-type 先命中（已解析对象），其余 arraybuffer
 * 分支给 base64。见文件头"已知差异 2"。
 */
export function decodeNativeBody(data: unknown): Uint8Array {
  if (typeof data === 'string') return base64ToBytes(data);
  if (data === null || data === undefined) return new Uint8Array(0);
  return new TextEncoder().encode(JSON.stringify(data) ?? '');
}

/** `HttpRequest.body` → `CapacitorHttp` 的 `data` / `dataType`。 */
export function encodeNativeBody(body: string | Uint8Array): {
  data: unknown;
  dataType?: 'file';
} {
  // 原生 `getRequestData`：`dataType == "file"` → `Data(base64Encoded: stringData)`。
  if (typeof body === 'string') return { data: body };
  return { data: bytesToBase64(body), dataType: 'file' };
}

export class CapacitorHttpClient implements HttpClient {
  private readonly options: CapacitorHttpClientOptions;

  constructor(options: CapacitorHttpClientOptions = {}) {
    this.options = options;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    // Bundled assets are served by WKWebView's capacitor:// URL handler, not
    // NSURLSession. Native HTTP only handles absolute remote HTTP(S) requests.
    if (req.url.startsWith('/') && !req.url.startsWith('//')) return this.fetchRequest(req);
    const transport = await this.resolveTransport();
    if (transport === null) return this.fetchRequest(req);
    return this.nativeRequest(transport, req);
  }

  /**
   * 原生运行时必须拿到 ReaderHttp；拿不到就抛错。
   * 非原生运行时（或显式 `forceFetch`）返回 null → 走 `fetch`。
   */
  private async resolveTransport(): Promise<NativeHttpTransport | null> {
    if (this.options.transport !== undefined) return this.options.transport;
    if (this.options.forceFetch === true && !await isNativeRuntime()) return null;
    const transport = await loadNativeHttpTransport();
    if (transport !== null) return transport;
    if (await isNativeRuntime()) throw new Error(NATIVE_HTTP_UNAVAILABLE);
    return null;
  }

  private async nativeRequest(
    transport: NativeHttpTransport,
    req: HttpRequest,
  ): Promise<HttpResponse> {
    const options: NativeHttpRequestOptions = {
      url: req.url,
      method: req.method ?? 'GET',
      headers: { ...DEFAULT_HEADERS, ...req.headers },
      responseType: 'arraybuffer',
      ...(req.signal ? { signal: req.signal } : {}),
      ...(req.redirect ? { redirect: req.redirect } : {}),
      ...(req.redirect === 'manual' || req.redirect === 'error' ? { disableRedirects: true } : {}),
    };
    if (req.body !== undefined) Object.assign(options, encodeNativeBody(req.body));
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      options.connectTimeout = req.timeoutMs;
      options.readTimeout = req.timeoutMs;
    }

    const call = transport.request(options);
    const response =
      req.timeoutMs !== undefined && req.timeoutMs > 0 && !transport.managesTimeouts
        ? await withCallTimeout(call, req.timeoutMs)
        : await call;

    const headers: HttpHeader = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    return {
      status: response.status,
      headers,
      body: response.body ?? decodeNativeBody(response.data),
      url: response.url != null && response.url !== '' ? response.url : req.url,
    };
  }

  /** 浏览器分支（非原生运行时）：与 `web-mock/FetchHttpClient` 行为一致。 */
  private async fetchRequest(req: HttpRequest): Promise<HttpResponse> {
    const headers: HttpHeader = { ...DEFAULT_HEADERS, ...req.headers };
    const init: RequestInit = {
      method: req.method ?? 'GET',
      headers,
      ...(req.redirect ? { redirect: req.redirect } : {}),
    };
    if (req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : (req.body as unknown as BodyInit);
    }

    const controller = new AbortController(); init.signal = controller.signal;
    const abort = () => controller.abort(req.signal?.reason);
    if (req.signal?.aborted) abort(); else req.signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      timer = setTimeout(() => {
        controller?.abort();
      }, req.timeoutMs);
    }

    try {
      const res = await fetch(req.url, init);
      const body = new Uint8Array(await res.arrayBuffer());
      const responseHeaders: HttpHeader = {};
      res.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      return {
        status: res.status,
        headers: responseHeaders,
        body,
        url: res.url !== '' ? res.url : req.url,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal?.removeEventListener('abort', abort);
    }
  }
}

/**
 * Compatibility deadline for injected transports. ReaderHttp owns its own
 * deadline and socket cancellation, so this wrapper is bypassed in production.
 */
function withCallTimeout<T>(call: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`HTTP 请求超时（${timeoutMs}ms）`));
    }, timeoutMs);
    call.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function createCapacitorHttpClient(
  options?: CapacitorHttpClientOptions,
): CapacitorHttpClient {
  return new CapacitorHttpClient(options);
}

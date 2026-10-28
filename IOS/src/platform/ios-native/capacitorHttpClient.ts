/**
 * Android 对照：`com.example.source.NetworkCalls` / `SharedHttpTransport.builder()`
 * （OkHttp 4.12 + Cronet `CronetEngine`，无 CORS、无同源限制）。
 *
 * ## 为什么要改（BUG 修复记录）
 *
 * 本文件原先是 `platform/web-mock/fetchHttpClient.ts` 的逐字节副本 —— 也就是所谓
 * "iOS 原生 HTTP 客户端" 其实用的是 WKWebView 里的 `window.fetch`。这是**静默降级**：
 *
 *   * Capacitor 应用的 WebView origin 是 `capacitor://localhost`，任何跨源 `fetch`
 *     都要过 CORS。书源站点是任意第三方站点，绝大多数不会回
 *     `Access-Control-Allow-Origin` → `platform.http` 的**每一条**请求（下载、
 *     书源搜索/详情/正文、漫画图片、更新检查、AniList 种子）在真机上都会被浏览器
 *     直接拦掉，而代码里看不到任何错误来源。
 *   * `fetch` 也不允许设置 `Referer` 之外的一些受限头，也无法拿到全部 `Set-Cookie`。
 *
 * 现在改成走 Capacitor **自带**的 `CapacitorHttp`（iOS 侧底层是 `URLSession`，
 * 见 `node_modules/@capacitor/ios/.../Plugins/HttpRequestHandler.swift`）：
 * 不受 CORS 约束、不受浏览器受限头限制、能拿到原始响应字节。它随
 * `@capacitor/core` 一起打包，**不需要**额外安装插件，也**不需要**在
 * `capacitor.config.json` 里开 `CapacitorHttp.enabled`（那个开关只是用来
 * 打补丁 `window.fetch`/`XMLHttpRequest`，我们直接调 `CapacitorHttp.request`）。
 *
 * ## 已知差异（需要登记到 `docs/PARITY_EXCEPTIONS.md`）
 *
 *   1. **callTimeout 无法取消原生请求。** Android 的 OkHttp `callTimeout`
 *      会真的取消 socket；`CapacitorHttp` 只有 `connectTimeout` / `readTimeout`
 *      （且 iOS 侧 `HttpRequestHandler` L204 把两者取其一当 URLSession timeout）。
 *      这里用 `Promise.race` 让**调用方**准时拿到超时错误，但底层原生请求不会被
 *      取消（它自己会按 `readTimeout` 收尾）。
 *   2. **`application/json` 响应拿不到原始字节。** iOS `buildResponse`
 *      (L162) 先判 `contentType.contains("application/json")` 再判 responseType，
 *      所以 JSON 响应被 `tryParseJson` 解析成 JS 值。为了满足
 *      `HttpResponse.body: Uint8Array` 的契约，这里用
 *      `JSON.stringify` 重新序列化再 UTF-8 编码。语义等价，但**字节不是逐字节
 *      相同**（空白被压缩、重复键被折叠）。非 JSON 响应走 base64 分支，是精确的。
 *   3. **ATS 仍然拦明文 HTTP。** `CapacitorHttp` 只解决 CORS；`http://` 明文请求
 *      被 iOS 的 App Transport Security 挡，需要 `Info.plist` 的
 *      `NSAppTransportSecurity`（Android 侧是 `usesCleartextTraffic="true"`）。
 *      见审查报告 —— 目前 `ios/App/App/Info.plist` **没有**这一节。
 *
 * ## 铁律
 *
 * 原生运行时下如果拿不到 `CapacitorHttp`，**显式抛错**，绝不回落到会被 CORS
 * 拦掉的 `fetch`（那才是"看起来能跑其实没跑"的静默降级）。
 * `fetch` 分支只在**非原生**运行时（浏览器 dev / Playwright）使用。
 */
import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';

/** Android `SharedHttpTransport` 的默认 `Accept`。 */
export const DEFAULT_HEADERS: HttpHeader = {
  Accept: 'application/json, text/plain, */*',
};

/** `CapacitorHttp.request(options)` 的最小面（`@capacitor/core` 自带，无需安装插件）。 */
export interface NativeHttpRequestOptions {
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

/** `CapacitorHttp` 的返回体（iOS 侧 `buildResponse` 的 `[String: Any]`）。 */
export interface NativeHttpResponse {
  /** `arraybuffer`/`blob` → base64 字符串；`application/json` → 已解析的 JS 值。 */
  data: unknown;
  status: number;
  /** iOS 侧 `lowerCaseHeaderDictionary` 已把键小写化。 */
  headers?: Record<string, string>;
  url?: string | null;
}

export interface NativeHttpTransport {
  request(options: NativeHttpRequestOptions): Promise<NativeHttpResponse>;
}

/** 原生运行时下 `CapacitorHttp` 缺失时的显式错误（不静默降级到 fetch）。 */
export const NATIVE_HTTP_UNAVAILABLE =
  'CapacitorHttp 原生传输层不可用：Capacitor 原生运行时必须走 URLSession（否则会被 CORS 拦截），' +
  '请检查 @capacitor/core 版本与 WKWebView 桥接。';

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

/** 懒加载 `CapacitorHttp`；非原生运行时返回 null。 */
export async function loadNativeHttpTransport(): Promise<NativeHttpTransport | null> {
  if (cachedTransport !== null) return cachedTransport;
  if (!(await isNativeRuntime())) return null;
  const mod = (await import('@capacitor/core')) as unknown as {
    CapacitorHttp?: NativeHttpTransport;
  };
  if (mod.CapacitorHttp === undefined) return null;
  cachedTransport = mod.CapacitorHttp;
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
   * 原生运行时**必须**拿到 `CapacitorHttp`；拿不到就抛错。
   * 非原生运行时（或显式 `forceFetch`）返回 null → 走 `fetch`。
   */
  private async resolveTransport(): Promise<NativeHttpTransport | null> {
    if (this.options.transport !== undefined) return this.options.transport;
    if (this.options.forceFetch === true) return null;
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
      ...(req.redirect === 'manual' || req.redirect === 'error' ? { disableRedirects: true } : {}),
    };
    if (req.body !== undefined) Object.assign(options, encodeNativeBody(req.body));
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      options.connectTimeout = req.timeoutMs;
      options.readTimeout = req.timeoutMs;
    }

    const call = transport.request(options);
    const response =
      req.timeoutMs !== undefined && req.timeoutMs > 0
        ? await withCallTimeout(call, req.timeoutMs)
        : await call;

    const headers: HttpHeader = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    return {
      status: response.status,
      headers,
      body: decodeNativeBody(response.data),
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

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      controller = new AbortController();
      init.signal = controller.signal;
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
    }
  }
}

/**
 * `Promise.race` 超时（见文件头"已知差异 1"）：让调用方准时失败，
 * 底层原生请求不取消（它会按 `readTimeout` 自己收尾）。
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

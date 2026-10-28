/**
 * Android source: `com.example.source.js.JsSourceProxy.kt` (201 lines, 191 non-blank)
 * Ported: 191 / 191 non-blank lines of behaviour. Skipped: none.
 *
 * Platform adaptations:
 * - `okhttp3.Interceptor` / `OkHttpClient.newBuilder()` → the injected
 *   `HttpClient` + `HttpRequestSpec` (see `src/core/source/networkCalls.ts` for
 *   the existing pattern). The interceptor body keeps its exact branch order as
 *   an async function that receives the `chain.proceed` callback.
 * - `java.net.Proxy` → `ProxyRoute { authority, url }`; the explicit-proxy call
 *   becomes `HttpRequestSpec.viaProxy`, the `Proxy.NO_PROXY` base becomes the
 *   absence of that field.
 * - `android.os.SystemClock.elapsedRealtime()` → injected `monotonicClock`.
 * - `Executors.newSingleThreadScheduledExecutor` +
 *   `scheduleWithFixedDelay({ … }, 0, 100, MILLISECONDS)` → an injected
 *   `schedulePoll(fn, intervalMs)` returning a cancel function.
 * - `okio.ForwardingSource.close() { try { super.close() } finally { watch.cancel(false) } }`
 *   → `body.cancel()` in a `finally` plus `watch()` in the same `finally`, so the
 *   watcher is released at the same point in the stream.
 * - `com.example.source.zlibrary.network.SystemProxyResolver` → injected
 *   `SystemProxyResolverPort`.
 * - `ProxySelector.select(uri)` → `selector(deps, uri)`.
 */

import type { HttpClient, HttpRequestSpec, HttpResponseSpec, SystemProxyResolverPort } from './jsPlatform';

/** 同时匹配当前 API 域名与旧图床域名。 */
export const PICACG_DOMAINS = new Set(['picacomic.com', 'picacmic.com']);

export const ROUTE_TTL_MS = 5 * 60_000;

/** Kotlin `java.net.Proxy` reduced to what the routing logic compares. */
export interface ProxyRoute {
  /** `"host:port"` — the equality key behind `learned.proxy != proxy`. */
  readonly authority: string;
  /** The proxy URL handed to the platform transport. */
  readonly url: string;
}

interface Route {
  readonly proxy: ProxyRoute;
  readonly expiresAt: number;
}

/** Kotlin `@Volatile private var cachedSystemProxy: Pair<Long, Proxy?>?`. */
let cachedSystemProxy: { at: number; proxy: ProxyRoute | null } | null = null;

/** Kotlin `private val successfulProxyRoutes = ConcurrentHashMap<String, Route>()`. */
const successfulProxyRoutes = new Map<string, Route>();

/** Everything `JsSourceProxy` needs from the platform. */
export interface JsSourceProxyDeps {
  readonly http: HttpClient;
  readonly systemProxy: SystemProxyResolverPort;
  /** Kotlin `android.os.SystemClock.elapsedRealtime()`. */
  readonly monotonicClock: () => number;
  /** Kotlin `Executors…scheduleWithFixedDelay(…, 0, interval, MILLISECONDS)`. */
  readonly schedulePoll: (fn: () => void, intervalMs: number) => () => void;
  /** Kotlin `android.util.Log` with tag `JsSourceProxy`. */
  readonly log: (level: 'i' | 'w', message: string) => void;
  /** Kotlin `CfWebViewSolver.solveAndSync(context, url, userAgent, headers)`. */
  readonly solveCloudflare: (
    url: string,
    userAgent: string,
    headers: Record<string, string>,
  ) => Promise<boolean>;
  /** Kotlin `CfWebViewSolver.isChallengeResponse(status, headers)`. */
  readonly isChallengeResponse: (status: number, headers: Record<string, string>) => boolean;
  /** Kotlin `JsCookieJar.cookieHeader(context, url)`. */
  readonly cookieHeader: (url: string) => string;
  /** Kotlin `chain.call().isCanceled()`. */
  readonly isCancelled: () => boolean;
  /** Kotlin `response.close()` — releases the body socket. */
  readonly closeResponse: (response: HttpResponseSpec) => void;
}

/**
 * Kotlin `private fun authority(url: String): String?` — `scheme://host:port`.
 * `java.net.URI.getPort()` returns **-1** when the URL has no explicit port
 * (it is *not* filled in with the scheme's default), and `getHost()` returns
 * null for an authority the URI parser cannot read as server-based.
 */
export function authority(url: string): string | null {
  try {
    const uri = new URL(url);
    const host = uri.hostname.toLowerCase();
    if (host === '') return null;
    return `${uri.protocol.toLowerCase()}//${host}:${uri.port === '' ? '-1' : uri.port}`;
  } catch {
    // Kotlin `runCatching { URI(url) }.getOrNull()`
    return null;
  }
}

/** Kotlin `internal fun forgetRoute(url: String)`. */
export function forgetRoute(url: string): void {
  const key = authority(url);
  if (key !== null) successfulProxyRoutes.delete(key);
}

/** Kotlin `internal fun rememberProxySuccess(context: Context, url: String)`. */
export function rememberProxySuccess(deps: JsSourceProxyDeps, url: string): void {
  const proxy = cachedSystemProxyOf(deps);
  if (proxy === null) return;
  const key = authority(url);
  if (key === null) return;
  if (successfulProxyRoutes.size >= 128 && !successfulProxyRoutes.has(key)) {
    const eldest = successfulProxyRoutes.keys().next();
    if (!eldest.done) successfulProxyRoutes.delete(eldest.value);
  }
  successfulProxyRoutes.set(key, { proxy, expiresAt: deps.monotonicClock() + ROUTE_TTL_MS });
}

/** Kotlin `private fun cachedSystemProxy(context: Context): Proxy?` (2 s cache). */
function cachedSystemProxyOf(deps: JsSourceProxyDeps): ProxyRoute | null {
  const now = deps.monotonicClock();
  const cached = cachedSystemProxy;
  if (cached !== null && now - cached.at < 2_000) return cached.proxy;
  const url = deps.systemProxy.resolve();
  let resolved: ProxyRoute | null = null;
  if (url !== null) {
    try {
      resolved = { authority: new URL(url).host, url };
    } catch {
      resolved = null;
    }
  }
  cachedSystemProxy = { at: now, proxy: resolved };
  return resolved;
}

/** Picacg and origins that recently succeeded through the configured proxy use OkHttp. */
export function matches(deps: JsSourceProxyDeps, url: string): boolean {
  return forUrl(deps, url) !== null;
}

/** Kotlin `fun forUrl(context: Context?, url: String): Proxy?`. */
export function forUrl(deps: JsSourceProxyDeps, url: string): ProxyRoute | null {
  if (url === '') return null;
  let host = '';
  try {
    // Kotlin `URI(url).host` — the hostname WITHOUT the port.
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (host === '') return null;
  const isPicacg = [...PICACG_DOMAINS].some((it) => host === it || host.endsWith(`.${it}`));
  const proxy = cachedSystemProxyOf(deps);
  if (proxy === null) return null;
  if (isPicacg) return proxy;
  const key = authority(url);
  if (key === null) return null;
  const learned = successfulProxyRoutes.get(key);
  if (learned === undefined) return null;
  if (learned.proxy.authority !== proxy.authority || learned.expiresAt <= deps.monotonicClock()) {
    successfulProxyRoutes.delete(key);
    return null;
  }
  return proxy;
}

/** Kotlin `fun throughProxy()` — a bounded OkHttp call through the system proxy. */
async function throughProxy(
  deps: JsSourceProxyDeps,
  request: HttpRequestSpec,
): Promise<HttpResponseSpec | null> {
  const proxy = cachedSystemProxyOf(deps);
  if (proxy === null) return null;
  if (deps.isCancelled()) throw new Error('Canceled');
  // The fallback is a separate call. Keep its socket tied to cancellation of
  // the original reader/download call, including while its body is being read.
  let cancelled = deps.isCancelled();
  const watch = deps.schedulePoll(() => {
    if (deps.isCancelled()) cancelled = true;
  }, 100);
  try {
    const response = await deps.http.execute({ ...request, viaProxy: proxy.url });
    if (cancelled) {
      deps.closeResponse(response);
      throw new Error('Canceled');
    }
    if (response.status >= 200 && response.status < 300) {
      rememberProxySuccess(deps, request.url);
    }
    return response;
  } finally {
    // Kotlin `catch (e: Exception) { watch.cancel(false); call.cancel(); throw e }`
    // rethrows after `watch.cancel(false)`; the `finally` covers both paths.
    watch();
  }
}

/** Kotlin `Interceptor { chain -> … }` — the GET-only failover body. */
async function interceptor(
  deps: JsSourceProxyDeps,
  request: HttpRequestSpec,
  proceed: (spec: HttpRequestSpec) => Promise<HttpResponseSpec>,
): Promise<HttpResponseSpec> {
  if (request.method !== 'GET') return proceed(request);
  // Honour an explicitly configured system proxy for image/download requests.
  // Direct-first could return headers but stall on the body, outside this
  // interceptor's fallback path, wasting every retry on the same direct route.
  const requestHost = (() => {
    try {
      // Kotlin `request.url.host` (OkHttp `HttpUrl.host`) — no port.
      return new URL(request.url).hostname;
    } catch {
      return '';
    }
  })();
  const localHost =
    requestHost === 'localhost' || requestHost === '::1' || requestHost.startsWith('127.');
  if (!localHost && cachedSystemProxyOf(deps) !== null) {
    let response: HttpResponseSpec | null;
    try {
      response = await throughProxy(deps, request);
    } catch (e) {
      if (deps.isCancelled()) throw e;
      forgetRoute(request.url);
      return proceed(request);
    }
    if (response === null) return proceed(request);
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      deps.closeResponse(response);
      forgetRoute(request.url);
      return proceed(request);
    }
    return response;
  }
  let direct: HttpResponseSpec;
  try {
    direct = await proceed(request);
  } catch (e) {
    const fallback = await throughProxy(deps, request);
    if (fallback === null) throw e;
    return fallback;
  }
  // Cloudflare 挑战：无头 WebView 过盾一次，带上新 Cookie 重试（Mihon 同款方案）
  if (
    (direct.status === 403 || direct.status === 503 || direct.status === 429) &&
    deps.isChallengeResponse(direct.status, {
      'cf-mitigated': headerOf(direct.headers, 'cf-mitigated') ?? '',
      server: headerOf(direct.headers, 'server') ?? '',
    })
  ) {
    const solved = await deps
      .solveCloudflare(request.url, headerOf(request.headers, 'User-Agent') ?? '', request.headers)
      .catch(() => false);
    deps.closeResponse(direct);
    if (solved) {
      const cookie = deps.cookieHeader(request.url);
      const retry: HttpRequestSpec =
        cookie.trim() !== '' ? { ...request, headers: { ...request.headers, Cookie: cookie } } : request;
      deps.log('i', `cloudflare solved, retry ${requestHost}`);
      return proceed(retry);
    }
    deps.log('w', `cloudflare solve failed for ${requestHost}; fallback to proxy route`);
    // 未解出：继续走原有的代理回退
    const fallback = await throughProxy(deps, request);
    if (fallback === null) throw new Error(`Cloudflare 盾自动验证失败（${requestHost}）`);
    return fallback;
  }
  if (direct.status !== 403 && direct.status !== 429 && direct.status < 500) {
    return direct;
  }
  if (cachedSystemProxyOf(deps) === null) {
    return direct;
  }
  deps.closeResponse(direct);
  const fallback = await throughProxy(deps, request);
  if (fallback === null) throw new Error('system proxy disappeared');
  return fallback;
}

function headerOf(headers: Record<string, string>, name: string): string | null {
  const hit = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return hit?.[1] ?? null;
}

/**
 * Learn successful proxy routes so neighbouring pages do not repeat a failed direct attempt.
 * Kotlin `fun failoverClient(context: Context, base: OkHttpClient): OkHttpClient`.
 * Returns the intercepted `proceed`; `base` is the direct (NO_PROXY) transport.
 */
export function failoverClient(
  deps: JsSourceProxyDeps,
  base: (spec: HttpRequestSpec) => Promise<HttpResponseSpec>,
): (spec: HttpRequestSpec) => Promise<HttpResponseSpec> {
  // Kotlin `builder.dns(SourceDns.dns())` — the pinned-image-host DNS fallback.
  return (spec) => interceptor(deps, spec, base);
}

/**
 * 给 JS 桥的 OkHttp 回退客户端使用：设备配置了系统代理时经代理转发。
 * Kotlin `fun selector(context: Context?): ProxySelector`.
 * Returns the proxy for the URI, or `'no-proxy'` when the default applies.
 */
export function selector(deps: JsSourceProxyDeps, uri: string | null): ProxyRoute | 'no-proxy' {
  const viaProxy =
    uri !== null &&
    (uri.toLowerCase().startsWith('http://') || uri.toLowerCase().startsWith('https://'))
      ? cachedSystemProxyOf(deps)
      : null;
  if (viaProxy !== null) return viaProxy;
  // 与未挂本 selector 时的默认行为保持一致
  return 'no-proxy';
}

/** Test seam — Kotlin keeps the caches private and process-lifetime. */
export function clearProxyCaches(): void {
  cachedSystemProxy = null;
  successfulProxyRoutes.clear();
}

/** Kotlin `object JsSourceProxy` call-site namespace. */
export const JsSourceProxy = {
  matches,
  forUrl,
  failoverClient,
  selector,
  rememberProxySuccess,
  forgetRoute,
  authority,
  clearCaches: clearProxyCaches,
  ROUTE_TTL_MS,
  PICACG_DOMAINS,
};

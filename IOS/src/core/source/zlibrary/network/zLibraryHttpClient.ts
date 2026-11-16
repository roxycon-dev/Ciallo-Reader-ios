/**
 * Kotlin → TS: `source/zlibrary/network/ZLibraryHttpClient.kt` (171 lines, 149 non-blank)
 *             → `src/core/source/zlibrary/network/zLibraryHttpClient.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.network            → SKIPPED (TS has no packages)
 *   L3        import android.content.Context      → REPLACED by the injected transport/proxy seams
 *   L4-6      import DiamWallInterceptor / EncryptedCookieJar / ZLibraryCredentialStorage
 *                                                     → `import type { EncryptedCookieJar }` +
 *                                                       `import type { ZLibraryCredentialStorage }`
 *   L7-8      import kotlinx.coroutines.Dispatchers / withContext → dropped (see "Coroutines")
 *   L9        import okhttp3.*                     → REPLACED by `ZLibraryHttpTransport` + `ZLibraryHttpResponse`
 *   L10       import java.util.concurrent.TimeUnit → replaced by millisecond literals
 *   L12-16    class ZLibraryHttpClient(credentialStorage, cookieJar = …, context = null) → same 3 params
 *   L18-22    companion object: DEFAULT_USER_AGENT / DEFAULT_ACCEPT / DEFAULT_ACCEPT_LANG → module consts
 *   L24-76    val okHttpClient by lazy { … }      → `ZLibraryHttpClientConfig` (pure, transport-agnostic) +
 *                                                   `applyDefaultHeaders()` (the header interceptor body)
 *   L78-129   suspend fun get(...)                → `get(...)` verbatim (logging + callTimeout)
 *   L131-170  suspend fun postForm(...)           → `postForm(...)` verbatim
 *   L171      closing brace                       → n/a
 *
 * ADAPTATION — OkHttp `OkHttpClient`/`Interceptor` (documented):
 *   OkHttp's builder/interceptor/Call surface has no web equivalent, so the client is split:
 *   - `ZLibraryHttpClientConfig` keeps every timeout / redirect flag / default header VERBATIM
 *     in `src/core`, so the platform layer builds its fetch transport from these values
 *     (same approach as `SharedHttpTransport` in `src/core/source/networkCalls.ts`).
 *   - `applyDefaultHeaders()` is the ported body of the L36-72 header interceptor — the
 *     "set only when the request does not already carry the header" rule is preserved exactly.
 *   - `ZLibraryHttpTransport` is the injected extension point (`send(spec)`). The transport is
 *     responsible for applying the cookie jar, the DiamWall interceptor, the manual redirect
 *     policy and the system proxy — exactly the OkHttp builder wiring at L26-35 and L74.
 *   - `response.request.url` (the FINAL url after manual redirects) and
 *     `response.headers("Set-Cookie")` (all values) are read by the transport and surfaced as
 *     `ZLibraryHttpResponse.url` / `.setCookies`, so the guard logic in `ZLibrarySource`
 *     (`response.request.url.host`, `encodedPath`) keeps working unchanged.
 *   - `context?.let { SystemProxyResolver.resolve(it)?.let(builder::proxy) }` → the proxy is
 *     supplied by the platform layer when it builds the transport (see
 *     `network/systemProxyResolver.ts` for the injected provider).
 *
 * ADAPTATION — Coroutines:
 *   `withContext(Dispatchers.IO)` is dropped (JS has no dispatcher); every method is already a
 *   Promise. `callTimeoutMs` is carried on the request spec as the OkHttp `callTimeout`
 *   (a whole-call deadline that, unlike an outer `withTimeoutOrNull`, also bounds a blocked
 *   socket read) — the reason for that choice is preserved in the comment at L99-101.
 *
 * ADAPTATION — `TimeUnit.SECONDS`/`MILLISECONDS` → millisecond numbers (8s/12s/12s/4.5s/…).
 */

import { type EncryptedCookieJar } from '../encryptedCookieJar';
import type { ZLibraryCredentialStorage } from '../zLibraryCredentialStorage';
import { ZLibraryNetworkLogger } from './zLibraryNetworkLogger';

/** Kotlin `const val DEFAULT_USER_AGENT` (L19). */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
/** Kotlin `const val DEFAULT_ACCEPT` (L20). */
export const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
/** Kotlin `const val DEFAULT_ACCEPT_LANG` (L21). */
export const DEFAULT_ACCEPT_LANG = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

/**
 * Kotlin `val okHttpClient by lazy { … }` (L24-76), reduced to the configuration the
 * platform transport needs. The values are copied verbatim from the OkHttp builder chain.
 */
export const ZLibraryHttpClientConfig = {
  /** Kotlin `.connectTimeout(8, TimeUnit.SECONDS)` */
  connectTimeoutMs: 8_000,
  /** Kotlin `.readTimeout(12, TimeUnit.SECONDS)` */
  readTimeoutMs: 12_000,
  /** Kotlin `.writeTimeout(12, TimeUnit.SECONDS)` */
  writeTimeoutMs: 12_000,
  // Redirects are handled manually by DiamWallInterceptor (with loop protection);
  // OkHttp's built-in auto-follow loops forever on DiamWall's 307 challenge dance.
  /** Kotlin `.followRedirects(false)` */
  followRedirects: false,
  /** Kotlin `.followSslRedirects(false)` */
  followSslRedirects: false,
  /** Kotlin `.dns(ZLibraryDns.INSTANCE)` — the transport must use `network/zLibraryDns.ts`. */
  useZLibraryDns: true,
  /** Kotlin `.cookieJar(cookieJar)` */
  useEncryptedCookieJar: true,
  /** Kotlin `.addInterceptor(DiamWallInterceptor(cookieJar))` */
  useDiamWallInterceptor: true,
  /** Kotlin `Sec-Ch-Ua` (L50) */
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  /** Kotlin `Sec-Ch-Ua-Mobile` (L53) */
  'Sec-Ch-Ua-Mobile': '?1',
  /** Kotlin `Sec-Ch-Ua-Platform` (L56) */
  'Sec-Ch-Ua-Platform': '"Android"',
  /** Kotlin `Sec-Fetch-Dest` (L59) */
  'Sec-Fetch-Dest': 'document',
  /** Kotlin `Sec-Fetch-Mode` (L62) */
  'Sec-Fetch-Mode': 'navigate',
  /** Kotlin `Sec-Fetch-Site` (L65) */
  'Sec-Fetch-Site': 'same-origin',
  /** Kotlin `Upgrade-Insecure-Requests` (L68) */
  'Upgrade-Insecure-Requests': '1',
} as const;

/**
 * Port of the header interceptor at Kotlin L36-72: every header is written ONLY when the
 * request does not already carry it (`if (originalRequest.header(x) == null)`).
 * Header names are matched case-insensitively, like OkHttp's `Headers`.
 */
export function applyDefaultHeaders(
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const existing = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(headers)) out[k] = v;
  const put = (name: string, value: string): void => {
    if (existing.has(name.toLowerCase())) return;
    existing.add(name.toLowerCase());
    out[name] = value;
  };
  put('User-Agent', DEFAULT_USER_AGENT);
  put('Accept', DEFAULT_ACCEPT);
  put('Accept-Language', DEFAULT_ACCEPT_LANG);
  put('Sec-Ch-Ua', ZLibraryHttpClientConfig['Sec-Ch-Ua']);
  put('Sec-Ch-Ua-Mobile', ZLibraryHttpClientConfig['Sec-Ch-Ua-Mobile']);
  put('Sec-Ch-Ua-Platform', ZLibraryHttpClientConfig['Sec-Ch-Ua-Platform']);
  put('Sec-Fetch-Dest', ZLibraryHttpClientConfig['Sec-Fetch-Dest']);
  put('Sec-Fetch-Mode', ZLibraryHttpClientConfig['Sec-Fetch-Mode']);
  put('Sec-Fetch-Site', ZLibraryHttpClientConfig['Sec-Fetch-Site']);
  put('Upgrade-Insecure-Requests', ZLibraryHttpClientConfig['Upgrade-Insecure-Requests']);
  return out;
}

/** One `okhttp3.FormBody` field. */
export interface ZLibraryFormField {
  readonly name: string;
  readonly value: string;
}

/** Kotlin `FormBody.Builder().add(k, v)…build()` from a map. */
export function formBodyOf(fields: Readonly<Record<string, string>>): ZLibraryFormField[] {
  return Object.entries(fields).map(([name, value]) => ({ name, value }));
}

/** Kotlin `FormBody.Builder().add(k, v)…build()` from explicit pairs (order preserved). */
export function formBodyOfPairs(pairs: ReadonlyArray<readonly [string, string]>): ZLibraryFormField[] {
  return pairs.map(([name, value]) => ({ name, value }));
}

export interface ZLibraryHttpRequestSpec {
  readonly method: 'GET' | 'POST' | 'HEAD';
  readonly url: string;
  readonly referer: string | null;
  readonly extraHeaders: Record<string, string>;
  /** `null` for GET/HEAD; `FormBody` fields for POST. */
  readonly formFields: ZLibraryFormField[] | null;
  /**
   * Kotlin `callTimeoutMs` (L82) — whole-call deadline including blocked socket reads.
   * `null` means "use the transport default".
   */
  readonly callTimeoutMs: number | null;
}

/** Structural stand-in for the parts of `okhttp3.Response` the ported code reads. */
export interface ZLibraryHttpResponse {
  /** Kotlin `response.code`. */
  readonly code: number;
  /** Kotlin `response.request.url` — the FINAL url after the manual redirect chain. */
  readonly url: string;
  /** Header map, last value wins (Kotlin builds exactly this with `mutableMapOf` + index loops). */
  readonly headers: Record<string, string>;
  /** Kotlin `response.headers("Set-Cookie")` — every value, in header order. */
  readonly setCookies: string[];
  /** Kotlin `response.body?.string()` — the transport has already read the body. */
  readonly body: string;
  /** Kotlin `response.isSuccessful` (200..299). */
  readonly isSuccessful: boolean;
  /** Kotlin `response.close()`. */
  close(): void;
}

/** Injected replacement for the OkHttp `Call` / interceptor chain. */
export interface ZLibraryHttpTransport {
  send(spec: ZLibraryHttpRequestSpec, signal?: AbortSignal | null): Promise<ZLibraryHttpResponse>;
}

export class ZLibraryHttpClient {
  constructor(
    readonly credentialStorage: ZLibraryCredentialStorage,
    readonly cookieJar: EncryptedCookieJar,
    /** Kotlin `private val context: Context?` — replaced by the injected transport. */
    private readonly transport: ZLibraryHttpTransport,
  ) {}

  /**
   * Kotlin `suspend fun get(url, referer, extraHeaders, callTimeoutMs)` (L78-129).
   */
  async get(
    url: string,
    referer: string | null = null,
    extraHeaders: Record<string, string> = {},
    callTimeoutMs: number | null = null,
    signal?: AbortSignal | null,
  ): Promise<ZLibraryHttpResponse> {
    const requestBuilder: Record<string, string> = { ...extraHeaders };
    if (referer !== null) requestBuilder['Referer'] = referer;

    // Log request
    const headerMap = requestBuilder;
    const currentCookies = (await this.cookieJar.loadForRequest(new URL(url)))
      .map((it) => `${it.name}=${it.value}`)
      .join('; ');
    ZLibraryNetworkLogger.logRequest(url, 'GET', headerMap, currentCookies);

    // callTimeoutMs（会话预热等调用方限时）：必须用 OkHttp callTimeout——
    // 外层 withTimeoutOrNull 取消不了阻塞中的 socket read，超时形同虚设
    const response = await this.transport.send(
      { method: 'GET', url, referer, extraHeaders, formFields: null, callTimeoutMs },
      signal ?? null,
    );

    // Log response
    const respHeaderMap = response.headers;
    const setCookieList = response.setCookies;
    const bodySnippet = '';

    ZLibraryNetworkLogger.logResponse(
      response.code,
      response.url,
      respHeaderMap,
      setCookieList,
      response.headers['Content-Type'] ?? null,
      bodySnippet,
    );

    return response;
  }

  /**
   * Kotlin `suspend fun postForm(url, formBody, referer, extraHeaders)` (L131-170).
   */
  async postForm(
    url: string,
    formBody: ZLibraryFormField[],
    referer: string | null = null,
    extraHeaders: Record<string, string> = {},
    signal?: AbortSignal | null,
  ): Promise<ZLibraryHttpResponse> {
    const requestBuilder: Record<string, string> = { ...extraHeaders };
    if (referer !== null) requestBuilder['Referer'] = referer;

    const headerMap = requestBuilder;
    const currentCookies = (await this.cookieJar.loadForRequest(new URL(url)))
      .map((it) => `${it.name}=${it.value}`)
      .join('; ');
    ZLibraryNetworkLogger.logRequest(url, 'POST', headerMap, currentCookies);

    const response = await this.transport.send(
      { method: 'POST', url, referer, extraHeaders, formFields: formBody, callTimeoutMs: null },
      signal ?? null,
    );

    const respHeaderMap = response.headers;
    const setCookieList = response.setCookies;
    const bodySnippet = '';

    ZLibraryNetworkLogger.logResponse(
      response.code,
      response.url,
      respHeaderMap,
      setCookieList,
      response.headers['Content-Type'] ?? null,
      bodySnippet,
    );

    return response;
  }
}

/** Kotlin `response.isSuccessful` (200..299) — exported so a transport can reuse it. */
export function isSuccessfulCode(code: number): boolean {
  return code >= 200 && code <= 299;
}

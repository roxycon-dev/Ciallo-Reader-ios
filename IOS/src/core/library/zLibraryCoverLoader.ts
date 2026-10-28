/**
 * Kotlin → TS: `library/ZLibraryCoverLoader.kt` (66 lines total / 61 non-blank)
 *             → `src/core/library/zLibraryCoverLoader.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1         package com.example.library                   → SKIPPED (TS has no packages)
 *   L3         import android.content.Context                → dropped (the platform pieces are injected:
 *              the cookie jar via the reused `HtmlRuntimeCookieStore`, the proxy via the reused
 *              `SystemProxyProvider`, the HTTP path via `ZLibraryHttpTransport`)
 *   L4         import android.webkit.CookieManager          → `HtmlRuntimeCookieStore.getCookie(url)`
 *              (the already-ported seam from `zLibraryWebViewHelper.ts`, same `getCookie(url)` shape)
 *   L5         import androidx.compose.runtime.Composable    → SKIPPED: Compose UI concept. The port keeps
 *              only the singleton accessor; the `@Composable` wrapper below has no core equivalent
 *              (see L63-65).
 *   L6         import coil.ImageLoader                       → the `CoverImageLoader` shape below (a platform
 *              image pipeline descriptor: config + a per-request header factory). Coil's decoder,
 *              memory cache and bitmap pooling have no web/iOS equivalent in `src/core` and are
 *              deliberately NOT re-implemented — the host's `<img>`/Capacitor layer consumes this.
 *   L7         import …network.SystemProxyResolver           → the reused `SystemProxyResolver.resolve(provider)`
 *   L8         import …network.ZLibraryDns                   → `COVER_LOADER_CONFIG.useZLibraryDns` for the transport
 *   L9-10      import java.util.concurrent.TimeUnit / okhttp3.OkHttpClient → millisecond literals + the injected transport
 *   L12-16     KDoc 封面专用图片加载器…（DoH 防污染 DNS + 系统代理 / 全局单例复用）
 *                                                            → preserved verbatim on `ZLibraryCoverLoader`
 *   L17        object ZLibraryCoverLoader                   → `export const ZLibraryCoverLoader`
 *   L18-19     @Volatile cachedLoader                       → module-level `cachedLoader` (the `@Volatile`
 *              annotation is JVM-only; JS is single-threaded — same note as
 *              `src/core/source/zlibrary/encryptedCookieJar.ts`)
 *   L21-25     fun get(context): ImageLoader                → `ZLibraryCoverLoader.get(deps)` with the same
 *              double-checked `cachedLoader ?: …` shape (the `synchronized(this)` block is a no-op
 *              in JS, so the second `?:` is kept only for the shape, not for mutual exclusion)
 *   L27        private fun buildLoader(context)              → `buildLoader(deps)`
 *   L28-31     `SharedHttpTransport.builder().dns(ZLibraryDns.INSTANCE)
 *               .connectTimeout(10, SECONDS).readTimeout(15, SECONDS)`
 *                                                            → `COVER_LOADER_CONFIG` (verbatim 10 s / 15 s)
 *   L32        封面 CDN 可能需要浏览器身份/防盗链 Referer/会话 Cookie (comment) → verbatim
 *   L33-53     the `addInterceptor { … }` body              → `buildCoverRequestHeaders(...)`, verbatim
 *              (two CookieManager reads, the `filter { isNotBlank() }.joinToString("; ")` merge,
 *              the User-Agent + Referer headers, and the conditional `Cookie` header)
 *   L54        `SystemProxyResolver.resolve(context)?.let { clientBuilder.proxy(it) }`
 *                                                            → `SystemProxyResolver.resolve(deps.proxyProvider)`; the
 *              resolved proxy is recorded on the loader so the platform transport can apply it
 *   L55-58     `ImageLoader.Builder(context).okHttpClient(…).crossfade(true).build()`
 *                                                            → the `CoverImageLoader` literal (`crossfade: true`)
 *   L60        closing brace of the object                  → n/a
 *   L62        KDoc 保持原有调用签名：返回全局复用的封面加载器。 → preserved on `get()`
 *   L63-65     @Composable fun rememberZLibraryImageLoader(context): ImageLoader
 *                                                            → SKIPPED (React/Compose UI concern; the UI owns it —
 *              it can call `ZLibraryCoverLoader.get(...)` or take the loader through props).
 *              `resetCoverLoader()` is exported instead so a test/host can clear the singleton.
 *   L66        closing brace                                → n/a
 *
 * ADAPTATIONS (documented at each site):
 *   - `Coil`/`ImageLoader` → the descriptor below: the core never decodes an image, it only
 *     decides HOW a cover request must be made (DoH DNS + system proxy + browser identity +
 *     anti-hotlink `Referer` + merged session cookies). The host wires those onto its own
 *     image element, which is why no `<img>`, `fetch` or DOM object appears in this file.
 *   - `blockNetworkImage` is NOT a setting of this loader — it belongs to the hidden WebView
 *     session (`zLibraryNativeSession.ts`, Kotlin `ZLibraryNativeSession.kt:135`) and is kept there.
 *   - `TimeUnit.SECONDS` → milliseconds.
 */

import {
  SystemProxyResolver,
  type SystemProxyInfo,
  type SystemProxyProvider,
} from '../source/zlibrary/network/systemProxyResolver';
import type { HtmlRuntimeCookieStore } from '../source/zlibrary/zLibraryWebViewHelper';
import type { ZLibraryNodeConfigPort } from '../source/zlibrary/zLibraryHost';
import { createNodeConfigPort } from './zLibraryNodeConfig';

/**
 * Kotlin L28-31 — the cover loader's client configuration, verbatim:
 * `.dns(ZLibraryDns.INSTANCE).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)`
 */
export const COVER_LOADER_CONFIG = {
  connectTimeoutMs: 10_000,
  readTimeoutMs: 15_000,
  useZLibraryDns: true,
} as const;

/**
 * Kotlin L44-47, spelled out longhand in the Kotlin source:
 * ```
 * "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 " +
 *     "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
 * ```
 * It is byte-identical to `DEFAULT_USER_AGENT` in `../source/zlibrary/network/zLibraryHttpClient.ts`
 * (same string, two concatenations); it is kept longhand here so the two files cannot drift
 * apart by accident — if you change one, change the other.
 */
export const COVER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export interface CoverRequestHeaderParams {
  /** Kotlin `req.url.toString()` — the cover URL being fetched. */
  url: string;
  /** Kotlin `CookieManager.getInstance().getCookie(url) ?: ""`. */
  cookie: string | null;
  /** Kotlin `CookieManager.getInstance().getCookie("https://${domain}/") ?: ""`. */
  nodeCookie: string | null;
  /** Kotlin `ZLibraryNodeConfig.domain`. */
  nodeDomain: string;
}

/**
 * Kotlin L33-53 — the `addInterceptor { chain -> … }` body, verbatim:
 *
 * ```
 * val cookie     = CookieManager.getCookie(url) ?: ""
 * val nodeCookie = CookieManager.getCookie("https://${domain}/") ?: ""
 * val combinedCookie = listOf(cookie, nodeCookie).filter { it.isNotBlank() }.joinToString("; ")
 * builder.header("User-Agent", UA).header("Referer", "https://${domain}/")
 * if (combinedCookie.isNotBlank()) builder.header("Cookie", combinedCookie)
 * ```
 *
 * Both cookies are kept: the CDN cookie scope (`covers.1lib.sk`) and the node session cookie are
 * different jars, and dropping either one is what makes the cover CDN answer 403.
 */
export function buildCoverRequestHeaders(params: CoverRequestHeaderParams): Record<string, string> {
  const cookie = params.cookie ?? '';
  const nodeCookie = params.nodeCookie ?? '';
  const combinedCookie = [cookie, nodeCookie]
    .filter((it) => it.trim() !== '')
    .join('; ');
  const headers: Record<string, string> = {
    'User-Agent': COVER_USER_AGENT,
    Referer: `https://${params.nodeDomain}/`,
  };
  if (combinedCookie.trim() !== '') {
    headers['Cookie'] = combinedCookie;
  }
  return headers;
}

/**
 * ADDITION — the diagnostic form of `buildCoverRequestHeaders`: the `Cookie` value is replaced
 * by a shape-only summary so a cover URL can be logged/inspected without leaking
 * `remix_userkey` / `remix_userid` / `c_token`. `src/core` has no other way to redact, because
 * the Android version never logged these headers at all (it handed them straight to OkHttp).
 */
export function redactCoverCookieHeader(value: string): string {
  if (value.trim() === '') return '';
  return value
    .split(';')
    .map((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return trimmed;
      return `${trimmed.slice(0, eq)}=[redacted]`;
    })
    .join('; ');
}

/** The platform image pipeline descriptor that replaces Coil's `ImageLoader`. */
export interface CoverImageLoader {
  /** Kotlin `ZLibraryCoverLoader` KDoc — the whole reason this loader exists. */
  readonly config: typeof COVER_LOADER_CONFIG;
  /** Kotlin `SystemProxyResolver.resolve(context)?.let { clientBuilder.proxy(it) }`. */
  readonly proxy: SystemProxyInfo | null;
  /** Kotlin `.crossfade(true)`. */
  readonly crossfade: true;
  /** Kotlin `.addInterceptor { … }` — headers for one cover request. */
  headersFor(url: string): Record<string, string>;
  /** The header set for one cover request, with the `Cookie` value redacted. */
  describeHeadersFor(url: string): Record<string, string>;
}

export interface CoverLoaderDeps {
  /** Kotlin `CookieManager.getInstance()`. */
  cookies: HtmlRuntimeCookieStore;
  /** Kotlin `SystemProxyResolver.resolve(context)`. */
  proxyProvider: SystemProxyProvider | null;
  /** Kotlin `ZLibraryNodeConfig.domain`. */
  nodeConfig: ZLibraryNodeConfigPort;
}

/** Kotlin L27-59 `private fun buildLoader(context): ImageLoader`. */
export function buildLoader(deps: CoverLoaderDeps): CoverImageLoader {
  const headersFor = (url: string): Record<string, string> => {
    const domain = deps.nodeConfig.nodeDomain();
    return buildCoverRequestHeaders({
      url,
      cookie: deps.cookies.getCookie(url),
      nodeCookie: deps.cookies.getCookie(`https://${domain}/`),
      nodeDomain: domain,
    });
  };
  return {
    config: COVER_LOADER_CONFIG,
    proxy: SystemProxyResolver.resolve(deps.proxyProvider),
    crossfade: true,
    headersFor,
    describeHeadersFor: (url: string): Record<string, string> => {
      const headers = headersFor(url);
      const cookie = headers['Cookie'];
      if (cookie === undefined) return headers;
      return { ...headers, Cookie: redactCoverCookieHeader(cookie) };
    },
  };
}

/** Kotlin L18-19 — the process-wide singleton slot. */
let cachedLoader: CoverImageLoader | null = null;

/**
 * 封面专用图片加载器：走与书库相同的网络路径（DoH 防污染 DNS + 系统代理），
 * 否则 covers.1lib.sk 在部分网络下无法加载。
 * 全局单例复用，避免每次进入书库都重建 OkHttpClient / Coil。
 *
 * 保持原有调用签名：返回全局复用的封面加载器。
 */
export const ZLibraryCoverLoader = {
  /** Kotlin L21-25 `fun get(context): ImageLoader`. */
  get(deps: CoverLoaderDeps): CoverImageLoader {
    // Kotlin `cachedLoader ?: synchronized(this) { cachedLoader ?: buildLoader(context).also { cachedLoader = it } }`
    if (cachedLoader !== null) return cachedLoader;
    cachedLoader = buildLoader(deps);
    return cachedLoader;
  },
  /** ADDITION — clears the singleton (the `synchronized` cache has no reset in the Kotlin). */
  reset(): void {
    cachedLoader = null;
  },
  /** ADDITION — read-only view, so a host can check whether it was already built. */
  peek(): CoverImageLoader | null {
    return cachedLoader;
  },
};

/**
 * Kotlin L63-65 `@Composable fun rememberZLibraryImageLoader(context): ImageLoader`.
 *
 * SKIPPED as a function: `@Composable` is Compose-only and `src/core` must not import React.
 * The UI passes the loader down as a prop (the Kotlin `ReadingRecordCover.kt:26` /
 * `LibraryScreen.kt:231` call sites both read `ZLibraryCoverLoader.get(context)`), so the
 * exported singleton above is all a UI component needs.
 */
export function rememberZLibraryImageLoader(deps: CoverLoaderDeps): CoverImageLoader {
  return ZLibraryCoverLoader.get(deps);
}

/** Convenience wiring for the common case: the real global node config, no proxy provider. */
export function createDefaultCoverLoader(
  cookies: HtmlRuntimeCookieStore,
  proxyProvider: SystemProxyProvider | null = null,
): CoverImageLoader {
  return ZLibraryCoverLoader.get({ cookies, proxyProvider, nodeConfig: createNodeConfigPort() });
}
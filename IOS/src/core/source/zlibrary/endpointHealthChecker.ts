/**
 * Kotlin → TS: `source/zlibrary/EndpointHealthChecker.kt` (224 lines, 210 non-blank)
 *             → `src/core/source/zlibrary/endpointHealthChecker.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import android.content.Context → dropped (all I/O injected)
 *   L4        import …network.ZLibraryDns    → injected `ZLibraryDnsLookup` (`lookup(hostname)`)
 *   L5-6      import kotlinx.coroutines.*     → dropped (Promises)
 *   L7        import com.example.source.executeCancellable → the transport's AbortSignal argument
 *   L8-9      import okhttp3.{OkHttpClient,Request} → injected `ZLibraryHttpTransport`
 *   L10       import java.net.URLEncoder     → `javaUrlEncode` from `./zLibraryHost`
 *   L11       import java.util.concurrent.TimeUnit → ms literals (`HEALTH_CLIENT_CONFIG`)
 *   L13-26    data class EndpointHealthResult → readonly interface + `createEndpointHealthResult`
 *   L28-38    class KDoc 判定逻辑（2026-08 实测校准…） → preserved verbatim
 *   L39       class EndpointHealthChecker(private val context) → constructor takes the injected deps
 *   L40-41    credentialStorage + cookieJar   → constructor params
 *   L42-58    the private OkHttpClient (.dns/.callTimeout 12s/.connect 10s/.read 10s/.write 10s/
 *             .cookieJar/.addInterceptor(DiamWall)/header interceptor) → `HEALTH_CLIENT_CONFIG` +
 *             `HEALTH_DEFAULT_HEADERS` (which OVERWRITE unconditionally, unlike
 *             `applyDefaultHeaders` in `network/zLibraryHttpClient.ts` — preserved distinction)
 *   L60       suspend fun checkHealth(domain): EndpointHealthResult → `async checkHealth(domain)`
 *   L61-64    startTime / dnsOk / tlsOk / httpCode = -1 → verbatim
 *   L66-72    Step 0 DNS lookup in try/catch → verbatim
 *   L74-85    `if (!dnsOk) return` (error "DNS 解析失败") → verbatim
 *   L87-94    Step 1 homepage GET, `tlsOk = true` on response, `peekBody(1MB)` → verbatim
 *   L96-101   isCloudflareBlocked (5 conditions)  → verbatim
 *   L102-113  Cloudflare branch return           → verbatim
 *   L115-137  Step 2 looksLikeZlib (4 markers, NOT the plain "Z-Library" text) + branch return
 *                                                          → verbatim, comments preserved
 *   L139-151  Step 3 eapi /eapi/info probe, `body.contains("\"success\":1")` → verbatim
 *   L153-184  Step 4 search probe, encodedKw, finalPath/keywordRelevant/serviceUnavailable,
 *             searchAvailable + the 4-branch searchDetail → verbatim
 *   L186-202  final return with the 3-branch error → verbatim
 *   L204-222  catch: rtt / errMessage ?: "网络超时" / TLS error sniff / return → verbatim
 *   L223-224  closing braces                  → n/a
 *
 * Adaptations:
 *   - `withContext(Dispatchers.IO)` dropped; the method is a Promise.
 *   - `if (e is kotlinx.coroutines.CancellationException) throw e` (L151/L184/L205) — dropped:
 *     there is no such class in JS, and a rejected fetch already propagates. Documented, not
 *     silently changed: the remaining `catch` blocks keep the Kotlin behaviour of treating any
 *     other failure as "node unavailable".
 *   - `executeCancellable()` → the injected transport takes an optional `AbortSignal`
 *     (see `src/core/source/networkCalls.ts` for the same mapping).
 *   - `okhttp3.HttpUrl.encodedPath` → the WHATWG `URL.pathname`; both are the percent-encoded path.
 *   - `response.header("Content-Type")` / `body` are read from the transport's
 *     `ZLibraryHttpResponse`; `peekBody(n)` byte limit reproduced by `peekBody()`.
 *   - `ZLibraryDns.INSTANCE.lookup(domain)` → the injected `ZLibraryDnsLookup` interface
 *     (`network/zLibraryDns.ts` provides the real implementation).
 */

import type { ZLibraryHttpResponse, ZLibraryHttpTransport } from './network/zLibraryHttpClient';
import { javaUrlEncode, peekBody } from './zLibraryHost';

export interface EndpointHealthResult {
  readonly domain: string;
  readonly isAvailable: boolean;
  readonly rtt: number;
  readonly isCloudflare: boolean;
  readonly dnsOk: boolean;
  readonly tlsOk: boolean;
  readonly httpCode: number;
  /** 首页确认是真实 Z-Library 站点（防止停放域名/镜像劫持被误判为可用）。 */
  readonly isRealZlib: boolean;
  /** 站点搜索服务是否可用（/s/ 未返回 "Search service temporary unavailable"）。 */
  readonly searchAvailable: boolean;
  readonly error: string | null;
}

export function createEndpointHealthResult(
  params: Partial<EndpointHealthResult> & { domain: string; isAvailable: boolean; rtt: number },
): EndpointHealthResult {
  return {
    domain: params.domain,
    isAvailable: params.isAvailable,
    rtt: params.rtt,
    isCloudflare: params.isCloudflare ?? false,
    dnsOk: params.dnsOk ?? false,
    tlsOk: params.tlsOk ?? false,
    httpCode: params.httpCode ?? -1,
    isRealZlib: params.isRealZlib ?? false,
    searchAvailable: params.searchAvailable ?? false,
    error: params.error ?? null,
  };
}

/** Kotlin L42-49: the private OkHttpClient's timeouts + DNS/cookie/interceptor wiring. */
export const HEALTH_CLIENT_CONFIG = {
  /** Kotlin `.callTimeout(12, TimeUnit.SECONDS)` */
  callTimeoutMs: 12_000,
  /** Kotlin `.connectTimeout(10, TimeUnit.SECONDS)` */
  connectTimeoutMs: 10_000,
  /** Kotlin `.readTimeout(10, TimeUnit.SECONDS)` */
  readTimeoutMs: 10_000,
  /** Kotlin `.writeTimeout(10, TimeUnit.SECONDS)` */
  writeTimeoutMs: 10_000,
  /** Kotlin `.dns(ZLibraryDns.INSTANCE)` */
  useZLibraryDns: true,
  /** Kotlin `.cookieJar(cookieJar)` */
  useEncryptedCookieJar: true,
  /** Kotlin `.addInterceptor(DiamWallInterceptor(cookieJar))` */
  useDiamWallInterceptor: true,
} as const;

/**
 * Kotlin L50-57: the header interceptor. NOTE it uses `Request.Builder().header(...)`, which
 * OVERWRITES, unlike `ZLibraryHttpClient`'s "only when absent" interceptor (L36-72). Both
 * behaviours are kept distinct, including this client's shorter `Accept` value.
 */
export const HEALTH_DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

/** The `ZLibraryDns.lookup` seam (the real one lives in `network/zLibraryDns.ts`). */
export interface ZLibraryDnsLookup {
  lookup(hostname: string): Promise<string[]>;
}

export class EndpointHealthChecker {
  constructor(
    private readonly transport: ZLibraryHttpTransport,
    /** Kotlin `ZLibraryDns.INSTANCE` (L68) — the anti-poisoning resolver singleton. */
    private readonly dns: ZLibraryDnsLookup,
  ) {}

  /**
   * Z-Library 节点健康检查。
   *
   * 判定逻辑（2026-08 实测校准，不再使用 /fulltext/ 作为健康信号）：
   * 1. DNS 解析 + TLS 握手；
   * 2. 首页（DiamWall PoW 由 DiamWallInterceptor 自动解算）：HTTP 200 且页面带 Z-Library
   *    特征（zlibrary.js / z-cover / z-bookcard / book-item / Z-Library 文案）才算真实站点；
   * 3. eapi 探针 /eapi/info：200 + success=1 说明站点的 JSON API 层正常；
   * 4. 搜索服务探针 /s/{kw}：不返回 "Search service temporary unavailable" 且能解析出
   *    书卡片，searchAvailable = true（官网搜索故障时节点仍可达，只是搜索不可用）。
   */
  async checkHealth(domain: string): Promise<EndpointHealthResult> {
    const startTime = Date.now();
    let dnsOk = false;
    let tlsOk = false;
    let httpCode = -1;

    try {
      try {
        const addresses = await this.dns.lookup(domain);
        dnsOk = addresses.length > 0;
      } catch {
        dnsOk = false;
      }

      if (!dnsOk) {
        return createEndpointHealthResult({
          domain,
          isAvailable: false,
          rtt: Date.now() - startTime,
          isCloudflare: false,
          dnsOk: false,
          tlsOk: false,
          httpCode: -1,
          error: 'DNS 解析失败',
        });
      }

      // Step 1: 首页（DiamWallInterceptor 会先解 c_token PoW 再返回最终响应）
      const homeUrl = `https://${domain}/`;
      const homeResponse = await this.get(homeUrl, null);
      tlsOk = true;
      const homeCode = homeResponse.code;
      const homeBody = peekBody(homeResponse.body, 1024 * 1024);
      httpCode = homeCode;

      const isCloudflareBlocked =
        homeCode === 403 ||
        homeCode === 503 ||
        homeCode === 517 ||
        homeCode === 513 ||
        (homeBody.toLowerCase().includes('just a moment') && !homeBody.includes('dwid')) ||
        homeBody.toLowerCase().includes('checking your browser') ||
        homeBody.toLowerCase().includes('solve this captcha') ||
        homeBody.toLowerCase().includes('cpt.lib');

      if (isCloudflareBlocked) {
        return createEndpointHealthResult({
          domain,
          isAvailable: false,
          rtt: Date.now() - startTime,
          isCloudflare: true,
          dnsOk: true,
          tlsOk: true,
          httpCode: homeCode,
          error: '触发 Cloudflare / DiamWall 交互验证（PoW 无法自动解算）',
        });
      }

      // Step 2: 确认是真实 Z-Library 站点（防止停放域名 / 镜像劫持）。
      // 只认结构标记（zlibrary.js / z-cover / z-bookcard / book-item），
      // 不认纯文本 "Z-Library"——停放域名（如 techblazing.com）的 SEO 文章页
      // 会包含该文案但没有 zlib 结构。
      // 2026-09-04 22:10 实测教训：指纹网关壳页（/js/fingerprint/iife.min.js）
      // 不算真实站点——z-lib.is 的壳页对真 Edge 也返回 fp=-7 拒绝，壳页≠可用。
      const looksLikeZlib =
        homeBody.includes('zlibrary.js') ||
        homeBody.includes('z-cover') ||
        homeBody.includes('z-bookcard') ||
        homeBody.includes('book-item');
      if (homeCode !== 200 || !looksLikeZlib) {
        return createEndpointHealthResult({
          domain,
          isAvailable: false,
          rtt: Date.now() - startTime,
          isCloudflare: false,
          dnsOk: true,
          tlsOk: true,
          httpCode: homeCode,
          isRealZlib: false,
          error:
            homeCode !== 200 ? `首页返回 HTTP ${homeCode}` : '非 Z-Library 站点（可能是停放域名）',
        });
      }

      // Step 3: eapi JSON 层探针（登录/书单/下载依赖）
      let eapiOk = false;
      try {
        const response = await this.get(`https://${domain}/eapi/info`, homeUrl);
        const body = peekBody(response.body, 512 * 1024);
        eapiOk = response.code === 200 && body.toLowerCase().includes('"success":1');
      } catch {
        // eapiOk stays false — the caller decides whether search alone is enough
      }

      // Step 4: 搜索服务探针（官网搜索故障时节点仍可达，只是搜索不可用）。
      // 双重校验（修复"搜索出40本"假通过）：入口跳转域（zh.101z.by 等）会把
      // /s/{kw} 302 丢路径跳到主页，主页书卡片会让只查"页面有书"的旧探针
      // 误判搜索可用——所以必须 ① 最终 URL 仍在 /s/ 路径 ② 结果页包含关键词
      // "三体"（真实搜索结果必然含命中书名；主页/推荐页不会）。
      const encodedKw = javaUrlEncode('三体').replace(/\+/g, '%20');
      let searchAvailable = false;
      let searchDetail = '';
      try {
        const searchResponse = await this.get(`https://${domain}/s/${encodedKw}`, homeUrl);
        const searchHtml = peekBody(searchResponse.body, 1024 * 1024);
        const finalPath = new URL(searchResponse.url).pathname;
        const stayedOnSearchPath = finalPath.startsWith('/s/');
        const keywordRelevant = searchHtml.includes('三体');
        const serviceUnavailable = searchHtml
          .toLowerCase()
          .includes('search service temporary unavailable');
        searchAvailable =
          searchResponse.code === 200 &&
          stayedOnSearchPath &&
          !serviceUnavailable &&
          keywordRelevant;
        searchDetail = serviceUnavailable
          ? '搜索服务暂不可用（官网故障）'
          : searchResponse.code !== 200
            ? `搜索页 HTTP ${searchResponse.code}`
            : !stayedOnSearchPath
              ? '搜索被重定向到主页（入口跳转域，非真实镜像）'
              : !keywordRelevant
                ? '搜索结果与关键词无关（疑似主页充数）'
                : '';
      } catch {
        // searchAvailable stays false — the error branch below reports it
      }

      const rtt = Date.now() - startTime;
      return createEndpointHealthResult({
        domain,
        isAvailable: true,
        rtt,
        isCloudflare: false,
        dnsOk: true,
        tlsOk: true,
        httpCode: homeCode,
        isRealZlib: true,
        searchAvailable,
        error:
          !eapiOk && !searchAvailable
            ? '站点可达，但 API 与搜索均异常'
            : !searchAvailable
              ? searchDetail.trim() === ''
                ? '搜索服务暂不可用'
                : searchDetail
              : null,
      });
    } catch (e) {
      const rtt = Date.now() - startTime;
      const errMessage = e instanceof Error && e.message ? e.message : '网络超时';
      const isTlsError =
        errMessage.includes('SSL') ||
        errMessage.includes('TLS') ||
        errMessage.includes('Certificate');
      if (isTlsError) {
        tlsOk = false;
      }
      return createEndpointHealthResult({
        domain,
        isAvailable: false,
        rtt,
        isCloudflare: false,
        dnsOk,
        tlsOk,
        httpCode,
        error: errMessage,
      });
    }
  }

  /** Kotlin `Request.Builder().url(url)[.header("Referer", referer)].get().build()`. */
  private get(url: string, referer: string | null): Promise<ZLibraryHttpResponse> {
    return this.transport.send({
      method: 'GET',
      url,
      referer,
      extraHeaders: { ...HEALTH_DEFAULT_HEADERS },
      formFields: null,
      callTimeoutMs: HEALTH_CLIENT_CONFIG.callTimeoutMs,
    });
  }
}

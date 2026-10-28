/**
 * Kotlin → TS: `source/zlibrary/ZLibrarySource.kt` (740 lines, 682 non-blank)
 *             → `src/core/source/zlibrary/zLibrarySource.ts`
 *
 * Every Kotlin line is mapped below. This is the orchestrator: the HTTP/cookie/session/parser
 * collaborators are the sibling modules in this folder, all injected (the Kotlin constructor
 * built them from a `Context`, which is platform work).
 *
 * Line mapping (grouped by member, in file order):
 *   L1        package …zlibrary                 → SKIPPED (TS has no packages)
 *   L3        import android.content.Context    → dropped (all collaborators injected)
 *   L4        import android.util.Log           → `SourceLog`
 *   L5        import com.example.source.*       → the already-ported `../` modules
 *   L6-7      import com.example.library.ZLibraryNodeConfig / ZLibraryNodeManager
 *                                               → `ZLibraryNodeConfigPort` / `ZLibraryNodeManagerPort`
 *                                                 (from `./zLibraryHost`; outside this module)
 *   L8-11     import …network.{ZLibraryHttpClient,ZLibraryNetworkLogger,ZLibrarySessionManager}
 *             import …parser.ZLibraryParserManager → the sibling modules
 *   L12       import okhttp3.FormBody           → `formBodyOfPairs`
 *   L13       import org.jsoup.Jsoup             → `parseHtmlDocument`
 *   L14       import java.net.URLEncoder        → `javaUrlEncode`
 *   L15-18    import kotlinx.coroutines.{async,awaitAll,coroutineScope,withTimeoutOrNull}
 *                                               → dropped; see "Coroutines" below
 *   L20-25    class ZLibrarySource(context, credentialStorage, httpClient, sessionManager) : BookSource
 *                                               → `class ZLibrarySource extends BookSource` with the same
 *                                                 dependency set, all injected (no `Context`)
 *   L27-28    val eapiClient = ZLibraryEapiClient(httpClient, credentialStorage) → injected field
 *   L30-31    override val id / name            → `readonly id = 'zlibrary'` / `readonly name = 'Z-Library'`
 *   L32       override suspend fun getRegistrationUrl() → `async getRegistrationUrl()` (same template)
 *   L33-39    override val capabilities          → `createSourceCapabilities({ … })` (same 5 flags)
 *   L41       val domainResolver = ZLibraryDomainResolver(context, credentialStorage) → injected field
 *   L43-45    override suspend fun isLoggedIn() → verbatim
 *   L47-53    override suspend fun getAuthenticationState() → verbatim
 *   L55-65    private fun checkCloudflare(code, htmlBody) → verbatim (5 conditions + message)
 *   L67-186   override suspend fun login(credential) → `async login(credential)`, ALL of it:
 *               L69   domain from extraData/blank → resolver
 *               L71-80 cookie login mode (ensureSessionInitialized + cookieJar.syncFromRawCookieString)
 *               L82-84 blank username/password → ParseError("请输入用户名和密码，或提供有效的 Cookie")
 *               L86-93 the 2026-09-04 candidate-list KDoc (kept verbatim)
 *               L94-101 buildList of candidate domains (node config domain, resolver domain,
 *                       DEFAULT_NODE, scraped nodes) with the scheme/trailing-slash strip + distinct
 *               L103-112 preferred first, parallel health check of `drop(1).take(9)`,
 *                       `.distinct().take(4)`, `ifEmpty { reachable.take(4) }`
 *               L114-170 the per-candidate 8s login attempt: homepage GET (referer = itself),
 *                       effectiveHost, `looksLikeZlib` 4-marker gate, `rpc.php` FormBody with the
 *                       exact 4 fields, `"is_error":false` / `"success":1` / remix cookie check,
 *                       credential write-back, syncCookiesToWebView, ".alert-danger/.error/.message"
 *                       text with the `alert("…")` regex fallback, the 8000 ms budget and the
 *                       `when (outcome) { "OK" / null / else }` loop
 *               L171-181 the eapi login fallback loop (also 8s, `syncCookiesToWebView` on success)
 *               L182   SourceResult.Error(ParseError(lastError ?: "登录失败，请检查账号密码或 Cookie"))
 *               L183-185 catch → NetworkError("登录过程异常: ${e.message}")
 *   L188-191  override suspend fun logout()     → verbatim (clear + invalidateSession)
 *   L193-205  private fun translateException(e) → verbatim (3 branches, same messages)
 *   L207-407  override suspend fun search(keyword) → `async search(keyword)`, ALL of it:
 *               L209-211 resolveDomain + ensureSessionInitialized
 *               L212-214 %20 path comment + `URLEncoder…replace("+","%20")` + search URL
 *               L216-223 first GET with a forceScan fallback domain retry
 *               L225-226 body + checkCloudflare
 *               L228-238 "Search service temporary unavailable" guard (error, never /fulltext/)
 *               L240-267 fake-result guard #1 (off-/s/ final path → forceScan retry → hard error)
 *               L269-291 non-2xx → eapi search → WebView search → error, with the 3 log statuses
 *               L293    ZLibraryParserManager.parseSearchPage(html, "https://${finalUrl.host}", id)
 *               L294-335 fake-result guard #2 (>=15 books, keyword absent from html, normalised-title
 *                       hit test with TitleNormalizer, forceScan retry, hard error)
 *               L336-369 empty-book branch (card markers → eapi fallback → empty; no markers →
 *                       WebView → stillChallenged error → empty)
 *               L370-374 final logParserResult + Success(books)
 *               L375-389 catch (SourceException) → WebView fallback → FAILED log → Error(e)
 *               L390-406 catch (Exception) → WebView fallback → translateException → Error
 *   L409-497  override suspend fun getDetail(bookId) → `async getDetail(bookId)`:
 *               L411-424 domain + session + cleanBookId + detail URL + forceScan retry
 *               L426-427 body + checkCloudflare
 *               L429-438 non-2xx → eapi book info → NetworkError
 *               L440    parseDetailPage
 *               L442    com.example.library.zLibraryNovelMetadata(html) → the injected port
 *               L444-454 SearchBook assembly (description + novelInfo + downloadUrl)
 *               L455-468 eapi back-fill when the /dl/ link is missing (description/novelInfo merge)
 *               L470-482 catch (SourceException) → eapi fallback → Error
 *               L483-496 catch (Exception) → translateException + eapi fallback
 *   L499-501  override suspend fun getDownloadInfo(bookId) → `async getDownloadInfo(bookId)`
 *             delegating to `getDownloadInfoWithFormat(bookId, null)` (the BookSource base class
 *             already provides the Kotlin `preferredFormat = null` default — see the note below)
 *   L503-511  KDoc 多格式下载… + the `preferredFormat` overload
 *               L512-514 login gate → LoginRequired
 *               L516-528 daily-limit pre-check → NetworkError("今日下载次数已达上限（a/b）…")
 *               L530-535 getDetail, unwrap Success / propagate Error
 *               L537-543 cleanTitle (`[\\/:*?"<>|]` → "_") + defaultFormat from the URL suffix
 *               L545     cookie header
 *               L547-590 non-default format: eapi key → getFormats → variant → getDownloadLinkResult
 *                       → DownloadInfo(`$cleanTitle.$wantFormat`, referer `https://$domain/`) or the
 *                       disallow message, else the "无法获取 $wantFormat 格式…" error
 *               L592-626 default format: eapi CDN link first, then the detail /dl/ link;
 *                       `finalUrl` blank → ParseError("未获取到下载链接，请稍后重试或切换节点")
 *   L627-631  catch (SourceException) → Error(e); catch (Exception) → NetworkError("获取下载链接失败: …")
 *   L634-682  KDoc 可用格式列表… + override suspend fun getAvailableFormats(book) → verbatim 3-step merge
 *   L684-708  KDoc + private suspend fun resolveEapiBookKey(domain, bookId) → verbatim
 *   L710-724  KDoc + fun syncCookiesToWebView(domain) → `async syncCookiesToWebView(domain?)`;
 *               `android.webkit.CookieManager` → the injected `HtmlRuntimeCookieStore` (§ WebView below)
 *   L726-738  KDoc + private fun syncWebViewCookiesToHttp(cookies, domain) → verbatim
 *   L740      closing brace                     → n/a
 *
 * ADAPTATION — Coroutines (documented):
 *   - `withContext(Dispatchers.IO)` dropped (Promises).
 *   - `coroutineScope { … async { runCatching { … } } … awaitAll().filterNotNull() }` (L104-112)
 *     → `Promise.allSettled` + filter, because a single rejected candidate must not abort the
 *     fan-out (each branch already uses `runCatching`).
 *   - `withTimeoutOrNull(8000) { … }` → `withTimeout(promise, 8000)` returning null on expiry
 *     (`null` is exactly the value the Kotlin `when` treats as "skip this candidate").
 *   - `withTimeoutOrNull(8000) { runCatching { … }.getOrDefault(false) } ?: false` (L173-176) →
 *     the same `withTimeout` around a promise that never rejects.
 *
 * ADAPTATION — `BookSource` overloads:
 *   Kotlin has `getDownloadInfo(bookId)` (L499) and `getDownloadInfo(bookId, preferredFormat)`
 *   (L508) as two overloads. TS cannot overload, and the ported `BookSource` base class
 *   (`src/core/source/bookSource.ts`) already defines the second one as
 *   `getDownloadInfoWithFormat(bookId, preferredFormat?)`, so the L508 method overrides that
 *   name and L499-501 delegates to it with `null` — identical call graph.
 *
 * ADAPTATION — `android.webkit.CookieManager` (documented): `syncCookiesToWebView` only needs
 *   "accept cookies / setCookie(url, cookie) / flush", which is the `HtmlRuntimeCookieStore`
 *   declared in `./zLibraryWebViewHelper`. It is injected, so `src/core` stays DOM-free; when
 *   no runtime is wired the call is a no-op, which is the same observable outcome on a target
 *   with no WebView at all (the Android `runCatching` would have thrown and been swallowed).
 *
 * ADAPTATION — `com.example.library.*` and `zLibraryNovelMetadata` live outside this module
 *   and are declared as injected ports in `./zLibraryHost`; every `runCatching { … }` guard
 *   around them is preserved.
 *
 * REVIEW FIXES (this pass):
 *   - L300 `Regex("""[\s\p{Punct}]+""")` was ported as `/[\s\p{P}]+/gu`. Java's `\p{Punct}` is
 *     the ASCII POSIX punctuation class; JS `\p{P}` is all Unicode `P*`. The extra stripping
 *     changed `normTitle` for CJK punctuation (`，` `。` `《`), which feeds the
 *     "搜索结果与关键词无关" verdict. Replaced with the ASCII class (`JAVA_PUNCT_WHITESPACE`).
 *   - L69 `credential.extraData["domain"]?.ifBlank { null }` is whitespace-aware; the port
 *     compared against `!== ''`, so an all-whitespace `domain` was used verbatim as the host.
 */

import { normalize as normalizeTitle } from '../../data/titleNormalizer';
import { AuthenticationState } from '../authenticationState';
import { createBookFormat, type BookFormat } from '../bookFormat';
import { BookSource } from '../bookSource';
import type { LoginCredential } from '../loginCredential';
import { createDownloadInfo, type DownloadInfo } from '../downloadInfo';
import { SourceLog } from '../sourceLog';
import {
  createSourceCapabilities,
  type SourceCapabilities,
} from '../sourceCapabilities';
import { LoginRequired, NetworkError, ParseError, SourceException } from '../sourceException';
import { SourceResult, type SourceResult as SourceResultType } from '../sourceResult';
import { createSearchBook, type SearchBook } from '../searchBook';
import { type EncryptedCookieJar } from './encryptedCookieJar';
import { formBodyOfPairs } from './network/zLibraryHttpClient';
import { ZLibraryNetworkLogger } from './network/zLibraryNetworkLogger';
import { type ZLibrarySessionManager } from './network/zLibrarySessionManager';
import { parseHtmlDocument } from './parser/htmlDocument';
import { ZLibraryParserManager } from './parser/zLibraryParserManager';
import { guessFileFormatFromUrl } from './zLibraryParser';
import { type ZLibraryEapiClient } from './zLibraryEapiClient';
import { type ZLibraryDomainResolver } from './zLibraryDomainResolver';
import type { ZLibraryCredentialStorage } from './zLibraryCredentialStorage';
import { javaUrlEncode } from './zLibraryHost';
import type {
  ZLibraryNodeConfigPort,
  ZLibraryNodeManagerPort,
  ZLibraryNovelMetadataPort,
} from './zLibraryHost';
import { ZLibraryWebViewHelper, type HtmlRuntimeCookieStore } from './zLibraryWebViewHelper';

export interface ZLibrarySourceDeps {
  readonly credentialStorage: ZLibraryCredentialStorage;
  readonly httpClient: ZLibraryHttpClientLike;
  readonly sessionManager: ZLibrarySessionManager;
  readonly eapiClient: ZLibraryEapiClient;
  readonly domainResolver: ZLibraryDomainResolver;
  readonly cookieJar: EncryptedCookieJar;
  readonly nodeConfig: ZLibraryNodeConfigPort;
  readonly nodeManager: ZLibraryNodeManagerPort;
  readonly novelMetadata: ZLibraryNovelMetadataPort;
  /** WebView search fallback (`ZLibraryWebViewHelper.searchViaWebView`). */
  readonly webViewSearch: (
    node: string,
    keyword: string,
    cookies: string | null,
  ) => Promise<WebViewSearchLike>;
  /** `android.webkit.CookieManager` seam used by `syncCookiesToWebView`. */
  readonly webViewCookies: HtmlRuntimeCookieStore | null;
  readonly now?: () => number;
}

/** The subset of `ZLibraryHttpClient` this class uses (keeps the import graph acyclic). */
export interface ZLibraryHttpClientLike {
  get(
    url: string,
    referer?: string | null,
    extraHeaders?: Record<string, string>,
    callTimeoutMs?: number | null,
    signal?: AbortSignal | null,
  ): Promise<ZLibraryResponseLike>;
  postForm(
    url: string,
    formBody: ReadonlyArray<{ name: string; value: string }>,
    referer?: string | null,
    extraHeaders?: Record<string, string>,
    signal?: AbortSignal | null,
  ): Promise<ZLibraryResponseLike>;
}

/** The subset of `ZLibraryHttpResponse` this class reads. */
export interface ZLibraryResponseLike {
  readonly code: number;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly isSuccessful: boolean;
  close(): void;
}

/** The subset of `WebViewSearchResult` this class reads. */
export interface WebViewSearchLike {
  readonly books: SearchBook[];
  readonly pageHasZlibMarkers: boolean;
  readonly stillChallenged: boolean;
  readonly cookies: string | null;
}

export class ZLibrarySource extends BookSource {
  readonly id: string = 'zlibrary';
  readonly name: string = 'Z-Library';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({
    supportSearch: true,
    supportDownload: true,
    searchRequiresLogin: false,
    downloadRequiresLogin: true,
    supportDebug: true,
  });

  private readonly deps: ZLibrarySourceDeps;

  constructor(deps: ZLibrarySourceDeps) {
    super();
    this.deps = deps;
  }

  /** eapi（bipinkrish 方案）兜底客户端：登录/搜索/详情/多格式下载。 */
  private get eapiClient(): ZLibraryEapiClient {
    return this.deps.eapiClient;
  }

  /** Kotlin `val domainResolver = ZLibraryDomainResolver(context, credentialStorage)` (L41). */
  private get domainResolver(): ZLibraryDomainResolver {
    return this.deps.domainResolver;
  }

  override async getRegistrationUrl(): Promise<string> {
    const domain = this.readNodeDomain();
    return `https://${domain}/registration`;
  }

  override async isLoggedIn(): Promise<boolean> {
    return this.deps.credentialStorage.isLoggedIn();
  }

  override async getAuthenticationState(): Promise<AuthenticationState> {
    return (await this.isLoggedIn())
      ? AuthenticationState.Authenticated
      : AuthenticationState.Required;
  }

  /** Kotlin `private fun checkCloudflare(responseCode: Int, htmlBody: String)` (L55-65). */
  private checkCloudflare(responseCode: number, htmlBody: string): void {
    // 513 = DiamWall 对非浏览器 TLS 指纹的硬拦截（2026-09-04 实测：OkHttp 冷启动
    // 常态命中）。不抛异常会掉进下方 !isSuccessful 分支只试 eapi 后直接报错，
    // 错失 WebView（Chromium 指纹）兜底——所以必须并入挑战码集合。
    if (
      responseCode === 403 ||
      responseCode === 503 ||
      responseCode === 513 ||
      responseCode === 517 ||
      (htmlBody.includes('Just a moment') && !htmlBody.includes('dwid')) ||
      htmlBody.includes('Checking your browser')
    ) {
      throw new NetworkError('Cloudflare / DiamWall verification required');
    }
  }

  override async login(credential: LoginCredential): Promise<SourceResultType<boolean>> {
    try {
      const credentialDomain = credential.extraData['domain'];
      const domain =
        credentialDomain !== undefined && credentialDomain.trim() !== ''
          ? credentialDomain
          : await this.domainResolver.resolveDomain();

      if (credential.cookie !== null && credential.cookie !== undefined && credential.cookie.trim() !== '') {
        // Cookie login mode
        await this.deps.sessionManager.ensureSessionInitialized(domain);
        await this.deps.cookieJar.syncFromRawCookieString(credential.cookie, domain);
        return (await this.deps.credentialStorage.isLoggedIn())
          ? SourceResult.Success(true)
          : SourceResult.Error(new LoginRequired());
      }

      if (credential.username.trim() === '' || credential.password.trim() === '') {
        return SourceResult.Error(new ParseError('请输入用户名和密码，或提供有效的 Cookie'));
      }

      // 候选节点：健康检查通过的域优先（2026-09-04 修复"逐域盲提交"——
      // 旧行为对 18 个候选挨个 POST 登录表单，死域/重定向域浪费几分钟还
      // 有额外认证请求风险；现在登录前先快速可达性过滤，最多提交 4 个域）。
      // 只对"首页确认是 Z-Library"的主机提交登录（跳过假镜像，如 z-lib.id），
      // 每个候选最多 8 秒，避免 rpc.php 挂起导致读超时。
      // 2026-09-04 补充：首选域（用户选择/默认 = 1lib.sk）免健康检查——
      // DiamWall 挑战页会被健康检查误判为不可达，导致登录请求被引到
      // 仿冒站/死站上；首选域始终排第一优先尝试。
      const reachable: string[] = [];
      const preferredDomain = this.readNodeDomainOrNull();
      if (preferredDomain !== null) reachable.push(preferredDomain);
      reachable.push(domain);
      reachable.push(this.deps.nodeManager.defaultNode);
      for (const node of this.deps.nodeManager.getScrapedNodes()) reachable.push(node);
      const cleaned = reachable
        .map((it) => it.trim().replace(/^https:\/\//, '').replace(/^http:\/\//, '').replace(/\/+$/, ''))
        .filter((it) => it !== '');
      const distinct = Array.from(new Set(cleaned));

      const preferred = distinct.length > 0 ? (distinct[0] as string) : null;
      const rest = distinct.slice(1, 0 + LOGIN_CANDIDATE_POOL);
      const settled = await Promise.allSettled(
        rest.map(async (host) => {
          try {
            const health = await this.domainResolver.checkDomainHealth(host);
            return health.isAvailable ? host : null;
          } catch {
            return null;
          }
        }),
      );
      const healthy = settled
        .filter((it) => it.status === 'fulfilled')
        .map((it) => (it as PromiseFulfilledResult<string | null>).value)
        .filter((it): it is string => it !== null);
      const merged = Array.from(new Set(preferred !== null ? [preferred, ...healthy] : healthy)).slice(
        0,
        MAX_LOGIN_CANDIDATES,
      );
      const candidates: string[] = merged.length > 0 ? merged : distinct.slice(0, MAX_LOGIN_CANDIDATES);

      let lastError: string | null = null;
      for (const candidate of candidates) {
        const outcome = await withTimeout(this.attemptLogin(candidate, credential), LOGIN_CANDIDATE_TIMEOUT_MS);
        if (outcome === 'OK') {
          return SourceResult.Success(true);
        }
        if (outcome !== null) lastError = outcome;
        // null → 超时或非 Z-Library 首页：跳过该候选
      }
      // 兜底：rpc.php 全部失败时走 eapi 登录（bipinkrish 方案）
      for (const candidate of candidates) {
        const ok =
          (await withTimeout(
            this.eapiClient
              .login(credential.username, credential.password, candidate)
              .catch(() => false),
            LOGIN_CANDIDATE_TIMEOUT_MS,
          )) ?? false;
        if (ok) {
          await this.syncCookiesToWebView(candidate);
          return SourceResult.Success(true);
        }
      }
      return SourceResult.Error(
        new ParseError(lastError ?? '登录失败，请检查账号密码或 Cookie'),
      );
    } catch (e) {
      return SourceResult.Error(new NetworkError(`登录过程异常: ${errorMessage(e)}`));
    }
  }

  /** The per-candidate `runCatching { … }.getOrElse { e -> e.message ?: "登录失败" }` body (L118-163). */
  private async attemptLogin(
    candidate: string,
    credential: LoginCredential,
  ): Promise<string | null> {
    try {
      // 1) 访问首页，让 DiamWall 拦截器完成重定向 + PoW，拿到真实主机
      const homeResponse = await this.deps.httpClient.get(
        `https://${candidate}/`,
        `https://${candidate}/`,
      );
      const effectiveHost = new URL(homeResponse.url).host;
      const homeHtml = homeResponse.body;
      homeResponse.close();

      const looksLikeZlib =
        homeHtml.includes('zlibrary.js') ||
        homeHtml.includes('z-cover.js') ||
        homeHtml.includes('z-bookcard') ||
        homeHtml.includes('book-item');
      if (!looksLikeZlib) return null;

      // 2) 在真实主机上提交登录表单
      const loginUrl = `https://${effectiveHost}/rpc.php`;
      const formBody = formBodyOfPairs([
        ['action', 'login'],
        ['email', credential.username],
        ['password', credential.password],
        ['is_remember', '1'],
      ]);

      const response = await this.deps.httpClient.postForm(loginUrl, formBody, `https://${effectiveHost}/`);
      const htmlOrJson = response.body;
      const responseUrl = new URL(response.url);

      if (!response.isSuccessful) {
        return `登录接口返回异常 HTTP ${response.code}`;
      }
      const cookies = await this.deps.cookieJar.loadForRequest(responseUrl);
      const hasSession =
        cookies.some((it) => it.name === 'remix_userkey') ||
        cookies.some((it) => it.name === 'remix_userid');
      if (htmlOrJson.includes('"is_error":false') || htmlOrJson.includes('"success":1') || hasSession) {
        await this.deps.credentialStorage.saveCredentials({
          userId: await this.deps.credentialStorage.getUserId(),
          userKey: await this.deps.credentialStorage.getUserKey(),
          domain: effectiveHost,
          cookies: await this.deps.credentialStorage.getCookies(),
        });
        await this.syncCookiesToWebView(effectiveHost);
        return 'OK';
      }
      const doc = parseHtmlDocument(htmlOrJson);
      const selectorText = doc.select('.alert-danger, .error, .message').map((it) => it.text()).join(' ');
      const trimmed = selectorText.trim();
      if (trimmed !== '') return trimmed;
      const alertMatch = /alert\("([^"]+)"\)/.exec(htmlOrJson);
      return alertMatch?.[1] ?? '登录失败，请检查账号密码或 Cookie';
    } catch (e) {
      return e instanceof Error && e.message !== '' ? e.message : '登录失败';
    }
  }

  override async logout(): Promise<void> {
    await this.deps.credentialStorage.clear();
    this.deps.sessionManager.invalidateSession();
  }

  /** Kotlin `private fun translateException(e: Exception)` (L193-205). */
  private translateException(e: unknown): SourceException {
    const message = e instanceof Error ? e.message : undefined;
    if (e instanceof SourceException) return e;
    if (e instanceof Error) {
      const isIoLike = e.name === 'TypeError' || e.name === 'FetchError' || message !== undefined;
      if (isIoLike) {
        if (
          message?.includes('Cloudflare') === true ||
          message?.includes('403') === true ||
          message?.includes('503') === true
        ) {
          return new NetworkError('该书源需要浏览器验证，请稍后重试');
        }
        return new NetworkError('Z-Library 当前节点不可用，正在寻找可用入口');
      }
    }
    return new NetworkError(`网络连接失败，请检查网络: ${errorMessage(e)}`);
  }

  override async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    try {
      const domain = await this.domainResolver.resolveDomain();
      await this.deps.sessionManager.ensureSessionInitialized(domain);

      // 路径段必须用 %20 而非 +（URLEncoder 会把空格编成 +，多词搜索会失效）
      const encodedKw = javaUrlEncode(keyword).replace(/\+/g, '%20');
      const searchUrl = `https://${domain}/s/${encodedKw}`;

      let response: ZLibraryResponseLike;
      try {
        response = await this.deps.httpClient.get(searchUrl, `https://${domain}/`);
      } catch {
        const fallbackDomain = await this.domainResolver.resolveDomain(true);
        await this.deps.sessionManager.ensureSessionInitialized(fallbackDomain, true);
        const fallbackSearchUrl = `https://${fallbackDomain}/s/${encodedKw}`;
        response = await this.deps.httpClient.get(fallbackSearchUrl, `https://${fallbackDomain}/`);
      }

      let html = response.body;
      this.checkCloudflare(response.code, html);

      // Z-Library 官网搜索服务故障时（/s/ 与 /eapi/book/search 均返回
      // "Search service temporary unavailable!"）直接报错，绝不走 /fulltext/ 兜底：
      // /fulltext/ 会对任何关键词返回同一批推荐书（假结果）。
      if (html.toLowerCase().includes('search service temporary unavailable')) {
        response.close();
        // 官网明确声明搜索故障时，eapi 搜索大概率同样故障，直接给出明确错误
        ZLibraryNetworkLogger.logParserResult('FAILED', 0, 'Z-Library search service unavailable');
        return SourceResult.Error(
          new NetworkError('Z-Library 搜索服务暂时不可用（官网故障），请稍后重试'),
        );
      }

      // 搜索假结果守卫 #1（修复"搜索出40本"）：入口跳转域（zh.101z.by 等）会把
      // /s/{kw} 302 丢路径跳到主页——最终 URL 不在 /s/ 即铁证，强制扫描换真实
      // 镜像重试一次。零结果页仍在 /s/ 路径，不受影响。
      const finalUrl = new URL(response.url);
      if (response.isSuccessful && !finalUrl.pathname.startsWith('/s/')) {
        response.close();
        ZLibraryNetworkLogger.logParserResult(
          'RETRY_FALLBACK',
          0,
          `search redirected off /s/: path=${finalUrl.pathname}`,
        );
        const fallbackDomain = await this.domainResolver.resolveDomain(true);
        await this.deps.sessionManager.ensureSessionInitialized(fallbackDomain, true);
        const retryResponse = await this.deps.httpClient.get(
          `https://${fallbackDomain}/s/${encodedKw}`,
          `https://${fallbackDomain}/`,
        );
        const retryHtml = retryResponse.body;
        const retryFinalUrl = new URL(retryResponse.url);
        const retryRedirected =
          retryResponse.isSuccessful && !retryFinalUrl.pathname.startsWith('/s/');
        if (retryRedirected) {
          retryResponse.close();
          return SourceResult.Error(
            new NetworkError('搜索被重定向（节点为入口跳转域，非真实镜像），请更换节点后重试'),
          );
        }
        response = retryResponse;
        html = retryHtml;
      }

      if (!response.isSuccessful) {
        response.close();
        const finalHost = new URL(response.url).host;
        ZLibraryNetworkLogger.logParserResult('RETRY_EAPI', 0, `HTTP ${response.code}`);
        const eapiBooks = await this.eapiClient.search(keyword, finalHost);
        if (eapiBooks.length > 0) {
          ZLibraryNetworkLogger.logParserResult('SUCCESS_EAPI', eapiBooks.length, 'eapi fallback');
          return SourceResult.Success(eapiBooks);
        }
        // 513/529/500 等 HTTP 层全被挡（eapi 也被挡时返回空）：WebView
        // （Chromium TLS 指纹 + 会话 Cookie）是唯一能进的入口，再兜一次。
        const webBooks = await this.deps.webViewSearch(
          finalHost,
          keyword,
          await this.deps.credentialStorage.getCookies(),
        );
        await this.syncWebViewCookiesToHttp(webBooks.cookies, finalHost);
        if (webBooks.books.length > 0) {
          ZLibraryNetworkLogger.logParserResult('SUCCESS_WEBVIEW', webBooks.books.length, 'HTTP error fallback');
          return SourceResult.Success(webBooks.books);
        }
        return SourceResult.Error(new NetworkError(`搜索请求失败 HTTP ${response.code}`));
      }

      const finalHost = new URL(response.url).host;
      const books = ZLibraryParserManager.parseSearchPage(html, `https://${finalHost}`, this.id);
      // 搜索假结果守卫 #2：页面留在 /s/ 但内容与关键词无关（登录墙后的推荐书
      // 列表等）。只拦"大结果集 + 标题归一化零命中 + 页面无关键词"的形态——
      // 主页充数通常是整页 40 本推荐；作者搜索/繁简变体的合法结果不会同时
      // 满足三条，避免误伤。
      if (books.length >= 15 && !html.toLowerCase().includes(keyword.toLowerCase())) {
        // Kotlin L299-301: `s.lowercase().replace(Regex("""[\s\p{Punct}]+"""), "")`.
        // `\p{Punct}` is the POSIX US-ASCII punctuation class in Java, so `，` `。` `《`
        // (CJK punctuation) are NOT stripped. `\p{P}` in JS is every Unicode `P*` category and
        // therefore removes them — which changes `normTitle` and could flip the "results are
        // irrelevant" verdict. `JAVA_PUNCT_WHITESPACE` below is the ASCII class verbatim.
        const normTitle = (s: string): string =>
          normalizeTitle(s.toLowerCase().replace(JAVA_PUNCT_WHITESPACE, ''));
        const want = normTitle(keyword);
        const anyTitleHit =
          want !== '' &&
          books.some((b) => {
            const n = normTitle(b.title);
            return n !== '' && (n.includes(want) || want.includes(n));
          });
        if (!anyTitleHit) {
          response.close();
          ZLibraryNetworkLogger.logParserResult('RETRY_FALLBACK', books.length, 'results irrelevant to keyword');
          const fallbackDomain = await this.domainResolver.resolveDomain(true);
          await this.deps.sessionManager.ensureSessionInitialized(fallbackDomain, true);
          const retryResponse = await this.deps.httpClient.get(
            `https://${fallbackDomain}/s/${encodedKw}`,
            `https://${fallbackDomain}/`,
          );
          const retryHtml = retryResponse.body;
          const retryFinalUrl = new URL(retryResponse.url);
          const retryBooks =
            retryResponse.isSuccessful &&
            retryFinalUrl.pathname.startsWith('/s/') &&
            retryHtml.toLowerCase().includes(keyword.toLowerCase())
              ? ZLibraryParserManager.parseSearchPage(retryHtml, `https://${retryFinalUrl.host}`, this.id)
              : [];
          retryResponse.close();
          if (retryBooks.length > 0) {
            ZLibraryNetworkLogger.logParserResult('SUCCESS_FALLBACK', retryBooks.length, 'fallback domain retry');
            return SourceResult.Success(retryBooks);
          }
          return SourceResult.Error(
            new NetworkError('搜索结果与关键词无关（节点返回了无关推荐），请更换节点后重试'),
          );
        }
      }
      if (books.length === 0) {
        response.close();
        // 页面含书卡片标记但解析为空：真实"无结果"
        if (
          html.includes('z-bookcard') ||
          html.includes('resItemBox') ||
          html.includes('book-item') ||
          html.includes('/book/')
        ) {
          ZLibraryNetworkLogger.logParserResult('EMPTY', 0, 'no parseable cards');
          // HTML 解析不出结果但页面结构正常：尝试 eapi 兜底，避免新版布局导致全空
          const eapiBooks = await this.eapiClient.search(keyword, finalHost);
          if (eapiBooks.length > 0) {
            ZLibraryNetworkLogger.logParserResult('SUCCESS_EAPI', eapiBooks.length, 'eapi empty fallback');
            return SourceResult.Success(eapiBooks);
          }
          return SourceResult.Success([]);
        }
        // 页面无任何书卡片标记：可能是 JS 渲染或新版挑战，交给 WebView 兜底
        const webBooks = await this.deps.webViewSearch(
          finalHost,
          keyword,
          await this.deps.credentialStorage.getCookies(),
        );
        await this.syncWebViewCookiesToHttp(webBooks.cookies, finalHost);
        if (webBooks.books.length > 0) {
          ZLibraryNetworkLogger.logParserResult('SUCCESS_WEBVIEW', webBooks.books.length, 'HTML empty, WebView fallback');
          return SourceResult.Success(webBooks.books);
        }
        if (webBooks.stillChallenged) {
          ZLibraryNetworkLogger.logParserResult('FAILED', 0, 'captcha challenge');
          return SourceResult.Error(new NetworkError('需要浏览器验证，暂时无法自动搜索'));
        }
        ZLibraryNetworkLogger.logParserResult('EMPTY', 0, 'no results anywhere');
        return SourceResult.Success([]);
      }
      ZLibraryNetworkLogger.logParserResult(
        books.length > 0 ? 'SUCCESS' : 'EMPTY',
        books.length,
      );
      return SourceResult.Success(books);
    } catch (e) {
      if (e instanceof SourceException) {
        const challengeDomain = await this.domainResolver.resolveDomain();
        const webBooks = await this.deps.webViewSearch(
          challengeDomain,
          keyword,
          await this.deps.credentialStorage.getCookies(),
        );
        await this.syncWebViewCookiesToHttp(webBooks.cookies, challengeDomain);
        if (webBooks.books.length > 0) {
          ZLibraryNetworkLogger.logParserResult('SUCCESS_WEBVIEW', webBooks.books.length, 'Challenge fallback');
          return SourceResult.Success(webBooks.books);
        }
        ZLibraryNetworkLogger.logParserResult('FAILED', 0, e.message);
        return SourceResult.Error(e);
      }
      const challengeDomain = await this.domainResolver.resolveDomain();
      const webBooks = await this.deps.webViewSearch(
        challengeDomain,
        keyword,
        await this.deps.credentialStorage.getCookies(),
      );
      await this.syncWebViewCookiesToHttp(webBooks.cookies, challengeDomain);
      if (webBooks.books.length > 0) {
        ZLibraryNetworkLogger.logParserResult('SUCCESS_WEBVIEW', webBooks.books.length, 'Exception fallback');
        return SourceResult.Success(webBooks.books);
      }
      const translated = this.translateException(e);
      ZLibraryNetworkLogger.logParserResult('FAILED', 0, translated.message);
      return SourceResult.Error(translated);
    }
  }

  override async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    try {
      const domain = await this.domainResolver.resolveDomain();
      await this.deps.sessionManager.ensureSessionInitialized(domain);

      const cleanBookId = trimStartSlash(bookId);
      const detailUrl = cleanBookId.startsWith('http') ? cleanBookId : `https://${domain}/${cleanBookId}`;

      let response: ZLibraryResponseLike;
      try {
        response = await this.deps.httpClient.get(detailUrl, `https://${domain}/`);
      } catch {
        const fallbackDomain = await this.domainResolver.resolveDomain(true);
        await this.deps.sessionManager.ensureSessionInitialized(fallbackDomain, true);
        const fallbackDetailUrl = cleanBookId.startsWith('http')
          ? cleanBookId
          : `https://${fallbackDomain}/${cleanBookId}`;
        response = await this.deps.httpClient.get(fallbackDetailUrl, `https://${fallbackDomain}/`);
      }

      const html = response.body;
      this.checkCloudflare(response.code, html);

      if (!response.isSuccessful) {
        // 兜底：HTML 详情页失败时尝试 eapi 书信息
        const key = await this.resolveEapiBookKey(domain, bookId);
        const eapiBook =
          key === null
            ? null
            : await this.eapiClient
                .getBookInfo(key[0], key[1], domain)
                .catch(() => null);
        if (eapiBook !== null) {
          return SourceResult.Success(eapiBook);
        }
        return SourceResult.Error(new NetworkError(`获取详情失败 HTTP ${response.code}`));
      }

      const parsed = ZLibraryParserManager.parseDetailPage(html, `https://${new URL(response.url).host}`);

      const novelInfo = this.deps.novelMetadata(html);

      const sourceBook = createSearchBook({
        id: bookId,
        sourceId: this.id,
        title: parsed.title,
        author: parsed.author,
        cover: parsed.cover,
        format: parsed.format,
        description: novelInfo.synopsis,
        novelInfo,
        downloadUrl: parsed.downloadUrl,
      });
      // 新版详情页可能解析不到 /dl/ 链接：用 eapi 书信息的 dl 字段补全
      // （该 /dl/ 直链已实测：解 DiamWall 后返回真实 EPUB 文件）
      if (sourceBook.downloadUrl === null || sourceBook.downloadUrl.trim() === '') {
        const eapiBook = await this.eapiBookForDetail(domain, bookId);
        if (eapiBook !== null) {
          return SourceResult.Success({
            ...eapiBook,
            description: eapiBook.description ?? sourceBook.description,
            novelInfo: eapiBook.novelInfo ?? sourceBook.novelInfo,
          });
        }
      }
      return SourceResult.Success(sourceBook);
    } catch (e) {
      // 兜底：HTML 详情异常时尝试 eapi
      if (e instanceof SourceException) {
        const eapiBook = await this.eapiBookForDetail(
          await this.domainResolver.resolveDomain(),
          bookId,
        );
        return eapiBook !== null ? SourceResult.Success(eapiBook) : SourceResult.Error(e);
      }
      const translated = this.translateException(e);
      const eapiBook = await this.eapiBookForDetail(
        await this.domainResolver.resolveDomain(),
        bookId,
      );
      return eapiBook !== null ? SourceResult.Success(eapiBook) : SourceResult.Error(translated);
    }
  }

  override async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return this.getDownloadInfoWithFormat(bookId, null);
  }

  /** The `runCatching { resolveEapiBookKey(…).let { eapiClient.getBookInfo(…) } }.getOrNull()` helper. */
  private async eapiBookForDetail(domain: string, bookId: string): Promise<SearchBook | null> {
    try {
      const key = await this.resolveEapiBookKey(domain, bookId);
      if (key === null) return null;
      return await this.eapiClient.getBookInfo(key[0], key[1], domain);
    } catch {
      return null;
    }
  }

  /**
   * 多格式下载：按用户选择的路由到对应格式的直链。
   * - 默认格式（HTML 详情页主直链）直接走 /dl/；
   * - 其他格式通过 eapi（bipinkrish 方案）的 formats -> file 链路获取。
   */
  override async getDownloadInfoWithFormat(
    bookId: string,
    preferredFormat: string | null = null,
  ): Promise<SourceResultType<DownloadInfo>> {
    if (!(await this.isLoggedIn())) {
      return SourceResult.Error(new LoginRequired());
    }

    try {
      const domain = await this.domainResolver.resolveDomain();

      // 前置拦截：今日下载额度已用尽时直接提示，避免白白走下载+校验流程
      // （新站 /dl/ 在额度用尽时会返回 HTML 限额页，旧逻辑会误报“HTML 错误页”）
      const limitInfo = await this.eapiClient.getDailyDownloadLimit(domain);
      if (limitInfo !== null && limitInfo[0] >= limitInfo[1]) {
        return SourceResult.Error(
          new NetworkError(
            `今日下载次数已达上限（${limitInfo[0]}/${limitInfo[1]}），请等待额度重置或提升额度`,
          ),
        );
      }

      const detailResult = await this.getDetail(bookId);
      if (detailResult.kind === 'error') {
        return SourceResult.Error(detailResult.exception);
      }

      const book = detailResult.data;
      const dlUrl = book.downloadUrl;

      const cleanTitle = book.title.replace(/[\\/:*?"<>|]/g, '_');
      // 页面解析格式可能缺/错（旧版页面默认 epub），优先按下载链接真实后缀推断
      const defaultFormat =
        guessFileFormatFromUrl(dlUrl) ??
        (book.format.trim() === '' ? 'epub' : book.format.toLowerCase());
      const wantFormat =
        preferredFormat === null || preferredFormat === undefined
          ? null
          : (preferredFormat.toLowerCase().trim() || null);
      const effectiveWant =
        wantFormat !== null && wantFormat !== '' && wantFormat !== defaultFormat ? wantFormat : null;

      const cookieHeader = (await this.deps.credentialStorage.getCookies()) ?? '';

      // 用户手动选择的非默认格式：走 eapi formats -> 变体 file 链路（多格式下载）
      if (effectiveWant !== null) {
        const key =
          book.eapiId !== null && book.eapiId.trim() !== '' && book.eapiHash !== null && book.eapiHash.trim() !== ''
            ? ([book.eapiId, book.eapiHash] as [string, string])
            : await this.resolveEapiBookKey(domain, bookId);
        if (key !== null) {
          const variants = await this.eapiClient.getFormats(key[0], key[1], domain);
          const variant = variants.find((it) => it.format === effectiveWant);
          const variantKey =
            variant !== undefined && variant.eapiId !== null && variant.eapiHash !== null
              ? ([variant.eapiId, variant.eapiHash] as [string, string])
              : null;
          if (variantKey !== null) {
            const linkResult = await this.eapiClient.getDownloadLinkResult(
              variantKey[0],
              variantKey[1],
              domain,
            );
            if (linkResult.url !== null && linkResult.url.trim() !== '') {
              return SourceResult.Success(
                createDownloadInfo({
                  url: linkResult.url,
                  fileName: `${cleanTitle}.${effectiveWant}`,
                  format: effectiveWant,
                  size: variant?.size ?? null,
                  referer: `https://${domain}/`,
                  headers: { Cookie: cookieHeader },
                }),
              );
            }
            if (linkResult.disallowMessage !== null && linkResult.disallowMessage.trim() !== '') {
              return SourceResult.Error(
                new NetworkError(`${effectiveWant} 下载被限制：${linkResult.disallowMessage}`),
              );
            }
          }
        }
        return SourceResult.Error(
          new NetworkError(`无法获取 ${effectiveWant} 格式（官网搜索服务暂不可用时可先下载默认格式）`),
        );
      }

      // 默认格式：优先 eapi CDN 直链（真实文件，不经过 /dl/ HTML 中转页；
      // 部分节点如 zlib.bz 的 /dl/ 会返回 HTML 下载页而不是文件本身）。
      // eapi 失败/不可用时再回退详情页 /dl/ 链接 + 会话 Cookie
      // （/dl/ 会先返回 DiamWall 503 挑战页，DownloadWorker 的 DiamWallInterceptor
      // 会自动解 PoW 后重试）。
      const detailUrl = `https://${domain}/${trimStartSlash(bookId)}`;
      const eapiLink = await this.eapiDownloadLink(domain, bookId, book);
      if (
        (eapiLink === null || eapiLink.url === null || eapiLink.url.trim() === '') &&
        eapiLink !== null &&
        eapiLink.disallowMessage !== null &&
        eapiLink.disallowMessage.trim() !== ''
      ) {
        // 每日额度用尽等明确限制：直接提示，避免白白走 /dl/ 后报“HTML 错误页”
        return SourceResult.Error(new NetworkError(eapiLink.disallowMessage as string));
      }
      const finalUrl = eapiLink?.url ?? dlUrl;
      if (finalUrl === null || finalUrl.trim() === '') {
        return SourceResult.Error(new ParseError('未获取到下载链接，请稍后重试或切换节点'));
      }
      return SourceResult.Success(
        createDownloadInfo({
          url: finalUrl,
          fileName: `${cleanTitle}.${defaultFormat}`,
          format: defaultFormat,
          referer: detailUrl,
          headers: { Cookie: cookieHeader },
        }),
      );
    } catch (e) {
      if (e instanceof SourceException) {
        return SourceResult.Error(e);
      }
      return SourceResult.Error(new NetworkError(`获取下载链接失败: ${errorMessage(e)}`));
    }
  }

  /** The `runCatching { … }.getOrNull()` block at L598-605. */
  private async eapiDownloadLink(
    domain: string,
    bookId: string,
    book: SearchBook,
  ): Promise<{ url: string | null; disallowMessage: string | null } | null> {
    try {
      const key =
        book.eapiId !== null && book.eapiId.trim() !== '' && book.eapiHash !== null && book.eapiHash.trim() !== ''
          ? ([book.eapiId, book.eapiHash] as [string, string])
          : await this.resolveEapiBookKey(domain, bookId);
      if (key === null) return null;
      return await this.eapiClient.getDownloadLinkResult(key[0], key[1], domain);
    } catch {
      return null;
    }
  }

  /**
   * 可用格式列表：
   * 1. eapi 元数据已知时（eapi 兜底搜索产生的结果）直接查 formats 接口（权威、带大小）；
   * 2. 否则抓 HTML 详情页拿默认格式；
   * 3. 尽力通过 eapi 搜索书名解析出 eapi id/hash 后补全多格式。
   */
  override async getAvailableFormats(book: SearchBook): Promise<SourceResultType<BookFormat[]>> {
    try {
      const domain = await this.domainResolver.resolveDomain();
      await this.deps.sessionManager.ensureSessionInitialized(domain);

      const merged = new Map<string, BookFormat>();

      // 1) eapi 元数据已知 -> formats 接口
      if (book.eapiId !== null && book.eapiId.trim() !== '' && book.eapiHash !== null && book.eapiHash.trim() !== '') {
        for (const it of await this.eapiClient.getFormats(book.eapiId, book.eapiHash, domain)) {
          merged.set(it.format, it);
        }
      }

      // 2) HTML 详情页默认格式
      const detail = await this.getDetail(book.id).catch(() => null);
      const detailBook = detail !== null && detail.kind === 'success' ? detail.data : null;
      if (detailBook !== null) {
        const defaultFormat =
          guessFileFormatFromUrl(detailBook.downloadUrl) ??
          (detailBook.format.trim() === '' ? 'epub' : detailBook.format.toLowerCase());
        if (defaultFormat !== '' && !merged.has(defaultFormat)) {
          merged.set(
            defaultFormat,
            createBookFormat({ format: defaultFormat, downloadUrl: detailBook.downloadUrl }),
          );
        }
      }

      // 3) 尽力解析 eapi key 补全多格式（需要官网搜索可用）
      if (merged.size === 0 || book.eapiId === null || book.eapiId.trim() === '') {
        const key = await this.resolveEapiBookKey(domain, book.id);
        if (key !== null) {
          for (const it of await this.eapiClient.getFormats(key[0], key[1], domain)) {
            merged.set(it.format, it);
          }
        }
      }

      if (merged.size === 0) {
        return SourceResult.Success([]);
      }
      return SourceResult.Success(Array.from(merged.values()));
    } catch (e) {
      return SourceResult.Error(new NetworkError(`获取格式列表失败: ${errorMessage(e)}`));
    }
  }

  /**
   * 解析一本书的 eapi (id, hash)：
   * 详情页有 data-book_id（数字 id），再用 eapi 搜索书名匹配同 id 的书拿到短 hash。
   */
  private async resolveEapiBookKey(domain: string, bookId: string): Promise<[string, string] | null> {
    try {
      const cleanBookId = trimStartSlash(bookId);
      const detailUrl = cleanBookId.startsWith('http') ? cleanBookId : `https://${domain}/${cleanBookId}`;
      const response = await this.deps.httpClient.get(detailUrl, `https://${domain}/`);
      const html = response.body;
      response.close();
      const numericId = /data-book_id="(\d+)"/.exec(html)?.[1];
      if (numericId === undefined || numericId === null) return null;

      const titleEl = parseHtmlDocument(html).selectFirst('h1');
      const title = titleEl !== null ? titleEl.text().trim() : null;
      if (title === null || title.trim() === '') return null;

      const books = await this.eapiClient.search(title, domain);
      const hit = books.find((it) => it.eapiId === numericId);
      const eid = hit?.eapiId ?? null;
      const ehash = hit?.eapiHash ?? null;
      if (eid === null || eid.trim() === '' || ehash === null || ehash.trim() === '') return null;
      return [eid, ehash];
    } catch {
      return null;
    }
  }

  /**
   * 把 eapi/rpc 登录得到的会话 Cookie 同步到 WebView CookieManager，
   * 供自研 WebView 下载方案（/dl/ 页面）直接使用。
   */
  async syncCookiesToWebView(domain?: string): Promise<void> {
    const cookies = await this.deps.credentialStorage.getCookies();
    if (cookies === null) return;
    const target = domain ?? (await this.deps.credentialStorage.getDomain());
    const store = this.deps.webViewCookies;
    if (store === null) return;
    try {
      store.setAcceptCookie(true);
      for (const cookie of cookies.split(';')) {
        if (cookie.includes('=')) store.setCookie(`https://${target}/`, `${cookie.trim()}; Path=/; Secure`);
      }
      store.flush();
    } catch {
      // Kotlin `runCatching { … }`
    }
  }

  /**
   * WebView 兜底过完 DiamWall 挑战后，把 WebView 侧的完整 Cookie
   * （dwid / c_token / __diamwall / remix_*）回灌进 OkHttp 的 CookieJar，
   * 后续详情页与下载请求全程免挑战（2026-09-04 1lib.sk 实测）。
   */
  private async syncWebViewCookiesToHttp(cookies: string | null, domain: string): Promise<void> {
    if (cookies === null || cookies.trim() === '' || domain.trim() === '') return;
    try {
      await this.deps.cookieJar.syncFromRawCookieString(cookies, domain);
    } catch (e) {
      SourceLog.log('ZLibSource', `sync WebView cookies failed: ${errorMessage(e)}`);
    }
  }

  /** Kotlin `runCatching { ZLibraryNodeConfig.domain }.getOrDefault("")`. */
  private readNodeDomain(): string {
    return this.readNodeDomainOrNull() ?? '';
  }

  /** Kotlin `runCatching { ZLibraryNodeConfig.domain }.getOrNull()`. */
  private readNodeDomainOrNull(): string | null {
    try {
      return this.deps.nodeConfig.nodeDomain();
    } catch {
      return null;
    }
  }
}

/** Kotlin `withTimeoutOrNull(8000)` (L116/L173). */
const LOGIN_CANDIDATE_TIMEOUT_MS = 8000;
/** Kotlin `reachable.drop(1).take(9)` (L105). */
const LOGIN_CANDIDATE_POOL = 9;
/** Kotlin `.distinct().take(4)` (L111/L112). */
const MAX_LOGIN_CANDIDATES = 4;

/**
 * Kotlin L300 `Regex("""[\s\p{Punct}]+""")`, verbatim.
 *
 * Java's `\p{Punct}` is the POSIX US-ASCII punctuation class `[!-/:-@[-`{-~]`; JS's `\p{P}` is
 * every Unicode `P*` category, so it additionally strips CJK/fullwidth punctuation. The class
 * is written out as the four ASCII ranges so the title comparison cannot change verdict on
 * Chinese book titles.
 */
export const JAVA_PUNCT_WHITESPACE = /[\s!-/:-@[-`{-~]+/g;

/** Kotlin `String.trimStart('/')`. */
function trimStartSlash(value: string): string {
  let out = value;
  while (out.startsWith('/')) out = out.slice(1);
  return out;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Kotlin `withTimeoutOrNull(ms) { … }` → null when the deadline passes. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Re-exported so the platform layer can wire the WebView fallback without a deep import. */
export { ZLibraryWebViewHelper };

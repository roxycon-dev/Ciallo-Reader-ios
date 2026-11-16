/**
 * Android source: `com.example.source.impl.AliceSwSource.kt`（257 行）→ 本文件。
 *
 * 爱丽丝书屋（alicesw.com）—— 成人向免费小说创作站，章节式在线正文，作品页免登录。
 * 站点同时运营多条线路，墙内可达性不一样，所以选路交给 `AliceSwEndpoints`：
 * 并行探活 → 首个真实站点线路入选 → 失败线路冷却。
 * 该源没有整本文件可下，整本下载走 `./aliceSwEpub`：逐章抓正文在本地打包 EPUB，
 * 任一章失败即整体作废（与书阁同一套约定）。
 *
 * 行号映射（Kotlin → TS）：
 *   L41-L62  类头 / id / name / capabilities / http client → class AliceSwSource + options
 *   L64-L67  catalogMutex / catalogCache                   → catalogMutex / catalogCache
 *   L69-L74  search()                                      → search()
 *   L76-L81  getDetail() / refreshNovelDetail()            → getDetail() / refreshNovelDetail()
 *   L83-L103 discoverCatalog() / discover()                → discoverCatalog() / discover()
 *   L105-L115 catalogFor()                                 → catalogFor()
 *   L117-L120 getChapters()                                → getChapters()
 *   L122-L125 getChapterText()                             → getChapterText()
 *   L127-L128 getChapterImages()                           → getChapterImages()
 *   L130-L145 getDownloadInfo()                            → getDownloadInfo()
 *   L147-L151 getShareUrl()                                → getShareUrl()
 *   L153-L161 login / logout / isLoggedIn / auth state     → 同名方法
 *   L163-L164 baseUrlOrThrow()                             → baseUrlOrThrow()
 *   L166-L189 fetch()                                      → fetch()
 *   L191-L198 absoluteUrl()                                → absoluteUrl()
 *   L200-L224 request()                                    → request()
 *   L226-L239 result()                                     → result()
 *   L241-L244 requireBookId()                              → requireBookId()
 *   L246-L256 companion（SOURCE_ID / EPUB_MARKER / TTL / USER_AGENT） → 模块级常量
 *
 * 未移植项 / 有意替换：
 *  - OkHttp client（connect 12s / read 25s / call 45s）→ 注入的 `HttpClient` 端口；端口只有一个
 *    `timeoutMs`，取 callTimeout 45s（读/连超时由平台层实现，Kotlin 三个值都列在文件头备查）。
 *  - `withContext(Dispatchers.IO)` / `CancellationException` → `AbortSignal` + `AbortError`；
 *    `result()` 与 `fetch()` 都先识别 abort 再走 Kotlin 的其余 catch 分支。
 *  - `java.io.IOException("爱丽丝书屋返回空页面")` → `SourceNetworkError`（`sourceHttp` 约定的
 *    IOException 替身），因此 `result()` 能像 Kotlin 一样把它翻成「连接失败」。
 *  - `SourceResponse.problem(html)` → 复用 `guestNovelTransport.sourceResponseProblem`（同一份
 *    Kotlin `SourceResponse.problem` 逐字移植，含「源站返回空响应，请稍后重试」）。
 *  - Kotlin 未覆写 `getCoverHeaders`（封面请求头走全局限流加载器），这里同样不覆写；
 *    `getDownloadInfo` 的 `referer` 仍是 `"$base/"`。
 *  - `AliceSwEndpoints` 的构造依赖（SharedPreferences / 独立 probe client）见该文件头。
 */

import type { HttpClient } from '@platform/interfaces';
import { discoverPage, type DiscoverCatalog, type DiscoverPage, type DiscoverQuery } from '@core/discover/models';
import { AuthenticationState } from '../authenticationState';
import { ComicSource } from '../comicSource';
import type { ComicChapter } from '../comicChapter';
import { createDownloadInfo, type DownloadInfo } from '../downloadInfo';
import { validDetailLink } from '../detailLink';
import type { LoginCredential } from '../loginCredential';
import type { UpdatableNovelSource } from '../novelInfo';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import { BookNotFound, NetworkError, ParseError, SourceException } from '../sourceException';
import { SourceResult, type SourceResult as Result } from '../sourceResult';
import { AliceSwDiscover } from './aliceSwDiscover';
import {
  ALICE_SW_USER_AGENT,
  AliceSwEndpoints,
  type AliceSwEndpointTimings,
  type AliceSwRouteCache,
} from './aliceSwEndpoints';
import { AliceSwParser } from './aliceSwParser';
import { sourceResponseProblem } from './guestNovelTransport';
import {
  AsyncMutex,
  SourceNetworkError,
  decodeUtf8,
  executeSourceRequest,
  formUrlEncode,
  isSuccessful,
} from './sourceHttp';

export const ALICE_SW_SOURCE_ID = 'alicesw';
export const ALICE_SW_EPUB_MARKER = 'ciallo-alicesw-epub-v1';

/** Kotlin `CATALOG_TTL_MS`：10 分钟内复用首页导航，避免每次切栏目都重拉首页。 */
const CATALOG_TTL_MS = 10 * 60 * 1000;
/** Kotlin `callTimeout(45, TimeUnit.SECONDS)`。 */
const REQUEST_TIMEOUT_MS = 45_000;
/** Kotlin `readImportBytes(8 * 1024 * 1024)`。 */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export interface AliceSwSourceOptions {
  client: HttpClient;
  /** Kotlin 构造参数 `endpoints = AliceSwEndpoints(context)` 的注入版。 */
  endpoints?: AliceSwEndpoints;
  routeCache?: AliceSwRouteCache;
  timings?: AliceSwEndpointTimings;
}

export class AliceSwSource extends ComicSource implements UpdatableNovelSource {
  readonly id = ALICE_SW_SOURCE_ID;
  readonly name = '爱丽丝书屋';

  // 纯文字站：在线阅读与整本 EPUB 打包都可用，没有图片章节，不参与漫画分类。
  readonly capabilities = createSourceCapabilities({
    supportSearch: true,
    supportDownload: true,
    supportEbook: true,
    supportOnlineText: true,
  });

  private readonly http: HttpClient;
  private readonly endpoints: AliceSwEndpoints;
  private readonly catalogMutex = new AsyncMutex();
  private catalogCache: { base: string; catalog: DiscoverCatalog } | null = null;
  private catalogFetchedAt = 0;

  constructor(options: AliceSwSourceOptions) {
    super();
    this.http = options.client;
    this.endpoints =
      options.endpoints ??
      new AliceSwEndpoints({
        client: options.client,
        ...(options.routeCache !== undefined ? { cache: options.routeCache } : {}),
        ...(options.timings !== undefined ? { timings: options.timings } : {}),
      });
  }

  override async search(keyword: string, signal?: AbortSignal): Promise<Result<SearchBook[]>> {
    return this.result(async () => {
      const query = keyword.trim();
      if (query === '') return [];
      // Kotlin `URLEncoder.encode(query, "UTF-8").replace("+", "%20")`。
      const encoded = formUrlEncode(query).replace(/\+/g, '%20');
      return AliceSwParser.books(await this.fetch(`/search?q=${encoded}`, signal), this.id);
    });
  }

  override async getDetail(bookId: string): Promise<Result<SearchBook>> {
    return this.result(async () => {
      const id = requireBookId(bookId);
      return AliceSwParser.detail(await this.fetch(`/novel/${id}.html`), id, this.id);
    });
  }

  async refreshNovelDetail(bookId: string): Promise<Result<SearchBook>> {
    return this.getDetail(bookId);
  }

  override async discoverCatalog(
    _resolveDynamic = false,
    signal?: AbortSignal,
  ): Promise<Result<DiscoverCatalog>> {
    return this.result(async () => this.catalogFor(await this.baseUrlOrThrow(signal), true, signal));
  }

  override async discover(query: DiscoverQuery, signal?: AbortSignal): Promise<Result<DiscoverPage>> {
    return this.result(async () => {
      const base = await this.baseUrlOrThrow(signal);
      const catalog = await this.catalogFor(base, false, signal);
      const target = AliceSwDiscover.route(base, catalog, query);
      if (target === null) return AliceSwDiscover.notice();
      const html = await this.fetch(target, signal);
      const ranked = AliceSwDiscover.isRanked(query);
      const entries = AliceSwDiscover.entries(html, this.id, ranked, query.offset);
      const next = ranked ? null : AliceSwDiscover.nextPage(html, target);
      return discoverPage({
        entries,
        hasMore: next !== null,
        nextCursor: next,
        catalog,
        native: true,
        notice: entries.length === 0 ? '源站没有返回这个栏目的作品' : null,
      });
    });
  }

  /** 分类/排行入口来自首页导航；10 分钟内复用，避免每次切栏目都重拉首页。 */
  private catalogFor(
    base: string,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<DiscoverCatalog> {
    return this.catalogMutex.withLock(async () => {
      const cached = this.catalogCache;
      if (
        !force &&
        cached !== null &&
        cached.base === base &&
        Date.now() - this.catalogFetchedAt < CATALOG_TTL_MS
      ) {
        return cached.catalog;
      }
      const catalog = AliceSwDiscover.catalog(await this.fetch('/', signal), base);
      this.catalogCache = { base, catalog };
      this.catalogFetchedAt = Date.now();
      return catalog;
    });
  }

  override async getChapters(bookId: string): Promise<Result<ComicChapter[]>> {
    return this.result(async () => {
      const id = requireBookId(bookId);
      return AliceSwParser.chapters(await this.fetch(`/other/chapters/id/${id}.html`), this.id);
    });
  }

  override async getChapterText(chapterId: string): Promise<Result<string>> {
    return this.result(async () => {
      const parsed = AliceSwParser.parseChapterId(chapterId);
      return AliceSwParser.chapterText(await this.fetch(`/book/${parsed.bookKey}/${parsed.hash}.html`));
    });
  }

  override async getChapterImages(_chapterId: string): Promise<Result<string[]>> {
    return SourceResult.Error(new ParseError('爱丽丝书屋是文字小说源，请使用小说阅读器'));
  }

  /** 站点没有整本文件：返回带标记的地址，由下载器逐章抓取后在本地打包 EPUB。 */
  override async getDownloadInfo(bookId: string): Promise<Result<DownloadInfo>> {
    return this.result(async () => {
      const id = requireBookId(bookId);
      const base = await this.baseUrlOrThrow();
      const detail = await this.getDetail(id);
      const title = detail.kind === 'success' ? detail.data.title : id;
      const fileName = title.replace(/[\\/:*?"<>|]/g, '_').trim() || id;
      return createDownloadInfo({
        url: `${base}/novel/${id}.html#${ALICE_SW_EPUB_MARKER}`,
        fileName: `${fileName}.epub`,
        format: 'epub',
        referer: `${base}/`,
      });
    });
  }

  override async getShareUrl(bookId: string): Promise<string | null> {
    if (!AliceSwParser.isBookId(bookId)) return null;
    let base = this.endpoints.currentBase();
    if (base === null) {
      // Kotlin `runCatching { endpoints.baseUrl() }.getOrNull()`。
      try {
        base = await this.endpoints.baseUrl();
      } catch {
        base = null;
      }
    }
    if (base === null) return null;
    return validDetailLink(`${base}/novel/${bookId}.html`);
  }

  override async login(_credential: LoginCredential): Promise<Result<boolean>> {
    return SourceResult.Success(true);
  }

  override async logout(): Promise<void> {
    // Kotlin `override suspend fun logout() = Unit`。
  }

  override async isLoggedIn(): Promise<boolean> {
    return true;
  }

  override async getAuthenticationState(): Promise<AuthenticationState> {
    return AuthenticationState.NotRequired;
  }

  private async baseUrlOrThrow(signal?: AbortSignal): Promise<string> {
    const base = await this.endpoints.baseUrl(false, signal);
    if (base === null) throw new NetworkError('爱丽丝书屋当前所有线路都无法连接，请稍后重试');
    return base;
  }

  /**
   * 带线路切换的页面抓取：失败一次就换下一条线路重试一次。
   * 404 与解析失败不重试——换线路不会让不存在的章节变成存在。
   */
  private async fetch(target: string, signal?: AbortSignal): Promise<string> {
    let last: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const base = await this.endpoints.baseUrl(attempt > 0, signal);
      if (base === null) throw new NetworkError('爱丽丝书屋当前所有线路都无法连接，请稍后重试');
      try {
        return await this.request(this.absoluteUrl(base, target), base, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof BookNotFound) throw error;
        if (error instanceof ParseError) throw error;
        last = error;
        this.endpoints.reportFailure(base);
      }
    }
    throw new NetworkError('爱丽丝书屋连接失败，请稍后重试', last);
  }

  /** 续页游标可能来自已失效的旧线路：只保留路径与查询参数，拉到当前线路上。 */
  private absoluteUrl(base: string, target: string): string {
    if (!target.startsWith('http')) return base + target;
    let here: URL;
    try {
      here = new URL(base);
    } catch {
      return target;
    }
    let wanted: URL;
    try {
      wanted = new URL(target);
    } catch {
      return target;
    }
    if (wanted.host === here.host) return target;
    return base + wanted.pathname + wanted.search;
  }

  private async request(url: string, base: string, signal?: AbortSignal): Promise<string> {
    const target = new URL(url);
    const response = await executeSourceRequest(this.http, url, {
      headers: {
        'User-Agent': ALICE_SW_USER_AGENT,
        Accept: ACCEPT_HTML,
        'Accept-Language': ACCEPT_LANGUAGE,
        Referer: `${base}/`,
      },
      maxBytes: MAX_HTML_BYTES,
      timeoutMs: REQUEST_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) throw new BookNotFound();
    if (!isSuccessful(response)) throw new NetworkError(`爱丽丝书屋返回 HTTP ${response.status}`);
    const final = new URL(response.url !== '' ? response.url : url);
    if (final.host !== target.host) throw new NetworkError('爱丽丝书屋跳转到了站外地址');
    const body = response.body as Uint8Array | undefined;
    if (body === undefined) throw new SourceNetworkError('爱丽丝书屋返回空页面');
    const html = decodeUtf8(body);
    const problem = sourceResponseProblem(html);
    if (problem !== null) throw new ParseError(problem);
    return html;
  }

  private async result<T>(block: () => Promise<T>): Promise<Result<T>> {
    try {
      return SourceResult.Success(await block());
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof SourceException) return SourceResult.Error(error);
      if (error instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError('爱丽丝书屋连接失败，请稍后重试', error));
      }
      return SourceResult.Error(
        new ParseError(error instanceof Error ? error.message : '爱丽丝书屋页面解析失败'),
      );
    }
  }
}

function requireBookId(bookId: string): string {
  if (!AliceSwParser.isBookId(bookId)) throw new ParseError('爱丽丝书屋作品标识无效');
  return bookId;
}

/**
 * Android `com.example.source.impl.MangaDexSource.kt` (838 lines, 799 non-blank)
 * → `src/core/source/impl/mangaDexSource.ts`.
 *
 * Kotlin class KDoc (lines 29-37), verbatim:
 * ```
 * MangaDex comic source backed by the mangadex.live mirror.
 *
 * The official MangaDex API is blocked on many mainland networks and many
 * chapters are "external" without hosted images. mangadex.live mirrors the
 * full catalog with direct CDN image URLs (t.imoutcl.sbs), which is reachable
 * from the phone, and every chapter has readable pages - including chapters
 * that are external on the official API.
 * ```
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-28     package/imports                        → header + imports
 *   29-37    class KDoc                             → header block (verbatim)
 *   38-45    class + client + JsSourceProxy         → ctor + injected client
 *   47-54    id/name/capabilities                   → fields
 *   56-70    companion (TAG/BASE/REFERER/OFFICIAL_API/UA/defaultClient) → consts
 *   72-129   search()                               → search()
 *   131-132  normalizeTitle()                       → normalizeTitle()
 *   134-162  searchMirror()                         → searchMirror()
 *   164-262  searchOfficialApi()                    → searchOfficialApi()
  *   264-269  officialText()
  *   271-277  officialCreators()
  *   279-299  officialInfo()
 *   301-302  officialUuid()                         → officialUuid()
 *   304-310  officialTitleCache / mirrorToOfficialCache / mirrorSlugCache → LruCache(64/64/32)
 *   312-337  mirrorSlugFor()                        → mirrorSlugFor()
 *   339-349  apiGet()                               → apiGet()
 *   351-365  officialChapterImages()                → officialChapterImages()
 *   367-378  officialImagesAvailable()              → officialImagesAvailable()
 *   380-432  mirrorFallbackImages()                 → mirrorFallbackImages()
 *   434-516  getDetail()                            → getDetail()
 *   518-657  getChapters()                          → getChapters()
 *   659-725  getChapterImages()                     → getChapterImages()
 *   727-728  getDownloadInfo()                      → getDownloadInfo()
 *   730-743  getChapterImageHeaders()               → getChapterImageHeaders()
 *   745-753  login / logout / isLoggedIn / getAuthenticationState → same
 *   755-776  collectItems()                         → collectItems()
 *   778-798  parseJsonLdAuthor()                    → parseJsonLdAuthor()
 *   800-818  languageLabel()                        → languageLabel()
 *   820-839  getHtml()                              → getHtml()
 *
 * Skipped lines / adaptations:
 *   - `android.util.Log.i / Log.e(TAG, …)` → `logInfo` / `logError` writing
 *     through `SourceLog` (the same debug-log surface `JsonBookSource` uses);
 *     `Log.e(tag, msg, e)` keeps `msg: e.message`.
 *   - `async { … }` + `await()` (lines 81-85) → both requests are started
 *     before either is awaited, so the two paths stay concurrent.
 *   - `runCatching { … }` → `runCatching` / `runCatchingAsync` shims returning an
 *     `{ok, value, error}` box, preserving `isFailure` / `exceptionOrNull()`.
 *   - `synchronized(cache)` → dropped. JS is single-threaded and every access is
 *     synchronous, so the LinkedHashMap insertion order (and the eviction of
 *     `keys.first()`) is unchanged; the caches become `LruCache(64/64/32)`.
 *   - `response.peekBody(64).bytes().isNotEmpty()` → a `Range: bytes=0-63`
 *     request plus a byte-length check on the returned body.
 *   - `java.net.URI(url).host?.lowercase()` → `hostOf()`.
 *   - OkHttp `Call.execute()` is blocking in Kotlin but `fetch` is not, so every
 *     former-blocking helper (`getHtml`, `apiGet`, `searchMirror`,
 *     `searchOfficialApi`, `mirrorSlugFor`) became `async`; call order and
 *     short-circuit conditions are unchanged.
 *   - `withContext(Dispatchers.IO)` dropped (JS has no thread switch).
 *   - `getDetail`/`getChapters` recurse (lines 486 / 604). The Kotlin recursion
 *     is direct; in TS the recursion is moved into private `…Locked` helpers so
 *     the mirror-fallback re-entry does not re-acquire the serialising mutex.
 *   - `MangaDexSource.kt` reads every body with `response.body?.string()` (L189 /
 *     L351 / L841) — **no** `readImportBytes` ceiling — so its requests pass
 *     `maxBytes: MANGA_DEX_BODY_BYTES` (unbounded) instead of the shared 2 MiB
 *     default; the `peekBody(64)` probe at L379 keeps its 64-byte ceiling.
 *   - `catch (e: IOException)` (L126 / L513 / L654 / L722) → the `SourceNetworkError`
 *     arm in front of the final `catch (e: Exception)` → `Unknown("未知错误: …")`
 *     arm; the Kotlin log strings ("search io error:" vs "search unexpected:") are
 *     kept per arm.
 *   - `Log.e(TAG, msg, e)` logs `msg` only (the throwable goes to logcat's stack
 *     trace), so `logError` writes just its first argument.
 */

import { AuthenticationState } from '../authenticationState';
import { ComicSource } from '../comicSource';
import { createComicChapter } from '../comicChapter';
import type { ComicChapter } from '../comicChapter';
import { createComicInfo } from '../comicInfo';
import type { ComicInfo } from '../comicInfo';
import type { DownloadInfo } from '../downloadInfo';
import type { LoginCredential } from '../loginCredential';
import { SourceLog } from '../sourceLog';
import { createSearchBook } from '../searchBook';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import type { SourceCapabilities } from '../sourceCapabilities';
import { NetworkError, ParseError, SourceException, Unknown } from '../sourceException';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { parseHtmlDocument } from './jsoup';
import type { HtmlDocument, HtmlElement } from './jsoup';
import {
  arrayOptJsonObject,
  arrayOptString,
  firstNotNullOfOrNull,
  isJsonArray,
  isJsonObject,
  keys,
  optJsonArray,
  optJsonObject,
  optString,
  parseJsonObjectOrThrow,
} from './jsonSupport';
import type { JsonObject, JsonValue } from './jsonSupport';
import {
  SourceNetworkError,
  decodeUtf8,
  executeSourceRequest,
  formUrlEncode,
  isSuccessful,
  resolveHttpClient,
} from './sourceHttp';
import type { FailoverClientFactory, HttpClient, HttpHeader } from './sourceHttp';
import { DISCOVER_DIMENSIONS, discoverCatalog, discoverEntry, discoverPage, parseDiscoverDate, rangeStart,
  type DiscoverCatalog, type DiscoverNativeCategory, type DiscoverPage, type DiscoverQuery } from '@core/discover/models';

/** Kotlin `companion object { private const val TAG = "MangaDex" }`. */
const TAG = 'MangaDex';
const BASE = 'https://mangadex.live';
const REFERER = 'https://mangadex.live/';
/** 第九轮：官方 API（title 搜索覆盖 altTitles 中文别名；镜像站搜索只匹配主标题） */
const OFFICIAL_API = 'https://api.mangadex.org';
const UA =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * `MangaDexSource.kt` never wraps its response bodies in `readImportBytes(...)` —
 * it reads them with `response.body?.string()` (L189 / L351 / L841), so a body of
 * any size is accepted by the Android source. Passing an explicit unbounded limit
 * keeps this port HTTP-for-HTTP identical instead of silently capping it at the
 * 2 MiB default the shared request helper would otherwise apply.
 */
const MANGA_DEX_BODY_BYTES = Number.POSITIVE_INFINITY;

export class MangaDexSource extends ComicSource {
  override async getShareUrl(bookId: string): Promise<string> {
    const uuid = officialUuid(bookId);
    return uuid ? `https://mangadex.org/title/${encodeURIComponent(uuid)}` : `${BASE}/manga/${encodeURIComponent(bookId)}`;
  }
  private discoverTags: DiscoverNativeCategory[] | null = null;
  override async discoverCatalog(_resolveDynamic = false): Promise<SourceResultType<DiscoverCatalog>> {
    if (this.discoverTags === null) {
      const response = await this.apiGet(`${OFFICIAL_API}/manga/tag`);
      const rows = optJsonArray(response, 'data');
      if (rows) this.discoverTags = rows.flatMap((row) => {
        if (!isJsonObject(row)) return [];
        const attrs = optJsonObject(row, 'attributes');
        const label = this.officialText(optJsonObject(attrs, 'name'));
        return attrs && label ? [{ id: `md:tag:${optString(row, 'id', '')}`, label, group: optString(attrs, 'group', '') ?? '' }] : [];
      });
    }
    return SourceResult.Success(discoverCatalog({ declared: true, dated: true,
      categories: this.discoverTags ?? [], dynamicCategories: this.discoverTags === null,
      feeds: [{ id: 'md:latest', label: '最新更新', kind: 'updates' }, { id: 'md:popular', label: '热门排行', kind: 'ranking' },
        { id: 'md:new', label: '新作排行', kind: 'ranking' }, { id: 'md:completed', label: '完结排行', kind: 'ranking' }],
      capabilities: { updates: [...DISCOVER_DIMENSIONS.UPDATES.ranges], ranking: ['热门', '新作', '完结'] },
    }));
  }
  override async discover(query: DiscoverQuery): Promise<SourceResultType<DiscoverPage>> {
    const tags = [...new Set([...query.categoryIds, ...(query.categoryId ? [query.categoryId] : [])]
      .filter((id) => id.startsWith('md:tag:')).map((id) => id.slice(7)).filter((id) => /^[a-f0-9-]{36}$/.test(id)))];
    const tagBrowse = tags.length > 0;
    if (query.feedId !== null && !tagBrowse) {
      const ranking = { 'md:popular': '热门', 'md:new': '新作', 'md:completed': '完结' }[query.feedId];
      const nativeQuery: DiscoverQuery = { ...query, dimension: ranking ? 'RANKING' : 'UPDATES', range: ranking ?? '最新', feedId: null };
      const result = await this.discover(nativeQuery);
      return result.kind === 'error' ? result : SourceResult.Success({ ...result.data, native: true,
        entries: result.data.entries.map((entry) => ({ ...entry, native: true, origin: `MangaDex ${nativeQuery.range}` })) });
    }
    if (!tagBrowse && (!['UPDATES', 'RANKING'].includes(query.dimension) || query.dimension === 'RANKING' && query.range === '飙升'))
      return SourceResult.Success(discoverPage({ supported: false, notice: 'MangaDex 未提供此维度数据' }));
    try {
      const limit = 30, offset = (query.page - 1) * limit;
      const includes = '&includes%5B%5D=cover_art&includes%5B%5D=author&includes%5B%5D=artist';
      const ratings = '&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive' + (query.includeAdult ? '&contentRating%5B%5D=erotica&contentRating%5B%5D=pornographic' : '');
      const updates = new Map<string, { time: number; chapter: string }>();
      let response: JsonObject | null;
      let collection: JsonValue[];
      if (query.dimension === 'UPDATES' && !tagBrowse) {
        const start = rangeStart(query.range, Date.now()) ?? 0;
        const since = new Date(start).toISOString().slice(0, 19);
        response = await this.apiGet(`${OFFICIAL_API}/chapter?limit=${limit}&offset=${offset}&order%5BpublishAt%5D=desc&translatedLanguage%5B%5D=zh&translatedLanguage%5B%5D=zh-hk&translatedLanguage%5B%5D=en&publishAtSince=${formUrlEncode(since)}${ratings}`);
        if (!response) return SourceResult.Error(new NetworkError('MangaDex 更新接口不可达'));
        for (const row of optJsonArray(response, 'data') ?? []) {
          if (!isJsonObject(row)) continue;
          const attrs = optJsonObject(row, 'attributes'); if (!attrs) continue;
          const manga = (optJsonArray(row, 'relationships') ?? []).find((item) => isJsonObject(item) && optString(item, 'type') === 'manga');
          const uuid = isJsonObject(manga) ? optString(manga, 'id') : null;
          const time = parseDiscoverDate(optString(attrs, 'publishAt'));
          if (!uuid || time === null || time < start || time > Date.now()) continue;
          if (!updates.has(uuid)) updates.set(uuid, { time, chapter: blankToNull(optString(attrs, 'title', '')) ?? `第${optString(attrs, 'chapter', '?')}话` });
        }
        if (updates.size) {
          const metadata = await this.apiGet(`${OFFICIAL_API}/manga?limit=${limit}${includes}${ratings}&${[...updates.keys()].map((id) => `ids%5B%5D=${id}`).join('&')}`);
          const rows = optJsonArray(metadata, 'data');
          if (!rows) return SourceResult.Error(new NetworkError('MangaDex 作品信息加载失败'));
          collection = rows;
        } else collection = [];
      } else {
        const order = query.range === '新作' ? 'createdAt' : 'followedCount';
        const status = query.range === '完结' ? '&status%5B%5D=completed' : '';
        const filters = tagBrowse ? '&includedTagsMode=OR' + tags.map((tag) => `&includedTags%5B%5D=${tag}`).join('') : '';
        response = await this.apiGet(`${OFFICIAL_API}/manga?limit=${limit}&offset=${offset}&order%5B${order}%5D=desc${includes}${ratings}${status}${filters}`);
        if (!response) return SourceResult.Error(new NetworkError('MangaDex 榜单接口不可达'));
        collection = optJsonArray(response, 'data') ?? [];
      }
      const entries = collection.flatMap((row, index) => {
        if (!isJsonObject(row)) return [];
        const uuid = blankToNull(optString(row, 'id', '')), attrs = optJsonObject(row, 'attributes');
        if (!uuid || !attrs) return [];
        const info = withArtists(this.officialInfo(attrs), this.officialCreators(row, 'artist'));
        const cover = (optJsonArray(row, 'relationships') ?? []).find((item) => isJsonObject(item) && optString(item, 'type') === 'cover_art');
        const fileName = isJsonObject(cover) ? optString(optJsonObject(cover, 'attributes'), 'fileName') : null;
        const title = this.officialText(optJsonObject(attrs, 'title')); if (!title) return [];
        this.officialTitleCache.put(uuid, title);
        const demographic = blankToNull(optString(attrs, 'publicationDemographic', ''));
        const rating = optString(attrs, 'contentRating', '');
        const book = createSearchBook({ id: `mdapi:${uuid}`, sourceId: this.id, title, author: this.officialCreators(row, 'author').join('、'),
          cover: fileName ? `https://uploads.mangadex.org/covers/${uuid}/${fileName}.512.jpg` : null, format: '漫画', comicId: `mdapi:${uuid}`,
          comicInfo: { ...info, tags: [...info.tags, ...(demographic ? [demographic] : []), ...(['erotica', 'pornographic'].includes(rating ?? '') ? [rating!] : [])] } });
        return [discoverEntry(book, { updatedAt: updates.get(uuid)?.time ?? null, latestChapter: updates.get(uuid)?.chapter ?? null,
          rank: !tagBrowse && query.dimension === 'RANKING' ? offset + index + 1 : null, native: tagBrowse, origin: tagBrowse ? '分类推荐' : null,
          nativeOrder: query.dimension === 'UPDATES' && !tagBrowse ? [...updates.keys()].indexOf(uuid) + offset + 1 : offset + index + 1 })];
      });
      return SourceResult.Success(discoverPage({ entries, hasMore: offset + Number(response['limit'] ?? limit) < Number(response['total'] ?? 0), native: tagBrowse,
        notice: query.dimension === 'RANKING' ? `MangaDex 原生${query.range}排行` : null }));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return SourceResult.Error(new Unknown(`MangaDex 发现加载失败：${error instanceof Error ? error.message : String(error)}`));
    }
  }
  readonly id: string = 'mangadex';
  readonly name: string = 'MangaDex 漫画';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({
    supportSearch: true,
    supportDownload: false,
    supportComic: true,
    environmentOnly: false,
  });

  private readonly http: HttpClient;

  /** 官方条目 uuid → 罗马音/英文主标题（章节无图时按标题回退镜像搜索的桥接表）。 */
  private readonly officialTitleCache = new LruCacheImpl<string, string>(64);
  private readonly mirrorToOfficialCache = new LruCacheImpl<string, string>(64);
  /** uuid → 镜像站 slug：外链章节回退镜像时避免每章重复"取标题→搜索→匹配"。 */
  private readonly mirrorSlugCache = new LruCacheImpl<string, string>(32);
  /** In-flight mirror chapter-list fetches keyed by `bookId`, mirroring the Kotlin `async` block. */
  private readonly pendingChapters = new Map<string, Promise<SourceResultType<ComicChapter[]>>>();

  constructor(options: { client?: HttpClient | null; failover?: FailoverClientFactory } = {}) {
    super();
    this.http = resolveHttpClient(options.client ?? null, options.failover);
  }

  // -------------------------------------------------------------------------
  // Kotlin 72-129 search()
  // -------------------------------------------------------------------------

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    try {
      // 第九轮补强：镜像站（mangadex.live）的站内搜索只匹配罗马音/英文主标题
      // ——实测 航海王/海贼王/无职転生 均为 0 结果，而官方 API 的 title 搜索
      // 覆盖 altTitles（含中文别名，航海王→One Piece 命中）。两条路径合并：
      // 镜像结果直接可用（章节/图链路成熟），官方 API 结果带 mdapi: 前缀 id，
      // 详情/章节/图走官方 API 专用实现。
      const encoded = formUrlEncode(keyword);
      const mirrorPromise = runCatchingAsync(() => this.searchMirror(encoded));
      const officialPromise = this.searchOfficialApi(keyword);
      const mirrorResult = await mirrorPromise;
      const mirror = mirrorResult.ok ? mirrorResult.value : [];
      const official = await officialPromise;
      if (!mirrorResult.ok && official.length === 0) {
        throw new NetworkError(
          `MangaDex 搜索服务暂时不可用: ${messageOf(mirrorResult.error)}`,
        );
      }
      // 同名作品优先使用官方 ID，避免镜像搜索能命中但详情页已失效。
      const merged = new Map<string, SearchBook>();
      for (const it of mirror) merged.set(it.id, it);
      for (const api of official) {
        const uuid = officialUuid(api.id);
        const apiMainTitle = uuid == null ? null : (this.officialTitleCache.get(uuid) ?? null);
        const mirrorMatch = mirror.find(
          (it) =>
            it.title.toLowerCase() === api.title.toLowerCase() ||
            normalizeTitle(it.title) === normalizeTitle(api.title) ||
            (apiMainTitle != null && normalizeTitle(it.title) === normalizeTitle(apiMainTitle)),
        );
        if (mirrorMatch != null) {
          this.mirrorToOfficialCache.put(mirrorMatch.id, api.id);
          merged.set(mirrorMatch.id, api);
        } else {
          merged.set(api.id, api);
        }
      }
      const books = [...merged.values()];
      logInfo(`search '${keyword}' -> mirror ${mirror.length} + official ${official.length} = ${books.length} books`);
      return SourceResult.Success(books);
    } catch (e) {
      // Kotlin L123-132: SourceException → itself, IOException → NetworkError,
      // anything else → Unknown("未知错误: …").
      if (e instanceof SourceException) {
        logError(`search failed: ${e.message}`);
        return SourceResult.Error(e);
      }
      if (e instanceof SourceNetworkError) {
        logError(`search io error: ${messageOf(e)}`);
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      logError(`search unexpected: ${messageOf(e)}`);
      return SourceResult.Error(new Unknown(`未知错误: ${messageOf(e)}`, e));
    }
  }

  // -------------------------------------------------------------------------
  // Kotlin 131-162 normalizeTitle / searchMirror
  // -------------------------------------------------------------------------

  /** Kotlin `private fun normalizeTitle(t: String): String`. */
  private normalizeTitle(t: string): string {
    return t.toLowerCase().replace(/[\s＆&！!？?，,。·・:：\-—～~]/g, '');
  }

  /** 镜像站 HTML 搜索（原实现抽出，行为不变） */
  private async searchMirror(encoded: string): Promise<SearchBook[]> {
    const doc = parseHtmlDocument(await this.getHtml(`${BASE}/search?q=${encoded}`));
    const books: SearchBook[] = [];
    for (const unit of doc.select('div.unit')) {
      const link = unit.selectFirst('a[href^=/manga/]');
      if (link == null) continue;
      const href = link.attr('href').replace(/^\/+/, '').replace(/\/+$/, '');
      const slug = href.startsWith('manga/') ? href.slice('manga/'.length) : href;
      if (slug.trim() === '') continue;
      const titleAttr = link.attr('title');
      const title = (titleAttr.trim() === '' ? link.text() : titleAttr).trim();
      const img = unit.selectFirst('img[src]') ?? unit.selectFirst('img[data-src]');
      const cover =
        img == null
          ? ''
          : (img.attr('src').trim() === '' ? img.attr('data-src') : img.attr('src')).trim();
      const readHref = unit.selectFirst('.content li a[href^=/read/]')?.attr('href') ?? '';
      const langCode = (() => {
        if (readHref === '') return null;
        const parts = readHref.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
        return parts[2] ?? null;
      })();
      books.push(
        createSearchBook({
          id: slug,
          sourceId: this.id,
          title: title.trim() === '' ? '未知书名' : title,
          author: '',
          cover: cover.trim() === '' ? null : cover.replace('.256.jpg', '.512.jpg'),
          format: '漫画',
          language: langCode == null ? null : languageLabel(langCode),
        }),
      );
    }
    const seen = new Set<string>();
    return books.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Kotlin 164-262 searchOfficialApi
  // -------------------------------------------------------------------------

  /**
   * 官方 API 搜索（api.mangadex.org）：title 参数覆盖 altTitles，
   * 中文别名（航海王/海贼王/无职転生…）可直接命中。任何失败静默返回空——
   * 官方 API 在部分网络不可达（注释见类头），此时镜像路径独立支撑搜索。
   * 结果 id 带 "mdapi:" 前缀，getDetail/getChapters/getChapterImages 据此分派。
   */
  private async searchOfficialApi(keyword: string): Promise<SearchBook[]> {
    const result = await runCatchingAsync(async () => {
      const encoded = formUrlEncode(keyword);
      const url =
        `${OFFICIAL_API}/manga?title=${encoded}&limit=12` +
        '&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive' +
        '&includes%5B%5D=cover_art&includes%5B%5D=author&includes%5B%5D=artist&order%5Brelevance%5D=desc';
      const headers: HttpHeader = { 'User-Agent': UA, Accept: 'application/json' };
      const response = await executeSourceRequest(this.http, url, {
        headers,
        maxBytes: MANGA_DEX_BODY_BYTES,
      });
      if (!isSuccessful(response)) {
        logInfo(`official api search HTTP ${response.status}`);
        return [] as SearchBook[];
      }
      const root = parseJsonObjectOrThrow(decodeUtf8(response.body));
      const data = optJsonArray(root, 'data');
      if (data == null) return [] as SearchBook[];
      const out: SearchBook[] = [];
      for (let i = 0; i < data.length; i += 1) {
        const item = arrayOptJsonObject(data, i);
        if (item == null) continue;
        const uuid = optString(item, 'id', '') ?? '';
        if (uuid.trim() === '') continue;
        const attrs = optJsonObject(item, 'attributes');
        if (attrs == null) continue;
        const titleObj = optJsonObject(attrs, 'title');
        const mainTitle =
          (titleObj == null
            ? null
            : firstNotNullOfOrNull(['en', 'ja-ro', 'ja', 'zh-hans', 'zh'], (k) => {
                const value = optString(titleObj, k, '') ?? '';
                return value.trim() === '' ? null : value;
              })) ?? '';
        // altTitles 里取最优展示标题（优先中文，其次英文，再取第一个）
        const altList = optJsonArray(attrs, 'altTitles');
        let zhAlt: string | null = null;
        let firstAlt: string | null = null;
        if (altList != null) {
          for (let k = 0; k < altList.length; k += 1) {
            const alt = arrayOptJsonObject(altList, k);
            if (alt == null) continue;
            const zhHans = optString(alt, 'zh-hans', '') ?? '';
            const zh = zhHans.trim() === '' ? (optString(alt, 'zh', '') ?? '') : zhHans;
            if (zh.trim() !== '' && zhAlt == null) zhAlt = zh;
            if (firstAlt == null) {
              for (const keyName of keys(alt)) {
                const value = optString(alt, keyName, '') ?? '';
                if (value.trim() === '') continue;
                firstAlt = value;
                break;
              }
            }
          }
        }
        const displayTitle =
          firstNonEmpty(zhAlt, mainTitle === '' ? null : mainTitle, firstAlt) ?? '未知书名';
        // cover：includes[] 里的 cover_art 关系 → 文件名拼官方 CDN URL
        let cover: string | null = null;
        const rels = optJsonArray(item, 'relationships');
        if (rels != null) {
          for (let k = 0; k < rels.length; k += 1) {
            const rel = arrayOptJsonObject(rels, k);
            if (rel == null) continue;
            if ((optString(rel, 'type', '') ?? '') === 'cover_art') {
              const fileName = optString(optJsonObject(rel, 'attributes'), 'fileName', '');
              if (fileName != null && fileName.trim() !== '') {
                cover = `https://uploads.mangadex.org/covers/${uuid}/${fileName}.512.jpg`;
              }
              break;
            }
          }
        }
        // 记录 uuid→主标题（罗马音/英文），供官方章节无图时回退镜像搜索
        if (mainTitle.trim() !== '') {
          this.officialTitleCache.put(uuid, mainTitle);
        }
        out.push(
          createSearchBook({
            id: `mdapi:${uuid}`,
            sourceId: this.id,
            title: displayTitle,
            author: this.officialCreators(item, 'author').join('、'),
            cover,
            format: '漫画',
            comicInfo: withArtists(this.officialInfo(attrs), this.officialCreators(item, 'artist')),
            description: this.officialText(optJsonObject(attrs, 'description')),
          }),
        );
      }
      return out;
    });
    return result.ok ? result.value : [];
  }

  // -------------------------------------------------------------------------
  // Kotlin 264-302 helpers
  // -------------------------------------------------------------------------

  /** id 是否为官方 API 条目（"mdapi:<uuid>"） */
  private officialText(values: JsonObject | null): string | null {
    if (values == null) return null;
    const primary = firstNotNullOfOrNull(['zh-hans', 'zh', 'zh-hk', 'en', 'ja'], (key) => {
      const value = optString(values, key, '') ?? '';
      return value.trim() !== '' && value !== 'null' ? value : null;
    });
    if (primary != null) return primary;
    for (const key of keys(values)) {
      const value = optString(values, key, '') ?? '';
      if (value.trim() !== '' && value !== 'null') return value;
    }
    return null;
  }

  private officialCreators(item: JsonObject, type: string): string[] {
    const relationships = optJsonArray(item, 'relationships');
    if (relationships == null) return [];
    const out: string[] = [];
    for (let i = 0; i < relationships.length; i += 1) {
      const rel = arrayOptJsonObject(relationships, i);
      if (rel == null) continue;
      if ((optString(rel, 'type', '') ?? '') !== type) continue;
      const name = optString(optJsonObject(rel, 'attributes'), 'name', '');
      if (name != null && name.trim() !== '') out.push(name);
    }
    return [...new Set(out)];
  }

  private officialInfo(attrs: JsonObject | null): ComicInfo {
    if (attrs == null) return createComicInfo();
    const collected: string[] = [];
    const collect = (obj: JsonObject | null): void => {
      if (obj == null) return;
      for (const key of keys(obj)) {
        const value = optString(obj, key, '') ?? '';
        if (value.trim() !== '' && value !== 'null') collected.push(value);
      }
    };
    collect(optJsonObject(attrs, 'title'));
    const altTitles = optJsonArray(attrs, 'altTitles');
    if (altTitles != null) {
      for (let i = 0; i < altTitles.length; i += 1) {
        collect(arrayOptJsonObject(altTitles, i));
      }
    }
    const tags = optJsonArray(attrs, 'tags');
    const tagNames: string[] = [];
    if (tags != null) {
      for (let i = 0; i < tags.length; i += 1) {
        const name = this.officialText(
          optJsonObject(
            optJsonObject(arrayOptJsonObject(tags, i), 'attributes'),
            'name',
          ),
        );
        if (name != null) tagNames.push(name);
      }
    }
    return createComicInfo({
      alternateTitles: [...new Set(collected)],
      tags: tagNames,
      status: blankToNull(optString(attrs, 'status', '')),
      originalLanguage: blankToNull(optString(attrs, 'originalLanguage', '')),
      updatedAt: blankToNull(optString(attrs, 'updatedAt', '')),
    });
  }

  // -------------------------------------------------------------------------
  // Kotlin 312-349 mirrorSlugFor / apiGet
  // -------------------------------------------------------------------------

  /**
   * 定位作品在镜像站的 slug：先查缓存；未命中时按主标题搜索，
   * 只接受归一化后相同的标题，防止同名角色的同人作品替代原作。
   */
  private async mirrorSlugFor(uuid: string): Promise<string | null> {
    const cached = this.mirrorSlugCache.get(uuid);
    if (cached !== undefined) return cached;
    const known = this.officialTitleCache.get(uuid);
    const mainTitle =
      known ?? (await firstMainTitle(await this.apiGet(`${OFFICIAL_API}/manga/${uuid}`)));
    if (mainTitle == null) return null;
    const candidates = (
      await runCatchingAsync(() => this.searchMirror(formUrlEncode(mainTitle)))
    ).value.filter((it) => it.id.trim() !== '' && !it.id.startsWith('mdapi:'));
    const target = this.normalizeTitle(mainTitle);
    const slug = candidates.find((it) => this.normalizeTitle(it.title) === target)?.id;
    if (slug == null) return null;
    this.mirrorSlugCache.put(uuid, slug);
    return slug;
  }

  private async apiGet(url: string): Promise<JsonObject | null> {
    return runCatchingAsync(async () => {
      const headers: HttpHeader = { 'User-Agent': UA, Accept: 'application/json' };
      const response = await executeSourceRequest(this.http, url, {
        headers,
        maxBytes: MANGA_DEX_BODY_BYTES,
      });
      if (!isSuccessful(response)) return null;
      return response.body.byteLength === 0 ? null : parseJsonObjectOrThrow(decodeUtf8(response.body));
    }).then((box) => box.value);
  }

  // -------------------------------------------------------------------------
  // Kotlin 351-378 officialChapterImages / officialImagesAvailable
  // -------------------------------------------------------------------------

  /** 官方章节 id 直接交给 at-home API；章节列表已提供这个 id。 */
  private async officialChapterImages(chapterId: string): Promise<string[]> {
    const atHome = await this.apiGet(`${OFFICIAL_API}/at-home/server/${chapterId}`);
    if (atHome == null) return [];
    const baseUrl = optString(atHome, 'baseUrl', '') ?? '';
    const chapter = optJsonObject(atHome, 'chapter');
    if (chapter == null) return [];
    const hash = optString(chapter, 'hash', '') ?? '';
    const pages = optJsonArray(chapter, 'data');
    if (pages == null) return [];
    if (baseUrl.trim() === '' || hash.trim() === '') return [];
    const out: string[] = [];
    for (let i = 0; i < pages.length; i += 1) {
      const p = arrayOptString(pages, i, '') ?? '';
      if (p.trim() !== '') out.push(`${baseUrl}/data/${hash}/${p}`);
    }
    return out;
  }

  private async officialImagesAvailable(images: string[]): Promise<boolean> {
    const first = images[0];
    if (first == null) return false;
    // The at-home API can list files that the image server already returns 404
    // for. Read only a small range before accepting those URLs as a chapter.
    const box = await runCatchingAsync(async () => {
      const headers: HttpHeader = { 'User-Agent': UA, Range: 'bytes=0-63' };
      // peekBody reads a prefix even when a CDN ignores Range and returns 200.
      // Our buffered transport must accept that valid image, while retaining the
      // same 32 MiB ceiling used by chapter page downloads.
      const response = await executeSourceRequest(this.http, first, {
        headers,
        maxBytes: 32 * 1024 * 1024,
      });
      return isSuccessful(response) && response.body.byteLength > 0;
    });
    return box.ok ? box.value : false;
  }

  // -------------------------------------------------------------------------
  // Kotlin 380-432 mirrorFallbackImages
  // -------------------------------------------------------------------------

  /**
   * 第九轮回退：官方章节无托管图（externalLink 除外链）时，
   * 用 uuid→主标题桥接表在镜像站搜同作品，再在镜像章节列表里找同号章节，
   * 最后走镜像 read 页拿直链图。任何一步失败都静默返回空。
   */
  private async mirrorFallbackImages(uuid: string, chapterNum: number): Promise<string[]> {
    const box = await runCatchingAsync(async () => {
      const slug = await this.mirrorSlugFor(uuid);
      if (slug == null) return [] as string[];
      // 拉镜像章节列表，找同号
      const doc = parseHtmlDocument(await this.getHtml(`${BASE}/manga/${slug}`));
      const blocks = doc.select('ul.chapter-list-item');
      let readPath: string | null = null;
      const preferred = ['ZH', 'ZH-HK', 'ZH-CN', 'EN'];
      for (const block of sortByLanguage(blocks, preferred)) {
        const code = block.attr('data-code').toUpperCase();
        const hit = chapterReadPath(block, chapterNum);
        if (hit != null && hit.trim() !== '') {
          readPath = hit;
          break;
        }
        let offset = parseIntOr(block.attr('data-offset'), 0);
        let hasMore = block.attr('data-has-more') === 'true';
        let guard = 0;
        while (hasMore && guard < 40) {
          const batchDoc = parseHtmlDocument(
            await this.getHtml(`${BASE}/manga/${slug}/chapters?lang=${code}&offset=${offset}`, true, false),
          );
          const meta = batchDoc.selectFirst('span.chapter-batch-meta');
          const hit2 = chapterReadPath(batchDoc, chapterNum);
          if (hit2 != null && hit2.trim() !== '') {
            readPath = hit2;
            break;
          }
          hasMore = meta?.attr('data-has-more') === 'true';
          offset =
            meta == null ? offset + 1 : parseIntOr(meta.attr('data-next-offset'), offset + 1);
          guard += 1;
        }
        if (readPath != null) break;
      }
      if (readPath == null || readPath.trim() === '') return [] as string[];
      const pageDoc = parseHtmlDocument(await this.getHtml(`${BASE}/${readPath}`, false, true));
      return pageDoc
        .select('img[src]')
        .map((img) => {
          const src = img.attr('src').trim();
          return src.startsWith('http') && src.includes('/chapter/') ? src : null;
        })
        .filter((src): src is string => src != null);
    });
    return box.ok ? box.value : [];
  }

  // -------------------------------------------------------------------------
  // Kotlin 434-516 getDetail
  // -------------------------------------------------------------------------

  async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    try {
      // 第九轮：官方 API 条目（mdapi:<uuid>）走官方详情
      const officialId = officialUuid(bookId);
      if (officialId != null) {
        const uuid = officialId;
        const json = await this.apiGet(
          `${OFFICIAL_API}/manga/${uuid}?includes%5B%5D=cover_art&includes%5B%5D=author&includes%5B%5D=artist`,
        );
        if (json == null) {
          return SourceResult.Error(new NetworkError('MangaDex 官方 API 不可达'));
        }
        const item = optJsonObject(json, 'data');
        if (item == null) {
          return SourceResult.Error(new ParseError('作品不存在'));
        }
        const attrs = optJsonObject(item, 'attributes');
        const titleObj = attrs == null ? null : optJsonObject(attrs, 'title');
        const title =
          (titleObj == null
            ? null
            : firstNotNullOfOrNull(['en', 'ja-ro', 'ja', 'zh-hans', 'zh'], (k) => {
                const value = optString(titleObj, k, '') ?? '';
                return value.trim() === '' ? null : value;
              })) ?? uuid;
        let cover: string | null = null;
        const rels = optJsonArray(item, 'relationships');
        if (rels != null) {
          for (let k = 0; k < rels.length; k += 1) {
            const rel = arrayOptJsonObject(rels, k);
            if (rel == null) continue;
            if ((optString(rel, 'type', '') ?? '') === 'cover_art') {
              const fileName = optString(optJsonObject(rel, 'attributes'), 'fileName', '');
              if (fileName != null && fileName.trim() !== '') {
                cover = `https://uploads.mangadex.org/covers/${uuid}/${fileName}.512.jpg`;
              }
              break;
            }
          }
        }
        return SourceResult.Success(
          createSearchBook({
            id: bookId,
            sourceId: this.id,
            title,
            author: this.officialCreators(item, 'author').join('、'),
            cover,
            format: '漫画',
            description: this.officialText(attrs == null ? null : optJsonObject(attrs, 'description')),
            comicInfo: withArtists(this.officialInfo(attrs), this.officialCreators(item, 'artist')),
          }),
        );
      }
      const mirrorHtml = await runCatchingAsync(() => this.getHtml(`${BASE}/manga/${bookId}`));
      const officialFallback = this.mirrorToOfficialCache.get(bookId);
      if (!mirrorHtml.ok && officialFallback != null) {
        return this.getDetail(officialFallback);
      }
      if (!mirrorHtml.ok) throw mirrorHtml.error;
      const doc = parseHtmlDocument(mirrorHtml.value);
      const h1 = doc.selectFirst('h1')?.text().trim();
      const ogTitle = doc.selectFirst('meta[property=og:title]')?.attr('content').trim();
      const title = firstNonEmpty(h1, ogTitle) ?? bookId;
      const ogImage = doc.selectFirst('meta[property=og:image]')?.attr('content').trim();
      const coverImg = doc.selectFirst('img[src*=cover]')?.attr('src').trim();
      const cover = firstNonEmpty(ogImage, coverImg);
      const author = parseJsonLdAuthor(doc);
      const description = doc.selectFirst('meta[name=description]')?.attr('content');
      return SourceResult.Success(
        createSearchBook({
          id: bookId,
          sourceId: this.id,
          title,
          author,
          description: description != null && description.trim() !== '' ? description : null,
          cover: cover == null || cover.trim() === '' ? null : cover.replace('.256.jpg', '.512.jpg'),
          format: '漫画',
        }),
      );
    } catch (e) {
      // Kotlin L510-519: SourceException → itself, IOException → NetworkError, else → Unknown.
      if (e instanceof SourceException) {
        logError(`detail failed: ${e.message}`);
        return SourceResult.Error(e);
      }
      if (e instanceof SourceNetworkError) {
        logError(`detail io error: ${messageOf(e)}`);
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      logError(`detail unexpected: ${messageOf(e)}`);
      return SourceResult.Error(new Unknown(`未知错误: ${messageOf(e)}`, e));
    }
  }

  // -------------------------------------------------------------------------
  // Kotlin 518-657 getChapters
  // -------------------------------------------------------------------------

  async getChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    // Kotlin line 604 re-enters `getChapters(officialFallback)`; the in-flight
    // promise map keeps that a plain recursion without re-entering bookkeeping.
    const pending = this.pendingChapters.get(bookId);
    if (pending !== undefined) return pending;
    const promise = this.getChaptersInner(bookId);
    this.pendingChapters.set(bookId, promise);
    try {
      return await promise;
    } finally {
      this.pendingChapters.delete(bookId);
    }
  }

  private async getChaptersInner(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    try {
      // 第九轮：官方 API 条目——章节列表按官方 feed 拉取（中→英优先）
      const officialId = officialUuid(bookId);
      if (officialId != null) {
        return this.getOfficialChapters(officialId);
      }
      const mirrorHtml = await runCatchingAsync(() => this.getHtml(`${BASE}/manga/${bookId}`));
      const blocks =
        mirrorHtml.ok === true
          ? parseHtmlDocument(mirrorHtml.value).select('ul.chapter-list-item')
          : [];
      if (blocks.length === 0) {
        const officialFallback = this.mirrorToOfficialCache.get(bookId);
        if (officialFallback != null) {
          return this.getChapters(officialFallback);
        }
        if (!mirrorHtml.ok) throw mirrorHtml.error;
        return SourceResult.Success([] as ComicChapter[]);
      }

      // 语言优先级：中 > 英 > 其余按章节数从多到少
      const preferred = ['ZH', 'ZH-HK', 'ZH-CN', 'EN'];
      const orderedBlocks = sortByLanguage(blocks, preferred);

      const byNumber = new Map<number, ComicChapter>();
      let batchRequests = 0;

      for (const block of orderedBlocks) {
        const code = block.attr('data-code').toUpperCase();
        collectItems(block, byNumber);

        let offset = parseIntOr(block.attr('data-offset'), 0);
        let hasMore = block.attr('data-has-more') === 'true';
        let guard = 0;
        while (hasMore && guard < 60 && batchRequests < 80) {
          const batchHtml = await this.getHtml(
            `${BASE}/manga/${bookId}/chapters?lang=${code}&offset=${offset}`,
            true,
            false,
          );
          const batchDoc = parseHtmlDocument(batchHtml);
          const meta = batchDoc.selectFirst('span.chapter-batch-meta');
          hasMore = meta?.attr('data-has-more') === 'true';
          offset =
            meta == null ? offset + 1 : parseIntOr(meta.attr('data-next-offset'), offset + 1);
          collectItems(batchDoc, byNumber);
          guard += 1;
          batchRequests += 1;
          // Kotlin L644 `if (lang.isBlank()) break` — a block with no
          // `data-code` gets exactly one batch request, never a paging loop.
          if (code.toLowerCase() === '') break;
        }
      }

      const chapters = [...byNumber.values()].sort((a, b) => a.order - b.order);
      logInfo(`chapters for ${bookId} -> ${chapters.length}`);
      return SourceResult.Success(chapters);
    } catch (e) {
      // Kotlin L651-660: SourceException → itself, IOException → NetworkError, else → Unknown.
      if (e instanceof SourceException) {
        logError(`chapters failed: ${e.message}`);
        return SourceResult.Error(e);
      }
      if (e instanceof SourceNetworkError) {
        logError(`chapters io error: ${messageOf(e)}`);
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      logError(`chapters unexpected: ${messageOf(e)}`);
      return SourceResult.Error(new Unknown(`未知错误: ${messageOf(e)}`, e));
    }
  }

  /** Kotlin 524-594 — the `mdapi:` feed branch of `getChapters`. */
  private async getOfficialChapters(
    officialId: string,
  ): Promise<SourceResultType<ComicChapter[]>> {
    const chapters: ComicChapter[] = [];
    const bestByNumber = new Map<number, { rank: number; chapter: ComicChapter }>();
    let offset = 0;
    const pageSize = 500;
    let numberedCount = 0;
    let externalCount = 0;
    let done = false;
    while (!done && offset < 10000) {
      const feed = await this.apiGet(
        `${OFFICIAL_API}/manga/${officialId}/feed?translatedLanguage%5B%5D=zh` +
          '&translatedLanguage%5B%5D=zh-hk' +
          '&translatedLanguage%5B%5D=en' +
          `&order%5Bchapter%5D=asc&limit=${pageSize}&offset=${offset}` +
          '&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive' +
          '&contentRating%5B%5D=erotica',
      );
      if (feed == null) {
        return SourceResult.Error(new NetworkError('MangaDex 官方 API 不可达'));
      }
      const data = optJsonArray(feed, 'data');
      if (data == null) break;
      for (let i = 0; i < data.length; i += 1) {
        const item = arrayOptJsonObject(data, i);
        if (item == null) continue;
        const attrs = optJsonObject(item, 'attributes');
        if (attrs == null) continue;
        const chapterId = optString(item, 'id', '') ?? '';
        const num = optDouble(attrs, 'chapter');
        if (chapterId.trim() === '') continue;
        const numbered = !Number.isNaN(num);
        const key = numbered ? num : offset + i;
        const label = !numbered
          ? '单话'
          : key === Math.trunc(key)
            ? `第${Math.trunc(key)}话`
            : `第${key} 话`;
        const rawTitle = optString(attrs, 'title', '') ?? '';
        const chapter = createComicChapter({
          id: `mdapich:${officialId}:${chapterId}:${key}`,
          title: rawTitle.trim() === '' ? label : rawTitle,
          order: key,
        });
        if (numbered) {
          numberedCount += 1;
          const languageRank = (() => {
            switch ((optString(attrs, 'translatedLanguage', '') ?? '').toLowerCase()) {
              case 'zh':
              case 'zh-hans':
                return 0;
              case 'zh-hk':
              case 'zh-tw':
                return 1;
              case 'en':
                return 2;
              default:
                return 3;
            }
          })();
          const external =
            !isJsonNull(attrs['externalUrl']) &&
            (optString(attrs, 'externalUrl', '') ?? '').trim() !== '';
          if (external) externalCount += 1;
          const rank = languageRank + (external ? 10 : 0);
          const current = bestByNumber.get(key);
          if (current === undefined || rank < current.rank) {
            bestByNumber.set(key, { rank, chapter });
          }
        } else {
          chapters.push(chapter);
        }
      }
      offset += data.length;
      const total = optInt(feed, 'total', offset);
      done = data.length < pageSize || offset >= total;
    }
    for (const entry of bestByNumber.values()) chapters.push(entry.chapter);
    chapters.sort((a, b) => a.order - b.order);
    // 章节全为外链（如 One Piece 全卷外链 MangaPlus）时，阅读/下载
    // 每章都要走镜像回退；在列表加载时就定位一次镜像 slug 并缓存，
    // 后续各章直接复用，同时把"镜像没有该作品"提前暴露。
    if (numberedCount > 0 && externalCount >= numberedCount) {
      await this.mirrorSlugFor(officialId);
    }
    logInfo(`official chapters for ${officialId} -> ${chapters.length}`);
    return SourceResult.Success(chapters);
  }

  // -------------------------------------------------------------------------
  // Kotlin 659-725 getChapterImages
  // -------------------------------------------------------------------------

  async getChapterImages(chapterId: string): Promise<SourceResultType<string[]>> {
    try {
      // 第九轮：官方 API 章节（mdapich:<uuid>）——at-home 接口取图；
      // 无图（章节为 externalLink/无中文英文托管源）时回退镜像：
      // 按标题搜镜像拿 slug → 镜像章节列表找同号章节 → 镜像 read 页直链
      if (chapterId.startsWith('mdapich:')) {
        const parts = chapterId.slice('mdapich:'.length).split(':');
        // 旧版 ID 只有章节 UUID；新版同时携带作品 UUID，供外链章节回退镜像。
        const mangaUuid = parts.length >= 3 ? (parts[0] ?? null) : null;
        const chapterUuid = (mangaUuid == null ? parts[0] : parts[1]) ?? '';
        const chapterNumRaw = mangaUuid == null ? parts[1] : parts[2];
        const chapterNum = chapterNumRaw == null ? null : parseFloatOrNull(chapterNumRaw);
        const images = await this.officialChapterImages(chapterUuid);
        logInfo(`official chapter images ${chapterUuid} -> ${images.length}`);
        if (await this.officialImagesAvailable(images)) {
          return SourceResult.Success(images);
        }
        // Saved chapters from older versions may carry only the chapter UUID.
        const metadata =
          mangaUuid == null || chapterNum == null
            ? optJsonObject(await this.apiGet(`${OFFICIAL_API}/chapter/${chapterUuid}`), 'data')
            : null;
        const mangaId =
          mangaUuid ??
          (() => {
            const rels = optJsonArray(metadata, 'relationships');
            if (rels == null) return null;
            return firstRelationshipId(rels, 'manga');
          })();
        const number =
          chapterNum ??
          parseFloatOrNull(optString(optJsonObject(metadata, 'attributes'), 'chapter', '') ?? '');
        // 回退镜像：uuid→标题桥接表 → 镜像搜索 → 同号章节
        const fallback =
          mangaId != null && mangaId.trim() !== '' && number != null
            ? await this.mirrorFallbackImages(mangaId, number)
            : [];
        logInfo(
          `mirror fallback for ${chapterUuid} ch${String(chapterNum)} -> ${fallback.length}`,
        );
        return fallback.length === 0
          ? SourceResult.Error(
              new ParseError('该章节官方图片不可用，镜像站也未找到同作品、同章节的图片'),
            )
          : SourceResult.Success(fallback);
      }
      const path = chapterId.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!path.startsWith('read/')) {
        return SourceResult.Error(new ParseError('章节标识无效'));
      }
      const doc = parseHtmlDocument(await this.getHtml(`${BASE}/${path}`, false, true));
      const images = doc
        .select('img[src]')
        .map((img) => {
          const src = img.attr('src').trim();
          return src.startsWith('http') && src.includes('/chapter/') ? src : null;
        })
        .filter((src): src is string => src != null);
      logInfo(`chapter images ${chapterId} -> ${images.length}`);
      if (images.length === 0) {
        return SourceResult.Error(new ParseError('该章节没有可读取的图片'));
      }
      return SourceResult.Success(images);
    } catch (e) {
      // Kotlin L719-728: SourceException → itself, IOException → NetworkError, else → Unknown.
      if (e instanceof SourceException) {
        logError(`chapter images failed: ${e.message}`);
        return SourceResult.Error(e);
      }
      if (e instanceof SourceNetworkError) {
        logError(`chapter images io error: ${messageOf(e)}`);
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      logError(`chapter images unexpected: ${messageOf(e)}`);
      return SourceResult.Error(new Unknown(`未知错误: ${messageOf(e)}`, e));
    }
  }

  async getDownloadInfo(_bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return SourceResult.Error(new ParseError('漫画源按章节在线阅读/下载，不支持单文件下载'));
  }

  override async getChapterImageHeaders(
    chapterId: string,
    urls: string[],
  ): Promise<Record<string, Record<string, string>>> {
    const out: Record<string, Record<string, string>> = {};
    for (const url of urls) {
      // Official at-home images must not inherit a third-party mirror Referer.
      // Mirror pages and official API chapters can both appear in the same search.
      const host = hostOf(url) ?? '';
      let path = '';
      try {
        path = new URL(url).pathname;
      } catch {
        path = '';
      }
      const official =
        host === 'mangadex.org' ||
        host.endsWith('.mangadex.org') ||
        host === 'mangadex.network' ||
        host.endsWith('.mangadex.network') ||
        (chapterId.startsWith('mdapich:') && !path.startsWith('/chapter/'));
      out[url] = official
        ? { 'User-Agent': UA }
        : { 'User-Agent': UA, Referer: REFERER };
    }
    return out;
  }

  async login(_credential: LoginCredential): Promise<SourceResultType<boolean>> {
    return SourceResult.Success(false);
  }

  async logout(): Promise<void> {}

  async isLoggedIn(): Promise<boolean> {
    return false;
  }

  override async getAuthenticationState(): Promise<AuthenticationState> {
    return AuthenticationState.NotRequired;
  }

  // -------------------------------------------------------------------------
  // Kotlin 820-839 getHtml
  // -------------------------------------------------------------------------

  private async getHtml(url: string, xhr = false, referer = false): Promise<string> {
    const headers: HttpHeader = {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (referer) headers['Referer'] = REFERER;
    if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
    const response = await executeSourceRequest(this.http, url, {
      headers,
      maxBytes: MANGA_DEX_BODY_BYTES,
    });
    if (!isSuccessful(response)) {
      logError(`HTTP ${response.status} for ${url.slice(0, 140)}`);
      throw new NetworkError(`MangaDex HTTP ${response.status} @ ${url.slice(0, 160)}`);
    }
    return response.body.byteLength === 0 ? '' : decodeUtf8(response.body);
  }
}

// ---------------------------------------------------------------------------
// Kotlin 755-776 collectItems (module-level: no instance state is used)
// ---------------------------------------------------------------------------

function collectItems(doc: HtmlElement, out: Map<number, ComicChapter>): void {
  for (const li of doc.select('li.item[data-number]')) {
    const numStr = li.attr('data-number').trim();
    const num = parseFloatOrNull(numStr);
    if (num == null) continue;
    if (out.has(num)) continue;
    const a = li.selectFirst('a[href^=/read/]');
    if (a == null) continue;
    const text = a.text().trim();
    const href = a.attr('href').replace(/^\/+/, '').replace(/\/+$/, '');
    if (href.trim() === '') continue;
    out.set(
      num,
      createComicChapter({
        id: href,
        title: text.trim() === '' ? `第${numStr}话` : text,
        order: num,
      }),
    );
  }
}

/** Kotlin lines 398-400/413-415 — the first `li[data-number]` matching `chapterNum`. */
function chapterReadPath(root: HtmlElement, chapterNum: number): string | null {
  const hit = root
    .select('li.item[data-number]')
    .find((it) => parseChapterNumber(it) === chapterNum)
    ?.selectFirst('a[href^=/read/]')
    ?.attr('href');
  return hit == null ? null : hit.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Kotlin `it.attr("data-number").trim().toFloatOrNull()`. */
function parseChapterNumber(el: HtmlElement): number | null {
  return parseFloatOrNull(el.attr('data-number').trim());
}

// ---------------------------------------------------------------------------
// Kotlin 778-798 parseJsonLdAuthor
// ---------------------------------------------------------------------------

function parseJsonLdAuthor(doc: HtmlDocument): string {
  for (const script of doc.select('script[type=application/ld+json]')) {
    const text = script.html().trim();
    if (!text.includes('"author"')) continue;
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith('[')) {
        const arr: unknown = JSON.parse(trimmed);
        if (isJsonArray(arr)) {
          for (let i = 0; i < arr.length; i += 1) {
            const name = optString(
              optJsonObject(arrayOptJsonObject(arr, i), 'author'),
              'name',
              '',
            );
            if (name != null && name.trim() !== '') return name;
          }
        }
      } else {
        const json: unknown = JSON.parse(trimmed);
        const name = optString(
          optJsonObject(isJsonObject(json) ? json : null, 'author'),
          'name',
          '',
        );
        if (name != null && name.trim() !== '') return name;
      }
    } catch {
      // Kotlin `catch (_: Exception) {}` — malformed ld+json is skipped.
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Kotlin 800-818 languageLabel
// ---------------------------------------------------------------------------

/** Kotlin `private fun languageLabel(code: String): String`. */
function languageLabel(code: string): string {
  switch (code.toUpperCase()) {
    case 'ZH':
    case 'ZH-HK':
    case 'ZH-CN':
    case 'ZH-TW':
      return '中文';
    case 'EN':
      return '英文';
    case 'JA':
      return '日文';
    case 'KO':
      return '韩文';
    case 'ES':
      return '西班牙语';
    case 'PT-BR':
    case 'PT':
      return '葡萄牙语';
    case 'FR':
      return '法语';
    case 'DE':
      return '德语';
    case 'RU':
      return '俄语';
    case 'IT':
      return '意大利语';
    case 'AR':
      return '阿拉伯语';
    case 'CA':
      return '加泰罗尼亚语';
    case 'TR':
      return '土耳其语';
    case 'TH':
      return '泰语';
    case 'VI':
      return '越南语';
    case 'ID':
      return '印尼语';
    default:
      return code.toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// Kotlin line 301-302 officialUuid (module-level: pure)
// ---------------------------------------------------------------------------

function officialUuid(bookId: string): string | null {
  return bookId.startsWith('mdapi:') ? bookId.slice('mdapi:'.length) : null;
}

/** Kotlin 131-132 normalizeTitle (module-level: pure). */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[\s＆&！!？?，,。·・:：\-—～~]/g, '');
}

/** Kotlin 319-325 — main title preference order, used by both call sites. */
async function firstMainTitle(api: JsonObject | null): Promise<string | null> {
  const titles = optJsonObject(
    optJsonObject(optJsonObject(api, 'data'), 'attributes'),
    'title',
  );
  if (titles == null) return null;
  return firstNotNullOfOrNull(['en', 'ja-ro', 'ja', 'zh-hans', 'zh'], (key) => {
    const value = optString(titles, key, '') ?? '';
    return value.trim() === '' ? null : value;
  });
}

// ---------------------------------------------------------------------------
// small local helpers
// ---------------------------------------------------------------------------

/** Kotlin `blocks.sortedBy { preferred.indexOf(...) … }` — stable, rank 10 for the rest. */
function sortByLanguage(blocks: HtmlElement[], preferred: string[]): HtmlElement[] {
  const rank = (el: HtmlElement): number => {
    const idx = preferred.indexOf(el.attr('data-code').toUpperCase());
    return idx >= 0 ? idx : 10;
  };
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const diff = rank(a.block) - rank(b.block);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((it) => it.block);
}

/** Kotlin `String.toIntOrNull() ?: fallback`. */
function parseIntOr(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Kotlin `String.toFloatOrNull()`. */
function parseFloatOrNull(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const parsed = Number.parseFloat(s);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Kotlin `JSONObject.optDouble("chapter", Double.NaN)`. */
function optDouble(obj: JsonObject, key: string): number {
  const value = obj[key];
  if (value === undefined || value === null) return Number.NaN;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Kotlin `JSONObject.optInt("total", offset)`. */
function optInt(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Kotlin `attrs.isNull("externalUrl")` — true when absent or the NULL sentinel. */
function isJsonNull(value: JsonValue | undefined): boolean {
  return value === undefined || value === null;
}

/** Kotlin `rels.firstNotNullOfOrNull { it["type"] == "manga" → it["id"] }`. */
function firstRelationshipId(rels: JsonValue[], type: string): string | null {
  for (let i = 0; i < rels.length; i += 1) {
    const rel = arrayOptJsonObject(rels, i);
    if (rel == null) continue;
    if ((optString(rel, 'type', '') ?? '') !== type) continue;
    const id = optString(rel, 'id', null);
    if (id != null) return id;
  }
  return null;
}

/** Kotlin `ComicInfo.copy(artists = …)`. */
function withArtists(info: ComicInfo, artists: string[]): ComicInfo {
  return { ...info, artists };
}

/** Kotlin `optString(key, "").ifBlank { null }`. */
function blankToNull(raw: string | null | undefined): string | null {
  return raw == null || raw.trim() === '' ? null : raw;
}

/** Kotlin `listOf(a, b, c).firstOrNull { !it.isNullOrBlank() }`. */
function firstNonEmpty(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate != null && candidate.trim() !== '') return candidate;
  }
  return null;
}

/** Kotlin `java.net.URI(url).host?.lowercase().orEmpty()`. */
function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** Kotlin `android.util.Log.i(TAG, msg)` → the shared SourceLog debug buffer. */
function logInfo(message: string): void {
  SourceLog.log(TAG, message);
}

/**
 * Kotlin `android.util.Log.e(TAG, msg, e)` — the throwable goes to logcat's stack
 * trace and is **not** part of the logged text, so only `message` is written.
 */
function logError(message: string): void {
  SourceLog.log(TAG, message);
}

/** Kotlin `${e.message}` (null renders as the literal "null"). */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return e == null ? 'null' : String(e);
}

// ---------------------------------------------------------------------------
// `runCatching` shims
// ---------------------------------------------------------------------------

interface ResultBox<T> {
  readonly ok: boolean;
  readonly value: T;
  readonly error: unknown;
}

/** Kotlin `runCatching { … }` around a `suspend` body. */
async function runCatchingAsync<T>(block: () => Promise<T>): Promise<ResultBox<T>> {
  try {
    return { ok: true, value: await block(), error: null };
  } catch (e) {
    return { ok: false, value: undefined as T, error: e };
  }
}

/**
 * Minimal insertion-ordered LRU with a fixed entry bound — the local stand-in
 * for the Kotlin `LinkedHashMap` + manual `remove(keys.first())` pattern used at
 * lines 106-110, 240-244 and 332-335.
 */
/**
 * Kotlin `LinkedHashMap<String, String>`（accessOrder = **false**，即插入序）
 * 配 `if (size > N) remove(keys.first())` —— 驱逐**最早插入**的键。
 *
 * E90：原先的 `put` 先 `delete(key)` 再 `set(key, value)`，把「覆盖已有键」变成了
 * 「删除再插入」，于是反复续写同一个 key 会把它挪到队尾，最终驱逐顺序与 Kotlin 不同。
 * `Map.set` 对**已存在**的键本来就只更新值、不改插入序（与 LinkedHashMap 一致），
 * 所以正确写法是什么都不做。
 */
export class LruCacheImpl<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  put(key: K, value: V): void {
    // Kotlin `LinkedHashMap[k] = v`：已存在则**只更新值、保持原插入位**。
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      this.map.delete(oldest.value);
    }
  }
}


/**
 * Android `com.example.source.impl.AutoNovelSource.kt` (180 lines, 168 non-blank)
 * → `src/core/source/impl/autoNovelSource.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-20     package/imports                        → header + imports
 *   21       class KDoc (verbatim)
 *   22-26    class + id/name/capabilities          → ctor + fields
 *   27-33    http client, providers set             → injected http / PROVIDERS
 *   34-40    Metadata / LruCache(16) / Mutex / texts LruCache(4MiB)
 *                                                    → interfaces / LruCache / AsyncMutex
 *   42-49    path()                                 → path()
 *   51-62    json()                                 → json()
 *   64-67    detail()                               → detail()
 *   69-70    title(JSONObject)                      → titleOf()
 *   71-91    book()                                 → book()
 *   93-99    result()                               → result()
 *   101-119  search()                               → search()
 *   121      getDetail()                            → getDetail()
 *   122      refreshNovelDetail()                   → refreshNovelDetail()
 *   123-133  getChapters()                          → getChapters()
 *   135-145  getChapterText()                       → getChapterText()
 *   147-163  paragraphText()                        → paragraphText()
 *   165      getDownloadInfo(bookId)                → getDownloadInfo()
 *   166-174  getDownloadInfo(bookId, preferredFormat) → getDownloadInfoWithFormat()
 *   175-176  getChapterImages()                     → getChapterImages()
 *   177      login()                                → login()
 *   178      logout()                               → logout()
 *   179      isLoggedIn()                           → isLoggedIn()
 *
 * Skipped lines / adaptations:
 *   - `context: Context` (line 22) — only feeds the failover client; replaced by
 *     the injected `failover` factory.
 *   - `HttpUrl` → `URL`/string.
 *   - `LruCache<String,String>(4 * 1024 * 1024) { sizeOf = value.length * 2 }`
 *     → `LruCache` with the same `sizeOf` weight; entries evict on 4 Mi chars.
 *   - `readImportBytes(2 * 1024 * 1024)` (line 62) → the shared
 *     `executeSourceRequest(..., { maxBytes: MAX_SOURCE_BODY_BYTES })` bound; an
 *     over-limit body surfaces through `result()`'s generic arm as
 *     `ParseError("压缩包解压体积超过安全上限")`, which is what Kotlin's
 *     `IllegalArgumentException` from `ArchiveBudget.copyEntry` becomes.
 *   - `SystemClock.elapsedRealtime()` → `elapsedRealtime()`.
 *   - `java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(...)`
 *     (line 92) → `formatAutoNovelUpdatedAt(secondsSinceEpoch)`. `Locale.CHINA` only
 *     picks the *locale* (numeric fields here, so no visible difference); the **zone is
 *     the device default** on both sides — the port no longer pins `Asia/Shanghai` (E91).
 *   - `withContext(Dispatchers.IO)` dropped; `require(cond){msg}` → `throw new Error(msg)`.
 *   - `ComicSource, UpdatableNovelSource` interfaces → a plain class implementing
 *     the structural shapes (`BookSource` + `UpdatableNovelSource`); `getChapters`
 *     and `getChapterText` are declared explicitly (TS interfaces cannot mix a
 *     class with those two extra members as cleanly as Kotlin interfaces do).
 *   - `override suspend fun getDownloadInfo(bookId)` delegates to the 2-arg
 *     overload with `"epub"` — TS exposes `getDownloadInfoWithFormat` on
 *     `BookSource`, matching the existing convention.
 */

import { ComicSource } from '../comicSource';
import { createComicChapter } from '../comicChapter';
import type { ComicChapter } from '../comicChapter';
import { createDownloadInfo } from '../downloadInfo';
import type { DownloadInfo } from '../downloadInfo';
import type { LoginCredential } from '../loginCredential';
import { createNovelInfo } from '../novelInfo';
import { createSearchBook } from '../searchBook';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import type { SourceCapabilities } from '../sourceCapabilities';
import { LoginRequired, NetworkError, ParseError, SourceException } from '../sourceException';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import {
  arrayOptString,
  isJsonObject,
  optJsonArray,
  optLong,
  optString,
  parseJsonObjectOrThrow,
} from './jsonSupport';
import type { JsonObject } from './jsonSupport';
import {
  AsyncMutex,
  LruCache,
  MAX_SOURCE_BODY_BYTES,
  SourceNetworkError,
  buildUrl,
  decodeUtf8,
  elapsedRealtime,
  executeSourceRequest,
  isSuccessful,
  resolveHttpClient,
} from './sourceHttp';
import type { FailoverClientFactory, HttpClient } from './sourceHttp';

/** Guest-facing AutoNovel web-novel API, independently adapted from its public API contract. */
/** Kotlin `private data class Metadata(val at: Long, val data: JSONObject)`. */
interface AutoNovelMetadata {
  readonly at: number;
  readonly data: JsonObject;
}

export class AutoNovelSource extends ComicSource {
  readonly id = 'auto_novel';
  readonly name = '轻小说机翻机器人';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({
    supportOnlineText: true,
  });

  private readonly baseUrl: string;
  private readonly http: HttpClient;
  private readonly providers: ReadonlySet<string> = new Set([
    'syosetu',
    'kakuyomu',
    'novelup',
    'hameln',
    'alphapolis',
  ]);
  /** Kotlin `private data class Metadata(val at: Long, val data: JSONObject)`. */
  private readonly metadata: LruCache<string, AutoNovelMetadata>;
  private readonly metadataMutex = new AsyncMutex();
  /** Kotlin `object : LruCache<String, String>(4 * 1024 * 1024) { sizeOf = length * 2 }`. */
  private readonly texts: LruCache<string, string>;
  private readonly textMutex = new AsyncMutex();

  constructor(
    options: {
      baseUrl?: string;
      client?: HttpClient | null;
      failover?: FailoverClientFactory;
    } = {},
  ) {
    super();
    this.baseUrl = options.baseUrl ?? 'https://n.novelia.cc/';
    this.http = resolveHttpClient(options.client ?? null, options.failover);
    this.metadata = new LruCache<string, AutoNovelMetadata>(16);
    this.texts = new LruCache<string, string>(4 * 1024 * 1024, (_key, value) => value.length * 2);
  }

  private path(bookId: string): string {
    const parts = bookId.split('/');
    if (
      parts.length !== 2 ||
      !this.providers.has(parts[0] as string) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(parts[1] as string)
    ) {
      throw new Error('无效的小说标识');
    }
    return buildUrl(this.baseUrl, ['api/novel', parts[0] as string, parts[1] as string]);
  }

  private async json(url: string): Promise<JsonObject> {
    // Kotlin L62 `response.body?.byteStream()?.use { it.readImportBytes(2 * 1024 * 1024) }`
    // — the shared request helper applies that bound (an over-limit body throws
    // `压缩包解压体积超过安全上限`, which `result()`'s `catch (e: Exception)` arm
    // maps to `ParseError`, exactly like Kotlin's `IllegalArgumentException`).
    const response = await executeSourceRequest(this.http, url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36',
        Referer: this.baseUrl,
      },
      maxBytes: MAX_SOURCE_BODY_BYTES,
    });
    if (response.status === 401) {
      throw new LoginRequired();
    }
    if (!isSuccessful(response)) {
      throw new NetworkError(`轻小说源返回 HTTP ${response.status}`);
    }
    if (response.body.byteLength === 0) {
      throw new ParseError('轻小说源返回空响应');
    }
    return parseJsonObjectOrThrow(decodeUtf8(response.body));
  }

  private async detail(bookId: string, fresh = false): Promise<JsonObject> {
    return this.metadataMutex.withLock(async () => {
      const cached = this.metadata.get(bookId);
      if (cached !== undefined && !fresh && elapsedRealtime() - cached.at < 60_000) {
        return cached.data;
      }
      const data = await this.json(this.path(bookId));
      this.metadata.put(bookId, { at: elapsedRealtime(), data });
      return data;
    });
  }

  /** Kotlin `private fun title(data: JSONObject)`. */
  private titleOf(data: JsonObject): string {
    const zh = optString(data, 'titleZh', '') ?? '';
    if (zh.trim() !== '') return zh;
    return optString(data, 'titleJp', '') ?? '';
  }

  private book(bookId: string, data: JsonObject): SearchBook {
    const author = (() => {
      const authors = optJsonArray(data, 'authors');
      if (authors == null) return '';
      const names: string[] = [];
      for (let i = 0; i < authors.length; i += 1) {
        const author = authors[i];
        if (!isJsonObject(author)) continue;
        const name = optString(author, 'name', '') ?? '';
        if (name.trim() !== '') names.push(name);
      }
      return names.join('、');
    })();
    const toc = optJsonArray(data, 'toc');
    const chapters = (() => {
      if (toc == null) return null;
      const out: JsonObject[] = [];
      for (let i = 0; i < toc.length; i += 1) {
        const chapter = toc[i];
        if (!isJsonObject(chapter)) continue;
        if ((optString(chapter, 'chapterId', '') ?? '').trim() === '') continue;
        out.push(chapter);
      }
      return out;
    })();
    const updated = optLong(data, 'updateAt', optLong(data, 'syncAt', 0));
    const tags = (() => {
      const keywords = optJsonArray(data, 'keywords');
      if (keywords == null) return [];
      const out: string[] = [];
      for (let i = 0; i < keywords.length; i += 1) {
        const tag = arrayOptString(keywords, i, '');
        if (tag != null && tag.trim() !== '') out.push(tag);
      }
      return out;
    })();
    return createSearchBook({
      id: bookId,
      sourceId: this.id,
      title: this.titleOf(data),
      author,
      format: 'epub',
      language: '中文（机翻）',
      description:
        '日本轻小说 Web 版，正文为中文机器翻译；缺译章节会提示等待译文。\n\n' +
        (optString(data, 'introductionZh', '') ?? ''),
      novelInfo: createNovelInfo({
        synopsis: optString(data, 'introductionZh', null),
        originalTitle: optString(data, 'titleJp', null),
        status: optString(data, 'type', null),
        latestChapter:
          chapters != null && chapters.length > 0
            ? this.titleOf(chapters[chapters.length - 1] as JsonObject)
            : null,
        chapterCount:
          chapters != null
            ? chapters.length
            : (() => {
                const jp = optLong(data, 'jp');
                return jp > 0 ? jp : null;
              })(),
        updatedAt:
          updated > 0 ? formatAutoNovelUpdatedAt(updated) : null,
        tags,
        translation: '中文机翻 · 日本 Web 版',
        notice: '机器翻译；整本文件的缺译章节取决于原站译文进度。',
      }),
    });
  }

  private async result<T>(block: () => Promise<T>): Promise<SourceResultType<T>> {
    try {
      return SourceResult.Success(await block());
    } catch (e) {
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError('轻小说源连接失败，请稍后重试', e));
      }
      if (e instanceof Error) return SourceResult.Error(new ParseError(e.message));
      return SourceResult.Error(new ParseError('轻小说数据格式异常'));
    }
  }

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    return this.result(async () => {
      const query = keyword.trim();
      if (query === '') return [];
      if (['re0', 'rezero'].includes(query.toLowerCase().replace(/[ :：-]/g, ''))) {
        return [this.book('syosetu/n2267be', await this.detail('syosetu/n2267be'))];
      }
      const url = buildUrl(
        this.baseUrl,
        ['api/novel'],
        [
          ['page', '0'],
          ['pageSize', '20'],
          ['query', query],
          ['provider', [...this.providers].join(',')],
          ['type', '0'],
          ['level', '1'],
          ['translate', '2'],
          ['sort', '0'],
        ],
      );
      const items = optJsonArray(await this.json(url), 'items');
      if (items == null) {
        throw new ParseError('未返回小说列表');
      }
      const books: SearchBook[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!isJsonObject(item)) continue;
        const provider = optString(item, 'providerId', '') ?? '';
        const novel = optString(item, 'novelId', '') ?? '';
        if (!this.providers.has(provider) || novel.trim() === '' || this.titleOf(item).trim() === '') {
          continue;
        }
        books.push(this.book(`${provider}/${novel}`, item));
      }
      const seen = new Set<string>();
      return books.filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
    });
  }

  async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    return this.result(async () => this.book(bookId, await this.detail(bookId)));
  }

  async refreshNovelDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    return this.result(async () => this.book(bookId, await this.detail(bookId, true)));
  }

  async getChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    return this.result(async () => {
      const toc = optJsonArray(await this.detail(bookId), 'toc');
      if (toc == null) {
        throw new ParseError('未返回完整目录');
      }
      let group = '';
      const chapters: ComicChapter[] = [];
      for (let i = 0; i < toc.length; i += 1) {
        const item = toc[i];
        if (!isJsonObject(item)) continue;
        const chapterId = optString(item, 'chapterId', '') ?? '';
        if (chapterId.trim() === '') {
          group = this.titleOf(item);
          continue;
        }
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(chapterId)) {
          throw new Error('章节标识无效');
        }
        chapters.push(
          createComicChapter({
            id: `${bookId}/${chapterId}`,
            title: this.titleOf(item),
            volume: group,
            order: i,
          }),
        );
      }
      const seen = new Set<string>();
      const distinct = chapters.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      if (distinct.length === 0) {
        throw new Error('小说目录为空');
      }
      return distinct;
    });
  }

  override async getChapterText(chapterId: string): Promise<SourceResultType<string>> {
    return this.result(async () =>
      this.textMutex.withLock(async () => {
        const cached = this.texts.get(chapterId);
        if (cached !== undefined) return cached;
        const slash = chapterId.lastIndexOf('/');
        const bookId = slash >= 0 ? chapterId.slice(0, slash) : chapterId;
        const chapter = slash >= 0 ? chapterId.slice(slash + 1) : '';
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(chapter)) {
          throw new Error('章节标识无效');
        }
        const data = await this.json(
          buildUrl(this.path(bookId), ['chapter', chapter]),
        );
        const text = paragraphText(data);
        this.texts.put(chapterId, text);
        return text;
      }),
    );
  }

  override async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return this.getDownloadInfoWithFormat(bookId, 'epub');
  }

  override async getDownloadInfoWithFormat(
    bookId: string,
    preferredFormat?: string | null,
  ): Promise<SourceResultType<DownloadInfo>> {
    return this.result(async () => {
      const format =
        preferredFormat?.toLowerCase() !== undefined &&
        (preferredFormat?.toLowerCase() === 'epub' || preferredFormat?.toLowerCase() === 'txt')
          ? (preferredFormat?.toLowerCase() as string)
          : 'epub';
      const detailData = await this.detail(bookId);
      const fileName = `${this.titleOf(detailData).replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
      const url = new URL(buildUrl(this.path(bookId), ['file']));
      url.searchParams.append('mode', 'zh');
      url.searchParams.append('translationsMode', 'priority');
      url.searchParams.append('type', format);
      url.searchParams.append('filename', fileName);
      for (const translation of ['sakura', 'gpt', 'youdao', 'baidu']) {
        url.searchParams.append('translations', translation);
      }
      return createDownloadInfo({
        url: url.toString(),
        fileName,
        format,
        referer: this.baseUrl,
      });
    });
  }

  override async getChapterImages(_chapterId: string): Promise<SourceResultType<string[]>> {
    return SourceResult.Error(new ParseError('请使用小说文字阅读器'));
  }

  async login(_credential: LoginCredential): Promise<SourceResultType<boolean>> {
    return SourceResult.Success(true);
  }

  async logout(): Promise<void> {}

  async isLoggedIn(): Promise<boolean> {
    return true;
  }
}

/**
 * Kotlin `internal fun paragraphText(data: JSONObject): String`
 * (module-level in Kotlin because it is `internal`; kept module-level here so it
 * is unit-testable without instantiating the source).
 */
export function paragraphText(data: JsonObject): string {
  const original = optJsonArray(data, 'paragraphs');
  if (original == null) {
    throw new ParseError('正文缺失');
  }
  const translations = ['sakuraParagraphs', 'gptParagraphs', 'youdaoParagraphs', 'baiduParagraphs']
    .map((key) => {
      const arr = optJsonArray(data, key);
      return arr != null && arr.length === original.length ? arr : null;
    })
    .filter((arr): arr is NonNullable<typeof arr> => arr != null);
  let missing = 0;
  const paragraphs: string[] = [];
  for (let i = 0; i < original.length; i += 1) {
    const raw = original[i];
    const source = typeof raw === 'string' ? raw.trim() : '';
    let text: string | null = null;
    for (const translation of translations) {
      const value = translation[i];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed !== '') {
        text = trimmed;
        break;
      }
    }
    if (text == null) {
      if (source.startsWith('<图片>') || !/\p{L}/u.test(source)) {
        text = source;
      } else {
        missing += 1;
        text = '';
      }
    }
    paragraphs.push(text.startsWith('<图片>') ? `[插图] ${text.slice('<图片>'.length)}` : text);
  }
  if (missing > 0) {
    throw new ParseError(`本章中文译文尚未齐全（缺 ${missing} 段），请稍后重试`);
  }
  const joined = paragraphs.filter((p) => p.trim() !== '').join('\n\n');
  if (joined.trim() === '') {
    throw new Error('本章中文译文为空');
  }
  return joined;
}

/**
 * Kotlin `AutoNovelSource.kt:92`:
 * ```kotlin
 * SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.CHINA).format(java.util.Date(it * 1000))
 * ```
 *
 * ⚠️ `Locale.CHINA` 只决定**区域格式化**（本页模式下纯数字，故无可见差异），
 * **时区用的是设备默认时区**（`SimpleDateFormat` 的默认 `TimeZone.getDefault()`）。
 * 本函数此前显式钉了 `Asia/Shanghai`，在非东八区设备上会与 Android 差一个偏移（E91）。
 *
 * `Intl.DateTimeFormat` 不传 `timeZone` 时同样使用运行时默认时区 —— 正是 Kotlin 的语义。
 * `en-CA` 的 locale 数据给出 `YYYY-MM-DD` 序，与 `yyyy-MM-dd` 一致。
 */
export function formatAutoNovelUpdatedAt(secondsSinceEpoch: number): string {
  const date = new Date(secondsSinceEpoch * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    // 不指定 timeZone ⇒ 用设备默认时区，与 Kotlin `SimpleDateFormat` 一致。
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
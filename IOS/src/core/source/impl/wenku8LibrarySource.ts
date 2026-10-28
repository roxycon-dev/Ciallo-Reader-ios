/**
 * Android `com.example.source.impl.Wenku8LibrarySource.kt` (103 lines, 100 non-blank)
 * → `src/core/source/impl/wenku8LibrarySource.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-20     package/imports                       → header + imports
 *   21       class KDoc (verbatim)
 *   22-26    class + id/name/capabilities         → ctor + fields
 *   27-33    http client / Cached / LruCache(16) / Mutex → injected http / interface / LruCache / AsyncMutex
 *   35-39    bookUrl()                             → bookUrl()
 *   40-49    json()                                → json()
 *   50-71    book(JSONObject)                      → book()
 *   72-75    detail()                              → detail()
 *   76-82    result()                              → result()
 *   83-91    search()                              → search()
 *   92       getDetail()                           → getDetail()
 *   93       refreshNovelDetail()                  → refreshNovelDetail()
 *   94-98    getDownloadInfo()                     → getDownloadInfo()
 *   99       login()                               → login()
 *   100      logout()                              → logout()
 *   101      isLoggedIn()                          → isLoggedIn()
 *
 * Skipped lines / adaptations:
 *   - `context: Context` (line 22) — only feeds the failover client; replaced by
 *     the injected `failover` factory.
 *   - `HttpUrl` → `URL` / string; `addPathSegments("api/books")` → `['api/books']`.
 *   - `JSONObject.optLong("id").toString()` (line 51) — `optLong` already yields a
 *     number, so `String(n)` matches Kotlin's `Long.toString()` except for
 *     negative zero / -0L, which cannot come from this API.
 *   - `org.jsoup.Jsoup.parse(intro).text()` (lines 63/64) → the shared jsoup
 *     subset's `parseHtmlDocument(intro).text()`.
 *   - `"%,d 字".format(it)` (line 68) → `formatGrouped(it)` reproducing Kotlin's
 *     `'%' + ',' + 'd'` Locale grouping.
 *   - `readImportBytes(2 * 1024 * 1024)` (line 50) → the shared
 *     `executeSourceRequest(..., { maxBytes: MAX_SOURCE_BODY_BYTES })` bound.
 *   - `SystemClock.elapsedRealtime()` → `elapsedRealtime()`.
 *   - `withContext(Dispatchers.IO)` dropped; `require(cond){msg}` → `throw new Error(msg)`.
 */

import { BookSource } from '../bookSource';
import { createNovelInfo } from '../novelInfo';
import { createDownloadInfo } from '../downloadInfo';
import type { DownloadInfo } from '../downloadInfo';
import type { LoginCredential } from '../loginCredential';
import { createSearchBook } from '../searchBook';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import type { SourceCapabilities } from '../sourceCapabilities';
import { NetworkError, ParseError, SourceException } from '../sourceException';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { parseHtmlDocument } from './jsoup';
import {
  arrayOptString,
  isJsonObject,
  optJsonArray,
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

/** Kotlin `private data class Cached(val at: Long, val json: JSONObject)`. */
interface Wenku8Cached {
  readonly at: number;
  readonly json: JsonObject;
}

/** Public Chinese EPUB catalogue. Resolve temporary storage links only when the worker downloads. */
export class Wenku8LibrarySource extends BookSource {
  readonly id = 'wenku8_library';
  readonly name = '轻小说中文文库';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({ supportEbook: true });

  private readonly baseUrl: string;
  private readonly http: HttpClient;
  /** Kotlin `private data class Cached(val at: Long, val json: JSONObject)`. */
  private readonly cache: LruCache<string, Wenku8Cached>;
  private readonly mutex = new AsyncMutex();

  constructor(
    options: {
      baseUrl?: string;
      client?: HttpClient | null;
      failover?: FailoverClientFactory;
    } = {},
  ) {
    super();
    this.baseUrl = options.baseUrl ?? 'https://wenku8.ywy.moe/';
    this.http = resolveHttpClient(options.client ?? null, options.failover);
    this.cache = new LruCache<string, Wenku8Cached>(16);
  }

  private bookUrl(bookId: string): string {
    if (!/^[1-9][0-9]{0,8}$/.test(bookId)) {
      throw new Error('无效的文库书籍标识');
    }
    return buildUrl(this.baseUrl, ['api/books', bookId]);
  }

  private async json(url: string): Promise<JsonObject> {
    // Kotlin L50 `response.body?.byteStream()?.use { it.readImportBytes(2 * 1024 * 1024) }`
    // — the shared request helper applies that bound (an over-limit body throws
    // `压缩包解压体积超过安全上限`, which `result()`'s `catch (e: Exception)` arm
    // maps to `ParseError`, exactly like Kotlin's `IllegalArgumentException`).
    const response = await executeSourceRequest(this.http, url, {
      headers: {
        Accept: 'application/json',
        Referer: this.baseUrl,
      },
      maxBytes: MAX_SOURCE_BODY_BYTES,
    });
    if (!isSuccessful(response)) {
      throw new NetworkError(`中文文库返回 HTTP ${response.status}`);
    }
    if (response.body.byteLength === 0) {
      throw new ParseError('中文文库返回空响应');
    }
    return parseJsonObjectOrThrow(decodeUtf8(response.body));
  }

  private book(data: JsonObject): SearchBook {
    const bookId = String(optLong(data, 'id'));
    // Kotlin line 53: `bookUrl(bookId)` — result unused, kept as an id validation.
    this.bookUrl(bookId);
    const title = optString(data, 'title', '') ?? '';
    if (title.trim() === '') {
      throw new Error('文库书名为空');
    }
    const volumes = optInt(data, 'volumeCount');
    const updated = optString(data, 'updatedAt', '') ?? '';
    const intro = optString(data, 'synopsis', '') ?? '';
    const introText = parseHtmlDocument(intro).text();
    return createSearchBook({
      id: bookId,
      sourceId: this.id,
      title,
      author: optString(data, 'author', '') ?? '',
      cover: (() => {
        const coverUrl = optString(data, 'coverUrl', null);
        if (coverUrl == null || coverUrl.trim() === '') return null;
        return resolveCoverUrl(this.baseUrl, coverUrl);
      })(),
      format: 'epub',
      language: '中文',
      size: (() => {
        const bytes = optLong(data, 'epubBytes');
        return bytes > 0 ? bytes : null;
      })(),
      description:
        '中文轻小说文库版 EPUB，含插图，下载入书架后阅读。译本信息以书内注明为准。\n' +
        `文库收录 ${volumes} 卷 · 更新 ${updated}；可能晚于原版发行。\n\n` +
        introText,
      novelInfo: createNovelInfo({
        synopsis: introText,
        status: (() => {
          switch (optString(data, 'status', '') ?? '') {
            case 'completed':
              return '已完结';
            case 'ongoing':
              return '连载中';
            default:
              return null;
          }
        })(),
        updatedAt: updated.trim() !== '' ? updated : null,
        volumeCount: volumes > 0 ? volumes : null,
        chapterCount: (() => {
          const chapters = optInt(data, 'chapterCount');
          return chapters > 0 ? chapters : null;
        })(),
        wordCount: (() => {
          const words = optLong(data, 'wordCount');
          return words > 0 ? `${formatGrouped(words)} 字` : null;
        })(),
        publisher: (() => {
          const publisher = optString(data, 'publisher', '') ?? '';
          return publisher.trim() !== '' ? publisher : null;
        })(),
        tags: (() => {
          const tags = optJsonArray(data, 'tags');
          if (tags == null) return [];
          const out: string[] = [];
          for (let i = 0; i < tags.length; i += 1) {
            const value = arrayOptString(tags, i, '');
            if (value != null && value.trim() !== '') out.push(value);
          }
          return out;
        })(),
        translation: '中文译本 · 文库版',
        notice: '含插图；译者以书内标注为准，收录可能晚于原版发行。',
      }),
    });
  }

  private async detail(bookId: string, fresh = false): Promise<JsonObject> {
    return this.mutex.withLock(async () => {
      const cached = this.cache.get(bookId);
      if (cached !== undefined && !fresh && elapsedRealtime() - cached.at < 60_000) {
        return cached.json;
      }
      const json = await this.json(this.bookUrl(bookId));
      this.cache.put(bookId, { at: elapsedRealtime(), json });
      return json;
    });
  }

  private async result<T>(action: () => Promise<T>): Promise<SourceResultType<T>> {
    try {
      return SourceResult.Success(await action());
    } catch (e) {
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError('中文文库连接失败，请稍后重试', e));
      }
      if (e instanceof Error) return SourceResult.Error(new ParseError(e.message));
      return SourceResult.Error(new ParseError('中文文库数据格式异常'));
    }
  }

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    return this.result(async () => {
      if (keyword.trim() === '') return [];
      const url = buildUrl(
        this.baseUrl,
        ['api/books'],
        [
          ['q', keyword.trim()],
          ['page', '1'],
          ['limit', '24'],
        ],
      );
      const items = optJsonArray(await this.json(url), 'items');
      if (items == null) {
        throw new ParseError('未返回文库书籍列表');
      }
      const books: SearchBook[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const data = items[i];
        if (!isJsonObject(data)) continue;
        const book = this.book(data);
        this.cache.put(book.id, { at: elapsedRealtime(), json: data });
        books.push(book);
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
    return this.result(async () => this.book(await this.detail(bookId)));
  }

  async refreshNovelDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    return this.result(async () => this.book(await this.detail(bookId, true)));
  }

  async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return this.result(async () => {
      const title = this.book(await this.detail(bookId)).title.replace(/[\\/:*?"<>|]/g, '_');
      return createDownloadInfo({
        url: buildUrl(this.bookUrl(bookId), ['download']),
        fileName: `${title}.epub`,
        format: 'epub',
        referer: this.baseUrl,
      });
    });
  }

  async login(_credential: LoginCredential): Promise<SourceResultType<boolean>> {
    return SourceResult.Success(true);
  }

  async logout(): Promise<void> {}

  async isLoggedIn(): Promise<boolean> {
    return true;
  }
}

// --- local helpers transcribed from the org.json calls used above ------------

/** Kotlin `data.optLong("id")` — 0 when absent or unparseable. */
function optLong(data: JsonObject, key: string): number {
  const value = data[key];
  if (value === undefined || value === null) return 0;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Kotlin `data.optInt("volumeCount")`. */
function optInt(data: JsonObject, key: string): number {
  const parsed = optLong(data, key);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Kotlin `baseUrl.resolve(it)?.toString()`. */
function resolveCoverUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Kotlin `"%,d".format(value)` — Locale-independent grouping on 3 digits. */
function formatGrouped(value: number): string {
  return value.toLocaleString('en-US');
}
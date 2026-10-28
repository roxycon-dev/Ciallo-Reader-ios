/**
 * Android `com.example.source.impl.IxdzsSource.kt` (112 lines, 109 non-blank)
 * → `src/core/source/impl/ixdzsSource.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-19     package/imports                   → header + imports
 *   21       class KDoc "Search and download links from the site's public guest-facing HTML." (verbatim)
 *   22-26    class + id/name/capabilities     → ctor + fields
 *   27-32    http client (SharedHttpTransport + JsSourceProxy.failoverClient)
 *                                            → injected `http` (HttpClient); failover factory optional
 *   33-35    Detail data class / LruCache(16) / Mutex
 *                                            → IxdzsDetail interface / LruCache(16) / AsyncMutex
 *   37-40    bookUrl()                        → bookUrl()
 *   41-50    page()                           → page()
 *   51-75    detail()                         → detail()
 *   76-82    result()                         → result()
 *   83-101   search()                         → search()
 *   102      getDetail()                      → getDetail()
 *   103      refreshNovelDetail()             → refreshNovelDetail()
 *   104-108  getDownloadInfo()                → getDownloadInfo()
 *   109      login()                          → login()
 *   110      logout()                         → logout()
 *   111      isLoggedIn()                     → isLoggedIn()
 *
 * Skipped lines / adaptations:
 *   - `context: Context` ctor parameter (line 22) — only used to build the
 *     failover client; replaced by the injected `failover` factory. Not stored.
 *   - `baseUrl: HttpUrl` → `baseUrl: string` (WHATWG `URL` inside helpers).
 *     `HttpUrl.newBuilder().addPathSegment("read").addPathSegment(bookId)
 *     .addPathSegment("")` (trailing slash) → `buildUrl(base, ['read', bookId, ''])`.
 *   - `require(cond) { msg }` → `throw new Error(msg)` with identical text.
 *   - `SystemClock.elapsedRealtime()` → `elapsedRealtime()` (`performance.now()`).
 *   - `doc.selectFirst(...)!!` (line 60, would NPE) → explicit null check that
 *     throws `未找到小说详情，站点可能暂时不可用`; the Kotlin NPE message is not
 *     reproduced because it is not user-facing text.
 *   - `doc.selectFirst(".n-text")!!` (line 61) → the NPE carries **no** message, so
 *     on this side it throws `ParseError('网文页面解析失败')` — the string
 *     `result()`'s `catch (e: Exception) { e.message ?: "网文页面解析失败" }`
 *     produces on Android.
 *   - `absUrl("src")` (lines 65 / 94) → the local `absUrl(baseUrl, raw)`: jsoup
 *     resolves the raw attribute against the document base URI and returns `""`
 *     when unresolvable, so `page()` now hands back `{ doc, baseUrl }` and the
 *     helper mirrors `StringUtil.resolve` via the shared `resolveUrl`.
 *   - `readImportBytes(2 * 1024 * 1024)` (line 47) → the shared
 *     `executeSourceRequest(..., { maxBytes: MAX_SOURCE_BODY_BYTES })` bound.
 *   - `withContext(Dispatchers.IO)` dropped (JS has no thread switch).
 *   - `catch (e: CancellationException) { throw e }` — a JS promise abort is
 *     already a rejection; the guard becomes a rethrow of the original error.
 *   - `java.io.IOException` → `SourceNetworkError` (the transport throws it).
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
import { LoginRequired, NetworkError, ParseError, SourceException } from '../sourceException';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { parseHtmlDocument } from './jsoup';
import type { HtmlElement } from './jsoup';
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
  resolveUrl,
} from './sourceHttp';
import type { FailoverClientFactory, HttpClient } from './sourceHttp';

/** Kotlin `private data class Detail(val at: Long, val book: SearchBook, val download: String)`. */
interface IxdzsDetail {
  readonly at: number;
  readonly book: SearchBook;
  readonly download: string;
}

/** Search and download links from the site's public guest-facing HTML. */
export class IxdzsSource extends BookSource {
  readonly id = 'ixdzs8';
  readonly name = '爱下电子书';
  readonly capabilities: SourceCapabilities = createSourceCapabilities({ supportEbook: true });

  private readonly baseUrl: string;
  private readonly http: HttpClient;
  /** Kotlin `private data class Detail(val at: Long, val book: SearchBook, val download: String)`. */
  private readonly cache: LruCache<string, IxdzsDetail>;
  private readonly mutex = new AsyncMutex();


  constructor(
    options: {
      baseUrl?: string;
      client?: HttpClient | null;
      failover?: FailoverClientFactory;
    } = {},
  ) {
    super();
    this.baseUrl = options.baseUrl ?? 'https://ixdzs8.com/';
    this.http = resolveHttpClient(options.client ?? null, options.failover);
    this.cache = new LruCache<string, IxdzsDetail>(16);
  }

  private bookUrl(bookId: string): string {
    if (!/^[1-9][0-9]{0,8}$/.test(bookId)) {
      throw new Error('无效的网文书籍标识');
    }
    return buildUrl(this.baseUrl, ['read', bookId, '']);
  }

  /**
   * Kotlin L42-50 `page(url)` → `Jsoup.parse(html, url.toString())`.
   *
   * The document's **base URI** is the page URL, which the shared HTML engine does
   * not carry, so it is returned next to the parsed document for `absUrl` use
   * (jsoup resolves relative attributes against it).
   */
  private async page(url: string): Promise<{ doc: HtmlElement; baseUrl: string }> {
    // Kotlin L47 `response.body?.byteStream()?.use { it.readImportBytes(2 * 1024 * 1024) }`
    // — the shared request helper applies that bound (an over-limit body throws
    // `压缩包解压体积超过安全上限`, which `result()`'s generic arm maps to
    // `ParseError`, exactly like Kotlin's `IllegalArgumentException`).
    const response = await executeSourceRequest(this.http, url, {
      headers: {
        Referer: this.baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/139.0.0.0 Mobile Safari/537.36',
      },
      maxBytes: MAX_SOURCE_BODY_BYTES,
    });
    if (!isSuccessful(response)) {
      throw new NetworkError(`爱下电子书返回 HTTP ${response.status}`);
    }
    if (response.body.byteLength === 0) {
      throw new ParseError('网文源返回空页面');
    }
    return { doc: parseHtmlDocument(decodeUtf8(response.body)), baseUrl: url };
  }

  private async detail(bookId: string, fresh = false): Promise<IxdzsDetail> {
    return this.mutex.withLock(async () => {
      const cached = this.cache.get(bookId);
      if (cached !== undefined && !fresh && elapsedRealtime() - cached.at < 60_000) {
        return cached;
      }
      const { doc, baseUrl } = await this.page(this.bookUrl(bookId));
      const title = doc.selectFirst('.novel h1')?.text() ?? '';
      if (title.trim() === '') {
        throw new Error('未找到小说详情，站点可能暂时不可用');
      }
      const downloadLink = doc
        .select('.n-btn a[href]')
        .find((it) => it.text().includes('TXT下载'));
      const downloadAbs = downloadLink == null ? null : resolveUrl(this.baseUrl, downloadLink.attr('href'));
      if (downloadAbs == null) {
        throw new ParseError('本书未提供 TXT 下载');
      }
      const download = new URL(downloadAbs);
      if (
        download.protocol !== 'https:' ||
        !(
          /^down[0-9]+\.ixdzs8\.com$/.test(download.hostname) ||
          download.hostname === new URL(this.baseUrl).hostname
        )
      ) {
        throw new Error('网文下载地址异常');
      }
      const info = doc.selectFirst('.n-text');
      if (info == null) {
        // Kotlin L61 `doc.selectFirst(".n-text")!!` — the NPE carries no message, so
        // `result()`'s `catch (e: Exception)` falls back to `e.message ?: "网文页面解析失败"`.
        throw new ParseError('网文页面解析失败');
      }
      const latest = info.select('p').find((it) => it.text().startsWith('最新:'))?.text() ?? '';
      const updated = info.select('p').find((it) => it.text().startsWith('更新:'))?.text() ?? '';
      const intro = doc.selectFirst('#intro')?.text();
      const book = createSearchBook({
        id: bookId,
        sourceId: this.id,
        title,
        author: info.selectFirst('.bauthor')?.text() ?? '',
        // Kotlin L65 `doc.selectFirst(".n-img img[src]")?.absUrl("src")` — jsoup's
        // `absUrl` resolves the raw attribute against the document base URI and
        // yields "" when the URL cannot be resolved.
        cover: absUrl(baseUrl, doc.selectFirst('.n-img img[src]')?.attr('src')),
        format: 'txt',
        language: '中文',
        description:
          '中文网文，TXT 下载到书架阅读。原站下载包可能缺章或更新滞后。\n' +
          `${latest}\n${updated}\n\n` +
          (intro ?? ''),
        novelInfo: createNovelInfo({
          synopsis: intro ?? null,
          status: info.selectFirst('.lz')?.text() ?? null,
          category: info.selectFirst('.nsort')?.text() ?? null,
          wordCount: info.selectFirst('.nsize')?.text() ?? null,
          latestChapter: afterPrefix(latest, '最新:'),
          updatedAt: afterPrefix(updated, '更新:'),
          tags: doc.select('.tags a').map((it) => it.text()),
          translation: '中文网文',
          notice:
            '原站下载包可能缺章或更新滞后；标称最新章节不代表下载包已有完整正文。',
        }),
      });
      const detailValue: IxdzsDetail = {
        at: elapsedRealtime(),
        book,
        download: download.toString(),
      };
      this.cache.put(bookId, detailValue);
      return detailValue;
    });
  }

  private async result<T>(block: () => Promise<T>): Promise<SourceResultType<T>> {
    try {
      return SourceResult.Success(await block());
    } catch (e) {
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError('网文源连接失败，请稍后重试', e));
      }
      if (e instanceof Error) return SourceResult.Error(new ParseError(e.message));
      return SourceResult.Error(new ParseError('网文页面解析失败'));
    }
  }

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    return this.result(async () => {
      if (keyword.trim() === '') return [];
      const url = buildUrl(this.baseUrl, ['bsearch'], [['q', keyword.trim()]]);
      const { doc, baseUrl } = await this.page(url);
      const books: SearchBook[] = [];
      for (const info of doc.select('.l-info')) {
        const link = info.selectFirst('h3.bname a[href]');
        if (link == null) continue;
        const href = link.attr('href');
        const url2 = resolveUrl(this.baseUrl, href);
        if (url2 == null) continue;
        const match = /^\/read\/([1-9][0-9]{0,8})\/$/.exec(new URL(url2).pathname);
        const bookId = match?.[1];
        if (bookId == null) continue;
        if (new URL(url2).hostname !== new URL(this.baseUrl).hostname || link.text().trim() === '') {
          continue;
        }
        books.push(
          createSearchBook({
            id: bookId,
            sourceId: this.id,
            title: link.text(),
            author: info.selectFirst('.bauthor')?.text() ?? '',
            // Kotlin L94 `info.parent()?.parent()?.selectFirst("img[src]")?.absUrl("src")`.
            cover: absUrl(baseUrl, info.parent()?.parent()?.selectFirst('img[src]')?.attr('src')),
            format: 'txt',
            language: '中文',
            description:
              '中文网文，TXT 下载到书架阅读；原站下载包可能缺章或更新滞后。\n' +
              (info.selectFirst('.l-last')?.text() ?? '') +
              '\n\n' +
              (info.selectFirst('.l-p2')?.text() ?? ''),
            novelInfo: createNovelInfo({
              synopsis: info.selectFirst('.l-p2')?.text() ?? null,
              status: info.selectFirst('.lz')?.text() ?? null,
              category: info.selectFirst('.nsort')?.text() ?? null,
              latestChapter: info.selectFirst('.l-last a')?.text() ?? null,
              translation: '中文网文',
              notice: '原站下载包可能缺章或更新滞后。',
            }),
          }),
        );
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
    return this.result(async () => (await this.detail(bookId)).book);
  }

  /** Kotlin `override suspend fun refreshNovelDetail(bookId)` (line 103). */
  async refreshNovelDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    return this.result(async () => (await this.detail(bookId, true)).book);
  }

  async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return this.result(async () => {
      const data = await this.detail(bookId);
      const filename = `${data.book.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
      return createDownloadInfo({
        url: data.download,
        fileName: filename,
        format: 'txt',
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

/** Kotlin `value.removePrefix(prefix).takeIf(String::isNotBlank)`. */
function afterPrefix(value: string, prefix: string): string | null {
  const stripped = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return stripped.trim() !== '' ? stripped : null;
}

/**
 * Kotlin `Element.absUrl(attributeKey)` (org.jsoup).
 *
 * jsoup resolves the **raw** attribute against the document's base URI (the URL
 * handed to `Jsoup.parse`, `IxdzsSource.kt:49`) and returns `""` when the attribute
 * is absent or the value cannot be resolved (`StringUtil.resolve` swallows the
 * `MalformedURLException`). A live `<base href>` would take precedence in jsoup;
 * the shared HTML engine does not model that element, and ixdzs8 pages do not
 * carry one — see `docs/pending-exceptions/sourceImpl.md`.
 */
function absUrl(baseUrl: string, raw: string | null | undefined): string {
  if (raw == null) return '';
  return resolveUrl(baseUrl, raw) ?? '';
}

// `LoginRequired` is re-exported for parity with the Kotlin `import
// com.example.source.*` wildcard; IxdzsSource never raises it but the sealed
// hierarchy is part of the public error surface of the layer.
export { LoginRequired };
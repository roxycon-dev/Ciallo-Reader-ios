/**
 * Android `com.example.source.impl.JsonBookSource.kt` (645 lines, 602 non-blank)
 * → `src/core/source/impl/jsonBookSource.ts`.
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-26      package/imports                      → header + imports
 *   27-34     class KDoc (verbatim)
 *   35-38     class + config + client              → ctor
 *   40-42     searchItemCache / searchRawCache / configuredHost → Maps + hostOf()
 *   43-56     requestClient (DNS + network interceptor) → policyAppliedClient()
 *   58-81     companion (DEFAULT_UA, defaultClient, createInsecureClient)
 *                                                  → DEFAULT_UA + injected client; TLS section documented
 *   83-84     id/name                              → fields
 *   86-107    isComicLike                          → isComicLike field
 *   109-114   capabilities                         → capabilities field
 *   116-169   search()                             → search()
 *   171-220   getChapters()                        → getChapters()
 *   222-259   getChapterImages()                   → getChapterImages()
 *   261-294   getChapterText()                     → getChapterText()
 *   296-346   searchHtml()                         → searchHtml()
 *   348-369   searchHtmlJson()                     → searchHtmlJson()
 *   371-400   resolveJsonTemplate()                → resolveJsonTemplate()
 *   402-410   selectValue()                        → selectValue()
 *   412-451   fetchHtml()                          → fetchHtml()
 *   453-475   extractImageUrls()                   → extractImageUrls()
 *   477-531   getDetail()                          → getDetail()
 *   533-576   getDownloadInfo()                    → getDownloadInfo()
 *   578-584   login/logout/isLoggedIn              → same
 *   586-607   parseSearchBook()                    → parseSearchBook()
 *   609-614   validateUrl()                        → validateUrl()
 *   616-622   resolveUrl()                         → resolveUrl()
 *   624-644   buildRequest()                       → buildRequest()
 *
 * Skipped lines / adaptations:
 *   - `createInsecureClient()` (lines 66-80) — a trust-all `X509TrustManager`
 *     plus `hostnameVerifier { true }` has no JS/browser equivalent: TLS trust
 *     is owned by the platform network layer, so `config.insecureTls` is
 *     honoured only by the *policy* check on line 53-54 (an insecure-TLS source
 *     must not send Authorization/Cookie), which IS ported. The insecure
 *     transport itself must be supplied by the injected client.
 *   - `okhttp3.Dns { … checkAddress(…) }` (lines 45-49) — the post-DNS private-IP
 *     guard needs a resolver. `src/core/source/networkCalls.ts` already exposes
 *     `checkAddress(host, address, allowed)`; the ported client calls it for the
 *     literal host when the host itself is an IP, and always calls `check(url)`
 *     from the network interceptor, which is the guard that actually blocks a
 *     redirect/response to an unconfigured internal address.
 *   - `android.util.Base64.NO_WRAP` → `base64NoWrap()`.
 *   - `java.net.URLEncoder.encode(k, "UTF-8")` → `formUrlEncode()`.
 *   - `catch (e: IOException) { NetworkError("网络连接错误: …") }` (L168/L220/
 *     L259/L294/L530) → a `SourceNetworkError` arm in front of the generic
 *     `Unknown` arm: the injected transport throws it for the transport failures
 *     OkHttp reports as `IOException`, and Kotlin's later `catch (e: Exception)`
 *     arm is the only other place a non-`SourceException` can land.
 *   - `defaultFormat.ifBlank { "" }` (L348/L372) → `ifBlank(...)`, which keeps a
 *     non-blank value **verbatim** (`.trim()` would strip a padded default).
 *   - `Charset.forName(charset)` → `decodeCharset()` with the UTF-8 fallback.
 *   - `response.close()` → dropped (no handle to release).
 *   - `SystemClock`/`Dispatchers.IO`/`Mutex` not used in this file.
 *   - `suspend fun getDownloadInfo(bookId)` stays on `BookSource`; the Kotlin
 *     `ComicSource` extras (`getChapters`, `getChapterImages`, `getChapterText`)
 *     are declared on the class.
 */

import { ComicSource } from '../comicSource';
import { createComicChapter } from '../comicChapter';
import type { ComicChapter } from '../comicChapter';
import { createDownloadInfo } from '../downloadInfo';
import type { DownloadInfo } from '../downloadInfo';
import type { LoginCredential } from '../loginCredential';
import { getString, resolveArray, resolveStringArray } from '../../parser/jsonPathResolver';
import {
  cleanJsonPath,
  evalFirst,
  evalValues,
  isJsonRule,
  parseHtml,
  selectElements,
} from '../../parser/legadoRule';
import { checkSourceUrl } from '../networkCalls';
import { SourceLog } from '../sourceLog';
import { createSearchBook } from '../searchBook';
import type { SearchBook } from '../searchBook';
import { createSourceCapabilities } from '../sourceCapabilities';
import type { SourceCapabilities } from '../sourceCapabilities';
import type { SourceConfig } from '../sourceConfig';
import {
  BookNotFound,
  NetworkError,
  ParseError,
  SourceException,
  Unknown,
} from '../sourceException';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { parseBodyFragment } from './jsoup';
import type { HtmlNode } from '../../parser/legadoRule';
import { isJsonObject } from './jsonSupport';
import {
  SourceNetworkError,
  base64NoWrap,
  decodeCharset,
  executeSourceRequest,
  formUrlEncode,
  isSuccessful,
  resolveHttpClient,
} from './sourceHttp';
import type { HttpClient, HttpHeader, HttpResponse, SourceRequestInit } from './sourceHttp';

/** Kotlin `private const val DEFAULT_UA` (companion). */
const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';

export class JsonBookSource extends ComicSource {
  readonly config: SourceConfig;
  readonly id: string;
  readonly name: string;
  readonly capabilities: SourceCapabilities;

  /** Kotlin `private val searchItemCache = ConcurrentHashMap<String, SearchBook>()`. */
  private readonly searchItemCache = new Map<string, SearchBook>();
  /** Kotlin `private val searchRawCache = ConcurrentHashMap<String, JSONObject>()`. */
  private readonly searchRawCache = new Map<string, Record<string, unknown>>();
  /** Kotlin `private val configuredHost`. */
  private readonly configuredHost: string | null;
  private readonly client: HttpClient;

  constructor(config: SourceConfig, client?: HttpClient | null) {
    super();
    this.config = config;
    this.client = resolveHttpClient(client ?? null);
    this.id = config.id;
    this.name = config.name;
    this.configuredHost = hostOf(config.baseUrl.trim() === '' ? config.search.url : config.baseUrl);

    /**
     * Kotlin lines 86-107: 是否漫画源 —
     * 1. 配置里显式声明 type=comic/novel 时以声明为准；
     * 2. 否则看正文规则是否在提取“图片”（img/@src/data-src 等选择器）。
     * 文本源即使配置了 htmlChapters/htmlContent（章节/正文规则），也不会被误判成漫画。
     */
    this.isComicLike = ((): boolean => {
      switch (config.type?.toLowerCase()) {
        case 'comic':
        case '漫画':
          return true;
        case 'novel':
        case 'text':
        case '小说':
        case '文本':
          return false;
        default: {
          const sel = config.htmlContent?.imageSelector.toLowerCase() ?? '';
          return (
            sel.includes('@src') ||
            sel.includes('data-src') ||
            sel.includes('data-original') ||
            sel.includes('lazy') ||
            sel.includes('img') ||
            sel.includes('amp-img') ||
            sel.includes('mip-img') ||
            sel.includes('image') ||
            sel.includes('pic')
          );
        }
      }
    })();

    this.capabilities = createSourceCapabilities({
      supportImport: true,
      supportComic: this.isComicLike,
      // 文本源：有章节规则且正文不是图片规则时，支持在线章节阅读
      supportOnlineText: config.htmlChapters != null && !this.isComicLike,
    });
  }

  private readonly isComicLike: boolean;

  // -------------------------------------------------------------------------
  // Kotlin 43-56: DNS + network interceptor policy
  // -------------------------------------------------------------------------

  /**
   * Kotlin `addNetworkInterceptor { chain -> … chain.proceed(request) }`:
   * `check(request.url)` runs before every request, and an insecure-TLS source
   * must not forward credentials.
   *
   * The 2 MiB body bound needs no extra line here: every Kotlin response read in
   * this file goes through `readImportBytes(2*1024*1024)` (L153 / L449 / L456 /
   * L517), and `executeSourceRequest` applies exactly that bound by default. An
   * over-limit body throws `IllegalArgumentException("压缩包解压体积超过安全上限")`
   * from `ArchiveBudget.copyEntry`, which lands in each method's
   * `catch (e: Exception)` arm — i.e. `Unknown("未知错误: …")`, exactly what the
   * shared `SourceBodyTooLargeError` produces.
   */
  private async proceed(
    url: string,
    init: SourceRequestInit,
  ): Promise<HttpResponse> {
    checkSourceUrl(url, this.configuredHost);
    const headers = init.headers ?? {};
    if (
      this.config.insecureTls &&
      (headers['Authorization'] != null || headers['Cookie'] != null)
    ) {
      throw new SourceException('不安全 TLS 书源不能发送登录凭据，请启用证书验证');
    }
    return executeSourceRequest(this.client, url, init);
  }

  /** Kotlin `bodyStr = response.body?.byteStream()…toString(Charsets.UTF_8) ?: ""`. */
  private responseText(response: HttpResponse): string {
    return response.body.byteLength === 0 ? '' : decodeCharset(response.body, null);
  }

  async search(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    try {
      if (this.searchItemCache.size > 1000) {
        this.searchItemCache.clear();
        this.searchRawCache.clear();
      }
      if (this.config.htmlSearch != null) {
        return await this.searchHtml(keyword);
      }
      const encodedKeyword = formUrlEncode(keyword);
      const keywordB64 = base64NoWrap(keyword);
      const requestUrl = this.config.search.url
        .replace('{keyword}', encodedKeyword)
        .replace('{keyword_b64}', keywordB64);
      const fullUrl = this.resolveUrl(requestUrl);

      const headers: HttpHeader = { ...this.config.search.headers };
      const request = this.buildRequest(
        headers,
        this.config.search.method,
        this.config.search.body,
        encodedKeyword,
      );
      const response = await this.proceed(fullUrl, request);

      if (!isSuccessful(response)) {
        return SourceResult.Error(
          new NetworkError(`HTTP error status code: ${response.status}`),
        );
      }

      const bodyStr = this.responseText(response);
      const jsonItems = resolveArray(bodyStr, this.config.search.listPath);

      for (const jsonObj of jsonItems) {
        const book = this.parseSearchBook(jsonObj, this.config.search.fields);
        if (book != null) {
          this.searchItemCache.set(book.id, book);
          this.searchRawCache.set(book.id, jsonObj);
        }
      }

      const books: SearchBook[] = [];
      for (const jsonObj of jsonItems) {
        const book = this.parseSearchBook(jsonObj, this.config.search.fields);
        if (book != null) books.push(book);
      }

      return SourceResult.Success(books);
    } catch (e) {
      // Kotlin L168-175: IOException → NetworkError("网络连接错误: …"),
      // JSONException → ParseError("JSON解析异常: …"), everything else → Unknown.
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      if (e instanceof SyntaxError) {
        return SourceResult.Error(new ParseError(`JSON解析异常: ${e.message}`));
      }
      if (e instanceof Error) return SourceResult.Error(new Unknown(`未知错误: ${e.message}`, e));
      return SourceResult.Error(new Unknown('未知错误', e));
    }
  }

  async getChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    const rule = this.config.htmlChapters;
    if (rule == null) {
      return SourceResult.Error(new ParseError('该书源未配置漫画目录规则'));
    }
    try {
      const detailUrl = this.resolveUrl(rule.url.replace('{id}', bookId));
      let url = detailUrl;
      // 目录不在详情页：先用 tocUrlSelector 从详情页解析目录页地址
      const tocRule = rule.tocUrlSelector;
      if (tocRule != null && tocRule.trim() !== '') {
        try {
          const detailRaw = await this.fetchHtml(detailUrl);
          const detailDoc = parseHtml(detailRaw);
          const tocUrl = evalFirst(detailDoc, tocRule);
          if (tocUrl != null && tocUrl.trim() !== '') {
            url = this.resolveUrl(tocUrl);
            SourceLog.log(this.name, `目录页跳转 ← ${tocRule} → ${url.slice(0, 120)}`);
          }
        } catch (e) {
          SourceLog.log(
            this.name,
            `tocUrl 解析失败，回退详情页: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const raw = await this.fetchHtml(url);
      const chapters: ComicChapter[] = [];
      if (isJsonRule(rule.listSelector)) {
        const items = resolveArray(raw, cleanJsonPath(rule.listSelector));
        for (const item of items) {
          const name = this.resolveJsonTemplate(item, rule.nameSelector);
          if (name == null) continue;
          const href = this.resolveJsonTemplate(item, rule.hrefSelector);
          if (href == null) continue;
          chapters.push(createComicChapter({ id: this.resolveUrl(href), title: name }));
        }
      } else {
        const doc = parseHtml(raw);
        for (const el of selectElements(doc, rule.listSelector)) {
          const name = this.selectValue(el, rule.nameSelector);
          if (name == null) continue;
          const href = this.selectValue(el, rule.hrefSelector);
          if (href == null) continue;
          chapters.push(createComicChapter({ id: this.resolveUrl(href), title: name }));
        }
      }
      return SourceResult.Success(chapters);
    } catch (e) {
      SourceLog.log(
        this.name,
        `目录失败 ← ${bookId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Kotlin L220-226: IOException → NetworkError, else → Unknown.
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      if (e instanceof Error) {
        return SourceResult.Error(new Unknown(`未知错误: ${e.message}`, e));
      }
      return SourceResult.Error(new Unknown('未知错误', e));
    }
  }

  async getChapterImages(chapterId: string): Promise<SourceResultType<string[]>> {
    const rule = this.config.htmlContent;
    if (rule == null) {
      return SourceResult.Error(new ParseError('该书源未配置漫画图片规则'));
    }
    try {
      const url = this.resolveUrl(rule.url.replace('{chapterUrl}', chapterId));
      const raw = await this.fetchHtml(url);
      let images: string[];
      if (isJsonRule(rule.imageSelector)) {
        images = resolveStringArray(raw, cleanJsonPath(rule.imageSelector))
          .map((it) => this.resolveUrl(it))
          .filter((u): u is string => this.validateUrl(u));
      } else {
        const doc = parseHtml(raw);
        const collected: string[] = [];
        for (const value of evalValues(doc, rule.imageSelector)) {
          for (const imageUrl of extractImageUrls(value)) collected.push(imageUrl);
        }
        const seen = new Set<string>();
        images = collected
          .map((it) => this.resolveUrl(it))
          .filter((u): u is string => this.validateUrl(u))
          .filter((u) => {
            if (seen.has(u)) return false;
            seen.add(u);
            return true;
          });
      }
      if (images.length === 0) {
        SourceLog.log(this.name, `正文无图片 ← ${chapterId}（可能是文本源或规则失效）`);
        return SourceResult.Error(
          new ParseError('该章节没有可读取的图片（若为文本书源，请前往详情页下载原文件）'),
        );
      }
      SourceLog.log(this.name, `正文图片 ${images.length} 张 ← ${chapterId}`);
      return SourceResult.Success(images);
    } catch (e) {
      SourceLog.log(
        this.name,
        `正文失败 ← ${chapterId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Kotlin L259-265: IOException → NetworkError, else → Unknown.
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      if (e instanceof Error) {
        return SourceResult.Error(new Unknown(`未知错误: ${e.message}`, e));
      }
      return SourceResult.Error(new Unknown('未知错误', e));
    }
  }

  /** 章节式文本源：抓取章节页并按 Legado 正文规则提取纯文本（段落 \n\n 分隔）。 */
  override async getChapterText(chapterId: string): Promise<SourceResultType<string>> {
    const rule = this.config.htmlContent;
    if (rule == null) {
      return SourceResult.Error(new ParseError('该书源未配置正文规则'));
    }
    try {
      const url = this.resolveUrl(rule.url.replace('{chapterUrl}', chapterId));
      const raw = await this.fetchHtml(url);
      const paragraphs = isJsonRule(rule.imageSelector)
        ? resolveStringArray(raw, cleanJsonPath(rule.imageSelector))
        : evalValues(parseHtml(raw), rule.imageSelector);
      const text = paragraphs
        .map((it) => it.replace(/\u00a0/g, ' ').trim())
        .filter((it) => it !== '')
        .join('\n\n');
      if (text.trim() === '') {
        SourceLog.log(this.name, `正文无文字 ← ${chapterId}（规则可能失效）`);
        return SourceResult.Error(new ParseError('本章内容为空（正文规则可能失效）'));
      }
      SourceLog.log(this.name, `正文 ${text.length} 字 ← ${chapterId}`);
      return SourceResult.Success(text);
    } catch (e) {
      SourceLog.log(
        this.name,
        `正文失败 ← ${chapterId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Kotlin L294-300: IOException → NetworkError (no throwable argument), else → Unknown.
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`));
      }
      if (e instanceof Error) {
        return SourceResult.Error(new Unknown(`未知错误: ${e.message}`, e));
      }
      return SourceResult.Error(new Unknown('未知错误', e));
    }
  }

  private async searchHtml(keyword: string): Promise<SourceResultType<SearchBook[]>> {
    const rule = this.config.htmlSearch;
    if (rule == null) {
      return SourceResult.Error(new ParseError('缺少 htmlSearch 规则'));
    }
    const encoded = formUrlEncode(keyword);
    const keywordB64 = base64NoWrap(keyword);
    const url = this.resolveUrl(
      rule.url
        .replace('{keyword}', encoded)
        .replace('{keyword_b64}', keywordB64)
        .replace('{page}', '1'),
    );
    const body =
      rule.body == null
        ? null
        : rule.body
            .replace('{keyword}', encoded)
            .replace('{keyword_b64}', keywordB64)
            .replace('{page}', '1');
    let raw: string;
    try {
      raw = await this.fetchHtml(url, rule.method, body);
    } catch (e) {
      SourceLog.log(this.name, `搜索失败「${keyword}」: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    if (isJsonRule(rule.listSelector)) {
      const r = this.searchHtmlJson(raw, rule);
      SourceLog.log(
        this.name,
        `搜索「${keyword}」(${rule.method}) → ${
          r.kind === 'success' ? `${r.data.length} 条结果` : `失败: ${r.exception.message}`
        }`,
      );
      return r;
    }
    const doc = parseHtml(raw);
    const books: SearchBook[] = [];
    for (const el of selectElements(doc, rule.listSelector)) {
      const title =
        this.selectValue(el, rule.titleSelector.trim() === '' ? 'a@text' : rule.titleSelector) ??
        this.selectValue(el, 'text');
      if (title == null) continue;
      const detailRaw = this.selectValue(
        el,
        rule.detailUrlSelector.trim() === '' ? 'a@href' : rule.detailUrlSelector,
      );
      if (detailRaw == null) continue;
      const coverRaw = this.selectValue(el, rule.coverSelector);
      books.push(
        createSearchBook({
          id: detailRaw,
          sourceId: this.id,
          title,
          author: this.selectValue(el, rule.authorSelector) ?? '未知作者',
          cover: coverRaw == null ? null : this.resolveUrl(coverRaw),
          description: this.selectValue(el, rule.introSelector),
          format: this.isComicLike ? '漫画' : ifBlank(this.config.download.defaultFormat, ''),
        }),
      );
    }
    SourceLog.log(this.name, `搜索「${keyword}」(${rule.method}) → ${books.length} 条结果`);
    return SourceResult.Success(books);
  }

  /** JSON 搜索结果：rule.listSelector 为 JSONPath，字段规则为 JSONPath / 模板。 */
  private searchHtmlJson(raw: string, rule: NonNullable<SourceConfig['htmlSearch']>): SourceResultType<SearchBook[]> {
    const items = resolveArray(raw, cleanJsonPath(rule.listSelector));
    const books: SearchBook[] = [];
    for (const item of items) {
      const title = this.resolveJsonTemplate(
        item,
        rule.titleSelector.trim() === '' ? 'name' : rule.titleSelector,
      );
      if (title == null) continue;
      const detailRaw = this.resolveJsonTemplate(
        item,
        rule.detailUrlSelector.trim() === '' ? 'id' : rule.detailUrlSelector,
      );
      if (detailRaw == null) continue;
      const coverRaw = this.resolveJsonTemplate(item, rule.coverSelector);
      books.push(
        createSearchBook({
          id: detailRaw,
          sourceId: this.id,
          title,
          author: this.resolveJsonTemplate(item, rule.authorSelector) ?? '未知作者',
          cover: coverRaw == null ? null : this.resolveUrl(coverRaw),
          description: this.resolveJsonTemplate(item, rule.introSelector),
          format: this.isComicLike ? '漫画' : ifBlank(this.config.download.defaultFormat, ''),
        }),
      );
    }
    return SourceResult.Success(books);
  }

  /**
   * JSON 模式字段取值：支持纯字段名（name / $.name）、URL 模板（/book/{{$.id}}）、
   * 以及旧式 {$._id} 模板。
   */
  private resolveJsonTemplate(
    item: Record<string, unknown>,
    rule: string | null | undefined,
  ): string | null {
    const r = rule?.trim() ?? '';
    if (r === '') return null;
    if (r === 'text') {
      return getString(item, 'name') ?? getString(item, 'title');
    }
    if (r === 'href') {
      return getString(item, 'href') ?? getString(item, 'url') ?? getString(item, 'link');
    }
    if (r.includes('{{')) {
      const result = r.replace(/\{\{([^}]+)\}\}/g, (_m, group: string) => {
        return getString(item, cleanJsonPath(group)) ?? '';
      });
      return result.trim() === '' ? null : result.trim();
    }
    if (r.includes('{$')) {
      const result = r.replace(/\{([^}]+)\}/g, (_m, group: string) => {
        return getString(item, cleanJsonPath(group)) ?? '';
      });
      return result.trim() === '' ? null : result.trim();
    }
    return getString(item, cleanJsonPath(r));
  }

  private selectValue(root: HtmlNode, rule: string): string | null {
    const r = rule.trim();
    if (r === '') return null;
    if (r === 'text') {
      const text = root.text().trim();
      return text === '' ? null : text;
    }
    if (r === 'href' || r === 'src' || r === 'data-src') {
      const value = (root.attrs[r] ?? '').trim();
      return value === '' ? null : value;
    }
    return evalFirst(root, r);
  }

  private async fetchHtml(url: string, method = 'GET', body: string | null = null): Promise<string> {
    const headers: HttpHeader = {};
    const configured = this.config.search.headers;
    if (!Object.keys(configured).some((k) => k.toLowerCase() === 'user-agent')) {
      headers['User-Agent'] = DEFAULT_UA;
    }
    if (!Object.keys(configured).some((k) => k.toLowerCase() === 'accept-language')) {
      headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
    }
    for (const [k, v] of Object.entries(configured)) headers[k] = v;

    let request: SourceRequestInit;
    if (method.toLowerCase() === 'post') {
      const mediaType = body != null && body.trimStart().startsWith('{')
        ? 'application/json; charset=utf-8'
        : 'application/x-www-form-urlencoded';
      headers['Content-Type'] = mediaType;
      request = { method: 'POST', headers, body: body ?? '' };
    } else {
      request = { method: 'GET', headers };
    }
    SourceLog.log(this.name, `请求 ${method} ${url.slice(0, 120)}`);
    const response = await this.proceed(url, request);
    if (!isSuccessful(response)) {
      SourceLog.log(this.name, `HTTP ${response.status} ← ${method} ${url.slice(0, 120)}`);
      throw new NetworkError(`HTTP ${response.status} @ ${url.slice(0, 160)}`);
    }
    SourceLog.log(this.name, `HTTP ${response.status} OK ← ${method} ${url.slice(0, 120)}`);
    const charset = this.config.htmlSearch?.charset;
    return decodeCharset(response.body, charset != null && charset.trim() !== '' ? charset : null);
  }

  async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    const detailRule = this.config.detail;
    if (detailRule == null) {
      // Return a basic placeholder book if detail rule is omitted
      return SourceResult.Success(
        createSearchBook({
          id: bookId,
          sourceId: this.id,
          title: bookId,
          author: 'Unknown',
        }),
      );
    }

    try {
      const encodedId = formUrlEncode(bookId);
      const requestUrl = detailRule.url.replace('{id}', encodedId);
      const fullUrl = this.resolveUrl(requestUrl);

      const headers: HttpHeader = { ...detailRule.headers };
      const request = this.buildRequest(
        headers,
        detailRule.method,
        detailRule.body,
        encodedId,
      );
      const response = await this.proceed(fullUrl, request);

      if (!isSuccessful(response)) {
        return SourceResult.Error(
          new NetworkError(`HTTP error status code: ${response.status}`),
        );
      }

      const bodyStr = this.responseText(response);
      let jsonObj: unknown;
      try {
        jsonObj = JSON.parse(bodyStr);
      } catch {
        // Kotlin line 510-514: `catch (e: Exception) → 无效的详情 JSON`
        return SourceResult.Error(new ParseError('无效的详情 JSON'));
      }
      if (!isJsonObject(jsonObj)) {
        return SourceResult.Error(new ParseError('无效的详情 JSON'));
      }

      const book = this.parseSearchBook(jsonObj, detailRule.fields, bookId);
      return book != null ? SourceResult.Success(book) : SourceResult.Error(new BookNotFound());
    } catch (e) {
      // Kotlin L530-537: IOException → NetworkError, JSONException → ParseError, else → Unknown.
      if (e instanceof SourceException) return SourceResult.Error(e);
      if (e instanceof SourceNetworkError) {
        return SourceResult.Error(new NetworkError(`网络连接错误: ${messageOf(e)}`, e));
      }
      if (e instanceof SyntaxError) {
        return SourceResult.Error(new ParseError(`JSON解析异常: ${e.message}`));
      }
      if (e instanceof Error) return SourceResult.Error(new Unknown(`未知错误: ${e.message}`, e));
      return SourceResult.Error(new Unknown('未知错误', e));
    }
  }

  async getDownloadInfo(bookId: string): Promise<SourceResultType<DownloadInfo>> {
    const downloadRule = this.config.download;
    const downloadUrlTemplate = downloadRule.url;
    const cachedBook = this.searchItemCache.get(bookId);
    const cachedRaw = this.searchRawCache.get(bookId);
    const encodedId = formUrlEncode(bookId);
    const fallbackDetail = SourceResult.getOrNull(await this.getDetail(bookId));

    const targetUrl = ((): string => {
      if (downloadUrlTemplate != null && downloadUrlTemplate.length !== 0) {
        return this.resolveUrl(downloadUrlTemplate.replace('{id}', encodedId));
      }
      if (cachedBook?.downloadUrl != null && cachedBook.downloadUrl.trim() !== '') {
        return this.resolveUrl(cachedBook.downloadUrl);
      }
      if (
        downloadRule.urlField != null &&
        downloadRule.urlField.trim() !== '' &&
        cachedRaw != null
      ) {
        const raw = getString(cachedRaw, downloadRule.urlField);
        return raw != null && raw.trim() !== '' ? this.resolveUrl(raw) : '';
      }
      // Fetch detail to locate downloadUrl field
      return fallbackDetail?.downloadUrl ?? '';
    })();

    const displayTitle = cachedBook?.title ?? fallbackDetail?.title ?? bookId;
    const cleaned = displayTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
    const cleanTitle = cleaned === '' ? bookId : cleaned;

    if (!this.validateUrl(targetUrl)) {
      return SourceResult.Error(new ParseError(`非法或不支持的下载链接: ${targetUrl}`));
    }

    const base = this.config.baseUrl.replace(/\/+$/, '');
    return SourceResult.Success(
      createDownloadInfo({
        url: targetUrl,
        fileName: `${cleanTitle}.${downloadRule.defaultFormat}`,
        format: downloadRule.defaultFormat,
        headers: downloadRule.headers,
        referer: base.trim() === '' ? null : base,
      }),
    );
  }

  async login(_credential: LoginCredential): Promise<SourceResultType<boolean>> {
    return SourceResult.Success(false);
  }

  async logout(): Promise<void> {}

  async isLoggedIn(): Promise<boolean> {
    return false;
  }

  private parseSearchBook(
    jsonObj: Record<string, unknown>,
    fields: SourceConfig['search']['fields'],
    defaultId = '',
  ): SearchBook | null {
    const extractedId = getString(jsonObj, fields.id) ?? defaultId;
    const title = getString(jsonObj, fields.title);
    if (title == null) return null;
    const author = getString(jsonObj, fields.author ?? null) ?? '未知';
    const rawCover = getString(jsonObj, fields.cover ?? null);
    const cover = rawCover != null && rawCover !== '' ? this.resolveUrl(rawCover) : null;
    const description = getString(jsonObj, fields.description ?? null);
    const format = getString(jsonObj, fields.format ?? null) ?? this.config.download.defaultFormat;
    const rawDownloadUrl = getString(jsonObj, fields.downloadUrl ?? null);
    const downloadUrl =
      rawDownloadUrl != null && rawDownloadUrl !== '' ? this.resolveUrl(rawDownloadUrl) : null;

    return createSearchBook({
      id: extractedId,
      sourceId: this.id,
      title,
      author,
      cover,
      description,
      format,
      downloadUrl,
    });
  }

  private validateUrl(url: string): boolean {
    if (url.trim() === '') return false;
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('file:')) return false;
    return lower.startsWith('http://') || lower.startsWith('https://');
  }

  private resolveUrl(url: string): string {
    const lower = url.trim().toLowerCase();
    if (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('javascript:') ||
      lower.startsWith('file:')
    ) {
      return url;
    }
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const path = url.replace(/^\/+/, '');
    return base === '' ? url : `${base}/${path}`;
  }

  private buildRequest(
    headers: HttpHeader,
    method: string,
    bodyTemplate: string | null,
    encodedParam: string,
  ): SourceRequestInit {
    const upperMethod = method.toUpperCase();
    if (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH') {
      const replaced = bodyTemplate
        ?.replace('{keyword}', encodedParam)
        ?.replace('{id}', encodedParam);
      const jsonBody = replaced != null && replaced.trim() !== '' ? replaced : '{}';
      headers['Content-Type'] = 'application/json; charset=utf-8';
      return {
        method: upperMethod as 'POST' | 'PUT' | 'PATCH',
        headers,
        body: jsonBody,
      };
    }
    return { method: 'GET', headers };
  }
}

/**
 * 从规则值中提取图片 URL。
 * 支持三种形态：纯 URL 列表（空白分隔）、HTML 片段（<img>/<amp-img>/<mip-img> 标签）。
 * Kotlin `private fun extractImageUrls(value: String): List<String>` (module-level
 * here so it is unit-testable without a configured source).
 */
export function extractImageUrls(value: string): string[] {  const v = value.trim();
  if (v === '') return [];
  if (/<(img|amp-img|mip-img)\b/i.test(v)) {
    const fragment = parseBodyFragment(v);
    const out: string[] = [];
    for (const el of fragment.select('img, amp-img, mip-img')) {
      const picked =
        el.attr('data-src') ||
        el.attr('data-original') ||
        el.attr('data-lazy-src') ||
        el.attr('src') ||
        el.attr('data-url');
      const trimmed = picked.trim();
      if (trimmed !== '') out.push(trimmed);
    }
    return out;
  }
  return [...v.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((it) =>
    // Kotlin `it.value.trimEnd(',', ';', ']', '}')`
    it[0].replace(/[,;\]}]+$/, ''),
  );
}

/** Kotlin `java.net.URI(url).host?.lowercase()` — no scheme → no host. */
function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** Kotlin `${e.message}` — a `null` message renders as the literal "null". */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return e == null ? 'null' : String(e);
}

/**
 * Kotlin `String.ifBlank { fallback }` — the value is kept **verbatim** (not
 * trimmed) when it is non-blank, so `" epub "` stays `" epub "` exactly like
 * `JsonBookSource.kt:348/372` (`config.download.defaultFormat.ifBlank { "" }`).
 */
function ifBlank(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : value;
}


/**
 * Android source: `com.example.source.js.JsComicSource.kt` (806 lines, 767 non-blank)
 * Ported: 767 / 767 non-blank lines. Skipped: none.
 *
 * 2026-10-07 continuation pass (closed E59):
 * - Kotlin L367/373-374 `hasExplicitOrder` accumulation was missing; added with the
 *   same short-circuit order (`c.has("order") && !c.isNull("order") &&
 *   optDouble("order", NaN).toFloat().isFinite()`). Required `JSONObject.has()` /
 *   `isNull()`, added to the org.json port (`./json.ts`).
 * - Kotlin L397 `SourceResult.Success(JsChapterOrder.normalize(list, sourceKey,
 *   hasExplicitOrder))` returned a bare `list` — the whole 118-line
 *   `JsChapterOrder.kt` algorithm was absent from the tree. Ported verbatim to
 *   `./jsChapterOrder.ts` and wired here.
 *
 * Platform adaptations:
 * - `android.content.Context` → injected `KeyValueStorage` (verification prefs),
 *   `FileStoragePort` (the `ehimg` cache) and `ImageProbe` (the `coil` pipeline
 *   used for the MXS spacer probe). `coil`'s `comicRemoteCacheKey` /
 *   `DECODE_MAX_EDGE` / `Scale.FIT` / `Precision.INEXACT` /
 *   `allowHardware(false)` become the adapter's concern; the per-URL headers
 *   still come from `imageConfigCache`, exactly as on Android.
 * - `Mutex` → `JsMutex`; `synchronized` blocks dropped (JS is single-threaded);
 *   the access-ordered `LinkedHashMap` caches are ported with explicit
 *   insertion-order eviction.
 * - `android.os.SystemClock.elapsedRealtime()` → injected `elapsedRealtime`.
 *   `java.io.File` + `Uri.fromFile(file).toString()` → `files.*` / `toFileUrl`.
 * - `withContext(Dispatchers.IO)` dropped — promises already yield.
 * - `org.json` → the local port (`./json.ts`); `q()` → `jsonQuote` (`JSON.stringify`).
 * - `Regex` → JS `RegExp`; every pattern, magic number and Chinese message is
 *   preserved verbatim.
 * - `VeneraRuntime.get(context)` → `VeneraRuntime.get(loader)` over the
 *   injected asset reader; the module-level cache is kept.
 */

import type { ComicChapter } from '../comicChapter';
import { ComicSource } from '../comicSource';
import { createComicChapter } from '../comicChapter';
import { createSearchBook, type SearchBook } from '../searchBook';
import { createSourceCapabilities, type SourceCapabilities } from '../sourceCapabilities';
import { LoginRequired, ParseError, Unknown } from '../sourceException';
import { validRegistrationUrl } from '../sourceRegistration';
import { SourceResult } from '../sourceResult';
import type { DownloadInfo } from '../downloadInfo';
import type { LoginCredential } from '../loginCredential';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { JSONArray, JSONObject, jsonQuote } from './json';
import { JsChapterOrder } from './jsChapterOrder';
import { JsComicMetadata } from './jsComicMetadata';
import { JsImageProcessor } from './jsImageProcessor';
import type { JsSourceEngineApi as JsSourceEngine } from './jsSourceEngine';
import {
  isCancellation,
  JsLog,
  JsMutex,
  type CancellationSignal,
  type FileStoragePort,
  type HtmlDomParser,
  type ImageProbe,
  type KeyValueStorage,
} from './jsPlatform';
import type { DialogHostPort } from './jsUiDialogs';
import { stripLeadingMxsSpacers } from './mxsSpacerPages';

/** Kotlin `U+0001` chapter/book id separator. */
const SEP = '\u0001';

const MYCOMIC_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';
const GODA_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/108.0.5359.128 Mobile Safari/537.36';

/**
 * 把 JS 源桥层的原始错误翻译成用户能看懂、能行动的中文提示。
 * 此前聚合搜索把所有非超时错误一律显示成「无结果」，真实原因（被墙需代理/需登录/登录过期）完全不可见。
 */
export function friendlyJsSourceError(raw: string): string {
  const text = raw.trim();
  if (text === '') return 'JS 执行失败';
  const lower = text.toLowerCase();
  if (lower.includes('not logged in') || text.includes('请先登录')) {
    return '该源需要登录：请在书源管理中登录';
  }
  if (text.includes('Invalid status code: 401')) return '登录已过期：请在书源管理中重新登录';
  if (lower.includes('cloudflare')) return '源站暂时拦截请求，请稍后重试';
  if (lower.includes('invalid status code: 403') || text.includes('当前区域禁止访问')) {
    return '源站拒绝当前网络出口（HTTP 403），请稍后重试或更换 VPN 节点';
  }
  if (
    lower.includes('err_') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    text.includes('请求超时') ||
    lower.includes('connection reset') ||
    lower.includes('socketexception') ||
    lower.includes('unable to resolve host')
  ) {
    return '网络连接失败：请检查该源站点、系统代理或 VPN 后重试';
  }
  return text.slice(0, 120);
}

/** Everything the comic source needs from the platform. */
export interface JsComicSourceDeps {
  /** Kotlin `context.getSharedPreferences("js_source_website_verification")`. */
  readonly verificationPrefs: KeyValueStorage;
  /** Kotlin `context.cacheDir` for the e-hentai image cache. */
  readonly files: FileStoragePort;
  /** Kotlin `coil` image pipeline used by the MXS spacer probe. */
  readonly imageProbe: ImageProbe;
  /** Kotlin `AlertDialog` host for the verification WebView. */
  readonly dialogs: DialogHostPort;
  /** Kotlin `awaitWebsiteVerification(url, userAgent)`. */
  readonly verifyWebsite: (url: string, userAgent: string) => Promise<boolean>;
  /** Kotlin `android.os.SystemClock.elapsedRealtime()`. */
  readonly elapsedRealtime: () => number;
  /** Kotlin `CfWebViewSolver.solveAndSync(context, url, userAgent)`. */
  readonly solveCloudflare: (url: string, userAgent: string) => Promise<boolean>;
  /** Kotlin `JsCookieJar.cookieHeader(context, url)`. */
  readonly cookieHeader: (url: string) => string;
  /** Kotlin `JsSourceEngine(runtimeJs, sourceJs, sourceKey, context, insecureTls)`. */
  readonly createEngine: (
    runtimeJs: string,
    sourceJs: string,
    sourceKey: string,
    insecureTls: boolean,
  ) => JsSourceEngine;
  /** Kotlin `VeneraRuntime.get(context)`. */
  readonly veneraRuntime: () => string;
  /** Kotlin `kotlinx.coroutines.delay(millis)`. */
  readonly delay: (millis: number) => Promise<void>;
  /** Kotlin `org.jsoup.Jsoup` — used by `JsComicMetadata.book`. */
  readonly dom: HtmlDomParser;
}

interface CachedChapters {
  readonly savedAt: number;
  readonly chapters: ComicChapter[];
}

interface ImageConfig {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly headers: Record<string, string>;
  readonly modifyCode: string | null;
  readonly nl: string | null;
}

/**
 * 一个 Venera 兼容的 JS 漫画源。
 * 通过 JsSourceEngine 调用源脚本的 search.load / comic.loadInfo / comic.loadEp。
 */
export class JsComicSource extends ComicSource {
  private readonly createMutex = new JsMutex();
  private engine: JsSourceEngine | null = null;
  private engineInitialized = false;
  private readonly chapterLoadMutex = new JsMutex();
  private readonly chapterCache = new Map<string, CachedChapters>();
  private readonly detailCache = new Map<string, { at: number; book: SearchBook }>();
  private chapterCacheEpoch = 0;
  /** Kotlin `LinkedHashMap<String, ImageConfig>(128, 0.75f, true)`, 512-entry ceiling. */
  private readonly imageConfigCache = new Map<string, ImageConfig>();

  constructor(
    private readonly deps: JsComicSourceDeps,
    readonly sourceKey: string,
    override readonly name: string,
    readonly version: string,
    private readonly script: string,
    private readonly insecureTls = false,
    private readonly loginRequired = false,
  ) {
    super();
  }

  /** Kotlin `override val id: String get() = "js_$sourceKey"`. */
  override get id(): string {
    return `js_${this.sourceKey}`;
  }

  override get capabilities(): SourceCapabilities {
    return createSourceCapabilities({
      supportSearch: true,
      supportDownload: true,
      supportComic: true,
      searchRequiresLogin:
        this.loginRequired && !new Set(['ikmmh', 'vomic']).has(this.sourceKey),
      downloadRequiresLogin: this.loginRequired && this.sourceKey !== 'ikmmh',
    });
  }

  override async getRegistrationUrl(): Promise<string | null> {
    // Literal links (e.g. Picacg) need no JS bootstrap or network request.
    const literal = /registerWebsite\s*:\s*(["'])([^"'\r\n]+)\1/.exec(this.script)?.[2];
    const fromLiteral = validRegistrationUrl(literal ?? null);
    if (fromLiteral !== null) return fromLiteral;
    try {
      const raw = await (await this.getEngine()).call(
        'src.account && src.account.registerWebsite || null',
      );
      if (raw === null) return null;
      return validRegistrationUrl(new JSONObject(raw).optString('data'));
    } catch (e) {
      if (isCancellation(e)) throw e;
      return null;
    }
  }

  /** Kotlin `private suspend fun applyVerifiedUserAgent(runtime, userAgent)`. */
  private async applyVerifiedUserAgent(runtime: JsSourceEngine, userAgent: string): Promise<void> {
    if (this.sourceKey !== 'mycomic' || userAgent.trim() === '') return;
    await runtime.call(`
            (()=>{
                if (typeof headers !== 'undefined') {
                    headers['User-Agent'] = ${jsonQuote(userAgent)};
                    for (const key of Object.keys(headers)) {
                        if (key.toLowerCase().startsWith('sec-ch-ua')) delete headers[key];
                    }
                }
            })()
        `);
  }

  /** Kotlin `private fun invalidateChapterCache()`. */
  private invalidateChapterCache(): void {
    this.chapterCacheEpoch += 1;
    this.chapterCache.clear();
    this.detailCache.clear();
    // Image configuration may contain the old account's authorization headers.
    this.imageConfigCache.clear();
  }

  /** Kotlin `private suspend fun getEngine(): JsSourceEngine`. */
  private async getEngine(): Promise<JsSourceEngine> {
    return this.createMutex.withLock(async () => {
      let runtime = this.engine;
      if (runtime === null) {
        runtime = this.deps.createEngine(
          this.deps.veneraRuntime(),
          this.script,
          this.sourceKey,
          this.insecureTls,
        );
        this.engine = runtime;
      }
      if (!this.engineInitialized) {
        await runtime.call('null');
        // Preserve the source's original headers for ordinary reading.
        // Only a completed WebView verification establishes a new UA-bound session.
        const userAgent = this.deps.verificationPrefs.getString(`${this.sourceKey}_user_agent`);
        if (userAgent !== null) await this.applyVerifiedUserAgent(runtime, userAgent);
        this.engineInitialized = true;
      }
      return runtime;
    });
  }

  /** Kotlin `private suspend fun callJs(jsCall: String): JSONObject?`. */
  private async callJs(jsCall: string, signal: CancellationSignal = null): Promise<JSONObject | null> {
    const raw = await (await this.getEngine()).call(jsCall, signal);
    if (raw === null) return null;
    try {
      return new JSONObject(raw);
    } catch (e) {
      if (isCancellation(e)) throw e;
      return null;
    }
  }

  /** 网络类错误（超时/断连/重置）自动重试一次，源站抽风时大幅提高成功率。 */
  private async callJsWithRetry(
    jsCall: string,
    signal: CancellationSignal = null,
  ): Promise<JSONObject | null> {
    let result = await this.callJs(jsCall, signal);
    // These adapters already retry a complete GET through the other transport.
    if (new Set(['pufei', 'bilimanga']).has(this.sourceKey)) return result;
    const err = result?.optString('error', '') ?? '';
    const lower = err.toLowerCase();
    const retryable =
      (this.sourceKey === 'copy_manga' && result?.optBoolean('ok') === false) ||
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('err_connection') ||
      lower.includes('err_empty_response') ||
      lower.includes('err_response_headers_truncated') ||
      lower.includes('connection reset') ||
      lower.includes('socketexception') ||
      lower.includes('connect');
    if (retryable) {
      await this.deps.delay(900);
      if (this.sourceKey === 'copy_manga') {
        // Kotlin `runCatching { callJs("src.refreshAppApi ? … : null") }`
        await this.callJs('src.refreshAppApi ? src.refreshAppApi() : null', signal).catch(() => null);
      }
      result = await this.callJs(jsCall, signal);
    }
    return result;
  }

  override async search(
    keyword: string,
    signal: CancellationSignal = null,
  ): Promise<SourceResultType<SearchBook[]>> {
    try {
      let obj = await this.callJsWithRetry(
        `src.search.load.call(src, ${jsonQuote(keyword)}, [], 1)`,
        signal,
      );
      if (obj === null) return SourceResult.Error(new ParseError('JS 源无响应'));
      // Copied circle/artist labels contain parenthesized aliases. Hitomi's
      // whitespace AND search treats those parentheses as literal index terms.
      if (
        this.sourceKey === 'hitomi' &&
        obj.optBoolean('ok') &&
        obj.optJSONObject('data')?.optJSONArray('comics')?.length() === 0
      ) {
        const circle = keyword.trim().replace(/\s*[（(][^()（）]+[）)]\s*$/, '').trim();
        if (circle !== '' && circle !== keyword.trim()) {
          obj =
            (await this.callJsWithRetry(
              `src.search.load.call(src, ${jsonQuote(circle)}, [], 1)`,
              signal,
            )) ?? obj;
        }
      }
      if (!obj.optBoolean('ok')) {
        const err = obj.optString('error', 'JS 执行失败');
        JsLog.w(`JsComic[${this.sourceKey}]`, `call error: ${err}`);
        // 号码牌直达：源搜索接口报错（部分源对纯数字 ID 无搜索结果甚至报错）时，按 ID 直接加载详情
        const direct = await this.numericIdFallback(keyword, signal);
        if (direct !== null) return SourceResult.Success([direct]);
        return SourceResult.Error(new ParseError(friendlyJsSourceError(err)));
      }
      const comics = obj.optJSONObject('data')?.optJSONArray('comics') ?? new JSONArray();
      const books: SearchBook[] = [];
      for (let i = 0; i < comics.length(); i += 1) {
        const c = comics.optJSONObject(i);
        if (c === null) continue;
        const id = c.optString('id');
        const title = c.optString('title');
        if (id.trim() === '' || title.trim() === '') continue;
        const metadata = JsComicMetadata.book(c, this.id, id, this.deps.dom);
        books.push(
          createSearchBook({
            id,
            sourceId: this.id,
            title,
            author: metadata.author,
            cover: blankToNull(c.optString('cover', '')),
            description: blankToNull(c.optString('description', '')),
            language: blankToNull(c.optString('language', '')),
            comicId: extractComicId(c),
            format: '漫画',
            comicInfo: metadata.comicInfo,
          }),
        );
      }
      // 号码牌直达：搜索结果为空且关键词是纯数字号牌时，按 ID 直接加载详情
      if (books.length === 0) {
        const direct = await this.numericIdFallback(keyword, signal);
        if (direct !== null) return SourceResult.Success([direct]);
      }
      return SourceResult.Success(books);
    } catch (e) {
      if (isCancellation(e)) throw e;
      JsLog.e(`JsComic[${this.sourceKey}]`, 'search failed', e);
      return SourceResult.Error(new Unknown(`JS 搜索失败: ${messageOf(e)}`, e));
    }
  }

  /**
   * 号码牌直达：部分漫画源的搜索接口对纯数字 ID 无结果（原 App 里这类输入会直接跳转到
   * 漫画页面），这里用 comic.loadInfo 按号牌直接加载详情并作为单条搜索结果返回，
   * 点开即进入漫画页。仅当关键词是纯数字号牌（可带 # 前缀，1~15 位）时尝试一次；
   * 失败或源不支持则返回 null，维持原有搜索结果——正常关键词搜索永远不会走到这里。
   */
  private async numericIdFallback(
    keyword: string,
    signal: CancellationSignal,
  ): Promise<SearchBook | null> {
    const numericId = keyword.trim().replace(/^#/, '');
    if (!/^\d{1,15}$/.test(numericId)) return null;
    try {
      const obj = await this.callJs(`src.comic.loadInfo.call(src, ${jsonQuote(numericId)})`, signal);
      if (obj === null) return null;
      if (!obj.optBoolean('ok')) return null;
      const data = obj.optJSONObject('data');
      if (data === null) return null;
      const title = data.optString('title').trim();
      if (title === '') return null;
      JsLog.i(`JsComic[${this.sourceKey}]`, `号码牌直达命中: ${numericId} → ${title}`);
      const metadata = JsComicMetadata.book(data, this.id, numericId, this.deps.dom);
      return createSearchBook({
        id: numericId,
        sourceId: this.id,
        title,
        author: metadata.author,
        cover: blankToNull(data.optString('cover')),
        description: blankToNull(data.optString('description')),
        comicId: numericId,
        format: '漫画',
        comicInfo: metadata.comicInfo,
      });
    } catch (e) {
      if (isCancellation(e)) throw e;
      JsLog.w(`JsComic[${this.sourceKey}]`, `号码牌直达尝试失败: ${messageOf(e)}`);
      return null;
    }
  }

  override async getChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    return this.chapterLoadMutex.withLock(async () => {
      const now = this.deps.elapsedRealtime();
      const epoch = this.chapterCacheEpoch;
      const cached = this.chapterCache.get(bookId);
      if (cached !== undefined && now - cached.savedAt < 60_000) {
        return SourceResult.Success([...cached.chapters]);
      }
      const result = await this.loadChapters(bookId);
      if (result.kind === 'success' && result.data.length > 0 && result.data.length <= 10_000) {
        if (epoch === this.chapterCacheEpoch) {
          this.chapterCache.set(bookId, {
            savedAt: this.deps.elapsedRealtime(),
            chapters: result.data,
          });
          this.trimChapterCache();
        }
      }
      return result;
    });
  }

  /** Kotlin `while (chapterCache.size > 8 || sumOf { it.chapters.size } > 10_000)`. */
  private trimChapterCache(): void {
    const total = (): number => {
      let sum = 0;
      for (const entry of this.chapterCache.values()) sum += entry.chapters.length;
      return sum;
    };
    while (this.chapterCache.size > 8 || total() > 10_000) {
      const eldest = this.chapterCache.keys().next();
      if (eldest.done === true) break;
      this.chapterCache.delete(eldest.value);
    }
  }

  private async loadChapters(bookId: string): Promise<SourceResultType<ComicChapter[]>> {
    try {
      const detailEpoch = this.chapterCacheEpoch;
      const obj = await this.callJsWithRetry(`src.comic.loadInfo.call(src, ${jsonQuote(bookId)})`);
      if (obj === null) return SourceResult.Error(new ParseError('JS 源无响应'));
      if (!obj.optBoolean('ok')) {
        const err = obj.optString('error', 'JS 执行失败');
        JsLog.w(`JsComic[${this.sourceKey}]`, `call error: ${err}`);
        return SourceResult.Error(loginAware(err));
      }
      const data = obj.optJSONObject('data');
      if (data === null) return SourceResult.Error(new ParseError('JS 源无数据'));
      if (detailEpoch === this.chapterCacheEpoch) {
        this.detailCache.set(bookId, {
          at: this.deps.elapsedRealtime(),
          book: JsComicMetadata.book(data, this.id, bookId, this.deps.dom),
        });
        while (this.detailCache.size > 8) {
          const eldest = this.detailCache.keys().next();
          if (eldest.done === true) break;
          this.detailCache.delete(eldest.value);
        }
      }
      const chapters = data.optJSONArray('chapters') ?? new JSONArray();
      let hasExplicitOrder = true;
      const list: ComicChapter[] = [];
      for (let i = 0; i < chapters.length(); i += 1) {
        const c = chapters.optJSONObject(i);
        if (c === null) continue;
        const epId = c.optString('id');
        const title = c.optString('title');
        if (epId.trim() === '' || title.trim() === '') continue;
        hasExplicitOrder =
          hasExplicitOrder &&
          c.has('order') &&
          !c.isNull('order') &&
          Number.isFinite(c.optDouble('order', Number.NaN));
        list.push(
          createComicChapter({
            id: `${bookId}${SEP}${epId}`,
            title,
            volume: blankToNull(c.optString('group', '')),
            order: c.optDouble('order', 0.0),
          }),
        );
      }
      // 与 Venera 一致：单图集/画廊类源（nhentai/hitomi/ehentai 等）
      // loadInfo 不返回 chapters，App 会合成一个"整本阅读"章节
      if (
        list.length === 0 &&
        new Set(['manhuaren', 'goda', 'comick', 'bilimanga', 'vomic']).has(this.sourceKey)
      ) {
        return SourceResult.Error(new ParseError('源站当前未提供这部作品的在线章节'));
      }
      if (list.length === 0) {
        return SourceResult.Success([
          createComicChapter({
            id: `${bookId}${SEP}`,
            title: blankToDefault(data.optString('title'), '开始阅读'),
            order: 1,
          }),
        ]);
      }
      return SourceResult.Success(
        JsChapterOrder.normalize(list, this.sourceKey, hasExplicitOrder),
      );
    } catch (e) {
      if (isCancellation(e)) throw e;
      JsLog.e(`JsComic[${this.sourceKey}]`, 'chapters failed', e);
      return SourceResult.Error(new Unknown(`JS 章节加载失败: ${messageOf(e)}`, e));
    }
  }

  override async getChapterImages(chapterId: string): Promise<SourceResultType<string[]>> {
    const pair = splitChapterId(chapterId);
    if (pair === null) return SourceResult.Error(new ParseError('无效章节 ID'));
    try {
      const obj = await this.callJsWithRetry(
        `src.comic.loadEp.call(src, ${jsonQuote(pair[0])}, ${jsonQuote(pair[1])})`,
      );
      if (obj === null) return SourceResult.Error(new ParseError('JS 源无响应'));
      if (!obj.optBoolean('ok')) {
        const err = obj.optString('error', 'JS 执行失败');
        JsLog.w(`JsComic[${this.sourceKey}]`, `call error: ${err}`);
        return SourceResult.Error(loginAware(err));
      }
      const images = obj.optJSONObject('data')?.optJSONArray('images') ?? new JSONArray();
      const rawUrls: string[] = [];
      for (let i = 0; i < images.length(); i += 1) {
        const value = images.optString(i);
        if (value.trim() !== '') rawUrls.push(value);
      }
      if (rawUrls.length === 0) {
        return SourceResult.Error(new ParseError('该章节没有可读取的图片'));
      }
      if (this.sourceKey === 'ehentai') {
        // e-hentai 返回的是"图片页 URL"，真正的图片在阅读/下载时懒加载，
        // 避免一次性逐页请求（大画廊会等几十秒）
        return SourceResult.Success(rawUrls);
      }
      // 应用 onImageLoad 返回的重写 URL（部分源会替换图片域名/签名）
      // 顺序解析：部分源（ehentai）需要把上一页的 nl 传给下一页才能取到真实图片 URL
      const resolved: string[] = [];
      let prevNl: string | null = null;
      for (const rawUrl of rawUrls) {
        const config = await this.resolveImageConfig(chapterId, rawUrl, prevNl);
        resolved.push(config.finalUrl);
        prevNl = config.nl;
      }
      const pages =
        this.sourceKey === 'mxs'
          ? await stripLeadingMxsSpacers(resolved, async (url) =>
              this.deps.imageProbe.loadBitmap(url, this.headersForUrl(url) ?? {}),
            )
          : resolved;
      if (pages.length === 0) return SourceResult.Error(new ParseError('该章仅包含空白图片'));
      return SourceResult.Success(pages);
    } catch (e) {
      if (isCancellation(e)) throw e;
      JsLog.e(`JsComic[${this.sourceKey}]`, 'images failed', e);
      return SourceResult.Error(new Unknown(`JS 图片加载失败: ${messageOf(e)}`, e));
    }
  }

  /** Kotlin `imageConfigCache.values.firstOrNull { it.finalUrl == url }?.headers`. */
  private headersForUrl(url: string): Record<string, string> | null {
    for (const config of this.imageConfigCache.values()) {
      if (config.finalUrl === url) return config.headers;
    }
    return null;
  }

  override async getChapterImageHeaders(
    chapterId: string,
    urls: string[],
  ): Promise<Record<string, Record<string, string>>> {
    const result: Record<string, Record<string, string>> = {};
    if (this.sourceKey === 'ehentai') {
      for (const url of urls) result[url] = { Referer: 'https://e-hentai.org/' };
      return result;
    }
    if (this.sourceKey === 'goda') {
      for (const url of urls) {
        result[url] = { Referer: 'https://godamh.com/', 'User-Agent': GODA_USER_AGENT };
      }
      return result;
    }
    if (this.sourceKey === 'wnacg') {
      const pair = splitChapterId(chapterId);
      const galleryId =
        pair !== null && pair[1].trim() !== '' ? pair[1] : (pair?.[0] ?? '');
      const baseRaw = (await this.callJs('src.baseUrl'))?.optString('data') ?? '';
      const baseUrl = baseRaw.trim() === '' ? 'https://www.wn001.cfd' : baseRaw;
      const referer = `${baseUrl}/photos-gallery-aid-${galleryId}.html`;
      for (const url of urls) {
        result[url] = { Referer: referer, 'User-Agent': GODA_USER_AGENT };
      }
      return result;
    }
    for (const url of urls) {
      const headers = this.headersForUrl(url) ?? (await this.resolveImageConfig(chapterId, url)).headers;
      if (Object.keys(headers).length > 0) result[url] = headers;
    }
    return result;
  }

  override async resolveChapterImage(url: string): Promise<string | null> {
    if (this.sourceKey !== 'ehentai') return null;
    return this.resolveEhentaiImage(url, 0);
  }

  /** Kotlin `private suspend fun resolveEhentaiImage(url, attempt)`. */
  private async resolveEhentaiImage(url: string, attempt: number): Promise<string | null> {
    const config = await this.resolveImageConfig(`${url}${SEP}`, url);
    const realUrl = config.finalUrl;
    if (realUrl === url) {
      // 图片页解析失败（代理抽风/超时），清掉缓存重试拿新链接
      if (attempt < 3) {
        this.imageConfigCache.delete(url);
        await this.deps.delay(700 * (attempt + 1));
        return this.resolveEhentaiImage(url, attempt + 1);
      }
      return null;
    }
    if (!realUrl.includes('hath.network')) return realUrl;
    // H@H 图床对 OkHttp 握手不友好，改用 Cronet 下载并缓存到本地，阅读器直接加载本地文件
    const cacheDir = `${this.deps.files.cacheDir()}/ehimg`;
    this.deps.files.mkdirs(cacheDir);
    const cacheFile = `${cacheDir}/${(hashCodeOf(realUrl) >>> 0).toString(16)}.img`;
    if (!this.deps.files.exists(cacheFile) || this.deps.files.length(cacheFile) === 0) {
      const headers: Record<string, string> = { ...config.headers, Referer: 'https://e-hentai.org/' };
      const engine = await this.getEngine();
      const bytes = await engine.fetchImageBytes(realUrl, headers);
      if (bytes !== null && bytes.length > 0) {
        // Kotlin `runCatching { cacheFile.writeBytes(bytes) }`
        try {
          this.deps.files.writeBytes(cacheFile, bytes);
        } catch {
          // write failures are non-fatal
        }
      }
      if (
        (this.deps.files.length(cacheFile) === 0 || !this.deps.files.exists(cacheFile)) &&
        attempt < 3
      ) {
        // keystamp 可能过期/代理抽风，重新解析一次拿到新图片链接再下载
        this.imageConfigCache.delete(url);
        await this.deps.delay(800 * (attempt + 1));
        return this.resolveEhentaiImage(url, attempt + 1);
      }
    }
    return this.deps.files.exists(cacheFile) && this.deps.files.length(cacheFile) > 0
      ? this.deps.files.toFileUrl(cacheFile)
      : realUrl;
  }

  override async getResolvedHeaders(url: string): Promise<Record<string, string>> {
    if (this.sourceKey !== 'ehentai') return {};
    const direct = this.imageConfigCache.get(url);
    if (direct !== undefined) return direct.headers;
    return this.headersForUrl(url) ?? {};
  }

  /** Kotlin `private suspend fun resolveImageConfig(chapterId, url, prevNl)`. */
  private async resolveImageConfig(
    chapterId: string,
    url: string,
    prevNl: string | null = null,
  ): Promise<ImageConfig> {
    const cached = this.imageConfigCache.get(url);
    if (cached !== undefined) return cached;
    const pair = splitChapterId(chapterId);
    const fallback: ImageConfig = {
      originalUrl: url,
      finalUrl: url,
      headers: {},
      modifyCode: null,
      nl: null,
    };
    let config: ImageConfig = fallback;
    if (pair !== null) {
      try {
        const nlArg = prevNl !== null ? `, ${jsonQuote(prevNl)}` : '';
        const obj = await this.callJsWithRetry(
          `(src.comic.onImageLoad ? src.comic.onImageLoad.call(src, ${jsonQuote(url)}, ${jsonQuote(pair[0])}, ${jsonQuote(pair[1])}${nlArg}) : null)`,
        );
        if (obj?.optBoolean('ok') === true) {
          const data = obj.optJSONObject('data');
          if (data !== null) {
            const merged: Record<string, string> = {};
            const headers = data.optJSONObject('headers');
            if (headers !== null) {
              for (const k of headers.keys()) merged[k] = headers.optString(k);
            }
            const referer = blankToNull(data.optString('referer'));
            // Kotlin `merged.putIfAbsent("Referer", it)`
            if (referer !== null && !('Referer' in merged)) merged['Referer'] = referer;
            const rewritten = data.optString('url');
            const resolvedUrl =
              rewritten.startsWith('http') || rewritten.startsWith('//')
                ? rewritten.startsWith('//')
                  ? `https:${rewritten}`
                  : rewritten
                : null;
            config = {
              originalUrl: url,
              finalUrl: resolvedUrl ?? url,
              headers: merged,
              modifyCode: blankToNull(data.optString('modifyImage')),
              nl: blankToNull(data.optString('nl')),
            };
          }
        }
      } catch (e) {
        if (isCancellation(e)) throw e;
        config = fallback;
      }
    }
    this.putImageConfig(url, config);
    if (config.modifyCode !== null) {
      JsLog.i(
        'JsImageProcessor',
        `register ${config.finalUrl.slice(0, 80)} code=${config.modifyCode.slice(0, 40).replace(/\n/g, ' ')}`,
      );
      JsImageProcessor.register(config.finalUrl, await this.getEngine(), config.modifyCode);
    } else {
      JsImageProcessor.unregister(config.finalUrl);
    }
    return config;
  }

  /** Kotlin `LinkedHashMap(128, 0.75f, true) { removeEldestEntry { size > 512 } }`. */
  private putImageConfig(key: string, value: ImageConfig): void {
    if (this.imageConfigCache.has(key)) this.imageConfigCache.delete(key);
    this.imageConfigCache.set(key, value);
    while (this.imageConfigCache.size > 512) {
      const eldest = this.imageConfigCache.keys().next();
      if (eldest.done === true) break;
      this.imageConfigCache.delete(eldest.value);
    }
  }

  override async getDetail(bookId: string): Promise<SourceResultType<SearchBook>> {
    const cached = (): SearchBook | null => {
      const hit = this.detailCache.get(bookId);
      if (hit === undefined) return null;
      return this.deps.elapsedRealtime() - hit.at < 60_000 ? hit.book : null;
    };
    const first = cached();
    if (first !== null) return SourceResult.Success(first);
    // loadInfo supplies both metadata and chapters; getChapters serializes/caches the shared request.
    const result = await this.getChapters(bookId);
    const second = cached();
    if (second !== null) return SourceResult.Success(second);
    return result.kind === 'error' ? result : SourceResult.Error(new ParseError('源站未返回作品详情'));
  }

  override async getDownloadInfo(_bookId: string): Promise<SourceResultType<DownloadInfo>> {
    return SourceResult.Error(new ParseError('JS 漫画源请通过章节下载'));
  }

  override async login(credential: LoginCredential): Promise<SourceResultType<boolean>> {
    try {
      if (this.sourceKey === 'mycomic') {
        let supplied = (credential.cookie ?? '').trim();
        if (supplied === '') {
          // 未粘贴 Cookie 时自动过盾：无头 WebView 加载 mycomic.com 让
          // Cloudflare JS 挑战自行执行，cf_clearance 同步进共享 Cookie 存储
          const solved = await this.deps.solveCloudflare('https://mycomic.com/', MYCOMIC_USER_AGENT);
          if (solved) {
            supplied = firstCookieStartingWith(
              this.deps.cookieHeader('https://mycomic.com/'),
              'cf_clearance=',
            ).replace(/^cf_clearance=/, '');
          }
        }
        // Kotlin `supplied.ifBlank { credential.cookie.orEmpty() }.substringAfter("cf_clearance=", supplied)`
        const base = supplied.trim() === '' ? (credential.cookie ?? '') : supplied;
        const afterMarker = base.split('cf_clearance=')[1];
        const clearance = (afterMarker ?? base).split(';')[0]?.trim() ?? '';
        if (clearance === '') {
          return SourceResult.Error(
            new Unknown(
              '自动过 Cloudflare 盾失败：请先用浏览器打开 mycomic.com 过盾，' +
                '在 DevTools→Cookies 复制 cf_clearance 值粘贴到 Cookie 输入框',
            ),
          );
        }
        const cookieResult = await this.callJs(
          `src.account.loginWithCookies.validate.call(src, [${jsonQuote(clearance)}])`,
        );
        if (cookieResult?.optBoolean('ok') === true && cookieResult.optBoolean('data')) {
          (await this.getEngine()).setLoggedIn(true);
          this.invalidateChapterCache();
          return SourceResult.Success(true);
        }
        return SourceResult.Error(new Unknown('Cloudflare 验证未通过，请更新 cf_clearance 后重试'));
      }
      const obj = await this.callJs(
        `src.account && typeof src.account.login === 'function' ? src.account.login.call(src, ${jsonQuote(credential.username)}, ${jsonQuote(credential.password)}) : Promise.resolve(false)`,
      );
      if (obj?.optBoolean('ok') === true && obj.optString('data') === 'ok') {
        (await this.getEngine()).setLoggedIn(true);
        this.invalidateChapterCache();
        return SourceResult.Success(true);
      }
      const raw = obj?.optString('error', '') ?? '';
      JsLog.w(`JsComic[${this.sourceKey}]`, `login error: ${raw}`);
      const lower = raw.toLowerCase();
      let msg: string;
      if (raw.trim() === '') {
        msg = '登录失败：账号或密码错误';
      } else if (lower.includes('invalid email') || lower.includes('invalid password')) {
        msg = '登录失败：账号或密码错误';
      } else if (
        lower.includes('err_') ||
        lower.includes('timed out') ||
        lower.includes('timeout') ||
        raw.includes('请求超时')
      ) {
        msg = '登录失败：网络无法连接该源（该源被墙，请开系统代理或 VPN）';
      } else {
        msg = `登录失败：${friendlyJsSourceError(raw)}`;
      }
      return SourceResult.Error(new Unknown(msg));
    } catch (e) {
      if (isCancellation(e)) throw e;
      return SourceResult.Error(new Unknown(`登录失败: ${messageOf(e)}`, e));
    }
  }

  /**
   * 站内注册（vomic 等支持 account.register 的源）：
   * JS 侧驱动弹窗链（邮箱→验证码→昵称→密码→注册→自动登录），
   * 注册成功自动登录后返回 Success。
   */
  async register(): Promise<SourceResultType<boolean>> {
    try {
      const obj = await this.callJs(
        "src.account && typeof src.account.register === 'function' ? src.account.register.call(src) : Promise.reject(new Error('该源不支持站内注册'))",
      );
      if (obj?.optBoolean('ok') === true && obj.optString('data') === 'ok') {
        (await this.getEngine()).setLoggedIn(true);
        this.invalidateChapterCache();
        return SourceResult.Success(true);
      }
      const raw = obj?.optString('error', '') ?? '';
      return SourceResult.Error(new Unknown(raw.trim() === '' ? '注册失败' : raw));
    } catch (e) {
      if (isCancellation(e)) throw e;
      return SourceResult.Error(new Unknown(`注册失败: ${messageOf(e)}`, e));
    }
  }

  /** Kotlin `suspend fun verifyWebsite(): SourceResult<Boolean>`. */
  async verifyWebsite(): Promise<SourceResultType<boolean>> {
    let url: string;
    switch (this.sourceKey) {
      case 'mycomic':
        url = 'https://mycomic.com/cn';
        break;
      case 'nhentai':
        url = 'https://nhentai.net/';
        break;
      default:
        return SourceResult.Error(new Unknown('该源不支持此验证入口'));
    }
    try {
      const runtime = await this.getEngine();
      const userAgent = this.deps.dialogs.defaultUserAgent();
      const verified = await this.deps.verifyWebsite(url, userAgent);
      if (!verified) return SourceResult.Error(new Unknown('站点验证尚未完成'));
      if (this.sourceKey === 'mycomic') {
        await this.applyVerifiedUserAgent(runtime, userAgent);
        this.deps.verificationPrefs.putString(`${this.sourceKey}_user_agent`, userAgent);
      }
      this.invalidateChapterCache();
      return SourceResult.Success(true);
    } catch (e) {
      if (isCancellation(e)) throw e;
      return SourceResult.Error(new Unknown(messageOf(e) || '站点验证失败', e));
    }
  }

  override async logout(): Promise<void> {
    // Kotlin `runCatching { callJs(…) }` / `runCatching { getEngine().setLoggedIn(false) }`
    await this.callJs(
      "src.account && typeof src.account.logout === 'function' ? src.account.logout.call(src) : null",
    ).catch(() => null);
    await this.getEngine()
      .then((engine) => engine.setLoggedIn(false))
      .catch(() => undefined);
    this.invalidateChapterCache();
  }

  override async isLoggedIn(): Promise<boolean> {
    try {
      return (await this.getEngine()).isLoggedIn();
    } catch {
      // Kotlin `runCatching { … }.getOrDefault(false)`
      return false;
    }
  }

  override async getCoverHeaders(url: string): Promise<Record<string, string>> {
    try {
      const obj = await this.callJs(
        `src.comic && typeof src.comic.onThumbnailLoad === 'function' ? src.comic.onThumbnailLoad.call(src, ${jsonQuote(url)}) : null`,
      );
      if (obj?.optBoolean('ok') === true) {
        const data = obj.optJSONObject('data');
        if (data === null) return {};
        const merged: Record<string, string> = {};
        const headers = data.optJSONObject('headers');
        if (headers !== null) {
          for (const k of headers.keys()) merged[k] = headers.optString(k);
        }
        const referer = blankToNull(data.optString('referer'));
        if (referer !== null && !('Referer' in merged)) merged['Referer'] = referer;
        return merged;
      }
      return {};
    } catch (e) {
      if (isCancellation(e)) throw e;
      return {};
    }
  }
}

/** 缓存 Venera 运行时脚本，避免每个源重复读 assets。 */
export const VeneraRuntime = {
  cached: null as string | null,
  /** Kotlin `internal object VeneraRuntime { fun get(context: Context): String }`. */
  get(loader: () => string): string {
    const cached = VeneraRuntime.cached;
    if (cached !== null) return cached;
    const text = loader();
    VeneraRuntime.cached = text;
    return text;
  },
  clear(): void {
    VeneraRuntime.cached = null;
  },
};

function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}

function blankToDefault(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Kotlin `SourceException.LoginRequired` vs `ParseError(friendlyJsSourceError(err))`. */
function loginAware(err: string): Error {
  if (
    err.includes('请先登录') ||
    err.toLowerCase().includes('not logged in') ||
    err.includes('Invalid status code: 401')
  ) {
    return new LoginRequired();
  }
  return new ParseError(friendlyJsSourceError(err));
}

/** Kotlin `private fun splitChapterId(chapterId): Pair<String, String>?`. */
export function splitChapterId(chapterId: string): [string, string] | null {
  const sep = chapterId.indexOf(SEP);
  if (sep <= 0) return null;
  return [chapterId.slice(0, sep), chapterId.slice(sep + SEP.length)];
}

/** Kotlin `private fun JSONObject.optStringOrJoin(key)` — array/object-aware author field. */
export function optStringOrJoin(obj: JSONObject, key: string): string {
  const v = obj.opt(key);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      const text = typeof item === 'string' ? item.trim() : JSON.stringify(item) ?? '';
      if (text.trim() !== '') out.push(text);
    }
    return [...new Set(out)].join('、');
  }
  if (v !== null && typeof v === 'object') {
    const name = (v as Record<string, unknown>)['name'];
    return typeof name === 'string' ? name.trim() : '';
  }
  return '';
}

/** 从 tags 中提取 artist/author/cosplayer/group 作为作者兜底。 */
export function extractAuthorFromTags(tags: JSONArray | null): string {
  if (tags === null) return '';
  const hits: string[] = [];
  for (let i = 0; i < tags.length(); i += 1) {
    const t = tags.optString(i);
    const lower = t.toLowerCase();
    // Kotlin `t.substringAfter(':')` keeps any later colons.
    const after = (prefix: string): string | null =>
      lower.startsWith(prefix) ? t.slice(prefix.length).trim() : null;
    const hit = after('artist:') ?? after('author:') ?? after('cosplayer:') ?? after('group:');
    if (hit !== null && hit.trim() !== '') hits.push(hit);
  }
  return [...new Set(hits)].join('、');
}

/** 提取作品编号（jm 号 / ehentai gid / nhentai id 等），方便用户按号码搜索。 */
export function extractComicId(c: JSONObject): string | null {
  const id = c.optString('id').trim();
  if (id === '') return null;
  const patterns = [/\/g\/(\d+)\//, /album[=/](\d+)/, /\/(\d+)\/?$/];
  for (const re of patterns) {
    const hit = re.exec(id)?.[1];
    if (hit !== undefined) return hit;
  }
  if (id.split('').every((ch) => /[0-9]/.test(ch))) return id;
  return null;
}

/** Kotlin `String.split(';').map { it.trim() }.firstOrNull { it.startsWith(prefix) }`. */
function firstCookieStartingWith(header: string, prefix: string): string {
  for (const item of header.split(';').map((it) => it.trim())) {
    if (item.startsWith(prefix)) return item;
  }
  return '';
}

/** Kotlin `realUrl.hashCode()` — the JVM string hash, kept for cache filenames. */
export function hashCodeOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

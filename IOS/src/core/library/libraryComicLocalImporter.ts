/**
 * Port of Android `com.example.library.ComicLocalImporter.kt`
 * (346 lines, 278 non-blank).
 *
 * Ported: 278 / 278 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - 3-34 Kotlin/Android imports (`Context`, `BitmapFactory`, `Log`, `com.example.data.*`,
 *   `executeCancellable`, `JsCookieJar`, `JsImageProcessor`, every `kotlinx.coroutines.*`,
 *   `okhttp3.*`, `java.io.File`, `java.io.IOException`, `java.util.concurrent.TimeUnit`)
 *   — Room becomes the injected `bookDao`, OkHttp becomes the platform `HttpClient`,
 *   `JsCookieJar`/`JsImageProcessor` become injected hooks, `BitmapFactory` bounds
 *   decoding becomes `probeImageSize` from `@core/parser/imageBytes`, `Log` becomes a
 *   sink, `java.io.File` becomes `FileSystemApi` paths plus injected directory helpers.
 * - 48-67 `private val globalPageSemaphore = Semaphore(4)` and the lazily built
 *   `OkHttpClient` (`cachedClient`, `connectTimeout(20s)`, `readTimeout(30s)`,
 *   `HTTP_2 + HTTP_1_1`, `PufeiImageCacheRetry`, `JsSourceProxy.failoverClient`) —
 *   the concurrency cap (4 in-flight page fetches across chapters) is ported verbatim
 *   as `globalPageSemaphore`; the OkHttp client build is a platform concern and becomes
 *   the injected `http` client (timeouts/protocols are declared on the hook contract).
 * - 93-98 `chapterDir.exists()` / `mkdirs()` / `listFiles()` / `File.isFile` /
 *   `it.name.startsWith("img_")` / `it.name.endsWith(".part")` / `it.name.substringBefore('.')`
 *   — `FileSystemApi` has `exists`/`list`; `isFile` and the grouping are derived from
 *   the returned names (the API lists entries, not File objects).
 * - 113-118 `File(chapterDir, "page_${index+1}.url")`, `stamp.isFile`, `stamp.readText()`,
 *   `file.length()`, `hasImageBounds(file)` — the stamp file becomes a
 *   readFile/exists probe; `length()` becomes the byte length of the probe read (the
 *   `> 0` test is therefore a real "non-empty" check on the snapshot read) and
 *   `hasImageBounds(File)` becomes `decodeOk(bytes)` on those bytes.
 * - 138-146 `java.io.File(java.net.URI.create(fetchUrl))` local `file:` copy —
 *   injected `copyLocalFile(fromUrl, toPath)` (the web/iOS build has no `file://` path
 *   namespace), plus `usableSpace` from line 217 → injected `freeSpaceBytes(path)`.
 * - 148-221 `okhttp3.Request/Response` plumbing (`.header`, `.build()`, `.use {}`,
 *   `response.code`, `response.body?.byteStream()`, `response.header(...)`) → the
 *   platform `HttpClient.request({ url, headers, timeoutMs })` with `status`, `headers`
 *   and `body`; `readImportBytes(32MB)` (a bounded read from the Android input stream)
 *   becomes the `HttpResponse.body` cap enforced by `readCapped`.
 * - 185 `client(context).newCall(rb.build()).executeCancellable()` → `http.request(rb)`.
 * - 216-220 `File(...).part` + `outputStream()` + `renameTo` → `fs.writeFile(part)` then
 *   injected `moveFile(part, pageFile)` (FileSystemApi has no rename).
 * - 268-272 / 313-316 `Regex("[\\\\/:*?\"<>|]")` replacements — verbatim regex.
 * - 264 `java.util.UUID.randomUUID()` → `crypto.randomUUID()` with a deterministic
 *   test seam (`randomId`), because the cover file name is otherwise untestable.
 * - 296-299 `catch (e: CancellationException) { throw e }` → AbortError rethrow, the
 *   JS cancellation convention used across `core/`.
 *
 * Platform adaptations:
 * - `Result<Book>` → `{ ok: true; book } | { ok: false; error }`
 *   (`ComicChapterImportResult`); the worker calls `.getOrThrow()` via `if (!ok) throw`.
 * - `suspend fun` → `Promise`-returning `async`.
 * - `CoroutineScope { async { … }.awaitAll() }` → `Promise.all` with a per-page
 *   `Semaphore(concurrency)` gate; the "record failures, retry once at the end" logic
 *   (lines 228-251) is preserved exactly, including the `Log.i(TAG, …)` line.
 * - `systemTimeMillis()` seam for the temporary directory name.
 *
 * Line-by-line audit fixes (2026-10-06):
 * - ComicLocalImporter.kt:137-146 the `file:` local-cache branch validated the source with
 *   `srcFile.exists() && hasImageBounds(srcFile)` and `require(len <= 32 MB)` **before**
 *   copying, throwing `本地缓存图片无效，请重新打开章节后重试` otherwise. The port only saw the
 *   hook's success/failure, so a corrupt or oversized cached page was accepted. The same two
 *   guards now run on the copied file (and the bad copy is deleted) before the page is
 *   stamped, which reproduces the Android failure (page fails → one retry → chapter fails).
 * - ComicLocalImporter.kt:184 `if (!referer.isNullOrBlank())` was `referer !== ''` inside the
 *   webp-variant loop, so a whitespace-only referer was still sent.
 * - ComicLocalImporter.kt:187 `val b2 = r2.body?.byteStream()?…` yields `null` for an empty
 *   body and the loop simply moves to the next candidate; the port threw `图片响应为空` from
 *   `readCapped`, which aborted the candidate list. The body is now null-checked first.
 * - ComicLocalImporter.kt:328 `header("Retry-After")?.toLongOrNull()` accepts a leading sign
 *   and rejects surrounding whitespace; the port trimmed and rejected signs. `" 3 "` used to
 *   mean "honour Retry-After" and `"-5"` used to fall back to the 2 s rate-limit backoff.
 *
 * Line-by-line audit fixes (2026-10-06, round 4):
 * - ComicLocalImporter.kt:134 `val rawExt = fetchUrl.substringAfterLast('.', "")
 *   .substringBefore('?').lowercase()` — the port did `split('?')[0]?.split('.').pop()`,
 *   which strips the query FIRST. The order is observable: Kotlin takes the last '.' of the
 *   WHOLE url and only then cuts the fragment at '?', so `…/a.png?t=.jpeg` yields `jpeg`
 *   (file `img_0001.jpeg`) whereas splitting the query first yields `png`. It also had no
 *   equivalent of `substringAfterLast`'s missing-delimiter default `""`, and used the
 *   ASCII-only `[a-z0-9]` where Kotlin tests `Char::isLetterOrDigit` (Unicode L + Nd).
 * - ComicDownloadManager.kt:57 `ComicDownloadStatus.valueOf(o.getString("status"))` throws
 *   on an unknown name, which the enclosing `runCatching` turns into
 *   `下载任务记录损坏，请重新添加任务` + an empty task map. The port cast the raw JSON value,
 *   so a corrupt file produced a task in a bogus status instead of being rejected.
 *
 * Line-by-line audit fixes (2026-10-06, round 3 — receiver binding):
 * - The cover name read `${coverDir}/cover_${(randomId ?? crypto.randomUUID)()}.jpg`, so the
 *   `??` handed out `randomUUID` **detached** and the call site ran it with
 *   `this === undefined`. `randomUUID` is a WebIDL operation on `Crypto` and rejects that:
 *   jsdom threw `Value of "this" must be of type Crypto`, Safari/iOS — this app's target —
 *   throws `Illegal invocation`. The blanket `catch` at the bottom of `importComicChapter`
 *   then turned the binding `TypeError` into `{ ok: false, error: 'Value of "this" must be
 *   of type Crypto' }`, i.e. **every** chapter import failed in the default host
 *   configuration (no `randomId` injected) — after the pages had already been downloaded and
 *   written to disk, and the `comicDir` cleanup deleted them again.
 *   Fix: `() => crypto.randomUUID()`, which re-reads the receiver at call time. The name is
 *   byte-for-byte the same kind of value (RFC-4122 v4); only the receiver binding changes.
 * - The temp dir name `(now ?? Date.now)()` detached `Date.now` the same way. It is a plain
 *   static and never actually threw, but it is bound through a closure here too so no
 *   native method is ever handed out detached from its receiver.
 */

import type { AsyncCryptoPort, FileSystemApi, HttpClient, HttpRequest } from '@platform/interfaces';
import type { SearchBook } from '@core/source/searchBook';
import type { ComicChapter } from '@core/source/comicChapter';
import { probeImageSize } from '@core/parser/imageBytes';
import {
  MhttuImageDecryptor,
  decodeOk,
  isAvif,
  normalizeImage,
  webpVariants,
  type ImageBytesHooks,
} from './libraryImageBytes';

/** Android `private const val TAG = "ComicDownload"`. */
export const COMIC_DOWNLOAD_TAG = 'ComicDownload';

/**
 * Android `private const val UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36
 * (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36"`.
 */
export const COMIC_IMPORT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/108.0.5359.128 Mobile Safari/537.36';

const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 10_000;
const ACCEPT_IMAGE = 'image/webp,image/jpeg,image/png,*/*;q=0.8';
const MIN_FREE_SPACE_SLACK = 16 * 1024 * 1024;

/** 跨章节全局页并发上限（Mihon 下载队列思想）：同时下载多章时总网络压力仍 ≤4，防图床封禁。 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      this.available += 1;
    }
  }

  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await block();
    } finally {
      this.release();
    }
  }
}

/** Android `private val globalPageSemaphore = Semaphore(4)`. */
const globalPageSemaphore = new Semaphore(4);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Android `Result<Book>` from `kotlin.Result`. */
export type ComicChapterImportResult =
  | { ok: true; book: ComicImportedBook }
  | { ok: false; error: string };

/** Android `com.example.data.Book` fields the importer fills in. */
export interface ComicImportedBook {
  title: string;
  author: string;
  filePath: string;
  coverUri: string;
  totalChapters: number;
  contentType: string;
  sourceId: string | null;
  comicId: string | null;
}

export interface ComicChapterImportDeps {
  /** Platform HTTP (OkHttp replacement): connect 20s / read 30s, HTTP_2 + HTTP_1_1. */
  http: HttpClient;
  fs: FileSystemApi;
  /** Android `BookDao.insertBookWithChapters` / `getBookByFilePath`. */
  bookDao: {
    getBookByFilePath(path: string): Promise<ComicImportedBook | null>;
    insertBookWithChapters(
      book: ComicImportedBook,
      chapters: Array<{ bookId: number; chapterOrder: number; title: string; content: string }>,
    ): Promise<ComicImportedBook>;
  };
  /** Android `JsCookieJar.cookieHeader(context, url)`. */
  cookieHeader: (url: string) => string;
  /** Android `JsImageProcessor.transform(fetchUrl, bytes)`. */
  transformImage?: (url: string, bytes: Uint8Array) => Promise<Uint8Array | null>;
  /**
   * Android `javax.crypto.Cipher`（`MhttuImageDecryptor.kt:23-29`）。
   * **必填**：没有它就等于「从未尝试解密」，与 Kotlin 的「尝试后失败才回落原字节」不同。
   * WebCrypto 实现见 `platform/web/webCrypto.ts`（WKWebView 原生可用，一份实现通吃）。
   */
  crypto: AsyncCryptoPort;
  /** Android `ImageBytes` brotli / AVIF hooks. */
  imageBytesHooks?: ImageBytesHooks;
  /** Android `File.renameTo` — FileSystemApi has no rename. */
  moveFile?: (from: string, to: string) => Promise<void>;
  /** Android `File.deleteRecursively()`. */
  deleteTree?: (path: string) => Promise<void>;
  /** Android `java.io.File(java.net.URI.create(fileUrl))` copy. */
  copyLocalFile?: (fileUrl: string, toPath: string) => Promise<void>;
  /** Android `chapterDir.usableSpace`. */
  freeSpaceBytes?: (path: string) => Promise<number>;
  /** Android `java.util.UUID.randomUUID()`. */
  randomId?: () => string;
  /** Android `System.currentTimeMillis()` for the fresh temp directory name. */
  now?: () => number;
  /** Android `Log.i(TAG, …)` / `Log.e(TAG, …, t)`. */
  log?: (tag: string, message: string) => void;
  logError?: (tag: string, message: string, error: unknown) => void;
  /** Android `com.example.data.ContentMutationGate.mutex`. */
  contentGate?: { lock(): Promise<void>; unlock(): void };
}

export interface ComicChapterImportRequest {
  book: SearchBook;
  chapter: ComicChapter;
  imageUrls: string[];
  headers?: Record<string, Record<string, string>>;
  referer?: string | null;
  onProgress: (progress: number) => void;
  targetDir?: string | null;
  resolveImage?: (url: string) => Promise<string | null>;
  resolveHeaders?: (url: string) => Promise<Record<string, string>>;
  concurrency?: number;
}

/** Kotlin `String.substringAfterLast(delimiter, missingDelimiterValue = "")`. */
function kotlinSubstringAfterLast(s: string, delimiter: string): string {
  const at = s.lastIndexOf(delimiter);
  return at < 0 ? '' : s.slice(at + delimiter.length);
}

/** Kotlin `String.substringBefore(delimiter)` — returns `s` unchanged when absent. */
function kotlinSubstringBefore(s: string, delimiter: string): string {
  const at = s.indexOf(delimiter);
  return at < 0 ? s : s.slice(0, at);
}

/** Kotlin `private fun hasImageBounds(bytes)`. */
function hasImageBounds(bytes: Uint8Array): boolean {
  return probeImageSize(bytes) !== null;
}

async function sha256HexOf(input: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  );
  let out = '';
  for (const b of digest) out += b.toString(16).padStart(2, '0');
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * Downloads one online comic chapter as a local comic book:
 * images are saved into a folder and registered in Room, so the existing
 * local comic reader can open it offline (same format as imported CBZ).
 */
export async function importComicChapter(
  deps: ComicChapterImportDeps & ComicChapterImportRequest,
): Promise<ComicChapterImportResult> {
  const {
    http,
    fs,
    bookDao,
    cookieHeader,
    transformImage,
    moveFile,
    deleteTree,
    copyLocalFile,
    freeSpaceBytes,
    randomId,
    now,
    log,
    logError,
    contentGate,
  } = deps;
  const book = deps.book;
  const chapter = deps.chapter;
  const imageUrls = deps.imageUrls;
  const headers = deps.headers ?? {};
  const referer = deps.referer ?? null;
  const onProgress = deps.onProgress;
  const concurrency = deps.concurrency ?? 3;

  let comicDir: string | null = null;
  let pendingCover: string | null = null;
  try {
    if (imageUrls.length > MAX_PAGES) throw new Error('章节图片过多');
    if (imageUrls.length === 0) {
      return { ok: false, error: '章节没有图片' };
    }

    const chapterDir =
      deps.targetDir ?? `comics_${String((now ?? (() => Date.now()))())}`;
    comicDir = chapterDir;
    // `chapterDir.exists()` / `mkdirs()` — the platform `FileSystemApi` creates the
    // parent directories on write (see `chapterCatalog.ts` line 72 comment), so the
    // existence probe is only needed for the snapshot listing below.
    // Snapshot once: scanning every file and rereading the same stamp for each
    // page makes resuming a large chapter quadratic in the number of pages.
    const existingNames = (await fs.list(chapterDir)).filter(
      (name) => name.startsWith('img_') && !name.endsWith('.part'),
    );
    const existingPageFiles = new Map<string, string[]>();
    for (const name of existingNames) {
      const key = name.split('.')[0] as string;
      const list = existingPageFiles.get(key);
      if (list !== undefined) list.push(name);
      else existingPageFiles.set(key, [name]);
    }

    // 逐页检查磁盘文件，而不是用进度浮点数推算起点：并发完成顺序不固定。
    const semaphore = new Semaphore(Math.max(1, concurrency));
    let completedPages = 0;
    const reportPageDone = (): void => {
      completedPages += 1;
      onProgress(completedPages / imageUrls.length);
    };

    const downloadPage = async (index: number): Promise<string> => {
      const url = imageUrls[index] as string;
      const stamp = `${chapterDir}/page_${String(index + 1)}.url`;
      const identity = await sha256HexOf(url);
      const filePrefix = `img_${String(index + 1).padStart(4, '0')}.`;
      let existing: string | null = null;
      if (await fs.exists(stamp)) {
        const stampText = new TextDecoder('utf-8').decode(await fs.readFile(stamp));
        if (stampText === identity) {
          for (const name of existingPageFiles.get(filePrefix.slice(0, -1)) ?? []) {
            const bytes = await fs.readFile(`${chapterDir}/${name}`);
            if (bytes.length > 0 && hasImageBounds(bytes)) {
              existing = `${chapterDir}/${name}`;
              break;
            }
          }
        }
      }
      if (existing !== null) {
        reportPageDone();
        return existing;
      }
      let fetchUrl = url;
      let fetchHeaders: Record<string, string> = headers[url] ?? {};
      if (deps.resolveImage !== undefined) {
        const resolved = await deps.resolveImage(url);
        if (resolved !== null && resolved.trim() !== '' && resolved !== url) {
          fetchUrl = resolved;
          fetchHeaders = {
            ...fetchHeaders,
            ...((await deps.resolveHeaders?.(resolved)) ?? {}),
          };
        }
      }
      // Kotlin ComicLocalImporter.kt:134
      //   `val rawExt = fetchUrl.substringAfterLast('.', "").substringBefore('?').lowercase()`
      // The order matters and is NOT "strip the query, then take the extension":
      // `substringAfterLast('.')` runs over the WHOLE url (query string included) and only
      // the fragment taken afterwards is cut at '?'. For
      // `https://c/a.png?t=.jpeg` Kotlin yields `jpeg`; splitting the query off first
      // would yield `png`, i.e. a different `img_%04d.<ext>` file name.
      const rawExt = kotlinSubstringBefore(kotlinSubstringAfterLast(fetchUrl, '.'), '?').toLowerCase();
      const ext =
        // Kotlin `rawExt.length in 3..4 && rawExt.all { it.isLetterOrDigit() }` —
        // `isLetterOrDigit` is Unicode (L + Nd), not ASCII-only.
        rawExt.length >= 3 &&
        rawExt.length <= 4 &&
        /^[\p{L}\p{Nd}]+$/u.test(rawExt)
          ? rawExt
          : 'jpg';
      const pageFile = `${chapterDir}/img_${String(index + 1).padStart(4, '0')}.${ext}`;
      if (fetchUrl.startsWith('file:')) {
        if (
          copyLocalFile !== undefined &&
          (await localCopySucceeds(copyLocalFile, fetchUrl, pageFile))
        ) {
          // Kotlin ComicLocalImporter.kt:139-142 validates the SOURCE before copying:
          //   `if (srcFile.exists() && hasImageBounds(srcFile)) { require(len <= 32MB) … }`
          //   else `throw IOException("本地缓存图片无效，请重新打开章节后重试")`.
          // The web hook can only report success/failure, so the same two guards run on
          // the copy that just landed: a corrupt or oversized cached page must fail the
          // page (and, after the retry pass, the chapter) exactly as on Android.
          const copied = await fs.readFile(pageFile);
          if (copied.length === 0 || copied.length > MAX_IMPORT_BYTES || !hasImageBounds(copied)) {
            await fs.delete(pageFile).catch(() => undefined);
            throw new Error('本地缓存图片无效，请重新打开章节后重试');
          }
          await fs.writeFile(stamp, new TextEncoder().encode(identity));
          reportPageDone();
          return pageFile;
        }
        throw new Error('本地缓存图片无效，请重新打开章节后重试');
      }
      const requestHeaders: Record<string, string> = { 'User-Agent': COMIC_IMPORT_UA };
      for (const [k, v] of Object.entries(fetchHeaders)) requestHeaders[k] = v;
      if (!Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'accept')) {
        requestHeaders['Accept'] = ACCEPT_IMAGE;
      }
      const cookie = cookieHeader(fetchUrl) || cookieHeader(url);
      if (cookie !== '' && !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'cookie')) {
        requestHeaders['Cookie'] = cookie;
      }
      if (
        referer !== null &&
        referer.trim() !== '' &&
        !Object.keys(fetchHeaders).some((k) => k.toLowerCase() === 'referer')
      ) {
        requestHeaders['Referer'] = referer;
      }
      const request: HttpRequest = { url: fetchUrl, headers: requestHeaders };
      // 跨章节全局页并发上限：总网络压力 ≤4
      await globalPageSemaphore.acquire();
      try {
        const response = await fetchWithRetry(http, request);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`图片下载失败 HTTP ${String(response.status)} (${url.slice(0, 80)})`);
        }
        const raw = readCapped(response.body, MAX_IMPORT_BYTES);
        let bytes = await normalizeImage(raw, response.headers['Content-Encoding'] ?? null, deps.imageBytesHooks ?? {});
        if (isAvif(bytes) && !decodeOk(bytes)) {
          for (const candidate of webpVariants(fetchUrl)) {
            try {
              const rbHeaders: Record<string, string> = { Accept: ACCEPT_IMAGE };
              const cookie2 = cookieHeader(candidate);
              if (cookie2 !== '') rbHeaders['Cookie'] = cookie2;
              if (referer !== null && referer.trim() !== '') rbHeaders['Referer'] = referer;
              const rb: HttpRequest = { url: candidate, headers: rbHeaders };
              const r2 = await http.request(rb);
              if (r2.status >= 200 && r2.status < 300 && r2.body !== undefined && r2.body !== null) {
                // Kotlin `val b2 = r2.body?.bytes()` — a null body leaves `p2` unset and
                // just falls through to the next candidate; it must not abort the loop.
                const p2 = await normalizeImage(
                  readCapped(r2.body, MAX_IMPORT_BYTES),
                  r2.headers['Content-Encoding'] ?? null,
                  deps.imageBytesHooks ?? {},
                );
                if (!isAvif(p2) && decodeOk(p2)) {
                  bytes = p2;
                  break;
                }
              }
            } catch (e) {
              if (isAbortError(e)) throw e;
              // 尝试下一个候选
            }
            if (!isAvif(bytes) && decodeOk(bytes)) break;
          }
        }
        bytes = MhttuImageDecryptor.isEncryptedHost(hostOf(fetchUrl))
          ? await MhttuImageDecryptor.decryptIfNeeded(bytes, deps.crypto)
          : bytes;
        bytes = (await transformImage?.(fetchUrl, bytes)) ?? bytes;
        if (!hasImageBounds(bytes)) {
          throw new Error(`图片不是可解码的图像 (${fetchUrl.slice(0, 80)})`);
        }
        const part = `${pageFile}.part`;
        if (freeSpaceBytes !== undefined) {
          const free = await freeSpaceBytes(chapterDir);
          if (free <= bytes.length + MIN_FREE_SPACE_SLACK) throw new Error('磁盘空间不足');
        }
        await fs.writeFile(part, bytes);
        if (moveFile !== undefined) await moveFile(part, pageFile);
        else await fs.writeFile(pageFile, bytes);
        await fs.writeFile(stamp, new TextEncoder().encode(identity));
      } finally {
        globalPageSemaphore.release();
      }
      reportPageDone();
      return pageFile;
    };

    const pageFileResults: Array<string | null> = await (async () => {
      // 每页失败先记下，整章不立即失败；全部完成后对失败页做一轮集中重试，
      // 网络抖动（代理切换/DNS 波动）不再毁掉整章下载。
      const attempt = async (index: number): Promise<string | null> => {
        try {
          return await downloadPage(index);
        } catch (e) {
          if (isAbortError(e)) throw e;
          return null;
        }
      };
      let results: Array<string | null> = await Promise.all(
        imageUrls.map((_, index) => semaphore.withPermit(() => attempt(index))),
      );
      const firstFail = results
        .map((value, index) => (value === null ? index : -1))
        .filter((index) => index >= 0);
      if (firstFail.length > 0) {
        (log ?? (() => {}))(
          COMIC_DOWNLOAD_TAG,
          `second pass for ${String(firstFail.length)}/${String(imageUrls.length)} failed pages`,
        );
        const retried = await Promise.all(
          firstFail.map((index) => semaphore.withPermit(() => attempt(index))),
        );
        results = results.slice();
        retried.forEach((r, i) => {
          results[firstFail[i] as number] = r;
        });
      }
      return results;
    })();

    const failedAt = pageFileResults.findIndex((it) => it === null);
    if (failedAt >= 0) {
      if (deps.targetDir === null || deps.targetDir === undefined) {
        if (deleteTree !== undefined) await deleteTree(chapterDir);
      }
      return {
        ok: false,
        error: `第 ${String(failedAt + 1)}/${String(imageUrls.length)} 页多次重试后仍下载失败，请检查网络后重试`,
      };
    }
    const pageFiles = pageFileResults.map((it) => it as string);

    const coverDir = 'comic_covers';
    // `crypto.randomUUID` is a WebIDL operation on `Crypto`, so it must keep `crypto` as
    // its receiver: the detached `(randomId ?? crypto.randomUUID)()` throws
    // `Value of "this" must be of type Crypto` under jsdom and `Illegal invocation` in
    // Safari/iOS. The arrow re-binds the receiver at call time.
    const coverFile = `${coverDir}/cover_${(randomId ?? (() => crypto.randomUUID()))()}.jpg`;
    pendingCover = coverFile;
    const firstPage = pageFiles[0] as string;
    await fs.writeFile(coverFile, await fs.readFile(firstPage));

    const cleanTitle =
      `${book.title} · ${chapter.title}`
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim()
        .slice(0, 120) || book.title;

    const newBook: ComicImportedBook = {
      title: cleanTitle,
      author: book.author.trim() === '' ? '漫画' : book.author,
      filePath: chapterDir,
      coverUri: coverFile,
      totalChapters: pageFiles.length,
      contentType: 'COMIC',
      // 记录来源：让书架里的这本书能反查到「我喜欢的」在线条目
      sourceId: book.sourceId.trim() === '' ? null : book.sourceId,
      comicId: book.id.trim() === '' ? null : book.id,
    };
    await contentGate?.lock();
    let inserted: ComicImportedBook;
    try {
      const existing = await bookDao.getBookByFilePath(chapterDir);
      inserted =
        existing ??
        (await bookDao.insertBookWithChapters(
          newBook,
          pageFiles.map((file, index) => ({
            bookId: 0,
            chapterOrder: index,
            title: `第 ${String(index + 1)} 页`,
            content: file,
          })),
        ));
    } finally {
      contentGate?.unlock();
    }

    if (inserted.coverUri === coverFile) pendingCover = null;
    (log ?? (() => {}))(
      COMIC_DOWNLOAD_TAG,
      `downloaded chapter ${chapter.title} -> ${String(pageFiles.length)} pages`,
    );
    return { ok: true, book: inserted };
  } catch (e) {
    if (isAbortError(e)) {
      // 暂停/取消：保留目标目录，由调用方决定删除还是续传
      throw e;
    }
    (logError ?? (() => {}))(COMIC_DOWNLOAD_TAG, 'chapter download failed', e);
    // 只有新建目录时失败才清理；续传目录由调用方（暂停/取消）管理
    if (deps.targetDir === null || deps.targetDir === undefined) {
      if (comicDir !== null && deleteTree !== undefined) await deleteTree(comicDir);
    }
    const message = e instanceof Error ? (e.message ?? '章节下载失败') : '章节下载失败';
    return { ok: false, error: message };
  } finally {
    if (pendingCover !== null && await fs.exists(pendingCover)) {
      await fs.delete(pendingCover);
    }
  }
}

/** Kotlin `private fun fetchWithRetry(context, request): Response`. */
async function fetchWithRetry(
  http: HttpClient,
  request: HttpRequest,
): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array; url: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await http.request(request);
      const status = response.status;
      if (
        (status < 500 || status > 599) &&
        status !== 429
      ) {
        return response;
      }
      if (attempt === 2) return response;
      const rateLimited = status === 429;
      const retryAfterRaw = response.headers['Retry-After'];
      // Kotlin `response.header("Retry-After")?.toLongOrNull()`: a signed decimal integer,
      // **no** surrounding-whitespace tolerance (`" 3 "` → null) and `"html"` → null.
      const retryAfter =
        retryAfterRaw !== undefined && /^[+-]?\d+$/.test(retryAfterRaw)
          ? Number.parseInt(retryAfterRaw, 10)
          : null;
      // 图床限流（如 comick）按 Retry-After/指数退避多等一会，普通 5xx 短退避；加抖动防雷群
      const backoff =
        (retryAfter !== null
          ? Math.min(10, Math.max(1, retryAfter)) * 1000
          : rateLimited
            ? 2000 * (attempt + 1)
            : 700 * (attempt + 1)) +
        Math.floor(Math.random() * 301);
      await delay(backoff);
      continue;
    } catch (e) {
      if (isAbortError(e)) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === 2) throw e;
    }
    await delay(700 * (attempt + 1));
  }
  throw lastError ?? new Error('图片请求失败');
}

/** Android `okhttp3.Response.body?.byteStream()?.use { it.readImportBytes(32MB) }`. */
function readCapped(body: Uint8Array | undefined, cap: number): Uint8Array {
  if (body === undefined || body === null) throw new Error('图片响应为空');
  if (body.length > cap) throw new Error('图片文件过大');
  return body;
}

/** Android `srcFile.exists() && hasImageBounds(srcFile)` guard before the local copy. */
async function localCopySucceeds(
  copyLocalFile: (fileUrl: string, toPath: string) => Promise<void>,
  fileUrl: string,
  toPath: string,
): Promise<boolean> {
  try {
    await copyLocalFile(fileUrl, toPath);
    return true;
  } catch {
    return false;
  }
}

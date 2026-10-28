/**
 * Port of Android `com.example.library.BookShareHelper.kt`
 * (317 lines, 250 non-blank).
 *
 * Ported: 250 / 250 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - 3-22 Kotlin/Android imports (`Activity`, `ActivityNotFoundException`, `Context`,
 *   `Intent`, `android.net.Uri`, `Log`, `FileProvider`, `AppDatabase`, `Book`,
 *   `DownloadStatus`, every `kotlinx.coroutines.*`, `java.io.File`, `FileOutputStream`,
 *   `ZipEntry`, `ZipOutputStream`) — see "Platform adaptations" below for each.
 * - 47-52 `private data class ShareTarget(uri: Uri, mime: String, tempFiles: List<File>)`
 *   → `BookShareTarget` with an `objectUrl`/`filePath` string instead of an Android
 *   `Uri` (there is no `content://`/`FileProvider` authority on this platform).
 * - 54 `private fun authority(context) = "${packageName}.fileprovider"` — Android
 *   FileProvider authority; on web/iOS the file is handed to the browser as a
 *   `blob:`/`File` object URL, so no authority string is needed.
 * - 63-64 `dir.listFiles()?.filter { it.lastModified() < cutoff }` — `FileSystemApi`
 *   exposes no mtime, so the retention sweep keeps the newest entry per share via the
 *   injected `listShareTemp()` hook (the hook returns entries with `modifiedAt`).
 * - 78-89 the `withContext(Dispatchers.Main) { Intent(ACTION_SEND) … createChooser …
 *   startActivity }` block → the Web Share API / clipboard / download fallback declared
 *   on `BookSharePort` (see header). The chooser title string
 *   `分享「${book.title}」` is preserved verbatim as the share title, and the
 *   `Intent.EXTRA_SUBJECT` value is `book.title`.
 * - 103-104 `catch (e: ActivityNotFoundException) { "没有找到可分享的应用" }` — the web
 *   equivalent (`navigator.canShare`/`share` absent or rejecting) returns the exact
 *   same string.
 * - 117-118 `Uri.parse(raw)` + `context.contentResolver.getType(uri)` — SAF
 *   `content://` URIs do not exist in a browser; the MIME for a `content://` path is
 *   resolved through the injected `contentResolverGetType(uri)` hook, and when the hook
 *   is absent the port falls back to `mimeForPath(raw, book)` (the same
 *   `?: mimeForPath(raw, book)` fallback the Kotlin uses).
 * - 127-128 `copyContentUriToTemp(...)` `openInputStream` + `FileOutputStream.copyTo` —
 *   the byte copy is ported onto `FileSystemApi` via the injected
 *   `openContentBytes(uri)` hook.
 * - 183-189 `ZipOutputStream(FileOutputStream(out))` + `putNextEntry` + `copyTo` —
 *   CBZ re-packaging is ported onto the injected `writeZip(entries)` hook (a browser has
 *   no `ZipOutputStream`; `fflate` is already a dependency of this app and is the
 *   natural host implementation).
 * - 205 `File(it.filePath).isFile` — becomes the injected `fileExists(path)`.
 * - 242-247 `context.contentResolver.query(uri, … OpenableColumns.DISPLAY_NAME …)` —
 *   SAF display-name lookup → the injected `contentDisplayName(uri)` hook.
 * - 264 `System.currentTimeMillis()` — `Date.now()` (same epoch).
 *
 * Platform adaptations (declared port):
 *   `BookSharePort.share({ title, objectUrl, fileName, mime })` implements the
 *   `ACTION_SEND` + `createChooser` intent. Hosts should implement it with
 *   `navigator.share({ files: [new File([blob], fileName, { type: mime })] })` when
 *   `navigator.canShare` reports support, `navigator.clipboard.writeText(title)` for the
 *   title-only path, and an `<a download>` click as the final fallback. The Android
 *   "no share target installed" case maps to the returned string
 *   `没有找到可分享的应用`.
 *
 * Line-by-line audit fixes (2026-10-06):
 * - BookShareHelper.kt:141-143 / 289-294 `Book.isComic` is `contentType == "COMIC"`
 *   (Book.kt:43-44), NOT a `comics_` path-name heuristic. `bookIsComic()` now reads
 *   `contentType`; it gated `isZeroCopyFormat` (line 210), `resolveShareTarget` step 5
 *   (line 155) and `resolveExtension`'s callers.
 * - BookShareHelper.kt:177-179 `if (pages.isEmpty()) throw IllegalStateException("漫画页面文件缺失，无法分享")`
 *   was missing — an empty chapter list silently produced an empty .cbz. Restored.
 * - BookShareHelper.kt:141 `if (file.isDirectory)` is now the injected `dirExists(path)`
 *   probe instead of a `comics_` substring test, so the comic branch matches Kotlin for
 *   locally-imported comics stored under any directory name.
 * - BookShareHelper.kt:244/250 `!ext.isNullOrBlank()` / `!pathExt.isNullOrBlank()` now
 *   fold whitespace (they were bare `!== ''` tests).
 * - BookShareHelper.kt:250 `pathExt.all(Char::isLetterOrDigit)` uses the Unicode
 *   letter/digit class (`[\p{L}\p{Nd}]`) instead of the ASCII-only `[a-z0-9]`.
 *
 * Line-by-line audit fixes (2026-10-06, round 3 — receiver binding):
 * - `uuid` / `now` read `(this.deps.randomId ?? crypto.randomUUID)()` and
 *   `(this.deps.now ?? Date.now)()`. The `??` hands out the **detached** method, so the
 *   call site ran `randomUUID` with `this === undefined`. `randomUUID` is a WebIDL
 *   operation on `Crypto`, which rejects that: jsdom threw
 *   `Value of "this" must be of type Crypto` and Safari/iOS — this app's target —
 *   throws `Illegal invocation`. Because `shareBook` wraps `resolveShareTarget` in a
 *   blanket `catch`, the binding `TypeError` was surfaced as the user-facing share
 *   failure message, so in the **default** host configuration (no `randomId` injected)
 *   every share needing a temp file name failed: step 3 (CBZ repack, line 332), step 5
 *   (TXT rebuild, line 478) and the `content://` byte copy (line 403) — i.e. the whole
 *   `BookShareHelper.kt:189/221/133` temp-name contract.
 *   Fix: `() => crypto.randomUUID()` / `() => Date.now()`, which re-read the receiver at
 *   call time. Values are unchanged (same v4 UUID / same epoch ms); only the receiver
 *   binding is fixed. `Date.now` is bound the same way for symmetry — it is a plain
 *   static and never threw, but detaching it is the same latent shape.
 *
 * Line-by-line audit fixes (2026-10-06, round 4):
 * - BookShareHelper.kt:211/243/249/261/298 `path.substringAfterLast('.', "")` runs on the
 *   WHOLE path, not on a directory-stripped base name. `extensionOf` reduced to the base name
 *   first, so `"/a.b/noext"` gave `""` instead of `"b/noext"` — changing `mimeForPath`,
 *   `isZeroCopyFormat` and the `resolveExtension` MIME fallback for any file whose directory
 *   name contains a dot and whose own name has no extension.
 * - BookShareHelper.kt:181 builds the CBZ temp name AFTER the `pages.isEmpty()` guard
 *   (L177); the port computed the UUID first, burning one on the failure path. Reordered.
 */

import type { FileSystemApi } from '@platform/interfaces';
import type { DownloadTaskRow } from './bookTypes';
import type { LibraryLocalBook } from './libraryReadingRecords';

/** Android `private const val TAG = "BookShare"`. */
export const BOOK_SHARE_TAG = 'BookShare';

/** Android `private const val SHARE_TEMP_DIR = "share_temp"`. */
export const SHARE_TEMP_DIR = 'share_temp';

/**
 * 分享临时文件保留时间：给微信/QQ 留足读取时间，超时后自动删除，不长期占双份内存。
 * Android `private const val SHARE_TEMP_RETENTION_MS = 24 * 60 * 60 * 1000L`.
 */
export const SHARE_TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface BookShareTempEntry {
  path: string;
  modifiedAt: number;
}

/** Android `private data class ShareTarget(uri, mime, tempFiles)`. */
export interface BookShareTarget {
  /** Blob / object URL the host hands to the share sheet. */
  objectUrl: string;
  fileName: string;
  mime: string;
  /** 本次分享新建的临时文件（用完即焚，分享后自动删除）。 */
  tempFiles: string[];
}

/** Web Share API / clipboard port for the Android `Intent.ACTION_SEND` chooser. */
export interface BookSharePort {
  /** Returns true when the share sheet was raised; false ⇒ 没有找到可分享的应用. */
  share(target: {
    title: string;
    objectUrl: string;
    fileName: string;
    mime: string;
  }): Promise<boolean>;
  /** Android `FileProvider.getUriForFile(context, authority, file)`. */
  fileObjectUrl(path: string, mime: string): Promise<string>;
}

export interface BookShareHelperDeps {
  fs: FileSystemApi;
  share: BookSharePort;
  /** Android `AppDatabase…bookDao().getChaptersListForBook(book.id)`. */
  chaptersOfBook: (bookId: number) => Promise<Array<{ title: string; content: string }>>;
  /** Android `AppDatabase…downloadTaskDao().getAllTasksSync()`. */
  downloadTasks: () => Promise<DownloadTaskRow[]>;
  /** Android `DownloadManager.originalBookId(task.id, task.sourceId)`. */
  originalBookId: (taskId: string, sourceId: string) => string;
  /** Android `File(path).isFile`. */
  fileExists: (path: string) => Promise<boolean>;
  /**
   * Android `File(path).isDirectory` — BookShareHelper.kt:141 gates the whole comic-archive
   * branch on it (`if (file.isDirectory) return resolveComicArchive(...)`). Without this probe
   * the port cannot tell a chapter directory from a missing path, so the branch would run for
   * every non-file `filePath`. Absent ⇒ treated as "not a directory" (the branch is skipped).
   */
  dirExists?: (path: string) => Promise<boolean>;
  /** Android `ZipOutputStream` over the page files. */
  writeZip?: (entries: Array<{ name: string; path: string }>, outPath: string) => Promise<void>;
  /** Android `context.contentResolver.openInputStream(uri)`. */
  openContentBytes?: (uri: string) => Promise<Uint8Array>;
  /** Android `context.contentResolver.getType(uri)`. */
  contentResolverGetType?: (uri: string) => Promise<string | null>;
  /** Android `OpenableColumns.DISPLAY_NAME` cursor read. */
  contentDisplayName?: (uri: string) => Promise<string | null>;
  /** Android `dir.listFiles()` with mtimes for the retention sweep. */
  listShareTemp?: () => Promise<BookShareTempEntry[]>;
  /** Android `java.util.UUID.randomUUID()`. */
  randomId?: () => string;
  /** Android `System.currentTimeMillis()`. */
  now?: () => number;
  /** Android `Log.w(TAG, …)`. */
  logWarn?: (tag: string, message: string, error: unknown) => void;
  /** Android `uri.lastPathSegment`. */
  lastPathSegment?: (uri: string) => string | null;
  /** Android `context.packageName` — unused on web, kept for host logging parity. */
  packageName?: string;
}

/**
 * 书架长按"分享"：把书籍原文件通过系统分享面板发给微信/QQ 等。
 *
 * 策略（按格式区分）：
 * - content://（本地导入的 SAF 文件）：原 URI 直接分享，零拷贝；
 * - file:// 且文件仍在（EPUB / MOBI / PDF / AZW3 / 本地 TXT）：直接包装原文件，零拷贝；
 * - 漫画（filePath 是解压目录）：优先找回下载任务里保留的原始归档（cbz/zip/pdf），
 *   找不到则把解压页重新打成 cbz 放进 share_temp（用完即焚缓存）；
 * - TXT（下载后原文件已被清理）：从数据库章节内容重建 txt 到 share_temp（用完即焚缓存）。
 *
 * 临时文件清理：每次分享前清空 share_temp/ 旧文件，保证该目录最多只保留"最近一次分享"
 * 的文件，不会无限增长。
 */
export class BookShareHelper {
  private readonly deps: BookShareHelperDeps;

  constructor(deps: BookShareHelperDeps) {
    this.deps = deps;
  }

  private get fs(): FileSystemApi {
    return this.deps.fs;
  }

  private get now(): number {
    // Same receiver-binding rule as `uuid` below: `Date.now` is kept as a closure so no
    // native method is ever handed out detached from its receiver.
    return (this.deps.now ?? (() => Date.now()))();
  }

  private get uuid(): string {
    // `crypto.randomUUID` must stay **bound** to `crypto`: it is a WebIDL operation on
    // `Crypto`, so an unbound call (`(x ?? crypto.randomUUID)()`) throws
    // `Value of "this" must be of type Crypto` under jsdom and `Illegal invocation` in
    // Safari/iOS. The arrow re-binds the receiver at call time.
    return (this.deps.randomId ?? (() => crypto.randomUUID()))();
  }

  /** 冷启动兜底清理：清空分享临时目录。 */
  async cleanupTempShareDir(): Promise<void> {
    try {
      const dir = SHARE_TEMP_DIR;
      if (!(await this.fs.exists(dir))) return;
      const list = this.deps.listShareTemp ?? (() => Promise.resolve([] as BookShareTempEntry[]));
      const cutoff = this.now - SHARE_TEMP_RETENTION_MS;
      for (const entry of await list()) {
        if (entry.modifiedAt < cutoff) {
          try {
            await this.fs.delete(entry.path);
          } catch {
            // Android `runCatching { it.delete() }`
          }
        }
      }
    } catch {
      // Android `runCatching { … }` around the whole cold-start sweep.
    }
  }

  /**
   * 分享书籍。返回 null 表示已成功拉起分享面板，否则返回错误文案。
   * 内部定位/生成文件后，通过 Web Share API 拉起分享面板。
   */
  async shareBook(book: LibraryLocalBook): Promise<string | null> {
    try {
      // 用前清空旧的分享临时文件（用完即焚：目录里永远只有最近一份）
      await this.cleanupTempShareDir();

      const target = await this.resolveShareTarget(book);

      const raised = await this.deps.share.share({
        title: `分享「${book.title}」`,
        objectUrl: target.objectUrl,
        fileName: target.fileName,
        mime: target.mime,
      });
      if (!raised) return '没有找到可分享的应用';

      // 用完即焚：分享拉起来后延时删除本次临时文件。
      // 不立即删——分享面板关闭不代表目标应用已经读完文件。
      if (target.tempFiles.length > 0) {
        this.scheduleTempDeletion(target.tempFiles);
      }
      return null;
    } catch (e) {
      (this.deps.logWarn ?? (() => {}))(BOOK_SHARE_TAG, `shareBook failed: ${book.title}`, e);
      return e instanceof Error ? (e.message ?? '分享失败') : '分享失败';
    }
  }

  /** Android `scope.launch { delay(SHARE_TEMP_RETENTION_MS); tempFiles.forEach { delete } }`. */
  private scheduleTempDeletion(files: string[]): void {
    setTimeout(() => {
      for (const path of files) {
        void (async () => {
          try {
            if (await this.fs.exists(path)) await this.fs.delete(path);
          } catch {
            // best effort
          }
        })();
      }
    }, SHARE_TEMP_RETENTION_MS);
  }

  /** 定位分享目标：返回 (分享 URL, MIME)。 */
  private async resolveShareTarget(book: LibraryLocalBook): Promise<BookShareTarget> {
    const raw = book.filePath ?? '';

    // 1) SAF 导入的书：content://
    if (raw.startsWith('content://')) {
      const mime =
        (await this.deps.contentResolverGetType?.(raw).catch(() => null)) ??
        mimeForPath(raw, book);

      // 零拷贝格式（EPUB / 漫画归档）：原 URI 直接分享，系统授权给目标应用读取
      if (this.isZeroCopyFormat(raw, mime, book)) {
        return {
          objectUrl: raw,
          fileName: baseNameOf(raw),
          mime,
          tempFiles: [],
        };
      }
      // MOBI / PDF / AZW3 / FB2 / DJVU 等：把源文件字节原样复制到 share_temp
      // 再分享，保证微信/QQ 拿到的就是完整的原始文件（用完即焚缓存）
      return this.copyContentUriToTemp(raw, book, mime);
    }

    const path = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;

    // 2) 原文件还在：直接包装，零拷贝
    if (await this.deps.fileExists(path)) {
      return {
        objectUrl: await this.deps.share.fileObjectUrl(path, mimeForPath(raw, book)),
        fileName: baseNameOf(path),
        mime: mimeForPath(raw, book),
        tempFiles: [],
      };
    }

    // 3) 漫画：filePath 是解压目录（comics_xxx），原归档要么在下载任务里，要么重新打包
    // Kotlin gate is `File(path).isDirectory`, NOT a `comics_` name pattern.
    if ((await this.deps.dirExists?.(path)) === true) {
      return this.resolveComicArchive(book, path);
    }
    // 4) 原文件路径失效（被移动/清理）：从下载任务记录找回原始文件
    const taskFile = await this.findCompletedTaskFile(book);
    if (taskFile !== null) {
      return {
        objectUrl: await this.deps.share.fileObjectUrl(taskFile, mimeForPath(taskFile, book)),
        fileName: baseNameOf(taskFile),
        mime: mimeForPath(taskFile, book),
        tempFiles: [],
      };
    }

    // 5) TXT 下载后原文件已被清理：从数据库章节内容重建（用完即焚缓存）
    if (!bookIsComic(book) && (await this.hasTextChapters(book))) {
      return this.rebuildTxt(book);
    }

    throw new Error('源文件已不存在，无法分享（原文件可能已被移动或删除）');
  }

  /** 漫画：优先用下载任务里保留的原始归档；找不到则把解压页重新打包成 CBZ。 */
  private async resolveComicArchive(
    book: LibraryLocalBook,
    // Kotlin's `dir: File` is only used to read the unpacked page files; the TS port
    // reads them through the chapters table (same file list), so the arg is unused.
    _dir: string,
  ): Promise<BookShareTarget> {
    // 3a) 下载的漫画：DownloadTask 记录里保留着原始 cbz/zip/pdf 文件
    const archive = await this.findCompletedTaskFile(book);
    if (archive !== null) {
      return {
        objectUrl: await this.deps.share.fileObjectUrl(archive, mimeForPath(archive, book)),
        fileName: baseNameOf(archive),
        mime: mimeForPath(archive, book),
        tempFiles: [],
      };
    }

    // 3b) 本地导入的漫画：原归档没保留，把解压页重新打包成 CBZ（用完即焚缓存）
    const chapters = await this.chaptersSafely(book);
    const pages = chapters
      .map((ch) => ch.content)
      .filter((content) => content.trim() !== '')
      .filter((content) => baseNameOf(content) !== '');

    // Android BookShareHelper.kt:177 `if (pages.isEmpty()) throw IllegalStateException("漫画页面文件缺失，无法分享")`.
    // Kotlin computes the temp name only AFTER this guard, so the UUID is not burned on the
    // failure path — keep that order.
    if (pages.length === 0) throw new Error('漫画页面文件缺失，无法分享');
    if (this.deps.writeZip === undefined) throw new Error('漫画页面文件缺失，无法分享');
    const out = `${SHARE_TEMP_DIR}/${this.uuid}_${sanitizeFileName(book.title)}.cbz`;
    // `out.parentFile?.mkdirs()` — the platform `FileSystemApi.writeFile` creates the parent
    // directories (same seam `chapterCatalog.ts` documents). The empty pre-write mirrors
    // Kotlin's `ZipOutputStream(FileOutputStream(out))`, which truncates/creates the file
    // before the first `putNextEntry`.
    await this.fs.writeFile(out, new Uint8Array(0));
    await this.deps.writeZip(
      pages.map((content, index) => ({
        name: `${String(index).padStart(4, '0')}_${baseNameOf(content)}`,
        path: content,
      })),
      out,
    );
    return {
      objectUrl: await this.deps.share.fileObjectUrl(out, 'application/vnd.comicbook+zip'),
      fileName: baseNameOf(out),
      mime: 'application/vnd.comicbook+zip',
      tempFiles: [out],
    };
  }

  /** 从下载任务记录里找回这本书的原始文件（按书名 + 已完成 + 文件仍存在匹配）。 */
  private async findCompletedTaskFile(book: LibraryLocalBook): Promise<string | null> {
    const tasks = await this.downloadTasksSafely();
    const bookPath = stripFileScheme(book.filePath ?? '');
    for (const task of tasks) {
      const taskPath = stripFileScheme(task.filePath ?? '');
      const sameByOriginalId =
        book.sourceId != null &&
        task.sourceId === book.sourceId &&
        book.comicId != null &&
        book.comicId === this.deps.originalBookId(task.id, task.sourceId);
      if (
        task.status === 'COMPLETED' &&
        (taskPath === bookPath || sameByOriginalId) &&
        taskPath.trim() !== '' &&
        (await this.deps.fileExists(taskPath))
      ) {
        return taskPath;
      }
    }
    return null;
  }

  /** 零拷贝格式：EPUB 和漫画归档直接分享原 URI；其余二进制格式走临时副本。 */
  private isZeroCopyFormat(rawPath: string, mime: string, book: LibraryLocalBook): boolean {
    if (bookIsComic(book)) return true;
    const ext = extensionOf(rawPath);
    return (
      ext === 'epub' ||
      mime === 'application/epub+zip' ||
      ext === 'cbz' ||
      ext === 'zip' ||
      mime === 'application/vnd.comicbook+zip'
    );
  }

  /** content:// 源文件字节原样复制到 share_temp（用完即焚）。 */
  private async copyContentUriToTemp(
    uri: string,
    book: LibraryLocalBook,
    mime: string,
  ): Promise<BookShareTarget> {
    const ext = await this.resolveExtension(uri, book, mime);
    const out = `${SHARE_TEMP_DIR}/${this.uuid}_${sanitizeFileName(book.title)}.${ext}`;
    if (this.deps.openContentBytes === undefined) {
      throw new Error('无法读取源文件，可能已被移动或删除');
    }
    const bytes = await this.deps.openContentBytes(uri);
    await this.fs.writeFile(out, bytes);
    return {
      objectUrl: await this.deps.share.fileObjectUrl(out, mime),
      fileName: baseNameOf(out),
      mime,
      tempFiles: [out],
    };
  }

  private async resolveExtension(
    uri: string,
    book: LibraryLocalBook,
    mime: string,
  ): Promise<string> {
    // 1) 原文件显示名里的扩展名（最准确）
    const displayName = await this.deps.contentDisplayName?.(uri).catch(() => null);
    if (displayName !== null && displayName !== undefined) {
      const ext = extensionOf(displayName);
      // Kotlin `!ext.isNullOrBlank() && ext.length in 1..6`.
      if (ext.trim() !== '' && ext.length >= 1 && ext.length <= 6) return ext;
    }
    // 2) URI 路径里的扩展名
    const segment = this.deps.lastPathSegment?.(uri) ?? lastPathSegmentOf(uri);
    if (segment !== null) {
      const pathExt = extensionOf(segment);
      if (
        pathExt.trim() !== '' &&
        pathExt.length >= 1 &&
        pathExt.length <= 6 &&
        /^[\p{L}\p{Nd}]+$/u.test(pathExt)
      ) {
        return pathExt;
      }
    }
    // 3) MIME 反推
    switch (mime) {
      case 'application/pdf':
        return 'pdf';
      case 'application/x-mobipocket-ebook':
        return 'mobi';
      case 'application/epub+zip':
        return 'epub';
      case 'application/vnd.comicbook+zip':
        return 'cbz';
      case 'application/x-fictionbook+xml':
        return 'fb2';
      case 'text/plain':
        return 'txt';
      default: {
        const fromBook = extensionOf(book.filePath ?? '');
        return fromBook !== '' ? fromBook : 'file';
      }
    }
  }

  /** TXT 重建：把数据库章节内容按顺序写回文本文件。 */
  private async rebuildTxt(book: LibraryLocalBook): Promise<BookShareTarget> {
    const chapters = await this.chaptersSafely(book);
    if (chapters.length === 0) {
      throw new Error('书籍内容为空，无法分享');
    }
    let sb = '';
    for (const ch of chapters) {
      if (ch.title.trim() !== '') {
        sb += `${ch.title}\n\n`;
      }
      sb += ch.content;
      if (!ch.content.endsWith('\n')) sb += '\n';
      sb += '\n';
    }
    const out = `${SHARE_TEMP_DIR}/${this.uuid}_${sanitizeFileName(book.title)}.txt`;
    await this.fs.writeFile(out, new TextEncoder().encode(sb));
    return {
      objectUrl: await this.deps.share.fileObjectUrl(out, 'text/plain'),
      fileName: baseNameOf(out),
      mime: 'text/plain',
      tempFiles: [out],
    };
  }

  private async hasTextChapters(book: LibraryLocalBook): Promise<boolean> {
    const chapters = await this.chaptersSafely(book);
    // 漫画章节内容是图片路径；文本书章节内容才是正文
    return chapters.some((it) => it.content.length > 50);
  }

  private async chaptersSafely(
    book: LibraryLocalBook,
  ): Promise<Array<{ title: string; content: string }>> {
    try {
      return await this.deps.chaptersOfBook(book.id);
    } catch {
      return [];
    }
  }

  private async downloadTasksSafely(): Promise<DownloadTaskRow[]> {
    try {
      return await this.deps.downloadTasks();
    } catch {
      return [];
    }
  }
}

/* ── Free functions ported verbatim from BookShareHelper.kt ── */

/**
 * Kotlin `private fun mimeForPath(path, book): String` — the `book` parameter is
 * unused in the Kotlin body too, so it is kept for call-site parity and named `_book`.
 */
export function mimeForPath(path: string, _book?: LibraryLocalBook): string {
  const ext = extensionOf(path);
  switch (ext) {
    case 'epub':
      return 'application/epub+zip';
    case 'cbz':
      return 'application/vnd.comicbook+zip';
    case 'zip':
      return 'application/zip';
    case 'pdf':
      return 'application/pdf';
    case 'mobi':
    case 'prc':
      return 'application/x-mobipocket-ebook';
    case 'azw3':
    case 'azw':
    case 'kfx':
      return 'application/octet-stream';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    case 'txt':
      return 'text/plain';
    case 'djvu':
      return 'image/vnd.djvu';
    default:
      return 'application/octet-stream';
  }
}

/** Kotlin `private fun sanitizeFileName(name): String`. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return (cleaned === '' ? 'book' : cleaned).slice(0, 80);
}

/** Kotlin `val Book.isComic` — `Book.kt:43-44`: `contentType == "COMIC"`. */
function bookIsComic(book: LibraryLocalBook): boolean {
  return book.contentType === 'COMIC';
}

/**
 * Kotlin `path.substringAfterLast('.', "").lowercase()` (BookShareHelper.kt:211/243/249/261/298).
 *
 * The Kotlin call runs on the **whole** string, not on a directory-stripped base name, so
 * `"/books/v1.epub"` → `epub` but `"/a.b/noext"` → `"b/noext"`. Reducing to the base name
 * first would turn that into `""` and silently change `mimeForPath`, `isZeroCopyFormat` and
 * the `resolveExtension` MIME fallback.
 */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  return path.slice(dot + 1).toLowerCase();
}

/** Kotlin `File(path).name`. */
function baseNameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/').split('?')[0] ?? '';
  return normalized.split('/').pop() ?? normalized;
}

function stripFileScheme(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

/** Kotlin `uri.lastPathSegment?.substringAfterLast('.', "").lowercase()`. */
function lastPathSegmentOf(uri: string): string | null {
  const base = baseNameOf(uri);
  return base === '' ? null : base;
}

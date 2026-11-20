import { abortable } from './abortable';
import { shouldRetryZLibraryDownload } from '@core/source/zlibrary/zLibraryBookReference';
import { PUBLIC_NOVEL_SOURCE_IDS, zLibraryDownloadPageError } from '@core/source/sourceText';
import { DEFAULT_ACCEPT, DEFAULT_ACCEPT_LANG, DEFAULT_USER_AGENT } from '@core/source/zlibrary/network/zLibraryHttpClient';
import type { DownloadInfo } from '@core/source/downloadInfo';
import type { SourceResult } from '@core/source/sourceResult';
import { clearGuestNovelCheckpoint } from './guestNovelCheckpoint';
/**
 * Download worker — port of Android `DownloadWorker.kt`.
 *
 * Streaming download with Range/If-Range resume, .resume metadata, 416 restart,
 * HTML error detection, ixdzs8 TXT archive preprocessing, real-format validation
 * and novel import bookkeeping.
 *
 * Platform adaptations:
 * - WorkManager CoroutineWorker → async function + Semaphore(2) + 32-slot task locks.
 * - OkHttp streaming body → platform HttpClient returns the full body; the 64KB
 *   chunk loop, progress cadence (300ms UI / 2000ms DB) and validation order are
 *   preserved over that buffer.
 * - Foreground notification (getForegroundInfo) is Android UI — no core equivalent.
 * - zlibrary OkHttp client (encrypted cookies / DiamWall / ZLibraryDns) is injected
 *   as `zlibraryHttp` by the platform; `withResponse` picks it by sourceId.
 * - Cross-host header stripping is a network interceptor on OkHttp; the exact
 *   header list is ported as `stripSensitiveHeadersOnCrossHost` and applied to the
 *   request before it is sent when the platform client exposes the final URL path.
 */

import type {
  FileSystemApi,
  HttpClient,
  HttpRequest,
  HttpResponse,
  HttpStreamResponse,
  SecureStore,
} from '@platform/interfaces';
import type {
  DownloadTaskRecord,
  DownloadTaskState,
  DownloadTaskStore,
} from './downloadTaskRepository';
import {
  DownloadStatePending,
  downloadingState,
  errorState,
  pausedState,
  successState,
} from './downloadState';
import type { DownloadProgressBroadcaster } from './downloadProgressBroadcaster';
import type { NovelDownloadStore } from './novelDownloadStore';
import { prepareNovelTextArchive } from './novelTextArchive';
import { validateDownloadFile, validateFileIntegrity } from '../data/downloadFileValidator';
import { validateTail, validator as transferValidator } from '../data/downloadTransferPolicy';
import { isWholeBookNovelSource, WHOLE_BOOK_NOVEL_SOURCE_IDS, type SearchBook } from './downloadRequest';
import { originalBookId } from './downloadManager';

/**
 * Kotlin `DownloadWorker.doWork(): Result` 的三种终态 + `Result.retry()`。
 *
 * ⚠️ 端口的 retry 这一档此前不存在 —— 而 Kotlin L362 / L371 两处都返回 `Result.retry()`
 * （前台受限且尝试 < 5；网络暂时中断且尝试 < 5）。少了它，任何网络抖动都会被写成
 * `FAILED` 永久失败，而 Android 会由 WorkManager 按退避重排（见 E216）。
 *
 * `downloadManager.ts` 的 `runWorker(...)` 只 await 不消费返回值，所以扩这一档是安全的；
 * 真正的重排由平台任务层按 retry 决定。
 */
export type DownloadWorkerResult = 'success' | 'failure' | 'skipped' | 'retry';

/** Android downloads dir listing probe + bookshelf lookups. */
export interface BookshelfApi {
  getAllBooksSync(): Promise<
    Array<{ filePath: string | null; sourceId: string | null; comicId: string | null }>
  >;
  getBookBySourceResource(
    sourceId: string,
    bookId: string,
  ): Promise<{ filePath: string } | null>;
}

/** BookRepository import hooks used at download completion. */
export interface NovelBookImporter {
  importDownloadedNovel(filePath: string, book: SearchBook, replace: boolean): Promise<void>;
  importBookFromUri(
    filePath: string,
    fileName: string,
    sourceId: string,
    bookId: string,
  ): Promise<void>;
}

export interface BackgroundBookDownload {
  restorable(id: string): Promise<boolean>;
  discard(id: string): Promise<void>;
  consume<T>(id: string, sourceId: string, request: HttpRequest, progress: (written: number, total: number) => void,
    consumer: (response: HttpStreamResponse) => Promise<T>): Promise<{ value: T } | null>;
}

export interface DownloadWorkerDeps {
  http: HttpClient;
  /** Optional dedicated client for sourceId === 'zlibrary' (Android client vs publicClient). */
  zlibraryHttp?: HttpClient;
  background?: BackgroundBookDownload;
  networkConnected?: () => Promise<boolean>;
  resolveZLibraryChallenge?: (task: DownloadTaskRecord, referer: string, cookie: string | null, signal?: AbortSignal) => Promise<DownloadInfo | null>;
  recoverZLibraryDownload?: (task: DownloadTaskRecord, excluded: ReadonlySet<string>) => Promise<SourceResult<DownloadInfo>>;
  fs: FileSystemApi;
  secrets: SecureStore;
  dao: DownloadTaskStore;
  novels: NovelDownloadStore;
  broadcaster: DownloadProgressBroadcaster;
  books?: BookshelfApi;
  importer?: NovelBookImporter;
  downloadsDir: string;
  /** Monotonic ms — Android SystemClock.elapsedRealtime. */
  now?: () => number;
  /** AbortSignal replaces WorkManager cancellation (closes the in-flight request). */
  signal?: AbortSignal;
  /** Platform free-space probe — Android downloads.usableSpace. */
  getUsableSpace?: () => Promise<number> | number;
  /** Public chapter sources generate a complete EPUB into temp, without requesting the marker URL as a file. */
  generateBook?: (task: DownloadTaskRecord, temp: string, progress: (done: number, total: number) => Promise<void>, signal?: AbortSignal) => Promise<boolean>;
  /** Pre-upgrade inputData referer/cookie fields still present on old jobs. */
  legacyHeaders?: { referer?: string; cookie?: string };
  /**
   * Kotlin `CoroutineWorker.runAttemptCount` —— L358 `val retry = runAttemptCount < 5`、
   * L364-366 `runAttemptCount < 5` 与 `shouldRetryPublicNovel(..., runAttemptCount)`。
   * 平台任务层在每次重排时递增；缺省 0（= 第一次尝试）。
   */
  runAttemptCount?: number;
  /**
   * Kotlin L191-192 `(client.cookieJar as? EncryptedCookieJar)?.syncFromRawCookieString(cookie, host)`
   * —— 把原始 Cookie 串灌进加密 jar，后续 302 / 插图 / 恢复请求才会带上。
   *
   * 缺省 undefined（无 jar 的宿主）时跳过；Kotlin 的 `as?` 在 jar 不是加密实现时同样是 no-op。
   */
  cookieJar?: { syncFromRawCookieString(raw: string, domain: string): Promise<void> };
}

/* ------------------------------------------------------------------ */
/* Companion: Semaphore(2) + Array(32) task locks (DownloadWorker.kt) */
/* ------------------------------------------------------------------ */

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    return release;
  }

  async withLock<T>(block: () => Promise<T>): Promise<T> {
    const release = await this.lock();
    try {
      return await block();
    } finally {
      release();
    }
  }
}

function abortError(): Error {
  const err = new Error('download cancelled');
  err.name = 'AbortError';
  return err;
}

interface SlotWaiter {
  resolve(): void;
  detach(): void;
}

/**
 * kotlinx.coroutines.sync.Semaphore — `acquire()` is cancellable while a task is
 * queued for a slot, so pausing/cancelling a queued download must wake it up
 * instead of waiting for a free slot (parity with `slots.withPermit` + cancel).
 */
class Semaphore {
  private permits: number;
  private readonly waiters: SlotWaiter[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) throw abortError();
    if (this.permits > 0) {
      this.permits -= 1;
      return () => {
        this.release();
      };
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      const waiter: SlotWaiter = {
        resolve,
        detach: () => {
          signal?.removeEventListener('abort', onAbort);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
      // The signal may have aborted between the entry check and the listener.
      if (signal?.aborted === true) onAbort();
    });
    return () => {
      this.release();
    };
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next.detach();
      next.resolve();
    } else {
      this.permits += 1;
    }
  }

  async withPermit<T>(block: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await block();
    } finally {
      release();
    }
  }
}

const slots = new Semaphore(2);
const taskLocks: Mutex[] = Array.from({ length: 32 }, () => new Mutex());

/** Java String.hashCode — keeps lock-striping identical to Android. */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export async function withTaskLock<T>(taskId: string, block: () => Promise<T>): Promise<T> {
  const lock = taskLocks[(javaStringHashCode(taskId) & 0x7fffffff) % taskLocks.length] as Mutex;
  return lock.withLock(block);
}

/* ── DownloadWorker.kt L43-60 两个失败分类器（companion object 内） ──────────
 *
 * 这两个函数此前**一个都没有移植**，而 `ComicDownloadWorker.kt` L59-60 完全依赖它们：
 *   `status = if (DownloadWorker.foregroundStartRestricted(e)) PAUSED else FAILED`
 *   `error  = DownloadWorker.failureMessage(e)`；`message(DownloadWorker.failureMessage(e))`
 * 端口当时退化成 `e.message ?? '章节下载失败'`，并外加了 Kotlin 没有的「下载失败：」前缀。
 *
 * 逐行映射：
 *   L43-47 `foregroundStartRestricted(error)`   → `foregroundStartRestricted()`
 *   L49-53 `failureMessage(message: String)`    → `failureMessage(string)`
 *   L55-60 `failureMessage(error: Throwable)`   → `failureMessage(error)`
 * 两个重载在 TS 里合成一个函数，靠 `typeof value === 'string'` 分派（Kotlin 的重载解析，
 * 在这里等价于「传的是 String 还是 Throwable」）。
 */

/** L44 `generateSequence(error) { it.cause }.take(8)` —— 最多检查 8 层（含自身）。 */
export const FOREGROUND_RESTRICTED_CAUSE_DEPTH = 8;
/** L45 `it.javaClass.simpleName.contains("ForegroundServiceStartNotAllowed")` —— **区分大小写**。 */
export const FOREGROUND_RESTRICTED_CLASS = 'ForegroundServiceStartNotAllowed';
/** L46 `it.message.orEmpty().contains("startForegroundService() not allowed", true)` —— 忽略大小写。 */
export const FOREGROUND_RESTRICTED_MESSAGE = 'startForegroundService() not allowed';
/** L50 / L56 两条分支的文案。 */
export const FOREGROUND_RESTRICTED_FAILURE = '后台启动受限，请重试';
/** L51 / L57 `message.contains("ENOSPC", true)` 的文案。 */
export const STORAGE_FULL_FAILURE = '存储空间不足';
/** L58 `error is java.io.IOException` 的文案。 */
export const IO_INTERRUPTED_FAILURE = '连接中断，请重试';
/** L52 `?: "下载失败，请重试"` 的兜底。 */
export const DOWNLOAD_FAILED_FALLBACK = '下载失败，请重试';
/** L52 `.take(120)` —— 首行最多 120 个字符。 */
export const FAILURE_MESSAGE_MAX_CHARS = 120;

/** `javaClass.simpleName` 的替身：`error.name`，其次构造函数名。 */
function simpleNameOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const named = (value as { name?: unknown }).name;
    if (typeof named === 'string' && named !== '') return named;
    const ctor = (value as { constructor?: { name?: unknown } }).constructor;
    if (ctor !== undefined && typeof ctor.name === 'string') return ctor.name;
  }
  return '';
}

/** `Throwable.message.orEmpty()` —— 非字符串 message 一律当空串（Kotlin 的 `orEmpty()` 同理）。 */
function messageOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/** `Throwable.cause`（ES2022 `Error.cause`；非 Error 抛出物也接受 `cause` 字段）。 */
function causeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return null;
  return (value as { cause?: unknown }).cause ?? null;
}

/**
 * L43-47：
 * ```
 * generateSequence(error) { it.cause }.take(8).any {
 *     it.javaClass.simpleName.contains("ForegroundServiceStartNotAllowed") ||
 *         it.message.orEmpty().contains("startForegroundService() not allowed", true)
 * }
 * ```
 *
 * 为什么必须走 cause 链：Android 12+ 把「后台启动前台服务」的拒绝包成
 * `ForegroundServiceStartNotAllowedException`，而它通常被 OkHttp / WorkManager 再包一两层，
 * 顶层 message 是「包裹者的说法」。只看顶层会把它判成普通失败（FAILED，不重试），
 * 用户看到「下载失败」而实际只是被系统限流，重试就好。
 */
export function foregroundStartRestricted(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < FOREGROUND_RESTRICTED_CAUSE_DEPTH; depth += 1) {
    if (current === null || current === undefined) return false;
    if (simpleNameOf(current).includes(FOREGROUND_RESTRICTED_CLASS)) return true;
    if (messageOf(current).toLowerCase().includes(FOREGROUND_RESTRICTED_MESSAGE.toLowerCase())) return true;
    current = causeOf(current);
  }
  return false;
}

/**
 * L49-53 `failureMessage(message: String)`：
 * ```
 * message.contains("startForegroundService() not allowed",true) || message.contains("ForegroundServiceStartNotAllowed") -> "后台启动受限，请重试"
 * message.contains("ENOSPC",true) -> "存储空间不足"
 * else -> message.lineSequence().firstOrNull()?.take(120)?.ifBlank { null } ?: "下载失败，请重试"
 * ```
 *
 * 三处细节：**只取首行**（不是整段）、**最多 120 字符**、首行为空白时回落兜底串。
 */
export function failureMessageForText(message: string): string {
  if (
    message.toLowerCase().includes(FOREGROUND_RESTRICTED_MESSAGE.toLowerCase()) ||
    message.includes(FOREGROUND_RESTRICTED_CLASS)
  ) {
    return FOREGROUND_RESTRICTED_FAILURE;
  }
  if (message.toLowerCase().includes('enospc')) return STORAGE_FULL_FAILURE;
  const firstLine = message.split(/\r\n|\r|\n/)[0] ?? '';
  const capped = firstLine.slice(0, FAILURE_MESSAGE_MAX_CHARS);
  return capped.trim() !== '' ? capped : DOWNLOAD_FAILED_FALLBACK;
}

/**
 * `error is java.io.IOException` 的判据（平台差异，见 E214）。
 *
 * JS 没有 `IOException` 类型，所以退化成「错误自报 `name === 'IOException'`，或带
 * `ioError: true` 标记」。所有**会**在链路上抛网络中断的端口都该给错误打这个标记；
 * 不打标记的错误会落到 `failureMessage(error.message)` 那条分支（首行原文），
 * 而不是「连接中断，请重试」。
 */
export function isIoFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  if (simpleNameOf(error) === 'IOException') return true;
  return (error as { ioError?: unknown }).ioError === true;
}

/**
 * `java.io.IOException` 的构造替身（`name` + `ioError` 双标记，见 `isIoFailure`）。
 *
 * 为什么必须有类型替身：Kotlin 的 catch 用 `e is java.io.IOException` 分派「可重试」，
 * 而 `DownloadWorker.kt` 里有两处**故意**抛 IOException 来触发重试 ——
 * L204 抛 IOException（网络暂时不可用 HTTP n）与 L262 抛 EOFException（文件下载不完整，将尝试续传）。
 * 端口若抛普通 `Error`，这两处都会被判成永久失败。
 */
export function ioError(message: string): Error {
  const error = new Error(message);
  error.name = 'IOException';
  (error as { ioError?: boolean }).ioError = true;
  return error;
}

/** L262 `java.io.EOFException(...)` —— `IOException` 的子类，name 保留以区分文案来源。 */
export function eofError(message: string): Error {
  const error = ioError(message);
  error.name = 'EOFException';
  return error;
}

/**
 * L203 `setOf(408,429,500,502,503,504)` —— 这六码 Kotlin 抛 IOError（网络暂时不可用 HTTP n），
 * 于是下游走「网络暂时中断，将从已保存章节继续下载」+ `Result.retry()`。
 *
 * 端口此前把它们并进「下载失败（HTTP n）」的普通 Error 分支 → 直接 FAILED，
 * 一次 502 就让整本书永久失败。
 */
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** L193 `listOf("ncdn","cdn-zlib","s3proxy","dln")` —— 这四个 CDN 主机不吃会话 Cookie。 */
export const CDN_HOST_MARKERS = ['ncdn', 'cdn-zlib', 's3proxy', 'dln'] as const;

/** L358 / L365 的重试上限 5。 */
export const PUBLIC_NOVEL_RETRY_LIMIT = 5;
/** L65 `error is SourceException.NetworkError`。 */
export const NETWORK_ERROR_CLASS = 'NetworkError';

/**
 * L61-67 `shouldRetryPublicNovel(sourceId, error, attempt)`：
 *
 * ```kotlin
 * if (sourceId !in PublicNovelSources.ids || attempt >= 5) return false
 * if (error.message?.contains("ENOSPC", true) == true) return false
 * return error is java.io.IOException && error !is java.io.FileNotFoundException ||
 *     error is SourceException.NetworkError &&
 *     (error.cause is java.io.IOException || Regex("HTTP (?:408|429|5[0-9]{2})\\b").containsMatchIn(error.message.orEmpty()))
 * ```
 *
 * 三处只有读原文才会注意到的细节：
 * 1. 只对 `PublicNovelSources.ids`（quanben / ihuaben / sfacg / fanqie）生效，**不是** 9 个
 *    `WholeBookNovelSources` —— 后者含 auto_novel / ixdzs8 等逐章源，它们各有自己的重试路径；
 * 2. `error.message?.contains(...)` 用的是 `?.`：message 为 null 时**不**短路，继续往下判；
 * 3. `&&` 优先于 `||`：即「IOException 且非 FileNotFound」与
 *    「NetworkError 且有 IO cause 或 408/429/5xx」两条并列。
 */
export function shouldRetryPublicNovel(
  sourceId: string,
  error: unknown,
  attempt: number,
  isIo: (value: unknown) => boolean = isIoFailure,
): boolean {
  if (!PUBLIC_NOVEL_SOURCE_IDS.has(sourceId) || attempt >= PUBLIC_NOVEL_RETRY_LIMIT) return false;
  const message = messageOf(error);
  if (message.toLowerCase().includes('enospc')) return false;
  if (isIo(error) && simpleNameOf(error) !== 'FileNotFoundException') return true;
  if (simpleNameOf(error) !== NETWORK_ERROR_CLASS) return false;
  return isIo(causeOf(error)) || /HTTP (?:408|429|5[0-9]{2})\b/.test(message);
}

/**
 * L55-60 `failureMessage(error: Throwable)` —— 与 L49-53 的 `String` 重载同名的另一支：
 * ```
 * foregroundStartRestricted(error) -> "后台启动受限，请重试"
 * error.message.orEmpty().contains("ENOSPC", true) -> "存储空间不足"
 * error is java.io.IOException -> "连接中断，请重试"
 * else -> failureMessage(error.message.orEmpty())
 * ```
 * 顺序即语义：`IOException` 那条**先于**兜底，所以一个 message 为空的 `IOException`
 * 给的是「连接中断，请重试」而不是「下载失败，请重试」。
 */
export function failureMessageForError(error: unknown, isIo: (value: unknown) => boolean = isIoFailure): string {
  if (foregroundStartRestricted(error)) return FOREGROUND_RESTRICTED_FAILURE;
  if (messageOf(error).toLowerCase().includes('enospc')) return STORAGE_FULL_FAILURE;
  if (isIo(error)) return IO_INTERRUPTED_FAILURE;
  return failureMessageForText(messageOf(error));
}

/**
 * Kotlin 的两个同名重载合成一个入口：`failureMessage("文本")` / `failureMessage(error)`。
 * 传字符串走 L49-53，传其它走 L55-60。
 */
export function failureMessage(value: unknown, isIo: (value: unknown) => boolean = isIoFailure): string {
  return typeof value === 'string' ? failureMessageForText(value) : failureMessageForError(value, isIo);
}

/** Run a worker task under the companion task lock + download slot semaphore. */
export async function runDownloadWorker(
  taskId: string,
  deps: DownloadWorkerDeps,
): Promise<DownloadWorkerResult> {
  return withTaskLock(taskId, () => performDownloadTask(taskId, deps));
}

/* ------------------------------------------------------------------ */
/* File helpers over FileSystemApi (File/RandomAccessFile subset)     */
/* ------------------------------------------------------------------ */

export function nameWithoutExtension(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

/** Join a downloads directory and a file name with a single forward slash. */
export function joinPath(dir: string, name: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${d}/${name}`;
}

async function fileExists(fs: FileSystemApi, path: string): Promise<boolean> {
  try {
    return await fs.exists(path);
  } catch {
    return false;
  }
}

async function fileLength(fs: FileSystemApi, path: string): Promise<number> {
  try {
    if (!(await fs.exists(path))) return 0;
    return fs.size ? await fs.size(path) : (await fs.readFile(path)).length;
  } catch {
    return 0;
  }
}

async function deleteQuietly(fs: FileSystemApi, path: string): Promise<void> {
  try {
    if (await fs.exists(path)) {
      await fs.delete(path);
    }
  } catch {
    // best-effort
  }
}

async function renameFile(fs: FileSystemApi, from: string, to: string): Promise<void> {
  if (fs.move) { await fs.move(from, to); return; }
  const data = await fs.readFile(from);
  await fs.writeFile(to, data);
  await fs.delete(from);
}

interface ResumeMetadata {
  url?: string;
  validator?: string;
  total?: number;
  complete?: boolean;
}

async function readResume(fs: FileSystemApi, path: string): Promise<ResumeMetadata | null> {
  try {
    if (!(await fs.exists(path))) return null;
    const text = new TextDecoder().decode(await fs.readFile(path));
    return JSON.parse(text) as ResumeMetadata;
  } catch {
    return null;
  }
}

async function writeResume(
  fs: FileSystemApi,
  path: string,
  metadata: ResumeMetadata,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  if (fs.writeFileAtomic) await fs.writeFileAtomic(path, bytes); else await fs.writeFile(path, bytes);
}

/* ------------------------------------------------------------------ */
/* Request guards / HTML error detection (withResponse + isHtmlError)  */
/* ------------------------------------------------------------------ */

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Android network interceptor: strip credential headers when the next hop
 * changes host or scheme (redirect to another origin).
 */
export function stripSensitiveHeadersOnCrossHost(origin: string, request: HttpRequest): HttpRequest {
  const o = new URL(origin);
  const n = new URL(request.url);
  if (n.host === o.host && n.protocol === o.protocol) {
    return request;
  }
  const headers: Record<string, string> = { ...(request.headers ?? {}) };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower === 'proxy-authorization' ||
      lower === 'x-api-key'
    ) {
      delete headers[key];
    }
  }
  return { ...request, headers };
}

/**
 * Cancellation closes the active socket even during a blocking body read —
 * here the platform client request is awaited under the abort signal.
 */
export async function withResponse<T>(
  http: HttpClient,
  zlibraryHttp: HttpClient | undefined,
  request: HttpRequest,
  sourceId: string,
  block: (response: HttpResponse) => Promise<T>,
): Promise<T> {
  const origin = request.url;
  const client = sourceId === 'zlibrary' ? (zlibraryHttp ?? http) : http;
  const guarded = stripSensitiveHeadersOnCrossHost(origin, request);
  const response = await client.request(guarded);
  return block(response);
}

interface DownloadResponse extends HttpResponse { size: number; chunks: AsyncIterable<Uint8Array>; }
async function withDownloadResponse<T>(http: HttpClient, zlibraryHttp: HttpClient | undefined, request: HttpRequest, sourceId: string, block: (response: DownloadResponse) => Promise<T>, background?: { port: BackgroundBookDownload; id: string; progress: (written: number, total: number) => void }): Promise<T> {
  const client = sourceId === 'zlibrary' ? zlibraryHttp ?? http : http;
  const guarded = stripSensitiveHeadersOnCrossHost(request.url, request);
  const consume = async (response: HttpStreamResponse): Promise<T> => {
    const iterator = response.chunks[Symbol.asyncIterator]();
    /*
     * Kotlin 的 `peekBody(n)` 只是「看一眼」，流仍能完整读；等价做法是**预读到 n 字节为止并保留**，
     * 再把预读的块原样作为 chunks 的开头吐出去 —— 既不丢字节，也保证 body 覆盖前 n 字节
     * （不足 n 就是全部）。Kotlin L214 传的是 `peekBody(32 * 1024)`，端口此前只留 4096，
     * 而配额页的关键词可能落在 4 KiB 之后。
     */
    const buffered: Uint8Array[] = [];
    let bufferedLength = 0,
      exhausted = false;
    while (bufferedLength < RESPONSE_PEEK_BYTES && !exhausted) {
      const next = await iterator.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      buffered.push(next.value);
      bufferedLength += next.value.length;
    }
    const peek = new Uint8Array(Math.min(bufferedLength, RESPONSE_PEEK_BYTES));
    let cursor = 0;
    for (const part of buffered) {
      if (cursor >= peek.length) break;
      const take = Math.min(part.length, peek.length - cursor);
      peek.set(part.subarray(0, take), cursor);
      cursor += take;
    }
    async function* chunks() {
      for (const part of buffered) yield part;
      if (exhausted) return;
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        yield next.value;
      }
    }
    try {
      return await block({ status: response.status, headers: response.headers, url: response.url, size: response.size, body: peek, chunks: chunks() });
    } finally {
      await iterator.return?.();
    }
  };
  if (background) {
    const result = await background.port.consume(background.id, sourceId, guarded, background.progress, consume);
    if (result) return result.value;
  }
  if (client.consume) return client.consume(guarded, consume);
  const response = await client.request(guarded);
  async function* chunks() { yield response.body; }
  return consume({ ...response, size: response.body.length, chunks: chunks() });
}

/**
 * `withDownloadResponse` 的预读上限 —— Kotlin `response.peekBody(32 * 1024).string()`（L214）。
 *
 * `isHtmlError` 只需要前 4096（Kotlin `peekBody(4096)`），但配额页的关键词可能更靠后，
 * 所以统一预读 32 KiB 再由两处各取所需。
 */
export const RESPONSE_PEEK_BYTES = 32 * 1024;

/** Android DownloadWorker.isHtmlError — peekBody(4096) + Content-Type check. */
export function isHtmlError(response: HttpResponse, format: string): boolean {
  const sample = new TextDecoder()
    .decode(response.body.subarray(0, 4096))
    .replace(/^\s+/, '')
    .toLowerCase();
  const contentType = headerValue(response.headers, 'Content-Type') ?? '';
  const html =
    contentType.toLowerCase().includes('text/html') ||
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html');
  if (!html) return false;
  if (format !== 'txt') return true;
  // Literal HTML in a TXT book is valid; only known challenge/error markers reject it.
  return [
    'diamwall',
    'checking your browser',
    'verifying your browser',
    'daily limit',
    'page not found',
    'solve this captcha',
  ].some((it) => sample.includes(it));
}

function ensureActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* performTask (DownloadWorker.performTask)                            */
/* ------------------------------------------------------------------ */

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export async function performDownloadTask(
  taskId: string,
  deps: DownloadWorkerDeps,
  recovery: { count: number; excluded: ReadonlySet<string> } = { count: 0, excluded: new Set() },
): Promise<DownloadWorkerResult> {
  const { fs, dao, secrets, novels, broadcaster } = deps;
  const now = deps.now ?? (() => performance.now());
  const downloadsDir = deps.downloadsDir;

  const task = await dao.getTask(taskId);
  if (task == null) return 'failure';
  if (task.status === 'PAUSED' || task.status === 'CANCELLED') return 'skipped';

  const format = task.format.toLowerCase().trim();
  if (!/^[a-z0-9]{1,10}$/.test(format)) return 'failure';
  const finalFile = task.filePath;
  // File(task.filePath).canonicalFile.parentFile != downloads.canonicalFile → failure
  const parent = finalFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const downloadsNorm = downloadsDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (parent !== downloadsNorm) return 'failure';

  const temp = joinPath(downloadsDir, `${nameWithoutExtension(finalFile)}.tmp`);
  const resume = joinPath(downloadsDir, `${nameWithoutExtension(finalFile)}.resume`);
  let total = task.totalBytes;
  let generatedDone: number | undefined;
  let validatingRemote = false;

  try {
    const savedHeadersRaw = await secrets.get(`download:${taskId}`);
    const savedHeaders: Record<string, string> =
      savedHeadersRaw != null ? (JSON.parse(savedHeadersRaw) as Record<string, string>) : {};
    // Existing jobs may still contain the pre-upgrade header fields.
    const referer = deps.legacyHeaders?.referer;
    if (referer != null && referer.trim() !== '' && !('Referer' in savedHeaders)) {
      savedHeaders['Referer'] = referer;
    }
    const cookieLegacy = deps.legacyHeaders?.cookie;
    if (cookieLegacy != null && cookieLegacy.trim() !== '' && !('Cookie' in savedHeaders)) {
      savedHeaders['Cookie'] = cookieLegacy;
    }
    const requestHeaders = savedHeaders;
    // setForeground(getForegroundInfo()) — Android foreground notification, no core port.

    return await slots.withPermit(async (): Promise<DownloadWorkerResult> => {
      ensureActive(deps.signal);
      const tempLen = await fileLength(fs, temp);
      /*
       * Kotlin L133-134：
       *   if (task.sourceId in PublicNovelSources.ids) maxOf(temp.length(), task.downloadedBytes)
       *   else temp.length()
       * 公共小说源逐章抓取时 temp 是边写边拼的，重启后 temp 可能比数据库记录的少
       * （最后一章还没落盘），取 maxOf 才不会让进度条倒退。
       */
      const reportedLen = PUBLIC_NOVEL_SOURCE_IDS.has(task.sourceId)
        ? Math.max(tempLen, task.downloadedBytes)
        : tempLen;
      await dao.updateProgressAndStatus(taskId, 'DOWNLOADING', reportedLen, total, null);

      // Failed imports can be retried from the completed file without consuming another download.
      const metadata = await readResume(fs, resume);
      const finalExists = await fileExists(fs, finalFile);
      const completedLocal =
        finalExists && metadata != null && metadata.url === task.downloadUrl && metadata.complete === true;

      if (!completedLocal) {
        validatingRemote = true;
        const generated = await deps.generateBook?.(task, temp, async (done, count) => {
          ensureActive(deps.signal);
          generatedDone = done; total = count;
          broadcaster.updateState(taskId, downloadingState(done, count, count > 0 ? clamp01(done / count) : 0));
          await dao.updateProgressAndStatus(taskId, 'DOWNLOADING', done, count, null, undefined, count > 0 ? clamp01(done / count) : 0);
        }, deps.signal) ?? false;
        if (!generated) {
        let offset = tempLen > 0 ? tempLen : 0;
        const validator = metadata?.validator != null && metadata.validator !== '' ? metadata.validator : null;
        if (metadata?.url !== task.downloadUrl || validator == null) {
          offset = 0;
        }

        const zlibrary = task.sourceId === 'zlibrary';
        /*
         * Kotlin L177-183：
         *   .header("User-Agent", if (task.sourceId == "zlibrary")
         *       ZLibraryHttpClient.DEFAULT_USER_AGENT else "Mozilla/5.0 (Linux; Android) CialloReader/1.1")
         *   if (task.sourceId == "zlibrary") .header("Accept", DEFAULT_ACCEPT)
         *       .header("Accept-Language", DEFAULT_ACCEPT_LANG)
         *
         * 端口此前 UA 恒为 CialloReader、且没有 Accept / Accept-Language —— Z-Library 的下载网关
         * 对这三个头比对浏览器身份，缺了会被判成脚本请求直接返回验证页（E216）。
         */
        const baseHeaders: Record<string, string> = {
          'Accept-Encoding': 'identity',
          'User-Agent': zlibrary ? DEFAULT_USER_AGENT : 'Mozilla/5.0 (Linux; Android) CialloReader/1.1',
        };
        if (zlibrary) {
          baseHeaders['Accept'] = DEFAULT_ACCEPT;
          baseHeaders['Accept-Language'] = DEFAULT_ACCEPT_LANG;
        }
        for (const [key, value] of Object.entries(requestHeaders)) {
          const lower = key.toLowerCase();
          if (
            lower !== 'cookie' &&
            lower !== 'range' &&
            lower !== 'if-range' &&
            lower !== 'accept-encoding'
          ) {
            baseHeaders[key] = value;
          }
        }
        const host = new URL(task.downloadUrl).host;
        const cookie = headerValue(requestHeaders, 'Cookie');
        /*
         * Kotlin L187-193：
         *   val sessionHost = requestHeaders["Referer"]?.let { it.toHttpUrl().host }
         *   val allowSession = task.sourceId != "zlibrary" ||
         *       (sessionHost != null && (host == sessionHost || host.endsWith(".$sessionHost")))
         *   if (!cookie.isNullOrBlank() && allowSession && none { it in host }) builder.header("Cookie", cookie)
         *
         * 端口此前只有 `host === cookieHost` —— **没有子域放行**。Z-Library 的下载链常见
         * `z-lib.sk` → `downloads.z-lib.sk`（会话 Cookie 必须跟着走子域），端口会把
         * Cookie 丢掉，于是下载永远是未登录状态（E216）。
         */
        let sessionHost: string | null = null;
        if (zlibrary) {
          const entry = headerValue(requestHeaders, 'Referer');
          if (entry !== undefined) {
            try { sessionHost = new URL(entry).host; } catch { sessionHost = null; }
          }
        }
        const allowSession =
          !zlibrary || (sessionHost !== null && (host === sessionHost || host.endsWith(`.${sessionHost}`)));
        // Kotlin L191-192：只对 zlibrary + allowSession + 非空 Cookie 同步（且不要求非 CDN）
        if (zlibrary && allowSession && cookie != null && cookie.trim() !== '' && deps.cookieJar !== undefined) {
          await deps.cookieJar.syncFromRawCookieString(cookie, host);
        }
        if (
          cookie != null &&
          cookie.trim() !== '' &&
          allowSession &&
          !CDN_HOST_MARKERS.some((h) => host.includes(h))
        ) {
          baseHeaders['Cookie'] = cookie;
        }
        if (offset > 0 && validator != null) {
          baseHeaders['Range'] = `bytes=${offset}-`;
          baseHeaders['If-Range'] = validator;
        }

        let request: HttpRequest = { url: task.downloadUrl, method: 'GET', headers: baseHeaders, timeoutMs: 3_600_000, ...(deps.signal ? { signal: deps.signal } : {}) };
        let rangeRestarted = false;

        for (;;) {
          const restart = await withDownloadResponse(
            deps.http,
            deps.zlibraryHttp,
            request,
            task.sourceId,
            async (response) => {
              // A 416 is not proof of file completeness. Restart safely once.
              if (response.status === 416 && offset > 0 && !rangeRestarted) return true;
              /*
               * Kotlin L203-204：这六码抛 `java.io.IOException("网络暂时不可用（HTTP n）")`，
               * 下游因此走「网络暂时中断，将从已保存章节继续下载」+ `Result.retry()`。
               *
               * 注意 429 在集合里 —— 所以下面那条 `请求过于频繁，请稍后重试（HTTP 429）`
               * 在**原文里就是死代码**（L203 先于 L209 命中）。端口保持同一顺序，不为「修好」它而调换。
               */
              if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
                throw ioError(`网络暂时不可用（HTTP ${response.status}）`);
              }
              if (!(response.status >= 200 && response.status < 300)) {
                throw new Error(
                  response.status === 401 || response.status === 403
                    ? WHOLE_BOOK_NOVEL_SOURCE_IDS.has(task.sourceId)
                      ? `源站拒绝免登录下载，请稍后重试或换源（HTTP ${response.status}）`
                      : `下载授权已失效，请重新登录或重新获取链接（HTTP ${response.status}）`
                    : response.status === 429
                      ? '请求过于频繁，请稍后重试（HTTP 429）'
                      : `下载失败（HTTP ${response.status}）`,
                );
              }
              if (isHtmlError(response, format)) {
                /*
                 * Kotlin L212-216：
                 *   val quota = if (task.sourceId == "zlibrary")
                 *       zLibraryDownloadPageError(response.peekBody(32 * 1024).string()) else null
                 *   error(quota ?: "服务器返回了验证或错误页，下载链接可能已过期，请重新获取链接")
                 *
                 * `peekBody(n).string()` 用 UTF-8；端口由 `withDownloadResponse` 的 32 KiB 预读提供同一样本。
                 * 少了这一支，「今日下载额度已用尽」这类可行动的原因会被压成泛化的「链接可能已过期」。
                 */
                const quota =
                  task.sourceId === 'zlibrary' ? zLibraryDownloadPageError(new TextDecoder().decode(response.body)) : null;
                throw new Error(quota ?? '服务器返回了验证或错误页，下载链接可能已过期，请重新获取链接');
              }
              const bodyLength = response.size;
              const append = response.status === 206 && offset > 0;
              if (response.status === 206) {
                if (!append) {
                  throw new Error('服务器意外返回部分文件');
                }
                total = validateTail(headerValue(response.headers, 'Content-Range') ?? null, offset, bodyLength);
                const returned = transferValidator(
                  headerValue(response.headers, 'ETag') ?? null,
                  headerValue(response.headers, 'Last-Modified') ?? null,
                );
                if (returned !== null && returned !== validator) {
                  throw new Error('续传文件版本发生变化，请重新下载');
                }
                const previousTotal = metadata?.total ?? 0;
                if (!(previousTotal <= 0 || previousTotal === total)) {
                  throw new Error('续传文件大小发生变化');
                }
              } else {
                if (response.status !== 200) {
                  throw new Error('服务器未返回完整文件');
                }
                offset = 0;
                total = bodyLength;
              }
              if (deps.getUsableSpace !== undefined) {
                const usable = await deps.getUsableSpace();
                if (!(total <= 0 || usable >= total - offset + 16 * 1024 * 1024)) {
                  throw new Error('存储空间不足，请清理后重试');
                }
              }
              // Truncate before replacing metadata: a crash cannot pair an old prefix
              // with a new validator. (FileOutputStream(temp, append) runs first on Android;
              // metadata is written before any body byte reaches the temp file.)
              const nextValidator = transferValidator(
                headerValue(response.headers, 'ETag') ?? null,
                headerValue(response.headers, 'Last-Modified') ?? null,
              );
              // Native appends persist each chunk. Truncate before changing the
              // validator so interruption cannot pair an old prefix with new metadata.
              if (fs.appendFile && !append) await fs.writeFile(temp, new Uint8Array());
              await writeResume(fs, resume, {
                url: task.downloadUrl,
                validator: nextValidator ?? '',
                total,
                complete: false,
              });

              const existingTemp = append && !fs.appendFile ? await fs.readFile(temp) : new Uint8Array(0);
              let downloaded = offset;
              let lastUi = 0;
              let lastDb = 0;
              const parts: Uint8Array[] = [];
              if (append && existingTemp.length > 0) {
                parts.push(existingTemp);
              }
              for await (const body of response.chunks) {
                for (let i = 0; i < body.length; i += 64 * 1024) {
                  ensureActive(deps.signal);
                  const end = Math.min(i + 64 * 1024, body.length);
                  const slice = body.subarray(i, end);
                  if (downloaded + slice.length > total) throw new Error('下载数据超过声明长度');
                  if (fs.appendFile) await fs.appendFile(temp, slice); else parts.push(slice);
                  downloaded += slice.length;
                  ensureActive(deps.signal);
                  const nowMs = now();
                  if (nowMs - lastUi >= 300) {
                    lastUi = nowMs;
                    broadcaster.updateState(
                      taskId,
                      downloadingState(downloaded, total, total > 0 ? clamp01(downloaded / total) : 0),
                    );
                  }
                  if (nowMs - lastDb >= 2000) {
                    lastDb = nowMs;
                    await dao.updateProgressAndStatus(taskId, 'DOWNLOADING', downloaded, total, null);
                  }
                }
              }
              /*
               * Kotlin L262 `if(total>0 && downloaded!=total) throw java.io.EOFException("文件下载不完整，将尝试续传")`。
               *
               * 三处都必须照抄：
               * 1. **`total > 0` 前置** —— 服务器不给 `Content-Length` 时 `body.contentLength()` 是 -1，
               *    端口的 `downloaded !== total` 会**恒真**，于是任何分块响应都被判成「下载不完整」；
               * 2. `EOFException` 是 `IOException` 的子类（`eofError`），下游才会走重试而不是 FAILED；
               * 3. 文案是「将尝试续传」（对用户说明后续动作），不是「请恢复下载」。
               */
              if (total > 0 && downloaded !== total) {
                throw eofError('文件下载不完整，将尝试续传');
              }
              if (!fs.appendFile) {
                const merged = new Uint8Array(downloaded); let cursor = 0;
                for (const part of parts) { merged.set(part, cursor); cursor += part.length; }
                await fs.writeFile(temp, merged);
              }
              return false;
            },
            deps.background ? {
              port: deps.background, id: taskId,
              progress(written, expected) {
                const current = offset + written, full = expected > 0 ? offset + expected : 0;
                broadcaster.updateState(taskId, downloadingState(current, full, full > 0 ? clamp01(current / full) : 0));
              },
            } : undefined,
          );
          if (!restart) break;
          rangeRestarted = true;
          offset = 0;
          const nextHeaders: Record<string, string> = { ...(request.headers ?? {}) };
          delete nextHeaders['Range'];
          delete nextHeaders['If-Range'];
          request = { ...request, headers: nextHeaders };
        }

        if (task.sourceId === 'ixdzs8' && format === 'txt') {
          const textPath = await prepareNovelTextArchive(temp, {
            fs,
            now,
            signal: deps.signal,
            getUsableSpace: deps.getUsableSpace,
          });
          if (textPath == null) {
            throw new Error('网文源未返回 TXT 打包文件，请重试');
          }
          try {
            // The text bytes cannot resume against the archive's validator.
            await writeResume(fs, resume, { url: task.downloadUrl, complete: false });
            // check(temp.delete() && text.renameTo(temp)) { "无法保存小说文本" }
            if (await fileExists(fs, temp)) {
              await fs.delete(temp);
            }
            await renameFile(fs, textPath, temp);
          } finally {
            await deleteQuietly(fs, textPath);
          }
        }

        }
        ensureActive(deps.signal);
        const integrity = await checkFileIntegrity(fs, temp, format);
        if (!integrity.valid) {
          throw new Error(integrity.htmlErrorHint ?? '下载文件格式校验失败');
        }
        validatingRemote = false;
        const actualFormat = integrity.actualFormat ?? format;
        const actualFile = joinPath(
          downloadsDir,
          `${nameWithoutExtension(finalFile)}.${actualFormat}`,
        );
        // check(!actualFile.exists() || actualFile.delete()) { "无法替换旧下载文件" }
        if (await fileExists(fs, actualFile)) {
          await fs.delete(actualFile);
        }
        // check(temp.renameTo(actualFile)) { "无法保存下载文件" }
        await renameFile(fs, temp, actualFile);
        const actualLen = await fileLength(fs, actualFile);
        await dao.insertOrUpdate({
          ...task,
          status: 'DOWNLOADING',
          format: actualFormat,
          filePath: actualFile,
          downloadedBytes: actualLen,
          totalBytes: actualLen,
          progress: 1,
        });
        const completeMetadata = { ...((await readResume(fs, resume)) ?? {}), url: task.downloadUrl };
        await writeResume(fs, resume, { ...completeMetadata, complete: true });
      }

      const latestRow = await dao.getTask(taskId);
      if (latestRow == null) {
        throw new Error('下载任务已取消');
      }
      let latest: DownloadTaskRecord = latestRow;
      const file = latest.filePath;
      const finalIntegrity = await checkFileIntegrity(fs, file, latest.format);
      if (!finalIntegrity.valid) {
        throw new Error('下载文件损坏，请重新下载');
      }
      latest = { ...latest, format: finalIntegrity.actualFormat ?? latest.format };

      const pending = await novels.pending(taskId);
      const novel =
        pending != null &&
        isWholeBookNovelSource(task.sourceId) &&
        pending.book.sourceId === task.sourceId &&
        pending.book.id === originalBookId(task.id, task.sourceId)
          ? pending
          : null;

      const importer = deps.importer;
      const books = deps.books;
      if (novel != null) {
        const baseline = await novels.baseline(novel.book.sourceId, novel.book.id);
        const old = await books?.getBookBySourceResource(novel.book.sourceId, novel.book.id);
        const baselineInfo = baseline?.novelInfo;
        const newInfo = novel.book.novelInfo;
        if (
          novel.replace &&
          old != null &&
          baselineInfo != null &&
          novelInfoHas(baselineInfo) &&
          newInfo != null &&
          novelInfoHas(newInfo) &&
          novelInfoRev(baselineInfo) !== novelInfoRev(newInfo)
        ) {
          const oldPath = old.filePath.replace(/^file:\/\//, '');
          const oldFp = await fingerprint(fs, oldPath);
          const newFp = await fingerprint(fs, file);
          if (oldFp != null && newFp != null && bytesEqual(oldFp, newFp)) {
            throw new Error('源站整本下载包尚未更新，已保留本地版本；请稍后重试');
          }
        }
        if (importer != null) {
          await importer.importDownloadedNovel(
            file,
            { ...novel.book, format: latest.format },
            novel.replace,
          );
        }
      } else if (importer != null) {
        await importer.importBookFromUri(
          file,
          `${task.title}.${latest.format}`,
          task.sourceId,
          originalBookId(task.id, task.sourceId),
        );
      }

      // Once import commits, finish bookkeeping even if pause arrives at that
      // boundary (Android withContext(NonCancellable) — no ensureActive here).
      if (novel != null) {
        await novels.imported(taskId);
      }
      const doneLen = await fileLength(fs, file);
      await dao.insertOrUpdate({
        ...latest,
        status: 'COMPLETED',
        errorMessage: null,
        downloadedBytes: doneLen,
        totalBytes: doneLen,
        progress: 1,
      } as DownloadTaskRecord);
      await secrets.remove(`download:${taskId}`);
      if (generatedDone !== undefined) await clearGuestNovelCheckpoint(fs, temp).catch(() => {});
      broadcaster.updateState(taskId, successState(file));
      return 'success';
    }, deps.signal);
  } catch (e) {
    if (isAbortError(e)) {
      // Explicit cancel deleted the row; never recreate or rebroadcast it.
      const latest = await dao.getTask(taskId);
      if (latest != null && (latest.status === 'DOWNLOADING' || latest.status === 'PAUSED')) {
        const len = generatedDone ?? await fileLength(fs, temp);
        await dao.updateProgressAndStatus(taskId, 'PAUSED', len, total, null);
        broadcaster.updateState(taskId, pausedState(len, total));
      }
      throw e;
    }
    /*
     * Kotlin L355 `val message = failureMessage(e)` —— 四条分类（前台受限 / ENOSPC /
     * IOException / 首行截 120）。端口此前自造「存储空间不足，请清理后重试」，
     * 与 Android 的「存储空间不足」不一致（E214 遗留，本轮闭环）。
     */
    let message = failureMessage(e);
    const attempt = deps.runAttemptCount ?? 0;

    /*
     * Kotlin L356-363：前台受限 → 尝试 < 5 时 PENDING + retry，否则 PAUSED + failure。
     * `maxOf(temp.length(), latest.downloadedBytes)` 与 L360 逐字一致。
     */
    if (foregroundStartRestricted(e)) {
      const latestRow = await dao.getTask(taskId);
      if (latestRow == null) return 'skipped';
      const retry = attempt < PUBLIC_NOVEL_RETRY_LIMIT;
      const len = Math.max(await fileLength(fs, temp), latestRow.downloadedBytes);
      await dao.updateProgressAndStatus(taskId, retry ? 'PENDING' : 'PAUSED', len, total, message);
      broadcaster.updateState(taskId, retry ? DownloadStatePending : pausedState(latestRow.downloadedBytes, total));
      return retry ? 'retry' : 'failure';
    }

    /*
     * Kotlin L364-372：
     *   shouldRetryPublicNovel(...) ||
     *   (sourceId != "zlibrary" && runAttemptCount < 5 && e is IOException &&
     *       e !is FileNotFoundException && e.message?.contains("ENOSPC") != true)
     *   → PENDING + 「网络暂时中断，将从已保存章节继续下载」+ Result.retry()
     *
     * 端口此前**完全没有这一支**：任何 socket reset / 超时都直接 FAILED，
     * 而 Android 会重试 5 次（E216）。
     */
    if (
      shouldRetryPublicNovel(task.sourceId, e, attempt) ||
      (task.sourceId !== 'zlibrary' &&
        attempt < PUBLIC_NOVEL_RETRY_LIMIT &&
        isIoFailure(e) &&
        simpleNameOf(e) !== 'FileNotFoundException' &&
        !messageOf(e).toLowerCase().includes('enospc'))
    ) {
      const latestRow = await dao.getTask(taskId);
      if (latestRow == null) return 'skipped';
      const len = Math.max(await fileLength(fs, temp), latestRow.downloadedBytes);
      await dao.updateProgressAndStatus(taskId, 'PENDING', len, total, '网络暂时中断，将从已保存章节继续下载');
      broadcaster.updateState(taskId, DownloadStatePending);
      return 'retry';
    }
    if (validatingRemote && deps.networkConnected && !await deps.networkConnected().catch(() => true)) {
      const latest = await dao.getTask(taskId);
      if (latest && latest.status !== 'PAUSED' && latest.status !== 'CANCELLED') {
        const length = generatedDone ?? await fileLength(fs, temp);
        await dao.updateProgressAndStatus(taskId, 'PENDING', length, total, null);
        broadcaster.updateState(taskId, DownloadStatePending);
      }
      return 'skipped';
    }
    if (validatingRemote && task.sourceId === 'zlibrary' && recovery.count < 2 &&
      deps.recoverZLibraryDownload && shouldRetryZLibraryDownload(message) && !deps.signal?.aborted) {
      const excluded = new Set(recovery.excluded);
      let referer: string | undefined, cookie: string | undefined;
      try {
        const stored = JSON.parse(await secrets.get(`download:${taskId}`) ?? '{}') as Record<string, string>;
        referer = headerValue(stored, 'Referer'); cookie = headerValue(stored, 'Cookie');
      } catch { /* An old job may have no usable header record. */ }
      try { excluded.add(new URL(referer || task.downloadUrl).hostname.toLowerCase()); } catch { /* No valid previous host. */ }
      broadcaster.updateState(taskId, DownloadStatePending);
      try {
        let fromBrowser: DownloadInfo | null = null;
        if (recovery.count === 0 && referer && deps.resolveZLibraryChallenge && /验证或错误页|服务器未返回完整文件|HTTP 403/i.test(message)) {
          fromBrowser = await abortable(deps.resolveZLibraryChallenge(task, referer, cookie ?? null, deps.signal), deps.signal);
        }
        const result = fromBrowser ? { kind: 'success' as const, data: fromBrowser }
          : await abortable(deps.recoverZLibraryDownload(task, excluded), deps.signal);
        ensureActive(deps.signal);
        if (result.kind === 'success') {
          const latest = await dao.getTask(taskId);
          if (!latest) return 'skipped';
          const next = { ...result.data.headers, ...(result.data.referer ? { Referer: result.data.referer } : {}) };
          const raw = JSON.stringify(next);
          if (raw.length > 32 * 1024) throw new Error('下载请求头过大');
          if (Object.keys(next).length) await secrets.set(`download:${taskId}`, raw);
          else await secrets.remove(`download:${taskId}`);
          await dao.insertOrUpdate({ ...latest, downloadUrl: result.data.url, status: 'PENDING',
            downloadedBytes: 0, totalBytes: 0, errorMessage: null, progress: 0 });
          return performDownloadTask(taskId, deps, { count: recovery.count + 1, excluded: fromBrowser ? recovery.excluded : excluded });
        }
        if (result.exception.message) message += '；' + result.exception.message;
      } catch (error) {
        if (isAbortError(error) || deps.signal?.aborted) {
          const length = await fileLength(fs, temp);
          await dao.updateProgressAndStatus(taskId, 'PAUSED', length, total, null);
          broadcaster.updateState(taskId, pausedState(length, total));
          throw abortError();
        }
        if (error instanceof Error && error.message) message += '；' + error.message;
      }
    }
    if ((await dao.getTask(taskId)) != null) {
      const len = await fileLength(fs, temp);
      await dao.updateProgressAndStatus(taskId, 'FAILED', len, total, message);
      broadcaster.updateState(taskId, errorState(message));
    }
    return 'failure';
  }
}

function novelInfoHas(info: NonNullable<SearchBook['novelInfo']>): boolean {
  return (
    (info.updatedAt != null && info.updatedAt.trim() !== '') ||
    (info.latestChapter != null && info.latestChapter.trim() !== '') ||
    info.chapterCount != null ||
    info.volumeCount != null
  );
}

function novelInfoRev(info: NonNullable<SearchBook['novelInfo']>): string {
  return [
    info.updatedAt ?? '',
    info.latestChapter ?? '',
    info.chapterCount != null ? String(info.chapterCount) : '',
    info.volumeCount != null ? String(info.volumeCount) : '',
  ].join('|');
}

async function checkFileIntegrity(fs: FileSystemApi, path: string, format: string) {
  if (fs.readRange && fs.size) return validateDownloadFile({ size: await fs.size(path), read: (offset, length) => fs.readRange!(path, offset, length) }, format);
  return validateFileIntegrity(await fs.readFile(path), format);
}

async function fingerprint(fs: FileSystemApi, path: string): Promise<Uint8Array | null> {
  try {
    if (!(await fs.exists(path))) return null;
    return fs.sha256 ? await fs.sha256(path) : await sha256(await fs.readFile(path));
  } catch {
    return null;
  }
}

export type { DownloadTaskState };

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
  SecureStore,
} from '@platform/interfaces';
import type {
  DownloadTaskRecord,
  DownloadTaskState,
  DownloadTaskStore,
} from './downloadTaskRepository';
import {
  downloadingState,
  errorState,
  pausedState,
  successState,
} from './downloadState';
import type { DownloadProgressBroadcaster } from './downloadProgressBroadcaster';
import type { NovelDownloadStore } from './novelDownloadStore';
import { prepareNovelTextArchive } from './novelTextArchive';
import { validateFileIntegrity } from '../data/downloadFileValidator';
import { validateTail, validator as transferValidator } from '../data/downloadTransferPolicy';
import { isWholeBookNovelSource, type SearchBook } from './downloadRequest';
import { originalBookId } from './downloadManager';

export type DownloadWorkerResult = 'success' | 'failure' | 'skipped';

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

export interface DownloadWorkerDeps {
  http: HttpClient;
  /** Optional dedicated client for sourceId === 'zlibrary' (Android client vs publicClient). */
  zlibraryHttp?: HttpClient;
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
    return (await fs.readFile(path)).length;
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
  const data = await fs.readFile(from);
  await fs.writeFile(to, data);
  await fs.delete(from);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
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
  await fs.writeFile(path, new TextEncoder().encode(JSON.stringify(metadata)));
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
  return e instanceof Error && e.name === 'AbortError';
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
      await dao.updateProgressAndStatus(taskId, 'DOWNLOADING', tempLen, total, null);

      // Failed imports can be retried from the completed file without consuming another download.
      const metadata = await readResume(fs, resume);
      const finalExists = await fileExists(fs, finalFile);
      const completedLocal =
        finalExists && metadata != null && metadata.url === task.downloadUrl && metadata.complete === true;

      if (!completedLocal) {
        const generated = await deps.generateBook?.(task, temp, async (done, count) => {
          ensureActive(deps.signal);
          broadcaster.updateState(taskId, downloadingState(done, count, count > 0 ? clamp01(done / count) : 0));
          await dao.updateProgressAndStatus(taskId, 'DOWNLOADING', done, count, null);
        }, deps.signal) ?? false;
        if (!generated) {
        let offset = tempLen > 0 ? tempLen : 0;
        const validator = metadata?.validator != null && metadata.validator !== '' ? metadata.validator : null;
        if (metadata?.url !== task.downloadUrl || validator == null) {
          offset = 0;
        }

        const baseHeaders: Record<string, string> = {
          'Accept-Encoding': 'identity',
          'User-Agent': 'Mozilla/5.0 (Linux; Android) CialloReader/1.1',
        };
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
        if (
          cookie != null &&
          cookie.trim() !== '' &&
          !['ncdn', 'cdn-zlib', 's3proxy', 'dln'].some((h) => host.includes(h))
        ) {
          baseHeaders['Cookie'] = cookie;
        }
        if (offset > 0 && validator != null) {
          baseHeaders['Range'] = `bytes=${offset}-`;
          baseHeaders['If-Range'] = validator;
        }

        let request: HttpRequest = { url: task.downloadUrl, method: 'GET', headers: baseHeaders };
        let rangeRestarted = false;

        for (;;) {
          const restart = await withResponse(
            deps.http,
            deps.zlibraryHttp,
            request,
            task.sourceId,
            async (response) => {
              // A 416 is not proof of file completeness. Restart safely once.
              if (response.status === 416 && offset > 0 && !rangeRestarted) return true;
              if (!(response.status >= 200 && response.status < 300)) {
                throw new Error(
                  response.status === 401 || response.status === 403
                    ? `下载授权已失效，请重新登录或重新获取链接（HTTP ${response.status}）`
                    : response.status === 429
                      ? '请求过于频繁，请稍后重试（HTTP 429）'
                      : `下载失败（HTTP ${response.status}）`,
                );
              }
              if (isHtmlError(response, format)) {
                throw new Error('服务器返回了验证或错误页，下载链接可能已过期，请重新获取链接');
              }
              const body = response.body;
              const append = response.status === 206 && offset > 0;
              if (response.status === 206) {
                if (!append) {
                  throw new Error('服务器意外返回部分文件');
                }
                total = validateTail(headerValue(response.headers, 'Content-Range') ?? null, offset, body.length);
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
                total = body.length;
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
              await writeResume(fs, resume, {
                url: task.downloadUrl,
                validator: nextValidator ?? '',
                total,
                complete: false,
              });

              const existingTemp = append ? await fs.readFile(temp) : new Uint8Array(0);
              let downloaded = offset;
              let lastUi = 0;
              let lastDb = 0;
              const parts: Uint8Array[] = [];
              if (append && existingTemp.length > 0) {
                parts.push(existingTemp);
              }
              for (let i = 0; i < body.length; i += 64 * 1024) {
                ensureActive(deps.signal);
                const end = Math.min(i + 64 * 1024, body.length);
                const slice = body.subarray(i, end);
                parts.push(slice);
                downloaded += slice.length;
                if (!(total <= 0 || downloaded <= total)) {
                  throw new Error('下载数据超过声明长度');
                }
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
              if (!(total <= 0 || downloaded === total)) {
                throw new Error('文件下载不完整，请恢复下载');
              }
              let merged: Uint8Array = new Uint8Array(0);
              for (const p of parts) merged = concatBytes(merged, p);
              await fs.writeFile(temp, merged);
              return false;
            },
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
            const textBytes = await fs.readFile(textPath);
            await fs.writeFile(temp, textBytes);
            await fs.delete(textPath);
          } finally {
            await deleteQuietly(fs, textPath);
          }
        }

        }
        ensureActive(deps.signal);
        const integrity = validateFileIntegrity(await fs.readFile(temp), format);
        if (!integrity.valid) {
          throw new Error(integrity.htmlErrorHint ?? '下载文件格式校验失败');
        }
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
      const finalIntegrity = validateFileIntegrity(await fs.readFile(file), latest.format);
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
      } as DownloadTaskRecord);
      await secrets.remove(`download:${taskId}`);
      broadcaster.updateState(taskId, successState(file));
      return 'success';
    }, deps.signal);
  } catch (e) {
    if (isAbortError(e)) {
      // Explicit cancel deleted the row; never recreate or rebroadcast it.
      const latest = await dao.getTask(taskId);
      if (latest != null && (latest.status === 'DOWNLOADING' || latest.status === 'PAUSED')) {
        const len = await fileLength(fs, temp);
        await dao.updateProgressAndStatus(taskId, 'PAUSED', len, total, null);
        broadcaster.updateState(taskId, pausedState(len, total));
      }
      throw e;
    }
    const rawMessage = e instanceof Error ? e.message : undefined;
    const message =
      rawMessage != null && rawMessage.toUpperCase().includes('ENOSPC')
        ? '存储空间不足，请清理后重试'
        : (rawMessage ?? '下载或入库失败');
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

async function fingerprint(fs: FileSystemApi, path: string): Promise<Uint8Array | null> {
  try {
    if (!(await fs.exists(path))) return null;
    return await sha256(await fs.readFile(path));
  } catch {
    return null;
  }
}

export type { DownloadTaskState };

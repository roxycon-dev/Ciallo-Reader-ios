/**
 * Download manager — line-by-line port of Android `download/DownloadManager.kt`.
 *
 * Owns the control lock, the task-id helpers, the startup restore pass and the
 * enqueue / pause / resume / cancel flows around the download worker.
 *
 * Platform adaptations (rule: WorkManager → async queue / Promise):
 * - `WorkManager.enqueueUniqueWork("download_<id>", REPLACE)` → an AbortController
 *   per running task (`activeRuns`); re-enqueue aborts the previous run first.
 * - `WorkManager.cancelUniqueWork(...)` → `stopRun()` (abort + await settle).
 * - Unfinished `WorkInfo` probe during restore → `activeRuns.has(task.id)`.
 * - `CoroutineScope(SupervisorJob + Dispatchers.IO)` → plain `async` methods;
 *   the fire-and-forget `init { restoreTasks() }` becomes a stored promise that
 *   `whenRestored()` can await.
 * - `MessageDigest SHA-256` in `sanitizeFileName` is async on this platform
 *   (`crypto.subtle`), which is fine because every caller is already async.
 * - `NotificationCompat` / foreground service info are Android UI, not ported.
 * - Kotlin `e is CancellationException` → AbortError (worker cancellation).
 *
 * Relationship to the pre-existing `downloadQueue.ts`: that file is the generic
 * UI-facing queue (own in-memory bodies + events, already wired into
 * DownloadManagerPage), while this module is the Android `DownloadManager`
 * parity facade that drives `downloadWorker` the way WorkManager drove
 * `DownloadWorker` (dedupe, shelf checks, task ids, header secrets).
 *
 * Lock order matches Android: control lock (`withControlLock`) -> worker task
 * lock (`withTaskLock`) -> content gate -> storage write.
 */

import type { FileSystemApi, HttpClient, SecureStore } from '@platform/interfaces';
import { AsyncMutex } from '../data/contentMutationGate';
import type { DownloadTaskRecord, DownloadTaskStore } from './downloadTaskRepository';
import {
  downloadProgressBroadcaster,
  type DownloadProgressBroadcaster,
} from './downloadProgressBroadcaster';
import {
  DownloadStatePending,
  downloadingState,
  errorState,
  pausedState,
  progressRatio,
  successState,
  type DownloadState,
} from './downloadState';
import { isWholeBookNovelSource, type DownloadRequest } from './downloadRequest';
import type { NovelDownloadStore } from './novelDownloadStore';
import {
  joinPath,
  nameWithoutExtension,
  runDownloadWorker,
  withTaskLock,
  type BookshelfApi,
  type DownloadWorkerDeps,
  type DownloadWorkerResult,
} from './downloadWorker';

/* ------------------------------------------------------------------ */
/* Companion object (DownloadManager.kt companion { ... })             */
/* ------------------------------------------------------------------ */

/** Shared control lock — Android `companion object { private val taskMutex = Mutex() }`. */
const taskMutex = new AsyncMutex();

/**
 * Android `internal suspend fun <T> withControlLock(block): T` —
 * every public control method runs under this lock.
 */
export async function withControlLock<T>(block: () => Promise<T>): Promise<T> {
  return taskMutex.withLock(block);
}

/**
 * Book ids contain slashes/Chinese (e.g. book/xxx/三体.html); sanitize for file paths.
 * Truncate to stay under filesystem filename limits (255 bytes) — long titles
 * like 球状闪电（…超长营销文案…） produce ENAMETOOLONG otherwise.
 *
 * `MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).take(12)` →
 * first 12 digest bytes as lowercase hex (24 chars). `id.toByteArray()` is UTF-8.
 */
export async function sanitizeFileName(id: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)),
  );
  const hash = Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  // Kotlin Regex.replace substitutes every match; take(40) is UTF-16 code units, same as JS.
  return `${id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)}_${hash}`;
}

/** Android `taskId(sourceId, bookId) = "v2:${sourceId.length}:$sourceId$bookId"`. */
export function taskId(sourceId: string, bookId: string): string {
  return `v2:${sourceId.length}:${sourceId}${bookId}`;
}

/** Android `taskId.removePrefix(...)` — returns the input untouched when not prefixed. */
export function originalBookId(taskIdValue: string, sourceId: string): string {
  const prefix = `v2:${sourceId.length}:${sourceId}`;
  return taskIdValue.startsWith(prefix) ? taskIdValue.slice(prefix.length) : taskIdValue;
}

let nanoSeq = 0;

/**
 * `System.nanoTime()` stand-in used for `${sanitizeFileName(id)}_${nanoTime()}.<fmt>`
 * replacement files. Monotonic ms clock in nanoseconds plus a per-process sequence
 * so two enqueues inside the same tick never collide.
 */
function nanoTime(): number {
  nanoSeq += 1;
  if (nanoSeq > 1_000_000) nanoSeq = 1;
  return Math.round(performance.now() * 1_000_000) + nanoSeq;
}

function errorMessage(e: unknown): string | null {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return null;
}

/** Android `e is kotlinx.coroutines.CancellationException` (worker pause/cancel aborts). */
function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function deleteQuietly(fs: FileSystemApi, path: string): Promise<void> {
  try {
    if (await fs.exists(path)) {
      await fs.delete(path);
    }
  } catch {
    // Android `runCatching { File.delete() }` — best effort.
  }
}

/** `File(File(path).parentFile, "${nameWithoutExtension}$suffix")` */
function siblingPath(path: string, suffix: string): string {
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  const dir = idx >= 0 ? norm.slice(0, idx) : '.';
  return joinPath(dir, `${nameWithoutExtension(path)}${suffix}`);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Worker dependencies the manager does not own: the platform supplies HTTP
 * client(s), importer, clocks, free-space probe and legacy header fields.
 * Everything else (`dao`/`novels`/`broadcaster`/`secrets`/`fs`/`downloadsDir`/
 * `books`/`signal`) is wired by the manager itself.
 */
export type DownloadWorkerConfig = Omit<
  DownloadWorkerDeps,
  'http' | 'dao' | 'novels' | 'broadcaster' | 'secrets' | 'signal' | 'fs' | 'downloadsDir' | 'books'
>;

export interface DownloadManagerOptions {
  http: HttpClient;
  fs: FileSystemApi;
  /** Per-download header blob store — Android `EncryptedSecretStore` (`download:<taskId>`). */
  secrets: SecureStore;
  /** Whole-book novel pending/baseline store (SharedPreferences port). */
  novels: NovelDownloadStore;
  /** Android `File(context.filesDir, "downloads")`. */
  downloadsDir: string;
  dao: DownloadTaskStore;
  /** Android `db.bookDao()` — bookshelf lookups for restore and duplicate detection. */
  books: BookshelfApi;
  /** Defaults to the shared `downloadProgressBroadcaster` singleton. */
  broadcaster?: DownloadProgressBroadcaster;
  worker?: DownloadWorkerConfig;
  /** Test seam; defaults to `runDownloadWorker`. */
  runWorker?: (taskId: string, deps: DownloadWorkerDeps) => Promise<DownloadWorkerResult>;
  /** Android `Log.i(TAG, ...)` sink. */
  log?: (message: string) => void;
}

interface ActiveRun {
  controller: AbortController;
  /** Never rejects: rejections are folded into the log line below. */
  promise: Promise<void>;
}

/* ------------------------------------------------------------------ */
/* DownloadManager                                                     */
/* ------------------------------------------------------------------ */

export class DownloadManager {
  private readonly dao: DownloadTaskStore;
  private readonly fs: FileSystemApi;
  private readonly secrets: SecureStore;
  private readonly novels: NovelDownloadStore;
  private readonly downloadsDir: string;
  private readonly books: BookshelfApi;
  private readonly broadcaster: DownloadProgressBroadcaster;
  private readonly http: HttpClient;
  private readonly workerConfig: DownloadWorkerConfig;
  private readonly runWorker: (taskId: string, deps: DownloadWorkerDeps) => Promise<DownloadWorkerResult>;
  private readonly log: (message: string) => void;

  /** Unique-work registry — Android WorkManager work infos keyed by `download_<id>`. */
  private readonly activeRuns = new Map<string, ActiveRun>();

  private readonly restored: Promise<void>;

  constructor(options: DownloadManagerOptions) {
    this.dao = options.dao;
    this.fs = options.fs;
    this.secrets = options.secrets;
    this.novels = options.novels;
    this.downloadsDir = options.downloadsDir;
    this.books = options.books;
    this.broadcaster = options.broadcaster ?? downloadProgressBroadcaster;
    this.http = options.http;
    this.workerConfig = options.worker ?? {};
    this.runWorker = options.runWorker ?? runDownloadWorker;
    this.log = options.log ?? ((): void => {});
    // Android `init { restoreTasks() }` — scope.launch { ... } fire and forget.
    this.restored = this.restoreTasks().catch((e: unknown) => {
      this.log(`restoreTasks failed: ${errorMessage(e) ?? 'unknown'}`);
    });
  }

  /** Await the `init { restoreTasks() }` pass started by the constructor. */
  whenRestored(): Promise<void> {
    return this.restored;
  }

  /** Android `val allTasksFlow: Flow<List<DownloadTaskEntity>>` = `taskDao.getAllTasksFlow()`. */
  getAllTasks(): Promise<DownloadTaskRecord[]> {
    return this.dao.getAllTasks();
  }

  /** Android `val downloadStates: StateFlow<Map<String, DownloadState>>` — current snapshot. */
  get downloadStates(): ReadonlyMap<string, DownloadState> {
    return this.broadcaster.states;
  }

  /**
   * Restore broadcast state from persisted rows (Android `private fun restoreTasks()`).
   *
   * - PENDING/DOWNLOADING without a live run → PAUSED (interrupted work),
   * - PAUSED → re-broadcast Paused,
   * - COMPLETED → Success only while the book is still on the shelf; otherwise the
   *   row is dropped so the book can be downloaded again.
   */
  async restoreTasks(): Promise<void> {
    await taskMutex.withLock(async () => {
      const unfinished = await this.dao.getAllTasks();
      this.log(`Restoring unfinished tasks from DB. Count=${unfinished.length}`);
      for (const task of unfinished) {
        if (task.status === 'PENDING' || task.status === 'DOWNLOADING') {
          // Android: getWorkInfosForUniqueWork("download_${task.id}") → unfinished work ⇒ skip.
          if (this.activeRuns.has(task.id)) continue;
          this.log(`Restoring interrupted DOWNLOADING task to PAUSED: bookId=${task.id}`);
          await this.dao.updateProgressAndStatus(
            task.id,
            'PAUSED',
            task.downloadedBytes,
            task.totalBytes,
            null,
          );
          this.broadcaster.updateState(
            task.id,
            pausedState(task.downloadedBytes, task.totalBytes),
          );
        } else if (task.status === 'PAUSED') {
          this.log(`Restoring PAUSED task state in broadcaster: bookId=${task.id}`);
          this.broadcaster.updateState(
            task.id,
            pausedState(task.downloadedBytes, task.totalBytes),
          );
        } else if (task.status === 'COMPLETED') {
          // 书已不在书架的残留任务不能广播 Success，否则书库搜索
          // 会一直显示「已存入书架」且无法重新下载；清掉任务行即可恢复下载。
          if (await this.bookExistsForTask(task)) {
            this.log(`Restoring COMPLETED task state in broadcaster: bookId=${task.id}`);
            // Android `File(task.filePath).absolutePath` — platform paths are absolute.
            this.broadcaster.updateState(task.id, successState(task.filePath));
          } else {
            this.log(`Dropping stale COMPLETED task (book removed from shelf): bookId=${task.id}`);
            await this.dao.deleteTask(task.id);
          }
        }
      }
    });
  }

  /** Is the finished book still on the shelf (path match, `file://` prefix normalized)? */
  private async bookExistsForTask(task: DownloadTaskRecord): Promise<boolean> {
    try {
      const books = await this.books.getAllBooksSync();
      return books.some(
        (book) =>
          (book.filePath ?? '').replace(/^file:\/\//, '') === task.filePath ||
          (isWholeBookNovelSource(task.sourceId) &&
            book.sourceId === task.sourceId &&
            book.comicId === originalBookId(task.id, task.sourceId)),
      );
    } catch {
      return false; // runCatching { ... }.getOrDefault(false)
    }
  }

  /** Map the canonical `v2:…` id onto a legacy row id when one exists. */
  private async resolveTaskId(id: string): Promise<string> {
    if ((await this.dao.getTask(id)) != null) return id;
    const tasks = await this.dao.getAllTasks();
    const legacy = tasks.find(
      (task) => taskId(task.sourceId, originalBookId(task.id, task.sourceId)) === id,
    );
    return legacy?.id ?? id;
  }

  /**
   * Android `fun enqueueDownload(request, referer, headers)`.
   *
   * Dedupes against an existing row (failed rows are retryable), re-downloads
   * COMPLETED rows whose book left the shelf, snapshots whole-book novels and
   * starts the worker under the control lock.
   */
  async enqueueDownload(
    request: DownloadRequest,
    referer?: string | null,
    headers: Record<string, string> = {},
  ): Promise<void> {
    this.log(
      `enqueueDownload requested for bookId=${request.bookId}, title=${request.title}`,
    );
    // Android: scope.launch { enqueueMutex.lock(); try { … } finally { unlock } }
    await withControlLock(async () => {
      const canonicalId = taskId(request.sourceId, request.bookId);
      const id = await this.resolveTaskId(canonicalId);
      // Dedupe: don't enqueue a second task for the same book if one is already
      // pending/downloading/paused/completed. Failed tasks may be retried.
      const existing = await this.dao.getTask(id);
      const replaceNovel =
        request.replaceExistingNovel === true && isWholeBookNovelSource(request.sourceId);
      if (
        existing != null &&
        existing.status !== 'FAILED' &&
        !(replaceNovel && existing.status === 'COMPLETED')
      ) {
        if (existing.status === 'COMPLETED') {
          // 书架里是否还存在这本书；若已被删除，则清掉旧任务重新下载并重新入库
          const stillOnShelf = await this.bookExistsForTask(existing);
          if (stillOnShelf) {
            this.broadcaster.updateState(id, successState(existing.filePath));
            return;
          }
          this.log(
            `Completed task found but book removed from shelf; re-downloading ${request.bookId}`,
          );
          await this.dao.deleteTask(existing.id);
          await deleteQuietly(this.fs, existing.filePath);
          await deleteQuietly(this.fs, siblingPath(existing.filePath, '.tmp'));
        } else {
          this.log(
            `Task already exists for bookId=${request.bookId} (status=${existing.status}); skipping duplicate`,
          );
          if (existing.status === 'PAUSED') {
            this.broadcaster.updateState(
              id,
              pausedState(existing.downloadedBytes, existing.totalBytes),
            );
          } else if (existing.status === 'DOWNLOADING') {
            this.broadcaster.updateState(
              id,
              downloadingState(
                existing.downloadedBytes,
                existing.totalBytes,
                progressRatio(existing.downloadedBytes, existing.totalBytes),
              ),
            );
          } else {
            this.broadcaster.updateState(id, DownloadStatePending);
          }
          return;
        }
      }

      const finalFormat = request.format.trim().toLowerCase();
      if (!/^[a-z0-9]{1,10}$/.test(finalFormat)) {
        // Android require(finalFormat.matches(Regex("[a-z0-9]{1,10}")))
        throw new Error('下载格式无效');
      }
      const baseName = await sanitizeFileName(id);
      const finalFilePath = replaceNovel
        ? joinPath(this.downloadsDir, `${baseName}_${nanoTime()}.${finalFormat}`)
        : (existing?.filePath ??
          joinPath(this.downloadsDir, `${baseName}.${finalFormat}`));

      if (isWholeBookNovelSource(request.sourceId)) {
        const snapshot = request.novelSnapshot;
        if (snapshot != null && snapshot.sourceId === request.sourceId && snapshot.id === request.bookId) {
          await this.novels.prepare(id, snapshot, replaceNovel);
        }
      }

      const task: DownloadTaskRecord = {
        id,
        sourceId: request.sourceId,
        title: request.title,
        author: request.author,
        coverUrl: request.coverUrl ?? null,
        downloadUrl: request.downloadUrl,
        format: finalFormat,
        status: 'PENDING',
        downloadedBytes: 0,
        totalBytes: 0,
        filePath: finalFilePath,
        errorMessage: null,
        updatedAt: Date.now(),
      };
      await this.dao.insertOrUpdate(task);
      this.broadcaster.updateState(id, DownloadStatePending);

      try {
        await this.enqueueWorker(
          id,
          request.downloadUrl,
          request.title,
          finalFormat,
          referer ?? null,
          headers,
        );
      } catch (e) {
        if (isAbortError(e)) throw e; // Kotlin: if (e is CancellationException) throw e
        const message = errorMessage(e);
        await this.dao.updateProgressAndStatus(id, 'FAILED', 0, 0, message);
        this.broadcaster.updateState(id, errorState(message ?? '后台任务启动失败'));
      }
    });
  }

  /** Android `fun pauseDownload(requestedId)` — cancel the run, then preserve temp bytes. */
  async pauseDownload(requestedId: string): Promise<void> {
    this.log(`pauseDownload requested for bookId=${requestedId}`);
    await withControlLock(async () => {
      const bookId = await this.resolveTaskId(requestedId);
      await this.stopRun(bookId); // workManager.cancelUniqueWork("download_$bookId").result.get()
      await withTaskLock(bookId, async () => {
        const task = await this.dao.getTask(bookId);
        if (task == null) return;
        if (task.status === 'COMPLETED') return;
        const tempFile = joinPath(
          this.downloadsDir,
          `${nameWithoutExtension(task.filePath)}.tmp`,
        );
        const currentDownloaded = (await this.fs.exists(tempFile))
          ? (await this.fs.readFile(tempFile)).length
          : task.downloadedBytes;

        this.log(`Task paused for bookId=${bookId}. Preserved temp bytes=${currentDownloaded}`);
        await this.dao.updateProgressAndStatus(
          bookId,
          'PAUSED',
          currentDownloaded,
          task.totalBytes,
          null,
        );
        this.broadcaster.updateState(
          bookId,
          pausedState(currentDownloaded, task.totalBytes),
        );
      });
    });
  }

  /** Android `fun resumeDownload(requestedId)` — back to PENDING and re-enqueue. */
  async resumeDownload(requestedId: string): Promise<void> {
    this.log(`resumeDownload requested for bookId=${requestedId}`);
    await withControlLock(async () => {
      const bookId = await this.resolveTaskId(requestedId);
      const task = await this.dao.getTask(bookId);
      if (task == null) return;
      if (task.status === 'COMPLETED') return;
      await this.dao.updateProgressAndStatus(
        bookId,
        'PENDING',
        task.downloadedBytes,
        task.totalBytes,
        null,
      );
      this.broadcaster.updateState(bookId, DownloadStatePending);

      // No referer/headers → the stored `download:<id>` secret blob is left untouched.
      await this.enqueueWorker(bookId, task.downloadUrl, task.title, task.format);
    });
  }

  /** Android `fun cancelDownload(requestedId)` — kill the run and delete every artifact. */
  async cancelDownload(requestedId: string): Promise<void> {
    await withControlLock(async () => {
      const bookId = await this.resolveTaskId(requestedId);
      await this.stopRun(bookId);
      await withTaskLock(bookId, async () => {
        const task = await this.dao.getTask(bookId);
        if (task == null) return;
        if (task.status === 'COMPLETED') return;
        const base = nameWithoutExtension(task.filePath);
        await deleteQuietly(this.fs, joinPath(this.downloadsDir, `${base}.tmp`));
        await deleteQuietly(this.fs, joinPath(this.downloadsDir, `${base}.resume`));
        await deleteQuietly(this.fs, task.filePath);
        await this.dao.deleteTask(bookId);
        await this.secrets.remove(`download:${bookId}`);
        this.broadcaster.removeState(bookId);
      });
    });
  }

  /**
   * Android `private fun enqueueWorker(bookId, url, title, format, referer, headers)`.
   *
   * `url`/`title`/`format` travelled in the WorkManager input data and are only
   * read back from the persisted row by the worker (plus `title` for the Android
   * notification), so they are kept for signature parity but not consumed here.
   */
  private async enqueueWorker(
    bookId: string,
    _url: string,
    _title: string,
    _format: string,
    referer?: string | null,
    headers?: Record<string, string> | null,
  ): Promise<void> {
    if (headers != null) {
      const values: Record<string, string> = { ...headers };
      if (referer != null && referer.trim() !== '') values['Referer'] = referer;
      const raw = JSON.stringify(values);
      if (raw.length > 32 * 1024) {
        // Android require(raw.length <= 32 * 1024) { "下载请求头过大" }
        throw new Error('下载请求头过大');
      }
      if (Object.keys(values).length > 0) {
        await this.secrets.set(`download:${bookId}`, raw);
      } else {
        await this.secrets.remove(`download:${bookId}`);
      }
    }

    // ExistingWorkPolicy.REPLACE — abort whatever currently holds this unique name.
    await this.stopRun(bookId);

    const controller = new AbortController();
    const deps: DownloadWorkerDeps = {
      http: this.http,
      ...this.workerConfig,
      fs: this.fs,
      dao: this.dao,
      novels: this.novels,
      broadcaster: this.broadcaster,
      secrets: this.secrets,
      books: this.books,
      downloadsDir: this.downloadsDir,
      signal: controller.signal,
    };

    this.log(`Enqueuing download task download_${bookId}`);
    // WorkManager runs the worker out of line; only enqueue acceptance is awaited.
    const started = this.runWorker(bookId, deps).then(
      () => undefined,
      (e: unknown) => {
        // Worker-owned failures already wrote FAILED + Error; aborts are pause/cancel.
        if (isAbortError(e)) return;
        this.log(`Download run for ${bookId} ended: ${errorMessage(e) ?? 'unknown'}`);
      },
    );
    this.activeRuns.set(bookId, { controller, promise: started });
  }

  /** Android `workManager.cancelUniqueWork("download_$id")`. */
  private async stopRun(bookId: string): Promise<void> {
    const run = this.activeRuns.get(bookId);
    if (run === undefined) return;
    run.controller.abort();
    await run.promise;
    if (this.activeRuns.get(bookId) === run) this.activeRuns.delete(bookId);
  }

  /** Test/await helper: settles once the active run for `bookId` finishes (if any). */
  async waitForIdle(bookId: string): Promise<void> {
    await this.activeRuns.get(bookId)?.promise;
  }

  /** True while a worker run for this id is registered (WorkInfo !isFinished). */
  isRunning(bookId: string): boolean {
    return this.activeRuns.has(bookId);
  }

  /** Android `fun getDownloadState(bookId)`. */
  getDownloadState(bookId: string): DownloadState {
    return this.broadcaster.getState(bookId);
  }
}

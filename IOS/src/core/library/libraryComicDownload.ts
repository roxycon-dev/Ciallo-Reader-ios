/**
 * Port of Android `com.example.library.ComicDownloadManager.kt` (173 lines, 145
 * non-blank) and `com.example.library.ComicDownloadWorker.kt` (64 lines, 47 non-blank).
 *
 * Ported: 192 / 192 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - ComicDownloadManager.kt:3-17 Kotlin/Android imports (`Application`, `Context`,
 *   `androidx.work.*`, `AppDatabase`, `DownloadWorker`, `SharedPreferencesSourceStorage`,
 *   `kotlinx.coroutines.*`, `org.json.*`, `java.io.File`,
 *   `java.util.concurrent.ConcurrentHashMap`) — WorkManager becomes an injected task
 *   runner (the same seam `core/download/downloadManager.ts` uses), Room becomes the
 *   injected `ComicDownloadBookDao`, SharedPreferences becomes `FileSystemApi`, and
 *   JSONArray/JSONObject become plain `JSON`.
 * - ComicDownloadManager.kt:25 `CoroutineScope(SupervisorJob() + Dispatchers.IO +
 *   CoroutineExceptionHandler { _, e -> _message.value = e.message ?: "下载任务操作失败" })`
 *   → the `launch()` helper's `.catch` with the exact fallback message string.
 * - ComicDownloadManager.kt:26-32 `operations = Mutex()` / `stateLock = Any()` /
 *   `@Volatile app` → `AsyncMutex` (reused from `contentMutationGate`) plus plain
 *   fields; JS is single-threaded so the second lock and `@Volatile` are no-ops.
 * - ComicDownloadManager.kt:39 `internal fun <T> withControlLock(block)` →
 *   `withControlLock<T>(block)` (same body).
 * - ComicDownloadManager.kt:68 `work.getWorkInfosForUniqueWork(workName(id)).get()
 *   .none { !it.state.isFinished }` — the WorkInfo probe → `runner.isActive(uniqueName)`.
 * - ComicDownloadManager.kt:102-103 and 126/133/158/167 the four
 *   `WorkManager.…(…).result.get()` blocking joins → `await
 *   runner.enqueueUniqueWork / runner.cancelUniqueWork(...)`.
 * - ComicDownloadManager.kt:114 `Constraints … NetworkType.CONNECTED` — there is no
 *   background scheduler in a browser/WebView; the constraint is the injected runner's
 *   responsibility and is documented on {@link ComicDownloadTaskRunner}.
 * - ComicDownloadManager.kt:115 `enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)`
 *   → `runner.enqueueUniqueWork(name, 'KEEP', id)`; the KEEP policy (no duplicate for the
 *   same chapter) is what the runner must honour.
 * - ComicDownloadManager.kt:45-49 `android.util.AtomicFile` +
 *   `File(context.filesDir, "comic_download_tasks.json")` → `FileSystemApi.readFile /
 *   writeFile` at `comic_download_tasks.json`; the AtomicFile guarantee is already
 *   provided by the platform `FileSystemApi` (see `chapterCatalog.ts` line 72 comment).
 * - ComicDownloadManager.kt:139 `owned.deleteRecursively()` → injected
 *   `deleteTree(path)` (FileSystemApi has no recursive delete).
 * - ComicDownloadManager.kt:144-151 `source(context,id)` building a `SourceManager` and
 *   registering MangaDex + cached JS sources → injected `resolveSource(sourceId)`; the
 *   `sources[id] = it` memoisation is preserved verbatim.
 * - ComicDownloadWorker.kt:3-5, 17-25 imports + `NotificationChannel` /
 *   `NotificationCompat` / `ForegroundInfo` / `setForeground` — Android
 *   foreground-service UI, not portable to a web/iOS WebView; progress is reported
 *   through the task runner instead.
 * - ComicDownloadWorker.kt:26 `withContext(Dispatchers.IO)` and line 47
 *   `withContext(NonCancellable)` — coroutine dispatchers; the "NonCancellable" final
 *   status write is preserved by awaiting it before the runner reports success.
 * - ComicDownloadWorker.kt:29/34/42 `AppDatabase…bookDao()` and
 *   `ComicLocalImporter.importChapter` → injected `bookDao` + the ported
 *   `importComicChapter` from `./libraryComicLocalImporter`.
 * - ComicDownloadWorker.kt:63 `companion object { private val slots = Semaphore(2) }` →
 *   module-level `WORKER_SLOTS = 2` with an `AsyncSemaphore`, identical to the Kotlin
 *   singleton.
 *
 * Platform adaptations:
 * - `enum class ComicDownloadStatus` → string-literal union + const object.
 * - `MutableStateFlow<T>` / `StateFlow<T>` → async getters plus a listener registry,
 *   matching the established pattern in `favoriteRepository.ts` (Room DAO Flow →
 *   `tasks()` / `subscribeTasks(listener)`).
 * - `scope.launch { … }` fire-and-forget → a stored promise per operation, tracked in
 *   `inflight` so `whenIdle()` can await it in tests; each operation still runs under
 *   the same `operations` mutex.
 * - `System.currentTimeMillis()` → `wallClock` seam; `SystemClock.elapsedRealtime()` →
 *   `monotonic` seam (both settable through `setComicDownloadClocks` for tests).
 * - `MessageDigest("SHA-256")` for the directory name → `crypto.subtle.digest`.
 *
 * Line-by-line audit fixes (2026-10-06):
 * - ComicDownloadManager.kt:55/56/58 `takeIf { it.isNotBlank() }` on `cover` / `volume` /
 *   `error` were bare `!== ''` tests, which kept whitespace-only values Kotlin drops.
 * - ComicDownloadManager.kt:42-75 `load()` runs under `synchronized(stateLock)`, so a
 *   concurrent caller waits instead of observing an empty map; the port now memoises the
 *   in-flight promise rather than flipping a bare `loaded` boolean.
 * - ComicDownloadWorker.kt:29 reads the task through `ComicDownloadManager.task(ctx, key)`,
 *   which calls `load()`; `runWorkerForTask` now awaits `load()` too.
 */

import type { FileSystemApi } from '@platform/interfaces';
import type { SearchBook } from '@core/source/searchBook';
import type { ComicChapter } from '@core/source/comicChapter';
import type { ComicSource } from '@core/source/comicSource';
import { AsyncMutex } from './contentMutationGate';
import { importComicChapter, type ComicChapterImportDeps, type ComicImportedBook } from './libraryComicLocalImporter';

/** Android `enum class ComicDownloadStatus { DOWNLOADING, PAUSED, FAILED, SUCCESS }`. */
export type ComicDownloadStatus = 'DOWNLOADING' | 'PAUSED' | 'FAILED' | 'SUCCESS';

export const ComicDownloadStatus = {
  DOWNLOADING: 'DOWNLOADING',
  PAUSED: 'PAUSED',
  FAILED: 'FAILED',
  SUCCESS: 'SUCCESS',
} as const satisfies Record<ComicDownloadStatus, ComicDownloadStatus>;

/** Android `data class ComicDownloadTask(chapterId, book, chapter, status, progress, error)`. */
export interface ComicDownloadTask {
  chapterId: string;
  book: SearchBook;
  chapter: ComicChapter;
  status: ComicDownloadStatus;
  progress: number;
  error: string | null;
}

/**
 * Kotlin `WorkManager` seam — the established pattern from
 * `core/download/downloadManager.ts`. The runner owns scheduling (the
 * `NetworkType.CONNECTED` constraint becomes "online" detection) and calls
 * {@link ComicDownloadManager.runWorkerForTask} when a queued task actually starts.
 */
export interface ComicDownloadTaskRunner {
  /** `WorkManager.getWorkInfosForUniqueWork(name).get().any { !it.state.isFinished }`. */
  isActive(uniqueName: string): Promise<boolean>;
  /** `enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)`. */
  enqueueUniqueWork(uniqueName: string, policy: 'KEEP', taskId: string): Promise<void>;
  /** `cancelUniqueWork(name).result.get()`. */
  cancelUniqueWork(uniqueName: string): Promise<void>;
}

/** Android `AppDatabase.getDatabase(context).bookDao()` subset used here. */
export interface ComicDownloadBookDao {
  getBookByFilePath(path: string): Promise<ComicImportedBook | null>;
  insertBookWithChapters(
    book: ComicImportedBook,
    chapters: Array<{ bookId: number; chapterOrder: number; title: string; content: string }>,
  ): Promise<ComicImportedBook>;
}

/** Android `DownloadWorker.withTaskLock(key) { … }`. */
export type WithTaskLock = <T>(taskId: string, block: () => Promise<T>) => Promise<T>;

export interface ComicDownloadManagerDeps {
  fs: FileSystemApi;
  runner: ComicDownloadTaskRunner;
  bookDao: ComicDownloadBookDao;
  withTaskLock: WithTaskLock;
  /** Android `ComicLocalImporter.importChapter` dependencies (minus fs/bookDao). */
  importer: Omit<ComicChapterImportDeps, 'fs' | 'bookDao'>;
  /** Android `SourceManager` + MangaDex / cached JS repo registration. */
  resolveSource: (sourceId: string) => Promise<ComicSource | null>;
  /** Android `File.deleteRecursively()`. */
  deleteTree: (path: string) => Promise<void>;
  /** Android `CoroutineExceptionHandler { _, e -> _message.value = e.message ?: "下载任务操作失败" }`. */
  onFatalError?: (message: string) => void;
}

/** Android `private val operations = Mutex()`. */
const operations = new AsyncMutex();

/** ComicDownloadWorker.kt:63 `companion object { private val slots = Semaphore(2) }`. */
const WORKER_SLOTS = 2;

/** Kotlin `kotlinx.coroutines.sync.Semaphore(permits)` + `withPermit`. */
class AsyncSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    try {
      return await block();
    } finally {
      const next = this.waiters.shift();
      if (next !== undefined) next();
      else this.available += 1;
    }
  }
}

let wallClock: () => number = Date.now;
let monotonic: () => number = () => 0;

/** Test seam for `System.currentTimeMillis()` / `SystemClock.elapsedRealtime()`. */
export function setComicDownloadClocks(now: () => number, monotonicNow: () => number): void {
  wallClock = now;
  monotonic = monotonicNow;
}

async function sha256HexOf(input: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  );
  let out = '';
  for (const b of digest) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Android `fun taskId(book, chapterId)`. */
export function comicDownloadTaskId(
  book: Pick<SearchBook, 'sourceId' | 'id'>,
  chapterId: string,
): string {
  return `comic:${String(book.sourceId.length)}:${book.sourceId}${String(book.id.length)}:${book.id}${chapterId}`;
}

/** Android `private fun workName(id) = "comic_download_$id"`. */
export function comicDownloadWorkName(id: string): string {
  return `comic_download_${id}`;
}

const TASK_FILE = 'comic_download_tasks.json';
const TASK_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Kotlin `enum class ComicDownloadStatus` `values()` — the legal `valueOf` names. */
const COMIC_DOWNLOAD_STATUSES: readonly ComicDownloadStatus[] = [
  ComicDownloadStatus.DOWNLOADING,
  ComicDownloadStatus.PAUSED,
  ComicDownloadStatus.FAILED,
  ComicDownloadStatus.SUCCESS,
];

/**
 * Kotlin `ComicDownloadStatus.valueOf(name)` — throws on an unknown constant so the
 * caller's `runCatching` reports `下载任务记录损坏，请重新添加任务`.
 */
function comicDownloadStatusOf(value: unknown): ComicDownloadStatus {
  const name = typeof value === 'string' ? value : String(value);
  const match = COMIC_DOWNLOAD_STATUSES.find((it) => it === name);
  if (match === undefined) {
    throw new Error(`No enum constant com.example.library.ComicDownloadStatus.${name}`);
  }
  return match;
}

/** Durable descriptors + unique task jobs, with source-qualified identities. */
export class ComicDownloadManager {
  private readonly fs: FileSystemApi;
  private readonly runner: ComicDownloadTaskRunner;
  private readonly bookDao: ComicDownloadBookDao;
  private readonly taskLock: WithTaskLock;
  private readonly importerDeps: ComicDownloadManagerDeps['importer'];
  private readonly resolveSource: ComicDownloadManagerDeps['resolveSource'];
  private readonly deleteTree: ComicDownloadManagerDeps['deleteTree'];
  private readonly onFatalError: (message: string) => void;
  private readonly workerSlots = new AsyncSemaphore(WORKER_SLOTS);

  private loaded = false;
  private loading: Promise<void> | null = null;
  private state: Map<string, ComicDownloadTask> = new Map();
  private message: string | null = null;
  private readonly taskListeners = new Set<(tasks: Map<string, ComicDownloadTask>) => void>();
  private readonly messageListeners = new Set<(message: string | null) => void>();
  private readonly sources = new Map<string, ComicSource>();
  private readonly lastSave = new Map<string, number>();
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(deps: ComicDownloadManagerDeps) {
    this.fs = deps.fs;
    this.runner = deps.runner;
    this.bookDao = deps.bookDao;
    this.taskLock = deps.withTaskLock;
    this.importerDeps = deps.importer;
    this.resolveSource = deps.resolveSource;
    this.deleteTree = deps.deleteTree;
    this.onFatalError =
      deps.onFatalError ??
      ((message) => {
        this.message = message;
        this.notifyMessage();
      });
  }

  /* ───────────── StateFlow → async getter + listener registry ───────────── */

  /** Android `val tasks: StateFlow<Map<String, ComicDownloadTask>>` (`_tasks.value`). */
  tasks(): Map<string, ComicDownloadTask> {
    return this.state;
  }

  /** Android `tasks.asStateFlow().collect { }` — see `LibraryViewModel.initialize()`. */
  subscribeTasks(listener: (tasks: Map<string, ComicDownloadTask>) => void): () => void {
    this.taskListeners.add(listener);
    return () => {
      this.taskListeners.delete(listener);
    };
  }

  /** Android `val message: StateFlow<String?>`. */
  messageValue(): string | null {
    return this.message;
  }

  subscribeMessage(listener: (message: string | null) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  private notifyTasks(): void {
    for (const listener of [...this.taskListeners]) listener(this.state);
  }

  private notifyMessage(): void {
    for (const listener of [...this.messageListeners]) listener(this.message);
  }

  /** Android `scope.launch { … }` — fire and forget, errors routed to the handler. */
  private launch(block: () => Promise<void>): Promise<void> {
    const promise = block().catch((e: unknown) => {
      this.onFatalError(
        e instanceof Error ? (e.message ?? '下载任务操作失败') : '下载任务操作失败',
      );
    });
    this.inflight.add(promise);
    void promise.finally(() => {
      this.inflight.delete(promise);
    });
    return promise;
  }

  /** Test seam: await every fire-and-forget operation started so far. */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /* ───────────── Persistence ───────────── */

  /** Android `internal fun directory(context, id): File`. */
  async directory(id: string): Promise<string> {
    const hash = await sha256HexOf(id);
    return `comics_${hash}`;
  }

  /** Android `fun initialize(context)` → `load(context.applicationContext)`. */
  async initialize(): Promise<void> {
    await this.load();
  }

  /** Android `private fun load(context) = synchronized(stateLock) { … }`. */
  load(): Promise<void> {
    // Android serialises the whole body on `stateLock`, so a second caller cannot observe a
    // half-restored task map. The port keeps that guarantee by memoising the in-flight
    // promise instead of a bare `loaded` boolean.
    if (this.loaded) return Promise.resolve();
    const pending = this.loading;
    if (pending !== null) return pending;
    const run = this.loadOnce();
    this.loading = run;
    void run.then(() => {
      if (this.loading === run) this.loading = null;
    });
    return run;
  }

  private async loadOnce(): Promise<void> {
    this.loaded = true;
    let restored: Map<string, ComicDownloadTask>;
    try {
      restored = await this.readTasks();
    } catch {
      this.setMessage('下载任务记录损坏，请重新添加任务');
      restored = new Map();
    }
    this.state = restored;
    this.notifyTasks();

    void this.launch(async () => {
      await operations.withLock(async () => {
        for (const [id, task] of restored) {
          if (
            task.status !== ComicDownloadStatus.DOWNLOADING ||
            this.state.get(id)?.status !== ComicDownloadStatus.DOWNLOADING
          ) {
            continue;
          }
          try {
            const active = await this.runner.isActive(comicDownloadWorkName(id));
            if (!active) await this.enqueue(id);
          } catch {
            this.update(id, true, (it) => ({
              ...it,
              status: ComicDownloadStatus.PAUSED,
              error: '后台任务恢复失败，请手动继续',
            }));
          }
        }
      });
    });
  }

  /** Android `private fun load(context)`'s `runCatching { JSONArray(...) }` body. */
  private async readTasks(): Promise<Map<string, ComicDownloadTask>> {
    if (!(await this.fs.exists(TASK_FILE))) return new Map();
    const raw = await this.fs.readFile(TASK_FILE);
    if (raw.length > TASK_FILE_MAX_BYTES) throw new Error('task file too large');
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(raw));
    if (!Array.isArray(parsed)) throw new Error('task file is not an array');
    const out = new Map<string, ComicDownloadTask>();
    for (let i = 0; i < parsed.length; i += 1) {
      const o = parsed[i] as Record<string, unknown>;
      const b = o['book'] as Record<string, unknown>;
      const c = o['chapter'] as Record<string, unknown>;
      const book: SearchBook = {
        id: String(b['id']),
        sourceId: String(b['sourceId']),
        title: String(b['title']),
        author: typeof b['author'] === 'string' ? b['author'] : '',
        // Kotlin `b.optString("cover").takeIf { it.isNotBlank() }`.
        cover: typeof b['cover'] === 'string' && b['cover'].trim() !== '' ? b['cover'] : null,
        description: null,
        format: typeof b['format'] === 'string' ? b['format'] : 'comic',
        language: null,
        comicId: null,
        size: null,
        downloadUrl: null,
        eapiId: null,
        eapiHash: null,
        novelInfo: null,
        comicInfo: null,
      };
      const chapter: ComicChapter = {
        id: String(c['id']),
        title: String(c['title']),
        // Kotlin `c.optString("volume").takeIf { it.isNotBlank() }`.
        volume: typeof c['volume'] === 'string' && c['volume'].trim() !== '' ? c['volume'] : null,
        order: typeof c['order'] === 'number' ? c['order'] : 0,
        external: false,
        externalUrl: null,
      };
      const rawProgress = typeof o['progress'] === 'number' ? o['progress'] : 0;
      const progress = Number.isFinite(rawProgress)
        ? Math.min(1, Math.max(0, rawProgress))
        : 0;
      out.set(comicDownloadTaskId(book, chapter.id), {
        chapterId: chapter.id,
        book,
        chapter,
        // Kotlin `ComicDownloadStatus.valueOf(o.getString("status"))` throws
        // IllegalArgumentException on an unknown name, which the surrounding `runCatching`
        // turns into "下载任务记录损坏" + an empty task map. Validate so a corrupt file
        // cannot leak a bogus status into `_tasks`.
        status: comicDownloadStatusOf(o['status']),
        progress,
        // Kotlin `o.optString("error").takeIf { it.isNotBlank() }`.
        error: typeof o['error'] === 'string' && o['error'].trim() !== '' ? o['error'] : null,
      });
    }
    return out;
  }

  /** Android `private fun persist()`. */
  private persist(): void {
    const a = [...this.state.values()].map((t) => ({
      book: {
        id: t.book.id,
        sourceId: t.book.sourceId,
        title: t.book.title,
        author: t.book.author,
        cover: t.book.cover ?? '',
        format: t.book.format,
      },
      chapter: {
        id: t.chapter.id,
        title: t.chapter.title,
        volume: t.chapter.volume ?? '',
        order: t.chapter.order,
      },
      status: t.status,
      progress: t.progress,
      error: t.error ?? '',
    }));
    void this.fs.writeFile(TASK_FILE, new TextEncoder().encode(JSON.stringify(a)));
  }

  /* ───────────── Task access ───────────── */

  /** Android `internal fun task(context, id) = _tasks.value[id]`. */
  async task(id: string): Promise<ComicDownloadTask | null> {
    await this.load();
    return this.state.get(id) ?? null;
  }

  /** Android `internal fun update(id, immediate = true, transform)`. */
  update(
    id: string,
    immediate: boolean,
    transform: (task: ComicDownloadTask) => ComicDownloadTask,
  ): void {
    const old = this.state.get(id);
    if (old === undefined) return;
    if (old.status !== ComicDownloadStatus.DOWNLOADING) return;
    const next = new Map(this.state);
    next.set(id, transform(old));
    this.state = next;
    this.notifyTasks();
    const now = monotonic();
    if (immediate || now - (this.lastSave.get(id) ?? 0) >= 2000) {
      this.persist();
      this.lastSave.set(id, now);
    }
  }

  /** Kotlin call-site shorthand `update(id) { … }` (immediate = true). */
  updateNow(id: string, transform: (task: ComicDownloadTask) => ComicDownloadTask): void {
    this.update(id, true, transform);
  }

  /* ───────────── Control ───────────── */

  /** Android `fun start(app, database, book, chapter, source)`. */
  start(
    book: SearchBook,
    chapter: ComicChapter,
    source: ComicSource,
  ): void {
    void this.launch(async () => {
      await this.load();
      this.sources.set(book.sourceId, source);
      await operations.withLock(async () => {
        const id = comicDownloadTaskId(book, chapter.id);
        if (await this.runner.isActive(comicDownloadWorkName(id))) return;
        const next = new Map(this.state);
        next.set(id, {
          chapterId: chapter.id,
          book,
          chapter,
          status: ComicDownloadStatus.DOWNLOADING,
          progress: this.state.get(id)?.progress ?? 0,
          error: null,
        });
        this.state = next;
        this.notifyTasks();
        this.persist();
        await this.enqueue(id);
      });
    });
  }

  /**
   * Android `private fun enqueue(work, id)` — the WorkManager request is handed to the
   * injected runner, which owns scheduling (KEEP policy + the CONNECTED network
   * constraint) and calls back into {@link ComicDownloadManager.runWorkerForTask} when
   * the task actually starts.
   */
  private async enqueue(id: string): Promise<void> {
    await this.runner.enqueueUniqueWork(comicDownloadWorkName(id), 'KEEP', id);
  }

  /**
   * Kotlin `ComicDownloadWorker.doWork(): Result` — the callback the injected task
   * runner invokes once it decides to actually run the queued chapter download.
   */
  async runWorkerForTask(key: string): Promise<'success' | 'failure' | 'skipped'> {
    return this.taskLock(key, async () => {
      // Kotlin ComicDownloadWorker.kt:29 goes through `ComicDownloadManager.task(ctx, key)`,
      // which itself calls `load(context)` first. Kept so a runner that starts a queued task
      // before `initialize()` still sees the restored task map.
      await this.load();
      const task = this.state.get(key);
      if (task === undefined) return 'failure';
      if (task.status !== ComicDownloadStatus.DOWNLOADING) return 'skipped';
      try {
        await this.workerSlots.withPermit(async () => {
          const dir = await this.directory(key);
          if ((await this.bookDao.getBookByFilePath(dir)) === null) {
            const source = await this.source(task.book.sourceId);
            if (source === null) throw new Error('书源未安装，请重新启用该书源后重试');
            const images = await source.getChapterImages(task.chapter.id);
            if (images.kind === 'error') throw images.exception;
            const inserted = await importComicChapter({
              ...this.importerDeps,
              fs: this.fs,
              bookDao: this.bookDao,
              book: task.book,
              chapter: task.chapter,
              imageUrls: images.data,
              headers: await source.getChapterImageHeaders(task.chapter.id, images.data),
              targetDir: dir,
              resolveImage: (url: string) => source.resolveChapterImage(url),
              resolveHeaders: (url: string) => source.getResolvedHeaders(url),
              concurrency: 3,
              onProgress: (progress: number) => {
                this.update(key, false, (it) => ({ ...it, progress }));
              },
            });
            // Android `…importChapter(…).getOrThrow()`.
            if (!inserted.ok) throw new Error(inserted.error);
          }
        });
        // Kotlin `withContext(NonCancellable) { update(key) { … SUCCESS … } }`.
        this.updateNow(key, (it) => ({
          ...it,
          status: ComicDownloadStatus.SUCCESS,
          progress: 1,
          error: null,
        }));
        this.setMessage(`已下载到书架：${task.book.title} · ${task.chapter.title}`);
        return 'success';
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          this.updateNow(key, (it) => ({ ...it, status: ComicDownloadStatus.PAUSED }));
          throw e;
        }
        const message = e instanceof Error ? (e.message ?? '章节下载失败') : '章节下载失败';
        this.updateNow(key, (it) => ({
          ...it,
          status: ComicDownloadStatus.FAILED,
          error: message,
        }));
        this.setMessage(`下载失败：${message}`);
        return 'failure';
      }
    });
  }

  /** Android `private fun resolve(chapterId, book)`. */
  private resolve(chapterId: string, book: SearchBook | null): string | null {
    if (book !== null) return comicDownloadTaskId(book, chapterId);
    const matches = [...this.state.entries()].filter(([, v]) => v.chapterId === chapterId);
    if (matches.length !== 1) return null;
    return matches[0]?.[0] ?? null;
  }

  /** Android `fun pause(chapterId, book = null)`. */
  pause(chapterId: string, book: SearchBook | null = null): void {
    void this.launch(async () => {
      await operations.withLock(async () => {
        const id = this.resolve(chapterId, book);
        if (id === null) return;
        const old = this.state.get(id);
        if (old !== undefined && old.status === ComicDownloadStatus.DOWNLOADING) {
          const next = new Map(this.state);
          next.set(id, { ...old, status: ComicDownloadStatus.PAUSED });
          this.state = next;
          this.notifyTasks();
          this.persist();
        }
        await this.runner.cancelUniqueWork(comicDownloadWorkName(id));
        await this.taskLock(id, async () => {});
      });
    });
  }

  /** Android `fun cancel(chapterId, book = null)`. */
  cancel(chapterId: string, book: SearchBook | null = null): void {
    void this.launch(async () => {
      await operations.withLock(async () => {
        const id = this.resolve(chapterId, book);
        if (id === null) return;
        this.pauseState(id);
        await this.runner.cancelUniqueWork(comicDownloadWorkName(id));
        await this.taskLock(id, async () => {
          const owned = await this.directory(id);
          const registered = await this.bookDao.getBookByFilePath(owned);
          const next = new Map(this.state);
          next.delete(id);
          this.state = next;
          this.notifyTasks();
          this.persist();
          if (registered === null) await this.deleteTree(owned);
        });
      });
    });
  }

  /** Android `private fun pauseState(id)`. */
  private pauseState(id: string): void {
    const current = this.state.get(id);
    if (current === undefined) return;
    const next = new Map(this.state);
    next.set(id, { ...current, status: ComicDownloadStatus.PAUSED });
    this.state = next;
    this.notifyTasks();
    this.persist();
  }

  /** Android `internal suspend fun source(context, id)`. */
  async source(id: string): Promise<ComicSource | null> {
    const cached = this.sources.get(id);
    if (cached !== undefined) return cached;
    const found = await this.resolveSource(id);
    if (found === null) return null;
    this.sources.set(id, found);
    return found;
  }

  /** Android `internal fun message(text)`. */
  setMessage(text: string): void {
    this.message = text;
    this.notifyMessage();
  }

  /** Android `internal suspend fun <T> withControlLock(block)`. */
  async withControlLock<T>(block: () => Promise<T>): Promise<T> {
    return operations.withLock(block);
  }

  /** Android `internal suspend fun pauseAllLocked(context)`. */
  async pauseAllLocked(): Promise<void> {
    await this.load();
    for (const [id, task] of [...this.state.entries()]) {
      if (task.status !== ComicDownloadStatus.DOWNLOADING) continue;
      this.pauseState(id);
      await this.runner.cancelUniqueWork(comicDownloadWorkName(id));
      await this.taskLock(id, async () => {});
    }
  }

  /** Android `internal suspend fun removeForDirectoryLocked(context, path)`. */
  async removeForDirectoryLocked(path: string): Promise<void> {
    await this.load();
    const ids: string[] = [];
    for (const id of this.state.keys()) {
      if ((await this.directory(id)) === path) ids.push(id);
    }
    for (const id of ids) {
      this.pauseState(id);
      await this.runner.cancelUniqueWork(comicDownloadWorkName(id));
      await this.taskLock(id, async () => {});
      const next = new Map(this.state);
      next.delete(id);
      this.state = next;
      this.notifyTasks();
      this.persist();
    }
  }

  /** Android `fun clearMessage()`. */
  clearMessage(): void {
    this.message = null;
    this.notifyMessage();
  }
}

/** Kotlin `File(context.filesDir, "comics_${System.currentTimeMillis()}")`. */
export function freshComicChapterDir(): string {
  return `comics_${String(wallClock())}`;
}

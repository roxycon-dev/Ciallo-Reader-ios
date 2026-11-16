import type { SQLiteDatabase } from '@platform/interfaces';

export const DOWNLOAD_TASK_STATES = [
  'PENDING',
  'DOWNLOADING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type DownloadTaskState = (typeof DOWNLOAD_TASK_STATES)[number];

/** Android 1.6.4 DAO fallback: completed = 1, else bytes/total clamped, else 0. */
export function downloadTaskProgress(
  status: DownloadTaskState,
  downloadedBytes: number,
  totalBytes: number,
): number {
  if (status === 'COMPLETED') return 1;
  if (totalBytes > 0) return Math.min(1, downloadedBytes / totalBytes);
  return 0;
}

export interface DownloadTaskRecord {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  downloadUrl: string;
  format: string;
  status: DownloadTaskState;
  downloadedBytes: number;
  totalBytes: number;
  filePath: string;
  errorMessage: string | null;
  updatedAt: number;
  /** Android 1.6.4 `DownloadTaskEntity.progress` (`REAL NOT NULL DEFAULT 0`). */
  progress?: number;
}

export interface DownloadTaskStore {
  insertTask(task: DownloadTaskRecord): Promise<void>;
  /** Android `@Insert(onConflict = REPLACE) fun insertOrUpdate(task)` — same statement as insertTask. */
  insertOrUpdate(task: DownloadTaskRecord): Promise<void>;
  updateTask(task: DownloadTaskRecord): Promise<void>;
  deleteTask(id: string): Promise<void>;
  getTask(id: string): Promise<DownloadTaskRecord | null>;
  getActiveTasks(): Promise<DownloadTaskRecord[]>;
  getAllTasks(): Promise<DownloadTaskRecord[]>;
  getTasksByBook(bookId: string): Promise<DownloadTaskRecord[]>;
  updateProgress(
    id: string,
    downloadedBytes: number,
    totalBytes: number,
    updatedAt?: number,
  ): Promise<void>;
  updateState(
    id: string,
    state: DownloadTaskState,
    errorMessage?: string | null,
    updatedAt?: number,
  ): Promise<void>;
  /**
   * Android `updateProgressAndStatus` DAO query: status + byte counters +
   * errorMessage + updatedAt in a single UPDATE.
   */
  updateProgressAndStatus(
    id: string,
    status: DownloadTaskState,
    downloadedBytes: number,
    totalBytes: number,
    errorMessage?: string | null,
    updatedAt?: number,
    progress?: number,
  ): Promise<void>;
}

const DOWNLOAD_TASK_COLUMNS =
  '"id", "sourceId", "title", "author", "coverUrl", "downloadUrl", ' +
  '"format", "status", "downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt", "progress"';

interface DownloadTaskRow {
  id: string;
  sourceId: string | null;
  title: string | null;
  author: string | null;
  coverUrl: string | null;
  downloadUrl: string | null;
  format: string | null;
  status: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  filePath: string | null;
  errorMessage: string | null;
  updatedAt: number | null;
  progress: number | null;
}

function toState(raw: string | null): DownloadTaskState {
  if (raw !== null && (DOWNLOAD_TASK_STATES as readonly string[]).includes(raw)) {
    return raw as DownloadTaskState;
  }
  return 'FAILED';
}

function toRecord(row: DownloadTaskRow): DownloadTaskRecord {
  return {
    id: row.id,
    sourceId: row.sourceId ?? '',
    title: row.title ?? '',
    author: row.author ?? '',
    coverUrl: row.coverUrl ?? null,
    downloadUrl: row.downloadUrl ?? '',
    format: row.format ?? '',
    status: toState(row.status),
    downloadedBytes: row.downloadedBytes ?? 0,
    totalBytes: row.totalBytes ?? 0,
    filePath: row.filePath ?? '',
    errorMessage: row.errorMessage ?? null,
    updatedAt: row.updatedAt ?? 0,
    progress: row.progress ?? 0,
  };
}

function quoteId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export class DownloadTaskRepository implements DownloadTaskStore {
  constructor(private readonly db: SQLiteDatabase) {}

  insertTask(task: DownloadTaskRecord): Promise<void> {
    return this.db
      .execute(
        'INSERT INTO download_tasks ("id", "sourceId", "title", "author", "coverUrl", "downloadUrl", ' +
          '"format", "status", "downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt", "progress") ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT("id") DO UPDATE SET ' +
          '"sourceId" = excluded."sourceId", "title" = excluded."title", "author" = excluded."author", ' +
          '"coverUrl" = excluded."coverUrl", "downloadUrl" = excluded."downloadUrl", ' +
          '"format" = excluded."format", "status" = excluded."status", ' +
          '"downloadedBytes" = excluded."downloadedBytes", "totalBytes" = excluded."totalBytes", ' +
          '"filePath" = excluded."filePath", "errorMessage" = excluded."errorMessage", ' +
          '"updatedAt" = excluded."updatedAt", "progress" = excluded."progress"',
        [
          task.id,
          task.sourceId,
          task.title,
          task.author,
          task.coverUrl,
          task.downloadUrl,
          task.format,
          task.status,
          task.downloadedBytes,
          task.totalBytes,
          task.filePath,
          task.errorMessage,
          task.updatedAt,
          task.progress ??
            downloadTaskProgress(task.status, task.downloadedBytes, task.totalBytes),
        ],
      )
      .then(() => undefined);
  }

  insertOrUpdate(task: DownloadTaskRecord): Promise<void> {
    // Room @Insert(onConflict = OnConflictStrategy.REPLACE) — identical upsert.
    return this.insertTask(task);
  }

  updateTask(task: DownloadTaskRecord): Promise<void> {
    return this.db
      .execute(
        'UPDATE download_tasks SET "sourceId" = ?, "title" = ?, "author" = ?, "coverUrl" = ?, ' +
          '"downloadUrl" = ?, "format" = ?, "status" = ?, "downloadedBytes" = ?, "totalBytes" = ?, ' +
          '"filePath" = ?, "errorMessage" = ?, "updatedAt" = ?, "progress" = ? WHERE "id" = ' + quoteId(task.id),
        [
          task.sourceId,
          task.title,
          task.author,
          task.coverUrl,
          task.downloadUrl,
          task.format,
          task.status,
          task.downloadedBytes,
          task.totalBytes,
          task.filePath,
          task.errorMessage,
          task.updatedAt,
          task.progress ??
            downloadTaskProgress(task.status, task.downloadedBytes, task.totalBytes),
        ],
      )
      .then(() => undefined);
  }

  deleteTask(id: string): Promise<void> {
    return this.db
      .execute(`DELETE FROM download_tasks WHERE "id" = ${quoteId(id)}`)
      .then(() => undefined);
  }

  getTask(id: string): Promise<DownloadTaskRecord | null> {
    return this.db
      .query<DownloadTaskRow>(
        `SELECT ${DOWNLOAD_TASK_COLUMNS} FROM download_tasks WHERE "id" = ${quoteId(id)}`,
      )
      .then((rows) => {
        const row = rows[0];
        return row ? toRecord(row) : null;
      });
  }

  getAllTasks(): Promise<DownloadTaskRecord[]> {
    return this.db
      .query<DownloadTaskRow>(
        `SELECT ${DOWNLOAD_TASK_COLUMNS} FROM download_tasks ORDER BY "updatedAt" DESC`,
      )
      .then((rows) => rows.map(toRecord));
  }

  getActiveTasks(): Promise<DownloadTaskRecord[]> {
    return this.getAllTasks().then((tasks) =>
      tasks.filter((task) => task.status === 'PENDING' || task.status === 'DOWNLOADING'),
    );
  }

  getTasksByBook(bookId: string): Promise<DownloadTaskRecord[]> {
    return this.getAllTasks().then((tasks) =>
      tasks.filter((task) => task.id === bookId || task.id.endsWith(bookId)),
    );
  }

  updateProgress(
    id: string,
    downloadedBytes: number,
    totalBytes: number,
    updatedAt?: number,
  ): Promise<void> {
    return this.db
      .execute(
        `UPDATE download_tasks SET "downloadedBytes" = ?, "totalBytes" = ?, "updatedAt" = ? WHERE "id" = ${quoteId(id)}`,
        [downloadedBytes, totalBytes, updatedAt ?? Date.now()],
      )
      .then(() => undefined);
  }

  updateState(
    id: string,
    state: DownloadTaskState,
    errorMessage?: string | null,
    updatedAt?: number,
  ): Promise<void> {
    return this.db
      .execute(
        `UPDATE download_tasks SET "status" = ?, "errorMessage" = ?, "updatedAt" = ? WHERE "id" = ${quoteId(id)}`,
        [state, errorMessage ?? null, updatedAt ?? Date.now()],
      )
      .then(() => undefined);
  }

  async updateProgressAndStatus(
    id: string,
    status: DownloadTaskState,
    downloadedBytes: number,
    totalBytes: number,
    errorMessage?: string | null,
    updatedAt?: number,
    progress = -1,
  ): Promise<void> {
    // Android 1.6.4 DAO:
    // progress = CASE WHEN :progress >= 0 THEN :progress
    //                 WHEN :totalBytes > 0 THEN MIN(1.0, CAST(:downloadedBytes AS REAL) / :totalBytes)
    //                 ELSE progress END
    // The three branches are evaluated here because the preview in-memory SQLite
    // cannot evaluate CASE / CAST / MIN expressions; the stored value is identical.
    let next = progress;
    if (next < 0) {
      next = totalBytes > 0
        ? Math.min(1, downloadedBytes / totalBytes)
        : ((await this.getTask(id))?.progress ?? 0);
    }
    await this.db.execute(
      `UPDATE download_tasks SET "status" = ?, "downloadedBytes" = ?, "totalBytes" = ?, ` +
        `"errorMessage" = ?, "updatedAt" = ?, "progress" = ? WHERE "id" = ${quoteId(id)}`,
      [status, downloadedBytes, totalBytes, errorMessage ?? null, updatedAt ?? Date.now(), next],
    );
  }
}

export function createDownloadTaskRepository(db: SQLiteDatabase): DownloadTaskRepository {
  return new DownloadTaskRepository(db);
}

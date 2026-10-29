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
  ): Promise<void>;
}

const DOWNLOAD_TASK_COLUMNS =
  '"id", "sourceId", "title", "author", "coverUrl", "downloadUrl", ' +
  '"format", "status", "downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt"';

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
          '"format", "status", "downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt") ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT("id") DO UPDATE SET ' +
          '"sourceId" = excluded."sourceId", "title" = excluded."title", "author" = excluded."author", ' +
          '"coverUrl" = excluded."coverUrl", "downloadUrl" = excluded."downloadUrl", ' +
          '"format" = excluded."format", "status" = excluded."status", ' +
          '"downloadedBytes" = excluded."downloadedBytes", "totalBytes" = excluded."totalBytes", ' +
          '"filePath" = excluded."filePath", "errorMessage" = excluded."errorMessage", ' +
          '"updatedAt" = excluded."updatedAt"',
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
          `"filePath" = ?, "errorMessage" = ?, "updatedAt" = ? WHERE "id" = ${quoteId(task.id)}`,
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

  updateProgressAndStatus(
    id: string,
    status: DownloadTaskState,
    downloadedBytes: number,
    totalBytes: number,
    errorMessage?: string | null,
    updatedAt?: number,
  ): Promise<void> {
    // Android @Query("UPDATE download_tasks SET status = :status, downloadedBytes = :downloadedBytes,
    //                 totalBytes = :totalBytes, errorMessage = :errorMessage, updatedAt = :updatedAt
    //                 WHERE id = :id")
    return this.db
      .execute(
        `UPDATE download_tasks SET "status" = ?, "downloadedBytes" = ?, "totalBytes" = ?, ` +
          `"errorMessage" = ?, "updatedAt" = ? WHERE "id" = ${quoteId(id)}`,
        [status, downloadedBytes, totalBytes, errorMessage ?? null, updatedAt ?? Date.now()],
      )
      .then(() => undefined);
  }
}

export function createDownloadTaskRepository(db: SQLiteDatabase): DownloadTaskRepository {
  return new DownloadTaskRepository(db);
}

/**
 * Android 1.6.4 / Room 14 parity:
 * - `download_tasks.progress REAL NOT NULL DEFAULT 0`
 * - `MIGRATION_13_14` backfill SQL
 * - DownloadTaskRepository persists the new column.
 */
import { describe, expect, it } from 'vitest';
import type { SQLiteDatabase } from '@platform/interfaces';
import {
  ROOM_IDENTITY_HASH,
  ROOM_SCHEMA_VERSION,
  TABLES,
  createTableSql,
} from '../../src/core/db/schemaV14';
import { MIGRATION_13_14 } from '../../src/core/db/roomMigrations';
import {
  DownloadTaskRepository,
  downloadTaskProgress,
  type DownloadTaskRecord,
} from '../../src/core/download/downloadTaskRepository';
import { openAppDatabase } from '../../src/core/db/openDatabase';

const task: DownloadTaskRecord = {
  id: 'v2:4:testbook',
  sourceId: 'test',
  title: '书',
  author: '作者',
  coverUrl: null,
  downloadUrl: 'https://example.com/a.epub',
  format: 'epub',
  status: 'DOWNLOADING',
  downloadedBytes: 25,
  totalBytes: 100,
  filePath: 'downloads/a.epub',
  errorMessage: null,
  updatedAt: 1,
  progress: 0.25,
};

function captureDb(): { db: SQLiteDatabase; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const db = {
    execute: (statement: string, values?: unknown[]) => {
      sql.push(statement);
      params.push(values ?? []);
      return Promise.resolve({ rowsAffected: 1 });
    },
    query: () => Promise.resolve([]),
  } as unknown as SQLiteDatabase;
  return { db, sql, params };
}

describe('Room v14', () => {
  it('matches Android 14.json version + identityHash', () => {
    expect(ROOM_SCHEMA_VERSION).toBe(14);
    expect(ROOM_IDENTITY_HASH).toBe('cea7b11a32c3e566b570e3725101572b');
  });

  it('adds download_tasks.progress as REAL NOT NULL', () => {
    const table = TABLES.find((item) => item.name === 'download_tasks');
    expect(table).toBeDefined();
    if (!table) return;
    expect(table.columns.map((column) => column.name)).toContain('progress');
    expect(table.columns.find((column) => column.name === 'progress')).toMatchObject({
      type: 'REAL',
      notNull: true,
    });
    expect(createTableSql(table)).toContain('"progress" REAL NOT NULL');
  });

  it('MIGRATION_13_14 runs the exact Kotlin statements', async () => {
    const executed: string[] = [];
    await MIGRATION_13_14.migrate({
      execute: (statement: string) => {
        executed.push(statement);
        return Promise.resolve(undefined);
      },
      query: () => Promise.resolve([]),
    });
    expect(executed).toEqual([
      'ALTER TABLE download_tasks ADD COLUMN progress REAL NOT NULL DEFAULT 0',
      "UPDATE download_tasks SET progress = CASE WHEN status = 'COMPLETED' THEN 1 " +
        'WHEN totalBytes > 0 THEN MIN(1.0, CAST(downloadedBytes AS REAL) / totalBytes) ELSE 0 END',
    ]);
  });

  it('progress fallback matches the DAO CASE', () => {
    expect(downloadTaskProgress('COMPLETED', 0, 0)).toBe(1);
    expect(downloadTaskProgress('DOWNLOADING', 25, 100)).toBe(0.25);
    expect(downloadTaskProgress('DOWNLOADING', 200, 100)).toBe(1);
    expect(downloadTaskProgress('PENDING', 0, 0)).toBe(0);
  });

  it('insert/update statements persist progress', async () => {
    const { db, sql, params } = captureDb();
    const repo = new DownloadTaskRepository(db);
    await repo.insertTask(task);
    await repo.updateTask(task);
    expect(sql[0]).toContain('"progress"');
    expect(params[0]?.at(-1)).toBe(0.25);
    expect(sql[1]).toContain('"progress" = ?');
    expect(params[1]?.at(-1)).toBe(0.25);
  });

  it('updateProgressAndStatus evaluates the Android CASE branches', async () => {
    const first = captureDb();
    const repo = new DownloadTaskRepository(first.db);
    await repo.updateProgressAndStatus('id', 'DOWNLOADING', 25, 100, null, 7, 0.5);
    // Explicit progress wins (CASE WHEN :progress >= 0).
    expect(first.sql[0]).toContain('"progress" = ?');
    expect(first.params[0]?.at(-1)).toBe(0.5);
    // Bytes/total fallback (MIN(1, downloaded/total)).
    const second = captureDb();
    await new DownloadTaskRepository(second.db).updateProgressAndStatus(
      'id', 'DOWNLOADING', 25, 100, null, 7, -1,
    );
    expect(second.params[0]?.at(-1)).toBe(0.25);
    // No progress and no total keeps the stored row value.
    const third = captureDb();
    await new DownloadTaskRepository(third.db).updateProgressAndStatus(
      'id', 'PAUSED', 0, 0, null, 7, -1,
    );
    expect(third.params[0]?.at(-1)).toBe(0);
  });

  it('openAppDatabase runs the v13→v14 step for an existing table', async () => {
    const executed: string[] = [];
    let hasProgress = false;
    const db = {
      open: () => Promise.resolve(),
      execute: (statement: string) => {
        executed.push(statement);
        if (statement.startsWith('ALTER TABLE download_tasks ADD COLUMN progress')) {
          hasProgress = true;
        }
        return Promise.resolve({ rowsAffected: 1 });
      },
      query: (statement: string) => {
        if (statement.startsWith('PRAGMA table_info')) {
          return Promise.resolve(hasProgress ? [{ name: 'progress' }] : [{ name: 'id' }]);
        }
        return Promise.resolve([]);
      },
    } as unknown as SQLiteDatabase;
    await openAppDatabase({ db });
    expect(executed).toContain(
      'ALTER TABLE download_tasks ADD COLUMN progress REAL NOT NULL DEFAULT 0',
    );
    expect(executed.some((statement) => statement.startsWith('UPDATE download_tasks SET progress'))).toBe(
      true,
    );
  });
});

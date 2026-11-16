import { TABLES as V13_TABLES } from './schemaV13';
import type { TableDef } from './schemaV12';

export { BACKUP_TABLES, createIndexSql, createTableSql } from './schemaV12';

/**
 * Current Android `14.json` (versionCode 264 / 1.6.4).
 *
 * v13 → v14 is additive: `download_tasks.progress REAL NOT NULL DEFAULT 0`.
 * Android backfills existing rows with
 * `CASE WHEN status='COMPLETED' THEN 1 WHEN totalBytes>0 THEN MIN(1, downloadedBytes/totalBytes) ELSE 0 END`
 * (`AppDatabase.kt` `MIGRATION_13_14`).
 */
export const ROOM_SCHEMA_VERSION = 14;
export const ROOM_IDENTITY_HASH = 'cea7b11a32c3e566b570e3725101572b';

export const TABLES: TableDef[] = V13_TABLES.map((table) =>
  table.name === 'download_tasks'
    ? {
        ...table,
        columns: [
          ...table.columns,
          { name: 'progress', type: 'REAL', notNull: true },
        ],
      }
    : table,
);

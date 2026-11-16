import type { SQLiteDatabase } from '@platform/interfaces';
import { createIndexSql, createTableSql, TABLES } from './schemaV14';
import { MIGRATION_13_14 } from './roomMigrations';

export const APP_DATABASE_FILENAME = 'novel-reader.db';

/**
 * `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table. Android
 * Room runs its migration chain on upgrade; this port must do the equivalent for
 * additive columns. v13 → v14 (`download_tasks.progress`) is the only column
 * added after the v12 baseline that installed iOS builds can still have.
 */
async function ensureAdditiveColumns(db: SQLiteDatabase): Promise<void> {
  const columns = await db.query<{ name: string }>('PRAGMA table_info("download_tasks")');
  if (columns.length > 0 && !columns.some((column) => column.name === 'progress')) {
    await MIGRATION_13_14.migrate(db);
  }
}

export async function openAppDatabase(platform: { db: SQLiteDatabase }): Promise<void> {
  const db = platform.db;
  await db.open({ name: APP_DATABASE_FILENAME });
  for (const table of TABLES) {
    await db.execute(createTableSql(table));
    for (const index of table.indices) {
      await db.execute(createIndexSql(table, index));
    }
  }
  await ensureAdditiveColumns(db);
}

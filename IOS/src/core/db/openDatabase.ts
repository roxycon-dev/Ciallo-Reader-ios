import type { SQLiteDatabase } from '@platform/interfaces';
import { createIndexSql, createTableSql, TABLES } from './schemaV12';

export const APP_DATABASE_FILENAME = 'novel-reader.db';

export async function openAppDatabase(platform: { db: SQLiteDatabase }): Promise<void> {
  const db = platform.db;
  await db.open({ name: APP_DATABASE_FILENAME });
  for (const table of TABLES) {
    await db.execute(createTableSql(table));
    for (const index of table.indices) {
      await db.execute(createIndexSql(table, index));
    }
  }
}

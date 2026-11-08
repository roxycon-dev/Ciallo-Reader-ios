import { afterEach, describe, expect, it } from 'vitest';
import reference from '../reference/android/app/schemas/com.example.data.AppDatabase/13.json';
import { BACKUP_TABLES, ROOM_IDENTITY_HASH, ROOM_SCHEMA_VERSION, TABLES, createTableSql, createIndexSql } from '@core/db/schemaV13';
import { MIGRATION_12_13 } from '@core/db/roomMigrations';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';

const databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
describe('current Android v13 schema and installed-library upgrade', () => {
  it('matches every table, column and index in the actual Room export', () => {
    expect(ROOM_SCHEMA_VERSION).toBe(reference.database.version); expect(ROOM_IDENTITY_HASH).toBe(reference.database.identityHash);
    expect(TABLES.map((table) => table.name).sort()).toEqual(reference.database.entities.map((table) => table.tableName).sort());
    for (const entity of reference.database.entities) {
      const table = TABLES.find((table) => table.name === entity.tableName)!;
      expect(table.columns.map((column) => ({ name: column.name, affinity: column.type, notNull: column.notNull === true }))).toEqual(entity.fields.map((field) => ({ name: field.columnName, affinity: field.affinity, notNull: field.notNull })));
      expect(table.primaryKey).toEqual(entity.primaryKey.columnNames); expect(table.autoGeneratePk).toBe(entity.primaryKey.autoGenerate);
      expect(table.indices.map((index) => ({ name: index.name, unique: index.unique, columns: index.columns }))).toEqual(entity.indices.map((index) => ({ name: index.name, unique: index.unique, columns: index.columnNames })));
    }
    expect(BACKUP_TABLES).not.toContain('transfer_receipts'); expect(BACKUP_TABLES).not.toContain('transfer_identities');
  });
  it('runs the additive migration twice on real SQLite without erasing existing data or receipts', async () => {
    const db = createV12Database(); databases.push(db);
    await db.execute("INSERT INTO categories (id,name,isProtected) VALUES (7,'私密',1)");
    await MIGRATION_12_13.migrate(db);
    await db.execute("INSERT INTO transfer_receipts (packageId,importedAt) VALUES ('package',123)");
    await db.execute("INSERT INTO transfer_identities (localKey,stableId) VALUES ('books:7','file:hash')");
    await MIGRATION_12_13.migrate(db);
    expect(await db.query('SELECT name,isProtected FROM categories WHERE id=7')).toEqual([{ name: '私密', isProtected: 1 }]);
    expect(await db.query('SELECT * FROM transfer_receipts')).toEqual([{ packageId: 'package', importedAt: 123 }]);
    expect(await db.query('SELECT * FROM transfer_identities')).toEqual([{ localKey: 'books:7', stableId: 'file:hash' }]);
    for (const table of TABLES) { await db.execute(createTableSql(table)); for (const index of table.indices) await db.execute(createIndexSql(table, index)); }
    expect((await db.query<{ name: string }>('PRAGMA index_list(chapters)')).some((index) => index.name === 'index_chapters_bookId_chapterOrder')).toBe(true);
  });
});

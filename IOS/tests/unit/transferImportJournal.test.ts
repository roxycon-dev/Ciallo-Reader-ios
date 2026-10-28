import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { MIGRATION_12_13 } from '@core/db/roomMigrations';
import { SETTINGS_TABLE_SQL } from '@core/settings/settingsRepository';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import { TransferImportJournal, restoreImportUndo, type ImportJournalFiles, type ImportJournalRecord } from '@core/transfer/importJournal';
import type { SQLiteDatabase } from '@platform/interfaces';

const id = '01234567-89ab-cdef-0123-456789abcdef', secondId = '11234567-89ab-cdef-0123-456789abcdef';
const databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
async function setup() {
  const memory = createV12Database(); databases.push(memory); await MIGRATION_12_13.migrate(memory); await memory.execute(SETTINGS_TABLE_SQL);
  await memory.execute("INSERT INTO categories (id,name,isProtected) VALUES (1,'原有隐私分类',1)"); await memory.execute("INSERT INTO app_settings VALUES ('font_size','float','18')");
  const raw: SQLiteDatabase = { open: async () => {}, close: async () => {}, execute: (sql, params) => memory.execute(sql, params as (string | number | null)[]), query: (sql, params) => memory.query(sql, params as (string | number | null)[]) };
  const db = withExclusiveDatabase(raw); let pending: ImportJournalRecord | null = null, theme = 'old', definitions = 'old', failFinish = false;
  const files: ImportJournalFiles = {
    pending: async () => pending,
    prepare: async (record) => { pending = structuredClone(record); },
    restore: vi.fn(async () => { definitions = 'old'; }),
    finish: vi.fn(async () => { if (failFinish) throw new Error('Cleanup unavailable'); pending = null; }),
    discard: async () => { pending = null; },
  };
  const preferences = { snapshot: () => ({ 'comic_reader_store:global_config': theme }), restore: (snapshot: Record<string, string | null>) => { theme = snapshot['comic_reader_store:global_config']!; } };
  const journal = new TransferImportJournal(db, files, preferences);
  return { db, raw, files, journal, preferences, get theme() { return theme; }, get definitions() { return definitions; }, setTheme: (value: string) => { theme = value; }, setDefinitions: (value: string) => { definitions = value; }, setFinishFailure: (value: boolean) => { failFinish = value; }, get pending() { return pending; }, setPending: (value: ImportJournalRecord) => { pending = value; } };
}
describe('portable import commit markers and crash recovery on real SQLite', () => {
  it('rolls back the library and restores private preferences/definitions after a failed import', async () => {
    const fixture = await setup();
    await expect(fixture.journal.run(id, id, false, async (tx) => { await tx.execute("UPDATE categories SET name='部分导入'"); await tx.execute("UPDATE app_settings SET value='30'"); fixture.setTheme('new'); fixture.setDefinitions('new'); throw new Error('Import failed'); })).rejects.toThrow('Import failed');
    expect(await fixture.db.query('SELECT name,isProtected FROM categories')).toEqual([{ name: '原有隐私分类', isProtected: 1 }]); expect(await fixture.db.query('SELECT value FROM app_settings')).toEqual([{ value: '18' }]);
    expect(fixture.theme).toBe('old'); expect(fixture.definitions).toBe('old'); expect(fixture.pending).toBeNull();
  });
  it('finishes a committed journal after a crash without undoing later user writes or restoring old preferences', async () => {
    const fixture = await setup(); fixture.setFinishFailure(true);
    const result = await fixture.journal.run(id, id, false, async (tx) => { await tx.execute("UPDATE categories SET name='已导入'"); fixture.setTheme('new'); fixture.setDefinitions('new'); return 3; });
    expect(result).toEqual({ value: 3, finalizationPending: true }); expect(fixture.pending?.id).toBe(id);
    await fixture.db.execute("INSERT INTO categories (id,name,isProtected) VALUES (2,'稍后新增',0)"); fixture.setFinishFailure(false);
    await new TransferImportJournal(fixture.db, fixture.files, fixture.preferences).recover();
    expect(await fixture.db.query('SELECT name FROM categories ORDER BY id')).toEqual([{ name: '已导入' }, { name: '稍后新增' }]); expect(fixture.theme).toBe('new'); expect(fixture.files.restore).not.toHaveBeenCalled(); expect(fixture.pending).toBeNull();
    expect(await fixture.db.query('SELECT * FROM transfer_receipts')).toEqual([]);
  });
  it('recovers external state when SQLite rolled back an interrupted transaction before its receipt committed', async () => {
    const fixture = await setup(); fixture.setPending({ version: 1, id, stageId: id, keepUndo: false, createdAt: 1, settings: { 'comic_reader_store:global_config': 'old' } }); fixture.setTheme('partial'); fixture.setDefinitions('partial');
    await fixture.journal.recover(); expect(fixture.theme).toBe('old'); expect(fixture.definitions).toBe('old'); expect(fixture.pending).toBeNull(); expect(await fixture.db.query('SELECT name FROM categories')).toEqual([{ name: '原有隐私分类' }]);
  });
  it('keeps replacement undo rows inside SQLite and restores original privacy and settings', async () => {
    const fixture = await setup();
    await fixture.journal.run(id, id, true, async (tx) => { await tx.execute('DELETE FROM categories'); await tx.execute("INSERT INTO categories (id,name,isProtected) VALUES (4,'新分类',0)"); await tx.execute("UPDATE app_settings SET value='24'"); });
    await fixture.db.transaction(restoreImportUndo);
    expect(await fixture.db.query('SELECT id,name,isProtected FROM categories')).toEqual([{ id: 1, name: '原有隐私分类', isProtected: 1 }]); expect(await fixture.db.query('SELECT value FROM app_settings')).toEqual([{ value: '18' }]);
  });
  it('preserves the previous undo snapshot when a later replacement fails', async () => {
    const fixture = await setup(); await fixture.journal.run(id, id, true, async (tx) => { await tx.execute("UPDATE categories SET name='第一次替换'"); });
    await expect(fixture.journal.run(secondId, secondId, true, async (tx) => { await tx.execute("UPDATE categories SET name='失败替换'"); throw new Error('Failed second replace'); })).rejects.toThrow('Failed second replace');
    expect(await fixture.db.query('SELECT name FROM categories')).toEqual([{ name: '第一次替换' }]); await fixture.db.transaction(restoreImportUndo); expect(await fixture.db.query('SELECT name FROM categories')).toEqual([{ name: '原有隐私分类' }]);
  });
});

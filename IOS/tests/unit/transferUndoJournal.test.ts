import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { MIGRATION_12_13 } from '@core/db/roomMigrations';
import { SETTINGS_TABLE_SQL } from '@core/settings/settingsRepository';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import type { SQLiteDatabase } from '@platform/interfaces';
import { TransferImportJournal, type ImportJournalRecord } from '@core/transfer/importJournal';
import { TransferUndoJournal, type ImportUndoFiles, type PendingImportUndo } from '@core/transfer/undoJournal';
const databases: MemorySqlite[] = [], snapshotId = '01234567-89ab-cdef-0123-456789abcdef', operationId = '11234567-89ab-cdef-0123-456789abcdef';
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
async function setup() {
  const memory = createV12Database(); databases.push(memory); await MIGRATION_12_13.migrate(memory); await memory.execute(SETTINGS_TABLE_SQL); await memory.execute("INSERT INTO categories VALUES (1,'旧分类',1)");
  const raw: SQLiteDatabase = { open: async () => {}, close: async () => {}, execute: (sql, values) => memory.execute(sql, values as (string | number | null)[]), query: (sql, values) => memory.query(sql, values as (string | number | null)[]) };
  const database = withExclusiveDatabase(raw); let pendingImport: ImportJournalRecord | null = null, backup: ImportJournalRecord | null = null, pendingUndo: PendingImportUndo | null = null, theme = 'old', definitions = 'old';
  const preferences = { snapshot: () => ({ 'comic_reader_store:global_config': theme }), restore: async (values: Record<string, string | null>) => { theme = values['comic_reader_store:global_config']!; } };
  const imports = new TransferImportJournal(database, { pending: async () => pendingImport, prepare: async (record) => { pendingImport = record; }, restore: async () => { definitions = 'old'; }, finish: async () => { backup = pendingImport; pendingImport = null; }, discard: async () => { pendingImport = null; } }, preferences);
  await imports.run(snapshotId, snapshotId, true, async (tx) => { await tx.execute("UPDATE categories SET name='替换后'"); theme = 'new'; definitions = 'new'; });
  const files: ImportUndoFiles = { available: async () => backup, pending: async () => pendingUndo, begin: vi.fn<ImportUndoFiles['begin']>(async (id, expected) => { const current = backup; if (!current || current.id !== expected) throw new Error('snapshot changed'); const record: PendingImportUndo = { version: 1, operationId: id, snapshot: structuredClone(current) }; pendingUndo = record; return record; }), restore: vi.fn(async () => { definitions = 'old'; }), finish: vi.fn(async () => { backup = null; pendingUndo = null; }) };
  return { database, files, undo: new TransferUndoJournal(database, files, preferences), get theme() { return theme; }, get definitions() { return definitions; }, get pending() { return pendingUndo; }, setTheme: (value: string) => { theme = value; }, removeBackup: () => { backup = null; } };
}
describe('durable replacement undo on real managed SQLite', () => {
  it('restores tables and receiver-local preferences/definitions after explicit snapshot confirmation', async () => {
    const fixture = await setup(); expect((await fixture.undo.available())?.id).toBe(snapshotId);
    expect(await fixture.undo.run(operationId, snapshotId)).toEqual({ finalizationPending: false });
    expect(await fixture.database.query('SELECT name,isProtected FROM categories')).toEqual([{ name: '旧分类', isProtected: 1 }]); expect(fixture.theme).toBe('old'); expect(fixture.definitions).toBe('old'); expect(await fixture.undo.available()).toBeNull(); expect(fixture.pending).toBeNull();
  });
  it('replays an interrupted undo from its durable intent after SQL rolls back', async () => {
    const fixture = await setup(); vi.mocked(fixture.files.restore).mockRejectedValueOnce(new Error('file temporarily unavailable'));
    await expect(fixture.undo.run(operationId, snapshotId)).rejects.toThrow('temporarily unavailable'); expect(fixture.pending).not.toBeNull(); expect(await fixture.database.query('SELECT name FROM categories')).toEqual([{ name: '替换后' }]);
    await fixture.undo.recover(); expect(await fixture.database.query('SELECT name FROM categories')).toEqual([{ name: '旧分类' }]); expect(fixture.theme).toBe('old'); expect(fixture.pending).toBeNull();
  });
  it('only finishes cleanup after a committed undo, preserving later user writes even if backups were already deleted', async () => {
    const fixture = await setup(); vi.mocked(fixture.files.finish).mockImplementationOnce(async () => { fixture.removeBackup(); throw new Error('cleanup interrupted'); });
    expect(await fixture.undo.run(operationId, snapshotId)).toEqual({ finalizationPending: true });
    fixture.setTheme('later preference'); await fixture.database.execute("UPDATE categories SET name='之后修改'"); await fixture.undo.recover();
    expect(fixture.files.restore).toHaveBeenCalledOnce(); expect(fixture.theme).toBe('later preference'); expect(await fixture.database.query('SELECT name FROM categories')).toEqual([{ name: '之后修改' }]); expect(fixture.pending).toBeNull();
  });
  it('rejects mismatched native/SQL snapshots and incompatible layouts before publishing an undo intent', async () => {
    const fixture = await setup(); await fixture.database.execute("DELETE FROM transfer_receipts WHERE packageId LIKE 'undo-snapshot:%'");
    expect(await fixture.undo.available()).toBeNull(); await expect(fixture.undo.run(operationId, snapshotId)).rejects.toThrow('快照已改变'); expect(fixture.files.begin).not.toHaveBeenCalled();
    await fixture.database.execute('INSERT INTO transfer_receipts VALUES (?,0)', [`undo-snapshot:${snapshotId}`]); await fixture.database.execute('DROP TABLE _ciallo_undo_categories');
    await expect(fixture.undo.run(operationId, snapshotId)).rejects.toThrow('版本不兼容'); expect(fixture.files.begin).not.toHaveBeenCalled(); expect(await fixture.database.query('SELECT name FROM categories')).toEqual([{ name: '替换后' }]);
  });
  it('does not undo a different snapshot from the one the user reviewed', async () => {
    const fixture = await setup(); await expect(fixture.undo.run(operationId, operationId)).rejects.toThrow('快照已改变'); expect(fixture.files.begin).not.toHaveBeenCalled(); expect(fixture.theme).toBe('new');
  });
});

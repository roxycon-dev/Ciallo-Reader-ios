import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { MIGRATION_12_13 } from '@core/db/roomMigrations';
import { SETTINGS_TABLE_SQL } from '@core/settings/settingsRepository';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import type { SQLiteDatabase } from '@platform/interfaces';
import { TransferImportJournal, restoreImportUndo, type ImportJournalFiles, type ImportJournalRecord } from '@core/transfer/importJournal';
import { importPortableArchive } from '@core/transfer/archiveImporter';
import { ArchiveResources } from '@core/transfer/archiveResources';
import { BookContentFingerprint } from '@core/transfer/bookFingerprint';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import { TABLES } from '@core/db/schemaV13';
import { portableChapterVersion, type PortableArchivePreview, type PortableEnvelope, type PortableRow, type TransferCategory } from '@core/transfer/portableFormat';
const id = '01234567-89ab-cdef-0123-456789abcdef', databases: MemorySqlite[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function envelope(table: string, values: PortableRow): PortableEnvelope {
  return { table, row: { ...Object.fromEntries(TABLES.find((definition) => definition.name === table)!.columns.map((column) => [column.name, !column.notNull ? null : column.type === 'TEXT' ? '' : 0])), ...values } };
}
async function setup(categories: TransferCategory[], input: PortableEnvelope[]) {
  const memory = createV12Database(); databases.push(memory); await MIGRATION_12_13.migrate(memory); await memory.execute(SETTINGS_TABLE_SQL);
  const raw: SQLiteDatabase = { open: async () => {}, close: async () => {}, execute: (sql, params) => memory.execute(sql, params as (string | number | null)[]), query: (sql, params) => memory.query(sql, params as (string | number | null)[]) };
  const db = withExclusiveDatabase(raw), staging = new TransferStagingRows(db, id); async function* source() { yield* input; } await staging.build(source());
  const counts: Record<string, number> = {}; for (const row of input) counts[row.table] = (counts[row.table] ?? 0) + 1;
  const preview: PortableArchivePreview = { packageId: id, version: 2, counts, categories, expandedBytes: 0, warnings: [], containsProtected: false, protectedFavorites: false };
  let pending: ImportJournalRecord | null = null, setting = 'receiver', promoted = false;
  const files: ImportJournalFiles = { pending: async () => pending, prepare: async (record) => { pending = record; }, restore: async () => { promoted = false; }, finish: async () => { pending = null; }, discard: async () => { pending = null; } };
  const journal = new TransferImportJournal(db, files, { snapshot: () => ({ 'comic_reader_store:global_config': setting }), restore: (snapshot) => { setting = snapshot['comic_reader_store:global_config']!; } });
  const promoteResources = vi.fn(async () => { promoted = true; }), applySettings = vi.fn(async () => { setting = 'imported'; });
  const options = { stageId: id, mode: 'MERGE' as 'MERGE' | 'REPLACE', privacyEnabled: false, resources: new ArchiveResources(new Map(), `restored_transfer_${id}/files`), staging, localFingerprint: new BookContentFingerprint(async () => null), localOriginal: async () => null, promoteResources, applySettings };
  return { db, preview, options, journal, get setting() { return setting; }, get promoted() { return promoted; }, get pending() { return pending; } };
}
const book = () => envelope('books', { id: 1, title: '传入小说', category: '默认', contentType: 'NOVEL', totalChapters: 1, filePath: 'source_configs/secret.json' });
const chapter = () => envelope('chapters', { id: 1, bookId: 1, chapterOrder: 0, title: '第一章', content: '正文' });
describe('journaled whole-archive import on real managed SQLite', () => {
  it('maps parent-only chapter ids for annotations without copying metadata content over the local book', async () => {
    const identity = `file:${'a'.repeat(64)}`, parent = { ...book(), identity, parentOnly: true, bodyVersion: portableChapterVersion([{ chapterOrder: 0, title: '第一章', content: '本机正文' }]) };
    const metadata = chapter(); metadata.row.content = '';
    const fixture = await setup(['ANNOTATIONS'], [parent, metadata, envelope('god_moments', { id: 1, bookId: '1', chapterId: '1', contentType: 'NOVEL', updatedAt: 10 })]);
    const existing = { ...book().row, id: 50 }; const writer = new (await import('@core/transfer/archiveDatabaseRows')).ArchiveDatabaseRows(fixture.db);
    await writer.insert('books', existing); await writer.insert('chapters', { ...chapter().row, id: 90, bookId: 50, content: '本机正文' }); await fixture.db.execute('INSERT INTO transfer_identities VALUES (?,?)', ['books:50', identity]);
    await fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options));
    expect(await fixture.db.query('SELECT bookId,chapterId FROM god_moments')).toEqual([{ bookId: '50', chapterId: '90' }]); expect(await fixture.db.query('SELECT content FROM chapters')).toEqual([{ content: '本机正文' }]);
  });
  it('imports books, mapped annotations and history together, then skips a repeated package before any file/settings action', async () => {
    const fixture = await setup(['BOOKS', 'ANNOTATIONS', 'HISTORY'], [book(), chapter(), envelope('bookmarks', { id: 1, bookId: 1, chapterIndex: 0, title: '书签' }), envelope('reading_records', { bookId: 1, bookTitle: '传入小说', dateStr: '2026-10-28', durationSeconds: 30 })]);
    await fixture.db.execute("INSERT INTO books SELECT 50,'原有书籍','','',NULL,'默认',0,0,0,0,'NOVEL',0,0,NULL,NULL");
    const first = await fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options));
    expect(first.value.recordedSeconds).toBe(30); expect(first.value.duplicate).toBe(false); expect(fixture.promoted).toBe(true);
    expect(await fixture.db.query('SELECT bookId FROM bookmarks')).toEqual([{ bookId: 51 }]); expect(await fixture.db.query('SELECT filePath FROM books WHERE id=51')).toEqual([{ filePath: '' }]);
    const second = await fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options));
    expect(second.value.duplicate).toBe(true); expect(fixture.options.promoteResources).toHaveBeenCalledOnce(); expect(fixture.options.applySettings).toHaveBeenCalledOnce(); expect(await fixture.db.query('SELECT * FROM books')).toHaveLength(2);
  });
  it('restores tables, resources and external preferences if settings fail after resource promotion', async () => {
    const fixture = await setup(['BOOKS'], [book(), chapter()]);
    fixture.options.applySettings.mockImplementationOnce(async () => { throw new Error('settings disk full'); });
    await expect(fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options))).rejects.toThrow('settings disk full');
    expect(await fixture.db.query('SELECT * FROM books')).toEqual([]); expect(await fixture.db.query('SELECT * FROM transfer_receipts')).toEqual([]);
    expect(fixture.promoted).toBe(false); expect(fixture.setting).toBe('receiver'); expect(fixture.pending).toBeNull();
  });
  it('replaces only the chosen tables and preserves an undo snapshot in the same transaction', async () => {
    const favorite = envelope('favorites', { sourceId: 'source', comicId: 'incoming', title: '传入收藏' });
    const fixture = await setup(['FAVORITES'], [favorite]); fixture.options.mode = 'REPLACE';
    await fixture.db.execute("INSERT INTO books SELECT 50,'原有书籍','','',NULL,'默认',0,0,0,0,'NOVEL',0,0,NULL,NULL");
    const result = await fixture.journal.run(id, id, true, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options)); expect(result.value.added).toBe(1);
    expect(await fixture.db.query('SELECT title FROM books')).toEqual([{ title: '原有书籍' }]); expect(await fixture.db.query('SELECT * FROM favorites')).toHaveLength(1);
    await fixture.db.transaction(restoreImportUndo); expect(await fixture.db.query('SELECT * FROM favorites')).toEqual([]); expect(await fixture.db.query('SELECT title FROM books')).toEqual([{ title: '原有书籍' }]);
  });
  it('blocks protected packages and ignores tables outside the sender selected categories', async () => {
    const fixture = await setup(['FAVORITES'], [book(), chapter()]); fixture.preview.containsProtected = true;
    await expect(fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options))).rejects.toThrow('隐私 PIN');
    expect(fixture.options.promoteResources).not.toHaveBeenCalled(); fixture.preview.containsProtected = false;
    const result = await fixture.journal.run(id, id, false, (tx) => importPortableArchive(tx, fixture.preview, {}, fixture.options));
    expect(result.value.skipped).toBe(2); expect(await fixture.db.query('SELECT * FROM books')).toEqual([]);
  });
});

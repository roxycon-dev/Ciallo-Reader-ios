import { TABLES, createTableSql, createIndexSql } from '@core/db/schemaV13';
import { SETTINGS_TABLE_SQL, SettingsRepository } from '@core/settings/settingsRepository';
import type { PortableArchivePreview, PortableEnvelope } from '@core/transfer/portableFormat';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import { TransferImportJournal, type ImportJournalRecord } from '@core/transfer/importJournal';
import { TransferUndoJournal, type PendingImportUndo } from '@core/transfer/undoJournal';
import { importPortableArchive } from '@core/transfer/archiveImporter';
import { ArchiveResources } from '@core/transfer/archiveResources';
import { BookContentFingerprint } from '@core/transfer/bookFingerprint';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import { CapacitorSqliteDatabase } from './capacitorDb';
import { applyNativeArchiveSettings } from './archiveSettings';

/** Explicit debug CI probe. A separate native database and private in-memory
 * preference namespace keep the installed app's library and account state intact. */
export async function probeNativeArchiveImport(nonce: string): Promise<void> {
  const name = `ci_transfer_${nonce}`, id = `00000000-0000-4000-8000-${nonce.slice(0, 12)}`, database = withExclusiveDatabase(new CapacitorSqliteDatabase());
  const staging = new TransferStagingRows(database, id), reader = new Map<string, string>([['comic_reader_store:global_config', '{"theme":"old"}']]);
  let pending: ImportJournalRecord | null = null, snapshot: ImportJournalRecord | null = null, undoPending: PendingImportUndo | null = null, promoted = false, failSettings = true, promotions = 0;
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const storage = { get length() { return reader.size; }, key: (index: number) => [...reader.keys()][index] ?? null, getItem: (key: string) => reader.get(key) ?? null, setItem: (key: string, value: string) => { reader.set(key, value); }, removeItem: (key: string) => { reader.delete(key); } };
  try {
    await database.open({ name });
    for (const table of TABLES) { await database.execute(createTableSql(table)); for (const index of table.indices) await database.execute(createIndexSql(table, index)); }
    await database.execute(SETTINGS_TABLE_SQL);
    await database.execute("INSERT INTO books VALUES (50,'receiver','','',NULL,'默认',0,0,0,0,'NOVEL',0,0,NULL,NULL)");
    const source: PortableEnvelope[] = [
      { table: 'books', row: { id: 1, title: '传入小说', author: '', filePath: '', coverUri: null, category: '默认', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 1, contentType: 'NOVEL', addedTime: 1, lastReadTime: 1, sourceId: null, comicId: null } },
      { table: 'chapters', row: { id: 1, bookId: 1, chapterOrder: 0, title: '第一章', content: '原生 SQLite 正文', startCharIndex: 0, endCharIndex: 14 } },
      { table: 'bookmarks', row: { id: 1, bookId: 1, chapterIndex: 0, scrollOffset: 0, title: '标记', snippet: '', createdTime: 1 } },
      { table: 'reading_records', row: { id: 1, bookId: 1, bookTitle: '传入小说', dateStr: '2026-10-28', durationSeconds: 30 } },
    ];
    async function* rows() { yield* source; } await staging.build(rows());
    const preview: PortableArchivePreview = { packageId: id, version: 2, categories: ['BOOKS', 'ANNOTATIONS', 'HISTORY', 'SETTINGS'], counts: { books: 1, chapters: 1, bookmarks: 1, reading_records: 1 }, expandedBytes: 0, warnings: [], containsProtected: false, protectedFavorites: false };
    const resources = new ArchiveResources(new Map(), 'probe/files');
    const preferences = { snapshot: () => Object.fromEntries(reader), restore: (values: Record<string, string | null>) => { reader.clear(); for (const [key, value] of Object.entries(values)) if (value !== null) reader.set(key, value); } };
    const journal = new TransferImportJournal(database, { pending: async () => pending, prepare: async (record) => { pending = record; }, restore: async () => { promoted = false; }, finish: async () => { snapshot = pending; pending = null; }, discard: async () => { pending = null; } }, preferences);
    const settings = { novel_reader_prefs: { font_size: { type: 'float' as const, value: 22 } }, comic_reader_store: { global_config: { type: 'string' as const, value: '{"theme":"new"}' } } };
    const run = () => journal.run(id, id, true, (tx) => importPortableArchive(tx, preview, settings, {
      stageId: id, mode: 'REPLACE', privacyEnabled: false, resources, staging,
      localFingerprint: new BookContentFingerprint(async () => null), localOriginal: async () => null,
      promoteResources: async () => { promoted = true; promotions++; },
      applySettings: async (db, input, bookIds, recordedSeconds) => {
        const unused = async (): Promise<never> => { throw new Error('Unexpected source operation in isolated probe'); };
        await applyNativeArchiveSettings(db, input, { mode: 'REPLACE', preview, resources, bookIds, recordedSeconds, storage, sourceIds: [], sources: { getCustomSourceJsons: unused, getSourceStates: unused, getActiveSourceId: unused, saveActiveSourceId: unused, saveCustomSourceJson: unused, saveSourceState: unused, removeCustomSourceJson: unused }, scripts: { exportPortable: unused, importPortable: unused } });
        if (failSettings) throw new Error('intentional archive rollback');
      },
    }));
    let rolledBack = false;
    try { await run(); } catch (error) { check(error instanceof Error && error.message === 'intentional archive rollback', String(error)); rolledBack = true; }
    check(rolledBack && !promoted && reader.get('comic_reader_store:global_config') === '{"theme":"old"}', 'Native archive external rollback failed');
    check((await database.query<{ title: string }>('SELECT title FROM books'))[0]?.title === 'receiver' && (await database.query('SELECT * FROM transfer_receipts')).length === 0, 'Native archive SQL rollback failed');
    failSettings = false; const imported = await run();
    check(!imported.finalizationPending && promoted && promotions === 2 && imported.value.recordedSeconds === 30, 'Native archive commit failed');
    const bookmarks = await database.query<{ bookId: number }>('SELECT bookId FROM bookmarks');
    check(bookmarks.length === 1 && bookmarks[0]!.bookId !== 1, 'Native archive receiver id remapping failed');
    check(await new SettingsRepository(database).getFloat('font_size') === 22 && reader.get('comic_reader_store:global_config') === '{"theme":"new"}', 'Native archive settings not committed');
    check((await database.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '_ciallo_chapters_%'")).length === 0, 'Native archive chapter index leaked');
    const undo = new TransferUndoJournal(database, {
      available: async () => snapshot, pending: async () => undoPending,
      begin: async (operationId, snapshotId) => { check(snapshot?.id === snapshotId, 'Native undo snapshot differs'); undoPending = { version: 1, operationId, snapshot: snapshot! }; return undoPending; },
      restore: async () => { promoted = false; }, finish: async () => { snapshot = null; undoPending = null; },
    }, preferences);
    check((await undo.available())?.id === id, 'Native undo SQL/file receipt not matched');
    await undo.run(`10000000-0000-4000-8000-${nonce.slice(0, 12)}`, id);
    check((await database.query<{ title: string }>('SELECT title FROM books'))[0]?.title === 'receiver' && (await database.query('SELECT * FROM bookmarks')).length === 0, 'Native whole archive undo SQL restore failed');
    check(!promoted && reader.get('comic_reader_store:global_config') === '{"theme":"old"}' && await undo.available() === null, 'Native whole archive undo preference restore failed');
  } finally {
    await staging.dispose().catch(() => {});
    const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
    try { await CapacitorSQLite.deleteDatabase({ database: name }); } finally { await database.close(); }
  }
}

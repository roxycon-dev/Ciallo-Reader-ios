import { TABLES, createTableSql, createIndexSql } from '@core/db/schemaV13';
import { SETTINGS_TABLE_SQL, SettingsRepository } from '@core/settings/settingsRepository';
import type { PortableArchivePreview, PortableEnvelope } from '@core/transfer/portableFormat';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import { TransferImportJournal, type ImportJournalRecord } from '@core/transfer/importJournal';
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
  let pending: ImportJournalRecord | null = null, promoted = false, failSettings = true, promotions = 0;
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
    const journal = new TransferImportJournal(database, { pending: async () => pending, prepare: async (record) => { pending = record; }, restore: async () => { promoted = false; }, finish: async () => { pending = null; }, discard: async () => { pending = null; } }, { snapshot: () => Object.fromEntries(reader), restore: (snapshot) => { reader.clear(); for (const [key, value] of Object.entries(snapshot)) if (value !== null) reader.set(key, value); } });
    const settings = { novel_reader_prefs: { font_size: { type: 'float' as const, value: 22 } }, comic_reader_store: { global_config: { type: 'string' as const, value: '{"theme":"new"}' } } };
    const run = () => journal.run(id, id, false, (tx) => importPortableArchive(tx, preview, settings, {
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
  } finally {
    await staging.dispose().catch(() => {});
    const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
    try { await CapacitorSQLite.deleteDatabase({ database: name }); } finally { await database.close(); }
  }
}

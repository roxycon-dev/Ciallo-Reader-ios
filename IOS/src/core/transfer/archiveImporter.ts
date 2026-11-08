import { BACKUP_TABLES } from '@core/db/schemaV13';
import type { SqliteExecutor } from '@platform/interfaces';
import { ArchiveBookImporter, type ArchiveBookImportOptions } from './archiveBookImporter';
import { ArchiveDatabaseRows, RelatedArchiveRows, type ImportRowOutcome } from './archiveDatabaseRows';
import { TransferChapterIndex } from './chapterIndex';
import { PORTABLE_TABLE_CATEGORY, type PortableArchivePreview } from './portableFormat';
import type { PortableSettings } from './portableSettings';
import { ReadingHistoryMerge } from './readingHistoryMerge';
import { isTransferSessionId, requireTransfer } from './transferWire';

export interface ArchiveImportResult { added: number; merged: number; skipped: number; warnings: string[]; duplicate: boolean; recordedSeconds: number | null; }
export interface ArchiveImportOptions extends Omit<ArchiveBookImportOptions, 'index' | 'categories'> {
  stageId: string;
  privacyEnabled: boolean;
  signal?: AbortSignal;
  promoteResources(): Promise<void>;
  applySettings(database: SqliteExecutor, settings: PortableSettings, books: ReadonlyMap<number, number>, recordedSeconds: number | null): Promise<void>;
  progress?(completed: number, total: number): void;
}
/** This is the mutation inside TransferImportJournal.run, not a standalone
 * transaction. Files/settings and all tables share its rollback boundary. */
export async function importPortableArchive(database: SqliteExecutor, preview: PortableArchivePreview, settings: PortableSettings, options: ArchiveImportOptions): Promise<ArchiveImportResult> {
  requireTransfer(isTransferSessionId(options.stageId), '导入暂存身份无效');
  requireTransfer(!preview.containsProtected || options.privacyEnabled, '请先在接收设备设置隐私 PIN，再导入受保护内容');
  const result: ArchiveImportResult = { added: 0, merged: 0, skipped: 0, warnings: [...preview.warnings], duplicate: false, recordedSeconds: null };
  if (options.mode === 'MERGE' && (await database.query('SELECT packageId FROM transfer_receipts WHERE packageId=?', [preview.packageId])).length) {
    result.duplicate = true; result.skipped = Object.values(preview.counts).reduce((sum, count) => sum + count, 0); result.warnings.push('这份数据已导入，无需重复接收'); return result;
  }
  requireTransfer(!options.signal?.aborted, '导入已取消');
  const categories = preview.categories, chosen = (table: string) => categories.includes(PORTABLE_TABLE_CATEGORY[table]!);
  const needsParents = categories.some((category) => ['ANNOTATIONS', 'HISTORY', 'SETTINGS'].includes(category));
  if (options.mode === 'REPLACE') {
    for (const table of [...BACKUP_TABLES].reverse()) {
      const remove = chosen(table) || categories.includes('BOOKS') && ['bookmarks', 'highlights', 'god_moments', 'reading_records', 'reading_sessions', 'comic_progress', 'comic_chapter_read'].includes(table);
      if (remove) await database.execute(`DELETE FROM "${table}"`);
    }
    await database.execute('DELETE FROM transfer_receipts'); await database.execute('DELETE FROM transfer_identities');
  }
  const index = new TransferChapterIndex(database, options.stageId); await index.initialize();
  try {
    const staging = options.staging.using(database);
    const rows = new ArchiveDatabaseRows(database), books = new ArchiveBookImporter(rows, { ...options, staging, categories, index }); await books.initialize();
    const related = new RelatedArchiveRows(rows, books.books, books.chapters, books.titles);
    const history = new ReadingHistoryMerge(database, books.books, books.titles); await history.capture();
    let completed = 0; const total = Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
    const count = (outcome: ImportRowOutcome) => { result[outcome]++; options.progress?.(++completed, total); };
    const order = ['categories', 'favorite_categories', 'books', 'chapters', 'favorites', 'comic_progress', 'comic_chapter_read', 'bookmarks', 'highlights', 'god_moments', 'reading_sessions'];
    for (const table of order) for await (const envelope of staging.table(table)) {
      requireTransfer(!options.signal?.aborted, '导入已取消');
      if (!chosen(table) && !(table === 'books' && envelope.parentOnly) && !(needsParents && (table === 'categories' || table === 'chapters'))) { count('skipped'); continue; }
      if (table === 'books') count(await books.book(envelope));
      else if (table === 'chapters') count(await books.chapter(envelope, !chosen(table)));
      else count(await related.merge({ ...envelope, row: options.resources.row(envelope.row) }));
    }
    if (categories.includes('HISTORY')) {
      const historyResult = await history.merge(staging.table('reading_records'), staging.table('reading_sessions'));
      result.merged += historyResult.merged; result.skipped += historyResult.skipped; result.recordedSeconds = historyResult.recordedSeconds;
    }
    else if (options.mode === 'REPLACE' && categories.includes('BOOKS')) result.recordedSeconds = 0;
    if (options.mode === 'REPLACE' && categories.includes('BOOKS')) {
      // No imported classification is allowed to remove the receiver's default
      // destination for later document imports.
      if (!await rows.find('categories', ['name'], ['默认'])) await rows.insert('categories', { name: '默认', isProtected: 0 });
    }
    requireTransfer(!options.signal?.aborted, '导入已取消');
    await options.promoteResources();
    await options.applySettings(database, settings, books.books, result.recordedSeconds);
    await database.execute('INSERT OR REPLACE INTO transfer_receipts (packageId,importedAt) VALUES (?,?)', [preview.packageId, Date.now()]);
    result.warnings.push(...books.warnings); options.progress?.(total, total); return result;
  } finally { await index.dispose(); }
}

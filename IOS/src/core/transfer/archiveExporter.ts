import { BACKUP_TABLES, TABLES } from '@core/db/schemaV13';
import type { SqliteExecutor } from '@platform/interfaces';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { BookContentFingerprint } from './bookFingerprint';
import { TransferChapterIndex, localBookChapters } from './chapterIndex';
import { PORTABLE_ROWS_HEADER, PORTABLE_TABLE_CATEGORY, PortableRowsInspector, parsePortableRow, portableOnlineIdentity, type PortableEnvelope, type PortableRow, type TransferCategory } from './portableFormat';
import { requireTransfer } from './transferWire';
import { boundedTransferBatch } from './rowBatch';

export interface ArchiveExportSelection { categories: readonly TransferCategory[]; protectedAuthorized: boolean; }
export interface ExportResourceCatalog {
  exportRow(row: PortableRow): Promise<PortableRow>;
  exportBody(content: string, contentType: string): Promise<string>;
  original(book: PortableRow): Promise<string | null>;
  directoryIdentity(book: PortableRow): Promise<string | null>;
  hash(path: string): Promise<string | null>;
  normalizeBody?(body: string, contentType: string): Promise<string>;
}
export interface ArchiveExportRowsResult { counts: Record<string, number>; selectedBookKeys: ReadonlySet<string>; containsProtected: boolean; protectedFavorites: boolean; }

/** The caller holds the content/source/download gates and a database snapshot.
 * Byte-bounded rows cross the SQLite bridge; NDJSON is flushed without
 * materializing the library or any image/EPUB bytes in JavaScript. */
export async function exportPortableRows(database: SqliteExecutor, stageId: string, selection: ArchiveExportSelection, resources: ExportResourceCatalog, write: (text: string, reset: boolean) => Promise<void>, signal?: AbortSignal): Promise<ArchiveExportRowsResult> {
  const categories = new Set(selection.categories), protectedNames = new Set((await database.query<{ name: string }>('SELECT name FROM categories WHERE isProtected<>0')).map((row) => row.name));
  const favoritesProtected = await new SettingsRepository(database).getBoolean('favorites_protected', false), mayFavorites = !favoritesProtected || selection.protectedAuthorized;
  const selectedBooks = new Map<number, PortableRow>(), hiddenKeys = new Set<string>(), selectedKeys = new Set<string>();
  for await (const book of tableRows(database, 'books')) {
    const keys = [String(book.id), ...(typeof book.sourceId === 'string' && typeof book.comicId === 'string' ? [`${book.sourceId}::${book.comicId}`] : [])];
    if (!selection.protectedAuthorized && protectedNames.has(book.category as string)) { for (const key of keys) hiddenKeys.add(key); continue; }
    selectedBooks.set(book.id as number, book); for (const key of keys) selectedKeys.add(key);
  }
  const identities = new Map((await database.query<{ localKey: string; stableId: string }>("SELECT localKey,stableId FROM transfer_identities WHERE localKey LIKE 'books:%'")).map((row) => [row.localKey, row.stableId]));
  const bodies = new Map<number, { identity: string; version: string }>(), index = new TransferChapterIndex(database, stageId), needsParents = ['ANNOTATIONS', 'HISTORY', 'SETTINGS'].some((category) => categories.has(category as TransferCategory));
  const inspector = new PortableRowsInspector(), fingerprint = new BookContentFingerprint((path) => resources.hash(path));
  let containsProtected = false, containsProtectedFavorites = false, buffer = '';
  const flush = async () => { if (buffer) { await write(buffer, false); buffer = ''; } };
  await index.initialize();
  try {
    if (categories.has('BOOKS') || needsParents) for (const [id, book] of selectedBooks) {
      requireTransfer(!signal?.aborted, '导出已取消');
      const body = await index.addBook('local', book, localBookChapters(database, id), fingerprint, '', signal, resources.normalizeBody?.bind(resources));
      const online = typeof book.sourceId === 'string' && typeof book.comicId === 'string';
      const identity = identities.get(`books:${id}`) ?? (online ? portableOnlineIdentity(book.sourceId as string, book.comicId as string) : await resources.original(book) ?? await resources.directoryIdentity(book) ?? body.rawIdentity);
      bodies.set(id, { identity, version: body.version });
    }
    await write(JSON.stringify(PORTABLE_ROWS_HEADER) + '\n', true);
    for (const table of BACKUP_TABLES) {
      const parent = !categories.has('BOOKS') && ['books', 'chapters', 'categories'].includes(table);
      if (!categories.has(PORTABLE_TABLE_CATEGORY[table]!) && !(parent && needsParents)) continue;
      if (['favorites', 'favorite_categories', 'comic_progress', 'comic_chapter_read'].includes(table) && !mayFavorites) continue;
      for await (const original of tableRows(database, table)) {
        requireTransfer(!signal?.aborted, '导出已取消'); let row = { ...original };
        if (table === 'books' && !selectedBooks.has(row.id as number)) continue;
        if (['chapters', 'bookmarks', 'highlights', 'reading_records', 'reading_sessions'].includes(table) && row.bookId !== null && !selectedBooks.has(row.bookId as number)) continue;
        if (['reading_records', 'reading_sessions'].includes(table) && row.bookId === null && !mayFavorites) continue;
        if (table === 'categories' && protectedNames.has(row.name as string) && !selection.protectedAuthorized) continue;
        if (table === 'god_moments') {
          const key = row.bookId as string;
          if (hiddenKeys.has(key) || /^-?\d+$/.test(key) && !selectedBooks.has(Number(key)) || key.includes('::') && !mayFavorites) continue;
          if (key.includes('::') && favoritesProtected) { containsProtected = true; containsProtectedFavorites = true; }
        }
        if (table === 'books' && protectedNames.has(row.category as string) || table === 'categories' && row.isProtected !== 0) containsProtected = true;
        if (favoritesProtected && ['favorites', 'comic_progress', 'comic_chapter_read'].includes(table)) { containsProtected = true; containsProtectedFavorites = true; }
        if (table === 'books' && !categories.has('HISTORY')) { row.currentChapterIndex = 0; row.scrollOffset = 0; row.lastReadTime = 0; row.isFinished = 0; }
        if (parent && table === 'books') { row.filePath = ''; row.coverUri = null; }
        if (parent && table === 'chapters') row.content = '';
        if (!parent) {
          row = await resources.exportRow(row);
          if (table === 'chapters') row.content = await resources.exportBody(row.content as string, selectedBooks.get(row.bookId as number)!.contentType as string);
        }
        const metadata = table === 'books' ? bodies.get(row.id as number)! : undefined;
        const envelope: PortableEnvelope = { table, row, ...(metadata ? { identity: metadata.identity, bodyVersion: metadata.version, parentOnly: parent } : {}) };
        const text = JSON.stringify(envelope); inspector.add(parsePortableRow(text));
        if (buffer.length + text.length > 256 * 1024) await flush(); buffer += text + '\n';
        if (buffer.length >= 256 * 1024) await flush();
      }
    }
    await flush(); inspector.finish();
    return { counts: inspector.counts, selectedBookKeys: selectedKeys, containsProtected, protectedFavorites: containsProtectedFavorites };
  } finally { await index.dispose(); }
}

export async function* tableRows(database: SqliteExecutor, table: string): AsyncGenerator<PortableRow> {
  requireTransfer(BACKUP_TABLES.includes(table), '导出数据表无效'); let cursor: number | null = null;
  const lengths = TABLES.find((definition) => definition.name === table)!.columns.filter((column) => column.type === 'TEXT').map((column) => `COALESCE(length(CAST("${column.name}" AS BLOB)),0)`);
  const size = lengths.length ? lengths.join('+') : '0';
  while (true) {
    const metadata: { id: number; bytes: number }[] = await database.query(`SELECT rowid AS id,(${size}) AS bytes FROM "${table}" WHERE (? IS NULL OR rowid>?) ORDER BY rowid LIMIT 128`, [cursor, cursor]);
    if (!metadata.length) return;
    const selected = boundedTransferBatch(metadata, 6);
    requireTransfer(selected.every((row) => Number.isSafeInteger(row.id)), '本机数据行编号无效');
    const rows: PortableRow[] = await database.query(`SELECT rowid AS _transferRowid,* FROM "${table}" WHERE rowid IN (${selected.map(() => '?').join(',')}) ORDER BY rowid`, selected.map((row) => row.id));
    requireTransfer(rows.length === selected.length, '本机数据在导出时发生变化');
    for (const value of rows) { cursor = value._transferRowid as number; const row = { ...value }; delete row._transferRowid; yield row; }
  }
}

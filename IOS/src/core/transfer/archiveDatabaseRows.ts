import { TABLES } from '@core/db/schemaV13';
import { requireTransfer } from './transferWire';
import type { PortableEnvelope, PortableRow } from './portableFormat';
import type { SqliteExecutor } from '@platform/interfaces';

export type ImportRowOutcome = 'added' | 'merged' | 'skipped';
const definitions = new Map(TABLES.map((table) => [table.name, table]));
export class ArchiveDatabaseRows {
  constructor(readonly database: SqliteExecutor) {}
  private columns(table: string, names: readonly string[]): void {
    const definition = definitions.get(table); requireTransfer(definition && names.length > 0 && names.every((name) => definition.columns.some((column) => column.name === name)), '导入数据库字段无效');
  }
  async find(table: string, columns: readonly string[], values: (string | number | null)[]): Promise<PortableRow | null> {
    this.columns(table, columns); requireTransfer(columns.length === values.length, '导入查询参数无效');
    return (await this.database.query<PortableRow>(`SELECT * FROM "${table}" WHERE ${columns.map((column) => `"${column}" IS ?`).join(' AND ')} LIMIT 1`, values))[0] ?? null;
  }
  async insert(table: string, row: PortableRow, replace = false): Promise<number> {
    const columns = Object.keys(row); this.columns(table, columns);
    const result = await this.database.execute(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map((column) => row[column]!));
    if (result.lastInsertRowId !== undefined) return result.lastInsertRowId;
    const inserted = (await this.database.query<{ id: number }>('SELECT last_insert_rowid() AS id'))[0]?.id;
    requireTransfer(typeof inserted === 'number' && Number.isSafeInteger(inserted), '导入主键未返回'); return inserted;
  }
}

/** Non-book rows are visited after the content-aware book/chapter mapping has
 * completed. Never reuse sender auto-increment ids in the receiver database. */
export class RelatedArchiveRows {
  constructor(private readonly rows: ArchiveDatabaseRows, private readonly books: ReadonlyMap<number, number>, private readonly chapters: ReadonlyMap<number, number>, private readonly bookTitles: ReadonlyMap<number, string>) {}
  async merge(envelope: PortableEnvelope): Promise<ImportRowOutcome> {
    const { table } = envelope, row = { ...envelope.row }, database = this.rows.database;
    if (['bookmarks', 'highlights', 'reading_sessions'].includes(table) && row.bookId !== null) {
      const mapped = this.books.get(row.bookId as number); if (mapped === undefined) return 'skipped'; row.bookId = mapped;
      if (table === 'reading_sessions' && this.bookTitles.has(mapped)) row.bookTitle = this.bookTitles.get(mapped)!;
    }
    if (table === 'categories') {
      const existing = await this.rows.find(table, ['name'], [row.name!]); delete row.id;
      if (!existing) { await this.rows.insert(table, row); return 'added'; }
      if (row.isProtected !== 0) await database.execute('UPDATE categories SET isProtected=1 WHERE id=?', [existing.id!]); return 'merged';
    }
    if (table === 'favorite_categories') {
      if (await this.rows.find(table, ['name'], [row.name!])) return 'skipped'; await this.rows.insert(table, row); return 'added';
    }
    if (['favorites', 'comic_progress', 'comic_chapter_read'].includes(table)) {
      const keys = table === 'comic_chapter_read' ? ['sourceId', 'comicId', 'chapterId'] : ['sourceId', 'comicId'];
      const existing = await this.rows.find(table, keys, keys.map((key) => row[key]!));
      const timestamp = table === 'comic_progress' ? 'lastReadAt' : table === 'comic_chapter_read' ? 'updatedAt' : null;
      if (existing && (!timestamp || (row[timestamp] as number) <= (existing[timestamp] as number))) return 'skipped';
      await this.rows.insert(table, row, true); return existing ? 'merged' : 'added';
    }
    if (table === 'bookmarks' || table === 'highlights') {
      delete row.id;
      const keys = table === 'bookmarks' ? ['bookId', 'chapterIndex'] : ['bookId', 'chapterIndex', 'selectedText', 'note', 'colorHex'];
      const existing = await this.rows.find(table, keys, keys.map((key) => row[key]!));
      if (!existing) { await this.rows.insert(table, row); return 'added'; }
      if (table === 'bookmarks' && (row.createdTime as number) > (existing.createdTime as number)) { row.id = existing.id!; await this.rows.insert(table, row, true); return 'merged'; }
      return 'skipped';
    }
    if (table === 'god_moments') {
      if (/^-?\d+$/.test(row.bookId as string)) {
        const mapped = this.books.get(Number(row.bookId)); if (mapped === undefined) return 'skipped'; row.bookId = String(mapped);
        if (/^-?\d+$/.test(row.chapterId as string)) { const chapter = this.chapters.get(Number(row.chapterId)); if (chapter !== undefined) row.chapterId = String(chapter); }
      }
      const existing = await this.rows.find(table, ['bookId', 'chapterId'], [row.bookId!, row.chapterId!]);
      if (existing && (row.updatedAt as number) <= (existing.updatedAt as number)) return 'skipped';
      delete row.id; if (existing) row.id = existing.id!; await this.rows.insert(table, row, true); return existing ? 'merged' : 'added';
    }
    requireTransfer(table === 'reading_sessions', '当前数据表需要专用的书籍或统计导入器');
    const keys = row.bookId === null ? ['bookId', 'bookTitle', 'startTimeMs'] : ['bookId', 'startTimeMs'];
    const existing = await this.rows.find(table, keys, keys.map((key) => row[key]!));
    if (existing && (row.endTimeMs as number) <= (existing.endTimeMs as number)) return 'skipped';
    delete row.id; if (existing) row.id = existing.id!; await this.rows.insert(table, row, true); return existing ? 'merged' : 'added';
  }
}

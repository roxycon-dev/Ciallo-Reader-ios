import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { createTableSql, TRANSFER_JOURNAL_TABLES } from '@core/db/schemaV13';
import { ArchiveBookImporter } from '@core/transfer/archiveBookImporter';
import { ArchiveDatabaseRows } from '@core/transfer/archiveDatabaseRows';
import { ArchiveResources } from '@core/transfer/archiveResources';
import { BookContentFingerprint } from '@core/transfer/bookFingerprint';
import { TransferChapterIndex } from '@core/transfer/chapterIndex';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import { portableChapterVersion, type PortableEnvelope, type PortableRow, type TransferCategory } from '@core/transfer/portableFormat';
const databases: MemorySqlite[] = [], stage = '01234567-89ab-cdef-0123-456789abcdef';
const base: PortableRow = { id: 1, title: '同名小说', author: '作者', filePath: '', coverUri: null, category: '默认', currentChapterIndex: 4, scrollOffset: 10, isFinished: 0, totalChapters: 2, contentType: 'NOVEL', addedTime: 1, lastReadTime: 100, sourceId: null, comicId: null };
const book = (id: number, values: PortableRow = {}): PortableEnvelope => ({ table: 'books', row: { ...base, ...values, id } });
const chapter = (id: number, bookId: number, chapterOrder: number, content: string): PortableEnvelope => ({ table: 'chapters', row: { id, bookId, chapterOrder, title: `第${chapterOrder}章`, content, startCharIndex: 0, endCharIndex: content.length } });
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function setup(input: PortableEnvelope[], categories: TransferCategory[] = ['BOOKS', 'HISTORY']) {
  const db = createV12Database(); databases.push(db); for (const table of TRANSFER_JOURNAL_TABLES) db.exec(createTableSql(table));
  const writer = new ArchiveDatabaseRows(db), staging = new TransferStagingRows(db, stage);
  async function* source() { yield* input; } await staging.build(source());
  const index = new TransferChapterIndex(db, stage); await index.initialize();
  const importer = new ArchiveBookImporter(writer, { mode: 'MERGE', categories, resources: new ArchiveResources(new Map(), 'restored/files'), index, staging, localFingerprint: new BookContentFingerprint(async () => null), localOriginal: async () => null });
  async function run() { await importer.initialize(); for await (const envelope of staging.table('books')) await importer.book(envelope); for await (const envelope of staging.table('chapters')) await importer.chapter(envelope); }
  return { db, writer, importer, run };
}
describe('real SQLite archive book and chapter import', () => {
  it('matches renamed books by body, allocates receiver ids, and retains newer receiver progress', async () => {
    const { db, writer, importer, run } = await setup([book(1), chapter(1, 1, 0, '相同正文'), chapter(2, 1, 1, '结尾')]);
    await writer.insert('books', { ...base, id: 50, title: '接收端改名', lastReadTime: 200, currentChapterIndex: 1 });
    await writer.insert('chapters', { ...chapter(90, 50, 0, '相同正文').row }); await writer.insert('chapters', chapter(91, 50, 1, '结尾').row);
    await run(); expect(importer.books.get(1)).toBe(50); expect(importer.chapters.get(1)).toBe(90);
    expect(await db.query('SELECT id,title,currentChapterIndex,lastReadTime FROM books')).toEqual([{ id: 50, title: '接收端改名', currentChapterIndex: 1, lastReadTime: 200 }]); expect(await db.query('SELECT * FROM chapters')).toHaveLength(2);
  });
  it('keeps conflicting editions separate even when title and exported stable identity agree', async () => {
    const envelope = { ...book(1), identity: `body:${'a'.repeat(64)}` };
    const { db, writer, importer, run } = await setup([envelope, chapter(1, 1, 0, '不同版本')]);
    await writer.insert('books', { ...base, id: 50 }); await writer.insert('chapters', chapter(90, 50, 0, '本机版本').row);
    await db.execute('INSERT INTO transfer_identities VALUES (?,?)', ['books:50', envelope.identity]);
    await run(); expect(importer.books.get(1)).not.toBe(50); expect(await db.query('SELECT * FROM books')).toHaveLength(2);
  });
  it('fills missing chapters and applies newer progress only when history was selected', async () => {
    for (const withHistory of [true, false]) {
      const source = { ...book(1), identity: `file:${'b'.repeat(64)}` };
      const { db, writer, importer, run } = await setup([source, chapter(1, 1, 0, '正文'), chapter(2, 1, 1, '续章')], withHistory ? ['BOOKS', 'HISTORY'] : ['BOOKS']);
      await writer.insert('books', { ...base, id: 50, lastReadTime: 10, currentChapterIndex: 0 });
      await writer.insert('chapters', chapter(90, 50, 0, '正文').row); await writer.insert('chapters', chapter(91, 50, 1, '').row);
      await db.execute('INSERT INTO transfer_identities VALUES (?,?)', ['books:50', source.identity]); await run();
      expect(importer.chapters.get(2)).toBe(91); expect((await db.query<{ content: string }>('SELECT content FROM chapters WHERE id=91'))[0]!.content).toBe('续章');
      expect((await db.query<{ lastReadTime: number }>('SELECT lastReadTime FROM books WHERE id=50'))[0]!.lastReadTime).toBe(withHistory ? 100 : 10);
    }
  });
  it('skips parent-only annotations when the receiver has a different chapter version', async () => {
    const envelope = { ...book(1), identity: `body:${'c'.repeat(64)}`, parentOnly: true, bodyVersion: portableChapterVersion([{ chapterOrder: 0, title: '第0章', content: '发送端版本' }]) };
    const { db, writer, importer, run } = await setup([envelope], ['ANNOTATIONS']);
    await writer.insert('books', { ...base, id: 50 }); await writer.insert('chapters', chapter(90, 50, 0, '不同版本').row);
    await db.execute('INSERT INTO transfer_identities VALUES (?,?)', ['books:50', envelope.identity]); await run();
    expect(importer.books.size).toBe(0); expect(importer.warnings[0]).toContain('对应版本'); expect(await db.query('SELECT * FROM books')).toHaveLength(1);
  });
  it('checks all prior accepted incoming bodies before combining three partial copies', async () => {
    const identity = `file:${'d'.repeat(64)}`;
    const { db, importer, run } = await setup([
      { ...book(1), identity }, { ...book(2), identity }, { ...book(3), identity },
      chapter(10, 1, 0, '开头'), chapter(20, 2, 0, '开头'), chapter(21, 2, 1, '中间甲'), chapter(31, 3, 1, '中间乙'),
    ]);
    await run(); expect(importer.books.get(1)).toBe(importer.books.get(2)); expect(importer.books.get(3)).not.toBe(importer.books.get(1)); expect(await db.query('SELECT * FROM books')).toHaveLength(2);
  });
  it('preserves the source boundary for online books and upgrades merged privacy categories', async () => {
    const source = { ...book(1, { sourceId: 'a', comicId: 'comic', category: '保护' }) };
    const { db, writer, importer, run } = await setup([source]);
    await writer.insert('categories', { id: 1, name: '保护', isProtected: 1 });
    await writer.insert('books', { ...base, id: 50, sourceId: 'a', comicId: 'comic' }); await writer.insert('books', { ...base, id: 51, sourceId: 'b', comicId: 'comic' });
    await run(); expect(importer.books.get(1)).toBe(50);
    expect(await db.query('SELECT id,category FROM books ORDER BY id')).toEqual([{ id: 50, category: '保护' }, { id: 51, category: '默认' }]);
  });
});

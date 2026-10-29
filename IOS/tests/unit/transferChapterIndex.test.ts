import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { TransferChapterIndex, localBookChapters } from '@core/transfer/chapterIndex';
import { BookContentFingerprint, portableRawBodyIdentity } from '@core/transfer/bookFingerprint';
import { portableChapterVersion, type PortableChapterBody } from '@core/transfer/portableFormat';
import { ArchiveDatabaseRows } from '@core/transfer/archiveDatabaseRows';
import { TransferStagingRows } from '@core/transfer/stagingRows';
const databases: MemorySqlite[] = [], id = '01234567-89ab-cdef-0123-456789abcdef';
const book = { id: 1, title: '书籍', author: '作者', filePath: '', coverUri: null, category: '默认', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 2, contentType: 'NOVEL', addedTime: 0, lastReadTime: 0, sourceId: null, comicId: null };
async function* chapters(values: PortableChapterBody[]) { yield* values; }
const chapter = (order: number, content: string) => ({ chapterOrder: order, title: `第${order}章`, content });
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function setup() { const db = createV12Database(); databases.push(db); const index = new TransferChapterIndex(db, id); await index.initialize(); return { db, index, fingerprint: new BookContentFingerprint(async () => 'a'.repeat(64)) }; }
describe('disk-backed transfer chapter identity and compatible editions', () => {
  it('matches streaming resource-aware/raw/version identities without retaining chapter bodies', async () => {
    const { index, fingerprint } = await setup(), values = [chapter(0, '正文[IMG:/sender/image.png]'), chapter(1, '结尾')];
    const result = await index.addBook('incoming', book, chapters(values), fingerprint, '/sender');
    expect(result.contentIdentity).toBe(await fingerprint.book(values, 'NOVEL'));
    expect(result.rawIdentity).toBe(portableRawBodyIdentity(book, values, '/sender'));
    expect(result.version).toBe(portableChapterVersion(values)); expect(result.chapters).toBe(2);
    await index.dispose();
  });
  it('allows complementary downloaded chapters, rejects a conflicting edition, and isolates sender/local numeric ids', async () => {
    const { index, fingerprint } = await setup();
    await index.addBook('incoming', book, chapters([chapter(0, '正文'), chapter(1, '')]), fingerprint);
    await index.addBook('local', book, chapters([chapter(0, '正文'), chapter(1, '续章')]), fingerprint);
    expect(await index.compatible({ side: 'incoming', id: 1 }, { side: 'local', id: 1 })).toBe(true);
    await index.addBook('incoming', { ...book, id: 2 }, chapters([chapter(0, '另一个版本')]), fingerprint);
    expect(await index.compatible({ side: 'incoming', id: 2 }, { side: 'local', id: 1 })).toBe(false);
    expect(await index.compatible({ side: 'incoming', id: 2 }, { side: 'incoming', id: 1 })).toBe(false);
  });
  it('cleans cancelled or duplicate-order partial indices and allows retry', async () => {
    const { db, index, fingerprint } = await setup(), controller = new AbortController();
    async function* cancelled() { yield chapter(0, '正文'); controller.abort(); yield chapter(1, '尾声'); }
    await expect(index.addBook('incoming', book, cancelled(), fingerprint, '', controller.signal)).rejects.toThrow('取消');
    expect(await db.query(`SELECT * FROM "_ciallo_chapters_${id.replace(/-/g, '')}"`)).toEqual([]);
    await expect(index.addBook('incoming', book, chapters([chapter(0, '甲'), chapter(0, '乙')]), fingerprint)).rejects.toThrow('重复');
    await expect(index.addBook('incoming', book, chapters([chapter(0, '成功重试')]), fingerprint)).resolves.toMatchObject({ chapters: 1 });
  });
  it('reads both existing and unsorted archive chapters in bounded sorted batches', async () => {
    const { db } = await setup(), writer = new ArchiveDatabaseRows(db);
    const values = [chapter(20, '尾声'), chapter(-1, '序言'), chapter(3, '中间')];
    for (const row of values) await writer.insert('chapters', { id: row.chapterOrder + 100, bookId: 1, ...row, startCharIndex: 0, endCharIndex: row.content.length });
    const local: PortableChapterBody[] = []; for await (const row of localBookChapters(db, 1)) local.push(row);
    expect(local.map((row) => row.chapterOrder)).toEqual([-1, 3, 20]);
    const staging = new TransferStagingRows(db, id);
    async function* source() { yield { table: 'books', row: book }; for (const row of values) yield { table: 'chapters', row: { id: row.chapterOrder + 100, bookId: 1, ...row, startCharIndex: 0, endCharIndex: row.content.length } }; }
    await staging.build(source()); const ordered: number[] = []; for await (const row of staging.chapters(1)) ordered.push(row.row.chapterOrder as number);
    expect(ordered).toEqual([-1, 3, 20]); await staging.dispose();
  });
});

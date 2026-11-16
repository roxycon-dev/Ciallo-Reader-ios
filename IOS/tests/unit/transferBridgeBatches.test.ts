import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import type { DatabaseLike } from '@core/library/bookRepository';
import { ArchiveDatabaseRows } from '@core/transfer/archiveDatabaseRows';
import { tableRows } from '@core/transfer/archiveExporter';
import { localBookChapters } from '@core/transfer/chapterIndex';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import type { PortableEnvelope } from '@core/transfer/portableFormat';
const databases: MemorySqlite[] = [], id = '01234567-89ab-cdef-0123-456789abcdef';
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const book = { id: 1, title: '分批测试', author: '', filePath: '', coverUri: null, category: '默认', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 600, contentType: 'NOVEL', addedTime: 0, lastReadTime: 0, sourceId: null, comicId: null };
async function setup() {
  const database = createV12Database(); databases.push(database); const fullReads: string[] = [];
  const db: DatabaseLike = { execute: (sql, values) => database.execute(sql, values), query: async <T>(sql: string, values?: (string | number | null)[]) => {
    const rows = await database.query<T>(sql, values);
    expect(new TextEncoder().encode(JSON.stringify(rows)).length).toBeLessThan(2 * 1024 * 1024);
    if (sql.startsWith('SELECT id,chapterOrder,title,content') || sql.startsWith('SELECT chapterOrder,ordinal,envelope') || sql.startsWith('SELECT rowid AS _transferRowid')) fullReads.push(sql);
    return rows;
  } };
  return { database, db, writer: new ArchiveDatabaseRows(db), fullReads };
}
describe('bounded SQLite bridge paging for large portable libraries', () => {
  it('moves 600 small chapters in full batches while retaining every ordered row', async () => {
    const fixture = await setup(); await fixture.writer.insert('books', book);
    for (let order = 599; order >= 0; order--) await fixture.writer.insert('chapters', { id: order + 1, bookId: 1, chapterOrder: order, title: `章${order}`, content: '正文'.repeat(20), startCharIndex: 0, endCharIndex: 40 });
    const local: number[] = []; for await (const row of localBookChapters(fixture.db, 1)) local.push(row.chapterOrder);
    expect(local).toEqual(Array.from({ length: 600 }, (_, order) => order)); expect(fixture.fullReads.length).toBeLessThan(10);
    fixture.fullReads.length = 0; const exported: number[] = []; for await (const row of tableRows(fixture.db, 'chapters')) exported.push(row.id as number);
    expect(exported).toHaveLength(600); expect(fixture.fullReads.length).toBeLessThan(10);
    async function* source(): AsyncGenerator<PortableEnvelope> { yield { table: 'books', row: book }; for await (const row of tableRows(fixture.db, 'chapters')) yield { table: 'chapters', row }; }
    const staging = new TransferStagingRows(fixture.db, id); await staging.build(source()); fixture.fullReads.length = 0;
    const incoming: number[] = []; for await (const { row } of staging.chapters(1)) incoming.push(row.chapterOrder as number);
    expect(incoming).toEqual(local); expect(fixture.fullReads.length).toBeLessThan(10); await staging.dispose();
  });
  it('reduces each batch to one large Unicode chapter without truncating its bytes', async () => {
    const fixture = await setup(), body = '文'.repeat(240000); await fixture.writer.insert('books', book);
    for (let order = 0; order < 4; order++) await fixture.writer.insert('chapters', { id: order + 1, bookId: 1, chapterOrder: order, title: `章${order}`, content: body, startCharIndex: 0, endCharIndex: body.length });
    let count = 0; for await (const chapter of localBookChapters(fixture.db, 1)) { expect(chapter.content).toBe(body); count++; }
    expect(count).toBe(4); expect(fixture.fullReads).toHaveLength(4);
  });
  it('rejects an oversized legacy body using metadata before it crosses the native bridge', async () => {
    const fixture = await setup(); await fixture.writer.insert('chapters', { id: 1, bookId: 1, chapterOrder: 0, title: '超大旧章节', content: 'x'.repeat(2 * 1024 * 1024 + 1), startCharIndex: 0, endCharIndex: 1 });
    const read = async () => { for await (const chapter of localBookChapters(fixture.db, 1)) void chapter; };
    await expect(read()).rejects.toThrow('大小限制'); expect(fixture.fullReads).toEqual([]);
  });
});

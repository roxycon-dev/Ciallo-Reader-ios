import { afterEach, describe, expect, it } from 'vitest';
import { MemorySqlite } from '../port/data/support/androidSqlite';
import { TransferStagingRows } from '@core/transfer/stagingRows';
import type { PortableEnvelope } from '@core/transfer/portableFormat';
import type { DatabaseLike } from '@core/library/bookRepository';

const id = '01234567-89ab-cdef-0123-456789abcdef', databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const book = { id: 1, title: '大书', author: '作者', filePath: '', coverUri: null, category: '默认', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 40, contentType: 'NOVEL', addedTime: 0, lastReadTime: 0, sourceId: null, comicId: null };
async function* rows(count: number): AsyncGenerator<PortableEnvelope> {
  yield { table: 'books', row: book };
  for (let index = 0; index < count; index++) yield { table: 'chapters', row: { id: index + 1, bookId: 1, chapterOrder: index, title: `第${index}章`, content: '文'.repeat(40000), startCharIndex: 0, endCharIndex: 40000 } };
}
describe('disk-backed transfer row staging on real SQLite', () => {
  it('visits dependent tables in order with bounded bridge batches and removes private staged text', async () => {
    const db = MemorySqlite.open(); databases.push(db); let batches = 0;
    const wrapped: DatabaseLike = {
      execute: (sql, params) => db.execute(sql, params),
      query: async <T>(sql: string, params?: (string | number | null)[]) => {
        const values = await db.query<T>(sql, params);
        if (sql.startsWith('SELECT ordinal,envelope')) {
          batches++;
          const bytes = (values as { envelope: string }[]).reduce((sum, row) => sum + new TextEncoder().encode(row.envelope).length, 0);
          expect(bytes).toBeLessThan(2 * 1024 * 1024);
        }
        return values;
      },
    };
    const staged = new TransferStagingRows(wrapped, id); await staged.build(rows(40));
    const order: number[] = []; for await (const chapter of staged.table('chapters')) order.push(chapter.row.chapterOrder as number);
    expect(order).toEqual(Array.from({ length: 40 }, (_, index) => index)); expect(batches).toBeGreaterThan(1);
    const books: PortableEnvelope[] = []; for await (const row of staged.table('books')) books.push(row); expect(books).toEqual([{ table: 'books', row: book }]);
    await staged.dispose(); expect(await db.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '_ciallo_transfer_%'")).toEqual([]);
  });
  it('drops the spool on cancellation before any permanent table can be changed', async () => {
    const db = MemorySqlite.open(); databases.push(db); const signal = new AbortController();
    async function* cancelled() { yield { table: 'books', row: book }; signal.abort(); yield { table: 'books', row: { ...book, id: 2 } }; }
    const staged = new TransferStagingRows(db, id); await expect(staged.build(cancelled(), undefined, signal.signal)).rejects.toThrow('取消');
    expect(await db.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '_ciallo_transfer_%'")).toEqual([]);
    expect(await db.query("SELECT name FROM sqlite_master WHERE type='table'")).toEqual([]);
  });
});

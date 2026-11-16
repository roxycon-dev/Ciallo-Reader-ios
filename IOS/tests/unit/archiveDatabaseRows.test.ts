import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { TABLES } from '@core/db/schemaV13';
import { ArchiveDatabaseRows, RelatedArchiveRows } from '@core/transfer/archiveDatabaseRows';
import type { PortableRow } from '@core/transfer/portableFormat';

const databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function row(table: string, values: PortableRow): PortableRow {
  return { ...Object.fromEntries(TABLES.find((definition) => definition.name === table)!.columns.map((column) => [column.name, !column.notNull ? null : column.type === 'TEXT' ? '' : 0])), ...values };
}
function setup() {
  const db = createV12Database(); databases.push(db); const writer = new ArchiveDatabaseRows(db);
  return { db, writer, related: new RelatedArchiveRows(writer, new Map([[9, 90]]), new Map([[5, 50]]), new Map([[90, '本机书名']])) };
}
describe('portable dependent row merge on real SQLite', () => {
  it('allocates receiver category ids and never weakens existing protection', async () => {
    const { db, writer, related } = setup(); await writer.insert('categories', { id: 5, name: '共享', isProtected: 1 });
    expect(await related.merge({ table: 'categories', row: { id: 5, name: '新分类', isProtected: 0 } })).toBe('added');
    expect(await related.merge({ table: 'categories', row: { id: 100, name: '共享', isProtected: 0 } })).toBe('merged');
    expect(await db.query('SELECT id,name,isProtected FROM categories ORDER BY id')).toEqual([{ id: 5, name: '共享', isProtected: 1 }, { id: 6, name: '新分类', isProtected: 0 }]);
  });
  it('keeps favorite identities scoped to their source and treats SQL punctuation as data', async () => {
    const { db, related } = setup(), comicId = '1"; DROP TABLE favorites; --';
    for (const sourceId of ['source-a', 'source-b']) expect(await related.merge({ table: 'favorites', row: row('favorites', { sourceId, comicId, title: sourceId }) })).toBe('added');
    expect(await related.merge({ table: 'favorites', row: row('favorites', { sourceId: 'source-a', comicId, title: '较旧标题' }) })).toBe('skipped');
    expect(await db.query('SELECT sourceId,title FROM favorites ORDER BY sourceId')).toEqual([{ sourceId: 'source-a', title: 'source-a' }, { sourceId: 'source-b', title: 'source-b' }]);
  });
  it('updates comic progress/chapter bookmarks only when the incoming timestamp is newer', async () => {
    const { db, related } = setup();
    const progress = row('comic_progress', { sourceId: 'source', comicId: 'comic', lastReadAt: 100, lastPageIndex: 4 });
    expect(await related.merge({ table: 'comic_progress', row: progress })).toBe('added'); expect(await related.merge({ table: 'comic_progress', row: { ...progress, lastReadAt: 90, lastPageIndex: 1 } })).toBe('skipped');
    expect(await related.merge({ table: 'comic_progress', row: { ...progress, lastReadAt: 110, lastPageIndex: 8 } })).toBe('merged');
    const chapter = row('comic_chapter_read', { sourceId: 'source', comicId: 'comic', chapterId: 'chapter', updatedAt: 100, bookmarked: 1 });
    await related.merge({ table: 'comic_chapter_read', row: chapter }); await related.merge({ table: 'comic_chapter_read', row: { ...chapter, updatedAt: 90, bookmarked: 0 } });
    expect(await db.query('SELECT lastPageIndex FROM comic_progress')).toEqual([{ lastPageIndex: 8 }]); expect(await db.query('SELECT bookmarked FROM comic_chapter_read')).toEqual([{ bookmarked: 1 }]);
  });
  it('remaps parents, preserves unrelated receiver bookmarks, and deduplicates highlights by annotation content', async () => {
    const { db, writer, related } = setup(); await writer.insert('bookmarks', row('bookmarks', { id: 1, bookId: 999, chapterIndex: 0, title: '本机原有', createdTime: 1 }));
    const bookmark = row('bookmarks', { id: 1, bookId: 9, chapterIndex: 2, title: '传入书签', createdTime: 10 });
    expect(await related.merge({ table: 'bookmarks', row: bookmark })).toBe('added'); expect(await related.merge({ table: 'bookmarks', row: { ...bookmark, title: '更新书签', createdTime: 20 } })).toBe('merged');
    expect(await db.query('SELECT bookId,title FROM bookmarks ORDER BY id')).toEqual([{ bookId: 999, title: '本机原有' }, { bookId: 90, title: '更新书签' }]);
    const highlight = row('highlights', { id: 1, bookId: 9, chapterIndex: 2, selectedText: '正文', colorHex: '#ffee00', note: '标注' });
    expect(await related.merge({ table: 'highlights', row: highlight })).toBe('added'); expect(await related.merge({ table: 'highlights', row: { ...highlight, createdTime: 99 } })).toBe('skipped');
    expect(await related.merge({ table: 'highlights', row: { ...highlight, note: '另一条笔记' } })).toBe('added'); expect(await db.query('SELECT * FROM highlights')).toHaveLength(2);
    expect(await related.merge({ table: 'bookmarks', row: { ...bookmark, bookId: 12345 } })).toBe('skipped');
  });
  it('remaps local god-moment chapter ids without changing numeric ids belonging to an online source', async () => {
    const { db, related } = setup();
    await related.merge({ table: 'god_moments', row: row('god_moments', { id: 1, contentType: 'NOVEL', bookId: '9', chapterId: '5', updatedAt: 10 }) });
    await related.merge({ table: 'god_moments', row: row('god_moments', { id: 1, contentType: 'COMIC', bookId: 'source::comic', chapterId: '5', updatedAt: 10 }) });
    expect(await db.query('SELECT bookId,chapterId FROM god_moments ORDER BY id')).toEqual([{ bookId: '90', chapterId: '50' }, { bookId: 'source::comic', chapterId: '5' }]);
  });
  it('deduplicates renamed local reading sessions by book identity and keeps distinct online titles', async () => {
    const { db, writer, related } = setup(); await writer.insert('reading_sessions', row('reading_sessions', { id: 1, bookId: 90, bookTitle: '旧书名', startTimeMs: 1000, endTimeMs: 10000, durationSeconds: 9 }));
    const session = row('reading_sessions', { id: 1, bookId: 9, bookTitle: '发送端改名', startTimeMs: 1000, endTimeMs: 11000, durationSeconds: 10 });
    expect(await related.merge({ table: 'reading_sessions', row: session })).toBe('merged'); expect(await db.query('SELECT bookId,bookTitle,durationSeconds FROM reading_sessions')).toEqual([{ bookId: 90, bookTitle: '本机书名', durationSeconds: 10 }]);
    await related.merge({ table: 'reading_sessions', row: { ...session, bookId: null, bookTitle: '在线甲' } }); await related.merge({ table: 'reading_sessions', row: { ...session, bookId: null, bookTitle: '在线乙' } });
    expect(await db.query('SELECT * FROM reading_sessions')).toHaveLength(3);
  });
});

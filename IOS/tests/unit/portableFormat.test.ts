import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parsePortableManifest, parsePortableRow, parsePortableRowsHeader, PortableRowsInspector, portableChapterVersion, portableEntryPath, portableOnlineIdentity } from '@core/transfer/portableFormat';

const packageId = '01234567-89ab-cdef-0123-456789abcdef';
const book = { id: 1, title: '迁移测试', author: '作者', filePath: '@FILES@/imports/书.epub', coverUri: null, category: '默认', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 1, contentType: 'NOVEL', addedTime: 123, lastReadTime: 456, sourceId: null, comicId: null };
const chapter = { id: 4, bookId: 1, chapterOrder: 0, title: '正文', content: '图片[IMG:@FILES@/epub_images/插图.png]正文', startCharIndex: 0, endCharIndex: 44 };
function manifest() {
  return { format: 'ciallo-transfer', version: 2, schema: 13, packageId, createdAt: 123456, categories: ['BOOKS'], counts: { books: 1, chapters: 1 }, expandedBytes: 20,
    entries: [{ path: 'database.rows', size: 10, sha256: 'a'.repeat(64) }, { path: 'settings.json', size: 10, sha256: 'b'.repeat(64) }], warnings: [], containsProtected: false, protectedFavorites: false };
}
describe('portable v2 format shared with current Android', () => {
  it('validates a real-shaped book and chapter with Unicode paths and checks their manifest counts', () => {
    parsePortableRowsHeader('{"version":2,"schema":13}'); parsePortableRowsHeader('{"version":1,"schema":12}');
    const inspection = new PortableRowsInspector();
    inspection.add(parsePortableRow(JSON.stringify({ table: 'books', row: book, identity: 'file:' + 'a'.repeat(64), bodyVersion: 'b'.repeat(64), parentOnly: false })));
    inspection.add(parsePortableRow(JSON.stringify({ table: 'chapters', row: chapter })));
    expect(() => inspection.finish(parsePortableManifest(JSON.stringify(manifest())))).not.toThrow();
    expect(inspection.counts).toEqual({ books: 1, chapters: 1 });
  });
  it.each(['files/../escape', 'files/a/../../escape', '/files/absolute', 'files\\windows', 'files/a//b', 'files/./b', 'files/a\u0000b', 'files/a:b', 'account.json', 'manifest.json'])('rejects an escaping, ambiguous or foreign archive entry %s', (path) => {
    expect(() => portableEntryPath(path)).toThrow();
  });
  it('rejects iOS case and normalization collisions before extracting over a different entry', () => {
    for (const paths of [['files/Cover.jpg', 'files/cover.jpg'], ['files/é.jpg', 'files/e\u0301.jpg']]) {
      const value = manifest(); value.entries.push(...paths.map((path) => ({ path, size: 0, sha256: 'c'.repeat(64) })));
      expect(() => parsePortableManifest(JSON.stringify(value))).toThrow('冲突');
    }
  });
  it('requires every declared file hash and size, exact total bytes, and current table whitelist', () => {
    const cases = [
      { ...manifest(), schema: 99 }, { ...manifest(), expandedBytes: 19 }, { ...manifest(), packageId: '../../escape' },
      { ...manifest(), counts: { transfer_receipts: 1 } }, { ...manifest(), counts: { books: 1000001 } },
      { ...manifest(), entries: manifest().entries.map((entry) => ({ ...entry, sha256: 'not-a-hash' })) },
      { ...manifest(), entries: manifest().entries.map((entry) => ({ ...entry, size: 536870913 })) },
    ];
    for (const value of cases) expect(() => parsePortableManifest(JSON.stringify(value))).toThrow();
  });
  it('rejects changed schema fields, unsafe integers, private table rows and portable image traversal', () => {
    for (const row of [{ ...book, injected: 1 }, { ...book, id: 9007199254740992 }, { ...book, title: 4 }, { ...book, filePath: 'file://@FILES@/../secret' }]) expect(() => parsePortableRow(JSON.stringify({ table: 'books', row }))).toThrow();
    expect(() => parsePortableRow(JSON.stringify({ table: 'transfer_identities', row: { localKey: 'x', stableId: 'y' } }))).toThrow('未知');
    expect(() => parsePortableRow(JSON.stringify({ table: 'chapters', row: { ...chapter, content: '[IMG:@FILES@/x/../../secret]' } }))).toThrow('越界');
  });
  it('detects duplicate identities, missing parents and false manifest counts without retaining chapter text', () => {
    const books = parsePortableRow(JSON.stringify({ table: 'books', row: book })), chapters = parsePortableRow(JSON.stringify({ table: 'chapters', row: chapter }));
    const duplicates = new PortableRowsInspector(); duplicates.add(books); expect(() => duplicates.add(books)).toThrow('重复');
    const missing = new PortableRowsInspector(); missing.add(chapters); expect(() => missing.finish()).toThrow('缺失');
    const counts = new PortableRowsInspector(); counts.add(books); expect(() => counts.finish(parsePortableManifest(JSON.stringify(manifest())))).toThrow('数量');
  });
  it('rejects unreasonable reading durations and reversed session intervals', () => {
    const row = { id: 1, bookId: 1, bookTitle: '迁移测试', dateStr: '2026-10-28', durationSeconds: 172801 };
    expect(() => parsePortableRow(JSON.stringify({ table: 'reading_records', row }))).toThrow('时长');
    expect(() => parsePortableRow(JSON.stringify({ table: 'reading_sessions', row: { ...row, durationSeconds: 1, startTimeMs: 2000, endTimeMs: 1000, startHour: 12 } }))).toThrow('时间');
  });
  it('matches Android UTF-8/NUL identity hashing and preserves body identity when image files relocate', () => {
    const expected = createHash('sha256').update('源\0漫画身份').digest('hex'); expect(portableOnlineIdentity('源', '漫画身份')).toBe('online:' + expected);
    const original = [{ chapterOrder: 0, title: '正文', content: '前[IMG:/android/a.jpg]后' }], moved = [{ ...original[0]!, content: '前[IMG:@FILES@/ios/b.jpg]后' }];
    const digest = createHash('sha256').update('0\0正文\0前[IMG]后\0').digest('hex'); expect(portableChapterVersion(original)).toBe(digest); expect(portableChapterVersion(moved)).toBe(digest);
    expect(portableChapterVersion([{ ...original[0]!, content: '正文实际改变' }])).not.toBe(digest);
  });
});

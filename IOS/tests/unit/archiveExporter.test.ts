import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { MIGRATION_12_13 } from '@core/db/roomMigrations';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { ArchiveDatabaseRows } from '@core/transfer/archiveDatabaseRows';
import { exportPortableRows, type ExportResourceCatalog } from '@core/transfer/archiveExporter';
import { parsePortableRow, parsePortableRowsHeader, type PortableEnvelope, type PortableRow } from '@core/transfer/portableFormat';
import { TABLES } from '@core/db/schemaV13';
const id = '01234567-89ab-cdef-0123-456789abcdef', databases: MemorySqlite[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const row = (table: string, values: PortableRow) => ({ ...Object.fromEntries(TABLES.find((definition) => definition.name === table)!.columns.map((column) => [column.name, !column.notNull ? null : column.type === 'TEXT' ? '' : 0])), ...values });
async function setup() {
  const db = createV12Database(); databases.push(db); await MIGRATION_12_13.migrate(db); const writer = new ArchiveDatabaseRows(db), settings = new SettingsRepository(db); await settings.setBoolean('favorites_protected', true);
  await writer.insert('categories', { id: 1, name: '保护', isProtected: 1 });
  for (const [bookId, category] of [[1, '默认'], [2, '保护']] as const) {
    await writer.insert('books', row('books', { id: bookId, title: `书${bookId}`, category, contentType: 'NOVEL', totalChapters: 1, filePath: 'book.epub', currentChapterIndex: 5, lastReadTime: 100 }));
    await writer.insert('chapters', row('chapters', { id: bookId, bookId, chapterOrder: 0, title: '第一章', content: `正文${bookId}` }));
    await writer.insert('bookmarks', row('bookmarks', { id: bookId, bookId, title: '书签' }));
  }
  await writer.insert('favorites', row('favorites', { sourceId: 'source', comicId: 'secret', title: '保护收藏' }));
  await writer.insert('god_moments', row('god_moments', { id: 1, bookId: 'source::secret', chapterId: '1' }));
  await writer.insert('reading_records', row('reading_records', { id: 1, bookId: null, bookTitle: '保护在线历史', durationSeconds: 1 }));
  const resources: ExportResourceCatalog = { exportRow: vi.fn(async (value) => ({ ...value, ...(typeof value.filePath === 'string' ? { filePath: '@FILES@/book.epub' } : {}) })), exportBody: vi.fn(async (value) => value), original: async () => `file:${'a'.repeat(64)}`, directoryIdentity: async () => null, hash: async () => null };
  const chunks: string[] = [], write = vi.fn(async (text: string, reset: boolean) => { if (reset) chunks.length = 0; chunks.push(text); });
  const decode = () => { const lines = chunks.join('').trimEnd().split('\n'); parsePortableRowsHeader(lines.shift()!); return lines.map(parsePortableRow); };
  return { db, writer, resources, chunks, write, decode };
}
describe('streaming archive export selection and privacy', () => {
  it('excludes protected books, favorites, annotations and unscoped online history without authorization', async () => {
    const fixture = await setup();
    const result = await exportPortableRows(fixture.db, id, { categories: ['BOOKS', 'ANNOTATIONS', 'FAVORITES', 'HISTORY'], protectedAuthorized: false }, fixture.resources, fixture.write);
    const rows = fixture.decode(); expect(rows.filter((entry) => entry.table === 'books').map((entry) => entry.row.id)).toEqual([1]);
    expect(rows.filter((entry) => ['favorites', 'god_moments', 'reading_records'].includes(entry.table))).toEqual([]); expect(rows.filter((entry) => entry.table === 'bookmarks')).toHaveLength(1);
    expect(result.containsProtected).toBe(false); expect(result.protectedFavorites).toBe(false); expect(result.selectedBookKeys.has('2')).toBe(false);
  });
  it('includes authorized protected data and reports protection in the manifest metadata', async () => {
    const fixture = await setup();
    const result = await exportPortableRows(fixture.db, id, { categories: ['BOOKS', 'FAVORITES', 'ANNOTATIONS'], protectedAuthorized: true }, fixture.resources, fixture.write);
    expect(result.counts.books).toBe(2); expect(result.counts.favorites).toBe(1); expect(result.containsProtected).toBe(true); expect(result.protectedFavorites).toBe(true);
    expect(fixture.decode().filter((entry) => entry.table === 'books').every((entry) => entry.row.lastReadTime === 0)).toBe(true);
  });
  it('exports parent identities and blank chapter metadata without copying book resources when only annotations were chosen', async () => {
    const fixture = await setup();
    await exportPortableRows(fixture.db, id, { categories: ['ANNOTATIONS'], protectedAuthorized: false }, fixture.resources, fixture.write);
    const rows = fixture.decode(), book = rows.find((entry) => entry.table === 'books')!;
    expect(book.parentOnly).toBe(true); expect(book.identity).toBe(`file:${'a'.repeat(64)}`); expect(book.bodyVersion).toMatch(/^[a-f0-9]{64}$/); expect(book.row.filePath).toBe('');
    expect(rows.find((entry) => entry.table === 'chapters')!.row.content).toBe(''); expect(fixture.resources.exportRow).not.toHaveBeenCalledWith(expect.objectContaining({ filePath: 'book.epub' })); expect(fixture.resources.exportBody).not.toHaveBeenCalled();
  });
  it('flushes bounded NDJSON batches and drops temporary fingerprints when cancelled', async () => {
    const fixture = await setup();
    for (let index = 2; index < 12; index++) await fixture.writer.insert('chapters', row('chapters', { id: index + 100, bookId: 1, chapterOrder: index, title: `第${index}章`, content: '文'.repeat(40000) }));
    await exportPortableRows(fixture.db, id, { categories: ['BOOKS'], protectedAuthorized: false }, fixture.resources, fixture.write);
    expect(fixture.chunks.length).toBeGreaterThan(2); expect(fixture.chunks.every((text) => text.length < 512 * 1024)).toBe(true);
    const controller = new AbortController(); controller.abort();
    await expect(exportPortableRows(fixture.db, id, { categories: ['BOOKS'], protectedAuthorized: false }, fixture.resources, fixture.write, controller.signal)).rejects.toThrow('取消');
    expect(await fixture.db.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '_ciallo_chapters_%'")).toEqual([]);
    const output: PortableEnvelope[] = fixture.decode(); expect(output.filter((entry) => entry.table === 'chapters')).toHaveLength(11);
  });
});

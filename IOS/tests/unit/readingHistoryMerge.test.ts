import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { ArchiveDatabaseRows, RelatedArchiveRows } from '@core/transfer/archiveDatabaseRows';
import { ReadingHistoryMerge } from '@core/transfer/readingHistoryMerge';
import type { PortableEnvelope } from '@core/transfer/portableFormat';

const databases: MemorySqlite[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
async function* stream(rows: PortableEnvelope[]) { for (const row of rows) yield row; }
const day = '2026-10-29';
function record(bookId: number | null, title: string, seconds: number): PortableEnvelope { return { table: 'reading_records', row: { id: 10, bookId, bookTitle: title, dateStr: day, durationSeconds: seconds } }; }
function session(bookId: number | null, title: string, start: number, seconds: number): PortableEnvelope { return { table: 'reading_sessions', row: { id: 10, bookId, bookTitle: title, dateStr: day, startTimeMs: start, endTimeMs: start + seconds * 1000, durationSeconds: seconds, startHour: 12 } }; }
describe('portable reading-history union on real SQLite', () => {
  it('counts overlapping sessions once, takes the larger unknown historical remainder, and remains stable on repeat', async () => {
    const db = createV12Database(); databases.push(db); const writer = new ArchiveDatabaseRows(db), ids = new Map([[1, 90]]), titles = new Map([[90, '本机书名']]);
    await writer.insert('reading_records', { bookId: 90, bookTitle: '旧名称', dateStr: day, durationSeconds: 100 });
    const oldSession = session(90, '旧名称', 1000, 60); delete oldSession.row.id; await writer.insert('reading_sessions', oldSession.row);
    const incomingDaily = [record(1, '发送端改名', 130)], incomingSessions = [session(1, '发送端改名', 1000, 60), session(1, '发送端改名', 100000, 30)];
    for (let attempt = 0; attempt < 2; attempt++) {
      const history = new ReadingHistoryMerge(db, ids, titles); await history.capture(); const related = new RelatedArchiveRows(writer, ids, new Map(), titles);
      for (const row of incomingSessions) await related.merge(row);
      expect(await history.merge(stream(incomingDaily), stream(incomingSessions))).toMatchObject({ recordedSeconds: 130, merged: 1 });
      expect(await db.query('SELECT * FROM reading_sessions')).toHaveLength(2);
      expect(await db.query('SELECT bookTitle,durationSeconds FROM reading_records')).toEqual([{ bookTitle: '本机书名', durationSeconds: 130 }]);
    }
  });
  it('adds distinct online titles and skips records whose selected parent book did not exist', async () => {
    const db = createV12Database(); databases.push(db); const history = new ReadingHistoryMerge(db, new Map(), new Map()); await history.capture();
    const result = await history.merge(stream([record(null, '在线甲', 20), record(null, '在线乙', 30), record(999, '未匹配父书籍', 1000)]), stream([]));
    expect(result).toEqual({ merged: 2, skipped: 1, recordedSeconds: 50 }); expect(await db.query('SELECT bookTitle FROM reading_records ORDER BY bookTitle')).toEqual([{ bookTitle: '在线乙' }, { bookTitle: '在线甲' }]);
  });
  it('includes session-only transfers without inventing a daily remainder', async () => {
    const db = createV12Database(); databases.push(db); const history = new ReadingHistoryMerge(db, new Map(), new Map()); await history.capture();
    const incoming = session(null, '在线书', 1000, 12), writer = new ArchiveDatabaseRows(db); delete incoming.row.id; await writer.insert('reading_sessions', incoming.row);
    expect((await history.merge(stream([]), stream([incoming]))).recordedSeconds).toBe(12);
  });
});

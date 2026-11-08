import { ArchiveDatabaseRows } from './archiveDatabaseRows';
import { requireTransfer } from './transferWire';
import type { PortableEnvelope, PortableRow } from './portableFormat';
import type { SqliteExecutor } from '@platform/interfaces';

interface DayTotal { bookId: number | null; bookTitle: string; dateStr: string; seconds: number; }
const dayKey = (bookId: number | null, bookTitle: string, date: string): string => JSON.stringify([bookId, bookId === null ? bookTitle : '', date]);
/** Union known sessions once. Historical time that has no corresponding session
 * uses max(local remainder, incoming remainder), so re-import cannot double it.
 * A renamed local book keeps the same identity; online rows with no book id keep
 * their title scope because the schema provides no other online identity. */
export class ReadingHistoryMerge {
  private localDaily = new Map<string, number>();
  private localSessions = new Map<string, number>();
  private captured = false;
  constructor(private readonly database: SqliteExecutor, private readonly books: ReadonlyMap<number, number>, private readonly titles: ReadonlyMap<number, string>) {}
  private async totals(table: 'reading_records' | 'reading_sessions'): Promise<Map<string, number>> {
    const rows = await this.database.query<DayTotal>(`SELECT bookId,CASE WHEN bookId IS NULL THEN bookTitle ELSE '' END AS bookTitle,dateStr,SUM(durationSeconds) AS seconds FROM ${table} GROUP BY bookId,CASE WHEN bookId IS NULL THEN bookTitle ELSE '' END,dateStr`);
    return new Map(rows.map((row) => { requireTransfer(Number.isSafeInteger(row.seconds) && row.seconds >= 0, '阅读统计合计无效'); return [dayKey(row.bookId, row.bookTitle, row.dateStr), row.seconds]; }));
  }
  async capture(): Promise<void> { this.localDaily = await this.totals('reading_records'); this.localSessions = await this.totals('reading_sessions'); this.captured = true; }
  async merge(daily: AsyncIterable<PortableEnvelope>, sessions: AsyncIterable<PortableEnvelope>): Promise<{ merged: number; skipped: number; recordedSeconds: number }> {
    requireTransfer(this.captured, '合并前必须保存本机统计基线');
    this.captured = false;
    const incomingDaily = new Map<string, number>(), incomingSessions = new Map<string, number>(), labels = new Map<string, string>();
    let skipped = 0;
    const remap = (row: PortableRow): { bookId: number | null; bookTitle: string; date: string } | null => {
      let bookId = row.bookId as number | null;
      if (bookId !== null) { const mapped = this.books.get(bookId); if (mapped === undefined) return null; bookId = mapped; }
      return { bookId, bookTitle: bookId === null ? row.bookTitle as string : this.titles.get(bookId) ?? row.bookTitle as string, date: row.dateStr as string };
    };
    for (const [source, totals, expected] of [[daily, incomingDaily, 'reading_records'], [sessions, incomingSessions, 'reading_sessions']] as const) {
      for await (const envelope of source) {
        requireTransfer(envelope.table === expected, '阅读记录表不符');
        const mapped = remap(envelope.row); if (!mapped) { if (expected === 'reading_records') skipped++; continue; }
        const key = dayKey(mapped.bookId, mapped.bookTitle, mapped.date), total = (totals.get(key) ?? 0) + (envelope.row.durationSeconds as number);
        requireTransfer(Number.isSafeInteger(total) && total >= 0, '阅读统计合计无效'); totals.set(key, total); labels.set(key, mapped.bookTitle);
      }
    }
    const union = await this.totals('reading_sessions'), writer = new ArchiveDatabaseRows(this.database);
    let merged = 0;
    for (const key of new Set([...incomingDaily.keys(), ...incomingSessions.keys()])) {
      const [bookId, title, date] = JSON.parse(key) as [number | null, string, string];
      const historical = Math.max(Math.max(0, (this.localDaily.get(key) ?? 0) - (this.localSessions.get(key) ?? 0)), Math.max(0, (incomingDaily.get(key) ?? 0) - (incomingSessions.get(key) ?? 0)));
      const seconds = (union.get(key) ?? 0) + historical;
      if (bookId === null) await this.database.execute('DELETE FROM reading_records WHERE bookId IS NULL AND bookTitle=? AND dateStr=?', [title, date]);
      else await this.database.execute('DELETE FROM reading_records WHERE bookId=? AND dateStr=?', [bookId, date]);
      await writer.insert('reading_records', { bookId, bookTitle: labels.get(key) ?? title, dateStr: date, durationSeconds: seconds }); merged++;
    }
    const total = (await this.database.query<{ seconds: number | null }>('SELECT SUM(durationSeconds) AS seconds FROM reading_records'))[0]?.seconds ?? 0;
    requireTransfer(Number.isSafeInteger(total) && total >= 0, '阅读统计总计无效'); return { merged, skipped, recordedSeconds: total };
  }
}

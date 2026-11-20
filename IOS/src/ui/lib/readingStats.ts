import { AppLanguage, getAppLanguage } from '@core/i18n/locale';
/**
 * readingStats.ts — port of Android components/ReadingStats.kt
 * Pure aggregation + formatting helpers used by StatisticsPage / WeeklyReadingChart.
 */

export interface ReadingRecord {
  id: number;
  bookId?: number | null;
  bookTitle: string;
  dateStr: string; // yyyy-MM-dd
  durationSeconds: number;
  coverUrl?: string | null;
}

export interface ReadingSession {
  id: number;
  dateStr: string;
  startTimeMs: number;
  startHour: number;
  durationSeconds: number;
}

/** reading_records -> 日期 -> 秒（天 x 书 已按天聚合）。 */
export function readingRecordsToDailyTotals(
  records: readonly ReadingRecord[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    map.set(r.dateStr, (map.get(r.dateStr) ?? 0) + r.durationSeconds);
  }
  return map;
}

/**
 * Kotlin `ReadingStats.kt:64-75` `formatReadDuration(totalSeconds)`。
 *
 * 中英双语（此前 iOS 只有中文分支，英文界面会显示「0小时18分钟」）：
 * ```
 * 0        -> en ? "0 min"   : "0分钟"
 * h > 0    -> en ? "\${h}h \${m}m" : "\${h}小时\${m}分钟"
 * 其它      -> en ? "\${m} min" : "\${m}分钟"
 * ```
 */
export function formatReadDuration(totalSeconds: number): string {
  const en = getAppLanguage() === AppLanguage.EN;
  if (totalSeconds <= 0) return en ? '0 min' : '0分钟';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (en) return h > 0 ? `${h}h ${m}m` : `${m} min`;
  return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
}

/**
 * Kotlin `ReadingStats.kt:78-89` `formatShortDuration(totalSeconds)`（日历格小标签）。
 *
 * 英文：`12s` / `45m` / `3h26m`；中文：`12秒` / `45分` / `3时26分`。
 */
export function formatShortDuration(totalSeconds: number): string {
  const en = getAppLanguage() === AppLanguage.EN;
  if (en) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
  }
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** dateStrOf: Calendar -> "yyyy-MM-dd" */
export function dateStrOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayCalendar(): Date {
  return new Date();
}

/** weekDatesOf: 自然周（周一起始），返回 7 个 Date。 */
export function weekDatesOf(anchor: Date): Date[] {
  const cal = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = cal.getDay(); // 0=Sun .. 6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  cal.setDate(cal.getDate() + diffToMonday);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(new Date(cal.getFullYear(), cal.getMonth(), cal.getDate()));
    cal.setDate(cal.getDate() + 1);
  }
  return out;
}

/** [from, to] 闭区间内总秒数。 */
export function sumSecondsBetween(
  daily: Map<string, number>,
  from: Date,
  to: Date,
): number {
  const fromStr = dateStrOf(from);
  const toStr = dateStrOf(to);
  let sum = 0;
  for (const [key, value] of daily) {
    if (key >= fromStr && key <= toStr) sum += value;
  }
  return sum;
}

/** [from, to] 闭区间内有阅读的天数。 */
export function daysReadBetween(
  daily: Map<string, number>,
  from: Date,
  to: Date,
): number {
  const fromStr = dateStrOf(from);
  const toStr = dateStrOf(to);
  let count = 0;
  for (const [key, value] of daily) {
    if (key >= fromStr && key <= toStr && value > 0) count++;
  }
  return count;
}

/** 截至 end 当天（含）的连续阅读天数。 */
export function streakEndingAt(daily: Map<string, number>, end: Date): number {
  const cal = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  for (;;) {
    const v = daily.get(dateStrOf(cal)) ?? 0;
    if (v > 0) {
      count++;
      cal.setDate(cal.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}

/** 返回 [from,to] 之间每一天的 (dateStr, seconds) 序列。 */
/**
 * Kotlin `ReadingStats.kt:154-166` `longestStreakIn(daily, from, to)`：
 * `[from, to]` 闭区间内**最长连续阅读天数**（逐日推进，断了就归零重数）。
 *
 * 与 `streakEndingAt` 的区别：那个只往回数到 `end` 为止的一段，这个扫整个区间取最长。
 */
export function longestStreakIn(daily: ReadonlyMap<string, number>, from: Date, to: Date): number {
  let best = 0;
  let current = 0;
  const cal = new Date(from.getTime());
  while (cal.getTime() <= to.getTime()) {
    const v = daily.get(dateStrOf(cal)) ?? 0;
    current = v > 0 ? current + 1 : 0;
    if (current > best) best = current;
    cal.setDate(cal.getDate() + 1);
  }
  return best;
}

export function dailySeries(
  daily: Map<string, number>,
  from: Date,
  to: Date,
): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const cal = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cal.getTime() <= end.getTime()) {
    const s = dateStrOf(cal);
    out.push([s, daily.get(s) ?? 0]);
    cal.setDate(cal.getDate() + 1);
  }
  return out;
}

/** 截止 end 的最近 months 个月（含当月），返回 (yyyy-MM, seconds)。 */
export function monthlySeries(
  daily: Map<string, number>,
  months: number,
  end: Date,
): Array<[string, number]> {
  const cal = new Date(end.getFullYear(), end.getMonth(), 1);
  const out: Array<[string, number]> = [];
  for (let i = 0; i < months; i++) {
    const prefix = `${cal.getFullYear()}-${pad2(cal.getMonth() + 1)}`;
    let total = 0;
    for (const [key, value] of daily) {
      if (key.startsWith(prefix)) total += value;
    }
    out.unshift([prefix, total]);
    cal.setMonth(cal.getMonth() - 1);
  }
  return out;
}

/** 会话 startHour -> 总秒数（高峰时段分布）。 */
export function peakHourTotals(
  sessions: readonly ReadingSession[],
  from: Date,
  to: Date,
): number[] {
  const arr = new Array<number>(24).fill(0);
  const fromStr = dateStrOf(from);
  const toStr = dateStrOf(to);
  for (const s of sessions) {
    if (s.dateStr >= fromStr && s.dateStr <= toStr) {
      const hour = Math.max(0, Math.min(23, s.startHour));
      arr[hour] = (arr[hour] ?? 0) + s.durationSeconds;
    }
  }
  return arr;
}

/** formatSessionTime: "HH:mm" */
export function formatSessionTime(session: ReadingSession): string {
  const d = new Date(session.startTimeMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 合并同一天内同一本书的多条阅读记录（本地书按 bookId，在线书按书名）。
 */
export function mergeDuplicateReadingRecords(
  records: ReadingRecord[],
): ReadingRecord[] {
  if (records.length <= 1) return records;
  const merged = new Map<string, ReadingRecord>();
  for (const record of records) {
    const key =
      record.bookId != null ? `book:${record.bookId}` : `title:${record.bookTitle}`;
    const existing = merged.get(key);
    if (existing == null) {
      merged.set(key, record);
    } else {
      merged.set(key, {
        ...existing,
        durationSeconds: existing.durationSeconds + record.durationSeconds,
      });
    }
  }
  return Array.from(merged.values());
}

/** 分钟数 -> 热力 alpha 档位（0/1-9/10-29/30-59/60+ 分钟）。 */
export function heatAlphaLevel(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 600) return 1;
  if (seconds < 1800) return 2;
  if (seconds < 3600) return 3;
  return 4;
}

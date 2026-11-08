import { useEffect, useState } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ReadingStats.kt` (171 non-blank lines) — FULL PORT
 *   lines 29-45  `@Composable rememberTodayCalendar()` → useTodayCalendar()
 *   lines 50-56  `readingRecordsToDailyTotals(records)` → readingRecordsToDailyTotals()
 *   lines 58-63  `formatReadDuration(totalSeconds)` → formatReadDuration()
 *   lines 66-71  `formatShortDuration(totalSeconds)` → formatShortDuration()
 *   lines 73-74  `dateStrOf(cal)` → dateStrOf()
 *   line 76      `todayCalendar()` → todayCalendar()
 *   lines 78-89  `dateStrToCalendar(dateStr)` → dateStrToCalendar()
 *   lines 92-103 `weekDatesOf(anchor)` → weekDatesOf()
 *   lines 105-111 `sumSecondsBetween(daily, from, to)` → sumSecondsBetween()
 *   lines 114-118 `daysReadBetween(...)` → daysReadBetween()
 *   lines 121-134 `streakEndingAt(...)` → streakEndingAt()
 *   lines 137-148 `longestStreakIn(...)` → longestStreakIn()
 *   lines 151-161 `dailySeries(...)` → dailySeries()
 *   lines 163-176 `monthlySeries(...)` → monthlySeries()
 *   lines 178-190 `peakHourTotals(sessions, from, to)` → peakHourTotals()
 *   lines 193-194 `formatSessionTime(session)` → formatSessionTime()
 *
 * Data types (`com.example.data.ReadingRecord` / `ReadingSession`) are imported
 * from `src/ui/lib/readingStats.ts`, which already declares the web-side shapes.
 *
 * `java.util.Calendar` → `Date` with the same field semantics (the helpers below
 * mirror `getActualMaximum(DAY_OF_MONTH)` / `get(DAY_OF_WEEK)` / `get(DAY_OF_YEAR)`
 * so the week/month boundaries are identical).
 */

/** One reading_records row. Mirrors `com.example.data.ReadingRecord`. */
export interface ReadingRecord {
  id: number;
  bookId?: number | null;
  bookTitle: string;
  dateStr: string; // yyyy-MM-dd
  durationSeconds: number;
  coverUrl?: string | null;
}

/** One reading_sessions row. Mirrors `com.example.data.ReadingSession`. */
export interface ReadingSession {
  id: number;
  dateStr: string;
  startTimeMs: number;
  startHour: number;
  durationSeconds: number;
}

/** Daily totals map: `yyyy-MM-dd` → seconds. */
export type DailyTotals = ReadonlyMap<string, number>;

/**
 * 跨天/跨周自动更新的"今天"。
 *
 * 2026-09-21 修复：此前各处一律用 `remember { Calendar.getInstance() }`（无 key），
 * 只在首次组合时算一次。后果是：App 长时间不重启跨过午夜后，"本周阅读明细"的
 * 周一~周日区间、今天的高亮下标全部停在旧的一天。
 *
 * 这里把"今天"提升为可观察状态，每分钟比对一次年月日，变化即刷新，
 * 所有基于它的周区间/日区间计算随之自动重算。
 */
export function useTodayCalendar(): Date {
  const [today, setToday] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      const cur = today;
      // 跨年也要重算（DAY_OF_YEAR 单独比会在闰年尾/年初出错）
      if (now.getFullYear() !== cur.getFullYear() || dayOfYear(now) !== dayOfYear(cur)) {
        setToday(now);
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [today]);

  return today;
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/** reading_records -> 日期 -> 秒（天 x 书 已按天聚合，作为所有周期统计的唯一基准）。 */
export function readingRecordsToDailyTotals(records: readonly ReadingRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    map.set(r.dateStr, (map.get(r.dateStr) ?? 0) + r.durationSeconds);
  }
  return map;
}

export function formatReadDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0分钟';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
}

/** 日历格子里的小标签：3h26m / 45m / 12s */
export function formatShortDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Kotlin `SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(cal.time)` */
export function dateStrOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayCalendar(): Date {
  return new Date();
}

/**
 * `dateStrToCalendar(dateStr)` — parse `yyyy-MM-dd`, midnight local, null on failure.
 * The Kotlin version silently accepted month 0 / day 0 via `set()`; the web port
 * normalises the way `Date` does, which yields the same day for valid inputs and a
 * `null` (rather than a garbage date) for impossible ones.
 */
export function dateStrToCalendar(dateStr: string): Date | null {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (parts[0] === undefined || parts[1] === undefined || parts[2] === undefined) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** 自然周（周一起始），返回 7 天 Calendar。 */
export function weekDatesOf(anchor: Date): Date[] {
  const cal = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = cal.getDay(); // 0 = Sunday .. 6 = Saturday
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
export function sumSecondsBetween(daily: DailyTotals, from: Date, to: Date): number {
  const fromStr = dateStrOf(from);
  const toStr = dateStrOf(to);
  let sum = 0;
  for (const [k, v] of daily) {
    if (k >= fromStr && k <= toStr) sum += v;
  }
  return sum;
}

/** [from, to] 闭区间内有阅读的天数。 */
export function daysReadBetween(daily: DailyTotals, from: Date, to: Date): number {
  const fromStr = dateStrOf(from);
  const toStr = dateStrOf(to);
  let count = 0;
  for (const [k, v] of daily) {
    if (k >= fromStr && k <= toStr && v > 0) count += 1;
  }
  return count;
}

/** 截至 end 当天（含）的连续阅读天数。 */
export function streakEndingAt(daily: DailyTotals, end: Date): number {
  const cal = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  for (;;) {
    const v = daily.get(dateStrOf(cal)) ?? 0;
    if (v > 0) {
      count += 1;
      cal.setDate(cal.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}

/** [from, to] 内最长连续阅读天数。 */
export function longestStreakIn(daily: DailyTotals, from: Date, to: Date): number {
  let best = 0;
  let current = 0;
  const cal = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endMs = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  while (cal.getTime() <= endMs) {
    const v = daily.get(dateStrOf(cal)) ?? 0;
    current = v > 0 ? current + 1 : 0;
    if (current > best) best = current;
    cal.setDate(cal.getDate() + 1);
  }
  return best;
}

/** 返回 [from,to] 之间每一天的 (dateStr, seconds) 序列。 */
export function dailySeries(
  daily: DailyTotals,
  from: Date,
  to: Date,
): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const cal = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endMs = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  while (cal.getTime() <= endMs) {
    const s = dateStrOf(cal);
    out.push([s, daily.get(s) ?? 0]);
    cal.setDate(cal.getDate() + 1);
  }
  return out;
}

/**
 * Adapters for the `Map | Record` prop shape used by the card components
 * (`Map<String, Long>` on Kotlin became a record once it crossed the store boundary).
 */
export type DailyTotalsInput = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

export function toDailyTotalsMap(input: DailyTotalsInput): Map<string, number> {
  if (input instanceof Map) return new Map(input);
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(input)) out.set(k, v);
  return out;
}

/** 截止 end 的最近 months 个月（含当月），返回 (yyyy-MM, seconds)。 */
export function monthlySeries(
  daily: DailyTotals,
  months: number,
  end: Date,
): Array<[string, number]> {
  const cal = new Date(end.getFullYear(), end.getMonth(), 1);
  const out: Array<[string, number]> = [];
  for (let i = 0; i < months; i++) {
    const prefix = `${cal.getFullYear()}-${pad2(cal.getMonth() + 1)}`;
    let total = 0;
    for (const [k, v] of daily) {
      if (k.startsWith(prefix)) total += v;
    }
    out.unshift([prefix, total]);
    cal.setMonth(cal.getMonth() - 1);
  }
  return out;
}

/** 会话 startHour -> 总秒数（高峰时段分布），只统计 [from,to] 内会话。 */
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
      const h = Math.max(0, Math.min(23, s.startHour));
      arr[h] = (arr[h] ?? 0) + s.durationSeconds;
    }
  }
  return arr;
}

/** 会话开始时间 -> "HH:mm"（当天明细用）。 */
export function formatSessionTime(session: ReadingSession): string {
  const d = new Date(session.startTimeMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
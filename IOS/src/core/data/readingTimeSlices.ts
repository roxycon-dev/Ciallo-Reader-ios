/**
 * Reading time slices — port of Android `ReadingTimeSlices.kt`.
 *
 * Splits a reading session at local midnights (Calendar.getInstance() parity:
 * local timezone day boundaries). Duration is allocated proportionally by
 * wall-clock span; the last slice absorbs the remainder.
 */

export interface ReadingTimeSlice {
  date: string;
  start: number;
  end: number;
  seconds: number;
  hour: number;
}

const MAX_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** SimpleDateFormat("yyyy-MM-dd", Locale.US) on local calendar fields. */
function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of the calendar day after `ms` (Calendar.add(DAY_OF_YEAR,1) + set 00:00:00.000). */
function nextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

function localHour(ms: number): number {
  return new Date(ms).getHours();
}

export function splitReadingTimeSlices(
  start: number,
  end: number,
  seconds: number,
): ReadingTimeSlice[] {
  if (end <= start || seconds <= 0) return [];
  if (end - start > MAX_SESSION_MS) {
    throw new Error('阅读会话时间范围异常');
  }
  const result: ReadingTimeSlice[] = [];
  let cursor = start;
  let allocated = 0;
  while (cursor < end) {
    const date = formatLocalDate(cursor);
    const hour = localHour(cursor);
    const stop = Math.min(end, nextLocalMidnight(cursor));
    const through =
      stop === end ? seconds : Math.trunc((seconds * (stop - start)) / (end - start));
    result.push({ date, start: cursor, end: stop, seconds: through - allocated, hour });
    allocated = through;
    cursor = stop;
  }
  return result;
}

/** Android `object ReadingTimeSlices { fun split(...) }` call-shape. */
export const ReadingTimeSlices = {
  split: splitReadingTimeSlices,
};

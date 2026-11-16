/**
 * `src/core/format/androidFormat.ts`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Kotlin → TS map  (all behaviours below were MEASURED on a real JVM, not guessed)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Android app formats dates/numbers with `java.text.SimpleDateFormat`,
 * `java.util.Calendar` and `String.format`. Three of their semantics are *not*
 * what the naive JS spelling produces, and every one of them has silently
 * corrupted a number in this port before. This module is the single place that
 * spells them correctly.
 *
 * Measured reference (JDK 21, `-Duser.language=zh -Duser.country=CN
 * -Duser.timezone=Asia/Shanghai`, plus the real `kotlin-compiler-embeddable`
 * 2.0.21 against verbatim copies of the app's Kotlin expressions):
 *
 *  1. `Calendar.DAY_OF_WEEK` is **1-based** (`SUNDAY=1 … SATURDAY=7`), so
 *     Kotlin's Monday-first index is `(DAY_OF_WEEK + 5) % 7`.
 *     JS `Date#getDay()` is **0-based** (`SUNDAY=0 … SATURDAY=6`), so the
 *     correct Monday-first index is `(getDay() + 6) % 7`.
 *     Copying `+ 5` verbatim is wrong for **all seven** weekdays.
 *
 *  2. `kotlin.math.round(x)` is `java.lang.Math.rint` → **ties-to-even**
 *     (banker's rounding). JS `Math.round` is **ties toward +Infinity**.
 *     They differ at every `x.5`.
 *
 *  3. `String.format("%.Nf", x)` rounds **half-up on the exact binary value**,
 *     which is *exactly* what `Number#toFixed(N)` is specified to do. The two
 *     agree on every value we measured, including the classic `1.005` /
 *     `2.675` binary-representation traps — so `toFixed` is a faithful
 *     `%.Nf`, but `Math.round` is **not** a faithful `%.0f` for negatives.
 *
 * Everything here is pure TypeScript: no React, no DOM, no Capacitor.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * §1  Number formatting
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kotlin `"%0<width>d".format(n)` — left-pad with ASCII `'0'`.
 *
 * Java's `%d` never emits a thousands separator (that is what `%,d` is for) and
 * never emits non-ASCII digits under `Locale.CHINA` / `Locale.US`, so plain
 * `padStart` is an exact match.
 */
export function padZero(n: number, width: number): string {
  const s = Math.trunc(n).toString();
  if (s.length >= width) return s;
  return '0'.repeat(width - s.length) + s;
}

/**
 * Kotlin `String.format("%.Nf", value)` with a `zh-CN` / `Locale.CHINA`
 * decimal separator, i.e. a plain `'.'`.
 *
 * `toFixed(N)` is the faithful spelling: the ECMAScript spec resolves the
 * result to the integer `n` for which `n / 10^F - x` is closest to zero,
 * breaking ties toward the larger `n` — which is half-up for the non-negative
 * byte/second counts this app formats. `Locale.getDefault()` on an Android
 * Chinese device is `zh_CN`, whose decimal separator is `'.'`, so no
 * `Intl.NumberFormat` (and therefore no ICU version) is involved.
 */
export function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** Kotlin `String.format("%d", longValue)` — no grouping, no sign surprises. */
export function formatInt(value: number): string {
  return Math.trunc(value).toString();
}

/**
 * Kotlin `String.format("%,d", n)` with `Locale.CHINA` (or `Locale.ROOT`, or
 * the `zh-CN` default — all three measured to emit `','` on every 3 digits).
 *
 * `toLocaleString('en-US')` would also be correct but depends on the host ICU
 * data. This implementation is table-driven so the output is pinned regardless
 * of the runtime that executes the bundle.
 */
export function formatGrouped(n: number): string {
  const negative = n < 0;
  const digits = Math.trunc(Math.abs(n)).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return negative ? `-${out}` : out;
}

/**
 * Kotlin `kotlin.math.round(x)` — measured to be `java.lang.Math.rint`, i.e.
 * **round half to even**.
 *
 * Do NOT substitute `Math.round` here. The observable difference on the values
 * this app produces:
 *
 * | input          | `kotlin.math.round` | `Math.round` |
 * |----------------|---------------------|--------------|
 * | `30 / 60`      | `0`                 | `1`          |
 * | `150 / 60`     | `2`                 | `3`          |
 * | `270 / 60`     | `4`                 | `5`          |
 */
export function kotlinRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // Exact tie -> pick the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Kotlin `(fraction * 100).toInt()` on a **Float** → truncation toward zero.
 *
 * Note this is deliberately *not* `%.0f` (half-up). The app uses `.toInt()` at
 * every download-progress site, so `Math.trunc` is the faithful spelling.
 */
export function truncPercent(fraction: number): number {
  return Math.trunc(fraction * 100);
}

/** Kotlin `(fraction * 100).toInt()` rendered with the trailing `'%'`. */
export function formatPercentTrunc(fraction: number): string {
  return `${truncPercent(fraction)}%`;
}

/**
 * Kotlin `"%.0f%%".format(fraction * 100)` → half-up, then `'%'`.
 *
 * Used by the split-position slider (`ComicReaderSheets.kt:832`), which is the
 * one percentage in the app that does *not* truncate.
 */
export function formatPercentHalfUp(fraction: number): string {
  return `${kotlinRound(fraction * 100)}%`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * §2  Local-calendar date keys
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kotlin `SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(date)`.
 *
 * `SimpleDateFormat` without an explicit `TimeZone` renders in the **device
 * default zone**, which is the behaviour we must reproduce — so this reads
 * *local calendar fields* (`getFullYear`/`getMonth`/`getDate`) and never
 * `toISOString()` (which is UTC and would report the previous day for every
 * UTC+8 user before 08:00 local).
 */
export function dateStrOf(date: Date): string {
  return `${padZero(date.getFullYear(), 4)}-${padZero(date.getMonth() + 1, 2)}-${padZero(date.getDate(), 2)}`;
}

/** Kotlin `SimpleDateFormat("yyyy-MM", Locale.getDefault()).format(date)`. */
export function monthStrOf(date: Date): string {
  return `${padZero(date.getFullYear(), 4)}-${padZero(date.getMonth() + 1, 2)}`;
}

/** Kotlin `SimpleDateFormat("HH:mm", Locale.getDefault()).format(date)`. */
export function clockHHmm(date: Date): string {
  return `${padZero(date.getHours(), 2)}:${padZero(date.getMinutes(), 2)}`;
}

/** Kotlin `SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.CHINA)`. */
export function logStampOf(date: Date): string {
  return (
    `${padZero(date.getMonth() + 1, 2)}-${padZero(date.getDate(), 2)} ` +
    `${padZero(date.getHours(), 2)}:${padZero(date.getMinutes(), 2)}:` +
    `${padZero(date.getSeconds(), 2)}.${padZero(date.getMilliseconds(), 3)}`
  );
}

/** Kotlin `SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)` over a local `Date`. */
export function dateTimeMinuteOf(date: Date): string {
  return `${dateStrOf(date)} ${clockHHmm(date)}`;
}

/** Local midnight of the calendar day containing `date` (Kotlin `set(HOUR_OF_DAY, 0)…`). */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** Local midnight of the day after the one containing `date` (`add(DAY_OF_YEAR, 1)` + zeroes). */
export function nextLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * §3  Week / year arithmetic (the DST traps)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Monday-first weekday index: Monday `0` … Sunday `6`.
 *
 * ⚠️ This is `(getDay() + 6) % 7`, **not** `(getDay() + 5) % 7`.
 * The Kotlin source reads `(calendar.get(Calendar.DAY_OF_WEEK) + 5) % 7`, and
 * `DAY_OF_WEEK` is 1-based, so copying the `+ 5` onto JS's 0-based `getDay()`
 * shifts every weekday by one. Measured for all seven days:
 *
 * | day     | Kotlin `(DOW+5)%7` | wrong `(getDay()+5)%7` | this function |
 * |---------|--------------------|------------------------|---------------|
 * | Sunday  | 6                  | 5                      | 6             |
 * | Monday  | 0                  | 6                      | 0             |
 * | Tuesday | 1                  | 0                      | 1             |
 * | …       |                    |                        |               |
 * | Saturday| 5                  | 4                      | 5             |
 *
 * The port must not "fix" this by matching a wrong constant — the Android
 * output is the authority.
 */
export function mondayFirstIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Proleptic-Gregorian leap-year test, matching `Calendar`'s default calendar. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Kotlin `first.getActualMaximum(Calendar.DAY_OF_YEAR)`. */
export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Kotlin `first.getActualMaximum(Calendar.DAY_OF_MONTH)`. */
export function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month == last day of this one.
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * Kotlin `Calendar.get(DAY_OF_YEAR)` — 1 for 1 January.
 *
 * Computed from **calendar fields**, never from `ms / 86_400_000`. Dividing
 * elapsed milliseconds by a fixed day length is wrong in every DST timezone
 * (`America/New_York` 2026-03-09 returns 67 instead of 68 and stays off for
 * the rest of the year), which silently shifts the year heat-map by a column.
 */
export function dayOfYear(date: Date): number {
  return (
    Math.round(
      (date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86_400_000,
    ) + 1
  );
}

/**
 * Whole local calendar days from `from` to `to`, inclusive
 * (`(to - from) / 86_400_000 + 1`, but DST-safe).
 *
 * Kotlin's own version divides by a fixed `86_400_000L`, which over-counts a
 * week containing a fall-back transition by one day. We keep the same result
 * in DST-free zones (Asia/Shanghai) and stay correct everywhere else; the
 * divergence is registered in `docs/PARITY_EXCEPTIONS.md`.
 */
export function calendarDaysInclusive(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Kotlin `weekDatesOf(anchor)` — the 7 days of the Monday-first natural week
 * containing `anchor`, at midnight.
 */
export function weekDatesOf(anchor: Date): Date[] {
  const day = startOfLocalDay(anchor);
  day.setDate(day.getDate() - mondayFirstIndex(day));
  const out: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    out.push(new Date(day.getFullYear(), day.getMonth(), day.getDate() + i));
  }
  return out;
}

/**
 * Kotlin `streakEndingAt(daily, end)` — consecutive days with `> 0` seconds,
 * counting back from `end` inclusive.
 *
 * Note the Android semantics: if `end` itself has no reading the streak is `0`.
 * It does **not** fall back to "yesterday" (a common alternative reading).
 */
export function streakEndingAt(
  daily: ReadonlyMap<string, number>,
  end: Date,
): number {
  const cal = startOfLocalDay(end);
  let count = 0;
  for (;;) {
    const v = daily.get(dateStrOf(cal)) ?? 0;
    if (v > 0) {
      count += 1;
      cal.setDate(cal.getDate() - 1);
    } else {
      return count;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * §4  Byte-size formatters
 *
 * All four Android variants are kept — they genuinely differ in unit ladder,
 * decimal count, spacing and the zero case, and merging them would be a
 * behaviour change. Measured JVM output is quoted next to each one.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kotlin `MainActivity.kt:556-562` — the "burn after reading" shelf share size.
 *
 * Measured: `0 → "0 KB"`, `1 → "1 B"`, `1024 → "1.0 KB"`,
 * `1610612736 → "1.50 GB"` (two decimals), `1099511627776 → "1024.00 GB"`.
 *
 * Two details the port previously got wrong: the GB branch uses **`%.2f`** (not
 * `%.1f`), and the fall-through branch for `bytes <= 0` is the literal
 * **`"0 KB"`**, not `"0 B"`.
 */
export function formatShelfBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${formatFixed(bytes / 1024 / 1024 / 1024, 2)} GB`;
  }
  if (bytes >= 1024 * 1024) return `${formatFixed(bytes / 1024 / 1024, 1)} MB`;
  if (bytes >= 1024) return `${formatFixed(bytes / 1024, 1)} KB`;
  if (bytes > 0) return `${formatInt(bytes)} B`;
  return '0 KB';
}

/**
 * Kotlin `CacheManagementScreen.kt:142-147`.
 *
 * Measured: `0 → "0 B"`, `1024 → "1 KB"`, `1536 → "2 KB"` (half-up),
 * `1048575 → "1024 KB"`, `1048576 → "1.0 MB"`, `1073741824 → "1.0 GB"`.
 */
export function formatCacheSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${formatFixed(bytes / 1_073_741_824, 1)} GB`;
  if (bytes >= 1_048_576) return `${formatFixed(bytes / 1_048_576, 1)} MB`;
  if (bytes >= 1_024) return `${formatFixed(bytes / 1_024, 0)} KB`;
  return `${formatInt(bytes)} B`;
}

/**
 * Kotlin `DownloadGlassCard.kt:360-367`.
 *
 * Measured: `0 → "0 B"`, `1 → "0 KB"`, `1023 → "1 KB"`,
 * `1048575 → "1024 KB"`, `1073741824 → "1.00 GB"` (two decimals).
 */
export function formatDownloadBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatFixed(kb, 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${formatFixed(mb, 1)} MB`;
  return `${formatFixed(mb / 1024, 2)} GB`;
}

/**
 * Kotlin `TranslationCacheDetail.kt:287-291` — no space before the unit, and
 * the KB branch is an **integer** division (`bytes / 1024` on `Long`).
 *
 * Measured: `1023 → "1023B"`, `1536 → "1KB"` (not `2KB`),
 * `1048575 → "1023KB"`, `1073741824 → "1024.0MB"`.
 */
export function formatCacheDetailBytes(bytes: number): string {
  if (bytes >= 1 << 20) return `${formatFixed(bytes / 1048576, 1)}MB`;
  if (bytes >= 1 << 10) return `${formatInt(bytes / 1024)}KB`;
  return `${formatInt(bytes)}B`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * §5  Duration formatters
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Kotlin `ReadingStats.kt:58-63` — `"0分钟"`, `"18分钟"`, `"1小时26分钟"`.
 *
 * Integer division truncates, so 3600 s renders `"1小时0分钟"` and 3599 s
 * renders `"59分钟"`; the hour branch is `h > 0`, never `h >= 1 && m > 0`.
 */
export function formatReadDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0分钟';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
}

/**
 * Kotlin `ReadingStats.kt:66-71` — the calendar-cell label: `"12秒"`, `"45分"`,
 * `"3时26分"`.
 *
 * Note `< 60` (not `<= 60`), so 59 s is `"59秒"` and 60 s is `"1分"`; and the
 * hour branch is `m >= 60`, so exactly 3600 s is `"1时0分"`.
 */
export function formatShortDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${formatInt(totalSeconds)}秒`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${formatInt(m)}分`;
  return `${formatInt(Math.floor(m / 60))}时${formatInt(m % 60)}分`;
}

/**
 * Kotlin `StatisticsScreen.kt:416` — `if (avgDaily in 1..59) "不足1分钟"`.
 * Seconds below one minute read as "less than a minute" rather than `"0秒"`.
 */
export function formatAvgDaily(seconds: number): string {
  return seconds >= 1 && seconds <= 59 ? '不足1分钟' : formatShortDuration(seconds);
}

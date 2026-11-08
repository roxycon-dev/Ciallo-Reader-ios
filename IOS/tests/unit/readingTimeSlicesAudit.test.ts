/**
 * Reading-time accounting correctness.
 *
 * Android authority:
 *   - `data/ReadingTimeSlices.kt` — `split(start, end, seconds)`
 *   - `data/BookRepository.kt:753-760` — `addReadingSession` (splits, drops
 *     `seconds <= 0` slices, inserts one row per slice inside a transaction)
 *   - `data/BookRepository.kt:708+` — `addReadingTime` (per (day) upsert-accumulate)
 *   - `MainViewModel.kt:1028` — `ReadingTimeSlices.split(end - bounded*1000, end, bounded)`
 *
 * This is user-visible data (daily/monthly reading stats). Getting the split or
 * the accumulation wrong silently corrupts the numbers the user sees, so the
 * invariants are pinned here rather than left to integration tests.
 */
import { describe, expect, it } from 'vitest';
import { ReadingTimeSlices, splitReadingTimeSlices } from '../../src/core/data/readingTimeSlices';

/** Local-midnight-anchored timestamp helper (no TZ assumptions baked in). */
function at(y: number, m: number, d: number, h: number, min = 0, s = 0): number {
  return new Date(y, m - 1, d, h, min, s, 0).getTime();
}

describe('ReadingTimeSlices — guard clauses (ReadingTimeSlices.kt:10-11)', () => {
  it('returns [] when end <= start', () => {
    const t = at(2026, 3, 10, 12);
    expect(splitReadingTimeSlices(t, t, 600)).toEqual([]);
    expect(splitReadingTimeSlices(t, t - 1000, 600)).toEqual([]);
  });

  it('returns [] when seconds <= 0', () => {
    const a = at(2026, 3, 10, 12);
    expect(splitReadingTimeSlices(a, a + 60_000, 0)).toEqual([]);
    expect(splitReadingTimeSlices(a, a + 60_000, -5)).toEqual([]);
  });

  it('throws on a span over 7 days (require, "阅读会话时间范围异常")', () => {
    const a = at(2026, 3, 1, 0);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(() => splitReadingTimeSlices(a, a + sevenDays + 1, 600)).toThrow(
      '阅读会话时间范围异常',
    );
    // Exactly 7 days is allowed.
    expect(() => splitReadingTimeSlices(a, a + sevenDays, 600)).not.toThrow();
  });
});

describe('ReadingTimeSlices — single-day sessions', () => {
  it('produces exactly one slice covering the whole span', () => {
    const a = at(2026, 3, 10, 14, 30);
    const b = at(2026, 3, 10, 15, 0);
    const slices = splitReadingTimeSlices(a, b, 1800);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({
      date: '2026-03-10',
      start: a,
      end: b,
      seconds: 1800,
      hour: 14,
    });
  });

  it('carries the start hour, not the end hour', () => {
    // 22:30 -> 23:30 on the same day must report hour 22.
    const a = at(2026, 3, 10, 22, 30);
    const b = at(2026, 3, 10, 23, 30);
    expect(splitReadingTimeSlices(a, b, 3600)[0]?.hour).toBe(22);
  });

  it('handles a session that starts exactly at local midnight', () => {
    const a = at(2026, 3, 10, 0, 0, 0);
    const b = at(2026, 3, 10, 0, 10);
    const slices = splitReadingTimeSlices(a, b, 600);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.hour).toBe(0);
    expect(slices[0]?.date).toBe('2026-03-10');
  });
});

describe('ReadingTimeSlices — midnight crossing (the whole point of this file)', () => {
  it('splits 23:50 -> 00:10 across two calendar days', () => {
    const a = at(2026, 3, 10, 23, 50);
    const b = at(2026, 3, 11, 0, 10);
    const slices = splitReadingTimeSlices(a, b, 20 * 60);

    expect(slices).toHaveLength(2);
    expect(slices[0]?.date).toBe('2026-03-10');
    expect(slices[0]?.hour).toBe(23);
    expect(slices[1]?.date).toBe('2026-03-11');
    expect(slices[1]?.hour).toBe(0);

    // Wall-clock proportions: 10 of 20 minutes before midnight.
    expect(slices[0]?.seconds).toBe(600);
    expect(slices[1]?.seconds).toBe(600);
  });

  it('is contiguous: each slice starts where the previous ended', () => {
    const a = at(2026, 3, 10, 20, 0);
    const b = at(2026, 3, 13, 4, 0);
    const slices = splitReadingTimeSlices(a, b, 3 * 24 * 3600 + 4 * 3600);
    expect(slices[0]?.start).toBe(a);
    expect(slices[slices.length - 1]?.end).toBe(b);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.start).toBe(slices[i - 1]?.end);
    }
  });

  it('sums slice seconds back to the exact input (no drift across many days)', () => {
    // A 6-day session forces 7 slices and exercises the proportional allocator
    // plus the "last slice absorbs the remainder" branch.
    const a = at(2026, 3, 10, 9, 15);
    const b = at(2026, 3, 16, 21, 45);
    const total = 6 * 24 * 3600 + 12 * 3600 + 1800;
    const slices = splitReadingTimeSlices(a, b, total);

    expect(slices.length).toBeGreaterThan(1);
    expect(slices.reduce((sum, s) => sum + s.seconds, 0)).toBe(total);
  });

  it('covers a month boundary', () => {
    const a = at(2026, 3, 31, 23, 0);
    const b = at(2026, 4, 1, 1, 0);
    const slices = splitReadingTimeSlices(a, b, 7200);
    expect(slices.map((s) => s.date)).toEqual(['2026-03-31', '2026-04-01']);
    expect(slices[0]?.seconds).toBe(3600);
    expect(slices[1]?.seconds).toBe(3600);
  });

  it('covers a year boundary', () => {
    const a = at(2025, 12, 31, 22, 0);
    const b = at(2026, 1, 1, 2, 0);
    const slices = splitReadingTimeSlices(a, b, 4 * 3600);
    expect(slices.map((s) => s.date)).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('every slice except the first has a strictly smaller-or-equal date ordering', () => {
    const a = at(2026, 3, 10, 20, 0);
    const b = at(2026, 3, 14, 6, 0);
    const slices = splitReadingTimeSlices(a, b, 100000);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]!.date > slices[i - 1]!.date).toBe(true);
      expect(slices[i]!.seconds).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ReadingTimeSlices — reading stats stay monotonic under repeated reads', () => {
  /**
   * Simulates a user opening/pausing the reader repeatedly in one day, then
   * accumulating through `addReadingTime`-style upserts. The total the stats
   * screen shows must equal the sum of the read/stop intervals exactly — no
   * double counting, no lost time.
   */
  it('accumulates repeated read/stop intervals without double counting', () => {
    const base = at(2026, 3, 10, 8, 0);
    const MIN = 60_000;

    // (startOffsetMs, durationMs) pairs — reads separated by stops.
    const intervals: Array<[number, number]> = [
      [0, 5 * MIN],
      [10 * MIN, 3 * MIN],
      [30 * MIN, 12 * MIN],
      [90 * MIN, 1 * MIN],
      [200 * MIN, 30 * MIN],
    ];

    // Per-day totals keyed by dateStr, mirroring BookRepository.addReadingTime.
    const totals = new Map<string, number>();
    let expectedTotal = 0;

    for (const [offset, durationMs] of intervals) {
      const start = base + offset;
      const end = start + durationMs;
      const seconds = Math.round(durationMs / 1000);
      expectedTotal += seconds;

      for (const part of splitReadingTimeSlices(start, end, seconds)) {
        if (part.seconds <= 0) continue; // BookRepository.kt:756 guard
        totals.set(part.date, (totals.get(part.date) ?? 0) + part.seconds);
      }
    }

    const grand = [...totals.values()].reduce((a, b) => a + b, 0);
    expect(grand).toBe(expectedTotal);
    expect(expectedTotal).toBe((5 + 3 + 12 + 1 + 30) * 60);
  });

  it('re-opening the same chapter twice adds both durations (Android has no dedup here)', () => {
    // BookRepository.addReadingTime upserts and ADDS durationSeconds; the same
    // (book, day) row accumulates rather than being replaced.
    const day = at(2026, 3, 10, 10, 0);
    let row = { dateStr: '2026-03-10', durationSeconds: 0 };

    for (const seconds of [300, 450, 600]) {
      const parts = splitReadingTimeSlices(day, day + seconds * 1000, seconds);
      for (const part of parts) {
        if (part.seconds <= 0) continue;
        row = { dateStr: part.date, durationSeconds: row.durationSeconds + part.seconds };
      }
    }

    expect(row.durationSeconds).toBe(1350);
  });

  it('a session spanning midnight credits each day only its own share', () => {
    const a = at(2026, 3, 10, 23, 30);
    const totals = new Map<string, number>();

    // Three consecutive one-hour reads straddling the boundary.
    for (let k = 0; k < 3; k += 1) {
      const s = a + k * 30 * 60_000;
      const e = s + 30 * 60_000;
      for (const part of splitReadingTimeSlices(s, e, 1800)) {
        if (part.seconds <= 0) continue;
        totals.set(part.date, (totals.get(part.date) ?? 0) + part.seconds);
      }
    }

    expect(totals.get('2026-03-10')).toBe(1800);
    expect(totals.get('2026-03-11')).toBe(3600);
  });
});

describe('ReadingTimeSlices — object call-shape parity', () => {
  it('ReadingTimeSlices.split is the same function as the named export', () => {
    const a = at(2026, 3, 10, 12);
    expect(ReadingTimeSlices.split).toBe(splitReadingTimeSlices);
    expect(ReadingTimeSlices.split(a, a + 60_000, 60)).toEqual(
      splitReadingTimeSlices(a, a + 60_000, 60),
    );
  });
});
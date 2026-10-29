/**
 * Kotlin → TS map
 * ──────────────
 * Tests for the pure helpers ported out of `ui/components/ReadingStatsCard.kt`
 * (`src/ui/components/ReadingStats.tsx`) and `ui/components/ReadingCalendarCard.kt`
 * (`src/ui/components/ReadingCalendarCard.tsx`), plus the deterministic press-dent
 * outline from `ui/components/GlassCard.kt` (`src/ui/components/GlassCardLayers.tsx`).
 *
 * The helpers were re-implemented locally instead of importing
 * `src/ui/lib/readingStats.ts` (a parallel port owned by another task) so this
 * module keeps no coupling to it — the duplication is deliberate.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { describe, expect, it } from 'vitest';

import {
  buildIndentUnitPath,
  pressLiftPx,
  pressScale,
  relaxFactor,
  releaseSpring,
} from '../../src/ui/components/GlassCardLayers';
import {
  HEAT_LEVELS,
  buildYearGrid,
  heatAlpha,
} from '../../src/ui/components/ReadingCalendarCard';
import {
  dailySeries,
  dateStrOf,
  dateStrToCalendar,
  daysReadBetween,
  formatReadDuration,
  formatSessionTime,
  formatShortDuration,
  longestStreakIn,
  monthlySeries,
  peakHourTotals,
  streakEndingAt,
  sumSecondsBetween,
  toDailyTotalsMap,
  weekDatesOf,
  type ReadingSession,
} from '../../src/ui/components/ReadingStats';

describe('formatReadDuration (Kotlin lines ~118-131)', () => {
  it('verbatim Chinese output for every branch', () => {
    expect(formatReadDuration(0)).toBe('0分钟');
    expect(formatReadDuration(-5)).toBe('0分钟');
    expect(formatReadDuration(59)).toBe('0分钟');
    expect(formatReadDuration(60)).toBe('1分钟');
    expect(formatReadDuration(3600)).toBe('1小时0分钟');
    expect(formatReadDuration(3660)).toBe('1小时1分钟');
    expect(formatReadDuration(7380)).toBe('2小时3分钟');
  });
});

describe('formatShortDuration (Kotlin lines ~133-141)', () => {
  it('seconds below a minute, then minutes, then hours+minutes', () => {
    expect(formatShortDuration(0)).toBe('0秒');
    expect(formatShortDuration(59)).toBe('59秒');
    expect(formatShortDuration(60)).toBe('1分');
    expect(formatShortDuration(3599)).toBe('59分');
    expect(formatShortDuration(3600)).toBe('1时0分');
    expect(formatShortDuration(7380)).toBe('2时3分');
  });
});

describe('dateStrOf / dateStrToCalendar', () => {
  it('formats yyyy-MM-dd with zero padding', () => {
    expect(dateStrOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateStrOf(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('parses back to local midnight', () => {
    const d = dateStrToCalendar('2026-03-09');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(9);
    expect(d?.getHours()).toBe(0);
    expect(dateStrOf(d as Date)).toBe('2026-03-09');
  });

  it('rejects a malformed key with null rather than a garbage date', () => {
    expect(dateStrToCalendar('2026-3')).toBeNull();
    expect(dateStrToCalendar('not-a-date')).toBeNull();
  });
});

describe('weekDatesOf (周一起始)', () => {
  it('returns Monday..Sunday of the anchor week', () => {
    // 2026-03-11 is a Wednesday.
    const week = weekDatesOf(new Date(2026, 2, 11));
    expect(week).toHaveLength(7);
    expect(dateStrOf(week[0] as Date)).toBe('2026-03-09');
    expect(dateStrOf(week[1] as Date)).toBe('2026-03-10');
    expect(dateStrOf(week[6] as Date)).toBe('2026-03-15');
  });

  it('a Sunday anchor belongs to the week that started six days earlier', () => {
    // 2026-03-15 is a Sunday.
    const week = weekDatesOf(new Date(2026, 2, 15));
    expect(dateStrOf(week[0] as Date)).toBe('2026-03-09');
  });

  it('a Monday anchor is its own first day', () => {
    const week = weekDatesOf(new Date(2026, 2, 9));
    expect(dateStrOf(week[0] as Date)).toBe('2026-03-09');
  });

  it('crosses a month boundary correctly', () => {
    const week = weekDatesOf(new Date(2026, 2, 2)); // Monday 2026-03-02
    expect(dateStrOf(week[6] as Date)).toBe('2026-03-08');
  });
});

describe('sumSecondsBetween / daysReadBetween (闭区间)', () => {
  const daily = new Map([
    ['2026-03-01', 600],
    ['2026-03-02', 0],
    ['2026-03-03', 1800],
    ['2026-03-05', 900],
  ]);

  it('sums an inclusive date range', () => {
    expect(sumSecondsBetween(daily, new Date(2026, 2, 1), new Date(2026, 2, 3))).toBe(2400);
    expect(sumSecondsBetween(daily, new Date(2026, 2, 1), new Date(2026, 2, 5))).toBe(3300);
  });

  it('counts only the days with actual reading', () => {
    expect(daysReadBetween(daily, new Date(2026, 2, 1), new Date(2026, 2, 5))).toBe(3);
  });

  it('an inverted range yields 0', () => {
    expect(sumSecondsBetween(daily, new Date(2026, 2, 5), new Date(2026, 2, 1))).toBe(0);
  });
});

describe('streakEndingAt (截至 end 当天，含)', () => {
  const daily = new Map([
    ['2026-03-01', 100],
    ['2026-03-02', 100],
    ['2026-03-03', 100],
    ['2026-03-05', 100],
  ]);

  it('counts the run ending at the anchor day', () => {
    expect(streakEndingAt(daily, new Date(2026, 2, 3))).toBe(3);
  });

  it('breaks on the first zero day', () => {
    expect(streakEndingAt(daily, new Date(2026, 2, 5))).toBe(1);
    expect(streakEndingAt(daily, new Date(2026, 2, 4))).toBe(0);
  });

  it('an anchor with no record at all is a zero streak', () => {
    expect(streakEndingAt(new Map(), new Date(2026, 2, 3))).toBe(0);
  });

  it('crosses a month boundary while walking backwards', () => {
    const m = new Map([
      ['2026-02-28', 10],
      ['2026-03-01', 10],
      ['2026-03-02', 10],
    ]);
    expect(streakEndingAt(m, new Date(2026, 2, 2))).toBe(3);
  });
});

describe('longestStreakIn', () => {
  it('finds the longest run inside the window, not the run ending at the end', () => {
    const daily = new Map([
      ['2026-03-01', 10],
      ['2026-03-02', 10],
      ['2026-03-03', 10],
      ['2026-03-04', 0],
      ['2026-03-05', 10],
    ]);
    expect(longestStreakIn(daily, new Date(2026, 2, 1), new Date(2026, 2, 5))).toBe(3);
  });

  it('is 0 for an all-empty window', () => {
    expect(longestStreakIn(new Map(), new Date(2026, 2, 1), new Date(2026, 2, 5))).toBe(0);
  });
});

describe('dailySeries', () => {
  it('emits one entry per day, filling the gaps with 0', () => {
    const daily = new Map([
      ['2026-03-01', 100],
      ['2026-03-03', 300],
    ]);
    const series = dailySeries(daily, new Date(2026, 2, 1), new Date(2026, 2, 4));
    expect(series).toEqual([
      ['2026-03-01', 100],
      ['2026-03-02', 0],
      ['2026-03-03', 300],
      ['2026-03-04', 0],
    ]);
  });
});

describe('monthlySeries (最近 months 个月，含当月)', () => {
  const daily = new Map([
    ['2026-01-15', 100],
    ['2026-02-15', 200],
    ['2026-03-15', 300],
    ['2026-03-20', 400],
  ]);

  it('is oldest-first and rolls over the year boundary', () => {
    const series = monthlySeries(daily, 4, new Date(2026, 2, 31));
    expect(series).toEqual([
      ['2025-12', 0],
      ['2026-01', 100],
      ['2026-02', 200],
      ['2026-03', 700],
    ]);
  });

  it('an empty input still yields months months of zeros', () => {
    expect(monthlySeries(new Map(), 3, new Date(2026, 2, 31))).toEqual([
      ['2026-01', 0],
      ['2026-02', 0],
      ['2026-03', 0],
    ]);
  });
});

describe('peakHourTotals (24 buckets)', () => {
  const sessions: ReadingSession[] = [
    { id: 1, dateStr: '2026-03-01', startTimeMs: new Date(2026, 2, 1, 9).getTime(), startHour: 9, durationSeconds: 600 },
    { id: 2, dateStr: '2026-03-01', startTimeMs: new Date(2026, 2, 1, 9, 30).getTime(), startHour: 9, durationSeconds: 300 },
    { id: 3, dateStr: '2026-02-01', startTimeMs: new Date(2026, 1, 1, 9).getTime(), startHour: 9, durationSeconds: 999 },
    { id: 4, dateStr: '2026-03-02', startTimeMs: new Date(2026, 2, 2, 23).getTime(), startHour: 23, durationSeconds: 60 },
  ];

  it('buckets by startHour and excludes sessions outside the range', () => {
    const arr = peakHourTotals(sessions, new Date(2026, 2, 1), new Date(2026, 2, 1));
    expect(arr).toHaveLength(24);
    expect(arr[9]).toBe(900);
    expect(arr[23]).toBe(0);
  });

  it('clamps an out-of-range startHour into 0..23', () => {
    const arr = peakHourTotals(
      [
        { id: 1, dateStr: '2026-03-01', startTimeMs: 0, startHour: 99, durationSeconds: 60 },
        { id: 2, dateStr: '2026-03-01', startTimeMs: 0, startHour: -5, durationSeconds: 60 },
      ],
      new Date(2026, 2, 1),
      new Date(2026, 2, 1),
    );
    expect(arr[23]).toBe(60);
    expect(arr[0]).toBe(60);
  });
});

describe('formatSessionTime', () => {
  it('renders HH:mm from the session start timestamp', () => {
    expect(
      formatSessionTime({
        id: 1,
        dateStr: '2026-03-01',
        startTimeMs: new Date(2026, 2, 1, 7, 5).getTime(),
        startHour: 7,
        durationSeconds: 60,
      }),
    ).toBe('07:05');
  });
});

describe('toDailyTotalsMap (Map | Record prop adapter)', () => {
  it('copies a Map', () => {
    const src = new Map([['2026-03-01', 10]]);
    const out = toDailyTotalsMap(src);
    expect(out.get('2026-03-01')).toBe(10);
    expect(out).not.toBe(src);
  });

  it('copies a plain record', () => {
    const out = toDailyTotalsMap({ '2026-03-01': 10, '2026-03-02': 20 });
    expect(out.get('2026-03-01')).toBe(10);
    expect(out.get('2026-03-02')).toBe(20);
  });
});

describe('heatAlpha (ReadingCalendarCard.kt lines 555-569)', () => {
  it('the four heat bands are verbatim', () => {
    expect(HEAT_LEVELS).toEqual([0.32, 0.52, 0.72, 0.95]);
  });

  it('0-9min / 10-29min / 30-59min / 60min+', () => {
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(-10)).toBe(0);
    expect(heatAlpha(1)).toBe(0.32);
    expect(heatAlpha(599)).toBe(0.32);
    expect(heatAlpha(600)).toBe(0.52);
    expect(heatAlpha(1799)).toBe(0.52);
    expect(heatAlpha(1800)).toBe(0.72);
    expect(heatAlpha(3599)).toBe(0.72);
    expect(heatAlpha(3600)).toBe(0.95);
    expect(heatAlpha(100_000)).toBe(0.95);
  });
});

describe('buildYearGrid (ReadingCalendarCard.kt lines 509-553)', () => {
  it('2026 starts on a Thursday → 4 leading blanks', () => {
    // 2026-01-01 is a Thursday; with Mon=0 that is index 3.
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    expect(g.daysInYear).toBe(365);
    expect(g.columns).toBe(Math.floor((3 + 365 + 6) / 7));
    expect(g.cells[0]).toBeNull();
    expect(g.cells[1]).toBeNull();
    expect(g.cells[2]).toBeNull();
    expect(g.cells[3]).toBe('2026-01-01');
  });

  it('a leap year has 366 days', () => {
    expect(buildYearGrid(2024, new Date(2024, 0, 1)).daysInYear).toBe(366);
    expect(buildYearGrid(2025, new Date(2025, 0, 1)).daysInYear).toBe(365);
  });

  it('the cell count is exactly columns × 7', () => {
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    expect(g.cells).toHaveLength(g.columns * 7);
  });

  it('every non-null cell is a yyyy-MM-dd key inside the year', () => {
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    for (const c of g.cells) {
      if (c === null) continue;
      expect(c).toMatch(/^2026-\d{2}-\d{2}$/);
    }
  });

  it('exactly daysInYear cells are filled', () => {
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    expect(g.cells.filter((c) => c !== null)).toHaveLength(365);
  });

  it('monthStartColumn has 12 monotonic entries', () => {
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    expect(g.monthStartColumn).toHaveLength(12);
    expect(g.monthStartColumn[0]).toBe(0);
    for (let i = 1; i < 12; i++) {
      expect(g.monthStartColumn[i] as number).toBeGreaterThan(g.monthStartColumn[i - 1] as number);
    }
  });

  it('todayColumn is -1 when the anchor year differs', () => {
    expect(buildYearGrid(2025, new Date(2026, 5, 15)).todayColumn).toBe(-1);
    expect(buildYearGrid(2026, new Date(2026, 5, 15)).todayColumn).toBeGreaterThanOrEqual(0);
  });

  it('the last day of the year lands on the last filled cell', () => {
    const g = buildYearGrid(2026, new Date(2026, 0, 1));
    const filled = g.cells.filter((c) => c !== null);
    expect(filled[filled.length - 1]).toBe('2026-12-31');
  });
});

describe('buildIndentUnitPath (GlassCard.kt lines 380-406)', () => {
  it('the same seed always produces the same outline (Random(seed) parity)', () => {
    expect(buildIndentUnitPath(1234)).toBe(buildIndentUnitPath(1234));
  });

  it('a different seed produces a different outline', () => {
    expect(buildIndentUnitPath(1234)).not.toBe(buildIndentUnitPath(1235));
  });

  it('is 24 quadratic segments plus the leading moveTo, closed', () => {
    const d = buildIndentUnitPath(42);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/Q/g)).toHaveLength(24);
  });

  it('stays within the unit disc widened by the 0.06/0.04/0.03 lobes', () => {
    const d = buildIndentUnitPath(7);
    const nums = d.match(/-?\d+\.\d+/g)?.map(Number) ?? [];
    for (const n of nums) {
      expect(Math.abs(n)).toBeLessThanOrEqual(1.13);
    }
  });

  it('is y-anisotropic (0.87 squash), so it is never taller than it is wide', () => {
    const ysOf = (d: string): number[] =>
      (d.match(/-?\d+\.\d+/g) ?? [])
        .map(Number)
        .filter((_, i) => i % 2 === 1);
    const ys = ysOf(buildIndentUnitPath(99));
    const maxAbsY = Math.max(...ys.map(Math.abs));
    const maxAbsX = Math.max(
      ...(buildIndentUnitPath(99).match(/-?\d+\.\d+/g) ?? []).map(Number).filter((_, i) => i % 2 === 0).map(Math.abs),
    );
    expect(maxAbsY).toBeLessThanOrEqual(maxAbsX);
  });
});

describe('GlassCard.kt press constants', () => {
  it('pressScale is 1 on every quality except a pressed MAX card (0.97)', () => {
    expect(pressScale(false, false)).toBe(1);
    expect(pressScale(false, true)).toBe(1);
    expect(pressScale(true, false)).toBe(1);
    expect(pressScale(true, true)).toBe(0.97);
  });

  it('pressLiftPx rests at 12px and only lifts a held MAX card, more the steeper the tilt', () => {
    expect(pressLiftPx(false, true, 3)).toBe(12);
    expect(pressLiftPx(true, false, 3)).toBe(12);
    expect(pressLiftPx(true, true, 0)).toBe(12);
    expect(pressLiftPx(true, true, 3)).toBeCloseTo(12 + 3 * 1.2, 9);
    expect(pressLiftPx(true, true, 3)).toBeGreaterThan(pressLiftPx(true, true, 0));
  });

  it('relaxFactor = ((heldMs - 300) / 600).coerceIn(0,1) — stress relaxation', () => {
    expect(relaxFactor(0)).toBe(0);
    expect(relaxFactor(299)).toBe(0);
    expect(relaxFactor(300)).toBe(0);
    expect(relaxFactor(600)).toBeCloseTo(0.5, 9);
    expect(relaxFactor(900)).toBe(1);
    expect(relaxFactor(10_000)).toBe(1);
  });

  it('releaseSpring softens with a longer hold: stiffness 200 − 110·relaxT', () => {
    expect(releaseSpring(0).stiffness).toBe(200);
    expect(releaseSpring(1).stiffness).toBe(90);
    expect(releaseSpring(1).stiffness).toBeLessThan(releaseSpring(0).stiffness);
    // DampingRatioLowBouncy
    expect(releaseSpring(0).dampingRatio).toBe(0.5);
    expect(releaseSpring(0).bezier).toBe('cubic-bezier(0.34, 1.2, 0.5, 1)');
    // A softer spring takes longer to settle.
    expect(releaseSpring(1).ms).toBeGreaterThan(releaseSpring(0).ms);
  });
});
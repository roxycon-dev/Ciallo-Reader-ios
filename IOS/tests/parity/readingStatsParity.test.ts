/**
 * readingStatsParity.test.ts —— 统计页的 16 个纯聚合函数逐条对拍。
 *
 * `ui/components/ReadingStats.kt`（212 行）是统计页的**唯一数据基准**：
 * 所有周期统计（本周 / 本月 / 连续天数 / 最长连续 / 高峰时段 / 月度序列）
 * 都在这里按「日期字符串比较」的方式算出来。日期字符串是 `yyyy-MM-dd`，
 * 字典序恰好等于时间序 —— 这个前提一旦被破坏（比如某处产出 `yyyy-M-d`），
 * 所有区间统计都会静默错位。所以这批断言的重点是**跨月/跨年/跨周边界**。
 *
 * 本轮补的缺口：`longestStreakIn` 在 iOS 侧**没有对应实现**（只有 `streakEndingAt`）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dateStrOf,
  daysReadBetween,
  dailySeries,
  formatReadDuration,
  formatSessionTime,
  formatShortDuration,
  longestStreakIn,
  monthlySeries,
  peakHourTotals,
  readingRecordsToDailyTotals,
  streakEndingAt,
  sumSecondsBetween,
  weekDatesOf,
} from '@ui/lib/readingStats';
import { setAppLanguage } from '@core/i18n/locale';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/ReadingStats.kt'),
  'utf8',
);

/** 构造本地零点的 Date（避免时区把日期串推前/推后一天）。 */
function d(y: number, m: number, day: number, h = 0): Date {
  return new Date(y, m - 1, day, h, 0, 0, 0);
}

describe('ReadingStats.kt：时长格式化（中英双语）', () => {
  it('formatReadDuration：0 / 分 / 时+分，两种语言逐字对拍', () => {
    expect(KT).toContain('if (totalSeconds <= 0) return if (en) "0 min" else "0分钟"');
    expect(KT).toContain('en && h > 0 -> "${h}h ${m}m"');
    expect(KT).toContain('h > 0 -> "${h}小时${m}分钟"');
    expect(KT).toContain('else -> "${m}分钟"');

    setAppLanguage('zh');
    expect(formatReadDuration(0)).toBe('0分钟');
    expect(formatReadDuration(-5)).toBe('0分钟');
    expect(formatReadDuration(59)).toBe('0分钟');
    expect(formatReadDuration(60)).toBe('1分钟');
    expect(formatReadDuration(3599)).toBe('59分钟');
    expect(formatReadDuration(3600)).toBe('1小时0分钟');
    expect(formatReadDuration(3661)).toBe('1小时1分钟');

    setAppLanguage('en');
    expect(formatReadDuration(0)).toBe('0 min');
    expect(formatReadDuration(59)).toBe('0 min');
    expect(formatReadDuration(60)).toBe('1 min');
    expect(formatReadDuration(3600)).toBe('1h 0m');
    expect(formatReadDuration(7325)).toBe('2h 2m');
    setAppLanguage('zh');
  });

  it('formatShortDuration：秒 / 分 / 时+分（日历格小标签）', () => {
    expect(KT).toContain('if (totalSeconds < 60) return "${totalSeconds}s"');
    expect(KT).toContain('if (totalSeconds < 60) return "${totalSeconds}秒"');

    setAppLanguage('zh');
    expect(formatShortDuration(12)).toBe('12秒');
    expect(formatShortDuration(59)).toBe('59秒');
    expect(formatShortDuration(60)).toBe('1分');
    expect(formatShortDuration(3599)).toBe('59分');
    expect(formatShortDuration(3600)).toBe('1时0分');
    expect(formatShortDuration(7380)).toBe('2时3分');

    setAppLanguage('en');
    expect(formatShortDuration(12)).toBe('12s');
    expect(formatShortDuration(60)).toBe('1m');
    expect(formatShortDuration(3600)).toBe('1h0m');
    expect(formatShortDuration(7380)).toBe('2h3m');
    setAppLanguage('zh');
  });
});

describe('ReadingStats.kt：日期串与周区间', () => {
  it('dateStrOf 是 yyyy-MM-dd（补零，字典序 = 时间序）', () => {
    expect(dateStrOf(d(2026, 1, 5))).toBe('2026-01-05');
    expect(dateStrOf(d(2026, 12, 31))).toBe('2026-12-31');
    // 补零是硬要求：不补零会让 '2026-1-5' > '2026-12-31'
    expect(dateStrOf(d(2026, 1, 5)) < '2026-01-06').toBe(true);
  });

  it('weekDatesOf：周一到周日 7 天，周日归到上一周', () => {
    expect(KT).toContain('val diffToMonday = if (dow == Calendar.SUNDAY) -6 else Calendar.MONDAY - dow');
    // 2026-11-16 是周一
    const monday = weekDatesOf(d(2026, 11, 16));
    expect(monday).toHaveLength(7);
    expect(monday.map(dateStrOf)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    // 周三调用 → 同一周（仍从周一算）
    expect(weekDatesOf(d(2026, 11, 18))[0] !== undefined && dateStrOf(weekDatesOf(d(2026, 11, 18))[0] as Date)).toBe('2026-11-16');
    // 周日调用 → 该周日属于**上一周**的末尾
    const sunday = weekDatesOf(d(2026, 11, 22));
    expect(dateStrOf(sunday[0] as Date)).toBe('2026-11-16');
    expect(dateStrOf(sunday[6] as Date)).toBe('2026-11-22');
  });
});

describe('ReadingStats.kt：区间聚合', () => {
  const daily = new Map<string, number>([
    ['2026-11-10', 600],
    ['2026-11-11', 0],
    ['2026-11-12', 1200],
    ['2026-11-13', 900],
    ['2026-11-14', 300],
  ]);

  it('sumSecondsBetween / daysReadBetween 是闭区间，且只数 > 0 的天', () => {
    expect(KT).toContain('fun sumSecondsBetween');
    expect(KT).toContain('return daily.entries.count { it.key >= fromStr && it.key <= toStr && it.value > 0 }');
    expect(sumSecondsBetween(daily, d(2026, 11, 10), d(2026, 11, 14))).toBe(3000);
    expect(sumSecondsBetween(daily, d(2026, 11, 11), d(2026, 11, 12))).toBe(1200);
    expect(sumSecondsBetween(daily, d(2026, 11, 20), d(2026, 11, 25))).toBe(0);
    expect(daysReadBetween(daily, d(2026, 11, 10), d(2026, 11, 14))).toBe(4);
  });

  it('streakEndingAt：从 end 往回数连续有阅读的天；中间断一天即停', () => {
    expect(KT).toContain('val v = daily[dateStrOf(cal)] ?: 0L');
    // 从 11-14 往回：14(300) → 13(900) → 12(1200) → 11(0) 停 = 3
    expect(streakEndingAt(daily, d(2026, 11, 14))).toBe(3);
    // end 当天没读 → 0
    expect(streakEndingAt(daily, d(2026, 11, 11))).toBe(0);
    // 全空 → 0
    expect(streakEndingAt(new Map(), d(2026, 11, 14))).toBe(0);
  });

  it('longestStreakIn：区间内最长连续段（本轮补齐的函数）', () => {
    expect(KT).toContain('fun longestStreakIn(daily: Map<String, Long>, from: Calendar, to: Calendar): Int');
    expect(KT).toContain('current = if (v > 0) current + 1 else 0');
    // 11-10 到 11-14：段长依次 1,0,1,2,3 → 最长 3
    expect(longestStreakIn(daily, d(2026, 11, 10), d(2026, 11, 14))).toBe(3);
    // 只看后半段（12..14）→ 3
    expect(longestStreakIn(daily, d(2026, 11, 12), d(2026, 11, 14))).toBe(3);
    // 只看 10..11（含空格）→ 1
    expect(longestStreakIn(daily, d(2026, 11, 10), d(2026, 11, 11))).toBe(1);
    // 空区间
    expect(longestStreakIn(new Map(), d(2026, 11, 10), d(2026, 11, 14))).toBe(0);
  });

  it('dailySeries：逐日 (dateStr, seconds)，缺失日补 0', () => {
    const series = dailySeries(daily, d(2026, 11, 10), d(2026, 11, 14));
    expect(series.map(([day]) => day)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(series.map(([, sec]) => sec)).toEqual([600, 0, 1200, 900, 300]);
    // 请求区间超出数据范围时补 0，不丢天
    const wider = dailySeries(daily, d(2026, 11, 8), d(2026, 11, 10));
    expect(wider).toHaveLength(3);
    expect(wider[0]).toEqual(['2026-11-08', 0]);
  });

  it('monthlySeries：从 end 所在月起往回 months 个月，前缀 yyyy-MM 求和', () => {
    expect(KT).toContain('val total = daily.entries.filter { it.key.startsWith(prefix) }.sumOf { it.value }');
    const multi = new Map<string, number>([
      ['2026-09-05', 100],
      ['2026-10-01', 200],
      ['2026-10-31', 300],
      ['2026-11-15', 400],
    ]);
    const series = monthlySeries(multi, 3, d(2026, 11, 20));
    expect(series.map(([month]) => month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(series.map(([, sec]) => sec)).toEqual([100, 500, 400]);
    // 跨年：end 在 2027-01 → 前两个月是 2026-11 / 2026-12
    const acrossYear = monthlySeries(multi, 3, d(2027, 1, 3));
    expect(acrossYear.map(([month]) => month)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('ReadingStats.kt：会话聚合', () => {
  it('readingRecordsToDailyTotals：同一天多条记录累加', () => {
    const records = [
      { dateStr: '2026-11-10', durationSeconds: 60 },
      { dateStr: '2026-11-10', durationSeconds: 90 },
      { dateStr: '2026-11-11', durationSeconds: 30 },
    ];
    const totals = readingRecordsToDailyTotals(records as never);
    expect(totals.get('2026-11-10')).toBe(150);
    expect(totals.get('2026-11-11')).toBe(30);
    expect(totals.size).toBe(2);
  });

  it('peakHourTotals：24 槽，只在区间内的会话、小时钳到 0..23', () => {
    expect(KT).toContain('val arr = LongArray(24)');
    expect(KT).toContain('arr[it.startHour.coerceIn(0, 23)] += it.durationSeconds');
    const sessions = [
      { dateStr: '2026-11-10', startHour: 9, durationSeconds: 100, startTimeMs: 0 },
      { dateStr: '2026-11-10', startHour: 9, durationSeconds: 50, startTimeMs: 0 },
      { dateStr: '2026-11-11', startHour: 25, durationSeconds: 70, startTimeMs: 0 }, // 越界小时
      { dateStr: '2026-12-01', startHour: 3, durationSeconds: 999, startTimeMs: 0 }, // 区间外
    ];
    const hours = peakHourTotals(sessions as never, d(2026, 11, 10), d(2026, 11, 11));
    expect(hours).toHaveLength(24);
    expect(hours[9]).toBe(150);
    expect(hours[23]).toBe(70);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(220);
  });

  it('formatSessionTime：HH:mm（本地时区）', () => {
    expect(formatSessionTime({ startTimeMs: d(2026, 11, 10, 9).getTime() } as never)).toBe('09:00');
    expect(formatSessionTime({ startTimeMs: d(2026, 11, 10, 23).getTime() } as never)).toBe('23:00');
  });
});

describe('ReadingStats.kt：今天可观察（每分钟比对年月日）', () => {
  it('跨天/跨年都要重算（DAY_OF_YEAR 单独比会在闰年尾出错）', () => {
    expect(KT).toContain('delay(60_000L)');
    expect(KT).toContain('now.get(Calendar.YEAR) != cur.get(Calendar.YEAR)');
    expect(KT).toContain('now.get(Calendar.DAY_OF_YEAR) != cur.get(Calendar.DAY_OF_YEAR)');
    expect(KT).toContain('跨年也要重算');
  });
});

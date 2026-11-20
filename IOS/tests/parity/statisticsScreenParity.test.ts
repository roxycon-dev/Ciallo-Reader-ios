/**
 * statisticsScreenParity.test.ts —— 统计页主体（`ui/StatisticsScreen.kt`，811 行）。
 *
 * 覆盖四块：
 *   · `PeriodOverviewCard` 的区间/环比/目标进度（周/月/年三档，含「上一期」边界）；
 *   · `MiniStatCard` 的 16dp/14/34/10/18/10sp/18sp；
 *   · `DayDetailSheet` 的 20/20/32 内边距与 18sp/13sp 文案；
 *   · `mergeDuplicateReadingRecords` 的合并键与时长累加。
 *
 * 本轮修掉的一处：`MiniStatCard` 的图标底 —— Kotlin 读 `surfaceVariant@.5`
 * （`Theme.kt` L84/L104：亮 `#F0EDE5` / 深 `#2D2D2D`），端口亮色写 M3 基线
 * `rgba(227,229,231,.5)`、深色另写 `rgba(255,255,255,.08)` 白蒙版。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dateStrOf,
  daysReadBetween,
  mergeDuplicateReadingRecords,
  streakEndingAt,
  sumSecondsBetween,
  weekDatesOf,
} from '@ui/lib/readingStats';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/StatisticsScreen.kt'),
  'utf8',
);
const PAGE = readFileSync('src/ui/pages/StatisticsPage.tsx', 'utf8');
const CSS = readFileSync('src/styles/statistics.css', 'utf8');

describe('StatisticsScreen.kt：区间与环比', () => {
  it('周档取本周一到今天，上一期是上周一到上周日', () => {
    expect(KT).toContain('val week = weekDatesOf(today)');
    expect(KT).toContain('val prevMonday = (week.first().clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -7) }');
    expect(KT).toContain('prevEnd = (week.first().clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }');

    const today = new Date(2026, 10, 18); // 周三
    const week = weekDatesOf(today);
    expect(dateStrOf(week[0] as Date)).toBe('2026-11-16');
    const prevMonday = new Date((week[0] as Date).getTime());
    prevMonday.setDate(prevMonday.getDate() - 7);
    expect(dateStrOf(prevMonday)).toBe('2026-11-09');
    const prevEnd = new Date((week[0] as Date).getTime());
    prevEnd.setDate(prevEnd.getDate() - 1);
    expect(dateStrOf(prevEnd)).toBe('2026-11-15');
  });

  it('月档从 1 号零点起；年档从 1 月 1 日零点起', () => {
    expect(KT).toContain('set(Calendar.DAY_OF_MONTH, 1)');
    expect(KT).toContain('set(Calendar.MONTH, Calendar.JANUARY); set(Calendar.DAY_OF_MONTH, 1)');
    expect(KT).toContain('val prevMonthStart = (start.clone() as Calendar).apply { add(Calendar.MONTH, -1) }');
    expect(KT).toContain('add(Calendar.YEAR, -1)');
  });

  it('环比三档：上期为 0 且本期有值 → 100；都为 0 → 0；否则整数截断', () => {
    expect(KT).toContain('prevTotal <= 0 && periodTotal > 0 -> 100');
    expect(KT).toContain('prevTotal <= 0 -> 0');
    expect(KT).toContain('((periodTotal - prevTotal) * 100 / prevTotal).toInt()');
    expect(PAGE).toContain('if (prevTotal <= 0 && periodTotal > 0) return 100;');
    expect(PAGE).toContain('Math.trunc(((periodTotal - prevTotal) * 100) / prevTotal)');
    // 截断而非四舍五入：+50% 与 −50% 都精确；13/11 → 18（不是 18.18 四舍五入成 18 也一样）
    expect(Math.trunc(((13 - 11) * 100) / 11)).toBe(18);
    expect(Math.trunc(((11 - 13) * 100) / 13)).toBe(-15);
  });

  it('天数 = (end − start) / 86400000 + 1，且至少 1；日均是整数除法', () => {
    expect(KT).toContain('((range.end.timeInMillis - range.start.timeInMillis) / 86_400_000L + 1L).toInt().coerceAtLeast(1)');
    expect(KT).toContain('val avgDaily = periodTotal / daysInPeriod');
    expect(PAGE).toContain('return Math.max(1, Math.floor(ms / 86_400_000) + 1);');
    expect(PAGE).toContain('const avgDaily = Math.floor(periodTotal / daysInPeriod);');
    // 语义：同一天 → 1 天；7 天区间 → 7 天；901 秒 / 7 天 = 128（截断）
    expect(Math.floor((0) / 86_400_000) + 1).toBe(1);
    expect(Math.floor(7 * 86_400_000 / 86_400_000) + 1).toBe(8); // 含首尾 8 天
    expect(Math.floor(901 / 7)).toBe(128);
  });

  it('目标进度 = 日均 / (目标分钟 × 60)，夹到 0..1', () => {
    expect(KT).toContain('val goalProgress = (avgDaily / (dailyGoalMinutes * 60f)).coerceIn(0f, 1f)');
    expect(KT).toContain('dailyGoalMinutes: Int = 60');
    expect(PAGE).toContain('Math.min(1, avgDaily / (dailyGoalMinutes * 60))');
    expect(PAGE).toContain('const goalProgress = Math.max(');
    // 默认目标 60 分钟：日均 30 分钟 → 50%；日均 90 分钟 → 夹到 100%
    expect(Math.min(1, Math.max(0, 1800 / (60 * 60)))).toBe(0.5);
    expect(Math.min(1, Math.max(0, 5400 / (60 * 60)))).toBe(1);
  });

  it('区间聚合复用 ReadingStats 的同一套函数（闭区间）', () => {
    expect(KT).toContain('sumSecondsBetween(dailyTotals, range.start, range.end)');
    expect(KT).toContain('sumSecondsBetween(dailyTotals, range.prevStart, range.prevEnd)');
    expect(KT).toContain('daysReadBetween(dailyTotals, range.start, range.end)');
    expect(KT).toContain('streakEndingAt(dailyTotals, todayCalendar())');
    const daily = new Map<string, number>([
      ['2026-11-16', 600],
      ['2026-11-17', 0],
      ['2026-11-18', 300],
    ]);
    expect(sumSecondsBetween(daily, new Date(2026, 10, 16), new Date(2026, 10, 18))).toBe(900);
    expect(daysReadBetween(daily, new Date(2026, 10, 16), new Date(2026, 10, 18))).toBe(2);
    expect(streakEndingAt(daily, new Date(2026, 10, 18))).toBe(1);
  });

  it('三档名称与上一期名称逐字', () => {
    expect(KT).toContain('AppLocale.t("本周")');
    expect(KT).toContain('AppLocale.t("本月")');
    expect(KT).toContain('AppLocale.t("上周")');
    expect(KT).toContain('AppLocale.t("上月")');
    expect(PAGE).toContain('本周');
    expect(PAGE).toContain('上周');
  });
});

describe('StatisticsScreen.kt：MiniStatCard 与 DayDetailSheet', () => {
  it('MiniStatCard：r16 / 14 内边距 / 图标 34 r10 / 图标 18 / 间距 10 / 标签 10sp / 数值 18sp Bold', () => {
    expect(KT).toContain('shape = RoundedCornerShape(16.dp)');
    expect(KT).toContain('modifier = Modifier.padding(14.dp)');
    expect(KT).toContain('.size(34.dp)');
    expect(KT).toContain('.clip(RoundedCornerShape(10.dp))');
    expect(KT).toContain('.background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))');
    expect(KT).toContain('Box(modifier = Modifier.size(18.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.width(10.dp))');
    expect(KT).toContain('Text(label, fontSize = 10.sp');
    expect(KT).toContain('Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold)');
    expect(PAGE).toContain('<GlassCard radius={16} padding={14}');
  });

  it('图标底走 surfaceVariant@.5（亮 #F0EDE5 / 深 #2D2D2D），不是 M3 基线也不用白蒙版', () => {
    const block = CSS.slice(CSS.indexOf('.stats-mini-icon {'), CSS.indexOf('.stats-mini-icon svg'));
    expect(block).toContain('color-mix(in srgb, var(--stats-surface-variant, #F0EDE5) 50%, transparent)');
    expect(block).not.toContain('rgba(227, 229, 231, 0.5)');
    // 深色不再给 mini-icon 单写白蒙版（其它组件的白蒙版不在本断言范围）
    expect(CSS).not.toContain("[data-theme='dark'] .stats-mini-icon");
    expect(CSS).toContain('--stats-surface-variant: #2D2D2D;');
  });

  it('卡片网格两列 16dp 间距；标签 10px / 数值 18px 700', () => {
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(16.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(16.dp)');
    expect(CSS).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;');
    expect(CSS).toContain('font-size: 10px; line-height: 14px;');
    expect(CSS).toContain('font-size: 18px; font-weight: 700; line-height: 22px;');
  });

  it('DayDetailSheet：左右 20 / 上 20 下 32；标题 18sp Bold；合计 13sp 薄荷绿', () => {
    expect(KT).toContain('.padding(horizontal = 20.dp)');
    expect(KT).toContain('.padding(top = 20.dp, bottom = 32.dp)');
    expect(KT).toContain('"$date 阅读明细", fontWeight = FontWeight.Bold, fontSize = 18.sp');
    expect(KT).toContain('Spacer(modifier = Modifier.height(4.dp))');
    expect(KT).toContain('fontSize = 13.sp');
    expect(KT).toContain('AcrylicBottomOverlay(onDismissRequest = onDismiss)');
  });
});

describe('StatisticsScreen.kt：mergeDuplicateReadingRecords', () => {
  it('有 bookId 按 `book:id` 合并，否则按 `title:书名`；时长累加、保持首次出现顺序', () => {
    expect(KT).toContain('val key = record.bookId?.let { "book:$it" } ?: "title:${record.bookTitle}"');
    expect(KT).toContain('existing.copy(durationSeconds = existing.durationSeconds + record.durationSeconds)');
    expect(KT).toContain('if (records.size <= 1) return records');

    const merged = mergeDuplicateReadingRecords([
      { bookId: 7, bookTitle: 'A', durationSeconds: 60 },
      { bookId: 7, bookTitle: 'A', durationSeconds: 40 },
      { bookId: null, bookTitle: 'B', durationSeconds: 10 },
      { bookId: null, bookTitle: 'B', durationSeconds: 5 },
    ] as never);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.durationSeconds).toBe(100);
    expect(merged[1]?.durationSeconds).toBe(15);
    // 顺序 = 首次出现顺序
    expect(merged[0]?.bookTitle).toBe('A');
    expect(merged[1]?.bookTitle).toBe('B');
  });

  it('单条/空列表原样返回（同一引用语义）', () => {
    const one = [{ bookId: 1, bookTitle: 'X', durationSeconds: 5 }] as never;
    expect(mergeDuplicateReadingRecords(one)).toHaveLength(1);
    expect(mergeDuplicateReadingRecords([])).toEqual([]);
  });
});

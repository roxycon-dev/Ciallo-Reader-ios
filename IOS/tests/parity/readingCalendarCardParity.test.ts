/**
 * readingCalendarCardParity.test.ts —— 阅读日历（`ui/components/ReadingCalendarCard.kt`，587 行）。
 *
 * 三块可判定的东西：
 *   ① `HEAT_LEVELS` / `heatAlpha` —— 四档 0.32 / 0.52 / 0.72 / 0.95，分界 600 / 1800 / 3600 秒；
 *   ② `buildYearGrid(year)` —— 列 = 周、行 = 星期（周一起始）、`columns = (jan1Dow + days + 6) / 7`、
 *      `monthStartColumn`、`todayColumn`（非本年 = −1）、`cells[col*7+row]`；
 *   ③ 视觉常量：月格 r8 / 2dp 间距 / 正方形、年格 r3、峰值金点 5dp@3dp、今天描边 1.5dp、
 *      年视图 gap 3 / 最小格 16 / 周标签列宽 20。
 *
 * 本轮修掉的四处：
 *   · `buildYearGrid` 用**本地**毫秒差算全年天数 —— 跨夏令时的年份会少一天（整年错开一列）；
 *   · 空格子底色写死浅灰（`surfaceVariant` 是主题色，深色下应是 `#2D2D2D`）；
 *   · 年视图空格写死亮色墨（`onSurface@.10`，深色下应是 `#F2F2F2@.10`）；
 *   · `.cal-day` 写死 `height: 44px`，而 Kotlin 是 `aspectRatio(1f)`（平板上变长方形）；
 *     另外「读过」的日期数字没变白加粗（Kotlin L291-292 明确要求）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  HEAT_LEVELS,
  WEEKDAY_LABELS,
  buildYearGrid,
  heatAlpha,
} from '@ui/components/ReadingCalendarCard';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/ReadingCalendarCard.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/components/ReadingCalendarCard.tsx', 'utf8');
const CSS = readFileSync('src/styles/components.css', 'utf8');

describe('ReadingCalendarCard.kt：四档热力', () => {
  it('0.32 / 0.52 / 0.72 / 0.95，分界 600 / 1800 / 3600 秒', () => {
    expect(KT).toContain('private val HEAT_LEVELS = listOf(0.32f, 0.52f, 0.72f, 0.95f)');
    expect(KT).toContain('seconds <= 0 -> 0f');
    expect(KT).toContain('seconds < 600 -> HEAT_LEVELS[0]');
    expect(KT).toContain('seconds < 1800 -> HEAT_LEVELS[1]');
    expect(KT).toContain('seconds < 3600 -> HEAT_LEVELS[2]');
    expect(KT).toContain('else -> HEAT_LEVELS[3]');

    expect([...HEAT_LEVELS]).toEqual([0.32, 0.52, 0.72, 0.95]);
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(-5)).toBe(0);
    expect(heatAlpha(1)).toBe(0.32);
    expect(heatAlpha(599)).toBe(0.32);
    expect(heatAlpha(600)).toBe(0.52);
    expect(heatAlpha(1799)).toBe(0.52);
    expect(heatAlpha(1800)).toBe(0.72);
    expect(heatAlpha(3599)).toBe(0.72);
    expect(heatAlpha(3600)).toBe(0.95);
    expect(heatAlpha(86400)).toBe(0.95);
  });

  it('四档严格递增，且最低档与空格子（0）拉得开（Kotlin L570-573 的教训）', () => {
    for (let i = 1; i < HEAT_LEVELS.length; i += 1) {
      expect(HEAT_LEVELS[i]).toBeGreaterThan(HEAT_LEVELS[i - 1] ?? 0);
    }
    // 最低档曾经是 0.2，浅色卡片上「读了 5 分钟」与「没读」分不开 → 抬到 0.32
    expect(HEAT_LEVELS[0]).toBeGreaterThan(0.2);
    expect(HEAT_LEVELS[3]).toBeLessThanOrEqual(1);
  });

  it('图例与格子共用同一份数据（Kotlin L583-587 注释的约束）', () => {
    expect(KT).toContain('格子配色与底部图例共用同一份数据');
    // 图例直接遍历 HEAT_LEVELS，而不是另写 0.2/0.4/0.65/0.9
    expect(TSX).toContain('HEAT_LEVELS.map((a, i)');
    expect(TSX).not.toContain('0.65');
  });
});

describe('ReadingCalendarCard.kt：buildYearGrid（列 = 周，行 = 星期）', () => {
  it('周一起始：Kotlin `(DAY_OF_WEEK + 5) % 7` 与 JS `(getDay() + 6) % 7` 逐日等价', () => {
    expect(KT).toContain('val jan1Dow = (first.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Mon=0');
    // Calendar：SUNDAY=1 … SATURDAY=7；JS getDay()：SUNDAY=0 … SATURDAY=6
    for (let jsDow = 0; jsDow < 7; jsDow += 1) {
      const calendarDow = jsDow === 0 ? 1 : jsDow + 1;
      expect((calendarDow + 5) % 7).toBe((jsDow + 6) % 7);
    }
    // 2026-01-01 是周四 → 列偏移 3
    expect((new Date(2026, 0, 1).getDay() + 6) % 7).toBe(3);
  });

  it('列数 = ⌈(jan1Dow + 全年天数) / 7⌉，格子数组 7 行铺满', () => {
    expect(KT).toContain('val columns = (jan1Dow + daysInYear + 6) / 7');
    for (const year of [2024, 2025, 2026, 2027]) {
      const grid = buildYearGrid(year, new Date(2026, 10, 16));
      const jan1Dow = (new Date(year, 0, 1).getDay() + 6) % 7;
      expect(grid.columns).toBe(Math.floor((jan1Dow + grid.daysInYear + 6) / 7));
      expect(grid.cells).toHaveLength(grid.columns * 7);
      // 第 1 天落在 jan1Dow，第 daysInYear 天紧接其后
      expect(grid.cells[jan1Dow]).toBe(`${String(year)}-01-01`);
      expect(grid.cells[jan1Dow + grid.daysInYear - 1]).toBe(`${String(year)}-12-31`);
    }
  });

  it('全年天数走 UTC：闰年 366、平年 365（本地毫秒差在夏令时区会少一天）', () => {
    expect(buildYearGrid(2024, new Date(2026, 10, 16)).daysInYear).toBe(366);
    expect(buildYearGrid(2025, new Date(2026, 10, 16)).daysInYear).toBe(365);
    expect(buildYearGrid(2026, new Date(2026, 10, 16)).daysInYear).toBe(365);
    expect(buildYearGrid(2000, new Date(2026, 10, 16)).daysInYear).toBe(366);
    // 实现必须用 Date.UTC（本地相减 DST 年会得到 365.958…）
    expect(TSX).toContain('Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)');
    expect(TSX).not.toContain('(new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime())');
  });

  it('格子里的日期连续、无重复、无空洞（365/366 天全在）', () => {
    for (const year of [2024, 2026]) {
      const grid = buildYearGrid(year, new Date(2026, 10, 16));
      const dates = grid.cells.filter((cell): cell is string => cell !== null);
      expect(dates).toHaveLength(grid.daysInYear);
      expect(new Set(dates).size).toBe(grid.daysInYear);
      // 逐个相邻日期差 1 天（用 UTC 解析，避免夏令时）
      for (let i = 1; i < dates.length; i += 1) {
        const prev = Date.parse(`${dates[i - 1] ?? ''}T00:00:00Z`);
        const next = Date.parse(`${dates[i] ?? ''}T00:00:00Z`);
        expect(next - prev).toBe(86_400_000);
      }
    }
  });

  it('monthStartColumn 单调不减，且与「该月 1 日的列」一致', () => {
    expect(KT).toContain('monthStartColumn[m] = (jan1Dow + c.get(Calendar.DAY_OF_YEAR) - 1) / 7');
    const grid = buildYearGrid(2026, new Date(2026, 10, 16));
    expect(grid.monthStartColumn).toHaveLength(12);
    const jan1Dow = (new Date(2026, 0, 1).getDay() + 6) % 7;
    for (let m = 0; m < 12; m += 1) {
      const doy = Math.round(
        (Date.UTC(2026, m, 1) - Date.UTC(2026, 0, 1)) / 86_400_000,
      ) + 1;
      expect(grid.monthStartColumn[m]).toBe(Math.floor((jan1Dow + doy - 1) / 7));
      if (m > 0) {
        expect(grid.monthStartColumn[m] ?? 0).toBeGreaterThanOrEqual(grid.monthStartColumn[m - 1] ?? 0);
      }
    }
    // 1 月一定从第 0 列开始
    expect(grid.monthStartColumn[0]).toBe(0);
  });

  it('todayColumn：本年给列号，非本年给 −1', () => {
    expect(KT).toContain('val todayColumn = if (today.get(Calendar.YEAR) == year) {');
    expect(KT).toMatch(/\} else \{\r?\n\s+-1\r?\n\s+\}/);
    const inYear = buildYearGrid(2026, new Date(2026, 10, 16));
    expect(inYear.todayColumn).toBeGreaterThanOrEqual(0);
    expect(inYear.todayColumn).toBeLessThan(inYear.columns);
    // 2026-11-16 与 1 月 1 日同列（周一、第 320 天）
    expect(inYear.todayColumn).toBe(Math.floor((3 + 320 - 1) / 7));
    expect(buildYearGrid(2025, new Date(2026, 10, 16)).todayColumn).toBe(-1);
    expect(buildYearGrid(2027, new Date(2026, 10, 16)).todayColumn).toBe(-1);
  });

  it('1 月 1 日之前的空位是 null（Kotlin `arrayOfNulls` 的默认值）', () => {
    expect(KT).toContain('private val cells: Array<String?> = arrayOfNulls(columns * 7)');
    const grid = buildYearGrid(2026, new Date(2026, 10, 16));
    const jan1Dow = 3;
    for (let i = 0; i < jan1Dow; i += 1) expect(grid.cells[i]).toBeNull();
    // 末尾多余的位置也是 null
    for (let i = jan1Dow + grid.daysInYear; i < grid.cells.length; i += 1) {
      expect(grid.cells[i]).toBeNull();
    }
    expect(TSX).toContain('.fill(null)');
  });
});

describe('ReadingCalendarCard.kt：视觉常量', () => {
  it('月格：r8 / 间距 2dp / 正方形 / 今天 1.5dp 薄荷描边 / 峰值金点 5dp@3dp', () => {
    expect(KT).toContain('val shape = RoundedCornerShape(8.dp)');
    expect(KT).toContain('.padding(2.dp)');
    expect(KT).toContain('.aspectRatio(1f)');
    expect(KT).toContain('Modifier.border(1.5.dp, MintPrimary, shape)');
    expect(KT).toContain('.padding(3.dp)');
    expect(KT).toContain('.size(5.dp)');
    expect(CSS).toContain('border-radius: 8px');
    expect(CSS).toContain('margin: 2px');
    // 正方形（宽度驱动），不是写死 44px
    expect(CSS).toContain('aspect-ratio: 1;');
    expect(CSS).not.toContain('height: 44px;');
    expect(CSS).toContain('top: 3px');
    expect(CSS).toContain('width: 5px');
  });

  it('读过 → 白字 + Bold，时长 8sp 白 90%；没读 → onSurfaceVariant', () => {
    expect(KT).toContain('fontWeight = if (seconds > 0) FontWeight.Bold else FontWeight.Normal');
    expect(KT).toContain('color = if (seconds > 0) Color.White else MaterialTheme.colorScheme.onSurfaceVariant');
    expect(KT).toContain('color = Color.White.copy(alpha = 0.9f)');
    expect(TSX).toContain("color: read ? '#FFFFFF' : undefined");
    expect(TSX).toContain('fontWeight: read ? 700 : 400');
    expect(TSX).toContain("color: 'rgba(255, 255, 255, 0.9)'");
    expect(CSS).toContain('font-size: 8px');
  });

  it('空格子用主题色：月格 surfaceVariant@.45、年格 onSurface@.10', () => {
    expect(KT).toContain('MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)');
    expect(KT).toContain('MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f)');
    // 主题真值：Theme.kt L84/L104 + WenkuTokens L35/L44
    expect(CSS).toContain('--cal-surface-variant: #F0EDE5;');
    expect(CSS).toContain('--cal-on-surface: #161613;');
    expect(CSS).toContain('--cal-surface-variant: #2D2D2D;');
    expect(CSS).toContain('--cal-on-surface: #F2F2F2;');
    expect(TSX).toContain('var(--cal-surface-variant, #F0EDE5) 45%');
    expect(TSX).toContain('var(--cal-on-surface, #161613) 10%');
    // 不再有写死的浅灰 / 亮色墨
    expect(TSX).not.toContain('rgba(241, 243, 244, 0.45)');
    expect(TSX).not.toContain('rgba(24, 25, 28, 0.10)');
  });

  it('年格：r3 / gap 3 / 最小 16 / 周标签列宽 20 / 今天 1.5dp 金描边', () => {
    expect(KT).toContain('val shape = RoundedCornerShape(3.dp)');
    expect(KT).toContain('val cellGap = 3.dp');
    expect(KT).toContain('val minCell = 16.dp');
    expect(KT).toContain('val weekdayLabelWidth = 20.dp');
    expect(KT).toContain('if (isToday) Modifier.border(1.5.dp, MintGold, shape) else Modifier');
    expect(TSX).toContain('const cellGap = 3;');
    expect(TSX).toContain('const minCell = 16;');
    expect(TSX).toContain('const weekdayLabelWidth = 20;');
    expect(CSS).toContain('.cal-year__cell');
  });

  it('月份标签放不下就不画（阈值 26px）', () => {
    expect(TSX).toContain('w >= 26');
    expect(TSX).toContain('放不下就不画');
  });

  it('周标签是「一…日」七个（Monday 起始）', () => {
    expect(KT).toContain('private val WEEKDAY_LABELS = listOf("一", "二", "三", "四", "五", "六", "日")');
    expect([...WEEKDAY_LABELS]).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    expect(WEEKDAY_LABELS).toHaveLength(7);
  });

  it('月份行数 = ⌈(leading + 当月天数) / 7⌉，leading 周一为 0', () => {
    expect(KT).toContain('val leading = (first.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Mon=0');
    expect(KT).toContain('val rows = (leading + daysInMonth + 6) / 7');
    // 2026-11-01 是周日 → leading 6，30 天 → (6+30+6)/7 = 6 行
    const leading = (new Date(2026, 10, 1).getDay() + 6) % 7;
    expect(leading).toBe(6);
    expect(Math.ceil((leading + 30) / 7)).toBe(6);
    expect(TSX).toContain('Math.ceil((leading + total) / 7)');
  });
});

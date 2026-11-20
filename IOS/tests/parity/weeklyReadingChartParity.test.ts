/**
 * weeklyReadingChartParity.test.ts —— 本周阅读趋势卡（`ui/components/WeeklyReadingChart.kt`，606 行）。
 *
 * 本轮修掉的五处：
 *   ① **柱子被塞了最小高度**：Kotlin `rawFraction = mins / maxMinutes` 没有下限，
 *      端口写成 `max(0.04, ratio)` 再 `Math.max(4, pct)` —— 每个非零日都成了 4% 的矮墩；
 *      （`0.04` 是 `PeakHoursBars` 那边的下限，不属于本周柱状图。）
 *   ② 文案没走 i18n：`minutesShort` / `minutesTotal` / `dayRecordSummary` / `dayReadLog` /
 *      `weekMinutes` 五个 helper 都已存在，端口却硬编码中文；
 *   ③ 生长错峰：Kotlin 由 `WenkuMotion.listStart/End(index)` 窗口驱动
 *      （`listDelayStep = .055`、`ENTER_MS = 420`）→ 每档 **23.1ms**；端口写 `320 + i*40`；
 *   ④ 本周徽标：Kotlin `primaryContainer@.5`；端口 `primary@.18`；
 *   ⑤ 选中日详情条：Kotlin `surfaceVariant@.5`；端口又是 M3 基线 `rgba(227,229,231,.5)`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { WENKU_MOTION } from '@core/wenku/tokens';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/WeeklyReadingChart.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/components/WeeklyReadingChart.tsx', 'utf8');
const CSS = readFileSync('src/styles/statistics.css', 'utf8');

describe('WeeklyReadingChart.kt：卡片骨架与头部', () => {
  it('GlassCard r20 / 内边距 20 / 图标圆 36 @primary .12 / 图标 20 / 间距 10', () => {
    expect(KT).toContain('shape = RoundedCornerShape(20.dp)');
    expect(KT).toContain('.padding(20.dp)');
    expect(KT).toContain('color = MintPrimary.copy(alpha = 0.12f)');
    expect(KT).toContain('modifier = Modifier.size(36.dp)');
    expect(KT).toContain('modifier = Modifier.size(20.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.width(10.dp))');
    expect(TSX).toContain('<GlassCard radius={20} padding={20}');
  });

  it('标题 15sp Bold / 副标题 11sp；本周总时长徽标 r20 primaryContainer@.5 12sp 12×6', () => {
    expect(KT).toContain('text = tr("本周阅读趋势")');
    expect(KT).toContain('fontSize = 15.sp');
    expect(KT).toContain('text = tr("周一 至 周日")');
    expect(KT).toContain('fontSize = 11.sp');
    expect(KT).toContain('shape = RoundedCornerShape(20.dp)');
    expect(KT).toContain('color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)');
    expect(KT).toContain('com.example.i18n.weekMinutes(totalMinutes)');
    expect(KT).toContain('.padding(horizontal = 12.dp, vertical = 6.dp)');
    expect(CSS).toContain('border-radius: 20px;');
    expect(CSS).toContain('padding: 6px 12px;');
    expect(CSS).toContain('color-mix(in srgb, var(--stats-primary-container, #A7F3D0) 50%, transparent)');
  });

  it('徽标与详情条走 i18n helper（英文界面不露中文）', () => {
    expect(TSX).toContain('{weekMinutes(totalMinutes)}');
    expect(TSX).toContain('{dayReadLog(selDayName)}');
    expect(TSX).toContain('minutesTotal(selMins)');
    expect(TSX).toContain('minutesShort(mins)');
    expect(TSX).toContain('dayRecordSummary(selRecords.length)');
    expect(TSX).not.toContain('本周共 {totalMinutes} 分钟');
  });
});

describe('WeeklyReadingChart.kt：柱状图几何', () => {
  it('外层垂直内边距 4；标签盒 20dp；柱容器 22×100；间距 4 与 8', () => {
    expect(KT).toContain('.padding(vertical = 4.dp)');
    expect(KT).toContain('.height(20.dp)');
    expect(KT).toContain('.width(22.dp)');
    expect(KT).toContain('.height(100.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.height(4.dp))');
    expect(KT).toContain('Spacer(modifier = Modifier.height(8.dp))');
    expect(CSS).toContain('padding: 4px 0;');
    expect(CSS).toContain('height: 20px;');
    expect(CSS).toContain('width: 22px;');
    expect(CSS).toContain('height: 100px;');
  });

  it('0 分钟日只画 3dp 基线（r2）', () => {
    expect(KT).toContain('.height(3.dp)');
    expect(KT).toContain('RoundedCornerShape(2.dp)');
    expect(KT).toContain('Color.LightGray.copy(alpha = 0.4f)');
    expect(CSS).toContain('height: 3px;');
    expect(CSS).toContain('border-radius: 2px;');
    expect(CSS).toContain('rgba(211, 211, 211, 0.4)');
  });

  it('柱子高度 = 分钟 / 最大值，**没有下限**（0.04 属于高峰时段柱）', () => {
    expect(KT).toContain('val rawFraction = if (maxMinutes <= 0 || mins <= 0) 0f else (mins.toFloat() / maxMinutes.toF');
    // 全文没有把本周柱夹到 0.04
    expect(KT).not.toContain('coerceAtLeast(0.04f)');
    expect(TSX).toContain('maxMinutes <= 0 || mins <= 0 ? 0 : Math.min(1, mins / maxMinutes)');
    expect(TSX).not.toContain('Math.max(0.04, mins / maxMinutes)');
    expect(TSX).not.toContain('Math.max(4, barHeightPct)');
    // 语义：1/100 的日就是 1%，不是 4%
    expect(`${Math.min(1, 1 / 100) * 100}`).toBe('1');
  });

  it('柱顶圆角 4；选中柱 6dp consistentShadow（primary@.30 双档）', () => {
    expect(KT).toContain('RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)');
    expect(KT).toContain('elevation = 6.dp');
    expect(KT).toContain('ambientColor = chartPrimary.copy(alpha = 0.30f)');
    expect(KT).toContain('spotColor = chartPrimary.copy(alpha = 0.30f)');
    expect(CSS).toContain('border-radius: 4px 4px 0 0;');
  });

  it('渐变三档：今日/选中 secondary→primary、峰值金 .80→.55、普通 .65→.45、空 LightGray .4→.2', () => {
    expect(KT).toContain('isToday || isSelected -> listOf(chartSecondary, chartPrimary)');
    expect(KT).toContain('listOf(MintGold.copy(alpha = 0.80f), MintGold.copy(alpha = ');
    expect(KT).toContain('chartSecondary.copy(alpha = 0.65f)');
    expect(KT).toContain('chartPrimary.copy(alpha = 0.45f)');
    expect(KT).toContain('Color.LightGray.copy(alpha = 0.4f), Color.LightGray.copy(alpha = 0.2f)');
  });

  it('生长 450ms FastOutSlowIn；选中缩放 1.08 / 150ms', () => {
    expect(KT).toContain('animationSpec = tween(if (animateBars) 450 else 0, easing = FastOutSlowInEasing)');
    expect(KT).toContain('targetValue = if (isSelected) 1.08f else 1.0f');
    expect(KT).toContain('animationSpec = tween(if (animateBars) 150 else 0)');
    // Kotlin 只放大**宽度**：`scaleX = scaleState`，高度由 `scaleY = animatedRaw × ease` 承担
    expect(CSS).toContain('transform: scaleX(1.08);');
  });

  it('错峰来自 WenkuMotion 窗口：每档 23.1ms，没有 320ms 前摇', () => {
    expect(KT).toContain('val from = WenkuMotion.listStart(index)');
    expect(KT).toContain('val to = WenkuMotion.listEnd(index)');
    expect(WENKU_MOTION.listDelayStep).toBe(0.055);
    expect(WENKU_MOTION.enterMs).toBe(420);
    expect(Math.round(1 * WENKU_MOTION.listDelayStep * WENKU_MOTION.enterMs)).toBe(23);
    expect(TSX).toContain('Math.round(index * WENKU_MOTION.listDelayStep * WENKU_MOTION.enterMs)');
    expect(TSX).not.toContain('320 + index * 40');
  });

  it('标签颜色优先级：今日 → 峰值 → 选中 → 其余 70%', () => {
    expect(KT).toContain('isToday -> MintPrimary');
    expect(KT).toContain('index == peakDayIdx && mins > 0 -> MintGold');
    expect(KT).toContain('isSelected -> MintSecondary');
    expect(KT).toContain('MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)');
  });

  it('星期标签：今日实底薄荷 + 白字；选中 secondary@.2 + secondary 字；r10 / 4×2 / 11sp', () => {
    expect(KT).toContain('RoundedCornerShape(10.dp)');
    expect(KT).toContain('isToday -> MintPrimary');
    expect(KT).toContain('isSelected -> MintSecondary.copy(alpha = 0.2f)');
    expect(KT).toContain('isToday -> Color.White');
    expect(KT).toContain('fontSize = 11.sp');
    expect(KT).toContain('.padding(horizontal = 4.dp, vertical = 2.dp)');
    expect(CSS).toContain('padding: 2px 4px;');
    expect(CSS).toContain('border-radius: 10px;');
  });
});

describe('WeeklyReadingChart.kt：选中日详情条', () => {
  it('r12 / surfaceVariant@.5 / 14×10 / 图标 16 / 文案 12sp', () => {
    expect(KT).toContain('shape = RoundedCornerShape(12.dp)');
    expect(KT).toContain('color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)');
    expect(KT).toContain('.padding(horizontal = 14.dp, vertical = 10.dp)');
    expect(KT).toContain('modifier = Modifier.size(16.dp)');
    expect(KT).toContain('fontSize = 12.sp');
    expect(CSS).toContain('padding: 10px 14px;');
    expect(CSS).toContain('border-radius: 12px;');
    // 主题真值：亮 #F0EDE5 / 深 #2D2D2D（Theme.kt L84/L104）
    expect(CSS).toContain('--stats-surface-variant: #F0EDE5;');
    expect(CSS).toContain('--stats-surface-variant: #2D2D2D;');
    expect(CSS).toContain('color-mix(in srgb, var(--stats-surface-variant, #F0EDE5) 50%, transparent)');
    const detailBlock = CSS.slice(
      CSS.indexOf('.stats-weekly-detail {'),
      CSS.indexOf('.stats-weekly-detail-left {'),
    );
    expect(detailBlock).not.toContain('rgba(227, 229, 231, 0.5)');
    expect(detailBlock).toContain('var(--stats-surface-variant, #F0EDE5) 50%');
  });

  it('记录摘要三分支：有记录 / 自选阅读 / 无阅读记录；合计量为 0 时显示「0 分钟」', () => {
    expect(KT).toContain('com.example.i18n.dayRecordSummary(selRecords.size)');
    expect(KT).toContain('com.example.i18n.tr("自选阅读")');
    expect(KT).toContain('com.example.i18n.tr("无阅读记录")');
    expect(KT).toContain('if (selMins > 0) com.example.i18n.minutesTotal(selMins) else tr("0 分钟")');
    expect(TSX).toContain("return tr('自选阅读');");
    expect(TSX).toContain("return tr('无阅读记录');");
  });

  it('峰值日只在 > 0 时成立（全 0 的一周没有金色柱）', () => {
    expect(KT).toContain('?.takeIf { minutesPerDay.getOrElse(it) { 0 } > 0 }');
    expect(TSX).toContain('return bestVal > 0 ? best : -1;');
  });

  it('减少动态效果 / 低画质时跳过生长（entrance 直接 1）', () => {
    expect(KT).toContain('val animateBars = !lowQuality && !reduceMotion');
    expect(KT).toContain('val entrance = remember { Animatable(if (animateBars) 0f else 1f) }');
    expect(KT).toContain('entrance.animateTo(1f, tween(WenkuMotion.ENTER_MS, easing = LinearEasing))');
  });
});

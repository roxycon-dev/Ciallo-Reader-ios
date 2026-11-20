/**
 * readingTrendCardParity.test.ts —— 阅读趋势卡（`ui/components/ReadingTrendCard.kt`，404 行）。
 *
 * 两块手绘图：
 *   · `TrendLineChart`（折线 + 面积 + 峰值点 + 选中脉冲 + 700ms 左→右描绘）；
 *   · `PeakHoursBars`（24 根柱、比例下限 0.04、420ms 生长 + 每根错峰 12ms）。
 *
 * 本轮修掉的三处：
 *   ① 网格色写死 `#61666D@.35`，而 Kotlin 是 `outlineVariant@.35`（亮 `#CAC4D0` / 深 `#49454F`）
 *      —— 网格比 Android 深一档，且深色主题下不翻；
 *   ② 基线写 `withAlpha(gridColor, 0.77)`：`gridColor` 是 `rgba(...)` 字符串，
 *      `withAlpha()` 只认 hex → 落进 fallback，实际画成 `rgba(24,25,28,0.77)`（近黑）；
 *   ③ 柱子**颜色**过渡用 `ease-out`，Kotlin `tween(260)` 默认是 FastOutSlowIn；
 *      另外 `reveal` 缺「减少动态效果 → 定格终态」的门。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { withAlpha } from '@core/glass/color';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/ReadingTrendCard.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/components/ReadingTrendCard.tsx', 'utf8');
const CSS = readFileSync('src/styles/components.css', 'utf8');

describe('ReadingTrendCard.kt：三档序列与文案', () => {
  it('周/月/年三档分别取近 14 天 / 近 30 天 / 近 12 个月', () => {
    expect(KT).toContain('add(Calendar.DAY_OF_YEAR, -13)');
    expect(KT).toContain('add(Calendar.DAY_OF_YEAR, -29)');
    expect(KT).toContain('monthlySeries(dailyTotals, 12, today)');
    expect(KT).toContain('val seriesLabel = listOf("近14天", "近30天", "近12个月")[tab]');
    expect(TSX).toContain("const SERIES_LABELS = ['近14天', '近30天', '近12个月'] as const;");
  });

  it('三档 Tab 的文案是「周 / 月 / 年」，最宽 150dp（A7 的修法）', () => {
    expect(KT).toContain('listOf(0 to tr("周"), 1 to tr("月"), 2 to tr("年"))');
    expect(KT).toContain('modifier = Modifier.widthIn(max = 150.dp)');
    expect(KT).toContain('A7：原固定 150.dp，窄屏 / 大字体下会把标题挤到换行');
    expect(TSX).toContain('maxWidth: 150');
  });

  it('高峰时段取近 30 天会话；峰值小时取最大桶', () => {
    expect(KT).toContain('(today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -29) }');
    expect(KT).toContain('val peak = remember(sessions) { peakHourTotals(sessions, peakFrom, today) }');
    expect(KT).toContain('val peakMaxHour = peak.indices.maxByOrNull { peak[it] }');
    expect(KT).toContain('val peakTotal = peak.sum()');
  });
});

describe('ReadingTrendCard.kt：卡片骨架', () => {
  it('GlassCard r20 / 内边距 16 / 图标圆 36dp @primary .12 / 图标 20dp / 间距 10', () => {
    expect(KT).toContain('shape = RoundedCornerShape(20.dp)');
    expect(KT).toContain('Column(modifier = Modifier.padding(16.dp))');
    expect(KT).toContain('color = MintPrimary.copy(alpha = 0.12f)');
    expect(KT).toContain('modifier = Modifier.size(36.dp)');
    expect(KT).toContain('modifier = Modifier.size(20.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.width(10.dp))');
    expect(readFileSync('src/styles/statistics.css', 'utf8')).toContain('.stats-icon-circle');
  });
  it('标题 15sp Bold / 副标题 11sp onSurfaceVariant', () => {
    expect(KT).toContain('Text(tr("阅读趋势"), fontWeight = FontWeight.Bold, fontSize = 15.sp)');
    expect(KT).toContain('Text(tr("时长走势与高峰时段"), fontSize = 11.sp');
    expect(TSX).toContain('阅读趋势');
    expect(TSX).toContain('时长走势与高峰时段');
  });

  it('读数条：「阅读时长 · 档位」+「峰值 X」，选中点浮层 r10 @.12 / 12×5 内边距', () => {
    expect(KT).toContain('Text("阅读时长 · $seriesLabel", fontSize = 11.sp');
    expect(KT).toContain('text = "峰值 ${formatShortDuration(series.maxOfOrNull { it.second } ?: 0)}"');
    expect(KT).toContain('shape = RoundedCornerShape(10.dp)');
    expect(KT).toContain('color = MintPrimary.copy(alpha = 0.12f)');
    expect(KT).toContain('.padding(horizontal = 12.dp, vertical = 5.dp)');
    expect(TSX).toContain('阅读时长 · ');
    expect(TSX).toContain('峰值 ');
  });

  it('图表盒 150dp；满刻度标注 10sp @.7 右上角 2/4；无数据提示居中', () => {
    expect(KT).toContain('modifier = Modifier.fillMaxWidth().height(150.dp)');
    expect(KT).toContain('text = "满刻度 ${formatShortDuration(maxSeconds)}",');
    expect(KT).toContain('fontSize = 10.sp');
    expect(KT).toContain('.padding(top = 2.dp, end = 4.dp)');
    expect(KT).toContain('tr("还没有阅读时长——去读一页，让曲线开始生长")');
    expect(CSS).toContain('height: 150px;');
    expect(TSX).toContain('还没有阅读时长——去读一页，让曲线开始生长');
  });

  it('高峰标题 14sp Bold + 金色「高峰 H:00 - H+1:00」', () => {
    expect(KT).toContain('Text(tr("阅读高峰时段"), fontWeight = FontWeight.Bold, fontSize = 14.sp)');
    expect(KT).toContain('text = "高峰 ${peakMaxHour}:00 - ${peakMaxHour + 1}:00",');
    expect(KT).toContain('color = MintGold');
    expect(KT).toContain('tr("暂无时段数据（更新后开始记录每次阅读的起止时间）")');
    expect(TSX).toContain('阅读高峰时段');
  });
});

describe('ReadingTrendCard.kt：折线图几何（L280-346）', () => {
  it('上留 10 / 下留 8；3 条网格线在 g/4；基线 = 网格 alpha × 2.2', () => {
    expect(KT).toContain('val topPad = 10f');
    expect(KT).toContain('val bottomPad = 8f');
    expect(KT).toContain('for (g in 1..3) {');
    expect(KT).toContain('val gy = topPad + (h - topPad - bottomPad) * g / 4f');
    expect(KT).toContain('color = gridColor.copy(alpha = gridColor.alpha * 2.2f),');
    expect(TSX).toContain('const topPad = 10;');
    expect(TSX).toContain('const bottomPad = 8;');
    expect(TSX).toContain('{[1, 2, 3].map((g) => {');
    // 0.35 × 2.2 = 0.77
    expect((0.35 * 2.2).toFixed(2)).toBe('0.77');
  });

  it('网格色 = outlineVariant@.35（随主题翻），不再写死 #61666D', () => {
    expect(KT).toContain('val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f)');
    expect(TSX).toContain('var(--trend-outline-variant, #CAC4D0) 35%');
    expect(TSX).toContain('var(--trend-outline-variant, #CAC4D0) 77%');
    expect(TSX).not.toContain("'rgba(97, 102, 109, 0.35)'");
    expect(CSS).toContain('--trend-outline-variant: #CAC4D0;');
    expect(CSS).toContain('--trend-outline-variant: #49454F;');
    // withAlpha 只吃 hex：对 rgba(...) 调用会掉进 fallback（近黑），所以基线不能那么写
    expect(withAlpha('rgba(97,102,109,0.35)', 0.77)).toBe('rgba(24, 25, 28, 0.77)');
    expect(TSX).not.toContain('withAlpha(gridColor, 0.77)');
  });

  it('横坐标 stepX = w / (n−1)，y = h − bottomPad − v/max · (h − topPad − bottomPad)', () => {
    expect(KT).toContain('val stepX = w / (series.size - 1)');
    expect(KT).toContain('Offset(i * stepX, h - bottomPad - (v.toFloat() / maxVal) * (h - topPad - bottomPad))');
    expect(KT).toContain('val maxVal = (series.maxOfOrNull { it.second } ?: 0L).coerceAtLeast(1L)');
    expect(TSX).toContain('const stepX = W / (series.length - 1);');
    expect(TSX).toContain('y: H - bottomPad - (v / maxVal) * (H - topPad - bottomPad),');
    expect(TSX).toContain('Math.max(1, ...series.map(([, v]) => v))');
  });

  it('点击取整列：floor(x / stepX) 并夹到 [0, n−1]', () => {
    expect(KT).toContain('val idx = (offset.x / stepX).toInt().coerceIn(0, series.size - 1)');
    expect(TSX).toContain('Math.floor(x / stepX)');
    expect(TSX).toContain('Math.max(0, Math.min(series.length - 1');
  });

  it('面积渐变 primary@.30 → 透明；折线 2.5px', () => {
    expect(KT).toContain('colors = listOf(primary.copy(alpha = 0.30f), Color.Transparent)');
    expect(KT).toContain('drawPath(path = linePath, color = primary, style = Stroke(width = 2.5f))');
    expect(TSX).toContain('withAlpha(MINT_PRIMARY, 0.3)');
    expect(TSX).toContain('strokeWidth={2.5}');
  });

  it('峰值点：金色 r7 + 白心 r3；无选中时首尾各一个 r4', () => {
    expect(KT).toContain('drawCircle(MintGold, radius = 7f, center = points[pi])');
    expect(KT).toContain('drawCircle(Color.White, radius = 3f, center = points[pi])');
    expect(KT).toContain('drawCircle(primary, radius = 4f, center = points.first())');
    expect(KT).toContain('drawCircle(primary, radius = 4f, center = points.last())');
    expect(TSX).toContain('r={7}');
    expect(TSX).toContain('r={3}');
    expect(TSX).toContain('r={4}');
  });

  it('选中脉冲：alpha .35·(1−p)、半径 5 + 7p；芯 primary r5 + 白 r2', () => {
    expect(KT).toContain('color = primary.copy(alpha = 0.35f * (1f - pointPulse.value)),');
    expect(KT).toContain('radius = 5f + 7f * pointPulse.value,');
    expect(KT).toContain('drawCircle(primary, radius = 5f, center = p)');
    expect(KT).toContain('drawCircle(Color.White, radius = 2f, center = p)');
    expect(TSX).toContain('0.35 * (1 - pulse)');
    expect(TSX).toContain('r={5 + 7 * pulse}');
    expect(TSX).toContain('r={5}');
    expect(TSX).toContain('r={2}');
  });

  it('左→右描绘 700ms，曲线 cubic-bezier(.3, 0, .2, 1)；减少动态时定格', () => {
    expect(KT).toContain('reveal.animateTo(1f, tween(700, easing = CubicBezierEasing(0.3f, 0f, 0.2f, 1f)))');
    expect(KT).toContain('if (lowQuality || reduce) {');
    expect(KT).toContain('reveal.snapTo(1f)');
    expect(TSX).toContain('cubicBezier(0.3, 0, 0.2, 1)');
    expect(TSX).toContain('/ 700');
    expect(TSX).toContain('if (props.reduceMotion === true) return undefined;');
    expect(TSX).toContain('reduceMotion={props.reduceMotion === true}');
    expect(TSX).toContain('width={(W * reveal).toFixed(2)}');
  });

  it('序列不足 2 点时不画图（Kotlin 的 `if (series.size < 2) return@Canvas`）', () => {
    expect(KT).toContain('if (series.size < 2) return@Canvas');
    expect(TSX).toContain('if (series.length < 2)');
  });
});

describe('ReadingTrendCard.kt：高峰柱状图（L349-404）', () => {
  it('24 根柱、高度 72dp、比例下限 0.04、顶部圆角 2dp、列间留 0.5dp', () => {
    expect(KT).toContain('for (hour in 0 until 24)');
    expect(KT).toContain('modifier = Modifier.fillMaxWidth().height(72.dp)');
    expect(KT).toContain('targetValue = ratio.coerceAtLeast(0.04f)');
    expect(KT).toContain('RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp)');
    expect(KT).toContain('.padding(horizontal = 0.5.dp)');
    expect(CSS).toContain('height: 72px;');
    expect(CSS).toContain('border-radius: 2px 2px 0 0;');
    expect(CSS).toContain('margin: 0 0.5px;');
    expect(TSX).toContain('Math.max(0.04, ratio)');
  });

  it('生长 420ms + 每根错峰 12ms（FastOutSlowIn）', () => {
    expect(KT).toContain('durationMillis = 420,');
    expect(KT).toContain('delayMillis = hour * 12,');
    expect(KT).toContain('easing = FastOutSlowInEasing');
    expect(TSX).toContain('transitionDelay: `${hour * 12}ms`');
    expect(CSS).toContain('height 420ms cubic-bezier(0.4, 0, 0.2, 1),');
  });

  it('颜色三档：选中金 .95 / 峰值金 .65 / 其余薄荷 .55；颜色过渡 260ms', () => {
    expect(KT).toContain('MintGold.copy(alpha = 0.95f)');
    expect(KT).toContain('MintGold.copy(alpha = 0.65f)');
    expect(KT).toContain('MintPrimary.copy(alpha = 0.55f)');
    expect(KT).toContain('animationSpec = tween(260)');
    expect(TSX).toContain('withAlpha(MINT_GOLD, 0.95)');
    expect(TSX).toContain('withAlpha(MINT_GOLD, 0.65)');
    expect(TSX).toContain('withAlpha(MINT_PRIMARY, 0.55)');
    // Kotlin tween(260) 默认 FastOutSlowIn —— 不能是 ease-out
    expect(CSS).toContain('background 260ms cubic-bezier(0.4, 0, 0.2, 1);');
    expect(CSS).not.toContain('background 260ms ease-out');
  });

  it('峰值判定要求 v > 0（全 0 时没有一根柱子算峰值）', () => {
    expect(KT).toContain('val isMax = v > 0 && v == max');
    expect(TSX).toContain('const isMax = v > 0 && v === max;');
  });

  it('没有任何时段数据时整块不画，换成一行说明', () => {
    expect(KT).toContain('if (peakTotal > 0) {');
    expect(KT).toContain('tr("暂无时段数据（更新后开始记录每次阅读的起止时间）")');
    expect(TSX).toContain('暂无时段数据（更新后开始记录每次阅读的起止时间）');
  });
});

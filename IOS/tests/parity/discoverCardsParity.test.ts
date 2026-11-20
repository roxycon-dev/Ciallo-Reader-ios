/**
 * discoverCardsParity.test.ts —— 发现页卡片的几何、徽标、趋势与骨架（`discover/DiscoverCards.kt`，338 行）。
 *
 * 本轮修的三处按 Kotlin 对齐（都是「看着还行、其实不对」的类型）：
 *   ① `DiscoverLayout` 第三档写作 `'compact'`，而 Kotlin 枚举与 CSS 类都是 **large**；
 *   ② `Cover` 的宽高比原先是 `compact ? '3 / 4' : '2 / 3'` ——
 *      Kotlin 是 LIST 3/4（120×160）、GRID `3f/4f`、LARGE `4f/3f`（**横版**），`2 / 3` 两边都不对；
 *   ③ `FollowButton` 的 `compact`（48dp 热区）在 Kotlin 里**只有 GRID** 传 true，
 *      LIST 与 LARGE 都是 28dp。
 *
 * 另外把 `DiscoverPage` 里那一大串趋势三元表达式收敛到 `trendLabel()`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DISCOVER_CARD_RADIUS_DP,
  DISCOVER_FOLLOW_BUTTON,
  DISCOVER_GRID_COVER,
  DISCOVER_LARGE_COVER,
  DISCOVER_LIST_ROW,
  DISCOVER_MEDAL_STYLE,
  DISCOVER_SKELETON,
  DISCOVER_SOURCE_BADGE,
  DISCOVER_TAG_ROW,
  DISCOVER_TREND_HOT_THRESHOLD,
  DISCOVER_TREND_IDLE_LABEL,
  DISCOVER_TREND_NEW_LABEL,
  cardCompact,
  discoverCardRadiusDp,
  trendIsHot,
  trendLabel,
  trendTone,
} from '@core/discover/cards';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/discover/DiscoverCards.kt'),
  'utf8',
);

describe('DiscoverCards.kt：卡片圆角与奖牌描边', () => {
  it('圆角按布局三档 24 / 16 / 20', () => {
    expect(KT).toContain(
      'val shape = RoundedCornerShape(if (layout == DiscoverLayout.LARGE) 24.dp else if (layout == DiscoverLayout.GRID) 16.dp else 20.dp)',
    );
    expect(DISCOVER_CARD_RADIUS_DP.LARGE).toBe(24);
    expect(DISCOVER_CARD_RADIUS_DP.GRID).toBe(16);
    expect(DISCOVER_CARD_RADIUS_DP.LIST).toBe(20);
    expect(discoverCardRadiusDp('large')).toBe(24);
    expect(discoverCardRadiusDp('LARGE')).toBe(24);
    expect(discoverCardRadiusDp('grid')).toBe(16);
    expect(discoverCardRadiusDp('list')).toBe(20);
    // 未知布局回落 LIST（与 Kotlin 的 else 分支一致）
    expect(discoverCardRadiusDp('whatever')).toBe(20);
  });

  it('奖牌：阴影 8dp（.16 环境 / .24 聚光）、描边第一名 1.5dp 其余 1dp、渐变 .40/.56', () => {
    expect(KT).toContain(
      'Modifier.shadow(8.dp, shape, ambientColor = medal.copy(alpha = .16f), spotColor = medal.copy(alpha = .24f))',
    );
    expect(KT).toContain(
      'if (medal != null) Modifier.border(if (rank == 1) 1.5.dp else 1.dp, Brush.linearGradient(listOf(medal.copy(alpha = .40f), medal, medal.copy(alpha = .56f))), shape)',
    );
    expect(DISCOVER_MEDAL_STYLE.shadowDp).toBe(8);
    expect(DISCOVER_MEDAL_STYLE.shadowAmbientAlpha).toBe(0.16);
    expect(DISCOVER_MEDAL_STYLE.shadowSpotAlpha).toBe(0.24);
    expect(DISCOVER_MEDAL_STYLE.borderWidthFirstDp).toBe(1.5);
    expect(DISCOVER_MEDAL_STYLE.borderWidthOtherDp).toBe(1);
    expect([...DISCOVER_MEDAL_STYLE.gradientAlphas]).toEqual([0.4, 1, 0.56]);
    // 只有第一名才有阴影（Kotlin `rank == 1 && medal != null`）
    expect(KT).toContain('if (rank == 1 && medal != null) Modifier.shadow(');
  });
});

describe('DiscoverCards.kt：三种布局的封面几何', () => {
  it('LIST：行高 160dp、封面宽 120dp、间距 10dp → 封面 3:4', () => {
    expect(KT).toContain('Row(Modifier.fillMaxWidth().height(160.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(10.dp))');
    expect(KT).toContain('Box(Modifier.width(120.dp).fillMaxHeight())');
    expect(DISCOVER_LIST_ROW.rowHeightDp).toBe(160);
    expect(DISCOVER_LIST_ROW.coverWidthDp).toBe(120);
    expect(DISCOVER_LIST_ROW.gapDp).toBe(10);
    expect(DISCOVER_LIST_ROW.coverWidthDp / DISCOVER_LIST_ROW.rowHeightDp).toBe(3 / 4);
  });

  it('GRID：3:4 封面 + 底部 45% 的 .85 黑幕', () => {
    expect(KT).toContain('Box(Modifier.fillMaxWidth().aspectRatio(3f / 4f))');
    expect(KT).toContain('fillMaxHeight(.45f)');
    expect(KT).toContain('Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .85f)))');
    expect(DISCOVER_GRID_COVER.aspectRatio).toBe(0.75);
    expect(DISCOVER_GRID_COVER.overlayHeightFraction).toBe(0.45);
    expect(DISCOVER_GRID_COVER.overlayAlpha).toBe(0.85);
  });

  it('LARGE：**4:3 横版** + 底部 50% 的 .90 黑幕', () => {
    expect(KT).toContain('Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f))');
    expect(KT).toContain('fillMaxHeight(.50f)');
    expect(KT).toContain('Color.Black.copy(alpha = .90f)');
    expect(DISCOVER_LARGE_COVER.aspectRatio).toBeCloseTo(4 / 3, 12);
    expect(DISCOVER_LARGE_COVER.overlayHeightFraction).toBe(0.5);
    expect(DISCOVER_LARGE_COVER.overlayAlpha).toBe(0.9);
    // 大图是横版：比例 > 1
    expect(DISCOVER_LARGE_COVER.aspectRatio).toBeGreaterThan(1);
    // 而 GRID 是竖版
    expect(DISCOVER_GRID_COVER.aspectRatio).toBeLessThan(1);
  });
});

describe('DiscoverCards.kt：徽标 / 关注按钮 / 标签行', () => {
  it('SourceBadge：最宽 112dp、底黑 .72、内边距 8×4、10sp/12sp', () => {
    expect(KT).toContain('modifier.widthIn(max = 112.dp)');
    expect(KT).toContain('Color.Black.copy(alpha = .72f), CircleShape)');
    expect(KT).toContain('.padding(horizontal = 8.dp, vertical = 4.dp)');
    expect(KT).toContain('fontSize = 10.sp, lineHeight = 12.sp');
    expect(DISCOVER_SOURCE_BADGE.maxWidthDp).toBe(112);
    expect(DISCOVER_SOURCE_BADGE.backgroundAlpha).toBe(0.72);
    expect(DISCOVER_SOURCE_BADGE.fontSizeSp).toBe(10);
  });

  it('FollowButton：compact 48dp / 普通 28dp，图标 20dp', () => {
    expect(KT).toContain('Box(modifier.size(if (compact) 48.dp else 28.dp)');
    expect(KT).toContain('Modifier.size(20.dp)');
    expect(DISCOVER_FOLLOW_BUTTON.compactSizeDp).toBe(48);
    expect(DISCOVER_FOLLOW_BUTTON.sizeDp).toBe(28);
    expect(DISCOVER_FOLLOW_BUTTON.iconSizeDp).toBe(20);
    // 48 是「最小可点热区」，28 是纯图标，两者都要 >= 20 的图标
    expect(DISCOVER_FOLLOW_BUTTON.sizeDp).toBeGreaterThanOrEqual(DISCOVER_FOLLOW_BUTTON.iconSizeDp);
  });

  it('TagRow：最多 3 个 + `+N` 溢出，底 onSurface@.06，6×2 内边距，11sp/14sp', () => {
    expect(KT).toContain('(labels.take(3) + if (labels.size > 3) listOf("+${labels.size - 3}") else emptyList())');
    expect(KT).toContain('.background(MaterialTheme.colorScheme.onSurface.copy(alpha = .06f), CircleShape)');
    expect(KT).toContain('.padding(horizontal = 6.dp, vertical = 2.dp)');
    expect(KT).toContain('fontSize = 11.sp, lineHeight = 14.sp');
    expect(DISCOVER_TAG_ROW.maxVisible).toBe(3);
    expect(DISCOVER_TAG_ROW.backgroundAlpha).toBe(0.06);
    expect(DISCOVER_TAG_ROW.paddingHorizontalDp).toBe(6);
    expect(DISCOVER_TAG_ROW.paddingVerticalDp).toBe(2);
  });
});

describe('DiscoverCards.kt：cardCompact 的四档', () => {
  it('≥1e8 → y、≥1e4 → w、≥1e3 → k、否则原样（都带一位小数）', () => {
    expect(KT).toContain('value >= 100_000_000 -> String.format(java.util.Locale.ROOT, "%.1fy", value / 100_000_000.0)');
    expect(KT).toContain('value >= 10_000 -> String.format(java.util.Locale.ROOT, "%.1fw", value / 10_000.0)');
    expect(KT).toContain('value >= 1_000 -> String.format(java.util.Locale.ROOT, "%.1fk", value / 1_000.0)');
    expect(KT).toContain('else -> value.toString()');

    expect(cardCompact(0)).toBe('0');
    expect(cardCompact(999)).toBe('999');
    expect(cardCompact(1000)).toBe('1.0k');
    expect(cardCompact(1500)).toBe('1.5k');
    // 档位边界按「先判大档」：9999 走 k 档（9.999 → 10.0k），10000 走 w 档
    expect(cardCompact(9999)).toBe('10.0k');
    expect(cardCompact(10000)).toBe('1.0w');
    expect(cardCompact(12345)).toBe('1.2w');
    expect(cardCompact(100_000_000)).toBe('1.0y');
    expect(cardCompact(250_000_000)).toBe('2.5y');
    // 小数截断成整数再进档位表
    // 小数先截断成整数再进档位表：1499 → 1.499k → %.1f = 1.5k
    expect(cardCompact(1499.9)).toBe('1.5k');
  });
});

describe('DiscoverCards.kt：趋势标签的四个分支', () => {
  it('① 新上榜 + RANKING → NEW（不看数值）', () => {
    expect(KT).toContain('entry.newEntry && dimension == DiscoverDimension.RANKING -> "NEW"');
    expect(DISCOVER_TREND_NEW_LABEL).toBe('NEW');
    expect(trendLabel({ value: null, dimension: 'RANKING', newEntry: true })).toBe('NEW');
    expect(trendLabel({ value: 42, dimension: 'RANKING', newEntry: true })).toBe('NEW');
    // 非 RANKING 的 newEntry 不产生 NEW，走数值分支
    expect(trendLabel({ value: 12.5, dimension: 'UPDATES', newEntry: true })).toBe('▲12.5%');
  });

  it('② 无值或 0 → 破折号', () => {
    expect(KT).toContain('value == null || value == 0.0 -> "—"');
    expect(DISCOVER_TREND_IDLE_LABEL).toBe('—');
    // value 为 null 且不是新上榜 → 整块不渲染（Kotlin L308 的 return）

    expect(trendLabel({ value: null, dimension: 'CLICKS', newEntry: false })).toBeNull();
    expect(trendLabel({ value: 0, dimension: 'RANKING', newEntry: false })).toBe('—');
    expect(trendLabel({ value: 0, dimension: 'DISCUSSION', newEntry: false })).toBe('—');
  });

  it('③ RANKING → 整数 + 升降箭头（无百分号）', () => {
    expect(KT).toContain('dimension == DiscoverDimension.RANKING -> "${if (value > 0) "↑" else "↓"}${kotlin.math.abs(value).toInt()}"');
    expect(trendLabel({ value: 3, dimension: 'RANKING', newEntry: false })).toBe('↑3');
    expect(trendLabel({ value: -2, dimension: 'RANKING', newEntry: false })).toBe('↓2');
    expect(trendLabel({ value: 2.9, dimension: 'RANKING', newEntry: false })).toBe('↑2');
    expect(trendLabel({ value: 3, dimension: 'RANKING', newEntry: false })).not.toContain('%');
  });

  it('④ 其它维度 → 一位小数 + 百分号', () => {
    expect(KT).toContain('else -> "${if (value > 0) "▲" else "▼"}${String.format(java.util.Locale.CHINA, "%.1f", kotlin.math.abs(value))}%"');
    expect(trendLabel({ value: 12.34, dimension: 'CLICKS', newEntry: false })).toBe('▲12.3%');
    expect(trendLabel({ value: -5, dimension: 'UPDATES', newEntry: false })).toBe('▼5.0%');
    expect(trendLabel({ value: 0.04, dimension: 'DISCUSSION', newEntry: false })).toBe('▲0.0%');
  });

  it('既没值也不是新上榜 → 整块不渲染（返回 null）', () => {
    expect(KT).toContain('if (value == null && !entry.newEntry) return');
    expect(trendLabel({ value: null, dimension: 'UPDATES', newEntry: false })).toBeNull();
  });

  it('飙升火苗：value ≥ 100 且非 RANKING', () => {
    expect(KT).toContain('if (value != null && value >= 100 && dimension != DiscoverDimension.RANKING)');
    expect(KT).toContain('Icons.Outlined.LocalFireDepartment');
    expect(DISCOVER_TREND_HOT_THRESHOLD).toBe(100);
    expect(trendIsHot(100, 'CLICKS')).toBe(true);
    expect(trendIsHot(99.9, 'CLICKS')).toBe(false);
    expect(trendIsHot(500, 'RANKING')).toBe(false);
    expect(trendIsHot(null, 'CLICKS')).toBe(false);
  });

  it('颜色三分支：NEW / idle / 升降（reverse 时互换）', () => {
    expect(KT).toContain('color = if (label == "NEW") discoverAccentText()');
    expect(trendTone({ label: 'NEW', value: 5, reverse: false })).toBe('new');
    expect(trendTone({ label: '—', value: 0, reverse: false })).toBe('idle');
    expect(trendTone({ label: '▲1.0%', value: 1, reverse: false })).toBe('rise');
    expect(trendTone({ label: '▼1.0%', value: -1, reverse: false })).toBe('fall');
    // 绿涨红跌开关打开后，涨=fall、跌=rise
    expect(trendTone({ label: '▲1.0%', value: 1, reverse: true })).toBe('fall');
    expect(trendTone({ label: '▼1.0%', value: -1, reverse: true })).toBe('rise');
  });
});

describe('DiscoverCards.kt：骨架屏', () => {
  it('透明度 .4 ↔ .8、600ms、Reverse；减少动态效果时恒 .6', () => {
    expect(KT).toContain('animateFloat(.4f, .8f, infiniteRepeatable(tween(600), RepeatMode.Reverse)');
    expect(KT).toContain('val alpha = if (reduce) .6f else');
    expect(DISCOVER_SKELETON.alphaFrom).toBe(0.4);
    expect(DISCOVER_SKELETON.alphaTo).toBe(0.8);
    expect(DISCOVER_SKELETON.cycleMs).toBe(600);
    expect(DISCOVER_SKELETON.reducedAlpha).toBe(0.6);
  });

  it('LIST 分支：72×96 封面占位 + 右侧 3 行（12dp 间距）；整体内边距 10dp', () => {
    expect(KT).toContain('Box(Modifier.size(72.dp, 96.dp)');
    expect(KT).toContain('spacedBy(12.dp)) { repeat(3)');
    expect(KT).toContain('Column(Modifier.fillMaxWidth().padding(10.dp))');
    expect(DISCOVER_SKELETON.listCoverWidthDp).toBe(72);
    expect(DISCOVER_SKELETON.listCoverHeightDp).toBe(96);
    expect(DISCOVER_SKELETON.listLineCount).toBe(3);
    expect(DISCOVER_SKELETON.listLineGapDp).toBe(12);
    expect(DISCOVER_SKELETON.paddingDp).toBe(10);
    // 占位封面同为 3:4
    expect(DISCOVER_SKELETON.listCoverWidthDp / DISCOVER_SKELETON.listCoverHeightDp).toBe(3 / 4);
  });

  it('GRID / LARGE 分支复用同一组宽高比（3f/4f 与 4f/3f）', () => {
    expect(KT).toContain('aspectRatio(if (layout == DiscoverLayout.GRID) 3f / 4f else 4f / 3f)');
  });
});

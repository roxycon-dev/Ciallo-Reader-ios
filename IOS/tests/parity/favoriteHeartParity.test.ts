/**
 * favoriteHeartParity.test.ts —— 「喜欢」按钮的动画时序、粒子几何与文案。
 *
 * `ui/favorite/FavoriteHeart.kt`（304 行）是漫画页 / 顶栏 / 卡片右下角共用的一个组件，
 * 两种语义（设计稿 §1.1）：
 *   · **喜欢**：心形弹簧 `0.6 → 1.25 → 1.0`（≈350ms 轻微过冲）+ 填充从中心扩散
 *             + 7 个粒子飘散（≈600ms）+ LIGHT 触觉；
 *   · **取消**：心形 `0.86 → 1.0` 收缩变灰、**无粒子**、SELECTION 触觉。
 *
 * 本轮补的真缺口：iOS 侧此前只有 `FAV_BURST_COUNT = 7`（数量），
 * **粒子几何（角度 / 距离 / 透明度 / 边长 / 缩放 / 奇偶）完全没落**。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  FAV_ARIA_OFF,
  FAV_ARIA_ON,
  FAV_BURST_COUNT,
  FAV_BURST_DISTANCE_BASE,
  FAV_BURST_DISTANCE_GROWTH,
  FAV_BURST_SCALE_DECAY,
  FAV_BURST_SIZE_SHRINK,
  FAV_BURST_SIZE_START,
  FAV_DISABLED_HINT,
  FAV_PARTICLE_MS,
  FAV_PRESS_SCALE,
  HeartMid,
  heartBurstParticles,
} from '@core/favorite/favoriteUi';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/favorite/FavoriteHeart.kt'),
  'utf8',
);

describe('FavoriteHeart.kt：两种语义的动画时序', () => {
  it('喜欢：0.6 → 1.25 → 1.0（过冲）＋ LIGHT 触觉 ＋ 粒子', () => {
    expect(KT).toContain('scale.snapTo(0.6f)');
    expect(KT).toContain('scale.animateTo(1.25f, AppMotion.springDefault)');
    expect(KT).toContain('scale.animateTo(1f, tween(120))');
    expect(KT).toContain('haptics.perform(HapticKind.LIGHT)');
    expect(KT).toContain('burstId++');
    // 过冲幅度 = 1.25（比终态大 25%）
    expect(1.25).toBeGreaterThan(1);
  });

  it('取消：0.86 → 1.0（收缩变灰）＋ SELECTION 触觉 ＋ **无粒子**', () => {
    expect(KT).toContain('scale.animateTo(0.86f, tween(110))');
    expect(KT).toContain('haptics.perform(HapticKind.SELECTION)');
    // 取消分支里不能出现 burstId++
    const cancelBranch = KT.slice(KT.indexOf('} else {', KT.indexOf('if (favorite) {')), KT.indexOf('LaunchedEffect(burstId)'));
    expect(cancelBranch).not.toContain('burstId++');
  });

  it('减少动态效果时所有 animateTo 时长归零（tween(0)）', () => {
    expect(KT).toContain('fill.animateTo(1f, tween(if (reduceMotion) 0 else AppMotion.ICON_MS))');
    expect(KT).toContain('if (!reduceMotion) {');
    // 粒子只在非 reduceMotion 时播
    expect(KT).toContain('if (burstId > 0 && !reduceMotion) {');
  });

  it('首次组合只 snap 不播动画（避免进页面就闪一下）', () => {
    expect(KT).toContain('var initialized by remember { mutableStateOf(false) }');
    expect(KT).toContain('if (!initialized) {');
    expect(KT).toContain('fill.snapTo(if (favorite) 1f else 0f)');
    expect(KT).toContain('return@LaunchedEffect');
  });
});

describe('FavoriteHeart.kt：粒子几何（本轮补齐）', () => {
  it('7 颗、从正上方开始均匀分布、距离 14 → 40', () => {
    expect(KT).toContain('val count = 7');
    expect(KT).toContain('val angle = (Math.PI * 2.0 * i / count) - Math.PI / 2.0');
    expect(KT).toContain('val distance = (14f + 26f * progress)');
    expect(FAV_BURST_COUNT).toBe(7);
    expect(FAV_BURST_DISTANCE_BASE).toBe(14);
    expect(FAV_BURST_DISTANCE_GROWTH).toBe(26);

    const p0 = heartBurstParticles(0);
    expect(p0).toHaveLength(7);
    // 第一颗在正上方：angle = -π/2 → offsetX ≈ 0、offsetY ≈ -14
    expect(p0[0]?.angle).toBeCloseTo(-Math.PI / 2, 9);
    expect(p0[0]?.offsetX).toBeCloseTo(0, 9);
    expect(p0[0]?.offsetY).toBeCloseTo(-14, 9);
    // 距离随 progress 线性增长到 40
    expect(heartBurstParticles(1)[0]?.distance).toBe(40);
    // 角度间隔 = 2π/7
    expect((p0[1]?.angle ?? 0) - (p0[0]?.angle ?? 0)).toBeCloseTo((Math.PI * 2) / 7, 9);
  });

  it('透明度 1-p、边长 7-3p、缩放 1-0.3p', () => {
    expect(KT).toContain('val alpha = (1f - progress).coerceIn(0f, 1f)');
    expect(KT).toContain('val size = (7f - 3f * progress).dp');
    expect(KT).toContain('scaleX = 1f - 0.3f * progress');

    const p0 = heartBurstParticles(0)[0];
    const p1 = heartBurstParticles(1)[0];
    const pHalf = heartBurstParticles(0.5)[0];
    expect(p0?.alpha).toBe(1);
    expect(p1?.alpha).toBe(0);
    expect(pHalf?.alpha).toBe(0.5);
    expect(p0?.sizeDp).toBe(7);
    expect(p1?.sizeDp).toBe(4);
    expect(FAV_BURST_SIZE_START).toBe(7);
    expect(FAV_BURST_SIZE_SHRINK).toBe(3);
    expect(p0?.scale).toBe(1);
    expect(p1?.scale).toBeCloseTo(0.7, 9);
    expect(FAV_BURST_SCALE_DECAY).toBe(0.3);
  });

  it('偶数颗画心、奇数颗画圆（7 颗 → 4 心 3 圆）', () => {
    expect(KT).toContain('val isHeart = i % 2 == 0');
    const particles = heartBurstParticles(0.5);
    expect(particles.filter((p) => p.isHeart)).toHaveLength(4);
    expect(particles.filter((p) => !p.isHeart)).toHaveLength(3);
    expect(particles.map((p) => p.isHeart)).toEqual([true, false, true, false, true, false, true]);
  });

  it('progress 越界被钳制', () => {
    expect(heartBurstParticles(2)[0]?.distance).toBe(40);
    expect(heartBurstParticles(-1)[0]?.distance).toBe(14);
    expect(heartBurstParticles(2)[0]?.alpha).toBe(0);
  });

  it('粒子与本体同色（HeartMid），不是薄荷绿', () => {
    expect(KT).toContain('HeartBurst(progress = burst.value, color = HeartMid)');
    expect(KT).toContain('原来是薄荷绿，和正红的心摆在一起像两套语言');
    expect(HeartMid).toBe('#FF4D6D');
    expect(FAV_PARTICLE_MS).toBe(600);
  });
});

describe('FavoriteHeart.kt：尺寸 / 按压 / 文案', () => {
  it('48 高、showLabel ? 108 : 48、圆角 24、横向内边距 14、图标-文字间距 6、字号 13', () => {
    expect(KT).toContain('.size(height = 48.dp, width = if (showLabel) 108.dp else 48.dp)');
    expect(KT).toContain('RoundedCornerShape(24.dp)');
    expect(KT).toContain('Modifier.padding(horizontal = if (showLabel) 14.dp else 0.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.width(6.dp))');
    expect(KT).toContain('fontSize = 13.sp');
    // 图标态仍保证 ≥48dp 热区（Kotlin L287 的注释）
    expect(KT).toContain('热区仍保证 ≥48dp');
  });

  it('按压缩放 0.94 / 110ms；禁用在 0.4 透明度', () => {
    expect(KT).toContain('targetValue = if (pressed) 0.94f else 1f');
    expect(KT).toContain('animationSpec = tween(110)');
    expect(KT).toContain('val containerAlpha = if (enabled) 1f else 0.4f');
    expect(FAV_PRESS_SCALE).toBe(0.94);
  });

  it('选中/未选中的底色与描边 alpha', () => {
    expect(KT).toContain('MintPrimary.copy(alpha = 0.14f)');
    expect(KT).toContain('MintPrimary.copy(alpha = 0.45f)');
    expect(KT).toContain('surface.copy(alpha = 0.55f)');
    expect(KT).toContain('onSurface.copy(alpha = 0.14f)');
  });

  it('渐变心从中心长出来（0.6 → 1.0）＋ 外发光 1.1×fill', () => {
    expect(KT).toContain('scaleX = 0.6f + 0.4f * fill');
    expect(KT).toContain('glow = fill * 1.1f');
    // 空心态用 alpha = 1 - fill 交叉淡化
    expect(KT).toContain('alpha = 1f - fill');
  });

  it('三条无障碍/提示文案逐字一致', () => {
    expect(KT).toContain('disabledHint: String = "这本书没有来源信息，无法加入「我喜欢的」"');
    expect(KT).toContain('tr("已喜欢，点击取消喜欢")');
    expect(KT).toContain('tr("喜欢，加入我喜欢的")');
    expect(FAV_DISABLED_HINT).toBe('这本书没有来源信息，无法加入「我喜欢的」');
    expect(FAV_ARIA_ON).toBe('已喜欢，点击取消喜欢');
    expect(FAV_ARIA_OFF).toBe('喜欢，加入我喜欢的');
  });

  it('长按 = 弹分类选择；禁用时点击与长按都走 onDisabledClick', () => {
    expect(KT).toContain('if (!enabled) {');
    expect(KT).toContain('onDisabledClick?.invoke()');
    expect(KT).toContain('if (enabled) onLongPress?.invoke() else onDisabledClick?.invoke()');
    expect(KT).toContain('长按 = 直接弹出分类选择 Sheet');
  });

  it('「飞向书架」的旧动效已删除，不要再加回去', () => {
    expect(KT).toContain('已整体删除（ShelfFly 控制器 + 全屏覆盖层 + 落点弹跳）');
    expect(KT).toContain('这里不要再往回加');
    // 代码里不能残留 ShelfFly
    expect(KT).not.toContain('ShelfFly(');
  });
});

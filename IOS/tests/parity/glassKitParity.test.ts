/**
 * glassKitParity.test.ts —— GlassKit 家族（`ui/glasskit/GlassKit.kt`，519 行 / 11 声明）。
 *
 * 这套是新一代玻璃（连续曲率圆角 + 透镜折射 + 中性着色），与旧的 `GlassCard` 并行。
 * 数值错了不会崩，只会「看着不像设计稿」，所以每个 dp / alpha / 公式都从 Kotlin 原文解析后对拍。
 *
 * 本轮修掉的三处真漂移（都是「用了错的常量」而非漏实现）：
 *   ① 卡片实时模糊用了 `GlassTokens.Blur`(16)，而 Kotlin 卡片消费的是
 *      `tweaks.blurRadiusDp`（`CardTweaks.kt` L12 出厂 **22**）—— 整张卡比设计稿薄 6dp；
 *   ② 轻量档用了 `GlassTokens.BlurLightweight`(8)，Kotlin 是 `tweaks.blurRadiusDp * 0.5f`
 *      （出厂 **11**）；那个 8dp token 在 Kotlin 里卡片从不消费；
 *   ③ 圆角忽略了 `tweaks.cornerRadiusDp`（Kotlin L337 `scaledCardCorners`），
 *      外观设置的圆角滑条对 GlassKit 卡片零效果。
 *
 * 另外补上 `GlassTokens.ManagementTitleHeight = 152.dp`（Kotlin L89，此前 iOS 缺）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CARD_TWEAK_PRESS_RADIUS,
  CARD_TWEAK_PRESS_STRENGTH,
  GLASSKIT_CARD_PRESS_DEPTH,
  GLASSKIT_CARD_PRESS_SPRING,
  GLASSKIT_HIGHLIGHT_ALPHA_BASE,
  GLASSKIT_HIGHLIGHT_RADIUS_BASE,
  GLASSKIT_HOST_SATURATION,
  GLASSKIT_LIGHTWEIGHT_BLUR_FACTOR,
  GLASSKIT_PRESS_MIN_SCALE,
  GLASSKIT_REDUCE_THRESHOLD,
  GLASSKIT_REDUCE_TRANSPARENCY_KEYS,
  GLASSKIT_TOP_BAR_DIVIDER_ALPHA,
  GLASSKIT_TOP_BAR_TINT_ALPHA,
  GLASSKIT_TOP_BAR_TINT_ALPHA_REDUCE,
  GlassTokens,
  SQUIRCLE_CONTROL_K,
  glassCardBlurPx,
  glassKitCardPressScale,
  glassKitPressHighlightAlpha,
  glassKitPressHighlightRadius,
  glassKitReducesTransparency,
  glassKitTint,
  glassTopBarDividerAlpha,
  glassTopBarTintAlpha,
  pageOverlayColor,
  pressHighlightCss,
  squirclePath,
  squircleRadiusFor,
  topGradientStops,
} from '@core/glass/glassKit';
import { DEFAULT_CARD_TWEAKS, rescaleCornerRadius } from '@core/glass/cardTweaks';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/glasskit/GlassKit.kt'),
  'utf8',
);

/** 从 Kotlin 读 `val Name = 24.dp` / `const val Name = 0.22f` / `val Name = 152.dp`。 */
function ktNumber(name: string): number | null {
  const re = new RegExp(
    `(?:const\\s+)?val\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)(f|\\.dp)?`,
  );
  const m = re.exec(KT);
  return m === null ? null : Number(m[1]);
}

describe('GlassKit.kt：GlassTokens 全表（22 个 token）', () => {
  it('22 个 token 一个不少，值逐个从 Kotlin 解析后对拍', () => {
    const names = [
      'ManagementTitleHeight',
      'Radius',
      'InnerRadius',
      'IconRadius',
      'Blur',
      'BlurLightweight',
      'LensHeight',
      'LensAmount',
      'TintLight',
      'TintDark',
      'TintReduce',
      'PageOverlayLight',
      'PageOverlayDark',
      'TopGradientAlpha',
      'RowMinHeight',
      'ScreenPadding',
      'CardGap',
      'ChipHeight',
      'PillRadius',
      'TopBarHeight',
      'TopBarBlur',
      'Hairline',
    ] as const;
    expect(Object.keys(GlassTokens)).toHaveLength(names.length);
    for (const name of names) {
      const want = ktNumber(name);
      expect(want, `Kotlin 没读到 ${name}`).not.toBeNull();
      expect(GlassTokens[name], `${name} 与 Kotlin 不一致`).toBe(want);
    }
  });

  it('ManagementTitleHeight = 152.dp（此前 iOS 整条缺失）', () => {
    expect(KT).toContain('val ManagementTitleHeight = 152.dp');
    expect(GlassTokens.ManagementTitleHeight).toBe(152);
    // 它必须比折叠顶栏高（大标题区 = 状态栏 + 标题 + 24）
    expect(GlassTokens.ManagementTitleHeight).toBeGreaterThan(GlassTokens.TopBarHeight);
  });

  it('模糊三档的序关系：TopBarBlur(8) < Blur(16) < 卡片出厂 22', () => {
    expect(GlassTokens.TopBarBlur).toBeLessThan(GlassTokens.Blur);
    expect(GlassTokens.Blur).toBeLessThan(DEFAULT_CARD_TWEAKS.blurRadiusDp);
    // 顶栏是薄片、卡片最厚 —— 与 Kotlin 的注释一致
    expect(KT).toContain('折叠顶栏的玻璃模糊（比卡片弱，只是薄薄一层）');
  });

  it('着色三档：常态 .22/.78、降级 .92；深色比亮色浓', () => {
    expect(GlassTokens.TintLight).toBe(0.22);
    expect(GlassTokens.TintDark).toBe(0.78);
    expect(GlassTokens.TintReduce).toBe(0.92);
    expect(GlassTokens.TintDark).toBeGreaterThan(GlassTokens.TintLight);
    // 降级档最浓（几乎不透明）
    expect(GlassTokens.TintReduce).toBeGreaterThan(GlassTokens.TintDark);
    expect(KT).toContain('const val TintLight = 0.22f');
    expect(KT).toContain('const val TintDark = 0.78f');
    expect(KT).toContain('const val TintReduce = 0.92f');
  });
});

describe('GlassKit.kt：连续曲率圆角（squircle）', () => {
  it('控制点比例 0.72（正圆是 0.5522），四段三次贝塞尔闭合', () => {
    expect(KT).toContain('val k = r * 0.72f');
    expect(SQUIRCLE_CONTROL_K).toBe(0.72);
    // 0.72 比正圆控制点更"饱满" —— 曲线连续曲率的关键
    expect(SQUIRCLE_CONTROL_K).toBeGreaterThan(0.5522);

    const d = squirclePath(200, 100, 16);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(d.match(/L/g)).toHaveLength(4);
    expect(d.trim().endsWith('Z')).toBe(true);
    // 控制点用的是 k = 16 * 0.72 = 11.52
    expect(d).toContain(`${200 - 16 + 11.52},0`);
  });

  it('r <= 0 退化成矩形（Kotlin L193-196 的 addRect 分支）', () => {
    expect(KT).toContain('if (r <= 0f) {');
    expect(squirclePath(40, 30, 0)).toBe('M0,0 H40 V30 H0 Z');
    expect(squirclePath(40, 30, -5)).toContain('M0,0');
  });

  it('半径夹到短边的一半（Kotlin L174-175 的 minOf）', () => {
    expect(KT).toContain('val max = minOf(size.width, size.height) / 2f');
    expect(KT).toContain('val r = minOf(topStart, topEnd, bottomEnd, bottomStart, max)');
    expect(squircleRadiusFor(200, 100, 60)).toBe(50);
    expect(squircleRadiusFor(200, 100, 16)).toBe(16);
    expect(squircleRadiusFor(200, 100, -1)).toBe(0);
  });

  it('GlassCardShape = SquircleShape(CornerSize(Radius)) → 24dp', () => {
    expect(KT).toContain('val GlassCardShape: CornerBasedShape get() = SquircleShape(CornerSize(GlassTokens.Radius))');
    expect(GlassTokens.Radius).toBe(24);
  });

  it('圆角滑条：scaledCardCorners 以 16dp 为锚点按比例缩放（本轮接进卡片）', () => {
    expect(KT).toContain('val effectiveShape = remember(shape, tweaks.cornerRadiusDp) { shape.scaledCardCorners(tweaks.cornerRadiusDp) }');
    expect(DEFAULT_CARD_TWEAKS.cornerRadiusDp).toBe(16);
    // 出厂 16dp → 24dp 形状原样
    expect(rescaleCornerRadius(24, 16)).toBe(24);
    // 滑到 8dp → 24 * 8/16 = 12；滑到 48 → 72
    expect(rescaleCornerRadius(24, 8)).toBe(12);
    expect(rescaleCornerRadius(24, 48)).toBe(72);
  });
});

describe('GlassKit.kt：宿主层（壁纸遮罩 + 顶部渐变）', () => {
  it('遮罩：亮色白 .16 / 深色黑 .40', () => {
    expect(KT).toContain('Color.Black.copy(alpha = GlassTokens.PageOverlayDark)');
    expect(KT).toContain('Color.White.copy(alpha = GlassTokens.PageOverlayLight)');
    expect(pageOverlayColor(false)).toBe('rgba(255, 255, 255, 0.16)');
    expect(pageOverlayColor(true)).toBe('rgba(0, 0, 0, 0.4)');
    // 深色遮罩必须比亮色重（深色下壁纸更刺眼）
    expect(GlassTokens.PageOverlayDark).toBeGreaterThan(GlassTokens.PageOverlayLight);
  });

  it('宿主实时档 saturation = 1.15（与卡片的 vibrancy 1.5 是两个调用点）', () => {
    expect(KT).toContain('saturation = 1.15f');
    expect(GLASSKIT_HOST_SATURATION).toBe(1.15);
    expect(GLASSKIT_HOST_SATURATION).not.toBe(1.5);
  });

  it('宿主模糊用 GlassTokens.Blur(16)、形状是矩形', () => {
    expect(KT).toContain('blurRadius = GlassTokens.Blur');
    expect(KT).toContain('shape = RectangleShape');
    expect(GlassTokens.Blur).toBe(16);
  });

  it('顶部渐变 .75 → 透明，高度由调用方给（状态栏 + 标题区 + 24）', () => {
    expect(KT).toContain('bg.copy(alpha = GlassTokens.TopGradientAlpha)');
    expect(KT).toContain('Color.Transparent');
    expect(KT).toContain('顶部渐变高度（= 状态栏 + 大标题区 + 24）');
    expect(topGradientStops('#101010')).toContain('0.75');
    expect(topGradientStops('#101010')).toContain('0');
  });

  it('卡片必须是兄弟节点（放进录制层会采样到自己）', () => {
    expect(KT).toContain('卡片必须作为这层的**兄弟节点**');
  });
});

describe('GlassKit.kt：降低透明度判定', () => {
  it('两个 Secure key，阈值 0.5，读不到即 false', () => {
    expect(KT).toContain('flag("reduce_transparency") || flag("high_text_contrast_enabled")');
    expect(KT).toContain('?.let { it >= 0.5f } ?: false');
    expect([...GLASSKIT_REDUCE_TRANSPARENCY_KEYS]).toEqual([
      'reduce_transparency',
      'high_text_contrast_enabled',
    ]);
    expect(GLASSKIT_REDUCE_THRESHOLD).toBe(0.5);
  });

  it('纯函数形态：任一 key ≥ 0.5 即开；空/非法/缺失都是关', () => {
    expect(glassKitReducesTransparency({})).toBe(false);
    expect(glassKitReducesTransparency({ reduce_transparency: '0.4' })).toBe(false);
    expect(glassKitReducesTransparency({ reduce_transparency: '0.5' })).toBe(true);
    expect(glassKitReducesTransparency({ high_text_contrast_enabled: '1' })).toBe(true);
    expect(glassKitReducesTransparency({ reduce_transparency: 'abc' })).toBe(false);
    expect(glassKitReducesTransparency({ reduce_transparency: '' })).toBe(false);
    expect(glassKitReducesTransparency({ reduce_transparency: 0.9 })).toBe(true);
    // 不看别的 key
    expect(glassKitReducesTransparency({ something_else: '1' })).toBe(false);
  });
});

describe('GlassKit.kt：卡片着色与模糊（三处漂移已修）', () => {
  it('实时模糊是 tweaks.blurRadiusDp（22），不是 GlassTokens.Blur(16)', () => {
    expect(KT).toContain('blur(tweaks.blurRadiusDp.dp.toPx())');
    expect(DEFAULT_CARD_TWEAKS.blurRadiusDp).toBe(22);
    expect(glassCardBlurPx(DEFAULT_CARD_TWEAKS.blurRadiusDp, false)).toBe(22);
    expect(glassCardBlurPx(DEFAULT_CARD_TWEAKS.blurRadiusDp, false)).not.toBe(GlassTokens.Blur);
  });

  it('轻量档 = 模糊的一半（出厂 11），不是 BlurLightweight 的 8', () => {
    expect(KT).toContain('blur((tweaks.blurRadiusDp.dp * 0.5f).toPx())');
    expect(GLASSKIT_LIGHTWEIGHT_BLUR_FACTOR).toBe(0.5);
    expect(glassCardBlurPx(22, true)).toBe(11);
    expect(glassCardBlurPx(22, true)).not.toBe(GlassTokens.BlurLightweight);
    // 半量永远小于全量
    expect(glassCardBlurPx(22, true)).toBeLessThan(glassCardBlurPx(22, false));
    // 外观设置改模糊时两档一起动
    expect(glassCardBlurPx(30, false)).toBe(30);
    expect(glassCardBlurPx(30, true)).toBe(15);
  });

  it('着色链：降级 → surface/白 .92；深色 → surface .78；亮色 → 白 .22', () => {
    expect(KT).toContain('if (dark) cs.surface.copy(alpha = GlassTokens.TintReduce)');
    expect(KT).toContain('else Color.White.copy(alpha = GlassTokens.TintReduce)');
    expect(KT).toContain('cs.surface.copy(alpha = GlassTokens.TintDark)');
    expect(KT).toContain('Color.White.copy(alpha = GlassTokens.TintLight)');

    const light = glassKitTint({ dark: false, surface: '#101010', reduceTransparency: false });
    expect(light.tint).toBe('rgba(255, 255, 255, 0.22)');
    const dark = glassKitTint({ dark: true, surface: '#101010', reduceTransparency: false });
    expect(dark.tint).toBe('rgba(16, 16, 16, 0.78)');
    const reduced = glassKitTint({ dark: true, surface: '#101010', reduceTransparency: true });
    expect(reduced.tint).toBe('rgba(16, 16, 16, 0.92)');
  });

  it('无实时模糊的回退底：深色 surface .85 / 亮色白 .78', () => {
    expect(KT).toContain('val solidBase = if (dark) cs.surface.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.78f)');
    const light = glassKitTint({ dark: false, surface: '#101010', reduceTransparency: false });
    expect(light.solidTint).toBe('rgba(255, 255, 255, 0.78)');
    const dark = glassKitTint({ dark: true, surface: '#101010', reduceTransparency: false });
    expect(dark.solidTint).toBe('rgba(16, 16, 16, 0.85)');
    // 回退底一定比实时着色更实（不然低端机上文字没法读）
    expect(0.85).toBeGreaterThan(GlassTokens.TintDark);
    expect(0.78).toBeGreaterThan(GlassTokens.TintLight);
  });

  it('按压缩放 = 1 - 0.02 × pressStrength（出厂 1.25 → 0.975）', () => {
    expect(KT).toContain('targetValue = if (pressed && !reduceMotion) 1f - 0.02f * tweaks.pressStrength else 1f');
    expect(GLASSKIT_CARD_PRESS_DEPTH).toBe(0.02);
    expect(CARD_TWEAK_PRESS_STRENGTH).toBe(1.25);
    expect(glassKitCardPressScale(true, false)).toBeCloseTo(1 - 0.02 * 1.25, 12);
    expect(glassKitCardPressScale(true, false)).toBeCloseTo(0.975, 12);
    // 减少动态效果 / 未按下 → 原尺寸
    expect(glassKitCardPressScale(true, true)).toBe(1);
    expect(glassKitCardPressScale(false, false)).toBe(1);
    // 滑条拉满时比满强度更深
    expect(glassKitCardPressScale(true, false, 2)).toBeLessThan(glassKitCardPressScale(true, false, 1));
    // 与常量表一致
    expect(GLASSKIT_PRESS_MIN_SCALE).toBeCloseTo(glassKitCardPressScale(true, false, 1.25), 10);
  });

  it('按压弹簧 spring(dampingRatio .6, stiffness 400)', () => {
    expect(KT).toContain('animationSpec = spring(dampingRatio = 0.6f, stiffness = 400f)');
    expect(GLASSKIT_CARD_PRESS_SPRING.dampingRatio).toBe(0.6);
    expect(GLASSKIT_CARD_PRESS_SPRING.stiffness).toBe(400);
  });

  it('折射 lens(14dp, 22dp, depthEffect) 只在非降级、非轻量时挂', () => {
    expect(KT).toContain('if (!reduce) {');
    expect(KT).toContain('refractionHeight = GlassTokens.LensHeight.toPx()');
    expect(KT).toContain('refractionAmount = GlassTokens.LensAmount.toPx()');
    expect(KT).toContain('depthEffect = true');
    expect(GlassTokens.LensHeight).toBe(14);
    expect(GlassTokens.LensAmount).toBe(22);
    // 轻量档一个 shader 就够（lens 最贵）
    expect(KT).toContain('动画中的帧：一个 shader 就够（lens 与 vibrancy 静止后再回来）');
  });

  it('极简档退化成纯色（lerp(surface, primary, tintMix) @cardAlpha）', () => {
    expect(KT).toContain('if (LocalRenderQuality.current.minimal) {');
    expect(KT).toContain('val flatTint = lerp(cs.surface, cs.primary, tweaks.tintMix).copy(alpha = tweaks.cardAlpha)');
    expect(DEFAULT_CARD_TWEAKS.tintMix).toBe(0.08);
    expect(DEFAULT_CARD_TWEAKS.cardAlpha).toBe(1);
  });

  it('高光跟随手指：半径 minDimension × 0.5 × pressRadius、alpha 0.16 × pressStrength', () => {
    expect(KT).toContain('val radius = size.minDimension * 0.5f * tweaks.pressRadius');
    expect(KT).toContain('Color.White.copy(alpha = 0.16f * tweaks.pressStrength)');
    expect(GLASSKIT_HIGHLIGHT_RADIUS_BASE).toBe(0.5);
    expect(GLASSKIT_HIGHLIGHT_ALPHA_BASE).toBe(0.16);
    expect(CARD_TWEAK_PRESS_RADIUS).toBe(1.1);

    expect(glassKitPressHighlightRadius(200)).toBeCloseTo(200 * 0.5 * 1.1, 12);
    expect(glassKitPressHighlightRadius(200)).toBeCloseTo(110, 12);
    expect(glassKitPressHighlightRadius(200, 2)).toBe(200);
    expect(glassKitPressHighlightAlpha()).toBeCloseTo(0.16 * 1.25, 12);
    expect(glassKitPressHighlightAlpha()).toBeCloseTo(0.2, 12);
    expect(glassKitPressHighlightAlpha(1)).toBeCloseTo(0.16, 12);

    // CSS 输出与纯函数同源（默认参数下仍是 0.20 / 110px）
    const css = pressHighlightCss(0, 0, 200);
    expect(css).toContain('110.0px');
    expect(css).toContain('rgba(255,255,255,0.20)');
    expect(css).toContain('mix-blend-mode:screen');
  });
});

describe('GlassKit.kt：折叠顶栏玻璃条', () => {
  it('着色 .92 / .60；不给 lens', () => {
    expect(KT).toContain('cs.background.copy(alpha = 0.92f)');
    expect(KT).toContain('cs.background.copy(alpha = 0.60f)');
    expect(GLASSKIT_TOP_BAR_TINT_ALPHA).toBe(0.6);
    expect(GLASSKIT_TOP_BAR_TINT_ALPHA_REDUCE).toBe(0.92);
    expect(glassTopBarTintAlpha(false)).toBe(0.6);
    expect(glassTopBarTintAlpha(true)).toBe(0.92);
    // 顶栏只有 blur(TopBarBlur)，没有 lens
    expect(KT).toContain('effects = { blur(GlassTokens.TopBarBlur.toPx()) }');
    expect(KT).toContain('**不加 lens**');
  });

  it('realtime 走 layerBlock alpha，回退分支把 f 折进颜色（只折一次）', () => {
    expect(KT).toContain('layerBlock = { alpha = collapsedFraction }');
    expect(KT).toContain('Modifier.background(tint.copy(alpha = tint.alpha * collapsedFraction))');
    // 回退分支不能再叠 opacity（否则分割线被淡化两次）
    expect(KT).not.toContain('opacity = collapsedFraction');
  });

  it('底部分割线：Hairline(0.5dp) × onSurface@(0.10 × f)', () => {
    expect(KT).toContain('.height(GlassTokens.Hairline)');
    expect(KT).toContain('cs.onSurface.copy(alpha = 0.10f * collapsedFraction)');
    expect(GlassTokens.Hairline).toBe(0.5);
    expect(GLASSKIT_TOP_BAR_DIVIDER_ALPHA).toBe(0.1);
    expect(glassTopBarDividerAlpha(0)).toBe(0);
    expect(glassTopBarDividerAlpha(0.5)).toBeCloseTo(0.05, 12);
    expect(glassTopBarDividerAlpha(1)).toBeCloseTo(0.1, 12);
  });

  it('极简档直接铺实色 surface（没有玻璃可采样）', () => {
    expect(KT).toContain('Box(modifier.background(androidx.compose.material3.MaterialTheme.colorScheme.surface))');
  });
});

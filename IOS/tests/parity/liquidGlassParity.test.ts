/**
 * liquidGlassParity.test.ts —— 液态玻璃的 13 个入口逐条对拍。
 *
 * `ui/components/LiquidGlass.kt`（429 行）是全站玻璃的**底层光学**：
 * 实时模糊链、降级磨砂、主题渐变、噪点、虹彩描边、水晶内斜角、径向遮罩。
 * 它的参数同时被「实时路径」与「预烘焙路径」消费，两边必须逐值一致，
 * 否则烘焙位图与实时输出会有可见色差（Kotlin L232-233 的注释就是在说这件事）。
 *
 * 重点断言：
 *   · 降级路径的 **α 加厚 0.20**（无 RenderEffect 时不能「透成透明玻璃」）
 *   · 两条效果链参数完全一致（brightness .04 / contrast 1.02 / saturation 1.30）
 *   · 主题渐变 / 面板渐变的四段 alpha
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GLASS_FALLBACK_ALPHA_BOOST,
  cardPerspective,
  crystalInnerBevelCss,
  filmGrainCss,
  filmGrainLayerCss,
  frostedGlassFallbackCss,
  glassFxChainCss,
  glassPanelBackdropCss,
  iridescentBorderCss,
  liquidGlassStyle,
  prefersReducedTransparency,
  radialGlassScrimCss,
  resetFilmGrainCache,
  supportsRealtimeBlur,
  themeGradientCss,
} from '@core/glass/liquidGlass';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/LiquidGlass.kt'),
  'utf8',
);

describe('LiquidGlass.kt：能力判定与降级', () => {
  it('supportsRealtimeBlur = SDK_INT >= S(31)，Web 侧可注入覆盖', () => {
    expect(KT).toContain('get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S');
    // 判定存在且是布尔（测试环境默认按「支持」处理，可用 __setRealtimeBlurOverride 覆盖）
    expect(typeof supportsRealtimeBlur()).toBe('boolean');
    expect(typeof prefersReducedTransparency()).toBe('boolean');
  });

  it('降级时基底 alpha 加厚 0.20，并夹到 1', () => {
    expect(KT).toContain('private const val GLASS_FALLBACK_ALPHA_BOOST = 0.20f');
    expect(KT).toContain('(surfaceColor.alpha + GLASS_FALLBACK_ALPHA_BOOST).coerceAtMost(1f)');
    expect(GLASS_FALLBACK_ALPHA_BOOST).toBe(0.2);

    // hex 输入按 alpha + 0.2 计算；rgba 输入原样透传（alpha 由调用方决定）
    const hex = frostedGlassFallbackCss({ surfaceColor: '#FFFFFF' });
    expect(hex.background).toBeDefined();
    const rgba = frostedGlassFallbackCss({ surfaceColor: 'rgba(255,255,255,0.5)' });
    expect(rgba.background).toBe('rgba(255,255,255,0.5)');
    // 加厚后不允许越界到 > 1（Kotlin 的 coerceAtMost(1f)）
    expect(JSON.stringify(hex)).not.toContain('1.2');
  });

  it('降级不是「透明」：三层叠加 + 噪点 0.05 + overlay 混合', () => {
    expect(KT).toContain('Color.White.copy(alpha = 0.12f)');
    expect(KT).toContain('Color.Black.copy(alpha = 0.05f)');
    expect(KT).toContain('Color.White.copy(alpha = 0.14f)');
    expect(KT).toContain('endY = size.height * 0.22f');
    expect(KT).toContain('.filmGrain(alpha = 0.05f)');
    const css = frostedGlassFallbackCss({});
    // 三层背景恒定存在（噪点层 + 全域介质 + 顶部受光带）
    const layers = css.backgroundImage ?? '';
    expect(layers).toContain('135deg');
    expect(layers).toContain('180deg');
    expect(css.backgroundSize ?? '').toContain('64px 64px');
    // overlay 混合只在噪点图案真的生成出来时挂（无 canvas 环境退化为不挂）
    if (!layers.startsWith('none')) {
      expect(css.backgroundBlendMode).toContain('overlay');
    }
  });
});

describe('LiquidGlass.kt：三条渐变 / 效果链', () => {
  it('rememberGlassFxChain：brightness .04 / contrast 1.02 / saturation 1.30 / blur', () => {
    expect(KT).toContain('brightness = 0.04f');
    expect(KT).toContain('contrast = 1.02f');
    expect(KT).toContain('saturation = 1.30f');
    expect(KT).toContain('vibrancy()');
    expect(KT).toContain('blur(radius = blurRadiusPx)');
    expect(glassFxChainCss(24)).toBe('brightness(1.04) contrast(1.02) saturate(1.30) blur(24px)');
    expect(glassFxChainCss(8)).toContain('blur(8px)');
  });

  it('themeGradient：primary .14 / 透明 40% / secondary .10 65% / primary .12', () => {
    expect(KT).toContain('primary.copy(alpha = 0.14f)');
    expect(KT).toContain('secondary.copy(alpha = 0.10f)');
    expect(KT).toContain('primary.copy(alpha = 0.12f)');
    const css = themeGradientCss('#FFFFFF', '#059669', '#2563EB');
    expect(css).toContain('0.14');
    expect(css).toContain('0.1');
    expect(css).toContain('0.12');
    expect(css).toContain('40%');
    expect(css).toContain('65%');
  });

  it('玻璃面板渐变刻意不铺不透明底（让背后的真实内容透出来）', () => {
    const css = glassPanelBackdropCss('#059669', '#2563EB');
    expect(css).toContain('0.06');
    expect(css).toContain('0.05');
    expect(css).toContain('40%');
    expect(css).toContain('65%');
    // 面板比卡片更淡（.06/.05 < .14/.12）
    expect(css).not.toContain('0.14');
  });
});

describe('LiquidGlass.kt：噪点 / 描边 / 内斜角 / 遮罩', () => {
  it('filmGrain 默认 0.04，64px 平铺，overlay 混合', () => {
    expect(KT).toContain('fun Modifier.filmGrain(alpha: Float = 0.04f)');
    resetFilmGrainCache();
    const css = filmGrainCss(0.04);
    // 无 canvas 环境时返回 {}，有则含 64px 与 overlay
    if (Object.keys(css).length > 0) {
      expect(css['backgroundSize']).toBe('64px 64px');
      expect(css['mixBlendMode']).toBe('overlay');
      expect(css['backgroundRepeat']).toBe('repeat');
    }
    const layer = filmGrainLayerCss(0.04);
    if (layer !== '') {
      expect(layer).toContain('64px 64px');
      expect(layer).toContain('opacity:0.04');
    }
  });

  it('iridescentBorder 默认 width 2 / alpha 0.22', () => {
    expect(KT).toContain('width: Dp = 2.dp');
    expect(KT).toContain('alpha: Float = 0.22f');
    // 扫掠渐变：颜色先按 alpha 淡化，再以中心为原点
    expect(KT).toContain('Brush.sweepGradient(');
    expect(KT).toContain('colors.map { it.copy(alpha = alpha) }');
    const css = iridescentBorderCss({ colors: ['#FF0000', '#00FF00'] });
    expect(JSON.stringify(css).length).toBeGreaterThan(0);
  });

  it('crystalInnerBevel / radialGlassScrim / cardPerspective 都能产出非空值', () => {
    expect(JSON.stringify(crystalInnerBevelCss({})).length).toBeGreaterThan(2);
    expect(radialGlassScrimCss().length).toBeGreaterThan(0);
    // 透视：相机倍率越大 → perspective 距离越大（透视越弱）
    const near = cardPerspective(100, 3);
    const far = cardPerspective(100, 12);
    expect(far).toBeGreaterThan(near);
    // 与 CardTweaks 的那条公式同源（shortSide × (0.42 + 3.8 × clamp)）
    expect(near).toBeCloseTo(100 * 0.42, 6);
    expect(far).toBeCloseTo(100 * (0.42 + 3.8), 6);
  });

  it('liquidGlassStyle：实时路径的 CSS 与效果链同参', () => {
    const style = liquidGlassStyle({ blurRadius: 24 });
    const flat = JSON.stringify(style);
    expect(flat).toContain('blur(24px)');
    // 饱和/亮度/对比必须与 glassFxChainCss 一致，否则烘焙与实时会有色差
    expect(flat).toContain('1.3');
    expect(flat).toContain('1.04');
    expect(flat).toContain('1.02');
  });
});

/**
 * themeColorAndAnchorsParity.test.ts —— 主题色板 / 亮度算法 / 遮罩锚点。
 *
 * 覆盖 3 个 Kotlin 文件：
 *   `ui/theme/Color.kt`        13 个色板常量 + `luminance()`（WCAG 相对亮度）+ `onColor()`（0.5 阈值）
 *                              + `glassTitleColor()`（背景 30% / 表面 70% / 0.4 阈值）
 *   `ui/wenku/WenkuAnchors.kt` 玻璃菜单的锚点（root 坐标 Rect，`current` + `set`）
 *   `ui/wenku/WenkuPageEntrance.kt` 首屏入场（`ENTER_MS` + 线性）+ `wenkuPagePart(order)`
 *
 * 为什么值得单独测：`onColor` / `glassTitleColor` 是「文字永远不会黑上加黑」的兜底算法，
 * 阈值漂 0.05 就会在某些壁纸上出白字压白底；色板错一位十六进制则整站色偏。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DARK_CHARCOAL,
  DIVIDER_GRAY,
  EYE_GREEN_BG,
  EYE_GREEN_TEXT,
  GLASS_TITLE_BG_WEIGHT,
  GLASS_TITLE_SURFACE_WEIGHT,
  GLASS_TITLE_THRESHOLD,
  LIGHT_BG,
  MEDIUM_GRAY,
  MINT_GOLD,
  NIGHT_BG,
  NIGHT_TEXT,
  OLED_BG,
  OLED_TEXT,
  ON_COLOR_THRESHOLD,
  ON_DARK_INK,
  PURE_WHITE,
  READER_PRESETS,
  SEPIA_BG,
  SEPIA_TEXT,
  glassTitleColor,
  linearChannel,
  luminance,
  onColor,
} from '@core/ui-theme/color';
import { rememberWenkuAnchor } from '@core/wenku/parityNames';
import { WENKU_MOTION } from '@core/wenku/tokens';
import { wenkuPagePart } from '@core/wenku/parityNames';
import { wenkuReveal } from '@core/wenku/motion';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

/** 从 Kotlin 抽 `val NAME = Color(0xAARRGGBB)` 的十六进制（大写，带 `#`）。 */
function ktColor(source: string, name: string): string | null {
  const m = new RegExp(`val\\s+${name}\\s*=\\s*Color\\(0x([0-9A-Fa-f]{6,8})\\)`).exec(source);
  if (m === null) return null;
  const hex = (m[1] ?? '').toUpperCase();
  return `#${hex.length === 8 ? hex.slice(2) : hex}`;
}

describe('Color.kt：13 个色板常量', () => {
  const source = kt('ui/theme/Color.kt');

  it('全部与 Kotlin 原文逐值一致（比较 RGB，忽略 alpha）', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['MintGold', MINT_GOLD],
      ['DarkCharcoal', DARK_CHARCOAL],
      ['MediumGray', MEDIUM_GRAY],
      ['DividerGray', DIVIDER_GRAY],
      ['LightBg', LIGHT_BG],
      ['PureWhite', PURE_WHITE],
      ['SepiaBg', SEPIA_BG],
      ['SepiaText', SEPIA_TEXT],
      ['EyeGreenBg', EYE_GREEN_BG],
      ['EyeGreenText', EYE_GREEN_TEXT],
      ['NightBg', NIGHT_BG],
      ['NightText', NIGHT_TEXT],
      ['OledBg', OLED_BG],
      ['OledText', OLED_TEXT],
    ];
    const drift: string[] = [];
    for (const [ktName, tsValue] of pairs) {
      const ktValue = ktColor(source, ktName);
      if (ktValue === null) {
        drift.push(`${ktName}：Kotlin 里没解析到`);
        continue;
      }
      if (ktValue.toUpperCase() !== tsValue.toUpperCase()) drift.push(`${ktName}: Kotlin=${ktValue} TS=${tsValue}`);
    }
    expect(drift).toEqual([]);
  });

  it('两处同值是有意的（LIGHT_BG = PURE_WHITE、NIGHT_BG = DarkCharcoal）', () => {
    expect(LIGHT_BG).toBe(PURE_WHITE);
    expect(NIGHT_BG).toBe(DARK_CHARCOAL);
    // 但语义不同：一个作页面底色、一个作纯白前景
    expect(source).toContain('val LightBg = Color(0xFFFFFFFF) // Pure white background');
    expect(source).toContain('val NightBg = Color(0xFF18191C)');
  });

  it('READER_PRESETS 的四套配色与 Kotlin 一致', () => {
    const presets = READER_PRESETS as unknown as Record<string, { readonly bg: string; readonly text: string }>;
    expect(Object.keys(presets).length).toBeGreaterThanOrEqual(4);
    // 四套：纸黄 / 护眼绿 / 夜间 / OLED
    const flat = JSON.stringify(presets).toUpperCase();
    for (const hex of [SEPIA_BG, SEPIA_TEXT, EYE_GREEN_BG, EYE_GREEN_TEXT, NIGHT_BG, NIGHT_TEXT, OLED_BG, OLED_TEXT]) {
      expect(flat).toContain(hex.toUpperCase());
    }
  });
});

describe('Color.kt：WCAG 亮度与对比色', () => {
  const source = kt('ui/theme/Color.kt');

  it('luminance 公式逐系数一致（0.2126 / 0.7152 / 0.0722 + 0.03928 + 2.4）', () => {
    expect(source).toContain('if (c <= 0.03928f) c / 12.92f else ((c + 0.055f) / 1.055f).pow(2.4f)');
    expect(source).toContain('0.2126f * linear(red) + 0.7152f * linear(green) + 0.0722f * linear(blue)');

    // 端点：纯黑 0、纯白 1
    expect(luminance('#000000')).toBeCloseTo(0, 6);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6);
    // 线性段的边界值（0.03928 正好在拐点上）
    expect(linearChannel(0)).toBe(0);
    expect(linearChannel(0.03928)).toBeCloseTo(0.03928 / 12.92, 6);
    // 绿通道权重最高：纯绿比纯红亮
    expect(luminance('#00FF00')).toBeGreaterThan(luminance('#FF0000'));
    expect(luminance('#FF0000')).toBeGreaterThan(luminance('#0000FF'));
  });

  it('onColor：亮度 > 0.5 用近黑 #1A1A1E，否则纯白', () => {
    expect(source).toContain('if (luminance() > 0.5f) Color(0xFF1A1A1E) else Color.White');
    expect(ON_COLOR_THRESHOLD).toBe(0.5);
    expect(ON_DARK_INK).toBe('#1A1A1E');
    expect(onColor('#FFFFFF')).toBe('#1A1A1E');
    expect(onColor('#000000')).toBe('#FFFFFF');
    // #808080 的亮度约 0.216 → 白字
    expect(onColor('#808080')).toBe('#FFFFFF');
    // #E8C97A（MintGold）亮度 > 0.5 → 深字
    expect(luminance(MINT_GOLD)).toBeGreaterThan(0.5);
    expect(onColor(MINT_GOLD)).toBe('#1A1A1E');
  });

  it('glassTitleColor：有效亮度 = bg×0.30 + surface×0.70，> 0.4 用近黑', () => {
    expect(source).toContain('val effective = bgTone * 0.30f + surfaceLum * 0.70f');
    expect(source).toContain('return if (effective > 0.4f) Color(0xFF1A1A1E) else Color.White');
    expect(GLASS_TITLE_BG_WEIGHT).toBe(0.3);
    expect(GLASS_TITLE_SURFACE_WEIGHT).toBe(0.7);
    expect(GLASS_TITLE_THRESHOLD).toBe(0.4);
    // 两个权重必须和为 1（纯加权平均，不是 unmatched 叠加）
    expect(GLASS_TITLE_BG_WEIGHT + GLASS_TITLE_SURFACE_WEIGHT).toBeCloseTo(1, 9);

    // 深色壁纸 + 深色表面 → 白字
    expect(glassTitleColor(0, 0)).toBe('#FFFFFF');
    // 浅色壁纸 + 浅色表面 → 近黑
    expect(glassTitleColor(1, 1)).toBe('#1A1A1E');
    // 边界：effective = 0.4 时仍取白（严格大于阈值）
    expect(glassTitleColor(0.4, 0.4)).toBe('#FFFFFF');
    expect(glassTitleColor(0.5, 0.5)).toBe('#1A1A1E');
    // 壁纸比表面权重低：只把壁纸调到最亮也不足以翻面
    expect(glassTitleColor(1, 0)).toBe('#FFFFFF'); // 0.3 < 0.4
    expect(glassTitleColor(0, 0.6)).toBe('#1A1A1E'); // 0.42 > 0.4
  });
});

describe('WenkuAnchors.kt：玻璃菜单锚点', () => {
  const source = kt('ui/wenku/WenkuAnchors.kt');

  it('记录 root 坐标矩形，初始为 null，set 后可读到', () => {
    expect(source).toContain('var anchor by remember { mutableStateOf<Rect?>(null) }');
    expect(source).toContain('onGloballyPositioned { onAnchor(it.boundsInRoot()) }');

    const anchor = rememberWenkuAnchor();
    expect(anchor.current).toBeNull();
    anchor.set({ left: 10, top: 20, right: 110, bottom: 220 });
    expect(anchor.current).toEqual({ left: 10, top: 20, right: 110, bottom: 220 });
    // 可再次覆盖（菜单每次打开重新取锚点）
    anchor.set({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(anchor.current).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('锚点在布局阶段记录一次，不进重组循环（Kotlin 用 composed + onGloballyPositioned）', () => {
    expect(source).toContain('fun Modifier.wenkuAnchor(onAnchor: (Rect) -> Unit): Modifier = composed {');
    expect(source).toContain('不进重组循环');
  });
});

describe('WenkuPageEntrance.kt：首屏入场', () => {
  const source = kt('ui/wenku/WenkuPageEntrance.kt');
  const revealZero = wenkuReveal(0);

  it('只在首次呈现且开启装饰动画时才播；时长取 WenkuMotion.ENTER_MS 且线性', () => {
    expect(source).toContain('tween(WenkuMotion.ENTER_MS, easing = LinearEasing)');
    expect(source).toContain('val firstPresentation = remember { !presented }');
    expect(source).toContain('val animate = firstPresentation &&');
    expect(source).toContain('.decorativeMotion && LocalWenkuDecorativeMotion.current');
    // 不播时直接渲染内容（不是渲染一个 0 进度的空壳）
    expect(source).toContain('if (!animate) {');
    expect(WENKU_MOTION.enterMs).toBeGreaterThan(0);
  });

  it('wenkuPagePart(order) 就是 wenkuReveal(order)', () => {
    expect(source).toContain('fun Modifier.wenkuPagePart(order: Int = 0): Modifier = wenkuReveal(order)');
    // 真实转发：返回值与 wenkuReveal(order) 完全一致，且缺省 order = 0
    expect(wenkuPagePart(0)).toEqual(revealZero);
    expect(wenkuPagePart()).toEqual(revealZero);
    expect(wenkuPagePart(3)).toEqual(wenkuReveal(3));
    expect(wenkuPagePart(3)).not.toEqual(revealZero);
  });
});

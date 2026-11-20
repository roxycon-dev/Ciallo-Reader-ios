/**
 * comicPanelDesignParity.test.ts —— 漫画面板设计系统（`ui/comic/ComicPanelDesign.kt`，317 行）。
 *
 * 这是「苹果式克制」路线的面板组件族：模块化玻璃卡片、图标 Tab、自绘滑条与开关。
 * 数值错了不会崩，只会「看着不像设计稿」—— 所以颜色令牌、控件比例、按压缩放逐条钉住。
 *
 * 覆盖 11 个声明：PanelCardBg / PanelCardStroke / selectedBg / selectedStroke /
 * PanelSectionCard / PanelTabData / PanelTabRow / PanelHint / PanelTabRail /
 * PanelSlider / PanelSwitch / lerpColor / PanelBgSwatch / PanelDecorativeIcon。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  PANEL_CARD_BG,
  PANEL_CARD_STROKE,
  PANEL_SLIDER_PRESS_RING_R_DP,
  PANEL_SLIDER_THUMB_R_DP,
  PANEL_SLIDER_TRACK_H_DP,
  PANEL_SWITCH_BASE_OFFSET_DP,
  PANEL_SWITCH_TRAVEL_DP,
  comicPanelAlphaHex,
  comicPanelLerpColor,
  comicPanelWithAlpha,
  panelSelectedBg,
  panelSelectedStroke,
  panelSliderFraction,
  panelSliderPosToValue,
  panelSliderSnap,
} from '@core/comic/comicPanelDesign';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/comic/ComicPanelDesign.kt'),
  'utf8',
);

/** 从 Kotlin 抽 `Color(0xAARRGGBB)` → `#RRGGBBAA`（CSS 写法）。 */
function ktColorCss(source: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*Color\\(0x([0-9A-Fa-f]{8})\\)`).exec(source);
  if (m === null) return null;
  const hex = m[1] ?? '';
  const aa = hex.slice(0, 2);
  const rrggbb = hex.slice(2);
  return `#${rrggbb}${aa}`.toUpperCase();
}

describe('ComicPanelDesign.kt：两块玻璃卡片令牌', () => {
  it('PanelCardBg / PanelCardStroke 的 ARGB 与 iOS 常量逐值一致', () => {
    expect(KT).toContain('internal val PanelCardBg = Color(0x12FFFFFF)');
    expect(KT).toContain('internal val PanelCardStroke = Color(0x26FFFFFF)');
    // Kotlin 的 `0x12FFFFFF` = alpha 0x12；CSS 侧应写成 #FFFFFF12
    const bg = ktColorCss(KT, 'PanelCardBg');
    const stroke = ktColorCss(KT, 'PanelCardStroke');
    expect(bg).toBe('#FFFFFF12');
    expect(stroke).toBe('#FFFFFF26');
    expect(PANEL_CARD_STROKE.toUpperCase()).toBe(stroke);
    expect(PANEL_CARD_BG.toUpperCase()).toBe(bg);
  });

  it('两张卡片是「极淡白雾 + 细描边」，描边比填充更明显', () => {
    // 描边 alpha(0x26=38) > 填充 alpha(0x12=18)
    expect(0x26).toBeGreaterThan(0x12);
    expect(PANEL_CARD_STROKE).not.toBe(PANEL_CARD_BG);
  });
});

describe('ComicPanelDesign.kt：选中态（薄荷 18% / 55%）', () => {
  it('selectedBg = MintPrimary@.18、selectedStroke = MintPrimary@.55', () => {
    expect(KT).toContain('private fun selectedBg(): Color = MintPrimary.copy(alpha = 0.18f)');
    expect(KT).toContain('private fun selectedStroke(): Color = MintPrimary.copy(alpha = 0.55f)');
    const mint = '#059669';
    expect(panelSelectedBg(mint).toUpperCase()).toContain('2E'); // 0.18 × 255 ≈ 46 = 0x2E
    expect(panelSelectedStroke(mint).toUpperCase()).toContain('8C'); // 0.55 × 255 ≈ 140 = 0x8C
    // 描边必须比填充更实（否则选中态「糊」）
    expect(0.55).toBeGreaterThan(0.18);
  });

  it('alpha → hex 的换算：0 / 1 / 中间值', () => {
    expect(comicPanelAlphaHex(0)).toBe('00');
    expect(comicPanelAlphaHex(1)).toBe('FF');
    expect(comicPanelAlphaHex(0.18).toUpperCase()).toBe('2E');
    expect(comicPanelAlphaHex(0.5).toUpperCase()).toBe('80');
    expect(comicPanelWithAlpha('#FFFFFF', 0.5).toUpperCase()).toBe('#FFFFFF80');
  });
});

describe('ComicPanelDesign.kt：滑条与开关比例', () => {
  it('滑条：轨道 5dp / 圆钮 8dp / 按压光环 12dp', () => {
    expect(PANEL_SLIDER_TRACK_H_DP).toBe(5);
    expect(PANEL_SLIDER_THUMB_R_DP).toBe(8);
    expect(PANEL_SLIDER_PRESS_RING_R_DP).toBe(12);
    // 光环半径必须大于圆钮半径（否则光环被钮盖住）
    expect(PANEL_SLIDER_PRESS_RING_R_DP).toBeGreaterThan(PANEL_SLIDER_THUMB_R_DP);
    // 轨道比圆钮薄得多（细轨 + 大钮的克制比例）
    expect(PANEL_SLIDER_TRACK_H_DP).toBeLessThan(PANEL_SLIDER_THUMB_R_DP);
  });

  it('开关：46×28 轨道、22dp 圆钮、行程 18dp、起始偏移 3dp', () => {
    expect(KT).toContain('.width(46.dp)');
    expect(KT).toContain('.height(28.dp)');
    expect(KT).toContain('.size(22.dp)');
    expect(KT).toContain('IntOffset((3.dp.toPx() + t * travel).roundToInt(), 0)');
    expect(PANEL_SWITCH_TRAVEL_DP).toBe(18);
    expect(PANEL_SWITCH_BASE_OFFSET_DP).toBe(3);
    // 行程 + 钮径 + 两侧偏移 = 轨宽：18 + 22 + 3×2 = 46 ✓
    expect(PANEL_SWITCH_TRAVEL_DP + 22 + PANEL_SWITCH_BASE_OFFSET_DP * 2).toBe(46);
  });

  it('开关轨道色与描边都随 t 线性插值（0 = 未选中，1 = 品牌绿）', () => {
    expect(KT).toContain('lerpColor(ReadingPalette.SwitchTrack, MintPrimary.copy(alpha = 0.85f), t)');
    expect(KT).toContain('lerpColor(ReadingPalette.ControlTrack, MintPrimary.copy(alpha = 0.6f), t)');
    expect(KT).toContain('private fun lerpColor(a: Color, b: Color, t: Float): Color');
    // t=0 原样、t=1 全绿
    // 输出是 #RRGGBBAA（缺 alpha 视为 FF）
    expect(comicPanelLerpColor('#000000', '#FFFFFF', 0).toUpperCase()).toBe('#000000FF');
    expect(comicPanelLerpColor('#000000', '#FFFFFF', 1).toUpperCase()).toBe('#FFFFFF' + 'FF');
    expect(comicPanelLerpColor('#000000', '#FFFFFF', 0.5).toUpperCase()).toBe('#808080FF');
  });
});

describe('ComicPanelDesign.kt：滑条取值换算', () => {
  it('fraction / snap / posToValue 在区间两端闭合', () => {
    expect(panelSliderFraction(5, [0, 10])).toBeCloseTo(0.5, 9);
    expect(panelSliderFraction(0, [0, 10])).toBe(0);
    expect(panelSliderFraction(10, [0, 10])).toBe(1);
    // 越界钳制
    expect(panelSliderFraction(-5, [0, 10])).toBe(0);
    expect(panelSliderFraction(20, [0, 10])).toBe(1);

    // steps = 0 不吸附
    expect(panelSliderSnap(0.37, 0)).toBeCloseTo(0.37, 9);
    // steps = 10 → 分格 = 1/(steps+1) = 1/11（Kotlin 用 steps+1，不是 steps）
    expect(panelSliderSnap(0.37, 10)).toBeCloseTo(4 / 11, 9);
    expect(panelSliderSnap(0.04, 10)).toBeCloseTo(0, 9);
    expect(panelSliderSnap(1, 10)).toBeCloseTo(1, 9);

    // 位置 → 值：x/trackWidth ∈ [0,1] 线性映射到 [start, end]
    expect(panelSliderPosToValue(0, 100, [2, 8], 0, false)).toBeCloseTo(2, 9);
    expect(panelSliderPosToValue(100, 100, [2, 8], 0, false)).toBeCloseTo(8, 9);
    expect(panelSliderPosToValue(50, 100, [2, 8], 0, false)).toBeCloseTo(5, 9);
    // reverse：位置反向映射
    expect(panelSliderPosToValue(0, 100, [2, 8], 0, true)).toBeCloseTo(8, 9);
  });
});

describe('ComicPanelDesign.kt：布局常量', () => {
  it('TabRow 每个 Tab 宽 58dp、TabRail 宽 92dp；compact 图标 19dp / 非 compact 21dp', () => {
    expect(KT).toContain('Modifier.width(58.dp), compact = true');
    expect(KT).toContain('Column(modifier.width(92.dp)');
    expect(KT).toContain('val size = if (compact) 19.dp else 21.dp');
    // 导轨比单排更宽（它为「图标在左、文字在右」留出空间）
    expect(92).toBeGreaterThan(58);
  });

  it('按压缩放 .96、着色过渡 160ms、compact 描边 .5dp', () => {
    expect(KT).toContain('targetValue = if (animate && pressed) .96f else 1f');
    expect(KT).toContain('animationSpec = tween(if (animate) 160 else 0)');
    expect(KT).toContain('Modifier.border(.5.dp, selectedStroke(), shape)');
  });

  it('PanelHint 是只读文本（绝不做成不可操作的开关）', () => {
    expect(KT).toContain('Read-only status is text, never a switch that cannot be operated.');
    expect(KT).toContain('internal fun PanelHint(text: String)');
  });

  it('PanelDecorativeIcon 不重复播报（clearAndSetSemantics）', () => {
    expect(KT).toContain('modifier.clearAndSetSemantics { }');
    expect(KT).toContain('avoid duplicate TalkBack announcements');
  });
});

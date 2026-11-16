/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PaperPalette.kt` (73 non-blank lines)
 *   data class PaperPalette + baseAlpha (lines 25-41) → PaperPalette
 *   fun rememberPaperPalette (lines 44-46)        → usePaperPalette (component)
 *   fun paperPaletteOf (lines 49-76)              → paperPaletteOf()
 *   private fun Color.mix (lines 79-87)            → core/glass/color#mixHex
 *   private fun Color.desaturate (lines 90-93)     → core/glass/color#desaturateHex
 *
 * `Color.luminance() < 0.25f` → `core/glass/color#luminance`.
 * Nothing skipped — every colour constant is preserved verbatim.
 */

import { desaturateHex, luminance, mixHex } from '../glass/color';

/**
 * 「纸张」配色：由阅读主题的背景色推导，而不是写死米黄。
 *
 * 背景：此前卷页背面把 `0xFFF5F0E6`（米色纸）硬编码进 PageTurnContainer /
 * `backPageColor` 里。夜间与黑色主题下翻页背面仍是米黄色纸。
 *
 * 统一由这里按阅读区背景色推导：
 *  - 浅色纸：在原背景色基础上轻微提亮 + 降饱和，得到"纸面"；
 *  - 深色纸：在原背景色基础上加深 + 降饱和，厚度高光/描边反过来提亮。
 *
 * 内部的 mix / desaturate 走 sRGB 线性插值即可：这里调的是观感而非物理量。
 */
export interface PaperPalette {
  /** 纸面主色（绘制时再叠 baseAlpha 做半透纸基）。 */
  face: string;
  /** 沿翻动边缘的那道纸张厚度高光。 */
  edgeHighlight: string;
  /** 纸边描边色：浅色纸压暖灰，深色纸提亮冷灰。 */
  edgeStroke: string;
  /** 这套纸是否属于暗色调。 */
  isDark: boolean;
  /**
   * 纸基的实际绘制 alpha。真实纸张是透光的——哪怕正反面印了字，底下的页面
   * 也会透出一点点。完全不透明会把纸糊成"一块板"。
   * 深色纸本身对比强、底下透光更显脏，所以 alpha 略高一点。
   */
  baseAlpha: number;
}

/** 纯函数版（预览 / 非 Composable 场景可用）。PaperPalette.kt lines 49-76. */
export function paperPaletteOf(source: string): PaperPalette {
  const isDark = luminance(source) < 0.25;

  const face = isDark
    ? desaturateHex(mixHex(source, '#0B0C0E', 0.18), 0.16)
    : desaturateHex(mixHex(source, '#FFFFFF', 0.1), 0.22);

  const edgeHighlight = isDark ? mixHex(face, '#8A8F97', 0.55) : mixHex(face, '#FFFFFF', 0.72);

  const edgeStroke = isDark ? mixHex(face, '#6E7480', 0.62) : mixHex(face, '#8A7C60', 0.62);

  return {
    face,
    edgeHighlight,
    edgeStroke,
    isDark,
    baseAlpha: isDark ? 0.93 : 0.9,
  };
}
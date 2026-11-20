/**
 * 发现页的配色与对比度工具 —— `discover/DiscoverDesign.kt` L27-69 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L27 `DiscoverRise = Color(0xFFE5484D)`      → `DISCOVER_RISE`
 *   L28 `DiscoverFall = Color(0xFF2E9E6B)`      → `DISCOVER_FALL`
 *   L29 `DiscoverWarning = Color(0xFFF5A524)`   → `DISCOVER_WARNING`
 *   L30 `DiscoverStopped = Color(0xFF9AA0A6)`   → `DISCOVER_STOPPED`
 *   L31 `DiscoverMedals = listOf(0xFFE8B53A, 0xFFB8C0CC, 0xFFC98A5B)` → `DISCOVER_MEDALS`
 *   L32-33 `contrast(a, b) = (max(L)+.05) / (min(L)+.05)`             → `contrast`
 *   L34 `contrastInk(background)`：黑白中对比度更高者                → `contrastInk`
 *   L35-44 `themeText(primary, background, minimum = 4.5f)`：每步 mix += .02 直到达标
 *   L47 `discoverInk()`：`onSurface`                                → `DISCOVER_INK_ROLE`
 *   L49 `discoverTint()`：`primary @ (surface.luminance() < .5 ? .22 : .14)`
 *   L52 `discoverAccentText()`：`themeText(primary, tint over surface, 5.2f)`
 *   L55-58 `DiscoverGlass(...)`：`GlassCard(padding = 10.dp)`        → UI 层
 *   L61-69 `DiscoverEmptyState(...)`                                → UI 层
 *
 * 颜色用 `0xRRGGBB` 整数表示（与 `WENKU_TOKENS` 一致），alpha 单独给。
 */

/** L27-31 的五个色值。 */
export const DISCOVER_RISE = 0xe5484d;
export const DISCOVER_FALL = 0x2e9e6b;
export const DISCOVER_WARNING = 0xf5a524;
export const DISCOVER_STOPPED = 0x9aa0a6;
export const DISCOVER_MEDALS: readonly number[] = [0xe8b53a, 0xb8c0cc, 0xc98a5b];

/** `Color(0xFF000000)` / `Color(0xFFFFFFFF)` 的打包值。 */
export const DISCOVER_BLACK = 0x000000;
export const DISCOVER_WHITE = 0xffffff;

/** L32 的默认最小对比度（`themeText` 的 `minimum` 默认值）。 */
export const DISCOVER_TEXT_MIN_CONTRAST = 4.5;
/** L52 `discoverAccentText` 用到的最小对比度。 */
export const DISCOVER_ACCENT_MIN_CONTRAST = 5.2;
/** L40 `mix += .02f` 的步长。 */
export const DISCOVER_TEXT_MIX_STEP = 0.02;

/** `Color.luminance()`：sRGB 相对亮度（WCAG 2.1）。 */
export function luminance(argb: number): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((argb >>> 16) & 0xff);
  const g = channel((argb >>> 8) & 0xff);
  const b = channel(argb & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** L32-33 `contrast(a, b)`。 */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** L34 `contrastInk(background)`。 */
export function contrastInk(background: number): number {
  return contrast(DISCOVER_BLACK, background) >= contrast(DISCOVER_WHITE, background)
    ? DISCOVER_BLACK
    : DISCOVER_WHITE;
}

/** `androidx.compose.ui.graphics.lerp(a, b, t)` 的整数等价物。 */
export function lerpArgb(a: number, b: number, t: number): number {
  const mix = Math.min(Math.max(t, 0), 1);
  const ch = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * mix) & 0xff;
  };
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** L35-44 `themeText(primary, background, minimum = 4.5f)`。 */
export function themeText(
  primary: number,
  background: number,
  minimum = DISCOVER_TEXT_MIN_CONTRAST,
): number {
  const target = contrastInk(background);
  let color = primary;
  let mix = 0;
  while (contrast(color, background) < minimum && mix < 1) {
    mix += DISCOVER_TEXT_MIX_STEP;
    color = lerpArgb(primary, target, Math.min(mix, 1));
  }
  return color;
}

/** L49 `discoverTint()` 的 alpha 分支（`surface.luminance() < .5f ? .22f : .14f`）。 */
export function discoverTintAlpha(surface: number): number {
  return luminance(surface) < 0.5 ? 0.22 : 0.14;
}

/**
 * L51-52 `discoverAccentText()`：
 * `themeText(primary, tint.compositeOver(surface), 5.2f)`。
 * `compositeOver` 用 src-over 的整数近似（alpha 混合）。
 */
export function discoverAccentText(primary: number, surface: number): number {
  const alpha = discoverTintAlpha(surface);
  return themeText(primary, compositeOver(primary, alpha, surface), DISCOVER_ACCENT_MIN_CONTRAST);
}

/** `Color.compositeOver(background)`（src-over）。 */
export function compositeOver(src: number, srcAlpha: number, dst: number): number {
  const a = Math.min(Math.max(srcAlpha, 0), 1);
  const ch = (shift: number): number => {
    const s = (src >>> shift) & 0xff;
    const d = (dst >>> shift) & 0xff;
    return Math.round(s * a + d * (1 - a)) & 0xff;
  };
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** `0xRRGGBB` → `#rrggbb`。 */
export function discoverHex(argb: number): string {
  return `#${((argb >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** L55-58 `DiscoverGlass` 的默认内边距（`PaddingValues(10.dp)`）。 */
export const DISCOVER_GLASS_PADDING_DP = 10;
/** L63 空态吉祥物尺寸（`Modifier.size(120.dp)`）。 */
export const DISCOVER_EMPTY_MASCOT_PX = 120;
/** L64-65 空态字号（16sp / 13sp）。 */
export const DISCOVER_EMPTY_TITLE_SP = 16;
export const DISCOVER_EMPTY_DESCRIPTION_SP = 13;
/** L65 描述文字 alpha（`.64f`）。 */
export const DISCOVER_EMPTY_DESCRIPTION_ALPHA = 0.64;
/** L66 行动按钮最小高度（`heightIn(min = 48.dp)`）。 */
export const DISCOVER_EMPTY_ACTION_MIN_HEIGHT_PX = 48;

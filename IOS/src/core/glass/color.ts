/**
 * Kotlin → TS map (colour helpers shared by the glass / page-turn ports)
 * ─────────────────────────────────────────────────────────────────────
 * - `ui/glasskit/GlassKit.kt` (lines 449-480) `rememberIridescentColors()` /
 *   `rememberCrystalPrismColors()`  → `iridescentColors()` / `crystalPrismColors()`
 * - `ui/pageturn/PaperPalette.kt` lines 79-93  `Color.mix()` + `Color.desaturate()`
 *   → `mixHex()` / `desaturateHex()`
 * - `ui/components/MaxFx.kt` lines 192-198 `lerpColor()` → `lerpColor()`
 * - `ui/components/LiquidGlass.kt` lines 448-461 `rememberIridescentColors()`
 * - `ui/theme/Color.kt` lines 38-48 `luminance()` / `onColor()`
 *   （2026-10-11 PARITY E56④：本文件不再实现，改从 `../ui-theme/color` 再导出）
 * - `ui/pageturn/PaperPalette.kt` line 50 `source.luminance() < 0.25f`
 * - `ui/components/SourceAvatar.kt` lines 36-40 `Color.hsv(hue, 0.52f, 0.86f)`
 *
 * SKIPPED (no web equivalent, documented in report):
 * - Kotlin `Color` stores float channels 0..1 including alpha.  Web CSS strings do
 *   not, so this port keeps hex + a separate alpha channel (rgba strings) instead
 *   of a `Color` class.  Every `Color.copy(alpha=…)` becomes `withAlpha(hex, a)`.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse `#RGB` / `#RRGGBB` → 0..255 channels.  Returns null on malformed input. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHexByte(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

/** `Color.copy(alpha = a)` → CSS `rgba(...)`. Preserves the input hue exactly. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(24, 25, 28, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** Same as `withAlpha` but clamped 0..1 (Kotlin `Color.copy` clamps too). */
export function alpha(_hex: string, a: number): number {
  return Math.max(0, Math.min(1, a));
}

/** `PaperPalette.kt` line 79 `Color.mix(other, ratio)` — sRGB lerp on all 4 channels. */
export function mixHex(a: string, b: string, ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return b;
  return `#${toHexByte(ca.r + (cb.r - ca.r) * t)}${toHexByte(
    ca.g + (cb.g - ca.g) * t,
  )}${toHexByte(ca.b + (cb.b - ca.b) * t)}`;
}

/** `PaperPalette.kt` line 90 `Color.desaturate(amount)` — Rec.709 luma to grey. */
export function desaturateHex(hex: string, amount: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const gray = toHexByte(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
  return mixHex(hex, `#${gray}${gray}${gray}`, amount);
}

/** `MaxFx.kt` line 192 `lerpColor(a, b, t)` — per-channel lerp keeping `a`'s alpha. */
export function lerpColor(a: string, b: string, t: number): string {
  return mixHex(a, b, t);
}

/**
 * `theme/Color.kt` lines 38-48 `luminance()` / `onColor()` — 单一权威实现已收敛到
 * `../ui-theme/color`（`ui/theme/Color.kt` 的逐行移植）。
 *
 * PARITY E56④（2026-10-11 收敛）：本文件原先自带一份 `luminance()`，sRGB 线性化
 * cut-off 写的是 0.04045。已对照 Android 权威源核实（`novel-reader/.../ui/theme/Color.kt`
 * L39-41）：Kotlin 用的是 **0.03928**
 * （`fun linear(c: Float) = if (c <= 0.03928f) c / 12.92f else ((c + 0.055f) / 1.055f).pow(2.4f)`）。
 * 对 8-bit hex 输入两个 cut-off 数值等价（不存在整数通道落入 (0.03928, 0.04045] 区间：
 * 10/255≈0.03922 ≤ 0.03928 < 11/255≈0.04314），但「同一 Kotlin 函数两份 TS 实现」本身就是
 * 漂移温床 —— 本地副本（`channelLuminance` + `luminance` + `onColor`）删除，改为再导出。
 * 消费方（libraryDisplay / paperPalette / glassColor.test）的导入路径不变。
 */
export { luminance, onColor } from '../ui-theme/color';

/** `Compose Color.hsv(h, s, v)` → hex. Used by `SourceAvatar.kt` line 39. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${toHexByte((r + m) * 255)}${toHexByte((g + m) * 255)}${toHexByte(
    (b + m) * 255,
  )}`;
}

/** HSL (all 0..1) → hex. `GlassCard.kt` lines 629-631 use `ColorUtils.colorToHSL`. */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return `#${toHexByte((r + m) * 255)}${toHexByte((g + m) * 255)}${toHexByte(
    (b + m) * 255,
  )}`;
}

/** `ColorUtils.colorToHSL()` → `[h, s, l]` each 0..1. */
export function hexToHsl(hex: string): [number, number, number] {
  const c = parseHex(hex);
  if (!c) return [0, 0, 0];
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/**
 * `LiquidGlass.kt` lines 449-461 `rememberIridescentColors()` —
 * 主色系邻近色三色环（primary → warm → secondary → cool → primary）。
 * Kotlin reads `Color.colorToHSV(primary)`; the hue is all that matters here.
 */
export function iridescentColors(primary: string, secondary: string): string[] {
  const hue = hexToHsl(primary)[0] * 360;
  const warm = hsvToHex((hue + 28) % 360, 0.45, 1);
  const cool = hsvToHex(((hue - 28 + 360) % 360), 0.42, 1);
  return [primary, warm, secondary, cool, primary];
}

/**
 * `LiquidGlass.kt` lines 468-480 `rememberCrystalPrismColors()` —
 * 水晶棱镜多段色散：主色 -> 晨曦金 -> 珍珠白高光 -> 翡翠水绿 -> 薰衣草紫 -> 主色。
 */
export function crystalPrismColors(primary: string, secondary: string): string[] {
  const hue = hexToHsl(primary)[0] * 360;
  const warmGold = hsvToHex((hue + 32) % 360, 0.4, 1);
  const pearlSheen = '#EAF5F8';
  const coolViolet = hsvToHex(((hue - 32 + 360) % 360), 0.38, 1);
  return [primary, warmGold, pearlSheen, secondary, coolViolet, primary];
}

/** `GlassCard.kt` line 284 `lerp(Color.White, primary, 0.38f)` → strokeTint. */
export function strokeTintOf(primary: string): string {
  return mixHex('#FFFFFF', primary, 0.38);
}

/**
 * `GlassCard.kt` lines 280-282 `lerp(tint, primary, tintMix)` —
 * 白色半透明基底叠加低透明度主题色调。
 */
export function themedTint(tint: string, primary: string, tintMix: number): string {
  return mixHex(tint, primary, Math.max(0, Math.min(1, tintMix)));
}
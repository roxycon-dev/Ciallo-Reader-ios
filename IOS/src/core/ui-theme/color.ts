/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/Color.kt`
 *             (62 lines incl. trailing newline, 49 non-blank)
 *          → `src/core/ui-theme/color.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`                  → SKIPPED (TS has no packages)
 *   L2        (blank)                                          → SKIPPED
 *   L3        `import androidx.compose.ui.graphics.Color`      → REPLACED by hex strings + an
 *                                                              `Rgb` channel triple. Compose's
 *                                                              `Color` carries float channels and
 *                                                              an alpha byte; CSS hex strings do not,
 *                                                              so alpha becomes a separate argument
 *                                                              (see `modifierExtensions.ts`).
 *   L4        `import androidx.compose.runtime.Composable`     → SKIPPED: there is no composition on
 *                                                              the web. The two `@Composable`
 *                                                              getters become plain functions that
 *                                                              take the scheme explicitly.
 *   L5        `import androidx.compose.material3.MaterialTheme` → the `MaterialColorScheme` parameter
 *   L6        `import kotlin.math.pow`                        → `Math.pow`
 *   L7        (blank)                                          → SKIPPED
 *   L8        `// Bilibili Style Theme Palette (Dynamic via MaterialTheme)` → kept verbatim
 *   L9-11     `val MintPrimary: Color @Composable get() = MaterialTheme.colorScheme.primary`
 *                                                              → `resolveMintPrimary(scheme)`
 *   L12       (blank)                                          → SKIPPED
 *   L13-15    `val MintSecondary … colorScheme.secondary`     → `resolveMintSecondary(scheme)`
 *   L16       (blank)                                          → SKIPPED
 *   L17       `val MintGold = Color(0xFFE8C97A)`              → `MINT_GOLD`
 *   L18       (blank)                                          → SKIPPED
 *   L19       `val DarkCharcoal = Color(0xFF18191C)`          → `DARK_CHARCOAL`
 *   L20       `val MediumGray = Color(0xFF61666D)`            → `MEDIUM_GRAY`
 *   L21       `val DividerGray = Color(0xFFE3E5E7)`           → `DIVIDER_GRAY`
 *   L22       `val LightBg = Color(0xFFFFFFFF) // Pure white background` → `LIGHT_BG` (comment kept)
 *   L23       `val PureWhite = Color(0xFFFFFFFF)`              → `PURE_WHITE`
 *   L24       (blank)                                          → SKIPPED
 *   L25       `// Reader presets`                              → kept verbatim
 *   L26-27    `SepiaBg` / `SepiaText`                          → `READER_PRESETS.sepia`
 *   L28       (blank)                                          → SKIPPED
 *   L29-30    `EyeGreenBg` / `EyeGreenText`                    → `READER_PRESETS.eyeGreen`
 *   L31       (blank)                                          → SKIPPED
 *   L32-33    `NightBg` / `NightText`                          → `READER_PRESETS.night`
 *   L34       (blank)                                          → SKIPPED
 *   L35-36    `OledBg` / `OledText`                            → `READER_PRESETS.oled`
 *   L37       (blank)                                          → SKIPPED
 *   L38       KDoc  WCAG 相对亮度（0~1），底部 Tab 栏同款算法。  → kept verbatim
 *   L39       `fun Color.luminance(): Float`                  → `luminance(hex)`
 *   L40       `fun linear(c: Float)`                          → `linearChannel(c)` — the cut-off is
 *                                                              **0.03928**, see DIVERGENCE note below
 *   L41       the 0.2126/0.7152/0.0722 weighting              → verbatim
 *   L42       `}`                                              → n/a
 *   L43       (blank)                                          → SKIPPED
 *   L44-47    the `onColor()` KDoc                            → kept verbatim (comments only)
 *   L48       `fun Color.onColor(): Color`                    → `onColor(hex)`; threshold **0.5**
 *   L49       (blank)                                          → SKIPPED
 *   L50-54    the `glassTitleColor()` KDoc                    → kept verbatim (comments only)
 *   L55       `@Composable`                                   → SKIPPED (see L4)
 *   L56       `fun glassTitleColor(): Color`                  → `glassTitleColor(bgTone, surfaceLum)`
 *   L57       `val bgTone = com.example.ui.LocalBackgroundTone.current`
 *                                                              → the `bgTone` argument (0~1, the
 *                                                              wallpaper's average luminance *after*
 *                                                              the dim mask, per `MainActivity.kt`
 *                                                              L283-295)
 *   L58       `val surfaceLum = MaterialTheme.colorScheme.surface.luminance()`
 *                                                              → the `surfaceLum` argument, computed
 *                                                              by the caller with `luminance(...)`
 *   L59       `val effective = bgTone * 0.30f + surfaceLum * 0.70f` → `GLASS_TITLE_BG_WEIGHT` /
 *                                                              `GLASS_TITLE_SURFACE_WEIGHT`
 *   L60       `return if (effective > 0.4f) Color(0xFF1A1A1E) else Color.White` → threshold **0.4**
 *   L61       `}`                                              → n/a
 *
 * ── DIVERGENCE vs `src/ui/theme/tokens.ts` (NOT edited here; reported to the main agent) ──
 *   1. `tokens.ts` L54 uses the cut-off **0.04045**, this port uses Kotlin's **0.03928**
 *      (`Color.kt` L40). For 8-bit hex input the two are behaviourally IDENTICAL: the largest
 *      integer channel below either bound is 10 (`10/255 = 0.039216`), and the smallest above both
 *      is 11 (`0.043137`). The difference only shows on non-8-bit channels, which `parseHex`
 *      cannot produce. Cosmetic, no behavioural delta.
 *   2. `tokens.ts` L85-89 `glassTitleColor(bg, surface)` is a DIFFERENT ALGORITHM:
 *        - it blends in **sRGB channel space** (`mixHex(bg, surface, 0.78)`), while Kotlin blends
 *          in **linear-luminance space** (`bgTone*0.30 + surfaceLum*0.70`);
 *        - the weights are **0.22/0.78** there vs **0.30/0.70** in Kotlin;
 *        - `0.78` is `GLASS_SURFACE_ALPHA` borrowed from `GlassCard.kt`, not a constant that
 *          appears anywhere in `Color.kt`;
 *        - the threshold is **0.5** there vs **0.4** in Kotlin.
 *      Demonstrable outcome difference: `bgTone = 1.0` (white wallpaper), `surface = #6E6E6E`
 *      (luminance 0.1559) → Kotlin `effective = 0.3 + 0.7*0.1559 = 0.4091 > 0.4` → `#1A1A1E`;
 *      `tokens.ts` → `mixHex('#FFFFFF','#6E6E6E',0.78) = #BCBCBC`, luminance 0.2699 → `#FFFFFF`.
 *      This file keeps the Kotlin algorithm.
 *
 * ── DIVERGENCE vs `src/core/glass/color.ts` — CONSOLIDATED (PARITY E56④, 2026-10-11) ──
 *   `src/core/glass/color.ts` and `src/core/reader/readerScreenLogic.ts` used to keep their own
 *   `luminance()` copies (0.04045 / 0.03928 cut-offs). Both now re-export `luminance()` /
 *   `onColor()` from this file — the single source of truth for `Color.kt` L39-48.
 */

/** Kotlin `androidx.compose.ui.graphics.Color` narrowed to what these helpers read. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The seven Material3 slots `Theme.kt` actually sets. Everything else in Material3's
 * `ColorScheme` keeps its library default on both sides, so it is deliberately absent here.
 */
export interface MaterialColorScheme {
  primary: string;
  secondary: string;
  tertiary: string;
  background: string;
  surface: string;
  onBackground: string;
  onSurface: string;
}

// ── Palette (Color.kt L8-L23) ──────────────────────────────────────────────────

// Bilibili Style Theme Palette (Dynamic via MaterialTheme)

/** Kotlin L9-11 — `@Composable val MintPrimary get() = MaterialTheme.colorScheme.primary`. */
export function resolveMintPrimary(scheme: MaterialColorScheme): string {
  return scheme.primary;
}

/** Kotlin L13-15 — `@Composable val MintSecondary get() = MaterialTheme.colorScheme.secondary`. */
export function resolveMintSecondary(scheme: MaterialColorScheme): string {
  return scheme.secondary;
}

/** Kotlin L17 `val MintGold = Color(0xFFE8C97A)`. */
export const MINT_GOLD = '#E8C97A';

/** Kotlin L19 `val DarkCharcoal = Color(0xFF18191C)`. */
export const DARK_CHARCOAL = '#18191C';

/** Kotlin L20 `val MediumGray = Color(0xFF61666D)`. */
export const MEDIUM_GRAY = '#61666D';

/** Kotlin L21 `val DividerGray = Color(0xFFE3E5E7)`. */
export const DIVIDER_GRAY = '#E3E5E7';

/** Kotlin L22 `val LightBg = Color(0xFFFFFFFF) // Pure white background`. */
export const LIGHT_BG = '#FFFFFF';

/** Kotlin L23 `val PureWhite = Color(0xFFFFFFFF)`. */
export const PURE_WHITE = '#FFFFFF';

// Reader presets (Color.kt L25-L36)
//
// NOTE: no id / label is invented here. `tokens.ts` COLORS.readerThemes carries ids 0-5 and the
// Chinese labels 纯白 / 默认白 / 羊皮纸 / 夜间 / 护眼绿 / OLED; the four pairs below are the only
// ones `Color.kt` names, and their hexes match that table exactly.

/** Kotlin L26 `val SepiaBg = Color(0xFFFBF0D9)`. */
export const SEPIA_BG = '#FBF0D9';

/** Kotlin L27 `val SepiaText = Color(0xFF5F4B32)`. */
export const SEPIA_TEXT = '#5F4B32';

/** Kotlin L29 `val EyeGreenBg = Color(0xFFE8F5E9)`. */
export const EYE_GREEN_BG = '#E8F5E9';

/** Kotlin L30 `val EyeGreenText = Color(0xFF1B5E20)`. */
export const EYE_GREEN_TEXT = '#1B5E20';

/** Kotlin L32 `val NightBg = Color(0xFF18191C)`. */
export const NIGHT_BG = '#18191C';

/** Kotlin L33 `val NightText = Color(0xFFD4D4D4)`. */
export const NIGHT_TEXT = '#D4D4D4';

/** Kotlin L35 `val OledBg = Color(0xFF000000)`. */
export const OLED_BG = '#000000';

/** Kotlin L36 `val OledText = Color(0xFFE0E0E0)`. */
export const OLED_TEXT = '#E0E0E0';

/** Kotlin L26-L27, L29-L30, L32-L33, L35-L36. */
export const READER_PRESETS = {
  sepia: { background: SEPIA_BG, text: SEPIA_TEXT },
  eyeGreen: { background: EYE_GREEN_BG, text: EYE_GREEN_TEXT },
  night: { background: NIGHT_BG, text: NIGHT_TEXT },
  oled: { background: OLED_BG, text: OLED_TEXT },
} as const;

// ── Luminance / contrast (Color.kt L38-L48) ────────────────────────────────────

/** WCAG 相对亮度（0~1），底部 Tab 栏同款算法。 */
export const ON_COLOR_THRESHOLD = 0.5;

/** Kotlin L48 `Color(0xFF1A1A1E)` — the ink used on light backgrounds. */
export const ON_DARK_INK = '#1A1A1E';

/** Kotlin L48 `Color.White` = `Color(0xFFFFFFFF)`. */
export const WHITE = '#FFFFFF';

/**
 * Kotlin L40 `fun linear(c: Float)` — the sRGB → linear transfer function.
 *
 * The cut-off is **0.03928**, exactly as in `Color.kt`. `src/ui/theme/tokens.ts` L54 uses
 * **0.04045**; see the DIVERGENCE note in the file header.
 */
export function linearChannel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse `#RGB` / `#RRGGBB`. Returns null on malformed input (never throws). */
export function parseHexColor(hex: string): Rgb | null {
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

/** Kotlin L39-L41 `fun Color.luminance(): Float` — WCAG relative luminance, 0~1. */
export function luminance(hex: string): number {
  const rgb = parseHexColor(hex);
  // Compose's `luminance()` cannot be handed a malformed colour: the constant is always a
  // well-formed ARGB value. A bad hex string has no Android counterpart, so it degrades to the
  // same 0 that `luminance()` returns for pure black.
  if (rgb === null) return 0;
  return luminanceOfRgb(rgb);
}

/** Kotlin L39-L41, taking the channels Kotlin's `Color.red/green/blue` expose (0..255 ints). */
export function luminanceOfRgb(rgb: Rgb): number {
  return (
    0.2126 * linearChannel(rgb.r / 255) +
    0.7152 * linearChannel(rgb.g / 255) +
    0.0722 * linearChannel(rgb.b / 255)
  );
}

/**
 * 实时取“与背景对比的文字/图标色”（WCAG 相对亮度法，底部 Tab 栏同款算法）。
 * 亮背景 → 近黑 #1A1A1E；暗背景 → 纯白。任何自定义背景/主题下文字都不会黑上加黑。
 */
export function onColor(hex: string): string {
  return luminance(hex) > ON_COLOR_THRESHOLD ? ON_DARK_INK : WHITE;
}

// ── Glass title colour (Color.kt L50-L60) ──────────────────────────────────────

/** Kotlin L59 — the wallpaper's share of the "effective luminance" blend. */
export const GLASS_TITLE_BG_WEIGHT = 0.3;

/** Kotlin L59 — the theme surface's share (玻璃着色部分). */
export const GLASS_TITLE_SURFACE_WEIGHT = 0.7;

/** Kotlin L60 `if (effective > 0.4f)` — **not** the 0.5 used by `onColor()`. */
export const GLASS_TITLE_THRESHOLD = 0.4;

/**
 * 玻璃容器（GlassCard）上的标题色：按"壁纸透过玻璃后的有效亮度"实时取对比色。
 * 有效亮度 = 背景亮度×30%（玻璃透出部分）+ 主题表面亮度×70%（玻璃着色部分）。
 * 深色壁纸上白字、浅色壁纸上深字，与主题明暗无关——修复此前只看主题不看壁纸的问题。
 *
 * @param bgTone        `LocalBackgroundTone.current` — the wallpaper's average luminance in 0~1,
 *                      already multiplied by `(1 - dim/100)` (see `MainActivity.kt` L283-295).
 * @param surfaceLum    `MaterialTheme.colorScheme.surface.luminance()`.
 */
export function glassTitleColor(bgTone: number, surfaceLum: number): string {
  const effective = bgTone * GLASS_TITLE_BG_WEIGHT + surfaceLum * GLASS_TITLE_SURFACE_WEIGHT;
  return effective > GLASS_TITLE_THRESHOLD ? ON_DARK_INK : WHITE;
}

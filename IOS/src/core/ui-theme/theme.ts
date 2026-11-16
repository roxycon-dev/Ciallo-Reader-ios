/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/Theme.kt`
 *             (92 lines incl. trailing newline, 83 non-blank)
 *          → `src/core/ui-theme/theme.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`                  → SKIPPED (TS has no packages)
 *   L2        (blank)                                          → SKIPPED
 *   L3        `import android.os.Build`                        → SKIPPED: imported but never used
 *   L4        `import …animateColorAsState`                     → `themeColorTransitionMs` +
 *                                                              `themeColorTransitionCss` (the spec the
 *                                                              two animated colours use). The
 *                                                              animation itself is host-owned.
 *   L5        `import …core.tween`                             → the same
 *   L6        `import …foundation.ExperimentalFoundationApi`   → SKIPPED (an opt-in marker only)
 *   L7        `import …foundation.LocalOverscrollConfiguration` → SKIPPED, see "NO WEB EQUIVALENT" below
 *   L8        `import …foundation.isSystemInDarkTheme`         → the `darkTheme` option; the web host
 *                                                              reads `prefers-color-scheme`
 *   L9        `import androidx.compose.material3.*`             → `resolveColorScheme` (see the header)
 *   L10       `import …runtime.Composable`                     → SKIPPED (no composition)
 *   L11       `import …runtime.CompositionLocalProvider`        → SKIPPED
 *   L12       `import …runtime.getValue`                       → SKIPPED (Kotlin property delegate)
 *   L13       `import androidx.compose.ui.graphics.Color`       → `DARK_SURFACE`
 *   L14       `import …platform.LocalContext`                  → SKIPPED: imported but never used
 *   L15       (blank)                                          → SKIPPED
 *   L16       `val BasePrimaryColors = listOf(`               → `BASE_PRIMARY_COLORS`
 *   L17-21    the five entries with the Chinese index comments → verbatim, comments included:
 *              0: 蓝 / 1: 紫 / 2: 绿 / 3: 粉 / 4: 橙
 *   L22       `)`                                              → n/a
 *   L23       (blank)                                          → SKIPPED
 *   L24       `val BaseSecondaryColors = listOf(`             → `BASE_SECONDARY_COLORS`
 *   L25-29    the five entries (0: 蓝 / 1: 紫 / 2: 绿 / 3: 粉 / 4: 橙)
 *                                                             → verbatim, comments included
 *   L30       `)`                                              → n/a
 *   L31       (blank)                                          → SKIPPED
 *   L32       `@OptIn(ExperimentalFoundationApi::class)`      → SKIPPED (see L6)
 *   L33       `@Composable`                                    → SKIPPED (see L10)
 *   L34       `fun MyApplicationTheme(`                        → `resolveColorScheme(options)`
 *   L35       `darkTheme: Boolean = isSystemInDarkTheme()`    → `ThemeOptions.darkTheme`
 *   L36       `colorPrimaryIndex: Int = 2`                     → `ThemeOptions.colorPrimaryIndex`
 *   L37       `colorSecondaryIndex: Int = 2`                   → `ThemeOptions.colorSecondaryIndex`
 *   L38       `content: @Composable () -> Unit`                → SKIPPED: there is no ambient content
 *                                                              → host on the web; this module only
 *                                                              resolves the palette.
 *   L39       `) {`                                            → n/a
 *   L40-41    the AnimationExample3 comment (600ms cross-fade   → kept verbatim on
 *              through the named palette instead of snapping)   `themeColorTransitionMs`
 *   L42       `val colorTransitionMs = 600`                    → `THEME_COLOR_TRANSITION_MS`
 *   L43       `val targetPrimary = BasePrimaryColors.getOrElse(colorPrimaryIndex) { BasePrimaryColors[2] }`
 *                                                              → `resolveAccentIndex` (out-of-range
 *                                                              → index 2, i.e. 绿)
 *   L44       `val targetSecondary = BaseSecondaryColors.getOrElse(colorSecondaryIndex) { BaseSecondaryColors[2] }`
 *                                                              → same
 *   L45-51    `animateColorAsState(targetValue, tween(600, IosMotion.EaseOut), "themePrimary")`
 *                                                              → the `targetPrimary` field plus
 *                                                              `themeColorTransitionCss`
 *   L47-48    the 2026-09-21 comment on iOS easeOut            → kept verbatim
 *   L50       `label = "themePrimary"`                         → `ColorScheme.labels.primary`
 *   L52-56    the same for `themeSecondary`                    → same
 *   L55       `label = "themeSecondary"`                       → `ColorScheme.labels.secondary`
 *   L57       (blank)                                          → SKIPPED
 *   L58       `val lightColorScheme = lightColorScheme(`       → `lightColorScheme(...)`
 *   L59-65    primary / secondary / tertiary / background /    → verbatim:
 *              surface / onBackground / onSurface                primary = primaryColor,
 *                                                              secondary = secondaryColor,
 *                                                              tertiary = primaryColor,
 *                                                              background = LightBg (#FFFFFF),
 *                                                              surface = PureWhite (#FFFFFFFF),
 *                                                              onBackground = DarkCharcoal,
 *                                                              onSurface = DarkCharcoal
 *   L66       `)`                                              → n/a
 *   L67       (blank)                                          → SKIPPED
 *   L68       `val darkColorScheme = darkColorScheme(`         → `darkColorScheme(...)`
 *   L69-75    the same seven slots                             → verbatim, with
 *                                                              surface = Color(0xFF222428)
 *   L76       `)`                                              → n/a
 *   L77       (blank)                                          → SKIPPED
 *   L78       `val colorScheme = if (darkTheme) darkColorScheme else lightColorScheme`
 *                                                              → the ternary inside `resolveColorScheme`
 *   L79       (blank)                                          → SKIPPED
 *   L80       `MaterialTheme(`                                 → `ResolvedTheme`
 *   L81       `colorScheme = colorScheme`                      → `ResolvedTheme.colorScheme`
 *   L82       `typography = Typography`                        → `ResolvedTheme.typography` — re-exported
 *                                                              from `./type` so both halves of the
 *                                                              theme stay one import
 *   L83       `) {`                                            → n/a
 *   L84-86    the 2026-09-21 comment on overscroll glow       → kept verbatim; see "NO WEB EQUIVALENT"
 *   L87       `CompositionLocalProvider(LocalOverscrollConfiguration provides null) {`
 *                                                             → SKIPPED, see "NO WEB EQUIVALENT"
 *   L88       `content()`                                      → SKIPPED (see L38)
 *   L89       `}` / L90 `}` / L91 `}`                          → n/a
 *
 * ── NO WEB EQUIVALENT (L7 / L87) ──────────────────────────────────────────────
 *   2026-09-21：Android 滚动容器默认带“边缘发光”（overscroll glow），
 *   iOS 的 UIScrollView 没有这个效果（它用回弹而非光晕），这是滚动时
 *   一眼能看出的安卓味来源。全局关掉后，长列表/书架的滚动观感明显接近 iOS。
 *
 *   `LocalOverscrollConfiguration provides null` is the Android "turn the glow off" switch.
 *   On the web the overscroll glow is a `::-webkit-scrollbar` / non-standard property that no
 *   mainstream engine emits, so there is nothing to switch off — the effect is absent by
 *   default. A host that needs belt-and-braces can add `overscroll-behavior: none` in its own
 *   CSS; that is deliberately NOT emitted from this core module.
 *
 * ── DIVERGENCE vs `src/ui/theme/tokens.ts` / `src/styles/theme.css` ────────────
 *   · `tokens.ts` L26-29 `primaryPalette` / `secondaryPalette` / `defaultPrimaryIndex: 2` /
 *     `defaultSecondaryIndex: 2` → **all ten hexes and both defaults match exactly.** ✓
 *   · MISSING anywhere: `THEME_COLOR_TRANSITION_MS = 600` (L42). Neither `tokens.ts` MOTION nor
 *     `theme.css` declares a 600 ms colour transition, so the iOS theme-colour cross-fade has
 *     no token to bind to. This file exports it.
 *   · MISSING anywhere: the dark scheme's `surface = Color(0xFF222428)` (L73). `theme.css` L35
 *     only has `--color-surface: #ffffff` (the LIGHT value) and there is **no `@media
 *     (prefers-color-scheme: dark)` block in theme.css at all**, so the whole dark scheme
 *     (`background #18191C`, `surface #222428`, `onBackground`/`onSurface #D4D4D4`) is
 *     unrealized in CSS. `tokens.ts` L16 `darkCharcoal` / L32 `onDark` carry two of the four
 *     values as loose constants.
 *   · `theme.css` L24 `--color-primary-start: #2563eb` is the palette's *index 0*, used only as
 *     the left stop of `--gradient-primary`. Kotlin has no such notion — the gradient is a
 *     `GlassCard`/`AppButton` detail, not a `Theme.kt` value. Noted, not a divergence.
 */

import {
  DARK_CHARCOAL,
  LIGHT_BG,
  NIGHT_TEXT,
  PURE_WHITE,
  type MaterialColorScheme,
} from './color';
import { IOS_EASING_CSS } from './iosMotion';
import { TYPOGRAPHY, type TextStyle, type TypographySlot } from './type';

/** The five-entry shape both Kotlin `listOf(…)` calls have. */
export type AccentPalette = readonly [string, string, string, string, string];

/** Kotlin L16-L22 — `val BasePrimaryColors = listOf(...)`. */
export const BASE_PRIMARY_COLORS: AccentPalette = [
  '#2563EB', // 0: 蓝
  '#7C3AED', // 1: 紫
  '#059669', // 2: 绿
  '#DB2777', // 3: 粉
  '#EA580C', // 4: 橙
];

/** Kotlin L24-L30 — `val BaseSecondaryColors = listOf(...)`. */
export const BASE_SECONDARY_COLORS: AccentPalette = [
  '#3B82F6', // 0: 蓝
  '#8B5CF6', // 1: 紫
  '#10B981', // 2: 绿
  '#EC4899', // 3: 粉
  '#F97316', // 4: 橙
];

/** Kotlin L36-L37 — both accent indices default to 2. */
export const DEFAULT_PRIMARY_INDEX = 2;

/** Kotlin L37 — `colorSecondaryIndex: Int = 2`. */
export const DEFAULT_SECONDARY_INDEX = 2;

/**
 * Kotlin L42 `val colorTransitionMs = 600`.
 *
 * AnimationExample3：animateColorAsState 穿过命名调色板，600ms 平滑过渡，
 * 切换主题色时整个软件的背景/强调色是渐变过去的，而不是瞬间跳变。
 */
export const THEME_COLOR_TRANSITION_MS = 600;

/**
 * Kotlin L49 / L54 `tween(durationMillis = colorTransitionMs, easing = IosMotion.EaseOut)` and
 * the 2026-09-21 comment on iOS easeOut:
 *   2026-09-21：换主题色是“全界面换肤”，线性补间的中段变化太平均，
 *   观感偏钝。改用 iOS easeOut：起步快、尾部缓，收尾更干净。
 */
export const themeColorTransitionCss = `${THEME_COLOR_TRANSITION_MS}ms ${IOS_EASING_CSS.easeOut}`;

/** Kotlin L73 `surface = Color(0xFF222428)` — the dark scheme's surface, present in no token file. */
export const DARK_SURFACE = '#222428';

/**
 * Kotlin L43/L44 `BaseColors.getOrElse(index) { BaseColors[2] }`.
 *
 * `getOrElse` fires for every out-of-bounds index, so a negative index, an index ≥ 5 and a
 * non-integer (`NaN`) all land on entry 2. The explicit `switch` reproduces that exactly while
 * staying total, so no `?? ''` fallback can ever be reached.
 */
export function resolveAccent(palette: AccentPalette, index: number): string {
  switch (index) {
    case 0:
      return palette[0];
    case 1:
      return palette[1];
    case 2:
      return palette[2];
    case 3:
      return palette[3];
    case 4:
      return palette[4];
    default:
      return palette[DEFAULT_PRIMARY_INDEX];
  }
}

/** Kotlin L35-L37 — `MyApplicationTheme`'s three scalar parameters. */
export interface ThemeOptions {
  /** Kotlin L35 `darkTheme: Boolean = isSystemInDarkTheme()`. */
  readonly darkTheme: boolean;
  /** Kotlin L36 `colorPrimaryIndex: Int = 2`. */
  readonly colorPrimaryIndex?: number;
  /** Kotlin L37 `colorSecondaryIndex: Int = 2`. */
  readonly colorSecondaryIndex?: number;
}

/** Kotlin L80-L83 `MaterialTheme(colorScheme, typography)`. */
export interface ResolvedTheme {
  readonly colorScheme: MaterialColorScheme;
  readonly typography: Readonly<Record<TypographySlot, TextStyle>>;
  /** Kotlin L50 / L55 — the two `animateColorAsState` labels. */
  readonly labels: { readonly primary: string; readonly secondary: string };
  /** Kotlin L42/L49 — the spec both animated colours use. */
  readonly colorTransitionCss: string;
}

/** Kotlin L58-L66 `lightColorScheme(primary, secondary, tertiary, background, surface, onBackground, onSurface)`. */
export function lightColorScheme(
  primaryColor: string,
  secondaryColor: string,
): MaterialColorScheme {
  return {
    primary: primaryColor,
    secondary: secondaryColor,
    tertiary: primaryColor,
    background: LIGHT_BG,
    surface: PURE_WHITE,
    onBackground: DARK_CHARCOAL,
    onSurface: DARK_CHARCOAL,
  };
}

/** Kotlin L68-L76 `darkColorScheme(primary, secondary, tertiary, background, surface, onBackground, onSurface)`. */
export function darkColorScheme(
  primaryColor: string,
  secondaryColor: string,
): MaterialColorScheme {
  return {
    primary: primaryColor,
    secondary: secondaryColor,
    tertiary: primaryColor,
    background: DARK_CHARCOAL,
    surface: DARK_SURFACE,
    onBackground: NIGHT_TEXT,
    onSurface: NIGHT_TEXT,
  };
}

/** Kotlin L43-L44 — the two `getOrElse`-resolved targets. */
export function resolveAccentColors(options: ThemeOptions): {
  primary: string;
  secondary: string;
} {
  return {
    primary: resolveAccent(BASE_PRIMARY_COLORS, options.colorPrimaryIndex ?? DEFAULT_PRIMARY_INDEX),
    secondary: resolveAccent(
      BASE_SECONDARY_COLORS,
      options.colorSecondaryIndex ?? DEFAULT_SECONDARY_INDEX,
    ),
  };
}

/** Kotlin L34-L91 — everything `MyApplicationTheme` resolves, minus the composition. */
export function resolveColorScheme(options: ThemeOptions): ResolvedTheme {
  const accents = resolveAccentColors(options);
  // Kotlin L78 — `if (darkTheme) darkColorScheme else lightColorScheme`
  const colorScheme = options.darkTheme
    ? darkColorScheme(accents.primary, accents.secondary)
    : lightColorScheme(accents.primary, accents.secondary);
  return {
    colorScheme,
    typography: TYPOGRAPHY,
    labels: { primary: 'themePrimary', secondary: 'themeSecondary' },
    colorTransitionCss: themeColorTransitionCss,
  };
}

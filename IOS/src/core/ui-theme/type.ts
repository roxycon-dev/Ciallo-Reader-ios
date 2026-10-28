/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/Type.kt`
 *             (140 lines incl. trailing newline, 133 non-blank)
 *          → `src/core/ui-theme/type.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`               → SKIPPED (TS has no packages)
 *   L2        (blank)                                       → SKIPPED
 *   L3        `import androidx.compose.material3.Typography` → `Typography` + `TypographySlot`
 *   L4        `import androidx.compose.ui.text.TextStyle`   → `TextStyle`
 *   L5        `import …font.FontFamily`                    → `fontFamily: string` (a CSS stack)
 *   L6        `import …font.FontWeight`                    → `FontWeight` + `FONT_WEIGHT_CSS`
 *   L7        `import …unit.sp`                             → `sp` is a **plain number**; see the
 *                                                             "sp == px" adaptation below
 *   L8        (blank)                                       → SKIPPED
 *   L9-22     the rewrite KDoc (why the 15 slots were given  → kept verbatim (comments only)
 *             real line-heights, the two iOS traits)        → the two bullets survive in the
 *                                                             `letterSpacing` note on `TextStyle`
 *   L23       `val Typography = Typography(`               → `TYPOGRAPHY`
 *   L24       `// ── 大标题（iOS Large Title）──`            → kept verbatim
 *   L25-31    displayLarge                                  → `displayLarge`
 *   L32-38    displayMedium                                 → `displayMedium`
 *   L39-45    displaySmall                                  → `displaySmall`
 *   L46       (blank)                                       → SKIPPED
 *   L47       `// ── 区块标题 ──`                           → kept verbatim
 *   L48-54    headlineLarge                                 → `headlineLarge`
 *   L55-61    headlineMedium                                → `headlineMedium`
 *   L62-68    headlineSmall                                 → `headlineSmall`
 *   L69       (blank)                                       → SKIPPED
 *   L70       `// ── iOS Title 1/2/3 …`                     → kept verbatim
 *   L71-77    titleLarge                                    → `titleLarge`
 *   L78-84    titleMedium                                   → `titleMedium`
 *   L85-91    titleSmall                                    → `titleSmall`
 *   L92       (blank)                                       → SKIPPED
 *   L93       `// ── 正文 …`                                → kept verbatim
 *   L94-101   bodyLarge (L98 comment: 原为 26sp …)          → `bodyLarge` (comment kept)
 *   L102-108  bodyMedium                                    → `bodyMedium`
 *   L109-115  bodySmall                                     → `bodySmall`
 *   L116      (blank)                                       → SKIPPED
 *   L117      `// ── 按钮 / 副标题 / 脚注 ──`                → kept verbatim
 *   L118-124  labelLarge                                    → `labelLarge`
 *   L125-131  labelMedium                                   → `labelMedium`
 *   L132-138  labelSmall                                    → `labelSmall`
 *   L139      `)`                                           → n/a
 *
 * ── ADAPTATION — `sp` → `px` ────────────────────────────────────────────────────
 * Android `sp` scales with the OS **font** scale and is density-independent. CSS `px` in
 * `font-size` / `line-height` does NOT follow the browser's default-font-size setting. To keep
 * every number byte-identical to the Kotlin source, the table stores raw `sp` values and
 * `textStyleCss()` multiplies by the injected `scale` (default `1`). Pass the user's font scale
 * to get Android's behaviour; pass `1` to get the design values.
 *
 * All 15 slots use `AppFonts.Default`, i.e. the Noto Sans SC stack — see `appFonts.ts`.
 *
 * ── ADAPTATION — `AppFonts.Default` → `APP_FONTS.Default` ───────────────────────
 *   Kotlin writes `fontFamily = AppFonts.Default` on all 15 slots. `AppFonts.kt` L47-63 makes
 *   that the bundled Noto Sans SC subset, so the web value is the same CSS stack `theme.css`
 *   L66 already exposes as `--font-sans`, imported from `./appFonts` so this module keeps a
 *   single font exit exactly as Kotlin does.
 *
 * ── DIVERGENCE vs `src/styles/theme.css` (NOT edited here; reported to the main agent) ──
 *   `theme.css` contains **no realization of this table at all**. The 15 slots exist only as
 *   ad-hoc per-component `font-size` / `line-height` / `letter-spacing` declarations, and
 *   several of them contradict the numbers above:
 *     · `.page-title`   L145 `letter-spacing: 0.5px`  vs displayMedium `-0.3sp`  → wrong sign
 *     · `.page-subtitle`L153 `letter-spacing: 1px`    vs bodySmall `0sp`        → +1px
 *     · `.subpage-title`(no letter-spacing ⇒ 0)      vs headlineLarge `-0.25sp` → wrong sign
 *     · `.app-tabbar-label` L1229-1232 `10px / 12px / letter-spacing 0.4px`
 *                                                  vs labelSmall `11sp / 16sp / +0.06sp`
 *     · `.tab-screen-header__subtitle` L1044-1046 `12px / 20px / 1.5px`
 *                                                  → no Kotlin slot exists at 12sp
 *     · `.settings-section-title` L698-700 `12px / 600 / 1.5px` → no Kotlin slot at 12sp
 *     · `.tab-screen-header__title` L1034 `line-height: 1.25`
 *                                                  vs headlineLarge 28sp/22sp = 1.2727…
 *   `src/ui/tokens.ts` L52-57 `DESIGN_TOKENS.typography` is a 4-entry subset carrying sizes
 *   only: `headline: 28` (that is displayMedium's size; the slot literally named *headline* is
 *   22sp), `title: 20` (headlineMedium's size), `body: 16`, `caption: 13` (bodySmall's size).
 *   No weights, no line heights, no letter spacings, 11 of 15 slots missing.
 */

import { APP_FONTS } from './appFonts';

/** Kotlin `androidx.compose.ui.text.font.FontWeight` (L6). */
export type FontWeight = 'Normal' | 'Medium' | 'SemiBold' | 'Bold';

/** Kotlin L6 — the CSS `font-weight` each Compose weight resolves to. */
export const FONT_WEIGHT_CSS: Readonly<Record<FontWeight, number>> = {
  Normal: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
};

/** Kotlin L4 `TextStyle` — only the five fields this file ever sets. */
export interface TextStyle {
  /** Kotlin `fontFamily: AppFonts.Default` — a CSS `font-family` stack. */
  readonly fontFamily: string;
  /** Kotlin `fontWeight`. */
  readonly fontWeight: FontWeight;
  /** Kotlin `fontSize`, in `sp`. */
  readonly fontSize: number;
  /** Kotlin `lineHeight`, in `sp`. */
  readonly lineHeight: number;
  /** Kotlin `letterSpacing`, in `sp`. Negative = tighter. */
  readonly letterSpacing: number;
}

/** Kotlin L3 `androidx.compose.material3.Typography` — the 15 slots. */
export const TYPOGRAPHY_SLOTS = [
  'displayLarge',
  'displayMedium',
  'displaySmall',
  'headlineLarge',
  'headlineMedium',
  'headlineSmall',
  'titleLarge',
  'titleMedium',
  'titleSmall',
  'bodyLarge',
  'bodyMedium',
  'bodySmall',
  'labelLarge',
  'labelMedium',
  'labelSmall',
] as const;

export type TypographySlot = (typeof TYPOGRAPHY_SLOTS)[number];

/** Every entry uses `AppFonts.Default`; named once so `appFonts.ts` stays the single exit. */
const APP_FONT_DEFAULT = APP_FONTS.Default;

/** ── 大标题（iOS Large Title）── */
const displayLarge: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Bold',
  fontSize: 34,
  lineHeight: 41,
  letterSpacing: -0.4,
};

const displayMedium: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Bold',
  fontSize: 28,
  lineHeight: 34,
  letterSpacing: -0.3,
};

const displaySmall: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'SemiBold',
  fontSize: 24,
  lineHeight: 30,
  letterSpacing: -0.25,
};

/** ── 区块标题 ── */
const headlineLarge: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Bold',
  fontSize: 22,
  lineHeight: 28,
  letterSpacing: -0.25,
};

const headlineMedium: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'SemiBold',
  fontSize: 20,
  lineHeight: 26,
  letterSpacing: -0.2,
};

const headlineSmall: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'SemiBold',
  fontSize: 18,
  lineHeight: 24,
  letterSpacing: -0.2,
};

/** ── iOS Title 1/2/3：列表主标题、卡片标题 ── */
const titleLarge: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'SemiBold',
  fontSize: 17,
  lineHeight: 24,
  letterSpacing: -0.2,
};

const titleMedium: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Medium',
  fontSize: 16,
  lineHeight: 22,
  letterSpacing: -0.15,
};

const titleSmall: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Medium',
  fontSize: 14,
  lineHeight: 20,
  letterSpacing: -0.1,
};

/**
 * ── 正文（iOS Body 为 17sp，中文环境取 16sp 更稳）──
 *
 * iOS 排版的两个关键特征（原文见 Kotlin L17-21）：
 *  1. **字号越大，字距越紧**（负值 letterSpacing）：34sp 用 -0.4，11sp 反而放开到
 *     +0.06。这是 iOS 标题看起来“精致紧凑”的核心，Material 默认一律 0 或正值。
 *  2. **行高按中文舒适度设定**：正文约取字号的 1.45 倍，标题取 1.2~1.25 倍。
 *     中文没有西文的下伸部，行高过大显得松散。
 */
const bodyLarge: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Normal',
  fontSize: 16,
  lineHeight: 23, // 原为 26sp：相对 16sp 字号虚高，中文段落显得松散
  letterSpacing: -0.1,
};

const bodyMedium: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Normal',
  fontSize: 14,
  lineHeight: 21,
  letterSpacing: 0,
};

const bodySmall: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Normal',
  fontSize: 13,
  lineHeight: 19,
  letterSpacing: 0,
};

/** ── 按钮 / 副标题 / 脚注 ── */
const labelLarge: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'SemiBold',
  fontSize: 15,
  lineHeight: 20,
  letterSpacing: -0.1,
};

const labelMedium: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Medium',
  fontSize: 13,
  lineHeight: 18,
  letterSpacing: 0,
};

const labelSmall: TextStyle = {
  fontFamily: APP_FONT_DEFAULT,
  fontWeight: 'Medium',
  fontSize: 11,
  lineHeight: 16,
  letterSpacing: 0.06,
};

/** Kotlin L23 `val Typography = Typography(…)`. */
export const TYPOGRAPHY: Readonly<Record<TypographySlot, TextStyle>> = {
  displayLarge,
  displayMedium,
  displaySmall,
  headlineLarge,
  headlineMedium,
  headlineSmall,
  titleLarge,
  titleMedium,
  titleSmall,
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  labelSmall,
};

/** Kotlin L23 — `MaterialTheme(typography = Typography)` in `Theme.kt` L82. */
export function typography(slot: TypographySlot): TextStyle {
  return TYPOGRAPHY[slot];
}

/** The CSS declarations for one slot, in `px`. `scale` is the Android font scale (default 1). */
export interface TextStyleCss {
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
}

/**
 * Rounds a scaled length to 4 decimals.
 *
 * Android computes `23.sp * 1.3f` in 32-bit float, which lands on 29.9; naive JS double
 * arithmetic yields `29.900000000000002`. Rounding to 4 decimals reproduces the platform value
 * and keeps the emitted CSS free of float noise. 4 decimals is far finer than any sp value in
 * the table (the smallest magnitude is 0.06), so no Kotlin number is altered.
 */
function scaleLength(value: number, scale: number): number {
  return Math.round(value * scale * 10_000) / 10_000;
}

/**
 * Kotlin `TextStyle` → the five CSS longhands.
 *
 * `letterSpacing` is emitted verbatim: `0` becomes `0px` (not omitted) so a caller can tell
 * "0" apart from "unset" when diffing against the Kotlin table.
 */
export function textStyleCss(style: TextStyle, scale = 1): TextStyleCss {
  return {
    fontFamily: style.fontFamily,
    fontWeight: FONT_WEIGHT_CSS[style.fontWeight],
    fontSize: `${scaleLength(style.fontSize, scale)}px`,
    lineHeight: `${scaleLength(style.lineHeight, scale)}px`,
    letterSpacing: `${scaleLength(style.letterSpacing, scale)}px`,
  };
}

/** `lineHeight / fontSize`, the ratio the KDoc at L20 calls "中文舒适度". Useful for assertions. */
export function lineHeightRatio(style: TextStyle): number {
  return style.lineHeight / style.fontSize;
}

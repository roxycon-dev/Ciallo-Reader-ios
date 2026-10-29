/**
 * Barrel for the `ui/theme` port of `com.example.ui.theme`.
 *
 * Kotlin sources ported here (all read in full, none modified):
 *   ui/theme/Color.kt               → ./color
 *   ui/theme/Type.kt                → ./type
 *   ui/theme/AppFonts.kt            → ./appFonts
 *   ui/theme/IosMotion.kt           → ./iosMotion
 *   ui/theme/ModifierExtensions.kt  → ./modifierExtensions
 *   ui/theme/AppInsets.kt           → ./appInsets
 *   ui/theme/Theme.kt               → ./theme
 *
 * `src/core/**` is pure TypeScript: no React, no DOM globals, no Capacitor (enforced by the
 * ESLint `no-restricted-imports` override for that directory). Everything the Compose originals
 * read from a `CompositionLocal` / `LocalHapticFeedback` is an explicit argument or an injected
 * callback here, and every `Modifier` extension is a plain data descriptor plus a resolver.
 *
 * U+3000 (ideographic space) does not occur in any of the seven Kotlin files (verified: 0
 * matches), so nothing in this directory needs a `\u3000` escape.
 *
 * Known overlap with already-ported modules, reported rather than silently merged:
 *   · `src/core/glass/color.ts` / `src/core/reader/readerScreenLogic.ts` used to re-implement
 *     `luminance()` / `onColor()`; both re-export from `./color` since 2026-10-11
 *     (PARITY E56④ consolidation, single source of truth for Color.kt L39-48).
 *   · `src/core/glass/motion.ts` already fitted beziers for `IosMotion.spring()` /
 *     `springSoft()`; this port reuses those fits.
 *   · `src/core/reader/readerScreenLogic.ts` carries an identical reading-font table.
 *   · `src/ui/theme/tokens.ts` / `src/styles/theme.css` hold the phase-0 token snapshot; the
 *     divergence table in each file header lists every mismatch.
 */

export {
  // color.ts
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
  WHITE,
  glassTitleColor,
  linearChannel,
  luminance,
  luminanceOfRgb,
  onColor,
  parseHexColor,
  resolveMintPrimary,
  resolveMintSecondary,
} from './color';
export type { MaterialColorScheme, Rgb } from './color';

export {
  // type.ts
  FONT_WEIGHT_CSS,
  TYPOGRAPHY,
  TYPOGRAPHY_SLOTS,
  lineHeightRatio,
  textStyleCss,
  typography,
} from './type';
export type { FontWeight, TextStyle, TextStyleCss, TypographySlot } from './type';

export {
  // appFonts.ts
  APP_FONTS,
  FONT_RESOURCE_STRIPPED,
  MONOSPACE_STACK,
  NOTO_SANS_SC_FACES,
  NOTO_SANS_SC_FILE,
  NOTO_SANS_SC_STACK,
  NOTO_SERIF_SC_FACES,
  NOTO_SERIF_SC_FILE,
  NOTO_SERIF_SC_STACK,
  assertReadingFontIds,
  readingFontFamilies,
  readingFontFamily,
} from './appFonts';
export type { AppFontFamily, AppFontName, ReadingFontFamily, WebFontFace } from './appFonts';

export {
  // iosMotion.ts
  IOS_EASINGS,
  IOS_EASING_CSS,
  IOS_MOTION,
  IOS_MOTION_USAGE,
  SPRING,
  SPRING_SNAPPY,
  SPRING_SOFT,
  easeInOut,
  easeOut,
  easeOutQuart,
  easingCss,
  spring,
  springSnappy,
  springSettleMs,
  springSoft,
} from './iosMotion';
export type { Easing, SpringSpec, TweenSpec } from './iosMotion';

export {
  // modifierExtensions.ts
  ALPHA_DEFAULT_MS,
  ALPHA_EASING,
  ALPHA_EASING_CSS,
  DIM_DOWN_MS,
  DIM_UP_MS,
  HAPTIC_TYPE_TEXT_HANDLE_MOVE,
  PRESS_DOWN_MS,
  PRESS_UP_MS,
  PRESSED_DIM_ALPHA,
  PRESSED_SCALE,
  RESTING_DIM_ALPHA,
  RESTING_SCALE,
  ROW_DOWN_MS,
  ROW_HIGHLIGHT_ALPHA,
  ROW_HIGHLIGHT_GRAY,
  ROW_HIGHLIGHT_OFF,
  ROW_HIGHLIGHT_ON,
  ROW_UP_MS,
  alphaTransition,
  onPressEdge,
  pressFeedback,
  rowPressFeedback,
} from './modifierExtensions';
export type {
  AlphaTransitionOptions,
  AlphaTransitionSpec,
  HapticFeedbackType,
  PerformHapticFeedback,
  PressFeedbackOptions,
  PressFeedbackSpec,
  PressFeedbackStyle,
  RowPressFeedbackOptions,
  RowPressFeedbackSpec,
} from './modifierExtensions';

export {
  // appInsets.ts
  APP_INSETS_DEFAULT,
  FLOATING_TAB_BAR_TOTAL_DP,
  INSET_DEFAULT_DP,
  TAB_BAR_BODY_DP,
  TAB_BAR_MARGIN_BOTTOM_DP,
  TAB_BAR_MARGIN_DP,
  TAB_BAR_MARGIN_TOP_DP,
  VISUAL_GAP_DP,
  appInsetsPaddingBottomCss,
  appInsetsWidthClass,
  resolveAppInsets,
} from './appInsets';
export type { AppInsetsEnvironment, AppInsetsSpec, WindowWidthClass } from './appInsets';

export {
  // theme.ts
  BASE_PRIMARY_COLORS,
  BASE_SECONDARY_COLORS,
  DARK_SURFACE,
  DEFAULT_PRIMARY_INDEX,
  DEFAULT_SECONDARY_INDEX,
  THEME_COLOR_TRANSITION_MS,
  darkColorScheme,
  lightColorScheme,
  resolveAccent,
  resolveAccentColors,
  resolveColorScheme,
  themeColorTransitionCss,
} from './theme';
export type { AccentPalette, ResolvedTheme, ThemeOptions } from './theme';

/**
 * `AppButton` 的尺寸与配色 —— `ui/components/AppButton.kt` L88-124 + L401-415 的逐值移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L88-97   `enum class AppButtonSize(height, horizontalPadding, fontSize, iconSize)`
 *            Small 36/16/13/14、Medium 44/20/14/16、Large 52/24/15/18 → `APP_BUTTON_SIZES`
 *   L99-104  `data class AppButtonColors(primary, primaryVariant, accent, destructive)` → `AppButtonColors`
 *   L107     `LocalAppButtonColors = staticCompositionLocalOf<AppButtonColors?> { null }` → UI 层 Context
 *   L110-124 `rememberAppButtonColors()`：`primaryVariant = lerp(primary, White, 0.35f)` → `appButtonColors`
 *   L401-415 `primaryGlassStyle(colors)`：Capsule / blur 20dp / refraction(14, 22) /
 *            saturation 1.5 / tint primary@.30 / highlight(3dp, .85, 245°) /
 *            noise .02 / chromaticAberration .4                    → `PRIMARY_GLASS_STYLE`
 *
 * 平台差异（已登记 E132）：`GlassStyle`（Haze 渲染）→ CSS `backdrop-filter` + 渐变高光；
 * 数值逐项保留，供 `src/ui/components/AppButton.tsx` 注入。
 */

export interface AppButtonSizeSpec {
  readonly height: number;
  readonly horizontalPadding: number;
  readonly fontSize: number;
  readonly iconSize: number;
}

/** L94-96 的三档（dp / sp）。 */
export const APP_BUTTON_SIZES: Record<'Small' | 'Medium' | 'Large', AppButtonSizeSpec> = {
  Small: { height: 36, horizontalPadding: 16, fontSize: 13, iconSize: 14 },
  Medium: { height: 44, horizontalPadding: 20, fontSize: 14, iconSize: 16 },
  Large: { height: 52, horizontalPadding: 24, fontSize: 15, iconSize: 18 },
};

export type AppButtonSize = keyof typeof APP_BUTTON_SIZES;

/**
 * `AppButton.kt` L81-86 `enum class AppButtonVariant { Primary, Secondary, Tertiary, Destructive }`。
 *
 * 顺序即 Kotlin 的 ordinal：UI 里按变体做 `:nth` 样式、测试按序数对拍都依赖它。
 */
export const APP_BUTTON_VARIANTS = ['Primary', 'Secondary', 'Tertiary', 'Destructive'] as const;
export type AppButtonVariant = (typeof APP_BUTTON_VARIANTS)[number];

/** L99-104。 */
export interface AppButtonColors {
  readonly primary: number;
  readonly primaryVariant: number;
  readonly accent: number;
  readonly destructive: number;
}

/** L118 `lerp(themePrimary, Color.White, 0.35f)` 的系数。 */
export const APP_BUTTON_PRIMARY_VARIANT_MIX = 0.35;

/** `androidx.compose.ui.graphics.lerp(a, b, t)` 的整数等价物。 */
export function lerpArgbColor(a: number, b: number, t: number): number {
  const mix = Math.min(Math.max(t, 0), 1);
  const ch = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * mix) & 0xff;
  };
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** L110-124 `rememberAppButtonColors()`（`LocalAppButtonColors` 的覆盖由 UI 层给）。 */
export function appButtonColors(
  themePrimary: number,
  themeAccent: number,
  themeDestructive: number,
  override: AppButtonColors | null = null,
): AppButtonColors {
  if (override !== null) return override;
  return {
    primary: themePrimary,
    primaryVariant: lerpArgbColor(themePrimary, 0xffffff, APP_BUTTON_PRIMARY_VARIANT_MIX),
    accent: themeAccent,
    destructive: themeDestructive,
  };
}

/** L401-415 `primaryGlassStyle` 的数值表。 */
export const PRIMARY_GLASS_STYLE = {
  shape: 'Capsule',
  blurRadiusDp: 20,
  refractionHeightDp: 14,
  refractionAmountDp: 22,
  saturation: 1.5,
  tintAlpha: 0.3,
  highlightWidthDp: 3,
  highlightAlpha: 0.85,
  highlightAngleDeg: 245,
  noiseAlpha: 0.02,
  chromaticAberration: 0.4,
} as const;

/** `primaryGlassStyle(colors)` 的 CSS 值（tint 需要主题色，故单独给函数）。 */
export function primaryGlassCss(colors: AppButtonColors): {
  readonly backdropFilter: string;
  readonly background: string;
  readonly boxShadow: string;
} {
  return {
    backdropFilter: `blur(${String(PRIMARY_GLASS_STYLE.blurRadiusDp)}px) saturate(${String(
      PRIMARY_GLASS_STYLE.saturation,
    )})`,
    background: `rgba(${String((colors.primary >>> 16) & 0xff)}, ${String(
      (colors.primary >>> 8) & 0xff,
    )}, ${String(colors.primary & 0xff)}, ${String(PRIMARY_GLASS_STYLE.tintAlpha)})`,
    // highlight：3dp、alpha .85、245° 的斜向高光带。
    boxShadow: `inset 0 0 0 ${String(PRIMARY_GLASS_STYLE.highlightWidthDp)}px rgba(255, 255, 255, ${String(
      PRIMARY_GLASS_STYLE.highlightAlpha,
    )})`,
  };
}

/**
 * `AppButton.kt` L208 `val disabledAlpha = 0.4f` —— 禁用态整体透明度。
 *
 * Compose 是显式 `graphicsLayer { alpha = if (enabled) 1f else disabledAlpha }`；
 * Web 侧要靠这个常量把同样的观感注进 `style.opacity`（浏览器默认的 disabled 样式
 * 各平台不一，且不区分「禁用」与「加载中」）。
 */
export const APP_BUTTON_DISABLED_ALPHA = 0.4;

/**
 * `AppButton.kt` L202-205 的阴影：**只有 Primary** 有，且按下从 16dp 收到 2dp。
 *
 * `val shadowElevation = if (variant == Primary) animateDpAsState(if (pressed) 2.dp else 16.dp)
 *  else remember { mutableStateOf(0.dp) }`
 */
export const APP_BUTTON_SHADOW = {
  primaryRestDp: 16,
  primaryPressedDp: 2,
  otherVariantDp: 0,
} as const;

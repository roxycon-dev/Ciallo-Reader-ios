/**
 * Design tokens extracted from Android `DesignTokens.kt` / `Color.kt` /
 * `IosMotion.kt` / `AppFonts.kt` during Phase 0.
 *
 * Regenerate/validate via: npm run tokens
 * Source of truth remains the Android Kotlin files — never invent values here.
 */

export const DESIGN_TOKENS = {
  color: {
    /**
     * Android `Theme.kt` L36 `colorPrimaryIndex: Int = 2` → `BasePrimaryColors[2]`
     * （L19 `Color(0xFF059669)` // 2: 绿）。默认值是**绿**，不是 `#4CAF50`
     * —— 旧值在 Android 源码里根本不存在。
     * 运行时真实取值请用 `BASE_PRIMARY_COLORS`（`src/ui/pages/SettingsPage.tsx`），
     * 它与 `Theme.kt` L16-22 逐字一致。
     */
    mintPrimary: '#059669',
    /** Android `BaseSecondaryColors[2]`（Theme.kt L28 `Color(0xFF10B981)` // 2: 绿）。 */
    mintSecondary: '#10B981',
    mintGold: '#E8C97A',
    darkCharcoal: '#18191C',
    mediumGray: '#61666D',
    dividerGray: '#E3E5E7',
    reader: {
      sepia: { background: '#FBF0D9', text: '#5F4B32' },
      eyeGreen: { background: '#E8F5E9', text: '#1B5E20' },
      night: { background: '#18191C', text: '#D4D4D4' },
      oled: { background: '#000000', text: '#E0E0E0' },
    },
  },
  /**
   * BUG 修正（2026-10-06，逐行对照 `ui/design/DesignTokens.kt` L40-44）：
   * 原值 `{ sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 }` 是**键名整体错位一档**——
   * `sm` 拿了 XS 的 8、`md` 拿了 SM 的 12 …… 而 Kotlin 是
   *   RadiusXs = 8.dp / RadiusSm = 12.dp / RadiusMd = 16.dp / RadiusLg = 20.dp / RadiusXl = 24.dp
   * Kotlin **没有** 圆角 XXL（24 就是 XL），原来的 `xxl: 24` 是凭空多出来的一档。
   * 现已与 Kotlin 的键名与数值逐字对齐；`src/styles/theme.css` L40-45 的
   * `--radius-xs/sm/md/lg/xl` 本来就是这个值，无需同步改。
   */
  radius: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
  },
  /**
   * 间距（DesignTokens.kt L46-52：SpaceXs 4 / SpaceSm 8 / SpaceMd 12 / SpaceLg 16 /
   * SpaceXl 20 / SpaceXxl 24 / SpacePage 16）。这里沿用 `theme.css` 的 `--space-N`
   * 编号（1..6 ↔ 4..24），数值与 Kotlin 的 Space* 一一对应；`SpacePage = 16`
   * 与 `--space-page: 16px` 同值，单列在 `DESIGN_SPEC.space.page`。
   */
  spacing: {
    '1': 4,
    '2': 8,
    '3': 12,
    '4': 16,
    '5': 20,
    '6': 24,
  },
  elevation: {
    card: 2,
    floating: 8,
  },
  /**
   * Android `GlassCard.kt` 走 `tweaks.blurRadiusDp`，出厂档在
   * `PreferencesManager.cardBlurRadiusDp`（默认 **22**）与 `theme.css`
   * `--glass-blur-content: 22px`。`ui/design/DesignTokens.kt` L35 的 KDoc 写的是
   * 「仅调整 blurRadius 24dp」，与实际默认值 22 不一致（文档滞后一档）。
   * 本 token 取 DesignTokens.kt 的字面 24；需要改请连同 KDoc 一起改。
   */
  glass: {
    tabBlur: 8,
    tabSurfaceAlpha: 0.45,
    cardBlur: 24,
    cardSurfaceAlpha: 0.78,
  },
  tab: {
    indicatorWidthPercent: 0.4,
    indicatorHeight: 3,
  },
  /**
   * Android `ui/theme/Type.kt` 的 15 个槽位（`Typography`）。
   * 完整实现见 `src/core/ui-theme/type.ts`（←Type.kt 逐行移植，附 `textStyleCss()`）；
   * 这里只保留旧调用点仍在用的 4 个尺寸，避免两处漂移。
   * ⚠️ 旧值 `headline: 28` 其实对应 `displayMedium`；`headlineLarge` 是 22。
   */
  typography: {
    /**
     * Android `ui/theme/Type.kt` 的 15 个槽位（`Typography`）。
     * 完整实现见 `src/core/ui-theme/type.ts`（←Type.kt 逐行移植，附 `textStyleCss()`）；
     * 这里只保留旧调用点仍在用的 4 个尺寸，避免两处漂移。
     * ⚠️ 旧值 `headline: 28` 其实对应 `displayMedium`；`headlineLarge` 是 22。
     * ⚠️ `title: 20` 对应的是 `headlineMedium`（Type.kt L57），**没有**叫 `title`
     *    的槽位（`titleLarge` 17 / `titleMedium` 16）。这里保留旧键名并注明来源，
     *    避免有人把它当成 titleLarge 用。
     */
    displayMedium: 28,
    headlineLarge: 22,
    title: 20, // = headlineMedium（20sp）
    body: 16,
    caption: 13,
    labelSmall: 11,
  },
  font: {
    family: {
      sans: '"Noto Sans SC", "PingFang SC", "Helvetica Neue", sans-serif',
      serif: '"Noto Serif SC", "Songti SC", Georgia, serif',
    },
    files: {
      sans: 'noto_sans_sc_regular.otf',
      serif: 'noto_serif_sc_regular.otf',
    },
  },
  motion: {
    /**
     * Android `IosMotion.kt`：`spring(dampingRatio = 0.85f, stiffness = 320f)`
     * （L46-47 `spring()`），另外两个是 `springSnappy` 0.78/520（L55-56）与
     * `springSoft` 0.90/220（L64-65）。完整表见 `src/core/ui-theme/iosMotion.ts`。
     */
    spring: {
      damping: 0.85,
      stiffness: 320,
    },
    springSnappy: { damping: 0.78, stiffness: 520 },
    springSoft: { damping: 0.9, stiffness: 220 },
    /** `Theme.kt` L42 `colorTransitionMs = 600` + L49 `tween(600, IosMotion.EaseOut)`。 */
    colorTransitionMs: 600,
  },
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;

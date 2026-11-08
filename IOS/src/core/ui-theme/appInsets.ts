/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/AppInsets.kt`
 *             (33 lines incl. trailing newline, 29 non-blank)
 *          → `src/core/ui-theme/appInsets.ts`
 *
 * WHY A DESCRIPTOR INSTEAD OF A `CompositionLocal`
 * ───────────────────────────────────────────────
 * `LocalAppBottomInset` / `LocalAppBottomInsetNoTabBar` are
 * `compositionLocalOf { 0.dp }` — ambient values a Composable reads with `.current`. There is no
 * composition and no `Dp` on the web, so both become an **explicit `AppInsetsSpec` descriptor**
 * plus a pure `resolveAppInsets(…)` function that a host (or a React context) feeds the result
 * into. The arithmetic is unchanged.
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`                        → SKIPPED (TS has no packages)
 *   L2        (blank)                                                → SKIPPED
 *   L3        `import …runtime.compositionLocalOf`                   → SKIPPED (no composition);
 *                                                                        `resolveAppInsets` replaces it
 *   L4        `import androidx.compose.ui.unit.Dp`                    → SKIPPED: a bare `number` in `px`.
 *                                                                      Android `1dp == 1px` at density
 *                                                                      1, and `values-sw*dp/` never
 *                                                                      overrides these, so `dp == px`.
 *   L5        `import androidx.compose.ui.unit.dp`                    → the same `number`
 *   L6        (blank)                                                → SKIPPED
 *   L7-19     the KDoc (底栏悬浮 / 页面自己让位 / 历史上 96、104、120、24、60
 *             .dp 去猜 / MainActivity 统一计算下发 / 页面一律改用
 *             LocalAppBottomInset.current)                          → kept verbatim on `AppInsetsSpec`
 *                                                                   and `SYSTEM_NAV_…` constants
 *   L20       `val LocalAppBottomInset: ProvidableCompositionLocal<Dp>` → `AppInsetsSpec.bottomInset`
 *   L21       `    = compositionLocalOf { 0.dp }`                    → `APP_INSETS_DEFAULT.bottomInset = 0`
 *   L22       (blank)                                                → SKIPPED
 *   L23-30    the `LocalAppBottomInsetNoTabBar` KDoc (多选态 / 拖拽态
 *             会把悬浮 Tab 栏整条藏起来；否则底部凭空多出 92dp 的空白) → kept verbatim
 *   L31       `val LocalAppBottomInsetNoTabBar: ProvidableCompositionLocal<Dp>` → `bottomInsetNoTabBar`
 *   L32       `    = compositionLocalOf { 0.dp }`                    → `= 0`
 *
 * ── The provider, from `MainActivity.kt` (NOT in `AppInsets.kt`, ported here because it is
 *    the arithmetic the file's own KDoc describes) ───────────────────────────────
 *   `MainActivity.kt` L302-307:
 *     // ── A2 底部避让唯一事实来源 ──────────────────────────
 *     // 悬浮 Tab 栏总高 = 12dp 上边距 + 68dp 栏体 + 12dp 下边距 = 92dp，
 *     // 再叠上真实系统导航栏高度（手势导航 ≈0、三键导航 ≈48dp）。
 *     // 此前各页各写 96/104/120/24/60.dp 去猜，三键导航机型必然压栏。
 *     val navBarBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
 *   L340: `LocalAppBottomInset provides (navBarBottom + 92.dp + 8.dp)`
 *   L341-343: the comment + `LocalAppBottomInsetNoTabBar provides (navBarBottom + 8.dp)`
 *   The 68 dp bar body is `--tab-bar-height: 68px` (`theme.css` L80) and the 12 dp margins are
 *   `.app-tab-bar { padding: 12px 16px }` (`theme.css` L1171), so the CSS realization of the
 *   floating pill already totals 92 px.
 *
 * ── Width class ───────────────────────────────────────────────────────────────
 *   `AppInsets.kt` has **no** width-class branch and neither does `MainActivity.kt`, so the
 *   resolved numbers are identical in COMPACT / MEDIUM / EXPANDED. The class is carried on the
 *   spec (and asserted by `tests/unit/uiThemeAppInsets.test.ts`) purely so a host can record
 *   which layout it is in; nothing here invents a per-class rule. On the web the analogue of
 *   `WindowInsets.navigationBars` is `env(safe-area-inset-bottom)`, already consumed as
 *   `var(--safe-bottom)` (`theme.css` L84).
 *
 * ── DIVERGENCE vs `src/styles/theme.css` (NOT edited here; reported to the main agent) ──
 *   · L119 `.tab-content { padding-bottom: calc(var(--tab-bar-height) + 32px + var(--safe-bottom)) }`
 *     totals **68 + 32 = 100 px**, which matches Kotlin's `92 + 8 = 100` only because the
 *     decomposition differs: CSS folds the pill's own 24 px of margin into a flat **32 px**
 *     gap, while Kotlin keeps `92` (pill + margins) and adds a separate **8 px** visual gap.
 *     Same total, different parts — anything that wants to restyle only the visual gap (rather
 *     than the pill) gets the wrong knob in CSS.
 *   · L1444 `.toast { bottom: calc(96px + var(--safe-bottom, 0px)) }` hardcodes **96 px**.
 *     96 dp is one of the four numbers `AppInsets.kt` L11-13 explicitly calls out as the bug
 *     this file exists to kill ("历史上各页各自硬编码 96 / 104 / 120 / 24 / 60.dp 去猜这个
 *     高度"), so the CSS still contains the anti-pattern the Kotlin file was written to remove.
 */

import { windowWidthClass, type WindowWidthClass } from '../glass/adaptiveSpec';

/** Re-exported so a host can pass a viewport straight through. */
export type { WindowWidthClass };

/**
 * 全 App 底部避让高度的**唯一事实来源**。
 *
 * 背景：底栏（AppBottomTabBar）是悬浮在内容之上的，页面必须自己让出底部空间。
 * 历史上各页各自硬编码 96 / 104 / 120 / 24 / 60.dp 去"猜"这个高度——
 * 手势导航（系统导航栏 ≈0）下刚好躲过，三键导航（≈48dp，小米/华为/OPPO/vivo
 * 大量用户）下则必然被压栏。
 *
 * 现在由 MainActivity 统一计算并下发：
 *   实际系统导航栏高度 + 悬浮 Tab 栏总高（含上下 12dp 边距）+ 视觉间隙。
 *
 * 页面一律改用 `resolveAppInsets(…).bottomInset`，不要再写 magic number。
 */
export interface AppInsetsSpec {
  /**
   * Kotlin L20-L21 `LocalAppBottomInset` — 系统导航栏 + 悬浮 Tab 栏总高 + 视觉间隙.
   * Composed by `MainActivity.kt` L340 as `navBarBottom + 92.dp + 8.dp`.
   */
  readonly bottomInset: number;
  /**
   * Kotlin L31-L32 `LocalAppBottomInsetNoTabBar` — = 系统导航栏 + 视觉间隙, **不含** 悬浮 Tab 栏.
   * Composed by `MainActivity.kt` L343 as `navBarBottom + 8.dp`.
   *
   * 什么时候用：书架进入多选态 / 拖拽态时，`ShelfChrome.setTabBarVisible(false)` 会把
   * 悬浮 Tab 栏整条藏起来，此时若操作栏、放置坞仍按 [LocalAppBottomInset] 让位，
   * 底部就会凭空多出 92dp 的空白 —— 实测表现为「操作栏悬在半空、放置坞的 chip
   * 被系统手势条压掉一半」。
   */
  readonly bottomInsetNoTabBar: number;
  /** The live viewport width, for hosts that want to key a memo on it. */
  readonly width: number;
  /** Which layout the numbers were resolved for; see the "Width class" note above. */
  readonly widthClass: WindowWidthClass;
  /** Whether the floating tab bar is currently on screen (Kotlin: `setTabBarVisible`). */
  readonly tabBarVisible: boolean;
  /**
   * The active value, i.e. what a page should actually pad by: Kotlin reads either local
   * depending on the chrome state, and the two differ by exactly the pill's 92 px.
   */
  readonly active: number;
}

/** Kotlin L21 / L32 `compositionLocalOf { 0.dp }` — the default before MainActivity provides. */
export const APP_INSETS_DEFAULT: AppInsetsSpec = {
  bottomInset: 0,
  bottomInsetNoTabBar: 0,
  width: 0,
  widthClass: 'COMPACT',
  tabBarVisible: true,
  active: 0,
};

/** Kotlin L21 `compositionLocalOf { 0.dp }` — the un-provided default, in isolation. */
export const INSET_DEFAULT_DP = 0;

/**
 * `MainActivity.kt` L303 — 悬浮 Tab 栏总高 = 12dp 上边距 + 68dp 栏体 + 12dp 下边距 = 92dp.
 * (`theme.css` L80 `--tab-bar-height: 68px` + L1171 `padding: 12px` above and below.)
 */
export const FLOATING_TAB_BAR_TOTAL_DP = 92;

/** `MainActivity.kt` L303 — the 12dp top margin of the floating pill. */
export const TAB_BAR_MARGIN_DP = 12;

/** `MainActivity.kt` L303 — the 68dp pill body (`theme.css` L80 `--tab-bar-height`). */
export const TAB_BAR_BODY_DP = 68;

/**
 * The 视觉间隙 (`MainActivity.kt` L340/L343) — the gap between the pill (or the operation bar)
 * and the very bottom of the safe area. NOT part of the 92 dp pill total.
 */
export const VISUAL_GAP_DP = 8;

/** The 92 dp pill total, decomposed. Asserted by the tests so the parts cannot drift apart. */
export const TAB_BAR_MARGIN_TOP_DP = TAB_BAR_MARGIN_DP;
export const TAB_BAR_MARGIN_BOTTOM_DP = TAB_BAR_MARGIN_DP;

/** `MainActivity.kt` L306 — `WindowInsets.navigationBars…calculateBottomPadding()`. */
export interface AppInsetsEnvironment {
  /**
   * `WindowInsets.navigationBars` bottom padding in dp. Gesture navigation ≈ 0, three-button
   * navigation ≈ 48. On the web pass the `env(safe-area-inset-bottom)` reading.
   */
  readonly navBarBottom: number;
  /** `LocalConfiguration.current.screenWidthDp` → `window.innerWidth`. */
  readonly width: number;
  /** `ShelfChrome.setTabBarVisible(…)` — default `true`. */
  readonly tabBarVisible?: boolean;
}

/**
 * `MainActivity.kt` L306 / L340 / L343 — the single place the numbers are composed.
 *
 * Width-class independent on both sides (see the module header): COMPACT, MEDIUM and EXPANDED
 * all produce the same two values.
 */
export function resolveAppInsets(env: AppInsetsEnvironment): AppInsetsSpec {
  const navBarBottom = env.navBarBottom;
  const bottomInset = navBarBottom + FLOATING_TAB_BAR_TOTAL_DP + VISUAL_GAP_DP;
  const bottomInsetNoTabBar = navBarBottom + VISUAL_GAP_DP;
  const tabBarVisible = env.tabBarVisible ?? true;
  return {
    bottomInset,
    bottomInsetNoTabBar,
    width: env.width,
    widthClass: windowWidthClass(env.width),
    tabBarVisible,
    active: tabBarVisible ? bottomInset : bottomInsetNoTabBar,
  };
}

/** Classify a viewport width with the M3 breakpoints already used by `adaptiveSpec.ts`. */
export function appInsetsWidthClass(width: number): WindowWidthClass {
  return windowWidthClass(width);
}

/**
 * The CSS realization, mirroring `theme.css` L119
 * `padding-bottom: calc(var(--tab-bar-height) + 32px + var(--safe-bottom))`.
 *
 * Kotlin's decomposition is `92 + 8`; the stylesheet's is `68 + 32`. Both total 100 plus the
 * safe area, but the CSS gap of 32 already swallows the pill's 24 px of margin, so the visual
 * gap alone cannot be re-tuned there. Emitted explicitly here rather than left implicit.
 */
export function appInsetsPaddingBottomCss(spec: AppInsetsSpec, safeBottomPx = 0): string {
  const chrome = spec.tabBarVisible
    ? TAB_BAR_BODY_DP + 32
    : spec.bottomInsetNoTabBar - safeBottomPx;
  return `calc(${chrome}px + ${safeBottomPx}px)`;
}

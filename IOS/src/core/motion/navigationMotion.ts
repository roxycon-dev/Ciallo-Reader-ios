/**
 * navigationMotion.ts  ←  novel-reader/app/src/main/java/com/example/ui/feedback/NavigationMotion.kt
 *                        + ui/feedback/Motion.kt (the `AppMotion` constants it reads)
 *
 * Kotlin sources:
 *   NavigationMotion.kt — 15 lines / 10 non-blank
 *   Motion.kt L23-94    — `object AppMotion` (the duration / easing constants)
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ NavigationMotion.kt                                                             │
 * │ L1-5     package + animation imports            — package decl / imports        │
 * │ L6       doc comment                            — kept verbatim                │
 * │ L7-14    `object NavigationMotion`              — ported verbatim (see below)  │
 * │                                                                                 │
 * │ Motion.kt (AppMotion)                                                           │
 * │ L1-22    package / imports / earlier members    — not referenced by this port   │
 * │ L24-27   PRESS_MS / CONTENT_MS / PAGE_MS / EXIT_MS — ported verbatim          │
 * │ L29-32   `reorder() / settle() / press()`       — springs, out of scope here    │
 * │ L33-57   springDefault … springTilt             — springs, out of scope here    │
 * │ L60      `easeSuckIn`                          — CubicBezier(0.4, 0, 1, 1)     │
 * │ L66      `easeOutCubic`                        — CubicBezier(0.215, .61, .355,1)│
 * │ L68-93   TRANSITION/HEART/…/SPRING_LOAD_MS      — not navigation durations      │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comment kept verbatim: "A paired forward/back language, kept quiet enough
 * for shared cover transitions."
 *
 * ADAPTATIONS
 * - Compose's `EnterTransition` / `ExitTransition` are *declarative specs*; the Web
 *   equivalent is a plain data object the host turns into a WAAPI / CSS animation.
 *   The port therefore returns `{ fadeMs, slideMs, slideEasing, slideFromFraction }`
 *   instead, and `App.tsx` already maps those onto `routeEnterKeyframes` /
 *   `routeEnterOptions` (`@core/app/navigation`).
 * - `fadeIn(tween(ms))` with no easing arg → Compose's default `FastOutSlowInEasing`
 *   (`CubicBezier(0.4, 0, 0.2, 1)`). Exposed as `DEFAULT_FADE_EASING` so the host
 *   can reproduce it exactly.
 * - `slideInHorizontally(tween(ms, easing)) { it / 12 }` — the lambda is the
 *   *initial offset* in px, expressed as a fraction of the full width. Kept as
 *   `slideFromFraction = 1 / 12`.
 * - `EnterTransition.None` / `ExitTransition.None` → `null`, which the host already
 *   treats as "skip the animation" (the `reduce` branch).
 * - `LocalReduceMotion.current` → the caller passes `reduce` explicitly, because
 *   `src/core` may not read the DOM (E61) and the host already resolves the media
 *   query in `App.tsx`.
 */

/* ── AppMotion constants actually used by NavigationMotion (Motion.kt L24-27, L66) ── */

/** Motion.kt L24 `const val PRESS_MS = 110`. */
export const APP_MOTION_PRESS_MS = 110;
/** Motion.kt L25 `const val CONTENT_MS = 200`. */
export const APP_MOTION_CONTENT_MS = 200;
/** Motion.kt L26 `const val PAGE_MS = 280`. */
export const APP_MOTION_PAGE_MS = 280;
/** Motion.kt L27 `const val EXIT_MS = 170`. */
export const APP_MOTION_EXIT_MS = 170;

/** Motion.kt L66 `val easeOutCubic = CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)`. */
export const EASE_OUT_CUBIC = [0.215, 0.61, 0.355, 1] as const;

/**
 * Compose's `tween()` default easing — `FastOutSlowInEasing` =
 * `CubicBezierEasing(0.4f, 0.0f, 0.2f, 1f)`. `fadeIn(tween(ms))` / `fadeOut(tween(ms))`
 * pass no easing, so this is what they use.
 */
export const DEFAULT_TWEEN_EASING = [0.4, 0, 0.2, 1] as const;

/** `slideInHorizontally(tween(220)) { it / 12 }` — the literal divisor. */
export const NAV_SLIDE_FRACTION = 1 / 12;

/** One side of a paired transition: fade + optional horizontal slide. */
export interface NavTransitionSpec {
  readonly fadeMs: number;
  readonly fadeEasing: readonly [number, number, number, number];
  /** `null` when the Kotlin spec has no slide component. */
  readonly slideMs: number | null;
  readonly slideEasing: readonly [number, number, number, number] | null;
  /** Initial horizontal offset as a fraction of the element width. */
  readonly slideFromFraction: number | null;
}

/** `EnterTransition.None` / `ExitTransition.None`. */
export const NO_NAV_TRANSITION = null;

/**
 * Kotlin L8-9 `fun enter(reduce)`:
 *   `if (reduce) EnterTransition.None else
 *      fadeIn(tween(AppMotion.CONTENT_MS)) + slideInHorizontally(tween(AppMotion.PAGE_MS, easing = AppMotion.easeOutCubic)) { it / 12 }`
 */
export function navigationEnter(reduce: boolean): NavTransitionSpec | null {
  if (reduce) return NO_NAV_TRANSITION;
  return {
    fadeMs: APP_MOTION_CONTENT_MS,
    fadeEasing: DEFAULT_TWEEN_EASING,
    slideMs: APP_MOTION_PAGE_MS,
    slideEasing: EASE_OUT_CUBIC,
    slideFromFraction: NAV_SLIDE_FRACTION,
  };
}

/** Kotlin L10 `fun leave(reduce)`: `if (reduce) None else fadeOut(tween(140))`. */
export function navigationLeave(reduce: boolean): NavTransitionSpec | null {
  if (reduce) return NO_NAV_TRANSITION;
  // ⚠️ 140 是**字面量**，不是 AppMotion 的某个常量 —— 逐值照抄。
  return {
    fadeMs: 140,
    fadeEasing: DEFAULT_TWEEN_EASING,
    slideMs: null,
    slideEasing: null,
    slideFromFraction: null,
  };
}

/** Kotlin L11 `fun returnEnter(reduce)`: `if (reduce) None else fadeIn(tween(180))`. */
export function navigationReturnEnter(reduce: boolean): NavTransitionSpec | null {
  if (reduce) return NO_NAV_TRANSITION;
  // ⚠️ 180 同样是字面量。
  return {
    fadeMs: 180,
    fadeEasing: DEFAULT_TWEEN_EASING,
    slideMs: null,
    slideEasing: null,
    slideFromFraction: null,
  };
}

/**
 * Kotlin L12-13 `fun returnLeave(reduce)`:
 *   `if (reduce) None else fadeOut(tween(AppMotion.EXIT_MS)) +
 *      slideOutHorizontally(tween(220, easing = AppMotion.easeOutCubic)) { it / 12 }`
 */
export function navigationReturnLeave(reduce: boolean): NavTransitionSpec | null {
  if (reduce) return NO_NAV_TRANSITION;
  // ⚠️ 220 是字面量（与 PAGE_MS 的 280 不同，别合并）。
  return {
    fadeMs: APP_MOTION_EXIT_MS,
    fadeEasing: DEFAULT_TWEEN_EASING,
    slideMs: 220,
    slideEasing: EASE_OUT_CUBIC,
    slideFromFraction: NAV_SLIDE_FRACTION,
  };
}

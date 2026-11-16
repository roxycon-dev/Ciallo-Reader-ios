/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/IosMotion.kt`
 *             (80 lines incl. trailing newline, 69 non-blank)
 *          → `src/core/ui-theme/iosMotion.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`                  → SKIPPED (TS has no packages)
 *   L2        (blank)                                          → SKIPPED
 *   L3        `import …core.CubicBezierEasing`                → `IOS_EASINGS.EaseOut` control points
 *   L4        `import …core.Easing`                           → `Easing` (`{ x1, y1, x2, y2 }`)
 *   L5        `import …core.SpringSpec`                        → `SpringSpec` descriptor
 *   L6        `import …core.spring`                            → `spring()`, `springSnappy()`,
 *                                                               `springSoft()`
 *   L7        `import …core.tween`                              → `TweenSpec` + `easeOut()` etc.
 *   L8        `import …core.FiniteAnimationSpec`                → `TweenSpec` (a finite spec)
 *   L9        (blank)                                          → SKIPPED
 *   L10-20    the KDoc (why Material's linear tweens read       → kept verbatim (comments only);
 *              "慢、钝、橡皮筋", the three SwiftUI traits, and      the "用法" line names the two
 *              the `用法： animationSpec = IosMotion.spring()`)  → resolver functions below
 *   L21       `object IosMotion {`                             → `IOS_MOTION` + the exported consts
 *   L22       (blank)                                          → SKIPPED
 *   L23       `// ── 时长（毫秒），对齐 iOS 常见档位 ──`          → kept verbatim
 *   L24       KDoc  即时反馈：按压、高亮、小图标切换            → kept verbatim on `FAST`
 *   L25       `const val FAST = 150`                           → `IOS_MOTION.FAST`
 *   L26       KDoc  常规：内容淡入淡出、行内展开收起            → kept verbatim on `NORMAL`
 *   L27       `const val NORMAL = 250`                         → `IOS_MOTION.NORMAL`
 *   L28       KDoc  页面/视图转场                             → kept verbatim on `TRANSITION`
 *   L29       `const val TRANSITION = 350`                     → `IOS_MOTION.TRANSITION`
 *   L30       KDoc  Sheet / 弹窗进出场                         → kept verbatim on `SHEET`
 *   L31       `const val SHEET = 400`                          → `IOS_MOTION.SHEET`
 *   L32       (blank)                                          → SKIPPED
 *   L33       `// ── 缓动曲线（与 iOS CAMediaTimingFunction 对应）──` → kept verbatim
 *   L34       KDoc  easeOut：起步快、尾部缓 —— iOS 默认出场曲线  → kept verbatim on `EaseOut`
 *   L35       `val EaseOut: Easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)` → `IOS_EASINGS.EaseOut`
 *   L36       KDoc  easeInOut：对称缓动，用于同一元素的位置迁移  → kept verbatim
 *   L37       `val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)` → `IOS_EASINGS.EaseInOut`
 *   L38       KDoc  easeOutQuart：更陡的尾部衰减，Sheet 上推、大位移用  → kept verbatim
 *   L39       `val EaseOutQuart = CubicBezierEasing(0.25f, 1f, 0.5f, 1f)` → `IOS_EASINGS.EaseOutQuart`
 *   L40       (blank)                                          → SKIPPED
 *   L41-44    the `spring()` KDoc (`.spring(response: 0.35,     → kept verbatim
 *             dampingFraction: 0.85)`)                        → the two numbers are on the spec
 *   L45       `fun <T> spring(): SpringSpec<T>`                → `spring()`
 *   L46       `dampingRatio = 0.85f`                           → `SPRING.dampingRatio`
 *   L47       `stiffness = 320f`                               → `SPRING.stiffness`
 *   L48       `}`                                              → n/a
 *   L49       (blank)                                          → SKIPPED
 *   L50-53    the `springSnappy()` KDoc (response ≈ 0.25)      → kept verbatim
 *   L54       `fun <T> springSnappy(): SpringSpec<T>`          → `springSnappy()`
 *   L55       `dampingRatio = 0.78f`                           → `SPRING_SNAPPY.dampingRatio`
 *   L56       `stiffness = 520f`                               → `SPRING_SNAPPY.stiffness`
 *   L57       `}`                                              → n/a
 *   L58       (blank)                                          → SKIPPED
 *   L59-62    the `springSoft()` KDoc (response ≈ 0.5)         → kept verbatim
 *   L63       `fun <T> springSoft(): SpringSpec<T>`             → `springSoft()`
 *   L64       `dampingRatio = 0.90f`                           → `SPRING_SOFT.dampingRatio`
 *   L65       `stiffness = 220f`                               → `SPRING_SOFT.stiffness`
 *   L66       `}`                                              → n/a
 *   L67       (blank)                                          → SKIPPED
 *   L68       KDoc  easeOut 补间，[duration] 默认 250ms        → kept verbatim on `easeOut`
 *   L69       `fun <T> easeOut(duration: Int = NORMAL): FiniteAnimationSpec<T>`
 *                                                              → `easeOut(duration = NORMAL)`
 *   L70       `tween(durationMillis = duration, easing = EaseOut)` → `TweenSpec`
 *   L71       (blank)                                          → SKIPPED
 *   L72       KDoc  easeInOut 补间                            → kept verbatim on `easeInOut`
 *   L73       `fun <T> easeInOut(duration: Int = NORMAL)`      → `easeInOut(duration = NORMAL)`
 *   L74       `tween(durationMillis = duration, easing = EaseInOut)` → `TweenSpec`
 *   L75       (blank)                                          → SKIPPED
 *   L76       KDoc  easeOutQuart 补间，用于 Sheet / 大位移     → kept verbatim on `easeOutQuart`
 *   L77       `fun <T> easeOutQuart(duration: Int = SHEET)`    → `easeOutQuart(duration = SHEET)`
 *   L78       `tween(durationMillis = duration, easing = EaseOutQuart)` → `TweenSpec`
 *   L79       `}`                                              → n/a
 *
 * ── ADAPTATION — Compose `SpringSpec` / `FiniteAnimationSpec` → plain descriptors ──
 * There is no `Modifier` and no Compose animation runtime on the web, so every `IosMotion`
 * member becomes a **framework-agnostic descriptor**:
 *   - a `TweenSpec` carries `{ durationMillis, easing, css }` — enough for
 *     `transition: <duration>ms <easing>` / `animation: …` / the Web Animations API;
 *   - a `SpringSpec` carries the verbatim `{ dampingRatio, stiffness }` pair (the Kotlin
 *     numbers, unrounded, so a JS spring solver can reproduce the motion exactly), PLUS a
 *     derived CSS duration and a fitted `cubic-bezier` for hosts that can only do CSS
 *     transitions.
 *
 * `settleMs` uses the same closed form already established by `src/core/glass/motion.ts` L41-43:
 *   t ≈ -ln(0.01) / (ζ·ω) = 4.605 / (dampingRatio · √stiffness)
 * The `cubic-bezier` fits are the ones this repo already documented for these three springs
 * (`src/core/glass/motion.ts` L58-63 maps `IosMotion.spring()` to `cubic-bezier(0.25,1,0.5,1)`
 * and L255-259 maps `springSoft()` to `cubic-bezier(0.32,0.72,0,1)`); `springSnappy()` shares
 * `springSettle`'s ζ=0.78 fit, `cubic-bezier(0.16,1,0.3,1)` (L97-103).
 *
 * ── DIVERGENCE vs `src/ui/theme/tokens.ts` (NOT edited here; reported to the main agent) ──
 *   `tokens.ts` L106-115 `MOTION` has `fast/normal/transition/sheet` = 150/250/350/400 ✓ all
 *   four match, and `easeOut/easeInOut/easeOutQuart` = the three cubic-beziers ✓ all match. Two
 *   things are missing there and one is extra:
 *     · **MISSING** — `MOTION` carries no spring at all. `IosMotion.spring()` (0.85/320),
 *       `springSnappy()` (0.78/520) and `springSoft()` (0.90/220) have no counterpart.
 *       `DESIGN_TOKENS.motion.spring` (`src/ui/tokens.ts` L70-73) does hold `{ damping: 0.85,
 *       stiffness: 320 }`, i.e. only `spring()`, under different key names.
 *     · EXTRA   — `MOTION.headerCollapse = 220` and `theme.css` L73
 *       `--motion-header-collapse: 220ms` have **no source in `IosMotion.kt`**. The 220 that
 *       does exist here is the `Modifier.animateAlpha` default (`ModifierExtensions.kt` L141).
 *   Theme.kt L42's `colorTransitionMs = 600` is likewise absent from both (see `theme.ts`).
 *
 * ── DIVERGENCE vs `src/styles/theme.css` (NOT edited here; reported to the main agent) ──
 *   L70-75 define `--motion-fast/normal/transition/header-collapse` + `--ease-out` +
 *   `--ease-out-quart`. Missing: **`--motion-sheet: 400ms`** and **`--ease-in-out`**.
 */

/** Kotlin L4 `androidx.compose.animation.core.Easing`. */
export interface Easing {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** The `cubic-bezier(...)` string for an `Easing`. */
export function easingCss(easing: Easing): string {
  return `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`;
}

/** Kotlin L7 `FiniteAnimationSpec<T>` produced by `tween(…)`. */
export interface TweenSpec {
  readonly durationMillis: number;
  readonly easing: Easing;
  /** `<duration>ms cubic-bezier(…)` — paste straight into `transition` / `animation`. */
  readonly css: string;
}

export const IOS_MOTION = {
  /** 即时反馈：按压、高亮、小图标切换 */
  FAST: 150,
  /** 常规：内容淡入淡出、行内展开收起 */
  NORMAL: 250,
  /** 页面/视图转场 */
  TRANSITION: 350,
  /** Sheet / 弹窗进出场 */
  SHEET: 400,
} as const;

export const IOS_EASINGS = {
  /** easeOut：起步快、尾部缓 —— iOS 默认出场曲线 */
  EaseOut: { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  /** easeInOut：对称缓动，用于同一元素的位置迁移 */
  EaseInOut: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  /** easeOutQuart：更陡的尾部衰减，Sheet 上推、大位移用 */
  EaseOutQuart: { x1: 0.25, y1: 1, x2: 0.5, y2: 1 },
} as const satisfies Record<string, Easing>;

/** The literal CSS strings, matching `src/ui/theme/tokens.ts` L112-114 verbatim. */
export const IOS_EASING_CSS = {
  easeOut: easingCss(IOS_EASINGS.EaseOut),
  easeInOut: easingCss(IOS_EASINGS.EaseInOut),
  easeOutQuart: easingCss(IOS_EASINGS.EaseOutQuart),
} as const;

/** Kotlin L5 `SpringSpec<T>`. */
export interface SpringSpec {
  /** Kotlin `dampingRatio = …f` — verbatim, not rounded. */
  readonly dampingRatio: number;
  /** Kotlin `stiffness = …f` — verbatim, not rounded. */
  readonly stiffness: number;
  /**
   * Analytic settle time, `t ≈ 4.605 / (ζ·√k)` seconds (same closed form as
   * `src/core/glass/motion.ts` L41-43), in ms. Use as the CSS transition duration.
   */
  readonly settleMs: number;
  /** Fitted CSS `cubic-bezier` standing in for the spring (see the header note). */
  readonly bezier: string;
  /** `settleMs` + `bezier` as one CSS timing string. */
  readonly css: string;
}

/** Kotlin L41-44 — `t ≈ -ln(0.01) / (ζ·ω) = 4.605 / (dampingRatio · √stiffness)`. */
export function springSettleMs(dampingRatio: number, stiffness: number): number {
  return Math.round((4.605 / (dampingRatio * Math.sqrt(stiffness))) * 1000);
}

function springSpec(
  dampingRatio: number,
  stiffness: number,
  bezier: string,
): SpringSpec {
  const settleMs = springSettleMs(dampingRatio, stiffness);
  return {
    dampingRatio,
    stiffness,
    settleMs,
    bezier,
    css: `${settleMs}ms ${bezier}`,
  };
}

/** Kotlin L45-L48 — the hoisted constant behind `spring()`. */
export const SPRING: SpringSpec = springSpec(0.85, 320, 'cubic-bezier(0.25, 1, 0.5, 1)');

/** Kotlin L54-L57 — the hoisted constant behind `springSnappy()`. */
export const SPRING_SNAPPY: SpringSpec = springSpec(0.78, 520, 'cubic-bezier(0.16, 1, 0.3, 1)');

/** Kotlin L63-L66 — the hoisted constant behind `springSoft()`. */
export const SPRING_SOFT: SpringSpec = springSpec(0.9, 220, 'cubic-bezier(0.32, 0.72, 0, 1)');

/**
 * iOS 标准弹簧（对应 `.spring(response: 0.35, dampingFraction: 0.85)`）。
 * 临界阻尼附近：不弹跳，收尾干脆。适合弹窗、卡片、尺寸变化。
 */
export function spring(): SpringSpec {
  return SPRING;
}

/**
 * 更灵敏的弹簧（response ≈ 0.25）。适合按压反馈、开关、小控件，
 * 手感“跟手”而不拖沓。
 */
export function springSnappy(): SpringSpec {
  return SPRING_SNAPPY;
}

/**
 * 偏软的弹簧（response ≈ 0.5）。适合大位移 / 整页转场，
 * 位移大时需要更长的收敛时间才不会显得生硬。
 */
export function springSoft(): SpringSpec {
  return SPRING_SOFT;
}

/** easeOut 补间，[duration] 默认 250ms */
export function easeOut(duration: number = IOS_MOTION.NORMAL): TweenSpec {
  return tween(duration, IOS_EASINGS.EaseOut);
}

/** easeInOut 补间 */
export function easeInOut(duration: number = IOS_MOTION.NORMAL): TweenSpec {
  return tween(duration, IOS_EASINGS.EaseInOut);
}

/** easeOutQuart 补间，用于 Sheet / 大位移 */
export function easeOutQuart(duration: number = IOS_MOTION.SHEET): TweenSpec {
  return tween(duration, IOS_EASINGS.EaseOutQuart);
}

function tween(durationMillis: number, easing: Easing): TweenSpec {
  return {
    durationMillis,
    easing,
    css: `${durationMillis}ms ${easingCss(easing)}`,
  };
}

/**
 * 用法： `animationSpec = IosMotion.spring()` / `IosMotion.easeOut(220)`.
 * On the web that becomes `transition: ${IOS_MOTION.springs.spring().css}` (or the
 * `TweenSpec.css` of `IOS_MOTION.easeOut(220)`).
 */
export const IOS_MOTION_USAGE = {
  spring: SPRING.css,
  springSnappy: SPRING_SNAPPY.css,
  springSoft: SPRING_SOFT.css,
  easeOut220: easeOut(220).css,
} as const;

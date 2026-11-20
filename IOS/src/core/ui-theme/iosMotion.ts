/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/IosMotion.kt`
 *             (71 lines, 60 non-blank)
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
 *   L26       `const val FAST = AppMotion.PRESS_MS`（= 110）    → `IOS_MOTION.FAST`
 *   L26       KDoc  常规：内容淡入淡出、行内展开收起            → kept verbatim on `NORMAL`
 *   L28       `const val NORMAL = AppMotion.CONTENT_MS`（= 200） → `IOS_MOTION.NORMAL`
 *   L28       KDoc  页面/视图转场                             → kept verbatim on `TRANSITION`
 *   L30       `const val TRANSITION = AppMotion.PAGE_MS`（= 280） → `IOS_MOTION.TRANSITION`
 *   L30       KDoc  Sheet / 弹窗进出场                         → kept verbatim on `SHEET`
 *   L32       `const val SHEET = AppMotion.PAGE_MS`（= 280）     → `IOS_MOTION.SHEET`
 *   L32       (blank)                                          → SKIPPED
 *   L33       `// ── 缓动曲线（与 iOS CAMediaTimingFunction 对应）──` → kept verbatim
 *   L34       KDoc  easeOut：起步快、尾部缓 —— iOS 默认出场曲线  → kept verbatim on `EaseOut`
 *   L36       `val EaseOut: Easing = AppMotion.easeOutCubic`（= 0.215/0.61/0.355/1） → `IOS_EASINGS.EaseOut`
 *   L36       KDoc  easeInOut：对称缓动，用于同一元素的位置迁移  → kept verbatim
 *   L37       `val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)` → `IOS_EASINGS.EaseInOut`
 *   L38       KDoc  easeOutQuart：更陡的尾部衰减，Sheet 上推、大位移用  → kept verbatim
 *   L39       `val EaseOutQuart = CubicBezierEasing(0.25f, 1f, 0.5f, 1f)` → `IOS_EASINGS.EaseOutQuart`
 *   L40       (blank)                                          → SKIPPED
 *   L41-44    the `spring()` KDoc (`.spring(response: 0.35,     → kept verbatim
 *             dampingFraction: 0.85)`)                        → the two numbers are on the spec
 *   L45       `fun <T> spring(): SpringSpec<T>`                → `spring()`
 *   L46       `fun <T> spring() = AppMotion.settle()`（ζ=1, k=420） → `SPRING`
 *   （Kotlin 不再内联 ζ/k，全部转发给 `AppMotion`：settle / press / reorder）
 *   L48       `}`                                              → n/a
 *   L49       (blank)                                          → SKIPPED
 *   L50-53    the `springSnappy()` KDoc (response ≈ 0.25)      → kept verbatim
 *   L54       `fun <T> springSnappy(): SpringSpec<T>`          → `springSnappy()`
 *   L52       `fun <T> springSnappy() = AppMotion.press()`（ζ=0.85, k=650） → `SPRING_SNAPPY`
 *   （同上：数值来自 `Motion.kt` L33-34，不再由 IosMotion 自带）
 *   L57       `}`                                              → n/a
 *   L58       (blank)                                          → SKIPPED
 *   L59-62    the `springSoft()` KDoc (response ≈ 0.5)         → kept verbatim
 *   L63       `fun <T> springSoft(): SpringSpec<T>`             → `springSoft()`
 *   L58       `fun <T> springSoft() = AppMotion.reorder()`（ζ=0.88, k=210） → `SPRING_SOFT`
 *   （同上）
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
 * ── 2026-11-17 逐行复核：整块数值已过期（E184） ────────────────────────────────
 * 端口此前基于 **80 行**版本，四个时长与 `EaseOut`、三个弹簧全部是旧值：
 *
 * | 成员 | 旧端口 | 当前 Kotlin |
 * |---|---|---|
 * | `FAST` | 150 | `AppMotion.PRESS_MS` = **110** |
 * | `NORMAL` | 250 | `AppMotion.CONTENT_MS` = **200** |
 * | `TRANSITION` | 350 | `AppMotion.PAGE_MS` = **280** |
 * | `SHEET` | 400 | `AppMotion.PAGE_MS` = **280**（与 TRANSITION 同值） |
 * | `EaseOut` | `(0, 0, 0.58, 1)` | `AppMotion.easeOutCubic` = **(0.215, 0.61, 0.355, 1)** |
 * | `spring()` | 0.85 / 320 | `AppMotion.settle()` = **(1, 420)** |
 * | `springSnappy()` | 0.78 / 520 | `AppMotion.press()` = **(0.85, 650)** |
 * | `springSoft()` | 0.90 / 220 | `AppMotion.reorder()` = **(0.88, 210)** |
 *
 * 影响面不是「文档不同步」而是**全站动效**：`theme.css` 的 `--motion-fast/normal/transition`、
 * `--ease-out` 与 69 处 `MOTION.*` 调用都读这四个值与这条曲线。
 * 本轮已同步 `theme.css`、`src/ui/theme/tokens.ts` 与 `src/ui/tokens.ts`。
 *
 * 注意 `spring()` 现在是**临界阻尼**（ζ=1，无过冲），`settleMs` 由同一闭式算出：
 * `4.605 / (1 · √420)` = **225 ms**；`press` = 212 ms；`reorder` = 361 ms。
 * `bezier` 仍是 CSS 代餐（Web 侧没有弹簧求解器时的降级），不冒充 Kotlin 数值。
 * * ── ADAPTATION — Compose `SpringSpec` / `FiniteAnimationSpec` → plain descriptors ──
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
 *   `--ease-out-quart`. Missing: **`--motion-sheet: 280ms`** and **`--ease-in-out`**.
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
  /** 即时反馈：按压、高亮、小图标切换 —— `AppMotion.PRESS_MS` */
  FAST: 110,
  /** 常规：内容淡入淡出、行内展开收起 —— `AppMotion.CONTENT_MS` */
  NORMAL: 200,
  /** 页面/视图转场 —— `AppMotion.PAGE_MS` */
  TRANSITION: 280,
  /** Sheet / 弹窗进出场 —— 与 TRANSITION 同值（都是 `PAGE_MS`） */
  SHEET: 280,
} as const;

export const IOS_EASINGS = {
  /** easeOut：起步快、尾部缓 —— iOS 默认出场曲线（`AppMotion.easeOutCubic`） */
  EaseOut: { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 },
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

/** Kotlin L46 `spring() = AppMotion.settle()` —— ζ=1（临界阻尼）、k=420。 */
export const SPRING: SpringSpec = springSpec(1, 420, 'cubic-bezier(0.25, 0.1, 0.25, 1)');

/** Kotlin L52 `springSnappy() = AppMotion.press()` —— ζ=0.85、k=650。 */
export const SPRING_SNAPPY: SpringSpec = springSpec(0.85, 650, 'cubic-bezier(0.16, 1, 0.3, 1)');

/** Kotlin L58 `springSoft() = AppMotion.reorder()` —— ζ=0.88、k=210。 */
export const SPRING_SOFT: SpringSpec = springSpec(0.88, 210, 'cubic-bezier(0.32, 0.72, 0, 1)');

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

/**
 * 神回动效数值层 —— Android `god/GodMotion.kt` 的**弹簧与缓动**逐值移植。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodMotion.kt`，191 行 / 147 非空）：
 *   - 34   `spring(dampingRatio = 0.72f, stiffness = 380f)`  → `GOD_SPRING_SPECS.main`
 *   - 37   `spring(dampingRatio = 0.85f, stiffness = 520f)`  → `GOD_SPRING_SPECS.light`
 *   - 40   `spring(dampingRatio = 0.90f, stiffness = 220f)`  → `GOD_SPRING_SPECS.soft`
 *   - 43   `spring(dampingRatio = 0.55f, stiffness = 260f)`  → `GOD_SPRING_SPECS.bouncy`
 *   - 46-49 `FAST_MS 180 / NORMAL_MS 260 / SLOW_MS 380 / SHEET_MS 420` → 见下「时长」段
 *   - 52   `STAGGER_MS = 60`                                → `GOD_STAGGER_MS`（`GodMotionSheet.tsx` 用）
 *   - 54   `SWING_STAGGER_MS = 60`                          → **全 Android 树零调用方**（见文件尾）
 *   - 57   `BREATH_MS = 3200`                               → 同上，零调用方
 *   - 59   `SHINE_MS = 2600`                                → `GOD_SHINE_MS`
 *   - 61   `VINYL_SPIN_MS = 6000`                           → 同上，零调用方
 *   - 63   `BORDER_SWEEP_MS = 4200`                         → `@core/god/godChapterCard.GOD_BORDER_SWEEP_MS`
 *   - 65-67 `fast() = tween(FAST_MS)` / `normal()` / `slow()` → `GOD_FAST_MS/NORMAL_MS/SLOW_MS`
 *   - 70-72 `SHEET_CORNER 28 / CARD_CORNER 18 / BUTTON_CORNER 14` → 同名常量
 *   - 76/78 `PULL_THRESHOLD_DP 96f` / `PULL_DAMPING 0.55f`  → `@core/god/godPull`（已端口）
 *   - 81-82 `PRESS_SCALE 0.96f` / `PRESS_ALPHA 0.92f`       → `GOD_PRESS_SCALE` / `GOD_PRESS_ALPHA`
 *   - 164-165 `godSpec(reduce, spec) = if (reduce) tween(120) else spec()` → `GOD_REDUCE_TWEEN_MS`
 *   - 191  `staggerDelay(index, base) = base + index * STAGGER_MS` → `godStaggerDelay()`
 *
 * ── 缓动 ──────────────────────────────────────────────────────────────
 * god 模块里 Compose 只用两种缓动：
 *   ① `LinearEasing`（GodChapterCard L98 / GodRankingShared L249 /
 *      GodMomentSheet L618/L626/L1189/L1321）→ CSS `linear`，**逐点等价**；
 *   ② `tween(n)` 的**默认缓动** `FastOutSlowInEasing` = `CubicBezierEasing(0.4f, 0f, 0.2f, 1f)`
 *      （GodChapterCard L88 / GodMomentSheet L720 / GodStarRating L156-159 / GodPull L181 / L302）。
 *      → `GOD_FAST_OUT_SLOW_IN_CSS` / `godFastOutSlowIn()`。
 * ⚠️ 本仓库此前把「tween + FastOutSlowIn」写成了弹簧近似的 `cubic-bezier(0.3, 1.05, 0.5, 1)`
 *    （`god-hint-in` / `god-sheet__block` / `god-rate__score` / `god-chip` / `god-shine`），
 *    那是**弹簧**曲线，与 tween 不是同一条。本次在**组件内联样式**处改回 FastOutSlowIn
 *    （属于本模块文件）；写在 `src/styles/god.css` 里的几处见 `docs/PARITY_EXCEPTIONS.md` 新登记条。
 *
 * ── 弹簧 ──────────────────────────────────────────────────────────────
 * Compose `spring()` = `SpringSimulation(mass = 1f, stiffness = k, dampingRatio = ζ)`，
 * 欠阻尼（ζ < 1，四条规格全部满足）时的**解析解**：
 *
 *     ω0 = √k,  ωd = ω0·√(1 − ζ²)
 *     x(t) = 1 − e^(−ζω0·t) · [ cos(ωd·t) + (ζω0/ωd)·sin(ωd·t) ]
 *
 * 与 `androidx.compose.animation.core.SpringSimulation.analyticValueAtTime()` 的
 * 欠阻尼分支逐字同构（Compose 写的是 `1 − dampingExp·(oscillation + dampingRatio·sin/√(1−ζ²))`，
 * 其中 `oscillation = cos(√(1−ζ²)·ω0·t)` —— 把 ζ/√(1−ζ²) 换成 ζω0/ωd 就是上式）。
 * `godSpringDisplacement()` 就是它，`tests/unit/godEasing.test.ts` 把关键时间点的位移钉死。
 *
 * CSS 侧用**单条 cubic-bezier 拟合**这条解析曲线（一条三次贝塞尔只能过冲一次，
 * 复现不了第二次反向振荡 —— 残差见 `docs/PARITY_EXCEPTIONS.md`）。控制点由
 * 数值最小二乘拟合得到，`GOD_SPRING_*_CSS` 的字符串保持原样，**只有控制点数值更新**：
 *
 *   规格   阻尼/刚度            Compose 峰值过冲 @ 时刻    CSS 峰值过冲 @ 时刻   最大 |误差|
 *   main   0.72 / 380         3.84% @ 232ms            4.01% @ 267ms          0.032
 *   light  0.85 / 520         0.63% @ 262ms            0.72% @ 232ms          0.011
 *   soft   0.90 / 220         0.15% @ 486ms            0.70% @ 406ms          0.011
 *   bouncy 0.55 / 260         12.63% @ 233ms           10.34% @ 251ms         0.042
 *
 * （改动前：`cubic-bezier(0.34,1.3,0.64,1)` 过冲 2.99%@256ms、最大误差 0.151；
 *   `cubic-bezier(0.28,1.45,0.5,1)` 过冲 6.60%@222ms、最大误差 0.285 —— 误差大 4~7 倍。）
 *
 * 时长沿用原值（380 / 260 / 460 / 420ms）。按 Compose 的静止判据
 * （|x−1| ≤ 0.01 且 |v| ≤ 0.1）真实静止时间是 main 395ms / light 245ms /
 * soft 395ms / bouncy 595ms，CSS 时长与之相差在 ±15% 内（bouncy 因为省略了第二次振荡而更短）。
 *
 * 本文件是 `src/core`，不 import React / DOM / Capacitor。
 */

/* ══════════════ 时长 / 尺寸（GodMotion.kt L46-72） ══════════════ */

/** `FAST_MS = 180`（GodMotion.kt L46）→ `fast()` = `tween(FAST_MS)`。 */
export const GOD_FAST_MS = 180;
/** `NORMAL_MS = 260`（L47）→ `normal()`。 */
export const GOD_NORMAL_MS = 260;
/** `SLOW_MS = 380`（L48）→ `slow()`。 */
export const GOD_SLOW_MS = 380;
/** `SHEET_MS = 420`（L49）。Android 侧 `GodMomentSheet` 未直接引用（走 BottomSheetEntrance）。 */
export const GOD_SHEET_MS = 420;
/** `STAGGER_MS = 60`（L52）→ `staggerDelay()`（L191）。 */
export const GOD_STAGGER_MS = 60;
/** `SHINE_MS = 2600`（L59）→ `GodMomentSheet.kt` L618（标题流光）/ L1189（按钮扫光）。 */
export const GOD_SHINE_MS = 2600;
/** `SHEET_CORNER = 28f`（L70）→ `GodMomentSheet.kt` L406-407 顶角圆角。 */
export const GOD_SHEET_CORNER = 28;
/** `CARD_CORNER = 18f`（L71）→ `GodChapterCard.kt` L76 / L183。 */
export const GOD_CARD_CORNER = 18;
/** `BUTTON_CORNER = 14f`（L72）→ `GodMomentSheet.kt` L1193 `GodShineButton` 圆角。 */
export const GOD_BUTTON_CORNER = 14;
/** `PRESS_SCALE = 0.96f`（L81）→ `Modifier.godPress`（L171-188）缩放。 */
export const GOD_PRESS_SCALE = 0.96;
/** `PRESS_ALPHA = 0.92f`（L82）→ `Modifier.godPress` 按压时 alpha。 */
export const GOD_PRESS_ALPHA = 0.92;
/** `godSpec(reduce, …)` 的降级时长 `tween(120)`（L164-165）。 */
export const GOD_REDUCE_TWEEN_MS = 120;

/**
 * `staggerDelay(index, base)`（GodMotion.kt L191）：`base + index * STAGGER_MS`。
 *
 * 调用点 `GodMomentSheet.kt:714` 用的是 `staggerDelay(index, 60)`（base = 60）。
 */
export function godStaggerDelay(index: number, base = 0): number {
  return base + index * GOD_STAGGER_MS;
}

/* ══════════════ 缓动 ══════════════ */

/** `LinearEasing` → CSS `linear`（逐点等价）。 */
export const GOD_EASE_LINEAR = 'linear';

/**
 * Compose `FastOutSlowInEasing` = `CubicBezierEasing(0.4f, 0f, 0.2f, 1f)`
 * —— `tween(n)` 的默认缓动。CSS `cubic-bezier(0.4, 0, 0.2, 1)` 与之逐点等价。
 */
export const GOD_FAST_OUT_SLOW_IN_CSS = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * `FastOutSlowInEasing.transform(fraction)` 的数值等价（0..1 → 0..1）。
 *
 * 用途：把 Kotlin 的 `tween(n)`（默认缓动）搬进 JS 逐帧循环时，
 * 帧内的进度必须先过这条曲线（`GodStarRatingEditable.tsx` 的 `GodSparks` 就是这种情形）。
 *
 * 控制点 `CubicBezierEasing(0.4f, 0f, 0.2f, 1f)`（Compose `FastOutSlowInEasing`）。
 */
export function godFastOutSlowIn(fraction: number): number {
  if (!Number.isFinite(fraction)) return 1;
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 1;
  return godCubicBezierAt([0.4, 0, 0.2, 1], fraction);
}

/* ══════════════ 弹簧 ══════════════ */

export type GodSpringKey = 'main' | 'light' | 'soft' | 'bouncy';

export interface GodSpringSpec {
  /** Kotlin `dampingRatio`。 */
  dampingRatio: number;
  /** Kotlin `stiffness`。 */
  stiffness: number;
  /** Compose 质量，`SpringSimulation` 默认 1f。 */
  mass: number;
  /** CSS 过渡时长（ms）—— 沿用原值，见文件头对照表。 */
  durationMs: number;
  /** CSS `cubic-bezier` 控制点（对 Compose 解析解的最小二乘拟合）。 */
  controlPoints: readonly [number, number, number, number];
}

const SPRING_MASS = 1;

/** GodMotion.kt L34 / L37 / L40 / L43 —— 四条 `SpringSpec` 的逐值记录。 */
export const GOD_SPRING_SPECS: Readonly<Record<GodSpringKey, GodSpringSpec>> = {
  main: {
    dampingRatio: 0.72,
    stiffness: 380,
    mass: SPRING_MASS,
    durationMs: 380,
    controlPoints: [0.342, 0.554, 0.107, 1.21],
  },
  light: {
    dampingRatio: 0.85,
    stiffness: 520,
    mass: SPRING_MASS,
    durationMs: 260,
    controlPoints: [0.241, 0.161, 0.244, 1.098],
  },
  soft: {
    dampingRatio: 0.9,
    stiffness: 220,
    mass: SPRING_MASS,
    durationMs: 460,
    controlPoints: [0.232, 0.181, 0.169, 1.096],
  },
  bouncy: {
    dampingRatio: 0.55,
    stiffness: 260,
    mass: SPRING_MASS,
    durationMs: 420,
    controlPoints: [0.414, 0.708, 0.107, 1.363],
  },
};

function omega(spec: GodSpringSpec): { w0: number; wd: number } {
  const w0 = Math.sqrt(spec.stiffness / spec.mass);
  return { w0, wd: w0 * Math.sqrt(1 - spec.dampingRatio * spec.dampingRatio) };
}

/**
 * Compose `SpringSimulation.valueAtTime()`（欠阻尼解析解）在 `tMs` 毫秒处的位移，
 * 初值 0、终值 1、初速 0 —— 与 Compose 逐字同构。
 *
 * 供测试钉死关键时间点的位移（`tests/unit/godEasing.test.ts`）。
 */
export function godSpringDisplacement(key: GodSpringKey, tMs: number): number {
  const spec = GOD_SPRING_SPECS[key];
  if (!Number.isFinite(tMs) || tMs <= 0) return 0;
  const t = tMs / 1000;
  const { w0, wd } = omega(spec);
  const damping = Math.exp(-spec.dampingRatio * w0 * t);
  return 1 - damping * (Math.cos(wd * t) + ((spec.dampingRatio * w0) / wd) * Math.sin(wd * t));
}

/**
 * Compose `SpringSimulation.velocityAtTime()` 的同构式（用于算静止时间）。
 */
export function godSpringVelocity(key: GodSpringKey, tMs: number): number {
  const spec = GOD_SPRING_SPECS[key];
  if (!Number.isFinite(tMs) || tMs <= 0) return 0;
  const t = tMs / 1000;
  const { w0, wd } = omega(spec);
  return ((w0 * w0) / wd) * Math.exp(-spec.dampingRatio * w0 * t) * Math.sin(wd * t);
}

/**
 * 峰值过冲量（`e^{−πζ/√(1−ζ²)}`，即首次越过 1 的幅度）与到达时刻 `π/ωd`。
 * 两者都直接由 ζ / k 决定，是「CSS 曲线有没有过冲、过冲多少」的判据。
 */
export function godSpringPeak(key: GodSpringKey): { overshoot: number; atMs: number } {
  const spec = GOD_SPRING_SPECS[key];
  const { wd } = omega(spec);
  return {
    overshoot: Math.exp((-Math.PI * spec.dampingRatio) / Math.sqrt(1 - spec.dampingRatio * spec.dampingRatio)),
    atMs: (Math.PI / wd) * 1000,
  };
}

/**
 * 按 Compose 的静止判据（|x − 1| ≤ `displacement` 且 |v| ≤ `velocity`）求动画时长。
 *
 * Compose `SpringSimulation` 的默认 rest 阈值是位移 0.01 / 速度 0.1（`isAtRestAt`）。
 * 这里用 1ms 步长扫描「最后一次越界」+1ms，得到毫秒级的时长上界。
 */
export function godSpringRestTimeMs(
  key: GodSpringKey,
  displacement = 0.01,
  velocity = 0.1,
): number {
  let lastBad = 0;
  for (let t = 0; t <= 3000; t += 1) {
    const within =
      Math.abs(godSpringDisplacement(key, t) - 1) <= displacement &&
      Math.abs(godSpringVelocity(key, t)) <= velocity;
    if (!within) lastBad = t;
  }
  return lastBad + 1;
}

/* ══════════════ CSS 曲线（对解析解的拟合） ══════════════ */

export type GodCubicBezierControlPoints = readonly [number, number, number, number];

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` 在归一化进度 `x`（0..1）处的输出。
 *
 * 与浏览器同解法：x 是 t 的三次多项式，用二分法求 t 再取 y。
 */
export function godCubicBezierAt(cp: GodCubicBezierControlPoints, x: number): number {
  const [x1, y1, x2, y2] = cp;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number): number => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const t = (lo + hi) / 2;
    if (bx(t) < x) lo = t;
    else hi = t;
  }
  return by((lo + hi) / 2);
}

function springCss(key: GodSpringKey): string {
  const spec = GOD_SPRING_SPECS[key];
  const [x1, y1, x2, y2] = spec.controlPoints;
  return `${spec.durationMs}ms cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/**
 * `GodMotion.springMain()`（L34）的 CSS 等价。
 * 历史字符串 `'380ms cubic-bezier(0.34, 1.3, 0.64, 1)'` 的控制点已按解析解重拟合（见文件头）。
 */
export const GOD_SPRING_MAIN_CSS = springCss('main');
/** `GodMotion.springLight()`（L37）的 CSS 等价。 */
export const GOD_SPRING_LIGHT_CSS = springCss('light');
/** `GodMotion.springSoft()`（L40）的 CSS 等价。 */
export const GOD_SPRING_SOFT_CSS = springCss('soft');
/** `GodMotion.springBouncy()`（L43）的 CSS 等价。 */
export const GOD_SPRING_BOUNCY_CSS = springCss('bouncy');

/* ══════════════ 全 Android 树零调用方的常量（登记用，不是漏移植） ══════════════ */

/**
 * GodMotion.kt L54 `SWING_STAGGER_MS = 60` / L57 `BREATH_MS = 3200` /
 * L61 `VINYL_SPIN_MS = 6000` —— 全 Android 源码树 grep 无任何引用（死常量）。
 * TS 侧同样不提供，避免制造「Kotlin 没有的 API」（规约第 4 条）。
 */
export const GOD_DEAD_MOTION_CONSTANTS = {
  swingStaggerMs: 60,
  breathMs: 3200,
  vinylSpinMs: 6000,
} as const;
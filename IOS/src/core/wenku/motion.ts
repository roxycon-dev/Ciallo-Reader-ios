/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/WenkuTokens.kt`
 *   L121-156  WenkuMotion 时长/常量表          → WENKU_MOTION（tokens.ts），这里再导出取用函数
 *   L158-171  五条 CubicBezierEasing           → easeCurve / retractCurve / settleCurve /
 *                                                planeCurve / heroXCurve
 *   L174-177  springDampingRatio / spring()     → WENKU_SPRING_DAMPING_RATIO / wenkuSpring()
 *   L179-207  contactSpec/enterSpec/exitSpec/settleSpec/coverFlightSpec/coverReturnSpec
 *                                              → contactTween() / enterTween() / exitTween() /
 *                                                settleTween() / coverFlightTween() / coverReturnTween()
 *   L210-213  jelly(t)                          → jelly(t)
 *   L216-219  listStart / listEnd               → listStart / listEnd
 *   L316-319  wenkuSmooth                       → smoothStep
 *   L322-348  WenkuReaderPhysics                → 未移植（阅读器翻页，见 reader 模块）
 * `ui/wenku/ArchiveShelf.kt`
 *   L756      SHELF_CENTRE_CURVE                → shelfCentreCurve
 *   L759-762  smoothStep（私有同式）             → smoothStep
 *   L227      `tween(520, LinearEasing)` 入场    → WENKU_SHELF.revealMs + linearEasing
 *   L889-890  SHELF_DRAG_RATE / SHELF_OMEGA     → shelfDragRate / shelfOmega
 *   L918      `handoffSpeed = pitch * 4f`       → shelfHandoffSpeed(pitch)
 *   L563      `durationMillis.coerceIn(1, 1400)` → inertiaDurationMs
 * `ui/wenku/WenkuCoverFlight.kt`
 *   L152-169  WenkuFlightPose.bezier（20 次二分） → cubicBezier
 *   L172-181  easeInOutCubic / easeOutCubic / easeInOut / heroClock → 同名曲线（flight.ts 使用）
 * `ui/wenku/WenkuReflow.kt`
 *   L96       ReflowEasing                      → reflowCurve
 *
 * 未移植：
 * - Compose `Animatable` / `tween` / `spring` 的运行时（时钟、打断、`visibilityThreshold` 判定）。
 *   本层只给出时长、曲线、求值函数；UI 层用 requestAnimationFrame 驱动同一条曲线。
 * - `WenkuMotion.kt` L88-601 的 Modifier 与 CompositionLocal（`wenkuReveal` / `wenkuTabTitle` /
 *   `WenkuPlaneTabSwitcher` / `RetainedPaneLifecycle` / `wenkuPlaneLayer` / `wenkuReaderChrome` /
 *   `WenkuScrollEdgeFade` / `WenkuSkeletonBlock` / `WenkuLoadingHandoff`）——纯 UI。
 */

import {
  WENKU_CURVE_POINTS,
  WENKU_MOTION,
  WENKU_SPRING_DAMPING_RATIO,
  WENKU_SPRING_STIFFNESS,
} from './tokens';

/** 缓动函数：`t ∈ [0,1] → [0,1]`。 */
export type Easing = (t: number) => number;

/** Kotlin `Float.coerceIn`。 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Kotlin `Float.roundToInt()`（`Math.round` 语义：.5 朝 +∞）。 */
export function roundToInt(value: number): number {
  return Math.round(value);
}

/** Kotlin `Float.toInt()`：向零截断。 */
export function truncToInt(value: number): number {
  return Math.trunc(value);
}

/** Kotlin `abs`。 */
export function absf(value: number): number {
  return Math.abs(value);
}

/**
 * 三次贝塞尔单轴分量：`3(1-t)²t·a + 3(1-t)t²·b + t³`（控制点 `(0,0),(a,b),(1,1)` 的 x/y）。
 * 与 `WenkuCoverFlight.kt` L166-169 `bezierComponent` 逐项相同。
 */
function bezierComponent(t: number, a: number, b: number): number {
  const remaining = 1 - t;
  return 3 * remaining * remaining * t * a + 3 * remaining * t * t * b + t * t * t;
}

/**
 * `CubicBezierEasing(x1, y1, x2, y2)` 的求值。
 *
 * Compose 的 `CubicBezierEasing` 用 20 步二分把 x 解回参数 t；`WenkuCoverFlight.kt`
 * L152-164 的 `bezier()` 是同一算法，这里照它实现（而不是 Newton 迭代），
 * 结果与 Android 端逐位可比。
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return (value: number): number => {
    const x = clamp(value, 0, 1);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = x;
    for (let i = 0; i < 20; i += 1) {
      t = (low + high) * 0.5;
      if (bezierComponent(t, x1, x2) < x) low = t;
      else high = t;
    }
    return bezierComponent(t, y1, y2);
  };
}

/** `WenkuMotion.ease`：Curves.easeOutCubic。 */
export const easeCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.ease);
/** `WenkuMotion.retract`：Curves.easeInCubic。 */
export const retractCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.retract);
/** `WenkuMotion.settle`。 */
export const settleCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.settle);
/** `WenkuMotion.plane`。 */
export const planeCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.plane);
/** `WenkuMotion.heroX`。 */
export const heroXCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.heroX);
/** `WenkuMotion.kt` L478 `readerLocationEase`。 */
export const readerLocationCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.readerLocation);
/** `SHELF_CENTRE_CURVE`（`centre()` 的单段滚动）。 */
export const shelfCentreCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.shelfCentre);
/** `ReflowEasing`（`WenkuReflow.kt` L96）。 */
export const reflowCurve: Easing = cubicBezier(...WENKU_CURVE_POINTS.reflow);

/** `LinearEasing`。 */
export const linearEasing: Easing = (t: number): number => clamp(t, 0, 1);

/** `smoothstep`：0 处导数为 0（`wenkuSmooth` / `smoothStep` 同一个式子）。 */
export function smoothStep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** `WenkuMotion.jelly(t) = sin(3πt) * (1 - t)²`。 */
export function jelly(t: number): number {
  const x = clamp(t, 0, 1);
  return Math.sin(3 * Math.PI * x) * (1 - x) * (1 - x);
}

/** `listStart(order) = clamp(order, 0, 8) * .055`。 */
export function listStart(order: number): number {
  return clamp(order, 0, WENKU_MOTION.listMaxDelayBands) * WENKU_MOTION.listDelayStep;
}

/** `listEnd(order) = listStart(order) + .52`。 */
export function listEnd(order: number): number {
  return listStart(order) + WENKU_MOTION.listWindow;
}

/** `spring(dampingRatio, stiffness = 270f)` 的纯数据描述。 */
export interface SpringSpec {
  readonly dampingRatio: number;
  readonly stiffness: number;
}

export function wenkuSpring(): SpringSpec {
  return {
    dampingRatio: WENKU_SPRING_DAMPING_RATIO,
    stiffness: WENKU_SPRING_STIFFNESS,
  };
}

/* ───────────────────────── tween 时长（Kotlin L179-207） ───────────────────────── */

export interface TweenSpec {
  readonly durationMs: number;
  readonly easing: Easing;
}

export function contactTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.contactMs, easing: easeCurve };
}

export function enterTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.enterMs, easing: easeCurve };
}

export function exitTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.exitMs, easing: retractCurve };
}

export function settleTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.enterMs, easing: settleCurve };
}

export function coverFlightTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.coverFlightMs, easing: easeCurve };
}

export function coverReturnTween(): TweenSpec {
  return { durationMs: WENKU_MOTION.coverReturnMs, easing: easeCurve };
}

/** `if (departing) COVER_FLIGHT_MS else COVER_RETURN_MS`（WenkuCoverFlight.kt L454）。 */
export function coverFlightDurationMs(departing: boolean): number {
  return departing ? WENKU_MOTION.coverFlightMs : WENKU_MOTION.coverReturnMs;
}

/* ───────────────────────── 书架滚动常数（ArchiveShelf.kt L889-890 / L918 / L563） ───────────────────────── */

/** `SHELF_DRAG_RATE = 4.4f`：惯性速度的指数衰减率。 */
export const shelfDragRate = WENKU_MOTION.shelfFriction;

/** `SHELF_OMEGA = 12f`：临界阻尼弹簧的角频率（k = ω² = 144，c = 2ω = 24）。 */
export const shelfOmega = 12;

/** `handoffSpeed = pitch * 4f`。 */
export function shelfHandoffSpeed(pitchPx: number): number {
  return pitchPx * WENKU_MOTION.shelfHandoffPitch;
}

/** 惯性 tween 的毫秒时长：`(duration * 1000f).roundToInt().coerceIn(1, 1400)`。 */
export function inertiaDurationMs(durationSeconds: number): number {
  const ms = roundToInt(durationSeconds * 1000);
  return clamp(ms, 1, 1400);
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ui/wenku/WenkuTextMotion.kt — 逐字符折变（WenkuMorphText）+ 数字滚动（WenkuCountUp）
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Kotlin 侧只有 `@Composable`，但真正决定画面的是一串标量运算；这里把那段运算提出来，
 * UI 层（`WenkuMorphText` / `WenkuCountUp` 的 tsx 等价件）只负责按帧喂 `clock`。
 * 行号对照（`WenkuTextMotion.kt`）：
 *   L50-52   `animated = morphOnChange && !reduceMotion && decorative`   → `wenkuTextAnimated`
 *   L64-70   `!animated || text.length > maxChars` → 直接 snapTo(1f)      → `wenkuMorphNeeded`
 *   L74-77   `Random(text.hashCode() xor ++generation)` 的 per-char delay  → `wenkuMorphDelays`
 *   L88-99   `t = ((c - delay)/.48).coerceIn(0,1)`、alpha 折线、前后半程换字 → `wenkuMorphChars`
 *   L104-105 `private const val TEXT_FOLD_MS = 780`                       → `WENKU_TEXT_FOLD_MS`
 *   L112-131 `WenkuCountUp` 的 340ms 进度                                → `WENKU_COUNT_UP_MS`
 *
 * ⚠️ 伪随机：Kotlin `Random(seed)` 是 XorWowRandom，逐位复刻没有收益（参考实现
 * `app_language.dart:239-369` 只要求"可复现的伪随机"，WenkuTextMotion.kt L74 注释亦如此）。
 * 这里用同一颗种子（Kotlin `String.hashCode()` xor generation，**这一半是逐位一致的**）
 * 驱动 xorshift32，因此同一段文本每次重播的错峰完全相同，只是与 Android 的具体错峰值不同。
 */

/** Kotlin `WenkuTextMotion.kt` L105 `private const val TEXT_FOLD_MS = 780`。 */
export const WENKU_TEXT_FOLD_MS = 780;
/** Kotlin L46 `maxChars: Int = 512`。 */
export const WENKU_TEXT_MAX_CHARS = 512;
/** Kotlin L115 `durationMillis: Int = 340`。 */
export const WENKU_COUNT_UP_MS = 340;
/** Kotlin L77 `random.nextDouble().toFloat() * .52f`。 */
export const WENKU_MORPH_MAX_DELAY = 0.52;
/** Kotlin L91 `(c - delays[index]) / .48f`。 */
export const WENKU_MORPH_CHAR_SPAN = 0.48;
/** Kotlin L92 `1f - t * 1.84f` / `.08f + (t - .5f) * 1.84f`。 */
export const WENKU_MORPH_ALPHA_SLOPE = 1.84;
/** Kotlin L92-93 `.coerceIn(.08f, 1f)` 的下界。 */
export const WENKU_MORPH_ALPHA_FLOOR = 0.08;

/** Kotlin `String.hashCode()`：`h = 31*h + ch`，Int32 回绕。 */
export function kotlinStringHashCode(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return hash;
}

/** xorshift32：种子固定则序列固定（0 种子退化成同一个非零常量）。 */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 0x1a2b3c4d;
  return (): number => {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 4294967296;
  };
}

/** Kotlin L50-52 `val animated = morphOnChange && !a11y.reduceMotion && decorative`。 */
export function wenkuTextAnimated(
  morphOnChange: boolean,
  reduceMotion: boolean,
  decorativeMotion: boolean,
): boolean {
  return morphOnChange && !reduceMotion && decorativeMotion;
}

/** Kotlin L62-70：文本没变、未开动效、或超过 `maxChars` 时不播折变。 */
export function wenkuMorphNeeded(
  previous: string,
  text: string,
  animated: boolean,
  maxChars: number = WENKU_TEXT_MAX_CHARS,
): boolean {
  if (previous === text) return false;
  if (!animated) return false;
  return text.length <= maxChars;
}

/**
 * Kotlin L75-77：`count = max(from.length, to.length)` 个 `[0, .52)` 的延迟。
 *
 * 种子 = `text.hashCode() xor generation`（generation 从 1 起，与 Kotlin `++generation` 同）。
 */
export function wenkuMorphDelays(
  text: string,
  generation: number,
  count: number,
): Float64Array {
  const random = seededRandom(kotlinStringHashCode(text) ^ generation);
  const delays = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    delays[index] = random() * WENKU_MORPH_MAX_DELAY;
  }
  return delays;
}

/** 单字符在时钟 `clock` 上的 alpha：Kotlin L92-93 的折线，夹在 `.08..1`。 */
export function wenkuMorphAlpha(clock: number, delay: number): number {
  const t = clamp((clock - delay) / WENKU_MORPH_CHAR_SPAN, 0, 1);
  const alpha =
    t < 0.5
      ? 1 - t * WENKU_MORPH_ALPHA_SLOPE
      : WENKU_MORPH_ALPHA_FLOOR + (t - 0.5) * WENKU_MORPH_ALPHA_SLOPE;
  return clamp(alpha, WENKU_MORPH_ALPHA_FLOOR, 1);
}

/** 一个字符位要画的东西：`'from'` = 旧字，`'to'` = 新字。 */
export interface WenkuMorphChar {
  /** 字符位下标（= `delays` 的下标）。 */
  readonly index: number;
  readonly char: string;
  /** 已经乘过 `resolved.alpha` 之前的纯 alpha（0.08…1）。 */
  readonly alpha: number;
  readonly from: 'from' | 'to';
}

/**
 * Kotlin L89-100 `buildAnnotatedString { … }`：逐位给出「画哪个字、alpha 多少」。
 *
 * `t < .5` 用 `from`、否则用 `to`；`index >= source.length` 的位直接跳过
 * （Kotlin `if (index >= source.length) continue`）。
 */
export function wenkuMorphChars(
  clock: number,
  delays: Float64Array,
  from: string,
  to: string,
): WenkuMorphChar[] {
  const chars: WenkuMorphChar[] = [];
  for (let index = 0; index < delays.length; index += 1) {
    const delay = delays[index] ?? 0;
    const t = clamp((clock - delay) / WENKU_MORPH_CHAR_SPAN, 0, 1);
    const source = t < 0.5 ? from : to;
    if (index >= source.length) continue;
    chars.push({
      index,
      char: source[index] ?? '',
      alpha: wenkuMorphAlpha(clock, delay),
      from: t < 0.5 ? 'from' : 'to',
    });
  }
  return chars;
}

/** Kotlin L131 `format(value * progress.value.coerceIn(0f, 1f))`。 */
export function wenkuCountUpValue(value: number, progress: number): number {
  return value * clamp(progress, 0, 1);
}

/** Kotlin L116 `format: (Float) -> String = { it.toInt().toString() }`。 */
export function wenkuCountUpDefaultFormat(value: number): string {
  return String(truncToInt(value));
}

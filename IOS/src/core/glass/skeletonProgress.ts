/**
 * 骨架屏 / 进度指示 / 完成刻度 / 播放暂停 —— 5 个 `ui/components/*.kt` 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   ChasingDots.kt L15-22        `ChasingDots(modifier, durationMillis = PROGRESS_CYCLE_MS,
 *                                  delayBetweenDotsMillis = 50, size = 40.dp,
 *                                  color = primary, circleRatio = .25f)`
 *                                                              → `CHASING_DOTS_DEFAULTS`
 *   ShimmerBox.kt L24-57         `ShimmerBox(modifier, cornerRadius = 12)`：
 *                                  `x: -300f → 1200f`、`tween(1100, FastOutSlowIn)`、`Restart`；
 *                                  base `surfaceVariant@.55`、glow `@.95`；
 *                                  `linearGradient(base, glow, base)` 从 `(x-240, 0)` 到 `(x, 260)`
 *                                                              → `SHIMMER`
 *   HazeProgress.kt L22-75       `FlowingGradientProgressBar(progress, color, modifier)`：
 *                                  MINIMAL 分支 **8dp** 纯色；常态 **12dp** 渐变，
 *                                  `offset: 0f → 1000f`、`tween(2000, Linear)`、`Restart`，
 *                                  轨道 `@.15`、渐变三段 `(.7, 1, .7)`、圆角 `height/2`
 *                                                              → `FLOWING_PROGRESS`
 *   AppProgressIndicator.kt L28-40 `rememberProgressPhase(active, durationMillis)`：
 *                                  `tween(durationMillis.coerceAtLeast(600), Linear)`；
 *                                  `start = -90f + if (progress == null) phase * 360f else 0f`；
 *                                  `sweep = if (progress == null) 90f + 60f * sin(phase * PI)
 *                                           else 360f * progress.coerceIn(0f, 1f)`
 *                                                              → `PROGRESS_RING`
 *   CompletionGlyph.kt L16-31    `CompletionGlyph(color, modifier)`：
 *                                  `stroke = minDimension * .07f`、底圈 `@.12`、弧 `@.7` 从 -90 扫 `360p`；
 *                                  三点 `a(.25,.51) b(.43,.68) c(.76,.34)`，
 *                                  第一段 `p/.4`、第二段 `(p-.4)/.6`（`p > .4` 才画）；
 *                                  `tween(320, easeOutCubic)`，reduce 时 0ms
 *                                                              → `COMPLETION_GLYPH`
 *   PlayPauseMorph.kt L39-82     `PlayPauseGlyph`：`iconBox = sizeDp/2`，
 *                                  `half = .32w`、`bar = .12w`、`gap = .18w`，
 *                                  两组四点多边形按 `p` 线性 mix；
 *                                  `PlayPauseMorphButton(sizeDp = 40)`，a11y「暂停」/「播放」
 *                                                              → `PLAY_PAUSE`
 *   OverlayTouchShield.kt L9-17  抬起且未被消费的触点要 `consume()`（见 `@core/ui/parityMisc`）
 *   ProducedState.kt L7-35        `rememberAsyncState`（**保留旧值**）vs
 *                                  `rememberKeyedAsyncState`（键变即**重置为初值**）
 *                                                              → `asyncStateMode()`
 *
 * 本轮修正 `src/core/ui/parityMisc.ts` 里 `CompletionGlyph = { sizeDp: 18, strokeWidthDp: 2 }`
 * 这组**猜测值** —— Kotlin 的描边是 `minDimension * .07f` 的**相对**宽度，没有固定的 18dp/2dp。
 */

/* ── ChasingDots.kt ─────────────────────────────────────────────────────── */

/** L15-22 的四个默认参数（`durationMillis` 默认取 `AppMotion.PROGRESS_CYCLE_MS = 1400`）。 */
export const CHASING_DOTS_DEFAULTS = {
  durationMillis: 1400,
  delayBetweenDotsMillis: 50,
  sizeDp: 40,
  circleRatio: 0.25,
} as const;

/* ── ShimmerBox.kt ──────────────────────────────────────────────────────── */

/** L24-57。 */
export const SHIMMER = {
  /** `cornerRadius: Int = 12`。 */
  cornerRadiusDp: 12,
  /** L34-35 的平移区间（px）。 */
  xFrom: -300,
  xTo: 1200,
  /** L37 `tween(1100, easing = FastOutSlowInEasing)`。 */
  durationMs: 1100,
  /** L43-44：`surfaceVariant` 的两种透明度。 */
  baseAlpha: 0.55,
  glowAlpha: 0.95,
  /** L53-54：渐变起止偏移。 */
  gradientStartOffsetX: 240,
  gradientEndY: 260,
  /** MINIMAL 画质下的分支：纯色 `surfaceVariant`，无动画。 */
  minimalStatic: true,
} as const;

/** 某一时刻的 shimmer 渐变端点（`start = (x - 240, 0)`、`end = (x, 260)`）。 */
export function shimmerGradient(x: number): {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
} {
  return {
    start: { x: x - SHIMMER.gradientStartOffsetX, y: 0 },
    end: { x, y: SHIMMER.gradientEndY },
  };
}

/** `FastOutSlowInEasing` 在 t 处的进度（CubicBezier(.4, 0, .2, 1)，与 Compose 同参）。 */
export function fastOutSlowIn(t: number): number {
  return cubicBezier01(0.4, 0, 0.2, 1, t);
}

/* ── HazeProgress.kt ────────────────────────────────────────────────────── */

/** L22-75。 */
export const FLOWING_PROGRESS = {
  /** MINIMAL 分支 L29 `height(8.dp)`。 */
  minimalHeightDp: 8,
  /** 常态 L46 `height(12.dp)`。 */
  heightDp: 12,
  /** L37-38 `offset: 0f → 1000f`。 */
  offsetFrom: 0,
  offsetTo: 1000,
  /** L40 `tween(2000, easing = LinearEasing)`。 */
  durationMs: 2000,
  /** L54 轨道透明度。 */
  trackAlpha: 0.15,
  /** L62-64 渐变三段的透明度。 */
  gradientAlphas: [0.7, 1, 0.7] as const,
  /** L66-67 `start = (offset - 1000f, 0)`、`end = (offset, 0)`。 */
  brushSpan: 1000,
} as const;

/** 某一时刻的渐变端点。 */
export function flowingGradient(offset: number): {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
} {
  return {
    start: { x: offset - FLOWING_PROGRESS.brushSpan, y: 0 },
    end: { x: offset, y: 0 },
  };
}

/* ── AppProgressIndicator.kt ────────────────────────────────────────────── */

/** L28-40。 */
export const PROGRESS_RING = {
  /** L30 `durationMillis.coerceAtLeast(600)`。 */
  minDurationMs: 600,
  /** L38 的起始角基准。 */
  startAngleBaseDeg: -90,
  /** L39 不确定态扫过角：`90f + 60f * sin(phase * PI)`。 */
  indeterminateBaseSweepDeg: 90,
  indeterminateSwingDeg: 60,
  /** L40 确定态整圈。 */
  determinateFullSweepDeg: 360,
} as const;

/** L38 `start = -90f + if (progress == null) phase * 360f else 0f`。 */
export function progressRingStartDeg(progress: number | null, phase: number): number {
  return PROGRESS_RING.startAngleBaseDeg + (progress === null ? phase * 360 : 0);
}

/** L39-40 的 sweep（角度）。 */
export function progressRingSweepDeg(progress: number | null, phase: number): number {
  if (progress === null) {
    return PROGRESS_RING.indeterminateBaseSweepDeg + PROGRESS_RING.indeterminateSwingDeg * Math.sin(phase * Math.PI);
  }
  return PROGRESS_RING.determinateFullSweepDeg * Math.min(Math.max(progress, 0), 1);
}

/* ── CompletionGlyph.kt ─────────────────────────────────────────────────── */

/** L16-31 的几何比例（**全部相对 `size`**，没有绝对 dp）。 */
export const COMPLETION_GLYPH = {
  /** L19 `tween(if (reduce) 0 else 320, easing = easeOutCubic)`。 */
  revealMs: 320,
  /** L22 `stroke = size.minDimension * .07f`。 */
  strokeRatio: 0.07,
  /** L23 底圈 `color.copy(alpha = .12f)`。 */
  discAlpha: 0.12,
  /** L24 弧 `color.copy(alpha = .7f)`，从 -90° 扫 `360f * p`。 */
  arcAlpha: 0.7,
  arcStartDeg: -90,
  arcSweepFullDeg: 360,
  /** L25-27 三个对勾顶点（相对坐标）。 */
  pointA: { x: 0.25, y: 0.51 },
  pointB: { x: 0.43, y: 0.68 },
  pointC: { x: 0.76, y: 0.34 },
  /** L28 `(p / .4f).coerceIn(0f, 1f)`。 */
  firstSegmentEnd: 0.4,
} as const;

/** `stroke = size.minDimension * .07f`。 */
export function completionGlyphStroke(minDimension: number): number {
  return minDimension * COMPLETION_GLYPH.strokeRatio;
}

/** 第一段的完成比例（`p / .4`，钳到 [0,1]）。 */
export function completionFirstSegment(p: number): number {
  return Math.min(Math.max(p / COMPLETION_GLYPH.firstSegmentEnd, 0), 1);
}

/** 第二段的完成比例（`p > .4` 才有意义：(p-.4)/.6）。 */
export function completionSecondSegment(p: number): number {
  if (p <= COMPLETION_GLYPH.firstSegmentEnd) return 0;
  return (p - COMPLETION_GLYPH.firstSegmentEnd) / (1 - COMPLETION_GLYPH.firstSegmentEnd);
}

/* ── PlayPauseMorph.kt ──────────────────────────────────────────────────── */

/** L42-64 的几何比例。 */
export const PLAY_PAUSE = {
  /** `Canvas(Modifier.size((iconBoxDp / 2).dp))` —— 画布是图标盒的一半。 */
  canvasRatio: 0.5,
  /** L46 `half = size.width * .32f`。 */
  halfRatio: 0.32,
  /** L47 `bar = size.width * .12f`。 */
  barRatio: 0.12,
  /** L48 `gap = size.width * .18f`。 */
  gapRatio: 0.18,
  /** L51 `mix(cx - half * .65f, cx - gap - bar)`。 */
  leftNotchRatio: 0.65,
  /** L68 `PlayPauseMorphButton(sizeDp: Int = 40)`。 */
  defaultButtonDp: 40,
  /** L78 a11y 文案。 */
  contentDescriptionPlaying: '暂停',
  contentDescriptionPaused: '播放',
} as const;

/** 播放↔暂停的线性 mix（`fun mix(a, b) = a + (b - a) * p`）。 */
export function playPauseMix(a: number, b: number, p: number): number {
  return a + (b - a) * Math.min(Math.max(p, 0), 1);
}

/* ── ProducedState.kt ───────────────────────────────────────────────────── */

/**
 * L7-35 的两种异步状态语义。
 *
 * · `'keep'`（`rememberAsyncState`）：键变时**保留旧值**直到新值到达
 *   —— 适合文本重载（不会闪一帧空白）。
 * · `'reset'`（`rememberKeyedAsyncState`）：键变时立刻**回到初值**
 *   —— 适合「旧值绝不能再显示」的场景（例如按路径解码的位图，否则会画出上一页）。
 */
export type AsyncStateMode = 'keep' | 'reset';

export function asyncStateMode(keyed: boolean): AsyncStateMode {
  return keyed ? 'reset' : 'keep';
}

/** 键变化时该不该把值重置为初值。 */
export function asyncStateResetsOnKeyChange(keyed: boolean): boolean {
  return asyncStateMode(keyed) === 'reset';
}

/* ── 三次贝塞尔求值（`fastOutSlowIn` 用；与 Compose 的 CubicBezierEasing 同解） ── */

/** 在 [0,1] 上解 `x(t) = x` 再取 `y(t)`；牛顿迭代 + 二分兜底。 */
function cubicBezier01(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-7) return sampleY(t);
    const d = slopeX(t);
    if (Math.abs(d) < 1e-7) break;
    t -= err / d;
  }
  // 二分兜底
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i += 1) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/**
 * 液滴滑条（FluidSlider）—— `com/ramotion/fluidslider/FluidSlider.kt`（599 行）的几何/交互移植。
 *
 * 这是阅读器底栏与漫画面板里那条「液滴吸附」滑条的来源。Android 侧是一个自定义 `View`，
 * Web 侧不照搬 `View`，而是把**几何计算**全部抽成纯函数，由 UI 层用 SVG/CSS 画同一组形状：
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L31-41   `enum class Size(val value: Int) { NORMAL(56), SMALL(40) }`  → `FLUID_SLIDER_SIZES`
 *   L43-75   `private companion object` 的 **20 个常量**（含派生 `SLIDER_HEIGHT = 1 + BAR_VERTICAL_OFFSET`）
 *                                                                        → `FLUID_SLIDER`
 *   L278-321 `init` 里的 10 个派生尺寸（barHeight / desiredWidth / 各 diameter / 偏移）
 *                                                                        → `fluidSliderMetrics()`
 *   L360-373 `onSizeChanged`：`rectBar.set(0, barVerticalOffset, w, barVerticalOffset + barHeight)`、
 *            `maxMovement = width - touchRectDiameter - barInnerOffset * 2`
 *                                                                        → `fluidSliderLayout()`
 *   L385     `x = barInnerOffset + touchRectDiameter / 2 + maxMovement * position`
 *                                                                        → `fluidSliderThumbX()`
 *   L402-439 `onTouchEvent`：按下把「点击点 - 半触点」换算成 position；移动按像素增量累加
 *                                                                        → `fluidSliderPositionOnDown()` / `fluidSliderPositionOnMove()`
 *   L459-553 `drawMetaball`：两个圆之间的液桥路径（含 6 个角度与 4 个贝塞尔控制点偏移）
 *                                                                        → `metaballGeometry()`
 *   L570-597 `showLabel` / `hideLabel`：`OvershootInterpolator` + `duration = 400ms`
 *                                                                        → `FLUID_SLIDER_LABEL_ANIM`
 *   L393     `bubbleText ?: (position * 100).toInt().toString()`
 *                                                                        → `fluidSliderBubbleText()`
 *
 * 平台差异（`PARITY_EXCEPTIONS.md` **E142**）：
 * · `OutlineProvider.setRoundRect` 的轮廓裁剪 → CSS `border-radius` + `overflow: hidden`；
 * · `ValueAnimator + OvershootInterpolator` → `cubic-bezier(.34, 1.56, .64, 1)`（与 Android
 *   `OvershootInterpolator` 的张力/阻尼同参），**时长仍取 400ms**；
 * · 密度（`resources.displayMetrics.density`）由调用方传入，Web 取 `devicePixelRatio × 96/160`。
 */

/** `L31-41` 的两档高度（dp）。 */
export const FLUID_SLIDER_SIZES = { NORMAL: 56, SMALL: 40 } as const;
export type FluidSliderSize = keyof typeof FLUID_SLIDER_SIZES;

/**
 * `L43-75` 的 20 个常量。**注意 `SLIDER_HEIGHT` 是派生的**：
 * `1 + BAR_VERTICAL_OFFSET` = 2.5，不是 `1`。
 */
export const FLUID_SLIDER = {
  BAR_CORNER_RADIUS: 2,
  BAR_VERTICAL_OFFSET: 1.5,
  BAR_INNER_HORIZONTAL_OFFSET: 0,

  SLIDER_WIDTH: 4,
  /** `1 + BAR_VERTICAL_OFFSET`。 */
  SLIDER_HEIGHT: 1 + 1.5,

  TOP_CIRCLE_DIAMETER: 1,
  BOTTOM_CIRCLE_DIAMETER: 25,
  TOUCH_CIRCLE_DIAMETER: 1,
  LABEL_CIRCLE_DIAMETER: 10,

  ANIMATION_DURATION: 400,
  TOP_SPREAD_FACTOR: 0.4,
  BOTTOM_START_SPREAD_FACTOR: 0.25,
  BOTTOM_END_SPREAD_FACTOR: 0.1,
  METABALL_HANDLER_FACTOR: 2.4,
  METABALL_MAX_DISTANCE: 15,
  METABALL_RISE_DISTANCE: 1.1,

  TEXT_SIZE: 12,
  TEXT_OFFSET: 8,
  /** `TEXT_START`。 */
  TEXT_START: '0',
  /** `TEXT_END`。 */
  TEXT_END: '100',

  COLOR_BAR: 0xff6168e7,
  COLOR_LABEL: 0xffffffff,
  COLOR_LABEL_TEXT: 0xff000000,
  COLOR_BAR_TEXT: 0xffffffff,

  INITIAL_POSITION: 0.5,
} as const;

/** `L570-582` 的气泡升起/落下动画（`OvershootInterpolator` 的 CSS 等价）。 */
export const FLUID_SLIDER_LABEL_ANIM = {
  durationMs: FLUID_SLIDER.ANIMATION_DURATION,
  /** Android `OvershootInterpolator()` 默认 tension = 2.0 → 等价三次贝塞尔。 */
  easingCss: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/** 滑条的骨架尺寸（全部 px；`L278-321` 的 10 个派生值）。 */
export interface FluidSliderMetrics {
  /** `barHeight = size.value * density`。 */
  readonly barHeight: number;
  /** `desiredWidth = (barHeight * SLIDER_WIDTH).toInt()`。 */
  readonly desiredWidth: number;
  /** `desiredHeight = (barHeight * SLIDER_HEIGHT).toInt()`。 */
  readonly desiredHeight: number;
  readonly topCircleDiameter: number;
  readonly bottomCircleDiameter: number;
  readonly touchRectDiameter: number;
  /** `labelRectDiameter = barHeight - LABEL_CIRCLE_DIAMETER * density`。 */
  readonly labelRectDiameter: number;
  readonly metaballMaxDistance: number;
  readonly metaballRiseDistance: number;
  readonly barVerticalOffset: number;
  readonly barCornerRadius: number;
  readonly barInnerOffset: number;
  readonly textOffset: number;
}

/** `L278-321`：由尺寸档与密度算出全部派生尺寸。 */
export function fluidSliderMetrics(size: FluidSliderSize, density: number): FluidSliderMetrics {
  const barHeight = FLUID_SLIDER_SIZES[size] * density;
  return {
    barHeight,
    desiredWidth: Math.trunc(barHeight * FLUID_SLIDER.SLIDER_WIDTH),
    desiredHeight: Math.trunc(barHeight * FLUID_SLIDER.SLIDER_HEIGHT),
    topCircleDiameter: barHeight * FLUID_SLIDER.TOP_CIRCLE_DIAMETER,
    bottomCircleDiameter: barHeight * FLUID_SLIDER.BOTTOM_CIRCLE_DIAMETER,
    touchRectDiameter: barHeight * FLUID_SLIDER.TOUCH_CIRCLE_DIAMETER,
    labelRectDiameter: barHeight - FLUID_SLIDER.LABEL_CIRCLE_DIAMETER * density,
    metaballMaxDistance: barHeight * FLUID_SLIDER.METABALL_MAX_DISTANCE,
    metaballRiseDistance: barHeight * FLUID_SLIDER.METABALL_RISE_DISTANCE,
    barVerticalOffset: barHeight * FLUID_SLIDER.BAR_VERTICAL_OFFSET,
    barCornerRadius: FLUID_SLIDER.BAR_CORNER_RADIUS * density,
    barInnerOffset: FLUID_SLIDER.BAR_INNER_HORIZONTAL_OFFSET * density,
    textOffset: FLUID_SLIDER.TEXT_OFFSET * density,
  };
}

/** `L360-373` 的布局结果。 */
export interface FluidSliderLayout {
  readonly bar: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** `maxMovement = width - touchRectDiameter - barInnerOffset * 2`。 */
  readonly maxMovement: number;
  /** 拇指的水平行程基准（`0` 位置时圆心 x）。 */
  readonly thumbOriginX: number;
}

/** `L360-373`。 */
export function fluidSliderLayout(widthPx: number, metrics: FluidSliderMetrics): FluidSliderLayout {
  return {
    bar: {
      left: 0,
      top: metrics.barVerticalOffset,
      right: widthPx,
      bottom: metrics.barVerticalOffset + metrics.barHeight,
    },
    maxMovement: widthPx - metrics.touchRectDiameter - metrics.barInnerOffset * 2,
    thumbOriginX: metrics.barInnerOffset + metrics.touchRectDiameter / 2,
  };
}

/** `L385` `x = barInnerOffset + touchRectDiameter / 2 + maxMovement * position`。 */
export function fluidSliderThumbX(position: number, layout: FluidSliderLayout): number {
  return layout.thumbOriginX + layout.maxMovement * clamp01(position);
}

/** `L408` 按下时的位置换算：`(x - rectTouch.width() / 2) / maxMovement`。 */
export function fluidSliderPositionOnDown(x: number, touchWidth: number, maxMovement: number): number {
  if (maxMovement <= 0) return 0;
  return clamp01((x - touchWidth / 2) / maxMovement);
}

/** `L422` 移动时的位置增量：`position + (dx) / maxMovement`。 */
export function fluidSliderPositionOnMove(position: number, dx: number, maxMovement: number): number {
  if (maxMovement <= 0) return clamp01(position);
  return clamp01(position + dx / maxMovement);
}

/** `L393` `bubbleText ?: (position * 100).toInt().toString()`。 */
export function fluidSliderBubbleText(position: number, bubbleText: string | null = null): string {
  return bubbleText ?? String(Math.trunc(clamp01(position) * 100));
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 液桥（metaball）—— `L459-553` 的逐行移植
 * ══════════════════════════════════════════════════════════════════════════════ */

export interface MetaballCircle {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface MetaballOptions {
  /** 滑条上沿（`rectBar.top`）。 */
  readonly topBorder: number;
  readonly riseDistance?: number;
  readonly maxDistance?: number;
  readonly cornerRadius?: number;
  readonly topSpreadFactor?: number;
  readonly bottomStartSpreadFactor?: number;
  readonly bottomEndSpreadFactor?: number;
  readonly handleRate?: number;
}

/** 液桥路径的输入（不画，只给几何；UI 层把它转成 SVG `path d`）。 */
export interface MetaballGeometry {
  /** `d > maxDistance || d <= |r1 - r2|` 时**不画**（Kotlin L480-482 提前 return）。 */
  readonly drawable: boolean;
  /** 气泡升起的比例（`0` = 贴住滑条，`1` = 完全升起）。 */
  readonly riseRatio: number;
  readonly u1: number;
  readonly u2: number;
  readonly bottomSpreadFactor: number;
  /** 四个切点（`p1a/p1b` 在下圆、`p2a/p2b` 在上圆）。 */
  readonly points: {
    readonly p1a: Point;
    readonly p1b: Point;
    readonly p2a: Point;
    readonly p2b: Point;
  };
  /** 四个贝塞尔控制点偏移（相对各自锚点）。 */
  readonly handles: {
    readonly sp1: Point;
    readonly sp2: Point;
    readonly sp3: Point;
    readonly sp4: Point;
  };
  /** `yOffset = |topBorder - p1a.y| * riseRatio - 1`。 */
  readonly yOffset: number;
} 

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * `L459-553` `drawMetaball` 的几何部分。
 *
 * `circle1` 是**下圆**（滑条处的触点），`circle2` 是**上圆**（升起的标签气泡）——
 * 与 Kotlin 的 `drawMetaball(canvas, paint, path, rectBottomCircle, rectTopCircle, rectBar.top)` 一致。
 */
export function metaballGeometry(
  circle1: MetaballCircle,
  circle2: MetaballCircle,
  options: MetaballOptions,
): MetaballGeometry {
  const riseDistance = options.riseDistance ?? 0;
  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  const topSpreadFactor = options.topSpreadFactor ?? FLUID_SLIDER.TOP_SPREAD_FACTOR;
  const bottomStart = options.bottomStartSpreadFactor ?? FLUID_SLIDER.BOTTOM_START_SPREAD_FACTOR;
  const bottomEnd = options.bottomEndSpreadFactor ?? FLUID_SLIDER.BOTTOM_END_SPREAD_FACTOR;
  const handleRate = options.handleRate ?? FLUID_SLIDER.METABALL_HANDLER_FACTOR;

  const r1 = circle1.radius;
  const r2 = circle2.radius;
  const empty = {
    drawable: false,
    riseRatio: 0,
    u1: 0,
    u2: 0,
    bottomSpreadFactor: 0,
    points: {
      p1a: { x: 0, y: 0 },
      p1b: { x: 0, y: 0 },
      p2a: { x: 0, y: 0 },
      p2b: { x: 0, y: 0 },
    },
    handles: {
      sp1: { x: 0, y: 0 },
      sp2: { x: 0, y: 0 },
      sp3: { x: 0, y: 0 },
      sp4: { x: 0, y: 0 },
    },
    yOffset: 0,
  } satisfies MetaballGeometry;

  // L475-477 / L480-482：退化半径与「太远 / 一圆包住另一圆」都不画
  if (r1 === 0 || r2 === 0) return empty;
  const dx = circle2.cx - circle1.cx;
  const dy = circle2.cy - circle1.cy;
  const d = Math.hypot(dx, dy);
  if (d > maxDistance || d <= Math.abs(r1 - r2)) return empty;

  // L484 riseRatio：上圆顶到滑条上沿的距离 / 抬升距离
  const riseRatio =
    riseDistance <= 0 ? 1 : Math.min(1, Math.max(0, (options.topBorder - (circle2.cy - r2)) / riseDistance));

  // L486-494 两圆相交时才有额外的张角
  let u1 = 0;
  let u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos(clampUnit((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)));
    u2 = Math.acos(clampUnit((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)));
  }

  // L499-501 下圆张角随升起比例从 0.25 收到 0.1
  const bottomSpreadDiff = bottomStart - bottomEnd;
  const bottomSpreadFactor = bottomStart - bottomSpreadDiff * riseRatio;

  // L503-508 四个角度
  const angle1 = Math.atan2(dy, dx);
  const angle2 = Math.acos(clampUnit((r1 - r2) / d));
  const angle1a = angle1 + u1 + (angle2 - u1) * bottomSpreadFactor;
  const angle1b = angle1 - u1 - (angle2 - u1) * bottomSpreadFactor;
  const angle2a = angle1 + Math.PI - u2 - (Math.PI - u2 - angle2) * topSpreadFactor;
  const angle2b = angle1 - Math.PI + u2 + (Math.PI - u2 - angle2) * topSpreadFactor;

  // L510-513 四个切点
  const p1a = polar(circle1, angle1a, r1);
  const p1b = polar(circle1, angle1b, r1);
  const p2a = polar(circle2, angle2a, r2);
  const p2b = polar(circle2, angle2b, r2);

  // L515-524 控制点长度：max(spread) * handleRate，再被「切点间距 / 半径和」与重叠度夹住
  const totalRadius = r1 + r2;
  const d2Base = Math.min(
    Math.max(topSpreadFactor, bottomSpreadFactor) * handleRate,
    Math.hypot(p2a.x - p1a.x, p2a.y - p1a.y) / totalRadius,
  );
  const d2 = d2Base * Math.min(1, (d * 2) / (r1 + r2));
  const cr1 = r1 * d2;
  const cr2 = r2 * d2;

  const halfPi = Math.PI / 2;
  const sp1 = vector(angle1a - halfPi, cr1);
  const sp2 = vector(angle2a + halfPi, cr2);
  const sp3 = vector(angle2b - halfPi, cr2);
  const sp4 = vector(angle1b + halfPi, cr1);

  // L533 把下圆切点抬到滑条上沿
  const yOffset = Math.abs(options.topBorder - p1a.y) * riseRatio - 1;

  return {
    drawable: true,
    riseRatio,
    u1,
    u2,
    bottomSpreadFactor,
    points: { p1a, p1b, p2a, p2b },
    handles: { sp1, sp2, sp3, sp4 },
    yOffset,
  };
}

/** `L447-451` `getVector(radians, length)`。 */
export function vector(radians: number, length: number): Point {
  return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
}

/** `L510` 的 `getVector(...) + center`。 */
function polar(circle: MetaballCircle, radians: number, length: number): Point {
  return { x: circle.cx + Math.cos(radians) * length, y: circle.cy + Math.sin(radians) * length };
}

function clampUnit(v: number): number {
  return Math.min(Math.max(v, -1), 1);
}


/* ══════════════════════════════════════════════════════════════════════════════
 * `com/ramotion/fluidslider/FluidSliderCompose.kt`（32 行）—— 包装层
 * ══════════════════════════════════════════════════════════════════════════════
 * Kotlin 的 `@Composable fun FluidSlider(...)` 只做一件事：把 6 个参数转发给
 * `com.example.ui.components.LiquidSlider`。另外 8 个参数（`barHeightDp` /
 * `startText` / `endText` / `colorBar` / `colorBubble` / `colorBubbleText` /
 * `colorBarText` / `durationMillis`）**在 Kotlin 里声明了却没有被转发** ——
 * 也就是说调用方传什么都不会生效，实际生效的永远是 `FLUID_SLIDER` 里那套常量。
 * 端口据此**不**给它们做可调开关：把它们写成只读默认值，避免「Web 上能调、Android 上不能」。
 */

/** Kotlin L9-26 的形参默认值（其中 8 个是死参数，仅用于记录 Android 的真实行为）。 */
export const FLUID_SLIDER_COMPOSE_DEFAULTS = {
  /** Kotlin L17 `barHeightDp: Int = 48` —— **未转发**给 LiquidSlider。 */
  barHeightDp: 48,
  /** Kotlin L19 `startText: String? = "0"` —— **未转发**。 */
  startText: '0',
  /** Kotlin L20 `endText: String? = "100"` —— **未转发**。 */
  endText: '100',
  /** Kotlin L21 `colorBar = Color(0xFF6168E7)` —— **未转发**。 */
  colorBar: 0xff6168e7,
  /** Kotlin L22 `colorBubble = Color.White` —— **未转发**。 */
  colorBubble: 0xffffffff,
  /** Kotlin L23 `colorBubbleText = Color.Black` —— **未转发**。 */
  colorBubbleText: 0xff000000,
  /** Kotlin L24 `colorBarText = Color.White.copy(alpha = 0.7f)` —— **未转发**。 */
  colorBarTextRgb: 0xffffff,
  colorBarTextAlpha: 0.7,
  /** Kotlin L25 `durationMillis: Int = 400` —— **未转发**（库内仍是 `ANIMATION_DURATION`）。 */
  durationMillis: 400,
} as const;

/**
 * Kotlin L30 `formatLabel = { bubbleText ?: "${(it * 100).roundToInt()}%" }`。
 *
 * ⚠️ 与库内默认标签 {@link fluidSliderBubbleText} **不是同一个函数**：
 *   · 这里是 `roundToInt` + `%`（0.126 → `"13%"`）；
 *   · 库内是 `toInt` 截断、无后缀（0.126 → `"12"`）。
 * Kotlin 的 `roundToInt` 是「四舍五入到最近整数、.5 向正无穷」，与 JS `Math.round` 一致。
 */
export function fluidSliderPercentLabel(position: number, bubbleText: string | null = null): string {
  if (bubbleText !== null) return bubbleText;
  return `${String(Math.round(clamp01(position) * 100))}%`;
}

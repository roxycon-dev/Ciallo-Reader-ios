/**
 * comicChapterEdgeGesture.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicChapterEdgeGesture.kt`（109 行 / 非空 106 行）。
 *
 * 纯逻辑模块（无 Compose 依赖）→ 放在 `src/core`，可被单测直接引用。
 *
 * Kotlin 行号 → TS 对照：
 *   L1        package/import（Animatable / spring / awaitEachGesture / pointerInput …）→ 略
 *   L20       KDoc「正值回退、负值前进；只允许从起手时已停住的首末页跨章。」→ 保留
 *   L21-L25   internal fun comicChapterEdgeTarget(drag, atStart, atEnd, threshold)
 *             → 逐行移植（唯一纯函数，原样导出）
 *   L27       KDoc「首末页单指外翻。缩放、跨轴拖动和取消事件让位…」→ 保留（手势主体在 .tsx）
 *   L28-L108  internal fun Modifier.comicChapterEdgeSwipe(...)
 *             → 手势主体在 `comicChapterEdgeGesture.tsx`（Pointer Events + setPointerCapture）；
 *               其内部的**纯计算**部分拆到本文件，便于单测：
 *                 · L46  sign（direction → ±1）
 *                 · L48  thresholdDp = 48
 *                 · L68-L70 axis / cross 取分量
 *                 · L72-L77 跨轴/未过 slop/方向不符的三个提前退出判定 → comicChapterEdgeAxisDecision
 *                 · L91-L97 outward / damped 阻尼位移（含 span）→ comicChapterEdgeDampedOffset
 *                 · L102 offset.animateTo(0f, spring(dampingRatio=0.85f, stiffness=380f)) 参数
 *                   → 导出为常量 COMIC_CHAPTER_EDGE_SPRING（供 .tsx 与单测共用）
 *
 * 跳过说明：
 *   · `Modifier` / `composed { }` / `pointerInput` / `graphicsLayer` 是 Compose 专有，
 *     无逐行对应物；等价的浏览器实现放在 `comicChapterEdgeGesture.tsx`（本文件头已注明）。
 *   · `androidx.compose.runtime.rememberUpdatedState`（L38-L42）→ .tsx 里用 ref 持有最新闭包，
 *     等价（避免手势回调读到过期 lambda）。
 *   · `Animatable(0f)` + `snapTo` + `animateTo`（L43/L97/L102）→ .tsx 里用 ref 直接写
 *     `transform: translate*`，回弹用 CSS transition/spring 等价曲线。
 *   · `viewConfiguration.touchSlop`（L49）依赖平台；.tsx 里用模块常量
 *     `TOUCH_SLOP_PX = 8`（与 Android 默认 8dp 一致），此处导出以便测试共用。
 *
 * 适配说明：
 *   · Kotlin `Float` → `number`；`abs` → `Math.abs`。
 *   · `when { … }` 返回 Int（-1 / 1 / 0）→ `if / else if` 返回 number，字面量不变。
 */

/** 正值回退、负值前进；只允许从起手时已停住的首末页跨章。 */
export function comicChapterEdgeTarget(
  drag: number,
  atStart: boolean,
  atEnd: boolean,
  threshold: number,
): number {
  if (atStart && drag >= threshold) return -1
  if (atEnd && drag <= -threshold) return 1
  return 0
}

/** `pointerInput` 内的 `viewConfiguration.touchSlop`（L49）平台常量。 */
export const TOUCH_SLOP_PX = 8

/** `val threshold = 48.dp.toPx()`（L48）。dp → CSS px 按 1:1（本项目统一换算）。 */
export const CHAPTER_EDGE_THRESHOLD_DP = 48

/**
 * `offset.animateTo(0f, spring(dampingRatio = 0.85f, stiffness = 380f))`（L102）
 * 的参数常量。.tsx 用它推导 CSS 弹簧曲线，单测用来钉死数值。
 */
export const COMIC_CHAPTER_EDGE_SPRING = {
  dampingRatio: 0.85,
  stiffness: 380,
} as const

/** `val sign = if (direction == ComicDirection.RTL) -1f else 1f`（L46）。 */
export function comicChapterEdgeSign(rtl: boolean): number {
  return rtl ? -1 : 1
}

/** 单指外翻手势的轴向分量与跨轴分量（`delta = change.position - down.position`，L68-L70）。 */
export interface ComicChapterEdgeDelta {
  /** `(if (vertical) delta.y else delta.x) * sign`（L69） */
  readonly axis: number
  /** `if (vertical) delta.x else delta.y`（L70） */
  readonly cross: number
}

/** 逐行移植 L68-L70。 */
export function comicChapterEdgeDelta(
  deltaX: number,
  deltaY: number,
  vertical: boolean,
  sign: number,
): ComicChapterEdgeDelta {
  return {
    axis: (vertical ? deltaY : deltaX) * sign,
    cross: vertical ? deltaX : deltaY,
  }
}

/** 手势是否应继续接管本次跨章外翻（L71-L79 的判定）。 */
export type ComicChapterEdgeAxisDecision = 'cross-axis' | 'too-small' | 'wrong-way' | 'active'

/**
 * 逐行移植 L71-L79：
 *   `if (!active) { if (abs(cross) > slop && abs(cross) > abs(axis)) return`   → cross-axis
 *                   `if (abs(axis) <= slop) { … continue }`                     → too-small
 *                   `if (!(start && axis > 0f || end && axis < 0f)) return`     → wrong-way
 *                   `active = true }`
 */
export function comicChapterEdgeAxisDecision(params: {
  readonly active: boolean
  readonly axis: number
  readonly cross: number
  readonly slop: number
  readonly start: boolean
  readonly end: boolean
}): ComicChapterEdgeAxisDecision {
  if (params.active) return 'active'
  if (Math.abs(params.cross) > params.slop && Math.abs(params.cross) > Math.abs(params.axis)) {
    return 'cross-axis'
  }
  if (Math.abs(params.axis) <= params.slop) return 'too-small'
  if (!((params.start && params.axis > 0) || (params.end && params.axis < 0))) return 'wrong-way'
  return 'active'
}

/**
 * 逐行移植 L90-L97 的阻尼位移：
 *   `val outward = when { start && axis > 0f -> axis; end && axis < 0f -> axis; else -> 0f }`
 *   `val damped = abs(outward) / (1f + abs(outward) / span.coerceAtLeast(1f))`
 *   `offset.snapTo(if (outward < 0f) -damped * sign else damped * sign)`
 * 返回**已乘 sign 的最终偏移**（0 表示不位移）。
 */
export function comicChapterEdgeDampedOffset(params: {
  readonly axis: number
  readonly start: boolean
  readonly end: boolean
  readonly span: number
  readonly sign: number
}): number {
  let outward = 0
  if (params.start && params.axis > 0) outward = params.axis
  else if (params.end && params.axis < 0) outward = params.axis
  if (outward === 0) return 0
  const absOut = Math.abs(outward)
  const span = Math.max(params.span, 1)
  const damped = absOut / (1 + absOut / span)
  return outward < 0 ? -damped * params.sign : damped * params.sign
}

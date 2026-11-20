/**
 * 缩放手势的判定层 —— `net/engawapg/lib/zoomable/DetectZoomableGestures.kt`（229 行）+
 * `ScrollGesturePrpagation.kt`（21 行）的纯函数移植。
 *
 * Kotlin 是 `PointerInputScope` 的挂起循环；Web 侧用 Pointer Events，因此这里只保留
 * **可判定的部分**：`calculateZoom` / `calculatePan` / `calculateCentroid` 的公式、
 * touch-slop 判定、单指缩放速率、双击/长按时序常量。UI 层（`Zoomable.tsx`）负责接线。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   ScrollGesturePrpagation.kt L9-21 `enum class ScrollGesturePropagation { ContentEdge, NotZoomed }`
 *                                              → `ScrollGesturePropagation` / `ScrollGesturePropagationValue`
 *   L46-62  `detectZoomableGestures(...)`：首次 down 在需要 tap/double-tap/long-press 时 consume
 *                                              → `shouldConsumeFirstDown`
 *   L73     `startPosition = currentEvent.changes[0].position` → `startPositionOf`
 *   L75-82  `withTimeout(longPressTimeoutMillis) { awaitTouchSlop() }` 超时 → `isLongPress`
 *   L86-88  `zoomChange = event.calculateZoom()` / `panChange = event.calculatePan()`
 *                                              → `calculateZoom` / `calculatePan`
 *   L89     `event.calculateCentroid(useCurrent = true)`          → `calculateCentroid`
 *   L97     `event.isPointerReducedToOne`（上一帧 >1 且本帧 ==1）  → `isPointerReducedToOne`
 *   L112-125 `awaitSecondDown(firstUp)`：`doubleTapTimeoutMillis` 窗口内、
 *            且不早于 `doubleTapMinTimeMillis`                        → `isDoubleTap`
 *   L133    `zoomChange = 1f + panChange.y * 0.004f`（单指缩放）    → `ONE_FINGER_ZOOM_RATE`
 *   L146-167 `awaitTouchSlop()`：`TouchSlop(touchSlop)` 累积 pan/zoom 判定 → `touchSlopPast`
 *   L169-176 `awaitEvent()`：任一 change 被 consume 即取消          → `eventCanceled`
 *   L178-183 `consumeAllEventsUntilReleased()`                     → `eventsUntilReleased`
 *   L228-229 `class TouchSlop(threshold)`                          → `TouchSlopAccumulator`
 *
 * 平台差异（已登记 E127）
 * ─────────────────────
 *  * `PointerEventPass.Main/Final` 的两段式取消语义 → 单个 `pointermove` 上的 `isConsumed` 标记。
 *  * `viewConfiguration.touchSlop / longPressTimeoutMillis / doubleTapTimeoutMillis /
 *    doubleTapMinTimeMillis` → Android `ViewConfiguration` 默认值（8dp / 400ms / 300ms / 40ms），
 *    密度换算由 UI 层传入。
 */

/** `ScrollGesturePrpagation.kt` L9-21。 */
export const ScrollGesturePropagation = {
  ContentEdge: 'ContentEdge',
  NotZoomed: 'NotZoomed',
} as const;

export type ScrollGesturePropagationValue =
  (typeof ScrollGesturePropagation)[keyof typeof ScrollGesturePropagation];

/** Android `ViewConfiguration` 默认值（Kotlin 从 `viewConfiguration` 读同名项）。 */
export const ZOOM_GESTURE_TIMEOUTS = {
  /** `viewConfiguration.longPressTimeoutMillis`。 */
  longPressMs: 400,
  /** `viewConfiguration.doubleTapTimeoutMillis`。 */
  doubleTapMs: 300,
  /** `viewConfiguration.doubleTapMinTimeMillis`。 */
  doubleTapMinMs: 40,
  /** `viewConfiguration.touchSlop` 的 dp 值（8dp，px 由 UI 层按 density 换算）。 */
  touchSlopDp: 8,
} as const;

/** L133 `zoomChange = 1f + panChange.y * 0.004f`（单指缩放速率）。 */
export const ONE_FINGER_ZOOM_RATE = 0.004;

export interface PointerSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** 上一帧位置（Compose `change.previousPosition`）。缺省时视为未移动。 */
  readonly prevX?: number;
  readonly prevY?: number;
  readonly pressed: boolean;
  readonly previousPressed: boolean;
  readonly uptimeMs: number;
  /** 该 change 是否已被上游消费（对应 Compose `change.isConsumed`）。 */
  readonly consumed?: boolean;
}

export interface PointerFrame {
  readonly changes: readonly PointerSample[];
}

/**
 * L48 `if (onTap != null || onDoubleTap != null || onLongPress != null || enableOneFingerZoom())`
 * 成立时首帧 down 被 consume。
 */
export function shouldConsumeFirstDown(input: {
  readonly hasOnTap: boolean;
  readonly hasOnDoubleTap: boolean;
  readonly hasOnLongPress: boolean;
  readonly enableOneFingerZoom: boolean;
}): boolean {
  return input.hasOnTap || input.hasOnDoubleTap || input.hasOnLongPress || input.enableOneFingerZoom;
}

/** L73 `startPosition = currentEvent.changes[0].position`。 */
export function startPositionOf(frame: PointerFrame): { readonly x: number; readonly y: number } | null {
  const first = frame.changes[0];
  return first === undefined ? null : { x: first.x, y: first.y };
}

/** L185-186 `PointerEvent.isPressed = changes.fastAny { it.pressed }`。 */
export function anyPressed(frame: PointerFrame): boolean {
  return frame.changes.some((c) => c.pressed);
}

/**
 * L188-189 `isPointerReducedToOne`：
 * `changes.count { previousPressed } > 1 && changes.count { pressed } == 1`。
 */
export function isPointerReducedToOne(frame: PointerFrame): boolean {
  const before = frame.changes.filter((c) => c.previousPressed).length;
  const now = frame.changes.filter((c) => c.pressed).length;
  return before > 1 && now === 1;
}

/** L169-176 `awaitEvent()`：任一 change 被 consume → 手势取消。 */
export function eventCanceled(frame: PointerFrame): boolean {
  return frame.changes.some((c) => c.consumed === true);
}

/**
 * Compose `calculateZoom()`：`currentCentroidSize / previousCentroidSize` 的比值。
 * 少于两指时返回 1（无缩放）。
 */
export function calculateZoom(frame: PointerFrame): number {
  const pressed = frame.changes.filter((c) => c.pressed);
  if (pressed.length < 2) return 1;
  const current = centroidSize(frame.changes, true);
  const previous = centroidSize(frame.changes, false);
  if (previous === 0) return 1;
  return current / previous;
}

/**
 * Compose `calculatePan()`：所有按下指针 `current - previous` 的均值。
 */
export function calculatePan(frame: PointerFrame): { readonly x: number; readonly y: number } {
  const pressed = frame.changes.filter((c) => c.pressed);
  if (pressed.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const c of pressed) {
    sumX += c.x - (c.prevX ?? c.x);
    sumY += c.y - (c.prevY ?? c.y);
  }
  return { x: sumX / pressed.length, y: sumY / pressed.length };
}


/**
 * Compose `calculateCentroid(useCurrent)`：所有指针位置的均值。
 * 本实现用 `PointerSample` 的 `x/y` 作为 current；previous 由调用方在采样时写入
 * `prevX/prevY`（见 `ZoomPointerSample`）。
 */
export function calculateCentroid(frame: PointerFrame, useCurrent = true): { readonly x: number; readonly y: number } {
  const pressed = frame.changes.filter((c) => c.pressed);
  if (pressed.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const c of pressed) {
    sumX += useCurrent ? c.x : (c.prevX ?? c.x);
    sumY += useCurrent ? c.y : (c.prevY ?? c.y);
  }
  return { x: sumX / pressed.length, y: sumY / pressed.length };
}

function centroidSize(changes: readonly PointerSample[], useCurrent: boolean): number {
  const pressed = changes.filter((c) => c.pressed);
  if (pressed.length < 2) return 0;
  const centroid = calculateCentroid({ changes }, useCurrent);
  let sum = 0;
  for (const c of pressed) {
    const x = useCurrent ? c.x : (c.prevX ?? c.x);
    const y = useCurrent ? c.y : (c.prevY ?? c.y);
    sum += Math.hypot(x - centroid.x, y - centroid.y);
  }
  return sum / pressed.length;
}

/**
 * L228-229 `class TouchSlop(threshold)`：累积位移超过阈值即视为拖动/缩放手势。
 * Compose 的实现按「累积 pan 的欧氏长度」与「zoom 与 1 的差」双判据。
 */
export class TouchSlopAccumulator {
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  constructor(private readonly threshold: number) {}

  /** L158 `touchSlop.isPast(mainEvent)`。 */
  isPast(frame: PointerFrame): boolean {
    const pan = calculatePan(frame);
    this.panX += pan.x;
    this.panY += pan.y;
    this.zoom *= calculateZoom(frame);
    const distance = Math.hypot(this.panX, this.panY);
    return distance > this.threshold || Math.abs(this.zoom - 1) > 0.0001;
  }

  reset(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
  }
}

/** L75-82：`withTimeout(longPressTimeoutMillis)` 内没有越过 touch slop ⇒ 长按。 */
export function isLongPress(elapsedMs: number, longPressMs = ZOOM_GESTURE_TIMEOUTS.longPressMs): boolean {
  return elapsedMs >= longPressMs;
}

/**
 * L112-125 `awaitSecondDown(firstUp)`：在 `doubleTapTimeoutMillis` 内到来的第二次 down，
 * 且其时间戳不早于 `firstUp + doubleTapMinTimeMillis`，才算双击。
 */
export function isDoubleTap(input: {
  readonly firstUpMs: number;
  readonly secondDownMs: number;
  readonly doubleTapMs?: number;
  readonly doubleTapMinMs?: number;
}): boolean {
  const window = input.doubleTapMs ?? ZOOM_GESTURE_TIMEOUTS.doubleTapMs;
  const minGap = input.doubleTapMinMs ?? ZOOM_GESTURE_TIMEOUTS.doubleTapMinMs;
  const elapsed = input.secondDownMs - input.firstUpMs;
  return elapsed <= window && input.secondDownMs >= input.firstUpMs + minGap;
}

/** L130-143：双击后的竖向滚动被当作缩放（`1f + pan.y * 0.004f`）。 */
export function oneFingerZoomFactor(panY: number): number {
  return 1 + panY * ONE_FINGER_ZOOM_RATE;
}

/**
 * L178-183 `consumeAllEventsUntilReleased()`：长按后吞掉后续事件直到全部抬起。
 * Web 侧同样的语义：返回是否应继续吞事件。
 */
export function shouldKeepConsuming(frame: PointerFrame): boolean {
  return anyPressed(frame);
}

/**
 * 缩放状态机 —— `net/engawapg/lib/zoomable/ZoomState.kt`（415 行）的逐行数学移植。
 *
 * Kotlin 是 `@Stable class ZoomState` + 三个 `Animatable`；Web 侧把「动画」交给调用方
 * （React state / rAF），本文件只保留**纯计算**：适配尺寸、边界、缩放锚点、命中传播判定。
 * 所有数值（0.9 弹回、ratio 3 / 0.33 的轴向判定、`exponentialDecay`、`spring()`、
 * `tween(700)`）均照抄，因此两端的手感参数一致。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L55-59  `ZoomState(maxScale = 5f, contentSize = Size.Zero, velocityDecay = exponentialDecay(),
 *            initialScale = 1f)`                              → `ZOOM_DEFAULTS` + `createZoomState`
 *   L60-64  `require(maxScale >= 1f)` / `initialScale >= 1f` / `isUnspecified → Zero`  → `createZoomState` 的校验
 *   L67     `_scale.updateBounds(0.9f, maxScale)`             → `ZOOM_SCALE_LOWER_BOUND`
 *   L122-125 `setLayoutSize(size)`                            → `setLayoutSize`
 *   L132-135 `setContentSize(size)`                           → `setContentSize`
 *   L138-157 `updateFitContentSize()`（contain 适配）          → `fitContentSize`
 *   L162-168 `reset()`                                        → `resetZoom`
 *   L188-211 `willChangeOffset(pan)`：`ratio > 3` 水平 / `ratio < 0.33` 垂直，
 *            到边且继续外推则返回 false                       → `willChangeOffset`
 *   L213-246 `applyGesture(pan, zoom, position, timeMillis, enableBounce = true)`：
 *            `newScale = (scale*zoom).coerceIn(minScale, maxScale)`、
 *            `newOffset = calculateNewOffset(...)`、`newBounds = calculateNewBounds(...)`；
 *            `zoom == 1f` 才喂 velocityTracker                          → `applyGesture`
 *   L272-298 `changeScale(targetScale, position, animationSpec = spring())` → `changeScale`
 *   L300-317 `calculateNewOffset(newScale, position, pan)`     → `calculateNewOffset`
 *   L319-324 `calculateNewBounds(newScale)`                    → `calculateNewBounds`
 *   L326-340 `startFling()`：`gestureChangedScale` 直接返回     → `startFlingVelocity`
 *   L349-392 `centerByContentCoordinate(offset, scale = 3f, animationSpec = tween(700))` → 同名
 *   L401-415 `centerByLayoutCoordinate(offset, scale = 3f, tween(700))` → 同名
 *
 * 平台差异（已登记 E126）
 * ─────────────────────
 *  * `Animatable` 的 snap/animate 交给 UI 层；本文件返回「目标值 + 是否应启动动画」。
 *  * `ZoomState.isActive`（L111-113）→ `ZoomSnapshot.active` 布尔。
 */
import { ScrollGesturePropagation } from './gestures';
import type { ScrollGesturePropagationValue } from './gestures';

export interface ZoomPoint {
  readonly x: number;
  readonly y: number;
}

export interface ZoomSize {
  readonly width: number;
  readonly height: number;
}

/** L55-58 的默认值。 */
export const ZOOM_DEFAULTS = {
  /** `maxScale: Float = 5f`。 */
  maxScale: 5,
  /** `initialScale: Float = 1f`。 */
  initialScale: 1,
  /** L67 `_scale.updateBounds(0.9f, maxScale)` 的下界。 */
  scaleLowerBound: 0.9,
  /** L220 `minScale = if (enableBounce) 0.9f else 1f`。 */
  bounceMinScale: 0.9,
  /** L67 / L106 `Modifier.zoomable` 默认双击缩放比 `2.5f`。 */
  doubleTapScale: 2.5,
  /** L352 `centerByContentCoordinate` 的默认 scale `3f`。 */
  centerScale: 3,
  /** L352 `tween(700)` 的时长（ms）。 */
  centerMs: 700,
} as const;

/** L188-211 的两条轴向判定阈值。 */
export const ZOOM_PAN_HORIZONTAL_RATIO = 3;
export const ZOOM_PAN_VERTICAL_RATIO = 0.33;

/** `DetectMouseWheelZoom.kt` L8-10。 */
export const SCROLL_TO_ZOOM_RATE = -0.3;
export const MOUSE_WHEEL_MIN_ZOOM = 0.66;
export const MOUSE_WHEEL_MAX_ZOOM = 1.5;

export interface ZoomSnapshot {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly layoutSize: ZoomSize;
  readonly contentSize: ZoomSize;
  readonly fitContentSize: ZoomSize;
  readonly active: boolean;
}

export function createZoomState(
  maxScale = ZOOM_DEFAULTS.maxScale,
  contentSize: ZoomSize = { width: 0, height: 0 },
  initialScale = ZOOM_DEFAULTS.initialScale,
): ZoomSnapshot {
  // L61-62 的两条 require。
  if (!(maxScale >= 1)) throw new RangeError('maxScale must be at least 1.0.');
  if (!(initialScale >= 1)) throw new RangeError('initialScale must be at least 1.0.');
  return {
    scale: initialScale,
    offsetX: 0,
    offsetY: 0,
    layoutSize: { width: 0, height: 0 },
    contentSize,
    fitContentSize: { width: 0, height: 0 },
    active: false,
  };
}

function isZero(size: ZoomSize): boolean {
  return size.width === 0 && size.height === 0;
}

/** L138-157 `updateFitContentSize()`：`BoxFit.contain` 的等价计算。 */
export function fitContentSize(layoutSize: ZoomSize, contentSize: ZoomSize): ZoomSize {
  if (isZero(layoutSize)) return { width: 0, height: 0 };
  if (isZero(contentSize)) return layoutSize;
  const contentAspectRatio = contentSize.width / contentSize.height;
  const layoutAspectRatio = layoutSize.width / layoutSize.height;
  if (contentAspectRatio > layoutAspectRatio) {
    const k = layoutSize.width / contentSize.width;
    return { width: contentSize.width * k, height: contentSize.height * k };
  }
  const k = layoutSize.height / contentSize.height;
  return { width: contentSize.width * k, height: contentSize.height * k };
}

/** L122-125 `setLayoutSize(size)`。 */
export function setLayoutSize(state: ZoomSnapshot, size: ZoomSize): ZoomSnapshot {
  const layoutSize = isZero(size) ? { width: 0, height: 0 } : size;
  return { ...state, layoutSize, fitContentSize: fitContentSize(layoutSize, state.contentSize) };
}

/** L132-135 `setContentSize(size)`。 */
export function setContentSize(state: ZoomSnapshot, size: ZoomSize): ZoomSnapshot {
  const contentSize = isZero(size) ? { width: 0, height: 0 } : size;
  return { ...state, contentSize, fitContentSize: fitContentSize(state.layoutSize, contentSize) };
}

/** L162-168 `reset()`。 */
export function resetZoom(state: ZoomSnapshot, initialScale = ZOOM_DEFAULTS.initialScale): ZoomSnapshot {
  return { ...state, scale: initialScale, offsetX: 0, offsetY: 0, active: false };
}

/** L319-324 `calculateNewBounds(newScale)`。 */
export function calculateNewBounds(
  newScale: number,
  fit: ZoomSize,
  layoutSize: ZoomSize,
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
  const newWidth = fit.width * newScale;
  const newHeight = fit.height * newScale;
  const boundX = Math.max(newWidth - layoutSize.width, 0) * 0.5;
  const boundY = Math.max(newHeight - layoutSize.height, 0) * 0.5;
  return { left: -boundX, top: -boundY, right: boundX, bottom: boundY };
}

/** L300-317 `calculateNewOffset(newScale, position, pan)`。 */
export function calculateNewOffset(
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  newScale: number,
  position: ZoomPoint,
  pan: ZoomPoint,
): ZoomPoint {
  const fit = state.fitContentSize;
  const size = { width: fit.width * state.scale, height: fit.height * state.scale };
  const newSize = { width: fit.width * newScale, height: fit.height * newScale };
  const deltaWidth = newSize.width - size.width;
  const deltaHeight = newSize.height - size.height;

  // L306-308 `position` 以内容左上角为原点。
  const xInContent = position.x - state.offsetX + (size.width - state.layoutSize.width) * 0.5;
  const yInContent = position.y - state.offsetY + (size.height - state.layoutSize.height) * 0.5;
  // L310-311 围绕 position 缩放所需的偏移增量。
  const deltaX = deltaWidth * 0.5 - (deltaWidth * xInContent) / (size.width === 0 ? 1 : size.width);
  const deltaY = deltaHeight * 0.5 - (deltaHeight * yInContent) / (size.height === 0 ? 1 : size.height);

  return { x: state.offsetX + pan.x + deltaX, y: state.offsetY + pan.y + deltaY };
}

/** L188-211 `willChangeOffset(pan)`。 */
export function willChangeOffset(
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  pan: ZoomPoint,
): boolean {
  const bounds = calculateNewBounds(state.scale, state.fitContentSize, state.layoutSize);
  const ratio = Math.abs(pan.x) / (Math.abs(pan.y) === 0 ? 1e-6 : Math.abs(pan.y));
  if (ratio > ZOOM_PAN_HORIZONTAL_RATIO) {
    if (pan.x < 0 && state.offsetX === bounds.left) return false;
    if (pan.x > 0 && state.offsetX === bounds.right) return false;
  } else if (ratio < ZOOM_PAN_VERTICAL_RATIO) {
    if (pan.y < 0 && state.offsetY === bounds.top) return false;
    if (pan.y > 0 && state.offsetY === bounds.bottom) return false;
  }
  return true;
}

export interface ApplyGestureInput {
  readonly pan: ZoomPoint;
  readonly zoom: number;
  readonly position: ZoomPoint;
  /** L218 `enableBounce: Boolean = true`。 */
  readonly enableBounce?: boolean;
  readonly maxScale?: number;
}

export interface ApplyGestureResult {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** L239-245：`zoom == 1f` 时喂 velocityTracker，否则重置（pinch 不是 pan flick）。 */
  readonly feedVelocity: boolean;
  /** L243 `gestureChangedScale = true`。 */
  readonly changedScale: boolean;
}

/** L213-246 `applyGesture(...)`。 */
export function applyGesture(
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  input: ApplyGestureInput,
): ApplyGestureResult {
  const maxScale = input.maxScale ?? ZOOM_DEFAULTS.maxScale;
  const minScale = input.enableBounce === false ? 1 : ZOOM_DEFAULTS.bounceMinScale;
  const newScale = Math.min(Math.max(state.scale * input.zoom, minScale), maxScale);
  const newOffset = calculateNewOffset(state, newScale, input.position, input.pan);
  const bounds = calculateNewBounds(newScale, state.fitContentSize, state.layoutSize);
  return {
    scale: newScale,
    offsetX: Math.min(Math.max(newOffset.x, bounds.left), bounds.right),
    offsetY: Math.min(Math.max(newOffset.y, bounds.top), bounds.bottom),
    feedVelocity: input.zoom === 1,
    changedScale: input.zoom !== 1,
  };
}

/** L248-261 `applyPan(pan, scope)`：返回被消费掉的位移。 */
export function applyPan(
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  pan: ZoomPoint,
): { readonly offsetX: number; readonly offsetY: number; readonly consumed: ZoomPoint } {
  const bounds = calculateNewBounds(state.scale, state.fitContentSize, state.layoutSize);
  const newOffsetX = Math.min(Math.max(state.offsetX + pan.x, bounds.left), bounds.right);
  const newOffsetY = Math.min(Math.max(state.offsetY + pan.y, bounds.top), bounds.bottom);
  return {
    offsetX: newOffsetX,
    offsetY: newOffsetY,
    consumed: { x: newOffsetX - state.offsetX, y: newOffsetY - state.offsetY },
  };
}

/** L272-298 `changeScale(targetScale, position, animationSpec = spring())`。 */
export function changeScale(
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  targetScale: number,
  position: ZoomPoint,
  maxScale = ZOOM_DEFAULTS.maxScale,
): { readonly scale: number; readonly offsetX: number; readonly offsetY: number } {
  const newScale = Math.min(Math.max(targetScale, 1), maxScale);
  const newOffset = calculateNewOffset(state, newScale, position, { x: 0, y: 0 });
  const bounds = calculateNewBounds(newScale, state.fitContentSize, state.layoutSize);
  return {
    scale: newScale,
    offsetX: Math.min(Math.max(newOffset.x, bounds.left), bounds.right),
    offsetY: Math.min(Math.max(newOffset.y, bounds.top), bounds.bottom),
  };
}

/**
 * `Modifier.zoomable` 的默认双击行为（`Zoomable.kt` L66-68）：
 * `if (zoomEnabled) zoomState.toggleScale(2.5f, position)` —— 1 与 2.5 之间切换。
 */
export function toggleScaleTarget(currentScale: number, doubleTapScale = ZOOM_DEFAULTS.doubleTapScale): number {
  return currentScale > 1.0001 ? 1 : doubleTapScale;
}

/** L326-340 `startFling()`：`gestureChangedScale` 时没有任何惯性。 */
export function startFlingVelocity(
  gestureChangedScale: boolean,
  velocity: ZoomPoint,
): { readonly x: number; readonly y: number } {
  if (gestureChangedScale) return { x: 0, y: 0 };
  return { x: velocity.x === 0 ? 0 : velocity.x, y: velocity.y === 0 ? 0 : velocity.y };
}

/** L349-392 `centerByContentCoordinate(offset, scale = 3f, tween(700))`。 */
export function centerByContentCoordinate(
  state: Pick<ZoomSnapshot, 'layoutSize' | 'contentSize' | 'fitContentSize'>,
  offset: ZoomPoint,
  scale = ZOOM_DEFAULTS.centerScale,
): { readonly scale: number; readonly offsetX: number; readonly offsetY: number } {
  const fit = state.fitContentSize;
  const factor = state.contentSize.width === 0 ? 0 : fit.width / state.contentSize.width;
  const boundX = Math.max(fit.width * scale - state.layoutSize.width, 0) / 2;
  const boundY = Math.max(fit.height * scale - state.layoutSize.height, 0) / 2;
  return {
    scale,
    offsetX: Math.min(Math.max((fit.width / 2 - offset.x * factor) * scale, -boundX), boundX),
    offsetY: Math.min(Math.max((fit.height / 2 - offset.y * factor) * scale, -boundY), boundY),
  };
}

/** L401-415 `centerByLayoutCoordinate(offset, scale = 3f, tween(700))`。 */
export function centerByLayoutCoordinate(
  state: Pick<ZoomSnapshot, 'layoutSize' | 'fitContentSize'>,
  offset: ZoomPoint,
  scale = ZOOM_DEFAULTS.centerScale,
): { readonly scale: number; readonly offsetX: number; readonly offsetY: number } {
  const fit = state.fitContentSize;
  const boundX = Math.max(fit.width * scale - state.layoutSize.width, 0) / 2;
  const boundY = Math.max(fit.height * scale - state.layoutSize.height, 0) / 2;
  return {
    scale,
    offsetX: Math.min(Math.max((state.layoutSize.width / 2 - offset.x) * scale, -boundX), boundX),
    offsetY: Math.min(Math.max((state.layoutSize.height / 2 - offset.y) * scale, -boundY), boundY),
  };
}

/**
 * `DetectMouseWheelZoom.kt` L23：
 * `zoom = (1f + scrollDelta * SCROLL_TO_ZOOM_RATE).coerceIn(MIN_ZOOM, MAX_ZOOM)`。
 */
export function mouseWheelZoomFactor(scrollDeltaY: number): number {
  return Math.min(
    Math.max(1 + scrollDeltaY * SCROLL_TO_ZOOM_RATE, MOUSE_WHEEL_MIN_ZOOM),
    MOUSE_WHEEL_MAX_ZOOM,
  );
}

/**
 * `Modifier.zoomable` 的滚动手势传播判定（`ScrollGesturePrpagation.kt` L9-21 +
 * `Zoomable.kt` 的 `scrollGesturePropagation` 分支）：
 *   `NotZoomed`  —— 未缩放（scale ≈ 1）时把滚动交给父级
 *   `ContentEdge`—— 内容滚到边还想继续滚时交给父级
 */
export function shouldPropagateScroll(
  mode: ScrollGesturePropagationValue,
  state: Pick<ZoomSnapshot, 'scale' | 'offsetX' | 'offsetY' | 'fitContentSize' | 'layoutSize'>,
  pan: ZoomPoint,
): boolean {
  if (mode === ScrollGesturePropagation.NotZoomed) return Math.abs(state.scale - 1) < 1e-3;
  return !willChangeOffset(state, pan);
}

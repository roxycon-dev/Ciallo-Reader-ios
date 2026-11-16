/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/WenkuReflow.kt`
 *   L77       REFLOW_DURATION_MS = 420                 → REFLOW_DURATION_MS
 *   L80       WORKSPACE_CLOSE_MS = 280                 → WORKSPACE_CLOSE_MS
 *   L83-84    REFLOW_STAGGER_STEP / _BANDS             → REFLOW_STAGGER_STEP / REFLOW_STAGGER_BANDS
 *   L87       REFLOW_RISE_DP = 10f                     → REFLOW_RISE_DP
 *   L89-93    WORKSPACE_*（1000/500/1200/1440/24）      → WORKSPACE_* 常量
 *   L96       ReflowEasing = Cubic(.18,.72,.18,1)      → reflowCurve（motion.ts）
 *   L146-151  progress（未激活恒为 1，缓动后）           → reflowProgress
 *   L239-252  viewport(size) 的 lerp                    → viewportRect
 *   L255-266  visibleSize（同尺寸不裁剪）                → visibleSize
 *   L292-298  paintedRect                               → paintedRect
 *   L301-312  currentViewportRoot 的 lerp               → currentViewportRoot
 *   L327-335  staggerProgress                          → staggerProgress
 *   L362-404  wenkuReflowItemLayer（平移 + 上浮 + 裁剪） → reflowItemTransform
 *   L485-605  WenkuSplitWorkspace 的宽屏判据与列宽       → splitWorkspaceLayout
 *   L616-648  wenkuDetailPlane（斜切揭示 + 层内位移）     → detailPlanePlan
 *
 * 未移植（组合/动画运行时）：
 * - `WenkuReflowState` 的可变状态机（`begin/end/pushClock/observe/forget`、`mutableStateMapOf`、
 *   420ms 帧循环、`generation` 竞态收尾）。本层只保留"给定状态快照 → 变换"的纯投影；
 *   状态机由 UI 层用 `useRef` + rAF 持有，语义见本文件 `reflowProgress`。
 * - `Modifier.onGloballyPositioned` / `graphicsLayer` / `drawWithContent` 本身。
 * - `wenkuBlockWhile` / `wenkuHiddenDraw` 的指针/绘制拦截（UI 层职责）。
 */

import { clamp, reflowCurve } from './motion';
import { WENKU_REFLOW } from './tokens';
import { planeEase, planeOffsetX, planeOffsetY, planeSlant, planeViewportPoints } from './flight';
import type {
  Quad,
  RectF,
  ReflowItemTransform,
  Size2,
  SplitWorkspaceLayout,
  Vec2,
} from './types';

/** `REFLOW_DURATION_MS = 420`。 */
export const REFLOW_DURATION_MS = WENKU_REFLOW.durationMs;
/** `WORKSPACE_CLOSE_MS = 280`。 */
export const WORKSPACE_CLOSE_MS = WENKU_REFLOW.workspaceCloseMs;
/** `(order % 9) * .025`。 */
export const REFLOW_STAGGER_STEP = WENKU_REFLOW.staggerStep;
/** 错峰档位上限：9。 */
export const REFLOW_STAGGER_BANDS = WENKU_REFLOW.staggerBands;
/** 未参与重排的子项上浮距离（dp）。 */
export const REFLOW_RISE_DP = WENKU_REFLOW.riseDp;

export const WORKSPACE_WIDE_MIN_WIDTH_DP = WENKU_REFLOW.wideMinWidthDp;
export const WORKSPACE_WIDE_MIN_HEIGHT_DP = WENKU_REFLOW.wideMinHeightDp;
export const WORKSPACE_MAX_WIDTH_DP = WENKU_REFLOW.maxWidthDp;
export const WORKSPACE_SELECTED_MAX_WIDTH_DP = WENKU_REFLOW.selectedMaxWidthDp;
export const WORKSPACE_GAP_DP = WENKU_REFLOW.gapDp;

/**
 * `WenkuReflowState.progress`：未激活恒为 1；激活时是 `ReflowEasing(clamp(raw))`。
 * `raw` 由调用方的时钟给出（正向 420ms，或反向 `1 - value` 的 280ms）。
 */
export function reflowProgress(raw: number, active: boolean): number {
  if (!active) return 1;
  return reflowCurve(clamp(raw, 0, 1));
}

/** `((progress - (order % 9) * .025) / (1 - (order % 9) * .025))`，夹到 0..1。 */
export function staggerProgress(progress: number, order: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const bandIndex =
    (((order % REFLOW_STAGGER_BANDS) + REFLOW_STAGGER_BANDS) % REFLOW_STAGGER_BANDS) ||
    0;
  if (bandIndex === 0) return progress;
  const start = bandIndex * REFLOW_STAGGER_STEP;
  return clamp((progress - start) / (1 - start), 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** `Size.lerp(source.size, layout, progress)`；相等尺寸直接返回 null（不裁剪）。 */
export function visibleSize(
  source: Size2 | null,
  layout: Size2,
  progress: number,
): Size2 | null {
  if (source === null) return null;
  if (progress >= 1) return null;
  if (
    Math.abs(source.width - layout.width) < WENKU_REFLOW.sizeEpsilon &&
    Math.abs(source.height - layout.height) < WENKU_REFLOW.sizeEpsilon
  ) {
    return null;
  }
  return {
    width: lerp(source.width, layout.width, progress),
    height: lerp(source.height, layout.height, progress),
  };
}

/** `viewport(size)`：从旧视口（换成容器本地坐标）插值到当前边界。 */
export function viewportRect(
  sourceViewport: RectF | null,
  containerRoot: Vec2,
  size: Size2,
  active: boolean,
  progress: number,
): RectF {
  const bounds: RectF = { left: 0, top: 0, right: size.width, bottom: size.height };
  if (sourceViewport === null || !active) return bounds;
  if (progress >= 1) return bounds;
  const shifted: RectF = {
    left: sourceViewport.left - containerRoot.x,
    top: sourceViewport.top - containerRoot.y,
    right: sourceViewport.right - containerRoot.x,
    bottom: sourceViewport.bottom - containerRoot.y,
  };
  return {
    left: lerp(shifted.left, bounds.left, progress),
    top: lerp(shifted.top, bounds.top, progress),
    right: lerp(shifted.right, bounds.right, progress),
    bottom: lerp(shifted.bottom, bounds.bottom, progress),
  };
}

/** `paintedRect`：布局矩形 + 本轮位移 + 插值尺寸（root 坐标）。 */
export function paintedRect(layout: RectF, source: RectF | null, progress: number): RectF {
  if (source === null) return layout;
  const dx = (source.left - layout.left) * (1 - progress);
  const dy = (source.top - layout.top) * (1 - progress);
  const width = lerp(source.right - source.left, layout.right - layout.left, progress);
  const height = lerp(source.bottom - source.top, layout.bottom - layout.top, progress);
  return {
    left: layout.left + dx,
    top: layout.top + dy,
    right: layout.left + dx + width,
    bottom: layout.top + dy + height,
  };
}

/**
 * `wenkuReflowItemLayer`：一个子项在某一帧的平移 / 透明度 / 可见尺寸裁剪。
 * - 参与重排（有旧矩形）：`(source.topLeft - live.topLeft) * (1 - p)`，alpha 1，按插值尺寸裁剪；
 * - 未参与：10dp 上浮 + 透明度揭示，按 order 错峰。
 */
export function reflowItemTransform(input: {
  readonly active: boolean;
  readonly progress: number;
  readonly source: RectF | null;
  readonly live: RectF | null;
  readonly layout: Size2;
  readonly order: number;
  readonly density: number;
}): ReflowItemTransform {
  const p = input.progress;
  if (!input.active || p >= 1) {
    return { translationX: 0, translationY: 0, alpha: 1, clip: null };
  }
  if (input.source !== null) {
    const origin = input.live ?? input.source;
    const sourceSize: Size2 = {
      width: input.source.right - input.source.left,
      height: input.source.bottom - input.source.top,
    };
    return {
      translationX: (input.source.left - origin.left) * (1 - p),
      translationY: (input.source.top - origin.top) * (1 - p),
      alpha: 1,
      clip: visibleSize(sourceSize, input.layout, p),
    };
  }
  const reveal = staggerProgress(p, input.order);
  return {
    translationX: 0,
    translationY: REFLOW_RISE_DP * input.density * (1 - reveal),
    alpha: reveal,
    clip: null,
  };
}

/** `WenkuSplitWorkspace` 的宽屏判据与列宽（L548-567）。 */
export function splitWorkspaceLayout(input: {
  readonly maxWidthDp: number;
  readonly maxHeightDp: number;
  readonly expanded: boolean;
  readonly closing: boolean;
}): SplitWorkspaceLayout {
  const wide =
    input.maxWidthDp >= WORKSPACE_WIDE_MIN_WIDTH_DP &&
    input.maxHeightDp >= WORKSPACE_WIDE_MIN_HEIGHT_DP;
  const selected = input.expanded;
  const cap =
    selected && wide ? WORKSPACE_SELECTED_MAX_WIDTH_DP : WORKSPACE_MAX_WIDTH_DP;
  const total = Math.min(input.maxWidthDp, cap);
  const split = (total - WORKSPACE_GAP_DP) / 2;
  const master =
    selected && wide && !input.closing
      ? split
      : total < WORKSPACE_MAX_WIDTH_DP
        ? total
        : WORKSPACE_MAX_WIDTH_DP;
  const masterLeft = input.closing && wide ? (total - master) / 2 : 0;
  const detailLeft = wide ? split + WORKSPACE_GAP_DP : 0;
  return {
    wide,
    selected,
    total,
    split,
    master,
    masterLeft,
    detailLeft,
    detailWidth: total - detailLeft,
    listHidden: selected && !wide,
  };
}

/** `wenkuDetailPlane`（`ArchivePlaneTransition.incoming`）：斜切窗口 + 层内位移。 */
export interface DetailPlanePlan {
  readonly visible: boolean;
  readonly clip: Quad;
  readonly translationX: number;
  readonly translationY: number;
}

export function detailPlanePlan(
  progress: number,
  size: Size2,
  density: number,
  direction = 1,
): DetailPlanePlan {
  const p = planeEase(progress);
  if (p >= 1) {
    return { visible: true, clip: fullQuad(size), translationX: 0, translationY: 0 };
  }
  if (p <= 0) {
    return { visible: false, clip: fullQuad(size), translationX: 0, translationY: 0 };
  }
  const slant = planeSlant(size.width, 180 * density);
  const points = planeViewportPoints(size.width, size.height, p, direction, slant);
  const clip: Quad = {
    points: [
      { x: points[0], y: points[1] },
      { x: points[2], y: points[3] },
      { x: points[4], y: points[5] },
      { x: points[6], y: points[7] },
    ],
  };
  return {
    visible: true,
    clip,
    translationX: planeOffsetX(p, direction) * density,
    translationY: planeOffsetY(p) * density,
  };
}

function fullQuad(size: Size2): Quad {
  return {
    points: [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ],
  };
}

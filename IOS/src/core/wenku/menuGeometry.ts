/**
 * 玻璃菜单的几何与曲线 —— `ui/wenku/WenkuMenuHost.kt` L115-960 的逐行 TS 移植。
 *
 * 这些函数全部是纯数学（Flutter `motion_ui.dart` / `app_ui.dart` / `archive_motion.dart`
 * 公式的等价实现），与 Compose / DOM 无关，因此放在 `src/core/**` 供两端共用。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L120 `WenkuEaseOut = CubicBezierEasing(0, 0, .58, 1)`            → `WENKU_MENU_CURVES.easeOut`
 *   L123 `WenkuEaseInOut = CubicBezierEasing(.42, 0, .58, 1)`        → `.easeInOut`
 *   L126 `WenkuMenuWidthCurve = CubicBezierEasing(.18, 1.10, .30, 1)` → `.width`
 *   L129 `WenkuMenuHeightCurve = CubicBezierEasing(.22, 1.04, .32, 1)`→ `.height`
 *   L132 `WenkuPlaneCurve = CubicBezierEasing(.18, .72, .18, 1)`     → `.plane`
 *   L135 `WenkuMenuHitThreshold = 0.15f`                             → `WENKU_MENU_HIT_THRESHOLD`
 *   L138 `WenkuMenuContentThreshold = 0.34f`                         → `WENKU_MENU_CONTENT_THRESHOLD`
 *   L141-146 `WenkuMenuStagger{Start,End,Step,MaxOrder}` = .06/.62/.025/8 → 同名常量
 *   L149 `WenkuMenuBarrier = Color.Transparent`                      → `WENKU_MENU_BARRIER`
 *   L152 `WenkuSheetBarrier = WenkuTokens.Scrim`（黑 @.16）           → `WENKU_SHEET_BARRIER_ALPHA`
 *   L155 `WenkuStaticPhase = { 1f }`                                 → `wenkuStaticPhase`
 *   L162-163 `wenkuMenuSourceAlpha(phase) = 1 - Interval(0, .22, easeInOut)` → 同名
 *   L585-614 `WenkuStaggerPart(order)`：`start = .06 + band*.025`、`end = .62 + band*.025`
 *   L778-779 `wenkuLerp(start, stop, fraction)`                      → 同名
 *   L781-786 `wenkuLerpRect(start, stop, fraction)`                  → 同名
 *   L788 `wenkuEaseOutCubic(raw)`                                    → 同名
 *   L791-795 `wenkuInterval(raw, start, end, curve)`                 → 同名
 *   L798-799 `wenkuRevealProgress(raw, start, end)`                  → 同名
 *   L808-820 `wenkuMenuCurrentRect(raw, anchor, target)`              → 同名
 *   L823-824 `wenkuMenuContentAlpha(phase)`                          → 同名
 *   L827-837 `wenkuMenuViewportRadius(...)`                          → 同名
 *   L840-851 `wenkuSafeRect(constraints, insets, …)` → `wenkuSafeRect(size, insets)`
 *   L854-858 `wenkuMenuArea(anchor, safe, insetPx, edgePx)`          → 同名
 *   L865-872 `wenkuMenuTargetRect(anchor, child, area)`              → 同名
 *   L883-899 `Modifier.wenkuPointerGate(threshold, phase)` → `wenkuPointerGateBlocks(phase, threshold)`
 *   L913-960 `sheetDragModifier(...)` 的判定 → `sheetDragShouldDismiss(velocity, dragged, height, threshold)`
 *
 * 平台差异（已登记 E125）：以上全部为纯函数，`Modifier` / `Animatable` / `VelocityTracker`
 * 的接线由 `src/ui/components/wenku/WenkuMenuHost.tsx` 负责；数值一值未改。
 */
import { cubicBezier } from './motion';

export interface WenkuRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function rectWidth(r: WenkuRect): number {
  return r.right - r.left;
}

export function rectHeight(r: WenkuRect): number {
  return r.bottom - r.top;
}

export function rectCenter(r: WenkuRect): { readonly x: number; readonly y: number } {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

/** L120-132 的五条曲线（控制点逐值）。 */
export const WENKU_MENU_CURVES = {
  /** L120 `Curves.easeOut`。 */
  easeOut: [0, 0, 0.58, 1] as const,
  /** L123 `Curves.easeInOut`。 */
  easeInOut: [0.42, 0, 0.58, 1] as const,
  /** L126 宽曲线。 */
  width: [0.18, 1.1, 0.3, 1] as const,
  /** L129 高曲线。 */
  height: [0.22, 1.04, 0.32, 1] as const,
  /** L132 斜切平面。 */
  plane: [0.18, 0.72, 0.18, 1] as const,
} as const;

const easeOut = cubicBezier(...WENKU_MENU_CURVES.easeOut);
const easeInOut = cubicBezier(...WENKU_MENU_CURVES.easeInOut);
const widthCurve = cubicBezier(...WENKU_MENU_CURVES.width);
const heightCurve = cubicBezier(...WENKU_MENU_CURVES.height);

/** L135 `GlassMenuStretchRender.hitTest` 阈值。 */
export const WENKU_MENU_HIT_THRESHOLD = 0.15;
/** L138 `GlassMenuContentsRender.hitTest` / 语义阈值。 */
export const WENKU_MENU_CONTENT_THRESHOLD = 0.34;

/** L141-146 菜单项错峰。 */
export const WenkuMenuStaggerStart = 0.06;
export const WenkuMenuStaggerEnd = 0.62;
export const WenkuMenuStaggerStep = 0.025;
export const WenkuMenuStaggerMaxOrder = 8;

/** L149 `WenkuMenuBarrier = Color.Transparent`。 */
export const WENKU_MENU_BARRIER = 'transparent';
/** L152 `WenkuSheetBarrier = WenkuTokens.Scrim`（`Color.Black.copy(alpha = .16f)`）。 */
export const WENKU_SHEET_BARRIER_ALPHA = 0.16;

/** L155 `WenkuStaticPhase = { 1f }`（reduceMotion / 装饰动效关闭时直接显示）。 */
export function wenkuStaticPhase(): number {
  return 1;
}

/** L162-163 `wenkuMenuSourceAlpha(phase) = 1 - Interval(0, .22, easeInOut)`。 */
export function wenkuMenuSourceAlpha(phase: number): number {
  return 1 - wenkuInterval(phase, 0, 0.22, easeInOut);
}

/** L778-779 `wenkuLerp(start, stop, fraction)`。 */
export function wenkuLerp(start: number, stop: number, fraction: number): number {
  return start + (stop - start) * fraction;
}

/** L781-786 `wenkuLerpRect(start, stop, fraction)`。 */
export function wenkuLerpRect(start: WenkuRect, stop: WenkuRect, fraction: number): WenkuRect {
  return {
    left: wenkuLerp(start.left, stop.left, fraction),
    top: wenkuLerp(start.top, stop.top, fraction),
    right: wenkuLerp(start.right, stop.right, fraction),
    bottom: wenkuLerp(start.bottom, stop.bottom, fraction),
  };
}

/** L788 `wenkuEaseOutCubic(raw) = WenkuMotion.ease.transform(raw.coerceIn(0f, 1f))`。 */
export function wenkuEaseOutCubic(raw: number): number {
  // `WenkuMotion.ease` = `CubicBezierEasing(0.215, 0.61, 0.355, 1)`
  return motionEase(clamp01(raw));
}

const motionEase = cubicBezier(0.215, 0.61, 0.355, 1);

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/** L791-795 `wenkuInterval(raw, start, end, curve)`。 */
export function wenkuInterval(
  raw: number,
  start: number,
  end: number,
  curve: (t: number) => number,
): number {
  if (end <= start) return raw >= end ? 1 : 0;
  return clamp01(curve(clamp01((raw - start) / (end - start))));
}

/** L798-799 `wenkuRevealProgress(raw, start, end)`。 */
export function wenkuRevealProgress(raw: number, start: number, end: number): number {
  return wenkuInterval(raw, start, end, motionEase);
}

/** L585-614 `WenkuStaggerPart(order)` 的窗口。 */
export function wenkuStaggerPartWindow(order: number): { readonly start: number; readonly end: number } {
  const band = Math.min(Math.max(order, 0), WenkuMenuStaggerMaxOrder);
  return {
    start: WenkuMenuStaggerStart + band * WenkuMenuStaggerStep,
    end: WenkuMenuStaggerEnd + band * WenkuMenuStaggerStep,
  };
}

/**
 * L808-820 `wenkuMenuCurrentRect(raw, anchor, target)`。
 *
 * 位置用 `lerp(anchor, target, easeOutCubic(raw))`；宽、高各自用独立的宽/高曲线，
 * 全部取**未缓动**的原始时钟；`growsDown` 决定纵向贴顶还是贴底，横向永远贴右。
 */
export function wenkuMenuCurrentRect(raw: number, anchor: WenkuRect, target: WenkuRect): WenkuRect {
  const phase = clamp01(raw);
  const eased = motionEase(phase);
  const lerped = wenkuLerpRect(anchor, target, eased);
  const widthProgress = widthCurve(phase);
  const heightProgress = heightCurve(phase);
  const width = wenkuLerp(rectWidth(anchor), rectWidth(target), widthProgress);
  const height = wenkuLerp(rectHeight(anchor), rectHeight(target), heightProgress);
  const growsDown = rectCenter(target).y >= rectCenter(anchor).y;
  const left = lerped.right - width;
  const top = growsDown ? lerped.top : lerped.bottom - height;
  return { left, top, right: left + width, bottom: top + height };
}

/** L823-824 `wenkuMenuContentAlpha(phase) = Interval(.06, .34, easeOut)`。 */
export function wenkuMenuContentAlpha(phase: number): number {
  return wenkuInterval(phase, 0.06, 0.34, easeOut);
}

/** L827-837 `wenkuMenuViewportRadius(...)`。 */
export function wenkuMenuViewportRadius(
  phase: number,
  viewportWidth: number,
  viewportHeight: number,
  sourceRadiusPx: number,
  finalRadiusPx: number,
): number {
  const shortestSide = Math.min(viewportWidth, viewportHeight);
  const grown = wenkuLerp(sourceRadiusPx, finalRadiusPx, wenkuEaseOutCubic(phase));
  return Math.min(shortestSide / 2, grown);
}

/** L840-851 `wenkuSafeRect(constraints, insets, …)`：安全区内缩后的可用区。 */
export function wenkuSafeRect(
  size: { readonly width: number; readonly height: number },
  insets: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
): WenkuRect {
  const left = insets.left;
  const top = insets.top;
  const right = size.width - insets.right;
  const bottom = size.height - insets.bottom;
  return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
}

/** L854-858 `wenkuMenuArea(anchor, safe, insetPx, edgePx)`。 */
export function wenkuMenuArea(anchor: WenkuRect, safe: WenkuRect, insetPx: number, edgePx: number): WenkuRect {
  const safeW = rectWidth(safe);
  const safeH = rectHeight(safe);
  const left = safe.left + Math.min(insetPx, safeW / 2);
  const top = Math.min(safe.top + Math.min(insetPx, safeH / 2), Math.max(0, anchor.top));
  return {
    left,
    top,
    right: left + Math.max(0, safeW - edgePx),
    bottom: top + Math.max(0, safeH - edgePx),
  };
}

/**
 * L865-872 `wenkuMenuTargetRect(anchor, child, area)`，`preferBelow = false`：
 * 横向贴锚点右边，纵向优先从 `anchor.top` 向下，放不下再翻到 `anchor.bottom` 上方。
 */
export function wenkuMenuTargetRect(
  anchor: WenkuRect,
  child: { readonly width: number; readonly height: number },
  area: WenkuRect,
): WenkuRect {
  const maxLeft = Math.max(area.left, area.right - child.width);
  const x = Math.min(Math.max(anchor.right - child.width, area.left), maxLeft);
  const below = anchor.top;
  const rawY = below + child.height <= area.bottom ? below : anchor.bottom - child.height;
  const y = Math.min(Math.max(rawY, area.top), Math.max(area.top, area.bottom - child.height));
  return { left: x, top: y, right: x + child.width, bottom: y + child.height };
}

/**
 * L883-899 `Modifier.wenkuPointerGate(threshold, phase)`：
 * `phase() < threshold` 时整段手势被吞掉（对齐 Flutter `hitTest` 返回 false）。
 */
export function wenkuPointerGateBlocks(phase: number, threshold: number): boolean {
  return phase < threshold;
}

/**
 * L947-951 `onDragEnd` 的判定：
 * `primaryVelocity > velocityThresholdPx || dragged > height * WenkuTokens.SheetDismissFraction`。
 */
export function sheetDragShouldDismiss(
  primaryVelocity: number,
  dragged: number,
  panelHeight: number,
  velocityThresholdPx: number,
  dismissFraction = 0.24,
): boolean {
  return primaryVelocity > velocityThresholdPx || dragged > panelHeight * dismissFraction;
}

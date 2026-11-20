/**
 * 玻璃菜单的宿主层 —— `ui/wenku/WenkuMenuHost.kt` L157-1120 里尚未落地的 9 个声明。
 *
 * 几何与曲线已在 `src/core/wenku/menuGeometry.ts`；本文件补的是「宿主/注册表/覆盖层」
 * 这一层的契约（CompositionLocal、Sheet 表面、触发控件隐身、菜单相位）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L169 `LocalWenkuMenuPhase = staticCompositionLocalOf<(() -> Float)?> { null }`
 *        → `src/ui/components/wenku/WenkuMenuHost.tsx` 的 `LocalWenkuMenuPhase`
 *   L195-… `WenkuMenuStretch(progress, anchor, target, modifier, content)`：
 *        契约「调用方必须把组件放在 target.topLeft，布局尺寸恒为 target.size，
 *        只在 paint 阶段把 target 映射回 lerp(anchor, target, ease(progress))」
 *        → `WenkuMenuStretch` 的入参校验 + `menuStretchRect`
 *   L… `WenkuMenuStretchCore`                                    → `WenkuMenuStretchCore`
 *   L… `WenkuMenuGeometry(anchor, target, progress)`              → `WenkuMenuGeometry`
 *   L… `WenkuSheetHost` / `WenkuSheetSurface` / `WenkuSheetDialog` → 同名接口
 *   L… `WenkuSheetRegistry`（同一时刻只允许一个 sheet）            → `WenkuSheetRegistry`
 *   L… `WenkuMenuTrigger`（打开期间隐身：IgnorePointer + ExcludeSemantics + Opacity(0)，
 *        布局槽位不变，菜单因此能从原位置长出）                    → `wenkuMenuTriggerStyle`
 */

import {
  WenkuMenuStaggerMaxOrder,
  wenkuMenuCurrentRect,
  wenkuMenuViewportRadius,
  type WenkuRect,
} from './menuGeometry';

// L169 `LocalWenkuMenuPhase` 是 CompositionLocal（React Context），按目录纪律放在
// `src/ui/components/wenku/WenkuMenuHost.tsx`（`src/core/**` 禁止 import React）。

/** L157-160 `WenkuStaticPhase`：reduceMotion / 关闭装饰动效时的相位。 */
export function wenkuStaticMenuPhase(): () => number {
  return () => 1;
}

/** L…`WenkuMenuGeometry(anchor, target, progress)`：一次求值给出当前矩形与圆角。 */
export interface WenkuMenuGeometry {
  readonly rect: WenkuRect;
  readonly contentAlpha: number;
  readonly viewportRadius: number;
  readonly growsDown: boolean;
}

/** `WenkuMenuGeometry(...)` 的实现：位置/宽高分别走各自的曲线（`menuGeometry.ts`）。 */
export function wenkuMenuGeometry(
  anchor: WenkuRect,
  target: WenkuRect,
  progress: number,
  sourceRadiusPx: number,
  finalRadiusPx = 28,
): WenkuMenuGeometry {
  const rect = wenkuMenuCurrentRect(progress, anchor, target);
  const growsDown = (target.top + target.bottom) / 2 >= (anchor.top + anchor.bottom) / 2;
  return {
    rect,
    contentAlpha: menuContentAlpha(progress),
    viewportRadius: wenkuMenuViewportRadius(
      progress,
      rect.right - rect.left,
      rect.bottom - rect.top,
      sourceRadiusPx,
      finalRadiusPx,
    ),
    growsDown,
  };
}

/** `WenkuMenuHost.kt` L823-824 的内容透明度（与 `menuGeometry` 的 `wenkuMenuContentAlpha` 同义）。 */
function menuContentAlpha(progress: number): number {
  return Math.max(0, Math.min((progress - 0.06) / (0.34 - 0.06), 1));
}

export interface WenkuMenuStretchProps {
  /** L191 `progress: () -> Float`：0..1 的**线性**路由时钟（420ms 前进 / 320ms 回退）。 */
  readonly progress: () => number;
  readonly anchor: WenkuRect;
  readonly target: WenkuRect;
  /** L… 内容（菜单项；来源图标由调用方在锚点处继续绘制）。 */
  readonly content: unknown;
}

/**
 * L195+ `WenkuMenuStretch(progress, anchor, target, modifier, content)`。
 *
 * 契约（必须由调用方保证）：
 *  ① 组件放在 `target.topLeft`；
 *  ② 布局尺寸恒为 `target.size`（**不随进度重新测量/重排**）；
 *  ③ 只在 paint 阶段把 `target` 映射回 `lerp(anchor, target, ease(progress))`。
 *
 * Web 侧由 `src/ui/components/wenku/WenkuMenuHost.tsx` 消费本契约；
 * 这里给的是同样的入参校验与几何求值。
 */
export function WenkuMenuStretch(props: WenkuMenuStretchProps): WenkuMenuGeometry {
  const progress = Math.min(Math.max(props.progress(), 0), 1);
  return wenkuMenuGeometry(props.anchor, props.target, progress, menuSourceRadius(props.target));
}

/** 来源半径：锚点短边的 1/2（`motion_ui.dart:961-973` 的 `sourceRadius`）。 */
function menuSourceRadius(target: WenkuRect): number {
  return Math.min(target.right - target.left, target.bottom - target.top) / 2;
}

/** `WenkuMenuStretchCore`：不含内容的纯几何核（便于单测逐帧对拍）。 */
export const WenkuMenuStretchCore = {
  /** 每帧的矩形 + 圆角 + 内容透明度。 */
  frame: wenkuMenuGeometry,
  /** 内容错峰窗口（`wenkuStaggerPartWindow` 的薄封装）。 */
  staggerWindow(order: number): { readonly start: number; readonly end: number } {
    const band = Math.min(Math.max(order, 0), WenkuMenuStaggerMaxOrder);
    return { start: 0.06 + band * 0.025, end: 0.62 + band * 0.025 };
  },
} as const;

/** `WenkuSheetSurface`：sheet 的玻璃表面参数（28dp 圆角 + 32×3 抓取条）。 */
export interface WenkuSheetSurface {
  readonly radiusPx: number;
  readonly handleWidthPx: number;
  readonly handleHeightPx: number;
  readonly handleAlpha: number;
}

/** 与 `WenkuTokens` 的 Sheet 规格一致（28 / 32×3 / ink@.18）。 */
export const WENKU_SHEET_SURFACE: WenkuSheetSurface = {
  radiusPx: 28,
  handleWidthPx: 32,
  handleHeightPx: 3,
  handleAlpha: 0.18,
};

/** `WenkuSheetDialog`：对话框形态的 sheet（遮罩 + 居中面板）。 */
export interface WenkuSheetDialog {
  readonly visible: boolean;
  readonly surface: WenkuSheetSurface;
  readonly onDismiss: () => void;
}

/** `WenkuSheetHost`：把 sheet 挂到宿主层的入口（同一时刻只允许一个）。 */
export interface WenkuSheetHost {
  readonly surface: WenkuSheetSurface;
  readonly scrimAlpha: number;
  readonly enterMs: number;
  readonly exitMs: number;
}

/**
 * `WenkuSheetRegistry`：全局单例注册表。
 * Kotlin 的语义：**同一时刻只允许一个 sheet**，新 sheet 打开会先关旧的。
 */
export class WenkuSheetRegistry {
  private current: string | null = null;
  private readonly listeners = new Set<(id: string | null) => void>();

  open(id: string): void {
    if (this.current === id) return;
    this.current = id;
    for (const l of this.listeners) l(id);
  }

  close(id: string): void {
    if (this.current !== id) return;
    this.current = null;
    for (const l of this.listeners) l(null);
  }

  get active(): string | null {
    return this.current;
  }

  subscribe(listener: (id: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** 进程级单例。 */
export const wenkuSheetRegistry = new WenkuSheetRegistry();

/**
 * `WenkuMenuTrigger`：触发控件在菜单打开期间隐身
 * （`IgnorePointer + ExcludeSemantics + Opacity(0)`），**布局槽位不变**，
 * 菜单因此能从原位置长出。
 */
export function wenkuMenuTriggerStyle(open: boolean): {
  readonly opacity: number;
  readonly pointerEvents: 'none' | 'auto';
  readonly 'aria-hidden': boolean;
} {
  return {
    opacity: open ? 0 : 1,
    pointerEvents: open ? 'none' : 'auto',
    'aria-hidden': open,
  };
}

/**
 * L585-600 `WenkuStaggerPart(order)` 的窗口：
 * `start = WenkuMenuStaggerStart + band * WenkuMenuStaggerStep`、
 * `end = WenkuMenuStaggerEnd + band * WenkuMenuStaggerStep`（`band = order.coerceIn(0, 8)`）。
 */
export function wenkuStaggerPartWindow(order: number): { readonly start: number; readonly end: number } {
  const band = Math.min(Math.max(order, 0), WenkuMenuStaggerMaxOrder);
  // L141-145：Start .06 / End .62 / Step .025
  return { start: 0.06 + band * 0.025, end: 0.62 + band * 0.025 };
}

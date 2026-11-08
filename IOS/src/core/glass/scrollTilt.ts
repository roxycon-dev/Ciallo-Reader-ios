/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ScrollTilt.kt` (181 non-blank lines)
 *
 *   lines 29-68  class ScrollTiltController + companion constants → ScrollTiltController
 *                (submitVelocity / velocityToDeg / isIdle / reset / SCROLL_VELOCITY_REFERENCE_PX_MS /
 *                 SCROLL_TILT_MAX_DEG / IDLE_TIMEOUT_NANOS)
 *   lines 71     FOLLOW_TAU_MS   → FOLLOW_TAU_MS
 *   lines 74     RELEASE_TAU_MS  → RELEASE_TAU_MS
 *   lines 77     LocalScrollTilt → ScrollTiltProvider (src/ui/components/ScrollTilt.tsx)
 *   lines 84-107 ScrollTiltHost  → src/ui/components/ScrollTilt.tsx#ScrollTiltHost
 *   lines 115-195 Lazy{List,Grid,StaggeredGrid}State.scrollTiltSource → useScrollTiltSource()
 *   lines 203-213 scrollDeltaPx() → scrollDeltaPx()
 *
 * `System.nanoTime()` → `performance.now()` (ms; every constant converted once).
 * `withFrameNanos {}` (rAF callback) → `requestAnimationFrame`.
 * Nothing skipped.
 */

/** ScrollTilt.kt line 61 — 速度归一化基准（px/ms）：2.2 ≈ 2200px/s 快速甩动时打满上限。 */
export const SCROLL_VELOCITY_REFERENCE_PX_MS = 2.2;

/** ScrollTilt.kt line 64 — 滚动惯性倾斜上限（度）：任务书建议 3°~8° 克制区间取中值。 */
export const SCROLL_TILT_MAX_DEG = 4.5;

/** ScrollTilt.kt line 66 — 滚动闲置判定阈值，原为 120_000_000L ns → 120 ms。 */
export const IDLE_TIMEOUT_MS = 120;

/** ScrollTilt.kt line 71 — 跟随手感时间常数（ms）：快速跟随滚动。 */
export const FOLLOW_TAU_MS = 55;

/** ScrollTilt.kt line 74 — 释放回正时间常数（ms）：≈0.9s 完全回正。 */
export const RELEASE_TAU_MS = 260;

/** ScrollTilt.kt line 97 — 完全归零后停写阈值。 */
export const TILT_EPSILON = 0.02;

/**
 * 全局滚动惯性倾斜控制器。
 *
 * list 滚动速度 → 归一化 → 倾斜角信号；全 App 单实例共享一个信号源。
 * In Compose the value lives in a `mutableFloatStateOf` read lazily inside
 * `graphicsLayer` so it never triggers recomposition.  The web equivalent is a
 * mutable object read from inside a `requestAnimationFrame` writer and applied
 * straight to a CSS custom property (`--glass-tilt-deg`) by the card layer,
 * so React never re-renders while scrolling either.
 */
export class ScrollTiltController {
  /** 当前平滑后的滚动倾斜角（度）。 */
  tiltDeg = 0;

  targetDeg = 0;

  lastEmitMs = 0;

  /** 滚动信号源每帧上报像素速度（px/ms，向下滚动为正）。 */
  submitVelocity(pxPerMs: number, nowMs: number): void {
    // 低通：单帧速度噪声大（布局抖动），新旧各半平滑后再钳制
    const raw = this.targetDeg * 0.5 + this.velocityToDeg(pxPerMs) * 0.5;
    this.targetDeg = Math.max(
      -SCROLL_TILT_MAX_DEG,
      Math.min(SCROLL_TILT_MAX_DEG, raw),
    );
    this.lastEmitMs = nowMs;
  }

  velocityToDeg(v: number): number {
    return (v / SCROLL_VELOCITY_REFERENCE_PX_MS) * SCROLL_TILT_MAX_DEG;
  }

  /** 滚动是否已闲置（超过 IDLE_TIMEOUT_MS 无新速度）——闲置即目标归零。 */
  isIdle(nowMs: number): boolean {
    return nowMs - this.lastEmitMs > IDLE_TIMEOUT_MS;
  }

  /** 画质降档卸载 Host 时复位信号，避免重进 MAX 档后残留旧角度缓慢回零。 */
  reset(): void {
    this.targetDeg = 0;
    this.lastEmitMs = 0;
    this.tiltDeg = 0;
  }

  /**
   * ScrollTilt.kt lines 90-104 — 一帧的指数趋近推进（由 rAF 循环调用）。
   * 非对称手感：滚动中短 τ 快速跟随；停止后长 τ 极软缓慢回正（无过冲）。
   */
  step(dtMs: number, nowMs: number): void {
    const idle = this.isIdle(nowMs);
    if (idle) this.targetDeg = 0;
    const target = this.targetDeg;
    const current = this.tiltDeg;
    const tau = idle ? RELEASE_TAU_MS : FOLLOW_TAU_MS;
    const k = 1 - Math.exp(-dtMs / tau);
    let next = current + (target - current) * k;
    // 完全归零后停写，避免长期驻留时每帧无效失效
    if (target === 0 && Math.abs(next) < TILT_EPSILON) next = 0;
    if (next !== current) this.tiltDeg = next;
  }
}

/** ScrollTilt.kt line 77 `LocalScrollTilt = staticCompositionLocalOf { ScrollTiltController() }` */
export const DEFAULT_SCROLL_TILT = new ScrollTiltController();

/**
 * ScrollTilt.kt lines 203-213 `scrollDeltaPx()` —
 * 帧间滚动像素位移（px，向下滚为正）：
 *  - 未跨界：offset 差分；
 *  - 跨 1 项：向下 = 旧首项真实高度 − 旧offset + 新offset；向上对称用新首项高度；
 *  - 跨多项/空布局：无法精确守恒，返回 null 丢弃该帧（宁缺勿假，防反向速度尖峰）。
 */
export function scrollDeltaPx(
  dIdx: number,
  dOffset: number,
  prevSize: number,
  itemSize: number,
): number | null {
  if (itemSize <= 0 || prevSize <= 0) return null;
  if (dIdx === 0) return dOffset;
  if (dIdx === 1) return prevSize + dOffset; // 旧首项高度 + offset 差分
  if (dIdx === -1) return dOffset - itemSize; // 新首项高度 + offset 差分（向上滚为负）
  return null;
}

export interface ScrollSample {
  /** firstVisibleItemIndex / nearest visible index */
  idx: number;
  /** firstVisibleItemScrollOffset */
  offset: number;
  /** first visible item's height in px */
  itemSize: number;
}

/**
 * ScrollTilt.kt lines 115-195 — 三个 `scrollTiltSource` 的共享实现。
 * The three Compose variants differ only in how the item size is read
 * (height for grid/staggered, full size for list), so one function takes the
 * already-resolved sample.
 */
export class ScrollTiltSampler {
  private prevIdx = Number.MIN_SAFE_INTEGER;
  private prevOffset = 0;
  private prevSize = 0;
  private prevMs = 0;

  /** Feed one sample; emits a velocity when the delta is conservative. */
  sample(s: ScrollSample, controller: ScrollTiltController, nowMs: number): void {
    if (this.prevIdx !== Number.MIN_SAFE_INTEGER) {
      const dPx = scrollDeltaPx(s.idx - this.prevIdx, s.offset - this.prevOffset, this.prevSize, s.itemSize);
      if (dPx !== null) {
        const dtMs = Math.max(1, nowMs - this.prevMs);
        controller.submitVelocity(dPx / dtMs, nowMs);
      }
    }
    this.prevIdx = s.idx;
    this.prevOffset = s.offset;
    this.prevSize = s.itemSize;
    this.prevMs = nowMs;
  }

  reset(): void {
    this.prevIdx = Number.MIN_SAFE_INTEGER;
    this.prevOffset = 0;
    this.prevSize = 0;
    this.prevMs = 0;
  }
}
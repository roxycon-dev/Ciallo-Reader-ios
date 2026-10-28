import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  DEFAULT_SCROLL_TILT,
  ScrollTiltController,
  ScrollTiltSampler,
  type ScrollSample,
} from '../../core/glass/scrollTilt';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ScrollTilt.kt` (181 non-blank lines)
 *   line  77 `val LocalScrollTilt = staticCompositionLocalOf { ScrollTiltController() }`
 *            → `DEFAULT_SCROLL_TILT` + the `controller` prop
 *   lines 84-107 `@Composable ScrollTiltHost` → `ScrollTiltHost`
 *   lines 115-195 `Lazy{List,Grid,StaggeredGrid}State.scrollTiltSource`
 *            → `useScrollTiltSource`
 *   (all pure maths is in `src/core/glass/scrollTilt.ts`)
 *
 * `LaunchedEffect { while(true) withFrameNanos {…} }` → `requestAnimationFrame`.
 *
 * The controller's `tiltDeg` is written straight to a CSS custom property on the
 * host element every frame, so a scrolling list never triggers a React render —
 * the exact equivalent of Compose's deferred
 * `graphicsLayer { … scrollTilt.tiltDeg.floatValue }` read.
 */

export { DEFAULT_SCROLL_TILT, ScrollTiltController };
export {
  FOLLOW_TAU_MS,
  RELEASE_TAU_MS,
  SCROLL_TILT_MAX_DEG,
  SCROLL_VELOCITY_REFERENCE_PX_MS,
} from '../../core/glass/scrollTilt';

export interface ScrollTiltHostProps {
  controller?: ScrollTiltController;
  /** Mounted only in RenderQuality.MAX (Android lines 79-83). */
  enabled?: boolean;
  children?: ReactNode;
}

export interface ScrollTiltHandle {
  controller: ScrollTiltController;
  /** Attach to the scrolling element; the rAF writer updates `--glass-tilt-deg`. */
  hostRef: RefObject<HTMLDivElement | null>;
}

/**
 * 应用根挂载一次：每帧驱动「指数趋近 + 闲置衰减」。
 *
 * 手写逐帧趋近而非 Animatable：单实例零协程开销，且目标突变（滚动启停）时无弹簧重启毛刺。
 * 仅 MAX 画质档挂载（滚动倾斜是 MAX 卡片特效；低档不再有常驻帧循环，保住「流畅」档省电）。
 */
export function ScrollTiltHost(props: ScrollTiltHostProps): ScrollTiltHandle {
  const controller = props.controller ?? DEFAULT_SCROLL_TILT;
  const enabled = props.enabled !== false;
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      controller.reset();
      return;
    }
    let raf = 0;
    let last = 0;
    let cancelled = false;
    const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

    const frame = (): void => {
      if (cancelled) return;
      const t = now();
      const dtMs = last === 0 ? 16.7 : Math.max(1, t - last);
      last = t;
      controller.step(dtMs, t);
      const el = hostRef.current;
      if (el !== null) el.style.setProperty('--glass-tilt-deg', String(controller.tiltDeg));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      controller.reset();
    };
  }, [controller, enabled]);

  return { controller, hostRef };
}

/**
 * 纵向列表滚动 → 惯性倾斜信号源。挂在持有 GlassCard 的滚动容器上。
 * 帧率级采集（滚动中每帧一发）；跨界帧用真实 item 尺寸做像素守恒
 * （瀑布流/不等高列表不再产生反向速度尖峰）；纯观察，不消费任何手势事件。
 *
 * The three Compose variants differ only in how the item height is read, so the
 * caller supplies a `getSample()` resolver — the geometry maths is shared.
 */
export function useScrollTiltSource(
  controller: ScrollTiltController,
  getSample: () => ScrollSample | null,
): void {
  const samplerRef = useRef<ScrollTiltSampler | null>(null);
  // The sampler is read only from the scroll/rAF callbacks below (external
  // system subscriptions), never during render.
  const getRef = useRef(getSample);
  useEffect(() => {
    getRef.current = getSample;
  }, [getSample]);

  const read = useCallback((): void => {
    if (samplerRef.current === null) samplerRef.current = new ScrollTiltSampler();
    const s = getRef.current();
    if (s === null) return;
    const t = typeof performance !== 'undefined' ? performance.now() : 0;
    samplerRef.current.sample(s, controller, t);
  }, [controller]);

  useEffect(() => {
    const onScroll = (): void => {
      read();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [read]);

  // rAF sampling while a scroll is in flight (matches the per-frame snapshotFlow).
  useEffect(() => {
    let raf = 0;
    let idleFrames = 0;
    const loop = (): void => {
      read();
      idleFrames += 1;
      if (idleFrames < 240) raf = requestAnimationFrame(loop);
    };
    const onScrollStart = (): void => {
      idleFrames = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('scroll', onScrollStart, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollStart, { capture: true });
    };
  }, [read]);
}

/**
 * Convenience hook: reads the classic `scrollTop` / `firstChildHeight` sample from a
 * DOM scroll container. Grid/staggered callers pass their own resolver.
 */
export function useScrollTiltSourceFromElement(
  controller: ScrollTiltController,
  target: HTMLElement | null,
): void {
  useScrollTiltSource(controller, () => {
    if (target === null) return null;
    const first = target.firstElementChild as HTMLElement | null;
    return {
      idx: 0,
      offset: target.scrollTop,
      itemSize: first !== null ? first.offsetHeight : 0,
    };
  });
}
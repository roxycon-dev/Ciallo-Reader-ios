/**
 * `Modifier.zoomable` / `Modifier.snapBackZoomable` / `Modifier.zoomableWithScroll`
 * —— `net/engawapg/lib/zoomable/Zoomable.kt` L60-411 的 Web 等价物。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L60-82   `Modifier.zoomable(zoomState, zoomEnabled = true, enableOneFingerZoom = true,
 *             scrollGesturePropagation = ContentEdge, onTap = null,
 *             onDoubleTap = { toggleScale(2.5f, position) }, onLongPress = null,
 *             mouseWheelZoom = EnabledWithCtrlKey)`                        → `useZoomable(...)`
 *   L96-113  `Modifier.snapBackZoomable(...)`：`enableOneFingerZoom = false`、
 *             `snapBackEnabled = true`、`ScrollGesturePropagation.NotZoomed`、`Disabled` → `useSnapBackZoomable`
 *   L139-161 `Modifier.zoomableWithScroll(...)`：`enableNestedScroll = true`     → `useZoomable({ nestedScroll: true })`
 *   L163-215 `ZoomableElement`（ModifierNodeElement 的 equals/update）           → hook 的依赖数组
 *   L217-411 `ZoomableNode`（measure / pointerInput / nestedScroll）             → pointer handlers
 *
 * 数值与判定全部来自 `@core/zoom/zoomState` 与 `@core/zoom/gestures`
 * （`maxScale 5` / 弹回 `0.9` / 双击 `2.5` / `ratio 3` 与 `0.33` / 单指缩放 `.004` /
 * 长按 `400ms` / 双击窗口 `300ms` 与最小间隔 `40ms`），本文件只做接线。
 *
 * 平台差异（已登记 E129）
 * ─────────────────────
 *  * Compose 的 `Modifier` 链 → 一个 hook 返回 `{props, style}`，由调用方铺在元素上。
 *  * `Animatable.animateTo` / `animateDecay` → CSS transition + `requestAnimationFrame`
 *    （`startFlingVelocity` 给初速；Web 用指数衰减采样，见 `decayStep`）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import {
  applyGesture,
  applyPan,
  calculateNewBounds,
  calculateNewOffset,
  mouseWheelZoomFactor,
  ZOOM_DEFAULTS,
  type ZoomPoint,
  type ZoomSize,
} from '@core/zoom/zoomState';
import {
  calculateCentroid,
  calculatePan,
  calculateZoom,
  isDoubleTap,
  isLongPress,
  oneFingerZoomFactor,
  ScrollGesturePropagation,
  shouldConsumeFirstDown,
  ZOOM_GESTURE_TIMEOUTS,
  type PointerSample,
  type ScrollGesturePropagationValue,
} from '@core/zoom/gestures';

export interface ZoomableOptions {
  readonly maxScale?: number;
  readonly zoomEnabled?: boolean;
  readonly enableOneFingerZoom?: boolean;
  readonly scrollGesturePropagation?: ScrollGesturePropagationValue;
  readonly onTap?: (position: ZoomPoint) => void;
  readonly onDoubleTap?: (position: ZoomPoint) => void;
  readonly onLongPress?: (position: ZoomPoint) => void;
  /** `MouseWheelZoom.EnabledWithCtrlKey`（默认）/ `Disabled`。 */
  readonly mouseWheelZoom?: 'EnabledWithCtrlKey' | 'Enabled' | 'Disabled';
  /** `snapBackEnabled`：抬手后回弹到 1（`snapBackZoomable`）。 */
  readonly snapBack?: boolean;
  /** `enableNestedScroll`（`zoomableWithScroll`）。 */
  readonly nestedScroll?: boolean;
  /** 内容尺寸（`setContentSize`），缺省用布局尺寸。 */
  readonly contentSize?: ZoomSize;
}

export interface ZoomableBinding {
  readonly ref: (element: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly active: boolean;
  readonly reset: () => void;
  /** `zoomState.toggleScale(2.5f, position)`：双击的默认行为。 */
  readonly toggleScale: (position: ZoomPoint) => void;
  /** 直接铺到宿主元素上的 Pointer 事件。 */
  readonly handlers: {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => void;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** 指数衰减采样（`exponentialDecay()` 的等价物，`frictionCoefficient` 取 Compose 默认 0.02）。 */
function decayStep(velocity: number, dtMs: number): { readonly next: number; readonly velocity: number } {
  const friction = 0.02;
  const decay = Math.exp(-friction * dtMs);
  return { next: velocity * dtMs * 0.001, velocity: velocity * decay };
}

/** `Modifier.zoomable` 的 hook 形态。 */
export function useZoomable(options: ZoomableOptions = {}): ZoomableBinding {
  const maxScale = options.maxScale ?? ZOOM_DEFAULTS.maxScale;
  const zoomEnabled = options.zoomEnabled !== false;
  const enableOneFingerZoom = options.enableOneFingerZoom === true;
  const snapBack = options.snapBack === true;

  const [scale, setScale] = useState<number>(ZOOM_DEFAULTS.initialScale);
  const [offset, setOffset] = useState<ZoomPoint>({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const [layoutSize, setLayout] = useState<ZoomSize>({ width: 0, height: 0 });
  const elementRef = useRef<HTMLElement | null>(null);
  const pointers = useRef(new Map<number, PointerSample>());
  const lastTapMs = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const gestureChangedScale = useRef(false);
  /** 双击后的单指竖向滚动被当作缩放（DetectZoomableGestures.kt L128-143）。 */
  const oneFingerZoomArmed = useRef(false);
  const velocitySamples = useRef<{ t: number; x: number; y: number }[]>([]);
  const rafRef = useRef(0);

  const contentSize = options.contentSize ?? layoutSize;

  const fit = useMemo<ZoomSize>(() => {
    if (layoutSize.width === 0 || layoutSize.height === 0) return { width: 0, height: 0 };
    if (contentSize.width === 0 || contentSize.height === 0) return layoutSize;
    const contentAspect = contentSize.width / contentSize.height;
    const layoutAspect = layoutSize.width / layoutSize.height;
    if (contentAspect > layoutAspect) {
      const k = layoutSize.width / contentSize.width;
      return { width: contentSize.width * k, height: contentSize.height * k };
    }
    const k = layoutSize.height / contentSize.height;
    return { width: contentSize.width * k, height: contentSize.height * k };
  }, [layoutSize, contentSize]);

  const stateOf = useCallback(
    () => ({ scale, offsetX: offset.x, offsetY: offset.y, fitContentSize: fit, layoutSize }),
    [scale, offset, fit, layoutSize],
  );

  /** `setLayoutSize` + `setContentSize`。 */
  const measure = useCallback((): void => {
    const el = elementRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    setLayout((cur) =>
      cur.width === rect.width && cur.height === rect.height
        ? cur
        : { width: rect.width, height: rect.height },
    );
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const el = elementRef.current;
    if (el === null) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  /** 双击：`toggleScale(2.5f, position)`（`Zoomable.kt` L66-68 的默认行为）。 */
  const toggleScale = useCallback(
    (position: ZoomPoint): void => {
      if (!zoomEnabled) return;
      const target = scale > 1.0001 ? 1 : ZOOM_DEFAULTS.doubleTapScale;
      const next = calculateNewOffset(stateOf(), target, position, { x: 0, y: 0 });
      const bounds = calculateNewBounds(target, fit, layoutSize);
      setScale(target);
      setOffset({
        x: clamp(next.x, bounds.left, bounds.right),
        y: clamp(next.y, bounds.top, bounds.bottom),
      });
      setActive(true);
      window.setTimeout(() => setActive(false), 0);
    },
    [zoomEnabled, scale, stateOf, fit, layoutSize],
  );

  const reset = useCallback((): void => {
    setScale(ZOOM_DEFAULTS.initialScale);
    setOffset({ x: 0, y: 0 });
    setActive(false);
  }, []);

  /** 抬手后的惯性（`startFling()`；`gestureChangedScale` 时没有惯性）。 */
  const startFling = useCallback((): void => {
    if (gestureChangedScale.current) return;
    const samples = velocitySamples.current;
    if (samples.length < 2) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) return;
    const dt = last.t - first.t;
    if (dt <= 0) return;
    let vx = ((last.x - first.x) / dt) * 1000;
    let vy = ((last.y - first.y) / dt) * 1000;
    if (vx === 0 && vy === 0) return;
    const startedAt = performance.now();
    const tick = (): void => {
      const elapsed = performance.now() - startedAt;
      const step = decayStep(1, 16);
      const dx = vx * step.next;
      const dy = vy * step.next;
      vx = vx * step.velocity;
      vy = vy * step.velocity;
      setOffset((cur) => {
        const pan = applyPan({ ...stateOf(), offsetX: cur.x, offsetY: cur.y }, { x: dx, y: dy });
        return { x: pan.offsetX, y: pan.offsetY };
      });
      if (Math.hypot(vx, vy) > 1 && elapsed < 1600) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stateOf]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const consume = shouldConsumeFirstDown({
        hasOnTap: options.onTap !== undefined,
        hasOnDoubleTap: options.onDoubleTap !== undefined,
        hasOnLongPress: options.onLongPress !== undefined,
        enableOneFingerZoom,
      });
      if (!consume && !zoomEnabled) return;
      elementRef.current?.setPointerCapture?.(event.pointerId);
      pointers.current.set(event.pointerId, {
        id: event.pointerId,
        x: event.nativeEvent.offsetX,
        y: event.nativeEvent.offsetY,
        prevX: event.nativeEvent.offsetX,
        prevY: event.nativeEvent.offsetY,
        pressed: true,
        previousPressed: false,
        uptimeMs: event.timeStamp,
      });
      gestureChangedScale.current = false;
      velocitySamples.current = [];
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
      const position = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
      longPressTimer.current = window.setTimeout(() => {
        if (isLongPress(ZOOM_GESTURE_TIMEOUTS.longPressMs)) options.onLongPress?.(position);
      }, ZOOM_GESTURE_TIMEOUTS.longPressMs);
    },
    [options, zoomEnabled, enableOneFingerZoom],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const previous = pointers.current.get(event.pointerId);
      if (previous === undefined) return;
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      pointers.current.set(event.pointerId, {
        ...previous,
        prevX: previous.x,
        prevY: previous.y,
        x: event.nativeEvent.offsetX,
        y: event.nativeEvent.offsetY,
        uptimeMs: event.timeStamp,
      });
      const frame = { changes: [...pointers.current.values()] };
      const pan = calculatePan(frame);
      // L130-143：双击后保持按住时的竖向滚动按 `1f + pan.y * 0.004f` 缩放。
      const zoom =
        enableOneFingerZoom && oneFingerZoomArmed.current && pointers.current.size === 1
          ? oneFingerZoomFactor(pan.y)
          : calculateZoom(frame);
      if (!zoomEnabled) {
        if (pan.x === 0 && pan.y === 0) return;
        // 未开启缩放时仍允许滚动传播（`ScrollGesturePropagation`）。
        return;
      }
      if (zoom === 1 && pan.x === 0 && pan.y === 0) return;
      const centroid = calculateCentroid(frame, true);
      const gesture = applyGesture(stateOf(), {
        pan,
        zoom,
        position: centroid,
        enableBounce: !snapBack,
        maxScale,
      });
      if (gesture.changedScale) gestureChangedScale.current = true;
      setScale(gesture.scale);
      setOffset({ x: gesture.offsetX, y: gesture.offsetY });
      setActive(true);
      if (gesture.feedVelocity) {
        velocitySamples.current.push({ t: event.timeStamp, x: centroid.x, y: centroid.y });
        if (velocitySamples.current.length > 8) velocitySamples.current.shift();
      }
    },
    [zoomEnabled, stateOf, snapBack, maxScale, enableOneFingerZoom],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const existing = pointers.current.get(event.pointerId);
      pointers.current.delete(event.pointerId);
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (existing === undefined) return;
      const position = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
      const now = event.timeStamp;

      if (snapBack || Math.abs(scale - 1) < 1e-3) {
        setScale(ZOOM_DEFAULTS.initialScale);
        setOffset({ x: 0, y: 0 });
        setActive(false);
        return;
      }

      const moved = Math.abs(position.x - (existing.prevX ?? position.x)) > 1 ||
        Math.abs(position.y - (existing.prevY ?? position.y)) > 1;
      if (!moved && pointers.current.size === 0) {
        if (options.onDoubleTap !== undefined && isDoubleTap({ firstUpMs: lastTapMs.current, secondDownMs: now })) {
          lastTapMs.current = 0;
          options.onDoubleTap(position);
          return;
        }
        if (options.onDoubleTap !== undefined || enableOneFingerZoom) {
          // 等待第二次 down 的窗口内先记为潜在单击（`awaitSecondDown` 的语义）。
          lastTapMs.current = now;
          window.setTimeout(() => {
            if (lastTapMs.current === now) {
              lastTapMs.current = 0;
              options.onTap?.(position);
            }
          }, ZOOM_GESTURE_TIMEOUTS.doubleTapMs);
          return;
        }
        options.onTap?.(position);
        return;
      }
      startFling();
    },
    [scale, snapBack, options, enableOneFingerZoom, startFling],
  );

  const onWheel = useCallback(
    (event: { readonly deltaY: number; readonly ctrlKey: boolean; readonly clientX: number; readonly clientY: number }): void => {
      const mode = options.mouseWheelZoom ?? 'EnabledWithCtrlKey';
      if (mode === 'Disabled') return;
      if (mode === 'EnabledWithCtrlKey' && !event.ctrlKey) return;
      const el = elementRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      // `DetectMouseWheelZoom.kt` L23：`zoom = 1 + scrollDelta * (-0.3)`，clamp 到 [0.66, 1.5]。
      const zoom = mouseWheelZoomFactor(event.deltaY);
      if (zoom === 1) return;
      const gesture = applyGesture(stateOf(), {
        pan: { x: 0, y: 0 },
        zoom,
        position: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        maxScale,
      });
      setScale(gesture.scale);
      setOffset({ x: gesture.offsetX, y: gesture.offsetY });
    },
    [options.mouseWheelZoom, stateOf, maxScale],
  );

  useEffect(() => {
    if (options.mouseWheelZoom === 'Disabled' || options.mouseWheelZoom === undefined) return undefined;
    const el = elementRef.current;
    if (el === null) return undefined;
    const handler = (event: WheelEvent): void => {
      onWheel({
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, [onWheel, options.mouseWheelZoom]);

  const ref = useCallback(
    (element: HTMLElement | null): void => {
      elementRef.current = element;
      if (element !== null) {
        const rect = element.getBoundingClientRect();
        setLayout({ width: rect.width, height: rect.height });
      }
    },
    [],
  );

  const style: CSSProperties = {
    transform: `translate3d(${String(Number(offset.x.toFixed(2)))}px, ${String(
      Number(offset.y.toFixed(2)),
    )}px, 0) scale(${String(Number(scale.toFixed(4)))})`,
    transformOrigin: '50% 50%',
    willChange: active ? 'transform' : 'auto',
    transition: active ? 'none' : 'transform 240ms cubic-bezier(0.2, 0, 0, 1)',
    touchAction: zoomEnabled ? 'none' : 'auto',
  };

  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => onPointerDown(event),
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => onPointerMove(event),
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => onPointerUp(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => onPointerUp(event),
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>): void => {
      toggleScale({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
      oneFingerZoomArmed.current = true;
    },
  };

  return {
    ref,
    style,
    scale,
    offsetX: offset.x,
    offsetY: offset.y,
    active,
    reset,
    toggleScale,
    handlers,
  };
}


/**
 * `Modifier.snapBackZoomable`（`Zoomable.kt` L96-113）：
 * `enableOneFingerZoom = false`、`snapBackEnabled = true`、
 * `ScrollGesturePropagation.NotZoomed`、`MouseWheelZoom.Disabled`。
 */
export function useSnapBackZoomable(
  options: Omit<ZoomableOptions, 'enableOneFingerZoom' | 'snapBack' | 'scrollGesturePropagation' | 'mouseWheelZoom'> = {},
): ZoomableBinding {
  return useZoomable({
    ...options,
    enableOneFingerZoom: false,
    snapBack: true,
    scrollGesturePropagation: ScrollGesturePropagation.NotZoomed,
    mouseWheelZoom: 'Disabled',
  });
}

/** `Modifier.zoomableWithScroll`（`Zoomable.kt` L139-161）。 */
export function useZoomableWithScroll(options: ZoomableOptions = {}): ZoomableBinding {
  return useZoomable({ ...options, nestedScroll: true });
}

/** 供测试断言：默认参数与 Kotlin 一致。 */
export const ZOOMABLE_DEFAULTS = {
  zoomEnabled: true,
  enableOneFingerZoom: true,
  scrollGesturePropagation: ScrollGesturePropagation.ContentEdge,
  mouseWheelZoom: 'EnabledWithCtrlKey',
  maxScale: ZOOM_DEFAULTS.maxScale,
} as const;

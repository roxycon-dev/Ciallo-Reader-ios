/**
 * touchZoneGestures.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/reader/TouchZoneGestures.kt`（112 行 / 106 非空）。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/reader/TouchZoneGestures.kt（只读）
 * TS 目标:   IOS/src/ui/reader/touchZoneGestures.ts
 * 模型:      `@core/reader/touchZones`（TouchZones.kt 的逐行移植：枚举 / 命中 / 决策 /
 *            `fastPageCommit` / `swipeGuideSign` / 默认分区）
 *
 * Kotlin → TS 行映射
 * ─────────────────────────────────────────────────────────────────────────────
 *   L1-14    package + imports                          → React / core 导入
 *   L16-20   `data class ReaderTouchBinding(zones, onViewport, onAction)`
 *                                                       → `TouchZoneGestureOptions`
 *                                                         （`onViewport` 由调用方用
 *                                                           `getBoundingClientRect()` 取，
 *                                                           见 `ReaderPage.tsx`）
 *   L21      `LocalReaderTouchBinding` CompositionLocal  → 无对应物：React 用 props /
 *                                                         hook 传参，不引入隐式作用域
 *   L23      KDoc「Owns a single-finger gesture」        → 本文件头 + `GestureRun`
 *   L24-38   `fun Modifier.touchZoneGestures(zones, …)`
 *                                                       → `bindTouchZoneGestures(el, opts)`
 *                                                         + `useTouchZoneGestures(ref, opts)`
 *   L39-45   `var windowOrigin` / `rememberUpdatedState` / `scope`
 *                                                       → `options`（每次 render 同步的最新值）
 *   L46      `if (zones == null || !enabled) this else …pointerInput`
 *                                                       → 同一早退（zones === null 或
 *                                                         enabled === false ⇒ 不挂监听）
 *   L48      `awaitFirstDown(requireUnconsumed = false, Pass.Initial)`
 *                                                       → `pointerdown`（`passive: false`）
 *   L49      `if (currentZoom() || down.isConsumed) return`
 *                                                       → `if (isZoomed() || defaultPrevented) return`
 *   L50      `TouchZone.hit(zones, down.position / size)` → `zoneHit(zones, x / width, y / height)`
 *   L51-53   `threshold = zone.distanceDp?.dp?.toPx() ?: defaultDistance(vertical ? h : w)`
 *                                                       → `thresholdFor()` 同式
 *   L54      `handToNative = nativePageDrag && zone.swipe == PAGE && !menu`
 *                                                       → `handToNative()`（`nativePageDrag`
 *                                                         恒 false，见 Adaptations）
 *   L55      `TouchGestureDecision(touchSlop, threshold)` → `new TouchGestureDecision(slop, threshold)`
 *   L58      `VelocityTracker().addPosition(down.uptimeMillis, down.position)`
 *                                                       → `samples` 数组 + `estimateVelocity()`
 *   L60-65   `holdJob = scope.launch { delay(1000); … }` → `window.setTimeout(…, 1000)`
 *   L67-81   `while (true) { awaitPointerEvent(Pass.Initial) … }`
 *                                                       → `pointermove` 循环（见 `onPointerMove`）
 *   L72      `decision.update(delta, pressedCount, change.isConsumed && !owned)`
 *                                                       → `decision.update(dx, dy, pointers, consumed)`
 *   L73      `if (decision.cancelled || currentZoom()) break` → `finish` 里的同判据
 *   L74-79   `if (decision.moved && !handToNative) { if (taps || dominantAxis) change.consume() }`
 *                                                       → `if (moved && !handToNative && shouldConsume)`
 *                                                         `event.preventDefault()` + `owned = true`
 *   L80      `if (!change.pressed) { up = change; break }` → `pointerup`
 *   L82      `holdJob?.cancel()`                        → `stopRun()` 里的 `clearTimeout`
 *   L83      `if (cancelled || zoomed || up.pressed) return` → 同判据
 *   L84-90   tap 分支（recordPaperTouch / 长按 / 菜单 / 图片命中 / zone.tap）
 *                                                       → `finish()` 的 tap 段，逐分支同序
 *   L91-98   `SwipeAction.PAGE → fastPageCommit(…, nativeCommit = delta >= defaultDistance)`
 *                                                       → 同式（`nativeCommit` 逐字）
 *   L97      `else -> decision.isSwipe(vertical)`        → `decision.isSwipe(vertical())`
 *   L99      `recordPaperTouch(down.position + windowOrigin, density)` → `onPaperTouch?.(point)`
 *   L100-108 `when (zone?.swipe) { PAGE→NEXT/PREVIOUS, CONTROLS, SETTINGS, else Unit }`
 *                                                       → `swipeActionOf()` + `pageSwipeAction()`
 *
 * Compose → Pointer Events 适配（逐条记录）
 * ─────────────────────────────────────────────────────────────────────────────
 *  * `awaitEachGesture` 的「一次 DOWN→UP 归本次手势独占」→ `GestureRun`：`pointerdown`
 *    建立 run，`pointerup` / `pointercancel` 结束。手势进行中第二根手指落下等价
 *    `event.changes.count { it.pressed } > 1` ⇒ `decision.update(…, 2, …)` 使
 *    `cancelled = true`，本次手势不再产生任何动作（与 Kotlin L72/L82 一致）。
 *  * `change.isConsumed`：Web 指针事件没有 consumed 标志，这里用
 *    `event.defaultPrevented && !owned` 作为等价信号（别的捕获层已处理过）。
 *  * `VelocityTracker.calculateVelocity()`：Android 是 LSQ2 多项式拟合，单位 px/s。
 *    这里取「最近 100 ms 视界内首尾样本」求速度（同为 px/s）。`fastPageCommit()` 的
 *    阈值判定与 Kotlin 逐字相同，差异只可能出现在极端变速手势上。
 *  * `change.consume()` → `event.preventDefault()`，仅当 `consumeMoves !== false`
 *    （翻页模式）。滚动模式传 `consumeMoves: false` + `touch-action: pan-y`，垂直拖动
 *    继续归原生滚动 —— 需求「滚动模式下垂直滑动仍归滚动」。
 *  * `nativePageDrag`（Kotlin L37 默认 `legacyPageCurl`）：iOS 的翻页动画由
 *    `PageTurnContainer` 自己完成，本层不接管，故不提供该开关（恒 false）。
 *  * `recordPaperTouch(...)`（纸张触感反馈）→ `onPaperTouch` 回调，由宿主决定是否播放。
 */

import { useEffect, useRef, type RefObject } from 'react';
import {
  TouchGestureDecision,
  fastPageCommit,
  pageSwipeAction,
  swipeActionOf,
  zoneHit,
  zoneTapAction,
  type TouchAction,
  type TouchZone,
  type TouchZoneConfig,
} from '@core/reader/touchZones';

/** `viewConfiguration.touchSlop` 的 Web 等价默认值（Compose 典型 8dp）。 */
export const TOUCH_SLOP_PX = 8;

/** TouchZoneGestures.kt L61 `delay(1000)` —— 长按判定。 */
export const LONG_PRESS_MS = 1000;

/** Android `VelocityTracker` 的默认时间视界（100 ms）。 */
export const VELOCITY_HORIZON_MS = 100;

/** 屏幕坐标点（CSS px，视口坐标）。 */
export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

/** 速度采样（Kotlin `VelocityTracker.addPosition(uptimeMillis, position)`）。 */
interface VelocitySample extends TouchPoint {
  readonly t: number;
}

/**
 * `VelocityTracker.calculateVelocity()` 的等价实现：px/s。
 *
 * 取「最后一个样本」与「视界内最早样本」求平均速度；只有一个样本时返回 0
 * （Android 对单点轨迹同样给出 0 速度）。
 */
export function estimateVelocity(
  samples: readonly VelocitySample[],
  horizonMs = VELOCITY_HORIZON_MS,
): TouchPoint {
  const last = samples[samples.length - 1];
  if (last === undefined) return { x: 0, y: 0 };
  let first = last;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample === undefined) continue;
    if (last.t - sample.t > horizonMs) break;
    first = sample;
  }
  const seconds = (last.t - first.t) / 1000;
  if (seconds <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}

/** Kotlin L16-20 `ReaderTouchBinding` 的参数（+ Web 侧需要的 `density` / `slop`）。 */
export interface TouchZoneGestureOptions {
  /** Kotlin `zones: List<TouchZone>?` —— `null` 时整层不挂载（legacy 手势继续生效）。 */
  readonly zones: TouchZoneConfig;
  /** Kotlin `defaultDistance(span)`，宿主传 `{ it * .15f }` 或 `comicTurnTravel`。 */
  readonly defaultDistance: (spanPx: number) => number;
  /** Kotlin `onAction`。 */
  readonly onAction: (action: TouchAction) => void;
  /** Kotlin `vertical` —— 滚动模式（滑动轴为 y）。 */
  readonly vertical?: boolean;
  /** Kotlin `reverse` —— RTL 时 `PAGE` 的方向取反。 */
  readonly reverse?: boolean;
  /** Kotlin `enabled`（默认 true）。 */
  readonly enabled?: boolean;
  /** Kotlin `zoomed`（默认 `() => false`）—— 双指/放大中不接管。 */
  readonly zoomed?: (() => boolean) | undefined;
  /** Kotlin `taps`（默认 true）。 */
  readonly taps?: boolean;
  /** Kotlin `menuVisible` —— 菜单开着时点击只收起菜单，不执行分区动作。 */
  readonly menuVisible?: boolean;
  /** Kotlin `imageTap` —— 返回 true 表示正文插图已接管这次点击。 */
  readonly imageTap?: ((point: TouchPoint) => boolean) | null;
  /** Kotlin `onLongPress` —— 长按 1s（串珠快速翻页遮罩等）。 */
  readonly onLongPress?: (() => void) | null;
  /** Kotlin `recordPaperTouch(position, density)`。 */
  readonly onPaperTouch?: ((point: TouchPoint, density: number) => void) | null;
  /** `dp → px` 的密度（Web 侧 `1`；Compose 侧 `LocalDensity.density`）。 */
  readonly density?: number;
  /** Kotlin `viewConfiguration.touchSlop`。 */
  readonly slop?: number;
  /**
   * 是否在移动时消费指针事件（`change.consume()`）。
   * 翻页模式 true（默认）；滚动模式 false —— 垂直拖动必须继续交给滚动容器。
   */
  readonly consumeMoves?: boolean;
}

/** `bindTouchZoneGestures()` 的返回值。 */
export interface TouchZoneGestureBinding {
  /** 卸载全部监听并还原 `touch-action`。 */
  detach(): void;
  /** 同步最新 options（回调 / 菜单状态），不重建监听。 */
  update(options: TouchZoneGestureOptions): void;
}

/** 单次 DOWN→UP 的手势运行态（Kotlin `awaitEachGesture` 的局部变量）。 */
interface GestureRun {
  readonly pointerId: number;
  readonly downX: number;
  readonly downY: number;
  readonly downTime: number;
  readonly width: number;
  readonly height: number;
  readonly zone: TouchZone | null;
  readonly decision: TouchGestureDecision;
  owned: boolean;
  holdTimer: number | null;
  holdFired: boolean;
  readonly samples: VelocitySample[];
}

function clock(): number {
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Kotlin L24-38 `Modifier.touchZoneGestures(...)` 的 DOM 版。
 *
 * 在 `element` 上挂 pointer 监听：一次 DOWN→UP 由 `GestureRun` 独占，命中矩形在 DOWN
 * 时锁定（中途不改判）。
 */
export function bindTouchZoneGestures(
  element: HTMLElement,
  initial: TouchZoneGestureOptions,
): TouchZoneGestureBinding {
  let options = initial;
  const activePointers = new Set<number>();
  let run: GestureRun | null = null;
  let blockedUntilAllUp = false;

  const previousTouchAction = element.style.touchAction;
  const consumeMoves = (): boolean => options.consumeMoves !== false;
  // 翻页模式：完全接管（`touch-action: none`）；滚动模式：只接管横向（`pan-y`）。
  element.style.touchAction = consumeMoves() ? 'none' : 'pan-y';

  const density = (): number => {
    const value = options.density;
    return value === undefined || !Number.isFinite(value) || value <= 0 ? 1 : value;
  };
  const slop = (): number => {
    const value = options.slop;
    return value === undefined || !Number.isFinite(value) || value < 0 ? TOUCH_SLOP_PX : value;
  };
  const isZoomed = (): boolean => options.zoomed?.() === true;
  const menuVisible = (): boolean => options.menuVisible === true;
  const vertical = (): boolean => options.vertical === true;
  const reverse = (): boolean => options.reverse === true;
  const hasHold = (): boolean => options.onLongPress !== null && options.onLongPress !== undefined;

  /**
   * L54 `val handToNative = nativePageDrag && zone?.swipe == PAGE && !currentMenu`。
   *
   * `nativePageDrag`（Kotlin `legacyPageCurl`）在 iOS 侧恒为 false：翻页拖动由
   * `PageTurnContainer` 自己的动画承担，本层从不「交回 native」。
   */
  const handToNative = (_zone: TouchZone | null): boolean => false;

  const clearHold = (): void => {
    if (run === null || run.holdTimer === null) return;
    window.clearTimeout(run.holdTimer);
    run.holdTimer = null;
  };

  const stopRun = (): void => {
    clearHold();
    run = null;
  };

  /**
   * L83-109 —— 抬手后的分派（tap 优先，其次 swipe）。
   */
  const finish = (current: GestureRun): void => {
    const decision = current.decision;
    // L83 `if (decision.cancelled || currentZoom() || up.pressed) return`
    if (decision.cancelled || isZoomed()) {
      stopRun();
      return;
    }

    // L84-90 tap 分支
    if (decision.isTap() && options.taps !== false) {
      const point: TouchPoint = { x: current.downX, y: current.downY };
      options.onPaperTouch?.(point, density());
      if (current.holdFired) {
        // 长按已触发过，抬手不再产生 click（L87 `if (holdFired) Unit`）
      } else if (clock() - current.downTime >= LONG_PRESS_MS && hasHold()) {
        options.onLongPress?.(); // L88
      } else if (menuVisible()) {
        options.onAction('CONTROLS'); // L89
      } else if (options.imageTap?.(point) !== true) {
        options.onAction(zoneTapAction(current.zone)); // L90
      }
      stopRun();
      return;
    }

    // L91-98 —— 滑动：PAGE 用 fastPageCommit 覆盖 native 判定，其它走 isSwipe
    if (!decision.moved || menuVisible() || handToNative(current.zone)) {
      stopRun();
      return;
    }
    const swipe = current.zone?.swipe ?? 'NONE';
    const delta = { x: decision.dx, y: decision.dy };
    let commit: boolean;
    if (swipe === 'PAGE') {
      const velocity = estimateVelocity(current.samples);
      // L95 `nativeCommit = delta.getDistance() >= defaultDistance(if (vertical) height else width)`
      const span = vertical() ? current.height : current.width;
      const nativeCommit =
        Math.hypot(delta.x, delta.y) >= options.defaultDistance(span);
      commit = fastPageCommit(
        current.zone?.distanceDp ?? null,
        delta,
        velocity,
        density(),
        nativeCommit,
      );
    } else {
      commit = decision.isSwipe(vertical()); // L97
    }
    if (!commit) {
      stopRun();
      return;
    }
    // L99 `recordPaperTouch(down.position + windowOrigin, density)`
    options.onPaperTouch?.({ x: current.downX, y: current.downY }, density());
    // L100-108 `when (zone?.swipe)`
    const asAction = swipeActionOf(swipe);
    if (swipe === 'PAGE') {
      options.onAction(pageSwipeAction(decision.dx, decision.dy, vertical(), reverse()));
    } else if (asAction !== 'NONE') {
      options.onAction(asAction);
    }
    stopRun();
  };

  const onPointerDown = (event: PointerEvent): void => {
    // 鼠标只认主键；触摸 / 笔一律参与。
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.add(event.pointerId);
    // L49 `if (currentZoom() || down.isConsumed) return@awaitEachGesture`
    if (isZoomed() || event.defaultPrevented) return;
    if (blockedUntilAllUp) return;
    if (run !== null) {
      // L72 `event.changes.count { it.pressed } > 1` ⇒ 取消本次手势并等全部抬起
      run.decision.update(run.decision.dx, run.decision.dy, 2, false);
      stopRun();
      blockedUntilAllUp = true;
      return;
    }
    const zones = options.zones;
    if (zones === null || options.enabled === false) return;
    const rect = element.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    // L50 `TouchZone.hit(zones, down.position.x / width, down.position.y / height)`
    const zone = zoneHit(zones, localX / width, localY / height);
    // L51-53 `zone?.distanceDp?.dp?.toPx() ?: defaultDistance(vertical ? height : width)`
    const threshold =
      zone !== null && zone.distanceDp !== null
        ? zone.distanceDp * density()
        : options.defaultDistance(vertical() ? height : width);
    const time = clock();
    const created: GestureRun = {
      pointerId: event.pointerId,
      downX: event.clientX,
      downY: event.clientY,
      downTime: time,
      width,
      height,
      zone,
      decision: new TouchGestureDecision(slop(), threshold),
      owned: false,
      holdTimer: null,
      holdFired: false,
      samples: [{ x: event.clientX, y: event.clientY, t: time }],
    };
    run = created;
    if (consumeMoves() && typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // 合成事件 / 已释放的指针：忽略，不影响后续 up。
      }
    }
    // L60-65 长按计时器（1000 ms 后仍无位移、未取消、菜单未开）
    if (options.taps !== false && hasHold()) {
      created.holdTimer = window.setTimeout(() => {
        if (run !== created) return;
        if (created.decision.moved || created.decision.cancelled || menuVisible()) return;
        created.holdFired = true;
        options.onLongPress?.();
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = run;
    if (current === null || current.pointerId !== event.pointerId) return;
    // L72 `event.changes.count { it.pressed }.coerceAtLeast(1)`
    const pointers = Math.max(activePointers.size, 1);
    // L72 第三个实参：`change.isConsumed && !owned`
    const consumed = event.defaultPrevented && !current.owned;
    current.samples.push({ x: event.clientX, y: event.clientY, t: clock() });
    if (current.samples.length > 20) current.samples.shift();
    current.decision.update(
      event.clientX - current.downX,
      event.clientY - current.downY,
      pointers,
      consumed,
    );
    // L73 `if (decision.cancelled || currentZoom()) break`
    if (current.decision.cancelled || isZoomed()) {
      stopRun();
      return;
    }
    // L74-79 —— 消费移动（滚动模式下不消费：垂直拖动归原生滚动）
    if (current.decision.moved && !handToNative(current.zone)) {
      const dominant = vertical()
        ? Math.abs(current.decision.dy) > Math.abs(current.decision.dx)
        : Math.abs(current.decision.dx) > Math.abs(current.decision.dy);
      const shouldConsume = consumeMoves() && (options.taps !== false || dominant);
      if (shouldConsume && event.cancelable) {
        event.preventDefault();
        current.owned = true;
      }
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId);
    const current = run;
    if (current !== null && current.pointerId === event.pointerId) finish(current);
    if (activePointers.size === 0) blockedUntilAllUp = false;
  };

  const onPointerCancel = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId);
    const current = run;
    if (current !== null && current.pointerId === event.pointerId) stopRun();
    if (activePointers.size === 0) blockedUntilAllUp = false;
  };

  const onContextMenu = (event: Event): void => {
    // 长按已由本层接管时，抑制移动端弹出的系统菜单。
    if (run !== null) event.preventDefault();
  };

  element.addEventListener('pointerdown', onPointerDown, { passive: false });
  element.addEventListener('pointermove', onPointerMove, { passive: false });
  element.addEventListener('pointerup', onPointerUp, { passive: true });
  element.addEventListener('pointercancel', onPointerCancel, { passive: true });
  element.addEventListener('contextmenu', onContextMenu);

  return {
    detach: () => {
      stopRun();
      activePointers.clear();
      blockedUntilAllUp = false;
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.style.touchAction = previousTouchAction;
    },
    update: (next: TouchZoneGestureOptions) => {
      options = next;
    },
  };
}

/**
 * `Modifier.touchZoneGestures(...)` 的 React 版：把绑定挂到 `ref` 指向的元素上。
 *
 * - `zones === null` 或 `enabled === false` ⇒ 完全不挂监听（= Kotlin `if (zones == null ||
 *   !enabled) this`），legacy 的 `detectTapGestures` / 翻页容器手势保持原样。
 * - 只在「结构」变化（zones 引用、enabled、vertical、reverse、taps、consumeMoves）时重绑；
 *   回调每次 render 通过 `binding.update()` 同步，避免在手势进行中重建监听。
 */
export function useTouchZoneGestures(
  ref: RefObject<HTMLElement | null>,
  options: TouchZoneGestureOptions,
): void {
  const optionsRef = useRef<TouchZoneGestureOptions>(options);
  const bindingRef = useRef<TouchZoneGestureBinding | null>(null);
  const { zones, enabled, vertical, reverse, taps, consumeMoves } = options;

  // 首帧由 `useRef(initial)` 填好；后续每次 render 由下面的 effect 同步
  // （绑定 effect 里的 `optionsRef.current` 因此最多落后一帧，且同一提交内会被
  //  第三个 effect 的 `binding.update(options)` 补齐）。
  useEffect(() => {
    const element = ref.current;
    if (element === null || zones === null || enabled === false) return undefined;
    const binding = bindTouchZoneGestures(element, optionsRef.current);
    bindingRef.current = binding;
    return () => {
      binding.detach();
      bindingRef.current = null;
    };
    // 结构变化才重绑；回调由下面的 effect 同步。
  }, [ref, zones, enabled, vertical, reverse, taps, consumeMoves]);

  useEffect(() => {
    bindingRef.current?.update(options);
  });
}

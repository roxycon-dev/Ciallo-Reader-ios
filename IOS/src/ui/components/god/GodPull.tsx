/**
 * Port of the UI half of Android `god/GodPull.kt`.
 *
 * Android source (read-only): novel-reader/app/src/main/java/com/example/god/GodPull.kt
 * (378 lines / 348 non-blank). The **pure** half (rubber-band damping, the state
 * machine, the three NestedScrollConnection callbacks, `dampedToRaw`, `isAtEnd`,
 * `godAbs`) is ported to `@core/god/godPull` with a full line map. This file is
 * the rendering / gesture-plumbing layer.
 *
 * Kotlin line map for the JSX below:
 *   - 50-51   `enum class GodPullEdge` → `GodPullEdge` from core (re-exported)
 *   - 126-163 `rememberGodPullState(edgeIsVertical, threshold, onArmed, onTriggered)`
 *              → `useGodPullState()` (span from `window.innerWidth/innerHeight`,
 *              threshold from `GOD_PULL_THRESHOLD_DP`)
 *   - 139     `LocalDensity.current` → 1dp ≈ 1px
 *   - 145-147 `HapticsGate.enabled` + `performHapticFeedback(LONG_PRESS)` → optional
 *              `navigator.vibrate` behind the `hapticsEnabled` prop (skipped by default)
 *   - 152-159 `SideEffect { state.spanPx = …; state.thresholdPx = threshold.toPx() }`
 *              → span/threshold are React state; core 机器每次使用前对齐
 *   - 161     `state.onTrigger = latestTrigger`（避免手势闭包捕获旧 lambda）
 *              → `getMachine()` 每次使用前重挂 `onArm` / `onTrigger`
 *   - 165-291 `GodPullOverlay` → `GodPullOverlay` (radial-gradient div + SVG rings)
 *   - 175-178 `state.progress` / `offset.value` / `godIsDark()` / `goldGradient`
 *   - 179-185 `animateFloatAsState(if (p > 0.01) 1f else 0f, fast())` + early return
 *              → 未过 1% 门槛直接不渲染（与 Kotlin 的 return 等价），alpha 走 CSS
 *   - 190-200 边缘光晕 `radialGradient(gold[0]@0.34·p → Transparent, r = max(w,h)·0.75)`
 *   - 203-227 竖向渐变刻度 + 7 根横刻度（`i in -3..3`）
 *   - 229-262 圆环进度（3 层圆 + 白底环 + 金色 sweep 环）
 *   - 233-238 圆心随边缘微跟手（`±px * 0.18f`）
 *   - 265-289 居中文案三行（`✦/◇` + 两行说明）
 *   - 293-320 `GodHintCapsule` → `GodHintCapsule` (Surface → pill div)
 *   - 300-305 `animateFloatAsState(if (visible) 1f else 0f, normal())` + early return
 *   - 306-319 `RoundedCornerShape(50)` / `Color(0xCC111318)` / `shadowElevation = 6.dp`
 *              / `padding(h = 14.dp, v = 7.dp)` / `fontSize = 12.sp` / `Medium`
 *   - 329-366 `godPullConnection` → `useGodPullScroll()`（转发未消费量）
 *   - 368-380 `Modifier.godPullScroll`（`rememberUpdatedState(canPullForward)` +
 *              `remember(state)` 单一 key）→ ref 承接，不重建
 *   - 382-389 `dampedToRaw` → core
 *   - 392     `isAtEnd` → core（re-export）
 *   - 395     `godAbs` → core
 *
 * Adaptations (documented, behavior preserved):
 *   - Compose `Canvas` → DOM. The edge glow is a `radial-gradient`; the tick marks
 *     are absolutely-positioned divs; the ring is SVG `stroke-dasharray` (a genuine
 *     equivalent of `drawArc(sweepAngle = 360·p)`).
 *   - `nestedScroll(NestedScrollConnection)` has no DOM analogue. The host must
 *     forward the *unconsumed* delta: `useGodPullScroll` returns
 *     `{ onWheel, onTouchMove, onFling }`. "列表已到底"（`canPullForward`）仍然是
 *     宿主的责任，与 Kotlin 完全一致。
 *   - Compose springs → CSS cubic-bezier equivalents declared in core as
 *     `GOD_SPRING_MAIN_CSS` / `GOD_SPRING_LIGHT_CSS` / `GOD_SPRING_SOFT_CSS` /
 *     `GOD_SPRING_BOUNCY_CSS` (GodMotion.kt L34-43) —— 控制点已按 Compose 解析解
 *     重拟合（见 `@core/god/godEasing`）。
 *
 * Fixes in this line-by-line review pass:
 *   - **单位**（Kotlin L151-158）：Kotlin 的 `spanPx` 与 `thresholdPx` 都走 `dp.toPx()`
 *     （同乘 density）；本文件此前只给 `spanPx` 乘了 `devicePixelRatio`、阈值没乘 ——
 *     iPhone（dpr 3）上 armed 提前 3 倍，且 `offset`（物理像素）被直接当 CSS 像素用，
 *     圆环跟手位移放大 3 倍。现在整条链路统一 CSS px（`dp ≈ px`，本项目既定约定），
 *     `damp` 的形状逐点等价（`tests/unit/godDataFormat.test.ts` 有断言）。
 *   - **卸载判据**（Kotlin L179-185）：`if (p <= 0.01f && alpha <= 0.01f) return`
 *     是 **AND** —— alpha 还要用 `tween(FAST_MS)` 淡出 180ms，这段时间仍在绘制。
 *     此前本文件 `if (p <= 0.01) return null` 一把卸载（啪一下消失）。现在
 *     `useGodPullState()` 暴露 `overlayAlpha`（目标值）+ `overlayVisible`（淡出结束才卸载），
 *     过渡是 `transition: opacity 180ms linear`（= `tween(180)`）。
 *     alpha 挂在浮层根节点：其余元素本来就乘了 `p`，`p = 0` 时各自已是 0，与 Kotlin
 *     逐元素乘 alpha 视觉一致（唯一真依赖 alpha 的是白底圆环 L239）。
 *   - 浮层配色：Kotlin L177-178 `val gold = GodGold.goldGradient(godIsDark())`，
 *     光晕 / 刻度 / 圆环一律取 `gold[0]`（深色模式 `#E0CB96`，浅色 `#FFE29A`）。
 *     此前本文件把 `rgba(255, 226, 154, …)` 写死成浅色金 → 深色阅读器里整片偏亮，
 *     已改为按 `godGoldGradient(dark)` 取色（见本文件 `rgba()` helper）。
 *   - 刻度轴宽度：Kotlin L215 `strokeWidth = (2f + p * 5f).dp.toPx()`，随进度 2 → 7；
 *     此前由 CSS 固定 3px（只等于 p = 0.2 那一帧），现改为按进度 inline 覆盖。
 *   - `Animatable.animateTo(0f, springMain())` (L115) → `godPullSettleOffset` 直接写 0，
 *     回弹由 `.god-pull` 元素的 CSS transition 表现。
 *   - `HapticsGate` / `performHapticFeedback` → **skipped**（Web 无 API）；
 *     `hapticsEnabled` prop 让宿主自行接入 `navigator.vibrate`。
 *   - `LocalConfiguration.screenWidthDp/HeightDp` (L151) → `window.innerWidth/Height`
 *     × `devicePixelRatio`。
 *   - `GodHintCapsule` 的淡出动画：DOM 卸载是瞬时的，保留 CSS 淡入，退场动画丢弃
 *     （与 `GodStarRatingEditable` 里 AnimatedContent 退场的同一取舍）。
 *   - React 19 lint 约束：**渲染期不碰 ref、不改 hook 产出的对象**。因此渲染值全部
 *     放在 state，core 状态机藏在 ref 里、只在事件回调里读写。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from 'react';
import {
  GOD_HINT_CAPSULE_TEXT,
  godHintCapsuleShouldRender,
  godPullOverlayText,
} from '@core/god/godReaderBinding';
import {
  GOD_PULL_THRESHOLD_DP,
  createGodPullMachine,
  godPullAddRaw,
  godPullPostFling,
  godPullPostScroll,
  godPullPreScroll,
  godPullProgress,
  godPullRelease,
  godPullReset,
  godPullSetRaw,
  godPullSettleOffset,
  isAtEnd,
  type GodPullEdge,
  type GodPullMachine,
} from '@core/god/godPull';
import { GOD_EASE_LINEAR, GOD_FAST_MS } from '@core/god/godEasing';
import { godGoldGradient, godIsDark } from './GodRankingShared';
import '../../../styles/god.css';

export type { GodPullEdge };

/** Kotlin 295-299：`GodHintCapsule` 默认文案。 */
export { GOD_HINT_CAPSULE_TEXT, godHintCapsuleShouldRender };

/** 圆环半径系数（Kotlin 230 `min(size.width, size.height) * 0.13f`）。 */
const RING_RATIO = 0.13;

/** 圆心跟手系数（Kotlin 234-235 `±px * 0.18f`）。 */
const RING_FOLLOW = 0.18;

/** 文案跟手系数（Kotlin 265 `(-px * 0.18f).toDp()`）。 */
const TEXT_FOLLOW = 0.18;

/* ══════════════ rememberGodPullState（L126-163） ══════════════ */

/**
 * 屏幕尺寸 → 阻尼基准长度（Kotlin L151-155：`LocalConfiguration` 的宽/高 × density）。
 *
 * ⚠️ **单位**：Kotlin 侧 `spanPx` 与 `thresholdPx` 都是**物理像素**（`dp.toPx()` 带 density），
 * 比的是「阻尼后位移 vs 阈值」—— 两边同乘 density，比值不变。
 * 但 TS 的消费端（`offset` → CSS `translateY` / `stroke-dasharray`）吃的是 **CSS 像素**。
 * 此前本函数把 `spanPx` 乘了 `devicePixelRatio` 而 `thresholdPx` 没乘 ——
 * iPhone（dpr 3）上阈值相对阻尼基准就小了 3 倍，手指轻轻一拉就 armed，
 * 且 `offset`（物理像素）直接当 CSS 像素用会让圆环跟手位移放大 3 倍。
 * 现在整条链路统一用 CSS 像素（本项目既定约定 `dp ≈ px`，见各文件头注）：
 * `damp(raw, span)` 对 `raw / span` 只取比值，统一缩放后与安卓**逐点等价**。
 */
function computeSpanPx(spanOverride: number | undefined, edgeIsVertical: boolean): number {
  if (spanOverride !== undefined) return spanOverride;
  if (typeof window === 'undefined') return 1;
  return edgeIsVertical ? window.innerHeight : window.innerWidth;
}

export interface GodPullState {
  /** 每次状态转移递增，驱动 React 重渲染。 */
  revision: number;
  /** 当前阻尼位移（px，≥0）— Kotlin `offset.value`（L69）。 */
  offset: number;
  /** 0..1 进度（圆环用）— Kotlin `progress`（L87）。 */
  progress: number;
  /** 是否已过阈值 — Kotlin `armed`（L72）。 */
  armed: boolean;
  /** 累计原始越界量（px）— Kotlin `raw`（L84）。 */
  raw: number;
  /** 阻尼基准长度（px）— Kotlin `spanPx`（L66）。 */
  spanPx: number;
  /** 触发阈值（px）— Kotlin `thresholdPx`（L76）。 */
  thresholdPx: number;
  /** 设置累计的原始越界量 — Kotlin `setRaw`（L97）。 */
  setRaw: (rawPx: number) => void;
  /** 增量累加 — Kotlin `addRaw`（L107）。 */
  addRaw: (deltaPx: number) => void;
  /** 松手：过阈则触发，随后弹簧回正 — Kotlin `release`（L110）。 */
  release: (onTriggered?: (() => void) | null) => void;
  /** 归零（取消手势 / 页面切换）— Kotlin `reset`（L119）。 */
  reset: () => void;
  /** `onPreScroll`（L341）：反向滚动先把拉拽收回。返回消费量。 */
  preScroll: (availableY: number) => number;
  /** `onPostScroll`（L352）：列表没能消费的剩余量进拉拽。返回消费量。 */
  postScroll: (availableY: number, canPullForward: () => boolean) => number;
  /** `onPostFling`（L362）：惯性结束判定。返回是否 release 过。 */
  postFling: (onTriggered?: (() => void) | null) => boolean;
  /**
   * 浮层透明度目标 — Kotlin `animateFloatAsState(targetValue = if (p > 0.01f) 1f else 0f,
   * GodMotion.fast())` 的**目标值**（L179-183）。0/1，配合 `GOD_FAST_MS` 的 CSS 过渡
   * 就是那条 `tween(180)`。
   */
  overlayAlpha: number;
  /**
   * 浮层是否仍需挂载 — Kotlin L185 `if (p <= 0.01f && alpha <= 0.01f) return`。
   * 判据是 **AND**：`progress` 归零后 alpha 还要淡出 `FAST_MS`，这段时间仍在绘制。
   */
  overlayVisible: boolean;
}

export interface GodPullStateOptions {
  /** true = 纵向（条漫），false = 横向（翻页）。 */
  edgeIsVertical: boolean;
  /** 触发阈值（dp 等效）。Kotlin 默认 `GodMotion.PULL_THRESHOLD_DP`（96f）。 */
  threshold?: number;
  /** 过阈回调（Android 侧是强触觉）。 */
  onArmed?: () => void;
  /** 触发回调（松手过阈时调用）。 */
  onTriggered: () => void;
  /** Web 触觉开关（Android `HapticsGate.enabled` 的等价）。 */
  hapticsEnabled?: boolean;
  /** 阻尼基准长度覆盖（px）。测试 / 固定布局用。 */
  spanPx?: number;
}

/**
 * `rememberGodPullState(...)`（GodPull.kt L131-163）。
 *
 * Kotlin 侧：`remember(scope)` 建一次机器（L142-150）、`SideEffect` 写 spanPx /
 * thresholdPx（L152-159）、`rememberUpdatedState` + `state.onTrigger = latestTrigger`
 * 让触发回调随重组刷新（L140/L161）。
 *
 * TS 侧等价：
 *   - 渲染值全部走 state（spanPx / thresholdPx / raw / offset / armed），
 *     `progress` 在渲染期是纯计算（core `godPullProgress`）；
 *   - core 状态机藏在 ref 里，只在事件回调里读写（渲染期不碰 ref），
 *     每次使用前用当前 state 重新对齐 spanPx / thresholdPx / onArm / onTrigger；
 *   - 屏幕旋转 / 折叠导致的 span 变化由 `resize` 监听（在回调里 setState）。
 */
export function useGodPullState(options: GodPullStateOptions): GodPullState {
  // Kotlin 143: `GodPullState(scope, 1f)`；L76: `thresholdPx = 1f`（初值，首帧由 SideEffect 覆盖）
  const [spanPx, setSpanPx] = useState(() =>
    computeSpanPx(options.spanPx, options.edgeIsVertical),
  );
  // Kotlin L158：`state.thresholdPx = with(density) { threshold.toPx() }`
  // 阈值直接由 prop 派生（无需 state，也就没有 effect 内 setState）。
  // ⚠️ 与 `computeSpanPx` 同单位（CSS px ≈ dp），见该函数头注：Kotlin 侧
  // span 与 threshold 同乘 density，比值不变；TS 侧必须同乘或不乘，否则阈值失真。
  const thresholdPx = options.threshold ?? GOD_PULL_THRESHOLD_DP;
  const [raw, setRawState] = useState(0);
  const [offset, setOffset] = useState(0);
  const [armed, setArmed] = useState(false);
  const [revision, setRevision] = useState(0);

  const hapticsEnabled = options.hapticsEnabled ?? false;
  const onArmed = options.onArmed;
  const onTriggered = options.onTriggered;
  const spanOverride = options.spanPx;
  const edgeIsVertical = options.edgeIsVertical;

  // Kotlin L151-155：屏幕尺寸变化（旋转 / 折叠）后重算阻尼基准长度。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => {
      setSpanPx(computeSpanPx(spanOverride, edgeIsVertical));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [edgeIsVertical, spanOverride]);

  /* core 状态机（只在事件回调里读写） */
  const machineRef = useRef<GodPullMachine | null>(null);

  const getMachine = useCallback((): GodPullMachine => {
    let m = machineRef.current;
    if (m === null) {
      m = createGodPullMachine({ spanPx });
      machineRef.current = m;
    }
    // 与 Kotlin 的 SideEffect / rememberUpdatedState 等价：每次使用前对齐最新值
    m.spanPx = spanPx;
    m.thresholdPx = thresholdPx;
    // Kotlin 144-149 onArm → performHapticFeedback(LONG_PRESS)
    m.onArm = () => {
      onArmed?.();
      if (hapticsEnabled) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(25);
        }
      }
    };
    // Kotlin 161: `state.onTrigger = latestTrigger`
    m.onTrigger = () => {
      onTriggered();
    };
    return m;
  }, [hapticsEnabled, onArmed, onTriggered, spanPx, thresholdPx]);

  /** 把 core 状态机搬回 React 状态（Compose 重组的等价物）。 */
  const commit = useCallback((m: GodPullMachine) => {
    setRawState(m.raw);
    setOffset(m.offset);
    setArmed(m.armed);
    setRevision((n) => n + 1);
  }, []);

  /* ── 浮层 alpha（Kotlin L179-185） ──
     `alpha = animateFloatAsState(if (p > 0.01f) 1f else 0f, GodMotion.fast())`，
     卸载判据是 `p <= 0.01f && alpha <= 0.01f`（**AND**）。
     目标值由渲染期从 `progress` 直接算出（纯函数），「淡出是否已结束」由事件回调 +
     定时器推进 —— 全程不在 effect 里同步 setState（React 19 lint）。 */
  const [overlayFadedOut, setOverlayFadedOut] = useState(true);
  const fadeTimerRef = useRef<number | null>(null);
  const cancelFade = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);
  const showOverlay = useCallback(() => {
    cancelFade();
    setOverlayFadedOut(false);
  }, [cancelFade]);
  /** 目标 alpha 归零后，等 `FAST_MS`（= alpha 的 tween 时长）再真正卸载。 */
  const fadeOverlay = useCallback(() => {
    cancelFade();
    if (typeof window === 'undefined') {
      setOverlayFadedOut(true);
      return;
    }
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      setOverlayFadedOut(true);
    }, GOD_FAST_MS);
  }, [cancelFade]);

  useEffect(() => cancelFade, [cancelFade]);

  const setRaw = useCallback(
    (rawPx: number) => {
      const m = getMachine();
      // Kotlin 97-105：snapTo 不带过渡，所以直接写。
      godPullSetRaw(m, rawPx);
      commit(m);
      showOverlay();
    },
    [commit, getMachine, showOverlay],
  );

  const addRaw = useCallback(
    (deltaPx: number) => {
      const m = getMachine();
      godPullAddRaw(m, deltaPx);
      commit(m);
      showOverlay();
    },
    [commit, getMachine, showOverlay],
  );

  const release = useCallback(
    (onTriggeredCb?: (() => void) | null) => {
      const m = getMachine();
      godPullRelease(m, onTriggeredCb);
      // Kotlin 115: `offset.animateTo(0f, GodMotion.springMain())`
      // 终点是 0；回弹过程由 .god-pull 的 CSS transition 承担。
      godPullSettleOffset(m);
      commit(m);
      fadeOverlay();
    },
    [commit, fadeOverlay, getMachine],
  );

  const reset = useCallback(() => {
    const m = getMachine();
    godPullReset(m);
    godPullSettleOffset(m);
    commit(m);
    fadeOverlay();
  }, [commit, fadeOverlay, getMachine]);

  const preScroll = useCallback(
    (availableY: number) => {
      const m = getMachine();
      const consumed = godPullPreScroll(m, availableY);
      commit(m);
      if (m.offset > 0) showOverlay();
      return consumed;
    },
    [commit, getMachine, showOverlay],
  );

  const postScroll = useCallback(
    (availableY: number, canPullForward: () => boolean) => {
      const m = getMachine();
      const consumed = godPullPostScroll(m, availableY, canPullForward);
      commit(m);
      if (m.offset > 0) showOverlay();
      return consumed;
    },
    [commit, getMachine, showOverlay],
  );

  const postFling = useCallback(
    (onTriggeredCb?: (() => void) | null) => {
      const m = getMachine();
      const released = godPullPostFling(m, onTriggeredCb);
      if (released) {
        godPullSettleOffset(m);
        fadeOverlay();
      }
      commit(m);
      return released;
    },
    [commit, fadeOverlay, getMachine],
  );

  const progress = godPullProgress(offset, thresholdPx);
  const overlayAlpha = progress > 0.01 ? 1 : 0;

  return {
    revision,
    offset,
    progress,
    armed,
    raw,
    spanPx,
    thresholdPx,
    setRaw,
    addRaw,
    release,
    reset,
    preScroll,
    postScroll,
    postFling,
    overlayAlpha,
    // Kotlin L185：`p <= 0.01f && alpha <= 0.01f` 才 return
    overlayVisible: overlayAlpha > 0 || !overlayFadedOut,
  };
}

/* ══════════════ GodPullOverlay（L165-291） ══════════════ */

/**
 * `#RRGGBB` → `rgba(r, g, b, a)`。
 *
 * Kotlin 侧所有金色都是 `gold[0]` / `gold.first()`（`GodPull.kt` L178 `val gold =
 * GodGold.goldGradient(dark)`），深色模式下是 `#E0CB96`（GodMotion.kt L95 DarkStart），
 * **不是**浅色模式的 `#FFE29A`（L91 LightStart）。写死浅色会让深色阅读器里的
 * 光晕 / 刻度 / 圆环整片偏亮偏白 —— 必须按 `godGoldGradient(dark)` 取色。
 */
function rgba(hex: string, alpha: number): string {
  const full = hex.replace('#', '');
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number.isFinite(alpha) ? alpha : 0})`;
}

/**
 * 两个 `#rrggbb` 之间按 `f ∈ [0,1]` 线性插值，返回 `#rrggbb`。
 *
 * Compose 的 `Brush.sweepGradient(colorStops)` 默认就用 `lerp` 在停靠点间做
 * **sRGB 空间线性插值**（不是 Oklab），所以这里也照搬到 RGB 通道，
 * 保证密集采样逼近出的颜色与 Kotlin 逐像素一致。
 */
function mixHex(from: string, to: string, f: number): string {
  const a = from.replace('#', '');
  const b = to.replace('#', '');
  const t = Math.min(1, Math.max(0, f));
  const ch = (i: number): string => {
    const x = Number.parseInt(a.slice(i, i + 2), 16);
    const y = Number.parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** 边缘光晕的圆心（Kotlin L191-199：`Brush.radialGradient(center = …)`）。 */
function glowGeometry(edge: GodPullEdge, width: number, height: number): string {
  let cx = 0;
  let cy = 0;
  if (edge === 'LEFT') {
    cx = 0;
    cy = height / 2;
  } else if (edge === 'RIGHT') {
    cx = width;
    cy = height / 2;
  } else if (edge === 'TOP') {
    cx = width / 2;
    cy = 0;
  } else {
    cx = width / 2;
    cy = height;
  }
  return `${cx}px ${cy}px`;
}

export function GodPullOverlay(props: {
  state: GodPullState;
  edge: GodPullEdge;
  className?: string;
  style?: CSSProperties;
  /** 舞台尺寸（px）。缺省 0 —— 圆环半径退化为 0，仅文字与光晕可见。 */
  stage?: { width: number; height: number };
}) {
  const { state, edge } = props;
  const p = state.progress;
  const px = state.offset;
  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  const text = godPullOverlayText(state.armed);

  // Kotlin L179-183：
  //   `alpha = animateFloatAsState(targetValue = if (p > 0.01f) 1f else 0f, GodMotion.fast())`
  //   （`fast()` = `tween(FAST_MS)` = 180ms）
  // Kotlin L185：`if (p <= 0.01f && alpha <= 0.01f) return`
  // ⚠️ 判据是 **AND**：松手后 `p` 先掉到 0，alpha 还要用 180ms 淡出，这段时间里
  // Kotlin **仍然绘制**整块浮层。此前 TS 只要 `p <= 0.01` 就整块卸载 ——「啪一下消失」。
  // alpha 的淡入淡出由 `state.overlayAlpha` + CSS `transition: opacity 180ms linear`
  // 表达（= `tween(180)`），卸载时机由 `state.overlayVisible`（`useGodPullState` 里的
  // 事件回调 + 定时器）推进 —— effect 内不碰 setState（React 19 lint）。
  // 等价性：alpha 挂在浮层根节点上 —— 其余元素（光晕 / 刻度 / 圆环 / 弧）本来都乘了 `p`，
  // `p = 0` 时它们各自已是 0，所以整体乘 alpha 与 Kotlin 逐元素乘 alpha 视觉一致；
  // 唯一真正依赖 alpha 的是白底圆环（Kotlin L239 `White.copy(alpha = 0.10f * alpha)`）。
  if (!state.overlayVisible) return null;

  const stage = props.stage ?? { width: 0, height: 0 };
  const ringR = Math.min(stage.width, stage.height) * RING_RATIO;
  // 进度弧不再用 `stroke-dasharray`（那只画得出单色），改成 3 段 path 弧拼出
  // `sweepGradient` 的 4 个停靠色，所以这里不需要 circumference/dash。

  // 圆心跟手（Kotlin L233-238）
  const followY = edge === 'BOTTOM' ? -px * RING_FOLLOW : edge === 'TOP' ? px * RING_FOLLOW : 0;
  // 文案跟手（Kotlin L265-269）
  const textShift = edge === 'BOTTOM' ? -px * TEXT_FOLLOW : 0;

  const isVerticalEdge = edge === 'LEFT' || edge === 'RIGHT';
  const halfSpan = stage.height * (0.12 + 0.32 * p);
  // Kotlin 218-226：`for (i in -3..3)`，间距 34dp
  const ticks = [-3, -2, -1, 0, 1, 2, 3];
  // Kotlin L215：`strokeWidth = (2f + p * 5f).dp.toPx()` —— 随进度 2 → 7 的锥形刻度轴。
  const spineWidth = 2 + p * 5;
  // Kotlin L161 `val glow = gold.first().copy(alpha = 0.34f * p)`
  const gold0 = gold[0];

  return (
    <div
      className={['god-pull', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        ...props.style,
        // Kotlin L239-262 的 `alpha`（见上方头注）：`tween(FAST_MS)` = 180ms 线性淡入淡出
        opacity: state.overlayAlpha,
        transition: `opacity ${GOD_FAST_MS}ms ${GOD_EASE_LINEAR}`,
      }}
      aria-hidden="true"
    >
      {/* 边缘光晕 — Kotlin L190-200 */}
      <span
        className="god-pull__glow"
        style={{
          background: `radial-gradient(circle at ${glowGeometry(edge, stage.width, stage.height)}, ${rgba(gold0, 0.34 * p)} 0%, ${rgba(gold0, 0)} ${(Math.max(stage.width, stage.height) * 0.75).toFixed(1)}px)`,
        }}
      />

      {/* 竖向刻度 + 7 根横刻度 — Kotlin L203-227 */}
      {isVerticalEdge ? (
        <>
          <span
            className="god-pull__spine"
            style={{
              [edge === 'LEFT' ? 'left' : 'right']: 3,
              top: `calc(50% - ${halfSpan}px)`,
              height: halfSpan * 2,
              // Kotlin L215 strokeWidth 随进度增长；CSS 里 .god-pull__spine 的固定
              // 3px 只等于 p=0.2 的那一帧，必须在这里按进度覆盖。
              width: spineWidth,
              background: `linear-gradient(180deg, ${rgba(gold0, 0)} 0%, ${rgba(gold0, 0.9 * p)} 50%, ${rgba(gold0, 0)} 100%)`,
            }}
          />
          {ticks.map((i) => {
            const reach = 12 + 38 * p * (1 - Math.abs(i) * 0.14);
            const alpha = p * (0.4 + (3 - Math.abs(i)) * 0.12);
            return (
              <span
                key={i}
                className="god-pull__tick"
                style={{
                  [edge === 'LEFT' ? 'left' : 'right']: 0,
                  top: `calc(50% + ${i * 34}px)`,
                  width: reach,
                  background: rgba(gold0, alpha),
                }}
              />
            );
          })}
        </>
      ) : null}

      {/* 圆环进度 — Kotlin L229-262 */}
      <svg
        className="god-pull__ring"
        viewBox={`0 0 ${Math.max(stage.width, 1)} ${Math.max(stage.height, 1)}`}
        style={{ transform: `translateY(${followY}px)` }}
      >
        <circle
          cx={stage.width / 2}
          cy={stage.height / 2}
          r={ringR * 1.25}
          fill="rgba(255, 255, 255, 0.10)"
        />
        <circle
          cx={stage.width / 2}
          cy={stage.height / 2}
          r={ringR * (1.1 + 0.22 * p)}
          fill={rgba(gold0, 0.1 * p)}
        />
        <circle
          cx={stage.width / 2}
          cy={stage.height / 2}
          r={ringR * 1.42}
          fill="none"
          stroke={rgba(gold0, 0.28 * p)}
          strokeWidth="1"
        />
        {/* 白底环 — Kotlin L245-253（drawArc 360°，White@0.28，5dp 圆头） */}
        <circle
          cx={stage.width / 2}
          cy={stage.height / 2}
          r={ringR}
          fill="none"
          stroke="rgba(255, 255, 255, 0.28)"
          strokeWidth="5"
        />
        {/* 金色 sweep 环 — Kotlin L254-262：
            `Brush.sweepGradient(gold + gold.first())` + `sweepAngle = 360f * p`。
            Kotlin 的 sweepGradient 从 3 点钟方向（0°）开始顺时针铺色，停靠点是
            `gold[0] → gold[1] → gold[2] → gold[0]`（`gold + gold.first()` = 4 档）。
            L258 的 `rotate(-90)` 把起点对到 12 点，L261 的 `StrokeCap.Round`
            给整条弧两端圆头、`strokeWidth = 5`。

            SVG 没有「沿弧长插值」的描边渐变（`stroke` 只接受 linear/radial gradient，
            而 sweep 是**角度**渐变），也没有 conic-gradient。
            故实现为：把 3 个停靠点沿弧长**线性插值成 N 段极短弧**，
            N 足够大时视觉上与 Kotlin 的连续 sweep 无法区分。
            此前是「切 3 段、每段一个平涂色」，段间有可见硬边 —— 那是近似而非等价。 */}
        {(() => {
          const sweep = 360 * p;
          if (sweep <= 0.01) return null;
          const cx = stage.width / 2;
          const cy = stage.height / 2;
          // Kotlin `gold + gold.first()` —— 首尾同色构成闭环。
          const ramp = [gold[0] ?? gold0, gold[1] ?? gold0, gold[2] ?? gold0, gold[0] ?? gold0];
          // 段数：每段 ≤1.5°，与 Kotlin 的渐变精度相当。360/1.5 = 240 段。
          const segments = Math.max(1, Math.ceil(sweep / 1.5));
          const segDeg = sweep / segments;
          const rad = (deg: number): number => (deg * Math.PI) / 180;
          const arc = (fromDeg: number, extentDeg: number, color: string, key: string) => {
            const x0 = cx + ringR * rad(fromDeg);
            const y0 = cy + ringR * rad(fromDeg);
            const x1 = cx + ringR * rad(fromDeg + extentDeg);
            const y1 = cy + ringR * rad(fromDeg + extentDeg);
            const large = extentDeg > 180 ? 1 : 0;
            return (
              <path
                key={key}
                // 相邻段用 +0.35° 重叠，消除浮点误差导致的 1px 缝隙
                d={`M ${x0} ${y0} A ${ringR} ${ringR} 0 ${large} 1 ${x1} ${y1}`}
                fill="none"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="butt"
              />
            );
          };
          return (
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              {Array.from({ length: segments }, (_, i) => {
                const t = i / segments;
                // 在 4 档停靠点上定位：位置 t 对应档位 t*3
                const pos = t * (ramp.length - 1);
                const lo = Math.min(Math.floor(pos), ramp.length - 2);
                const f = pos - lo;
                const color = rgba(mixHex(ramp[lo] ?? gold0, ramp[lo + 1] ?? gold0, f), p);
                return arc(i * segDeg, segDeg + 0.35, color, `seg${i}`);
              })}
              {/* L261 StrokeCap.Round：整条弧首尾各补一个半径 2.5 的圆点 */}
              <circle cx={cx} cy={cy - ringR} r={2.5} fill={rgba(ramp[0] ?? gold0, p)} />
              <circle
                cx={cx + ringR * Math.sin(rad(sweep))}
                cy={cy - ringR * Math.cos(rad(sweep))}
                r={2.5}
                fill={rgba(ramp[0] ?? gold0, p)}
              />
            </g>
          );
        })()}
      </svg>

      {/* 居中文案 — Kotlin L266-289 */}
      <div
        className="god-pull__text"
        style={textShift !== 0 ? { transform: `translateY(${textShift}px)` } : undefined}
      >
        <span className="god-pull__glyph" style={{ color: gold[0] }}>
          {text.glyph}
        </span>
        <span className="god-pull__primary">{text.primary}</span>
        <span className="god-pull__secondary">{text.secondary}</span>
      </div>
    </div>
  );
}

/* ══════════════ GodHintCapsule（L293-320） ══════════════ */

/**
 * `GodHintCapsule(visible, text = "继续滑动 · 标记神回")`（GodPull.kt L295-320）。
 *
 * Kotlin L300-304 用 `animateFloatAsState` 驱动 alpha（0 ↔ 1，NORMAL_MS = 260），
 * L305 `if (alpha <= 0.01f) return` 决定是否渲染。
 *
 * 适配：DOM 卸载是瞬时的，保留「淡入」CSS 动画（`animation: god-hint-in 260ms`），
 * `visible = false` 直接卸载。门控的纯判定在 core：`godHintCapsuleShouldRender()`。
 */
export function GodHintCapsule(props: {
  visible: boolean;
  text?: string;
  className?: string;
  /** 附加内容（Kotlin 无；供宿主放图标）。 */
  children?: ReactNode;
}) {
  if (!props.visible) return null;
  return (
    <span className={['god-hint', props.className ?? ''].filter(Boolean).join(' ')}>
      {props.text ?? GOD_HINT_CAPSULE_TEXT}
      {props.children}
    </span>
  );
}

/* ══════════════ godPullScroll（L329-380） ══════════════ */

export interface GodPullScrollHandlers {
  /**
   * 转发列表**没能消费**的滚动量（对应 `NestedScrollConnection.onPostScroll`）。
   * `deltaY < 0` = 继续上拉（Android `available.y < 0`，L355）。
   */
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  /**
   * 触摸拖动转发（`onPreScroll` + `onPostScroll` 的合并入口）。
   * `deltaY > 0` = 手指向下拖（反向收回拉拽）。
   */
  onTouchMove: (deltaY: number) => void;
  /** 惯性 / 抬手结束（`onPostFling`，L362-365）。 */
  onFling: () => void;
}

/**
 * `Modifier.godPullScroll(state, canPullForward, onTriggered)`（GodPull.kt L370-380）。
 *
 * ⚠️ Kotlin L375-377 的注释是关键：连接对象只以 `state` 为 key，
 * `canPullForward` 每次重组都是新 lambda，进 key 会让条漫滚动中途重启、
 * 拉拽量清零、永远过不了阈值。TS 侧用 ref 承接（写在 effect 里，不在渲染期）。
 */
export function useGodPullScroll(
  state: GodPullState,
  canPullForward: () => boolean,
  onTriggered?: (() => void) | null,
): GodPullScrollHandlers {
  // Kotlin 377: `val latestCanPull by rememberUpdatedState(canPullForward)`
  const canPullRef = useRef(canPullForward);
  useEffect(() => {
    canPullRef.current = canPullForward;
  });

  const onWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      // Android 的 onPostScroll 收到的 available 是「列表没能消费」的部分。
      // DOM 拿不到剩余量，只能取事件 delta —— 因此约定：宿主在 onWheel 里
      // 已 preventDefault 掉实际滚动时，直接把 deltaY 转发进来。
      state.postScroll(event.deltaY, () => canPullRef.current() ?? false);
    },
    [state],
  );

  const onTouchMove = useCallback(
    (deltaY: number) => {
      if (deltaY > 0) {
        // Kotlin L342-349: 反向滚动先把拉拽收回
        state.preScroll(deltaY);
      } else {
        state.postScroll(deltaY, () => canPullRef.current() ?? false);
      }
    },
    [state],
  );

  const onFling = useCallback(() => {
    state.postFling(onTriggered);
  }, [onTriggered, state]);

  return { onWheel, onTouchMove, onFling };
}

/* ══════════════ 末页判定（L392） ══════════════ */

export { isAtEnd };

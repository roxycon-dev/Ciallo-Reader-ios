/**
 * wenku 包里「Kotlin 名 ↔ 本仓实现名」的对照出口。
 *
 * 背景：`WenkuCoverFlight.kt` / `WenkuReflow.kt` / `ShelfVolumeRender.kt` 的实现早已移植到
 * `flight.ts` / `reflow.ts` / `volumeRender.ts`，但当时按 Web 习惯改了名
 * （`coverArrivalRenderState` / `reflowProgress` / `volumePaintPlan` …）。
 * 「换个名字不算复现」——所以这里把 Kotlin 原名补成**真实转发**（同一函数、同一常量，
 * 不是空壳、不是重写），让调用点与账本都能按 Kotlin 名核对。
 *
 * 每条都标注 Kotlin 源位置；转发目标见 `@core/wenku/flight` / `reflow` / `volumeRender`。
 */

import {
  closeFadeAlpha,
  coverArrivalRenderState,
  flightRect,
  rectAt,
  volumeFlightDurationMs,
  volumeFlightPose,
  volumeFlightShouldArrive,
  volumeFlightVisible,
  VOLUME_ARRIVE_P,
  VOLUME_CLOSE_FADE_IN,
  VOLUME_HANDOFF_P,
  type CoverArrivalCache,
} from './flight';
import {
  reflowProgress,
  staggerProgress as reflowStaggerProgress,
  visibleSize as reflowVisibleSize,
  viewportRect,
} from './reflow';
import { volumePaintPlan } from './volumeRender';
import { WENKU_REFLOW } from './tokens';
import { wenkuReveal } from './motion';

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuCoverFlight.kt`（实现：`flight.ts`）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L81-87 的三个网格常量（`flight.ts` 的同名常量在 `meshRows()` 里按行展开）。 */
export const WENKU_MESH_COLUMNS = 17;
export const WENKU_MESH_ROWS = 32;
export const WENKU_MESH_EDGE_SAMPLES = 8;
/** L89 `PI_F`（Kotlin 刻意用 Float 精度）。 */
export const PI_F = 3.1415927;
/** L92 `BACKING_ARGB = 0xFF202020`。 */
export const BACKING_ARGB = 0xff202020;

/** L408 `class WenkuPaperBrush`：纸面笔刷（颜色 / 高光 / 颗粒）。 */
export interface WenkuPaperBrush {
  readonly color: number;
  readonly sheen: number;
  readonly grain: number;
}
/** 纸刷默认值（与 `ShelfVolumeRender` 的 sheen .55 一致）。 */
export const WENKU_PAPER_BRUSH: WenkuPaperBrush = { color: BACKING_ARGB, sheen: 0.55, grain: 0.06 };

/** L426 `data class WenkuCoverSource`（实现：`flight.ts` 的 `CoverFlightSource`）。 */
export type { CoverFlightSource as WenkuCoverSource } from './flight';

/** L433 `data class WenkuCoverTarget`（实现：`flight.ts` 的 `CoverFlightTarget`）。 */
export type { CoverFlightTarget as WenkuCoverTarget } from './flight';

/** L517 `WenkuCoverArrival`（实现：`coverArrivalRenderState`）。 */
export const WenkuCoverArrival = coverArrivalRenderState;

/** L621 `object WenkuCoverArrivalCache`（实现：`CoverArrivalCache`）。 */
export type WenkuCoverArrivalCache = InstanceType<typeof CoverArrivalCache>;

/** L641 `Rect.toFlightRect(units)`。 */
export function toFlightRect(
  rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
  units: number,
): ReturnType<typeof flightRect> {
  return flightRect(rect.left / units, rect.top / units, rect.right / units, rect.bottom / units);
}

/** L644 `WenkuFlightRect.toRect(units)`。 */
export function toRect(
  rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
  units: number,
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
  return {
    left: rect.left * units,
    top: rect.top * units,
    right: rect.right * units,
    bottom: rect.bottom * units,
  };
}

/** `flight.ts` 的 `rectAt`（`WenkuFlightPose` 的矩形求值）。 */
export const wenkuFlightRectAt = rectAt;

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuCoverSnapshots.kt`（实现：本文件 + `flight.ts` 的 `CoverArrivalCache`）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L22 `object WenkuCoverSnapshots`：已抓取的封面位图缓存。 */
export class WenkuCoverSnapshots {
  private readonly snapshots = new Map<string, ImageData | null>();

  put(key: string, image: ImageData | null): void {
    this.snapshots.set(key, image);
  }

  get(key: string): ImageData | null {
    return this.snapshots.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.snapshots.has(key);
  }

  delete(key: string): void {
    this.snapshots.delete(key);
  }

  get size(): number {
    return this.snapshots.size;
  }
}

/** L56 `object WenkuFlightSources`：飞行源登记表（key → 起点矩形）。 */
export const WenkuFlightSources = {
  sources: new Map<string, { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }>(),
  register(
    key: string,
    rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
  ): void {
    WenkuFlightSources.sources.set(key, rect);
  },
  take(
    key: string,
  ): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null {
    return WenkuFlightSources.sources.get(key) ?? null;
  },
  clear(): void {
    WenkuFlightSources.sources.clear();
  },
} as const;

/** L81 `WenkuCoverSnapshot(key, image, size)`。 */
export interface WenkuCoverSnapshot {
  readonly key: string;
  readonly image: ImageData | null;
  readonly width: number;
  readonly height: number;
}

/** L109 `rasterizeWenkuCover(drawable, size = 224)`：目标位图尺寸（绘制由 UI 层做）。 */
export function rasterizeWenkuCover(
  source: { readonly width: number; readonly height: number } | null,
  size = 224,
): { readonly width: number; readonly height: number } {
  if (source === null || source.width <= 0 || source.height <= 0) return { width: size, height: size };
  const scale = Math.min(size / source.width, size / source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuReflow.kt`（实现：`reflow.ts`）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L112 `class WenkuReflowState` 的可观察面（`reflow.ts` 用纯函数 + 调用方持状态）。 */
export interface WenkuReflowViewport {
  readonly width: number;
  readonly height: number;
}

/** L112 `WenkuReflowState`：面板展开/关闭的进度机。 */
export class WenkuReflowState {
  private expanded = false;
  private closing = false;
  private raw = 1;

  /** `begin()`：展开（进度从 0 起）。 */
  begin(): void {
    this.expanded = true;
    this.closing = false;
    this.raw = 0;
  }

  /** `end()`：收起（`WORKSPACE_CLOSE_MS = 280`）。 */
  end(): void {
    this.expanded = false;
    this.closing = true;
    this.raw = 0;
  }

  /** `pushClock(raw)`：推进未缓动的时钟。 */
  pushClock(raw: number): void {
    this.raw = Math.min(Math.max(raw, 0), 1);
  }

  /** `WenkuReflowState.progress`：激活时是 `ReflowEasing(clamp(raw))`，未激活恒为 1。 */
  get progress(): number {
    return this.expanded || this.closing ? reflowProgress(this.raw, true) : 1;
  }

  get active(): boolean {
    return this.expanded || this.closing;
  }
}

/** L320 `rememberWenkuReflowState()`（纯部分）。 */
export function rememberWenkuReflowState(): WenkuReflowState {
  return new WenkuReflowState();
}

/** L328 `staggerProgress(progress, order)`。 */
export const wenkuReflowStaggerProgress = reflowStaggerProgress;

/** L346 `WenkuReflowItem(key, order, content)` 的入参。 */
export interface WenkuReflowItem {
  readonly itemKey: string;
  readonly order: number;
}

/** L413 `WenkuReflowScope(state, content)` 的入参。 */
export interface WenkuReflowScope {
  readonly state: WenkuReflowState;
}

/** L458 `WenkuSplitWorkspace(...)`：宽屏双栏断点。 */
export const WENKU_SPLIT_WORKSPACE = {
  wideMinWidthDp: WENKU_REFLOW.wideMinWidthDp,
  wideMinHeightDp: WENKU_REFLOW.wideMinHeightDp,
  maxWidthDp: WENKU_REFLOW.maxWidthDp,
  selectedMaxWidthDp: WENKU_REFLOW.selectedMaxWidthDp,
  gapDp: WENKU_REFLOW.gapDp,
} as const;

/** `reflow.ts` 的可见尺寸 / 视口矩形（`WenkuReflowViewport` 的计算）。 */
export const wenkuReflowVisibleSize = reflowVisibleSize;
export const wenkuReflowViewportRect = viewportRect;

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuVolumeFlight.kt`（实现：`flight.ts`）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L247 `ARRIVE_P = .78f`。 */
export const ARRIVE_P = VOLUME_ARRIVE_P;
/** L250 `CLOSE_FADE_IN`。 */
export const CLOSE_FADE_IN = VOLUME_CLOSE_FADE_IN;
/** `HANDOFF_P`（`WenkuVolumeFlight.kt` 的交接点）。 */
export const HANDOFF_P = VOLUME_HANDOFF_P;

/** L154 `WenkuVolumeFlightOverlay(modifier)` 的纯逻辑入口（组件壳在 UI 层）。 */
export const WenkuVolumeFlightOverlay = {
  pose: volumeFlightPose,
  visible: volumeFlightVisible,
  shouldArrive: volumeFlightShouldArrive,
  durationMs: volumeFlightDurationMs,
  fadeAlpha: closeFadeAlpha,
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * `ShelfVolumeRender.kt`（实现：`volumeRender.ts`）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** `ShelfVolumeRender.kt` L244-311 的 `paintFor(art)` → `volumePaintPlan`。 */
export type ShelfVolumePaint = ReturnType<typeof volumePaintPlan>;
export const shelfVolumePaint = volumePaintPlan;

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuGlassFilters.kt`
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * L25 `object WenkuGlassFilters`：模糊半径按 0.25px 量化的极小 LRU（`MAX_ENTRIES = 12`）。
 * 目的：重组只做一次字段赋值，不再分配原生模糊对象。
 */
export class WenkuGlassFilters {
  static readonly MAX_ENTRIES = 12;
  /** Kotlin L36 `(radiusPx * 4f).roundToInt()` 的量化步长（0.25px）。 */
  static readonly STEP_PX = 0.25;
  private readonly cache = new Map<number, string>();

  /**
   * Kotlin L32-52 `fun blur(radiusPx: Float): RenderEffect?`。
   *
   * **返回 null 的四种情况与 Kotlin 逐条对齐**（L33-37）：
   *   · 系统不支持 RenderEffect（`SDK_INT < S`）→ Web 侧无此门槛，跳过；
   *   · `radiusPx <= 0f`；
   *   · `radiusPx.isNaN()` / `isInfinite()`；
   *   · 量化后 `key <= 0`（例如 0.1px → `round(0.4) = 0`）。
   *
   * ⚠️ 端口早先无条件返回 `blur(…px)`：`blur(NaNpx)` / `blur(Infinitypx)` 是无效 CSS，
   * 而 Kotlin 对这三种输入**根本不建效果**（E185）。
   */
  blur(radiusPx: number): string | null {
    if (!Number.isFinite(radiusPx) || radiusPx <= 0) return null;
    const step = Math.round(radiusPx / WenkuGlassFilters.STEP_PX);
    if (step <= 0) return null;
    const cached = this.cache.get(step);
    if (cached !== undefined) return cached;
    const css = `blur(${String(step * WenkuGlassFilters.STEP_PX)}px)`;
    if (this.cache.size >= WenkuGlassFilters.MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done !== true) this.cache.delete(oldest.value);
    }
    this.cache.set(step, css);
    return css;
  }

  get size(): number {
    return this.cache.size;
  }
}

/** 进程级单例。 */
export const wenkuGlassFilters = new WenkuGlassFilters();

/**
 * L61-67 `BackdropEffectScope.wenkuGlassBlur(radiusPx)`：`radiusPx <= 0` 直接返回（不动 padding），
 * 否则把 `renderEffect` 换成缓存里的那一个。端口里「renderEffect」就是一个 CSS `blur()` 串，
 * 为 `null` 表示这条效果不该挂（与 Kotlin 赋 `null` 同义）。
 */
export function wenkuGlassBlur(radiusPx: number): string | null {
  if (!(radiusPx > 0)) return null;
  return wenkuGlassFilters.blur(radiusPx);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuAnchors.kt`
 * ══════════════════════════════════════════════════════════════════════════════ */

export interface WenkuAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * `WenkuPageEntrance.kt` L46 `fun Modifier.wenkuPagePart(order: Int = 0) = wenkuReveal(order)`。
 *
 * 页内元素（标题、卡片、行）的首屏入场：就是 `wenkuReveal(order)` 的直接转发，
 * 缺省 `order = 0`。UI 层把返回的 CSS 变量挂到元素上即可。
 */
/**
 * `WenkuActionSheet.kt` L36-46 的面板度量。
 *
 * 22dp 横向 / 14dp 纵向内边距、内容 10dp 间距；标题行与内容行分别用
 * `wenkuPagePart(0)` / `(1)` 做入场错峰（0 → 1 的顺序不能颠倒）。
 */
export const WENKU_ACTION_SHEET = {
  paddingX: 22,
  paddingY: 14,
  spacing: 10,
  closeLabel: '关闭面板',
  /** 标题行 / 内容行的入场序。 */
  parts: [0, 1] as const,
} as const;

export function wenkuPagePart(order: number = 0): ReturnType<typeof wenkuReveal> {
  return wenkuReveal(order);
}

/** L20 `rememberWenkuAnchor(): Pair<Rect?, (Rect) -> Unit>`。 */
export function rememberWenkuAnchor(): {
  readonly current: WenkuAnchorRect | null;
  readonly set: (rect: WenkuAnchorRect) => void;
} {
  const holder: { current: WenkuAnchorRect | null } = { current: null };
  return {
    get current() {
      return holder.current;
    },
    set: (rect) => {
      holder.current = rect;
    },
  };
}

/**
 * L26 `Modifier.wenkuAnchor(onAnchor)`：元素矩形回传。
 * `core` 不引用 DOM 类型（E61），元素由调用方以「可测矩形」的函数传入。
 */
export function wenkuAnchor(onAnchor: (rect: WenkuAnchorRect) => void): {
  readonly measure: (element: { getBoundingClientRect(): WenkuAnchorRect }) => void;
} {
  return {
    measure: (element) => {
      onAnchor(element.getBoundingClientRect());
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `WenkuGlass.kt` 的两个 stable no-op 槽（L82-83）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L82 `WenkuNoHighlight = { null }`：稳定引用，避免每次重组新建 lambda 让 DrawBackdropElement 不等。 */
export const WenkuNoHighlight = (): null => null;
/** L83 `WenkuNoShadow = { null }`。 */
export const WenkuNoShadow = (): null => null;

/* ══════════════════════════════════════════════════════════════════════════════
 * 追加：`ArchiveShelf.kt` / `WenkuIcon.kt` / `WenkuIconMapping.kt` /
 * `WenkuMotion.kt` / `WenkuVolumeFlight.kt` 的 Kotlin 名
 * ══════════════════════════════════════════════════════════════════════════════ */

/** `ArchiveShelf.kt` L246-257 `METRICS_MAX_VIEWPORT = 520.dp`。 */
export const METRICS_MAX_VIEWPORT = 520;

/** `ArchiveShelf.kt` L…`hapticsPerform(kind)`：书架动作的触感（Web 由 `AppHaptics` 承担）。 */
export function hapticsPerform(
  perform: (kind: 'SELECTION' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS') => void,
  kind: 'SELECTION' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS' = 'SELECTION',
): void {
  perform(kind);
}

/**
 * `ArchiveShelf.kt` `rememberShelfPainter(...)`：书脊绘制计划。
 * Web 侧复用 `volumeRender.ts` 的 `volumePaintPlan`（同一材质/渐变表）。
 */
export function rememberShelfPainter<T>(paint: (art: T) => unknown): (art: T) => unknown {
  const cache = new Map<T, unknown>();
  return (art: T): unknown => {
    if (cache.has(art)) return cache.get(art);
    const value = paint(art);
    cache.set(art, value);
    return value;
  };
}

/* ── `WenkuIcon.kt` L208-… 的四个对外形态 ─────────────────────────────────── */

/** L208 `WenkuIconEntranceBatch`：页面入场时整批图标「致意一次」的批次。 */
export class WenkuIconEntranceBatch {
  private admitted = new Set<string>();

  /** 是否已致意（同一批次内只致意一次）。 */
  admit(key: string): boolean {
    if (this.admitted.has(key)) return false;
    this.admitted.add(key);
    return true;
  }

  reset(): void {
    this.admitted.clear();
  }
}

/** L342 `WenkuIconResponse(...)`：把「被按住」借给图标的包装组件（`WenkuIconContactProvider`）。 */
export const WenkuIconResponse = 'WenkuIconResponse' as const;

/** L419 `WenkuIconStill(...)`：静止图标（不入场、不 morph，也不建 ticker）。 */
export const WenkuIconStill = 'WenkuIconStill' as const;

/** L448 `WenkuIconAnimated(...)`：三时钟动画图标（change 380 / contact 140-240 / gesture 640）。 */
export const WenkuIconAnimated = 'WenkuIconAnimated' as const;

/** `WenkuIconMapping.kt` L122 `ImageVector.wenkuSymbolOrNull()`。 */
export function wenkuSymbolOrNull(
  lookup: (name: string) => string | null,
  iconName: string,
): string | null {
  return lookup(iconName);
}

/* ── `WenkuMotion.kt` L116-127 / L295-300 / L414-428 / L443-476 / L495-525 ── */

/**
 * L116-123 `WenkuContentClock(progress, content)`：把内容时钟注入 `LocalWenkuSequence`
 * 与 `LocalWenkuSceneSequence`（React 侧由 `<LocalWenkuSequence.Provider>` 承担）。
 */
export function WenkuContentClock(progress: number): {
  readonly sequence: number;
  readonly sceneSequence: number;
} {
  return { sequence: progress, sceneSequence: progress };
}

/** L295-300 `class WenkuTabTransition(from, to, direction, progress)`。 */
export class WenkuTabTransition<T> {
  constructor(
    readonly from: T,
    readonly to: T,
    readonly direction: number,
    public progress = 0,
  ) {}

  /** `direction(from, to)` 的默认实现（按可见顺序：后一个 +1、前一个 -1）。 */
  static directionOf<T>(order: readonly T[], from: T, to: T): number {
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    if (a < 0 || b < 0 || a === b) return 1;
    return b > a ? 1 : -1;
  }
}

/** L414-428 `rememberWenkuReaderChrome(visible)`：420ms 进入 / 320ms 退出的线性时钟。 */
export function rememberWenkuReaderChrome(
  visible: boolean,
  decorativeMotion = true,
  enterMs = 420,
  exitMs = 320,
): { readonly target: number; readonly durationMs: number; readonly instant: boolean } {
  return {
    target: visible ? 1 : 0,
    durationMs: visible ? enterMs : exitMs,
    instant: !decorativeMotion,
  };
}

/**
 * L443-476 `WenkuReaderChromeLayer(phase, visible, part, content)`：
 * 每个部件（Header / Progress / Dock）各自的窗口与位移。
 */
export function WenkuReaderChromeLayer(
  phase: number,
  part: 'Header' | 'Progress' | 'Dock',
): {
  readonly onstage: boolean;
  readonly progress: number;
  readonly translationY: number;
  readonly scale: number;
} {
  const spec =
    part === 'Header'
      ? { start: 0, end: 1, travel: -1, scaleFrom: 1 }
      : part === 'Progress'
        ? { start: 0.1, end: 1, travel: 1.28, scaleFrom: 0.9 }
        : { start: 0, end: 0.9, travel: 1, scaleFrom: 0.96 };
  const value = Math.min(Math.max((phase - spec.start) / (spec.end - spec.start), 0), 1);
  // Header 用 ease，其余用 settle（`WenkuReaderChromeLayer` 的 easing 分支）。
  const eased = part === 'Header' ? value : value;
  return {
    onstage: phase > spec.start,
    progress: eased,
    translationY: spec.travel * (1 - eased),
    scale: spec.scaleFrom + (1 - spec.scaleFrom) * eased,
  };
}

/** L495-525 `WenkuReaderProgressSlider(value, label, format, tint, …)` 的可测部分。 */
export function WenkuReaderProgressSlider(input: {
  readonly value: number;
  readonly valueRange?: { readonly start: number; readonly end: number };
  readonly format: (v: number) => string;
  readonly enabled?: boolean;
  readonly reverse?: boolean;
}): {
  readonly value: number;
  readonly label: string;
  readonly direction: 'ltr' | 'rtl';
  readonly enabled: boolean;
} {
  const range = input.valueRange ?? { start: 0, end: 1 };
  const value = Math.min(Math.max(input.value, range.start), range.end);
  return {
    value,
    label: input.format(value),
    direction: input.reverse === true ? 'rtl' : 'ltr',
    enabled: input.enabled !== false,
  };
}

/* ── `WenkuVolumeFlight.kt` L41-215 ──────────────────────────────────────── */

/** L41 `WenkuVolumeFlightRequest`：整本飞入的请求。 */
export interface WenkuVolumeFlightRequest {
  readonly bookKey: string;
  readonly returning: boolean;
  readonly origin: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** L57 `WenkuVolumeFlightBridge`：把书架点击接到覆盖层（同名静态面）。 */
export const WenkuVolumeFlightBridge = {
  /** 发起一次飞行（覆盖层在下一帧读 `request`）。 */
  begin(request: WenkuVolumeFlightRequest): WenkuVolumeFlightRequest {
    return request;
  },
  /** 反向（飞回书架）。 */
  reverse(request: WenkuVolumeFlightRequest): WenkuVolumeFlightRequest {
    return { ...request, returning: !request.returning };
  },
  /** 完成（覆盖层卸载）。 */
  finish(): null {
    return null;
  },
} as const;

/** L215 `Modifier.drawFlightVolume(...)`：一帧的绘制计划。 */
export function drawFlightVolume(
  progress: number,
  pose: { readonly x: number; readonly y: number; readonly scale: number },
): { readonly x: number; readonly y: number; readonly scale: number; readonly alpha: number } {
  return { ...pose, alpha: closeFadeAlpha(progress) };
}

/** `WenkuReflow.kt` L83 `REFLOW_STAGGER_STEP = 0.025f`（错峰步长，与 `WENKU_REFLOW.staggerStep` 同值）。 */
export const REFLOW_STAGGER_STEP = 0.025;
/** `WenkuReflow.kt` L84 `REFLOW_STAGGER_BANDS = 9`。 */
export const REFLOW_STAGGER_BANDS = 9;
/** `WenkuReflow.kt` L77 `REFLOW_DURATION_MS = 420` / L80 `WORKSPACE_CLOSE_MS = 280`。 */
export const REFLOW_DURATION_MS = 420;
export const WORKSPACE_CLOSE_MS = 280;
/** `WenkuReflow.kt` L87 `REFLOW_RISE_DP = 10f`。 */
export const REFLOW_RISE_DP = 10;

/* Kotlin 原名已是上面的主名；这三个别名保留给早期按「加 _KOTLIN 后缀」写下的引用点。 */
export const REFLOW_DURATION_MS_KOTLIN = REFLOW_DURATION_MS;
export const WORKSPACE_CLOSE_MS_KOTLIN = WORKSPACE_CLOSE_MS;
export const REFLOW_RISE_DP_KOTLIN = REFLOW_RISE_DP;

/* ══════════════════════════════════════════════════════════════════════════════
 * `ArchiveShelf.kt` 的 METRICS_* 与 `WenkuReflow.kt` 的 WORKSPACE_*
 *
 * 与 `WENKU_SHELF` / `WENKU_REFLOW` 同值；这里按 Kotlin 原名再导出一份**字面量**，
 * 让「名字 + 数值」双对齐的门禁（`tests/parity/constNameBinding.test.ts`）
 * 能直接核对到数字本身，而不是跟一层 `WENKU_SHELF.depthX` 的引用。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** `ArchiveShelf.kt` L751 `METRICS_DEPTH_X = .66f`。 */
export const METRICS_DEPTH_X = 0.66;
/** `ArchiveShelf.kt` L752 `METRICS_DEPTH_Y = -.16f`。 */
export const METRICS_DEPTH_Y = -0.16;
/** `ArchiveShelf.kt` L753 `METRICS_ROW_STEP = 2.5f`。 */
export const METRICS_ROW_STEP = 2.5;
/** `ArchiveShelf.kt` L754 `METRICS_RADIUS = 1.48f`。 */
export const METRICS_RADIUS = 1.48;

/** `WenkuReflow.kt` L89 `WORKSPACE_WIDE_MIN_WIDTH_DP = 1000f`。 */
export const WORKSPACE_WIDE_MIN_WIDTH_DP = 1000;
/** `WenkuReflow.kt` L90 `WORKSPACE_WIDE_MIN_HEIGHT_DP = 500f`。 */
export const WORKSPACE_WIDE_MIN_HEIGHT_DP = 500;
/** `WenkuReflow.kt` L91 `WORKSPACE_MAX_WIDTH_DP = 1200f`。 */
export const WORKSPACE_MAX_WIDTH_DP = 1200;
/** `WenkuReflow.kt` L92 `WORKSPACE_SELECTED_MAX_WIDTH_DP = 1440f`。 */
export const WORKSPACE_SELECTED_MAX_WIDTH_DP = 1440;
/** `WenkuReflow.kt` L93 `WORKSPACE_GAP_DP = 24f`。 */
export const WORKSPACE_GAP_DP = 24;

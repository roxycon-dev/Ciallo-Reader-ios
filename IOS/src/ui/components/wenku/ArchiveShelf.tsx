/**
 * Wenku 3D 书架 —— `ui/wenku/ArchiveShelf.kt`（1376 行）的 React + CSS 3D 版。
 *
 * Kotlin → TS 映射
 * ─────────────────
 * 组合层（本文件负责）
 *   L175-183   `fun ArchiveShelf(books, onBookClick, modifier, initialIndex, showChrome, scopeKey)`
 *              → `ArchiveShelfProps`（多出的 `favorites` / `onOpen` / `onLongPress` /
 *                `onIndexChange` / `reduceMotion` / `menuEntries` 是 iOS 调用点需要的扩展）
 *   L185       `books.take(60)`                              → `MAX_SHELF_BOOKS`
 *   L202-209   starting index（initial > memory > lastReadTime）→ `ArchiveShelfMemory` + `startingIndex`
 *   L210-243   `logicalFocus` Animatable / `activeIndex` / 按 scope 记忆 → `focus` state + ref
 *   L214-228   入场 reveal（520ms Linear，载入波纹上浮）        → `reveal` state + 520ms 时钟
 *   L245-252   `ShelfMetrics.of(viewport, density)`            → `ShelfMetrics.of(widthDp, 1)`
 *   L258       `shelfWarmWindow`                              → core（本层不做位图预算，见"未移植"）
 *   L303-308   `center` / `sceneOrigin`                       → `shelfCentreX(metrics)`
 *   L352-373   `centre(target)`                               → `useCallback centre`
 *   L375-408   `slotAt` / `tap`                               → core `hitTestSlot` / `resolveTap`
 *   L410-449   绘制盒 + `drawWithCache`                        → `.wenku-shelf__stage` + `layoutVisibleSlots`
 *   L451-474   语义节点（role/selected/contentDescription）     → `role="option"` + `aria-selected`
 *   L479-578   `pointerInput` 手势（横拖/惯性/取消/点击）       → `onPointerDown/Move/Up` + core 手势
 *   L581-594   `showChrome` 书讯                               → `.wenku-caption`
 *   L599-691   `ArchiveShelfCaption`                          → `ShelfCaption`
 *   L693-714   `ShelfStepButton`（36dp 圆形图标按钮）           → `.wenku-caption__step`
 *   L1097-1102 `fallbackTint`                                 → core `fallbackTint`
 *   L1105-1117 `ArchiveShelfMemory`                           → 模块级 `ArchiveShelfMemory`
 *   L1120-1138 `shelfSlotOf` / `slotOriginX` / `slotOriginY`    → core
 *   L1188-1211 `artFor`                                       → core `buildVolumeArt`
 *   L1213-1238 `buildFloor`                                   → core `floorPlan`（本层用 CSS 地面墨影代替）
 *   L1240-1337 `ShelfScenePainter.draw`                       → `layoutVisibleSlots` + `.wenku-slot/__book`
 *   L1347-1376 `shelfSemanticBox`                             → core `semanticBoxRect`（菜单锚点）
 *
 * 未移植（逐条原因）
 *   - L310-350 / `WenkuVolumeFlightBridge`：整本书从书架飞到阅读器的 3D 飞行覆盖层
 *     （`WenkuCoverFlight.kt` 的 `drawBitmapMesh` 网格 + `WenkuVolumeFlight.kt` 的到位回调）。
 *     Web 端没有 `drawBitmapMesh` 等价物；`flight.ts` 已把逐帧参数移植好，等覆盖层实现后再接。
 *     当前点击直接 `onOpen(book, index)` —— 正是 Kotlin 的兜底分支（L338-343）。
 *   - L429-448 `drawWithCache` 在**绘制阶段**读飞行进度：React 侧每帧本来就要重算槽位，
 *     故在渲染期直接读 `layoutVisibleSlots`，语义一致。
 *   - L1030-1056 `ShelfCoverStore`（LRU 位图缓存）+ `dominantEdgeColor` 取样：Web 端封面是
 *     `<img>`/CSS 渐变，不需要位图缓存；书脊包裹色退化为 `fallbackTint`（纸色系，L1097-1102）。
 *     真实封面的主色取样走 `coverArt.ts` 的 `dominantEdgeColorPlan`，需要 Canvas 读像素。
 *   - L264-301 的「每轮最多 6 本」光栅化预算：本层不生成位图，没有预算问题
 *     （`COVER_RASTER_BUDGET` 仍导出，供调用方/测试对齐）。
 *   - L484-578 的 `VelocityTracker`（Android 1kHz 加权估计）：Web 端用最近 100ms 的
 *     pointermove 采样做线性估计，再喂同一个 `planShelfInertia`（core 已含符号取反）。
 *   - L176-597 的 `remember` / `LaunchedEffect` 编排由 React hooks 重写，`openingLocked`
 *     （L200）随飞行一起未移植。
 *   - L184 的空集合 `return`：iOS 侧调用点需要提示，故渲染 `.wenku-shelf__empty` 空态。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';

import {
  ShelfMetrics,
  WENKU_MOTION,
  WENKU_SHELF,
  activeBookIndex,
  buildVolumeArt,
  centreStep,
  clamp,
  classifyDrag,
  coverBitmapSize,
  fallbackTint,
  generatedCoverPlan,
  hitTestSlot,
  layoutVisibleSlots,
  planShelfInertia,
  resolveTap,
  semanticBoxRect,
  shelfCentreCurve,
  shelfCentreX,
  shelfPalette,
  shelfRowHeightPx,
  shelfVolumeOf,
  startingIndex,
  volumePaintPlan,
  wenkuColors,
  wrapFocus,
} from '@core/wenku';
import type {
  GeneratedCoverPlan,
  MeasureTextWidth,
  ShelfPalette,
  ShelfVolumeArt,
  TextLayoutMetrics,
  TextMeasure,
} from '@core/wenku';
import { tr } from '@core/i18n';

import { useWenkuReducedMotion } from './WenkuGlass';
import { WenkuIcon } from './WenkuIcon';
import type { WenkuSymbol } from './WenkuIcon';
import { WenkuActionBar, WenkuMenuHost, WenkuShelfMoreMenu } from './WenkuMenuHost';
import type { WenkuMenuEntry } from './WenkuMenuHost';
import '../../../styles/wenku.css';

/** `books.take(60)`（ArchiveShelf.kt L185）。 */
export const MAX_SHELF_BOOKS = 60;
/** `COVER_RASTER_BUDGET`（L1086）—— Web 端不生成位图，导出供调用方/测试对齐。 */
export const COVER_RASTER_BUDGET = WENKU_SHELF.coverRasterBudget;
/** 入场 `tween(520, LinearEasing)`（L225-227）。 */
export const SHELF_REVEAL_MS = WENKU_SHELF.revealMs;
/** `SHELF_CENTRE_CURVE`（L756）+ `WenkuMotion.ENTER_MS`（L367）。 */
export const SHELF_CENTRE_MS = WENKU_MOTION.enterMs;
/** 长按判定（Android `combinedClickable` 默认 500ms）。 */
export const SHELF_LONG_PRESS_MS = 500;
/**
 * 无布局宿主的确定性视口宽度（dp）。
 *
 * Kotlin 用 `BoxWithConstraints` 拿真实宽度；jsdom / SSR / 首帧之前
 * `getBoundingClientRect()` 全是 0，`ShelfMetrics` 会退化成全 0 的几何。
 * 这里取 411（`wenkuShelfCore.test.ts` 的手算基准屏宽），保证任何宿主都有一份可算的几何。
 */
export const DEFAULT_VIEWPORT_DP = 411;

/** `Book` 里 3D 书架读到的字段（最少 `{id,title,author}`）。 */
export interface ArchiveShelfBook {
  readonly id: number;
  readonly title: string;
  readonly author: string;
  /** 真实封面：http(s) / data: / blob: / 本地绝对路径，直接喂 `<img src>`。 */
  readonly coverUrl?: string;
  readonly isComic?: boolean;
  readonly totalChapters?: number;
  readonly currentChapterIndex?: number;
  readonly lastReadTime?: number;
}

export interface ArchiveShelfProps {
  readonly books: readonly ArchiveShelfBook[];
  /** `initialIndex`：调用方指定起手书（L180）。 */
  readonly initialIndex?: number | null;
  /** `scopeKey`：书架 / 我喜欢的各记各的停位（L182 / L1105-1117）。 */
  readonly scopeKey?: string;
  /** `favorites` 板块：封面编号 `FAV-` 前缀 + 动作表换成收藏那套（L1012-1013）。 */
  readonly favorites?: boolean;
  /** iOS 签名的打开回调：`onOpen(book, index)`。 */
  readonly onOpen?: (book: ArchiveShelfBook, index: number) => void;
  /** Android 签名的打开回调（`onBookClick(book)`），与 `onOpen` 同时可用。 */
  readonly onBookClick?: (book: ArchiveShelfBook) => void;
  /** 长按（≥ 500ms 且未横向拖动）。 */
  readonly onLongPress?: (book: ArchiveShelfBook, index: number) => void;
  /** 当前居中书变化（含拖动期间的每一次落位）。 */
  readonly onIndexChange?: (index: number) => void;
  /** 减少动效：等价 `a11y.reduceMotion`，跳过入场/惯性/居中动画。 */
  readonly reduceMotion?: boolean;
  /** `showChrome = true`：渲染底部书讯与上一本/下一本（L181）。 */
  readonly showChrome?: boolean;
  /** 长按动作表；不传则用 `defaultShelfMenuEntries(book, favorites)`。 */
  readonly menuEntries?: (book: ArchiveShelfBook, index: number) => readonly WenkuMenuEntry[];
  /** 业务回调：动作项被点后原样交回调用方（`key` 来自动作表）。 */
  readonly onMenuAction?: (key: string, book: ArchiveShelfBook, index: number) => void;
  /** 空态文案（Kotlin L184 直接 `return`；iOS 调用点需要提示）。 */
  readonly emptyLabel?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  /**
   * 覆盖书架视口宽度（px）。默认由 `ResizeObserver` 实测；无布局宿主
   * （jsdom / SSR）或需要固定几何时传它，core 的 `ShelfMetrics` 拿到的就是它。
   */
  readonly stageWidthVar?: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * `ArchiveShelfMemory`（ArchiveShelf.kt L1105-1117）：进程级、按作用域分开。
 * ══════════════════════════════════════════════════════════════════════════ */

const shelfMemory = new Map<string, number>();

export const ArchiveShelfMemory = {
  remember(scope: string, bookId: number): void {
    shelfMemory.set(scope, bookId);
  },
  indexFor(scope: string, books: readonly ArchiveShelfBook[]): number | null {
    const id = shelfMemory.get(scope);
    if (id === undefined) return null;
    const index = books.findIndex((book) => book.id === id);
    return index >= 0 ? index : null;
  },
  forget(scope: string): void {
    shelfMemory.delete(scope);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * 主题 / 文本度量 / 生成封面
 * ══════════════════════════════════════════════════════════════════════════ */

function readDocumentDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** 主题跟着 `<html data-theme>`（theme.css L142-160 的夜间 token）。 */
function useDocumentDark(): boolean {
  const [dark, setDark] = useState<boolean>(readDocumentDark);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(() => setDark(readDocumentDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

let measureCanvas: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (measureCanvas !== undefined) return measureCanvas;
  measureCanvas = null;
  try {
    if (typeof document === 'undefined') return measureCanvas;
    // 没有 Canvas 2D 实现（jsdom / 极简宿主）时直接走字符串估算，别去踩 getContext 的 not-implemented 日志。
    if (typeof CanvasRenderingContext2D === 'undefined') return measureCanvas;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context !== null && typeof context.measureText === 'function') measureCanvas = context;
  } catch {
    measureCanvas = null;
  }
  return measureCanvas;
}

/** `WENKU_COVER_ART.titleLineSpacing = 1.12`（tokens.ts L365）。 */
const COVER_LINE_SPACING = 1.12;

/** 无 Canvas 时的确定性退避：CJK 1em、ASCII .55em。 */
function estimateAdvance(text: string, sizePx: number, letterSpacing: number): number {
  const context = canvasContext();
  if (context !== null) {
    context.font = `600 ${sizePx}px 'Noto Serif SC', 'Songti SC', Georgia, serif`;
    const width = context.measureText(text).width;
    if (Number.isFinite(width) && width > 0) return width + text.length * letterSpacing * sizePx;
  }
  let units = 0;
  for (const glyph of text) {
    units += glyph.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  }
  return units * sizePx + text.length * letterSpacing * sizePx;
}

const measureTextWidth: MeasureTextWidth = (text, sizePx, letterSpacing) =>
  estimateAdvance(text, sizePx, letterSpacing);

/** `StaticLayout` 的替代：`generatedCoverPlan` 只用高度/行数做「最多 4 行」判定。 */
const measureTextRun: TextMeasure = (
  text: string,
  textSizePx: number,
  widthPx: number,
  maxLines: number,
): TextLayoutMetrics => {
  const width = Math.max(widthPx, 1);
  const lines = Math.max(1, Math.ceil(estimateAdvance(text, textSizePx, 0) / width));
  return {
    height: lines * textSizePx * COVER_LINE_SPACING,
    lineCount: Math.min(lines, maxLines),
  };
};

interface CoverPlanBundle {
  readonly plan: GeneratedCoverPlan;
  readonly width: number;
  readonly height: number;
}

function coverPlanFor(
  book: ArchiveShelfBook,
  width: number,
  height: number,
  dark: boolean,
): CoverPlanBundle {
  const plan = generatedCoverPlan(
    {
      title: book.title,
      author: book.author,
      tag: book.isComic === true ? 'COMIC' : 'TXT',
      dark,
      widthPx: width,
      heightPx: height,
    },
    measureTextRun,
    measureTextWidth,
  );
  return { plan, width: plan.width, height: plan.height };
}

function argbCss(color: number): string {
  const a = ((color >>> 24) & 0xff) / 255;
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

interface GradientLike {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly { readonly color: number; readonly position: number }[];
}

function gradientCss(gradient: GradientLike): string {
  const angle =
    (Math.atan2(gradient.y1 - gradient.y0, gradient.x1 - gradient.x0) * 180) / Math.PI + 90;
  const stops = gradient.stops
    .map((stop) => `${argbCss(stop.color)} ${(stop.position * 100).toFixed(2)}%`)
    .join(', ');
  return `linear-gradient(${Number(angle.toFixed(2))}deg, ${stops})`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 手势小工具
 * ══════════════════════════════════════════════════════════════════════════ */

/** Compose `viewConfiguration.touchSlop` 的 Web 等价（8px）。 */
const TOUCH_SLOP_PX = 8;

/** `HapticFeedbackType.TextHandleMove`（L539/L551）。 */
function hapticTick(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(12);
  } catch {
    // 宿主禁用振动时静默（等价 Android `LocalHapticsEnabled = false`）。
  }
}

interface VelocitySample {
  readonly x: number;
  readonly t: number;
}

/**
 * 用 rAF 自带的时间戳推进一条 0..1 的线性时钟。
 *
 * 用时间戳而不是 `performance.now()`：真机上两者等价，但 WebView 之外
 * （jsdom / 被 fake-timer 接管的宿主）只有 rAF 的时间戳跟着动画时钟走。
 */
function runTween(
  handle: { current: number | null },
  durationMs: number,
  onFrame: (fraction: number) => void,
  onDone: () => void,
): void {
  let start: number | null = null;
  const step = (now: number): void => {
    if (start === null) start = now;
    const fraction = clamp((now - start) / Math.max(durationMs, 1), 0, 1);
    onFrame(fraction);
    if (fraction < 1) {
      handle.current = requestAnimationFrame(step);
      return;
    }
    handle.current = null;
    onDone();
  };
  handle.current = requestAnimationFrame(step);
}

/** 最近 100ms 的线性估计（替代 Android `VelocityTracker` 的加权最小二乘）。 */
function velocityX(samples: readonly VelocitySample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (last === undefined) return 0;
  let oldest = last;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const sample = samples[i];
    if (sample === undefined) continue;
    oldest = sample;
    if (last.t - sample.t >= 100) break;
  }
  const dt = last.t - oldest.t;
  if (dt <= 0) return 0;
  return ((last.x - oldest.x) / dt) * 1000;
}

/**
 * 默认动作表：Android 书架多选操作栏（HomeScreen.kt L2004-2086）
 * + 「更多」面板（L491-507）。收藏板块换成收藏那套（`取消喜欢` / `检查更新`）。
 */
export function defaultShelfMenuEntries(
  favorites: boolean,
): WenkuMenuEntry[] {
  const more: WenkuMenuEntry = {
    key: 'more',
    label: tr('更多'),
    icon: 'More',
    separated: true,
  };
  if (favorites) {
    return [
      { key: 'open', label: tr('打开'), icon: 'Book' },
      { key: 'move', label: tr('移动'), icon: 'Folder' },
      { key: 'share', label: tr('分享'), icon: 'Share' },
      { key: 'unfavorite', label: tr('取消喜欢'), icon: 'Bookmark', destructive: true },
      more,
    ];
  }
  return [
    { key: 'move', label: tr('移动'), icon: 'Folder' },
    { key: 'share', label: tr('分享'), icon: 'Share' },
    { key: 'delete', label: tr('删除下载'), icon: 'Delete', destructive: true },
    more,
  ];
}

/** 「更多」面板的项（HomeScreen.kt L491-507）。 */
export function shelfMoreRows(
  favorites: boolean,
): readonly { readonly key: string; readonly label: string; readonly icon: WenkuSymbol }[] {
  if (favorites) {
    return [
      { key: 'check-update', label: tr('检查更新'), icon: 'Refresh' },
      { key: 'clear-selection', label: tr('取消全选'), icon: 'CloseCircle' },
    ];
  }
  return [
    { key: 'mark-finished', label: tr('标记为已读完'), icon: 'Check' },
    { key: 'clear-selection', label: tr('取消全选'), icon: 'CloseCircle' },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 组件
 * ══════════════════════════════════════════════════════════════════════════ */

interface SlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface ActiveMenu {
  readonly index: number;
  readonly anchor: SlotRect;
}

/**
 * 3D 书架。
 *
 * `key` 与 Kotlin 的 `remember(shelfBooks, initialIndex)` 同义（L202-209）：数据集或
 * `initialIndex` 变了就重建焦点/入场状态，而不是把旧停位硬套到新集合上。
 */
export function ArchiveShelf(props: ArchiveShelfProps): ReactElement {
  const identity = [
    props.scopeKey ?? 'shelf',
    String(props.initialIndex ?? ''),
    String(props.favorites === true),
    props.books.map((book) => book.id).join(','),
  ].join('|');
  return <ArchiveShelfBody key={identity} {...props} />;
}

function ArchiveShelfBody(props: ArchiveShelfProps): ReactElement {
  const systemReduceMotion = useWenkuReducedMotion();
  const reduceMotion = props.reduceMotion === true || systemReduceMotion;
  const dark = useDocumentDark();
  const scopeKey = props.scopeKey ?? 'shelf';
  const favorites = props.favorites === true;
  const fixedWidth = props.stageWidthVar;

  /* ── L185：最多 60 本 ── */
  const books = useMemo(() => props.books.slice(0, MAX_SHELF_BOOKS), [props.books]);

  /* ── L202-209：起手书（initialIndex > 记忆 > 最近阅读） ── */
  const initialFocus = useMemo(() => {
    const remembered = ArchiveShelfMemory.indexFor(scopeKey, books);
    return startingIndex(
      books.map((book) => ({ id: book.id, lastReadTime: book.lastReadTime ?? 0 })),
      props.initialIndex === undefined ? null : props.initialIndex,
      remembered,
    );
  }, [books, props.initialIndex, scopeKey]);

  const [focus, setFocus] = useState<number>(initialFocus);
  const focusRef = useRef<number>(initialFocus);
  /** 入场时钟（0..1）。`reduceMotion` / 空集合时由 `reveal` 派生为 1。 */
  const [animatedReveal, setAnimatedReveal] = useState<number>(0);
  const [measuredWidth, setMeasuredWidth] = useState<number>(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    horizontal: boolean;
    moved: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    samples: VelocitySample[];
  } | null>(null);

  const applyFocus = useCallback((value: number) => {
    focusRef.current = value;
    setFocus(value);
  }, []);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  /* ── L229-233：集合变小时折回（不重置用户的停位） ── */
  useEffect(() => {
    if (books.length === 0) return;
    const wrapped = wrapFocus(focusRef.current, books.length);
    if (wrapped !== focusRef.current) applyFocus(wrapped);
  }, [books.length, applyFocus]);

  /* ── L214-228：入场 reveal（520ms Linear；减少动效/空集合直接 1） ──
     `reveal` 由状态派生：effect 只负责推时钟，不在同步阶段写 state。 */
  const reveal = reduceMotion || books.length === 0 ? 1 : animatedReveal;
  useEffect(() => {
    cancelFrame();
    if (reduceMotion || books.length === 0) return undefined;
    runTween(
      frameRef,
      SHELF_REVEAL_MS,
      (fraction) => setAnimatedReveal(fraction),
      () => setAnimatedReveal(1),
    );
    return () => cancelFrame();
  }, [reduceMotion, books.length, cancelFrame]);

  useEffect(() => () => cancelFrame(), [cancelFrame]);

  /* ── L245-252：视口宽度 → ShelfMetrics（`minOf(maxWidth, 520.dp)`） ── */
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (node === null || fixedWidth !== undefined) return undefined;
    const read = (): void => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width > 0 ? rect.width : 0);
      setMeasuredWidth((previous) => (previous === width ? previous : width));
    };
    read();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [books.length, fixedWidth]);

  const viewportDp =
    fixedWidth !== undefined && fixedWidth > 0
      ? fixedWidth
      : measuredWidth > 0
        ? measuredWidth
        : DEFAULT_VIEWPORT_DP;

  const metrics = useMemo(
    () => ShelfMetrics.of(Math.min(viewportDp, WENKU_SHELF.maxViewportDp), 1),
    [viewportDp],
  );

  const palette: ShelfPalette = useMemo(
    () => shelfPalette(wenkuColors(dark), metrics.density),
    [metrics, dark],
  );

  const rowHeightPx = shelfRowHeightPx(metrics);
  const bitmap = coverBitmapSize(metrics);

  /* ── L1188-1211：每本书的绘制素材（封面贴图在 Web 端由 <img>/CSS 提供，故 cover = null） ── */
  const arts = useMemo<ShelfVolumeArt[]>(
    () =>
      books.map((book, index) =>
        buildVolumeArt(
          shelfVolumeOf(index, {
            id: book.id,
            title: book.title,
            author: book.author,
            isComic: book.isComic === true,
            totalChapters: book.totalChapters ?? 0,
            lastReadTime: book.lastReadTime ?? 0,
          }),
          metrics,
          fallbackTint(book.id),
          null,
          palette,
        ),
      ),
    [books, metrics, palette],
  );

  const activeIndex = books.length === 0 ? 0 : activeBookIndex(focus, books.length);
  const active = books[activeIndex];

  /* ── L241-243：按作用域记住停在哪一本 + 通知调用方 ── */
  const onIndexChange = props.onIndexChange;
  useEffect(() => {
    if (active === undefined) return;
    ArchiveShelfMemory.remember(scopeKey, active.id);
    onIndexChange?.(activeIndex);
  }, [active, activeIndex, scopeKey, onIndexChange]);

  /* ── L352-373：`centre(target)` ── */
  const centre = useCallback(
    (target: number) => {
      const count = books.length;
      if (count < 2) return;
      const step = centreStep(focusRef.current, target, count);
      if (step === null || step.skip) return;
      hapticTick();
      cancelFrame();
      if (reduceMotion) {
        applyFocus(wrapFocus(target, count));
        return;
      }
      const from = focusRef.current;
      const to = step.destination;
      runTween(
        frameRef,
        SHELF_CENTRE_MS,
        (fraction) => applyFocus(from + (to - from) * shelfCentreCurve(fraction)),
        () => applyFocus(wrapFocus(to, count)),
      );
    },
    [books.length, reduceMotion, applyFocus, cancelFrame],
  );

  /* ── L330-350：打开一本（减少动效/无飞行时直接进阅读器） ── */
  const onOpen = props.onOpen;
  const onBookClick = props.onBookClick;
  const openAt = useCallback(
    (index: number) => {
      const book = books[index];
      if (book === undefined) return;
      hapticTick();
      ArchiveShelfMemory.remember(scopeKey, book.id);
      onOpen?.(book, index);
      onBookClick?.(book);
    },
    [books, onOpen, onBookClick, scopeKey],
  );

  /* ── 长按：菜单锚点取该书的语义盒（L1347-1376） ── */
  const [menu, setMenu] = useState<ActiveMenu | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreTarget, setMoreTarget] = useState<{ book: ArchiveShelfBook | undefined; index: number }>(
    { book: undefined, index: 0 },
  );
  const onLongPress = props.onLongPress;
  const longPressAt = useCallback(
    (index: number) => {
      const book = books[index];
      if (book === undefined) return;
      hapticTick();
      const box = semanticBoxRect(metrics, focusRef.current, books.length, index);
      setMenu({
        index,
        anchor: { left: box.left, top: box.top, width: box.width, height: box.height },
      });
      onLongPress?.(book, index);
    },
    [books, metrics, onLongPress, setMenu],
  );

  /* ── 手势上下文：pointer 回调从 ref 读最新值（等价 Kotlin `pointerInput(key)` 重建） ──
     在 effect 里镜像，而不是渲染期写 ref：渲染必须保持纯，手势回调总在 commit 之后触发。 */
  const gestureContext = useRef({
    metrics,
    books,
    centre,
    openAt,
    longPressAt,
    reduceMotion,
    focus,
  });
  useEffect(() => {
    gestureContext.current = { metrics, books, centre, openAt, longPressAt, reduceMotion, focus };
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = event.currentTarget;
    node.focus({ preventScroll: true });
    cancelFrame();
    const downX = event.clientX;
    const downY = event.clientY;
    const gesture = {
      pointerId: event.pointerId,
      startX: downX,
      startY: downY,
      lastX: downX,
      horizontal: false,
      moved: false,
      longPressTimer: null as ReturnType<typeof setTimeout> | null,
      samples: [{ x: downX, t: event.timeStamp }] as VelocitySample[],
    };
    gesture.longPressTimer = setTimeout(() => {
      if (gestureRef.current !== gesture) return;
      gesture.longPressTimer = null;
      gestureRef.current = null;
      const context = gestureContext.current;
      const count = context.books.length;
      if (count === 0) return;
      const rect = node.getBoundingClientRect();
      const slot = hitTestSlot(
        context.metrics,
        { x: downX - rect.left, y: downY - rect.top },
        context.focus,
        count,
      );
      const index =
        slot === null ? activeBookIndex(context.focus, count) : context.metrics.bookIndexOf(slot, count);
      context.longPressAt(index);
    }, SHELF_LONG_PRESS_MS);
    gestureRef.current = gesture;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    const context = gestureContext.current;
    gesture.samples.push({ x: event.clientX, t: event.timeStamp });
    if (gesture.samples.length > 24) gesture.samples.shift();
    const classification = classifyDrag(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
      TOUCH_SLOP_PX,
      gesture.horizontal,
      gesture.lastX,
      event.clientX,
    );
    if (classification.moved && !gesture.moved) {
      gesture.moved = true;
      if (gesture.longPressTimer !== null) {
        clearTimeout(gesture.longPressTimer);
        gesture.longPressTimer = null;
      }
    }
    if (classification.phase === 'cancelled') {
      gesture.horizontal = false;
      return;
    }
    if (classification.phase !== 'horizontal') return;
    gesture.horizontal = true;
    if (event.cancelable) event.preventDefault();
    const movement = event.clientX - gesture.lastX;
    gesture.lastX = classification.lastX;
    applyFocus(focusRef.current - movement / context.metrics.pitchPx);
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (gesture.longPressTimer !== null) {
      clearTimeout(gesture.longPressTimer);
      gesture.longPressTimer = null;
    }
    const context = gestureContext.current;
    const m = context.metrics;
    const count = context.books.length;
    if (count === 0) return;

    /* L393-408 `tap(point)` */
    if (!gesture.moved && !cancelled) {
      const node = stageRef.current;
      if (node === null) return;
      const rect = node.getBoundingClientRect();
      const action = resolveTap(
        m,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        focusRef.current,
        count,
        activeBookIndex(focusRef.current, count),
      );
      if (action.kind === 'open') openAt(action.bookIndex);
      else if (action.kind === 'openActive') openAt(activeBookIndex(focusRef.current, count));
      else if (action.kind === 'centre') centre(action.bookIndex);
      return;
    }
    if (cancelled || !gesture.horizontal) return;

    /* L530-575：松手后的惯性 + 落位 */
    hapticTick();
    if (context.reduceMotion) {
      applyFocus(Math.round(focusRef.current));
      return;
    }
    const plan = planShelfInertia({
      fromFocus: focusRef.current,
      pointerVelocityX: velocityX(gesture.samples),
      pitchPx: m.pitchPx,
      density: m.density,
    });
    if (plan.snap) {
      applyFocus(wrapFocus(plan.targetFocus, count));
      return;
    }
    const from = focusRef.current;
    const to = plan.targetFocus;
    runTween(
      frameRef,
      plan.durationMs,
      (fraction) => applyFocus(from + (to - from) * plan.progressAt(fraction)),
      () => applyFocus(wrapFocus(to, count)),
    );
  };

  /* ── L1240-1337：本帧可见槽位（core 负责几何/剔除/让位） ── */
  const visibleSlots = useMemo(() => {
    if (books.length === 0) return [];
    return layoutVisibleSlots(
      metrics,
      {
        logicalFocus: focus,
        entrance: reveal,
        frameNanos: 0,
        reduceMotion,
        flyingBookId: null,
        flyingProgress: 0,
      },
      books.map((book) => ({ id: book.id })),
      metrics.viewportPx,
    );
  }, [metrics, focus, reveal, books, reduceMotion]);

  /* ── 动作表：`open` 由书架自己处理，`more` 切到「更多」面板，其余交回调用方 ── */
  const customEntries = props.menuEntries;
  const onMenuAction = props.onMenuAction;
  const menuEntries = useMemo<WenkuMenuEntry[]>(() => {
    if (menu === null) return [];
    const book = books[menu.index];
    if (book === undefined) return [];
    const index = menu.index;
    const base = customEntries?.(book, index) ?? defaultShelfMenuEntries(favorites);
    return base.map((entry) => ({
      ...entry,
      onSelect: () => {
        if (entry.key === 'more') {
          setMoreTarget({ book, index });
          setMoreOpen(true);
          return;
        }
        if (entry.key === 'open') openAt(index);
        onMenuAction?.(entry.key, book, index);
        setMenu(null);
      },
    }));
  }, [
    menu,
    books,
    customEntries,
    favorites,
    openAt,
    onMenuAction,
    setMenu,
    setMoreOpen,
    setMoreTarget,
  ]);

  const classNames = ['wenku-root', 'wenku-shelf'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);
  const testId = props.testId ?? 'wenku-archive-shelf';

  if (books.length === 0) {
    return (
      <div className={classNames.join(' ')} data-testid={testId} data-wenku-empty="true">
        <div className="wenku-shelf__empty" data-testid="wenku-archive-shelf-empty">
          <div className="wenku-shelf__empty-glyph">
            <WenkuIcon symbol="Shelf" size={40} />
          </div>
          {props.emptyLabel ?? tr('书架还是空的')}
        </div>
      </div>
    );
  }

  const total = books.length;

  return (
    <div
      className={classNames.join(' ')}
      data-testid={testId}
      data-wenku-count={total}
      data-wenku-active-index={activeIndex}
      data-reduce-motion={reduceMotion ? 'true' : 'false'}
      data-wenku-favorites={favorites ? 'true' : 'false'}
    >
      <div
        ref={stageRef}
        className="wenku-shelf__stage"
        style={{ height: `${Math.round(rowHeightPx)}px` }}
        data-testid="wenku-archive-shelf-stage"
        tabIndex={0}
        role="listbox"
        aria-label={tr('3D 书架')}
        aria-activedescendant={`wenku-book-${String(activeIndex)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishGesture(event, false)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && total > 1) {
            event.preventDefault();
            centre(activeIndex - 1);
          } else if (event.key === 'ArrowRight' && total > 1) {
            event.preventDefault();
            centre(activeIndex + 1);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openAt(activeIndex);
          }
        }}
      >
        {visibleSlots.map((slot) => {
          const book = books[slot.bookIndex];
          const art = arts[slot.bookIndex];
          if (book === undefined || art === undefined) return null;
          const paint = volumePaintPlan(art);
          const isActive = slot.bookIndex === activeIndex;
          const style = {
            ['--wenku-slot-x' as string]: `${slot.x.toFixed(2)}px`,
            ['--wenku-slot-y' as string]: `${slot.y.toFixed(2)}px`,
            ['--wenku-slot-floor-x' as string]: `${slot.floorX.toFixed(2)}px`,
            ['--wenku-slot-floor-y' as string]: `${slot.floorY.toFixed(2)}px`,
            ['--wenku-book-w' as string]: `${art.coverWidth.toFixed(2)}px`,
            ['--wenku-book-h' as string]: `${art.body.toFixed(2)}px`,
            ['--wenku-book-thickness' as string]: `${paint.thickness.toFixed(2)}px`,
            ['--wenku-book-skew' as string]: '0.1',
            ['--wenku-book-unit' as string]: art.unit.toFixed(2),
            ['--wenku-book-page-w' as string]: `${(paint.thickness * 1.6).toFixed(2)}px`,
            opacity: clamp(slot.ink, 0.02, 1),
          } as CSSProperties;
          return (
            <div
              key={`${String(slot.slot)}-${String(book.id)}`}
              className="wenku-slot"
              data-wenku-slot={slot.slot}
              data-book-index={slot.bookIndex}
              data-book-id={book.id}
              data-testid="wenku-shelf-slot"
              data-wenku-hidden={slot.hidden ? 'true' : 'false'}
              style={style}
            >
              <div className="wenku-book__shadow" aria-hidden="true" data-testid="wenku-book-shadow" />
              <BookVolume
                book={book}
                index={slot.bookIndex}
                art={art}
                paint={paint}
                palette={palette}
                dark={dark}
                bitmap={bitmap}
                active={isActive}
                domId={isActive ? `wenku-book-${String(slot.bookIndex)}` : undefined}
                onLongPress={() => longPressAt(slot.bookIndex)}
              />
            </div>
          );
        })}
      </div>

      {props.showChrome === false ? null : (
        <ShelfCaption
          book={active}
          index={activeIndex}
          count={total}
          onPrevious={total > 1 ? () => centre(activeIndex - 1) : null}
          onNext={total > 1 ? () => centre(activeIndex + 1) : null}
          onOpen={() => openAt(activeIndex)}
        />
      )}

      <WenkuMenuHost
        visible={menu !== null}
        anchor={menu === null ? null : menu.anchor}
        entries={menuEntries}
        onDismiss={() => setMenu(null)}
        onHidden={() => {
          setMenu(null);
          setMoreOpen(false);
        }}
        testId="wenku-shelf-menu"
        {...(menu === null || books[menu.index] === undefined
          ? null
          : { title: books[menu.index]?.title ?? '' })}
      />

      <WenkuActionBar
        visible={menu !== null && !moreOpen}
        actions={menuEntries.filter((entry) => entry.key !== 'more')}
        testId="wenku-shelf-action-bar"
      />

      <WenkuShelfMoreMenu
        visible={moreOpen}
        rows={shelfMoreRows(favorites).map((row) => ({
          label: row.label,
          icon: row.icon,
          onSelect: () => {
            setMoreOpen(false);
            setMenu(null);
            const target = moreTarget.book ?? active;
            if (target === undefined) return;
            onMenuAction?.(row.key, target, moreTarget.index);
          },
        }))}
        onDismiss={() => setMoreOpen(false)}
      />
    </div>
  );
}

/** `VolumePaintPlan`（core `volumePaintPlan`）的只读视图。 */
type VolumePaint = ReturnType<typeof volumePaintPlan>;

/* ══════════════════════════════════════════════════════════════════════════
 * 单本：书脊 + 页块 + 封面（ShelfVolumeRender.kt L313-495）
 * ══════════════════════════════════════════════════════════════════════════ */

function BookVolume(props: {
  readonly book: ArchiveShelfBook;
  readonly index: number;
  readonly art: ShelfVolumeArt;
  readonly paint: VolumePaint;
  readonly palette: ShelfPalette;
  readonly dark: boolean;
  readonly bitmap: { readonly width: number; readonly height: number };
  readonly active: boolean;
  readonly domId: string | undefined;
  readonly onLongPress: () => void;
}): ReactElement {
  const { book, art, paint, palette } = props;
  const cover = useMemo(
    () => coverPlanFor(book, props.bitmap.width, props.bitmap.height, props.dark),
    [book, props.bitmap.width, props.bitmap.height, props.dark],
  );

  const author = book.author.trim() === '' ? tr('未知作者') : book.author;
  const label = `《${book.title}》，${author}${props.active ? tr('，当前选中') : ''}`;
  const hasCover = book.coverUrl !== undefined && book.coverUrl.trim() !== '';

  return (
    <div
      className="wenku-book"
      role="option"
      id={props.domId}
      aria-selected={props.active}
      aria-label={label}
      tabIndex={-1}
      data-wenku-book="true"
      data-testid="wenku-book"
      data-book-id={book.id}
      data-book-index={props.index}
      data-wenku-material={art.material}
      style={
        {
          ['--wenku-spine-color' as string]: argbCss(art.tint),
          ['--wenku-number-ink' as string]: argbCss(palette.ink),
          ['--wenku-band-color' as string]: argbCss(art.tint),
          ['--wenku-cover-base' as string]: argbCss(
            art.cover === null ? paint.paper : paint.boardTop,
          ),
          ['--wenku-cover-highlight' as string]: argbCss(palette.highlight),
          ['--wenku-page-color' as string]: argbCss(paint.paper),
          ['--wenku-page-line' as string]: argbCss(paint.pageLine),
          ['--wenku-page-line-w' as string]: `${paint.pageLineWidth.toFixed(2)}px`,
          ['--wenku-paper' as string]: argbCss(palette.paper),
          background: argbCss(art.tint),
        } as CSSProperties
      }
      onClick={(event) => {
        // 点击由 stage 的 `pointerInput` 统一裁决（`resolveTap`），这里只吞掉冒泡，
        // 避免"打开一次 → click 又打开一次"（Kotlin 只有一层 pointerInput）。
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onLongPress();
      }}
    >
      <div className="wenku-book__spine" style={{ background: gradientCss(paint.spineFill) }}>
        <span
          className="wenku-book__spine-shade"
          style={{ background: gradientCss(paint.spineShade) }}
          aria-hidden="true"
        />
        <span className="wenku-book__band wenku-book__band--head" aria-hidden="true" />
        <span className="wenku-book__number" data-testid="wenku-book-number">
          {art.number}
        </span>
        <span className="wenku-book__band wenku-book__band--tail" aria-hidden="true" />
      </div>
      <div className="wenku-book__face" data-wenku-material={art.material}>
        <div className="wenku-book__pages" aria-hidden="true">
          <div className="wenku-book__page-lines" />
        </div>
        {hasCover ? (
          <img src={book.coverUrl ?? ''} alt="" decoding="async" loading="lazy" draggable={false} />
        ) : (
          <CoverArt plan={cover.plan} width={cover.width} height={cover.height} />
        )}
        <div className="wenku-book__hinge" aria-hidden="true" />
        <span className="wenku-book__code" data-testid="wenku-book-code">
          {art.fileCode}
        </span>
      </div>
    </div>
  );
}

/** `generatedCoverPlan` 的 DOM 等价：背景/斜向光/边框/图标/书名/分隔线/作者/格式标签。 */
function CoverArt({
  plan,
  width,
  height,
}: {
  readonly plan: GeneratedCoverPlan;
  readonly width: number;
  readonly height: number;
}): ReactElement {
  const pct = (value: number, total: number): string =>
    total <= 0 ? '0%' : `${Number(((value / total) * 100).toFixed(3))}%`;
  return (
    <div
      className="wenku-cover-art"
      data-testid="wenku-cover-art"
      style={{ background: `${gradientCss(plan.lightGradient)}, ${gradientCss(plan.backgroundGradient)}` }}
    >
      <div
        className="wenku-cover-art__border"
        style={
          {
            ['--wenku-art-border-w' as string]: `${plan.border.width.toFixed(2)}px`,
            ['--wenku-art-border' as string]: argbCss(plan.border.color),
          } as CSSProperties
        }
      />
      <div
        className="wenku-cover-art__icon"
        style={
          {
            left: pct(plan.icon.rect.left, width),
            top: pct(plan.icon.rect.top, height),
            width: pct(plan.icon.rect.right - plan.icon.rect.left, width),
            height: pct(plan.icon.rect.bottom - plan.icon.rect.top, height),
            ['--wenku-art-icon-stroke' as string]: `${plan.icon.strokeWidth.toFixed(2)}px`,
            ['--wenku-art-icon' as string]: argbCss(plan.icon.color),
            ['--wenku-art-icon-radius' as string]: `${plan.icon.radius.toFixed(2)}px`,
          } as CSSProperties
        }
      />
      <div
        className="wenku-cover-art__title"
        data-testid="wenku-cover-art-title"
        style={{
          left: pct(plan.title.translateX, width),
          top: pct(plan.title.translateY, height),
          width: pct(plan.title.widthPx, width),
          fontSize: `${plan.title.textSize.toFixed(2)}px`,
          lineHeight: plan.title.lineSpacingMultiplier,
          color: argbCss(plan.title.color),
        }}
      >
        {plan.title.text}
      </div>
      <div
        className="wenku-cover-art__rule"
        style={
          {
            left: pct(plan.rule.segment.x0, width),
            top: pct(plan.rule.segment.y0, height),
            width: pct(plan.rule.segment.x1 - plan.rule.segment.x0, width),
            ['--wenku-art-rule-w' as string]: `${plan.rule.width.toFixed(2)}px`,
            ['--wenku-art-rule' as string]: argbCss(plan.rule.color),
          } as CSSProperties
        }
      />
      <div
        className="wenku-cover-art__author"
        style={{
          left: pct(plan.author.x, width),
          top: pct(plan.author.y - plan.author.textSize, height),
          fontSize: `${plan.author.textSize.toFixed(2)}px`,
          letterSpacing: `${plan.author.letterSpacing}em`,
          color: argbCss(plan.author.color),
          maxWidth: pct(plan.author.maxWidthPx, width),
        }}
      >
        {plan.author.text}
      </div>
      <div
        className="wenku-cover-art__tag"
        style={{
          left: pct(plan.tag.x, width),
          top: pct(plan.tag.y - plan.tag.textSize, height),
          fontSize: `${plan.tag.textSize.toFixed(2)}px`,
          letterSpacing: `${plan.tag.letterSpacing}em`,
          color: argbCss(plan.tag.color),
        }}
      >
        {plan.tag.text}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 书讯（ArchiveShelf.kt L603-714）
 * ══════════════════════════════════════════════════════════════════════════ */

function ShelfCaption(props: {
  readonly book: ArchiveShelfBook | undefined;
  readonly index: number;
  readonly count: number;
  readonly onPrevious: (() => void) | null;
  readonly onNext: (() => void) | null;
  readonly onOpen: () => void;
}): ReactElement | null {
  if (props.book === undefined) return null;
  const author = props.book.author.trim() === '' ? tr('未知作者') : props.book.author;
  const chapters = props.book.totalChapters ?? 0;
  const meta =
    chapters > 0
      ? `${author} · ${String(Math.min((props.book.currentChapterIndex ?? 0) + 1, chapters))} / ${String(chapters)}`
      : author;
  return (
    <div className="wenku-caption" data-testid="wenku-shelf-caption">
      <button
        type="button"
        className="wenku-caption__open"
        data-testid="wenku-caption-open"
        onClick={props.onOpen}
      >
        <span className="wenku-caption__grow">
          <span className="wenku-caption__title" data-testid="wenku-caption-title">
            {props.book.title}
          </span>
          <span className="wenku-caption__meta" data-testid="wenku-caption-meta">
            {meta}
          </span>
        </span>
        <WenkuIcon symbol="External" size={20} className="wenku-caption__out" />
      </button>
      {props.count > 1 ? (
        <div className="wenku-caption__steps">
          <button
            type="button"
            className="wenku-caption__step"
            aria-label={tr('上一本')}
            data-testid="wenku-caption-prev"
            disabled={props.onPrevious === null}
            onClick={() => props.onPrevious?.()}
          >
            <WenkuIcon symbol="ArrowLeft" size={17} />
          </button>
          <span className="wenku-caption__counter" data-testid="wenku-caption-counter">
            {`${String(props.index + 1).padStart(2, '0')} / ${String(props.count).padStart(2, '0')}`}
          </span>
          <button
            type="button"
            className="wenku-caption__step"
            aria-label={tr('下一本')}
            data-testid="wenku-caption-next"
            disabled={props.onNext === null}
            onClick={() => props.onNext?.()}
          >
            <WenkuIcon symbol="ArrowRight" size={17} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 中心 x（L303）：外部做飞行起点对齐时用。 */
export function wenkuShelfCentreX(metrics: ShelfMetrics): number {
  return shelfCentreX(metrics);
}

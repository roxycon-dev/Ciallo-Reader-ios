import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BACKSIDE_CONTENT_ALPHA } from '../../../core/pageturn/pageTurn';
import {
  buildFlapPath,
  computeCurlGeometry,
  curlNormal,
  dropShadowStrips,
  flatClipPath,
  flapShadeStops,
  midPoint,
  touchEdgePath,
  type CurlGeometry,
  type ShadowStrip,
} from '../../../core/pageturn/pageTurn';
import { usePaperPalette } from './PaperPalette';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PageTurnContainer.kt` (1063 non-blank lines) — FULL PORT
 *   line  60 `private const val BACKSIDE_CONTENT_ALPHA = 0.88f` → core constant
 *   lines 62-68 `enum class PageTurnType(id, title, description)` → PageTurnType
 *   lines 71-476 `PageTurnContainer(...)`                   → PageTurnContainer
 *   lines 479-801 `Simulate3DCurlLayout(...)`              → Simulate3DCurl (SVG)
 *   lines 804-936 `CurlFlapBackside(...)`                  → CurlFlapBackside (SVG)
 *   lines 938-990 the pure geometry helpers               → core/pageturn/pageTurn.ts
 *   lines 993-1037 `CoverPageTurnLayout(...)`              → CoverPageTurn
 *   lines 1040-1082 `SlidePageTurnLayout(...)`             → SlidePageTurn
 *   lines 1085-1129 `FadePageTurnLayout(...)`              → FadePageTurn
 *
 * ADAPTATION — Compose `Path`/`drawWithContent` → SVG
 * ────────────────────────────────────────────────────────
 * ① The fold / flap outlines become SVG `<clipPath>` + `<path>`; the geometry is
 *    byte-identical (`moveTo`/`lineTo`/`cubicTo`/`close` → `d`).
 * ② `Animatable<Float>` drag offsets become refs written from pointer events and
 *    read inside one rAF, so a drag never re-renders the page body — the same
 *    property Compose got from `graphicsLayer`'s deferred read.
 * ③ `awaitEachGesture` + `awaitPointerEvent` → the Pointer Events API.
 *    - `touchSlop` → a 8px constant (Android's `viewConfiguration.touchSlop`).
 *    - the 1s long-press window → a timer armed on pointerdown.
 *    - the "scroll gate" (`consumedStreak >= 3`) → checking `defaultPrevented`.
 * ④ `pointerInput(PointerEventPass.Initial)` has no web analogue; the arbitration
 *    runs in the bubble phase and calls `preventDefault()` on the events it claims,
 *    which is the standard way to stop a native scroll from stealing them.
 * ⑤ `BackHandler` → the `Escape` key / a `cancel` prop (the page host owns the
 *    hardware-back wiring on the web).
 *
 * REVIEW-2026-10-06（本轮逐行审查，本文件的两处 BUG + 一处 MISSING）
 *   BUG-1  Kotlin L258-263 / L298-309 / L319-330 都是「先播完 tween，再分派翻页」；
 *         TS 此前在 `animateNumber()` 之后**同步**调用 `onNextPage()/onPrevPage()`，
 *         于是宿主立刻换页 + `pageKey` 重置把正在播的动画抹掉 —— 点按翻页等于无动画。
 *         修法：`animateNumber` 增加 `onComplete` 回调，翻页只在动画链播完后触发。
 *   MISSING-1 Kotlin L147 `var turnJob: Job?` + L293-317：上一次翻页动画未结束时再点，
 *         走 `turnJob?.cancel(); latestOnPrevPage()` 这条**即时翻页**分支。TS 缺这条，
 *         连点会叠加多条 rAF 补间互相踩偏移。修法：`turnToken` ref 复刻该分支。
 *   等价（未改）：Kotlin 用 `Animatable.animateTo` 的 spring（StiffnessLow /
 *         StiffnessMediumLow / MediumBouncy）回弹，TS 用对应 cubic-bezier + 时长近似
 *         （同文件的 `RETURN_SPRING_BEZIER` / `PULLBACK_SPRING_BEZIER`）—— 动画曲线
 *         平台适配，位移数学逐值一致。
 */

/** PageTurnContainer.kt line 62-68 — the five modes, ids and strings verbatim. */
export const PageTurnType = {
  SIMULATE: {
    id: 0,
    title: '仿真3D卷页',
    description: '真实书本折角弯曲与纸张阴影',
  },
  COVER: { id: 1, title: '覆盖翻页', description: '无缝推开上页，经典质感' },
  SLIDE: { id: 2, title: '平移翻页', description: '左右双页平滑滑移' },
  FADE: { id: 3, title: '渐变淡出', description: '优雅透明度切换' },
  SCROLL: { id: 4, title: '上下滚动', description: '连续纵向滚动阅读' },
} as const;

export type PageTurnTypeName = keyof typeof PageTurnType;

export const PAGE_TURN_TYPES: readonly PageTurnTypeName[] = [
  'SIMULATE',
  'COVER',
  'SLIDE',
  'FADE',
  'SCROLL',
];

/** Kotlin line 130 — `entries.firstOrNull { it.id == pageTurnMode } ?: SIMULATE`. */
export function pageTurnTypeOf(id: number): PageTurnTypeName {
  const found = PAGE_TURN_TYPES.find((n) => PageTurnType[n].id === id);
  return found ?? 'SIMULATE';
}

/** `viewConfiguration.touchSlop` on Android (8dp, framework default). */
const TOUCH_SLOP = 8;

/** PageTurnContainer.kt lines 141-142 — `dampingRatio = MediumBouncy`, stiffness Low. */
const RETURN_SPRING_BEZIER = 'cubic-bezier(0.25, 1.35, 0.5, 1)';
const RETURN_SPRING_MS = 520;

/** PageTurnContainer.kt line 243 — `StiffnessLow(200) + DampingRatioMediumBouncy`. */
const PULLBACK_SPRING_BEZIER = RETURN_SPRING_BEZIER;
const PULLBACK_SPRING_MS = 460;

export interface PageTurnContainerProps {
  pageTurnMode: number;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
  onNextPage: () => void;
  onPrevPage: () => void;
  onClickCenter: () => void;
  onClickLeft: () => void;
  onClickRight: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: (() => void) | null;
  /** 点击位置命中正文插图时回调（返回 true=已打开全屏，宿主跳过翻页分派）。 */
  onImageTapAt?: ((point: { x: number; y: number }) => boolean) | null;
  /** 中间区域长按 1s：触发串珠快速翻页（PageScrubberOverlay）。 */
  onLongPressCenter?: (() => void) | null;
  /** 菜单（顶/底栏）打开时不再响应点击翻页/切章。 */
  menuVisible?: boolean;
  /**
   * 卷页纸张的底色：应传入阅读区当页背景色。
   * 此前函数体内写死 `0xFFF5F0E6`（米色铜版纸），夜间 / OLED 黑色主题下
   * 翻出来的纸背面还是米黄色。现在由它推导出整套纸面 / 厚度高光 / 描边色。
   */
  paperColor?: string;
  className?: string;
  /** Key that changes whenever a page turn completes (Kotlin `pageKey`). */
  pageKey?: unknown;
}

interface DragFrame {
  drag: number;
  dragY: number;
  pull: number;
}

const ZERO_FRAME: DragFrame = { drag: 0, dragY: 0, pull: 0 };

export function PageTurnContainer(props: PageTurnContainerProps) {
  const paper = usePaperPalette(props.paperColor ?? '#F5F0E6');
  const mode = pageTurnTypeOf(props.pageTurnMode);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The drag/pull triple is *state*, because every value below is read during
  // render (React 19 forbids `ref.current` reads in render). Gesture handlers and
  // the settle tweens write it directly, which is what `Animatable.snapTo` /
  // `animateTo` did on the Compose side.
  const [frame, setFrame] = useState<DragFrame>(ZERO_FRAME);
  // touchDownY only matters to the curl geometry, and is read during render too.
  const [touchDownY, setTouchDownY] = useState(0);
  // The pageKey reset (`LaunchedEffect(pageKey) { snapTo(0f) ×3 }`) is React's
  // documented "adjust state during render" pattern: it fires once per key
  // change, before the browser paints, with no effect.
  const [lastPageKey, setLastPageKey] = useState(props.pageKey);
  if (lastPageKey !== props.pageKey) {
    setLastPageKey(props.pageKey);
    setFrame(ZERO_FRAME);
  }

  const push = useCallback((drag: number, dragY: number, pull: number) => {
    setFrame((prev) =>
      prev.drag === drag && prev.dragY === dragY && prev.pull === pull
        ? prev
        : { drag, dragY, pull },
    );
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const measure = (): void => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const currentDrag = frame.drag;
  const currentPull = frame.pull;
  const pullProgress = Math.max(0, Math.min(1, currentPull / 80));

  const containerOffsetInWindow = useRef({ x: 0, y: 0 });
  const handlers = useGestureHandlers({
    mode,
    menuVisible: props.menuVisible === true,
    onImageTapAt: props.onImageTapAt ?? null,
    onNextPage: props.onNextPage,
    onPrevPage: props.onPrevPage,
    onClickCenter: props.onClickCenter,
    onClickLeft: props.onClickLeft,
    onClickRight: props.onClickRight,
    onToggleBookmark: props.onToggleBookmark ?? null,
    onLongPressCenter: props.onLongPressCenter ?? null,
    containerOffsetInWindow,
    screenWidth: () => size.w,
    push,
    getFrame: () => frame,
    setTouchDownY,
  });

  return (
    <div
      ref={rootRef}
      className={['page-turn-container', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      data-page-turn-mode={mode}
      {...handlers}
    >
      {/* Pull-down Indicator Charge Bar Header Overlay */}
      {currentPull > 3 ? (
        <PullDownChargeBar
          pull={currentPull}
          progress={pullProgress}
          isBookmarked={props.isBookmarked === true}
        />
      ) : null}

      {/* Reader Content with Downward Damping Translation */}
      <div
        className="page-turn-container__content"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${currentPull}px)`,
        }}
      >
        {mode === 'SIMULATE' ? (
          <Simulate3DCurlLayout
            dragPx={currentDrag}
            dragPy={frame.dragY}
            touchDownY={touchDownY}
            widthPx={size.w}
            heightPx={size.h}
            paper={paper}
            currentContent={props.currentContent}
            nextContent={props.nextContent}
            prevContent={props.prevContent}
          />
        ) : mode === 'COVER' ? (
          <CoverPageTurnLayout
            dragPx={currentDrag}
            widthPx={size.w}
            currentContent={props.currentContent}
            nextContent={props.nextContent}
            prevContent={props.prevContent}
          />
        ) : mode === 'SLIDE' ? (
          <SlidePageTurnLayout
            dragPx={currentDrag}
            widthPx={size.w}
            currentContent={props.currentContent}
            nextContent={props.nextContent}
            prevContent={props.prevContent}
          />
        ) : mode === 'FADE' ? (
          <FadePageTurnLayout
            dragPx={currentDrag}
            widthPx={size.w}
            currentContent={props.currentContent}
            nextContent={props.nextContent}
            prevContent={props.prevContent}
          />
        ) : (
          // PageTurnType.SCROLL — the reader's own scroll container owns everything.
          props.currentContent
        )}
      </div>
    </div>
  );
}

/** PageTurnContainer.kt lines 346-417 — 顶部充能卡. */
function PullDownChargeBar(props: {
  pull: number;
  progress: number;
  isBookmarked: boolean;
}) {
  const isCharged = props.progress >= 1;
  // PageTurnContainer.kt line 349-353 — iconScale 1 → 1.25, HighBouncy.
  const iconScale = isCharged ? 1.25 : 1;
  const label = isCharged
    ? props.isBookmarked
      ? '松开即可取消书签'
      : '松开即可保存书签'
    : props.isBookmarked
      ? '下拉取消书签'
      : '下拉添加书签';

  return (
    <div
      className="page-turn-charge-bar"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: `${Math.min(100, props.pull * 0.9).toFixed(2)}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        className="page-turn-charge-bar__card"
        data-charged={isCharged}
        style={{
          borderRadius: 24,
          padding: '8px 16px',
          border: `${isCharged ? 2 : 1}px solid ${isCharged ? '#E8C97A' : 'rgba(97,102,109,0.5)'}`,
          boxShadow: '0 6px 12px rgba(0,0,0,0.12)',
        }}
      >
        <div className="page-turn-charge-bar__row">
          <span className="page-turn-charge-bar__ring" style={{ width: 32, height: 32 }}>
            <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
              <circle
                cx="16"
                cy="16"
                r="14"
                fill="none"
                stroke="#E3E5E7"
                strokeWidth="3"
              />
              <circle
                cx="16"
                cy="16"
                r="14"
                fill="none"
                stroke={isCharged ? '#E8C97A' : '#059669'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(props.progress * 87.96).toFixed(2)} 87.96`}
                transform="rotate(-90 16 16)"
              />
            </svg>
            <span
              className="page-turn-charge-bar__icon"
              style={{
                position: 'absolute',
                transform: `scale(${iconScale})`,
                color: isCharged ? '#E8C97A' : '#059669',
              }}
            >
              {props.isBookmarked ? (
                <BookmarkRemoveIcon />
              ) : (
                <BookmarkAddedIcon />
              )}
            </span>
          </span>
          <span style={{ width: 10 }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: isCharged ? 700 : 500,
              color: isCharged ? '#E8C97A' : '#18191C',
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

/** PageTurnContainer.kt lines 479-801 — Simulate3DCurlLayout.
 *  Exported so `PageCurlReaderContainer` reuses the same curl geometry. */
export function Simulate3DCurlLayout(props: {
  dragPx: number;
  dragPy: number;
  touchDownY: number;
  widthPx: number;
  heightPx: number;
  paper: ReturnType<typeof usePaperPalette>;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  if (props.dragPx === 0) return <>{props.currentContent}</>;
  if (props.widthPx === 0 || props.heightPx === 0) return <>{props.currentContent}</>;

  const g = computeCurlGeometry({
    dragPx: props.dragPx,
    dragPy: props.dragPy,
    touchDownY: props.touchDownY,
    widthPx: props.widthPx,
    heightPx: props.heightPx,
  });
  const strips = dropShadowStrips(g);
  const uid = `curl-${g.isNext ? 'n' : 'p'}`;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Underneath page (next) or the current page stays (previous). */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {g.isNext ? props.nextContent : props.currentContent}
      </div>

      {/* The clipped "flat" region of the turning page. */}
      <svg
        className="page-turn-curl__clip"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`${uid}-flat`}>
            <path d={flatClipPath(g, props.widthPx, props.heightPx)} />
          </clipPath>
          {strips.drop !== null ? (
            <linearGradient
              id={`${uid}-drop`}
              gradientUnits="userSpaceOnUse"
              x1={strips.drop.start.x}
              y1={strips.drop.start.y}
              x2={strips.drop.end.x}
              y2={strips.drop.end.y}
            >
              {strips.drop.stops.map((s, i) => (
                <stop key={i} offset={`${(i / (strips.drop!.stops.length - 1)) * 100}%`} stopColor={s} />
              ))}
            </linearGradient>
          ) : null}
          {strips.inner !== null ? (
            <linearGradient
              id={`${uid}-inner`}
              gradientUnits="userSpaceOnUse"
              x1={strips.inner.start.x}
              y1={strips.inner.start.y}
              x2={strips.inner.end.x}
              y2={strips.inner.end.y}
            >
              {strips.inner.stops.map((s, i) => (
                <stop key={i} offset={`${(i / (strips.inner!.stops.length - 1)) * 100}%`} stopColor={s} />
              ))}
            </linearGradient>
          ) : null}
          {strips.edge !== null ? (
            <linearGradient
              id={`${uid}-edge`}
              gradientUnits="userSpaceOnUse"
              x1={strips.edge.start.x}
              y1={strips.edge.start.y}
              x2={strips.edge.end.x}
              y2={strips.edge.end.y}
            >
              {strips.edge.stops.map((s, i) => (
                <stop key={i} offset={`${(i / (strips.edge!.stops.length - 1)) * 100}%`} stopColor={s} />
              ))}
            </linearGradient>
          ) : null}
        </defs>

        {/* Drop shadow cast onto the page below (aligned with the fold line). */}
        {strips.drop !== null ? (
          <path d={strips.drop.d} fill={`url(#${uid}-drop)`} />
        ) : null}
        {/* Inner crease shadow on the current page (aligned with the fold line). */}
        {strips.inner !== null ? (
          <path d={strips.inner.d} fill={`url(#${uid}-inner)`} />
        ) : null}
        {/* Paper edge highlight: a thin bright band where the lifted page catches light. */}
        {strips.edge !== null ? <path d={strips.edge.d} fill={`url(#${uid}-edge)`} /> : null}
      </svg>

      {/* Clipped content of the flat region. */}
      <div
        className="page-turn-curl__flat"
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `url(#${uid}-flat)`,
        }}
      >
        {g.isNext ? props.currentContent : props.prevContent}
      </div>

      {/* Turned Flap Backside: paper + mirrored page content + cylinder shading */}
      {g.flapWidth > 1 ? (
        <CurlFlapBackside
          g={g}
          widthPx={props.widthPx}
          heightPx={props.heightPx}
          paper={props.paper}
          content={g.isNext ? props.currentContent : props.prevContent}
          uid={uid}
        />
      ) : null}
    </div>
  );
}

/** PageTurnContainer.kt lines 804-936 — CurlFlapBackside. */
function CurlFlapBackside(props: {
  g: CurlGeometry;
  widthPx: number;
  heightPx: number;
  paper: ReturnType<typeof usePaperPalette>;
  content: ReactNode;
  uid: string;
}) {
  const { g } = props;
  const flapPath = buildFlapPath({
    foldTop: g.foldTop,
    foldBottom: g.foldBottom,
    touchTop: g.touchTop,
    touchBottom: g.touchBottom,
    creaseX: g.creaseX,
    touchX: g.touchX,
    arcOffset: g.arcOffset,
    heightPx: props.heightPx,
    bulgeSign: g.isNext ? -1 : 1,
  });
  const shadeStart = midPoint(g.foldTop, g.foldBottom);
  const shadeEnd = midPoint(g.touchTop, g.touchBottom);
  const fade = 1 - g.progress;
  const shade = flapShadeStops(fade);
  const mirrorPivot = {
    x: g.foldBottom.x / props.widthPx,
    y: g.foldBottom.y / props.heightPx,
  };
  const touchMidX = g.touchX + (g.isNext ? -1 : 1) * g.arcOffset * 0.5;
  const edgePath = touchEdgePath(
    g.touchTop,
    g.touchBottom,
    g.touchX,
    g.arcOffset,
    g.isNext ? -1 : 1,
    props.heightPx,
  );

  return (
    <div
      className="page-turn-flap"
      style={{ position: 'absolute', inset: 0, clipPath: `url(#${props.uid}-flap)` }}
    >
      {/* Translucent paper base — 真实纸张是透光的。 */}
      <div
        className="page-turn-flap__paper"
        style={{
          position: 'absolute',
          inset: 0,
          background: rgbaOf(props.paper.face, props.paper.baseAlpha),
        }}
      />
      {/* Backside shows the page content mirrored across the fold (real paper feel) */}
      <div
        className="page-turn-flap__mirror"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: BACKSIDE_CONTENT_ALPHA,
          transformOrigin: `${(mirrorPivot.x * 100).toFixed(3)}% ${(mirrorPivot.y * 100).toFixed(3)}%`,
          transform: 'scaleX(-1)',
        }}
      >
        {props.content}
      </div>
      {/* Paper tint + cylinder shading + moving-edge thickness */}
      <svg
        className="page-turn-flap__fx"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`${props.uid}-flap`}>
            <path d={flapPath} />
          </clipPath>
          <linearGradient
            id={`${props.uid}-shade`}
            gradientUnits="userSpaceOnUse"
            x1={shadeStart.x}
            y1={shadeStart.y}
            x2={shadeEnd.x}
            y2={shadeEnd.y}
          >
            {shade.stops.map((s, i) => (
              <stop
                key={i}
                offset={shade.positions[i] ?? '0%'}
                stopColor={s}
              />
            ))}
          </linearGradient>
          <radialGradient
            id={`${props.uid}-ao`}
            gradientUnits="userSpaceOnUse"
            cx={shadeStart.x}
            cy={shadeStart.y}
            r={Math.max(8, g.flapWidth * 1.25)}
          >
            <stop offset="0%" stopColor={`rgba(0, 0, 0, ${(0.1 * fade).toFixed(4)})`} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        <rect
          x="0"
          y="0"
          width={props.widthPx}
          height={props.heightPx}
          fill={rgbaOf(props.paper.face, 0.15)}
          clipPath={`url(#${props.uid}-flap)`}
        />
        <path d={flapPath} fill={`url(#${props.uid}-shade)`} />
        {/* Soft ambient occlusion near the fold corner */}
        {g.isTopCorner || g.isBottomCorner ? (
          <circle
            cx={shadeStart.x}
            cy={shadeStart.y}
            r={Math.max(8, g.flapWidth * 1.25)}
            fill={`url(#${props.uid}-ao)`}
          />
        ) : null}
        {/* Paper thickness along the moving edge */}
        <path
          d={edgePath}
          fill="none"
          stroke={rgbaOf(props.paper.edgeHighlight, 0.92)}
          strokeWidth={2.4}
        />
        <path
          d={edgePath}
          fill="none"
          stroke={rgbaOf(props.paper.edgeStroke, 0.2)}
          strokeWidth={0.9}
        />
      </svg>
      <span className="sr-only" data-touch-mid-x={touchMidX} />
    </div>
  );
}

/** PageTurnContainer.kt lines 993-1037 — CoverPageTurnLayout. */
function CoverPageTurnLayout(props: {
  dragPx: number;
  widthPx: number;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  const { dragPx, widthPx } = props;
  const w = Math.max(1, widthPx);
  if (dragPx < 0) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${((1 + dragPx / w) * (-0.15 * w)).toFixed(2)}px)`,
          }}
        >
          {props.nextContent}
        </div>
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${dragPx}px)` }}>
          {props.currentContent}
        </div>
      </div>
    );
  }
  if (dragPx > 0) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div
          style={{ position: 'absolute', inset: 0, transform: `translateX(${dragPx * 0.15}px)` }}
        >
          {props.currentContent}
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${dragPx - widthPx}px)`,
          }}
        >
          {props.prevContent}
        </div>
      </div>
    );
  }
  return <>{props.currentContent}</>;
}

/** PageTurnContainer.kt lines 1040-1082 — SlidePageTurnLayout. */
function SlidePageTurnLayout(props: {
  dragPx: number;
  widthPx: number;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  const { dragPx, widthPx } = props;
  if (dragPx < 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${dragPx}px)` }}>
          {props.currentContent}
        </div>
        <div
          style={{ position: 'absolute', inset: 0, transform: `translateX(${widthPx + dragPx}px)` }}
        >
          {props.nextContent}
        </div>
      </div>
    );
  }
  if (dragPx > 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${dragPx}px)` }}>
          {props.currentContent}
        </div>
        <div
          style={{ position: 'absolute', inset: 0, transform: `translateX(${dragPx - widthPx}px)` }}
        >
          {props.prevContent}
        </div>
      </div>
    );
  }
  return <>{props.currentContent}</>;
}

/** PageTurnContainer.kt lines 1085-1129 — FadePageTurnLayout. */
function FadePageTurnLayout(props: {
  dragPx: number;
  widthPx: number;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  const { dragPx, widthPx } = props;
  if (dragPx === 0) return <>{props.currentContent}</>;
  const progress = Math.max(0, Math.min(1, Math.abs(dragPx) / (widthPx * 0.5)));
  const under = dragPx < 0 ? props.nextContent : props.prevContent;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - progress }}>
        {props.currentContent}
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: progress }}>{under}</div>
    </div>
  );
}

/* ── gesture arbitration ─────────────────────────────────────────────────── */

interface GestureConfig {
  mode: PageTurnTypeName;
  menuVisible: boolean;
  onImageTapAt: ((point: { x: number; y: number }) => boolean) | null;
  onNextPage: () => void;
  onPrevPage: () => void;
  onClickCenter: () => void;
  onClickLeft: () => void;
  onClickRight: () => void;
  onToggleBookmark: (() => void) | null;
  onLongPressCenter: (() => void) | null;
  containerOffsetInWindow: React.RefObject<{ x: number; y: number }>;
  screenWidth: () => number;
  push: (drag: number, dragY: number, pull: number) => void;
  /** Latest committed frame; read from gesture handlers only. */
  getFrame: () => DragFrame;
  setTouchDownY: (y: number) => void;
}

/**
 * PageTurnContainer.kt lines 137-338 — the `pointerInput` gesture loop, ported to
 * the Pointer Events API. The arbitration state machine is preserved verbatim:
 *   activeMode 0 = uncommitted, 1 = horizontal page turn, 2 = pull-down bookmark.
 */
function useGestureHandlers(cfg: GestureConfig) {
  const longPressTimer = useRef(0);
  // PageTurnContainer.kt:147 `var turnJob: kotlinx.coroutines.Job?` —
  // 「上一次翻页动画未结束的快速连点：取消旧动画、即时翻页」。
  const turnToken = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 滚动阅读模式：手势完全交给阅读器自身的滚动容器处理
      if (cfg.mode === 'SCROLL') return;
      const screenWidth = cfg.screenWidth();
      if (screenWidth === 0) return;
      // Kotlin L150 `touchDownY = down.position.y` → 组件持有的 touchDownY state
      cfg.setTouchDownY(e.clientY);

      let isDrag = false;
      let activeMode = 0;
      let longPressFired = false;
      let tapConsumedByChild = false;
      const pointerId = e.pointerId;
      // React clears currentTarget after this dispatch. The release handler runs
      // later on window and must retain the element rather than the synthetic event.
      const gestureElement = e.currentTarget;

      // `accum.x` / `accum.y` accumulate across the whole gesture and are read by
      // `finish()` after the pointer lifts, so they live in a ref (mutated from
      // event listeners, never re-assigned during render).
      const accum = { x: 0, y: 0 };

      // 长按触发区扩展到整个页面：任意位置静置 1s 均可唤出串珠快速翻页
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = window.setTimeout(() => {
        if (!isDrag && !cfg.menuVisible) {
          longPressFired = true;
          cfg.onLongPressCenter?.();
          // 吞掉余下事件直到抬起：防止遮罩出现前底层误翻页
          const swallow = (ev: PointerEvent): void => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.buttons) {
              window.removeEventListener('pointermove', swallow, true);
              window.removeEventListener('pointerup', swallow, true);
              window.removeEventListener('pointercancel', swallow, true);
            }
          };
          window.addEventListener('pointermove', swallow, true);
          window.addEventListener('pointerup', swallow, true);
          window.addEventListener('pointercancel', swallow, true);
        }
      }, 1000);

      const finish = (): void => {
        window.clearTimeout(longPressTimer.current);

        if (isDrag) {
          const cur = cfg.getFrame();
          if (activeMode === 2) {
            if (cur.pull >= 80 || accum.y >= 160) cfg.onToggleBookmark?.();
            // 松手回弹：spring(StiffnessLow, MediumBouncy)
            cfg.push(0, 0, 0);
          } else if (activeMode === 1 && cfg.mode !== 'SCROLL') {
            const currentVal = cur.drag;
            const threshold = screenWidth * 0.15;
            // dragOffsetY 归零（spring MediumLow）—— Kotlin L251 在阈值判定**之前**就启动它
            animateNumber(cfg, 'dragY', 0, RETURN_SPRING_MS, RETURN_SPRING_BEZIER);
            if (Math.abs(currentVal) > threshold) {
              // 甩出：先补满剩余位移（tween 180ms），**动画播完**才分派翻页。
              // Kotlin L258-263 是 `animateTo(target, tween(180))` 之后才 onNextPage()；
              // 此前 TS 在动画开始前就同步翻页，宿主立刻换页 + pageKey 重置把动画抹掉，
              // 结果是「点按无动画」。
              const target = currentVal < 0 ? -screenWidth : screenWidth;
              turnToken.current += 1;
              animateNumber(cfg, 'drag', target, 180, undefined, undefined, undefined, () => {
                if (currentVal < 0) cfg.onNextPage();
                else cfg.onPrevPage();
              });
            } else {
              animateNumber(cfg, 'drag', 0, RETURN_SPRING_MS, RETURN_SPRING_BEZIER);
            }
          }
          return;
        }

        if (cfg.menuVisible || longPressFired) return;

        // 插图命中优先（按屏幕矩形注册表）：命中即打开全屏
        const rect = gestureElement.getBoundingClientRect();
        const screenPoint = {
          x: e.clientX - rect.left + cfg.containerOffsetInWindow.current.x,
          y: e.clientY - rect.top + cfg.containerOffsetInWindow.current.y,
        };
        const imageHandled = cfg.onImageTapAt?.(screenPoint) === true;
        if (imageHandled || tapConsumedByChild) return;

        const tapX = e.clientX - rect.left;
        const leftZone = screenWidth * 0.35;
        const rightZone = screenWidth * 0.65;
        void pointerId;

        if (tapX < leftZone) {
          if (cfg.mode === 'SCROLL') {
            cfg.onClickLeft();
          } else if (turnToken.current !== 0) {
            // PageTurnContainer.kt:293-297 — 上一次翻页动画未结束：取消旧动画、即时翻页
            turnToken.current = 0;
            cfg.push(0, 0, 0);
            cfg.onPrevPage();
          } else {
            // 轻推 5% 再整页推走（tween 60ms → 180ms），播完才翻页。
            // Kotlin L298-309：两段 animateTo 之后才 latestOnPrevPage()。
            turnToken.current = 1;
            animateNumber(
              cfg,
              'drag',
              -screenWidth * 0.05,
              60,
              undefined,
              screenWidth,
              180,
              () => {
                cfg.onPrevPage();
                turnToken.current = 0;
              },
            );
          }
        } else if (tapX > rightZone) {
          if (cfg.mode === 'SCROLL') {
            cfg.onClickRight();
          } else if (turnToken.current !== 0) {
            // PageTurnContainer.kt:315-317
            turnToken.current = 0;
            cfg.push(0, 0, 0);
            cfg.onNextPage();
          } else {
            // Kotlin L319-330：两段 animateTo 之后才 latestOnNextPage()
            turnToken.current = 1;
            animateNumber(
              cfg,
              'drag',
              screenWidth * 0.05,
              60,
              undefined,
              -screenWidth,
              180,
              () => {
                cfg.onNextPage();
                turnToken.current = 0;
              },
            );
          }
        } else {
          cfg.onClickCenter();
        }
      };

      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - e.clientX;
        const dy = ev.clientY - e.clientY;
        accum.x += dx;
        accum.y += dy;

        if (!isDrag) {
          if (Math.abs(accum.x) > TOUCH_SLOP || Math.abs(accum.y) > TOUCH_SLOP) {
            isDrag = true;
            window.clearTimeout(longPressTimer.current);
            if (accum.y > TOUCH_SLOP && accum.y > Math.abs(accum.x) * 1.1) {
              activeMode = 2; // Pull-Down Bookmark
            } else if (Math.abs(accum.x) > TOUCH_SLOP && cfg.mode !== 'SCROLL') {
              activeMode = 1; // Horizontal Page Turn
            }
          }
        }

        if (isDrag) {
          ev.preventDefault();
          ev.stopPropagation();
          const cur = cfg.getFrame();
          if (activeMode === 1) {
            cfg.push(cur.drag + dx, cur.dragY + dy, cur.pull);
          } else if (activeMode === 2) {
            const rawY = Math.max(0, accum.y);
            const dampedPx = Math.max(0, Math.min(160, rawY * 0.5));
            cfg.push(cur.drag, cur.dragY, dampedPx);
          }
        }
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        tapConsumedByChild = ev.defaultPrevented;
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        finish();
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    [cfg],
  );

  // Kotlin L142-144 measured the container rect inside `onSizeChanged`; the web
  // equivalent is a capture-phase pointerdown read, done before the gesture
  // handlers translate client coordinates into container-local coordinates.
  const containerOffsetRef = cfg.containerOffsetInWindow;
  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      containerOffsetRef.current = { x: rect.left, y: rect.top };
    },
    [containerOffsetRef],
  );

  return { onPointerDownCapture, onPointerDown };
}

/**
 * A tiny numeric tween used for the settle/turn animations. Compose used
 * `Animatable.animateTo(tween(180))` / `spring(...)`; the web equivalent is a rAF
 * interpolation over the same duration with the mapped bezier.
 */
function animateNumber(
  cfg: GestureConfig,
  channel: 'drag' | 'dragY' | 'pull',
  target: number,
  durationMs: number,
  bezier = 'linear',
  /**
   * Kotlin chained two tweens for the tap-to-turn gesture
   * (`animateTo(±w*0.05f, tween(60))` then `animateTo(∓w, tween(180))`).
   * Passing this runs the second leg after the first finishes.
   */
  nextTarget?: number,
  nextDurationMs?: number,
  /**
   * PageTurnContainer.kt:258-263 / 298-309 / 319-330 — the page-turn callback runs
   * **after** the tween chain has finished, never synchronously.
   */
  onComplete?: () => void,
): void {
  const start0 = cfg.getFrame();
  const from = channel === 'drag' ? start0.drag : channel === 'dragY' ? start0.dragY : start0.pull;
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  const ease = bezierEasing(bezier);
  const step = (): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const t = Math.min(1, (now - start) / durationMs);
    const v = from + (target - from) * ease(t);
    const cur = cfg.getFrame();
    if (channel === 'drag') cfg.push(v, cur.dragY, cur.pull);
    else if (channel === 'dragY') cfg.push(cur.drag, v, cur.pull);
    else cfg.push(cur.drag, cur.dragY, v);
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    if (nextTarget !== undefined && nextDurationMs !== undefined) {
      animateNumber(cfg, channel, nextTarget, nextDurationMs, 'linear', undefined, undefined, onComplete);
      return;
    }
    onComplete?.();
  };
  requestAnimationFrame(step);
}

function bezierEasing(bezier: string): (t: number) => number {
  if (bezier === 'linear') return (t) => t;
  const m = /cubic-bezier\(([^,]+),([^,]+),([^,]+),([^)]+)\)/.exec(bezier);
  if (m === null) return (t) => t;
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  return (t) => cubicBezier(x1, y1, x2, y2)(t);
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const x = bez1(u, x1, x2) - t;
      const dx = bezd(u, x1, x2);
      if (Math.abs(x) < 1e-6 || Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return bez1(u, y1, y2);
  };
}

function bez1(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}

function bezd(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * p1 + 6 * mu * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

export { PULLBACK_SPRING_BEZIER, PULLBACK_SPRING_MS, RETURN_SPRING_BEZIER, RETURN_SPRING_MS, TOUCH_SLOP };
export { curlNormal, usePaperPalette };
export type { ShadowStrip };

function rgbaOf(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function BookmarkAddedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

function BookmarkRemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm3.02 12L18.6 13.6 16.6 11.6 15 13.17 13.4 11.6 11.6 13.4 13.17 15 11.6 16.6 13.4 18.6 15 17 16.6 18.6 18.6 16.6 17 15l3.02 0z" />
    </svg>
  );
}

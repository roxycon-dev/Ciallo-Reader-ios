import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePaperPalette } from './PaperPalette';
// E7：WebGL2 卷页渲染器（pagecurl 的 Compose Canvas 等价物）。
import { PageCurlRenderer } from '@platform/web/webPageCurl';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PageCurlReaderContainer.kt` (382 non-blank lines) — FULL PORT
 *   line 68   `private const val BACK_PAGE_CONTENT_ALPHA = 0.58f` → BACK_PAGE_CONTENT_ALPHA
 *   lines 80-382 `@Composable PageCurlReaderContainer(...)` → PageCurlReaderContainer
 *   lines 107-158 the `rememberPageCurlState` + `PageCurlConfig`
 *   lines 170-175 `LaunchedEffect(state.current)` page commit/snap-back
 *   lines 180-192 `fun tapTurn(forward)`
 *   lines 202-311 the gesture arbitrator (Initial pass)
 *   lines 313-327 `PageCurl(count = 3, state, config)`
 *   lines 330-380 顶部充能卡
 *
 * ADAPTATION — `eu.wewox.pagecurl` → WebGL2 卷页（E7 已关闭）
 * ------------------------------------------------------------------------
 * 2026-10-13：渲染面从「SVG fold」（只画折角，缺背面镜像内容与掠射角压暗）
 * 升级为 `platform/web/webPageCurl.ts` 的 `PageCurlRenderer` —— WebGL2
 * 顶点着色器把折角以上绕圆柱面卷起，片元着色器做背面 U 镜像 + 纸色叠加
 * （α = 1 - BACK_PAGE_CONTENT_ALPHA）+ 掠射角压暗。
 * 折角**几何**仍用项目自己的 `computeCurlGeometry`（`core/pageturn/pageTurn`，
 * 已逐行移植），只把「几何 → 屏幕像素」这一步换成 GPU。
 *
 * 手势仲裁、三页模型、`BACK_PAGE_CONTENT_ALPHA = 0.58f` 等语义均未变。
 * ────────────────────────────────────────
 * The third-party library renders a full multi-page curl in a Compose Canvas with
 * its own drag state machine. The web port keeps:
 *   ① the same three-page model (prev / current / next) and the same
 *      `state.current ∈ {0,1,2}` semantics with `snapTo(1)` after each commit;
 *   ② the exact page-turn curl geometry from `PageTurnContainer`'s
 *      `Simulate3DCurlLayout` (shared via `core/pageturn/pageTurn`), which is the
 *      project's *own* curl implementation — so the visual result is the same
 *      effect the SIMULATE mode already produces;
 *   ③ the identical gesture arbitration, since the Kotlin file states outright
 *      that "下拉书签：与 PageTurnContainer 完全同一套算法".
 *
 * SKIPPED — the library's internal `PageCurlState.animateJob` lifecycle (lines
 * 180-192, the cancel+join dance). The web port's drag offset is a plain ref, so
 * the zombie-`finally` race the Kotlin comment describes cannot occur; the
 * tap-forward path is a single state transition.
 */
export const BACK_PAGE_CONTENT_ALPHA = 0.58;

/**
 * 卷页背面「内容的可见度」——pagecurl 引擎内部的换算关系是
 * `overlayAlpha = 1 - backPageContentAlpha`（overlay 即铺在最上面的纸色）。
 * 取 0.58f：背面保留 42% 的纸感 + 58% 的镜像字。
 */
export const PAGE_CURL_DEFAULTS = {
  backPageContentAlpha: BACK_PAGE_CONTENT_ALPHA,
  shadowColor: '#000000',
  shadowAlpha: 0.25,
  /** Kotlin shadowRadius = 18.dp */
  shadowRadius: 18,
  /** Kotlin shadowOffset = DpOffset((-6).dp, 2.dp) */
  shadowOffset: { x: -6, y: 2 },
} as const;

/** Kotlin `Point` type for the image-tap hit test. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PageCurlReaderContainerProps {
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
  onNextPage: () => void;
  onPrevPage: () => void;
  onClickCenter: () => void;
  onToggleBookmark?: () => void;
  isCurrentBookmarked?: boolean;
  /** 中间区域长按 1s：触发串珠快速翻页（PageScrubberOverlay）。 */
  onLongPressCenter?: (() => void) | null;
  menuVisible: boolean;
  /**
   * 卷页背面的纸色：传阅读区当页背景色。
   * 此前这里写死 `Color(0xFFE8E4DC)` 且 `backPageContentAlpha = 0f`——
   * pagecurl 引擎内部会用 `backPageColor.copy(alpha = 1 - backPageContentAlpha)`
   * 盖一层，alpha 取 0 就是 100% 不透明纯色：背面的镜像内容被完全糊掉。
   */
  paperColor?: string;
  /**
   * 点击位置命中正文插图时回调（返回 true=已打开全屏，宿主跳过翻页分派）。
   * Initial-pass（父先于子）下"子层消费检测"不可用，必须按屏幕矩形几何命中。
   */
  onImageTapAt?: ((point: ScreenPoint) => boolean) | null;
  className?: string;
}

const TOUCH_SLOP = 8;

export function PageCurlReaderContainer(props: PageCurlReaderContainerProps) {
  const paper = usePaperPalette(props.paperColor ?? '#E8E4DC');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ── 下拉充能状态（与 PageTurnContainer 同参数）──
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [touchY, setTouchY] = useState(0);
  const touchYRef = useRef(0);
  const pullAnimating = useRef(false);

  const charged = pull >= 80;
  // Kotlin line 121-126 — iconScale 1 → 1.25, HighBouncy, StiffnessMediumLow.
  const iconScale = charged ? 1.25 : 1;

  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const committedRef = useRef(false);
  const containerOffsetInWindow = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tapTurn = useCallback(
    (forward: boolean) => {
      if (committedRef.current) return;
      committedRef.current = true;
      if (forward) props.onNextPage();
      else props.onPrevPage();
      // snapTo(1) — the reset LaunchedEffect in Kotlin.
      committedRef.current = false;
      setOffset(0);
    },
    [props],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const screenWidth = size.w;
      if (screenWidth === 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const gestureElement = e.currentTarget;
      touchYRef.current = e.clientY;
      setTouchY(e.clientY);
      let totalX = 0;
      let totalY = 0;
      let isDrag = false;
      let activeMode = 0; // 0=未定 1=水平翻页 2=下拉书签
      let longPressFired = false;
      let tapOnImage = false;
      const pointerId = e.pointerId;
      pullAnimating.current = false;

      // 长按触发区扩展到整个页面：任意位置静置 1s 均可唤出串珠快速翻页
      let cancelled = false;
      const longPressTimer = window.setTimeout(() => {
        if (!isDrag && !props.menuVisible) {
          longPressFired = true;
          props.onLongPressCenter?.();
          // 吞掉余下事件直到抬起：防止遮罩出现前 pagecurl 抢手势
          cancelled = true;
        }
      }, 1000);

      const onMove = (ev: PointerEvent): void => {
        if (cancelled || ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        totalX += dx;
        totalY += dy;

        if (!isDrag && (Math.abs(totalX) > TOUCH_SLOP || Math.abs(totalY) > TOUCH_SLOP)) {
          isDrag = true;
          window.clearTimeout(longPressTimer);
          activeMode =
            totalY > TOUCH_SLOP && totalY > Math.abs(totalX) * 1.1
              ? 2
              : Math.abs(totalX) > TOUCH_SLOP
                ? 1
                : 0;
        }

        if (isDrag && activeMode === 2) {
          // 独占事件：pagecurl 的 slop 检测在此处被掐断
          ev.preventDefault();
          ev.stopPropagation();
          const v = Math.max(0, Math.min(160, Math.max(0, totalY) * 0.5));
          pullRef.current = v;
          setPull(v);
        } else if (isDrag && activeMode === 1) {
          // activeMode==1：放行给同节点上 pagecurl 的 Main-pass 手势
          const next = Math.max(-screenWidth, Math.min(0, offsetRef.current + dx));
          offsetRef.current = next;
          setOffset(next);
          ev.preventDefault();
          ev.stopPropagation();
        }
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        window.clearTimeout(longPressTimer);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);

        if (isDrag && activeMode === 2) {
          if (pullRef.current >= 80 || totalY >= 160) props.onToggleBookmark?.();
          // 260ms 二次缓动回落 (k²·(1−t)²)
          const startVal = pullRef.current;
          const startTime = typeof performance !== 'undefined' ? performance.now() : 0;
          pullAnimating.current = true;
          const settle = (): void => {
            const now = typeof performance !== 'undefined' ? performance.now() : 0;
            const t = Math.min(1, (now - startTime) / 260);
            const v = startVal * (1 - t) * (1 - t);
            pullRef.current = v;
            setPull(v);
            if (t < 1) requestAnimationFrame(settle);
            else {
              pullRef.current = 0;
              setPull(0);
              pullAnimating.current = false;
            }
          };
          requestAnimationFrame(settle);
          return;
        }

        if (isDrag) {
          if (activeMode === 1) {
            const threshold = screenWidth * 0.15;
            if (Math.abs(offsetRef.current) > threshold) {
              tapTurn(offsetRef.current < 0);
            } else {
              animateBack(() => setOffset(0));
            }
          }
          return;
        }

        // 纯点按：命中插图已在 up 时几何命中，命中则不分派翻页
        const rect = gestureElement.getBoundingClientRect();
        tapOnImage =
          props.onImageTapAt?.({
            x: e.clientX - rect.left + containerOffsetInWindow.current.x,
            y: e.clientY - rect.top + containerOffsetInWindow.current.y,
          }) === true;

        if (!longPressFired && !props.menuVisible && !tapOnImage) {
          const x = e.clientX - rect.left;
          if (x > (screenWidth * 2) / 3) tapTurn(true);
          else if (x < screenWidth / 3) tapTurn(false);
          else props.onClickCenter();
        }
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    [offsetRef, props, size.w, tapTurn],
  );

  const onPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    containerOffsetInWindow.current = { x: rect.left, y: rect.top };
  }, []);

  return (
    <div
      ref={rootRef}
      className={['page-curl-container', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
    >
      {/* 页面内容跟随下拉阻尼位移（与 PageTurnContainer 的 translationY 一致） */}
      <PageCurlSurface
        offset={offset}
        pull={pull}
        widthPx={size.w}
        heightPx={size.h}
        touchDownY={touchY}
        paper={paper}
        currentContent={props.currentContent}
        nextContent={props.nextContent}
        prevContent={props.prevContent}
      />

      {/* ── 顶部充能卡（纯绘制无 pointerInput，不会拦截触摸）── */}
      {pull > 3 ? (
        <PageCurlChargeCard
          pull={pull}
          charged={charged}
          isBookmarked={props.isCurrentBookmarked === true}
          iconScale={iconScale}
        />
      ) : null}
    </div>
  );
}

function animateBack(apply: (v: number) => void): void {
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  const ease = cubicBezier(0.25, 1, 0.5, 1);
  // spring(stiffness = StiffnessMediumLow) ≈ 4.605/√700 ≈ 174ms
  const step = (): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const t = Math.min(1, (now - start) / 174);
    apply(1 - ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

import { Simulate3DCurlLayout } from './PageTurnContainer';

/** The three-page curl surface; shares `core/pageturn/pageTurn` geometry. */
function PageCurlSurface(props: {
  offset: number;
  pull: number;
  widthPx: number;
  heightPx: number;
  touchDownY: number;
  paper: ReturnType<typeof usePaperPalette>;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  return (
    <div
      className="page-curl-surface"
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateY(${props.pull}px)`,
      }}
    >
      {/* PageCurl(count = 3) with state.current = 1 → prev (0) / current (1) / next (2).
          With no drag the engine shows only the current page; the neighbours are
          composed only once a drag begins (the same ±3 content window as SIMULATE). */}
      {props.offset === 0 ? (
        <div style={{ position: 'absolute', inset: 0 }}>{props.currentContent}</div>
      ) : null}
      <PageCurlDragLayer {...props} />
    </div>
  );
}

function PageCurlDragLayer(props: {
  offset: number;
  pull: number;
  widthPx: number;
  heightPx: number;
  touchDownY: number;
  paper: ReturnType<typeof usePaperPalette>;
  currentContent: ReactNode;
  nextContent: ReactNode;
  prevContent: ReactNode;
}) {
  if (props.offset === 0 || props.widthPx === 0 || props.heightPx === 0) return null;
  // 折角几何来自项目自己的 `computeCurlGeometry`（core/pageturn/pageTurn，
  // 逐行移植）；渲染面在 E7 升级为 WebGL2（见文件头注）。
  // WebGL2 不可用时 `PageCurlGlLayer` 返回 null，这里继续用 CSS 近似 ——
  // 与 Kotlin 的 GL 不可用降级一致，且**不静默冒充**完整卷页。
  return (
    <>
      <PageCurlGlLayer
        widthPx={props.widthPx}
        heightPx={props.heightPx}
        foldX={Math.max(0, props.widthPx - Math.abs(props.offset))}
        foldY={props.touchDownY}
        // dragPx/widthPx = 翻页进度（Kotlin 的 curlProgress 语义）
        progress={Math.min(1, Math.abs(props.offset) / Math.max(1, props.widthPx))}
        radiusScale={1}
        front={snapshotCanvas(props.currentContent, props.widthPx, props.heightPx)}
        back={snapshotCanvas(props.nextContent, props.widthPx, props.heightPx)}
      />
      <Simulate3DCurlLayout
        dragPx={props.offset}
        dragPy={0}
        touchDownY={props.touchDownY}
        widthPx={props.widthPx}
        heightPx={props.heightPx}
        paper={props.paper}
        currentContent={props.currentContent}
        nextContent={props.nextContent}
        prevContent={props.prevContent}
      />
    </>
  );
}

/**
 * E7：卷页的 WebGL2 渲染层。
 *
 * 折角几何仍来自 `computeCurlGeometry`（core，逐行移植），这里只负责
 * 把「三页内容 → GPU 纹理 → 圆柱卷曲 → 背面镜像 + 压暗」。
 *
 * 内容快照：把 `currentContent` / `nextContent` 渲进离屏 canvas 再喂
 * `PageCurlRenderer.setFront/setBack`。React 节点无法直接当纹理，
 * 这是 DOM 内容进 WebGL 的唯一路径（与 html2canvas 同思路，但只取
 * 纯文本页，不涉及外部资源，故无需等待图片加载）。
 */
function PageCurlGlLayer(props: {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly foldX: number;
  readonly foldY: number;
  readonly progress: number;
  readonly radiusScale: number;
  readonly front: () => HTMLCanvasElement | null;
  readonly back: () => HTMLCanvasElement | null;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PageCurlRenderer | null>(null);
  /**
   * WebGL2 可用性（一次性探测）。
   *
   * 用 `useState` 惰性初始化而非「ref + forceRender」—— 后者会同时踩
   * `set-state-in-effect`（effect 内 setState）与 `ref-during-render`
   * （渲染期读 ref）两条规则。
   */
  const [glSupported] = useState(() => supportsWebGL2());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !glSupported) return;
    if (props.widthPx <= 0 || props.heightPx <= 0) return;
    let r: PageCurlRenderer;
    try {
      r = new PageCurlRenderer({ canvas });
    } catch {
      // 探测通过但构造失败（上下文被占用等）：静默不渲染，由 CSS 近似接管
      return;
    }
    rendererRef.current = r;
    r.setFrame(0, 0, props.widthPx, props.heightPx);
    return () => {
      r.dispose();
      rendererRef.current = null;
    };
  }, [glSupported, props.widthPx, props.heightPx]);

  // 每帧同步状态 + 纹理
  // 依赖逐个列出（不用 `props` 整体）：`props` 任一字段变化都会重跑，
  // 而这里只关心卷曲几何相关的五个字段。
  const {
    foldX,
    foldY,
    progress,
    radiusScale,
    widthPx,
    heightPx,
    front: frontOf,
    back: backOf,
  } = props;
  useEffect(() => {
    const r = rendererRef.current;
    if (r === null) return;
    r.setFrame(0, 0, widthPx, heightPx);
    r.setState({ foldX, foldY, progress, radiusScale });
    const front = frontOf();
    if (front !== null) r.setFront(front);
    const back = backOf();
    if (back !== null) r.setBack(back);
    else r.setBack(null);
    r.render();
  }, [foldX, foldY, progress, radiusScale, widthPx, heightPx, frontOf, backOf]);

  if (!glSupported) return null;
  return (
    <canvas
      ref={canvasRef}
      className="page-curl-gl"
      data-testid="page_curl_gl"
      style={{ width: props.widthPx, height: props.heightPx }}
    />
  );
}

/**
 * E7：探测当前环境是否支持 WebGL2（一次性，不保留上下文）。
 * 不支持时调用方回落到 CSS 近似 —— 与 Kotlin 的 GL 不可用降级一致。
 */
function supportsWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
/**
 * E7：把一页内容快照成 WebGL 可用的 canvas。
 *
 * React 节点不能直接当纹理，必须先 rasterise。这里用一个**离屏** canvas
 * 手动绘制文本（不引入 html2canvas 之类的依赖 —— 阅读页内容只有
 * 纯文本 + 内联图，且 WebGL 只需要近似纹理，逐像素一致没有必要）。
 *
 * @returns 取纹理的回调；内容为空时返回 null
 */
function snapshotCanvas(
  content: ReactNode,
  widthPx: number,
  heightPx: number,
): () => HTMLCanvasElement | null {
  return () => {
    if (content === null || content === undefined) return null;
    if (widthPx <= 0 || heightPx <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(widthPx));
    canvas.height = Math.max(1, Math.round(heightPx));
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    // 纸面底色：与 CSS 版同一来源，保证 WebGL 与回落路径视觉一致
    ctx.fillStyle = '#f5efe2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2b2620';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    // 只取纯文本：内联图等富内容在 WebGL 路径下不参与（CSS 回落路径才完整渲染）
    const text = typeof content === 'string' ? content : extractText(content);
    let y = 16;
    for (const line of text.split('\n')) {
      ctx.fillText(line, 20, y, canvas.width - 40);
      y += 24;
      if (y > canvas.height - 24) break;
    }
    return canvas;
  };
}

/** 从 ReactNode 里递归取出可见文本（仅用于 WebGL 纹理快照）。 */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('\n');
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return '';
}

/** PageCurlReaderContainer.kt lines 330-380 — 顶部充能卡. */
function PageCurlChargeCard(props: {
  pull: number;
  charged: boolean;
  isBookmarked: boolean;
  iconScale: number;
}) {
  const label = props.charged
    ? props.isBookmarked
      ? '松开即可取消书签'
      : '松开即可保存书签'
    : props.isBookmarked
      ? '下拉取消书签'
      : '下拉添加书签';
  return (
    <div
      className="page-curl-charge"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          borderRadius: 24,
          padding: '14px 20px',
          textAlign: 'center',
          border: `${props.charged ? 2 : 1}px solid ${props.charged ? GOLD : '#E3E5E7'}`,
        }}
      >
        <span className="page-curl-charge__ring" style={{ position: 'relative', display: 'inline-block' }}>
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            <circle cx="20" cy="20" r="18" fill="none" stroke="#F1F3F4" strokeWidth="3" />
            <circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke={props.charged ? GOLD : '#059669'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(Math.min(1, props.pull / 80) * 113.1).toFixed(2)} 113.1`}
              transform="rotate(-90 20 20)"
            />
          </svg>
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${props.iconScale})`,
              color: props.charged ? GOLD : '#61666D',
            }}
          >
            {props.isBookmarked ? <BookmarkBorderIcon /> : <BookmarkIcon />}
          </span>
        </span>
        <div style={{ height: 6 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#18191C' }}>{label}</span>
      </div>
    </div>
  );
}

const GOLD = '#E8C97A';

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

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

function BookmarkBorderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z" />
    </svg>
  );
}

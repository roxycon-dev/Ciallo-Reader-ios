import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ENTER_SPRING,
  SETTLE_STIFFNESS,
  rubberBandOffset,
  scrubberGeometry,
  scrubberPageTransform,
  scrubberRenderOrder,
  settleDamping,
  settleTarget,
} from '../../../core/pageturn/pageScrubber';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PageScrubber.kt` (494 non-blank lines) — FULL PORT
 *   lines 86-113  `private class PaperFlipPlayer(context)` — SoundPool page-flip SFX
 *                  → `PageFlipPlayer` (Web Audio; see ADAPTATION)
 *   lines 141-560 `@Composable PageScrubberOverlay(...)` → PageScrubberOverlay
 *   lines 166-195 the geometry (pageScale / slotAngle / kR / stride / offsetFor)
 *                  → scrubberGeometry (core)
 *   lines 198-202 `centerIdx` derivedStateOf     → centerIndexOf (core)
 *   lines 206-240 `cancelScrubInternal()` / `commit(target)` → the two callbacks
 *   lines 245-261 the enter + per-page-crossing haptic/sound effects
 *   lines 269-288 `suspend fun settle(velocity)` → settleTarget (core)
 *   lines 313-357 tap-cancel + drag with rubber band + edge pulse
 *   lines 377-385 `renderOrder`                 → scrubberRenderOrder (core)
 *   lines 399-484 the per-page 3D rigid body + content window ±3
 *   lines 487-539 顶部页码胶囊 (AnimatedContent + gold progress bar)
 *   lines 542-558 底部取消胶囊按钮
 *
 * ADAPTATIONS
 * - `SoundPool` + `res/raw/page_flip.ogg` → `new Audio(url)` with a preload hint.
 *   The Kotlin `SoundPool` allowed 2 overlapping streams for fast page sweeps; the
 *   web `Audio` element is a single stream, so `play()` is reset per trigger
 *   (`currentTime = 0`) which reproduces the "重新起播" feel.
 * - `LocalHapticFeedback.performHapticFeedback(TextHandleMove/LongPress)` → the
 *   injected `onHaptic` callback (the project owns the Capacitor bridge).
 * - `BackHandler { … }` → a `cancel` prop plus an `Escape` key listener.
 * - `Modifier.graphicsLayer { rotationY = -phi; translationX = …; scaleX/Y = …;
 *   cameraDistance = camR; transformOrigin = Center }` → a CSS `transform` with
 *   `perspective()` and `transform-origin: 50% 50%`, which is the *same* projection
 *   Compose used (`GraphicsLayerScope` cameraDistance is a CSS perspective value).
 */

export interface PageScrubberOverlayProps {
  pageCount: number;
  initialPage: number;
  /** Renders page `i`; only pages within ±3 of the centre are composed. */
  pageContent: (index: number) => ReactNode;
  onDismiss: () => void;
  onPageSelected: (index: number) => void;
  /** Optional page-flip sound; Kotlin loaded `R.raw.page_flip`. */
  pageFlipSoundUrl?: string;
  /** Optional haptic pulse (Kotlin `LocalHapticFeedback`). */
  onHaptic?: (kind: 'tick' | 'long') => void;
  /** Gold = MintGold (0xFFE8C97A). */
  className?: string;
}

/** PageScrubber.kt lines 86-113 — the real page-flip sound player. */
export class PageFlipPlayer {
  private audio: HTMLAudioElement | null = null;

  constructor(url?: string) {
    if (url === undefined || typeof Audio === 'undefined') return;
    const a = new Audio(url);
    a.preload = 'auto';
    // SoundPool: volume 0.8f, rate 1, stream 1
    a.volume = 0.8;
    a.playbackRate = 1;
    this.audio = a;
  }

  play(): void {
    if (this.audio === null) return;
    // Single stream: restart so rapid sweeps re-trigger like SoundPool did.
    this.audio.currentTime = 0;
    void this.audio.play().catch(() => {
      // Autoplay policy or a decode failure — the visual feedback stands alone.
    });
  }

  release(): void {
    if (this.audio === null) return;
    this.audio.pause();
    this.audio.src = '';
    this.audio = null;
  }
}

export function PageScrubberOverlay(props: PageScrubberOverlayProps) {
  if (props.pageCount < 1) return null;
  return <PageScrubberInner {...props} />;
}

function PageScrubberInner(props: PageScrubberOverlayProps) {
  const { pageCount, initialPage, pageContent, onDismiss, onPageSelected } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const geo = scrubberGeometry(size.w, size.h, pageCount, initialPage);

  const offsetRef = useRef(geo.initialOffset);
  const enterRef = useRef(0);
  // committed is state (not a ref) because it is read during render
  // (renderOrder / specialPage / isCentered) — React 19 forbids ref reads in render.
  const [committed, setCommitted] = useState<number | null>(null);
  const committedRef = useRef<number | null>(null);
  const edgePulsedRef = useRef(false);
  const velocityRef = useRef({ x: 0, t: 0 });
  const lastMoveRef = useRef(0);
  const specialPage = committed ?? initialPage;

  // Two signals, one rAF writer → React state (identical to the Compose
  // `Animatable` + `derivedStateOf` pair, without a state write per frame).
  const [anim, setAnim] = useState({ offset: geo.initialOffset, enter: 0 });
  const pendingRef = useRef({ offset: geo.initialOffset, enter: 0 });

  const playerRef = useRef<PageFlipPlayer | null>(null);
  useEffect(() => {
    const p = new PageFlipPlayer(props.pageFlipSoundUrl);
    playerRef.current = p;
    return () => p.release();
  }, [props.pageFlipSoundUrl]);

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

  // Single rAF pump: advances `enter`, drains any queued offset, publishes state.
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      if (enterRef.current < 1) {
        // 进场：spring(dampingRatio = 0.75f, stiffness = 380f)
        enterRef.current = Math.min(1, enterRef.current + 1 / 30);
      }
      const next = { offset: pendingRef.current.offset, enter: enterRef.current };
      if (next.offset !== anim.offset || next.enter !== anim.enter) {
        pendingRef.current.offset = next.offset;
        setAnim(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `anim` is read inside the loop only to diff
  }, []);

  const centerIdx = Math.max(
    0,
    Math.min(pageCount - 1, Math.round(-anim.offset / geo.stride)),
  );

  // 进场：翻纸声 + 振动；弹簧轻微过冲 = 环"扇形弹开"的手感
  useEffect(() => {
    props.onHaptic?.('tick');
    playerRef.current?.play();
  }, [props]);

  // 每掠过一页：振动 + 翻纸声（串珠手感）
  const lastCenter = useRef(centerIdx);
  useEffect(() => {
    if (centerIdx === lastCenter.current) return;
    lastCenter.current = centerIdx;
    props.onHaptic?.('tick');
    playerRef.current?.play();
  }, [centerIdx, props]);

  const animateTo = useCallback((target: number, durationMs: number, bezier: string) => {
    const from = pendingRef.current.offset;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    const ease = bezierEasing(bezier);
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / durationMs);
      pendingRef.current.offset = from + (target - from) * ease(t);
      offsetRef.current = pendingRef.current.offset;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const cancelScrubInternal = useCallback(() => {
    if (committedRef.current !== null) return;
    committedRef.current = initialPage;
    setCommitted(initialPage);
    props.onHaptic?.('tick');
    playerRef.current?.play();
    // 环转回原页 与 收拢放大回满屏 重叠进行，收束更顺滑
    animateTo(geo.initialOffset, 220, 'cubic-bezier(0.4, 0, 0.2, 1)');
    window.setTimeout(() => {
      enterRef.current = 0;
      onDismiss();
    }, 90);
  }, [animateTo, geo.initialOffset, initialPage, onDismiss, props]);

  const commit = useCallback(
    (target: number) => {
      if (committedRef.current !== null) return;
      const t = Math.max(0, Math.min(pageCount - 1, target));
      committedRef.current = t;
      setCommitted(t);
      props.onHaptic?.('long');
      playerRef.current?.play();
      // 环转正目标页；120ms 后其余页快速退场、目标页放大冲向满屏
      animateTo(-t * geo.stride, 260, 'cubic-bezier(0.4, 0, 0.2, 1)');
      window.setTimeout(() => {
        enterRef.current = 0;
        onPageSelected(t);
        onDismiss();
      }, 120);
    },
    [animateTo, geo.stride, onDismiss, onPageSelected, pageCount, props],
  );

  // Escape mirrors `BackHandler { cancelScrubInternal() }`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelScrubInternal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelScrubInternal]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      velocityRef.current = { x: 0, t: typeof performance !== 'undefined' ? performance.now() : 0 };
      lastMoveRef.current = 0;
      edgePulsedRef.current = false;
      pendingRef.current.offset = anim.offset;
      offsetRef.current = anim.offset;
    },
    [anim.offset],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (committedRef.current !== null) return;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const dt = Math.max(1, now - velocityRef.current.t);
      const dx = e.movementX;
      velocityRef.current = {
        x: velocityRef.current.x * 0.6 + (dx / dt) * 1000 * 0.4,
        t: now,
      };
      lastMoveRef.current = now;

      const raw = pendingRef.current.offset + dx;
      const target = rubberBandOffset(raw, geo.maxOff, geo.minOff);
      if ((raw > geo.maxOff || raw < geo.minOff) && !edgePulsedRef.current) {
        // 两端橡皮筋阻力：到边振动一次
        edgePulsedRef.current = true;
        props.onHaptic?.('tick');
      } else if (raw <= geo.maxOff && raw >= geo.minOff) {
        edgePulsedRef.current = false;
      }
      pendingRef.current.offset = target;
      offsetRef.current = target;
    },
    [geo.maxOff, geo.minOff, props],
  );

  const onPointerUp = useCallback(() => {
    if (committedRef.current !== null) return;
    // 甩动惯性：带初速度的弹簧吸附到目标页——只吸附，不进入。
    const v = velocityRef.current.x;
    const current = Math.max(
      0,
      Math.min(pageCount - 1, Math.round(-pendingRef.current.offset / geo.stride)),
    );
    const target = settleTarget(v, current, geo.stride, pageCount);
    const damping = settleDamping(target, pageCount);
    animateTo(
      -target * geo.stride,
      // spring(dampingRatio = 0.85f | 0.95f, stiffness = 380f) settle ≈ 4.605/(ζ·√380)
      Math.round((4.605 / (damping * Math.sqrt(SETTLE_STIFFNESS))) * 1000),
      damping > 0.9
        ? 'cubic-bezier(0.2, 1, 0.4, 1)'
        : 'cubic-bezier(0.25, 1, 0.5, 1)',
    );
  }, [animateTo, geo.stride, pageCount]);

  // 只组合中心附近 ±6 页（内容仅 ±3 页），长章节不至组合上百节点
  const renderOrder = scrubberRenderOrder(pageCount, centerIdx, committed);
  const e = Math.max(0, Math.min(1, anim.enter));

  return (
    <div
      ref={rootRef}
      className={['page-scrubber', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ position: 'absolute', inset: 0, touchAction: 'none', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelScrubInternal}
      role="dialog"
      aria-label="快速翻页"
    >
      {/* 近乎不透明的深底 + 环心金色柔光 + 四周渐晕：强化"看进圈内"的隧道纵深 */}
      <div
        className="page-scrubber__backdrop"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: e,
          background: '#0F1115',
        }}
      />
      <div
        className="page-scrubber__glow"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, rgba(232,201,122,${
            0.08 * e
          }) 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
      <div
        className="page-scrubber__vignette"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: e,
          background:
            'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* 串珠线（金色细线，横贯环带中线，衬在页卡之后） */}
      <div
        className="page-scrubber__bead-line"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 1,
          background: `rgba(232, 201, 122, ${(0.26 * e).toFixed(4)})`,
        }}
      />

      {/* 绘制顺序按离中心距离降序：中心页最后画（压最上层），弧上两侧层层后退。 */}
      {renderOrder.map((i) => {
        const inWindow = Math.abs(i - centerIdx) <= 3;
        const isCentered = i === centerIdx && committed === null;
        const t = scrubberPageTransform({
          index: i,
          offset: anim.offset,
          enter: anim.enter,
          geometry: geo,
          // 用 state 里的 `committed`（渲染期可读的那一份），不再在渲染期碰 ref：
          // `commit` / `cancelScrubInternal` 每次都先写 ref 再 setCommitted，两者恒等，
          // 因此渲染结果与原来的 `committedRef.current` 逐像素一致。
          committed,
          specialPage,
          inWindow,
        });
        return (
          <div
            key={i}
            className="page-scrubber__page"
            data-page={i}
            onPointerUp={(e) => {
              // 点击落在页卡上 = commit；空白处由容器的 tap-cancel 处理。
              e.stopPropagation();
              if (committedRef.current === null) commit(i);
            }}
            style={{
              position: 'absolute',
              left: `${geo.baseX}px`,
              top: `${geo.topY}px`,
              width: `${geo.pageW}px`,
              height: `${geo.pageH}px`,
              borderRadius: 12,
              overflow: 'hidden',
              transformOrigin: '50% 50%',
              perspective: `${t.perspective}px`,
              transform:
                `perspective(${t.perspective}px) translateX(${t.translationX}px) ` +
                `rotateY(${t.rotationY}deg) scale(${t.scaleX}, ${t.scaleY})`,
              ...(isCentered
                ? {
                    boxShadow: '0 14px 28px rgba(0,0,0,0.55)',
                    outline: `2px solid ${GOLD}`,
                    outlineOffset: 0,
                  }
                : {}),
              ...(t.shade !== null
                ? { background: `rgba(10, 12, 17, ${t.shade.toFixed(4)})` }
                : {}),
            }}
          >
            {inWindow ? (
              <div
                className="page-scrubber__page-content"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: `${size.w}px`,
                  height: `${size.h}px`,
                  transformOrigin: '0 0',
                  transform: `scale(${geo.pageW / Math.max(1, size.w)}, ${
                    geo.pageH / Math.max(1, size.h)
                  })`,
                }}
              >
                {pageContent(i)}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* 顶部页码胶囊：数字随滑动方向横滑 + 金色进度条 */}
      <div
        className="page-scrubber__pill"
        style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: e,
          background: 'rgba(28, 31, 38, 0.933)',
          borderRadius: 20,
          padding: '8px 20px',
          textAlign: 'center',
        }}
      >
        <p className="page-scrubber__page-num" style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 600 }}>
          第 {centerIdx + 1} / {pageCount} 页
        </p>
        <p className="page-scrubber__hint" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
          左右滑动选页 · 点击进入
        </p>
        <div
          className="page-scrubber__progress"
          style={{
            marginTop: 5,
            width: 132,
            height: 3,
            borderRadius: 1.5,
            background: 'rgba(255,255,255,0.188)',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${((centerIdx + 1) / pageCount * 100).toFixed(2)}%`,
              borderRadius: 1.5,
              background: GOLD,
            }}
          />
        </div>
      </div>

      {/* 底部取消：胶囊按钮 */}
      <button
        type="button"
        className="page-scrubber__cancel"
        onClick={cancelScrubInternal}
        style={{
          position: 'absolute',
          bottom: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: e,
          background: 'rgba(255,255,255,0.102)',
          color: 'rgba(255,255,255,0.902)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 22,
          padding: '9px 30px',
          fontSize: 14,
        }}
      >
        取消
      </button>
    </div>
  );
}

/** Kotlin `MintGold = Color(0xFFE8C97A)`. */
const GOLD = '#E8C97A';

export { ENTER_SPRING };

function bezierEasing(bezier: string): (t: number) => number {
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
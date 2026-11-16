/**
 * WenkuLoadingHandoff.tsx — 两个同名 `WenkuLoadingHandoff` + 骨架基础块 `WenkuSkeletonBlock`。
 *
 * Kotlin 里这三样东西分居两个文件，签名与语义完全不同，**不合并**：
 *
 *   ① `ui/wenku/WenkuLoadingHandoff.kt` L28-77（独立文件，77 行）
 *      `WenkuLoadingHandoff(loaded, modifier, skeleton, content)` —— **擦除交接**
 *      → 本文件 `WenkuLoadingHandoff`
 *      调用点：`ComicChaptersScreen.kt:493`
 *        `WenkuLoadingHandoff(loaded = true, skeleton = { DirectoryHeadingSkeleton() })`
 *
 *   ② `ui/wenku/WenkuMotion.kt` L581-601
 *      `WenkuLoadingHandoff(loading, contentKey, modifier, skeleton, content)` —— **alpha 淡入淡出**
 *      → 本文件 `WenkuLoadingHandoffFade`
 *      调用点：`LibraryScreen.kt:737-742`
 *        `WenkuLoadingHandoff(loading = isSearching, contentKey = Triple(…), skeleton = { LibrarySearchSkeleton() })`
 *
 *   ③ `ui/wenku/WenkuMotion.kt` L567-577
 *      `WenkuSkeletonBlock(modifier, shape)` —— 三个骨架屏的基础块（**纯静态**）
 *      → 本文件 `WenkuSkeletonBlock`
 *      落点说明：没有单独开 `WenkuSkeletonBlock.tsx`，因为它的唯二消费者
 *      （`ComicChaptersSkeletons.tsx` / `LibrarySearchSkeleton.tsx`）都要先 import 本文件
 *      的交接层，放一起可以少一个模块；`index.ts` 未改动（该文件不在本轮允许清单内）。
 *
 * 擦除交接的逐项对照（`WenkuLoadingHandoff.kt`）
 * ──────────────────────────────────────────
 *   L35      `animate = rememberWenkuAccessibility().decorativeMotion && LocalWenkuDecorativeMotion.current`
 *            → `!useWenkuReducedMotion() && useRenderQuality() !== 'MINIMAL'`
 *              （Web 端没有 `LocalWenkuDecorativeMotion` 这个 CompositionLocal；`RenderQuality.MINIMAL`
 *                是项目里既有的"压掉绘制时钟"档，见 `WenkuSectionHeader.tsx` L135 同一口径）
 *   L36      `progress = Animatable(if (loaded && !animate) 1f else 0f)`
 *            → `useState(0)` + 渲染期 `snap`（两端点可直接由 props 推出）
 *   L37      `showSkeleton = progress.value < 1f`（`derivedStateOf`） → `raw < 1`
 *   L38-47   `LaunchedEffect(loaded, animate)`：
 *              `!loaded`  → `snapTo(0f)`
 *              `!animate` → `snapTo(1f)`
 *              否则       → `snapTo(0f)` + `animateTo(1f, tween(320, LinearEasing))`
 *            → 前两支是渲染期派生；第三支是 `requestAnimationFrame` 线性时钟（`WENKU_HANDOFF_ERASE_MS`）
 *   L53      `p = WenkuMotion.ease.transform(progress.coerceIn(0f, 1f))`
 *            → `easeCurve(raw)`（`@core/wenku/motion` L101，与 `CubicBezierEasing(0.215,0.61,0.355,1)` 逐位一致）
 *   L54      `clipRect(left = 0, top = 0, right = w, bottom = h * p)`
 *            → `.wenku-handoff__content { clip-path: inset(0 0 calc(100% - var(--handoff-p) * 100%) 0) }`
 *   L62-71   `if (showSkeleton)` + `matchParentSize` + `clipRect(top = h*p, bottom = h)`
 *            → 条件渲染 `.wenku-handoff__skeleton`，`position:absolute; inset:0`，
 *              `clip-path: inset(calc(var(--handoff-p) * 100%) 0 0 0)`
 *              —— 两段**上下互补**：内容画 `[0, p]`，骨架画 `[p, 1]`，和为整高，任何时候都不露白
 *   L49      `Box(modifier.fillMaxWidth())`，高度由 content 决定 → `.wenku-handoff { width:100% }`，骨架绝对定位拉伸
 *
 * alpha 淡入淡出的逐项对照（`WenkuMotion.kt`）
 * ────────────────────────────────────────
 *   L588     `a11y = rememberWenkuAccessibility()`            → `useWenkuReducedMotion()`
 *   L589-593 `animateFloatAsState(targetValue = if (loading) 1f else 0f,
 *              animationSpec = tween(if (a11y.reduceMotion) 0 else 120, easing = WenkuMotion.ease))`
 *            → `WENKU_HANDOFF_FADE_MS = 120` + `easeCurve`；reduceMotion 时渲染期直接落在 target
 *   L594     `skeletonVisible = skeletonAlpha.value > 0.01f`  → `alpha > WENKU_HANDOFF_FADE_EPSILON`
 *   L596-598 `if (loading || skeletonVisible) Box(fillMaxSize, graphicsLayer { alpha = … })`
 *            → `loading || visible` 时渲染 `.wenku-handoff-fade__skeleton`（`opacity: alpha`）
 *   L599     `WenkuLoadedContentSequence(contentKey, loading) { content() }`
 *            → `<WenkuLoadedContentSequence contentKey loading>`（另见 `WenkuLoadedContentSequence.tsx`）
 *
 * 骨架块的逐项对照（`WenkuMotion.kt`）
 * ──────────────────────────────────
 *   L567-568 注释：「骨架是**纯静态占位**（无 shimmer / 无重复 ticker / 无滤镜）」
 *            → 本文件与两份骨架屏的 CSS **不含任何 keyframes**，也不含微光/渐变位移
 *   L570-577 `fill = colors.ink.copy(alpha = if (colors.isDark) 0.0825f else 0.0625f)`
 *            → `WENKU_SKELETON_ALPHA_DARK = 0.0825` / `WENKU_SKELETON_ALPHA_LIGHT = 0.0625`
 *   L572     `shape: RoundedCornerShape = RoundedCornerShape(4.dp)` → `radius` 默认 `WENKU_RADII_DP.panel` = 4
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { easeCurve } from '@core/wenku/motion';
import { WENKU_RADII_DP, wenkuColors } from '@core/wenku/tokens';
import { useRenderQuality } from '../GlassQuality';
import { useWenkuReducedMotion } from './WenkuGlass';
import { WenkuLoadedContentSequence } from './WenkuLoadedContentSequence';
import '../../../styles/wenku.css';

/* ═══════════════════════════════════════════════════════════════════════════════
 * 常量
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `WenkuLoadingHandoff.kt` L45 `tween(durationMillis = 320, easing = LinearEasing)`。 */
export const WENKU_HANDOFF_ERASE_MS = 320;
/** `WenkuMotion.kt` L591 `tween(if (a11y.reduceMotion) 0 else 120, easing = WenkuMotion.ease)`。 */
export const WENKU_HANDOFF_FADE_MS = 120;
/** `WenkuMotion.kt` L594 `skeletonAlpha.value > 0.01f`。 */
export const WENKU_HANDOFF_FADE_EPSILON = 0.01;
/** `WenkuMotion.kt` L572 `RoundedCornerShape(4.dp)`（= `WenkuTokens.PanelRadius`）。 */
export const WENKU_SKELETON_RADIUS_PX = WENKU_RADII_DP.panel;
/** `WenkuMotion.kt` L575 暗色档 `alpha = 0.0825f`。 */
export const WENKU_SKELETON_ALPHA_DARK = 0.0825;
/** `WenkuMotion.kt` L575 亮色档 `alpha = 0.0625f`。 */
export const WENKU_SKELETON_ALPHA_LIGHT = 0.0625;

/**
 * 内容层 `clipRect(left = 0, top = 0, right = w, bottom = h * p)`。
 * 与 `wenku.css` 的 `.wenku-handoff__content` 规则是同一个式子。
 */
export const WENKU_HANDOFF_CONTENT_CLIP = 'inset(0 0 calc(100% - var(--handoff-p) * 100%) 0)';
/**
 * 骨架层 `clipRect(top = h * p, bottom = h)` —— 与内容层上下互补，两段之和 = 整高。
 * 与 `wenku.css` 的 `.wenku-handoff__skeleton` 规则是同一个式子。
 */
export const WENKU_HANDOFF_SKELETON_CLIP = 'inset(calc(var(--handoff-p) * 100%) 0 0 0)';

const CONTENT_STYLE: CSSProperties = { clipPath: WENKU_HANDOFF_CONTENT_CLIP };
const SKELETON_STYLE: CSSProperties = { clipPath: WENKU_HANDOFF_SKELETON_CLIP };

/* ═══════════════════════════════════════════════════════════════════════════════
 * 小工具
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `0xAARRGGBB` + 显式 alpha → CSS `rgba()`。alpha 走浮点，不经 8 位量化（保 0.0625 精确）。 */
export function tintCss(color: number, alpha: number): string {
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(Number(alpha.toFixed(4)))})`;
}

/** 0..1 → CSS 变量字面量：端点写成 `0` / `1`，中间保留 5 位小数（避免每帧一长串浮点尾巴）。 */
function formatFraction(value: number): string {
  if (!(value > 0)) return '0';
  if (value >= 1) return '1';
  return value.toFixed(5);
}

function readDocumentDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** 主题跟着 `<html data-theme>`（`App.tsx` 写的就是这个属性）。 */
export function useDocumentDark(): boolean {
  const [dark, setDark] = useState<boolean>(readDocumentDark);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(() => setDark(readDocumentDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ③ WenkuSkeletonBlock —— `WenkuMotion.kt` L567-577
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface WenkuSkeletonBlockProps {
  /** Kotlin `modifier`（调用点的 `.fillMaxWidth(.36f).height(14.dp)` 之类）。 */
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Kotlin `shape: RoundedCornerShape = RoundedCornerShape(4.dp)`，这里按 dp→px 给半径。 */
  readonly radius?: number;
}

/**
 * 骨架基础块：`Box(modifier.clip(shape).background(ink @ .0625/.0825))`。
 *
 * **纯静态**（Kotlin L567-568 原注释：无 shimmer / 无重复 ticker / 无滤镜），
 * 不加扫光、不加脉冲、不加渐变位移 —— 动效全部由外层交接层负责。
 */
export function WenkuSkeletonBlock(props: WenkuSkeletonBlockProps) {
  const dark = useDocumentDark();
  const colors = wenkuColors(dark);
  const alpha = dark ? WENKU_SKELETON_ALPHA_DARK : WENKU_SKELETON_ALPHA_LIGHT;
  const radius = props.radius ?? WENKU_SKELETON_RADIUS_PX;

  const classNames = ['wenku-skeleton-block'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  return (
    <div
      className={classNames.join(' ')}
      data-wenku-skeleton=""
      data-wenku-skeleton-alpha={alpha}
      aria-hidden="true"
      style={{
        borderRadius: `${String(radius)}px`,
        background: tintCss(colors.ink, alpha),
        ...props.style,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ① 擦除交接 —— `ui/wenku/WenkuLoadingHandoff.kt` L28-77
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface WenkuLoadingHandoffProps {
  /** Kotlin `loaded: Boolean`。false → 立刻回骨架；true → 从顶部向下擦出内容。 */
  readonly loaded: boolean;
  /** Kotlin `skeleton: @Composable () -> Unit` —— 始终垫在未揭示的那一段下面。 */
  readonly skeleton: ReactNode;
  /** Kotlin `content: @Composable () -> Unit` —— 决定整体高度的那一层。 */
  readonly children: ReactNode;
  /** Kotlin `modifier` 的 className 部分。 */
  readonly className?: string;
  /** Kotlin `modifier` 的布局部分（如调用点的 `fillMaxSize()`）。 */
  readonly style?: CSSProperties;
}

/**
 * 骨架 → 内容的**擦除交接**（不是 crossfade）。
 *
 * 骨架只画 `top = h·p` 以下的区域，内容只画 `bottom = h·p` 以上的区域；
 * 即使内容晚一帧到，未揭示的那一段下面永远有骨架，不会露白。
 *
 * Kotlin: `ui/wenku/WenkuLoadingHandoff.kt` L28-77 · 调用点 `ComicChaptersScreen.kt:493`。
 * 同名但语义不同的 alpha 版见下方 `WenkuLoadingHandoffFade`。
 */
export function WenkuLoadingHandoff(props: WenkuLoadingHandoffProps) {
  const reduceMotion = useWenkuReducedMotion();
  const quality = useRenderQuality();
  /** Kotlin L35 `animate`。 */
  const animate = !reduceMotion && quality !== 'MINIMAL';

  const [clock, setClock] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Kotlin L36/L38-47 的渲染期等价物：
   *   `!loaded`  → 0；`loaded && !animate` → 1；两者之间才是时钟。
   */
  const snap: number | null = !props.loaded ? 0 : !animate ? 1 : null;

  useEffect(() => {
    if (snap !== null) return undefined;
    // 重播首帧先把上一轮的终点抹掉（写 DOM = 允许的同步外部系统更新，不触发级联渲染）。
    rootRef.current?.style.setProperty('--handoff-p', '0');
    let frame = 0;
    let startedAt = -1;
    const step = (now: number): void => {
      if (startedAt < 0) startedAt = now;
      const elapsed = now - startedAt;
      const next = elapsed >= WENKU_HANDOFF_ERASE_MS ? 1 : elapsed / WENKU_HANDOFF_ERASE_MS;
      setClock(next);
      if (next < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [snap]);

  /** Kotlin L36 的 `progress.value`（**线性**时钟，未过缓动）。 */
  const raw = snap ?? clock;
  /** Kotlin L53 `WenkuMotion.ease.transform(progress.value.coerceIn(0f, 1f))`。 */
  const p = easeCurve(raw > 1 ? 1 : raw < 0 ? 0 : raw);
  /** Kotlin L37 `showSkeleton`。 */
  const showSkeleton = raw < 1;

  const classNames = ['wenku-handoff'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style = {
    '--handoff-p': formatFraction(p),
    ...props.style,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={classNames.join(' ')}
      style={style}
      data-wenku-handoff="erase"
      data-handoff-loaded={props.loaded ? 'true' : 'false'}
      data-handoff-p={formatFraction(p)}
    >
      {/* L51-60：内容按揭示进度从顶部向下裁切（它决定整体高度） */}
      <div className="wenku-handoff__content" data-handoff-layer="content" style={CONTENT_STYLE}>
        {props.children}
      </div>
      {/* L62-75：骨架只画尚未揭示的部分，保证「内容晚到也不露白」 */}
      {showSkeleton ? (
        <div
          className="wenku-handoff__skeleton"
          data-handoff-layer="skeleton"
          aria-hidden="true"
          style={SKELETON_STYLE}
        >
          {props.skeleton}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ② alpha 淡入淡出 —— `ui/wenku/WenkuMotion.kt` L581-601
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface WenkuLoadingHandoffFadeProps {
  /** Kotlin `loading: Boolean` —— true 时骨架不透明，false 时 120ms 淡出。 */
  readonly loading: boolean;
  /**
   * Kotlin `contentKey: Any?` —— 变化即重播内容入场时钟（`contentKey` **不**影响
   * `skeletonAlpha`，只影响内层的 `WenkuLoadedContentSequence`）。
   */
  readonly contentKey?: unknown;
  /** Kotlin `skeleton: @Composable () -> Unit`。 */
  readonly skeleton: ReactNode;
  /** Kotlin `content: @Composable () -> Unit`。 */
  readonly children: ReactNode;
  /** Kotlin `modifier` 的 className 部分。 */
  readonly className?: string;
  /** Kotlin `modifier` 的布局部分（调用点是 `Modifier.fillMaxSize()`）。 */
  readonly style?: CSSProperties;
}

/**
 * 骨架 → 内容的 **alpha 淡入淡出**（`animateFloatAsState`）。
 *
 * 与擦除版的区别：骨架整层按 alpha 收掉（120ms / `WenkuMotion.ease`），
 * 内容宿主是 `WenkuLoadedContentSequence`（`ENTER_MS = 420` 线性入场）。
 *
 * Kotlin: `ui/wenku/WenkuMotion.kt` L581-601 · 调用点 `LibraryScreen.kt:737-742`。
 */
export function WenkuLoadingHandoffFade(props: WenkuLoadingHandoffFadeProps) {
  const reduceMotion = useWenkuReducedMotion();
  /** Kotlin L591 `tween(if (a11y.reduceMotion) 0 else 120, …)`。 */
  const duration = reduceMotion ? 0 : WENKU_HANDOFF_FADE_MS;
  const target = props.loading ? 1 : 0;

  const [tweened, setTweened] = useState(target);
  const alphaRef = useRef(target);
  /** reduceMotion（duration = 0）时 `animateFloatAsState` 直接落在目标值。 */
  const alpha = duration === 0 ? target : tweened;

  useEffect(() => {
    if (duration === 0) return undefined;
    const from = alphaRef.current;
    if (from === target) return undefined;
    let frame = 0;
    let startedAt = -1;
    const step = (now: number): void => {
      if (startedAt < 0) startedAt = now;
      const elapsed = now - startedAt;
      const t = elapsed >= duration ? 1 : elapsed / duration;
      const next = from + (target - from) * easeCurve(t);
      alphaRef.current = next;
      setTweened(next);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        alphaRef.current = target;
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, duration]);

  /** Kotlin L594 `skeletonAlpha.value > 0.01f`。 */
  const skeletonVisible = alpha > WENKU_HANDOFF_FADE_EPSILON;
  const showSkeleton = props.loading || skeletonVisible;

  const classNames = ['wenku-handoff-fade'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  return (
    <div
      className={classNames.join(' ')}
      style={props.style}
      data-wenku-handoff="fade"
      data-handoff-loading={props.loading ? 'true' : 'false'}
    >
      {/* L596-598 `if (loading || skeletonVisible) Box(fillMaxSize, graphicsLayer { alpha })` */}
      {showSkeleton ? (
        <div
          className="wenku-handoff-fade__skeleton"
          data-handoff-layer="skeleton"
          aria-hidden="true"
          style={{ opacity: alpha }}
        >
          {props.skeleton}
        </div>
      ) : null}
      {/* L599 `WenkuLoadedContentSequence(contentKey = contentKey, loading = loading) { content() }` */}
      <WenkuLoadedContentSequence
        className="wenku-handoff-fade__content"
        contentKey={props.contentKey}
        loading={props.loading}
      >
        {props.children}
      </WenkuLoadedContentSequence>
    </div>
  );
}

export default WenkuLoadingHandoff;

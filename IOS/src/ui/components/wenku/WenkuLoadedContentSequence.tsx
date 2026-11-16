/**
 * WenkuLoadedContentSequence.tsx — `ui/wenku/WenkuMotion.kt` L88-114 的 React 版。
 *
 * Kotlin → TS 映射（`WenkuMotion.kt`）
 * ──────────────────────────────────
 *   L81       `private val LocalWenkuSequence = staticCompositionLocalOf<State<Float>?> { null }`
 *                                                                    → `WenkuSequenceContext`（默认 1）
 *   L89-94    `WenkuLoadedContentSequence(contentKey, loading, modifier, revealOnEnter, content)`
 *                                                                    → `WenkuLoadedContentSequenceProps`
 *   L96-97    `animate = revealOnEnter && !a11y.reduceMotion`         → `revealOnEnter !== false && !reduceMotion`
 *   L98       `Animatable(if (animate) 0f else 1f)`                   → `useState(0)`（`!animate` 时渲染期直接给 1）
 *   L99-110   `LaunchedEffect(contentKey, loading, animate)`：
 *               `!animate`            → `snapTo(1)`                  → 渲染期 `value = 1`
 *               `loading`             → `snapTo(0)`                  → 渲染期 `value = 0`
 *               否则                  → `snapTo(0)` + `animateTo(1, tween(ENTER_MS, LinearEasing))`
 *                                                                    → rAF 线性时钟 0→1，时长 `WENKU_MOTION.enterMs`
 *   L111-113  `CompositionLocalProvider(LocalWenkuSequence provides progress.asState()) { Box(modifier) { content() } }`
 *                                                                    → `Provider value={progress}` + `.wenku-seq` 容器
 *
 * 已移植符号的复用（`src/core/wenku/motion.ts` / `tokens.ts`，没有另造一套）
 * ────────────────────────────────────────────────────────────
 *   本文件 **import**：
 *     - `clamp`（`motion.ts` L48）—— 进度夹取
 *     - `WENKU_MOTION.enterMs`（`WenkuTokens.kt` L123 `ENTER_MS = 420`）→ `WENKU_SEQUENCE_ENTER_MS`
 *   同目录已移植、**子元素**可直接取用（本文件不 import，只是不重复实现）：
 *     - `linearEasing`（`motion.ts` L118）—— 本组件自身就是线性时钟
 *     - `listStart` / `listEnd`（`motion.ts` L133-140）—— `wenkuReveal(order)` 的窗口
 *
 * 与 Kotlin 的差异
 * ───────────────
 *  * `contentKey` 用 **等价语义**（Compose `equals`）而不是 React 的引用相等：调用点常写
 *    `Triple(a, b, c)`（`LibraryScreen.kt` L739），JS 侧每次渲染都是新对象，若按引用比较
 *    会每帧重播。这里用 `contentKeyId()` 规范化成字符串参与依赖。
 *  * Compose 的 `Animatable` 在 `snapTo(0)` 时是瞬时的；Web 端首帧由 rAF 落 0，effect 里
 *    先把 DOM 上的 `--wenku-seq` 抹回 0，避免重播首帧闪一帧满稿。
 *  * 子元素的进度既可以从 context 读（React 消费者），也可以直接用 CSS 变量
 *    `var(--wenku-seq)`（`WenkuSectionHeader` 那类纯 CSS 消费者）。
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { clamp } from '@core/wenku/motion';
import { WENKU_MOTION } from '@core/wenku/tokens';
import { useWenkuReducedMotion } from './WenkuGlass';
import '../../../styles/wenku.css';

/** `WenkuMotion.ENTER_MS`（`WenkuTokens.kt` L123）—— 内容入场时钟总长。 */
export const WENKU_SEQUENCE_ENTER_MS = WENKU_MOTION.enterMs;

/**
 * `LocalWenkuSequence`（`WenkuMotion.kt` L81）。
 *
 * 默认值取 `1`：Kotlin 侧 `LocalWenkuSequence` 默认 `null`，`wenkuArchivePart` 之类在
 * 拿到 `null` 时**原样透传 Modifier**（即"已完全揭示"），所以 1 是同一个最终画面。
 */
export const WenkuSequenceContext = createContext<number>(1);

/** 读取当前内容入场进度（0..1）。没有 `WenkuLoadedContentSequence` 祖先时为 1。 */
export function useWenkuSequence(): number {
  return useContext(WenkuSequenceContext);
}

/**
 * `contentKey: Any?` 的等价键。
 *
 * Compose 的 `LaunchedEffect(contentKey, …)` 用 `equals` 判等；React 用引用相等。
 * 调用点传的是 `Triple(sourceId, keyword, hasAggregateResults)`，所以这里按**结构化值**
 * 归一，保持与 Kotlin 同样的"值变了才重播"。
 */
export function contentKeyId(key: unknown): string {
  if (key === null) return 'null';
  if (key === undefined) return 'undefined';
  const type = typeof key;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return `${type}:${String(key)}`;
  }
  if (type === 'function' || type === 'symbol') return `${type}:${String(key)}`;
  try {
    return `json:${JSON.stringify(key) ?? 'undefined'}`;
  } catch {
    return `raw:${String(key)}`;
  }
}

export interface WenkuLoadedContentSequenceProps {
  /** Kotlin `contentKey: Any? = Unit` —— 变化即重播入场时钟。 */
  readonly contentKey?: unknown;
  /** Kotlin `loading: Boolean = false` —— 为 true 时进度钉在 0。 */
  readonly loading?: boolean;
  /** Kotlin `revealOnEnter: Boolean = true`。 */
  readonly revealOnEnter?: boolean;
  /** Kotlin `modifier`。 */
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * 内容宿主：把 0..1 的入场时钟通过 context / CSS 变量广播给子元素。
 * Kotlin 生产调用点见 `WenkuMotion.kt` L599（`WenkuLoadingHandoff` 的 alpha 版内部）。
 */
export function WenkuLoadedContentSequence(props: WenkuLoadedContentSequenceProps) {
  const reduceMotion = useWenkuReducedMotion();
  const revealOnEnter = props.revealOnEnter !== false;
  const loading = props.loading === true;
  const animate = revealOnEnter && !reduceMotion;

  const [clock, setClock] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Kotlin L100-105：`!animate` → 1；`loading` → 0。两端点都是 props 的纯函数，
  // 只有中间那段需要时钟，所以直接在渲染期求值（effect 里不 setState）。
  const progress = !animate ? 1 : loading ? 0 : clamp(clock, 0, 1);
  const keyId = contentKeyId(props.contentKey);

  useEffect(() => {
    if (!animate || loading) return undefined;
    // 重播首帧先把上一轮的终点抹掉（写 DOM = 允许的同步外部系统更新）。
    rootRef.current?.style.setProperty('--wenku-seq', '0');
    let frame = 0;
    let startedAt = -1;
    const step = (now: number): void => {
      if (startedAt < 0) startedAt = now;
      const elapsed = now - startedAt;
      const next = elapsed >= WENKU_SEQUENCE_ENTER_MS ? 1 : elapsed / WENKU_SEQUENCE_ENTER_MS;
      setClock(next);
      if (next < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animate, loading, keyId]);

  const classNames = ['wenku-seq'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style = {
    '--wenku-seq': progress,
    ...props.style,
  } as CSSProperties;

  return (
    <WenkuSequenceContext.Provider value={progress}>
      <div
        ref={rootRef}
        className={classNames.join(' ')}
        style={style}
        data-wenku-seq={progress}
        data-wenku-seq-key={keyId}
      >
        {props.children}
      </div>
    </WenkuSequenceContext.Provider>
  );
}

export default WenkuLoadedContentSequence;

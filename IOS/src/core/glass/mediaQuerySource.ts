/**
 * E61 —— 媒体查询依赖注入（`src/core/**` 去 DOM 全局）。
 *
 * ## 背景
 *
 * `src/core/glass/motion.ts` 的 `systemReduceMotion()` 与
 * `src/core/glass/liquidGlass.ts` 的 `prefersReducedTransparency()` 此前都直接调
 * `window.matchMedia(...)`。这让 `src/core/**` 依赖 DOM 全局，违反项目硬约定
 * （`docs/PARITY_EXCEPTIONS.md` E61）：核心层必须能在**非浏览器宿主**
 * （Node worker / 小程序壳）里跑，且单测不该被强制绑在 jsdom 上。
 *
 * ## 为什么不直接 import `MediaQueryPort`
 *
 * import `@platform/interfaces` 本身是**允许**的（ESLint `no-restricted-imports`
 * 只禁 React/DOM/Capacitor）。但 `motion.ts` / `liquidGlass.ts` 历史上都是
 * 「零 import 的纯令牌模块」，被大量单测直接 import 而不装配平台。
 * 在 `core/glass/` 下放一个**共享注入点**，让：
 *   - 两个模块共享同一份注入状态（不会出现「motion 注了、glass 没注」的分裂）
 *   - 单测可以只注入一次，或用 `withMediaQuery()` 做局部覆盖
 *   - 装配层（`src/platform/**`）在启动时调一次 `setMediaQuerySource()`
 *
 * ## 语义等价性
 *
 * 原实现：
 * ```ts
 * if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
 * try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
 * catch { return false; }
 * ```
 *
 * 本模块的兜底 `NO_MEDIA_QUERY.matches()` 恒返回 `false`，与上述
 * 「无 window / 无 matchMedia / 抛错」三个分支的返回值**完全一致**。
 */

/** 媒体查询端口的最小形状（与 `MediaQueryPort` 结构兼容）。 */
export interface MediaQuerySource {
  matches(query: string): boolean;
}

/** 兜底：无宿主媒体查询时恒 false（对齐 Kotlin 读取失败按 0f 处理）。 */
const NO_MEDIA_QUERY: MediaQuerySource = {
  matches: () => false,
};

let source: MediaQuerySource = NO_MEDIA_QUERY;

/**
 * 装配处注入真实媒体查询。传 `null` 恢复兜底（单测用）。
 *
 * Android 对照：`AccessibilityManager` 的 `reduce_transparency` 等 flag
 * （`GlassKit.kt:300`），reduce-motion 见 `Motion.kt:188-205`。
 */
export function setMediaQuerySource(next: MediaQuerySource | null): void {
  source = next ?? NO_MEDIA_QUERY;
}

/** 当前生效的媒体查询源。 */
export function getMediaQuerySource(): MediaQuerySource {
  return source;
}

/**
 * 临时覆盖媒体查询源，返回还原函数。用于单测把某个模块钉在特定分支上，
 * 避免每个用例都写 try/finally。
 *
 * ```ts
 * const restore = withMediaQuery({ matches: (q) => q.includes('reduce') });
 * try { expect(systemReduceMotion()).toBe(true); } finally { restore(); }
 * ```
 */
export function withMediaQuery(override: MediaQuerySource): () => void {
  const previous = source;
  source = override;
  return () => {
    source = previous;
  };
}

/**
 * 共享元素转场的两个作用域 —— `MainActivity.kt` L75 / L472 +
 * `HomeScreen.kt` L185 / L1554-1555 的 React 版。
 *
 * Kotlin → TS
 * ────────────
 *   MainActivity.kt L75  `private val LocalSharedTransitionScope =
 *          compositionLocalOf<SharedTransitionScope?> { null }`
 *                        → `LocalSharedTransitionScope`（Context，`null` 时静默退化为普通淡入淡出）
 *   MainActivity.kt L472 `CompositionLocalProvider(LocalSharedTransitionScope provides this)` 包住整棵 NavHost
 *                        → `SharedTransitionProvider`
 *   MainActivity.kt L…  `LocalNavAnimatedVisibilityScope`
 *                        → `LocalNavAnimatedVisibilityScope`（页面级 AnimatedVisibilityScope）
 *
 * 已登记 E50：Compose 的 `sharedElement` 与 Web 的 **View Transitions API** 是同一抽象
 * （`SharedTransitionLayout` ↔ `document.startViewTransition`、
 * `rememberSharedContentState(key)` ↔ CSS `view-transition-name`）；
 * `startViewTransition` 不存在时直接执行回调，**不抛**（与 Compose 的 `null` 静默退化一致）。
 */
import { createContext, type ReactNode } from 'react';

/** 页面作用域的可见性（对应 `AnimatedVisibilityScope`）。 */
export interface NavAnimatedVisibilityScope {
  readonly visible: boolean;
  readonly direction: 1 | -1;
}

/** MainActivity L75 `LocalSharedTransitionScope`（`null` = 不在共享转场作用域内）。 */
export const LocalSharedTransitionScope = createContext<SharedTransitionScopeLike | null>(null);

/** MainActivity L… `LocalNavAnimatedVisibilityScope`。 */
export const LocalNavAnimatedVisibilityScope = createContext<NavAnimatedVisibilityScope | null>(null);

/** `SharedTransitionScope` 的最小投影（Web 侧只需 `startViewTransition`）。 */
export interface SharedTransitionScopeLike {
  readonly startViewTransition: (update: () => void) => void;
}

/** MainActivity L472：把作用域注入整棵路由树。 */
export function SharedTransitionProvider(props: {
  readonly scope: SharedTransitionScopeLike;
  readonly visibility?: NavAnimatedVisibilityScope;
  readonly children: ReactNode;
}) {
  return (
    <LocalSharedTransitionScope.Provider value={props.scope}>
      <LocalNavAnimatedVisibilityScope.Provider value={props.visibility ?? null}>
        {props.children}
      </LocalNavAnimatedVisibilityScope.Provider>
    </LocalSharedTransitionScope.Provider>
  );
}

/**
 * `LocalWenkuReflowState` —— `ui/wenku/WenkuReflow.kt` L102 的 React 版。
 *
 * L102 `val LocalWenkuReflowState = staticCompositionLocalOf<WenkuReflowState?> { null }`：
 * `null` 表示不在重排作用域内（`WenkuReflowItem` 直接出内容，不做重排插值）。
 * 状态机与几何在 `@core/wenku/reflow` 与 `@core/wenku/parityNames`。
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

import { rememberWenkuReflowState } from '@core/wenku/parityNames';
import type { WenkuReflowState } from '@core/wenku/parityNames';

export const LocalWenkuReflowState = createContext<WenkuReflowState | null>(null);

/** 读取当前重排控制器（`LocalWenkuReflowState.current`）。 */
export function useWenkuReflowState(): WenkuReflowState | null {
  return useContext(LocalWenkuReflowState);
}

/** `WenkuReflowScope(state, content)`：把控制器注入子树。 */
export function WenkuReflowScope(props: { readonly state: WenkuReflowState; readonly children: ReactNode }) {
  return <LocalWenkuReflowState.Provider value={props.state}>{props.children}</LocalWenkuReflowState.Provider>;
}

/** `rememberWenkuReflowState()` 的 React 形态。 */
export function useRememberWenkuReflowState(): WenkuReflowState {
  const [state] = useState<WenkuReflowState>(() => rememberWenkuReflowState());
  return state;
}

/**
 * `LocalWenkuIconContact` —— `ui/wenku/WenkuIcon.kt` L63-78 的 React 版。
 *
 * 按钮把「被按住」这件事借给图标，但自己**不注册手势识别器、也不处理动作**：
 * 滚动与取消仍归原控件。Kotlin 用 `staticCompositionLocalOf`，Web 用 React Context。
 *
 * Kotlin → TS
 * ────────────
 *   L71-75 `data class WenkuIconContact(pressed = false, activation = 0)` → `WenkuIconContact`
 *   L78    `val LocalWenkuIconContact = staticCompositionLocalOf { WenkuIconContact() }`
 *          → `LocalWenkuIconContact` + `WenkuIconContactProvider` + `useWenkuIconContact()`
 *
 * 数据类型与常量在 `@core/wenku/iconMotion`（`src/core/**` 禁 import React）。
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  WENKU_ICON_CONTACT_REST,
  type WenkuIconContact,
} from '@core/wenku/iconMotion';

export type { WenkuIconContact } from '@core/wenku/iconMotion';

export const LocalWenkuIconContact = createContext<WenkuIconContact>(WENKU_ICON_CONTACT_REST);

export interface WenkuIconContactProviderProps {
  readonly pressed: boolean;
  readonly activation: number;
  readonly children: ReactNode;
}

/** L227 / L297 / L375 的 `CompositionLocalProvider(LocalWenkuIconContact provides …)`。 */
export function WenkuIconContactProvider(props: WenkuIconContactProviderProps) {
  const value = useMemo<WenkuIconContact>(
    () => ({ pressed: props.pressed, activation: props.activation }),
    [props.pressed, props.activation],
  );
  return <LocalWenkuIconContact.Provider value={value}>{props.children}</LocalWenkuIconContact.Provider>;
}

/** 读取当前接触态（`LocalWenkuIconContact.current`）。 */
export function useWenkuIconContact(): WenkuIconContact {
  return useContext(LocalWenkuIconContact);
}

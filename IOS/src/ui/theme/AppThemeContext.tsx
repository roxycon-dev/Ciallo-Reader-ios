/**
 * `LocalAppDarkTheme` —— `ui/theme/Theme.kt` 的 CompositionLocal。
 *
 * L…`val LocalAppDarkTheme = staticCompositionLocalOf { false }`：
 * App 自己的暗色开关（**不是**系统 `isSystemInDarkTheme()`，用户可在设置里覆盖）。
 * 文本对比度辅助（`themeTextContrast` / `legibleThemeInk`）在 `@core/ui/parityMisc`。
 */
import { createContext, type ReactNode } from 'react';

export const LocalAppDarkTheme = createContext(false);

export function AppDarkThemeProvider(props: { readonly dark: boolean; readonly children: ReactNode }) {
  return <LocalAppDarkTheme.Provider value={props.dark}>{props.children}</LocalAppDarkTheme.Provider>;
}

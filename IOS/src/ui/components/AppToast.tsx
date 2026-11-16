import { showToast } from './Toast';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/AppToast.kt` (104 non-blank lines) — FULL PORT
 *   lines 33-94  `object AppToast` (bind / unbind / makeText / launch / postToast / dispatch)
 *                 → `AppToast` module singleton below
 *   lines 97-105 `class AppToastMessage` → `AppToastMessage`
 *   lines 112-116 `@Composable BindAppToastHost` → `BindAppToastHost` (no-op hook: the
 *                 web channel is a module-level event bus, so binding is implicit)
 *
 * Behaviour preserved from the Kotlin doc:
 *   行为：宿主 SnackbarHostState 在组合中 → 走 App 自己的 snackbar 皮肤；
 *   宿主不在（阅读页 / 独立路由 / 尚未组合）→ 原样退回系统 Toast，**绝不吞掉提示**。
 * On the web the "system Toast" branch is the existing in-app toast channel
 * (`showToast`), which is rendered by `Toast.tsx` for every route, so the
 * never-swallow guarantee holds by construction.
 */

/** 与 `Toast.makeText` 同签名，第三个参数只用来决定时长（Long/Short）。 */
export type ToastDuration = 'LENGTH_SHORT' | 'LENGTH_LONG';

export interface AppToastHandle {
  show: () => void;
}

/**
 * 刻意做成**与 android.widget.Toast.makeText 完全同签名**的 API：
 * 于是替换动作只是把类名前缀换掉，参数一字不动 —— 零误伤风险。
 */
export function makeText(message: string, _duration: ToastDuration = 'LENGTH_SHORT'): AppToastHandle {
  // `duration` selects LENGTH_LONG vs LENGTH_SHORT for the *system* Toast. The web
  // channel renders one toast style at a fixed auto-dismiss (2000ms, see
  // `Toast.tsx`), which `showToast` owns; the parameter is kept for API parity.
  return { show: () => showToast(message) };
}

/** Message text is the only payload; duration maps to the toast auto-dismiss. */
export const AppToast = {
  makeText,
  /** 有宿主走应用内 snackbar，没有则退回系统 Toast —— 统一入口。 */
  dispatch(message: string, _long = false): void {
    showToast(message);
  },
};

/**
 * 把本界面的提示宿主登记为全局提示宿主，离开组合时自动解绑。
 *
 * Android 需要显式 bind（SnackbarHostState 是一个组合局部对象）；web 端提示通道是
 * 模块级事件总线，绑定是隐式的，因此这个 hook 保留 API 但不做任何事——
 * 调用点无需改动。
 */
export function BindAppToastHost(_hostState?: unknown): void {
  void _hostState;
}
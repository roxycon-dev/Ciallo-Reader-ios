import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StartupGate } from '@ui/shell/StartupGate';
import {
  ENTRY_WINDOW_MS,
  arm,
  disarm,
  installRenderRecoverySettings,
  isRenderFailure,
  onUncaught,
} from '@core/app/homeRenderRecovery';
import { installSafari16Polyfills } from '@platform/web/polyfills';
import './styles/global.css';
import './styles/theme.css';

// `crypto.randomUUID` is secure-context only and WKWebView serves the app from
// `capacitor://localhost`, which is not a secure context. Six call sites use it
// without a guard (source import, local book import, share, comic settings), so the
// polyfill must land before anything else runs. Idempotent: no-op when native exists.
installSafari16Polyfills();

/**
 * E108 接线（Android `MainActivity.kt:690-706`）：
 *  - `arm()` 必须在**第一次渲染之前**（Kotlin 在 `remember {}` 里、`HomeScreen`
 *    组合之前武装，注释原文「Arm before composing the page, so composition/layout
 *    failures are covered too.」）；
 *  - 存活满 `ENTRY_WINDOW_MS` 后 `disarm()`（Kotlin `LaunchedEffect` 里的
 *    `delay(ENTRY_WINDOW_MS)`）。Web 没有「离开 home 页」这一事件 —— 离开 = 刷新/关页 ——
 *    所以只保留「存活满窗口即解除」这一半，效果等价：只有进场后 20 s 内的异常算数。
 */
const homeEntryToken = arm();
window.setTimeout(() => disarm(homeEntryToken), ENTRY_WINDOW_MS);

// 降级要写 `render_quality` + `home_render_recovery_notice`，这是 core 层唯一看不到的
// 东西：用懒加载把 `@platform` 与 `SettingsRepository` 注入进去（core 不 import 平台）。
installRenderRecoverySettings(async () => {
  const [{ getPlatform }, { SettingsRepository }] = await Promise.all([
    import('@platform/index'),
    import('@core/settings/settingsRepository'),
  ]);
  return new SettingsRepository(getPlatform().db);
});

/**
 * React 错误边界抓不到的异常：`window.onerror`（同步）+ `unhandledrejection`
 * （异步/懒加载 chunk 失败）。两者都只把**判定通过**的失败交给 `onUncaught()`，
 * 判定逻辑与 Android 的 `isRenderFailure` 是同一份（`onUncaught` 内部还会再判一次，
 * 这里提前过滤是为了不让业务异常白跑一趟存储）。
 */
window.addEventListener('error', (event: ErrorEvent) => {
  // 跨源脚本的 error 事件拿不到 Error 对象（`event.error === null`）→ 无栈可判，放弃。
  const failure: unknown = event.error;
  if (failure === null || failure === undefined) return;
  if (!isRenderFailure(failure)) return;
  void onUncaught(failure).catch(() => {
    /* 降级失败 → 保持当前画质，不属于用户可见错误 */
  });
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const failure: unknown = event.reason;
  if (!isRenderFailure(failure)) return;
  void onUncaught(failure).catch(() => {
    /* 同上 */
  });
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    {/*
     * 错误边界**不**包整个 App：`HomeRenderRecovery.arm()` 在 Android 只覆盖
     * `composable("home")`（`MainActivity.kt:690-706`），包住全部路由会让漫画阅读器的
     * 一次渲染异常把整页换成「主页渲染失败」的回退 UI（实测 `local CBZ` e2e 就是这样挂的）。
     * 边界落在 `App.tsx` 的 `route === 'main'` 分支；窗口级 `error` /
     * `unhandledrejection` 监听仍在这里（那才是真正的未捕获异常）。
     */}
    <StartupGate><App /></StartupGate>
  </StrictMode>,
);

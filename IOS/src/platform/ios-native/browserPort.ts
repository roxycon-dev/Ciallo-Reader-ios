/**
 * 外部浏览器的原生实现（iOS）—— `@capacitor/browser`（`SFSafariViewController`）。
 *
 * 对应 Android `Intent(Intent.ACTION_VIEW, Uri.parse(url))` + `startActivity`：
 *  · `library/LibraryLoginDialog.kt:246`（「去注册」）；
 *  · `source/ZLibraryLoginDialog.kt:328`（「去注册」）；
 *  · `SettingsTabScreen.kt` 的 `LocalUriHandler.openUri`（GitHub 发布页 / 项目主页）。
 *
 * ⚠️ 这份实现替换掉了 `src/ui/**` 里的裸 `window.open(url, '_blank')`：
 * WKWebView 会用 `WKUIDelegate` 拦截 `_blank` 导航，若无对应处理就是
 * **既不报错也不打开** —— 用户点了没反应，属于静默失败。
 * 用 `SFSafariViewController` 还有个额外好处：用户在系统浏览器里完成注册后
 * cookie 落在 Safari 容器里，与 Android 的 Custom Tabs 语义一致；
 * 若用 WKWebView 内部打开则拿不到那些 cookie，登录态对不上。
 */
import { Browser } from '@capacitor/browser';
import type { ExternalBrowserPort } from '@platform/interfaces';

export function createNativeExternalBrowserPort(): ExternalBrowserPort {
  return {
    async open(url: string): Promise<void> {
      // `presentationStyle: 'popover'` 在 iPad 上是必须的：`fullscreen` 在 iPad
      // 多任务/Slide Over 下会被系统降级或直接不呈现。Android 的
      // `CustomTabsIntent` 也是走系统容器，不接管全屏。
      await Browser.open({ url, presentationStyle: 'popover' });
    },
    async close(): Promise<void> {
      await Browser.close();
    },
  };
}
/**
 * 沉浸式状态栏的原生实现（iOS）。
 *
 * 对应 Android `WindowCompat.getInsetsController(window, decorView)`
 * → `controller.hide(WindowInsetsCompat.Type.statusBars())` /
 * `show(statusBars())`（`ui/ReaderScreen.kt:709-726` 与
 * `ui/comic/ComicReaderCore.kt:400-423`）。
 *
 * Capacitor 的 `@capacitor/status-bar` 只有 `hide()` / `show()` 两个
 * 静态方法，没有「swipe 临时唤出」的 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`
 * 等价物（Android 漫画阅读器用的就是它）。因此这里用 `Animation.Fade`
 * 做最接近原生的过渡，瞬态唤出的差异属于插件能力边界，已登记于
 * `docs/PARITY_EXCEPTIONS.md`（见 E62）。
 *
 * ⚠️ 本文件只能由 `ios-native` 工厂调用（仅原生平台存在原生侧插件）。
 * Web 端由 `platform/capabilities.ts` 的 `createStatusBarPort()` 显式抛错，
 * 沉浸回退到 CSS `safe-area`。
 */
import { Animation, StatusBar } from '@capacitor/status-bar';
import type { StatusBarPort } from '@platform/interfaces';

export function createNativeStatusBarPort(): StatusBarPort {
  return {
    async setHidden(hidden: boolean): Promise<void> {
      if (hidden) {
        await StatusBar.hide({ animation: Animation.Fade });
      } else {
        await StatusBar.show({ animation: Animation.Fade });
      }
    },
  };
}

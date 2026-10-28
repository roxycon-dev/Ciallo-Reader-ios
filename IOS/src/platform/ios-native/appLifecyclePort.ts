/**
 * 应用前后台生命周期的原生实现（iOS）。
 *
 * 对应 Android `ProcessLifecycleOwner` + `LifecycleEventObserver`
 * —— `ui/ReadingTimerEffect.kt:91-107`：
 * ```kotlin
 * Lifecycle.Event.ON_START -> active = true
 * Lifecycle.Event.ON_STOP  -> { active = false; endCurrentSession() }
 * ```
 *
 * `@capacitor/app` 的 `appStateChange` 在 iOS 侧接
 * `UIApplication.willResignActiveNotification` / `didBecomeActiveNotification`
 * （见插件 definitions 注释），**覆盖** `document.visibilityState` 覆盖不到的
 * 原生前后台切换：控制中心下拉、来电、锁屏、切到别的 App 再回来。
 * 这正是 Kotlin 生命周期观察者的语义。
 *
 * ⚠️ 首次订阅时会立刻 `getState()` 派发一次当前状态，避免「已切后台后才 mount」
 * 的竞态导致漏掉一次 `ON_STOP`。
 */
import { App } from '@capacitor/app';
import type { AppLifecyclePort } from '@platform/interfaces';

export function createNativeAppLifecyclePort(): AppLifecyclePort {
  let current = true;
  const handlers = new Set<(foreground: boolean) => void>();

  const setForeground = (foreground: boolean): void => {
    if (current === foreground) return;
    current = foreground;
    for (const handler of handlers) handler(foreground);
  };

  return {
    isForeground(): boolean {
      return current;
    },
    subscribe(onChange: (foreground: boolean) => void): () => void {
      handlers.add(onChange);
      const handle = App.addListener('appStateChange', (state) => {
        setForeground(state.isActive);
      });
      // 同步一次当前状态（onChange 是同步签名，故只在 microtask 外直接调）。
      void App.getState().then((state) => {
        setForeground(state.isActive);
      });

      return (): void => {
        handlers.delete(onChange);
        void handle.then((h) => h.remove()).catch(() => {
          // 插件未注入时忽略（退订失败不应打断阅读计时）。
        });
      };
    },
  };
}
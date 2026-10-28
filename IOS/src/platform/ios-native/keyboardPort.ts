/**
 * 软键盘避让的原生实现（iOS）。
 *
 * 对应 Android `library/LibraryScreen.kt:626-632` 的
 * `.windowInsetsPadding(WindowInsets.imeAnimationTarget)`。
 *
 * 逐条对齐那段注释里的取舍：
 *  · Kotlin 刻意用 `imeAnimationTarget`（**动画目标值**）而不是 `ime`（逐帧插值），
 *    因为每帧重排才是"点搜索框弹键盘卡"的根因。
 *  · iOS 侧对应物正是 `@capacitor/keyboard` 的 **`keyboardWillShow` /
 *    `keyboardWillHide`** —— 事件在动画**开始前**触发、携带**最终高度**，
 *    语义上就是"目标值"，天然不是逐帧插值。**不订阅** `keyboardDidShow` /
 *    `keyboardDidHide`（那是动画结束后，晚了半拍）。
 *  · 因此：一次升降 = 恰好 2 次回调，与 `imeAnimationTarget` 相同。
 *
 * `setResizeMode('body')` 对应 `AndroidManifest.xml` 的
 * `android:windowSoftInputMode="adjustResize"`（那段注释明确点名 `adjustPan`
 * 的 OEM ROM 会盖住底部面板输入框），iOS 的等价物是 `KeyboardResize.Body`。
 */
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import type { KeyboardPort } from '@platform/interfaces';

/** 对应 `AndroidManifest.xml` 的 `windowSoftInputMode="adjustResize"`。 */
export const IOS_KEYBOARD_RESIZE_MODE = KeyboardResize.Body;

export function createNativeKeyboardPort(): KeyboardPort {
  const STATE = { visible: false, height: 0 };
  const handlers = new Set<(state: { visible: boolean; height: number }) => void>();

  const setState = (visible: boolean, height: number): void => {
    if (visible === STATE.visible && height === STATE.height) return;
    STATE.visible = visible;
    STATE.height = height;
    for (const handler of handlers) handler({ visible, height });
  };

  return {
    isVisible(): boolean {
      return STATE.visible;
    },
    height(): number {
      return STATE.height;
    },
    subscribe(onChange: (state: { visible: boolean; height: number }) => void): () => void {
      handlers.add(onChange);
      const willShow = Keyboard.addListener('keyboardWillShow', (info) => {
        // `keyboardHeight` 是 iOS 侧给出的最终高度（等价 imeAnimationTarget）。
        setState(true, Math.round(info.keyboardHeight));
      });
      const willHide = Keyboard.addListener('keyboardWillHide', () => {
        setState(false, 0);
      });

      return (): void => {
        handlers.delete(onChange);
        void willShow.then((h) => h.remove()).catch(() => {
          // 插件未注入时忽略（退订失败不应打断页面布局）。
        });
        void willHide.then((h) => h.remove()).catch(() => {
          // 同上。
        });
      };
    },
    async setResizeMode(mode: 'body' | 'native' | 'none'): Promise<void> {
      const mapped =
        mode === 'body'
          ? KeyboardResize.Body
          : mode === 'native'
            ? KeyboardResize.Native
            : KeyboardResize.None;
      await Keyboard.setResizeMode({ mode: mapped });
    },
  };
}
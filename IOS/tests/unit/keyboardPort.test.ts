/**
 * E67（`@capacitor/keyboard` 部分）—— 键盘避让端口。
 *
 * Android 权威：`library/LibraryScreen.kt:626-632`
 * ```kotlin
 * // ── 键盘避让：用 imeAnimationTarget（动画的**目标值**）而不是 ime（逐帧插值）──
 * // ime 在输入法升起/收起的 ~250ms 里逐帧变化，于是下方内容每帧都要重新测量与布局
 * // —— 这正是"点搜索框弹键盘卡"的根因：卡的不是玻璃，是每帧重排。
 * // 目标值只在动画开始/结束各变一次，**最终布局与 imePadding 完全一致**（视觉零差异）
 * .windowInsetsPadding(WindowInsets.imeAnimationTarget)
 * ```
 * 另有 `AndroidManifest.xml` 的 `android:windowSoftInputMode="adjustResize"`
 *（注释点名 `adjustPan` 的 OEM ROM 会盖住底部面板输入框）。
 *
 * 三条语义逐条锁定：
 *  1. **一次升降 = 恰好 2 次回调**（`willShow` / `willHide`），不订阅 `did*`；
 *  2. Web 端 `visualViewport` 的逐帧 `resize` 必须被**合并**成一次
 *     （`KEYBOARD_SETTLE_MS` 无新事件即视为动画结束），否则就退化成被Kotlin
 *     明确否决的逐帧重排；
 *  3. 能力缺失一律**显式抛错**（`setResizeMode` 在浏览器没有等价物），不静默成功。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_RESIZE_UNAVAILABLE,
  KEYBOARD_SETTLE_MS,
  createKeyboardPort,
} from '@platform/capabilities';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createNativeKeyboardPort（E67 原生实现）', () => {
  async function loadPort() {
    vi.resetModules();
    const addListener = vi.fn((event: string, listener: (info: unknown) => void) => {
      const handle = { remove: vi.fn(async () => {}) };
      listeners.set(event, { listener, handle });
      return Promise.resolve(handle);
    });
    const setResizeMode = vi.fn(async () => {});
    const listeners = new Map<
      string,
      { listener: (info: unknown) => void; handle: { remove: () => Promise<void> } }
    >();
    vi.doMock('@capacitor/keyboard', () => ({
      Keyboard: { addListener, setResizeMode },
      KeyboardResize: { Body: 'body', Native: 'native', None: 'none' },
    }));
    const mod = await import('@platform/ios-native/keyboardPort');
    return {
      port: mod.createNativeKeyboardPort(),
      listeners,
      addListener,
      setResizeMode,
      IOS_KEYBOARD_RESIZE_MODE: mod.IOS_KEYBOARD_RESIZE_MODE,
    };
  }

  it('订阅的是 will* 事件而非 did* —— 那才是「动画目标值」', async () => {
    const { port, addListener } = await loadPort();
    const off = port.subscribe(() => {});
    await vi.waitFor(() => expect(addListener).toHaveBeenCalledTimes(2));
    const events = addListener.mock.calls.map((c) => c[0]);
    expect(events).toContain('keyboardWillShow');
    expect(events).toContain('keyboardWillHide');
    // did* 是动画**结束后**（晚了半拍），订阅它就等于还原成逐帧/滞后值。
    expect(events).not.toContain('keyboardDidShow');
    expect(events).not.toContain('keyboardDidHide');
    off();
  });

  it('一次升降恰好 2 次回调（= imeAnimationTarget 只变 2 次）', async () => {
    const { port, listeners } = await loadPort();
    const seen: Array<{ visible: boolean; height: number }> = [];
    port.subscribe((state) => seen.push(state));

    await vi.waitFor(() => expect(listeners.has('keyboardWillShow')).toBe(true));
    // iOS 的 `keyboardWillShow` = `UIKeyboardWillShowNotification`，一次动画**只发一次**
    // 且携带**最终**高度；插件文档也说明 Android 上 `will` 与 `did` 几乎同时发。
    // 所以「一次升降 = 2 次回调」靠的是「只订阅 will*」而不是「在端口里做合并」。
    listeners.get('keyboardWillShow')!.listener({ keyboardHeight: 336 });
    expect(seen).toEqual([{ visible: true, height: 336 }]);
    expect(port.isVisible()).toBe(true);
    expect(port.height()).toBe(336);

    listeners.get('keyboardWillHide')!.listener(undefined);
    expect(seen).toEqual([
      { visible: true, height: 336 },
      { visible: false, height: 0 },
    ]);
    expect(port.height()).toBe(0);
  });

  it('重复的相同通知被去重（原生偶发重复投递时不触发多余重排）', async () => {
    const { port, listeners } = await loadPort();
    const seen: Array<{ visible: boolean; height: number }> = [];
    port.subscribe((state) => seen.push(state));
    await vi.waitFor(() => expect(listeners.has('keyboardWillShow')).toBe(true));

    for (let i = 0; i < 3; i += 1) {
      listeners.get('keyboardWillShow')!.listener({ keyboardHeight: 300 });
    }
    expect(seen).toEqual([{ visible: true, height: 300 }]);
  });

  it('退订后不再派发（对应 removeObserver）', async () => {
    const { port, listeners } = await loadPort();
    const seen: unknown[] = [];
    const off = port.subscribe((state) => seen.push(state));
    await vi.waitFor(() => expect(listeners.has('keyboardWillShow')).toBe(true));
    listeners.get('keyboardWillShow')!.listener({ keyboardHeight: 300 });
    expect(seen).toHaveLength(1);
    off();
    listeners.get('keyboardWillShow')!.listener({ keyboardHeight: 100 });
    expect(seen).toHaveLength(1);
  });

  it('setResizeMode("body") → KeyboardResize.Body（= adjustResize）', async () => {
    const { port, setResizeMode, IOS_KEYBOARD_RESIZE_MODE } = await loadPort();
    await port.setResizeMode('body');
    expect(setResizeMode).toHaveBeenCalledWith({ mode: 'body' });
    expect(IOS_KEYBOARD_RESIZE_MODE).toBe('body');
    await port.setResizeMode('none');
    expect(setResizeMode).toHaveBeenLastCalledWith({ mode: 'none' });
  });
});

describe('createKeyboardPort（E67 Web 实现）', () => {
  /** 装一个可控的 `window.visualViewport` 桩。 */
  function stubViewport(initial: { height: number; offsetTop: number }): {
    fire: (next: { height: number; offsetTop: number }) => void;
  } {
    const listeners = new Map<string, Array<() => void>>();
    const vv = {
      height: initial.height,
      offsetTop: initial.offsetTop,
      addEventListener: (type: string, fn: () => void) => {
        const arr = listeners.get(type) ?? [];
        arr.push(fn);
        listeners.set(type, arr);
      },
      removeEventListener: (type: string, fn: () => void) => {
        const arr = listeners.get(type) ?? [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
    };
    vi.stubGlobal('window', { innerHeight: 800, visualViewport: vv });
    return {
      fire: (next) => {
        vv.height = next.height;
        vv.offsetTop = next.offsetTop;
        for (const fn of listeners.get('resize') ?? []) fn();
      },
    };
  }

  it('无 visualViewport → 高度 0（桌面浏览器无软键盘，属真实语义差异）', () => {
    vi.stubGlobal('window', { innerHeight: 800 });
    const port = createKeyboardPort();
    const seen: Array<{ visible: boolean; height: number }> = [];
    port.subscribe((s) => seen.push(s));
    expect(port.height()).toBe(0);
    expect(port.isVisible()).toBe(false);
    expect(seen).toEqual([{ visible: false, height: 0 }]);
  });

  it('逐帧 resize 被合并成 1 次派发（这正是 Kotlin 拒绝 ime 的原因）', async () => {
    vi.useFakeTimers();
    const { fire } = stubViewport({ height: 800, offsetTop: 0 });
    const port = createKeyboardPort();
    const seen: Array<{ visible: boolean; height: number }> = [];
    port.subscribe((s) => seen.push(s));

    // 模拟一次 250ms 键盘动画里的逐帧插值（800 → 540 共 6 帧）。
    for (const h of [760, 700, 640, 590, 560, 540]) {
      fire({ height: h, offsetTop: 0 });
      vi.advanceTimersByTime(16);
    }
    // 一个 settle 窗口内还没派发 —— 这就是「不逐帧重排」。
    expect(seen).toEqual([{ visible: false, height: 0 }]);

    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS);
    expect(seen).toEqual([
      { visible: false, height: 0 },
      { visible: true, height: 260 },
    ]);
    expect(port.height()).toBe(260);
  });

  it('键盘收起（视口回到全高）→ 高度 0', async () => {
    vi.useFakeTimers();
    const { fire } = stubViewport({ height: 540, offsetTop: 0 });
    const port = createKeyboardPort();
    const seen: Array<{ visible: boolean; height: number }> = [];
    port.subscribe((s) => seen.push(s));
    fire({ height: 800, offsetTop: 0 });
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS);
    expect(seen[seen.length - 1]).toEqual({ visible: false, height: 0 });
  });

  it('visualViewport.offsetTop 也计入遮挡高度（Safari 的地址栏收缩）', async () => {
    vi.useFakeTimers();
    const { fire } = stubViewport({ height: 800, offsetTop: 0 });
    const port = createKeyboardPort();
    port.subscribe(() => {});
    fire({ height: 700, offsetTop: 50 });
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS);
    // 800 − 700 − 50 = 50
    expect(port.height()).toBe(50);
  });

  it('setResizeMode 在浏览器显式抛错（不静默假装成功）', async () => {
    const port = createKeyboardPort();
    await expect(port.setResizeMode('body')).rejects.toThrow(KEYBOARD_RESIZE_UNAVAILABLE);
  });
});
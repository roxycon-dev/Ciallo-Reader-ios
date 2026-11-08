/**
 * E67（`@capacitor/app` 部分） —— 应用前后台生命周期端口。
 *
 * Android 权威：`ui/ReadingTimerEffect.kt:91-107`
 * ```kotlin
 * DisposableEffect(lifecycleOwner) {
 *     val observer = LifecycleEventObserver { _, event ->
 *         when (event) {
 *             Lifecycle.Event.ON_START -> active = true
 *             Lifecycle.Event.ON_STOP  -> { active = false; endCurrentSession() }
 *             else -> {}
 *         }
 *     }
 *     lifecycleOwner.lifecycle.addObserver(observer)
 *     onDispose { lifecycleOwner.lifecycle.removeObserver(observer); endCurrentSession() }
 * }
 * ```
 *
 * 三条语义逐条锁定：
 *  1. `subscribe` 派发 `true` = 前台（ON_START）、`false` = 后台（ON_STOP）；
 *  2. Web 实现基于 `visibilitychange`，且最后一个订阅者退订后要摘掉监听（无泄漏）；
 *  3. 原生实现基于 `@capacitor/app` 的 `appStateChange`，并在订阅时先
 *     `getState()` 补一次当前状态（避免「已切后台后才 mount」漏掉一次 ON_STOP）。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('createAppLifecyclePort（E67，Web 实现）', () => {
  let listeners: Array<() => void>;

  beforeEach(() => {
    listeners = [];
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    const origAdd = document.addEventListener.bind(document);
    const origRemove = document.removeEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation(((
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      if (type === 'visibilitychange') {
        listeners.push(fn as () => void);
        return;
      }
      (origAdd as (t: string, f: unknown) => void)(type, fn);
    }) as typeof document.addEventListener);
    vi.spyOn(document, 'removeEventListener').mockImplementation(((
      type: string,
      fn: EventListenerOrEventListenerObject,
    ) => {
      if (type === 'visibilitychange') {
        const i = listeners.indexOf(fn as () => void);
        if (i >= 0) listeners.splice(i, 1);
        return;
      }
      (origRemove as (t: string, f: unknown) => void)(type, fn);
    }) as typeof document.removeEventListener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setVisible = (value: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    for (const fn of [...listeners]) fn();
  };

  it('subscribe 派发 true(前台)/false(后台)，与 ON_START/ON_STOP 一致', async () => {
    const { createAppLifecyclePort } = await import('@platform/capabilities');
    const port = createAppLifecyclePort();
    const seen: boolean[] = [];
    const off = port.subscribe((fg) => seen.push(fg));

    setVisible('hidden');
    setVisible('visible');
    setVisible('hidden');

    expect(seen).toEqual([false, true, false]);
    off();
  });

  it('isForeground 跟随 visibilityState（无 document 时默认 true）', async () => {
    const { createAppLifecyclePort } = await import('@platform/capabilities');
    const port = createAppLifecyclePort();
    expect(port.isForeground()).toBe(true);
    setVisible('hidden');
    expect(port.isForeground()).toBe(false);
  });

  it('最后一个订阅者退订后摘掉 visibilitychange 监听（无泄漏）', async () => {
    const { createAppLifecyclePort } = await import('@platform/capabilities');
    const port = createAppLifecyclePort();
    const offA = port.subscribe(() => {});
    const offB = port.subscribe(() => {});
    expect(listeners.length).toBe(1); // 多个订阅者共用一个 DOM 监听
    offA();
    expect(listeners.length).toBe(1); // 还有 B，未到 0
    offB();
    expect(listeners.length).toBe(0);
  });
});

describe('createNativeAppLifecyclePort（E67，原生实现）', () => {
  const listeners: Array<(state: { isActive: boolean }) => void> = [];
  const remove = vi.fn();
  const getState = vi.fn().mockResolvedValue({ isActive: true });

  beforeEach(() => {
    listeners.length = 0;
    remove.mockClear();
    getState.mockClear();
    getState.mockResolvedValue({ isActive: true });
  });

  it('appStateChange 派发前后台；getState 在订阅时补一次当前状态', async () => {
    vi.doMock('@capacitor/app', () => ({
      App: {
        addListener: (_e: string, fn: (state: { isActive: boolean }) => void) => {
          listeners.push(fn);
          return Promise.resolve({ remove });
        },
        getState,
      },
    }));
    const { createNativeAppLifecyclePort } = await import('@platform/ios-native/appLifecyclePort');
    const port = createNativeAppLifecyclePort();

    const seen: boolean[] = [];
    const off = port.subscribe((fg) => seen.push(fg));

    expect(listeners.length).toBe(1);
    // getState 的初始状态补发（isActive=true，与初值一致 → 不重复派发）
    await Promise.resolve();
    await Promise.resolve();
    expect(getState).toHaveBeenCalled();
    expect(seen).toEqual([]);

    listeners[0]?.({ isActive: false });
    listeners[0]?.({ isActive: true });
    expect(seen).toEqual([false, true]);
    expect(port.isForeground()).toBe(true);

    off();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
    vi.doUnmock('@capacitor/app');
  });

  it('挂载时已在后台（getState=false）→ isForeground 为 false，不沿用 active=true 初值', async () => {
    getState.mockResolvedValue({ isActive: false });
    vi.doMock('@capacitor/app', () => ({
      App: {
        addListener: (_e: string, fn: (state: { isActive: boolean }) => void) => {
          listeners.push(fn);
          return Promise.resolve({ remove });
        },
        getState,
      },
    }));
    const { createNativeAppLifecyclePort } = await import('@platform/ios-native/appLifecyclePort');
    const port = createNativeAppLifecyclePort();
    const seen: boolean[] = [];
    port.subscribe((fg) => seen.push(fg));
    await Promise.resolve();
    await Promise.resolve();
    expect(port.isForeground()).toBe(false);
    // 关键：挂载即已在后台时，必须把 false 派发出去，否则新订阅者会误以为在前台
    // 而继续累计（正是 Kotlin `active = true` 初值在「组合晚于 ON_START」时的坑）。
    expect(seen).toEqual([false]);
    vi.doUnmock('@capacitor/app');
  });
});

describe('PlatformBundle 含 appLifecycle（E67 装配）', () => {
  it('web-mock 工厂装配了 appLifecycle 且为完整实现', async () => {
    const { createWebMockPlatform } = await import('@platform/web-mock');
    const platform = createWebMockPlatform();
    expect(platform.appLifecycle).toBeDefined();
    expect(typeof platform.appLifecycle.isForeground).toBe('function');
    expect(typeof platform.appLifecycle.subscribe).toBe('function');
  });
});
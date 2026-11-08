/**
 * E67（`@capacitor/network` 部分） —— 网络类型端口 + 「仅 Wi-Fi 预加载」闸门。
 *
 * Android 权威：`ui/comic/ComicPageLoader.kt:696-703`
 * ```kotlin
 * private fun wifiConnectedOrUnmetered(): Boolean {
 *     val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
 *     val net = cm.activeNetwork ?: return false
 *     val caps = cm.getNetworkCapabilities(net) ?: return true
 *     return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
 *         caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
 * }
 * ```
 * 消费点 Kotlin L719-722：`preloadWifiOnly && !wifiConnectedOrUnmetered()`
 * → 过滤掉「非可见 + 在线页」的预载条目（本地页与当前页不受影响）。
 *
 * 三条语义逐条锁定：
 *  1. `wifi` 放行、`cellular` 拦截、`connected === false` 拦截；
 *  2. 插件抛错 → 放行（Kotlin `cm == null → return true` 的兜底，不静默卡阅读）；
 *  3. Web 端无 `navigator.connection` 时同样放行（探测不到 ≠ 计费）。
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

const getStatus = vi.fn();

afterEach(() => {
  getStatus.mockReset();
  vi.doUnmock('@capacitor/network');
});

describe('createNativeNetworkPort（E67，原生实现）', () => {
  it('wifi → 放行；cellular → 拦截（iOS 无「不计费」公开标志，cellular 视为计费）', async () => {
    vi.doMock('@capacitor/network', () => ({ Network: { getStatus } }));
    const { createNativeNetworkPort } = await import('@platform/ios-native/networkPort');
    const port = createNativeNetworkPort();

    getStatus.mockResolvedValue({ connected: true, connectionType: 'wifi' });
    expect(await port.wifiConnectedOrUnmetered()).toBe(true);

    getStatus.mockResolvedValue({ connected: true, connectionType: 'cellular' });
    expect(await port.wifiConnectedOrUnmetered()).toBe(false);
  });

  it('connected === false → 拦截（Kotlin `activeNetwork ?: return false`）', async () => {
    vi.doMock('@capacitor/network', () => ({ Network: { getStatus } }));
    const { createNativeNetworkPort } = await import('@platform/ios-native/networkPort');
    getStatus.mockResolvedValue({ connected: false, connectionType: 'none' });
    expect(await createNativeNetworkPort().wifiConnectedOrUnmetered()).toBe(false);
  });

  it('插件抛错 → 放行 true（Kotlin `cm == null → return true`，不静默卡住阅读）', async () => {
    vi.doMock('@capacitor/network', () => ({ Network: { getStatus } }));
    const { createNativeNetworkPort } = await import('@platform/ios-native/networkPort');
    getStatus.mockRejectedValue(new Error('no native bridge'));
    expect(await createNativeNetworkPort().wifiConnectedOrUnmetered()).toBe(true);
  });

  it("connectionType === 'unknown' → 拦截（拿不到能力信息 ≠ 不计费）", async () => {
    vi.doMock('@capacitor/network', () => ({ Network: { getStatus } }));
    const { createNativeNetworkPort } = await import('@platform/ios-native/networkPort');
    getStatus.mockResolvedValue({ connected: true, connectionType: 'unknown' });
    expect(await createNativeNetworkPort().wifiConnectedOrUnmetered()).toBe(false);
  });
});

describe('createNetworkPort（E67，Web 实现）', () => {
  const setConn = (value: unknown): void => {
    if (value === undefined) {
      delete (navigator as unknown as { connection?: unknown }).connection;
    } else {
      Object.defineProperty(navigator, 'connection', { value, configurable: true });
    }
  };

  it('effectiveType wifi/4g → 放行；3g/2g/slow-2g → 拦截', async () => {
    const { createNetworkPort } = await import('@platform/capabilities');
    const port = createNetworkPort();
    for (const good of ['wifi', '4g']) {
      setConn({ effectiveType: good });
      expect(await port.wifiConnectedOrUnmetered()).toBe(true);
    }
    for (const bad of ['3g', '2g', 'slow-2g']) {
      setConn({ effectiveType: bad });
      expect(await port.wifiConnectedOrUnmetered()).toBe(false);
    }
    setConn(undefined);
  });

  it('无 navigator.connection → 放行 true（探测不到 ≠ 计费）', async () => {
    const { createNetworkPort } = await import('@platform/capabilities');
    setConn(undefined);
    expect(await createNetworkPort().wifiConnectedOrUnmetered()).toBe(true);
  });
});

describe('PlatformBundle 含 network（E67 装配）', () => {
  it('web-mock 工厂装配了 network 且接口完整', async () => {
    const { createWebMockPlatform } = await import('@platform/web-mock');
    const platform = createWebMockPlatform();
    expect(platform.network).toBeDefined();
    expect(typeof platform.network.wifiConnectedOrUnmetered).toBe('function');
  });
});

describe('ComicReaderPage 的「仅 Wi-Fi 预加载」闸门（E67 接线）', () => {
  it('preloadWindow 按 Kotlin L719-722 过滤「非可见 + 在线页」', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pathMod = await import('node:path');
    const repoRoot = pathMod.resolve(
      pathMod.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
    );
    const source = readFileSync(
      pathMod.join(repoRoot, 'src/ui/pages/ComicReaderPage.tsx'),
      'utf8',
    );
    // 过滤条件必须同时含 visible 与 REMOTE（本地页与当前页不受影响）。
    expect(source).toMatch(/!entry\.visible\s*&&\s*entry\.ref\.kind === 'REMOTE'/);
    // 闸门读的是注入端口，不是裸 DOM API。
    expect(source).toMatch(/platform|network/);
    expect(source).toMatch(/wifiConnectedOrUnmetered\(\)/);
  });
});
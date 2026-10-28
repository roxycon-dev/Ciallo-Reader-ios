/**
 * E67（`@capacitor/device` + `@capacitor/browser` + 自写方向锁插件）——
 * 设备信息 / 外部浏览器 / 屏幕方向锁三个端口。
 *
 * Android 权威：
 *  · `MainActivity.kt:398-405` `DisposableEffect(orientationLock) { requestedOrientation =
 *    when (orientationLock) { 1 -> SCREEN_ORIENTATION_PORTRAIT; 2 -> SCREEN_ORIENTATION_LANDSCAPE;
 *    else -> SCREEN_ORIENTATION_UNSPECIFIED } }`
 *  · `Intent(ACTION_VIEW, Uri.parse(url))` + `startActivity` ——
 *    `library/LibraryLoginDialog.kt:246`、`source/ZLibraryLoginDialog.kt:328`、
 *    `LocalUriHandler.openUri`（GitHub 发布页/ 项目主页）。
 *  · `android.os.Build`（`SDK_INT` / `MODEL` / `MANUFACTURER` / `VERSION.RELEASE`）——
 *    `AppUpdateDownload.kt:131/137/147/152`、`AppUpdateInstaller.kt:20/24`、
 *    `Motion.kt:140/157`、`ui/components/LiquidGlass.kt:69`。
 *
 * 语义逐条锁定：
 *  1. 方向锁三个分支必须**逐条**映射（0 跟随系统 / 1 竖屏 / 2 横屏）；
 *  2. 外部浏览器被拦截时**显式抛错**，绝不像原来那样静默返回 null；
 *  3. `osVersionCode` 在 Web 侧必须是 0（未知），**不得**拿它当门槛 ——
 *     Android 的 `SDK_INT` 与 iOS 版本号是两条不同刻度。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_BROWSER_UNAVAILABLE,
  ORIENTATION_LOCK_UNAVAILABLE,
  createDevicePort,
  createExternalBrowserPort,
  createOrientationLockPort,
} from '@platform/capabilities';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('createNativeDevicePort（E67 原生实现）', () => {
  it('逐字段映射 @capacitor/device 的 getInfo()', async () => {
    const getInfo = vi.fn(async () => ({
      name: 'Ciallo 的 iPhone',
      model: 'iPhone17,1',
      platform: 'ios',
      operatingSystem: 'ios',
      osVersion: '16.3.1',
      iOSVersion: 160301,
      manufacturer: 'Apple',
      isVirtual: false,
      webViewVersion: '16.3',
    }));
    vi.doMock('@capacitor/device', () => ({ Device: { getInfo } }));
    const { createNativeDevicePort } = await import('@platform/ios-native/devicePort');

    expect(await createNativeDevicePort().info()).toEqual({
      model: 'iPhone17,1',
      manufacturer: 'Apple',
      osVersion: '16.3.1',
      osVersionCode: 160301,
      platform: 'ios',
      isVirtual: false,
    });
  });

  it('iOSVersion 缺失 → osVersionCode 0（= 未知，调用方必须显式处理）', async () => {
    vi.doMock('@capacitor/device', () => ({
      Device: {
        getInfo: async () => ({
          model: 'iPad',
          platform: 'ios',
          osVersion: '17.0',
          manufacturer: 'Apple',
          isVirtual: true,
        }),
      },
    }));
    const { createNativeDevicePort } = await import('@platform/ios-native/devicePort');
    const info = await createNativeDevicePort().info();
    expect(info.osVersionCode).toBe(0);
    // 模拟器标记必须透传（Android 侧靠 `Build.FINGERPRINT` 判generic/sdk）。
    expect(info.isVirtual).toBe(true);
  });
});

describe('createDevicePort（E67 Web 实现）', () => {
  it('iOS UA → platform ios；osVersionCode 恒0（未知）', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X)' });
    const info = await createDevicePort().info();
    expect(info.platform).toBe('ios');
    expect(info.osVersionCode).toBe(0);
    expect(info.osVersion).toBe('');
  });

  it('无 navigator（SSR / 非浏览器）也不抛错，返回空 UA', async () => {
    vi.stubGlobal('navigator', undefined);
    const info = await createDevicePort().info();
    expect(info.model).toBe('');
    expect(info.platform).toBe('web');
  });

  it('userAgentData 优先于 UA 解析', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'whatever',
      userAgentData: { platform: 'macOS', mobile: false },
    });
    expect((await createDevicePort().info()).platform).toBe('macOS');
  });
});

describe('createNativeExternalBrowserPort（E67 原生实现）', () => {
  it('用 popover 呈现（iPad 多任务下 fullscreen 会被系统降级）', async () => {
    const open = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    vi.doMock('@capacitor/browser', () => ({ Browser: { open, close } }));
    const { createNativeExternalBrowserPort } = await import('@platform/ios-native/browserPort');
    const port = createNativeExternalBrowserPort();

    await port.open('https://example.com/registration');
    expect(open).toHaveBeenCalledWith({
      url: 'https://example.com/registration',
      presentationStyle: 'popover',
    });

    await port.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('插件抛错时**不吞**（调用方要 toast「无法打开注册页面」）', async () => {
    vi.doMock('@capacitor/browser', () => ({
      Browser: { open: async () => { throw new Error('present failed'); } },
    }));
    const { createNativeExternalBrowserPort } = await import('@platform/ios-native/browserPort');
    await expect(createNativeExternalBrowserPort().open('https://x')).rejects.toThrow(
      'present failed',
    );
  });
});

describe('createExternalBrowserPort（E67 Web 实现）', () => {
  it('window.open 返回 Window → 成功', async () => {
    const win = {};
    const openSpy = vi.fn(() => win);
    vi.stubGlobal('window', { open: openSpy });
    await expect(createExternalBrowserPort().open('https://x')).resolves.toBeUndefined();
    expect(openSpy).toHaveBeenCalledWith('https://x', '_blank', 'noopener,noreferrer');
  });

  it('window.open 返回 null（被拦截）→ 显式抛错（原实现在这里是静默失败）', async () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });
    await expect(createExternalBrowserPort().open('https://x')).rejects.toThrow(
      EXTERNAL_BROWSER_UNAVAILABLE,
    );
  });

  it('无 window 环境 → 显式抛错', async () => {
    vi.stubGlobal('window', undefined);
    await expect(createExternalBrowserPort().open('https://x')).rejects.toThrow(
      EXTERNAL_BROWSER_UNAVAILABLE,
    );
  });
});

describe('createOrientationLockPort（E67 Web 实现）', () => {
  it('mode 0 → unlock（= SCREEN_ORIENTATION_UNSPECIFIED）', async () => {
    const unlock = vi.fn(async () => {});
    vi.stubGlobal('screen', { orientation: { lock: vi.fn(), unlock } });
    await createOrientationLockPort().setLock(0);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('mode 0 且无 API 时也不抛（"跟随系统"是天然的空操作）', async () => {
    vi.stubGlobal('screen', {});
    await expect(createOrientationLockPort().setLock(0)).resolves.toBeUndefined();
  });

  it('mode 1 → portrait-primary；mode 2 → landscape-primary', async () => {
    const lock = vi.fn(async () => {});
    vi.stubGlobal('screen', { orientation: { lock, unlock: vi.fn() } });
    const port = createOrientationLockPort();
    await port.setLock(1);
    expect(lock).toHaveBeenLastCalledWith('portrait-primary');
    await port.setLock(2);
    expect(lock).toHaveBeenLastCalledWith('landscape-primary');
  });

  it('锁定能力缺失 → 显式抛错（不静默假装成功）', async () => {
    vi.stubGlobal('screen', { orientation: {} });
    await expect(createOrientationLockPort().setLock(1)).rejects.toThrow(
      ORIENTATION_LOCK_UNAVAILABLE,
    );
  });
});

describe('createNativeOrientationLockPort（E67 原生实现）', () => {
  it('逐条透传 0 / 1 / 2 给原生插件（不自行做任何映射）', async () => {
    const lock = vi.fn(async () => {});
    const core = await import('@capacitor/core');
    const spy = vi.spyOn(core, 'registerPlugin').mockReturnValue({ lock } as never);
    const { createNativeOrientationLockPort } = await import(
      '@platform/ios-native/orientationPort'
    );
    const port = createNativeOrientationLockPort();
    for (const mode of [0, 1, 2] as const) {
      await port.setLock(mode);
      expect(lock).toHaveBeenLastCalledWith({ mode });
    }
    spy.mockRestore();
  });

  it('插件未绑定 → 显式抛错（tts 插件同款处理）', async () => {
    vi.doMock('@capacitor/core', () => {
      throw new Error('no capacitor');
    });
    const { createNativeOrientationLockPort } = await import(
      '@platform/ios-native/orientationPort'
    );
    await expect(createNativeOrientationLockPort().setLock(1)).rejects.toThrow(
      'orientation plugin not bound',
    );
  });
});
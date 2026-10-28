/**
 * 屏幕方向锁的原生实现（iOS）—— 自写 Capacitor 插件 `OrientationPlugin`
 * （Swift 源在 `ios/App/App/Plugins/OrientationPlugin.swift`）。
 *
 * 对应 Android `MainActivity.kt:398-405`：
 * ```kotlin
 * DisposableEffect(orientationLock) {
 *     requestedOrientation = when (orientationLock) {
 *         1 -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
 *         2 -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
 *         else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
 *     }
 *     onDispose {}
 * }
 * ```
 *
 * 三个分支逐条保留：0 → 跟随系统（UNSPECIFIED）/ 1 → 竖屏 / 2 → 横屏。
 *
 * ⚠️ **为什么不用 `@capacitor/device`**：它只有 `getInfo()`（型号/系统版本），
 * 没有任何方向控制能力。iOS 也没有等价于 `Activity.requestedOrientation` 的
 * 公开 API，必须用 `UIWindowScene.requestGeometryUpdate`（iOS 16+）——
 * 见 Swift 插件里的说明。
 */
import type { OrientationLockPort } from '@platform/interfaces';

interface OrientationPluginLike {
  lock(options: { mode: number }): Promise<void>;
  getLock(): Promise<{ mode?: number }>;
}

const ORIENTATION_PLUGIN_ERROR = 'orientation plugin not bound';

async function loadOrientationPlugin(): Promise<OrientationPluginLike> {
  try {
    const mod = (await import('@capacitor/core')) as unknown as {
      registerPlugin?: <T>(name: string) => T;
    };
    const register = mod.registerPlugin;
    if (!register) {
      throw new Error('missing registerPlugin export');
    }
    return register<OrientationPluginLike>('Orientation');
  } catch {
    throw new Error(ORIENTATION_PLUGIN_ERROR);
  }
}

export function createNativeOrientationLockPort(): OrientationLockPort {
  return {
    async setLock(mode: 0 | 1 | 2): Promise<void> {
      const plugin = await loadOrientationPlugin();
      await plugin.lock({ mode });
    },
  };
}
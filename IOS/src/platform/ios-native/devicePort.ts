/**
 * 设备信息的原生实现（iOS）—— `@capacitor/device` 的 `getInfo()`。
 *
 * 对应 Android `android.os.Build` 的一组分散用法：
 *  · `AppUpdateDownload.kt:131/137/147/152` —— `SDK_INT >= 28` 决定用
 *    `signingInfo` 还是 `signatures`，`>= 26` 决定能否装APK；
 *  · `AppUpdateInstaller.kt:20/24` —— `>= 26` 的未知来源安装开关；
 *  · `Motion.kt:140/157` —— `>= O` 用 `VibrationEffect`、�� S` 用新触感常量；
 *  · `ui/components/LiquidGlass.kt:69` —— `>= S` 才开实时模糊；
 *  · `ui/reader/NovelImageFullscreen.kt:182` —— `>= Q`。
 *
 * ⚠️ **不做跨平台刻度搬运**：Android 的 `SDK_INT` 是 API level（1..36），
 * iOS 是版本号（8.0..26.x），两条刻度不可比。这里的做法是把两者都摆出来：
 * `osVersion` 给原始串，`osVersionCode` 给 `@capacitor/device` 压平的整数
 * （`"16.3.1"` → `160301`），让调用方能按iOS 自己的刻度做门槛判断。
 * 谁要写 `>= 26` 这类判断，必须先确认刻度来源不同，否则就是拿 API level
 * 去比 iOS 版本号 —— 那是跨端移植最常见的静默错误。
 */
import { Device } from '@capacitor/device';
import type { DevicePort } from '@platform/interfaces';

export function createNativeDevicePort(): DevicePort {
  return {
    async info(): Promise<{
      model: string;
      manufacturer: string;
      osVersion: string;
      osVersionCode: number;
      platform: string;
      isVirtual: boolean;
    }> {
      const info = await Device.getInfo();
      return {
        // Android `Build.MODEL` → iOS `utsname.machine`（如 "iPhone17,1"）。
        model: info.model,
        // Android `Build.MANUFACTURER` → iOS 恒为 "Apple"，`getInfo` 也会这么给。
        manufacturer: info.manufacturer,
        // Android `Build.VERSION.RELEASE`（"14"）→ iOS `UIDevice.systemVersion`（"16.3.1"）。
        osVersion: info.osVersion,
        // `getInfo()` 已把多段版本压成两位补零的整数（"16.3.1" → 160301）。
        // 该字段仅 iOS 有；缺失时给 0 = "未知"，调用方必须显式处理。
        osVersionCode: info.iOSVersion ?? 0,
        platform: info.platform,
        // Android `Build.FINGERPRINT` 含 "generic"/"sdk" 用来判模拟器。
        isVirtual: info.isVirtual,
      };
    },
  };
}
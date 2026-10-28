/**
 * 平台 HapticsPort 的原生实现（iOS）。
 *
 * 对应 Android `Vibrator.vibrate(millis, amplitude)`（`ui/feedback/Motion.kt` 的
 * `HapticKind` 分级表）。
 *
 * Capacitor 的 `@capacitor/haptics` 不接收 (millis, amplitude)（`UIImpactFeedbackGenerator`
 * 只看 style），故 `impact(millis)` 按时长分桶到 `ImpactStyle`；触发成功返回 `true`，
 * 插件未注入/异常时返回 `false`（与 Web 端 `navigator.vibrate` 在 iOS 上返回 `false` 一致）。
 *
 * ⚠️ 本文件只能由 `ios-native` 工厂调用（仅原生平台存在原生侧插件）。Web 端由
 * `platform/capabilities.ts` 的 `createHapticsPort()` 走 `navigator.vibrate`。
 */
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { HapticsPort } from '@platform/interfaces';

export function createNativeHapticsPort(): HapticsPort {
  return {
    impact(millis: number): boolean {
      try {
        const style: ImpactStyle =
          millis <= 10 ? ImpactStyle.Light : millis <= 20 ? ImpactStyle.Medium : ImpactStyle.Heavy;
        // `Haptics.impact` 返回 Promise，`impact(millis): boolean` 是同步签名，无法 await
        // 异步 reject —— 故乐观返回 true，并把 reject 吞掉（避免 unhandled rejection）。
        // 仅当插件本身未注入（同步抛 TypeError）时走到 catch 返回 false。
        void Haptics.impact({ style }).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
  };
}

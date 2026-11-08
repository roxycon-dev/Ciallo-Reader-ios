import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  AppHaptics,
  AppMotion,
  HAPTIC_TABLE,
  HapticsGate,
  REDUCED_MOTION_SCALE_EPSILON,
  easeOutCubic,
  easeSuckIn,
  springDefault,
  springJelly,
  springLift,
  springReturn,
  springSettle,
  springSettleMs,
  springStiff,
  springTilt,
  systemReduceMotion,
  type HapticKind,
} from '../../../core/glass/motion';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/feedback/Motion.kt` (177 non-blank lines)
 *   lines 22-85   `object AppMotion`                        → core AppMotion
 *   line  88      `val LocalReduceMotion`                   → MotionContext.reduceMotion
 *   line  91      `val LocalHapticsEnabled`                 → MotionContext.hapticsEnabled
 *   lines 101-103 `object HapticsGate`                      → core HapticsGate
 *   lines 107-113 `object MutingHapticFeedback`             → no-op haptic impl
 *   line  116      `enum class HapticKind`                  → core HapticKind
 *   lines 123-166 `class AppHaptics`                        → core AppHaptics
 *   lines 169-174 `rememberAppHaptics()`                    → useAppHaptics()
 *   lines 188-205 `systemReduceMotion()`                    → core systemReduceMotion()
 *   line  216      `REDUCED_MOTION_SCALE_EPSILON`           → core constant
 *   lines 220-230 `@Composable ProvideMotion(reduceMotion, hapticsEnabled, content)`
 *                                                              → MotionProvider
 *
 * ADAPTATION — `Settings.Global` animator scales → `prefers-reduced-motion`
 * ────────────────────────────────────────────────────────────────
 * See the long note in `core/glass/motion.ts`: the media query only ever reports
 * full-on / full-off, so the documented "0.5x is NOT reduce-motion" carve-out has
 * no web counterpart; the boolean is preserved exactly.
 *
 * `Vibrator.vibrate(millis, amplitude)` → the injected backend. The project already
 * depends on `@capacitor/haptics`; the `(millis, amplitude)` table is preserved in
 * `HAPTIC_TABLE` so any backend can be driven from the same numbers, and
 * `hapticsEnabled`/`HapticsGate.enabled` keep the "settings can turn it off" and
 * "process-level mirror" semantics.
 */

export {
  AppHaptics,
  AppMotion,
  HAPTIC_TABLE,
  HapticsGate,
  REDUCED_MOTION_SCALE_EPSILON,
  easeOutCubic,
  easeSuckIn,
  springDefault,
  springJelly,
  springLift,
  springReturn,
  springSettle,
  springSettleMs,
  springStiff,
  springTilt,
  systemReduceMotion,
};
export type { HapticKind };
export { OVERLAY_ENTRANCE } from '../../../core/glass/motion';

/**
 * `MutingHapticFeedback` — 触觉总开关关闭时所有 Compose 侧震动静默。
 * On the web this is simply the backend never being invoked; the helper exists so
 * a subtree can be given a silent backend explicitly.
 */
export function mutingHapticsImpl(): void {
  // 故意什么都不做
}

/**
 * E65 —— 真实触觉后端（替代原 `mutingHapticsImpl` 静默 no-op）。
 *
 * Kotlin `AppHaptics.perform(kind)` 的分级语义（见 `core/glass/motion.ts` 的 HAPTIC_TABLE）：
 * `SELECTION` 轻 tick、`LIGHT`/`MEDIUM`/`HEAVY` 碰撞强度、`SUCCESS` 完成提示。
 * Capacitor 的 `@capacitor/haptics` 用 `Haptics.impact({ style })` / `notification()` /
 * `selectionChanged()` 表达；iOS 侧不接收 (millis, amplitude)（UIImpactFeedbackGenerator
 * 只看 style），故此处按 `kind` 语义映射，忽略 millis/amplitude（已知平台边界，登记于 E28/E47）。
 *
 * Web（非原生）回退到 `navigator.vibrate(millis)`：Android Chromium 可实现，iOS Safari/WKWebView
 * 从不实现 Vibration API → 静默无触感（E28/E47 已登记，属文档化差异，不报错误）。
 */
function createNativeHapticsBackend(): HapticBackend {
  const isNative = Capacitor.isNativePlatform();
  return (kind: HapticKind, millis: number, _amplitude: number): void => {
    if (isNative) {
      try {
        switch (kind) {
          case 'SELECTION':
            void Haptics.selectionChanged();
            break;
          case 'LIGHT':
            void Haptics.impact({ style: ImpactStyle.Light });
            break;
          case 'MEDIUM':
            void Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case 'HEAVY':
            void Haptics.impact({ style: ImpactStyle.Heavy });
            break;
          case 'SUCCESS':
            void Haptics.notification({ type: NotificationType.Success });
            break;
        }
      } catch {
        // 插件未注入（如在浏览器而非真机跑）：静默，不打断交互。
      }
      return;
    }
    // Web 回退
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(millis);
      } catch {
        // 用户手势外调用可能抛，忽略。
      }
    }
  };
}

export const nativeHapticsBackend = createNativeHapticsBackend();

export interface MotionContextValue {
  /** 系统「减少动态效果」 */
  reduceMotion: boolean;
  /** 触觉开关（设置项，默认开） */
  hapticsEnabled: boolean;
}

const MotionContext = createContext<MotionContextValue>({
  reduceMotion: false,
  hapticsEnabled: true,
});

/** 子树覆盖用（预览/测试）。 */
export function MotionProvider(props: {
  reduceMotion: boolean;
  hapticsEnabled?: boolean;
  children: ReactNode;
}) {
  const value = useMemo<MotionContextValue>(
    () => ({ reduceMotion: props.reduceMotion, hapticsEnabled: props.hapticsEnabled !== false }),
    [props.reduceMotion, props.hapticsEnabled],
  );
  return <MotionContext.Provider value={value}>{props.children}</MotionContext.Provider>;
}

export function useMotion(): MotionContextValue {
  return useContext(MotionContext);
}

/** Injected so `src/core/**` stays free of Capacitor imports. */
export type HapticBackend = (kind: HapticKind, millis: number, amplitude: number) => void;

/** AppMotion line 173 `rememberAppHaptics()`. */
export function useAppHaptics(backend?: HapticBackend): AppHaptics {
  const { hapticsEnabled } = useMotion();
  return useMemo(
    () => new AppHaptics(() => hapticsEnabled, backend ?? nativeHapticsBackend),
    [hapticsEnabled, backend],
  );
}

/**
 * Reads the OS-level reduce-motion setting once (MainActivity injected it on
 * Android via `Settings.Global.ANIMATOR_DURATION_SCALE`); on the web this is the
 * live media query.  Useful for the few places that must branch *outside* React
 * (e.g. a rAF loop that would otherwise animate regardless).
 */
export function useSystemReduceMotion(): boolean {
  return systemReduceMotion();
}
/**
 * 互传通知 —— iOS 原生宿主实现（`TransferNotificationPort`）。
 *
 * Kotlin 的 `TransferService` 是 Android 前台服务：进程被杀也继续跑、通知常驻且可改进度。
 * iOS 的对应能力是 `UNUserNotificationCenter`（本地通知），但它**不能常驻**、
 * 也不能无限改进度 —— 系统会在一定时间后收走。所以：
 *
 *   · 优先调原生可选方法 `ReaderDevice.publishTransferNotification(payload)`
 *     （宿主可用 UNUserNotificationCenter 挂上，能挂多久是系统说了算）；
 *   · 插件缺该方法 / 用户拒授权 / 调用失败 → **返回 false**，再由上层退到应用内横幅；
 *   · `clear` 总是尽力撤回（`removeDeliveredNotifications`），失败也不抛。
 *
 * ⚠️ 这里**不假装成功**：`publish` 的返回值就是「有没有真的挂上」，调用方据此决策。
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  TransferNotificationPayload,
  TransferNotificationPort,
} from '@platform/interfaces';

interface TransferNotificationDevice {
  publishTransferNotification?(payload: TransferNotificationPayload): Promise<{ shown?: boolean } | null>;
  clearTransferNotification?(options: { id: number }): Promise<void>;
}

let device: TransferNotificationDevice | null = null;
const cancelListeners = new Set<() => void>();

export function createNativeTransferNotificationPort(): TransferNotificationPort {
  return {
    async publish(payload: TransferNotificationPayload): Promise<boolean> {
      if (!Capacitor.isNativePlatform()) return false;
      try {
        device ??= registerPlugin<TransferNotificationDevice>('ReaderDevice');
        if (typeof device.publishTransferNotification !== 'function') {
          console.warn(
            '[transfer] ReaderDevice.publishTransferNotification 未实现，退到应用内横幅',
          );
          return false;
        }
        const result = await device.publishTransferNotification(payload);
        return result?.shown !== false;
      } catch (reason) {
        console.warn('[transfer] 挂载原生互传通知失败', reason);
        return false;
      }
    },

    async clear(id: number): Promise<void> {
      if (!Capacitor.isNativePlatform()) return;
      try {
        device ??= registerPlugin<TransferNotificationDevice>('ReaderDevice');
        if (typeof device.clearTransferNotification === 'function') {
          await device.clearTransferNotification({ id });
        }
      } catch (reason) {
        console.warn('[transfer] 撤回原生互传通知失败', reason);
      }
    },

    onCancel(listener: () => void): () => void {
      cancelListeners.add(listener);
      return () => {
        cancelListeners.delete(listener);
      };
    },
  };
}

/** 原生通知的「取消」动作（宿主在插件回调里调它）。 */
export function triggerNativeTransferCancel(): void {
  for (const listener of [...cancelListeners]) listener();
}

/**
 * 互传通知 —— Web 宿主实现（`TransferNotificationPort`）。
 *
 * 浏览器没有「常驻进度通知」这种 API（Notification API 只能弹一次、不能改进度、
 * 也不能在页面关闭后保留）。所以这里落到**应用内横幅**：同一份 payload、同一套字段，
 * 由页面上的互传横幅渲染。Kotlin 的判定（标题/正文/进度/何时撤下）全在
 * `@core/transfer/transferNotification`，本文件不做任何判断。
 */

import type {
  TransferNotificationPayload,
  TransferNotificationPort,
} from '@platform/interfaces';

/** 当前挂着的横幅（页面渲染它；`clear` 后为 null）。 */
let current: TransferNotificationPayload | null = null;
const listeners = new Set<(payload: TransferNotificationPayload | null) => void>();
const cancelListeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener(current);
}

export function createWebTransferNotificationPort(): TransferNotificationPort {
  return {
    async publish(payload: TransferNotificationPayload): Promise<boolean> {
      current = payload;
      emit();
      // 应用内横幅是**真的**挂上了，所以返回 true；
      // 「没能挂上」只发生在宿主拿不到任何可视面的时候（例如无 DOM 的 worker）。
      return typeof globalThis.document !== 'undefined';
    },
    async clear(id: number): Promise<void> {
      if (current !== null && current.id === id) {
        current = null;
        emit();
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

/** Kotlin L45 的「取消」按钮被点击 —— 横幅按钮调它。 */
export function triggerWebTransferCancel(): void {
  for (const listener of [...cancelListeners]) listener();
}

/** 当前横幅快照（`null` = 没有进行中的互传）。 */
export function currentWebTransferNotification(): TransferNotificationPayload | null {
  return current;
}

/** 订阅横幅变化（返回退订函数）。 */
export function subscribeWebTransferNotification(
  listener: (payload: TransferNotificationPayload | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

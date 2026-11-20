/**
 * transferNotification.ts —— `transfer/TransferService.kt`（51 行）里**可判定的那部分**。
 *
 * Kotlin 的 `TransferService` 是 Android 前台服务：`onCreate` 建通知渠道、`startForeground`
 * 起常驻通知、订阅 `manager.state` 更新通知、phase 进入终态就 `stopForeground`；
 * `onStartCommand` 处理 `action == "cancel"`；`onTimeout` 也取消；`onDestroy` 收 scope。
 *
 * 里有三块，只有第三块是纯逻辑，`src/core` 能逐行对拍：
 *   ① Android 服务生命周期（`Service` / `ServiceCompat.startForeground` / `FOREGROUND_SERVICE_TYPE`）
 *      → 平台层（`TransferNotificationPort` + `platform/web` + `platform/ios-native`）；
 *   ② 通知渠道（`NotificationChannel("device_transfer", "设备互传", IMPORTANCE_LOW)`）
 *      → 平台层，但渠道名与重要性作为常量留在这里，宿主照抄；
 *   ③ **通知内容与终态判定**（标题/正文/进度/ongoing/取消按钮/何时停）→ 本文件。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L22 `private val notificationId = 7301`                        → `TRANSFER_NOTIFICATION_ID`
 *   L26 `NotificationChannel("device_transfer", "设备互传", …_LOW)`  → `TRANSFER_CHANNEL_*`
 *   L33 `setContentTitle(state.phase.label)`                       → `transferPhaseLabel(phase)`
 *   L33 `state.message.ifBlank { tr("数据正在设备之间安全传输") }`      → `transferNotificationText`
 *   L34 `setOnlyAlertOnce(true)`                                   → `alertOnce: true`
 *   L34 `setOngoing(state.busy)`                                   → `ongoing: transferBusy(phase)`
 *   L35 `setProgress(100, (fraction*100).toInt(), totalBytes == 0L)` → `progressPercent` / `indeterminate`
 *   L36 `if (phase != IMPORTING) addAction(…, "取消", …)`            → `showCancelAction`
 *   L41 `phase in setOf(COMPLETED, CANCELLED, FAILED, WAITING_TO_RESUME)` → `shouldStopForeground`
 */

import { tr } from '@core/i18n';
import {
  TRANSFER_BUSY_PHASES,
  transferFraction,
  transferPhaseLabel,
  type TransferPhase,
  type TransferSessionState,
} from './transferModels';

/** Kotlin L22 `private val notificationId = 7301`。 */
export const TRANSFER_NOTIFICATION_ID = 7301;

/** Kotlin L26 `NotificationChannel("device_transfer", "朗读"… )` 的 id。 */
export const TRANSFER_CHANNEL_ID = 'device_transfer';
/** Kotlin L26 渠道名 —— 中文原文（宿主建渠道时按当前语言 `tr()` 一次）。 */
export const TRANSFER_CHANNEL_NAME_RAW = '设备互传';
/** Kotlin L26 `NotificationManager.IMPORTANCE_LOW` 的数值（Android 常量 = 2）。 */
export const TRANSFER_CHANNEL_IMPORTANCE_LOW = 2;

/** Kotlin L33 `com.example.i18n.tr("数据正在设备之间安全传输")`。 */
export function transferNotificationFallbackText(): string {
  return tr('数据正在设备之间安全传输');
}

/** Kotlin L34 `setOngoing(state.busy)` —— `busy` 由 6 个「进行中」阶段决定。 */
export function transferBusy(phase: TransferPhase): boolean {
  return TRANSFER_BUSY_PHASES.includes(phase);
}

/** Kotlin L35 `(state.progress.fraction * 100).toInt()`。 */
export function transferProgressPercent(state: TransferSessionState): number {
  return Math.trunc(transferFraction(state.progress) * 100);
}

/** Kotlin L35 第三个参数 `state.progress.totalBytes == 0L`（= 不确定进度）。 */
export function transferProgressIndeterminate(state: TransferSessionState): boolean {
  return state.progress.totalBytes === 0;
}

/** Kotlin L36 `if (state.phase != TransferPhase.IMPORTING) addAction(…, "取消", …)`。 */
export function transferShowsCancelAction(phase: TransferPhase): boolean {
  return phase !== 'IMPORTING';
}

/** Kotlin L41 —— 进入这些阶段就 `stopForeground(STOP_FOREGROUND_REMOVE)`。 */
export const TRANSFER_TERMINAL_PHASES: readonly TransferPhase[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'WAITING_TO_RESUME',
];

/** Kotlin L41 `if (state.phase in setOf(…)) stopForeground(…)`。 */
export function shouldStopForeground(phase: TransferPhase): boolean {
  return TRANSFER_TERMINAL_PHASES.includes(phase);
}

/**
 * 一条通知的**全部可判定字段**（Kotlin L28-37 的 `notification(state)`）。
 *
 * 平台层拿到它之后只做「把字段塞进本平台的通知 API」，不再做任何判断 ——
 * 判断全在这里，这样 web / ios-native 两份实现不会各自漂移。
 */
export interface TransferNotificationContent {
  readonly id: number;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelImportance: number;
  /** Kotlin L33 `state.phase.label`。 */
  readonly title: string;
  /** Kotlin L33 `state.message.ifBlank { tr("数据正在设备之间安全传输") }`。 */
  readonly text: string;
  /** Kotlin L34 `setOnlyAlertOnce(true)`。 */
  readonly alertOnce: true;
  /** Kotlin L34 `setOngoing(state.busy)`。 */
  readonly ongoing: boolean;
  /** Kotlin L35 `setProgress(100, …, …)` 的 max。 */
  readonly progressMax: number;
  /** Kotlin L35 的当前值（不确定进度时也给出，宿主可忽略）。 */
  readonly progressValue: number;
  /** Kotlin L35 的第三个参数。 */
  readonly indeterminate: boolean;
  /** Kotlin L36：非 IMPORTING 才给「取消」动作。 */
  readonly showCancelAction: boolean;
  /** Kotlin L41：为 true 时宿主应撤下前台通知。 */
  readonly stopForeground: boolean;
}

/** Kotlin L28-37 `fun notification(state): Notification` 的纯部分。 */
export function transferNotificationContent(
  state: TransferSessionState,
): TransferNotificationContent {
  const blank = state.message.trim() === '';
  return {
    id: TRANSFER_NOTIFICATION_ID,
    channelId: TRANSFER_CHANNEL_ID,
    channelName: tr(TRANSFER_CHANNEL_NAME_RAW),
    channelImportance: TRANSFER_CHANNEL_IMPORTANCE_LOW,
    title: transferPhaseLabel(state.phase),
    text: blank ? transferNotificationFallbackText() : state.message,
    alertOnce: true,
    ongoing: transferBusy(state.phase),
    progressMax: 100,
    progressValue: transferProgressPercent(state),
    indeterminate: transferProgressIndeterminate(state),
    showCancelAction: transferShowsCancelAction(state.phase),
    stopForeground: shouldStopForeground(state.phase),
  };
}

/** Kotlin L45 `intent?.action == "cancel"` —— 服务收到的取消动作名。 */
export const TRANSFER_CANCEL_ACTION = 'cancel';

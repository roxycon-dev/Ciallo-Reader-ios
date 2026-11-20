/**
 * 进程退出历史 —— iOS 原生宿主实现（`ProcessExitHistoryPort`）。
 *
 * Android 侧 `ActivityManager.getHistoricalProcessExitReasons(packageName, 0, 8)`
 * 是系统 API（API 30+），返回**系统自己记的**退出原因。iOS 没有同名 API，
 * 但宿主**能**攒出一份等价数据，本实现走的就是这条路：
 *
 *   ① `ReaderDevice.processExitReasons({ maxRecords })` —— 自写插件的可选方法。
 *      原生侧可从 `MXMetricPayload` 的 hang 段、`NSException` 落盘日志、或
 *      「上次 `didFinishLaunching` 时清掉的启动标记未清掉」这三处拼出记录。
 *      插件**当前**未必提供该方法（`ReaderDevicePlugin.swift` L8-16 只有
 *      `setScreenAwake / writeClipboard / shareText / volumeStats / reportStartup /
 *      testConfiguration / reportCapabilities`），所以这里按「可选方法」调用：
 *      方法缺失 → 返回空数组，core 走 Kotlin 自己的
 *      `"No process exit records available."`。
 *
 *   ② 非原生宿主（浏览器 / jsdom）直接返回空数组 —— 由
 *      `platform/web/processExitHistory.ts` 负责，两者不交叉。
 *
 * ⚠️ 这里**不伪造**记录：没有证据时宁可返回空，也不编一条假的 `REASON_CRASH`。
 * 「看起来有数据」比「明确没有数据」危险得多 —— 前者会让人以为崩溃已经定位到了。
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ProcessExitHistoryPort, ProcessExitRecord } from '@platform/interfaces';

/**
 * 原生插件里这一组方法的形状。方法**可缺**（见文件头 ①），因此全部标 optional。
 *
 * 返回的记录字段与 Android `ApplicationExitInfo` 一一对应（`pss` / `rss` 用 KiB），
 * 原生侧负责把平台单位换算好再交出来。
 */
interface ProcessExitDevice {
  processExitReasons?(options: {
    maxRecords: number;
  }): Promise<{ records?: readonly ProcessExitRecord[] } | null>;
}

let device: ProcessExitDevice | null = null;
let warnedUnavailable = false;

/**
 * 把原生返回的原始对象收敛成 `ProcessExitRecord`：缺字段补 0 / null，
 * 单位不做转换（原生已按 KiB 给出），未知结构一律当 0 —— 与 Kotlin 读
 * `ApplicationExitInfo` 的 getter 一样，取值本身不会失败。
 */
function normalize(raw: unknown): ProcessExitRecord | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const text = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' ? value : null;
  };
  return {
    timestamp: num('timestamp'),
    pid: num('pid'),
    processName: text('processName') ?? '',
    reason: num('reason'),
    status: num('status'),
    importance: num('importance'),
    pssKiB: num('pssKiB'),
    rssKiB: num('rssKiB'),
    description: text('description'),
    trace: text('trace'),
  };
}

export function createNativeProcessExitHistoryPort(): ProcessExitHistoryPort {
  return {
    async read(maxRecords: number): Promise<readonly ProcessExitRecord[]> {
      if (maxRecords <= 0) return [];
      if (!Capacitor.isNativePlatform()) return [];
      try {
        device ??= registerPlugin<ProcessExitDevice>('ReaderDevice');
        if (typeof device.processExitReasons !== 'function') {
          if (!warnedUnavailable) {
            warnedUnavailable = true;
            console.warn(
              '[processExit] ReaderDevice.processExitReasons 未实现，退出历史按空处理',
            );
          }
          return [];
        }
        const result = await device.processExitReasons({ maxRecords });
        const records = result?.records ?? [];
        const out: ProcessExitRecord[] = [];
        for (const raw of records) {
          if (out.length >= maxRecords) break;
          const record = normalize(raw);
          if (record !== null) out.push(record);
        }
        return out;
      } catch (reason) {
        // 诊断路径绝不把上层打断：与 Kotlin `.getOrElse { … }` 同一取舍。
        console.warn('[processExit] 读取原生退出历史失败', reason);
        return [];
      }
    },
  };
}

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/**
 * 启动诊断 — Android `data/StartupDiagnostics.kt` 的 iOS 侧落点。
 *
 * 原生现状（`ios/App/App/Plugins/ReaderDevicePlugin.swift` L8-16）：
 *   `ReaderDevice` 只暴露 `setScreenAwake / writeClipboard / shareText / volumeStats /
 *    reportStartup / testConfiguration / reportCapabilities`，**没有** `read` /
 *    `record` / 任何「导出诊断」方法。`reportStartup` 也只在 DEBUG 下把一次结果写成
 *    `Caches/reader-startup.json`（L40-53），不累积、release 直接 resolve。
 *
 * 因此这里**不伪造原生接口**，按 Kotlin `StartupDiagnostics` 的语义用「面包屑」实现：
 *   - `recordDiagnostic(tag, error)`：追加一行到应用私有目录（`Directory.Data`，
 *     iOS 上是 `Library/NoCloud`，不进用户可见的 Files App，也不会被备份到 iCloud 之外）。
 *   - `readDiagnosticsReport()`：读同一个文件 + 原生 `reader-startup.json`（存在才读），
 *     拼成纯文本报告供 `StartupDiagnosticsExportButton` 写盘。
 *   - 非原生宿主（Web / jsdom）没有私有文件系统，落到进程内环形缓冲，报告照样能导出。
 *
 * Kotlin 对应：
 *   `StartupDiagnostics.record(context, tag, failure)`  → `recordDiagnostic`
 *   `StartupDiagnostics.read(context)`                  → `readDiagnosticsReport`
 */

interface StartupDevice { reportStartup(value: { phase: string; detail: string }): Promise<void> }
let device: StartupDevice | null = null;

/** 私有面包屑文件（与 Android `filesDir/diagnostics.log` 同义）。 */
const DIAGNOSTICS_FILE = 'ciallo-diagnostics.log';
/** 原生 DEBUG 启动记录（`ReaderDevicePlugin.swift` L47）。 */
const STARTUP_RECORD_FILE = 'reader-startup.json';
/** Kotlin `read` 同样只回一段有界文本；这里按行数封顶，避免报告无限长。 */
const MAX_REPORT_LINES = 400;
const MAX_LINE_CHARS = 1000;

/** 非原生宿主的落点；同时充当「原生写盘失败」时的兜底。 */
const memoryLog: string[] = [];
let lastPhase = 'none';

/** Debug builds expose a bounded, local startup result to the simulator CI job. */
export async function reportStartup(phase: 'starting' | 'ready' | 'error', error?: unknown): Promise<void> {
  lastPhase = phase;
  if (error !== undefined) pushBreadcrumb(`startup-${phase}`, error);
  if (!Capacitor.isNativePlatform()) return;
  const details: string[] = [];
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    details.push(cause.message); cause = cause.cause;
  }
  try {
    device ??= registerPlugin<StartupDevice>('ReaderDevice');
    await device.reportStartup({ phase, detail: details.join(' / ').slice(0, 2000) });
  }
  catch (reason) { console.warn('[startup] 原生诊断记录不可用', reason); }
}

/** `Error` 链压成一行（与 `reportStartup` 的 detail 取法一致，但只保留可读文本）。 */
function describeFailure(error: unknown): string {
  const parts: string[] = [];
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth += 1) {
    const label = `${cause.name}: ${cause.message}`;
    parts.push(depth === 0 ? label : `← ${label}`);
    cause = cause.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, MAX_LINE_CHARS);
}

function breadcrumbLine(tag: string, error: unknown): string {
  return `${new Date().toISOString()} [${tag}] ${describeFailure(error)}`;
}

function pushBreadcrumb(tag: string, error: unknown): void {
  memoryLog.push(breadcrumbLine(tag, error));
  if (memoryLog.length > MAX_REPORT_LINES) {
    memoryLog.splice(0, memoryLog.length - MAX_REPORT_LINES);
  }
}

/**
 * Kotlin `StartupDiagnostics.record(context, tag, failure)` —— 追加一条面包屑。
 *
 * 导出按钮在「保存失败」「保存面板打不开」两条路径上调用它（Kotlin
 * `StartupDiagnosticsExportButton.kt` L37 / L48）。记录本身不再抛错，否则会把
 * 原来的失败原因盖掉。
 */
export async function recordDiagnostic(tag: string, error: unknown): Promise<void> {
  pushBreadcrumb(tag, error);
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.appendFile({
      path: DIAGNOSTICS_FILE,
      directory: Directory.Data,
      data: `${breadcrumbLine(tag, error)}\n`,
      encoding: Encoding.UTF8,
    });
  } catch (reason) {
    console.warn('[diagnostics] 无法写入应用私有诊断文件', reason);
  }
}

/** 私有面包屑文件 → 行数组；读不到（首次运行 / 无权限）当作空。 */
async function readBreadcrumbFile(): Promise<string[]> {
  try {
    const { data } = await Filesystem.readFile({
      path: DIAGNOSTICS_FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (typeof data !== 'string') return [];
    return data.split('\n').filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/** 原生 `reader-startup.json` → 原文；release 构建里通常不存在。 */
async function readNativeStartupRecord(): Promise<string> {
  try {
    const { data } = await Filesystem.readFile({
      path: STARTUP_RECORD_FILE,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    return typeof data === 'string' && data.length > 0 ? data : '（原生启动记录为空）';
  } catch {
    return '（无原生启动记录：ReaderDevice.reportStartup 仅在 DEBUG 落盘）';
  }
}

/**
 * Kotlin `StartupDiagnostics.read(context)` —— 导出按钮写进用户选中位置的那段纯文本。
 *
 * 原生宿主读私有文件；Web / 单测读进程内缓冲。两条路径都不抛错（读失败 = 空记录），
 * 真正的失败留给 `writeTarget`（写盘）去触发 Kotlin L38 的「无法保存诊断日志」。
 */
export async function readDiagnosticsReport(): Promise<string> {
  const native = Capacitor.isNativePlatform();
  const fileLines = native ? await readBreadcrumbFile() : [];
  const breadcrumbs = fileLines.length > 0 ? fileLines : memoryLog;
  const lines: string[] = [
    'Ciallo Reader 启动诊断报告',
    `生成时间: ${new Date().toISOString()}`,
    `平台: ${native ? 'ios-native' : 'web'}`,
    `最近启动阶段: ${lastPhase}`,
    '',
    '── 原生启动记录 ──',
    native ? await readNativeStartupRecord() : '（非原生宿主，无原生启动记录）',
    '',
    '── 诊断记录 ──',
  ];
  if (breadcrumbs.length === 0) lines.push('（无）');
  else lines.push(...breadcrumbs.slice(-MAX_REPORT_LINES));
  return `${lines.join('\n')}\n`;
}

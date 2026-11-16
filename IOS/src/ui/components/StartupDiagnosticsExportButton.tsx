import { type ReactElement, useState } from 'react';
import { tr } from '@core/i18n';
import { showToast } from '@ui/toast';
import { AppButton } from './AppButton';

/**
 * `ui/components/StartupDiagnosticsExportButton.kt`（58 行）
 *
 * 逐行对照：
 *   L43-57 `AppActionButton(text = if (exporting) "正在导出…" else "导出启动诊断",
 *               onClick = { save.launch("Ciallo-Reader-diagnostic-${VERSION_NAME}-${now}.txt") },
 *               enabled = !exporting, icon = Icons.Filled.BugReport,
 *               variant = Secondary, fullWidth = true, testTag = "export_startup_diagnostics_button")`
 *   L24-42 `rememberLauncherForActivityResult(CreateDocument("text/plain"))`：用户选中位置后
 *           在 IO 线程读 `StartupDiagnostics.read(context)`，用 UTF-8 写进该 URI；
 *           成功 → 「诊断日志已保存」；失败 → 先 `StartupDiagnostics.record("diagnostic-export", e)`
 *           再「无法保存诊断日志，请重新选择保存位置」；`finally { exporting = false }`
 *   L46-50 `save.launch(...)` 抛错 → `StartupDiagnostics.record("diagnostic-picker", e)` +
 *           「无法打开文件保存窗口」
 *
 * 平台缝（Kotlin 侧是 `ActivityResultContracts.CreateDocument` + `ContentResolver`，
 * iOS 侧 `src/platform/ios-native/startupDiagnostics.ts` 目前只有 `reportStartup`）：
 * 这两步通过 [StartupDiagnosticsExportPorts] 注入，**不在本文件里碰 Capacitor**
 * （与 `core/glass/motion.ts` 注入 `AppHaptics.backend` 同一手法）。
 * 补齐平台端与设置页入口所需的行数见 docs/PARITY_EXCEPTIONS.md E110。
 */

/** Kotlin `StartupDiagnostics.record(context, tag, failure)` 的两个 tag。 */
export type DiagnosticFailureTag = 'diagnostic-export' | 'diagnostic-picker';

export interface StartupDiagnosticsExportPorts {
  /** Kotlin `StartupDiagnostics.read(context)` → 待写入的纯文本报告。 */
  readReport: () => Promise<string>;
  /** Kotlin `StartupDiagnostics.record(context, tag, failure)`（吞掉异常，见 Kotlin L37 无 try）。 */
  recordFailure: (tag: DiagnosticFailureTag, error: unknown) => Promise<void>;
  /**
   * Kotlin `rememberLauncherForActivityResult(CreateDocument("text/plain"))`：
   * 弹出保存面板，返回一个可写目标 id；用户取消返回 `null`；面板打不开则抛错。
   */
  openPicker: (fileName: string) => Promise<string | null>;
  /** Kotlin `contentResolver.openOutputStream(uri, "wt").bufferedWriter(UTF_8)`。 */
  writeTarget: (targetId: string, text: string) => Promise<void>;
  /** Kotlin `BuildConfig.VERSION_NAME`。 */
  version: string;
  /** 供测试注入时钟；默认 `Date.now`。 */
  now?: () => number;
}

export interface StartupDiagnosticsExportButtonProps {
  ports: StartupDiagnosticsExportPorts;
  className?: string;
  'data-testid'?: string;
}

/** Kotlin L46 —— `"Ciallo-Reader-diagnostic-${BuildConfig.VERSION_NAME}-${System.currentTimeMillis()}.txt"`。 */
export function startupDiagnosticFileName(version: string, epochMillis: number): string {
  return `Ciallo-Reader-diagnostic-${version}-${epochMillis}.txt`;
}

function BugReportIcon(): ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20 8h-2.81a5.99 5.99 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6.02 6.02 0 0 0-2.83 0L8.41 3 7 4.41l1.62 1.63A5.99 5.99 0 0 0 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"
      />
    </svg>
  );
}

export function StartupDiagnosticsExportButton(
  props: StartupDiagnosticsExportButtonProps,
): ReactElement {
  const [exporting, setExporting] = useState(false);

  const handleClick = (): void => {
    if (exporting) return;
    void (async () => {
      const stamp = (props.ports.now ?? Date.now)();
      let target: string | null;
      try {
        // Kotlin L46 `save.launch(...)`：抛错 = 保存面板打不开。
        target = await props.ports.openPicker(
          startupDiagnosticFileName(props.ports.version, stamp),
        );
      } catch (failure) {
        await props.ports.recordFailure('diagnostic-picker', failure).catch(() => undefined);
        showToast(tr('无法打开文件保存窗口'));
        return;
      }
      if (target === null) return;

      setExporting(true);
      try {
        const report = await props.ports.readReport();
        await props.ports.writeTarget(target, report);
        showToast(tr('诊断日志已保存'));
      } catch (failure) {
        await props.ports.recordFailure('diagnostic-export', failure).catch(() => undefined);
        showToast(tr('无法保存诊断日志，请重新选择保存位置'));
      } finally {
        setExporting(false);
      }
    })();
  };

  // `exactOptionalPropertyTypes`：`className` 不存在时不能显式传 undefined 给 AppButton。
  const extra = props.className === undefined ? {} : { className: props.className };

  return (
    <AppButton
      variant="secondary"
      fullWidth
      disabled={exporting}
      icon={<BugReportIcon />}
      onClick={handleClick}
      data-testid={props['data-testid'] ?? 'export_startup_diagnostics_button'}
      {...extra}
    >
      {exporting ? tr('正在导出…') : tr('导出启动诊断')}
    </AppButton>
  );
}

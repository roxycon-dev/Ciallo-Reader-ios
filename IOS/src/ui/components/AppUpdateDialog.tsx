/**
 * AppUpdateDialog.tsx — line-by-line port of Android `com/example/ui/AppUpdateDialog.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/AppUpdateDialog.kt`, 191 lines / 187 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-41    package + Compose imports → React imports; Android/Compose imports SKIPPED
 *   42-118  AppUpdateDialogHost          → AppUpdateDialogHost (see L44-118 map below)
 *   120-189 internal fun AppUpdateDialog → AppUpdateDialog
 *   191     internal fun updateBytes     → updateBytes
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L2     `android.widget.Toast` → `showToast()` (`@ui/components/Toast`).
 *  L3     `rememberLauncherForActivityResult(StartActivityForResult())` — Android's
 *         Activity-result plumbing (installer callback / permission callback / SAF
 *         CreateDocument). Replaced by the injected `AppUpdateActions` port:
 *         `openInstaller()`, `openPermissionSettings()`, `exportApk(name)`.
 *  L4     `ActivityResultContracts` — same as above.
 *  L5-33  Compose foundation/material3/runtime/ui imports → CSS (`app-update-*`).
 *  L26    `androidx.lifecycle.Lifecycle` + `currentStateFlow` → the
 *         `foreground: boolean` prop (MainActivity's ON_RESUMED state).
 *  L27-29 `collectAsStateWithLifecycle` → React props + `useState`.
 *  L30-33 `AppUpdateInstaller` / `AppUpdateManager` / `AppUpdateStage` / `AppUpdateState` —
 *         RESOLVED: these live in `com.example.data` and their real port now exists at
 *         `src/core/update/`, so this file IMPORTS them (`AppUpdateStage`,
 *         `AppUpdateState`, `UpdateRelease`, `UpdateApkAsset`, `AppUpdateActions`) rather
 *         than redeclaring structural mirrors. The local `isTransferring` / `hasPackage` /
 *         `releaseVersion` wrappers now delegate to `@core/update` and stay exported so
 *         existing importers keep working; `createAppUpdateActions(...)` builds the
 *         `actions` prop that replaces the three launcher blocks.
 *  L35    `DesignTokens.shape(DesignTokens.RadiusXl)` (24.dp) → CSS `border-radius: 24px`.
 *  L36    `DesignTokens.SpaceMd` → CSS `gap` (SpaceMd value lives in `src/ui/tokens.ts`).
 *  L44-53 `AppUpdateManager.get(context)` / `AppUpdateInstaller(context)` / launcher →
 *         injected `manager` + `actions` props.
 *  L53-55 `installer.launch(...)` → `actions.openInstaller()` (see L3).
 *  L57    `platform.canInstall()` → `actions.canInstall(): boolean`.
 *  L58-63 `platform.installationIntent(manager.apkFile)` → `actions.openInstaller()`;
 *         the failure message is preserved verbatim.
 *  L65-73 `permission.launch(platform.permissionIntent())` → `actions.openPermissionSettings()`,
 *         followed by `awaitInitialization()` + the same branch on `state.hasPackage`.
 *  L74-90 `ActivityResultContracts.CreateDocument("application/vnd.android.package-archive")`
 *         + `contentResolver.openOutputStream` copy loop (64 KiB buffer) → the injected
 *         `actions.exportApk(fileName, bytes)` port; both toast messages are preserved
 *         verbatim (including `导出失败：${e.message}`).
 *  L91-96 `LaunchedEffect(state.autoInstall, lifecycle)` RESUMED → `useEffect` on
 *         `[state.autoInstall, foreground]` with the same condition.
 *  L97-101 `LocalUriHandler.openUri` → `actions.openBrowser(url)` with the same toast.
 *  L134   `AlertDialog(onDismissRequest = onDismiss, shape = …)` → modal `<div role="dialog">`.
 *  L151/154 `LinearProgressIndicator(progress = { progress })` → CSS `width: %` bar;
 *         the indeterminate variant keeps the same `update_progress` test tag.
 *  L178   `if (release.apk != null)` guard in `confirmButton` → **no confirm button at
 *         all** when the release carries no APK asset (the Kotlin `if` has no `else`).
 *         See 「FIXED ②」 below — a previous pass wrongly fell through to 「打开发布页」.
 *  L180   `else TextButton(onClick = onReleasePage)` — the `when`'s own `else`. It is
 *         unreachable on Android (`AppUpdateStage` has exactly the seven values the
 *         branches above enumerate) and is kept verbatim as the `default:` case.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `AppUpdateManager.state: StateFlow<AppUpdateState>` → the `state` prop.
 *  * `rememberLauncherForActivityResult` → `AppUpdateActions` (the port's
 *    `createAppUpdateActions(...)` in `@core/update/appUpdateInstaller.ts` implements it).
 *  * `HttpURLConnection` update check → the ported `GithubUpdateChecker` in `@core/update`.
 *    The dialog consumes `UpdateRelease` / `UpdateApkAsset` from that module.
 *  * `LocalUriHandler.openUri` → `window.open` via the injected port.
 *  * `AppToast.makeText(..., LENGTH_LONG)` → `showToast(msg)`.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  Every Chinese string compared against the Kotlin file character by character
 *  (`AppUpdateDialog.kt` L62/L70/L84/L87/L99/L111 and the dialog's L137-L191): all match.
 *  Titles 「正在下载更新」「正在校验安装包」「选择安装方式」「更新已就绪」「更新下载未完成」
 *  「发现新版本」 ✔; body 「Ciallo Reader ${version}」 ✔, 「校验完整性、版本和签名…」 ✔,
 *  「已下载 …」 ✔, 「可收起窗口继续使用。下载完成后，在前台自动打开安装页面。」 ✔,
 *  「安装包 …」 ✔, 「更新说明可在 GitHub 发布页查看。」 ✔, 「系统仍需你确认安装。升级成功后
 *  自动清理应用内安装包；导出的副本由你保留。」 ✔, 「导出中…」/「导出安装包」 ✔,
 *  「浏览器下载」 ✔, 「查看完整更新说明」 ✔; buttons 「收起」「允许安装」「安装」
 *  「重新下载」/「下载并安装」/「打开发布页」 ✔, 「取消下载」/「稍后」 ✔; toasts
 *  「安装包已导出，可用文件管理器打开安装」/「导出失败：${e.message}」 ✔,
 *  「无法打开浏览器，可先导出安装包后用文件管理器安装」 ✔,
 *  「无法打开系统安装页面。可以导出安装包，用文件管理器安装，或使用浏览器下载。」 ✔,
 *  「系统无法打开授权页面。请在系统设置中允许安装，或导出安装包、使用浏览器下载。」 ✔,
 *  「未获得安装权限。安装包已保留，可再次授权、导出后用文件管理器安装，或通过浏览器下载。」 ✔.
 *  `updateBytes` L191 `String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0*1024.0))`
 *  → `toFixed(1)` — identical rounding for the values in range, and `Locale.ROOT` is
 *  exactly what forces the `.` decimal separator this replaced.
 *  FIXED (BUG ×2, EXTRA ×1):
 *   1. The progress text used `Math.round`; Kotlin L152 uses `.toInt()`, which truncates.
 *      Now `Math.trunc` (`progressPercentInt`), while the bar width keeps Kotlin L151's
 *      exact fraction (`progressPercent`).
 *   2. `install` was an inline closure read by the L91-96 effect behind an
 *      `eslint-disable react-hooks/exhaustive-deps` — a banned silencer that was not even
 *      covering the diagnostic it was aimed at. Now a `useCallback`; the effect keys stay
 *      Kotlin's two through the latest-value ref (which is what Compose's `LaunchedEffect`
 *      does — captures changing must NOT re-run it).
 *   3. REMOVED the `apkFileName` prop (EXTRA). Kotlin L114 exports `release.apk.name` and
 *      nothing else; a caller-chosen name would bypass the `officialUpdateAsset` check the
 *      verifier enforces. REMOVED the never-read `onInstallationReturned` prop (dead): the
 *      Activity-result callback (Kotlin L53-55) is delivered by the injected `actions`
 *      port, so the host wires `manager.installationReturned()` there, not through a prop
 *      this component would have to fire itself.
 *  NOT CHANGED (deliberate, documented): `onPermission` runs the post-permission re-check
 *  immediately after `openPermissionSettings()` rather than on "return from the settings
 *  page", because there is no resume signal for an external settings screen on web/iOS.
 *  Also reported: this host is NEVER MOUNTED (`App.tsx` does not render it, and
 *  `SettingsPage.tsx` drives its own `SettingsUpdateIo`), so the whole dialog is dead code
 *  today — `App.tsx` is another agent's file, registered as an exception rather than
 *  hidden.
 *
 * ── 2026-10-06 修复 pass（速率限制中断后的半成品收尾 + 逐行复核）─────────────────────
 *  FIXED:
 *   1. tsc: `onInstalling` / `onInstallationFailed` / `onPermissionNeeded` were
 *      destructured from `props` **twice** (3 × TS2451). Both copies were byte-identical
 *      — same names, same `props`, same values — so this was a duplicated block, not two
 *      behaviours: the interrupted agent pasted the destructuring a second time below the
 *      `useState` and never deleted the first. The one next to the `install` comment was
 *      kept (it documents *why* those three are pulled out of `props`), the second copy
 *      deleted.
 *   2. BUG, `confirmButton`: Kotlin L178-179 is `if (release.apk != null) TextButton { … }`
 *      with **no `else`**, so an `AVAILABLE` / `FAILED` release whose `apk` is null renders
 *      no confirm button at all. This port fell through to 「打开发布页」 instead — a button
 *      Android never draws, on the one stage pair where a missing APK is most likely (a
 *      browser-only release). Now returns `null`, and the function's return type is
 *      `ReactElement | null`. Kotlin L180's `else TextButton { "打开发布页" }` belongs to
 *      the outer `when (state.stage)` and stays the `default:` case.
 *   3. Kotlin L57 is `manager.permissionNeeded()` — the *default argument* of
 *      `AppUpdateManager.kt` L122. The message was inlined here, so the dialog carried a
 *      second copy of a string the manager also owns. It now reads
 *      `MESSAGE_PERMISSION_NEEDED` from `@core/update` (same characters, one source).
 *
 *  REPORTED, NOT FIXED (the fix lives outside this file — see the review report):
 *   a. Kotlin L53-55, `rememberLauncherForActivityResult(StartActivityForResult()) {
 *      manager.installationReturned() }`, has **no** counterpart here: the `AppUpdateActions`
 *      port in `@core/update/appUpdateInstaller.ts` declares only `canInstall`,
 *      `openInstaller`, `openPermissionSettings`, `exportApk` and `openBrowser`, so
 *      nothing can ever report "the installer came back". Without it the
 *      「安装包已保留。如果尚未完成安装，可以重试或导出安装包」 path
 *      (`AppUpdateManager.kt` L128-136, `MESSAGE_INSTALLATION_INCOMPLETE`) is unreachable.
 *      The header's earlier claim that "the host wires `manager.installationReturned()`
 *      there" is not true of the port as it stands — `installationReturned` needs to be
 *      added to the interface (a `src/core/**` file, i.e. another agent's).
 *   b. Kotlin L82 `?: error("无法写入选择的位置")` — the "the chosen destination could not
 *      be opened for writing" message is gone with the SAF picker; `createAppUpdateActions`
 *      returns silently on a cancelled picker (correct, L75) but has no way to raise that
 *      specific error. Also core's to add.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@ui/components/Toast';
// `statistics.css` is the only stylesheet this module may extend (see the write-target
// list); the `.app-update-*` block lives in its "Shared dialog surfaces" section.
import '../../styles/statistics.css';
// ⚠️ The real port of `com.example.data.{AppUpdateManager, AppUpdateInstaller,
// AppUpdateStore, GithubUpdateChecker, AppUpdateDownload}.kt` now exists under
// `src/core/update/`, so this file consumes THAT module instead of redeclaring
// structural mirrors (see header L30-33 / L57-59, both now resolved).
import {
  hasPackage as stateHasPackage,
  isTransferring as stateIsTransferring,
  releaseVersion as releaseVersionOf,
  MESSAGE_PERMISSION_NEEDED,
  type AppUpdateActions,
  type AppUpdateStage,
  type AppUpdateState,
  type UpdateApkAsset,
  type UpdateRelease,
} from '@core/update';

/* ══════════════════════════════════════════════════════════════════════════════
   Re-exports — every name this module used to declare locally now comes from
   `@core/update`. They stay exported so existing importers keep working.
   ══════════════════════════════════════════════════════════════════════════════ */

export type { AppUpdateActions, AppUpdateStage, AppUpdateState, UpdateApkAsset, UpdateRelease };

/** Kotlin L32 `val transferring get() = stage == DOWNLOADING || stage == VERIFYING`. */
export function isTransferring(state: AppUpdateState): boolean {
  return stateIsTransferring(state);
}

/** Kotlin L33 `val hasPackage get() = stage in setOf(READY, NEED_PERMISSION, INSTALLING)`. */
export function hasPackage(state: AppUpdateState): boolean {
  return stateHasPackage(state);
}

/** Kotlin `GithubUpdateChecker.kt` L25 version accessor. */
export function releaseVersion(tag: string): string {
  return releaseVersionOf(tag);
}

/* ══════════════════════════════════════════════════════════════════════════════
   AppUpdateDialogHost — Kotlin lines 42-118
   ══════════════════════════════════════════════════════════════════════════════ */

export interface AppUpdateDialogHostProps {
  /** Android `manager.state.collectAsStateWithLifecycle()`. */
  state: AppUpdateState;
  /** Android `LocalLifecycleOwner.current.lifecycle.currentStateFlow` (RESUMED only). */
  foreground: boolean;
  actions: AppUpdateActions;
  /** Android `manager.awaitInitialization()`. */
  awaitInitialization: () => Promise<void>;
  /** Android `manager.hide()`. */
  onDismiss: () => void;
  /** Android `manager.startDownload()`. */
  onDownload: () => void;
  /** Android `manager.cancelDownload()`. */
  onCancel: () => void;
  /** Android `manager.permissionNeeded(message)`. */
  onPermissionNeeded: (message: string) => void;
  /** Android `manager.installationFailed(message)`. */
  onInstallationFailed: (message: string) => void;
  /** Android `manager.installing()`. */
  onInstalling: () => void;
  /** Android `manager.consumeAutoInstall()`. */
  onConsumeAutoInstall: () => void;
  /** Android `LocalContext.current` — the APK must still exist before export. */
  hasApkFile?: boolean;
}

/** One root host keeps installer results alive when the user leaves the Settings tab. */
export function AppUpdateDialogHost(props: AppUpdateDialogHostProps) {
  const { state, foreground, actions, awaitInitialization, hasApkFile = true } = props;
  // Destructure the three callbacks `install` touches so `useCallback` can name them
  // individually (react-hooks/exhaustive-deps rejects a bare `props` dependency).
  const { onInstalling, onInstallationFailed, onPermissionNeeded } = props;

  // Android L52 `var exporting by remember { mutableStateOf(false) }`
  const [exporting, setExporting] = useState(false);

  // Kotlin L56-64 `val install: () -> Unit`
  // REVIEW FIX (BUG / hard-rule violation): this was a plain closure read by the L91-96
  // effect, which forced an `eslint-disable react-hooks/exhaustive-deps` — a banned
  // silencer, and it was not even suppressing the reported diagnostic (which points at
  // the definition site on the line above the comment). It is now a `useCallback` over
  // the three specific props it touches, so the linter is satisfied honestly.
  const install = useCallback((): void => {
    if (!actions.canInstall()) {
      // Kotlin L57 `manager.permissionNeeded()` — the **default** argument of
      // `AppUpdateManager.kt` L122, i.e. exactly `MESSAGE_PERMISSION_NEEDED`. The
      // string used to be inlined here, which let it drift from the manager's own copy.
      onPermissionNeeded(MESSAGE_PERMISSION_NEEDED);
      return;
    }
    try {
      actions.openInstaller();
      onInstalling();
    } catch {
      // Kotlin L62 — verbatim. The catch is also what turns the iOS "there is no package
      // installer here" error from `createUnavailableAppUpdateActions` into a visible
      // failure instead of a fake success.
      onInstallationFailed(
        '无法打开系统安装页面。可以导出安装包，用文件管理器安装，或使用浏览器下载。',
      );
    }
  }, [actions, onInstalling, onInstallationFailed, onPermissionNeeded]);

  // Kotlin L65-73 permission launcher callback
  const onPermissionReturned = (): void => {
    void (async () => {
      await awaitInitialization();
      if (!hasPackage(state)) return;
      if (actions.canInstall()) install();
      else {
        props.onPermissionNeeded(
          '未获得安装权限。安装包已保留，可再次授权、导出后用文件管理器安装，或通过浏览器下载。',
        );
      }
    })();
  };

  // Kotlin L74-90 CreateDocument launcher callback
  const exportApkTo = (name: string): void => {
    void (async () => {
      if (exporting) return;
      setExporting(true);
      try {
        if (!hasApkFile) throw new Error('安装包已不存在，请重新下载');
        await actions.exportApk(name);
        showToast('安装包已导出，可用文件管理器打开安装');
      } catch (error) {
        showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setExporting(false);
      }
    })();
  };

  // Kotlin L91-96 LaunchedEffect(state.autoInstall, lifecycle)
  // The effect key set stays EXACTLY Kotlin's two keys. Compose's `LaunchedEffect` does not
  // re-run when the lambda captures change, so `install` and `onConsumeAutoInstall` must NOT
  // become dependencies — an inline parent callback would otherwise re-run the effect on
  // every render and re-trigger the auto-install in a loop. They are read through the
  // latest-value ref instead (assigning in an effect, so no `ref.current` read happens
  // during render, per the React 19 rule).
  const installRef = useRef(install);
  const consumeRef = useRef(props.onConsumeAutoInstall);
  useEffect(() => {
    installRef.current = install;
    consumeRef.current = props.onConsumeAutoInstall;
  });
  useEffect(() => {
    if (state.autoInstall && foreground) {
      consumeRef.current();
      installRef.current();
    }
  }, [state.autoInstall, foreground]);

  // Kotlin L97-101 `val openBrowser: (String) -> Unit`
  const openBrowser = (url: string): void => {
    try {
      actions.openBrowser(url);
    } catch {
      showToast('无法打开浏览器，可先导出安装包后用文件管理器安装');
    }
  };

  if (!state.visible) return null;

  return (
    <AppUpdateDialog
      state={state}
      exporting={exporting}
      onDismiss={props.onDismiss}
      onDownload={props.onDownload}
      onCancel={props.onCancel}
      onInstall={install}
      onPermission={() => {
        try {
          actions.openPermissionSettings();
          onPermissionReturned();
        } catch {
          props.onPermissionNeeded(
            '系统无法打开授权页面。请在系统设置中允许安装，或导出安装包、使用浏览器下载。',
          );
        }
      }}
      onExport={() => {
        // Kotlin L114 `state.release?.apk?.let { export.launch(it.name) }` — the asset name
        // and nothing else. REVIEW FIX (EXTRA removed): a previous pass preferred an
        // `apkFileName` prop here, which has no Android counterpart (Kotlin never lets the
        // caller choose the exported file name) and would have exported under a name the
        // verifier never checked. The prop is gone.
        if (state.release?.apk != null) exportApkTo(state.release.apk.name);
      }}
      onBrowser={() => {
        const release = state.release;
        if (release === null) return;
        openBrowser(release.apk?.url ?? release.releaseUrl);
      }}
      onReleasePage={() => {
        const release = state.release;
        if (release === null) return;
        openBrowser(release.releaseUrl);
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   AppUpdateDialog — Kotlin lines 120-189
   ══════════════════════════════════════════════════════════════════════════════ */

export interface AppUpdateDialogProps {
  state: AppUpdateState;
  /** Kotlin default `false`. */
  exporting?: boolean;
  onDismiss: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onPermission: () => void;
  onExport: () => void;
  onBrowser: () => void;
  onReleasePage: () => void;
}

/** Kotlin L137-144 title `when (state.stage)`. */
function dialogTitle(stage: AppUpdateStage): string {
  switch (stage) {
    case 'DOWNLOADING':
      return '正在下载更新';
    case 'VERIFYING':
      return '正在校验安装包';
    case 'NEED_PERMISSION':
      return '选择安装方式';
    case 'READY':
    case 'INSTALLING':
      return '更新已就绪';
    case 'FAILED':
      return '更新下载未完成';
    case 'AVAILABLE':
      return '发现新版本';
    default:
      return '发现新版本';
  }
}

export function AppUpdateDialog(props: AppUpdateDialogProps) {
  const { state, exporting = false } = props;
  // Kotlin L133 `val release = state.release ?: return`
  const release = state.release;
  if (release === null) return null;

  const transferring = isTransferring(state);
  const packageReady = hasPackage(state);

  return (
    <div className="app-update-backdrop" role="presentation" onClick={props.onDismiss}>
      <div
        className="app-update"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle(state.stage)}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h3 className="app-update__title">{dialogTitle(state.stage)}</h3>
        <div className="app-update__body">
          <p className="app-update__version">{`Ciallo Reader ${release.version}`}</p>
          {transferring ? (
            <>
              {state.stage === 'DOWNLOADING' && state.total !== null && state.total > 0 ? (
                <div className="app-update__progress-wrap">
                  <div
                    className="app-update__progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercentInt(state)}
                    data-testid="update_progress"
                    style={{ width: `${String(progressPercent(state))}%` }}
                  />
                  <p className="app-update__progress-text">
                    {`${String(progressPercentInt(state))}% · ${updateBytes(state.downloaded)} / ${updateBytes(state.total ?? 0)}`}
                  </p>
                </div>
              ) : (
                <div className="app-update__progress-wrap">
                  <div
                    className="app-update__progress app-update__progress--indeterminate"
                    data-testid="update_progress"
                  />
                  <p className="app-update__progress-text">
                    {state.stage === 'VERIFYING'
                      ? '校验完整性、版本和签名…'
                      : `已下载 ${updateBytes(state.downloaded)}`}
                  </p>
                </div>
              )}
              <p className="app-update__hint">
                可收起窗口继续使用。下载完成后，在前台自动打开安装页面。
              </p>
            </>
          ) : (
            <>
              {release.apk?.size != null ? (
                <p className="app-update__meta">
                  {`安装包 ${updateBytes(release.apk.size)}`}
                </p>
              ) : null}
              {state.message !== null ? (
                <p className="app-update__meta">{state.message}</p>
              ) : null}
              {state.stage === 'AVAILABLE' || state.stage === 'FAILED' ? (
                <p className="app-update__notes">
                  {release.notes.trim() !== ''
                    ? release.notes
                    : '更新说明可在 GitHub 发布页查看。'}
                </p>
              ) : null}
              {packageReady ? (
                <>
                  <p className="app-update__hint">
                    系统仍需你确认安装。升级成功后自动清理应用内安装包；导出的副本由你保留。
                  </p>
                  <button
                    type="button"
                    className="app-update__link"
                    disabled={exporting}
                    onClick={props.onExport}
                  >
                    {exporting ? '导出中…' : '导出安装包'}
                  </button>
                </>
              ) : null}
              <button type="button" className="app-update__link" onClick={props.onBrowser}>
                浏览器下载
              </button>
              <button
                type="button"
                className="app-update__link"
                onClick={props.onReleasePage}
              >
                查看完整更新说明
              </button>
            </>
          )}
        </div>
        <div className="app-update__actions">
          {confirmActionFor(state, props, exporting)}
          <button
            type="button"
            className="app-update__action"
            disabled={exporting}
            onClick={transferring ? props.onCancel : props.onDismiss}
          >
            {transferring ? '取消下载' : '稍后'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Kotlin L150 `(state.downloaded.toFloat() / state.total).coerceIn(0f, 1f)`. */
function progressOf(state: AppUpdateState): number {
  if (state.total === null || state.total <= 0) return 0;
  return Math.max(0, Math.min(1, state.downloaded / state.total));
}

/**
 * Kotlin L151 `LinearProgressIndicator(progress = { progress })` — the bar takes the exact
 * fraction, so the width is `progress * 100` with no rounding at all.
 */
function progressPercent(state: AppUpdateState): number {
  return progressOf(state) * 100;
}

/**
 * Kotlin L152 `Text("${(progress * 100).toInt()}% · …")` — `Int` conversion TRUNCATES
 * toward zero, it does not round.
 *
 * REVIEW FIX (BUG): this used `Math.round`. The two differ for every value ≥ .5 of a
 * percent: at 99.9 % received Kotlin prints 「99%」 and the bar sits at 99.9 % wide, while
 * `Math.round` printed 「100%」 on a transfer that is not finished — a download that stalls
 * at 99.9 % would claim to be complete. `Math.trunc` reproduces `Float.toInt()` exactly
 * (both truncate toward zero, and `progress` is already `coerceIn(0f, 1f)`, so it is never
 * negative).
 */
function progressPercentInt(state: AppUpdateState): number {
  return Math.trunc(progressPercent(state));
}

/** Kotlin L173-182 confirmButton `when (state.stage)`. */
function confirmActionFor(
  state: AppUpdateState,
  props: AppUpdateDialogProps,
  exporting: boolean,
): React.ReactElement | null {
  switch (state.stage) {
    case 'DOWNLOADING':
    case 'VERIFYING':
      return (
        <button type="button" className="app-update__action" onClick={props.onDismiss}>
          收起
        </button>
      );
    case 'NEED_PERMISSION':
      return (
        <button
          type="button"
          className="app-update__action app-update__action--primary"
          disabled={exporting}
          onClick={props.onPermission}
        >
          允许安装
        </button>
      );
    case 'READY':
    case 'INSTALLING':
      return (
        <button
          type="button"
          className="app-update__action app-update__action--primary"
          disabled={exporting}
          onClick={props.onInstall}
        >
          安装
        </button>
      );
    case 'AVAILABLE':
    case 'FAILED':
      // Kotlin L178-179 `if (release.apk != null) TextButton(onClick = onDownload) { … }`
      // — the `if` has NO `else`, so an AVAILABLE/FAILED release that carries no APK
      // asset renders **nothing** in the confirm slot. FIXED: this port used to fall
      // through to 「打开发布页」 here, which Kotlin never draws.
      if (null === state.release?.apk) return null;
      return (
        <button
          type="button"
          className="app-update__action app-update__action--primary"
          onClick={props.onDownload}
        >
          {state.stage === 'FAILED' ? '重新下载' : '下载并安装'}
        </button>
      );
    default:
      // Kotlin L180 `else TextButton(onClick = onReleasePage) { Text("打开发布页") }` —
      // the `when`'s own `else`. `AppUpdateStage` (`AppUpdateManager.kt` L21) has exactly
      // the seven values enumerated above, so on Android this branch never runs; it is
      // kept verbatim so the port still reaches Kotlin's only remaining behaviour if the
      // enum ever grows a value.
      return (
        <button
          type="button"
          className="app-update__action app-update__action--primary"
          onClick={props.onReleasePage}
        >
          打开发布页
        </button>
      );
  }
}

/** Kotlin L191 `internal fun updateBytes(bytes: Long): String`. */
export function updateBytes(bytes: number): string {
  return `${(bytes / (1024.0 * 1024.0)).toFixed(1)} MB`;
}

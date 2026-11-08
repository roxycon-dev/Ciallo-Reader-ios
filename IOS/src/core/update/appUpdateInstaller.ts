/**
 * appUpdateInstaller.ts — line-by-line port of Android
 * `com/example/data/AppUpdateInstaller.kt`
 * (`novel-reader/app/src/main/java/com/example/data/AppUpdateInstaller.kt`,
 * 35 lines / 27 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-10   package + imports                 → see "Skipped lines" below
 *   12-17  class + contentUri default       → `AndroidAppUpdateInstaller`
 *   18-22  @Suppress fun canInstall()       → `canInstall()` (+ `InstallEnvironment`)
 *   24-26  fun permissionIntent()           → `permissionIntent()`
 *   28-34  fun installationIntent(file)     → `installationIntent()`
 *
 * ── iOS / web routing (REQUIRED READING) ──────────────────────────────────────────
 *  This module declares the `AppInstaller` **port**. There is NO APK installer on
 *  iOS: iOS forbids side-loading outside the App Store, so an Apple build MUST route
 *  `AppUpdateInstaller.installationIntent()` to the **App Store / TestFlight page for
 *  `roxycon-dev/Ciallo-Reader`** and MUST NOT fabricate an in-app package installer.
 *  `AppUpdateActions`-shaped wiring is provided by `createAppUpdateActions()` below so
 *  `ui/components/AppUpdateDialog.tsx` can be mounted without any Android assumption,
 *  and `createUnavailableAppUpdateActions()` is the explicit "there is no installer here"
 *  half — it THROWS instead of pretending. See its note for the full rationale.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  L35 Kotlin lines, all literals transcribed:
 *  L20 `Build.VERSION.SDK_INT >= 26` → `UNKNOWN_SOURCES_SDK = 26` ✔;
 *  L21 `canRequestPackageInstalls()` / `Settings.Secure.INSTALL_NON_MARKET_APPS == 1` ✔;
 *  L19-22 `runCatching { … }.getOrDefault(false)` — `canInstall()` is `async` and still
 *  swallows every throw into `false` ✔;
 *  L25 `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` + `Uri.parse("package:$packageName")`
 *  → `ACTION_MANAGE_UNKNOWN_APP_SOURCES` + `data: "package:<pkg>"` ✔;
 *  L26 pre-API-26 `Settings.ACTION_SECURITY_SETTINGS` with no data ✔;
 *  L29 `check(file.isFile) { "安装包已不存在，请重新下载" }` ✔;
 *  L31 `ACTION_VIEW` + `application/vnd.android.package-archive` ✔;
 *  L32 `Intent.FLAG_GRANT_READ_URI_PERMISSION` = 0x1 ✔;
 *  L33 `ClipData.newRawUri("Ciallo Reader 安装包", uri)` — label verbatim ✔.
 *  FOCUS ITEM 5 ANSWER: there is no iOS equivalent of `ACTION_VIEW` + `FileProvider` /
 *  `PackageInstaller`, and this port does not fake one. Installation goes through the
 *  injected `AppUpdateActions` port; when a host cannot provide it, it must use
 *  `createUnavailableAppUpdateActions`, whose `openInstaller()` throws
 *  `AppInstallerUnavailableError` and the dialog surfaces the failure (Kotlin L61-63's
 *  `installationFailed` path). It deliberately does NOT open the release page as a
 *  substitute — that would be a fake success.
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L2     `android.content.Context` — `context.packageManager` / `context.contentResolver`
 *         become the `InstallEnvironment` values; `context.packageName` becomes
 *         `InstallEnvironment.packageName`.
 *  L3     `android.content.ClipData` — an Intent extra; kept as the `clipLabel`
 *         descriptor field (`"Ciallo Reader 安装包"`, verbatim).
 *  L4     `android.content.Intent` — `IntentDescriptor` — the Action / data / type /
 *         flags of an Android intent, kept as data so the Android implementation can
 *         hand it to `startActivity` and the tests can assert on it.
 *  L5     `android.net.Uri` — `URL` for the parsed `Uri.parse(...)` comparisons.
 *  L6     `android.os.Build` — `InstallEnvironment.sdkInt`.
 *  L7     `android.provider.Settings` — `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` /
 *         `Settings.ACTION_SECURITY_SETTINGS` become the `Action` literal strings, and
 *         `Settings.Secure.INSTALL_NON_MARKET_APPS` becomes `installNonMarketApps`.
 *  L8     `androidx.core.content.FileProvider` — a `content://` URI minted by the
 *         Android framework from `${packageName}.fileprovider`; modelled as the injected
 *         `contentUri` function (Kotlin's own default), so core never names a provider.
 *  L9     `java.io.File` — the path is enough once `File.isFile` is answered by the
 *         injected `UpdateFileStore.isFile` (Kotlin L29).
 *  L21    `Settings.Secure.getInt(context.contentResolver, …) == 1` — read through the
 *         injected `InstallEnvironment.installNonMarketApps` (Kotlin L21).
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `Intent` is data, not an object: `Action`, `data`, `type`, `flags` and `clipLabel`
 *    carry every value the Kotlin builder sets, in the same order.
 *  * `runCatching { … }.getOrDefault(false)` (L19-22) is preserved: any throw from the
 *    platform probe degrades to `false`.
 */

import type { UpdateFileStore } from './appUpdateStore';

/* ══════════════════════════════════════════════════════════════════════════════
   Android Intent shape — Kotlin L25 / L26 / L31-33
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `Intent.ACTION_VIEW`. */
export const ACTION_VIEW = 'android.intent.action.VIEW';
/** Kotlin `Intent.ACTION_MY_PACKAGE_REPLACED` — also used by `appUpdateCleanupReceiver.ts`. */
export const ACTION_MY_PACKAGE_REPLACED = 'android.intent.action.MY_PACKAGE_REPLACED';
/** Kotlin `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` (API 26+). */
export const ACTION_MANAGE_UNKNOWN_APP_SOURCES = 'android.settings.MANAGE_UNKNOWN_APP_SOURCES';
/** Kotlin `Settings.ACTION_SECURITY_SETTINGS` (pre-API 26). */
export const ACTION_SECURITY_SETTINGS = 'android.settings.SECURITY_SETTINGS';
/** Kotlin L31 `setDataAndType(uri, "application/vnd.android.package-archive")`. */
export const APK_MIME_TYPE = 'application/vnd.android.package-archive';
/** Kotlin L33 `ClipData.newRawUri("Ciallo Reader 安装包", uri)`. */
export const APK_CLIP_LABEL = 'Ciallo Reader 安装包';
/** Kotlin L32 `Intent.FLAG_GRANT_READ_URI_PERMISSION`. */
export const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
/** Kotlin L20 `Build.VERSION.SDK_INT >= 26`. */
export const UNKNOWN_SOURCES_SDK = 26;

/** Kotlin `Intent` — the fields this module sets. */
export interface IntentDescriptor {
  /** Kotlin `Intent(action)`. */
  readonly action: string;
  /** Kotlin `setDataAndType(uri, mime)` → `Uri`. */
  readonly data: string | null;
  /** Kotlin `setDataAndType(uri, mime)` → mime. */
  readonly type: string | null;
  /** Kotlin `Intent.addFlags(...)`. */
  readonly flags: number;
  /** Kotlin `Intent.clipData = ClipData.newRawUri(label, uri)`. */
  readonly clipLabel: string | null;
}

/** The three platform probes Kotlin L20-21 and L24-26 read. */
export interface InstallEnvironment {
  /** Kotlin `Build.VERSION.SDK_INT`. */
  readonly sdkInt: number;
  /** Kotlin `context.packageName`. */
  readonly packageName: string;
  /** Kotlin L20 `context.packageManager.canRequestPackageInstalls()` (API 26+). */
  readonly canRequestPackageInstalls: () => boolean;
  /** Kotlin L21 `Settings.Secure.getInt(…, Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1`. */
  readonly installNonMarketApps: () => number;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L12-34  AndroidAppUpdateInstaller
   ══════════════════════════════════════════════════════════════════════════════ */

export interface AndroidAppUpdateInstallerOptions {
  readonly env: InstallEnvironment;
  /** Android L14-16 `contentUri: (File) -> Uri` (the `FileProvider` default). */
  readonly contentUri: (file: string) => string;
  /** Android L29 `file.isFile` — resolved through the injected file store. */
  readonly fs: UpdateFileStore;
}

/** Android L12-34 `internal class AppUpdateInstaller`. */
export class AndroidAppUpdateInstaller {
  private readonly env: InstallEnvironment;
  private readonly contentUri: (file: string) => string;
  private readonly fs: UpdateFileStore;

  constructor(options: AndroidAppUpdateInstallerOptions) {
    this.env = options.env;
    this.contentUri = options.contentUri;
    this.fs = options.fs;
  }

  /* Kotlin L18-22  @Suppress("DEPRECATION") fun canInstall(): Boolean */
  async canInstall(): Promise<boolean> {
    try {
      if (this.env.sdkInt >= UNKNOWN_SOURCES_SDK) return this.env.canRequestPackageInstalls();
      return this.env.installNonMarketApps() === 1;
    } catch {
      // Kotlin L22 `.getOrDefault(false)`
      return false;
    }
  }

  /* Kotlin L24-26  fun permissionIntent(): Intent */
  permissionIntent(): IntentDescriptor {
    if (this.env.sdkInt >= UNKNOWN_SOURCES_SDK) {
      return {
        action: ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        // Kotlin L25 `Uri.parse("package:${context.packageName}")`
        data: `package:${this.env.packageName}`,
        type: null,
        flags: 0,
        clipLabel: null,
      };
    }
    return { action: ACTION_SECURITY_SETTINGS, data: null, type: null, flags: 0, clipLabel: null };
  }

  /* Kotlin L28-34  fun installationIntent(file: File): Intent */
  async installationIntent(file: string): Promise<IntentDescriptor> {
    // Kotlin L29 `check(file.isFile) { "安装包已不存在，请重新下载" }`
    if (!(await this.fs.isFile(file))) throw new Error('安装包已不存在，请重新下载');
    const uri = this.contentUri(file);
    return {
      action: ACTION_VIEW,
      data: uri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      clipLabel: APK_CLIP_LABEL,
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   The `AppInstaller` port — what the UI actually calls
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * The platform half of the update flow that `ui/components/AppUpdateDialog.tsx`
 * reaches through its declared `AppUpdateActions` port (the download/install half that
 * Android's `rememberLauncherForActivityResult` blocks used to provide).
 *
 * Every method is structurally identical to that `AppUpdateActions` interface, so a
 * single object can be handed to both. `src/ui/**` may import it from
 * `@core/update`; `src/core/**` must never import the UI module back.
 */
export interface AppUpdateActions {
  /** Android L19 `platform.canInstall()`. */
  canInstall(): boolean;
  /** Android L58-59 `installer.launch(platform.installationIntent(manager.apkFile))`. */
  openInstaller(): void;
  /** Android L110 `permission.launch(platform.permissionIntent())`. */
  openPermissionSettings(): void;
  /** Android L74-90 `ActivityResultContracts.CreateDocument(mime)` — writes the APK bytes. */
  exportApk(fileName: string): Promise<void>;
  /** Android L97-101 `LocalUriHandler.openUri(url)`. */
  openBrowser(url: string): void;
}

export interface CreateAppUpdateActionsOptions {
  /** Android L19 `platform.canInstall()`. */
  readonly canInstall: () => boolean;
  /** Android L58-59 `installer.launch(platform.installationIntent(manager.apkFile))`. */
  readonly openInstaller: () => void;
  /** Android L110 `permission.launch(platform.permissionIntent())`. */
  readonly openPermissionSettings: () => void;
  /**
   * Android L74-90 the `CreateDocument` contract: the SAF picker, resolving with a
   * writable destination or with `null` when the user cancelled (Kotlin L75
   * `if (uri != null && !exporting)`).
   */
  readonly pickExportDestination: (
    fileName: string,
    mimeType: string,
  ) => Promise<ExportDestination | null>;
  /** Android L78-81 `manager.apkFile.inputStream()` — the bytes the export copies. */
  readonly readPackageBytes: () => Promise<Uint8Array>;
  /** Android L97-101 `LocalUriHandler.openUri(url)`. */
  readonly openBrowser: (url: string) => void;
}

/**
 * The resolved `CreateDocument` destination — the platform's equivalent of the
 * `contentResolver.openOutputStream(uri, "w")` handle at Kotlin L80.
 */
export interface ExportDestination {
  /** Android L81 `manager.apkFile.inputStream().use { it.copyTo(output, 64 * 1024) }`. */
  write(bytes: Uint8Array): Promise<void>;
}

/* ══════════════════════════════════════════════════════════════════════════════
   iOS / web: there is no APK installer — say so, loudly
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin L28-34 mints an `ACTION_VIEW` intent on a `FileProvider` URI and Android's
 * package installer takes it from there. iOS has NO equivalent: the OS forbids
 * installing a side-loaded package, and an `.apk` cannot even be parsed there.
 *
 * REVIEW FIX (the "don't fake success" rule): `createAppUpdateActions` below accepts
 * whatever `openInstaller` a host hands it, so a host that wired nothing got a silent
 * no-op — `AppUpdateDialogHost.install()` would call `openInstaller()`, then
 * `manager.installing()`, and the dialog would sit on 「更新已就绪」 forever, i.e. a fake
 * success. A host that genuinely cannot install MUST now say so out loud via
 * {@link createUnavailableAppUpdateActions}, whose `openInstaller()` throws; the dialog
 * catches it (Kotlin L61-63's `runCatching { … }.onFailure { installationFailed(…) }`)
 * and renders the failure line. Opening the release page in a browser is deliberately
 * NOT an acceptable stand-in here — the installer button must not quietly become a link.
 *
 * `canInstall()` deliberately returns `true` on this path so the dialog does NOT divert
 * into the 「选择安装方式」 / 「允许安装」 unknown-sources branch — that Android-only
 * permission model has no meaning here, and the honest failure belongs on the installer
 * path.
 */
export const APP_INSTALLER_UNAVAILABLE =
  '当前平台不支持安装应用包。请从发布页下载后手动更新。';

/** Thrown by {@link createUnavailableAppUpdateActions} — carries the UI-facing reason. */
export class AppInstallerUnavailableError extends Error {
  constructor(message: string = APP_INSTALLER_UNAVAILABLE) {
    super(message);
    this.name = 'AppInstallerUnavailableError';
  }
}

/**
 * The `AppUpdateActions` for a platform with NO package installer (iOS, web).
 *
 * `openInstaller()` / `openPermissionSettings()` throw {@link AppInstallerUnavailableError}
 * on purpose — see the note above. The browser half is fully functional and keeps the
 * verbatim Kotlin 「浏览器下载」 / 「查看完整更新说明」 destinations, so the user always has
 * a real way forward; nothing here pretends an install happened.
 */
export function createUnavailableAppUpdateActions(
  openBrowser: (url: string) => void,
): AppUpdateActions {
  return {
    canInstall: () => true,
    openInstaller(): void {
      throw new AppInstallerUnavailableError();
    },
    openPermissionSettings(): void {
      throw new AppInstallerUnavailableError();
    },
    async exportApk(): Promise<void> {
      throw new AppInstallerUnavailableError();
    },
    openBrowser,
  };
}

/**
 * Builds the `AppUpdateActions` object `AppUpdateDialogHost` needs.
 *
 * Android's `CreateDocument` flow was: pick a destination → `openOutputStream(uri, "w")`
 * → copy `manager.apkFile` in 64 KiB chunks → toast. Here the platform owns the picker
 * (`pickExportDestination`) and the sink (`ExportDestination.write`), so core keeps only
 * the copy-and-report contract. A cancelled picker is a silent no-op, exactly as in
 * Kotlin L75; every other failure propagates so the dialog can render
 * `导出失败：${e.message}`.
 */
export function createAppUpdateActions(options: CreateAppUpdateActionsOptions): AppUpdateActions {
  return {
    canInstall: options.canInstall,
    openInstaller: options.openInstaller,
    openPermissionSettings: options.openPermissionSettings,
    async exportApk(fileName: string): Promise<void> {
      const destination = await options.pickExportDestination(fileName, APK_MIME_TYPE);
      if (destination === null) return;
      await destination.write(await options.readPackageBytes());
    },
    openBrowser: options.openBrowser,
  };
}

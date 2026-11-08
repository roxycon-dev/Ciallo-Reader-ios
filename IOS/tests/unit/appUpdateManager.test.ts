/**
 * Tests for `src/core/update/appUpdateManager.ts`,
 * `src/core/update/appUpdateInstaller.ts` and `src/core/update/appUpdateCleanupReceiver.ts`
 * (ports of `AppUpdateManager.kt` / `AppUpdateInstaller.kt` / `AppUpdateCleanupReceiver.kt`).
 *
 * Covers the stage machine, the progress mapping into `AppUpdateState`, the restore /
 * retention pass and the Android intent descriptors.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  APP_UPDATE_STAGES,
  AppUpdateManager,
  MESSAGE_DOWNLOAD_CANCELLED,
  MESSAGE_DOWNLOAD_FAILED,
  MESSAGE_INSTALLATION_INCOMPLETE,
  MESSAGE_PACKAGE_READY,
  MESSAGE_PERMISSION_NEEDED,
  UpdateStateStore,
  copyUpdateState,
  getAppUpdateManager,
  hasPackage,
  initialUpdateState,
  isTransferring,
  resetAppUpdateManager,
  type AppUpdateManagerScope,
  type AppUpdateStage,
  type AppUpdateState,
} from '../../src/core/update/appUpdateManager';
import {
  ACTION_MANAGE_UNKNOWN_APP_SOURCES,
  ACTION_SECURITY_SETTINGS,
  ACTION_VIEW,
  APK_CLIP_LABEL,
  APK_MIME_TYPE,
  AndroidAppUpdateInstaller,
  FLAG_GRANT_READ_URI_PERMISSION,
  UNKNOWN_SOURCES_SDK,
  createAppUpdateActions,
  type ExportDestination,
  type InstallEnvironment,
} from '../../src/core/update/appUpdateInstaller';
import { createAppUpdateCleanupReceiver } from '../../src/core/update/appUpdateCleanupReceiver';
import type {
  AppPackageIdentity,
  AppUpdateStore,
  PendingAppUpdate,
  UpdateFileStore,
} from '../../src/core/update/appUpdateStore';
import { AtomicMetadataFile } from '../../src/core/update/appUpdateStore';
import type { AppUpdateDownload, UpdateProgressCallback } from '../../src/core/update/appUpdateDownload';
import { UpdateApkVerifier, updateFileSha256, updateHttpClientFrom } from '../../src/core/update/appUpdateDownload';
import {
  UPDATE_REPOSITORY,
  GithubCheckFailure,
  GithubUpdateChecker,
  isNewerVersion,
  makeUpdateRelease,
  officialUpdateAsset,
  releaseVersion,
  stableTag,
  versionParts,
  type UpdateApkAsset,
  type UpdateRelease,
} from '../../src/core/update/githubUpdateChecker';

const TAG = 'v1.2.3';
const NAME = 'Ciallo-Reader-v1.2.3.apk';
const ASSET_URL = `${UPDATE_REPOSITORY}/releases/download/${TAG}/${NAME}`;
const SHA = 'c'.repeat(64);

const ASSET: UpdateApkAsset = { name: NAME, url: ASSET_URL, size: 100, sha256: null };
const RELEASE: UpdateRelease = makeUpdateRelease(
  TAG,
  `${UPDATE_REPOSITORY}/releases/tag/${TAG}`,
  'notes',
  ASSET,
);

/* ── fakes ─────────────────────────────────────────────────────────────────────── */

/** Structural stand-in for `AppUpdateStore`; the class has private members the fake cannot mirror. */
type StoreShape = Pick<
  AppUpdateStore,
  'apkFile' | 'fileStore' | 'deleteQuietly' | 'clearPartialFiles' | 'cleanupInstalled' | 'clear' | 'load' | 'installedCode' | 'newTransferFile' | 'save'
>;

class FakeStore implements StoreShape {
  saved: PendingAppUpdate | null = null;
  apkExists = true;
  installedCodeValue = 1;
  cleared = 0;
  partialsCleared = 0;
  cleanupResult = false;
  savedPaths: string[] = [];
  deleted: string[] = [];
  transferCounter = 0;

  private readonly fs = {
    filesDir: 'files',
    exists: async () => this.apkExists,
    isFile: async () => this.apkExists,
    size: async () => 4096,
    readFile: async () => new Uint8Array(4096),
    writeFile: async () => {},
    delete: async () => true,
    list: async () => [] as string[] | null,
    rename: async () => true,
    mkdirs: async () => {},
    canonicalPath: (path: string) => path,
  } as unknown as UpdateFileStore;

  async apkFile(): Promise<string> {
    return 'files/app_updates/update.apk';
  }
  get fileStore(): UpdateFileStore {
    return this.fs;
  }
  async deleteQuietly(path: string): Promise<void> {
    this.deleted.push(path);
  }
  async clearPartialFiles(): Promise<void> {
    this.partialsCleared += 1;
  }
  async cleanupInstalled(): Promise<boolean> {
    return this.cleanupResult;
  }
  async clear(): Promise<void> {
    this.cleared += 1;
    this.saved = null;
  }
  async load(): Promise<PendingAppUpdate | null> {
    return this.saved;
  }
  async installedCode(): Promise<number> {
    return this.installedCodeValue;
  }
  async newTransferFile(): Promise<string> {
    this.transferCounter += 1;
    return `files/app_updates/${this.transferCounter}.part`;
  }
  async save(file: string, pending: PendingAppUpdate): Promise<void> {
    this.savedPaths.push(file);
    this.saved = pending;
  }
}

class FakeDownloader implements Pick<AppUpdateDownload, 'download'> {
  calls: Array<{ tag: string; destination: string }> = [];
  behaviour: (
    onProgress: UpdateProgressCallback,
    destination: string,
    signal?: AbortSignal,
  ) => Promise<void> = async () => {};

  async download(
    _asset: UpdateApkAsset,
    tag: string,
    destination: string,
    onProgress: UpdateProgressCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    this.calls.push({ tag, destination });
    await this.behaviour(onProgress, destination, signal);
  }
}

/** A scope that runs tasks eagerly and lets a test await them. */
const eagerScope: AppUpdateManagerScope = {
  launch(task) {
    return task().catch(() => undefined);
  },
};

function makeManager(options: {
  store?: FakeStore;
  downloader?: FakeDownloader;
  verify?: (file: string, release: UpdateRelease) => Promise<number>;
  sha256?: (file: string) => Promise<string>;
  scope?: AppUpdateManagerScope;
} = {}): { manager: AppUpdateManager; store: FakeStore; downloader: FakeDownloader } {
  const store = options.store ?? new FakeStore();
  const downloader = options.downloader ?? new FakeDownloader();
  const manager = new AppUpdateManager({
    store: store as unknown as AppUpdateStore,    downloader: downloader as unknown as AppUpdateDownload,
    verify: options.verify ?? (async () => 3),
    sha256: options.sha256 ?? (async () => SHA),
    scope: options.scope ?? eagerScope,
  });
  return { manager, store, downloader };
}

/** Lets a queued microtask chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/* ── state helpers ─────────────────────────────────────────────────────────────── */

describe('AppUpdateStage helpers', () => {
  it('lists the seven Kotlin enum entries in declaration order', () => {
    expect([...APP_UPDATE_STAGES]).toEqual([
      'AVAILABLE',
      'DOWNLOADING',
      'VERIFYING',
      'READY',
      'NEED_PERMISSION',
      'INSTALLING',
      'FAILED',
    ]);
  });

  it('initialUpdateState carries every Kotlin default', () => {
    expect(initialUpdateState()).toEqual({
      release: null,
      stage: 'AVAILABLE',
      visible: false,
      downloaded: 0,
      total: null,
      message: null,
      autoInstall: false,
    });
  });

  it('transferring is DOWNLOADING or VERIFYING', () => {
    for (const stage of APP_UPDATE_STAGES) {
      expect(isTransferring(copyUpdateState(initialUpdateState(), { stage }))).toBe(
        stage === 'DOWNLOADING' || stage === 'VERIFYING',
      );
    }
  });

  it('hasPackage is READY, NEED_PERMISSION or INSTALLING', () => {
    for (const stage of APP_UPDATE_STAGES) {
      expect(hasPackage(copyUpdateState(initialUpdateState(), { stage }))).toBe(
        stage === 'READY' || stage === 'NEED_PERMISSION' || stage === 'INSTALLING',
      );
    }
  });

  it('copyUpdateState leaves untouched fields alone', () => {
    const base = copyUpdateState(initialUpdateState(), { stage: 'READY', downloaded: 9 });
    expect(copyUpdateState(base, { visible: true })).toEqual({
      release: null,
      stage: 'READY',
      visible: true,
      downloaded: 9,
      total: null,
      message: null,
      autoInstall: false,
    });
  });
});

describe('UpdateStateStore', () => {
  it('publishes the current snapshot and every update', () => {
    const store = new UpdateStateStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.stage));
    store.update((it) => copyUpdateState(it, { stage: 'READY' }));
    store.setValue(initialUpdateState());
    unsubscribe();
    store.update((it) => copyUpdateState(it, { stage: 'FAILED' }));
    expect(seen).toEqual(['AVAILABLE', 'READY', 'AVAILABLE']);
    // The value still changes after unsubscribing; only the notification stops.
    expect(store.value.stage).toBe('FAILED');
  });
});

/* ── restore pass ──────────────────────────────────────────────────────────────── */

describe('AppUpdateManager initialization (retention policy)', () => {
  it('clears .part files first, then trusts cleanupInstalled', async () => {
    const store = new FakeStore();
    store.cleanupResult = true;
    const { manager } = makeManager({ store });
    await manager.awaitInitialization();
    expect(store.partialsCleared).toBeGreaterThan(0);
    expect(store.cleanupResult).toBe(true);
    expect(manager.state.value.stage).toBe('AVAILABLE');
    expect(manager.state.value.release).toBeNull();
  });

  it('wipes an unreadable record instead of offering a broken package', async () => {
    const store = new FakeStore();
    store.saved = null;
    const { manager } = makeManager({ store });
    await manager.awaitInitialization();
    expect(store.cleared).toBe(1);
    expect(manager.state.value.release).toBeNull();
  });

  it('restores READY only when the file hash and the verifier agree', async () => {
    const store = new FakeStore();
    store.saved = { release: RELEASE, versionCode: 3, sha256: SHA };
    const { manager } = makeManager({ store, verify: async () => 3, sha256: async () => SHA });
    await manager.awaitInitialization();
    expect(manager.state.value.stage).toBe('READY');
    expect(manager.state.value.message).toBe(MESSAGE_PACKAGE_READY);
    expect(manager.state.value.release?.tag).toBe(TAG);
    expect(manager.state.value.visible).toBe(false);
    expect(store.cleared).toBe(0);
  });

  it('clears when the sha256 no longer matches', async () => {
    const store = new FakeStore();
    store.saved = { release: RELEASE, versionCode: 3, sha256: SHA };
    const { manager } = makeManager({ store, sha256: async () => 'd'.repeat(64) });
    await manager.awaitInitialization();
    expect(store.cleared).toBe(1);
    expect(manager.state.value.stage).toBe('AVAILABLE');
  });

  it('clears when the verifier reports a different version code', async () => {
    const store = new FakeStore();
    store.saved = { release: RELEASE, versionCode: 3, sha256: SHA };
    const { manager } = makeManager({ store, verify: async () => 4 });
    await manager.awaitInitialization();
    expect(store.cleared).toBe(1);
  });

  it('clear is not called when cleanupInstalled already ran', async () => {
    const store = new FakeStore();
    store.cleanupResult = true;
    const { manager } = makeManager({ store });
    await manager.awaitInitialization();
    expect(store.cleared).toBe(0);
  });
});

/* ── offer / show / hide ───────────────────────────────────────────────────────── */

describe('AppUpdateManager.offer / show / hide', () => {
  it('offers a release as a fresh visible AVAILABLE frame', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    expect(manager.state.value).toEqual({ ...initialUpdateState(), release: RELEASE, visible: true });
  });

  it('only flips visible when the same tag is already downloaded', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.state.update((it) => copyUpdateState(it, { stage: 'READY', downloaded: 5 }));
    await manager.offer(makeUpdateRelease(TAG, RELEASE.releaseUrl));
    expect(manager.state.value.stage).toBe('READY');
    expect(manager.state.value.downloaded).toBe(5);
    expect(manager.state.value.visible).toBe(true);
    // A DIFFERENT tag resets the whole frame.
    await manager.offer(makeUpdateRelease('v2.0.0', `${UPDATE_REPOSITORY}/releases/tag/v2.0.0`));
    expect(manager.state.value.stage).toBe('AVAILABLE');
    expect(manager.state.value.downloaded).toBe(0);
    expect(manager.state.value.release?.tag).toBe('v2.0.0');
  });

  it('keeps the transfer frame but marks it visible', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.state.update((it) => copyUpdateState(it, { stage: 'DOWNLOADING' }));
    await manager.offer(RELEASE);
    expect(manager.state.value.stage).toBe('DOWNLOADING');
    expect(manager.state.value.visible).toBe(true);
  });

  it('show only reveals a frame that has a release', async () => {
    const { manager } = makeManager();
    manager.show();
    expect(manager.state.value.visible).toBe(false);
    await manager.offer(RELEASE);
    manager.hide();
    expect(manager.state.value.visible).toBe(false);
    manager.show();
    expect(manager.state.value.visible).toBe(true);
  });

  it('hide also clears autoInstall and consumeAutoInstall clears only that flag', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.state.update((it) => copyUpdateState(it, { autoInstall: true, stage: 'READY' }));
    manager.consumeAutoInstall();
    expect(manager.state.value.autoInstall).toBe(false);
    expect(manager.state.value.stage).toBe('READY');
    manager.state.update((it) => copyUpdateState(it, { autoInstall: true }));
    manager.hide();
    expect(manager.state.value).toMatchObject({ visible: false, autoInstall: false });
  });
});

/* ── the download flow and the progress mapping ────────────────────────────────── */

describe('AppUpdateManager.startDownload', () => {
  it('is a no-op without a release or without an apk', async () => {
    const { manager, downloader } = makeManager();
    manager.startDownload();
    await settle();
    expect(downloader.calls).toHaveLength(0);

    await manager.offer(makeUpdateRelease(TAG, RELEASE.releaseUrl));
    manager.startDownload();
    await settle();
    expect(downloader.calls).toHaveLength(0);
  });

  it('maps the progress callback onto AppUpdateState and reaches READY + autoInstall', async () => {
    const downloader = new FakeDownloader();
    downloader.behaviour = async (onProgress) => {
      onProgress(0, 100);
      onProgress(40, 100);
      onProgress(100, 100);
    };
    const { manager, store } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    await settle();
    await settle();
    expect(downloader.calls).toEqual([{ tag: TAG, destination: 'files/app_updates/1.part' }]);
    expect(store.saved).toEqual({ release: RELEASE, versionCode: 3, sha256: SHA });
    // The saved package is committed before any installer intent is permitted.
    expect(store.savedPaths).toEqual(['files/app_updates/1.part']);
    // The .part is renamed into update.apk, so the temporary delete is a no-op path.
    expect(store.deleted).toEqual(['files/app_updates/1.part']);
    expect(manager.state.value.stage).toBe('READY');
    expect(manager.state.value.autoInstall).toBe(true);
    expect(manager.state.value.downloaded).toBe(100);
    expect(manager.state.value.total).toBe(100);
    expect(manager.state.value.visible).toBe(true);
  });

  it('announces the published total as soon as DOWNLOADING starts', async () => {
    const downloader = new FakeDownloader();
    downloader.behaviour = async () => {
      /* never reports progress */
    };
    const { manager } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    expect(manager.state.value).toMatchObject({
      stage: 'DOWNLOADING',
      downloaded: 0,
      total: 100,
      visible: true,
      message: null,
      autoInstall: false,
    });
    await settle();
  });

  it('starts a null total when the release publishes no size', async () => {
    const downloader = new FakeDownloader();
    const { manager } = makeManager({ downloader });
    await manager.offer(
      makeUpdateRelease(TAG, RELEASE.releaseUrl, 'notes', {
        name: NAME,
        url: ASSET_URL,
        size: null,
        sha256: null,
      }),
    );
    manager.startDownload();
    expect(manager.state.value.total).toBeNull();
    await settle();
  });

  it('reports a failure with the exception message truncated to 250 chars', async () => {
    const downloader = new FakeDownloader();
    downloader.behaviour = async () => {
      throw new Error('x'.repeat(400));
    };
    const { manager } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    await settle();
    expect(manager.state.value.stage).toBe('FAILED');
    expect(manager.state.value.message).toHaveLength(250);
    expect(manager.state.value.autoInstall).toBe(false);
  });

  it('falls back to the generic message when the error carries none', async () => {
    const downloader = new FakeDownloader();
    downloader.behaviour = async () => {
      throw { notAnError: true };
    };
    const { manager } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    await settle();
    expect(manager.state.value.stage).toBe('FAILED');
    expect(manager.state.value.message).toBe(MESSAGE_DOWNLOAD_FAILED);
  });

  it('returns to AVAILABLE with "下载已取消" when the transfer is aborted', async () => {
    const downloader = new FakeDownloader();
    downloader.behaviour = async (_onProgress, _destination) => {
      await Promise.resolve();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const { manager, store } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    expect(manager.isTransferActive()).toBe(true);
    await settle();
    await settle();
    expect(manager.state.value.stage).toBe('AVAILABLE');
    expect(manager.state.value.message).toBe(MESSAGE_DOWNLOAD_CANCELLED);
    expect(manager.state.value.autoInstall).toBe(false);
    expect(store.saved).toBeNull();
    expect(manager.isTransferActive()).toBe(false);
  });

  it('cancelDownload aborts the in-flight transfer', async () => {
    const downloader = new FakeDownloader();
    let sawAbort = false;
    downloader.behaviour = async (_onProgress, _destination, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      // A real transport surfaces the abort as a cancelled call.
      sawAbort = signal?.aborted === true;
      if (signal?.aborted === true) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const { manager } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    expect(manager.isTransferActive()).toBe(true);
    manager.cancelDownload();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sawAbort).toBe(true);
    expect(manager.state.value.stage).toBe('AVAILABLE');
    expect(manager.state.value.message).toBe(MESSAGE_DOWNLOAD_CANCELLED);
    expect(manager.isTransferActive()).toBe(false);
  });

  it('ignores a second startDownload while one is running', async () => {
    const downloader = new FakeDownloader();
    let release!: () => void;
    downloader.behaviour = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const { manager } = makeManager({ downloader });
    await manager.offer(RELEASE);
    manager.startDownload();
    manager.startDownload();
    await settle();
    expect(downloader.calls).toHaveLength(1);
    release();
    await settle();
  });
});

/* ── install flow ──────────────────────────────────────────────────────────────── */

describe('AppUpdateManager install flow', () => {
  it('permissionNeeded sets NEED_PERMISSION with the default message', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.permissionNeeded();
    expect(manager.state.value).toMatchObject({
      stage: 'NEED_PERMISSION',
      visible: true,
      message: MESSAGE_PERMISSION_NEEDED,
      autoInstall: false,
    });
    manager.permissionNeeded('自定义');
    expect(manager.state.value.message).toBe('自定义');
  });

  it('installing hides the dialog', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.installing();
    expect(manager.state.value).toMatchObject({ stage: 'INSTALLING', visible: false });
  });

  it('installationReturned resets everything once the version is installed', async () => {
    const store = new FakeStore();
    const { manager } = makeManager({ store });
    await manager.offer(RELEASE);
    manager.installing();
    store.cleanupResult = true;
    await manager.installationReturned();
    expect(manager.state.value).toEqual(initialUpdateState());
  });

  it('installationReturned keeps the package and explains when the install did not land', async () => {
    const store = new FakeStore();
    const { manager } = makeManager({ store });
    await manager.offer(RELEASE);
    manager.installing();
    store.cleanupResult = false;
    await manager.installationReturned();
    expect(manager.state.value).toMatchObject({
      stage: 'READY',
      visible: true,
      message: MESSAGE_INSTALLATION_INCOMPLETE,
      autoInstall: false,
    });
  });

  it('installationReturned ignores a state that is no longer INSTALLING', async () => {
    const store = new FakeStore();
    const { manager } = makeManager({ store });
    await manager.offer(RELEASE);
    store.cleanupResult = true;
    await manager.installationReturned();
    expect(manager.state.value.release?.tag).toBe(TAG);
  });

  it('installationFailed returns to READY with the given message', async () => {
    const { manager } = makeManager();
    await manager.offer(RELEASE);
    manager.installing();
    manager.installationFailed('无法打开系统安装页面。');
    expect(manager.state.value).toMatchObject({
      stage: 'READY',
      visible: true,
      message: '无法打开系统安装页面。',
      autoInstall: false,
    });
  });
});

/* ── the process-lifetime singleton ────────────────────────────────────────────── */

describe('getAppUpdateManager', () => {
  beforeEach(() => {
    resetAppUpdateManager();
  });

  it('builds once and hands back the same instance', async () => {
    expect(getAppUpdateManager()).toBeNull();
    const { manager } = makeManager();
    let builds = 0;
    expect(getAppUpdateManager(() => {
      builds += 1;
      return manager;
    })).toBe(manager);
    expect(getAppUpdateManager(() => {
      builds += 1;
      return manager;
    })).toBe(manager);
    expect(builds).toBe(1);
    resetAppUpdateManager();
  });
});

/* ── AppUpdateInstaller ────────────────────────────────────────────────────────── */

function makeInstaller(overrides: Partial<InstallEnvironment> = {}): {
  installer: AndroidAppUpdateInstaller;
  files: Set<string>;
} {
  const files = new Set<string>(['files/app_updates/update.apk']);
  const env: InstallEnvironment = {
    sdkInt: UNKNOWN_SOURCES_SDK,
    packageName: 'com.example.novelreader',
    canRequestPackageInstalls: () => true,
    installNonMarketApps: () => 0,
    ...overrides,
  };
  const fs = {
    isFile: async (path: string) => files.has(path),
  } as unknown as UpdateFileStore;
  return {
    installer: new AndroidAppUpdateInstaller({
      env,
      contentUri: (file) => `content://com.example.novelreader.fileprovider/${file}`,
      fs,
    }),
    files,
  };
}

describe('AndroidAppUpdateInstaller', () => {
  it('canInstall uses canRequestPackageInstalls on API 26+', async () => {
    expect(await makeInstaller().installer.canInstall()).toBe(true);
    expect(
      await makeInstaller({ canRequestPackageInstalls: () => false }).installer.canInstall(),
    ).toBe(false);
    expect(
      await makeInstaller({ sdkInt: 25, canRequestPackageInstalls: () => false, installNonMarketApps: () => 1 })
        .installer.canInstall(),
    ).toBe(true);
  });

  it('canInstall degrades to false when the platform probe throws', async () => {
    const installer = makeInstaller({
      canRequestPackageInstalls: () => {
        throw new Error('SecurityException');
      },
    }).installer;
    expect(await installer.canInstall()).toBe(false);
  });

  it('permissionIntent targets the unknown-sources screen on API 26+', () => {
    expect(makeInstaller().installer.permissionIntent()).toEqual({
      action: ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      data: 'package:com.example.novelreader',
      type: null,
      flags: 0,
      clipLabel: null,
    });
    expect(makeInstaller({ sdkInt: 25 }).installer.permissionIntent()).toEqual({
      action: ACTION_SECURITY_SETTINGS,
      data: null,
      type: null,
      flags: 0,
      clipLabel: null,
    });
  });

  it('installationIntent carries every value the Kotlin builder sets', async () => {
    const { installer } = makeInstaller();
    expect(await installer.installationIntent('files/app_updates/update.apk')).toEqual({
      action: ACTION_VIEW,
      data: 'content://com.example.novelreader.fileprovider/files/app_updates/update.apk',
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      clipLabel: APK_CLIP_LABEL,
    });
  });

  it('installationIntent rejects a missing package', async () => {
    const { installer } = makeInstaller();
    await expect(installer.installationIntent('files/app_updates/gone.apk')).rejects.toThrow(
      '安装包已不存在，请重新下载',
    );
  });
});

describe('createAppUpdateActions (the AppUpdateDialog.tsx port)', () => {
  it('exposes exactly the five methods AppUpdateDialogHost calls', async () => {
    const events: string[] = [];
    const actions = createAppUpdateActions({
      canInstall: () => {
        events.push('canInstall');
        return true;
      },
      openInstaller: () => events.push('openInstaller'),
      openPermissionSettings: () => events.push('openPermissionSettings'),
      pickExportDestination: async (fileName, mimeType) => {
        events.push(`pick:${fileName}:${mimeType}`);
        return {
          write: async (bytes) => {
            events.push(`write:${bytes.length}`);
          },
        } satisfies ExportDestination;
      },
      readPackageBytes: async () => new Uint8Array(7),
      openBrowser: (url) => events.push(`browser:${url}`),
    });
    expect(actions.canInstall()).toBe(true);
    actions.openInstaller();
    actions.openPermissionSettings();
    await actions.exportApk('Ciallo-Reader.apk');
    actions.openBrowser('https://example.test');
    expect(events).toEqual([
      'canInstall',
      'openInstaller',
      'openPermissionSettings',
      'pick:Ciallo-Reader.apk:application/vnd.android.package-archive',
      'write:7',
      'browser:https://example.test',
    ]);
  });

  it('treats a cancelled picker as a silent no-op', async () => {
    const events: string[] = [];
    const actions = createAppUpdateActions({
      canInstall: () => true,
      openInstaller: () => {},
      openPermissionSettings: () => {},
      pickExportDestination: async () => null,
      readPackageBytes: async () => {
        events.push('read');
        return new Uint8Array(1);
      },
      openBrowser: () => {},
    });
    await expect(actions.exportApk('x.apk')).resolves.toBeUndefined();
    // Kotlin L75 `if (uri != null && …)`: nothing is read and nothing is written.
    expect(events).toEqual([]);
  });

  it('propagates a write failure so the dialog can render 导出失败', async () => {
    const actions = createAppUpdateActions({
      canInstall: () => true,
      openInstaller: () => {},
      openPermissionSettings: () => {},
      pickExportDestination: async () => ({
        write: async () => {
          throw new Error('无法写入选择的位置');
        },
      }),
      readPackageBytes: async () => new Uint8Array(1),
      openBrowser: () => {},
    });
    await expect(actions.exportApk('x.apk')).rejects.toThrow('无法写入选择的位置');
  });
});

/* ── AppUpdateCleanupReceiver ──────────────────────────────────────────────────── */

describe('AppUpdateCleanupReceiver', () => {
  it('ignores every action except ACTION_MY_PACKAGE_REPLACED', async () => {
    let cleaned = 0;
    let finished = 0;
    const receiver = createAppUpdateCleanupReceiver({
      cleanupInstalled: async () => {
        cleaned += 1;
        return true;
      },
    });
    await receiver.onReceive(null, () => {
      finished += 1;
    });
    await receiver.onReceive('android.intent.action.BOOT_COMPLETED', () => {
      finished += 1;
    });
    expect(cleaned).toBe(0);
    expect(finished).toBe(2);
  });

  it('runs the cleanup and always finishes the broadcast', async () => {
    let cleaned = 0;
    let finished = 0;
    const receiver = createAppUpdateCleanupReceiver({
      cleanupInstalled: async () => {
        cleaned += 1;
        return true;
      },
    });
    await receiver.onReceive('android.intent.action.MY_PACKAGE_REPLACED', () => {
      finished += 1;
    });
    expect(cleaned).toBe(1);
    expect(finished).toBe(1);
  });

  it('absorbs a cleanup failure but still finishes', async () => {
    let finished = 0;
    const seen: unknown[] = [];
    const receiver = createAppUpdateCleanupReceiver(
      {
        cleanupInstalled: async () => {
          throw new Error('storage gone');
        },
      },
      (error) => seen.push(error),
    );
    await receiver.onReceive('android.intent.action.MY_PACKAGE_REPLACED', () => {
      finished += 1;
    });
    expect(finished).toBe(1);
    expect(seen).toHaveLength(1);
  });
});

describe('AppPackageIdentity shape', () => {
  it('is the only version source the store needs', () => {
    const pkg: AppPackageIdentity = { packageName: 'com.example.novelreader', versionCode: 7 };
    expect(pkg.versionCode).toBe(7);
  });
});

describe('the @core/update barrel', () => {
  it('re-exports every name AppUpdateDialog.tsx needs from one module', async () => {
    const barrel = await import('../../src/core/update');
    // Types the dialog's structural mirrors must match.
    const stage: AppUpdateStage = 'READY';
    const state: AppUpdateState = barrel.initialUpdateState();
    const release: UpdateRelease = barrel.makeUpdateRelease(TAG, RELEASE.releaseUrl);
    const asset: UpdateApkAsset = { name: NAME, url: ASSET_URL, size: null, sha256: null };
    // Classes / factories the host composes.
    const parts: Array<unknown> = [
      AppUpdateManager,
      barrel.AppUpdateStore,
      barrel.AppUpdateDownload,
      UpdateApkVerifier,
      AndroidAppUpdateInstaller,
      AtomicMetadataFile,
      UpdateStateStore,
      GithubUpdateChecker,
      GithubCheckFailure,
      createAppUpdateActions,
      createAppUpdateCleanupReceiver,
      resetAppUpdateManager,
      getAppUpdateManager,
      // Pure helpers used by the tests and by the wiring code.
      versionParts,
      isNewerVersion,
      stableTag,
      officialUpdateAsset,
      releaseVersion,
      isTransferring,
      hasPackage,
      copyUpdateState,
      updateFileSha256,
      updateHttpClientFrom,
    ];
    expect(parts.every((part) => part != null)).toBe(true);
    expect(barrel.MAX_UPDATE_BYTES).toBe(192 * 1024 * 1024);
    expect(barrel.UPDATE_REPOSITORY).toBe('https://github.com/roxycon-dev/Ciallo-Reader');
    expect(barrel.APK_MIME_TYPE).toBe('application/vnd.android.package-archive');
    expect(barrel.APP_UPDATE_DIRECTORY).toBe('app_updates');
    expect(barrel.APP_UPDATE_APK_FILE).toBe('update.apk');
    expect(stage).toBe('READY');
    expect(state.stage).toBe('AVAILABLE');
    expect(release.version).toBe('1.2.3');
    expect(asset.size).toBeNull();
    expect(barrel.APP_UPDATE_STAGES).toHaveLength(7);
    expect(barrel.MESSAGE_PACKAGE_READY).toBe('安装包已下载，可继续安装');
    expect(barrel.MESSAGE_DOWNLOAD_CANCELLED).toBe('下载已取消');
    expect(barrel.MESSAGE_DOWNLOAD_FAILED).toBe('更新下载失败，请重试或使用浏览器下载');
    expect(barrel.MESSAGE_PERMISSION_NEEDED).toBe(
      '尚未允许 Ciallo Reader 安装未知应用。可前往授权，也可导出安装包或用浏览器下载。',
    );
    expect(barrel.MESSAGE_INSTALLATION_INCOMPLETE).toBe(
      '安装包已保留。如果尚未完成安装，可以重试或导出安装包',
    );
    expect(barrel.PACKAGE_REPLACED_ACTION).toBe('android.intent.action.MY_PACKAGE_REPLACED');
  });
});

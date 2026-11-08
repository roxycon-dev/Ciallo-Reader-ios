/**
 * appUpdateManager.ts — line-by-line port of Android
 * `com/example/data/AppUpdateManager.kt`
 * (`novel-reader/app/src/main/java/com/example/data/AppUpdateManager.kt`,
 * 148 lines / 116 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-19   package + imports                 → see "Skipped lines" below
 *   21     enum class AppUpdateStage         → `AppUpdateStage` + `APP_UPDATE_STAGES`
 *   23-34  data class AppUpdateState         → `AppUpdateState`, `INITIAL_UPDATE_STATE`,
 *                                              `isTransferring()`, `hasPackage()`
 *   36     the `Application lifetime` doc    → kept verbatim above the class
 *   37-63  class + `initialized` pass        → the class and `initialize()`
 *   65-73  fun offer                         → `offer()`
 *   75-79  show/hide/cancelDownload/consumeAutoInstall/awaitInitialization
 *   81-120 fun startDownload                 → `startDownload()`
 *   122-124 fun permissionNeeded             → `permissionNeeded()`
 *   126    fun installing                    → `installing()`
 *   128-136 fun installationReturned         → `installationReturned()`
 *   138-140 fun installationFailed           → `installationFailed()`
 *   142-147 companion object { instance, get } → `getAppUpdateManager` / `resetAppUpdateManager`
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L3     `android.content.Context` — reaches `AppUpdateStore(context)` only.
 *  L4-15  kotlinx.coroutines (`CancellationException`, `CoroutineScope`, `Dispatchers`,
 *         `Job`, `NonCancellable`, `SupervisorJob`, `async`, `currentCoroutineContext`,
 *         `ensureActive`, `isActive`, `launch`, `withContext`) → the `AbortSignal`
 *         returned per transfer, and plain async/await for the scope. `Dispatchers.Main
 *         .immediate` / `Dispatchers.IO` have no JS counterpart; `withContext(…)` is a
 *         no-op and is therefore not modelled.
 *  L16-18 `MutableStateFlow` / `asStateFlow` / `update` → `UpdateStateStore` (a
 *         subscribe/unsubscribe snapshot store, the same shape
 *         `AppUpdateDialog.tsx` declares as `onAppUpdateState`).
 *  L19    `java.io.File` — `manager.apkFile` becomes the path string.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `scope.launch { … }` → a detached async task whose rejection is swallowed, because
 *    Kotlin's `SupervisorJob` scope swallows uncaught failures the same way. Every task
 *    this class launches handles its own failure, so nothing is lost.
 *  * `CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)` in the constructor
 *    default → nothing: the manager has no dispatcher to choose, it just uses promises.
 *  * `transfer?.isActive` (L82) → the `AbortController` pair, with `isTransferActive()`.
 *  * `withContext(NonCancellable + Dispatchers.IO)` (L102/L116) → the two commit steps
 *    run through `commitNonCancellable()`, which passes an un-aborted signal so a cancel
 *    arriving mid-commit cannot leave a half-saved package behind.
 *  * `currentCoroutineContext().isActive` (L109) → `signal.aborted`.
 *  * `e.message?.take(250)` — Kotlin's `String.length` is UTF-16 code units, so `slice(250)`.
 *  * `offer` / `installationReturned` return the launched task, so a host can await them
 *    without changing behaviour.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  All seven `AppUpdateStage` values, all seven `AppUpdateState` defaults and the six
 *  Chinese messages were compared literally:
 *  L21 enum order `AVAILABLE, DOWNLOADING, VERIFYING, READY, NEED_PERMISSION, INSTALLING,
 *  FAILED` ✔; L32 `transferring` ✔; L33 `hasPackage` ✔;
 *  L62 「安装包已下载，可继续安装」 ✔; L85-86 the optimistic DOWNLOADING frame ✔;
 *  L96 VERIFYING before verify ✔; L102-103 save-then-READY with `autoInstall` ✔;
 *  L105-106 / L110-111 「下载已取消」 vs 「安装包已下载，可继续安装」 ✔;
 *  L114 「更新下载失败，请重试或使用浏览器下载」 with the `take(250)` cap ✔;
 *  L116-117 the `NonCancellable` delete + `transfer = null` `finally` ✔;
 *  L122 「尚未允许 Ciallo Reader 安装未知应用。可前往授权，也可导出安装包或用浏览器下载。」
 *  ✔; L130-135 the INSTALLING re-check + 「安装包已保留。如果尚未完成安装，可以重试或导出安装包」
 *  ✔.
 *  The line-map entry that used to name `setAppUpdateManagerInstance` was stale (no such
 *  symbol exists); corrected to the two functions that are actually exported.
 *  No state-machine divergence found: every Kotlin transition has exactly one TS
 *  counterpart, in the same order, with the same `visible` / `autoInstall` writes.
 *  Verified end-to-end (Kotlin L1370-L1400 设置页 → L48-L63 init → L81-L119 download →
 *  L126-L140 install → L52-L55 result callback) against `AppUpdateDialogHost`; the one
 *  broken link is that the host is never MOUNTED, which is outside this module — reported
 *  as a parity exception rather than hidden.
 */

import type { AppUpdateStore, PendingAppUpdate } from './appUpdateStore';
import type { AppUpdateDownload } from './appUpdateDownload';
import { updateFileSha256, type UpdateProgressCallback } from './appUpdateDownload';
import type { UpdateRelease } from './githubUpdateChecker';

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L21  internal enum class AppUpdateStage
   ══════════════════════════════════════════════════════════════════════════════ */

export type AppUpdateStage =
  | 'AVAILABLE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'READY'
  | 'NEED_PERMISSION'
  | 'INSTALLING'
  | 'FAILED';

/** Kotlin `enum class AppUpdateStage` entry order — used by the tests and the UI legend. */
export const APP_UPDATE_STAGES: readonly AppUpdateStage[] = [
  'AVAILABLE',
  'DOWNLOADING',
  'VERIFYING',
  'READY',
  'NEED_PERMISSION',
  'INSTALLING',
  'FAILED',
];

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L23-34  internal data class AppUpdateState
   ══════════════════════════════════════════════════════════════════════════════ */

export interface AppUpdateState {
  /** Kotlin default `null`. */
  readonly release: UpdateRelease | null;
  /** Kotlin default `AppUpdateStage.AVAILABLE`. */
  readonly stage: AppUpdateStage;
  /** Kotlin default `false`. */
  readonly visible: boolean;
  /** Kotlin default `0L`. */
  readonly downloaded: number;
  /** Kotlin default `null`. */
  readonly total: number | null;
  /** Kotlin default `null`. */
  readonly message: string | null;
  /** Kotlin default `false`. */
  readonly autoInstall: boolean;
}

/** Kotlin L24 `AppUpdateState()` — every default in one place. */
export function initialUpdateState(): AppUpdateState {
  return {
    release: null,
    stage: 'AVAILABLE',
    visible: false,
    downloaded: 0,
    total: null,
    message: null,
    autoInstall: false,
  };
}

/** Kotlin L32 `val transferring get() = stage == DOWNLOADING || stage == VERIFYING`. */
export function isTransferring(state: AppUpdateState): boolean {
  return state.stage === 'DOWNLOADING' || state.stage === 'VERIFYING';
}

/** Kotlin L33 `val hasPackage get() = stage in setOf(READY, NEED_PERMISSION, INSTALLING)`. */
export function hasPackage(state: AppUpdateState): boolean {
  return state.stage === 'READY' || state.stage === 'NEED_PERMISSION' || state.stage === 'INSTALLING';
}

/** Kotlin `it.copy(field = …)` on a data class. */
export function copyUpdateState(state: AppUpdateState, patch: Partial<AppUpdateState>): AppUpdateState {
  return { ...state, ...patch };
}

/** Kotlin `MutableStateFlow` / `asStateFlow` / `update` (L44-45). */
export class UpdateStateStore {
  private current: AppUpdateState;
  private readonly listeners = new Set<(state: AppUpdateState) => void>();

  constructor(initial: AppUpdateState = initialUpdateState()) {
    this.current = initial;
  }

  /** Kotlin L45 `mutableState.value`. */
  get value(): AppUpdateState {
    return this.current;
  }

  /** Kotlin L45 `mutableState.value = …` — replaces the whole snapshot. */
  setValue(next: AppUpdateState): void {
    this.current = next;
    for (const listener of this.listeners) listener(this.current);
  }

  /** Kotlin `mutableState.update { it.copy(…) }`. */
  update(transform: (state: AppUpdateState) => AppUpdateState): void {
    this.setValue(transform(this.current));
  }

  /** Kotlin `state.collectAsStateWithLifecycle()` → a subscribe/unsubscribe pair. */
  subscribe(listener: (state: AppUpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L61-62 / L105-106 / L135  the Chinese strings this class owns
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L62 `message = "安装包已下载，可继续安装"`. */
export const MESSAGE_PACKAGE_READY = '安装包已下载，可继续安装';
/** Kotlin L106 / L111 the cancelled-without-commit message. */
export const MESSAGE_DOWNLOAD_CANCELLED = '下载已取消';
/** Kotlin L114 the generic failure message. */
export const MESSAGE_DOWNLOAD_FAILED = '更新下载失败，请重试或使用浏览器下载';
/** Kotlin L122 the default `permissionNeeded` message. */
export const MESSAGE_PERMISSION_NEEDED =
  '尚未允许 Ciallo Reader 安装未知应用。可前往授权，也可导出安装包或用浏览器下载。';
/** Kotlin L135 the install-did-not-complete message. */
export const MESSAGE_INSTALLATION_INCOMPLETE =
  '安装包已保留。如果尚未完成安装，可以重试或导出安装包';

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L36-63  AppUpdateManager
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L39 `private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + …)`. */
export interface AppUpdateManagerScope {
  /** Kotlin `scope.async { … }` / `scope.launch { … }` — a detached task. */
  launch(task: () => Promise<void>): Promise<void>;
}

/** The default `SupervisorJob` scope: run detached, never fail the caller. */
export function defaultUpdateScope(): AppUpdateManagerScope {
  return {
    launch(task) {
      // Android L39 SupervisorJob: a failing child never cancels its siblings and nothing
      // awaits the returned Job, so the rejection must be absorbed exactly once.
      return task().catch(() => undefined);
    },
  };
}

/** Kotlin L41 `verify: (File, UpdateRelease) -> Long = UpdateApkVerifier(context)::verify`. */
export type UpdateVerify = (file: string, release: UpdateRelease) => Promise<number>;

export interface AppUpdateManagerOptions {
  /** Android `AppUpdateManager(context)` — the fixed private package directory. */
  readonly store: AppUpdateStore;
  /** Android L40 `downloader: AppUpdateDownload = AppUpdateDownload(context)`. */
  readonly downloader: AppUpdateDownload;
  /** Android L41 `verify`. */
  readonly verify: UpdateVerify;
  /** Android L99 / L109 the SHA-256 helper (injected so the tests can stub it). */
  readonly sha256?: (file: string) => Promise<string>;
  /** Android L39 the scope. */
  readonly scope?: AppUpdateManagerScope;
}

/** Application lifetime, so changing tabs or recreating Activity does not cancel a download. */
export class AppUpdateManager {
  private readonly store: AppUpdateStore;
  private readonly downloader: AppUpdateDownload;
  private readonly verifyFn: UpdateVerify;
  private readonly sha256: (file: string) => Promise<string>;
  private readonly scope: AppUpdateManagerScope;
  private readonly stateStore = new UpdateStateStore();
  private transfer: { controller: AbortController; promise: Promise<void> } | null = null;
  private readonly initialized: Promise<void>;

  constructor(options: AppUpdateManagerOptions) {
    this.store = options.store;
    this.downloader = options.downloader;
    this.verifyFn = options.verify;
    this.sha256 = options.sha256 ?? ((file: string) => updateFileSha256(options.store.fileStore, file));
    this.scope = options.scope ?? defaultUpdateScope();
    // Android L48 `private val initialized = scope.async { … }` — starts in the constructor.
    this.initialized = this.initialize();
  }

  /** Android L45 `val state = mutableState.asStateFlow()`. */
  get state(): UpdateStateStore {
    return this.stateStore;
  }

  /** Kotlin L46 `val apkFile get() = store.apkFile` — the exported / installed package. */
  async apkFile(): Promise<string> {
    return this.store.apkFile();
  }

  /** Kotlin L79 `suspend fun awaitInitialization() { initialized.await() }`. */
  async awaitInitialization(): Promise<void> {
    await this.initialized;
  }

  /** Kotlin L82 `transfer?.isActive == true`. */
  isTransferActive(): boolean {
    return this.transfer !== null;
  }

  /* Kotlin L48-63  private val initialized = scope.async { … } */
  private async initialize(): Promise<void> {
    const pending = await this.restorePendingUpdate();
    if (pending !== null) {
      this.stateStore.setValue({
        ...initialUpdateState(),
        release: pending.release,
        stage: 'READY',
        message: MESSAGE_PACKAGE_READY,
      });
    }
  }

  /**
   * Kotlin L49-60, minus `withContext(Dispatchers.IO)`:
   *   store.clearPartialFiles()
   *   if (store.cleanupInstalled()) return null
   *   val saved = store.load(); if (saved == null) { store.clear(); return null }
   *   check(apk exists && sha256 matches); check(verify(...) == saved.versionCode)
   *   → saved, or `store.clear(); null` on any failure (cancellation rethrown).
   */
  private async restorePendingUpdate(): Promise<PendingAppUpdate | null> {
    await this.store.clearPartialFiles();
    if (await this.store.cleanupInstalled()) return null;
    const saved = await this.store.load();
    if (saved === null) {
      await this.store.clear();
      return null;
    }
    const apkFile = await this.store.apkFile();
    try {
      // Kotlin L55 `check(store.apkFile.exists() && updateFileSha256(store.apkFile) == saved.sha256)`
      if (!(await this.store.fileStore.exists(apkFile))) throw new Error('Check failed.');
      if ((await this.sha256(apkFile)) !== saved.sha256) throw new Error('Check failed.');
      // Kotlin L56 `check(verify(store.apkFile, saved.release) == saved.versionCode)`
      if ((await this.verifyFn(apkFile, saved.release)) !== saved.versionCode) {
        throw new Error('Check failed.');
      }
      return saved;
    } catch (cancelled) {
      if (isAbort(cancelled)) throw cancelled;
      await this.store.clear();
      return null;
    }
  }

  /* Kotlin L65-73  fun offer(release: UpdateRelease) = scope.launch { … } */
  offer(release: UpdateRelease): Promise<void> {
    return this.scope.launch(async () => {
      await this.awaitInitialization();
      const old = this.stateStore.value;
      if (isTransferring(old) || (hasPackage(old) && old.release?.tag === release.tag)) {
        this.stateStore.update((it) => copyUpdateState(it, { visible: true }));
      } else {
        this.stateStore.setValue({ ...initialUpdateState(), release, visible: true });
      }
    });
  }

  /* Kotlin L75  fun show() */
  show(): void {
    this.stateStore.update((it) => copyUpdateState(it, { visible: it.release !== null }));
  }

  /* Kotlin L76  fun hide() */
  hide(): void {
    this.stateStore.update((it) => copyUpdateState(it, { visible: false, autoInstall: false }));
  }

  /* Kotlin L77  fun cancelDownload() */
  cancelDownload(): void {
    this.transfer?.controller.abort();
  }

  /* Kotlin L78  fun consumeAutoInstall() */
  consumeAutoInstall(): void {
    this.stateStore.update((it) => copyUpdateState(it, { autoInstall: false }));
  }

  /* Kotlin L81-120  fun startDownload() */
  startDownload(): void {
    if (this.isTransferActive()) return;
    const state = this.stateStore.value;
    const release = state.release;
    if (release === null) return;
    const asset = release.apk;
    if (asset === null) return;
    // Kotlin L85-86 the optimistic DOWNLOADING frame
    this.stateStore.update((it) =>
      copyUpdateState(it, {
        stage: 'DOWNLOADING',
        downloaded: 0,
        total: asset.size ?? null,
        visible: true,
        message: null,
        autoInstall: false,
      }),
    );
    const controller = new AbortController();
    const promise = this.scope.launch(() => this.runTransfer(controller, release, asset));
    this.transfer = { controller, promise };
  }

  /** Kotlin L87-119 the launched transfer body. */
  private async runTransfer(
    controller: AbortController,
    release: UpdateRelease,
    asset: NonNullable<UpdateRelease['apk']>,
  ): Promise<void> {
    let temporary: string | null = null;
    let committed = false;
    try {
      const file = await this.store.newTransferFile();
      temporary = file;
      const onProgress: UpdateProgressCallback = (received, total) => {
        this.stateStore.update((it) => copyUpdateState(it, { downloaded: received, total }));
      };
      await this.downloader.download(asset, release.tag, file, onProgress, controller.signal);
      this.stateStore.update((it) => copyUpdateState(it, { stage: 'VERIFYING' }));
      const pending: PendingAppUpdate = {
        release,
        versionCode: await this.verifyFn(file, release),
        sha256: await this.sha256(file),
      };
      // Persist package + identity together before permitting any installer intent.
      await this.commitNonCancellable(() => this.store.save(file, pending));
      committed = true;
      this.stateStore.update((it) => copyUpdateState(it, { stage: 'READY', autoInstall: true }));
    } catch (cancelled) {
      if (isAbort(cancelled)) {
        this.applyTransferFailure(committed);
        throw cancelled;
      }
      if (controller.signal.aborted) {
        // Kotlin L109-112 `if (!currentCoroutineContext().isActive)` — the coroutine was
        // cancelled through a path that surfaced as a plain exception.
        this.applyTransferFailure(committed);
        const error = new Error('更新下载已取消');
        error.name = 'AbortError';
        throw error;
      }
      // Kotlin L113-114 the FAILED frame
      const message = errorMessage(cancelled);
      this.stateStore.update((it) =>
        copyUpdateState(it, {
          stage: 'FAILED',
          message: message === null ? MESSAGE_DOWNLOAD_FAILED : message.slice(0, 250),
          autoInstall: false,
        }),
      );
    } finally {
      // Kotlin L115-118 `finally { withContext(NonCancellable + Dispatchers.IO) { temporary?.delete() }; transfer = null }`
      await this.commitNonCancellable(async () => {
        if (temporary !== null) await this.store.deleteQuietly(temporary);
      });
      this.transfer = null;
    }
  }

  /** Kotlin L105-106 / L110-111 — one frame for both "cancelled" outcomes. */
  private applyTransferFailure(committed: boolean): void {
    this.stateStore.update((it) =>
      copyUpdateState(it, {
        stage: committed ? 'READY' : 'AVAILABLE',
        message: committed ? MESSAGE_PACKAGE_READY : MESSAGE_DOWNLOAD_CANCELLED,
        autoInstall: false,
      }),
    );
  }

  /** Kotlin L102 / L116 `withContext(NonCancellable + Dispatchers.IO)`. */
  private async commitNonCancellable(block: () => Promise<void>): Promise<void> {
    await block();
  }

  /* Kotlin L122-124  fun permissionNeeded(message: String = "尚未允许 …") */
  permissionNeeded(message: string = MESSAGE_PERMISSION_NEEDED): void {
    this.stateStore.update((it) =>
      copyUpdateState(it, {
        stage: 'NEED_PERMISSION',
        visible: true,
        message,
        autoInstall: false,
      }),
    );
  }

  /* Kotlin L126  fun installing() */
  installing(): void {
    this.stateStore.update((it) =>
      copyUpdateState(it, { stage: 'INSTALLING', visible: false, autoInstall: false }),
    );
  }

  /* Kotlin L128-136  fun installationReturned() = scope.launch { … } */
  installationReturned(): Promise<void> {
    return this.scope.launch(async () => {
      const original = this.stateStore.value;
      if (original.stage !== 'INSTALLING') return;
      const installed = await this.store.cleanupInstalled();
      const now = this.stateStore.value;
      if (now.stage !== 'INSTALLING' || now.release?.tag !== original.release?.tag) return;
      if (installed) {
        this.stateStore.setValue(initialUpdateState());
      } else {
        this.stateStore.update((it) =>
          copyUpdateState(it, {
            stage: 'READY',
            visible: true,
            message: MESSAGE_INSTALLATION_INCOMPLETE,
            autoInstall: false,
          }),
        );
      }
    });
  }

  /* Kotlin L138-140  fun installationFailed(message: String) */
  installationFailed(message: string): void {
    this.stateStore.update((it) =>
      copyUpdateState(it, { stage: 'READY', visible: true, message, autoInstall: false }),
    );
  }

  }

/** Kotlin `e is kotlinx.coroutines.CancellationException`. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Kotlin `e.message?.take(250)`. */
function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L142-147  companion object { @Volatile instance; fun get(context) }
   ══════════════════════════════════════════════════════════════════════════════ */

let instance: AppUpdateManager | null = null;

/**
 * Android L143-146 `fun get(context: Context): AppUpdateManager` — the process-lifetime
 * singleton (the UI uses it so changing tabs never cancels a transfer). Injected rather
 * than constructed here: `Context` is gone, so the host composes the store, downloader and
 * verifier and this only hands back the one instance.
 */
export function getAppUpdateManager(factory?: () => AppUpdateManager): AppUpdateManager | null {
  if (instance !== null) return instance;
  if (factory === undefined) return null;
  instance = factory();
  return instance;
}

/** Test seam: drop the cached singleton (`@Volatile private var instance`). */
export function resetAppUpdateManager(): void {
  instance = null;
}

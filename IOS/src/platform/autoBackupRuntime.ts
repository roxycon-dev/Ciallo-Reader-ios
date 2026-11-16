/**
 * 自动备份的端到端接线 —— 把 `@core/backup/autoBackup` 的两个注入缝（归档端口、落点目录）
 * 接到 iOS 现有的原生归档运行时上。
 *
 * ## 为什么放在 `src/platform/` 而不是 `src/platform/ios-native/`
 *
 * 调用方是 `src/ui/pages/SettingsPage.tsx` 与 `src/App.tsx`，两边都只认 `getPlatformKind()`
 * 的**结果**，不该在 UI 层写死 `@platform/ios-native/*`（iOS 专用模块会把 WKWebView 里不存在的
 * `@capacitor/*` 插件一路拽进浏览器构建）。所以本文件是平台无关门面：默认实现按
 * `getPlatformKind() === 'ios-native'` 才动态 `import()` 原生归档运行时；浏览器/测试下
 * 要么走注入的假端口，要么**显式抛错**（见下「不静默」）。
 *
 * ## Android 权威（只读对照）
 *
 * | Kotlin | 本文件 |
 * |---|---|
 * | `MainViewModel.kt` L552 `autoBackup by lazy { AutoBackup(application, backupManager) }` | `getAutoBackupRuntime()` 单例 |
 * | `MainViewModel.kt` L798-807 `offerRestoreIfNeeded()`：`runCatching { runIfDue() }` → `shouldOfferRestore()` → `latest()` → `markRestoreOffered()` | `runIfDue()` / `shouldOfferRestore()` / `latest()` / `markRestoreOffered()`（调用点在 `App.tsx`） |
 * | `MainViewModel.kt` L815-831 `acceptRestore()`：`autoBackup.restore(snapshot.name)` | `restoreLatest()` |
 * | `TransferScreen.kt` L186-193 `AutoBackupStore(context)` + `AutoBackup(context, backup)`；`pickAutoFolder` 成功即 `autoStore.enabled = true` | `attachFolder()` / `attachDefaultFolder()` |
 * | `TransferScreen.kt` L418-430 开关写 `autoStore.enabled`、`立即备份` 走 `autoBackup.backupNow()` | `setEnabled()` / `backupNow()` |
 * | `BackupManager.exportArchive(target, ExportSelection())`（`BackupManager.kt` L29-34） | `createNativeAutoBackupArchivePort().exportArchive` = 全部分类 + `protectedAuthorized=false` |
 * | `BackupManager.importArchive(target, ImportMode.REPLACE)`（L41-64） | `importArchive(target, 'REPLACE')` = `importNativeArchive(..., 'REPLACE', signal, progress)` |
 *
 * ## 目录：iOS 没有 SAF
 *
 * Kotlin 让用户选一棵 SAF 目录树并把 `content://…` 存进 SharedPreferences；iOS 没有等价物
 * （`autoBackupStore.ts` 文件头「落点差异 1」已登记）。这里固定用应用私有目录
 * `backups/auto`（`FileSystemApi` 的根，iOS = `Directory.Data` = App 的 Documents），
 * 好处是**卸载重装不会被系统清掉用户授权**，代价是重装后备份随沙盒一起消失 ——
 * 那属于「换机迁移」的范畴，由 `设备互传` / 导出备份负责。
 *
 * 临时文件放在 `backups/auto-tmp`，与备份目录分开：`AutoBackupStore.snapshots()` 会把
 * 目录里所有 `ciallo-auto-*.zip` 当备份，临时文件同目录会和 `prune()` 打架。
 *
 * ## 归档适配器的两个硬约束（来自原生插件，不是自己加的限制）
 *
 * 1. `ReaderTransferArchivePlugin.extract()` 只接受 `transfer/…` 前缀（Swift L113
 *    `guard path.hasPrefix("transfer/")`），所以恢复时先把备份拷成
 *    `transfer/<新 sessionId>.incoming` 再 `inspect()`；导入结束后删掉这份拷贝。
 * 2. `pack()` 只会产出 `transfer/<sessionId>.outgoing`（Swift L108），所以导出后要把
 *    这份文件搬到 `AutoBackup` 给的 `target`（`backups/auto-tmp/auto_backup_<n>.zip`），
 *    再让 `AutoBackupStore.write()` 按 Kotlin L81-91 的语义写进备份目录。
 *
 * ## 不静默
 *
 * 浏览器 / 非原生构建下没有 `ReaderTransferArchive` 插件。此时 `createNativeAutoBackupArchivePort()`
 * 产出的端口**一用就抛** `AUTO_BACKUP_NATIVE_UNAVAILABLE`，由 `backupNow()` 折成
 * `Outcome(false, message)` 显示在设置卡片上 —— 绝不返回「成功」假象。
 */

import { AutoBackup, type AutoBackupArchivePort, type AutoBackupOutcome } from '@core/backup/autoBackup';
import { AutoBackupStore, type AutoBackupSnapshot } from '@core/backup/autoBackupStore';
import { SettingsRepository } from '@core/settings/settingsRepository';
import type { ArchiveImportResult } from '@core/transfer/archiveImporter';
import { TRANSFER_CATEGORIES } from '@core/transfer/portableFormat';
import { requireTransfer, transferHash } from '@core/transfer/transferWire';
import type { FileSystemApi, SQLiteDatabase } from '@platform/interfaces';
import { getPlatform, getPlatformKind, type PlatformBundle } from '@platform/index';

/** 应用私有备份目录（iOS 无 SAF，见文件头「目录」）。 */
export const AUTO_BACKUP_FOLDER = 'backups/auto';
/** 导出临时文件目录（Kotlin `context.filesDir` 的等价物）。 */
export const AUTO_BACKUP_TEMP_DIR = 'backups/auto-tmp';
/** 卡片上显示的目录名（Kotlin `treeLabel()` 的 `COLUMN_DISPLAY_NAME`）。 */
export const AUTO_BACKUP_FOLDER_LABEL = '应用备份目录';
/** 原生归档端口不可用时的显式失败文案。 */
export const AUTO_BACKUP_NATIVE_UNAVAILABLE = '当前平台没有原生归档端口，无法自动备份';

/**
 * `AutoBackupArchivePort` 的加宽版：`AutoBackup` 只按两个位置参数调用，多出来的
 * `signal` / `progress` 是给调用方（恢复对话框）用的，不改变 `AutoBackup` 的语义。
 */
export interface AutoBackupArchivePortEx extends AutoBackupArchivePort {
  exportArchive(target: string, signal?: AbortSignal): Promise<void>;
  importArchive(
    target: string,
    mode: 'REPLACE',
    signal?: AbortSignal,
    progress?: (completed: number, total: number) => void,
  ): Promise<ArchiveImportResult>;
}

export interface AutoBackupRuntimeOptions {
  readonly db: Pick<SQLiteDatabase, 'query'>;
  readonly fs: FileSystemApi;
  readonly settings: SettingsRepository;
  readonly archive: AutoBackupArchivePort;
  readonly now?: () => number;
  readonly nanoTime?: () => number;
  readonly tempDir?: string;
}

/** 设置卡片需要的全部只读状态（一次 `Promise.all` 取齐）。 */
export interface AutoBackupCardState {
  readonly enabled: boolean;
  readonly label: string | null;
  readonly lastResult: string | null;
  readonly lastSuccessAt: number;
  readonly latest: AutoBackupSnapshot | null;
  readonly restorable: boolean;
}

/** Kotlin `e.message ?: "备份失败"`。 */
function messageOf(error: unknown, fallback = '备份失败'): string {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return fallback;
}

/**
 * 自动备份的运行时门面：`AutoBackup`（Kotlin 的 `AutoBackup`）+ `AutoBackupStore`
 * （Kotlin 的 `AutoBackupStore`）一起暴露，UI 不用自己建它们。
 */
export class AutoBackupRuntime {
  readonly auto: AutoBackup;
  readonly store: AutoBackupStore;

  constructor(options: AutoBackupRuntimeOptions) {
    this.store = new AutoBackupStore(options.fs, options.settings);
    this.auto = new AutoBackup(options.db, options.fs, options.archive, this.store, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.nanoTime ? { nanoTime: options.nanoTime } : {}),
      tempDir: options.tempDir ?? AUTO_BACKUP_TEMP_DIR,
    });
  }

  enabled(): Promise<boolean> {
    return this.auto.enabled();
  }

  setEnabled(value: boolean): Promise<void> {
    return this.auto.enable(value);
  }

  lastSuccessAt(): Promise<number> {
    return this.auto.lastSuccessAt();
  }

  lastResult(): Promise<string | null> {
    return this.auto.lastResult();
  }

  /** 备份目录的**显示名**：默认私有目录显示为「应用备份目录」。 */
  async treeLabel(): Promise<string | null> {
    const label = await this.auto.treeLabel();
    if (label === null) return null;
    return label === (AUTO_BACKUP_FOLDER.split('/').pop() ?? '') ? AUTO_BACKUP_FOLDER_LABEL : label;
  }

  /** 原始目录路径（`AutoBackupStore.tree()`）。 */
  folder(): Promise<string | null> {
    return this.store.tree();
  }

  hasFolder(): Promise<boolean> {
    return this.auto.hasFolder();
  }

  latest(): Promise<AutoBackupSnapshot | null> {
    return this.auto.latest();
  }

  snapshots(): Promise<AutoBackupSnapshot[]> {
    return this.store.snapshots();
  }

  /** Kotlin `pickAutoFolder` 成功分支：挂上目录就当作用户同意自动备份。 */
  async attachDefaultFolder(): Promise<boolean> {
    return this.auto.attachFolder(AUTO_BACKUP_FOLDER);
  }

  /** 「重置目录」—— 先解绑再挂回默认私有目录（`detachTree()` + `attachFolder()`）。 */
  async resetFolder(): Promise<boolean> {
    await this.store.detachTree();
    return this.attachDefaultFolder();
  }

  /**
   * Kotlin L42-50。**故意不吞异常**：启动/回前台那两处调用点用 `runCatching` 语义
   * 捕获（`App.tsx` 的 `runAutoBackupIfDue`），这里再吞一次会让「失败」无从观测。
   */
  runIfDue(signal?: AbortSignal): Promise<AutoBackupOutcome | null> {
    return this.auto.runIfDue(signal);
  }

  /**
   * 设置卡片的「立即备份」。`AutoBackup.backupNow` 已经把归档异常折成
   * `Outcome(false, …)`；剩下的抛出只有取消（`AbortError`）与并发锁，这里一并折成文案。
   */
  async backupNow(signal?: AbortSignal): Promise<AutoBackupOutcome> {
    try {
      return await this.auto.backupNow(signal);
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  }

  /** Kotlin `MainViewModel.acceptRestore()` L821 —— 用最新一份覆盖恢复。 */
  async restoreLatest(signal?: AbortSignal): Promise<ArchiveImportResult | null> {
    const snapshot = await this.auto.latest();
    if (snapshot === null) return null;
    const result = await this.auto.restore(snapshot.name, signal);
    await this.auto.markRestoreOffered();
    return result;
  }

  shouldOfferRestore(): Promise<boolean> {
    return this.auto.shouldOfferRestore();
  }

  markRestoreOffered(): Promise<void> {
    return this.auto.markRestoreOffered();
  }

  /** 「清理旧备份」—— `prune()` 只保留 `AutoBackupStore.MAX_KEPT`（3）份。 */
  async prune(): Promise<number> {
    const before = (await this.store.snapshots()).length;
    await this.store.prune();
    const after = (await this.store.snapshots()).length;
    return before - after;
  }

  /** 卡片一次性取齐所有只读状态（任一失败不拖垮整张卡）。 */
  async cardState(): Promise<AutoBackupCardState> {
    const [enabled, label, lastResult, lastSuccessAt, latest, restorable] = await Promise.all([
      this.enabled(),
      this.treeLabel(),
      this.lastResult(),
      this.lastSuccessAt(),
      this.latest(),
      this.shouldOfferRestore(),
    ]);
    return { enabled, label, lastResult, lastSuccessAt, latest, restorable };
  }
}

export function createAutoBackupRuntime(options: AutoBackupRuntimeOptions): AutoBackupRuntime {
  return new AutoBackupRuntime(options);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 原生归档适配器 —— `AutoBackupArchivePort` 的 iOS 实现
 * ═══════════════════════════════════════════════════════════════════════════ */

function randomSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 没有原生归档插件的平台（浏览器 / 测试里忘了注入假端口）一律显式失败。 */
function requireNativeArchive(): void {
  if (getPlatformKind() !== 'ios-native') throw new Error(AUTO_BACKUP_NATIVE_UNAVAILABLE);
}

/** 搬运一个文件；`move` 可用就免掉一次「整包进 JS 内存」。 */
async function moveOrCopy(fs: FileSystemApi, from: string, to: string): Promise<void> {
  const move = fs.move?.bind(fs);
  if (move !== undefined) {
    try {
      await move(from, to);
      return;
    } catch {
      // 目标目录不存在 / rename 跨卷失败 —— 退回复制，不改变语义。
    }
  }
  const bytes = await fs.readFile(from);
  requireTransfer(bytes.length > 0, '自动备份内容为空');
  await fs.writeFile(to, bytes);
}

/**
 * `AutoBackupArchivePort` 的 iOS 实现。
 *
 * - 导出：`exportNativeArchive(platform, { categories: 全部, protectedAuthorized: false })`
 *   —— 逐字对齐 Kotlin `ExportSelection()` 的默认值，**受保护内容不会进自动备份**；
 *   产物搬走后立刻删掉 `transfer/<id>.outgoing`，避免原件留在传输目录里被 `设备互传` 看到。
 * - 导入：备份拷成 `transfer/<新 id>.incoming` → `inspect()` 校验清单与摘要 →
 *   `importNativeArchive(..., 'REPLACE', signal, progress)`（内部走 `TransferImportJournal`
 *   事务与回滚）→ 删掉拷贝、丢弃暂存目录。
 */
export function createNativeAutoBackupArchivePort(
  platform: PlatformBundle = getPlatform(),
): AutoBackupArchivePortEx {
  return {
    async exportArchive(target: string): Promise<void> {
      requireNativeArchive();
      requireTransfer(typeof target === 'string' && target.length > 0, '自动备份目标路径无效');
      const { exportNativeArchive } = await import('./ios-native/archiveExportRuntime');
      const prepared = await exportNativeArchive(platform, {
        categories: [...TRANSFER_CATEGORIES],
        protectedAuthorized: false,
      });
      try {
        await moveOrCopy(platform.fs, prepared.path, target);
      } finally {
        await platform.fs.delete(prepared.path).catch(() => {});
      }
    },

    async importArchive(
      target: string,
      mode: 'REPLACE',
      signal?: AbortSignal,
      progress?: (completed: number, total: number) => void,
    ): Promise<ArchiveImportResult> {
      requireNativeArchive();
      requireTransfer(typeof target === 'string' && target.length > 0, '自动备份路径无效');
      const [{ importNativeArchive }, { NativePortableArchivePort }] = await Promise.all([
        import('./ios-native/archiveImportRuntime'),
        import('./ios-native/portableArchivePort'),
      ]);
      const bytes = await platform.fs.readFile(target);
      requireTransfer(bytes.length > 0, '备份内容为空');
      const archive = new NativePortableArchivePort();
      const staged = `transfer/${randomSessionId()}.incoming`;
      await platform.fs.writeFile(staged, bytes);
      let stageId: string | null = null;
      try {
        const inspected = await archive.inspect(staged, transferHash(bytes));
        stageId = inspected.stageId;
        const imported = await importNativeArchive(platform, inspected, mode, signal, progress);
        return imported.result;
      } finally {
        await platform.fs.delete(staged).catch(() => {});
        if (stageId !== null) await archive.discard(stageId).catch(() => {});
      }
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 单例 + 注入缝
 * ═══════════════════════════════════════════════════════════════════════════ */

let cached: AutoBackupRuntime | null = null;
let injected: AutoBackupRuntime | null = null;

/** 用当前平台装配默认运行时（db / fs / 设置表 / 原生归档适配器）。 */
export function defaultAutoBackupRuntime(): AutoBackupRuntime {
  const platform = getPlatform();
  return createAutoBackupRuntime({
    db: platform.db,
    fs: platform.fs,
    settings: new SettingsRepository(platform.db),
    archive: createNativeAutoBackupArchivePort(platform),
  });
}

/**
 * 注入点（测试 / 未来换落地实现）：`null` 表示回到「按平台装配」。
 * 与 `resetPlatformCache()` 同一套约定 —— 显式换实例，不靠环境变量。
 */
export function setAutoBackupRuntime(runtime: AutoBackupRuntime | null): void {
  injected = runtime;
  cached = null;
}

export function resetAutoBackupRuntime(): void {
  injected = null;
  cached = null;
}

export function getAutoBackupRuntime(): AutoBackupRuntime {
  if (injected !== null) return injected;
  if (cached === null) cached = defaultAutoBackupRuntime();
  return cached;
}

/**
 * 自动备份与恢复 —— 逐行移植 Android `com.example.data.AutoBackup.kt`（101 行）。
 *
 * ## 原文档注释（Kotlin L8-16，逐字保留）
 *
 * > 自动备份与恢复。
 * >
 * > 目标很具体：签名变化或换机导致必须卸载重装时，用户不必再手工导出再导入。
 * > 备份写到 [AutoBackupStore] 选的公共目录，内容是「保存本地备份」的同一种 zip
 * > （书、书源、收藏、阅读记录、设置、资源都在里面），恢复直接复用现有导入流程。
 * >
 * > 只在书库非空时备份：空书架生成的备份会覆盖掉上一份可用备份。
 *
 * ## Kotlin → TS 行号映射
 *
 * | Kotlin（AutoBackup.kt） | TS（本文件） | 说明 |
 * |---|---|---|
 * | L17-21 `class AutoBackup(context, backup, store)` | `class AutoBackup` L136-353（`constructor` L143-152） | `context` → `db` + `fs`；`BackupManager` → `AutoBackupArchivePort`（L118-121） |
 * | L23 `appContext` | 构造注入的 `fs` + `tempDir`（选项 L124-131） | Kotlin `context.filesDir` |
 * | L25 `data class Outcome` | `interface AutoBackupOutcome` L103-106 | |
 * | L27-31 `enabled` / `lastSuccessAt` / `lastResult` / `treeLabel` / `hasFolder` | L156-178 | 全部转 Promise（SharedPreferences → 异步设置表） |
 * | L33-35 `enable(value)` | `enable()` L181-184 | |
 * | L37 `attachFolder(uri)` | `attachFolder(path)` L186-189 | |
 * | L39 `latest()` | `latest()` L191-195 | `snapshots().firstOrNull()` |
 * | L42-50 `runIfDue()` | `runIfDue()` L197-209 | 先算 `isDue`，满足才 `backupNow()`，否则 `null` |
 * | L52-76 `backupNow()` | `backupNow()` L211-214 + `backupLocked()` L216-253 | 逐行对应见下方「备份分支」 |
 * | L53 `if (store.tree() == null)` | L217-219 | 「还没有选择备份目录」 |
 * | L54-55 书库计数 / 空库短路 | L221-224 | 「书库是空的，暂不备份」 |
 * | L56-57 文件名 + 临时文件 | L225-226 | `fileName(now)` / `auto_backup_<nanoTime>.zip` |
 * | L59-60 `exportArchive` + 空文件闸门 | L228-232 | 「备份内容为空，已保留上一份」 |
 * | L61-64 写入目录失败分支 | L234-238 | 存的文案与返回的文案不同（Kotlin 原样） |
 * | L65-68 `lastSuccessAt` / `lastResult = null` / `prune` / 成功文案 | L239-242 | 「已备份 N 本书」 |
 * | L69-72 `catch` + CancellationException 重抛 | L243-248 | `AbortSignal` 代替协程取消 |
 * | L73-75 `finally { runCatching { temp.delete() } }` | L249-252 | |
 * | L79-87 `restore(name)` | `restore()` L259-272 | 「无法读取备份文件：name」+ `ImportMode.REPLACE`（L134） |
 * | L90-96 `shouldOfferRestore()` | `shouldOfferRestore()` L278-284 | 计数失败默认 **1**（不是 0） |
 * | L98-100 `markRestoreOffered()` | `markRestoreOffered()` L287-289 | |
 * | L54 / L93 的私有辅助 | `countBooksOr()` L292-299 / `tempPath()` L302-305 / `fileLength()` L308-316 / `deleteQuietly()` L319-325 | |
 *
 * ## 备份分支（Kotlin L52-76 逐条，顺序不可调整）
 *
 * 1. `tree() == null` → `Outcome(false, "还没有选择备份目录")`，**不动** `lastResult`/`lastSuccessAt`。
 * 2. `books <= 0` → `Outcome(false, "书库是空的，暂不备份")`，同样不动任何状态。
 * 3. `name = fileName(now)`（第二次取 `now` 在 L65），`temp = filesDir/auto_backup_<nanoTime>.zip`。
 * 4. `exportArchive(temp)` 抛错 → 取消则**重抛**，否则 `lastResult = e.message ?: "备份失败"` 并返回。
 * 5. `temp.length() <= 0` → `Outcome(false, "备份内容为空，已保留上一份")`：不写目录、不更新
 *    `lastSuccessAt`、**也不清空 `lastResult`**（上一轮的失败信息保留）。
 * 6. `store.write(name, temp) == false` → `lastResult = "写入备份目录失败"`（存这条），返回
 *    `Outcome(false, "写入备份目录失败，请重新选择目录")`（显示那条）。
 * 7. 成功 → `lastSuccessAt = now()`（**重新取一次**）、`lastResult = null`、`prune()`、返回
 *    `Outcome(true, "已备份 N 本书")`。
 * 8. `finally` 恒删临时文件。
 *
 * ## 失败重试
 *
 * Kotlin **没有**重试计数器：失败不写 `lastSuccessAt`，于是下一次启动/回前台调用 `runIfDue()`
 * 时 `isDue` 仍为真 —— 「下次启动自然重试」就是它的重试机制。本实现照搬，测试里有对应用例。
 *
 * ## 并发锁与取消
 *
 * - 并发锁：Kotlin 的 `ContentMutationGate.mutex` 在 **`BackupManager` 内部**
 *   （BackupManager.kt L31-33 `exportArchive`、L59-61 `importArchive`）。iOS 侧那层锁属于
 *   注入的归档适配器（`archiveImportRuntime` 的导入日志同样会取门锁），若本模块再取同一把
 *   全局锁会**重入死锁**（`AsyncMutex` 不可重入）。所以这里用**私有** `AsyncMutex` 串行化
 *   `backupNow`/`restore`，锁序与 Kotlin 一致：先锁 → 再进归档。
 * - 取消：Kotlin 用协程 `CancellationException`（L70、L82 的 `if (e is CancellationException) throw e`）。
 *   TS 没有协程取消，改用 `AbortSignal`：`signal.aborted` 或 `name === 'AbortError'` 的错误视为
 *   取消并**重抛**（不写 `lastResult`、不更新 `lastSuccessAt`），`finally` 仍删临时文件。
 *
 * ## 未移植项（Kotlin 有、iOS 无对应物）
 *
 * 1. `Dispatchers.IO` / `withContext`（L52、L79）—— core 无调度器，切换 IO 由调用方/平台层负责。
 * 2. `Context` / `AppDatabase.getDatabase(context)` 单例（L54、L93）—— 改为注入
 *    `Pick<SQLiteDatabase, 'query'>`。
 * 3. `File(appContext.filesDir, …)`（L57、L80）—— 改为注入 `fs` + `tempDir`；
 *    `System.nanoTime()` 改为注入 `nanoTime`（默认同 `now`，仅用于临时文件去重）。
 * 4. `BackupManager.exportArchive/importArchive`（L59、L83）—— 抽成 `AutoBackupArchivePort`：
 *    在 Kotlin 里它们分别落 `PortableArchive.export`（`ExportSelection()` 默认值 = 全部分类 +
 *    `protectedAuthorized = false`）与 `ArchiveImporter.import(…, ImportMode.REPLACE)`
 *    （BackupManager.kt L29-34 / L41-64）。适配器必须照抄这两个默认值，否则受保护内容会被
 *    自动备份带走。
 * 5. `ImportResult`（L79 返回值）—— 复用 `@core/transfer/archiveImporter` 的
 *    `ArchiveImportResult`（iOS 侧是 Kotlin `ImportResult` 的超集：多 `duplicate` / `recordedSeconds`）。
 * 6. 「调用方负责之后的书源重载与界面刷新」（L78 注释）—— iOS 侧仍由调用方负责，本模块不碰 UI。
 * 7. `attachFolder(android.net.Uri)`（L37）→ `attachFolder(path: string)`，授权语义见
 *    `autoBackupStore.ts` 文件头「落点差异 1」。
 *
 * ## 触发条件：只有「启动 + 间隔」，**没有** Wi-Fi / 电量 / 充电门禁
 *
 * Kotlin 原文只有 `AutoBackupStore.isDue`（enabled + 有目录 + 距上次成功 ≥ 12h，L173-174）。
 * 全仓没有任何 `ConnectivityManager` / `BatteryManager` 参与自动备份 —— `preload_wifi_only`
 * 只是漫画预加载开关（`ComicPageLoader.kt`），与本模块无关。因此本实现**不注入网络端口**，
 * 测试里专门有一条用例锁住「把 `preload_wifi_only` 打开也不会拦住自动备份」。
 */

import { AsyncMutex } from '@core/library/contentMutationGate';
import type { ArchiveImportResult } from '@core/transfer/archiveImporter';
import type { FileSystemApi, SQLiteDatabase } from '@platform/interfaces';
import { AutoBackupStore } from './autoBackupStore';
import type { AutoBackupSnapshot } from './autoBackupStore';

/** Kotlin L25 `data class Outcome(val ok: Boolean, val message: String)`。 */
export interface AutoBackupOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Kotlin 构造参数 `backup: BackupManager`（L19）的窄接口 —— 只保留 AutoBackup 真正用到的
 * 两个入口（L59 `backup.exportArchive(temp)`、L83 `backup.importArchive(temp, REPLACE)`）。
 *
 * 适配器实现要求：
 * - `exportArchive` ≙ `BackupManager.exportArchive(target, ExportSelection())`，把**便携归档**
 *   （`.ciallo` / 同一套 ZIP 容器）写到 `target`；
 * - `importArchive(target, 'REPLACE')` ≙ `BackupManager.importArchive(target, ImportMode.REPLACE)`，
 *   返回 Kotlin `ImportResult` 的等价物。
 */
export interface AutoBackupArchivePort {
  exportArchive(target: string): Promise<void>;
  importArchive(target: string, mode: 'REPLACE'): Promise<ArchiveImportResult>;
}

/** Kotlin 里这些值直接取自 `System.currentTimeMillis()` / `System.nanoTime()` / `filesDir`。 */
export interface AutoBackupOptions {
  /** 注入时钟（毫秒）。默认 `Date.now`。测试用固定时钟。 */
  readonly now?: () => number;
  /** 注入单调计数器，只用于临时文件名去重。默认同 `now`。 */
  readonly nanoTime?: () => number;
  /** 临时文件目录（Kotlin `context.filesDir`）。默认 `''` = 文件系统根。 */
  readonly tempDir?: string;
}

/** Kotlin `ImportMode.REPLACE`（`com.example.transfer.ImportMode`）；与 TS `TransferImportMode` 同值。 */
const IMPORT_MODE_REPLACE = 'REPLACE' as const;

export class AutoBackup {
  /** 私有串行锁 —— 见文件头「并发锁与取消」。 */
  private readonly runs = new AsyncMutex();
  private readonly now: () => number;
  private readonly nanoTime: () => number;
  private readonly tempDir: string;

  constructor(
    private readonly db: Pick<SQLiteDatabase, 'query'>,
    private readonly fs: FileSystemApi,
    private readonly backup: AutoBackupArchivePort,
    private readonly store: AutoBackupStore,
    options: AutoBackupOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.nanoTime = options.nanoTime ?? this.now;
    this.tempDir = options.tempDir ?? '';
  }

  /** Kotlin L27 `val enabled`。 */
  enabled(): Promise<boolean> {
    return this.store.enabled();
  }

  /** Kotlin L28 `val lastSuccessAt`。 */
  lastSuccessAt(): Promise<number> {
    return this.store.lastSuccessAt();
  }

  /** Kotlin L29 `val lastResult`。 */
  lastResult(): Promise<string | null> {
    return this.store.lastResult();
  }

  /** Kotlin L30 `fun treeLabel()`。 */
  treeLabel(): Promise<string | null> {
    return this.store.treeLabel();
  }

  /** Kotlin L31 `fun hasFolder() = store.tree() != null`。 */
  async hasFolder(): Promise<boolean> {
    return (await this.store.tree()) !== null;
  }

  /** Kotlin L33-35。 */
  enable(value: boolean): Promise<void> {
    return this.store.setEnabled(value);
  }

  /** Kotlin L37 `fun attachFolder(uri: Uri)`。 */
  attachFolder(path: string): Promise<boolean> {
    return this.store.attachTree(path);
  }

  /** Kotlin L39 `fun latest() = store.snapshots().firstOrNull()`。 */
  async latest(): Promise<AutoBackupSnapshot | null> {
    const snapshots = await this.store.snapshots();
    return snapshots[0] ?? null;
  }

  /**
   * Kotlin L42-50 —— 「开机/回前台时的自动备份入口：满足间隔且有目录才真正写盘」。
   * `null` 表示「没到点，什么都没做」。
   */
  async runIfDue(signal?: AbortSignal): Promise<AutoBackupOutcome | null> {
    const due = AutoBackupStore.isDue({
      enabled: await this.store.enabled(),
      hasTree: (await this.store.tree()) !== null,
      lastSuccessAt: await this.store.lastSuccessAt(),
      now: this.now(),
    });
    return due ? this.backupNow(signal) : null;
  }

  /** Kotlin L52 —— `withContext(Dispatchers.IO)` + 私有锁。 */
  async backupNow(signal?: AbortSignal): Promise<AutoBackupOutcome> {
    return this.runs.withLock(() => this.backupLocked(signal));
  }

  /** Kotlin L52-76 的主体，逐条对应见文件头「备份分支」。 */
  private async backupLocked(signal?: AbortSignal): Promise<AutoBackupOutcome> {
    if ((await this.store.tree()) === null) {
      return { ok: false, message: '还没有选择备份目录' };
    }
    throwIfAborted(signal);
    const books = await this.countBooksOr(0);
    if (books <= 0) {
      return { ok: false, message: '书库是空的，暂不备份' };
    }
    const name = AutoBackupStore.fileName(this.now());
    const temp = this.tempPath('auto_backup');
    try {
      await this.backup.exportArchive(temp);
      // Kotlin L60 `if (temp.length() <= 0L)`。
      if ((await this.fileLength(temp)) <= 0) {
        return { ok: false, message: '备份内容为空，已保留上一份' };
      }
      throwIfAborted(signal);
      if (!(await this.store.write(name, temp))) {
        // Kotlin L62-63：存的是「写入备份目录失败」，显示的是带补救建议的那句。
        await this.store.setLastResult('写入备份目录失败');
        return { ok: false, message: '写入备份目录失败，请重新选择目录' };
      }
      await this.store.setLastSuccessAt(this.now());
      await this.store.setLastResult(null);
      await this.store.prune();
      return { ok: true, message: `已备份 ${books} 本书` };
    } catch (error) {
      // Kotlin L70 `if (e is CancellationException) throw e`。
      if (isCancellation(error, signal)) throw error;
      const message = messageOf(error) ?? '备份失败';
      await this.store.setLastResult(message);
      return { ok: false, message };
    } finally {
      // Kotlin L74 `runCatching { temp.delete() }`。
      await this.deleteQuietly(temp);
    }
  }

  /**
   * Kotlin L79-87 —— 「用指定备份覆盖恢复；调用方负责之后的书源重载与界面刷新」。
   * 读不出备份文件时抛 `无法读取备份文件：name`（Kotlin `require(...)` 的原文）。
   */
  async restore(name: string, signal?: AbortSignal): Promise<ArchiveImportResult> {
    return this.runs.withLock(async () => {
      const temp = this.tempPath('auto_restore');
      try {
        if (!(await this.store.readInto(name, temp))) {
          throw new Error(`无法读取备份文件：${name}`);
        }
        throwIfAborted(signal);
        return await this.backup.importArchive(temp, IMPORT_MODE_REPLACE);
      } finally {
        await this.deleteQuietly(temp);
      }
    });
  }

  /**
   * Kotlin L90-96 —— 「首启时判断要不要提示恢复：书架为空 + 目录里有备份」。
   * 计数失败时 Kotlin 取 `getOrDefault(1)`（**1**，不是 0）：宁可漏提示，也不在拿不到书架时弹窗。
   */
  async shouldOfferRestore(): Promise<boolean> {
    if (await this.store.restoreOffered()) return false;
    if ((await this.store.tree()) === null) return false;
    const books = await this.countBooksOr(1);
    if (books > 0) return false;
    return (await this.store.snapshots()).length > 0;
  }

  /** Kotlin L98-100。 */
  async markRestoreOffered(): Promise<void> {
    await this.store.setRestoreOffered(true);
  }

  /** Kotlin L54 / L93 `bookDao().getBooksCount()`；异常时两处的默认值不同（0 / 1）。 */
  private async countBooksOr(fallback: number): Promise<number> {
    try {
      const rows = await this.db.query<{ count: number }>('SELECT COUNT(*) FROM "books"');
      return rows[0]?.count ?? 0;
    } catch {
      return fallback;
    }
  }

  /** Kotlin L57 `File(appContext.filesDir, "auto_backup_${System.nanoTime()}.zip")`。 */
  private tempPath(kind: 'auto_backup' | 'auto_restore'): string {
    const file = `${kind}_${this.nanoTime()}.zip`;
    return this.tempDir === '' ? file : `${this.tempDir.replace(/\/+$/, '')}/${file}`;
  }

  /** Kotlin L60 `temp.length()`。读不到按 0（Java `File.length()` 对不存在的文件也返回 0）。 */
  private async fileLength(path: string): Promise<number> {
    try {
      const size = this.fs.size;
      if (size !== undefined) return await size.call(this.fs, path);
      return (await this.fs.readFile(path)).length;
    } catch {
      return 0;
    }
  }

  /** Kotlin L74 / L85 `runCatching { temp.delete() }`。 */
  private async deleteQuietly(path: string): Promise<void> {
    try {
      await this.fs.delete(path);
    } catch {
      // `runCatching` 的语义：临时文件删不掉不影响结果。
    }
  }
}

/** Kotlin L70 / L82 —— 取消必须原样重抛，不能被折成 `Outcome(false, …)`。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error('自动备份已取消');
  error.name = 'AbortError';
  throw error;
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true;
  return error instanceof Error && error.name === 'AbortError';
}

/** Kotlin `e.message ?: "备份失败"`。 */
function messageOf(error: unknown): string | null {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return null;
}

export function createAutoBackup(
  db: Pick<SQLiteDatabase, 'query'>,
  fs: FileSystemApi,
  backup: AutoBackupArchivePort,
  store: AutoBackupStore,
  options: AutoBackupOptions = {},
): AutoBackup {
  return new AutoBackup(db, fs, backup, store, options);
}

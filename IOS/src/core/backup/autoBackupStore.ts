/**
 * 自动备份的落点与状态 —— 逐行移植 Android `com.example.data.AutoBackupStore.kt`（176 行）。
 *
 * ## Kotlin → TS 行号映射
 *
 * | Kotlin（AutoBackupStore.kt） | TS（本文件） | 说明 |
 * |---|---|---|
 * | L9-18  类注释（SAF 落点、卸载丢授权） | 本文件头 + 下方「落点差异」 | iOS 无 SAF，落点改 `FileSystemApi` 目录路径 |
 * | L19-22 `class AutoBackupStore(context)` | `class AutoBackupStore` L92-310（`constructor` L144-145） | 注入 `FileSystemApi` + `SettingsRepository` |
 * | L24-26 `enabled` get/set | `enabled()` / `setEnabled()` L150-157 | 键 `auto_backup_enabled` |
 * | L28-30 `lastSuccessAt` | `lastSuccessAt()` / `setLastSuccessAt()` L159-166 | 键 `auto_backup_last_at` |
 * | L32-34 `lastResult` | `lastResult()` / `setLastResult()` L168-180 | 键 `auto_backup_last_result`；`null` ⇒ 删键 |
 * | L37-39 `restoreOffered` | `restoreOffered()` / `setRestoreOffered()` L182-190 | 键 `auto_backup_restore_offered` |
 * | L41-43 `tree()` | `tree()` L192-198 | 树 URI → 目录路径 |
 * | L45-52 `attachTree(uri)` | `attachTree(path)` L200-208 | `takePersistableUriPermission` → 平台层书签 |
 * | L54-56 `detachTree()` | `detachTree()` L210-214 | |
 * | L59-66 `treeLabel()` | `treeLabel()` L216-225 | `COLUMN_DISPLAY_NAME` → 路径 basename |
 * | L68 `data class Snapshot` | `interface AutoBackupSnapshot` L68-72 | |
 * | L71-78 `snapshots()` | `snapshots()` L228-240 | 排序键改成**文件名时间戳**（见「落点差异」3） |
 * | L81-91 `write(name, source)` | `write()` L246-257 | 同名先删再写 |
 * | L93-100 `readInto(name, target)` | `readInto()` L260-272 | 拷出后要求 `length > 0` |
 * | L103-106 `prune()` | `prune()` L275-282 | 只保留 `MAX_KEPT` 份 |
 * | L108-111 `delete(name)` | `delete()` L285-289 | |
 * | L113-141 `childDocuments` / `deleteChild` | `listChildren()` L292-298 / `deleteChild()` L301-309 | |
 * | L143-145 `treeDocument(tree)` | —— | 未移植（无 `DocumentsContract`） |
 * | L147-148 `hasPermission(uri)` | —— | 未移植（无持久 URI 授权） |
 * | L150-175 `companion object` | `static readonly` L93-104 + `fileName()` L106-113 + `isDue()` L120-123 + `isSnapshotName()` L125-128 + `snapshotTime()` L130-141 | 常量与文案逐字照抄 |
 *
 * ## 落点差异（Kotlin 用 SAF，iOS 用注入的文件系统 + 设置表）
 *
 * 1. **目录**：Kotlin 把 `content://…/tree/…` URI 存进 SharedPreferences，写盘前先查
 *    `persistedUriPermissions` 是否还有写权限（卸载会丢，所以重装后要重选目录）。
 *    iOS 没有 SAF；`FileSystemApi` 也没有「权限」概念。本模块把 `tree` 记成**目录路径**，
 *    授权/书签由平台层（`platform/ios-native`）负责。因此 `attachTree` 只校验路径非空，
 *    写盘失败会走 Kotlin 自己的失败分支（`写入备份目录失败`），而不是 `还没有选择备份目录`。
 * 2. **状态**：Kotlin 用独立 SharedPreferences 文件 `auto_backup`（不参与备份）。iOS 只有
 *    一张 `app_settings` 表，故键名加 `auto_backup_` 前缀。后果可控：这些键会出现在
 *    `settings.json` 里，但两端恢复都只应用 `settingType(key) != null` 的键
 *    （BackupArchive.kt L132 `?: return@forEach`、`SettingsRepository.restoreSafeEntries`），
 *    所以它们不会跨设备生效 —— 与 Kotlin「独立 prefs 不进备份」的可观测行为一致。
 * 3. **快照时间**：Kotlin 读 `COLUMN_LAST_MODIFIED`。`FileSystemApi` 不暴露 mtime，
 *    故从文件名 `ciallo-auto-yyyyMMdd-HHmmss.zip` 反解（本应用自己写的文件，两者等价；
 *    用户手工改名/拷贝过的文件会有偏差）。`Date.UTC` 只为稳定排序，不参与显示。
 * 4. **写盘**：Kotlin `createDocument` 在目录被删时返回 null → `false`；iOS 的
 *    Capacitor `writeFile(recursive: true)` 会把目录重建出来。差别只在「目录被外部删除」。
 */

import type { FileSystemApi } from '@platform/interfaces';
import type { SettingsRepository } from '@core/settings/settingsRepository';

/** Kotlin L154 `PREFS_NAME = "auto_backup"`。 */
export const AUTO_BACKUP_PREFS_NAME = 'auto_backup';

/**
 * Kotlin L155-159 的五个键，加 `auto_backup_` 前缀以在单一 `app_settings` 表里去重
 * （Kotlin 靠独立 prefs 文件去重）。键名逐字对应：`enabled` / `tree` / `last_at` /
 * `last_result` / `restore_offered`。
 */
export const AUTO_BACKUP_SETTING_KEYS = {
  enabled: `${AUTO_BACKUP_PREFS_NAME}_enabled`,
  tree: `${AUTO_BACKUP_PREFS_NAME}_tree`,
  lastAt: `${AUTO_BACKUP_PREFS_NAME}_last_at`,
  lastResult: `${AUTO_BACKUP_PREFS_NAME}_last_result`,
  restoreOffered: `${AUTO_BACKUP_PREFS_NAME}_restore_offered`,
} as const;

/** Kotlin L68 `data class Snapshot(val name: String, val modifiedAt: Long)`。 */
export interface AutoBackupSnapshot {
  readonly name: string;
  /** 文件时间戳（毫秒）。来源见文件头「落点差异 3」。 */
  readonly modifiedAt: number;
}

/** Kotlin L173 `isDue(enabled, hasTree, lastSuccessAt, now)` 的入参。 */
export interface AutoBackupDueArgs {
  readonly enabled: boolean;
  readonly hasTree: boolean;
  readonly lastSuccessAt: number;
  readonly now: number;
}

const SNAPSHOT_NAME_RE = /^ciallo-auto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
}

export class AutoBackupStore {
  /** Kotlin L151 `FILE_PREFIX = "ciallo-auto-"`。 */
  static readonly FILE_PREFIX = 'ciallo-auto-';
  /** Kotlin L152 `FILE_SUFFIX = ".zip"`。 */
  static readonly FILE_SUFFIX = '.zip';
  /** Kotlin L153 `MIME = "application/zip"`（iOS 的 `writeFile` 按扩展名判断，保存备用）。 */
  static readonly MIME = 'application/zip';
  /** Kotlin L154 `PREFS_NAME`。 */
  static readonly PREFS_NAME = AUTO_BACKUP_PREFS_NAME;
  /** Kotlin L162 `MAX_KEPT = 3` —— 「保留份数：够覆盖一次误操作，又不至于把目录塞满」。 */
  static readonly MAX_KEPT = 3;
  /** Kotlin L165 `INTERVAL_MS = 12 * 60 * 60 * 1000L` —— 「自动备份的最小间隔」。 */
  static readonly INTERVAL_MS = 12 * 60 * 60 * 1000;

  /** Kotlin L167-171 `fileName(now)` —— `SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US)`。 */
  static fileName(now: number): string {
    const date = new Date(now);
    const stamp =
      `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
      `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
    return `${AutoBackupStore.FILE_PREFIX}${stamp}${AutoBackupStore.FILE_SUFFIX}`;
  }

  /**
   * Kotlin L173-174
   * `enabled && hasTree && now - lastSuccessAt >= INTERVAL_MS` —— 一分不差地保留三个合取项。
   * 注意 Kotlin 的 `isDue` 里**没有** Wi-Fi / 电量 / 充电条件（见 `autoBackup.ts` 文件头）。
   */
  static isDue(args: AutoBackupDueArgs): boolean {
    return args.enabled && args.hasTree && args.now - args.lastSuccessAt >= AutoBackupStore.INTERVAL_MS;
  }

  /** 名字是否属于本应用（Kotlin L75 `startsWith(FILE_PREFIX) && endsWith(FILE_SUFFIX)`）。 */
  static isSnapshotName(name: string): boolean {
    return name.startsWith(AutoBackupStore.FILE_PREFIX) && name.endsWith(AutoBackupStore.FILE_SUFFIX);
  }

  /** 从文件名反解时间戳；解不出给 0（等价于 Kotlin 读不到 `COLUMN_LAST_MODIFIED`）。 */
  static snapshotTime(name: string): number {
    const match = SNAPSHOT_NAME_RE.exec(name);
    if (match === null) return 0;
    const [, year, month, day, hour, minute, second] = match;
    return Date.UTC(
      Number(year ?? 0),
      Number(month ?? 1) - 1,
      Number(day ?? 1),
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0),
    );
  }

  constructor(
    private readonly fs: FileSystemApi,
    private readonly settings: SettingsRepository,
  ) {}

  /** Kotlin L24-26。 */
  async enabled(): Promise<boolean> {
    return this.settings.getBoolean(AUTO_BACKUP_SETTING_KEYS.enabled, false);
  }

  async setEnabled(value: boolean): Promise<void> {
    await this.settings.setBoolean(AUTO_BACKUP_SETTING_KEYS.enabled, value);
  }

  /** Kotlin L28-30。 */
  async lastSuccessAt(): Promise<number> {
    return this.settings.getLong(AUTO_BACKUP_SETTING_KEYS.lastAt, 0);
  }

  async setLastSuccessAt(value: number): Promise<void> {
    await this.settings.setLong(AUTO_BACKUP_SETTING_KEYS.lastAt, value);
  }

  /** Kotlin L32-34 —— `prefs.getString(KEY_LAST_RESULT, null)`，`null` 用删键表达。 */
  async lastResult(): Promise<string | null> {
    const value = await this.settings.getString(AUTO_BACKUP_SETTING_KEYS.lastResult, '');
    return value === '' ? null : value;
  }

  async setLastResult(value: string | null): Promise<void> {
    if (value === null) {
      await this.settings.remove(AUTO_BACKUP_SETTING_KEYS.lastResult);
      return;
    }
    await this.settings.setString(AUTO_BACKUP_SETTING_KEYS.lastResult, value);
  }

  /** Kotlin L37-39 —— 「每个安装只主动提示一次恢复」。 */
  async restoreOffered(): Promise<boolean> {
    return this.settings.getBoolean(AUTO_BACKUP_SETTING_KEYS.restoreOffered, false);
  }

  async setRestoreOffered(value: boolean): Promise<void> {
    await this.settings.setBoolean(AUTO_BACKUP_SETTING_KEYS.restoreOffered, value);
  }

  /**
   * Kotlin L41-43 —— `prefs.getString(KEY_TREE, null)?.let { Uri.parse }?.takeIf(::hasPermission)`。
   * 授权校验见文件头「落点差异 1」：iOS 在平台层，这里只判空。
   */
  async tree(): Promise<string | null> {
    const value = await this.settings.getString(AUTO_BACKUP_SETTING_KEYS.tree, '');
    return value === '' ? null : value;
  }

  /** Kotlin L45-52 —— `takePersistableUriPermission(READ|WRITE)` + 存 URI，失败返回 false。 */
  async attachTree(path: string): Promise<boolean> {
    const normalized = path.trim().replace(/\/+$/, '');
    if (normalized === '') return false;
    try {
      await this.settings.setString(AUTO_BACKUP_SETTING_KEYS.tree, normalized);
      return true;
    } catch {
      return false;
    }
  }

  /** Kotlin L54-56。 */
  async detachTree(): Promise<void> {
    await this.settings.remove(AUTO_BACKUP_SETTING_KEYS.tree);
  }

  /**
   * Kotlin L59-66 —— 「目录显示名（用户选择的文件夹名），取不到时给个中性说明」。
   * `COLUMN_DISPLAY_NAME` 是树文档的显示名，等价于路径最后一段。
   */
  async treeLabel(): Promise<string | null> {
    const folder = await this.tree();
    if (folder === null) return null;
    const base = folder.split('/').pop() ?? '';
    return base.trim() === '' ? null : base;
  }

  /** Kotlin L71-78 —— 「目录里属于本应用的备份，按时间从新到旧」。 */
  async snapshots(): Promise<AutoBackupSnapshot[]> {
    const folder = await this.tree();
    if (folder === null) return [];
    const children = await this.listChildren(folder);
    return children
      .filter((name) => AutoBackupStore.isSnapshotName(name))
      .map((name) => ({ name, modifiedAt: AutoBackupStore.snapshotTime(name) }))
      .sort((left, right) =>
        right.modifiedAt - left.modifiedAt === 0
          ? right.name.localeCompare(left.name)
          : right.modifiedAt - left.modifiedAt,
      );
  }

  /**
   * Kotlin L81-91 —— 「写一份备份；同名文件先删，避免系统自动改名堆出 "-1"」。
   * `createDocument` 返回 null / 打开输出流失败都折成 `false`（iOS 侧由异常折成 `false`）。
   */
  async write(name: string, source: string): Promise<boolean> {
    try {
      const folder = await this.tree();
      if (folder === null) return false;
      const bytes = await this.fs.readFile(source);
      await this.deleteChild(folder, name);
      await this.fs.writeFile(joinPath(folder, name), bytes);
      return true;
    } catch {
      return false;
    }
  }

  /** Kotlin L93-100 —— 读不出来或读到空文件都返回 `false`（`target.length() > 0L`）。 */
  async readInto(name: string, target: string): Promise<boolean> {
    try {
      const folder = await this.tree();
      if (folder === null) return false;
      const children = await this.listChildren(folder);
      if (!children.includes(name)) return false;
      const bytes = await this.fs.readFile(joinPath(folder, name));
      await this.fs.writeFile(target, bytes);
      return bytes.length > 0;
    } catch {
      return false;
    }
  }

  /** Kotlin L103-106 —— 「只保留最近 MAX_KEPT 份；排在后面的旧备份删掉」。 */
  async prune(): Promise<void> {
    const folder = await this.tree();
    if (folder === null) return;
    const stale = (await this.snapshots()).slice(AutoBackupStore.MAX_KEPT);
    for (const snapshot of stale) {
      await this.deleteChild(folder, snapshot.name);
    }
  }

  /** Kotlin L108-111。 */
  async delete(name: string): Promise<void> {
    const folder = await this.tree();
    if (folder === null) return;
    await this.deleteChild(folder, name);
  }

  /** Kotlin L115-135 `childDocuments` —— 目录直接子项的名字；读不到按空列表。 */
  private async listChildren(folder: string): Promise<string[]> {
    try {
      return await this.fs.list(folder);
    } catch {
      return [];
    }
  }

  /** Kotlin L137-141 `deleteChild` —— 同名子项存在才删，删失败静默（`runCatching`）。 */
  private async deleteChild(folder: string, name: string): Promise<void> {
    const children = await this.listChildren(folder);
    if (!children.includes(name)) return;
    try {
      await this.fs.delete(joinPath(folder, name));
    } catch {
      // Kotlin `runCatching { DocumentsContract.deleteDocument(...) }` —— 失败不抛出。
    }
  }
}

export function createAutoBackupStore(
  fs: FileSystemApi,
  settings: SettingsRepository,
): AutoBackupStore {
  return new AutoBackupStore(fs, settings);
}

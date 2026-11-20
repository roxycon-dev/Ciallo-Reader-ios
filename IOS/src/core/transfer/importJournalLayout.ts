/**
 * `transfer/ImportJournal.kt`（80 行 / 71 非空）的**文件层**决策 → `@core/transfer/importJournalLayout`。
 *
 * 为什么单独一层：Kotlin 这套日志是「一个私有目录 + 两个标记文件」——
 * `filesDir/transfer_journal/{database.rows, settings.json, pending.json, committed}`，
 * 提交成功后整目录要么删掉、要么改名为 `filesDir/transfer_undo` 留作回退。
 *
 * ⚠️ 端口 `@core/transfer/importJournal` 的 `TransferImportJournal` 走的是**另一套设计**：
 * 在 DB 内为每张表建一张 `_ciallo` 前缀的影子表，再用 `transfer_receipts` 里的
 * `journal:<id>` / `undo-snapshot:<id>` 两种回执标记 —— 不是文件与 `pending.json`。
 * 那套在「事务内可回滚」上更强，但它**没有**保留原文里下面这些可判定项：
 *
 *   · 目录名 `transfer_journal` / `transfer_undo`；
 *   · 四个标记文件名与「`pending.json` 存在即表示上次导入没走完」的语义；
 *   · 三条 `check(...)` 的中文文案（L20 / L21 / L48 / L75）；
 *   · `pending.json` 的两个字段名 `stage` / `keep`；
 *   · `recover` 里 `received_[a-f0-9-]+` 这一条「只删自己拉下来的暂存目录」的白名单；
 *   · `hasUndo` 的判据是 `transfer_undo/database.rows` **是文件**（不是目录存在）。
 *
 * 本模块只放这些纯决策，不碰 I/O —— 真机上的读写由宿主的文件端口做。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `fun directory(context) = File(filesDir, "transfer_journal")` | L12 | `IMPORT_JOURNAL_DIRECTORY` |
 * | `File(dir, "pending.json").exists()` → 「上一次导入需要先恢复」 | L20 | `PENDING_RECOVERY_MESSAGE` + `journalMarkerProblem()` |
 * | `check(dir.deleteRecursively())` → 「无法清理…」 | L21 | `STALE_SNAPSHOT_MESSAGE` |
 * | `File(dir, "database.rows")` | L23 / L58 | `DATABASE_ROWS_FILE` |
 * | `settings.json`（`PortableSettings.stores` + `god`） | L24-27 | `SETTINGS_FILE` + `PORTABLE_SETTINGS_STORES` |
 * | `for (name in listOf("source_configs","js_sources"))` | L28 / L62 | `JOURNAL_SOURCE_DIRECTORIES` |
 * | `pending.json` = `{"stage": stageName, "keep": keepUndo}` | L34 | `journalPendingPayload()` |
 * | `committed` 标记 | L40 | `COMMITTED_FILE` |
 * | `keep` → 改名 `transfer_undo` + 删两个标记 | L45-50 | `finalizeJournalPlan()` |
 * | `if(File(dir,"committed").exists()) finalize else restore` | L54-56 | `journalRecoveryPlan()` |
 * | `stageName.matches(Regex("received_[a-f0-9-]+"))` | L69 | `RECEIVED_STAGE_PATTERN` |
 * | `hasUndo` = `transfer_undo/database.rows` isFile | L72 | `hasUndoSnapshot()` |
 * | 「没有可用的回退快照」 | L75 | `NO_UNDO_SNAPSHOT_MESSAGE` |
 * | `activateUndo` 写 `{"stage":"", "keep":false}` | L78 | `ACTIVATE_UNDO_PAYLOAD` |
 */

/** L12 `File(context.filesDir, "transfer_journal")`。 */
export const IMPORT_JOURNAL_DIRECTORY = 'transfer_journal';
/** L46 / L74 `File(context.filesDir, "transfer_undo")`。 */
export const IMPORT_UNDO_DIRECTORY = 'transfer_undo';

/** L34 / L54 「上次导入没走完」的标记文件。 */
export const PENDING_FILE = 'pending.json';
/** L40 「已经提交」的标记文件 —— 有了它，快照轮换期间崩溃也不会误回滚。 */
export const COMMITTED_FILE = 'committed';
/** L23 / L58 `ArchiveRows.snapshot/restoreSnapshot` 的目标文件。 */
export const DATABASE_ROWS_FILE = 'database.rows';
/** L24-27 三个 SharedPreferences 存储 + `god` 的快照。 */
export const SETTINGS_FILE = 'settings.json';

/** L25 `PortableSettings.stores` —— `PortableSettings.kt` L14。 */
export const PORTABLE_SETTINGS_STORES = [
  'novel_reader_prefs',
  'comic_reader_store',
  'book_sources_config',
] as const;

/** L26 `prefs.put("god", GodMomentSettingsStore(context).exportPortable())` 的键名。 */
export const GOD_SETTINGS_KEY = 'god';

/** L28 / L62 两个要整目录备份与恢复的书源目录。 */
export const JOURNAL_SOURCE_DIRECTORIES = ['source_configs', 'js_sources'] as const;

/** L20 `check(!File(dir, "pending.json").exists()) { tr("上一次导入需要先恢复") }`。 */
export const PENDING_RECOVERY_MESSAGE = '上一次导入需要先恢复';
/** L21 `check(dir.deleteRecursively()) { tr("无法清理上次未开始提交的临时快照") }`。 */
export const STALE_SNAPSHOT_MESSAGE = '无法清理上次未开始提交的临时快照';
/** L48 `check(dir.renameTo(undo)) { tr("无法保留迁移回退快照") }`。 */
export const KEEP_UNDO_FAILED_MESSAGE = '无法保留迁移回退快照';
/** L75 `check(hasUndo(context)) { tr("没有可用的回退快照") }`。 */
export const NO_UNDO_SNAPSHOT_MESSAGE = '没有可用的回退快照';

/**
 * L69 `if(stageName.matches(Regex("received_[a-f0-9-]+"))) File(filesDir, stageName).deleteRecursively()`
 *
 * 这条白名单是**安全边界**：`stage` 字段来自 `pending.json`，而那个文件是磁盘上可被篡改的。
 * 不校验就 `deleteRecursively()`，一个被改写成 `..` 或某个真实目录名的 `stage`
 * 会在「恢复」时把别的东西删掉。正则只认 `received_` + 十六进制与小写字母连字符。
 */
export const RECEIVED_STAGE_PATTERN = /^received_[a-f0-9-]+$/;

/** L69 `stageName.matches(...)`。 */
export function isReceivedStageName(stageName: string): boolean {
  return RECEIVED_STAGE_PATTERN.test(stageName);
}

/** L34 写进 `pending.json` 的两个字段。 */
export interface JournalPendingPayload {
  readonly stage: string;
  readonly keep: boolean;
}

/** L34 `JSONObject().put("stage", stageName).put("keep", keepUndo)`。 */
export function journalPendingPayload(stageName: string, keepUndo: boolean): JournalPendingPayload {
  return { stage: stageName, keep: keepUndo };
}

/** L78 `JSONObject().put("stage", "").put("keep", false)` —— 激活回退快照时的标记。 */
export const ACTIVATE_UNDO_PAYLOAD: JournalPendingPayload = { stage: '', keep: false };

/**
 * L20-21 的两道开跑前检查，按顺序返回要抛的中文文案（`null` = 可以开跑）。
 *
 * `deleteSucceeded` 只有在目录**存在**时才需要为真（L21 的 `if(dir.exists())`）。
 */
export function journalPrepareProblem(input: {
  readonly pendingExists: boolean;
  readonly directoryExists: boolean;
  readonly deleteSucceeded: boolean;
}): string | null {
  if (input.pendingExists) return PENDING_RECOVERY_MESSAGE;
  if (input.directoryExists && !input.deleteSucceeded) return STALE_SNAPSHOT_MESSAGE;
  return null;
}

/** L43-51 `finalizeCommitted` 的两种收尾。 */
export type JournalFinalizePlan =
  | { readonly mode: 'keep'; readonly renameTo: typeof IMPORT_UNDO_DIRECTORY; readonly deleteMarkers: readonly string[] }
  | { readonly mode: 'discard' };

/**
 * L45-50：`keep` 为真 → 把整个目录改名成 `transfer_undo` 并删掉 `pending.json` 与
 * `committed`（留着它们，下次启动会把「已回退的快照」当成「未完成的导入」再回滚一次）；
 * 否则直接把目录删掉。
 */
export function finalizeJournalPlan(keep: boolean): JournalFinalizePlan {
  if (!keep) return { mode: 'discard' };
  return { mode: 'keep', renameTo: IMPORT_UNDO_DIRECTORY, deleteMarkers: [PENDING_FILE, COMMITTED_FILE] };
}

/** L52-56 `recover` 的三条去向。 */
export type JournalRecoveryPlan = 'none' | 'finalize' | 'restore';

/**
 * L54-56：
 * ```
 * if(!marker.exists()) return          // 没有 pending.json → 什么都不做
 * if(committed.exists()) { finalize; return }
 * … beginTransaction / restoreSnapshot / endTransaction …
 * ```
 *
 * 顺序即语义：**先看 `committed`**。只按 `pending` 判断会把握手成功但文件清理未跑的导入
 * 当成失败、把书库回滚成导入前的样子 —— 用户会看到「导入成功了，重启后书没了」。
 */
export function journalRecoveryPlan(input: {
  readonly pendingExists: boolean;
  readonly committedExists: boolean;
}): JournalRecoveryPlan {
  if (!input.pendingExists) return 'none';
  return input.committedExists ? 'finalize' : 'restore';
}

/**
 * L72 `File(context.filesDir, "transfer_undo/database.rows").isFile`
 *
 * 判据是**那个文件**存在，不是 `transfer_undo` 目录存在 —— 目录存在但 `database.rows`
 * 缺失（例如上次 rename 完成而快照写失败）不算「有可用的回退快照」。
 */
export function hasUndoSnapshot(files: {
  readonly undoDatabaseRowsIsFile: boolean;
}): boolean {
  return files.undoDatabaseRowsIsFile;
}

/** L76-78 `activateUndo` 的三步（`check(!pending.json)` → 改名 → 写标记）。 */
export function activateUndoProblem(input: {
  readonly hasUndo: boolean;
  readonly pendingExists: boolean;
}): string | null {
  if (!input.hasUndo) return NO_UNDO_SNAPSHOT_MESSAGE;
  // L76 `check(!File(dir,"pending.json").exists())` —— 没有自定义文案，Kotlin 的
  // `check` 无 message 时抛 `IllegalStateException("Check failed.")`。
  if (input.pendingExists) return 'Check failed.';
  return null;
}

/** L47-48 / L77 `undo.deleteRecursively()` + `check(dir.renameTo(undo))` 的失败文案。 */
export const RENAME_UNDO_FAILED_MESSAGE = KEEP_UNDO_FAILED_MESSAGE;

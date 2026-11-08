import { strFromU8, strToU8 } from 'fflate';
import { createIndexSql, createTableSql, TABLES } from '@core/db/schemaV12';
import type { SettingsRepository } from '@core/settings/settingsRepository';
import type { FileSystemApi, SQLiteDatabase, SqlValue } from '@platform/interfaces';
import type { GodMomentRepository } from '@core/god/godMomentRepository';
import {
  buildJsonBackup,
  importGodMomentsJson,
  kotlinFloatToString,
  parseJsonBackup,
  readFontSize,
  readLineHeight,
  readPageTurnMode,
  readReaderTheme,
  readRestReminderMinutes,
  readScreenOrientationLock,
  readSplashPureMode,
  type JsonPreferenceKey,
} from './backupManagerJson';
import {
  BACKUP_TABLES_ORDER,
  MAX_ROWS,
  parseBoundedLines,
  parseRowLine,
  restoreFilesPath,
} from './backupArchiveFormat';
import {
  buildBackupArchiveBytes,
  buildDatabaseRowsNdjson,
  encodeSettingsPayload,
  parseSettingsPayload,
  readBackupArchiveBytes,
  validateRestoredRow,
  validateRestoreHeader,
} from './backupArchive';

type ColumnInfo = { type: string; notNull: boolean };

/**
 * 内容嗅探：首个非空白字节是 `{`（JSON 对象）⇒ 信封，否则按 ZIP 处理。信封由
 * `JSON.stringify` 产出、永无前导空白；ZIP 魔数是 `PK\x03\x04`，两者不相交。Kotlin 侧
 * 是两个并列 API 入口（`restoreBackupArchive` 只吃 ZIP、`restoreBackupJson` 只吃 JSON
 * 对象），iOS 只有一个恢复入口，故把两个入口合并为按内容分发。
 */
function looksLikeJsonEnvelope(bytes: Uint8Array): boolean {
  let i = 0;
  // UTF-8 BOM（org.json 不写它，但手工编辑的文件可能带）。
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  for (; i < bytes.length; i += 1) {
    const b = bytes[i] as number;
    // JSON 允许的前导空白：空格 / \t / \n / \r
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    return b === 0x7b; // '{'
  }
  return false; // 空文件 → 按 ZIP 处理，由 ZIP 解析给出报错
}

/**
 * 2026-10-11（E79 接线）——导出/恢复编排对齐 Kotlin `BackupManager` 的**两个**通道：
 *
 *  - 导出：`exportBackup` ≙ `BackupManager.exportBackupJson`（BackupManager.kt 50..80），
 *    产物为 JSON 兼容信封 `{archive, exportTime, booksCount, preferences, godMoments}`；
 *    内层 ZIP 仍由 `backupArchive.ts` 产出（与 Android `BackupArchive.export` 逐字节同构，
 *    god_moments 行照旧在 `database.rows` 里 —— Kotlin 的内层 ZIP 同样如此），信封外层的
 *    神回走 14 字段独立数组、**不含 coverPath**（GodMomentRepository.kt L103-127）。
 *  - 恢复：`importBackup` ≙ `restoreBackupJson`（82..108）+ `restoreBackupArchive`。iOS
 *    只有一个恢复入口，按内容分发：首个非空白字节为 `{` → 信封路径（archive 优先并立即
 *    返回，否则轻量恢复 preferences + godMoments）；否则 → ZIP 路径（Android 设置页 UI
 *    导出的就是 ZIP，跨端互通靠它）。神回恢复走 `importGodMomentsJson` + 仓库 upsert，
 *    coverPath 恒 null、rating coerceIn(0.5,5)、空 bookId/chapterId 跳过 —— 不再依赖
 *    通用 rows 通道。
 */
export class BackupService {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly fs: FileSystemApi,
    private readonly settingsRepo: SettingsRepository,
    private readonly filesRoot = '',
    /**
     * Kotlin `BackupManager(context, prefs, godRepository)`（BackupManager.kt L16-20）：
     * 神回仓库由装配方注入。缺省 null 时导出不写 `godMoments` 键、恢复跳过神回导入
     * （与 Kotlin 的可空默认一致）。
     */
    private readonly godRepo: GodMomentRepository | null = null,
  ) {}

  /**
   * Kotlin `BackupArchive.export` (BackupArchive.kt 45..65) wraps the whole row dump in
   * `db.withTransaction { … }`, so the 12 tables are read from **one** snapshot: a book
   * deleted while the archive is being written can never end up with chapters in the
   * archive but no book row. The zip is then built outside that block (lines 66..88).
   */
  /**
   * Kotlin `BackupManager.exportBackupJson` (BackupManager.kt 50..80)。行快照事务来自
   * `BackupArchive.export` L45（见上），ZIP 打包在该事务外（L66-88）；信封装配在归档
   * 完成**之后**（L56-75）：godArray → booksCount → preferences → JSONObject。
   */
  async exportBackup(path: string): Promise<void> {
    await this.ensureSchema();
    await this.db.execute('BEGIN');
    let databaseRows: string;
    try {
      databaseRows = await buildDatabaseRowsNdjson(this, this.filesRoot);
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }
    const settingsJson = encodeSettingsPayload(await this.settingsRepo.exportEntries(this.filesRoot));
    // Kotlin L51-55：`exportBackupArchive(...)` 的 ZIP 字节直接进信封（内存中完成，
    // 不落临时文件）；16 MiB 闸门在 buildJsonBackup 内（Kotlin L53）。
    const archiveBytes = await buildBackupArchiveBytes(
      this.fs,
      databaseRows,
      settingsJson,
      this.filesRoot,
    );
    // Kotlin L56：`godRepository?.runCatching { exportJson() }?.getOrNull()` —— 仓库缺省
    // ⇒ null ⇒ 不写 godMoments 键。iOS 的 `all()` 自带 guarded 降级（失败 ⇒ 空数组，
    // GodMomentRepository.kt L33-37 的语义），空库同样是 `[]`，与 Kotlin 正常路径一致。
    // 14 字段投影（不含 coverPath）在 buildJsonBackup 内完成（Kotlin L74）。
    const godMoments = this.godRepo === null ? null : await this.godRepo.all();
    // Kotlin L58：`AppDatabase.getDatabase(context).bookDao().getBooksCount()`
    const booksCount = await this.countBooks();
    const json = buildJsonBackup({
      archiveBytes,
      booksCount,
      preferences: await this.jsonPreferences(),
      godMoments,
      now: Date.now(),
    });
    // Kotlin L77：`File(context.filesDir, "novel_reader_backup.json")` —— 信封落盘。
    await this.fs.writeFile(path, strToU8(json));
  }

  /**
   * Kotlin `BackupManager.restoreBackupJson` (BackupManager.kt 82..108) 与
   * `restoreBackupArchive` 的合一入口。按**内容**分发（见类注释）：
   * JSON 信封 → 信封恢复；其余（PK 魔数）→ ZIP 恢复。
   */
  async importBackup(path: string): Promise<void> {
    await this.ensureSchema();
    const bytes = await this.fs.readFile(path);
    if (looksLikeJsonEnvelope(bytes)) {
      await this.importJsonEnvelope(strFromU8(bytes));
      return;
    }
    await this.restoreZipBytes(bytes);
  }

  /** Kotlin L84-103 —— 信封体：archive 优先并立即返回，否则轻量恢复。 */
  private async importJsonEnvelope(json: string): Promise<void> {
    const parsed = parseJsonBackup(json);
    if (parsed.hasArchive && parsed.archiveBytes !== null) {
      // Kotlin L85-90：archive 非空 ⇒ 整个 JSON 只是 ZIP 的载体，解 base64 还原成 ZIP
      // 走 ZIP 恢复并**立即返回**；preferences 与 godMoments 在这条路径上不参与。
      await this.restoreZipBytes(parsed.archiveBytes);
      return;
    }
    // Kotlin L91：`optJSONObject("preferences") ?: return@withContext false` —— 没有归档
    // 又没有 preferences 对象的信封不是合法的轻量备份。Kotlin 静默返回 false，iOS 的
    // 恢复入口靠异常报错，这里给出对应中文文案。
    if (!parsed.hasPreferences) {
      throw new Error('备份缺少 preferences 字段');
    }
    // Kotlin L93-99 → L102：先 preferences 后神回。
    await this.applyEnvelopePreferences(parsed.preferences);
    // Kotlin L102：`payload.optJSONArray("godMoments")?.let { godRepository?.importJson(it) }`
    // —— godMoments 键缺失或仓库缺省都跳过；恢复值恒 coverPath = null（Kotlin L147）。
    if (parsed.godMoments !== null && this.godRepo !== null) {
      const { moments } = importGodMomentsJson(parsed.godMoments, Date.now());
      for (const moment of moments) {
        // Kotlin L154 `save(e)`：同 (bookId, chapterId) 覆盖（复用 id / createdAt）。
        await this.godRepo.upsert(moment);
      }
    }
  }

  /** Kotlin L93-99 —— 逐项独立应用：区间外的值静默跳过，不中断其余项。 */
  private async applyEnvelopePreferences(
    prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
  ): Promise<void> {
    const fontSize = readFontSize(prefs);
    if (fontSize !== null) await this.settingsRepo.setFloat('font_size', fontSize);
    const lineHeight = readLineHeight(prefs);
    if (lineHeight !== null) await this.settingsRepo.setFloat('line_height', lineHeight);
    const readerTheme = readReaderTheme(prefs);
    if (readerTheme !== null) await this.settingsRepo.setInt('reader_theme', readerTheme);
    const pageTurnMode = readPageTurnMode(prefs);
    if (pageTurnMode !== null) await this.settingsRepo.setInt('page_turn_mode', pageTurnMode);
    const splashPureMode = readSplashPureMode(prefs);
    if (splashPureMode !== null) {
      await this.settingsRepo.setBoolean('splash_pure_mode', splashPureMode);
    }
    const orientationLock = readScreenOrientationLock(prefs);
    if (orientationLock !== null) {
      await this.settingsRepo.setInt('screen_orientation_lock', orientationLock);
    }
    const restReminder = readRestReminderMinutes(prefs);
    if (restReminder !== null) {
      await this.settingsRepo.setInt('rest_reminder_minutes', restReminder);
    }
  }

  /**
   * Kotlin L59-67 —— 信封 `preferences` 的 7 个键名是 PreferencesManager 属性的
   * camelCase（与 ZIP 通道 settings.json 的 snake_case 键名**不同**，Kotlin 原样，不要
   * 「统一」）。取值默认与 `PreferencesManager.kt` L15-80 的 SharedPreferences 默认值
   * 一致；Float 用 Kotlin `Float.toString()` 序列化（`18f` → `"18.0"`）。
   */
  private async jsonPreferences(): Promise<Partial<Record<JsonPreferenceKey, string>>> {
    const [fontSize, lineHeight, readerTheme, pageTurnMode, splashPureMode, orientationLock, restReminder] =
      await Promise.all([
        this.settingsRepo.getFloat('font_size', 18),
        this.settingsRepo.getFloat('line_height', 28),
        this.settingsRepo.getInt('reader_theme', 1),
        this.settingsRepo.getInt('page_turn_mode', 0),
        this.settingsRepo.getBoolean('splash_pure_mode', false),
        this.settingsRepo.getInt('screen_orientation_lock', 0),
        this.settingsRepo.getInt('rest_reminder_minutes', 30),
      ]);
    return {
      fontSize: kotlinFloatToString(fontSize),
      lineHeight: kotlinFloatToString(lineHeight),
      readerTheme: String(readerTheme),
      pageTurnMode: String(pageTurnMode),
      splashPureMode: splashPureMode ? 'true' : 'false',
      screenOrientationLock: String(orientationLock),
      restReminderMinutes: String(restReminder),
    };
  }

  /** Kotlin L58 `bookDao().getBooksCount()`。 */
  private async countBooks(): Promise<number> {
    const rows = await this.db.query<{ count: number }>('SELECT COUNT(*) FROM "books"');
    return rows[0]?.count ?? 0;
  }

  /** ZIP 恢复 ≙ Kotlin `restoreBackupArchive` → `BackupArchive.restore`。 */
  private async restoreZipBytes(bytes: Uint8Array): Promise<void> {
    const { databaseRows, settingsJson, files } = readBackupArchiveBytes(bytes);
    // Gap A (E12): materialise the bundled file assets into the device files directory
    // before the DB rows / settings are applied, exactly like Android's zip extraction.
    await this.restoreFileAssets(files);
    const settingsEntries = parseSettingsPayload(settingsJson);

    const lines = parseBoundedLines(databaseRows);
    if (lines.length === 0) {
      throw new Error('缺少备份元数据');
    }
    const header = JSON.parse(lines[0] ?? '') as { version?: number; schema?: number };
    validateRestoreHeader(header);

    const rowLines = lines.slice(1);
    if (rowLines.length > MAX_ROWS) {
      throw new Error('备份行数超过安全上限');
    }

    const columnCache = await this.loadColumnCache();
    const parsedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
    for (const line of rowLines) {
      const { table, row } = parseRowLine(line);
      if (!BACKUP_TABLES_ORDER.includes(table)) {
        throw new Error('备份包含未知表');
      }
      const columns = columnCache.get(table);
      if (!columns) {
        throw new Error('备份列与数据库不一致');
      }
      validateRestoredRow(table, row, columns);
      parsedRows.push({ table, row });
    }

    // Android `BackupArchive.restore` (BackupArchive.kt 149..189): the database rows are
    // restored inside one `db.withTransaction { … }` and the preference editor is only
    // `commit()`-ed **after** that block returns — line 189,
    // `check(editor.commit()) { "设置恢复失败，书籍数据已恢复" }`. So a failure while
    // restoring rows leaves the user's preferences untouched. The previous order here
    // (settings first) meant a failed row restore left settings already wiped.
    await this.db.execute('BEGIN');
    try {
      for (const table of [...BACKUP_TABLES_ORDER].reverse()) {
        await this.db.execute(`DELETE FROM "${table}"`);
      }
      for (const { table, row } of parsedRows) {
        const names = Object.keys(row);
        const columns = names.map((name) => `"${name}"`).join(', ');
        const placeholders = names.map(() => '?').join(', ');
        const params: SqlValue[] = names.map((name) => {
          const value = row[name];
          if (value === undefined) return null;
          // Kotlin line 175: `is String -> value.replace("@FILES@", root)`.
          return typeof value === 'string'
            ? restoreFilesPath(value, this.filesRoot)
            : (value as SqlValue);
        });
        await this.db.execute(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`, params);
      }
      await this.assertNoOrphanBookReferences();
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }

    try {
      await this.settingsRepo.restoreSafeEntries(settingsEntries, this.filesRoot);
    } catch (error) {
      throw new Error(`设置恢复失败，书籍数据已恢复: ${(error as Error).message}`);
    }
  }

  /**
   * Gap A (E12) restore half — Kotlin `BackupArchive.restore` L106 writes every `files/…`
   * ZIP entry under the stage directory. Each archive entry name is `files/<relativePath>`,
   * so we strip the `files/` prefix and write the bytes to `<filesRoot>/<relativePath>`,
   * which is exactly where the `@FILES@` placeholder in the DB rows / settings resolves to.
   * With `filesRoot === ''` (no device directory configured) there is nowhere to write, so
   * the assets are intentionally dropped — matching Android, which always has a files dir.
   */
  private async restoreFileAssets(files: Map<string, Uint8Array>): Promise<void> {
    if (this.filesRoot === '') return;
    for (const [name, data] of files) {
      const rel = name.slice('files/'.length);
      await this.fs.writeFile(`${this.filesRoot.replace(/\/+$/, '')}/${rel}`, data);
    }
  }

  /**
   * Kotlin `BackupArchive.restore` lines 183..186 — runs inside the same transaction as
   * the row inserts, so a failure also rolls those inserts back:
   *
   * ```kotlin
   * for (table in listOf("chapters", "bookmarks", "highlights")) {
   *     val orphan = …query("SELECT COUNT(*) FROM `$table` x LEFT JOIN books b
   *                          ON x.bookId = b.id WHERE b.id IS NULL")
   *     require(orphan == 0L) { "备份包含孤立的书籍关联" }
   * }
   * ```
   *
   * None of these tables has a Room foreign key (12.json `foreignKeys: []` everywhere),
   * so this post-condition is the only thing stopping a hand-edited archive from
   * leaving chapter / bookmark / highlight rows pointing at books that do not exist.
   * The predicate is evaluated in JS rather than SQL so it behaves the same on the
   * Capacitor bridge and on the in-memory web mock.
   */
  private async assertNoOrphanBookReferences(): Promise<void> {
    const bookRows = await this.db.query<{ id: number }>('SELECT "id" FROM "books"');
    const bookIds = new Set(bookRows.map((row) => row.id));
    for (const table of ['chapters', 'bookmarks', 'highlights']) {
      const rows = await this.db.query<{ bookId: number | null }>(`SELECT "bookId" FROM "${table}"`);
      if (rows.some((row) => row.bookId == null || !bookIds.has(row.bookId))) {
        throw new Error('备份包含孤立的书籍关联');
      }
    }
  }

  async selectAll(table: string): Promise<Array<Record<string, unknown>>> {
    return this.db.query(`SELECT * FROM "${table}"`);
  }

  private async ensureSchema(): Promise<void> {
    for (const table of TABLES) {
      await this.db.execute(createTableSql(table));
      for (const index of table.indices) {
        await this.db.execute(createIndexSql(table, index));
      }
    }
  }

  private async loadColumnCache(): Promise<Map<string, Map<string, ColumnInfo>>> {
    const cache = new Map<string, Map<string, ColumnInfo>>();
    for (const table of BACKUP_TABLES_ORDER) {
      const rows = await this.db.query<{ name: string; type: string; notnull: number }>(
        `PRAGMA table_info("${table}")`,
      );
      const columns = new Map<string, ColumnInfo>();
      for (const row of rows) {
        columns.set(row.name, { type: row.type, notNull: row.notnull !== 0 });
      }
      cache.set(table, columns);
    }
    return cache;
  }
}

export function createBackupService(
  db: SQLiteDatabase,
  fs: FileSystemApi,
  settingsRepo: SettingsRepository,
  filesRoot = '',
  godRepo: GodMomentRepository | null = null,
): BackupService {
  return new BackupService(db, fs, settingsRepo, filesRoot, godRepo);
}

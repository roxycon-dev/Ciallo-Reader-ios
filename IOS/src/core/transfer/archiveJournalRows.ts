/**
 * archiveJournalRows.ts —— `transfer/ArchiveRows.kt`（73 行）的日志层移植。
 *
 * ⚠️ 与 `transfer/archiveDatabaseRows.ts` **不是同一个东西**：那个是 **portable 归档**的
 * 行读写（`ArchiveDatabaseRows` / `RelatedArchiveRows`，按 `PortableEnvelope` 逐表合并）；
 * Kotlin 这个 object 是 **设备互传日志**（NDJSON）的快照格式：
 *
 * ```kotlin
 * internal object ArchiveRows {
 *     val tables = BackupArchive.tables
 *     val journalTables = tables + listOf("transfer_identities", "transfer_receipts")
 *     fun row(cursor: Cursor): JSONObject                 // 列类型映射，else error("不支持的数据库类型")
 *     fun all(db, table, where = "1", args = emptyArray()) // require(table in journalTables)
 *     fun insert(db, table, row, replace = false): Long    // 列名须匹配字母开头的标识符，else error("无效数据库字段")
 *     fun boundedLine(reader: Reader): String?            // 512 KiB 上限 / LF 终止 / EOF 空串 → null
 *     fun forEach(file, table = null, action)             // header version 1..2 & schema 12..13；≤ 100 万行
 *     fun snapshot(db, destination)
 *     fun restoreSnapshot(db, source)                     // 先按 journalTables 反序 DELETE
 * }
 * ```
 *
 * 移植边界（见 `docs/PARITY_EXCEPTIONS.md` E186）：
 *   · `Cursor` → 已读出的行对象 `Record<string, SqlValue>`（平台的 `query` 直接给行）；
 *   · `SupportSQLiteDatabase` → `SqliteExecutor`（`@platform/interfaces`）；
 *   · `java.io.Reader` / `File` → 文本（`boundedLinesOf(text)`），文件读写留给宿主；
 *   · `org.json.JSONObject` → 普通对象 + `JSON.parse/stringify`（与 `backupArchiveFormat` 一致）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L13 `val tables = BackupArchive.tables`                → `BACKUP_ARCHIVE_TABLES`
 *   L14 `val journalTables = tables + listOf(…)`            → `JOURNAL_TABLES`
 *   L15-23 `fun row(cursor)`                                → `archiveRow(row)`
 *   L24-27 `fun all(db, table, where, args)`                → `allRows(db, table, where, args)`
 *   L28-42 `fun insert(db, table, row, replace)`            → `insertRow(db, table, row, replace)`
 *   L43-48 `fun boundedLine(reader)`                        → `boundedLinesOf(text)` / `boundedLineAt`
 *   L49-61 `fun forEach(file, table, action)`               → `forEachRow(text, table, action)`
 *   L62-66 `fun snapshot(db, destination)`                  → `snapshotRows(db)`
 *   L67-72 `fun restoreSnapshot(db, source)`                → `restoreSnapshotRows(db, text)`
 */


import type { SqlValue, SqliteExecutor } from '@platform/interfaces';

/**
 * Kotlin L13 `val tables = BackupArchive.tables`。
 *
 * ⚠️ 是 `BackupArchive.kt` L21-22 里那 **12 个显式表名**，不是整张 Room schema ——
 * `transfer_identities` / `transfer_receipts` / `download_tasks` 都**不在**这个列表里，
 * 所以 `forEach` 的 `require(name in tables)` 会拒绝 `transfer_*`（它们只用于快照落盘）。
 */
export const BACKUP_ARCHIVE_TABLES: readonly string[] = [
  'books', 'chapters', 'bookmarks', 'highlights', 'categories',
  'reading_records', 'reading_sessions', 'favorites', 'comic_progress', 'comic_chapter_read',
  'favorite_categories', 'god_moments',
];

/** Kotlin L14 `val journalTables = tables + listOf("transfer_identities", "transfer_receipts")`。 */
export const JOURNAL_TABLES: readonly string[] = [
  ...BACKUP_ARCHIVE_TABLES,
  'transfer_identities',
  'transfer_receipts',
];

/** Kotlin L52 `header.getInt("version") in 1..2`。 */
export const JOURNAL_VERSION_MIN = 1;
export const JOURNAL_VERSION_MAX = 2;
/** Kotlin L52 `header.getInt("schema") in 12..13`。 */
export const JOURNAL_SCHEMA_MIN = 12;
export const JOURNAL_SCHEMA_MAX = 13;
/** Kotlin L55 `require(++count <= 1_000_000)`。 */
export const JOURNAL_MAX_ROWS = 1_000_000;
/** Kotlin L47 `require(text.length < 512 * 1024)`。 */
export const JOURNAL_MAX_LINE_CHARS = 512 * 1024;

/** Kotlin `JSONObject` 的一行（列名 → 值）。 */
export type ArchiveRowValue = string | number | boolean | null;
export type ArchiveRow = Record<string, ArchiveRowValue>;

/**
 * Kotlin L15-23 `fun row(cursor: Cursor): JSONObject`。
 *
 * Kotlin 直接读 `cursor.getType(i)`：NULL / INTEGER / FLOAT / STRING，其余抛
 * `不支持的数据库类型`（BLOB 走的就是这条）。TS 侧的平台查询已经把列解成
 * `SqlValue`，所以这里按**值类型**判定，并把 `Uint8Array`（BLOB）判为不支持。
 */
export function archiveRow(row: Readonly<Record<string, SqlValue>>): ArchiveRow {
  const out: ArchiveRow = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[column] = null;
    } else if (typeof value === 'string') {
      out[column] = value;
    } else if (typeof value === 'number') {
      out[column] = value;
    } else if (value instanceof Uint8Array) {
      // Cursor.FIELD_TYPE_BLOB 在 Kotlin 里落进 `else -> error(...)`
      throw new Error('不支持的数据库类型');
    } else {
      throw new Error('不支持的数据库类型');
    }
  }
  return out;
}

/**
 * Kotlin L24-27 `fun all(db, table, where = "1", args = emptyArray()): List<JSONObject>`。
 *
 * `require(table in journalTables)` —— 表名不在白名单里直接抛，绝不拼进 SQL。
 */
export async function allRows(
  db: SqliteExecutor,
  table: string,
  where = '1',
  args: readonly SqlValue[] = [],
): Promise<ArchiveRow[]> {
  requireJournalTable(table);
  const rows = await db.query<Record<string, SqlValue>>(
    `SELECT * FROM \`${table}\` WHERE ${where}`,
    [...args],
  );
  return rows.map((row) => archiveRow(row));
}

/** Kotlin L25 / L29 的 `require(table in journalTables)`。 */
export function requireJournalTable(table: string): void {
  if (!JOURNAL_TABLES.includes(table)) {
    throw new Error(`未知数据表：${table}`);
  }
}

/** Kotlin L31 `require(keys.all { it.matches(Regex("[a-zA-Z][a-zA-Z0-9_]*")) })`。 */
export const ARCHIVE_COLUMN_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Kotlin L28-42 `fun insert(db, table, row, replace = false): Long`。
 *
 * 列名先过正则（防注入），值按类型绑：`null → bindNull`、`string → bindString`、
 * `float/double → bindDouble`、其余数字 → `bindLong`，其它一律 `无效数据库字段`。
 */
export async function insertRow(
  db: SqliteExecutor,
  table: string,
  row: Readonly<Record<string, unknown>>,
  replace = false,
): Promise<number> {
  requireJournalTable(table);
  const keys = Object.keys(row);
  if (!keys.every((key) => ARCHIVE_COLUMN_PATTERN.test(key))) {
    throw new Error('无效数据库字段');
  }
  const sql =
    `INSERT ${replace ? 'OR REPLACE ' : ''}INTO \`${table}\` (` +
    `${keys.map((key) => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const params: SqlValue[] = keys.map((key) => {
    const value = row[key];
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return value;
    throw new Error('无效数据库字段');
  });
  const result = await db.execute(sql, params);
  if (result.lastInsertRowId !== undefined) return result.lastInsertRowId;
  const inserted = (await db.query<{ id: number }>('SELECT last_insert_rowid() AS id'))[0]?.id;
  if (typeof inserted !== 'number' || !Number.isSafeInteger(inserted)) {
    throw new Error('导入主键未返回');
  }
  return inserted;
}

/**
 * Kotlin L43-48 `fun boundedLine(reader: Reader): String?`。
 *
 * 逐字符读到 LF 为止；EOF 且已读内容为空 → `null`；超过 512 K 字符 → `数据行过大`。
 * 注意 Kotlin **只**认 `\n`（`ch == 10`），`\r` 属于行内容 —— 与
 * `backupArchiveFormat.parseBoundedLines` 的处理一致。
 *
 * @returns `[line, nextIndex]`，或 `null`（EOF）
 */
export function boundedLineAt(
  text: string,
  offset: number,
): { readonly line: string; readonly next: number } | null {
  let index = offset;
  const builder: string[] = [];
  for (;;) {
    if (index >= text.length) {
      if (builder.length === 0) return null;
      return { line: builder.join(''), next: index };
    }
    const ch = text[index] as string;
    index += 1;
    if (ch === '\n') return { line: builder.join(''), next: index };
    if (builder.length >= JOURNAL_MAX_LINE_CHARS) throw new Error('数据行过大');
    builder.push(ch);
  }
}

/** Kotlin L43-48 的整段版本：把文本切成有界行。 */
export function boundedLinesOf(text: string): string[] {
  const lines: string[] = [];
  let offset = 0;
  for (;;) {
    const read = boundedLineAt(text, offset);
    if (read === null) return lines;
    lines.push(read.line);
    offset = read.next;
  }
}

/** journal 文件头（Kotlin L51 `JSONObject(boundedLine(reader))`）。 */
export interface JournalHeader {
  readonly version: number;
  readonly schema: number;
}

/**
 * Kotlin L51-52 的头部校验：
 * `require(header.getInt("version") in 1..2 && header.getInt("schema") in 12..13)`。
 */
export function parseJournalHeader(text: string): JournalHeader {
  const lines = boundedLinesOf(text);
  const first = lines[0];
  if (first === undefined) throw new Error('缺少数据头');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(first) as Record<string, unknown>;
  } catch {
    throw new Error('缺少数据头');
  }
  const version = header['version'];
  const schema = header['schema'];
  const ok =
    typeof version === 'number' &&
    typeof schema === 'number' &&
    version >= JOURNAL_VERSION_MIN &&
    version <= JOURNAL_VERSION_MAX &&
    schema >= JOURNAL_SCHEMA_MIN &&
    schema <= JOURNAL_SCHEMA_MAX;
  if (!ok) throw new Error('不支持的数据版本，请升级应用');
  return { version, schema };
}

/**
 * Kotlin L49-61 `fun forEach(file, table = null, action: (String, JSONObject, JSONObject) -> Unit)`。
 *
 * 逐行读 envelope：`{"table": …, "row": {…}}`；`table in tables`（注意是 **tables**，
 * 不含 `transfer_*`）；行数上限 100 万；`table == null` 时全给，否则只给匹配的那张表。
 */
export function forEachRow(
  text: string,
  table: string | null,
  action: (name: string, row: ArchiveRow, envelope: Record<string, unknown>) => void,
): void {
  const lines = boundedLinesOf(text);
  const first = lines[0];
  if (first === undefined) throw new Error('缺少数据头');
  parseJournalHeader(text);
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line === '') continue;
    count += 1;
    if (count > JOURNAL_MAX_ROWS) throw new Error('数据条目过多');
    const envelope = JSON.parse(line) as Record<string, unknown>;
    const name = envelope['table'];
    if (typeof name !== 'string') throw new Error('包含未知数据表');
    if (!BACKUP_ARCHIVE_TABLES.includes(name)) throw new Error('包含未知数据表');
    if (table === null || name === table) {
      const rawRow = envelope['row'];
      if (rawRow === null || typeof rawRow !== 'object') throw new Error('无效的备份行');
      action(name, rawRow as ArchiveRow, envelope);
    }
  }
}

/**
 * Kotlin L62-66 `fun snapshot(db, destination)`：把每张 journal 表逐行写成
 * `{"table": …, "row": {…}}`（NDJSON），顺序 = `journalTables` 的顺序。
 */
export async function snapshotRows(db: SqliteExecutor): Promise<string> {
  const out: string[] = [];
  for (const table of JOURNAL_TABLES) {
    const rows = await db.query<Record<string, SqlValue>>(`SELECT * FROM \`${table}\``);
    for (const row of rows) {
      out.push(JSON.stringify({ table, row: archiveRow(row) }));
    }
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

/**
 * Kotlin L67-72 `fun restoreSnapshot(db, source)`：
 * 先按 `journalTables.asReversed()` 逐表 `DELETE`（反序是为了先清子表引用），
 * 再把快照行插回去（`insert` 不 replace —— 表已清空）。
 */
export async function restoreSnapshotRows(db: SqliteExecutor, text: string): Promise<void> {
  for (const table of [...JOURNAL_TABLES].reverse()) {
    await db.execute(`DELETE FROM \`${table}\``);
  }
  const lines = boundedLinesOf(text);
  for (const line of lines) {
    if (line === '') continue;
    const item = JSON.parse(line) as Record<string, unknown>;
    const table = item['table'];
    const row = item['row'];
    if (typeof table !== 'string' || row === null || typeof row !== 'object') {
      throw new Error('无效的备份行');
    }
    await insertRow(db, table, row as Record<string, unknown>);
  }
}

/** Kotlin `object ArchiveRows` 的调用形状。 */
export const ArchiveRows = {
  tables: BACKUP_ARCHIVE_TABLES,
  journalTables: JOURNAL_TABLES,
  row: archiveRow,
  all: allRows,
  insert: insertRow,
  boundedLineAt,
  boundedLinesOf,
  forEach: forEachRow,
  snapshot: snapshotRows,
  restoreSnapshot: restoreSnapshotRows,
} as const;

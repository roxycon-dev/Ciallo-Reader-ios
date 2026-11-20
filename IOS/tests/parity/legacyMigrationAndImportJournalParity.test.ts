/**
 * legacyMigrationAndImportJournalParity.test.ts
 *   ├ `data/LegacyDatabaseMigration.kt`（80 行）→ `@core/db/legacyDatabaseMigration`
 *   └ `transfer/ImportJournal.kt`（80 行）→ `@core/transfer/importJournalLayout`
 *
 * 两个文件都有实现，缺的都是**读原文的测试**：`tests/unit/roomMigrations.test.ts`
 * 从头到尾不读 Kotlin（`androidReference` / `readFileSync` 零命中），
 * `importJournal` 那边更是只测了影子表那套设计，没测原文的文件层语义。
 *
 * 本轮要钉的：
 *   · `LegacyDatabaseMigration` 的 14 张表 / 12 个索引**逐字**、`defaultColumnExpression`
 *     的六支优先级、`legacy_v${from}_$table` 命名、`DROP INDEX` 的反引号转义、
 *     `joinToString()` 默认的 `", "`、`createdTime` 才加 `ORDER BY … DESC`；
 *   · `ImportJournal` 的目录名 / 四个标记文件 / 四条中文文案 / `{stage, keep}` 两字段 /
 *     **先看 `committed` 再决定回滚还是收尾** / `received_[a-f0-9-]+` 白名单（安全边界）/
 *     `hasUndo` 的判据是「那个文件」而不是「那个目录」。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LEGACY_MIGRATION_INDEXES,
  LEGACY_MIGRATION_TABLES,
  LEGACY_MIGRATION_TARGET_VERSION,
  createLegacyDatabaseMigration,
  createLegacyDatabaseMigrations,
  defaultColumnExpression,
  tableNameOfCreateSql,
  type LegacyMigrationDb,
  type LegacyTableInfoRow,
} from '@core/db/legacyDatabaseMigration';
import {
  ACTIVATE_UNDO_PAYLOAD,
  COMMITTED_FILE,
  DATABASE_ROWS_FILE,
  GOD_SETTINGS_KEY,
  IMPORT_JOURNAL_DIRECTORY,
  IMPORT_UNDO_DIRECTORY,
  JOURNAL_SOURCE_DIRECTORIES,
  KEEP_UNDO_FAILED_MESSAGE,
  NO_UNDO_SNAPSHOT_MESSAGE,
  PENDING_FILE,
  PENDING_RECOVERY_MESSAGE,
  PORTABLE_SETTINGS_STORES,
  SETTINGS_FILE,
  STALE_SNAPSHOT_MESSAGE,
  activateUndoProblem,
  finalizeJournalPlan,
  hasUndoSnapshot,
  isReceivedStageName,
  journalPendingPayload,
  journalPrepareProblem,
  journalRecoveryPlan,
} from '@core/transfer/importJournalLayout';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const MIGRATION_KT = 'data/LegacyDatabaseMigration.kt';
const JOURNAL_KT = 'transfer/ImportJournal.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① LegacyDatabaseMigration.kt L9 版本区间
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LegacyDatabaseMigration.kt L9 `Migration(from, 12)`', () => {
  const src = kt(MIGRATION_KT);

  it('终版恒为 12，起始版是构造参数', () => {
    expect(src).toContain('internal class LegacyDatabaseMigration(from: Int) : Migration(from, 12) {');
    expect(LEGACY_MIGRATION_TARGET_VERSION).toBe(12);
    for (const from of [1, 2, 3, 4, 7]) {
      const migration = createLegacyDatabaseMigration(from);
      expect(migration.fromVersion).toBe(from);
      expect(migration.toVersion).toBe(12);
    }
  });

  it('注册表就是 `LegacyDatabaseMigration(1..4)`（`AppDatabase.getDatabase` 的四个条目）', () => {
    const migrations = createLegacyDatabaseMigrations();
    expect(migrations.map((m) => m.fromVersion)).toEqual([1, 2, 3, 4]);
    expect(migrations.every((m) => m.toVersion === 12)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② LegacyDatabaseMigration.kt L48-78 两张常量表逐字
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LegacyDatabaseMigration.kt L48-78 TABLES / INDEXES 逐字', () => {
  const src = kt(MIGRATION_KT);

  it('14 张 CREATE TABLE 语句与原文**每个字节**一致（含反引号与空格）', () => {
    // 原文用 `"…"` 双引号字符串，逐条抽出后与 TS 侧 compare
    const kotlinTables = [...src.matchAll(/^ {12}"(CREATE TABLE IF NOT EXISTS [^"]+)"(?:,)?$/gm)].map((m) => m[1]);
    expect(kotlinTables).toHaveLength(14);
    expect(LEGACY_MIGRATION_TABLES).toEqual(kotlinTables);
    // 顺序也要一致（迁移按顺序跑，books 必须最先）
    expect(LEGACY_MIGRATION_TABLES[0]).toContain('`books`');
    expect(LEGACY_MIGRATION_TABLES[13]).toContain('`god_moments`');
  });

  it('12 个 CREATE INDEX 语句逐字（其中 3 个 UNIQUE）', () => {
    const kotlinIndexes = [...src.matchAll(/^ {12}"(CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^"]+)"(?:,)?$/gm)].map(
      (m) => m[1],
    );
    expect(kotlinIndexes).toHaveLength(12);
    expect(LEGACY_MIGRATION_INDEXES).toEqual(kotlinIndexes);
    expect(LEGACY_MIGRATION_INDEXES.filter((sql) => sql.includes('CREATE UNIQUE INDEX'))).toHaveLength(3);
  });

  it('`defaultColumnExpression` 的四个业务默认值逐字在原文里', () => {
    expect(src).toContain("name == \"category\" -> \"'默认'\"");
    expect(src).toContain("name == \"contentType\" -> \"'NOVEL'\"");
    expect(src).toContain("name == \"author\" -> \"'未知作者'\"");
    expect(src).toContain("name == \"colorHex\" -> \"'#7FD8C8'\"");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ LegacyDatabaseMigration.kt L29-39 defaultColumnExpression 的六支优先级
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LegacyDatabaseMigration.kt L30-39 `when` 的优先级', () => {
  const src = kt(MIGRATION_KT);
  const old = new Set<string>();

  it('L31 `name in oldCols -> "`$name`"` 优先于一切（哪怕它是 NOT NULL 的 category）', () => {
    expect(src).toContain('name in oldCols -> "`$name`"');
    expect(defaultColumnExpression('category', 1, 'TEXT', new Set(['category']))).toBe('`category`');
    expect(defaultColumnExpression('author', 1, 'TEXT', new Set(['author']))).toBe('`author`');
  });

  it('L32 `c.getInt(3) == 0 -> "NULL"` —— PRAGMA 的 notnull 为 0 表示**可空**', () => {
    expect(src).toContain('c.getInt(3) == 0 -> "NULL"');
    expect(defaultColumnExpression('coverUri', 0, 'TEXT', old)).toBe('NULL');
    // 可空优先于四个业务默认值：可空的 category 也给 NULL（原文顺序如此）
    expect(defaultColumnExpression('category', 0, 'TEXT', old)).toBe('NULL');
  });

  it('L33-36 四个业务默认值', () => {
    expect(src).toContain('name == "category" -> "\'默认\'"');
    expect(defaultColumnExpression('category', 1, 'TEXT', old)).toBe("'默认'");
    expect(defaultColumnExpression('contentType', 1, 'TEXT', old)).toBe("'NOVEL'");
    expect(defaultColumnExpression('author', 1, 'TEXT', old)).toBe("'未知作者'");
    expect(defaultColumnExpression('colorHex', 1, 'TEXT', old)).toBe("'#7FD8C8'");
  });

  it('L37 `type == "TEXT" -> "\'\'"` —— 其余 TEXT 列给空串', () => {
    expect(src).toContain('c.getString(2) == "TEXT" -> "\'\'"');
    expect(defaultColumnExpression('title', 1, 'TEXT', old)).toBe("''");
    // 类型名不等价于「含 TEXT」：`VARCHAR` 不算，Kotlin 用的是精确 `==`
    expect(defaultColumnExpression('title', 1, 'VARCHAR(64)', old)).toBe('0');
  });

  it('L38 `else -> "0"` —— 整数/实数/BLOB 一律 0', () => {
    expect(src).toContain('else -> "0"');
    expect(defaultColumnExpression('bookId', 1, 'INTEGER', old)).toBe('0');
    expect(defaultColumnExpression('rating', 1, 'REAL', old)).toBe('0');
    expect(defaultColumnExpression('payload', 1, 'BLOB', old)).toBe('0');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ LegacyDatabaseMigration.kt L11-46 migrate 的 SQL 序列
   ══════════════════════════════════════════════════════════════════════════════ */

interface Recording {
  readonly db: LegacyMigrationDb;
  readonly statements: string[];
  readonly queries: string[];
}

function recording(
  tableInfo: Readonly<Record<string, LegacyTableInfoRow[]>> = {},
  existingTables: readonly string[] = [],
  existingIndexes: Readonly<Record<string, string[]>> = {},
): Recording {
  const statements: string[] = [];
  const queries: string[] = [];
  const db: LegacyMigrationDb = {
    async execute(sql: string) {
      statements.push(sql);
      return undefined;
    },
    async query<T>(sql: string, params?: Array<string | number | null>): Promise<T[]> {
      queries.push(sql);
      const first = params?.[0];
      if (sql.includes("type='table'")) {
        return (existingTables.includes(String(first)) ? [{ name: first }] : []) as unknown as T[];
      }
      if (sql.includes("type='index'")) {
        const names = existingIndexes[String(first)] ?? [];
        return names.map((name) => ({ name })) as unknown as T[];
      }
      if (sql.startsWith('PRAGMA table_info(')) {
        // 允许两种写法：直接给 `legacy_v{n}_<table>`（旧表列集合）或只给 `<table>`
        // （新表 DDL 与旧表同构）。先精确匹配，再剥前缀兜底。
        const raw = sql.slice(sql.indexOf('`') + 1, sql.lastIndexOf('`'));
        return (tableInfo[raw] ?? tableInfo[raw.replace(/^legacy_v\d+_/, '')] ?? []) as unknown as T[];
      }
      return [] as T[];
    },
  };
  return { db, statements, queries };
}

const info = (name: string, type: string, notnull: number): LegacyTableInfoRow => ({
  cid: 0,
  name,
  type,
  notnull,
});

describe('LegacyDatabaseMigration.kt L11-46 migrate 的 SQL 序列', () => {
  const src = kt(MIGRATION_KT);

  it('L12-14 表不存在 → 只 `execSQL(sql)` 然后 continue（不 rename、不插数据）', async () => {
    expect(src).toContain('if (!exists) { db.execSQL(sql); continue }');
    const r = recording();
    await createLegacyDatabaseMigration(1).migrate(r.db);
    // 14 张表都不存在 → 只有 14 条 CREATE TABLE，没有 ALTER / INSERT / DROP INDEX
    expect(r.statements).toHaveLength(14 + 12); // 14 建表 + 末尾统一 12 个索引
    expect(r.statements.slice(0, 14)).toEqual([...LEGACY_MIGRATION_TABLES]);
    expect(r.statements.some((sql) => sql.startsWith('ALTER TABLE'))).toBe(false);
    expect(r.statements.some((sql) => sql.startsWith('INSERT OR IGNORE'))).toBe(false);
  });

  it('L15 旧表名是 `legacy_v${startVersion}_$table`（from 参与命名）', async () => {
    expect(src).toContain('val old = "legacy_v${startVersion}_$table"');
    const r = recording({ books: [info('id', 'INTEGER', 1)] }, ['books']);
    await createLegacyDatabaseMigration(3).migrate(r.db);
    expect(r.statements).toContain('ALTER TABLE `books` RENAME TO `legacy_v3_books`');
    const r2 = recording({ books: [info('id', 'INTEGER', 1)] }, ['books']);
    await createLegacyDatabaseMigration(4).migrate(r2.db);
    expect(r2.statements).toContain('ALTER TABLE `books` RENAME TO `legacy_v4_books`');
  });

  it('L16-20 `DROP INDEX` 只删「有 sql 文本」的索引，且反引号要双写', async () => {
    expect(src).toContain("db.query(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL\", arrayOf(table))");
    expect(src).toContain('names.forEach { db.execSQL("DROP INDEX `${it.replace("`", "``")}`") }');
    const r = recording({ books: [info('id', 'INTEGER', 1)] }, ['books'], {
      books: ['index_books_a', 'index_we`ird'],
    });
    await createLegacyDatabaseMigration(1).migrate(r.db);
    expect(r.statements).toContain('DROP INDEX `index_books_a`');
    // 名字里带反引号 → 双写，否则 SQL 会被截断
    expect(r.statements).toContain('DROP INDEX `index_we``ird`');
  });

  it('L42 表级索引只在「本表」重建（`it.contains("ON `$table`")`）', async () => {
    expect(src).toContain('INDEXES.filter { it.contains("ON `$table`") }.forEach { db.execSQL(it) }');
    // bookmarks 有 1 条专属索引：改名 + 建新表之后、插入数据之前要把它重建回来
    const withIndex = recording({ bookmarks: [info('id', 'INTEGER', 1)] }, ['bookmarks']);
    await createLegacyDatabaseMigration(1).migrate(withIndex.db);
    const insertAt = withIndex.statements.findIndex((sql) => sql.startsWith('INSERT OR IGNORE INTO `bookmarks`'));
    expect(insertAt).toBeGreaterThan(0);
    // 紧挨着 INSERT 之前的最后一条，就是本表索引的重建
    expect(withIndex.statements[insertAt - 1]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS `index_bookmarks_bookId_chapterIndex` ON `bookmarks` (`bookId`, `chapterIndex`)',
    );
    // books 没有任何专属索引 → INSERT 前不会多出一条索引语句
    const noIndex = recording({ books: [info('id', 'INTEGER', 1)] }, ['books']);
    await createLegacyDatabaseMigration(1).migrate(noIndex.db);
    const booksInsertAt = noIndex.statements.findIndex((sql) => sql.startsWith('INSERT OR IGNORE INTO `books`'));
    expect(noIndex.statements[booksInsertAt - 1]).toBe('CREATE TABLE IF NOT EXISTS `books` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `filePath` TEXT NOT NULL, `coverUri` TEXT, `category` TEXT NOT NULL, `currentChapterIndex` INTEGER NOT NULL, `scrollOffset` INTEGER NOT NULL, `isFinished` INTEGER NOT NULL, `totalChapters` INTEGER NOT NULL, `contentType` TEXT NOT NULL, `addedTime` INTEGER NOT NULL, `lastReadTime` INTEGER NOT NULL, `sourceId` TEXT, `comicId` TEXT)');
  });

  it('L43-44 只有旧表有 `createdTime` 才加 `ORDER BY createdTime DESC`', async () => {
    expect(src).toContain('val ordering=if("createdTime" in oldCols) " ORDER BY createdTime DESC" else ""');
    const withTime = recording(
      { bookmarks: [info('id', 'INTEGER', 1), info('createdTime', 'INTEGER', 1)] },
      ['bookmarks'],
    );
    await createLegacyDatabaseMigration(1).migrate(withTime.db);
    const bookmarksInsert = withTime.statements.find((sql) => sql.startsWith('INSERT OR IGNORE INTO `bookmarks`'));
    expect(bookmarksInsert).toContain('FROM `legacy_v1_bookmarks` ORDER BY createdTime DESC');

    const withoutTime = recording({ bookmarks: [info('id', 'INTEGER', 1)] }, ['bookmarks']);
    await createLegacyDatabaseMigration(1).migrate(withoutTime.db);
    const plain = withoutTime.statements.find((sql) => sql.startsWith('INSERT OR IGNORE INTO `bookmarks`'));
    expect(plain).toContain('FROM `legacy_v1_bookmarks`');
    expect(plain).not.toContain('ORDER BY');
  });

  it('L44 `joinToString()` 的默认分隔符是 `", "`（逗号+空格），不是 `","`', async () => {
    expect(src).toContain(
      'db.execSQL("INSERT OR IGNORE INTO `$table` (${names.joinToString()}) SELECT ${values.joinToString()} FROM `$old`$ordering")',
    );
    // books 的六列恰好覆盖 `when` 的六支：id(旧表有) / coverUri(可空) /
    // category(默认) / contentType(默认) / title(TEXT) / totalChapters(else)
    const r = recording(
      {
        books: [
          info('id', 'INTEGER', 1),
          info('title', 'TEXT', 1),
          info('coverUri', 'TEXT', 0),
          info('category', 'TEXT', 1),
          info('contentType', 'TEXT', 1),
          info('totalChapters', 'INTEGER', 1),
        ],
        legacy_v1_books: [info('id', 'INTEGER', 1)],
      },
      ['books'],
    );
    await createLegacyDatabaseMigration(1).migrate(r.db);
    const insert = r.statements.find((sql) => sql.startsWith('INSERT OR IGNORE INTO `books`'));
    expect(insert).toBe(
      'INSERT OR IGNORE INTO `books` (`id`, `title`, `coverUri`, `category`, `contentType`, `totalChapters`) ' +
        "SELECT `id`, '', NULL, '默认', 'NOVEL', 0 FROM `legacy_v1_books`",
    );
    // 分隔符是 `", "`：去掉空格后串里不该出现 `,title` 这种毗邻形态
    expect(insert).toContain('`id`, `title`');
    expect(insert).not.toContain('`id`,`title`');
  });

  it('L46 migrate 末尾把 12 个索引再全跑一遍（幂等收口）', async () => {
    expect(src).toContain('INDEXES.forEach { db.execSQL(it) }');
    const r = recording();
    await createLegacyDatabaseMigration(1).migrate(r.db);
    const tail = r.statements.slice(-12);
    expect(tail).toEqual([...LEGACY_MIGRATION_INDEXES]);
  });

  it('`tableNameOfCreateSql` = `substringAfter("`").substringBefore("`")`', () => {
    expect(src).toContain('val table = sql.substringAfter("`").substringBefore("`")');
    expect(tableNameOfCreateSql('CREATE TABLE IF NOT EXISTS `books` (`id` INTEGER)')).toBe('books');
    expect(tableNameOfCreateSql('CREATE TABLE IF NOT EXISTS `reading_sessions` (`id` INTEGER)')).toBe(
      'reading_sessions',
    );
    // 14 张表的表名与建表语句里的第一个反引号段一致
    expect(LEGACY_MIGRATION_TABLES.map(tableNameOfCreateSql)).toHaveLength(14);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ ImportJournal.kt L12-34 目录、标记文件与开跑前检查
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ImportJournal.kt L12-34 目录与标记文件', () => {
  const src = kt(JOURNAL_KT);

  it('L12 私有目录 `transfer_journal`，回退目录 `transfer_undo`', () => {
    expect(src).toContain('File(context.filesDir, "transfer_journal")');
    expect(src).toContain('File(context.filesDir, "transfer_undo")');
    expect(IMPORT_JOURNAL_DIRECTORY).toBe('transfer_journal');
    expect(IMPORT_UNDO_DIRECTORY).toBe('transfer_undo');
  });

  it('四个文件名逐字：`pending.json` / `committed` / `database.rows` / `settings.json`', () => {
    expect(src).toContain('File(dir, "pending.json")');
    expect(src).toContain('File(dir, "committed")');
    expect(src).toContain('File(dir, "database.rows")');
    expect(src).toContain('File(dir, "settings.json")');
    expect(PENDING_FILE).toBe('pending.json');
    expect(COMMITTED_FILE).toBe('committed');
    expect(DATABASE_ROWS_FILE).toBe('database.rows');
    expect(SETTINGS_FILE).toBe('settings.json');
  });

  it('L25 `PortableSettings.stores` 三个 store + L26 的 `god` 键', () => {
    expect(src).toContain('PortableSettings.stores.forEach { prefs.put(it, PortableSettings.encode(context.getSharedPreferences(it, 0).all)) }');
    expect(src).toContain('prefs.put("god", com.example.god.GodMomentSettingsStore(context).exportPortable())');
    expect(PORTABLE_SETTINGS_STORES).toEqual(['novel_reader_prefs', 'comic_reader_store', 'book_sources_config']);
    expect(GOD_SETTINGS_KEY).toBe('god');
  });

  it('L28 / L62 两个源目录 `source_configs` / `js_sources`', () => {
    expect(src).toContain('for(name in listOf("source_configs","js_sources")) {');
    expect(JOURNAL_SOURCE_DIRECTORIES).toEqual(['source_configs', 'js_sources']);
  });

  it('L34 `pending.json` 只有两个字段 `stage` / `keep`', () => {
    expect(src).toContain('JSONObject().put("stage", stageName).put("keep", keepUndo).toString()');
    expect(journalPendingPayload('received_ab-12', true)).toEqual({ stage: 'received_ab-12', keep: true });
    expect(journalPendingPayload('', false)).toEqual({ stage: '', keep: false });
  });

  it('L78 激活回退快照时写的是 `{"stage":"", "keep":false}`', () => {
    expect(src).toContain('atomic(File(dir, "pending.json"), JSONObject().put("stage", "").put("keep", false).toString())');
    expect(ACTIVATE_UNDO_PAYLOAD).toEqual({ stage: '', keep: false });
  });
});

describe('ImportJournal.kt L20-21 prepare 的两道门', () => {
  const src = kt(JOURNAL_KT);

  it('L20 `check(!File(dir, "pending.json").exists())` → 「上一次导入需要先恢复」', () => {
    expect(src).toContain('check(!File(dir, "pending.json").exists()) { com.example.i18n.tr("上一次导入需要先恢复") }');
    expect(PENDING_RECOVERY_MESSAGE).toBe('上一次导入需要先恢复');
    expect(journalPrepareProblem({ pendingExists: true, directoryExists: true, deleteSucceeded: true })).toBe(
      PENDING_RECOVERY_MESSAGE,
    );
    // pending 优先于「删不掉」——顺序即语义
    expect(journalPrepareProblem({ pendingExists: true, directoryExists: true, deleteSucceeded: false })).toBe(
      PENDING_RECOVERY_MESSAGE,
    );
  });

  it('L21 `if(dir.exists()) check(dir.deleteRecursively())` → 「无法清理…」', () => {
    expect(src).toContain('if(dir.exists())check(dir.deleteRecursively()) { com.example.i18n.tr("无法清理上次未开始提交的临时快照") }');
    expect(STALE_SNAPSHOT_MESSAGE).toBe('无法清理上次未开始提交的临时快照');
    expect(journalPrepareProblem({ pendingExists: false, directoryExists: true, deleteSucceeded: false })).toBe(
      STALE_SNAPSHOT_MESSAGE,
    );
    // 目录不存在时不需要删成功
    expect(journalPrepareProblem({ pendingExists: false, directoryExists: false, deleteSucceeded: false })).toBeNull();
    expect(journalPrepareProblem({ pendingExists: false, directoryExists: true, deleteSucceeded: true })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ ImportJournal.kt L36-51 finish / finalizeCommitted
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ImportJournal.kt L36-51 提交与收尾', () => {
  const src = kt(JOURNAL_KT);

  it('L40 先写 `committed` 再收尾（崩溃在轮换中途也能判出「已提交」）', () => {
    expect(src).toContain('// A committed marker makes a crash during snapshot rotation safe.');
    expect(src).toContain('atomic(File(dir, "committed"), "1")');
    expect(src).toContain('finalizeCommitted(context, pending)');
    const markerAt = src.indexOf('atomic(File(dir, "committed"), "1")');
    const finalizeAt = src.indexOf('finalizeCommitted(context, pending)', markerAt);
    expect(markerAt).toBeGreaterThan(0);
    expect(finalizeAt).toBeGreaterThan(markerAt);
  });

  it('L45-50 `keep` 为真：把整个目录改名成 `transfer_undo` 并删两个标记', () => {
    expect(src).toContain('if(pending.optBoolean("keep")) {');
    expect(src).toContain('check(dir.renameTo(undo)) { com.example.i18n.tr("无法保留迁移回退快照") }');
    expect(src).toContain('File(undo, "pending.json").delete(); File(undo, "committed").delete()');
    expect(KEEP_UNDO_FAILED_MESSAGE).toBe('无法保留迁移回退快照');
    expect(finalizeJournalPlan(true)).toEqual({
      mode: 'keep',
      renameTo: 'transfer_undo',
      deleteMarkers: ['pending.json', 'committed'],
    });
  });

  it('L50 `else dir.deleteRecursively()` —— 不留快照就整目录删掉', () => {
    expect(src).toContain('} else dir.deleteRecursively()');
    expect(finalizeJournalPlan(false)).toEqual({ mode: 'discard' });
  });

  it('L47 `undo.deleteRecursively()` 在改名之前（旧快照先清）', () => {
    const clearAt = src.indexOf('val undo = File(context.filesDir, "transfer_undo")');
    const renameAt = src.indexOf('check(dir.renameTo(undo))');
    expect(clearAt).toBeGreaterThan(0);
    expect(renameAt).toBeGreaterThan(clearAt);
    expect(src.indexOf('undo.deleteRecursively()')).toBeLessThan(renameAt);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ ImportJournal.kt L52-71 recover —— 先看 committed
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ImportJournal.kt L52-71 recover 的三条去向', () => {
  const src = kt(JOURNAL_KT);

  it('L54 没有 `pending.json` → 什么都不做', () => {
    expect(src).toContain('if(!marker.exists()) return');
    expect(journalRecoveryPlan({ pendingExists: false, committedExists: false })).toBe('none');
    // 只有 committed 而没有 pending 也不做事（快照轮换已完成）
    expect(journalRecoveryPlan({ pendingExists: false, committedExists: true })).toBe('none');
  });

  it('L56 **先看 `committed`**：有它 → 收尾，不回滚', () => {
    expect(src).toContain('if(File(dir, "committed").exists()) { finalizeCommitted(context, pending); return }');
    expect(journalRecoveryPlan({ pendingExists: true, committedExists: true })).toBe('finalize');
  });

  it('只有 pending 才回滚（事务内恢复 DB + 设置 + 两个源目录）', () => {
    expect(journalRecoveryPlan({ pendingExists: true, committedExists: false })).toBe('restore');
    expect(src).toContain('ArchiveRows.restoreSnapshot(db, File(dir, "database.rows"))');
    expect(src).toContain('PortableSettings.stores.forEach { PortableSettings.write(context.getSharedPreferences(it, 0), settings.getJSONObject(it), true) }');
    expect(src).toContain('com.example.god.GodMomentSettingsStore(context).importPortable(settings.getJSONObject("god"))');
  });

  it('L57-67 整段恢复在**一个事务**里，`finally` 收尾', () => {
    expect(src).toContain('db.beginTransaction()');
    expect(src).toContain('db.setTransactionSuccessful()');
    expect(src).toContain('} finally { db.endTransaction() }');
    const beginAt = src.indexOf('db.beginTransaction()');
    const successfulAt = src.indexOf('db.setTransactionSuccessful()');
    const endAt = src.indexOf('} finally { db.endTransaction() }');
    expect(beginAt).toBeLessThan(successfulAt);
    expect(successfulAt).toBeLessThan(endAt);
  });

  it('L69 `received_[a-f0-9-]+` 白名单 —— 只删自己拉下来的暂存目录', () => {
    expect(src).toContain('if(stageName.matches(Regex("received_[a-f0-9-]+"))) File(context.filesDir, stageName).deleteRecursively()');
    expect(isReceivedStageName('received_ab12')).toBe(true);
    expect(isReceivedStageName('received_ab-12-cd')).toBe(true);
    // `.` 不在字符集里 → `..` 被拒（否则 deleteRecursively 会往上爬）
    expect(isReceivedStageName('..')).toBe(false);
    expect(isReceivedStageName('received_..')).toBe(false);
    expect(isReceivedStageName('received_/etc')).toBe(false);
    // 大写十六进制不被接受（Kotlin 的 `[a-f0-9]` 是小写）
    expect(isReceivedStageName('received_AB12')).toBe(false);
    // 前缀必须完整
    expect(isReceivedStageName('received_')).toBe(false);
    expect(isReceivedStageName('received')).toBe(false);
    expect(isReceivedStageName('library')).toBe(false);
    // 空串（`activateUndo` 写的那种）也不命中
    expect(isReceivedStageName('')).toBe(false);
  });

  it('L70 恢复完成后整目录删掉', () => {
    const tail = src.slice(src.indexOf('if(stageName.matches('));
    expect(tail).toContain('dir.deleteRecursively()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑧ ImportJournal.kt L72-79 hasUndo / activateUndo
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ImportJournal.kt L72-79 回退快照的判定与激活', () => {
  const src = kt(JOURNAL_KT);

  it('L72 `hasUndo` 的判据是 `transfer_undo/database.rows` **是文件**', () => {
    expect(src).toContain('File(context.filesDir, "transfer_undo/database.rows").isFile');
    expect(hasUndoSnapshot({ undoDatabaseRowsIsFile: true })).toBe(true);
    // 目录存在但快照文件缺失（rename 成功、快照写失败）不算「有可用的」
    expect(hasUndoSnapshot({ undoDatabaseRowsIsFile: false })).toBe(false);
  });

  it('L75 「没有可用的回退快照」', () => {
    expect(src).toContain('check(hasUndo(context)) { com.example.i18n.tr("没有可用的回退快照") }');
    expect(NO_UNDO_SNAPSHOT_MESSAGE).toBe('没有可用的回退快照');
    expect(activateUndoProblem({ hasUndo: false, pendingExists: false })).toBe(NO_UNDO_SNAPSHOT_MESSAGE);
    // 「没有快照」优先于「有待恢复的导入」
    expect(activateUndoProblem({ hasUndo: false, pendingExists: true })).toBe(NO_UNDO_SNAPSHOT_MESSAGE);
  });

  it('L76 `check(!File(dir,"pending.json").exists())` 无自定义文案 → `Check failed.`', () => {
    expect(src).toContain('val dir = directory(context); check(!File(dir,"pending.json").exists())');
    expect(activateUndoProblem({ hasUndo: true, pendingExists: true })).toBe('Check failed.');
    expect(activateUndoProblem({ hasUndo: true, pendingExists: false })).toBeNull();
  });

  it('L77-78 先把 `transfer_undo` 改名回 `transfer_journal`，再写 `{stage:"", keep:false}`', () => {
    expect(src).toContain('check(undo.renameTo(dir))');
    expect(src).toContain('atomic(File(dir, "pending.json"), JSONObject().put("stage", "").put("keep", false).toString())');
    const renameAt = src.indexOf('check(undo.renameTo(dir))');
    const writeAt = src.indexOf('atomic(File(dir, "pending.json"), JSONObject().put("stage", "").put("keep", false).toString())');
    expect(renameAt).toBeGreaterThan(0);
    expect(writeAt).toBeGreaterThan(renameAt);
  });

  it('端口把文件层决策放在独立模块（投影与原文一一对应）', () => {
    const layout = repoText('src/core/transfer/importJournalLayout.ts');
    expect(layout).toContain('export function journalPrepareProblem(');
    expect(layout).toContain('export function finalizeJournalPlan(');
    expect(layout).toContain('export function journalRecoveryPlan(');
    expect(layout).toContain('export function activateUndoProblem(');
    expect(layout).toContain('export function isReceivedStageName(');
  });});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑨ 与现有影子表设计的边界（两者不是同一套，不能互相顶替）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('两套设计的边界', () => {
  it('`@core/transfer/importJournal` 是影子表 + 回执标记，本模块是文件 + pending/committed', () => {
    const shadow = repoText('src/core/transfer/importJournal.ts');
    const layout = repoText('src/core/transfer/importJournalLayout.ts');
    expect(shadow).toContain('_ciallo_undo_');
    expect(shadow).toContain('transfer_receipts');
    expect(shadow).not.toContain('pending.json');
    expect(layout).toContain("'pending.json'");
    expect(layout).not.toContain('_ciallo_undo_');
  });

  it('`ImportJournal.kt` 的中文文案一条都不在影子表那套里（它们是文件层的）', () => {
    const shadow = repoText('src/core/transfer/importJournal.ts');
    for (const message of [
      PENDING_RECOVERY_MESSAGE,
      STALE_SNAPSHOT_MESSAGE,
      KEEP_UNDO_FAILED_MESSAGE,
      NO_UNDO_SNAPSHOT_MESSAGE,
    ]) {
      expect(shadow).not.toContain(message);
    }
  });
});

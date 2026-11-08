/**
 * Legacy DB recovery migration — port of Android
 * `novel-reader/app/src/main/java/com/example/data/LegacyDatabaseMigration.kt`
 * (78 lines total, 63 non-blank).
 *
 * Kotlin source of truth: `internal class LegacyDatabaseMigration(from: Int) : Migration(from, 12)`
 * registered in `AppDatabase.getDatabase(...)` for `from = 1, 2, 3, 4`. It rebuilds every
 * v12 table in place, preserving rows (and any columns the legacy copy happens to still
 * carry) instead of falling back to a destructive delete-and-recreate.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.data` → module header.
 *   2        (blank)
 *   3..4     `import androidx.room.migration.Migration` / `SupportSQLiteDatabase`
 *            → `LegacyMigrationDb` (the injected cursor surface below).
 *   5        (blank)
 *   6        KDoc 「Recover early schemas without destructive fallback. Unknown columns
 *            remain in legacy copies.」 → kept verbatim as the interface doc on
 *            {@link LegacyDatabaseMigration}. (The Kotlin KDoc delimiter itself is not
 *            reproduced here because it would terminate this block comment.)
 *   7        `internal class LegacyDatabaseMigration(from: Int) : Migration(from, 12)`
 *            → `createLegacyDatabaseMigration(from)` returning a
 *            `LegacyDatabaseMigration` object with `fromVersion` / `toVersion = 12`
 *            and `migrate(db)`.
 *   8        `override fun migrate(db: SupportSQLiteDatabase) {` → `async migrate(db)`.
 *   9        `for (sql in TABLES) {` → `for (const sql of LEGACY_MIGRATION_TABLES)`.
 *   10       `val table = sql.substringAfter("`").substringBefore("`")`
 *            → `tableNameOfCreateSql(sql)` (identical semantics: text between the first
 *            and second backtick of the CREATE TABLE statement).
 *   11       `val exists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", …)`
 *            → identical SQL, one-shot boolean.
 *   12       `if (!exists) { db.execSQL(sql); continue }` → identical.
 *   13       `val old = "legacy_v${startVersion}_$table"` → identical.
 *   14..18   drop every user index on the table
 *            (`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`,
 *             then `DROP INDEX \`${it.replace("`","``")}\``) → identical, including the
 *             double-backtick escaping and the `sql IS NOT NULL` filter that keeps
 *             auto-indexes.
 *   19       `ALTER TABLE \`$table\` RENAME TO \`$old\`` → identical.
 *   20       `db.execSQL(sql)` (fresh v12 table) → identical.
 *   21       `oldCols = PRAGMA table_info(\`$old\`) … buildSet { add(c.getString(1)) }`
 *            → `PRAGMA table_info` column index 1 is `name`; identical.
 *   22       (blank)
 *   23       `val names = mutableListOf<String>()` → target column list accumulator.
 *   24       `val values = mutableListOf<String>()` → source expression accumulator.
 *   25..27   `db.query("PRAGMA table_info(\`$table\`)") { c -> … }` loop → identical.
 *   28       `names.add("\`$name\`")` → identical.
 *   29..37   the per-column `when` (old column present → copy; nullable → NULL;
 *            category → '默认'; contentType → 'NOVEL'; author → '未知作者';
 *            colorHex → '#7FD8C8'; TEXT → ''; else → 0)
 *            → `defaultExpressionFor(...)`, byte-identical precedence order and the
 *            same five Chinese/literal defaults.
 *   38..39   loop close → end of the column loop.
 *   40       `INDEXES.filter { it.contains("ON \`$table\`") }.forEach { db.execSQL(it) }`
 *            → identical.
 *   41       `val ordering = if ("createdTime" in oldCols) " ORDER BY createdTime DESC" else ""`
 *            → identical.
 *   42       `INSERT OR IGNORE INTO \`$table\` (…) SELECT … FROM \`$old\`$ordering` → identical.
 *   43       `}` → end of the per-table loop.
 *   44       `INDEXES.forEach { db.execSQL(it) }` → identical.
 *   45..46   `}` `}` → end of `migrate`.
 *   47       `companion object {` → module-level const arrays.
 *   48..62   `private val TABLES = listOf(…14 CREATE TABLE IF NOT EXISTS statements…)`
 *            → `LEGACY_MIGRATION_TABLES`, all 14 statements copied byte-for-byte.
 *   63       `private val INDEXES = listOf(` → `LEGACY_MIGRATION_INDEXES`.
 *   64..76   the 12 `CREATE … INDEX IF NOT EXISTS` statements → copied byte-for-byte.
 *   77..78   `}` `}` → end of companion / end of class.
 *
 * Skipped lines and why:
 *   - Kotlin line 7 `: Migration(from, 12)`: androidx `Migration` is an Android artifact.
 *     `fromVersion` / `toVersion` are preserved as plain fields so a Room-equivalent
 *     migration registry can consume them unchanged.
 *   - Kotlin lines 11/14/21/24 cursor iteration (`cursor.use { it.moveToFirst() }`,
 *     `while (c.moveToNext())`): `db.query` returns a materialised array on the TS side;
 *     `[0]` replaces `moveToFirst()` and `.map(...)` replaces the `while` loop.
 *   - Kotlin line 12/19/20/40/42/44 `execSQL` → `db.execute`.
 *
 * Cross-check against the authoritative Room v12 facts (already verified, not re-derived):
 * the 14 `CREATE TABLE` statements here correspond 1:1 to the 14 tables in
 * `schemaV12.ts` (`TABLES.length === 14`) and the 12 index statements here correspond to
 * the 12 index declarations in `TABLES`. The two omitted tables relative to a 15-table
 * misconception are `anilist_titles`/`favorite_categories` — both ARE present above.
 */

/** `PRAGMA table_info` row; only the columns the Kotlin code reads are modelled. */
export interface LegacyTableInfoRow {
  /** cid (column 0) — present for shape parity, unused by the algorithm. */
  cid: number;
  /** name (column 1). */
  name: string;
  /** type (column 2), e.g. `TEXT`. */
  type: string;
  /** notnull (column 3). */
  notnull: number;
}

/** Minimal database surface the migration needs (a subset of `DatabaseLike`). */
export interface LegacyMigrationDb {
  execute(sql: string, params?: Array<string | number | null>): Promise<unknown>;
  query<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
}

/** Recover early schemas without destructive fallback. Unknown columns remain in legacy copies. */
export interface LegacyDatabaseMigration {
  /** Kotlin `LegacyDatabaseMigration(from)` constructor argument (`Migration.startVersion`). */
  readonly fromVersion: number;
  /** Kotlin `Migration(from, 12)` end version. */
  readonly toVersion: number;
  migrate(db: LegacyMigrationDb): Promise<void>;
}

export const LEGACY_MIGRATION_TARGET_VERSION = 12;

/**
 * Kotlin `private val TABLES = listOf(...)` — 14 statements, verbatim.
 * These are the v12 physical DDL; `schemaV12.ts` `TABLES` is the derived description of
 * the same 14 tables (identityHash 4edcea8e99eeed709b4f4497a5cc18a0).
 */
export const LEGACY_MIGRATION_TABLES: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS `books` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `filePath` TEXT NOT NULL, `coverUri` TEXT, `category` TEXT NOT NULL, `currentChapterIndex` INTEGER NOT NULL, `scrollOffset` INTEGER NOT NULL, `isFinished` INTEGER NOT NULL, `totalChapters` INTEGER NOT NULL, `contentType` TEXT NOT NULL, `addedTime` INTEGER NOT NULL, `lastReadTime` INTEGER NOT NULL, `sourceId` TEXT, `comicId` TEXT)',
  'CREATE TABLE IF NOT EXISTS `chapters` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterOrder` INTEGER NOT NULL, `title` TEXT NOT NULL, `content` TEXT NOT NULL, `startCharIndex` INTEGER NOT NULL, `endCharIndex` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `bookmarks` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `scrollOffset` INTEGER NOT NULL, `title` TEXT NOT NULL, `snippet` TEXT NOT NULL, `createdTime` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `highlights` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `selectedText` TEXT NOT NULL, `note` TEXT NOT NULL, `colorHex` TEXT NOT NULL, `createdTime` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `categories` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `isProtected` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `reading_records` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER, `bookTitle` TEXT NOT NULL, `dateStr` TEXT NOT NULL, `durationSeconds` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `reading_sessions` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER, `bookTitle` TEXT NOT NULL, `dateStr` TEXT NOT NULL, `startTimeMs` INTEGER NOT NULL, `endTimeMs` INTEGER NOT NULL, `durationSeconds` INTEGER NOT NULL, `startHour` INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `download_tasks` (`id` TEXT NOT NULL, `sourceId` TEXT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `coverUrl` TEXT, `downloadUrl` TEXT NOT NULL, `format` TEXT NOT NULL, `status` TEXT NOT NULL, `downloadedBytes` INTEGER NOT NULL, `totalBytes` INTEGER NOT NULL, `filePath` TEXT NOT NULL, `errorMessage` TEXT, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))',
  'CREATE TABLE IF NOT EXISTS `anilist_titles` (`rowId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `mediaId` INTEGER NOT NULL, `titleType` TEXT NOT NULL, `rawTitle` TEXT NOT NULL, `normalizedTitle` TEXT NOT NULL, `compactTitle` TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS `favorites` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `coverUrl` TEXT, `localThumbPath` TEXT, `serialStatus` TEXT NOT NULL, `latestChapterId` TEXT, `latestChapterTitle` TEXT, `latestChapterUpdateAt` INTEGER NOT NULL, `lastCheckedAt` INTEGER NOT NULL, `sourceAlive` INTEGER NOT NULL, `categoryName` TEXT NOT NULL, `favoritedAt` INTEGER NOT NULL, `sortOrder` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`))',
  'CREATE TABLE IF NOT EXISTS `comic_progress` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `lastChapterId` TEXT, `lastChapterIndex` INTEGER NOT NULL, `lastPageIndex` INTEGER NOT NULL, `lastPageCount` INTEGER NOT NULL, `lastReadAt` INTEGER NOT NULL, `seenTopChapterId` TEXT, `seenChapterCount` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`))',
  'CREATE TABLE IF NOT EXISTS `comic_chapter_read` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `chapterId` TEXT NOT NULL, `status` INTEGER NOT NULL, `pageIndex` INTEGER NOT NULL, `pageCount` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, `bookmarked` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`, `chapterId`))',
  'CREATE TABLE IF NOT EXISTS `favorite_categories` (`name` TEXT NOT NULL, `sortOrder` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, PRIMARY KEY(`name`))',
  'CREATE TABLE IF NOT EXISTS `god_moments` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `contentType` TEXT NOT NULL, `bookId` TEXT NOT NULL, `chapterId` TEXT NOT NULL, `bookTitle` TEXT NOT NULL, `chapterTitle` TEXT NOT NULL, `chapterNumber` INTEGER NOT NULL, `title` TEXT NOT NULL, `titleIsCustom` INTEGER NOT NULL, `rating` REAL NOT NULL, `note` TEXT NOT NULL, `coverPath` TEXT, `coverSource` TEXT NOT NULL, `cropParams` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL)',
];

/** Kotlin `private val INDEXES = listOf(...)` — 12 statements, verbatim. */
export const LEGACY_MIGRATION_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS `index_bookmarks_bookId_chapterIndex` ON `bookmarks` (`bookId`, `chapterIndex`)',
  'CREATE INDEX IF NOT EXISTS `index_anilist_titles_normalizedTitle` ON `anilist_titles` (`normalizedTitle`)',
  'CREATE INDEX IF NOT EXISTS `index_anilist_titles_compactTitle` ON `anilist_titles` (`compactTitle`)',
  'CREATE UNIQUE INDEX IF NOT EXISTS `index_anilist_titles_mediaId_titleType_rawTitle` ON `anilist_titles` (`mediaId`, `titleType`, `rawTitle`)',
  'CREATE INDEX IF NOT EXISTS `index_favorites_categoryName` ON `favorites` (`categoryName`)',
  'CREATE INDEX IF NOT EXISTS `index_favorites_favoritedAt` ON `favorites` (`favoritedAt`)',
  'CREATE INDEX IF NOT EXISTS `index_favorites_lastCheckedAt` ON `favorites` (`lastCheckedAt`)',
  'CREATE INDEX IF NOT EXISTS `index_comic_progress_lastReadAt` ON `comic_progress` (`lastReadAt`)',
  'CREATE INDEX IF NOT EXISTS `index_comic_chapter_read_sourceId_comicId` ON `comic_chapter_read` (`sourceId`, `comicId`)',
  'CREATE UNIQUE INDEX IF NOT EXISTS `index_god_moments_bookId_chapterId` ON `god_moments` (`bookId`, `chapterId`)',
  'CREATE INDEX IF NOT EXISTS `index_god_moments_rating` ON `god_moments` (`rating`)',
  'CREATE INDEX IF NOT EXISTS `index_god_moments_createdAt` ON `god_moments` (`createdAt`)',
];

/** Kotlin `val table = sql.substringAfter("`").substringBefore("`")`. */
export function tableNameOfCreateSql(sql: string): string {
  const after = sql.slice(sql.indexOf('`') + 1);
  return after.slice(0, after.indexOf('`'));
}

/**
 * Kotlin lines 29..37 — the per-column fallback expression `when`.
 * Precedence is load-bearing and preserved exactly:
 *   1. column exists in the legacy copy  → copy it
 *   2. NOT NULL column (notnull == 0 means *nullable* in PRAGMA table_info)
 *   3. the four named business defaults
 *   4. TEXT → `''`
 *   5. everything else → `0`
 */
export function defaultColumnExpression(
  name: string,
  notnull: number,
  type: string,
  oldColumns: ReadonlySet<string>,
): string {
  if (oldColumns.has(name)) return `\`${name}\``;
  if (notnull === 0) return 'NULL';
  if (name === 'category') return "'默认'";
  if (name === 'contentType') return "'NOVEL'";
  if (name === 'author') return "'未知作者'";
  if (name === 'colorHex') return "'#7FD8C8'";
  if (type === 'TEXT') return "''";
  return '0';
}

/** Kotlin `internal class LegacyDatabaseMigration(from: Int)`. */
export function createLegacyDatabaseMigration(from: number): LegacyDatabaseMigration {
  const startVersion = from;
  return {
    fromVersion: startVersion,
    toVersion: LEGACY_MIGRATION_TARGET_VERSION,
    async migrate(db: LegacyMigrationDb): Promise<void> {
      for (const sql of LEGACY_MIGRATION_TABLES) {
        const table = tableNameOfCreateSql(sql);
        const existsRows = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          [table],
        );
        if (existsRows.length === 0) {
          await db.execute(sql);
          continue;
        }
        const old = `legacy_v${startVersion}_${table}`;
        const indexRows = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
          [table],
        );
        for (const row of indexRows) {
          const indexName = row.name;
          await db.execute(`DROP INDEX \`${indexName.replace(/`/g, '``')}\``);
        }
        await db.execute(`ALTER TABLE \`${table}\` RENAME TO \`${old}\``);
        await db.execute(sql);
        const oldInfoRows = await db.query<LegacyTableInfoRow>(`PRAGMA table_info(\`${old}\`)`);
        const oldCols = new Set(oldInfoRows.map((c) => c.name));
        const names: string[] = [];
        const values: string[] = [];
        const infoRows = await db.query<LegacyTableInfoRow>(`PRAGMA table_info(\`${table}\`)`);
        for (const column of infoRows) {
          names.push(`\`${column.name}\``);
          values.push(defaultColumnExpression(column.name, column.notnull, column.type, oldCols));
        }
        for (const indexSql of LEGACY_MIGRATION_INDEXES) {
          if (indexSql.includes(`ON \`${table}\``)) await db.execute(indexSql);
        }
        const ordering = oldCols.has('createdTime') ? ' ORDER BY createdTime DESC' : '';
        await db.execute(
          // Kotlin line 42 uses `joinToString()` whose default separator is ", "
          // (comma + space) — preserved here rather than the terser ",".
          `INSERT OR IGNORE INTO \`${table}\` (${names.join(', ')}) SELECT ${values.join(', ')} FROM \`${old}\`${ordering}`,
        );
      }
      for (const indexSql of LEGACY_MIGRATION_INDEXES) {
        await db.execute(indexSql);
      }
    },
  };
}

/**
 * The exact registration list from `AppDatabase.getDatabase(...)`:
 * `LegacyDatabaseMigration(1) … LegacyDatabaseMigration(4)`.
 * (MIGRATION_5_6 … MIGRATION_11_12 are separate incremental migrations and live in
 * `schemaV12.ts` territory — they are not part of this file.)
 */
export function createLegacyDatabaseMigrations(): LegacyDatabaseMigration[] {
  return [1, 2, 3, 4].map((from) => createLegacyDatabaseMigration(from));
}
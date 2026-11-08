/**
 * Incremental Room migrations — port of the `MIGRATION_*` chain declared in
 * `novel-reader/app/src/main/java/com/example/data/AppDatabase.kt`
 * (file: 597 lines total, 531 non-blank; this module covers lines 258..481 only).
 *
 * Android source of truth (Kotlin line → TS):
 *   1..252   package/imports, `BookDao`, `AniListDao`, `AniListTitleEntity`
 *            → audited elsewhere: `library/bookRepository.ts` (BookDao),
 *              `db/anilistDao.ts` (AniListDao + entity), `db/schemaV12.ts` (tables).
 *            Not duplicated here.
 *   253..257  `abstract class AppDatabase : RoomDatabase()` + `companion object {`
 *             `@Volatile private var INSTANCE` → `openDatabase.ts` owns open/create.
 *   258..273  `MIGRATION_5_6` → `MIGRATION_5_6` (below).
 *   274..280  KDoc for `MIGRATION_6_7` → kept.
 *   281..293  `MIGRATION_6_7` (3 statements) → below.
 *   294..299  KDoc for `MIGRATION_7_8` → kept.
 *   300..315  `MIGRATION_7_8` (table + 3 indexes) → below.
 *   316..323  KDoc for `MIGRATION_8_9` → kept.
 *   324..381  `MIGRATION_8_9` (3 tables + 4 indexes) → below.
 *   382..388  KDoc for `MIGRATION_9_10` → kept.
 *   389..394  `MIGRATION_9_10` (2 ALTER TABLE ADD COLUMN) → below.
 *   395..399  KDoc for `MIGRATION_10_11` → kept.
 *   400..424  `MIGRATION_10_11` (1 table + cursor-driven backfill + default row) → below.
 *   425..435  KDoc for `MIGRATION_11_12` → kept.
 *   436..481  `MIGRATION_11_12` (PRAGMA-guarded ALTER + god_moments + 3 indexes) → below.
 *   482..499  KDoc for the bundled-asset importer → `data/anilistSeeding.ts` (audited OK).
 *   500..519  `getDatabase(context)` / `Room.databaseBuilder(...)` / `.addMigrations(...)`
 *            → `openDatabase.ts`; the `.addMigrations(...)` list is reproduced verbatim in
 *              `ANDROID_MIGRATION_CHAIN` below so the registration order is auditable.
 *   520..595  `ensureBundledTitlesImported` / `importBundledTitles` → `data/anilistSeeding.ts`
 *              (BUNDLED_FMT_VERSION = 2, IMPORT_BATCH = 2000 already match).
 *
 * Skipped lines and why:
 *   - Kotlin line 241..245 `@Database(entities = [...14 classes...], version = 12,
 *     exportSchema = true)` → already in `schemaV12.ts` (`TABLES`, 14 entries;
 *     `ROOM_SCHEMA_VERSION = 12`; `ROOM_IDENTITY_HASH =
 *     '4edcea8e99eeed709b4f4497a5cc18a0'`). Not duplicated.
 *   - Kotlin line 246 `@TypeConverters(DownloadTypeConverters::class)` → download module
 *     (`core/download/`), audited by an earlier pass.
 *   - Kotlin lines 254..257 `INSTANCE` double-checked singleton →
 *     `openDatabase.ts` `openAppDatabase` (Capacitor owns connection reuse).
 *   - Kotlin line 409..418 `cursor.moveToNext()` loop with `arrayOf(name, order++,
 *     System.currentTimeMillis())` bind args → `db.query` returns a materialised array;
 *     `order++` / `System.currentTimeMillis()` are evaluated in the same sequence.
 *   - Kotlin line 441..451 `db.query("PRAGMA table_info(...)").use { cursor -> … }` →
 *     `db.query<PragmaTableInfoRow>`; column index 1 is `name`.
 *   - Kotlin `System.currentTimeMillis()` → `Date.now()`.
 *   - Kotlin `IllegalArgumentException` from `require` → `Error` with the identical
 *     message text.
 *
 * Every SQL string, every Chinese literal ('默认') and every magic number
 * (120_000 is privacy, not here; here: 4_000_000, 10_000, 2, 1) is byte-identical to
 * the Kotlin source. No U+3000 occurs in the Android file, so no escape was needed.
 */

/** `PRAGMA table_info` row — only the columns `MIGRATION_11_12` reads. */
export interface PragmaTableInfoRow {
  name: string;
}

/** A single Room migration step, mirroring `androidx.room.migration.Migration(from, to)`. */
export interface RoomMigrationStep {
  readonly name: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(db: MigrationDatabase): Promise<void>;
}

/** The subset of `DatabaseLike` these migrations need. */
export interface MigrationDatabase {
  execute(sql: string, params?: Array<string | number | null>): Promise<unknown>;
  query<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
}

const LEGACY_BOOK_CATEGORY_NAMES = ['未分类', '全部', ''];

export const MIGRATION_5_6: RoomMigrationStep = {
  name: 'MIGRATION_5_6',
  fromVersion: 5,
  toVersion: 6,
  // v5 -> v6：新增 reading_sessions 表，保留既有数据。
  async migrate(db) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS `reading_sessions` (' +
        '`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
        '`bookId` INTEGER, ' +
        '`bookTitle` TEXT NOT NULL, ' +
        '`dateStr` TEXT NOT NULL, ' +
        '`startTimeMs` INTEGER NOT NULL, ' +
        '`endTimeMs` INTEGER NOT NULL, ' +
        '`durationSeconds` INTEGER NOT NULL, ' +
        '`startHour` INTEGER NOT NULL)',
    );
  },
};

export const MIGRATION_6_7: RoomMigrationStep = {
  name: 'MIGRATION_6_7',
  fromVersion: 6,
  toVersion: 7,
  /**
   * v6 -> v7（第七轮第 6.1 条）：分类体系重做——
   * 1. categories 新增 isProtected 列（第 6.3 条分类密码保护标记）；
   * 2. 种子插入不可删除的"默认"分类（替代聚合视图"全部"）；
   * 3. 存量书籍归位：'未分类'/'全部'/空串 及一切孤儿 category 值 → '默认'。
   */
  async migrate(db) {
    await db.execute('ALTER TABLE categories ADD COLUMN isProtected INTEGER NOT NULL DEFAULT 0');
    await db.execute(
      "INSERT INTO categories (name, isProtected) " +
        "SELECT '默认', 0 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = '默认')",
    );
    await db.execute("UPDATE books SET category = '默认' WHERE category IN ('未分类', '全部', '')");
    await db.execute("UPDATE books SET category = '默认' WHERE category NOT IN (SELECT name FROM categories)");
  },
};

export const MIGRATION_7_8: RoomMigrationStep = {
  name: 'MIGRATION_7_8',
  fromVersion: 7,
  toVersion: 8,
  /**
   * v7 -> v8（第七轮第 7 条）：AniList 本地多语言标题库——
   * 只存标题匹配所需的最小数据（Media ID / 类型 / 原文 / 归一化 / 紧凑形态），
   * normalized 与 compact 建索引，查询走 SQL 不进内存常驻。
   */
  async migrate(db) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS `anilist_titles` (' +
        '`rowId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
        '`mediaId` INTEGER NOT NULL, ' +
        '`titleType` TEXT NOT NULL, ' +
        '`rawTitle` TEXT NOT NULL, ' +
        '`normalizedTitle` TEXT NOT NULL, ' +
        '`compactTitle` TEXT NOT NULL)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_anilist_titles_normalizedTitle` ON `anilist_titles` (`normalizedTitle`)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_anilist_titles_compactTitle` ON `anilist_titles` (`compactTitle`)',
    );
    await db.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS `index_anilist_titles_mediaId_titleType_rawTitle` ON `anilist_titles` (`mediaId`, `titleType`, `rawTitle`)',
    );
  },
};

export const MIGRATION_8_9: RoomMigrationStep = {
  name: 'MIGRATION_8_9',
  fromVersion: 8,
  toVersion: 9,
  /**
   * v8 -> v9（「我喜欢的」在线收藏 + 阅读进度三张表）：
   *
   * 三张数据与下载完全解耦——同一 (sourceId, comicId) 可以 仅下载 / 仅喜欢 /
   * 两者都有；取消喜欢、删除下载都不影响 comic_progress 与 comic_chapter_read。
   * 旧数据无需搬运（此前没有在线收藏概念），只做建表，存量书籍零影响。
   */
  async migrate(db) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS `favorites` (' +
        '`sourceId` TEXT NOT NULL, ' +
        '`comicId` TEXT NOT NULL, ' +
        '`title` TEXT NOT NULL, ' +
        '`author` TEXT NOT NULL, ' +
        '`coverUrl` TEXT, ' +
        '`localThumbPath` TEXT, ' +
        '`serialStatus` TEXT NOT NULL, ' +
        '`latestChapterId` TEXT, ' +
        '`latestChapterTitle` TEXT, ' +
        '`latestChapterUpdateAt` INTEGER NOT NULL, ' +
        '`lastCheckedAt` INTEGER NOT NULL, ' +
        '`sourceAlive` INTEGER NOT NULL, ' +
        '`categoryName` TEXT NOT NULL, ' +
        '`favoritedAt` INTEGER NOT NULL, ' +
        '`sortOrder` INTEGER NOT NULL, ' +
        'PRIMARY KEY(`sourceId`, `comicId`))',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_favorites_categoryName` ON `favorites` (`categoryName`)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_favorites_favoritedAt` ON `favorites` (`favoritedAt`)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_favorites_lastCheckedAt` ON `favorites` (`lastCheckedAt`)',
    );

    await db.execute(
      'CREATE TABLE IF NOT EXISTS `comic_progress` (' +
        '`sourceId` TEXT NOT NULL, ' +
        '`comicId` TEXT NOT NULL, ' +
        '`lastChapterId` TEXT, ' +
        '`lastChapterIndex` INTEGER NOT NULL, ' +
        '`lastPageIndex` INTEGER NOT NULL, ' +
        '`lastPageCount` INTEGER NOT NULL, ' +
        '`lastReadAt` INTEGER NOT NULL, ' +
        '`seenTopChapterId` TEXT, ' +
        '`seenChapterCount` INTEGER NOT NULL, ' +
        'PRIMARY KEY(`sourceId`, `comicId`))',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_comic_progress_lastReadAt` ON `comic_progress` (`lastReadAt`)',
    );

    await db.execute(
      'CREATE TABLE IF NOT EXISTS `comic_chapter_read` (' +
        '`sourceId` TEXT NOT NULL, ' +
        '`comicId` TEXT NOT NULL, ' +
        '`chapterId` TEXT NOT NULL, ' +
        '`status` INTEGER NOT NULL, ' +
        '`pageIndex` INTEGER NOT NULL, ' +
        '`pageCount` INTEGER NOT NULL, ' +
        '`chapterIndex` INTEGER NOT NULL, ' +
        '`updatedAt` INTEGER NOT NULL, ' +
        'PRIMARY KEY(`sourceId`, `comicId`, `chapterId`))',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_comic_chapter_read_sourceId_comicId` ' +
        'ON `comic_chapter_read` (`sourceId`, `comicId`)',
    );
  },
};

export const MIGRATION_9_10: RoomMigrationStep = {
  name: 'MIGRATION_9_10',
  fromVersion: 9,
  toVersion: 10,
  /**
   * v9 -> v10：books 增加来源标识两列（sourceId / comicId），
   * 让「我的书架」里的书能反查到「我喜欢的」的在线条目 —— 书架卡片才能显示
   * 右下角小心形、批量操作才能判断「这本有没有来源、能不能喜欢」。
   * 存量本地导入书两列为空（无来源 → 不可喜欢，阅读进度不受影响）。
   */
  async migrate(db) {
    await db.execute('ALTER TABLE books ADD COLUMN sourceId TEXT');
    await db.execute('ALTER TABLE books ADD COLUMN comicId TEXT');
  },
};

export const MIGRATION_10_11: RoomMigrationStep = {
  name: 'MIGRATION_10_11',
  fromVersion: 10,
  toVersion: 11,
  /**
   * v10 -> v11：「我喜欢的」拥有自己的分类表（与书架 categories 彻底分开）。
   * 升级时把收藏里已经用过的分类名搬进新表，用户原有的分组不会丢。
   */
  async migrate(db) {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS `favorite_categories` (' +
        '`name` TEXT NOT NULL, `sortOrder` INTEGER NOT NULL, ' +
        '`createdAt` INTEGER NOT NULL, PRIMARY KEY(`name`))',
    );
    let order = 0;
    const rows = await db.query<{ categoryName: string | null }>('SELECT DISTINCT categoryName FROM favorites');
    for (const row of rows) {
      const name = row.categoryName;
      if (name != null && name.trim() !== '') {
        await db.execute(
          'INSERT OR IGNORE INTO favorite_categories (name, sortOrder, createdAt) VALUES (?, ?, ?)',
          [name, order++, Date.now()],
        );
      }
    }
    await db.execute(
      'INSERT OR IGNORE INTO favorite_categories (name, sortOrder, createdAt) VALUES (?, ?, ?)',
      ['默认', order, Date.now()],
    );
  },
};

export const MIGRATION_11_12: RoomMigrationStep = {
  name: 'MIGRATION_11_12',
  fromVersion: 11,
  toVersion: 12,
  /**
   * v11 -> v12（漫画章节书签 + 神回）：给 comic_chapter_read 增加 bookmarked，
   * 新增 god_moments 表 + (bookId, chapterId) 唯一索引。
   *
   * 说明：漫画的神回主键是**源作用域字符串**（bookId = "sourceId::comicId"，
   * chapterId = 源章节 id），与本地小说库 books/chapters 的 Int 主键不同源，
   * 因此不建 Room 外键；级联删除由 [com.example.god.GodMomentRepository]
   * 的 deleteForBook / deleteForChapter 显式执行（含封面缓存文件清理）。
   * 存量数据：章节阅读记录保留，旧记录的书签标记默认为 false。
   */
  async migrate(db) {
    // 旧版章节阅读记录没有 bookmarked。仅在实体加字段而漏掉此处，
    // Room 会在升级校验时报 schema mismatch，启动后的首次查库即闪退。
    // DEFAULT 0 保留所有旧记录，并让它们默认处于未标书签状态。
    const infoRows = await db.query<PragmaTableInfoRow>('PRAGMA table_info(`comic_chapter_read`)');
    const hasBookmarkColumn = infoRows.some((row) => row.name === 'bookmarked');
    if (!hasBookmarkColumn) {
      await db.execute('ALTER TABLE `comic_chapter_read` ADD COLUMN `bookmarked` INTEGER NOT NULL DEFAULT 0');
    }
    await db.execute(
      'CREATE TABLE IF NOT EXISTS `god_moments` (' +
        '`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
        '`contentType` TEXT NOT NULL, ' +
        '`bookId` TEXT NOT NULL, ' +
        '`chapterId` TEXT NOT NULL, ' +
        '`bookTitle` TEXT NOT NULL, ' +
        '`chapterTitle` TEXT NOT NULL, ' +
        '`chapterNumber` INTEGER NOT NULL, ' +
        '`title` TEXT NOT NULL, ' +
        '`titleIsCustom` INTEGER NOT NULL, ' +
        '`rating` REAL NOT NULL, ' +
        '`note` TEXT NOT NULL, ' +
        '`coverPath` TEXT, ' +
        '`coverSource` TEXT NOT NULL, ' +
        '`cropParams` TEXT NOT NULL, ' +
        '`createdAt` INTEGER NOT NULL, ' +
        '`updatedAt` INTEGER NOT NULL)',
    );
    await db.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS `index_god_moments_bookId_chapterId` ' +
        'ON `god_moments` (`bookId`, `chapterId`)',
    );
    await db.execute('CREATE INDEX IF NOT EXISTS `index_god_moments_rating` ON `god_moments` (`rating`)');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS `index_god_moments_createdAt` ON `god_moments` (`createdAt`)',
    );
  },
};

/**
 * The exact `.addMigrations(...)` list from `AppDatabase.getDatabase(context)`:
 *   LegacyDatabaseMigration(1), LegacyDatabaseMigration(2),
 *   LegacyDatabaseMigration(3), LegacyDatabaseMigration(4),
 *   MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8,
 *   MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11,
 *   MIGRATION_11_12
 * The four `LegacyDatabaseMigration(n)` entries are provided by
 * `createLegacyDatabaseMigrations()` in `./legacyDatabaseMigration`.
 */
export const MIGRATION_12_13: RoomMigrationStep = {
  name: 'MIGRATION_12_13', fromVersion: 12, toVersion: 13,
  async migrate(db) {
    await db.execute('CREATE TABLE IF NOT EXISTS transfer_identities (localKey TEXT NOT NULL, stableId TEXT NOT NULL, PRIMARY KEY(localKey))');
    await db.execute('CREATE TABLE IF NOT EXISTS transfer_receipts (packageId TEXT NOT NULL, importedAt INTEGER NOT NULL, PRIMARY KEY(packageId))');
    await db.execute('CREATE INDEX IF NOT EXISTS index_chapters_bookId_chapterOrder ON chapters(bookId,chapterOrder)');
  },
};

export const ANDROID_MIGRATION_CHAIN: readonly RoomMigrationStep[] = [
  MIGRATION_5_6,
  MIGRATION_6_7,
  MIGRATION_7_8,
  MIGRATION_8_9,
  MIGRATION_9_10,
  MIGRATION_10_11,
  MIGRATION_11_12,
  MIGRATION_12_13,
];

/** Exported for tests / UI that need the pre-seeded category names. */
export const CATEGORY_RELOCATED_FROM = LEGACY_BOOK_CATEGORY_NAMES;

/**
 * Room v12 schema — authoritative transcription of
 * `novel-reader/app/schemas/com.example.data.AppDatabase/12.json`
 * (1071 lines; `database.entities` = 14 entries, `database.views` = 0).
 *
 * identityHash: 4edcea8e99eeed709b4f4497a5cc18a0
 * version: 12
 * No foreign keys on any table.
 *
 * Every column below was transcribed **per column** from the 12.json `fields[]`
 * entries: `columnName` → `name`, `affinity` → `type`, `notNull` → `notNull`,
 * plus `primaryKey.columnNames` → `primaryKey` and `primaryKey.autoGenerate` →
 * `autoGeneratePk`. `defaultValue` is **absent from all 14 tables in 12.json**
 * (Room only emits it when `@ColumnInfo(defaultValue = …)` is declared, and no
 * entity in this project declares one), so there is nothing to transcribe here;
 * the two `DEFAULT 0` clauses that do exist in the codebase live in the
 * incremental migrations (`MIGRATION_6_7` → `categories.isProtected`,
 * `MIGRATION_11_12` → `comic_chapter_read.bookmarked`), see `roomMigrations.ts`.
 */

export const ROOM_IDENTITY_HASH = '4edcea8e99eeed709b4f4497a5cc18a0';
export const ROOM_SCHEMA_VERSION = 12;

export interface ColumnDef {
  name: string;
  type: 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB';
  /** `notNull` from the 12.json field entry. Absent in the JSON ⇒ nullable. */
  notNull?: boolean;
  primaryKey?: boolean;
  autoGenerate?: boolean;
}

export interface IndexDef {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey: string[];
  autoGeneratePk: boolean;
  indices: IndexDef[];
}

export const TABLES: TableDef[] = [
  {
    name: 'books',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'author', type: 'TEXT', notNull: true },
      { name: 'filePath', type: 'TEXT', notNull: true },
      { name: 'coverUri', type: 'TEXT' },
      { name: 'category', type: 'TEXT', notNull: true },
      { name: 'currentChapterIndex', type: 'INTEGER', notNull: true },
      { name: 'scrollOffset', type: 'INTEGER', notNull: true },
      { name: 'isFinished', type: 'INTEGER', notNull: true },
      { name: 'totalChapters', type: 'INTEGER', notNull: true },
      { name: 'contentType', type: 'TEXT', notNull: true },
      { name: 'addedTime', type: 'INTEGER', notNull: true },
      { name: 'lastReadTime', type: 'INTEGER', notNull: true },
      { name: 'sourceId', type: 'TEXT' },
      { name: 'comicId', type: 'TEXT' },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'chapters',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'bookId', type: 'INTEGER', notNull: true },
      { name: 'chapterOrder', type: 'INTEGER', notNull: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'content', type: 'TEXT', notNull: true },
      { name: 'startCharIndex', type: 'INTEGER', notNull: true },
      { name: 'endCharIndex', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'bookmarks',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'bookId', type: 'INTEGER', notNull: true },
      { name: 'chapterIndex', type: 'INTEGER', notNull: true },
      { name: 'scrollOffset', type: 'INTEGER', notNull: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'snippet', type: 'TEXT', notNull: true },
      { name: 'createdTime', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [
      {
        name: 'index_bookmarks_bookId_chapterIndex',
        unique: true,
        columns: ['bookId', 'chapterIndex'],
      },
    ],
  },
  {
    name: 'highlights',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'bookId', type: 'INTEGER', notNull: true },
      { name: 'chapterIndex', type: 'INTEGER', notNull: true },
      { name: 'selectedText', type: 'TEXT', notNull: true },
      { name: 'note', type: 'TEXT', notNull: true },
      { name: 'colorHex', type: 'TEXT', notNull: true },
      { name: 'createdTime', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'categories',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'isProtected', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'reading_records',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'bookId', type: 'INTEGER' },
      { name: 'bookTitle', type: 'TEXT', notNull: true },
      { name: 'dateStr', type: 'TEXT', notNull: true },
      { name: 'durationSeconds', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'reading_sessions',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'bookId', type: 'INTEGER' },
      { name: 'bookTitle', type: 'TEXT', notNull: true },
      { name: 'dateStr', type: 'TEXT', notNull: true },
      { name: 'startTimeMs', type: 'INTEGER', notNull: true },
      { name: 'endTimeMs', type: 'INTEGER', notNull: true },
      { name: 'durationSeconds', type: 'INTEGER', notNull: true },
      { name: 'startHour', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [],
  },
  {
    name: 'download_tasks',
    columns: [
      { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'sourceId', type: 'TEXT', notNull: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'author', type: 'TEXT', notNull: true },
      { name: 'coverUrl', type: 'TEXT' },
      { name: 'downloadUrl', type: 'TEXT', notNull: true },
      { name: 'format', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', notNull: true },
      { name: 'downloadedBytes', type: 'INTEGER', notNull: true },
      { name: 'totalBytes', type: 'INTEGER', notNull: true },
      { name: 'filePath', type: 'TEXT', notNull: true },
      { name: 'errorMessage', type: 'TEXT' },
      { name: 'updatedAt', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: false,
    indices: [],
  },
  {
    name: 'anilist_titles',
    columns: [
      { name: 'rowId', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'mediaId', type: 'INTEGER', notNull: true },
      { name: 'titleType', type: 'TEXT', notNull: true },
      { name: 'rawTitle', type: 'TEXT', notNull: true },
      { name: 'normalizedTitle', type: 'TEXT', notNull: true },
      { name: 'compactTitle', type: 'TEXT', notNull: true },
    ],
    primaryKey: ['rowId'],
    autoGeneratePk: true,
    indices: [
      { name: 'index_anilist_titles_normalizedTitle', unique: false, columns: ['normalizedTitle'] },
      { name: 'index_anilist_titles_compactTitle', unique: false, columns: ['compactTitle'] },
      {
        name: 'index_anilist_titles_mediaId_titleType_rawTitle',
        unique: true,
        columns: ['mediaId', 'titleType', 'rawTitle'],
      },
    ],
  },
  {
    name: 'favorites',
    columns: [
      { name: 'sourceId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'comicId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'author', type: 'TEXT', notNull: true },
      { name: 'coverUrl', type: 'TEXT' },
      { name: 'localThumbPath', type: 'TEXT' },
      { name: 'serialStatus', type: 'TEXT', notNull: true },
      { name: 'latestChapterId', type: 'TEXT' },
      { name: 'latestChapterTitle', type: 'TEXT' },
      { name: 'latestChapterUpdateAt', type: 'INTEGER', notNull: true },
      { name: 'lastCheckedAt', type: 'INTEGER', notNull: true },
      { name: 'sourceAlive', type: 'INTEGER', notNull: true },
      { name: 'categoryName', type: 'TEXT', notNull: true },
      { name: 'favoritedAt', type: 'INTEGER', notNull: true },
      { name: 'sortOrder', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId'],
    autoGeneratePk: false,
    indices: [
      { name: 'index_favorites_categoryName', unique: false, columns: ['categoryName'] },
      { name: 'index_favorites_favoritedAt', unique: false, columns: ['favoritedAt'] },
      { name: 'index_favorites_lastCheckedAt', unique: false, columns: ['lastCheckedAt'] },
    ],
  },
  {
    name: 'comic_progress',
    columns: [
      { name: 'sourceId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'comicId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'lastChapterId', type: 'TEXT' },
      { name: 'lastChapterIndex', type: 'INTEGER', notNull: true },
      { name: 'lastPageIndex', type: 'INTEGER', notNull: true },
      { name: 'lastPageCount', type: 'INTEGER', notNull: true },
      { name: 'lastReadAt', type: 'INTEGER', notNull: true },
      { name: 'seenTopChapterId', type: 'TEXT' },
      { name: 'seenChapterCount', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId'],
    autoGeneratePk: false,
    indices: [{ name: 'index_comic_progress_lastReadAt', unique: false, columns: ['lastReadAt'] }],
  },
  {
    name: 'comic_chapter_read',
    columns: [
      { name: 'sourceId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'comicId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'chapterId', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'status', type: 'INTEGER', notNull: true },
      { name: 'pageIndex', type: 'INTEGER', notNull: true },
      { name: 'pageCount', type: 'INTEGER', notNull: true },
      { name: 'chapterIndex', type: 'INTEGER', notNull: true },
      { name: 'updatedAt', type: 'INTEGER', notNull: true },
      { name: 'bookmarked', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId', 'chapterId'],
    autoGeneratePk: false,
    indices: [
      {
        name: 'index_comic_chapter_read_sourceId_comicId',
        unique: false,
        columns: ['sourceId', 'comicId'],
      },
    ],
  },
  {
    name: 'favorite_categories',
    columns: [
      { name: 'name', type: 'TEXT', notNull: true, primaryKey: true },
      { name: 'sortOrder', type: 'INTEGER', notNull: true },
      { name: 'createdAt', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['name'],
    autoGeneratePk: false,
    indices: [],
  },
  {
    name: 'god_moments',
    columns: [
      { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true, autoGenerate: true },
      { name: 'contentType', type: 'TEXT', notNull: true },
      { name: 'bookId', type: 'TEXT', notNull: true },
      { name: 'chapterId', type: 'TEXT', notNull: true },
      { name: 'bookTitle', type: 'TEXT', notNull: true },
      { name: 'chapterTitle', type: 'TEXT', notNull: true },
      { name: 'chapterNumber', type: 'INTEGER', notNull: true },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'titleIsCustom', type: 'INTEGER', notNull: true },
      { name: 'rating', type: 'REAL', notNull: true },
      { name: 'note', type: 'TEXT', notNull: true },
      { name: 'coverPath', type: 'TEXT' },
      { name: 'coverSource', type: 'TEXT', notNull: true },
      { name: 'cropParams', type: 'TEXT', notNull: true },
      { name: 'createdAt', type: 'INTEGER', notNull: true },
      { name: 'updatedAt', type: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGeneratePk: true,
    indices: [
      {
        name: 'index_god_moments_bookId_chapterId',
        unique: true,
        columns: ['bookId', 'chapterId'],
      },
      { name: 'index_god_moments_rating', unique: false, columns: ['rating'] },
      { name: 'index_god_moments_createdAt', unique: false, columns: ['createdAt'] },
    ],
  },
];

/**
 * The 12 tables carried by a backup archive.
 *
 * Kotlin `BackupArchive.tables` (BackupArchive.kt lines 19..21) lists exactly these
 * 12, in exactly this order. The two Room tables deliberately left out are:
 *
 * - `download_tasks` — "active downloads" are excluded by the KDoc on
 *   `BackupArchive` (line 17: "Auth stores, models and active downloads are
 *   excluded"). Download rows point at `filePath` files that the archive does not
 *   carry (E12), so restoring them would leave resumable tasks referencing files
 *   that are not there.
 * - `anilist_titles` — the 27 000-row bundled title dataset is an APK *asset*
 *   (`assets/anilist_titles.tsv.gz`), re-imported on first open by
 *   `AppDatabase.ensureBundledTitlesImported`. It is derived data, not user data.
 *
 * Both sides derive this list from this one constant, so the export order, the
 * restore whitelist and the column-validation whitelist cannot drift apart.
 */
export const BACKUP_TABLES: readonly string[] = [
  'books',
  'chapters',
  'bookmarks',
  'highlights',
  'categories',
  'reading_records',
  'reading_sessions',
  'favorites',
  'comic_progress',
  'comic_chapter_read',
  'favorite_categories',
  'god_moments',
];

/**
 * Emit the physical DDL for one table, shaped exactly like Room's `createSql`
 * from 12.json.
 *
 * Room's two shapes, both reproduced here:
 *   - single autoGenerate INTEGER key → column constraint
 *     (`\`id\` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`)
 *   - everything else (composite keys, TEXT keys) → table constraint
 *     (`…, PRIMARY KEY(\`sourceId\`, \`comicId\`)`)
 *
 * Emitting two inline `PRIMARY KEY` clauses for a composite key is what this
 * function used to do; real SQLite rejects that with
 * `table "favorites" has more than one primary key`, which silently broke the
 * three composite-key tables on device (the in-memory web mock tolerated it, so
 * the test suite never caught it).
 */
export function createTableSql(table: TableDef): string {
  const inlinePk =
    table.autoGeneratePk && table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
  const parts = table.columns.map((c) => {
    let sql = `"${c.name}" ${c.type}`;
    // Constraint order is Room's own, byte-for-byte from `12.json`
    // `database.entities[].createSql`: `\`id\` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`.
    // SQLite accepts any order of table-level column constraints, so this is cosmetic —
    // but matching Room exactly means the DDL can be diffed against the exported schema.
    if (c.name === inlinePk) sql += ' PRIMARY KEY AUTOINCREMENT';
    if (c.notNull) sql += ' NOT NULL';
    return sql;
  });
  if (inlinePk === undefined) {
    parts.push(`PRIMARY KEY(${table.primaryKey.map((c) => `"${c}"`).join(', ')})`);
  }
  return `CREATE TABLE IF NOT EXISTS "${table.name}" (${parts.join(', ')})`;
}

export function createIndexSql(table: TableDef, index: IndexDef): string {
  const unique = index.unique ? 'UNIQUE ' : '';
  const cols = index.columns.map((c) => `"${c}"`).join(', ');
  return `CREATE ${unique}INDEX IF NOT EXISTS "${index.name}" ON "${table.name}" (${cols})`;
}
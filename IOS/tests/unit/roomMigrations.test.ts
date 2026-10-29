/**
 * Tests for the Room migration chain ported from Android
 * `data/AppDatabase.kt` (`MIGRATION_5_6` … `MIGRATION_11_12`, lines 258..481),
 * `data/LegacyDatabaseMigration.kt` (78 lines) and the `AniListDao` queries
 * (AppDatabase.kt lines 176..239).
 *
 * The expectations here are the Android SQL / defaults, checked against an in-memory
 * statement recorder — no real SQLite is involved.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_MIGRATION_INDEXES,
  LEGACY_MIGRATION_TABLES,
  createLegacyDatabaseMigration,
  createLegacyDatabaseMigrations,
  defaultColumnExpression,
  tableNameOfCreateSql,
  type LegacyMigrationDb,
  type LegacyTableInfoRow,
} from '../../src/core/db/legacyDatabaseMigration';
import {
  ANDROID_MIGRATION_CHAIN,
  MIGRATION_10_11,
  MIGRATION_11_12,
  MIGRATION_5_6,
  MIGRATION_6_7,
  MIGRATION_7_8,
  MIGRATION_8_9,
  MIGRATION_9_10,
  type MigrationDatabase,
} from '../../src/core/db/roomMigrations';
import { AniListDao } from '../../src/core/db/anilistDao';
import { ROOM_IDENTITY_HASH, ROOM_SCHEMA_VERSION, TABLES } from '../../src/core/db/schemaV12';
import type { DatabaseLike } from '../../src/core/library/bookRepository';

interface Recorder {
  db: MigrationDatabase;
  executed: Array<{ sql: string; params: Array<string | number | null> }>;
  sql: string[];
}

function recorder(
  tableInfo: Record<string, LegacyTableInfoRow[]> = {},
  existingTables: string[] = [],
  existingIndexes: Array<{ name: string }> = [],
): Recorder {
  const executed: Array<{ sql: string; params: Array<string | number | null> }> = [];
  const sql: string[] = [];
  const db: MigrationDatabase = {
    async execute(stmt, params) {
      executed.push({ sql: stmt, params: params ?? [] });
      sql.push(stmt);
      return undefined;
    },
    async query<T>(stmt: string, params: Array<string | number | null> = []): Promise<T[]> {
      if (stmt.startsWith('PRAGMA table_info')) {
        const table = /PRAGMA table_info\(`(.+?)`\)/.exec(stmt)?.[1] ?? '';
        return (tableInfo[table] ?? []) as unknown as T[];
      }
      if (stmt.includes("type='table'")) {
        const name = String(params[0]);
        return (existingTables.includes(name) ? [{ name }] : []) as unknown as T[];
      }
      if (stmt.includes("type='index'")) {
        return existingIndexes as unknown as T[];
      }
      return [];
    },
  };
  return { db, executed, sql };
}

describe('schemaV12 authoritative facts (verified, not re-derived)', () => {
  it('keeps the Room v12 identityHash and version', () => {
    expect(ROOM_IDENTITY_HASH).toBe('4edcea8e99eeed709b4f4497a5cc18a0');
    expect(ROOM_SCHEMA_VERSION).toBe(12);
  });

  it('has 14 tables and a 12-table backup set', () => {
    expect(TABLES).toHaveLength(14);
    const names = TABLES.map((t) => t.name);
    expect(names).toEqual([
      'books',
      'chapters',
      'bookmarks',
      'highlights',
      'categories',
      'reading_records',
      'reading_sessions',
      'download_tasks',
      'anilist_titles',
      'favorites',
      'comic_progress',
      'comic_chapter_read',
      'favorite_categories',
      'god_moments',
    ]);
  });

  it('LegacyDatabaseMigration.TABLES matches the same 14 names in the same order', () => {
    expect(LEGACY_MIGRATION_TABLES).toHaveLength(14);
    expect(LEGACY_MIGRATION_TABLES.map(tableNameOfCreateSql)).toEqual(TABLES.map((t) => t.name));
  });

  it('LegacyDatabaseMigration.INDEXES matches the 12 schema indices', () => {
    expect(LEGACY_MIGRATION_INDEXES).toHaveLength(12);
    const schemaIndexCount = TABLES.reduce((n, t) => n + t.indices.length, 0);
    expect(schemaIndexCount).toBe(12);
  });
});

describe('LegacyDatabaseMigration.kt', () => {
  it('extracts the table name from a CREATE statement', () => {
    expect(tableNameOfCreateSql('CREATE TABLE IF NOT EXISTS `books` (`id` INTEGER)')).toBe('books');
  });

  it('reproduces the per-column fallback `when` in Android precedence (lines 28..37)', () => {
    const old = new Set(['id', 'title']);
    // 1. present in the legacy copy -> copied
    expect(defaultColumnExpression('title', 1, 'TEXT', old)).toBe('`title`');
    // 2. nullable (PRAGMA notnull == 0) -> NULL
    expect(defaultColumnExpression('coverUri', 0, 'TEXT', old)).toBe('NULL');
    // 3. the four named business defaults
    expect(defaultColumnExpression('category', 1, 'TEXT', old)).toBe("'默认'");
    expect(defaultColumnExpression('contentType', 1, 'TEXT', old)).toBe("'NOVEL'");
    expect(defaultColumnExpression('author', 1, 'TEXT', old)).toBe("'未知作者'");
    expect(defaultColumnExpression('colorHex', 1, 'TEXT', old)).toBe("'#7FD8C8'");
    // 4. remaining TEXT -> ''
    expect(defaultColumnExpression('snippet', 1, 'TEXT', old)).toBe("''");
    // 5. everything else -> 0
    expect(defaultColumnExpression('scrollOffset', 1, 'INTEGER', old)).toBe('0');
    expect(defaultColumnExpression('rating', 1, 'REAL', old)).toBe('0');
    // a nullable column wins over the named default (checked first)
    expect(defaultColumnExpression('author', 0, 'TEXT', old)).toBe('NULL');
  });

  it('creates every table when none exist (line 12)', async () => {
    const r = recorder();
    await createLegacyDatabaseMigration(1).migrate(r.db);
    const creates = r.sql.filter((s) => s.startsWith('CREATE TABLE'));
    expect(creates).toHaveLength(14);
    // no ALTER / INSERT happened
    expect(r.sql.some((s) => s.startsWith('ALTER TABLE'))).toBe(false);
    expect(r.sql.some((s) => s.startsWith('INSERT OR IGNORE'))).toBe(false);
    // the trailing `INDEXES.forEach` still ran all 12 index statements
    expect(r.sql.filter((s) => s.startsWith('CREATE')).length).toBe(26);
  });

  it('renames, recreates and copies an existing table (lines 13..42)', async () => {
    // The legacy copy (`legacy_v2_books`) and the fresh v12 table (`books`) have DIFFERENT
    // column sets — that is the whole point of the rename dance.
    const r = recorder(
      {
        books: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1 },
          { cid: 1, name: 'title', type: 'TEXT', notnull: 1 },
          { cid: 2, name: 'coverUri', type: 'TEXT', notnull: 0 },
          { cid: 3, name: 'colorHex', type: 'TEXT', notnull: 1 },
        ],
        legacy_v2_books: [{ cid: 1, name: 'title', type: 'TEXT', notnull: 1 }],
      },
      ['books'],
      [{ name: 'weird`name' }],
    );
    await createLegacyDatabaseMigration(2).migrate(r.db);
    expect(r.sql).toContain('DROP INDEX `weird``name`');
    expect(r.sql).toContain('ALTER TABLE `books` RENAME TO `legacy_v2_books`');
    const insert = r.executed.find((e) => e.sql.startsWith('INSERT OR IGNORE INTO `books`'));
    expect(insert).toBeDefined();
    // `title` exists in the legacy copy -> copied; `coverUri` is nullable -> NULL;
    // `id` is not in the legacy copy but is NOT NULL INTEGER -> 0; `colorHex` -> '#7FD8C8'.
    expect(insert?.sql).toContain('`id`, `title`, `coverUri`, `colorHex`');
    expect(insert?.sql).toContain('0, `title`, NULL, \'#7FD8C8\'');
    // no `createdTime` in the legacy copy -> no ORDER BY
    expect(insert?.sql).not.toContain('ORDER BY createdTime DESC');
  });

  it('adds the createdTime ordering when the legacy copy has it (line 41)', async () => {
    const r = recorder(
      {
        bookmarks: [{ cid: 6, name: 'createdTime', type: 'INTEGER', notnull: 1 }],
        legacy_v3_bookmarks: [{ cid: 6, name: 'createdTime', type: 'INTEGER', notnull: 1 }],
      },
      ['bookmarks'],
    );
    await createLegacyDatabaseMigration(3).migrate(r.db);
    const insert = r.executed.find((e) => e.sql.startsWith('INSERT OR IGNORE INTO `bookmarks`'));
    expect(insert?.sql.endsWith('ORDER BY createdTime DESC')).toBe(true);
  });

  it('registers LegacyDatabaseMigration(1..4) exactly as AppDatabase.getDatabase does', () => {
    const ms = createLegacyDatabaseMigrations();
    expect(ms.map((m) => m.fromVersion)).toEqual([1, 2, 3, 4]);
    for (const m of ms) expect(m.toVersion).toBe(12);
  });
});

describe('roomMigrations.ts (AppDatabase.kt 258..481)', () => {
  it('registers the eight current incremental steps in Android order', () => {
    expect(ANDROID_MIGRATION_CHAIN.map((m) => m.name)).toEqual([
      'MIGRATION_5_6',
      'MIGRATION_6_7',
      'MIGRATION_7_8',
      'MIGRATION_8_9',
      'MIGRATION_9_10',
      'MIGRATION_10_11',
      'MIGRATION_11_12',
      'MIGRATION_12_13',
    ]);
    expect(ANDROID_MIGRATION_CHAIN.map((m) => `${m.fromVersion}->${m.toVersion}`)).toEqual([
      '5->6',
      '6->7',
      '7->8',
      '8->9',
      '9->10',
      '10->11',
      '11->12',
      '12->13',
    ]);
  });

  it('MIGRATION_5_6 creates reading_sessions with the 8 Android columns', async () => {
    const r = recorder();
    await MIGRATION_5_6.migrate(r.db);
    expect(r.sql).toHaveLength(1);
    for (const col of [
      '`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL',
      '`bookId` INTEGER',
      '`bookTitle` TEXT NOT NULL',
      '`dateStr` TEXT NOT NULL',
      '`startTimeMs` INTEGER NOT NULL',
      '`endTimeMs` INTEGER NOT NULL',
      '`durationSeconds` INTEGER NOT NULL',
      '`startHour` INTEGER NOT NULL',
    ]) {
      expect(r.sql[0]).toContain(col);
    }
  });

  it('MIGRATION_6_7 adds isProtected, seeds 默认 and relocates legacy categories', async () => {
    const r = recorder();
    await MIGRATION_6_7.migrate(r.db);
    expect(r.sql[0]).toBe('ALTER TABLE categories ADD COLUMN isProtected INTEGER NOT NULL DEFAULT 0');
    expect(r.sql[1]).toContain("SELECT '默认', 0 WHERE NOT EXISTS");
    expect(r.sql[2]).toBe("UPDATE books SET category = '默认' WHERE category IN ('未分类', '全部', '')");
    expect(r.sql[3]).toBe("UPDATE books SET category = '默认' WHERE category NOT IN (SELECT name FROM categories)");
  });

  it('MIGRATION_7_8 creates anilist_titles plus its 3 indices', async () => {
    const r = recorder();
    await MIGRATION_7_8.migrate(r.db);
    expect(r.sql).toHaveLength(4);
    expect(r.sql[0]).toContain('CREATE TABLE IF NOT EXISTS `anilist_titles`');
    expect(r.sql[1]).toContain('index_anilist_titles_normalizedTitle');
    expect(r.sql[2]).toContain('index_anilist_titles_compactTitle');
    expect(r.sql[3]).toContain('UNIQUE INDEX IF NOT EXISTS `index_anilist_titles_mediaId_titleType_rawTitle`');
  });

  it('MIGRATION_8_9 creates favorites / comic_progress / comic_chapter_read + 4 indices', async () => {
    const r = recorder();
    await MIGRATION_8_9.migrate(r.db);
    const tables = r.sql.filter((s) => s.startsWith('CREATE TABLE'));
    expect(tables).toHaveLength(3);
    expect(tables[0]).toContain('`favorites`');
    expect(tables[1]).toContain('`comic_progress`');
    expect(tables[2]).toContain('`comic_chapter_read`');
    // comic_chapter_read gets `bookmarked` only in 11 -> 12, not here.
    expect(tables[2]).not.toContain('bookmarked');
    // 3 favorites indices + 1 comic_progress + 1 comic_chapter_read
    expect(r.sql.filter((s) => s.startsWith('CREATE') && !s.startsWith('CREATE TABLE'))).toHaveLength(5);
  });

  it('MIGRATION_9_10 adds the two books source columns', async () => {
    const r = recorder();
    await MIGRATION_9_10.migrate(r.db);
    expect(r.sql).toEqual([
      'ALTER TABLE books ADD COLUMN sourceId TEXT',
      'ALTER TABLE books ADD COLUMN comicId TEXT',
    ]);
  });

  it('MIGRATION_10_11 backfills distinct non-blank categories then seeds 默认', async () => {
    const r = recorder();
    const inner: MigrationDatabase = {
      async execute(stmt, params) {
        return r.db.execute(stmt, params);
      },
      async query<T>(stmt: string, params: Array<string | number | null> = []): Promise<T[]> {
        if (stmt === 'SELECT DISTINCT categoryName FROM favorites') {
          return [{ categoryName: '热血' }, { categoryName: '   ' }, { categoryName: null }] as unknown as T[];
        }
        return r.db.query<T>(stmt, params);
      },
    };
    await MIGRATION_10_11.migrate(inner);
    expect(r.sql[0]).toContain('CREATE TABLE IF NOT EXISTS `favorite_categories`');
    const inserts = r.executed.filter((e) => e.sql.startsWith('INSERT OR IGNORE INTO favorite_categories'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.params[0]).toBe('热血');
    expect(inserts[0]?.params[1]).toBe(0);
    expect(inserts[1]?.params[0]).toBe('默认');
    // the second insert reuses the post-increment order value
    expect(inserts[1]?.params[1]).toBe(1);
  });

  it('MIGRATION_11_12 guards the bookmarked column via PRAGMA table_info', async () => {
    // column already present -> no ALTER
    const has = recorder({ comic_chapter_read: [{ cid: 8, name: 'bookmarked', type: 'INTEGER', notnull: 1 }] });
    await MIGRATION_11_12.migrate(has.db);
    expect(has.sql.some((s) => s.includes('ADD COLUMN `bookmarked`'))).toBe(false);
    expect(has.sql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS `god_moments`'))).toBe(true);
    expect(has.sql.filter((s) => s.includes('CREATE') && !s.startsWith('CREATE TABLE'))).toHaveLength(3);
    expect(has.sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS `index_god_moments_bookId_chapterId` ON `god_moments` (`bookId`, `chapterId`)');

    // column missing -> ALTER with DEFAULT 0
    const missing = recorder({ comic_chapter_read: [{ cid: 7, name: 'updatedAt', type: 'INTEGER', notnull: 1 }] });
    await MIGRATION_11_12.migrate(missing.db);
    expect(missing.sql).toContain(
      'ALTER TABLE `comic_chapter_read` ADD COLUMN `bookmarked` INTEGER NOT NULL DEFAULT 0',
    );
  });
});

describe('AniListDao (AppDatabase.kt 176..239)', () => {
  function fakeDb(): DatabaseLike & {
    sql: Array<{ sql: string; params?: unknown[] | undefined }>;
    failOn?: string;
  } {
    const sql: Array<{ sql: string; params?: unknown[] | undefined }> = [];
    const db: DatabaseLike & {
      sql: Array<{ sql: string; params?: unknown[] | undefined }>;
      failOn?: string;
    } = {
      sql,
      async execute(stmt, params) {
        sql.push({ sql: stmt, params: params as unknown[] | undefined });
        if (db.failOn !== undefined && stmt.includes(db.failOn)) {
          throw new Error(`injected failure for: ${db.failOn}`);
        }
        return { rowsAffected: 1, lastInsertRowId: 1 };
      },
      async query<T>(stmt: string, params?: unknown[]): Promise<T[]> {
        sql.push({ sql: stmt, params });
        return [] as T[];
      },
    };
    return db;
  }

  it('findMediaIds keeps LIMIT 64 and the normalized/compact OR', async () => {
    const db = fakeDb();
    await new AniListDao(db).findMediaIds('n', 'c');
    expect(db.sql[0]?.sql).toBe(
      'SELECT DISTINCT mediaId FROM anilist_titles ' +
        'WHERE normalizedTitle = ? OR compactTitle = ? LIMIT 64',
    );
    expect(db.sql[0]?.params).toEqual(['n', 'c']);
  });

  it('findMediaIdsContaining keeps both ESCAPE clauses and the caller limit', async () => {
    const db = fakeDb();
    await new AniListDao(db).findMediaIdsContaining('a', 'b', 7);
    const stmt = db.sql[0]?.sql ?? '';
    expect(stmt).toContain("normalizedTitle LIKE '%' || ? || '%' ESCAPE '\\'");
    expect(stmt).toContain("OR compactTitle LIKE '%' || ? || '%' ESCAPE '\\'");
    expect(stmt).toContain('LIMIT ?');
    expect(db.sql[0]?.params).toEqual(['a', 'b', 7]);
  });

  it('getRawTitlesFor preserves the NATIVE < ENGLISH < ROMAJI < SYNONYM ordering', async () => {
    const db = fakeDb();
    await new AniListDao(db).getRawTitlesFor([1, 2]);
    const stmt = db.sql[0]?.sql ?? '';
    expect(stmt).toContain('ORDER BY mediaId ASC, CASE titleType');
    expect(stmt.indexOf("'NATIVE' THEN 0")).toBeLessThan(stmt.indexOf("'ENGLISH' THEN 1"));
    expect(stmt.indexOf("'ENGLISH' THEN 1")).toBeLessThan(stmt.indexOf("'ROMAJI' THEN 2"));
    expect(stmt.indexOf("'ROMAJI' THEN 2")).toBeLessThan(stmt.indexOf("'SYNONYM' THEN 3"));
    expect(stmt).toContain('ELSE 4 END');
    expect(db.sql[0]?.params).toEqual([1, 2]);
  });

  it('short-circuits empty IN lists instead of emitting IN ()', async () => {
    const db = fakeDb();
    const dao = new AniListDao(db);
    expect(await dao.getRawTitlesFor([])).toEqual([]);
    expect(await dao.getTitleRowsFor([])).toEqual([]);
    expect(db.sql).toHaveLength(0);
  });

  it('insertTitles uses INSERT OR IGNORE inside one transaction (Room wraps List inserts)', async () => {
    const db = fakeDb();
    await new AniListDao(db).insertTitles([
      { mediaId: 5, titleType: 'NATIVE', rawTitle: 'x', normalizedTitle: 'x', compactTitle: 'x' },
    ]);
    // Room executes a `List` @Insert inside a transaction; the DAO reproduces that so a
    // mid-batch failure cannot leave a partial import behind.
    expect(db.sql.map((s) => s.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT OR IGNORE INTO anilist_titles'),
      'COMMIT',
    ]);
    expect(db.sql[1]?.sql).toContain('("mediaId", "titleType", "rawTitle", "normalizedTitle", "compactTitle")');
    expect(db.sql[1]?.params).toEqual([5, 'NATIVE', 'x', 'x', 'x']);
  });

  it('insertTitles rolls the whole batch back when a row fails', async () => {
    const db = fakeDb();
    db.failOn = 'INSERT OR IGNORE INTO anilist_titles';
    await expect(
      new AniListDao(db).insertTitles([
        { mediaId: 1, titleType: 'NATIVE', rawTitle: 'a', normalizedTitle: 'a', compactTitle: 'a' },
      ]),
    ).rejects.toThrow();
    expect(db.sql.map((s) => s.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT OR IGNORE INTO anilist_titles'),
      'ROLLBACK',
    ]);
  });

  it('insertTitles on an empty list issues no statement at all', async () => {
    const db = fakeDb();
    await new AniListDao(db).insertTitles([]);
    expect(db.sql).toHaveLength(0);
  });

  it('countTitles / clearTitles use the Android statements', async () => {
    const db = fakeDb();
    const dao = new AniListDao(db);
    expect(await dao.countTitles()).toBe(0);
    expect(db.sql[0]?.sql).toBe('SELECT COUNT(*) AS c FROM anilist_titles');
    await dao.clearTitles();
    expect(db.sql[1]?.sql).toBe('DELETE FROM anilist_titles');
  });
});

/** Type-only helper so `LegacyMigrationDb` is exercised for assignability. */
export type _LegacyDbShape = LegacyMigrationDb;

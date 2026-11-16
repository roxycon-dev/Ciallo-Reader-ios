/**
 * Column-by-column parity between `src/core/db/schemaV12.ts` and the authoritative
 * Room export `novel-reader/app/schemas/com.example.data.AppDatabase/12.json`.
 *
 * The expected shape below is transcribed **per column** from that file: table order,
 * then for every table the `fields[]` order with `columnName` / `affinity` / `notNull`,
 * plus `primaryKey.columnNames` (+ `autoGenerate`) and the `indices[]` entries
 * (`name` / `unique` / `columnNames`). Nothing here is inferred from the Kotlin
 * entities — 12.json is what Room itself wrote.
 *
 * This is deliberately a *transcription*, not a re-derivation: if someone edits
 * `TABLES` in `schemaV12.ts` and the two drift, this test fails.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLES,
  ROOM_IDENTITY_HASH,
  ROOM_SCHEMA_VERSION,
  TABLES,
  createIndexSql,
  createTableSql,
  type TableDef,
} from '../../src/core/db/schemaV12';

type Affinity = 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB';

interface ExpectedColumn {
  name: string;
  affinity: Affinity;
  notNull: boolean;
}

interface ExpectedIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
  primaryKey: string[];
  autoGenerate: boolean;
  indices: ExpectedIndex[];
}

/** Transcribed from 12.json `database.entities[]`, in file order. */
const ROOM_V12: ExpectedTable[] = [
  {
    name: 'books',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'author', affinity: 'TEXT', notNull: true },
      { name: 'filePath', affinity: 'TEXT', notNull: true },
      { name: 'coverUri', affinity: 'TEXT', notNull: false },
      { name: 'category', affinity: 'TEXT', notNull: true },
      { name: 'currentChapterIndex', affinity: 'INTEGER', notNull: true },
      { name: 'scrollOffset', affinity: 'INTEGER', notNull: true },
      { name: 'isFinished', affinity: 'INTEGER', notNull: true },
      { name: 'totalChapters', affinity: 'INTEGER', notNull: true },
      { name: 'contentType', affinity: 'TEXT', notNull: true },
      { name: 'addedTime', affinity: 'INTEGER', notNull: true },
      { name: 'lastReadTime', affinity: 'INTEGER', notNull: true },
      { name: 'sourceId', affinity: 'TEXT', notNull: false },
      { name: 'comicId', affinity: 'TEXT', notNull: false },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'chapters',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'bookId', affinity: 'INTEGER', notNull: true },
      { name: 'chapterOrder', affinity: 'INTEGER', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'content', affinity: 'TEXT', notNull: true },
      { name: 'startCharIndex', affinity: 'INTEGER', notNull: true },
      { name: 'endCharIndex', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'bookmarks',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'bookId', affinity: 'INTEGER', notNull: true },
      { name: 'chapterIndex', affinity: 'INTEGER', notNull: true },
      { name: 'scrollOffset', affinity: 'INTEGER', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'snippet', affinity: 'TEXT', notNull: true },
      { name: 'createdTime', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
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
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'bookId', affinity: 'INTEGER', notNull: true },
      { name: 'chapterIndex', affinity: 'INTEGER', notNull: true },
      { name: 'selectedText', affinity: 'TEXT', notNull: true },
      { name: 'note', affinity: 'TEXT', notNull: true },
      { name: 'colorHex', affinity: 'TEXT', notNull: true },
      { name: 'createdTime', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'categories',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'name', affinity: 'TEXT', notNull: true },
      { name: 'isProtected', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'reading_records',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'bookId', affinity: 'INTEGER', notNull: false },
      { name: 'bookTitle', affinity: 'TEXT', notNull: true },
      { name: 'dateStr', affinity: 'TEXT', notNull: true },
      { name: 'durationSeconds', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'reading_sessions',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'bookId', affinity: 'INTEGER', notNull: false },
      { name: 'bookTitle', affinity: 'TEXT', notNull: true },
      { name: 'dateStr', affinity: 'TEXT', notNull: true },
      { name: 'startTimeMs', affinity: 'INTEGER', notNull: true },
      { name: 'endTimeMs', affinity: 'INTEGER', notNull: true },
      { name: 'durationSeconds', affinity: 'INTEGER', notNull: true },
      { name: 'startHour', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
    indices: [],
  },
  {
    name: 'download_tasks',
    columns: [
      { name: 'id', affinity: 'TEXT', notNull: true },
      { name: 'sourceId', affinity: 'TEXT', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'author', affinity: 'TEXT', notNull: true },
      { name: 'coverUrl', affinity: 'TEXT', notNull: false },
      { name: 'downloadUrl', affinity: 'TEXT', notNull: true },
      { name: 'format', affinity: 'TEXT', notNull: true },
      { name: 'status', affinity: 'TEXT', notNull: true },
      { name: 'downloadedBytes', affinity: 'INTEGER', notNull: true },
      { name: 'totalBytes', affinity: 'INTEGER', notNull: true },
      { name: 'filePath', affinity: 'TEXT', notNull: true },
      { name: 'errorMessage', affinity: 'TEXT', notNull: false },
      { name: 'updatedAt', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: false,
    indices: [],
  },
  {
    name: 'anilist_titles',
    columns: [
      { name: 'rowId', affinity: 'INTEGER', notNull: true },
      { name: 'mediaId', affinity: 'INTEGER', notNull: true },
      { name: 'titleType', affinity: 'TEXT', notNull: true },
      { name: 'rawTitle', affinity: 'TEXT', notNull: true },
      { name: 'normalizedTitle', affinity: 'TEXT', notNull: true },
      { name: 'compactTitle', affinity: 'TEXT', notNull: true },
    ],
    primaryKey: ['rowId'],
    autoGenerate: true,
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
      { name: 'sourceId', affinity: 'TEXT', notNull: true },
      { name: 'comicId', affinity: 'TEXT', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'author', affinity: 'TEXT', notNull: true },
      { name: 'coverUrl', affinity: 'TEXT', notNull: false },
      { name: 'localThumbPath', affinity: 'TEXT', notNull: false },
      { name: 'serialStatus', affinity: 'TEXT', notNull: true },
      { name: 'latestChapterId', affinity: 'TEXT', notNull: false },
      { name: 'latestChapterTitle', affinity: 'TEXT', notNull: false },
      { name: 'latestChapterUpdateAt', affinity: 'INTEGER', notNull: true },
      { name: 'lastCheckedAt', affinity: 'INTEGER', notNull: true },
      { name: 'sourceAlive', affinity: 'INTEGER', notNull: true },
      { name: 'categoryName', affinity: 'TEXT', notNull: true },
      { name: 'favoritedAt', affinity: 'INTEGER', notNull: true },
      { name: 'sortOrder', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId'],
    autoGenerate: false,
    indices: [
      { name: 'index_favorites_categoryName', unique: false, columns: ['categoryName'] },
      { name: 'index_favorites_favoritedAt', unique: false, columns: ['favoritedAt'] },
      { name: 'index_favorites_lastCheckedAt', unique: false, columns: ['lastCheckedAt'] },
    ],
  },
  {
    name: 'comic_progress',
    columns: [
      { name: 'sourceId', affinity: 'TEXT', notNull: true },
      { name: 'comicId', affinity: 'TEXT', notNull: true },
      { name: 'lastChapterId', affinity: 'TEXT', notNull: false },
      { name: 'lastChapterIndex', affinity: 'INTEGER', notNull: true },
      { name: 'lastPageIndex', affinity: 'INTEGER', notNull: true },
      { name: 'lastPageCount', affinity: 'INTEGER', notNull: true },
      { name: 'lastReadAt', affinity: 'INTEGER', notNull: true },
      { name: 'seenTopChapterId', affinity: 'TEXT', notNull: false },
      { name: 'seenChapterCount', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId'],
    autoGenerate: false,
    indices: [{ name: 'index_comic_progress_lastReadAt', unique: false, columns: ['lastReadAt'] }],
  },
  {
    name: 'comic_chapter_read',
    columns: [
      { name: 'sourceId', affinity: 'TEXT', notNull: true },
      { name: 'comicId', affinity: 'TEXT', notNull: true },
      { name: 'chapterId', affinity: 'TEXT', notNull: true },
      { name: 'status', affinity: 'INTEGER', notNull: true },
      { name: 'pageIndex', affinity: 'INTEGER', notNull: true },
      { name: 'pageCount', affinity: 'INTEGER', notNull: true },
      { name: 'chapterIndex', affinity: 'INTEGER', notNull: true },
      { name: 'updatedAt', affinity: 'INTEGER', notNull: true },
      { name: 'bookmarked', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['sourceId', 'comicId', 'chapterId'],
    autoGenerate: false,
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
      { name: 'name', affinity: 'TEXT', notNull: true },
      { name: 'sortOrder', affinity: 'INTEGER', notNull: true },
      { name: 'createdAt', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['name'],
    autoGenerate: false,
    indices: [],
  },
  {
    name: 'god_moments',
    columns: [
      { name: 'id', affinity: 'INTEGER', notNull: true },
      { name: 'contentType', affinity: 'TEXT', notNull: true },
      { name: 'bookId', affinity: 'TEXT', notNull: true },
      { name: 'chapterId', affinity: 'TEXT', notNull: true },
      { name: 'bookTitle', affinity: 'TEXT', notNull: true },
      { name: 'chapterTitle', affinity: 'TEXT', notNull: true },
      { name: 'chapterNumber', affinity: 'INTEGER', notNull: true },
      { name: 'title', affinity: 'TEXT', notNull: true },
      { name: 'titleIsCustom', affinity: 'INTEGER', notNull: true },
      { name: 'rating', affinity: 'REAL', notNull: true },
      { name: 'note', affinity: 'TEXT', notNull: true },
      { name: 'coverPath', affinity: 'TEXT', notNull: false },
      { name: 'coverSource', affinity: 'TEXT', notNull: true },
      { name: 'cropParams', affinity: 'TEXT', notNull: true },
      { name: 'createdAt', affinity: 'INTEGER', notNull: true },
      { name: 'updatedAt', affinity: 'INTEGER', notNull: true },
    ],
    primaryKey: ['id'],
    autoGenerate: true,
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

describe('Room v12 schema ↔ schemaV12.ts column-by-column parity', () => {
  it('declares exactly the 14 entities of 12.json, in the same order', () => {
    expect(TABLES).toHaveLength(14);
    expect(TABLES.map((t) => t.name)).toEqual(ROOM_V12.map((t) => t.name));
  });

  it('keeps version 12 and identityHash 4edcea8e99eeed709b4f4497a5cc18a0', () => {
    expect(ROOM_SCHEMA_VERSION).toBe(12);
    expect(ROOM_IDENTITY_HASH).toBe('4edcea8e99eeed709b4f4497a5cc18a0');
  });

  for (const expected of ROOM_V12) {
    describe(expected.name, () => {
      const actual = TABLES.find((t) => t.name === expected.name) as TableDef | undefined;

      it('every column matches on name / type / notNull, in 12.json order', () => {
        expect(actual).toBeDefined();
        if (!actual) return;
        expect(
          actual.columns.map((c) => ({
            name: c.name,
            affinity: c.type,
            notNull: c.notNull === true,
          })),
        ).toEqual(expected.columns);
      });

      it('matches primaryKey columns and autoGenerate', () => {
        expect(actual?.primaryKey).toEqual(expected.primaryKey);
        expect(actual?.autoGeneratePk).toBe(expected.autoGenerate);
        const pkCols = (actual?.columns ?? []).filter((c) => c.primaryKey).map((c) => c.name);
        expect(pkCols).toEqual(expected.primaryKey);
      });

      it('matches every index on name / unique / column list', () => {
        expect(actual?.indices).toEqual(expected.indices);
      });
    });
  }

  it('emits DDL whose column set is exactly the declared column set', () => {
    for (const table of TABLES) {
      const sql = createTableSql(table);
      for (const col of table.columns) {
        expect(sql).toContain(`"${col.name}"`);
      }
      // Every identifier in the statement is either the table itself or one of its
      // declared columns — the generator never invents a column.
      const identifiers = new Set([...sql.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string));
      identifiers.delete(table.name);
      const declared = new Set(table.columns.map((c) => c.name));
      for (const name of identifiers) {
        expect(declared.has(name), `${table.name} DDL has unexpected identifier ${name}`).toBe(true);
      }
      expect(identifiers).toEqual(declared);
    }
  });

  it('marks every NOT NULL column in the DDL and leaves nullable ones bare', () => {
    for (const table of TABLES) {
      const sql = createTableSql(table);
      for (const col of table.columns) {
        const decl = new RegExp(`"${col.name}" ${col.type}([^,)]*)`).exec(sql);
        expect(decl, `${table.name}.${col.name} missing from DDL`).not.toBeNull();
        const rest = decl?.[1] ?? '';
        if (col.notNull) {
          expect(rest).toContain('NOT NULL');
        } else {
          expect(rest).not.toContain('NOT NULL');
        }
      }
    }
  });

  it('uses a table-level PK for every composite key and an inline one otherwise', () => {
    const composite = TABLES.filter((t) => t.primaryKey.length > 1);
    expect(composite.map((t) => t.name)).toEqual([
      'favorites',
      'comic_progress',
      'comic_chapter_read',
    ]);
    for (const table of TABLES) {
      const sql = createTableSql(table);
      // Room's createSql spells it `PRIMARY KEY(\`a\`, \`b\`)` — no space, no quotes
      // beyond the identifiers — and the generator matches it byte for byte.
      const tableLevel = /PRIMARY KEY\(([^)]*)\)/.exec(sql);
      if (table.primaryKey.length > 1) {
        expect(tableLevel?.[1]).toBe(table.primaryKey.map((c) => `"${c}"`).join(', '));
      } else if (table.autoGeneratePk) {
        // `INTEGER PRIMARY KEY AUTOINCREMENT` must be a column constraint, spelled in
        // Room's own constraint order (12.json `createSql`).
        expect(tableLevel).toBeNull();
        expect(sql).toContain(
          `"${table.primaryKey[0] as string}" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`,
        );
      } else {
        expect(tableLevel?.[1]).toBe(`"${table.primaryKey[0] as string}"`);
      }
    }
  });

  it('emits index DDL matching Room createSql, unique flags included', () => {
    expect(TABLES.flatMap((t) => t.indices.map((i) => createIndexSql(t, i)))).toEqual([
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_bookmarks_bookId_chapterIndex" ON "bookmarks" ("bookId", "chapterIndex")',
      'CREATE INDEX IF NOT EXISTS "index_anilist_titles_normalizedTitle" ON "anilist_titles" ("normalizedTitle")',
      'CREATE INDEX IF NOT EXISTS "index_anilist_titles_compactTitle" ON "anilist_titles" ("compactTitle")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_anilist_titles_mediaId_titleType_rawTitle" ON "anilist_titles" ("mediaId", "titleType", "rawTitle")',
      'CREATE INDEX IF NOT EXISTS "index_favorites_categoryName" ON "favorites" ("categoryName")',
      'CREATE INDEX IF NOT EXISTS "index_favorites_favoritedAt" ON "favorites" ("favoritedAt")',
      'CREATE INDEX IF NOT EXISTS "index_favorites_lastCheckedAt" ON "favorites" ("lastCheckedAt")',
      'CREATE INDEX IF NOT EXISTS "index_comic_progress_lastReadAt" ON "comic_progress" ("lastReadAt")',
      'CREATE INDEX IF NOT EXISTS "index_comic_chapter_read_sourceId_comicId" ON "comic_chapter_read" ("sourceId", "comicId")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_god_moments_bookId_chapterId" ON "god_moments" ("bookId", "chapterId")',
      'CREATE INDEX IF NOT EXISTS "index_god_moments_rating" ON "god_moments" ("rating")',
      'CREATE INDEX IF NOT EXISTS "index_god_moments_createdAt" ON "god_moments" ("createdAt")',
    ]);
  });

  it('backs up 12 tables — download_tasks and anilist_titles excluded, in Room order', () => {
    expect(BACKUP_TABLES).toHaveLength(12);
    expect(BACKUP_TABLES).toEqual([
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
    ]);
    const missing = TABLES.map((t) => t.name).filter((n) => !BACKUP_TABLES.includes(n));
    expect(missing).toEqual(['download_tasks', 'anilist_titles']);
  });

  it('has no foreign keys anywhere, matching 12.json `foreignKeys: []`', () => {
    // There is no FK field on TableDef at all; assert the DDL cannot express one.
    for (const table of TABLES) {
      expect(createTableSql(table)).not.toMatch(/FOREIGN KEY|REFERENCES/i);
      expect(Object.keys(table)).not.toContain('foreignKeys');
    }
  });
});
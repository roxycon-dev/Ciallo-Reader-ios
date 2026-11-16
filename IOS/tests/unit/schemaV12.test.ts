import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLES,
  ROOM_IDENTITY_HASH,
  ROOM_SCHEMA_VERSION,
  TABLES,
  createIndexSql,
  createTableSql,
} from '../../src/core/db/schemaV12';

describe('Room v12 schema extraction', () => {
  it('has 14 tables and identityHash from Android 12.json', () => {
    expect(TABLES).toHaveLength(14);
    expect(ROOM_SCHEMA_VERSION).toBe(12);
    expect(ROOM_IDENTITY_HASH).toBe('4edcea8e99eeed709b4f4497a5cc18a0');
  });

  it('excludes download_tasks and anilist_titles from backup', () => {
    expect(BACKUP_TABLES).toHaveLength(12);
    expect(BACKUP_TABLES).not.toContain('download_tasks');
    expect(BACKUP_TABLES).not.toContain('anilist_titles');
  });

  it('generates CREATE TABLE with a table-level composite PK for favorites', () => {
    const favorites = TABLES.find((t) => t.name === 'favorites');
    expect(favorites).toBeDefined();
    if (!favorites) return;
    const sql = createTableSql(favorites);
    // Two inline `PRIMARY KEY` clauses are a syntax error in real SQLite
    // ("table \"favorites\" has more than one primary key"); Room emits one
    // table-level constraint, so we must too — spelled exactly as Room's
    // 12.json createSql spells it (`PRIMARY KEY(\`a\`, \`b\`)`, no space).
    expect(sql).toContain('PRIMARY KEY("sourceId", "comicId")');
    expect(sql).not.toMatch(/"sourceId" TEXT[^,]*PRIMARY KEY/);
    expect(sql).toContain('"sourceId" TEXT NOT NULL');
    expect(sql).toContain('"comicId" TEXT NOT NULL');
  });

  it('generates unique bookmark index', () => {
    const bookmarks = TABLES.find((t) => t.name === 'bookmarks');
    expect(bookmarks).toBeDefined();
    if (!bookmarks) return;
    const idx = bookmarks.indices[0];
    expect(idx).toBeDefined();
    if (!idx) return;
    expect(createIndexSql(bookmarks, idx)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "index_bookmarks_bookId_chapterIndex" ON "bookmarks" ("bookId", "chapterIndex")',
    );
  });

  it('god_moments has unique (bookId, chapterId)', () => {
    const god = TABLES.find((t) => t.name === 'god_moments');
    expect(god).toBeDefined();
    if (!god) return;
    const unique = god.indices.filter((i) => i.unique);
    expect(unique.map((i) => i.columns.join(','))).toContain('bookId,chapterId');
  });
});

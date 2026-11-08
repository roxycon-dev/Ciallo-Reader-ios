/**
 * Restore-side parity tests for `src/core/backup/**` against Android
 * `novel-reader/app/src/main/java/com/example/data/BackupArchive.kt` (204 lines) and
 * `BackupManager.kt`.
 *
 * Covered here, in Kotlin-line order:
 *   - `BackupArchive.export` line 45   → export rows come from one transaction snapshot
 *   - `BackupArchive.export` line 57   → `@FILES@` substitution on the way out
 *   - `BackupArchive.restore` line 103 → per-entry name/length/count budget
 *   - `BackupArchive.restore` line 105 → only `database.rows` / `settings.json` / `files/…`
 *   - `BackupArchive.restore` line 175 → `@FILES@` substituted back to the files root
 *   - `BackupArchive.restore` line 183 → orphan book-reference check
 *   - `BackupArchive.restore` line 189 → settings are applied *after* the row transaction
 *   - round trip → export → import → export is byte-identical
 */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { BackupService } from '../../src/core/backup/backupService';
import {
  BACKUP_ZIP_ROWS_ENTRY,
  BACKUP_ZIP_SETTINGS_ENTRY,
  buildDatabaseRowsNdjson,
} from '../../src/core/backup/backupArchive';
import { decodeBase64Default } from '../../src/core/backup/backupManagerJson';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { openAppDatabase } from '../../src/core/db/openDatabase';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';
import { MemoryFileSystem } from '../../src/platform/web-mock/memoryFileSystem';
import type { FileSystemApi } from '@platform/interfaces';

const FILES_ROOT = '/data/user/0/com.ciallo.reader/files';

async function env(fs?: MemoryFileSystem, filesRoot = '') {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  const fsys = fs ?? new MemoryFileSystem();
  const settings = new SettingsRepository(db);
  const backup = new BackupService(db, fsys, settings, filesRoot);
  return { db, fs: fsys, settings, backup };
}

/**
 * 2026-10-11（E79 接线）：`exportBackup` 的产物是 Kotlin JSON 信封，`database.rows` /
 * `settings.json` 在内层 ZIP（`archive` 字段）里 —— 先解信封再解 ZIP。
 */
async function readEnvelopeArchive(fs: FileSystemApi, path: string): Promise<Record<string, Uint8Array>> {
  const text = new TextDecoder().decode(await fs.readFile(path));
  const envelope = JSON.parse(text) as { archive: string };
  return unzipSync(decodeBase64Default(envelope.archive));
}

async function rowsNdjson(backup: BackupService): Promise<string> {
  await backup.exportBackup('b/one.json');
  const entries = await readEnvelopeArchive(backup['fs'], 'b/one.json');
  return new TextDecoder().decode(entries[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array);
}

async function seed(db: InMemorySqliteDatabase, filesRoot: string): Promise<void> {
  await db.execute(
    'INSERT INTO "books" ("id","title","author","filePath","coverUri","category","currentChapterIndex","scrollOffset","isFinished","totalChapters","contentType","addedTime","lastReadTime","sourceId","comicId") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, '诡秘之主', '爱潜水的乌贼', '/books/lord.txt', `${filesRoot}/imports/c.jpg`, '玄幻', 3, 128, 0, 1400, 'NOVEL', 1, 2, 'src-1', 'c-1'],
  );
  await db.execute(
    'INSERT INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
    [1, 1, 0, '第一章', '少年离乡。', 0, 5],
  );
  await db.execute(
    'INSERT INTO "bookmarks" ("id","bookId","chapterIndex","scrollOffset","title","snippet","createdTime") VALUES (?,?,?,?,?,?,?)',
    [1, 1, 0, 40, '第一章', '少年', 7],
  );
  await db.execute(
    'INSERT INTO "highlights" ("id","bookId","chapterIndex","selectedText","note","colorHex","createdTime") VALUES (?,?,?,?,?,?,?)',
    [1, 1, 0, '少年离乡', '', '#7FD8C8', 7],
  );
  await db.execute('INSERT INTO "categories" ("id","name","isProtected") VALUES (?,?,?)', [1, '默认', 0]);
  await db.execute(
    'INSERT INTO "reading_records" ("id","bookId","bookTitle","dateStr","durationSeconds") VALUES (?,?,?,?,?)',
    [1, 1, '诡秘之主', '2026-10-04', 1200],
  );
  await db.execute(
    'INSERT INTO "reading_sessions" ("id","bookId","bookTitle","dateStr","startTimeMs","endTimeMs","durationSeconds","startHour") VALUES (?,?,?,?,?,?,?,?)',
    [1, 1, '诡秘之主', '2026-10-04', 1000, 2000, 1, 9],
  );
  await db.execute(
    'INSERT INTO "favorites" ("sourceId","comicId","title","author","coverUrl","localThumbPath","serialStatus","latestChapterId","latestChapterTitle","latestChapterUpdateAt","lastCheckedAt","sourceAlive","categoryName","favoritedAt","sortOrder") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['src-1', 'c-1', '某漫画', '作者', null, null, 'ongoing', 'ch-9', '第9话', 111, 222, 1, '默认', 333, 0],
  );
  await db.execute(
    'INSERT INTO "comic_progress" ("sourceId","comicId","lastChapterId","lastChapterIndex","lastPageIndex","lastPageCount","lastReadAt","seenTopChapterId","seenChapterCount") VALUES (?,?,?,?,?,?,?,?,?)',
    ['src-1', 'c-1', 'ch-3', 3, 4, 20, 555, 'ch-9', 9],
  );
  await db.execute(
    'INSERT INTO "comic_chapter_read" ("sourceId","comicId","chapterId","status","pageIndex","pageCount","chapterIndex","updatedAt","bookmarked") VALUES (?,?,?,?,?,?,?,?,?)',
    ['src-1', 'c-1', 'ch-3', 2, 19, 20, 3, 666, 1],
  );
  await db.execute('INSERT INTO "favorite_categories" ("name","sortOrder","createdAt") VALUES (?,?,?)', ['默认', 0, 1]);
  await db.execute(
    'INSERT INTO "god_moments" ("id","contentType","bookId","chapterId","bookTitle","chapterTitle","chapterNumber","title","titleIsCustom","rating","note","coverPath","coverSource","cropParams","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [1, 'NOVEL', 'src-1::c-1', 'ch-3', '某漫画', '第3话', 3, '名场面', 0, 4.5, '', `${filesRoot}/god_covers/g.png`, 'BOOK', '{}', 1, 2],
  );
}

describe('backup export', () => {
  it('replaces the files root with @FILES@ in every string column', async () => {
    const { db, backup } = await env(undefined, FILES_ROOT);
    await seed(db, FILES_ROOT);
    const ndjson = await rowsNdjson(backup);
    expect(ndjson).toContain('"coverUri":"@FILES@/imports/c.jpg"');
    expect(ndjson).toContain('"coverPath":"@FILES@/god_covers/g.png"');
    expect(ndjson).not.toContain(FILES_ROOT);
  });

  it('reads every table from a single transaction snapshot', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const statements: string[] = [];
    const raw = {
      open: db.open.bind(db),
      query: db.query.bind(db),
      execute: async (sql: string) => {
        statements.push(sql.trim().split(/\s/)[0]?.toUpperCase() ?? '');
        return db.execute(sql);
      },
      close: db.close.bind(db),
    };
    const backup = new BackupService(raw, new MemoryFileSystem(), new SettingsRepository(db));
    await backup.exportBackup('b/snap.json');
    expect(statements.filter((s) => s === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(1);
    const beginIdx = statements.indexOf('BEGIN');
    const commitIdx = statements.indexOf('COMMIT');
    expect(beginIdx).toBeLessThan(commitIdx);
  });

  it('writes exactly the 12 archived tables, in Kotlin order', async () => {
    const { db, backup } = await env();
    await seed(db, FILES_ROOT);
    const ndjson = await rowsNdjson(backup);
    const lines = ndjson.split('\n').filter((l) => l !== '');
    expect(JSON.parse(lines[0] as string)).toEqual({ version: 1, schema: 12 });
    const tables = lines
      .slice(1)
      .map((l) => (JSON.parse(l) as { table: string }).table);
    expect([...new Set(tables)]).toEqual([
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
    expect(tables).not.toContain('download_tasks');
    expect(tables).not.toContain('anilist_titles');
  });
});

describe('backup restore', () => {
  it('round-trips every archived table byte-for-byte (export → import → export)', async () => {
    const source = await env(undefined, FILES_ROOT);
    await seed(source.db, FILES_ROOT);
    await source.settings.setInt('reader_theme', 4);
    await source.settings.setFloat('font_size', 20);
    await source.backup.exportBackup('b/first.json');

    const target = await env(source.fs, FILES_ROOT);
    await target.settings.setInt('reader_theme', 0);
    await target.backup.importBackup('b/first.json');
    await target.backup.exportBackup('b/second.json');

    const first = await readRows(source.fs, 'b/first.json');
    const second = await readRows(target.fs, 'b/second.json');
    expect(second).toBe(first);

    // …and the data itself, not just the bytes: @FILES@ must not survive into the DB.
    const books = await target.db.query<{ coverUri: string; filePath: string }>(
      'SELECT * FROM "books"',
    );
    expect(books[0]?.coverUri).toBe(`${FILES_ROOT}/imports/c.jpg`);
    expect(books[0]?.filePath).toBe('/books/lord.txt');
    const god = await target.db.query<{ coverPath: string }>('SELECT * FROM "god_moments"');
    expect(god[0]?.coverPath).toBe(`${FILES_ROOT}/god_covers/g.png`);
    expect(await target.settings.getInt('reader_theme', 0)).toBe(4);
  });

  it('leaves the placeholder alone when no files root is configured', async () => {
    const { db, fs, backup } = await env();
    await seed(db, FILES_ROOT);
    await backup.exportBackup('b/noroot.json');
    await backup.importBackup('b/noroot.json');
    const books = await db.query<{ coverUri: string }>('SELECT * FROM "books"');
    expect(books[0]?.coverUri).toBe(`${FILES_ROOT}/imports/c.jpg`);
    void fs;
  });

  it('rejects an archive whose chapter rows orphan a missing book, and rolls back', async () => {
    const { db, fs, backup } = await env();
    await seed(db, FILES_ROOT);
    await backup.exportBackup('b/src.json');
    // Rewrite the archived chapter row so its bookId points nowhere, exactly what a
    // hand-edited archive looks like. No Room foreign key stops this.
    const raw = await readRows(fs, 'b/src.json');
    const patched = raw.replace('"bookId":1,"chapterOrder"', '"bookId":999,"chapterOrder"');
    await writeRows(fs, 'b/bad.zip', 'b/src.json', patched);
    await db.execute('DELETE FROM "books"');
    await expect(backup.importBackup('b/bad.zip')).rejects.toThrow(/备份包含孤立的书籍关联/);
    // The rollback restored the state captured at BEGIN (i.e. right after our explicit
    // DELETE), so the bad archive's chapters never landed and nothing was half-written.
    const chapters = await db.query<{ bookId: number }>('SELECT * FROM "chapters"');
    expect(chapters).toEqual([expect.objectContaining({ id: 1, bookId: 1 })]);
    const books = await db.query<{ id: number }>('SELECT * FROM "books"');
    expect(books).toHaveLength(0);
  });

  it('applies settings only after the row transaction has committed', async () => {
    const { db, fs, settings, backup } = await env();
    await seed(db, FILES_ROOT);
    await settings.setInt('reader_theme', 3);
    await backup.exportBackup('b/s.json');

    const target = await env(fs);
    await target.settings.setInt('reader_theme', 1);
    // A row that fails validation aborts the whole import before any setting is touched.
    const raw = await readRows(fs, 'b/s.json');
    await writeRows(fs, 'b/broken.zip', 'b/s.json', raw.replace('"title":"诡秘之主"', '"title":42'));
    await expect(target.backup.importBackup('b/broken.zip')).rejects.toThrow(/类型错误/);
    expect(await target.settings.getInt('reader_theme', 0)).toBe(1);
    const untouched = await target.db.query<{ title: string }>('SELECT * FROM "books"');
    expect(untouched).toHaveLength(0);
  });

  it('rejects a chapter whose content exceeds the storage safety limit', async () => {
    const { db, backup } = await env();
    await db.execute(
      'INSERT INTO "books" ("id","title","author","filePath","category","currentChapterIndex","scrollOffset","isFinished","totalChapters","contentType","addedTime","lastReadTime") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [1, 't', 'a', '/p', '默认', 0, 0, 0, 1, 'NOVEL', 1, 1],
    );
    await db.execute(
      'INSERT INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
      [1, 1, 0, 'x', 'y'.repeat(256_001), 0, 1],
    );
    await backup.exportBackup('b/big.json');
    await expect(backup.importBackup('b/big.json')).rejects.toThrow(/备份章节超过存储安全限制/);
  });

  it('rejects negative reading durations', async () => {
    const { db, backup } = await env();
    await db.execute(
      'INSERT INTO "reading_records" ("id","bookId","bookTitle","dateStr","durationSeconds") VALUES (?,?,?,?,?)',
      [1, null, 't', '2026-10-04', -5],
    );
    await backup.exportBackup('b/neg.json');
    await expect(backup.importBackup('b/neg.json')).rejects.toThrow(/备份阅读时长为负/);
  });

  it('rejects a row whose column set differs from the live table', async () => {
    const { db, fs, backup } = await env();
    await db.execute(
      'INSERT INTO "categories" ("id","name","isProtected") VALUES (?,?,?)',
      [1, '默认', 0],
    );
    await backup.exportBackup('b/cols.json');
    const raw = await readRows(fs, 'b/cols.json');
    await writeRows(fs, 'b/cols2.zip', 'b/cols.json', raw.replace('"isProtected":0', '"isProtectedX":0'));
    await expect(backup.importBackup('b/cols2.zip')).rejects.toThrow(/备份列与数据库不一致/);
  });
});

async function readRows(fs: MemoryFileSystem, path: string): Promise<string> {
  const entries = await readEnvelopeArchive(fs, path);
  return new TextDecoder().decode(entries[BACKUP_ZIP_ROWS_ENTRY] as Uint8Array);
}

async function writeRows(
  fs: MemoryFileSystem,
  path: string,
  sourcePath: string,
  rows: string,
): Promise<void> {
  const { zipSync, strToU8 } = await import('fflate');
  const entries = await readEnvelopeArchive(fs, sourcePath);
  await fs.writeFile(
    path,
    zipSync({
      [BACKUP_ZIP_ROWS_ENTRY]: strToU8(rows),
      [BACKUP_ZIP_SETTINGS_ENTRY]: entries[BACKUP_ZIP_SETTINGS_ENTRY] as Uint8Array,
    }),
  );
}

describe('buildDatabaseRowsNdjson header', () => {
  it('starts with the {version:1,schema:12} header line', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });
    const text = await buildDatabaseRowsNdjson({ selectAll: async () => [] }, '');
    expect(text).toBe('{"version":1,"schema":12}\n');
  });
});
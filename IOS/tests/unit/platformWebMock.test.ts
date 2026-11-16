import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '@core/db/openDatabase';
import { createTableSql, TABLES } from '@core/db/schemaV12';
import { FetchHttpClient } from '@platform/web-mock/fetchHttpClient';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import { createWebMockPlatform } from '@platform/web-mock';

/** Schema-v12 instance of the mock DB, as `openAppDatabase` builds it. */
async function openDb(): Promise<InMemorySqliteDatabase> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return db;
}

describe('web-mock platform', () => {
  it('opens schema v12, inserts a book row, selects it back', async () => {
    const db = new InMemorySqliteDatabase();
    await openAppDatabase({ db });

    await db.execute(
      'INSERT INTO "books" ("title", "author", "contentType", "addedTime") VALUES (?, ?, ?, ?)',
      ['Test Book', 'Author A', 'txt', 1_700_000_000_000],
    );

    const rows = await db.query<{ id: number; title: string; author: string; contentType: string; addedTime: number }>(
      'SELECT * FROM "books"',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Test Book');
    expect(rows[0]?.author).toBe('Author A');
    expect(rows[0]?.contentType).toBe('txt');
    expect(rows[0]?.addedTime).toBe(1_700_000_000_000);
    expect(rows[0]?.id).toBe(1);

    const countRows = await db.query<{ count: number }>('SELECT COUNT(*) FROM "books"');
    expect(countRows[0]?.count).toBe(1);

    const byTitle = await db.query<{ title: string }>('SELECT * FROM "books" WHERE "title" = ?', ['Test Book']);
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.title).toBe('Test Book');

    const pragmaRows = await db.query<{ name: string; pk: number }>('PRAGMA table_info("books")');
    expect(pragmaRows.length).toBeGreaterThan(0);
    expect(pragmaRows.some((r) => r.name === 'title')).toBe(true);
  });

  it('createTableSql for favorites uses one table-level composite PK', () => {
    const favorites = TABLES.find((t) => t.name === 'favorites');
    expect(favorites).toBeDefined();
    if (!favorites) return;
    const sql = createTableSql(favorites);
    // Room's 12.json createSql spells the table constraint `PRIMARY KEY(\`a\`, \`b\`)`
    // (no space), and the generated DDL is byte-identical to it modulo quoting.
    expect(sql).toContain('PRIMARY KEY("sourceId", "comicId")');
    expect(sql).toContain('"sourceId" TEXT NOT NULL');
    expect(sql).toContain('"comicId" TEXT NOT NULL');
  });

  it('honours INSERT OR IGNORE / OR REPLACE like SQLite does', async () => {
    const db = await openDb();
    const insert = (title: string) =>
      db.execute(
        'INSERT OR REPLACE INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
        [1, 1, 0, title, 'x', 0, 1],
      );
    await insert('a');
    // REPLACE deletes the conflicting row then inserts.
    await insert('b');
    const afterReplace = await db.query<{ title: string }>('SELECT * FROM "chapters"');
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]?.title).toBe('b');

    // IGNORE skips silently, leaving the existing row untouched.
    await db.execute(
      'INSERT OR IGNORE INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
      [1, 1, 0, 'c', 'z', 0, 1],
    );
    const afterIgnore = await db.query<{ title: string }>('SELECT * FROM "chapters"');
    expect(afterIgnore).toHaveLength(1);
    expect(afterIgnore[0]?.title).toBe('b');

    // ABORT (a bare INSERT, SQLite's default strategy) still fails on a PK conflict.
    await expect(
      db.execute(
        'INSERT INTO "chapters" ("id","bookId","chapterOrder","title","content","startCharIndex","endCharIndex") VALUES (?,?,?,?,?,?,?)',
        [1, 1, 0, 'd', 'w', 0, 1],
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('fetchHttpClient can be constructed', () => {
    const http = new FetchHttpClient();
    expect(typeof http.request).toBe('function');
  });

  it('createWebMockPlatform returns all five services', () => {
    const platform = createWebMockPlatform();
    expect(platform.http).toBeInstanceOf(FetchHttpClient);
    expect(platform.db).toBeInstanceOf(InMemorySqliteDatabase);
    expect(platform.secure).toBeDefined();
    expect(platform.fs).toBeDefined();
    expect(platform.tts).toBeDefined();
  });

  /**
   * E67：端口完整性护栏。
   *
   * 之前每次补端口都靠「调用点恰好用到了」才发现漏装配 —— 漏一个不会编译失败
   * （`PlatformBundle` 的字段都是必需的，但只要**两个工厂都**漏了就不会报错）。
   * 这里改成正向断言：两套工厂必须给出**同一组**端口名，且两套工厂的键集合
   * 必须完全相等。任何一边漏装配 / 多装配都会在这里炸。
   */
  it('两套工厂装配的端口集合完全一致（E67 完整性护栏）', async () => {
    const { createIosNativePlatform } = await import('@platform/ios-native');
    const web = Object.keys(createWebMockPlatform()).sort();
    const ios = Object.keys(createIosNativePlatform()).sort();
    expect(web).toEqual(ios);

    // 显式列出当前应存在的端口，避免「两边一起漏」时测试仍然通过。
    expect(web).toEqual(
      [
        'appInfo',
        'appLifecycle',
        'clipboard',
        'db',
        'device',
        'documents',
        'externalBrowser',
        'fs',
        'haptics',
        'http',
        // E61：以下 5 个是 core 层去 DOM 后新增的端口。web-mock 与 ios-native
        // 都复用 `capabilities.ts` 的 Web 实现 —— WKWebView 里 matchMedia / Audio /
        // localStorage / canvas 全部原生可用，与浏览器同构，无需另写原生版。
        'keyValue',
        'keyboard',
        'media',
        'mediaQuery',
        'network',
        'offscreenBitmap',
        'orientationLock',
        'screenAwake',
        'secure',
        'shareText',
        'statusBars',
        'storageStats',
        'tts',
        'viewport',
      ].sort(),
    );
  });
});

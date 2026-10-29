import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '@core/db/openDatabase';
import { BookRepository, type DatabaseLike } from '@core/library/bookRepository';
import type { BookmarkRow, BookRow, DownloadTaskRow } from '@core/library/bookTypes';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';

interface Call {
  kind: 'execute' | 'query';
  sql: string;
  params: Array<string | number | null>;
}

function recordingDb(opts?: { lastInsertRowId?: number; queryResults?: unknown[][] }): {
  db: DatabaseLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const lastInsertRowId = opts?.lastInsertRowId ?? 1;
  const queryResults: unknown[][] = opts?.queryResults ?? [];
  const db: DatabaseLike = {
    execute(sql: string, params: Array<string | number | null> = []) {
      calls.push({ kind: 'execute', sql, params });
      return Promise.resolve({ rowsAffected: 1, lastInsertRowId });
    },
    query<T>(sql: string, params: Array<string | number | null> = []) {
      calls.push({ kind: 'query', sql, params });
      const next = queryResults.shift();
      return Promise.resolve((next ?? []) as T[]);
    },
  };
  return { db, calls };
}

async function openRepo(): Promise<BookRepository> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return new BookRepository(db);
}

const sampleBook: Omit<BookRow, 'id'> = {
  title: '诡秘之主',
  author: '爱潜水的乌贼',
  filePath: null,
  coverUri: 'https://img.test/cover.jpg',
  category: '玄幻',
  currentChapterIndex: 3,
  scrollOffset: 128,
  isFinished: 0,
  totalChapters: 1400,
  contentType: 'novel',
  addedTime: 1700000000000,
  lastReadTime: 1700000100000,
  sourceId: 'src-1',
  comicId: null,
};

describe('BookRepository', () => {
  it('insertBook uses parameterized SQL against books and returns row id', async () => {
    const mock = recordingDb({ lastInsertRowId: 42 });
    const repo = new BookRepository(mock.db);

    const id = await repo.insertBook(sampleBook);

    expect(id).toBe(42);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call?.kind).toBe('execute');
    expect(call?.sql).toContain('INSERT INTO books');
    expect(call?.sql).not.toMatch(/\d+/);
    expect((call?.sql.split('?').length ?? 1) - 1).toBe(14);
    expect(call?.params).toEqual([
      '诡秘之主',
      '爱潜水的乌贼',
      null,
      'https://img.test/cover.jpg',
      '玄幻',
      3,
      128,
      0,
      1400,
      'novel',
      1700000000000,
      1700000100000,
      'src-1',
      null,
    ]);
  });

  it('insertBook + listBooks round-trips through platform in-memory db', async () => {
    const repo = await openRepo();

    const id = await repo.insertBook(sampleBook);
    expect(id).toBe(1);

    const books = await repo.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: 1,
      title: '诡秘之主',
      author: '爱潜水的乌贼',
      currentChapterIndex: 3,
      scrollOffset: 128,
      totalChapters: 1400,
      contentType: 'novel',
      sourceId: 'src-1',
      comicId: null,
    });
  });

  it('upsertBookmark uses ON CONFLICT on (bookId, chapterIndex) with parameters', async () => {
    const mock = recordingDb();
    const repo = new BookRepository(mock.db);

    const bookmark: Omit<BookmarkRow, 'id'> = {
      bookId: 7,
      chapterIndex: 12,
      scrollOffset: 999,
      title: '第三章 卡文',
      snippet: '……他回头看了她一眼。',
      createdTime: 1700000200000,
    };
    await repo.upsertBookmark(bookmark);

    const call = mock.calls[0];
    expect(call?.kind).toBe('execute');
    expect(call?.sql).toContain('INSERT INTO bookmarks');
    expect(call?.sql).toContain('ON CONFLICT("bookId", "chapterIndex") DO UPDATE SET');
    expect(call?.sql).toContain('excluded."scrollOffset"');
    expect(call?.params).toEqual([
      7,
      12,
      999,
      '第三章 卡文',
      '……他回头看了她一眼。',
      1700000200000,
    ]);
  });

  it('upsertBookmark + listBookmarks round-trips and updates in place', async () => {
    const repo = await openRepo();

    await repo.upsertBookmark({
      bookId: 7,
      chapterIndex: 12,
      scrollOffset: 100,
      title: '第三章 卡文',
      snippet: '初版摘要',
      createdTime: 1700000200000,
    });
    await repo.upsertBookmark({
      bookId: 7,
      chapterIndex: 12,
      scrollOffset: 999,
      title: '第三章 卡文（改）',
      snippet: '更新摘要',
      createdTime: 1700000300000,
    });

    const list = await repo.listBookmarks(7);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      bookId: 7,
      chapterIndex: 12,
      scrollOffset: 999,
      title: '第三章 卡文（改）',
      snippet: '更新摘要',
      createdTime: 1700000300000,
    });

    const other = await repo.listBookmarks(8);
    expect(other).toHaveLength(0);
  });

  it('listBookmarks filters by bookId and orders by createdTime DESC', async () => {
    const row: BookmarkRow = {
      id: 3,
      bookId: 7,
      chapterIndex: 12,
      scrollOffset: 999,
      title: '第三章 卡文',
      snippet: '……',
      createdTime: 1700000200000,
    };
    const mock = recordingDb({ queryResults: [[row]] });
    const repo = new BookRepository(mock.db);

    const list = await repo.listBookmarks(7);

    expect(list).toEqual([row]);
    const call = mock.calls[0];
    expect(call?.sql).toContain('FROM bookmarks');
    expect(call?.sql).toContain('ORDER BY "createdTime" DESC');
  });

  it('upsertDownloadTask round-trips status transitions', async () => {
    const repo = await openRepo();

    const task: DownloadTaskRow = {
      id: 'task-1',
      sourceId: 'src-1',
      title: '诡秘之主 EPUB',
      author: '爱潜水的乌贼',
      coverUrl: 'https://img.test/cover.jpg',
      downloadUrl: 'https://dl.test/book.epub',
      format: 'epub',
      status: 'PENDING',
      downloadedBytes: 0,
      totalBytes: 1024,
      filePath: null,
      errorMessage: null,
      updatedAt: 1700000400000,
    };
    await repo.upsertDownloadTask(task);
    await repo.upsertDownloadTask({
      ...task,
      status: 'COMPLETED',
      downloadedBytes: 1024,
      filePath: '/books/book.epub',
      updatedAt: 1700000500000,
    });

    const tasks = await repo.listDownloadTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task-1',
      status: 'COMPLETED',
      downloadedBytes: 1024,
      totalBytes: 1024,
      filePath: '/books/book.epub',
    });
  });

  it('getBooks / getBookshelf / getLibrary query the books table with Android ordering', async () => {
    const mock = recordingDb({ queryResults: [[], [], []] });
    const repo = new BookRepository(mock.db);

    await repo.getBooks();
    await repo.getBookshelf();
    await repo.getLibrary();

    expect(mock.calls[0]?.sql).toContain('FROM books');
    expect(mock.calls[0]?.sql).not.toContain('ORDER BY');
    expect(mock.calls[1]?.sql).toContain('ORDER BY "lastReadTime" DESC');
    expect(mock.calls[2]?.sql).toContain('ORDER BY "title" ASC');
  });

  it('saveProgress + getProgress round-trip through in-memory db', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    await repo.saveProgress(bookId, 7, 300, false, 1700009999999);

    const progress = await repo.getProgress(bookId);
    expect(progress).toEqual({
      bookId,
      chapterIndex: 7,
      scrollOffset: 300,
      isFinished: false,
      lastReadTime: 1700009999999,
    });

    const book = await repo.getBook(bookId);
    expect(book).toMatchObject({
      currentChapterIndex: 7,
      scrollOffset: 300,
      lastReadTime: 1700009999999,
    });
  });

  it('saveProgress uses Android skip-if-unchanged and sticky isFinished', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    await repo.saveProgress(bookId, 2, 50, false, 1700000000001);

    await repo.saveProgress(bookId, 2, 50, false, 1700000000002);
    let book = await repo.getBook(bookId);
    expect(book?.lastReadTime).toBe(1700000000001);

    await repo.saveProgress(bookId, 2, 50, true, 1700000000003);
    book = await repo.getBook(bookId);
    expect(book?.isFinished).toBe(1);
    expect(book?.lastReadTime).toBe(1700000000003);

    await repo.saveProgress(bookId, 9, 1, false, 1700000000004);
    book = await repo.getBook(bookId);
    expect(book?.isFinished).toBe(1);
    expect(book?.currentChapterIndex).toBe(9);
  });

  it('saveProgress parameterized SQL touches books and coerces negatives', async () => {
    const mock = recordingDb({
      queryResults: [
        [{ currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, lastReadTime: 1 }],
      ],
    });
    const repo = new BookRepository(mock.db);

    await repo.saveProgress(5, -1, -20, false, 12345);

    const call = mock.calls[mock.calls.length - 1];
    expect(call?.kind).toBe('execute');
    expect(call?.sql).toContain('UPDATE books');
    expect(call?.sql).toContain('"currentChapterIndex" = ?');
    expect(call?.sql).toContain('"scrollOffset" = ?');
    expect(call?.sql).toContain('"isFinished" = ?');
    expect(call?.sql).toContain('"lastReadTime" = ?');
    expect(call?.params).toEqual([0, 0, 0, 12345, 5]);
  });

  it('getProgress returns null when the book does not exist', async () => {
    const repo = await openRepo();
    expect(await repo.getProgress(404)).toBeNull();
  });

  it('getProgress projects Android ReadingProgress fields from books row', async () => {
    const row = {
      currentChapterIndex: 11,
      scrollOffset: 44,
      isFinished: 0,
      lastReadTime: 1700000300000,
    };
    const mock = recordingDb({ queryResults: [[row]] });
    const repo = new BookRepository(mock.db);

    const progress = await repo.getProgress(9);

    expect(progress).toEqual({
      bookId: 9,
      chapterIndex: 11,
      scrollOffset: 44,
      isFinished: false,
      lastReadTime: 1700000300000,
    });
    const call = mock.calls[0];
    expect(call?.sql).toContain('FROM books');
    expect(call?.sql).toContain('"currentChapterIndex"');
    expect(call?.sql).toContain('"scrollOffset"');
    expect(call?.sql).toContain('"isFinished"');
    expect(call?.sql).toContain('"lastReadTime"');
    expect(call?.params).toEqual([9]);
  });

  it('addBookmark + getBookmarks + removeBookmark match Android bookmark lifecycle', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    const id = await repo.addBookmark({
      bookId,
      chapterIndex: 5,
      scrollOffset: 77,
      title: '第六章 深夜来电',
      snippet: '……他回头看了她一眼。',
      createdTime: 1700000400000,
    });
    expect(id).toBeGreaterThan(0);

    const bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({
      bookId,
      chapterIndex: 5,
      scrollOffset: 77,
      title: '第六章 深夜来电',
      snippet: '……他回头看了她一眼。',
      createdTime: 1700000400000,
    });

    await repo.removeBookmark(id);
    expect(await repo.getBookmarks(bookId)).toHaveLength(0);
  });

  it('addBookmark upserts on (bookId, chapterIndex) like Android REPLACE', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    await repo.addBookmark({
      bookId,
      chapterIndex: 1,
      scrollOffset: 10,
      title: '第二章',
      snippet: 'old',
      createdTime: 100,
    });
    await repo.addBookmark({
      bookId,
      chapterIndex: 1,
      scrollOffset: 50,
      title: '第二章 更新',
      snippet: 'new',
      createdTime: 200,
    });

    const bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({
      scrollOffset: 50,
      title: '第二章 更新',
      snippet: 'new',
      createdTime: 200,
    });
  });

  it('getBookmarks orders by createdTime DESC (Android getBookmarksForBook)', async () => {
    const mock = recordingDb({ queryResults: [[]] });
    const repo = new BookRepository(mock.db);

    await repo.getBookmarks(7);

    const call = mock.calls[0];
    expect(call?.sql).toContain('FROM bookmarks');
    expect(call?.sql).toContain('ORDER BY "createdTime" DESC');
  });

  it('getBook reads a single books row by id', async () => {
    const repo = await openRepo();
    const id = await repo.insertBook(sampleBook);
    const missing = await repo.getBook(999);
    expect(missing).toBeNull();

    const book = await repo.getBook(id);
    expect(book).toMatchObject({ id, title: '诡秘之主', currentChapterIndex: 3 });
  });
});

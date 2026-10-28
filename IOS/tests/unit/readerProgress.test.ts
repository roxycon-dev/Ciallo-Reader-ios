import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAppDatabase } from '@core/db/openDatabase';
import {
  BookRepository,
  ProgressSaveCoordinator,
  type DatabaseLike,
} from '@core/library/bookRepository';
import type { BookRow } from '@core/library/bookTypes';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';

const sampleBook: Omit<BookRow, 'id'> = {
  title: '诡秘之主',
  author: '爱潜水的乌贼',
  filePath: null,
  coverUri: null,
  category: '玄幻',
  currentChapterIndex: 0,
  scrollOffset: 0,
  isFinished: 0,
  totalChapters: 10,
  contentType: 'novel',
  addedTime: 1700000000000,
  lastReadTime: 1700000000000,
  sourceId: null,
  comicId: null,
};

async function openRepo(): Promise<BookRepository> {
  const db = new InMemorySqliteDatabase();
  await openAppDatabase({ db });
  return new BookRepository(db);
}

describe('reader progress persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saveProgress writes chapter, offset, and lastReadTime to books', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    await repo.saveProgress(bookId, 3, 120, false, 1700000500000);

    const progress = await repo.getProgress(bookId);
    expect(progress).toEqual({
      bookId,
      chapterIndex: 3,
      scrollOffset: 120,
      isFinished: false,
      lastReadTime: 1700000500000,
    });
  });

  it('saveProgress is sticky for isFinished and clamps negatives to 0', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    await repo.saveProgress(bookId, 5, 10, true, 1700000600000);
    let progress = await repo.getProgress(bookId);
    expect(progress?.isFinished).toBe(true);

    await repo.saveProgress(bookId, 2, 5, false, 1700000700000);
    progress = await repo.getProgress(bookId);
    expect(progress).toMatchObject({
      chapterIndex: 2,
      scrollOffset: 5,
      isFinished: true,
    });

    await repo.saveProgress(bookId, -4, -9, false, 1700000800000);
    progress = await repo.getProgress(bookId);
    expect(progress).toMatchObject({ chapterIndex: 0, scrollOffset: 0 });
  });

  it('saveProgress skips redundant writes when position is unchanged', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    await repo.saveProgress(bookId, 4, 80, false, 1700000900000);

    const bookBefore = await repo.getBook(bookId);
    expect(bookBefore?.lastReadTime).toBe(1700000900000);

    await repo.saveProgress(bookId, 4, 80, false, 1700001000000);

    const bookAfter = await repo.getBook(bookId);
    expect(bookAfter?.lastReadTime).toBe(1700000900000);
    expect(bookAfter?.currentChapterIndex).toBe(4);
    expect(bookAfter?.scrollOffset).toBe(80);
  });

  it('saveProgress still marks finished when only the finished flag changes', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook({ ...sampleBook, currentChapterIndex: 4, scrollOffset: 80 });
    await repo.saveProgress(bookId, 4, 80, true, 1700001100000);

    const book = await repo.getBook(bookId);
    expect(book?.isFinished).toBe(1);
    expect(book?.lastReadTime).toBe(1700001100000);
  });

  it('getProgress returns null for a missing book', async () => {
    const repo = await openRepo();
    expect(await repo.getProgress(999)).toBeNull();
  });

  it('ProgressSaveCoordinator debounces saves and fires immediately when finished', async () => {
    const saves: Array<{
      bookId: number;
      chapterIndex: number;
      scrollOffset: number;
      isFinished: boolean;
    }> = [];
    const coordinator = new ProgressSaveCoordinator(
      async (bookId, chapterIndex, scrollOffset, isFinished) => {
        saves.push({ bookId, chapterIndex, scrollOffset, isFinished });
      },
      400,
    );

    coordinator.request(1, 0, 10, false);
    coordinator.request(1, 1, 20, false);
    coordinator.request(1, 2, 30, false);
    expect(coordinator.pendingCount()).toBe(1);
    expect(saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);
    expect(saves).toEqual([{ bookId: 1, chapterIndex: 2, scrollOffset: 30, isFinished: false }]);
    expect(coordinator.pendingCount()).toBe(0);

    coordinator.request(1, 9, 99, true);
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual({ bookId: 1, chapterIndex: 9, scrollOffset: 99, isFinished: true });
  });

  it('ProgressSaveCoordinator cancel drops pending saves for a book', async () => {
    const saves: number[] = [];
    const coordinator = new ProgressSaveCoordinator(async (_bookId, chapterIndex) => {
      saves.push(chapterIndex);
    }, 400);

    coordinator.request(1, 3, 0, false);
    coordinator.request(2, 5, 0, false);
    coordinator.cancel(1);
    await vi.advanceTimersByTimeAsync(400);

    expect(saves).toEqual([5]);
  });

  it('coordinator + repository round-trip persists debounced progress', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    const coordinator = new ProgressSaveCoordinator(
      (id, chapterIndex, scrollOffset, isFinished) =>
        repo.saveProgress(id, chapterIndex, scrollOffset, isFinished),
      400,
    );

    coordinator.request(bookId, 1, 40, false);
    coordinator.request(bookId, 6, 200, false);
    await vi.advanceTimersByTimeAsync(400);

    const progress = await repo.getProgress(bookId);
    expect(progress).toMatchObject({ chapterIndex: 6, scrollOffset: 200, isFinished: false });
  });
});

describe('bookmark persistence (Android model)', () => {
  it('addBookmark stores structure matching Android Bookmark fields', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);

    const id = await repo.addBookmark({
      bookId,
      chapterIndex: 2,
      scrollOffset: 64,
      title: '第三章 镜中的影子',
      snippet: '夜色渐深，城市的霓虹灯在雨幕中晕开一片片模糊的光。林默撑着伞，站在老',
      createdTime: 1700000200000,
    });
    expect(id).toBeGreaterThan(0);

    const bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({
      id,
      bookId,
      chapterIndex: 2,
      scrollOffset: 64,
      title: '第三章 镜中的影子',
      snippet: '夜色渐深，城市的霓虹灯在雨幕中晕开一片片模糊的光。林默撑着伞，站在老',
      createdTime: 1700000200000,
    });
  });

  it('getBookmarks orders by createdTime DESC', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    await repo.addBookmark({
      bookId,
      chapterIndex: 0,
      scrollOffset: 0,
      title: '第一章',
      snippet: 'a',
      createdTime: 1000,
    });
    await repo.addBookmark({
      bookId,
      chapterIndex: 1,
      scrollOffset: 0,
      title: '第二章',
      snippet: 'b',
      createdTime: 2000,
    });

    const bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks.map((b) => b.chapterIndex)).toEqual([1, 0]);
  });

  it('upsert keeps one bookmark per (bookId, chapterIndex); removeBookmark deletes by id', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    const firstId = await repo.addBookmark({
      bookId,
      chapterIndex: 3,
      scrollOffset: 10,
      title: '第四章',
      snippet: 'x',
      createdTime: 1000,
    });
    const secondId = await repo.addBookmark({
      bookId,
      chapterIndex: 3,
      scrollOffset: 90,
      title: '第四章（改）',
      snippet: 'y',
      createdTime: 2000,
    });
    expect(secondId).toBe(firstId);

    let bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({ scrollOffset: 90, title: '第四章（改）' });

    await repo.removeBookmark(firstId);
    bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(0);
  });

  it('toggle flow: remove then re-add keeps a single bookmark', async () => {
    const repo = await openRepo();
    const bookId = await repo.insertBook(sampleBook);
    const payload = {
      bookId,
      chapterIndex: 7,
      scrollOffset: 0,
      title: '第八章',
      snippet: 'snip',
      createdTime: 3000,
    };
    const id = await repo.addBookmark(payload);
    await repo.removeBookmark(id);
    expect(await repo.getBookmarks(bookId)).toHaveLength(0);
    await repo.addBookmark(payload);
    const bookmarks = await repo.getBookmarks(bookId);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.chapterIndex).toBe(7);
  });
});

describe('library query methods', () => {
  it('getBookshelf orders by lastReadTime DESC; getLibrary by title ASC', async () => {
    const repo = await openRepo();
    await repo.insertBook({
      ...sampleBook,
      title: 'B书',
      lastReadTime: 100,
    });
    await repo.insertBook({
      ...sampleBook,
      title: 'A书',
      lastReadTime: 200,
    });

    const shelf = await repo.getBookshelf();
    expect(shelf.map((b) => b.title)).toEqual(['A书', 'B书']);

    const library = await repo.getLibrary();
    expect(library.map((b) => b.title)).toEqual(['A书', 'B书']);

    const all = await repo.getBooks();
    expect(all).toHaveLength(2);
  });

  it('DatabaseLike SQL for getBookshelf/getLibrary is parameter-free selects', async () => {
    const calls: string[] = [];
    const db: DatabaseLike = {
      execute: () => Promise.resolve({ rowsAffected: 0 }),
      query: <T>(sql: string) => {
        calls.push(sql);
        return Promise.resolve([] as T[]);
      },
    };
    const repo = new BookRepository(db);
    await repo.getBookshelf();
    await repo.getLibrary();
    expect(calls[0]).toContain('FROM books');
    expect(calls[0]).toContain('lastReadTime');
    expect(calls[1]).toContain('FROM books');
    expect(calls[1]).toContain('title');
  });
});

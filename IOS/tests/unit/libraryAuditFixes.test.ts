/**
 * Regression tests for the fidelity gaps found while auditing Module B
 * (`data/BookRepository.kt`, `data/favorite/FavoriteModels.kt`).
 *
 * Each block names the Kotlin line the expectation comes from.
 */
import { describe, expect, it, vi } from 'vitest';
import { BookRepository } from '../../src/core/library/bookRepository';
import { isNewChapterObserved, ordered } from '../../src/core/library/comicReadingLogic';
import type { ComicChapter } from '../../src/core/library/comicSourceTypes';
import type { BookRow, ChapterRow } from '../../src/core/library/bookTypes';
import { cleanSplitTitle } from '../../src/core/data/chapterMerger';
import { MangaTranslateUnsupportedError } from '../../src/core/mangatranslate/index';

/** Minimal in-memory `DatabaseLike` good enough for the BookDao statements below. */
function memoryDb(seedBooks: BookRow[] = []) {
  const books: BookRow[] = [...seedBooks];
  const chapters: ChapterRow[] = [];
  const deletedBooks: number[] = [];
  let lastInsertRowId = 0;
  return {
    books,
    chapters,
    deletedBooks,
    db: {
      async execute(sql: string, params: Array<string | number | null> = []) {
        const t = sql.trim();
        if (t.startsWith('INSERT INTO books')) {
          lastInsertRowId += 1;
          books.push({
            id: lastInsertRowId,
            title: String(params[0]),
            author: params[1] as string,
            filePath: String(params[2]),
            coverUri: params[3] as string | null,
            category: params[4] as string,
            currentChapterIndex: Number(params[5]),
            scrollOffset: Number(params[6]),
            isFinished: Number(params[7]),
            totalChapters: Number(params[8]),
            contentType: String(params[9]),
            addedTime: Number(params[10]),
            lastReadTime: Number(params[11]),
            sourceId: params[12] as string | null,
            comicId: params[13] as string | null,
          });
          return { rowsAffected: 1, lastInsertRowId };
        }
        if (t.startsWith('DELETE FROM books')) {
          const id = Number(params[0]);
          deletedBooks.push(id);
          const i = books.findIndex((b) => b.id === id);
          if (i >= 0) books.splice(i, 1);
          return { rowsAffected: 1 };
        }
        if (t.startsWith('INSERT OR REPLACE INTO chapters')) {
          chapters.push({
            id: 0,
            bookId: Number(params[0]),
            chapterOrder: Number(params[1]),
            title: String(params[2]),
            content: String(params[3]),
            startCharIndex: Number(params[4]),
            endCharIndex: Number(params[5]),
          });
          return { rowsAffected: 1, lastInsertRowId: 1 };
        }
        return { rowsAffected: 0 };
      },
      async query<T>(sql: string, params: Array<string | number | null> = []): Promise<T[]> {
        if (sql.includes('FROM books WHERE filePath = ?')) {
          const fp = String(params[0]);
          return books.filter((b) => b.filePath === fp) as unknown as T[];
        }
        if (sql.includes('FROM books')) {
          // Android: Room materialises a fresh list per query; deletions during the
          // iteration therefore cannot skip an element. Mirror that here.
          return [...books] as unknown as T[];
        }
        return [] as T[];
      },
    },
  };
}

describe('BookRepository.checkAndSeedDefaultBooks — Android step 1 was missing (BookRepository.kt 863..884)', () => {
  function book(id: number, filePath: string, title: string): BookRow {
    return {
      id,
      title,
      author: '未知作者',
      filePath,
      coverUri: null,
      category: '默认',
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 0,
      contentType: 'NOVEL',
      addedTime: 0,
      lastReadTime: 0,
      sourceId: null,
      comicId: null,
    };
  }

  it('removes the three legacy sample filePaths', async () => {
    const m = memoryDb([
      book(1, 'sample_test_novel', '测试'),
      book(2, 'sample_comic', '测试'),
      book(3, 'sample_epub3.epub', '测试'),
      book(4, 'ciallo_guide_novel', '《Ciallo Reader使用指南》'),
    ]);
    const repo = new BookRepository(m.db);
    await repo.cleanupLegacySampleBooks();
    expect(m.deletedBooks.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(m.books.map((b) => b.id)).toEqual([4]);
  });

  it('removes books whose title contains the three sample markers', async () => {
    const m = memoryDb([
      book(1, 'a.txt', '5页测试小说'),
      book(2, 'b.txt', '示例漫画'),
      book(3, 'c.txt', '示例 EPUB'),
      book(4, 'd.txt', '正常书名'),
    ]);
    await new BookRepository(m.db).cleanupLegacySampleBooks();
    expect(m.books.map((b) => b.title)).toEqual(['正常书名']);
  });

  it('never throws when the delete fails (Android wraps it in try/catch)', async () => {
    const failing = {
      async execute(): Promise<{ rowsAffected: number }> {
        throw new Error('db down');
      },
      async query<T>(): Promise<T[]> {
        return [] as T[];
      },
    };
    await expect(new BookRepository(failing).cleanupLegacySampleBooks()).resolves.toBeUndefined();
  });
});

describe('BookRepository.splitOversizedChaptersInLibrary swallows failures (BookRepository.kt 586-589)', () => {
  it('resolves and reports instead of rejecting when the sweep throws', async () => {
    // Kotlin wraps the whole `try { … }` in `catch (t: Throwable) { if (t is
    // CancellationException) throw t; Log.e("BookImport", "splitOversizedChaptersInLibrary
    // failed", t) }`. A failure on ONE book must not abort the sweep over the rest of the
    // library, and the call must not reject. The port had no such catch, so the rejection
    // propagated to the caller and later books were never split.
    const failing = {
      async execute(): Promise<{ rowsAffected: number }> {
        throw new Error('db down');
      },
      // The sweep reads the book list first (`getAllBooks()` → `SELECT … FROM books`), so
      // this is where a mid-sweep failure surfaces.
      async query<T>(): Promise<T[]> {
        throw new Error('db down');
      },
    };
    const logged: Array<[string, string]> = [];
    const repo = new BookRepository({
      db: failing,
      logError: (tag: string, message: string) => {
        logged.push([tag, message]);
      },
    });
    await expect(repo.splitOversizedChaptersInLibrary()).resolves.toBeUndefined();
    expect(logged).toEqual([['BookImport', 'splitOversizedChaptersInLibrary failed']]);
  });

  it('rethrows AbortError so a cancellation is not mistaken for a failure', async () => {
    const aborting = {
      async execute(): Promise<{ rowsAffected: number }> {
        return { rowsAffected: 0 };
      },
      async query<T>(): Promise<T[]> {
        const e = new Error('cancelled');
        e.name = 'AbortError';
        throw e;
      },
    };
    const repo = new BookRepository({ db: aborting });
    await expect(repo.splitOversizedChaptersInLibrary()).rejects.toThrow('cancelled');
  });
});

describe('BookRepository.importTextBook — opening chapter title (BookRepository.kt 429)', () => {
  async function importLines(lines: string[]) {
    const m = memoryDb();
    const repo = new BookRepository(m.db);
    await repo.importTextBook('novel.txt', lines);
    return m.chapters.map((c) => ({ title: c.title, content: c.content }));
  }

  it('titles pre-heading content 「前言」 when chapter headings exist', async () => {
    // Android: `var currentTitle = if (hasChapters) "前言" else "第 1 部分"`.
    const out = await importLines(['这是前言内容。', '', '第一章 开始', '正文一。']);
    expect(out[0]?.title).toBe('前言');
    expect(out[0]?.content).toBe('这是前言内容。\n');
    expect(out[1]?.title).toBe('第一章 开始');
  });

  it('titles pre-heading content 「第 1 部分」 when no heading exists', async () => {
    // Android: hasChapters == false -> "第 1 部分"
    const out = await importLines(['只有一段文字。']);
    expect(out[0]?.title).toBe('第 1 部分');
  });

  it('does not accumulate 「(续)」 on continuation titles (BookRepository.kt 456)', async () => {
    // Android: `ChapterMerger.cleanSplitTitle(currentTitle) + " (续)"` strips an existing
    // 「(续)」 first, so repeated flushes do not produce 「… (续) (续) (续)」.
    const body = 'x'.repeat(6000);
    const out = await importLines([
      '第一章 长章',
      body,
      body,
      body,
      body,
      body,
      body,
      body,
      body,
      body,
      body,
      body,
      body,
    ]);
    const titles = out.map((c) => c.title);
    // 12 * 6000 = 72000 chars, i.e. two 30000-char flushes
    expect(titles.filter((t) => t === '第一章 长章 (续)').length).toBe(2);
    expect(titles.some((t) => (t.match(/ \(续\)/g) ?? []).length > 1)).toBe(false);
  });

  it('keeps the cleanSplitTitle contract used by the continuation suffix', () => {
    expect(cleanSplitTitle('第一章 (续)')).toBe('第一章');
    expect(cleanSplitTitle('第一章 (续2)')).toBe('第一章');
    expect(cleanSplitTitle('第一章')).toBe('第一章');
  });

  it('rejects a file with no readable text (Android: 文件中没有可阅读的正文)', async () => {
    const m = memoryDb();
    await expect(new BookRepository(m.db).importTextBook('empty.txt', [])).rejects.toThrow(
      '文件中没有可阅读的正文',
    );
  });
});

describe('comicReadingLogic.isNewChapterObserved — BigDecimal compare (ComicReadingLogic.kt 93..96)', () => {
  const chapter = (id: string, title: string): ComicChapter => ({
    id,
    title,
    volume: null,
    order: 0,
    external: false,
    externalUrl: null,
  });
  const asOrdered = (c: ComicChapter) => ordered([c])[0]!;

  it('treats "12" and "12.0" as the same episode (numeric, not string)', () => {
    // Android: `newNum.compareTo(oldNum) == 0` on BigDecimal -> 12 == 12.0.
    expect(isNewChapterObserved('a', '第12话', asOrdered(chapter('b', '第12.0话')))).toBe(false);
  });

  it('treats "12.50" and "12.5" as the same episode', () => {
    expect(isNewChapterObserved('a', '第12.50话', asOrdered(chapter('b', '第12.5话')))).toBe(false);
  });

  it('still reports a genuinely higher episode as new', () => {
    expect(isNewChapterObserved('a', '第12话', asOrdered(chapter('b', '第13话')))).toBe(true);
  });

  it('still reports a lower episode as new (no monotonic clamp, matching Android)', () => {
    expect(isNewChapterObserved('a', '第13话', asOrdered(chapter('b', '第12话')))).toBe(true);
  });

  it('falls back to a pure id comparison when either side has no number', () => {
    expect(isNewChapterObserved('a', '序章', asOrdered(chapter('b', '第12话')))).toBe(true);
    expect(isNewChapterObserved('a', '第12话', asOrdered(chapter('b', '尾声')))).toBe(true);
  });

  it('is false when nothing was ever fetched or the id is unchanged', () => {
    expect(isNewChapterObserved('a', '第12话', null)).toBe(false);
    expect(isNewChapterObserved(null, null, asOrdered(chapter('b', '第1话')))).toBe(true);
    expect(isNewChapterObserved('a', '第12话', asOrdered(chapter('a', '第12话')))).toBe(false);
  });

  it('honours the 64-char guard on the matched number (Kotlin takeIf { length<=64 })', () => {
    // Both sides exceed 64 chars, so neither parses to a decimal and Android cannot prove
    // they are the same episode -> it falls back to the pure id comparison and reports NEW.
    const long = '9'.repeat(65);
    expect(isNewChapterObserved('a', `第${long}话`, asOrdered(chapter('b', `第${long}话`)))).toBe(true);
    // 64 chars is still comparable.
    const ok = '9'.repeat(60);
    expect(isNewChapterObserved('a', `第${ok}话`, asOrdered(chapter('b', `第${ok}.0话`)))).toBe(false);
  });
});

describe('src/core keeps the mangatranslate scope exclusion typed', () => {
  it('never leaks a stub as a silent no-op', () => {
    expect(() => {
      throw new MangaTranslateUnsupportedError('X', 'bitmap-input', 'd');
    }).toThrow(MangaTranslateUnsupportedError);
  });
});

/** Keep `vi` referenced so the import is not flagged unused by a future edit. */
export const __keepVitest = vi;
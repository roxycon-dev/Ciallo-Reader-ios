/**
 * Parameterized repository over Room v12 tables (see db/schemaV12.ts).
 * Core stays pure TS — execution is injected via DatabaseLike (platform sqlite).
 *
 * SELECT statements use an explicit column list so SQL stays readable in
 * mocks/tests and independent of table evolution order.
 *
 * BookDao port of Android AppDatabase.kt BookDao + portable BookRepository.kt methods.
 */

import { splitChapterText } from '@core/data/splitChapterText'
import { cleanSplitTitle } from '@core/data/chapterMerger'
import type {
  Bookmark,
  BookmarkRow,
  BookRow,
  CategoryRow,
  ChapterRow,
  DownloadTaskRow,
  ReadingProgress,
} from './bookTypes'
import { DEFAULT_CATEGORY, isComicBook, UNSUPPORTED_CHAPTER_TITLE } from './bookTypes'
import type {
  HighlightRow,
  ReadingRecordRow,
  ReadingSessionRow,
  DailyReadingTotalRow,
  MonthlyReadingTotalRow,
  YearlyReadingTotalRow,
} from './readingSessionTypes'
import { AsyncMutex, contentMutationGate } from './contentMutationGate'
import { splitReadingTimeSlices } from './readingTimeSlices'
import {
  type BookRepositoryFileSystem,
  baseNameWithoutExtension,
  extensionOf,
  fileNameOf,
  stripFileScheme,
} from './bookRepositoryDisk'
import type { PreferencesManager } from '@core/settings/settingsRepository'

export interface DatabaseLike {
  execute(
    sql: string,
    params?: Array<string | number | null>,
  ): Promise<{ rowsAffected: number; lastInsertRowId?: number }>;
  query<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
}

const BOOK_COLUMNS =
  '"id", "title", "author", "filePath", "coverUri", "category", "currentChapterIndex", ' +
  '"scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime", "lastReadTime", "sourceId", "comicId"';

const PROGRESS_COLUMNS =
  '"currentChapterIndex", "scrollOffset", "isFinished", "lastReadTime"';

const BOOKMARK_COLUMNS =
  '"id", "bookId", "chapterIndex", "scrollOffset", "title", "snippet", "createdTime"';

const CHAPTER_COLUMNS =
  '"id", "bookId", "chapterOrder", "title", "content", "startCharIndex", "endCharIndex"';

const HIGHLIGHT_COLUMNS =
  '"id", "bookId", "chapterIndex", "selectedText", "note", "colorHex", "createdTime"';

const CATEGORY_COLUMNS = '"id", "name", "isProtected"';

const RECORD_COLUMNS = '"id", "bookId", "bookTitle", "dateStr", "durationSeconds"';

const SESSION_COLUMNS =
  '"id", "bookId", "bookTitle", "dateStr", "startTimeMs", "endTimeMs", "durationSeconds", "startHour"';

const DOWNLOAD_TASK_COLUMNS =
  '"id", "sourceId", "title", "author", "coverUrl", "downloadUrl", "format", "status", ' +
  '"downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt"';

interface PendingProgress {
  chapterIndex: number;
  scrollOffset: number;
  isFinished: boolean;
}

export class ProgressSaveCoordinator {
  private readonly pending = new Map<number, PendingProgress>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly save: (
      bookId: number,
      chapterIndex: number,
      scrollOffset: number,
      isFinished: boolean,
    ) => Promise<void>,
    private readonly debounceMs = 400,
  ) {}

  request(
    bookId: number,
    chapterIndex: number,
    scrollOffset: number,
    isFinished: boolean,
  ): void {
    this.pending.set(bookId, { chapterIndex, scrollOffset, isFinished });
    const prev = this.timers.get(bookId);
    if (prev !== undefined) {
      clearTimeout(prev);
    }
    const flush = () => {
      this.timers.delete(bookId);
      const next = this.pending.get(bookId);
      this.pending.delete(bookId);
      if (next) {
        void this.save(bookId, next.chapterIndex, next.scrollOffset, next.isFinished);
      }
    };
    if (isFinished) {
      flush();
      return;
    }
    this.timers.set(bookId, setTimeout(flush, this.debounceMs));
  }

  cancel(bookId: number): void {
    const prev = this.timers.get(bookId);
    if (prev !== undefined) {
      clearTimeout(prev);
    }
    this.timers.delete(bookId);
    this.pending.delete(bookId);
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

export interface BookRepositoryOptions {
  db: DatabaseLike
  settings?: PreferencesManager | undefined
  /** Android `android.util.Log.e(TAG, msg, t)` sink (see the `catch` at Kotlin L586-589). */
  logError?: ((tag: string, message: string, error: unknown) => void) | undefined
  /** Android `android.util.Log.i(TAG, msg)` sink (see the per-book log at Kotlin L578). */
  log?: ((tag: string, message: string) => void) | undefined
}

/** Narrow a value to the raw DatabaseLike shape (`new BookRepository(db)` call sites). */
function isDatabaseLike(value: unknown): value is DatabaseLike {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as DatabaseLike).execute === 'function' &&
    typeof (value as DatabaseLike).query === 'function'
  )
}

/** Text import helpers shared by importBookUnchecked. */
const CHAPTER_TITLE_PATTERN = /^第[0-9一二三四五六七八九十百千万]+[章回卷节\s].*/
const UNSUPPORTED_BINARY_EXTENSIONS = ['.kfx', '.djvu', '.doc', '.rtf', '.chm']

/** Android line 662: `File(context.filesDir, "downloads")` — the sibling .tmp/.resume dir. */
const DOWNLOADS_DIR = 'downloads';

/**
 * Android lines 620..621 / 678..681 — the download tasks that belong to a book:
 * `task.filePath.removePrefix("file://")==book.filePath.removePrefix("file://")` or
 * `book.sourceId==task.sourceId && book.comicId==DownloadManager.originalBookId(task.id, task.sourceId)`.
 * The `originalBookId` leg is source-specific, so the caller may pass `matchTasks` instead.
 */
function defaultMatchTasks(
  book: BookRow,
  tasks: readonly DownloadTaskRow[],
): readonly DownloadTaskRow[] {
  const bookPath = stripFileScheme(book.filePath ?? '');
  return tasks.filter((task) => stripFileScheme(task.filePath ?? '') === bookPath);
}

export class BookRepository {
  private readonly db: DatabaseLike
  private readonly settings: PreferencesManager | undefined
  private readonly logError: ((tag: string, message: string, error: unknown) => void) | undefined
  private readonly log: ((tag: string, message: string) => void) | undefined
  /** Android BookRepository.progressWriteMutex — serializes progress writes under the content gate. */
  private readonly progressWriteMutex = new AsyncMutex()

  constructor(options: DatabaseLike | BookRepositoryOptions) {
    if (isDatabaseLike(options)) {
      this.db = options
      this.settings = undefined
      this.logError = undefined
      this.log = undefined
    } else {
      this.db = options.db
      this.settings = options.settings
      this.logError = options.logError
      this.log = options.log
    }
  }

  /* ───────────── BookDao: books ───────────── */

  getAllBooks(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY lastReadTime DESC`)
  }

  getAllBooksSync(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books`)
  }

  async getBooksCount(): Promise<number> {
    const rows = await this.db.query<{ c: number }>('SELECT COUNT(*) AS c FROM books')
    return rows[0]?.c ?? 0
  }

  async getBookCountByFilePath(filePath: string): Promise<number> {
    const rows = await this.db.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM books WHERE filePath = ?',
      [filePath],
    )
    return rows[0]?.c ?? 0
  }

  async getBookByFilePath(filePath: string): Promise<BookRow | null> {
    const rows = await this.db.query<BookRow>(
      `SELECT ${BOOK_COLUMNS} FROM books WHERE filePath = ? LIMIT 1`,
      [filePath],
    )
    return rows[0] ?? null
  }

  async getBookBySourceResource(sourceId: string, resourceId: string): Promise<BookRow | null> {
    const rows = await this.db.query<BookRow>(
      `SELECT ${BOOK_COLUMNS} FROM books WHERE sourceId = ? AND comicId = ? LIMIT 1`,
      [sourceId, resourceId],
    )
    return rows[0] ?? null
  }

  getBook(id: number): Promise<BookRow | null> {
    return this.db
      .query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`, [id])
      .then((rows) => rows[0] ?? null);
  }

  getBooks(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books`);
  }

  getBookshelf(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY "lastReadTime" DESC`);
  }

  getLibrary(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books ORDER BY "title" ASC`);
  }

  listBooks(): Promise<BookRow[]> {
    return this.db.query<BookRow>(`SELECT ${BOOK_COLUMNS} FROM books`);
  }

  insertBook(book: Omit<BookRow, 'id'>): Promise<number> {
    return this.db
      .execute(
        'INSERT INTO books ("title", "author", "filePath", "coverUri", "category", ' +
          '"currentChapterIndex", "scrollOffset", "isFinished", "totalChapters", "contentType", ' +
          '"addedTime", "lastReadTime", "sourceId", "comicId") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          book.title,
          book.author,
          book.filePath,
          book.coverUri,
          book.category,
          book.currentChapterIndex,
          book.scrollOffset,
          book.isFinished,
          book.totalChapters,
          book.contentType,
          book.addedTime,
          book.lastReadTime,
          book.sourceId,
          book.comicId,
        ],
      )
      .then((res) => res.lastInsertRowId ?? 0);
  }

  updateBook(book: BookRow): Promise<void> {
    return this.db
      .execute(
        'UPDATE books SET "title" = ?, "author" = ?, "filePath" = ?, "coverUri" = ?, "category" = ?, ' +
          '"currentChapterIndex" = ?, "scrollOffset" = ?, "isFinished" = ?, "totalChapters" = ?, ' +
          '"contentType" = ?, "addedTime" = ?, "lastReadTime" = ?, "sourceId" = ?, "comicId" = ? WHERE "id" = ?',
        [
          book.title,
          book.author,
          book.filePath,
          book.coverUri,
          book.category,
          book.currentChapterIndex,
          book.scrollOffset,
          book.isFinished,
          book.totalChapters,
          book.contentType,
          book.addedTime,
          book.lastReadTime,
          book.sourceId,
          book.comicId,
          book.id ?? 0,
        ],
      )
      .then(() => undefined);
  }

  /** Android BookDao.updateProgress — UPDATE books SET currentChapterIndex, scrollOffset, isFinished OR, lastReadTime. */
  updateProgress(
    bookId: number,
    chapter: number,
    offset: number,
    finished: boolean,
    time: number,
  ): Promise<void> {
    return this.db
      .execute(
        'UPDATE books SET "currentChapterIndex"=?, "scrollOffset"=?, "isFinished"=isFinished OR ?, "lastReadTime"=? WHERE id=?',
        [chapter, offset, finished ? 1 : 0, time, bookId],
      )
      .then(() => undefined);
  }

  deleteBook(book: BookRow): Promise<void> {
    return this.db
      .execute('DELETE FROM books WHERE id = ?', [book.id ?? 0])
      .then(() => undefined);
  }

  async hasOversizedChapter(bookId: number, limit: number): Promise<boolean> {
    const rows = await this.db.query<{ e: number }>(
      'SELECT EXISTS(SELECT 1 FROM chapters WHERE bookId=? AND length(content)>?) AS e',
      [bookId, limit],
    )
    return (rows[0]?.e ?? 0) === 1
  }

  /* ───────────── BookDao: chapters ───────────── */

  getChaptersForBook(bookId: number): Promise<ChapterRow[]> {
    return this.db
      .query<ChapterRow>(
        `SELECT ${CHAPTER_COLUMNS} FROM chapters ORDER BY "chapterOrder" ASC`,
      )
      .then((rows) => rows.filter((row) => row.bookId === bookId));
  }

  getChaptersListForBook(bookId: number): Promise<ChapterRow[]> {
    return this.db
      .query<ChapterRow>(
        `SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE bookId = ? ORDER BY "chapterOrder" ASC`,
        [bookId],
      )
      .then((rows) => rows)
  }

  async getChaptersMetadataList(bookId: number): Promise<ChapterRow[]> {
    return this.db.query<ChapterRow>(
      'SELECT id, bookId, chapterOrder, title, startCharIndex, endCharIndex, \'\' as content FROM chapters WHERE bookId = ? ORDER BY chapterOrder ASC',
      [bookId],
    )
  }

  async searchChapters(bookId: number, query: string): Promise<ChapterRow[]> {
    return this.db.query<ChapterRow>(
      `SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE bookId = ? AND content LIKE '%' || ? || '%' ORDER BY "chapterOrder" ASC`,
      [bookId, query],
    )
  }

  async searchChaptersBatch(bookId: number, query: string, afterOrder: number): Promise<ChapterRow[]> {
    return this.db.query<ChapterRow>(
      `SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE bookId = ? AND chapterOrder > ? AND instr(lower(content), lower(?)) > 0 ORDER BY "chapterOrder" LIMIT 16`,
      [bookId, afterOrder, query],
    )
  }

  async getChaptersByOrders(bookId: number, chapterOrders: number[]): Promise<ChapterRow[]> {
    if (chapterOrders.length === 0) return []
    const placeholders = chapterOrders.map(() => '?').join(',')
    return this.db.query<ChapterRow>(
      `SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE bookId = ? AND "chapterOrder" IN (${placeholders})`,
      [bookId, ...chapterOrders],
    )
  }

  async insertChapters(chapters: ChapterRow[]): Promise<void> {
    for (const ch of chapters) {
      await this.db.execute(
        'INSERT OR REPLACE INTO chapters ("bookId", "chapterOrder", "title", "content", "startCharIndex", "endCharIndex") VALUES (?,?,?,?,?,?)',
        [ch.bookId, ch.chapterOrder, ch.title, ch.content, ch.startCharIndex, ch.endCharIndex],
      )
    }
  }

  insertChapter(ch: Omit<ChapterRow, 'id'>): Promise<number> {
    return this.db
      .execute(
        'INSERT INTO chapters ("bookId", "chapterOrder", "title", "content", "startCharIndex", "endCharIndex") VALUES (?,?,?,?,?,?)',
        [ch.bookId, ch.chapterOrder, ch.title, ch.content, ch.startCharIndex, ch.endCharIndex],
      )
      .then((res) => res.lastInsertRowId ?? 0);
  }

  /** Android BookDao.insertBookWithChapters @Transaction. */
  async insertBookWithChapters(book: Omit<BookRow, 'id'>, chapters: ChapterRow[]): Promise<BookRow> {
    await this.db.execute('BEGIN')
    try {
      const id = await this.insertBook(book)
      await this.insertChapters(chapters.map((c) => ({ ...c, bookId: id })))
      await this.db.execute('COMMIT')
      return { ...book, id }
    } catch (err) {
      await this.db.execute('ROLLBACK')
      throw err
    }
  }

  /* ───────────── BookDao: bookmarks ───────────── */

  async deleteBookmarksForBook(bookId: number): Promise<void> {
    await this.db.execute('DELETE FROM bookmarks WHERE bookId = ?', [bookId])
  }

  listBookmarks(bookId: number): Promise<BookmarkRow[]> {
    return this.db
      .query<BookmarkRow>(
        `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks ORDER BY "createdTime" DESC`,
      )
      .then((rows) => rows.filter((row) => row.bookId === bookId));
  }

  getBookmarksForBook(bookId: number): Promise<Bookmark[]> {
    return this.listBookmarks(bookId);
  }

  addBookmark(b: Omit<Bookmark, 'id'>): Promise<number> {
    return this.upsertBookmark(b).then(() =>
      this.db
        .query<BookmarkRow>(`SELECT ${BOOKMARK_COLUMNS} FROM bookmarks`)
        .then((rows) => {
          const match = rows.find(
            (row) => row.bookId === b.bookId && row.chapterIndex === b.chapterIndex,
          );
          return match?.id ?? 0;
        }),
    );
  }

  upsertBookmark(b: Omit<BookmarkRow, 'id'>): Promise<void> {
    return this.db
      .execute(
        'INSERT INTO bookmarks ("bookId", "chapterIndex", "scrollOffset", "title", "snippet", "createdTime") ' +
          'VALUES (?,?,?,?,?,?) ON CONFLICT("bookId", "chapterIndex") DO UPDATE SET ' +
          '"scrollOffset" = excluded."scrollOffset", "title" = excluded."title", ' +
          '"snippet" = excluded."snippet", "createdTime" = excluded."createdTime"',
        [b.bookId, b.chapterIndex, b.scrollOffset, b.title, b.snippet, b.createdTime],
      )
      .then(() => undefined);
  }

  insertBookmark(bookmark: Bookmark): Promise<void> {
    return this.upsertBookmark(bookmark)
  }

  deleteBookmark(id: number): Promise<void> {
    return this.db
      .execute('DELETE FROM bookmarks WHERE id = ?', [id])
      .then(() => undefined);
  }

  /* ───────────── BookDao: highlights ───────────── */

  async deleteHighlightsForBook(bookId: number): Promise<void> {
    await this.db.execute('DELETE FROM highlights WHERE bookId = ?', [bookId])
  }

  async getHighlightsForBook(bookId: number): Promise<HighlightRow[]> {
    const rows = await this.db.query<HighlightRow>(
      `SELECT ${HIGHLIGHT_COLUMNS} FROM highlights WHERE bookId = ? ORDER BY createdTime DESC`,
      [bookId],
    )
    return rows
  }

  async insertHighlight(highlight: HighlightRow): Promise<void> {
    if (highlight.id !== undefined && highlight.id > 0) {
      await this.db.execute(
        'INSERT OR REPLACE INTO highlights ("id", "bookId", "chapterIndex", "selectedText", "note", "colorHex", "createdTime") VALUES (?,?,?,?,?,?,?)',
        [highlight.id, highlight.bookId, highlight.chapterIndex, highlight.selectedText, highlight.note, highlight.colorHex, highlight.createdTime],
      );
      return;
    }
    await this.db.execute(
      'INSERT OR REPLACE INTO highlights ("bookId", "chapterIndex", "selectedText", "note", "colorHex", "createdTime") VALUES (?,?,?,?,?,?)',
      [highlight.bookId, highlight.chapterIndex, highlight.selectedText, highlight.note, highlight.colorHex, highlight.createdTime],
    )
  }

  async deleteHighlight(id: number): Promise<void> {
    await this.db.execute('DELETE FROM highlights WHERE id = ?', [id])
  }

  /* ───────────── BookDao: categories ───────────── */

  async getAllCategories(): Promise<CategoryRow[]> {
    return this.db.query<CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY id ASC`)
  }

  /**
   * Android BookDao.insertCategory (@Insert OnConflictStrategy.REPLACE).
   * Accepts either a category row or Android-style `(name, isProtected)` arguments.
   */
  insertCategory(category: CategoryRow | string, isProtected?: number): Promise<number> {
    const name = typeof category === 'string' ? category : category.name;
    const flag = typeof category === 'string' ? (isProtected ?? 0) : category.isProtected;
    return this.db
      .execute('INSERT OR REPLACE INTO categories ("name", "isProtected") VALUES (?,?)', [
        name,
        flag,
      ])
      .then((res) => res.lastInsertRowId ?? 0);
  }

  async deleteCategoryRow(category: CategoryRow): Promise<void> {
    await this.db.execute('DELETE FROM categories WHERE id = ?', [category.id ?? 0])
  }

  async getCategoryByName(name: string): Promise<CategoryRow | null> {
    const rows = await this.db.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE name = ? LIMIT 1`,
      [name],
    )
    return rows[0] ?? null
  }

  /** 第七轮第 6.3 条：切换分类密码保护标记。 */
  async setCategoryProtected(id: number, isProtected: boolean): Promise<void> {
    await this.db.execute('UPDATE categories SET isProtected = ? WHERE id = ?', [
      isProtected ? 1 : 0,
      id,
    ])
  }

  /** 第七轮第 6.2 条：删除分类时将其书籍迁回默认分类。 */
  async migrateBooksCategory(from: string, to: string): Promise<void> {
    await this.db.execute('UPDATE books SET category = ? WHERE category = ?', [to, from])
  }

  /* ───────────── BookDao: reading records ───────────── */

  async getReadingRecordsForDates(dates: string[]): Promise<ReadingRecordRow[]> {
    if (dates.length === 0) return []
    const placeholders = dates.map(() => '?').join(',')
    return this.db.query<ReadingRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM reading_records WHERE dateStr IN (${placeholders})`,
      dates,
    )
  }

  async getReadingRecordForBookAndDate(
    bookId: number,
    dateStr: string,
  ): Promise<ReadingRecordRow | null> {
    const rows = await this.db.query<ReadingRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM reading_records WHERE bookId = ? AND dateStr = ? LIMIT 1`,
      [bookId, dateStr],
    )
    return rows[0] ?? null
  }

  async getReadingRecordForTitleAndDate(
    bookTitle: string,
    dateStr: string,
  ): Promise<ReadingRecordRow | null> {
    const rows = await this.db.query<ReadingRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM reading_records WHERE bookId IS NULL AND bookTitle = ? AND dateStr = ? LIMIT 1`,
      [bookTitle, dateStr],
    )
    return rows[0] ?? null
  }

  async insertReadingRecord(record: ReadingRecordRow): Promise<void> {
    if (record.id !== undefined && record.id > 0) {
      await this.db.execute('UPDATE reading_records SET "bookId" = ?, "bookTitle" = ?, "dateStr" = ?, "durationSeconds" = ? WHERE id = ?',
        [record.bookId, record.bookTitle, record.dateStr, record.durationSeconds, record.id]);
      return;
    }
    await this.db.execute(
      'INSERT OR REPLACE INTO reading_records ("bookId", "bookTitle", "dateStr", "durationSeconds") VALUES (?,?,?,?)',
      [record.bookId, record.bookTitle, record.dateStr, record.durationSeconds],
    )
  }

  async nullifyBookIdInReadingRecords(bookId: number): Promise<void> {
    await this.db.execute('UPDATE reading_records SET bookId = NULL WHERE bookId = ?', [bookId])
  }

  async deleteReadingRecord(id: number): Promise<void> {
    await this.db.execute('DELETE FROM reading_records WHERE id = ?', [id])
  }

  async getAllReadingRecordsFlow(): Promise<ReadingRecordRow[]> {
    return this.db.query<ReadingRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM reading_records ORDER BY dateStr DESC`,
    )
  }

  async totalRecordedSeconds(): Promise<number> {
    const rows = await this.db.query<{ s: number }>(
      'SELECT COALESCE(SUM(durationSeconds),0) AS s FROM reading_records',
    )
    return rows[0]?.s ?? 0
  }

  async recordedSecondsForDate(date: string): Promise<number> {
    const rows = await this.db.query<{ s: number }>(
      'SELECT COALESCE(SUM(durationSeconds),0) AS s FROM reading_records WHERE dateStr=?',
      [date],
    )
    return rows[0]?.s ?? 0
  }

  /* ───────────── BookDao: reading sessions ───────────── */

  async insertReadingSession(session: ReadingSessionRow): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO reading_sessions ("bookId", "bookTitle", "dateStr", "startTimeMs", "endTimeMs", "durationSeconds", "startHour") VALUES (?,?,?,?,?,?,?)',
      [session.bookId, session.bookTitle, session.dateStr, session.startTimeMs, session.endTimeMs, session.durationSeconds, session.startHour],
    )
  }

  async getReadingSessionsForDate(dateStr: string): Promise<ReadingSessionRow[]> {
    return this.db.query<ReadingSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM reading_sessions WHERE dateStr = ? ORDER BY startTimeMs ASC`,
      [dateStr],
    )
  }

  async getReadingSessionsBetween(from: string, to: string): Promise<ReadingSessionRow[]> {
    return this.db.query<ReadingSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM reading_sessions WHERE dateStr BETWEEN ? AND ? ORDER BY startTimeMs ASC`,
      [from, to],
    )
  }

  async getDailyTotalsBetween(from: string, to: string): Promise<DailyReadingTotalRow[]> {
    return this.db.query<DailyReadingTotalRow>(
      'SELECT dateStr AS dateStr, SUM(durationSeconds) AS totalSeconds FROM reading_sessions WHERE dateStr BETWEEN ? AND ? GROUP BY dateStr',
      [from, to],
    )
  }

  async getMonthlyTotals(prefix: string): Promise<MonthlyReadingTotalRow[]> {
    return this.db.query<MonthlyReadingTotalRow>(
      'SELECT substr(dateStr, 1, 7) AS month, SUM(durationSeconds) AS totalSeconds FROM reading_sessions WHERE dateStr LIKE ? GROUP BY month ORDER BY month',
      [prefix],
    )
  }

  async getYearlyTotals(): Promise<YearlyReadingTotalRow[]> {
    return this.db.query<YearlyReadingTotalRow>(
      'SELECT substr(dateStr, 1, 4) AS year, SUM(durationSeconds) AS totalSeconds FROM reading_sessions GROUP BY year ORDER BY year',
    )
  }

  async deleteReadingSessionsForBook(bookId: number): Promise<void> {
    await this.db.execute('DELETE FROM reading_sessions WHERE bookId = ?', [bookId])
  }

  async nullifyBookIdInReadingSessions(bookId: number): Promise<void> {
    await this.db.execute('UPDATE reading_sessions SET bookId = NULL WHERE bookId = ?', [bookId])
  }

  async getAllReadingSessionsFlow(): Promise<ReadingSessionRow[]> {
    return this.db.query<ReadingSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM reading_sessions ORDER BY startTimeMs DESC`,
    )
  }

  /* ───────────── BookRepository methods ───────────── */

  listChapters(bookId: number): Promise<ChapterRow[]> {
    return this.db
      .query<ChapterRow>('SELECT * FROM chapters ORDER BY "chapterOrder" ASC')
      .then((rows) => rows.filter((row) => row.bookId === bookId));
  }

  listCategories(): Promise<CategoryRow[]> {
    return this.db.query<CategoryRow>('SELECT * FROM categories');
  }

  getProgress(bookId: number): Promise<ReadingProgress | null> {
    return this.db
      .query<{
        currentChapterIndex: number;
        scrollOffset: number;
        isFinished: number;
        lastReadTime: number;
      }>(`SELECT ${PROGRESS_COLUMNS} FROM books WHERE "id" = ?`, [bookId])
      .then((rows) => {
        const row = rows[0];
        if (!row) {
          return null;
        }
        return {
          bookId,
          chapterIndex: row.currentChapterIndex,
          scrollOffset: row.scrollOffset,
          isFinished: row.isFinished === 1,
          lastReadTime: row.lastReadTime,
        };
      });
  }

  async updateBookProgress(
    bookId: number,
    chapterIndex: number,
    scrollOffset: number,
    isFinished: boolean,
    expectedEpoch: number = contentMutationGate.epoch,
  ): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      if (expectedEpoch !== contentMutationGate.epoch) return
      await this.progressWriteMutex.withLock(async () => {
        const book = await this.getBook(bookId)
        if (book == null) return
        if (
          book.currentChapterIndex === chapterIndex &&
          book.scrollOffset === scrollOffset &&
          (book.isFinished === 1 || !isFinished)
        ) {
          return
        }
        await this.updateProgress(
          bookId,
          Math.max(0, chapterIndex),
          Math.max(0, scrollOffset),
          isFinished,
          Date.now(),
        )
      })
    })
  }

  saveProgress(
    bookId: number,
    chapterIndex: number,
    scrollOffset: number,
    isFinished = false,
    lastReadTime = Date.now(),
  ): Promise<void> {
    return this.getBook(bookId).then((book) => {
      if (!book) {
        return;
      }
      const finishedFlag = isFinished ? 1 : 0;
      const alreadyFinished = book.isFinished === 1;
      if (
        book.currentChapterIndex === chapterIndex &&
        book.scrollOffset === scrollOffset &&
        (alreadyFinished || !isFinished)
      ) {
        return;
      }
      return this.db
        .execute(
          'UPDATE books SET "currentChapterIndex" = ?, "scrollOffset" = ?, "isFinished" = ?, "lastReadTime" = ? WHERE "id" = ?',
          [
            Math.max(0, chapterIndex),
            Math.max(0, scrollOffset),
            alreadyFinished || finishedFlag === 1 ? 1 : 0,
            lastReadTime,
            bookId,
          ],
        )
        .then(() => undefined);
    });
  }

  async getChaptersMetadataListForRepository(bookId: number): Promise<ChapterRow[]> {
    return this.getChaptersMetadataList(bookId)
  }

  /** Android splitOversizedChaptersInLibrary (DB-only portion). */
  async splitOversizedChaptersInLibrary(): Promise<void> {
    // Kotlin BookRepository.kt:586-589 wraps the whole body in `try { … } catch (t:
    // Throwable) { if (t is CancellationException) throw t; Log.e("BookImport",
    // "splitOversizedChaptersInLibrary failed", t) }`, so a failure on ONE book cannot
    // abort the sweep over the rest of the library. The body lives in the private helper so
    // this wrapper stays a faithful one-to-one port of the Kotlin `try`/`catch`.
    return contentMutationGate.mutex.withLock(async () => {
      try {
        await this.splitOversizedChaptersInLibraryLocked();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        (this.logError ?? (() => {}))('BookImport', 'splitOversizedChaptersInLibrary failed', e);
      }
    });
  }

  /** BookRepository.kt:513-584 — the body of `splitOversizedChaptersInLibrary`. */
  private async splitOversizedChaptersInLibraryLocked(): Promise<void> {
    {
      const books = await this.getAllBooks()
      for (const book of books) {
        if (isComicBook(book) || !(await this.hasOversizedChapter(book.id ?? 0, 30_000))) continue
        const chapters = await this.getChaptersListForBook(book.id ?? 0)
        if (chapters.length === 0 || chapters.every((c) => c.content.length <= 30_000)) continue

        const bookmarksBefore = await this.getBookmarksForBook(book.id ?? 0)
        const charOffsets = this.settings != null ? await this.settings.pageTurnMode() !== 4 : true
        if (!charOffsets && (book.scrollOffset > 0 || bookmarksBefore.some((b) => b.scrollOffset > 0))) continue

        const starts = new Map<number, number>()
        const replacement: ChapterRow[] = []
        let order = 0
        for (const ch of chapters) {
          starts.set(ch.chapterOrder, order)
          if (ch.content.length <= 30_000) {
            replacement.push({ ...ch, chapterOrder: order++ })
          } else {
            const parts = splitChapterText(ch.content)
            parts.forEach((part, index) => {
              replacement.push({
                id: index === 0 ? (ch.id ?? 0) : 0,
                bookId: ch.bookId,
                chapterOrder: order++,
                title: index === 0 ? ch.title : `${ch.title} (续${index + 1})`,
                content: part,
                startCharIndex: 0,
                endCharIndex: 0,
              })
            })
          }
        }

        await this.db.execute('BEGIN')
        try {
          const fresh = await this.getBook(book.id ?? 0)
          if (fresh == null) {
            await this.db.execute('COMMIT')
            continue
          }
          const bookmarks = await this.getBookmarksForBook(book.id ?? 0)
          const highlights = await this.getHighlightsForBook(book.id ?? 0)
          await this.deleteChaptersForBook(book.id ?? 0)
          await this.insertChapters(replacement)
          await this.deleteBookmarksForBook(book.id ?? 0)
          for (const bm of bookmarks) {
            const start = starts.get(bm.chapterIndex) ?? -1
            const end = starts.get(bm.chapterIndex + 1) ?? Number.MAX_SAFE_INTEGER
            const candidatesParts = replacement.filter(
              (r) => r.chapterOrder >= start && r.chapterOrder < end,
            )
            let offset = charOffsets ? bm.scrollOffset : 0
            let target = candidatesParts[0]
            if (charOffsets) {
              for (const part of candidatesParts) {
                target = part
                if (offset < part.content.length) break
                offset -= part.content.length
              }
            }
            await this.insertBookmark({
              ...bm,
              chapterIndex: target?.chapterOrder ?? bm.chapterIndex,
              scrollOffset: charOffsets ? Math.max(0, offset) : bm.scrollOffset,
            })
          }
          for (const h of highlights) {
            const lower = starts.get(h.chapterIndex) ?? h.chapterIndex
            const upper = starts.get(h.chapterIndex + 1) ?? Number.MAX_SAFE_INTEGER
            const anchored = replacement.filter(
              (r) => r.chapterOrder >= lower && r.chapterOrder < upper && r.content.includes(h.selectedText),
            )
            await this.insertHighlight({
              ...h,
              chapterIndex: anchored.length === 1 ? (anchored[0] as ChapterRow).chapterOrder : lower,
            })
          }
          let remaining = charOffsets ? fresh.scrollOffset : 0
          const begin = starts.get(fresh.currentChapterIndex) ?? fresh.currentChapterIndex
          const end = starts.get(fresh.currentChapterIndex + 1) ?? Number.MAX_SAFE_INTEGER
          let target = begin
          if (charOffsets) {
            for (const part of replacement.filter((r) => r.chapterOrder >= begin && r.chapterOrder < end)) {
              target = part.chapterOrder
              if (remaining < part.content.length) break
              remaining -= part.content.length
            }
          }
          await this.updateBook({
            ...fresh,
            totalChapters: replacement.length,
            currentChapterIndex: target,
            scrollOffset: charOffsets ? Math.max(0, remaining) : fresh.scrollOffset,
          })
          await this.db.execute('COMMIT')
        } catch (err) {
          await this.db.execute('ROLLBACK')
          throw err
        }
        // BookRepository.kt:578
        // `Log.i("BookImport", "Split oversized chapters for '${book.title}': ${chapters.size} -> ${replacement.size}")`
        ;(this.log ?? (() => {}))(
          'BookImport',
          `Split oversized chapters for '${book.title}': ${String(chapters.length)} -> ${String(replacement.length)}`,
        )
      }
      try {
        await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch {
        // ignore — not all sqlite hosts expose WAL
      }
    }
  }

  async deleteChaptersForBook(bookId: number): Promise<void> {
    await this.db.execute('DELETE FROM chapters WHERE bookId = ?', [bookId])
  }

  /** Replace a parsed download atomically while retaining the original book identity and annotations. */
  async mergeDownloadedNovel(parsed: BookRow, sourceId: string, resourceId: string, replace: boolean): Promise<BookRow> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN');
      try {
        const old = await this.getBookBySourceResource(sourceId, resourceId);
        if (isComicBook(parsed)) throw new Error('下载内容不是文字小说');
        if (!old || old.id === parsed.id) {
          const linked = { ...parsed, sourceId, comicId: resourceId };
          await this.updateBook(linked);
          await this.db.execute('COMMIT');
          return linked;
        }
        if (!replace) {
          await this.deleteChaptersForBook(parsed.id!);
          await this.deleteBook(parsed);
          await this.db.execute('COMMIT');
          return old;
        }
        const before = await this.listChapters(old.id!);
        const after = await this.listChapters(parsed.id!);
        if (!after.length) throw new Error('新版没有可读正文，保留旧书');
        const oldTitles = new Set(before.map((chapter) => cleanSplitTitle(chapter.title)));
        const newTitles = new Set(after.map((chapter) => cleanSplitTitle(chapter.title)));
        if ([...oldTitles].some((title) => !newTitles.has(title))) throw new Error('新版缺少原有章节，已保留旧书；请等待源站补齐下载包');
        const mapped = (index: number): number => {
          const title = before[index]?.title;
          if (title === undefined) return Math.min(Math.max(0, index), after.length - 1);
          const occurrence = before.slice(0, index).filter((chapter) => chapter.title === title).length;
          return after.map((chapter, at) => ({ chapter, at })).filter(({ chapter }) => chapter.title === title)[occurrence]?.at
            ?? Math.max(0, after.findIndex((chapter) => cleanSplitTitle(chapter.title) === cleanSplitTitle(title)));
        };
        const bookmarks = await this.getBookmarksForBook(old.id!);
        const highlights = await this.getHighlightsForBook(old.id!);
        contentMutationGate.invalidatePendingWrites();
        await this.deleteChaptersForBook(old.id!);
        await this.insertChapters(after.map(({ id: _id, ...chapter }) => ({ ...chapter, bookId: old.id! })));
        await this.deleteChaptersForBook(parsed.id!);
        await this.deleteBook(parsed);
        await this.deleteBookmarksForBook(old.id!);
        for (const bookmark of bookmarks) await this.insertBookmark({ ...bookmark, chapterIndex: mapped(bookmark.chapterIndex) });
        for (const highlight of highlights) await this.insertHighlight({ ...highlight, chapterIndex: mapped(highlight.chapterIndex) });
        const merged = { ...old, filePath: parsed.filePath, author: parsed.author, coverUri: parsed.coverUri ?? old.coverUri,
          totalChapters: after.length, currentChapterIndex: mapped(old.currentChapterIndex), isFinished: newTitles.size > oldTitles.size ? 0 : old.isFinished };
        await this.updateBook(merged);
        await this.db.execute('COMMIT');
        return merged;
      } catch (error) { await this.db.execute('ROLLBACK'); throw error; }
    });
  }

  /** Android deleteBook — DB portion only (god moments / download tasks / file cleanup are platform). */
  async deleteBookDb(book: BookRow): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        await this.nullifyBookIdInReadingRecords(book.id ?? 0)
        await this.nullifyBookIdInReadingSessions(book.id ?? 0)
        await this.deleteBookmarksForBook(book.id ?? 0)
        await this.deleteHighlightsForBook(book.id ?? 0)
        await this.deleteChaptersForBook(book.id ?? 0)
        await this.deleteBook(book)
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  /** Android reconcileLegacyReadingTotals. */
  async reconcileLegacyReadingTotals(prefs: PreferencesManager): Promise<void> {
    if (await prefs.readingTotalsReconciled) return
    const oldTotal = Math.max(0, await prefs.totalReadTimeSeconds())
    const daily = await prefs.legacyDailyTotals()
    await this.db.execute('BEGIN')
    try {
      for (const [date, seconds] of daily) {
        const recorded = await this.recordedSecondsForDate(date)
        if (seconds > recorded) {
          await this.insertReadingRecord({
            bookId: null,
            bookTitle: '历史阅读记录',
            dateStr: date,
            durationSeconds: seconds - recorded,
          })
        }
      }
      await this.db.execute('COMMIT')
    } catch (err) {
      await this.db.execute('ROLLBACK')
      throw err
    }
    // Older versions sometimes kept only an all-time counter: retain it without inventing a date.
    const legacyUnattributed = await prefs.legacyUnattributedSeconds
    const total = await this.totalRecordedSeconds()
    await prefs.legacyUnattributedSecondsSet(Math.max(legacyUnattributed, oldTotal - total))
    await prefs.setReadingTotalsReconciled(true)
  }

  /** Android addReadingTime. */
  async addReadingTime(
    bookId: number | null,
    title: string,
    slices: Array<{ date: string; seconds: number }>,
    expectedEpoch: number = contentMutationGate.epoch,
    prefs?: PreferencesManager | undefined,
  ): Promise<boolean> {
    return contentMutationGate.mutex.withLock(async () => {
      if (expectedEpoch !== contentMutationGate.epoch) return false
      if (prefs != null) await this.reconcileLegacyReadingTotals(prefs)
      await this.db.execute('BEGIN')
      try {
        for (const part of slices) {
          if (part.seconds <= 0) continue
          const existing =
            bookId != null
              ? await this.getReadingRecordForBookAndDate(bookId, part.date)
              : await this.getReadingRecordForTitleAndDate(title, part.date)
          await this.insertReadingRecord(
            existing != null
              ? { ...existing, durationSeconds: existing.durationSeconds + part.seconds }
              : {
                  bookId,
                  bookTitle: title,
                  dateStr: part.date,
                  durationSeconds: part.seconds,
                },
          )
        }
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
      return true
    })
  }

  /** Android addReadingSession. */
  async addReadingSession(session: ReadingSessionRow, expectedEpoch: number = contentMutationGate.epoch): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
    if (expectedEpoch !== contentMutationGate.epoch) return;
    await this.db.execute('BEGIN')
    try {
      for (const part of splitReadingTimeSlices(session.startTimeMs, session.endTimeMs, session.durationSeconds)) {
        if (part.seconds > 0) {
          await this.insertReadingSession({
            ...session,
            id: 0,
            dateStr: part.date,
            startTimeMs: part.start,
            endTimeMs: part.end,
            durationSeconds: part.seconds,
            startHour: part.hour,
          })
        }
      }
      await this.db.execute('COMMIT')
    } catch (err) {
      await this.db.execute('ROLLBACK')
      throw err
    }
    });
  }

  async deleteReadingRecordById(id: number): Promise<void> {
    return this.deleteReadingRecord(id)
  }

  /** Android BookRepository.getBookmarksForBook (Android name: getBookmarks in UI/tests). */
  getBookmarks(bookId: number): Promise<Bookmark[]> {
    return this.getBookmarksForBook(bookId)
  }

  /** Android BookRepository.deleteBookmark. */
  removeBookmark(id: number): Promise<void> {
    return this.deleteBookmark(id)
  }

  /**
   * AppDatabase.downloadTaskDao().insertTask (OnConflictStrategy.REPLACE)。
   * 用标准 UPSERT（SQLite ≥3.24）表达 REPLACE 语义：命中主键时覆盖整行。
   */
  async upsertDownloadTask(task: DownloadTaskRow): Promise<void> {
    const upsertColumns = DOWNLOAD_TASK_COLUMNS.split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '"id"')
    const setClause = upsertColumns.map((c) => `${c}=excluded.${c}`).join(', ')
    await this.db.execute(
      `INSERT INTO download_tasks (${DOWNLOAD_TASK_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ` +
        `ON CONFLICT("id") DO UPDATE SET ${setClause}`,
      [
        task.id,
        task.sourceId,
        task.title,
        task.author,
        task.coverUrl,
        task.downloadUrl,
        task.format,
        task.status,
        task.downloadedBytes,
        task.totalBytes,
        task.filePath,
        task.errorMessage,
        task.updatedAt,
      ],
    )
  }

  /** AppDatabase.downloadTaskDao().getAllTasksSync(). */
  listDownloadTasks(): Promise<DownloadTaskRow[]> {
    return this.db.query<DownloadTaskRow>(`SELECT ${DOWNLOAD_TASK_COLUMNS} FROM download_tasks`)
  }

  async addHighlight(highlight: HighlightRow): Promise<void> {
    return this.insertHighlight(highlight)
  }

  async addCategory(name: string): Promise<void> {
    const existing = await this.getCategoryByName(name)
    if (existing == null) {
      await this.insertCategory({ name, isProtected: 0 })
    }
  }

  /** 幂等种子：确保「默认」分类始终存在。 */
  async ensureDefaultCategory(): Promise<void> {
    if ((await this.getCategoryByName(DEFAULT_CATEGORY)) == null) {
      await this.insertCategory({ name: DEFAULT_CATEGORY, isProtected: 0 })
    }
  }

  /** 第七轮第 6.1/6.2 条：删除分类。返回 true = 已删除；false = 被拒绝（默认分类）。 */
  async deleteCategory(category: CategoryRow): Promise<boolean> {
    if (category.name === DEFAULT_CATEGORY) return false
    await this.db.execute('BEGIN')
    try {
      await this.migrateBooksCategory(category.name, DEFAULT_CATEGORY)
      await this.deleteCategoryRow(category)
      await this.db.execute('COMMIT')
    } catch (err) {
      await this.db.execute('ROLLBACK')
      throw err
    }
    return true
  }

  /** 第七轮第 6.3 条：设置分类的密码保护标记。 */
  async setCategoryProtectedFlag(categoryId: number, isProtected: boolean): Promise<void> {
    return this.setCategoryProtected(categoryId, isProtected)
  }

  /** Android importUnsupportedFormat (text import path). */
  async importUnsupportedFormat(fileName: string): Promise<BookRow> {
    const cleanTitle = fileName.includes('.')
      ? fileName.slice(0, fileName.lastIndexOf('.'))
      : fileName
    const title = cleanTitle !== '' ? cleanTitle : fileName
    const book: Omit<BookRow, 'id'> = {
      title,
      author: '未知作者',
      filePath: fileName,
      coverUri: null,
      category: DEFAULT_CATEGORY,
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 1,
      contentType: 'NOVEL',
      addedTime: Date.now(),
      lastReadTime: Date.now(),
      sourceId: null,
      comicId: null,
    }
    const bookId = await this.insertBook(book)
    await this.insertChapters([
      {
        id: 0,
        bookId,
        chapterOrder: 0,
        title: UNSUPPORTED_CHAPTER_TITLE,
        content: '',
        startCharIndex: 0,
        endCharIndex: 0,
      },
    ])
    return { ...book, id: bookId, totalChapters: 1 }
  }

  /**
   * Android importBookUnchecked — streaming plain-text import.
   * Content is provided by the caller (decoded text lines) so this stays platform-free.
   */
  async importTextBook(
    fileName: string,
    lines: AsyncIterable<string> | Iterable<string>,
    opts?: { sourceId?: string | null; comicId?: string | null },
  ): Promise<BookRow> {
    const uriKey = fileName
    const existing = await this.getBookByFilePath(uriKey)
    if (existing != null) {
      return existing
    }
    // KFX/DJVU 等无阅读管线的格式：只登记书架，不按文本解析。
    if (
      UNSUPPORTED_BINARY_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext))
    ) {
      return this.importUnsupportedFormat(fileName)
    }
    let hasChapters = false
    /**
     * AUDIT FIX — Android opens the book with
     *   `var currentTitle = if (hasChapters) "前言" else "第 1 部分"`
     * where `hasChapters` comes from the **pre-pass** `hasChapterTitles(uri, charset)`.
     * Text that appears *before* the first chapter heading is therefore stored under
     * 「前言」 when the book does have chapter headings. The first TS pass hard-coded
     * 「第 1 部分」 for every book, so pre-heading content landed in a differently-titled
     * chapter on iOS. `hasChapters` is discovered lazily here (single pass over the
     * supplied iterable instead of a second read of the file), so the opening title is
     * resolved at emit time — by then `hasChapters` already reflects the heading we are
     * about to switch on, exactly like the Android pre-pass result.
     */
    let sawChapterHeading = false
    const openingTitle = (): string => (hasChapters ? '前言' : '第 1 部分')
    // Caller is responsible for detecting chapter titles; detect from first 20k lines.
    const title = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName
    const initialBook: Omit<BookRow, 'id'> = {
      title,
      author: '未知作者',
      filePath: uriKey,
      coverUri: null,
      category: DEFAULT_CATEGORY,
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 0,
      contentType: 'NOVEL',
      addedTime: Date.now(),
      lastReadTime: Date.now(),
      sourceId: opts?.sourceId ?? null,
      comicId: opts?.comicId ?? null,
    }
    const bookId = await this.insertBook(initialBook)

    const chapterPattern = CHAPTER_TITLE_PATTERN
    const batch: ChapterRow[] = []
    let chapterCount = 0
    let currentTitle = '第 1 部分'
    let content = ''
    let lineCount = 0

    const emit = async (chapterTitle: string, text: string): Promise<void> => {
      // Before the first chapter heading is seen, `chapterTitle` is still the opening
      // placeholder — resolve it against the (now known) chapter-detection result.
      const resolvedTitle = sawChapterHeading ? chapterTitle : openingTitle()
      const parts = splitChapterText(text)
      parts.forEach((part, index) => {
        batch.push({
          id: 0,
          bookId,
          chapterOrder: chapterCount++,
          title: index === 0 ? resolvedTitle : `${resolvedTitle} (续${index + 1})`,
          content: part,
          startCharIndex: 0,
          endCharIndex: 0,
        })
      })
      if (batch.length >= 50) {
        await this.insertChapters(batch)
        batch.length = 0
      }
    }

    for await (const rawLine of lines as AsyncIterable<string>) {
      // Android `hasChapterTitles` scans at most 20000 lines: `while (readLine() != null)
      // { lineCount++; …check pattern…; if (lineCount > 20000) break }`. The check runs
      // *before* the break, so line 20001 is still inspected.
      if (++lineCount <= 20001 && !hasChapters) {
        const probe = rawLine.trim().replace(/^\uFEFF/, '')
        if (probe !== '' && chapterPattern.test(probe)) hasChapters = true
      }
      const cleanLine = rawLine.trim().replace(/^\uFEFF/, '')
      if (hasChapters && cleanLine !== '' && chapterPattern.test(cleanLine)) {
        if (content !== '') await emit(currentTitle, content)
        currentTitle = cleanLine
        sawChapterHeading = true
        content = ''
      } else {
        if (content !== '') content += '\n'
        content += rawLine.replace(/^\uFEFF/, '')
        const limit = hasChapters ? 30_000 : 5000
        if (content.length >= limit) {
          await emit(currentTitle, content)
          content = ''
          // Android: `if (hasChapters) ChapterMerger.cleanSplitTitle(currentTitle) + " (续)"
          // else "第 ${chapterCount + 1} 部分"`. `cleanSplitTitle` strips an existing
          // 「(续)」 suffix first, so a long chapter yields 「第一章 (续)」 rather than
          // 「第一章 (续) (续) (续)」; the first TS pass appended blindly.
          currentTitle = hasChapters
            ? `${cleanSplitTitle(currentTitle)} (续)`
            : `第 ${chapterCount + 1} 部分`
        }
      }
    }
    if (content !== '') await emit(currentTitle, content)
    if (batch.length > 0) await this.insertChapters(batch)
    if (chapterCount === 0) throw new Error('文件中没有可阅读的正文')

    const book: BookRow = { ...initialBook, id: bookId, totalChapters: chapterCount }
    await this.updateBook(book)

    if (opts?.sourceId != null && opts.comicId != null) {
      const linked = { ...book, sourceId: opts.sourceId, comicId: opts.comicId }
      await this.updateBook(linked)
      return linked
    }
    return book
  }

  /**
   * Android `checkAndSeedDefaultBooks()` step 1 — DB half of
   * 「1. Remove legacy test / placeholder books」.
   *
   * AUDIT FIX (this was missing from the first pass): the Android method deletes the
   * pre-release sample books *before* seeding the guide book, so a device that once ran
   * a debug build never shows 《Ciallo Reader使用指南》 next to 《5页测试小说》.
   *
   * Android also deletes two files that are NOT reachable from core (filesystem is
   * injected, not imported):
   *   - `File(context.filesDir, "sample_comic").deleteRecursively()`
   *   - `File(context.cacheDir, "sample_epub3.epub").delete()`
   * The platform layer owns those two; see the note on this method's header.
   *
   * Android wraps the whole step in `try { … } catch (e: Exception) { Log.e(...) }`,
   * i.e. cleanup failures never block the guide seed — preserved here.
   */
  async cleanupLegacySampleBooks(): Promise<void> {
    try {
      const allBooks = await this.getAllBooksSync()
      const oldTestPaths = new Set(['sample_test_novel', 'sample_comic', 'sample_epub3.epub'])
      for (const book of allBooks) {
        if (
          oldTestPaths.has(book.filePath ?? '') ||
          book.title.includes('5页测试小说') ||
          book.title.includes('示例漫画') ||
          book.title.includes('示例 EPUB')
        ) {
          await this.deleteChaptersForBook(book.id ?? 0)
          await this.nullifyBookIdInReadingRecords(book.id ?? 0)
          await this.deleteBook(book)
        }
      }
    } catch {
      // android.util.Log.e("BookRepository", "Error cleaning old test books", e)
    }
  }

  /* ── Android BookRepository: disk accounting / orphan cleanup (Module B audit addendum) ──

  /**
   * 删除前预估这些书实际占用的磁盘字节（书体、封面、匹配的下载任务文件）。
   * 漫画的 filePath 是整章目录，需递归统计；同一路径只计一次。
   * Android BookRepository.kt lines 659..691.
   *
   * The filesystem and the download-task matcher are injected (core must not import
   * Capacitor). The accounting rules are preserved exactly: dedupe by canonical path,
   * recursive directory totals, the `.tmp` / `.resume` siblings next to each task file,
   * and the `runCatching` that returns the partial total on failure.
   */
  async booksDiskBytes(
    books: readonly BookRow[],
    fs?: BookRepositoryFileSystem,
    matchTasks?: (book: BookRow) => readonly DownloadTaskRow[],
  ): Promise<number> {
    if (fs === undefined) return 0;
    const countedPaths = new Set<string>();
    let total = 0;
    const addFile = (raw: string): void => {
      const path = stripFileScheme(raw);
      const key = fs.canonicalPath(path) ?? path;
      if (!countedPaths.add(key)) return;
      total += fs.isDirectory(path) ? fs.walkFileBytes(path) : fs.length(path);
    };
    try {
      const tasks = await this.listDownloadTasks();
      for (const book of books) {
        addFile(book.filePath ?? '');
        if (book.coverUri != null) addFile(book.coverUri);
        const matching = matchTasks !== undefined ? matchTasks(book) : defaultMatchTasks(book, tasks);
        for (const task of matching) {
          addFile(task.filePath ?? '');
          const base = baseNameWithoutExtension(task.filePath ?? '');
          addFile(DOWNLOADS_DIR + '/' + base + '.tmp');
          addFile(DOWNLOADS_DIR + '/' + base + '.resume');
        }
      }
    } catch {
      // Android: runCatching { … } swallows and returns the accumulated `total`.
    }
    return total;
  }

  /**
   * Android BookRepository.kt lines 726..751 — deletes files that no book and no download
   * task owns and that are older than 7 days: stray `imports/` files, orphaned `comics_*`
   * directories directly under filesDir, and `downloads/*.tmp` / `*.resume` leftovers.
   *
   * `comicDirs` are the live comic download directories; Android reads them from
   * `ComicDownloadManager.tasks.value.keys`, so the caller supplies them.
   */
  async cleanupOrphanFiles(
    fs?: BookRepositoryFileSystem,
    now: number = Date.now(),
    comicDirs: readonly string[] = [],
  ): Promise<void> {
    if (fs === undefined) return;
    return contentMutationGate.mutex.withLock(async () => {
      const books = await this.getAllBooksSync();
      const tasks = await this.listDownloadTasks();
      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      const root = fs.filesDir();
      const owned = new Set(books.map((b) => fs.canonicalPath(stripFileScheme(b.filePath ?? '')) ?? ''));
      const live = new Set(comicDirs.map((d) => fs.canonicalPath(d) ?? d));

      // 1) `File(root,"imports").listFiles().filter { it.isFile && it.lastModified()<cutoff && it.canonicalPath !in owned }`
      for (const it of fs.listFiles(root + '/imports')) {
        if (fs.isDirectory(it) || fs.lastModified(it) >= cutoff) continue;
        if (!owned.has(fs.canonicalPath(it) ?? it)) fs.delete(it);
      }
      // 2) root children named `comics_*`, still DIRECT children of root
      for (const it of fs.listFiles(root)) {
        if (!fileNameOf(it).startsWith('comics_')) continue;
        if (!fs.isDirectory(it) || fs.lastModified(it) >= cutoff) continue;
        const canonical = fs.canonicalPath(it) ?? it;
        if (owned.has(canonical) || live.has(canonical)) continue;
        if (fs.parent(canonical) !== (fs.canonicalPath(root) ?? root)) continue;
        fs.deleteRecursively(it);
      }
      // 3) downloads/*.tmp|*.resume with no live task base name
      const taskBases = new Set(tasks.map((t) => baseNameWithoutExtension(t.filePath ?? '')));
      for (const it of fs.listFiles(root + '/downloads')) {
        if (fs.isDirectory(it) || fs.lastModified(it) >= cutoff) continue;
        const ext = extensionOf(it);
        if (ext !== 'tmp' && ext !== 'resume') continue;
        if (taskBases.has(baseNameWithoutExtension(it))) continue;
        fs.delete(it);
      }
    });
  }
  /** Android checkAndSeedDefaultBooks — seed/update the Ciallo guide book. */
  async checkAndSeedDefaultBooks(): Promise<void> {
    await this.cleanupLegacySampleBooks()
    const guideFilePath = 'ciallo_guide_novel'
    const existingGuideCount = await this.getBookCountByFilePath(guideFilePath)
    if (existingGuideCount === 0) {
      const guideBook: Omit<BookRow, 'id'> = {
        title: "《Ciallo Reader使用指南》",
        author: "Ciallo Reader团队",
        filePath: guideFilePath,
        coverUri: null,
        category: DEFAULT_CATEGORY,
        currentChapterIndex: 0,
        scrollOffset: 0,
        isFinished: 0,
        totalChapters: 7,
        contentType: 'NOVEL',
        addedTime: Date.now(),
        lastReadTime: Date.now(),
        sourceId: null,
        comicId: null,
      }
      const bookId = await this.insertBook(guideBook)
      await this.insertChapters(GUIDE_CHAPTERS(bookId))
    }
    const guideBook = await this.getBookByFilePath(guideFilePath)
    if (guideBook != null) {
      const existingChapters = await this.getChaptersListForBook(guideBook.id ?? 0)
      const newChapterTitle = '第七章：在线书库、成人源与漫画标签'
      const existingChapter = existingChapters.find((c) => c.title === newChapterTitle)
      if (existingChapter == null) {
        const nextOrder =
          existingChapters.reduce((max, c) => Math.max(max, c.chapterOrder), -1) + 1
        await this.insertChapters([
          {
            id: 0,
            bookId: guideBook.id ?? 0,
            chapterOrder: nextOrder,
            title: newChapterTitle,
            content: GUIDE_CH7,
            startCharIndex: 0,
            endCharIndex: 0,
          },
        ])
      } else if (existingChapter.content !== GUIDE_CH7) {
        await this.insertChapters([
          {
            ...existingChapter,
            content: GUIDE_CH7,
          },
        ])
      }
      const chapterCount = (await this.getChaptersListForBook(guideBook.id ?? 0)).length
      if (guideBook.totalChapters < chapterCount) {
        await this.updateBook({ ...guideBook, totalChapters: chapterCount })
      }
    }
  }
}

function GUIDE_CHAPTERS(bookId: number): ChapterRow[] {
  return [
    {
      id: 0,
      bookId,
      chapterOrder: 0,
      title: "第一章：欢迎使用 Ciallo Reader",
      content: "欢迎使用 Ciallo Reader！\n\nCiallo Reader是一款专为二次元与小说/漫画爱好者打造的极简、流畅且充满陪伴感的高品质阅读应用。\n\n无论你是喜爱阅读长篇网络小说、经典文学著作，还是习惯追更日漫与条漫，Ciallo Reader都能为你提供极佳的阅读排版体验与智能贴心的辅助功能。\n\n本指南将带你快速了解 Ciallo Reader的各项核心功能与使用技巧，帮助你开启一段惬意的阅读之旅。",
      startCharIndex: 0,
      endCharIndex: 0,
    },
    {
      id: 0,
      bookId,
      chapterOrder: 1,
      title: "第二章：书架管理与图书导入",
      content: "【图书导入与支持格式】\n1. 点击书架右上角或底部的「+」导入按钮，即可从手机本地文件选择并导入图书。\n2. 应用原生支持 TXT 纯文本小说、EPUB 电子书以及 CBZ/ZIP/PDF 格式的漫画文件。\n\n【分类与搜索】\n• 可以在书架顶栏搜索框中快速搜索书名或作者名。\n• 支持创建自定义分类标签（如：奇幻、科幻、漫画、轻小说），长按书籍卡片即可方便地归类或编辑书籍信息。\n• 最近阅读区域将置顶显示你近期读过的书籍，方便一键继续阅读。",
      startCharIndex: 0,
      endCharIndex: 0,
    },
    {
      id: 0,
      bookId,
      chapterOrder: 2,
      title: "第三章：小说阅读与个性化排版",
      content: "【精确排版引擎】\nCiallo Reader采用了基于真实控件高度与逐行测量的动态排版算法。无论在竖屏还是横屏下切换，文字都不会出现被半截切断或丢失漏行的现象，同时会自动保持位置锚点衔接。\n\n【版式与主题定制】\n• 点击屏幕中央区域唤出阅读控制栏，点击「设置」图标即可调整：\n  - 字号大小与行间距\n  - 首行缩进与段落边距\n  - 阅读背景主题：包含羊皮纸、夜间深色、护眼绿、极简白等多款精心调配的色彩组合\n  - 字体切换：支持自定义系统字体与优雅衬线/无衬线体选择。",
      startCharIndex: 0,
      endCharIndex: 0,
    },
    {
      id: 0,
      bookId,
      chapterOrder: 3,
      title: "第四章：仿真翻页与书签互动",
      content: "【多样化翻页模式】\n应用内置了多种高帧率平滑翻页效果，可在阅读设置中自由切换：\n1. 仿真翻页：还原纸质书的卷角与平滑弯曲视差。\n2. 覆盖/平移：现代优雅的推移效果。\n3. 淡入淡出：柔和不刺眼的渐变过渡。\n4. 连续滚动：适合快速浏览的长图文模式。\n\n【书签与划词高亮】\n• 点击顶部控制栏的书签图标，或长按页面右上角即可快速添加书签。\n• 在正文中长按并拖动选取文字，可呼出高亮与笔记菜单，记录你的阅读心得与精彩名句。",
      startCharIndex: 0,
      endCharIndex: 0,
    },
    {
      id: 0,
      bookId,
      chapterOrder: 4,
      title: "第五章：漫画阅读器使用技巧",
      content: "【漫画专享优化】\n当你打开 CBZ / ZIP / PDF 漫画或图集时，Ciallo Reader会自动切换至专属漫画引擎：\n1. 支持双指自由缩放与双击快速放大图像，细节一览无余。\n2. 支持切换「横向翻页」与「纵向条漫」模式，满足不同漫画排版需求。\n3. 支持调整读向：可切换日漫（右至左）或欧美漫（左至右）阅读顺序。",
      startCharIndex: 0,
      endCharIndex: 0,
    },
    {
      id: 0,
      bookId,
      chapterOrder: 5,
      title: "第六章：Roxy 助手与阅读统计",
      content: "【看板娘 Roxy 动态陪伴】\n在阅读界面与应用主页中，可爱贴心的魔法少女 Roxy 会静静陪伴着你：\n• 添加书签或完成阅读目标时，Roxy 会展示萌趣的交互与魔法动画。\n• 互动响应流畅，并在连续触发时具备打断重播平滑过渡。\n\n【阅读统计与成就】\n进入「统计」标签页，可以直观查看你的总阅读时长、阅读天数、章节进度分布以及每日阅读趋势图表，记录你读过的点点滴滴。\n\n祝你阅读愉快！—— Ciallo Reader团队",
      startCharIndex: 0,
      endCharIndex: 0,
    },
  ]
}

const GUIDE_CH7 =
  "【在线书库与小说来源】\n在「书库」页顶部选择来源，按书名或作者搜索。可使用小说聚合搜索、已启用的在线书源和漫画源；来源列表可在设置的书源管理中更新或导入 Legado / JSON 书源。支持的在线来源与站点可用性会随网络和上游站点变化。\n\n【开启成人漫画源】\n1. 打开底部「设置」标签页。\n2. 连续点击六次「主色按钮实时联动效果」，显示「高级内容」。\n3. 打开「高级内容」中的「带你登大郎~~~」。\n4. 等待 Venera 漫画源列表更新完成，返回「书库」，在漫画书源选择器中选择需要的来源。\n关闭该开关后，成人源会从书库来源列表中隐藏。\n\n【漫画详情、书签与神回】\n漫画详情页可查看作品标签和章节；阅读时可为章节添加书签。作品详情提供神回入口，神回排行榜可查看热门章节。在线阅读会优先加载当前页并逐步载入后续图片；需要离线阅读时，可从章节列表下载章节。\n\n【下载与更新】\n小说支持整本下载与离线阅读；整本更新会保留原有阅读位置、书签和笔记。书库下载面板可查看任务进度，漫画下载支持暂停后继续。\n\n来源内容由第三方站点提供，请按当地法律和来源站点规则使用。"

export function createBookRepository(options: BookRepositoryOptions): BookRepository {
  return new BookRepository(options)
}

// Re-export download task types used by library consumers.
export type { DownloadTaskRow }

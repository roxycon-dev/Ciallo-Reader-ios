export type ContentType = 'novel' | 'comic'

/** Android Book.kt contentType column values. */
export const CONTENT_TYPE_NOVEL = 'NOVEL'
export const CONTENT_TYPE_COMIC = 'COMIC'

/** Book.kt — 不支持阅读的格式入库时使用的占位章节标题。 */
export const UNSUPPORTED_CHAPTER_TITLE = '暂不支持阅读'

/** Book.kt — 章节最大长度：超过则入库时拆分为多个小章节。 */
export const MAX_BOOK_CHAPTER_LENGTH = 30_000

/** Book.kt — 默认分类名（第七轮第 6.1 条）。 */
export const DEFAULT_CATEGORY = '默认'

export interface BookRow {
  id?: number
  title: string
  author: string | null
  filePath: string | null
  coverUri: string | null
  category: string | null
  currentChapterIndex: number
  scrollOffset: number
  isFinished: number
  totalChapters: number
  contentType: string
  addedTime: number
  lastReadTime: number
  sourceId: string | null
  comicId: string | null
}

/** Book.kt — isComic 计算属性。 */
export function isComicBook(book: Pick<BookRow, 'contentType'>): boolean {
  return book.contentType === CONTENT_TYPE_COMIC
}

export interface ReadingProgress {
  bookId: number
  chapterIndex: number
  scrollOffset: number
  isFinished: boolean
  lastReadTime: number
}

export interface ChapterRow {
  id?: number
  bookId: number
  chapterOrder: number
  title: string
  content: string
  startCharIndex: number
  endCharIndex: number
}

export interface CategoryRow {
  id?: number
  name: string
  isProtected: number
}

export interface Bookmark {
  id?: number
  bookId: number
  chapterIndex: number
  scrollOffset: number
  title: string
  snippet: string
  createdTime: number
}

export interface BookmarkRow {
  id?: number
  bookId: number
  chapterIndex: number
  scrollOffset: number
  title: string
  snippet: string
  createdTime: number
}

export interface DownloadTaskRow {
  id: string
  sourceId: string
  title: string
  author: string | null
  coverUrl: string | null
  downloadUrl: string | null
  format: string
  status: string
  downloadedBytes: number
  totalBytes: number
  filePath: string | null
  errorMessage: string | null
  updatedAt: number
}

export const DownloadStatus = {
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const

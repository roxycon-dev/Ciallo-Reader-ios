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

/**
 * `data/DownloadTaskEntity.kt` L23 `enum class DownloadStatus` —— **6 项**（含 `CANCELLED`）。
 *
 * 与 `download/downloadQueue.ts` 的同名联合类型必须完全一致；少一项就意味着
 * 「用户取消的任务」在书库侧没有状态可落。`tests/parity/enumTablesParity.test.ts`
 * 拿 Kotlin 原文逐项对拍。
 */
export const DownloadStatus = {
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

/** `DownloadStatus` 的声明顺序（= Kotlin 的 `ordinal`）。 */
export const DOWNLOAD_STATUSES: readonly (typeof DownloadStatus)[keyof typeof DownloadStatus][] = [
  'PENDING',
  'DOWNLOADING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]

/**
 * `Book.kt` L91-97 `@Entity(tableName = "categories") data class CategoryEntity`。
 *
 * 本条来自 `Book.kt`（Room 实体表 `categories`）：`id` 自增主键、`name` 分类名、
 * `isProtected` 密码保护标记（隐私模式开启时生效；长按分类或隐私窗口切换）。
 */
export interface CategoryEntity {
  readonly id: number
  readonly name: string
  readonly isProtected: boolean
}

/** `CategoryEntity` 的默认值（`id = 0` 表示尚未入库、`isProtected = false`）。 */
export function categoryEntity(name: string, isProtected = false): CategoryEntity {
  return { id: 0, name, isProtected }
}

/** `Book.kt` L89 `DEFAULT_CATEGORY = "默认"`（本文件契约/默认值区已有同名常量时会重复导出）。 */

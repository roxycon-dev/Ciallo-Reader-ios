/**
 * Favorite models — port of Android `FavoriteModels.kt`.
 */

import type { ComicChapter } from './comicSourceTypes'

/** 收藏默认分类。 */
export const FAV_DEFAULT_CATEGORY = '默认'

/** 「全部」是筛选伪分类，不是真实分类行。 */
export const ALL_FAV_CATEGORY_NAME = '全部'

/** 距上次检查超过这个间隔才联网检查更新。 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

/** 章节阅读状态：未读 / 阅读中 / 已读。存库用 code。 */
export const ChapterReadState = {
  UNREAD: 0,
  READING: 1,
  READ: 2,
} as const

export type ChapterReadStateCode = (typeof ChapterReadState)[keyof typeof ChapterReadState]

export function chapterReadStateOf(code: number): ChapterReadStateCode {
  if (code === ChapterReadState.UNREAD || code === ChapterReadState.READING || code === ChapterReadState.READ) {
    return code
  }
  return ChapterReadState.UNREAD
}

/** 连载状态快照（存字符串）。 */
export const SerialStatus = {
  UNKNOWN: 'unknown',
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  HIATUS: 'hiatus',
} as const

export type SerialStatusCode = (typeof SerialStatus)[keyof typeof SerialStatus]

export function serialStatusOf(raw: string | null | undefined): SerialStatusCode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'completed' || v === 'finished' || v === '已完结' || v === '完结' || v === '已完結' || v === '完結') {
    return SerialStatus.COMPLETED
  }
  if (v === 'ongoing' || v === '连载中' || v === '連載中' || v === '连载' || v === '連載') {
    return SerialStatus.ONGOING
  }
  if (v === 'hiatus' || v === 'paused' || v === '暂停' || v === '暫停' || v === '休刊') {
    return SerialStatus.HIATUS
  }
  return SerialStatus.UNKNOWN
}

/** Domain form of the favorites table (Room entity fields). */
export interface FavoriteEntity {
  sourceId: string
  comicId: string
  title: string
  author: string
  coverUrl: string | null
  localThumbPath: string | null
  serialStatus: string
  latestChapterId: string | null
  latestChapterTitle: string | null
  latestChapterUpdateAt: number
  lastCheckedAt: number
  sourceAlive: boolean
  categoryName: string
  favoritedAt: number
  sortOrder: number
}

/** SQL row for favorites (booleans stored as 0/1). */
export interface FavoriteRow {
  sourceId: string
  comicId: string
  title: string
  author: string
  coverUrl: string | null
  localThumbPath: string | null
  serialStatus: string
  latestChapterId: string | null
  latestChapterTitle: string | null
  latestChapterUpdateAt: number
  lastCheckedAt: number
  sourceAlive: number
  categoryName: string
  favoritedAt: number
  sortOrder: number
}

export function rowToFavorite(row: FavoriteRow): FavoriteEntity {
  return {
    sourceId: row.sourceId,
    comicId: row.comicId,
    title: row.title,
    author: row.author,
    coverUrl: row.coverUrl,
    localThumbPath: row.localThumbPath,
    serialStatus: row.serialStatus,
    latestChapterId: row.latestChapterId,
    latestChapterTitle: row.latestChapterTitle,
    latestChapterUpdateAt: row.latestChapterUpdateAt,
    lastCheckedAt: row.lastCheckedAt,
    sourceAlive: row.sourceAlive === 1,
    categoryName: row.categoryName,
    favoritedAt: row.favoritedAt,
    sortOrder: row.sortOrder,
  }
}

export function favoriteToRow(entity: FavoriteEntity): FavoriteRow {
  return {
    sourceId: entity.sourceId,
    comicId: entity.comicId,
    title: entity.title,
    author: entity.author,
    coverUrl: entity.coverUrl,
    localThumbPath: entity.localThumbPath,
    serialStatus: entity.serialStatus,
    latestChapterId: entity.latestChapterId,
    latestChapterTitle: entity.latestChapterTitle,
    latestChapterUpdateAt: entity.latestChapterUpdateAt,
    lastCheckedAt: entity.lastCheckedAt,
    sourceAlive: entity.sourceAlive ? 1 : 0,
    categoryName: entity.categoryName,
    favoritedAt: entity.favoritedAt,
    sortOrder: entity.sortOrder,
  }
}

/** 漫画级阅读进度。 */
export interface ComicProgressEntity {
  sourceId: string
  comicId: string
  lastChapterId: string | null
  lastChapterIndex: number
  lastPageIndex: number
  lastPageCount: number
  lastReadAt: number
  seenTopChapterId: string | null
  seenChapterCount: number
}

export interface ComicProgressRow {
  sourceId: string
  comicId: string
  lastChapterId: string | null
  lastChapterIndex: number
  lastPageIndex: number
  lastPageCount: number
  lastReadAt: number
  seenTopChapterId: string | null
  seenChapterCount: number
}

export function rowToProgress(row: ComicProgressRow): ComicProgressEntity {
  return { ...row }
}

/** 该章节是否读到「已读」判定线（最后一页 或 进度 ≥90%）。 */
export function isChapterFinished(progress: ComicProgressEntity): boolean {
  if (progress.lastPageCount <= 0) return false
  if (progress.lastPageIndex >= progress.lastPageCount - 1) return true
  return (progress.lastPageIndex + 1) / progress.lastPageCount >= 0.9
}

/** 「我喜欢的」的分类（与书架 categories 完全独立）。 */
export interface FavoriteCategoryEntity {
  name: string
  sortOrder: number
  createdAt: number
}

export interface FavoriteCategoryRow {
  name: string
  sortOrder: number
  createdAt: number
}

/** 章节级阅读状态。 */
export interface ChapterReadEntity {
  sourceId: string
  comicId: string
  chapterId: string
  status: number
  pageIndex: number
  pageCount: number
  chapterIndex: number
  updatedAt: number
  bookmarked: boolean
}

export interface ChapterReadRow {
  sourceId: string
  comicId: string
  chapterId: string
  status: number
  pageIndex: number
  pageCount: number
  chapterIndex: number
  updatedAt: number
  bookmarked: number
}

export function rowToChapterRead(row: ChapterReadRow): ChapterReadEntity {
  return {
    sourceId: row.sourceId,
    comicId: row.comicId,
    chapterId: row.chapterId,
    status: row.status,
    pageIndex: row.pageIndex,
    pageCount: row.pageCount,
    chapterIndex: row.chapterIndex,
    updatedAt: row.updatedAt,
    bookmarked: row.bookmarked === 1,
  }
}

export function chapterReadToRow(entity: ChapterReadEntity): ChapterReadRow {
  return {
    sourceId: entity.sourceId,
    comicId: entity.comicId,
    chapterId: entity.chapterId,
    status: entity.status,
    pageIndex: entity.pageIndex,
    pageCount: entity.pageCount,
    chapterIndex: entity.chapterIndex,
    updatedAt: entity.updatedAt,
    bookmarked: entity.bookmarked ? 1 : 0,
  }
}

/** UI 聚合模型：收藏 + 进度 + 已下载章节数。 */
export interface FavoriteItem {
  favorite: FavoriteEntity
  progress: ComicProgressEntity | null
  downloadedChapters: number
}

export function favoriteItemKey(item: FavoriteItem): string {
  return favoriteKey(item.favorite.sourceId, item.favorite.comicId)
}

export function alsoDownloaded(item: FavoriteItem): boolean {
  return item.downloadedChapters > 0
}

/** 三张表统一使用的业务主键。 */
export interface ComicKey {
  sourceId: string
  comicId: string
}

export function comicKeyRaw(key: ComicKey): string {
  return favoriteKey(key.sourceId, key.comicId)
}

/** 无来源信息的书不能被喜欢。 */
export function comicKeyValid(key: ComicKey): boolean {
  return key.sourceId.trim() !== '' && key.comicId.trim() !== ''
}

export function favoriteKey(sourceId: string, comicId: string): string {
  return `${sourceId}::${comicId}`
}

/** FavoriteRepository.kt — FavoriteAddRequest. */
export interface FavoriteAddRequest {
  bookId: string
  sourceId: string
  title: string
  author: string
  cover: string | null
  category: string
  chapters: ComicChapter[]
  favorites: FavoriteEntity[]
  candidates: DuplicateComicCandidate[]
  busy: boolean
  error: string | null
}

/** ComicFavoriteMatching.kt — DuplicateComicCandidate. */
export interface DuplicateComicCandidate {
  favorite: FavoriteEntity
  reason: string
  score: number
}

/** FavoriteRepository.kt / ComicChapterMatching.kt — migration report. */
export interface FavoriteMigrationReport {
  migrated: number
  unmatched: number
  resumeMatched: boolean
}

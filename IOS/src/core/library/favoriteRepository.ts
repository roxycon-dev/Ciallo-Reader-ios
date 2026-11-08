/**
 * Favorite repository — port of Android `FavoriteRepository.kt`.
 * Favorites / progress / downloads are independent; this is the single exit.
 */

import type { FileSystemApi } from '@platform/interfaces'
import { ChapterCatalog } from './chapterCatalog'
import { mapping as chapterMapping } from './comicChapterMatching'
import {
  type ComicSourceResolver,
  type ComicChapter,
  type SearchBook,
  type SourceResult,
} from './comicSourceTypes'
import { serialStatusOf, type FavoriteEntity, type ComicProgressEntity, type ChapterReadEntity, type FavoriteMigrationReport, type ComicKey, type FavoriteCategoryEntity, favoriteKey, comicKeyValid, FAV_DEFAULT_CATEGORY, ALL_FAV_CATEGORY_NAME, ChapterReadState, UPDATE_CHECK_INTERVAL_MS } from './favoriteTypes'
import type { FavoriteDao } from './favoriteDao'
import { ordered, isNewChapterObserved } from './comicReadingLogic'
import { AsyncMutex } from './contentMutationGate'

/** 简单信号量：全局并发 ≤3。 */
class Semaphore {
  private available: number
  private waiters: Array<() => void> = []

  constructor(permits: number) {
    this.available = permits
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available -= 1
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    try {
      return await fn()
    } finally {
      const next = this.waiters.shift()
      if (next) {
        next()
      } else {
        this.available += 1
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface FavoriteRepositoryOptions {
  dao: FavoriteDao
  comicSourceOf: ComicSourceResolver
  /** Optional: file system for ChapterCatalog (skip catalog if omitted). */
  fs?: FileSystemApi
}

export class FavoriteRepository {
  private readonly dao: FavoriteDao
  private readonly comicSourceOf: ComicSourceResolver
  private catalogContext: FileSystemApi | null
  private readonly catalogMutex = new AsyncMutex()
  private readonly updateGate = new Semaphore(3)
  private readonly lastRequestAt = new Map<string, number>()
  private checking = false

  constructor(options: FavoriteRepositoryOptions) {
    this.dao = options.dao
    this.comicSourceOf = options.comicSourceOf
    this.catalogContext = options.fs ?? null
  }

  setCatalogContext(fs: FileSystemApi | null): void {
    this.catalogContext = fs
  }

  /* ───────────── 收藏 ───────────── */

  favorites(): Promise<FavoriteEntity[]> {
    return this.dao.allFavorites()
  }

  /** 收藏主键集合（书架卡片小心心用）。 */
  async favoriteKeys(): Promise<Set<string>> {
    const keys = await this.dao.favoriteKeys()
    return new Set(keys)
  }

  /* ───────────── 收藏分类 ───────────── */

  favoriteCategories(): Promise<FavoriteCategoryEntity[]> {
    return this.dao.favoriteCategories()
  }

  async addFavoriteCategory(name: string): Promise<void> {
    if (name.trim() === '') return
    await this.dao.insertFavoriteCategory({
      name: name.trim(),
      sortOrder: (await this.dao.favoriteCategoriesSync()).length,
      createdAt: Date.now(),
    })
  }

  async renameFavoriteCategory(oldName: string, newName: string): Promise<void> {
    if (newName.trim() === '' || oldName === newName) return
    await this.dao.renameFavoriteCategoryCascade(oldName, newName.trim())
  }

  /** 删除分类：里面的收藏退回「默认」，绝不连带删除收藏本身。 */
  async deleteFavoriteCategory(name: string): Promise<void> {
    if (name === FAV_DEFAULT_CATEGORY) return
    await this.dao.deleteFavoriteCategoryAndRetag(name, FAV_DEFAULT_CATEGORY)
  }

  /** 保证分类存在。 */
  async ensureFavoriteCategory(name: string): Promise<void> {
    if (name.trim() === '' || name === ALL_FAV_CATEGORY_NAME) return
    const existing = await this.dao.favoriteCategoriesSync()
    if (existing.some((c) => c.name === name)) return
    await this.dao.insertFavoriteCategory({
      name,
      sortOrder: existing.length,
      createdAt: Date.now(),
    })
  }

  async isFavorite(sourceId: string, comicId: string): Promise<boolean> {
    return (await this.dao.favorite(sourceId, comicId)) != null
  }

  favoritesSnapshot(): Promise<FavoriteEntity[]> {
    return this.dao.allFavoritesSync()
  }

  async replaceFavorite(
    from: ComicKey,
    book: SearchBook,
    newChapters: ComicChapter[],
  ): Promise<FavoriteMigrationReport> {
    if (!comicKeyValid(from) || book.sourceId.trim() === '' || book.id.trim() === '') {
      throw new Error('invalid favorite key')
    }
    if (comicKeyRawSafe(from) === favoriteKey(book.sourceId, book.id)) {
      throw new Error('same key')
    }
    if (newChapters.length === 0) throw new Error('新来源暂无可用章节，暂时无法迁移')

    await this.catalogMutex.lock()
    try {
      const catalog = this.catalogContext != null ? new ChapterCatalog(this.catalogContext) : null
      let oldChapters = (await catalog?.read(from.sourceId, from.comicId)) ?? []
      if (oldChapters.length === 0) {
        const source = await this.comicSourceOf(from.sourceId)
        let loaded: SourceResult<ComicChapter[]> | null = null
        try {
          loaded = await Promise.race([
            source?.getChapters(from.comicId) ?? Promise.resolve(null),
            delay(15_000).then(() => null),
          ])
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') throw e
          loaded = null
        }
        if (loaded != null && loaded.kind === 'success') oldChapters = loaded.data
      }
      const map = chapterMapping(oldChapters, newChapters)
      const mappingIds = new Map<string, string>()
      for (const [k, v] of map) mappingIds.set(k, v.id)
      const ord = ordered(newChapters)
      const latest = ord[ord.length - 1]?.chapter ?? null
      const replacement: FavoriteEntity = {
        sourceId: book.sourceId,
        comicId: book.id,
        title: book.title,
        author: book.author,
        coverUrl: book.cover,
        localThumbPath: null,
        serialStatus: serialStatusOf(book.comicInfo?.status),
        latestChapterId: latest?.id ?? null,
        latestChapterTitle: latest?.title ?? null,
        latestChapterUpdateAt: 0,
        lastCheckedAt: Date.now(),
        sourceAlive: true,
        categoryName: FAV_DEFAULT_CATEGORY,
        favoritedAt: Date.now(),
        sortOrder: 0,
      }
      // Write catalog first: a failed disk write must not remove the old favorite.
      if (catalog != null) await catalog.write(book.sourceId, book.id, newChapters)
      return await this.dao.replaceFavoriteMapped(
        from,
        replacement,
        mappingIds,
        new Map(ord.map((o) => [o.chapter.id, o.order])),
        latest?.id ?? null,
      )
    } finally {
      this.catalogMutex.unlock()
    }
  }

  favoriteFlow(sourceId: string, comicId: string): Promise<FavoriteEntity | null> {
    return this.dao.favorite(sourceId, comicId)
  }

  /** 加入收藏（幂等：已存在则只更新分类与快照）。 */
  async add(
    book: SearchBook,
    category: string = FAV_DEFAULT_CATEGORY,
    chapters: ComicChapter[] = [],
  ): Promise<void> {
    if (book.sourceId.trim() === '' || book.id.trim() === '') return
    const top = ordered(chapters)[ordered(chapters).length - 1]
    const existing = await this.dao.favorite(book.sourceId, book.id)
    const useCategory = existing != null ? existing.categoryName : category
    await this.ensureFavoriteCategory(useCategory)
    const base: FavoriteEntity = existing ?? {
      sourceId: book.sourceId,
      comicId: book.id,
      title: book.title,
      author: book.author,
      coverUrl: book.cover,
      localThumbPath: null,
      serialStatus: SerialStatusFallback,
      latestChapterId: null,
      latestChapterTitle: null,
      latestChapterUpdateAt: 0,
      lastCheckedAt: 0,
      sourceAlive: true,
      categoryName: FAV_DEFAULT_CATEGORY,
      favoritedAt: Date.now(),
      sortOrder: 0,
    }
    await this.dao.insertFavorite({
      ...base,
      title: book.title,
      author: book.author,
      coverUrl: book.cover ?? existing?.coverUrl ?? null,
      categoryName: useCategory,
      sourceAlive: true,
      serialStatus:
        book.comicInfo?.status != null
          ? serialStatusOf(book.comicInfo.status)
          : existing?.serialStatus ?? 'unknown',
      latestChapterId: top?.chapter.id ?? existing?.latestChapterId ?? null,
      latestChapterTitle: top?.chapter.title ?? existing?.latestChapterTitle ?? null,
    })
  }

  /** 批量加入收藏：返回成功条数。 */
  async addAll(books: SearchBook[], category: string = FAV_DEFAULT_CATEGORY): Promise<number> {
    const valid = books.filter((b) => b.sourceId.trim() !== '' && b.id.trim() !== '')
    for (const book of valid) {
      await this.add(book, category)
    }
    return valid.length
  }

  async remove(sourceId: string, comicId: string): Promise<void> {
    await this.dao.deleteFavorite(sourceId, comicId)
  }

  async removeByKeys(keys: string[]): Promise<void> {
    await this.dao.deleteFavoritesByKeys(keys)
  }

  async moveToCategory(keys: string[], category: string): Promise<void> {
    await this.ensureFavoriteCategory(category)
    await this.dao.moveFavoritesToCategory(keys, category)
  }

  /* ───────────── 阅读进度 ───────────── */

  /** 全部漫画级进度，按 "sourceId::comicId" 索引。 */
  async progressByKey(): Promise<Map<string, ComicProgressEntity>> {
    const list = await this.dao.allProgress()
    return new Map(list.map((p) => [favoriteKey(p.sourceId, p.comicId), p]))
  }

  progressFlow(sourceId: string, comicId: string): Promise<ComicProgressEntity | null> {
    return this.dao.progress(sourceId, comicId)
  }

  chapterStatesFlow(sourceId: string, comicId: string): Promise<ChapterReadEntity[]> {
    return this.dao.chapterStates(sourceId, comicId)
  }

  async chapterStates(sourceId: string, comicId: string): Promise<Map<string, ChapterReadEntity>> {
    const list = await this.dao.chapterStatesSync(sourceId, comicId)
    return new Map(list.map((s) => [s.chapterId, s]))
  }

  /** 翻页时保存进度。 */
  async saveProgress(
    sourceId: string,
    comicId: string,
    chapterId: string,
    chapterIndex: number,
    pageIndex: number,
    pageCount: number,
  ): Promise<void> {
    const finished = importFinished(pageIndex, pageCount)
    await this.dao.upsertProgress({
      sourceId,
      comicId,
      lastChapterId: chapterId,
      lastChapterIndex: chapterIndex,
      lastPageIndex: Math.max(0, pageIndex),
      lastPageCount: Math.max(0, pageCount),
      lastReadAt: Date.now(),
      seenTopChapterId: null,
      seenChapterCount: 0,
    })
    const states = await this.dao.chapterStatesSync(sourceId, comicId)
    const previous = states.find((s) => s.chapterId === chapterId) ?? {
      sourceId,
      comicId,
      chapterId,
      status: ChapterReadState.UNREAD,
      pageIndex: 0,
      pageCount: 0,
      chapterIndex,
      updatedAt: 0,
      bookmarked: false,
    }
    await this.dao.upsertChapterStates([
      {
        ...previous,
        status: finished ? ChapterReadState.READ : ChapterReadState.READING,
        pageIndex: Math.max(0, pageIndex),
        pageCount: Math.max(0, pageCount),
        chapterIndex,
        updatedAt: Date.now(),
      },
    ])
  }

  /** 手动把某一章标记为已读/未读。 */
  async markChapter(
    sourceId: string,
    comicId: string,
    chapterId: string,
    chapterIndex: number,
    read: boolean,
  ): Promise<void> {
    const previous = (await this.dao.chapterStatesSync(sourceId, comicId)).find(
      (s) => s.chapterId === chapterId,
    ) ?? {
      sourceId,
      comicId,
      chapterId,
      status: ChapterReadState.UNREAD,
      pageIndex: 0,
      pageCount: 0,
      chapterIndex,
      updatedAt: 0,
      bookmarked: false,
    }
    await this.dao.upsertChapterStates([
      {
        ...previous,
        status: read ? ChapterReadState.READ : ChapterReadState.UNREAD,
        chapterIndex,
        updatedAt: Date.now(),
      },
    ])
  }

  /** 详情页左滑/右滑该话卡片：切换书签标注。 */
  async setChapterBookmark(
    sourceId: string,
    comicId: string,
    chapterId: string,
    chapterIndex: number,
    bookmarked: boolean,
  ): Promise<void> {
    const previous = (await this.dao.chapterStatesSync(sourceId, comicId)).find(
      (s) => s.chapterId === chapterId,
    ) ?? {
      sourceId,
      comicId,
      chapterId,
      status: ChapterReadState.UNREAD,
      pageIndex: 0,
      pageCount: 0,
      chapterIndex,
      updatedAt: 0,
      bookmarked: false,
    }
    await this.dao.upsertChapterStates([
      {
        ...previous,
        bookmarked,
        updatedAt: Date.now(),
      },
    ])
  }

  /** 「将以上全部标记为已读」。 */
  async markChaptersReadUpTo(sourceId: string, comicId: string, maxIndex: number): Promise<void> {
    await this.dao.markChaptersReadUpTo(sourceId, comicId, maxIndex)
  }

  /** 进入章节列表时记录「已见」快照。 */
  async markSeen(sourceId: string, comicId: string, chapters: ComicChapter[]): Promise<void> {
    await this.reconcileCatalog(sourceId, comicId, chapters)
    const seq = ordered(chapters)
    const top = seq[seq.length - 1]?.chapter.id ?? null
    const cur = await this.dao.progress(sourceId, comicId)
    await this.dao.upsertProgress({
      ...(cur ?? { sourceId, comicId, lastChapterId: null, lastChapterIndex: -1, lastPageIndex: 0, lastPageCount: 0, lastReadAt: 0, seenTopChapterId: null, seenChapterCount: 0 }),
      seenTopChapterId: top ?? cur?.seenTopChapterId ?? null,
      seenChapterCount: seq.length,
    })
  }

  /** 换源迁移（粗糙版）。 */
  async migrateKey(from: ComicKey, to: ComicKey): Promise<void> {
    await this.dao.migrateKey(from.sourceId, from.comicId, to.sourceId, to.comicId)
  }

  /** 换源迁移（推荐）：按阅读序号映射章节状态。 */
  async migrateByOrder(from: ComicKey, to: ComicKey, newChapters: ComicChapter[]): Promise<number> {
    if (!comicKeyValid(from) || !comicKeyValid(to) || comicKeyRawSafe(from) === comicKeyRawSafe(to)) {
      return 0
    }
    const seq = ordered(newChapters)
    const oldStates = await this.dao.chapterStatesSync(from.sourceId, from.comicId)
    const oldProg = await this.dao.progress(from.sourceId, from.comicId)
    const oldFav = await this.dao.favorite(from.sourceId, from.comicId)

    const catalog = this.catalogContext != null ? new ChapterCatalog(this.catalogContext) : null
    const identities = catalog
      ? catalog.mapping(await catalog.read(from.sourceId, from.comicId), newChapters)
      : new Map<string, ComicChapter>()
    const orders = new Map(seq.map((o) => [o.chapter.id, o.order]))
    const mapped: ChapterReadEntity[] = []
    for (const state of oldStates) {
      const chapter = identities.get(state.chapterId)
      if (chapter == null) continue
      mapped.push({
        ...state,
        sourceId: to.sourceId,
        comicId: to.comicId,
        chapterId: chapter.id,
        chapterIndex: orders.get(chapter.id) ?? -1,
      })
    }
    const progressChapter = oldProg?.lastChapterId != null ? identities.get(oldProg.lastChapterId) : undefined
    const newProgress =
      oldProg != null && progressChapter != null
        ? {
            ...oldProg,
            sourceId: to.sourceId,
            comicId: to.comicId,
            lastChapterId: progressChapter.id,
            lastChapterIndex: orders.get(progressChapter.id) ?? -1,
            seenTopChapterId: seq[seq.length - 1]?.chapter.id ?? null,
            seenChapterCount: seq.length,
          }
        : null
    const complete =
      mapped.length === oldStates.length &&
      (oldProg?.lastChapterId == null || progressChapter != null)
    await this.dao.migrateResolved(
      from,
      to,
      mapped,
      newProgress,
      oldFav != null ? { ...oldFav, sourceId: to.sourceId, comicId: to.comicId } : null,
      complete,
    )
    if (catalog != null) await catalog.write(to.sourceId, to.comicId, newChapters)
    return mapped.length
  }

  private async reconcileCatalog(
    source: string,
    comic: string,
    chapters: ComicChapter[],
  ): Promise<void> {
    if (this.catalogContext == null) return
    await this.catalogMutex.lock()
    try {
      const catalog = new ChapterCatalog(this.catalogContext)
      const map = catalog.mapping(await catalog.read(source, comic), chapters)
      const orders = new Map(ordered(chapters).map((o) => [o.chapter.id, o.order]))
      const states = await this.dao.chapterStatesSync(source, comic)
      const changed: ChapterReadEntity[] = []
      const changedIds = new Set<string>()
      for (const state of states) {
        const chapter = map.get(state.chapterId)
        if (chapter == null || chapter.id === state.chapterId) continue
        changedIds.add(chapter.id)
        changed.push({
          ...state,
          chapterId: chapter.id,
          chapterIndex: orders.get(chapter.id) ?? state.chapterIndex,
        })
      }
      const progress = await this.dao.progress(source, comic)
      const mappedProg = progress?.lastChapterId != null ? map.get(progress.lastChapterId) : undefined
      const updated =
        mappedProg != null && progress != null
          ? {
              ...progress,
              lastChapterId: mappedProg.id,
              lastChapterIndex: orders.get(mappedProg.id) ?? progress.lastChapterIndex,
            }
          : null
      const oldIds = states.filter((s) => changedIds.has(map.get(s.chapterId)?.id ?? '')).map((s) => s.chapterId)
      await this.dao.reconcileChapterIds(source, comic, changed, updated, oldIds)
      await catalog.write(source, comic, chapters)
    } finally {
      this.catalogMutex.unlock()
    }
  }

  /* ───────────── 更新检测 ───────────── */

  private async throttle(sourceId: string): Promise<void> {
    const last = this.lastRequestAt.get(sourceId) ?? 0
    const wait = last + 1000 - Date.now()
    if (wait > 0) await delay(Math.min(wait, 1000))
    this.lastRequestAt.set(sourceId, Date.now())
  }

  /**
   * 检查更新（stale-while-revalidate）。
   * @param force true = 下拉刷新，忽略 30 分钟间隔
   * @return 本次真正联网检查过的条数
   */
  async checkUpdates(force = false): Promise<number> {
    if (this.checking) return 0
    this.checking = true
    try {
      const now = Date.now()
      const targets = (await this.dao.allFavoritesSync()).filter(
        (f) => force || now - f.lastCheckedAt > UPDATE_CHECK_INTERVAL_MS,
      )
      // 与 Android 的 repoScope.launch 一致：后台发起，不阻塞本次调用返回。
      void Promise.all(
        targets.map((fav) =>
          this.updateGate.withPermit(async () => {
            try {
              await this.throttle(fav.sourceId)
              const source = await this.comicSourceOf(fav.sourceId)
              if (source == null) return
              const r = await source.getChapters(fav.comicId)
              if (r.kind === 'error') throw new Error(r.exception.message || '章节加载失败')
              const top = ordered(r.data)[ordered(r.data).length - 1]?.chapter ?? null
              const fresh = await this.dao.favorite(fav.sourceId, fav.comicId)
              if (fresh == null) return
              const changed = isNewChapterObserved(
                fav.latestChapterId,
                fav.latestChapterTitle,
                top != null ? { rawIndex: 0, order: 0, chapter: top, orderKey: 0, displayNumber: 0 } : null,
              )
              await this.dao.insertFavorite({
                ...fresh,
                latestChapterId: top?.id ?? fresh.latestChapterId,
                latestChapterTitle: top?.title ?? fresh.latestChapterTitle,
                latestChapterUpdateAt: changed ? Date.now() : fresh.latestChapterUpdateAt,
                lastCheckedAt: Date.now(),
                sourceAlive: true,
              })
            } catch {
              const fresh = await this.dao.favorite(fav.sourceId, fav.comicId)
              if (fresh != null) {
                await this.dao.insertFavorite({
                  ...fresh,
                  lastCheckedAt: Date.now(),
                  sourceAlive: false,
                })
              }
            }
          }),
        ),
      ).catch(() => {})
      return targets.length
    } finally {
      this.checking = false
    }
  }

  /** 来源失效后重试单本。 */
  async retrySource(sourceId: string, comicId: string): Promise<boolean> {
    return this.updateGate.withPermit(async () => {
      try {
        await this.throttle(sourceId)
        const source = await this.comicSourceOf(sourceId)
        if (source == null) return false
        const r = await source.getChapters(comicId)
        if (r.kind === 'error') return false
        const ord = ordered(r.data)
        const top = ord[ord.length - 1]?.chapter ?? null
        const fresh = await this.dao.favorite(sourceId, comicId)
        if (fresh == null) return false
        const changed = isNewChapterObserved(
          fresh.latestChapterId,
          fresh.latestChapterTitle,
          top != null ? { rawIndex: 0, order: 0, chapter: top, orderKey: 0, displayNumber: 0 } : null,
        )
        await this.dao.insertFavorite({
          ...fresh,
          latestChapterId: top?.id ?? fresh.latestChapterId,
          latestChapterTitle: top?.title ?? fresh.latestChapterTitle,
          latestChapterUpdateAt: changed ? Date.now() : fresh.latestChapterUpdateAt,
          lastCheckedAt: Date.now(),
          sourceAlive: true,
        })
        return true
      } catch {
        return false
      }
    })
  }
}

const SerialStatusFallback = 'unknown'

function importFinished(pageIndex: number, pageCount: number): boolean {
  if (pageCount <= 0) return false
  if (pageIndex >= pageCount - 1) return true
  return (pageIndex + 1) / pageCount >= 0.9
}

function comicKeyRawSafe(key: ComicKey): string {
  return `${key.sourceId}::${key.comicId}`
}

export function createFavoriteRepository(options: FavoriteRepositoryOptions): FavoriteRepository {
  return new FavoriteRepository(options)
}

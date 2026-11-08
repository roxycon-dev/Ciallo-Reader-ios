/**
 * Favorite DAO — port of Android `FavoriteDao.kt`.
 * Executes Room @Query / @Insert / @Update / @Transaction statements
 * over DatabaseLike (capacitor sqlite).
 */

import type { DatabaseLike } from './bookRepository'
import { contentMutationGate } from './contentMutationGate'
import {
  type ChapterReadEntity,
  type ChapterReadRow,
  chapterReadToRow,
  type ComicKey,
  type ComicProgressEntity,
  type ComicProgressRow,
  type FavoriteCategoryEntity,
  type FavoriteCategoryRow,
  type FavoriteEntity,
  type FavoriteMigrationReport,
  favoriteKey,
  favoriteToRow,
  type FavoriteRow,
  rowToChapterRead,
  rowToFavorite,
  rowToProgress,
  ChapterReadState,
} from './favoriteTypes'

const FAVORITE_COLUMNS =
  '"sourceId", "comicId", "title", "author", "coverUrl", "localThumbPath", "serialStatus", ' +
  '"latestChapterId", "latestChapterTitle", "latestChapterUpdateAt", "lastCheckedAt", "sourceAlive", ' +
  '"categoryName", "favoritedAt", "sortOrder"'

const PROGRESS_COLUMNS =
  '"sourceId", "comicId", "lastChapterId", "lastChapterIndex", "lastPageIndex", "lastPageCount", ' +
  '"lastReadAt", "seenTopChapterId", "seenChapterCount"'

const CHAPTER_READ_COLUMNS =
  '"sourceId", "comicId", "chapterId", "status", "pageIndex", "pageCount", "chapterIndex", "updatedAt", "bookmarked"'

const CATEGORY_COLUMNS = '"name", "sortOrder", "createdAt"'

export class FavoriteDao {
  constructor(private readonly db: DatabaseLike) {}

  /* ─────────────── 收藏 ─────────────── */

  allFavorites(): Promise<FavoriteEntity[]> {
    return this.db
      .query<FavoriteRow>(`SELECT ${FAVORITE_COLUMNS} FROM favorites ORDER BY favoritedAt DESC`)
      .then((rows) => rows.map(rowToFavorite))
  }

  allFavoritesSync(): Promise<FavoriteEntity[]> {
    return this.allFavorites()
  }

  async favorite(sourceId: string, comicId: string): Promise<FavoriteEntity | null> {
    const rows = await this.db.query<FavoriteRow>(
      `SELECT ${FAVORITE_COLUMNS} FROM favorites WHERE "sourceId" = ? AND "comicId" = ? LIMIT 1`,
      [sourceId, comicId],
    )
    return rows[0] ? rowToFavorite(rows[0]) : null
  }

  /** Room Flow variant of `favorite` — one-shot query under the SQLite bridge. */
  favoriteFlow(sourceId: string, comicId: string): Promise<FavoriteEntity | null> {
    return this.favorite(sourceId, comicId)
  }

  async favoriteKeys(): Promise<string[]> {
    const rows = await this.db.query<{ k: string }>(
      "SELECT sourceId || '::' || comicId AS k FROM favorites",
    )
    return rows.map((r) => r.k)
  }

  async insertFavorite(entity: FavoriteEntity): Promise<void> {
    const row = favoriteToRow(entity)
    await this.db.execute(
      `INSERT OR REPLACE INTO favorites (${FAVORITE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.sourceId,
        row.comicId,
        row.title,
        row.author,
        row.coverUrl,
        row.localThumbPath,
        row.serialStatus,
        row.latestChapterId,
        row.latestChapterTitle,
        row.latestChapterUpdateAt,
        row.lastCheckedAt,
        row.sourceAlive,
        row.categoryName,
        row.favoritedAt,
        row.sortOrder,
      ],
    )
  }

  async updateFavorite(entity: FavoriteEntity): Promise<void> {
    const row = favoriteToRow(entity)
    await this.db.execute(
      'UPDATE favorites SET "title" = ?, "author" = ?, "coverUrl" = ?, "localThumbPath" = ?, ' +
        '"serialStatus" = ?, "latestChapterId" = ?, "latestChapterTitle" = ?, "latestChapterUpdateAt" = ?, ' +
        '"lastCheckedAt" = ?, "sourceAlive" = ?, "categoryName" = ?, "favoritedAt" = ?, "sortOrder" = ? ' +
        'WHERE "sourceId" = ? AND "comicId" = ?',
      [
        row.title,
        row.author,
        row.coverUrl,
        row.localThumbPath,
        row.serialStatus,
        row.latestChapterId,
        row.latestChapterTitle,
        row.latestChapterUpdateAt,
        row.lastCheckedAt,
        row.sourceAlive,
        row.categoryName,
        row.favoritedAt,
        row.sortOrder,
        row.sourceId,
        row.comicId,
      ],
    )
  }

  async deleteFavorite(sourceId: string, comicId: string): Promise<void> {
    await this.db.execute('DELETE FROM favorites WHERE "sourceId" = ? AND "comicId" = ?', [
      sourceId,
      comicId,
    ])
  }

  /** 批量加入收藏（多选操作栏「喜欢」）。 */
  async insertFavorites(entities: FavoriteEntity[]): Promise<void> {
    for (const entity of entities) {
      await this.insertFavorite(entity)
    }
  }

  async deleteFavoritesByKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const placeholders = keys.map(() => '?').join(',')
    await this.db.execute(
      `DELETE FROM favorites WHERE sourceId || '::' || comicId IN (${placeholders})`,
      keys,
    )
  }

  /** 批量移动到分类。 */
  async moveFavoritesToCategory(keys: string[], category: string): Promise<void> {
    if (keys.length === 0) return
    const placeholders = keys.map(() => '?').join(',')
    await this.db.execute(
      `UPDATE favorites SET "categoryName" = ? WHERE sourceId || '::' || comicId IN (${placeholders})`,
      [category, ...keys],
    )
  }

  async countInCategory(category: string): Promise<number> {
    const rows = await this.db.query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM favorites WHERE "categoryName" = ?',
      [category],
    )
    return rows[0]?.c ?? 0
  }

  /* ───────────── 收藏分类 ───────────── */

  async favoriteCategories(): Promise<FavoriteCategoryEntity[]> {
    return this.favoriteCategoriesSync()
  }

  async favoriteCategoriesSync(): Promise<FavoriteCategoryEntity[]> {
    const rows = await this.db.query<FavoriteCategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM favorite_categories ORDER BY sortOrder ASC, createdAt ASC`,
    )
    return rows.map((r) => ({ name: r.name, sortOrder: r.sortOrder, createdAt: r.createdAt }))
  }

  async insertFavoriteCategory(entity: FavoriteCategoryEntity): Promise<void> {
    await this.db.execute(
      'INSERT OR IGNORE INTO favorite_categories ("name", "sortOrder", "createdAt") VALUES (?,?,?)',
      [entity.name, entity.sortOrder, entity.createdAt],
    )
  }

  async deleteFavoriteCategory(name: string): Promise<void> {
    await this.db.execute('DELETE FROM favorite_categories WHERE "name" = ?', [name])
  }

  async renameFavoriteCategory(oldName: string, newName: string): Promise<void> {
    await this.db.execute(
      'UPDATE favorite_categories SET "name" = ? WHERE "name" = ?',
      [newName, oldName],
    )
  }

  async retagFavorites(oldName: string, newName: string): Promise<void> {
    await this.db.execute(
      'UPDATE favorites SET "categoryName" = ? WHERE "categoryName" = ?',
      [newName, oldName],
    )
  }

  /** 重命名分类：分类表与收藏记录一起改。 */
  async renameFavoriteCategoryCascade(oldName: string, newName: string): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        await this.renameFavoriteCategory(oldName, newName)
        await this.retagFavorites(oldName, newName)
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  /** 删除分类：收藏退回默认分类，绝不连带删除收藏。 */
  async deleteFavoriteCategoryAndRetag(name: string, fallback: string): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        await this.retagFavorites(name, fallback)
        await this.deleteFavoriteCategory(name)
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  /* ─────────────── 漫画级进度 ─────────────── */

  async progressFlow(sourceId: string, comicId: string): Promise<ComicProgressEntity | null> {
    return this.progress(sourceId, comicId)
  }

  async progress(sourceId: string, comicId: string): Promise<ComicProgressEntity | null> {
    const rows = await this.db.query<ComicProgressRow>(
      `SELECT ${PROGRESS_COLUMNS} FROM comic_progress WHERE "sourceId" = ? AND "comicId" = ? LIMIT 1`,
      [sourceId, comicId],
    )
    return rows[0] ? rowToProgress(rows[0]) : null
  }

  async allProgress(): Promise<ComicProgressEntity[]> {
    const rows = await this.db.query<ComicProgressRow>(
      `SELECT ${PROGRESS_COLUMNS} FROM comic_progress ORDER BY lastReadAt DESC`,
    )
    return rows.map(rowToProgress)
  }

  async upsertProgress(entity: ComicProgressEntity): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO comic_progress (${PROGRESS_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        entity.sourceId,
        entity.comicId,
        entity.lastChapterId,
        entity.lastChapterIndex,
        entity.lastPageIndex,
        entity.lastPageCount,
        entity.lastReadAt,
        entity.seenTopChapterId,
        entity.seenChapterCount,
      ],
    )
  }

  async deleteProgress(sourceId: string, comicId: string): Promise<void> {
    await this.db.execute('DELETE FROM comic_progress WHERE "sourceId" = ? AND "comicId" = ?', [
      sourceId,
      comicId,
    ])
  }

  /* ─────────────── 章节级状态 ─────────────── */

  async chapterStates(sourceId: string, comicId: string): Promise<ChapterReadEntity[]> {
    return this.chapterStatesSync(sourceId, comicId)
  }

  async chapterStatesSync(sourceId: string, comicId: string): Promise<ChapterReadEntity[]> {
    const rows = await this.db.query<ChapterReadRow>(
      `SELECT ${CHAPTER_READ_COLUMNS} FROM comic_chapter_read WHERE "sourceId" = ? AND "comicId" = ?`,
      [sourceId, comicId],
    )
    return rows.map(rowToChapterRead)
  }

  async upsertChapterStates(entities: ChapterReadEntity[]): Promise<void> {
    for (const entity of entities) {
      const row = chapterReadToRow(entity)
      await this.db.execute(
        `INSERT OR REPLACE INTO comic_chapter_read (${CHAPTER_READ_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          row.sourceId,
          row.comicId,
          row.chapterId,
          row.status,
          row.pageIndex,
          row.pageCount,
          row.chapterIndex,
          row.updatedAt,
          row.bookmarked,
        ],
      )
    }
  }

  async setChapterStatus(
    sourceId: string,
    comicId: string,
    chapterId: string,
    status: number,
    updatedAt: number = Date.now(),
  ): Promise<void> {
    await this.db.execute(
      'UPDATE comic_chapter_read SET "status" = ?, "updatedAt" = ? ' +
        'WHERE "sourceId" = ? AND "comicId" = ? AND "chapterId" = ?',
      [status, updatedAt, sourceId, comicId, chapterId],
    )
  }

  /** 「将以上全部标记为已读」。 */
  async markChaptersReadUpTo(
    sourceId: string,
    comicId: string,
    maxIndex: number,
    updatedAt: number = Date.now(),
  ): Promise<void> {
    await this.db.execute(
      'UPDATE comic_chapter_read SET "status" = 2, "updatedAt" = ? ' +
        'WHERE "sourceId" = ? AND "comicId" = ? AND "chapterIndex" <= ?',
      [updatedAt, sourceId, comicId, maxIndex],
    )
  }

  async clearChapterStates(sourceId: string, comicId: string): Promise<void> {
    await this.db.execute('DELETE FROM comic_chapter_read WHERE "sourceId" = ? AND "comicId" = ?', [
      sourceId,
      comicId,
    ])
  }

  /** 换源迁移：把某个漫画的收藏 + 进度整体搬到新的 (sourceId, comicId)。 */
  async migrateKey(
    fromSourceId: string,
    fromComicId: string,
    toSourceId: string,
    toComicId: string,
  ): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        const fav = await this.favorite(fromSourceId, fromComicId)
        if (fav != null) {
          await this.deleteFavorite(fromSourceId, fromComicId)
          await this.insertFavorite({ ...fav, sourceId: toSourceId, comicId: toComicId })
        }
        const prog = await this.progress(fromSourceId, fromComicId)
        if (prog != null) {
          await this.deleteProgress(fromSourceId, fromComicId)
          await this.upsertProgress({ ...prog, sourceId: toSourceId, comicId: toComicId })
        }
        const states = await this.chapterStatesSync(fromSourceId, fromComicId)
        if (states.length > 0) {
          await this.clearChapterStates(fromSourceId, fromComicId)
          await this.upsertChapterStates(
            states.map((s) => ({ ...s, sourceId: toSourceId, comicId: toComicId })),
          )
        }
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  async deleteChapterIds(source: string, comic: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    await this.db.execute(
      `DELETE FROM comic_chapter_read WHERE "sourceId" = ? AND "comicId" = ? AND "chapterId" IN (${placeholders})`,
      [source, comic, ...ids],
    )
  }

  async reconcileChapterIds(
    source: string,
    comic: string,
    states: ChapterReadEntity[],
    progress: ComicProgressEntity | null,
    oldIds: string[],
  ): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        if (oldIds.length > 0) await this.deleteChapterIds(source, comic, oldIds)
        if (states.length > 0) await this.upsertChapterStates(states)
        if (progress != null) await this.upsertProgress(progress)
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  async migrateResolved(
    from: ComicKey,
    _to: ComicKey,
    states: ChapterReadEntity[],
    progress: ComicProgressEntity | null,
    favorite: FavoriteEntity | null,
    clearOld: boolean,
  ): Promise<void> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        if (states.length > 0) await this.upsertChapterStates(states)
        if (progress != null) await this.upsertProgress(progress)
        if (favorite != null) await this.insertFavorite(favorite)
        if (clearOld) {
          await this.clearChapterStates(from.sourceId, from.comicId)
          await this.deleteProgress(from.sourceId, from.comicId)
          await this.deleteFavorite(from.sourceId, from.comicId)
        }
        await this.db.execute('COMMIT')
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  /** Replace the favorite atomically. Keep old reading records as a fallback. */
  async replaceFavoriteMapped(
    from: ComicKey,
    replacement: FavoriteEntity,
    mapping: Map<string, string>,
    chapterOrders: Map<string, number>,
    latestId: string | null,
  ): Promise<FavoriteMigrationReport> {
    return contentMutationGate.mutex.withLock(async () => {
      await this.db.execute('BEGIN')
      try {
        const oldFavorite = await this.favorite(from.sourceId, from.comicId)
        if (oldFavorite == null) {
          throw new Error('旧收藏已移除，请重新选择')
        }
        const targetStates = new Map(
          (await this.chapterStatesSync(replacement.sourceId, replacement.comicId)).map((s) => [
            s.chapterId,
            s,
          ]),
        )
        const oldStates = (
          await this.chapterStatesSync(from.sourceId, from.comicId)
        ).filter((s) => s.status !== ChapterReadState.UNREAD || s.bookmarked)

        const mapped: ChapterReadEntity[] = []
        for (const state of oldStates) {
          const chapterId = mapping.get(state.chapterId)
          if (chapterId === undefined) continue
          const existing = targetStates.get(chapterId)
          const transferred: ChapterReadEntity = {
            ...state,
            sourceId: replacement.sourceId,
            comicId: replacement.comicId,
            chapterId,
            chapterIndex: chapterOrders.get(chapterId) ?? -1,
            pageIndex: 0,
            pageCount: 0,
            bookmarked: state.bookmarked || existing?.bookmarked === true,
          }
          if (
            existing != null &&
            (existing.status > state.status ||
              (existing.status === state.status && existing.updatedAt >= state.updatedAt))
          ) {
            mapped.push({ ...existing, bookmarked: transferred.bookmarked })
          } else {
            mapped.push(transferred)
          }
        }

        const oldProgress = await this.progress(from.sourceId, from.comicId)
        const resumeId =
          oldProgress != null && oldProgress.lastChapterId != null
            ? mapping.get(oldProgress.lastChapterId) ?? null
            : null
        const targetProgress = await this.progress(replacement.sourceId, replacement.comicId)
        if (
          resumeId != null &&
          oldProgress != null &&
          (targetProgress?.lastChapterId == null || targetProgress.lastReadAt < oldProgress.lastReadAt)
        ) {
          await this.upsertProgress({
            ...oldProgress,
            sourceId: replacement.sourceId,
            comicId: replacement.comicId,
            lastChapterId: resumeId,
            lastChapterIndex: chapterOrders.get(resumeId) ?? -1,
            lastPageIndex: 0,
            lastPageCount: 0,
            seenTopChapterId: latestId,
            seenChapterCount: chapterOrders.size,
          })
        }
        if (mapped.length > 0) await this.upsertChapterStates(mapped)

        const targetFavorite = await this.favorite(replacement.sourceId, replacement.comicId)
        await this.insertFavorite({
          ...replacement,
          categoryName: targetFavorite?.categoryName ?? oldFavorite.categoryName,
          favoritedAt: targetFavorite?.favoritedAt ?? oldFavorite.favoritedAt,
          sortOrder: targetFavorite?.sortOrder ?? oldFavorite.sortOrder,
        })
        await this.deleteFavorite(from.sourceId, from.comicId)
        await this.db.execute('COMMIT')

        return {
          migrated: mapped.length,
          unmatched: oldStates.length - mapped.length,
          resumeMatched: oldProgress?.lastChapterId == null || resumeId != null,
        }
      } catch (err) {
        await this.db.execute('ROLLBACK')
        throw err
      }
    })
  }

  /** Convenience: business key string. */
  key(entity: FavoriteEntity): string {
    return favoriteKey(entity.sourceId, entity.comicId)
  }
}

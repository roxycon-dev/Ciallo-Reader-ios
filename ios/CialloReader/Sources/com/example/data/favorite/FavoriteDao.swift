import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/FavoriteDao.kt（242 行）
// Room DAO → SQLiteDatabase 直连；Flow 查询以同步方法 + dbChangedNotification 组合替代。

final class FavoriteDao {
    let db: SQLiteDatabase

    init(db: SQLiteDatabase) { self.db = db }

    /* ─────────────── 收藏 ─────────────── */

    func allFavorites() throws -> [FavoriteEntity] {
        try queryFavorites("SELECT * FROM favorites ORDER BY favoritedAt DESC")
    }

    func allFavoritesSync() throws -> [FavoriteEntity] {
        try allFavorites()
    }

    func favorite(sourceId: String, comicId: String) throws -> FavoriteEntity? {
        try queryFavorites("SELECT * FROM favorites WHERE sourceId = ? AND comicId = ? LIMIT 1", [.text(sourceId), .text(comicId)]).first
    }

    /** 收藏的 id 集合（书架卡片右下角小心形用；一次查询避免 N 次单查） */
    func favoriteKeys() throws -> [String] {
        try db.query("SELECT sourceId || '::' || comicId AS k FROM favorites").compactMap { $0["k"]?.textValue }
    }

    func insertFavorite(_ entity: FavoriteEntity) throws {
        try db.exec("""
            INSERT OR REPLACE INTO favorites (sourceId, comicId, title, author, coverUrl, localThumbPath, serialStatus,
            latestChapterId, latestChapterTitle, latestChapterUpdateAt, lastCheckedAt, sourceAlive, categoryName,
            favoritedAt, sortOrder) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, favoriteBinds(entity))
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func updateFavorite(_ entity: FavoriteEntity) throws {
        try db.exec("""
            UPDATE favorites SET title=?, author=?, coverUrl=?, localThumbPath=?, serialStatus=?,
            latestChapterId=?, latestChapterTitle=?, latestChapterUpdateAt=?, lastCheckedAt=?, sourceAlive=?,
            categoryName=?, favoritedAt=?, sortOrder=? WHERE sourceId=? AND comicId=?
            """, Array(favoriteBinds(entity).dropFirst(2)) + [.text(entity.sourceId), .text(entity.comicId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private func favoriteBinds(_ f: FavoriteEntity) -> [SQLiteValue] {
        [
            .text(f.sourceId), .text(f.comicId), .text(f.title), .text(f.author),
            f.coverUrl.isEmpty ? .null : .text(f.coverUrl),
            f.localThumbPath.map { .text($0) } ?? .null,
            .text(f.serialStatus),
            f.latestChapterId.map { .text($0) } ?? .null,
            f.latestChapterTitle.map { .text($0) } ?? .null,
            .int(f.latestChapterUpdateAt), .int(f.lastCheckedAt),
            .int(f.sourceAlive ? 1 : 0),
            .text(f.categoryName),
            .int(f.favoritedAt), .int(Int64(f.sortOrder)),
        ]
    }

    private func queryFavorites(_ sql: String, _ binds: [SQLiteValue] = []) throws -> [FavoriteEntity] {
        try db.query(sql, binds).map { row in
            FavoriteEntity(
                sourceId: row["sourceId"]?.textValue ?? "",
                comicId: row["comicId"]?.textValue ?? "",
                title: row["title"]?.textValue ?? "",
                author: row["author"]?.textValue ?? "",
                coverUrl: row["coverUrl"]?.textValue ?? "",
                localThumbPath: row["localThumbPath"]?.textValue,
                serialStatus: row["serialStatus"]?.textValue ?? SerialStatus.unknown.rawValue,
                latestChapterId: row["latestChapterId"]?.textValue,
                latestChapterTitle: row["latestChapterTitle"]?.textValue,
                latestChapterUpdateAt: row["latestChapterUpdateAt"]?.intValue ?? 0,
                lastCheckedAt: row["lastCheckedAt"]?.intValue ?? 0,
                sourceAlive: (row["sourceAlive"]?.intValue ?? 1) != 0,
                categoryName: row["categoryName"]?.textValue ?? favDefaultCategory,
                favoritedAt: row["favoritedAt"]?.intValue ?? 0,
                sortOrder: Int(row["sortOrder"]?.intValue ?? 0)
            )
        }
    }

    func deleteFavorite(sourceId: String, comicId: String) throws {
        try db.exec("DELETE FROM favorites WHERE sourceId = ? AND comicId = ?", [.text(sourceId), .text(comicId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    /** 批量加入收藏（多选操作栏「喜欢」） */
    func insertFavorites(_ entities: [FavoriteEntity]) throws {
        for entity in entities { try insertFavorite(entity) }
    }

    func deleteFavoritesByKeys(_ keys: [String]) throws {
        for key in keys {
            // "sourceId::comicId" 反解：sourceId 里可能出现 "::" 的情况由 favoriteKey 单一来源保证
            guard let split = splitKey(key) else { continue }
            try deleteFavorite(sourceId: split.sourceId, comicId: split.comicId)
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private func splitKey(_ key: String) -> (sourceId: String, comicId: String)? {
        guard let range = key.range(of: "::") else { return nil }
        let sourceId = String(key[key.startIndex..<range.lowerBound])
        let comicId = String(key[range.upperBound...])
        return (sourceId, comicId)
    }

    /** 批量移动到分类（多选拖拽「放入 XXX」） */
    func moveFavoritesToCategory(_ keys: [String], category: String) throws {
        try db.transaction {
            for key in keys {
                try db.exec("UPDATE favorites SET categoryName = ? WHERE sourceId || '::' || comicId = ?",
                            [.text(category), .text(key)])
            }
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func countInCategory(_ category: String) throws -> Int {
        try db.query("SELECT COUNT(*) AS c FROM favorites WHERE categoryName = ?", [.text(category)])
            .first?["c"]?.intValue ?? 0
    }

    /* ───────────── 收藏分类（独立于书架 categories） ───────────── */

    func favoriteCategories() throws -> [FavoriteCategoryEntity] {
        try db.query("SELECT * FROM favorite_categories ORDER BY sortOrder ASC, createdAt ASC").map { row in
            FavoriteCategoryEntity(name: row["name"]?.textValue ?? "",
                                   sortOrder: Int(row["sortOrder"]?.intValue ?? 0),
                                   createdAt: row["createdAt"]?.intValue ?? 0)
        }
    }

    func favoriteCategoriesSync() throws -> [FavoriteCategoryEntity] {
        try favoriteCategories()
    }

    func insertFavoriteCategory(_ entity: FavoriteCategoryEntity) throws {
        try db.exec("INSERT OR IGNORE INTO favorite_categories (name, sortOrder, createdAt) VALUES (?,?,?)",
                    [.text(entity.name), .int(Int64(entity.sortOrder)), .int(entity.createdAt)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteFavoriteCategory(_ name: String) throws {
        try db.exec("DELETE FROM favorite_categories WHERE name = ?", [.text(name)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func renameFavoriteCategory(_ oldName: String, newName: String) throws {
        try db.exec("UPDATE favorite_categories SET name = ? WHERE name = ?", [.text(newName), .text(oldName)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func retagFavorites(_ oldName: String, newName: String) throws {
        try db.exec("UPDATE favorites SET categoryName = ? WHERE categoryName = ?", [.text(newName), .text(oldName)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    /** 重命名分类：分类表与收藏记录一起改（否则收藏会指向一个不存在的分类）。 */
    func renameFavoriteCategoryCascade(_ oldName: String, _ newName: String) throws {
        try db.transaction {
            try renameFavoriteCategory(oldName, newName: newName)
            try retagFavorites(oldName, newName: newName)
        }
    }

    /** 删除分类：其中的收藏退回默认分类，绝不连带删除收藏本身。 */
    func deleteFavoriteCategoryAndRetag(_ name: String, fallback: String) throws {
        try db.transaction {
            try retagFavorites(name, newName: fallback)
            try deleteFavoriteCategory(name)
        }
    }

    /* ─────────────── 漫画级进度 ─────────────── */

    func progress(sourceId: String, comicId: String) throws -> ComicProgressEntity? {
        try db.query("SELECT * FROM comic_progress WHERE sourceId = ? AND comicId = ? LIMIT 1",
                     [.text(sourceId), .text(comicId)]).first.map(progressRow)
    }

    func allProgress() throws -> [ComicProgressEntity] {
        try db.query("SELECT * FROM comic_progress ORDER BY lastReadAt DESC").map(progressRow)
    }

    private func progressRow(_ row: [String: SQLiteValue]) -> ComicProgressEntity {
        ComicProgressEntity(
            sourceId: row["sourceId"]?.textValue ?? "",
            comicId: row["comicId"]?.textValue ?? "",
            lastChapterId: row["lastChapterId"]?.textValue,
            lastChapterIndex: Int(row["lastChapterIndex"]?.intValue ?? -1),
            lastPageIndex: Int(row["lastPageIndex"]?.intValue ?? 0),
            lastPageCount: Int(row["lastPageCount"]?.intValue ?? 0),
            lastReadAt: row["lastReadAt"]?.intValue ?? 0,
            seenTopChapterId: row["seenTopChapterId"]?.textValue,
            seenChapterCount: Int(row["seenChapterCount"]?.intValue ?? 0)
        )
    }

    func upsertProgress(_ entity: ComicProgressEntity) throws {
        try db.exec("""
            INSERT OR REPLACE INTO comic_progress (sourceId, comicId, lastChapterId, lastChapterIndex, lastPageIndex,
            lastPageCount, lastReadAt, seenTopChapterId, seenChapterCount) VALUES (?,?,?,?,?,?,?,?,?)
            """, [
                .text(entity.sourceId), .text(entity.comicId),
                entity.lastChapterId.map { .text($0) } ?? .null,
                .int(Int64(entity.lastChapterIndex)), .int(Int64(entity.lastPageIndex)),
                .int(Int64(entity.lastPageCount)), .int(entity.lastReadAt),
                entity.seenTopChapterId.map { .text($0) } ?? .null,
                .int(Int64(entity.seenChapterCount)),
            ])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteProgress(sourceId: String, comicId: String) throws {
        try db.exec("DELETE FROM comic_progress WHERE sourceId = ? AND comicId = ?", [.text(sourceId), .text(comicId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    /* ─────────────── 章节级状态 ─────────────── */

    func chapterStates(sourceId: String, comicId: String) throws -> [ChapterReadEntity] {
        try db.query("SELECT * FROM comic_chapter_read WHERE sourceId = ? AND comicId = ?",
                     [.text(sourceId), .text(comicId)]).map(chapterRow)
    }

    func chapterStatesSync(sourceId: String, comicId: String) throws -> [ChapterReadEntity] {
        try chapterStates(sourceId: sourceId, comicId: comicId)
    }

    private func chapterRow(_ row: [String: SQLiteValue]) -> ChapterReadEntity {
        ChapterReadEntity(
            sourceId: row["sourceId"]?.textValue ?? "",
            comicId: row["comicId"]?.textValue ?? "",
            chapterId: row["chapterId"]?.textValue ?? "",
            status: Int(row["status"]?.intValue ?? 0),
            pageIndex: Int(row["pageIndex"]?.intValue ?? 0),
            pageCount: Int(row["pageCount"]?.intValue ?? 0),
            chapterIndex: Int(row["chapterIndex"]?.intValue ?? -1),
            updatedAt: row["updatedAt"]?.intValue ?? 0,
            bookmarked: (row["bookmarked"]?.intValue ?? 0) != 0
        )
    }

    func upsertChapterStates(_ entities: [ChapterReadEntity]) throws {
        try db.transaction {
            for e in entities {
                try db.exec("""
                    INSERT OR REPLACE INTO comic_chapter_read (sourceId, comicId, chapterId, status, pageIndex,
                    pageCount, chapterIndex, updatedAt, bookmarked) VALUES (?,?,?,?,?,?,?,?,?)
                    """, [.text(e.sourceId), .text(e.comicId), .text(e.chapterId),
                          .int(Int64(e.status)), .int(Int64(e.pageIndex)), .int(Int64(e.pageCount)),
                          .int(Int64(e.chapterIndex)), .int(e.updatedAt), .int(e.bookmarked ? 1 : 0)])
            }
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func setChapterStatus(sourceId: String, comicId: String, chapterId: String, status: Int,
                          updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws {
        try db.exec("""
            UPDATE comic_chapter_read SET status = ?, updatedAt = ?
            WHERE sourceId = ? AND comicId = ? AND chapterId = ?
            """, [.int(Int64(status)), .int(updatedAt), .text(sourceId), .text(comicId), .text(chapterId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    /** 「将以上全部标记为已读」：按阅读序号批量置位（缺章不影响） */
    func markChaptersReadUpTo(sourceId: String, comicId: String, maxIndex: Int,
                              updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws {
        try db.exec("""
            UPDATE comic_chapter_read SET status = 2, updatedAt = ?
            WHERE sourceId = ? AND comicId = ? AND chapterIndex <= ?
            """, [.int(updatedAt), .text(sourceId), .text(comicId), .int(Int64(maxIndex))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func clearChapterStates(sourceId: String, comicId: String) throws {
        try db.exec("DELETE FROM comic_chapter_read WHERE sourceId = ? AND comicId = ?", [.text(sourceId), .text(comicId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    // MARK: 事务复合操作

    /** 换源迁移：把某个漫画的收藏 + 进度整体搬到新的 (sourceId, comicId)。 */
    func migrateKey(fromSourceId: String, fromComicId: String, toSourceId: String, toComicId: String) throws {
        try db.transaction {
            if let fav = try favorite(sourceId: fromSourceId, comicId: fromComicId) {
                try deleteFavorite(sourceId: fromSourceId, comicId: fromComicId)
                var moved = fav
                moved.sourceId = toSourceId
                moved.comicId = toComicId
                try insertFavorite(moved)
            }
            if let prog = try progress(sourceId: fromSourceId, comicId: fromComicId) {
                try deleteProgress(sourceId: fromSourceId, comicId: fromComicId)
                var moved = prog
                moved.sourceId = toSourceId
                moved.comicId = toComicId
                try upsertProgress(moved)
            }
            let states = try chapterStatesSync(sourceId: fromSourceId, comicId: fromComicId)
            if !states.isEmpty {
                try clearChapterStates(sourceId: fromSourceId, comicId: fromComicId)
                try upsertChapterStates(states.map { s -> ChapterReadEntity in
                    var c = s; c.sourceId = toSourceId; c.comicId = toComicId; return c
                })
            }
        }
    }

    func deleteChapterIds(source: String, comic: String, ids: [String]) throws {
        for id in ids {
            try db.exec("DELETE FROM comic_chapter_read WHERE sourceId=? AND comicId=? AND chapterId=?",
                        [.text(source), .text(comic), .text(id)])
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func reconcileChapterIds(source: String, comic: String, states: [ChapterReadEntity],
                             progress: ComicProgressEntity?, oldIds: [String]) throws {
        try db.transaction {
            if !oldIds.isEmpty { try deleteChapterIds(source: source, comic: comic, ids: oldIds) }
            if !states.isEmpty { try upsertChapterStates(states) }
            if let progress { try upsertProgress(progress) }
        }
    }

    func migrateResolved(from: ComicKey, to: ComicKey, states: [ChapterReadEntity],
                         progress: ComicProgressEntity?, favorite: FavoriteEntity?, clearOld: Bool) throws {
        try db.transaction {
            if !states.isEmpty { try upsertChapterStates(states) }
            if let progress { try upsertProgress(progress) }
            if let favorite { try insertFavorite(favorite) }
            if clearOld {
                try clearChapterStates(sourceId: from.sourceId, comicId: from.comicId)
                try deleteProgress(sourceId: from.sourceId, comicId: from.comicId)
                try deleteFavorite(sourceId: from.sourceId, comicId: from.comicId)
            }
        }
    }

    /** Replace the favorite atomically. Keep old reading records as a fallback for missing chapters. */
    func replaceFavoriteMapped(from: ComicKey, replacement: FavoriteEntity,
                               mapping: [String: String], chapterOrders: [String: Int],
                               latestId: String?) throws -> FavoriteMigrationReport {
        guard let oldFavorite = try favorite(sourceId: from.sourceId, comicId: from.comicId) else {
            throw NSError(domain: "FavoriteDao", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "旧收藏已移除，请重新选择"])
        }
        let targetStates = try chapterStatesSync(sourceId: replacement.sourceId, comicId: replacement.comicId)
        var targetById: [String: ChapterReadEntity] = [:]
        for s in targetStates { targetById[s.chapterId] = s }
        let oldStates = try chapterStatesSync(sourceId: from.sourceId, comicId: from.comicId)
            .filter { $0.status != ChapterReadState.unread.code || $0.bookmarked }
        var mapped: [ChapterReadEntity] = []
        for state in oldStates {
            guard let chapterId = mapping[state.chapterId] else { continue }
            let existing = targetById[chapterId]
            var transferred = state
            transferred.sourceId = replacement.sourceId
            transferred.comicId = replacement.comicId
            transferred.chapterId = chapterId
            transferred.chapterIndex = chapterOrders[chapterId] ?? -1
            // Different editions have different page counts. Resume at this episode's first page.
            transferred.pageIndex = 0
            transferred.pageCount = 0
            transferred.bookmarked = state.bookmarked || (existing?.bookmarked == true)
            if let existing, (existing.status > state.status ||
                              (existing.status == state.status && existing.updatedAt >= state.updatedAt)) {
                var keep = existing
                keep.bookmarked = transferred.bookmarked
                mapped.append(keep)
            } else {
                mapped.append(transferred)
            }
        }
        let oldProgress = try progress(sourceId: from.sourceId, comicId: from.comicId)
        let resumeId = oldProgress?.lastChapterId.flatMap { mapping[$0] }
        let targetProgress = try progress(sourceId: replacement.sourceId, comicId: replacement.comicId)
        if let resumeId, let oldProgress,
           targetProgress?.lastChapterId == nil || (targetProgress?.lastReadAt ?? 0) < oldProgress.lastReadAt {
            var p = oldProgress
            p.sourceId = replacement.sourceId
            p.comicId = replacement.comicId
            p.lastChapterId = resumeId
            p.lastChapterIndex = chapterOrders[resumeId] ?? -1
            p.lastPageIndex = 0
            p.lastPageCount = 0
            p.seenTopChapterId = latestId
            p.seenChapterCount = chapterOrders.count
            try upsertProgress(p)
        }
        if !mapped.isEmpty { try upsertChapterStates(mapped) }
        let targetFavorite = try favorite(sourceId: replacement.sourceId, comicId: replacement.comicId)
        var rep = replacement
        rep.categoryName = targetFavorite?.categoryName ?? oldFavorite.categoryName
        rep.favoritedAt = targetFavorite?.favoritedAt ?? oldFavorite.favoritedAt
        rep.sortOrder = targetFavorite?.sortOrder ?? oldFavorite.sortOrder
        try insertFavorite(rep)
        try deleteFavorite(sourceId: from.sourceId, comicId: from.comicId)
        return FavoriteMigrationReport(migrated: mapped.count, unmatched: oldStates.count - mapped.count,
                                       resumeMatched: oldProgress?.lastChapterId == nil || resumeId != nil)
    }
}

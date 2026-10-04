// 对齐 god/GodMomentDao.kt（68 行）
// 神回 DAO：SQL 与 Kotlin 完全一致。Flow → dbChangedNotification 驱动的 AsyncStream
// （排行榜卡片与详情/编辑窗口监听同一流，增删改后两侧自动刷新）。

import Foundation

struct GodMomentDao {
    private let db: SQLiteDatabase

    init(db: SQLiteDatabase = AppDatabase.shared.db) {
        self.db = db
    }

    // MARK: - 行映射

    private func entity(from row: [String: SQLiteValue]) -> GodMomentEntity {
        var e = GodMomentEntity()
        e.id = row["id"]?.intValue ?? 0
        e.contentType = row["contentType"]?.textValue ?? GodContentType.comic.rawValue
        e.bookId = row["bookId"]?.textValue ?? ""
        e.chapterId = row["chapterId"]?.textValue ?? ""
        e.bookTitle = row["bookTitle"]?.textValue ?? ""
        e.chapterTitle = row["chapterTitle"]?.textValue ?? ""
        e.chapterNumber = Int(row["chapterNumber"]?.intValue ?? 0)
        e.title = row["title"]?.textValue ?? ""
        e.titleIsCustom = (row["titleIsCustom"]?.intValue ?? 0) != 0
        e.rating = Float(row["rating"]?.doubleValue ?? 5)
        e.note = row["note"]?.textValue ?? ""
        e.coverPath = row["coverPath"]?.textValue
        e.coverSource = row["coverSource"]?.textValue ?? CoverSource.comicDefault().toTag
        e.cropParams = row["cropParams"]?.textValue ?? CropParams.DEFAULT.toTag
        e.createdAt = row["createdAt"]?.intValue ?? Int64(Date().timeIntervalSince1970 * 1000)
        e.updatedAt = row["updatedAt"]?.intValue ?? Int64(Date().timeIntervalSince1970 * 1000)
        return e
    }

    private func bind(_ e: GodMomentEntity) -> [SQLiteValue] {
        [
            .text(e.contentType), .text(e.bookId), .text(e.chapterId),
            .text(e.bookTitle), .text(e.chapterTitle), .int(Int64(e.chapterNumber)),
            .text(e.title), .int(e.titleIsCustom ? 1 : 0), .real(Double(e.rating)),
            .text(e.note),
            e.coverPath.map { SQLiteValue.text($0) } ?? .null,
            .text(e.coverSource), .text(e.cropParams),
            .int(e.createdAt), .int(e.updatedAt),
        ]
    }

    // MARK: - 同步查询（与 Kotlin suspend 一致）

    /// 全量（排行榜消费）
    func allSync() throws -> [GodMomentEntity] {
        try db.query("SELECT * FROM god_moments ORDER BY rating DESC, createdAt DESC").map(entity(from:))
    }

    /// 一本书的全部神回（书籍详情页消费）
    func forBookSync(bookId: String) throws -> [GodMomentEntity] {
        try db.query("SELECT * FROM god_moments WHERE bookId = ? ORDER BY chapterNumber ASC", [.text(bookId)]).map(entity(from:))
    }

    /// 单话（唯一索引保证至多一条）
    func chapterSync(bookId: String, chapterId: String) throws -> GodMomentEntity? {
        try db.query("SELECT * FROM god_moments WHERE bookId = ? AND chapterId = ? LIMIT 1", [.text(bookId), .text(chapterId)]).first.map(entity(from:))
    }

    func byId(_ id: Int64) throws -> GodMomentEntity? {
        try db.query("SELECT * FROM god_moments WHERE id = ? LIMIT 1", [.int(id)]).first.map(entity(from:))
    }

    func count() throws -> Int {
        let rows = try db.query("SELECT COUNT(*) FROM god_moments")
        return Int(rows.first?.values.first?.intValue ?? 0)
    }

    // MARK: - 写入

    /// 插入或更新。冲突策略 REPLACE 会让自增 id 变化，因此先按 (bookId, chapterId)
    /// 取旧 id 复用——保证 UI 的 item key 稳定，排行榜位移过渡动画不因 id 跳变错位。
    @discardableResult
    func upsert(_ e: GodMomentEntity) throws -> Int64 {
        let existing = try chapterSync(bookId: e.bookId, chapterId: e.chapterId)
        var merged = e
        merged.id = existing?.id ?? e.id
        merged.createdAt = existing?.createdAt ?? e.createdAt
        let binds = bind(merged)
        if merged.id != 0 {
            try db.exec("""
                UPDATE god_moments SET contentType=?, bookId=?, chapterId=?, bookTitle=?, chapterTitle=?,
                chapterNumber=?, title=?, titleIsCustom=?, rating=?, note=?, coverPath=?, coverSource=?,
                cropParams=?, createdAt=?, updatedAt=? WHERE id=?
                """, binds + [.int(merged.id)])
            return merged.id
        }
        try db.exec("""
            INSERT INTO god_moments (contentType, bookId, chapterId, bookTitle, chapterTitle, chapterNumber,
            title, titleIsCustom, rating, note, coverPath, coverSource, cropParams, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, binds)
        return try db.query("SELECT last_insert_rowid() AS id").first?["id"]?.intValue ?? 0
    }

    @discardableResult
    func insert(_ e: GodMomentEntity) throws -> Int64 {
        try upsert(e)
    }

    func deleteById(_ id: Int64) throws {
        try db.exec("DELETE FROM god_moments WHERE id = ?", [.int(id)])
    }

    func deleteForBook(bookId: String) throws {
        try db.exec("DELETE FROM god_moments WHERE bookId = ?", [.text(bookId)])
    }

    func deleteForChapter(bookId: String, chapterId: String) throws {
        try db.exec("DELETE FROM god_moments WHERE bookId = ? AND chapterId = ?", [.text(bookId), .text(chapterId)])
    }

    func clear() throws {
        try db.exec("DELETE FROM god_moments")
    }

    // MARK: - Flow 对应（dbChangedNotification 驱动的 AsyncStream）

    private func notificationStream() -> AsyncStream<Void> {
        AsyncStream { continuation in
            continuation.yield()
            let token = NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { _ in
                continuation.yield()
            }
            continuation.onTermination = { _ in
                NotificationCenter.default.removeObserver(token)
            }
        }
    }

    func observeAll() -> AsyncStream<[GodMomentEntity]> {
        AsyncStream { continuation in
            let task = Task {
                for await _ in notificationStream() {
                    continuation.yield((try? allSync()) ?? [])
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func observeForBook(bookId: String) -> AsyncStream<[GodMomentEntity]> {
        AsyncStream { continuation in
            let task = Task {
                for await _ in notificationStream() {
                    continuation.yield((try? forBookSync(bookId: bookId)) ?? [])
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func observeChapter(bookId: String, chapterId: String) -> AsyncStream<GodMomentEntity?> {
        AsyncStream { continuation in
            let task = Task {
                for await _ in notificationStream() {
                    continuation.yield(try? chapterSync(bookId: bookId, chapterId: chapterId))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

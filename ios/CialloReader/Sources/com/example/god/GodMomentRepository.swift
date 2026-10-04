// 对齐 god/GodMomentRepository.kt（159 行）
// 神回仓库：Flow/suspend API 透传 + 级联删除（含封面文件清理）+ 备份导出/导入（只搬元数据）。
// 统一兜底：神回是附加功能，任何一步出问题只允许它自己不可用，绝不能把 App 带崩。

import Foundation
import UIKit

final class GodMomentRepository: ObservableObject {
    static let shared = GodMomentRepository()

    let dao: GodMomentDao
    /// Kotlin 引用 com.example.data.ContentMutationGate.mutex（data 代理对齐后切换过去）。
    private let mutationLock = NSLock()

    /// 全量神回（排行榜 + 统计页共用；对应 Kotlin observeAll Flow 的当前值）
    @Published private(set) var moments: [GodMomentEntity] = []

    init(dao: GodMomentDao = GodMomentDao()) {
        self.dao = dao
        reload()
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            self?.reload()
        }
    }

    /// 统一兜底：任何读取失败都降级为默认值（对应 Kotlin Flow.guarded）。
    func reload() {
        moments = (try? dao.allSync()) ?? []
    }

    func observeAll() -> AsyncStream<[GodMomentEntity]> { dao.observeAll() }
    func observeForBook(bookId: String) -> AsyncStream<[GodMomentEntity]> { dao.observeForBook(bookId: bookId) }
    func observeChapter(bookId: String, chapterId: String) -> AsyncStream<GodMomentEntity?> { dao.observeChapter(bookId: bookId, chapterId: chapterId) }

    /// 书籍详情页用：chapterId → 实体（章节卡片判断是否神回态）
    func observeChapterMap(bookId: String) -> AsyncStream<[String: GodMomentEntity]> {
        AsyncStream { continuation in
            let task = Task {
                for await list in dao.observeForBook(bookId: bookId) {
                    continuation.yield(Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) }))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func chapter(bookId: String, chapterId: String) -> GodMomentEntity? {
        try? dao.chapterSync(bookId: bookId, chapterId: chapterId)
    }

    func moment(bookId: String, chapterId: String) -> GodMomentEntity? {
        chapter(bookId: bookId, chapterId: chapterId)
    }

    func count() -> Int {
        (try? dao.count()) ?? 0
    }

    // MARK: - 保存与级联删除

    /// 保存（新增 or 更新）。复用旧 id（存在时）→ UI 列表 key 稳定；同时把 updatedAt
    /// 推到当前时间，封面缓存 key 含 updatedAt，编辑后能强制刷新图片缓存。
    @discardableResult
    func save(_ entity: GodMomentEntity) -> Int64 {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let existing = try? dao.chapterSync(bookId: entity.bookId, chapterId: entity.chapterId)
        var merged = entity
        merged.id = existing?.id ?? entity.id
        merged.createdAt = existing?.createdAt ?? entity.createdAt
        merged.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        let inserted = (try? dao.upsert(merged)) ?? 0
        // Database commits before any associated file is removed.
        if let oldCover = existing?.coverPath, oldCover != merged.coverPath {
            GodCoverEngine.deleteQuietly(oldCover)
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
        return merged.id != 0 ? merged.id : inserted
    }

    /// Database commits before any associated file is removed.
    func delete(id: Int64) {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        guard let entity = try? dao.byId(id) else { return }
        try? dao.deleteById(id)
        GodCoverEngine.deleteQuietly(entity.coverPath)
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteForBook(bookId: String) {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let entities = (try? dao.forBookSync(bookId: bookId)) ?? []
        try? dao.deleteForBook(bookId: bookId)
        entities.forEach { GodCoverEngine.deleteQuietly($0.coverPath) }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteForChapter(bookId: String, chapterId: String) {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let entity = try? dao.chapterSync(bookId: bookId, chapterId: chapterId)
        try? dao.deleteForChapter(bookId: bookId, chapterId: chapterId)
        GodCoverEngine.deleteQuietly(entity?.coverPath)
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    // MARK: - 备份

    /// 导出神回元数据为 JSON 数组（不含封面位图，封面可重建）。
    func exportJson() -> [[String: Any]] {
        ((try? dao.allSync()) ?? []).map { e in
            [
                "id": e.id, "contentType": e.contentType, "bookId": e.bookId,
                "chapterId": e.chapterId, "bookTitle": e.bookTitle, "chapterTitle": e.chapterTitle,
                "chapterNumber": e.chapterNumber, "title": e.title, "titleIsCustom": e.titleIsCustom,
                "rating": Double(e.rating), "note": e.note, "coverSource": e.coverSource,
                "cropParams": e.cropParams, "createdAt": e.createdAt, "updatedAt": e.updatedAt,
            ] as [String: Any]
        }
    }

    /// 导入（同 (bookId, chapterId) 覆盖）。
    @discardableResult
    func importJson(_ arr: [[String: Any]]?) -> Int {
        guard let arr else { return 0 }
        var n = 0
        for o in arr {
            var e = GodMomentEntity()
            e.contentType = o["contentType"] as? String ?? GodContentType.comic.rawValue
            e.bookId = o["bookId"] as? String ?? ""
            e.chapterId = o["chapterId"] as? String ?? ""
            e.bookTitle = o["bookTitle"] as? String ?? ""
            e.chapterTitle = o["chapterTitle"] as? String ?? ""
            e.chapterNumber = o["chapterNumber"] as? Int ?? 0
            e.title = o["title"] as? String ?? ""
            e.titleIsCustom = o["titleIsCustom"] as? Bool ?? false
            e.rating = Float(min(max(o["rating"] as? Double ?? 5, 0.5), 5))
            e.note = o["note"] as? String ?? ""
            e.coverPath = nil
            e.coverSource = o["coverSource"] as? String ?? CoverSource.comicDefault().toTag
            e.cropParams = o["cropParams"] as? String ?? CropParams.DEFAULT.toTag
            e.createdAt = o["createdAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
            e.updatedAt = o["updatedAt"] as? Int64 ?? Int64(Date().timeIntervalSince1970 * 1000)
            if e.bookId.isEmpty || e.chapterId.isEmpty { continue }
            save(e)
            n += 1
        }
        return n
    }
}

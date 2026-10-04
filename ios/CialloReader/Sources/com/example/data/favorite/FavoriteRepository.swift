import Foundation

// MARK: - 「我喜欢的」收藏仓库（data/favorite/FavoriteRepository.kt + ComicReadingLogic.kt 镜像）
// 纯在线收藏制：只有 (sourceId, comicId) 一条记录，不落地任何文件；
// 与书架/进度三套数据互不干涉。

@MainActor
final class FavoriteRepository: ObservableObject {
    static let shared = FavoriteRepository()

    @Published private(set) var favorites: [FavoriteEntity] = []

    private let db = AppDatabase.shared
    private var lastUpdateCheck: [String: Date] = [:]

    private init() {
        reload()
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    func reload() {
        favorites = (try? db.favorites()) ?? []
    }

    // MARK: 收藏 CRUD

    func add(book: SearchBook, source: BookSource?) async -> Bool {
        let fav = FavoriteEntity(
            sourceId: book.sourceId,
            comicId: book.id,
            title: book.title,
            author: book.author,
            coverUrl: book.cover ?? "",
            serialStatus: SerialStatus.unknown.rawValue,
            latestChapterId: nil,
            latestChapterTitle: nil,
            categoryName: nil)
        do {
            try db.upsertFavorite(fav)
            reload()
            return true
        } catch {
            return false
        }
    }

    func remove(sourceId: String, comicId: String) async {
        try? db.removeFavorite(sourceId: sourceId, comicId: comicId)
        reload()
    }

    func isFavorited(sourceId: String, comicId: String) async -> Bool {
        (try? db.favorite(sourceId: sourceId, comicId: comicId)) != nil
    }

    func moveToCategory(keys: [ComicKey], categoryName: String?) {
        try? db.moveFavoritesToCategory(keys: keys, categoryName: categoryName)
        reload()
    }

    // MARK: 进度（comic_progress 两边共用）

    func saveProgress(sourceId: String, comicId: String, chapterId: String, chapterIndex: Int, pageIndex: Int, pageCount: Int) {
        let p = ComicProgressEntity(
            sourceId: sourceId, comicId: comicId,
            lastChapterId: chapterId, lastChapterIndex: chapterIndex,
            lastPageIndex: pageIndex, lastPageCount: pageCount,
            lastReadAt: Int64(Date().timeIntervalSince1970 * 1000),
            seenTopChapterId: nil, seenChapterCount: 0)
        try? db.saveProgress(p)
    }

    func progress(sourceId: String, comicId: String) async -> ComicProgressEntity? {
        try? db.progress(sourceId: sourceId, comicId: comicId)
    }

    func markChapterRead(sourceId: String, comicId: String, chapterId: String, chapterIndex: Int, pageIndex: Int, pageCount: Int, finished: Bool) {
        let e = ChapterReadEntity(
            sourceId: sourceId, comicId: comicId, chapterId: chapterId,
            status: finished ? ChapterReadState.finished.rawValue : ChapterReadState.reading.rawValue,
            pageIndex: pageIndex, pageCount: pageCount, chapterIndex: chapterIndex,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            bookmarked: false)
        try? db.markChapter(e)
    }

    func chapterReads(sourceId: String, comicId: String) async -> [ChapterReadEntity] {
        (try? db.chapterReads(sourceId: sourceId, comicId: comicId)) ?? []
    }

    // MARK: 章节阅读状态逻辑（ComicReadingLogic.kt 纯函数）

    /// 章节排序键：卷号 + 章节序
    static func orderKey(_ c: ComicChapter) -> Float {
        c.order
    }

    static func ordered(_ chapters: [ComicChapter]) -> [ComicChapter] {
        chapters.sorted { orderKey($0) < orderKey($1) }
    }

    /// 续读目标
    static func resolveContinue(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> (chapter: ComicChapter, page: Int)? {
        guard !chapters.isEmpty else { return nil }
        let orderedChapters = ordered(chapters)
        if let progress,
           let hit = orderedChapters.first(where: { $0.id == progress.lastChapterId }) {
            return (hit, progress.lastPageIndex)
        }
        return (orderedChapters[0], 0)
    }

    static func continueLabel(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> String {
        guard let target = resolveContinue(progress: progress, chapters: chapters) else { return "开始阅读" }
        return "续读 \(target.chapter.title)"
    }

    /// 更新数：seenChapterCount 之后的新章
    static func newChapterIds(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> Set<String> {
        guard let progress else { return [] }
        let orderedChapters = ordered(chapters)
        guard progress.seenChapterCount > 0, progress.seenChapterCount < orderedChapters.count else { return [] }
        return Set(orderedChapters[progress.seenChapterCount...].map { $0.id })
    }

    static func readRatio(reads: [ChapterReadEntity], chapters: [ComicChapter]) -> Double {
        guard !chapters.isEmpty else { return 0 }
        let finished = reads.filter { $0.state == .finished }.count
        return Double(finished) / Double(chapters.count)
    }

    // MARK: 更新检查（checkUpdates：节流防并发打源）

    func checkUpdates(for fav: FavoriteEntity, source: BookSource) async -> FavoriteEntity? {
        // 更新节流：同一收藏 5 分钟内不重复检查
        let key = fav.id
        if let last = lastUpdateCheck[key], Date().timeIntervalSince(last) < 300 {
            return nil
        }
        lastUpdateCheck[key] = Date()
        guard let comic = source as? ComicSourceProtocol else { return nil }
        let result = await comic.getChapters(bookId: fav.comicId)
        guard case .success(let chapters) = result, let latest = Self.ordered(chapters).last else {
            // 源失效
            var updated = fav
            updated.sourceAlive = false
            updated.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
            try? db.upsertFavorite(updated)
            reload()
            return updated
        }
        var updated = fav
        updated.sourceAlive = true
        updated.latestChapterId = latest.id
        updated.latestChapterTitle = latest.title
        updated.latestChapterUpdateAt = Int64(Date().timeIntervalSince1970 * 1000)
        updated.lastCheckedAt = updated.latestChapterUpdateAt
        try? db.upsertFavorite(updated)
        reload()
        return updated
    }
}

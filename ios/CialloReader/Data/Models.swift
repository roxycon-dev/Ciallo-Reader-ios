import Foundation

// MARK: - 数据模型（data/Book.kt + data/favorite/FavoriteModels.kt + download/ + god/ 镜像）

/// 不支持阅读的格式入库时使用的占位章节标题。
let unsupportedChapterTitle = "暂不支持阅读"

/// 章节最大长度：超过则入库时拆分为多个小章节。
let maxChapterLength = 30_000

/// 第七轮第 6.1 条：默认分类名。
let defaultCategory = "默认"

enum ContentType: String, CaseIterable {
    case novel = "NOVEL"
    case comic = "COMIC"
}

// MARK: Book

struct Book: Identifiable, Hashable {
    var id: Int = 0
    var title: String
    var author: String = "未知作者"
    var filePath: String
    var coverUri: String? = nil
    var category: String = defaultCategory
    var currentChapterIndex: Int = 0
    var scrollOffset: Int = 0
    var isFinished: Bool = false
    var totalChapters: Int = 0
    var contentType: String = ContentType.novel.rawValue
    var addedTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var lastReadTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    /// 在线下载入库的书才有；与 comicId 一起构成「我喜欢的」关联键。
    var sourceId: String? = nil
    var comicId: String? = nil

    var isComic: Bool { contentType == ContentType.comic.rawValue }
}

// MARK: Chapter

struct Chapter: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int
    var chapterOrder: Int
    var title: String
    var content: String
    var startCharIndex: Int64 = 0
    var endCharIndex: Int64 = 0
}

// MARK: Bookmark / Highlight

struct Bookmark: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int
    var chapterIndex: Int
    var scrollOffset: Int
    var title: String
    var snippet: String
    var createdTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
}

struct Highlight: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int
    var chapterIndex: Int
    var selectedText: String
    var note: String = ""
    var colorHex: String = "#7FD8C8"
    var createdTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
}

struct CategoryEntity: Identifiable, Hashable {
    var id: Int = 0
    var name: String
    var isProtected: Bool = false
}

// MARK: 阅读记录 / 会话

struct ReadingRecord: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int?
    var bookTitle: String
    var dateStr: String
    var durationSeconds: Int64
}

struct ReadingSession: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int?
    var bookTitle: String
    var dateStr: String
    var startTimeMs: Int64
    var endTimeMs: Int64
    var durationSeconds: Int64
    var startHour: Int
}

struct SearchResultItem: Hashable {
    let chapterIndex: Int
    let chapterTitle: String
    let snippet: String
    /// 关键词是逻辑章正文中的第几处出现（0 起）。
    var occurrence: Int = 0
}

// MARK: 收藏（data/favorite/）

enum SerialStatus: String {
    case unknown = "UNKNOWN"
    case ongoing = "ONGOING"
    case completed = "COMPLETED"
}

struct FavoriteEntity: Identifiable, Hashable {
    var sourceId: String
    var comicId: String
    var title: String
    var author: String
    var coverUrl: String
    var localThumbPath: String?
    var serialStatus: String = SerialStatus.unknown.rawValue
    var latestChapterId: String?
    var latestChapterTitle: String?
    var latestChapterUpdateAt: Int64 = 0
    var lastCheckedAt: Int64 = 0
    var sourceAlive: Bool = true
    var categoryName: String?
    var favoritedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var sortOrder: Int = 0

    var id: String { "\(sourceId)::\(comicId)" }
    var key: ComicKey { ComicKey(sourceId: sourceId, comicId: comicId) }
}

struct ComicKey: Hashable {
    let sourceId: String
    let comicId: String
}

struct ComicProgressEntity: Hashable {
    var sourceId: String
    var comicId: String
    var lastChapterId: String
    var lastChapterIndex: Int
    var lastPageIndex: Int
    var lastPageCount: Int
    var lastReadAt: Int64
    var seenTopChapterId: String?
    var seenChapterCount: Int
}

enum ChapterReadState: Int {
    case unread = 0
    case reading = 1
    case finished = 2
}

struct ChapterReadEntity: Hashable {
    var sourceId: String
    var comicId: String
    var chapterId: String
    var status: Int
    var pageIndex: Int
    var pageCount: Int
    var chapterIndex: Int
    var updatedAt: Int64
    var bookmarked: Bool

    var state: ChapterReadState { ChapterReadState(rawValue: status) ?? .unread }
}

struct FavoriteCategoryEntity: Identifiable, Hashable {
    var name: String
    var sortOrder: Int
    var createdAt: Int64

    var id: String { name }
}

// MARK: 下载任务（download/DownloadTaskEntity.kt）

enum DownloadStatus: String {
    case pending
    case downloading
    case paused
    case success
    case error
}

struct DownloadTaskEntity: Identifiable, Hashable {
    /// sourceId + 原始资源 ID 的长度前缀复合键
    var id: String
    var sourceId: String
    var title: String
    var author: String
    var coverUrl: String
    var downloadUrl: String
    var format: String
    var status: String = DownloadStatus.pending.rawValue
    var downloadedBytes: Int64 = 0
    var totalBytes: Int64 = 0
    var filePath: String?
    var errorMessage: String?
    var updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    var state: DownloadStatus { DownloadStatus(rawValue: status) ?? .pending }
}

// MARK: 神回（god/GodMomentModels.kt）

enum GodContentType: String {
    case comic = "COMIC"
    case novel = "NOVEL"
}

struct GodMomentEntity: Identifiable, Hashable {
    var id: Int = 0
    var contentType: String = GodContentType.comic.rawValue
    var bookId: String
    var chapterId: String
    var bookTitle: String
    var chapterTitle: String
    var chapterNumber: Int = 0
    var title: String = ""
    var titleIsCustom: Bool = false
    var rating: Double = 0
    var note: String = ""
    var coverPath: String?
    var coverSource: String?
    var cropParams: String?
    var createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
}

// MARK: - 下载状态密封类（DownloadState.kt）

enum DownloadState: Equatable {
    case idle
    case pending
    case downloading(progress: Double, bytesPerSecond: Int64, remainingBytes: Int64)
    case paused
    case success
    case error(String)
}

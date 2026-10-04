import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/FavoriteModels.kt（158 行）

/**
 * 「我喜欢的」= 在线收藏（追漫）：不下载、不占空间，用 (sourceId, comicId) 唯一标识。
 * 与下载（Download）和阅读进度（ComicProgressEntity）三张数据相互独立：
 * 同一漫画可「仅下载 / 仅喜欢 / 两者都有」，取消喜欢不影响下载与进度。
 */

/// 收藏默认分类（与书架分类体系一致：单分类，分类行复用 categories 表）。
let favDefaultCategory = "默认" // Kotlin: FAV_DEFAULT_CATEGORY

/// 章节阅读状态：未读 / 阅读中 / 已读。存库用 ChapterReadState.code。
enum ChapterReadState: Int {
    case unread = 0   // UNREAD(0)
    case reading = 1  // READING(1)
    case read = 2     // READ(2)

    static func of(_ code: Int) -> ChapterReadState {
        ChapterReadState(rawValue: code) ?? .unread
    }
}

/// 连载状态快照（存字符串，未知来源也能安全落地）。
enum SerialStatus: String {
    case unknown = "unknown"
    case ongoing = "ongoing"
    case completed = "completed"
    case hiatus = "hiatus"

    static func of(_ code: String?) -> SerialStatus {
        SerialStatus(rawValue: code ?? "") ?? .unknown
    }
}

// MARK: FavoriteEntity

struct FavoriteEntity: Identifiable, Hashable {
    /// 书源 id（无来源的本地书不能被喜欢）
    var sourceId: String
    /// 源内的漫画 id
    var comicId: String
    var title: String
    var author: String = ""
    /// Kotlin 为 String? = null；iOS 侧保持非可选（HomeScreen 引用 coverUrl.isEmpty），NULL 读回为空串
    var coverUrl: String = ""
    /// 封面缩略图的本地缓存路径（离线/弱网时仍能显示卡片）
    var localThumbPath: String? = nil
    var serialStatus: String = SerialStatus.unknown.rawValue
    /* ── 最新章节快照（stale-while-revalidate 的 stale 来源） ── */
    var latestChapterId: String? = nil
    var latestChapterTitle: String? = nil
    var latestChapterUpdateAt: Int64 = 0
    /// 上次真正联网检查更新的时刻（用于 >30 分钟才检查的限流）
    var lastCheckedAt: Int64 = 0
    /// 上次检查时源是否可用（false → 卡片显示灰色警示，但不删除、可看缓存）
    var sourceAlive: Bool = true
    var categoryName: String = favDefaultCategory
    var favoritedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var sortOrder: Int = 0

    var id: String { "\(sourceId)::\(comicId)" }
    var key: ComicKey { ComicKey(sourceId: sourceId, comicId: comicId) }
}

// MARK: ComicProgressEntity

/// 漫画级阅读进度：与是否收藏、是否下载无关。
struct ComicProgressEntity: Hashable {
    var sourceId: String
    var comicId: String
    /// 上次读到的章节 id
    var lastChapterId: String? = nil
    /// 上次读到的章节在「阅读顺序」中的序号（冗余，便于下一话计算）
    var lastChapterIndex: Int = -1
    /// 上次读到的页（0 起）
    var lastPageIndex: Int = 0
    /// 该章节总页数（用于判定已读与显示百分比）
    var lastPageCount: Int = 0
    var lastReadAt: Int64 = 0
    /// 上次进入章节列表时的「最新章节 id」——此后新增的章节显示「新」红点
    var seenTopChapterId: String? = nil
    /// 上次进入时的章节总数（源结构变化时兜底判新）
    var seenChapterCount: Int = 0

    /// 该章节是否读到「已读」判定线（最后一页 或 进度 ≥90%）。纯函数，可单测。
    func isChapterFinished() -> Bool {
        if lastPageCount <= 0 { return false }
        if lastPageIndex >= lastPageCount - 1 { return true }
        return Double(lastPageIndex + 1) / Double(lastPageCount) >= 0.9
    }
}

/**
 * 「我喜欢的」的分类 —— 与书架的 categories 表**完全独立**。
 *
 * 书架（本地下载制）和我喜欢的（在线收藏制）是两套系统，分类也各过各的：
 * 在书架里改/删一个分类，不会牵动我喜欢的的任何分组。
 */
struct FavoriteCategoryEntity: Identifiable, Hashable {
    var name: String
    var sortOrder: Int = 0
    var createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    var id: String { name }
}

// MARK: ChapterReadEntity

/// 章节级阅读状态。
struct ChapterReadEntity: Hashable {
    var sourceId: String
    var comicId: String
    var chapterId: String
    var status: Int = ChapterReadState.unread.code
    /// 读到第几页（0 起）
    var pageIndex: Int = 0
    var pageCount: Int = 0
    /// 章节在阅读顺序中的序号（源正序/倒序归一化后的值）
    var chapterIndex: Int = -1
    var updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    /// 读者手动标注的书签（详情页左滑/右滑该话卡片切换）
    var bookmarked: Bool = false

    var state: ChapterReadState { ChapterReadState.of(status) }
}

// MARK: FavoriteItem / ComicKey / favoriteKey

/// UI 消费的聚合模型：收藏 + 进度 + 已下载章节数。
struct FavoriteItem {
    var favorite: FavoriteEntity
    var progress: ComicProgressEntity? = nil
    /// 已下载到本地书架的章节数（0 表示纯在线收藏）
    var downloadedChapters: Int = 0

    var key: String { favoriteKey(favorite.sourceId, favorite.comicId) }
    /// 是否在线收藏 + 本地下载都有
    var alsoDownloaded: Bool { downloadedChapters > 0 }
}

/// 三张表统一使用的业务主键。
struct ComicKey: Hashable {
    var sourceId: String
    var comicId: String

    var raw: String { favoriteKey(sourceId, comicId) }
    /// 无来源信息的书（手动导入的本地文件）不能被喜欢
    var valid: Bool { !sourceId.trimmingCharacters(in: .whitespaces).isEmpty && !comicId.trimmingCharacters(in: .whitespaces).isEmpty }
}

func favoriteKey(_ sourceId: String, _ comicId: String) -> String { "\(sourceId)::\(comicId)" }

extension ChapterReadState {
    /// Kotlin `val code: Int`
    var code: Int { rawValue }
}

extension SerialStatus {
    /// Kotlin `val code: String`
    var code: String { rawValue }
}

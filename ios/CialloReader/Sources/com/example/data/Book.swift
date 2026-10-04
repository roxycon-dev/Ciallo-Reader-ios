import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/Book.kt（113 行）
// （favorite/download 聚合模型已拆至 favorite/FavoriteModels.swift 与 download/DownloadTaskEntity.swift；
//   god 模型保留在本文件底部聚合区——god 包归别的代理，不要动。）

/// 不支持阅读的格式（PDF/MOBI 等）入库时使用的占位章节标题。
let unsupportedChapterTitle = "暂不支持阅读"

/// 章节最大长度：超过则入库时拆分为多个小章节，保证打开阅读器不卡顿/不闪退。
let maxChapterLength = 30_000

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
    var contentType: String = "NOVEL"
    var addedTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var lastReadTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    /**
     * 来源标识（在线下载入库的书才有）：与 comicId 一起构成「我喜欢的」的
     * 关联键 (sourceId, comicId)。手动导入的本地文件为空 —— 这类书不能被喜欢，
     * 但阅读进度照常记录。
     */
    var sourceId: String? = nil
    var comicId: String? = nil

    var isComic: Bool { contentType == "COMIC" }
    /// Room @Ignore 字段：封面是否有效
    var isCoverValid: Bool = false
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

// MARK: Bookmark

struct Bookmark: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int
    var chapterIndex: Int
    var scrollOffset: Int
    var title: String
    var snippet: String
    var createdTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
}

// MARK: Highlight

struct Highlight: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int
    var chapterIndex: Int
    var selectedText: String
    var note: String = ""
    var colorHex: String = "#7FD8C8"
    var createdTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
}

/// 第七轮第 6.1 条：默认分类名——书架不再有聚合视图"全部"，所有书籍必须归属
/// 一个真实分类；默认分类不可删除。
let defaultCategory = "默认"

// MARK: CategoryEntity

struct CategoryEntity: Identifiable, Hashable {
    var id: Int = 0
    var name: String
    /// 第七轮第 6.3 条：密码保护标记（隐私模式开启时生效；长按分类或隐私窗口切换）
    var isProtected: Bool = false
}

// MARK: ReadingRecord

struct ReadingRecord: Identifiable, Hashable {
    var id: Int = 0
    var bookId: Int?
    var bookTitle: String
    var dateStr: String
    var durationSeconds: Int64
}

// MARK: SearchResultItem

struct SearchResultItem: Hashable {
    let chapterIndex: Int
    let chapterTitle: String
    let snippet: String
    /// 关键词是合并后逻辑章正文中的第几处出现（0 起）。
    /// 不用字符偏移：ChapterMerger 的物理→逻辑偏移表基于空 content 的 metadata，不可信；
    /// "第 N 处出现"在渲染文本上直接数，天然免疫缩进/清洗造成的偏移漂移。
    var occurrence: Int = 0
}

// MARK: - 神回（god/GodMomentModels.kt 聚合区，god 包归别的代理——不要动）

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

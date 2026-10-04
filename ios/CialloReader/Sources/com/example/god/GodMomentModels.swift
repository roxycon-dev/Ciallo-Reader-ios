// 对齐 god/GodMomentModels.kt（335 行）
// 「神回」数据模型：枚举/封面来源/裁剪参数/实体/UI 消费模型/跨路由信标/排序比较器。
// 设计要点（与 Kotlin 相同）：
// - GodContentType 区分漫画/小说，本期只实现漫画，字段与流程都为小说留好位置；
// - CoverSource 用枚举关联值抽象封面来源；bookId/chapterId 用字符串：
//   在线漫画 bookId = "sourceId::comicId"，本地漫画 bookId = 书籍主键字符串。

import Foundation

// MARK: - 内容类型（本期只做 COMIC，NOVEL 为扩展口）

enum GodContentType: String, CaseIterable {
    case comic = "comic"
    case novel = "novel"

    var label: String {
        switch self {
        case .comic: return "漫画"
        case .novel: return "小说"
        }
    }

    static func of(_ code: String?) -> GodContentType {
        allCases.first { $0.rawValue == code } ?? .comic
    }
}

// MARK: - 神回排行榜展示风格（设置项三选一）

enum GodRankingStyle: String, CaseIterable, Identifiable {
    case podium = "podium"
    case vinylShelf = "vinyl"
    case polaroidWall = "polaroid"

    var label: String {
        switch self {
        case .podium: return "领奖台"
        case .vinylShelf: return "唱片架"
        case .polaroidWall: return "照片墙"
        }
    }

    var desc: String {
        switch self {
        case .podium: return "前三名登台，其余卡牌流"
        case .vinylShelf: return "黑胶 Cover Flow 翻阅"
        case .polaroidWall: return "拍立得挂在麻绳上"
        }
    }

    static func of(_ code: String?) -> GodRankingStyle {
        allCases.first { $0.rawValue == code } ?? .podium
    }
}

// MARK: - 排行榜排序方式

enum GodSort: String, CaseIterable {
    case rating = "rating"
    case recent = "recent"
    case book = "book"

    var label: String {
        switch self {
        case .rating: return "评分"
        case .recent: return "最近添加"
        case .book: return "书籍"
        }
    }
}

// MARK: - 封面来源

/// 封面来源。存库前用 toTag() 序列化为一行字符串，解析用 parseCoverSource。
enum CoverSource: Equatable {
    /// 漫画页：页序号（0 起）+ 页 id（本地=文件签名，在线=url 指纹，可为空）
    case comicPage(pageIndex: Int, pageId: String)
    /// 相册：Photo Picker 返回的 content:// Uri 字符串
    case album(uri: String)
    /// 小说摘录（预留，本期不落地）
    case novelExcerpt(chapterId: String, start: Int, end: Int)

    /// 默认来源：漫画第 0 页
    static func comicDefault(pageIndex: Int = 0) -> CoverSource {
        .comicPage(pageIndex: pageIndex, pageId: "")
    }
}

extension CoverSource {
    var toTag: String {
        switch self {
        case .comicPage(let pageIndex, let pageId): return "page|\(pageIndex)|\(pageId)"
        case .album(let uri): return "album|\(uri)"
        case .novelExcerpt(let chapterId, let start, let end): return "novel|\(chapterId)|\(start)|\(end)"
        }
    }
}

func parseCoverSource(_ tag: String?) -> CoverSource {
    guard let tag, !tag.trimmingCharacters(in: .whitespaces).isEmpty else { return .comicPage(pageIndex: 0, pageId: "") }
    let p = tag.components(separatedBy: "|")
    switch p.first {
    case "page":
        return .comicPage(pageIndex: p.count > 1 ? Int(p[1]) ?? 0 : 0,
                          pageId: p.count > 2 ? p[2] : "")
    case "album":
        return .album(uri: p.count > 1 ? p[1] : "")
    case "novel":
        return .novelExcerpt(chapterId: p.count > 1 ? p[1] : "",
                             start: p.count > 2 ? Int(p[2]) ?? 0 : 0,
                             end: p.count > 3 ? Int(p[3]) ?? 0 : 0)
    default:
        return .comicPage(pageIndex: 0, pageId: "")
    }
}

// MARK: - 裁剪参数

/// 裁剪参数。
/// - cropL/T/R/B：（旋转后）原图归一化坐标 0~1，与视口无关；
/// - scale/offsetX/offsetY/rotationDeg：编辑视图变换快照，仅用于再次编辑还原，不参与合成。
struct CropParams: Equatable {
    var scale: Float = 1
    var offsetX: Float = 0
    var offsetY: Float = 0
    var rotationDeg: Float = 0
    var cropL: Float = 0
    var cropT: Float = 0
    var cropR: Float = 1
    var cropB: Float = 1

    /// 裁剪框宽高比（自由比例；无效/整图时近似值）
    var cropAspect: Float {
        let w = max(cropR - cropL, 0.0001)
        let h = max(cropB - cropT, 0.0001)
        return w / h
    }

    var toTag: String {
        [scale, offsetX, offsetY, rotationDeg, cropL, cropT, cropR, cropB]
            .map { round3($0) }
            .joined(separator: ",")
    }

    static let DEFAULT = CropParams()

    static func parse(_ tag: String?) -> CropParams {
        guard let tag, !tag.trimmingCharacters(in: .whitespaces).isEmpty else { return DEFAULT }
        let p = tag.components(separatedBy: ",")
        func f(_ i: Int, _ d: Float) -> Float { p.count > i ? Float(p[i]) ?? d : d }
        return CropParams(
            scale: f(0, 1),
            offsetX: f(1, 0),
            offsetY: f(2, 0),
            rotationDeg: f(3, 0),
            cropL: min(max(f(4, 0), 0), 1),
            cropT: min(max(f(5, 0), 0), 1),
            cropR: min(max(f(6, 1), 0), 1),
            cropB: min(max(f(7, 1), 0), 1)
        ).normalized()
    }

    /// 修正非法矩形（左右/上下颠倒或退化）。
    func normalized() -> CropParams {
        let l = min(max(cropL, 0), 1)
        let t = min(max(cropT, 0), 1)
        let r = min(max(cropR, 0), 1)
        let b = min(max(cropB, 0), 1)
        var copy = self
        copy.cropL = min(l, r)
        copy.cropR = min(max(r, min(l, r) + 0.02), 1)
        copy.cropT = min(t, b)
        copy.cropB = min(max(b, min(t, b) + 0.02), 1)
        return copy
    }
}

filefilefileprivate func round3(_ v: Float) -> String {
    let rounded = (v * 1000).rounded() / 1000
    // 与 Kotlin roundToInt/1000f 的字符串化保持一致（去掉多余 0）
    let s = String(format: "%.3f", rounded)
    let trimmed = s.replacingOccurrences(of: #"(?<=\d)0+$"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
    return trimmed
}

// MARK: - Room 实体

/// 神回实体。唯一索引 (bookId, chapterId)：同一话只有一个神回（重复标记=更新）。
/// 漫画主键是源作用域字符串，无法建外键，改为仓库级级联（deleteForBook/deleteForChapter，含封面清理）。
struct GodMomentEntity: Identifiable, Equatable {
    var id: Int64 = 0
    var contentType: String = GodContentType.comic.rawValue
    /// 在线漫画 = "sourceId::comicId"；本地漫画 = 书籍主键字符串
    var bookId: String = ""
    /// 章节 id（在线=源章节 id；本地=章节主键字符串）
    var chapterId: String = ""
    /// 书名快照（排行榜/备份用，删书后仍可展示来源）
    var bookTitle: String = ""
    /// 章节名快照
    var chapterTitle: String = ""
    /// 话数（用于默认标题「书名 第X话」）
    var chapterNumber: Int = 0
    /// 神回名称；未自定义时跟随「书名 第X话」
    var title: String = ""
    var titleIsCustom: Bool = false
    /// 0.5 ~ 5.0，步长 0.5（不允许 0 分）
    var rating: Float = 5
    /// 随笔 ≤ 500 字
    var note: String = ""
    /// 合成后的封面文件路径（Documents/god_covers 下）
    var coverPath: String? = nil
    /// CoverSource.toTag
    var coverSource: String = CoverSource.comicDefault().toTag
    /// CropParams.toTag
    var cropParams: String = CropParams.DEFAULT.toTag
    var createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    var source: CoverSource { parseCoverSource(coverSource) }
    var crop: CropParams { CropParams.parse(cropParams) }
    var contentTypeEnum: GodContentType { GodContentType.of(contentType) }

    /// 未自定义名称时的兜底标题
    func effectiveTitle() -> String {
        if titleIsCustom && !title.trimmingCharacters(in: .whitespaces).isEmpty { return title }
        return defaultTitle()
    }

    func defaultTitle() -> String {
        if bookTitle.isEmpty {
            return chapterTitle.isEmpty ? "第\(chapterNumber)话" : chapterTitle
        }
        return "\(bookTitle) 第\(chapterNumber)话"
    }
}

/// UI 消费模型：实体 + 排名（1 起）。
struct GodMomentItem: Identifiable {
    let entity: GodMomentEntity
    var rank: Int = 0

    var id: Int64 { entity.id }
}

/// 阅读器 → 神回窗口的上下文。null/nil 场景 = 该场景不启用神回。
struct GodMomentContext {
    /// 在线漫画 = "sourceId::comicId"；本地漫画 = "local_<bookId>"
    var bookId: String
    /// 章节 id（本地漫画 = 书籍主键字符串，整本视为一话）
    var chapterId: String
    var bookTitle: String
    var chapterTitle: String = ""
    var chapterNumber: Int = 1
    /// 在线页需要带 referer/自定义头，这里带上专用加载器（iOS 用请求头字典）
    var remoteHeaders: [String: String] = [:]

    var enabled: Bool { !bookId.isEmpty && !chapterId.isEmpty }
}

/// 建立 / 更新神回的请求（阅读器触发 & 详情页编辑共用）。
struct GodMomentRequest {
    var contentType: GodContentType = .comic
    var bookId: String
    var chapterId: String
    var bookTitle: String
    var chapterTitle: String = ""
    var chapterNumber: Int = 0
    /// 本话全部页引用（页面选择器用）
    var pages: [GodPageRef] = []
    /// 默认选中页（用户当前读到的页）
    var initialPageIndex: Int = 0
}

/// 页面引用（与阅读器的 ComicPageRef 解耦，避免 UI 层反向依赖）。
struct GodPageRef: Identifiable, Equatable {
    var id: String
    /// 本地文件路径 或 在线 URL
    var source: String
    var remote: Bool
    /// 在线页的请求头（在线源需要 referer/自定义头）
    var headers: [String: String] = [:]
}

/// 神回封面请求与阅读器保持相同防盗链头；已有源专用 Referer 时优先保留。
func godPageHeaders(_ headers: [String: String], referer: String?) -> [String: String] {
    if referer == nil || (referer ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        || headers.keys.contains(where: { $0.caseInsensitiveCompare("Referer") == .orderedSame }) {
        return headers
    }
    var out = headers
    out["Referer"] = referer
    return out
}

/// 跨路由打开神回编辑窗口的信标（进程内一次性）。
@MainActor
final class GodMomentEditTarget {
    static let shared = GodMomentEditTarget()
    var entity: GodMomentEntity?
}

/// 排行榜 → 书籍详情页的跳转信标（进程内一次性）。
@MainActor
final class GodMomentJumpState {
    static let shared = GodMomentJumpState()
    var chapterId: String?
}

/// 排行榜 → 设置页「神回设置」分区的跳转信标（进程内一次性）。
@MainActor
final class GodStyleSettingsJump {
    static let shared = GodStyleSettingsJump()
    var pending: Bool = false
}

// MARK: - 排序比较器：评分高→低，同分按添加时间倒序

extension Array where Element == GodMomentEntity {
    func sortedForRanking(_ sort: GodSort) -> [GodMomentEntity] {
        switch sort {
        case .rating:
            return sorted { a, b in
                if a.rating != b.rating { return a.rating > b.rating }
                return a.createdAt > b.createdAt
            }
        case .recent:
            return sorted { $0.createdAt > $1.createdAt }
        case .book:
            return sorted { a, b in
                if a.bookTitle != b.bookTitle { return a.bookTitle < b.bookTitle }
                if a.chapterNumber != b.chapterNumber { return a.chapterNumber < b.chapterNumber }
                return a.rating > b.rating
            }
        }
    }
}

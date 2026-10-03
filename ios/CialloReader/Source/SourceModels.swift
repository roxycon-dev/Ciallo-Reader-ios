import Foundation

// MARK: - 书源体系模型（source/ 根 15 文件镜像）

// MARK: 异常（SourceException.kt）

enum SourceException: Error, LocalizedError {
    case loginRequired
    case networkError(String)
    case parseError(String)
    case bookNotFound
    case unknown(String)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .loginRequired: return "需要登录后继续操作"
        case .networkError(let m): return m
        case .parseError(let m): return m
        case .bookNotFound: return "未能找到对应图书"
        case .unknown(let m): return m
        case .cancelled: return "已取消"
        }
    }
}

// MARK: 结果（SourceResult.kt）

enum SourceResult<T> {
    case success(T)
    case error(SourceException)

    func map<R>(_ transform: (T) -> R) -> SourceResult<R> {
        switch self {
        case .success(let d): return .success(transform(d))
        case .error(let e): return .error(e)
        }
    }

    func getOrNull() -> T? {
        if case .success(let d) = self { return d }
        return nil
    }

    func getOrThrow() throws -> T {
        switch self {
        case .success(let d): return d
        case .error(let e): throw e
        }
    }
}

// MARK: 能力（SourceCapabilities.kt）

struct SourceCapabilities {
    var supportSearch: Bool = true
    var supportDownload: Bool = true
    var searchRequiresLogin: Bool = false
    var downloadRequiresLogin: Bool = false
    var supportDebug: Bool = false
    var supportImport: Bool = false
    var supportComic: Bool = false
    /// 支持章节式在线文字阅读（Legado 网文源）
    var supportOnlineText: Bool = false
    var environmentOnly: Bool = false
    /// 提供小说电子书文件，可整本下载后进入本地文字阅读器。
    var supportEbook: Bool = false

    var requiresLogin: Bool { downloadRequiresLogin }
}

extension SourceCapabilities {
    var isNovelSource: Bool { !supportComic && (supportEbook || supportOnlineText) }
    var isComicSource: Bool { supportComic && !isNovelSource }
}

// MARK: 认证

enum AuthenticationState: Equatable {
    case notRequired
    case required
    case authenticated
    case expired
}

struct LoginCredential {
    var username: String = ""
    var password: String = ""
    var cookie: String? = nil
    var extraData: [String: String] = [:]
}

// MARK: 模型

struct SearchBook: Identifiable, Hashable {
    var id: String
    var sourceId: String
    var title: String
    var author: String
    var cover: String? = nil
    var description: String? = nil
    var format: String = "epub"
    var language: String? = nil
    var comicId: String? = nil
    var size: Int64? = nil
    var downloadUrl: String? = nil
    var eapiId: String? = nil
    var eapiHash: String? = nil
}

struct BookFormat: Identifiable, Hashable {
    var format: String
    var downloadUrl: String? = nil
    var size: Int64? = nil
    var sizeText: String? = nil
    var eapiId: String? = nil
    var eapiHash: String? = nil

    var id: String { format + (downloadUrl ?? "") }
}

struct ComicChapter: Identifiable, Hashable {
    var id: String
    var title: String
    var volume: String? = nil
    var order: Float = 0
    var external: Bool = false
    var externalUrl: String? = nil
}

struct DownloadInfo {
    var url: String
    var fileName: String
    var format: String = "epub"
    var size: Int64? = nil
    var headers: [String: String] = [:]
    var referer: String? = nil
}

/// 小说详情（source/NovelInfo.kt）
struct NovelInfo: Hashable {
    var intro: String? = nil
    var kind: [String]? = nil
    var lastChapter: String? = nil
    var tocUrl: String? = nil
}

/// 漫画详情（source/ComicInfo.kt）
struct ComicInfo: Hashable {
    var intro: String? = nil
    var tags: [String]? = nil
    var author: String? = nil
    var chapterCount: Int? = nil
}

// MARK: 注册地址（SourceRegistration.kt：仅 HTTP(S)、无 URL 内嵌账号密码）

enum SourceRegistration {
    static func validate(_ url: String?) -> String? {
        guard let url, !url.isEmpty else { return nil }
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") else { return nil }
        // URL 内嵌账号密码拒绝（user:pass@）
        guard let comps = URLComponents(string: trimmed), comps.host != nil else { return nil }
        if comps.percentEncodedUser?.isEmpty == false { return nil }
        return trimmed
    }
}

// MARK: 书源接口（BookSource.kt / ComicSource.kt）

protocol BookSource: AnyObject {
    var id: String { get }
    var name: String { get }
    var capabilities: SourceCapabilities { get }
    var registrationUrl: String? { get }

    func search(keyword: String) async -> SourceResult<[SearchBook]>
    func getDetail(bookId: String) async -> SourceResult<SearchBook>
    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo>
    func login(credential: LoginCredential) async -> SourceResult<Bool>
    func logout() async
    func isLoggedIn() async -> Bool

    func getAvailableFormats(book: SearchBook) async -> SourceResult<[BookFormat]>
    func getAuthenticationState() async -> AuthenticationState
}

extension BookSource {
    var requiresLogin: Bool { capabilities.requiresLogin }

    func getAvailableFormats(book: SearchBook) async -> SourceResult<[BookFormat]> { .success([]) }
    func getAuthenticationState() async -> AuthenticationState {
        capabilities.downloadRequiresLogin
            ? (await isLoggedIn() ? .authenticated : .required)
            : .notRequired
    }
}

protocol ComicSourceProtocol: BookSource {
    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]>
    func getChapterImages(chapterId: String) async -> SourceResult<[String]>
    /// 章节式文字源：返回章节正文纯文本（段落以 \n\n 分隔）。图片源默认不支持。
    func getChapterText(chapterId: String) async -> SourceResult<String>
    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]]
    func resolveChapterImage(url: String) async -> String?
    func getResolvedHeaders(url: String) async -> [String: String]
    func getCoverHeaders(url: String) async -> [String: String]
}

extension ComicSourceProtocol {
    func getChapterText(chapterId: String) async -> SourceResult<String> {
        .error(.parseError("该书源不支持文字章节"))
    }
    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]] { [:] }
    func resolveChapterImage(url: String) async -> String? { nil }
    func getResolvedHeaders(url: String) async -> [String: String] { [:] }
    func getCoverHeaders(url: String) async -> [String: String] { [:] }
}

// MARK: 书源调试日志（SourceLog.kt：环形缓冲）

enum SourceLog {
    private static var buffer: [String] = []
    private static let capacity = 200
    private static let lock = NSLock()

    static func log(_ source: String, _ message: String) {
        lock.lock()
        buffer.append("[\(source)] \(message)")
        if buffer.count > capacity { buffer.removeFirst(buffer.count - capacity) }
        lock.unlock()
    }

    static func dump() -> String {
        lock.lock()
        defer { lock.unlock() }
        return buffer.joined(separator: "\n")
    }
}

import Foundation

// MARK: - JS 漫画源包装（source/js/JsComicSource.kt 对应物）
// 把 Venera JS 源包装成 ComicSourceProtocol：search / loadComic / loadEp 双代 API 兼容、
// 号码牌直达（numericIdFallback）、onImageLoad/onThumbnailLoad 头部解析。

final class JsComicSource: BookSource, ComicSourceProtocol {
    private let engine: JsSourceEngine
    let key: String
    let loginRequiredFlag: Bool

    var id: String { "js_\(key)" }
    var name: String { name_override }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities {
        SourceCapabilities(supportComic: true, downloadRequiresLogin: loginRequiredFlag)
    }

    init(engine: JsSourceEngine, key: String, name: String, loginRequired: Bool) {
        self.engine = engine
        self.key = key
        self.name_override = name
        self.loginRequiredFlag = loginRequired
    }

    private let name_override: String

    // MARK: 搜索

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        // Venera search.load(keyword, options, page) → {comics: [...], maxPage}
        do {
            let result = try await engine.call(path: ["search", "load"], args: [keyword, [] as [Any], 1])
            return .success(parseComics(result))
        } catch JsSourceEngine.JsCallError.methodMissing {
            return .error(.parseError("该源不支持搜索"))
        } catch {
            return .error(mapError(error))
        }
    }

    private func parseComics(_ result: Any?) -> [SearchBook] {
        guard let obj = result as? [String: Any] else { return [] }
        let comics = obj["comics"] as? [[String: Any]] ?? []
        return comics.compactMap { comic in
            guard let cid = comic["id"] as? String, let title = comic["title"] as? String else { return nil }
            let tags = (comic["tags"] as? [String]) ?? []
            return SearchBook(
                id: cid, sourceId: id, title: title,
                author: (comic["author"] as? String) ?? "",
                cover: comic["cover"] as? String,
                description: comic["description"] as? String,
                comicId: cid,
                novelInfo: nil,
                comicInfo: ComicInfo(tags: tags.isEmpty ? nil : tags))
        }
    }

    // MARK: 详情 / 章节

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        do {
            let info = try await loadComicInfo(bookId)
            let chapters = info.chapters
            let firstCover = info.cover
            return .success(SearchBook(
                id: bookId, sourceId: id, title: info.title,
                author: info.author ?? "未知作者",
                cover: firstCover,
                description: info.description,
                comicId: bookId,
                comicInfo: ComicInfo(intro: info.description, tags: info.tags, chapterCount: chapters?.count)))
        } catch {
            return .error(mapError(error))
        }
    }

    struct ComicInfoResult {
        var title: String
        var author: String?
        var cover: String?
        var description: String?
        var tags: [String]?
        var chapters: [ComicChapter]?
    }

    private func loadComicInfo(_ comicId: String) async throws -> ComicInfoResult {
        // 新 API：comic.loadInfo(comicId)；旧 API：loadComic(comicId)
        var result: Any?
        if await hasMethod(["comic", "loadInfo"]) {
            result = try await engine.call(path: ["comic", "loadInfo"], args: [comicId])
        } else if await hasMethod(["loadComic"]) {
            result = try await engine.call(path: ["loadComic"], args: [comicId])
        } else {
            throw SourceException.parseError("该源不支持详情")
        }
        guard let obj = result as? [String: Any] else {
            throw SourceException.parseError("详情数据格式异常")
        }
        var chapters: [ComicChapter]?
        if let rawChapters = obj["chapters"] as? [[String: Any]] {
            chapters = rawChapters.enumerated().compactMap { index, ch in
                guard let cid = ch["id"] as? String ?? (ch["id"] as? Int).map(String.init) else { return nil }
                let title = ch["title"] as? String ?? "第 \(index + 1) 话"
                let volume = ch["volume"] as? String
                return ComicChapter(id: cid, title: title, volume: volume, order: Float(index))
            }
        }
        return ComicInfoResult(
            title: obj["title"] as? String ?? comicId,
            author: obj["author"] as? String,
            cover: obj["cover"] as? String,
            description: obj["description"] as? String ?? obj["subTitle"] as? String,
            tags: obj["tags"] as? [String],
            chapters: chapters)
    }

    private func hasMethod(_ path: [String]) async -> Bool {
        await withCheckedContinuation { cont in
            engine.checkMethodExists(path: path) { exists in
                cont.resume(returning: exists)
            }
        }
    }

    // MARK: 章节 / 图片

    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]> {
        do {
            let info = try await loadComicInfo(bookId)
            guard let chapters = info.chapters, !chapters.isEmpty else {
                // 无章节列表的单话漫画：整本视为一话（与安卓一致）
                return .success([ComicChapter(id: "single", title: "全一话", order: 0)])
            }
            return .success(chapters)
        } catch {
            return .error(mapError(error))
        }
    }

    func getChapterImages(chapterId: String) async -> SourceResult<[String]> {
        await getChapterImagesWithHeaders(chapterId: chapterId).map { $0.urls }
    }

    /// 返回图片 URL 与逐图请求头
    func getChapterImagesWithHeaders(chapterId: String) async -> SourceResult<(urls: [String], headers: [String: [String: String]])> {
        // comicId 需要从外部传入；JS 源 loadEp 需要 comicId + epId。
        // 阅读器调用 getChapterImagesWithHeaders(comicId:chapterId:)，此简化路径仅供接口兼容。
        return .error(.parseError("请使用 getChapterImagesWithHeaders(comicId:chapterId:)"))
    }

    func getChapterImagesWithHeaders(comicId: String, chapterId: String) async -> SourceResult<(urls: [String], headers: [String: [String: String]])> {
        do {
            let epId = chapterId == "single" ? comicId : chapterId
            var result: Any?
            if await hasMethod(["comic", "loadEp"]) {
                result = try await engine.call(path: ["comic", "loadEp"], args: [comicId, epId])
            } else if await hasMethod(["loadComicPages"]) {
                result = try await engine.call(path: ["loadComicPages"], args: [comicId, epId])
            } else {
                throw SourceException.parseError("该源不支持章节阅读")
            }
            guard let obj = result as? [String: Any] else {
                throw SourceException.parseError("图片数据格式异常")
            }
            let rawImages = obj["images"] as? [Any] ?? []
            var urls: [String] = []
            var headers: [String: [String: String]] = [:]
            for img in rawImages {
                if let s = img as? String {
                    urls.append(s)
                } else if let dict = img as? [String: Any], let u = dict["url"] as? String {
                    urls.append(u)
                    if let h = dict["headers"] as? [String: String] { headers[u] = h }
                }
            }
            guard !urls.isEmpty else { throw SourceException.parseError("未返回图片") }
            // onImageLoad：懒加载解析真实图片 URL
            if await hasMethod(["onImageLoad"]) {
                var resolved: [String] = []
                var resolvedHeaders: [String: [String: String]] = [:]
                for url in urls {
                    if let cfg = try? await engine.call(path: ["onImageLoad"], args: [url, comicId, epId]),
                       let dict = cfg as? [String: Any], let real = dict["url"] as? String {
                        resolved.append(real)
                        if let h = dict["headers"] as? [String: String] { resolvedHeaders[real] = h }
                    } else {
                        resolved.append(url)
                        if let h = headers[url] { resolvedHeaders[url] = h }
                    }
                }
                return .success((resolved, resolvedHeaders))
            }
            return .success((urls, headers))
        } catch {
            return .error(mapError(error))
        }
    }

    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]] {
        [:]
    }

    /// 封面防盗链头（onThumbnailLoad）
    func getCoverHeaders(url: String) async -> [String: String] {
        guard await hasMethod(["onThumbnailLoad"]) else { return [:] }
        if let cfg = try? await engine.call(path: ["onThumbnailLoad"], args: [url]),
           let dict = cfg as? [String: Any], let real = dict["url"] as? String,
           let h = dict["headers"] as? [String: String] {
            _ = real
            return h
        }
        return [:]
    }

    /// 号码牌直达：纯数字 ID 搜索无结果时按 ID 直接加载详情
    func numericIdFallback(keyword: String) async -> SearchBook? {
        guard keyword.range(of: "^[0-9]+$") != nil else { return nil }
        guard let info = try? await loadComicInfo(keyword) else { return nil }
        return SearchBook(id: keyword, sourceId: id, title: info.title,
                          author: info.author ?? "未知作者", cover: info.cover,
                          description: info.description, comicId: keyword)
    }

    // MARK: 账号（Venera account.login/logout）

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        .error(.parseError("JS 漫画源为在线阅读，请使用在线阅读"))
    }

    func login(credential: LoginCredential) async -> SourceResult<Bool> {
        do {
            let exists = await hasMethod(["account", "login"])
            guard exists else { return .success(true) }
            let result = try await engine.call(path: ["account", "login"], args: [credential.username, credential.password])
            return .success(true)
        } catch {
            return .error(mapError(error))
        }
    }

    func logout() async {
        _ = try? await engine.call(path: ["account", "logout"], args: [])
    }

    func isLoggedIn() async -> Bool {
        (try? await engine.call(path: ["account", "isLogged"], args: [])) as? Bool ?? false
    }

    // MARK: 工具

    private func mapError(_ error: Error) -> SourceException {
        if let e = error as? SourceException { return e }
        if case JsSourceEngine.JsCallError.methodMissing(let m) = error {
            return .parseError("JS 源缺少方法：\(m)")
        }
        if case JsSourceEngine.JsCallError.script(let m) = error {
            return .parseError("JS 执行错误：\(m)")
        }
        return .networkError(Http.describe(error))
    }
}

extension JsSourceEngine {
    /// 检查实例上是否存在某方法路径（供调用前探测，避免抛错）
    func checkMethodExists(path: [String], completion: @escaping (Bool) -> Void) {
        queue.async {
            guard let instance = self.instance else {
                completion(false)
                return
            }
            var target: JSValue? = instance
            for key in path {
                target = target?.objectForKeyedSubscript(key)
            }
            completion(target?.isUndefined == false && target?.isNull == false)
        }
    }
}

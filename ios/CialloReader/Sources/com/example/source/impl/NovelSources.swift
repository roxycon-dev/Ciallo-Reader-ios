import Foundation
import SwiftSoup

// MARK: - 三个内置小说源（source/impl/AutoNovelSource.kt / IxdzsSource.kt / Wenku8LibrarySource.kt 镜像）

// MARK: 轻小说机翻机器人（auto_novel）

final class AutoNovelSource: BookSource, ComicSourceProtocol {
    private let baseUrl = "https://n.novelia.cc/"
    private let providers = ["syosetu", "kakuyomu", "novelup", "hameln", "alphapolis"]
    private var metadataCache: [String: (at: Date, data: [String: Any])] = [:]
    private var textCache: [String: String] = [:]
    private let lock = NSLock()

    var id: String { "auto_novel" }
    var name: String { "轻小说机翻机器人" }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities {
        SourceCapabilities(supportSearch: true, supportDownload: true, supportOnlineText: true)
    }

    private func path(_ bookId: String) throws -> String {
        let parts = bookId.split(separator: "/").map(String.init)
        guard parts.count == 2, providers.contains(parts[0]),
              parts[1].range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil else {
            throw SourceException.parseError("无效的小说标识")
        }
        return baseUrl + "api/novel/\(parts[0])/\(parts[1])"
    }

    private func json(_ url: String) async throws -> [String: Any] {
        let resp = try await Http.get(url, headers: [
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Referer": baseUrl,
        ])
        if resp.status == 401 { throw SourceException.loginRequired }
        guard (200..<300).contains(resp.status) else {
            throw SourceException.networkError("轻小说源返回 HTTP \(resp.status)")
        }
        guard let obj = JsonPathResolver.parseJson(resp.text) as? [String: Any] else {
            throw SourceException.parseError("轻小说源返回空响应")
        }
        return obj
    }

    private func detail(_ bookId: String, fresh: Bool = false) async throws -> [String: Any] {
        lock.lock()
        let cached = metadataCache[bookId]
        lock.unlock()
        if let cached, !fresh, Date().timeIntervalSince(cached.at) < 60 {
            return cached.data
        }
        let data = try await json(try path(bookId))
        lock.lock()
        metadataCache[bookId] = (Date(), data)
        lock.unlock()
        return data
    }

    private func title(_ data: [String: Any]) -> String {
        let zh = data["titleZh"] as? String ?? ""
        let jp = data["titleJp"] as? String ?? ""
        return zh.isEmpty ? jp : zh
    }

    private func makeBook(_ bookId: String, _ data: [String: Any]) -> SearchBook {
        let authors = (data["authors"] as? [[String: Any]])?.compactMap { $0["name"] as? String }.filter { !$0.isEmpty } ?? []
        let toc = data["toc"] as? [[String: Any]] ?? []
        let chapters = toc.filter { !(($0["chapterId"] as? String) ?? "").isEmpty }
        let tags = (data["keywords"] as? [String])?.filter { !$0.isEmpty } ?? []
        let intro = (data["introductionZh"] as? String) ?? ""
        return SearchBook(
            id: bookId, sourceId: id, title: title(data),
            author: authors.isEmpty ? "未知作者" : authors.joined(separator: "、"),
            description: "日本轻小说 Web 版，正文为中文机器翻译；缺译章节会提示等待译文。\n\n" + intro,
            novelInfo: NovelInfo(intro: intro, kind: tags,
                                 lastChapter: chapters.last.flatMap { title($0) },
                                 tocUrl: nil))
    }

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        do {
            let query = keyword.trimmingCharacters(in: .whitespaces)
            guard !query.isEmpty else { return .success([]) }
            let normalized = query.lowercased().replacingOccurrences(of: "[ :：-]", with: "", options: .regularExpression)
            if normalized == "re0" || normalized == "rezero" {
                let d = try await detail("syosetu/n2267be")
                return .success([makeBook("syosetu/n2267be", d)])
            }
            var comps = URLComponents(string: baseUrl + "api/novel")!
            comps.queryItems = [
                URLQueryItem(name: "page", value: "0"),
                URLQueryItem(name: "pageSize", value: "20"),
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "provider", value: providers.joined(separator: ",")),
                URLQueryItem(name: "type", value: "0"),
                URLQueryItem(name: "level", value: "1"),
                URLQueryItem(name: "translate", value: "2"),
                URLQueryItem(name: "sort", value: "0"),
            ]
            let data = try await json(comps.url!.absoluteString)
            let items = data["items"] as? [[String: Any]] ?? []
            let books = items.compactMap { item -> SearchBook? in
                let provider = item["providerId"] as? String ?? ""
                let novel = item["novelId"] as? String ?? ""
                guard providers.contains(provider), !novel.isEmpty, !title(item).isEmpty else { return nil }
                return makeBook("\(provider)/\(novel)", item)
            }
            var seen = Set<String>()
            return .success(books.filter { seen.insert($0.id).inserted })
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "轻小说源"))
        }
    }

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        do { return .success(makeBook(bookId, try await detail(bookId))) }
        catch { return .error(SourceImporter.mapSourceError(error, prefix: "轻小说源")) }
    }

    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]> {
        do {
            let data = try await detail(bookId)
            let toc = data["toc"] as? [[String: Any]] ?? []
            var group = ""
            var chapters: [ComicChapter] = []
            for (i, item) in toc.enumerated() {
                let chapterId = item["chapterId"] as? String ?? ""
                if chapterId.isEmpty {
                    group = item["title"] as? String ?? ""
                    continue
                }
                chapters.append(ComicChapter(id: "\(bookId)/\(chapterId)",
                                             title: item["title"] as? String ?? "",
                                             volume: group, order: Float(i)))
            }
            guard !chapters.isEmpty else { throw SourceException.parseError("小说目录为空") }
            return .success(chapters)
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "轻小说源"))
        }
    }

    func getChapterText(chapterId: String) async -> SourceResult<String> {
        do {
            lock.lock()
            let cached = textCache[chapterId]
            lock.unlock()
            if let cached { return .success(cached) }
            let parts = chapterId.split(separator: "/").map(String.init)
            guard parts.count == 3 else { throw SourceException.parseError("章节标识无效") }
            let data = try await json("\(baseUrl)api/novel/\(parts[0])/\(parts[1])/chapter/\(parts[2])")
            let text = try paragraphText(data)
            lock.lock()
            textCache[chapterId] = text
            lock.unlock()
            return .success(text)
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "轻小说源"))
        }
    }

    /// 译文优先级：sakura → gpt → youdao → baidu；缺译抛错
    func paragraphText(_ data: [String: Any]) throws -> String {
        guard let original = data["paragraphs"] as? [Any] else { throw SourceException.parseError("正文缺失") }
        let translationKeys = ["sakuraParagraphs", "gptParagraphs", "youdaoParagraphs", "baiduParagraphs"]
        let translations = translationKeys.compactMap { key -> [Any]? in
            guard let arr = data[key] as? [Any], arr.count == original.count else { return nil }
            return arr
        }
        var missing = 0
        var paragraphs: [String] = []
        for i in original.indices {
            let source = (original[i] as? String ?? "").trimmingCharacters(in: .whitespaces)
            var text: String? = nil
            for t in translations {
                if let s = (t[i] as? String)?.trimmingCharacters(in: .whitespaces), !s.isEmpty {
                    text = s
                    break
                }
            }
            if text == nil {
                if source.hasPrefix("<图片>") || !source.contains(where: { $0.isLetter }) {
                    text = source
                } else {
                    missing += 1
                    text = ""
                }
            }
            var final = text ?? ""
            if final.hasPrefix("<图片>") { final = "[插图] " + final.dropFirst("<图片>".count) }
            paragraphs.append(final)
        }
        if missing > 0 {
            throw SourceException.parseError("本章中文译文尚未齐全（缺 \(missing) 段），请稍后重试")
        }
        let joined = paragraphs.filter { !$0.isEmpty }.joined(separator: "\n\n")
        guard !joined.isEmpty else { throw SourceException.parseError("本章中文译文为空") }
        return joined
    }

    func getChapterImages(chapterId: String) async -> SourceResult<[String]> {
        .error(.parseError("请使用小说文字阅读器"))
    }

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        do {
            let data = try await detail(bookId)
            let t = title(data).replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression)
            let format = "epub"
            let fileName = "\(t).\(format)"
            var url = "\(try path(bookId))/file?mode=zh&translationsMode=priority&type=\(format)&filename=\(fileName.urlEncode())"
            for t in ["sakura", "gpt", "youdao", "baidu"] {
                url += "&translations=\(t)"
            }
            return .success(DownloadInfo(url: url, fileName: fileName, format: format, referer: baseUrl))
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "轻小说源"))
        }
    }

    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(true) }
    func logout() async {}
    func isLoggedIn() async -> Bool { true }
}

// MARK: 爱下电子书（ixdzs8）

final class IxdzsSource: BookSource {
    private let baseUrl = "https://ixdzs8.com/"
    private var detailCache: [String: (at: Date, book: SearchBook, download: String)] = [:]
    private let lock = NSLock()

    var id: String { "ixdzs8" }
    var name: String { "爱下电子书" }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities { SourceCapabilities(supportEbook: true) }

    private func bookUrl(_ bookId: String) throws -> String {
        guard bookId.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil else {
            throw SourceException.parseError("无效的网文书籍标识")
        }
        return baseUrl + "read/\(bookId)/"
    }

    private func page(_ url: String) async throws -> Document {
        let resp = try await Http.get(url, headers: [
            "Referer": baseUrl,
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        ])
        guard (200..<300).contains(resp.status) else {
            throw SourceException.networkError("爱下电子书返回 HTTP \(resp.status)")
        }
        return try SwiftSoup.parse(resp.text, url)
    }

    private func detail(_ bookId: String, fresh: Bool = false) async throws -> (SearchBook, String) {
        lock.lock()
        let cached = detailCache[bookId]
        lock.unlock()
        if let cached, !fresh, Date().timeIntervalSince(cached.at) < 60 {
            return (cached.book, cached.download)
        }
        let doc = try await page(try bookUrl(bookId))
        let title = (try? doc.select(".novel h1").first()?.text()) ?? "" ?? ""
        guard !title.isEmpty else { throw SourceException.parseError("未找到小说详情，站点可能暂时不可用") }
        let downloadLink = try doc.select(".n-btn a[href]").array().first {
            ((try? $0.text()) ?? "").contains("TXT下载")
        }
        guard let linkEl = downloadLink else { throw SourceException.parseError("本书未提供 TXT 下载") }
        let downloadHref = ((try? linkEl.attr("abs:href")) ?? "").isEmpty ? ((try? linkEl.attr("href")) ?? "") : ((try? linkEl.attr("abs:href")) ?? "")
        guard let downloadUrl = URL(string: downloadHref),
              downloadUrl.scheme == "https",
              downloadUrl.host == "ixdzs8.com" || downloadUrl.host?.range(of: "^down[0-9]+\\.ixdzs8\\.com$", options: .regularExpression) != nil else {
            throw SourceException.parseError("网文下载地址异常")
        }
        let info = try doc.select(".n-text").first()
        let latest = (try? info?.select("p").array().first { ((try? $0.text()) ?? "").hasPrefix("最新:") })?.map { (try? $0.text()) ?? "" } ?? nil
        let updated = (try? info?.select("p").array().first { ((try? $0.text()) ?? "").hasPrefix("更新:") })?.map { (try? $0.text()) ?? "" } ?? nil
        let intro = (try? doc.select("#intro").first()?.text()) ?? "" ?? ""
        let cover = (try? doc.select(".n-img img[src]").first()?.attr("abs:src")) ?? "" ?? ""
        let book = SearchBook(
            id: bookId, sourceId: id, title: title,
            author: (try? info?.select(".bauthor").first()?.text()) ?? "" ?? "",
            cover: cover.isEmpty ? nil : cover,
            description: "中文网文，TXT 下载到书架阅读。原站下载包可能缺章或更新滞后。\n\(latest ?? "")\n\(updated ?? "")\n\n\(intro)",
            format: "txt", language: "中文",
            novelInfo: NovelInfo(intro: intro.isEmpty ? nil : intro, kind: nil,
                                 lastChapter: latest?.replacingOccurrences(of: "最新:", with: "").nilIfEmpty,
                                 tocUrl: nil))
        lock.lock()
        detailCache[bookId] = (Date(), book, downloadUrl.absoluteString)
        lock.unlock()
        return (book, downloadUrl.absoluteString)
    }

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        do {
            guard !keyword.trimmingCharacters(in: .whitespaces).isEmpty else { return .success([]) }
            let doc = try await page(baseUrl + "bsearch?q=\(keyword.trimmingCharacters(in: .whitespaces).urlEncode())")
            var seen = Set<String>()
            var books: [SearchBook] = []
            for info in try doc.select(".l-info").array() {
                guard let link = try? info.select("h3.bname a[href]").first() else { continue }
                let href = ((try? link.attr("abs:href")) ?? "").isEmpty ? ((try? link.attr("href")) ?? "") : ((try? link.attr("abs:href")) ?? "")
                guard let url = URL(string: href), url.host == "ixdzs8.com" else { continue }
                guard let m = url.path.range(of: "^/read/([1-9][0-9]{0,8})/$", options: .regularExpression) else { continue }
                let bookId = String(url.path[m])
                    .replacingOccurrences(of: "/read/", with: "")
                    .replacingOccurrences(of: "/", with: "")
                let title = (try? link.text()) ?? ""
                guard !title.isEmpty, seen.insert(bookId).inserted else { continue }
                let cover = (try? info.select("img[src]").first()?.attr("abs:src")) ?? "" ?? ""
                let intro = (try? info.select(".l-p2").first()?.text()) ?? "" ?? ""
                books.append(SearchBook(
                    id: bookId, sourceId: id, title: title,
                    author: (try? info.select(".bauthor").first()?.text()) ?? "" ?? "",
                    cover: cover.isEmpty ? nil : cover,
                    description: "中文网文，TXT 下载到书架阅读；原站下载包可能缺章或更新滞后。\n\(intro)",
                    format: "txt", language: "中文",
                    novelInfo: NovelInfo(intro: intro.isEmpty ? nil : intro, kind: nil, lastChapter: nil, tocUrl: nil)))
            }
            return .success(books)
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "网文源"))
        }
    }

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        do { return .success(try await detail(bookId).0) }
        catch { return .error(SourceImporter.mapSourceError(error, prefix: "网文源")) }
    }

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        do {
            let (book, download) = try await detail(bookId)
            let filename = book.title.replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression) + ".txt"
            return .success(DownloadInfo(url: download, fileName: filename, format: "txt", referer: baseUrl))
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "网文源"))
        }
    }

    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(true) }
    func logout() async {}
    func isLoggedIn() async -> Bool { true }
}

// MARK: 轻小说中文文库（wenku8_library）

final class Wenku8LibrarySource: BookSource {
    private let baseUrl = "https://wenku8.ywy.moe/"
    private var cache: [String: (at: Date, json: [String: Any])] = [:]
    private let lock = NSLock()

    var id: String { "wenku8_library" }
    var name: String { "轻小说中文文库" }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities { SourceCapabilities(supportEbook: true) }

    private func bookUrl(_ bookId: String) throws -> String {
        guard bookId.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil else {
            throw SourceException.parseError("无效的文库书籍标识")
        }
        return baseUrl + "api/books/\(bookId)"
    }

    private func json(_ url: String) async throws -> [String: Any] {
        let resp = try await Http.get(url, headers: ["Accept": "application/json", "Referer": baseUrl])
        guard (200..<300).contains(resp.status) else {
            throw SourceException.networkError("中文文库返回 HTTP \(resp.status)")
        }
        guard let obj = JsonPathResolver.parseJson(resp.text) as? [String: Any] else {
            throw SourceException.parseError("中文文库返回空响应")
        }
        return obj
    }

    private func makeBook(_ data: [String: Any]) -> SearchBook? {
        let bookId = String((data["id"] as? Int) ?? Int((data["id"] as? Double) ?? 0))
        guard let title = data["title"] as? String, !title.isEmpty else { return nil }
        let intro = data["synopsis"] as? String ?? ""
        let cover = (data["coverUrl"] as? String).flatMap { URL(string: $0, relativeTo: URL(string: baseUrl))?.absoluteString }
        let volumes = data["volumeCount"] as? Int ?? 0
        let updated = data["updatedAt"] as? String ?? ""
        let tags = (data["tags"] as? [String])?.filter { !$0.isEmpty } ?? []
        let statusRaw = data["status"] as? String ?? ""
        let status = statusRaw == "completed" ? "已完结" : (statusRaw == "ongoing" ? "连载中" : nil)
        let plainIntro = MobiParser.extractText(from: intro)
        return SearchBook(
            id: bookId, sourceId: id, title: title,
            author: data["author"] as? String ?? "",
            cover: cover,
            description: "中文轻小说文库版 EPUB，含插图，下载入书架后阅读。译本信息以书内注明为准。\n文库收录 \(volumes) 卷 · 更新 \(updated)；可能晚于原版发行。\n\n\(plainIntro)",
            format: "epub", language: "中文",
            size: (data["epubBytes"] as? Int).map { Int64($0) },
            novelInfo: NovelInfo(intro: plainIntro.isEmpty ? nil : plainIntro, kind: tags.isEmpty ? nil : tags,
                                 lastChapter: nil, tocUrl: nil))
    }

    private func detail(_ bookId: String, fresh: Bool = false) async throws -> [String: Any] {
        lock.lock()
        let cached = cache[bookId]
        lock.unlock()
        if let cached, !fresh, Date().timeIntervalSince(cached.at) < 60 { return cached.json }
        let data = try await json(try bookUrl(bookId))
        lock.lock()
        cache[bookId] = (Date(), data)
        lock.unlock()
        return data
    }

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        do {
            guard !keyword.trimmingCharacters(in: .whitespaces).isEmpty else { return .success([]) }
            let url = "\(baseUrl)api/books?q=\(keyword.urlEncode())&page=1&limit=24"
            let data = try await json(url)
            let items = data["items"] as? [[String: Any]] ?? []
            let books = items.compactMap { makeBook($0) }
            var seen = Set<String>()
            return .success(books.filter { seen.insert($0.id).inserted })
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "中文文库"))
        }
    }

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        do {
            guard let b = makeBook(try await detail(bookId)) else { throw SourceException.parseError("文库书名为空") }
            return .success(b)
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "中文文库"))
        }
    }

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        do {
            guard let b = makeBook(try await detail(bookId)) else { throw SourceException.parseError("文库书名为空") }
            let t = b.title.replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression)
            return .success(DownloadInfo(url: "\(try bookUrl(bookId))/download",
                                         fileName: "\(t).epub", format: "epub", referer: baseUrl))
        } catch {
            return .error(SourceImporter.mapSourceError(error, prefix: "中文文库"))
        }
    }

    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(true) }
    func logout() async {}
    func isLoggedIn() async -> Bool { true }
}

// MARK: - 工具

extension SourceImporter {
    static func mapSourceError(_ error: Error, prefix: String) -> SourceException {
        if let e = error as? SourceException { return e }
        if case HttpError.status(401, _) = error { return .loginRequired }
        if case HttpError.status(let s, let m) = error {
            return .networkError(m ?? "\(prefix)返回 HTTP \(s)")
        }
        if case HttpError.network(let m) = error {
            return .networkError("\(prefix)连接失败，请稍后重试：\(m)")
        }
        if error is CancellationError { return .cancelled }
        return .parseError(error.localizedDescription)
    }
}

extension String {
    func urlEncode() -> String {
        addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? self
    }
}

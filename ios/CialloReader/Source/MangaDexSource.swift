import Foundation
import SwiftSoup

// MARK: - MangaDex 漫画源（source/impl/MangaDexSource.kt 对应物）
// 官方 API + mangadex.live 镜像双路搜索（UUID/slug 互查缓存）、章节 feed、at-home 图片、
// 官方 404 时镜像回退（完整归一化标题匹配）、官方与镜像 Referer 隔离。

final class MangaDexSource: BookSource, ComicSourceProtocol {
    static let officialReferer = "https://mangadex.org/"
    static let mirrorReferer = "https://mangadex.live/"

    var id: String { "mangadex" }
    var name: String { "MangaDex" }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities { SourceCapabilities(supportComic: true) }

    private var mirrorToOfficial: [String: String] = [:]   // mirror id → official uuid
    private var mirrorSlug: [String: String] = [:]          // official uuid → mirror slug
    private let lock = NSLock()

    private func normalizeTitle(_ t: String) -> String {
        t.lowercased()
            .replacingOccurrences(of: "[\\p{Punct}\\s]", with: "", options: .regularExpression)
    }

    // MARK: 搜索（官方 + 镜像并行）

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        let encoded = keyword.urlEncode()
        async let officialTask = searchOfficialApi(encoded)
        async let mirrorTask = searchMirror(encoded)
        let official = (try? await officialTask) ?? []
        let mirror = (try? await mirrorTask) ?? []
        if official.isEmpty && mirror.isEmpty {
            return .error(.networkError("MangaDex 搜索服务暂时不可用"))
        }
        lock.lock()
        var merged: [String: SearchBook] = [:]
        for m in mirror { merged[m.id] = m }
        for api in official {
            // 镜像命中 → 记 UUID 映射并保留官方数据
            let mirrorMatch = mirror.first {
                $0.title.caseInsensitiveCompare(api.title) == .orderedSame ||
                normalizeTitle($0.title) == normalizeTitle(api.title)
            }
            if let mirrorMatch {
                mirrorToOfficial[mirrorMatch.id] = api.id
                merged[api.id] = api
            } else {
                merged[api.id] = api
            }
        }
        lock.unlock()
        return .success(Array(merged.values.prefix(24)))
    }

    private func searchOfficialApi(_ encoded: String) async throws -> [SearchBook] {
        let url = "https://api.mangadex.org/manga?title=\(encoded)&limit=20&includes%5B%5D=cover_art&hasAvailableChapters=true&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive&contentRating%5B%5D=erotica"
        let json = try await Http.getJson(url)
        guard let data = json as? [String: Any], let results = data["data"] as? [[String: Any]] else { return [] }
        return results.compactMap { parseOfficialManga($0) }
    }

    private func parseOfficialManga(_ item: [String: Any]) -> SearchBook? {
        guard let uuid = item["id"] as? String else { return nil }
        let attrs = item["attributes"] as? [String: Any] ?? [:]
        let titleObj = attrs["title"] as? [String: Any] ?? [:]
        var title = (titleObj["en"] ?? titleObj["ja-ro"] ?? titleObj["ja"] ?? titleObj.values.first) as? String ?? ""
        // altTitles 兜底
        if title.isEmpty, let alts = attrs["altTitles"] as? [[String: Any]] {
            for alt in alts {
                if let zh = alt["zh"] as? String { title = zh; break }
                if let zhHk = alt["zh-hk"] as? String { title = zhHk; break }
                if let en = alt["en"] as? String { title = en; break }
            }
        }
        guard !title.isEmpty else { return nil }
        let author = parseJsonLdAuthor(attrs)
        var coverFile: String?
        for rel in item["relationships"] as? [[String: Any]] ?? [] {
            if (rel["type"] as? String) == "cover_art" {
                coverFile = (rel["attributes"] as? [String: Any])?["fileName"] as? String
            }
        }
        let cover = coverFile.map { "https://uploads.mangadex.org/covers/\(uuid)/\($0).512.jpg" }
        let descriptionObj = attrs["description"] as? [String: Any] ?? [:]
        let desc = (descriptionObj["zh"] ?? descriptionObj["en"] ?? descriptionObj.values.first) as? String
        return SearchBook(id: uuid, sourceId: id, title: title, author: author.isEmpty ? "MangaDex" : author,
                          cover: cover, description: desc, comicId: uuid)
    }

    private func parseJsonLdAuthor(_ attrs: [String: Any]) -> String {
        // parseJsonLdAuthor：优先 creator/author 字段补作者
        if let author = attrs["author"] as? String, !author.isEmpty { return author }
        if let arr = attrs["authors"] as? [String], let first = arr.first { return first }
        return ""
    }

    private func searchMirror(_ encoded: String) async throws -> [SearchBook] {
        let url = "https://mangadex.live/search?q=\(encoded)"
        let resp = try await Http.get(url, headers: ["Referer": Self.mirrorReferer])
        guard (200..<300).contains(resp.status) else { return [] }
        let doc = try SwiftSoup.parse(resp.text, Self.mirrorReferer)
        var out: [SearchBook] = []
        for el in try doc.select("a[href^=/title/]").array().prefix(24) {
            let href = try el.attr("href")
            let parts = href.split(separator: "/")
            guard parts.count >= 3, parts[0] == "title" else { continue }
            let mirrorId = String(parts[1])
            let slug = String(parts[2])
            let title = ((try? el.attr("title")) ?? "") ?? ((try? el.text()) ?? "")
            guard !title.isEmpty else { continue }
            lock.lock()
            mirrorSlug[mirrorId] = slug
            lock.unlock()
            out.append(SearchBook(id: mirrorId, sourceId: id, title: title, author: "MangaDex",
                                  comicId: mirrorId))
        }
        return out
    }

    // MARK: 详情

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        let official = await officialDetail(bookId)
        if let official { return .success(official) }
        // 镜像回退
        let slug = await slugFor(mirrorId: bookId)
        guard let slug else { return .error(.bookNotFound) }
        let resp = await searchMirror(slug.urlEncode())
        if let hit = resp.first(where: { $0.id == bookId }) {
            return .success(hit)
        }
        return .error(.bookNotFound)
    }

    private func officialDetail(_ uuid: String) async -> SearchBook? {
        guard uuid.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                         options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        guard let json = try? await Http.getJson("https://api.mangadex.org/manga/\(uuid)?includes%5B%5D=cover_art") else { return nil }
        guard let data = json as? [String: Any], let item = data["data"] as? [String: Any] else { return nil }
        return parseOfficialManga(item)
    }

    private func slugFor(mirrorId: String) async -> String? {
        lock.lock()
        let cached = mirrorSlug[mirrorId]
        lock.unlock()
        if let cached { return cached }
        return mirrorId // 镜像 slug 常与 id 同路径第二段
    }

    // MARK: 章节

    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]> {
        // 先官方 feed，404/空 → 镜像回退
        if let official = try? await officialChapters(bookId), !official.isEmpty {
            return .success(official)
        }
        let chapters = try? await mirrorChapters(bookId)
        if let chapters, !chapters.isEmpty {
            return .success(chapters)
        }
        return .error(.parseError("未获取到章节"))
    }

    private func officialChapters(_ uuid: String) async throws -> [ComicChapter] {
        var comps = URLComponents(string: "https://api.mangadex.org/manga/\(uuid)/feed")!
        comps.queryItems = [
            URLQueryItem(name: "translatedLanguage[]", value: "zh"),
            URLQueryItem(name: "translatedLanguage[]", value: "zh-hk"),
            URLQueryItem(name: "translatedLanguage[]", value: "en"),
            URLQueryItem(name: "order[chapter]", value: "asc"),
            URLQueryItem(name: "order[volume]", value: "asc"),
            URLQueryItem(name: "limit", value: "500"),
            URLQueryItem(name: "contentRating[]", value: "safe"),
            URLQueryItem(name: "contentRating[]", value: "suggestive"),
            URLQueryItem(name: "contentRating[]", value: "erotica"),
            URLQueryItem(name: "contentRating[]", value: "pornographic"),
        ]
        let json = try await Http.getJson(comps.url!.absoluteString)
        guard let data = json as? [String: Any], let results = data["data"] as? [[String: Any]] else { return [] }
        return results.enumerated().compactMap { index, item in
            guard let chapterId = item["id"] as? String else { return nil }
            let attrs = item["attributes"] as? [String: Any] ?? [:]
            let chapterNo = attrs["chapter"] as? String ?? ""
            let volumeNo = attrs["volume"] as? String
            var title = (attrs["title"] as? String) ?? ""
            if title.isEmpty {
                title = volumeNo.map { "第\(chapterNo)话 (卷\($0))" } ?? "第\(chapterNo)话"
            }
            let externalUrl = (attrs["externalUrl"] as? String)
            return ComicChapter(id: chapterId, title: title, volume: volumeNo, order: Float(index),
                                external: externalUrl != nil, externalUrl: externalUrl)
        }
    }

    private func mirrorChapters(_ mirrorId: String) async throws -> [ComicChapter] {
        let url = "https://mangadex.live/title/\(mirrorId)"
        let resp = try await Http.get(url, headers: ["Referer": Self.mirrorReferer])
        guard (200..<300).contains(resp.status) else { return [] }
        let doc = try SwiftSoup(resp.text)
        var chapters: [ComicChapter] = []
        for el in try doc.select("a[href^=/chapter/]").array() {
            let href = try el.attr("href")
            let parts = href.split(separator: "/")
            guard parts.count >= 2, parts[0] == "chapter" else { continue }
            let chapterId = String(parts[1])
            let title = ((try? el.text()) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !chapters.contains(where: { $0.id == chapterId }) else { continue }
            chapters.append(ComicChapter(id: chapterId, title: title,
                                         order: Float(chapters.count)))
        }
        return chapters.reversed()
    }

    // MARK: 图片

    func getChapterImages(chapterId: String) async -> SourceResult<[String]> {
        // 官方 at-home
        if let official = try? await officialChapterImages(chapterId), !official.isEmpty {
            return .success(official)
        }
        // 镜像回退：读章节页图片
        let resp = try? await Http.get("https://mangadex.live/chapter/\(chapterId)", headers: ["Referer": Self.mirrorReferer])
        if let resp, (200..<300).contains(resp.status) {
            if let doc = try? SwiftSoup(resp.text),
               let imgs = try? doc.select("img").array(),
               let urls = JsonBookSource.extractImageUrls(from: imgs) as [String]? {
                let filtered = urls.filter { $0.contains("/data/") || $0.contains("mangadex") }
                if !filtered.isEmpty {
                    return .success(filtered.map { $0.hasPrefix("http") ? $0 : "https://mangadex.live" + $0 })
                }
            }
        }
        return .error(.parseError("未获取到章节图片"))
    }

    private func officialChapterImages(_ chapterId: String) async throws -> [String] {
        let json = try await Http.getJson("https://api.mangadex.org/at-home/server/\(chapterId)")
        guard let data = json as? [String: Any],
              let section = data["chapter"] as? [String: Any],
              let hash = section["hash"] as? String,
              let baseUrlStr = data["baseUrl"] as? String else { return [] }
        let files = section["data"] as? [String] ?? []
        return files.map { "\(baseUrlStr)/data/\(hash)/\($0)" }
    }

    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]] {
        var out: [String: [String: String]] = [:]
        for url in urls {
            // 官方 uploads 与镜像 Referer 隔离（MangaDexImageHeadersTest 语义）
            if url.contains("uploads.mangadex.org") || url.contains("api.mangadex.org") {
                out[url] = ["Referer": Self.officialReferer]
            } else if url.contains("mangadex.live") {
                out[url] = ["Referer": Self.mirrorReferer]
            } else {
                out[url] = ["Referer": Self.officialReferer]
            }
        }
        return out
    }

    func getCoverHeaders(url: String) async -> [String: String] {
        ["Referer": Self.officialReferer]
    }

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        .error(.parseError("MangaDex 为在线阅读源，请使用在线阅读"))
    }

    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(true) }
    func logout() async {}
    func isLoggedIn() async -> Bool { true }

    /// 语言标签（languageLabel）
    func languageLabel(_ lang: String?) -> String {
        switch lang {
        case "zh": return "中文"
        case "zh-hk": return "繁體"
        case "en": return "English"
        case "ja": return "日本語"
        default: return lang ?? ""
        }
    }
}

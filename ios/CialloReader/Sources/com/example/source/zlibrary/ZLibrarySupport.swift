import Foundation
import SwiftSoup

// MARK: - Z-Library 支撑层（zlibrary/ 网络与解析文件的 iOS 对应物）
// 端点容灾（PRESET_DOMAINS 逐域一致）+ 凭证存储 + 多布局搜索解析（bookcard/桌面/通用兜底）。

// MARK: 凭证存储（ZLibraryCredentialStorage）

final class ZLCredentialStorage {
    private let prefs = Preferences.shared

    var userId: String? { prefs.string(for: "zlib_user_id") }
    var userKey: String? { prefs.string(for: "zlib_user_key") }
    var email: String? { prefs.string(for: "zlib_email") }
    var domain: String { prefs.string(for: "zlib_domain") ?? ZLEndpointProvider.defaultDomain }

    func saveCredentials(userId: String?, userKey: String?, email: String?, domain: String) {
        if let userId { prefs.setString(userId, for: "zlib_user_id") }
        if let userKey { prefs.setString(userKey, for: "zlib_user_key") }
        if let email { prefs.setString(email, for: "zlib_email") }
        prefs.setString(domain, for: "zlib_domain")
    }

    func isLoggedIn() -> Bool { userId != nil && userKey != nil }

    func clear() {
        prefs.remove("zlib_user_id")
        prefs.remove("zlib_user_key")
    }
}

// MARK: 端点提供者（ZLibraryEndpointProvider：PRESET_DOMAINS + 健康探测 + 容灾）

final class ZLEndpointProvider {
    static let defaultDomain = "1lib.sk"

    /// 与安卓 ZLibraryEndpointProvider.PRESET_DOMAINS 逐域一致（六活节点 + 兜底池）
    static let presetDomains = [
        "1lib.sk",
        "z-lib.by",
        "z-library.sk",
        "zh.z-lib.by",
        "zh.z-library.sk",
        "en.z-lib.by",
        "z-lib.sk",
        "z-library.co",
        "z-library.net",
        "zlib-official.com",
        "zlibrary-global.com",
        "z-lib.my",
        "z-lib.ad",
    ]

    static let shared = ZLEndpointProvider()
    private let prefs = Preferences.shared
    private var cachedDomain: String?
    private var cachedAt: Date?
    private let lock = NSLock()

    var customEndpoint: String? {
        get { prefs.string(for: "zlib_custom_endpoint") }
        set {
            if let newValue { prefs.setString(newValue, for: "zlib_custom_endpoint") } else { prefs.remove("zlib_custom_endpoint") }
            lock.lock()
            cachedDomain = nil
            lock.unlock()
        }
    }

    func resolveDomain(forceScan: Bool = false) async -> String {
        lock.lock()
        let cache = (cachedDomain, cachedAt)
        lock.unlock()
        if let cached = cache.0, let at = cache.1, !forceScan,
           Date().timeIntervalSince(at) < 300 {
            return cached
        }
        if let custom = customEndpoint, !custom.isEmpty {
            return normalize(custom)
        }
        let preferred = prefs.string(for: "zlib_selected_node") ?? Self.defaultDomain
        // 首选健康检查（首页 + 结构标记）
        if await isNodeHealthy(preferred) {
            lock.lock()
            cachedDomain = preferred
            cachedAt = Date()
            lock.unlock()
            return preferred
        }
        // 容灾：并发扫描其他节点，第一个健康者胜出
        return await withTaskGroup(of: String?.self) { group in
            for domain in Self.presetDomains where domain != preferred {
                group.addTask {
                    if await self.isNodeHealthy(domain) { return domain }
                    return nil
                }
            }
            for await winner in group {
                if let winner {
                    group.cancelAll()
                    lock.lock()
                    self.cachedDomain = winner
                    self.cachedAt = Date()
                    lock.unlock()
                    return winner
                }
            }
            return preferred
        }
    }

    /// 健康检查：首页 200 + zlibrary.js/z-cover/z-bookcard/book-item 结构标记（防停放域名）
    func isNodeHealthy(_ domain: String) async -> Bool {
        guard let resp = try? await ZLHttp.get("https://\(domain)/", timeout: 8) else { return false }
        guard resp.status == 200 else { return false }
        let html = String(decoding: resp.data.prefix(256 * 1024), as: UTF8.self)
        return html.contains("zlibrary") || html.contains("z-cover") || html.contains("z-bookcard")
            || html.contains("book-item") || html.contains("z-library")
    }

    func diagnoseAllEndpoints() async -> [(domain: String, healthy: Bool)] {
        var out: [(String, Bool)] = []
        await withTaskGroup(of: (String, Bool).self) { group in
            for domain in Self.presetDomains {
                group.addTask { (domain, await self.isNodeHealthy(domain)) }
            }
            for await r in group { out.append(r) }
        }
        return out
    }

    private func normalize(_ domain: String) -> String {
        var d = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in ["https://", "http://"] where d.hasPrefix(prefix) { d = String(d.dropFirst(prefix.count)) }
        while d.hasSuffix("/") { d.removeLast() }
        if let slash = d.firstIndex(of: "/") { d = String(d[..<slash]) }
        return d
    }
}

// MARK: 搜索页解析（zlibrary/parser/ 多布局策略）

enum ZLParser {
    /// 主布局：z-bookcard（新站卡片）
    static func parseSearchPage(_ html: String, baseUrl: String) -> [SearchBook] {
        guard let doc = try? SwiftSoup.parse(html, baseUrl) else { return [] }
        var books: [SearchBook] = []
        // bookcard 布局
        if let cards = try? doc.select(".z-bookcard").array(), !cards.isEmpty {
            for card in cards {
                guard let link = try? card.select("a[item-details-link], a.js-api-navigation, a").array().first,
                      let href = try? link.attr("href") else { continue }
                let title = ((try? card.select(".book-details .book-title a, .book-title").first()?.text()) ?? "") ?? ""
                let author = ((try? card.select(".book-details .authors a, .authors").first()?.text()) ?? "") ?? ""
                let cover = ((try? card.select("img").first()?.attr("data-src")) ?? "")
                    ?? ((try? card.select("img").first()?.attr("src")) ?? "") ?? ""
                let year = ((try? card.select(".book-details .propertyYear .property_value, .property_year").first()?.text()) ?? "") ?? ""
                let ext = ((try? card.select(".book-details .propertyFormat .property_value, .property__file .property_value").first()?.text()) ?? "") ?? ""
                let lang = ((try? card.select(".book-details .propertyLanguage .property_value, .property_language").first()?.text()) ?? "") ?? ""
                guard !title.isEmpty else { continue }
                let id = bookId(from: href)
                books.append(SearchBook(
                    id: id, sourceId: "zlibrary", title: title,
                    author: author.isEmpty ? "未知作者" : author,
                    cover: absoluteUrl(cover, base: baseUrl),
                    format: ext.isEmpty ? "epub" : ext.lowercased(),
                    language: lang.isEmpty ? nil : lang))
            }
            return books
        }
        // 通用兜底：bestContainer 语义（任意 a[href*=/book/] 容器）
        if let links = try? doc.select("a[href*=book]").array() {
            for link in links.prefix(60) {
                guard let href = try? link.attr("href") else { continue }
                guard href.contains("/book/") else { continue }
                let container = try? link.parent()?.parent()
                let fromCard = ((try? container?.select("h3, .title, .book-title").first()?.text()) ?? "")
                let title = fromCard.isEmpty ? ((try? link.text()) ?? "") : fromCard
                guard !title.isEmpty else { continue }
                let cover = ((try? container?.select("img").first()?.attr("data-src")) ?? "")
                    ?? ((try? container?.select("img").first()?.attr("src")) ?? "") ?? ""
                books.append(SearchBook(id: bookId(from: href), sourceId: "zlibrary",
                                        title: title, author: "未知作者",
                                        cover: absoluteUrl(cover, base: baseUrl)))
            }
        }
        return books
    }

    /// 详情页解析
    static func parseDetailPage(_ html: String, baseUrl: String) -> SearchBook? {
        guard let doc = try? SwiftSoup.parse(html, baseUrl) else { return nil }
        let title = ((try? doc.select("h1[itemprop=name], .book-title").first()?.text()) ?? "") ?? ""
        guard !title.isEmpty else { return nil }
        let author = ((try? doc.select("a[itemprop=author], .authors a").first()?.text()) ?? "") ?? ""
        let cover = ((try? doc.select(".z-book-profile img, .book-cover img, img.cover").first()?.attr("src")) ?? "") ?? ""
        let desc = ((try? doc.select("#bookDescriptionBox, [itemprop=description], .book-description").first()?.text()) ?? "") ?? ""
        let ext = ((try? doc.select(".property__file .property_value").first()?.text()) ?? "") ?? ""
        let id = bookId(from: baseUrl)
        return SearchBook(id: id, sourceId: "zlibrary",
                          title: title, author: author.isEmpty ? "未知作者" : author,
                          cover: absoluteUrl(cover, base: baseUrl),
                          description: desc.isEmpty ? nil : desc,
                          format: ext.isEmpty ? "epub" : ext.lowercased())
    }

    /// /book/{id}/{hash} 路径 → id
    static func bookId(from url: String) -> String {
        let comps = url.split(separator: "/").map(String.init)
        if let bi = comps.firstIndex(of: "book"), bi + 2 < comps.count {
            return "\(comps[bi + 1])/\(comps[bi + 2])"
        }
        return url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
    }

    static func absoluteUrl(_ path: String?, base: String) -> String? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return path }
        if path.hasPrefix("//") { return "https:" + path }
        return URL(string: path, relativeTo: URL(string: base))?.absoluteString
    }
}

// MARK: eapi 客户端（ZLibraryEapiClient 逐条移植：md5(email:pass:md5(pass)) 登录等）

struct ZLDownloadLinkResult {
    var url: String?
    var limitMessage: String?
}

final class ZLEapiClient {
    let storage = ZLCredentialStorage()
    let cookieJar: EncryptedCookieJar
    let solver: DiamWallSolver

    init(cookieJar: EncryptedCookieJar, solver: DiamWallSolver) {
        self.cookieJar = cookieJar
        self.solver = solver
    }

    private func md5(_ s: String) -> String { Hex.md5(s) }

    private func requestHeaders(domain: String, referer: String?) -> [String: String] {
        var h = ["Referer": referer ?? "https://\(domain)/"]
        let cookie = cookieJar.cookieHeader(for: domain)
        if !cookie.isEmpty { h["Cookie"] = cookie }
        return h
    }

    func login(email: String, password: String, domain: String) async -> Bool {
        let md5Pass = md5(password)
        let transformed = md5("\(email):\(password):\(md5Pass)")
        let form = "email=\(email.urlEncode())&password=\(transformed)&site_mode=books&action=login"
        do {
            let resp = try await solver.execute(Http.Request(
                url: "https://\(domain)/eapi/user/login", method: "POST",
                headers: ["Content-Type": "application/x-www-form-urlencoded", "Referer": "https://\(domain)/"],
                body: Data(form.utf8)
            ), host: domain)
            guard (200..<300).contains(resp.status),
                  let json = JsonPathResolver.parseJson(resp.text) as? [String: Any],
                  (json["success"] as? Int) == 1 else { return false }
            let user = json["user"] as? [String: Any] ?? [:]
            let uid = user["id"] as? String ?? (user["id"] as? Int).map(String.init)
            let ukey = user["remix_userkey"] as? String
            storage.saveCredentials(userId: uid, userKey: ukey, email: email, domain: domain)
            if let uid { cookieJar.store(domain: domain, name: "remix_userid", value: uid) }
            if let ukey { cookieJar.store(domain: domain, name: "remix_userkey", value: ukey) }
            return true
        } catch {
            return false
        }
    }

    func dailyDownloadLimit(domain: String) async -> (Int, Int)? {
        guard let json = try? await getJson("https://\(domain)/eapi/user/profile", domain: domain),
              (json["success"] as? Int) == 1,
              let user = json["user"] as? [String: Any] else { return nil }
        let today = (user["downloads_today"] as? Int) ?? -1
        let limit = (user["downloads_limit"] as? Int) ?? -1
        return today >= 0 && limit > 0 ? (today, limit) : nil
    }

    func search(keyword: String, domain: String) async -> [SearchBook] {
        guard storage.isLoggedIn() else { return [] }
        guard let json = try? await postForm("https://\(domain)/eapi/book/search",
                                             fields: ["message": keyword, "limit": "30"], domain: domain),
              (json["success"] as? Int) == 1,
              let books = json["books"] as? [[String: Any]] else { return [] }
        return books.compactMap { b in
            let bookUrl = b["url"] as? String ?? ""
            let eapiId = b["id"] as? String ?? (b["id"] as? Int).map(String.init) ?? ""
            let eapiHash = b["hash"] as? String ?? ""
            guard !bookUrl.isEmpty, !eapiId.isEmpty, !eapiHash.isEmpty else { return nil }
            let cover = (b["cover"] as? String).nilIfEmpty
            let dl = (b["dl"] as? String).nilIfEmpty
            return SearchBook(
                id: bookUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                sourceId: "zlibrary",
                title: b["title"] as? String ?? "未知书名",
                author: b["author"] as? String ?? "未知作者",
                cover: cover,
                format: (b["extension"] as? String ?? "epub").lowercased(),
                language: (b["language"] as? String).nilIfEmpty,
                size: (b["filesize"] as? Int).map { Int64($0) }.flatMap { $0 > 0 ? $0 : nil },
                downloadUrl: dl.map { $0.hasPrefix("http") ? $0 : "https://\(domain)\($0)" },
                eapiId: eapiId, eapiHash: eapiHash)
        }
    }

    func getBookInfo(eapiId: String, eapiHash: String, domain: String) async -> SearchBook? {
        guard let json = try? await getJson("https://\(domain)/eapi/book/\(eapiId)/\(eapiHash)", domain: domain),
              (json["success"] as? Int) == 1,
              let b = json["book"] as? [String: Any] else { return nil }
        let dl = (b["dl"] as? String).nilIfEmpty
        return SearchBook(
            id: (b["url"] as? String ?? "/book/\(eapiId)/\(eapiHash)").trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            sourceId: "zlibrary",
            title: b["title"] as? String ?? "未知书名",
            author: b["author"] as? String ?? "未知作者",
            cover: (b["cover"] as? String).nilIfEmpty,
            description: (b["description"] as? String).flatMap { MobiParser.extractText(from: $0) }.nilIfEmpty,
            format: (b["extension"] as? String ?? "epub").lowercased(),
            language: (b["language"] as? String).nilIfEmpty,
            downloadUrl: dl.map { $0.hasPrefix("http") ? $0 : "https://\(domain)\($0)" },
            eapiId: eapiId, eapiHash: eapiHash)
    }

    func getFormats(eapiId: String, eapiHash: String, domain: String) async -> [BookFormat] {
        guard let json = try? await getJson("https://\(domain)/eapi/book/\(eapiId)/\(eapiHash)/formats", domain: domain),
              (json["success"] as? Int) == 1,
              let arr = json["books"] as? [[String: Any]] else { return [] }
        var seen: [String: BookFormat] = [:]
        for v in arr {
            guard let ext = (v["extension"] as? String)?.lowercased(), !ext.isEmpty else { continue }
            guard seen[ext] == nil else { continue }
            seen[ext] = BookFormat(
                format: ext,
                size: (v["filesize"] as? Int).map { Int64($0) }.flatMap { $0 > 0 ? $0 : nil },
                sizeText: (v["filesizeString"] as? String).nilIfEmpty,
                eapiId: (v["id"] as? String).nilIfEmpty ?? (v["id"] as? Int).map(String.init),
                eapiHash: (v["hash"] as? String).nilIfEmpty)
        }
        return Array(seen.values)
    }

    func getDownloadLinkResult(eapiId: String, eapiHash: String, domain: String) async -> ZLDownloadLinkResult {
        guard let json = try? await getJson("https://\(domain)/eapi/book/\(eapiId)/\(eapiHash)/file", domain: domain),
              (json["success"] as? Int) == 1,
              let file = json["file"] as? [String: Any] else { return ZLDownloadLinkResult(url: nil, limitMessage: nil) }
        if let allow = file["allowDownload"] as? Bool, !allow {
            let raw = file["disallowDownloadMessage"] as? String ?? ""
            let clean = raw.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            return ZLDownloadLinkResult(url: nil,
                                        limitMessage: clean.isEmpty ? "今日下载次数已达上限，请等待额度重置或提升下载额度" : clean)
        }
        guard let raw = (file["downloadLink"] as? String).nilIfEmpty else { return ZLDownloadLinkResult(url: nil, limitMessage: nil) }
        let normalized: String
        if raw.hasPrefix("//") { normalized = "https:" + raw }
        else if raw.hasPrefix("/") { normalized = "https://\(domain)\(raw)" }
        else { normalized = raw }
        return ZLDownloadLinkResult(url: normalized, limitMessage: nil)
    }

    // MARK: 基础请求

    private func getJson(_ url: String, domain: String) async throws -> [String: Any] {
        let resp = try await solver.execute(Http.Request(url: url, headers: requestHeaders(domain: domain, referer: "https://\(domain)/")), host: domain)
        guard (200..<300).contains(resp.status) else { throw HttpError.status(resp.status, nil) }
        return JsonPathResolver.parseJson(resp.text) as? [String: Any] ?? [:]
    }

    private func postForm(_ url: String, fields: [String: String], domain: String) async throws -> [String: Any] {
        let form = fields.map { "\($0.key)=\($0.value.urlEncode())" }.joined(separator: "&")
        let resp = try await solver.execute(Http.Request(
            url: url, method: "POST",
            headers: requestHeaders(domain: domain, referer: "https://\(domain)/")
                .merging(["Content-Type": "application/x-www-form-urlencoded"]) { _, new in new },
            body: Data(form.utf8)), host: domain)
        guard (200..<300).contains(resp.status) else { throw HttpError.status(resp.status, nil) }
        return JsonPathResolver.parseJson(resp.text) as? [String: Any] ?? [:]
    }
}

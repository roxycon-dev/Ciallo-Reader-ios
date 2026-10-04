import Foundation
import SwiftSoup

// MARK: - 自定义 JSON 书源（source/impl/JsonBookSource.kt 对应物）
// 原生 JSON 规则 + Legado HTML 规则双通道；漫画源判定 isComicLike；
// extractImageUrls 支持纯 URL 列表与 <img> 片段（data-src/data-original/data-lazy-src/src 优先级）。

final class JsonBookSource: BookSource, ComicSourceProtocol {
    let config: SourceConfig

    init(config: SourceConfig) {
        self.config = config
    }

    var id: String { config.id }
    var name: String { config.name }
    var registrationUrl: String? { nil }

    lazy var capabilities: SourceCapabilities = {
        var c = SourceCapabilities()
        let isComic = isComicLike
        c.supportComic = isComic
        c.supportOnlineText = config.htmlContent?.textSelector != nil && !isComic
        c.supportEbook = !isComic && config.download.url != nil
        c.supportDownload = c.supportEbook || isComic
        return c
    }()

    /// 漫画源判定：配置优先，否则看 imageSelector 是否含 @src/data-src/img
    lazy var isComicLike: Bool = {
        if let t = config.type?.lowercased() {
            if t == "comic" || t == "image" { return true }
            if t == "novel" || t == "text" { return false }
        }
        if let sel = config.htmlContent?.imageSelector.lowercased() {
            return sel.contains("@src") || sel.contains("data-src") || sel.contains("img")
        }
        return false
    }()

    private var baseUrl: String {
        if !config.baseUrl.isEmpty { return config.baseUrl }
        return config.search.url.split(separator: "/").prefix(3).joined(separator: "/")
    }

    // MARK: 搜索

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        if let hs = config.htmlSearch {
            return await searchHtml(hs, keyword: keyword)
        }
        return await searchJson(keyword: keyword)
    }

    private func searchJson(keyword: String) async -> SourceResult<[SearchBook]> {
        let rule = config.search
        var url = rule.url
            .replacingOccurrences(of: "{keyword}", with: urlEncode(keyword))
            .replacingOccurrences(of: "{keyword_b64}", with: Base64Util.encode(keyword))
            .replacingOccurrences(of: "{{page}}", with: "1")
            .replacingOccurrences(of: "\\{\\{\\$[^}]*\\}\\}", with: "", options: .regularExpression)
        let body = rule.body?
            .replacingOccurrences(of: "{keyword}", with: urlEncode(keyword))
            .replacingOccurrences(of: "{keyword_b64}", with: Base64Util.encode(keyword))
        do {
            let req = Http.Request(url: url, method: rule.method.uppercased() == "POST" ? "POST" : "GET",
                                   headers: mergedHeaders(rule.headers),
                                   body: body?.data(using: .utf8))
            let resp = try await Http.send(req)
            guard (200..<300).contains(resp.status) else {
                throw Http.statusError(resp, host: URL(string: url)?.host)
            }
            let json = try JsonPathResolver.parseJson(resp.text) ?? [String: Any]()
            if resp.text.count > 4 * 1024 * 1024 { return .error(.parseError("响应过大")) }
            let items = JsonPathResolver.resolveArray(json, rule.listPath)
            let books: [SearchBook] = items.compactMap { (item: Any) -> SearchBook? in
                let f = rule.fields
                let title = JsonPathResolver.getString(item as? [String: Any] ?? [:], f.title) ?? ""
                guard !title.isEmpty else { return nil }
                let bid = JsonPathResolver.getString(item as? [String: Any] ?? [:], f.id) ?? title
                return SearchBook(id: bid, sourceId: id, title: title,
                                  author: JsonPathResolver.getString(item as? [String: Any] ?? [:], f.author ?? "") ?? "未知作者",
                                  cover: absolute(JsonPathResolver.getString(item as? [String: Any] ?? [:], f.cover ?? "")),
                                  description: JsonPathResolver.getString(item as? [String: Any] ?? [:], f.description ?? ""),
                                  format: JsonPathResolver.getString(item as? [String: Any] ?? [:], f.format ?? "") ?? ruleUrlFormat(url: rule.url) ?? "epub",
                                  downloadUrl: JsonPathResolver.getString(item as? [String: Any] ?? [:], f.downloadUrl ?? ""))
            }
            return .success(books)
        } catch {
            return .error(mapError(error))
        }
    }

    private func searchHtml(_ hs: HtmlSearchRule, keyword: String) async -> SourceResult<[SearchBook]> {
        let url = hs.url
            .replacingOccurrences(of: "{keyword}", with: urlEncode(keyword))
            .replacingOccurrences(of: "{{key}}", with: urlEncode(keyword))
            .replacingOccurrences(of: "{{page}}", with: "1")
            .replacingOccurrences(of: "{{page-1}}", with: "0")
        let body = hs.body?
            .replacingOccurrences(of: "{keyword}", with: urlEncode(keyword))
            .replacingOccurrences(of: "{{key}}", with: urlEncode(keyword))
        do {
            var headers = mergedHeaders([:])
            if body != nil { headers["Content-Type"] = "application/x-www-form-urlencoded" }
            let req = Http.Request(url: url, method: hs.method.uppercased() == "POST" ? "POST" : "GET",
                                   headers: headers, body: body?.data(using: .utf8))
            let resp = try await Http.send(req)
            guard (200..<300).contains(resp.status) else {
                throw Http.statusError(resp, host: URL(string: url)?.host)
            }
            let html = CharsetSniffer.decode(resp.data, declared: hs.charset)
            let doc = try SwiftSoup.parse(html, baseUrl)
            let items = try doc.select(hs.listSelector).array()
            let books: [SearchBook] = items.compactMap { el in
                let title = ruleValue(el, hs.titleSelector)
                guard !title.isEmpty else { return nil }
                let detail = ruleValue(el, hs.detailUrlSelector.isEmpty ? "a@href" : hs.detailUrlSelector)
                let detailUrl = absolute(detail) ?? ""
                let bookId = detailUrl.isEmpty ? title : detailUrl
                return SearchBook(id: bookId, sourceId: id, title: title,
                                  author: ruleValue(el, hs.authorSelector).isEmpty ? "未知作者" : ruleValue(el, hs.authorSelector),
                                  cover: absolute(ruleValue(el, hs.coverSelector)),
                                  description: ruleValue(el, hs.introSelector))
            }
            return .success(books)
        } catch {
            return .error(mapError(error))
        }
    }

    // MARK: 详情

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        if let detail = config.detail {
            let url = detail.url.replacingOccurrences(of: "{id}", with: bookId)
            do {
                let resp = try await Http.send(Http.Request(url: url, method: detail.method,
                                                            headers: mergedHeaders(detail.headers),
                                                            body: detail.body?.data(using: .utf8)))
                guard (200..<300).contains(resp.status) else {
                    throw Http.statusError(resp, host: URL(string: url)?.host)
                }
                if let json = try? JsonPathResolver.parseJson(resp.text) {
                    let f = detail.fields
                    let title = JsonPathResolver.getString(json, f.title) ?? ""
                    if !title.isEmpty {
                        return .success(SearchBook(id: bookId, sourceId: id, title: title,
                                                   author: JsonPathResolver.getString(json, f.author ?? "") ?? "未知作者",
                                                   cover: absolute(JsonPathResolver.getString(json, f.cover ?? "")),
                                                   description: JsonPathResolver.getString(json, f.description ?? ""),
                                                   format: JsonPathResolver.getString(json, f.format ?? "") ?? detailDefaultFormat,
                                                   size: JsonPathResolver.getString(json, "size").flatMap { Int64($0) },
                                                   downloadUrl: JsonPathResolver.getString(json, f.downloadUrl ?? "")))
                    }
                }
                // HTML 详情
                let doc = try SwiftSoup.parse(resp.text, baseUrl)
                let title = (try? doc.title()) ?? ""
                let cover = absolute((try? doc.select("img").first()?.attr("src")) ?? "")
                let intro = (try? doc.select("meta[name=description]").first()?.attr("content")) ?? nil
                return .success(SearchBook(id: bookId, sourceId: id,
                                           title: title.isEmpty ? bookId : title,
                                           author: "未知作者", cover: cover, description: intro,
                                           format: detailDefaultFormat))
            } catch {
                return .error(mapError(error))
            }
        }
        return .success(SearchBook(id: bookId, sourceId: id, title: bookId, author: "未知作者"))
    }

    private var detailDefaultFormat: String { config.download.defaultFormat }

    // MARK: 下载信息

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        if let dlUrl = config.download.url {
            let url = dlUrl.replacingOccurrences(of: "{id}", with: bookId)
            return .success(DownloadInfo(url: url, fileName: sanitize(bookId) + "." + config.download.defaultFormat,
                                         format: config.download.defaultFormat,
                                         headers: mergedHeaders(config.download.headers),
                                         referer: baseUrl))
        }
        // 从详情/搜索结果取 downloadUrl 字段
        let detail = await getDetail(bookId: bookId)
        if let book = detail.getOrNull(), let dl = book.downloadUrl {
            let format = (dl as NSString).pathExtension.lowercased()
            let realFormat = ["epub", "mobi", "pdf", "azw3", "txt", "fb2", "docx"].contains(format) ? format : "epub"
            return .success(DownloadInfo(url: absolute(dl) ?? dl,
                                         fileName: sanitize(book.title) + "." + realFormat,
                                         format: realFormat,
                                         headers: mergedHeaders(config.download.headers),
                                         referer: baseUrl))
        }
        return .error(.parseError("该书源未配置下载地址"))
    }

    // MARK: 漫画章节（HTML 通道）

    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]> {
        guard let hc = config.htmlChapters else { return .error(.parseError("该书源不支持章节")) }
        var tocUrl = hc.url.replacingOccurrences(of: "{id}", with: bookId)
        do {
            var pageHtml: String
            var pageUrl = tocUrl
            let resp = try await Http.get(absolute(tocUrl) ?? tocUrl, headers: mergedHeaders([:]))
            guard (200..<300).contains(resp.status) else {
                throw Http.statusError(resp.status, body: resp.data, host: URL(string: tocUrl)?.host)
            }
            pageHtml = resp.text
            // tocUrlSelector：目录不在详情页时先解析出目录页
            if let tocSel = hc.tocUrlSelector, !tocSel.isEmpty,
               let doc = try? SwiftSoup.parse(pageHtml, baseUrl),
               let tocHref = ruleValueElement(doc, tocSel) {
                let resolved = absolute(tocHref) ?? tocHref
                tocUrl = resolved
                pageUrl = resolved
                let resp2 = try await Http.get(resolved, headers: mergedHeaders([:]))
                pageHtml = CharsetSniffer.decode(resp2.data)
            }
            let doc = try SwiftSoup.parse(pageHtml, pageUrl)
            let items = try doc.select(hc.listSelector).array()
            var chapters: [ComicChapter] = []
            for (i, el) in items.enumerated() {
                let title = ruleValue(el, hc.nameSelector)
                let href = ruleValue(el, hc.hrefSelector)
                guard !title.isEmpty, !href.isEmpty else { continue }
                chapters.append(ComicChapter(id: absolute(href) ?? href,
                                             title: title,
                                             order: Float(i)))
            }
            guard !chapters.isEmpty else { return .error(.parseError("未解析到章节")) }
            return .success(chapters)
        } catch {
            return .error(mapError(error))
        }
    }

    func getChapterImages(chapterId: String) async -> SourceResult<[String]> {
        guard let content = config.htmlContent else { return .error(.parseError("该书源不支持内容")) }
        let url = content.url.replacingOccurrences(of: "{chapterUrl}", with: chapterId)
            .replacingOccurrences(of: "{id}", with: chapterId)
        do {
            let resp = try await Http.get(absolute(url) ?? url, headers: mergedHeaders([:]))
            guard (200..<300).contains(resp.status) else {
                throw Http.statusError(resp.status, body: resp.data, host: URL(string: url)?.host)
            }
            let doc = try SwiftSoup.parse(resp.text, absolute(url) ?? url)
            if let imgSel = content.(imageSelector as String?).flatMap { $0.isEmpty ? nil : $0 } {
                let imgs = try doc.select(imgSel.contains("@") ? String(imgSel.split(separator: "@")[0]) : imgSel).array()
                let urls = Self.extractImageUrls(from: imgs)
                guard !urls.isEmpty else { return .error(.parseError("未解析到图片")) }
                return .success(urls.map { absolute($0) ?? $0 })
            }
            if let textSel = content.(textSelector as String?).flatMap { $0.isEmpty ? nil : $0 } {
                let text = ruleValueElement(doc, textSel) ?? ""
                guard !text.isEmpty else { return .error(.parseError("未解析到正文")) }
                return .success([text])
            }
            return .error(.parseError("该书源未配置内容规则"))
        } catch {
            return .error(mapError(error))
        }
    }

    func getChapterText(chapterId: String) async -> SourceResult<String> {
        guard let content = config.htmlContent, let textSel = content.(textSelector as String?).flatMap { $0.isEmpty ? nil : $0 } else {
            return .error(.parseError("该书源不支持文字章节"))
        }
        let url = content.url.replacingOccurrences(of: "{chapterUrl}", with: chapterId)
        do {
            let resp = try await Http.get(absolute(url) ?? url, headers: mergedHeaders([:]))
            let doc = try SwiftSoup.parse(resp.text, absolute(url) ?? url)
            let text = ruleValueElement(doc, textSel) ?? ""
            guard !text.isEmpty else { return .error(.parseError("未解析到正文")) }
            return .success(text)
        } catch {
            return .error(mapError(error))
        }
    }

    // MARK: 登录（HTML 源默认无需登录）

    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(false) }
    func logout() async {}
    func isLoggedIn() async -> Bool { false }

    // MARK: 工具

    private func mergedHeaders(_ extra: [String: String]) -> [String: String] {
        var h = config.headers
        h["Referer"] = h["Referer"] ?? baseUrl
        for (k, v) in extra { h[k] = v }
        return h
    }

    private func absolute(_ path: String?) -> String? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return path }
        if path.hasPrefix("//") { return "https:" + path }
        guard let base = URL(string: baseUrl) else { return path }
        return URL(string: path, relativeTo: base)?.absoluteString
    }

    private func urlEncode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func sanitize(_ s: String) -> String {
        s.replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression)
    }

    private func ruleUrlFormat(url: String) -> String? {
        let lower = url.lowercased()
        for f in ["epub", "mobi", "pdf", "azw3", "txt", "fb2"] where lower.contains("." + f) { return f }
        return nil
    }

    /// "css@attr" 取值
    private func ruleValue(_ el: Element, _ rule: String) -> String {
        guard !rule.isEmpty else { return "" }
        if rule.hasPrefix("@css:") {
            let rest = String(rule.dropFirst(5))
            return cssValue(el, rest)
        }
        return cssValue(el, rule)
    }

    private func cssValue(_ el: Element, _ rule: String) -> String {
        if let legadoValue = LegadoRule.getString(el, rule), !legadoValue.isEmpty { return legadoValue }
        let parts = rule.components(separatedBy: "@")
        let attr = parts.count > 1 ? parts[1] : ""
        let css = parts[0]
        guard !css.isEmpty, let target = (try? el.select(css))?.first() else {
            if css.isEmpty { return attributeValue(el, attr) }
            return ""
        }
        return attributeValue(target, attr)
    }

    private func ruleValueElement(_ el: Element, _ rule: String) -> String? {
        if let legadoValue = LegadoRule.getString(el, rule), !legadoValue.isEmpty { return legadoValue }
        let parts = rule.components(separatedBy: "@")
        let attr = parts.count > 1 ? parts[1] : "text"
        guard let target = (try? el.select(parts[0]))?.first() else { return nil }
        return attributeValue(target, attr).nilIfEmpty
    }

    private func attributeValue(_ el: Element, _ attr: String) -> String {
        switch attr.lowercased() {
        case "", "text": return (try? el.text()) ?? ""
        case "owntext": return (try? el.ownText()) ?? ""
        case "html": return (try? el.html()) ?? ""
        case "src": return (try? el.attr("src")) ?? ""
        case "href": return (try? el.attr("href")) ?? ""
        default: return (try? el.attr(attr)) ?? ""
        }
    }

    /// 图片 URL 提取：data-src/data-original/data-lazy-src/src 优先级
    static func extractImageUrls(from imgs: [Element]) -> [String] {
        var urls: [String] = []
        for img in imgs {
            let candidates = ["data-src", "data-original", "data-lazy-src", "src"]
            var found = ""
            for c in candidates {
                if let v = try? img.attr(c), v.hasPrefix("http") || v.hasPrefix("//") {
                    found = v
                    break
                }
            }
            if found.isEmpty, let whole = try? img.outerHtml() {
                // <img> 片段兜底
                if let match = whole.range(of: "(?:data-src|data-original|data-lazy-src|src)=[\"']([^\"']+)[\"']",
                                           options: .regularExpression) {
                    found = String(whole[match]).replacingOccurrences(of: "[a-z-]+=[\"']", with: "", options: .regularExpression)
                        .replacingOccurrences(of: "\"", with: "")
                }
            }
            if !found.isEmpty { urls.append(found) }
        }
        return urls
    }

    private func mapError(_ error: Error) -> SourceException {
        if let e = error as? SourceException { return e }
        if case HttpError.status(401, _) = error { return .loginRequired }
        return .networkError(Http.describe(error))
    }
}

// extractImageUrls 为 static（源码内注释保留原实现说明）

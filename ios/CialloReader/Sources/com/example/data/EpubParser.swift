import Foundation
import ZIPFoundation
import SwiftSoup

// MARK: - EPUB 解析（data/EpubParser.kt 对应物）
// ZIP → container.xml → OPF（metadata/manifest/spine）→ 逐 XHTML 抽正文。
// 图片以 `[IMG:epzip:file://书文件!包内条目|宽|高]` token 内嵌（与安卓同一编码）。

enum EpubParser {
    static func isEpubFile(_ fileName: String) -> Bool {
        fileName.lowercased().hasSuffix(".epub")
    }

    static func parse(url: URL) throws -> ParsedBook {
        let archive = try Archive(url: url, accessMode: .read)
        let entryPaths = archive.map { $0.path }

        // 1) container.xml → OPF
        guard let containerEntry = entryPath(of: "META-INF/container.xml", in: entryPaths) else {
            throw ImportError("EPUB 缺少 container.xml")
        }
        guard let opfPath = try opfPath(archive: archive, containerPath: containerEntry) else {
            throw ImportError("EPUB 缺少 container.xml")
        }
        guard let opfEntry = archive.first(where: { $0.path == opfPath }) else { throw ImportError("EPUB 缺少 OPF") }

        // 2) OPF
        let opfData = try readEntry(archive, opfEntry)
        let opfHtml = try SwiftSoup.parse(String(decoding: opfData, as: UTF8.self))
        let t1 = (try? opfHtml.select("metadata > dc|title").first()?.text()) ?? nil
        let t2 = (try? opfHtml.select("title").first()?.text()) ?? nil
        let bookTitle = t1 ?? t2 ?? ""
        let author = (try? opfHtml.select("metadata > dc|creator").first()?.text()) ?? nil ?? "未知作者"

        // manifest: id → (href, properties, mediaType)
        var manifest: [String: (href: String, props: String, mediaType: String)] = [:]
        for item in try opfHtml.select("manifest > item") {
            let id = try item.attr("id")
            manifest[id] = (try item.attr("href"), try item.attr("properties"), try item.attr("media-type"))
        }
        let spineIds = try opfHtml.select("spine > itemref").compactMap { try? $0.attr("idref") }

        // 3) 封面三级策略
        let coverEntry = findCover(archive: archive, entryPaths: entryPaths, manifest: manifest, opfHtml: opfHtml)
        var coverPath: String?
        if let coverEntry {
            coverPath = try extractCover(archive, entry: coverEntry)
        }

        // 4) 逐 spine 抽正文
        let opfDir = (opfPath as NSString).deletingLastPathComponent
        var chapters: [ChapterDraft] = []
        for (i, id) in spineIds.enumerated() {
            guard let m = manifest[id], isHtmlMediaType(m.mediaType) else { continue }
            let itemPath = resolve(opfDir: opfDir, href: m.href)
            guard let entry = archive.first(where: { $0.path == itemPath }) else { continue }
            let data = try readEntry(archive, entry)
            let html = CharsetSniffer.decode(data)
            let content = try extractCleanText(from: html, bookURL: url, entryPath: itemPath, archive: archive)
            let title = chapterTitle(from: html, fallbackIndex: i)
            if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            chapters.append(contentsOf: ChapterSplitter.split(content, title: title))
        }

        guard !chapters.isEmpty else { throw ImportError("EPUB 未解析到正文") }
        return ParsedBook(title: bookTitle.isEmpty ? url.deletingPathExtension().lastPathComponent : bookTitle,
                          author: author.isEmpty ? "未知作者" : author,
                          coverPath: coverPath,
                          chapters: chapters)
    }

    // MARK: 内部工具

    private static func isHtmlMediaType(_ t: String) -> Bool {
        t == "application/xhtml+xml" || t == "text/html"
    }

    /// 容错路径匹配：ZIP 内路径大小写/前缀不严格一致时做宽松匹配。
    private static func entryPath(of path: String, in all: [String]) -> String? {
        if all.contains(path) { return path }
        let lower = path.lowercased()
        if let hit = all.first(where: { $0.lowercased() == lower }) { return hit }
        let tail = "/" + lower
        return all.first { $0.lowercased().hasSuffix(tail) }
    }

    private static func opfPath(archive: Archive, containerPath: String) throws -> String? {
        guard let entry = archive.first(where: { $0.path == containerPath }) else { return nil }
        let data = try readEntry(archive, entry)
        let doc = try SwiftSoup.parse(String(decoding: data, as: UTF8.self))
        guard let root = try doc.select("rootfile").first() else { return nil }
        return try root.attr("full-path")
    }

    static func readEntry(_ archive: Archive, _ entry: Entry) throws -> Data {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try archive.extract(entry, to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let data = try Data(contentsOf: tmp)
        var budget = ArchiveBudget()
        try budget.copy(data)
        return data
    }

    /// 解析 OPF 相对路径
    static func resolve(opfDir: String, href: String) -> String {
        var parts = (opfDir.isEmpty ? [] : opfDir.split(separator: "/").map(String.init))
            + href.split(separator: "#")[0].split(separator: "/").map(String.init)
        var stack: [String] = []
        for p in parts {
            if p == ".." { stack.removeLast() }
            else if p != "." { stack.append(p) }
        }
        parts = stack
        return parts.joined(separator: "/")
    }

    /// HTML → 纯文本（块级标签转 \n + 实体反转义 + 剔除 script/style/ruby 注音 + 图片 token）
    static func extractCleanText(from html: String, bookURL: URL, entryPath itemPath: String, archive: Archive) throws -> String {
        let doc = try SwiftSoup.parse(html)
        guard let body = doc.body() else { return "" }
        var out = ""
        try walk(node: body, bookURL: bookURL, entryPath: itemPath, archive: archive, into: &out)
        // 压缩 3+ 连续换行
        let collapsed = out
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static let blockTags: Set<String> = ["p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "section", "blockquote", "figure", "figcaption", "hr"]

    private static func walk(node: Node, bookURL: URL, entryPath itemPath: String, archive: Archive, into out: inout String) throws {
        if let element = node as? Element {
            let tag = element.tagName().lowercased()
            if tag == "script" || tag == "style" || tag == "rt" { return }
            if tag == "br" { out.append("\n"); return }
            if tag == "img" || tag == "image" {
                if let src = try? element.attr("src"), !src.isEmpty {
                    appendImageToken(src: src, bookURL: bookURL, itemPath: itemPath, archive: archive, into: &out)
                } else if let src = try? element.attr("xlink:href"), !src.isEmpty {
                    appendImageToken(src: src, bookURL: bookURL, itemPath: itemPath, archive: archive, into: &out)
                }
                out.append("\n")
                return
            }
            for child in element.getChildNodes() {
                try walk(node: child, bookURL: bookURL, entryPath: itemPath, archive: archive, into: &out)
            }
            if blockTags.contains(tag) { out.append("\n") }
        } else if let textNode = node as? TextNode {
            let text = textNode.getWholeText()
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                out.append(text)
            }
        }
    }

    /// 把 <img> 转成 `[IMG:epzip:file://书文件!条目|宽|高]`
    private static func appendImageToken(src: String, bookURL: URL, itemPath: String, archive: Archive, into out: inout String) {
        let itemDir = (itemPath as NSString).deletingLastPathComponent
        let imagePath = resolve(opfDir: itemDir, href: src)
        guard let entry = archive.first(where: { $0.path.lowercased() == imagePath.lowercased() }) else { return }
        // 读数据拿尺寸（图片通常几 MB 内）
        let head = (try? readEntry(archive, entry)) ?? Data()
        guard let (w, h) = CharsetSniffer.imageSize(of: head) else { return }
        let ref = "epzip:file://\(bookURL.path)!\(entry.path)"
        out.append("[IMG:\(ref)|\(w)|\(h)]")
    }

    private static func chapterTitle(from html: String, fallbackIndex: Int) -> String {
        guard let doc = try? SwiftSoup.parse(html) else { return "第 \(fallbackIndex + 1) 节" }
        if let t = (try? doc.select("h1,h2,h3").first()?.text()) ?? nil, !t.isEmpty { return t }
        if let t = (try? doc.title()) ?? nil, !t.isEmpty { return t }
        return "第 \(fallbackIndex + 1) 节"
    }

    // MARK: 封面三级策略

    private static func findCover(archive: Archive, entryPaths: [String], manifest: [String: (href: String, props: String, mediaType: String)], opfHtml: Document) -> Entry? {
        func entry(forHref href: String, in opfDir: String = "") -> Entry? {
            let p = resolve(opfDir: opfDir, href: href)
            return entryPath(of: p, in: entryPaths).flatMap { path in archive.first { $0.path == path } }
        }

        // EPUB3: properties=cover-image
        if let m = manifest.values.first(where: { $0.props.contains("cover-image") }) {
            if let e = entry(forHref: m.href) { return e }
        }
        // EPUB2: meta name=cover → content=id
        if let meta = (try? opfHtml.select("metadata > meta[name=cover]").first()) ?? nil,
           let coverId = (try? meta.attr("content")) ?? nil, let m = manifest[coverId] {
            if let e = entry(forHref: m.href) { return e }
        }
        // <guide><reference type="cover">
        if let ref = (try? opfHtml.select("guide > reference[type=cover]").first()) ?? nil,
           let href = (try? ref.attr("href")) ?? nil {
            if let e = entry(forHref: href) { return e }
        }
        // 暴力兜底：文件名含 cover
        if let e = archive.first(where: { $0.path.lowercased().contains("cover") && isImageEntry($0.path) }) {
            return e
        }
        // 首 spine 首图 / 体积最大图
        if let e = archive.first(where: { isImageEntry($0.path) }) {
            return e
        }
        return nil
    }

    static func isImageEntry(_ path: String) -> Bool {
        let ext = (path as NSString).pathExtension.lowercased()
        return ["jpg", "jpeg", "png", "webp", "gif", "bmp"].contains(ext)
    }

    /// 抽出封面文件
    static func extractCover(_ archive: Archive, entry: Entry) throws -> String {
        let data = try readEntry(archive, entry)
        let dir = BookRepository.coversDirectory
        let file = dir.appendingPathComponent("cover_\(UUID().uuidString).img")
        try data.write(to: file)
        return file.path
    }
}

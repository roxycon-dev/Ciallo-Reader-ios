import Foundation

// MARK: - FB2 解析（data/Fb2Parser.kt 对应物）
// <FictionBook> → <title-info>（书名/作者/<binary> 封面）→ <section>/<title> 切章节，base64 图。

enum Fb2Parser {
    static func parse(url: URL, data: Data) throws -> ParsedBook {
        let delegate = Fb2Delegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = false
        guard parser.parse() else {
            throw ImportError("FB2 解析失败：\(parser.parserError?.localizedDescription ?? "")")
        }
        guard !delegate.chapters.isEmpty else { throw ImportError("FB2 未解析到正文") }

        var coverPath: String?
        if let coverBinaryId = delegate.coverBinaryId, let binary = delegate.binaries[coverBinaryId],
           let imgData = Data(base64Encoded: binary.data, options: .ignoreUnknownCharacters) {
            let file = BookRepository.coversDirectory.appendingPathComponent("cover_\(UUID().uuidString).img")
            try? imgData.write(to: file)
            coverPath = file.path
        }

        return ParsedBook(title: delegate.title.isEmpty ? url.deletingPathExtension().lastPathComponent : delegate.title,
                          author: delegate.author.isEmpty ? "未知作者" : delegate.author,
                          coverPath: coverPath,
                          chapters: delegate.chapters)
    }
}

private final class Fb2Delegate: NSObject, XMLParserDelegate {
    var title = ""
    var author = ""
    var coverBinaryId: String?
    var chapters: [ChapterDraft] = []
    var binaries: [String: (data: String, contentType: String)] = [:]

    private enum Mode { case none, titleInfo, body, sectionTitle, sectionBody, binary }
    private var mode: Mode = .none
    private var textBuffer = ""
    private var currentBinaryId: String?
    private var currentBinaryType = ""
    private var currentSectionTitle = ""
    private var currentSectionText = ""
    private var sectionDepth = 0
    private var chapterIndex = 0
    private var currentImageId: String?

    private func local(_ name: String) -> String { name.components(separatedBy: ":").last ?? name }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName qName: String?, attributes attrs: [String: String]) {
        switch local(name) {
        case "title-info": mode = .titleInfo
        case "body" where mode != .binary:
            mode = .body
        case "section" where mode == .body:
            sectionDepth += 1
            if sectionDepth == 1 {
                currentSectionTitle = ""
                currentSectionText = ""
            }
        case "title" where mode == .body && sectionDepth >= 1:
            mode = .sectionTitle
        case "binary":
            mode = .binary
            currentBinaryId = attrs["id"]
            currentBinaryType = attrs["content-type"] ?? "image/jpeg"
        case "image" where mode == .titleInfo:
            // 封面：<coverpage><image l:href="#id">
            let href = attrs["l:href"] ?? attrs["xlink:href"] ?? attrs["href"] ?? ""
            coverBinaryId = href.replacingOccurrences(of: "#", with: "")
        case "image" where mode == .binary || sectionDepth >= 1:
            if let href = attrs["l:href"] ?? attrs["xlink:href"] ?? attrs["href"] {
                let id = href.replacingOccurrences(of: "#", with: "")
                currentSectionText.append(imageToken(forBinaryId: id))
            }
        default: break
        }
        textBuffer = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        textBuffer += string
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName qName: String?) {
        switch local(name) {
        case "book-title" where mode == .titleInfo:
            title = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        case "first-name", "last-name", "nickname" where mode == .titleInfo:
            author += textBuffer.trimmingCharacters(in: .whitespacesAndNewlines) + " "
        case "coverpage" where mode == .titleInfo:
            break
        case "image" where mode == .titleInfo:
            break
        case "title-info":
            mode = .none
        case "title" where mode == .sectionTitle:
            // 章节标题（<title><p>…</p></title>）只取第一个非空标题
            let t = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
            if currentSectionTitle.isEmpty { currentSectionTitle = t }
            mode = .body
        case "p" where sectionDepth >= 1 && mode == .body:
            let t = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { currentSectionText.append(t + "\n") }
            textBuffer = ""
        case "section" where mode == .body && sectionDepth >= 1:
            sectionDepth -= 1
            if sectionDepth == 0 {
                let content = currentSectionText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !content.isEmpty {
                    chapterIndex += 1
                    let t = currentSectionTitle.isEmpty ? "第 \(chapterIndex) 节" : currentSectionTitle
                    chapters.append(contentsOf: ChapterSplitter.split(content, title: t))
                }
            }
        case "binary":
            if let id = currentBinaryId {
                binaries[id] = (textBuffer, currentBinaryType)
            }
            currentBinaryId = nil
            mode = sectionDepth >= 1 ? .body : .none
        case "body":
            mode = .none
        default: break
        }
        // 章节标题内部的 <p> 结束时不能清空缓冲（标题文本还在里面）
        if !(local(name) == "p" && mode == .sectionTitle) {
            textBuffer = ""
        }
    }

    /// `<coverpage><image l:href="#id">` 的解析（title-info 内）
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        textBuffer += String(decoding: CDATABlock, as: UTF8.self)
    }

    private func imageToken(forBinaryId id: String) -> String {
        guard let binary = binaries[id],
              let data = Data(base64Encoded: binary.data, options: .ignoreUnknownCharacters) else { return "" }
        let file = BookRepository.bookImagesDirectory.appendingPathComponent("fb2_\(UUID().uuidString).img")
        try? data.write(to: file)
        let (w, h) = CharsetSniffer.imageSize(of: data) ?? (0, 0)
        return "[IMG:file://\(file.path)|\(w)|\(h)]"
    }
}

extension Fb2Delegate {
    // coverpage 里的 <image> 在 title-info 模式下记录
}

import Foundation
import ZIPFoundation

// MARK: - DOCX 解析（data/DocxParser.kt 对应物）
// 解 ZIP 取 word/document.xml，抽 <w:p>/<w:t>，段内图片经 rels 解析为 file:// token。

enum DocxParser {
    static func parse(url: URL) throws -> ParsedBook {
        let archive = try Archive(url: url, accessMode: .read)
        guard let docEntry = archive.first(where: { $0.path == "word/document.xml" }) else {
            throw ImportError("DOCX 缺少 document.xml")
        }
        let docData = try EpubParser.readEntry(archive, docEntry)

        // 关系表：rId → media 路径
        var rels: [String: String] = [:]
        if let relEntry = archive.first(where: { $0.path == "word/_rels/document.xml.rels" }),
           let relData = try? EpubParser.readEntry(archive, relEntry) {
            rels = Self.parseRels(relData)
        }

        let (paragraphs, imageDir) = try parseDocument(docData, archive: archive, rels: rels, bookURL: url)
        var coverPath: String?
        if let coverEntry = archive.first(where: { $0.path.hasPrefix("word/media/") && EpubParser.isImageEntry($0.path) }),
           let data = try? EpubParser.readEntry(archive, coverEntry) {
            let file = BookRepository.coversDirectory.appendingPathComponent("cover_\(UUID().uuidString).img")
            try? data.write(to: file)
            coverPath = file.path
        }
        _ = imageDir

        var chapters: [ChapterDraft] = []
        for (i, para) in paragraphs.enumerated() {
            if para.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && para.images.isEmpty { continue }
            let content = para.images.joined() + para.text
            chapters.append(contentsOf: ChapterSplitter.split(content, title: "第 \(i + 1) 段"))
        }
        // 段落太碎：合并成 5000 字一节
        if chapters.count > 40 {
            chapters = mergeParagraphs(paragraphs)
        }
        guard !chapters.isEmpty else { throw ImportError("DOCX 未解析到正文") }
        return ParsedBook(title: url.deletingPathExtension().lastPathComponent,
                          author: "未知作者",
                          coverPath: coverPath,
                          chapters: chapters)
    }

    private static func mergeParagraphs(_ paragraphs: [(text: String, images: [String])]) -> [ChapterDraft] {
        var result: [ChapterDraft] = []
        var buffer = ""
        var count = 1
        for para in paragraphs {
            let piece = para.images.joined() + para.text + "\n"
            if buffer.count + piece.count > 5000, !buffer.isEmpty {
                result.append(ChapterDraft(title: "第 \(count) 节", content: buffer))
                count += 1
                buffer = ""
            }
            buffer += piece
        }
        if !buffer.isEmpty { result.append(ChapterDraft(title: "第 \(count) 节", content: buffer)) }
        return result
    }

    static func parseRels(_ data: Data) -> [String: String] {
        var rels: [String: String] = [:]
        let delegate = RelsParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        rels = delegate.rels
        return rels
    }

    struct Para {
        var text = ""
        var images: [String] = []
    }

    private static func parseDocument(_ data: Data, archive: Archive, rels: [String: String], bookURL: URL) throws -> ([(text: String, images: [String])], URL?) {
        let delegate = DocxBodyParser(archive: archive, rels: rels, bookURL: bookURL)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else {
            throw ImportError("DOCX 解析失败：\(parser.parserError?.localizedDescription ?? "")")
        }
        return (delegate.paragraphs, delegate.imageDir)
    }
}

// MARK: XML 解析器

private final class RelsParser: NSObject, XMLParserDelegate {
    var rels: [String: String] = [:]
    private var currentId: String?
    private var currentTarget: String?

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName qName: String?, attributes attrs: [String: String]) {
        if name.hasSuffix("Relationship") {
            currentId = attrs["Id"]
            currentTarget = attrs["Target"]
        }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName qName: String?) {
        if name.hasSuffix("Relationship"), let id = currentId, let target = currentTarget {
            rels[id] = "word/" + target.replacingOccurrences(of: "../", with: "").replacingOccurrences(of: "word/", with: "")
            currentId = nil
            currentTarget = nil
        }
    }
}

private final class DocxBodyParser: NSObject, XMLParserDelegate {
    let archive: Archive
    let rels: [String: String]
    let bookURL: URL
    var paragraphs: [(text: String, images: [String])] = []
    var imageDir: URL?
    private var current = DocxParser.Para()
    private var inParagraph = false

    init(archive: Archive, rels: [String: String], bookURL: URL) {
        self.archive = archive
        self.rels = rels
        self.bookURL = bookURL
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName qName: String?, attributes attrs: [String: String]) {
        let local = name.components(separatedBy: ":").last ?? name
        switch local {
        case "p":
            inParagraph = true
            current = DocxParser.Para()
        case "t", "instrText":
            elementCapture = ""
        case "br", "cr":
            current.text.append("\n")
        case "blip":
            if let rid = attrs["r:embed"] ?? attrs["embed"], let media = rels[rid] {
                appendImage(mediaPath: media)
            }
        default: break
        }
    }

    private var elementCapture: String?

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if elementCapture != nil { elementCapture = (elementCapture ?? "") + string }
        else if inParagraph { current.text.append(string) }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName qName: String?) {
        let local = name.components(separatedBy: ":").last ?? name
        if local == "t" || local == "instrText" {
            if let captured = elementCapture { current.text.append(captured) }
            elementCapture = nil
        } else if local == "p" {
            paragraphs.append((current.text, current.images))
            inParagraph = false
        }
    }

    private func appendImage(mediaPath: String) {
        guard let entry = archive.first(where: { $0.path.lowercased() == mediaPath.lowercased() }),
              let data = try? EpubParser.readEntry(archive, entry) else { return }
        if imageDir == nil {
            let dir = BookRepository.bookImagesDirectory.appendingPathComponent(UUID().uuidString)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            imageDir = dir
        }
        let file = imageDir!.appendingPathComponent("img_\(paragraphs.count)_\(current.images.count).img")
        try? data.write(to: file)
        let (w, h) = CharsetSniffer.imageSize(of: data) ?? (0, 0)
        current.images.append("[IMG:file://\(file.path)|\(w)|\(h)]")
    }
}

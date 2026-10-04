import Foundation
import UIKit

// MARK: - 数据层门面（data/BookRepository.kt 镜像）
// 统一导入入口 importBook：按扩展名分派 EPUB/MOBI/Comic/DOCX/FB2/TXT；
// 源文件拷贝进私有存储；删除级联与磁盘占用统计。

enum BookRepository {
    static var booksRoot: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("books", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var coversDirectory: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("covers", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var bookImagesDirectory: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("book_images", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var downloadsDirectory: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: 导入

    /// 统一导入入口：拷贝源文件 → 分派解析器 → 拆章 → 入库。失败清理全部副本。
    static func importBook(from sourceURL: URL, suggestedName: String? = nil) async throws -> Book {
        let db = AppDatabase.shared
        let fileName = suggestedName ?? sourceURL.lastPathComponent
        let ext = (fileName as NSString).pathExtension.lowercased()

        // 拷贝进私有存储（源可能是临时目录，阅读期要可反复访问）
        let privateCopy = booksRoot.appendingPathComponent("\(UUID().uuidString).\(ext.isEmpty ? "bin" : ext)")
        try FileManager.default.copyItem(at: sourceURL, to: privateCopy)

        do {
            let parsed: ParsedBook
            switch ext {
            case "txt":
                parsed = try parseTxt(url: privateCopy)
            case "epub":
                parsed = try EpubParser.parse(url: privateCopy)
            case "mobi", "azw3", "azw", "prc":
                let data = try Data(contentsOf: privateCopy)
                parsed = try MobiParser.parse(url: privateCopy, data: data)
            case "docx":
                parsed = try DocxParser.parse(url: privateCopy)
            case "fb2":
                let data = try Data(contentsOf: privateCopy)
                parsed = try Fb2Parser.parse(url: privateCopy, data: data)
            case "cbz", "zip", "pdf":
                parsed = try ComicParser.parse(url: privateCopy)
            case "cbr", "cb7", "rar", "7z":
                throw ImportError("请转换为CBZ、ZIP或PDF格式后导入。")
            default:
                throw ImportError("暂不支持该格式：\(ext)")
            }

            var book = Book(title: "", filePath: "")
            book.title = parsed.title
            book.author = parsed.author
            book.filePath = parsed.filePath.isEmpty ? privateCopy.path : parsed.filePath
            book.coverUri = parsed.coverPath
            book.contentType = parsed.contentType.rawValue
            book.totalChapters = parsed.chapters.count
            // 漫画：filePath 指向漫画目录，源包也保留
            if parsed.contentType == .comic {
                book.filePath = parsed.filePath
            }

            var chapters: [Chapter] = []
            for (i, draft) in parsed.chapters.enumerated() {
                chapters.append(Chapter(bookId: 0, chapterOrder: i, title: draft.title, content: draft.content))
            }
            book.id = try db.insertBook(book, chapters: chapters)
            _ = try db.categories()
            try? db.ensureDefaultCategory()
            NotificationCenter.default.post(name: dbChangedNotification, object: nil)
            return book
        } catch {
            // 回滚私有副本
            try? FileManager.default.removeItem(at: privateCopy)
            throw error
        }
    }

    /// TXT：编码嗅探 → 按章节正则切分 → 超长拆分
    static func parseTxt(url: URL) throws -> ParsedBook {
        let data = try Data(contentsOf: url)
        let text = CharsetSniffer.decode(data)
        var chapters: [ChapterDraft] = []
        let headingRegex = try NSRegularExpression(pattern: #"^\s*(第[0-9一二三四五六七八九十百千零〇]+[章回节卷部篇话]|序章|楔子|前言|后记|尾声|番外)\s*.*$"#, options: [.anchorsMatchLines])
        let ns = text as NSString
        let matches = headingRegex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))

        if matches.count >= 3 {
            var lastTitle = "开始"
            var bufferStart = 0
            for m in matches {
                let chunk = ns.substring(with: NSRange(location: bufferStart, length: max(0, m.range.location - bufferStart)))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !chunk.isEmpty {
                    chapters.append(contentsOf: ChapterSplitter.split(chunk, title: lastTitle))
                }
                lastTitle = ns.substring(with: m.range).trimmingCharacters(in: .whitespacesAndNewlines)
                bufferStart = m.range.location + m.range.length
            }
            let tail = ns.substring(from: bufferStart).trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty {
                chapters.append(contentsOf: ChapterSplitter.split(tail, title: lastTitle))
            }
        } else {
            chapters = ChapterSplitter.split(text, title: "正文")
        }
        guard !chapters.isEmpty else { throw ImportError("TXT 内容为空") }
        return ParsedBook(title: url.deletingPathExtension().lastPathComponent,
                          author: "未知作者",
                          coverPath: nil,
                          chapters: chapters)
    }

    // MARK: 删除与占用

    static func deleteBookCascade(_ book: Book) async throws {
        let db = AppDatabase.shared
        // 神回级联：本地漫画 bookId = local_<bookId>
        try? db.exec("DELETE FROM god_moments WHERE bookId=?", [.text(book.isComic ? "local_\(book.id)" : "\(book.id)")])
        try db.deleteBook(id: book.id)
        // 文件清理
        try? FileManager.default.removeItem(atPath: book.filePath)
        if let cover = book.coverUri { try? FileManager.default.removeItem(atPath: cover) }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    static func diskUsage(of path: String) -> Int64 {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir) else { return 0 }
        if isDir.boolValue {
            var total: Int64 = 0
            if let enumerator = FileManager.default.enumerator(atPath: path) {
                for case let file as String in enumerator {
                    if let attrs = try? FileManager.default.attributesOfItem(atPath: (path as NSString).appendingPathComponent(file)),
                       let size = attrs[.size] as? Int64 { total += size }
                }
            }
            return total
        }
        return (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int64) ?? 0
    }

    static func totalLibraryBytes() -> Int64 {
        var total: Int64 = 0
        for dir in [booksRoot, coversDirectory, bookImagesDirectory, downloadsDirectory] {
            total += diskUsage(of: dir.path)
        }
        return total
    }

    static func formatSize(_ bytes: Int64) -> String {
        let kb = Double(bytes) / 1024
        if kb < 1024 { return String(format: "%.0fKB", kb) }
        let mb = kb / 1024
        if mb < 1024 { return String(format: "%.1fMB", mb) }
        return String(format: "%.2fGB", mb / 1024)
    }

    // MARK: 本地漫画页读取

    /// 本地漫画章（一页一章节）的图片路径
    static func comicPagePath(chapter: Chapter) -> String { chapter.content }
}

import Foundation
import ZIPFoundation
import PDFKit
import UIKit

// MARK: - 漫画容器解析（data/ComicParser.kt 对应物）
// CBZ/ZIP：解压可见图片页；PDF：逐页栅格化（scale = min(1080/w, 1920/h, 2)，JPEG 85）。
// 一页 = 一 Chapter（content = 图片绝对路径）；CBR/RAR/7Z 明确拒绝。

enum ComicParser {
    static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "bmp", "gif"]

    static func isComicFile(_ fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ["cbz", "zip", "pdf", "cbr", "cb7", "rar", "7z"].contains(ext)
    }

    static func parse(url: URL) throws -> ParsedBook {
        let ext = url.pathExtension.lowercased()
        guard ["pdf", "cbz", "zip"].contains(ext) else {
            throw ImportError("请转换为CBZ、ZIP或PDF格式后导入。")
        }
        let comicDir = BookRepository.booksRoot.appendingPathComponent("comics_\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: comicDir, withIntermediateDirectories: true)

        var pages: [(name: String, file: URL)] = []
        do {
            if ext == "pdf" {
                pages = try renderPdf(url: url, into: comicDir)
            } else {
                pages = try extractCbz(url: url, into: comicDir)
            }
        } catch {
            try? FileManager.default.removeItem(at: comicDir)
            throw error
        }

        guard !pages.isEmpty else {
            try? FileManager.default.removeItem(at: comicDir)
            throw ImportError("未在文件中找到有效漫画页面")
        }
        pages.sort { naturalOrderCompare($0.name, $1.name) < 0 }

        // 封面 = 首页拷贝
        let cover = BookRepository.coversDirectory.appendingPathComponent("cover_\(UUID().uuidString).jpg")
        try? FileManager.default.copyItem(at: pages[0].file, to: cover)

        return ParsedBook(title: url.deletingPathExtension().lastPathComponent,
                          author: "漫画",
                          coverPath: cover.path,
                          chapters: pages.enumerated().map { i, page in
                              ChapterDraft(title: "第 \(i + 1) 页", content: page.file.path)
                          },
                          contentType: .comic,
                          filePath: comicDir.path)
    }

    // MARK: CBZ/ZIP

    private static func extractCbz(url: URL, into dir: URL) throws -> [(String, URL)] {
        let archive = try Archive(url: url, accessMode: .read)
        var budget = ArchiveBudget()
        var pages: [(String, URL)] = []
        for entry in archive where entry.type == .file {
            let name = entry.path.replacingOccurrences(of: "\\", with: "/")
            let visible = name.split(separator: "/").allSatisfy { !$0.hasPrefix(".") && $0 != "__MACOSX" }
            let ext = (name as NSString).pathExtension.lowercased()
            guard visible, imageExtensions.contains(ext) else { continue }
            try budget.beginEntry()
            let data = try archive.extract(entry)
            try budget.copy(data.count)
            let file = dir.appendingPathComponent("img_\(pages.count).\(ext)")
            try data.write(to: file)
            pages.append((name, file))
        }
        return pages
    }

    // MARK: PDF

    private static func renderPdf(url: URL, into dir: URL) throws -> [(String, URL)] {
        guard let document = PDFDocument(url: url) else { throw ImportError("无法打开PDF文件") }
        let pageCount = document.pageCount
        guard pageCount <= 10_000 else { throw ImportError("PDF页数超过安全上限") }
        var pages: [(String, URL)] = []
        for i in 0..<pageCount {
            guard let page = document.page(at: i) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let scale = min(1080 / max(bounds.width, 1), 1920 / max(bounds.height, 1), 2.0)
            let w = max(Int(bounds.width * scale), 1)
            let h = max(Int(bounds.height * scale), 1)
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
            let image = renderer.image { ctx in
                UIColor.white.setFill()
                ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
                UIColor.white.setFill()
                ctx.cgContext.translateBy(x: 0, y: CGFloat(h))
                ctx.cgContext.scaleBy(x: scale, y: -scale)
                page.draw(with: .mediaBox, to: ctx.cgContext)
            }
            guard let jpeg = image.jpegData(compressionQuality: 0.85) else { continue }
            let file = dir.appendingPathComponent("page_\(i).jpg")
            try jpeg.write(to: file)
            pages.append(("page_\(i).jpg", file))
        }
        return pages
    }

    // MARK: 自然排序（数字段按数值比：page_2 < page_10）

    static func naturalOrderCompare(_ a: String, _ b: String) -> Int {
        let ac = Array(a), bc = Array(b)
        var i = 0, j = 0
        while i < ac.count && j < bc.count {
            if ac[i].isNumber && bc[j].isNumber {
                let aStart = i, bStart = j
                while i < ac.count && ac[i].isNumber { i += 1 }
                while j < bc.count && bc[j].isNumber { j += 1 }
                var ai = aStart, bj = bStart
                while ai < i && ac[ai] == "0" { ai += 1 }
                while bj < j && bc[bj] == "0" { bj += 1 }
                let lengthOrder = (i - ai) - (j - bj)
                if lengthOrder != 0 { return lengthOrder }
                while ai < i {
                    let ca = ac[ai].lowercased(), cb = bc[bj].lowercased()
                    if ca != cb { return ca < cb ? -1 : 1 }
                    ai += 1; bj += 1
                }
            } else {
                let order = ac[i].lowercased().compare(bc[j].lowercased()).rawValue
                i += 1; j += 1
                if order != 0 { return order }
            }
        }
        let lenOrder = (ac.count - i) - (bc.count - j)
        return lenOrder != 0 ? lenOrder : (a < b ? -1 : (a == b ? 0 : 1))
    }
}

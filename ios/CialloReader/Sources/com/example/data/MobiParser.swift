import Foundation
import SwiftSoup

// MARK: - MOBI/AZW3/AZW/PRC 解析（data/MobiParser.kt 对应物，零第三方依赖）
// PDB 容器 → MOBI 头 + EXTH 元数据 → 正文解压 → 章节切分 → 封面。
// 支持：无压缩(1)、PalmDOC LZ77(2)；HUFF/CDIC(17480) 与 DRM 明确报"暂不支持"。

enum MobiParser {
    static func isMobiFile(_ fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ["mobi", "azw3", "azw", "prc"].contains(ext)
    }

    // MARK: 容器

    struct PdbRecord {
        let offset: Int
        let size: Int
    }

    static func pdbRecords(of data: Data) -> [PdbRecord] {
        guard data.count >= 78 else { return [] }
        let numRecords = Int(be16(data, at: 76))
        var records: [PdbRecord] = []
        for i in 0..<numRecords {
            let entryAt = 78 + i * 8
            guard entryAt + 8 <= data.count else { break }
            let offset = Int(be32(data, at: entryAt))
            let end = i + 1 < numRecords ? Int(be32(data, at: entryAt + 8)) : data.count
            records.append(PdbRecord(offset: offset, size: max(0, end - offset)))
        }
        return records
    }

    // MARK: 解析入口

    static func parse(url: URL, data: Data) throws -> ParsedBook {
        guard data.starts(with: Data("BOOKMOBI".utf8)) || data.starts(with: Data("TEXtREAd".utf8)) else {
            throw ImportError("不是有效的 MOBI/AZW3 文件")
        }
        let records = pdbRecords(of: data)
        guard records.count > 1 else { throw ImportError("MOBI 记录表损坏") }

        // Record 0：PalmDOC 头 + MOBI 头
        let r0 = data.subdata(in: records[0].offset..<(records[0].offset + records[0].size))
        let compression = Int(be16(r0, at: 0))
        let textLength = Int(be32(r0, at: 4))
        let recordCount = Int(be16(r0, at: 8))
        let encryption = Int(be16(r0, at: 12))
        guard encryption == 0 else { throw ImportError("该 Kindle 文件有 DRM 保护，无法导入") }

        var textEncoding: UInt32 = 1252
        var mobiVersion: UInt32 = 0
        var firstImageIndex: Int = -1
        var exthRecords: [(Int, Data)] = []
        var fullName = ""

        if r0.count > 24, String(data: r0.subdata(in: 16..<20), encoding: .ascii) == "MOBI" {
            let headerLength = Int(be32(r0, at: 20))
            mobiVersion = be32(r0, at: 36)
            textEncoding = be32(r0, at: 28)
            if r0.count > 112 { firstImageIndex = Int(be32(r0, at: 108)) }
            // 全名
            if headerLength >= 0xE4, r0.count > 88 {
                let fullNameOffset = Int(be32(r0, at: 84))
                let fullNameLength = Int(be32(r0, at: 88))
                if fullNameOffset + fullNameLength <= r0.count {
                    fullName = decode(r0.subdata(in: fullNameOffset..<(fullNameOffset + fullNameLength)), encoding: textEncoding)
                }
            }
            // EXTH
            let exthStart = 16 + headerLength
            if r0.count > exthStart + 12, String(data: r0.subdata(in: exthStart..<(exthStart + 4)), encoding: .ascii) == "EXTH" {
                var pos = exthStart + 12
                let exthEnd = exthStart + Int(be32(r0, at: exthStart + 4))
                while pos + 8 <= min(exthEnd, r0.count) {
                    let type = Int(be32(r0, at: pos))
                    let len = Int(be32(r0, at: pos + 4))
                    guard len >= 8, pos + len <= r0.count else { break }
                    exthRecords.append((type, r0.subdata(in: (pos + 8)..<(pos + len))))
                    pos += len
                }
            }
        } else {
            // PalmDOC（无 MOBI 头）
            fullName = url.deletingPathExtension().lastPathComponent
        }

        // 文本记录
        guard recordCount > 0, recordCount + 1 <= records.count else { throw ImportError("MOBI 文本记录缺失") }
        var extraFlags: UInt32 = 0
        if mobiVersion >= 5, r0.count >= 244 { extraFlags = UInt32(be16(r0, at: 242)) }

        var compressed = Data()
        for i in 1...recordCount {
            let rec = data.subdata(in: records[i].offset..<(records[i].offset + records[i].size))
            compressed.append(trimTrailing(rec, flags: extraFlags))
        }
        var textData: Data
        switch compression {
        case 1: textData = compressed
        case 2: textData = decodePalmDoc(compressed)
        case 17480:
            // HUFF/CDIC 哈夫曼：按 KindleUnpack/Ephemerality.Unpack 同款算法逐记录解码
            let huffRecordIndex = Int(be32(r0, at: 112))
            let huffRecordCount = Int(be32(r0, at: 116))
            let decoder = try HuffCdicDecoder(records: records, bookData: data,
                                              huffRecordIndex: huffRecordIndex,
                                              huffRecordCount: huffRecordCount)
            var out = Data()
            for i in 1...recordCount {
                let rec = data.subdata(in: records[i].offset..<(records[i].offset + records[i].size))
                out.append(decoder.unpack([UInt8](rec)))
            }
            textData = out
        default: throw ImportError("未知压缩格式：\(compression)")
        }
        var full = decode(textData.prefix(textLength), encoding: textEncoding)

        // PalmDOC 老格式（PalmDB）页码分隔
        if compression == 1, mobiVersion == 0 { full = full.replacingOccurrences(of: "\u{2029}", with: "\n\n") }

        // 图片记录 → 提取被 recindex 引用的图
        var imageDir: URL?
        var imageIndex: [Int: String] = [:]
        if firstImageIndex > 0, firstImageIndex < records.count {
            let dir = BookRepository.bookImagesDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            imageDir = dir
            // recindex N → records[firstImageIndex + N - 1]
            for i in firstImageIndex..<records.count {
                let rec = data.subdata(in: records[i].offset..<(records[i].offset + records[i].size))
                if CharsetSniffer.imageSize(of: rec) != nil {
                    let file = dir.appendingPathComponent("img_\(i - firstImageIndex)")
                    try rec.write(to: file)
                    imageIndex[i - firstImageIndex] = file.path
                }
            }
        }
        if !imageIndex.isEmpty {
            full = replaceRecindexTokens(full, imageIndex: imageIndex)
        }

        // HTML → 章节（pagebreak 粗切 → h1-h6 细切 → 5000 字兜底）
        let chapters = splitHtmlIntoChapters(full)
        guard !chapters.isEmpty else { throw ImportError("MOBI 未解析到正文") }

        // 封面：EXTH 201 → firstImage
        var coverPath: String?
        if let coverRec = exthRecords.first(where: { $0.0 == 201 })?.1 {
            let recIndex = Int(be32(coverRec, at: 0))
            let absIndex = firstImageIndex + recIndex
            if let path = imageIndex[absIndex - firstImageIndex] { coverPath = path }
        }
        if coverPath == nil, let first = imageIndex[0] { coverPath = first }

        let title = decodeHtmlTitle(full) ?? fullName
        return ParsedBook(title: title.isEmpty ? url.deletingPathExtension().lastPathComponent : title,
                          author: exthRecordString(exthRecords, type: 100) ?? "未知作者",
                          coverPath: coverPath,
                          chapters: chapters)
    }

    private static func exthRecordString(_ records: [(Int, Data)], type: Int) -> String? {
        guard let (_, data) = records.first(where: { $0.0 == type }) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: PalmDOC LZ77（decodePalmDoc）

    static func decodePalmDoc(_ data: Data) -> Data {
        var out = Data()
        out.reserveCapacity(data.count * 4)
        let bytes = [UInt8](data)
        var i = 0
        while i < bytes.count {
            let b = bytes[i]; i += 1
            if b == 0 {
                out.append(0)
            } else if b <= 8 {
                let end = min(i + Int(b), bytes.count)
                out.append(contentsOf: bytes[i..<end])
                i = end
            } else if b <= 0x7F {
                out.append(b)
            } else if b <= 0xBF {
                guard i < bytes.count else { break }
                let b2 = bytes[i]; i += 1
                let lz = (Int(b) << 8 | Int(b2)) & 0x3FFF
                var distance = lz >> 3
                let length = (lz & 7) + 3
                if distance == 0 { distance = 1 }
                guard distance <= out.count else { break }
                for _ in 0..<length {
                    let idx = out.count - distance
                    out.append(out[idx])
                }
            } else {
                out.append(0x20)
                out.append(b ^ 0x80)
            }
        }
        return out
    }

    /// 尾随条目裁剪（extraFlags）
    static func trimTrailing(_ data: Data, flags: UInt32) -> Data {
        var bytes = [UInt8](data)
        var f = flags & 0x7FFF
        var bit = 1
        while f > 1 {
            if f & 1 != 0 {
                let n = sizeOfTrailingEntry(bytes)
                if n > 0, n <= bytes.count { bytes.removeLast(n) }
            }
            f >>= 1
            bit += 1
        }
        if flags & 1 != 0, let last = bytes.last {
            let n = Int(last & 3) + 1
            if n <= bytes.count { bytes.removeLast(n) }
        }
        _ = bit
        return Data(bytes)
    }

    private static func sizeOfTrailingEntry(_ data: [UInt8]) -> Int {
        guard data.count >= 1 else { return 0 }
        var num = 0
        let lookBack = min(4, data.count)
        for i in 0..<lookBack {
            let v = data[data.count - 1 - i]
            if v & 0xC0 != 0xC0 { break }
            num += 1
        }
        guard num > 0 else { return 0 }
        var result = 0
        for j in 0..<num {
            result |= Int(data[data.count - num + j] & 0x7F) << (7 * (num - 1 - j))
        }
        return result
    }

    // MARK: recindex 图片替换 → `[IMG:file://...|w|h]`

    static func replaceRecindexTokens(_ html: String, imageIndex: [Int: String]) -> String {
        guard let doc = try? SwiftSoup.parse(html) else { return html }
        guard let body = try? doc.body() else { return html }
        // 收集所有 img[recindex]
        guard let imgs = try? body.select("img[recindex]") else { return html }
        for img in imgs {
            guard let recStr = try? img.attr("recindex"), let rec = Int(recStr), let path = imageIndex[rec - 1] else { continue }
            var (w, h) = (0, 0)
            if let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
               let size = CharsetSniffer.imageSize(of: data) { (w, h) = size }
            let token = "[IMG:file://\(path)|\(w)|\(h)]"
            try? img.before(token)
            try? img.remove()
        }
        return (try? doc.body()?.html()) ?? html
    }

    // MARK: HTML 章节切分

    static func splitHtmlIntoChapters(_ html: String) -> [ChapterDraft] {
        let cleaned = html.replacingOccurrences(of: "<mbp:pagebreak[^>]*>", with: "<!--PB-->", options: .regularExpression)
            .replacingOccurrences(of: "<mbp:pagebreak/>", with: "<!--PB-->")
        var rough = cleaned.components(separatedBy: "<!--PB-->")
        if rough.count == 1 {
            rough = cleaned.components(separatedBy: "<hr")
        }
        var result: [ChapterDraft] = []
        for (i, chunk) in rough.enumerated() {
            let text = extractText(from: chunk)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let title = htmlHeading(chunk) ?? "第 \(i + 1) 节"
            // 5000 字兜底切分
            if text.count > 5000 {
                result.append(contentsOf: ChapterSplitter.split(text, title: title, maxLength: 5000))
            } else {
                result.append(ChapterDraft(title: title, content: text))
            }
        }
        if result.isEmpty {
            let text = extractText(from: html)
            if !text.isEmpty { result = ChapterSplitter.split(text, title: "正文") }
        }
        return result
    }

    /// HTML 片段 → 纯文本
    static func extractText(from html: String) -> String {
        guard let doc = try? SwiftSoup.parse(html), let body = try? doc.body() else {
            return html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        }
        var out = ""
        walk(body, into: &out)
        return out.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func walk(_ node: Node, into out: inout String) {
        if let el = node as? Element {
            let tag = el.tagName().lowercased()
            if tag == "script" || tag == "style" || tag == "rt" { return }
            if tag == "br" { out.append("\n"); return }
            for child in (try? el.getChildNodes()) ?? [] {
                walk(child, into: &out)
            }
            if ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote"].contains(tag) {
                out.append("\n")
            }
        } else if let textNode = node as? TextNode {
            out.append(textNode.getWholeText())
        }
    }

    static func htmlHeading(_ html: String) -> String? {
        guard let doc = try? SwiftSoup.parse(html) else { return nil }
        for sel in ["h1", "h2", "h3"] {
            if let t = (try? doc.select(sel).first()?.text()) ?? nil, !t.isEmpty { return t }
        }
        return nil
    }

    static func decodeHtmlTitle(_ html: String) -> String? {
        guard let doc = try? SwiftSoup.parse(html) else { return nil }
        if let t = htmlHeading(html), !t.isEmpty { return t }
        return (try? doc.title()) ?? nil
    }

    // MARK: 基础工具

    static func be32(_ d: Data, at i: Int) -> UInt32 {
        guard i + 4 <= d.count else { return 0 }
        let s = d.index(d.startIndex, offsetBy: i)
        let b0 = UInt32(d[s])
        let b1 = UInt32(d[d.index(s, offsetBy: 1)])
        let b2 = UInt32(d[d.index(s, offsetBy: 2)])
        let b3 = UInt32(d[d.index(s, offsetBy: 3)])
        return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
    }

    static func be16(_ d: Data, at i: Int) -> UInt16 {
        guard i + 2 <= d.count else { return 0 }
        let s = d.index(d.startIndex, offsetBy: i)
        let b0 = UInt16(d[s])
        let b1 = UInt16(d[d.index(s, offsetBy: 1)])
        return b0 << 8 | b1
    }

    static func decode(_ data: Data, encoding: UInt32) -> String {
        if encoding == 65001 || encoding == 0 { return String(decoding: data, as: UTF8.self) }
        if encoding == 1252, let s = String(data: data, encoding: .windowsCP1252) { return s }
        if let s = String(data: data, encoding: .utf8) { return s }
        return CharsetSniffer.decode(data)
    }
}

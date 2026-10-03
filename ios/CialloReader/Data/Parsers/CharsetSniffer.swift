import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - 编码嗅探（data/CharsetSniffer.kt 对应物）
// BOM → UTF-8 合法性 → GBK/GB18030 兜底。

enum CharsetSniffer {
    /// BOM 嗅探
    static func bomEncoding(of data: Data) -> String.Encoding? {
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { return .utf8 }
        if data.starts(with: [0xFF, 0xFE]) { return .utf16LittleEndian }
        if data.starts(with: [0xFE, 0xFF]) { return .utf16BigEndian }
        return nil
    }

    static func isValidUtf8(_ data: Data) -> Bool {
        String(bytes: data, encoding: .utf8) != nil
    }

    private static var gbk: String.Encoding {
        let cfEnc = CFStringEncodings.GB_18030_2000
        let nsEnc = CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(cfEnc.rawValue))
        return String.Encoding(rawValue: nsEnc)
    }

    /// 全量解码：BOM → 声明（外部传入）→ UTF-8 合法性 → GBK。
    static func decode(_ data: Data, declared: String? = nil) -> String {
        if let bom = bomEncoding(of: data), let s = String(data: data, encoding: bom) { return s }
        if let declared, let enc = encoding(named: declared), let s = String(data: data, encoding: enc) { return s }
        if isValidUtf8(data), let s = String(data: data, encoding: .utf8) { return s }
        return String(data: data, encoding: gbk) ?? String(decoding: data, as: UTF8.self)
    }

    static func encoding(named name: String) -> String.Encoding? {
        switch name.lowercased() {
        case "utf-8", "utf8": return .utf8
        case "utf-16", "utf16": return .utf16
        case "gbk", "gb2312", "gb18030", "cp936": return gbk
        case "big5": return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.big5.rawValue)))
        case "shift_jis", "sjis": return .shiftJIS
        case "euc-kr": return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.euc_KR.rawValue)))
        default: return nil
        }
    }

    /// 读图片头拿像素尺寸（不解码全图）。
    static func imageSize(of data: Data) -> (Int, Int)? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orient = (props[kCGImagePropertyOrientation] as? UInt32) ?? 1
        if orient >= 5 { return (h, w) }
        return (w, h)
    }
}

// MARK: - 导入安全预算（data/ImportSafety.kt 镜像）

struct ArchiveBudget {
    static let maxSingleEntry: Int = 64 * 1024 * 1024
    static let maxTotal: Int = 512 * 1024 * 1024
    static let maxEntries: Int = 10_000

    private(set) var totalBytes: Int = 0
    private(set) var entryCount: Int = 0

    mutating func beginEntry() throws {
        entryCount += 1
        if entryCount > Self.maxEntries { throw ImportError("压缩包条目数超过安全上限") }
    }

    mutating func add(_ bytes: Int) throws {
        totalBytes += bytes
        if totalBytes > Self.maxTotal { throw ImportError("解压总量超过安全上限") }
    }

    mutating func copy(_ data: Data) throws {
        if data.count > Self.maxSingleEntry { throw ImportError("单个条目超过安全上限") }
        try add(data.count)
    }
}

struct ImportError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

// MARK: - 章节草稿

struct ChapterDraft {
    var title: String
    var content: String
}

struct ParsedBook {
    var title: String
    var author: String
    var coverPath: String?
    var chapters: [ChapterDraft]
    var contentType: ContentType = .novel
    var filePath: String = ""
}

// MARK: - 超长章节拆分（splitChapterText：保留 UTF-16 代理对与图片 token）

enum ChapterSplitter {
    static func split(_ text: String, title: String, maxLength: Int = maxChapterLength) -> [ChapterDraft] {
        guard text.count > maxLength else { return [ChapterDraft(title: title, content: text)] }
        var result: [ChapterDraft] = []
        var index = 0
        var part = 0
        let chars = Array(text)
        while index < chars.count {
            let end = min(index + maxLength, chars.count)
            // 优先在换行处断开
            var cut = end
            if end < chars.count {
                if let lastBreak = chars[index..<end].lastIndex(where: { $0 == "\n" }) {
                    cut = chars.index(after: lastBreak)
                }
            }
            part += 1
            let piece = String(chars[index..<cut])
            result.append(ChapterDraft(title: part == 1 ? title : "\(title) (续\(part - 1))", content: piece))
            index = cut
        }
        return result
    }
}

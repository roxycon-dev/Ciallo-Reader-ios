import Foundation
import ImageIO
import UniformTypeIdentifiers

// 对齐 novel-reader/app/src/main/java/com/example/data/CharsetSniffer.kt（44 行）
// 附带 iOS 侧辅助 facade：decode(data, declared:)（source/NetworkCalls 等调用方依赖）与
// imageSize(of:)（各解析器共用，Kotlin 无对应）。

enum CharsetSniffer {
    static func detect(_ data: Data, complete: Bool = true) -> String.Encoding {
        func charset(_ name: String) -> String.Encoding? {
            switch name {
            case "UTF-16LE": return .utf16LittleEndian
            case "UTF-16BE": return .utf16BigEndian
            case "GB18030": return gb18030
            case "Big5": return big5
            case "Shift_JIS": return .shiftJIS
            case "EUC-KR": return eucKr
            default: return nil
            }
        }
        if data.count >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf { return .utf8 }
        if data.count >= 2 && data[0] == 0xff && data[1] == 0xfe { return charset("UTF-16LE")! }
        if data.count >= 2 && data[0] == 0xfe && data[1] == 0xff { return charset("UTF-16BE")! }
        let sample = data.prefix(min(data.count, 65536))
        let pairs = sample.count / 2
        if pairs > 8 {
            let even = (0..<pairs).filter { sample[$0 * 2] == 0 }.count
            let odd = (0..<pairs).filter { sample[$0 * 2 + 1] == 0 }.count
            if odd > pairs / 4 && even < pairs / 10 { return charset("UTF-16LE")! }
            if even > pairs / 4 && odd < pairs / 10 { return charset("UTF-16BE")! }
        }
        // Kotlin strict decoder（CodingErrorAction.REPORT）≈ String(data:encoding:) 失败返回 nil
        func decode(_ cs: String.Encoding) -> String? {
            String(data: sample, encoding: cs)
        }
        if decode(.utf8) != nil { return .utf8 }
        let frequent = "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习便响约支般史感劳团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞" + "國體學說這為個們時後會來發經書與關長開無話歡愛讀"
        func score(_ text: String) -> Double {
            let useful = text.filter { !$0.isWhitespace && $0.unicodeScalars.first!.value > 127 }
            if useful.isEmpty { return 0.0 }
            let frequentSet = Set(frequent)
            let common = Double(useful.filter { frequentSet.contains($0) }.count) / Double(useful.count)
            let kana = Double(useful.filter { c in
                let v = c.unicodeScalars.first!.value
                return v >= 0x3040 && v <= 0x30ff
            }.count) / Double(useful.count)
            let hangul = Double(useful.filter { c in
                let v = c.unicodeScalars.first!.value
                return v >= 0xac00 && v <= 0xd7af
            }.count) / Double(useful.count)
            let bad = Double(useful.filter { c in
                let v = c.unicodeScalars.first!.value
                return c.unicodeScalars.first!.value < 0x20 || c.unicodeScalars.first!.value == 0x7F || (v >= 0xe000 && v <= 0xf8ff)
            }.count) / Double(useful.count)
            return common + kana * 2.0 + hangul * 1.5 - bad * 5.0
        }
        var candidates: [(String.Encoding, Double)] = []
        for name in ["GB18030", "Big5", "Shift_JIS", "EUC-KR"] {
            guard let cs = charset(name), let text = decode(cs) else { continue }
            candidates.append((cs, score(text)))
        }
        guard let best = candidates.max(by: { $0.1 < $1.1 }) else {
            fatalError("无法可靠识别文字编码，请将文件转换为 UTF-8")
        }
        return best.0
    }

    // MARK: - iOS 侧辅助 facade（Kotlin 无对应；NetworkCalls/解析器依赖）

    static var gb18030: String.Encoding {
        String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
    }
    static var big5: String.Encoding {
        String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.big5.rawValue)))
    }
    static var eucKr: String.Encoding {
        String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.EUC_KR.rawValue)))
    }

    static func bomEncoding(of data: Data) -> String.Encoding? {
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { return .utf8 }
        if data.starts(with: [0xFF, 0xFE]) { return .utf16LittleEndian }
        if data.starts(with: [0xFE, 0xFF]) { return .utf16BigEndian }
        return nil
    }

    static func isValidUtf8(_ data: Data) -> Bool {
        String(bytes: data, encoding: .utf8) != nil
    }

    static func encoding(named name: String) -> String.Encoding? {
        switch name.lowercased() {
        case "utf-8", "utf8": return .utf8
        case "utf-16", "utf16": return .utf16
        case "utf-16le": return .utf16LittleEndian
        case "utf-16be": return .utf16BigEndian
        case "gbk", "gb2312", "gb18030", "cp936": return gb18030
        case "big5": return big5
        case "shift_jis", "sjis", "shift-jis": return .shiftJIS
        case "euc-kr", "euckr": return eucKr
        default: return nil
        }
    }

    /// 全量解码：BOM → UTF-8 合法性 → 四候选打分 → 声明编码兜底（decode 不抛错版）。
    static func decode(_ data: Data, declared: String? = nil) -> String {
        let enc = detect(data)
        if let s = String(data: data, encoding: enc) { return s }
        if let declared, let e = encoding(named: declared), let s = String(data: data, encoding: e) { return s }
        return String(decoding: data, as: UTF8.self)
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

// MARK: - 章节草稿（iOS 侧辅助，Kotlin 无对应——Kotlin 解析器直接产出 Chapter 实体）

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

// MARK: - 超长章节拆分（ChapterSplitter：入库侧"标题 (续N)"命名，iOS 侧辅助）

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

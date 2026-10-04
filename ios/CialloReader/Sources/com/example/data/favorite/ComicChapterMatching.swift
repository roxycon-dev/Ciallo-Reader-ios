import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/ComicChapterMatching.kt（74 行）
// Cross-source identity uses unique titles or explicit episode numbers, never list positions or IDs.
//
// TODO: Kotlin 依赖 com.example.source.anilist.TitleNormalizer.compact —— source 包归别的代理，
//       落地后把下方 TitleNormalizerShim 替换为真实调用。

enum ComicChapterMatching {
    static func mapping(old: [ComicChapter], fresh: [ComicChapter]) -> [String: ComicChapter] {
        var result: [String: ComicChapter] = [:]
        var used = Set<String>()
        func pair(_ key: (ComicChapter) -> String?) {
            var oldGroups: [String: [ComicChapter]] = [:]
            for c in old { if let k = key(c) { oldGroups[k, default: []].append(c) } }
            var newGroups: [String: [ComicChapter]] = [:]
            for c in fresh { if let k = key(c) { newGroups[k, default: []].append(c) } }
            for (identity, group) in oldGroups {
                let to = newGroups[identity].flatMap { $0.count == 1 ? $0.first : nil }
                let from = group.count == 1 ? group.first : nil
                if let from, let to, !result.keys.contains(from.id), !used.contains(to.id),
                   compatibleVolumes(from, to) {
                    result[from.id] = to
                    used.insert(to.id)
                }
            }
        }
        pair { c in
            let compact = TitleNormalizerShim.compact(c.title)
            return compact.isEmpty ? nil : "\(volume(c))|\(compact)"
        }
        pair { c in number(c.title).map { "\(volume(c))|\($0)" } }
        // Some sources omit volume names. Only globally unique numbers may bridge that omission.
        pair { c in number(c.title) }
        return result
    }

    private static func volume(_ c: ComicChapter) -> String {
        // Regex("(?i)第\s*(\d+)\s*[卷巻]|vol(?:ume)?\.?\s*(\d+)")
        let inlineRegex = try! NSRegularExpression(pattern: #"(?i)第\s*(\d+)\s*[卷巻]|vol(?:ume)?\.?\s*(\d+)"#)
        let ns = c.title as NSString
        var inline = ""
        if let m = inlineRegex.firstMatch(in: c.title, options: [], range: NSRange(location: 0, length: ns.length)) {
            for i in 1..<m.numberOfRanges {
                let r = m.range(at: i)
                if r.location != NSNotFound, !ns.substring(with: r).isEmpty {
                    inline = ns.substring(with: r)
                    break
                }
            }
        }
        let raw = c.volume.map { $0.trimmingCharacters(in: .whitespaces) }
            .flatMap { $0.isEmpty ? nil : $0 } ?? inline
        // Normalizer.normalize(raw, NFKC)
        let normalized = raw.precomposedStringWithCompatibilityMapping
        // Regex("(?i)^(?:第\s*)?(\d+)(?:\s*[卷巻])?$|^(?:vol(?:ume)?\.?\s*)(\d+)$").matchEntire
        let digitsRegex = try! NSRegularExpression(pattern: #"(?i)^(?:第\s*)?(\d+)(?:\s*[卷巻])?$|^(?:vol(?:ume)?\.?\s*)(\d+)$"#)
        let nns = normalized as NSString
        if let m = digitsRegex.firstMatch(in: normalized, options: [.anchored], range: NSRange(location: 0, length: nns.length)) {
            for i in 1..<m.numberOfRanges {
                let r = m.range(at: i)
                if r.location != NSNotFound, !nns.substring(with: r).isEmpty,
                   let n = Int(nns.substring(with: r)) {
                    return String(n)
                }
            }
        }
        return TitleNormalizerShim.compact(raw)
    }

    private static func compatibleVolumes(_ a: ComicChapter, _ b: ComicChapter) -> Bool {
        volume(a).isEmpty || volume(b).isEmpty || volume(a) == volume(b)
    }

    private static func number(_ raw: String) -> String? {
        // 中文数字 → 阿拉伯数字（第X话/回/章），NFKC 归一后替换
        let normalized = raw.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespaces)
        let cnRegex = try! NSRegularExpression(pattern: #"第\s*([零〇一二两兩三四五六七八九十百千]+)\s*([话話回章])"#)
        let ns = normalized as NSString
        var title = normalized
        for m in cnRegex.matches(in: normalized, options: [], range: NSRange(location: 0, length: ns.length)).reversed() {
            let chinese = ns.substring(with: m.range(at: 1))
            let unit = ns.substring(with: m.range(at: 2))
            let replacement = chineseNumber(chinese).map { "第\($0)\(unit)" } ?? ns.substring(with: m.range)
            title = (title as NSString).replacingCharacters(in: m.range, with: replacement)
        }
        // 番外/特别/extra 等特殊篇一律不算正篇话数
        let specialRegex = try! NSRegularExpression(pattern: #"(?i)番外|特別|特别|extra|special|omake|附录|附錄|上篇|下篇|前篇|后篇|後篇|上半|下半|part|[（(]\s*[上下前后後]\s*[）)]"#)
        let tns = title as NSString
        if specialRegex.firstMatch(in: title, options: [], range: NSRange(location: 0, length: tns.length)) != nil {
            return nil
        }
        // Kotlin 显式模式：第\s*(\d+(?:\.\d+)?)\s*[话話回章]|(?<![\p{L}\p{N}])(?:chapter\s*|ch\.?\s*|episode\s*|ep\.?\s*)(\d+(?:\.\d+)?)
        let explicitRegex = try! NSRegularExpression(
            pattern: #"(?i)第\s*(\d+(?:\.\d+)?)\s*[话話回章]|(?<![\p{L}\p{N}])(?:chapter\s*|ch\.?\s*|episode\s*|ep\.?\s*)(\d+(?:\.\d+)?)"#)
        // Kotlin 裸数字模式：^(\d+(?:\.\d+)?)(?:$|\s|[话話回章:：])
        let bareRegex = try! NSRegularExpression(pattern: #"^(\d+(?:\.\d+)?)(?:$|\s|[话話回章:：])"#)
        let tns2 = title as NSString
        let fullRange = NSRange(location: 0, length: tns2.length)
        var value: String? = nil
        if let m = explicitRegex.firstMatch(in: title, options: [], range: fullRange) {
            for i in 1..<m.numberOfRanges {
                let r = m.range(at: i)
                if r.location != NSNotFound, !tns2.substring(with: r).isEmpty {
                    value = tns2.substring(with: r)
                    break
                }
            }
        }
        if value == nil, let m = bareRegex.firstMatch(in: title, options: [], range: fullRange), m.numberOfRanges > 1 {
            value = tns2.substring(with: m.range(at: 1))
        }
        guard let v = value, v.count <= 16 else { return nil }
        return ComicReadingLogic.normalizedDecimal(v) // toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString()
    }

    private static func chineseNumber(_ raw: String) -> Int? {
        let digits: [Character: Int] = ["零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "兩": 2,
                                        "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9]
        if raw.allSatisfy({ digits[$0] != nil }) {
            let joined = raw.compactMap { digits[$0] }.map(String.init).joined()
            return Int(joined)
        }
        var total = 0
        var current = 0
        for char in raw {
            if let digit = digits[char] {
                current = digit
            } else {
                let unit: Int
                switch char {
                case "十": unit = 10
                case "百": unit = 100
                case "千": unit = 1000
                default: return nil
                }
                total += (current == 0 ? 1 : current) * unit
                current = 0
            }
        }
        return total + current
    }
}

/// Kotlin FavoriteDao.replaceFavoriteMapped 的返回结构（同包定义于 ComicChapterMatching.kt 尾部）。
struct FavoriteMigrationReport {
    let migrated: Int
    let unmatched: Int
    let resumeMatched: Bool
}

// MARK: - iOS 侧辅助 shim（TODO：source 包 TitleNormalizer 落地后整体移除）

enum TitleNormalizerShim {
    /// 紧凑形态：去空白 + 全半角 NFKC 归一 + 转小写（与 Kotlin TitleNormalizer.compact 的
    /// 「用于等值比对的压缩键」语义对齐；精确实现以 source 包为准）。
    static func compact(_ raw: String) -> String {
        raw.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
            .lowercased()
    }
}

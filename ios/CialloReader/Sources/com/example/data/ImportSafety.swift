import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/ImportSafety.kt（72 行）

/// Limits apply to actual expanded bytes, including entries the parser ignores.
struct ArchiveBudget {
    let maxEntryBytes: Int64
    let maxTotalBytes: Int64
    let maxEntries: Int
    private(set) var total: Int64 = 0
    private(set) var entries: Int = 0

    init(maxEntryBytes: Int64 = 64 * 1024 * 1024, maxTotalBytes: Int64 = 512 * 1024 * 1024, maxEntries: Int = 10_000) {
        self.maxEntryBytes = maxEntryBytes
        self.maxTotalBytes = maxTotalBytes
        self.maxEntries = maxEntries
    }

    /// Kotlin `copyEntry(input, output)`：Swift 侧以“新到一块数据”推进预算；
    /// output 为 nil 时只计数不写出。
    func copy(_ data: Data) throws {
        entries += 1
        guard entries <= maxEntries else { throw ImportError("too many") }
        total += Int64(data.count)
        guard total <= maxTotalBytes else { throw ImportError("too big") }
    }

    mutating func copyEntry(_ data: Data, output: OutputStream? = nil) throws {
        entries += 1
        guard entries <= maxEntries else { throw ImportError("压缩包条目过多") }
        let size = Int64(data.count)
        total += size
        guard size <= maxEntryBytes && total <= maxTotalBytes else {
            throw ImportError("压缩包解压体积超过安全上限")
        }
        if let output {
            data.withUnsafeBytes { raw in
                _ = output.write(raw.bindMemory(to: UInt8.self).baseAddress!, maxLength: data.count)
            }
        }
    }

    /// Kotlin `ArchiveBudget.destination(root, entryName)`：压缩包条目落地路径（防绝对路径/越界）。
    static func destination(root: URL, entryName: String) throws -> URL {
        let normalized = entryName.replacingOccurrences(of: "\\", with: "/")
        guard !normalized.hasPrefix("/"),
              !normalized.containsMatch(of: try NSRegularExpression(pattern: "^[A-Za-z]:")) else {
            throw ImportError("压缩包包含绝对路径")
        }
        let target = root.appendingPathComponent(normalized).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        let rootPrefix = (rootPath as NSString).appendingPathComponent("") // trimEnd(sep)+sep 语义
        guard target.path.hasPrefix(rootPath + "/") || target.path.hasPrefix(rootPrefix) || target.path == rootPath else {
            throw ImportError("压缩包包含越界路径")
        }
        return target
    }
}

extension String {
    /// Regex("...").containsMatchIn(s) 对应物
    func containsMatch(of regex: NSRegularExpression) -> Bool {
        let ns = self as NSString
        return regex.firstMatch(in: self, options: [], range: NSRange(location: 0, length: ns.length)) != nil
    }
}

/// InputStream.readImportBytes(maxBytes) 对应物：整段读入并施加单条目/总量预算。
func readImportBytes(_ data: Data, maxBytes: Int = 64 * 1024 * 1024) throws -> Data {
    var budget = ArchiveBudget(maxEntryBytes: Int64(maxBytes), maxTotalBytes: Int64(maxBytes), maxEntries: 1)
    try budget.copyEntry(data, output: nil)
    return data
}

/// Keep UTF-16 pairs and inline image references intact when storing chapter rows.
func splitChapterText(_ text: String, limit: Int = maxChapterLength) throws -> [String] {
    precondition(limit >= 2)
    if text.isEmpty { return [] }
    var parts: [String] = []
    let ns = text as NSString
    var start = 0
    while start < ns.length {
        var end = min(start + limit, ns.length)
        if end < ns.length {
            // Kotlin: text[end-1] 是高代理且 text[end] 是低代理 → end--
            if end >= 2 {
                let prev = ns.substring(with: NSRange(location: end - 1, length: 1))
                let next = ns.substring(with: NSRange(location: end, length: 1))
                if prev.isHighSurrogate && next.isLowSurrogate { end -= 1 }
            }
            // Kotlin: tokenStart = text.lastIndexOf("[IMG:", end-1)（UTF-16 索引）
            var tokenStart = -1
            let imgPrefix = "[IMG:"
            let searchEnd = end - 1 + imgPrefix.count // Swift range 上界语义换算（Kotlin lastIndexOf 从该索引向前找）
            let upTo = min(searchEnd, ns.length)
            let headRange = NSRange(location: 0, length: upTo)
            if let found = ns.range(of: imgPrefix, options: .backwards, range: headRange).toOptional() {
                if found.location + found.length <= end - 1 + imgPrefix.count { tokenStart = found.location }
            }
            if tokenStart >= start, let close = positionOf(text, "]", after: tokenStart), close >= end {
                guard tokenStart > start else { throw ImportError("内嵌图片引用超过章节长度上限") }
                end = tokenStart
            }
        }
        parts.append(ns.substring(with: NSRange(location: start, length: end - start)))
        start = end
    }
    return parts
}

private func positionOf(_ text: String, _ needle: String, after index: Int) -> Int? {
    let ns = text as NSString
    guard index < ns.length else { return nil }
    let rest = ns.substring(from: index)
    guard let r = rest.range(of: needle) else { return nil }
    return index + (rest as NSString).range(of: needle).location
}

private extension String {
    var isHighSurrogate: Bool {
        guard let u = unicodeScalars.first else { return false }
        return u.value >= 0xD800 && u.value <= 0xDBFF
    }
    var isLowSurrogate: Bool {
        guard let u = unicodeScalars.first else { return false }
        return u.value >= 0xDC00 && u.value <= 0xDFFF
    }
}

extension NSRange {
    func toOptional() -> NSRange? { location == NSNotFound ? nil : self }
}

/// 导入/解压失败错误（原 data/CharsetSniffer.kt 聚合区持有，Kotlin 侧散在各 parser 的 require/IllegalStateException）。
struct ImportError: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

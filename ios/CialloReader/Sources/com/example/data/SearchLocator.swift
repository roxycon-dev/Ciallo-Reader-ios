import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/SearchLocator.kt（102 行）
// （NovelInlineImages 位于同 target 的 ui/reader/，Swift 无包系统直接引用。）

/**
 * 小说全文搜索的纯定位逻辑：MainViewModel（结果统计）与 ReaderScreen（跳转定位）
 * 共用同一份实现，保证「第 N 处出现」在两端口径一致 —— 任何一端单独改动都会被
 * NovelSearchFlowTest 抓住。
 *
 * 设计要点：不用字符偏移做跨章换算（ChapterMerger 的物理→逻辑偏移表基于空 content
 * 的 metadata，不可信），全部用「忽略大小写的第 N 处出现」在拼接后文本上直接数。
 */
enum SearchLocator {

    /// 忽略大小写的出现次数。
    static func countOccurrences(_ text: String, query: String) -> Int {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return 0 }
        var count = 0
        let visible = visibleText(text)
        var searchRange = visible.startIndex..<visible.endIndex
        while let found = visible.range(of: query, options: .caseInsensitive, range: searchRange) {
            count += 1
            searchRange = visible.index(found.lowerBound, offsetBy: query.count, limitedBy: visible.endIndex).map { $0..<visible.endIndex }
                ?? visible.endIndex..<visible.endIndex
        }
        return count
    }

    /**
     * 合并后文本（逻辑章 formatted 文本 = 物理章 content 按顺序拼接 + 行首缩进）中
     * 关键词第 occurrence 处（0 起）的位置；不存在返回 -1。
     */
    static func nthOccurrence(_ text: String, query: String, occurrence: Int) -> Int {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || occurrence < 0 { return -1 }
        let visible = visibleText(text)
        let ns = visible as NSString
        var at = firstCaseInsensitiveIndex(ns, query, from: 0) ?? -1 ?? -1
        var i = 0
        while at >= 0 {
            if i == occurrence { return at }
            i += 1
            at = firstCaseInsensitiveIndex(ns, query, from: at + (query as NSString).length) ?? -1 ?? -1
        }
        return -1
    }

    /**
     * 搜索预览：剔除图片占位符、压平换行（原文段落换行会把关键词挤到
     * maxLines=2 的截断区之外 —— 用户看到"预览没有关键词"即此因），
     * 关键词位于预览中心（前后各留若干字）。
     * content 内 pos 处的匹配 → 干净预览；pos 传 -1 时在剔除后的文本里重新定位。
     */
    static func buildSnippet(_ content: String, query: String, pos: Int) -> String {
        let plain = visibleText(content)
        let ns = plain as NSString
        let qn = query as NSString
        var at: Int
        if pos >= 0 && pos + qn.length <= ns.length {
            let region = ns.substring(with: NSRange(location: pos, length: qn.length))
            at = region.compare(query, options: .caseInsensitive) == .orderedSame ? pos : -1
        } else {
            at = -1
        }
        if at < 0 { at = firstCaseInsensitiveIndex(ns, query, from: 0) ?? -1 }
        if at < 0 { return "..." }
        let start = max(at - 15, 0)
        let end = min(at + qn.length + 25, ns.length)
        let middle = ns.substring(with: NSRange(location: start, length: end - start))
        return "..." + middle.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) + "..."
    }

    /**
     * 由 LIKE 命中的物理章列表构建搜索结果行：每章只出一条，
     * occurrence = 同逻辑章内、按物理章顺序之前各章出现次数之和 + 本章内第几处。
     * MainViewModel.searchFullText 与测试共用 —— 两端口径单一来源。
     *
     * @param logicalIndexOf 物理章 order → 逻辑章 index（ChapterMerger 映射）
     * @param logicalTitleOf 逻辑章 index → 标题
     */
    static func buildResults(
        matchedChapters: [Chapter],
        query: String,
        logicalIndexOf: (Int) -> Int,
        logicalTitleOf: (Int) -> String?
    ) -> [SearchResultItem] {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return [] }
        var results: [SearchResultItem] = []
        var beforeCounts: [Int: Int] = [:]
        for chapter in matchedChapters.sorted(by: { $0.chapterOrder < $1.chapterOrder }) {
            let logicalIndex = logicalIndexOf(chapter.chapterOrder)
            let plain = visibleText(chapter.content)
            let ns = plain as NSString
            let qn = query as NSString
            var at = firstCaseInsensitiveIndex(ns, query, from: 0) ?? -1 ?? -1 ?? -1
            var occurrence = beforeCounts[logicalIndex] ?? 0
            while at >= 0 {
                let start = max(at - 15, 0)
                let end = min(at + qn.length + 25, ns.length)
                let middle = ns.substring(with: NSRange(location: start, length: end - start))
                let snippet = "..." + middle.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) + "..."
                results.append(SearchResultItem(chapterIndex: logicalIndex,
                                                chapterTitle: logicalTitleOf(logicalIndex) ?? chapter.title,
                                                snippet: snippet,
                                                occurrence: occurrence))
                occurrence += 1
                if results.count >= maxResults { return results }
                at = firstCaseInsensitiveIndex(ns, query, from: at + qn.length) ?? -1
            }
            beforeCounts[logicalIndex] = occurrence
        }
        return results
    }

    // Same length as raw text: reader jumps retain their character offsets, but never count image paths.
    private static func visibleText(_ text: String) -> String {
        if !NovelInlineImages.hasImages(text) { return text }
        return NovelInlineImages.blankTokens(text)
    }

    static let maxResults = 1000

    /// Kotlin `String.indexOf(query, fromIndex, ignoreCase = true)` 的 UTF-16 索引对应物。
    private static func firstCaseInsensitiveIndex(_ ns: NSString, _ query: String, from: Int) -> Int? {
        guard from <= ns.length else { return nil }
        let range = NSRange(location: from, length: ns.length - from)
        let found = ns.range(of: query, options: .caseInsensitive, range: range)
        return found.location == NSNotFound ? nil : found.location
    }
}

// MARK: - iOS 侧辅助 facade（ReaderModel.swift 依赖的旧 API，Kotlin 无对应）

extension SearchLocator {
    static let snippetRadius = 40

    /// 搜索前去掉图片路径（不产生假命中）。
    static func stripImageTokens(_ text: String) -> String {
        text.replacingOccurrences(of: "\\[IMG:[^\\]]*\\]", with: "", options: .regularExpression)
    }

    static func countOccurrences(_ text: String, keyword: String) -> Int {
        guard !keyword.isEmpty else { return 0 }
        var count = 0
        var searchRange = text.startIndex..<text.endIndex
        while let found = text.range(of: keyword, options: .caseInsensitive, range: searchRange) {
            count += 1
            searchRange = found.upperBound..<text.endIndex
        }
        return count
    }

    static func buildSnippet(_ text: String, occurrence: Int, keyword: String) -> String? {
        guard !keyword.isEmpty, occurrence >= 0 else { return nil }
        var searchRange = text.startIndex..<text.endIndex
        var nth = 0
        while let found = text.range(of: keyword, options: .caseInsensitive, range: searchRange) {
            if nth == occurrence {
                let start = text.index(found.lowerBound, offsetBy: -snippetRadius, limitedBy: text.startIndex) ?? text.startIndex
                let end = text.index(found.upperBound, offsetBy: snippetRadius, limitedBy: text.endIndex) ?? text.endIndex
                let prefix = start > text.startIndex ? "…" : ""
                let suffix = end < text.endIndex ? "…" : ""
                return prefix + text[start..<end].replacingOccurrences(of: "\n", with: " ") + suffix
            }
            nth += 1
            searchRange = found.upperBound..<text.endIndex
        }
        return nil
    }

    /// 全章搜索：返回每章命中数与首条摘要
    static func buildResults(chapters: [Chapter], keyword: String) -> [SearchResultItem] {
        var results: [SearchResultItem] = []
        for chapter in chapters {
            let text = stripImageTokens(chapter.content)
            let count = countOccurrences(text, keyword: keyword)
            guard count > 0 else { continue }
            let snippet = buildSnippet(text, occurrence: 0, keyword: keyword) ?? ""
            for occurrence in 0..<count {
                results.append(SearchResultItem(chapterIndex: chapter.chapterOrder,
                                                chapterTitle: chapter.title,
                                                snippet: snippet,
                                                occurrence: occurrence))
            }
            if results.count >= 1000 { break }
        }
        return Array(results.prefix(1000))
    }
}

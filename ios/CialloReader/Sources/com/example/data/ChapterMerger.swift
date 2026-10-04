import Foundation

// MARK: - 章节合并器（data/ChapterMerger.kt 镜像）
// 把入库时按 MAX_CHAPTER_LENGTH 拆出的 "标题 (续N)" 物理章节，每组最多 4 章合并；
// 维护 physicalToLogical / physicalToLogicalOffset / logicalToPhysicalOrders 三张映射表。
// 读者看合并后的完整章节，数据库不动。

enum ChapterMerger {
    static let maxMergeCount = 4

    /// 物理章（chapterOrder 升序）→ 逻辑章
    struct LogicalChapter {
        let title: String
        let orders: [Int]          // 包含的物理章 chapterOrder
        let contents: [String]
        /// 每个物理章在逻辑章文本中的起始字符偏移
        let offsets: [Int]
        var content: String { contents.joined() }
    }

    static func isContinuation(_ title: String) -> Bool {
        title.contains(" (续")
    }

    static func baseTitle(_ title: String) -> String {
        guard let range = title.range(of: " (续") else { return title }
        return String(title[title.startIndex..<range.lowerBound])
    }

    static func merge(_ physical: [Chapter]) -> [LogicalChapter] {
        var result: [LogicalChapter] = []
        var i = 0
        while i < physical.count {
            let first = physical[i]
            if isContinuation(first.title) {
                // 残缺续章（找不到主章）：单独成逻辑章
                result.append(LogicalChapter(title: first.title, orders: [first.chapterOrder],
                                             contents: [first.content], offsets: [0]))
                i += 1
                continue
            }
            var orders = [first.chapterOrder]
            var contents = [first.content]
            var j = i + 1
            while j < physical.count, j - i < maxMergeCount,
                  isContinuation(physical[j].title),
                  baseTitle(physical[j].title) == baseTitle(first.title) {
                orders.append(physical[j].chapterOrder)
                contents.append(physical[j].content)
                j += 1
            }
            var running = 0
            var offsets: [Int] = []
            for c in contents {
                offsets.append(running)
                running += c.count
            }
            result.append(LogicalChapter(title: first.title, orders: orders,
                                         contents: contents, offsets: offsets))
            i = j
        }
        return result
    }

    /// 物理章序 → 逻辑章序（找不到返回 nil）
    static func physicalToLogical(_ logical: [LogicalChapter], physicalOrder: Int) -> (logicalIndex: Int, offsetInChapter: Int)? {
        for (li, lc) in logical.enumerated() {
            if let oi = lc.orders.firstIndex(of: physicalOrder) {
                return (li, lc.offsets[oi])
            }
        }
        return nil
    }

    /// 逻辑章序 → 物理章序
    static func logicalToPhysicalOrder(_ logical: [LogicalChapter], logicalIndex: Int) -> Int? {
        guard logical.indices.contains(logicalIndex) else { return nil }
        return logical[logicalIndex].orders.first
    }
}

// MARK: - 全文搜索定位（data/SearchLocator.kt 镜像）
// 命中计数 / 跳第 N 处 / 上下文摘要。搜索前用 stripImageTokens 去掉图片路径（不产生假命中）。

enum SearchLocator {
    static let snippetRadius = 40

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

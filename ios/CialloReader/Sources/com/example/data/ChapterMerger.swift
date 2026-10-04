import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/ChapterMerger.kt（91 行）
/**
 * Builds logical chapters from DB chapters that were split into "title (续N)" parts.
 * The reader sees one merged chapter; the database is left untouched.
 */
private let CONTINUATION_TITLE = try! NSRegularExpression(pattern: #"^(.+?)\s*\((?:续|续[0-9]+)\)\s*$"#)

/// 章节合并结果（Kotlin LogicalChapterBook）：三张映射表 + 逻辑章列表。
struct LogicalChapterBook {
    let chapters: [Chapter]
    let physicalToLogical: [Int]
    let physicalToLogicalOffset: [Int]
    let logicalToPhysicalOrders: [[Int]]

    func logicalIndexOf(_ physicalOrder: Int) -> Int {
        physicalOrder >= 0 && physicalOrder < physicalToLogical.count ? physicalToLogical[physicalOrder] : physicalOrder
    }

    func logicalOffsetOf(_ physicalOrder: Int, _ physicalOffset: Int) -> Int {
        if physicalOrder >= 0 && physicalOrder < physicalToLogicalOffset.count {
            return physicalToLogicalOffset[physicalOrder] + physicalOffset
        }
        return physicalOffset
    }

    func physicalIndexFor(_ logicalIndex: Int) -> Int {
        if logicalIndex >= 0 && logicalIndex < logicalToPhysicalOrders.count {
            return logicalToPhysicalOrders[logicalIndex].first ?? logicalIndex
        }
        return logicalIndex
    }
}

enum ChapterMerger {
    static func cleanSplitTitle(_ title: String) -> String {
        let ns = (title.trimmingCharacters(in: .whitespaces)) as NSString
        let m = CONTINUATION_TITLE.firstMatch(in: title, options: [.anchored], range: NSRange(location: 0, length: ns.length))
        if let m, m.numberOfRanges > 1 { return ns.substring(with: m.range(at: 1)) }
        return title
    }

    static func buildLogicalChapters(_ physical: [Chapter]) -> LogicalChapterBook {
        var byOrder: [Int: Chapter] = [:]
        for ch in physical { byOrder[ch.chapterOrder] = ch }
        let maxOrder = physical.map { $0.chapterOrder }.max() ?? -1
        var physToLog = Array(0...max(maxOrder, 0)) // IntArray(maxOrder + 1) { it }
        if maxOrder < 0 { physToLog = [] }
        var physOffset = [Int](repeating: 0, count: max(maxOrder + 1, 0))
        var logToPhys: [[Int]] = []
        var logical: [Chapter] = []

        var parts: [Int] = []
        var baseTitle: String? = nil
        var buffer = ""

        func flush() {
            if parts.isEmpty { return }
            let first = byOrder[parts.first!]!
            let last = byOrder[parts.last!]!
            logical.append(Chapter(
                bookId: first.bookId,
                chapterOrder: logical.count,
                title: baseTitle ?? first.title,
                content: buffer,
                startCharIndex: first.startCharIndex,
                endCharIndex: last.endCharIndex
            ))
            logToPhys.append(parts)
            parts = []
            buffer = ""
            baseTitle = nil
        }

        for ch in physical {
            let order = ch.chapterOrder
            let m = CONTINUATION_TITLE.firstMatch(in: ch.title.trimmingCharacters(in: .whitespaces),
                                                  options: [.anchored],
                                                  range: NSRange(location: 0, length: (ch.title as NSString).length))
            var continuationTitle: String? = nil
            if let m, m.numberOfRanges > 1 {
                continuationTitle = (ch.title.trimmingCharacters(in: .whitespaces) as NSString).substring(with: m.range(at: 1))
            }
            let isContinuation = continuationTitle != nil && baseTitle == continuationTitle && !parts.isEmpty && parts.count < 4
            if isContinuation {
                physOffset[order] = buffer.utf16.count // Kotlin buffer.length = UTF-16 单位
                buffer += ch.content
                parts.append(order)
                physToLog[order] = logical.count
            } else {
                flush()
                baseTitle = cleanSplitTitle(ch.title.trimmingCharacters(in: .whitespaces))
                buffer += ch.content
                parts.append(order)
                physOffset[order] = 0
                physToLog[order] = logical.count
            }
        }
        flush()

        return LogicalChapterBook(chapters: logical, physicalToLogical: physToLog,
                                  physicalToLogicalOffset: physOffset, logicalToPhysicalOrders: logToPhys)
    }

    // MARK: - iOS 侧辅助（ReaderModel.swift 依赖的合并视图；Kotlin 无对应结构）

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

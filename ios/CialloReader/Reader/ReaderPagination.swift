import Foundation
import CoreText
import UIKit

// MARK: - 文字分页引擎（ReaderPagination.kt 对应物）
// 块驱动分页：正文拆成「行段」与「图片块」原子项逐项累加断页；
// 文本用 CoreText CTFramesetter 实测可见范围（与渲染同源排版引擎），
// 首页扣除章节标题预留 titleReservePx；LRU 缓存（上限 8）键 = 内容 + 宽高 + 字号 + 行距。

struct PaginationKey: Hashable {
    let contentHash: Int
    let width: CGFloat
    let height: CGFloat
    let fontSize: CGFloat
    let lineHeight: CGFloat
}

struct ReaderPage: Identifiable, Hashable {
    let blocks: [NovelInlineImages.Block]
    var id: Int { hashValue }
    static func == (l: ReaderPage, r: ReaderPage) -> Bool { l.blocks == r.blocks }
}

final class ReaderPaginationCache {
    private var cache: [PaginationKey: [ReaderPage]] = [:]
    private var order: [PaginationKey] = []
    private let lock = NSLock()

    func get(_ key: PaginationKey) -> [ReaderPage]? {
        lock.lock()
        defer { lock.unlock() }
        guard let pages = cache[key] else { return nil }
        // 访问序前移（LinkedHashMap 访问序）
        order.removeAll { $0 == key }
        order.append(key)
        return pages
    }

    func put(_ key: PaginationKey, _ pages: [ReaderPage]) {
        lock.lock()
        defer { lock.unlock() }
        if cache.count >= 8, let oldest = order.first {
            cache.removeValue(forKey: oldest)
            order.removeAll { $0 == oldest }
        }
        cache[key] = pages
        order.append(key)
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        cache.removeAll()
        order.removeAll()
    }
}

enum ReaderPagination {
    /// 分页主入口
    static func paginate(blocks: [NovelInlineImages.Block],
                         pageSize: CGSize,
                         font: UIFont,
                         lineHeight: CGFloat,
                         titleReserve: CGFloat = 0,
                         cache: ReaderPaginationCache? = nil,
                         cacheKey: PaginationKey? = nil) -> [ReaderPage] {
        if let cache, let key = cacheKey, let hit = cache.get(key) {
            return hit
        }
        var pages: [[NovelInlineImages.Block]] = []
        var current: [NovelInlineImages.Block] = []
        // 可用高度：首页扣除标题预留
        var remaining = pageSize.height - titleReserve
        let minHeight = font.lineHeight * 1.2

        func newPage() {
            if !current.isEmpty { pages.append(current) }
            current = []
            remaining = pageSize.height
        }

        for block in blocks {
            switch block {
            case .text(let text):
                var rest = text as NSString
                while rest.length > 0 {
                    if remaining < minHeight { newPage() }
                    let fitted = fittedRange(of: rest, width: pageSize.width, height: remaining,
                                             font: font, lineHeight: lineHeight)
                    if fitted.length <= 0 {
                        // 单行都放不下：翻页（防御死循环：强制截一行）
                        if current.isEmpty {
                            let cut = min(rest.length, 1)
                            current.append(.text(rest.substring(to: cut)))
                            rest = rest.substring(from: cut) as NSString
                        }
                        newPage()
                        continue
                    }
                    current.append(.text(rest.substring(with: NSRange(location: 0, length: fitted.length))))
                    rest = rest.substring(from: fitted.length) as NSString
                    // 本块被切断 → 继续时换页
                    if rest.length > 0 { newPage() }
                    else {
                        // 块结束：扣除已用高度
                        remaining -= measuredHeight(of: text as NSString, width: pageSize.width,
                                                    font: font, lineHeight: lineHeight)
                        if remaining < minHeight { newPage() }
                    }
                }
            case .image(let token):
                let h = imageDisplayHeight(token: token, pageWidth: pageSize.width)
                let capped = min(h, pageSize.height)
                if capped > remaining { newPage() }
                current.append(.image(token))
                remaining -= capped
            }
        }
        if !current.isEmpty { pages.append(current) }
        let result = pages.map { ReaderPage(blocks: $0) }
        if let cache, let key = cacheKey {
            cache.put(key, result)
        }
        return result
    }

    /// CoreText 实测：给定宽高内能放下的字符范围
    static func fittedRange(of text: NSString, width: CGFloat, height: CGFloat,
                            font: UIFont, lineHeight: CGFloat) -> CFRange {
        let attributed = attributedString(of: text as String, font: font, lineHeight: lineHeight)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let path = CGPath(rect: CGRect(x: 0, y: 0, width: width, height: height), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
        let visible = CTFrameGetVisibleStringRange(frame)
        return visible
    }

    static func measuredHeight(of text: NSString, width: CGFloat, font: UIFont, lineHeight: CGFloat) -> CGFloat {
        let attributed = attributedString(of: text as String, font: font, lineHeight: lineHeight)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let size = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter, CFRange(location: 0, length: text.length),
            nil, CGSize(width: width, height: .greatestFiniteMagnitude), nil)
        return ceil(size.height)
    }

    static func attributedString(of text: String, font: UIFont, lineHeight: CGFloat) -> CFAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = max(0, (font.lineHeight * lineHeight) - font.lineHeight)
        let attr: [NSAttributedString.Key: Any] = [
            .font: font,
            .paragraphStyle: paragraph,
            .foregroundColor: UIColor.label,
        ]
        return NSAttributedString(string: text, attributes: attr) as CFAttributedString
    }

    static func imageDisplayHeight(token: NovelInlineImages.ImageToken, pageWidth: CGFloat) -> CGFloat {
        guard token.width > 0, token.height > 0 else { return 120 }
        let scaled = CGFloat(token.height) * (pageWidth / CGFloat(token.width))
        return min(ceil(scaled), pageWidth * 1.6)
    }
}

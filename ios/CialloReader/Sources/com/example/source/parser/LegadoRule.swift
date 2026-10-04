// 对齐 novel-reader/app/src/main/java/com/example/source/parser/LegadoRule.kt（321 行）

import Foundation
import SwiftSoup

/**
 * Legado（开源阅读 3.0）书源规则解释器（HTML 子集）。
 *
 * 支持社区书源中最常用的语法：
 * - 默认规则段：class.xxx.0 / id.xxx.0 / tag.a.0 / text.关键词 / children
 *   - 位置：0 起正数、-1 倒数、!0:1 排除、留空取全部
 *   - 列表规则首字符 `-` 表示倒序
 * - CSS 规则：@css:.name@text（也兼容旧写法 .name@text / img@src）
 * - 连接符：|| 取第一个有值的规则；&& 合并所有取值
 * - 内容关键字：text / ownText / textNodes / html / all / href / src / 任意属性
 * - 正则替换：规则##正则##替换（替换为空时第二个 ## 可省略）
 *
 * 不支持（会返回空并提示）：@js: 脚本、webView、嗅探 sourceRegex。
 *
 * Kotlin 的 require/Regex 异常在 Swift 以 throws 表达；Jsoup → SwiftSoup
 *（attr/ownText/html/outerHtml/text/select/getElementsByTag/getAllElements 全 throws）。
 */
enum LegadoRule {
    /// 兼容别名（JsonBookSource 调用点）
    static func getString(_ el: Element, _ rule: String) -> String? {
        getStringFromElement(el, rule)
    }
    static func getStringFromElement(_ el: Element, _ rule: String) -> String? {
        extractContent(el, rule)
    }

    private static let segmentTypes: Set<String> = ["class", "id", "tag", "text", "children", "all"]
    private static let contentKeywords: Set<String> = ["text", "textNodes", "ownText", "html", "all"]
    private static let commonTags: Set<String> = [
        "a", "li", "img", "div", "p", "span", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
        "dl", "dd", "dt", "table", "tr", "td", "th", "section", "article", "nav", "button",
        "em", "b", "i", "strong", "figure", "figcaption", "mip-img", "mip-link", "amp-img"
    ]

    private static let cssIndexStripRegex = try! NSRegularExpression(pattern: #"\.(\d+)(?=[\s.#:\[]|$)"#)
    private static let whitespaceRegex = try! NSRegularExpression(pattern: #"\s+"#)
    private static let tagShorthandRegex = try! NSRegularExpression(pattern: #"^-?\d+.*$"#)

    // MARK: - Kotlin substringBefore / substringAfter 对应物

    private static func substringBefore(_ s: String, _ delimiter: Character) -> String {
        if let idx = s.firstIndex(of: delimiter) {
            return String(s[s.startIndex..<idx])
        }
        return s
    }

    private static func substringAfter(_ s: String, _ delimiter: String) -> String {
        guard let range = s.range(of: delimiter) else { return "" }
        return String(s[range.upperBound...])
    }

    /// 判断规则是否面向 JSON（JSONPath），而非 HTML 元素。
    static func isJsonRule(_ rawRule: String) -> Bool {
        let r = rawRule.trimmingCharacters(in: .whitespaces)
        return r.hasPrefix("$") || r.hasPrefix("@json:") || r.hasPrefix("@js:")
    }

    /// 去除 @json: / $ 前缀，得到可交给 JsonPathResolver 的路径。
    static func cleanJsonPath(_ rawRule: String) -> String {
        var r = rawRule.trimmingCharacters(in: .whitespaces)
        if r.hasPrefix("@json:") { r = String(r.dropFirst("@json:".count)).trimmingCharacters(in: .whitespaces) }
        if r.hasPrefix("$") {
            var rest = Substring(r.dropFirst())
            while rest.first == "." { rest = rest.dropFirst() }
            r = String(rest)
        }
        return r
    }

    // MARK: - 元素列表

    /** 按列表规则选取元素。支持 - 倒序、|| 回退、&& 合并。 */
    static func selectElements(_ root: Element, _ rawRule: String) throws -> [Element] {
        try RuleBudget.validate(rawRule)
        var rule = rawRule.trimmingCharacters(in: .whitespaces)
        if rule.isBlank { return [] }
        var reverse = false
        if rule.hasPrefix("-") && rule.count > 1 {
            reverse = true
            rule = String(rule.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        let branches = rule.split(separator: "||").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isBlank }
        for branch in branches {
            let elements = try selectBranchElements(root, branch)
            if !elements.isEmpty {
                return reverse ? elements.reversed() : elements
            }
        }
        return []
    }

    /** 求值规则，返回全部匹配值（用于 && 合并 / 列表值）。 */
    static func evalValues(_ root: Element, _ rawRule: String) throws -> [String] {
        try RuleBudget.validate(rawRule)
        var rule = rawRule.trimmingCharacters(in: .whitespaces)
        if rule.isBlank { return [] }
        if isJsonRule(rule) { return [] }
        if rule.hasPrefix("@js:") || rule.contains("{{") || rule.contains("{$") { return [] }

        let regexInfo = splitRegexReplacement(rule)
        let baseRule = regexInfo?.base ?? rule

        let orBranches = baseRule.split(separator: "||").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isBlank }
        for branch in orBranches {
            let values = try evalBranchValues(root, branch)
            if !values.isEmpty {
                return values
                    .map { applyRegexReplacement($0, regexInfo?.replacement) }
                    .filter { !$0.isBlank }
            }
        }
        return []
    }

    /** 取第一个非空值，多数字段规则使用。 */
    static func evalFirst(_ root: Element, _ rawRule: String) throws -> String? {
        try evalValues(root, rawRule).first
    }

    private static func evalBranchValues(_ root: Element, _ rule: String) throws -> [String] {
        let andParts = rule.split(separator: "&&").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isBlank }
        if andParts.count <= 1 { return try evalSingleValue(root, rule) }
        var merged: [String] = []
        for part in andParts {
            merged.append(contentsOf: try evalSingleValue(root, part))
        }
        return merged
    }

    private static func evalSingleValue(_ root: Element, _ rule: String) throws -> [String] {
        let r = rule.trimmingCharacters(in: .whitespaces)
        if r.isBlank { return [] }
        if r.hasPrefix("@css:") {
            return evalCssValue(root, String(r.dropFirst("@css:".count)).trimmingCharacters(in: .whitespaces))
        }
        // 内容直取：@text / @href / @src 表示对当前元素取内容
        if r.hasPrefix("@") && !r.hasPrefix("@css:") {
            if let v = extractContent(root, String(r.dropFirst())) { return [v] }
            return []
        }

        let firstSegment = substringBefore(r, "@").trimmingCharacters(in: .whitespaces)
        if looksLikeLegadoSegments(firstSegment) {
            return try evalLegadoSegments(root, r)
        }

        // 旧格式兼容：css@attr
        let atIndex = r.firstIndex(of: "@")
        let css = (atIndex.map { String(r[r.startIndex..<$0]) } ?? r).trimmingCharacters(in: .whitespaces)
        let attr = (atIndex.map { String(r[r.index(after: $0)...]) } ?? "text").trimmingCharacters(in: .whitespaces)
        var el: Element? = css.isBlank ? root : (try? root.select(css).first()) ?? nil
        // Legado 索引写法混在 CSS 里（如 ".newrap a.0"）：把 a.0 的 .N 当索引去掉重试
        if el == nil, css.range(of: #"\.\d+"#, options: .regularExpression) != nil {
            let nsCss = css as NSString
            let normalized = cssIndexStripRegex
                .stringByReplacingMatches(in: css, options: [],
                                          range: NSRange(location: 0, length: nsCss.length),
                                          withTemplate: "")
                .trimmingCharacters(in: .whitespaces)
            if !normalized.isBlank && normalized != css {
                el = (try? root.select(normalized).first()) ?? nil
            }
        }
        guard let target = el else { return [] }
        if let v = extractContent(target, attr) { return [v] }
        return []
    }

    private static func evalCssValue(_ root: Element, _ cssRule: String) -> [String] {
        let atIndex = cssRule.firstIndex(of: "@")
        let css = (atIndex.map { String(cssRule[cssRule.startIndex..<$0]) } ?? cssRule).trimmingCharacters(in: .whitespaces)
        let attr = (atIndex.map { String(cssRule[cssRule.index(after: $0)...]) } ?? "text").trimmingCharacters(in: .whitespaces)
        if css.isBlank { return [] }
        guard let selected = try? root.select(css) else { return [] }
        return selected.array().compactMap { extractContent($0, attr) }
    }

    private static func evalLegadoSegments(_ root: Element, _ rule: String) throws -> [String] {
        let segments = rule.split(separator: "@").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isBlank }
        if segments.isEmpty { return [] }

        var current: [Element] = [root]
        var content = "text"

        for (index, seg) in segments.enumerated() {
            let isLast = index == segments.count - 1
            if isLast && isContentSegment(seg) {
                content = seg
                break
            }
            current = try applySegment(current, seg)
            if current.isEmpty { return [] }
            if isLast { content = "text" }
        }
        return current.compactMap { extractContent($0, content) }
    }

    private static func isContentSegment(_ seg: String) -> Bool {
        let s = seg.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix(".") || s.hasPrefix("#") { return false }
        let first = substringBefore(s, ".").lowercased()
        return contentKeywords.contains(first) || (!segmentTypes.contains(first) && !commonTags.contains(first))
    }

    private static func applySegment(_ current: [Element], _ seg: String) throws -> [Element] {
        var s = seg.trimmingCharacters(in: .whitespaces)
        // .row.2 / .row!0 / .itemBox 等 CSS 类名写法统一按 class 段处理
        if s.hasPrefix(".") && !s.contains(" ") {
            s = "class" + s
        }
        let parts = s.split(separator: ".").map(String.init).filter { !$0.isBlank }
        if parts.isEmpty { return [] }
        let type = parts[0].lowercased()
        var name = parts.count > 1 ? parts[1] : ""
        var position = parts.count > 2 ? parts[2] : ""
        // Legado 简写：a.0 / img / button.0 -> tag.a.0 / tag.img / tag.button.0
        if !segmentTypes.contains(type) && commonTags.contains(type) {
            let tagName = parts[0]
            let tagPosition = parts.count > 1 ? parts[1] : ""
            var all: [Element] = []
            for el in current {
                all.append(contentsOf: (try? el.getElementsByTag(tagName))?.array() ?? [])
            }
            return applyPosition(all, tagPosition)
        }
        // class.a b 多类名写法：class.view-main-1 readForm -> CSS .view-main-1.readForm
        if type == "class" && name.contains(" ") {
            let classes = name.split(separator: " ").map(String.init).filter { !$0.isBlank }
            let css = classes.map { ".\($0)" }.joined()
            var all: [Element] = []
            for el in current {
                all.append(contentsOf: (try? el.select(css))?.array() ?? [])
            }
            return applyPosition(all, position)
        }
        // class.item!0 写法：排除位置直接跟在名称后
        if parts.count == 2 && name.contains("!") {
            let bang = name.firstIndex(of: "!")
            if let bang {
                position = String(name[bang...])
                name = String(name[name.startIndex..<bang])
            }
        }

        var selected: [Element] = []
        switch type {
        case "class":
            for el in current {
                selected.append(contentsOf: (try? el.getElementsByClass(name))?.array() ?? [])
            }
        // CSS 类名直接写法：.row.2 / .row!0 / .itemBox
        case "id":
            for el in current {
                if let found = (try? el.getElementById(name)) ?? nil {
                    selected.append(found)
                }
            }
        case "tag":
            for el in current {
                selected.append(contentsOf: (try? el.getElementsByTag(name))?.array() ?? [])
            }
        case "text":
            for el in current {
                if let allEls = try? el.getAllElements() {
                    for sub in allEls.array() {
                        if let own = try? sub.ownText(), own.contains(name) {
                            selected.append(sub)
                        }
                    }
                }
            }
        case "children":
            for el in current {
                selected.append(contentsOf: el.children().array())
            }
        case "all":
            for el in current {
                selected.append(contentsOf: (try? el.getAllElements())?.array() ?? [])
            }
        default:
            return []
        }
        return applyPosition(selected, position)
    }

    private static func applyPosition(_ elements: [Element], _ position: String) -> [Element] {
        if elements.isEmpty || position.isBlank { return elements }
        if position.hasPrefix("!") {
            let excludedBody = String(position.dropFirst())
            var excluded = Set<Int>()
            for part in excludedBody.split(separator: ":") {
                if let i = Int(part.trimmingCharacters(in: .whitespaces)) {
                    excluded.insert(i < 0 ? elements.count + i : i)
                }
            }
            return elements.enumerated().filter { !excluded.contains($0.offset) }.map { $0.element }
        }
        guard let index = Int(position) else { return elements }
        let realIndex = index < 0 ? elements.count + index : index
        if realIndex < 0 || realIndex >= elements.count { return [] }
        return [elements[realIndex]]
    }

    private static func selectBranchElements(_ root: Element, _ rule: String) throws -> [Element] {
        let r = rule.trimmingCharacters(in: .whitespaces)
        if r.hasPrefix("@css:") {
            var css = String(r.dropFirst("@css:".count)).trimmingCharacters(in: .whitespaces)
            css = substringBefore(css, "@")
            if css.isBlank { return [] }
            return (try? root.select(css))?.array() ?? []
        }
        let firstSegment = substringBefore(r, "@").trimmingCharacters(in: .whitespaces)
        if looksLikeLegadoSegments(firstSegment) {
            let segments = r.split(separator: "@").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isBlank }
            var current: [Element] = [root]
            for seg in segments {
                if isContentSegment(seg) { break }
                current = try applySegment(current, seg)
                if current.isEmpty { return [] }
            }
            return current
        }
        // 旧格式兼容：纯 CSS 列表
        let css = substringBefore(r, "@").trimmingCharacters(in: .whitespaces)
        if css.isBlank { return [] }
        return (try? root.select(css))?.array() ?? []
    }

    private static func looksLikeLegadoSegments(_ firstSegment: String) -> Bool {
        if firstSegment == "children" || firstSegment.hasPrefix("children.") { return true }
        // .row.2 / .row!0 / .itemBox 按 class 段处理
        if firstSegment.hasPrefix(".") {
            let after = String(firstSegment.dropFirst())
            return !after.isEmpty && !after.contains(" ")
        }
        let type = substringBefore(firstSegment, ".").lowercased()
        if segmentTypes.contains(type) && firstSegment.contains(".") { return true }
        // Legado 简写：a.0 / img / button.0 等常见标签
        if commonTags.contains(type) {
            let rest = substringAfter(firstSegment, ".")
            // 仅当第二段是位置（数字/!排除）或整体是单标签时按 tag 处理
            return rest.isEmpty
                || tagShorthandRegex.firstMatch(in: rest, options: [], range: NSRange(location: 0, length: (rest as NSString).length)) != nil
                || rest.hasPrefix("!")
        }
        return false
    }

    private static func extractContent(_ element: Element, _ content: String) -> String? {
        let c = content.trimmingCharacters(in: .whitespaces)
        var value = ""
        switch c.lowercased() {
        case "text":
            value = (try? element.text()) ?? ""
        case "owntext":
            value = (try? element.ownText()) ?? ""
        case "textnodes":
            // SwiftSoup textNodes() 返回 [TextNode]（无 .array()）
            let nodes = (try? element.textNodes()) ?? []
            value = nodes.map { (try? $0.text()) ?? "" }.joined(separator: "\n")
        case "html":
            value = (try? element.html()) ?? ""
        case "all":
            value = (try? element.outerHtml()) ?? ""
        default:
            value = (try? element.attr(c)) ?? ""
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines).ifBlankNil
    }

    // MARK: - 正则替换（##regex##replacement）

    private struct RegexReplacement {
        var regex: String
        var replacement: String
    }

    private struct SplitResult {
        var base: String
        var replacement: RegexReplacement?
    }

    private static func splitRegexReplacement(_ rule: String) -> SplitResult? {
        guard rule.contains("##") else { return nil }
        let parts = rule.components(separatedBy: "##")
        if parts.count == 2 {
            return SplitResult(base: parts[0].trimmingCharacters(in: .whitespaces),
                               replacement: RegexReplacement(regex: parts[1], replacement: ""))
        }
        let base = parts[0].trimmingCharacters(in: .whitespaces)
        let regex = parts[1]
        let replacement = parts.dropFirst(2).joined(separator: "##")
        return SplitResult(base: base, replacement: RegexReplacement(regex: regex, replacement: replacement))
    }

    private static func applyRegexReplacement(_ value: String, _ info: RegexReplacement?) -> String {
        guard let info else { return value }
        // Kotlin: Regex(info.regex).replace(RuleBudget.text(value), info.replacement)
        guard let regex = try? NSRegularExpression(pattern: info.regex) else { return value }
        let ns = value as NSString
        return regex.stringByReplacingMatches(
            in: value, options: [], range: NSRange(location: 0, length: ns.length),
            withTemplate: info.replacement)
    }

    // MARK: - 便捷方法

    /** 便捷方法：在 Document 上按规则取第一个值。 */
    static func evalFirstOnDocument(_ doc: Document, _ rawRule: String) throws -> String? {
        try evalFirst(doc, rawRule)
    }

    /** 便捷方法：在 Document 上选取列表元素。 */
    static func selectElementsOnDocument(_ doc: Document, _ rawRule: String) throws -> [Element] {
        try selectElements(doc, rawRule)
    }
}

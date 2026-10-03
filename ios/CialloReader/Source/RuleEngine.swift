import Foundation
import SwiftSoup

// MARK: - JSONPath 子集解释器（source/parser/JsonPathResolver.kt 镜像）
// 支持：$.a.b、$..books（递归下降）、books[] / books[*]（数组通配）、items[0]（下标）、@json: 前缀。

enum JsonPathResolver {
    static func parseJson(_ text: String) -> Any? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    /// 主入口：从 JSON 根取任意路径值
    static func resolve(_ root: Any, _ path: String) -> Any? {
        var p = path.trimmingCharacters(in: .whitespaces)
        if p.hasPrefix("@json:") {
            let inner = String(p.dropFirst("@json:".count))
            if let parsed = parseJson(stringValue(of: resolve(root, inner)) ?? "") {
                return parsed
            }
            return nil
        }
        if p == "$" || p.isEmpty { return root }
        if p.hasPrefix("$.") { p = String(p.dropFirst(2)) }
        else if p.hasPrefix("$") { p = String(p.dropFirst(1)) }

        var current = [root]
        var segments = tokenize(p)
        // `$..books`：tokenize 后第一个是 "..books"
        for seg in segments {
            var next: [Any] = []
            for node in current {
                next.append(contentsOf: apply(node, seg))
            }
            current = next
            if current.isEmpty { return nil }
        }
        return current.first
    }

    static func resolveArray(_ root: Any, _ path: String) -> [Any] {
        if let v = resolve(root, path) {
            if let arr = v as? [Any] { return arr }
            return [v]
        }
        // 递归下降兜底
        if path.hasPrefix("..") {
            let key = String(path.dropFirst(2))
            var out: [Any] = []
            collect(root, key: key, into: &out)
            return out
        }
        return []
    }

    static func getString(_ root: Any, _ path: String) -> String? {
        guard let v = resolve(root, path) else { return nil }
        return stringValue(of: v)
    }

    static func resolveStringArray(_ root: Any, _ path: String) -> [String] {
        resolveArray(root, path).compactMap { stringValue(of: $0) }
    }

    static func stringValue(of v: Any) -> String? {
        switch v {
        case let s as String: return s
        case let n as NSNumber: return n.stringValue
        case let b as Bool: return b ? "true" : "false"
        default:
            if let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]) {
                return String(data: d, encoding: .utf8)
            }
            return nil
        }
    }

    // MARK: 分词

    private static func tokenize(_ path: String) -> [String] {
        var tokens: [String] = []
        var buf = ""
        var i = path.startIndex
        var descending = false
        while i < path.endIndex {
            let c = path[i]
            if c == "." {
                if buf.isEmpty {
                    // 可能是 ".." 递归
                    let next = path.index(after: i)
                    if next < path.endIndex, path[next] == "." {
                        descending = true
                        i = path.index(after: next)
                        continue
                    }
                    i = path.index(after: i)
                    continue
                }
                tokens.append((descending ? ".." : "") + buf)
                buf = ""
                descending = false
            } else if c == "[" {
                if !buf.isEmpty { tokens.append((descending ? ".." : "") + buf); buf = ""; descending = false }
                // 收集 [ ... ]
                var inner = ""
                i = path.index(after: i)
                while i < path.endIndex, path[i] != "]" {
                    inner.append(path[i]); i = path.index(after: i)
                }
                tokens.append(inner.isEmpty ? "[]" : "[\(inner)]")
            } else {
                buf.append(c)
            }
            i = path.index(after: i)
        }
        if !buf.isEmpty { tokens.append((descending ? ".." : "") + buf) }
        return tokens
    }

    private static func apply(_ node: Any, _ token: String) -> [Any] {
        if token.hasPrefix("..") {
            let key = String(token.dropFirst(2))
            var out: [Any] = []
            collect(node, key: key, into: &out)
            return out
        }
        if token == "[]" { return node as? [Any] ?? [] }
        if token == "[*]" { return node as? [Any] ?? [] }
        if token.hasPrefix("[") && token.hasSuffix("]") {
            let inner = String(token.dropFirst().dropLast())
            if let idx = Int(inner) {
                let arr = node as? [Any] ?? []
                if idx < 0 {
                    let real = arr.count + idx
                    return arr.indices.contains(real) ? [arr[real]] : []
                }
                return arr.indices.contains(idx) ? [arr[idx]] : []
            }
            return []
        }
        // 普通键
        if let dict = node as? [String: Any] {
            if let v = dict[token] { return [v] }
            // 容错：大小写不敏感
            if let (k, v) = dict.first(where: { $0.key.lowercased() == token.lowercased() }) {
                _ = k
                return [v]
            }
        }
        return []
    }

    private static func collect(_ node: Any, key: String, into out: inout [Any]) {
        if let dict = node as? [String: Any] {
            if let v = dict[key] { out.append(v) }
            for (_, v) in dict { collect(v, key: key, into: &out) }
        } else if let arr = node as? [Any] {
            for v in arr { collect(v, key: key, into: &out) }
        }
    }
}

// MARK: - Legado（开源阅读 3.0）规则解释器（source/parser/LegadoRule.kt 镜像）
// 默认段 class.xxx.0 / id.xxx.0 / tag.a.0 / text.关键词 / children / all；
// 位置 0 起正数、-1 倒数、!0:1 排除、留空取全部；列表规则首字符 - 倒序；
// CSS @css:.name@text（兼容 .name@text / img@src）；|| 回退 / && 合并；##正则##替换。
// 明确不支持：@js:、webView、嗅探 sourceRegex。

enum LegadoRule {
    static func isJsonRule(_ rule: String) -> Bool {
        let r = cleanJsonPath(rule)
        return r.hasPrefix("$.") || r.hasPrefix("$..") || r == "$"
    }

    static func cleanJsonPath(_ rule: String) -> String {
        var r = rule.trimmingCharacters(in: .whitespaces)
        if r.lowercased().hasPrefix("@json:") { r = String(r.dropFirst(6)) }
        return r
    }

    // MARK: 元素列表

    static func getElements(_ root: Element, _ rule: String) -> [Element] {
        var r = rule.trimmingCharacters(in: .whitespaces)
        var reversed = false
        if r.hasPrefix("-") { reversed = true; r = String(r.dropFirst()) }
        guard !r.isEmpty, !r.contains("##") || true else { return [] }
        // ## 后缀对列表无意义，剥离
        let effective = r.split(separator: "##", maxSplits: 1).first.map(String.init) ?? r
        var elements = getElementsInternal(root, effective)
        if reversed { elements.reverse() }
        return elements
    }

    private static func getElementsInternal(_ root: Element, _ rule: String) -> [Element] {
        if rule.isEmpty { return [root] }
        if rule.lowercased().hasPrefix("@css:") {
            return (try? root.select(String(rule.dropFirst(5))))?.array() ?? []
        }
        // 顶段按 @ 切
        let segments = rule.components(separatedBy: "@")
        var current: [Element] = [root]
        for seg in segments {
            var next: [Element] = []
            for el in current {
                next.append(contentsOf: applySegmentForElements(el, seg))
            }
            current = next
            if current.isEmpty { return [] }
        }
        return current
    }

    private static func applySegmentForElements(_ el: Element, _ seg: String) -> [Element] {
        if seg.isEmpty { return [el] }
        if seg == "children" { return (try? el.children())?.array() ?? [] }
        if seg == "all" { return (try? el.getAllElements())?.array() ?? [] }
        // css 片段（以 . # [ 开头视为 CSS）
        if seg.hasPrefix(".") || seg.hasPrefix("#") || seg.contains(" ") {
            return (try? el.select(seg))?.array() ?? []
        }
        let parts = seg.components(separatedBy: ".")
        let kind = parts[0].lowercased()
        switch kind {
        case "class":
            guard parts.count >= 2 else { return [] }
            var sel = ".\(parts[1])"
            if parts.count > 2, let pos = parsePosition(parts[2]) {
                let all = (try? el.select(sel))?.array() ?? []
                return filter(all, by: pos)
            }
            return (try? el.select(sel))?.array() ?? []
        case "id":
            guard parts.count >= 2 else { return [] }
            if parts.count > 2, let pos = parsePosition(parts[2]) {
                let all = (try? el.select("#\(parts[1])"))?.array() ?? []
                return filter(all, by: pos)
            }
            return (try? el.select("#\(parts[1])"))?.array() ?? []
        case "tag":
            guard parts.count >= 2 else { return [] }
            let all = (try? el.getElementsByTag(parts[1]))?.array() ?? []
            if parts.count > 2, let pos = parsePosition(parts[2]) {
                return filter(all, by: pos)
            }
            return all
        case "text":
            guard parts.count >= 2 else { return [] }
            let keyword = parts[1]
            let all = (try? el.select("*"))?.array() ?? []
            return all.filter { ((try? $0.ownText()) ?? "").contains(keyword) }
        default:
            // 视作 CSS 选择器
            return (try? el.select(seg))?.array() ?? []
        }
    }

    // MARK: 字符串

    static func getString(_ root: Element, _ rule: String) -> String? {
        let r = rule.trimmingCharacters(in: .whitespaces)
        guard !r.isEmpty else { return nil }
        // || 回退取首个有值
        for branch in splitTop(r, by: "||") {
            let value = combine(root, branch)
            if !value.isEmpty { return applyRegex(value, suffix: regexSuffix(r)) }
        }
        return nil
    }

    static func getStringList(_ root: Element, _ rule: String) -> [String] {
        guard let first = splitTop(rule, by: "||").first else { return [] }
        let (effective, _) = stripRegex(first)
        var results: [String] = []
        for branch in splitTop(effective, by: "&&") {
            let value = combine(root, branch)
            if !value.isEmpty {
                results.append(applyRegex(value, suffix: regexSuffix(rule)))
            }
        }
        return results
    }

    private static func splitTop(_ rule: String, by sep: String) -> [String] {
        rule.components(separatedBy: sep)
    }

    private static func stripRegex(_ rule: String) -> (String, String?) {
        let parts = rule.components(separatedBy: "##")
        guard parts.count >= 2 else { return (rule, nil) }
        return (parts[0], parts[1...].joined(separator: "##"))
    }

    private static func regexSuffix(_ rule: String) -> String? {
        stripRegex(rule).1
    }

    private static func applyRegex(_ value: String, suffix: String?) -> String {
        guard let suffix, let sepRange = suffix.range(of: "##") else { return value }
        let pattern = String(suffix[suffix.startIndex..<sepRange.lowerBound])
        let replacement = String(suffix[sepRange.upperBound...])
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        let ns = value as NSString
        return regex.stringByReplacingMatches(in: value, options: [], range: NSRange(location: 0, length: ns.length), withTemplate: replacement)
    }

    private static func combine(_ root: Element, _ branch: String) -> String {
        let (effective, _) = stripRegex(branch)
        var outputs: [String] = []
        // && 合并：段内多值合并；实际按 @ 链逐步取
        let segments = effective.components(separatedBy: "@")
        var current: [Element] = [root]
        var isContent = false
        for seg in segments {
            if isContentKey(seg) {
                isContent = true
                for el in current {
                    outputs.append(content(of: el, key: seg))
                }
                continue
            }
            var next: [Element] = []
            for el in current {
                if seg.hasPrefix(".") || seg.hasPrefix("#") || seg.lowercased().hasPrefix("css:") {
                    let css = seg.lowercased().hasPrefix("css:") ? String(seg.dropFirst(4)) : seg
                    next.append(contentsOf: (try? el.select(css))?.array() ?? [])
                } else {
                    next.append(contentsOf: applySegmentForElements(el, seg))
                }
            }
            current = next
        }
        if !isContent, !current.isEmpty {
            outputs.append(current.first.flatMap { (try? $0.html()) } ?? "")
        }
        // && 语义：所有分支合并（这里 branch 内不拆，仅返回拼接）
        return outputs.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isContentKey(_ seg: String) -> Bool {
        ["text", "owntext", "textnodes", "html", "all", "href", "src", "textnode"].contains(seg.lowercased())
    }

    private static func content(of el: Element, key: String) -> String {
        switch key.lowercased() {
        case "text": return (try? el.text()) ?? ""
        case "owntext": return (try? el.ownText()) ?? ""
        case "textnodes", "textnode":
            let nodes = (try? el.textNodes()) ?? []
            return nodes.compactMap { (try? $0.text()) ?? "" }.joined(separator: " ")
        case "html": return (try? el.html()) ?? ""
        case "all": return (try? el.outerHtml()) ?? ""
        case "href": return (try? el.attr("href")) ?? ""
        case "src": return (try? el.attr("src")) ?? ""
        default: return (try? el.attr(key)) ?? ""
        }
    }

    // MARK: 位置语法

    enum Position {
        case index(Int)
        case all
        case exclude([Int])
    }

    static func parsePosition(_ s: String) -> Position? {
        if s.isEmpty { return .all }
        if s.hasPrefix("!") {
            let body = String(s.dropFirst())
            var indices: [Int] = []
            for part in body.split(separator: ":") {
                if let i = Int(part) { indices.append(i) }
            }
            return .exclude(indices)
        }
        if let i = Int(s) { return .index(i) }
        return nil
    }

    static func filter(_ elements: [Element], by pos: Position) -> [Element] {
        switch pos {
        case .all: return elements
        case .index(let i):
            if i < 0 {
                let real = elements.count + i
                return elements.indices.contains(real) ? [elements[real]] : []
            }
            return elements.indices.contains(i) ? [elements[i]] : []
        case .exclude(let indices):
            return elements.enumerated().filter { !indices.contains($0.offset) }.map { $0.element }
        }
    }
}

// MARK: - 规则执行预算（RuleBudget.kt 镜像：长度/深度限制 + deadline）

enum RuleBudget {
    static let maxRuleLength = 4096
    static let maxJsonLength = 4 * 1024 * 1024

    static func check(rule: String, json: String) throws {
        if rule.count > maxRuleLength { throw SourceException.parseError("规则过长") }
        if json.count > maxJsonLength { throw SourceException.parseError("响应过大") }
    }
}

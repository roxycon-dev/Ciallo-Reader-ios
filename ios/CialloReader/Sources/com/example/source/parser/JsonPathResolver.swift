// 对齐 novel-reader/app/src/main/java/com/example/source/parser/JsonPathResolver.kt（202 行）

import Foundation

/// Kotlin JSONObject / JSONArray → Swift [String: Any] / [Any]；JSONObject.NULL → NSNull。
/// Kotlin 的 require(...)（unchecked IllegalArgumentException）在 Swift 侧以 throws 表达，
/// 由 JsonBookSource / SourceImporter 等调用方的 catch 链兜住。
enum JsonPathResolver {

    /// iOS 骨架遗留入口（js/、zlibrary/ 引用）：解析任意 JSON 文本，失败返回 nil。
    /// Kotlin parseRoot 只接受 { 或 [ 开头；此入口额外容忍标量 fragments（供 JS 桥接）。
    static func parseJson(_ text: String) -> Any? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    // MARK: Kotlin parseRoot（仅对象/数组；带 RuleBudget.json 预算检查）

    private static func parseRoot(_ jsonStr: String) throws -> Any? {
        try RuleBudget.json(jsonStr)
        let trimmed = jsonStr.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("[") {
            return try? JSONSerialization.jsonObject(with: Data(trimmed.utf8), options: [.fragmentsAllowed])
        }
        if trimmed.hasPrefix("{") {
            return try? JSONSerialization.jsonObject(with: Data(trimmed.utf8), options: [.fragmentsAllowed])
        }
        return nil
    }

    /**
     * Resolves a JSON path string like "data.books"、"items" 或 "data.books[].info"
     * on a root JSON string/object/array. Supports wildcard array traversal "[]".
     */
    static func resolveArray(_ jsonStr: String, _ path: String) throws -> [[String: Any]] {
        if jsonStr.isBlank { return [] }
        guard let root = try parseRoot(jsonStr) else { return [] }
        let targets = try resolveAll([root], parseSegments(path))
        var resultList: [[String: Any]] = []

        for target in targets {
            if let arr = target as? [Any] {
                for item in arr {
                    if let obj = item as? [String: Any] {
                        resultList.append(obj)
                    }
                }
            } else if let obj = target as? [String: Any] {
                resultList.append(obj)
            }
        }
        return resultList
    }

    /**
     * Resolves a field value from a JSONObject given a field key or path
     * (e.g., "title"、"info.author" 或 "books[].name")，取第一个匹配值。
     */
    static func getString(_ jsonObject: [String: Any], _ path: String?) throws -> String? {
        guard let path, !path.isEmpty else { return nil }
        let targets = try resolveAll([jsonObject], parseSegments(path))
        for target in targets {
            if let s = scalarToString(target) {
                return s
            }
        }
        return nil
    }

    static func getLong(_ jsonObject: [String: Any], _ path: String?) throws -> Int64? {
        guard let str = try getString(jsonObject, path) else { return nil }
        return str.toLongOrNull()
    }

    /**
     * 从 JSON 字符串中按路径解析出一组字符串（用于漫画图片列表 / 章节 URL 等）。
     * 支持形如 $.data.images、data.images[*]、$..images 的路径。
     */
    static func resolveStringArray(_ jsonStr: String, _ path: String) throws -> [String] {
        if jsonStr.isBlank || path.isBlank { return [] }
        guard let root = try parseRoot(jsonStr) else { return [] }
        let targets = try resolveAll([root], parseSegments(path))
        var result: [String] = []
        for target in targets {
            if let arr = target as? [Any] {
                for v in arr {
                    if let s = scalarToString(v) { result.append(s) }
                }
            } else if let s = scalarToString(target) {
                result.append(s)
            }
        }
        // Kotlin: result.distinct()
        var seen = Set<String>()
        return result.filter { seen.insert($0).inserted }
    }

    /// Kotlin `target != JSONObject.NULL → target.toString()` 对应物
    private static func scalarToString(_ target: Any) -> String? {
        if target is NSNull { return nil }
        switch target {
        case let s as String:
            return s
        case let b as Bool:
            return b ? "true" : "false"
        case let n as NSNumber:
            return n.stringValue
        case let dict as [String: Any]:
            if let d = try? JSONSerialization.data(withJSONObject: dict, options: [.fragmentsAllowed]),
               let s = String(data: d, encoding: .utf8) { return s }
            return nil
        case let arr as [Any]:
            if let d = try? JSONSerialization.data(withJSONObject: arr, options: [.fragmentsAllowed]),
               let s = String(data: d, encoding: .utf8) { return s }
            return nil
        default:
            return String(describing: target)
        }
    }

    // MARK: 段解析

    private static func parseSegments(_ path: String) throws -> [String] {
        try RuleBudget.validate(path)
        var p = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isBlank || p == "$" { return [] }
        if p.hasPrefix("@json:") { p = String(p.dropFirst("@json:".count)).trimmingCharacters(in: .whitespaces) }
        if p.hasPrefix("$.") { p = String(p.dropFirst(2)) }
        else if p.hasPrefix("$") { p = String(p.dropFirst(1)) }
        // 递归下降：$..books -> **.books
        p = p.replacingOccurrences(of: "..", with: "**.")
        // 通配下标：books[*] -> books[]
        p = p.replacingOccurrences(of: "[*]", with: "[]")
        let segments = p.split(separator: ".").map(String.init).filter { !$0.isBlank }
        return mergeRecursiveMarkers(segments)
    }

    private static func mergeRecursiveMarkers(_ segments: [String]) -> [String] {
        // "**." 拆分后可能产生 ["**", "**"] 等，合并为单个 "**" 防止重复递归
        var merged: [String] = []
        for seg in segments {
            if seg == "**" && merged.last == "**" { continue }
            merged.append(seg)
        }
        return merged
    }

    // MARK: 路径求值

    private static func resolveAll(_ inputs: [Any], _ segments: [String]) throws -> [Any] {
        var current = inputs
        for segment in segments {
            current = try resolveSegmentAll(current, segment)
            if current.count > 10_000 {
                throw SourceException.parseError("JSONPath 结果过多")
            }
            if current.isEmpty { return [] }
        }
        return current
    }

    private static func resolveSegmentAll(_ inputs: [Any], _ segment: String) throws -> [Any] {
        var out: [Any] = []

        // 递归下降：返回所有嵌套值（对象、数组、标量）
        if segment == "**" {
            // Kotlin 用 BFS 队列 + 深度限制
            var pending: [(value: Any, depth: Int)] = inputs.map { ($0, 0) }
            var head = 0
            while head < pending.count {
                if out.count >= 10_000 {
                    throw SourceException.parseError("JSONPath 遍历节点过多")
                }
                let (value, depth) = pending[head]
                head += 1
                if depth > 64 {
                    throw SourceException.parseError("JSONPath 嵌套过深")
                }
                out.append(value)
                if let dict = value as? [String: Any] {
                    for key in dict.keys.sorted() {
                        if let v = dict[key], !(v is NSNull) {
                            pending.append((v, depth + 1))
                        }
                    }
                } else if let arr = value as? [Any] {
                    for v in arr where !(v is NSNull) {
                        pending.append((v, depth + 1))
                    }
                }
                if pending.count - head > 10_000 {
                    throw SourceException.parseError("JSONPath 遍历节点过多")
                }
            }
            return out
        }

        // 裸通配符："[]" —— 展开当前所有 JSONArray 的元素
        if segment == "[]" {
            for item in inputs {
                if let arr = item as? [Any] {
                    for value in arr where !(value is NSNull) {
                        out.append(value)
                    }
                }
            }
            return out
        }

        // 处理带下标的段："items[0]" 或 通配段："books[]"
        if let bracketIdx = segment.firstIndex(of: "["), segment.hasSuffix("]") {
            let key = String(segment[segment.startIndex..<bracketIdx])
            let indexStr = String(segment[segment.index(after: bracketIdx)..<segment.index(before: segment.endIndex)])

            // "books[]" 通配：取每个输入对象的 books 数组并展开
            if indexStr.isBlank {
                for item in inputs {
                    let arr: Any? = (!key.isEmpty && item is [String: Any])
                        ? (item as? [String: Any])?[key] : item
                    if let arr = arr as? [Any] {
                        for value in arr where !(value is NSNull) {
                            out.append(value)
                        }
                    }
                }
                return out
            }

            let index = Int(indexStr.trimmingCharacters(in: .whitespaces)) ?? -1
            for item in inputs {
                let arr: Any? = (!key.isEmpty && item is [String: Any])
                    ? (item as? [String: Any])?[key] : item
                if let arr = arr as? [Any], index >= 0, index < arr.count {
                    let value = arr[index]
                    if !(value is NSNull) {
                        out.append(value)
                    }
                }
            }
            return out
        }

        for item in inputs {
            if let dict = item as? [String: Any] {
                if let value = dict[segment], !(value is NSNull) {
                    out.append(value)
                }
            }
        }
        return out
    }
}

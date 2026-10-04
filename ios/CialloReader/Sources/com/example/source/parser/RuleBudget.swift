// 对齐 novel-reader/app/src/main/java/com/example/source/parser/RuleBudget.kt（32 行）

import Foundation

/// Regex runs on a deadline-aware CharSequence, including backtracking in java.util.regex.
enum RuleBudget {

    /// Kotlin: `fun validate(rule: String)` —— 长度 ≤ 4096，@/&/| 计数 ≤ 128
    static func validate(_ rule: String) throws {
        if rule.count > 4096 {
            throw SourceException.parseError("书源规则过长")
        }
        let special = rule.reduce(0) { count, ch in
            (ch == "@" || ch == "&" || ch == "|") ? count + 1 : count
        }
        if special > 128 {
            throw SourceException.parseError("书源规则嵌套过多")
        }
    }

    /// Kotlin: `fun json(value: String)` —— ≤ 2MiB，引号感知的嵌套深度 ≤ 64
    static func json(_ value: String) throws {
        if value.count > 2 * 1024 * 1024 {
            throw SourceException.parseError("JSON 超过 2MiB")
        }
        var depth = 0
        var quoted = false
        var escaped = false
        for ch in value {
            if quoted {
                if escaped {
                    escaped = false
                } else if ch == "\\" {
                    escaped = true
                } else if ch == "\"" {
                    quoted = false
                }
            } else {
                switch ch {
                case "\"":
                    quoted = true
                case "{", "[":
                    depth += 1
                    if depth > 64 {
                        throw SourceException.parseError("JSON 嵌套过深")
                    }
                case "}", "]":
                    depth -= 1
                default:
                    break
                }
            }
        }
    }

    /// Kotlin: `fun text(value: String, millis: Long = 1000): CharSequence` —— 返回
    /// deadline 感知的 CharSequence，每 256 次字符读取检查超时。
    /// Swift NSRegularExpression 无逐字符读取钩子，无法实现 deadline 探针；
    /// 这里保留长度限制（≤ 2MiB），回溯超时控制为遗留 TODO。
    static func text(_ value: String, millis: Int64 = 1000) throws -> String {
        if value.count > 2 * 1024 * 1024 {
            throw SourceException.parseError("规则输入超过 2MiB")
        }
        return value
    }
}

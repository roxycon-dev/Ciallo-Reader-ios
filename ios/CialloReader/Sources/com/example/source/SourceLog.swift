// 对齐 novel-reader/app/src/main/java/com/example/source/SourceLog.kt（38 行）

import Foundation

/**
 * 全局书源调试日志（内存环形缓冲，最多保留 MAX 条）。
 *
 * 书源每次请求（搜索/目录/正文）的 URL、方法、HTTP 状态、错误原因都会记录在这里，
 * 供「书源管理 → 调试日志」界面实时查看与一键复制，方便用户反馈问题。
 * （Kotlin 同时写入 logcat tag = SourceLog；iOS 无 logcat，仅保留内存环形缓冲。）
 */
enum SourceLog {

    private static let maxEntries = 300
    private static var entries: [String] = []
    private static let lock = NSLock()

    private static let urlRegex = try! NSRegularExpression(pattern: "https?://[^\\s]+")
    private static let sensitiveRegex = try! NSRegularExpression(
        pattern: "(?i)(cookie|authorization|password|userkey|api[_-]?key|token)\\s*[:=]\\s*[^\\s,;]+")
    private static let sensitiveProbeRegex = try! NSRegularExpression(
        pattern: "(?i)(cookie|authorization|password|userkey|api[_-]?key|token)\\s*[:=]")

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm:ss.SSS"
        // Kotlin Locale.CHINA 公历时间戳
        f.locale = Locale(identifier: "zh_CN")
        return f
    }()

    /// Kotlin `replace(Regex) { hit -> ... }` 对应物
    private static func replacing(_ text: String, with regex: NSRegularExpression,
                                  using transform: (String) -> String) -> String {
        let ns = text as NSString
        var out = ""
        var cursor = 0
        for m in regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            out += transform(ns.substring(with: m.range))
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length { out += ns.substring(from: cursor) }
        return out
    }

    static func log(_ source: String, _ message: String) {
        let msgNS = message as NSString
        // safe = message：URL → "scheme://host/…"（URI 解析失败兜底 "[URL]"），
        // 敏感键值 → "$1=[redacted]"（ICU 模板 $1 与 Kotlin 替换语义一致）
        var safe = replacing(message, with: urlRegex) { hit in
            if let u = URL(string: hit), let scheme = u.scheme, let host = u.host {
                return "\(scheme)://\(host)/…"
            }
            return "[URL]"
        }
        let safeNS = safe as NSString
        safe = sensitiveRegex.stringByReplacingMatches(
            in: safe, options: [], range: NSRange(location: 0, length: safeNS.length),
            withTemplate: "$1=[redacted]")
        // 原始消息里出现敏感键 → 整条隐藏
        let redacted: String
        if sensitiveProbeRegex.firstMatch(in: message, options: [],
                                          range: NSRange(location: 0, length: msgNS.length)) != nil {
            redacted = "[敏感信息已隐藏]"
        } else {
            redacted = safe
        }
        let line = "\(formatter.string(from: Date())) [\(source)] \(redacted)"
        lock.lock()
        entries.append(line)
        while entries.count > maxEntries { entries.removeFirst() }
        lock.unlock()
    }

    static func dump() -> String {
        lock.lock()
        defer { lock.unlock() }
        if entries.isEmpty {
            return "（暂无书源请求日志，请先执行一次搜索）"
        }
        return entries.joined(separator: "\n")
    }

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        entries.removeAll()
    }
}

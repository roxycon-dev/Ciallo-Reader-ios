// 对齐 novel-reader/app/src/main/java/com/example/source/SourceRegistration.kt（7 行）

import Foundation

/// Kotlin: `internal fun validRegistrationUrl(value: String?): String?`
/// Only web links may be passed from a source script to the system browser.
///（保留 enum SourceRegistration 外形：既有 iOS 骨架的命名空间承载方式）
enum SourceRegistration {
    static func validate(_ value: String?) -> String? {
        // trim → URL 解析 → 拒绝 URL 内嵌账号密码（user:pass@）→ 归一化输出
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: trimmed), comps.host != nil else { return nil }
        guard let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        if !(comps.user ?? "").isEmpty || !(comps.password ?? "").isEmpty { return nil }
        return comps.url?.absoluteString
    }
}

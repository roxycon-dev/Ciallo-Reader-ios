// 对齐 novel-reader/app/src/main/java/com/example/source/SearchBook.kt（22 行）

import Foundation

/// Kotlin @Immutable data class → Swift struct（Compose 不可变性由值语义保证）。
struct SearchBook: Identifiable, Hashable {
    var id: String
    var sourceId: String
    var title: String
    var author: String
    var cover: String? = nil
    var description: String? = nil
    var format: String = "epub"
    var language: String? = nil
    var comicId: String? = nil
    var size: Int64? = nil
    var downloadUrl: String? = nil
    /// eapi（bipinkrish 方案）书对象里的数字 id，用于多格式查询，仅 eapi 兜底搜索时填充。
    var eapiId: String? = nil
    /// eapi 书对象里的短 hash，用于多格式查询，仅 eapi 兜底搜索时填充。
    var eapiHash: String? = nil
    var novelInfo: NovelInfo? = nil
    var comicInfo: ComicInfo? = nil
}

// MARK: - Kotlin 风格 String 助手（全局扩展，仅定义一次）

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var ifBlankNil: String? { isBlank ? nil : self }
    var isNullOrBlank: Bool { isBlank }
    func takeIf(_ predicate: (String) -> Bool) -> String? { predicate(self) ? self : nil }
    func toLongOrNull() -> Int64? { Int64(trimmingCharacters(in: .whitespaces)) }
}

extension Optional where Wrapped == String {
    var nilIfEmpty: String? { flatMap { $0.isEmpty ? nil : $0 } }
    var isNullOrBlank: Bool { self?.isNullOrBlank ?? true }
}

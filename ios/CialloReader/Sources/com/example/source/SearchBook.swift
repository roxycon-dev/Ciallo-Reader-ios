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

// MARK: - 共享工具（原 SourceModels.swift 骨架遗留，zlibrary 等外部文件引用）


extension Optional where Wrapped == String {
    var nilIfEmpty: String? { flatMap { $0.isEmpty ? nil : $0 } }
}

/// Kotlin `isBlank` / `isNullOrBlank` / `ifBlank` / `takeIf` 风格助手（Legado 规则/书源逐行移植共用）
    func toLongOrNull() -> Int64? { Int64(trimmingCharacters(in: .whitespaces)) }
    /// Kotlin `takeIf { cond }` 对应物（条件成立返回自身）
    func takeIf(_ predicate: (String) -> Bool) -> String? { predicate(self) ? self : nil }
}

    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var ifBlankNil: String? { isBlank ? nil : self }
    var isNullOrBlank: Bool { isBlank }
    func takeIf(_ predicate: (String) -> Bool) -> String? { predicate(self) ? self : nil }
}

extension Optional where Wrapped == String {
    var nilIfEmpty: String? { flatMap { $0.isEmpty ? nil : $0 } }
}

// 对齐 novel-reader/app/src/main/java/com/example/source/BookFormat.kt（21 行）

import Foundation

/**
 * 一本书的某个可下载格式。
 *
 * `downloadUrl` 非空表示该格式已有可直接下载的链接
 * （eapi 的 downloadLink 或 HTML 详情页 /dl/ 直链）。
 */
struct BookFormat: Identifiable, Hashable {
    var format: String
    var downloadUrl: String? = nil
    var size: Int64? = nil
    var sizeText: String? = nil
    /// eapi 格式变体自己的数字 id（下载该格式时需要）。
    var eapiId: String? = nil
    /// eapi 格式变体自己的短 hash（下载该格式时需要）。
    var eapiHash: String? = nil

    /// iOS 侧补充（skeleton 沿用）：SwiftUI ForEach 需要 Identifiable
    var id: String { format + (downloadUrl ?? "") }
}

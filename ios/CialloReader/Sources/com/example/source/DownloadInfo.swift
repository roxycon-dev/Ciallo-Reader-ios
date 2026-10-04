// 对齐 novel-reader/app/src/main/java/com/example/source/DownloadInfo.kt（13 行）

import Foundation

struct DownloadInfo {
    var url: String
    var fileName: String
    var format: String = "epub"
    var size: Int64? = nil
    var headers: [String: String] = [:]
    var referer: String? = nil
}

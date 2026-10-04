// 对齐 novel-reader/app/src/main/java/com/example/source/SourceCapabilities.kt（24 行）

import Foundation

struct SourceCapabilities {
    var supportSearch: Bool = true
    var supportDownload: Bool = true
    var searchRequiresLogin: Bool = false
    var downloadRequiresLogin: Bool = false
    var supportDebug: Bool = false
    var supportImport: Bool = false
    var supportComic: Bool = false
    /// 支持章节式在线文字阅读（Legado 网文源：htmlChapters + 文本正文规则）
    var supportOnlineText: Bool = false
    var environmentOnly: Bool = false
    /// 提供小说电子书文件，可整本下载后进入本地文字阅读器。
    var supportEbook: Bool = false

    var requiresLogin: Bool { downloadRequiresLogin }
}

// Kotlin 的 isNovelSource / isComicSource 是 BookSource 扩展（含 id == "zlibrary" 特判）。
extension BookSource {
    /// 小说源（电子书/网文）：电子书下载源，或支持章节文字阅读的源。
    /// 与漫画源（capabilities.supportComic）互斥，用于书源分类展示与聚合搜索分组。
    var isNovelSource: Bool {
        id == "zlibrary" || (!capabilities.supportComic &&
            (capabilities.supportEbook || capabilities.supportOnlineText))
    }

    var isComicSource: Bool {
        capabilities.supportComic && !isNovelSource
    }
}

// iOS 兼容口径：既有 UI 直接读 source.capabilities.isComicSource / isNovelSource
//（无 id 特判），保留在 capabilities 层级以免外部引用破坏。
extension SourceCapabilities {
    var isNovelSource: Bool { !supportComic && (supportEbook || supportOnlineText) }
    var isComicSource: Bool { supportComic && !isNovelSource }
}

// 已废弃：原聚合内容按 Kotlin 拆分为 BookSource.swift / ComicSource.swift / SearchBook.swift /
// SourceCapabilities.swift / SourceResult.swift / SourceException.swift / BookFormat.swift /
// ComicChapter.swift / DownloadInfo.swift / AuthenticationState.swift / LoginCredential.swift /
// SourceRegistration.swift / SourceLog.swift / ComicInfo.swift / NovelInfo.swift。
// 本文件仅保留 iOS 辅助扩展（Kotlin 无对应）。

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension Optional where Wrapped == String {
    var nilIfEmpty: String? { flatMap { $0.isEmpty ? nil : $0 } }
}

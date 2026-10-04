// 对齐 novel-reader/app/src/main/java/com/example/source/NovelInfo.kt（33 行）

import Foundation

struct NovelInfo: Hashable {
    var synopsis: String? = nil
    var originalTitle: String? = nil
    var status: String? = nil
    var category: String? = nil
    var latestChapter: String? = nil
    var updatedAt: String? = nil
    var chapterCount: Int? = nil
    var volumeCount: Int? = nil
    var wordCount: String? = nil
    var publisher: String? = nil
    var tags: [String] = []
    var translation: String? = nil
    var notice: String? = nil

    var revision: String {
        [updatedAt ?? "", latestChapter ?? "",
         chapterCount.map { String($0) } ?? "",
         volumeCount.map { String($0) } ?? ""].joined(separator: "|")
    }

    var hasRevision: Bool {
        (updatedAt?.takeIf { !$0.isBlank }) != nil ||
            (latestChapter?.takeIf { !$0.isBlank }) != nil ||
            (chapterCount != nil) || (volumeCount != nil)
    }
}

/// Only these public whole-book sources opt into novel UI and update handling.
enum WholeBookNovelSources {
    static let ids: Set<String> = ["auto_novel", "wenku8_library", "ixdzs8"]
    static func contains(_ id: String?) -> Bool {
        guard let id else { return false }
        return ids.contains(id)
    }
}

protocol UpdatableNovelSource: BookSource {
    func refreshNovelDetail(bookId: String) async -> SourceResult<SearchBook>
}

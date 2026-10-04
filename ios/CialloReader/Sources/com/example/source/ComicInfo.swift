// 对齐 novel-reader/app/src/main/java/com/example/source/ComicInfo.kt（40 行）

import Foundation

/** Source-provided metadata. Missing fields stay missing; chapter totals come from the loaded catalog. */
/// 注：intro / chapterCount 为 iOS 骨架兼容字段（js/JsComicSource.swift 构造引用），
/// Kotlin 原字段为 alternateTitles / artists / tags / status / originalLanguage / updatedAt。
struct ComicInfo: Hashable {
    var alternateTitles: [String] = []
    var artists: [String] = []
    var intro: String? = nil
    var tags: [String]? = nil
    var chapterCount: Int? = nil
    var status: String? = nil
    var originalLanguage: String? = nil
    var updatedAt: String? = nil

    func mergedWith(fresh: ComicInfo) -> ComicInfo {
        var merged = self
        var titles = alternateTitles + fresh.alternateTitles
        var seen = Set<String>()
        titles = titles.filter { seen.insert($0).inserted }
        merged.alternateTitles = titles
        merged.artists = fresh.artists.isEmpty ? artists : fresh.artists
        merged.tags = (fresh.tags ?? []).isEmpty ? tags : fresh.tags
        merged.status = fresh.status ?? status
        merged.originalLanguage = fresh.originalLanguage ?? originalLanguage
        merged.updatedAt = fresh.updatedAt ?? updatedAt
        // iOS 兼容字段顺带合并（Kotlin 无此二字段）
        merged.intro = fresh.intro ?? intro
        merged.chapterCount = fresh.chapterCount ?? chapterCount
        return merged
    }
}

extension String {
    /// Kotlin: `fun String.isKnownComicAuthor(): Boolean`
    var isKnownComicAuthor: Bool {
        let unknown = ["", "null", "未知", "未知作者", "佚名", "unknown", "unknown author", "mangadex"]
        return !unknown.contains(trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
}

extension SearchBook {
    /// Kotlin: `fun SearchBook.withComicDetail(detail: SearchBook): SearchBook`
    /// Keep the selected source/id and useful search metadata when a source only returns a partial detail.
    func withComicDetail(_ detail: SearchBook) -> SearchBook {
        var out = self
        let keepTitle = (detail.comicInfo?.alternateTitles ?? []).contains(title)
        if !keepTitle, let dt = detail.title.takeIf({ !$0.isBlank }), dt != detail.id, dt != "未知书名" {
            out.title = dt
        }
        if detail.author.isKnownComicAuthor { out.author = detail.author }
        if let c = detail.cover.takeIf({ !$0.isBlank }) { out.cover = c }
        if let d = detail.description.takeIf({ !$0.isBlank }) { out.description = d }
        if let l = detail.language.takeIf({ !$0.isBlank }) { out.language = l }
        if let cid = detail.comicId { out.comicId = cid }
        switch (detail.comicInfo, comicInfo) {
        case (nil, _):
            break
        case (let fresh?, nil):
            out.comicInfo = fresh
        case (let fresh?, let old?):
            out.comicInfo = old.mergedWith(fresh: fresh)
        }
        return out
    }
}

extension Optional where Wrapped == String {
    /// Kotlin `takeIf { it.isNotBlank() }` 对应物
    func takeIfNotBlank() -> String? {
        flatMap { $0.isBlank ? nil : $0 }
    }
}

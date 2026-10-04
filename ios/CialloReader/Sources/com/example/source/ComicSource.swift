// 对齐 novel-reader/app/src/main/java/com/example/source/ComicSource.kt（36 行）

import Foundation

/**
 * A book source that can browse online comics chapter by chapter.
 */
/// Kotlin `interface ComicSource : BookSource` → Swift `ComicSourceProtocol`
///（历史命名保留：zlibrary/js/ui 多处引用，公共类型不得改名）。
protocol ComicSourceProtocol: BookSource {
    func getChapters(bookId: String) async -> SourceResult<[ComicChapter]>
    func getChapterImages(chapterId: String) async -> SourceResult<[String]>

    /** 章节式文字源：返回章节正文纯文本（段落以 \n\n 分隔）。图片源默认不支持。 */
    func getChapterText(chapterId: String) async -> SourceResult<String>

    /**
     * 每个图片 URL 对应的额外请求头（Referer/Cookie/签名等）。
     * 默认无；JS 源通过 onImageLoad 提供。
     */
    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]]

    /**
     * 懒加载解析：把源返回的“图片页 URL”解析成真实图片 URL（e-hentai 等），
     * 阅读器/下载器在真正加载某一页时按需调用并缓存。默认不支持。
     */
    func resolveChapterImage(url: String) async -> String?

    /** 懒加载解析后，真实图片 URL 需要的请求头。 */
    func getResolvedHeaders(url: String) async -> [String: String]

    /**
     * 封面图请求头（Referer/Cookie 等）。JS 源通过 onThumbnailLoad 提供。
     */
    func getCoverHeaders(url: String) async -> [String: String]
}

extension ComicSourceProtocol {
    func getChapterText(chapterId: String) async -> SourceResult<String> {
        .error(.parseError("该书源不支持文字章节"))
    }

    func getChapterImageHeaders(chapterId: String, urls: [String]) async -> [String: [String: String]] { [:] }
    func resolveChapterImage(url: String) async -> String? { nil }
    func getResolvedHeaders(url: String) async -> [String: String] { [:] }
    func getCoverHeaders(url: String) async -> [String: String] { [:] }
}

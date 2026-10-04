import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/ComicFavoriteMatching.kt（49 行）
//
// TODO: Kotlin 依赖 com.example.source.anilist.TitleNormalizer 与 com.example.source.isKnownComicAuthor
//       （source 包归别的代理）——下方以局部 shim 过渡，落地后替换。

struct DuplicateComicCandidate {
    let favorite: FavoriteEntity
    let reason: String
    let score: Double
}

struct FavoriteAddRequest {
    let book: SearchBook
    let category: String
    let chapters: [ComicChapter]
    let favorites: [FavoriteEntity]
    let candidates: [DuplicateComicCandidate]
    var busy: Bool = false
    var error: String? = nil
}

enum ComicFavoriteMatching {
    static func candidates(book: SearchBook, favorites: [FavoriteEntity], aliases: [String]) -> [DuplicateComicCandidate] {
        // Kotlin: listOf(book.title) + book.comicInfo?.alternateTitles.orEmpty() + aliases
        // iOS 侧 ComicInfo 暂无 alternateTitles 字段（TODO：source 包落地后接入）
        let titles = Set(([book.title] + aliases)
            .map { TitleNormalizerShim.compact($0) }
            .filter { usableTitle($0) })
        let author = isKnownComicAuthorShim(book.author) ? TitleNormalizerShim.compact(book.author) : nil
        return favorites.filter { $0.sourceId != book.sourceId }.compactMap { favorite in
            let title = TitleNormalizerShim.compact(favorite.title)
            if !usableTitle(title) { return nil }
            let sameAuthor = author != nil && isKnownComicAuthorShim(favorite.author)
                && TitleNormalizerShim.compact(favorite.author) == author
            let similarity = titles.map { dice($0, title) }.max() ?? 0.0
            if titles.contains(title) {
                return DuplicateComicCandidate(favorite: favorite, reason: "书名或已知别名相同", score: 1.0)
            }
            if title.count >= 4 && similarity >= 0.82 {
                return DuplicateComicCandidate(favorite: favorite,
                                               reason: sameAuthor ? "书名相似，作者相同" : "书名相似，请核对作品",
                                               score: similarity)
            }
            return nil
        }
        .sorted { $0.score > $1.score } // sortedByDescending { it.score }
    }

    private static func usableTitle(_ title: String) -> Bool {
        !title.isEmpty && !["未知书名", "未知", "unknown", "untitled"].contains(title)
    }

    private static func dice(_ a: String, _ b: String) -> Double {
        if a == b { return 1.0 }
        if a.count < 4 || b.count < 4 { return 0.0 }
        func bigrams(_ s: String) -> [String: Int] {
            var counts: [String: Int] = [:]
            let chars = Array(s)
            for i in 0..<(chars.count - 1) {
                let pair = String(chars[i...i + 1]) // Kotlin windowed(2)
                counts[pair, default: 0] += 1
            }
            return counts
        }
        let left = bigrams(a)
        let right = bigrams(b)
        let common = left.reduce(0) { acc, entry in
            acc + min(entry.value, right[entry.key] ?? 0)
        }
        return 2.0 * Double(common) / Double(a.count + b.count - 2)
    }

    // MARK: - iOS 侧 shim（TODO：source 包 isKnownComicAuthor 落地后替换）

    /// Kotlin isKnownComicAuthor：判“不是占位作者名”（未知/佚名/unknown 等）。
    private static func isKnownComicAuthorShim(_ author: String) -> Bool {
        let trimmed = author.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && !["未知", "未知作者", "佚名", "unknown", "anonymous"].contains(trimmed.lowercased())
    }
}

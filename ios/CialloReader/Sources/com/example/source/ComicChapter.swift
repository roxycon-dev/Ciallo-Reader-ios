// 对齐 novel-reader/app/src/main/java/com/example/source/ComicChapter.kt（13 行）

import Foundation

/**
 * A single chapter of an online comic source.
 */
struct ComicChapter: Identifiable, Hashable {
    var id: String
    var title: String
    var volume: String? = nil
    var order: Float = 0
    var external: Bool = false
    var externalUrl: String? = nil
}

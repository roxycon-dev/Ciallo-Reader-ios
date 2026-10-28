package parity

/**
 * Exact port of Android `ChapterMerger` + `LogicalChapterBook` + `Chapter` shape.
 *
 * Android sources:
 *   novel-reader/app/src/main/java/com/example/data/ChapterMerger.kt
 *   novel-reader/app/src/main/java/com/example/data/Book.kt (data class Chapter)
 *
 * Room annotations stripped; algorithm left untouched.
 */
data class Chapter(
    val id: Int = 0,
    val bookId: Int,
    val chapterOrder: Int,
    val title: String,
    val content: String,
    val startCharIndex: Long = 0,
    val endCharIndex: Long = 0,
)

data class LogicalChapterBook(
    val chapters: List<Chapter>,
    val physicalToLogical: IntArray,
    val physicalToLogicalOffset: IntArray,
    val logicalToPhysicalOrders: Array<IntArray>,
) {
    fun logicalIndexOf(physicalOrder: Int): Int =
        if (physicalOrder in physicalToLogical.indices) physicalToLogical[physicalOrder] else physicalOrder

    fun logicalOffsetOf(physicalOrder: Int, physicalOffset: Int): Int =
        if (physicalOrder in physicalToLogicalOffset.indices) {
            physicalToLogicalOffset[physicalOrder] + physicalOffset
        } else {
            physicalOffset
        }

    fun physicalIndexFor(logicalIndex: Int): Int {
        if (logicalIndex in logicalToPhysicalOrders.indices) {
            return logicalToPhysicalOrders[logicalIndex].firstOrNull() ?: logicalIndex
        }
        return logicalIndex
    }
}

object ChapterMergerPort {
    private val CONTINUATION_TITLE = Regex("""^(.+?)\s*\((?:续|续[0-9]+)\)\s*$""")

    fun cleanSplitTitle(title: String): String =
        CONTINUATION_TITLE.matchEntire(title.trim())?.groupValues?.get(1) ?: title

    fun buildLogicalChapters(physical: List<Chapter>): LogicalChapterBook {
        val byOrder = physical.associateBy { it.chapterOrder }
        val maxOrder = physical.maxOfOrNull { it.chapterOrder } ?: -1
        val physToLog = IntArray(maxOrder + 1) { it }
        val physOffset = IntArray(maxOrder + 1)
        val logToPhys = mutableListOf<IntArray>()
        val logical = mutableListOf<Chapter>()

        var parts = mutableListOf<Int>()
        var baseTitle: String? = null
        val buffer = StringBuilder()

        fun flush() {
            if (parts.isEmpty()) return
            val first = byOrder.getValue(parts.first())
            val last = byOrder.getValue(parts.last())
            logical.add(
                Chapter(
                    bookId = first.bookId,
                    chapterOrder = logical.size,
                    title = baseTitle ?: first.title,
                    content = buffer.toString(),
                    startCharIndex = first.startCharIndex,
                    endCharIndex = last.endCharIndex,
                )
            )
            logToPhys.add(parts.toIntArray())
            parts = mutableListOf()
            buffer.setLength(0)
            baseTitle = null
        }

        for (ch in physical) {
            val order = ch.chapterOrder
            val m = CONTINUATION_TITLE.matchEntire(ch.title.trim())
            val isContinuation = m != null && baseTitle == m.groupValues[1] && parts.isNotEmpty() && parts.size < 4
            if (isContinuation) {
                physOffset[order] = buffer.length
                buffer.append(ch.content)
                parts.add(order)
                physToLog[order] = logical.size
            } else {
                flush()
                baseTitle = cleanSplitTitle(ch.title.trim())
                buffer.append(ch.content)
                parts.add(order)
                physOffset[order] = 0
                physToLog[order] = logical.size
            }
        }
        flush()

        return LogicalChapterBook(logical, physToLog, physOffset, logToPhys.toTypedArray())
    }
}

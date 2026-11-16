package parity

/**
 * Exact port of Android `ComicParser.naturalOrderCompare`.
 *
 * Android source:
 *   novel-reader/app/src/main/java/com/example/data/ComicParser.kt
 */
object NaturalOrderPort {
    /** Numeric runs compare without overflow, regex allocation, or integer parsing. */
    fun naturalOrderCompare(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            if (a[i] in '0'..'9' && b[j] in '0'..'9') {
                val aStart = i
                val bStart = j
                while (i < a.length && a[i] in '0'..'9') i++
                while (j < b.length && b[j] in '0'..'9') j++
                var ai = aStart
                var bj = bStart
                while (ai < i && a[ai] == '0') ai++
                while (bj < j && b[bj] == '0') bj++
                val lengthOrder = (i - ai).compareTo(j - bj)
                if (lengthOrder != 0) return lengthOrder
                while (ai < i) {
                    val digitOrder = a[ai++].compareTo(b[bj++])
                    if (digitOrder != 0) return digitOrder
                }
            } else {
                val order = a[i++].lowercaseChar().compareTo(b[j++].lowercaseChar())
                if (order != 0) return order
            }
        }
        return (a.length - i).compareTo(b.length - j).takeIf { it != 0 } ?: a.compareTo(b)
    }
}

package parity

import java.io.File
import kotlin.system.exitProcess

/**
 * Standalone JVM fixture exporter.
 *
 * Reads nothing from the Android app at runtime — all algorithms are Kotlin
 * copies in this package (PinKdf / ChapterMergerPort / NaturalOrderPort).
 *
 * Writes JSON fixtures to IOS/parity/fixtures relative to this Gradle project:
 *   ../fixtures/pinKdf.generated.json
 *   ../fixtures/chapterMerger.generated.json
 *   ../fixtures/naturalOrder.generated.json
 *
 * Run: `gradle run` (JDK 17+) or `node run-export.mjs` from this directory.
 */
fun main() {
    val fixturesDir = File("../fixtures").canonicalFile
    fixturesDir.mkdirs()
    if (!fixturesDir.isDirectory) {
        System.err.println("Cannot create fixtures dir: $fixturesDir")
        exitProcess(1)
    }

    writePinKdfFixtures(fixturesDir)
    writeChapterMergerFixtures(fixturesDir)
    writeNaturalOrderFixtures(fixturesDir)

    println("Fixtures written to $fixturesDir")
}

// ---------------------------------------------------------------------------
// pinKdf.generated.json
// ---------------------------------------------------------------------------

data class PinKdfCase(
    val pin: String,
    val saltHex: String,
    val legacySha256: String,
    val pbkdf2: String,
)

fun writePinKdfFixtures(dir: File) {
    val cases = listOf(
        PinKdfCase(
            pin = "123456",
            saltHex = "11111111111111111111111111111111",
            legacySha256 = PinKdf.hashPin("123456", "11111111111111111111111111111111"),
            pbkdf2 = PinKdf.derivePin("123456", "11111111111111111111111111111111"),
        ),
        PinKdfCase(
            pin = "000000",
            saltHex = "22222222222222222222222222222222",
            legacySha256 = PinKdf.hashPin("000000", "22222222222222222222222222222222"),
            pbkdf2 = PinKdf.derivePin("000000", "22222222222222222222222222222222"),
        ),
        PinKdfCase(
            pin = "999999",
            saltHex = "00112233445566778899aabbccddeeff",
            legacySha256 = PinKdf.hashPin("999999", "00112233445566778899aabbccddeeff"),
            pbkdf2 = PinKdf.derivePin("999999", "00112233445566778899aabbccddeeff"),
        ),
        PinKdfCase(
            pin = "654321",
            saltHex = "abababababababababababababababab",
            legacySha256 = PinKdf.hashPin("654321", "abababababababababababababababab"),
            pbkdf2 = PinKdf.derivePin("654321", "abababababababababababababababab"),
        ),
    )

    val sb = StringBuilder()
    sb.append("{\n  \"cases\": [\n")
    cases.forEachIndexed { idx, c ->
        sb.append("    {")
        sb.append("\"pin\": ").append(jsonString(c.pin)).append(", ")
        sb.append("\"saltHex\": ").append(jsonString(c.saltHex)).append(", ")
        sb.append("\"legacySha256\": ").append(jsonString(c.legacySha256)).append(", ")
        sb.append("\"pbkdf2\": ").append(jsonString(c.pbkdf2))
        sb.append("}")
        if (idx < cases.size - 1) sb.append(",")
        sb.append("\n")
    }
    sb.append("  ]\n}\n")

    File(dir, "pinKdf.generated.json").writeText(sb.toString(), Charsets.UTF_8)
    println("  pinKdf.generated.json (${cases.size} cases)")
}

// ---------------------------------------------------------------------------
// chapterMerger.generated.json
// ---------------------------------------------------------------------------

data class ChapterMergerCase(
    val name: String,
    val input: List<Chapter>,
)

fun writeChapterMergerFixtures(dir: File) {
    val cases = listOf(
        ChapterMergerCase(
            name = "single-chapter",
            input = listOf(
                Chapter(bookId = 1, chapterOrder = 0, title = "第一章", content = "Hello",
                    startCharIndex = 0, endCharIndex = 5),
            ),
        ),
        ChapterMergerCase(
            name = "merge-continuation",
            input = listOf(
                Chapter(bookId = 1, chapterOrder = 0, title = "第一章", content = "A",
                    startCharIndex = 0, endCharIndex = 1),
                Chapter(bookId = 1, chapterOrder = 1, title = "第一章 (续)", content = "B",
                    startCharIndex = 1, endCharIndex = 2),
            ),
        ),
        ChapterMergerCase(
            name = "max-4-parts-then-new",
            input = listOf(
                Chapter(bookId = 1, chapterOrder = 0, title = "第二章", content = "A",
                    startCharIndex = 0, endCharIndex = 1),
                Chapter(bookId = 1, chapterOrder = 1, title = "第二章 (续)", content = "B",
                    startCharIndex = 1, endCharIndex = 2),
                Chapter(bookId = 1, chapterOrder = 2, title = "第二章 (续)", content = "C",
                    startCharIndex = 2, endCharIndex = 3),
                Chapter(bookId = 1, chapterOrder = 3, title = "第二章 (续)", content = "D",
                    startCharIndex = 3, endCharIndex = 4),
                Chapter(bookId = 1, chapterOrder = 4, title = "第二章 (续)", content = "E",
                    startCharIndex = 4, endCharIndex = 5),
            ),
        ),
        ChapterMergerCase(
            name = "title-cleanup-xu2",
            input = listOf(
                Chapter(bookId = 2, chapterOrder = 0, title = "第三章", content = "X",
                    startCharIndex = 0, endCharIndex = 1),
                Chapter(bookId = 2, chapterOrder = 1, title = "第三章 (续2)", content = "Y",
                    startCharIndex = 1, endCharIndex = 2),
            ),
        ),
        ChapterMergerCase(
            name = "no-merge-different-titles",
            input = listOf(
                Chapter(bookId = 1, chapterOrder = 0, title = "第一章", content = "A",
                    startCharIndex = 0, endCharIndex = 1),
                Chapter(bookId = 1, chapterOrder = 1, title = "第二章", content = "B",
                    startCharIndex = 1, endCharIndex = 2),
            ),
        ),
        ChapterMergerCase(
            name = "continuation-break-by-title-change",
            input = listOf(
                Chapter(bookId = 1, chapterOrder = 0, title = "第一章", content = "A",
                    startCharIndex = 0, endCharIndex = 1),
                Chapter(bookId = 1, chapterOrder = 1, title = "第一章 (续)", content = "B",
                    startCharIndex = 1, endCharIndex = 2),
                Chapter(bookId = 1, chapterOrder = 2, title = "第二章", content = "C",
                    startCharIndex = 2, endCharIndex = 3),
                Chapter(bookId = 1, chapterOrder = 3, title = "第二章 (续)", content = "D",
                    startCharIndex = 3, endCharIndex = 4),
            ),
        ),
    )

    val sb = StringBuilder()
    sb.append("{\n  \"cases\": [\n")
    cases.forEachIndexed { idx, c ->
        val book = ChapterMergerPort.buildLogicalChapters(c.input)
        sb.append("    {\n")
        sb.append("      \"name\": ").append(jsonString(c.name)).append(",\n")
        sb.append("      \"input\": ").append(chapterListJson(c.input)).append(",\n")
        sb.append("      \"logical\": ").append(chapterListJson(book.chapters)).append(",\n")
        sb.append("      \"physicalToLogical\": ").append(intArrayJson(book.physicalToLogical)).append(",\n")
        sb.append("      \"physicalToLogicalOffset\": ").append(intArrayJson(book.physicalToLogicalOffset)).append(",\n")
        sb.append("      \"logicalToPhysicalOrders\": ").append(intMatrixJson(book.logicalToPhysicalOrders)).append("\n")
        sb.append("    }")
        if (idx < cases.size - 1) sb.append(",")
        sb.append("\n")
    }
    sb.append("  ]\n}\n")

    File(dir, "chapterMerger.generated.json").writeText(sb.toString(), Charsets.UTF_8)
    println("  chapterMerger.generated.json (${cases.size} cases)")
}

// ---------------------------------------------------------------------------
// naturalOrder.generated.json
// ---------------------------------------------------------------------------

data class NaturalOrderPair(val a: String, val b: String, val cmp: Int)

fun writeNaturalOrderFixtures(dir: File) {
    val rawPairs = listOf(
        "page1" to "page2",
        "page2" to "page10",
        "page02" to "page2",
        "page" to "page",
        "ABC" to "abc",
        "a10" to "a9",
        "a9" to "a10",
        "第1章" to "第2章",
        "第10章" to "第2章",
        "" to "a",
        "01" to "1",
        "1" to "01",
        "page1a" to "page1b",
        "chapter_10" to "chapter_9",
        "chapter_9" to "chapter_10",
        "file2.txt" to "file10.txt",
        "100" to "99",
        "a" to "B",
        "book_002" to "book_010",
        "IMG_0001.jpg" to "IMG_0010.jpg",
    )
    val pairs = rawPairs.map { (a, b) ->
        NaturalOrderPair(a, b, NaturalOrderPort.naturalOrderCompare(a, b))
    }

    val sb = StringBuilder()
    sb.append("{\n  \"pairs\": [\n")
    pairs.forEachIndexed { idx, p ->
        sb.append("    {")
        sb.append("\"a\": ").append(jsonString(p.a)).append(", ")
        sb.append("\"b\": ").append(jsonString(p.b)).append(", ")
        sb.append("\"cmp\": ").append(p.cmp)
        sb.append("}")
        if (idx < pairs.size - 1) sb.append(",")
        sb.append("\n")
    }
    sb.append("  ]\n}\n")

    File(dir, "naturalOrder.generated.json").writeText(sb.toString(), Charsets.UTF_8)
    println("  naturalOrder.generated.json (${pairs.size} pairs)")
}

// ---------------------------------------------------------------------------
// Minimal JSON writers (kotlin-stdlib only)
// ---------------------------------------------------------------------------

private fun jsonString(s: String): String {
    val sb = StringBuilder("\"")
    for (ch in s) {
        when (ch) {
            '\\' -> sb.append("\\\\")
            '"' -> sb.append("\\\"")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> {
                if (ch.code < 0x20) {
                    sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                } else {
                    sb.append(ch)
                }
            }
        }
    }
    sb.append('"')
    return sb.toString()
}

private fun chapterJson(c: Chapter): String =
    "{" +
        "\"bookId\": " + c.bookId + ", " +
        "\"chapterOrder\": " + c.chapterOrder + ", " +
        "\"title\": " + jsonString(c.title) + ", " +
        "\"content\": " + jsonString(c.content) + ", " +
        "\"startCharIndex\": " + c.startCharIndex + ", " +
        "\"endCharIndex\": " + c.endCharIndex +
        "}"

private fun chapterListJson(chapters: List<Chapter>): String =
    chapters.joinToString(", ", prefix = "[", postfix = "]") { chapterJson(it) }

private fun intArrayJson(arr: IntArray): String =
    arr.joinToString(", ", prefix = "[", postfix = "]") { it.toString() }

private fun intMatrixJson(matrix: Array<IntArray>): String =
    matrix.joinToString(", ", prefix = "[", postfix = "]") { inner ->
        inner.joinToString(", ", prefix = "[", postfix = "]") { it.toString() }
    }

/**
 * Kotlin → TS: `source/zlibrary/parser/ZLibraryParserManager.kt`（**77 行 / 63 非空**）
 *             → `src/core/source/zlibrary/parser/zLibraryParserManager.ts`
 *
 * ⚠️ 本文件此前自述「67 lines, 53 non-blank」并据此写成，于是 L37-41 那**两条隐藏元素移除**
 * 整段缺失 —— 而它们是原文里唯一「在选 parser 之前清洗 DOM」的步骤（见 E213）。
 * 行映射也随之整体偏 10 行，本轮一并修正。
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser                    → SKIPPED (TS has no packages)
 *   L3        import android.util.Log                    → `import { SourceLog } from '../../sourceLog'`
 *   L4        import com.example.source.SearchBook       → type import from '../../searchBook'
 *   L5        import com.example.source.SourceException  → SKIPPED as an import (not referenced;
 *                                                          `ZLibraryAccessChecker` throws it)
 *   L6        import …zlibrary.ParsedBookDetail          → type import from '../parsedBookDetail'
 *   L7        import …zlibrary.ZLibraryAccessChecker     → value import from '../zLibraryAccessChecker'
 *   L8        import org.jsoup.Jsoup                     → `import { parseHtmlDocument } from './htmlDocument'`
 *   L9        import org.jsoup.nodes.Document             → type import from './htmlDocument'
 *   L11       object ZLibraryParserManager               → `export const ZLibraryParserManager`
 *   L13       private const val TAG = "ZLibraryParserManager" → `const TAG = 'ZLibraryParserManager'`
 *   L15-21    private val parsers list                    → module-level `PARSERS` const (same order)
 *   L23-27    fun detectLayoutName                       → verbatim
 *   L29-55    fun parseSearchPage                        → verbatim（含 L37-41 的两条隐藏元素移除
 *                                                          与 L50-53 的 GenericFallback 兜底）
 *   L57-67    fun parseDetailPage                        → verbatim
 *   L69-76    private fun fakeResponse(): okhttp3.Response → `fakeResponse(): AccessCheckerResponse`
 *   L77       closing brace                              → n/a
 *
 * Adaptations:
 *   - `Jsoup.parse(html)` → `parseHtmlDocument(html)`；`Element.remove()` → `HtmlElement.remove()`
 *     （本轮为 L37-41 新补，见 `htmlDocument.ts`）。
 *   - `parsers.firstOrNull { … }` → `PARSERS.find(…)`; `?: parsers.last()` → `?? PARSERS[PARSERS.length - 1]`.
 *   - `android.util.Log.i(TAG, …)` → `SourceLog.log(TAG, …)`.
 *   - `fakeResponse()` no longer builds a full OkHttp `Response`; it returns the structural
 *     `AccessCheckerResponse` (`code` + `header`), keeping the exact same values
 *     (200 / no headers / "OK"), because `ZLibraryAccessChecker.checkResponse` only reads those.
 *   - `selectedParser !is GenericFallbackParser` → `selectedParser.name !== 'GenericFallback'`。
 *     `GenericFallbackParser.name` 的 Kotlin 字面量就是 `"GenericFallback"`（该类 L15），
 *     而 `PARSERS` 里只有一个实例，所以身份比较与名字比较等价。
 */

import { SourceLog } from '../../sourceLog';
import type { SearchBook } from '../../searchBook';
import type { ParsedBookDetail } from '../parsedBookDetail';
import { ZLibraryAccessChecker, type AccessCheckerResponse } from '../zLibraryAccessChecker';
import { BookcardLayoutParser } from './bookcardLayoutParser';
import { DesktopLayoutParser } from './desktopLayoutParser';
import { GenericFallbackParser } from './genericFallbackParser';
import { LegacyLayoutParser } from './legacyLayoutParser';
import { MobileLayoutParser } from './mobileLayoutParser';
import { parseHtmlDocument, type HtmlDocument } from './htmlDocument';
import type { ZLibraryLayoutParser } from './zLibraryLayoutParser';

/** Kotlin `private const val TAG = "ZLibraryParserManager"`. */
const TAG = 'ZLibraryParserManager';

/** Kotlin `private val parsers: List<ZLibraryLayoutParser>` (L15-21), same order. */
const PARSERS: ZLibraryLayoutParser[] = [
  new BookcardLayoutParser(),
  new DesktopLayoutParser(),
  new MobileLayoutParser(),
  new LegacyLayoutParser(),
  new GenericFallbackParser(),
];

/** Kotlin `GenericFallbackParser()` — the fallback instance used at L52. */
const GENERIC_FALLBACK = new GenericFallbackParser();

/** Kotlin L15 `override val name: String = "GenericFallback"` —— L50 的身份比较用的就是它。 */
const GENERIC_FALLBACK_NAME = 'GenericFallback';

/**
 * Kotlin L39-40 的 style 判定正则，逐字：
 *
 * ```
 * Regex("(?:^|;)\\s*(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)\\s*(?:!important)?\\s*(?:;|$)",
 *     RegexOption.IGNORE_CASE)
 * ```
 *
 * 三处细节都有语义：
 * 1. **`(?:^|;)` 是必需的**：`xdisplay:none` 不算（前面必须是分号或开头），
 *    否则任何「值里恰好含 `display:none` 子串」的属性都会被误判；
 * 2. **`!important` 可选中**：`display: none !important` 也算隐藏；
 * 3. **`\s*` 允许冒号两侧的空格**（压缩过的 HTML 里常见）。
 */
export const HIDDEN_STYLE_PATTERN =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i;

/**
 * Kotlin L33-41 —— 在**选 parser 之前**把镜像站插入的隐藏 decoy 卡片摘掉。
 *
 * 原文注释（L33-36）：
 * 「Some mirrors insert an explicitly hidden bookcard reflecting the query, with a random
 * id/format and an empty download endpoint. It is not a visible search result. Remove hidden
 * subtrees before layout selection so the generic fallback cannot reintroduce the same decoy
 * via its /book/ link.」
 *
 * 两条移除的顺序与范围都不能动：
 * - 先 `[hidden], [aria-hidden=true]`（整棵子树）；
 * - 再 `[style]` 里命中原则的（只摘这些元素自己，子元素随它一起消失）。
 *
 * 少了这两步，`GenericFallbackParser` 会把 decoy 里的 `/book/` 链接当成一条真实结果捞回来 ——
 * 用户会看到一条「书名就是自己刚搜的关键词、下载地址为空」的假书。
 */
export function stripHiddenDecoys(doc: HtmlDocument): void {
  // L37 `doc.select("[hidden], [aria-hidden=true]").remove()`
  for (const element of doc.select('[hidden], [aria-hidden=true]')) element.remove();
  // L38-41 `doc.select("[style]").filter { … }.forEach { it.remove() }`
  for (const element of doc.select('[style]')) {
    if (HIDDEN_STYLE_PATTERN.test(element.attr('style'))) element.remove();
  }
}

export const ZLibraryParserManager = {
  detectLayoutName(html: string): string {
    const doc = parseHtmlDocument(html);
    const selectedParser = PARSERS.find((it) => it.canParseSearch(doc));
    return selectedParser?.name ?? 'Unknown / Default';
  },

  parseSearchPage(html: string, baseUrl: string, sourceId = 'zlibrary'): SearchBook[] {
    const doc = parseHtmlDocument(html);
    ZLibraryAccessChecker.checkResponse(fakeResponse(), doc);

    // L33-41 —— 隐藏 decoy 必须在选 parser 之前摘掉
    stripHiddenDecoys(doc);

    const selectedParser =
      PARSERS.find((it) => it.canParseSearch(doc)) ?? (PARSERS[PARSERS.length - 1] as ZLibraryLayoutParser);

    SourceLog.log(TAG, `Selected search parser: ${selectedParser.name}`);

    const results = selectedParser.parseSearch(doc, baseUrl, sourceId);
    SourceLog.log(TAG, `Parsed ${results.length} books using ${selectedParser.name}`);
    if (results.length === 0 && selectedParser.name !== GENERIC_FALLBACK_NAME) {
      SourceLog.log(TAG, 'Selected parser returned 0 books; falling back to GenericFallbackParser');
      return GENERIC_FALLBACK.parseSearch(doc, baseUrl, sourceId);
    }
    return results;
  },

  parseDetailPage(html: string, baseUrl: string): ParsedBookDetail {
    const doc = parseHtmlDocument(html);
    ZLibraryAccessChecker.checkResponse(fakeResponse(), doc);

    // L57-67 —— 详情页**没有** L37-41 的那两条移除（原文只在搜索页做）
    const selectedParser =
      PARSERS.find((it) => it.canParseDetail(doc)) ?? (PARSERS[PARSERS.length - 1] as ZLibraryLayoutParser);

    SourceLog.log(TAG, `Selected detail parser: ${selectedParser.name}`);

    return selectedParser.parseDetail(doc, baseUrl);
  },
};

/** Kotlin `private fun fakeResponse(): okhttp3.Response` (L69-76), same values. */
function fakeResponse(): AccessCheckerResponse {
  return {
    code: 200,
    header: () => null,
  };
}

/** Re-exported so callers can type a parsed document without importing the parser folder. */
export type { HtmlDocument };

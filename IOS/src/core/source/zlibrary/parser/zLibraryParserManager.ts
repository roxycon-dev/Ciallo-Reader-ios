/**
 * Kotlin → TS: `source/zlibrary/parser/ZLibraryParserManager.kt` (67 lines, 53 non-blank)
 *             → `src/core/source/zlibrary/parser/zLibraryParserManager.ts`
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
 *   L29-45    fun parseSearchPage                        → verbatim (fallback-to-GenericFallbackParser kept)
 *   L47-57    fun parseDetailPage                        → verbatim
 *   L59-66    private fun fakeResponse(): okhttp3.Response → `fakeResponse(): AccessCheckerResponse`
 *   L67       closing brace                              → n/a
 *
 * Adaptations:
 *   - `Jsoup.parse(html)` → `parseHtmlDocument(html)`.
 *   - `parsers.firstOrNull { … }` → `PARSERS.find(…)`; `?: parsers.last()` → `?? PARSERS[PARSERS.length - 1]`.
 *   - `android.util.Log.i(TAG, …)` → `SourceLog.log(TAG, …)`.
 *   - `fakeResponse()` no longer builds a full OkHttp `Response`; it returns the structural
 *     `AccessCheckerResponse` (`code` + `header`), keeping the exact same values
 *     (200 / no headers / "OK"), because `ZLibraryAccessChecker.checkResponse` only reads those.
 *   - `selectedParser !is GenericFallbackParser` → a new instance comparison is pointless in TS
 *     because the instance is now a shared singleton, so the identity check is done on `name`
 *     ('GenericFallback'), which is the same string the Kotlin `object` exposes.
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

/** Kotlin `GenericFallbackParser()` — the fallback instance used at L42. */
const GENERIC_FALLBACK = new GenericFallbackParser();

export const ZLibraryParserManager = {
  detectLayoutName(html: string): string {
    const doc = parseHtmlDocument(html);
    const selectedParser = PARSERS.find((it) => it.canParseSearch(doc));
    return selectedParser?.name ?? 'Unknown / Default';
  },

  parseSearchPage(html: string, baseUrl: string, sourceId = 'zlibrary'): SearchBook[] {
    const doc = parseHtmlDocument(html);
    ZLibraryAccessChecker.checkResponse(fakeResponse(), doc);

    const selectedParser =
      PARSERS.find((it) => it.canParseSearch(doc)) ?? (PARSERS[PARSERS.length - 1] as ZLibraryLayoutParser);

    SourceLog.log(TAG, `Selected search parser: ${selectedParser.name}`);

    const results = selectedParser.parseSearch(doc, baseUrl, sourceId);
    SourceLog.log(TAG, `Parsed ${results.length} books using ${selectedParser.name}`);
    if (results.length === 0 && selectedParser.name !== 'GenericFallback') {
      SourceLog.log(TAG, 'Selected parser returned 0 books; falling back to GenericFallbackParser');
      return GENERIC_FALLBACK.parseSearch(doc, baseUrl, sourceId);
    }
    return results;
  },

  parseDetailPage(html: string, baseUrl: string): ParsedBookDetail {
    const doc = parseHtmlDocument(html);
    ZLibraryAccessChecker.checkResponse(fakeResponse(), doc);

    const selectedParser =
      PARSERS.find((it) => it.canParseDetail(doc)) ?? (PARSERS[PARSERS.length - 1] as ZLibraryLayoutParser);

    SourceLog.log(TAG, `Selected detail parser: ${selectedParser.name}`);

    return selectedParser.parseDetail(doc, baseUrl);
  },
};

/** Kotlin `private fun fakeResponse(): okhttp3.Response` (L59-66), same values. */
function fakeResponse(): AccessCheckerResponse {
  return {
    code: 200,
    header: () => null,
  };
}

/** Re-exported so callers can type a parsed document without importing the parser folder. */
export type { HtmlDocument };

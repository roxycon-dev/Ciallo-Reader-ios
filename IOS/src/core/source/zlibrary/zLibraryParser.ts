/**
 * Kotlin → TS: `source/zlibrary/ZLibraryParser.kt` (49 lines, 43 non-blank)
 *             → `src/core/source/zlibrary/zLibraryParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SearchBook → `import type { SearchBook } from '../searchBook'`
 *   L4        import …parser.ZLibraryParserManager → `import { ZLibraryParserManager } from './parser/zLibraryParserManager'`
 *   L6-15     KDoc "Unified book detail model…" + `data class ParsedBookDetail`
 *                                                 → MOVED to `./parsedBookDetail` (documented
 *                                                   there: the ESM cycle with the manager
 *                                                   would otherwise break module init), and
 *                                                   RE-EXPORTED here so every call site keeps
 *                                                   reading exactly like the Kotlin import
 *   L17-37    KDoc 从下载链接的路径/查询参数… + `internal fun guessFileFormatFromUrl`
 *                                                 → same split: implemented in
 *                                                   `./parsedBookDetail`, re-exported here
 *   L39-42    KDoc Backwards-compatible facade used by tests and legacy callers.
 *             All real parsing now lives in [ZLibraryParserManager]. → preserved verbatim
 *   L43-49    object ZLibraryParser { parseSearchPage, parseDetailPage }
 *                                                 → `export const ZLibraryParser = { … }`,
 *                                                   same signatures, same `sourceId = "zlibrary"`
 *                                                   default
 *
 * Adaptations:
 *   - Kotlin `object` singleton with functions → `const` object namespace, matching
 *     `src/core/source/sourceResult.ts` and `ZLibraryNetworkLogger`.
 *   - Kotlin default argument `sourceId: String = "zlibrary"` → a TS default parameter.
 *   - No other behavioural change: both members are one-line delegations in Kotlin too.
 */

import type { SearchBook } from '../searchBook';
import { ZLibraryParserManager } from './parser/zLibraryParserManager';
import { guessFileFormatFromUrl, type ParsedBookDetail } from './parsedBookDetail';

/** Kotlin L9-15 `data class ParsedBookDetail` — see `./parsedBookDetail` for the port notes. */
export type { ParsedBookDetail };
/** Kotlin L22-37 `internal fun guessFileFormatFromUrl(url: String?)`. */
export { guessFileFormatFromUrl };

/**
 * Backwards-compatible facade used by tests and legacy callers.
 * All real parsing now lives in [ZLibraryParserManager].
 */
export const ZLibraryParser = {
  parseSearchPage(html: string, baseUrl: string, sourceId = 'zlibrary'): SearchBook[] {
    return ZLibraryParserManager.parseSearchPage(html, baseUrl, sourceId);
  },
  parseDetailPage(html: string, baseUrl: string): ParsedBookDetail {
    return ZLibraryParserManager.parseDetailPage(html, baseUrl);
  },
};

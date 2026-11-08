/**
 * Kotlin → TS: `source/zlibrary/parser/ZLibraryLayoutParser.kt` (23 lines, 18 non-blank)
 *             → `src/core/source/zlibrary/parser/zLibraryLayoutParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary.parser   → SKIPPED (TS has no packages; module boundary)
 *   L3        import com.example.source.SearchBook          → `import type { SearchBook } from '../../searchBook'`
 *   L4        import ...zlibrary.ParsedBookDetail          → `import type { ParsedBookDetail } from '../parsedBookDetail'`
 *   L5        import org.jsoup.nodes.Document               → `import type { HtmlDocument } from './htmlDocument'`
 *   L6        import org.jsoup.nodes.Element                → `import type { HtmlElement } from './htmlDocument'`
 *   L8-14     interface ZLibraryLayoutParser               → `interface ZLibraryLayoutParser` (verbatim member set)
 *   L16-19    KDoc 优先取真实下载按钮链接…                    → preserved verbatim as the `firstRealDownloadLink` doc comment
 *   L20-23    `internal fun Document.firstRealDownloadLink()` → `export function firstRealDownloadLink(doc)`
 *   (tail)    Shared `String` helpers hoisted from the 5 verbatim `formatUrl` copies →
 *             `removeLeadingSlash` / `trimEndSlash` / `trimStartSlash` (documented below)
 *
 * Adaptation: `org.jsoup.nodes.Document` / `Element` are replaced by the local
 * `HtmlDocument` / `HtmlElement` from `./htmlDocument` (jsoup is not available in the
 * web/iOS target). The three CSS selectors are copied byte-for-byte.
 */

import type { SearchBook } from '../../searchBook';
import type { ParsedBookDetail } from '../parsedBookDetail';
import type { HtmlDocument, HtmlElement } from './htmlDocument';

export interface ZLibraryLayoutParser {
  readonly name: string;
  canParseSearch(doc: HtmlDocument): boolean;
  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[];
  canParseDetail(doc: HtmlDocument): boolean;
  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail;
}

/**
 * 优先取真实下载按钮链接，跳过 <template> 里 [hidden] 的死链。
 * 当前站点详情页第一个 /dl/ 链接是隐藏模板占位，直接取会拿到 204 空文件。
 */
export function firstRealDownloadLink(doc: HtmlElement): HtmlElement | null {
  return (
    doc.selectFirst('a.dlButton[href*=/dl/]:not([hidden])') ??
    doc.selectFirst('a[href*=/dl/]:not([hidden])') ??
    doc.selectFirst('a.add_to_download_history:not([hidden])')
  );
}

// ---------------------------------------------------------------------------
// Shared `String` helpers.
//
// The five layout parsers each carry a verbatim, byte-identical private `formatUrl`
// plus inline `removePrefix("/")` / `trimEnd('/')` / `trimStart('/')` calls. In Kotlin
// those live inside the class bodies, so they are NOT collapsed there; in TS the copies
// would be five identical module-level blocks, so they are hoisted here once. The
// behaviour below is exactly Kotlin's (`trimStart`/`trimEnd` strip EVERY leading/trailing
// occurrence, not just one).
// ---------------------------------------------------------------------------

/** Kotlin `String.removePrefix("/")` — removes a single leading occurrence. */
export function removeLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}

/** Kotlin `String.trimEnd('/')` — removes every trailing occurrence. */
export function trimEndSlash(value: string): string {
  let out = value;
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/** Kotlin `String.trimStart('/')` — removes every leading occurrence. */
export function trimStartSlash(value: string): string {
  let out = value;
  while (out.startsWith('/')) out = out.slice(1);
  return out;
}

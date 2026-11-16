/**
 * jsoup (org.jsoup) surface for the ported `com.example.source.impl` sources.
 *
 * Kotlin counterpart: the third-party `org.jsoup` library that
 * `MangaDexSource.kt`, `IxdzsSource.kt`, `Wenku8LibrarySource.kt` and
 * `JsonBookSource.kt` import. There is no single Kotlin file to map, so this
 * module only binds the jsoup names those files call to the jsoup-compatible
 * subset that already exists in this repository:
 *
 *   Jsoup.parse(html)         → parseHtmlDocument(html)
 *   Jsoup.parseBodyFragment() → parseBodyFragment()
 *   Document / Element        → HtmlDocument / HtmlElement
 *   Element.attr/text/ownText/html/outerHtml/children/parent/select/selectFirst/
 *   getElementsByTag/getAllElements
 *
 * The engine itself lives in `../zlibrary/parser/htmlDocument`, which was
 * written for exactly this purpose (its header documents the jsoup subset and
 * its omissions). Only `parseBodyFragment` — used by `JsonBookSource`'s
 * `extractImageUrls` — is added here, because the HTML-fragment wrapper is not
 * part of the shared module.
 *
 * NOT reproduced by the shared engine (never used by any ported Kotlin rule):
 * jsoup forms/namespaces, `:regex`/`:matches`, `:lt`/`:gt`, `:first-child` /
 * `:last-child` / `:nth-child`, jsoup's pretty-printer and its full HTML5 entity
 * table.
 */

import { HtmlElement, parseHtmlDocument } from '../zlibrary/parser/htmlDocument';
import type { HtmlDocument } from '../zlibrary/parser/htmlDocument';

export type { HtmlDocument, HtmlElement, HtmlCommentNode, HtmlDoctypeNode, HtmlTextNode } from '../zlibrary/parser/htmlDocument';
export { getAllElements, selectElements, HtmlDocument as JsoupDocument } from '../zlibrary/parser/htmlDocument';

export { parseHtmlDocument };

/**
 * Kotlin `Jsoup.parseBodyFragment(fragment)` — a `body` wrapper around the
 * fragment so `img` / `amp-img` / `mip-img` selectors resolve. `JsonBookSource`
 * uses it in `extractImageUrls` (Kotlin line 461).
 */
export function parseBodyFragment(html: string): HtmlElement {
  const doc = parseHtmlDocument(html);
  const body = doc.selectFirst('body');
  if (body !== null) return body;
  const wrapper = new HtmlElement('body');
  for (const child of doc.childNodes) {
    if (child instanceof HtmlElement) wrapper.appendChild(child);
  }
  return wrapper;
}

/** Kotlin `org.jsoup.nodes.Document` is the `HtmlDocument` class. */
export type Document = HtmlDocument;

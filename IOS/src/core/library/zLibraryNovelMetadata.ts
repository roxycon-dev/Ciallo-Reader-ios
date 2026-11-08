/**
 * Kotlin → TS: `library/ZLibraryNovelMetadata.kt` (21 lines total / 19 non-blank)
 *             → `src/core/library/zLibraryNovelMetadata.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1         package com.example.library                   → SKIPPED (TS has no packages)
 *   L3         import com.example.source.NovelInfo           → `createNovelInfo` / `type NovelInfo`
 *              from `../source/novelInfo` (the already-ported `NovelInfo.kt`)
 *   L4         import org.jsoup.Jsoup                        → `parseHtmlDocument` from the already-ported
 *              jsoup replacement `../source/zlibrary/parser/htmlDocument`
 *   L6         Kotlin doc comment: "Display metadata only; never used to select a download URL or
 *              authenticate."
 *                                                            → preserved verbatim above `zLibraryNovelMetadata`
 *   L7         `internal fun zLibraryNovelMetadata(html: String): NovelInfo`
 *                                                            → `export function zLibraryNovelMetadata(html: string): NovelInfo`
 *              (`internal` → `export`: the module lives outside the `source/` package tree, and the
 *              only caller is `ZLibrarySource.getDetail()` via the injected
 *              `ZLibraryNovelMetadataPort` in `../source/zlibrary/zLibraryHost`)
 *   L8         `val doc = Jsoup.parse(html)`                 → `parseHtmlDocument(html)`
 *   L9-11      the `#bookDescriptionBox, .book-description, [itemprop=description], #description`
 *              selector + `clone().apply { select("script, style, button").remove() }.wholeText().trim()`
 *              + `takeIf(String::isNotBlank)`
 *                                                            → verbatim; the clone/remove/wholeText trio
 *              becomes `synopsisOf(element)` below (jsoup-only APIs have no counterpart in the
 *              already-ported `HtmlElement`, so the three steps are spelled out once, here)
 *   L12-14     `fun property(key: String)` — the two-branch selector lookup, the
 *              `substringAfter(':')` fallback and both `takeIf(String::isNotBlank)` guards
 *                                                            → `property(doc, key)`, verbatim
 *   L15-17     the `facts` list (`出版年份：` / `页数：` / `ISBN：` / `ISBN-13：`)
 *                                                            → verbatim (the separators are U+FF1A
 *              FULLWIDTH COLON and the joiner on L20 is `" · "` with U+00B7 MIDDLE DOT — checked
 *              against the Kotlin source bytes, not retyped from memory)
 *   L18-20     `NovelInfo(synopsis, publisher, tags, notice)` → `createNovelInfo({ … })` (the four
 *              named fields only; every other field keeps its Kotlin default of `null`/`[]`)
 *   L21        closing brace                                 → n/a
 *
 * ADAPTATIONS (documented at each site):
 *   - `Jsoup.parse` → `parseHtmlDocument` (the shared jsoup-compatible subset).
 *   - `Element.clone()` → the local `cloneElement` deep copy, so the `script, style, button`
 *     strip does not mutate the caller's document. jsoup's `clone()` is a deep copy and so is
 *     this one (attributes + child nodes).
 *   - `Elements.remove()` → detaching each node from its own `parentNode.childNodes`, which is
 *     what jsoup's `Element.remove()` does (`Node.remove()` = "remove from its parent").
 *   - `Element.wholeText()` → `wholeTextOf`: concatenate EVERY descendant text node's raw data,
 *     then `normaliseWhitespace` + `trim` — exactly jsoup's `Element.wholeText()`. Note it is
 *     NOT `text()`: no block-element spaces are inserted. `<script>`/`<style>` payloads are jsoup
 *     `DataNode`s (the port's `HtmlDataNode`) and are skipped here too, which is why the Kotlin
 *     still strips them explicitly with `select("script, style, button").remove()` before this
 *     runs — the strip is kept because the Kotlin has it.
 *   - `String?.substringAfter(':')` → `substringAfterColon(text)`, including Kotlin's
 *     "delimiter absent → whole string" behaviour.
 *   - `String.isNotBlank()` → a local `isNotBlank` (JS `\s` also covers U+00A0/U+FEFF; irrelevant
 *     for Z-Library property text).
 *   - `HtmlElement` must be imported as a VALUE (not `import type`) because `cloneElement` and
 *     `wholeTextOf` discriminate node kinds with `instanceof`.
 *
 * REVIEW FIX (this pass): `cloneElement` had no branch for the jsoup `DataNode` type, so a
 * `<script>` inside a description box was cloned as a `HtmlDoctypeNode` and its payload was
 * serialised as if it were the node's markup. `HtmlDataNode` is now cloned as itself.
 */

import { createNovelInfo, type NovelInfo } from '../source/novelInfo';
import {
  HtmlCommentNode,
  HtmlDataNode,
  HtmlDoctypeNode,
  HtmlElement,
  HtmlTextNode,
  parseHtmlDocument,
  type HtmlDocument,
} from '../source/zlibrary/parser/htmlDocument';

/** Display metadata only; never used to select a download URL or authenticate. */
export function zLibraryNovelMetadata(html: string): NovelInfo {
  const doc = parseHtmlDocument(html);
  const synopsis = synopsisOf(doc);
  const facts: string[] = [];
  const year = property(doc, 'year');
  if (year !== null) facts.push(`出版年份：${year}`);
  const pages = property(doc, 'pages');
  if (pages !== null) facts.push(`页数：${pages}`);
  const isbn = property(doc, 'isbn');
  if (isbn !== null) facts.push(`ISBN：${isbn}`);
  const isbn13 = property(doc, 'isbn13');
  if (isbn13 !== null) facts.push(`ISBN-13：${isbn13}`);

  return createNovelInfo({
    synopsis,
    publisher: property(doc, 'publisher'),
    // Kotlin L19: `doc.select(".property_categories .property_value a").map { it.text() }.filter(String::isNotBlank)`
    tags: doc
      .select('.property_categories .property_value a')
      .map((el) => el.text())
      .filter((it) => isNotBlank(it)),
    // Kotlin L20: `facts.takeIf { it.isNotEmpty() }?.joinToString(" · ")`
    notice: facts.length > 0 ? facts.join(' · ') : null,
  });
}

/**
 * Kotlin L9-11:
 * ```
 * doc.selectFirst("#bookDescriptionBox, .book-description, [itemprop=description], #description")
 *   ?.let { element -> element.clone().apply { select("script, style, button").remove() }.wholeText().trim() }
 *   ?.takeIf(String::isNotBlank)
 * ```
 */
function synopsisOf(doc: HtmlDocument): string | null {
  const element = doc.selectFirst(
    '#bookDescriptionBox, .book-description, [itemprop=description], #description',
  );
  if (element === null) return null;
  const clone = cloneElement(element);
  // Kotlin `clone().apply { select("script, style, button").remove() }`
  for (const el of clone.select('script, style, button')) {
    detach(el);
  }
  const text = wholeTextOf(clone).trim();
  return isNotBlank(text) ? text : null;
}

/**
 * Kotlin L12-14 `fun property(key: String): String?`, verbatim:
 * ```
 * doc.selectFirst(".property_$key .property_value, .book-property__$key .property_value")
 *   ?.text()?.takeIf(String::isNotBlank)
 *   ?: doc.selectFirst(".property_$key, .book-property__$key")?.text()
 *       ?.substringAfter(':')?.trim()?.takeIf(String::isNotBlank)
 * ```
 */
export function property(doc: HtmlDocument, key: string): string | null {
  const value = doc
    .selectFirst(`.property_${key} .property_value, .book-property__${key} .property_value`)
    ?.text();
  if (value !== undefined && isNotBlank(value)) return value;
  const flat = doc.selectFirst(`.property_${key}, .book-property__${key}`)?.text();
  if (flat === undefined) return null;
  const after = substringAfterColon(flat).trim();
  return isNotBlank(after) ? after : null;
}

/** Kotlin `String?.substringAfter(':')` — absent delimiter returns the WHOLE string. */
export function substringAfterColon(value: string): string {
  const at = value.indexOf(':');
  return at < 0 ? value : value.slice(at + 1);
}

/** Kotlin `String.isNotBlank()`. */
export function isNotBlank(value: string): boolean {
  return value.trim() !== '';
}

/**
 * jsoup `Element.wholeText()`: every descendant text node's raw data concatenated, then
 * whitespace-normalised (`[\t\n\f\r ]+` → one space) and trimmed. Unlike `text()`, no space is
 * inserted around block-level elements.
 */
export function wholeTextOf(element: HtmlElement): string {
  let acc = '';
  const walk = (node: HtmlElement): void => {
    for (const child of node.childNodes) {
      if (child instanceof HtmlTextNode) {
        acc += child.data;
      } else if (child instanceof HtmlElement) {
        walk(child);
      }
      // comments / doctypes contribute nothing, exactly like jsoup's TextNode-only traversal
    }
  };
  walk(element);
  return acc.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

/** jsoup `Element.clone()` — deep copy of the element and everything under it. */
export function cloneElement(element: HtmlElement): HtmlElement {
  const copy = new HtmlElement(element.tagName, { ...element.attributes });
  for (const child of element.childNodes) {
    if (child instanceof HtmlElement) {
      copy.appendChild(cloneElement(child));
    } else if (child instanceof HtmlTextNode) {
      copy.appendChild(new HtmlTextNode(child.data));
    } else if (child instanceof HtmlDataNode) {
      copy.appendChild(new HtmlDataNode(child.data));
    } else if (child instanceof HtmlCommentNode) {
      copy.appendChild(new HtmlCommentNode(child.data));
    } else {
      copy.appendChild(new HtmlDoctypeNode(child.data));
    }
  }
  return copy;
}

/** jsoup `Elements.remove()` → `Node.remove()` for each match: unlink from its parent. */
function detach(element: HtmlElement): void {
  const parent = element.parentNode;
  if (parent === null) return;
  const at = parent.childNodes.indexOf(element);
  if (at < 0) return;
  parent.childNodes.splice(at, 1);
}
/**
 * Kotlin → TS: `source/zlibrary/parser/GenericFallbackParser.kt` (164 lines, 143 non-blank)
 *             → `src/core/source/zlibrary/parser/genericFallbackParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser                 → SKIPPED (TS has no packages)
 *   L3        import android.util.Log                 → `import { SourceLog } from '../../sourceLog'`
 *   L4        import com.example.source.SearchBook    → type import from '../../searchBook'
 *   L5        import …zlibrary.ParsedBookDetail       → type import from '../parsedBookDetail'
 *   L6-7      import org.jsoup.nodes.Document/Element  → type import from './htmlDocument'
 *   L9-12     KDoc Layout-agnostic fallback…           → preserved verbatim
 *   L13       class GenericFallbackParser : ZLibraryLayoutParser → `implements ZLibraryLayoutParser`
 *   L15       override val name = "GenericFallback"   → `readonly name = 'GenericFallback'`
 *   L17-19    companion object { private const val TAG = "ZLibCover" } → module-level `const TAG = 'ZLibCover'`
 *   L21-23    canParseSearch                          → verbatim
 *   L25-96    parseSearch                             → verbatim (LinkedHashMap → `Map`, `absUrl`
 *                                                         asymmetry between the two branches preserved)
 *   L98-111   private fun bestContainer               → verbatim private method
 *   L113-117  private fun absUrl                      → verbatim private method
 *   L119-121  private fun extractCover                → verbatim (delegates to CoverExtractor)
 *   L123-131  private fun extractFormat               → verbatim
 *   L133-141  private fun inferFormatFromUrl          → verbatim
 *   L143-145  canParseDetail                          → verbatim
 *   L147-163  parseDetail                             → verbatim
 *   L164      closing brace                           → n/a
 *
 * Adaptations:
 *   - `android.util.Log.d(TAG, …)` → `SourceLog.log(TAG, …)` (only logging channel in `src/core`).
 *   - `LinkedHashMap<String, SearchBook>` → `Map` (insertion-ordered; re-`set` keeps the original slot,
 *     exactly like `LinkedHashMap` in access order).
 *   - `String.take(900)` / `take(1500)` → `.slice(0, …)`.
 *   - Kotlin `Char.isLetterOrDigit()` (Unicode-aware) → `/[\p{L}\p{N}]/u`, so the extension
 *     filter keeps Kotlin's Unicode semantics instead of narrowing to `[a-z0-9]`.
 *   - `?: continue` → explicit `continue`.
 *
 * REVIEW FIX (this pass): `card.attr("download").ifBlank { … }` (Kotlin L42) is whitespace-aware;
 * the port compared against `''`, so a whitespace-only `download` attribute shadowed the inner
 * `<a href="/dl/…">` link and the book lost its download URL.
 *
 * NOTE on `bestContainer` (Kotlin L99-111): it stops at `html` / `body`. That only works because
 * the jsoup replacement reproduces `Jsoup.parse`'s implicit `<html><head><body>` wrapper — see
 * `htmlDocument.ts`. Verified by the "bestContainer stops at <body>" test.
 */

import { SourceLog } from '../../sourceLog';
import { createSearchBook, type SearchBook } from '../../searchBook';
import type { ParsedBookDetail } from '../parsedBookDetail';
import { CoverExtractor } from './coverExtractor';
import type { HtmlDocument, HtmlElement } from './htmlDocument';
import { firstRealDownloadLink, trimEndSlash, trimStartSlash, type ZLibraryLayoutParser } from './zLibraryLayoutParser';

/** Kotlin `private const val TAG = "ZLibCover"` (companion object, L18). */
const TAG = 'ZLibCover';

/**
 * Layout-agnostic fallback: extracts books from any page that links to /book/... detail pages.
 * Covers redesigns that drop the legacy .resItemBox / table.zbook markup.
 */
export class GenericFallbackParser implements ZLibraryLayoutParser {
  readonly name = 'GenericFallback';

  canParseSearch(doc: HtmlDocument): boolean {
    return doc.selectFirst('z-bookcard[href], a[href*=/book/]') !== null;
  }

  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[] {
    const results = new Map<string, SearchBook>();
    SourceLog.log(
      TAG,
      `page imgs=${doc.select('img').length} bookcards=${doc.select('z-bookcard[href]').length} ` +
        `bgStyle=${doc.select('[style*=background-image]').length} base=${baseUrl}`,
    );

    // New Z-Library layout: custom <z-bookcard> elements carry href/download/extension
    // as attributes and title/author in slot divs.
    for (const card of doc.select('z-bookcard[href]')) {
      const href = card.attr('href').trim();
      if (href === '') continue;
      const id = trimStartSlash(href);
      if (!id.startsWith('book/')) continue;
      const titleEl = card.selectFirst('[slot=title], h3, h4, [class*=title]');
      const title = titleEl !== null ? titleEl.text().trim() : '';
      if (title.trim() === '') continue;

      const authorEl = card.selectFirst('[slot=author], a[href*=/g/], [class*=author]');
      const author = authorEl !== null ? authorEl.text().trim() : '';
      const dlAttr = card.attr('download');
      const innerDl = card.selectFirst('a[href*=/dl/]');
      // Kotlin `card.attr("download").ifBlank { card.selectFirst("a[href*=/dl/]")?.attr("href") ?: "" }`
      // — `ifBlank`, so a whitespace-only `download` attribute falls through to the inner link.
      const dl =
        dlAttr.trim() !== '' ? dlAttr : innerDl !== null ? innerDl.attr('href') : '';
      const cover = extractCover(card);
      const format = extractFormat(card, dl);
      if (cover === '') {
        SourceLog.log(TAG, `NO_COVER [${title}] href=${href} card=${card.outerHtml().slice(0, 1500)}`);
      } else {
        SourceLog.log(TAG, `COVER [${title}] ${cover}`);
      }

      const coverAbs = absUrl(baseUrl, cover);
      const dlAbs = absUrl(baseUrl, dl);
      results.set(
        id,
        createSearchBook({
          id,
          sourceId,
          title,
          author,
          cover: coverAbs === '' ? null : coverAbs,
          format: format === '' ? 'epub' : format,
          downloadUrl: dlAbs === '' ? null : dlAbs,
        }),
      );
    }

    // Legacy layouts: plain <a href="/book/..."> links
    for (const link of doc.select('a[href*=/book/]')) {
      const href = link.attr('href').trim();
      if (href === '') continue;
      const id = trimStartSlash(href);
      if (!id.startsWith('book/')) continue;
      if (results.has(id)) continue;

      const container = this.bestContainer(link) ?? link.parent();
      if (container === null) continue;
      const linkText = link.text().trim();
      const titleFallback = container.selectFirst('h3, h4, [class*=title]');
      const title = linkText === '' ? (titleFallback !== null ? titleFallback.text().trim() : '') : linkText;
      if (title.trim() === '') continue;

      const authorEl = container.selectFirst(
        'a[href*=/g/], [itemprop=author], .authors a, [class*=author]',
      );
      const author = authorEl !== null ? authorEl.text().trim() : '';

      const dlEl = container.selectFirst('a[href*=/dl/]');
      const downloadUrl = dlEl !== null ? absUrl(baseUrl, dlEl.attr('href')) : '';
      const cover = extractCover(container);
      const format = extractFormat(container, downloadUrl);

      results.set(
        id,
        createSearchBook({
          id,
          sourceId,
          title,
          author,
          cover: cover === '' ? null : cover,
          format: format === '' ? 'epub' : format,
          downloadUrl: downloadUrl === '' ? null : downloadUrl,
        }),
      );
    }
    return Array.from(results.values());
  }

  /** Smallest ancestor that contains exactly one book link and a bounded amount of text. */
  private bestContainer(link: HtmlElement): HtmlElement | null {
    let best: HtmlElement | null = null;
    for (const p of link.parents()) {
      if (p.tag() === 'html' || p.tag() === 'body') break;
      const bookLinks = p.select('a[href*=/book/]').length;
      const textLen = p.text().length;
      if (bookLinks === 1 && textLen >= 1 && textLen <= 600) {
        best = p;
      }
      if (textLen > 600) break;
    }
    return best;
  }

  canParseDetail(doc: HtmlDocument): boolean {
    return doc.selectFirst('h1, [itemprop=name]') !== null;
  }

  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail {
    const titleEl = doc.selectFirst('h1, [itemprop=name]');
    const title = titleEl !== null ? titleEl.text().trim() : '';
    const author = doc
      .select('a[itemprop=author], [class*=author] a')
      .map((it) => it.text().trim())
      .join(', ');
    const coverEl = doc.selectFirst('img[src]');
    const cover = coverEl !== null ? absUrl(baseUrl, coverEl.attr('src')) : '';
    const formatEl = doc.selectFirst('[class*=extension], [class*=format], [class*=file-type]');
    const format = formatEl !== null ? formatEl.text().trim().toLowerCase() : '';
    const dlAnchor = firstRealDownloadLink(doc);
    const downloadUrl = dlAnchor !== null ? absUrl(baseUrl, dlAnchor.attr('href')) : '';
    return {
      title,
      author,
      cover,
      format,
      downloadUrl,
    };
  }
}

/** Kotlin private `absUrl` (L113-117), verbatim. */
function absUrl(baseUrl: string, href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${trimEndSlash(baseUrl)}/${trimStartSlash(href)}`;
}

/** Kotlin private `extractCover` (L119-121), verbatim. */
function extractCover(root: HtmlElement): string {
  return CoverExtractor.extract(root);
}

/** Kotlin private `extractFormat` (L123-131), verbatim. */
function extractFormat(root: HtmlElement, downloadUrl: string): string {
  const fromAttr = orEmpty(root.attr('extension')) || orEmpty(root.attr('data-extension')) || orEmpty(root.attr('format'));
  if (fromAttr !== '') return fromAttr.toLowerCase();
  const fromTextEl = root.selectFirst('[class*=extension], [class*=format], [class*=file-type]');
  const fromText = fromTextEl !== null ? fromTextEl.text().trim().toLowerCase() : '';
  if (fromText !== '') return fromText;
  return inferFormatFromUrl(downloadUrl);
}

/** Kotlin `ifBlank { }` on a possibly-absent string — jsoup `attr` already returns "". */
function orEmpty(value: string): string {
  return value.trim() === '' ? '' : value;
}

/** Kotlin private `inferFormatFromUrl` (L133-141), verbatim. */
function inferFormatFromUrl(url: string): string {
  if (url.trim() === '') return '';
  const clean = beforeHash(beforeQuery(url));
  const ext = afterLastDot(clean).toLowerCase();
  return ext.length >= 2 &&
    ext.length <= 5 &&
    isLetterOrDigitOnly(ext) &&
    ext !== 'html' &&
    ext !== 'php'
    ? ext
    : '';
}

/** Kotlin `ext.all { it.isLetterOrDigit() }` — Unicode letters/digits, not just ASCII. */
function isLetterOrDigitOnly(value: string): boolean {
  for (const ch of value) {
    if (!/[\p{L}\p{N}]/u.test(ch)) return false;
  }
  return true;
}

/** Kotlin `String.substringBefore('?')`. */
function beforeQuery(value: string): string {
  const at = value.indexOf('?');
  return at < 0 ? value : value.slice(0, at);
}

/** Kotlin `String.substringBefore('#')`. */
function beforeHash(value: string): string {
  const at = value.indexOf('#');
  return at < 0 ? value : value.slice(0, at);
}

/** Kotlin `String.substringAfterLast('.', "")`. */
function afterLastDot(value: string): string {
  const at = value.lastIndexOf('.');
  return at < 0 ? '' : value.slice(at + 1);
}

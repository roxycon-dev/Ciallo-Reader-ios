/**
 * Kotlin → TS: `source/zlibrary/parser/MobileLayoutParser.kt` (106 lines, 88 non-blank)
 *             → `src/core/source/zlibrary/parser/mobileLayoutParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser                    → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SearchBook       → type import from '../../searchBook'
 *   L4        import com.example.source.SourceException  → `import { ParseError } from '../../sourceException'`
 *   L5        import …zlibrary.ParsedBookDetail          → type import from '../parsedBookDetail'
 *   L6        import …zlibrary.guessFileFormatFromUrl    → value import from '../parsedBookDetail'
 *   L7        import org.jsoup.nodes.Document             → type import from './htmlDocument'
 *   L9        class MobileLayoutParser : ZLibraryLayoutParser → `implements ZLibraryLayoutParser`
 *   L11       override val name                          → `readonly name = 'MobileLayoutParser'`
 *   L13-15    canParseSearch                             → verbatim
 *   L17-62    parseSearch                                → verbatim, per-item try/catch retained
 *   L64-66    canParseDetail                             → verbatim
 *   L68-97    parseDetail                                → verbatim
 *   L99-105   private fun formatUrl                      → verbatim (slash helpers hoisted,
 *                                                         same behaviour)
 *   L106      closing brace                              → n/a
 *
 * Adaptations:
 *   - `?.joinToString(", ") { … }?.ifBlank { "未知作者" } ?: "未知作者"` (L70) — the elvis
 *     branch is unreachable (jsoup `select` and `HtmlElement.select` never return null);
 *     only the `ifBlank` fallback is kept.
 *   - `?: continue` / `?: throw` → explicit null checks.
 *   - `ifBlank { }` → `.trim() === ''` ternaries.
 *
 * REVIEW FIXES (this pass):
 *   - `it.attr("data-src").ifBlank { it.attr("src") }` (Kotlin L73) is whitespace-aware; the
 *     port compared against `''`, so a whitespace-only `data-src` beat a real `src`.
 *   - `linkEl.text().ifBlank { "未知书名" }` (Kotlin L28) is `ifBlank`, and the port compared
 *     against `=== ''`. jsoup's `text()` is whitespace-normalised so the two agree on real
 *     markup, but the guard is now the same predicate everywhere else in this file.
 */

import { ParseError } from '../../sourceException';
import { createSearchBook, type SearchBook } from '../../searchBook';
import { guessFileFormatFromUrl, type ParsedBookDetail } from '../parsedBookDetail';
import { CoverExtractor } from './coverExtractor';
import type { HtmlDocument } from './htmlDocument';
import { firstRealDownloadLink, removeLeadingSlash, trimEndSlash, trimStartSlash, type ZLibraryLayoutParser } from './zLibraryLayoutParser';

export class MobileLayoutParser implements ZLibraryLayoutParser {
  readonly name = 'MobileLayoutParser';

  canParseSearch(doc: HtmlDocument): boolean {
    return doc.select('z-bookcard, .book-item, .mobile-book-card').length > 0;
  }

  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[] {
    const books: SearchBook[] = [];
    const items = doc.select('z-bookcard, .book-item, .mobile-book-card');

    for (const item of items) {
      try {
        const linkEl = item.selectFirst('a[href*=/book/]');
        if (linkEl === null) continue;
        const rawHref = linkEl.attr('href');
        if (rawHref.trim() === '') continue;

        const bookId = removeLeadingSlash(rawHref).trim();
        const titleEl = item.selectFirst('.book-title, h3, .title');
        // Kotlin `?: linkEl.text().ifBlank { "未知书名" }` — the elvis only fires when the
        // element is ABSENT; `ifBlank` then treats a whitespace-only link label as blank.
        const linkText = linkEl.text();
        const title =
          titleEl !== null ? titleEl.text() : linkText.trim() !== '' ? linkText : '未知书名';
        const authorJoin = item
          .select('.book-author, .author')
          .map((it) => it.text())
          .join(', ');
        const author = authorJoin.trim() === '' ? '未知作者' : authorJoin;

        let cover = CoverExtractor.extract(item);
        if (cover !== '' && !cover.startsWith('http')) {
          cover = formatUrl(baseUrl, cover);
        }

        const dlEl = item.selectFirst('a[href*=/dl/], a.btn-primary');
        let downloadUrl: string | null = dlEl !== null ? dlEl.attr('href') : null;
        if (downloadUrl !== null && downloadUrl.trim() !== '' && !downloadUrl.startsWith('http')) {
          downloadUrl = formatUrl(baseUrl, downloadUrl);
        }
        const formatEl = item.selectFirst('.book-property__extension, .extension');
        const formatFromEl = formatEl !== null ? formatEl.text().toLowerCase().trim() : null;
        const format = formatFromEl ?? guessFileFormatFromUrl(downloadUrl) ?? 'epub';

        books.push(
          createSearchBook({
            id: bookId,
            sourceId,
            title: title.trim(),
            author: author.trim(),
            cover,
            format,
            downloadUrl,
          }),
        );
      } catch {
        // skip
      }
    }
    return books;
  }

  canParseDetail(doc: HtmlDocument): boolean {
    return doc.select('.book-title, .book-property__extension, a.btn-primary[href*=/dl/]').length > 0;
  }

  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail {
    const titleEl = doc.selectFirst('.book-title, h1');
    const rawTitle = titleEl !== null ? titleEl.text() : '未知书名';
    const authorJoin = doc
      .select('.book-author')
      .map((it) => it.text())
      .join(', ');
    const author = authorJoin.trim() === '' ? '未知作者' : authorJoin;

    const coverEl = doc.selectFirst('img.cover, img');
    // Kotlin `it.attr("data-src").ifBlank { it.attr("src") }` — `ifBlank`, not `!== ''`.
    let cover: string | null =
      coverEl !== null
        ? coverEl.attr('data-src').trim() !== '' ? coverEl.attr('data-src') : coverEl.attr('src')
        : null;
    if (cover !== null && cover.trim() !== '' && !cover.startsWith('http')) {
      cover = formatUrl(baseUrl, cover);
    }

    const dlAnchor = firstRealDownloadLink(doc);
    if (dlAnchor === null) {
      throw new ParseError('未找到移动端下载按钮');
    }

    let dlUrl = dlAnchor.attr('href');
    if (dlUrl.trim() === '') throw new ParseError('下载链接为空');
    if (!dlUrl.startsWith('http')) dlUrl = formatUrl(baseUrl, dlUrl);

    const formatEl = doc.selectFirst('.book-property__extension');
    const formatText = formatEl !== null ? formatEl.text() : null;
    const format = formatText ?? guessFileFormatFromUrl(dlUrl) ?? 'epub';

    return {
      title: rawTitle.trim(),
      author: author.trim(),
      cover,
      downloadUrl: dlUrl,
      format: format.toLowerCase().trim(),
    };
  }
}

/** Kotlin private `formatUrl` (L99-105), verbatim. */
function formatUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('//')) return `https:${path}`;
  const cleanBase = trimEndSlash(baseUrl);
  const cleanPath = trimStartSlash(path);
  return `${cleanBase}/${cleanPath}`;
}

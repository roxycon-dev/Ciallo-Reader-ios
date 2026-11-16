/**
 * Kotlin → TS: `source/zlibrary/parser/DesktopLayoutParser.kt` (113 lines, 94 non-blank)
 *             → `src/core/source/zlibrary/parser/desktopLayoutParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser              → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SearchBook → type import from '../../searchBook'
 *   L4        import com.example.source.SourceException → `import { ParseError } from '../../sourceException'`
 *   L5        import …zlibrary.ParsedBookDetail    → type import from '../parsedBookDetail'
 *   L6        import …zlibrary.guessFileFormatFromUrl → value import from '../parsedBookDetail'
 *   L7        import org.jsoup.nodes.Document       → type import from './htmlDocument'
 *   L9        class DesktopLayoutParser : ZLibraryLayoutParser → `implements ZLibraryLayoutParser`
 *   L11       override val name                    → `readonly name = 'DesktopLayoutParser'`
 *   L13-15    canParseSearch                       → verbatim
 *   L17-69    parseSearch                          → verbatim, per-item try/catch retained
 *   L71-73    canParseDetail                       → verbatim
 *   L75-104   parseDetail                          → verbatim
 *   L106-112  private fun formatUrl                → verbatim (slash helpers hoisted to
 *                                                   `zLibraryLayoutParser.ts`, same behaviour)
 *   L113      closing brace                        → n/a
 *
 * Adaptations:
 *   - `?.joinToString(", ") { … }?.ifBlank { … } ?: "未知作者"` (L77) — `doc.select()` never
 *     returns null in jsoup nor in `HtmlElement.select`, so the elvis branch is unreachable in
 *     both languages; the `ifBlank` fallback is kept and the dead `?: "未知作者"` branch dropped
 *     (documented here so the omission is visible).
 *   - `?: continue` → `if (x === null) continue;`
 *   - `ifBlank { }` → `.trim() === ''` ternaries.
 *   - `selectFirst(…).text()` returning `String?` under Kotlin's platform types →
 *     `null` only when the element is absent.
 *   - `Catch (e: Exception)` → `catch {` (optional catch binding; body keeps the original comment).
 *
 * REVIEW FIX: `it.attr("data-src").ifBlank { it.attr("src") }` (Kotlin L80) is whitespace-aware;
 * the port compared against `''`, so a whitespace-only `data-src` beat a real `src`.
 */

import { ParseError } from '../../sourceException';
import { createSearchBook, type SearchBook } from '../../searchBook';
import { guessFileFormatFromUrl, type ParsedBookDetail } from '../parsedBookDetail';
import { CoverExtractor } from './coverExtractor';
import type { HtmlDocument } from './htmlDocument';
import { firstRealDownloadLink, trimEndSlash, trimStartSlash, type ZLibraryLayoutParser } from './zLibraryLayoutParser';

export class DesktopLayoutParser implements ZLibraryLayoutParser {
  readonly name = 'DesktopLayoutParser';

  canParseSearch(doc: HtmlDocument): boolean {
    return doc.select('.resItemBox, tr.bookRow, #booksList .item').length > 0;
  }

  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[] {
    const books: SearchBook[] = [];
    const items = doc.select('.resItemBox, tr.bookRow, #booksList .item');

    for (const item of items) {
      try {
        const linkEl = item.selectFirst('a[href*=/book/]') ?? item.selectFirst('a[href*=/s/]');
        if (linkEl === null) continue;
        const rawHref = linkEl.attr('href');
        if (rawHref.trim() === '') continue;

        const bookId = removePrefixSlash(rawHref).trim();
        const linkText = linkEl.text();
        let title: string;
        if (linkText.trim() !== '') {
          title = linkText;
        } else {
          const fallback = item.selectFirst('h3, .title, td[itemprop=name]');
          title = fallback !== null ? fallback.text() : '未知书名';
        }

        const authorJoin = item
          .select('div.authors a, a[itemprop=author], .book-author, td[itemprop=author]')
          .map((it) => it.text())
          .join(', ');
        const author = authorJoin.trim() === '' ? '未知作者' : authorJoin;

        let cover = CoverExtractor.extract(item);
        if (cover !== '' && !cover.startsWith('http')) {
          cover = formatUrl(baseUrl, cover);
        }

        const dlEl = item.selectFirst('a[href*=/dl/], a.add_to_download_history, a.dlButton');
        let downloadUrl: string | null = dlEl !== null ? dlEl.attr('href') : null;
        if (downloadUrl !== null && downloadUrl.trim() !== '' && !downloadUrl.startsWith('http')) {
          downloadUrl = formatUrl(baseUrl, downloadUrl);
        }
        const formatEl = item.selectFirst(
          '.property_extension, .property__file .property__value, td.property_extension',
        );
        const formatText = formatEl !== null ? formatEl.text().toLowerCase().trim() : null;
        const format = formatText ?? guessFileFormatFromUrl(downloadUrl) ?? 'epub';

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
        // skip corrupted item
      }
    }
    return books;
  }

  canParseDetail(doc: HtmlDocument): boolean {
    return doc.select('h1[itemprop=name], a.add_to_download_history, a.dlButton').length > 0;
  }

  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail {
    const titleEl = doc.selectFirst('h1[itemprop=name], h1.title');
    const rawTitle = titleEl !== null ? titleEl.text() : '未知书名';
    const authorJoin = doc
      .select('a[itemprop=author]')
      .map((it) => it.text())
      .join(', ');
    const author = authorJoin.trim() === '' ? '未知作者' : authorJoin;

    const coverEl = doc.selectFirst('img.cover, img[itemprop=image]');
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
      throw new ParseError('未找到下载链接');
    }

    let dlUrl = dlAnchor.attr('href');
    if (dlUrl.trim() === '') throw new ParseError('解析下载链接为空');
    if (!dlUrl.startsWith('http')) dlUrl = formatUrl(baseUrl, dlUrl);

    const formatEl = doc.selectFirst('.property_extension, div:contains(Extension) + div');
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

/** Kotlin private `formatUrl` (L106-112), verbatim. */
function formatUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('//')) return `https:${path}`;
  const cleanBase = trimEndSlash(baseUrl);
  const cleanPath = trimStartSlash(path);
  return `${cleanBase}/${cleanPath}`;
}

/** Kotlin `String.removePrefix("/")` — single leading occurrence only. */
function removePrefixSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}

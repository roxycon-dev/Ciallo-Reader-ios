/**
 * Kotlin → TS: `source/zlibrary/parser/LegacyLayoutParser.kt` (101 lines, 84 non-blank)
 *             → `src/core/source/zlibrary/parser/legacyLayoutParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser                    → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SearchBook       → type import from '../../searchBook'
 *   L4        import com.example.source.SourceException  → `import { ParseError } from '../../sourceException'`
 *   L5        import …zlibrary.ParsedBookDetail          → type import from '../parsedBookDetail'
 *   L6        import …zlibrary.guessFileFormatFromUrl    → value import from '../parsedBookDetail'
 *   L7        import org.jsoup.nodes.Document             → type import from './htmlDocument'
 *   L9        class LegacyLayoutParser : ZLibraryLayoutParser → `implements ZLibraryLayoutParser`
 *   L11       override val name                          → `readonly name = 'LegacyLayoutParser'`
 *   L13-15    canParseSearch                             → verbatim
 *   L17-68    parseSearch                                → verbatim, per-item try/catch retained,
 *                                                          `distinctBy { it.id }` → first-wins dedupe
 *   L70-72    canParseDetail                             → verbatim
 *   L74-94    parseDetail                                → verbatim
 *   L96-100   private fun formatUrl                      → verbatim — NOTE this copy has NO
 *                                                          http/https/`//` guards (unlike the other
 *                                                          four parsers); that asymmetry is preserved
 *   L101      closing brace                              → n/a
 *
 * Adaptations:
 *   - `distinctBy { it.id }` keeps the FIRST occurrence and preserves order →
 *     `Set`-based filter loop.
 *   - `?.select{…}?.joinToString(…)?.ifBlank {…} ?: "未知作者"` (L31) — the elvis branch is
 *     unreachable; only the `ifBlank` fallback is kept.
 *   - `?.takeIf { it.length in 1..8 }` (L49) → explicit length-range check.
 *   - `?: continue` / `?: throw` → explicit null checks.
 *
 * REVIEW FIX: `img.attr("data-src").ifBlank { img.attr("src") }` (L34) is whitespace-aware;
 * the port compared against `''`, so a whitespace-only `data-src` beat a real `src`.
 */

import { ParseError } from '../../sourceException';
import { createSearchBook, type SearchBook } from '../../searchBook';
import { guessFileFormatFromUrl, type ParsedBookDetail } from '../parsedBookDetail';
import type { HtmlDocument } from './htmlDocument';
import { firstRealDownloadLink, removeLeadingSlash, trimEndSlash, trimStartSlash, type ZLibraryLayoutParser } from './zLibraryLayoutParser';

export class LegacyLayoutParser implements ZLibraryLayoutParser {
  readonly name = 'LegacyLayoutParser';

  canParseSearch(doc: HtmlDocument): boolean {
    return doc.select('a[href*=/book/]').length > 0;
  }

  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[] {
    const books: SearchBook[] = [];
    const bookLinks = doc.select('a[href*=/book/]');

    for (const link of bookLinks) {
      try {
        const rawHref = link.attr('href');
        if (rawHref.trim() === '') continue;

        const bookId = removeLeadingSlash(rawHref).trim();
        const linkText = link.text();
        const title = linkText.trim() === '' ? '未知书名' : linkText;
        if (title.length < 2) continue;

        const parent = link.parent();
        const authorJoin =
          parent !== null
            ? parent
                .select('a[href*=/g/]')
                .map((it) => it.text())
                .join(', ')
            : '';
        const author = authorJoin.trim() === '' ? '未知作者' : authorJoin;

        const parentImg = parent !== null ? parent.selectFirst('img') : null;
        // Kotlin `img.attr("data-src").ifBlank { img.attr("src") }` — `ifBlank`, not `!== ''`.
        let cover: string | null =
          parentImg !== null
            ? parentImg.attr('data-src').trim() !== ''
              ? parentImg.attr('data-src')
              : parentImg.attr('src')
            : null;
        if (cover !== null && cover.trim() !== '' && !cover.startsWith('http')) {
          cover = formatUrl(baseUrl, cover);
        }

        const dlEl = parent !== null ? parent.selectFirst('a[href*=/dl/]') : null;
        let downloadUrl: string | null = dlEl !== null ? dlEl.attr('href') : null;
        if (downloadUrl !== null && downloadUrl.trim() !== '' && !downloadUrl.startsWith('http')) {
          downloadUrl = formatUrl(baseUrl, downloadUrl);
        }
        const formatFromDl = dlEl !== null ? dlEl.text().toLowerCase().trim() : '';
        const extensionEl =
          parent !== null
            ? parent.selectFirst(
                '.property_extension, .extension, [class*=extension], [class*=format], [class*=file-type]',
              )
            : null;
        const formatFromEl = extensionEl !== null ? extensionEl.text().toLowerCase().trim() : null;
        const format =
          guessFileFormatFromUrl(downloadUrl) ??
          formatFromEl ??
          (formatFromDl.length >= 1 && formatFromDl.length <= 8 ? formatFromDl : null) ??
          'epub';

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
    // Kotlin `distinctBy { it.id }` — first occurrence wins, order preserved.
    const seen = new Set<string>();
    return books.filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    });
  }

  canParseDetail(doc: HtmlDocument): boolean {
    return doc.select('a[href*=/dl/]').length > 0;
  }

  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail {
    const dlAnchor = firstRealDownloadLink(doc);
    if (dlAnchor === null) {
      throw new ParseError('未找到通用下载链接');
    }

    let dlUrl = dlAnchor.attr('href');
    if (!dlUrl.startsWith('http')) dlUrl = formatUrl(baseUrl, dlUrl);

    const rawTitle = doc.title();
    const title = rawTitle.trim() === '' ? '未知书名' : rawTitle;

    const extensionEl = doc.selectFirst(
      '.property_extension, .extension, [class*=extension], [class*=format], [class*=file-type]',
    );
    const formatFromEl = extensionEl !== null ? extensionEl.text().toLowerCase().trim() : null;
    const format = guessFileFormatFromUrl(dlUrl) ?? formatFromEl ?? 'epub';

    return {
      title,
      author: '未知作者',
      cover: null,
      downloadUrl: dlUrl,
      format,
    };
  }
}

/** Kotlin private `formatUrl` (L96-100), verbatim — deliberately without http/https guards. */
function formatUrl(baseUrl: string, path: string): string {
  const cleanBase = trimEndSlash(baseUrl);
  const cleanPath = trimStartSlash(path);
  return `${cleanBase}/${cleanPath}`;
}

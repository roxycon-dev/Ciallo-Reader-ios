/**
 * Kotlin → TS: `source/zlibrary/parser/BookcardLayoutParser.kt` (151 lines, 128 non-blank)
 *             → `src/core/source/zlibrary/parser/bookcardLayoutParser.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.parser        → SKIPPED (TS has no packages)
 *   L3        import com.example.source.SearchBook        → type import from '../../searchBook'
 *   L4        import com.example.source.zlibrary.ParsedBookDetail → type import from '../parsedBookDetail'
 *   L5-6      import org.jsoup.nodes.Document / Element   → type import from './htmlDocument'
 *   L8-14     KDoc 新版 Z-Library 镜像布局（2025+ web-component 版本）… → preserved verbatim
 *   L15       class BookcardLayoutParser : ZLibraryLayoutParser → `class BookcardLayoutParser implements ZLibraryLayoutParser`
 *   L17       override val name = "BookcardLayoutParser"   → `readonly name = 'BookcardLayoutParser'`
 *   L19-21    canParseSearch                   → verbatim
 *   L23-72    parseSearch                      → verbatim, per-item `try/catch` retained
 *   L74-77    canParseDetail                   → verbatim
 *   L79-120   parseDetail                      → verbatim
 *   L122-135  private fun parseFileSize        → verbatim private method
 *   L137-142  private fun guessFileFormatFromUrl → verbatim private method (this file's OWN copy —
 *              distinct from the module-level `guessFileFormatFromUrl` in `zLibraryParser.ts`)
 *   L144-150  private fun formatUrl            → verbatim private method
 *   L151      closing brace                    → n/a
 *
 * Adaptations:
 *   - `SourceException.ParseError` → `ParseError` from `../sourceException` (same class, same message).
 *   - `com.example.source.SourceException.ParseError` fully-qualified at L100 → same `ParseError` import.
 *   - Kotlin `?: throw X` → `if (x === null) throw new ParseError(...)`.
 *   - Kotlin `ifBlank { "未知书名" }` → explicit ternary; `String.ifBlank` also treats
 *     whitespace-only as blank, so the guard is `.trim() === ''`.
 *   - `Long` → `number`; `toLong()` truncation → `Math.trunc`.
 *   - `.toDoubleOrNull()` → `Number(...)` + `Number.isFinite` check (same accept/reject set for
 *     the regex-captured `[\d.]+` group).
 *   - `mutableListOf<SearchBook>()` → array push.
 *   - `SearchBook(...)` named-argument constructor → `createSearchBook({ … })` from
 *     `../searchBook` (the project's constructor for the ported data class).
 *   - `catch (e: Exception) { }` → `catch { … }` (optional catch binding; the empty body keeps
 *     the original `// skip corrupted item` comment).
 *
 * REVIEW FIXES (this pass):
 *   - `parseDetail` title/format elvis chains (Kotlin L80-82 and L107-111) were collapsed into
 *     one `selectFirst(...) ?? …` element lookup plus an `!== ''` guard. Both are wrong in two
 *     ways: (a) Kotlin's `?.text()` / `?.attr(...)` only fall through when the ELEMENT is
 *     absent, so a present-but-blank element yields `""` rather than the fallback; (b) the
 *     `z-cover` title and the `z-bookcard` extension are read through `attr("title")` /
 *     `attr("extension")` in Kotlin — reading `.text()` silently picked up the component's
 *     children instead. Both chains are now spelled out branch by branch.
 *   - `ifBlank { it.attr("src") }` on `data-src` (L40, L93) is whitespace-aware; the port
 *     compared against `''`, so a blank-but-not-empty `data-src` won over `src`.
 */

import { ParseError } from '../../sourceException';
import { createSearchBook, type SearchBook } from '../../searchBook';
import type { ParsedBookDetail } from '../parsedBookDetail';
import type { HtmlDocument } from './htmlDocument';
import { firstRealDownloadLink, removeLeadingSlash, trimEndSlash, trimStartSlash, type ZLibraryLayoutParser } from './zLibraryLayoutParser';

/**
 * 新版 Z-Library 镜像布局（2025+ web-component 版本）。
 * 搜索页：每个结果是一个 <z-bookcard href="/book/xxx" download="/dl/xxx" extension="epub" filesize="9.40 MB">
 *         内含 <div slot="title">书名</div> / <div slot="author">作者</div> / <img data-src="封面">
 * 详情页：<h1 class="book-title" itemprop="name"> + <i class="authors"><a>作者</a></i> + a.dlButton[href*=/dl/]
 * 实测节点：zh.101k.by / tw.101k.by（101z.by 入口会 302 跳到 101k.by）
 */
export class BookcardLayoutParser implements ZLibraryLayoutParser {
  readonly name = 'BookcardLayoutParser';

  canParseSearch(doc: HtmlDocument): boolean {
    return doc.select('z-bookcard[href]').length > 0;
  }

  parseSearch(doc: HtmlDocument, baseUrl: string, sourceId: string): SearchBook[] {
    const books: SearchBook[] = [];
    const items = doc.select('z-bookcard[href]');
    for (const item of items) {
      try {
        const rawHref = item.attr('href');
        if (rawHref.trim() === '' || !rawHref.includes('/book/')) continue;

        const slotTitle = item.selectFirst('[slot=title]');
        const attrTitle = item.attr('title').trim();
        const title =
          slotTitle !== null ? slotTitle.text().trim() : attrTitle === '' ? '未知书名' : attrTitle;
        const slotAuthor = item.selectFirst('[slot=author]');
        const slotAuthorText = slotAuthor !== null ? slotAuthor.text().trim() : null;
        const attrAuthor = item.attr('author').trim();
        const author =
          slotAuthorText !== null && slotAuthorText !== ''
            ? slotAuthorText
            : attrAuthor !== ''
              ? attrAuthor
              : '未知作者';

        const img = item.selectFirst('img');
        // Kotlin `it.attr("data-src").ifBlank { it.attr("src") }` — `ifBlank`, so a
        // whitespace-only data-src falls back to `src` exactly as on Android.
        let cover =
          img !== null
            ? img.attr('data-src').trim() !== ''
              ? img.attr('data-src')
              : img.attr('src')
            : '';
        if (cover !== '' && !cover.startsWith('http')) {
          cover = this.formatUrl(baseUrl, cover);
        }

        const downloadAttr = item.attr('download');
        let downloadUrl: string | null = downloadAttr === '' ? null : downloadAttr;
        if (downloadUrl !== null && downloadUrl.trim() !== '' && !downloadUrl.startsWith('http')) {
          downloadUrl = this.formatUrl(baseUrl, downloadUrl);
        }

        const extensionAttr = item.attr('extension').trim().toLowerCase();
        const format = extensionAttr === '' ? 'epub' : extensionAttr;
        const sizeText = item.attr('filesize').trim();
        const size = this.parseFileSize(sizeText);

        books.push(
          createSearchBook({
            id: removeLeadingSlash(rawHref).trim(),
            sourceId,
            title,
            author,
            cover,
            format,
            size,
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
    // 详情页特征：z-cover 组件或 h1.book-title
    return doc.select('z-cover').length > 0 || doc.selectFirst('h1.book-title') !== null;
  }

  parseDetail(doc: HtmlDocument, baseUrl: string): ParsedBookDetail {
    // Kotlin `doc.selectFirst("h1.book-title, h1[itemprop=name], h1")?.text()?.trim()
    //   ?: doc.selectFirst("z-cover")?.attr("title")?.trim() ?: "未知书名"`.
    // jsoup `attr()` returns "" for a MISSING attribute but the `?.` chain only falls through
    // when the ELEMENT is absent, so a present-but-blank `<h1>` yields "" (never "未知书名")
    // and a `<z-cover>` is read through its `title` ATTRIBUTE, never its text.
    const titleEl = doc.selectFirst('h1.book-title, h1[itemprop=name], h1');
    const coverEl = doc.selectFirst('z-cover');
    let title: string | null;
    if (titleEl !== null) {
      title = titleEl.text().trim();
    } else if (coverEl !== null) {
      title = coverEl.attr('title').trim();
    } else {
      title = null;
    }
    const resolvedTitle = title ?? '未知书名';

    // 新版：作者在 <i class="authors"><a>天蚕土豆</a></i>；也可能在 z-cover author 属性
    const joinedAuthors = doc
      .select('i.authors a, .bookAuthor a, a[itemprop=author]')
      .map((it) => it.text().trim())
      .join(', ');
    const coverAuthor = coverEl !== null ? coverEl.attr('author').trim() : null;
    let author: string;
    if (joinedAuthors.trim() !== '') {
      author = joinedAuthors;
    } else if (coverAuthor !== null && coverAuthor.trim() !== '') {
      author = coverAuthor.trim();
    } else {
      author = '未知作者';
    }

    const coverImg = doc.selectFirst(
      'z-cover img, .details-book-cover-container img, img.cover, img[itemprop=image]',
    );
    let cover: string | null =
      coverImg !== null
        ? coverImg.attr('data-src').trim() !== ''
          ? coverImg.attr('data-src')
          : coverImg.attr('src')
        : null;
    if (cover !== null && cover.trim() !== '' && !cover.startsWith('http')) {
      cover = this.formatUrl(baseUrl, cover);
    }

    const dlAnchor =
      firstRealDownloadLink(doc) ?? doc.selectFirst('a.dlButton[href*=/dl/]');
    if (dlAnchor === null) {
      throw new ParseError('未找到下载链接');
    }
    let dlUrl = dlAnchor.attr('href');
    if (dlUrl.trim() === '') throw new ParseError('解析下载链接为空');
    if (!dlUrl.startsWith('http')) dlUrl = this.formatUrl(baseUrl, dlUrl);

    // 新版格式在按钮附近：.book-property__extension 或 z-bookcard extension 属性；
    // 旧版：.property_extension
    // Same elvis rule as the title: an ELEMENT that is present wins even when its text is
    // blank (jsoup `text()` is non-null), and `z-bookcard` is read through `attr("extension")`.
    const formatEl = doc.selectFirst('.book-property__extension, .property_extension');
    const bookcardEl = doc.selectFirst('z-bookcard');
    let format: string | null;
    if (formatEl !== null) {
      format = formatEl.text().trim().toLowerCase();
    } else if (bookcardEl !== null) {
      format = bookcardEl.attr('extension').trim().toLowerCase();
    } else {
      format = null;
    }
    const resolvedFormat = format ?? this.guessFileFormatFromUrl(dlUrl) ?? 'epub';

    return {
      title: resolvedTitle,
      author,
      cover,
      downloadUrl: dlUrl,
      format: resolvedFormat,
    };
  }

  /** "9.40 MB" / "604 KB" -> 字节数 */
  private parseFileSize(text: string): number | null {
    if (text.trim() === '') return null;
    const m = /([\d.]+)\s*(B|KB|MB|GB|TB)/i.exec(text);
    if (m === null) return null;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return null;
    const unit = (m[2] ?? '').toUpperCase();
    let multiplier: number;
    switch (unit) {
      case 'B':
        multiplier = 1.0;
        break;
      case 'KB':
        multiplier = 1024.0;
        break;
      case 'MB':
        multiplier = 1024.0 * 1024.0;
        break;
      case 'GB':
        multiplier = 1024.0 * 1024.0 * 1024.0;
        break;
      case 'TB':
        multiplier = 1024.0 * 1024.0 * 1024.0 * 1024.0;
        break;
      default:
        return null;
    }
    const bytes = Math.trunc(value * multiplier);
    return bytes > 0 ? bytes : null;
  }

  /** 从下载 URL 后缀猜测文件格式，猜不出返回 null */
  private guessFileFormatFromUrl(url: string): string | null {
    const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
    if (m === null) return null;
    return (m[1] ?? '').toLowerCase();
  }

  private formatUrl(baseUrl: string, path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('//')) return `https:${path}`;
    const cleanBase = trimEndSlash(baseUrl);
    const cleanPath = trimStartSlash(path);
    return `${cleanBase}/${cleanPath}`;
  }
}

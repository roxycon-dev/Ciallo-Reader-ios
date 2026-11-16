/**
 * Android source: `com.example.source.impl.AliceSwParser.kt`（186 行）→ 本文件。
 *
 * 爱丽丝书屋（alicesw）页面解析。站点是传统服务端渲染的 PHP 站点，搜索/详情/目录/正文
 * 都能直接拿完整 HTML，正文免登录。作品页 `/novel/{作品id}.html`，目录页
 * `/other/chapters/id/{作品id}.html`，正文页 `/book/{书库id}/{章节hash}.html`——目录页用的
 * 是作品 id，正文链接里的是书库 id，两者不同，所以章节标识保存为 `书库id/章节hash`。
 *
 * 行号映射（Kotlin → TS）：
 *   L23-L28 正则常量                → NOVEL_HREF / CHAPTER_HREF / WORD_COUNT / UPDATED_AT /
 *                                     TAG_PREFIX / LIST_INDEX_PREFIX
 *   L31-L66 books()                 → AliceSwParser.books()
 *   L69-L107 detail()               → AliceSwParser.detail()
 *   L110-L123 chapters()            → AliceSwParser.chapters()
 *   L126-L135 chapterText()         → AliceSwParser.chapterText()
 *   L138-L151 infoFields()          → infoFields()
 *   L154-L158 tagsOf()              → tagsOf()
 *   L160-L163 statusOf()            → statusOf()
 *   L165-L175 coverOf()             → coverOf()
 *   L178 isBookId()                 → AliceSwParser.isBookId()
 *   L181-L185 parseChapterId()      → AliceSwParser.parseChapterId()
 *
 * 未移植项：
 *  - Kotlin 返回 `Pair<String, String>`；TS 用 `{ bookKey, hash }` 具名对象，调用点等价。
 *  - `chapters(html, sourceId)` 的 `sourceId` 在 Kotlin 里从未被读，保留占位参数以维持调用形状。
 *  - jsoup → `./jsoup.ts` 的 `parseHtmlDocument`（同一 jsoup 子集，选择器逐字照搬）。
 */

import { createComicChapter, type ComicChapter } from '../comicChapter';
import { createNovelInfo } from '../novelInfo';
import { createSearchBook, type SearchBook } from '../searchBook';
import { BookNotFound, ParseError } from '../sourceException';
import { parseHtmlDocument, type HtmlDocument, type HtmlElement } from './jsoup';

const NOVEL_HREF = /\/novel\/(\d{1,9})\.html/;
const CHAPTER_HREF = /\/book\/(\d{1,9})\/([0-9a-f]{8,16})\.html/;
const WORD_COUNT = /字数：\s*([0-9]+(?:\.[0-9]+)?万?)/;
const UPDATED_AT = /更新时间：\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/;
const TAG_PREFIX = /^#\s*/;
const LIST_INDEX_PREFIX = /^\d+[.、]\s*/;
const BOOK_ID = /^\d{1,9}$/;
const CHAPTER_ID = /^(\d{1,9})\/([0-9a-f]{8,16})$/;

/** 只认站内的标签链接（`?f=tag`）；列表项里的作者链接同样是 text-muted 子节点。 */
function tagsOf(links: readonly HtmlElement[]): string[] {
  const tags: string[] = [];
  for (const link of links) {
    if (!link.attr('href').includes('f=tag')) continue;
    const text = link.text().trim().replace(TAG_PREFIX, '').trim();
    if (text !== '' && !tags.includes(text)) tags.push(text);
  }
  return tags;
}

function statusOf(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let value = raw.trim();
  // Kotlin `removeSurrounding("[", "]")` 只在前后缀都在且长度足够时切除。
  if (value.length >= 2 && value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : null;
}

function coverOf(doc: HtmlDocument): string | null {
  const img = doc.selectFirst('div.box_intro img');
  if (img === null) return null;
  const dataSrc = img.attr('data-src');
  const raw = (dataSrc !== '' ? dataSrc : img.attr('src')).trim();
  if (raw === '') return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://')) return raw.replace(/^http:\/\//, 'https://');
  if (raw.startsWith('https://')) return raw;
  return null;
}

/** 详情页信息行：同一行可能用 `·` 并排两个字段（如「字 数：12.12万 · 章 节：11」）。 */
function infoFields(doc: HtmlDocument): Map<string, string> {
  const fields = new Map<string, string>();
  for (const row of doc.select('div.novel_info p')) {
    for (const segment of row.text().split('·')) {
      const index = segment.indexOf('：');
      if (index <= 0) continue;
      const key = segment.slice(0, index).replace(/ /g, '').replace(/\u00a0/g, '').trim();
      const value = segment.slice(index + 1).trim();
      if (key !== '' && value !== '') fields.set(key, value);
    }
  }
  return fields;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : null;
}

export const AliceSwParser = {
  /** 搜索结果列表；关键字命中高亮用 `<em>` 包住，text() 后自然还原。 */
  books(html: string, sourceId: string): SearchBook[] {
    const doc = parseHtmlDocument(html);
    const books: SearchBook[] = [];
    for (const item of doc.select('div.list-group div.list-group-item')) {
      const link = item.selectFirst('h5 a[href]');
      if (link === null) continue;
      const bookId = NOVEL_HREF.exec(link.attr('href'))?.[1];
      if (bookId === undefined) continue;
      // 列表标题带序号前缀（"1. xxx"），去掉后再入库，否则书名会被污染。
      const title = link.text().trim().replace(LIST_INDEX_PREFIX, '').trim();
      if (title === '') continue;
      const meta = item.selectFirst('p.mb-1')?.text() ?? '';
      const author = item.selectFirst('p.mb-1 a[href*=f=author]')?.text().trim() ?? '';
      const intro = nonEmpty(item.selectFirst('p.content-txt')?.text());
      const tags = tagsOf(item.select('p.text-muted a[href]'));
      const updatedAt = UPDATED_AT.exec(item.selectFirst('p.timedesc')?.text() ?? '')?.[1];
      books.push(
        createSearchBook({
          id: bookId,
          sourceId,
          title,
          author: author !== '' ? author : '未知作者',
          description: intro,
          format: 'epub',
          language: '中文',
          novelInfo: createNovelInfo({
            synopsis: intro,
            status: statusOf(item.selectFirst('h5 small')?.text()),
            updatedAt: updatedAt ?? null,
            wordCount: WORD_COUNT.exec(meta)?.[1] ?? null,
            tags,
            translation: '中文',
          }),
        }),
      );
    }
    // Kotlin `distinctBy { it.id }`：保留首次出现。
    const seen = new Set<string>();
    return books.filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    });
  },

  /** 作品详情页：书名、作者、分类、字数、章节数、最新章节、标签与简介。 */
  detail(html: string, bookId: string, sourceId: string): SearchBook {
    const doc = parseHtmlDocument(html);
    const title =
      nonEmpty(doc.selectFirst('div.novel_title')?.text()) ??
      nonEmpty(doc.selectFirst('div.mu_h1 h1')?.text());
    if (title === null) throw new ParseError('爱丽丝书屋未返回作品标题，页面可能已变化');
    const info = infoFields(doc);
    // Kotlin `doc.selectFirst("div.jianjie p")?.text()?.trim()?.takeIf { … }
    //   ?: doc.selectFirst("div.jianjie")?.text()?.trim()?.removePrefix("内容简介：")?.takeIf { … }`
    // —— 第二分支只在去掉前缀后判空，不再二次 trim。
    const paragraphIntro = nonEmpty(doc.selectFirst('div.jianjie p')?.text());
    const blockIntro = (doc.selectFirst('div.jianjie')?.text().trim() ?? '').replace(/^内容简介：/, '');
    const synopsis = paragraphIntro ?? (blockIntro !== '' ? blockIntro : null);
    const latestRow = info.get('最新') ?? '';
    const latestUpdatedAt =
      UPDATED_AT.exec(doc.selectFirst('div.book_newchap div.con li em')?.text() ?? '')?.[1] ?? '';
    const tags = tagsOf(doc.select('div.tags_list a[href]'));
    const chapterCount = toIntOrNull(info.get('章节'));
    return createSearchBook({
      id: bookId,
      sourceId,
      title,
      author: nonEmpty(info.get('作者')) ?? '未知作者',
      cover: coverOf(doc),
      description: synopsis,
      format: 'epub',
      language: '中文',
      novelInfo: createNovelInfo({
        synopsis,
        status: nonEmpty(info.get('状态')),
        category: nonEmpty(info.get('分类')),
        latestChapter: latestRow.trim() !== '' ? latestRow : null,
        updatedAt: latestUpdatedAt !== '' ? latestUpdatedAt : null,
        chapterCount: chapterCount !== null && chapterCount > 0 ? chapterCount : null,
        wordCount: nonEmpty(info.get('字数')),
        tags,
        translation: '中文',
        notice: '正文免登录公开；整本下载会逐章抓取并复核目录，任何一章失败都不会标记完成。',
      }),
    });
  },

  /** 目录页：`ul.mulu_list` 里的顺序就是阅读顺序，order 直接取列表位置。 */
  chapters(html: string, _sourceId?: string): ComicChapter[] {
    const doc = parseHtmlDocument(html);
    const chapters: ComicChapter[] = [];
    for (const link of doc.select('ul.mulu_list li a[href]')) {
      const match = CHAPTER_HREF.exec(link.attr('href'));
      if (match === null) continue;
      const title = link.text().trim() !== '' ? link.text().trim() : `第 ${chapters.length + 1} 节`;
      chapters.push(
        createComicChapter({ id: `${match[1]!}/${match[2]!}`, title, order: chapters.length + 1 }),
      );
    }
    // Kotlin `distinctBy { it.id }`：order 在去重前已按列表位置写好。
    const seen = new Set<string>();
    return chapters.filter((chapter) => {
      if (seen.has(chapter.id)) return false;
      seen.add(chapter.id);
      return true;
    });
  },

  /** 正文页：`div.read-content` 内的 `<p>` 段落，用空行拼接成纯文本。 */
  chapterText(html: string): string {
    const doc = parseHtmlDocument(html);
    const body = doc.selectFirst('div.read-content');
    if (body === null) throw new BookNotFound();
    const paragraphs = body
      .select('p')
      .map((paragraph) => paragraph.text().trim())
      .filter((paragraph) => paragraph !== '');
    if (paragraphs.length === 0) throw new ParseError('本章正文为空，可能已下架或需要登录');
    return paragraphs.join('\n\n');
  },

  /** 站点列表页/详情页里作品 id 的合法性（纯数字作品号）。 */
  isBookId(raw: string): boolean {
    return BOOK_ID.test(raw);
  },

  /** 章节标识必须是 `书库id/章节hash`，避免把站外地址塞进下载链路。 */
  parseChapterId(raw: string): { bookKey: string; hash: string } {
    const match = CHAPTER_ID.exec(raw.trim());
    if (match === null) throw new ParseError('爱丽丝书屋章节标识无效');
    return { bookKey: match[1]!, hash: match[2]! };
  },
};

/** Kotlin `String.toIntOrNull()`：只接受完整的十进制整数。 */
function toIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
}

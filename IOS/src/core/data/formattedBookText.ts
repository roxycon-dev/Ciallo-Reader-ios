/**
 * `data/FormattedBookText.kt`（264 行）→ `src/core/data/formattedBookText.ts`。
 *
 * 这是「带样式的正文」的唯一数据通路：EPUB / DOCX / Markdown 导入时把 HTML 转成
 * `FormattedBookText`（纯文本 + span 列表 + 书写方向），落库时 span 编成
 * `"start,end,style;…"` 字符串塞进 `chapters.formatting`，阅读器按章解码后交给
 * `AnnotatedString` 上色。
 *
 * 三处容易写错的地方（每条都在下面代码里有对应注释）：
 *
 * 1. **`spansIn` 用 `binarySearchBy(start + 1) { it.end }`** —— 找第一个
 *    `end > start` 的 span，`-found - 1` 把「插入点」还原成下标。写成线性过滤
 *    在大章（3 万字符、几千 span）上会拖慢滚动。
 * 2. **`StyledTextBuilder.append` 会改写上一个 span 的 `end`** —— 相邻同 style 的
 *    文本要合并成一段；若上一个 span 跨过了新文本的起点（嵌套标签），则把它的
 *    `end` 截到新起点（`start` 更早时）或整条丢弃。少了这个，嵌套 `<b><i>x</i></b>`
 *    会产出重叠 span，渲染时后写的覆盖前面的。
 * 3. **`cssFlags` 的 `font-weight: normal` / `font-style: normal` 是「清除」而不是
 *    「忽略」** —— 继承下来的 Bold 必须能被内层的 `normal` 取消，否则
 *    `<b><span style="font-weight:normal">x</span></b>` 仍然是粗体。
 */
import { MAX_CHAPTER_LENGTH, splitChapterText } from './splitChapterText';
import { parseHtmlDocument, HtmlElement, HtmlTextNode, type HtmlChildNode } from '../source/zlibrary/parser/htmlDocument';
import type { Chapter } from './chapterMerger';

/* ── L7 `data class BookTextSpan(start, end, style)` ─────────────────────── */
export interface BookTextSpan {
  readonly start: number;
  readonly end: number;
  readonly style: number;
}

/* ── L9-20 `object BookTextStyle`：十个位标志 ─────────────────────────────── */
export const BookTextStyle = {
  Bold: 1,
  Italic: 2,
  Underline: 4,
  Strike: 8,
  Code: 16,
  Super: 32,
  Sub: 64,
  Heading: 128,
  Quote: 256,
  Table: 512,
} as const;

/** `style in 1..1023`（L52）—— 十个标志的并集最大值。 */
export const BOOK_TEXT_STYLE_MAX = 1023;

/* ── L22-40 `data class FormattedBookText` ───────────────────────────────── */
export interface FormattedBookText {
  readonly text: string;
  readonly spans: readonly BookTextSpan[];
  readonly writingMode: string | null;
}

export function createFormattedBookText(
  text: string,
  spans: readonly BookTextSpan[] = [],
  writingMode: string | null = null,
): FormattedBookText {
  return { text, spans, writingMode };
}

/**
 * L27-39 `FormattedBookText.chapters(bookId, order, title, limit)`。
 *
 * 超长正文按 `splitChapterText` 切章，每段的 span 先裁到段内再整体平移 ——
 * `maxOf(it.start, offset) - offset` / `minOf(it.end, end) - offset`。
 * 标题只有第一章用原名，其余追加 `" (续N)"`。
 */
export function formattedBookChapters(
  book: FormattedBookText,
  bookId: number,
  order: number,
  title: string,
  limit: number = MAX_CHAPTER_LENGTH,
): Chapter[] {
  let offset = 0;
  return splitChapterText(book.text, limit).map((part, index) => {
    const end = offset + part.length;
    const styles: BookTextSpan[] = [];
    for (const span of spansIn(book.spans, offset, end)) {
      styles.push({ start: Math.max(span.start, offset) - offset, end: Math.min(span.end, end) - offset, style: span.style });
    }
    const chapter = {
      id: 0,
      bookId,
      chapterOrder: order + index,
      title: index === 0 ? title : `${title} (续${String(index + 1)})`,
      content: part,
      startCharIndex: 0,
      endCharIndex: part.length,
      formatting: encodeBookSpans(styles),
      writingMode: book.writingMode,
    } as Chapter;
    offset = end;
    return chapter;
  });
}

/* ── L42-43 `encodeBookSpans` ────────────────────────────────────────────── */
export function encodeBookSpans(spans: readonly BookTextSpan[]): string | null {
  if (spans.length === 0) return null;
  return spans.map((span) => `${String(span.start)},${String(span.end)},${String(span.style)}`).join(';');
}

/* ── L45-53 `decodeBookSpans` ────────────────────────────────────────────── */
export const MAX_DECODED_SPANS = 120_000;

export function decodeBookSpans(value: string | null | undefined): BookTextSpan[] {
  if (value === null || value === undefined) return [];
  const out: BookTextSpan[] = [];
  for (const entry of value.split(';').slice(0, MAX_DECODED_SPANS)) {
    const fields = entry.split(',');
    if (fields.length !== 3) continue;
    const start = toIntOrNull(fields[0] as string);
    const end = toIntOrNull(fields[1] as string);
    const style = toIntOrNull(fields[2] as string);
    if (start === null || end === null || style === null) continue;
    if (start >= 0 && end > start && style >= 1 && style <= BOOK_TEXT_STYLE_MAX) {
      out.push({ start, end, style });
    }
  }
  return out;
}

/** Kotlin `String.toIntOrNull()` —— 只接受可选符号 + 纯数字，溢出返回 null。 */
function toIntOrNull(raw: string): number | null {
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
}

/**
 * L55-59 `spansIn(spans, start, end)`。
 *
 * 先用 `binarySearchBy(start + 1) { it.end }` 找到第一个 `end >= start + 1`
 * （即 `end > start`）的 span，再顺序取到 `start >= end` 为止 —— span 列表按
 * `end` 升序（编码时由构建器保证），所以这是一次二分 + 一次线性扫描。
 */
export function spansIn(spans: readonly BookTextSpan[], start: number, end: number): BookTextSpan[] {
  const found = binarySearchBy(spans, start + 1, (span) => span.end);
  const index = found >= 0 ? found : -found - 1;
  const out: BookTextSpan[] = [];
  for (let i = index; i < spans.length; i += 1) {
    const span = spans[i] as BookTextSpan;
    if (!(span.start < end)) break;
    out.push(span);
  }
  return out;
}

/** Kotlin `List.binarySearchBy(key) { selector }` —— 返回下标或 `-(插入点) - 1`。 */
function binarySearchBy<T>(items: readonly T[], key: number, selector: (item: T) => number): number {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = selector(items[mid] as T);
    if (value < key) low = mid + 1;
    else if (value > key) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/* ── L61-73 `mergeChapterParts` ──────────────────────────────────────────── */
export function mergeChapterParts(metadata: Chapter, parts: readonly Chapter[]): Chapter {
  let text = '';
  const spans: BookTextSpan[] = [];
  for (const part of parts) {
    const offset = text.length;
    for (const span of decodeBookSpans(part.formatting)) {
      if (span.end > part.content.length) continue;
      spans.push({ start: span.start + offset, end: span.end + offset, style: span.style });
    }
    text += part.content;
  }
  return { ...metadata, content: text, formatting: encodeBookSpans(spans) };
}

/* ── L75-80 正则表 ───────────────────────────────────────────────────────── */
const HTML_FORMAT_RULE = /([^{}]+)\{([^{}]+)\}/g;
const BOOK_IMAGE_TOKEN = /\[IMG:[^\]]*\]/g;
const HORIZONTAL_SPACE = /[\t\n\r\f ]+/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\b/i;
const CSS_WRITING_MODE = /(?:^|;)\s*(?:-(?:epub|webkit)-)?writing-mode\s*:\s*(vertical-rl|vertical-lr|horizontal-tb|tb-rl|tb-lr)\b/i;

const MAX_STYLE_SHEET_CHARS = 512_000;
const MAX_STYLE_RULES = 800;
const MAX_DECLARATION_CHARS = 4096;

/* ── L82-87 `normalizeWritingMode` ───────────────────────────────────────── */
export function normalizeWritingMode(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/_/g, '-');
  switch (normalized) {
    case 'vertical-rl':
    case 'tb-rl':
      return 'vertical-rl';
    case 'vertical-lr':
    case 'tb-lr':
      return 'vertical-lr';
    case 'horizontal-tb':
    case 'horizontal-lr':
    case 'horizontal-rl':
    case 'lr-tb':
      return 'horizontal-tb';
    default:
      return null;
  }
}

/* ── L89-143 `readBookHtml` ──────────────────────────────────────────────── */
export function readBookHtml(
  html: string,
  styleSheets: readonly string[] = [],
  defaultWritingMode: string | null = null,
): FormattedBookText {
  const doc = parseHtmlDocument(html);
  const body = findBody(doc) ?? doc;

  const sheets: string[] = [...styleSheets];
  for (const style of doc.select('style')) sheets.push(style.text());
  const rules: RegExpExecArray[] = [];
  for (const sheet of sheets) {
    const cleaned = sheet.slice(0, MAX_STYLE_SHEET_CHARS).replace(CSS_COMMENT, '');
    HTML_FORMAT_RULE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HTML_FORMAT_RULE.exec(cleaned)) !== null) {
      rules.push(match);
      if (rules.length >= MAX_STYLE_RULES) break;
    }
    if (rules.length >= MAX_STYLE_RULES) break;
  }

  const cssByElement = new Map<HtmlElement, string>();
  for (const rule of rules) {
    const selector = (rule[1] ?? '').trim();
    const declarations = (rule[2] ?? '').trim();
    if (selector === '' || selector.startsWith('@') || declarations.length > MAX_DECLARATION_CHARS) continue;
    const hasFlags = cssFlags(declarations, 0) !== 0;
    const hasMode = CSS_WRITING_MODE.test(declarations);
    if (!hasFlags && !hasMode && !includesIgnoreCase(declarations, 'normal') && !includesIgnoreCase(declarations, 'display')) {
      continue;
    }
    let selected: HtmlElement[];
    try {
      selected = doc.select(selector);
    } catch {
      continue;
    }
    for (const element of selected) {
      cssByElement.set(element, `${cssByElement.get(element) ?? ''};${declarations}`);
    }
  }

  const css = (element: HtmlElement): string => `${cssByElement.get(element) ?? ''};${element.attr('style')}`;
  const mode = (element: HtmlElement): string | null => {
    const found = [...css(element).matchAll(new RegExp(CSS_WRITING_MODE.source, 'gi'))];
    const last = found[found.length - 1];
    return normalizeWritingMode(last?.[1] ?? null);
  };

  let epubMeta: string | null = null;
  const metas = doc.select('meta[name]');
  for (let i = metas.length - 1; i >= 0; i -= 1) {
    const meta = metas[i] as HtmlElement;
    if (meta.attr('name').toLowerCase() === 'primary-writing-mode') {
      epubMeta = meta.attr('content');
      break;
    }
  }
  const singleBodyChild = body.children().length === 1 ? (body.children()[0] as HtmlElement) : null;
  const writingMode =
    mode(body) ??
    (() => {
      const root = doc.selectFirst('html');
      return root === null ? null : mode(root);
    })() ??
    (singleBodyChild === null ? null : mode(singleBodyChild)) ??
    normalizeWritingMode(epubMeta) ??
    defaultWritingMode;

  for (const element of doc.select('script, style, template, iframe, object, noscript, rt, rp, [hidden]')) {
    element.remove();
  }

  const text = new StyledTextBuilder();
  const visit = (element: HtmlElement, inherited: number, pre: boolean): void => {
    const tag = element.tagName;
    const computed = css(element);
    if (CSS_DISPLAY_NONE.test(computed)) return;
    const flags = cssFlags(computed, inherited | tagFlags(tag));
    const preserve = pre || tag === 'pre';
    if (tag === 'br') {
      text.breakLine(false);
      return;
    }
    if (tag === 'hr') {
      text.breakLine(true);
      text.append('────────', 0);
      text.breakLine(true);
      return;
    }
    if (isBlockTag(tag) && !TABLE_CELLS.has(tag)) text.breakLine(!COMPACT_BLOCKS.has(tag));
    if (TABLE_CELLS.has(tag) && elementSiblingIndex(element) > 0) text.append(' │ ', BookTextStyle.Table);
    if (tag === 'li') {
      const parent = element.parent();
      let prefix = '• ';
      if (parent !== null && parent.tagName === 'ol') {
        const first = toIntOrNull(parent.attr('start')) ?? 1;
        const number = toIntOrNull(element.attr('value')) ?? first + elementSiblingIndex(element);
        prefix = `${String(number)}. `;
      }
      text.append(prefix, flags);
    }
    for (const node of element.childNodes) {
      if (node instanceof HtmlTextNode) {
        text.append(preserve ? node.data.replace(/\r\n/g, '\n') : collapseBookWhitespace(node.data), flags, preserve);
      } else if (node instanceof HtmlElement) {
        visit(node, flags, preserve);
      }
    }
    if (isBlockTag(tag) && !TABLE_CELLS.has(tag)) text.breakLine(!COMPACT_BLOCKS.has(tag));
  };
  visit(body, 0, false);
  return text.build(writingMode);
}

function findBody(root: HtmlElement): HtmlElement | null {
  const body = root.selectFirst('body');
  return body ?? null;
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/* ── L145-156 `collapseBookWhitespace` ───────────────────────────────────── */
export function collapseBookWhitespace(text: string): string {
  if (!text.includes('[IMG:')) return text.replace(HORIZONTAL_SPACE, ' ');
  let out = '';
  let offset = 0;
  BOOK_IMAGE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOOK_IMAGE_TOKEN.exec(text)) !== null) {
    out += text.slice(offset, match.index).replace(HORIZONTAL_SPACE, ' ');
    out += match[0];
    offset = match.index + match[0].length;
  }
  out += text.slice(offset).replace(HORIZONTAL_SPACE, ' ');
  return out;
}

/* ── L158-175 标签表 ─────────────────────────────────────────────────────── */
const TABLE_CELLS: ReadonlySet<string> = new Set(['td', 'th']);
const COMPACT_BLOCKS: ReadonlySet<string> = new Set(['li', 'tr', 'thead', 'tbody', 'tfoot']);

/** jsoup `Element.isBlock` 的等价集合（HTML 块级元素）。 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup',
  'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'isindex', 'legend', 'li', 'main', 'menu', 'menuitem', 'nav', 'noframes',
  'ol', 'optgroup', 'option', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'title', 'tr', 'ul',
]);

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

/** jsoup `Element.elementSiblingIndex()` —— 前面有几个**元素**兄弟。 */
function elementSiblingIndex(element: HtmlElement): number {
  const parent = element.parent();
  if (parent === null) return 0;
  let index = 0;
  for (const node of parent.childNodes as readonly (HtmlElement | HtmlChildNode)[]) {
    if (node === element) return index;
    if (node instanceof HtmlElement) index += 1;
  }
  return index;
}

/* ── L161-175 `tagFlags` ─────────────────────────────────────────────────── */
export function tagFlags(tag: string): number {
  const S = BookTextStyle;
  switch (tag) {
    case 'b':
    case 'strong':
    case 'th':
      return S.Bold;
    case 'em':
    case 'i':
    case 'cite':
    case 'emphasis':
      return S.Italic;
    case 'u':
    case 'ins':
      return S.Underline;
    case 'del':
    case 's':
    case 'strike':
    case 'strikethrough':
      return S.Strike;
    case 'tt':
    case 'pre':
    case 'code':
    case 'kbd':
    case 'samp':
      return S.Code;
    case 'sup':
      return S.Super;
    case 'sub':
      return S.Sub;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return S.Heading | S.Bold;
    case 'blockquote':
      return S.Quote;
    case 'table':
      return S.Table;
    default:
      return 0;
  }
}

/* ── L177-204 `cssFlags` ─────────────────────────────────────────────────── */
export function cssFlags(css: string, inherited: number): number {
  const S = BookTextStyle;
  let flags = inherited;
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':');
    const key = (colon < 0 ? declaration : declaration.slice(0, colon)).trim().toLowerCase();
    const rawValue = colon < 0 ? '' : declaration.slice(colon + 1);
    const bang = rawValue.indexOf('!');
    const value = (bang < 0 ? rawValue : rawValue.slice(0, bang)).trim().toLowerCase();
    switch (key) {
      case 'font-weight': {
        const numeric = toIntOrNull(value) ?? 0;
        if (value === 'bold' || value === 'bolder' || numeric >= 600) flags |= S.Bold;
        else if (value === 'normal' || (numeric >= 100 && numeric <= 500)) flags &= ~S.Bold;
        break;
      }
      case 'font-style':
        if (value.startsWith('italic') || value.startsWith('oblique')) flags |= S.Italic;
        else if (value === 'normal') flags &= ~S.Italic;
        break;
      case 'text-decoration':
      case 'text-decoration-line':
        if (value.includes('underline')) flags |= S.Underline;
        if (value.includes('line-through')) flags |= S.Strike;
        break;
      case 'font-family':
        if (value.includes('monospace')) flags |= S.Code;
        break;
      case 'vertical-align':
        if (value === 'super') flags |= S.Super;
        else if (value === 'sub') flags |= S.Sub;
        break;
      default:
        break;
    }
  }
  return flags;
}

/* ── L206-254 `StyledTextBuilder` ────────────────────────────────────────── */
export class StyledTextBuilder {
  private buffer = '';
  private readonly spans: BookTextSpan[] = [];
  private pendingBreak = 0;

  /** L211-213 `breakLine(paragraph)`：段落 2 个换行、软换行 1 个，取最大值。 */
  breakLine(paragraph: boolean): void {
    this.pendingBreak = Math.max(this.pendingBreak, paragraph ? 2 : 1);
  }

  /** L215-238 `append(text, style, preserve)`。 */
  append(text: string, style: number, preserve = false): void {
    let value = text;
    if (!preserve && (this.pendingBreak > 0 || this.buffer === '' || this.buffer.endsWith(' '))) {
      value = value.replace(/^ +/, '');
    }
    if (value === '') return;
    if (this.pendingBreak > 0 && this.buffer !== '') {
      while (this.buffer.endsWith(' ')) this.buffer = this.buffer.slice(0, -1);
      this.buffer += '\n'.repeat(this.pendingBreak);
    }
    this.pendingBreak = 0;
    const start = this.buffer.length;
    this.buffer += value;
    if (style === 0) return;

    const previous = this.spans[this.spans.length - 1];
    if (previous !== undefined && previous.style === style && previous.end >= start) {
      this.spans[this.spans.length - 1] = { start: previous.start, end: this.buffer.length, style };
      return;
    }
    if (previous !== undefined && previous.end > start) {
      if (previous.start < start) this.spans[this.spans.length - 1] = { start: previous.start, end: start, style: previous.style };
      else this.spans.pop();
    }
    this.spans.push({ start, end: this.buffer.length, style });
  }

  /** L240-248 `append(text: FormattedBookText)` —— 按已有 span 逐段重放。 */
  appendFormatted(text: FormattedBookText): void {
    let offset = 0;
    for (const span of text.spans) {
      if (span.start > offset) this.append(text.text.slice(offset, span.start), 0, true);
      this.append(text.text.slice(span.start, span.end), span.style, true);
      offset = span.end;
    }
    if (offset < text.text.length) this.append(text.text.slice(offset), 0, true);
  }

  /** L250-253 `build(mode)`：末尾 trim，span 一并截断。 */
  build(mode: string | null = null): FormattedBookText {
    const raw = this.buffer;
    const text = raw.replace(/\s+$/, '');
    const spans = this.spans
      .filter((span) => span.start < text.length)
      .map((span) => ({ start: span.start, end: Math.min(span.end, text.length), style: span.style }));
    return { text, spans, writingMode: mode };
  }
}

/* ── L256-263 `compatibleReaderColumns` ──────────────────────────────────── */
export function compatibleReaderColumns(table: string, actual: ReadonlySet<string>, expected: ReadonlySet<string>): boolean {
  let optional: ReadonlySet<string> = new Set();
  if (table === 'chapters') optional = new Set(['formatting', 'writingMode']);
  else if (table === 'highlights') optional = new Set(['startOffset', 'endOffset', 'markStyle']);
  for (const column of actual) if (!expected.has(column)) return false;
  for (const column of expected) if (!actual.has(column) && !optional.has(column)) return false;
  return true;
}

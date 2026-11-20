/**
 * `data/DocxBookLayout.kt`（128 行）→ `src/core/data/docxBookLayout.ts`。
 *
 * DOCX（OOXML）的段落解析：样式继承、编号列表、run 级格式、表格。
 *
 * OOXML 的标签带命名空间前缀（`<w:p>`、`<w:rPr>`），且**前缀大小写不固定**。
 * Kotlin 用 `normalName().substringAfter(':')` 统一剥前缀再比对，这里照抄 ——
 * 直接按 `w:p` 匹配会在 `<w:pict>`、`<w:br>` 上误命中。
 *
 * 三处容易写错：
 * 1. **`styleFlags` 最多递归 8 层**（`basedOn` 链），防样式循环引用把栈打爆。
 * 2. **编号计数按 `(numId, ilvl)` 分桶**，且 `start` 缺省为 1 —— 同一份列表的
 *    不同层级各自计数，`decimal` 用 `N. `、其余用 `• `。
 * 3. **表格单元格里的段落先转成 span，再整体覆盖 `Table` 位**（`tableSpans`）——
 *    单元格里的粗体/斜体要保留，同时整段标成表格样式。
 */
import { getAllElements, parseHtmlDocument, type HtmlElement } from '../source/zlibrary/parser/htmlDocument';
import { BookTextStyle, StyledTextBuilder, type BookTextSpan, type FormattedBookText } from './formattedBookText';

/** L8 `data class DocxParagraph(text, isHeading = false, compact = false)`。 */
export interface DocxParagraph {
  readonly text: FormattedBookText;
  readonly isHeading: boolean;
  readonly compact: boolean;
}

/** L10 `Element.wordTag()` —— 去掉命名空间前缀后的本地名。 */
export function wordTag(element: HtmlElement): string {
  const name = element.tagName;
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** L11 `Element.childNamed(name)` —— 第一个本地名匹配的子**元素**。 */
export function childNamed(element: HtmlElement, name: string): HtmlElement | null {
  for (const child of element.children()) {
    if (wordTag(child) === name) return child;
  }
  return null;
}

/**
 * L12-14 `Element.wordValue(name = "val")` —— 取属性名（去前缀、忽略大小写）匹配的第一个值。
 *
 * OOXML 写作 `w:val`，所以不能直接 `attr('val')`。
 */
export function wordValue(element: HtmlElement, name = 'val'): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(element.attributes)) {
    const colon = key.indexOf(':');
    const local = (colon < 0 ? key : key.slice(colon + 1)).toLowerCase();
    if (local === wanted) return value;
  }
  return '';
}

/** L15 `wordDocument(xml)` —— OOXML 片段按 XML 解析（这里复用 HTML 解析器的容错）。 */
export function wordDocument(xml: string): HtmlElement {
  return parseHtmlDocument(xml);
}

/** L17-95 `docxParagraphs(xml, stylesXml, numberingXml, images)`。 */
export function docxParagraphs(
  xml: string,
  stylesXml: string,
  numberingXml: string,
  images: ReadonlyMap<string, string>,
  imageSize: (path: string) => { width: number; height: number } | null = () => null,
): DocxParagraph[] {
  const styleIndex = new Map<string, HtmlElement>();
  for (const element of getAllElements(wordDocument(stylesXml))) {
    if (wordTag(element) === 'style') styleIndex.set(wordValue(element, 'styleId'), element);
  }

  const definitions = getAllElements(wordDocument(numberingXml));
  const numbering = new Map<string, string>();
  for (const element of definitions) {
    if (wordTag(element) !== 'num') continue;
    const abstract = childNamed(element, 'abstractnumid');
    numbering.set(wordValue(element, 'numId'), abstract === null ? '' : wordValue(abstract));
  }

  const listKinds = new Map<string, Map<string, readonly [string | null, number | null]>>();
  for (const definition of definitions) {
    if (wordTag(definition) !== 'abstractnum') continue;
    const levels = new Map<string, readonly [string | null, number | null]>();
    for (const level of definition.children()) {
      if (wordTag(level) !== 'lvl') continue;
      const format = childNamed(level, 'numfmt');
      const start = childNamed(level, 'start');
      const startValue = start === null ? null : toIntOrNull(wordValue(start));
      levels.set(wordValue(level, 'ilvl'), [format === null ? null : wordValue(format), startValue]);
    }
    listKinds.set(wordValue(definition, 'abstractNumId'), levels);
  }

  const counters = new Map<string, number>();

  const styleFlags = (id: string | null, depth = 0): number => {
    if (depth >= 8 || id === null || id === '') return 0;
    const style = styleIndex.get(id);
    if (style === undefined) return 0;
    const basedOn = childNamed(style, 'basedon');
    return wordRunFlags(childNamed(style, 'rpr'), styleFlags(basedOn === null ? null : wordValue(basedOn), depth + 1));
  };

  const paragraph = (node: HtmlElement): DocxParagraph => {
    const properties = childNamed(node, 'ppr');
    const pstyle = properties === null ? null : childNamed(properties, 'pstyle');
    const style = pstyle === null ? null : wordValue(pstyle);

    const outline = properties === null ? null : childNamed(properties, 'outlinelvl');
    const outlineLevel = outline === null ? 9 : (toIntOrNull(wordValue(outline)) ?? 9);
    const heading = (style !== null && style.toLowerCase().startsWith('heading')) || (outlineLevel >= 0 && outlineLevel <= 8);

    const inheritedBase = styleFlags(style);
    const inherited = heading ? inheritedBase | BookTextStyle.Heading | BookTextStyle.Bold : inheritedBase;

    const text = new StyledTextBuilder();
    const num = properties === null ? null : childNamed(properties, 'numpr');
    const numIdRaw = num === null ? null : childNamed(num, 'numid');
    const numberRaw = numIdRaw === null ? '' : wordValue(numIdRaw);
    const number = numberRaw === '' || numberRaw === '0' ? null : numberRaw;

    if (number !== null && num !== null) {
      const ilvl = childNamed(num, 'ilvl');
      const level = ilvl === null ? '0' : wordValue(ilvl);
      const abstractId = numbering.get(number) ?? '';
      const kind = listKinds.get(abstractId)?.get(level) ?? [null, null];
      const key = `${number}\u0000${level}`;
      const count = counters.get(key) ?? kind[1] ?? 1;
      counters.set(key, count + 1);
      text.append(kind[0] === 'decimal' ? `${String(count)}. ` : '• ', inherited, true);
    }

    for (const run of getAllElements(node)) {
      if (wordTag(run) !== 'r') continue;
      const props = childNamed(run, 'rpr');
      const rstyle = props === null ? null : childNamed(props, 'rstyle');
      const flags = wordRunFlags(
        props,
        inherited | styleFlags(rstyle === null ? null : wordValue(rstyle)),
      );
      for (const part of run.children()) {
        switch (wordTag(part)) {
          case 't':
            text.append(wholeText(part), flags, true);
            break;
          case 'tab':
            text.append('    ', flags, true);
            break;
          case 'br':
          case 'cr':
            text.append('\n', flags, true);
            break;
          case 'drawing':
          case 'pict': {
            const blip = getAllElements(part).find((element) => wordTag(element) === 'blip');
            const embed = blip === undefined ? '' : wordValue(blip, 'embed');
            const path = embed === '' ? undefined : images.get(embed);
            if (path !== undefined) {
              const size = imageSize(path);
              if (size !== null && size.width > 0 && size.height > 0) {
                text.breakLine(true);
                text.append(`[IMG:${path}|${String(size.width)}|${String(size.height)}]`, 0);
                text.breakLine(true);
              }
            }
            break;
          }
          default:
            break;
        }
      }
    }
    return { text: text.build(), isHeading: heading, compact: number !== null };
  };

  const body = getAllElements(wordDocument(xml)).find((element) => wordTag(element) === 'body');
  const out: DocxParagraph[] = [];
  for (const element of body?.children() ?? []) {
    const tag = wordTag(element);
    if (tag === 'p') {
      out.push(paragraph(element));
      continue;
    }
    if (tag !== 'tbl') continue;
    for (const row of element.children()) {
      if (wordTag(row) !== 'tr') continue;
      const text = new StyledTextBuilder();
      let cellIndex = 0;
      for (const cell of row.children()) {
        if (wordTag(cell) !== 'tc') continue;
        if (cellIndex > 0) text.append(' │ ', BookTextStyle.Table, true);
        let pos = 0;
        for (const cellParagraph of cell.children()) {
          if (wordTag(cellParagraph) !== 'p') continue;
          if (pos > 0) text.append(' / ', BookTextStyle.Table, true);
          const value = paragraph(cellParagraph).text;
          text.appendFormatted({ ...value, spans: tableSpans(value) });
          pos += 1;
        }
        cellIndex += 1;
      }
      out.push({ text: text.build(), isHeading: false, compact: true });
    }
  }
  return out.filter((item) => item.text.text.trim() !== '' || item.isHeading);
}

/** L97-105 `tableSpans(text)` —— 整段补 `Table` 位，空隙也补上。 */
export function tableSpans(text: FormattedBookText): BookTextSpan[] {
  const out: BookTextSpan[] = [];
  let offset = 0;
  for (const span of text.spans) {
    if (offset < span.start) out.push({ start: offset, end: span.start, style: BookTextStyle.Table });
    out.push({ start: span.start, end: span.end, style: span.style | BookTextStyle.Table });
    offset = span.end;
  }
  if (offset < text.text.length) out.push({ start: offset, end: text.text.length, style: BookTextStyle.Table });
  return out;
}

/** L107-127 `wordRunFlags(properties, inherited)`。 */
export function wordRunFlags(properties: HtmlElement | null, inherited: number): number {
  let flags = inherited;
  if (properties === null) return flags;
  for (const element of properties.children()) {
    const value = wordValue(element).toLowerCase();
    const enabled = !['0', 'false', 'off', 'none'].includes(value);
    let flag = 0;
    switch (wordTag(element)) {
      case 'b':
      case 'bcs':
        flag = BookTextStyle.Bold;
        break;
      case 'i':
      case 'ics':
        flag = BookTextStyle.Italic;
        break;
      case 'u':
        flag = BookTextStyle.Underline;
        break;
      case 'strike':
      case 'dstrike':
        flag = BookTextStyle.Strike;
        break;
      case 'vertalign':
        flag = value === 'superscript' ? BookTextStyle.Super : value === 'subscript' ? BookTextStyle.Sub : 0;
        break;
      default:
        flag = 0;
        break;
    }
    flags = enabled ? flags | flag : flags & ~flag;
  }
  return flags;
}

/** jsoup `Element.wholeText()` —— 直接文本子节点按顺序拼接。 */
function wholeText(element: HtmlElement): string {
  let out = '';
  for (const node of element.childNodes) {
    const data = (node as { data?: unknown }).data;
    if (typeof data === 'string') out += data;
  }
  return out;
}

function toIntOrNull(raw: string): number | null {
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

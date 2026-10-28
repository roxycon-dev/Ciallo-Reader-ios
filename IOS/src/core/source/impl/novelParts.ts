import { HtmlElement, HtmlTextNode } from '../zlibrary/parser/htmlDocument';
import { ParseError } from '../sourceException';

export type NovelPart = { kind: 'text'; value: string } | { kind: 'image'; url: string };
export function hasMissingNovelContent(text: string): boolean {
  return ['内容加载失败', '內容加載失敗', '本章节内容正在手打中', '本章暂无正文', '章节内容缺失', '本章尚未翻译', '本章中文译文尚未齐全', '内容还在处理中', '內容還在處理中', '内容正在处理中', '內容正在處理中'].some((marker) => text.includes(marker));
}
export function validateNovelParts(parts: NovelPart[]): void {
  if (!parts.length) throw new ParseError('源站章节为空');
  for (const part of parts) if (part.kind === 'text' && [...part.value].some((c) => c === '\uFFFD' || c === '\u0000' || /[\uE000-\uF8FF]/u.test(c) || c.codePointAt(0)! < 32 && !/\s/u.test(c))) throw new ParseError('正文包含乱码或加密字形，未保存损坏文本');
}
/** Keep inline text, block boundaries and images in their original reading order. */
export function extractNovelParts(root: HtmlElement, baseUrl: string, huaben = false): NovelPart[] {
  const parts: NovelPart[] = []; let line = '';
  const flush = (): void => { if (line.trim()) parts.push({ kind: 'text', value: line.trim() }); line = ''; };
  const block = new Set(['p', 'div', 'section', 'article', 'blockquote', 'li', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'table', 'tr']);
  const walk = (node: HtmlElement | { kind: string }): void => {
    if (node instanceof HtmlTextNode) { line += node.data; return; }
    if (!(node instanceof HtmlElement)) return;
    if (['script', 'style', 'noscript', 'ins', 'iframe'].includes(node.tagName) || node.id() === 'ad' || huaben && node.classNames().some((c) => ['avatar', 'num', 'passage-cosplay-preview'].includes(c))) return;
    if (['canvas', 'svg', 'video', 'audio'].includes(node.tagName)) throw new ParseError('章节包含尚不支持的正文格式，未生成残缺下载');
    if (node.tagName === 'br') { flush(); return; }
    if (node.tagName === 'img') {
      flush(); const raw = ['data-original', 'data-src', 'src'].map((key) => node.attr(key)).find(Boolean);
      let url: URL; try { if (!raw) throw new Error(); url = new URL(raw, baseUrl); } catch { throw new ParseError('插图地址不可用'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ParseError('插图地址不可用');
      parts.push({ kind: 'image', url: url.toString() }); return;
    }
    if (block.has(node.tagName)) flush(); for (const child of node.childNodes) walk(child); if (block.has(node.tagName)) flush();
  };
  walk(root); flush(); validateNovelParts(parts); return parts;
}

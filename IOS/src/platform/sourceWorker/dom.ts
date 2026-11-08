import { parseHTML } from 'linkedom';
import { parseHtmlDocument } from '@core/source/zlibrary/parser/htmlDocument';
import type { HtmlDomNode, HtmlDomParser } from '@core/source/js/jsPlatform';

/** Standards-based selectors, with the Jsoup text/identity semantics used by Venera. */
export function createWorkerDomParser(): HtmlDomParser {
  const wrapped = new WeakMap<Node, HtmlDomNode>();
  const wrap = (node: Node): HtmlDomNode => {
    const cached = wrapped.get(node);
    if (cached) return cached;
    const element = node.nodeType === 1 ? node as Element : null;
    const html = (): string => element?.outerHTML ?? node.textContent ?? '';
    const selectRoot = node as ParentNode;
    const result: HtmlDomNode = {
      tagName: element?.tagName.toLowerCase() ?? (node.nodeType === 9 ? '#document' : '#text'),
      id: element?.id ?? '', classNames: element ? Array.from(element.classList) : [],
      attributes: element ? Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])) : {},
      get childNodes() { return Array.from(node.childNodes).map(wrap); },
      get children() { return Array.from(node.childNodes).filter((child) => child.nodeType === 1).map(wrap); },
      get parentNode() { return node.parentNode ? wrap(node.parentNode) : null; },
      nodeKind: node.nodeType === 9 ? 'document' : node.nodeType === 1 ? 'element' : node.nodeType === 8 ? 'comment' : node.nodeType === 10 ? 'doctype' : 'text',
      text: () => element ? parseHtmlDocument(html()).text() : node.textContent ?? '',
      html: () => element?.innerHTML ?? Array.from(node.childNodes).map((child) => wrap(child).outerHtml()).join(''),
      data: () => element?.tagName === 'SCRIPT' || element?.tagName === 'STYLE' ? element.textContent ?? '' : '',
      outerHtml: html,
      select(query) {
        if (!selectRoot.querySelectorAll) return [];
        const matches = Array.from(selectRoot.querySelectorAll(query));
        if (element?.matches(query)) matches.unshift(element);
        return matches.map(wrap);
      },
      selectFirst(query) { return this.select(query)[0] ?? null; },
      getElementById(id) { return this.getAllElements().find((item) => item.id === id) ?? null; },
      getAllElements() { return [result, ...Array.from(selectRoot.querySelectorAll?.('*') ?? []).map(wrap)]; },
      previousElementSibling() {
        let sibling = node.previousSibling;
        while (sibling && sibling.nodeType !== 1) sibling = sibling.previousSibling;
        return sibling ? wrap(sibling) : null;
      },
      nextElementSibling() {
        let sibling = node.nextSibling;
        while (sibling && sibling.nodeType !== 1) sibling = sibling.nextSibling;
        return sibling ? wrap(sibling) : null;
      },
      ownerDocument: () => node.ownerDocument ? wrap(node.ownerDocument) : null,
    };
    wrapped.set(node, result);
    return result;
  };
  return {
    parse: (html) => wrap(parseHTML(html).document as unknown as Document),
    wholeText: (html) => parseHtmlDocument(html).text(),
  };
}

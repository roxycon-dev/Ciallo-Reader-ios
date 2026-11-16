/**
 * Android source: `com.example.source.js.JsHtmlStore.kt` (178 lines, 150 non-blank)
 * Ported: 150 / 150 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `org.jsoup.Jsoup` DOM → the injected `HtmlDomParser` from `./jsPlatform`.
 *   The pure-TS parser in `@core/parser/legadoRule` already exposes a
 *   Jsoup-shaped tree (`select`, `selectFirst`, `getElementById`, `text`,
 *   `html`, `data`, `childNodes`, `classNames`), so the handle bookkeeping ports
 *   unchanged. WKWebView/Capacitor supplies the adapter.
 * - `LinkedHashMap<Int, Document>(16, 0.75f, true)` / `HashMap` → `Map` with
 *   integer keys; `IdentityHashMap` becomes a `Map` keyed by the node object.
 * - `require(html.length <= 2 * 1024 * 1024) { "书源 HTML 超过 2Mi 字符" }`
 *   → explicit `Error` with the same message.
 * - `synchronized`/`volatile` dropped — JS is single-threaded.
 */

import type { HtmlDomNode, HtmlDomParser } from './jsPlatform';

const MAX_HTML_CHARS = 2 * 1024 * 1024;
const MAX_PARSE_MEMORY = 4 * 1024 * 1024;
const MAX_DOCUMENTS = 8;

/** Venera HtmlDocument/HtmlElement 桥接的 DOM 存储：JS 侧持有一个整数 key。 */
export class JsHtmlStore {
  // JS 侧 HtmlDocument._key 从 0 开始，这里必须一致，否则第一个文档永远查不到
  private nextId = 0;
  // Kotlin `LinkedHashMap<Int, Document>(16, 0.75f, /* accessOrder = */ true)`:
  // **access-ordered**, so `docs.keys.first()` is the LEAST RECENTLY USED
  // document, not the oldest-inserted one. A plain JS `Map` is insertion
  // ordered, so every read has to re-insert to reproduce the eviction order.
  private readonly docs = new Map<number, HtmlDomNode>();
  private readonly elements = new Map<number, HtmlDomNode>();
  private readonly nodes = new Map<number, HtmlDomNode>();
  private readonly documentIds = new Map<HtmlDomNode, number>();
  private readonly handleIds = new Map<HtmlDomNode, number>();
  private readonly owners = new Map<number, number>();
  private readonly sizes = new Map<number, number>();

  constructor(private readonly parser: HtmlDomParser) {}

  /** Kotlin `docs[docId]` on an access-ordered map: reading promotes the entry. */
  private touch(docId: number): HtmlDomNode | undefined {
    const doc = this.docs.get(docId);
    if (doc === undefined) return undefined;
    this.docs.delete(docId);
    this.docs.set(docId, doc);
    return doc;
  }

  private next(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  /**
   * 文档 key 由 JS 侧 HtmlDocument._key 提供（0,1,2...），
   * 不能与元素 id 共用自增计数器，否则后续文档全部错位。
   */
  parse(jsKey: number, html: string): number {
    if (html.length > MAX_HTML_CHARS) throw new Error('书源 HTML 超过 2Mi 字符');
    this.dispose(jsKey);
    const doc = this.parser.parse(html);
    const size = html.length * 2 + doc.getAllElements().length * 512;
    if (size > MAX_PARSE_MEMORY) throw new Error('书源 HTML 解析内存预算不足');
    this.docs.set(jsKey, doc);
    this.documentIds.set(doc, jsKey);
    this.sizes.set(jsKey, size);
    // Every selected element keeps its entire Jsoup document alive. Bound the
    // retained documents AND release their handles, rather than clearing docs alone.
    let total = this.totalSize();
    while (this.docs.size > MAX_DOCUMENTS || (this.docs.size > 1 && total > MAX_PARSE_MEMORY)) {
      const eldest = this.docs.keys().next();
      if (eldest.done === true) break;
      this.dispose(eldest.value);
      total = this.totalSize();
    }
    return jsKey;
  }

  private totalSize(): number {
    let total = 0;
    for (const size of this.sizes.values()) total += size;
    return total;
  }

  dispose(docId: number): void {
    const doc = this.docs.get(docId);
    if (doc !== undefined) {
      this.docs.delete(docId);
      this.documentIds.delete(doc);
    }
    this.sizes.delete(docId);
    const handles: number[] = [];
    for (const [id, owner] of this.owners) {
      if (owner === docId) handles.push(id);
    }
    for (const id of handles) {
      const node = this.nodes.get(id);
      if (node !== undefined) {
        this.nodes.delete(id);
        this.handleIds.delete(node);
      }
      this.elements.delete(id);
      this.owners.delete(id);
    }
  }

  clear(): void {
    this.docs.clear();
    this.elements.clear();
    this.nodes.clear();
    this.documentIds.clear();
    this.handleIds.clear();
    this.owners.clear();
    this.sizes.clear();
  }

  querySelector(docId: number, query: string): number | null {
    const doc = this.touch(docId);
    if (doc === undefined) return null;
    const found = doc.selectFirst(query);
    return found === null ? null : this.elementId(found);
  }

  querySelectorAll(docId: number, query: string): number[] {
    const doc = this.touch(docId);
    if (doc === undefined) return [];
    return doc.select(query).map((el) => this.elementId(el));
  }

  getElementById(docId: number, id: string): number | null {
    const doc = this.touch(docId);
    if (doc === undefined) return null;
    const found = doc.getElementById(id);
    return found === null ? null : this.elementId(found);
  }

  domQuerySelector(elemId: number, query: string): number | null {
    const el = this.elements.get(elemId);
    if (el === undefined) return null;
    const found = el.selectFirst(query);
    return found === null ? null : this.elementId(found);
  }

  domQuerySelectorAll(elemId: number, query: string): number[] {
    const el = this.elements.get(elemId);
    if (el === undefined) return [];
    return el.select(query).map((it) => this.elementId(it));
  }

  getText(elemId: number): string {
    const el = this.elements.get(elemId);
    if (el === undefined) return '';
    const text = el.text();
    if (text.trim() !== '') return text;
    // script/style 等标签内容在 Jsoup 中是 DataNode，text() 取不到；
    // Venera(html 包) 会把 script 内容当文本返回，这里兼容
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') {
      return el.data().trim();
    }
    if (
      el.childNodes.length > 0 &&
      el.childNodes.every((child) => child.nodeKind === 'data')
    ) {
      return el.data().trim();
    }
    return '';
  }

  getAttributes(elemId: number): Record<string, string> {
    const el = this.elements.get(elemId);
    if (el === undefined) return {};
    const attrs: Record<string, string> = {};
    for (const key of Object.keys(el.attributes)) attrs[key] = el.attributes[key] ?? '';
    return attrs;
  }

  getChildren(elemId: number): number[] {
    const el = this.elements.get(elemId);
    if (el === undefined) return [];
    return el.children.map((it) => this.elementId(it));
  }

  getNodes(elemId: number): number[] {
    const el = this.elements.get(elemId);
    if (el === undefined) return [];
    return el.childNodes.map((n) => this.nodeId(n));
  }

  getInnerHTML(elemId: number): string {
    return this.elements.get(elemId)?.html() ?? '';
  }

  getParent(elemId: number): number | null {
    const parent = this.elements.get(elemId)?.parentNode;
    return parent === undefined || parent === null ? null : this.elementId(parent);
  }

  getClassNames(elemId: number): string[] {
    // Kotlin `classNames()?.toList()` returns a fresh copy, never the live list.
    const names = this.elements.get(elemId)?.classNames;
    return names === undefined ? [] : [...names];
  }

  getId(elemId: number): string | null {
    const id = this.elements.get(elemId)?.id ?? '';
    return id.trim() === '' ? null : id;
  }

  getLocalName(elemId: number): string {
    return this.elements.get(elemId)?.tagName ?? '';
  }

  getPreviousSibling(elemId: number): number | null {
    const sibling = this.elements.get(elemId)?.previousElementSibling();
    return sibling === null || sibling === undefined ? null : this.elementId(sibling);
  }

  getNextSibling(elemId: number): number | null {
    const sibling = this.elements.get(elemId)?.nextElementSibling();
    return sibling === null || sibling === undefined ? null : this.elementId(sibling);
  }

  nodeText(nodeId: number): string {
    return this.nodes.get(nodeId)?.outerHtml() ?? '';
  }

  nodeType(nodeId: number): string {
    const node = this.nodes.get(nodeId);
    if (node === undefined) return 'unknown';
    switch (node.nodeKind) {
      case 'element':
        return 'element';
      case 'text':
        return 'text';
      case 'comment':
        return 'comment';
      case 'document':
        return 'document';
      default:
        return 'unknown';
    }
  }

  nodeToElement(nodeId: number): number | null {
    const n = this.nodes.get(nodeId);
    if (n === undefined || n.nodeKind !== 'element') return null;
    return this.elementId(n);
  }

  private elementId(el: HtmlDomNode): number {
    const existing = this.handleIds.get(el);
    if (existing !== undefined) return existing;
    const id = this.next();
    this.elements.set(id, el);
    this.retain(id, el);
    return id;
  }

  private nodeId(n: HtmlDomNode): number {
    const existing = this.handleIds.get(n);
    if (existing !== undefined) return existing;
    if (n.nodeKind === 'element') return this.elementId(n);
    const id = this.next();
    this.retain(id, n);
    return id;
  }

  private retain(id: number, node: HtmlDomNode): void {
    this.nodes.set(id, node);
    this.handleIds.set(node, id);
    // Kotlin `node.ownerDocument()?.let { documentIds[it] }?.let { owners[id] = it }`.
    // `ownerDocument` is optional on the port: a pure-TS DOM may not track it,
    // and the consequence is only that the handle is not pruned with its doc.
    const owner = typeof node.ownerDocument === 'function' ? node.ownerDocument() : null;
    if (owner !== null && owner !== undefined) {
      const docId = this.documentIds.get(owner);
      if (docId !== undefined) this.owners.set(id, docId);
    }
  }
}

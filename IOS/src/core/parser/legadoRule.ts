/**
 * Android `LegadoRule.kt` → `src/core/parser/legadoRule.ts`.
 *
 * 2026-10-06 review fixes (Kotlin parity):
 *  - evalSingleValue(): a leading '@' (non-@css:) now matches Kotlin L106-108
 *    exactly — content lookup on the current element; the TS-only branch that
 *    re-parsed '@tag.a.0@text' as a Legado segment rule was REMOVED.
 *  - applyRegexReplacement(): now goes through ruleBudget.boundedReplace, so a
 *    blown regex budget surfaces as 书源正则执行超时 (pre/post deadline check;
 *    JS RegExp cannot be interrupted mid-scan like the Kotlin Bounded
 *    CharSequence — see PARITY_EXCEPTIONS E86).
 */
import { boundedReplace, validateRule } from './ruleBudget';

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  text(): string;
  ownText(): string;
  html(): string;
  outerHtml(): string;
  children(): HtmlNode[];
  getAllElements(): HtmlNode[];
  select(css: string): HtmlNode[];
  selectFirst(css: string): HtmlNode | null;
  getElementsByClass(name: string): HtmlNode[];
  getElementsByTag(name: string): HtmlNode[];
  getElementById(name: string): HtmlNode | null;
  textNodes(): HtmlNode[];
  /** Raw child-node list (elements + text + comments), the jsoup `childNodes()`. */
  childNodes: HtmlNode[];
}

type NodeKind = 'element' | 'text' | 'comment' | 'doctype' | 'document';

const VOID_TAGS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr',
  'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

const segmentTypes = new Set(['class', 'id', 'tag', 'text', 'children', 'all']);
const contentKeywords = new Set(['text', 'textNodes', 'ownText', 'html', 'all']);
const commonTags = new Set([
  'a', 'li', 'img', 'div', 'p', 'span', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'dl', 'dd', 'dt', 'table', 'tr', 'td', 'th', 'section', 'article', 'nav', 'button',
  'em', 'b', 'i', 'strong', 'figure', 'figcaption', 'mip-img', 'mip-link', 'amp-img',
]);

export class HtmlNodeImpl implements HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  kind: NodeKind;
  data: string;
  parent: HtmlNodeImpl | null = null;
  childNodes: HtmlNodeImpl[] = [];

  constructor(kind: NodeKind, tag: string, attrs?: Record<string, string>, data = '') {
    this.kind = kind;
    this.tag = tag;
    this.attrs = attrs ?? {};
    this.data = data;
  }

  appendChild(child: HtmlNodeImpl): void {
    child.parent = this;
    this.childNodes.push(child);
  }

  removeChild(child: HtmlNodeImpl): void {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parent = null;
    }
  }

  /**
   * jsoup `Element.children()` returns only the Element children — text,
   * comment and doctype nodes are filtered out. See `childNodes` for the raw
   * list. Verified against jsoup 1.18.3: `<div>a<br>b</div>` has
   * childNodeSize()==3 but children().size()==1.
   */
  children(): HtmlNode[] {
    return this.childNodes.filter((c) => c.kind === 'element');
  }

  /**
   * jsoup `Element.ownText()`: the normalised text of the DIRECT text-node
   * children only, with a `br` turned into a single space. Whitespace runs
   * collapse to one space and are trimmed.
   */
  ownText(): string {
    let out = '';
    for (const child of this.childNodes) {
      if (child.kind === 'text') out += normaliseWhitespace(child.data, out.endsWith(' '));
      else if (child.tag === 'br' && !out.endsWith(' ')) out += ' ';
    }
    return out.trim();
  }

  /**
   * jsoup `Element.text()`: a depth-first walk that appends normalised text and
   * inserts a single space around block-level elements. `br` also acts as a
   * separator. Verified against jsoup 1.18.3 (see the TextAccumulator visitor
   * in org.jsoup.nodes.Element).
   */
  text(): string {
    if (this.kind === 'text') return normaliseWhitespace(this.data, false);
    let accum = '';
    const walk = (node: HtmlNodeImpl): void => {
      if (node.kind === 'text') {
        accum += normaliseWhitespace(node.data, accum.endsWith(' '));
        return;
      }
      if (node.kind !== 'element' && node.kind !== 'document') return;
      const isBlock = node.kind === 'element' && isBlockTag(node.tag);
      // head(): leading separator, only when something was already accumulated
      if (accum.length > 0 && (isBlock || node.tag === 'br') && !accum.endsWith(' ')) {
        accum += ' ';
      }
      for (const child of node.childNodes) walk(child);
      // tail(): trailing separator, unless the block is last or already spaced
      if (isBlock && !accum.endsWith(' ')) accum += ' ';
    };
    walk(this);
    return accum.trim();
  }

  html(): string {
    let out = '';
    for (const child of this.childNodes) out += serializeNode(child);
    return out;
  }

  outerHtml(): string {
    return serializeNode(this);
  }

  getAllElements(): HtmlNode[] {
    return allElements(this);
  }

  select(css: string): HtmlNode[] {
    return selectFrom(this, css);
  }

  selectFirst(css: string): HtmlNode | null {
    const found = selectFrom(this, css);
    return found.length > 0 ? (found[0] as HtmlNode) : null;
  }

  getElementsByClass(name: string): HtmlNode[] {
    const target = name.toLowerCase();
    return allElements(this).filter((el) => {
      const classes = (el.attrs['class'] ?? '').split(/\s+/).filter((c) => c !== '');
      return classes.some((c) => c.toLowerCase() === target);
    });
  }

  getElementsByTag(name: string): HtmlNode[] {
    const lower = name.toLowerCase();
    return allElements(this).filter((el) => el.tag === lower);
  }

  getElementById(name: string): HtmlNode | null {
    for (const el of allElements(this)) {
      if (el.attrs['id'] === name) return el;
    }
    return null;
  }

  textNodes(): HtmlNode[] {
    return this.childNodes.filter((c) => c.kind === 'text');
  }
}

/**
 * Tags jsoup treats as block-level for `Element.text()` separator purposes.
 * Mirrors `org.jsoup.parser.Tag.blockTags`, minus the entries that
 * `Tag.inlineTags` later flips to inline, plus `button` (which `Tag` creates
 * with the default `isBlock = true`). Verified against jsoup 1.18.3.
 */
const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'frameset', 'script', 'noscript', 'style', 'meta',
  'link', 'title', 'frame', 'noframes', 'section', 'nav', 'aside', 'hgroup',
  'header', 'footer', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
  'pre', 'div', 'blockquote', 'hr', 'address', 'figure', 'figcaption', 'form',
  'fieldset', 'ins', 'del', 'dl', 'dt', 'dd', 'li', 'table', 'caption',
  'thead', 'tfoot', 'tbody', 'colgroup', 'col', 'tr', 'th', 'td', 'video',
  'audio', 'canvas', 'details', 'menu', 'plaintext', 'template', 'article',
  'main', 'svg', 'math', 'center', 'dir', 'applet', 'marquee', 'listing',
  'button',
]);

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

/** jsoup `StringUtil.isActuallyWhitespace`: space, tab, newline, FF, CR and NBSP. */
function isActuallyWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0xa0
  );
}

/** jsoup `StringUtil.isInvisibleChar`: zero-width space and soft hyphen. */
function isInvisibleChar(code: number): boolean {
  return code === 8203 || code === 173;
}

/**
 * jsoup `StringUtil.appendNormalisedWhitespace`: collapse whitespace runs to a
 * single space, drop invisible characters, and honour `stripLeading` (jsoup
 * passes `lastCharIsWhitespace(accum)` so a leading run never doubles up).
 */
function normaliseWhitespace(text: string, stripLeading: boolean): string {
  let out = '';
  let lastWasWhite = false;
  let reachedNonWhite = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (isActuallyWhitespace(code)) {
      if ((stripLeading && !reachedNonWhite) || lastWasWhite) continue;
      out += ' ';
      lastWasWhite = true;
    } else if (!isInvisibleChar(code)) {
      out += ch;
      lastWasWhite = false;
      reachedNonWhite = true;
    }
  }
  return out;
}

function allElements(root: HtmlNodeImpl): HtmlNodeImpl[] {
  const out: HtmlNodeImpl[] = [];
  const walk = (node: HtmlNodeImpl) => {
    if (node.kind === 'element') out.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

function serializeNode(node: HtmlNodeImpl): string {
  if (node.kind === 'text') return escapeText(node.data);
  if (node.kind === 'comment') return `<!--${node.data}-->`;
  if (node.kind === 'doctype') return node.data;
  if (node.kind === 'document') return node.html();
  let out = `<${node.tag}`;
  for (const [k, v] of Object.entries(node.attrs)) {
    out += ` ${k}="${escapeAttr(v)}"`;
  }
  if (VOID_TAGS.has(node.tag)) {
    out += '>';
  } else {
    out += `>${node.html()}</${node.tag}>`;
  }
  return out;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named: Record<string, string> = {
      nbsp: ' ',
      lt: '<',
      gt: '>',
      amp: '&',
      quot: '"',
      apos: "'",
      cent: '¢',
      pound: '£',
      yen: '¥',
      euro: '€',
      copy: '©',
      reg: '®',
    };
    return named[body.toLowerCase()] ?? match;
  });
}

function appendText(parent: HtmlNodeImpl, data: string): void {
  if (data === '') return;
  const last = parent.childNodes[parent.childNodes.length - 1];
  if (last !== undefined && last.kind === 'text') {
    last.data += data;
    return;
  }
  parent.appendChild(new HtmlNodeImpl('text', '#text', {}, data));
}

interface OpenTagResult {
  tag: string;
  attrs: Record<string, string>;
  end: number;
  selfClosing: boolean;
}

function parseOpenTag(html: string, start: number): OpenTagResult | null {
  let i = start + 1;
  const len = html.length;
  const tagStart = i;
  if (i < len && /[A-Za-z]/.test(html[i] as string)) i += 1;
  while (i < len && /[A-Za-z0-9-]/.test(html[i] as string)) i += 1;
  if (i === tagStart) return null;
  const tag = html.slice(tagStart, i).toLowerCase();
  const attrs: Record<string, string> = {};
  while (i < len) {
    while (i < len && /\s/.test(html[i] as string)) i += 1;
    if (i >= len) return { tag, attrs, end: len, selfClosing: false };
    if (html[i] === '>') return { tag, attrs, end: i + 1, selfClosing: false };
    if (html[i] === '/' && html[i + 1] === '>') {
      return { tag, attrs, end: i + 2, selfClosing: true };
    }
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(html[i] as string)) i += 1;
    const name = html.slice(nameStart, i).toLowerCase();
    if (name === '') {
      i += 1;
      continue;
    }
    while (i < len && /\s/.test(html[i] as string)) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < len && /\s/.test(html[i] as string)) i += 1;
      const q = html[i];
      if (q === '"' || q === "'") {
        i += 1;
        const vStart = i;
        while (i < len && html[i] !== q) i += 1;
        value = html.slice(vStart, i);
        if (i < len) i += 1;
      } else {
        const vStart = i;
        while (i < len && !/[\s>]/.test(html[i] as string)) i += 1;
        value = html.slice(vStart, i);
      }
      value = decodeEntities(value);
    }
    attrs[name] = value;
  }
  return { tag, attrs, end: len, selfClosing: false };
}

function buildTree(root: HtmlNodeImpl, html: string): void {
  const stack: HtmlNodeImpl[] = [root];
  let i = 0;
  const len = html.length;
  const lowerHtml = html.toLowerCase();

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      appendText(stack[stack.length - 1] as HtmlNodeImpl, decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) {
      appendText(stack[stack.length - 1] as HtmlNodeImpl, decodeEntities(html.slice(i, lt)));
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const endIdx = end < 0 ? len : end + 3;
      const comment = new HtmlNodeImpl('comment', '#comment', {}, html.slice(lt + 4, end < 0 ? len : end));
      (stack[stack.length - 1] as HtmlNodeImpl).appendChild(comment);
      i = endIdx;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      const endIdx = end < 0 ? len : end + 1;
      const text = html.slice(lt, endIdx);
      const node = new HtmlNodeImpl('doctype', '#doctype', {}, text);
      (stack[stack.length - 1] as HtmlNodeImpl).appendChild(node);
      i = endIdx;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const endIdx = end < 0 ? len : end + 1;
      const rawName = html.slice(lt + 2, end < 0 ? len : end).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if ((stack[s] as HtmlNodeImpl).tag === rawName) {
          stack.length = s;
          break;
        }
      }
      i = endIdx;
      continue;
    }
    const parsed = parseOpenTag(html, lt);
    if (parsed === null) {
      appendText(stack[stack.length - 1] as HtmlNodeImpl, '<');
      i = lt + 1;
      continue;
    }
    const el = new HtmlNodeImpl('element', parsed.tag, parsed.attrs);
    (stack[stack.length - 1] as HtmlNodeImpl).appendChild(el);
    const isVoid = VOID_TAGS.has(parsed.tag) || parsed.selfClosing;
    if (isVoid) {
      i = parsed.end;
      continue;
    }
    if (RAW_TEXT_TAGS.has(parsed.tag)) {
      const closeTag = `</${parsed.tag}`;
      const closeIdx = lowerHtml.indexOf(closeTag, parsed.end);
      const rawEnd = closeIdx < 0 ? len : closeIdx;
      const rawContent = html.slice(parsed.end, rawEnd);
      if (rawContent !== '') {
        el.appendChild(new HtmlNodeImpl('text', '#text', {}, rawContent));
      }
      if (closeIdx >= 0) {
        const gt = html.indexOf('>', closeIdx);
        i = gt < 0 ? len : gt + 1;
      } else {
        i = len;
      }
      continue;
    }
    stack.push(el);
    i = parsed.end;
  }
}

export function parseHtml(html: string): HtmlNode {
  const doc = new HtmlNodeImpl('document', '#document');
  buildTree(doc, html);
  return doc;
}

function findBody(root: HtmlNodeImpl): HtmlNodeImpl {
  for (const el of allElements(root)) {
    if (el.tag === 'body') return el;
  }
  return root;
}

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  eq: number | null;
  attrs: Array<{ name: string; value: string | null }>;
}

function isSelectorSpecial(ch: string): boolean {
  return ch === '#' || ch === '.' || ch === '[' || ch === ']' || ch === ' ' || ch === '>' || ch === ':' || ch === '(' || ch === ')' || ch === ',';
}

function isTagChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

function parseCompound(raw: string): Compound | null {
  let s = raw.trim();
  if (s === '') return null;
  let eq: number | null = null;
  const eqIdx = s.lastIndexOf(':eq(');
  if (eqIdx >= 0 && s.endsWith(')')) {
    const idxStr = s.slice(eqIdx + 4, -1).trim();
    eq = /^-?\d+$/.test(idxStr) ? Number.parseInt(idxStr, 10) : null;
    s = s.slice(0, eqIdx);
  }
  const comp: Compound = { tag: null, id: null, classes: [], eq, attrs: [] };
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '#') {
      i += 1;
      const start = i;
      while (i < s.length && !isSelectorSpecial(s[i] as string)) i += 1;
      comp.id = s.slice(start, i);
    } else if (ch === '.') {
      i += 1;
      const start = i;
      while (i < s.length && !isSelectorSpecial(s[i] as string)) i += 1;
      comp.classes.push(s.slice(start, i));
    } else if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end);
      const eqPos = inner.indexOf('=');
      if (eqPos < 0) {
        comp.attrs.push({ name: inner.trim().toLowerCase(), value: null });
      } else {
        let name = inner.slice(0, eqPos).trim().toLowerCase();
        let value = inner.slice(eqPos + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
          (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
          value = value.slice(1, -1);
        }
        if (name.endsWith('i')) name = name.slice(0, -1).trim();
        comp.attrs.push({ name, value });
      }
      i = end + 1;
    } else if (isTagChar(ch)) {
      const start = i;
      while (i < s.length && isTagChar(s[i] as string)) i += 1;
      comp.tag = s.slice(start, i).toLowerCase();
    } else {
      i += 1;
    }
  }
  return comp;
}

function matchesCompound(el: HtmlNodeImpl, comp: Compound): boolean {
  if (comp.tag !== null && el.tag !== comp.tag) return false;
  if (comp.id !== null && el.attrs['id'] !== comp.id) return false;
  if (comp.classes.length > 0) {
    const classes = (el.attrs['class'] ?? '').split(/\s+/).filter((c) => c !== '');
    for (const cls of comp.classes) {
      if (!classes.includes(cls)) return false;
    }
  }
  for (const attr of comp.attrs) {
    const v = el.attrs[attr.name];
    if (v === undefined) return false;
    if (attr.value !== null && v !== attr.value) return false;
  }
  return true;
}

function applyEq(list: HtmlNodeImpl[], eq: number): HtmlNodeImpl[] {
  const idx = eq < 0 ? list.length + eq : eq;
  return idx >= 0 && idx < list.length ? [list[idx] as HtmlNodeImpl] : [];
}

function selectFrom(root: HtmlNodeImpl, css: string): HtmlNode[] {
  const groups = css.split(',').map((g) => g.trim()).filter((g) => g !== '');
  const out: HtmlNodeImpl[] = [];
  for (const group of groups) {
    const steps = group.split(/\s+/).filter((s) => s !== '');
    if (steps.length === 0) continue;
    const comps: Compound[] = [];
    let ok = true;
    for (const step of steps) {
      const comp = parseCompound(step);
      if (comp === null) {
        ok = false;
        break;
      }
      comps.push(comp);
    }
    if (!ok) continue;
    const first = comps[0] as Compound;
    let current = allElements(root).filter((el) => matchesCompound(el, first));
    if (first.eq !== null) current = applyEq(current, first.eq);
    for (let i = 1; i < comps.length; i += 1) {
      const comp = comps[i] as Compound;
      const next: HtmlNodeImpl[] = [];
      for (const el of current) {
        for (const desc of allElements(el)) {
          if (desc === el) continue;
          if (matchesCompound(desc, comp) && !next.includes(desc)) next.push(desc);
        }
      }
      current = comp.eq !== null ? applyEq(next, comp.eq) : next;
    }
    for (const c of current) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

export function isJsonRule(rawRule: string): boolean {
  const r = rawRule.trim();
  return r.startsWith('$') || r.startsWith('@json:') || r.startsWith('@js:');
}

export function cleanJsonPath(rawRule: string): string {
  let r = rawRule.trim();
  if (r.startsWith('@json:')) r = r.slice('@json:'.length).trim();
  // Kotlin: removePrefix("$").trimStart('.') — the leading dot goes too.
  if (r.startsWith('$')) r = r.slice(1).replace(/^\.+/, '');
  return r;
}

export function selectElements(root: HtmlNode, rawRule: string): HtmlNode[] {
  validateRule(rawRule);
  let rule = rawRule.trim();
  if (rule === '') return [];
  let reverse = false;
  if (rule.startsWith('-') && rule.length > 1) {
    reverse = true;
    rule = rule.slice(1).trim();
  }
  const branches = rule.split('||').map((b) => b.trim()).filter((b) => b !== '');
  for (const branch of branches) {
    const elements = selectBranchElements(root as HtmlNodeImpl, branch);
    if (elements.length > 0) {
      return reverse ? elements.slice().reverse() : elements;
    }
  }
  return [];
}

export function evalValues(root: HtmlNode, rawRule: string): string[] {
  validateRule(rawRule);
  const rule = rawRule.trim();
  if (rule === '') return [];
  if (isJsonRule(rule)) return [];
  if (rule.startsWith('@js:') || rule.includes('{{') || rule.includes('{$')) return [];

  const regexInfo = splitRegexReplacement(rule);
  const baseRule = regexInfo ? regexInfo.base : rule;

  const orBranches = baseRule.split('||').map((b) => b.trim()).filter((b) => b !== '');
  for (const branch of orBranches) {
    const values = evalBranchValues(root as HtmlNodeImpl, branch);
    if (values.length > 0) {
      return values
        .map((v) => applyRegexReplacement(v, regexInfo))
        .filter((v) => v.trim() !== '');
    }
  }
  return [];
}

export function evalFirst(root: HtmlNode, rawRule: string): string | null {
  const values = evalValues(root, rawRule);
  return values.length > 0 ? (values[0] as string) : null;
}

function evalBranchValues(root: HtmlNodeImpl, rule: string): string[] {
  const andParts = rule.split('&&').map((p) => p.trim()).filter((p) => p !== '');
  if (andParts.length <= 1) return evalSingleValue(root, rule);
  const merged: string[] = [];
  for (const part of andParts) {
    merged.push(...evalSingleValue(root, part));
  }
  return merged;
}

function evalSingleValue(root: HtmlNodeImpl, rule: string): string[] {
  const r = rule.trim();
  if (r === '') return [];
  if (r.startsWith('@css:')) {
    return evalCssValue(root, r.slice('@css:'.length).trim());
  }
  if (r.startsWith('@') && !r.startsWith('@css:')) {
    // Kotlin (L106-108): a leading '@' always means content-on-current-node;
    // '@tag.a.0@text' is NOT special-cased — it is treated as an attr name.
    const extracted = extractContent(root, r.slice(1));
    return extracted === null ? [] : [extracted];
  }

  const firstSegment = r.split('@')[0]?.trim() ?? '';
  if (looksLikeLegadoSegments(firstSegment)) {
    return evalLegadoSegments(root, r);
  }

  const atIndex = r.indexOf('@');
  const css = atIndex >= 0 ? r.slice(0, atIndex).trim() : r.trim();
  const attr = atIndex >= 0 ? r.slice(atIndex + 1).trim() : 'text';
  let el: HtmlNodeImpl | null = null;
  try {
    el = css === '' ? root : (root.selectFirst(css) as HtmlNodeImpl | null);
  } catch {
    el = null;
  }
  if (el === null && /\.\d+/.test(css)) {
    const normalized = css.replace(/\.(\d+)(?=[\s.:#[]|$)/g, '').trim();
    if (normalized !== '' && normalized !== css) {
      try {
        el = root.selectFirst(normalized) as HtmlNodeImpl | null;
      } catch {
        el = null;
      }
    }
  }
  if (el === null) return [];
  const extracted = extractContent(el, attr);
  return extracted === null ? [] : [extracted];
}

function evalCssValue(root: HtmlNodeImpl, cssRule: string): string[] {
  const atIndex = cssRule.indexOf('@');
  const css = (atIndex >= 0 ? cssRule.slice(0, atIndex) : cssRule).trim();
  const attr = atIndex >= 0 ? cssRule.slice(atIndex + 1).trim() : 'text';
  if (css === '') return [];
  try {
    const found = root.select(css);
    const out: string[] = [];
    for (const el of found) {
      const extracted = extractContent(el as HtmlNodeImpl, attr);
      if (extracted !== null) out.push(extracted);
    }
    return out;
  } catch {
    return [];
  }
}

function evalLegadoSegments(root: HtmlNodeImpl, rule: string): string[] {
  const segments = rule.split('@').map((s) => s.trim()).filter((s) => s !== '');
  if (segments.length === 0) return [];

  let current: HtmlNodeImpl[] = [root];
  let content = 'text';

  for (let index = 0; index < segments.length; index += 1) {
    const seg = segments[index] as string;
    const isLast = index === segments.length - 1;
    if (isLast && isContentSegment(seg)) {
      content = seg;
      break;
    }
    current = applySegment(current, seg);
    if (current.length === 0) return [];
    if (isLast) content = 'text';
  }
  const out: string[] = [];
  for (const el of current) {
    const extracted = extractContent(el, content);
    if (extracted !== null) out.push(extracted);
  }
  return out;
}

function isContentSegment(seg: string): boolean {
  const s = seg.trim();
  if (s.startsWith('.') || s.startsWith('#')) return false;
  const first = s.split('.')[0]?.toLowerCase() ?? '';
  return (
    contentKeywords.has(first) ||
    (!segmentTypes.has(first) && !commonTags.has(first))
  );
}

function applySegment(current: HtmlNodeImpl[], seg: string): HtmlNodeImpl[] {
  let s = seg.trim();
  if (s.startsWith('.') && !s.includes(' ')) {
    s = 'class' + s;
  }
  const parts = s.split('.').filter((p) => p !== '');
  if (parts.length === 0) return [];
  const type = (parts[0] as string).toLowerCase();
  let name = parts[1] ?? '';
  let position = parts[2] ?? '';
  if (!segmentTypes.has(type) && commonTags.has(type)) {
    const tagName = parts[0] as string;
    const tagPosition = parts[1] ?? '';
    const selected: HtmlNodeImpl[] = [];
    for (const el of current) {
      selected.push(...(el.getElementsByTag(tagName) as HtmlNodeImpl[]));
    }
    return applyPosition(selected, tagPosition);
  }
  if (type === 'class' && name.includes(' ')) {
    const classes = name.split(/\s+/).filter((c) => c !== '');
    const css = classes.map((c) => `.${c}`).join('');
    const selected: HtmlNodeImpl[] = [];
    for (const el of current) {
      selected.push(...(el.select(css) as HtmlNodeImpl[]));
    }
    return applyPosition(selected, position);
  }
  if (parts.length === 2 && name.includes('!')) {
    const bang = name.indexOf('!');
    position = name.slice(bang);
    name = name.slice(0, bang);
  }

  const selected: HtmlNodeImpl[] = [];
  if (type === 'class') {
    for (const el of current) {
      selected.push(...(el.getElementsByClass(name) as HtmlNodeImpl[]));
    }
  } else if (type === 'id') {
    for (const el of current) {
      const found = el.getElementById(name);
      if (found !== null) selected.push(found as HtmlNodeImpl);
    }
  } else if (type === 'tag') {
    for (const el of current) {
      selected.push(...(el.getElementsByTag(name) as HtmlNodeImpl[]));
    }
  } else if (type === 'text') {
    for (const el of current) {
      for (const item of el.getAllElements() as HtmlNodeImpl[]) {
        if (item.ownText().includes(name)) selected.push(item);
      }
    }
  } else if (type === 'children') {
    for (const el of current) {
      selected.push(...(el.children() as HtmlNodeImpl[]));
    }
  } else if (type === 'all') {
    for (const el of current) {
      selected.push(...(el.getAllElements() as HtmlNodeImpl[]));
    }
  } else {
    return [];
  }
  return applyPosition(selected, position);
}

function applyPosition(elements: HtmlNodeImpl[], position: string): HtmlNodeImpl[] {
  if (elements.length === 0 || position.trim() === '') return elements;
  if (position.startsWith('!')) {
    const excluded = new Set(
      position
        .slice(1)
        .split(':')
        .map((p) => p.trim())
        .map((p) => (p === '' ? null : Number.parseInt(p, 10)))
        .filter((n): n is number => n !== null && Number.isFinite(n))
        .map((n) => (n < 0 ? elements.length + n : n)),
    );
    return elements.filter((_, index) => !excluded.has(index));
  }
  const index = Number.parseInt(position, 10);
  if (!Number.isFinite(index)) return elements;
  const realIndex = index < 0 ? elements.length + index : index;
  if (realIndex < 0 || realIndex >= elements.length) return [];
  return [elements[realIndex] as HtmlNodeImpl];
}

function selectBranchElements(root: HtmlNodeImpl, rule: string): HtmlNode[] {
  const r = rule.trim();
  if (r.startsWith('@css:')) {
    const css = r.slice('@css:'.length).trim().split('@')[0]?.trim() ?? '';
    if (css === '') return [];
    try {
      return root.select(css);
    } catch {
      return [];
    }
  }
  const firstSegment = r.split('@')[0]?.trim() ?? '';
  if (looksLikeLegadoSegments(firstSegment)) {
    const segments = r.split('@').map((s) => s.trim()).filter((s) => s !== '');
    let current: HtmlNodeImpl[] = [root];
    for (const seg of segments) {
      if (isContentSegment(seg)) break;
      current = applySegment(current, seg);
      if (current.length === 0) return [];
    }
    return current;
  }
  const css = r.split('@')[0]?.trim() ?? '';
  if (css === '') return [];
  try {
    return root.select(css);
  } catch {
    return [];
  }
}

function looksLikeLegadoSegments(firstSegment: string): boolean {
  if (firstSegment === 'children' || firstSegment.startsWith('children.')) return true;
  if (firstSegment.startsWith('.')) {
    const after = firstSegment.slice(1);
    return after !== '' && !after.includes(' ');
  }
  const type = (firstSegment.split('.')[0] ?? '').toLowerCase();
  if (segmentTypes.has(type) && firstSegment.includes('.')) return true;
  if (commonTags.has(type)) {
    const rest = firstSegment.includes('.')
      ? firstSegment.slice(firstSegment.indexOf('.') + 1)
      : '';
    return rest === '' || /^-?\d+/.test(rest) || rest.startsWith('!');
  }
  return false;
}

function extractContent(element: HtmlNodeImpl, content: string): string | null {
  const c = content.trim();
  const key = c.toLowerCase();
  let value: string;
  if (key === 'text') value = element.text();
  else if (key === 'owntext') value = element.ownText();
  else if (key === 'textnodes') {
    value = element.textNodes().map((n) => n.text()).join('\n');
  } else if (key === 'html') value = element.html();
  else if (key === 'all') value = element.outerHtml();
  else value = element.attrs[c] ?? element.attrs[c.toLowerCase()] ?? '';
  value = value.trim();
  return value === '' ? null : value;
}

interface RegexReplacement {
  regex: string;
  replacement: string;
}

function splitRegexReplacement(rule: string): { base: string; info: RegexReplacement | null } {
  if (!rule.includes('##')) return { base: rule, info: null };
  const parts = rule.split('##');
  if (parts.length === 2) {
    return {
      base: (parts[0] ?? '').trim(),
      info: { regex: parts[1] ?? '', replacement: '' },
    };
  }
  const base = (parts[0] ?? '').trim();
  const regex = parts[1] ?? '';
  const replacement = parts.slice(2).join('##');
  return { base, info: { regex, replacement } };
}

function applyRegexReplacement(value: string, info: { base: string; info: RegexReplacement | null } | null): string {
  if (info === null || info.info === null) return value;
  // Kotlin: Regex(info.regex).replace(RuleBudget.text(value), info.replacement)
  return boundedReplace(value, info.info.regex, info.info.replacement);
}

export function findBodyNode(root: HtmlNode): HtmlNode {
  return findBody(root as HtmlNodeImpl);
}

export function getAllElementsFrom(root: HtmlNode): HtmlNode[] {
  return allElements(root as HtmlNodeImpl);
}

export { BLOCK_TAGS };

/**
 * Kotlin counterpart: NONE inside this module — this file replaces the third-party
 * `org.jsoup` (jsoup) runtime that every Kotlin file in `zlibrary/parser/` imports.
 *
 * Android source (Kotlin files that consume it):
 *   source/zlibrary/parser/ZLibraryLayoutParser.kt          (23 lines)
 *   source/zlibrary/parser/ZLibraryParserManager.kt        (67 lines)
 *   source/zlibrary/parser/BookcardLayoutParser.kt        (151 lines)
 *   source/zlibrary/parser/CoverExtractor.kt               (71 lines)
 *   source/zlibrary/parser/DesktopLayoutParser.kt         (113 lines)
 *   source/zlibrary/parser/GenericFallbackParser.kt       (164 lines)
 *   source/zlibrary/parser/LegacyLayoutParser.kt          (101 lines)
 *   source/zlibrary/parser/MobileLayoutParser.kt          (106 lines)
 *   source/zlibrary/ZLibraryAccessChecker.kt               (36 lines)
 *   source/zlibrary/ZLibraryWebViewHelper.kt              (199 lines)
 *   source/zlibrary/ZLibrarySource.kt                     (740 lines)
 *
 * WHY OWN IMPLEMENTATION: the Kotlin code leans on jsoup CSS selectors that the
 * existing `src/core/parser/legadoRule.ts` engine does NOT support
 * (`[a*=b]` substring match, `:not(...)`, `:contains(...)`, `+` / `>` combinators,
 * and jsoup's "select() includes self" traversal order). `src/core/parser/` is owned by
 * another module, so this file is a self-contained jsoup-compatible subset. Only the
 * surface actually used by the ported parsers is implemented — everything else is a
 * documented omission, never a silent behaviour change.
 *
 * jsoup semantics reproduced verbatim:
 *   - `Element.attr(name)` returns "" for a missing attribute (NOT null).
 *   - `Element.hasAttr(name)` = attribute present (used by `:not([hidden])`).
 *   - `Element.select()` also treats the element itself as a candidate (jsoup `Collector`
 *     runs `NodeTraversor` from the root), so `.row` matches the element and its descendants.
 *   - `Element.text()` = whitespace-normalised concatenation with a space inserted
 *     before/after block-level tags and `<br>`; `<script>`/`<style>` bodies are jsoup
 *     `DataNode`s and contribute NOTHING (they are stored as `HtmlDataNode` here, which
 *     `text()` / `ownText()` / `wholeTextOf()` skip exactly like jsoup skips non-`TextNode`s).
 *   - `Element.ownText()` = the direct text children joined with NO separator, normalised.
 *   - `Document.title()` = normalised text of the first `<title>`, else "".
 *   - `Jsoup.parse()` ALWAYS produces `#document > html > (head, body)`, even for a bare
 *     fragment — `HtmlTreeBuilder.initialiseParse()` inserts those three start tags. The tree
 *     builder below does the same, which is what makes `bestContainer()`'s `html`/`body` stop
 *     and any `html`/`head`/`body` selector behave like the Android build.
 *   - Selector results are returned in document order and de-duplicated.
 *
 * KNOWN DEVIATION (documented, not changed): jsoup's `Element.getAllElements()` INCLUDES the
 * element itself (`Collector.collect` seeds `found` with the root — the very quirk that makes
 * `select()` self-inclusive). Here it returns DESCENDANTS only. No file in the ported
 * `zlibrary/` + `library/` surface reads it that way (only `getElementsByTag` and
 * `Document.title()` consume it internally, and neither depends on self-inclusion), and the
 * helper is re-exported through `src/core/source/impl/jsoup.ts` for other modules, so the
 * behaviour is left as-is rather than changed mid-migration.
 *
 * OMITTED (never used by any ported Kotlin file): forms/namespaces, Jsoup `Selector`
 * `:regex`, `:matches`, `:matchesOwn`, `:containsWholeText`, `:containsOwn`, `:header`,
 * `:lt`/`:gt`, `:first-child`/`:last-child`/`:nth-child` index filters, jsoup's own
 * `Element.html()` pretty-printer, XML mode, and jsoup's full HTML5 entity table
 * (only the entities that appear in Z-Library markup are decoded; unknown named
 * entities are left verbatim exactly like the table below's `?? match` fallthrough).
 */

/** Whitespace normalisation identical to jsoup's `StringUtil.normaliseWhitespace`. */
function normaliseWhitespace(input: string): string {
  return input.replace(/[\t\n\f\r ]+/g, ' ');
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img',
  'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Block-level tags — jsoup inserts a space when crossing these in `text()`.
 * The list is jsoup `Tag.blockTags` (which is why `script`, `style`, `meta`, `link`, `head`
 * and `title` are here even though they carry no visible text: the `script`/`style` ELEMENTS
 * still contribute the surrounding spaces, exactly as they do on Android).
 */
const BLOCK_ELEMENTS = new Set([
  'address', 'applet', 'article', 'aside', 'audio', 'blockquote', 'body', 'br', 'canvas',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frames', 'frameset', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'ins',
  'del', 'legend', 'li', 'link', 'listing', 'main', 'marquee', 'math', 'menu', 'meta', 'nav',
  'noframes', 'noscript', 'ol', 'optgroup', 'option', 'p', 'plaintext', 'pre', 'script',
  'section', 'style', 'summary', 'svg', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title',
  'tr', 'ul', 'video',
]);

/** `<head>`-only tags (jsoup "in head" insertion mode) — everything else starts `<body>`. */
const HEAD_ONLY_ELEMENTS = new Set([
  'base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'template', 'title',
]);

/**
 * HTML5 "close a p element": the start tags that implicitly close an open `<p>`
 * (jsoup `InHead`/`HtmlTreeBuilder` implements the same rule). Kotlin relies on it only
 * indirectly — it keeps the DOM shape identical, which is what `parent()` / `bestContainer()`
 * walk — so the list is reproduced rather than approximated.
 */
const CLOSES_OPEN_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre',
  'section', 'summary', 'table', 'ul', 'xmp',
]);

/**
 * `tag` → tags that an opening occurrence implicitly closes. Mirrors the subset of the
 * HTML5 "generate implied end tags" / "close a p element" rules that Z-Library markup
 * (search result lists and detail property tables) relies on.
 */
const IMPLICIT_CLOSE: Record<string, ReadonlySet<string>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  p: new Set(['p']),
  option: new Set(['option']),
  optgroup: new Set(['option', 'optgroup']),
  tr: new Set(['tr', 'td', 'th']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  thead: new Set(['td', 'th', 'tr']),
  tbody: new Set(['td', 'th', 'tr', 'thead']),
  tfoot: new Set(['td', 'th', 'tr', 'thead', 'tbody']),
  rt: new Set(['rt', 'rp']),
  rp: new Set(['rt', 'rp']),
};

export class HtmlTextNode {
  readonly kind = 'text';
  data: string;
  parentNode: HtmlElement | null = null;

  constructor(data: string) {
    this.data = data;
  }
}

/**
 * jsoup `DataNode` — the raw payload of `<script>` / `<style>`.
 *
 * jsoup stores script/style bodies as `DataNode`, NOT `TextNode`, and `Element.text()` /
 * `ownText()` / `wholeText()` only collect `TextNode`s. Keeping a separate node type is what
 * makes `div.text()` ignore inline script source exactly like the Android build does.
 */
export class HtmlDataNode {
  readonly kind = 'data';
  data: string;
  parentNode: HtmlElement | null = null;

  constructor(data: string) {
    this.data = data;
  }
}

export class HtmlCommentNode {
  readonly kind = 'comment';
  data: string;
  parentNode: HtmlElement | null = null;

  constructor(data: string) {
    this.data = data;
  }
}

export class HtmlDoctypeNode {
  readonly kind = 'doctype';
  data: string;
  parentNode: HtmlElement | null = null;

  constructor(data: string) {
    this.data = data;
  }
}

export type HtmlChildNode = HtmlTextNode | HtmlDataNode | HtmlCommentNode | HtmlDoctypeNode;

function isElementNode(node: HtmlChildNode | HtmlElement): node is HtmlElement {
  return node instanceof HtmlElement;
}

export class HtmlElement {
  /** Lower-cased tag name, exactly like jsoup's normalised `tagName()`. */
  tagName: string;
  attributes: Record<string, string>;
  childNodes: Array<HtmlElement | HtmlChildNode> = [];
  parentNode: HtmlElement | null = null;
  /** true for the synthetic `#document` root (jsoup `Document`). */
  readonly isDocument: boolean;

  constructor(tagName: string, attributes: Record<string, string> = {}, isDocument = false) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.isDocument = isDocument;
  }

  appendChild<T extends HtmlElement | HtmlChildNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  /** Kotlin `Element.tagName()`. */
  tag(): string {
    return this.tagName;
  }

  /** jsoup `Element.attr(name)`: "" when the attribute is absent. */
  attr(name: string): string {
    return this.attributes[name] ?? '';
  }

  /** jsoup `Element.hasAttr(name)`. */
  hasAttr(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  /** jsoup `Element.id()`. */
  id(): string {
    return this.attr('id');
  }

  /** jsoup `Element.className()`. */
  className(): string {
    return this.attr('class');
  }

  /** jsoup `Element.classNames()`. */
  classNames(): string[] {
    return this.className().split(/\s+/).filter((c) => c !== '');
  }

  /** jsoup `Element.parent()`. */
  parent(): HtmlElement | null {
    return this.parentNode;
  }

  /** jsoup `Element.parents()` — immediate parent first, root last. */
  parents(): HtmlElement[] {
    const out: HtmlElement[] = [];
    let node = this.parentNode;
    while (node !== null) {
      out.push(node);
      node = node.parentNode;
    }
    return out;
  }

  /** jsoup `Element.siblings()` — all element siblings in document order. */
  siblings(): HtmlElement[] {
    if (this.parentNode === null) return [];
    return this.parentNode.childNodes.filter(isElementNode);
  }

  previousElementSibling(): HtmlElement | null {
    if (this.parentNode === null) return null;
    const list = this.parentNode.childNodes;
    const idx = list.indexOf(this);
    for (let i = idx - 1; i >= 0; i -= 1) {
      const node = list[i];
      if (node !== undefined && isElementNode(node)) return node;
    }
    return null;
  }

  /** jsoup `Element.children()` — element children only. */
  children(): HtmlElement[] {
    return this.childNodes.filter(isElementNode);
  }

  /** jsoup `Element.text()` — only `TextNode`s contribute (script/style bodies do not). */
  text(): string {
    let acc = '';
    const walk = (node: HtmlElement | HtmlChildNode): void => {
      if (node instanceof HtmlTextNode) {
        acc += node.data;
        return;
      }
      if (node instanceof HtmlElement) {
        const block = BLOCK_ELEMENTS.has(node.tagName);
        if (block) acc += ' ';
        for (const child of node.childNodes) walk(child);
        if (block) acc += ' ';
        return;
      }
      // comments / doctypes / DataNodes (script, style) contribute nothing, exactly like jsoup
    };
    walk(this);
    return normaliseWhitespace(acc).trim();
  }

  /** jsoup `Element.ownText()` — direct text children only, joined without a separator. */
  ownText(): string {
    let acc = '';
    for (const child of this.childNodes) {
      if (child instanceof HtmlTextNode) acc += child.data;
    }
    return normaliseWhitespace(acc).trim();
  }

  /** jsoup `Element.html()` — serialised children. */
  html(): string {
    let out = '';
    for (const child of this.childNodes) out += serialiseNode(child);
    return out;
  }

  /** jsoup `Element.outerHtml()`. */
  outerHtml(): string {
    return serialiseNode(this);
  }

  /** jsoup `Element.select(css)`. Includes the element itself, as jsoup does. */
  select(css: string): HtmlElement[] {
    return selectElements(this, css);
  }

  /** jsoup `Element.selectFirst(css)`. */
  selectFirst(css: string): HtmlElement | null {
    const found = selectElements(this, css);
    return found.length > 0 ? (found[0] as HtmlElement) : null;
  }

  /** jsoup `Element.getElementsByTag(name)`. */
  getElementsByTag(name: string): HtmlElement[] {
    const lower = name.toLowerCase();
    return getAllElements(this).filter((el) => el.tagName === lower);
  }
}

/** `Document` is just the `#document` element plus `title()`. */
export class HtmlDocument extends HtmlElement {
  constructor() {
    super('#document', {}, true);
  }

  /** jsoup `Document.title()`. */
  title(): string {
    for (const el of getAllElements(this)) {
      if (el.tagName === 'title') return el.text();
    }
    return '';
  }
}

/** Depth-first element list of the DESCENDANTS of `root` (jsoup `Element.getAllElements()`). */
export function getAllElements(root: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (node: HtmlElement): void => {
    for (const child of node.childNodes) {
      if (isElementNode(child)) {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// CSS selector engine
// ---------------------------------------------------------------------------

export type Combinator = 'descendant' | 'child' | 'adjacent' | 'sibling';

interface AttrMatcher {
  name: string;
  op: 'exists' | '=' | '*=' | '^=' | '$=' | '~=' | '|=';
  value: string;
  /** jsoup's trailing ` i` flag: `[attr*=value i]`. */
  ignoreCase: boolean;
}

interface SimpleSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrMatcher[];
  nots: SimpleSelector[];
  contains: string | null;
}

interface SelectorStep {
  /** Combinator that links this step to the FOLLOWING step. */
  combinator: Combinator;
  selector: SimpleSelector;
}

const selectorCache = new Map<string, SelectorStep[][]>();

function parseSimpleSelector(raw: string): SimpleSelector | null {
  const s = raw.trim();
  if (s === '') return null;
  const selector: SimpleSelector = {
    tag: null,
    id: null,
    classes: [],
    attrs: [],
    nots: [],
    contains: null,
  };
  let i = 0;
  const len = s.length;
  while (i < len) {
    const ch = s[i] as string;
    if (ch === '*') {
      // universal selector — no constraint, matches any tag
      i += 1;
    } else if (ch === '#') {
      i += 1;
      const start = i;
      while (i < len && !isSelectorSpecial(s[i] as string)) i += 1;
      selector.id = s.slice(start, i);
    } else if (ch === '.') {
      i += 1;
      const start = i;
      while (i < len && !isSelectorSpecial(s[i] as string)) i += 1;
      selector.classes.push(s.slice(start, i));
    } else if (ch === '[') {
      const end = findClosing(s, i, '[', ']');
      if (end < 0) return null;
      const attr = parseAttrMatcher(s.slice(i + 1, end));
      if (attr !== null) selector.attrs.push(attr);
      i = end + 1;
    } else if (ch === ':') {
      // `:not(...)` / `:contains(...)`
      const parenStart = s.indexOf('(', i);
      if (parenStart < 0) {
        i += 1;
        continue;
      }
      const parenEnd = findClosing(s, parenStart, '(', ')');
      if (parenEnd < 0) return null;
      const name = s.slice(i + 1, parenStart).trim().toLowerCase();
      const arg = s.slice(parenStart + 1, parenEnd);
      if (name === 'not') {
        const inner = parseSimpleSelector(arg);
        if (inner !== null) selector.nots.push(inner);
      } else if (name === 'contains') {
        // jsoup `:contains(text)` matches against `Element.text()` (case-insensitive).
        selector.contains = unquoteCss(arg);
      }
      // Any other pseudo-class is ignored: none of the ported Kotlin selectors use one, and
      // ignoring keeps parsing failure-free instead of silently matching nothing.
      // `:containsOwn` (jsoup matches `ownText()`) is therefore NOT implemented — see the
      // OMITTED list in the header. It must not be folded into `:contains`, or it would
      // silently change meaning instead of being documented as absent.
      i = parenEnd + 1;
    } else if (isTagChar(ch)) {
      const start = i;
      while (i < len && isTagChar(s[i] as string)) i += 1;
      selector.tag = s.slice(start, i).toLowerCase();
    } else {
      i += 1;
    }
  }
  return selector;
}

function isSelectorSpecial(ch: string): boolean {
  return ch === '#' || ch === '.' || ch === '[' || ch === ']' || ch === ':' || ch === '>' || ch === '+' || ch === '~' || ch === ' ';
}

function isTagChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

function findClosing(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function unquoteCss(value: string): string {
  const s = value.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseAttrMatcher(inner: string): AttrMatcher | null {
  const s = inner.trim();
  if (s === '') return null;
  const ops: Array<{ op: AttrMatcher['op']; token: string }> = [
    { op: '*=', token: '*=' },
    { op: '^=', token: '^=' },
    { op: '$=', token: '$=' },
    { op: '~=', token: '~=' },
    { op: '|=', token: '|=' },
    { op: '=', token: '=' },
  ];
  for (const { op, token } of ops) {
    const at = s.indexOf(token);
    if (at > 0) {
      const name = s.slice(0, at).trim().toLowerCase();
      if (name === '') return null;
      const raw = unquoteCss(s.slice(at + token.length));
      // jsoup's case-insensitivity flag is a trailing ` i` AFTER THE VALUE
      // (`[attr*=value i]`), never a suffix on the attribute name.
      const flagged = /^(.*?)\s+i$/.exec(raw);
      if (flagged !== null) {
        return { name, op, value: (flagged[1] ?? '').trim(), ignoreCase: true };
      }
      return { name, op, value: raw, ignoreCase: false };
    }
  }
  return { name: s.toLowerCase(), op: 'exists', value: '', ignoreCase: false };
}

function splitSteps(group: string): SelectorStep[] | null {
  const steps: SelectorStep[] = [];
  let buffer = '';
  let pendingCombinator: Combinator = 'descendant';
  let bracket = 0;
  let paren = 0;
  const flush = (): boolean => {
    const raw = buffer.trim();
    buffer = '';
    if (raw === '') {
      // Leading descendant combinator (e.g. `.resItemBox > a` starts with a tag, but
      // `> a` style is not used) — nothing to emit.
      pendingCombinator = 'descendant';
      return true;
    }
    const selector = parseSimpleSelector(raw);
    if (selector === null) return false;
    steps.push({ combinator: pendingCombinator, selector });
    pendingCombinator = 'descendant';
    return true;
  };
  for (const ch of group) {
    if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    if (bracket > 0 || paren > 0) {
      buffer += ch;
      continue;
    }
    if (ch === '>' || ch === '+' || ch === '~') {
      if (!flush()) return null;
      if (buffer !== '') buffer = '';
      if (ch === '>') pendingCombinator = 'child';
      else if (ch === '+') pendingCombinator = 'adjacent';
      else pendingCombinator = 'sibling';
      // a combinator may be followed by whitespace
      continue;
    }
    if (ch === ' ') {
      if (buffer.trim() !== '') {
        if (!flush()) return null;
        pendingCombinator = 'descendant';
      }
      continue;
    }
    buffer += ch;
  }
  if (!flush()) return null;
  return steps;
}

function compileSelector(css: string): SelectorStep[][] {
  const cached = selectorCache.get(css);
  if (cached !== undefined) return cached;
  const groups: SelectorStep[][] = [];
  for (const rawGroup of splitGroups(css)) {
    const steps = splitSteps(rawGroup);
    if (steps !== null && steps.length > 0) groups.push(steps);
  }
  selectorCache.set(css, groups);
  return groups;
}

/** Split on top-level commas only (commas inside `[]` or `()` stay put). */
function splitGroups(css: string): string[] {
  const out: string[] = [];
  let buffer = '';
  let bracket = 0;
  let paren = 0;
  for (const ch of css) {
    if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    if (ch === ',' && bracket === 0 && paren === 0) {
      out.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  out.push(buffer);
  return out.filter((g) => g.trim() !== '');
}

function matchesAttr(el: HtmlElement, matcher: AttrMatcher): boolean {
  if (!el.hasAttr(matcher.name)) return false;
  if (matcher.op === 'exists') return true;
  const raw = el.attr(matcher.name);
  const value = matcher.ignoreCase ? raw.toLowerCase() : raw;
  const expected = matcher.ignoreCase ? matcher.value.toLowerCase() : matcher.value;
  switch (matcher.op) {
    case '=':
      return value === expected;
    case '*=':
      return value.includes(expected);
    case '^=':
      return value.startsWith(expected);
    case '$=':
      return value.endsWith(expected);
    case '~=':
      return value.split(/\s+/).includes(expected);
    case '|=':
      return value === expected || value.startsWith(`${expected}-`);
    default:
      return false;
  }
}

function matchesSimple(el: HtmlElement, selector: SimpleSelector): boolean {
  if (selector.tag !== null && el.tagName !== selector.tag) return false;
  if (selector.id !== null && el.id() !== selector.id) return false;
  if (selector.classes.length > 0) {
    const classes = el.classNames();
    for (const cls of selector.classes) {
      if (!classes.includes(cls)) return false;
    }
  }
  for (const attr of selector.attrs) {
    if (!matchesAttr(el, attr)) return false;
  }
  for (const not of selector.nots) {
    if (matchesSimple(el, not)) return false;
  }
  if (selector.contains !== null) {
    if (!el.text().toLowerCase().includes(selector.contains.toLowerCase())) return false;
  }
  return true;
}

function matchesGroup(el: HtmlElement, steps: SelectorStep[]): boolean {
  const lastIndex = steps.length - 1;
  const last = steps[lastIndex];
  if (last === undefined || !matchesSimple(el, last.selector)) return false;
  let current: HtmlElement = el;
  for (let i = lastIndex - 1; i >= 0; i -= 1) {
    const step = steps[i];
    const next = steps[i + 1];
    if (step === undefined || next === undefined) return false;
    if (next.combinator === 'child') {
      const parent = current.parentNode;
      if (parent === null || !matchesSimple(parent, step.selector)) return false;
      current = parent;
    } else if (next.combinator === 'adjacent') {
      const prev = current.previousElementSibling();
      if (prev === null || !matchesSimple(prev, step.selector)) return false;
      current = prev;
    } else if (next.combinator === 'sibling') {
      let prev = current.previousElementSibling();
      let found: HtmlElement | null = null;
      while (prev !== null) {
        if (matchesSimple(prev, step.selector)) {
          found = prev;
          break;
        }
        prev = prev.previousElementSibling();
      }
      if (found === null) return false;
      current = found;
    } else {
      let ancestor: HtmlElement | null = current.parentNode;
      let found: HtmlElement | null = null;
      while (ancestor !== null) {
        if (matchesSimple(ancestor, step.selector)) {
          found = ancestor;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (found === null) return false;
      current = found;
    }
  }
  return true;
}

/** jsoup `Element.select(css)` — document order, de-duplicated across groups. */
export function selectElements(root: HtmlElement, css: string): HtmlElement[] {
  const groups = compileSelector(css);
  if (groups.length === 0) return [];
  const descendants = getAllElements(root);
  // jsoup's `Collector` traverses from the element itself, so the element IS a candidate.
  // The synthetic `#document` root is never a candidate (its tag can match no selector).
  const candidates = root.isDocument ? descendants : [root, ...descendants];
  const out: HtmlElement[] = [];
  for (const el of candidates) {
    for (const group of groups) {
      if (matchesGroup(el, group)) {
        out.push(el);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokenizer / tree builder
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  cent: '\u00a2',
  pound: '\u00a3',
  yen: '\u00a5',
  euro: '\u20ac',
  copy: '\u00a9',
  reg: '\u00ae',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  times: '\u00d7',
  divide: '\u00f7',
  deg: '\u00b0',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  dagger: '\u2020',
  trade: '\u2122',
};

function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
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
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
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

function serialiseNode(node: HtmlElement | HtmlChildNode): string {
  if (node instanceof HtmlTextNode) return escapeText(node.data);
  // jsoup `DataNode.outerHtml()` emits the payload verbatim (never entity-escaped).
  if (node instanceof HtmlDataNode) return node.data;
  if (node instanceof HtmlCommentNode) return `<!--${node.data}-->`;
  if (node instanceof HtmlDoctypeNode) return node.data;
  let out = `<${node.tagName}`;
  for (const [name, value] of Object.entries(node.attributes)) {
    out += value === '' ? ` ${name}=""` : ` ${name}="${escapeAttr(value)}"`;
  }
  if (VOID_ELEMENTS.has(node.tagName)) return `${out}>`;
  return `${out}>${node.html()}</${node.tagName}>`;
}

function appendText(parent: HtmlElement, data: string): void {
  if (data === '') return;
  const last = parent.childNodes[parent.childNodes.length - 1];
  if (last instanceof HtmlTextNode) {
    last.data += data;
    return;
  }
  parent.appendChild(new HtmlTextNode(data));
}

interface OpenTag {
  tag: string;
  attrs: Record<string, string>;
  end: number;
  selfClosing: boolean;
}

function parseOpenTag(html: string, start: number): OpenTag | null {
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
    if (html[i] === '/' && html[i + 1] === '>') return { tag, attrs, end: i + 2, selfClosing: true };
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
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        const valueStart = i;
        while (i < len && html[i] !== quote) i += 1;
        value = html.slice(valueStart, i);
        if (i < len) i += 1;
      } else {
        const valueStart = i;
        while (i < len && !/[\s>]/.test(html[i] as string)) i += 1;
        value = html.slice(valueStart, i);
      }
      value = decodeEntities(value);
    }
    attrs[name] = value;
  }
  return { tag, attrs, end: len, selfClosing: false };
}

function currentOpen(stack: HtmlElement[]): HtmlElement {
  return stack[stack.length - 1] as HtmlElement;
}

function closeImplicitTags(stack: HtmlElement[], tag: string): void {
  // HTML5 "close a p element": a <p> is closed by a block-level START tag, not only by
  // another <p>. Without this the DOM nests blocks inside the paragraph and every
  // `parent()` / `bestContainer()` walk lands on the wrong element.
  if (CLOSES_OPEN_P.has(tag)) {
    while (stack.length > 1 && currentOpen(stack).tagName === 'p') stack.pop();
  }
  const closable = IMPLICIT_CLOSE[tag];
  if (closable === undefined) return;
  while (stack.length > 1) {
    const top = currentOpen(stack);
    if (!closable.has(top.tagName)) return;
    stack.pop();
  }
}

function buildTree(doc: HtmlDocument, html: string): void {
  // jsoup `HtmlTreeBuilder.initialiseParse()` unconditionally inserts html > (head, body)
  // before the first token, so every parsed document has them even for a bare fragment.
  const htmlEl = doc.appendChild(new HtmlElement('html'));
  const headEl = htmlEl.appendChild(new HtmlElement('head'));
  const bodyEl = htmlEl.appendChild(new HtmlElement('body'));
  const stack: HtmlElement[] = [doc, htmlEl, headEl];
  let inHead = true;
  /** "in body": pop the implicit </head> and make <body> the insertion point. */
  const leaveHead = (): void => {
    if (!inHead) return;
    inHead = false;
    if (currentOpen(stack) === headEl) stack.pop();
    stack.push(bodyEl);
  };
  const lowerHtml = html.toLowerCase();
  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      const tail = decodeEntities(html.slice(i));
      // Whitespace in "in head" is discarded by jsoup; real text leaves the head first.
      if (inHead) {
        if (tail.trim() !== '') {
          leaveHead();
          appendText(currentOpen(stack), tail);
        }
      } else {
        appendText(currentOpen(stack), tail);
      }
      break;
    }
    if (lt > i) {
      const chunk = decodeEntities(html.slice(i, lt));
      if (!inHead || chunk.trim() !== '') {
        if (inHead) leaveHead();
        appendText(currentOpen(stack), chunk);
      }
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const endIdx = end < 0 ? len : end + 3;
      currentOpen(stack).appendChild(
        new HtmlCommentNode(html.slice(lt + 4, end < 0 ? len : end)),
      );
      i = endIdx;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      const endIdx = end < 0 ? len : end + 1;
      // jsoup keeps the DocumentType as a child of the document, not of <body>.
      doc.appendChild(new HtmlDoctypeNode(html.slice(lt, endIdx)));
      i = endIdx;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const endIdx = end < 0 ? len : end + 1;
      const rawName = html.slice(lt + 2, end < 0 ? len : end).trim().toLowerCase();
      if (rawName === 'head') {
        leaveHead();
        i = endIdx;
        continue;
      }
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if ((stack[s] as HtmlElement).tagName === rawName) {
          stack.length = s;
          break;
        }
      }
      i = endIdx;
      continue;
    }
    const parsed = parseOpenTag(html, lt);
    if (parsed === null) {
      if (inHead) leaveHead();
      appendText(currentOpen(stack), '<');
      i = lt + 1;
      continue;
    }
    if (parsed.tag === 'html' || parsed.tag === 'head' || parsed.tag === 'body') {
      // jsoup merges a repeated html/head/body start tag onto the element it already created.
      const target = parsed.tag === 'html' ? htmlEl : parsed.tag === 'head' ? headEl : bodyEl;
      for (const [name, value] of Object.entries(parsed.attrs)) {
        if (!target.hasAttr(name)) target.attributes[name] = value;
      }
      // `<html>` / `<head>` do not imply leaving the head (HTML5 "before head"/"in head");
      // only `<body>` (and any non-head-only tag below) does.
      if (parsed.tag === 'body') leaveHead();
      i = parsed.end;
      continue;
    }
    if (inHead && !HEAD_ONLY_ELEMENTS.has(parsed.tag)) leaveHead();
    closeImplicitTags(stack, parsed.tag);
    const el = currentOpen(stack).appendChild(new HtmlElement(parsed.tag, parsed.attrs));
    if (VOID_ELEMENTS.has(parsed.tag) || parsed.selfClosing) {
      i = parsed.end;
      continue;
    }
    if (RAW_TEXT_ELEMENTS.has(parsed.tag)) {
      const closeTag = `</${parsed.tag}`;
      const closeIdx = lowerHtml.indexOf(closeTag, parsed.end);
      const rawEnd = closeIdx < 0 ? len : closeIdx;
      const rawContent = html.slice(parsed.end, rawEnd);
      if (rawContent !== '') {
        // jsoup keeps <script>/<style> payloads as DataNode (invisible to text()) and
        // <title>/<textarea> as decoded TextNodes. Same split, same node classes.
        el.appendChild(
          parsed.tag === 'script' || parsed.tag === 'style'
            ? new HtmlDataNode(rawContent)
            : new HtmlTextNode(decodeEntities(rawContent)),
        );
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

/** jsoup `Jsoup.parse(html)` — tolerant HTML5 parse, no base URI resolution. */
export function parseHtmlDocument(html: string): HtmlDocument {
  const doc = new HtmlDocument();
  buildTree(doc, html);
  return doc;
}

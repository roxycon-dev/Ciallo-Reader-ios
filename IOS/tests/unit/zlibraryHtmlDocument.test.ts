/**
 * Unit tests for the local jsoup replacement: `src/core/source/zlibrary/parser/htmlDocument.ts`.
 *
 * Kotlin counterpart: NONE inside this module — it replaces the third-party `org.jsoup`
 * runtime that every `zlibrary/parser/*.kt` file depends on. These tests pin the jsoup
 * behaviours the ported parsers rely on, so a selector-engine regression cannot silently
 * change search/detail parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  getAllElements,
  parseHtmlDocument,
  selectElements,
  type HtmlElement,
} from '../../src/core/source/zlibrary/parser/htmlDocument';

const BOOKCARD_SEARCH = `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>Search: 三体</title><script src="/js/zlibrary.js"></script></head>
<body>
  <div id="content">
    <z-bookcard href="/book/123456/abc-def" download="/dl/123456/abc-def" extension="EPUB" filesize="9.40 MB">
      <div slot="title">  三体  </div>
      <div slot="author">刘慈欣</div>
      <img data-src="/covers/123456.jpg" alt="cover">
    </z-bookcard>
    <z-bookcard href="/book/123457/xyz" download="//cdn.example.com/dl/123457" extension="mobi" filesize="604 KB">
      <div slot="title"></div>
      <div slot="author">  </div>
      <img src="https://cdn-zlib.sk/c/2.jpg">
    </z-bookcard>
  </div>
</body>
</html>`;

describe('parseHtmlDocument — tree building', () => {
  it('keeps custom elements and their slot children as real elements', () => {
    const doc = parseHtmlDocument(BOOKCARD_SEARCH);
    const cards = doc.select('z-bookcard[href]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.selectFirst('[slot=title]')?.text()).toBe('三体');
    expect(cards[0]?.selectFirst('[slot=author]')?.text()).toBe('刘慈欣');
  });

  it('Document.title() returns the first <title> text', () => {
    expect(parseHtmlDocument(BOOKCARD_SEARCH).title()).toBe('Search: 三体');
    expect(parseHtmlDocument('<html><body>no title</body></html>').title()).toBe('');
  });

  it('attr() returns "" for a missing attribute and hasAttr() reports presence', () => {
    const doc = parseHtmlDocument('<p class="x">hi</p>');
    const p = doc.selectFirst('p') as HtmlElement;
    expect(p?.attr('data-missing')).toBe('');
    expect(p?.hasAttr('data-missing')).toBe(false);
    expect(p?.hasAttr('class')).toBe(true);
    expect(p?.classNames()).toEqual(['x']);
  });

  it('text() normalises whitespace and inserts separators around block tags', () => {
    const doc = parseHtmlDocument('<div id="a">一<div>二</div>三</div>');
    expect(doc.selectFirst('#a')?.text()).toBe('一 二 三');
  });

  it('ownText() only concatenates direct text children (joined without a separator)', () => {
    const doc = parseHtmlDocument('<div id="p">直接<span>嵌套</span>尾巴</div>');
    expect(doc.selectFirst('#p')?.ownText()).toBe('直接尾巴');
  });

  it('outerHtml() round-trips attributes, entities and void elements', () => {
    const doc = parseHtmlDocument('<div id="a" data-x=\'1&amp;2\'><img src="/a.png"><br>文字&amp;更多</div>');
    const out = (doc.selectFirst('#a') as HtmlElement).outerHtml();
    expect(out).toContain('data-x="1&amp;2"');
    expect(out).toContain('<img src="/a.png">');
    expect(out).toContain('<br>');
    expect(out).toContain('文字&amp;更多');
  });

  it('implicitly closes unclosed li / p / td elements', () => {
    const doc = parseHtmlDocument('<ul><li>one<li>two</ul><table><tr><td>a<td>b</tr></table>');
    expect(doc.select('li').map((li) => li.text())).toEqual(['one', 'two']);
    expect(doc.select('td').map((td) => td.text())).toEqual(['a', 'b']);
  });

  it('decodes numeric and named entities in text and attributes', () => {
    const doc = parseHtmlDocument('<a title="a&amp;b">&#19968;&#x4E8C;</a>');
    const a = doc.selectFirst('a') as HtmlElement;
    expect(a?.attr('title')).toBe('a&b');
    expect(a?.text()).toBe('一二');
  });

  it('treats <template> children as normal descendants (the hidden-link trap)', () => {
    const doc = parseHtmlDocument(
      '<div><template><a class="dlButton" href="/dl/hidden" hidden>模板</a></template><a class="dlButton" href="/dl/real">真</a></div>',
    );
    const dl = doc.select('a.dlButton[href*=/dl/]');
    expect(dl).toHaveLength(2);
    expect(doc.select('a.dlButton[href*=/dl/]:not([hidden])')).toHaveLength(1);
    expect(doc.select('a[href*=/dl/]:not([hidden])')[0]?.attr('href')).toBe('/dl/real');
  });

  it('getAllElements returns descendants while select also accepts the element itself', () => {
    const doc = parseHtmlDocument('<ul><li id="a">1</li><li id="b">2</li><li id="c">3</li></ul>');
    // `Jsoup.parse` always builds `#document > html > (head, body)`, so the walk starts there.
    // (Known deviation, documented in htmlDocument.ts: real jsoup would also include the
    // root itself, because `Collector.collect` seeds `found` with the root — the same quirk
    // that makes `select()` self-inclusive. Only `getElementsByTag`/`Document.title()` consume
    // this helper and neither depends on self-inclusion.)
    expect(getAllElements(doc as unknown as HtmlElement).map((el) => el.tagName)).toEqual([
      'html',
      'head',
      'body',
      'ul',
      'li',
      'li',
      'li',
    ]);
    expect(doc.select('li').map((el) => el.text())).toEqual(['1', '2', '3']);
    const ul = doc.selectFirst('ul');
    expect(ul).not.toBeNull();
    // `ul` is a candidate for select() too, so `ul li` still needs the descendant step.
    expect(doc.select('ul li')).toHaveLength(3);
  });

  it('reproduces Jsoup.parse\'s implicit html > (head, body) wrapper', () => {
    // jsoup `HtmlTreeBuilder.initialiseParse()` inserts these three start tags unconditionally,
    // so a bare fragment still yields them. `GenericFallbackParser.bestContainer()` walks
    // `parents()` and stops at `html`/`body`; without them it would walk up to the document.
    const doc = parseHtmlDocument('<a href="/book/1">x</a>');
    expect(doc.select('html')).toHaveLength(1);
    expect(doc.select('body')).toHaveLength(1);
    expect(doc.selectFirst('html > head')).not.toBeNull();
    expect(doc.selectFirst('html > body > a')?.text()).toBe('x');
    // head-only tags stay in <head>, everything else lands in <body>
    const withHead = parseHtmlDocument('<meta charset="utf-8"><title>T</title><div>d</div>');
    expect(withHead.selectFirst('head > title')?.text()).toBe('T');
    expect(withHead.select('head > meta')).toHaveLength(1);
    expect(withHead.select('body > div')).toHaveLength(1);
    // a repeated <html lang> merges its attributes onto the element jsoup already created
    expect(parseHtmlDocument('<html lang="zh"><p>x</p></html>').selectFirst('html')?.attr('lang')).toBe('zh');
  });

  it('text() ignores <script>/<style> bodies (jsoup stores them as DataNode, not TextNode)', () => {
    const doc = parseHtmlDocument(
      '<div id="a">前<script>var x = 1;</script><style>.a{}</style>后</div>',
    );
    // jsoup's `Element.text()` visitor only collects `TextNode`s; a DataNode contributes nothing.
    expect(doc.selectFirst('#a')?.text()).toBe('前 后');
    expect(doc.selectFirst('#a')?.ownText()).toBe('前后');
  });

  it('closes an open <p> when a block-level start tag follows (HTML5 "close a p element")', () => {
    const doc = parseHtmlDocument('<div id="wrap"><p>一<p>二<div>三</div></div>');
    const ps = doc.select('p');
    expect(ps.map((p) => p.text())).toEqual(['一', '二']);
    // the <div> is a SIBLING of the second <p>, not its child (jsoup closes <p> first)
    expect(doc.selectFirst('#wrap > div')).not.toBeNull();
  });
});

describe('CSS selector engine', () => {
  const doc = parseHtmlDocument(`<div id="root">
    <a class="dlButton" href="/dl/one">one</a>
    <a class="dlButton" href="/dl/two" hidden>two</a>
    <a class="other" href="/book/9/x">book</a>
    <i class="authors"><a>作者甲</a><a>作者乙</a></i>
    <div class="property"><div>Extension</div><div>EPUB3</div></div>
    <table id="booksList"><tr class="bookRow"><td>行</td></tr></table>
    <input name="email" type="text">
    <form action="/login"></form>
    <div style="background-image:url('/bg.jpg')">bg</div>
    <p class="hit">三体 II</p>
  </div>`);

  it('supports tag, class, id, attribute-presence and attribute-value', () => {
    expect(doc.select('div#root')).toHaveLength(1);
    expect(doc.select('a.dlButton')).toHaveLength(2);
    expect(doc.select('input[name=email]')).toHaveLength(1);
    expect(doc.select('form[action*=/login]')).toHaveLength(1);
  });

  it('supports attribute substring matching (the [attr*=value] form jsoup needs)', () => {
    expect(doc.select('a[href*=/dl/]')).toHaveLength(2);
    expect(doc.select('a[href*=/book/]')).toHaveLength(1);
  });

  it('supports :not() with a simple selector', () => {
    const visible = doc.select('a[href*=/dl/]:not([hidden])');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.attr('href')).toBe('/dl/one');
  });

  it('supports descendant and child combinators', () => {
    expect(doc.select('i.authors a')).toHaveLength(2);
    expect(doc.select('#root > i.authors')).toHaveLength(1);
    expect(doc.select('#booksList .bookRow td')).toHaveLength(1);
  });

  it('supports the adjacent sibling + :contains() combination', () => {
    const value = doc.selectFirst('div:contains(Extension) + div');
    expect(value?.text()).toBe('EPUB3');
  });

  it('supports selector lists and de-duplicates across groups', () => {
    expect(doc.select('a.other, a.dlButton')).toHaveLength(3);
    expect(doc.select('a.other, a.other')).toHaveLength(1);
    expect(doc.select('a[href*=/dl/], a[href*=/dl/]')).toHaveLength(2);
  });

  it('matches attribute selectors whose value contains selector-special characters', () => {
    const styled = doc.select("[style*='background-image']");
    expect(styled).toHaveLength(1);
    expect(doc.select('[style*=/bg/]')).toHaveLength(0);
  });

  it('an unknown pseudo-class is ignored rather than matching nothing', () => {
    expect(doc.select('p:first-letter')).toHaveLength(0);
  });

  it('selectElements on an Element includes the element itself (jsoup traversal order)', () => {
    const card = parseHtmlDocument('<z-bookcard class="row" href="/book/1"><div class="row">x</div></z-bookcard>');
    const root = card.selectFirst('z-bookcard') as HtmlElement;
    expect(selectElements(root, '.row')).toHaveLength(2);
  });
});

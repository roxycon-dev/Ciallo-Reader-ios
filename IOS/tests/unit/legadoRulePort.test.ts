/**
 * Line-by-line verification of `src/core/parser/legadoRule.ts`
 * (the TS port of Android `com.example.source.parser.LegadoRule.kt`, 321 lines /
 * 291 non-blank). Complements the existing `legadoRule.test.ts` smoke test with
 * exhaustive coverage of the operator set, nested selectors, the
 * regex-replacement syntax and the documented edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanJsonPath,
  evalFirst,
  evalValues,
  isJsonRule,
  parseHtml,
  selectElements,
} from '../../src/core/parser/legadoRule';

const html = `
<html><body>
  <div id="wrap">
    <ul class="booklist">
      <li class="item odd">
        <div class="cover"><img data-src="https://a.com/c1.jpg"></div>
        <h3 class="title"><a href="/book/1" title="链接1">三体</a></h3>
        <span class="author">刘慈欣</span>
        <span class="tags"><a href="/t/1">科幻</a><a href="/t/2">战争</a></span>
      </li>
      <li class="item even">
        <div class="cover"><img data-src="https://a.com/c2.jpg"></div>
        <h3 class="title"><a href="/book/2">球状闪电</a></h3>
        <span class="author">刘慈欣</span>
        <span class="tags"><a href="/t/3">科幻</a></span>
      </li>
      <li class="item odd">
        <div class="cover"><img data-src="https://a.com/c3.jpg"></div>
        <h3 class="title"><a href="/book/3">超新星纪元</a></h3>
        <span class="author">何夕</span>
        <span class="tags"></span>
      </li>
    </ul>
  </div>
  <div id="cp_content">
    <p>第一段</p>
    <p>第二段<em>强调</em></p>
    <img src="https://cdn.com/p1.jpg">
    <amp-img src="https://cdn.com/p2.jpg"></amp-img>
  </div>
</body></html>
`;

describe('LegadoRule — isJsonRule / cleanJsonPath', () => {
  it('detects $ , @json: and @js: prefixes only', () => {
    expect(isJsonRule('$.data.books')).toBe(true);
    expect(isJsonRule('@json:$..images')).toBe(true);
    expect(isJsonRule('@js:java.type()')).toBe(true);
    expect(isJsonRule('  $.a  ')).toBe(true);
    expect(isJsonRule('class.item.0@text')).toBe(false);
    expect(isJsonRule('@css:.a@text')).toBe(false);
    expect(isJsonRule('')).toBe(false);
  });

  it('cleans both prefixes, keeping the dot structure of cleanJsonPath', () => {
    // Kotlin: removePrefix("@json:").trim() then removePrefix("$").trimStart('.')
    // — trimStart('.') eats every leading dot.
    expect(cleanJsonPath('@json:$.data.books')).toBe('data.books');
    expect(cleanJsonPath('$..images')).toBe('images');
    expect(cleanJsonPath('$.data.books')).toBe('data.books');
    expect(cleanJsonPath('books')).toBe('books');
  });
});

describe('LegadoRule — selectElements (default segment rules)', () => {
  const doc = parseHtml(html);

  it('class / id / tag segments', () => {
    expect(selectElements(doc, 'class.item')).toHaveLength(3);
    expect(selectElements(doc, 'id.wrap')).toHaveLength(1);
    expect(selectElements(doc, 'class.booklist@tag.li')).toHaveLength(3);
    expect(selectElements(doc, 'id.nope')).toHaveLength(0);
  });

  it('positions: 0-based, negative from the end, out of range', () => {
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text')).toBe('三体');
    expect(evalFirst(doc, 'class.item.1@tag.a.0@text')).toBe('球状闪电');
    expect(evalFirst(doc, 'class.item.-1@tag.a.0@text')).toBe('超新星纪元');
    expect(evalFirst(doc, 'class.item.-3@tag.a.0@text')).toBe('三体');
    expect(evalFirst(doc, 'class.item.9@text')).toBeNull();
    expect(evalFirst(doc, 'class.item.-9@text')).toBeNull();
  });

  it('!position exclusion, single and multi-index', () => {
    expect(selectElements(doc, 'class.item!0')).toHaveLength(2);
    expect(selectElements(doc, 'class.item!0:2')).toHaveLength(1);
    expect(selectElements(doc, 'class.item!-1')).toHaveLength(2);
    expect(evalFirst(doc, 'class.item!0@tag.a.0@text')).toBe('球状闪电');
  });

  it('leading - reverses the list', () => {
    const reversed = selectElements(doc, '-class.item');
    expect(reversed).toHaveLength(3);
    const first = reversed[0];
    expect(first?.selectFirst('a')?.text()).toBe('超新星纪元');
  });

  it('|| takes the first non-empty branch', () => {
    expect(evalFirst(doc, 'class.nope.0@text||class.item.1@tag.a.0@text')).toBe('球状闪电');
    expect(evalFirst(doc, 'class.nope.0@text||class.nope2.0@text')).toBeNull();
  });

  it('text segment matches own text, children/all segments', () => {
    expect(evalFirst(doc, 'class.item@text.刘慈欣.0@text')).toBe('刘慈欣');
    expect(evalValues(doc, 'id.wrap@children.0')).toHaveLength(1);
    // `children` walks child nodes; the three <li> elements survive the
    // whitespace-only text nodes because extractContent blanks them out.
    expect(evalValues(doc, 'id.wrap@children.0@tag.ul@children')).toHaveLength(3);
    // `all` is both a segment type and a content keyword: as the LAST segment it
    // wins (Kotlin evalLegadoSegments lines 150-159), so the whole <ul> is
    // serialised rather than its descendants being collected.
    expect(selectElements(doc, 'class.booklist@all')).toHaveLength(1);
  });

  it('blank rules return an empty list', () => {
    expect(selectElements(doc, '')).toEqual([]);
    expect(selectElements(doc, '   ')).toEqual([]);
    expect(evalValues(doc, '')).toEqual([]);
  });
});

describe('LegadoRule — content keywords and attributes', () => {
  const doc = parseHtml(html);

  it('text / ownText / html / all', () => {
    // jsoup `text()` inserts a separator only around block-level elements, so
    // the inline <em> is glued to its parent text.
    expect(evalFirst(doc, '#cp_content@text')).toBe('第一段 第二段强调');
    expect(evalValues(doc, '#cp_content@html')).toHaveLength(1);
    expect(evalValues(doc, '#cp_content@all')[0]).toContain('<p>');
    // `ownText` reads only DIRECT text children; the <li> wraps everything in
    // elements, so its own text is empty (Kotlin line 282 → jsoup ownText()).
    expect(evalFirst(doc, 'class.item.0@ownText')).toBeNull();
    expect(evalFirst(doc, 'class.item.0@class.title.0@tag.a.0@ownText')).toBe('三体');
  });

  it('arbitrary attributes, including data-*', () => {
    expect(evalFirst(doc, 'class.item.0@class.cover.0@tag.img@data-src')).toBe(
      'https://a.com/c1.jpg',
    );
    expect(evalFirst(doc, 'class.item.0@tag.a.0@href')).toBe('/book/1');
    expect(evalFirst(doc, 'class.item.0@tag.a.0@title')).toBe('链接1');
    expect(evalFirst(doc, 'class.item.0@tag.a.0@nope')).toBeNull();
  });

  it('content keywords are case-insensitive', () => {
    expect(evalFirst(doc, '#cp_content@TEXT')).toBe('第一段 第二段强调');
    expect(evalFirst(doc, '#cp_content@HTML')).not.toBeNull();
  });

  it('bare @content reads the current element', () => {
    const a = doc.selectFirst('li.item a');
    expect(a).not.toBeNull();
    expect(evalFirst(a as never, '@text')).toBe('三体');
    expect(evalFirst(a as never, '@href')).toBe('/book/1');
  });
});

describe('LegadoRule — @css: and legacy css@attr', () => {
  const doc = parseHtml(html);

  it('@css: selects many and supports an attribute tail', () => {
    expect(evalValues(doc, '@css:span.author@text')).toEqual(['刘慈欣', '刘慈欣', '何夕']);
    expect(evalValues(doc, '@css:li.item h3.title a@href')).toEqual([
      '/book/1',
      '/book/2',
      '/book/3',
    ]);
  });

  it('@css: with an empty selector yields nothing', () => {
    expect(evalValues(doc, '@css:@text')).toEqual([]);
  });

  it('legacy css@attr without a class/id prefix', () => {
    expect(evalFirst(doc, 'span.author@text')).toBe('刘慈欣');
    expect(evalFirst(doc, 'h3.title a@href')).toBe('/book/1');
    // Legacy "legado index mixed into CSS" (.newrap a.0) fallback.
    expect(evalFirst(doc, 'ul.booklist a.0@href')).toBe('/book/1');
  });
});

describe('LegadoRule — && merge and ## regex replacement', () => {
  const doc = parseHtml(html);

  it('&& merges values from every branch', () => {
    const values = evalValues(
      doc,
      'class.item.0@class.tags.0@tag.a.0@text&&class.item.0@tag.h3.0@text',
    );
    expect(values).toEqual(['科幻', '三体']);
  });

  it('##regex##replacement rewrites the value', () => {
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text##三体##三体（重制版）')).toBe(
      '三体（重制版）',
    );
  });

  it('##regex with an omitted replacement deletes the match', () => {
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text##体')).toBe('三');
  });

  it('regex replacement applies to every value of a multi-match', () => {
    expect(evalValues(doc, '@css:span.author@text##刘慈欣##刘')).toEqual(['刘', '刘', '何夕']);
  });

  it('a blank result after replacement is filtered out', () => {
    expect(evalValues(doc, 'class.item.0@tag.a.0@text##三体##')).toEqual([]);
  });
});

describe('LegadoRule — nested selectors and multi-class segments', () => {
  const doc = parseHtml(html);

  it('chains four segments without leaking sibling results', () => {
    expect(evalFirst(doc, 'class.booklist@class.item.1@class.tags.0@tag.a.0@text')).toBe('科幻');
    expect(evalFirst(doc, 'class.booklist@class.item.2@class.tags.0@tag.a.0@text')).toBeNull();
  });

  it('supports a.space-separated multi-class segment', () => {
    expect(evalFirst(doc, 'class.booklist@class.item.0.odd@tag.a.0@text')).toBe('三体');
  });

  it('supports Legado tag shorthand (a.0 / img / button.0)', () => {
    expect(evalFirst(doc, 'class.item.0@a.0@text')).toBe('三体');
    expect(evalValues(doc, 'class.item.0@img@data-src')).toEqual(['https://a.com/c1.jpg']);
  });

  it('class.item!0 splits the exclusion off the name', () => {
    expect(evalFirst(doc, 'class.booklist@class.item!0@tag.a.0@text')).toBe('球状闪电');
  });
});

describe('LegadoRule — JS-expression rules are rejected', () => {
  const doc = parseHtml(html);

  it('@js: rules return nothing', () => {
    expect(evalValues(doc, '@js:java.type(1)')).toEqual([]);
    expect(evalFirst(doc, '@js:anything')).toBeNull();
  });

  it('{{ }} and {$ } interpolation markers short-circuit', () => {
    expect(evalValues(doc, '{{key}}')).toEqual([]);
    expect(evalValues(doc, '{$book}')).toEqual([]);
  });

  it('an unparsable CSS selector degrades to empty instead of throwing', () => {
    expect(() => evalValues(doc, '[[[.bad')).not.toThrow();
    expect(evalValues(doc, '@css:[[[.bad@text')).toEqual([]);
  });
});

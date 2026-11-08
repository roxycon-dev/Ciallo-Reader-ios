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
  <ul class="booklist">
    <li class="item">
      <div class="cover"><img data-src="https://a.com/cover1.jpg"></div>
      <h3 class="title"><a href="/book/1">三体</a></h3>
      <span class="author">刘慈欣</span>
    </li>
    <li class="item">
      <div class="cover"><img data-src="https://a.com/cover2.jpg"></div>
      <h3 class="title"><a href="/book/2">球状闪电</a></h3>
      <span class="author">刘慈欣</span>
    </li>
    <li class="item">
      <div class="cover"><img data-src="https://a.com/cover3.jpg"></div>
      <h3 class="title"><a href="/book/3">超新星纪元</a></h3>
      <span class="author">刘慈欣</span>
    </li>
  </ul>
</body></html>
`;

describe('legadoRule', () => {
  const doc = parseHtml(html);

  it('parses simple HTML and exposes class/id rules', () => {
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text')).toBe('三体');
    expect(evalFirst(doc, 'class.item.-1@tag.a.0@text')).toBe('超新星纪元');
    expect(evalFirst(doc, '.item.1@tag.a.0@text')).toBe('球状闪电');
    expect(evalFirst(doc, 'id.missing@text')).toBeNull();
  });

  it('supports || first non-empty branch', () => {
    expect(evalFirst(doc, 'class.missing.0@text||class.item.1@tag.a.0@text')).toBe('球状闪电');
  });

  it('supports ##regex##replacement', () => {
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text##三体##三体（重制版）')).toBe('三体（重制版）');
  });

  it('supports @css:.title@text', () => {
    expect(evalFirst(doc, '@css:li.item h3.title a@text')).toBe('三体');
    expect(evalFirst(doc, '@css:.title@text')).toBe('三体');
  });

  it('applies position .0 and !0 exclusion', () => {
    const items = selectElements(doc, 'class.item');
    expect(items).toHaveLength(3);
    const first = selectElements(doc, 'class.item.0');
    expect(first).toHaveLength(1);
    expect(evalFirst(doc, 'class.item.0@tag.a.0@text')).toBe('三体');
    const excluded = selectElements(doc, 'class.item!0');
    expect(excluded).toHaveLength(2);
    // '@tag.a.0@text' with a leading '@' is a content rule in Kotlin
    // (attr name lookup, yields []); the element-rule spelling has no '@'.
    expect(evalValues(excluded[0] as never, 'tag.a.0@text')).toEqual(['球状闪电']);
  });

  it('evalFirst returns a string', () => {
    const value = evalFirst(doc, 'span.author@text');
    expect(typeof value).toBe('string');
    expect(value).toBe('刘慈欣');
  });

  it('merges && branches', () => {
    const values = evalValues(doc, 'class.item.0@class.cover.0@img@src&&class.item.0@tag.h3.0@text');
    expect(values.length).toBeGreaterThan(0);
  });

  it('supports old-format css@attr and tag shorthand', () => {
    expect(evalFirst(doc, 'span.author@text')).toBe('刘慈欣');
    expect(evalFirst(doc, 'a.0@href')).toBe('/book/1');
    expect(evalFirst(doc, 'li.item:eq(1) a@href')).toBe('/book/2');
  });

  it('reverses lists with leading -', () => {
    const reversed = selectElements(doc, '-class.item');
    expect(reversed).toHaveLength(3);
    const link = reversed[0]?.selectFirst('a');
    expect(link?.text()).toBe('超新星纪元');
  });

  it('detects JSON rules and cleans paths', () => {
    expect(isJsonRule('$.data.books')).toBe(true);
    expect(isJsonRule('@json:$..images')).toBe(true);
    expect(isJsonRule('@js:java')).toBe(true);
    expect(isJsonRule('class.item.0@text')).toBe(false);
    expect(cleanJsonPath('@json:$.data.books')).toBe('data.books');
    // Kotlin removePrefix("$").trimStart('.') strips ALL leading dots:
    // "$..images" → "..images" → "images".
    expect(cleanJsonPath('$..images')).toBe('images');
  });

  it('supports content keywords including html', () => {
    const snippet = parseHtml('<div id="cp_img"><p><img src="https://x.com/1.jpg"></p></div>');
    const values = evalValues(snippet, '#cp_img@html');
    expect(values).toHaveLength(1);
    expect(values[0]).toContain('<img');
  });

  it('evaluates content-only rules on a node', () => {
    const el = doc.selectFirst('li.item a');
    expect(el).not.toBeNull();
    expect(evalFirst(el as never, '@text')).toBe('三体');
    expect(evalFirst(el as never, '@href')).toBe('/book/1');
  });
});

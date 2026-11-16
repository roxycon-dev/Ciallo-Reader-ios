import { describe, expect, it } from 'vitest';
import { extractCleanTextFromHtml } from '../../src/core/parser/htmlToText';

describe('htmlToText', () => {
  it('strips script and joins paragraphs', () => {
    const html = '<head><title>T</title></head><body><script>var x=1;</script><p>第一段</p><p>第二段</p></body>';
    expect(extractCleanTextFromHtml(html)).toBe('第一段\n\n第二段');
  });

  it('handles ruby, rt removal, and supplementary entities', () => {
    const html =
      '<head><title>坏标题</title></head><p><ruby>漢字<rt>かんじ</rt></ruby>&#x1F600;</p><script>垃圾</script><p>第二段</p>';
    expect(extractCleanTextFromHtml(html)).toBe('漢字😀\n\n第二段');
  });

  it('unescapes named entities', () => {
    const html = '<div>&nbsp;X&lt;Y&gt; &amp; &quot;q&quot; &apos;a&apos;</div><p>b</p>';
    expect(extractCleanTextFromHtml(html)).toBe('X<Y> & "q" \'a\'\n\nb');
  });

  it('returns empty string for blank input', () => {
    expect(extractCleanTextFromHtml('')).toBe('');
    expect(extractCleanTextFromHtml('   ')).toBe('');
  });
});

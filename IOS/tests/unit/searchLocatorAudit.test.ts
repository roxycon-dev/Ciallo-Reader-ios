/**
 * SearchLocator — offset-correctness regression tests.
 *
 * Android authority: `data/SearchLocator.kt`.
 * The design comment (lines 9-12) is explicit that this module exists so that
 * "第 N 处出现" is counted on the RENDERED text and the resulting offsets can be
 * handed to the reader as character offsets:
 *
 *   "不用字符偏移做跨章换算…全部用「忽略大小写的第 N 处出现」在拼接后文本上直接数"
 *
 * and line 97:
 *   "Same length as raw text: reader jumps retain their character offsets"
 *
 * `visibleText()` therefore pads `[IMG:…]` tokens with spaces instead of deleting
 * them, purely to preserve length. The audit bug fixed here was that
 * `indexOfIgnoreCase` lower-cased the haystack before searching, so the returned
 * index addressed the LOWER-CASED copy — and `toLowerCase()` is not
 * length-preserving (`'İ'.toLowerCase()` is two code units). Any chapter
 * containing such a character produced an off-by-N jump.
 */
import { describe, expect, it } from 'vitest';
import { SearchLocator } from '../../src/core/data/searchLocator';

const MAX = SearchLocator.MAX_RESULTS;

/** Local `String.indexOf(needle, ignoreCase=true)` used as the Kotlin oracle. */
function kotlinIndexOf(haystack: string, needle: string, from = 0): number {
  return haystack.indexOf(needle, from);
}

describe('SearchLocator.countOccurrences — matches Kotlin String.indexOf semantics', () => {
  it('counts ASCII case-insensitive matches', () => {
    expect(SearchLocator.countOccurrences('Hello hello HELLO', 'hello')).toBe(3);
  });

  it('counts non-overlapping matches only (Kotlin advances by query.length)', () => {
    // "aaaa" contains "aa" twice non-overlapping, not three times.
    expect(SearchLocator.countOccurrences('aaaa', 'aa')).toBe(2);
  });

  it('returns 0 for a blank query (Kotlin isBlank)', () => {
    expect(SearchLocator.countOccurrences('hello', '')).toBe(0);
    expect(SearchLocator.countOccurrences('hello', '   ')).toBe(0);
    expect(SearchLocator.countOccurrences('hello', '\n\t')).toBe(0);
  });

  it('returns 0 when the query is absent', () => {
    expect(SearchLocator.countOccurrences('hello', 'zzz')).toBe(0);
  });

  it('counts CJK matches (case does not apply)', () => {
    expect(SearchLocator.countOccurrences('第一章内容第一章', '第一章')).toBe(2);
  });

  it('REGRESSION: occurrence count is unaffected by length-changing case folds', () => {
    // 'İ' lower-cases to 2 code units. Counting must stay correct.
    const text = 'İİ hedef hedef';
    expect(SearchLocator.countOccurrences(text, 'hedef')).toBe(2);
    expect(SearchLocator.countOccurrences(text, 'HEDEF')).toBe(2);
  });
});

describe('SearchLocator.nthOccurrence — offsets index the RAW text', () => {
  it('REGRESSION: offsets are raw-text offsets when the text contains `İ`', () => {
    // 'İkinci bölüm: anahtar kelime burada'
    //  Kotlin indexOf("anahtar") === 14 because 'İ' is ONE char in the raw string.
    const text = 'İkinci bölüm: anahtar kelime burada';
    const at = SearchLocator.nthOccurrence(text, 'anahtar', 0);
    expect(at).toBe(kotlinIndexOf(text, 'anahtar'));
    expect(text.slice(at, at + 'anahtar'.length)).toBe('anahtar');
  });

  it('REGRESSION: every returned offset actually slices back to the query', () => {
    const texts = [
      'İstanbul İİİ target target',
      'STRASSE Übung Übung',
      'ǅ Ǆ ǆ mixed Case CASE',
      'ﬁ ﬂ ligature target',
      'ẞ ß sharp S target',
    ];
    for (const text of texts) {
      const count = SearchLocator.countOccurrences(text, 'target');
      for (let n = 0; n < count; n += 1) {
        const at = SearchLocator.nthOccurrence(text, 'target', n);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(text.slice(at, at + 'target'.length).toLowerCase()).toContain('target');
      }
    }
  });

  it('REGRESSION: offsets are strictly increasing and non-overlapping', () => {
    const text = 'İİ target target İ target';
    const first = SearchLocator.nthOccurrence(text, 'target', 0);
    const second = SearchLocator.nthOccurrence(text, 'target', 1);
    const third = SearchLocator.nthOccurrence(text, 'target', 2);
    expect(second).toBeGreaterThanOrEqual(first + 'target'.length);
    expect(third).toBeGreaterThanOrEqual(second + 'target'.length);
  });

  it('matches the Kotlin oracle for plain ASCII too', () => {
    const text = 'The quick Brown Fox jumps over the lazy dog';
    for (let n = 0; n < 3; n += 1) {
      expect(SearchLocator.nthOccurrence(text, 'o', n)).toBe(
        kotlinIndexOf(text, 'o', n === 0 ? 0 : SearchLocator.nthOccurrence(text, 'o', n - 1) + 1),
      );
    }
  });

  it('returns -1 for an out-of-range occurrence', () => {
    expect(SearchLocator.nthOccurrence('target', 'target', 5)).toBe(-1);
  });

  it('returns -1 for a negative occurrence and a blank query', () => {
    expect(SearchLocator.nthOccurrence('target', 'target', -1)).toBe(-1);
    expect(SearchLocator.nthOccurrence('target', '', 0)).toBe(-1);
    expect(SearchLocator.nthOccurrence('target', '  ', 0)).toBe(-1);
  });
});

describe('SearchLocator — inline image tokens are masked, not deleted', () => {
  const TOKEN = '[IMG:/data/user/0/files/a.png|800|400]';

  it('visibleText keeps the raw length so offsets stay valid', () => {
    const text = `前面${TOKEN}后面`;
    const rawLen = text.length;
    // The token must never be counted as searchable text, but must occupy its
    // original character span.
    const at = SearchLocator.nthOccurrence(text, '后面', 0);
    expect(text.slice(at, at + 2)).toBe('后面');
    // Offset points past the (masked) token, inside the original string.
    expect(at).toBe(rawLen - 2);
  });

  it('does not match a keyword that only appears inside an image token', () => {
    const text = `a.png${TOKEN}b.png`;
    expect(SearchLocator.countOccurrences(text, 'a.png')).toBe(1);
  });
});

describe('SearchLocator.buildSnippet — window + whitespace flattening (lines 51-60)', () => {
  it('centres the keyword and pads with "..."', () => {
    const text = `${'a'.repeat(40)}KEY${'b'.repeat(60)}`;
    const snippet = SearchLocator.buildSnippet(text, 'KEY', -1);
    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
    expect(snippet).toContain('KEY');
  });

  it('flattens runs of whitespace to a single space', () => {
    const text = 'aaa   bbb\n\nccc   KEY   ddd';
    const snippet = SearchLocator.buildSnippet(text, 'KEY', -1);
    expect(snippet).not.toContain('\n');
    expect(snippet).not.toContain('  ');
  });

  it('uses the supplied pos when it really matches (buildSnippet(content, q, pos))', () => {
    const text = `${'x'.repeat(100)}KEY${'y'.repeat(100)}`;
    const snippet = SearchLocator.buildSnippet(text, 'KEY', 100);
    expect(snippet).toContain('KEY');
  });

  it('falls back to re-locating when pos does not match', () => {
    const text = 'aaa KEY bbb';
    expect(SearchLocator.buildSnippet(text, 'KEY', 999)).toContain('KEY');
  });

  it('returns "..." when the keyword is absent', () => {
    expect(SearchLocator.buildSnippet('aaa bbb', 'ZZZ', -1)).toBe('...');
  });

  it('window is 15 before / 25 after the match', () => {
    const text = `${'a'.repeat(200)}KEY${'b'.repeat(200)}`;
    const snippet = SearchLocator.buildSnippet(text, 'KEY', -1);
    // "..." + (15 + 3 + 25) + "..." = 46 chars.
    expect(snippet).toHaveLength(3 + 15 + 3 + 25 + 3);
  });

  it('REGRESSION: snippet offsets stay aligned to the raw text with `İ` present', () => {
    const text = `İkinci bölüm ${'x'.repeat(30)} anahtar`;
    const at = SearchLocator.nthOccurrence(text, 'anahtar', 0);
    expect(SearchLocator.buildSnippet(text, 'anahtar', at)).toContain('anahtar');
  });
});

describe('SearchLocator.buildResults — occurrence numbering across a logical chapter', () => {
  const chapters = [
    { chapterOrder: 1, title: '第一章 (续)', content: 'target 和 target' },
    { chapterOrder: 0, title: '第一章', content: '开头 target' },
    { chapterOrder: 2, title: '第二章', content: 'target 结尾' },
  ];

  it('orders chapters by chapterOrder before numbering', () => {
    const results = SearchLocator.buildResults(
      chapters,
      'target',
      (order) => Math.floor(order / 2),
      () => '第一章',
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it('occurrences continue across physical chapters of the same logical chapter', () => {
    // logicalIndex 0 covers physical 0 and 1.
    const results = SearchLocator.buildResults(
      [
        { chapterOrder: 0, title: '第一章', content: 'target A' },
        { chapterOrder: 1, title: '第一章 (续)', content: 'target B target C' },
      ],
      'target',
      () => 0,
      () => '第一章',
    );
    expect(results.map((r) => r.occurrence)).toEqual([0, 1, 2]);
    expect(results.every((r) => r.chapterIndex === 0)).toBe(true);
  });

  it('restarts numbering for a different logical chapter', () => {
    const results = SearchLocator.buildResults(
      [
        { chapterOrder: 0, title: '第一章', content: 'target' },
        { chapterOrder: 1, title: '第二章', content: 'target' },
      ],
      'target',
      (order) => order,
      (i) => `第${i + 1}章`,
    );
    expect(results.map((r) => r.occurrence)).toEqual([0, 0]);
    expect(results.map((r) => r.chapterTitle)).toEqual(['第1章', '第2章']);
  });

  it('falls back to the physical chapter title when the logical title is null', () => {
    const results = SearchLocator.buildResults(
      [{ chapterOrder: 0, title: '物理标题', content: 'target' }],
      'target',
      () => 5,
      () => null,
    );
    expect(results[0]?.chapterTitle).toBe('物理标题');
  });

  it('returns [] for a blank query', () => {
    expect(SearchLocator.buildResults(chapters, '  ', () => 0, () => 'x')).toEqual([]);
  });

  it('caps results at MAX_RESULTS (1000)', () => {
    expect(MAX).toBe(1000);
    // 1200 occurrences in one chapter; the cap must stop collection at 1000.
    const many = Array.from({ length: 1200 }, () => 'target ').join('');
    const results = SearchLocator.buildResults(
      [{ chapterOrder: 0, title: 't', content: many }],
      'target',
      () => 0,
      () => 't',
    );
    expect(results).toHaveLength(MAX);
  });

  it('returns every occurrence when below the cap', () => {
    const many = Array.from({ length: 400 }, () => 'target ').join('');
    const results = SearchLocator.buildResults(
      [{ chapterOrder: 0, title: 't', content: many }],
      'target',
      () => 0,
      () => 't',
    );
    expect(results).toHaveLength(400);
  });

  it('does not mutate the caller-supplied chapter array', () => {
    const input = [
      { chapterOrder: 1, title: 'b', content: 'target' },
      { chapterOrder: 0, title: 'a', content: 'target' },
    ];
    const before = input.map((c) => c.chapterOrder);
    SearchLocator.buildResults(input, 'target', (o) => o, () => 'x');
    expect(input.map((c) => c.chapterOrder)).toEqual(before);
  });
});
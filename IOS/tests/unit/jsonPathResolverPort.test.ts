/**
 * Line-by-line verification of `src/core/parser/jsonPathResolver.ts`
 * (the TS port of Android `com.example.source.parser.JsonPathResolver.kt`,
 * 202 lines / 183 non-blank) and `src/core/parser/ruleBudget.ts`
 * (port of `RuleBudget.kt`, 32 lines / 31 non-blank).
 *
 * Complements `jsonPath.test.ts` with the operator set, recursive descent,
 * budget enforcement and the documented edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  getLong,
  getString,
  resolveArray,
  resolveStringArray,
} from '../../src/core/parser/jsonPathResolver';
import {
  MAX_JSON_CHARS,
  MAX_NESTING,
  MAX_RULE_LENGTH,
  boundedText,
  validateJson,
  validateRule,
} from '../../src/core/parser/ruleBudget';

const json = JSON.stringify({
  status: 'ok',
  data: {
    books: [
      { book_id: 'b001', book_name: 'Three-Body Problem', download_link: 'https://x/1.epub' },
      { book_id: 'b002', book_name: 'Ball Lightning' },
    ],
    lists: [
      { url: 'https://cdn/1' },
      { url: 'https://cdn/2' },
      { url: 'https://cdn/3' },
    ],
    nested: { deep: { images: ['https://cdn/deep.jpg'] } },
  },
  empty: [],
  scalars: { n: 42, f: 1.5, b: true, s: 'x', z: null },
});

const root = JSON.parse(json) as Record<string, unknown>;

describe('JsonPathResolver — parseSegments normalisation', () => {
  it('accepts bare, $ and @json: prefixes identically', () => {
    expect(getString(root, 'status')).toBe('ok');
    expect(getString(root, '$.status')).toBe('ok');
    expect(getString(root, '@json:status')).toBe('ok');
    expect(getString(root, '@json:$.status')).toBe('ok');
  });

  it('an empty path or a bare "$" selects the root itself', () => {
    expect(resolveArray(json, '')).toHaveLength(1);
    expect(resolveArray(json, '$')).toHaveLength(1);
    expect(resolveArray(json, '   ')).toHaveLength(1);
  });

  it('[*] is folded to the bare [] wildcard', () => {
    expect(resolveArray(json, 'data.lists[*]')).toHaveLength(3);
    expect(resolveArray(json, 'data.lists[]')).toHaveLength(3);
  });

  it('"$.." prefix-stripping eats the first dot of "..": no recursive marker', () => {
    // Kotlin: "$..images".removePrefix("$.") → ".images" — the ".." rewrite
    // never fires, so this is a plain top-level "images" lookup → [] here.
    expect(resolveStringArray(json, '$..images')).toEqual([]);
    // Explicit recursive descent via a bare "**" segment does find it:
    expect(resolveStringArray(json, '**.images')).toEqual(['https://cdn/deep.jpg']);
  });

  it('a blank / missing payload resolves to nothing', () => {
    expect(resolveArray('', 'data')).toEqual([]);
    expect(resolveArray('   ', 'data')).toEqual([]);
    expect(resolveArray(json, '')).toHaveLength(1);
  });
});

describe('JsonPathResolver — resolveSegmentAll operators', () => {
  it('plain field', () => {
    expect(getString(root, 'status')).toBe('ok');
    // A numeric segment without brackets is a KEY lookup, not an index
    // (Kotlin line 194-199: `item.opt(segment)` on a JSONObject).
    expect(getString(root, 'data.books.0.book_id')).toBeNull();
  });

  it('[n] index, out of range and non-numeric', () => {
    expect(getString(root, 'data.books[0].book_name')).toBe('Three-Body Problem');
    expect(getString(root, 'data.books[5].book_name')).toBeNull();
    expect(getString(root, 'data.books[abc].book_name')).toBeNull();
    expect(getString(root, 'data.books[-1].book_name')).toBeNull();
  });

  it('[] wildcard only expands arrays', () => {
    expect(resolveArray(json, 'data.lists[]')).toHaveLength(3);
    expect(resolveArray(json, 'data.books')).toHaveLength(2);
  });

  it('books[] applies the key first, then expands', () => {
    expect(resolveArray(json, 'data.books[]')).toHaveLength(2);
  });

  it('** recursive descent collects every nested value', () => {
    // "$..book_id" does NOT descend (the "$." prefix strip eats one of the
    // two dots, so ".." is never rewritten to "**."); use a bare "**".
    expect(resolveStringArray(json, '$..book_id')).toEqual([]);
    expect(resolveStringArray(json, '**.book_id')).toEqual(['b001', 'b002']);
  });

  it('** skips explicit JSON nulls', () => {
    expect(resolveStringArray(json, 'scalars.**')).not.toContain('null');
  });

  it('resolveStringArray de-duplicates in first-seen order', () => {
    const dup = JSON.stringify({ a: ['x', 'y', 'x'], b: ['y', 'z'] });
    expect(resolveStringArray(dup, 'a')).toEqual(['x', 'y']);
    // "$.." → strip "$." → "." → no segments → resolveAll returns the root
    // itself, stringified — NOT a descent (Android behavior, verified in
    // the ported parseSegments comment).
    expect(resolveStringArray(dup, '$..')).toEqual([
      '{"a":["x","y","x"],"b":["y","z"]}',
    ]);
  });
});

describe('JsonPathResolver — getString / getLong coercion', () => {
  it('stringifies scalars and object literals', () => {
    expect(getString(root, 'scalars.s')).toBe('x');
    expect(getString(root, 'scalars.b')).toBe('true');
    expect(getString(root, 'scalars.n')).toBe('42');
    // An explicit JSON null is dropped by resolveSegmentAll (Kotlin line 197),
    // so getString never sees the org.json NULL sentinel on this path.
    expect(getString(root, 'scalars.z')).toBeNull();
    expect(getString(root, 'data')).toBe(JSON.stringify(root['data']));
  });

  it('null / empty path yields null', () => {
    expect(getString(root, null)).toBeNull();
    expect(getString(root, '')).toBeNull();
    expect(getString(root, 'missing')).toBeNull();
  });

  it('getLong only accepts a pure integer string', () => {
    expect(getLong(root, 'scalars.n')).toBe(42);
    expect(getLong(root, 'scalars.f')).toBeNull();
    expect(getLong(root, 'scalars.s')).toBeNull();
    expect(getLong(root, 'scalars.b')).toBeNull();
    expect(getLong(root, null)).toBeNull();
  });
});

describe('JsonPathResolver — resolveArray filters', () => {
  it('keeps only object members of an array', () => {
    expect(resolveArray(json, 'data.lists')).toHaveLength(3);
    // A bare object target is itself a valid row (Kotlin line 28-30).
    expect(resolveArray(json, 'scalars')).toHaveLength(1);
    expect(resolveArray(json, 'empty')).toHaveLength(0);
  });

  it('a bare object target is returned as a single row', () => {
    const rows = resolveArray(json, 'data.books[0]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.book_id).toBe('b001');
  });

  it('a malformed payload degrades to an empty list', () => {
    expect(resolveArray('{not json', 'a')).toEqual([]);
    expect(resolveArray('"a string"', 'a')).toEqual([]);
    expect(resolveArray('42', 'a')).toEqual([]);
  });
});

describe('RuleBudget — validateRule', () => {
  it('accepts a rule at the length and nesting limits', () => {
    expect(() => validateRule('a'.repeat(MAX_RULE_LENGTH))).not.toThrow();
    const nested = '@'.repeat(MAX_NESTING);
    expect(() => validateRule(nested)).not.toThrow();
  });

  it('rejects an over-long rule with 书源规则过长', () => {
    expect(() => validateRule('a'.repeat(MAX_RULE_LENGTH + 1))).toThrow('书源规则过长');
  });

  it('rejects too many @ & | separators with 书源规则嵌套过多', () => {
    expect(() => validateRule(`${'@'.repeat(MAX_NESTING + 1)}`)).toThrow('书源规则嵌套过多');
    expect(() => validateRule(`${'&'.repeat(MAX_NESTING + 1)}`)).toThrow('书源规则嵌套过多');
    expect(() => validateRule(`${'|'.repeat(MAX_NESTING + 1)}`)).toThrow('书源规则嵌套过多');
  });
});

describe('RuleBudget — validateJson', () => {
  it('accepts JSON within the size and depth limits', () => {
    expect(() => validateJson('{"a":1}')).not.toThrow();
    const deep = `${'['.repeat(64)}${']'.repeat(64)}`;
    expect(() => validateJson(deep)).not.toThrow();
  });

  it('rejects an over-sized payload with JSON 超过 2MiB', () => {
    expect(() => validateJson('a'.repeat(MAX_JSON_CHARS + 1))).toThrow('JSON 超过 2MiB');
  });

  it('rejects excessive nesting with JSON 嵌套过深', () => {
    expect(() => validateJson(`${'['.repeat(65)}${']'.repeat(65)}`)).toThrow('JSON 嵌套过深');
  });

  it('braces inside strings do not count towards the depth', () => {
    expect(() => validateJson('{"a":"[[[[[[[[[["}')).not.toThrow();
    expect(() => validateJson('{"a":"\\"[[[["}')).not.toThrow();
  });

  it('escaped quotes keep the string scanner in sync', () => {
    expect(() => validateJson('{"a":"\\"}{"}')).not.toThrow();
  });
});

describe('RuleBudget — boundedText', () => {
  it('passes a normal value through unchanged', () => {
    expect(boundedText('hello')).toBe('hello');
  });

  it('rejects a payload above the 2MiB regex-input ceiling', () => {
    expect(() => boundedText('a'.repeat(MAX_JSON_CHARS + 1))).toThrow('规则输入超过 2MiB');
  });

  it('the deadline is polled once up-front, against Date.now()', () => {
    // Kotlin `text()` returns a Bounded CharSequence whose deadline is polled
    // every 256 char reads; the TS port checks it once at entry, so a negative
    // budget is always fatal and a generous one never is.
    expect(() => boundedText('hello', -1000)).toThrow('书源正则执行超时');
    expect(boundedText('hello', 1000)).toBe('hello');
    expect(boundedText('hello')).toBe('hello');
  });
});

describe('E88 — Kotlin toLongOrNull / toIntOrNull 接受前导正号', () => {
  // Kotlin JsonPathResolver.kt:53 `str.toLongOrNull()` 与 :183 `indexStr.toIntOrNull()`
  // 都接受 '+42' / '+0'；JS 的 /^-?\d+$/ 会拒绝，所以这两处都显式允许 '+'。
  it('getLong 接受前导 +', () => {
    expect(getLong({ n: '+42' }, '$.n')).toBe(42);
    expect(getLong({ n: '+0' }, '$.n')).toBe(0);
    // 负号与无符号仍照常
    expect(getLong({ n: '-7' }, '$.n')).toBe(-7);
    expect(getLong({ n: '42' }, '$.n')).toBe(42);
  });

  it('getLong 仍拒绝非整数（Kotlin toLongOrNull 语义）', () => {
    expect(getLong({ n: '+4.2' }, '$.n')).toBeNull();
    expect(getLong({ n: '4 2' }, '$.n')).toBeNull();
    expect(getLong({ n: '' }, '$.n')).toBeNull();
    expect(getLong({ n: 'abc' }, '$.n')).toBeNull();
  });

  it('数组索引接受前导 +（parseIndex，Kotlin L183）', () => {
    // `resolveArray(jsonStr, path)` 收的是 JSON **字符串**（内部 parseRoot），
    // 且只收集数组里的**对象**元素 —— 所以用对象数组来观察索引是否被正确解析。
    const doc = JSON.stringify({ a: [{ n: 'x' }, { n: 'y' }, { n: 'z' }] });
    expect(resolveArray(doc, '$.a[+1]')).toEqual([{ n: 'y' }]);
    expect(resolveArray(doc, '$.a[+0]')).toEqual([{ n: 'x' }]);
    // 越界 → 空
    expect(resolveArray(doc, '$.a[+9]')).toEqual([]);
    // 非法索引不是 0（Kotlin `?: -1`）
    expect(resolveArray(doc, '$.a[+abc]')).toEqual([]);
    // 负索引同样照常
    expect(resolveArray(doc, '$.a[-1]')).toEqual([]);
  });
});

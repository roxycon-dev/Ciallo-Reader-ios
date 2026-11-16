import { describe, expect, it } from 'vitest';
import {
  getLong,
  getString,
  resolveArray,
  resolveStringArray,
} from '../../src/core/parser/jsonPathResolver';

const jsonStr = JSON.stringify({
  status: 'ok',
  data: {
    books: [
      {
        book_id: 'b001',
        book_name: 'Three-Body Problem',
        meta: { author: 'Cixin Liu' },
        download_link: 'https://example.com/b001.epub',
        chapters: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }],
      },
      {
        book_id: 'b002',
        book_name: 'Ball Lightning',
        meta: { author: 'Cixin Liu' },
        download_link: 'https://example.com/b002.epub',
      },
    ],
    images: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
  },
  meta: {
    images: ['https://cdn.example.com/c.jpg'],
  },
});

describe('jsonPathResolver', () => {
  it('resolves data.books field lookup', () => {
    const books = resolveArray(jsonStr, 'data.books');
    expect(books).toHaveLength(2);
    expect(books[0]?.book_id).toBe('b001');
    const root = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(getString(root, 'data.books[0].book_name')).toBe('Three-Body Problem');
    expect(getString(root, 'data.books[0].meta.author')).toBe('Cixin Liu');
    expect(getString(books[0] as Record<string, unknown>, 'book_id')).toBe('b001');
  });

  it('expands data.books[]', () => {
    const books = resolveArray(jsonStr, 'data.books[]');
    expect(books).toHaveLength(2);
    expect(books.map((b) => b.book_id)).toEqual(['b001', 'b002']);
  });

  it('selects data.books[0]', () => {
    const books = resolveArray(jsonStr, 'data.books[0]');
    expect(books).toHaveLength(1);
    expect(books[0]?.book_id).toBe('b001');
  });

  it('$..images is NOT recursive descent (Kotlin parseSegments quirk)', () => {
    // Kotlin JsonPathResolver.parseSegments: "$..images" → removePrefix("$.")
    // → ".images" → no ".." left to rewrite into "**." → segments ["images"].
    // So "$.." never selects a recursive descent; it degrades to a plain
    // top-level key lookup (here: no "images" key on the root → []).
    // Verified against the compiled Android resolver.
    expect(resolveStringArray(jsonStr, '$..images')).toEqual([]);
    // The actual recursive-descent spelling that works: a bare "**" segment.
    expect(resolveStringArray(jsonStr, '**.images')).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      'https://cdn.example.com/c.jpg',
    ]);
  });

  it('deduplicates resolveStringArray results', () => {
    const images = resolveStringArray(jsonStr, 'data.images');
    expect(images).toEqual(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
  });

  it('returns empty/null for missing paths', () => {
    expect(resolveArray(jsonStr, 'data.missing')).toEqual([]);
    const root = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(getString(root, 'data.missing')).toBeNull();
    expect(getLong(root, 'data.missing')).toBeNull();
    expect(resolveStringArray(jsonStr, 'data.missing')).toEqual([]);
  });

  it('parses long field values via getLong', () => {
    const obj = { count: 42, name: 'x' } as Record<string, unknown>;
    expect(getLong(obj, 'count')).toBe(42);
    expect(getLong(obj, 'name')).toBeNull();
  });

  it('accepts @json: and $. path prefixes', () => {
    const root = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(getString(root, '@json:$.data.books[0].book_id')).toBe('b001');
    expect(getString(root, '$.data.books[0].book_id')).toBe('b001');
  });
});

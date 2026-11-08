import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  ReaderPaginationCache,
  paginateChapter,
  paginateChunk,
  makeDefaultMeasureLines,
  paginationCacheKey,
  shouldCelebrateAfterForwardTurn,
  splitChunks,
  type PaginationParams,
} from '../../src/core/reader/pagination';

const baseParams: PaginationParams = {
  widthPx: 400,
  pageHeightPx: 600,
  firstPageHeightPx: 500,
  fontSizePx: 16,
  lineHeightPx: 24,
  titleReservePx: 100,
};

describe('splitChunks', () => {
  it('returns a single chunk when content fits', () => {
    expect(splitChunks('short', 100)).toEqual(['short']);
    expect(splitChunks('', 100)).toEqual(['']);
  });

  it('prefers newline cuts in the latter half and preserves concat', () => {
    const left = 'a'.repeat(100);
    const right = 'b'.repeat(80);
    const content = `${left}\n${right}`;
    const chunks = splitChunks(content, 150);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe(`${left}\n`);
    expect(chunks.join('')).toBe(content);
  });

  it('hard-cuts when newline sits in the first half of the window', () => {
    const content = `${'a'.repeat(10)}\n${'b'.repeat(200)}`;
    const chunks = splitChunks(content, 100);
    expect(chunks[0]).toBe(content.slice(0, 100));
    expect(chunks.join('')).toBe(content);
  });

  it('concat invariant holds for multi-chunk content', () => {
    const content = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
    const chunks = splitChunks(content, 80);
    expect(chunks.join('')).toBe(content);
  });
});

describe('paginateChapter', () => {
  it('scroll mode returns a single page', () => {
    const content = '第一章正文\n第二行内容';
    expect(paginateChapter(content, baseParams, true)).toEqual([content]);
  });

  it('empty content returns a single empty page', () => {
    expect(paginateChapter('', baseParams, false)).toEqual(['']);
  });

  it('tiny viewport returns content unchanged', () => {
    const content = 'hello world';
    const tiny: PaginationParams = { ...baseParams, widthPx: 10, pageHeightPx: 10 };
    expect(paginateChapter(content, tiny, false)).toEqual([content]);
  });

  it('paginates multi-page chapters and concat matches input', () => {
    const content = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：这是用于分页测试的中文正文内容。`).join('\n');
    const pages = paginateChapter(content, baseParams, false);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(content);
  });

  it('reserves title height on the first page only', () => {
    const content = Array.from({ length: 60 }, (_, i) => `段落 ${i} 填充正文以产生多页`).join('\n');
    const withReserve = paginateChapter(content, { ...baseParams, titleReservePx: 200, firstPageHeightPx: 400 }, false);
    const withoutReserve = paginateChapter(content, { ...baseParams, titleReservePx: 0, firstPageHeightPx: 600 }, false);
    expect(withReserve.length).toBeGreaterThanOrEqual(withoutReserve.length);
    expect(withReserve.join('')).toBe(content);
  });
});

describe('paginateChunk + measureLines', () => {
  it('packs lines into pages by capacity', () => {
    const measure = makeDefaultMeasureLines(baseParams);
    const chunk = Array.from({ length: 30 }, (_, i) => `L${i}`).join('\n');
    const pages = paginateChunk(chunk, baseParams, measure, false);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(chunk);
  });

  it('handles image tokens as height blocks', () => {
    const measure = makeDefaultMeasureLines(baseParams);
    const chunk = `before\n[IMG:/x/pic.png|800|400]\nafter`;
    const pages = paginateChunk(chunk, baseParams, measure, false);
    expect(pages.join('')).toBe(chunk);
    const imagePage = pages.findIndex((p) => p.includes('[IMG:'));
    expect(imagePage).toBeGreaterThanOrEqual(0);
  });
});

describe('ReaderPaginationCache LRU', () => {
  it('stores and retrieves pages', () => {
    const cache = new ReaderPaginationCache();
    cache.put('k', ['p1', 'p2']);
    expect(cache.get('k')).toEqual(['p1', 'p2']);
  });

  it('evicts beyond MAX_ENTRIES and refreshes on get', () => {
    const cache = new ReaderPaginationCache();
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      cache.put(`key-${i}`, [`page-${i}`]);
    }
    // Touch key-0 so key-1 becomes the LRU victim
    expect(cache.get('key-0')).toEqual(['page-0']);
    cache.put('key-new', ['page-new']);

    expect(cache.get('key-1')).toBeUndefined();
    expect(cache.get('key-0')).toEqual(['page-0']);
    expect(cache.get('key-new')).toEqual(['page-new']);

    let remaining = 0;
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      if (cache.get(`key-${i}`) !== undefined) {
        remaining += 1;
      }
    }
    // key-1 evicted; key-0, key-2..7, key-new → still MAX_ENTRIES entries
    expect(remaining + 1).toBeLessThanOrEqual(MAX_ENTRIES);
  });
});

describe('paginationCacheKey', () => {
  it('differs by layout parameters', () => {
    const a = paginationCacheKey('c', 400, 600, 16, 24, 0);
    const b = paginationCacheKey('c', 400, 600, 18, 24, 0);
    const c = paginationCacheKey('c', 400, 600, 16, 24, 0);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});

describe('shouldCelebrateAfterForwardTurn', () => {
  it('rejects when progressive pagination has not covered the chapter', () => {
    const partial = ['第一页'];
    expect(shouldCelebrateAfterForwardTurn(4, 5, 0, partial, 100)).toBe(false);
  });

  it('accepts last chapter on forward turn when pages cover formatted length', () => {
    const complete = ['第一页', '第二页'];
    const length = complete.reduce((sum, p) => sum + p.length, 0);
    expect(shouldCelebrateAfterForwardTurn(4, 5, 0, complete, length)).toBe(true);
  });

  it('rejects non-final chapters', () => {
    const complete = ['第一页', '第二页'];
    const length = complete.reduce((sum, p) => sum + p.length, 0);
    expect(shouldCelebrateAfterForwardTurn(3, 5, 0, complete, length)).toBe(false);
  });

  it('rejects empty pages and zero chapter count', () => {
    expect(shouldCelebrateAfterForwardTurn(0, 0, 0, [], 0)).toBe(false);
    expect(shouldCelebrateAfterForwardTurn(0, 1, 0, [], 0)).toBe(false);
  });

  it('requires pageIndex near the end of the page list', () => {
    const pages = ['a', 'b', 'c'];
    const length = pages.reduce((sum, p) => sum + p.length, 0);
    // pageIndex >= lastIndex - 1 → index 1 and 2 celebrate; index 0 is too early
    expect(shouldCelebrateAfterForwardTurn(0, 1, 1, pages, length)).toBe(true);
    expect(shouldCelebrateAfterForwardTurn(0, 1, 2, pages, length)).toBe(true);
    expect(shouldCelebrateAfterForwardTurn(0, 1, 0, pages, length)).toBe(false);
    const two = ['aa', 'bb'];
    const twoLen = 4;
    expect(shouldCelebrateAfterForwardTurn(0, 1, 0, two, twoLen)).toBe(true);
  });
});

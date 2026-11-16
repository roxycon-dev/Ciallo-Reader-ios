/**
 * Unit tests for the ReaderPagination progressive controller port.
 *
 * Kotlin → TS source map (see `src/core/reader/readerPagination.ts` header for
 * the full table).
 *
 *   ReaderPagination.kt 58-67   PaginationKey                → chapterPaginationKey
 *   ReaderPagination.kt 106-108 passthrough guard            → isSinglePagePassthrough
 *   ReaderPagination.kt 141-150 LayoutParams                 → toPaginationParams
 *   ReaderPagination.kt 337-344 measurePageHeightPx          → makeMeasurePageHeight
 *   ReaderPagination.kt 191-208 paginateChunked              → paginateChunked
 *   ReaderPagination.kt 242-334 paginateChunk（二分回退）      → paginateChunkRefined
 *   ReaderPagination.kt 126-167 rememberChapterPages         → cachedChapterPages / loadChapterPages
 */

import { describe, expect, it } from 'vitest';
import {
  EAGER_CHAPTER_THRESHOLD,
  MIN_PAGE_HEIGHT_PX,
  cachedChapterPages,
  chapterPaginationCache,
  chapterPaginationKey,
  isSinglePagePassthrough,
  isSmallChapter,
  loadChapterPages,
  makeDefaultMeasureLines,
  makeMeasurePageHeight,
  paginateChunked,
  paginateChunkRefined,
  paginationCacheKeyFor,
  toPaginationParams,
  type ChapterPaginationRequest,
  type PaginationParams,
} from '../../src/core/reader/readerPagination';
import { LARGE_CHAPTER_THRESHOLD } from '../../src/core/reader/pagination';

const baseRequest: ChapterPaginationRequest = {
  content: '第一章正文内容。',
  widthPx: 400,
  heightPx: 600,
  fontSizePx: 16,
  lineHeightPx: 24,
  fontFamilyKey: 'sans',
  titleReservePx: 60,
  isScrollMode: false,
};

function makeParams(overrides: Partial<PaginationParams> = {}): PaginationParams {
  return {
    widthPx: 400,
    pageHeightPx: 600,
    firstPageHeightPx: 540,
    fontSizePx: 16,
    lineHeightPx: 24,
    titleReservePx: 60,
    ...overrides,
  };
}

describe('isSinglePagePassthrough (ReaderPagination.kt:106-108)', () => {
  it('passes through in scroll mode', () => {
    expect(isSinglePagePassthrough({ ...baseRequest, isScrollMode: true })).toBe(true);
  });

  it('passes through on empty content', () => {
    expect(isSinglePagePassthrough({ ...baseRequest, content: '' })).toBe(true);
  });

  it('passes through on a degenerate viewport (width <= 20 / height <= 20)', () => {
    expect(isSinglePagePassthrough({ ...baseRequest, widthPx: 20 })).toBe(true);
    expect(isSinglePagePassthrough({ ...baseRequest, widthPx: 19 })).toBe(true);
    expect(isSinglePagePassthrough({ ...baseRequest, heightPx: 20 })).toBe(true);
    expect(isSinglePagePassthrough({ ...baseRequest, heightPx: 21, widthPx: 21 })).toBe(false);
  });
});

describe('toPaginationParams (ReaderPagination.kt:141-150)', () => {
  it('derives firstPageHeightPx with coerceAtLeast(80)', () => {
    expect(toPaginationParams(baseRequest).firstPageHeightPx).toBe(540);
    expect(toPaginationParams({ ...baseRequest, titleReservePx: 580 }).firstPageHeightPx).toBe(80);
  });

  it('keeps the measured width / height', () => {
    const params = toPaginationParams(baseRequest);
    expect(params.widthPx).toBe(400);
    expect(params.pageHeightPx).toBe(600);
    expect(params.fontSizePx).toBe(16);
    expect(params.lineHeightPx).toBe(24);
    expect(params.titleReservePx).toBe(60);
  });
});

describe('chapterPaginationKey (ReaderPagination.kt:58-67)', () => {
  it('is stable for identical inputs', () => {
    expect(chapterPaginationKey({ ...baseRequest, includeFontPadding: false })).toBe(
      chapterPaginationKey({ ...baseRequest, includeFontPadding: false }),
    );
  });

  it('changes with layout-affecting fields', () => {
    const base = chapterPaginationKey({ ...baseRequest, includeFontPadding: false });
    expect(
      chapterPaginationKey({ ...baseRequest, widthPx: 401, includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, heightPx: 601, includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, fontSizePx: 18, includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, lineHeightPx: 30, includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, titleReservePx: 80, includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, fontFamilyKey: 'serif', includeFontPadding: false }),
    ).not.toBe(base);
    expect(
      chapterPaginationKey({ ...baseRequest, includeFontPadding: true }),
    ).not.toBe(base);
  });

  it('paginationCacheKeyFor mirrors chapterPaginationKey for the request shape', () => {
    expect(paginationCacheKeyFor(baseRequest)).toBe(
      chapterPaginationKey({
        content: baseRequest.content,
        widthPx: baseRequest.widthPx,
        heightPx: baseRequest.heightPx,
        fontSizePx: baseRequest.fontSizePx,
        lineHeightPx: baseRequest.lineHeightPx,
        fontFamilyKey: baseRequest.fontFamilyKey,
        includeFontPadding: false,
        titleReservePx: baseRequest.titleReservePx,
      }),
    );
  });
});

describe('makeMeasurePageHeight (ReaderPagination.kt:337-344)', () => {
  it('sums ceil(paragraph height) for text and roundToInt for image blocks', () => {
    const params = makeParams();
    const measure = makeMeasurePageHeight(params, makeDefaultMeasureLines(params));
    const pureText = measure('一行\n两行\n三行');
    expect(pureText).toBe(3 * 24);
    const withImage = measure('[IMG:/x/a.png|800|400]');
    // novelInlineImages.splitIntoBlocks 对图片块给出的 heightPx 即测量值
    expect(withImage).toBeGreaterThan(0);
  });

  it('returns 0 for empty text', () => {
    const params = makeParams();
    const measure = makeMeasurePageHeight(params, makeDefaultMeasureLines(params));
    expect(measure('')).toBe(0);
  });
});

describe('paginateChunked (ReaderPagination.kt:191-208)', () => {
  it('preserves the exact content when concatenating pages', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    const height = makeMeasurePageHeight(params, measure);
    const content = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行：用于分页的中文正文。`).join('\n');
    const pages = paginateChunked(content, params, measure, height, null);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(content);
  });

  it('publishes partial page lists through progressiveSink for multi-chunk content', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    const height = makeMeasurePageHeight(params, measure);
    const line = `${'x'.repeat(500)}\n`;
    const content = line.repeat(400); // > PAGINATION_CHUNK_CHARS → 多块
    const snapshots: number[] = [];
    const pages = paginateChunked(content, params, measure, height, (partial) => {
      snapshots.push(partial.length);
    });
    expect(snapshots.length).toBeGreaterThan(1);
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i]).toBeGreaterThan(snapshots[i - 1] as number);
    }
    expect(snapshots[snapshots.length - 1]).toBe(pages.length);
    expect(pages.join('')).toBe(content);
  });

  it('does not call the sink for single-chunk content', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    const height = makeMeasurePageHeight(params, measure);
    let calls = 0;
    paginateChunked('短内容', params, measure, height, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});

describe('paginateChunkRefined (ReaderPagination.kt:242-334)', () => {
  it('keeps the concat invariant', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    const height = makeMeasurePageHeight(params, measure);
    const chunk = Array.from({ length: 50 }, (_, i) => `行 ${i}`).join('\n');
    const pages = paginateChunkRefined(chunk, params, measure, false, height);
    expect(pages.join('')).toBe(chunk);
  });

  it('splits pages whose measured height exceeds the page budget', () => {
    const params = makeParams({ pageHeightPx: 600, firstPageHeightPx: 600, titleReservePx: 0 });
    const measure = makeDefaultMeasureLines(params);
    // 恒定返回超大高度 → 每次细分都必须压到最小页高才停
    const alwaysTooTall = (): number => 10_000;
    const chunk = Array.from({ length: 80 }, (_, i) => `行 ${i}`).join('\n');
    const pages = paginateChunkRefined(chunk, params, measure, false, alwaysTooTall);
    expect(pages.join('')).toBe(chunk);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeGreaterThan(0);
    }
  });

  it('terminates for pathological input (bounded refinement rounds)', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    const chunk = 'x'.repeat(500);
    const pages = paginateChunkRefined(chunk, params, measure, false, () => Number.MAX_SAFE_INTEGER);
    expect(pages.join('')).toBe(chunk);
    expect(MIN_PAGE_HEIGHT_PX).toBe(80);
  });

  it('returns an empty list for empty chunks', () => {
    const params = makeParams();
    const measure = makeDefaultMeasureLines(params);
    expect(paginateChunkRefined('', params, measure, false, () => 0)).toEqual([]);
  });
});

describe('cachedChapterPages / loadChapterPages (ReaderPagination.kt:126-167)', () => {
  it('publishes the passthrough single page without touching the cache', () => {
    const request = { ...baseRequest, isScrollMode: true };
    expect(cachedChapterPages(request)).toEqual([request.content]);
  });

  it('computes, publishes and caches an eager chapter', async () => {
    const request = {
      ...baseRequest,
      content: Array.from({ length: 40 }, (_, i) => `第 ${i} 行正文`).join('\n'),
    };
    const published: string[][] = [];
    const pages = await loadChapterPages(request, (next) => published.push(next));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.join('')).toBe(request.content);
    expect(published).toHaveLength(1);
    expect(chapterPaginationCache.get(paginationCacheKeyFor(request))).toEqual(pages);
  });

  it('serves the cached pages immediately on the second call', async () => {
    const request = {
      ...baseRequest,
      content: Array.from({ length: 30 }, (_, i) => `缓存 ${i}`).join('\n'),
    };
    const first = await loadChapterPages(request, () => undefined);
    let secondPublishCount = 0;
    const second = await loadChapterPages(request, () => {
      secondPublishCount += 1;
    });
    expect(second).toEqual(first);
    expect(secondPublishCount).toBe(1);
  });

  it('emits progressive partial lists for chapters above EAGER_CHAPTER_THRESHOLD', async () => {
    const request = {
      ...baseRequest,
      // 用 60k+ 字符触发渐进分支（chunk 大小 40k → 2 块）
      content: `${'甲'.repeat(20)}\n`.repeat(3200),
    };
    expect(request.content.length).toBeGreaterThan(EAGER_CHAPTER_THRESHOLD);
    const snapshots: number[] = [];
    const pages = await loadChapterPages(request, (next) => snapshots.push(next.length));
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots[snapshots.length - 1]).toBe(pages.length);
    expect(pages.join('')).toBe(request.content);
  });
});

describe('isSmallChapter (ReaderScreen.kt:1008)', () => {
  it('treats chapters up to LARGE_CHAPTER_THRESHOLD as synchronous-ready', () => {
    expect(isSmallChapter(0)).toBe(true);
    expect(isSmallChapter(LARGE_CHAPTER_THRESHOLD)).toBe(true);
    expect(isSmallChapter(LARGE_CHAPTER_THRESHOLD + 1)).toBe(false);
  });
});
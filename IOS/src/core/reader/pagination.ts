/**
 * Reader pagination — pure port of Android `ReaderPagination` (no Compose).
 *
 * Android source:
 *   ReaderPagination.kt — chunked real-layout pagination, LRU cache, celebrate gate
 *   NovelInlineImages.kt — `[IMG:...]` block splitter shared with measurement
 *
 * Measurement here is DOM-free and injectable so unit tests can run without a
 * layout engine. The default estimator approximates CJK-wide line wrapping.
 */

import { splitIntoBlocks } from './novelInlineImages';

export const MAX_ENTRIES = 8;
export const LARGE_CHAPTER_THRESHOLD = 200_000;
export const PAGINATION_CHUNK_CHARS = 40_000;
export const EAGER_CHAPTER_THRESHOLD = 60_000;

export interface PaginationParams {
  widthPx: number;
  pageHeightPx: number;
  /** heightPx - titleReservePx, min 80 */
  firstPageHeightPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  titleReservePx: number;
}

export type PaginationItem =
  | { kind: 'text'; text: string; heightPx: number }
  | { kind: 'image'; token: string; heightPx: number };

export type MeasureLines = (
  text: string,
) => { lines: string[]; lineHeightPx: number };

/**
 * Splits text into chunks of at most `maxChars`, preferring `'\n'` cuts when the
 * newline falls in the latter half of the window.
 */
export function splitChunks(content: string, maxChars = PAGINATION_CHUNK_CHARS): string[] {
  if (content.length <= maxChars) {
    return [content];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    const end = Math.min(content.length, start + maxChars);
    if (end < content.length) {
      const newline = content.lastIndexOf('\n', end);
      if (newline > start + maxChars / 2) {
        // Keep the newline on this chunk so chunk concat === content.
        chunks.push(content.slice(start, newline + 1));
        start = newline + 1;
        continue;
      }
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

/** CJK-wide approximate wrap: ~0.55 em per character. */
export function charsPerLineFor(widthPx: number, fontSizePx: number): number {
  return Math.max(8, Math.floor(widthPx / (fontSizePx * 0.55)));
}

export function makeDefaultMeasureLines(params: PaginationParams): MeasureLines {
  const charsPerLine = charsPerLineFor(params.widthPx, params.fontSizePx);
  return (text: string) => {
    const lines: string[] = [];
    const parts = text.split('\n');
    for (const part of parts) {
      if (part.length === 0) {
        lines.push('');
      } else if (part.length <= charsPerLine) {
        lines.push(part);
      } else {
        for (let i = 0; i < part.length; i += charsPerLine) {
          lines.push(part.slice(i, i + charsPerLine));
        }
      }
    }
    return { lines, lineHeightPx: params.lineHeightPx };
  };
}

/**
 * Split a text segment into item substrings that concatenate back to `text`.
 * Newlines stay attached to the preceding piece so page concat is lossless.
 */
function splitKeepBreaks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      parts.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    parts.push(text.slice(start));
  }
  return parts;
}

function buildItems(
  chunk: string,
  params: PaginationParams,
  measureLines: MeasureLines,
): PaginationItem[] {
  const items: PaginationItem[] = [];
  const blocks = splitIntoBlocks(chunk, params.widthPx, params.pageHeightPx);
  for (const block of blocks) {
    if (block.kind === 'image') {
      const heightPx = Math.min(Math.max(block.heightPx, 1), Math.max(params.pageHeightPx, 1));
      items.push({ kind: 'image', token: block.raw, heightPx });
    } else if (block.text.length > 0) {
      const parts = splitKeepBreaks(block.text);
      for (const part of parts) {
        const { lines, lineHeightPx } = measureLines(part);
        const visual = lines.filter((line) => line.length > 0).length;
        const heightPx = Math.max(visual, 1) * Math.max(lineHeightPx, 1);
        items.push({ kind: 'text', text: part, heightPx });
      }
    }
  }
  return items;
}

/**
 * Real-layout pagination for one chunk. Packs estimated line/image items into
 * pages; page texts concatenate back to the chunk (no lost or duplicated chars).
 *
 * @param reserveTitle whether the first page of this chunk reserves chapter title space.
 */
export function paginateChunk(
  chunk: string,
  params: PaginationParams,
  measureLines: MeasureLines,
  reserveTitle: boolean,
): string[] {
  if (chunk.length === 0) {
    return [];
  }

  const items = buildItems(chunk, params, measureLines);
  if (items.length === 0) {
    return [chunk];
  }

  const pages: PaginationItem[][] = [];
  let current: PaginationItem[] = [];
  let usedPx = 0;
  let pageIndex = 0;

  const capacityPx = (): number => {
    const height = reserveTitle && pageIndex === 0 ? params.firstPageHeightPx : params.pageHeightPx;
    return Math.max(height, 1);
  };

  for (const item of items) {
    if (current.length > 0 && usedPx + item.heightPx > capacityPx()) {
      pages.push(current);
      current = [];
      usedPx = 0;
      pageIndex += 1;
    }
    current.push(item);
    usedPx += item.heightPx;
  }
  if (current.length > 0) {
    pages.push(current);
  }

  return pages.map((pageItems) =>
    pageItems.map((item) => (item.kind === 'text' ? item.text : item.token)).join(''),
  );
}

/**
 * Paginate a full chapter. Scroll mode, empty content, or a tiny viewport
 * returns the content as a single page.
 */
export function paginateChapter(
  content: string,
  params: PaginationParams,
  isScrollMode: boolean,
): string[] {
  if (
    isScrollMode ||
    content.length === 0 ||
    params.widthPx <= 20 ||
    params.pageHeightPx <= 20
  ) {
    return [content];
  }

  const chunks = splitChunks(content);
  const measureLines = makeDefaultMeasureLines(params);
  const pages: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i] ?? '';
    pages.push(...paginateChunk(chunk, params, measureLines, i === 0));
  }
  return pages;
}

/**
 * Celebration fires only on a user-initiated forward turn onto the final chapter,
 * and only when progressive pagination has covered the whole formatted chapter.
 */
export function shouldCelebrateAfterForwardTurn(
  chapterIndex: number,
  chapterCount: number,
  pageIndex: number,
  pages: string[],
  formattedLength: number,
): boolean {
  if (chapterCount <= 0 || pages.length === 0) {
    return false;
  }
  if (chapterIndex !== chapterCount - 1) {
    return false;
  }
  if (pageIndex < pages.length - 2) {
    return false;
  }
  let sum = 0;
  for (const page of pages) {
    sum += page.length;
  }
  return sum === formattedLength;
}

/** LRU pagination cache, max `MAX_ENTRIES` (LinkedHashMap access-order port). */
export class ReaderPaginationCache {
  private readonly map = new Map<string, string[]>();

  get(key: string): string[] | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  put(key: string, pages: string[]): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, pages);
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }
}

export function paginationCacheKey(
  content: string,
  widthPx: number,
  heightPx: number,
  fontSizePx: number,
  lineHeightPx: number,
  titleReservePx: number,
): string {
  return JSON.stringify([content, widthPx, heightPx, fontSizePx, lineHeightPx, titleReservePx]);
}

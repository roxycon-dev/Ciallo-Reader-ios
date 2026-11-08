/**
 * readerPagination.ts — progressive pagination controller, pure port of
 * Android `ReaderPagination.kt`'s `rememberChapterPages` / `paginateChunked`
 * / `paginateChunk` / `measurePageHeightPx` (lines 40-388).
 *
 * SOURCE MAP (Kotlin → TS)
 *   ReaderPagination.kt 1-28    package / imports                                  → SKIPPED (imports)
 *   ReaderPagination.kt 30-39   KDoc "ANR-free pagination layer"                 → ported as this header
 *   ReaderPagination.kt 40-56   object ReaderPaginationCache (LRU 8, lock)       → REUSED from ./pagination (`ReaderPaginationCache`); module-level singleton below
 *   ReaderPagination.kt 58-67   data class PaginationKey (8 fields)                → `ChapterPaginationRequest` + `chapterPaginationKey`
 *   ReaderPagination.kt 69-73   PAGE_VERTICAL_PADDING_DP / PAGE_TEXT_BOTTOM_PADDING_DP → moved verbatim to ./readerScreenLogic
 *   ReaderPagination.kt 75-83   shouldCelebrateAfterForwardTurn                   → REUSED from ./pagination (re-exported for callers)
 *   ReaderPagination.kt 85-95   TITLE_BLOCK_PADDING_DP / LARGE_CHAPTER_THRESHOLD /
 *                              PAGINATION_CHUNK_CHARS / EAGER_CHAPTER_THRESHOLD   → REUSED from ./pagination (re-exported)
 *   ReaderPagination.kt 97-170  @Composable rememberChapterPages (LaunchedEffect,
 *                              cache hit/miss, eager vs progressive)              → `loadChapterPages` + `cachedChapterPages`
 *   ReaderPagination.kt 172-181 private class LayoutParams                        → `PaginationParams` from ./pagination + `ChapterPaginationRequest`
 *   ReaderPagination.kt 183-208 paginateChunked (progressiveSink per chunk)      → `paginateChunked`
 *   ReaderPagination.kt 210-229 splitChunks                                       → REUSED from ./pagination
 *   ReaderPagination.kt 231-334 paginateChunk (atomic item seq, 标题预留, 二分回退)  → `paginateChunkRefined` (builds on ./pagination `paginateChunk`)
 *   ReaderPagination.kt 336-344 measurePageHeightPx (ceil / roundToInt)          → `makeMeasurePageHeight`
 *   ReaderPagination.kt 346-388 buildParagraph (Paragraph + Placeholder sp/px)   → SKIPPED: Compose `Paragraph` has no DOM-free equivalent; replaced by the
 *                                injectable `MeasureLines` estimator already in ./pagination
 *
 * ADAPTATIONS
 *   - `rememberChapterPages` is a `@Composable`: React cannot return "a value that
 *     recomputes lazily", so the cache lookup + measurement are split into
 *     `cachedChapterPages` (synchronous, render-safe) and
 *     `loadChapterPages` (async, progressive, called from an effect).
 *   - `withContext(Dispatchers.Default)` → the work is synchronous and chunked;
 *     the progressive sink publishes after each chunk so the UI thread stays free.
 *   - `Paragraph`/`ParagraphIntrinsics` (ParagraphIntrinsics + Placeholder) →
 *     injected `MeasureLines` port; the image-token heights still come from
 *     `novelInlineImages.splitIntoBlocks`, so pagination and rendering agree.
 *   - The Kotlin `fits(end)` binary search over real `Paragraph` measurement is
 *     preserved as a *bounded halving refinement* over `paginateChunk` output
 *     (`paginateChunkRefined`) instead of a re-implemented packer.
 */

import { splitIntoBlocks } from './novelInlineImages';
import {
  EAGER_CHAPTER_THRESHOLD,
  LARGE_CHAPTER_THRESHOLD,
  PAGINATION_CHUNK_CHARS,
  ReaderPaginationCache,
  makeDefaultMeasureLines,
  paginateChunk,
  paginationCacheKey,
  splitChunks,
  type MeasureLines,
  type PaginationParams,
} from './pagination';

export {
  EAGER_CHAPTER_THRESHOLD,
  LARGE_CHAPTER_THRESHOLD,
  MAX_ENTRIES,
  PAGINATION_CHUNK_CHARS,
  ReaderPaginationCache,
  makeDefaultMeasureLines,
  paginateChapter,
  paginationCacheKey,
  shouldCelebrateAfterForwardTurn,
  splitChunks,
} from './pagination';
export type { MeasureLines, PaginationParams } from './pagination';

/**
 * ReaderPagination.kt:58-67 `PaginationKey`
 * Kotlin carries `fontFamily` + `includeFontPadding` as part of the key; on web
 * both collapse into the CSS font stack (`readingFontFamilyCss`) which is folded
 * into `fontFamilyKey` below so a font switch still invalidates the cache.
 */
export interface PaginationKeyInput {
  content: string;
  widthPx: number;
  heightPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  /** Kotlin `fontFamily` — the resolved CSS font stack. */
  fontFamilyKey: string;
  /** Kotlin `includeFontPadding` — always `false` in ReaderScreen.kt:122. */
  includeFontPadding: boolean;
  titleReservePx: number;
}

/** ReaderPagination.kt:58-67 + pagination.ts `paginationCacheKey`. */
export function chapterPaginationKey(input: PaginationKeyInput): string {
  return paginationCacheKey(
    input.content,
    input.widthPx,
    input.heightPx,
    input.fontSizePx,
    input.lineHeightPx,
    input.titleReservePx,
  ) + `|${input.fontFamilyKey}|${input.includeFontPadding ? 1 : 0}`;
}

/** ReaderPagination.kt:97-105 `rememberChapterPages` 的入参. */
export interface ChapterPaginationRequest {
  content: string;
  widthPx: number;
  heightPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  fontFamilyKey: string;
  titleReservePx: number;
  isScrollMode: boolean;
}

/**
 * ReaderPagination.kt:106-108 — `if (isScrollMode || content.isEmpty() || widthPx <= 20 ||
 * heightPx <= 20) return listOf(content)`.
 */
export function isSinglePagePassthrough(request: ChapterPaginationRequest): boolean {
  return (
    request.isScrollMode ||
    request.content.length === 0 ||
    request.widthPx <= 20 ||
    request.heightPx <= 20
  );
}

/** ReaderPagination.kt:141-150 `LayoutParams`. */
export function toPaginationParams(request: ChapterPaginationRequest): PaginationParams {
  return {
    widthPx: request.widthPx,
    pageHeightPx: request.heightPx,
    firstPageHeightPx: Math.max(request.heightPx - request.titleReservePx, 80),
    fontSizePx: Math.max(request.fontSizePx, 8),
    lineHeightPx: request.lineHeightPx,
    titleReservePx: request.titleReservePx,
  };
}

/** ReaderPagination.kt:337-344 `measurePageHeightPx` 的注入式替身. */
export type PageHeightMeasure = (text: string) => number;

/**
 * ADAPTATION of `measurePageHeightPx`（`ceil(paragraph.height)` / `roundToInt(image)`）：
 * 逐块累加 `ceil(行数 × 行高)`，图片块取 `roundToInt(heightPx)`，与 Kotlin 同构。
 */
export function makeMeasurePageHeight(
  params: PaginationParams,
  measureLines: MeasureLines,
): PageHeightMeasure {
  return (text: string): number => {
    const blocks = splitIntoBlocks(text, params.widthPx, params.pageHeightPx);
    let total = 0;
    for (const block of blocks) {
      if (block.kind === 'image') {
        total += Math.round(block.heightPx);
        continue;
      }
      const { lines, lineHeightPx } = measureLines(block.text);
      total += Math.ceil(lines.length * Math.max(lineHeightPx, 1));
    }
    return total;
  };
}

/** 二次细分时的最小页高，防止预算无限逼近 0（Kotlin 的 `coerceAtLeast(80)`）. */
export const MIN_PAGE_HEIGHT_PX = 80;

/** 最多细分轮数（Kotlin 的二分回退天然有界；这里给出显式上界以免病态输入死循环）。 */
export const MAX_REFINE_ROUNDS = 32;

/**
 * ReaderPagination.kt:242-334 `paginateChunk`
 * 先用 ./pagination 的 `paginateChunk` 排好页，再用注入的整页测量
 * （Kotlin 的 `fits(end)` 二分回退等价物）把超高页按一半预算重排。
 * 不变量：`pages.join('') === chunk`。
 */
export function paginateChunkRefined(
  chunk: string,
  params: PaginationParams,
  measureLines: MeasureLines,
  reserveTitle: boolean,
  measurePageHeightPx: PageHeightMeasure,
): string[] {
  if (chunk.length === 0) return [];

  const budget = reserveTitle ? params.firstPageHeightPx : params.pageHeightPx;
  const out: string[] = [];

  // 深度优先、保持原顺序的细分：把超高页按一半预算重排后再逐页递归，
  // 保证 `out.join('') === chunk`（不丢字、不乱序）。
  const pushPage = (page: string, pageBudget: number, depth: number): void => {
    if (depth >= MAX_REFINE_ROUNDS || pageBudget <= MIN_PAGE_HEIGHT_PX) {
      out.push(page);
      return;
    }
    if (measurePageHeightPx(page) <= pageBudget) {
      out.push(page);
      return;
    }
    const halfBudget = Math.max(Math.floor(pageBudget / 2), MIN_PAGE_HEIGHT_PX);
    const halved: PaginationParams = {
      ...params,
      pageHeightPx: halfBudget,
      firstPageHeightPx: Math.max(halfBudget - params.titleReservePx, MIN_PAGE_HEIGHT_PX),
    };
    const sub = paginateChunk(page, halved, measureLines, false);
    if (sub.length <= 1) {
      // 单项已超过可用高度：仍保留该项，确保不丢字且分页能继续（Kotlin:318-323 同策略）。
      out.push(page);
      return;
    }
    for (const part of sub) pushPage(part, halfBudget, depth + 1);
  };

  const measured = paginateChunk(chunk, params, measureLines, reserveTitle);
  for (const page of measured) pushPage(page, budget, 0);
  return out;
}

/** ReaderPagination.kt:191-208 `paginateChunked` — 逐块分页并在每块后回调. */
export function paginateChunked(
  content: string,
  params: PaginationParams,
  measureLines: MeasureLines,
  measurePageHeightPx: PageHeightMeasure,
  progressiveSink: ((pages: ReadonlyArray<string>) => void) | null,
): string[] {
  const chunks = splitChunks(content, PAGINATION_CHUNK_CHARS);
  if (chunks.length <= 1) {
    return paginateChunkRefined(chunks[0] ?? '', params, measureLines, true, measurePageHeightPx);
  }

  const allPages: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? '';
    const produced = paginateChunkRefined(
      chunk,
      params,
      measureLines,
      index === 0,
      measurePageHeightPx,
    );
    for (const page of produced) allPages.push(page);
    if (progressiveSink !== null) progressiveSink([...allPages]);
  }
  return allPages;
}

// ─────────────────────────────────────────────────────────────────────────────
// rememberChapterPages
// ─────────────────────────────────────────────────────────────────────────────

/** ReaderPagination.kt:40-56 的模块级 LRU（`LinkedHashMap(16, 0.75f, true)`, MAX 8）. */
export const chapterPaginationCache = new ReaderPaginationCache();

export function paginationCacheKeyFor(request: ChapterPaginationRequest): string {
  return chapterPaginationKey({
    content: request.content,
    widthPx: request.widthPx,
    heightPx: request.heightPx,
    fontSizePx: request.fontSizePx,
    lineHeightPx: request.lineHeightPx,
    fontFamilyKey: request.fontFamilyKey,
    includeFontPadding: false,
    titleReservePx: request.titleReservePx,
  });
}

/** ReaderPagination.kt:126-131 — 组合期同步读缓存（命中即渲染，未命中为空页）. */
export function cachedChapterPages(request: ChapterPaginationRequest): string[] {
  if (isSinglePagePassthrough(request)) return [request.content];
  return chapterPaginationCache.get(paginationCacheKeyFor(request)) ?? [];
}

/**
 * ReaderPagination.kt:133-167 `rememberChapterPages` 的 `LaunchedEffect` 体。
 *
 * - 缓存命中 → 立即返回（ReaderPagination.kt:135-139）
 * - `content.length <= EAGER_CHAPTER_THRESHOLD` → 一次算完再发布（:152-157）
 * - 超大章节 → 每块算完就 `progressiveSink` 增量发布（:158-166）
 */
export async function loadChapterPages(
  request: ChapterPaginationRequest,
  onPages: (pages: string[]) => void,
  /**
   * E6：行测量器注入点。
   *
   * 默认用 `makeDefaultMeasureLines`（按 0.55em 估算的**固定字数**硬切），
   * 与 Kotlin 的 `android.text.Paragraph` 真实测量不一致。宿主（UI 层）可传入
   * `createCanvasMeasureLines()` —— 用 canvas `measureText` + `Intl.Segmenter`
   * + CJK 禁则做真实断行，见 `platform/web/webTextLayout.ts`。
   *
   * 放在可选参数末尾，保持既有调用点不变。
   */
  measureLinesOverride?: MeasureLines,
): Promise<string[]> {
  if (isSinglePagePassthrough(request)) {
    onPages([request.content]);
    return [request.content];
  }

  const key = paginationCacheKeyFor(request);
  const cached = chapterPaginationCache.get(key);
  if (cached !== undefined) {
    onPages(cached);
    return cached;
  }

  const params = toPaginationParams(request);
  const measureLines = measureLinesOverride ?? makeDefaultMeasureLines(params);
  const measurePageHeightPx = makeMeasurePageHeight(params, measureLines);

  if (request.content.length <= EAGER_CHAPTER_THRESHOLD) {
    // ReaderPagination.kt:152-157 — eager：一次算完再发布
    const computed = paginateChunked(
      request.content,
      params,
      measureLines,
      measurePageHeightPx,
      null,
    );
    chapterPaginationCache.put(key, computed);
    onPages(computed);
    return computed;
  }

  // ReaderPagination.kt:158-166 — progressive：每块结束即发布已算出的页
  const full = paginateChunked(
    request.content,
    params,
    measureLines,
    measurePageHeightPx,
    (partial) => onPages([...partial]),
  );
  chapterPaginationCache.put(key, full);
  onPages(full);
  return full;
}

/** ReaderScreen.kt:1008 使用 LARGE_CHAPTER_THRESHOLD 判定「小章同步准备」. */
export function isSmallChapter(contentLength: number): boolean {
  return contentLength <= LARGE_CHAPTER_THRESHOLD;
}
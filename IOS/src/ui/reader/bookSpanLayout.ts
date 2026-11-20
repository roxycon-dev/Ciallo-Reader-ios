/**
 * `ui/reader/BookSpanLayout.kt`（59 行）→ `src/ui/reader/bookSpanLayout.ts`。
 *
 * 把 `chapters.formatting` 里存的 span 列表变成「可直接上色的范围」。
 * 两个容易踩的点：
 *
 * 1. **`layoutBookSpans` 只在开了段首缩进时重算坐标**（`if (!indent || spans.isEmpty()) return spans`）
 *    —— 没缩进的章节保持原样，避免无谓的整表重建。
 * 2. **span 两端用不同的 `includeIndent`**：起点含缩进、终点不含 —— 否则高亮会
 *    把下一段的两个全角空格也吃掉。
 * 3. **`bookSpanStyle` 里 `Heading` 走 `1.18em`、`Super`/`Sub` 走 `.75em`**，
 *    且 `Quote` 复用斜体（`Italic || Quote`）、`Code`/`Table` 复用等宽。
 *    `BaselineShift` 与 `fontSize` 是两套独立机制：上标既要缩字号也要抬基线。
 */
import {
  BookTextStyle,
  decodeBookSpans,
  spansIn,
  type BookTextSpan,
} from '@core/data/formattedBookText';
import type { Chapter } from '@core/data/chapterMerger';
import { ReaderTextCoordinates } from './readerTextCoordinates';

/**
 * L18-26 `layoutBookSpans(chapter, indent)`。
 *
 * 从 `chapter.formatting` 解码；开缩进时把每个 span 的两端换算成显示偏移。
 */
export function layoutBookSpans(chapter: Chapter | null | undefined, indent: boolean): BookTextSpan[] {
  const spans = decodeBookSpans(chapter?.formatting);
  const text = chapter?.content ?? '';
  if (!indent || spans.length === 0) return spans;
  const coordinates = new ReaderTextCoordinates(text, indent);
  return spans.map((span) => ({
    start: coordinates.display(span.start),
    end: coordinates.display(span.end, false),
    style: span.style,
  }));
}

/** 一条可上色的范围（对应 `AnnotatedString.Range<SpanStyle>`）。 */
export interface BookSpanRange {
  readonly start: number;
  readonly end: number;
  readonly style: number;
}

/**
 * L28-31 `bookSpanRanges(spans, offset, length)`。
 *
 * 先按 `offset .. offset+length` 取交叠的 span，再裁到块内；`start >= end` 的丢弃。
 */
export function bookSpanRanges(spans: readonly BookTextSpan[], offset: number, length: number): BookSpanRange[] {
  const out: BookSpanRange[] = [];
  for (const span of spansIn(spans, offset, offset + length)) {
    const start = Math.max(span.start - offset, 0);
    const end = Math.min(span.end - offset, length);
    if (start < end) out.push({ start, end, style: span.style });
  }
  return out;
}

/** L33-35 `AnnotatedString.Builder.addBookSpans(spans, offset, length)` —— 返回同样的区间给 UI。 */
export function addBookSpans(spans: readonly BookTextSpan[], offset: number, length: number): BookSpanRange[] {
  return bookSpanRanges(spans, offset, length);
}

/** `SpanStyle` 的可序列化投影（Web 侧由 CSS / canvas 消费）。 */
export interface BookSpanStyle {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly monospace: boolean;
  /** `1.18` = 标题；`0.75` = 上下标；`1` = 正常。 */
  readonly fontScale: number;
  readonly baselineShift: 'super' | 'sub' | null;
  readonly underline: boolean;
  readonly strikeThrough: boolean;
}

/**
 * L37-59 `bookSpanStyle(flags)`。
 *
 * 位标志 → 样式投影。`Heading` 只放大字号、**不**加粗（粗体由 `Bold` 位单独给，
 * 但 `tagFlags` 里 `h1..h6` 返回 `Heading or Bold`，所以标题默认两者都有）。
 */
export function bookSpanStyle(flags: number): BookSpanStyle {
  const has = (flag: number): boolean => (flags & flag) !== 0;
  return {
    bold: has(BookTextStyle.Bold),
    italic: has(BookTextStyle.Italic) || has(BookTextStyle.Quote),
    monospace: has(BookTextStyle.Code) || has(BookTextStyle.Table),
    fontScale: has(BookTextStyle.Heading) ? 1.18 : has(BookTextStyle.Super) || has(BookTextStyle.Sub) ? 0.75 : 1,
    baselineShift: has(BookTextStyle.Super) ? 'super' : has(BookTextStyle.Sub) ? 'sub' : null,
    underline: has(BookTextStyle.Underline),
    strikeThrough: has(BookTextStyle.Strike),
  };
}

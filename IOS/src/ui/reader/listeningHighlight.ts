/**
 * `ui/reader/ListeningHighlight.kt`（17 行）→ `src/ui/reader/listeningHighlight.ts`。
 *
 * 朗读高亮：把「当前段的原文区间」换算成「块内区间」再上背景色。
 * 两处 `coerce`:起点不小于块起点、终点不超过块长 —— 段落跨越分块边界时
 * 只画可见的那一半，而不是整段不画。
 */
import type { SpokenParagraph } from '@core/data/listeningChapter';

/** 一段高亮的块内区间；`null` 表示该段在本块内没有可见部分。 */
export interface ListeningHighlightRange {
  readonly start: number;
  readonly end: number;
}

/**
 * L8-17 `AnnotatedString.Builder.addListeningHighlight(paragraph, blockStart, blockLength, color)`。
 *
 * Kotlin 直接 `addStyle`；这里返回区间，由 UI 层（canvas / span）决定怎么画颜色 ——
 * 「画什么颜色」不改变区间计算，所以颜色不进这个函数。
 */
export function addListeningHighlight(
  paragraph: SpokenParagraph,
  blockStart: number,
  blockLength: number,
): ListeningHighlightRange | null {
  const start = Math.max(paragraph.start - blockStart, 0);
  const end = Math.min(paragraph.end - blockStart, blockLength);
  return start < end ? { start, end } : null;
}

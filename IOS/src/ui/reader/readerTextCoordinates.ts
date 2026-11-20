/**
 * `ui/reader/ReaderTextCoordinates.kt`（63 行）→ `src/ui/reader/readerTextCoordinates.ts`。
 *
 * 「原文偏移 ↔ 显示偏移」的换算。开启段首缩进后，显示文本比原文多出若干个
 * `\u3000\u3000`（每段两个全角空格），于是所有 highlight / mark 的偏移都要跟着挪。
 *
 * 三处只有读原文才会注意到的细节：
 *
 * 1. **`insertions` 存的是「每个被缩进行的起始偏移」**，而 `display()` 里用
 *    `binarySearch(raw)`：命中（正好落在某段开头）时 `shift = match + (含缩进 ? 1 : 0)`
 *    —— 命中且要求含缩进时，该段**自己**的缩进也要算进去；未命中时
 *    `shift = -match - 1` = 插入点之前有多少段。
 * 2. **每段缩进固定 2 个字符**（`shift * 2`），与 `\u3000\u3000` 的长度绑定；
 *    改成 `"  "` 时数值不变，但改成 1 个或 4 个字符就全错。
 * 3. **`raw(display)` 是反向二分**：找第一个满足 `insertions[mid] + mid * 2 >= display`
 *    的下标，再 `maxOf(insertions[last], display - low * 2)` —— 落在缩进内部时
 *    返回该段起点（缩进不映射到任何原文位置）。
 */
import type { BookTextSpan } from '@core/data/formattedBookText';

/** L9 `internal class ReaderTextCoordinates(text, indent)`。 */
export class ReaderTextCoordinates {
  /** L10-16 每个被缩进行的**原文**起始偏移（升序）。 */
  private readonly insertions: number[];

  constructor(text: string, indent: boolean) {
    const insertions: number[] = [];
    if (indent) {
      let start = 0;
      for (const line of text.split('\n')) {
        if (line.trim() !== '' && !line.startsWith('\u3000\u3000')) insertions.push(start);
        start += line.length + 1;
      }
    }
    this.insertions = insertions;
  }

  /** 被缩进的段落数（调试与测试用）。 */
  get indentCount(): number {
    return this.insertions.length;
  }

  /** L18-22 `display(raw, includeIndent = true)`。 */
  display(raw: number, includeIndent = true): number {
    const match = binarySearch(this.insertions, raw);
    const shift = match >= 0 ? match + (includeIndent ? 1 : 0) : -match - 1;
    return raw + shift * 2;
  }

  /** L24-34 `raw(display)` —— 落在缩进里时回落到该段起点。 */
  raw(display: number): number {
    let low = 0;
    let high = this.insertions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.insertions[mid] as number) + mid * 2 < display) low = mid + 1;
      else high = mid;
    }
    const last = low - 1;
    if (last < 0) return display;
    return Math.max(this.insertions[last] as number, display - low * 2);
  }

  /** 原文 → 显示时，span 两端要用不同的 `includeIndent`（起点含、终点不含）。 */
  displaySpan(span: BookTextSpan): BookTextSpan {
    return {
      start: this.display(span.start),
      end: this.display(span.end, false),
      style: span.style,
    };
  }
}

/** Kotlin `List<Int>.binarySearch` —— 命中返回下标，否则 `-(插入点) - 1`。 */
function binarySearch(items: readonly number[], key: number): number {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = items[mid] as number;
    if (value < key) low = mid + 1;
    else if (value > key) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/** L7 `data class ReaderMark(start, end, underline, color)` —— `color` 是 `0xAARRGGBB`。 */
export interface ReaderMark {
  readonly start: number;
  readonly end: number;
  readonly underline: boolean;
  readonly color: number;
}

/** 高亮实体里 `toReaderMark` 需要的字段（对应 `Highlight` 的那几个列）。 */
export interface HighlightLike {
  readonly selectedText: string;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly colorHex: string;
  readonly markStyle: string;
}

/** L49 的兜底色 `Color(0xff71ccba)`。 */
export const DEFAULT_MARK_COLOR = 0xff71ccba;

/**
 * L37-52 `Highlight.toReaderMark(content, coordinates)`。
 *
 * 定位顺序：
 * 1. 有 `startOffset/endOffset`、区间合法、且 `content[start, end] == selectedText`
 *    → 直接用（最快，且能区分重复文本）；
 * 2. 否则在 `content` 里找 `selectedText`：**必须唯一**，出现两次以上返回 `null`
 *    （宁可不画，也不画错位置）；
 * 3. 颜色解析失败回落 `0xff71ccba`（`runCatching` + `getOrDefault`）。
 */
export function toReaderMark(
  highlight: HighlightLike,
  content: string,
  coordinates: ReaderTextCoordinates,
): ReaderMark | null {
  if (highlight.selectedText.trim() === '') return null;
  const start = highlight.startOffset;
  const end = highlight.endOffset;

  let range: readonly [number, number];
  if (
    start !== null &&
    end !== null &&
    start >= 0 &&
    end >= start + 1 &&
    end <= content.length &&
    content.slice(start, end) === highlight.selectedText
  ) {
    range = [start, end];
  } else {
    const found = content.indexOf(highlight.selectedText);
    if (found < 0) return null;
    if (content.indexOf(highlight.selectedText, found + 1) >= 0) return null;
    range = [found, found + highlight.selectedText.length];
  }

  const color = parseColorHex(highlight.colorHex) ?? DEFAULT_MARK_COLOR;
  return {
    start: coordinates.display(range[0]),
    end: coordinates.display(range[1], false),
    underline: highlight.markStyle === 'underline',
    color,
  };
}

/** L54-63 `AnnotatedString.Builder.addReaderMarks(marks, offset, length)`。 */
export interface MarkRange {
  readonly start: number;
  readonly end: number;
  readonly underline: boolean;
  readonly color: number;
}

export function addReaderMarks(
  marks: readonly ReaderMark[],
  offset: number,
  length: number,
): MarkRange[] {
  const out: MarkRange[] = [];
  for (const mark of marks) {
    const start = Math.max(mark.start - offset, 0);
    const end = Math.min(mark.end - offset, length);
    if (start >= end) continue;
    out.push({ start, end, underline: mark.underline, color: mark.color });
  }
  return out;
}

/** `android.graphics.Color.parseColor` 的子集：`#RGB` / `#RRGGBB` / `#AARRGGBB`。 */
export function parseColorHex(value: string): number | null {
  const text = value.trim();
  if (!/^#[0-9a-fA-F]+$/.test(text)) return null;
  const hex = text.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] as string, 16);
    const g = Number.parseInt(hex[1] as string, 16);
    const b = Number.parseInt(hex[2] as string, 16);
    return (0xff000000 | (r * 17 << 16) | (g * 17 << 8) | (b * 17)) >>> 0;
  }
  if (hex.length === 6) return (0xff000000 | Number.parseInt(hex, 16)) >>> 0;
  if (hex.length === 8) return Number.parseInt(hex, 16) >>> 0;
  return null;
}

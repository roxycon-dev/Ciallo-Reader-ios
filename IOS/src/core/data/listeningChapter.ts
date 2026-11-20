/**
 * `data/ListeningChapter.kt`（42 行）→ `src/core/data/listeningChapter.ts`。
 *
 * 听书的数据模型与「正文 → 可朗读段落」的切分规则。三处要点：
 *
 * 1. **`spokenParagraphs` 保留每段的原文偏移**（`line.range.first` /
 *    `last + 1`）—— 朗读高亮要靠它把「第 N 段」映射回正文区间；只存文本会让
 *    高亮错位。
 * 2. **`[IMG:…]` 在朗读时被剔除**（`inlineImage.replace(line.value, "")`），
 *    但偏移仍按**原始行**计算 —— 否则图片后面的段落全会前移。
 * 3. **`paragraphAt` 用 `binarySearchBy(offset) { it.start }`**：命中返回下标，
 *    未命中返回 `-index - 2`（前一段），并 `coerceAtLeast(0)` —— 正文开头之前
 *    的偏移落在第 0 段。
 */

/** L3 `data class SpokenParagraph(text, start, end)` —— 去掉图片后的可朗读文本 + 原文区间。 */
export interface SpokenParagraph {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** L5-11 `data class ListeningChapter`。 */
export interface ListeningChapter {
  readonly bookKey: string;
  readonly chapterKey: string;
  readonly bookTitle: string;
  readonly title: string;
  readonly paragraphs: readonly SpokenParagraph[];
}

/** L13-23 `data class ListeningState` —— 九个字段，默认值与 Kotlin 一致。 */
export interface ListeningState {
  readonly chapter: ListeningChapter | null;
  readonly paragraph: number;
  readonly playing: boolean;
  readonly preparing: boolean;
  readonly engineReady: boolean;
  readonly error: string | null;
  readonly completion: number;
  readonly finished: boolean;
  readonly timer: number;
}

/** L13-23 的默认构造（Kotlin 的具名默认参数）。 */
export function createListeningState(overrides: Partial<ListeningState> = {}): ListeningState {
  return {
    chapter: null,
    paragraph: 0,
    playing: false,
    preparing: false,
    engineReady: false,
    error: null,
    completion: 0,
    finished: false,
    timer: 0,
    ...overrides,
  };
}

/** L25 `Regex("\\[IMG:[^\\]]*]")` —— 朗读时剔除的内联图片标记。 */
export const LISTENING_INLINE_IMAGE = /\[IMG:[^\]]*\]/g;
/** L26 `Regex("[^\\r\\n]+")` —— 一行就是一段。 */
export const LISTENING_PARAGRAPH_LINE = /[^\r\n]+/g;

/**
 * L28-32 `spokenParagraphs(content)`。
 *
 * 逐行取非空行；行内的 `[IMG:…]` 剥掉后再 `trim()`，**空串整段丢弃**（纯图片的
 * 段落不朗读）。`end` 用 `range.last + 1`（Kotlin 的半开区间）。
 */
export function spokenParagraphs(content: string): SpokenParagraph[] {
  const out: SpokenParagraph[] = [];
  LISTENING_PARAGRAPH_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LISTENING_PARAGRAPH_LINE.exec(content)) !== null) {
    const line = match[0];
    const speech = line.replace(LISTENING_INLINE_IMAGE, '').trim();
    if (speech !== '') {
      out.push({ text: speech, start: match.index, end: match.index + line.length });
    }
  }
  return out;
}

/**
 * L34-37 `List<SpokenParagraph>.paragraphAt(offset)`。
 *
 * `binarySearchBy` 命中 → 该段；未命中 → `(-index - 2).coerceAtLeast(0)`，
 * 即「插入点的前一段」。
 */
export function paragraphAt(paragraphs: readonly SpokenParagraph[], offset: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const start = (paragraphs[mid] as SpokenParagraph).start;
    if (start < offset) low = mid + 1;
    else if (start > offset) high = mid - 1;
    else {
      found = mid;
      break;
    }
  }
  if (found >= 0) return found;
  return Math.max(-(low + 1) - 1, 0);
}

/** L39-42 `formatNovelReadingText(text, indent)` —— 段首两个全角空格，已有的不重复加。 */
export function formatNovelReadingText(text: string, indent: boolean): string {
  if (!indent) return text;
  return text
    .split('\n')
    .map((line) => (line.trim() !== '' && !line.startsWith('\u3000\u3000') ? `\u3000\u3000${line}` : line))
    .join('\n');
}

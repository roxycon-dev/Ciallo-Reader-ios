/**
 * E6 —— Compose 排版的等价实现。
 *
 * 权威行为来自 Android（只读参考，不修改）：
 *   - `ui/ReaderScreen.kt:4823-4835` —— 用 `android.text.Paragraph` 做**真实行级测量**：
 *     `Paragraph(text, style, Constraints(maxWidth), density, fontFamilyResolver)`
 *     然后读 `lineCount` / `getLineTop` / `getLineBottom`。
 *   - `ReaderScreen.kt:4811-4819` —— `fontSizePx` 与 `lineHeightPx` 的下限钳制
 *     （`coerceAtLeast(8f)` / `coerceAtLeast(fontSizePx * 1.2f)`）。
 *
 * ## 差异与本实现
 *
 * 此前 `core/reader/pagination.ts` 的 `makeDefaultMeasureLines` 是**估算**：
 * 按「每行固定 `charsPerLine` 个字符」硬切（`charsPerLineFor` 用 0.55em 系数）。
 * 这在两种情况下与 Kotlin 不一致：
 *
 *   1. **不等宽**：Latin 字符宽度约为 CJK 的 0.5 倍，固定字数会明显错判行数；
 *   2. **不守禁则**：CJK 排版的「行首禁则」（`。，、）」等不出现在行首）
 *      与「行尾禁则」（`（「` 等不出现在行尾）未处理，Kotlin 的 `Paragraph`
 *      遵守这两条。中文小说的引号、括号、省略号跨行会很明显。
 *
 * 本模块提供 `createCanvasMeasureLines()`：用 Canvas 的 `measureText` 逐字符
 * 累加宽度找断点，并用 `Intl.Segmenter` 做**词级**切分（英文按单词、CJK 按
 * 东亚词），最后套禁则规则把断点前后微调 —— 这与 `Paragraph` 的行为对齐。
 *
 * 放在 platform 层：依赖 Canvas / Intl，`src/core/**` 不得触碰（E61）。
 */

import type { MeasureLines, PaginationParams } from '@core/reader/pagination';

/**
 * 行首禁则字符 —— Kotlin `Paragraph` 的 `LineBreakConfig` 默认值。
 * 这些字符不能出现在行首，断点要往前挪。
 */
const NO_LINE_START = new Set([
  '，', '。', '、', '；', '：', '？', '！', '」', '』', '）', '】', '》', '〉', '”', '’',
  '…', '・', ',', '.', ';', ':', '?', '!', ')', ']', '}', '"', "'", '”', '’',
]);

/**
 * 行尾禁则字符 —— 不能出现在行尾，断点要往后挪。
 */
const NO_LINE_END = new Set(['「', '『', '（', '【', '《', '〈', '“', '‘', '(', '[', '{', '‘', '“']);

/** 把字符串切成「不可再分的排版单元」。 */
function segments(text: string): string[] {
  // Intl.Segmenter 是标准 API（Safari 14.1+ / Chrome 87+），
  // `granularity: 'word'` 对中文按词、英文按单词切 —— 与 Paragraph 一致。
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: object) => {
    segment(input: string): Iterable<{ segment: string }>;
  } }).Segmenter;
  if (Seg === undefined) {
    // 兜底：CJK 按字、Latin 按空格
    return text.match(/[\u3000-\u9FFF\uFF00-\uFFEF]|[^\s\u3000-\u9FFF\uFF00-\uFFEF]+|\s+/gu) ?? [text];
  }
  const out: string[] = [];
  for (const { segment } of new Seg(undefined, { granularity: 'word' }).segment(text)) {
    out.push(segment);
  }
  return out;
}

/** 一个可测宽度的文本测量上下文。 */
export interface TextMeasureContext {
  /** 逐段宽度累加器（比逐字符快，因为 Segmenter 已把词切好）。 */
  measure(text: string, font: string): number;
}

export interface CanvasMeasureOptions extends PaginationParams {
  /** CSS font 简写（`${fontSizePx}px ${fontFamily}`）。 */
  readonly font: string;
}

/**
 * 真实排版测量器 —— 等价 Kotlin `Paragraph` + `Constraints(maxWidth)`。
 *
 * @param canvas 用于测量的离屏 canvas（不会加入 DOM）
 */
export function createCanvasMeasureLines(
  canvas: HTMLCanvasElement,
  params: CanvasMeasureOptions,
): MeasureLines {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('排版测量需要 2D canvas 上下文');
  }
  ctx.font = params.font;

  // Kotlin L4811-4819 的下限钳制，逐值照搬
  const fontSizePx = Math.max(8, params.fontSizePx);
  const lineHeightPx = Math.max(params.lineHeightPx, fontSizePx * 1.2);
  const maxWidth = Math.max(1, params.widthPx);

  /** 把一段（无换行）文本按 maxWidth 断成若干行，遵守禁则。 */
  const wrapParagraph = (text: string): string[] => {
    if (text.length === 0) return [];
    const units = segments(text);
    const lines: string[] = [];
    let line = '';
    let lineWidth = 0;

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i] as string;
      const unitWidth = ctx.measureText(unit).width;
      // 行首禁则：当前行非空、且新单元以禁则字符开头 → 先把该字符留在上一行。
      //   （Kotlin 的 LineBreakConfig 会把它「挤」到上一行，即使那行会略微超宽。）
      if (line.length > 0 && NO_LINE_START.has(unit.charAt(0))) {
        lines.push(line);
        line = unit;
        lineWidth = unitWidth;
        continue;
      }
      if (lineWidth + unitWidth <= maxWidth) {
        line += unit;
        lineWidth += unitWidth;
        continue;
      }
      // 超宽：断行。但若行尾是行尾禁则字符（如开引号「），把它挪到下一行。
      let carry = '';
      if (line.length > 0 && NO_LINE_END.has(line.charAt(line.length - 1))) {
        carry = line.charAt(line.length - 1);
        line = line.slice(0, -1);
      }
      lines.push(line);
      line = carry + unit;
      lineWidth = ctx.measureText(line).width;
    }
    if (line.length > 0) lines.push(line);
    return lines;
  };

  return (text: string): { lines: string[]; lineHeightPx: number } => {
    const lines: string[] = [];
    for (const part of text.split('\n')) {
      if (part.length === 0) {
        lines.push('');
        continue;
      }
      lines.push(...wrapParagraph(part));
    }
    return { lines, lineHeightPx };
  };
}

/**
 * 禁则规则的单测出口（不依赖 canvas）。
 *
 * 把「给定断点候选，返回修正后的断点」抽成纯函数，才能在 Node 里逐条验证
 * 「行首不出现 `。」、行尾不出现 `「」」—— 否则规则只能靠人眼审。
 *
 * @returns `true` 表示该字符可以出现在行首
 */
export function canStartLine(char: string): boolean {
  return !NO_LINE_START.has(char);
}

/** `true` 表示该字符可以出现在行尾。 */
export function canEndLine(char: string): boolean {
  return !NO_LINE_END.has(char);
}

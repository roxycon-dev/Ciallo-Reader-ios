/**
 * Inline novel images — pure port of Android `NovelInlineImages.kt` (lines 41-288).
 *
 * EPUB import writes `[IMG:path|width|height]` placeholders into chapter text.
 * Pagination and rendering share this block splitter so measured height matches
 * the height a page actually occupies.
 *
 * KOTLIN → TS MAP
 *   NovelInlineImages.kt 43   `TOKEN_REGEX`                       → `TOKEN_REGEX`
 *   NovelInlineImages.kt 45   `hasImages(text)`                   → `hasImages`
 *   NovelInlineImages.kt 53-54 `normalizeTokenBreaks(text)`       → `normalizeTokenBreaks`
 *   NovelInlineImages.kt 57   `stripTokens(text)`                 → `stripTokens`
 *   NovelInlineImages.kt 231-247 `sealed class InlineBlock`       → `InlineBlock`
 *                                                                     (Image 变体带 path/token→raw /
 *                                                                      widthPx / heightPx，逐字段对齐)
 *   NovelInlineImages.kt 254-274 `splitIntoBlocks(...)`           → `splitIntoBlocks`
 *   NovelInlineImages.kt 276-287 `displaySize(...)`               → `displaySize`
 *   NovelInlineImages.kt 65-156 `NovelImageCache`（Bitmap 采样 / prewarm）
 *                                                                  → SKIPPED：浏览器 `<img>` 解码，
 *                                                                    由 ReaderPage 的
 *                                                                    `InlineImageDecoder` 端口承担
 *   NovelInlineImages.kt 167-224 `ImageHitRegistry`               → core/reader/readerScreenLogic
 *   NovelInlineImages.kt 294-331 `NovelInlineImage` composable    → ReaderPage.tsx `InlineImage`
 *   NovelInlineImages.kt 339-406 `buildAnnotatedWithImages`       → SKIPPED：块驱动渲染取代
 *                                                                    AnnotatedString + InlineTextContent
 *                                                                    （见 ReaderPage.tsx 文件头）
 *
 * ADAPTATION（唯一一处）
 *   Kotlin `splitIntoBlocks("")` 返回 `listOf(InlineBlock.Text(""))` —— 一个**空**文本块。
 *   TS 返回 `[]`：web 侧没有 `Paragraph`，`measurePageHeightPx("")` 的等价物必须真的返回 0，
 *   若保留空块，`makeMeasurePageHeight` 会把空串当成 1 行 × 行高累加出一个假高度。
 *   两个版本在「空输入 → 高度 0」这一可观察结果上完全一致。
 */

/** NovelInlineImages.kt:43 — `Regex("""\[IMG:([^|\]]+)\|(\d+)\|(\d+)]""")`. */
export const TOKEN_REGEX = /\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g;

export type InlineBlock =
  | { kind: 'text'; text: string }
  | {
      kind: 'image';
      /** Kotlin `InlineBlock.Image.path` = `m.groupValues[1]`. */
      path: string;
      /** Kotlin `InlineBlock.Image.token`，亦即 `override val raw`. */
      raw: string;
      /** Kotlin `InlineBlock.Image.widthPx`（`displaySize` 的 dw）。 */
      widthPx: number;
      /** Kotlin `InlineBlock.Image.heightPx`（`displaySize` 的 dh，已按 maxHeightPx 收敛）。 */
      heightPx: number;
    };

export function hasImages(text: string): boolean {
  return text.includes('[IMG:');
}

/** Adjacent tokens force a line break (`"][IMG:"` → `"]\n[IMG:"`). */
export function normalizeTokenBreaks(text: string): string {
  return hasImages(text) ? text.replace('][IMG:', ']\n[IMG:') : text;
}

/** Strip all image placeholders (TTS / word count consumers). */
export function stripTokens(text: string): string {
  return text.replace(new RegExp(TOKEN_REGEX.source, 'g'), '');
}

/**
 * NovelInlineImages.kt:276-287 `displaySize`
 * 按长宽比换算显示尺寸；竖版长图等比缩小，保证一页放得下。
 */
export function displaySize(
  w: number,
  h: number,
  contentWidthPx: number,
  maxHeightPx: number,
): { width: number; height: number } {
  const iw = Math.max(w, 1);
  const ih = Math.max(h, 1);
  let dw = contentWidthPx;
  let dh = (dw * ih) / iw;
  // 竖版长图等比缩小，保证一页放得下
  if (dh > maxHeightPx) {
    dh = maxHeightPx;
    dw = (dh * iw) / ih;
  }
  return { width: dw, height: dh };
}

/**
 * NovelInlineImages.kt:254-274 `splitIntoBlocks`
 * 把含 [IMG:...] 占位符的正文切成 文本/图片 块序列，块 raw 顺序拼接 == 输入。
 * maxHeightPx 传页高（翻页）或 Float.MAX_VALUE（滚动长图）。
 */
export function splitIntoBlocks(
  text: string,
  contentWidthPx: number,
  maxHeightPx: number,
): InlineBlock[] {
  if (!hasImages(text)) {
    return text.length === 0 ? [] : [{ kind: 'text', text }];
  }

  const blocks: InlineBlock[] = [];
  const regex = new RegExp(TOKEN_REGEX.source, 'g');
  let cursor = 0;
  let match = regex.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      blocks.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    const w = Number.parseInt(match[2] ?? '', 10);
    const h = Number.parseInt(match[3] ?? '', 10);
    const size = displaySize(
      Number.isFinite(w) ? Math.max(w, 1) : 1,
      Number.isFinite(h) ? Math.max(h, 1) : 1,
      contentWidthPx,
      maxHeightPx,
    );
    blocks.push({
      kind: 'image',
      path: match[1] ?? '',
      raw: match[0],
      widthPx: size.width,
      heightPx: size.height,
    });
    cursor = match.index + match[0].length;
    match = regex.exec(text);
  }
  if (cursor < text.length) {
    blocks.push({ kind: 'text', text: text.slice(cursor) });
  }
  return blocks;
}
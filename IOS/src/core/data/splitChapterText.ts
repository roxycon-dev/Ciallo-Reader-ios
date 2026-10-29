/**
 * Chapter text splitting — port of Android `ImportSafety.kt` (splitChapterText).
 * Keeps UTF-16 surrogate pairs and inline `[IMG:...]` references intact.
 */

export const MAX_CHAPTER_LENGTH = 30_000;

export function splitChapterText(text: string, limit = MAX_CHAPTER_LENGTH): string[] {
  if (!Number.isInteger(limit) || limit < 2) {
    throw new Error('章节长度上限必须 >= 2');
  }
  if (text === '') return [];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const prev = text.charCodeAt(end - 1);
      const next = text.charCodeAt(end);
      const highSurrogate = prev >= 0xd800 && prev <= 0xdbff;
      const lowSurrogate = next >= 0xdc00 && next <= 0xdfff;
      if (highSurrogate && lowSurrogate) {
        end -= 1;
      }
      const tokenStart = text.lastIndexOf('[IMG:', end - 1);
      if (tokenStart >= start) {
        const close = text.indexOf(']', tokenStart);
        if (close >= end) {
          if (!(tokenStart > start)) {
            throw new Error('内嵌图片引用超过章节长度上限');
          }
          end = tokenStart;
        }
      }
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

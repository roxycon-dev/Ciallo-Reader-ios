/**
 * Novel full-text search locator — port of Android `SearchLocator.kt`.
 *
 * MainViewModel (result counts) and ReaderScreen (jump targeting) share this
 * implementation so "the Nth occurrence" is identical on both sides.
 *
 * Design: no character-offset cross-chapter conversion (ChapterMerger's
 * physical→logical offset table is based on empty-content metadata and is not
 * trusted). Everything counts case-insensitive occurrences on the joined text.
 *
 * AUDIT FIX (line-by-line review): `indexOfIgnoreCase` used to lowercase both
 * operands before `indexOf`. `toLowerCase()` is not length-preserving, so the
 * returned index addressed the *lowered* copy instead of the raw text and could
 * be off by one (or more) for characters such as `İ` (U+0130). Because
 * `visibleText()` deliberately preserves raw length so these offsets can be fed
 * straight to the reader as character offsets, that broke a core invariant.
 * Matching is now done per code unit against the raw string (see `foldCodeUnit`).
 *
 * `SearchResultItem` is ported from Android `Book.kt` (not part of this file's
 * source, but required by `buildResults`).
 */

import { hasImages } from '@core/reader/novelInlineImages';

/** From Android `Book.kt` SearchResultItem. */
export interface SearchResultItem {
  chapterIndex: number;
  chapterTitle: string;
  snippet: string;
  /** 关键词是合并后逻辑章正文中的第几处出现（0 起）。 */
  occurrence: number;
}

/** Minimal chapter shape used by buildResults (structural subset of Room Chapter). */
export interface SearchableChapter {
  chapterOrder: number;
  title: string;
  content: string;
}

/**
 * Same length as raw text: reader jumps retain character offsets, but never
 * count image paths. Port of NovelInlineImages.TOKEN_REGEX.replace { spaces }.
 */
const TOKEN_REGEX = /\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g;

function visibleText(text: string): string {
  if (!hasImages(text)) return text;
  return text.replace(TOKEN_REGEX, (m: string) => ' '.repeat(m.length));
}

export const SearchLocator = {
  MAX_RESULTS: 1000,

  /** 忽略大小写的出现次数。 */
  countOccurrences(text: string, query: string): number {
    if (query.trim() === '') return 0;
    let count = 0;
    const visible = visibleText(text);
    let at = indexOfIgnoreCase(visible, query, 0);
    while (at >= 0) {
      count += 1;
      at = indexOfIgnoreCase(visible, query, at + query.length);
    }
    return count;
  },

  /**
   * 合并后文本中关键词第 occurrence 处（0 起）的位置；不存在返回 -1。
   */
  nthOccurrence(text: string, query: string, occurrence: number): number {
    if (query.trim() === '' || occurrence < 0) return -1;
    const visible = visibleText(text);
    let at = indexOfIgnoreCase(visible, query, 0);
    let i = 0;
    while (at >= 0) {
      if (i === occurrence) return at;
      i += 1;
      at = indexOfIgnoreCase(visible, query, at + query.length);
    }
    return -1;
  },

  /**
   * 搜索预览：剔除图片占位符、压平换行，关键词位于预览中心。
   * content 内 pos 处的匹配 → 干净预览；pos 传 -1 时在剔除后的文本里重新定位。
   */
  buildSnippet(content: string, query: string, pos: number): string {
    const plain = visibleText(content);
    let at: number;
    if (
      pos >= 0 &&
      pos + query.length <= plain.length &&
      regionMatches(plain, pos, query, 0, query.length, true)
    ) {
      at = pos;
    } else {
      at = indexOfIgnoreCase(plain, query, 0);
    }
    if (at < 0) return '...';
    const start = Math.max(at - 15, 0);
    const end = Math.min(at + query.length + 25, plain.length);
    return `...${plain.slice(start, end).replace(/\s+/g, ' ')}...`;
  },

  /**
   * 由 LIKE 命中的物理章列表构建搜索结果行：每章只出一条，
   * occurrence = 同逻辑章内、按物理章顺序之前各章出现次数之和 + 本章内第几处。
   */
  buildResults(
    matchedChapters: SearchableChapter[],
    query: string,
    logicalIndexOf: (chapterOrder: number) => number,
    logicalTitleOf: (logicalIndex: number) => string | null,
  ): SearchResultItem[] {
    if (query.trim() === '') return [];
    const results: SearchResultItem[] = [];
    const beforeCounts = new Map<number, number>();
    const sorted = [...matchedChapters].sort((a, b) => a.chapterOrder - b.chapterOrder);
    for (const chapter of sorted) {
      const logicalIndex = logicalIndexOf(chapter.chapterOrder);
      const plain = visibleText(chapter.content);
      let at = indexOfIgnoreCase(plain, query, 0);
      let occurrence = beforeCounts.get(logicalIndex) ?? 0;
      while (at >= 0) {
        const start = Math.max(at - 15, 0);
        const end = Math.min(at + query.length + 25, plain.length);
        const snippet = `...${plain.slice(start, end).replace(/\s+/g, ' ')}...`;
        results.push({
          chapterIndex: logicalIndex,
          chapterTitle: logicalTitleOf(logicalIndex) ?? chapter.title,
          snippet,
          occurrence: occurrence,
        });
        occurrence += 1;
        if (results.length >= SearchLocator.MAX_RESULTS) return results;
        at = indexOfIgnoreCase(plain, query, at + query.length);
      }
      beforeCounts.set(logicalIndex, occurrence);
    }
    return results;
  },
};

/**
 * Single-code-unit case folding used by both helpers below.
 *
 * AUDIT FIX (this file): the previous `indexOfIgnoreCase` was
 * `text.toLowerCase().indexOf(query.toLowerCase(), fromIndex)`. That is wrong for
 * this file because **every offset it returns indexes the lower-cased string, not
 * the raw text**, and `String.prototype.toLowerCase()` is not length-preserving:
 *
 *     'İstanbul test'.length            === 13
 *     'İstanbul test'.toLowerCase()     === 'i̇stanbul test'  (14 code units)
 *     text.indexOf('anahtar')           === 14   ← Kotlin: offset into RAW text
 *     lowered.indexOf('anahtar')        === 15   ← the old TS helper: WRONG offset
 *
 * `visibleText()` deliberately keeps the raw text's length intact (it pads image
 * tokens with spaces) precisely so that `nthOccurrence` / `buildSnippet` offsets
 * can be handed straight to the reader as character offsets. Lower-casing first
 * silently breaks that invariant, so a chapter containing `İ` (or any character
 * whose lower-case form is longer) would jump the reader to the wrong character.
 *
 * Folding is done **per code unit** so the returned index is always an index into
 * `text`. Characters whose case mapping is not a 1:1 BMP mapping (e.g. `ß` → `SS`)
 * are left unfolded rather than expanded, because expanding them would reintroduce
 * the length change we are fixing.
 */
function foldCodeUnit(code: number): number {
  // ASCII fast path.
  if (code >= 0x41 && code <= 0x5a) return code + 0x20;
  if (code < 0x80) return code;
  const upper = String.fromCharCode(code).toUpperCase();
  if (upper.length === 1) return upper.charCodeAt(0);
  const lower = String.fromCharCode(code).toLowerCase();
  return lower.length === 1 ? lower.charCodeAt(0) : code;
}

/**
 * `String.indexOf(query, fromIndex, ignoreCase = true)` parity.
 *
 * Scans `text` directly (never a case-folded copy) so the returned index always
 * addresses the original string, matching Kotlin's behaviour.
 */
function indexOfIgnoreCase(text: string, query: string, fromIndex: number): number {
  const len = query.length;
  if (len === 0) return fromIndex <= text.length ? Math.max(fromIndex, 0) : -1;
  const first = foldCodeUnit(query.charCodeAt(0));
  const start = fromIndex > 0 ? fromIndex : 0;
  const limit = text.length - len;
  for (let i = start; i <= limit; i += 1) {
    if (foldCodeUnit(text.charCodeAt(i)) !== first) continue;
    if (regionMatches(text, i, query, 0, len, true)) return i;
  }
  return -1;
}

/** `String.regionMatches(ignoreCase=true)` parity (per-code-unit folding). */
function regionMatches(
  text: string,
  toffset: number,
  other: string,
  ooffset: number,
  len: number,
  ignoreCase: boolean,
): boolean {
  if (toffset < 0 || ooffset < 0 || toffset + len > text.length || ooffset + len > other.length) {
    return false;
  }
  for (let i = 0; i < len; i += 1) {
    const a = text.charCodeAt(toffset + i);
    const b = other.charCodeAt(ooffset + i);
    if (a === b) continue;
    if (ignoreCase && foldCodeUnit(a) === foldCodeUnit(b)) continue;
    return false;
  }
  return true;
}

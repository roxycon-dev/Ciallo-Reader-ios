/**
 * Android source: `com.example.source.js.JsChapterOrder.kt` (131 lines, 118 non-blank)
 * Ported: 118 / 118 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `java.math.BigDecimal` → a canonical decimal *string* (`normalizeDecimal` +
 *   `compareDecimal`), reusing the convention already established by
 *   `@core/library/comicReadingLogic` (`stripTrailingZeros().toPlainString()`), so
 *   `12`, `12.0` and `12.00` compare equal exactly like `BigDecimal.compareTo`.
 *   A float would be wrong: `toBigDecimalOrNull` rejects values a float would
 *   silently round, and `1.10` vs `1.1` must compare equal.
 * - `java.text.Normalizer.normalize(raw.take(512), Form.NFKC)` →
 *   `clean()`: `String.prototype.normalize('NFKC')` (an ECMAScript built-in, not a
 *   DOM global, so `src/core/**` may use it — same call as
 *   `@core/data/titleNormalizer`), applied *after* the 512-code-unit slice so the
 *   truncation happens before normalization, exactly like `take(512)`.
 * - `MutableList<ComicChapter>` block accumulation → plain arrays with `push`.
 * - `groups.mapValues { }` / `mapValues` iterates entries in map order, which the
 *   `LinkedHashMap` returned by `groupBy` preserves; JS `Map` preserves insertion
 *   order, and we rebuild groups with an explicit `Map`, so ordering matches.
 * - `asReversed().flatten()` → `blocks.reverse().flat()` on a fresh copy.
 * - `mapIndexed { index, chapter -> chapter.copy(order = index.toFloat()) }` →
 *   `map((chapter, index) => ({ ...chapter, order: index }))`. `copy` maps to the
 *   object spread; `index.toFloat()` is exact for the realistic catalogue sizes.
 * - `chapters.any { it.order != 0f }` default argument → the `hasExplicitOrder`
 *   parameter with the same default, so call sites that omit it behave identically.
 */

import type { ComicChapter } from '../comicChapter';

/**
 * Canonical decimal string — reproduces `BigDecimal.stripTrailingZeros().toPlainString()`.
 * Same implementation and rationale as `normalizeDecimal` in `@core/library/comicReadingLogic`.
 */
function normalizeDecimal(value: string): string {
  let s = value;
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (s.length > 1 && s.startsWith('0') && !s.includes('.')) {
    // BigDecimal("000").toPlainString() === "0"
    s = s.replace(/^0+(?=\d)/, '');
  }
  return s;
}

/** Kotlin `String.toBigDecimalOrNull()`: null for anything that is not a plain decimal literal. */
function parseDecimal(token: string): string | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return null;
  return normalizeDecimal(token);
}

/** Kotlin `BigDecimal.compareTo` — numeric, scale-insensitive. */
function compareDecimal(a: string, b: string): number {
  const left = normalizeDecimal(a);
  const right = normalizeDecimal(b);
  if (left === right) return 0;
  return Number(left) < Number(right) ? -1 : 1;
}

/** Kotlin `private const val numeral`. */
const NUMERAL = '[0-9零〇一二两兩三四五六七八九十百千]+(?:\\.[0-9]+)?';
/** Kotlin `private val episode`. */
const EPISODE = new RegExp(`^(?:第\\s*)?(${NUMERAL})\\s*[话話章回]`);
/** Kotlin `private val englishEpisode`. */
const ENGLISH_EPISODE = new RegExp(
  '^(?:chapter|ch\\.?|episode|ep\\.?)\\s*([0-9]+(?:\\.[0-9]+)?)(?=$|\\s|[:：.(\uff08-])',
  'i',
);
/** Kotlin `private val bareEpisode`. */
const BARE_EPISODE = /^([0-9]+(?:\.[0-9]+)?)(?=$|\s|[:：])/;
/** Kotlin `private val volume`. */
const VOLUME = new RegExp(`^(?:(?:\u5355\u884c\u672c|\u55ae\u884c\u672c)\\s*)?(?:\u7b2c\\s*)?(${NUMERAL})\\s*[\u5377\u5dfb\u518c\u518a]$`);
/** Kotlin `private val englishVolume`. */
const ENGLISH_VOLUME = /^(?:vol(?:ume)?\.?|book)\s*([0-9]+)$/i;
/** Kotlin `private val special`. */
const SPECIAL = /\u756a\u5916|\u7279\u5225|\u7279\u5225|\u9644\u5f55|\u9644\u9304|extra|special|omake/i;

export const JsChapterOrder = {
  /**
   * Kotlin `fun normalize(chapters, sourceKey, hasExplicitOrder = chapters.any { it.order != 0f })`.
   * Converts a JS catalogue to reading order once, before caching or handing it to consumers.
   */
  normalize(
    chapters: readonly ComicChapter[],
    sourceKey: string,
    hasExplicitOrder: boolean = chapters.some((chapter) => chapter.order !== 0),
  ): ComicChapter[] {
    if (chapters.length === 0) return chapters as ComicChapter[];
    // Metadata really supplied by the source takes priority over numbers in its titles.
    if (
      hasExplicitOrder &&
      chapters.every((chapter) => Number.isFinite(chapter.order)) &&
      new Set(chapters.map((chapter) => chapter.order)).size > 1
    ) {
      return chapters
        .slice()
        .sort((a, b) => a.order - b.order);
    }

    const defaultDescending = sourceKey.replace(/^js_/, '').toLowerCase() === 'manhuaren';
    // Kotlin `fun groupKey(chapter) = chapter.volume?.trim()?.ifBlank { null }`.
    const groupKey = (chapter: ComicChapter): string | null => {
      if (chapter.volume === null || chapter.volume === undefined) return null;
      const trimmed = chapter.volume.trim();
      return trimmed !== '' ? trimmed : null;
    };
    // Kotlin `chapters.groupBy(::groupKey)` — a `LinkedHashMap`, so key order is
    // first-appearance order. `Map` gives the same guarantee.
    const groups = new Map<string | null, ComicChapter[]>();
    for (const chapter of chapters) {
      const key = groupKey(chapter);
      const bucket = groups.get(key);
      if (bucket === undefined) groups.set(key, [chapter]);
      else bucket.push(chapter);
    }
    const sequences = new Map<string | null, ComicChapter[]>();
    for (const [key, group] of groups) {
      const isDescending = JsChapterOrder.descending(group);
      sequences.set(
        key,
        (isDescending ?? defaultDescending) ? JsChapterOrder.reverseBlocks(group) : group,
      );
    }

    // Only explicitly numbered, contiguous volumes may change their group order.
    // Named groups (serial/collected edition/extras) keep the source's layout.
    const groupKeys = Array.from(groups.keys());
    const numberedVolumes = groupKeys.map((name) =>
      name === null ? null : JsChapterOrder.volumeNumber(name),
    );
    let transitions = 0;
    for (let i = 0; i + 1 < chapters.length; i += 1) {
      if (groupKey(chapters[i] as ComicChapter) !== groupKey(chapters[i + 1] as ComicChapter)) {
        transitions += 1;
      }
    }
    const contiguous = transitions + 1 === groups.size;
    const allNumbered =
      numberedVolumes.length > 0 && numberedVolumes.every((value) => value !== null);
    const distinctVolumes = new Set(
      numberedVolumes.filter((value): value is string => value !== null),
    ).size;
    const sequence =
      groups.size > 1 && contiguous && allNumbered && distinctVolumes === groups.size
        ? groupKeys
            .slice()
            .sort((a, b) => {
              const left = JsChapterOrder.volumeNumber(a as string);
              const right = JsChapterOrder.volumeNumber(b as string);
              // Both are non-null on this branch (guarded by `allNumbered`).
              return compareDecimal(left as string, right as string);
            })
            .flatMap((key) => sequences.get(key) as ComicChapter[])
        : // Retain even interleaved group slots instead of gathering unrelated editions together.
          (() => {
            const iterators = new Map<string | null, number>();
            for (const key of groups.keys()) iterators.set(key, 0);
            return chapters.map((chapter) => {
              const key = groupKey(chapter);
              const cursor = iterators.get(key) ?? 0;
              const bucket = sequences.get(key) as ComicChapter[];
              const picked = bucket[cursor] as ComicChapter;
              iterators.set(key, cursor + 1);
              return picked;
            });
          })();
    return sequence.map((chapter, index) => ({ ...chapter, order: index }));
  },

  /** Kotlin `private fun descending(chapters): Boolean?`. */
  descending(chapters: readonly ComicChapter[]): boolean | null {
    const numbers: string[] = [];
    for (const chapter of chapters) {
      const value = JsChapterOrder.episodeNumber(chapter.title);
      if (value !== null) numbers.push(value);
    }
    let ascending = 0;
    let descending = 0;
    for (let i = 0; i + 1 < numbers.length; i += 1) {
      const a = numbers[i] as string;
      const b = numbers[i + 1] as string;
      const cmp = compareDecimal(a, b);
      if (cmp < 0) ascending += 1;
      else if (cmp > 0) descending += 1;
    }
    const comparisons = ascending + descending;
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    if (comparisons === 0 || first === undefined || last === undefined) return null;
    if (compareDecimal(first, last) === 0) return null;
    // Require a consistent trend across the catalogue, not merely its first and last rows.
    if (descending / comparisons >= 0.8 && compareDecimal(first, last) > 0) return true;
    if (ascending / comparisons >= 0.8 && compareDecimal(first, last) < 0) return false;
    return null;
  },

  /** Kotlin `private fun reverseBlocks(chapters)` — reverse episode blocks without swapping upper/lower parts of the same episode. */
  reverseBlocks(chapters: readonly ComicChapter[]): ComicChapter[] {
    const blocks: ComicChapter[][] = [];
    let previous: string | null = null;
    for (const chapter of chapters) {
      const number = JsChapterOrder.episodeNumber(chapter.title);
      const prior = previous;
      if (number !== null && prior !== null && compareDecimal(number, prior) === 0) {
        (blocks[blocks.length - 1] as ComicChapter[]).push(chapter);
      } else {
        blocks.push([chapter]);
      }
      previous = number;
    }
    return blocks.reverse().flat();
  },

  /** Kotlin `private fun clean(raw)` — NFKC of the first 512 chars, trimmed. */
  clean(raw: string): string {
    // Kotlin `take(512)` counts UTF-16 code units, so slice by code unit to match.
    return raw.slice(0, 512).normalize('NFKC').trim();
  },

  /** Kotlin `private fun episodeNumber(raw): BigDecimal?`. */
  episodeNumber(raw: string): string | null {
    const title = JsChapterOrder.clean(raw);
    if (SPECIAL.test(title)) return null;
    const token =
      EPISODE.exec(title)?.[1] ??
      ENGLISH_EPISODE.exec(title)?.[1] ??
      VOLUME.exec(title)?.[1] ??
      ENGLISH_VOLUME.exec(title)?.[1] ??
      BARE_EPISODE.exec(title)?.[1];
    return token === undefined ? null : JsChapterOrder.number(token);
  },

  /** Kotlin `private fun volumeNumber(raw): BigDecimal?`. */
  volumeNumber(raw: string): string | null {
    const title = JsChapterOrder.clean(raw);
    const token = VOLUME.exec(title)?.[1] ?? ENGLISH_VOLUME.exec(title)?.[1];
    return token === undefined ? null : JsChapterOrder.number(token);
  },

  /** Kotlin `private fun number(token): BigDecimal?`. */
  number(token: string): string | null {
    if (token.length > 16) return null;
    const direct = parseDecimal(token);
    if (direct !== null) return direct;
    /** Kotlin local `fun digit(char): Int?`. */
    const digits = '\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d';
    const digit = (char: string): number | null => {
      if (char === '\u3007') return 0;
      if (char === '\u4e24' || char === '\u5169') return 2;
      const index = digits.indexOf(char);
      return index >= 0 ? index : null;
    };
    if (Array.from(token).every((char) => digit(char) !== null)) {
      // Kotlin `token.map { digit(it) }.joinToString("")` drops a null digit, but the
      // guard above already proved every digit is non-null.
      const joined = Array.from(token)
        .map((char) => String(digit(char) as number))
        .join('');
      return parseDecimal(joined);
    }
    let total = 0;
    let current = 0;
    for (const char of Array.from(token)) {
      const value = digit(char);
      if (value !== null) {
        current = value;
      } else {
        let unit: number;
        if (char === '\u5341') unit = 10;
        else if (char === '\u767e') unit = 100;
        else if (char === '\u5343') unit = 1000;
        else return null;
        total += (current === 0 ? 1 : current) * unit;
        current = 0;
      }
    }
    return parseDecimal(String(total + current));
  },
};
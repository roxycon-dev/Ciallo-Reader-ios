/**
 * Natural order string compare — port of Android `ComicParser.naturalOrderCompare`.
 *
 * Android source:
 *   novel-reader/app/src/main/java/com/example/data/ComicParser.kt
 *
 * Numeric runs compare without overflow, regex allocation, or integer parsing.
 *
 * Pure logic. Fixtures: parity/fixtures/naturalOrder.generated.json
 */

/**
 * Kotlin `Char.lowercaseChar()` — Java `Character.toLowerCase(int)`, i.e. the
 * Unicode *simple* lowercase mapping (SpecialCasing full mappings are not used:
 * 'İ' (U+0130) maps to 'i' (U+0069), matching `Character.toLowerCase`).
 * Cached because the comparator runs per code point inside a sort.
 */
const LOWER_CACHE = new Map<number, number>();

function lowerCode(code: number): number {
  const cached = LOWER_CACHE.get(code);
  if (cached !== undefined) return cached;
  // Lone surrogates (D800-DFFF) have no mapping — String.fromCodePoint still
  // yields the surrogate back, mirroring Character.toLowerCase on a raw Char.
  const lowered = String.fromCodePoint(code).toLowerCase();
  // The only multi-code-point lowercase mapping in SpecialCasing is U+0130;
  // Kotlin takes the first char, so take codePointAt(0).
  const next = lowered.codePointAt(0) ?? code;
  LOWER_CACHE.set(code, next);
  return next;
}

export function naturalOrderCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ac = a.charCodeAt(i);
    const bc = b.charCodeAt(j);
    const aDigit = ac >= 0x30 && ac <= 0x39;
    const bDigit = bc >= 0x30 && bc <= 0x39;
    if (aDigit && bDigit) {
      const aStart = i;
      const bStart = j;
      while (i < a.length) {
        const c = a.charCodeAt(i);
        if (c < 0x30 || c > 0x39) break;
        i += 1;
      }
      while (j < b.length) {
        const c = b.charCodeAt(j);
        if (c < 0x30 || c > 0x39) break;
        j += 1;
      }
      let ai = aStart;
      let bj = bStart;
      while (ai < i && a.charCodeAt(ai) === 0x30) ai += 1;
      while (bj < j && b.charCodeAt(bj) === 0x30) bj += 1;
      const lengthOrder = Math.sign(i - ai - (j - bj));
      if (lengthOrder !== 0) return lengthOrder;
      while (ai < i) {
        const digitOrder = Math.sign(a.charCodeAt(ai) - b.charCodeAt(bj));
        ai += 1;
        bj += 1;
        if (digitOrder !== 0) return digitOrder;
      }
    } else {
      const order = Math.sign(lowerCode(ac) - lowerCode(bc));
      i += 1;
      j += 1;
      if (order !== 0) return order;
    }
  }
  const remain = Math.sign(a.length - i - (b.length - j));
  if (remain !== 0) return remain;
  // Kotlin String.compareTo — UTF-16 code unit order (case-sensitive)
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Stable natural-order sort (returns a new list). */
export function naturalSort(items: string[]): string[] {
  return [...items].sort((a, b) => naturalOrderCompare(a, b));
}

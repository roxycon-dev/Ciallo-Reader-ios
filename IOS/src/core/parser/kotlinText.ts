/**
 * Kotlin/Java regex whitespace primitive.
 *
 * Java's `\s` is `[ \t\n\x0B\f\r]` — ASCII only. Kotlin's `Regex(String)` compiles
 * with the JVM default `Pattern` flags (no UNICODE_CHARACTER_CLASS), so `\s` stays
 * ASCII there too.
 *
 * JS `\s` is far wider: it also matches NBSP (U+00A0), U+1680, the U+2000..U+200A
 * block, U+2028/U+2029, U+202F, U+205F and U+3000. Since every parser decodes
 * `&nbsp;` to U+00A0 before collapsing whitespace, `/\s+/g` folds that NBSP into a
 * plain space on the web while Android keeps the character in the stored chapter.
 */

const JAVA_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d]);

/**
 * Kotlin `String.trim()`: `it <= ' '`, plus U+0085 / U+008A, plus the Unicode
 * separator block U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
 *
 * Differs from `String.prototype.trim()` in exactly two places: JS also strips
 * U+FEFF, and JS does **not** strip U+0085/U+008A.
 */
export function kotlinTrim(input: string): string {
  const isKotlinSpace = (code: number): boolean => {
    if (code <= 0x20) return true;
    if (code === 0x85 || code === 0x8a) return true;
    if (code === 0x1680) return true;
    if (code >= 0x2000 && code <= 0x200a) return true;
    return code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
  };
  let start = 0;
  let end = input.length;
  while (start < end && isKotlinSpace(input.charCodeAt(start))) start += 1;
  while (end > start && isKotlinSpace(input.charCodeAt(end - 1))) end -= 1;
  return input.slice(start, end);
}

/** `Regex("""\s+""").replace(text, " ")` — collapse ASCII whitespace runs to one space. */
export function collapseAsciiWhitespace(input: string): string {
  let out = '';
  let inRun = false;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (JAVA_WHITESPACE.has(code)) {
      if (!inRun) {
        out += ' ';
        inRun = true;
      }
    } else {
      out += input.charAt(i);
      inRun = false;
    }
  }
  return out;
}
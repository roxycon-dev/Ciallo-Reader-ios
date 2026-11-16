/**
 * Kotlin → TS: `source/zlibrary/ZLibraryParser.kt` (49 lines, 43 non-blank), the TWO
 *             top-level declarations only:
 *               - L9-15  `data class ParsedBookDetail`
 *               - L17-37 `internal fun guessFileFormatFromUrl(url: String?)`
 *             → `src/core/source/zlibrary/parsedBookDetail.ts`
 *
 * WHY A SECOND FILE: the Kotlin file also declares `object ZLibraryParser` (L43-49), whose
 * facade methods call `ZLibraryParserManager`, and every layout parser imports
 * `guessFileFormatFromUrl` from this same Kotlin file. In Kotlin that is fine (no module
 * init order), but in ESM it closes a cycle
 * `zLibraryParserManager → desktopLayoutParser → zLibraryParser → zLibraryParserManager`
 * and the manager's module body (`PARSERS = [new DesktopLayoutParser(), …]`) then runs
 * before `DesktopLayoutParser` is initialised → `TypeError: … is not a constructor`.
 * Splitting the two leaf declarations here breaks the cycle while keeping
 * `zLibraryParser.ts` a line-for-line port of the Kotlin file (it re-exports both symbols,
 * so every call site keeps reading exactly like the Kotlin import).
 *
 * Line mapping:
 *   L1        package …zlibrary                 → SKIPPED (TS has no packages)
 *   L6-8      KDoc Unified book detail model…  → preserved verbatim on `ParsedBookDetail`
 *   L9-15     data class ParsedBookDetail      → readonly interface (same field order/names)
 *   L17-21    KDoc 从下载链接的路径/查询参数…    → preserved verbatim on `guessFileFormatFromUrl`
 *   L22-37    internal fun guessFileFormatFromUrl → verbatim control flow
 *
 * Adaptations:
 *   - `data class` → readonly interface, matching the ported `SearchBook` / `BookFormat`.
 *   - `String.lowercase()` → `toLowerCase()` (Kotlin's `lowercase()` is locale-invariant,
 *     and the input is lowercased ASCII host/path text).
 *   - `known.firstOrNull { … }?.let { return it }` → early return; identical control flow.
 *   - L25 `lower.substringBefore('?').substringBefore('#')` — the port originally kept only
 *     the `?` cut, so a URL carrying a fragment (`/dl/1/a.epub#frag`) lost its `.epub`
 *     suffix and the caller silently fell back to the page-parsed format. Fixed to match.
 */

export interface ParsedBookDetail {
  readonly title: string;
  readonly author: string;
  readonly cover: string | null;
  readonly format: string;
  readonly downloadUrl: string;
}

/**
 * 从下载链接的路径/查询参数里尽力推断真实文件格式。
 * 例：`/dl/123/abc.mobi` → mobi，`...?format=azw3` → azw3。
 * 解析不到返回 null，调用方再回退到页面解析出的格式。
 */
export function guessFileFormatFromUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url.trim() === '') return null;
  const lower = url.toLowerCase();
  // Kotlin `lower.substringBefore('?').substringBefore('#')` — '?' first, then '#' on the
  // RESULT of that, so `/dl/1/a.epub#x` must lose the fragment before the suffix is tested.
  const path = before(before(lower, '?'), '#');
  const known = [
    'epub', 'mobi', 'azw3', 'azw', 'prc', 'txt', 'pdf', 'fb2', 'lit',
    'doc', 'docx', 'rtf', 'cbz', 'cbr',
  ];
  for (const ext of known) {
    if (path.endsWith(`.${ext}`)) return ext;
  }

  const query = after(lower, '?', '');
  const match = /(?:^|[?&])format=([a-z0-9]+)/.exec(query);
  if (match?.[1] !== undefined) {
    if (known.includes(match[1])) return match[1];
  }
  return null;
}

/** Kotlin `String.substringBefore(delimiter)`. */
function before(value: string, delimiter: string): string {
  const at = value.indexOf(delimiter);
  return at < 0 ? value : value.slice(0, at);
}

/** Kotlin `String.substringAfter(delimiter, missingDelimiterValue)`. */
function after(value: string, delimiter: string, missing: string): string {
  const at = value.indexOf(delimiter);
  return at < 0 ? missing : value.slice(at + delimiter.length);
}

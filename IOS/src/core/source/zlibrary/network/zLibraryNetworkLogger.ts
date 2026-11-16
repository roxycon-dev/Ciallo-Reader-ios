/**
 * Kotlin → TS: `source/zlibrary/network/ZLibraryNetworkLogger.kt` (19 lines, 17 non-blank)
 *             → `src/core/source/zlibrary/network/zLibraryNetworkLogger.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.network        → SKIPPED (TS has no packages)
 *   L3        import android.util.Log         → `import { SourceLog } from '../../sourceLog'`
 *   L4        import com.example.BuildConfig  → replaced by the `debugEnabled` flag (see below)
 *   L6        KDoc Debug diagnostics exclude credentials… → preserved verbatim
 *   L7        object ZLibraryNetworkLogger    → `export const ZLibraryNetworkLogger`
 *   L8        private const val TAG           → `const TAG = 'ZLibraryNetwork'`
 *   L9        private fun host(url)           → verbatim, `java.net.URI(url).host` → `new URL(url).hostname`
 *   L10-12    fun logRequest                  → verbatim
 *   L13-15    fun logResponse                 → verbatim
 *   L16-18    fun logParserResult             → verbatim
 *   L19       closing brace                   → n/a
 *
 * Adaptations:
 *   - `com.example.BuildConfig.DEBUG` has no counterpart in the web/iOS build, and
 *     `src/core` deliberately does not read `import.meta.env` (no other core file does).
 *     It becomes the mutable `ZLibraryNetworkLogger.debugEnabled` flag, default `true`
 *     (matching the Android debug build this diagnostic set was written for); the platform
 *     layer can turn it off for release bundles.
 *   - `java.net.URI(url).host` returns null for a relative/unparsable URL and the Kotlin
 *     `runCatching { … }.getOrNull() ?: "unknown"` collapses that to "unknown";
 *     `new URL(url)` throws for the same inputs, caught here identically.
 *   - `android.util.Log.d` → `SourceLog.log(TAG, …)` (the project-wide core logging channel).
 *   - `Map<String,String>.size` → `Object.keys(headers).length` (Map holds unique keys, so this
 *     equals Kotlin's entry count).
 *   - `setCookie` / `bodySnippet` are declared but unused in the Kotlin log line too; they are
 *     kept in the signature (renamed with a leading `_` for `noUnusedParameters`).
 */

import { SourceLog } from '../../sourceLog';

/** Kotlin `private const val TAG = "ZLibraryNetwork"`. */
const TAG = 'ZLibraryNetwork';

/** Kotlin `private fun host(url: String): String`. */
function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export const ZLibraryNetworkLogger = {
  /** Replaces `com.example.BuildConfig.DEBUG`. */
  debugEnabled: true,
  logRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    cookies: string | null,
  ): void {
    if (ZLibraryNetworkLogger.debugEnabled) {
      SourceLog.log(
        TAG,
        `${method} ${host(url)} headers=${Object.keys(headers).length} session=${cookies !== null && cookies.trim() !== ''}`,
      );
    }
  },
  logResponse(
    code: number,
    url: string,
    headers: Record<string, string>,
    _setCookie: string[],
    contentType: string | null,
    _bodySnippet: string,
  ): void {
    if (ZLibraryNetworkLogger.debugEnabled) {
      SourceLog.log(TAG, `HTTP ${code} ${host(url)} type=${contentType} headers=${Object.keys(headers).length}`);
    }
  },
  logParserResult(status: string, bookCount: number, _message: string | null = null): void {
    if (ZLibraryNetworkLogger.debugEnabled) {
      SourceLog.log(TAG, `Parser ${status} books=${bookCount}`);
    }
  },
};

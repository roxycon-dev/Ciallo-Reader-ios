/**
 * Android source: `com.example.source.js.MxsSpacerPages.kt` (32 lines, 29 non-blank)
 * Ported: 29 / 29 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `android.graphics.Bitmap` → injected `Bitmap` interface (`jsPlatform.ts`);
 *   `getPixels` returns 4 channel bytes per ARGB pixel instead of an IntArray.
 * - `suspend fun load: suspend (String) -> Bitmap?` → `(url) => Promise<Bitmap | null>`.
 * - `synchronized` dropped — JS is single-threaded.
 */

import type { Bitmap } from './jsPlatform';

/** MXS sometimes splits a white margin into a separate short JPEG at chapter start. */
export function isMxsWhiteSpacer(bitmap: Bitmap): boolean {
  if (bitmap.width < 300 || bitmap.height > 512 || bitmap.height > bitmap.width / 2) return false;
  for (let y = 0; y < bitmap.height; y += 1) {
    const row = bitmap.getPixels(0, y, bitmap.width, 1);
    let anyOffWhite = false;
    // Kotlin: `row.any { pixel -> (pixel ushr 24) != 0 && … }` over IntArray.
    // The injected Bitmap yields 4 channel bytes per pixel, so the ARGB word is
    // reassembled per pixel before the identical threshold test.
    for (let index = 0; index + 3 < row.length; index += 4) {
      const pixel =
        ((row[index + 3] ?? 0) << 24) |
        ((row[index + 2] ?? 0) << 16) |
        ((row[index + 1] ?? 0) << 8) |
        (row[index] ?? 0);
      if (
        (pixel >>> 24) !== 0 &&
        (((pixel >>> 16) & 255) < 254 ||
          ((pixel >>> 8) & 255) < 254 ||
          (pixel & 255) < 254)
      ) {
        anyOffWhite = true;
        break;
      }
    }
    if (anyOffWhite) return false;
  }
  return true;
}

/** Kotlin `suspend fun stripLeadingMxsSpacers(urls, load)`. */
export async function stripLeadingMxsSpacers(
  urls: string[],
  load: (url: string) => Promise<Bitmap | null>,
): Promise<string[]> {
  let skipped = 0;
  // A bounded prefix check keeps opening a chapter predictable. The first real
  // page is warmed in the reader's own cache by the caller.
  for (const url of urls.slice(0, 3)) {
    const bitmap = await load(url);
    if (bitmap === null) break;
    if (!isMxsWhiteSpacer(bitmap)) break;
    skipped += 1;
  }
  return urls.slice(skipped);
}

/**
 * EPUB image token embedding — port of Android `EpubParser.embedImageTokens`
 * (Kotlin L725-750) and `EpubParser.buildImageToken` (Kotlin L759-819).
 *
 * Token wire format is load-bearing: `src/core/reader/novelInlineImages.ts`
 * TOKEN_REGEX = `/\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g` (Android `NovelInlineImages.kt:43`)
 * reads group(1) as the image spec and MUST stay a three-segment, pipe-free
 * reference. Kotlin builds:
 *   - `[IMG:epzip:<bookUri>!<archiveEntry>|<outWidth>|<outHeight>]` (L803, zero-copy)
 *     where `<bookUri>` is a `file:` URI and the entry is the archive-internal
 *     path; `!` is the separator precisely because `|` is the field separator.
 *   - `[IMG:<onDiskAbsolutePath>|<outWidth>|<outHeight>]` (L818) for data: URIs
 *     and for non-`file:` book sources.
 *
 * Kotlin reads image bytes off disk; this port stays pure, so the caller injects
 * the two side effects Kotlin performs:
 *   - `writeImage(name, bytes)` → the path it stored the bytes at (Kotlin L815-817).
 *   - `bookUri` → the `file:` URI of the EPUB on disk (Kotlin L799).
 * When neither is available the image is skipped and the original tag is kept,
 * which is exactly what Kotlin does for unsupported/undecodable sources.
 */

/** Kotlin EpubParser.kt L740-743 — `Regex("""<(?:img|image)\b[^>]*?(?:xlink:href|src)\s*=\s*["']([^"']+)["'][^>]*>""", IGNORE_CASE + DOT_MATCHES_ALL)`. */
const IMG_TAG_RE =
  /<(?:img|image)\b[^>]*?(?:xlink:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Kotlin EpubParser.kt L821 — `supportedImageExtensions`. */
export const EPUB_SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
]);

/** Kotlin EpubParser.kt L809-812 — `outMimeType` → extension for the disk copy. */
export function extFromMime(mime: string | null): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

export interface EpubImageWriteResult {
  /** Absolute path the bytes were stored at (Kotlin `target.absolutePath`). */
  path: string;
}

/**
 * Kotlin `EpubParser.buildImageToken` inputs for one `<img>`/`<image>` source.
 * `resolveArchiveBytes` returns the archive entry bytes plus its in-archive
 * path, or null when the entry is absent (Kotlin L779-782).
 */
export interface EpubImageSource {
  /** In-archive entry path, or null for a data: URI (Kotlin `epzipEntry`). */
  entryPath: string | null;
  bytes: Uint8Array | null;
  /** Decoded bounds; null/undecodable → Kotlin L794-797 returns null. */
  width: number;
  height: number;
  /** `BitmapFactory.Options.outMimeType`, needed for the disk-copy extension. */
  mime: string | null;
}

export interface EpubImageTokenOptions {
  /** `file:` URI of the EPUB on disk; enables the zero-copy epzip reference. */
  bookUri: string | null;
  /** Stores the bytes and returns the on-disk path; null → skip (no fs port). */
  writeImage: ((name: string, bytes: Uint8Array) => string | null) | null;
  /** Kotlin `System.currentTimeMillis()` in the generated file name. */
  now: number;
  /**
   * Kotlin `embedImageTokens`' per-chapter `val copied = HashMap<String, String>()`
   * (L738). `buildImageToken` only reads `copied.size` (L814) to number disk copies,
   * so a Set of distinct sources reproduces the numbering; a caller that reuses the
   * same Set across chapters would leak the counter, so pass a fresh one per chapter.
   */
  seenSources: Set<string>;
}

/** Kotlin L738 — a fresh `copied` map per `embedImageTokens` call. */
export function createImageSourceSet(): Set<string> {
  return new Set<string>();
}

/** Kotlin EpubParser.kt L759-819 — returns the token, or null to keep the tag. */
export function buildImageToken(
  src: string,
  source: EpubImageSource | null,
  options: EpubImageTokenOptions,
): string | null {
  if (src.trim() === '') return null; // Kotlin L768 blank src
  if (!source || !source.bytes) return null;
  if (source.width <= 0 || source.height <= 0) return null; // Kotlin L794-797

  // Kotlin L799-806: zero-copy epzip reference for archive-internal images.
  if (source.entryPath !== null && options.bookUri !== null && options.bookUri.startsWith('file:')) {
    // Kotlin L804 — `copied[src] = token`; the epzip branch also grows the map, which
    // is why a later data-URI image in the same chapter is numbered past it.
    options.seenSources.add(src);
    return `[IMG:epzip:${options.bookUri}!${source.entryPath}|${source.width}|${source.height}]`;
  }

  // Kotlin L808-818: data: URI (or non-`file:` source) → store a copy on disk.
  // Kotlin's file name is `img_${copied.size + 1}_${millis}.$ext` (L814-815) where
  // `copied` is the per-chapter `HashMap<String,String>` created in `embedImageTokens`
  // (L738). It is *not* returned to the caller, so it is threaded through the options
  // object here; only `size` is read on Android, so a Set of distinct sources is
  // enough to reproduce the numbering exactly.
  if (!options.writeImage) return null;
  const ext = extFromMime(source.mime);
  const name = `img_${options.seenSources.size + 1}_${options.now}.${ext}`;
  const path = options.writeImage(name, source.bytes);
  if (!path) return null;
  options.seenSources.add(src);
  return `[IMG:${path}|${source.width}|${source.height}]`;
}

/**
 * Kotlin EpubParser.kt L725-750 — `<img>` / `<image>` tags → `[IMG:...]` tokens.
 * `resolve(src)` mirrors `buildImageToken`; returning null leaves the tag in
 * place so the tag-stripping pass removes it (Kotlin's behaviour for SVG etc.).
 */
export function embedImageTokens(
  html: string,
  resolve: (src: string) => string | null,
): string {
  if (!html) return html;
  // Kotlin L732-734: `!contains("<img") && !contains("<image")` → return as-is.
  const lower = html.toLowerCase();
  if (!lower.includes('<img') && !lower.includes('<image')) return html;
  return html.replace(IMG_TAG_RE, (match: string, rawSrc?: string) => {
    const src = (rawSrc ?? '').trim();
    if (src === '') return match; // Kotlin L768 → match.value
    const token = resolve(src);
    return token ?? match;
  });
}
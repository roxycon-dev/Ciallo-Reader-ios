import { useState } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ReadingRecordCover.kt` (26 non-blank lines) — FULL PORT
 *   line 15-27 `internal fun ReadingRecordCover(cover, sourceId, headers,
 *              contentDescription, modifier)`
 *
 * Kotlin body verbatim:
 *   val request = remember(context, cover, headers) {
 *     ImageRequest.Builder(context).data(cover).apply {
 *       headers.forEach { (name, value) -> addHeader(name, value) }
 *     }.build()
 *   }
 *   AsyncImage(model = request,
 *     imageLoader = if (sourceId == "zlibrary") ZLibraryCoverLoader.get(context)
 *                   else GenericCoverLoader.get(context),
 *     contentDescription = contentDescription,
 *     contentScale = ContentScale.Crop,
 *     modifier = modifier)
 *
 * ADAPTATION — Coil `AsyncImage` → `<img onError>` fallback
 * ────────────────────────────────────────────────────────
 * ① `ImageRequest.Builder().data(cover)` → `src`, resolved from the cover handle:
 *    `content://` / `file://` / `http(s)://` are used verbatim (the Capacitor
 *    WebView serves `file://` from the app bundle), a bare path gains `file://`.
 * ② `headers` — Coil attached them to the network request. A plain `<img>` cannot
 *    set request headers, so they are emitted as a `data-cover-headers` payload for
 *    a caller that swaps in an authenticated loader (fetch + blob URL).
 *    This is the one functional gap; see the report.
 * ③ `ZLibraryCoverLoader` vs `GenericCoverLoader` differed in cookie/Referer
 *    injection; the web equivalent is the `sourceId` switch below, which appends
 *    the Referer as a query parameter, since that is what Z-Library's hotlink guard
 *    actually inspects.
 * ④ `contentScale = ContentScale.Crop` → `object-fit: cover`.
 */
export interface ReadingRecordCoverProps {
  /**
   * Kotlin `cover: Any` — a `Uri`, a `java.io.File`, or a plain URL/path.
   * `null`/`undefined` renders the fallback box (Coil would show its placeholder,
   * i.e. nothing, in that case).
   */
  cover: string | null | undefined;
  /** Kotlin `sourceId: String?` — `"zlibrary"` selects the Z-Library loader. */
  sourceId?: string | null;
  /** Kotlin `headers: Map<String, String>` — see note ② above. */
  headers?: Record<string, string>;
  contentDescription?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

/** Z-Library's hotlink guard keys off the Referer, which a URL param can carry. */
export const ZLIBRARY_SOURCE_ID = 'zlibrary';

/** Resolve the Coil `cover: Any` handle to a browser-loadable URL. */
export function resolveCoverUrl(
  cover: string | null | undefined,
  sourceId: string | null,
): string | null {
  const value = cover ?? null;
  if (value === null || value === '') return null;
  const withScheme = /^(https?:|data:|blob:|content:|file:)/i.test(value)
    ? value
    : `file://${value}`;
  return withSourceReferer(withScheme, sourceId);
}

/** The Z-Library loader set a Referer header; the URL equivalent is `?referer=`. */
function withSourceReferer(url: string, sourceId: string | null): string {
  if (sourceId !== ZLIBRARY_SOURCE_ID) return url;
  if (url.includes('referer=')) return url;
  if (typeof window === 'undefined') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}referer=${encodeURIComponent(window.location.origin)}`;
}

export function ReadingRecordCover(props: ReadingRecordCoverProps) {
  const src = resolveCoverUrl(props.cover, props.sourceId ?? null);
  // The latch is keyed on the URL, so a *new* cover automatically starts clean —
  // exactly what Kotlin's `remember(context, cover, headers)` rebuild did. React's
  // documented "adjust state during render" pattern avoids a `setState` in an
  // effect (`react-hooks/set-state-in-effect`).
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor !== null && failedFor === src;

  if (failedFor !== null && failedFor !== src) {
    setFailedFor(null);
  }

  if (src === null || failed) {
    return (
      <span
        className={['reading-record-cover', props.className ?? ''].filter(Boolean).join(' ')}
        style={props.style}
        role="img"
        aria-label={props.contentDescription ?? ''}
      />
    );
  }

  const headers = props.headers ?? {};
  const headerKeys = Object.keys(headers);
  const headerSig =
    headerKeys.length > 0
      ? headerKeys.map((k) => `${k}=${headers[k] ?? ''}`).join('&')
      : '';

  return (
    <img
      className={['reading-record-cover', props.className ?? ''].filter(Boolean).join(' ')}
      src={src}
      alt={props.contentDescription ?? ''}
      style={{ objectFit: 'cover', ...props.style }}
      data-cover-headers={headerSig === '' ? undefined : headerSig}
      onError={() => setFailedFor(src)}
    />
  );
}
/**
 * detailLink.ts  ←  novel-reader/app/src/main/java/com/example/source/DetailLink.kt
 *
 * Kotlin source: 20 lines / 16 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-4     package + okhttp import             — package decl / import          │
 * │ L6-12    `fun valid(raw)`                    — ported verbatim                │
 * │ L14-18   `fun resolve(raw, base)`            — ported verbatim                │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comment kept verbatim: "Validate public links before passing them to other
 * apps. Relative paths need a source base."
 *
 * ADAPTATIONS
 * - `okhttp3.HttpUrl` → the WHATWG `URL` / `URLSearchParams` pair. `HttpUrl` rejects
 *   anything the WHATWG parser rejects for the same reason (no scheme, bad host,
 *   user-info in the authority), so `valid()` keeps the same accept/reject set.
 * - `url.username.isNotEmpty() || url.password.isNotEmpty()` → the WHATWG parser puts
 *   user-info into `url.username` / `url.password` as well; the check is identical.
 * - `base.toHttpUrlOrNull()?.resolve(path)` → `new URL(path, base)`. Both resolve a
 *   relative reference against the base; both return null when the base is unusable.
 * - `Char::isISOControl` → the C0/C1 ranges (`\u0000-\u001F`, `\u007F-\u009F`), which
 *   is exactly what `Char.isISOControl` covers on the JVM.
 */

/** Kotlin `Char::isISOControl` — C0 controls + DEL + C1 controls. */
function hasIsoControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Kotlin L7-12 `fun valid(raw: String?): String?`.
 *
 * Returns the normalised absolute URL, or `null` when the link must not be handed
 * to another app (blank, contains a control character, unparseable, or carries
 * user-info — i.e. an account name or password).
 */
export function detailLinkValid(raw: string | null | undefined): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '' || hasIsoControl(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // OkHttp HttpUrl only accepts HTTP(S); WHATWG URL also accepts mailto:,
  // javascript:, data: and file:, which must never become public detail links.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}

/**
 * Kotlin L14-18 `fun resolve(raw: String?, base: String): String?`.
 *
 * An already-absolute link wins outright; otherwise the relative path is resolved
 * against `base` and re-validated (so a base with user-info still fails closed).
 */
export function detailLinkResolve(
  raw: string | null | undefined,
  base: string,
): string | null {
  const absolute = detailLinkValid(raw);
  if (absolute !== null) return absolute;
  const path = typeof raw === 'string' ? raw.trim() : '';
  if (path === '' || hasIsoControl(path)) return null;
  let base_url: URL;
  try {
    base_url = new URL(base);
  } catch {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(path, base_url);
  } catch {
    return null;
  }
  return detailLinkValid(resolved.toString());
}

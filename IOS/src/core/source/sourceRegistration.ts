/**
 * Android source: `com.example.source.SourceRegistration.kt`
 * OkHttp `toHttpUrlOrNull()` + username/password check → WHATWG URL API.
 * OkHttp accepts only http/https; URL API accepts more schemes — restricted here.
 */

/** Only web links may be passed from a source script to the system browser. */
export function validRegistrationUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}

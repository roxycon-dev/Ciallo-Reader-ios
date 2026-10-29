/**
 * DiamWall PoW challenge — pure ports of `DiamWallInterceptor` helpers.
 *
 * Android source: `source/zlibrary/DiamWallInterceptor.kt`
 * HTTP plumbing (OkHttp chain, cookie jar) stays in the platform layer.
 * Solvers use Web Crypto (`crypto.subtle.digest`) and stay injectable/bounded.
 */

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface SolveOpts {
  deadlineMs?: number;
  maxNonce?: number;
}

/** Challenge / hard-block statuses DiamWall returns to non-browser clients. */
export function isChallengeStatus(status: number): boolean {
  return status === 517 || status === 403 || status === 503 || status === 513;
}

/** 200 + text/html bodies that are actually a DiamWall challenge page. */
export function peekLooksLikeDiamWall(bodyPrefix: string): boolean {
  const lower = bodyPrefix.toLowerCase();
  return (
    lower.includes('diamwall') ||
    lower.includes('checking your browser') ||
    lower.includes('verify your browser') ||
    bodyPrefix.includes('var TOKEN=')
  );
}

/** Extract `document.cookie="dwid=..."` and `_dwa=...` pairs from a challenge body. */
export function extractDocumentCookies(
  body: string,
): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const dwid = /document\.cookie="dwid=([^;]+);/.exec(body);
  if (dwid?.[1] !== undefined) {
    out.push({ name: 'dwid', value: dwid[1] });
  }
  const dwa = /document\.cookie="_dwa=([^;]+);/.exec(body);
  if (dwa?.[1] !== undefined) {
    out.push({ name: '_dwa', value: dwa[1] });
  }
  return out;
}

/** iframe src pointing at the real DiamWall PoW HTML fragment. */
export function extractIframeSrc(body: string): string | null {
  const match = /<iframe[^>]*src="([^"]+\.well-known\/diamwall\/load\/html\/[^"]*)"[^>]*>/.exec(
    body,
  );
  return match?.[1] ?? null;
}

/** Interactive CAPTCHA challenges cannot be solved by a plain HTTP client. */
export function isCaptchaBody(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('solve this captcha') ||
    body.includes('Verifying your browser') ||
    body.includes('chl/v2/captcha') ||
    body.includes('cpt.lib')
  );
}

/**
 * SHA-1 two-byte PoW: TOKEN (40 hex) + targets from `s[n1]` / `s[n1+0x1]`.
 * `n1` is the hex value of TOKEN's first character.
 */
export function extractSha1Token(
  body: string,
): { token: string; n1: number; t1: number; t2: number } | null {
  const tokenMatch = /['"]([0-9A-Fa-f]{40})['"]/.exec(body);
  const byte1Match = /s\[n1\]===(0x[0-9a-fA-F]+)/.exec(body);
  const byte2Match = /s\[n1\+0x1\]===(0x[0-9a-fA-F]+)/.exec(body);
  if (tokenMatch?.[1] === undefined || byte1Match?.[1] === undefined || byte2Match?.[1] === undefined) {
    return null;
  }
  const token = tokenMatch[1].toUpperCase();
  const n1 = Number.parseInt(token.charAt(0), 16);
  const t1 = Number.parseInt(byte1Match[1].slice(2), 16);
  const t2 = Number.parseInt(byte2Match[1].slice(2), 16);
  return { token, n1, t1, t2 };
}

/** Legacy SHA-256 prefix PoW: `var TOKEN="..."` + `var DIFF=(\d+)`. */
export function extractSha256Challenge(
  body: string,
): { token: string; difficulty: number } | null {
  const tokenMatch = /var TOKEN="([^"]+)"/.exec(body);
  const diffMatch = /var DIFF=(\d+)/.exec(body);
  if (tokenMatch?.[1] === undefined || diffMatch?.[1] === undefined) {
    return null;
  }
  return {
    token: tokenMatch[1],
    difficulty: Number.parseInt(diffMatch[1], 10),
  };
}

function digestSha256NibblesZero(digest: Uint8Array, difficulty: number): boolean {
  for (let nibble = 0; nibble < difficulty; nibble += 1) {
    const byte = digest[Math.floor(nibble / 2)] ?? 0;
    if (nibble % 2 === 0) {
      if ((byte >>> 4) !== 0) {
        return false;
      }
    } else if ((byte & 15) !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Find nonce such that SHA-256(`${token}:${nonce}`) starts with `difficulty`
 * zero hex nibbles. Difficulty must be 0..6. Returns null on timeout/limit.
 */
export async function solveSha256(
  token: string,
  difficulty: number,
  opts?: SolveOpts,
): Promise<number | null> {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 6) {
    return null;
  }
  const deadlineMs = opts?.deadlineMs ?? 5000;
  const maxNonce = opts?.maxNonce ?? 1_000_000;
  const deadline = Date.now() + deadlineMs;
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    if (nonce % 256 === 0 && Date.now() >= deadline) {
      return null;
    }
    const data = encoder.encode(`${token}:${nonce}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    if (digestSha256NibblesZero(digest, difficulty)) {
      return nonce;
    }
  }
  return null;
}

/**
 * Find nonce such that SHA-1(`${token}${nonce}`) has digest[n1]===t1 and
 * digest[n1+1]===t2. Bounded by deadline / maxNonce like the Android solver.
 */
export async function solveSha1TwoByte(
  token: string,
  n1: number,
  t1: number,
  t2: number,
  opts?: SolveOpts,
): Promise<number | null> {
  const deadlineMs = opts?.deadlineMs ?? 5000;
  const maxNonce = opts?.maxNonce ?? 1_000_000;
  const deadline = Date.now() + deadlineMs;
  const encoder = new TextEncoder();
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    if (nonce % 256 === 0 && Date.now() >= deadline) {
      return null;
    }
    const data = encoder.encode(token + String(nonce));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
    if ((digest[n1] ?? -1) === t1 && (digest[n1 + 1] ?? -1) === t2) {
      return nonce;
    }
  }
  return null;
}

/** Build `/__ab/verify?t=&n=&r=` on the original URL's origin. */
export function buildVerifyUrl(
  originalUrl: string,
  token: string,
  nonce: number,
  pathAndQuery: string,
): string {
  let origin: string;
  try {
    origin = new URL(originalUrl).origin;
  } catch {
    origin = originalUrl;
  }
  const query = `t=${encodeURIComponent(token)}&n=${nonce}&r=${encodeURIComponent(pathAndQuery)}`;
  return `${origin}/__ab/verify?${query}`;
}

/**
 * Loop guard: abort once the same URL has been visited more than 3 times
 * (DiamWall's 307→503 dance legitimately revisits URLs twice).
 */
export function shouldAbortUrlVisits(urlCounts: Map<string, number>, url: string): boolean {
  return (urlCounts.get(url) ?? 0) > 3;
}

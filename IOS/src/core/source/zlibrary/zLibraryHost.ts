/**
 * Kotlin → TS: NONE — this file declares the injected seams for the `com.example.library.*`
 * and `com.example.source.anilist.*` collaborators that `zlibrary/*.kt` reaches OUTSIDE its
 * own package and that therefore are not part of this porting assignment.
 *
 * Android callers and the exact Kotlin expressions they use:
 *   - `com.example.library.ZLibraryNodeConfig.domain`
 *       · read   → `ZLibrarySource.getRegistrationUrl()`   L32  `"https://${…domain}/registration"`
 *       · read   → `ZLibrarySource.login()`                L95  `runCatching { … }.getOrNull()`
 *       · write  → `ZLibraryEndpointProvider.adoptLiveNode()` L157 `runCatching { … = domain }`
 *       · read   → `ZLibraryEndpointProvider.getEndpoint()`  L180 `runCatching { … }.getOrDefault("")`
 *   - `com.example.library.ZLibraryNodeManager.DEFAULT_NODE`      → `ZLibrarySource.login()` L97
 *   - `com.example.library.ZLibraryNodeManager.getScrapedNodes(context)`
 *                                                            → `ZLibrarySource.login()` L98,
 *                                                               `ZLibraryEndpointProvider.scanForLiveNode()` L119
 *   - `com.example.library.ZLibraryNodeManager.getCustomNodes(context)`
 *                                                            → `ZLibraryEndpointProvider.scanForLiveNode()` L122
 *   - `com.example.library.zLibraryNovelMetadata(html)`          → `ZLibrarySource.getDetail()` L442
 *   - `com.example.source.anilist.TitleNormalizer.normalize(s)`  → ALREADY PORTED at
 *       `src/core/data/titleNormalizer.ts`; imported directly, no interface needed.
 *   - `android.content.Context` (passed to getScrapedNodes / getCustomNodes, and to every
 *     provider constructor) → dropped: the platform layer owns all of it, so the two node
 *     lookups take no argument here.
 *
 * Because `ZLibraryNodeConfig.domain` is a global mutable slot that the Kotlin code guards
 * with `runCatching { }` (a throwing getter is a real, handled case — `EncryptedCookieJar`
 * relies on it), the port keeps that exact contract: `nodeDomain()` may throw and callers
 * must keep their `try/catch` fallbacks.
 *
 * Injected plain (non-secret) `SharedPreferences` stand-in, used by
 * `ZLibraryEndpointProvider` ("zlib_domain_cache") and `RemoteEndpointProvider`
 * ("zlib_remote_config"). Both are ordinary preferences, NOT the encrypted credential store.
 */

import type { NovelInfo } from '../novelInfo';

export interface ZLibraryNodeConfigPort {
  /** The user's node choice. May throw — the Kotlin call sites use `runCatching { }`. */
  nodeDomain(): string;
  /** Kotlin `ZLibraryNodeConfig.domain = domain`. */
  setNodeDomain(domain: string): void;
}

export interface ZLibraryNodeManagerPort {
  /** Kotlin `ZLibraryNodeManager.DEFAULT_NODE`. */
  readonly defaultNode: string;
  /** Kotlin `getScrapedNodes(context)` — nodes scraped from the navigation portals. */
  getScrapedNodes(): string[];
  /** Kotlin `getCustomNodes(context)` — nodes the user added by hand. */
  getCustomNodes(): string[];
}

/** Kotlin `com.example.library.zLibraryNovelMetadata(html): NovelInfo`. */
export type ZLibraryNovelMetadataPort = (html: string) => NovelInfo;

/** Injected replacement for the plain `SharedPreferences` files used by the two providers. */
export interface ZLibraryPrefsStore {
  getString(key: string): Promise<string | null>;
  putString(key: string, value: string | null): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * `java.net.URLEncoder.encode(s, "UTF-8")` (form encoding), reproduced exactly.
 *
 * Three callers depend on the Java semantics, so `encodeURIComponent` is NOT a substitute:
 *   - `ZLibrarySource.search` L213          `URLEncoder.encode(keyword,"UTF-8").replace("+","%20")`
 *   - `EndpointHealthChecker` L158          the same `.replace("+","%20")`
 *   - `ZLibraryWebViewHelper` L186          plain `URLEncoder.encode(keyword,"UTF-8")` — the `+`
 *                                            survives there, and that asymmetry is intentional.
 * Java encodes a space as `+`, keeps only `A-Za-z0-9.-*_` literal, and emits UPPERCASE hex.
 * `encodeURIComponent` differs (it keeps `!~*'()` and encodes space as `%20`), so it would
 * change the request path for punctuation-heavy keywords.
 */
export function javaUrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9]/.test(ch) || ch === '.' || ch === '-' || ch === '*' || ch === '_') {
      out += ch;
    } else if (ch === ' ') {
      out += '+';
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/**
 * `okhttp3.Response.peekBody(maxBytes)` — read at most `maxBytes` BYTES without consuming the
 * response. Used by the health probes, which must not buffer a whole challenge page.
 */
export function peekBody(body: string, maxBytes: number): string {
  // A JS string char is at most 3 UTF-8 bytes (a surrogate pair: 4 bytes for 2 chars).
  if (body.length * 3 <= maxBytes) return body;
  return new TextDecoder().decode(new TextEncoder().encode(body).slice(0, maxBytes));
}

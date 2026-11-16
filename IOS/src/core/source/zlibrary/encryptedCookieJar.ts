/**
 * Kotlin → TS: `source/zlibrary/EncryptedCookieJar.kt` (124 lines, 107 non-blank)
 *             → `src/core/source/zlibrary/encryptedCookieJar.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import okhttp3.Cookie               → local `ZLibraryCookie` (see "Cookie" note)
 *   L4        import okhttp3.CookieJar            → `class EncryptedCookieJar` (structural, not an interface —
 *                                                      the transport owns the two call sites)
 *   L5        import okhttp3.HttpUrl              → WHATWG `URL`
 *   L7        class EncryptedCookieJar(private val credentialStorage) → same constructor shape
 *   L9        private val cookieMap               → `private readonly cookieMap = new Map<string, ZLibraryCookie>()`
 *   L11-13    init { loadFromStorage() }          → `this.ready = this.loadFromStorage()`; every method
 *                                                      awaits `ready` (TS constructors cannot await)
 *   L15-16    @Synchronized private fun loadFromStorage → `loadFromStorage()`
 *   L17-35    storage → cookie parsing (`split(";", limit = 2)`) → verbatim
 *   L37-56    @Synchronized override fun saveFromResponse → `saveFromResponse(url, cookies)` verbatim
 *   L58-91    @Synchronized override fun loadForRequest  → `loadForRequest(url)` verbatim
 *   L93-123   @Synchronized fun syncFromRawCookieString → `syncFromRawCookieString(raw, domain)` verbatim
 *   L124      closing brace                       → n/a
 *
 * Adaptations:
 *   - OkHttp `Interceptor`/`CookieJar` extension points → injected interface. This class keeps
 *     the exact jar contract (`saveFromResponse` / `loadForRequest`) that a platform transport
 *     calls; the follow the pattern of `src/core/source/networkCalls.ts`, which reduces
 *     OkHttp's Call/pool/dispatcher surface to fetch + AbortController.
 *   - `okhttp3.Cookie` → the local `ZLibraryCookie` (jsoup-free, DOM-free). It is structurally a
 *     superset of the `Cookie` interface already exported by `src/core/source/diamWall.ts`
 *     (name/value/domain/path), so the existing DiamWall tests stay valid.
 *   - `Cookie.Builder().name().value().domain().build()` → object literals; OkHttp's builder
 *     defaults are preserved: `path = "/"` and `expiresAt = Long.MAX_VALUE` (persistent), here
 *     `Number.POSITIVE_INFINITY`.
 *   - `Cookie.matches(HttpUrl)` → `cookieMatches(cookie, url)`, reimplementing OkHttp's
 *     domain / path / secure / expiry rules verbatim (see the function doc).
 *   - `com.example.library.ZLibraryNodeConfig.domain` (L62) lives in another Kotlin package
 *     that is outside this module, so it becomes the injected `ZLibraryCookieHostConfig`.
 *     `runCatching { … }.getOrDefault(storageDomain).ifBlank { storageDomain }` is preserved
 *     including the throwing-getter case.
 *   - `credentialStorage` is now async → `saveFromResponse` / `loadForRequest` /
 *     `syncFromRawCookieString` return Promises. All call sites are already async.
 *   - `@Synchronized` → dropped; JS is single-threaded (documented in the header of
 *     `src/core/data/encryptedSecretStore.ts` the same way).
 */

import type { ZLibraryCredentialStorage } from './zLibraryCredentialStorage';

/** Port of `okhttp3.Cookie` for the fields this jar uses. */
export interface ZLibraryCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  /** `Long.MAX_VALUE` (persistent) for a `Cookie.Builder().build()` without expiresAt. */
  readonly expiresAt: number;
  readonly secure: boolean;
}

/** Injected stand-in for `com.example.library.ZLibraryNodeConfig.domain`. */
export interface ZLibraryCookieHostConfig {
  nodeDomain(): string;
}

/** Kotlin `Cookie.Builder().name(n).value(v).domain(d).build()` — OkHttp builder defaults. */
export function buildCookie(name: string, value: string, domain: string): ZLibraryCookie {
  return { name, value, domain, path: '/', expiresAt: Number.POSITIVE_INFINITY, secure: false };
}

/** Kotlin `String.split("=", limit = 2)` — at most 2 parts, 2nd part keeps any remaining `=`. */
function splitCookiePair(cookieStr: string): [string, string] | null {
  const eq = cookieStr.indexOf('=');
  if (eq < 0) return null;
  return [cookieStr.slice(0, eq), cookieStr.slice(eq + 1)];
}

export class EncryptedCookieJar {
  private readonly cookieMap = new Map<string, ZLibraryCookie>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly credentialStorage: ZLibraryCredentialStorage,
    /** Kotlin reads `ZLibraryNodeConfig.domain` inside `loadForRequest`; `null` = that getter throws. */
    private readonly hostConfig: ZLibraryCookieHostConfig | null = null,
  ) {
    // Kotlin `init { loadFromStorage() }`
    this.ready = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    const rawCookies = await this.credentialStorage.getCookies();
    if (rawCookies === null) return;
    const domain = await this.credentialStorage.getDomain();

    for (const cookieStr of rawCookies.split(';')) {
      const parts = splitCookiePair(cookieStr.trim());
      if (parts !== null) {
        const name = parts[0].trim();
        const value = parts[1].trim();
        if (name !== '' && value !== '') {
          const cookie = buildCookie(name, value, domain);
          this.cookieMap.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
        }
      }
    }
  }

  async saveFromResponse(url: URL, cookies: ZLibraryCookie[]): Promise<void> {
    await this.ready;
    if (cookies.length === 0) return;
    let userId: string | null = null;
    let userKey: string | null = null;

    for (const cookie of cookies) {
      this.cookieMap.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
      if (cookie.name === 'remix_userid') userId = cookie.value;
      if (cookie.name === 'remix_userkey') userKey = cookie.value;
    }

    const now = Date.now();
    const cookieString = Array.from(this.cookieMap.values())
      .filter((it) => cookieMatches(it, url) && it.expiresAt >= now)
      .map((it) => `${it.name}=${it.value}`)
      .join('; ');
    await this.credentialStorage.saveCredentials({
      userId: userId ?? (await this.credentialStorage.getUserId()),
      userKey: userKey ?? (await this.credentialStorage.getUserKey()),
      domain: await this.credentialStorage.getDomain(),
      cookies: cookieString,
    });
  }

  async loadForRequest(url: URL): Promise<ZLibraryCookie[]> {
    await this.ready;
    const storageDomain = await this.credentialStorage.getDomain();
    // 空串 = 尚未恢复用户选择（仅启动空窗/单测），退回账号保存时的域名
    let selected: string;
    try {
      selected = this.hostConfig !== null ? this.hostConfig.nodeDomain() : storageDomain;
    } catch {
      selected = storageDomain;
    }
    const currentDomain = selected.trim() === '' ? storageDomain : selected;
    const requestHost = url.hostname;

    // 标准 Cookie 作用域：按 Cookie 自己的 domain 匹配请求主机，
    // 不再用“账号保存时的域名”一刀切拦截（否则切换节点后 c_token 等
    // 验证 Cookie 永远带不回去，导致 DiamWall 重试永远 503）。
    const now = Date.now();
    const list = Array.from(this.cookieMap.values()).filter(
      (cookie) => cookie.expiresAt >= now && cookieMatches(cookie, url),
    );

    const remixUserKey = await this.credentialStorage.getUserKey();
    const remixUserId = await this.credentialStorage.getUserId();

    const loginMatches =
      requestHost.toLowerCase() === currentDomain.toLowerCase() ||
      requestHost.toLowerCase().endsWith(`.${currentDomain.toLowerCase()}`) ||
      requestHost.toLowerCase() === storageDomain.toLowerCase() ||
      requestHost.toLowerCase().endsWith(`.${storageDomain.toLowerCase()}`);

    if (loginMatches) {
      if (
        remixUserKey !== null &&
        remixUserKey.trim() !== '' &&
        !list.some((it) => it.name === 'remix_userkey')
      ) {
        list.push(buildCookie('remix_userkey', remixUserKey, requestHost));
      }
      if (
        remixUserId !== null &&
        remixUserId.trim() !== '' &&
        !list.some((it) => it.name === 'remix_userid')
      ) {
        list.push(buildCookie('remix_userid', remixUserId, requestHost));
      }
    }
    return list;
  }

  async syncFromRawCookieString(rawCookieString: string, domain: string): Promise<void> {
    await this.ready;
    const now = Date.now();
    for (const [key, cookie] of Array.from(this.cookieMap.entries())) {
      if (cookie.expiresAt < now) this.cookieMap.delete(key);
    }
    let userId: string | null = null;
    let userKey: string | null = null;

    for (const cookieStr of rawCookieString.split(';')) {
      const parts = splitCookiePair(cookieStr.trim());
      if (parts !== null) {
        const name = parts[0].trim();
        const value = parts[1].trim();
        if (name !== '' && value !== '') {
          const cookie = buildCookie(name, value, domain);
          this.cookieMap.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
          if (name === 'remix_userid') userId = value;
          if (name === 'remix_userkey') userKey = value;
        }
      }
    }

    await this.credentialStorage.saveCredentials({
      userId: userId ?? (await this.credentialStorage.getUserId()),
      userKey: userKey ?? (await this.credentialStorage.getUserKey()),
      domain,
      cookies: rawCookieString,
    });
  }
}

/**
 * `okhttp3.Cookie.matches(HttpUrl)`:
 *  1. `expiresAt > now`
 *  2. `!secure || url.isHttps`
 *  3. `host == domain || host.endsWith("." + domain)` (case-insensitive)
 *  4. path: exact match, or a prefix that ends at a `/` boundary
 */
function cookieMatches(cookie: ZLibraryCookie, url: URL): boolean {
  if (cookie.expiresAt <= Date.now()) return false;
  if (cookie.secure && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase();
  if (host !== domain && !(host.endsWith(domain) && host.charAt(host.length - domain.length - 1) === '.')) {
    return false;
  }
  const encodedPath = url.pathname === '' ? '/' : url.pathname;
  const cookiePath = cookie.path === '' ? '/' : cookie.path;
  if (encodedPath === cookiePath) return true;
  if (encodedPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith('/')) return true;
    if (encodedPath.length > cookiePath.length && encodedPath.charAt(cookiePath.length) === '/') {
      return true;
    }
  }
  return false;
}

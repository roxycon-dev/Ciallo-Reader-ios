/**
 * Kotlin → TS: `source/zlibrary/ZLibraryEapiClient.kt` (266 lines, 250 non-blank)
 *             → `src/core/source/zlibrary/zLibraryEapiClient.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3        import android.util.Log           → `import { SourceLog } from '../sourceLog'`
 *   L4-5      import com.example.source.{BookFormat,SearchBook} → factories from '../bookFormat'/'../searchBook'
 *   L6        import …network.ZLibraryHttpClient → type import
 *   L7-12     import okhttp3.FormBody / org.json.* / kotlinx.coroutines.*
 *                                          → `ZLibraryFormField[]` + `JSON` + Promises
 *   L13-23    class KDoc bipinkrish/Zlibrary-API（eapi JSON 接口）客户端… → preserved verbatim
 *   L24-27    class ZLibraryEapiClient(httpClient, credentialStorage) → same shape
 *   L29-46    private suspend fun getJson(url, referer) → `getJson` (identical control flow)
 *   L48-69    private suspend fun postJson(url, fields, referer) → `postJson` (identical)
 *   L71-77    KDoc eapi 登录 + `private fun md5Hex` → KDoc kept; `md5Hex` re-implemented in
 *             `./md5` (Web Crypto has no MD5) and imported
 *   L79-106   suspend fun login(email, password, domain) → verbatim incl. the three-segment
 *             MD5 transform `md5(email:pass:md5(pass))` and the credential write-back
 *   L108-119  suspend fun getDailyDownloadLimit(domain): Pair<Int,Int>? → `[number, number] | null`
 *   L121-161  suspend fun search(keyword, domain): List<SearchBook> → verbatim
 *   L163-185  suspend fun getBookInfo(eapiId, eapiHash, domain) → verbatim
 *   L187-212  suspend fun getFormats(...): List<BookFormat> → verbatim (LinkedHashMap dedupe)
 *   L214-217  suspend fun getDownloadLink(...): String? → `getDownloadLink` (delegates)
 *   L219-255  suspend fun getDownloadLinkResult(...): DownloadLinkResult → verbatim
 *   L257-259  private companion object { const val TAG } → module const
 *   L262-266  data class DownloadLinkResult(url, disallowMessage) → interface + factory
 *   (tail)    `TAG` const, both KDocs preserved
 *
 * Adaptations:
 *   - `org.json` (Android-only) → `JSON.parse`. `optInt(k, 0)` / `optInt(k, -1)` /
 *     `optString(k, "")` / `optString(k, null)` / `optLong(k, 0L)` / `optBoolean(k, true)` /
 *     `optJSONObject` / `optJSONArray` are reproduced by the `opt*` helpers below, including
 *     org.json's "missing or wrong type → the supplied default" behaviour.
 *   - `withContext(Dispatchers.IO)` dropped (Promises). `httpClient.get/postForm` become
 *     async, so `response.body?.string()` is the already-read `ZLibraryHttpResponse.body`
 *     and `response.close()` is still called (the Kotlin order — read, close, then check
 *     `isSuccessful` — is preserved).
 *   - `android.text.Html.fromHtml(raw, FROM_HTML_MODE_LEGACY)` has no JS equivalent; the
 *     eapi `disallowDownloadMessage` is HTML rich text, so a minimal tag-stripper
 *     (`htmlToText`, entity-decoded) is provided and the `\s+ → " "` collapse plus `trim()`
 *     are kept verbatim. Documented as a substitution, not an exact port.
 *   - `org.jsoup.Jsoup.parse(it).text()` (L180) → the local jsoup replacement
 *     (`parseHtmlDocument(it).text()` from `./parser/htmlDocument`) — same semantics.
 *   - `FormBody.Builder().add(k, v)…` → `formBodyOf(map)`.
 *   - `MD5` → `./md5` (see the file header there).
 *
 * REVIEW FIXES (this pass): the `org.json` option accessors did not reproduce org.json's
 * *coercion* rules, only its "missing key" rules. `optInt` now accepts a numeric string
 * (`"success": "1"` → 1) and `optBoolean` accepts `"true"` / `"false"`, exactly like
 * `JSONObject.optInt` / `JSON.toBoolean`; a wrong type still yields the caller's default.
 */

import { createBookFormat, type BookFormat } from '../bookFormat';
import { SourceLog } from '../sourceLog';
import { createSearchBook, type SearchBook } from '../searchBook';
import { md5Hex } from './md5';
import {
  formBodyOf,
  type ZLibraryFormField,
  type ZLibraryHttpClient,
} from './network/zLibraryHttpClient';
import { parseHtmlDocument } from './parser/htmlDocument';
import type { ZLibraryCredentialStorage } from './zLibraryCredentialStorage';

/** Kotlin `private companion object { const val TAG = "ZLibraryEapiClient" }` (L258). */
const TAG = 'ZLibraryEapiClient';

/** eapi file 接口返回：url 为 CDN 直链；disallowMessage 为每日额度限制提示。 */
export interface DownloadLinkResult {
  readonly url: string | null;
  readonly disallowMessage: string | null;
}

function createDownloadLinkResult(url: string | null, disallowMessage: string | null): DownloadLinkResult {
  return { url, disallowMessage };
}

/**
 * bipinkrish/Zlibrary-API（eapi JSON 接口）客户端。
 *
 * 已实测验证（2026-08）：
 * - POST /eapi/user/login：可用（拿到 remix_userid / remix_userkey）
 * - GET  /eapi/book/{id}/{hash}/formats：返回全部格式变体（epub/mobi/pdf/azw3/fb2/lit…）
 * - GET  /eapi/book/{id}/{hash}/file：返回 CDN downloadLink，可直接下载对应格式
 * - POST /eapi/book/search：端点正确（当前官网搜索服务全站故障，恢复后可用）
 *
 * 该客户端是 ZLibrarySource 的兜底方案：HTML 流程（rpc.php）失败时走这里。
 */
export class ZLibraryEapiClient {
  constructor(
    private readonly httpClient: ZLibraryHttpClient,
    private readonly credentialStorage: ZLibraryCredentialStorage,
  ) {}

  /** Kotlin `private suspend fun getJson(url, referer)` (L29-46). */
  private async getJson(url: string, referer: string | null = null): Promise<JsonObject | null> {
    try {
      const response = await this.httpClient.get(url, referer);
      const body = response.body;
      response.close();
      if (!response.isSuccessful) {
        SourceLog.log(TAG, `eapi GET ${response.code} ${url}`);
        return null;
      }
      return asObject(JSON.parse(body));
    } catch (e) {
      SourceLog.log(TAG, `eapi GET failed: ${url} ${errorMessage(e)}`);
      return null;
    }
  }

  /** Kotlin `private suspend fun postJson(url, fields, referer)` (L48-69). */
  private async postJson(
    url: string,
    fields: Record<string, string>,
    referer: string | null = null,
  ): Promise<JsonObject | null> {
    try {
      const formBody: ZLibraryFormField[] = formBodyOf(fields);
      const response = await this.httpClient.postForm(url, formBody, referer);
      const body = response.body;
      response.close();
      if (!response.isSuccessful) {
        SourceLog.log(TAG, `eapi POST ${response.code} ${url}`);
        return null;
      }
      return asObject(JSON.parse(body));
    } catch (e) {
      SourceLog.log(TAG, `eapi POST failed: ${url} ${errorMessage(e)}`);
      return null;
    }
  }

  /**
   * eapi 登录：成功会把 remix cookie 写入 cookieJar 并持久化。
   *  2026-09-04 修复：eapi 协议要求密码做三段 MD5 变换 md5(email:pass:md5(pass))——
   *  旧实现传明文密码，服务器返回 "Authorization failed"（实测 z-lib.is）。
   *  注意：MD5 是 zlib 服务端协议既定算法（模拟其 Web 前端混淆），非本项目自选。
   */
  async login(email: string, password: string, domain: string): Promise<boolean> {
    const md5Pass = md5Hex(password);
    const transformed = md5Hex(`${email}:${password}:${md5Pass}`);
    const json = await this.postJson(
      `https://${domain}/eapi/user/login`,
      {
        email,
        password: transformed,
        site_mode: 'books',
        action: 'login',
      },
      `https://${domain}/`,
    );
    if (json === null) return false;
    const ok = optInt(json, 'success', 0) === 1;
    if (ok) {
      const user = optObject(json, 'user');
      const uid = user === null ? null : optStringOrNull(user, 'id');
      const ukey = user === null ? null : optStringOrNull(user, 'remix_userkey');
      // cookieJar.saveFromResponse 已把 remix cookie 持久化；这里再补写 domain
      await this.credentialStorage.saveCredentials({
        userId: uid ?? (await this.credentialStorage.getUserId()),
        userKey: ukey ?? (await this.credentialStorage.getUserKey()),
        domain,
        cookies: await this.credentialStorage.getCookies(),
      });
    }
    return ok;
  }

  /** 每日下载额度：(今日已用, 上限)。查询失败返回 null，调用方不应因此阻断下载。 */
  async getDailyDownloadLimit(domain: string): Promise<[number, number] | null> {
    const json = await this.getJson(`https://${domain}/eapi/user/profile`, `https://${domain}/`);
    if (json === null) return null;
    if (optInt(json, 'success', 0) !== 1) return null;
    const user = optObject(json, 'user');
    if (user === null) return null;
    const today = optInt(user, 'downloads_today', -1);
    const limit = optInt(user, 'downloads_limit', -1);
    return today >= 0 && limit > 0 ? [today, limit] : null;
  }

  /**
   * eapi 搜索。要求已登录（bipinkrish 库同样要求登录态）。
   * 返回的 SearchBook 会携带 eapiId / eapiHash，供多格式查询使用。
   */
  async search(keyword: string, domain: string): Promise<SearchBook[]> {
    if (!(await this.credentialStorage.isLoggedIn())) return [];
    const json = await this.postJson(
      `https://${domain}/eapi/book/search`,
      { message: keyword, limit: '30' },
      `https://${domain}/`,
    );
    if (json === null) return [];
    if (optInt(json, 'success', 0) !== 1) return [];
    const booksArr = optArray(json, 'books');
    if (booksArr === null) return [];
    const result: SearchBook[] = [];
    for (const item of booksArr) {
      const b = asObject(item);
      if (b === null) continue;
      const bookUrl = optString(b, 'url', '');
      if (bookUrl.trim() === '') continue;
      const eapiId = optString(b, 'id', '');
      const eapiHash = optString(b, 'hash', '');
      if (eapiId.trim() === '' || eapiHash.trim() === '') continue;
      const cover = emptyToNull(optString(b, 'cover', ''));
      const dl = emptyToNull(optString(b, 'dl', ''));
      const filesize = optInt(b, 'filesize', 0);
      result.push(
        createSearchBook({
          id: trimStartSlash(bookUrl),
          sourceId: 'zlibrary',
          title: optString(b, 'title', '未知书名'),
          author: optString(b, 'author', '未知作者'),
          cover,
          format: optString(b, 'extension', 'epub').toLowerCase(),
          language: emptyToNull(optString(b, 'language', '')),
          size: filesize > 0 ? filesize : null,
          downloadUrl: dl === null ? null : dl.startsWith('http') ? dl : `https://${domain}${dl}`,
          eapiId,
          eapiHash,
        }),
      );
    }
    return result;
  }

  /** eapi 书信息（HTML 详情页不可用时兜底）。 */
  async getBookInfo(eapiId: string, eapiHash: string, domain: string): Promise<SearchBook | null> {
    const json = await this.getJson(
      `https://${domain}/eapi/book/${eapiId}/${eapiHash}`,
      `https://${domain}/`,
    );
    if (json === null) return null;
    if (optInt(json, 'success', 0) !== 1) return null;
    const b = optObject(json, 'book');
    if (b === null) return null;
    const dl = emptyToNull(optString(b, 'dl', ''));
    const description = optString(b, 'description', '');
    return createSearchBook({
      id: trimStartSlash(optString(b, 'url', `/book/${eapiId}/${eapiHash}`)),
      sourceId: 'zlibrary',
      title: optString(b, 'title', '未知书名'),
      author: optString(b, 'author', '未知作者'),
      cover: emptyToNull(optString(b, 'cover', '')),
      format: optString(b, 'extension', 'epub').toLowerCase(),
      language: emptyToNull(optString(b, 'language', '')),
      description:
        description.trim() !== '' ? parseHtmlDocument(description).text() : null,
      downloadUrl: dl === null ? null : dl.startsWith('http') ? dl : `https://${domain}${dl}`,
      eapiId,
      eapiHash,
    });
  }

  /** 某本书全部可用格式（epub/mobi/pdf/azw3/fb2/lit/txt…），每个格式一个变体。 */
  async getFormats(eapiId: string, eapiHash: string, domain: string): Promise<BookFormat[]> {
    const json = await this.getJson(
      `https://${domain}/eapi/book/${eapiId}/${eapiHash}/formats`,
      `https://${domain}/`,
    );
    if (json === null) return [];
    if (optInt(json, 'success', 0) !== 1) return [];
    const arr = optArray(json, 'books');
    if (arr === null) return [];
    const seen = new Map<string, BookFormat>();
    for (const item of arr) {
      const v = asObject(item);
      if (v === null) continue;
      const ext = optString(v, 'extension', '').toLowerCase();
      if (ext.trim() === '') continue;
      const filesize = optInt(v, 'filesize', 0);
      if (!seen.has(ext)) {
        seen.set(
          ext,
          createBookFormat({
            format: ext,
            size: filesize > 0 ? filesize : null,
            sizeText: emptyToNull(optString(v, 'filesizeString', '')),
            eapiId: emptyToNull(optString(v, 'id', '')),
            eapiHash: emptyToNull(optString(v, 'hash', '')),
          }),
        );
      }
    }
    return Array.from(seen.values());
  }

  /** 取某格式变体的 CDN 下载直链（可带 Cookie 直接下载）。 */
  async getDownloadLink(eapiId: string, eapiHash: string, domain: string): Promise<string | null> {
    return (await this.getDownloadLinkResult(eapiId, eapiHash, domain)).url;
  }

  /** eapi file 接口结果：CDN 直链；每日下载额度用尽时返回明确的限制文案。 */
  async getDownloadLinkResult(
    eapiId: string,
    eapiHash: string,
    domain: string,
  ): Promise<DownloadLinkResult> {
    const json = await this.getJson(
      `https://${domain}/eapi/book/${eapiId}/${eapiHash}/file`,
      `https://${domain}/`,
    );
    if (json === null) return createDownloadLinkResult(null, null);
    if (optInt(json, 'success', 0) !== 1) return createDownloadLinkResult(null, null);
    const file = optObject(json, 'file');
    if (file === null) return createDownloadLinkResult(null, null);

    // 每日下载额度用尽：服务器返回 allowDownload=false + disallowDownloadMessage（HTML 富文本）
    if (optBoolean(file, 'allowDownload', true) === false) {
      const raw = optString(file, 'disallowDownloadMessage', '');
      const clean = htmlToText(raw).replace(/\s+/g, ' ').trim();
      return createDownloadLinkResult(
        null,
        clean === '' ? '今日下载次数已达上限，请等待额度重置或提升下载额度' : clean,
      );
    }

    const raw = emptyToNull(optString(file, 'downloadLink', ''));
    // 部分 CDN 链接是协议相对（//dln1.…）或裸路径，OkHttp 会报
    // "Expected URL scheme 'http' or 'https'"，这里统一补全 scheme
    const normalized =
      raw === null
        ? null
        : raw.startsWith('//')
          ? `https:${raw}`
          : raw.startsWith('/')
            ? `https://${domain}${raw}`
            : raw;
    return createDownloadLinkResult(normalized, null);
  }
}

// ---------------------------------------------------------------------------
// `org.json` option accessors, reproduced with org.json's default semantics
// (a missing key, a JSON null, or a wrong type all yield the supplied default).
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/**
 * Kotlin `org.json.JSONObject.optInt(name, fallback)`: a `Number` is truncated to an int, and
 * anything else is parsed with `Integer.parseInt(object.toString())`; only a parse failure
 * (absent key, JSON null, a non-numeric string) yields the fallback. The port previously
 * accepted numbers only, so `"success": "1"` (which the server may emit) fell through to the
 * fallback and the caller saw a failed request.
 */
function optInt(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && /^[+-]?\d+$/.test(value.trim())) return parsed;
  }
  return fallback;
}

function optString(obj: JsonObject, key: string, fallback: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : fallback;
}

function optStringOrNull(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function optObject(obj: JsonObject, key: string): JsonObject | null {
  return asObject(obj[key]);
}

function optArray(obj: JsonObject, key: string): unknown[] | null {
  const value = obj[key];
  return Array.isArray(value) ? value : null;
}

/**
 * Kotlin `org.json.JSONObject.optBoolean(name, fallback)` → `JSON.toBoolean`, which coerces the
 * strings "true"/"false" (any case) and returns the fallback for everything else (including an
 * explicit JSON null). The port previously accepted real booleans only, so `"allowDownload":
 * "false"` was treated as "allowed".
 */
function optBoolean(obj: JsonObject, key: string, fallback: boolean): boolean {
  const value = obj[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}

/** Kotlin `String.ifBlank { null }`. */
function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}

/** Kotlin `String.trimStart('/')` — every leading occurrence. */
function trimStartSlash(value: string): string {
  let out = value;
  while (out.startsWith('/')) out = out.slice(1);
  return out;
}

/**
 * `android.text.Html.fromHtml(raw, FROM_HTML_MODE_LEGACY).toString()` — the legacy
 * (non-flavoured) path is plain text + `<br>`/block breaks + entity decoding. There is no
 * JS/Android-free equivalent of the Android class, so the minimal behaviour the eapi
 * `disallowDownloadMessage` needs is reproduced here.
 */
function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_hit, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

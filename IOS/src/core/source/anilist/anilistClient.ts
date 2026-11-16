/**
 * Android `com.example.source.anilist.AniListClient.kt` (129 lines, 120 non-blank)
 * → `src/core/source/anilist/anilistClient.ts`.
 *
 * Kotlin class KDoc (lines 15-26), verbatim:
 * ```
 * AniList GraphQL 标题数据客户端（第七轮第 7 条）。
 *
 * AniList 在本项目中只扮演"标题数据提供者"——按 media id 游标增量拉取
 * MANGA 类型作品的多语言标题（romaji / english / native / synonyms），
 * 不作为书源、不实时参与搜索（搜索只查本地库）。
 *
 * 网络层约定（规范第 9/12 点）：
 * - 任何网络异常 / 限流 / 超时 / 响应畸形都以 null / 空结果返回，
 *   绝不让异常外溢影响书库搜索链路；
 * - id_greater 游标分页：断点续传安全、重放幂等（配合 DAO IGNORE 策略）。
 * ```
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-14     package/imports                       → header + imports
 *   15-26    class KDoc                            → header block (verbatim)
 *   27-29    class + client                        → AniListClient + injected client
 *   30-33    companion ENDPOINT / PER_PAGE         → consts
 *   34-38    defaultClient()                       → injected client / createFetchSourceHttpClient()
 *   39       JSON media type                       → ANILIST_JSON_MEDIA_TYPE
 *   41-52    QUERY                                 → ANILIST_CURSOR_QUERY
 *   54-67    POPULAR_QUERY                         → ANILIST_POPULAR_QUERY
 *   70-74    fetchPageAfter()                      → fetchPageAfter()
 *   76-77    fetchPopularPage()                    → fetchPopularPage()
 *   79-128   fetch()                               → fetch()
 *
 * Skipped lines / adaptations:
 *   - `withContext(Dispatchers.IO)` dropped (JS has no thread switch).
 *   - `runCatching { … }.getOrElse { currentCoroutineContext().ensureActive(); null }`
 *     → `runCatchingAsync`. The Kotlin arm re-throws a `CancellationException`
 *     (so cancellation is never swallowed) and returns `null` for everything
 *     else; the port rethrows `AbortError`/`SourceNetworkError` only when an
 *     abort signal was supplied, otherwise it returns `null` exactly like the
 *     Kotlin `getOrElse`.
 *   - `response.isSuccessful` / `response.code` → `res.status`.
 *   - `readImportBytes(2*1024*1024)` → the shared `readBounded` bound check in
 *     `../impl/sourceHttp`.
 *   - `optString(key, null)?.takeUnless { it.isNullOrEmpty() || it == "null" }`
 *     → `nullableTitle()` in `jsonSupport` terms; the `"null"` sentinel check is
 *     preserved because AniList returns the JSON null for missing translations.
 *   - `JSONObject`/`JSONArray` navigation → the `org.json` subset in
 *     `../impl/jsonSupport`.
 *   - `Dispatchers`, `okhttp3.*`, `java.util.concurrent.TimeUnit` → the injected
 *     `HttpClient` (the timeout bag is the platform client's concern).
 */

import type { AniListSyncPage, AniListMediaTitles } from './anilistModels';
import {
  arrayOptJsonObject,
  arrayOptString,
  isNullOrEmpty,
  optJsonArray,
  optJsonObject,
  optInt,
  optString,
  parseJsonObjectOrThrow,
} from '../impl/jsonSupport';
import {
  MAX_SOURCE_BODY_BYTES,
  decodeUtf8,
  executeSourceRequest,
  isSuccessful,
  resolveHttpClient,
} from '../impl/sourceHttp';
import type { HttpClient } from '../impl/sourceHttp';

/** Kotlin `companion object { const val ENDPOINT }`. */
export const ENDPOINT = 'https://graphql.anilist.co';
/** Kotlin `companion object { const val PER_PAGE = 50 }`. */
export const PER_PAGE = 50;

/** Kotlin `private val JSON = "application/json; charset=utf-8".toMediaType()`. */
const ANILIST_JSON_MEDIA_TYPE = 'application/json; charset=utf-8';

/** Kotlin `private val QUERY` (trimIndent applied). */
const ANILIST_CURSOR_QUERY = `query ($cursor: Int, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: MANGA, id_greater: $cursor, sort: ID, isAdult: false) {
      id
      title { romaji english native }
      synonyms
    }
  }
}`;

/**
 * 第九轮：热门优先分页查询（POPULARITY_DESC + 页码游标）——
 *  首个同步会话即覆盖最热门作品，本地标题库从第一天起对常见搜索可用。
 */
const ANILIST_POPULAR_QUERY = `query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
      id
      title { romaji english native }
      synonyms
    }
  }
}`;

export class AniListClient {
  private readonly http: HttpClient;

  constructor(options: { client?: HttpClient | null } = {}) {
    this.http = resolveHttpClient(options.client ?? null);
  }

  /**
   * 拉取 id 大于 [cursor] 的一页标题数据。
   * @return null = 网络/解析失败（调用方安全跳过）；空 media = 已同步到末尾
   */
  async fetchPageAfter(cursor: number): Promise<AniListSyncPage | null> {
    return this.fetch(ANILIST_CURSOR_QUERY, 'cursor', cursor);
  }

  /** 第九轮：按热度排名拉取第 [page] 页（页码从 1 起）。游标语义 = 页码。 */
  async fetchPopularPage(page: number): Promise<AniListSyncPage | null> {
    return this.fetch(ANILIST_POPULAR_QUERY, 'page', page);
  }

  private async fetch(
    query: string,
    variableName: string,
    value: number,
  ): Promise<AniListSyncPage | null> {
    const box = await runCatchingAsync(async () => {
      const body = JSON.stringify({
        query,
        variables: {
          [variableName]: value,
          perPage: PER_PAGE,
        },
      });
      const request = {
        method: 'POST' as const,
        headers: {
          Accept: 'application/json',
          'Content-Type': ANILIST_JSON_MEDIA_TYPE,
        },
        body,
        maxBytes: MAX_SOURCE_BODY_BYTES,
      };
      const response = await executeSourceRequest(this.http, ENDPOINT, request);
      if (!isSuccessful(response)) return null;
      if (response.body.byteLength === 0) return null;
      const root = parseJsonObjectOrThrow(decodeUtf8(response.body));
      const page = optJsonObject(optJsonObject(root, 'data'), 'Page');
      if (page == null) return null;
      const hasMore = optJsonObject(page, 'pageInfo')?.['hasNextPage'] === true;
      const mediaArray = optJsonArray(page, 'media');
      if (mediaArray == null) return { media: [], hasMore: false };
      const media: AniListMediaTitles[] = [];
      for (let i = 0; i < mediaArray.length; i += 1) {
        const item = arrayOptJsonObject(mediaArray, i);
        if (item == null) continue;
        const id = optInt(item, 'id', -1);
        if (id <= 0) continue;
        const title = optJsonObject(item, 'title');
        const synonymsArray = optJsonArray(item, 'synonyms');
        const synonyms: string[] = [];
        if (synonymsArray != null) {
          for (let k = 0; k < synonymsArray.length; k += 1) {
            const value2 = arrayOptString(synonymsArray, k, '');
            if (value2 != null && value2.trim() !== '') synonyms.push(value2);
          }
        }
        media.push({
          mediaId: id,
          romaji: nullableTitle(optString(title, 'romaji', null)),
          english: nullableTitle(optString(title, 'english', null)),
          native: nullableTitle(optString(title, 'native', null)),
          synonyms,
        });
      }
      return { media, hasMore };
    });
    if (box.ok) return box.value;
    // Kotlin `getOrElse { currentCoroutineContext().ensureActive(); null }`:
    // cancellation still propagates; every other failure is swallowed.
    if (isCancellation(box.error)) throw box.error;
    return null;
  }
}

/**
 * Kotlin `title?.optString(key, null)?.takeUnless { it.isNullOrEmpty() || it == "null" }`.
 * AniList returns the JSON `null` for missing translations, so the org.json
 * optString default never fires and the literal `"null"` must be filtered.
 */
function nullableTitle(raw: string | null): string | null {
  if (raw == null) return null;
  if (isNullOrEmpty(raw) || raw === 'null') return null;
  return raw;
}

/** A `CancellationException` / abort must never be swallowed (Kotlin: `ensureActive`). */
function isCancellation(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError';
  return error instanceof Error && error.name === 'AbortError';
}

interface ResultBox<T> {
  readonly ok: boolean;
  readonly value: T;
  readonly error: unknown;
}

async function runCatchingAsync<T>(block: () => Promise<T>): Promise<ResultBox<T>> {
  try {
    return { ok: true, value: await block(), error: null };
  } catch (e) {
    return { ok: false, value: undefined as T, error: e };
  }
}
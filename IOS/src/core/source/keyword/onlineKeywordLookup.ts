/**
 * Android `com.example.source.keyword.OnlineKeywordLookup.kt` (288 lines, 277 non-blank)
 * → `src/core/source/keyword/onlineKeywordLookup.ts`.
 *
 * Kotlin class KDoc (line 30), verbatim:
 * `Structured labels and aliases only. No translation, scraping, or source-specific syntax.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-29     package/imports                            → header + imports
 *   30       class KDoc                                 → header comment (verbatim)
 *   31-40    class ctor defaults                        → OnlineKeywordLookupOptions
 *   41-51    `httpClient()` + `proxyClient`/`lastProxy`  → single injected client (see skips)
 *   52       cooldowns ConcurrentHashMap                 → `cooldowns` Map
 *   53       class Unavailable(reason)                   → `Unavailable`
 *   54-62    failureReason(e)                            → failureReason()
 *   64       bangumiSlots Semaphore(2)                   → `Semaphore(2)`
 *   65       class Ambiguous                             → `Ambiguous`
 *   67-72    lookup()                                   → lookup()
 *   74-113   stream(): Flow<OnlineKeywordResult>         → stream() async generator
 *   115-136  json(request)                              → json()
 *   138-140  wikiUrl(action)                             → wikiUrl()
 *   142-183  wikidata(input)                             → wikidata()
 *   185-215  bangumi(input, resource, known)             → bangumi()
 *   217-246  bangumiNames(detail)                        → bangumiNames()
 *   248-287  anilist(concept)                            → anilist()
 *
 * Skipped lines / adaptations:
 *   - OkHttp `Request` → the local `SourceRequest` record
 *     (`{url, method, headers, body}`); `executeCancellable()` →
 *     `executeSourceRequest()`. `HttpUrl.newBuilder().addQueryParameter(…)` →
 *     `buildUrl(base, [], params)`.
 *   - `channelFlow { … }` → `AsyncGenerator`; `send(…)` → a push into an
 *     unbounded `KeywordQueue` drained by the generator, so a provider's result
 *     is yielded as soon as it is produced (same as `send`).
 *   - `launch(start = CoroutineStart.LAZY)` → deferred registration: every
 *     provider is registered first and started together at the end, matching
 *     `pending.values.forEach { it.start() }` (line 112).
 *   - `job.cancel()` → the provider's `AbortSignal`; `json()` accepts the shared
 *     signal, so cancellation lands at the same cooperative points (network I/O).
 *   - `AtomicBoolean.compareAndSet(false, true)` (line 93) → a plain boolean
 *     flag; JS is single-threaded so the CAS is equivalent.
 *   - `ConcurrentHashMap` → `Map` (same single-threaded guarantee).
 *   - `SystemProxyResolver` + `Context` (lines 41-51) → the caller injects a
 *     client already configured with the system proxy; OkHttp's `proxy()` has no
 *     JS counterpart. The `proxyClient` cache therefore collapses into the one
 *     injected client. This is a real simplification and is documented here
 *     rather than faked.
 *   - `java.net.UnknownHostException / SocketTimeoutException / InterruptedIOException
 *     / SSLException / ConnectException / JSONException` dispatch (lines 54-62)
 *     → `failureKind()` inspects the injected client's error `name`/`code`/`cause`
 *     chain. Every user-visible message is preserved verbatim, and anything
 *     unrecognised falls through to "资料服务连接失败" exactly like `else ->`.
 *   - `org.json` navigation → the `org.json` subset in `../impl/jsonSupport`.
 *   - `sortedBy { … }`, `distinctBy { … }`, `distinct()`, `minOfOrNull`,
 *     `firstNotNullOfOrNull` keep their semantics via explicit stable helpers.
 */

import type {
  KeywordConcept,
  KeywordName,
  OnlineKeywordResult,
} from './keywordModels';
import {
  complete,
  kindOf,
  language,
  match,
  merge,
  rank as personRank,
} from './keywordModels';
import {
  arrayOptJsonObject,
  arrayOptString,
  optJsonArray,
  optJsonObject,
  optString,
} from '../impl/jsonSupport';
import type { JsonObject, JsonValue } from '../impl/jsonSupport';
import {
  MAX_METADATA_BODY_BYTES,
  buildUrl,
  decodeUtf8,
  executeSourceRequest,
  headerOf,
  resolveHttpClient,
} from '../impl/sourceHttp';
import type { HttpClient, SourceRequestInit } from '../impl/sourceHttp';

/** Structured labels and aliases only. No translation, scraping, or source-specific syntax. */

const DEFAULT_WIKI_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const DEFAULT_BANGUMI_ENDPOINT = 'https://api.bgm.tv/v0/';
const DEFAULT_ANILIST_ENDPOINT = 'https://graphql.anilist.co';

/** Kotlin `private class Unavailable(val reason: String = "资料服务暂不可用")`. */
export class Unavailable extends Error {
  constructor(reason = '资料服务暂不可用') {
    super(reason);
    this.name = 'Unavailable';
  }
}

/** Kotlin `private class Ambiguous : Exception()`. */
export class Ambiguous extends Error {
  constructor() {
    super('ambiguous');
    this.name = 'Ambiguous';
  }
}

export interface OnlineKeywordLookupOptions {
  /** Kotlin `client: OkHttpClient = SharedHttpTransport.builder()…build()`. */
  readonly client?: HttpClient | null;
  /** Kotlin `wikiEndpoint: String = "https://www.wikidata.org/w/api.php"`. */
  readonly wikiEndpoint?: string;
  /** Kotlin `bangumiEndpoint: String = "https://api.bgm.tv/v0/"`. */
  readonly bangumiEndpoint?: string;
  /** Kotlin `now: () -> Long = System::currentTimeMillis`. */
  readonly now?: () => number;
  /** Kotlin `aniListEndpoint: String = "https://graphql.anilist.co"`. */
  readonly aniListEndpoint?: string;
}

/** Kotlin's minimal `{ url, method?, headers?, body? }` request carrier. */
interface SourceRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export class OnlineKeywordLookup {
  private readonly client: HttpClient;
  private readonly wikiEndpoint: string;
  private readonly bangumiEndpoint: string;
  private readonly aniListEndpoint: string;
  private readonly now: () => number;
  /** Kotlin `private val cooldowns = ConcurrentHashMap<String, Long>()`. */
  private readonly cooldowns = new Map<string, number>();
  /** Kotlin `private val bangumiSlots = Semaphore(2)`. */
  private readonly bangumiSlots = new Semaphore(2);
  /** Shared cancellation for the provider tasks of one `stream()` call. */
  private readonly abort = new AbortController();

  constructor(options: OnlineKeywordLookupOptions = {}) {
    this.client = resolveHttpClient(options.client ?? null);
    this.wikiEndpoint = options.wikiEndpoint ?? DEFAULT_WIKI_ENDPOINT;
    this.bangumiEndpoint = options.bangumiEndpoint ?? DEFAULT_BANGUMI_ENDPOINT;
    this.now = options.now ?? Date.now;
    this.aniListEndpoint = options.aniListEndpoint ?? DEFAULT_ANILIST_ENDPOINT;
  }

  /** Compatibility helper. Failed providers are never interpreted as negative evidence. */
  async lookup(input: string): Promise<KeywordConcept[] | null> {
    const updates: OnlineKeywordResult[] = [];
    for await (const update of this.stream(input, [])) updates.push(update);
    const concepts = merge(updates.flatMap((it) => it.concepts));
    if (
      concepts.length === 0 &&
      updates.some((u) => u.states.some((it) => it.outcome === 'failed'))
    ) {
      return null;
    }
    return concepts;
  }

  /**
   * Kotlin `fun stream(input, known, skip): Flow<OnlineKeywordResult>` (lines
   * 74-113). Providers are registered first (`CoroutineStart.LAZY` in Kotlin) and
   * started together at the end; a complete entity cancels the others.
   */
  async *stream(
    input: string,
    known: KeywordConcept[],
    skip: ReadonlySet<string> = new Set<string>(),
  ): AsyncGenerator<OnlineKeywordResult, void, void> {
    const outbox = new KeywordQueue();
    /** Kotlin `private val pending = ConcurrentHashMap<String, Job>()`. */
    const pending = new Map<string, Promise<void>>();
    let bridgeStarted = false;

    /** Kotlin `suspend fun runProvider(id, call)` including its `send(...)`. */
    const runProvider = async (
      id: string,
      call: () => Promise<KeywordConcept[]>,
    ): Promise<KeywordConcept[]> => {
      if (skip.has(id)) return [];
      let outcome = 'found';
      let detail = '';
      let names: KeywordConcept[];
      try {
        names = await call();
      } catch (e) {
        if (e instanceof Ambiguous) {
          outcome = 'ambiguous';
          names = [];
        } else {
          outcome = 'failed';
          detail = failureReason(e);
          names = [];
        }
      }
      if (names.length === 0 && outcome === 'found') outcome = 'empty';
      const delay =
        outcome === 'found'
          ? 6 * 60 * 60_000
          : outcome === 'empty'
            ? 10 * 60_000
            : outcome === 'ambiguous'
              ? 60 * 60_000
              : 60_000;
      await outbox.push({
        concepts: names,
        states: [{ provider: id, outcome, retryAt: this.now() + delay, detail }],
        cached: false,
        persisted: false,
      });
      if (complete(names)) {
        for (const otherId of [...pending.keys()]) {
          if (otherId !== id) this.abort.abort();
        }
      }
      return names;
    };

    /** Kotlin `fun bridge(concepts)` — AniList, started once, for a verified entity. */
    const bridge = (concepts: KeywordConcept[]): void => {
      const target = concepts.find((it) => {
        const kind = kindOf(it);
        return kind === 'work' || kind === 'character' || kind === 'person';
      });
      if (target == null) return;
      if (skip.has('anilist') || bridgeStarted) return;
      bridgeStarted = true;
      const chosen = target as KeywordConcept;
      pending.set(
        'anilist',
        (async () => {
          await runProvider('anilist', () => this.anilist(chosen));
        })(),
      );
    };

    /** Kotlin `pending[id] = launch(start = CoroutineStart.LAZY) { … }`. */
    const register = (id: string, body: () => Promise<void>): void => {
      pending.set(id, body());
    };

    register('wikidata', async () => {
      await runProvider('wikidata', () => this.wikidata(input));
    });

    const kinds = [...new Set(known.map((it) => kindOf(it)).filter((it) => it !== 'unknown'))];
    const resources: string[] =
      kinds.length === 0 || kinds.includes('common')
        ? []
        : kinds.length === 1 && kinds[0] === 'character'
          ? ['characters']
          : kinds.length === 1 && kinds[0] === 'person'
            ? ['persons']
            : kinds.length === 1 && kinds[0] === 'work'
              ? ['subjects']
              : ['characters', 'persons', 'subjects'];

    for (const resource of resources) {
      register(`bangumi:${resource}`, async () => {
        const found = await runProvider(`bangumi:${resource}`, () =>
          this.bangumi(input, resource, known),
        );
        if (found.length > 0 && !complete(found)) bridge(found);
      });
    }
    bridge(known);

    // Kotlin line 112: `pending.values.forEach { it.start() }` — the channel
    // closes once every registered task settles.
    const done = Promise.all([...pending.values()]).then(() => {
      outbox.close();
    });
    for (;;) {
      const next = await outbox.shift();
      if (next === null) break;
      yield next;
    }
    await done;
  }

  // -------------------------------------------------------------------------
  // Kotlin 115-136 json()
  // -------------------------------------------------------------------------

  private async json(request: SourceRequest): Promise<JsonObject> {
    const host = hostOf(request.url);
    const cooldown = this.cooldowns.get(host);
    if (cooldown !== undefined && cooldown > this.now()) {
      throw new Unavailable('资料服务限流，请稍后重试');
    }
    const execute = async (): Promise<JsonObject> => {
      const headers: Record<string, string> = {
        'User-Agent':
          'CialloReader/1.2 (https://github.com/roxycon-dev/Ciallo-Reader; keyword metadata)',
        Accept: 'application/json',
        ...(request.headers ?? {}),
      };
      const init: SourceRequestInit = { headers, maxBytes: MAX_METADATA_BODY_BYTES };
      if (request.method !== undefined) init.method = request.method;
      if (request.body !== undefined) init.body = request.body;
      if (request.signal !== undefined) init.signal = request.signal;
      const response = await executeSourceRequest(this.client, request.url, init);
      if (response.status === 429 || response.status === 503) {
        const retryAfter = headerOf(response, 'Retry-After');
        const seconds = clamp(
          retryAfter != null && /^\d+$/.test(retryAfter.trim())
            ? Number.parseInt(retryAfter.trim(), 10)
            : 300,
          1,
          86_400,
        );
        this.cooldowns.set(host, this.now() + seconds * 1_000);
        throw new Unavailable(`HTTP ${response.status}，资料服务暂时限流`);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Unavailable(`HTTP ${response.status}`);
      }
      if (response.body.byteLength === 0) throw new Unavailable();
      const text = decodeUtf8(response.body);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Kotlin `JSONObject(text)` throws JSONException, classified as 异常数据.
        throw new SyntaxError('Unexpected token in JSON');
      }
      if (!isJsonObject(parsed)) throw new Unavailable();
      if (parsed['error'] !== undefined || parsed['errors'] !== undefined) {
        throw new Unavailable();
      }
      return parsed;
    };
    // Only server rate limits suppress the whole host. A bad detail or one
    // resource's HTTP error must not poison other Bangumi lookups.
    return host === hostOf(this.bangumiEndpoint)
      ? this.bangumiSlots.withPermit(execute)
      : execute();
  }

  /** Kotlin `private fun wikiUrl(action: String)` (lines 138-140). */
  private wikiUrl(action: string): string {
    return buildUrl(this.wikiEndpoint, [], [
      ['action', action],
      ['format', 'json'],
      ['maxlag', '5'],
    ]);
  }

  // -------------------------------------------------------------------------
  // Kotlin 142-183 wikidata()
  // -------------------------------------------------------------------------

  private async wikidata(input: string): Promise<KeywordConcept[]> {
    const searchUrl = buildUrl(this.wikiUrl('wbsearchentities'), [], [
      ['search', input],
      ['language', 'zh'],
      ['uselang', 'zh'],
      ['type', 'item'],
      ['limit', '5'],
    ]);
    const searchResponse = await this.json({ url: searchUrl, signal: this.abort.signal });
    const results = optJsonArray(searchResponse, 'search');
    if (results == null) throw new Unavailable();
    const key = match(input);
    const ids: string[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const item = arrayOptJsonObject(results, i);
      if (item == null) continue;
      const label = optString(item, 'label', '') ?? '';
      const matched = optString(optJsonObject(item, 'match'), 'text', '') ?? '';
      const id = optString(item, 'id', '') ?? '';
      if (!/^Q[0-9]+$/.test(id)) continue;
      if (match(label) !== key && match(matched) !== key) continue;
      if (!ids.includes(id)) ids.push(id);
    }
    const taken = ids.slice(0, 3);
    if (taken.length === 0) return [];
    const entitiesUrl = buildUrl(this.wikiUrl('wbgetentities'), [], [
      ['ids', taken.join('|')],
      ['props', 'labels|aliases'],
      ['languages', 'zh|zh-hans|zh-hant|en|ja'],
    ]);
    const entitiesResponse = await this.json({ url: entitiesUrl, signal: this.abort.signal });
    const entities = optJsonObject(entitiesResponse, 'entities');
    if (entities == null) throw new Unavailable();
    const verified: KeywordConcept[] = [];
    for (const id of taken) {
      const entity = optJsonObject(entities, id);
      if (entity == null) continue;
      const names: KeywordName[] = [];
      for (const lang of ['en', 'ja', 'zh', 'zh-hans', 'zh-hant']) {
        const normalizedLang = lang.startsWith('zh') ? 'zh' : lang;
        const labelValue = optString(
          optJsonObject(optJsonObject(entity, 'labels'), lang),
          'value',
          '',
        );
        if (labelValue != null && labelValue.trim() !== '') {
          names.push({ text: labelValue, language: normalizedLang });
        }
        const aliases = optJsonArray(optJsonObject(entity, 'aliases'), lang);
        if (aliases == null) continue;
        const limit = Math.min(aliases.length, 32);
        for (let i = 0; i < limit; i += 1) {
          const value = optString(arrayOptJsonObject(aliases, i), 'value', '');
          if (value != null && value.trim() !== '') {
            names.push({ text: value, language: normalizedLang });
          }
        }
      }
      const distinct = dedupeNames(names).filter((it) => it.text.length <= 160);
      // Confirm the Chinese name against the entity itself, not just search ranking.
      const confirmed = distinct.some((it) => it.language === 'zh' && match(it.text) === key);
      if (!confirmed) continue;
      verified.push({ id: `wikidata:${id}`, names: distinct, source: 'Wikidata (CC0)' });
    }
    if (verified.length > 1) throw new Ambiguous();
    return verified;
  }

  // -------------------------------------------------------------------------
  // Kotlin 185-215 bangumi()
  // -------------------------------------------------------------------------

  private async bangumi(
    input: string,
    resource: string,
    known: KeywordConcept[],
  ): Promise<KeywordConcept[]> {
    const body: Record<string, JsonValue> = { keyword: input, filter: {} };
    if (resource === 'subjects') body['sort'] = 'match';
    const searchUrl = buildUrl(this.bangumiEndpoint, [`search/${resource}`], [
      ['limit', '5'],
      ['offset', '0'],
    ]);
    const response = await this.json({
      url: searchUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    });
    const data = optJsonArray(response, 'data');
    if (data == null) throw new Unavailable();
    const keys = new Set<string>([
      match(input),
      ...known.flatMap((it) => it.names).map((it) => match(it.text)),
    ]);
    const rows: JsonObject[] = [];
    for (let i = 0; i < data.length; i += 1) {
      const row = arrayOptJsonObject(data, i);
      if (row != null) rows.push(row);
    }
    // Fetch aliases even when a Chinese search hit's display name is Japanese.
    const ranked = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const score = (row: JsonObject): number => {
          const candidates = [
            optString(row, 'name', '') ?? '',
            optString(row, 'name_cn', '') ?? '',
          ];
          return candidates.some((name) => keys.has(match(name))) ? 0 : 1;
        };
        const diff = score(a.row) - score(b.row);
        return diff !== 0 ? diff : a.index - b.index;
      })
      .map((it) => it.row)
      .slice(0, resource === 'subjects' ? 3 : 5);
    const verified: Array<[number, KeywordConcept]> = [];
    for (const row of ranked) {
      const id = optIntLike(row, 'id');
      if (id <= 0) continue;
      // Current character/person search responses already include infobox
      // aliases. Use them directly instead of spending more round trips.
      const detail =
        row['infobox'] !== undefined && row['infobox'] !== null
          ? row
          : await this.json({
              url: buildUrl(this.bangumiEndpoint, [`${resource}/${id}`]),
              signal: this.abort.signal,
            });
      const names = bangumiNames(detail);
      const rankValue = personRank(names, keys, resource !== 'subjects');
      if (rankValue === null) continue;
      const kind =
        resource === 'subjects' ? 'subject' : resource === 'characters' ? 'character' : 'person';
      verified.push([rankValue, { id: `bangumi:${kind}:${id}`, names, source: 'Bangumi' }]);
    }
    let bestRank: number | null = null;
    for (const [rankValue] of verified) {
      if (bestRank === null || rankValue < bestRank) bestRank = rankValue;
    }
    if (bestRank === null) return [];
    const seenIds = new Set<string>();
    const matches: KeywordConcept[] = [];
    for (const [rankValue, concept] of verified) {
      if (rankValue !== bestRank) continue;
      if (seenIds.has(concept.id)) continue;
      seenIds.add(concept.id);
      matches.push(concept);
    }
    if (matches.length > 1) throw new Ambiguous();
    return matches;
  }

  // -------------------------------------------------------------------------
  // Kotlin 248-287 anilist()
  // -------------------------------------------------------------------------

  /** Only verified aliases bridge to AniList; a top-ranked unrelated result is insufficient. */
  private async anilist(concept: KeywordConcept): Promise<KeywordConcept[]> {
    const bridgeLanguages = new Set(['ja', 'native', 'romaji', 'latin', 'en']);
    const ordered = concept.names
      .map((name, index) => ({
        name,
        index,
        rank: name.language === 'ja' || name.language === 'native' ? 0 : 1,
      }))
      .filter((it) => bridgeLanguages.has(it.name.language))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
      .map((it) => it.name);
    const distinctTexts: string[] = [];
    for (const it of ordered) {
      if (!distinctTexts.includes(it.text)) distinctTexts.push(it.text);
    }
    const terms = distinctTexts.slice(0, 2);
    const keys = new Set(concept.names.map((it) => match(it.text)));
    const kind = kindOf(concept);
    const field =
      kind === 'work'
        ? 'media'
        : kind === 'character'
          ? 'characters'
          : kind === 'person'
            ? 'staff'
            : null;
    if (field === null) return [];
    const selection =
      kind === 'work'
        ? 'id title { english native romaji } synonyms'
        : 'id name { full native alternative }';
    for (const term of terms) {
      const query = `query ($search: String) { Page(perPage: 5) { ${field}(search: $search) { ${selection} } } }`;
      const response = await this.json({
        url: this.aniListEndpoint,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: term } }),
        signal: this.abort.signal,
      });
      const page = optJsonObject(optJsonObject(response, 'data'), 'Page');
      if (page == null) throw new Unavailable();
      const rows = optJsonArray(page, field);
      if (rows == null) throw new Unavailable();
      const matches: KeywordConcept[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = arrayOptJsonObject(rows, i);
        if (row == null) continue;
        const collected: KeywordName[] = [];
        const add = (text: string | null, lang: string): void => {
          if (text != null && text.trim() !== '' && text !== 'null') {
            collected.push({ text, language: lang });
          }
        };
        if (kind === 'work') {
          const title = optJsonObject(row, 'title');
          if (title == null) continue;
          add(optString(title, 'english', ''), 'en');
          add(optString(title, 'native', ''), 'native');
          add(optString(title, 'romaji', ''), 'romaji');
          const aliases = optJsonArray(row, 'synonyms');
          if (aliases != null) {
            const limit = Math.min(aliases.length, 32);
            for (let j = 0; j < limit; j += 1) {
              add(arrayOptString(aliases, j, ''), 'alias');
            }
          }
        } else {
          const name = optJsonObject(row, 'name');
          if (name == null) continue;
          add(optString(name, 'full', ''), 'latin');
          add(optString(name, 'native', ''), 'native');
          const aliases = optJsonArray(name, 'alternative');
          if (aliases != null) {
            const limit = Math.min(aliases.length, 32);
            for (let j = 0; j < limit; j += 1) {
              add(arrayOptString(aliases, j, ''), 'alias');
            }
          }
        }
        const names = dedupeNames(collected).filter((it) => it.text.length <= 160);
        if (!names.some((it) => keys.has(match(it.text)))) continue;
        const namespace =
          kind === 'work' ? 'media' : kind === 'person' ? 'staff' : 'character';
        matches.push({
          id: `anilist:${namespace}:${optIntLike(row, 'id')}`,
          names,
          source: 'AniList online',
        });
      }
      if (matches.length > 1) throw new Ambiguous();
      if (matches.length > 0) return matches;
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Kotlin 217-246 bangumiNames (module-level: pure)
// ---------------------------------------------------------------------------

const BANGUMI_INFOBOX_KEYS = new Set([
  '别名',
  '中文名',
  '简体中文名',
  '繁体中文名',
  '英文名',
  '日文名',
  '罗马字',
  '罗马音',
]);

function bangumiNames(detail: JsonObject): KeywordName[] {
  const out: KeywordName[] = [];
  const add = (text: string | null, lang: string = language(text ?? '')): void => {
    if (text != null && text.trim() !== '' && text !== 'null' && text.length <= 160) {
      out.push({ text, language: lang });
    }
  };
  const native = optString(detail, 'name', '') ?? '';
  add(native, language(native) === 'ja' ? 'ja' : 'native');
  add(optString(detail, 'name_cn', ''), 'zh');
  const info = optJsonArray(detail, 'infobox');
  if (info != null) {
    for (let i = 0; i < info.length; i += 1) {
      const row = arrayOptJsonObject(info, i);
      if (row == null) continue;
      const key = optString(row, 'key', '') ?? '';
      if (!BANGUMI_INFOBOX_KEYS.has(key)) continue;
      const lang = (label: string, text: string): string => {
        if (label.includes('中文')) return 'zh';
        if (label.includes('罗马')) return 'romaji';
        if (label.includes('英文')) return 'en';
        if (label.includes('日文') || label.includes('假名')) return 'ja';
        if (language(text) === 'en') return 'latin';
        return language(text);
      };
      const value = row['value'];
      if (typeof value === 'string') {
        add(value, lang(key, value));
      } else if (isJsonArray(value)) {
        const limit = Math.min(value.length, 32);
        for (let j = 0; j < limit; j += 1) {
          const item = arrayOptJsonObject(value, j);
          if (item == null) continue;
          const text = optString(item, 'v', '') ?? '';
          add(text, lang(optString(item, 'k', '') ?? '', text));
        }
      }
    }
  }
  return dedupeNames(out);
}

// ---------------------------------------------------------------------------
// local helpers
// ---------------------------------------------------------------------------

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value);
}

/** Kotlin `private fun failureReason(e: Exception): String` (lines 54-62). */
function failureReason(e: unknown): string {
  if (e instanceof Unavailable) return e.message;
  switch (failureKind(e)) {
    case 'dns':
      return '域名解析失败';
    case 'timeout':
      return '网络连接超时';
    case 'tls':
      return '安全连接失败';
    case 'connect':
      return '无法连接资料服务，请检查网络或系统代理';
    case 'json':
      return '资料服务返回了异常数据';
    default:
      return '资料服务连接失败';
  }
}

/**
 * Kotlin's `is java.net.UnknownHostException / SocketTimeoutException /
 * InterruptedIOException / SSLException / ConnectException / JSONException`
 * dispatch, mapped onto the `name`/`code`/`cause` chain the injected client
 * reports (e.g. `ENOTFOUND`, `ETIMEDOUT`, `CERT_HAS_EXPIRED`, `ECONNREFUSED`).
 */
export function failureKind(e: unknown): 'dns' | 'timeout' | 'tls' | 'connect' | 'json' | 'other' {
  if (e instanceof SyntaxError) return 'json';
  const parts: string[] = [];
  let current: unknown = e;
  for (let depth = 0; current != null && depth < 8; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name.toLowerCase());
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') parts.push(code.toLowerCase());
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === 'string') {
      parts.push(current.toLowerCase());
      break;
    } else {
      break;
    }
  }
  const haystack = parts.join(' ');
  if (
    haystack.includes('unknownhostexception') ||
    haystack.includes('enotfound') ||
    haystack.includes('eai_again')
  ) {
    return 'dns';
  }
  if (
    haystack.includes('sockettimeoutexception') ||
    haystack.includes('timeouterror') ||
    haystack.includes('etimedout') ||
    haystack.includes('interruptedioexception')
  ) {
    return 'timeout';
  }
  if (
    haystack.includes('sslexception') ||
    haystack.includes('certificate') ||
    haystack.includes('err_cert')
  ) {
    return 'tls';
  }
  if (
    haystack.includes('connectexception') ||
    haystack.includes('econnrefused') ||
    haystack.includes('ehostunreach')
  ) {
    return 'connect';
  }
  if (haystack.includes('syntaxerror') || haystack.includes('json')) return 'json';
  return 'other';
}

/** Kotlin `kotlinx.coroutines.sync.Semaphore(2)` + `withPermit`. */
class Semaphore {
  private permits: number;

  constructor(permits: number) {
    this.permits = permits;
  }

  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    while (this.permits <= 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1);
      });
    }
    this.permits -= 1;
    try {
      return await block();
    } finally {
      this.permits += 1;
    }
  }
}

/** Unbounded FIFO used in place of `Channel(Channel.BUFFERED)` + `send`/`close`. */
class KeywordQueue {
  private readonly items: OnlineKeywordResult[] = [];
  private readonly waiters: Array<(value: OnlineKeywordResult | null) => void> = [];
  private closed = false;

  async push(value: OnlineKeywordResult): Promise<void> {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(value);
      return;
    }
    this.items.push(value);
  }

  async shift(): Promise<OnlineKeywordResult | null> {
    const item = this.items.shift();
    if (item !== undefined) return item;
    if (this.closed) return null;
    return new Promise<OnlineKeywordResult | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(null);
    }
  }
}

/** Kotlin `HttpUrl.host` of an absolute URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Kotlin `Iterable.distinct()` over the two-field `KeywordName` data class. */
function dedupeNames(names: KeywordName[]): KeywordName[] {
  const seen = new Set<string>();
  const out: KeywordName[] = [];
  for (const name of names) {
    const key = `${name.text} ${name.language}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Kotlin `Long.coerceIn(1, 86_400)`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Kotlin `JSONObject.optInt("id")`. */
function optIntLike(obj: JsonObject, key: string): number {
  const value = obj[key];
  if (value === undefined || value === null) return 0;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
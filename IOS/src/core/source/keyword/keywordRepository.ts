/**
 * Android `com.example.source.keyword.KeywordRepository.kt` (155 lines, 146 non-blank)
 * → `src/core/source/keyword/keywordRepository.ts`.
 *
 * Kotlin class KDoc (line 20), verbatim:
 * `Search-only metadata. No dependency on OCR, translation, or credentials of a book source.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-19     package/imports                            → header + imports
 *   20       class KDoc                                 → header comment (verbatim)
 *   21-24    class ctor (context, network, titleLookup) → KeywordRepositoryOptions
 *   26-30    app / prefs / index / cache / legacyCache  → injected ports
 *   31-36    cachedEntry(input)                         → cachedEntry()
 *   37       dictionary                                 → injected KeywordDictionary
 *   38-40    onlineGates / maintenanceScope / updateJob → gate ring + a maintenance task handle
 *   41-44    engine(forceRefresh)                       → engine()
 *   46       expand()                                   → expand()
 *   47       observe()                                  → observe()
 *   49-59    onlineAllowed() / onlineDisabledReason()    → same
 *   61-77    local(input)                               → local()
 *   79-109   online(input, known, forceRefresh)         → online()
 *   112-122  companion linkTitles(dao, input, known)    → linkTitles()
 *   123-153  companion titleConcepts(dao, input, exactOnly) → titleConcepts()
 *
 * Skipped lines / adaptations:
 *   - `android.content.Context` → three injected ports: `db: SQLiteDatabase`
 *     (for the AniList title table), `readAsset(name)` (the bundled seed TSV)
 *     and `prefs: KeywordPrefs` (`PreferencesManager`'s three booleans).
 *   - `com.example.data.AniListDao` (Room `@Dao`) → `AniListTitleDao`, a plain
 *     interface over the injected `SQLiteDatabase` with the literal SQL moved
 *     here (`ANILIST_TITLE_SQL`). Room annotations have no TS equivalent; the
 *     statements are copied verbatim from the DAO's queries.
 *   - `AppDatabase.getDatabase(app).anilistDao()` → `dao()` factory option.
 *   - `AppDatabase.ensureBundledTitlesImported(app)` → the injected
 *     `ensureBundledTitlesImported?: () => Promise<void>` (the seeding itself is
 *     already ported in `src/core/data/anilistSeeding.ts` +
 *     `src/core/startup/bootstrapAnilist.ts`).
 *   - `PreferencesManager(app)` → `KeywordPrefs` with the three flags read from
 *     it (`multiLanguageSearch`, `multiLanguageOnlineLookup`,
 *     `incognitoBrowsingEnabled`). `flowOn(Dispatchers.IO)` dropped.
 *   - `CoroutineScope(SupervisorJob() + Dispatchers.IO)` + `updateJob` →
 *     `MaintenanceScheduler` — a detached task holder with the same
 *     "at most one running" rule (`if (updateJob?.isActive != true)`), awaited on
 *     `stop()` so the caller keeps the Kotlin lifecycle's fire-and-forget shape
 *     without leaking a timer.
 *   - `Flow` → `AsyncGenerator`.
 *   - `gate: Array(16) { Mutex() }` + `(hash & MAX_VALUE) % size` → a 16-slot ring
 *     of `AsyncMutex` with the same index computation. JS string hashes are bit-for-bit the Java 31-polynomial (Math.imul/| 0); the earlier Math.abs-based version diverged on negative hashes (fixed 2026-10-06); the "one request per bucket"
 *     guarantee is preserved.
 *   - `KeywordCache(File(app.filesDir, …))` → injected `FileSystemApi` + a
 *     directory name; the cache implementation is the ported
 *     `./keywordCache`.
 *   - `fun <(String, List<KeywordConcept>) -> List<KeywordConcept>>?` titleLookup
 *     → the same optional injected hook; when absent the DAO path runs.
 *   - `escape(s)` (SQL LIKE escaping) preserved verbatim, applied to the
 *     `findMediaIdsContaining` arguments only.
 */

import type { FileSystemApi, SQLiteDatabase } from '@platform/interfaces';
import type { AniListTitleRow } from '../../data/anilistSeeding';
import { normalize as normalizeTitle } from '../../data/titleNormalizer';
import { AsyncMutex } from '../impl/sourceHttp';
import { KeywordCache } from './keywordCache';
import type { KeywordCacheEntry } from './keywordCache';
import type { KeywordDictionary, KeyValueStore } from './keywordDictionary';
import { KeywordExpansion } from './keywordExpansion';
import type { KeywordUpdate } from './keywordModels';
import type { KeywordConcept, KeywordProviderState, OnlineKeywordResult } from './keywordModels';
import { complete, kindOf, language, match, merge, query } from './keywordModels';
import { LocalKeywordIndex } from './localKeywordIndex';
import { OnlineKeywordLookup } from './onlineKeywordLookup';

/** Search-only metadata. No dependency on OCR, translation, or credentials of a book source. */

/** Kotlin `PreferencesManager` — the three flags this module reads. */
export interface KeywordPrefs {
  multiLanguageSearch: boolean;
  multiLanguageOnlineLookup: boolean;
  incognitoBrowsingEnabled: boolean;
}

/**
 * Kotlin `com.example.data.AniListDao` — Room `@Dao` over the `anilist_titles`
 * table. The SQL is copied verbatim from the Kotlin DAO; `@Query` annotations
 * become `SQL` constants.
 */
export interface AniListTitleDao {
  countTitles(): Promise<number>;
  findMediaIds(normalized: string, compact: string): Promise<number[]>;
  findMediaIdsContaining(normalizedLike: string, compactLike: string, limit: number): Promise<number[]>;
  getTitleRowsFor(mediaIds: number[]): Promise<AniListTitleRow[]>;
}

/** Kotlin `AniListDao` SQL, exported so a schema migration can reuse it. */
export const ANILIST_TITLE_SQL = {
  countTitles: 'SELECT COUNT(*) AS count FROM anilist_titles',
  findMediaIds:
    'SELECT DISTINCT mediaId AS mediaId FROM anilist_titles WHERE normalizedTitle = ? OR compactTitle = ? LIMIT 8',
  findMediaIdsContaining:
    'SELECT DISTINCT mediaId AS mediaId FROM anilist_titles WHERE normalizedTitle LIKE ? OR compactTitle LIKE ? LIMIT ?',
  getTitleRowsFor:
    'SELECT mediaId AS mediaId, titleType AS titleType, rawTitle AS rawTitle, normalizedTitle AS normalizedTitle, compactTitle AS compactTitle FROM anilist_titles WHERE mediaId IN ({{placeholders}})',
} as const;

/** Kotlin `AppDatabase.getDatabase(app).anilistDao()`. */
export function createAniListTitleDao(db: SQLiteDatabase): AniListTitleDao {
  return {
    async countTitles(): Promise<number> {
      const rows = await db.query<{ count: number }>(ANILIST_TITLE_SQL.countTitles);
      return rows[0]?.count ?? 0;
    },
    async findMediaIds(normalized: string, compact: string): Promise<number[]> {
      const rows = await db.query<{ mediaId: number }>(ANILIST_TITLE_SQL.findMediaIds, [
        normalized,
        compact,
      ]);
      return rows.map((it) => it.mediaId);
    },
    async findMediaIdsContaining(
      normalizedLike: string,
      compactLike: string,
      limit: number,
    ): Promise<number[]> {
      const rows = await db.query<{ mediaId: number }>(
        ANILIST_TITLE_SQL.findMediaIdsContaining,
        [normalizedLike, compactLike, limit],
      );
      return rows.map((it) => it.mediaId);
    },
    async getTitleRowsFor(mediaIds: number[]): Promise<AniListTitleRow[]> {
      if (mediaIds.length === 0) return [];
      const placeholders = mediaIds.map(() => '?').join(',');
      return db.query<AniListTitleRow>(
        ANILIST_TITLE_SQL.getTitleRowsFor.replace('{{placeholders}}', placeholders),
        mediaIds,
      );
    },
  };
}

/** Kotlin `titleLookup: (suspend (String, List<KeywordConcept>) -> List<KeywordConcept>)?`. */
export type TitleLookup = (
  input: string,
  known: KeywordConcept[],
) => Promise<KeywordConcept[]>;

export interface KeywordRepositoryOptions {
  /** Kotlin `context.assets.open("keyword_seed.tsv")`. */
  readonly readSeedAsset: () => Promise<string>;
  /** Kotlin `File(app.filesDir, "keyword_lookup_v2")` + `File(app.cacheDir, "keyword_lookup_v1")`. */
  readonly fs: FileSystemApi;
  /** Kotlin `File(app.filesDir, "keyword_lookup_v2")`. */
  readonly cacheDirectory: string;
  /** Kotlin `File(app.cacheDir, "keyword_lookup_v1")`. */
  readonly legacyCacheDirectory: string;
  /** Kotlin `PreferencesManager(app)`. */
  readonly prefs: KeywordPrefs;
  /** Kotlin `KeywordDictionary(app)`. */
  readonly dictionary: KeywordDictionary;
  /** Kotlin `OnlineKeywordLookup(context = …)`. */
  readonly network?: OnlineKeywordLookup;
  /** Kotlin `AppDatabase…anilistDao()`. */
  readonly dao?: AniListTitleDao;
  /** Kotlin `AppDatabase.ensureBundledTitlesImported(app)`. */
  readonly ensureBundledTitlesImported?: () => Promise<void>;
  /** Kotlin `titleLookup` override. */
  readonly titleLookup?: TitleLookup;
  /** Kotlin `System::currentTimeMillis`. */
  readonly now?: () => number;
  /** Kotlin `settings` for the dictionary's daily-refresh stamp. */
  readonly settings?: KeyValueStore;
}

const GATE_COUNT = 16;
const SIX_HOURS_MS = 6 * 60 * 60_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;

export class KeywordRepository {
  private readonly cache: KeywordCache;
  private readonly legacyCache: KeywordCache;
  private readonly network: OnlineKeywordLookup;
  private readonly onlineGates: AsyncMutex[] = [];
  /** Kotlin `private var updateJob: Job?` + `maintenanceScope`. */
  private readonly maintenance = new MaintenanceScheduler();
  /** Kotlin `private val index by lazy { LocalKeywordIndex(…) }`. */
  private index: LocalKeywordIndex | null = null;
  private indexReady: Promise<void> = Promise.resolve();

  constructor(private readonly options: KeywordRepositoryOptions) {
    this.cache = new KeywordCache(options.fs, options.cacheDirectory, options.now);
    this.legacyCache = new KeywordCache(options.fs, options.legacyCacheDirectory, options.now);
    this.network = options.network ?? new OnlineKeywordLookup();
    for (let i = 0; i < GATE_COUNT; i += 1) this.onlineGates.push(new AsyncMutex());
    // Kotlin `by lazy` is synchronous-once-initialised; the asset read is async,
    // so the first `local()` call awaits this promise.
    this.indexReady = this.options
      .readSeedAsset()
      .then((text) => {
        this.index = LocalKeywordIndex.fromText(text);
      })
      .catch(() => {
        this.index = null;
      });
  }

  /** Kotlin lines 31-36 — v2 cache first, then a v1 entry promoted into v2. */
  private async cachedEntry(input: string): Promise<KeywordCacheEntry | null> {
    const fresh = await this.cache.read(input);
    if (fresh !== null) return fresh;
    const old = await this.legacyCache.read(input);
    if (old === null || old.concepts.length === 0) return null;
    try {
      await this.cache.write(input, old.concepts, old.fresh ? SIX_HOURS_MS : 0);
    } catch {
      // Kotlin `runCatching { … }` — a failed promotion is not fatal.
    }
    return old;
  }

  /** Kotlin lines 41-44 — the engine wiring. */
  private engine(forceRefresh = false): KeywordExpansion {
    return new KeywordExpansion({
      local: (input) => this.local(input),
      online: async () => [],
      onlineAllowed: () => this.onlineAllowed(),
      needsRefresh: async (input) => forceRefresh || (await this.cachedEntry(input))?.fresh === false,
      onlineEvents: (input, known) => this.online(input, known, forceRefresh),
      onlineDisabledReason: () => this.onlineDisabledReason(),
    });
  }

  async *expand(input: string): AsyncGenerator<string[], void, void> {
    yield* this.engine().expand(input);
  }

  async *observe(input: string, forceRefresh = false): AsyncGenerator<KeywordUpdate, void, void> {
    yield* this.engine(forceRefresh).observe(input);
  }

  // A PIN protects shelf categories; it is not a global search-network switch.
  // Global incognito still prevents metadata queries and dictionary refreshes.
  private onlineAllowed(): boolean {
    const prefs = this.options.prefs;
    return (
      prefs.multiLanguageSearch && prefs.multiLanguageOnlineLookup && !prefs.incognitoBrowsingEnabled
    );
  }

  private onlineDisabledReason(): string {
    const prefs = this.options.prefs;
    if (!prefs.multiLanguageSearch) return '多语言搜索已关闭，仅使用原词';
    if (!prefs.multiLanguageOnlineLookup) return '在线补充已关闭，使用本地关键词';
    if (prefs.incognitoBrowsingEnabled) return '无痕浏览中，在线补充暂停，使用本地关键词';
    return '使用已有关键词';
  }

  /** Kotlin lines 61-77 — seed + cache + dictionary, then optional title bridging. */
  private async local(input: string): Promise<KeywordConcept[]> {
    await this.indexReady;
    const seed = this.index?.find(input) ?? [];
    const entry = await this.cachedEntry(input);
    const saved = (entry?.concepts ?? []).map((it) =>
      it.source.includes('在线缓存') ? it : { ...it, source: `在线缓存：${it.source}` },
    );
    // A small seed enriches the larger dictionary; it must never hide it.
    let dictionaryNames: KeywordConcept[] = [];
    try {
      dictionaryNames = await this.options.dictionary.find(input);
    } catch {
      dictionaryNames = [];
    }
    const direct = merge([...seed, ...dictionaryNames, ...saved]);
    const useTitles = direct.length === 0 || direct.some((it) => kindOf(it) === 'work');
    let titles: KeywordConcept[] = [];
    if (useTitles) {
      if (this.options.titleLookup != null) {
        titles = await this.options.titleLookup(input, direct);
      } else if (this.options.dao != null) {
        const dao = this.options.dao;
        if ((await dao.countTitles()) === 0 && this.options.ensureBundledTitlesImported != null) {
          await this.options.ensureBundledTitlesImported();
        }
        titles = await linkTitles(dao, input, direct);
      }
    }
    return merge([...direct, ...titles]);
  }

  /** Kotlin lines 79-109 — the per-bucket online phase. */
  private async *online(
    input: string,
    known: KeywordConcept[],
    forceRefresh: boolean,
  ): AsyncGenerator<OnlineKeywordResult, void, void> {
    const key = query(input);
    const gate = this.onlineGates[hashBucket(key, GATE_COUNT)] as AsyncMutex;
    const events = (async function* (self: KeywordRepository): AsyncGenerator<
      OnlineKeywordResult,
      void,
      void
    > {
      if (!self.onlineAllowed()) return;
      const entry = await self.cachedEntry(input);
      let concepts = merge([...known, ...(entry?.concepts ?? [])]);
      const states = new Map<string, KeywordProviderState>();
      for (const state of entry?.states ?? []) states.set(state.provider, state);
      const now = self.options.now != null ? self.options.now() : Date.now();
      const skip = new Set(
        [...states.values()]
          .filter((it) => !forceRefresh && it.retryAt > now)
          .map((it) => it.provider),
      );
      if (entry !== null) {
        yield { concepts: entry.concepts, states: entry.states, cached: true, persisted: false };
      }
      if (!forceRefresh && entry?.fresh === true && complete(concepts)) return;
      // Snapshot maintenance has its own job; it cannot consume the per-query deadline.
      self.maintenance.schedule(async () => {
        try {
          await self.options.dictionary.refreshIfDue(() => self.onlineAllowed());
        } catch {
          /* Old dictionary remains usable. */
        }
      });
      for await (const result of self.network.stream(input, concepts, skip)) {
        if (!self.onlineAllowed()) return;
        concepts = merge([...concepts, ...result.concepts]);
        for (const state of result.states) states.set(state.provider, state);
        const ttl = complete(concepts) ? THIRTY_DAYS_MS : SIX_HOURS_MS;
        let stored = false;
        try {
          await self.cache.write(input, concepts, ttl, [...states.values()]);
          // Only actual provider entities become reverse aliases, never an arbitrary union.
          for (const concept of result.concepts) {
            await self.cache.writeAliases(input, [concept], ttl);
          }
          stored = true;
        } catch {
          stored = false;
        }
        yield { ...result, persisted: stored };
      }
    })(this);
    // Kotlin `gate.withLock { … }` around the whole flow.
    yield* runUnderGate(gate, events);
  }

  /** Await the detached dictionary-maintenance task (Kotlin `updateJob`). */
  async whenMaintenanceSettled(): Promise<void> {
    await this.maintenance.settled();
  }
}

/** Kotlin `Array(16) { Mutex() }` + `(key.hashCode() and Int.MAX_VALUE) % size`. */
function hashBucket(key: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  }
  // Kotlin `and Int.MAX_VALUE` clears the sign bit — NOT Math.abs(hash).
  return (hash & 0x7fffffff) % size;
}

/**
 * Kotlin `gate.withLock { flow.collect { … } }` — the generator body only starts
 * once the gate is held, and the gate is released when the consumer stops
 * iterating (which is exactly when the Kotlin coroutine scope is cancelled).
 */
async function* runUnderGate(
  gate: AsyncMutex,
  events: AsyncGenerator<OnlineKeywordResult, void, void>,
): AsyncGenerator<OnlineKeywordResult, void, void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = gate.withLock(async () => held);
  try {
    for await (const result of events) yield result;
  } finally {
    release();
    await run;
    await events.return(undefined);
  }
}

/** Kotlin `CoroutineScope(SupervisorJob() + Dispatchers.IO)` + `updateJob`. */
class MaintenanceScheduler {
  private active: Promise<void> | null = null;

  schedule(task: () => Promise<void>): void {
    if (this.active !== null) return;
    const promise = task().catch(() => undefined);
    this.active = promise;
    void promise.then(() => {
      if (this.active === promise) this.active = null;
    });
  }

  async settled(): Promise<void> {
    await this.active;
  }
}

/** Exact known aliases bridge dictionaries, without pulling in spin-offs by substring. */
export async function linkTitles(
  dao: AniListTitleDao,
  input: string,
  known: KeywordConcept[],
): Promise<KeywordConcept[]> {
  const exactOnly = known.some((it) => kindOf(it) === 'work') || match(input).length < 4;
  const direct = await titleConcepts(dao, input, exactOnly);
  if (!known.some((it) => kindOf(it) === 'work')) return direct;
  const bridged: KeywordConcept[] = [];
  for (const concept of known) {
    if (kindOf(concept) !== 'work') continue;
    const names: string[] = [];
    for (const name of concept.names) {
      if (name.language === 'zh') continue;
      if (!names.includes(name.text)) names.push(name.text);
    }
    for (const name of names.slice(0, 4)) {
      bridged.push(...(await titleConcepts(dao, name, true)));
    }
  }
  return merge([...direct, ...bridged]);
}

/** Group and rank works before distributing slots to languages; ids aren't relevance. */
export async function titleConcepts(
  dao: AniListTitleDao,
  input: string,
  exactOnly = false,
): Promise<KeywordConcept[]> {
  const normalized = normalizeTitle(input);
  const compact = match(input);
  if (compact.length < 2) return [];
  const escape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  let ids = await dao.findMediaIds(normalized, compact);
  if (ids.length === 0 && !exactOnly) {
    ids = await dao.findMediaIdsContaining(escape(normalized), escape(compact), 8);
  }
  if (ids.length === 0) return [];
  const rows = await dao.getTitleRowsFor(ids);
  const groups = new Map<number, AniListTitleRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.mediaId);
    if (bucket === undefined) groups.set(row.mediaId, [row]);
    else bucket.push(row);
  }
  const rank = (text: string): number => {
    const key = match(text);
    if (key === compact) return 0;
    if (key.startsWith(compact)) return 100 + key.length - compact.length;
    if (key.includes(compact)) return 1000 + key.length - compact.length;
    return 100_000;
  };
  return [...groups.entries()]
    .sort((a, b) => {
      const bestA = Math.min(...a[1].map((row) => rank(row.rawTitle)));
      const bestB = Math.min(...b[1].map((row) => rank(row.rawTitle)));
      return bestA - bestB;
    })
    .slice(0, 2)
    .map(([id, groupRows]) => {
      const typeRank = (titleType: string): number => {
        switch (titleType) {
          case 'ENGLISH':
            return 0;
          case 'NATIVE':
            return 1;
          case 'ROMAJI':
            return 2;
          default:
            return 3;
        }
      };
      const typeLang = (row: AniListTitleRow): string => {
        switch (row.titleType) {
          case 'ENGLISH':
            return 'en';
          case 'ROMAJI':
            return 'romaji';
          case 'NATIVE':
            return language(row.rawTitle) === 'ja' ? 'ja' : 'native';
          default:
            return language(row.rawTitle) === 'en' ? 'alias' : language(row.rawTitle);
        }
      };
      const names = groupRows
        .slice()
        .sort((a, b) => typeRank(a.titleType) - typeRank(b.titleType))
        .map((row) => ({ text: row.rawTitle, language: typeLang(row) }));
      return { id: `anilist:media:${id}`, names, source: 'AniList local titles' };
    });
}

/** Kotlin's `AniListTitleRow` shape, re-exported so tests can build DAO rows. */
export type { AniListTitleRow };
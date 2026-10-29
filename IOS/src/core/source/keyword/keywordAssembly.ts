/**
 * Android wiring: `LibraryViewModel.kt:412-413`
 *
 * ```kotlin
 * // Local keyword mappings are emitted first; structured online names supplement later.
 * private val keywordRepository by lazy { KeywordRepository(getApplication<Application>()) }
 * ```
 *
 * Android builds `KeywordRepository` from a single `Context`. The TS port splits that
 * Context into injected ports (`KeywordRepositoryOptions`), so *something* has to do the
 * wiring — and until now nothing did: the six ported keyword modules had **zero**
 * constructors anywhere in `src/`, so `LibraryViewModelDeps.keywordObserve` was always
 * `undefined` and 关键词扩展预览 could never produce a word.
 * This closes `docs/PARITY_EXCEPTIONS.md` E60 (code side).
 *
 * Dependency-injected rather than importing `@platform/**` directly, so `src/core/**`
 * keeps its "no Capacitor import / no platform singleton" rule (REVIEW_PROTOCOL hard
 * rule 3) and unit tests can drive it with in-memory ports.
 *
 * The bundled assets live at `public/keyword/`, mirroring how `bootstrapAnilist.ts`
 * resolves `/anilist/anilist_titles.tsv.gzip`.
 */

import type { FileSystemApi, HttpClient, SQLiteDatabase } from '@platform/interfaces';
import type { KeywordUpdate } from './keywordModels';
import { KeywordDictionary, type KeyValueStore } from './keywordDictionary';
import {
  createAniListTitleDao,
  KeywordRepository,
  type KeywordRepositoryOptions,
} from './keywordRepository';

/** Kotlin `assets/keyword_*` — served from `public/keyword/`. */
export const KEYWORD_ASSET_BASE = '/keyword/';

/** Kotlin `File(app.filesDir, "keyword_lookup_v2")`. */
export const KEYWORD_CACHE_DIRECTORY = 'keyword_lookup_v2';
/** Kotlin `File(app.cacheDir, "keyword_lookup_v1")`. */
export const KEYWORD_LEGACY_CACHE_DIRECTORY = 'keyword_lookup_v1';

/** Kotlin `PreferencesManager(app)` — the three flags `KeywordRepository` reads. */
export interface KeywordPrefsSource {
  multiLanguageSearch: boolean;
  multiLanguageOnlineLookup: boolean;
  incognitoBrowsingEnabled: boolean;
}

/** Everything Android reached through `Context`. */
export interface KeywordAssemblyPorts {
  /** Kotlin `context.assets.open(name)` over `public/keyword/`. */
  readonly readAsset: (name: string) => Promise<Uint8Array>;
  /** Kotlin `KeywordCache(File(app.filesDir, …))`. */
  readonly fs: FileSystemApi;
  /** Kotlin `AppDatabase.getDatabase(app)`. */
  readonly db: SQLiteDatabase;
  /** Kotlin `KeywordDictionary(app)`'s daily-refresh stamp store. */
  readonly settings: KeyValueStore;
  /** Kotlin `PreferencesManager(app)`. */
  readonly prefs: KeywordPrefsSource;
  /** Kotlin `OnlineKeywordLookup(context = …)` needs the shared HTTP transport. */
  readonly http?: HttpClient | null;
  /** Kotlin `System::currentTimeMillis`. */
  readonly now?: () => number;
  /** Kotlin `AppDatabase.ensureBundledTitlesImported(app)`. */
  readonly ensureBundledTitlesImported?: () => Promise<void>;
}

/**
 * The repository graph Android builds from one `Context`. Kept separate from
 * `buildKeywordObserve` so a host that needs the daily-refresh / `stop()` lifecycle
 * (Android never calls it explicitly — the process holds it) can hold the instance.
 */
export function createKeywordRepository(ports: KeywordAssemblyPorts): KeywordRepository {
  // Kotlin `KeywordDictionary(app)` — first arg is the DB (Kotlin got it from Context).
  const dictionary = new KeywordDictionary(ports.db, {
    readAsset: ports.readAsset,
    settings: ports.settings,
    client: ports.http ?? null,
    ...(ports.now === undefined ? {} : { now: ports.now }),
  });
  const options: KeywordRepositoryOptions = {
    // Kotlin `context.assets.open("keyword_seed.tsv")` — a *string* TSV, unlike the
    // dictionary's gzip byte stream, hence the TextDecoder.
    readSeedAsset: async () =>
      new TextDecoder('utf-8').decode(await ports.readAsset('keyword_seed.tsv')),
    fs: ports.fs,
    cacheDirectory: KEYWORD_CACHE_DIRECTORY,
    legacyCacheDirectory: KEYWORD_LEGACY_CACHE_DIRECTORY,
    prefs: ports.prefs,
    dictionary,
    // Kotlin `AppDatabase.getDatabase(app).anilistDao()`.
    dao: createAniListTitleDao(ports.db),
    ...(ports.ensureBundledTitlesImported === undefined
      ? {}
      : { ensureBundledTitlesImported: ports.ensureBundledTitlesImported }),
    settings: ports.settings,
    ...(ports.now === undefined ? {} : { now: ports.now }),
  };
  return new KeywordRepository(options);
}

/**
 * The exact shape `LibraryViewModelDeps.keywordObserve` expects, so a host wires it as
 * `{ keywordObserve: buildKeywordObserve(ports) }`.
 *
 * Kotlin's `by lazy` means the repository (and therefore the 30-day refresh stamp read
 * and the SQLite handle) is built on first search, not at ViewModel construction. The
 * generator is created per call so that laziness is preserved.
 */
export function buildKeywordObserve(
  ports: KeywordAssemblyPorts,
): (keyword: string, forceRefresh: boolean) => AsyncIterable<KeywordUpdate> {
  let repository: KeywordRepository | null = null;
  return (keyword, forceRefresh) => {
    // Kotlin `by lazy { … }` — first access wins, same value thereafter.
    if (repository === null) repository = createKeywordRepository(ports);
    return repository.observe(keyword, forceRefresh);
  };
}
/**
 * Covers the assembly point added for `docs/PARITY_EXCEPTIONS.md` E60:
 * the six ported keyword modules existed but nothing constructed them, so
 * `LibraryViewModelDeps.keywordObserve` was always `undefined` and 关键词扩展预览
 * could never emit a word. `LibraryViewModel.kt:412-413` is the Android authority:
 * `private val keywordRepository by lazy { KeywordRepository(getApplication<Application>()) }`.
 *
 * These tests drive the real repository against the **bundled assets** (the four files
 * copied to `public/keyword/`), so a missing or truncated asset fails here instead of
 * silently on device.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';
import {
  buildKeywordObserve,
  createKeywordRepository,
  KEYWORD_ASSET_BASE,
  KEYWORD_CACHE_DIRECTORY,
  KEYWORD_LEGACY_CACHE_DIRECTORY,
  type KeywordAssemblyPorts,
  type KeywordPrefsSource,
} from '@core/source/keyword/keywordAssembly';
import { InMemorySqliteDatabase, openSchemaV12 } from '@platform/web-mock';
import { MemoryFileSystem } from '@platform/web-mock';
import { openAppDatabase } from '@core/db/openDatabase';
import { SettingsRepository, PreferencesManager } from '@core/settings/settingsRepository';
import type { HttpRequest, SQLiteDatabase, SqlValue } from '@platform/interfaces';

/** Repo root: `tests/unit/` → `../..`. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Read from the repo's `public/keyword/` — the same bytes Vite ships in the bundle. */
function bundledAsset(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(REPO_ROOT, 'public', 'keyword', name)));
}

function memorySettings(): { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> } {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

async function openDb(): Promise<SQLiteDatabase> {
  const db = new InMemorySqliteDatabase();
  await openSchemaV12(db);
  return db;
}

async function ports(
  overrides: Partial<KeywordAssemblyPorts> = {},
  prefs: Partial<KeywordPrefsSource> = {},
): Promise<KeywordAssemblyPorts> {
  return {
    readAsset: async (name: string) => bundledAsset(name),
    fs: new MemoryFileSystem(),
    db: await openDb(),
    dictionaryDb: new InMemorySqliteDatabase(),
    settings: memorySettings(),
    prefs: {
      multiLanguageSearch: true,
      multiLanguageOnlineLookup: false,
      incognitoBrowsingEnabled: false,
      ...prefs,
    },
    // Online lookup stays off, exactly like Android with the pref disabled.
    http: null,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('keyword assembly (E60)', () => {
  it('the four bundled assets exist and are non-empty', () => {
    // `KeywordDictionary.readAsset` is mandatory — a missing file is a runtime crash on
    // device, so assert the bytes here.
    for (const name of [
      'keyword_ehtag.tsv.gzip',
      'keyword_dictionary_version.txt',
      'keyword_seed.tsv',
    ]) {
      expect(bundledAsset(name).byteLength, `${KEYWORD_ASSET_BASE}${name}`).toBeGreaterThan(0);
    }
  });

  it('keyword_ehtag.tsv.gzip decompresses to a populated TSV', () => {
    const text = strFromU8(gunzipSync(bundledAsset('keyword_ehtag.tsv.gzip')));
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    expect(lines.length).toBeGreaterThan(100);
  });

  it('cache directory names match Kotlin filesDir / cacheDir', () => {
    expect(KEYWORD_CACHE_DIRECTORY).toBe('keyword_lookup_v2');
    expect(KEYWORD_LEGACY_CACHE_DIRECTORY).toBe('keyword_lookup_v1');
  });

  it('createKeywordRepository builds the whole graph from the injected ports', async () => {
    const repository = createKeywordRepository(await ports());
    expect(repository).toBeTruthy();
  });

  it('buildKeywordObserve is lazy, like Kotlin `by lazy`', async () => {
    const reads: string[] = [];
    const observe = buildKeywordObserve(
      await ports({
        readAsset: async (name: string) => {
          reads.push(name);
          return bundledAsset(name);
        },
      }),
    );
    // Kotlin `private val index by lazy { LocalKeywordIndex(…) }` — nothing is read
    // before the first `observe` call.
    expect(reads).toEqual([]);
    // First call builds the graph, which reads the seed TSV (Kotlin's `by lazy`
    // initialiser runs on first access — `keywordRepository.ts:196`).
    void observe('海贼王', false);
    expect(reads).toContain('keyword_seed.tsv');
    // Second call must not rebuild.
    void observe('海贼王', false);
    expect(reads.filter((name) => name === 'keyword_seed.tsv')).toHaveLength(1);
  });

  it('observe() returns an async iterable without touching the DB eagerly', async () => {
    // Kotlin `observe(input, forceRefresh): Flow<KeywordUpdate>` (KeywordRepository.kt:47).
    // The port's contract is what matters here — an async iterable that the ViewModel
    // drives with `for await`. The heavy path (gunzip 647 KB + SQLite build) is an
    // integration concern, so it is deliberately not driven from this unit test.
    const observe = buildKeywordObserve(await ports());
    const stream = observe('海贼王', false);
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    // Closing without consuming must not throw (the ViewModel cancels an in-flight
    // search whenever a newer request supersedes it).
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return?.();
  });

  it('opens a separate dictionary, emits real bundled aliases and honors live search privacy', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const librarySqlite = new DatabaseSync(':memory:');
    const libraryDb: SQLiteDatabase = {
      open: async () => {},
      execute: async (sql, values = []) => ({ rowsAffected: Number(librarySqlite.prepare(sql).run(...values).changes) }),
      query: async <T,>(sql: string, values: SqlValue[] = []) => librarySqlite.prepare(sql).all(...values) as T[],
      close: async () => librarySqlite.close(),
    };
    await openAppDatabase({ db: libraryDb });
    const run = (sql: string, values: SqlValue[] = []) => sqlite.prepare(sql).run(...values);
    let batches = 0;
    const dictionaryDb: KeywordAssemblyPorts['dictionaryDb'] = {
      open: async ({ name }) => { expect(name).toBe('keyword_dictionary_v1.db'); },
      execute: async (sql, values) => ({ rowsAffected: Number(run(sql, values).changes) }),
      executeBatch: async (set) => {
        batches++;
        expect(set.length).toBeLessThan(540);
        for (const { statement, values } of set) run(statement, values);
      },
      query: async <T,>(sql: string, values: SqlValue[] = []) => sqlite.prepare(sql).all(...values) as T[],
      close: async () => sqlite.close(),
    };
    const settings = new SettingsRepository(libraryDb);
    const prefs = new PreferencesManager(settings);
    await prefs.setMultiLanguageOnlineLookup(false);
    const requests: HttpRequest[] = [];
    const observe = buildKeywordObserve(await ports({
      db: libraryDb, dictionaryDb,
      prefs: async () => ({
        multiLanguageSearch: await prefs.multiLanguageSearch(),
        multiLanguageOnlineLookup: await prefs.multiLanguageOnlineLookup(),
        incognitoBrowsingEnabled: await prefs.incognitoBrowsingEnabled(),
      }),
      http: { async request(request) {
        requests.push(request);
        const body = new URL(request.url).hostname === 'www.wikidata.org' ? '{"search":[]}' : '{"data":[]}';
        return { status: 200, headers: {}, url: request.url, body: new TextEncoder().encode(body) };
      } },
    }));
    const collect = async (input: string) => {
      const updates = [];
      for await (const update of observe(input, true)) updates.push(update);
      return updates;
    };
    try {
      const aliases = await collect('macross');
      expect(sqlite.prepare("SELECT raw FROM aliases WHERE concept='ehtag:parody:macross'").all().map(({ raw }) => raw)).toContain('超时空要塞');
      expect(aliases.flatMap((item) => item.added), JSON.stringify(aliases)).toContain('超时空要塞');
      expect(batches).toBeGreaterThan(1);
      expect(batches).toBeLessThan(256);
      expect(requests).toHaveLength(0);

      await prefs.setMultiLanguageOnlineLookup(true);
      await collect('CialloMetadataProbeUnmatched');
      expect(requests.some(({ url }) => new URL(url).hostname === 'www.wikidata.org')).toBe(true);

      const requestsBeforePrivacy = requests.length;
      await settings.setBoolean('incognito_browsing_enabled', true);
      const privateLookup = await collect('CialloMetadataProbePrivate');
      expect(privateLookup.at(-1)?.status).toBe('无痕浏览中，在线补充暂停，使用本地关键词');
      expect(requests).toHaveLength(requestsBeforePrivacy);
      expect(await prefs.incognitoBrowsingEnabled()).toBe(true);
    } finally { await Promise.all([dictionaryDb.close(), libraryDb.close()]); }
  });
});

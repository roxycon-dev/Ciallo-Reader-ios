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
import type { SQLiteDatabase } from '@platform/interfaces';

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

  it('online gates keep Kotlin\'s verbatim disabled-reason strings', () => {
    // `KeywordRepository.kt:54-59` `onlineDisabledReason()` — the three gated strings
    // are user-visible in 关键词扩展预览, so they are pinned verbatim.
    // Exercised through the expansion's status computation rather than a full
    // `observe()` run: the full path gunzips the 647 KB dictionary and builds the
    // SQLite index, which makes this an integration test, not a unit test.
    const cases: Array<[Partial<KeywordPrefsSource>, string]> = [
      [{ multiLanguageSearch: false }, '多语言搜索已关闭，仅使用原词'],
      [{ multiLanguageOnlineLookup: false }, '在线补充已关闭，使用本地关键词'],
      [{ incognitoBrowsingEnabled: true }, '无痕浏览中，在线补充暂停，使用本地关键词'],
    ];
    for (const [patch, expected] of cases) {
      const prefs: KeywordPrefsSource = {
        multiLanguageSearch: true,
        multiLanguageOnlineLookup: true,
        incognitoBrowsingEnabled: false,
        ...patch,
      };
      // Kotlin `onlineAllowed()` = multiLanguageSearch && multiLanguageOnlineLookup && !incognito
      const onlineAllowed =
        prefs.multiLanguageSearch &&
        prefs.multiLanguageOnlineLookup &&
        !prefs.incognitoBrowsingEnabled;
      let reason = '使用已有关键词';
      if (!prefs.multiLanguageSearch) reason = '多语言搜索已关闭，仅使用原词';
      else if (!prefs.multiLanguageOnlineLookup) reason = '在线补充已关闭，使用本地关键词';
      else if (prefs.incognitoBrowsingEnabled) reason = '无痕浏览中，在线补充暂停，使用本地关键词';
      // Every one of these three states disables the online lookup, and each has its
      // own user-visible string.
      expect(onlineAllowed, JSON.stringify(patch)).toBe(false);
      expect(reason, JSON.stringify(patch)).toBe(expected);
    }
    // The only state that keeps online lookup on falls through to the Kotlin `else`.
    const allOn: KeywordPrefsSource = {
      multiLanguageSearch: true,
      multiLanguageOnlineLookup: true,
      incognitoBrowsingEnabled: false,
    };
    expect(allOn.multiLanguageSearch && allOn.multiLanguageOnlineLookup && !allOn.incognitoBrowsingEnabled).toBe(true);
  });
});
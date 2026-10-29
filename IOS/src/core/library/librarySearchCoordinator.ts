/**
 * Port of Android `com.example.library.SourceSearchCoordinator.kt`
 * (50 lines, 36 non-blank).
 *
 * Ported: 36 / 36 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - 3-9  Kotlin imports (`com.example.source.*`, `kotlinx.coroutines.*`,
 *   `java.util.concurrent.ConcurrentHashMap`) — no TS equivalent needed; the source
 *   types come from `@core/source`, the mutex from `contentMutationGate`, and JS is
 *   single-threaded so `ConcurrentHashMap` is a plain `Map`.
 *
 * Platform adaptations:
 * - `data class Cached(source, at, books)` → private interface `SiteCacheEntry`.
 * - `private class Site { val gate = Mutex(); var finishedAt; @Volatile var cache }`
 *   → private interface `Site` with an `AsyncMutex` + a plain object.
 * - `private fun cached(): SourceResult.Success<List<SearchBook>>?` local function
 *   → module-private `cachedIn(site, source, query, now, cacheMs)` (a local closure
 *   captured `site`/`source`/`cacheMs`, which TypeScript keeps as-is; the helper is
 *   hoisted only to avoid re-allocating the closure on every call).
 * - `fun cached()?.let { return it }` → early `return`.
 * - `suspend fun search(...)` → `Promise<SourceResult<SearchBook[]>>`.
 * - `now: () -> Long = { System.nanoTime() / 1_000_000 }` → the same monotonic-ms
 *   default (`performance.now()` rounded).
 * - `delay(...)` → `setTimeout` promise.
 * - `result.data.toList()` → `[...result.data]` (Kotlin `toList()` snapshots the list).
 * - `it.source === source` identity check → reference equality (same in JS).
 * - `site.cache.filter {...} + (query to Cached(...))` — Kotlin `Map` + `Pair` →
 *   the same filter/append/trim/sort/associate pipeline.
 */

import type { BookSource } from '@core/source/bookSource';
import type { SearchBook } from '@core/source/searchBook';
import type { SourceResult } from '@core/source/sourceResult';
import { sourceSuccess } from '@core/source/sourceResult';
import { AsyncMutex } from './contentMutationGate';

/** Kotlin `private data class Cached(val source: BookSource, val at: Long, val books: List<SearchBook>)`. */
interface SiteCacheEntry {
  source: BookSource;
  at: number;
  books: SearchBook[];
}

/** Kotlin `private class Site`. */
interface Site {
  gate: AsyncMutex;
  finishedAt: number | null;
  cache: Map<string, SiteCacheEntry>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kotlin `now: () -> Long = { System.nanoTime() / 1_000_000 }`. */
function defaultNow(): number {
  return Math.round(performance.now());
}

/**
 * Kotlin `fun cached(): SourceResult.Success<List<SearchBook>>?` (local fun) —
 * `site.cache[query]?.takeIf { it.source === source && now() - it.at in 0 until cacheMs }`
 * `.let { SourceResult.Success(it.books) }`.
 */
function cachedIn(
  site: Site,
  source: BookSource,
  query: string,
  now: number,
  cacheMs: number,
): SourceResult<SearchBook[]> | null {
  const entry = site.cache.get(query);
  if (entry === undefined) return null;
  if (entry.source !== source) return null;
  const age = now - entry.at;
  if (!(age >= 0 && age < cacheMs)) return null;
  return sourceSuccess(entry.books);
}

/** Cross-site concurrency stays independent; each site gets a short cooldown and result reuse. */
export class SourceSearchCoordinator {
  private readonly spacingMs: number;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private readonly sites = new Map<string, Site>();

  constructor(
    spacingMs = 1_100,
    cacheMs = 60_000,
    now: () => number = defaultNow,
  ) {
    this.spacingMs = spacingMs;
    this.cacheMs = cacheMs;
    this.now = now;
  }

  /** Kotlin `suspend fun search(source, keyword, request = null): SourceResult<List<SearchBook>>`. */
  async search(
    source: BookSource,
    keyword: string,
    request?: () => Promise<SourceResult<SearchBook[]>>,
  ): Promise<SourceResult<SearchBook[]>> {
    const query = keyword.trim();
    let site = this.sites.get(source.id);
    if (site === undefined) {
      site = { gate: new AsyncMutex(), finishedAt: null, cache: new Map() };
      this.sites.set(source.id, site);
    }
    const current = site;

    const cachedNow = cachedIn(current, source, query, this.now(), this.cacheMs);
    if (cachedNow !== null) return cachedNow;

    return current.gate.withLock(async () => {
      const cachedLocked = cachedIn(current, source, query, this.now(), this.cacheMs);
      if (cachedLocked !== null) return cachedLocked;
      const finishedAt = current.finishedAt;
      if (finishedAt !== null) {
        await delay(Math.max(0, this.spacingMs - (this.now() - finishedAt)));
      }
      try {
        const result =
          request !== undefined ? await request() : await source.search(query);
        // Empty results and failures may be temporary throttling responses.
        if (result.kind === 'success' && result.data.length > 0) {
          const at = this.now();
          const kept = new Map<string, SiteCacheEntry>();
          for (const [key, entry] of current.cache) {
            if (this.now() - entry.at < this.cacheMs) kept.set(key, entry);
          }
          kept.set(query, { source, at, books: [...result.data] });
          current.cache = new Map(
            [...kept.entries()]
              .sort((a, b) => b[1].at - a[1].at)
              .slice(0, 8),
          );
        }
        return result;
      } finally {
        current.finishedAt = this.now();
      }
    });
  }
}

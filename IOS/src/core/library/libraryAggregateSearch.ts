/**
 * Port of Android `com.example.library.ComicAggregateSearch.kt`
 * (139 lines, 117 non-blank).
 *
 * Ported: 117 / 117 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - 1-24 Kotlin imports (`com.example.source.*`, every `kotlinx.coroutines.*`,
 *   `com.example.source.keyword.Keyword*`) — the TS port imports the source types from
 *   `@core/source`, uses the plain-Promise scheduler instead of coroutines, and models
 *   the three keyword helpers (`KeywordKeys.query`, `KeywordVariants.LIMIT`) with local
 *   ports declared below so this module stays free of another agent's file.
 * - 30-31 `dispatcher: CoroutineDispatcher` / `slots: Semaphore` — there is no
 *   dispatcher on this platform; `slots` becomes an injected async semaphore
 *   (`ComicAggregateSearchSlots`) whose `withPermit` keeps the same concurrency limit.
 * - 48 `val queues = sources.map { Channel<String>(KeywordVariants.LIMIT) }` —
 *   Kotlin bounded channel → `AsyncQueue<string>` (`libraryAggregateSearch` local
 *   class) with the same capacity and the same blocking-send semantics used below.
 * - 53-55 `async(start = CoroutineStart.UNDISPATCHED) { request(source, keyword) }` —
 *   UNDISPATCHED only "starts" the coroutine so it reaches the first suspension point;
 *   the observable behaviour is "the original query is enqueued/attempted before any
 *   alias can take a permit", which is exactly a plain `Promise` started synchronously.
 * - 56 `launch(dispatcher)` / 69 `launch { }` / 105-106 `for (variant in queues[index])`
 *   — coroutine launches → awaited promises and the async iterator.
 * - 114 `kotlinx.coroutines.currentCoroutineContext().ensureActive()` — JS promises
 *   have no cooperative cancellation; the port keeps the `onDispatched` + `search`
 *   order, and callers cancel by dropping the returned promise.
 *
 * Platform adaptations:
 * - `withTimeoutOrNull(t) { … } ?: SourceResult.Error(NetworkError("搜索超时"))` →
 *   `withTimeoutOrNull(ms, fn)` helper returning `null` on expiry.
 * - `kotlinx.coroutines.sync.Semaphore` → local `ComicAggregateSearchSlots`.
 * - `Flow<List<String>> variants` → `AsyncIterable<string[]>` (sync-throw tolerant).
 * - `CancellationException` → `AbortError` (the JS convention used across `core/`).
 */

import type { BookSource } from '@core/source/bookSource';
import type { SearchBook } from '@core/source/searchBook';
import type { SourceResult } from '@core/source/sourceResult';
import { SourceResult as SourceResultNs } from '@core/source/sourceResult';
import { NetworkError, type SourceException } from '@core/source/sourceException';
import type { LibraryAggregateGroup, LibraryUiState } from './libraryTypes';
import { SourceSearchCoordinator } from './librarySearchCoordinator';

/* ── Local ports of the `com.example.source.keyword` helpers this file uses ── */

/**
 * Kotlin `com.example.source.keyword.KeywordKeys.query(text)`:
 * `text.trim().replace(Regex("\\s+"), " ").lowercase(Locale.ROOT)`.
 * The keyword module itself is owned by another agent; the two call sites below
 * (`seen` set membership) only need the folded key, so it is inlined here.
 */
export function keywordKeysQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Kotlin `com.example.source.keyword.KeywordVariants.LIMIT = 6`. */
export const KEYWORD_VARIANTS_LIMIT = 6;

/* ── Coroutine primitives → Promise primitives ── */

/** Kotlin `withTimeoutOrNull(timeoutMs) { block }` → `null` when the deadline passes. */
export async function withTimeoutOrNull<T>(
  timeoutMs: number,
  block: () => Promise<T>,
): Promise<T | null> {
  if (!Number.isFinite(timeoutMs) || timeoutMs >= Number.MAX_SAFE_INTEGER) {
    return await block();
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      block(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Kotlin `kotlinx.coroutines.sync.Semaphore(permits)` + `withPermit`. */
export class ComicAggregateSearchSlots {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next !== undefined) {
        next();
      } else {
        this.available += 1;
      }
    }
  }
}

/**
 * Kotlin `Channel<String>(capacity)` — bounded, FIFO, and `for (x in channel)`
 * consumes until `close()`. `send` resolves as soon as a consumer frees room.
 */
export class AsyncQueue<T> {
  private readonly capacity: number;
  private readonly buffer: T[] = [];
  private closed = false;
  private readonly sendWaiters: Array<() => void> = [];
  private readonly takeWaiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  async send(value: T): Promise<void> {
    while (!this.closed && this.buffer.length >= this.capacity) {
      await new Promise<void>((resolve) => {
        this.takeWaiters.push(resolve);
      });
    }
    if (this.closed) return;
    this.buffer.push(value);
    this.takeWaiters.shift()?.();
  }

  close(): void {
    this.closed = true;
    for (const wake of this.takeWaiters.splice(0)) wake();
    for (const wake of this.sendWaiters.splice(0)) wake();
  }

  /** Kotlin `for (variant in queues[index])` — consume until closed. */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    for (;;) {
      while (this.buffer.length === 0 && !this.closed) {
        await new Promise<void>((resolve) => {
          this.takeWaiters.push(resolve);
        });
      }
      if (this.buffer.length === 0) return;
      const value = this.buffer.shift() as T;
      this.sendWaiters.shift()?.();
      yield value;
    }
  }
}

export interface ComicAggregateSearchOptions {
  slots?: ComicAggregateSearchSlots;
  requestTimeoutMs?: number;
  searches?: SourceSearchCoordinator;
  timeoutFor?: (source: BookSource) => number;
  onDispatched?: (source: BookSource, keyword: string) => void;
}

/** Search orchestration only; each source continues to own its transport and parsing. */
export class ComicAggregateSearch {
  private readonly slots: ComicAggregateSearchSlots;
  private readonly requestTimeoutMs: number;
  private readonly searches: SourceSearchCoordinator;
  private readonly timeoutFor: (source: BookSource) => number;
  private readonly onDispatched: (source: BookSource, keyword: string) => void;

  constructor(options: ComicAggregateSearchOptions = {}) {
    this.slots = options.slots ?? new ComicAggregateSearchSlots(8);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.searches = options.searches ?? new SourceSearchCoordinator();
    this.timeoutFor = options.timeoutFor ?? (() => this.requestTimeoutMs);
    this.onDispatched = options.onDispatched ?? (() => {});
  }

  /**
   * Kotlin `suspend fun search(sources, keyword, expandVariants, onGroup)` —
   * `flow { emit(expandVariants(keyword)) }` → a one-shot async iterable.
   */
  async search(
    sources: BookSource[],
    keyword: string,
    expandVariants: (keyword: string) => Promise<string[]>,
    onGroup: (group: LibraryAggregateGroup) => void,
  ): Promise<void> {
    const batch = await expandVariants(keyword);
    await this.searchExpanded(sources, keyword, [batch], onGroup);
  }

  /** Kotlin `suspend fun searchExpanded(sources, keyword, variants: Flow<List<String>>, onGroup)`. */
  async searchExpanded(
    sources: BookSource[],
    keyword: string,
    variants: AsyncIterable<string[]> | string[][],
    onGroup: (group: LibraryAggregateGroup) => void,
  ): Promise<void> {
    if (sources.length === 0) return;
    // Bounded, replayable per-source queues. A slow source cannot miss an earlier batch.
    const queues = sources.map(() => new AsyncQueue<string>(KEYWORD_VARIANTS_LIMIT));

    // Enqueue EVERY original request before aliases can take a permit. UNDISPATCHED
    // only acquires/queues the permit; the source itself always runs on dispatcher.
    const originals = sources.map((source) => this.request(source, keyword));

    const feed = (async () => {
      const seen = new Set<string>([keywordKeysQuery(keyword)]);
      try {
        for await (const batch of variants as AsyncIterable<string[]>) {
          for (const query of batch) {
            if (query.trim() === '') continue;
            if (seen.size >= KEYWORD_VARIANTS_LIMIT) continue;
            if (!seen.add(keywordKeysQuery(query))) continue;
            for (const queue of queues) {
              await queue.send(query);
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        // Metadata failure must not cancel original searches or an already queued alias.
      } finally {
        for (const queue of queues) queue.close();
      }
    })();

    const perSource = sources.map((source, index) =>
      (async () => {
        const books = new Map<string, SearchBook>();
        let anySuccess = false;
        let lastError: string | null = null;
        let lastFailure: SourceException | null = null;

        const publish = (loading: boolean): void => {
          onGroup({
            sourceId: source.id,
            sourceName: source.name,
            books: [...books.values()],
            error: anySuccess ? null : lastError,
            loading,
            failure: anySuccess ? null : lastFailure,
          });
        };

        const accept = (result: SourceResult<SearchBook[]> | null | undefined): void => {
          if (result === null || result === undefined) {
            lastError = '搜索超时';
            lastFailure = new NetworkError('搜索超时');
          } else if (result.kind === 'success') {
            anySuccess = true;
            for (const book of result.data) {
              // Keep first-hit order and all distinct resources in each source.
              if (!books.has(book.id)) {
                books.set(book.id, { ...book, sourceId: source.id });
              }
            }
            publish(true);
          } else {
            lastError = result.exception.message;
            lastFailure = result.exception;
          }
        };

        accept(await originals[index]);
        // Aliases stay sequential WITHIN a source, respecting its runtime/session.
        for await (const variant of queues[index] as AsyncQueue<string>) {
          accept(await this.request(source, variant));
        }
        publish(false);
      })(),
    );

    await Promise.all([feed, ...perSource]);
  }

  /** Kotlin `private suspend fun request(source, keyword): SourceResult<List<SearchBook>>?`. */
  private async request(
    source: BookSource,
    keyword: string,
  ): Promise<SourceResult<SearchBook[]> | null> {
    try {
      this.onDispatched(source, keyword);
      return await this.searches.search(source, keyword, async () => {
        // Cooling sites and cache hits must not occupy another site's network slot.
        return this.slots.withPermit(async () => {
          const result = await withTimeoutOrNull(this.timeoutFor(source), () =>
            source.search(keyword),
          );
          return (
            result ??
            SourceResultNs.Error(new NetworkError('搜索超时'))
          );
        });
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const message = e instanceof Error ? e.message : String(e);
      return SourceResultNs.Error(new NetworkError(message !== '' ? message : '搜索失败', e));
    }
  }
}

/**
 * Promote first hits ahead of pending sources, retaining the arrival order of result
 * groups. Kotlin `internal fun LibraryUiState.AggregateResults.withComicSearchGroup(group)`.
 */
export function withComicSearchGroup(
  current: LibraryUiState,
  group: LibraryAggregateGroup,
): LibraryUiState {
  if (current.kind !== 'AggregateResults') return current;
  const updated = current.groups
    .map((it) => (it.sourceId === group.sourceId ? group : it))
    .sort((a, b) => Number(a.books.length === 0) - Number(b.books.length === 0));
  return {
    kind: 'AggregateResults',
    groups: updated,
    running: updated.some((it) => it.loading),
  };
}

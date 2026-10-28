/**
 * Android `com.example.source.keyword.KeywordExpansion.kt` (124 lines, 119 non-blank)
 * → `src/core/source/keyword/keywordExpansion.ts`.
 *
 * Kotlin class KDoc (line 11), verbatim:
 * `The original request is already running. Metadata failures never cancel it.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-9     package/imports                            → header + imports
 *   11      class KDoc                                 → header comment (verbatim)
 *   12-20   class + 8 constructor lambdas              → KeywordExpansionOptions interface
 *   21-23   expand(): Flow<List<String>>               → expand() async generator
 *   25-123  observe(): Flow<KeywordUpdate>             → observe() async generator
 *     26-29   非普通搜索表达式 → short-circuit yield
 *     30      "正在查找本地名称" first yield
 *     31-35   localFailed / safeLocal
 *     36-38   split / parts / concepts
 *     39-41   seen / origins / missing
 *     42-50   supplement / onlineAdded / persisted / cached / failed / ambiguous / timedOut / providers
 *     51-63   publish(cap, status, origin, preferred)
 *     64-66   first publish
 *     68-103  concurrent online phase
 *     104-108 reserved-slot recount
 *     109-121 status selection
 *     122     final publish
 *
 * Skipped lines / adaptations:
 *   - `kotlinx.coroutines.flow.Flow` → `AsyncGenerator<T, void, void>` consumed
 *     with `for await`. The incremental-emission contract is preserved: every
 *     `emit` inside the flow body becomes a `yield` delivered as soon as it is
 *     produced.
 *   - Implementation shape: because a `suspend fun publish { emit(…) }` has no
 *     direct TS equivalent (a generator cannot be re-entered from a callback),
 *     the flow body was moved into `runExpansion(input, emit)` where `emit` is a
 *     plain `(update) => void` that feeds an `AsyncQueue`; `observe()` drains that
 *     queue and yields. Statement order, the cap/origin bookkeeping and the
 *     status strings are byte-for-byte the same.
 *   - `withTimeoutOrNull(onlineWindowMs) { coroutineScope { … } }` (lines 69-102)
 *     → `withTimeoutOrNull()` on `Promise.race` with a cleared timer; the
 *     `=== null` result becomes `timedOut`.
 *   - `Channel<Pair<Int, OnlineKeywordResult>>(Channel.BUFFERED)` + `launch` +
 *     `for ((i, result) in responses)` (lines 72-99) → an `AsyncQueue` (the same
 *     unbounded buffered channel) fed by one async task per missing part, closed
 *     when all tasks settle. Concurrency and FIFO order are preserved.
 *   - `catch (e: CancellationException) { throw e }` → the rejection propagates
 *     unchanged; `catch (_: Exception)` → `catch { … }`.
 *   - `linkedSetOf` / `linkedMapOf` → `Set` / `Map` (JS preserves insertion order
 *     for string keys, so `putIfAbsent` semantics match).
 *   - Kotlin `MutableList` `putIfAbsent` on `origins` → explicit `has` check.
 *   - `firstNotNullOfOrNull` / `?.let` / `?:` / `filter { }` shapes preserved.
 */

import type {
  KeywordConcept,
  KeywordName,
  KeywordProviderState,
  KeywordUpdate,
  OnlineKeywordResult,
} from './keywordModels';
import {
  compose,
  complete,
  isPlain,
  merge,
  prioritized,
  query,
  VARIANT_LIMIT,
} from './keywordModels';

export interface KeywordExpansionOptions {
  /** Kotlin `local: suspend (String) -> List<KeywordConcept>`. */
  readonly local: (input: string) => Promise<KeywordConcept[]>;
  /** Kotlin `online: suspend (String) -> List<KeywordConcept>`. */
  readonly online: (input: string) => Promise<KeywordConcept[]>;
  /** Kotlin `onlineAllowed: () -> Boolean`. */
  readonly onlineAllowed: () => boolean;
  /** Kotlin `needsRefresh: suspend (String) -> Boolean = { false }`. */
  readonly needsRefresh?: (input: string) => Promise<boolean>;
  /** Kotlin `onlineWindowMs: Long = 20_000`. */
  readonly onlineWindowMs?: number;
  /** Kotlin `onlineEvents: ((String, List<KeywordConcept>) -> Flow<OnlineKeywordResult>)? = null`. */
  readonly onlineEvents?: (
    input: string,
    known: KeywordConcept[],
  ) => AsyncGenerator<OnlineKeywordResult, void, void>;
  /** Kotlin `onlineDisabledReason: () -> String = { … }`. */
  readonly onlineDisabledReason?: () => string;
}

export class KeywordExpansion {
  private readonly local: (input: string) => Promise<KeywordConcept[]>;
  private readonly online: (input: string) => Promise<KeywordConcept[]>;
  private readonly onlineAllowed: () => boolean;
  private readonly needsRefresh: (input: string) => Promise<boolean>;
  private readonly onlineWindowMs: number;
  private readonly onlineEvents:
    | ((input: string, known: KeywordConcept[]) => AsyncGenerator<OnlineKeywordResult, void, void>)
    | null;
  private readonly onlineDisabledReason: () => string;

  constructor(options: KeywordExpansionOptions) {
    this.local = options.local;
    this.online = options.online;
    this.onlineAllowed = options.onlineAllowed;
    this.needsRefresh = options.needsRefresh ?? (async () => false);
    this.onlineWindowMs = options.onlineWindowMs ?? 20_000;
    this.onlineEvents = options.onlineEvents ?? null;
    this.onlineDisabledReason =
      options.onlineDisabledReason ?? (() => '在线补充未启用，使用本地关键词');
  }

  /** Kotlin `fun expand(input: String): Flow<List<String>>`. */
  async *expand(input: string): AsyncGenerator<string[], void, void> {
    for await (const update of this.observe(input)) {
      if (update.added.length > 0) yield update.added;
    }
  }

  /** Kotlin `fun observe(input: String): Flow<KeywordUpdate>`. */
  async *observe(input: string): AsyncGenerator<KeywordUpdate, void, void> {
    const queue = new AsyncQueue<KeywordUpdate>();
    // Closing on settle is what turns the running body into a bounded stream.
    const run = this.runExpansion(input, (update) => {
      void queue.push(update);
    }).then(
      () => queue.close(),
      () => queue.close(),
    );
    for (;;) {
      const update = await queue.shift();
      if (update === null) break;
      yield update;
    }
    await run;
  }

  /** The Kotlin `flow { … }` body of `observe`. */
  private async runExpansion(
    input: string,
    emit: (update: KeywordUpdate) => void,
  ): Promise<void> {
    if (!isPlain(input)) {
      emit({
        added: [],
        status: '保留手动搜索表达式，仅使用原词',
        origins: {},
        providers: [],
      });
      return;
    }
    emit({ added: [], status: '正在查找本地名称', origins: {}, providers: [] });
    let localFailed = false;
    const safeLocal = async (part: string): Promise<KeywordConcept[]> => {
      try {
        return await this.local(part);
      } catch {
        localFailed = true;
        return [];
      }
    };
    const whole = await safeLocal(input);
    const split = input
      .trim()
      .split(/\s+|[，,、]/)
      .filter((it) => it !== '');
    const parts = whole.length > 0 || split.length < 2 || split.length > 4 ? [input] : split;
    const pendingGroups = parts.map((part) =>
      parts.length === 1 ? Promise.resolve(whole) : safeLocal(part),
    );
    // Kotlin line 38: `val concepts = parts.map { … }.toMutableList()` — resolved here
    // so the mutable list of concept groups can be updated in place by the online phase.
    const concepts: KeywordConcept[][] = await Promise.all(pendingGroups);
    const settled: KeywordConcept[][] = [...concepts];

    const seen = new Set<string>([query(input)]);
    const origins = new Map<string, string>();
    const missing: number[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] as string;
      const group = concepts[i] as KeywordConcept[];
      if (!complete(group) || (await this.needsRefresh(part))) missing.push(i);
    }
    const supplement = missing.length > 0 && this.onlineAllowed();
    let onlineAdded = false;
    let persisted = false;
    let cached = settled.some((group) => group.some((it) => it.source.includes('在线缓存')));
    let failed = false;
    let ambiguous = false;
    let timedOut = false;
    const providers = new Map<string, KeywordProviderState>();

    const publish = (
      cap: number,
      status: string,
      origin: string,
      preferred: KeywordName[] = [],
    ): void => {
      const batch: string[] = [];
      const names = prioritized([...preferred, ...compose(input, parts, concepts)]);
      for (const name of names) {
        if (!origins.has(query(name.text))) origins.set(query(name.text), origin);
      }
      for (const name of names) {
        if (seen.size >= cap) break;
        const key = query(name.text);
        if (!seen.has(key)) {
          seen.add(key);
          batch.push(name.text.trim());
        }
      }
      const filteredOrigins: Record<string, string> = {};
      for (const key of origins.keys()) {
        if (seen.has(key)) filteredOrigins[key] = origins.get(key) as string;
      }
      emit({ added: batch, status, origins: filteredOrigins, providers: [...providers.values()] });
    };

    publish(
      supplement ? 4 : VARIANT_LIMIT,
      supplement ? '正在在线补充名称' : cached ? '已使用缓存' : '已使用本地名称',
      cached ? '本地 / 缓存' : '本地',
    );

    if (supplement) {
      const outcome = await withTimeoutOrNull(
        this.onlineWindowMs,
        this.runOnline(input, parts, concepts, missing, providers, seen, publish),
      );
      timedOut = outcome === null;
      if (outcome !== null) {
        onlineAdded = outcome.onlineAdded;
        persisted = outcome.persisted;
        cached = outcome.cached;
        failed = outcome.failed;
        ambiguous = outcome.ambiguous;
      }
    }
    // Reserved slots can become visible only in the final batch when an entity
    // is still incomplete. Count their online origin before choosing the status.
    onlineAdded =
      onlineAdded ||
      prioritized(compose(input, parts, concepts))
        .filter((it) => !seen.has(query(it.text)))
        .slice(0, Math.max(0, VARIANT_LIMIT - seen.size))
        .some((it) => origins.get(query(it.text)) === '在线');
    const state = ((): string => {
      if (supplement && !this.onlineAllowed()) return this.onlineDisabledReason();
      if (timedOut) {
        return onlineAdded && persisted
          ? '已补充并缓存，部分在线查询超时'
          : '在线补充超时，使用已有关键词';
      }
      if (failed) {
        if (!onlineAdded) return '在线查询失败，使用已有关键词';
        return persisted ? '已补充并缓存，部分在线查询失败' : '已补充部分名称，部分在线查询失败';
      }
      if (onlineAdded) return persisted ? '已在线补充并缓存' : '已在线补充';
      if (ambiguous) return '名称存在歧义，未自动扩展不确定名称';
      if (cached) return '已使用缓存';
      if (!this.onlineAllowed() && missing.length > 0) return this.onlineDisabledReason();
      if (localFailed && seen.size === 1) {
        return '本地资料暂不可用，未找到扩展名称，本次仅使用原词';
      }
      if (supplement) return '未找到更多可靠名称，使用已有关键词';
      if (seen.size === 1) return '未找到扩展名称，仅使用原词';
      return '已使用本地名称';
    })();
    publish(VARIANT_LIMIT, state, '本地 / 缓存');
  }

  /**
   * Kotlin lines 68-102 — the concurrent online phase. Each part resolves
   * independently; a slow lookup cannot starve the others.
   */
  private async runOnline(
    _input: string,
    parts: string[],
    concepts: KeywordConcept[][],
    missing: number[],
    providers: Map<string, KeywordProviderState>,
    seen: Set<string>,
    publish: (cap: number, status: string, origin: string, preferred?: KeywordName[]) => void,
  ): Promise<{
    onlineAdded: boolean;
    persisted: boolean;
    cached: boolean;
    failed: boolean;
    ambiguous: boolean;
  }> {
    const responses = new AsyncQueue<[number, OnlineKeywordResult]>();
    let onlineAdded = false;
    let persisted = false;
    let cached = false;
    let failed = false;
    let ambiguous = false;
    let cancelled = false;

    const jobs: Promise<void>[] = missing.map(async (i) => {
      try {
        const updates =
          this.onlineEvents != null
            ? this.onlineEvents(parts[i] as string, concepts[i] as KeywordConcept[])
            : defaultOnlineEvents(this.online(parts[i] as string));
        for await (const result of updates) {
          if (cancelled) return;
          await responses.push([i, result]);
        }
      } catch {
        if (cancelled) return;
        await responses.push([
          i,
          {
            concepts: [],
            states: [{ provider: 'lookup', outcome: 'failed', retryAt: 0, detail: '' }],
            cached: false,
            persisted: false,
          },
        ]);
      }
    });
    // Kotlin `launch { jobs.forEach { it.join() }; responses.close() }`
    const closer = Promise.all(jobs).then(() => {
      responses.close();
    });

    const drain = (async (): Promise<void> => {
      for (;;) {
        const next = await responses.shift();
        if (next === null) break;
        const [i, result] = next;
        if (!this.onlineAllowed()) {
          // Kotlin: `jobs.forEach { it.cancel() }` then `break`
          cancelled = true;
          break;
        }
        for (const state of result.states) providers.set(state.provider, state);
        failed = [...providers.values()].some((it) => it.outcome === 'failed');
        ambiguous = [...providers.values()].some((it) => it.outcome === 'ambiguous');
        cached = cached || (result.cached && result.concepts.length > 0);
        persisted = persisted || result.persisted;
        const before = seen.size;
        const group = concepts[i] as KeywordConcept[];
        const merged = merge([...group, ...result.concepts]);
        // Fresh metadata receives its reserved slots before surplus local aliases.
        concepts[i] = merged;
        const allComplete = concepts.every((it) => complete(it));
        const preferred = parts.length === 1 ? result.concepts.flatMap((it) => it.names) : [];
        publish(
          allComplete ? VARIANT_LIMIT : 4,
          '正在在线补充名称',
          result.cached ? '缓存' : '在线',
          preferred,
        );
        onlineAdded = onlineAdded || (!result.cached && seen.size > before);
      }
    })();

    await drain;
    await closer;
    return { onlineAdded, persisted, cached, failed, ambiguous };
  }
}

/** Kotlin `flow { emit(OnlineKeywordResult(online(parts[i]))) }`. */
async function* defaultOnlineEvents(
  online: Promise<KeywordConcept[]>,
): AsyncGenerator<OnlineKeywordResult, void, void> {
  yield { concepts: await online, states: [], cached: false, persisted: false };
}

/** Kotlin `Channel(Channel.BUFFERED)` — unbounded FIFO with `close()`. */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  async push(value: T): Promise<void> {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(value);
      return;
    }
    this.items.push(value);
  }

  async shift(): Promise<T | null> {
    const item = this.items.shift();
    if (item !== undefined) return item;
    if (this.closed) return null;
    return new Promise<T | null>((resolve) => {
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

/**
 * Kotlin `withTimeoutOrNull(millis) { … } == null` — `null` when the block does
 * not settle inside `millis`. The timer is always cleared so a fast lookup
 * cannot leave a dangling timer that keeps the process alive.
 */
async function withTimeoutOrNull<T>(millis: number, block: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, millis);
  });
  try {
    return await Promise.race([block, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The status strings are the user-visible contract; exported for tests. */
export const KEYWORD_STATUS = {
  keptExpression: '保留手动搜索表达式，仅使用原词',
  searchingLocal: '正在查找本地名称',
  supplementing: '正在在线补充名称',
  usedCache: '已使用缓存',
  usedLocal: '已使用本地名称',
  localUnavailable: '本地资料暂不可用，未找到扩展名称，本次仅使用原词',
  noMoreNames: '未找到更多可靠名称，使用已有关键词',
  onlyOriginal: '未找到扩展名称，仅使用原词',
} as const;
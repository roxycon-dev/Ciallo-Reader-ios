import type { BookSource } from '@core/source/bookSource';
import type { SourceManager } from '@core/source/sourceManager';
import { isComicSource, isNovelSource } from '@core/source/sourceCapabilities';
import { withComicDetail } from '@core/source/comicInfo';
import { AsyncMutex } from '@core/library/contentMutationGate';
import { abortable } from '@core/download/abortable';
import { catalogRanges, discoverQuery, rangeStart, type DiscoverCatalog, type DiscoverEntry, type DiscoverPage,
  type DiscoverPartition, type DiscoverQuery } from './models';
import { categoryRoutes } from './taxonomy';
import type { DiscoverNavigation, DiscoverStore } from './store';

export interface DiscoverState {
  entries: DiscoverEntry[]; loading: boolean; more: string[]; errors: Record<string, string>;
  notices: Record<string, string>; cached: boolean; catalogs: Record<string, DiscoverCatalog>;
}
const initialState = (): DiscoverState => ({ entries: [], loading: false, more: [], errors: {}, notices: {}, cached: false, catalogs: {} });
interface Session { state: DiscoverState; navigation: DiscoverNavigation }
export function acceptsDiscoverSource(partition: DiscoverPartition, source: BookSource): boolean { return partition === 'COMIC' ? isComicSource(source) : isNovelSource(source); }

/** Progressive source publication, resumable cursors, bounded sessions, and stale-query cancellation. */
export class DiscoverController {
  private current = initialState();
  private listeners = new Set<() => void>();
  private selected = 'aggregate';
  private query = discoverQuery();
  private sources: BookSource[] = [];
  private generation = 0;
  private active: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();
  private key = '';
  private pages: Record<string, number> = {};
  private cursors: Record<string, string | null> = {};
  private history: Record<string, string[]> = {};
  private progress: Record<string, number> = {};
  private catalogOwners = new Map<string, BookSource>();
  private resolved = new Set<string>();
  private catalogLocks = new Map<string, AsyncMutex>();
  private sessions = new Map<string, Session>();
  private refreshTimes = new Map<string, number>();
  private viewports = new Map<string, number>();
  private metadataAttempts = new Map<string, number>();
  constructor(readonly manager: SourceManager, readonly store: DiscoverStore, readonly partition: DiscoverPartition,
    private readonly timeoutMs = 50_000) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): DiscoverState => this.current;
  private publish(patch: Partial<DiscoverState>): void { this.current = { ...this.current, ...patch }; for (const listener of this.listeners) listener(); }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = (): void => controller.abort(); parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) controller.abort();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try { return await abortable(Promise.resolve().then(() => operation(controller.signal)), controller.signal); }
    catch (error) { if (timedOut) throw new Error('连接较慢，请稍后重试'); throw error; }
    finally { clearTimeout(timeout); parent?.removeEventListener('abort', abort); }
  }
  private mergeCatalog(id: string, next: DiscoverCatalog): void {
    const old = this.current.catalogs[id];
    const capabilities: Record<string, string[]> = {};
    for (const key of new Set([...Object.keys(old?.capabilities ?? {}), ...Object.keys(next.capabilities)]))
      capabilities[key] = [...new Set([...(old?.capabilities[key] ?? []), ...(next.capabilities[key] ?? [])])];
    this.publish({ catalogs: { ...this.current.catalogs, [id]: { ...next, dated: next.dated || old?.dated === true,
      categories: next.categories.length ? next.categories : old?.categories ?? [], capabilities } } });
  }
  private async catalogFor(source: BookSource, dynamic: boolean, signal?: AbortSignal): Promise<DiscoverCatalog | null> {
    let lock = this.catalogLocks.get(source.id); if (!lock) { lock = new AsyncMutex(); this.catalogLocks.set(source.id, lock); }
    return lock.withLock(async () => {
      const previous = this.current.catalogs[source.id];
      if (this.catalogOwners.get(source.id) === source && previous && (!dynamic || !previous.dynamicCategories || this.resolved.has(source.id))) return previous;
      const result = await this.bounded((signal) => source.discoverCatalog(dynamic, signal), signal);
      if (signal?.aborted) return null;
      if (result.kind === 'error') return previous ?? null;
      this.catalogOwners.set(source.id, source);
      if (dynamic) this.resolved.add(source.id); else this.resolved.delete(source.id);
      this.mergeCatalog(source.id, result.data); return this.current.catalogs[source.id]!;
    });
  }
  async loadCategories(sourceId: string): Promise<void> {
    const source = this.manager.availableSources.value.find((source) => source.id === sourceId && acceptsDiscoverSource(this.partition, source));
    if (!source) return;
    try { await this.catalogFor(source, true, this.active?.signal); } catch { /* Existing category rows remain retryable. */ }
  }
  private navigation(): DiscoverNavigation {
    return { entryCount: this.current.entries.length, pages: { ...this.pages }, cursors: { ...this.cursors }, more: [...this.current.more],
      history: structuredClone(this.history), progress: { ...this.progress }, catalogs: this.current.catalogs };
  }
  private remember(): void {
    if (!this.key) return;
    this.sessions.delete(this.key); this.sessions.set(this.key, { state: { ...this.current, loading: false }, navigation: this.navigation() });
    while (this.sessions.size > 32 || this.sessions.size > 1 && [...this.sessions.values()].reduce((sum, session) => sum + session.state.entries.length, 0) > 8000)
      this.sessions.delete(this.sessions.keys().next().value!);
  }
  private restore(navigation: DiscoverNavigation): boolean {
    if (!navigation?.pages || !navigation.catalogs || this.sources.some((source) => !Number.isInteger(navigation.pages[source.id]) || !navigation.catalogs[source.id])) return false;
    this.pages = { ...navigation.pages }; this.cursors = { ...navigation.cursors }; this.history = structuredClone(navigation.history ?? {}); this.progress = { ...navigation.progress };
    this.publish({ more: (navigation.more ?? []).filter((id) => this.sources.some((source) => source.id === id)), catalogs: { ...this.current.catalogs, ...navigation.catalogs } });
    for (const source of this.sources) this.catalogOwners.set(source.id, source);
    return true;
  }
  configure(sourceId: string, query: Partial<DiscoverQuery> = {}, force = false): Promise<void> {
    const requested = discoverQuery(query);
    const sources = this.manager.availableSources.value.filter((source) => acceptsDiscoverSource(this.partition, source) && (sourceId === 'aggregate' || source.id === sourceId));
    const signature = sources.map((source) => `${source.id}@${'version' in source ? String(source.version) : ''}`).sort();
    const window = requested.dimension === 'UPDATES' && requested.feedId === null && requested.categoryId === null ? rangeStart(requested.range, Date.now()) ?? 0 : 0;
    const key = JSON.stringify([sourceId, requested.dimension, requested.range, requested.feedId, requested.categoryId, [...requested.standardCategories].sort(), requested.status, signature, window, 'port-v1']);
    if (!force && key === this.key) return this.pending;
    this.remember(); this.active?.abort(); const controller = new AbortController(); this.active = controller;
    const generation = ++this.generation; this.sources = sources; this.selected = sourceId; this.query = requested; this.key = key;
    this.pages = {}; this.cursors = {}; this.history = {}; this.progress = {};
    const session = this.sessions.get(key);
    if (!force && session) {
      this.publish(session.state); this.restore(session.navigation);
      return this.pending = this.fetch(sources.filter((source) => !(source.id in this.pages) && !(source.id in this.current.errors)), true, generation, controller.signal);
    }
    this.publish({ ...initialState(), catalogs: this.current.catalogs, loading: true });
    this.pending = (async () => {
      const saved = await this.store.readCache(key);
      if (generation !== this.generation) return;
      const start = requested.dimension === 'UPDATES' && requested.feedId === null && requested.categoryId === null ? rangeStart(requested.range, Date.now()) : null;
      const rows = (saved?.entries ?? []).filter((entry) => sources.some((source) => source.id === entry.book.sourceId) &&
        (start === null || entry.updatedAt !== null && entry.updatedAt >= start && entry.updatedAt <= Date.now()));
      this.publish({ entries: rows, cached: rows.length > 0 });
      if (!force && saved?.navigation && rows.length === saved.entries.length && saved.navigation.entryCount === rows.length && this.restore(saved.navigation)) {
        this.publish({ loading: false }); this.remember(); return;
      }
      await this.fetch(sources, false, generation, controller.signal);
    })().catch((error: unknown) => { if (generation === this.generation && !controller.signal.aborted) this.publish({ loading: false, errors: { ...this.current.errors, cache: error instanceof Error ? error.message : '发现加载失败' } }); });
    return this.pending;
  }
  refresh(): Promise<void> {
    if (this.current.loading || Date.now() - (this.refreshTimes.get(this.key) ?? 0) < 3000) return this.pending;
    this.refreshTimes.set(this.key, Date.now()); return this.configure(this.selected, this.query, true);
  }
  more(): Promise<void> {
    if (this.current.loading || !this.active) return this.pending;
    return this.pending = this.fetch(this.sources.filter((source) => this.current.more.includes(source.id) && !this.current.errors[source.id]), true, this.generation, this.active.signal);
  }
  retry(): Promise<void> {
    if (this.current.loading || !this.active) return this.pending;
    return this.pending = this.fetch(this.sources.filter((source) => this.current.errors[source.id]), true, this.generation, this.active.signal);
  }
  private async fetch(targets: BookSource[], append: boolean, generation: number, signal: AbortSignal): Promise<void> {
    if (!targets.length) { this.publish({ loading: false }); return; }
    this.publish({ loading: true }); const requested = this.query; let index = 0;
    const worker = async (): Promise<void> => {
      while (index < targets.length && !signal.aborted && generation === this.generation) {
        const source = targets[index++]!; const id = source.id, page = (this.pages[id] ?? 0) + 1;
        try {
          const dynamic = requested.standardCategories.length > 0 || requested.categoryId?.startsWith('dynamic:') === true;
          const catalog = await this.catalogFor(source, dynamic, signal);
          const routes = requested.categoryId === null && catalog ? categoryRoutes(catalog, new Set(requested.standardCategories)) : [];
          let data: DiscoverPage;
          if (requested.feedId === null && requested.categoryId === null && catalog && !catalogRanges(catalog, requested.dimension).includes(requested.range) &&
            (catalog.explicit || !catalog.feeds.length && !catalog.categories.length && Object.keys(catalog.capabilities).length > 0))
            data = { entries: [], hasMore: false, supported: false, notice: null, nextCursor: null, catalog, native: false };
          else {
            const result = await this.bounded((signal) => source.discover({ ...requested, page, cursor: this.cursors[id] ?? null, categoryIds: routes,
              offset: append ? this.current.entries.filter((entry) => entry.book.sourceId === id).length : 0 }, signal), signal);
            if (result.kind === 'error') throw result.exception; data = result.data;
          }
          if (generation !== this.generation || signal.aborted) return;
          const old = this.current.entries.filter((entry) => entry.book.sourceId === id);
          this.progress[id] = !append || data.entries.some((row) => !old.some((entry) => entry.book.id === row.book.id)) ? 0 : (this.progress[id] ?? 0) + 1;
          this.pages[id] = page;
          const existing = append ? this.current.entries : this.current.entries.filter((entry) => entry.book.sourceId !== id);
          const seen = new Set<string>();
          const entries = [...(data.supported ? data.entries : []), ...existing].filter((row) => {
            const key = JSON.stringify([row.book.sourceId, row.book.id]); if (seen.has(key)) return false; seen.add(key); return true;
          }).sort((a, b) => a.book.sourceId < b.book.sourceId ? -1 : a.book.sourceId > b.book.sourceId ? 1 : (a.nativeOrder ?? 2147483647) - (b.nativeOrder ?? 2147483647));
          const repeated = data.nextCursor !== null && (this.history[id] ?? []).includes(data.nextCursor);
          if (data.nextCursor !== null) this.history[id] = [...(this.history[id] ?? []), data.nextCursor]; this.cursors[id] = data.nextCursor;
          const more = this.current.more.filter((value) => value !== id);
          if (data.hasMore && data.supported && !repeated && this.progress[id]! < 2) more.push(id);
          const errors = { ...this.current.errors }; delete errors[id];
          const notices = { ...this.current.notices }; delete notices[id];
          if (!data.supported) notices[id] = data.notice ?? '该站未提供当前榜单或时间范围';
          else if (data.notice) notices[id] = data.notice;
          else if (!data.entries.length && !data.hasMore) notices[id] = '该站当前条件没有作品';
          if (data.catalog) this.mergeCatalog(id, data.catalog);
          this.publish({ entries, more, errors, notices, cached: Object.keys(errors).length > 0 });
          if (source.supportsDiscoverMetadata) void this.enrich(source, data.entries, generation, signal);
        } catch (error) {
          if (generation !== this.generation || signal.aborted) return;
          this.publish({ errors: { ...this.current.errors, [id]: error instanceof Error ? error.message : '加载失败' }, cached: this.current.entries.length > 0 });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    if (generation !== this.generation || signal.aborted) return;
    this.publish({ loading: false }); this.remember();
    if (this.current.entries.length) {
      try { await this.store.writeCache(this.key, this.current.entries, this.navigation()); }
      catch { /* Cache exhaustion must not discard online results. */ }
    }
  }
  private async enrich(source: BookSource, entries: DiscoverEntry[], generation: number, signal: AbortSignal): Promise<void> {
    for (const entry of entries.filter((entry) => !entry.book.comicInfo?.tags.length || !entry.book.comicInfo.status).slice(0, 8)) {
      if (signal.aborted || generation !== this.generation) return;
      const key = JSON.stringify([source.id, entry.book.id]);
      if (Date.now() - (this.metadataAttempts.get(key) ?? 0) < 60_000) continue;
      this.metadataAttempts.set(key, Date.now());
      while (this.metadataAttempts.size > 512) this.metadataAttempts.delete(this.metadataAttempts.keys().next().value!);
      try {
        const result = await this.bounded((signal) => source.getDiscoverMetadata(entry.book.id, signal), signal);
        if (result.kind !== 'success' || signal.aborted || generation !== this.generation) continue;
        this.publish({ entries: this.current.entries.map((row) => row.book.sourceId === source.id && row.book.id === entry.book.id ? { ...row, book: withComicDetail(row.book, result.data) } : row) });
      } catch { /* Metadata is optional; preserve the actual source row. */ }
    }
  }
  saveViewport(key: string, position: number): void { this.viewports.set(key, position); }
  viewport(key: string): number { return this.viewports.get(key) ?? 0; }
  dispose(): void { this.active?.abort(); this.generation++; this.listeners.clear(); }
}

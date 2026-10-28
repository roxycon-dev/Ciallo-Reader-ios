import { describe, expect, it, vi } from 'vitest';
import { ComicSource } from '@core/source/comicSource';
import { SourceManager } from '@core/source/sourceManager';
import { SourceResult } from '@core/source/sourceResult';
import { createSourceCapabilities } from '@core/source/sourceCapabilities';
import { createSearchBook } from '@core/source/searchBook';
import { createComicInfo } from '@core/source/comicInfo';
import { ParseError } from '@core/source/sourceException';
import { DiscoverController } from '@core/discover/controller';
import { DiscoverStore } from '@core/discover/store';
import { discoverCatalog, discoverEntry, discoverPage, mergeDiscoverEntries, parseDiscoverDate, personalizeWorks, rangeStart, type DiscoverPage, type DiscoverQuery } from '@core/discover/models';
import { classifyTags, matchesCategories, categoryRoutes } from '@core/discover/taxonomy';
import { discoverStatusScope } from '@core/discover/status';
import { MemoryFileSystem, MemorySecureStore } from '@platform/web-mock';

const book = (sourceId: string, id: string, title = id, author = '作者') => createSearchBook({ id, sourceId, title, author, format: 'comic' });
class Source extends ComicSource {
  name: string; capabilities = createSourceCapabilities({ supportComic: true });
  constructor(readonly id: string, readonly read: (query: DiscoverQuery) => Promise<DiscoverPage>) { super(); this.name = id; }
  async search() { return SourceResult.Success([]); }
  async getDetail(id: string) { return SourceResult.Success(book(this.id, id)); }
  async getDownloadInfo() { return SourceResult.Error(new ParseError('章节源')); }
  async login() { return SourceResult.Success(true); }
  async logout() {}
  async isLoggedIn() { return true; }
  async getChapters() { return SourceResult.Success([]); }
  async getChapterImages() { return SourceResult.Success([]); }
  override async discover(query: DiscoverQuery) { return SourceResult.Success(await this.read(query)); }
}
async function fixture(sources: Source[], now = Date.now) {
  const manager = new SourceManager(); for (const source of sources) await manager.registerSource(source);
  const fs = new MemoryFileSystem(), prefs = new MemorySecureStore();
  const store = new DiscoverStore('COMIC', prefs, fs, now); await store.load();
  return { manager, store, fs, prefs, controller: new DiscoverController(manager, store, 'COMIC', 1000) };
}

describe('current Android discovery behavior', () => {
  it('merges aliases with compatible authors and keeps conflicting canonical identities separate', () => {
    const first = { ...book('a', '1', '作品甲'), comicInfo: createComicInfo({ alternateTitles: ['Work A'] }) };
    const rows = [discoverEntry(first), discoverEntry(book('b', '2', 'Ｗｏｒｋ Ａ')), discoverEntry(book('c', '3', '作品甲', '另一位作者'))];
    const merged = mergeDiscoverEntries(rows, 'UPDATES');
    expect(merged.map((work) => work.variants.length).sort()).toEqual([1, 2]);
    expect(mergeDiscoverEntries([discoverEntry(first, { canonicalId: 'one' }), discoverEntry(book('b', '2', '作品甲'), { canonicalId: 'two' })], 'UPDATES')).toHaveLength(2);
  });
  it('assigns equal source rank budgets and never invents metrics for native browse rows', () => {
    const rows = Array.from({ length: 50 }, (_, index) => discoverEntry(book('large', String(index)), { clicks: 1_000_000 - index }));
    rows.push(discoverEntry(book('small', 'native'), { native: true, nativeOrder: 1 }));
    const merged = mergeDiscoverEntries(rows, 'CLICKS', false);
    expect(merged.find((work) => work.variants[0]!.book.id === '0')?.score).toBe(0.5);
    expect(merged.find((work) => work.variants[0]!.book.id === 'native')?.score).toBe(0.5);
    const native = merged.find((work) => work.variants[0]!.book.id === 'native')!.variants[0]!;
    expect(native.clicks).toBeNull(); expect(native.rank).toBeNull();
  });
  it('uses OR within a taxonomy facet and AND across facets without treating authors as genres', () => {
    expect(classifyTags(['作者:校园']).size).toBe(0);
    expect(classifyTags(['熱血', '校园青春']).has('action')).toBe(true);
    expect(classifyTags(['熱血', '校园青春']).has('school')).toBe(true);
    expect(matchesCategories(['冒险', '校园'], new Set(['adventure', 'school']))).toBe(true);
    expect(matchesCategories(['冒险'], new Set(['adventure', 'japan']))).toBe(false);
    expect(matchesCategories(['冒险', '日本漫画'], new Set(['adventure', 'japan']))).toBe(true);
    expect(categoryRoutes(discoverCatalog({ categories: [{ id: 'native-a', label: '冒险', group: '题材' }, { id: 'native-b', label: '日本', group: '地区' }] }), new Set(['adventure']))).toEqual(['native-a']);
  });
  it('honors local calendar windows, strict dates and negative completed labels', () => {
    const now = new Date(2026, 9, 28, 13, 15).getTime();
    expect(rangeStart('本周', now)).toBe(new Date(2026, 9, 26).getTime());
    expect(parseDiscoverDate('2026-02-30')).toBeNull();
    expect(parseDiscoverDate('2026-10-28')).toBe(new Date(2026, 9, 28).getTime());
    expect(parseDiscoverDate('2026-10-28T12:00:00.123456Z')).toBe(Date.parse('2026-10-28T12:00:00.123Z'));
    expect(discoverStatusScope('RANKING', '完结', null, null).effectiveStatus('连载')).toBe('完结');
    expect(discoverStatusScope('RANKING', '未完结', null, null).completedOnly).toBe(false);
    expect(discoverStatusScope('RANKING', '新作', null, null).effectiveStatus('完结')).toBe('全部');
  });
  it('only personalizes one adjacent close-score step and preserves exact native ranking', () => {
    const works = [1, 0.99, 0.98].map((score, index) => ({ key: String(index), variants: [discoverEntry(book('a', String(index)))], score }));
    expect(personalizeWorks(works, 'UPDATES', (work) => Number(work.key)).map((work) => work.key)).toEqual(['1', '0', '2']);
    expect(personalizeWorks(works, 'RANKING', () => 100)).toBe(works);
  });
  it('publishes a completed source before slow sources and drops late results after a query switch', async () => {
    let release!: (page: DiscoverPage) => void;
    const slow = new Source('slow', () => new Promise((resolve) => { release = resolve; }));
    const fast = new Source('fast', async (query) => discoverPage({ entries: [discoverEntry(book('fast', query.range))] }));
    const { controller } = await fixture([slow, fast]);
    const first = controller.configure('aggregate');
    await vi.waitFor(() => expect(controller.getSnapshot().entries[0]?.book.id).toBe('最新'));
    expect(controller.getSnapshot().loading).toBe(true);
    await controller.configure('fast', { range: '今日' });
    release(discoverPage({ entries: [discoverEntry(book('slow', 'stale'))] })); await first;
    expect(controller.getSnapshot().entries.map((entry) => entry.book.id)).toEqual(['今日']);
    controller.dispose();
  });
  it('restores complete offline navigation and stops a source that repeats its cursor', async () => {
    const read = vi.fn(async (query: DiscoverQuery) => discoverPage({ entries: [discoverEntry(book('a', String(query.page)))], hasMore: true, nextCursor: 'same' }));
    const { controller, manager, store } = await fixture([new Source('a', read)]);
    await controller.configure('a'); expect(controller.getSnapshot().more).toEqual(['a']);
    const restored = new DiscoverController(manager, store, 'COMIC', 1000); await restored.configure('a');
    expect(read).toHaveBeenCalledTimes(1); expect(restored.getSnapshot().cached).toBe(true);
    await restored.more(); expect(read.mock.calls[1]?.[0].page).toBe(2); expect(read.mock.calls[1]?.[0].cursor).toBe('same');
    expect(restored.getSnapshot().more).toEqual([]); controller.dispose(); restored.dispose();
  });
  it('expires disk caches, keeps novel preferences separate and unblocks shared identity groups safely', async () => {
    let now = 100_000;
    const { store, prefs, fs } = await fixture([], () => now);
    const work = mergeDiscoverEntries([discoverEntry(book('a', '1', '同书')), discoverEntry(book('b', '2', '同书'))], 'UPDATES')[0]!;
    store.block(work); expect(store.blockedWorks()[0]?.title).toBe('同书'); store.unblock(work.key); expect(store.selection('blocked').size).toBe(0);
    store.put('last_source', 'a'); await store.flush();
    const novels = new DiscoverStore('NOVEL', prefs, fs); await novels.load(); expect(novels.string('last_source', 'aggregate')).toBe('aggregate');
    await store.writeCache('query', work.variants, null); expect((await store.readCache('query'))?.entries).toHaveLength(2);
    now += 25 * 3_600_000; expect(await store.readCache('query')).toBeNull();
  });
});

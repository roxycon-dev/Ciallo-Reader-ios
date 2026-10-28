import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getLibraryRuntime, type LibraryRuntime } from '@core/library/libraryRuntime';
import type { DiscoverController } from '@core/discover/controller';
import { acceptsDiscoverSource } from '@core/discover/controller';
import { DISCOVER_DIMENSIONS, catalogRanges, compactMetric, discoverIdentity, discoverTags, mergeDiscoverEntries, normalizeIdentity,
  personalizeWorks, type DiscoverDimension, type DiscoverPartition, type DiscoverWork } from '@core/discover/models';
import { DISCOVER_CATEGORIES, DISCOVER_ALL_CATEGORIES, categoryLabels, matchesCategories } from '@core/discover/taxonomy';
import { discoverStatusScope, filterWorkStatus, serialLabel } from '@core/discover/status';
import type { FavoriteEntity } from '@core/library/favoriteTypes';
import type { SearchBook } from '@core/source/searchBook';
import { isKnownComicAuthor } from '@core/source/comicInfo';
import { getDiscoverRuntime } from '@platform/discoverRuntime';
import { shareFavorites } from '@ui/lib/shareFavorites';
import { useAppStore } from '@ui/state/appStore';
import { openOnlineBook } from '@ui/lib/openOnlineBook';
import { showToast } from '@ui/toast';
import { useFavoriteVisibility } from '@ui/hooks/useFavoriteVisibility';
import { getPrivacyService } from '@platform/privacyRuntime';
import { GlassCard } from '@ui/components/GlassCard';
import { SourceCover } from '@ui/components/discover/SourceCover';
import { DiscoverNovelDetails } from '@ui/components/discover/DiscoverNovelDetails';
import '../../styles/discover.css';

function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,[tabindex="0"]') ?? [])];
      if (!nodes.length) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous instanceof HTMLElement) previous.focus(); };
  }, [onClose]);
  return createPortal(<div className="discover-sheet-backdrop" onClick={onClose} role="presentation"><div ref={panel} className="discover-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
    <header><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header><div className="discover-sheet-content">{children}</div><button className="discover-primary" onClick={onClose}>完成</button></div></div>, document.body);
}

export function DiscoverPage({ refreshRequest = 0 }: { refreshRequest?: number }) {
  const [partition, setPartition] = useState<DiscoverPartition>('COMIC');
  const [loaded, setLoaded] = useState<{ partition: DiscoverPartition; controller: DiscoverController } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtime = getLibraryRuntime();
  useEffect(() => {
    let cancelled = false;
    if (!runtime?.sourceManager) return;
    void getDiscoverRuntime(runtime.sourceManager, partition).then((controller) => { if (!cancelled) setLoaded({ partition, controller }); })
      .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : '发现初始化失败'); });
    return () => { cancelled = true; };
  }, [runtime, partition]);
  if (!runtime || loaded?.partition !== partition) return <main className="discover-page"><p role={error ? 'alert' : 'status'}>{error ?? '正在准备发现…'}</p></main>;
  return <DiscoverPartitionPage key={partition} runtime={runtime} model={loaded.controller} partition={partition} onPartition={setPartition} refreshRequest={refreshRequest} />;
}

function DiscoverPartitionPage({ runtime, model, partition, onPartition, refreshRequest }: { runtime: LibraryRuntime; model: DiscoverController; partition: DiscoverPartition; onPartition(partition: DiscoverPartition): void; refreshRequest: number }) {
  const store = model.store, manager = model.manager;
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const revision = useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  const available = useSyncExternalStore(useCallback((listener) => manager.availableSources.subscribe(listener), [manager]), useCallback(() => manager.availableSources.value, [manager]));
  const [sourceId, setSourceId] = useState(() => store.string('last_source', 'aggregate'));
  const [dimension, setDimension] = useState<DiscoverDimension>(() => store.string('last_dimension', 'UPDATES') === 'RANKING' ? 'RANKING' : 'UPDATES');
  const [range, setRange] = useState(() => {
    const saved = store.string(`range_${dimension}`, DISCOVER_DIMENSIONS[dimension].ranges[0]);
    return (DISCOVER_DIMENSIONS[dimension].ranges as readonly string[]).includes(saved) ? saved : DISCOVER_DIMENSIONS[dimension].ranges[0];
  });
  const [feed, setFeed] = useState<string | null>(() => store.string(`feed_${sourceId}`, 'native') || null);
  const [category, setCategory] = useState<string | null>(() => store.string(`category_${sourceId}`, '') || null);
  const [selected, setSelected] = useState(() => [...store.selection('categories')].filter((id) => !DISCOVER_CATEGORIES.some((root) => root.id === id)));
  const [status, setStatus] = useState('全部');
  const [sheet, setSheet] = useState<'sources' | 'categories' | 'settings' | null>(null);
  const [choice, setChoice] = useState<DiscoverWork | null>(null);
  const [novel, setNovel] = useState<SearchBook | null>(null);
  const [favorites, setFavorites] = useState<FavoriteEntity[]>([]);
  const favoritesVisible = useFavoriteVisibility();
  const [scan, setScan] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const sentinel = useRef<HTMLDivElement | null>(null), scroll = useRef<HTMLElement | null>(null);
  const sources = available.filter((source) => acceptsDiscoverSource(partition, source));
  const signature = sources.map((source) => source.id).join('|');
  const actualSourceId = sourceId === 'aggregate' || sources.some((source) => source.id === sourceId) ? sourceId : 'aggregate';
  const catalog = state.catalogs[actualSourceId];
  const scope = discoverStatusScope(dimension, range, feed, category, catalog);
  const effectiveStatus = scope.effectiveStatus(status);
  const queryKey = JSON.stringify([actualSourceId, dimension, range, feed, category, selected, effectiveStatus]);
  const readingBooks = useAppStore((state) => state.books);
  const categories = useAppStore((state) => state.categories);
  const privacyService = getPrivacyService();
  const privacy = useSyncExternalStore(privacyService.subscribe, privacyService.getSnapshot, privacyService.getSnapshot);
  const preferences = useMemo(() => ({ revision, blocked: store.selection('blocked'), personalization: store.flag('personalization') }), [store, revision]);
  const layout = store.string('layout', 'GRID');
  const setRoute = useAppStore((state) => state.setRoute);
  useEffect(() => {
    let cancelled = false;
    void runtime.favorites?.favorites().then((items) => { if (!cancelled) setFavorites(items); });
    return () => { cancelled = true; };
  }, [runtime]);
  useEffect(() => {
    void model.configure(actualSourceId, { dimension, range, feedId: feed, categoryId: category, standardCategories: selected });
    store.put('last_source', actualSourceId); store.put('last_dimension', dimension); store.put(`range_${dimension}`, range);
    store.put(`feed_${actualSourceId}`, feed ?? ''); store.put(`category_${actualSourceId}`, category ?? ''); store.put('categories', new Set(selected));
  }, [model, store, actualSourceId, dimension, range, feed, category, selected, signature]);
  const rows = useMemo(() => {
    const blocked = preferences.blocked;
    const works = filterWorkStatus(mergeDiscoverEntries(state.entries, dimension, actualSourceId === 'aggregate'), effectiveStatus).filter((work) =>
      !blocked.has(work.key) && !work.variants.some((entry) => blocked.has(discoverIdentity(entry))) && matchesCategories(work.variants.flatMap((entry) => discoverTags(entry.book)), new Set(selected)));
    const authors = new Set((favoritesVisible ? favorites : []).filter((item) => isKnownComicAuthor(item.author)).map((item) => item.author));
    const protectedNames = new Set(categories.filter((item) => item.isProtected).map((item) => item.name));
    const reading = new Set(readingBooks.filter((book) => privacy.loaded && book.lastReadTime > 0 && !(privacy.enabled && protectedNames.has(book.category))).map((book) => normalizeIdentity(book.title)));
    return preferences.personalization && feed === null && category === null ? personalizeWorks(works, dimension, (work) =>
      (work.variants.some((entry) => authors.has(entry.book.author)) ? 1 : 0) - (work.variants.some((entry) => reading.has(normalizeIdentity(entry.book.title))) ? 1 : 0)) : works;
  }, [state.entries, actualSourceId, dimension, effectiveStatus, selected, preferences, favorites, favoritesVisible, readingBooks, privacy, categories, feed, category]);
  useEffect(() => {
    const root = scroll.current;
    if (!root) return;
    root.scrollTop = model.viewport(queryKey);
    return () => model.saveViewport(queryKey, root.scrollTop);
  }, [model, queryKey]);
  useEffect(() => {
    const element = sentinel.current; if (!element || state.loading || !state.more.length) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void model.more(); }, { root: scroll.current, rootMargin: '350px' });
    observer.observe(element); return () => observer.disconnect();
  }, [model, state.loading, state.more]);
  useEffect(() => {
    if (rows.length >= 4 || state.loading || !state.more.length || scan >= 3 || !(selected.length || effectiveStatus !== '全部' || !feed && dimension === 'UPDATES' && range !== '最新')) return;
    void model.more().then(() => setScan((value) => value + 1));
  }, [rows.length, state.loading, state.more, model, scan, selected.length, effectiveStatus, feed, dimension, range]);
  const closeSheet = useCallback(() => setSheet(null), []);
  const chooseSource = (id: string): void => { setSourceId(id); setFeed(store.string(`feed_${id}`, 'native') || null); setCategory(store.string(`category_${id}`, '') || null); setStatus('全部'); setScan(0); setSheet(null); };
  const chooseDimension = (next: DiscoverDimension): void => { setFeed(null); setCategory(null); setDimension(next); setRange(store.string(`range_${next}`, DISCOVER_DIMENSIONS[next].ranges[0])); setStatus('全部'); setScan(0); };
  const open = (book: SearchBook): void => {
    const source = manager.getSource(book.sourceId);
    if (!source?.capabilities.supportComic && !source?.capabilities.supportOnlineText) setNovel(book); else openOnlineBook(book);
  };
  const follow = (work: DiscoverWork): void => {
    if (!favoritesVisible) { showToast('请先在书架验证「我喜欢的」隐私密码'); return; }
    const repository = runtime.favorites; if (!repository) return;
    const followed = work.variants.filter((entry) => favorites.some((favorite) => favorite.sourceId === entry.book.sourceId && favorite.comicId === entry.book.id));
    void (async () => {
      if (followed.length) for (const entry of followed) await repository.remove(entry.book.sourceId, entry.book.id);
      else await repository.add(work.variants[0]!.book);
      setFavorites(await repository.favorites());
    })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '收藏保存失败'));
  };
  const activeCatalogs = sources.filter((source) => actualSourceId === 'aggregate' || source.id === actualSourceId).flatMap((source) => state.catalogs[source.id] ? [state.catalogs[source.id]!] : []);
  const ranges = [...DISCOVER_DIMENSIONS[dimension].ranges].filter((range) => !activeCatalogs.length || activeCatalogs.some((catalog) => catalogRanges(catalog, dimension).includes(range)));
  const refresh = useCallback((): void => { scroll.current?.scrollTo({ top: 0 }); void model.refresh(); setScan(0); }, [model]);
  const consumedRefresh = useRef(refreshRequest);
  useEffect(() => { if (consumedRefresh.current !== refreshRequest) { consumedRefresh.current = refreshRequest; refresh(); } }, [refreshRequest, refresh]);
  useEffect(() => {
    const root = scroll.current; if (!root) return;
    let start: { x: number; y: number } | null = null, distance = 0;
    const reset = (): void => { start = null; distance = 0; setPullDistance(0); };
    const begin = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!state.loading && root.scrollTop <= 0 && event.touches.length === 1 && touch) start = { x: touch.clientX, y: touch.clientY };
    };
    const move = (event: TouchEvent): void => {
      const touch = event.touches[0]; if (!start || !touch) return;
      const dy = touch.clientY - start.y;
      if (event.touches.length !== 1 || dy < 0 || Math.abs(touch.clientX - start.x) > Math.max(16, dy)) { reset(); return; }
      if (dy > 12 && event.cancelable) event.preventDefault();
      distance = Math.min(120, Math.max(0, dy - 12) * 0.55); setPullDistance(distance);
    };
    const end = (): void => { const shouldRefresh = distance >= 64; reset(); if (shouldRefresh) refresh(); };
    root.addEventListener('touchstart', begin, { passive: true }); root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', reset);
    return () => { root.removeEventListener('touchstart', begin); root.removeEventListener('touchmove', move); root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', reset); };
  }, [refresh, state.loading]);
  return <main className="discover-page" ref={scroll} data-testid="discover-page">
    {pullDistance > 0 && <p className="discover-pull" role="status" style={{ height: pullDistance }}>{pullDistance >= 64 ? '松开刷新' : '下拉刷新'}</p>}
    <header className="discover-header"><div><h1>发现</h1><p>DISCOVER YOUR NEXT STORY</p></div><button aria-label="发现设置" onClick={() => setSheet('settings')}>⚙</button></header>
    <div className="discover-partitions" role="tablist" aria-label="发现内容"><button role="tab" aria-selected={partition === 'COMIC'} onClick={() => onPartition('COMIC')}>漫画</button><button role="tab" aria-selected={partition === 'NOVEL'} onClick={() => onPartition('NOVEL')}>小说</button></div>
    <GlassCard className="discover-filters" padding={12}>
      <div className="discover-chips"><button aria-pressed={feed !== null || category !== null} onClick={() => { setFeed('native'); setCategory(null); setStatus('全部'); }}>原站推荐</button><button aria-pressed={feed === null && category === null && dimension === 'UPDATES'} onClick={() => chooseDimension('UPDATES')}>更新</button><button aria-pressed={feed === null && category === null && dimension === 'RANKING'} onClick={() => chooseDimension('RANKING')}>榜单</button></div>
      <div className="discover-toolbar"><button onClick={() => setSheet('sources')}>{actualSourceId === 'aggregate' ? '聚合发现' : manager.getSource(actualSourceId)?.name ?? '选择书源'} ▾</button><button onClick={() => { setSheet('categories'); if (actualSourceId !== 'aggregate') void model.loadCategories(actualSourceId); }}>分类{selected.length ? ` · ${selected.length}` : ''}</button><button aria-label="刷新发现" disabled={state.loading} onClick={refresh}>{state.loading ? '刷新中…' : '刷新'}</button></div>
      {!feed && !category && <div className="discover-chips" aria-label="榜单范围">{ranges.map((value) => <button key={value} aria-pressed={range === value} onClick={() => { setRange(value); setScan(0); }}>{value}</button>)}</div>}
      {feed && catalog && catalog.feeds.length > 1 && <label className="discover-select-label">原站频道<select aria-label="原站频道" value={feed} onChange={(event) => { setFeed(event.target.value); setCategory(null); setStatus('全部'); }}><option value="native">原站推荐</option>{catalog.feeds.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {!scope.completedOnly && !scope.newWorks && <div className="discover-chips" aria-label="连载状态">{['全部', '连载', '完结', '停更', '状态未知'].map((value) => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setScan(0); }}>{value}</button>)}</div>}
      {scope.hint && <p className="discover-muted">{scope.hint}</p>}
      {selected.length > 0 && <div className="discover-chips">{selected.map((id) => <button key={id} onClick={() => { setSelected((values) => values.filter((value) => value !== id)); setScan(0); }}>{DISCOVER_ALL_CATEGORIES.find((category) => category.id === id)?.label ?? id} ×</button>)}<button onClick={() => setSelected([])}>清空</button></div>}
    </GlassCard>
    {Object.keys(state.errors).length > 0 && <GlassCard className="discover-source-status"><p>部分书源暂时无法加载</p>{Object.entries(state.errors).map(([id, error]) => <p key={id}>{manager.getSource(id)?.name ?? id}：{error}</p>)}<button onClick={() => { void model.retry(); }}>重试失败书源</button></GlassCard>}
    {state.cached && <p className="discover-muted">正在显示离线缓存</p>}
    {!sources.length && <GlassCard><h2>还没有可用书源</h2><p>启用书源后，发现会展示原站提供的真实作品。</p><button onClick={() => setRoute('sourceManagement')}>书源管理</button></GlassCard>}
    {rows.length === 0 && !state.loading && sources.length > 0 && <GlassCard><h2>暂时没有符合条件的作品</h2>{Object.entries(state.notices).map(([id, text]) => <p key={id}>{manager.getSource(id)?.name ?? id}：{text}</p>)}<button onClick={() => { setSelected([]); setStatus('全部'); refresh(); }}>刷新</button></GlassCard>}
    <section className={`discover-results discover-results--${layout.toLowerCase()}`} aria-label="发现作品">{rows.map((work) => {
      const first = work.variants[0]!, book = first.book;
      const followed = favoritesVisible && work.variants.some((entry) => favorites.some((favorite) => favorite.sourceId === entry.book.sourceId && favorite.comicId === entry.book.id));
      const tags = categoryLabels(work.variants.flatMap((entry) => discoverTags(entry.book))).slice(0, 4);
      const time = work.variants.reduce<number | null>((latest, entry) => entry.updatedAt === null ? latest : Math.max(latest ?? 0, entry.updatedAt), null);
      const label = serialLabel(book.novelInfo?.status ?? book.comicInfo?.status);
      return <GlassCard key={work.key} className="discover-work" padding={0}><button className="discover-work-open" onClick={() => { if (work.variants.length > 1) setChoice(work); else open(book); }} aria-label={`打开 ${book.title}`}>
        <SourceCover url={book.cover} title={book.title} source={manager.getSource(book.sourceId)} /><div className="discover-work-copy"><h2>{book.title}</h2><p>{isKnownComicAuthor(book.author) ? book.author : '作者未提供'}</p><p className="discover-muted">{manager.getSource(book.sourceId)?.name ?? book.sourceId}{work.variants.length > 1 ? ` · ${work.variants.length} 个来源` : ''} · {label}</p>
        {tags.length > 0 && <div className="discover-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        {feed || category ? <p>{first.origin ?? first.subtitle ?? first.latestChapter ?? '原站推荐'}</p> : dimension === 'UPDATES' ? <p>{time === null ? '更新时间未提供' : new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}{first.latestChapter ? ` · ${first.latestChapter}` : ''}</p> : <p>{first.rank === null ? '名次未提供' : `原站第 ${first.rank} 名`}</p>}
        {(first.newEntry || first.rankChange !== null || first.growth !== null) && <p className={`discover-trend ${first.newEntry ? 'discover-trend-new' : (dimension === 'RANKING' ? first.rankChange ?? 0 : first.growth ?? 0) === 0 ? '' : ((dimension === 'RANKING' ? first.rankChange ?? 0 : first.growth ?? 0) > 0) !== store.flag('green_rise', false) ? 'discover-trend-rise' : 'discover-trend-fall'}`}>{first.newEntry && dimension === 'RANKING' ? 'NEW' : dimension === 'RANKING' ? first.rankChange === null || first.rankChange === 0 ? '—' : `${first.rankChange > 0 ? '↑' : '↓'}${Math.abs(first.rankChange)}` : first.growth === null || first.growth === 0 ? '—' : `${first.growth > 0 ? '▲' : '▼'}${Math.abs(first.growth).toFixed(1)}%`}</p>}
        {first.statistic && <p>{first.statistic}</p>}{dimension === 'DISCUSSION' && <p>讨论 {compactMetric(first.discussions)}</p>}{dimension === 'CLICKS' && <p>阅读 {compactMetric(first.clicks)}</p>}</div></button>
        <div className="discover-card-actions"><button aria-label={`${followed ? '取消喜欢' : '喜欢'} ${book.title}`} aria-pressed={followed} onClick={() => follow(work)}>{followed ? '♥ 已喜欢' : '♡ 喜欢'}</button><button onClick={() => store.block(work)}>屏蔽</button><button onClick={() => { void shareFavorites([{ sourceId: book.sourceId, comicId: book.id, title: book.title }]).catch((error: unknown) => showToast(error instanceof Error ? error.message : '分享失败，请重试')); }}>分享</button></div></GlassCard>;
    })}</section>
    <div ref={sentinel} className="discover-load-more">{state.loading ? <p role="status">正在加载原站作品…</p> : state.more.length > 0 ? <button onClick={() => { void model.more(); }}>加载更多</button> : rows.length > 0 ? <p>已显示当前可用作品</p> : null}</div>
    {sheet === 'sources' && <Sheet title="选择发现书源" onClose={closeSheet}><button className="discover-option" onClick={() => chooseSource('aggregate')}>聚合发现{actualSourceId === 'aggregate' ? ' ✓' : ''}</button>{sources.map((source) => <button className="discover-option" key={source.id} onClick={() => chooseSource(source.id)}>{source.name}{source.id === actualSourceId ? ' ✓' : ''}</button>)}<button className="discover-option" onClick={() => setRoute('sourceManagement')}>书源管理</button></Sheet>}
    {sheet === 'categories' && <Sheet title="发现分类" onClose={closeSheet}>{catalog && catalog.categories.length > 0 && <label>原站分类<select aria-label="原站分类" value={category ?? ''} onChange={(event) => { setCategory(event.target.value || null); setFeed(event.target.value ? null : 'native'); }}><option value="">不限原站分类</option>{catalog.categories.map((category) => <option key={category.id} value={category.id}>{category.group ? `${category.group} · ` : ''}{category.label}</option>)}</select></label>}{DISCOVER_CATEGORIES.map((root) => <section key={root.id}><h3>{root.label}</h3>{root.children.map((branch) => <div key={branch.id}><h4>{branch.label}</h4><div className="discover-chips">{[branch, ...branch.children].map((item) => <button key={item.id} aria-pressed={selected.includes(item.id)} onClick={() => { setSelected((values) => values.includes(item.id) ? values.filter((id) => id !== item.id) : [...values, item.id]); setScan(0); }}>{item.label}</button>)}</div></div>)}</section>)}</Sheet>}
    {sheet === 'settings' && <Sheet title="发现设置" onClose={closeSheet}><h3>浏览布局</h3><div className="discover-chips">{[['LIST', '列表'], ['GRID', '双列网格'], ['LARGE', '大图']].map(([value, label]) => <button key={value} aria-pressed={layout === value} onClick={() => store.put('layout', value!)}>{label}</button>)}</div><label><input type="checkbox" checked={store.flag('personalization')} onChange={(event) => store.put('personalization', event.target.checked)} />个性化推荐 · 结合喜欢的作品与阅读记录</label><label><input type="checkbox" checked={store.flag('green_rise', false)} onChange={(event) => store.put('green_rise', event.target.checked)} />绿涨红跌</label><label><input type="checkbox" checked={store.flag('cache')} onChange={(event) => { store.put('cache', event.target.checked); if (!event.target.checked) void store.clearCache(); }} />离线缓存</label><label>缓存有效期<select aria-label="缓存有效期" value={store.string('cache_hours', '24')} onChange={(event) => store.put('cache_hours', event.target.value)}>{[6, 24, 72].map((hours) => <option key={hours} value={hours}>{hours} 小时</option>)}</select></label><button onClick={() => { void store.clearCache().then(() => showToast('离线缓存已清除')); }}>清除离线缓存</button><h3>屏蔽管理</h3>{store.blockedWorks().length === 0 ? <p>还没有屏蔽作品</p> : store.blockedWorks().map((row) => <button className="discover-option" key={row.key} onClick={() => store.unblock(row.key)}>解除 · {row.title}</button>)}</Sheet>}
    {choice && <Sheet title="选择作品来源" onClose={() => setChoice(null)}>{choice.variants.map((entry) => <button className="discover-option" key={entry.book.sourceId} onClick={() => { setChoice(null); open(entry.book); }}>{manager.getSource(entry.book.sourceId)?.name ?? entry.book.sourceId} · {entry.book.title}</button>)}</Sheet>}
    {novel && <DiscoverNovelDetails key={`${novel.sourceId}::${novel.id}`} book={novel} runtime={runtime} onDismiss={() => setNovel(null)} />}
  </main>;
}

/**
 * MainViewModel 纯逻辑层单元测试 — 逐条对照 Android `MainViewModel.kt`。
 *
 * 覆盖：收藏聚合、无痕判定、导入分类归一、recordTime 切片、收藏队列串行化、
 * 换源文案、漫画进度校验、隐私 PIN、受保护分类名、阅读器懒加载窗口/合并/重映射、
 * 检索分批、删除撤销窗口、书签去重、逻辑↔物理索引换算。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORY,
  DeletionUndoWindow,
  MAX_RECORDED_SECONDS,
  PIN_LENGTH,
  PROGRESS_DEBOUNCE_MS,
  SEARCH_DEBOUNCE_MS,
  DELETE_UNDO_WINDOW_MS,
  UNDELETABLE_CATEGORY,
  accumulateSearchMatches,
  activeLogicalWindow,
  activePhysicalOrders,
  aggregateFavoriteItems,
  buildLogicalChapters,
  buildReplaceFavoriteMessage,
  buildSearchResults,
  collectProtectedCategoryNames,
  findExistingBookmark,
  formatDateKey,
  isIncognitoReading,
  isValidComicProgress,
  isValidPin,
  maxChapterOrder,
  normalizeAniListTitle,
  normalizeImportCategory,
  compactAniListTitle,
  MainViewModel,
  planRecordTime,
  pollFavoriteQueue,
  remapBookmarks,
  remapHighlights,
  resolveLogicalStart,
  shouldEnqueueFavorite,
  toPhysicalIndex,
  withTimeoutMs,
  withTimeoutOrNull,
  mergeActiveChapterContent,
} from '@core/app/mainViewModel';
import type { FavoriteEntity } from '@core/library/favoriteTypes';
import type { ChapterRow } from '@core/library/bookTypes';
import type { HighlightRow as Highlight } from '@core/library/readingSessionTypes';

function chapter(order: number, title: string, content: string): ChapterRow {
  return {
    id: order + 1,
    bookId: 1,
    chapterOrder: order,
    title,
    content,
    startCharIndex: 0,
    endCharIndex: content.length,
  };
}

function fav(sourceId: string, comicId: string, title = 'X'): FavoriteEntity {
  return {
    sourceId,
    comicId,
    title,
    author: '作者',
    cover: null,
    category: '默认',
    addedTime: 0,
    lastReadTime: 0,
  } as unknown as FavoriteEntity;
}

describe('formatDateKey', () => {
  it('pads month and day', () => {
    const d = new Date(2026, 0, 5);
    expect(formatDateKey(d.getTime())).toBe('2026-01-05');
  });

  it('uses local calendar fields (not UTC)', () => {
    const lateLocal = new Date(2026, 11, 31, 23, 30);
    expect(formatDateKey(lateLocal.getTime())).toBe('2026-12-31');
  });
});

describe('normalizeImportCategory', () => {
  it('maps legacy aggregate words to 默认', () => {
    expect(normalizeImportCategory('全部')).toBe(DEFAULT_CATEGORY);
    expect(normalizeImportCategory('未分类')).toBe(DEFAULT_CATEGORY);
  });

  it('keeps real categories', () => {
    expect(normalizeImportCategory('玄幻')).toBe('玄幻');
  });
});

describe('aggregateFavoriteItems', () => {
  it('counts downloaded chapters by source/comic key, comics only', () => {
    const favorites = [fav('s1', 'c1'), fav('s2', 'c2')];
    const progress = new Map([['s1::c1', null as never]]);
    const books = [
      { id: 1, title: 'a', category: '默认', isComic: true, sourceId: 's1', comicId: 'c1' },
      { id: 2, title: 'b', category: '默认', isComic: true, sourceId: 's1', comicId: 'c1' },
      { id: 3, title: 'c', category: '默认', isComic: true, sourceId: 's2', comicId: 'c2' },
      // 小说不算下载章节
      { id: 4, title: 'd', category: '默认', isComic: false, sourceId: 's1', comicId: 'c1' },
      // 缺 sourceId / comicId 不算
      { id: 5, title: 'e', category: '默认', isComic: true, sourceId: '', comicId: 'c1' },
    ];
    const items = aggregateFavoriteItems(favorites, progress, books);
    expect(items).toHaveLength(2);
    expect(items[0]?.downloadedChapters).toBe(2);
    expect(items[1]?.downloadedChapters).toBe(1);
  });

  it('passes progress through and defaults to null for a missing key', () => {
    const progress = new Map<string, never>([['s1::c1', { lastPageIndex: 3 } as never]]);
    const items = aggregateFavoriteItems(
      [fav('s1', 'c1'), fav('s2', 'c2')],
      progress,
      [],
    );
    expect(items[0]?.progress).toEqual({ lastPageIndex: 3 });
    expect(items[1]?.progress).toBeNull();
  });
});

describe('isIncognitoReading', () => {
  const book = { id: 1, title: 't', category: '私密' };

  it('global incognito flag always wins', () => {
    expect(isIncognitoReading(true, false, new Set(), book)).toBe(true);
    expect(isIncognitoReading(true, true, new Set(['私密']), book)).toBe(true);
  });

  it('protected category + privacy mode', () => {
    expect(isIncognitoReading(false, true, new Set(['私密']), book)).toBe(true);
    expect(isIncognitoReading(false, true, new Set(['其他']), book)).toBe(false);
  });

  it('not incognito without privacy mode', () => {
    expect(isIncognitoReading(false, false, new Set(['私密']), book)).toBe(false);
  });

  it('no selected book means not incognito', () => {
    expect(isIncognitoReading(false, true, new Set(['私密']), null)).toBe(false);
  });
});

describe('planRecordTime', () => {
  it('caps at 24h and splits by local day', () => {
    const end = new Date(2026, 0, 2, 12, 0, 0).getTime();
    const { recordTitle, slices } = planRecordTime(
      30 * 24 * 3600,
      end,
      { id: 1, title: '书名', category: '默认' },
      null,
      null,
    );
    expect(recordTitle).toBe('书名');
    expect(slices.length).toBeGreaterThan(1);
    // 切片总秒数不超过 24h 上限
    const total = slices.reduce((sum, s) => sum + s.seconds, 0);
    expect(total).toBeLessThanOrEqual(MAX_RECORDED_SECONDS);
  });

  it('falls back to title then 在线阅读', () => {
    const end = Date.now();
    expect(planRecordTime(60, end, null, '传入标题', null).recordTitle).toBe('传入标题');
    expect(planRecordTime(60, end, null, null, null).recordTitle).toBe('在线阅读');
  });

  it('onlineBook suppresses the selected book title (Android L1024)', () => {
    const end = Date.now();
    const { recordTitle } = planRecordTime(
      60,
      end,
      { id: 1, title: '本地书', category: '默认' },
      null,
      { sourceId: 's', id: 'c', title: '', author: '', cover: null } as never,
    );
    expect(recordTitle).toBe('在线阅读');
  });
});

describe('shouldEnqueueFavorite / pollFavoriteQueue', () => {
  const book = { sourceId: 's1', id: 'c1', title: 't', author: 'a', cover: null } as never;

  it('does not enqueue when idle', () => {
    expect(shouldEnqueueFavorite(false, null, book, [])).toBe(false);
  });

  it('enqueues a different book while a job runs', () => {
    expect(shouldEnqueueFavorite(true, null, book, [])).toBe(true);
  });

  it('does not duplicate the same book in queue', () => {
    expect(shouldEnqueueFavorite(true, null, book, [{ book, category: '默认', chapters: [] }])).toBe(false);
  });

  it('enqueues a different book while a request is pending', () => {
    const pending = { bookId: 's9::c9', sourceId: 's9', title: 'x', author: '', cover: null, category: '默认', chapters: [], favorites: [], candidates: [], busy: false, error: null };
    expect(shouldEnqueueFavorite(false, pending, book, [])).toBe(true);
    const samePending = { ...pending, bookId: 's1::c1', sourceId: 's1' };
    expect(shouldEnqueueFavorite(false, samePending, book, [])).toBe(false);
  });

  it('polls FIFO', () => {
    const q = [{ book, category: 'a', chapters: [] }, { book, category: 'b', chapters: [] }];
    expect(pollFavoriteQueue(q)?.category).toBe('a');
    expect(pollFavoriteQueue(q)?.category).toBe('b');
    expect(pollFavoriteQueue(q)).toBeUndefined();
  });
});

describe('buildReplaceFavoriteMessage', () => {
  it('reports migrated count', () => {
    expect(buildReplaceFavoriteMessage({ migrated: 3, unmatched: 0, resumeMatched: true })).toBe(
      '已替换收藏，迁移 3 话阅读标记与书签。新版本从对应话的第一页续读',
    );
  });

  it('adds the unmatched note when unmatched > 0', () => {
    expect(buildReplaceFavoriteMessage({ migrated: 0, unmatched: 2, resumeMatched: true })).toContain(
      '；未匹配记录仍保留在旧来源',
    );
  });

  it('adds the note when resume did not match', () => {
    expect(buildReplaceFavoriteMessage({ migrated: 1, unmatched: 0, resumeMatched: false })).toContain(
      '；未匹配记录仍保留在旧来源',
    );
  });
});

describe('isValidComicProgress', () => {
  const base = { sourceId: 's', comicId: 'c', chapterId: 'ch', chapterIndex: 0, pageIndex: 0, pageCount: 1 };

  it('accepts a fully populated input', () => {
    expect(isValidComicProgress(base)).toBe(true);
  });

  it('rejects blank ids (Android L260)', () => {
    expect(isValidComicProgress({ ...base, sourceId: '  ' })).toBe(false);
    expect(isValidComicProgress({ ...base, comicId: '' })).toBe(false);
    expect(isValidComicProgress({ ...base, chapterId: '  ' })).toBe(false);
  });

  it('exposes the 400ms debounce constant', () => {
    expect(PROGRESS_DEBOUNCE_MS).toBe(400);
  });
});

describe('privacy helpers', () => {
  it('validates 6-digit PINs', () => {
    expect(PIN_LENGTH).toBe(6);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12345a')).toBe(false);
  });

  it('collects protected category names only', () => {
    const set = collectProtectedCategoryNames([
      { name: '默认', isProtected: false },
      { name: '私密', isProtected: true },
      { name: '工作', isProtected: true },
    ]);
    expect(set.has('私密')).toBe(true);
    expect(set.has('工作')).toBe(true);
    expect(set.has('默认')).toBe(false);
  });
});

describe('AniList title normalization (delegates to TitleNormalizer)', () => {
  it('normalize: lowercase + punctuation→space + CJK fold, collapses spaces', () => {
    expect(normalizeAniListTitle('  Hello,  World! ')).toBe('hello world');
  });

  it('blank title stays blank', () => {
    expect(normalizeAniListTitle('   ')).toBe('');
    expect(compactAniListTitle('')).toBe('');
  });

  it('compact: normalize without spaces', () => {
    expect(compactAniListTitle('Hello, World!')).toBe('helloworld');
  });
});

describe('withTimeoutMs / withTimeoutOrNull', () => {
  it('resolves fast promises', async () => {
    await expect(withTimeoutMs(Promise.resolve(7), 1000, 'timeout')).resolves.toBe(7);
  });

  it('rejects slow promises with the message', async () => {
    await expect(
      withTimeoutMs(new Promise(() => {}), 10, '来源响应超时'),
    ).rejects.toThrow('来源响应超时');
  });

  it('withTimeoutOrNull swallows the timeout', async () => {
    await expect(withTimeoutOrNull(new Promise(() => {}), 10)).resolves.toBeNull();
  });
});

describe('chapterMerger helpers', () => {
  it('maxChapterOrder returns -1 for empty', () => {
    expect(maxChapterOrder([])).toBe(-1);
  });

  it('activeLogicalWindow clips at both ends', () => {
    expect(activeLogicalWindow(0, 5)).toEqual([0, 1]);
    expect(activeLogicalWindow(4, 5)).toEqual([3, 4]);
    expect(activeLogicalWindow(2, 5)).toEqual([1, 2, 3]);
    expect(activeLogicalWindow(0, 1)).toEqual([0]);
  });

  it('activePhysicalOrders expands logical window to physical orders', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aa', startCharIndex: 0, endCharIndex: 2 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'A (续)', content: 'bb', startCharIndex: 2, endCharIndex: 4 },
      { id: 3, bookId: 1, chapterOrder: 2, title: 'B', content: 'cc', startCharIndex: 4, endCharIndex: 6 },
    ]);
    // 「A」+「A (续)」合并为一个逻辑章 → logicalToPhysicalOrders = [[0,1],[2]]
    expect(mapping.logicalToPhysicalOrders).toEqual([[0, 1], [2]]);
    // 逻辑章 0 → 物理 0,1；逻辑章 1 → 物理 2
    expect(activePhysicalOrders([0], mapping)).toEqual([0, 1]);
    expect(activePhysicalOrders([0, 1], mapping)).toEqual([0, 1, 2]);
  });

  it('activePhysicalOrders dedupes overlapping windows', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'a', startCharIndex: 0, endCharIndex: 1 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'B', content: 'b', startCharIndex: 1, endCharIndex: 2 },
    ]);
    expect(activePhysicalOrders([0, 0, 1], mapping)).toEqual([0, 1]);
  });

  it('mergeActiveChapterContent only fills target chapters', () => {
    const meta = [
      chapter(0, 'A', 'aa'),
      chapter(1, 'B', 'bb'),
      chapter(2, 'C', 'cc'),
    ];
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aa', startCharIndex: 0, endCharIndex: 2 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'B', content: 'bb', startCharIndex: 2, endCharIndex: 4 },
      { id: 3, bookId: 1, chapterOrder: 2, title: 'C', content: 'cc', startCharIndex: 4, endCharIndex: 6 },
    ]);
    const parts = new Map([[1, chapter(1, 'B', 'BB')]]);
    const merged = mergeActiveChapterContent(meta, [1], mapping, parts);
    expect(merged[0]?.content).toBe('aa');
    expect(merged[1]?.content).toBe('BB');
    expect(merged[2]?.content).toBe('cc');
  });

  it('mergeActiveChapterContent concatenates split parts', () => {
    const meta = [{ id: 0, bookId: 1, chapterOrder: 0, title: '逻辑A', content: '', startCharIndex: 0, endCharIndex: 4 }];
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: '逻辑A', content: 'aa', startCharIndex: 0, endCharIndex: 2 },
      { id: 2, bookId: 1, chapterOrder: 1, title: '逻辑A (续)', content: 'bb', startCharIndex: 2, endCharIndex: 4 },
    ]);
    const parts = new Map([
      [0, chapter(0, '逻辑A', 'aa')],
      [1, chapter(1, '逻辑A (续)', 'bb')],
    ]);
    const merged = mergeActiveChapterContent(meta, [0], mapping, parts);
    expect(merged[0]?.content).toBe('aabb');
  });

  it('resolveLogicalStart maps physical→logical and offset', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aaaa', startCharIndex: 0, endCharIndex: 4 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'A (续)', content: 'bbbb', startCharIndex: 4, endCharIndex: 8 },
    ]);
    const r = resolveLogicalStart(mapping, 1, 2);
    expect(r.logicalStart).toBe(0);
    expect(r.logicalOffset).toBe(6); // 4 + 2
  });

  it('resolveLogicalStart clamps negative physical index', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'a', startCharIndex: 0, endCharIndex: 1 },
    ]);
    expect(resolveLogicalStart(mapping, -5, 0).logicalStart).toBe(0);
  });

  it('toPhysicalIndex inverts the mapping', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aa', startCharIndex: 0, endCharIndex: 2 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'A (续)', content: 'bb', startCharIndex: 2, endCharIndex: 4 },
      { id: 3, bookId: 1, chapterOrder: 2, title: 'B', content: 'c', startCharIndex: 4, endCharIndex: 5 },
    ]);
    expect(toPhysicalIndex(mapping, 0)).toBe(0);
    expect(toPhysicalIndex(mapping, 1)).toBe(2);
    expect(toPhysicalIndex(null, 9)).toBe(9);
  });

  it('remapBookmarks converts coordinates and cleans titles', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aaaa', startCharIndex: 0, endCharIndex: 4 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'A (续)', content: 'bbbb', startCharIndex: 4, endCharIndex: 8 },
    ]);
    const list = [{ id: 5, bookId: 1, chapterIndex: 1, scrollOffset: 1, title: 'A (续2)', snippet: '', createdTime: 0 }];
    const out = remapBookmarks(list, mapping);
    expect(out[0]?.chapterIndex).toBe(0);
    expect(out[0]?.scrollOffset).toBe(5);
    expect(out[0]?.title).toBe('A');
  });

  it('remapBookmarks passes through when no mapping', () => {
    const list = [{ id: 1, bookId: 1, chapterIndex: 3, scrollOffset: 9, title: 't', snippet: '', createdTime: 0 }];
    expect(remapBookmarks(list, null)).toEqual(list);
  });

  it('remapHighlights converts only the chapter index', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: 'A', content: 'aaaa', startCharIndex: 0, endCharIndex: 4 },
      { id: 2, bookId: 1, chapterOrder: 1, title: 'A (续)', content: 'bbbb', startCharIndex: 4, endCharIndex: 8 },
    ]);
    const list = [{ id: 1, bookId: 1, chapterIndex: 1, selectedText: 'x', note: '', colorHex: '#fff', createdTime: 0 } as unknown as Highlight];
    const out = remapHighlights(list, mapping);
    expect(out[0]?.chapterIndex).toBe(0);
  });
});

describe('accumulateSearchMatches', () => {
  it('counts occurrences and does not reach the 1000 cap on a small batch', () => {
    const batch = [chapter(0, 'A', '关键词 关键词 关键词')];
    const acc = accumulateSearchMatches(batch, '关键词', 0);
    expect(acc.count).toBe(3);
    expect(acc.reached).toBe(false);
    expect(acc.matches).toHaveLength(1);
  });

  it('reports reached once MAX_RESULTS (1000) is crossed', () => {
    const many = '关键词 '.repeat(1001);
    const acc = accumulateSearchMatches([chapter(0, 'A', many)], '关键词', 0);
    expect(acc.count).toBeGreaterThanOrEqual(1000);
    expect(acc.reached).toBe(true);
  });

  it('carries the running count across batches', () => {
    const batch = [chapter(0, 'A', '关键词'), chapter(1, 'B', '关键词')];
    const acc = accumulateSearchMatches(batch, '关键词', 5);
    expect(acc.count).toBe(7);
  });

  it('buildSearchResults emits one row per occurrence, logical index', () => {
    const mapping = buildLogicalChapters([
      { id: 1, bookId: 1, chapterOrder: 0, title: '第一话', content: '甲关键词乙关键词丙', startCharIndex: 0, endCharIndex: 9 },
    ]);
    const rows = buildSearchResults([chapter(0, '第一话', '甲关键词乙关键词丙')], '关键词', mapping);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.chapterIndex).toBe(0);
    expect(rows[0]?.occurrence).toBe(0);
    expect(rows[1]?.occurrence).toBe(1);
    expect(rows[0]?.chapterTitle).toBe('第一话');
  });

  it('buildSearchResults without mapping passes the order through', () => {
    const rows = buildSearchResults([chapter(4, '原题', '关键词')], '关键词', null);
    expect(rows[0]?.chapterIndex).toBe(4);
  });
});

describe('DeletionUndoWindow', () => {
  it('commits when not cancelled', async () => {
    const w = new DeletionUndoWindow();
    await expect(w.schedule('t1', 5)).resolves.toBe(true);
    expect(w.has('t1')).toBe(false);
  });

  it('does not commit when cancelled before the window', async () => {
    const w = new DeletionUndoWindow();
    const p = w.schedule('t2', 20);
    expect(w.cancel('t2')).toBe(true);
    await expect(p).resolves.toBe(false);
  });

  it('exposes the 8s window constant', () => {
    expect(DELETE_UNDO_WINDOW_MS).toBe(8000);
  });
});

describe('findExistingBookmark', () => {
  it('matches bookId 0 as "any book"', () => {
    const list = [
      { id: 1, bookId: 0, chapterIndex: 4, scrollOffset: 0, title: 't', snippet: '', createdTime: 0 },
      { id: 2, bookId: 9, chapterIndex: 5, scrollOffset: 0, title: 't', snippet: '', createdTime: 0 },
    ];
    expect(findExistingBookmark(list, 7, 4)?.id).toBe(1);
    expect(findExistingBookmark(list, 7, 5)).toBeUndefined();
    expect(findExistingBookmark(list, 9, 5)?.id).toBe(2);
  });
});

describe('MainViewModel class (constructor + state plumbing, no DB)', () => {
  function makeVm() {
    return new MainViewModel({
      repository: {} as never,
      favoriteRepository: {} as never,
      prefs: {} as never,
      privacy: {} as never,
    });
  }

  it('starts with Kotlin defaults', () => {
    const vm = makeVm();
    expect(vm.state.godMoments).toEqual([]);
    expect(vm.state.favoriteKeys.size).toBe(0);
    expect(vm.state.privacyModeEnabled).toBe(false);
    expect(vm.state.unlockedCategoryIds.size).toBe(0);
    expect(vm.state.hapticsEnabled).toBe(true);
    expect(vm.state.streakDays).toBe(0);
    expect(vm.state.todayReadSeconds).toBe(0);
  });

  it('reader selection starts empty', () => {
    const vm = makeVm();
    expect(vm.reader.selectedBook).toBeNull();
    expect(vm.reader.chapters).toEqual([]);
    expect(vm.reader.chapterMapping).toBeNull();
    expect(vm.reader.readerLoading).toBe(false);
    expect(vm.reader.isSearching).toBe(false);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const vm = makeVm();
    const seen: number[] = [];
    const off = vm.subscribe((s) => seen.push(s.streakDays));
    vm.setCategories([{ name: '私密', isProtected: true }]);
    expect(seen).toHaveLength(1);
    expect(vm.state.protectedCategoryNames.has('私密')).toBe(true);
    off();
    vm.setCategories([]);
    expect(seen).toHaveLength(1);
  });

  it('setIncognitoBrowsing updates state and persists', () => {
    const calls: boolean[] = [];
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {} as never,
      prefs: { setIncognitoBrowsingEnabled: (v: boolean) => { calls.push(v); return Promise.resolve(); } } as never,
      privacy: {} as never,
    });
    vm.setIncognitoBrowsing(true);
    expect(vm.state.incognitoBrowsingEnabled).toBe(true);
    expect(calls).toEqual([true]);
  });

  it('setFavoritesProtected updates state and persists', () => {
    const calls: boolean[] = [];
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {} as never,
      prefs: { setFavoritesProtected: (v: boolean) => { calls.push(v); return Promise.resolve(); } } as never,
      privacy: {} as never,
    });
    vm.setFavoritesProtected(true);
    expect(vm.state.favoritesProtected).toBe(true);
    expect(calls).toEqual([true]);
  });

  it('unlockCategory refuses when privacy mode is off', async () => {
    let verified = 0;
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {} as never,
      prefs: {} as never,
      privacy: { verifyPin: () => { verified += 1; return Promise.resolve(true); } } as never,
    });
    expect(await vm.unlockCategory(3, '123456')).toBe(false);
    expect(verified).toBe(0);
  });

  it('unlockCategory unlocks after a successful PIN check', async () => {
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {} as never,
      prefs: {} as never,
      privacy: { verifyPin: () => Promise.resolve(true) } as never,
    });
    vm.setStatePrivacyOn();
    expect(await vm.unlockCategory(3, '123456')).toBe(true);
    expect(vm.state.unlockedCategoryIds.has(3)).toBe(true);
  });

  it('saveComicProgress ignores blank ids and does not write', () => {
    let writes = 0;
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {
        saveProgress: () => { writes += 1; return Promise.resolve(); },
      } as never,
      prefs: {} as never,
      privacy: {} as never,
    });
    vm.saveComicProgress({ sourceId: ' ', comicId: 'c', chapterId: 'ch', chapterIndex: 0, pageIndex: 0, pageCount: 1 }, true);
    expect(writes).toBe(0);
  });

  it('saveComicProgress writes immediately when force=true', () => {
    const seen: number[] = [];
    const vm = new MainViewModel({
      repository: {} as never,
      favoriteRepository: {
        saveProgress: (_s: string, _c: string, _ch: string, _i: number, page: number) => { seen.push(page); return Promise.resolve(); },
      } as never,
      prefs: {} as never,
      privacy: {} as never,
    });
    vm.saveComicProgress({ sourceId: 's', comicId: 'c', chapterId: 'ch', chapterIndex: 0, pageIndex: 7, pageCount: 20 }, true);
    expect(seen).toEqual([7]);
  });

  it('annotateCoverValidity strips file:// and caches per key', () => {
    const probed: string[] = [];
    const vm = makeVm();
    const books = [
      { id: 1, title: 'a', category: '默认', coverUri: 'file:///data/1.jpg' },
      { id: 2, title: 'b', category: '默认', coverUri: '' },
    ];
    const out = vm.annotateCoverValidity(books, (path) => { probed.push(path); return true; });
    expect(out[0]?.isCoverValid).toBe(true);
    expect(out[1]?.isCoverValid).toBe(false);
    expect(probed).toEqual(['/data/1.jpg']);
    // 第二次命中缓存，不再探测
    const again = vm.annotateCoverValidity(books, (path) => { probed.push(path); return true; });
    expect(again[0]?.isCoverValid).toBe(true);
    expect(probed).toEqual(['/data/1.jpg']);
  });

  it('deleteCategory refuses to remove 默认', async () => {
    let deleted = 0;
    const vm = new MainViewModel({
      repository: { deleteCategoryRow: () => { deleted += 1; return Promise.resolve(); } } as never,
      favoriteRepository: {} as never,
      prefs: {} as never,
      privacy: {} as never,
    });
    expect(await vm.deleteCategory({ name: '默认' })).toBe(false);
    expect(deleted).toBe(0);
    expect(await vm.deleteCategory({ name: '玄幻' })).toBe(true);
    expect(deleted).toBe(1);
  });

  it('recordTime is a no-op under incognito browsing', () => {
    let writes = 0;
    const vm = new MainViewModel({
      repository: { addReadingTime: () => { writes += 1; return Promise.resolve(true); } } as never,
      favoriteRepository: {} as never,
      prefs: { setIncognitoBrowsingEnabled: () => Promise.resolve() } as never,
      privacy: {} as never,
    });
    vm.setIncognitoBrowsing(true);
    vm.recordTime(600, '书名');
    expect(writes).toBe(0);
  });

  it('recordTime ignores non-positive seconds', () => {
    let writes = 0;
    const vm = new MainViewModel({
      repository: { addReadingTime: () => { writes += 1; return Promise.resolve(true); } } as never,
      favoriteRepository: {} as never,
      prefs: {} as never,
      privacy: {} as never,
    });
    vm.recordTime(0);
    vm.recordTime(-5);
    expect(writes).toBe(0);
  });

  it('dispose cancels in-flight work and clears subscribers', () => {
    const vm = makeVm();
    let seen = 0;
    vm.subscribe(() => { seen += 1; });
    vm.dispose();
    vm.setCategories([]);
    expect(seen).toBe(0);
  });
});

describe('category constants', () => {
  it('默认分类不可删除', () => {
    expect(UNDELETABLE_CATEGORY).toBe('默认');
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });
});
/**
 * homeViewModel.test.ts — unit tests for the pure port of Android
 * `app/src/main/java/com/example/ui/HomeScreen.kt`.
 *
 * Kotlin line ranges under test are noted per `it(...)` block.
 * No React / DOM / Capacitor — `src/core/home/homeViewModel.ts` is pure TS.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_FAV_CATEGORY,
  CATEGORY_EMPTY_ACTION,
  DEFAULT_CATEGORY_DELETE_TOAST,
  DROP_PREFIX_CATEGORY,
  DROP_PREFIX_FAV_CATEGORY,
  DROP_TARGET_FAVORITE,
  DROP_TARGET_NEW,
  DRAG_HINT_MAX_SHOWS,
  EMPTY_FAVORITES_TITLE,
  EMPTY_SHELF_ACTION,
  EMPTY_SHELF_IMPORT_LABEL,
  EMPTY_SHELF_TITLE,
  FALLBACK_PROGRESS,
  FavoriteSort,
  LONG_PRESS_MS,
  SELECTED_SCALE,
  SHELF_KEY_FAV_PREFIX,
  bookActionsSpec,
  bookBreathPhase,
  bookCardProgressFraction,
  bookCardShowsProgress,
  bookCardVisual,
  categoryDeleteCopy,
  categoryEmptyDescription,
  categoryLockedTitle,
  currentlyReading,
  dragHintVisible,
  dropTargetOfCategory,
  dropTargetOfFavoriteCategory,
  endDrag,
  enterSelection,
  exitSelection,
  favoriteActionsSpec,
  favoriteCoverSrc,
  favoritesLocked,
  favCardMeta,
  favCustomCategories,
  favKeyOfBook,
  favShelfKey,
  favShelfKeys,
  filterFavoriteItems,
  filterShelfBooks,
  gridColumns,
  heroCategoryLocked,
  heroProgressPercent,
  homeBookFromRow,
  homeCategoryFromRow,
  isAllSelected,
  isFavShelfKey,
  isRecentAutoSelect,
  markedFinishedBooks,
  nextDragHintShown,
  orphanBooks,
  pickDropTarget,
  planDropToCategory,
  planDropToFavorite,
  planDropToFavoriteCategory,
  pruneSelection,
  rectContains,
  resolveCoverSrc,
  resolveShelfCategory,
  selectAllKeys,
  selectedCategoryLocked,
  selectableKeys,
  shareTitlesText,
  shelfAliveKeys,
  shelfHealLogMessage,
  sortFavoriteItems,
  sortShelfBooks,
  splitShelfKeys,
  streakDaysText,
  todayReadMinutes,
  todayReadTimeText,
  toggleKey,
  type HomeBook,
  type HomeCategory,
  type Rect,
} from '../../src/core/home/homeViewModel';
import type { BookRow, CategoryRow } from '../../src/core/library/bookTypes';
import {
  FAV_DEFAULT_CATEGORY,
  type ComicProgressEntity,
  type FavoriteEntity,
  type FavoriteItem,
} from '../../src/core/library/favoriteTypes';

/* ── fixtures ─────────────────────────────────────────────────────── */

function bookRow(overrides: Partial<BookRow> & Pick<BookRow, 'id' | 'title'>): BookRow {
  return {
    author: '作者',
    filePath: `/books/${String(overrides.id)}.txt`,
    coverUri: null,
    category: '默认',
    currentChapterIndex: 0,
    scrollOffset: 0,
    isFinished: 0,
    totalChapters: 100,
    contentType: 'NOVEL',
    addedTime: 0,
    lastReadTime: 0,
    sourceId: null,
    comicId: null,
    ...overrides,
  };
}

function book(overrides: Partial<HomeBook> & Pick<HomeBook, 'id' | 'title'>): HomeBook {
  return {
    author: '作者',
    filePath: '',
    coverUri: null,
    category: '默认',
    currentChapterIndex: 0,
    scrollOffset: 0,
    isFinished: false,
    totalChapters: 100,
    contentType: 'NOVEL',
    addedTime: 0,
    lastReadTime: 0,
    sourceId: null,
    comicId: null,
    isCoverValid: false,
    ...overrides,
  };
}

function category(overrides: Partial<HomeCategory> & Pick<HomeCategory, 'id' | 'name'>): HomeCategory {
  return { isProtected: false, ...overrides };
}

function favorite(overrides: Partial<FavoriteEntity> = {}): FavoriteEntity {
  return {
    sourceId: 'src-a',
    comicId: 'c1',
    title: '漫画甲',
    author: '作者',
    coverUrl: null,
    localThumbPath: null,
    serialStatus: 'ongoing',
    latestChapterId: 'ch-10',
    latestChapterTitle: '第 10 话',
    latestChapterUpdateAt: 0,
    lastCheckedAt: 0,
    sourceAlive: true,
    categoryName: FAV_DEFAULT_CATEGORY,
    favoritedAt: 0,
    sortOrder: 0,
    ...overrides,
  };
}

function favItem(overrides: Partial<FavoriteItem> = {}): FavoriteItem {
  return {
    favorite: favorite(),
    progress: null,
    downloadedChapters: 0,
    ...overrides,
  };
}

function progress(overrides: Partial<ComicProgressEntity> = {}): ComicProgressEntity {
  return {
    sourceId: 'src-a',
    comicId: 'c1',
    lastChapterId: 'ch-3',
    lastChapterIndex: 2,
    lastPageIndex: 0,
    lastPageCount: 0,
    lastReadAt: 0,
    seenTopChapterId: 'ch-3',
    seenChapterCount: 3,
    ...overrides,
  };
}

/* ── 115–183 参数模型 / MainViewModel.kt 79–92 聚合 ────────────────── */

describe('homeViewModel — room row mapping (HomeScreen.kt 119 params)', () => {
  it('homeBookFromRow mirrors Book.kt defaults and isComic derivation', () => {
    const novel = homeBookFromRow(bookRow({ id: 1, title: '深夜书屋' }), false);
    expect(novel.id).toBe(1);
    expect(novel.title).toBe('深夜书屋');
    expect(novel.author).toBe('作者');
    expect(novel.category).toBe('默认');
    expect(novel.isFinished).toBe(false);
    expect(novel.isCoverValid).toBe(false);
    expect(novel.contentType).toBe('NOVEL');

    const comic = homeBookFromRow(bookRow({ id: 2, title: '漫画乙', contentType: 'COMIC' }), true);
    expect(comic.isCoverValid).toBe(true);
    expect(comic.contentType).toBe('COMIC');
  });

  it('homeCategoryFromRow maps isProtected 0/1 (CategoryEntity)', () => {
    const row: CategoryRow = { id: 7, name: '悬疑', isProtected: 1 };
    expect(homeCategoryFromRow(row)).toEqual({ id: 7, name: '悬疑', isProtected: true });
  });

  it('resolveCoverSrc mirrors the content:// / file:// / path branches (1071–1081)', () => {
    expect(resolveCoverSrc(null, true)).toBeNull();
    expect(resolveCoverSrc('', true)).toBeNull();
    expect(resolveCoverSrc('content://media/1', true)).toBeNull();
    expect(resolveCoverSrc('/tmp/a.png', false)).toBeNull();
    expect(resolveCoverSrc('/tmp/a.png', true)).toBe('/tmp/a.png');
    expect(resolveCoverSrc('file:///tmp/a.png', true)).toBe('/tmp/a.png');
  });

  it('favoriteCoverSrc prefers localThumbPath over coverUrl (FavoritesPanel 346)', () => {
    expect(favoriteCoverSrc(favItem())).toBeNull();
    expect(
      favoriteCoverSrc(favItem({ favorite: favorite({ coverUrl: 'https://x/y.jpg' }) })),
    ).toBe('https://x/y.jpg');
    expect(
      favoriteCoverSrc(
        favItem({
          favorite: favorite({ coverUrl: 'https://x/y.jpg', localThumbPath: '/t.jpg' }),
        }),
      ),
    ).toBe('/t.jpg');
  });
});

/* ── 188–195 currentlyReading ──────────────────────────────────────── */

describe('currentlyReading (HomeScreen.kt 188–195)', () => {
  it('returns the Empty placeholder when the shelf is empty', () => {
    const result = currentlyReading([]);
    expect(result.id).toBe(-1);
    expect(result.title).toBe('Empty');
  });

  it('picks maxBy lastReadTime (ties keep the first entry)', () => {
    const books = [
      book({ id: 1, title: 'A', lastReadTime: 10 }),
      book({ id: 2, title: 'B', lastReadTime: 99 }),
      book({ id: 3, title: 'C', lastReadTime: 10 }),
    ];
    expect(currentlyReading(books).id).toBe(2);
  });
});

/* ── 212–221 分类回退 ──────────────────────────────────────────────── */

describe('resolveShelfCategory (HomeScreen.kt 212–221)', () => {
  it('keeps a valid selection', () => {
    expect(resolveShelfCategory('悬疑', ['默认', '悬疑'])).toBeNull();
  });

  it('does nothing while the category list is still empty', () => {
    expect(resolveShelfCategory('悬疑', [])).toBeNull();
  });

  it('falls back to 默认 when it exists', () => {
    expect(resolveShelfCategory('已删除', ['默认', '悬疑'])).toBe('默认');
  });

  it('falls back to the first real category when 默认 is missing', () => {
    expect(resolveShelfCategory('已删除', ['悬疑', '玄幻'])).toBe('悬疑');
  });
});

/* ── 299–305 / 1027–1034 隐私锁 ────────────────────────────────────── */

describe('privacy locks (HomeScreen.kt 243, 299–305, 1027–1034)', () => {
  const categories = [
    category({ id: 1, name: '默认', isProtected: true }),
    category({ id: 2, name: '悬疑' }),
  ];

  it('is open when privacy mode is off', () => {
    expect(
      selectedCategoryLocked({
        privacyModeEnabled: false,
        protectedCategoryNames: new Set(['默认']),
        unlockedCategoryIds: new Set<number>(),
        categories,
        categoryName: '默认',
      }),
    ).toBe(false);
  });

  it('locks a protected, still-unlocked category', () => {
    expect(
      selectedCategoryLocked({
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['默认']),
        unlockedCategoryIds: new Set<number>(),
        categories,
        categoryName: '默认',
      }),
    ).toBe(true);
  });

  it('stays locked on the initial-selection path (6.3 acceptance gap)', () => {
    expect(
      heroCategoryLocked({
        bookCategory: '默认',
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['默认']),
        unlockedCategoryIds: new Set<number>(),
        categories,
      }),
    ).toBe(true);
  });

  it('opens after the PIN unlock', () => {
    expect(
      heroCategoryLocked({
        bookCategory: '默认',
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['默认']),
        unlockedCategoryIds: new Set([1]),
        categories,
      }),
    ).toBe(false);
  });

  it('never locks a non-protected category', () => {
    expect(
      heroCategoryLocked({
        bookCategory: '悬疑',
        privacyModeEnabled: true,
        protectedCategoryNames: new Set(['默认']),
        unlockedCategoryIds: new Set<number>(),
        categories,
      }),
    ).toBe(false);
  });

  it('favoritesLocked requires protection AND privacy mode AND no unlock', () => {
    expect(favoritesLocked(true, true, false)).toBe(true);
    expect(favoritesLocked(true, true, true)).toBe(false);
    // 只在隐私模式整体开启时才上锁
    expect(favoritesLocked(true, false, false)).toBe(false);
    expect(favoritesLocked(false, true, false)).toBe(false);
  });
});

/* ── 314–333 过滤与排序 ────────────────────────────────────────────── */

describe('filterShelfBooks / sortShelfBooks (HomeScreen.kt 314–333)', () => {
  const books = [
    book({ id: 1, title: 'Zeta', category: '默认', lastReadTime: 5 }),
    book({ id: 2, title: 'alpha', category: '默认', lastReadTime: 50 }),
    book({ id: 3, title: 'Beta', category: '悬疑', lastReadTime: 99 }),
  ];

  it('returns nothing while the selected category is locked (6.3)', () => {
    expect(
      filterShelfBooks({
        books,
        selectedCategory: '默认',
        selectedCategoryLocked: true,
        debouncedQuery: '',
      }),
    ).toEqual([]);
  });

  it('filters by exclusive category ownership', () => {
    expect(
      filterShelfBooks({
        books,
        selectedCategory: '默认',
        selectedCategoryLocked: false,
        debouncedQuery: '',
      }).map((b) => b.id),
    ).toEqual([1, 2]);
  });

  it('matches title/author case-insensitively (debounced query)', () => {
    expect(
      filterShelfBooks({
        books,
        selectedCategory: '默认',
        selectedCategoryLocked: false,
        debouncedQuery: 'ALPHA',
      }).map((b) => b.id),
    ).toEqual([2]);
  });

  it('sort 0 keeps import order, 1 is title A-Z, 2 is recent read first', () => {
    expect(sortShelfBooks(books, 0).map((b) => b.id)).toEqual([1, 2, 3]);
    expect(sortShelfBooks(books, 1).map((b) => b.id)).toEqual([2, 3, 1]);
    expect(sortShelfBooks(books, 2).map((b) => b.id)).toEqual([3, 2, 1]);
  });
});

/* ── 337–357 「我喜欢的」筛选与排序 ─────────────────────────────────── */

describe('favorites filter / sort (HomeScreen.kt 337–357)', () => {
  const items = [
    favItem({
      favorite: favorite({ sourceId: 'a', comicId: '1', title: '乙', favoritedAt: 10 }),
    }),
    favItem({
      favorite: favorite({ sourceId: 'a', comicId: '2', title: '甲', favoritedAt: 20 }),
      progress: progress({ sourceId: 'a', comicId: '2', lastReadAt: 99 }),
    }),
    favItem({
      favorite: favorite({
        sourceId: 'a',
        comicId: '3',
        title: '丙',
        categoryName: '追更',
        latestChapterUpdateAt: 5,
      }),
    }),
  ];

  it('favCustomCategories hides the fallback 默认', () => {
    expect(favCustomCategories(['默认', '追更', '完结'])).toEqual(['追更', '完结']);
  });

  it('ALL_FAV_CATEGORY is the aggregate pseudo-category', () => {
    expect(ALL_FAV_CATEGORY).toBe('全部');
    expect(filterFavoriteItems(items, ALL_FAV_CATEGORY)).toHaveLength(3);
    expect(filterFavoriteItems(items, '追更').map((i) => i.favorite.comicId)).toEqual(['3']);
  });

  it('RECENT_FAVORITE sorts by favoritedAt desc', () => {
    expect(
      sortFavoriteItems(items, FavoriteSort.RECENT_FAVORITE).map((i) => i.favorite.comicId),
    ).toEqual(['2', '1', '3']);
  });

  it('RECENT_READ sorts by progress.lastReadAt desc', () => {
    expect(sortFavoriteItems(items, FavoriteSort.RECENT_READ).map((i) => i.favorite.comicId)).toEqual([
      '2',
      '1',
      '3',
    ]);
  });

  it('RECENT_UPDATE sorts by latestChapterUpdateAt desc', () => {
    expect(
      sortFavoriteItems(items, FavoriteSort.RECENT_UPDATE).map((i) => i.favorite.comicId),
    ).toEqual(['3', '1', '2']);
  });

  it('TITLE sorts by UTF-16 code units of lowercase (Kotlin sortedBy { it.title.lowercase() })', () => {
    // ⚠️ 这里刻意**不用** `localeCompare`：`String.compareTo` 是 UTF-16 码元比较，
    // 而 `localeCompare` 是区域敏感的（本机 locale = zh-CN，中文按拼音排），
    // 两者对中文书名给出完全不同的顺序。断言直接写死 Kotlin 的码元序。
    const titles = sortFavoriteItems(items, FavoriteSort.TITLE).map(
      (i) => i.favorite.title.codePointAt(0) as number,
    );
    // 丙 U+4E19 < 乙 U+4E59 < 甲 U+7532（丙的码点是 U+4E19，不是 U+4F19；U+4F19 是「伙」。拼音序会是 丙 → 甲 → 乙，两者不同）
    expect(titles).toEqual([0x4e19, 0x4e59, 0x7532]);
  });

  it('CUSTOM sorts by sortOrder', () => {
    const custom = [
      favItem({ favorite: favorite({ comicId: 'x', sortOrder: 2 }) }),
      favItem({ favorite: favorite({ comicId: 'y', sortOrder: 1 }) }),
    ];
    expect(sortFavoriteItems(custom, FavoriteSort.CUSTOM).map((i) => i.favorite.comicId)).toEqual([
      'y',
      'x',
    ]);
  });
});

/* ── 687–710 数据自愈 / 存活名单 ───────────────────────────────────── */

describe('orphanBooks / shelfAliveKeys (HomeScreen.kt 687–710)', () => {
  it('does nothing until categories arrive', () => {
    expect(orphanBooks([book({ id: 1, title: 'A', category: '孤儿' })], [])).toEqual([]);
  });

  it('rescues books whose category row disappeared', () => {
    const orphans = orphanBooks(
      [
        book({ id: 1, title: 'A', category: '默认' }),
        book({ id: 2, title: 'B', category: '没了' }),
      ],
      [category({ id: 1, name: '默认' })],
    );
    expect(orphans.map((b) => b.id)).toEqual([2]);
    expect(shelfHealLogMessage(1)).toBe('捞回 1 本掉进不存在分类的书');
  });

  it('aliveKeys mixes plain book ids and fav:: prefixed favorite keys', () => {
    const keys = shelfAliveKeys([book({ id: 5, title: 'A' })], [
      favItem({ favorite: favorite({ sourceId: 'a', comicId: '9' }) }),
    ]);
    expect([...keys].sort()).toEqual(['5', 'fav::a::9']);
  });
});

/* ── 1216–1220 / 1728–1748 / 2279–2283 书卡派生值 ─────────────────── */

describe('book card derivations (HomeScreen.kt 1216–1220, 1728–1748, 2279–2283)', () => {
  it('heroProgressPercent falls back to 32 when totalChapters <= 0', () => {
    expect(heroProgressPercent(book({ id: 1, title: 'A', currentChapterIndex: 5 }))).toBe(5);
    expect(
      heroProgressPercent(
        book({ id: 1, title: 'A', currentChapterIndex: 5, totalChapters: 0 }),
      ),
    ).toBe(FALLBACK_PROGRESS);
    expect(FALLBACK_PROGRESS).toBe(32);
  });

  it('bookCardShowsProgress only when started and not finished (1729)', () => {
    expect(bookCardShowsProgress(book({ id: 1, title: 'A', currentChapterIndex: 3 }))).toBe(true);
    expect(bookCardShowsProgress(book({ id: 1, title: 'A', currentChapterIndex: 0 }))).toBe(false);
    expect(bookCardShowsProgress(book({ id: 1, title: 'A', totalChapters: 0 }))).toBe(false);
    expect(
      bookCardShowsProgress(
        book({ id: 1, title: 'A', currentChapterIndex: 3, isFinished: true }),
      ),
    ).toBe(false);
  });

  it('bookCardProgressFraction clamps to 0..1 (1730–1732)', () => {
    expect(
      bookCardProgressFraction(book({ id: 1, title: 'A', currentChapterIndex: 50 })),
    ).toBe(0.5);
    expect(
      bookCardProgressFraction(book({ id: 1, title: 'A', currentChapterIndex: 500 })),
    ).toBe(1);
    expect(
      bookCardProgressFraction(
        book({ id: 1, title: 'A', currentChapterIndex: 1, totalChapters: 0 }),
      ),
    ).toBe(0);
  });

  it('favKeyOfBook returns null for manually imported books (2280–2283)', () => {
    expect(favKeyOfBook(book({ id: 1, title: 'A' }))).toBeNull();
    expect(favKeyOfBook(book({ id: 1, title: 'A', sourceId: ' ', comicId: 'c' }))).toBeNull();
    expect(favKeyOfBook(book({ id: 1, title: 'A', sourceId: 's', comicId: 'c' }))).toBe('s::c');
  });

  it('bookBreathPhase spreads ids across 0..2π (1513)', () => {
    expect(bookBreathPhase(0)).toBeCloseTo(0, 10);
    expect(bookBreathPhase(500)).toBeCloseTo(Math.PI, 10);
    expect(bookBreathPhase(1000)).toBeCloseTo(0, 10);
  });
});

/* ── 1464–1491 卡片视觉状态 ────────────────────────────────────────── */

describe('bookCardVisual (HomeScreen.kt 1464–1491)', () => {
  const base = {
    key: '7',
    phase: 'BROWSE' as const,
    selected: new Set<string>(),
    dragging: [] as string[],
    flyingHome: new Set<string>(),
    pressed: false,
  };

  it('browse phase is fully opaque and unscaled', () => {
    expect(bookCardVisual(base)).toEqual({ hidden: false, alpha: 1, scale: 1 });
  });

  it('selected scales IN (0.94) — never out', () => {
    const v = bookCardVisual({ ...base, selected: new Set(['7']) });
    expect(v.scale).toBeCloseTo(SELECTED_SCALE, 10);
    expect(SELECTED_SCALE).toBe(0.94);
  });

  it('dragged / flying-home cards are fully hidden', () => {
    expect(bookCardVisual({ ...base, dragging: ['7'] }).hidden).toBe(true);
    expect(bookCardVisual({ ...base, dragging: ['7'] }).alpha).toBe(0);
    expect(bookCardVisual({ ...base, flyingHome: new Set(['7']) }).hidden).toBe(true);
  });

  it('unselected cards dim to 0.85 only while multi-selecting', () => {
    expect(bookCardVisual({ ...base, phase: 'SELECTING' }).alpha).toBe(0.85);
    expect(
      bookCardVisual({ ...base, phase: 'SELECTING', selected: new Set(['7']) }).alpha,
    ).toBe(1);
  });
});

/* ── 2286–2298 / 2360–2363 文案与统计 ──────────────────────────────── */

describe('shareTitlesText / todayReadMinutes (HomeScreen.kt 2286–2298, 2360–2363)', () => {
  it('shareTitlesText keeps the Ciallo prefix and 《》 per title', () => {
    expect(shareTitlesText(['A', 'B'])).toBe('我在 Ciallo Reader里看：\n《A》\n《B》\n');
    expect(shareTitlesText([])).toBe('');
  });

  it('todayReadMinutes rounds to the nearest minute (±10 s tolerance)', () => {
    expect(todayReadMinutes(298)).toBe(5);
    expect(todayReadMinutes(302)).toBe(5);
    expect(todayReadMinutes(0)).toBe(0);
    expect(todayReadMinutes(30)).toBe(1);
    expect(todayReadTimeText(300)).toBe('今日已阅读 5 分钟');
  });

  it('streakDaysText', () => {
    expect(streakDaysText(7)).toBe('连续 7 天');
  });
});

/* ── 1018–1023 自适应列数 ──────────────────────────────────────────── */

describe('gridColumns (HomeScreen.kt 1018–1023)', () => {
  it('coerces to 3..6 with Kotlin integer division', () => {
    // (screenWidthDp + 24) / 150, truncated, then coerceIn(3, 6)
    expect(gridColumns(0)).toBe(3);
    expect(gridColumns(411)).toBe(3);
    expect(gridColumns(425)).toBe(3);
    expect(gridColumns(450)).toBe(3);
    expect(gridColumns(451)).toBe(3);
    expect(gridColumns(575)).toBe(3);
    expect(gridColumns(576)).toBe(4);
    expect(gridColumns(600)).toBe(4);
    expect(gridColumns(725)).toBe(4);
    expect(gridColumns(726)).toBe(5);
    expect(gridColumns(876)).toBe(6);
    expect(gridColumns(1026)).toBe(6);
    expect(gridColumns(2000)).toBe(6);
  });
});

/* ── 285–288 / 785–788 / 822–825 key 前缀分流 ─────────────────────── */

describe('shelf key helpers (HomeScreen.kt 285–288, 786–788, 1333–1335)', () => {
  it('favShelfKey / isFavShelfKey round-trip', () => {
    expect(favShelfKey('a::b')).toBe('fav::a::b');
    expect(SHELF_KEY_FAV_PREFIX).toBe('fav::');
    expect(isFavShelfKey('fav::a::b')).toBe(true);
    expect(isFavShelfKey('42')).toBe(false);
  });

  it('splitShelfKeys separates books from favorites', () => {
    expect(splitShelfKeys(['1', 'fav::a::b', '2'])).toEqual({
      bookKeys: ['1', '2'],
      favKeys: ['a::b'],
    });
  });

  it('drop target ids keep the Kotlin prefixes', () => {
    expect(dropTargetOfCategory('悬疑')).toBe('drop::cat::悬疑');
    expect(dropTargetOfFavoriteCategory('追更')).toBe('drop::favcat::追更');
    expect(DROP_TARGET_FAVORITE).toBe('drop::favorite');
    expect(DROP_TARGET_NEW).toBe('drop::new');
    expect(dropTargetOfCategory('x').startsWith(DROP_PREFIX_CATEGORY)).toBe(true);
    expect(dropTargetOfFavoriteCategory('x').startsWith(DROP_PREFIX_FAV_CATEGORY)).toBe(true);
  });
});

/* ── 402–445 / 772–849 落点与批量移动计划 ──────────────────────────── */

describe('drop plans (HomeScreen.kt 772–849)', () => {
  const books = [
    book({ id: 1, title: 'A', sourceId: 's', comicId: 'c' }),
    book({ id: 2, title: 'B' }),
  ];
  const favorites = [favItem({ favorite: favorite({ sourceId: 's', comicId: 'c' }) })];
  const categories = [category({ id: 1, name: '默认' }), category({ id: 2, name: '悬疑' })];

  it('refuses to drop onto a stale rectangle whose category no longer exists', () => {
    const plan = planDropToCategory({
      keys: ['1'],
      books,
      favoriteItems: favorites,
      categories,
      targetName: '已删除',
    });
    expect(plan.blockedReason).toBe('『已删除』不是可用的分类，没有移动');
    expect(plan.books).toEqual([]);
  });

  it('moves both books and favorites and records the favorite undo entries', () => {
    const plan = planDropToCategory({
      keys: ['1', 'fav::s::c'],
      books,
      favoriteItems: favorites,
      categories,
      targetName: '悬疑',
    });
    expect(plan.blockedReason).toBeNull();
    expect(plan.books.map((b) => b.id)).toEqual([1]);
    expect(plan.favKeys).toEqual(['s::c']);
    expect(plan.favUndo).toEqual([{ key: 's::c', category: FAV_DEFAULT_CATEGORY }]);
    expect(plan.total).toBe(2);
    expect(plan.message).toBe('已移动 2 本到『悬疑』');
  });

  it('planDropToFavorite skips source-less books and reports both counts (815)', () => {
    expect(planDropToFavorite(books)).toEqual({
      ok: 1,
      skipped: 1,
      message: '已喜欢 1 本，1 本无来源已跳过',
    });
    expect(planDropToFavorite([books[0] as HomeBook]).message).toBe('已加入我喜欢的 1 本');
  });

  it('planDropToFavoriteCategory reports the favorite-only move first (840–845)', () => {
    const plan = planDropToFavoriteCategory({
      keys: ['fav::s::c'],
      books,
      favoriteItems: favorites,
      targetName: '追更',
    });
    expect(plan.message).toBe('已移动 1 本到『追更』');
    expect(plan.favKeys).toEqual(['s::c']);
  });

  it('planDropToFavoriteCategory counts skipped source-less books', () => {
    const plan = planDropToFavoriteCategory({
      keys: ['2'],
      books,
      favoriteItems: favorites,
      targetName: '追更',
    });
    expect(plan.message).toBe('已加入『追更』0 本，1 本无来源已跳过');
  });
});

/* ── 1994–2089 操作栏动作 ─────────────────────────────────────────── */

describe('action bar specs (HomeScreen.kt 2008–2087)', () => {
  it('favorite scope always has exactly 4 actions; 打开 needs exactly 1 selection', () => {
    expect(favoriteActionsSpec(0)).toHaveLength(4);
    expect(favoriteActionsSpec(0).map((a) => a.label)).toEqual(['打开', '移动', '分享', '取消喜欢']);
    expect(favoriteActionsSpec(0)[0]?.enabled).toBe(false);
    expect(favoriteActionsSpec(1)[0]?.enabled).toBe(true);
    expect(favoriteActionsSpec(2)[0]?.enabled).toBe(false);
    expect(favoriteActionsSpec(3).find((a) => a.label === '取消喜欢')?.destructive).toBe(true);
  });

  it('book scope has exactly 4 actions and never 喜欢/取消喜欢', () => {
    const actions = bookActionsSpec(3);
    expect(actions.map((a) => a.label)).toEqual(['移动', '分享', '删除下载', '更多']);
    expect(actions.every((a) => a.enabled)).toBe(true);
    expect(bookActionsSpec(0).every((a) => !a.enabled)).toBe(true);
  });
});

/* ── 448–463 更多菜单 ──────────────────────────────────────────────── */

describe('markedFinishedBooks (HomeScreen.kt 454–457)', () => {
  it('only marks the books inside the current selection', () => {
    const books = [book({ id: 1, title: 'A' }), book({ id: 2, title: 'B' })];
    expect(markedFinishedBooks(books, ['2', '99']).map((b) => b.id)).toEqual([2]);
  });
});

/* ── 360–398 分类删除文案 ──────────────────────────────────────────── */

describe('categoryDeleteCopy (HomeScreen.kt 360–398)', () => {
  it('refuses to delete 默认', () => {
    const copy = categoryDeleteCopy('默认');
    expect(copy.isDefaultCategory).toBe(true);
    expect(copy.title).toBe('无法删除');
    expect(copy.text).toBe('默认分类不可删除。');
    expect(copy.confirmLabel).toBe('知道了');
    expect(copy.dismissLabel).toBeNull();
    expect(DEFAULT_CATEGORY_DELETE_TOAST).toBe('默认分类不可删除');
  });

  it('warns that books move to 默认', () => {
    const copy = categoryDeleteCopy('悬疑');
    expect(copy.title).toBe('删除分类');
    expect(copy.text).toBe('确定要删除分类「悬疑」吗？其中的书籍会移动到「默认」分类。');
    expect(copy.confirmLabel).toBe('删除');
    expect(copy.dismissLabel).toBe('取消');
  });
});

/* ── 1362–1422 / 1846–1886 / 974–1431 空态与锁定文案 ───────────────── */

describe('user-visible strings preserved verbatim', () => {
  it('locked copy', () => {
    expect(categoryLockedTitle('悬疑')).toBe('分类『悬疑』已锁定');
    expect(EMPTY_SHELF_TITLE).toBe('「书架空空如也」');
    expect(EMPTY_SHELF_IMPORT_LABEL).toBe('或者 导入本地 TXT / EPUB / Comic 文件');
    expect(EMPTY_SHELF_ACTION).toBe('立即前往在线书库');
    expect(categoryEmptyDescription('悬疑')).toBe(
      '在分类『悬疑』下还没有任何图书哦。您可以点击下方按钮导入新书到该分类！',
    );
    expect(CATEGORY_EMPTY_ACTION).toBe('在此分类下导入新书');
    expect(EMPTY_FAVORITES_TITLE).toBe('「还没有喜欢的漫画」');
  });

  it('drag hint caps at 3 shows (249 / 265–271)', () => {
    expect(DRAG_HINT_MAX_SHOWS).toBe(3);
    expect(LONG_PRESS_MS).toBe(350);
    expect(dragHintVisible('SELECTING', 0)).toBe(true);
    expect(dragHintVisible('SELECTING', 3)).toBe(false);
    expect(dragHintVisible('BROWSE', 0)).toBe(false);
    expect(nextDragHintShown(2)).toBe(3);
  });
});

/* ── ShelfMultiSelect.kt 状态机 ────────────────────────────────────── */

describe('shelf selection state machine (ShelfMultiSelect.kt 35–360)', () => {
  it('long press enters selection and locks the scope to the first pressed item', () => {
    const browsing = exitSelection();
    const selecting = enterSelection(browsing, '12', 1000);
    expect(selecting.phase).toBe('SELECTING');
    expect(selecting.scope).toBe('BOOK');
    expect(selecting.selected).toEqual(['12']);
  });

  it('a favorites scope rejects plain book keys (accepts, 75–79)', () => {
    const favScope = enterSelection(exitSelection(), 'fav::a::b', 0);
    expect(favScope.scope).toBe('FAV');
    expect(toggleKey(favScope, '12').selected).toEqual(['fav::a::b']);
  });

  it('isRecentAutoSelect swallows the lift right after the long press', () => {
    const s = enterSelection(exitSelection(), '12', 1000);
    expect(isRecentAutoSelect(s, 1100)).toBe(true);
    expect(isRecentAutoSelect(s, 5000)).toBe(false);
  });

  it('selectAllKeys never crosses the scope boundary (2130–2136)', () => {
    const favScope = enterSelection(exitSelection(), 'fav::a::b', 0);
    const all = selectAllKeys(favScope, ['1', '2', 'fav::a::b', 'fav::c::d']);
    expect(all.selected).toEqual(['fav::a::b', 'fav::c::d']);
    expect(all.phase).toBe('SELECTING');
  });

  it('selectableKeys / isAllSelected drive the top-bar 全选 pill', () => {
    const books = [book({ id: 1, title: 'A' })];
    const faves = [favItem({ favorite: favorite({ sourceId: 'a', comicId: '9' }) })];
    expect(selectableKeys('BOOK', books, faves)).toEqual(['1']);
    expect(selectableKeys('FAV', books, faves)).toEqual(['fav::a::9']);
    expect(isAllSelected([], [])).toBe(false);
    expect(isAllSelected(['1'], ['1'])).toBe(true);
    expect(isAllSelected(['1', '2'], ['1'])).toBe(false);
  });

  it('exitSelection clears everything (browse phase has no ghost hit zones)', () => {
    enterSelection(exitSelection(), '12', 0);
    const back = exitSelection();
    expect(back.phase).toBe('BROWSE');
    expect(back.selected).toEqual([]);
    expect(back.scope).toBeNull();
    expect(back.dragging).toEqual([]);
    expect(back.flyingHome).toEqual([]);
  });

  it('favShelfKeys prefixes every favorite key', () => {
    expect(
      favShelfKeys([
        favItem({ favorite: favorite({ sourceId: 'a', comicId: '1' }) }),
        favItem({ favorite: favorite({ sourceId: 'b', comicId: '2' }) }),
      ]),
    ).toEqual(['fav::a::1', 'fav::b::2']);
  });

  it('pruneSelection drops keys that left the current shelf/favorites set', () => {
    const s = enterSelection(exitSelection(), '1', 0);
    const moved = { ...s, selected: ['1', '2'] };
    const pruned = pruneSelection(moved, new Set(['2']));
    expect(pruned.selected).toEqual(['2']);
    // unchanged → identity preserved
    expect(pruneSelection(pruned, new Set(['2']))).toBe(pruned);
  });
});

/* ── ShelfMultiSelect.kt 150–174 / ShelfSelectionHost.kt 133–139 ────── */

describe('drop hit-testing (ShelfMultiSelect.kt 150–174)', () => {
  const rects = new Map<string, Rect>([
    ['drop::cat::悬疑', { left: 10, top: 100, right: 90, bottom: 140 }],
    ['drop::favorite', { left: 200, top: 100, right: 280, bottom: 140 }],
  ]);

  it('rectContains uses inclusive edges (Rect.contains semantics)', () => {
    const r = rects.get('drop::favorite') as Rect;
    expect(rectContains(r, 200, 100)).toBe(true);
    expect(rectContains(r, 280, 140)).toBe(true);
    expect(rectContains(r, 199, 100)).toBe(false);
  });

  it('picks the chip under the finger', () => {
    expect(
      pickDropTarget({ x: 50, y: 120, targetRects: rects, lastHoverId: null }),
    ).toBe('drop::cat::悬疑');
  });

  it('returns null in empty space', () => {
    expect(pickDropTarget({ x: 400, y: 400, targetRects: rects, lastHoverId: null })).toBeNull();
  });

  it('keeps a sticky hit within HYSTERESIS of the last target', () => {
    // 92 is just outside the chip (right edge 90) but within the 12 dp pad
    expect(
      pickDropTarget({ x: 92, y: 120, targetRects: rects, lastHoverId: 'drop::cat::悬疑' }),
    ).toBe('drop::cat::悬疑');
    // far away → the highlight is released
    expect(
      pickDropTarget({ x: 150, y: 120, targetRects: rects, lastHoverId: 'drop::cat::悬疑' }),
    ).toBeNull();
  });
});

describe('endDrag (ShelfSelectionHost.kt endDrag semantics)', () => {
  it('a valid drop leaves multi-select and clears dragging', () => {
    const selecting = enterSelection(exitSelection(), '1', 0);
    const dragging = { ...selecting, phase: 'DRAGGING' as const, dragging: ['1'] };
    const next = endDrag(dragging, 'drop::cat::悬疑');
    expect(next.phase).toBe('BROWSE');
    expect(next.dragging).toEqual([]);
    expect(next.flyingHome).toEqual([]);
  });

  it('a miss keeps the selection alive and flies the cards home', () => {
    const selecting = enterSelection(exitSelection(), '1', 0);
    const dragging = { ...selecting, phase: 'DRAGGING' as const, dragging: ['1'] };
    const next = endDrag(dragging, null);
    expect(next.phase).toBe('SELECTING');
    expect(next.flyingHome).toEqual(['1']);
    expect(next.selected).toEqual(['1']);
  });
});

/* ── FavoritesPanel.kt 301–313 / 442–447 收藏卡派生值 ───────────────── */

describe('favCardMeta (FavoritesPanel.kt 301–313, 442–447)', () => {
  it('更新 only when the snapshot id moved AND the parsed chapter number is ahead', () => {
    const meta = favCardMeta(
      favItem({ favorite: favorite({ latestChapterId: 'ch-10' }), progress: progress({ seenTopChapterId: 'ch-3' }) }),
    );
    expect(meta.latestNum).toBe(10);
    expect(meta.readNum).toBe(3);
    expect(meta.hasUpdate).toBe(true);
    expect(meta.unread).toBe(7);
    expect(meta.subtitle).toBe('更新至第 10 话 · 看到第 3 话');
    expect(meta.ratio).toBeCloseTo(0.3, 10);
  });

  it('suppresses 更新 when the user already read the latest number', () => {
    const meta = favCardMeta(
      favItem({
        favorite: favorite({ latestChapterId: 'ch-10-2' }),
        progress: progress({ lastChapterIndex: 9, seenTopChapterId: 'ch-3' }),
      }),
    );
    expect(meta.hasUpdate).toBe(false);
    expect(meta.unread).toBe(0);
  });

  it('dead source falls back to 来源暂不可用 (446)', () => {
    const meta = favCardMeta(
      favItem({
        favorite: favorite({ sourceAlive: false, latestChapterId: null, latestChapterTitle: null }),
      }),
    );
    expect(meta.dead).toBe(true);
    expect(meta.latestNum).toBeNull();
    expect(meta.subtitle).toBe('来源暂不可用');
  });

  it('a fresh favorite reads 尚未开始阅读 (446)', () => {
    const meta = favCardMeta(
      favItem({ favorite: favorite({ latestChapterId: null, latestChapterTitle: null }) }),
    );
    expect(meta.subtitle).toBe('尚未开始阅读');
    expect(meta.ratio).toBeNull();
  });

  it('unparsable chapter title falls back to 看到第 N 话 only (445)', () => {
    const meta = favCardMeta(
      favItem({
        favorite: favorite({ latestChapterTitle: '预告' }),
        progress: progress({ lastChapterIndex: 4 }),
      }),
    );
    expect(meta.latestNum).toBeNull();
    expect(meta.subtitle).toBe('看到第 5 话');
  });
});

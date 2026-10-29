/**
 * homeViewModel.ts — line-by-line port of Android
 * `app/src/main/java/com/example/ui/HomeScreen.kt` (2858 lines).
 *
 * SCOPE
 * -----
 * This module holds **only the pure, platform-free logic** that HomeScreen.kt
 * computes inline: filters, sorts, key encoding, selection state machine,
 * derived card metadata, drop planning and message strings.
 * It imports nothing from React / DOM / Capacitor (enforced by
 * `eslint.config.js` → `src/core/**` no-restricted-imports).
 *
 * KOTLIN → TS LINE MAP (HomeScreen.kt, 2858 lines)
 * --------------------------------------------------
 *   1–114    package/imports                              → imports (folded into per-symbol comments)
 *   115–117  @OptIn / @Composable / shared-transition       → SKIPPED: Compose compiler annotations, no runtime meaning
 *   118–183  fun HomeScreen(... 40 params ...)              → split: params that are data (books/categories/
 *                                                            favoriteItems/favoriteKeys/favoriteCategories) are read in
 *                                                            HomePage.tsx; params that are pure callbacks stay
 *                                                            callbacks there; params with no TS counterpart are
 *                                                            listed in the SKIP table at the bottom.
 *   184–186  sharedTransitionScope / animatedVisibilityScope→ SKIPPED: Compose shared-element animation; no web analogue
 *            streakDays by streakDaysFlow                  → HomePage.tsx `streakDays` state (async getter + listener)
 *   188–195  currentlyReading (maxByOrNull lastReadTime)   → `currentlyReading()`            [PORTED]
 *   197–199  searchQuery / debouncedQuery / isSearchExpanded→ HomePage.tsx useState
 *   201–205  LaunchedEffect(searchQuery){delay(300)}       → HomePage.tsx debounce useEffect (300 ms preserved)
 *   206–209  selectedCategory = shelfCategory (hoisted)    → HomePage.tsx prop + `resolveShelfCategory()`
 *   212–221  LaunchedEffect(categories) fallback           → `resolveShelfCategory()` + effect  [PORTED]
 *   222–235  dialog/sheet mutableStateOf handles           → HomePage.tsx useState
 *   238      favoriteCategory = ALL_FAV_CATEGORY           → `ALL_FAV_CATEGORY`                 [PORTED]
 *   239–245  favoritesUnlocked/favoritesPinFor/favoriteSort→ HomePage.tsx state + `FavoriteSort`
 *   243      favoritesLocked                               → `favoritesLocked()`                 [PORTED]
 *   247      rememberShelfSelectionState()                 → `createShelfSelection()`           [PORTED, pure]
 *   249      showDragHint                                  → HomePage.tsx (PreferencesManager counter)
 *   250      pendingNewCategoryKeys                        → HomePage.tsx state + `splitShelfKeys()`
 *   255–260  LaunchedEffect(Unit) check-favorite-updates   → HomePage.tsx effect (1500 ms preserved)
 *   261–271  drag-hint-once (max 3)                        → HomePage.tsx effect + `DRAG_HINT_MAX_SHOWS`
 *   274–275  bulkCategoryTarget / showMoreSheet            → HomePage.tsx state
 *   281–294  LaunchedEffect(categories) pending-new-cat    → HomePage.tsx effect + `splitShelfKeys()`
 *   299–305  selectedCategoryLocked (remember)             → `selectedCategoryLocked()`          [PORTED]
 *   309      breathingProgress (30fps sine clock)          → `SHELF_BREATH_*` + CSS animation  [PORTED as constants]
 *   314–322  filteredBooks remember                        → `filterShelfBooks()`                [PORTED]
 *   325–333  sortBy + sortedBooks remember                 → `SORT_LABELS` + `sortShelfBooks()` [PORTED]
 *   337–339  favCustomCategories remember                  → `favCustomCategories()`            [PORTED]
 *   340–343  favFiltered remember                          → `filterFavoriteItems()`            [PORTED]
 *   344–357  favSorted remember                            → `sortFavoriteItems()`              [PORTED]
 *   360–398  AlertDialog 删除分类                          → HomePage.tsx `CategoryDeleteDialog` [PORTED]
 *   402–445  CategoryPickerSheet (bulk move)               → HomePage.tsx `CategoryPickerSheet`  [PORTED]
 *   448–464  MoreActionSheet 标记为已读完/取消全选          → HomePage.tsx `MoreActionSheet`     [PORTED]
 *   467–501  AcrylicDialog 选择目标分类                    → HomePage.tsx `MoveBookDialog`      [PORTED]
 *   504–530  AcrylicDialog 移出此书                        → HomePage.tsx `DeleteBookDialog`    [PORTED]
 *   533–564  NewCategoryDialog (shelf + favorite)          → HomePage.tsx `NewCategoryDialog`   [PORTED]
 *   567–582  fav MoreActionSheet 重命名/删除                → HomePage.tsx `MoreActionSheet`     [PORTED]
 *   584–627  AcrylicDialog 重命名分类                      → HomePage.tsx `RenameCategoryDialog`[PORTED]
 *   629–658  AcrylicDialog 删除收藏分类                    → HomePage.tsx `DeleteFavCategoryDialog` [PORTED]
 *   661–675  PrivacyPinOverlay (favorites)                 → HomePage.tsx `PrivacyPinOverlay`   [PORTED]
 *   677–695  ShelfHeal orphan rescue                       → `orphanBooks()` + `SHELF_HEAL_LOG_TAG` [PORTED]
 *   705–710  shelfAliveKeys remember                       → `shelfAliveKeys()`                 [PORTED]
 *   713–740  booksGridRoot + booksFallbackHit             → SKIPPED: Compose-only grid geometry fallback; the DOM
 *                                                            hit-test in HomePage.tsx uses getBoundingClientRect and
 *                                                            therefore never needs the "grid is stale" workaround.
 *   742–764  breathing clock LaunchedEffect               → SKIPPED: per-frame Compose state clock; replaced by a CSS
 *                                                            keyframe animation driven by `bookBreathPhase()` (same
 *                                                            4 s period / ±3 dp amplitude / frozen while selecting).
 *   766      StarryNightBackground(showLamp = true)        → SKIPPED: read-only module `ui/adaptive` + `ui/glasskit`
 *   767–887  ShelfSelectionHost(...) + 8 drop callbacks    → HomePage.tsx `ShelfSelectionLayer` + `plan*` helpers  [PORTED]
 *   888–906  Box + favScope/favKeys/allSelected            → `favScope()`, `selectableKeys()`, `isAllSelected()` [PORTED]
 *   906–912  Column(statusBarsPadding/imePadding/padding)  → `.home-page` CSS box
 *   913–920  isDark / barBgColor / searchTextColor …      → SKIPPED: light theme is the only theme on web
 *                                                            (`MaterialTheme.colorScheme.background == DarkCharcoal`
 *                                                            is always false). See SKIP table.
 *   921–967  TabScreenHeader(MyBookshelf/BOOKSHELF & READING)→ HomePage.tsx `<TabScreenHeader>` + `.hp-header-search*` [PORTED]
 *   969      Spacer(12.dp)                                → `.home-page__gap-12`
 *   974–1017 whole-page empty state (MascotEmptyState)     → HomePage.tsx `<EmptyState>` w/ same strings  [STRINGS PORTED]
 *   1018–1023 cols = ((w+24)/150).coerceIn(3,6)           → `gridColumns()`                    [PORTED]
 *   1027–1034 heroCategoryLocked                          → `heroCategoryLocked()`             [PORTED]
 *   1036–1046 removed overlay + comments                  → SKIPPED: dead code in Android (overlay already removed)
 *   1048–1067 LazyVerticalGrid + userScrollEnabled        → CSS grid + `.home-page__grid`; drag locks `pointer-events`
 *                                                            1055–1056 → `.home-page__grid--drag-locked`  [PORTED]
 *   1068      item(key="hero_section")                     → `<section className="home-hero">` [PORTED]
 *   1071–1094 heroCoverData / heroImageRequest (Coil)      → `resolveCoverSrc()` + `<img onError>`  [PORTED]
 *   1096–1104 "正在阅读" 20sp bold serif                  → `.home-hero__title`                 [PORTED]
 *   1106–1254 GlassCard hero (cover/title/author/progress) → HomePage.tsx hero block            [PORTED]
 *   1216–1220 progressPercent (+32 fallback)              → `heroProgressPercent()`             [PORTED]
 *   1236      "已读 $progressPercent%"                    → same string                        [PORTED]
 *   1245–1251 AppActionButton 继续阅读 Primary Small      → `.hp-btn-continue`                  [PORTED]
 *   1258–1357 item(key="bookshelf_header") + pills        → `.home-shelf*` + `<CategoryPill>`  [PORTED]
 *   1360–1433 item(key="empty_state") (locked + mascot)   → HomePage.tsx `ShelfLockedRow` / `<EmptyState>`  [PORTED]
 *   1435–1752 item book card                              → HomePage.tsx `<ShelfBookCard>`     [PORTED]
 *   1464–1507 pressed / dragging / flyingHome / scales     → `bookCardVisual()` + CSS           [PORTED]
 *   1513      breathing phase hashCode                    → `bookBreathPhase()`                [PORTED]
 *   1522–1535 coverGradColors light branch                → CSS `.home-book-card__cover`       [PORTED (light only)]
 *   1540–1550 sharedElement book_cover_${id}              → SKIPPED: Compose shared transition
 *   1551–1567 consistentShadow / clip / gradient / border  → CSS box-shadow + border-radius    [PORTED]
 *   1573–1595 AsyncImage + horizontal sheen               → `<img>` + `__cover-sheen`          [PORTED]
 *   1596–1628 MenuBook fallback + 漫画/TXT label           → `.home-book-card__cover-*`         [PORTED]
 *   1630–1637 cover spine overlay                         → `.home-book-card__spine`           [PORTED]
 *   1640–1665 favKey heart badge (HeartArt)               → `favKeyOfBook()` + `.home-book-card__fav` [PORTED]
 *   1667–1674 (comments about original position)          → SKIPPED: comments only
 *   1680–1688 ShelfSelectBadge (BOOK scope only)          → HomePage.tsx `<ShelfSelectBadge>` [PORTED]
 *   1691–1702 title 12sp Medium 1 line                    → `.home-book-card__title`           [PORTED]
 *   1704–1726 已读完 gold ✓                               → `.home-book-card__finished`        [PORTED]
 *   1728–1748 chapter progress bar + "x/y 章"             → `bookCardProgress()` + CSS         [PORTED]
 *   1759–1843 item(key="fav_section_header")              → `.home-fav*`                       [PORTED]
 *   1846–1886 item(key="fav_locked")                      → HomePage.tsx `FavoritesLockedRow`  [PORTED]
 *   1887–1897 item(key="fav_empty_state")                → `<EmptyState>` same strings        [STRINGS PORTED]
 *   1899–1926 FavoriteCard items                          → HomePage.tsx `<FavoriteGridCard>` + `favCardMeta()` [PORTED]
 *   1928–1989 item(key="bottom_stats")                    → `.home-stats*`                     [PORTED]
 *   1932      padding(bottom = LocalAppBottomInset)       → `.home-stats { padding-bottom: … }` CSS
 *   1955      TodayReadTimeText(todayReadSecondsFlow)     → `todayReadMinutes()` + `.home-stats__today` [PORTED]
 *   1979      "连续 ${streakDays} 天"                    → same string                        [PORTED]
 *   1994–2089 MultiSelectActionBar (4+4 actions)          → HomePage.tsx `<MultiSelectActionBar>` [PORTED]
 *   2094–2096 browse-only 24.dp tail Spacer              → `.home-tail-spacer` (rendered iff phase===BROWSE) [PORTED]
 *   2100–2144 MultiSelectTopBar overlay                   → HomePage.tsx `<MultiSelectTopBar>` [PORTED]
 *   2137–2142 statusBarsPadding + removed solid bg        → `.hp-multiselect-topbar` (no solid bg, per comment)
 *   2149–2166 BookActionSheet (long press)                → HomePage.tsx `<BookActionSheet>`   [PORTED]
 *   2168–2188 CategoryActionSheet (long press category)   → HomePage.tsx `<CategoryActionSheet>` [PORTED]
 *   2190–2204 PrivacyPinOverlay (protected category)      → HomePage.tsx `PrivacyPinOverlay`   [PORTED]
 *   2207–2277 ShelfDragCover composable                   → HomePage.tsx `.hp-drag-ghost__cover` [PORTED]
 *   2279–2283 favKeyOf(book)                              → `favKeyOfBook()`                   [PORTED]
 *   2285–2298 shareTitles (Intent ACTION_SEND)            → `shareTitlesText()` + navigator.share  [PORTED]
 *   2300–2313 TodayReadTimeText                           → merged into 1955                 [PORTED]
 *   2315–2358 NewCategoryDialog composable                → HomePage.tsx `NewCategoryDialog`   [PORTED]
 *   2360–2363 todayReadMinutes(seconds)                   → `todayReadMinutes()`               [PORTED]
 *   2365–2420 HomeActionChip composable                   → HomePage.tsx `<ActionChip>` (existing Chips.tsx) [PORTED]
 *   2422–2475 HomeCategoryChip composable                 → SKIPPED: dead code — never referenced from HomeScreen.kt
 *                                                            (the category row uses `ui.shelf.CategoryPill`).
 *   2477–2634 CategoryActionSheet composable              → HomePage.tsx `<CategoryActionSheet>` [PORTED]
 *   2636–2857 BookActionSheet composable                  → HomePage.tsx `<BookActionSheet>`   [PORTED]
 *
 * SKIPPED WITH REASON (not ported)
 * -------------------------------
 *   • `com.example.LocalSharedTransitionScope` / `LocalNavAnimatedVisibilityScope` (184–185)
 *       Compose shared-element transitions; the web build has no equivalent API.
 *   • `StarryNightBackground`, `GlassDialogWindowEffect`, `filmGrain`, `iridescentBorder`,
 *     `liquidGlass`, `radialGlassScrim`, `rememberGlassPanelBackdrop`, `rememberIridescentColors`
 *     (766 and inside the dialogs) — all live in the read-only `ui/glasskit` + `ui/adaptive`
 *     modules which this task explicitly must not port. Flat CSS equivalents only.
 *   • `MascotEmptyState` + `MascotSpriteSheet` (1000–1007, 1424–1431, 1889–1896) — read-only
 *     `ui/mascot` module. All user-visible strings ARE preserved verbatim in HomePage.tsx.
 *   • Dark-theme branches (`isDark` ternaries at 914–919, 1522–1535, 1958–1960): the port is
 *     light-only (`#18191C` on `#FFFFFF`, primary `#059669`), matching the brief and
 *     `src/styles/theme.css`.
 *   • `Breathing` per-frame clock (750–764) and the Compose grid geometry fallback (713–740) —
 *     replaced by CSS animation + DOM hit-testing respectively (see line map above).
 *   • `booksFallbackHit` lambda (726–740) — the DOM equivalent is exact and needs no fallback.
 *   • `AppMotion` spring specs — expressed as CSS transition durations in `homePage.css`.
 *   • The 40 injected `HomeScreen` parameters that have no TS counterpart are enumerated in the
 *     `SKIPPED_HOME_PARAMS` table below.
 *
 * THIS-ROUND FIXES (line-by-line review, module = home + shelf + favorite)
 * ---------------------------------------------------------------------
 *   • `AUTO_SELECT_WINDOW_MS` 450 → **500**（ShelfMultiSelect.kt L213–214）。
 *   • 新增 `PICK_UP_MS = 250`（Motion.kt）—— ShelfMultiSelect.kt L561–563 的
 *     `withTimeout(if (phase == SELECTING) PICK_UP_MS else LONG_PRESS_MS)` 之前
 *     只落地了 LONG_PRESS_MS。
 *   • 新增 `longPressAction()`：ShelfMultiSelect.kt L601–628 的三分支派发
 *     （BROWSE→enter / 已选中→pickUp / 另一板块→reject / 否则→select）。
 *     之前浏览态长按直接 `enterSelection + beginDrag`，把两步并成了一步。
 *   • `SHELF_BREATH_PERIOD_MS = 4000` / `SHELF_BREATH_AMPLITUDE_DP = 3` 已在位，
 *     本轮核实与 L752–753 / L1514 一致（CSS 关键帧用三角波代替正弦，周期与幅度相同）。
 *   • `SELECTED_SCALE/PRESS_SCALE/DRAG_SCALE/DIM_UNSELECTED` 逐字核实（L1478 /
 *     L1490 / L1488 / L1504），无需改动。
 *   • `endDrag()` 的签名与"phase 由落点决定"的形状**保持不变**（有既有测试锚定），
 *     HomePage 侧改成按 Kotlin DropSink 的 `when` 分派：落到 ♡ / 非放置区传 `null`
 *     （= 保持 SELECTING + flyingHome），落到 ＋新建 / 分类 / 收藏分类传 target
 *     之后再 `exitSelection()`。
 *   • `SHIPPED_PARITY_TESTS` 见 `tests/unit/homeShelfParity.test.ts`（59 条）。
 */

import {
  CONTENT_TYPE_COMIC,
  DEFAULT_CATEGORY,
  type BookRow,
  type CategoryRow,
} from '@core/library/bookTypes';
import {
  ALL_FAV_CATEGORY_NAME,
  FAV_DEFAULT_CATEGORY,
  favoriteKey,
  type FavoriteEntity,
  type FavoriteItem,
} from '@core/library/favoriteTypes';
import type { ComicProgressEntity } from '@core/library/favoriteTypes';
import { chapterNumber } from '@core/library/comicReadingLogic';

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 238 + ui/favorite/FavoritesPanel.kt 251 — 伪分类
   ═══════════════════════════════════════════════════════════════════ */

/** 「全部」是筛选伪分类，不是真实分类行。 */
export const ALL_FAV_CATEGORY = ALL_FAV_CATEGORY_NAME;

/* ═══════════════════════════════════════════════════════════════════
   ui/shelf/ShelfSelectionHost.kt 113–135 — 落点 id 与多选 key 前缀
   ═══════════════════════════════════════════════════════════════════ */

export const DROP_TARGET_FAVORITE = 'drop::favorite';
export const DROP_TARGET_NEW = 'drop::new';
export const DROP_PREFIX_CATEGORY = 'drop::cat::';
export function dropTargetOfCategory(name: string): string {
  return `${DROP_PREFIX_CATEGORY}${name}`;
}
export const DROP_PREFIX_FAV_CATEGORY = 'drop::favcat::';
export function dropTargetOfFavoriteCategory(name: string): string {
  return `${DROP_PREFIX_FAV_CATEGORY}${name}`;
}

/**
 * 多选 / 拖拽名单里的 key 前缀。
 * ⚠️ 两类条目的 key 形态完全不同：书架书用 `book.id`，收藏用 `sourceId::comicId`，
 * 两者直接当字符串比较会发生误命中 —— 所以收藏一律带 `fav::` 前缀。
 */
export const SHELF_KEY_FAV_PREFIX = 'fav::';
export function favShelfKey(itemKey: string): string {
  return `${SHELF_KEY_FAV_PREFIX}${itemKey}`;
}
export function isFavShelfKey(key: string): boolean {
  return key.startsWith(SHELF_KEY_FAV_PREFIX);
}

/** ui/shelf/ShelfSelectionHost.kt 122–126 + ShelfMultiSelect.kt 135–138 */
export const EDGE_TICK_MS = 80;
export const EDGE_ARM_NS = 200_000_000;
export const HYSTERESIS = 12;
export const EDGE_BAND_DP = 96;

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 115–183 — 参数模型
   ═══════════════════════════════════════════════════════════════════ */

/** com/example/data/Book.kt 19–46 */
export interface HomeBook {
  id: number;
  title: string;
  author: string;
  filePath: string;
  coverUri: string | null;
  category: string;
  currentChapterIndex: number;
  scrollOffset: number;
  isFinished: boolean;
  totalChapters: number;
  contentType: string;
  addedTime: number;
  lastReadTime: number;
  sourceId: string | null;
  comicId: string | null;
  /** @androidx.compose.ui.Ignore var — file existence probe from MainViewModel.kt 474–483 */
  isCoverValid: boolean;
}

/** com/example/data/Book.kt 89–96 */
export interface HomeCategory {
  id: number;
  name: string;
  isProtected: boolean;
}

/* ═══════════════════════════════════════════════════════════════════
   Room 行 → HomeScreen.kt 参数模型
   ═══════════════════════════════════════════════════════════════════ */

export function homeBookFromRow(row: BookRow, isCoverValid: boolean): HomeBook {
  return {
    id: row.id ?? 0,
    title: row.title,
    author: row.author ?? '未知作者',
    filePath: row.filePath ?? '',
    coverUri: row.coverUri,
    category: row.category ?? DEFAULT_CATEGORY,
    currentChapterIndex: row.currentChapterIndex,
    scrollOffset: row.scrollOffset,
    isFinished: row.isFinished === 1,
    totalChapters: row.totalChapters,
    contentType: row.contentType,
    addedTime: row.addedTime,
    lastReadTime: row.lastReadTime,
    sourceId: row.sourceId,
    comicId: row.comicId,
    isCoverValid,
  };
}

export function homeCategoryFromRow(row: CategoryRow): HomeCategory {
  return {
    id: row.id ?? 0,
    name: row.name,
    isProtected: row.isProtected === 1,
  };
}

/**
 * MainViewModel.kt 474–483 — isCoverValid 的文件存在性探测路径。
 * `file://` 剥前缀，其余按原样（Android 侧就是直接 new File(path)）。
 */
export function coverFilePath(coverUri: string): string {
  return coverUri.startsWith('file://') ? coverUri.substring(7) : coverUri;
}

/**
 * MainViewModel.kt 79–92 — 收藏聚合（收藏 + 进度 + 已下载话数）。
 * downloadedChapters = 数据库里同 (sourceId, comicId) 的**漫画**书数量。
 */
export function assembleFavoriteItems(input: {
  favorites: ReadonlyArray<FavoriteEntity>;
  progressByKey: ReadonlyMap<string, ComicProgressEntity>;
  books: ReadonlyArray<HomeBook>;
}): FavoriteItem[] {
  const downloadedByKey = new Map<string, number>();
  for (const book of input.books) {
    if (book.contentType !== CONTENT_TYPE_COMIC) continue;
    if (book.sourceId === null || book.sourceId.trim() === '') continue;
    if (book.comicId === null || book.comicId.trim() === '') continue;
    const key = favoriteKey(book.sourceId, book.comicId);
    downloadedByKey.set(key, (downloadedByKey.get(key) ?? 0) + 1);
  }
  return input.favorites.map((favorite) => {
    const key = favoriteKey(favorite.sourceId, favorite.comicId);
    return {
      favorite,
      progress: input.progressByKey.get(key) ?? null,
      downloadedChapters: downloadedByKey.get(key) ?? 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 188–195 — currentlyReading
   ═══════════════════════════════════════════════════════════════════ */

export const EMPTY_BOOK_TITLE = 'Empty';

export function currentlyReading(books: ReadonlyArray<HomeBook>): HomeBook {
  if (books.length === 0) {
    return {
      id: -1,
      title: EMPTY_BOOK_TITLE,
      author: '',
      filePath: '',
      coverUri: null,
      category: DEFAULT_CATEGORY,
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: false,
      totalChapters: 0,
      contentType: 'NOVEL',
      addedTime: 0,
      lastReadTime: 0,
      sourceId: null,
      comicId: null,
      isCoverValid: false,
    };
  }
  // books.maxByOrNull { it.lastReadTime } ?: books.first()
  let best = books[0] as HomeBook;
  for (const book of books) {
    if (book.lastReadTime > best.lastReadTime) best = book;
  }
  return best;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 212–221 — 选中分类失效回退
   ═══════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ 第七轮第 6.1 条：不再有聚合视图"全部"——所选分类必须是真实存在的分类行；
 * 分类列表异步到达/删除后失效时回退到"默认"。返回 null 表示无需变更。
 */
export function resolveShelfCategory(
  selectedCategory: string,
  categoryNames: ReadonlyArray<string>,
): string | null {
  if (categoryNames.length === 0) return null;
  if (categoryNames.includes(selectedCategory)) return null;
  return categoryNames.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : (categoryNames[0] as string);
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 299–305 + 1027–1034 — 隐私锁判定
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 第七轮第 6.3 条验收缺口修复：受保护分类在"锁定"状态（隐私模式开启、标记保护、
 * 本进程未通过 PIN 解锁）时内容不得可见——包括重启后初始选中恰好是受保护分类的
 * 场景（旧逻辑只挡"切换进入"的点击，不挡默认选中直达）。
 */
export function selectedCategoryLocked(input: {
  privacyModeEnabled: boolean;
  protectedCategoryNames: ReadonlySet<string>;
  unlockedCategoryIds: ReadonlySet<number>;
  categories: ReadonlyArray<HomeCategory>;
  categoryName: string;
}): boolean {
  if (!input.privacyModeEnabled) return false;
  if (!input.protectedCategoryNames.has(input.categoryName)) return false;
  const row = input.categories.find((c) => c.name === input.categoryName);
  if (row === undefined) return false;
  return !input.unlockedCategoryIds.has(row.id);
}

/** Hero"正在阅读"卡片同样是内容泄漏面——其书籍所在分类锁定时整卡隐藏。 */
export function heroCategoryLocked(input: {
  bookCategory: string;
  privacyModeEnabled: boolean;
  protectedCategoryNames: ReadonlySet<string>;
  unlockedCategoryIds: ReadonlySet<number>;
  categories: ReadonlyArray<HomeCategory>;
}): boolean {
  return selectedCategoryLocked({ ...input, categoryName: input.bookCategory });
}

/**
 * HomeScreen.kt 243 — 只在隐私模式整体开启时才上锁：否则关掉隐私模式后这里会
 * 永远要求验证、又验证不过。
 */
export function favoritesLocked(
  favoritesProtected: boolean,
  privacyModeEnabled: boolean,
  favoritesUnlocked: boolean,
): boolean {
  return favoritesProtected && privacyModeEnabled && !favoritesUnlocked;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 314–322 + 327–333 — 书架过滤与排序
   ═══════════════════════════════════════════════════════════════════ */

/** 第七轮第 6.1/6.2 条：分类互斥单归属；6.3：锁定状态下的受保护分类不显示内容。 */
export function filterShelfBooks(input: {
  books: ReadonlyArray<HomeBook>;
  selectedCategory: string;
  selectedCategoryLocked: boolean;
  debouncedQuery: string;
}): HomeBook[] {
  if (input.selectedCategoryLocked) return [];
  const q = input.debouncedQuery;
  const lower = q.toLowerCase();
  return input.books.filter((book) => {
    const matchesCategory = book.category === input.selectedCategory;
    const matchesSearch =
      book.title.toLowerCase().includes(lower) || book.author.toLowerCase().includes(lower);
    return matchesCategory && matchesSearch;
  });
}

/** 书架排序：0=默认导入顺序 1=按标题 A-Z 2=最近阅读优先 */
export const SORT_LABELS = ['默认', 'A-Z', '最近'] as const;

/**
 * ⚠️ BUG FIXED：Kotlin `sortedBy { it.title.lowercase() }` 走的是
 * `String.compareTo` —— **UTF-16 码元比较**。之前这里写的是 `localeCompare`，
 * 它是**区域敏感**的：本机 Node/浏览器 locale 是 `zh-CN` 时，中文书名按**拼音**排
 * （丙 U+4F19 → 甲 U+7532 → 乙 U+4E59），而 Kotlin 的码元序是
 * （乙 U+4E59 → 丙 U+4F19 → 甲 U+7532）。两者对中文书名的排序结果完全不同，
 * 而本 App 的书名基本全是中文 —— 也就是「A-Z 排序」排出来的顺序与安卓不一致。
 *
 * ⚠️ 与 `@core/favorite/favoriteUi` 的 `compareKotlinLowercase` 是同一套语义
 * （那里早就是这么写的），本文件之前是不一致的那一份。
 *
 * 等价性理由：JS 的 `<` / `>` 字符串比较按 UTF-16 码元逐位比较，与
 * `java.lang.String.compareTo` 的实现完全一致。
 */
export function compareKotlinLowercase(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

export function sortShelfBooks(filteredBooks: ReadonlyArray<HomeBook>, sortBy: number): HomeBook[] {
  if (sortBy === 1) {
    return [...filteredBooks].sort((a, b) => compareKotlinLowercase(a.title, b.title));
  }
  if (sortBy === 2) {
    return [...filteredBooks].sort((a, b) => b.lastReadTime - a.lastReadTime);
  }
  return [...filteredBooks];
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 337–357 — 「我喜欢的」筛选与排序
   ═══════════════════════════════════════════════════════════════════ */

/** 自建的收藏分类（不含兜底的「默认」）：只有一个「默认」时不显示分类栏 */
export function favCustomCategories(favoriteCategories: ReadonlyArray<string>): string[] {
  return favoriteCategories.filter((name) => name !== FAV_DEFAULT_CATEGORY);
}

export function filterFavoriteItems(
  favoriteItems: ReadonlyArray<FavoriteItem>,
  favoriteCategory: string,
): FavoriteItem[] {
  if (favoriteCategory === ALL_FAV_CATEGORY) return [...favoriteItems];
  return favoriteItems.filter((item) => item.favorite.categoryName === favoriteCategory);
}

/** ui/favorite/FavoritesPanel.kt 75–81 — enum FavoriteSort(val label) */
export const FavoriteSort = {
  RECENT_FAVORITE: 0,
  RECENT_READ: 1,
  RECENT_UPDATE: 2,
  TITLE: 3,
  CUSTOM: 4,
} as const;

export type FavoriteSortCode = (typeof FavoriteSort)[keyof typeof FavoriteSort];

export const FAVORITE_SORT_LABELS: ReadonlyArray<string> = [
  '最近收藏',
  '最近阅读',
  '最近更新',
  '书名',
  '自定义',
];

export function sortFavoriteItems(
  favFiltered: ReadonlyArray<FavoriteItem>,
  favoriteSort: FavoriteSortCode,
): FavoriteItem[] {
  const list = [...favFiltered];
  switch (favoriteSort) {
    case FavoriteSort.RECENT_FAVORITE:
      return list.sort((a, b) => b.favorite.favoritedAt - a.favorite.favoritedAt);
    case FavoriteSort.RECENT_READ:
      return list.sort((a, b) => (b.progress?.lastReadAt ?? 0) - (a.progress?.lastReadAt ?? 0));
    case FavoriteSort.RECENT_UPDATE:
      return list.sort((a, b) => b.favorite.latestChapterUpdateAt - a.favorite.latestChapterUpdateAt);
    case FavoriteSort.TITLE:
      return list.sort((a, b) => compareKotlinLowercase(a.favorite.title, b.favorite.title));
    case FavoriteSort.CUSTOM:
    default:
      return list.sort((a, b) => a.favorite.sortOrder - b.favorite.sortOrder);
  }
}

/** ui/favorite/FavoritesPanel.kt 591–594 */
export function ensureFavoriteCategory(current: string, existing: ReadonlyArray<string>): string {
  if (existing.includes(current)) return current;
  if (existing.includes(FAV_DEFAULT_CATEGORY)) return FAV_DEFAULT_CATEGORY;
  return existing[0] ?? FAV_DEFAULT_CATEGORY;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 687–710 — 数据自愈 + 存活名单
   ═══════════════════════════════════════════════════════════════════ */

export const SHELF_HEAL_LOG_TAG = 'ShelfHeal';

/**
 * 数据自愈：把掉进「不存在的分类」的书捞回默认分类。
 *
 * ⚠️ 为什么会存在这种书：落点几何表只写不删，分类被删/改名后矩形仍然生效，
 * 手指划过那块空白会"命中"一个不存在的分类名，书就被写上了这个分类 ——
 * 于是它在**任何**分类下都不显示，用户眼里就是"书莫名其妙找不到了"。
 * 这些书在数据库里好好的，只是分类名是孤儿，所以能救回来。
 *
 * 只在分类列表已经加载出来之后才动手（否则一上来会把所有书都当孤儿）。
 */
export function orphanBooks(
  books: ReadonlyArray<HomeBook>,
  categories: ReadonlyArray<HomeCategory>,
): HomeBook[] {
  if (categories.length === 0) return [];
  const names = new Set(categories.map((c) => c.name));
  return books.filter((book) => !names.has(book.category));
}

export function shelfHealLogMessage(count: number): string {
  return `捞回 ${String(count)} 本掉进不存在分类的书`;
}

/**
 * 拖拽宿主用来裁剪几何表的"存活名单"。
 * 几何表只写不删：书被移动到别的分类后它的矩形会永久留下，变成点不动/选不中的
 * 幽灵热区。所以每次书目变化都要把"现在真实存在的 key"交给宿主裁一遍。
 */
export function shelfAliveKeys(
  sortedBooks: ReadonlyArray<HomeBook>,
  favSorted: ReadonlyArray<FavoriteItem>,
): Set<string> {
  const s = new Set<string>();
  for (const book of sortedBooks) s.add(String(book.id));
  for (const item of favSorted) s.add(favShelfKey(item.favorite.sourceId + '::' + item.favorite.comicId));
  return s;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 1216–1220 / 1728–1748 / 2279–2283 — 书卡派生值
   ═══════════════════════════════════════════════════════════════════ */

/** Android fallback progress when totalChapters <= 0 → 32 */
export const FALLBACK_PROGRESS = 32;

export function heroProgressPercent(book: HomeBook): number {
  if (book.totalChapters > 0) {
    return Math.floor((book.currentChapterIndex * 100) / book.totalChapters);
  }
  return FALLBACK_PROGRESS;
}

/** 阅读进度条（已开始阅读且未完成时显示） */
export function bookCardProgressFraction(book: HomeBook): number {
  const raw = book.currentChapterIndex / book.totalChapters;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

export function bookCardShowsProgress(book: HomeBook): boolean {
  return book.totalChapters > 0 && book.currentChapterIndex > 0 && !book.isFinished;
}

/** 书架里的书 → 「我喜欢的」关联键；无来源（手动导入）的书返回 null。 */
export function favKeyOfBook(book: HomeBook): string | null {
  if (book.sourceId !== null && book.sourceId.trim() !== '' &&
      book.comicId !== null && book.comicId.trim() !== '') {
    return `${book.sourceId}::${book.comicId}`;
  }
  return null;
}

/**
 * HomeScreen.kt 1513 — 呼吸动画相位。
 * `val phase = (book.id.hashCode() % 1000) / 1000f * 2f * Math.PI.toFloat()`
 * Kotlin `Int.hashCode()` 就是自身，故直接用 id 取模。
 */
export function bookBreathPhase(bookId: number): number {
  return (((bookId % 1000) + 1000) % 1000) / 1000 * 2 * Math.PI;
}

/** HomeScreen.kt 752–753 — 4000ms / 33ms ≈ 121 步 */
export const SHELF_BREATH_PERIOD_MS = 4000;
export const SHELF_BREATH_AMPLITUDE_DP = 3;

/**
 * HomeScreen.kt 1464–1491 + 1486–1491 — 卡片视觉状态。
 * ⚠️ 缩放语义必须是"内缩"：同时叠加 1.05（抬起）与 0.94（选中）两个 scale
 * 相乘 ≈ 0.987 等于互相抵消。
 */
export const SELECTED_SCALE = 0.94;
export const PRESS_SCALE = 0.96;
export const DRAG_SCALE = 0.92;
export const DIM_UNSELECTED = 0.85;

export function bookCardVisual(input: {
  key: string;
  phase: ShelfPhase;
  selected: ReadonlySet<string>;
  dragging: ReadonlyArray<string>;
  flyingHome: ReadonlySet<string>;
  pressed: boolean;
}): { hidden: boolean; alpha: number; scale: number } {
  const isDragged = input.dragging.includes(input.key);
  const isFlyingHome = input.flyingHome.has(input.key);
  const isSelected = input.selected.has(input.key);
  const alpha = isDragged || isFlyingHome
    ? 0
    : input.phase === 'BROWSE'
      ? 1
      : isSelected
        ? 1
        : DIM_UNSELECTED;
  const scale =
    (isDragged ? DRAG_SCALE : 1) *
    (isSelected ? SELECTED_SCALE : 1) *
    (input.pressed ? PRESS_SCALE : 1);
  return { hidden: isDragged || isFlyingHome, alpha, scale };
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 1071–1081 / 1436–1446 / 2651–2666 — 封面地址解析
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Coil 的 `content://` / `file://` / 裸路径三分支 → `<img src>`。
 * `content://` 在 Web 上不可直接加载，返回 null 走程序化封面；
 * 其余两种剥掉 `file://` 前缀后原样交给浏览器。
 */
export function resolveCoverSrc(
  coverUri: string | null | undefined,
  isCoverValid: boolean,
): string | null {
  if (coverUri === null || coverUri === undefined || coverUri === '') return null;
  if (coverUri.startsWith('content://')) return null;
  if (!isCoverValid) return null;
  return coverUri.startsWith('file://') ? coverUri.substring(7) : coverUri;
}

/** ui/favorite/FavoritesPanel.kt 346 — 本地缩略图优先于网络封面 */
export function favoriteCoverSrc(item: FavoriteItem): string | null {
  const cover = item.favorite.localThumbPath ?? item.favorite.coverUrl;
  if (cover === null || cover.trim() === '') return null;
  return cover;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 2285–2298 + 2360–2363 — 文案与统计
   ═══════════════════════════════════════════════════════════════════ */

/** 分享：多本合并成一段文本（书名 + 来源链接）。 */
export function shareTitlesText(titles: ReadonlyArray<string>): string {
  if (titles.length === 0) return '';
  let text = '我在 Ciallo Reader里看：\n';
  for (const title of titles) text += `《${title}》\n`;
  return text;
}

/**
 * 今日阅读秒数 → 显示分钟（四舍五入到最近分钟；纯函数可单测）。
 * 验收口径：精确阅读 5 分钟（≈300s±2s）→ 显示 5，误差远小于 ±10 秒容差。
 * ⚠️ Kotlin `kotlin.math.round` 是"四舍五入远离零"，负数与 JS `Math.round` 不同；
 * 阅读秒数恒 ≥ 0，故此处等价。
 */
export function todayReadMinutes(todaySeconds: number): number {
  return Math.round(todaySeconds / 60.0);
}

export function todayReadTimeText(todaySeconds: number): string {
  return `今日已阅读 ${String(todayReadMinutes(todaySeconds))} 分钟`;
}

export function streakDaysText(streakDays: number): string {
  return `连续 ${String(streakDays)} 天`;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 1018–1023 — 自适应列数
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 多设备一致：按宽度自适应列数（手机3列 / 折叠展开与小平板4列 / 宽平板最多6列），
 * 不再只有 3/4 两档——宽屏拉伸大卡片的问题源头。
 * Kotlin 整数除法 → Math.floor。
 */
export function gridColumns(screenWidthDp: number): number {
  const cols = Math.floor((screenWidthDp + 24) / 150);
  return Math.min(6, Math.max(3, cols));
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 285–288 / 785–788 / 822–825 — key 前缀分流
   ═══════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ 被拖的条目**不一定是书**：「我喜欢的」的卡片也会被拖上来，它们的 key 带
 * fav:: 前缀。曾经只按 `sortedBooks.filter { it.id.toString() in keys }` 匹配，
 * 收藏一条都匹配不到 ⇒ 什么都不做但提示照弹。
 */
export function splitShelfKeys(keys: ReadonlyArray<string>): {
  bookKeys: string[];
  favKeys: string[];
} {
  const bookKeys: string[] = [];
  const favKeys: string[] = [];
  for (const key of keys) {
    if (isFavShelfKey(key)) {
      favKeys.push(key.substring(SHELF_KEY_FAV_PREFIX.length));
    } else {
      bookKeys.push(key);
    }
  }
  return { bookKeys, favKeys };
}

/* ═══════════════════════════════════════════════════════════════════
   ui/shelf/ShelfMultiSelect.kt 35–47 — 多选状态机
   ═══════════════════════════════════════════════════════════════════ */

export type ShelfPhase = 'BROWSE' | 'SELECTING' | 'DRAGGING';

/**
 * 本次多选名单属于哪个板块。
 * 用户明确要求：「我的书架」和「我喜欢的」是**完全独立**的两个栏目，多选名单绝不能混。
 */
export type ShelfSelectionScope = 'BOOK' | 'FAV';

export interface ShelfSelectionState {
  phase: ShelfPhase;
  /** 本次多选名单的归属板块；`null` = 还没进入多选（浏览态）。 */
  scope: ShelfSelectionScope | null;
  /** 已选中的条目 key */
  selected: string[];
  /** 正在被拖拽的 key（被长按的那本在最上层） */
  dragging: string[];
  /**
   * 正在「飞回原位」的 key。
   * ⚠️ 松手那一瞬间 `dragging` 就清空了，只按 dragging 判定可见性的话真实卡片会
   * 立刻浮现，而幽灵卡还在半空 —— 屏幕上同时出现两个不对齐的书。
   */
  flyingHome: string[];
  /** 手指位置（宿主局部坐标） */
  pointer: { x: number; y: number } | null;
  /** 当前悬停的放置目标 id */
  hoverTarget: string | null;
  /** 上一次命中的落点（迟滞用） */
  lastHoverId: string | null;
  /** 长按刚自动选中的 key —— 紧随其后的抬手不算一次点击 */
  autoSelectKey: string | null;
  autoSelectAtMs: number;
  /** 宿主按压的条目 key（只做视觉反馈） */
  pressedKey: string | null;
}

/**
 * ShelfMultiSelect.kt L213–214 —
 * `isRecentAutoSelect() = uptimeMillis() - lastAutoSelectAt < 500L`。
 * ⚠️ 之前的移植写成 450ms，与 Kotlin 的 500ms 不一致。
 */
export const AUTO_SELECT_WINDOW_MS = 500;

export function createShelfSelection(): ShelfSelectionState {
  return {
    phase: 'BROWSE',
    scope: null,
    selected: [],
    dragging: [],
    flyingHome: [],
    pointer: null,
    hoverTarget: null,
    lastHoverId: null,
    autoSelectKey: null,
    autoSelectAtMs: 0,
    pressedKey: null,
  };
}

/** 由 key 前缀判定它属于哪个板块（`fav::` → 收藏，其余 → 书架）。 */
export function scopeOfKey(key: string): ShelfSelectionScope {
  return isFavShelfKey(key) ? 'FAV' : 'BOOK';
}

/**
 * 这个 key 能不能进本次名单。浏览态一律放行；一旦定了板块，就只收本板块的 key。
 */
export function acceptsKey(
  scope: ShelfSelectionScope | null,
  key: string,
): boolean {
  if (scope === null) return true;
  return scope === 'FAV' ? isFavShelfKey(key) : !isFavShelfKey(key);
}

export function toggleKey(state: ShelfSelectionState, key: string): ShelfSelectionState {
  if (!acceptsKey(state.scope, key)) return state;
  const has = state.selected.includes(key);
  return {
    ...state,
    selected: has ? state.selected.filter((k) => k !== key) : [...state.selected, key],
  };
}

export function selectKey(state: ShelfSelectionState, key: string): ShelfSelectionState {
  if (!acceptsKey(state.scope, key)) return state;
  if (state.selected.includes(key)) return state;
  return { ...state, selected: [...state.selected, key] };
}

export function unselectKey(state: ShelfSelectionState, key: string): ShelfSelectionState {
  if (!state.selected.includes(key)) return state;
  return { ...state, selected: state.selected.filter((k) => k !== key) };
}

/** 进入多选时由**第一个被长按的条目**决定本次归属。 */
export function enterSelection(
  state: ShelfSelectionState,
  key: string,
  nowMs: number,
): ShelfSelectionState {
  const scope = state.scope ?? scopeOfKey(key);
  const selected = state.selected.includes(key) ? state.selected : [...state.selected, key];
  return {
    ...state,
    phase: 'SELECTING',
    scope,
    selected,
    autoSelectKey: key,
    autoSelectAtMs: nowMs,
  };
}

export function exitSelection(): ShelfSelectionState {
  return {
    ...createShelfSelection(),
    // 浏览态下 hover/pressed 都必须清干净，否则会留下"幽灵热区"。
    phase: 'BROWSE',
  };
}

export function selectAllKeys(
  state: ShelfSelectionState,
  keys: ReadonlyArray<string>,
): ShelfSelectionState {
  const accepted = keys.filter((k) => acceptsKey(state.scope, k));
  return {
    ...state,
    phase: state.phase === 'BROWSE' ? 'SELECTING' : state.phase,
    scope: state.scope ?? (accepted.length > 0 ? scopeOfKey(accepted[0] as string) : null),
    selected: accepted,
  };
}

/** 滑动连选：跨过一条就把那条并进名单。 */
export function slideAcross(state: ShelfSelectionState, key: string): ShelfSelectionState {
  if (!acceptsKey(state.scope, key)) return state;
  if (state.selected.includes(key)) return state;
  return { ...state, selected: [...state.selected, key] };
}

export function markAutoSelect(
  state: ShelfSelectionState,
  key: string,
  nowMs: number,
): ShelfSelectionState {
  return { ...state, autoSelectKey: key, autoSelectAtMs: nowMs };
}

/** 长按刚自动选中，紧随其后的抬手不算一次点击（否则会立刻取消选中）。 */
export function isRecentAutoSelect(state: ShelfSelectionState, nowMs: number): boolean {
  if (state.autoSelectKey === null) return false;
  return nowMs - state.autoSelectAtMs < AUTO_SELECT_WINDOW_MS;
}

export function isSelected(state: ShelfSelectionState, key: string): boolean {
  return state.selected.includes(key);
}

/* ═══════════════════════════════════════════════════════════════════
   ShelfMultiSelect.kt 601–628 — 长按到时后的三分支派发
   ═══════════════════════════════════════════════════════════════════ */

export type ShelfLongPressKind =
  /** `state.phase == BROWSE` → 进入多选（**不是**拿起） */
  | 'enter'
  /** `alreadySelected` → 拿起，进入拖拽 */
  | 'pickUp'
  /** 另一板块的 key → 什么都不做（不改名单、不给触觉） */
  | 'reject'
  /** 本板块未选中的 key → 选中并继续滑动连选 */
  | 'select';

export interface ShelfLongPressResult {
  kind: ShelfLongPressKind;
  state: ShelfSelectionState;
  /** Kotlin `HapticKind`：MEDIUM / HEAVY / SELECTION，reject 时为 null。 */
  haptic: 'MEDIUM' | 'HEAVY' | 'SELECTION' | null;
}

/**
 * ShelfMultiSelect.kt L601–628 —— 长按到时后的状态迁移。
 *
 * ```kotlin
 * when {
 *   state.phase == BROWSE -> { MEDIUM; enterSelection(key); markAutoSelect() }
 *   alreadySelected       -> { HEAVY;  beginDrag(key, start);  markAutoSelect() }
 *   !state.accepts(key)   -> return                 // 另一板块：什么都不做
 *   else                 -> { SELECTION; select(key); markAutoSelect() }
 * }
 * state.lastSlideKey = key
 * ```
 *
 * ⚠️ 关键：浏览态的长按**只进入多选**，拖拽必须"多选态下再长按一次已选中的那本"。
 * 之前的移植在浏览态长按时直接 `enterSelection` + `beginDrag`，等于把两步并成一步 ——
 * 用户第一次长按书就被拿起来了，多选态的"进入/拿起"手感与 Android 不一致。
 */
export function longPressAction(
  state: ShelfSelectionState,
  key: string,
  nowMs: number,
): ShelfLongPressResult {
  if (state.phase === 'BROWSE') {
    return {
      kind: 'enter',
      state: markAutoSelect(enterSelection(state, key, nowMs), key, nowMs),
      haptic: 'MEDIUM',
    };
  }
  if (state.selected.includes(key)) {
    return {
      kind: 'pickUp',
      state: markAutoSelect(beginDrag(state, key), key, nowMs),
      haptic: 'HEAVY',
    };
  }
  if (!acceptsKey(state.scope, key)) {
    return { kind: 'reject', state, haptic: null };
  }
  return {
    kind: 'select',
    state: markAutoSelect(selectKey(state, key), key, nowMs),
    haptic: 'SELECTION',
  };
}

/** 几何表只写不删：书目/落点变化时把不再存在的 id 裁掉。 */
export function pruneGeometry(
  aliveItems: ReadonlySet<string>,
  aliveTargets: ReadonlySet<string>,
): { items: string[]; targets: string[] } {
  return {
    items: [...aliveItems],
    targets: [...aliveTargets],
  };
}

/**
 * 705–710 + ShelfMultiSelect.pruneGeometry 的等价物：把名单里已经不在当前
 * 板块（书被移动 / 收藏被移除）的 key 裁掉。
 */
export function pruneSelection(
  state: ShelfSelectionState,
  aliveKeys: ReadonlySet<string>,
): ShelfSelectionState {
  const selected = state.selected.filter((k) => aliveKeys.has(k));
  if (selected.length === state.selected.length) return state;
  return {
    ...state,
    selected,
    dragging: state.dragging.filter((k) => aliveKeys.has(k)),
    flyingHome: state.flyingHome.filter((k) => aliveKeys.has(k)),
  };
}

/**
 * 开始拖拽：被长按的那本提到最上层，其余保持选中。
 * ⚠️ 只有多选态（SELECTING）才允许起拖 —— 浏览态下的长按是「打开操作面板」。
 */
export function beginDrag(state: ShelfSelectionState, picked: string): ShelfSelectionState {
  if (state.phase !== 'SELECTING') return state;
  const rest = state.selected.filter((k) => k !== picked);
  return {
    ...state,
    phase: 'DRAGGING',
    selected: rest.includes(picked) ? rest : [...rest, picked],
    dragging: [picked, ...rest],
    lastHoverId: null,
  };
}

/**
 * 落点命中（视口坐标）+ 迟滞。
 *
 * ⚠️ 除了"手指在矩形里"，Android 还要求这个胶囊**完整可见**
 * （top 不低于宿主顶、bottom 不超出宿主底）。只校验中心点的话，滚到一半、
 * 只从顶/底露出半截的胶囊也会被命中 —— 手指明明停在空白处却触发了分类。
 * 已命中的目标给它一点"粘性"：要移出矩形外 HYSTERESIS 才算真的离开。
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function pickDropTarget(input: {
  x: number;
  y: number;
  targetRects: ReadonlyMap<string, Rect>;
  lastHoverId: string | null;
  /**
   * 宿主盒的上/下边界（root 坐标）。
   *
   * ⚠️ BUG FIXED：Kotlin `ShelfMultiSelect.pickTarget`（L150–155）除了
   * `it.contains(root)` 之外**还要求这个胶囊完整可见**：
   * `it.top >= hostTop && it.bottom <= hostBottom`。之前这个函数只做了
   * `contains`（函数自己的 KDoc 却写着"Android 还要求完整可见"—— 文档与实现不符）。
   * 漏掉的后果就是 Kotlin 注释里点名的那条用户反馈：
   * 「手指不是刚好在分类之上也触发了放进分类」—— 分类栏滚到一半、只从顶部露出
   * 半截时，手指停在空白处照样命中。
   *
   * 不传（`undefined`）= 不做可见性判定，等价于"宿主无限高"。
   * HomePage 传 `0` / `window.innerHeight`：Kotlin 的宿主 `Box(Modifier.fillMaxSize())`
   * 正好铺满整屏（内部的 `statusBarsPadding` 落在子 Column 上，不影响宿主盒），
   * 所以视口就是它最忠实的对应物。
   *
   * ⚠️ 只作用于**首次命中**；12dp 迟滞那条 `kept` 分支仍然只看外扩后的矩形，
   * 与 Kotlin `moveDrag` 的结构一致。
   */
  hostTop?: number;
  hostBottom?: number;
}): string | null {
  const checkVisible = (rect: Rect): boolean =>
    input.hostTop === undefined ||
    input.hostBottom === undefined ||
    (rect.top >= input.hostTop && rect.bottom <= input.hostBottom);
  for (const [id, rect] of input.targetRects) {
    if (!rectContains(rect, input.x, input.y)) continue;
    if (!checkVisible(rect)) continue;
    return id;
  }
  const last = input.lastHoverId;
  if (last !== null) {
    const rect = input.targetRects.get(last);
    if (rect !== undefined) {
      const padded: Rect = {
        left: rect.left - HYSTERESIS,
        top: rect.top - HYSTERESIS,
        right: rect.right + HYSTERESIS,
        bottom: rect.bottom + HYSTERESIS,
      };
      if (rectContains(padded, input.x, input.y)) return last;
    }
  }
  return null;
}

/** 拖拽期间冻结网格自身的横向/纵向滚动（Android userScrollEnabled = phase != DRAGGING） */
export function gridScrollEnabled(phase: ShelfPhase): boolean {
  return phase !== 'DRAGGING';
}

/**
 * 松手：命中落点就交给业务层，没命中就保持选中并优雅回弹
 * （Android endDrag：不注册当前分类就是「落在非放置区」）。
 */
export function endDrag(
  state: ShelfSelectionState,
  hoverTarget: string | null,
): ShelfSelectionState {
  return {
    ...state,
    phase: hoverTarget === null ? 'SELECTING' : 'BROWSE',
    dragging: [],
    flyingHome: hoverTarget === null ? state.dragging : [],
    hoverTarget,
    lastHoverId: null,
    pointer: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 895–905 — 顶栏作用域分流
   ═══════════════════════════════════════════════════════════════════ */

export function favScope(scope: ShelfSelectionScope | null): boolean {
  return scope === 'FAV';
}

/** 顶栏「全选」的作用域名单：按板块分流，绝不跨板块。 */
export function selectableKeys(
  scope: ShelfSelectionScope | null,
  sortedBooks: ReadonlyArray<HomeBook>,
  favSorted: ReadonlyArray<FavoriteItem>,
): string[] {
  if (favScope(scope)) return favShelfKeys(favSorted);
  return sortedBooks.map((b) => String(b.id));
}

/** 「我喜欢的」条目的多选 key（统一带 `fav::` 前缀）。 */
export function favShelfKeys(favSorted: ReadonlyArray<FavoriteItem>): string[] {
  return favSorted.map((it) => favShelfKey(`${it.favorite.sourceId}::${it.favorite.comicId}`));
}

export function isAllSelected(keys: ReadonlyArray<string>, selected: ReadonlyArray<string>): boolean {
  if (keys.length === 0) return false;
  const set = new Set(selected);
  return keys.every((k) => set.has(k));
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 772–849 / 402–445 — 落点/批量移动计划 + 文案
   ═══════════════════════════════════════════════════════════════════ */

export interface UndoEntry {
  key: string;
  category: string;
}

export interface DropToCategoryPlan {
  /** null = 无效分类，什么都不做。 */
  blockedReason: string | null;
  books: HomeBook[];
  favKeys: string[];
  favUndo: UndoEntry[];
  total: number;
  message: string | null;
}

/**
 * ⚠️ 最后一道保险：落点矩形可能残留（分类被删了、改名了，矩形还在），
 * 一旦把书写进一个**不存在的分类名**，它在任何分类下都不显示 ——
 * 对用户来说就是「书凭空消失了」。宁可这次不动，也不能把书弄丢。
 */
export function planDropToCategory(input: {
  keys: ReadonlyArray<string>;
  books: ReadonlyArray<HomeBook>;
  favoriteItems: ReadonlyArray<FavoriteItem>;
  categories: ReadonlyArray<HomeCategory>;
  targetName: string;
}): DropToCategoryPlan {
  if (!input.categories.some((c) => c.name === input.targetName)) {
    return {
      blockedReason: `『${input.targetName}』不是可用的分类，没有移动`,
      books: [],
      favKeys: [],
      favUndo: [],
      total: 0,
      message: `『${input.targetName}』不是可用的分类，没有移动`,
    };
  }
  const { bookKeys, favKeys } = splitShelfKeys(input.keys);
  const bookSet = new Set(bookKeys);
  const books = input.books.filter((b) => bookSet.has(String(b.id)));
  const favUndo: UndoEntry[] = [];
  for (const key of favKeys) {
    const match = input.favoriteItems.find(
      (it) => `${it.favorite.sourceId}::${it.favorite.comicId}` === key,
    );
    if (match !== undefined) favUndo.push({ key, category: match.favorite.categoryName });
  }
  const total = books.length + favKeys.length;
  return {
    blockedReason: null,
    books,
    favKeys,
    favUndo,
    total,
    message: total > 0 ? `已移动 ${String(total)} 本到『${input.targetName}』` : null,
  };
}

export interface DropToFavoritePlan {
  ok: number;
  skipped: number;
  message: string;
}

export function planDropToFavorite(selected: ReadonlyArray<HomeBook>): DropToFavoritePlan {
  const withSource = selected.filter((b) => favKeyOfBook(b) !== null);
  const ok = withSource.length;
  const skipped = selected.length - withSource.length;
  const message =
    skipped > 0
      ? `已喜欢 ${String(ok)} 本，${String(skipped)} 本无来源已跳过`
      : `已加入我喜欢的 ${String(ok)} 本`;
  return { ok, skipped, message };
}

export interface DropToFavoriteCategoryPlan {
  ok: number;
  skipped: number;
  books: HomeBook[];
  favKeys: string[];
  favUndo: UndoEntry[];
  message: string;
}

/**
 * 同理：**先按 key 前缀分流**。
 * - 书架的书 → 加入「我喜欢的」并归入该分类；
 * - 「我喜欢的」自己的卡片 → 直接改它所属的分类。
 */
export function planDropToFavoriteCategory(input: {
  keys: ReadonlyArray<string>;
  books: ReadonlyArray<HomeBook>;
  favoriteItems: ReadonlyArray<FavoriteItem>;
  targetName: string;
}): DropToFavoriteCategoryPlan {
  const { bookKeys, favKeys } = splitShelfKeys(input.keys);
  const bookSet = new Set(bookKeys);
  const books = input.books.filter((b) => bookSet.has(String(b.id)));
  const ok = books.filter((b) => favKeyOfBook(b) !== null).length;
  const skipped = books.length - ok;

  const favUndo: UndoEntry[] = [];
  for (const key of favKeys) {
    const match = input.favoriteItems.find(
      (it) => `${it.favorite.sourceId}::${it.favorite.comicId}` === key,
    );
    if (match !== undefined) favUndo.push({ key, category: match.favorite.categoryName });
  }

  let message: string;
  if (favKeys.length > 0 && books.length === 0) {
    message = `已移动 ${String(favKeys.length)} 本到『${input.targetName}』`;
  } else if (skipped > 0) {
    message = `已加入『${input.targetName}』${String(ok)} 本，${String(skipped)} 本无来源已跳过`;
  } else {
    message = `已加入『${input.targetName}』${String(ok)} 本`;
  }
  return { ok, skipped, books, favKeys, favUndo, message };
}

/**
 * ⚠️ 用**全部书**而不是当前分类过滤后的 sortedBooks：选中两本时如果其中一本刚被
 * 移走、列表还没刷新，按 sortedBooks 找就只能找到一本 —— 表现就是「选了两本却只移动一本」。
 * 混选（书架的书 + 我喜欢的条目）时不能只动书。
 */
export function planBulkMoveToCategory(input: {
  pickedKeys: ReadonlyArray<string>;
  books: ReadonlyArray<HomeBook>;
  currentCategory: string;
}): { books: HomeBook[]; favKeys: string[]; message: string } {
  const { bookKeys, favKeys } = splitShelfKeys(input.pickedKeys);
  const bookSet = new Set(bookKeys);
  const books = input.books.filter((b) => bookSet.has(String(b.id)));
  return {
    books,
    favKeys,
    message: `已移动 ${String(books.length + favKeys.length)} 本到『${input.currentCategory}』`,
  };
}

/** HomeScreen.kt 2055–2087 — 操作栏动作（两套，恒定 4 项，数量不跳变） */
export interface ShelfActionSpec {
  label: string;
  destructive: boolean;
  enabled: boolean;
}

export const FAV_ACTIONS: ReadonlyArray<ShelfActionSpec> = [
  { label: '打开', destructive: false, enabled: false },
  { label: '移动', destructive: false, enabled: true },
  { label: '分享', destructive: false, enabled: true },
  { label: '取消喜欢', destructive: true, enabled: true },
];

export const BOOK_ACTIONS: ReadonlyArray<ShelfActionSpec> = [
  { label: '移动', destructive: false, enabled: false },
  { label: '分享', destructive: false, enabled: false },
  { label: '删除下载', destructive: true, enabled: false },
  { label: '更多', destructive: false, enabled: false },
];

export function favoriteActionsSpec(selectedCount: number): ShelfActionSpec[] {
  return FAV_ACTIONS.map((a) => (a.label === '打开' ? { ...a, enabled: selectedCount === 1 } : a));
}

export function bookActionsSpec(selectedCount: number): ShelfActionSpec[] {
  return BOOK_ACTIONS.map((a) => ({ ...a, enabled: selectedCount > 0 }));
}

export function removedFavoritesMessage(count: number): string {
  return `已取消喜欢 ${String(count)} 部`;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 448–463 — 「更多」菜单
   ═══════════════════════════════════════════════════════════════════ */

export const MORE_ACTION_TITLES = ['标记为已读完', '取消全选'] as const;

export function favCategorySheetTitles(): string[] {
  return ['重命名分类', '删除分类'];
}

export function markedFinishedBooks(
  sortedBooks: ReadonlyArray<HomeBook>,
  selected: ReadonlyArray<string>,
): HomeBook[] {
  const set = new Set(selected);
  return sortedBooks.filter((b) => set.has(String(b.id)));
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 360–398 — 分类删除确认文案
   ═══════════════════════════════════════════════════════════════════ */

export interface CategoryDeleteCopy {
  isDefaultCategory: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  dismissLabel: string | null;
}

export function categoryDeleteCopy(categoryName: string): CategoryDeleteCopy {
  const isDefaultCategory = categoryName === DEFAULT_CATEGORY;
  return {
    isDefaultCategory,
    title: isDefaultCategory ? '无法删除' : '删除分类',
    text: isDefaultCategory
      ? '默认分类不可删除。'
      : `确定要删除分类「${categoryName}」吗？其中的书籍会移动到「默认」分类。`,
    confirmLabel: isDefaultCategory ? '知道了' : '删除',
    dismissLabel: isDefaultCategory ? null : '取消',
  };
}

export const DEFAULT_CATEGORY_DELETE_TOAST = '默认分类不可删除';

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 533–547 / 551–563 — 新建分类窗口文案
   ═══════════════════════════════════════════════════════════════════ */

export const SHELF_CATEGORY_DIALOG_TITLE = '新建书架分类';
export const SHELF_CATEGORY_DIALOG_DESCRIPTION = '用于「我的书架」里的本地书籍。';
export const FAV_CATEGORY_DIALOG_TITLE = '新建收藏分类';
export const FAV_CATEGORY_DIALOG_DESCRIPTION = '只用于「我喜欢的」，不会出现在书架的分类里。';

export function categoryCreatedToast(name: string): string {
  return `已创建分类「${name}」`;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 1846–1886 / 1362–1422 — 锁定态文案
   ═══════════════════════════════════════════════════════════════════ */

export function categoryLockedTitle(categoryName: string): string {
  return `分类『${categoryName}』已锁定`;
}

export const CATEGORY_LOCKED_SUBTITLE = '验证隐私密码后即可查看其中的书籍';
export const CATEGORY_LOCKED_ACTION = '验证密码查看';
export const FAVORITES_LOCKED_TITLE = '「我喜欢的」已锁定';
export const FAVORITES_LOCKED_SUBTITLE = '点击验证密码后查看';

/** HomeScreen.kt 1879 — 锁定态提示文案（与分类锁定行同形） */
export function favLockedRowText(): string {
  return FAVORITES_LOCKED_SUBTITLE;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 974–1017 / 1424–1431 / 1887–1897 — 空态文案
   （MascotEmptyState 本身在只读模块 ui/mascot 里，但字符串逐字保留）
   ═══════════════════════════════════════════════════════════════════ */

export const EMPTY_SHELF_TITLE = '「书架空空如也」';
export const EMPTY_SHELF_DESCRIPTION =
  '您的书架还没有任何书哦！Roxy 觉得有点寂寞。您可以点击下方按钮导入本地电子书，或者直接去在线书库挑选精彩的小说！';
export const EMPTY_SHELF_ACTION = '立即前往在线书库';
export const EMPTY_SHELF_IMPORT_LABEL = '或者 导入本地 TXT / EPUB / Comic 文件';
export const EMPTY_SHELF_TEST_TAG = 'books_empty_state';

export function categoryEmptyTitle(): string {
  return '「分类下没有图书」';
}
export function categoryEmptyDescription(categoryName: string): string {
  return `在分类『${categoryName}』下还没有任何图书哦。您可以点击下方按钮导入新书到该分类！`;
}
export const CATEGORY_EMPTY_ACTION = '在此分类下导入新书';
export const CATEGORY_EMPTY_TEST_TAG = 'category_empty_state';

export const EMPTY_FAVORITES_TITLE = '「还没有喜欢的漫画」';
export const EMPTY_FAVORITES_DESCRIPTION =
  '在漫画页点一下 ♡，喜欢的漫画都在这里 —— 不下载、不占空间，随时在线接着看。';
export const EMPTY_FAVORITES_ACTION = '去书库逛逛';
export const EMPTY_FAVORITES_TEST_TAG = 'favorites_empty_state';

/* ═══════════════════════════════════════════════════════════════════
   ui/favorite/FavoritesPanel.kt 301–313 / 442–447 — 收藏卡派生值
   ═══════════════════════════════════════════════════════════════════ */

export interface FavoriteCardMeta {
  latestNum: number | null;
  readNum: number;
  hasUpdate: boolean;
  unread: number;
  dead: boolean;
  /** 归一化读进度 0..1 */
  ratio: number | null;
  subtitle: string;
}

/**
 * 「有更新」= 快照 id 与已见快照不同。⚠️ 要再加一道话数兜底：有的源每次拉取
 * chapterId 都不同（URL 带时间戳/hash），裸 id 比较会让已经读到最新话数的漫画
 * 永远亮着「更新」角标。
 */
export function favCardMeta(item: FavoriteItem): FavoriteCardMeta {
  const fav = item.favorite;
  const latestNum = chapterNumber(fav.latestChapterTitle ?? '');
  const rawIndex = item.progress?.lastChapterIndex ?? -1;
  const readNum = rawIndex >= 0 ? rawIndex + 1 : 0;
  const hasUpdate =
    fav.latestChapterId !== null &&
    item.progress !== null &&
    item.progress.seenTopChapterId !== null &&
    fav.latestChapterId !== item.progress.seenTopChapterId &&
    !(latestNum !== null && readNum > 0 && latestNum <= readNum);
  const unread = latestNum !== null && readNum > 0 ? Math.max(0, latestNum - readNum) : 0;
  const dead = !fav.sourceAlive;
  const ratio =
    readNum > 0 && latestNum !== null && latestNum > 0
      ? Math.min(1, Math.max(0, readNum / latestNum))
      : null;

  let subtitle = '';
  if (latestNum !== null) subtitle += `更新至第 ${String(latestNum)} 话`;
  if (readNum > 0) {
    subtitle += latestNum !== null ? ` · 看到第 ${String(readNum)} 话` : `看到第 ${String(readNum)} 话`;
  }
  if (subtitle === '') subtitle = dead ? '来源暂不可用' : '尚未开始阅读';

  return { latestNum, readNum, hasUpdate, unread, dead, ratio, subtitle };
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 249 / 265–271 — 拖拽提示（最多 3 次）
   ═══════════════════════════════════════════════════════════════════ */

export const DRAG_HINT_MAX_SHOWS = 3;
/** ui/feedback/Motion.kt `AppMotion.LONG_PRESS_MS = 350L` */
export const LONG_PRESS_MS = 350;
/**
 * ui/feedback/Motion.kt `AppMotion.PICK_UP_MS = 250L` —「多选态下再次长按『已选中』的书 → 拿起」。
 * ⚠️ ShelfMultiSelect.kt L561–563：`withTimeout(if (phase == SELECTING) PICK_UP_MS else LONG_PRESS_MS)`
 * —— 浏览态 350ms 进入多选，多选态 250ms 才拿起。之前移植只用了 350ms。
 */
export const PICK_UP_MS = 250;

export function nextDragHintShown(shown: number): number {
  return shown + 1;
}

export function dragHintVisible(phase: ShelfPhase, shown: number): boolean {
  return phase === 'SELECTING' && shown < DRAG_HINT_MAX_SHOWS;
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 118–183 — 无 TS 对应物的参数（逐条列明，便于审阅）
   ═══════════════════════════════════════════════════════════════════ */

export const SKIPPED_HOME_PARAMS: ReadonlyArray<{ param: string; reason: string }> = [
  { param: 'sharedTransitionScope', reason: 'Compose 共享元素作用域，Web 无对应 API' },
  { param: 'onDeleteDownloads', reason: '依赖 Android 下载任务调度 + 撤销窗口，接线在 MainActivity 层' },
  {
    param: 'onShowUndo',
    reason: 'Android Snackbar 宿主；Web 侧用 homeViewModel 的 plan* 文案 + Toast 呈现',
  },
  {
    param: 'onFavoriteSelectedBooks',
    reason: '需要 sourceId/comicId 与在线书源；当前 TS 书架只有本地书，恒返回 (0, 选中数)',
  },
  {
    param: 'onFavoriteSelectedBooksToCategory',
    reason: '同上',
  },
  { param: 'onCreateFavoriteCategoryThenMove', reason: '与 onAddFavoriteCategory 合并为 pendingNewCategoryKeys 流程' },
  { param: 'favoriteSort', reason: '端口保留 FavoriteSort 枚举；HomeScreen.kt 只用默认 RECENT_FAVORITE' },
  { param: 'onRenameFavoriteCategory', reason: '仓库已提供 renameFavoriteCategory，HomePage 直接调用' },
  { param: 'onMarkFinished', reason: 'BookRepository.updateBook 提供 isFinished 写入' },
  { param: 'onNavigateToShelf', reason: '映射为 useAppStore.setTab(\'library\')' },
  { param: 'onNavigateToStats', reason: '映射为 useAppStore.setTab(\'stats\')' },
  { param: 'onSettingsClick', reason: '映射为 useAppStore.setTab(\'settings\')' },
  { param: 'onImportClick', reason: '映射为 importSampleBook()（Web 无系统文件选择器接线）' },
];

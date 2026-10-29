import { PrivacyPinOverlay as ActualPinOverlay } from '@ui/components/privacy/PrivacyWindows';
import { getPrivacyService } from '@platform/privacyRuntime';
import { flushReadingStatistics } from '@platform/readingStatisticsRuntime';
/**
 * HomePage.tsx — line-by-line port of Android
 * `app/src/main/java/com/example/ui/HomeScreen.kt` (2858 lines).
 *
 * ROUTE / TAB
 * -----------
 * Android `MainActivity.kt:679` renders `HomeScreen(...)` for `when (tab) { 1 -> … }`
 * with `tabItems` (MainActivity.kt:500–507) =
 *   0 书库 / 1 书架 / 2 统计 / 3 设置.
 * ⇒ HomeScreen is Android **tab index 1「书架」**, which in this TS project is
 * `useAppStore.activeTab === 'bookshelf'`. `LibraryPage.tsx` is the port of
 * Android `LibraryScreen` (tab 0「书库」).
 *
 * The Kotlin→TS mapping of every state/derived value lives in
 * `src/core/home/homeViewModel.ts` (pure). This file is the view layer:
 * store/platform wiring, hooks, and markup.
 *
 * KOTLIN → TS LINE MAP (all ranges refer to HomeScreen.kt)
 * -------------------------------------------------------
 *   118–183  @Composable HomeScreen(params)        → `HomePage()`
 *   184–195  currentlyReading                      → homeViewModel.currentlyReading
 *   197–221  searchQuery/debounce/category fallback → useState + useEffect(300 ms)
 *   222–250  dialog/sheet/selection state          → useState + homeViewModel
 *   255–271  favorite update probe + drag hint     → useEffect (1500 ms / ≤3)
 *   281–294  pending new-category move             → useEffect + splitShelfKeys
 *   299–305  selectedCategoryLocked                → homeViewModel
 *   314–357  filter/sort shelf + favorites         → homeViewModel
 *   360–398  AlertDialog 删除分类                  → `<CategoryDeleteDialog>`
 *   402–445  CategoryPickerSheet                   → `<CategoryPickerSheet>`
 *   448–464  MoreActionSheet                       → `<MoreActionSheet>`
 *   467–501  AcrylicDialog 选择目标分类             → `<MoveBookDialog>`
 *   504–530  AcrylicDialog 移出此书                 → `<DeleteBookDialog>`
 *   533–547  NewCategoryDialog (shelf)             → `<NewCategoryDialog>`
 *   551–564  NewCategoryDialog (favorite)          → `<NewCategoryDialog>`
 *   567–582  fav category sheet                    → `<MoreActionSheet>`
 *   584–627  rename favorite category              → `<RenameCategoryDialog>`
 *   629–658  delete favorite category              → `<DeleteFavCategoryDialog>`
 *   661–675  PrivacyPinOverlay (favorites)         → `<PrivacyPinOverlay>`
 *   687–695  ShelfHeal orphan rescue               → useEffect + orphanBooks
 *   705–710  shelfAliveKeys                        → homeViewModel
 *   742–764  breathing clock                       → CSS `.hp-book-card__body--breathing`
 *   766      StarryNightBackground                 → SKIPPED (read-only ui/adaptive / ui/glasskit)
 *   767–887  ShelfSelectionHost callbacks           → `ShelfSelectionLayer` + `plan*` helpers  [PORTED]
 *   895–905  favScope / favKeys / allSelected       → homeViewModel
 *   906–967  Column + TabScreenHeader + search     → `<TabScreenHeader>` + `.hp-search`
 *   974–1017 whole-page empty state                → `<EmptyShelf>`
 *   1027–1034 heroCategoryLocked                   → homeViewModel
 *   1048–1067 LazyVerticalGrid                     → `.hp-grid`
 *   1068–1254 hero section                         → `<HeroSection>`
 *   1258–1357 bookshelf header + category pills    → `<ShelfHeader>` / `<CategoryDropRow>`
 *   1360–1433 empty/locked shelf state             → `<ShelfEmptyState>` / `<CategoryLockedRow>`
 *   1435–1752 book card                            → `<ShelfBookCard>`
 *   1759–1843 fav section header                   → `<FavSectionHeader>` / `<FavCategoryRow>`
 *   1846–1897 fav locked / empty                   → `<FavoritesLockedRow>` / `<FavEmptyState>`
 *   1899–1926 FavoriteCard                         → `<FavoriteGridCard>`
 *   1928–1989 bottom stats card                    → `<ReadingStatsCard>`
 *   1994–2089 MultiSelectActionBar                 → `<MultiSelectActionBar>`
 *   2100–2144 MultiSelectTopBar                    → `<MultiSelectTopBar>`
 *   2149–2166 BookActionSheet                      → `<BookActionSheet>`
 *   2168–2188 CategoryActionSheet                  → `<CategoryActionSheet>`
 *   2190–2204 PrivacyPinOverlay (category)         → `<PrivacyPinOverlay>`
 *   2207–2277 ShelfDragCover                       → `<ShelfDragCover>`
 *   2286–2298 shareTitles                          → navigator.share + shareTitlesText
 *   2360–2363 todayReadMinutes                     → homeViewModel
 *   2372–2420 HomeActionChip                       → `<ActionChip>` (ui/components/Chips.tsx)
 *   2422–2475 HomeCategoryChip                     → SKIPPED: dead code, never referenced in HomeScreen.kt
 *   2477–2634 CategoryActionSheet composable       → `<CategoryActionSheet>`
 *   2636–2857 BookActionSheet composable           → `<BookActionSheet>`
 *
 * PAGE-LEVEL CONSOLIDATION (this review round)
 * -------------------------------------------
 *   `pages/BookshelfPage.tsx` (1058 lines) was a **second, hand-written, half-finished**
 *   bookshelf page that `App.tsx` never routed to. Verified line by line: every
 *   behaviour it had that HomeScreen.kt does not have is either (a) Kotlin code that is
 *   itself dead (`FavoritesPanel` / `ShelfSegmentedTabs` / `AddCategoryPill` are never
 *   called from anywhere in the Android app) or (b) a divergence from HomeScreen.kt
 *   (invented strings, wrong subtitle, wrong action list, `window.prompt` categories,
 *   invented 今日阅读时长/连续天数 formulas, no privacy/PIN, no ShelfHeal, comics always
 *   routed to the novel reader …). Nothing needed porting, so the duplicate was
 *   deleted and `App.tsx` keeps this page as the single 书架 route.
 *
 * THIS-ROUND FIXES (line-by-line review, module = home + shelf + favorite)
 * ---------------------------------------------------------------------
 *   Kotlin → TS（BUG，已修）
 *     · L414 MultiSelectTopBar 单位 `本` → 之前写成 `项`
 *     · L402–445 + L567–582 MoreActionSheet 标题恒为「更多操作」（Kotlin 签名里
 *       没有 title 参数），之前把收藏分类名当成了面板标题
 *     · L608 CategoryPickerSheet 的「＋新建分类」（全角 ＋）与「创建并放入」
 *       按钮文案；`creating` 也只能置 true（Kotlin 是 `creating = true`）
 *     · L1011–1016 整页空态的**顺序**：先 MascotEmptyState（立即前往在线书库），
 *       再「或者 导入本地 TXT / EPUB / Comic 文件」；并补上 testTag
 *       `empty_bookshelf_import_button`
 *     · L742–764 呼吸动画的第三个冻结条件「列表不在滚动」
 *     · L550–554 撤销窗口 `SnackbarDuration.Long` = 10000ms（之前 6000ms）
 *     · L601–628 + L561–563 长按的两步语义：浏览态 350ms 只**进入多选**，
 *       多选态 250ms（PICK_UP_MS）才拿起；之前一步到位直接开始拖
 *     · L802–810 + L782–786 落到 ＋新建 / 分类 / 收藏分类后必须 exitSelection()
 *     · L769–776 落到 ♡ 时保持多选、卡片在归位飞行期间藏进 flyingHome
 *     · L828–848 `onDropToFavoriteCategory` 对「书架的书」执行的是**加入收藏并
 *       归入该收藏分类**（`onFavoriteSelectedBooksToCategory`），之前错误地把它
 *       的书架分类改成了同名分类名 —— 会真的把书弄丢
 *     · L812–817 `onDropToFavorite` 之前只弹提示、**没有真正加入收藏**
 *   Kotlin → TS（MISSING，已修）
 *     · L1335–1353 分类胶囊的 `dropHighlight`（悬停 = 主色填充 + 1.08 放大）
 *     · L1341–1346 受保护分类**可点**（点击 = PIN 验证）；之前用的简化胶囊对
 *       `locked` 直接 disabled，PIN 入口不可达
 *     · L1312 / L1814 拖拽期间关掉分类栏的横向滚动
 *     · L1339 / L1834 胶囊的 count 角标与「已加密」锁标记（改用 ShelfChips 移植件）
 *   Kotlin → TS（EXTRA，已删）
 *     · 书卡与收藏卡上的 `onContextMenu` → onTapItem：Android 没有这个处理器，
 *       而 iOS 的长按会同时触发 contextmenu 与 350ms 定时器，互相打架
 *   等价但写法不同（保留）
 *     · `booksGridRoot` / `booksFallbackHit` 的 Compose 陈旧网格兜底 → DOM
 *       `getBoundingClientRect` 天然精确（已豁免）
 *     · `showDragHint` 在 Kotlin 里也从未被读（死 UI）
 *     · PIN 校验是 6 位占位（真实 `PinStore` 未接线）→ 见 E 条目
 *     · 拖拽落点 Dock（♡ / ＋新建分类）Android 已整块移除但两个 target id 仍留在
 *       `aliveTargets` 与四支 `onDropTo*` 分派里 → 保留最小 Dock，见 E 条目
 *
 * REACT 19 LINT RULES HONOURED
 * -----------------------------
 *   • No `ref.current` read during render — refs are read only inside effects
 *     and event handlers.
 *   • No `Math.random()` / `Date.now()` during render — the only clock reads
 *     live in `useEffect` bodies / event handlers; the animation phase comes
 *     from the pure `bookBreathPhase(id)`.
 *   • No `setState` in `useEffect` for derived data — every derived value is a
 *     `useMemo`; effects only perform async I/O or mirror Android's
 *     `LaunchedEffect` writes.
 *   • NO HOOKS INSIDE `.map()` — every repeated element is its own component
 *     (`<ShelfBookCard>`, `<FavoriteGridCard>`, `<CategoryDropPill>`, …).
 *   • No conditional hooks — hooks run unconditionally at the top of components.
 *
 * THEME
 * -----
 * Light, matching Android's light branch and `src/styles/theme.css`:
 * white `#FFFFFF` page, `#18191C` ink, `#61666D` secondary, primary `#059669`,
 * gold `#E8C97A` for progress/streak only.
 */

import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createFavoriteRepository } from '@core/library/favoriteRepository';
import { FavoriteDao } from '@core/library/favoriteDao';
import { DEFAULT_CATEGORY, type BookRow } from '@core/library/bookTypes';
import {
  type FavoriteItem,
} from '@core/library/favoriteTypes';
import {
  type PreferencesManager,
  SettingsRepository,
  createPreferencesManager,
} from '@core/settings/settingsRepository';
import {
  ALL_FAV_CATEGORY,
  CATEGORY_EMPTY_ACTION,
  CATEGORY_EMPTY_TEST_TAG,
  CATEGORY_LOCKED_ACTION,
  CATEGORY_LOCKED_SUBTITLE,
  DEFAULT_CATEGORY_DELETE_TOAST,
  DROP_PREFIX_CATEGORY,
  DROP_PREFIX_FAV_CATEGORY,
  DROP_TARGET_FAVORITE,
  DROP_TARGET_NEW,
  DRAG_HINT_MAX_SHOWS,
  EMPTY_FAVORITES_ACTION,
  EMPTY_FAVORITES_DESCRIPTION,
  EMPTY_FAVORITES_TEST_TAG,
  EMPTY_FAVORITES_TITLE,
  EMPTY_SHELF_ACTION,
  EMPTY_SHELF_DESCRIPTION,
  EMPTY_SHELF_IMPORT_LABEL,
  EMPTY_SHELF_TEST_TAG,
  EMPTY_SHELF_TITLE,
  FAV_CATEGORY_DIALOG_DESCRIPTION,
  FAV_CATEGORY_DIALOG_TITLE,
  FAVORITES_LOCKED_TITLE,
  FavoriteSort,
  LONG_PRESS_MS,
  PICK_UP_MS,
  SHELF_CATEGORY_DIALOG_DESCRIPTION,
  SHELF_CATEGORY_DIALOG_TITLE,
  SHELF_HEAL_LOG_TAG,
  SHELF_KEY_FAV_PREFIX,
  SORT_LABELS,
  type HomeBook,
  type HomeCategory,
  type Rect,
  type ShelfSelectionState,
  assembleFavoriteItems,
  bookActionsSpec,
  bookBreathPhase,
  bookCardProgressFraction,
  bookCardShowsProgress,
  bookCardVisual,
  categoryCreatedToast,
  categoryDeleteCopy,
  categoryEmptyDescription,
  categoryEmptyTitle,
  categoryLockedTitle,
  coverFilePath,
  createShelfSelection,
  favKeyOfBook,
  currentlyReading,
  dropTargetOfCategory,
  dropTargetOfFavoriteCategory,
  endDrag,
  exitSelection,
  favoriteActionsSpec,
  favoriteCoverSrc,
  favCardMeta,
  favCustomCategories,
  favLockedRowText,
  favoritesLocked,
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
  longPressAction,
  markedFinishedBooks,
  nextDragHintShown,
  orphanBooks,
  pickDropTarget,
  planDropToCategory,
  planDropToFavorite,
  planDropToFavoriteCategory,
  pruneSelection,
  resolveCoverSrc,
  resolveShelfCategory,
  selectAllKeys,
  selectedCategoryLocked,
  selectableKeys,
  shelfAliveKeys,
  shelfHealLogMessage,
  sortFavoriteItems,
  sortShelfBooks,
  splitShelfKeys,
  streakDaysText,
  todayReadTimeText,
  toggleKey,
} from '@core/home/homeViewModel';
import { getPlatform } from '@platform/index';
import { createSearchBook } from '@core/library/comicSourceTypes';
import { ActionChip } from '@ui/components/Chips';
import {
  CategoryPill as ShelfCategoryPill,
  ShelfSelectBadge,
} from '@ui/components/shelf/CategoryPill';
import { EmptyState } from '@ui/components/EmptyState';
import { GlassCard } from '@ui/components/GlassCard';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import { dateStrOf } from '@ui/lib/readingStats';
import { showToast } from '@ui/toast';
import { bootstrapLibrary, getBookRepository, useAppStore } from '@ui/state/appStore';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { usePrivateImageSrc } from '@ui/hooks/usePrivateImageSrc';
import { openOnlineBook } from '@ui/lib/openOnlineBook';
import { createSearchBook as createSourceSearchBook } from '@core/source/searchBook';
import { COLORS } from '@ui/theme/tokens';
import '../../styles/homePage.css';

/* ═══════════════════════════════════════════════════════════════════
   Material icon SVG (HomeScreen.kt imports 24–43)
   ═══════════════════════════════════════════════════════════════════ */

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function CategoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-1H3v1zm0-5h8v-1H3v1z" />
    </svg>
  );
}

function AutoAwesomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
    </svg>
  );
}

function MenuBookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  );
}

function FavoriteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function FolderIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.27 2.91 2.88 2.91s2.88-1.3 2.88-2.91-1.27-2.9-2.88-2.9z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function MoreVertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

function SelectAllIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M3 5h2V3H1v4h2V5zm0 16H1v-4h2v2h2v-2h14v2h2v-4h-2v2h-2v-2H5v2H3v-2zm0-8h2v-2h14v2h2V9H5v2H3v2zm4-4h14V7h2V5H5v2h2zm0 12h14v-2H7v2zM9 7h2v2h2V7h4V5h-8v2zm0 8h2v-2H9v2zm8-2v2h2v-2h-2z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2212–2277 ShelfDragCover
   ═══════════════════════════════════════════════════════════════════ */

function ShelfDragCover(props: { itemKey: string; books: HomeBook[]; favSorted: FavoriteItem[] }) {
  let src: string | null = null;
  if (isFavShelfKey(props.itemKey)) {
    const raw = props.favSorted.find(
      (it) => `${SHELF_KEY_FAV_PREFIX}${it.favorite.sourceId}::${it.favorite.comicId}` === props.itemKey,
    );
    src = raw === undefined ? null : favoriteCoverSrc(raw);
  } else {
    const book = props.books.find((b) => String(b.id) === props.itemKey);
    src = book === undefined ? null : resolveCoverSrc(book.coverUri, book.isCoverValid);
  }
  src = usePrivateImageSrc(src);
  if (src !== null) {
    return <img className="hp-drag-ghost__cover" src={src} alt="" />;
  }
  return (
    <span className="hp-drag-ghost__fallback">
      {isFavShelfKey(props.itemKey) ? <FavoriteIcon size={28} /> : <MenuBookIcon size={28} />}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2100–2144 MultiSelectTopBar
   ═══════════════════════════════════════════════════════════════════ */

function MultiSelectTopBar(props: {
  count: number;
  allSelected: boolean;
  onClose: () => void;
  onToggleAll: () => void;
}) {
  return (
    <div className="hp-multiselect-topbar" role="toolbar" aria-label="多选操作">
      <div className="hp-multiselect-bar">
        <button
          type="button"
          className="hp-multiselect-bar__close"
          aria-label="退出多选"
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
        <span className="hp-multiselect-bar__label">已选择</span>
        <span className="hp-multiselect-bar__count">{props.count}</span>
        <span className="hp-multiselect-bar__label">本</span>
        <button
          type="button"
          className={props.allSelected ? 'hp-ms-pill hp-ms-pill--active' : 'hp-ms-pill'}
          onClick={props.onToggleAll}
        >
          {props.allSelected ? <CloseIcon /> : <SelectAllIcon />}
          {props.allSelected ? '取消全选' : '全选'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1994–2089 MultiSelectActionBar
   ═══════════════════════════════════════════════════════════════════ */

function actionIcon(label: string): ReactElement {
  switch (label) {
    case '打开':
      return <MenuBookIcon size={20} />;
    case '移动':
      return <FolderIcon />;
    case '分享':
      return <ShareIcon />;
    case '取消喜欢':
      return <FavoriteIcon />;
    case '删除下载':
      return <DeleteIcon />;
    default:
      return <MoreVertIcon />;
  }
}

function MultiSelectActionBar(props: {
  actions: readonly { label: string; destructive: boolean; enabled: boolean }[];
  onPick: (label: string) => void;
}) {
  return (
    <div className="hp-actionbar">
      <div className="hp-actionbar__inner">
        {props.actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={
              action.destructive
                ? 'hp-actionbar__item hp-actionbar__item--destructive'
                : 'hp-actionbar__item'
            }
            disabled={!action.enabled}
            onClick={() => {
              if (action.enabled) props.onPick(action.label);
            }}
          >
            <span className="hp-actionbar__icon">{actionIcon(action.label)}</span>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   448–464 / 567–582 MoreActionSheet
   ⚠️ ShelfSelectionHost.kt L543–565 的签名里**没有 title 参数**，面板标题恒为
   「更多操作」。之前这个组件多了一个 title prop，收藏分类的长按面板就把分类名
   当成了面板标题 —— 凭空加的 UI 参数，已删除。
   ═══════════════════════════════════════════════════════════════════ */

function MoreActionSheet(props: {
  titles: readonly string[];
  onPick: (title: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="hp-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-sheet"
        role="dialog"
        aria-label="更多操作"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="hp-sheet__title">更多操作</p>
        {props.titles.map((title) => (
          <button
            key={title}
            type="button"
            className="hp-sheet__row"
            onClick={() => props.onPick(title)}
          >
            {title}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   402–445 CategoryPickerSheet
   ═══════════════════════════════════════════════════════════════════ */

function CategoryPickerSheet(props: {
  categories: readonly string[];
  title: string;
  onPick: (name: string) => void;
  onCreate: (name: string) => void;
  onDismiss: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  return (
    <div className="hp-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-sheet"
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="hp-sheet__title">{props.title}</p>
        {props.categories.map((name) => (
          <button
            key={name}
            type="button"
            className="hp-sheet__row"
            onClick={() => props.onPick(name)}
          >
            <span className="hp-sheet__row-name">{name}</span>
            <span className="hp-sheet__primary">
              <CheckIcon />
            </span>
          </button>
        ))}
        <button type="button" className="hp-sheet__row" onClick={() => setCreating(true)}>
          <span className="hp-sheet__primary">
            <AddIcon />
          </span>
          <span className="hp-sheet__primary">＋新建分类</span>
        </button>
        {creating ? (
          <>
            <input
              className="hp-field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="分类名称"
              aria-label="分类名称"
            />
            <button
              type="button"
              className="hp-btn-continue"
              style={{ width: '100%', marginTop: 8 }}
              disabled={newName.trim() === ''}
              onClick={() => {
                if (newName.trim() !== '') {
                  props.onCreate(newName.trim());
                  setCreating(false);
                  setNewName('');
                }
              }}
            >
              创建并放入
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2315–2358 NewCategoryDialog
   ═══════════════════════════════════════════════════════════════════ */

function NewCategoryDialog(props: {
  title: string;
  description: string;
  onCreate: (name: string) => void;
  onDismiss: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">{props.title}</h3>
        <p className="hp-dialog__desc">{props.description}</p>
        <input
          className="hp-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称"
          aria-label="名称"
        />
        <div className="hp-dialog__actions">
          <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
          <button
            type="button"
            className="hp-dialog__btn hp-dialog__btn--primary"
            disabled={name.trim() === ''}
            onClick={() => props.onCreate(name.trim())}
          >
            新建
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   360–398 CategoryDeleteDialog
   ═══════════════════════════════════════════════════════════════════ */

function CategoryDeleteDialog(props: {
  categoryName: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const copy = categoryDeleteCopy(props.categoryName);
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">{copy.title}</h3>
        <p className="hp-dialog__text">{copy.text}</p>
        <div className="hp-dialog__actions">
          {copy.dismissLabel !== null ? (
            <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
              {copy.dismissLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={
              copy.isDefaultCategory
                ? 'hp-dialog__btn hp-dialog__btn--primary'
                : 'hp-dialog__btn hp-dialog__btn--danger'
            }
            onClick={copy.isDefaultCategory ? props.onDismiss : props.onConfirm}
          >
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   467–501 MoveBookDialog
   ═══════════════════════════════════════════════════════════════════ */

function MoveBookDialog(props: {
  book: HomeBook;
  categories: readonly HomeCategory[];
  onPick: (name: string) => void;
  onDismiss: () => void;
}) {
  const available = props.categories.filter((c) => c.name !== props.book.category);
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择目标分类"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">选择目标分类</h3>
        {available.length === 0 ? (
          <p className="hp-dialog__text">没有其他可用的分类。</p>
        ) : (
          available.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="hp-sheet__row"
              onClick={() => props.onPick(cat.name)}
            >
              <span className="hp-sheet__row-name">{cat.name}</span>
            </button>
          ))
        )}
        <div className="hp-dialog__actions">
          <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   504–530 DeleteBookDialog
   ═══════════════════════════════════════════════════════════════════ */

function DeleteBookDialog(props: {
  title: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="移出此书"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">移出此书</h3>
        <p className="hp-dialog__text">确认要将《{props.title}》从书架中移出吗？</p>
        <div className="hp-dialog__actions">
          <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
          <button
            type="button"
            className="hp-dialog__btn hp-dialog__btn--danger"
            onClick={props.onConfirm}
          >
            确认移出
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   584–627 RenameFavoriteCategoryDialog
   ═══════════════════════════════════════════════════════════════════ */

function RenameCategoryDialog(props: {
  initial: string;
  onSave: (next: string) => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(props.initial);
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="重命名分类"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">重命名分类</h3>
        <input
          className="hp-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="名称"
          aria-label="名称"
        />
        <div className="hp-dialog__actions">
          <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
          <button
            type="button"
            className="hp-dialog__btn hp-dialog__btn--primary"
            onClick={() => props.onSave(text.trim())}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   629–658 DeleteFavCategoryDialog
   ═══════════════════════════════════════════════════════════════════ */

function DeleteFavCategoryDialog(props: { onConfirm: () => void; onDismiss: () => void }) {
  return (
    <div className="hp-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="删除收藏分类"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="hp-dialog__title">删除收藏分类</h3>
        <p className="hp-dialog__desc">
          删除后，该分类里的收藏会移到「默认」，收藏本身不会被删除。书架分类不受影响。
        </p>
        <div className="hp-dialog__actions">
          <button type="button" className="hp-dialog__btn" onClick={props.onDismiss}>
            取消
          </button>
          <button
            type="button"
            className="hp-dialog__btn hp-dialog__btn--danger"
            onClick={props.onConfirm}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   661–675 / 2190–2204 PrivacyPinOverlay (VERIFY)
   ═══════════════════════════════════════════════════════════════════ */

function PrivacyPinOverlay(props: { onPinVerified(pin: string): Promise<boolean> | boolean; onDismiss(): void }) {
  return <ActualPinOverlay mode="VERIFY" onPinSet={() => {}} onPinVerified={props.onPinVerified} onDismiss={props.onDismiss} />;
}

/* ═══════════════════════════════════════════════════════════════════
   2477–2634 CategoryActionSheet
   ═══════════════════════════════════════════════════════════════════ */

function CategoryActionSheet(props: {
  category: HomeCategory;
  privacyModeEnabled: boolean;
  onToggleProtected: (next: boolean) => void;
  onDeleteRequest: () => void;
  onGoToSettings: () => void;
  onDismiss: () => void;
}) {
  const isDefault = props.category.name === DEFAULT_CATEGORY;
  return (
    <div className="hp-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-sheet"
        role="dialog"
        aria-label={props.category.name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hp-sheet__row hp-sheet__row--strong">
          <span className="hp-lock-icon">
            {props.category.isProtected ? <LockIcon size={17} /> : <FolderIcon size={17} />}
          </span>
          {props.category.name}
        </div>
        {props.privacyModeEnabled ? (
          <div className="hp-sheet__row" style={{ cursor: 'default' }}>
            <span className="hp-sheet__row-name">
              <span style={{ fontSize: 13, display: 'block' }}>密码保护</span>
              <span style={{ fontSize: 10, color: 'rgba(24,25,28,0.45)', display: 'block' }}>
                进入此分类需要验证密码 · 无痕阅读
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={props.category.isProtected}
              aria-label="密码保护"
              className={props.category.isProtected ? 'hp-switch hp-switch--on' : 'hp-switch'}
              onClick={() => props.onToggleProtected(!props.category.isProtected)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="hp-sheet__row"
            onClick={() => {
              props.onDismiss();
              props.onGoToSettings();
            }}
          >
            <span className="hp-sheet__row-name">设置密码保护</span>
            <span className="hp-sheet__primary">需先开启隐私模式 ›</span>
          </button>
        )}
        <button
          type="button"
          className={isDefault ? 'hp-sheet__row hp-sheet__row--muted' : 'hp-sheet__row hp-sheet__row--danger'}
          disabled={isDefault}
          onClick={() => {
            if (!isDefault) props.onDeleteRequest();
          }}
        >
          <span className="hp-sheet__row-name">
            {isDefault ? '删除分类（默认分类不可删除）' : '删除分类'}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2636–2857 BookActionSheet
   ═══════════════════════════════════════════════════════════════════ */

function BookActionSheet(props: {
  book: HomeBook;
  onOpenDetail: () => void;
  onMove: () => void;
  onShare: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const coverSrc = usePrivateImageSrc(resolveCoverSrc(props.book.coverUri, props.book.isCoverValid));
  return (
    <div className="hp-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="hp-sheet"
        role="dialog"
        aria-label={props.book.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 14, padding: '0 4px 12px' }}>
          <span className="hp-sheet__cover">
            {coverSrc !== null ? <img src={coverSrc} alt={props.book.title} /> : null}
          </span>
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>
            <p className="hp-sheet__book-title">{props.book.title}</p>
            <p className="hp-sheet__book-author">{props.book.author}</p>
          </span>
        </div>
        <hr className="hp-sheet__divider" />
        <button type="button" className="hp-sheet__row" onClick={props.onOpenDetail}>
          <span className="hp-sheet__primary">
            <MenuBookIcon size={22} />
          </span>
          <span className="hp-sheet__row-name">打开详情</span>
        </button>
        <button type="button" className="hp-sheet__row" onClick={props.onMove}>
          <span className="hp-sheet__primary">
            <FolderIcon size={22} />
          </span>
          <span className="hp-sheet__row-name">移动到其他书架</span>
        </button>
        <button type="button" className="hp-sheet__row" onClick={props.onShare}>
          <span className="hp-sheet__primary">
            <ShareIcon />
          </span>
          <span className="hp-sheet__row-name">分享图书</span>
        </button>
        <button
          type="button"
          className="hp-sheet__row hp-sheet__row--danger"
          onClick={props.onDelete}
        >
          <span className="hp-sheet__row-name" style={{ color: '#dc2626' }}>
            删除图书
          </span>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1362–1422 CategoryLockedRow
   ═══════════════════════════════════════════════════════════════════ */

function CategoryLockedRow(props: { categoryName: string; onVerify: () => void }) {
  return (
    <div className="hp-lock-row">
      <span className="hp-lock-icon">
        <LockIcon size={18} />
      </span>
      <span className="hp-lock-copy">
        <p className="hp-lock-title">{categoryLockedTitle(props.categoryName)}</p>
        <p className="hp-lock-sub">{CATEGORY_LOCKED_SUBTITLE}</p>
      </span>
      <button type="button" className="hp-lock-verify" onClick={props.onVerify}>
        {CATEGORY_LOCKED_ACTION}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1846–1886 FavoritesLockedRow
   ═══════════════════════════════════════════════════════════════════ */

function FavoritesLockedRow(props: { onVerify: () => void }) {
  return (
    <button type="button" className="hp-lock-row hp-lock-row--button" onClick={props.onVerify}>
      <span className="hp-lock-icon">
        <LockIcon size={18} />
      </span>
      <span className="hp-lock-copy">
        <p className="hp-lock-title">{FAVORITES_LOCKED_TITLE}</p>
        <p className="hp-lock-sub">{favLockedRowText()}</p>
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1068–1254 hero_section
   ═══════════════════════════════════════════════════════════════════ */

function HeroCover(props: { book: HomeBook }) {
  const [failed, setFailed] = useState(false);
  const src = usePrivateImageSrc(failed ? null : resolveCoverSrc(props.book.coverUri, props.book.isCoverValid));
  if (src === null) {
    return (
      <div className="home-hero__cover">
        <div className="home-hero__cover-fallback">
          <span className="home-hero__cover-fallback-icon">
            <AutoAwesomeIcon />
          </span>
          <p className="home-hero__cover-fallback-title">{props.book.title}</p>
        </div>
        <span className="home-hero__spine" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="home-hero__cover">
      <img
        className="home-hero__cover-img"
        src={src}
        alt={props.book.title}
        onError={() => setFailed(true)}
      />
      <span className="home-hero__spine" aria-hidden="true" />
    </div>
  );
}

function HeroSection(props: { book: HomeBook; onOpen: (book: HomeBook) => void }) {
  const progress = heroProgressPercent(props.book);
  return (
    <section className="home-hero">
      <h2 className="home-section-title home-hero__title">正在阅读</h2>
      <GlassCard radius={20} padding={16} className="home-hero__card">
        <div className="home-hero__row">
          <HeroCover book={props.book} />
          <div className="home-hero__meta">
            <p className="home-hero__book-title">{props.book.title}</p>
            <p className="home-hero__author">著&nbsp;&nbsp;{props.book.author}</p>
            <div className="home-hero__progress-row">
              <div
                className="home-progress"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="home-progress__fill" style={{ width: `${String(progress)}%` }} />
              </div>
              <span className="home-hero__progress-label">已读 {String(progress)}%</span>
            </div>
            <div className="home-hero__actions">
              <button
                type="button"
                className="hp-btn-continue"
                onClick={() => props.onOpen(props.book)}
              >
                继续阅读
              </button>
            </div>
          </div>
        </div>
      </GlassCard>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1435–1752 book card
   ═══════════════════════════════════════════════════════════════════ */

function BookCoverInner(props: { book: HomeBook }) {
  const book = props.book;
  const [failed, setFailed] = useState(false);
  const src = usePrivateImageSrc(failed ? null : resolveCoverSrc(book.coverUri, book.isCoverValid));
  const isComic = book.contentType === 'COMIC';
  if (src === null) {
    return (
      <div className="hp-book-card__fallback">
        <span className="hp-book-card__fallback-icon">
          <MenuBookIcon />
        </span>
        <p className="hp-book-card__fallback-title">{book.title}</p>
        <p
          className={
            isComic
              ? 'hp-book-card__fallback-type hp-book-card__fallback-type--comic'
              : 'hp-book-card__fallback-type'
          }
        >
          {isComic ? '漫画' : 'TXT'}
        </p>
      </div>
    );
  }
  return (
    <>
      <img
        className="hp-book-card__cover-img"
        src={src}
        alt={book.title}
        onError={() => setFailed(true)}
      />
      <span className="hp-book-card__cover-sheen" aria-hidden="true" />
    </>
  );
}

/* 1680–1688 ShelfSelectBadge —— ShelfSelectionHost.kt L183–223
 * ⚠️ 之前在本文件里另写了一个 aria-hidden 的简化版（没有 contentDescription、
 * 没有 0.7 的未选中缩放）。Kotlin 的语义是 `已选中` / `未选中`，且未选中时
 * scale 0.7 —— 改用 ui/components/shelf 的逐行移植件。 */

interface CardPointerHandlers {
  onPointerDown: (key: string, x: number, y: number) => void;
  onPointerMove: (x: number, y: number) => void;
  onPointerUp: () => void;
}

function ShelfBookCard(props: {
  book: HomeBook;
  selected: boolean;
  hidden: boolean;
  alpha: number;
  scale: number;
  showSelectBadge: boolean;
  favKeyed: boolean;
  breathing: boolean;
  breathDelayMs: number;
  onOpen: (book: HomeBook) => void;
  onTapItem: (book: HomeBook) => void;
  handlers: CardPointerHandlers;
}) {
  const book = props.book;
  const key = String(book.id);
  const progress = bookCardProgressFraction(book);
  return (
    <div
      className="hp-book-card"
      role="button"
      tabIndex={0}
      hidden={props.hidden}
      aria-label={book.title}
      aria-pressed={props.selected}
      onPointerDown={(e) => props.handlers.onPointerDown(key, e.clientX, e.clientY)}
      onPointerMove={(e) => props.handlers.onPointerMove(e.clientX, e.clientY)}
      onPointerUp={props.handlers.onPointerUp}
      onPointerCancel={props.handlers.onPointerUp}
      onClick={() => props.onTapItem(book)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onOpen(book);
        }
      }}
    >
      <div
        className={
          props.breathing ? 'hp-book-card__body hp-book-card__body--breathing' : 'hp-book-card__body'
        }
        style={{
          opacity: props.alpha,
          /* ⚠️ 必须用独立的 `scale` 长属性而不是 `transform: scale()`：
           * 呼吸动画的 @keyframes hp-shelf-breathe 也写 `transform: translateY(±3px)`，
           * 而 CSS 动画的优先级高于内联样式 —— 两者会互相覆盖，浏览态下按压缩放
           * （PRESS_SCALE 0.96）会被呼吸关键帧吃掉。独立长属性可以和 transform 叠加。 */
          scale: String(props.scale),
          animationDelay: `${String(props.breathDelayMs)}ms`,
        }}
      >
        <div className="hp-book-card__cover">
          <BookCoverInner book={book} />
          <span className="hp-book-card__spine" aria-hidden="true" />
          {props.favKeyed ? (
            <span className="hp-book-card__fav" role="img" aria-label="已加入我喜欢的">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <defs>
                  <linearGradient id="hp-heart-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF9AAB" />
                    <stop offset="50%" stopColor="#FF4D6D" />
                    <stop offset="100%" stopColor="#DC1B52" />
                  </linearGradient>
                </defs>
                <path
                  fill="url(#hp-heart-grad)"
                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                />
              </svg>
            </span>
          ) : null}
          {props.showSelectBadge ? <ShelfSelectBadge selected={props.selected} /> : null}
        </div>
        <p className="hp-book-card__title">{book.title}</p>
        {book.isFinished ? (
          <span className="hp-book-card__finished">
            <CheckCircleIcon />
            已读完
          </span>
        ) : null}
        {bookCardShowsProgress(book) ? (
          <>
            <div className="hp-book-card__progress" aria-hidden="true">
              <div
                className="hp-book-card__progress-fill"
                style={{ width: `${String(progress * 100)}%` }}
              />
            </div>
            <p className="hp-book-card__progress-label">
              {String(book.currentChapterIndex)}/{String(book.totalChapters)} 章
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1899–1926 FavoriteCard
   ═══════════════════════════════════════════════════════════════════ */

function FavoriteGridCard(props: {
  item: FavoriteItem;
  shelfKey: string;
  selected: boolean;
  hidden: boolean;
  dimmed: boolean;
  multiSelecting: boolean;
  onOpen: (item: FavoriteItem) => void;
  onTapItem: (key: string) => void;
  handlers: CardPointerHandlers;
}) {
  const item = props.item;
  const fav = item.favorite;
  const meta = favCardMeta(item);
  const [failed, setFailed] = useState(false);
  const raw = favoriteCoverSrc(item);
  const src = usePrivateImageSrc(failed ? null : raw);
  const classes = [
    'hp-fav-card',
    props.dimmed ? 'hp-fav-card--dimmed' : '',
    props.selected ? 'hp-fav-card--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      hidden={props.hidden}
      aria-label={fav.title}
      aria-pressed={props.selected}
      /* FavoritesPanel.kt L296–300 `pressAnim = if (pressed) 0.97f else 1f` ——
       * Web 侧由 homePage.css 的 `.hp-fav-card:active { transform: scale(0.97) }`
       * 承担（同一个 0.97）。这里不再叠一层内联缩放，否则会平方成 0.9409。 */
      onPointerDown={(e) => props.handlers.onPointerDown(props.shelfKey, e.clientX, e.clientY)}
      onPointerMove={(e) => props.handlers.onPointerMove(e.clientX, e.clientY)}
      onPointerUp={props.handlers.onPointerUp}
      onPointerCancel={props.handlers.onPointerUp}
      onClick={() => props.onTapItem(props.shelfKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onOpen(item);
        }
      }}
    >
      <div className="hp-fav-card__cover">
        {src !== null ? (
          <img
            className="hp-fav-card__cover-img"
            src={src}
            alt={fav.title}
            onError={() => setFailed(true)}
          />
        ) : null}
        {meta.hasUpdate ? <span className="hp-fav-card__tag hp-fav-card__tag--update">更新</span> : null}
        {meta.unread > 0 ? (
          <span className="hp-fav-card__tag hp-fav-card__tag--unread">未读 {String(meta.unread)} 话</span>
        ) : null}
        <span className="hp-fav-card__tag hp-fav-card__tag--source">{fav.sourceId}</span>
        {item.downloadedChapters > 0 ? (
          <span className="hp-fav-card__tag hp-fav-card__tag--downloaded">
            已下载 {String(item.downloadedChapters)} 话
          </span>
        ) : null}
        {props.multiSelecting ? <ShelfSelectBadge selected={props.selected} /> : null}
        {meta.dead ? (
          <span className="hp-fav-card__dead" role="img" aria-label="来源失效">
            <WarningIcon />
          </span>
        ) : null}
      </div>
      <p className="hp-fav-card__title">{fav.title}</p>
      <p className="hp-fav-card__subtitle">{meta.subtitle}</p>
      {meta.ratio !== null ? (
        <div className="hp-fav-card__progress" aria-hidden="true">
          <div
            className="hp-fav-card__progress-fill"
            style={{ width: `${String(meta.ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1307–1355 分类胶囊（落点目标）
   ⚠️ 之前用的是 @ui/components/Chips 的简化胶囊：它没有 dropHighlight，
   而且对 `locked` 直接 `disabled` —— Android 侧受保护分类**照样可点**，
   点击走 PIN 验证（L1341–1346 `locked -> pinVerifyFor = cat`）。改用
   ui/components/shelf/CategoryPill（ShelfChips.kt L61–184 的逐行移植件）。
   ═══════════════════════════════════════════════════════════════════ */

function CategoryDropPill(props: {
  cat: HomeCategory;
  count: number;
  selected: boolean;
  locked: boolean;
  dropId: string | null;
  dropHighlight: boolean;
  registerTarget: (id: string, el: HTMLElement | null) => void;
  onClick: () => void;
  onLongClick: () => void;
}) {
  return (
    <span
      className={
        props.dropId !== null
          ? 'hp-cat-pill-wrap hp-cat-pill-wrap--drop'
          : 'hp-cat-pill-wrap'
      }
      ref={(el) => {
        if (props.dropId !== null) props.registerTarget(props.dropId, el);
      }}
    >
      <ShelfCategoryPill
        name={props.cat.name}
        selected={props.selected}
        locked={props.locked}
        count={props.count}
        dropHighlight={props.dropHighlight}
        onClick={props.onClick}
        onLongClick={props.onLongClick}
      />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   974–1017 whole-page empty state / 1360–1433 shelf empty / 1887–1897 fav empty
   / 1928–1989 bottom stats — 模块级组件（不得在渲染期创建组件）
   ═══════════════════════════════════════════════════════════════════ */

/* 974–1017 whole-page empty state
 * ⚠️ 顺序按 HomeScreen.kt：先 MascotEmptyState（actionLabel = 立即前往在线书库），
 *    再 Spacer(8.dp)，最后才是 testTag="empty_bookshelf_import_button" 的
 *    「或者 导入本地 TXT / EPUB / Comic 文件」。之前把导入按钮排到了前面。 */
function EmptyShelf(props: { onImport: () => void; onGoLibrary: () => void }) {
  return (
    <div className="hp-empty" data-testid={EMPTY_SHELF_TEST_TAG}>
      <EmptyState
        title={EMPTY_SHELF_TITLE}
        subtitle={EMPTY_SHELF_DESCRIPTION}
        action={
          <button type="button" className="hp-btn-continue" onClick={props.onGoLibrary}>
            {EMPTY_SHELF_ACTION}
          </button>
        }
      />
      <button
        type="button"
        className="hp-empty__import"
        data-testid="empty_bookshelf_import_button"
        onClick={props.onImport}
      >
        {EMPTY_SHELF_IMPORT_LABEL}
      </button>
    </div>
  );
}

function ShelfEmptyState(props: {
  categoryLocked: boolean;
  categoryName: string;
  onImport: () => void;
  onVerify: () => void;
}) {
  if (props.categoryLocked) {
    return <CategoryLockedRow categoryName={props.categoryName} onVerify={props.onVerify} />;
  }
  return (
    <div data-testid={CATEGORY_EMPTY_TEST_TAG}>
      <EmptyState
        title={categoryEmptyTitle()}
        subtitle={categoryEmptyDescription(props.categoryName)}
        action={
          <button type="button" className="hp-btn-continue" onClick={props.onImport}>
            {CATEGORY_EMPTY_ACTION}
          </button>
        }
      />
    </div>
  );
}

function FavEmptyState(props: { onGoLibrary: () => void }) {
  return (
    <div data-testid={EMPTY_FAVORITES_TEST_TAG}>
      <EmptyState
        title={EMPTY_FAVORITES_TITLE}
        subtitle={EMPTY_FAVORITES_DESCRIPTION}
        action={
          <button type="button" className="hp-btn-continue" onClick={props.onGoLibrary}>
            {EMPTY_FAVORITES_ACTION}
          </button>
        }
      />
    </div>
  );
}

function ReadingStatsCard(props: {
  todayReadSeconds: number;
  streakDays: number;
  onOpenStats: () => void;
}) {
  return (
    <section className="home-stats">
      <h2 className="home-section-title home-stats__title">阅读统计</h2>
      <GlassCard
        radius={16}
        padding={16}
        className="home-stats__card"
        onClick={props.onOpenStats}
      >
        <div className="home-stats__row">
          <div className="home-stats__copy">
            <p className="home-stats__today">{todayReadTimeText(props.todayReadSeconds)}</p>
            <p className="home-stats__subtitle">保持阅读，遇见更好的自己。</p>
          </div>
          <div className="home-stats__streak">
            <span className="home-stats__streak-star" aria-hidden="true">
              ★
            </span>
            {streakDaysText(props.streakDays)}
          </div>
        </div>
      </GlassCard>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HomeScreen.kt 118 — the composable
   ═══════════════════════════════════════════════════════════════════ */

export function HomePage() {
  /* ── Android: injected params (118–183) ── */
  const storeBooks = useAppStore((s) => s.books);
  const primaryIndex = useAppStore((s) => s.primaryIndex);
  const secondaryIndex = useAppStore((s) => s.secondaryIndex);
  const setRoute = useAppStore((s) => s.setRoute);
  const setTab = useAppStore((s) => s.setTab);
  const setCurrentBookId = useAppStore((s) => s.setCurrentBookId);
  const openBook = useAppStore((s) => s.openBook);
  const addCategory = useAppStore((s) => s.addCategory);
  const loadLibrary = useAppStore((s) => s.loadLibrary);

  const platform = useMemo(() => getPlatform(), []);
  const favorites = useMemo(
    () =>
      getLibraryRuntime()?.favorites ?? createFavoriteRepository({
        dao: new FavoriteDao(platform.db),
        // Android injects the ComicSource resolver from LibraryViewModel
        // (MainViewModel.kt 57–61). The TS build has no live source registry yet,
        // so update checks degrade to "mark stale" — same fallback shape as
        // Android when comicSourceProvider returns null.
        comicSourceOf: () => Promise.resolve(null),
      }),
    [platform],
  );
  const settings = useMemo(() => new SettingsRepository(platform.db), [platform]);
  const prefs = useMemo<PreferencesManager>(() => createPreferencesManager(platform.db), [platform]);

  /* ── Android: data (books / categories / favoriteItems / …) ── */
  const [books, setBooks] = useState<HomeBook[]>([]);
  const [categories, setCategories] = useState<HomeCategory[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [favoriteKeys, setFavoriteKeys] = useState<ReadonlySet<string>>(new Set<string>());
  const [favoriteCategories, setFavoriteCategories] = useState<string[]>([]);
  const [storeLoaded, setStoreLoaded] = useState(false);

  /* ── Android: 137 todayReadSecondsFlow / 186 streakDaysFlow ── */
  const [todayReadSeconds, setTodayReadSeconds] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  /* ── Android: 143 privacyModeEnabled / 176 favoritesProtected ── */
  const [privacyModeEnabled, setPrivacyModeEnabled] = useState(() => getPrivacyService().getSnapshot().enabled);
  const [favoritesProtected, setFavoritesProtected] = useState(true);
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<ReadonlySet<number>>(
    new Set<number>(),
  );

  /* ── Android: 197–199 search state ── */
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  /* ── Android: 209 selectedCategory (held by MainActivity in Kotlin) ── */
  const [shelfCategory, setShelfCategory] = useState(DEFAULT_CATEGORY);
  /* ── Android: 222–250 dialog / sheet / selection state ── */
  const [sortBy, setSortBy] = useState(0);
  const [selection, setSelection] = useState<ShelfSelectionState>(() => createShelfSelection());
  const [bookToDelete, setBookToDelete] = useState<HomeBook | null>(null);
  const [bookToMove, setBookToMove] = useState<HomeBook | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<HomeCategory | null>(null);
  const [categorySheetFor, setCategorySheetFor] = useState<HomeCategory | null>(null);
  const [pinVerifyFor, setPinVerifyFor] = useState<HomeCategory | null>(null);
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showAddFavoriteCategoryDialog, setShowAddFavoriteCategoryDialog] = useState(false);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState(-1);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [favCategorySheetFor, setFavCategorySheetFor] = useState<string | null>(null);
  const [favCategoryRenameFor, setFavCategoryRenameFor] = useState<string | null>(null);
  const [favCategoryDeleteFor, setFavCategoryDeleteFor] = useState<string | null>(null);
  const [favoritesPinFor, setFavoritesPinFor] = useState(false);
  const [favoritesUnlocked, setFavoritesUnlocked] = useState(false);
  useEffect(() => {
    const service = getPrivacyService();
    const update = (): void => {
      const state = service.getSnapshot(); if (!state.loaded) return;
      setPrivacyModeEnabled(state.enabled); setFavoritesUnlocked(state.favoritesUnlocked); setUnlockedCategoryIds(new Set(state.unlockedCategoryIds));
    };
    const unsubscribe = service.subscribe(update);
    void service.ready().then(update).catch((error: unknown) => showToast(error instanceof Error ? error.message : '无法读取隐私保护状态'));
    return unsubscribe;
  }, []);
  const [pendingNewCategoryKeys, setPendingNewCategoryKeys] = useState<readonly string[]>([]);
  const [favoriteCategory, setFavoriteCategory] = useState(ALL_FAV_CATEGORY);
  const [favoriteSort] = useState(FavoriteSort.RECENT_FAVORITE);
  const [favoriteRefreshing, setFavoriteRefreshing] = useState(false);
  const [undo, setUndo] = useState<{ message: string; action: (() => void) | null } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [screenWidthDp, setScreenWidthDp] = useState(375);
  /**
   * Android 224 `var longPressBook by remember { mutableStateOf<Book?>(null) }` —
   * 声明了但 HomeScreen.kt 里**没有任何一处**给它赋值（长按手势被拖拽宿主接管），
   * 因此 BookActionSheet 在 Kotlin 里其实是不可达 UI。这里逐字保留该语义。
   */
  const [longPressBook, setLongPressBook] = useState<HomeBook | null>(null);
  useEffect(() => platform.appLifecycle.subscribe((foreground) => {
    if (foreground) return;
    setCategorySheetFor(null); setCategoryToDelete(null); setBookToMove(null); setBookToDelete(null); setLongPressBook(null);
    setFavCategorySheetFor(null); setFavCategoryRenameFor(null); setFavCategoryDeleteFor(null); setShowMoreSheet(false);
    setSelection(createShelfSelection());
  }), [platform]);

  const aliveRef = useRef(true);
  const undoTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const pointerKeyRef = useRef<string | null>(null);
  const targetRectsRef = useRef(new Map<string, Rect>());
  const targetElsRef = useRef(new Map<string, HTMLElement>());
  const selectionRef = useRef(selection);
  const hoverRef = useRef<string | null>(null);
  /** Android 264 `var dragHintShown by remember { mutableIntStateOf(prefs.shelfDragHintShown) }` */
  const dragHintShownRef = useRef(0);

  /* Event handlers read the latest selection through a ref (never during render). */
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  /* ═══════════════ 209 selectedCategory = shelfCategory ═══════════════ */

  /**
   * 212–221 `LaunchedEffect(categories) { … onShelfCategoryChange(fallback) }`
   * 的**派生式**写法：Android 那边是因为 shelfCategory 由 MainActivity 持有才需要
   * 写回；本页自己持有，所以直接在渲染期解析（同一逻辑，见 `resolveShelfCategory`）。
   * 避免 setState-in-effect 级联渲染。
   */
  const selectedCategory = useMemo(() => {
    const names = categories.map((c) => c.name);
    return resolveShelfCategory(shelfCategory, names) ?? shelfCategory;
  }, [categories, shelfCategory]);

  /* ═══════════════ data loading (Room Flow → async getter + listener) ═══════════════ */

  /** MainViewModel.kt 474–483 — isCoverValid 的文件存在性探测 */
  const probeCovers = useCallback(
    async (rows: readonly BookRow[]): Promise<Map<number, boolean>> => {
      const map = new Map<number, boolean>();
      for (const row of rows) {
        const id = row.id ?? 0;
        if (row.coverUri === null || row.coverUri === '') {
          map.set(id, false);
          continue;
        }
        map.set(id, /^(https?:|data:|blob:|capacitor:)/i.test(row.coverUri) || await platform.fs.exists(coverFilePath(row.coverUri)));
      }
      return map;
    },
    [platform],
  );

  const reloadShelf = useCallback(async (): Promise<void> => {
    const repo = getBookRepository();
    if (repo === null) return;
    const rows = await repo.getBookshelf();
    const valid = await probeCovers(rows);
    const catRows = await repo.listCategories();
    if (!aliveRef.current) return;
    setBooks(rows.map((row) => homeBookFromRow(row, valid.get(row.id ?? 0) ?? false)));
    setCategories(catRows.map(homeCategoryFromRow));
    setStoreLoaded(true);
  }, [probeCovers]);

  const reloadFavorites = useCallback(async (): Promise<void> => {
    const favs = await favorites.favorites();
    const [keys, progressMap, cats] = await Promise.all([
      favorites.favoriteKeys(),
      favorites.progressByKey(),
      favorites.favoriteCategories(),
    ]);
    if (!aliveRef.current) return;
    setFavoriteItems(
      assembleFavoriteItems({ favorites: favs, progressByKey: progressMap, books }),
    );
    setFavoriteKeys(keys);
    setFavoriteCategories(cats.map((c) => c.name));
  }, [favorites, books]);

  const reloadStats = useCallback(async (): Promise<void> => {
    await flushReadingStatistics(getBookRepository());
    const [today, streak, privacy, favProt, hint] = await Promise.all([
      prefs.getDailyReadTime(dateStrOf(new Date())),
      prefs.calculateStreak(),
      getPrivacyService().ready().then((state) => state.enabled),
      prefs.favoritesProtected(),
      prefs.shelfDragHintShown(),
    ]);
    if (!aliveRef.current) return;
    setTodayReadSeconds(today);
    setStreakDays(streak);
    setPrivacyModeEnabled(privacy);
    setFavoritesProtected(favProt);
    dragHintShownRef.current = Math.min(hint, DRAG_HINT_MAX_SHOWS);
  }, [prefs]);

  /* ═══════════════ bootstrap ═══════════════ */
  useEffect(() => {
    aliveRef.current = true;
    void (async () => {
      await bootstrapLibrary();
      await reloadShelf();
      await reloadStats();
    })();
    return () => {
      aliveRef.current = false;
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    };
  }, [reloadShelf, reloadStats]);

  // Favorites depend on the current shelf snapshot. Updating them must not
  // trigger another shelf reload, which allocates a new books array each time.
  useEffect(() => { void reloadFavorites(); }, [reloadFavorites]);

  /* ═══════════════ store books listener (HomeScreen 119 `books`) ═══════════════ */
  useEffect(() => {
    if (!storeLoaded) return;
    void reloadShelf();
  }, [storeBooks, storeLoaded, reloadShelf]);

  /* ═══════════════ 201–205 search debounce 300 ms ═══════════════ */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  /* ═══════════════ 255–260 favorite update probe (1500 ms) ═══════════════ */
  const favoriteProbeDoneRef = useRef(false);
  useEffect(() => {
    if (favoriteProbeDoneRef.current) return;
    favoriteProbeDoneRef.current = true;
    let timer = 0;
    void (async () => {
      setFavoriteRefreshing(true);
      await favorites.checkUpdates(false).catch(() => 0);
      timer = window.setTimeout(() => setFavoriteRefreshing(false), 1500);
      await reloadFavorites();
    })();
    return () => window.clearTimeout(timer);
  }, [favorites, reloadFavorites]);

  /* ═══════════════ 265–271 drag hint, max 3 shows ═══════════════
     Kotlin 把计数写在一个 LaunchedEffect(shelfSelection.phase) 里；这里改成在
     长按进入多选的事件回调里自增（ref + 持久化），语义相同且不触发
     setState-in-effect 级联渲染。`showDragHint` 在 Kotlin 里同样从未被读取，
     故不渲染提示条（见 dragHintShownRef 注释）。 */
  const bumpDragHint = useCallback((): void => {
    if (dragHintShownRef.current >= DRAG_HINT_MAX_SHOWS) return;
    const next = nextDragHintShown(dragHintShownRef.current);
    dragHintShownRef.current = next;
    void settings.setInt('shelf_drag_hint_shown', next);
  }, [settings]);

  /* ═══════════════ 687–695 ShelfHeal: rescue orphan-category books ═══════════════ */
  const healDoneRef = useRef(new Set<string>());
  useEffect(() => {
    if (categories.length === 0) return;
    const orphans = orphanBooks(books, categories);
    if (orphans.length === 0) return;
    const signature = orphans
      .map((b) => String(b.id))
      .sort()
      .join(',');
    if (healDoneRef.current.has(signature)) return;
    healDoneRef.current.add(signature);
    console.warn(SHELF_HEAL_LOG_TAG, shelfHealLogMessage(orphans.length));
    void (async () => {
      const repo = getBookRepository();
      if (repo === null) return;
      for (const book of orphans) {
        const row = await repo.getBook(book.id);
        if (row === null) continue;
        await repo.updateBook({ ...row, category: DEFAULT_CATEGORY });
      }
      await reloadShelf();
    })();
  }, [books, categories, reloadShelf]);

  /* ═══════════════ 281–294 pending new-category move ═══════════════ */
  useEffect(() => {
    if (pendingNewCategoryKeys.length === 0) return;
    const target = categories[categories.length - 1]?.name;
    if (target === undefined) return;
    const keys = pendingNewCategoryKeys;
    const { bookKeys, favKeys } = splitShelfKeys(keys);
    const bookSet = new Set(bookKeys);
    void (async () => {
      const repo = getBookRepository();
      if (repo !== null) {
        for (const book of books) {
          if (!bookSet.has(String(book.id))) continue;
          const row = await repo.getBook(book.id);
          if (row === null) continue;
          await repo.updateBook({ ...row, category: target });
        }
      }
      if (favKeys.length > 0) await favorites.moveToCategory(favKeys, target);
      setPendingNewCategoryKeys([]);
      await reloadShelf();
      await reloadFavorites();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, pendingNewCategoryKeys]);

  /* ═══════════════ 1018–1023 adaptive column count ═══════════════ */
  useEffect(() => {
    const measure = () => setScreenWidthDp(Math.round(window.innerWidth));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /* ═══════════════ derived values (all useMemo) ═══════════════ */

  /** 299–305 */
  const protectedCategoryNames = useMemo(
    () => new Set(categories.filter((c) => c.isProtected).map((c) => c.name)),
    [categories],
  );
  const catLocked = useMemo(
    () =>
      selectedCategoryLocked({
        privacyModeEnabled,
        protectedCategoryNames,
        unlockedCategoryIds,
        categories,
        categoryName: selectedCategory,
      }),
    [
      privacyModeEnabled,
      protectedCategoryNames,
      unlockedCategoryIds,
      categories,
      selectedCategory,
    ],
  );

  /** 188–195 */
  const hero = useMemo(() => currentlyReading(books), [books]);

  /** 1027–1034 */
  const heroLocked = useMemo(
    () =>
      heroCategoryLocked({
        bookCategory: hero.category,
        privacyModeEnabled,
        protectedCategoryNames,
        unlockedCategoryIds,
        categories,
      }),
    [hero.category, privacyModeEnabled, protectedCategoryNames, unlockedCategoryIds, categories],
  );

  /** 314–322 + 327–333 */
  const sortedBooks = useMemo(
    () =>
      sortShelfBooks(
        filterShelfBooks({
          books,
          selectedCategory,
          selectedCategoryLocked: catLocked,
          debouncedQuery,
        }),
        sortBy,
      ),
    [books, selectedCategory, catLocked, debouncedQuery, sortBy],
  );

  /** 337–339 */
  const favCustom = useMemo(() => favCustomCategories(favoriteCategories), [favoriteCategories]);

  /** 340–357 */
  const favSorted = useMemo(
    () => sortFavoriteItems(filterFavoriteItems(favoriteItems, favoriteCategory), favoriteSort),
    [favoriteItems, favoriteCategory, favoriteSort],
  );

  /** 243 */
  const favsLocked = favoritesLocked(favoritesProtected, privacyModeEnabled, favoritesUnlocked);

  /** 705–710 aliveKeys → pruneSelection（书被移走 / 收藏被移除后不再留在名单里） */
  const liveSelection = useMemo(
    () => pruneSelection(selection, shelfAliveKeys(sortedBooks, favSorted)),
    [selection, sortedBooks, favSorted],
  );

  /** 974 */
  const pageEmpty = books.length === 0 && favoriteItems.length === 0;

  /** 895–905 */
  const scope = liveSelection.scope;
  const selKeys = useMemo(
    () => selectableKeys(scope, sortedBooks, favSorted),
    [scope, sortedBooks, favSorted],
  );
  const allSelected = isAllSelected(selKeys, liveSelection.selected);

  /** 1994–2089 */
  const actions = useMemo(
    () =>
      scope === 'FAV'
        ? favoriteActionsSpec(liveSelection.selected.length)
        : bookActionsSpec(liveSelection.selected.length),
    [scope, liveSelection.selected.length],
  );

  const selectedBooks = useMemo(
    () => sortedBooks.filter((b) => liveSelection.selected.includes(String(b.id))),
    [sortedBooks, liveSelection.selected],
  );
  const selectedFavs = useMemo(
    () => favSorted.filter((it) => liveSelection.selected.includes(shelfKeyOf(it))),
    [favSorted, liveSelection.selected],
  );

  /** 742–764 呼吸动画的冻结条件：有书 + 不在滚动 + 处于浏览态
   *  ⚠️ Kotlin 的 `snapshotFlow { homeGridState.isScrollInProgress || phase != BROWSE }`
   * 里「滚动中」这一项之前没被移植，导致滚动时卡片还在上下浮动 —— 正是那段
   * 注释里说的「手指在动时视野里不该有别的东西也在动」。 */
  const [gridScrolling, setGridScrolling] = useState(false);
  useEffect(() => {
    let timer = 0;
    const onScroll = (): void => {
      setGridScrolling(true);
      if (timer !== 0) window.clearTimeout(timer);
      timer = window.setTimeout(() => setGridScrolling(false), 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer !== 0) window.clearTimeout(timer);
    };
  }, []);
  const breathing = books.length > 0 && selection.phase === 'BROWSE' && !gridScrolling;

  const rootStyle = useMemo(() => {
    const primary = COLORS.primaryPalette[primaryIndex] ?? COLORS.primaryPalette[2] ?? '#059669';
    const secondary =
      COLORS.secondaryPalette[secondaryIndex] ?? COLORS.secondaryPalette[2] ?? '#10B981';
    return {
      '--home-primary': primary,
      '--home-secondary': secondary,
      '--hp-cols': String(gridColumns(screenWidthDp)),
    } as CSSProperties;
  }, [primaryIndex, secondaryIndex, screenWidthDp]);

  /* ═══════════════ helpers ═══════════════ */

  /** 541–554 MainActivity.showUndo — message + 撤销动作
   *  ⚠️ `duration = SnackbarDuration.Long` ⇒ Material3 的 10000ms。之前写的是
   *  6000ms，撤销窗口比 Android 短 4 秒。 */
  const UNDO_WINDOW_MS = 10000;

  const showUndo = useCallback((message: string, action?: (() => void) | undefined): void => {
    setUndo({ message, action: action ?? null });
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
  }, []);

  const openBookToReader = useCallback(
    (book: HomeBook): void => {
      if (book.id < 0) return;
      setCurrentBookId(book.id);
      void openBook(book.id).then(() => {
        setRoute(book.contentType === 'COMIC' ? 'comicReader' : 'reader');
      });
    },
    [openBook, setCurrentBookId, setRoute],
  );

  const openFavorite = useCallback((item: FavoriteItem): void => openOnlineBook(createSourceSearchBook({
    id: item.favorite.comicId, sourceId: item.favorite.sourceId, title: item.favorite.title,
    author: item.favorite.author, cover: item.favorite.coverUrl, format: 'comic',
  })), []);

  const handleImport = useCallback((): void => {
    void (async () => {
      const { getPlatform } = await import('@platform/index');
      const { getBookRepository } = await import('@ui/state/appStore');
      const { importLocalBook, LOCAL_BOOK_ACCEPT } = await import('@platform/localBookImport');
      const platform = getPlatform();
      const repo = getBookRepository();
      if (repo === null) throw new Error('书架尚未准备好，请重试');
      const files = await platform.documents.pickFile({ accept: LOCAL_BOOK_ACCEPT, multiple: true });
      for (const file of files) {
        const book = await importLocalBook(file, repo, platform.fs);
        showToast(`已导入《${book.title}》`);
      }
      await loadLibrary();
    })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '导入失败，请重试'));
  }, [loadLibrary]);

  const shareFavoriteWorks = useCallback((items: readonly FavoriteItem[]): void => {
    void import('@ui/lib/shareFavorites').then(({ shareFavorites }) => shareFavorites(items.map((item) => item.favorite)))
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : '分享失败，请重试'));
  }, []);

  const shareBooks = useCallback((books: readonly HomeBook[]): void => {
    const helper = getLibraryRuntime()?.shareHelper;
    if (!helper) { showToast('文件分享服务尚未准备好，请重试'); return; }
    void helper.shareBooks([...books]).then((error) => { if (error) showToast(error); });
  }, []);

  /** 1277–1297 */
  const cycleSort = useCallback((): void => setSortBy((prev) => (prev + 1) % 3), []);

  /** 1319–1353 */
  const onCategoryClick = useCallback(
    (cat: HomeCategory): void => {
      const locked =
        privacyModeEnabled &&
        protectedCategoryNames.has(cat.name) &&
        !unlockedCategoryIds.has(cat.id);
      if (locked) {
        setPinVerifyFor(cat);
        return;
      }
      setShelfCategory(cat.name);
    },
    [privacyModeEnabled, protectedCategoryNames, unlockedCategoryIds],
  );

  /** 857–884 onTapItem */
  const onTapItem = useCallback(
    (key: string): void => {
      if (isRecentAutoSelect(selection, Date.now()) && selection.autoSelectKey === key) {
        setSelection((prev) => ({ ...prev, autoSelectKey: null }));
        return;
      }
      if (selection.phase !== 'BROWSE') {
        setSelection((prev) => toggleKey(prev, key));
        return;
      }
      if (isFavShelfKey(key)) {
        const item = favSorted.find((it) => shelfKeyOf(it) === key);
        if (item !== undefined) openFavorite(item);
        return;
      }
      const tapped = sortedBooks.find((b) => String(b.id) === key);
      if (tapped !== undefined) openBookToReader(tapped);
    },
    [selection, favSorted, sortedBooks, openFavorite, openBookToReader],
  );

  /* ═══════════════ drop handlers (767–887) ═══════════════ */

  const dispatchDropToCategory = useCallback(
    (keys: readonly string[], targetName: string): void => {
      const plan = planDropToCategory({
        keys,
        books,
        favoriteItems,
        categories,
        targetName,
      });
      if (plan.blockedReason !== null) {
        showUndo(plan.blockedReason);
        return;
      }
      void (async () => {
        const repo = getBookRepository();
        if (repo !== null) {
          for (const book of plan.books) {
            const row = await repo.getBook(book.id);
            if (row === null) continue;
            await repo.updateBook({ ...row, category: targetName });
          }
        }
        if (plan.favKeys.length > 0) await favorites.moveToCategory(plan.favKeys, targetName);
        if (plan.message !== null) {
          showUndo(plan.message, () => {
            void (async () => {
              const r = getBookRepository();
              if (r !== null) {
                for (const book of plan.books) {
                  const row = await r.getBook(book.id);
                  if (row === null) continue;
                  await r.updateBook({ ...row, category: selectedCategory });
                }
              }
              for (const entry of plan.favUndo) {
                await favorites.moveToCategory([entry.key], entry.category);
              }
            })();
          });
        }
        await reloadShelf();
        await reloadFavorites();
      })();
    },
    [books, favoriteItems, categories, favorites, selectedCategory, showUndo, reloadShelf, reloadFavorites],
  );

  /* 812–817 onDropToFavorite
   * ⚠️ 之前只弹了文案、**没有真正加入收藏**（`onFavoriteSelectedBooks` 回调在
   * 本项目里恒返回 (0, 选中数)，被 `SKIPPED_HOME_PARAMS` 记为未接线）。
   * 现在直接落到 FavoriteRepository.add —— 与 Kotlin 的回调语义一致：
   * 返回 (成功本数, 因无来源被跳过本数)。 */
  const dispatchDropToFavorite = useCallback(
    (keys: readonly string[]): void => {
      const bookKeys = new Set(keys.filter((k) => !isFavShelfKey(k)));
      const list = books.filter((b) => bookKeys.has(String(b.id)));
      const plan = planDropToFavorite(list);
      showUndo(plan.message);
      void (async () => {
        for (const book of list) {
          const key = favKeyOfBook(book);
          if (key === null) continue;
          const [sourceId, comicId] = key.split('::');
          await favorites.add(
            createSearchBook({
              id: comicId ?? '',
              sourceId: sourceId ?? '',
              title: book.title,
              author: book.author,
              cover: book.coverUri,
            }),
          );
        }
        await reloadFavorites();
      })();
    },
    [books, favorites, showUndo, reloadFavorites],
  );

  /* 818–849 onDropToFavoriteCategory
   * ⚠️ 之前对「书架的书」执行的是 `updateBook({ category: name })` —— 把书搬到了
   * 一个**同名的书架分类**下。Android 的语义是 `onFavoriteSelectedBooksToCategory`
   * = **加入收藏并直接归入该收藏分类**，书本身留在原来的书架分类里不动。
   * 这是会真的把书弄丢/错位的行为，已改为走 FavoriteRepository.add。 */
  const dispatchDropToFavoriteCategory = useCallback(
    (keys: readonly string[], name: string): void => {
      const plan = planDropToFavoriteCategory({
        keys,
        books,
        favoriteItems,
        targetName: name,
      });
      showUndo(plan.message);
      void (async () => {
        for (const book of plan.books) {
          const key = favKeyOfBook(book);
          if (key === null) continue;
          const [sourceId, comicId] = key.split('::');
          await favorites.add(
            createSearchBook({
              id: comicId ?? '',
              sourceId: sourceId ?? '',
              title: book.title,
              author: book.author,
              cover: book.coverUri,
            }),
            name,
          );
        }
        /* 836：只有旧分类与目标不同时才真正改归属 */
        if (plan.favKeys.length > 0) {
          const moved = plan.favKeys.filter(
            (k) => plan.favUndo.find((u) => u.key === k)?.category !== name,
          );
          if (moved.length > 0) await favorites.moveToCategory(moved, name);
        }
        await reloadFavorites();
      })();
    },
    [books, favoriteItems, favorites, showUndo, reloadFavorites],
  );

  const dispatchCreateCategoryThenDrop = useCallback((keys: readonly string[]): void => {
    setPendingNewCategoryKeys(keys);
    setShowAddCategoryDialog(true);
  }, []);

  /* ═══════════════ pointer drag host (ShelfSelectionHost stand-in) ═══════════════ */

  const registerTarget = useCallback((id: string, el: HTMLElement | null): void => {
    if (el === null) {
      targetElsRef.current.delete(id);
      targetRectsRef.current.delete(id);
      return;
    }
    targetElsRef.current.set(id, el);
    const rect = el.getBoundingClientRect();
    targetRectsRef.current.set(id, {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
  }, []);

  /** 重新量取所有落点（Android onGloballyPositioned 的等价物）。 */
  const measureTargets = useCallback((): void => {
    for (const [id, el] of targetElsRef.current) {
      const rect = el.getBoundingClientRect();
      targetRectsRef.current.set(id, {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    }
  }, []);

  /* 530–669 shelfGestures 的事件侧移植
   * ⚠️ ShelfMultiSelect.kt L561–563：`withTimeout(if (phase == SELECTING) PICK_UP_MS
   * else LONG_PRESS_MS)` —— 浏览态 350ms 进入多选，多选态 250ms 才拿起。之前这里
   * 无论什么 phase 都用 350ms，并且浏览态长按直接 `enterSelection + beginDrag`
   * （把"进入多选"和"拿起"两步并成了一步）。 */
  const onPointerDown = useCallback(
    (key: string, x: number, y: number): void => {
      pointerKeyRef.current = key;
      const wasSelecting = selectionRef.current.phase === 'SELECTING';
      setSelection((prev) => ({ ...prev, pressedKey: key, pointer: { x, y } }));
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = window.setTimeout(
        () => {
          pointerKeyRef.current = null;
          measureTargets();
          bumpDragHint();
          setSelection((prev) => {
            const result = longPressAction(prev, key, Date.now());
            return result.state;
          });
        },
        wasSelecting ? PICK_UP_MS : LONG_PRESS_MS,
      );
    },
    [bumpDragHint, measureTargets],
  );

  const onPointerMove = useCallback(
    (x: number, y: number): void => {
      if (selectionRef.current.phase !== 'DRAGGING') return;
      measureTargets();
      const hit = pickDropTarget({
        x,
        y,
        targetRects: targetRectsRef.current,
        lastHoverId: hoverRef.current,
        /* ShelfMultiSelect.kt L150–155 `pickTarget`：落点胶囊必须**完整可见**
           （top 不低于宿主顶、bottom 不超出宿主底）。Kotlin 的宿主是
           `Box(Modifier.fillMaxSize())`，铺满整屏 —— 这里用视口高度作为等价物，
           避免"分类栏滚到一半、只从顶部露出半截时手指停在空白处也命中"。 */
        hostTop: 0,
        hostBottom: window.innerHeight,
      });
      if (hit !== hoverRef.current) setHoverTarget(hit);
      hoverRef.current = hit;
      setSelection((prev) =>
        prev.phase === 'DRAGGING'
          ? { ...prev, pointer: { x, y }, hoverTarget: hit, lastHoverId: hit }
          : prev,
      );
    },
    [measureTargets],
  );

  /* 760–822 ShelfSelectionHost 的 DropSink.onDrop 分派
   * ⚠️ 之前这一段有两处行为偏差：
   *   ① 落到 ♡ 时 Kotlin 是「飞回原位 + 心形迸发，**保持选中**」，这里却把
   *      phase 判成 BROWSE（等于退出了多选），并且没有把真实卡片藏进
   *      flyingHome（幽灵卡还在半空，卡片就先冒出来了）。
   *   ② 落到 ＋新建 / 分类 / 收藏分类时 Kotlin 的宿主分支**显式 exitSelection()**
   *      （"书已经不在当前分类里了"，见 L782–786 注释）。这里只翻了 phase，
   *      `selected` 里留着已经搬走的 key —— 正是那条注释点名要修的
   *      "打不开书籍了，而且选中不了"。
   */
  const onPointerUp = useCallback((): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerKeyRef.current = null;
    const cur = selectionRef.current;
    if (cur.phase !== 'DRAGGING') {
      setSelection((prev) => ({ ...prev, pressedKey: null }));
      return;
    }
    const target = hoverRef.current;
    const keys = cur.dragging;
    hoverRef.current = null;
    setHoverTarget(null);
    /* ② ♡ / 落在非放置区：Kotlin 的 endDrag() 无条件把 phase 收回 SELECTING，
     *    真实卡片在归位飞行期间必须继续藏着（beginReturnFlight）。
     *    （④ 里"name == currentCategory"那一支在本移植里同样不可达：当前分类的
     *      胶囊按 1327–1333 不注册落点，hoverTarget 永远拿不到它。） */
    const keepsSelection = target === null || target === DROP_TARGET_FAVORITE;
    setSelection(endDrag(cur, keepsSelection ? null : target));
    if (target === null) {
      if (keys.length > 0) {
        window.setTimeout(() => setSelection((s) => ({ ...s, flyingHome: [] })), 560);
      }
      return;
    }
    if (target === DROP_TARGET_FAVORITE) {
      /* ② beginReturnFlight + FAVORITE 飞行 → 归位期间也藏着，560ms 后交班 */
      dispatchDropToFavorite(keys);
      window.setTimeout(() => setSelection((s) => ({ ...s, flyingHome: [] })), 560);
      return;
    }
    /* ③④⑤ 三支 Kotlin 都 exitSelection() */
    setSelection(exitSelection());
    if (target === DROP_TARGET_NEW) {
      dispatchCreateCategoryThenDrop(keys);
    } else if (target.startsWith(DROP_PREFIX_FAV_CATEGORY)) {
      dispatchDropToFavoriteCategory(keys, target.substring(DROP_PREFIX_FAV_CATEGORY.length));
    } else if (target.startsWith(DROP_PREFIX_CATEGORY)) {
      dispatchDropToCategory(keys, target.substring(DROP_PREFIX_CATEGORY.length));
    }
  }, [
    dispatchCreateCategoryThenDrop,
    dispatchDropToCategory,
    dispatchDropToFavorite,
    dispatchDropToFavoriteCategory,
  ]);

  const pointerHandlers = useMemo<CardPointerHandlers>(
    () => ({ onPointerDown, onPointerMove, onPointerUp }),
    [onPointerDown, onPointerMove, onPointerUp],
  );

  /* ═══════════════ 402–445 bulk move ═══════════════ */
  const onBulkPick = useCallback(
    (name: string): void => {
      const picked = selection.selected;
      const forFavorites = bulkCategoryTarget === 1;
      if (forFavorites) {
        const { favKeys } = splitShelfKeys(picked);
        const old = favKeys
          .map((k) => {
            const found = favSorted.find(
              (it) => `${it.favorite.sourceId}::${it.favorite.comicId}` === k,
            );
            return found === undefined ? null : { key: k, category: found.favorite.categoryName };
          })
          .filter((v): v is { key: string; category: string } => v !== null);
        void favorites.moveToCategory(favKeys, name).then(() => reloadFavorites());
        showUndo(`已移动 ${String(favKeys.length)} 本到『${name}』`, () => {
          void Promise.all(old.map((o) => favorites.moveToCategory([o.key], o.category)));
        });
      } else {
        const { bookKeys, favKeys } = splitShelfKeys(picked);
        const bookSet = new Set(bookKeys);
        const list = books.filter((b) => bookSet.has(String(b.id)));
        void (async () => {
          const repo = getBookRepository();
          if (repo !== null) {
            for (const book of list) {
              const row = await repo.getBook(book.id);
              if (row === null) continue;
              await repo.updateBook({ ...row, category: name });
            }
          }
          if (favKeys.length > 0) await favorites.moveToCategory(favKeys, name);
          showUndo(`已移动 ${String(list.length + favKeys.length)} 本到『${name}』`, () => {
            void (async () => {
              const r = getBookRepository();
              if (r !== null) {
                for (const book of list) {
                  const row = await r.getBook(book.id);
                  if (row === null) continue;
                  await r.updateBook({ ...row, category: selectedCategory });
                }
              }
            })();
          });
          await reloadShelf();
          await reloadFavorites();
        })();
      }
      setSelection(exitSelection());
      setBulkCategoryTarget(-1);
    },
    [
      selection.selected,
      bulkCategoryTarget,
      favSorted,
      favorites,
      books,
      selectedCategory,
      showUndo,
      reloadShelf,
      reloadFavorites,
    ],
  );

  /* ═══════════════ 2130–2136 onToggleAll ═══════════════ */
  const onToggleAll = useCallback((): void => {
    if (allSelected) {
      setSelection(exitSelection());
      return;
    }
    setSelection((prev) => selectAllKeys(prev, selKeys));
  }, [allSelected, selKeys]);

  /* ═══════════════ 452–462 MoreActionSheet ═══════════════ */
  /* ⚠️ BUG FIXED：Kotlin 写的是
   *   `onMarkFinished = { book -> viewModel.updateProgress(book.id, book.totalChapters, 0, true) }`
   *   （MainActivity.kt L811–813），即 **currentChapterIndex 置为 totalChapters、
   *    scrollOffset 归零**，再打 isFinished。
   *   之前这里只写 `isFinished: 1`，currentChapterIndex 原封不动 ⇒
   *   「正在阅读」大卡的进度条与「已读 N%」停在原来的百分比（例如 30%），
   *   而安卓会跳到 100%。 */
  const onMorePick = useCallback(
    (label: string): void => {
      if (label === '标记为已读完') {
        void (async () => {
          const repo = getBookRepository();
          if (repo !== null) {
            for (const book of markedFinishedBooks(sortedBooks, selection.selected)) {
              const row = await repo.getBook(book.id);
              if (row === null) continue;
              await repo.updateBook({
                ...row,
                currentChapterIndex: row.totalChapters,
                scrollOffset: 0,
                isFinished: 1,
              });
            }
          }
          await reloadShelf();
        })();
        setSelection(exitSelection());
      }
      if (label === '取消全选') setSelection(exitSelection());
      setShowMoreSheet(false);
    },
    [sortedBooks, selection.selected, reloadShelf],
  );

  /* ═══════════════ 504–530 delete book confirm ═══════════════ */
  const onConfirmDeleteBook = useCallback((): void => {
    if (bookToDelete === null) return;
    const target = bookToDelete;
    setBookToDelete(null);
    void (async () => {
      const repo = getBookRepository();
      if (repo === null) return;
      const row = await repo.getBook(target.id);
      if (row === null) return;
      await repo.deleteBookDb(row);
      await reloadShelf();
    })();
  }, [bookToDelete, reloadShelf]);

  /* ═══════════════ 2197–2200 unlock category ═══════════════ */
  const onVerifyCategoryPin = useCallback(async (cat: HomeCategory, pin: string): Promise<boolean> => {
    const ok = await getPrivacyService().unlockCategory(cat.id, pin);
    if (ok) {
      setUnlockedCategoryIds((prev) => new Set([...prev, cat.id]));
      setShelfCategory(cat.name);
    }
    return ok;
  }, []);

  /* ═══════════════ 665–672 favorites PIN ═══════════════ */
  const onVerifyFavoritesPin = useCallback(async (pin: string): Promise<boolean> => {
    const ok = await getPrivacyService().unlockFavorites(pin);
    if (ok) {
      setFavoritesUnlocked(true);
      setFavoritesPinFor(false);
    }
    return ok;
  }, []);

  /* ═══════════════ 360–398 category delete ═══════════════ */
  const onConfirmCategoryDelete = useCallback((): void => {
    if (categoryToDelete === null) return;
    const target = categoryToDelete;
    setCategoryToDelete(null);
    void (async () => {
      const repo = getBookRepository();
      if (repo === null) return;
      const stored = await repo.getCategoryByName(target.name);
      if (!getPrivacyService().canAccessCategory({ id: target.id, isProtected: stored?.isProtected === 1 })) { setPinVerifyFor(target); return; }
      const deleted = await repo.deleteCategory({
        id: target.id,
        name: target.name,
        isProtected: target.isProtected ? 1 : 0,
      });
      if (!deleted) showToast(DEFAULT_CATEGORY_DELETE_TOAST);
      if (selectedCategory === target.name) setShelfCategory(DEFAULT_CATEGORY);
      await reloadShelf();
    })();
  }, [categoryToDelete, selectedCategory, reloadShelf]);

  /* ═══════════════ 2178–2180 toggle category protected ═══════════════ */
  const onToggleCategoryProtected = useCallback(
    (next: boolean): void => {
      const cat = categorySheetFor;
      if (cat === null) return;
      void (async () => {
        const repo = getBookRepository();
        if (repo === null) return;
        const stored = await repo.getCategoryByName(cat.name);
        if (!getPrivacyService().canAccessCategory({ id: cat.id, isProtected: stored?.isProtected === 1 })) { setCategorySheetFor(null); setPinVerifyFor(cat); return; }
        await repo.setCategoryProtectedFlag(cat.id, next);
        await reloadShelf();
      })();
    },
    [categorySheetFor, reloadShelf],
  );

  /** 第九轮修复②：面板取实时分类（Room Flow 驱动），不用长按瞬间的快照 */
  const latestSheetCat =
    categorySheetFor === null
      ? null
      : (categories.find((c) => c.id === categorySheetFor.id) ?? categorySheetFor);

  /* ═══════════════ 906–2145 markup ═══════════════ */
  return (
    <div className="home-page" style={rootStyle}>
      {/* 921–967 TabScreenHeader */}
      <TabScreenHeader
        title="我的书架"
        subtitle="BOOKSHELF & READING"
        collapsed={false}
        titleVisible={!isSearchExpanded}
        trailing={
          isSearchExpanded ? (
            <div className="hp-search">
              <input
                className="hp-search__input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入书名或作者"
                autoFocus
              />
              <button
                type="button"
                className="hp-search__close"
                aria-label="Clear"
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchExpanded(false);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="hp-search__expand"
              aria-label="搜索"
              onClick={() => setIsSearchExpanded(true)}
            >
              <SearchIcon />
            </button>
          )
        }
      />

      <div className="home-page__gap-12" />

      {pageEmpty ? (
        <EmptyShelf onImport={handleImport} onGoLibrary={() => setTab('library')} />
      ) : (
        <>
          {/* 1068 hero_section */}
          {!heroLocked && books.length > 0 ? (
            <HeroSection book={hero} onOpen={openBookToReader} />
          ) : null}

          {/* 1258 bookshelf_header + 1307 category pills */}
          <section className="home-shelf">
            <div className="home-shelf-header">
              <h2 className="home-section-title">我的书架</h2>
              <div className="home-shelf-header__actions">
                <ActionChip
                  icon={<SortIcon />}
                  label={SORT_LABELS[sortBy] ?? '默认'}
                  emphasized={sortBy > 0}
                  onClick={cycleSort}
                />
                <ActionChip
                  icon={<AddIcon />}
                  label="导入新书"
                  emphasized
                  onClick={handleImport}
                />
                <ActionChip
                  icon={<CategoryIcon />}
                  label="新建分类"
                  emphasized={false}
                  onClick={() => setShowAddCategoryDialog(true)}
                />
              </div>
            </div>
            {/* 1307–1315 Row(horizontalScroll(rememberScrollState(),
                enabled = phase != DRAGGING)) —— 拖拽期间手指在胶囊上左右挪动
                会把这排胶囊滑走、落点矩形跟着漂（"手指没对准分类却触发了放进分类"）。 */}
            <div
              className="hp-cat-row"
              style={selection.phase === 'DRAGGING' ? { overflowX: 'hidden' } : undefined}
            >
              {categories.map((cat) => {
                /* 1327–1333 当前所处的分类**不注册**为落点 */
                const isCurrent = cat.name === selectedCategory;
                const dropId = isCurrent ? null : dropTargetOfCategory(cat.name);
                return (
                  <CategoryDropPill
                    key={cat.id}
                    cat={cat}
                    count={books.filter((b) => b.category === cat.name).length}
                    selected={selectedCategory === cat.name}
                    locked={
                      privacyModeEnabled &&
                      protectedCategoryNames.has(cat.name) &&
                      !unlockedCategoryIds.has(cat.id)
                    }
                    dropId={dropId}
                    dropHighlight={dropId !== null && hoverTarget === dropId}
                    registerTarget={registerTarget}
                    onClick={() => onCategoryClick(cat)}
                    onLongClick={() => { if (getPrivacyService().canAccessCategory(cat)) setCategorySheetFor(cat); else setPinVerifyFor(cat); }}
                  />
                );
              })}
            </div>
          </section>

          {/* 1360–1752 grid / empty */}
          {sortedBooks.length === 0 ? (
            <ShelfEmptyState
              categoryLocked={catLocked}
              categoryName={selectedCategory}
              onImport={handleImport}
              onVerify={() => {
                const cat = categories.find((c) => c.name === selectedCategory);
                if (cat !== undefined) setPinVerifyFor(cat);
              }}
            />
          ) : (
            <div
              className={
                /* 1055–1056 拖拽中关掉网格自身的滚动 */
                selection.phase === 'DRAGGING' ? 'hp-grid hp-grid--drag-locked' : 'hp-grid'
              }
            >
              {sortedBooks.map((book) => {
                const key = String(book.id);
                const visual = bookCardVisual({
                  key,
                  phase: selection.phase,
                  selected: new Set(selection.selected),
                  dragging: selection.dragging,
                  flyingHome: new Set(selection.flyingHome),
                  pressed: selection.pressedKey === key,
                });
                return (
                  <ShelfBookCard
                    key={key}
                    book={book}
                    selected={selection.selected.includes(key)}
                    hidden={visual.hidden}
                    alpha={visual.alpha}
                    scale={visual.scale}
                    /* 1680–1688 勾选框按**板块**判定 */
                    showSelectBadge={selection.scope === 'BOOK'}
                    favKeyed={favKeyedOf(book, favoriteKeys)}
                    breathing={breathing}
                    breathDelayMs={breathDelayMsOf(book.id)}
                    onOpen={openBookToReader}
                    onTapItem={(b) => onTapItem(String(b.id))}
                    handlers={pointerHandlers}
                  />
                );
              })}
            </div>
          )}

          {/* 1759 fav_section_header */}
          <div className="hp-fav-header">
            <h2 className="hp-fav-title">我喜欢的</h2>
            <div className="hp-fav-actions">
              {favsLocked ? (
                <ActionChip
                  icon={<LockIcon size={13} />}
                  label="已锁定"
                  emphasized
                  onClick={() => setFavoritesPinFor(true)}
                />
              ) : (
                <>
                  <ActionChip
                    icon={<RefreshIcon />}
                    label={favoriteRefreshing ? '检查中…' : '检查更新'}
                    emphasized={favoriteRefreshing}
                    onClick={() => {
                      if (favoriteRefreshing) return;
                      setFavoriteRefreshing(true);
                      void (async () => {
                        await favorites.checkUpdates(false).catch(() => 0);
                        window.setTimeout(() => setFavoriteRefreshing(false), 1500);
                        await reloadFavorites();
                      })();
                    }}
                  />
                  <ActionChip
                    icon={<CategoryIcon />}
                    label="新建分类"
                    emphasized={false}
                    onClick={() => setShowAddFavoriteCategoryDialog(true)}
                  />
                </>
              )}
            </div>
          </div>

          {/* 1808–1842 fav category row (只有自建分类时才出现)
              1821–1826「全部」是伪分类、不注册落点；1827–1840 只有自建分类注册。 */}
          {!favsLocked && favCustom.length > 0 ? (
            <div
              className="hp-cat-row"
              /* 1812–1816 同一套 horizontalScroll(enabled = phase != DRAGGING) */
              style={selection.phase === 'DRAGGING' ? { overflowX: 'hidden' } : undefined}
            >
              <span className="hp-cat-pill-wrap">
                <ShelfCategoryPill
                  name={ALL_FAV_CATEGORY}
                  selected={favoriteCategory === ALL_FAV_CATEGORY}
                  count={favoriteItems.length}
                  onClick={() => setFavoriteCategory(ALL_FAV_CATEGORY)}
                />
              </span>
              {favCustom.map((name) => {
                const favDropId = dropTargetOfFavoriteCategory(name);
                return (
                  <CategoryDropPill
                    key={name}
                    cat={{ id: -1, name, isProtected: false }}
                    count={favoriteItems.filter((it) => it.favorite.categoryName === name).length}
                    selected={favoriteCategory === name}
                    locked={false}
                    dropId={favDropId}
                    dropHighlight={hoverTarget === favDropId}
                    registerTarget={registerTarget}
                    onClick={() => setFavoriteCategory(name)}
                    onLongClick={() => setFavCategorySheetFor(name)}
                  />
                );
              })}
            </div>
          ) : null}

          {/* 1846–1926 fav body */}
          {favsLocked ? (
            <FavoritesLockedRow onVerify={() => setFavoritesPinFor(true)} />
          ) : favSorted.length === 0 ? (
            <FavEmptyState onGoLibrary={() => setTab('library')} />
          ) : (
            <div className="hp-grid">
              {favSorted.map((item) => {
                const key = shelfKeyOf(item);
                const selected = selection.selected.includes(key);
                return (
                  <FavoriteGridCard
                    key={key}
                    item={item}
                    shelfKey={key}
                    selected={selected}
                    hidden={selection.dragging.includes(key) || selection.flyingHome.includes(key)}
                    dimmed={selection.scope === 'FAV' && !selected}
                    multiSelecting={selection.scope === 'FAV'}
                    onOpen={openFavorite}
                    onTapItem={onTapItem}
                    handlers={pointerHandlers}
                  />
                );
              })}
            </div>
          )}

          {/* 1928 bottom_stats */}
          <ReadingStatsCard
            todayReadSeconds={todayReadSeconds}
            streakDays={streakDays}
            onOpenStats={() => setTab('stats')}
          />

          {/* 1994–2089 MultiSelectActionBar
              ⚠️ BUG FIXED：Kotlin 的外层是 `if (phase != BROWSE)`，但内层
              `MultiSelectActionBar(visible = phase == SELECTING)` ——
              AnimatedVisibility 在 **DRAGGING 时也是 false**，操作栏会滑出隐藏
              （拖拽期间由底部放置坞接手）。之前这里只看外层条件，于是拖起来时
              底部还挂着「移动/分享/删除下载/更多」，与安卓不同。 */}
          {selection.phase === 'SELECTING' ? (
            <MultiSelectActionBar
              actions={actions}
              onPick={(label) => {
                if (label === '打开') {
                  const item = selectedFavs[0];
                  if (item) openFavorite(item);
                  setSelection(exitSelection());
                  return;
                }
                if (label === '移动') {
                  setBulkCategoryTarget(scope === 'FAV' ? 1 : 0);
                  return;
                }
                if (label === '分享') {
                  if (scope === 'FAV') shareFavoriteWorks(selectedFavs);
                  else shareBooks(selectedBooks);
                  return;
                }
                if (label === '取消喜欢') {
                  const keys = selectedFavs.map(
                    (it) => `${it.favorite.sourceId}::${it.favorite.comicId}`,
                  );
                  void favorites.removeByKeys(keys).then(() => reloadFavorites());
                  showUndo(`已取消喜欢 ${String(keys.length)} 部`);
                  setSelection(exitSelection());
                  return;
                }
                if (label === '删除下载') {
                  void (async () => {
                    const repo = getBookRepository();
                    if (repo === null) return;
                    for (const book of selectedBooks) {
                      const row = await repo.getBook(book.id);
                      if (row === null) continue;
                      await repo.deleteBookDb(row);
                    }
                    await reloadShelf();
                  })();
                  setSelection(exitSelection());
                  return;
                }
                if (label === '更多') setShowMoreSheet(true);
              }}
            />
          ) : null}

          {/* 2094–2096 浏览态才有的 24.dp 收尾呼吸位 */}
          {selection.phase === 'BROWSE' ? <div className="home-tail-spacer" /> : null}
        </>
      )}

      {/* 2100–2144 MultiSelectTopBar 浮层 */}
      {selection.phase !== 'BROWSE' ? (
        <MultiSelectTopBar
          count={selection.selected.length}
          allSelected={allSelected}
          onClose={() => {
            setHoverTarget(null);
            setSelection(exitSelection());
          }}
          onToggleAll={onToggleAll}
        />
      ) : null}

      {/* ⚠️ EXTRA vs HomeScreen.kt —— 已登记（docs/PARITY_EXCEPTIONS.md）。
          ShelfSelectionHost.kt L931–934 的注释写明「放置目标不再用底部悬浮 Dock
          （已整块移除）。用户明确要求：分类就是页面里那一排分类胶囊，不要另起一栏」，
          所以 Android 侧 `DROP_TARGET_FAVORITE` / `DROP_TARGET_NEW` 至今**没有注册
          任何矩形**（`aliveTargets` 里还留着 id，但没有任何 `dropTargetModifier`），
          `onDropToFavorite` / `onCreateCategoryThenDrop` 因此不可达。
          这两个落点 id 是 E 条目里唯一能让 `planDropToFavorite` /
          `planDropToFavoriteCategory` / 「已取消喜欢 N 部」之外的两条计划真正跑起来
          的入口，所以这里保留了最小放置坞：只放 ♡ 与 ＋新建分类两颗芯片，
          **分类落点一律走页面里那一排分类胶囊**（HomeScreen.kt L1335–1353）。 */}
      {selection.phase === 'DRAGGING' ? (
        <div className="hp-drag-dock">
          <span
            className={
              hoverTarget === DROP_TARGET_FAVORITE ? 'hp-drag-dock__chip hp-drag-dock__chip--on' : 'hp-drag-dock__chip'
            }
            ref={(el) => registerTarget(DROP_TARGET_FAVORITE, el)}
          >
            <FavoriteIcon size={16} />
            我喜欢的
          </span>
          <span
            className={
              hoverTarget === DROP_TARGET_NEW ? 'hp-drag-dock__chip hp-drag-dock__chip--on' : 'hp-drag-dock__chip'
            }
            ref={(el) => registerTarget(DROP_TARGET_NEW, el)}
          >
            <AddIcon />
            新建分类
          </span>
        </div>
      ) : null}

      {/* 2207–2277 ShelfDragCover */}
      {selection.phase === 'DRAGGING' && selection.pointer !== null ? (
        <div
          className="hp-drag-ghost"
          style={{ left: selection.pointer.x, top: selection.pointer.y }}
        >
          <ShelfDragCover itemKey={selection.dragging[0] ?? ''} books={books} favSorted={favSorted} />
        </div>
      ) : null}

      {/* 661–675 favorites PIN */}
      {favoritesPinFor ? (
        <PrivacyPinOverlay
          onPinVerified={onVerifyFavoritesPin}
          onDismiss={() => setFavoritesPinFor(false)}
        />
      ) : null}

      {/* 2190–2204 protected-category PIN */}
      {pinVerifyFor !== null ? (
        <PrivacyPinOverlay
          onPinVerified={(pin) => onVerifyCategoryPin(pinVerifyFor, pin)}
          onDismiss={() => setPinVerifyFor(null)}
        />
      ) : null}

      {/* 533–547 NewCategoryDialog (shelf) */}
      {showAddCategoryDialog ? (
        <NewCategoryDialog
          title={SHELF_CATEGORY_DIALOG_TITLE}
          description={SHELF_CATEGORY_DIALOG_DESCRIPTION}
          onCreate={(name) => {
            void (async () => {
              await addCategory(name);
              showToast(categoryCreatedToast(name));
              await reloadShelf();
            })();
            setShowAddCategoryDialog(false);
          }}
          onDismiss={() => setShowAddCategoryDialog(false)}
        />
      ) : null}

      {/* 551–564 NewCategoryDialog (favorite) */}
      {showAddFavoriteCategoryDialog ? (
        <NewCategoryDialog
          title={FAV_CATEGORY_DIALOG_TITLE}
          description={FAV_CATEGORY_DIALOG_DESCRIPTION}
          onCreate={(name) => {
            void (async () => {
              await favorites.addFavoriteCategory(name);
              await reloadFavorites();
            })();
            setShowAddFavoriteCategoryDialog(false);
          }}
          onDismiss={() => setShowAddFavoriteCategoryDialog(false)}
        />
      ) : null}

      {/* 567–582 fav category sheet */}
      {favCategorySheetFor !== null ? (
        <MoreActionSheet
          titles={['重命名分类', '删除分类']}
          onPick={(pick) => {
            const name = favCategorySheetFor;
            setFavCategorySheetFor(null);
            if (pick === '重命名分类') setFavCategoryRenameFor(name);
            if (pick === '删除分类') setFavCategoryDeleteFor(name);
          }}
          onDismiss={() => setFavCategorySheetFor(null)}
        />
      ) : null}

      {/* 584–627 rename favorite category */}
      {favCategoryRenameFor !== null ? (
        <RenameCategoryDialog
          initial={favCategoryRenameFor}
          onSave={(next) => {
            const old = favCategoryRenameFor;
            if (next !== '') {
              void (async () => {
                await favorites.renameFavoriteCategory(old, next);
                if (favoriteCategory === old) setFavoriteCategory(next);
                await reloadFavorites();
              })();
            }
            setFavCategoryRenameFor(null);
          }}
          onDismiss={() => setFavCategoryRenameFor(null)}
        />
      ) : null}

      {/* 629–658 delete favorite category */}
      {favCategoryDeleteFor !== null ? (
        <DeleteFavCategoryDialog
          onConfirm={() => {
            const name = favCategoryDeleteFor;
            void (async () => {
              await favorites.deleteFavoriteCategory(name);
              if (favoriteCategory === name) setFavoriteCategory(ALL_FAV_CATEGORY);
              await reloadFavorites();
            })();
            setFavCategoryDeleteFor(null);
          }}
          onDismiss={() => setFavCategoryDeleteFor(null)}
        />
      ) : null}

      {/* 402–445 bulk CategoryPickerSheet */}
      {bulkCategoryTarget >= 0 ? (
        <CategoryPickerSheet
          categories={bulkCategoryTarget === 1 ? favCustom : categories.map((c) => c.name)}
          title="移动到分类"
          onPick={onBulkPick}
          onCreate={(name) => {
            if (bulkCategoryTarget === 1) void favorites.addFavoriteCategory(name);
            else void addCategory(name);
            setPendingNewCategoryKeys(selection.selected);
            setBulkCategoryTarget(-1);
            void reloadShelf();
          }}
          onDismiss={() => setBulkCategoryTarget(-1)}
        />
      ) : null}

      {/* 448–464 MoreActionSheet */}
      {showMoreSheet ? (
        <MoreActionSheet
          titles={MORE_ACTION_TITLES}
          onPick={onMorePick}
          onDismiss={() => setShowMoreSheet(false)}
        />
      ) : null}

      {/* 360–398 category delete confirm */}
      {categoryToDelete !== null ? (
        <CategoryDeleteDialog
          categoryName={categoryToDelete.name}
          onConfirm={onConfirmCategoryDelete}
          onDismiss={() => setCategoryToDelete(null)}
        />
      ) : null}

      {/* 467–501 move book dialog */}
      {bookToMove !== null ? (
        <MoveBookDialog
          book={bookToMove}
          categories={categories}
          onPick={(name) => {
            const target = bookToMove;
            setBookToMove(null);
            void (async () => {
              const repo = getBookRepository();
              if (repo === null) return;
              const row = await repo.getBook(target.id);
              if (row === null) return;
              await repo.updateBook({ ...row, category: name });
              await reloadShelf();
            })();
          }}
          onDismiss={() => setBookToMove(null)}
        />
      ) : null}

      {/* 504–530 delete book dialog */}
      {bookToDelete !== null ? (
        <DeleteBookDialog
          title={bookToDelete.title}
          onConfirm={onConfirmDeleteBook}
          onDismiss={() => setBookToDelete(null)}
        />
      ) : null}

      {/* 2168–2188 CategoryActionSheet */}
      {latestSheetCat !== null ? (
        <CategoryActionSheet
          category={latestSheetCat}
          privacyModeEnabled={privacyModeEnabled}
          onToggleProtected={onToggleCategoryProtected}
          onDeleteRequest={() => {
            setCategorySheetFor(null);
            setCategoryToDelete(latestSheetCat);
          }}
          onGoToSettings={() => setTab('settings')}
          onDismiss={() => setCategorySheetFor(null)}
        />
      ) : null}

      {/* 541–554 MainActivity.showUndo → Web undo banner */}
      {undo !== null ? (
        <div className="hp-undo" role="status">
          <span className="hp-undo__message">{undo.message}</span>
          {undo.action !== null ? (
            <button
              type="button"
              className="hp-undo__action"
              onClick={() => {
                undo.action?.();
                setUndo(null);
              }}
            >
              撤销
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 2149–2166 BookActionSheet（Kotlin 里 longPressBook 从未被赋值 → 不可达 UI，
          逐字保留以便将来接线） */}
      {longPressBook !== null ? (
        <BookActionSheet
          book={longPressBook}
          onOpenDetail={() => {
            const target = longPressBook;
            setLongPressBook(null);
            openBookToReader(target);
          }}
          onMove={() => {
            setBookToMove(longPressBook);
            setLongPressBook(null);
          }}
          onShare={() => {
            shareBooks([longPressBook]);
            setLongPressBook(null);
          }}
          onDelete={() => {
            setBookToDelete(longPressBook);
            setLongPressBook(null);
          }}
          onDismiss={() => setLongPressBook(null)}
        />
      ) : null}

      {/* ⚠️ 705–710 shelfAliveKeys 已通过 pruneSelection 应用到 liveSelection：
          书被移走 / 收藏被移除后，名单里不再留幽灵热区。 */}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   small pure helpers
   ═══════════════════════════════════════════════════════════════════ */

/** HomeScreen.kt 1902 — favShelfKey(item.key) */
function shelfKeyOf(item: FavoriteItem): string {
  return `${SHELF_KEY_FAV_PREFIX}${item.favorite.sourceId}::${item.favorite.comicId}`;
}

/** HomeScreen.kt 1513 + 742–764 — 呼吸相位换算成负的 animation-delay */
function breathDelayMsOf(bookId: number): number {
  return -Math.round((bookBreathPhase(bookId) / (2 * Math.PI)) * 4000);
}

/** HomeScreen.kt 1640–1644 — 书架卡右下角小心形判定 */
function favKeyedOf(book: HomeBook, favoriteKeys: ReadonlySet<string>): boolean {
  const sourceId = book.sourceId ?? '';
  const comicId = book.comicId ?? '';
  if (sourceId.trim() === '' || comicId.trim() === '') return false;
  return favoriteKeys.has(`${sourceId}::${comicId}`);
}

const MORE_ACTION_TITLES = ['标记为已读完', '取消全选'] as const;

/**
 * 书架搜索的纯逻辑 —— `ui/shelf/ShelfSearch.kt` L77-204 / L218-294 的可测部分。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L77-101 `@Stable class ShelfSearchState(expansion, text, searchField, motion)`
 *            字段：`expanded` / `query` / `field` / `requestKeyboard` / `mounted` / `covered`
 *            方法：`open()`（requestKeyboard = true, expanded = true）/ `close()`（两者 false）
 *            → `ShelfSearchSnapshot` + `openShelfSearch` / `closeShelfSearch`（纯函数，React 侧持状态）
 *   L89/L90 `mounted = expanded || motion.value > 0f`、`covered = expanded && motion.value >= 1f`
 *            → `shelfSearchMounted` / `shelfSearchCovered`
 *   L194-202 `enum class ShelfSearchField(rawTitle) { Any("全部"), Title("书名"), Author("作者") }`
 *            + `matches(query, title, author)`：`Any` 两项都查，`Title` 只查书名，`Author` 只查作者，
 *            一律 `contains(ignoreCase = true)`
 *            → `ShelfSearchField` / `SHELF_SEARCH_FIELD_TITLES` / `shelfSearchMatches`
 *   L219-223 `LaunchedEffect(query) { if (query.isNotBlank()) delay(250); searchTerm = query.trim() }`
 *            → `SHELF_SEARCH_DEBOUNCE_MS`
 *   L224-226 `books.filter { it.category !in inaccessibleCategories && field.matches(…) }`
 *            → `filterShelfBooks`
 *   L227-230 `if (favoritesLocked) emptyList() else favorites.filter { … }`
 *            → `filterShelfFavorites`
 *   L255-263 空态文案：`searchTerm.isEmpty()` → `"暂无可搜索的书籍"`，否则 `tr("没有找到匹配的书籍")`
 *   L265 / L274 分组标题 `"我的书架"` / `"我喜欢的"`，计数 `"${count} 项"`
 *   L238 / L250 testTag：`shelf_search_plane` / `shelf_search_results`
 *
 * 为什么放在 `src/core/**`：`core` 被 ESLint 禁止 import React / DOM / Capacitor，
 * 这样这段过滤与文案表能在 Node 侧单测里逐条对拍 Kotlin 原文，不需要 jsdom。
 */
import type { FavoriteItem } from '../library/favoriteTypes';

/** L194-202 的枚举序数（`enum class` 声明顺序）。 */
export const ShelfSearchField = ['Any', 'Title', 'Author'] as const;

export type ShelfSearchField = (typeof ShelfSearchField)[number];

/** L195 `Any("全部"), Title("书名"), Author("作者")` —— 未经 `tr()` 的原始表。 */
export const SHELF_SEARCH_FIELD_TITLES: Record<ShelfSearchField, string> = {
  Any: '全部',
  Title: '书名',
  Author: '作者',
};

/** L199-201 `matches(query, title, author)`。 */
export function shelfSearchMatches(
  field: ShelfSearchField,
  query: string,
  title: string,
  author: string,
): boolean {
  const needle = query.toLowerCase();
  const titleHit = field !== 'Author' && title.toLowerCase().includes(needle);
  const authorHit = field !== 'Title' && author.toLowerCase().includes(needle);
  return titleHit || authorHit;
}

/** L221 `if (query.isNotBlank()) delay(250)`。 */
export const SHELF_SEARCH_DEBOUNCE_MS = 250;

/** L234 `resultKey = "${field.ordinal}:${searchTerm}"`（列表回顶的判据）。 */
export function shelfSearchResultKey(field: ShelfSearchField, searchTerm: string): string {
  return `${String(ShelfSearchField.indexOf(field))}:${searchTerm}`;
}

/** 书架里参与搜索的最小字段集（`Book` 的结构子集）。 */
export interface ShelfSearchBook {
  readonly id: number;
  readonly title: string;
  readonly author?: string | null;
  readonly coverUri?: string | null;
  readonly category?: string | null;
  readonly isComic?: boolean;
}

/** L224-226。 */
export function filterShelfBooks(
  books: readonly ShelfSearchBook[],
  inaccessibleCategories: ReadonlySet<string>,
  field: ShelfSearchField,
  searchTerm: string,
): readonly ShelfSearchBook[] {
  return books.filter((book) => {
    const category = book.category ?? '';
    if (inaccessibleCategories.has(category)) return false;
    return shelfSearchMatches(field, searchTerm, book.title, book.author ?? '');
  });
}

/** L227-230。 */
export function filterShelfFavorites(
  favorites: readonly FavoriteItem[],
  favoritesLocked: boolean,
  field: ShelfSearchField,
  searchTerm: string,
): readonly FavoriteItem[] {
  if (favoritesLocked) return [];
  return favorites.filter((item) =>
    shelfSearchMatches(field, searchTerm, item.favorite.title, item.favorite.author ?? ''),
  );
}

/** L258 / L259 的空态文案（`tr()` 由 UI 层补）。 */
export const SHELF_SEARCH_EMPTY_TITLE = '暂无可搜索的书籍';
export const SHELF_SEARCH_NO_MATCH = '没有找到匹配的书籍';

/** L265 / L274 的分组标题。 */
export const SHELF_SEARCH_SECTION_LOCAL = '我的书架';
export const SHELF_SEARCH_SECTION_FAVORITE = '我喜欢的';

/** L292 `"${count} 项"`。 */
export function shelfSearchCountLabel(count: number): string {
  return `${String(count)} 项`;
}

/** L238 / L250 的 testTag。 */
export const SHELF_SEARCH_PLANE_TAG = 'shelf_search_plane';
export const SHELF_SEARCH_RESULTS_TAG = 'shelf_search_results';

/** L89 `mounted = expanded || motion.value > 0f`。 */
export function shelfSearchMounted(expanded: boolean, motion: number): boolean {
  return expanded || motion > 0;
}

/** L90 `covered = expanded && motion.value >= 1f`。 */
export function shelfSearchCovered(expanded: boolean, motion: number): boolean {
  return expanded && motion >= 1;
}

/** L92-95 `open()`。 */
export interface ShelfSearchSnapshot {
  readonly expanded: boolean;
  readonly requestKeyboard: boolean;
}

export function openShelfSearch(): ShelfSearchSnapshot {
  return { expanded: true, requestKeyboard: true };
}

/** L97-100 `close()`。 */
export function closeShelfSearch(): ShelfSearchSnapshot {
  return { expanded: false, requestKeyboard: false };
}

/** L270 `flightKey = book.id.toString().takeUnless { book.isComic }`。 */
export function shelfSearchFlightKey(book: ShelfSearchBook): string | null {
  return book.isComic === true ? null : String(book.id);
}

/** L278 `favorite.localThumbPath ?: favorite.coverUrl`。 */
export function favoriteSearchCover(item: FavoriteItem): string | null {
  return item.favorite.localThumbPath ?? item.favorite.coverUrl ?? null;
}

/** L269 / L278：本地结果在前，收藏的 reveal 序号顺延。 */
export function shelfSearchRowOrder(localCount: number, favoriteIndex: number): number {
  return favoriteIndex + localCount;
}

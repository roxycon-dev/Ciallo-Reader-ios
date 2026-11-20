/**
 * 书架搜索面板 —— `ui/shelf/ShelfSearch.kt` L104-361 的 Web 版（对应任务书 §3.3 **E107**：
 * 「书架搜索面板（`ShelfSearchPlane` + 双结果分组 + `N 项` 计数）」）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L104-110 `rememberShelfSearchState()`：`rememberSaveable` 的 expanded/query/field
 *            + `rememberWenkuSearchMotion(expanded)` → `rememberShelfSearchState()`
 *   L113-122 `ShelfSearchBackHandler(state, active)`：`BackHandler(enabled = active && mounted)`
 *            → 同名组件（Web 用 `popstate`）
 *   L126-179 `ShelfSearchPlane(state, books, favorites, inaccessibleCategories, favoritesLocked,
 *            onBookClick, onFavoriteClick, modifier, shelf)`：
 *            两个平面（书架 / 结果），`wenkuPlaneLayer` 的斜切在 Web 侧降为**纯透明度**
 *            （`docs/HANDOFF_PROMPT.md` §4 第 4 条：位移动画会崩 renderer）
 *   L182-192 `shelfSearchBottomInsets()` → `shelfSearchBottomInsets()`（视觉视口高度差）
 *   L204     `shelfSearchOptions` = 三个字段 → `LiquidSegmentOption`
 *   L206-286 `ShelfSearchResults(...)`：
 *             · L219-223 250ms 防抖（`SHELF_SEARCH_DEBOUNCE_MS`）
 *             · L224-230 本地书 / 收藏两次过滤（`@core/wenku/shelfSearch`）
 *             · L233-237 结果键变化时列表回顶
 *             · L255-263 空态文案
 *             · L264-282 两个分组 + `N 项` 计数
 *   L288-294 `SearchSectionTitle(title, count)`：左标题 + 右 `N 项`
 *   L296-356 `SearchBookRow(title, author, cover, order, flightKey, onClick)`：
 *            42×56 封面、6px 圆角、`surfaceVariant` 底、`WenkuSymbol.Book` 占位、标题 2 行、作者 1 行
 *   L358-361 `SearchCoverSource`（飞行起始的 bounds + 位图）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { FavoriteItem } from '@core/library/favoriteTypes';
import { tr } from '@core/i18n/locale';
import {
  SHELF_SEARCH_DEBOUNCE_MS,
  SHELF_SEARCH_EMPTY_TITLE,
  SHELF_SEARCH_NO_MATCH,
  SHELF_SEARCH_PLANE_TAG,
  SHELF_SEARCH_RESULTS_TAG,
  SHELF_SEARCH_SECTION_FAVORITE,
  SHELF_SEARCH_SECTION_LOCAL,
  SHELF_SEARCH_FIELD_TITLES,
  ShelfSearchField,
  favoriteSearchCover,
  filterShelfBooks,
  filterShelfFavorites,
  shelfSearchCountLabel,
  shelfSearchCovered,
  shelfSearchFlightKey,
  shelfSearchMounted,
  shelfSearchResultKey,
  shelfSearchRowOrder,
  type ShelfSearchBook,
} from '@core/wenku/shelfSearch';
import { GlassCard } from '../GlassCard';
import { LiquidSegmentedSelector, type LiquidSegmentOption } from '../LiquidSegmentedSelector';
import { WenkuIcon } from '../wenku/WenkuIcon';
import { rememberWenkuSearchMotion } from '../wenku/WenkuGlass';
import '../../../styles/shelf.css';

/** L204 `shelfSearchOptions = ShelfSearchField.entries.map { LiquidSegmentOption(it.ordinal, it.title) }`。 */
export const shelfSearchOptions: readonly LiquidSegmentOption[] = ShelfSearchField.map((field, index) => ({
  id: index,
  label: SHELF_SEARCH_FIELD_TITLES[field],
}));

/** L182-192 `shelfSearchBottomInsets()`：输入法 + 底部安全区，封顶到容器高度。 */
export function shelfSearchBottomInsets(): number {
  if (typeof window === 'undefined') return 0;
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) return 0;
  const layout = window.innerHeight;
  const visual = viewport.height + viewport.offsetTop;
  return Math.max(Math.round(layout - visual), 0);
}

export interface ShelfSearchState {
  readonly expanded: boolean;
  readonly query: string;
  readonly field: ShelfSearchField;
  /** L82 `motion: State<Float>` 的当前值。 */
  readonly motion: number;
  readonly mounted: boolean;
  readonly covered: boolean;
  readonly requestKeyboard: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly setQuery: (next: string) => void;
  readonly setField: (next: ShelfSearchField) => void;
}

/** L77-110 `ShelfSearchState` + `rememberShelfSearchState`（实现名 `use*`，第 123 行按 Kotlin 原名导出）。 */
export function useShelfSearchState(): ShelfSearchState {
  const [expanded, setExpanded] = useState(false);
  const [query, setQueryState] = useState('');
  const [field, setFieldState] = useState<ShelfSearchField>('Any');
  const [requestKeyboard, setRequestKeyboard] = useState(false);
  const motion = rememberWenkuSearchMotion(expanded);
  const open = useCallback(() => {
    setRequestKeyboard(true);
    setExpanded(true);
  }, []);
  const close = useCallback(() => {
    setRequestKeyboard(false);
    setExpanded(false);
  }, []);
  return {
    expanded,
    query,
    field,
    motion,
    mounted: shelfSearchMounted(expanded, motion),
    covered: shelfSearchCovered(expanded, motion),
    requestKeyboard,
    open,
    close,
    setQuery: setQueryState,
    setField: setFieldState,
  };
}

/** Kotlin 原名出口（
ememberShelfSearchState）。 */
export const rememberShelfSearchState = useShelfSearchState;

export interface ShelfSearchBackHandlerProps {
  readonly state: ShelfSearchState;
  readonly active: boolean;
}

/** L113-122 `ShelfSearchBackHandler`。 */
export function ShelfSearchBackHandler(props: ShelfSearchBackHandlerProps): null {
  const { active } = props;
  const { mounted, close } = props.state;
  useEffect(() => {
    if (!active || !mounted) return undefined;
    const onPop = (): void => {
      close();
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active, mounted, close]);
  return null;
}

export interface ShelfSearchPlaneProps {
  readonly state: ShelfSearchState;
  readonly books: readonly ShelfSearchBook[];
  readonly favorites: readonly FavoriteItem[];
  readonly inaccessibleCategories: ReadonlySet<string>;
  readonly favoritesLocked: boolean;
  readonly onBookClick: (book: ShelfSearchBook) => void;
  readonly onFavoriteClick: (item: FavoriteItem) => void;
  /** Kotlin `shelf: @Composable () -> Unit` —— 被搜索面板盖住的书架本体。 */
  readonly shelf: ReactNode;
  readonly className?: string;
}

/** L126-179 `ShelfSearchPlane`。 */
export function ShelfSearchPlane(props: ShelfSearchPlaneProps) {
  const { state } = props;
  const inset = shelfSearchBottomInsets();
  return (
    <div className={['shelf-search', props.className].filter(Boolean).join(' ')}>
      <div
        className="shelf-search__shelf-plane"
        style={{
          opacity: state.mounted ? 0.62 : 1,
          pointerEvents: state.mounted ? 'none' : 'auto',
          transition: `opacity ${String(state.mounted ? 420 : 320)}ms cubic-bezier(0.2, 1.08, 0.34, 1)`,
        }}
        aria-hidden={state.mounted}
      >
        {props.shelf}
      </div>
      {state.mounted ? (
        <div
          className="shelf-search__results-plane"
          style={{
            opacity: state.motion,
            pointerEvents: state.expanded ? 'auto' : 'none',
            paddingBottom: `${String(inset)}px`,
          }}
          data-testid={SHELF_SEARCH_PLANE_TAG}
        >
          <ShelfSearchResults
            query={state.query}
            field={state.field}
            onFieldChange={state.setField}
            books={props.books}
            favorites={props.favorites}
            inaccessibleCategories={props.inaccessibleCategories}
            favoritesLocked={props.favoritesLocked}
            onBookClick={props.onBookClick}
            onFavoriteClick={props.onFavoriteClick}
          />
        </div>
      ) : null}
    </div>
  );
}

export interface ShelfSearchResultsProps {
  readonly query: string;
  readonly field: ShelfSearchField;
  readonly onFieldChange: (next: ShelfSearchField) => void;
  readonly books: readonly ShelfSearchBook[];
  readonly favorites: readonly FavoriteItem[];
  readonly inaccessibleCategories: ReadonlySet<string>;
  readonly favoritesLocked: boolean;
  readonly onBookClick: (book: ShelfSearchBook) => void;
  readonly onFavoriteClick: (item: FavoriteItem) => void;
}

/** L206-286 `ShelfSearchResults`。 */
export function ShelfSearchResults(props: ShelfSearchResultsProps) {
  // L219-223：只在 query 非空时排 250ms 去抖；空查询直接由渲染期派生（不在 effect 里 setState）。
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const trimmed = props.query.trim();
    if (trimmed === '') return undefined;
    const id = setTimeout(() => setDebounced(trimmed), SHELF_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [props.query]);
  const searchTerm = props.query.trim() === '' ? '' : debounced;

  const localResults = useMemo(
    () => filterShelfBooks(props.books, props.inaccessibleCategories, props.field, searchTerm),
    [props.books, props.inaccessibleCategories, props.field, searchTerm],
  );
  const favoriteResults = useMemo(
    () => filterShelfFavorites(props.favorites, props.favoritesLocked, props.field, searchTerm),
    [props.favorites, props.favoritesLocked, props.field, searchTerm],
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const resultKeyRef = useRef('');
  useEffect(() => {
    const next = shelfSearchResultKey(props.field, searchTerm);
    if (resultKeyRef.current !== '' && resultKeyRef.current !== next) {
      if (listRef.current !== null) listRef.current.scrollTop = 0;
    }
    resultKeyRef.current = next;
  }, [props.field, searchTerm]);

  const empty = localResults.length === 0 && favoriteResults.length === 0;

  return (
    <div className="shelf-search__body">
      <LiquidSegmentedSelector
        options={shelfSearchOptions}
        selected={ShelfSearchField.indexOf(props.field)}
        onSelect={(id) => {
          const next = ShelfSearchField[id];
          if (next !== undefined) props.onFieldChange(next);
        }}
        className="shelf-search__fields"
      />
      <div className="shelf-search__list" ref={listRef} data-testid={SHELF_SEARCH_RESULTS_TAG}>
        {empty ? (
          <p className="shelf-search__empty">
            {searchTerm === '' ? SHELF_SEARCH_EMPTY_TITLE : tr(SHELF_SEARCH_NO_MATCH)}
          </p>
        ) : null}
        {localResults.length > 0 ? (
          <>
            <SearchSectionTitle title={SHELF_SEARCH_SECTION_LOCAL} count={localResults.length} />
            {localResults.map((book, index) => (
              <SearchBookRow
                key={`book-${String(book.id)}`}
                title={book.title}
                author={book.author ?? ''}
                cover={book.coverUri ?? null}
                order={index}
                flightKey={shelfSearchFlightKey(book)}
                onClick={() => props.onBookClick(book)}
              />
            ))}
          </>
        ) : null}
        {favoriteResults.length > 0 ? (
          <>
            <SearchSectionTitle title={SHELF_SEARCH_SECTION_FAVORITE} count={favoriteResults.length} />
            {favoriteResults.map((item, index) => (
              <SearchBookRow
                key={`favorite-${item.favorite.sourceId}::${item.favorite.comicId}`}
                title={item.favorite.title}
                author={item.favorite.author}
                cover={favoriteSearchCover(item)}
                order={shelfSearchRowOrder(localResults.length, index)}
                onClick={() => props.onFavoriteClick(item)}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** L288-294 `SearchSectionTitle(title, count)`。 */
export function SearchSectionTitle(props: { readonly title: string; readonly count: number }) {
  return (
    <div className="shelf-search__section">
      <span className="shelf-search__section-title">{props.title}</span>
      <span className="shelf-search__section-count">{shelfSearchCountLabel(props.count)}</span>
    </div>
  );
}

/** L358-361 `SearchCoverSource`：飞入动画的起点。 */
export class SearchCoverSource {
  bounds: { x: number; y: number; width: number; height: number } | null = null;
  imageUrl: string | null = null;
}

export interface SearchBookRowProps {
  readonly title: string;
  readonly author: string;
  readonly cover: string | null;
  readonly order: number;
  readonly flightKey?: string | null;
  readonly onClick: () => void;
}

/** L296-356 `SearchBookRow`。 */
export function SearchBookRow(props: SearchBookRowProps): ReactNode {
  const cover = props.cover !== null && props.cover.trim() !== '' ? props.cover : null;
  const style: CSSProperties = { '--shelf-search-order': String(props.order) } as CSSProperties;
  return (
    <div className="shelf-search__row" style={style} data-flight-key={props.flightKey ?? ''}>
      <GlassCard radius={16} padding={12} onClick={props.onClick}>
        <div className="shelf-search__row-inner">
          <span className="shelf-search__cover">
            <WenkuIcon symbol="Book" size={21} tint="var(--color-medium-gray)" />
            {cover === null ? null : <img className="shelf-search__cover-img" src={cover} alt="" />}
          </span>
          <span className="shelf-search__text">
            <span className="shelf-search__title">{props.title}</span>
            {props.author.trim() === '' ? null : <span className="shelf-search__author">{props.author}</span>}
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

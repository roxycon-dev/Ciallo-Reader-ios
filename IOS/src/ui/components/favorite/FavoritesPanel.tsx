/**
 * Port of Android `ui/favorite/FavoritesPanel.kt` (569 lines total / 553 non-blank / 508 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–73   package + imports → file header.
 *          ⚠️ `com.example.ui.shelf.CategoryPill` / `AddCategoryPill` /
 *          `ShelfSelectBadge` / `com.example.ui.shelf.pressScale` are imported from
 *          the shelf package — they live in `@ui/components/shelf/*` and are reused
 *          here by import (no duplication).
 *          `MascotEmptyState(mascotResId = MascotSpriteSheet.idleDrawable, …)` has no
 *          web asset yet; `EmptyState` is used with the title/description/action
 *          strings preserved verbatim and `testTagPrefix` mapped to `data-testid`.
 *   74–81  `enum class FavoriteSort(val label)` → favoriteUi.
 *   83–88  the panel KDoc → component KDoc.
 *   88–116 `@Composable fun FavoritesPanel(items, categories, selectedCategory,
 *          onCategorySelected, onAddCategory, onCategoryLongPress, sortMode,
 *          onSortChange, onItemClick, onRefresh, onGoLibrary, modifier, columns,
 *          refreshing, horizontalPadding, bottomPadding, itemBounds, isSelecting,
 *          selectedKeys)` → same props.
 *   117–120 `remember(items, selectedCategory)` filter → `filterFavorites` (favoriteUi),
 *            called inside `useMemo` here.
 *   121–130 `remember(filtered, sortMode)` sort → `sortFavorites` (favoriteUi).
 *   131     `Column(modifier.fillMaxSize())` → `.fav-panel`.
 *   133–158 分类 Chip 栏: `Row(fillMaxWidth, horizontalScroll, padding vertical 10,
 *            spacedBy 8)` + `CategoryPill(ALL_FAV_CATEGORY, count = items.size)` +
 *            per-category `CategoryPill(count = items.count { … })` with
 *            `onLongClick = { if (name != FAV_DEFAULT_CATEGORY) onCategoryLongPress(name) }`
 *            + `AddCategoryPill(onClick = onAddCategory)` → `.fav-panel__chips`.
 *   160–209 排序胶囊: `Row(horizontalScroll, padding bottom 8, spacedBy 8)` of
 *            `FavoriteSort.entries` pills (r14, bg primary 0.16 when active else
 *            surface 0.45, border 0.5 primary 0.45 / onSurface 0.12, 11.sp,
 *            Bold when active else Medium) + `Spacer(4)` + the refresh pill
 *            ("检查中…" while `refreshing` else "检查更新", always MintPrimary).
 *   211–221 empty → `MascotEmptyState` with title "「还没有喜欢的漫画」",
 *            description "在漫画页点一下 ♡，喜欢的漫画都在这里 —— 不下载、不占空间，随时在线接着看。",
 *            actionLabel "去书库逛逛", testTagPrefix "favorites_empty_state".
 *   222–247 `LazyVerticalGrid(GridCells.Fixed(columns), contentPadding(start/end =
 *            horizontalPadding, bottom = bottomPadding), spacedBy 16 vertical /
 *            12 horizontal)` → CSS grid with `grid-template-columns: repeat(columns, 1fr)`
 *            and inline padding. `itemBounds(item.key).animateItemPlacement()` has no
 *            web equivalent; the key-sorted grid gives the same visual result.
 *   251     `const val ALL_FAV_CATEGORY = "全部"` → favoriteUi.
 *   253–289 `fun FavoriteCard(item, onClick, modifier, selected, multiSelecting, dimmed,
 *            hidden, hostOwnsGesture, pressed, coverModifier)` — the four ⚠️ KDoc
 *            blocks (multiSelecting vs selected; hidden must reach 0 like the shelf
 *            card; hostOwnsGesture must not attach pressScale; pressed drives the
 *            press feedback instead) are preserved verbatim on the props.
 *   290–313 derived values → `favoriteCardMeta` (favoriteUi).
 *   291–300 `animateFloatAsState(cardAlpha = hidden ? 0 : dimmed ? 0.85 : 1,
 *            springDefault)` and `pressAnim = pressed ? 0.97 : 1` → inline styles.
 *   315–330 `Column(fillMaxWidth, graphicsLayer{alpha, scaleX/Y}, clip(14),
 *            .then(if (hostOwnsGesture) Modifier else pressScale(0.97, onTap=onClick)))`
 *            → `hostOwnsGesture` decides between a `<button>` and a plain `<div>`.
 *   331–345 cover `Box(fillMaxWidth, aspectRatio 0.72, clip 14, vertical gradient
 *            surfaceVariant 0.8 → 0.45)` + `AsyncImage(model = localThumbPath ?:
 *            coverUrl, contentDescription = title, Crop, fillMaxSize)`
 *            → `<img class="fav-card__cover-img">` with an `onError` fallback that
 *            hides the img (the documented Coil→`<img>` adaptation).
 *   355–366 更新角标: r6 bg `0xFFFF4D4F`, h-padding 5 v-padding 2, "更新" 9.sp Bold white.
 *   367–378 未读话数: r6 bg Black 0.55, "未读 $unread 话" 9.sp Bold white.
 *   379–388 来源小标签: r6 bg Black 0.5, `fav.sourceId` 9.sp white, maxLines 1.
 *   389–400 已下载 N 话: r6 bg MintPrimary 0.85, 9.sp Bold white.
 *   401–417 多选态: `if (multiSelecting) { if (selected) Box(matchParentSize,
 *            bg MintPrimary 0.22); Box(TopStart, padding 6) { ShelfSelectBadge(selected) } }`
 *   418–429 来源失效: centered 28.dp circle Black 0.45 with `Icons.Filled.Warning` 16.dp
 *            `0xFFFFD166`, contentDescription "来源失效".
 *   432–441 title 12.sp Medium onSurface, maxLines 1, ellipsis.
 *   442–452 caption `buildString { … }` 10.sp onSurface 0.55 → `favoriteCardMeta.caption`.
 *   453–465 thin progress bar (3.dp, CircleShape, MintPrimary, track onSurface 0.10).
 *   469–529 `fun ShelfSegmentedTabs(selectedIndex, onSelected, favoritesCount, modifier)`:
 *            `LocalDensity 4.dp → padPx`, `rowWidthPx` via `onSizeChanged`,
 *            `itemWidthPx = (rowWidthPx - padPx*2) / 2`, `fraction` spring(0.72, 420),
 *            container r20 bg surface 0.35 border 0.5 onSurface 0.10 padding 4,
 *            sliding indicator r16 bg MintPrimary 0.18, then two weighted
 *            `SegmentedItem`s. → CSS `translateX(var(--fav-segment-progress) * 100%)`
 *            with a 50 %-width indicator.
 *   531–573 `private fun SegmentedItem(text, selected, onClick, modifier, badge)` —
 *            r16, pressScale on click, padding vertical 8, the ♡ icon only for
 *            "我喜欢的" 14.dp (MintPrimary when selected else onSurface 0.55),
 *            label 13.sp (Bold/Medium; primary / onSurface 0.65), badge 10.sp Bold.
 *   575–588 `fun FavoritesEmptyState(onGoLibrary, modifier)` — same mascot copy minus
 *            the long description tail.
 *   590–594 `fun ensureFavoriteCategory(current, existing)` → favoriteUi.
 */

import { useMemo, type CSSProperties } from 'react';
import { EmptyState } from '@ui/components/EmptyState';
import { CategoryPill, AddCategoryPill, ShelfSelectBadge } from '@ui/components/shelf/CategoryPill';
import {
  ALL_FAV_CATEGORY,
  FAVORITE_SORT_LABELS,
  FAV_CARD_PRESS_SCALE,
  FAV_CARD_DIM_ALPHA,
  FAV_CARD_FALLBACK_PRESS_SCALE,
  FAV_CARD_DIM_LABEL,
  FAV_CARD_PRESS_LABEL,
  FAV_DEAD_ICON_COLOR,
  FAV_DEAD_ICON_INK,
  FAV_SOURCE_TAG_INK,
  FAV_UNREAD_BADGE_INK,
  FAV_UPDATE_BADGE_COLOR,
  FAV_DEFAULT_CATEGORY,
  SHELF_SEGMENT_BOOK,
  SHELF_SEGMENT_FAV,
  favoriteCardMeta,
  filterFavorites,
  sortFavorites,
  type FavoriteItem,
  type FavoriteSortCode,
} from '@core/favorite/favoriteUi';
import { favoriteItemKey } from '@core/library/favoriteTypes';
import '../../../styles/favorite.css';

const MINT_PRIMARY = '#059669';

function IconFavorite() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  );
}

/** Cover image with Coil→`<img>` `onError` fallback (documented adaptation). */
function CoverImage(props: { src: string; alt: string; className: string }) {
  return (
    <img
      className={props.className}
      src={props.src}
      alt={props.alt}
      loading="lazy"
      onError={(event) => {
        // AsyncImage leaves the placeholder visible on failure; the CSS background
        // of .fav-card__cover already is the placeholder, so just drop the node.
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}

/**
 * 书架「我喜欢的」栏：分类 Chip 栏 + 网格/列表 + 排序，样式与「我的书架」保持一致。
 *
 * 打开逻辑：点击卡片直接进漫画主页面（在线阅读，不需要任何下载流程）。
 */
export function FavoritesPanel(props: {
  items: ReadonlyArray<FavoriteItem>;
  /** 「我喜欢的」自己的分类名（与书架 categories 完全独立，各过各的） */
  categories: ReadonlyArray<string>;
  selectedCategory: string;
  onCategorySelected: (category: string) => void;
  onAddCategory: () => void;
  /** 长按分类 → 重命名 / 删除（只影响收藏分类，碰不到书架） */
  onCategoryLongPress?: (category: string) => void;
  sortMode: FavoriteSortCode;
  onSortChange: (mode: FavoriteSortCode) => void;
  onItemClick: (item: FavoriteItem) => void;
  onRefresh: () => void;
  onGoLibrary: () => void;
  /** 网格列数（Android `columns`，默认 3） */
  columns?: number;
  refreshing?: boolean;
  /** 网格左右留白（作为独立整页时用 12.dp，嵌在别处用 0） */
  horizontalPadding?: number;
  /** 网格底部留白：默认给底部 Tab 栏留出空间 */
  bottomPadding?: number;
  /** 多选/拖拽用：宿主注入的几何 key 集合（Android `itemBounds: (String) -> Modifier`） */
  itemBoundsKeys?: ReadonlySet<string>;
  /** 多选态：显示左上角圆形勾选框 */
  isSelecting?: boolean;
  selectedKeys?: ReadonlySet<string>;
}) {
  const columns = props.columns ?? 3;
  const horizontalPadding = props.horizontalPadding ?? 0;
  const bottomPadding = props.bottomPadding ?? 120;
  const isSelecting = props.isSelecting === true;
  const selectedKeys = props.selectedKeys ?? new Set<string>();

  const filtered = useMemo(
    () => filterFavorites(props.items, props.selectedCategory),
    [props.items, props.selectedCategory],
  );
  const sorted = useMemo(() => sortFavorites(filtered, props.sortMode), [filtered, props.sortMode]);

  return (
    <div className="fav-panel">
      {/* 分类 Chip 栏（与我的书架相互独立：各自的选中项各自记住） */}
      <div className="fav-panel__chips">
        <CategoryPill
          name={ALL_FAV_CATEGORY}
          selected={props.selectedCategory === ALL_FAV_CATEGORY}
          count={props.items.length}
          onClick={() => props.onCategorySelected(ALL_FAV_CATEGORY)}
        />
        {props.categories.map((name) => (
          <CategoryPill
            key={name}
            name={name}
            selected={props.selectedCategory === name}
            count={props.items.filter((it) => it.favorite.categoryName === name).length}
            onClick={() => props.onCategorySelected(name)}
            // 「默认」不允许删除/改名：它是收藏的兜底分类。Kotlin's `onLongClick` is a
            // nullable `(() -> Unit)?`, so `null` (not `undefined`) marks "absent" under
            // `exactOptionalPropertyTypes`.
            onLongClick={name === FAV_DEFAULT_CATEGORY ? null : () => props.onCategoryLongPress?.(name)}
          />
        ))}
        <AddCategoryPill onClick={props.onAddCategory} />
      </div>

      {/* 排序胶囊 */}
      <div className="fav-panel__sorts">
        {FAVORITE_SORT_LABELS.map((entry) => (
          <button
            key={entry.code}
            type="button"
            className={
              props.sortMode === entry.code ? 'fav-sort-pill fav-sort-pill--active' : 'fav-sort-pill'
            }
            aria-pressed={props.sortMode === entry.code}
            onClick={() => props.onSortChange(entry.code)}
          >
            {entry.label}
          </button>
        ))}
        <span style={{ width: 4, flex: '0 0 4px' }} />
        <button
          type="button"
          className="fav-sort-pill fav-sort-pill--refresh"
          onClick={props.onRefresh}
        >
          {props.refreshing === true ? '检查中…' : '检查更新'}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="fav-panel__empty">
          <EmptyState
            title="「还没有喜欢的漫画」"
            subtitle="在漫画页点一下 ♡，喜欢的漫画都在这里 —— 不下载、不占空间，随时在线接着看。"
            action={
              <button type="button" className="home-action-chip" onClick={props.onGoLibrary}>
                去书库逛逛
              </button>
            }
          />
        </div>
      ) : (
        <div
          className="fav-panel__grid"
          style={{
            gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
            rowGap: 16,
            columnGap: 12,
            paddingLeft: horizontalPadding,
            paddingRight: horizontalPadding,
            paddingBottom: bottomPadding,
          }}
        >
          {sorted.map((item) => {
            const key = favoriteItemKey(item);
            return (
              <FavoriteCard
                key={key}
                item={item}
                onClick={() => props.onItemClick(item)}
                selected={isSelecting && selectedKeys.has(key)}
                multiSelecting={isSelecting}
                dimmed={isSelecting && !selectedKeys.has(key)}
                registered={props.itemBoundsKeys?.has(key) ?? true}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 「我喜欢的」卡片：封面 + 来源小标签 + 更新/未读角标 + 底部细进度条 + 副文案。 */
export function FavoriteCard(props: {
  item: FavoriteItem;
  onClick: () => void;
  selected?: boolean;
  /**
   * 「我喜欢的」板块当前是否处于多选态（由宿主按板块注入）。
   *
   * 决定左上角圆形勾选框**画不画**：未选中也要画白圆圈，才与书架卡片同构。
   * 以前用 `selected` 兼任这个判断，导致未选中条目不出现勾选框。
   */
  multiSelecting?: boolean;
  /** 多选态下「未被选中」的书：压暗到 0.85，把选中的那几本衬出来 */
  dimmed?: boolean;
  /**
   * 被拿起来拖拽 / 正在飞回原位时为 true：整张卡淡到 **0**，原位不留任何色块。
   *
   * ⚠️ 书架书卡一直有这条（isDragged || isFlyingHome → 0f），收藏卡片却只有
   * [dimmed]（0.85）—— 用户反馈「我喜欢的拖动的时候原处书本没有跟我的书架一样
   * 原处消失」。两个板块必须是同一套规则，否则拖起来完全不像一个东西。
   */
  hidden?: boolean;
  /**
   * 手势已交给书架拖拽宿主时为 true。
   *
   * ⚠️ 此时卡片自己**绝不能**再挂 pressScale：`pressScale` 内部是 clickable，
   * down 的一瞬间就把事件消费掉，宿主的长按等待循环永远等不到超时 ——
   * 表现就是「书架长按有反应，我喜欢的长按完全没反应」。
   * 按压反馈改由 [pressed] 驱动（值来自宿主的 ShelfSelectionState.pressedKey）。
   */
  hostOwnsGesture?: boolean;
  pressed?: boolean;
  /** Android `coverModifier` — 封面几何登记的宿主句柄（React 侧无需传 DOM ref） */
  coverElementId?: string;
  /** Android `itemBounds` — true 时宿主已登记该 key 的几何 */
  registered?: boolean;
}) {
  const fav = props.item.favorite;
  const meta = favoriteCardMeta(props.item);
  const dimmed = props.dimmed === true;
  const hidden = props.hidden === true;
  const pressed = props.pressed === true;
  const hostOwnsGesture = props.hostOwnsGesture === true;

  // `cardAlpha` (Kotlin L291–295)
  const cardAlpha = hidden ? 0 : dimmed ? FAV_CARD_DIM_ALPHA : 1;
  // `pressAnim` (Kotlin L296–300)
  const pressAnim = pressed ? FAV_CARD_PRESS_SCALE : 1;

  const body = (
    <>
      <div className="fav-card__cover" id={props.coverElementId}>
        {meta.cover != null && meta.cover.trim() !== '' ? (
          <CoverImage src={meta.cover} alt={fav.title} className="fav-card__cover-img" />
        ) : null}

        {/* 更新角标 */}
        {meta.hasUpdate ? (
          <span className="fav-card__badge fav-card__badge--update" style={{ background: FAV_UPDATE_BADGE_COLOR }}>
            更新
          </span>
        ) : null}
        {/* 未读话数 */}
        {meta.unread > 0 ? (
          <span className="fav-card__badge fav-card__badge--unread" style={{ background: FAV_UNREAD_BADGE_INK }}>
            {`未读 ${String(meta.unread)} 话`}
          </span>
        ) : null}
        {/* 来源小标签 */}
        <span className="fav-card__badge fav-card__badge--source" style={{ background: FAV_SOURCE_TAG_INK }}>
          {fav.sourceId}
        </span>
        {/* 已下载 N 话 */}
        {props.item.downloadedChapters > 0 ? (
          <span className="fav-card__badge fav-card__badge--downloaded">
            {`已下载 ${String(props.item.downloadedChapters)} 话`}
          </span>
        ) : null}

        {/* 多选态：左上角圆形勾选框 + 主题色遮罩
            ⚠️ 原来只有 `if (selected)` 才画，所以「我喜欢的」**未选中**的条目根本没有白圆圈，
            与书架的观感不一致（用户反馈）。改为按 [multiSelecting] 决定是否显示勾选框。 */}
        {props.multiSelecting === true ? (
          <>
            {props.selected === true ? <span className="fav-card__select-mask" /> : null}
            <span className="fav-card__select-badge">
              <ShelfSelectBadge selected={props.selected === true} />
            </span>
          </>
        ) : null}

        {meta.dead ? (
          <span className="fav-card__dead" style={{ background: FAV_DEAD_ICON_INK }} aria-label="来源失效">
            <span style={{ color: FAV_DEAD_ICON_COLOR, display: 'inline-flex' }}>
              <IconWarning />
            </span>
          </span>
        ) : null}
      </div>

      <p className="fav-card__title">{fav.title}</p>
      <p className="fav-card__caption">{meta.caption}</p>
      {meta.readRatio != null ? (
        <div
          className="fav-card__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meta.readRatio * 100)}
        >
          <div className="fav-card__progress-fill" style={{ width: `${String(meta.readRatio * 100)}%` }} />
        </div>
      ) : null}
    </>
  );

  // `data-` hook so the animation-spec labels stay traceable to the Kotlin source.
  const dataLabels = `${FAV_CARD_DIM_LABEL} ${FAV_CARD_PRESS_LABEL} ${String(FAV_CARD_FALLBACK_PRESS_SCALE)}`;

  if (hostOwnsGesture) {
    // ⚠️ 此时不能再挂 press（等价于 Kotlin 不挂 pressScale），按压视觉由 [pressed] 驱动。
    return (
      <div
        className="fav-card"
        data-labels={dataLabels}
        data-registered={props.registered === true ? '1' : '0'}
        style={{ opacity: cardAlpha, transform: `scale(${String(pressAnim)})` }}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="fav-card"
      data-labels={dataLabels}
      data-registered={props.registered === true ? '1' : '0'}
      style={{ opacity: cardAlpha, transform: `scale(${String(pressAnim)})` }}
      onClick={props.onClick}
    >
      {body}
    </button>
  );
}

/** 顶部一级分段：[ 我的书架 | 我喜欢的 ]。 */
export function ShelfSegmentedTabs(props: {
  selectedIndex: number;
  onSelected: (index: number) => void;
  favoritesCount: number;
}) {
  return (
    <div
      className="fav-segmented"
      // `fraction` = animateFloatAsState(selectedIndex, spring(0.72, 420))
      style={
        {
          '--fav-segment-progress': props.selectedIndex === 1 ? 1 : 0,
        } as CSSProperties
      }
    >
      <span className="fav-segmented__indicator" />
      <div className="fav-segmented__row">
        <SegmentedItem
          text={SHELF_SEGMENT_BOOK}
          selected={props.selectedIndex === 0}
          onClick={() => props.onSelected(0)}
        />
        <SegmentedItem
          text={SHELF_SEGMENT_FAV}
          selected={props.selectedIndex === 1}
          badge={props.favoritesCount}
          onClick={() => props.onSelected(1)}
        />
      </div>
    </div>
  );
}

function SegmentedItem(props: { text: string; selected: boolean; onClick: () => void; badge?: number }) {
  const badge = props.badge ?? -1;
  const iconColor = props.selected ? MINT_PRIMARY : 'rgba(24, 25, 28, 0.55)';
  return (
    <button
      type="button"
      className="fav-segmented__item"
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      {props.text === SHELF_SEGMENT_FAV ? (
        <span style={{ color: iconColor, display: 'inline-flex' }}>
          <IconFavorite />
        </span>
      ) : null}
      <span
        className={
          props.selected
            ? 'fav-segmented__label fav-segmented__label--active'
            : 'fav-segmented__label'
        }
      >
        {props.text}
      </span>
      {badge > 0 ? (
        <span
          className={
            props.selected
              ? 'fav-segmented__badge fav-segmented__badge--active'
              : 'fav-segmented__badge'
          }
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/** 空状态：友好插画 + 引导（设计稿 §2.5）。 */
export function FavoritesEmptyState(props: { onGoLibrary: () => void }) {
  return (
    <div className="fav-panel__empty">
      <EmptyState
        title="「还没有喜欢的漫画」"
        subtitle="在漫画页点一下 ♡，喜欢的漫画都在这里。"
        action={
          <button type="button" className="home-action-chip" onClick={props.onGoLibrary}>
            去书库逛逛
          </button>
        }
      />
    </div>
  );
}

export { ALL_FAV_CATEGORY };
export type { FavoriteItem, FavoriteSortCode };

/**
 * Favorite UI pure logic — extracted from the Compose `ui/favorite/*` package so the
 * React components stay presentational and this file is unit-testable.
 *
 * Kotlin → TS line map (non-blank / code lines counted by the porting harness):
 *
 * | Kotlin                                   | nonblank | code | Target here                          |
 * |------------------------------------------|---------:|-----:|--------------------------------------|
 * | ui/favorite/FavoritesPanel.kt            |      553 |  508 | `FavoriteSort`, `filterFavorites`,   |
 * |                                          |          |      | `sortFavorites`, `favoriteCardMeta`, |
 * |                                          |          |      | `ALL_FAV_CATEGORY`,                  |
 * |                                          |          |      | `ensureFavoriteCategory`             |
 * |   ↳ FavoriteSort enum (L74–81)           |         |   8 | L37–L55  (verbatim labels)          |
 * |   ↳ filtered/sorted `remember` blocks    |         |  13 | L66–L95                             |
 * |   ↳ FavoriteCard derived values (L301–313)|        |  13 | L113–L160 (`favoriteCardMeta`)      |
 * |   ↳ `const val ALL_FAV_CATEGORY` (L251)  |         |   1 | L46                                  |
 * |   ↳ `ensureFavoriteCategory` (L591–594)  |         |   4 | L163–L175                           |
 * | ui/favorite/ChapterStatusRow.kt          |      424 |  386 | `ChapterVisual`, `ChapterRowState`,  |
 * |                                          |          |      | `chapterReadStateToVisual`,          |
 * |                                          |          |      | `chapterRowProgressFloat`,           |
 * |                                          |          |      | `chapterRowAriaLabel`                |
 * |   ↳ `enum class ChapterVisual` (L67)     |         |   1 | L24                                  |
 * |   ↳ `ChapterReadState.toVisual` (L69–73) |         |   5 | L26–L32                             |
 * |   ↳ `data class ChapterRowState` (L75–90)|        |  16 | L34–L60                             |
 * |   ↳ a11y `contentDescription` (L174–187) |        |  14 | L92–L112                            |
 * |   ↳ `luminance()` (L471–472)            |         |   2 | L116–L119                           |
 * | ui/favorite/SourceMigration.kt           |      220 |  208 | `normalizeSourceTitle`,              |
 * |                                          |          |      | `findSourceCandidates`               |
 * |   ↳ `data class SourceCandidate` (L48–54)|        |   7 | L33–L43                             |
 * |   ↳ `ComicSourceMigration.normalize` (65–66)|      |   2 | L55–L59                             |
 * |   ↳ `ComicSourceMigration.findCandidates`|        |  40 | L69–L124                            |
 * | ui/favorite/ComicDetailActions.kt        |      114 |  106 | `continueReadingLabel` (thin alias)  |
 * |   ↳ `continueReadingLabel` (L118–121)   |         |   4 | L29–L36                             |
 * | ui/favorite/HeartArt.kt                  |       88 |   69 | `HEART_TOP/MID/BOTTOM`,              |
 * |                                          |          |      | `HEART_ART_DEFAULT_SIZE`,            |
 * |                                          |          |      | `heartPathD`                        |
 * |   ↳ HeartTop/Mid/Bottom (L46–52)        |         |   7 | L63–L72                             |
 * |   ↳ `HeartArtDefaultSize` (L114)        |         |   1 | L74                                  |
 * |   ↳ `heartPathPx` (L31–38)              |         |   8 | L40–L60                             |
 *
 * NOT ported here (they are components, not logic — see ui/components/favorite/*):
 *   FavoriteHeart.kt, DuplicateComicSheet.kt, and the `@Composable` halves of
 *   FavoritesPanel.kt / ChapterStatusRow.kt / SourceMigration.kt.
 */

import {
  ALL_FAV_CATEGORY_NAME,
  ChapterReadState,
  FAV_DEFAULT_CATEGORY,
  type ComicProgressEntity,
  type FavoriteEntity,
  type FavoriteItem,
} from '@core/library/favoriteTypes';
import { chapterNumber, continueLabel, type ContinueTarget } from '@core/library/comicReadingLogic';
import type { ComicChapter, SearchBook } from '@core/library/comicSourceTypes';

/* ═══════════════════════════════════════════════════════════════════════
 * FavoritesPanel.kt
 * ═══════════════════════════════════════════════════════════════════════ */

/** 「我喜欢的」排序方式。 — FavoritesPanel.kt L74–81 (labels verbatim). */
export const FavoriteSort = {
  RECENT_FAVORITE: 'RECENT_FAVORITE',
  RECENT_READ: 'RECENT_READ',
  RECENT_UPDATE: 'RECENT_UPDATE',
  TITLE: 'TITLE',
  CUSTOM: 'CUSTOM',
} as const;

export type FavoriteSortCode = (typeof FavoriteSort)[keyof typeof FavoriteSort];

/** Kotlin `FavoriteSort(val label: String)` — enum entry label table. */
export const FAVORITE_SORT_LABELS: ReadonlyArray<{ code: FavoriteSortCode; label: string }> = [
  { code: FavoriteSort.RECENT_FAVORITE, label: '最近收藏' },
  { code: FavoriteSort.RECENT_READ, label: '最近阅读' },
  { code: FavoriteSort.RECENT_UPDATE, label: '最近更新' },
  { code: FavoriteSort.TITLE, label: '书名' },
  { code: FavoriteSort.CUSTOM, label: '自定义' },
];

/** FavoritesPanel.kt L251 — `const val ALL_FAV_CATEGORY = "全部"`. */
export const ALL_FAV_CATEGORY = ALL_FAV_CATEGORY_NAME;

/** FavoritesPanel.kt L117–120 — `remember(items, selectedCategory) { ... }`. */
export function filterFavorites(
  items: ReadonlyArray<FavoriteItem>,
  selectedCategory: string,
): FavoriteItem[] {
  if (selectedCategory === ALL_FAV_CATEGORY) return [...items];
  return items.filter((it) => it.favorite.categoryName === selectedCategory);
}

/** FavoritesPanel.kt L121–130 — `remember(filtered, sortMode) { when (sortMode) { ... } }`. */
export function sortFavorites(
  filtered: ReadonlyArray<FavoriteItem>,
  sortMode: FavoriteSortCode,
): FavoriteItem[] {
  const list = [...filtered];
  switch (sortMode) {
    case FavoriteSort.RECENT_FAVORITE:
      // sortedByDescending { it.favorite.favoritedAt }
      return list.sort((a, b) => b.favorite.favoritedAt - a.favorite.favoritedAt);
    case FavoriteSort.RECENT_READ:
      // sortedByDescending { it.progress?.lastReadAt ?: 0L }
      return list.sort((a, b) => (b.progress?.lastReadAt ?? 0) - (a.progress?.lastReadAt ?? 0));
    case FavoriteSort.RECENT_UPDATE:
      return list.sort(
        (a, b) => b.favorite.latestChapterUpdateAt - a.favorite.latestChapterUpdateAt,
      );
    case FavoriteSort.TITLE:
      // sortedBy { it.favorite.title.lowercase() }
      return list.sort((a, b) => compareKotlinLowercase(a.favorite.title, b.favorite.title));
    case FavoriteSort.CUSTOM:
      return list.sort((a, b) => a.favorite.sortOrder - b.favorite.sortOrder);
    default:
      return list;
  }
}

/**
 * Kotlin `String.lowercase()` ordering is a plain code-unit comparison; JS default
 * `Array#sort` on strings is UTF-16 code-unit order too, so the default comparator is
 * equivalent. Wrapped so the intent is explicit and a single place to change.
 */
function compareKotlinLowercase(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

/**
 * FavoritesPanel.kt L301–313 — the derived values `FavoriteCard` reads.
 *
 * ⚠️ 「有更新」= 快照 id 与已见快照不同。⚠️ 要再加一道话数兜底：
 * 有的源每次拉取 chapterId 都不同（URL 带时间戳/hash），裸 id 比较会让
 * 已经读到最新话数的漫画永远亮着「更新」角标。标题能解析出话数、且用户
 * 已读到该话数（latestNum ≤ readNum）→ 不算更新；解析不到话数退回 id 比较
 * （缺章源里 order 序号 ≤ 话数，readNum 偏小只会少兜底、不会误压制真更新）。
 */
export interface FavoriteCardMeta {
  /** Kotlin `latestNum = ComicReadingLogic.chapterNumber(fav.latestChapterTitle.orEmpty())`. */
  latestNum: number | null;
  /** Kotlin `readNum = (item.progress?.lastChapterIndex ?: -1).let { if (it >= 0) it + 1 else 0 }`. */
  readNum: number;
  /** Kotlin `hasUpdate`. */
  hasUpdate: boolean;
  /** Kotlin `unread`. */
  unread: number;
  /** Kotlin `dead = !fav.sourceAlive`. */
  dead: boolean;
  /** Kotlin `cover = fav.localThumbPath ?: fav.coverUrl`. */
  cover: string | null;
  /** Kotlin bottom caption `buildString { ... }` — verbatim assembly order. */
  caption: string;
  /** Kotlin thin progress bar ratio; `null` hides the bar. */
  readRatio: number | null;
}

export function favoriteCardMeta(item: FavoriteItem): FavoriteCardMeta {
  const fav = item.favorite;
  const latestNum = chapterNumber(fav.latestChapterTitle ?? '');
  const progress = item.progress ?? null;
  const readNum = (progress?.lastChapterIndex ?? -1) >= 0 ? (progress?.lastChapterIndex ?? -1) + 1 : 0;
  const seenTop = progress?.seenTopChapterId ?? null;
  const hasUpdate =
    fav.latestChapterId != null &&
    seenTop != null &&
    fav.latestChapterId !== seenTop &&
    !(latestNum !== null && readNum > 0 && latestNum <= readNum);
  const unread = latestNum !== null && readNum > 0 ? Math.max(0, latestNum - readNum) : 0;
  const dead = !fav.sourceAlive;
  const cover = fav.localThumbPath ?? fav.coverUrl;

  let caption = '';
  if (latestNum !== null) caption += `更新至第 ${latestNum} 话`;
  if (readNum > 0) {
    caption += latestNum !== null ? ` · 看到第 ${readNum} 话` : `看到第 ${readNum} 话`;
  }
  if (caption === '') {
    caption = dead ? '来源暂不可用' : '尚未开始阅读';
  }

  let readRatio: number | null = null;
  if (readNum > 0 && latestNum !== null && latestNum > 0) {
    readRatio = Math.max(0, Math.min(1, readNum / latestNum));
  }

  return { latestNum, readNum, hasUpdate, unread, dead, cover, caption, readRatio };
}

/** FavoritesPanel.kt L591–594 — 默认分类兜底（分类行被删光时收藏不至于变孤儿）。 */
export function ensureFavoriteCategory(current: string, existing: ReadonlyArray<string>): string {
  if (existing.includes(current)) return current;
  if (existing.includes(FAV_DEFAULT_CATEGORY)) return FAV_DEFAULT_CATEGORY;
  return existing[0] ?? FAV_DEFAULT_CATEGORY;
}

/* ═══════════════════════════════════════════════════════════════════════
 * ChapterStatusRow.kt
 * ═══════════════════════════════════════════════════════════════════════ */

/** 章节的视觉三态（读状态与下载态是两个独立维度，互不冲突）。 — L67 */
export const ChapterVisual = {
  UNREAD: 'UNREAD',
  READING: 'READING',
  READ: 'READ',
} as const;

export type ChapterVisualCode = (typeof ChapterVisual)[keyof typeof ChapterVisual];

/** ChapterStatusRow.kt L69–73 — `fun ChapterReadState.toVisual(): ChapterVisual`. */
export function chapterReadStateToVisual(state: number): ChapterVisualCode {
  switch (state) {
    case ChapterReadState.READ:
      return ChapterVisual.READ;
    case ChapterReadState.READING:
      return ChapterVisual.READING;
    case ChapterReadState.UNREAD:
      return ChapterVisual.UNREAD;
    default:
      return ChapterVisual.UNREAD;
  }
}

/** ChapterStatusRow.kt L75–90 — `data class ChapterRowState`. */
export interface ChapterRowState {
  visual: ChapterVisualCode;
  /** 上次读到第几页（0 起），阅读中时显示「上次读到第 N 页」 */
  pageIndex: number;
  pageCount: number;
  /** 上次打开之后新增的章节 → 右侧「新」小红点 */
  isNew: boolean;
  /** 已下载到本地 */
  downloaded: boolean;
  downloading: boolean;
  downloadProgress: number;
  external: boolean;
}

/** Kotlin data-class defaults (L76–86). */
export function createChapterRowState(partial: Partial<ChapterRowState> = {}): ChapterRowState {
  return {
    visual: ChapterVisual.UNREAD,
    pageIndex: 0,
    pageCount: 0,
    isNew: false,
    downloaded: false,
    downloading: false,
    downloadProgress: 0,
    external: false,
    ...partial,
  };
}

/** ChapterStatusRow.kt L88–89 — `val progressFloat: Float get() = ...`. */
export function chapterRowProgressFloat(state: ChapterRowState): number {
  return state.pageCount > 0 ? (state.pageIndex + 1) / state.pageCount : 0;
}

/** ChapterStatusRow.kt L174–187 — the `semantics { contentDescription = buildString { ... } }`. */
export function chapterRowAriaLabel(
  title: string,
  state: ChapterRowState,
  bookmarked: boolean,
): string {
  let s = title;
  s += '，';
  s +=
    state.visual === ChapterVisual.READ
      ? '已读'
      : state.visual === ChapterVisual.READING
        ? '阅读中'
        : '未读';
  if (state.downloaded) s += '，已下载';
  if (state.isNew) s += '，新章节';
  if (bookmarked) s += '，已加书签';
  return s;
}

/**
 * ChapterStatusRow.kt L121–127 / L471–472 — dark-mode aware read gray.
 * `isDark = background.luminance() < 0.4f`; the app theme is LIGHT so the light
 * branch is the live one, but the dark value is kept verbatim.
 */
export const READ_GRAY_LIGHT = '#6B6B6B';
export const READ_GRAY_DARK = '#B3B3B3';

export function readGray(isDark: boolean): string {
  return isDark ? READ_GRAY_DARK : READ_GRAY_LIGHT;
}

/** ChapterStatusRow.kt L123–127 — `titleColor` resolution. */
export function chapterTitleColor(
  state: ChapterRowState,
  isDark: boolean,
  onSurface: string,
  primary: string,
): string {
  switch (state.visual) {
    case ChapterVisual.READ:
      return readGray(isDark);
    case ChapterVisual.READING:
      return primary;
    case ChapterVisual.UNREAD:
    default:
      return onSurface;
  }
}

/** Kotlin `Color.luminance()` = 0.2126 R + 0.7152 G + 0.0722 B (L471–472). */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/** ChapterStatusRow.kt L456–468 — `rememberChapterHighlight(key, targetKey)`. */
export const CHAPTER_HIGHLIGHT_MS = 900;

/* ═══════════════════════════════════════════════════════════════════════
 * SourceMigration.kt
 * ═══════════════════════════════════════════════════════════════════════ */

/** 换源候选：在另一个书源里找到的「同一本书」。 — SourceMigration.kt L48–54 */
export interface SourceCandidate {
  sourceId: string;
  sourceName: string;
  book: SearchBook;
  /** Kotlin `val key: String get() = "${sourceId}::${book.id}"`. */
  key: string;
}

export function sourceCandidateKey(sourceId: string, book: SearchBook): string {
  return `${sourceId}::${book.id}`;
}

/** Minimal search surface — mirrors `com.example.source.ComicSource.search`. */
export interface SearchableComicSource {
  id: string;
  name: string;
  search(keyword: string): Promise<
    | { kind: 'success'; data: SearchBook[] }
    | { kind: 'error'; exception: Error }
  >;
}

/**
 * 归一化：去掉标点、空格、大小写差异（保留 CJK 与字母数字）。 — L65–66
 * `title.filter { it.isLetterOrDigit() }.lowercase()`
 */
export function normalizeSourceTitle(title: string): string {
  let out = '';
  for (const ch of title) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
  }
  return out.toLowerCase();
}

/** Simple counting semaphore (kotlinx `Semaphore(3)` → JS). */
class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next !== undefined) next();
      else this.available += 1;
    }
  }
}

/**
 * 换源：按书名在其它已启用书源里找同一本书。 — L74–113
 *
 * 只做「标题归一化后的相等 / 包含」匹配，不猜章节、不做模糊语义匹配 ——
 * 命中结果交给用户确认，避免误迁移到同名不同版本的书。
 *
 * @param maxSources 最多并发查几个源（避免被封） — default 5
 */
export async function findSourceCandidates(
  title: string,
  excludeSourceId: string,
  sources: ReadonlyArray<SearchableComicSource>,
  maxSources = 5,
): Promise<SourceCandidate[]> {
  const want = normalizeSourceTitle(title);
  if (want.trim() === '') return [];
  const gate = new Semaphore(3);
  const targets = sources.filter((s) => s.id !== excludeSourceId).slice(0, maxSources);
  const results = await Promise.all(
    targets.map((source) =>
      gate.withPermit(async () => {
        try {
          const r = await source.search(title);
          if (r.kind === 'error') return null;
          // 同名优先，其次包含
          const exact = r.data.find((it) => normalizeSourceTitle(it.title) === want);
          const loose = r.data.find((it) => {
            const n = normalizeSourceTitle(it.title);
            return n.trim() !== '' && (n.includes(want) || want.includes(n));
          });
          const hit = exact ?? loose;
          if (hit === undefined) return null;
          return {
            sourceId: source.id,
            sourceName: source.name,
            book: hit,
            key: sourceCandidateKey(source.id, hit),
          } satisfies SourceCandidate;
        } catch {
          return null;
        }
      }),
    ),
  );
  return results
    .filter((c): c is SourceCandidate => c !== null)
    .sort((a, b) => (a.sourceName < b.sourceName ? -1 : a.sourceName > b.sourceName ? 1 : 0));
}

/* ═══════════════════════════════════════════════════════════════════════
 * ComicDetailActions.kt
 * ═══════════════════════════════════════════════════════════════════════ */

/** 「继续阅读」文案（纯函数，供单测与 UI 共用）。 — L118–121 */
export function continueReadingLabel(
  target: ContinueTarget,
  chapters: ReadonlyArray<ComicChapter>,
): string {
  // ⚠️ `comicReadingLogic.continueLabel` (not owned by this module) declares
  // `chapters: ComicChapter[]` while the Kotlin signature takes a `List`, so the
  // read-only view is widened with a spread. No behavioural difference: the callee
  // only iterates.
  return continueLabel(target, [...chapters]);
}

/* ═══════════════════════════════════════════════════════════════════════
 * HeartArt.kt
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 心形的三个标准色（上缘亮粉 / 中部正红 / 下缘深玫红）。 — L46–48
 *
 * 中部正红 `#FF4D6D` 与书架卡片右下角那枚"已加入我喜欢的"小角标同色，
 * 全 App 的心只有这一个红，别在别处另调一个。
 */
export const HeartTop = '#FF9AAB';
export const HeartMid = '#FF4D6D';
export const HeartBottom = '#DC1B52';

const ART_TOP = HeartTop;
const ART_MID = HeartMid;
const ART_BOTTOM = HeartBottom;

/** 心形画布的默认边长（按钮/飞行的公共尺寸基准）。 — L114 `46.dp` */
export const HEART_ART_DEFAULT_SIZE = 46;

/**
 * 心形路径（归一化到给定画布尺寸）。 — L31–38
 * Returns an SVG path string in a 0..1 × 0..1 viewBox; the caller scales it.
 * The four cubic Béziers are transcribed 1:1 from the Compose `Path()`.
 */
export function heartPathD(): string {
  return [
    'M 0.50 0.94',
    'C 0.14 0.66, 0.02 0.40, 0.11 0.21',
    'C 0.19 0.05, 0.36 0.07, 0.50 0.24',
    'C 0.64 0.07, 0.81 0.05, 0.89 0.21',
    'C 0.98 0.40, 0.86 0.66, 0.50 0.94',
    'Z',
  ].join(' ');
}

/** ① 外发光 (L71–81): 0.34f * glow pink haze at center (0.5, 0.52), radius 0.78w. */
export const HEART_GLOW_CENTER = { x: 0.5, y: 0.52 };
export const HEART_GLOW_RADIUS = 0.78;
export const HEART_GLOW_ALPHA = 0.34;

/** ③ 高光 (L94–102): white 0.42 at (0.36, 0.28), radius 0.20w. */
export const HEART_SHEEN_CENTER = { x: 0.36, y: 0.28 };
export const HEART_SHEEN_RADIUS = 0.2;
export const HEART_SHEEN_ALPHA = 0.42;

/** ④ 收边 (L105–109): white 0.20 stroke, width max(0.03w, 0.8px). */
export const HEART_EDGE_ALPHA = 0.2;
export const HEART_EDGE_WIDTH_FACTOR = 0.03;
export const HEART_EDGE_MIN_PX = 0.8;

/** HeartArt composable gradient stops (L87). */
export const HEART_GRADIENT_STOPS = `${ART_TOP}, ${ART_MID}, ${ART_BOTTOM}`;

/** Exposed for the composable so the palette stays single-sourced. */
export const HeartPalette = { top: ART_TOP, mid: ART_MID, bottom: ART_BOTTOM } as const;

/* ═══════════════════════════════════════════════════════════════════════
 * FavoriteHeart.kt — animation / haptics token passthrough
 * ═══════════════════════════════════════════════════════════════════════ */

/** FavoriteHeart.kt L90 / L99 / L103 — tween durations. */
export const FAV_FILL_MS = 260;
export const FAV_FILL_MS_REDUCE = 100;
export const FAV_UNFILL_MS = 180;
export const FAV_UNFILL_MS_REDUCE = 100;
export const FAV_SCALE_IN_MS = 120;
export const FAV_SCALE_OUT_MS = 110;
export const FAV_PRESS_MS = 110;
export const FAV_PRESS_SCALE = 0.94;

/** FavoriteHeart.kt L110 — `AppMotion.PARTICLE_MS`. */
export const FAV_PARTICLE_MS = 600;

/** FavoriteHeart.kt L244 — `val count = 7` in HeartBurst. */
export const FAV_BURST_COUNT = 7;

/** FavoriteHeart.kt default strings (L73, L151–152). */
export const FAV_DISABLED_HINT = '这本书没有来源信息，无法加入「我喜欢的」';
export const FAV_ARIA_ON = '已喜欢，点击取消喜欢';
export const FAV_ARIA_OFF = '喜欢，加入我喜欢的';

/* ═══════════════════════════════════════════════════════════════════════
 * FavoritesPanel.kt / FavoriteCard.kt visual constants
 * ═══════════════════════════════════════════════════════════════════════ */

/** FavoriteCard.kt L267, L363, L372, L383, L395, L424, L427. */
export const FAV_UPDATE_BADGE_COLOR = '#FF4D4F';
export const FAV_UNREAD_BADGE_INK = 'rgba(0, 0, 0, 0.55)';
export const FAV_SOURCE_TAG_INK = 'rgba(0, 0, 0, 0.5)';
export const FAV_DEAD_ICON_COLOR = '#FFD166';
export const FAV_DEAD_ICON_INK = 'rgba(0, 0, 0, 0.45)';
export const FAV_CARD_DIM_ALPHA = 0.85;

/** FavoriteCard.kt L291–300 — animation spec labels, kept for parity with Compose. */
export const FAV_CARD_DIM_LABEL = 'fav_card_dim';
export const FAV_CARD_PRESS_LABEL = 'fav_card_press';
export const FAV_CARD_PRESS_SCALE = 0.97;
export const FAV_CARD_FALLBACK_PRESS_SCALE = 0.94;

/** FavoritesPanel.kt L116 — `enum class FavoriteSort` labels live in FAVORITE_SORT_LABELS. */

/** ShelfSegmentedTabs.kt-free: the segmented tab labels (FavoritesPanel.kt L515/521). */
export const SHELF_SEGMENT_BOOK = '我的书架';
export const SHELF_SEGMENT_FAV = '我喜欢的';

/** Re-exported so UI files import one module. */
export type { FavoriteEntity, FavoriteItem, ComicProgressEntity };
export { ChapterReadState, FAV_DEFAULT_CATEGORY, ALL_FAV_CATEGORY_NAME };

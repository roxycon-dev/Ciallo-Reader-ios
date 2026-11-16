/**
 * MainViewModel — 逐行移植 Android `com/example/MainViewModel.kt`（1107 行）。
 *
 * Android 的 `AndroidViewModel` 是全 App 的唯一状态中枢：
 * 神回流、收藏三态解耦、阅读进度防抖、隐私模式、全局偏好、阅读器懒加载章节。
 * Web 侧对应物 = zustand store（`src/ui/state/appStore.ts`）+ 本文件的纯逻辑部分。
 *
 * 本文件只放**无 React / 无 DOM** 的可移植逻辑：
 *  - 神回增删
 *  - 「我喜欢的」三态解耦 + 收藏队列（并发串行化）
 *  - 漫画进度 400ms 防抖 / 强制落库
 *  - 收藏分类 CRUD / 移动
 *  - 隐私模式：无痕判定、解锁集合、分类保护开关
 *  - 阅读时长累计：todayReadSeconds / streakDays / 切片写库
 *  - 阅读器懒加载：逻辑章节 ↔ 物理章节映射、书签/高亮重映射、300ms 全文检索防抖
 *  - 多选删除 8 秒撤销窗口
 *
 * 端口与已存在的模块对接（先读、复用，不要重复实现）：
 *  - `@core/data/chapterMerger`（buildLogicalChapters / cleanSplitTitle / LogicalChapterBook）
 *  - `@core/data/readingTimeSlices`（ReadingTimeSlices.split）
 *  - `@core/data/searchLocator`（countOccurrences / buildResults / MAX_RESULTS）
 *  - `@core/data/contentMutationGate`（epoch）
 *  - `@core/library/bookRepository`（BookRepository / ProgressSaveCoordinator）
 *  - `@core/library/favoriteRepository`（FavoriteRepository）
 *  - `@core/library/favoriteTypes`（ComicKey / favoriteKey / FavoriteItem / FAV_DEFAULT_CATEGORY）
 *  - `@core/library/comicFavoriteMatching`（ComicFavoriteMatching.candidates）
 *  - `@core/library/comicReadingLogic`
 *  - `@core/privacy/pinKdf`（PrivacyManager 等价）
 *  - `@core/settings/settingsRepository`（PreferencesManager 等价）
 *
 * 平台适配：
 *  - `viewModelScope.launch(Dispatchers.IO)` → 直接调async 函数（JS 单线程，无需切线程）
 *  - `SharingStarted.WhileSubscribed(5000)` → 惰性水合 + listener registry
 *  - `withTimeout` → `Promise.race` 超时包装（`withTimeoutMs`）
 *  - `SimpleDateFormat("yyyy-MM-dd", Locale.US)` → 本地 `formatDateKey`
 */

import { buildLogicalChapters, cleanSplitTitle, type LogicalChapterBook } from '@core/data/chapterMerger';
import { ReadingTimeSlices } from '@core/data/readingTimeSlices';
import { SearchLocator, type SearchResultItem } from '@core/data/searchLocator';
import { ContentMutationGate } from '@core/data/contentMutationGate';
import type { BookRepository } from '@core/library/bookRepository';
import type { Bookmark, ChapterRow } from '@core/library/bookTypes';
// Android `Book.kt` 里实体就叫 `Highlight`；本项目按行存放改名 HighlightRow，
// 语义完全一致（这里是本文件唯一使用点，做一次别名即可）。
import type { HighlightRow as Highlight } from '@core/library/readingSessionTypes';
import type { FavoriteRepository } from '@core/library/favoriteRepository';
import {
  favoriteKey,
  FAV_DEFAULT_CATEGORY,
  type FavoriteAddRequest,
  type FavoriteEntity,
  type FavoriteItem,
} from '@core/library/favoriteTypes';
import { candidates as comicFavoriteCandidates } from '@core/library/comicFavoriteMatching';
import type { PrivacyManager } from '@core/privacy/pinKdf';
import type { PreferencesManager } from '@core/settings/settingsRepository';
import type { ComicChapter } from '@core/source/comicChapter';
import type { SearchBook } from '@core/source/searchBook';
import {
  compact as titleCompact,
  normalize as titleNormalize,
} from '@core/data/titleNormalizer';
import { withComicDetail } from '@core/source/comicInfo';



/** 阅读会话行（bookRepository 的 `ReadingSessionRow`）。 */
export interface ReadingSessionRowLike {
  bookId: number | null;
  bookTitle: string;
  dateStr: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  startHour: number;
}

/** 默认分类名（Book.kt DEFAULT_CATEGORY）。 */
export const DEFAULT_CATEGORY = '默认';
/** 旧聚合词，导入时归一为「默认」（MainViewModel L759）。 */
const LEGACY_CATEGORY_WORDS = ['全部', '未分类'];

/** SimpleDateFormat("yyyy-MM-dd", Locale.US) 等价。 */
export function formatDateKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Promise 超时（kotlinx.coroutines.withTimeout 等价）。 */
export function withTimeoutMs<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** withTimeoutOrNull：超时返回 null，不抛。 */
export async function withTimeoutOrNull<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await withTimeoutMs(promise, ms, 'timeout');
  } catch {
    return null;
  }
}

/* ══════════════ 依赖装配（L21-69） ══════════════ */

/**
 * 导入的三态结果（Kotlin `MainViewModel.kt` L757-776 的 `Result` + catch）。
 * `thrown: true` 对应 `catch (t: Throwable)` 分支 —— 文案是「导入出错」而不是「导入失败」，
 * 且未知异常时的兜底文案也不同（`发生未知异常` vs `未知错误`）。
 */
export type ImportOutcome =
  | { readonly ok: true; readonly book: BookLike }
  | { readonly ok: false; readonly error: unknown; readonly thrown?: false }
  | { readonly ok: false; readonly error: unknown; readonly thrown: true };

/** Kotlin L771 `导入失败: ${…}`。 */
export function importFailureMessage(error: unknown): string {
  return `导入失败: ${error instanceof Error ? error.message : '未知错误'}`;
}

/** Kotlin L775 `导入出错: ${…}`，兜底文案 `发生未知异常`。 */
export function importThrowMessage(error: unknown): string {
  return `导入出错: ${error instanceof Error ? error.message : '发生未知异常'}`;
}

/** Kotlin L768 `《${finalBook.title}》 导入成功`（`》` 与 `导入` 之间有一个半角空格）。 */
export function importSuccessMessage(title: string): string {
  return `《${title}》 导入成功`;
}

export interface MainViewModelDeps {
  repository: BookRepository;
  favoriteRepository: FavoriteRepository;
  prefs: PreferencesManager;
  privacy: PrivacyManager;
  /** 收藏需要书源实例（快照补齐作者/封面）；未就绪时为 null。 */
  comicSourceProvider?: ((sourceId: string) => Promise<ComicChapterSource | null>) | undefined;
  /** AniList 标题 → mediaId 查找（换源候选匹配用）。 */
  findAniListMediaIds?: ((normalized: string, compact: string) => Promise<number[]>) | undefined;
  /** AniList mediaId → 原始标题列表。 */
  getAniListRawTitles?: ((mediaIds: number[]) => Promise<string[]>) | undefined;
}

/** 漫画书源最小接口（MainViewModel 用到的 getChapters / getDetail / isComicSource）。 */
export interface ComicChapterSource {
  isComicSource: boolean;
  getChapters(comicId: string): Promise<ComicChapter[]>;
  getDetail(comicId: string): Promise<SearchBook>;
}

/**
 * Kotlin `MainViewModel.kt` L182 `throw IllegalStateException("新来源暂不可用，请稍后重试")`
 * —— `source?.getChapters(...)` 返回 `null`（没有漫画源实例）时抛的文案，逐字照抄。
 */
export const FAVORITE_SOURCE_UNAVAILABLE = '新来源暂不可用，请稍后重试';

/**
 * Kotlin `MainViewModel.kt` L179 `withTimeout(30_000)` 的时长（换源后重取章节列表）。
 */
export const FAVORITE_CHAPTERS_TIMEOUT_MS = 30_000;

/**
 * Kotlin `MainViewModel.kt` L185 `withTimeoutOrNull(15_000) { source?.getDetail(...) }` 的时长。
 * 取详情只是补作者/封面，超时**不**报错（返回 null 就沿用旧快照）。
 */
export const FAVORITE_DETAIL_TIMEOUT_MS = 15_000;

/**
 * Kotlin `MainViewModel.kt` L185-186 — 换源确认后用新源的详情补齐旧快照，
 * 成功才 `book.withComicDetail(detail)`；超时 / 失败 / 无详情一律沿用原 `book`。
 */
export async function refreshBookWithDetail(
  book: SearchBook,
  source: ComicChapterSource | null,
): Promise<SearchBook> {
  if (source === null) return book;
  const detail = await withTimeoutOrNull(source.getDetail(book.id), FAVORITE_DETAIL_TIMEOUT_MS);
  return detail === null ? book : withComicDetail(book, detail);
}

/* ══════════════ 神回（L31-52） ══════════════ */

export interface GodMomentEntity {
  id: number;
  bookId: string;
  chapterId: string;
  rating: number;
  note: string;
}

export interface GodRepositoryLike {
  delete(id: number): Promise<void>;
  observeAll(): Promise<GodMomentEntity[]>;
}

/* ══════════════ 状态（L94-205 收藏 / L242-344 进度 / L346-1019 隐私偏好） ══════════════ */

interface QueuedFavorite {
  book: SearchBook;
  category: string;
  chapters: ComicChapter[];
}

export interface MainViewModelState {
  godMoments: GodMomentEntity[];
  favoriteItems: FavoriteItem[];
  favoriteKeys: Set<string>;
  favorites: FavoriteEntity[];
  favoriteAddRequest: FavoriteAddRequest | null;
  favoriteActionMessage: string | null;
  privacyModeEnabled: boolean;
  protectedCategoryNames: Set<string>;
  unlockedCategoryIds: Set<number>;
  incognitoBrowsingEnabled: boolean;
  favoritesProtected: boolean;
  autoNightMode: boolean;
  blueLightFilter: boolean;
  blueLightAlpha: number;
  screenOrientationLock: number;
  hapticsEnabled: boolean;
  colorPrimaryIndex: number;
  colorSecondaryIndex: number;
  renderQuality: number;
  totalReadTimeSeconds: number;
  todayReadSeconds: number;
  streakDays: number;
}

/** 书架书籍（MainViewModel 只需要这几项做封面/漫画判定与统计归属）。 */
export interface BookLike {
  id: number;
  title: string;
  category: string;
  coverUri?: string | null;
  isComic?: boolean;
  sourceId?: string | null;
  comicId?: string | null;
  currentChapterIndex?: number;
  scrollOffset?: number;
}

/**
 * 收藏 + 进度 + 已下载章节数的聚合（MainViewModel L79-92 `favoriteItems`）。
 * 已下载话数用 sourceId/comicId 反查本地 books（一个已下载章节 = 一本本地漫画）。
 */
export function aggregateFavoriteItems(
  favorites: readonly FavoriteEntity[],
  progressByKey: ReadonlyMap<string, FavoriteItem['progress']>,
  books: readonly BookLike[],
): FavoriteItem[] {
  const downloadedByKey = new Map<string, number>();
  for (const book of books) {
    if (
      book.isComic === true &&
      typeof book.sourceId === 'string' &&
      book.sourceId.trim() !== '' &&
      typeof book.comicId === 'string' &&
      book.comicId.trim() !== ''
    ) {
      const key = favoriteKey(book.sourceId, book.comicId);
      downloadedByKey.set(key, (downloadedByKey.get(key) ?? 0) + 1);
    }
  }
  return favorites.map((fav) => ({
    favorite: fav,
    progress: progressByKey.get(favoriteKey(fav.sourceId, fav.comicId)) ?? null,
    downloadedChapters: downloadedByKey.get(favoriteKey(fav.sourceId, fav.comicId)) ?? 0,
  }));
}

/**
 * 无痕浏览判定（MainViewModel L994-999）。
 * - 全局无痕开关开启 → 一切阅读不计统计；
 * - 否则：隐私模式开启 且 当前书所在分类受保护 → 不计统计。
 * 两种口径都只作用于统计/会话写入，阅读进度保存链路不受影响。
 */
export function isIncognitoReading(
  incognitoBrowsingEnabled: boolean,
  privacyModeEnabled: boolean,
  protectedCategoryNames: ReadonlySet<string>,
  book: BookLike | null,
): boolean {
  if (incognitoBrowsingEnabled) return true;
  if (!privacyModeEnabled) return false;
  if (book === null) return false;
  return protectedCategoryNames.has(book.category);
}

/**
 * 导入分类归一（MainViewModel L758-759）：
 * 书籍单一归属真实分类；旧聚合词归一为「默认」。
 */
export function normalizeImportCategory(category: string): string {
  return LEGACY_CATEGORY_WORDS.includes(category) ? DEFAULT_CATEGORY : category;
}

/**
 * 记录时长的天数上界（MainViewModel L1027 `seconds.coerceAtMost(24*60*60)`）。
 */
export const MAX_RECORDED_SECONDS = 24 * 60 * 60;

/**
 * 一次 recordTime 的全部派生计算（MainViewModel L1021-1048）。
 * 返回切片与归一后的分类，便于测试。
 */
export function planRecordTime(
  seconds: number,
  endMs: number,
  book: BookLike | null,
  title: string | null,
  onlineBook: SearchBook | null,
): { recordTitle: string; slices: ReturnType<typeof ReadingTimeSlices.split> } {
  const bounded = Math.min(seconds, MAX_RECORDED_SECONDS);
  // currentBook 只在「没传 onlineBook」时为 null（MainViewModel L1024）
  const currentBook = onlineBook === null ? book : null;
  const recordTitle = currentBook?.title ?? title ?? '在线阅读';
  const slices = ReadingTimeSlices.split(endMs - bounded * 1000, endMs, bounded);
  return { recordTitle, slices };
}

/* ══════════════ 收藏队列（L94-205） ══════════════ */

export interface FavoriteQueueHost {
  state: MainViewModelState;
  deps: MainViewModelDeps;
  /** 内部：正在跑的收藏任务句柄（取消用）。 */
  activeJob: { cancel(): void } | null;
  queue: QueuedFavorite[];
  setState(patch: Partial<MainViewModelState>): void;
}

/**
 * 收藏队列串行化（MainViewModel L104-110、L150-153）：
 * 已有任务在跑或已有待确认请求时，把新请求入队；
 * 当前任务结束后 `processFavoriteAddQueue` 取下一个。
 */
export function shouldEnqueueFavorite(
  addJobActive: boolean,
  pendingRequest: FavoriteAddRequest | null,
  book: SearchBook,
  queue: readonly QueuedFavorite[],
): boolean {
  const key = favoriteKey(book.sourceId, book.id);
  const queued = (q: QueuedFavorite): boolean => favoriteKey(q.book.sourceId, q.book.id) === key;
  if (pendingRequest !== null) {
    // 待确认的是同一本 → 不重复入队；否则入队（与 Kotlin L105-109 一致）
    const pendingKey = pendingRequest.bookId;
    if (pendingKey === key) return false;
    return !queue.some(queued);
  }
  if (addJobActive) return !queue.some(queued);
  return false;
}

/** 取队首（L152 `favoriteAddQueue.poll()?.let { … }`）。 */
export function pollFavoriteQueue(queue: QueuedFavorite[]): QueuedFavorite | undefined {
  return queue.shift();
}

/**
 * 加入收藏（含换源候选检测）。
 * MainViewModel L112-144：非漫画源 / 已收藏 / 无其它来源 → 直接 add；
 * 否则查 AniList 标题匹配出候选，交给用户确认（FavoriteAddRequest）。
 */
export async function toggleFavoriteInner(
  book: SearchBook,
  next: boolean,
  category: string,
  chapters: ComicChapter[],
  deps: MainViewModelDeps,
  existingFavorites: readonly FavoriteEntity[],
): Promise<{ added: boolean; request: FavoriteAddRequest | null; message: string | null }> {
  if (!next) {
    await deps.favoriteRepository.remove(book.sourceId, book.id);
    return { added: false, request: null, message: null };
  }
  const source =
    deps.comicSourceProvider === undefined
      ? null
      : await deps.comicSourceProvider(book.sourceId);
  if (source === null || !source.isComicSource) {
    await deps.favoriteRepository.add(book, category, chapters);
    return { added: true, request: null, message: null };
  }
  if (await deps.favoriteRepository.isFavorite(book.sourceId, book.id)) {
    await deps.favoriteRepository.add(book, category, chapters);
    return { added: true, request: null, message: null };
  }
  const existing = existingFavorites.filter((f) => f.sourceId !== book.sourceId);
  if (existing.length === 0) {
    await deps.favoriteRepository.add(book, category, chapters);
    return { added: true, request: null, message: null };
  }
  // 标题集合 = 主标题 + 副标题
  const titles = [book.title, ...(book.comicInfo?.alternateTitles ?? [])];
  let mediaIds: number[] = [];
  if (deps.findAniListMediaIds !== undefined) {
    for (const title of titles) {
      const found = await deps.findAniListMediaIds(
        normalizeAniListTitle(title),
        compactAniListTitle(title),
      );
      mediaIds = mediaIds.concat(found);
    }
    mediaIds = Array.from(new Set(mediaIds));
  }
  const aliases =
    mediaIds.length === 1 && deps.getAniListRawTitles !== undefined
      ? await deps.getAniListRawTitles(mediaIds)
      : [];
  const dupCandidates = comicFavoriteCandidates(book, existing, aliases);
  if (dupCandidates.length === 0) {
    await deps.favoriteRepository.add(book, category, chapters);
    return { added: true, request: null, message: null };
  }
  return {
    added: false,
    request: {
      bookId: favoriteKey(book.sourceId, book.id),
      sourceId: book.sourceId,
      title: book.title,
      author: book.author,
      cover: book.cover,
      category,
      chapters,
      favorites: existing,
      candidates: dupCandidates,
      busy: false,
      error: null,
    },
    message: null,
  };
}

/**
 * TitleNormalizer 复用（`src/core/data/titleNormalizer.ts`，←Android TitleNormalizer.kt）：
 * NFKC + 小写 + 标点转空格 + 繁简折叠 + 压缩空白。
 * 这里不重复实现，直接转出，语义与书源搜索排名完全一致。
 */
export function normalizeAniListTitle(title: string): string {
  return titleNormalize(title);
}

export function compactAniListTitle(title: string): string {
  return titleCompact(title);
}

/**
 * 确认「替换收藏」的文案（MainViewModel L190-194）。
 * 迁移话数 + 未匹配提示 + 续读说明，逐字照抄。
 */
export function buildReplaceFavoriteMessage(report: {
  migrated: number;
  unmatched: number;
  resumeMatched: boolean;
}): string {
  let out = `已替换收藏，迁移 ${report.migrated} 话阅读标记与书签`;
  if (report.unmatched > 0 || !report.resumeMatched) out += '；未匹配记录仍保留在旧来源';
  out += '。新版本从对应话的第一页续读';
  return out;
}

/* ══════════════ 阅读进度（L242-280） ══════════════ */

export interface ComicProgressInput {
  sourceId: string;
  comicId: string;
  chapterId: string;
  chapterIndex: number;
  pageIndex: number;
  pageCount: number;
}

export const PROGRESS_DEBOUNCE_MS = 400;

/** 空 id 直接忽略（L260）。 */
export function isValidComicProgress(p: ComicProgressInput): boolean {
  return p.sourceId.trim() !== '' && p.comicId.trim() !== '' && p.chapterId.trim() !== '';
}

/* ══════════════ 隐私模式（L944-999） ══════════════ */

export const PIN_LENGTH = 6;

/** isValidPin 等价：纯数字且长度正确。 */
export function isValidPin(pin: string): boolean {
  return /^\d{6}$/u.test(pin);
}

/**
 * 受保护分类名集合（MainViewModel L360-362）：
 * 分类流里 `isProtected === true` 的名字。
 */
export function collectProtectedCategoryNames(
  categories: ReadonlyArray<{ name: string; isProtected: boolean }>,
): Set<string> {
  const out = new Set<string>();
  for (const c of categories) {
    if (c.isProtected) out.add(c.name);
  }
  return out;
}

/* ══════════════ 阅读器懒加载章节（L548-743） ══════════════ */

export interface ReaderSelectionState {
  selectedBook: BookLike | null;
  chapters: ChapterRow[];
  loadedChapterIndices: Set<number>;
  readerLoading: boolean;
  readerLoadError: string | null;
  bookmarks: Bookmark[];
  highlights: Highlight[];
  searchResults: SearchResultItem[];
  isSearching: boolean;
  /** 与 Android 私有字段同构。 */
  cachedMetadataList: ChapterRow[];
  chapterMapping: LogicalChapterBook | null;
  lastLoadedBookId: number | null;
  lastLoadedChapterIndex: number | null;
  selectedSourceBook: BookLike | null;
}

export function createReaderSelectionState(): ReaderSelectionState {
  return {
    selectedBook: null,
    chapters: [],
    loadedChapterIndices: new Set<number>(),
    readerLoading: false,
    readerLoadError: null,
    bookmarks: [],
    highlights: [],
    searchResults: [],
    isSearching: false,
    cachedMetadataList: [],
    chapterMapping: null,
    lastLoadedBookId: null,
    lastLoadedChapterIndex: null,
    selectedSourceBook: null,
  };
}

/**
 * 目标逻辑章节集合（L559-560）：当前章 ± 1，裁剪到有效范围。
 */
export function activeLogicalWindow(currentLogicalIdx: number, size: number): number[] {
  return [currentLogicalIdx - 1, currentLogicalIdx, currentLogicalIdx + 1].filter(
    (i) => i >= 0 && i < size,
  );
}

/** 目标物理 order 集合（L562-564）：展平 + 去重。 */
export function activePhysicalOrders(
  targetLogical: readonly number[],
  mapping: LogicalChapterBook,
): number[] {
  const orders: number[] = [];
  for (const li of targetLogical) {
    orders.push(...(mapping.logicalToPhysicalOrders[li] ?? []));
  }
  return Array.from(new Set(orders));
}

/**
 * 把物理章节正文按逻辑章节合并（L566-581）。
 * 只填充 targetLogical 内的章节，其余原样保留。
 */
export function mergeActiveChapterContent(
  metadata: readonly ChapterRow[],
  targetLogical: readonly number[],
  mapping: LogicalChapterBook,
  activeParts: ReadonlyMap<number, ChapterRow>,
): ChapterRow[] {
  return metadata.map((chapter, logicalIdx) => {
    if (!targetLogical.includes(logicalIdx)) return chapter;
    const parts = (mapping.logicalToPhysicalOrders[logicalIdx] ?? [])
      .map((order) => activeParts.get(order))
      .filter((row): row is ChapterRow => row !== undefined);
    if (parts.length === 0) return chapter;
    return { ...chapter, content: parts.map((p) => p.content).join('') };
  });
}

/** 逻辑起始章定位（L665-673）。 */
export function resolveLogicalStart(
  mapping: LogicalChapterBook,
  physicalStart: number,
  scrollOffset: number,
): { logicalStart: number; logicalOffset: number } {
  const lastIndex = mapping.chapters.length - 1;
  const clamped = Math.max(0, physicalStart);
  const logicalStart = Math.min(Math.max(mapping.logicalIndexOf(clamped), 0), Math.max(lastIndex, 0));
  const logicalOffset = mapping.logicalOffsetOf(clamped, scrollOffset);
  return { logicalStart, logicalOffset };
}

/**
 * 书签重映射到逻辑坐标（L713-727）。
 * 已经在逻辑坐标且标题干净 → 原样；否则换算索引/偏移并清洗标题。
 */
export function remapBookmarks(
  bookmarks: readonly Bookmark[],
  mapping: LogicalChapterBook | null,
): Bookmark[] {
  if (mapping === null) return [...bookmarks];
  return bookmarks.map((bm) => {
    const li = mapping.logicalIndexOf(bm.chapterIndex);
    const off = mapping.logicalOffsetOf(bm.chapterIndex, bm.scrollOffset);
    if (li === bm.chapterIndex && off === bm.scrollOffset) {
      const cleanTitle = cleanSplitTitle(bm.title);
      return cleanTitle === bm.title ? bm : { ...bm, title: cleanTitle };
    }
    return { ...bm, chapterIndex: li, scrollOffset: off, title: cleanSplitTitle(bm.title) };
  });
}

/** 高亮重映射到逻辑章索引（L731-740）。 */
export function remapHighlights(
  highlights: readonly Highlight[],
  mapping: LogicalChapterBook | null,
): Highlight[] {
  if (mapping === null) return [...highlights];
  return highlights.map((h) => {
    const li = mapping.logicalIndexOf(h.chapterIndex);
    return li === h.chapterIndex ? h : { ...h, chapterIndex: li };
  });
}

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * 全文检索分批推进（L1072-1084）：
 * 逐批 `searchChaptersBatch`，按出现次数累加，达到 MAX_RESULTS 即停。
 */
export function accumulateSearchMatches(
  batch: readonly ChapterRow[],
  query: string,
  currentCount: number,
): { matches: ChapterRow[]; count: number; reached: boolean } {
  const matches: ChapterRow[] = [];
  let count = currentCount;
  for (const chapter of batch) {
    matches.push(chapter);
    count += SearchLocator.countOccurrences(chapter.content, query);
    if (count >= SearchLocator.MAX_RESULTS) {
      return { matches, count, reached: true };
    }
  }
  return { matches, count, reached: false };
}

/** 用 SearchLocator.buildResults 生成结果（L1085-1087）。 */
export function buildSearchResults(
  matches: readonly ChapterRow[],
  query: string,
  mapping: LogicalChapterBook | null,
): SearchResultItem[] {
  return SearchLocator.buildResults(
    matches as unknown as Array<{ chapterOrder: number; title: string; content: string }>,
    query,
    (order: number) => (mapping === null ? order : mapping.logicalIndexOf(order)),
    (idx: number) => mapping?.chapters[idx]?.title ?? null,
  );
}

/* ══════════════ 多选删除 8 秒撤销（L808-835） ══════════════ */

export const DELETE_UNDO_WINDOW_MS = 8000;

/**
 * 撤销窗口令牌表（MainViewModel L813-828）。
 * 每批一个独立 token；8 秒后仍在表里才真正落盘删除。
 */
export class DeletionUndoWindow {
  private readonly tokens = new Set<string>();

  schedule(token: string, delayMs: number = DELETE_UNDO_WINDOW_MS): Promise<boolean> {
    this.tokens.add(token);
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(this.tokens.delete(token));
      }, delayMs);
    });
  }

  cancel(token: string): boolean {
    return this.tokens.delete(token);
  }

  has(token: string): boolean {
    return this.tokens.has(token);
  }
}

/* ══════════════ 书签 / 高亮 / 分类（L862-942） ══════════════ */

/**
 * 书签去重键（L864 / L882）：
 * `(bookId == 本书 || bookId == 0) && chapterIndex == X`。
 */
export function findExistingBookmark(
  bookmarks: readonly Bookmark[],
  bookId: number,
  chapterIndex: number,
): Bookmark | undefined {
  return bookmarks.find(
    (b) => (b.bookId === bookId || b.bookId === 0) && b.chapterIndex === chapterIndex,
  );
}

/** 逻辑 → 物理索引换算（L866）。 */
export function toPhysicalIndex(
  mapping: LogicalChapterBook | null,
  logicalIndex: number,
): number {
  return mapping === null ? logicalIndex : mapping.physicalIndexFor(logicalIndex);
}

/** 删除分类：默认分类不可删（L937-941 / 第七轮 6.1 条）。 */
export const UNDELETABLE_CATEGORY = DEFAULT_CATEGORY;

/* ══════════════ MainViewModel 主体（编排层） ══════════════ */

/** 状态变更订阅（对应 Kotlin StateFlow 的 collect 端）。 */
export type StateListener = (state: MainViewModelState) => void;

/**
 * MainViewModel — 对应 Android `MainViewModel.kt` 的可执行部分。
 *
 * Android 用 `viewModelScope.launch(Dispatchers.IO)`；JS 单线程不需要切线程，
 * 所以每个方法直接是 async。`MutableStateFlow` → `MainViewModelState` + 监听器。
 * 逐项保留 Kotlin 的并发语义：
 *  - 收藏队列串行化（toggleFavorite / processFavoriteAddQueue）
 *  - 400ms 进度防抖（saveComicProgress / updateProgress）
 *  - 300ms 检索防抖（searchFullText）
 *  - 8 秒删除撤销（scheduleBooksDeletion）
 *  - init 的五项启动任务（L451-469）
 */
export class MainViewModel {
  readonly deps: MainViewModelDeps;

  private stateValue: MainViewModelState;

  private readonly listeners = new Set<StateListener>();

  /** 与 Kotlin `favoriteAddJob` 对应（可取消句柄）。 */
  private favoriteAddJob: AbortController | null = null;
  private readonly favoriteAddQueue: QueuedFavorite[] = [];

  /** 与 Kotlin `progressSaveJob` 对应。 */
  private progressSaveJob: AbortController | null = null;

  /** 与 Kotlin `searchJob` 对应。 */
  private searchJob: AbortController | null = null;

  /** 与 Kotlin `readerSelectionToken` 对应：切书自增，令旧异步结果作废。 */
  private readerSelectionToken = 0;
  private readonly readerJobs = new Set<AbortController>();

  /** 与 Kotlin `progressSaveJobs` 对应（按 bookId 分桶）。 */
  private readonly progressSaveJobs = new Map<number, AbortController>();

  /** 与 Kotlin `pendingDeleteTokens` / `deletionScope` 对应。 */
  readonly deletionUndo = new DeletionUndoWindow();

  /** 与 Kotlin `coverValidCache` 对应。 */
  readonly coverValidCache = new Map<string, boolean>();

  /** 与 Kotlin `readerSelectionState` 私有字段对应。 */
  reader: ReaderSelectionState = createReaderSelectionState();

  /** 与 Kotlin `readingTimeMutex` 对应：串行链。 */
  private readingTimeMutex: Promise<unknown> = Promise.resolve();

  /** 与 Kotlin `_importStatusMessage` 对应。 */
  importStatusMessage: string | null = null;

  constructor(deps: MainViewModelDeps) {
    this.deps = deps;
    /**
     * 2026-10-06 修正（逐行对照 `PreferencesManager.kt` 的 `get…(key, default)`）：
     * Kotlin 每个偏好都是 `MutableStateFlow(prefs.x)`，构造出来就已经是**出厂值**，
     * 不存在「先 false、init() 之后才变真」的时间窗。原来的初值把一批字段写成了
     * 0 / false / true-happy-default，与出厂值不符：
     *   colorPrimaryIndex  0  → 2（PreferencesManager L201 `color_primary_index`, 2）
     *   colorSecondaryIndex 0 → 2（L205）
     *   renderQuality      0  → 2（L210 `render_quality`, 2 = HIGH）
     *   blueLightAlpha     0  → 0.15（L91 `blue_light_alpha`, 0.15f）
     * 其余（autoNightMode false / blueLightFilter false / screenOrientationLock 0 /
     * hapticsEnabled true / incognitoBrowsingEnabled false / favoritesProtected false /
     * privacyModeEnabled false / totalReadTimeSeconds 0 / todayReadSeconds 0 /
     * streakDays 0）本来就与出厂值一致，未改。
     */
    this.stateValue = {
      godMoments: [],
      favoriteItems: [],
      favoriteKeys: new Set<string>(),
      favorites: [],
      favoriteAddRequest: null,
      favoriteActionMessage: null,
      privacyModeEnabled: false,
      protectedCategoryNames: new Set<string>(),
      unlockedCategoryIds: new Set<number>(),
      incognitoBrowsingEnabled: false,
      favoritesProtected: false,
      autoNightMode: false,
      blueLightFilter: false,
      blueLightAlpha: 0.15,
      screenOrientationLock: 0,
      hapticsEnabled: true,
      colorPrimaryIndex: 2,
      colorSecondaryIndex: 2,
      renderQuality: 2,
      totalReadTimeSeconds: 0,
      todayReadSeconds: 0,
      streakDays: 0,
    };
  }

  /* ── 状态读写 ── */

  get state(): MainViewModelState {
    return this.stateValue;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 测试/启动用：直接置位隐私模式（生产路径走 enablePrivacyMode）。 */
  setStatePrivacyOn(): void {
    this.setState({ privacyModeEnabled: true });
  }

  protected setState(patch: Partial<MainViewModelState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    for (const listener of this.listeners) listener(this.stateValue);
  }

  /* ══════ init（L451-469） ══════ */

  /**
   * 启动任务（L451-469）逐项照抄：
   * 1. checkAndSeedDefaultBooks 2. ensureDefaultCategory
   * 3. splitOversizedChaptersInLibrary + cleanupOrphanFiles 4. calculateStreak
   * 并把 prefs 里已持久化的偏好灌进 state（Kotlin 靠 `MutableStateFlow(prefs.x)`）。
   * ZLibraryDns.watchNetwork 由 source/zlibrary 模块自行订阅（Android 侧同）。
   */
  async init(): Promise<void> {
    const prefs = this.deps.prefs;
    const repo = this.deps.repository;
    this.setState({
      privacyModeEnabled: await this.deps.privacy.isEnabled(),
      incognitoBrowsingEnabled: await prefs.incognitoBrowsingEnabled(),
      favoritesProtected: await prefs.favoritesProtected(),
      autoNightMode: await prefs.autoNightMode(),
      blueLightFilter: await prefs.blueLightFilter(),
      blueLightAlpha: await prefs.blueLightAlpha(),
      screenOrientationLock: await prefs.screenOrientationLock(),
      hapticsEnabled: await prefs.hapticsEnabled(),
      colorPrimaryIndex: await prefs.colorPrimaryIndex(),
      colorSecondaryIndex: await prefs.colorSecondaryIndex(),
      renderQuality: await prefs.renderQuality(),
      totalReadTimeSeconds: await prefs.totalReadTimeSeconds(),
      todayReadSeconds: await prefs.getDailyReadTime(formatDateKey(Date.now())),
    });
    await repo.checkAndSeedDefaultBooks();
    await repo.ensureDefaultCategory();
    await repo.splitOversizedChaptersInLibrary();
    await repo.cleanupOrphanFiles();
    this.setState({ streakDays: await prefs.calculateStreak() });
  }

  /* ══════ 神回（L45-52） ══════ */

  /** 神回流（L45-47 `WhileSubscribed` 语义 → 首次订阅时才查库）。 */
  async loadGodMoments(godRepository: GodRepositoryLike): Promise<void> {
    this.setState({ godMoments: await godRepository.observeAll() });
  }

  /** 删除单个神回（L50-52）。 */
  async deleteGodMoment(godRepository: GodRepositoryLike, moment: GodMomentEntity): Promise<void> {
    await godRepository.delete(moment.id);
    this.setState({ godMoments: this.stateValue.godMoments.filter((m) => m.id !== moment.id) });
  }

  /* ══════ 收藏（L94-240） ══════ */

  /** 刷新收藏聚合流（L70-92）。 */
  async loadFavorites(books: readonly BookLike[]): Promise<void> {
    const fav = this.deps.favoriteRepository;
    const [favorites, progressByKey, keys] = await Promise.all([
      fav.favorites(),
      fav.progressByKey(),
      fav.favoriteKeys(),
    ]);
    this.setState({
      favorites,
      favoriteKeys: keys,
      favoriteItems: aggregateFavoriteItems(favorites, progressByKey, books),
    });
  }

  /**
   * 加入收藏（L94-145）。
   * 非漫画源 / 已收藏 / 无其它来源 → 直接 add；
   * 否则检测到重复候选 → 挂起等用户确认。
   */
  toggleFavorite(
    book: SearchBook,
    next: boolean,
    category: string = FAV_DEFAULT_CATEGORY,
    chapters: ComicChapter[] = [],
  ): void {
    if (!next) {
      void this.deps.favoriteRepository.remove(book.sourceId, book.id);
      return;
    }
    const addJobActive = this.favoriteAddJob !== null;
    if (addJobActive || this.stateValue.favoriteAddRequest !== null) {
      if (
        shouldEnqueueFavorite(
          addJobActive,
          this.stateValue.favoriteAddRequest,
          book,
          this.favoriteAddQueue,
        )
      ) {
        this.favoriteAddQueue.push({ book, category, chapters });
      }
      return;
    }
    this.runFavoriteAdd(book, category, chapters);
  }

  /** 真正的收藏流程（L112-144）。 */
  private runFavoriteAdd(book: SearchBook, category: string, chapters: ComicChapter[]): void {
    const controller = new AbortController();
    this.favoriteAddJob = controller;
    void (async () => {
      try {
        const result = await toggleFavoriteInner(
          book,
          true,
          category,
          chapters,
          this.deps,
          this.stateValue.favorites,
        );
        if (controller.signal.aborted) return;
        if (result.request !== null) this.setState({ favoriteAddRequest: result.request });
        else if (result.added) this.setState({ favoriteActionMessage: '已收进「我喜欢的」♡' });
      } catch (error) {
        if (!controller.signal.aborted) {
          this.setState({
            favoriteActionMessage:
              error instanceof Error ? error.message : '收藏失败，请重试',
          });
        }
      } finally {
        if (this.favoriteAddJob === controller) this.favoriteAddJob = null;
        this.processFavoriteAddQueue();
      }
    })();
  }

  /** 队列推进（L150-153）。 */
  private processFavoriteAddQueue(): void {
    if (this.stateValue.favoriteAddRequest !== null || this.favoriteAddJob !== null) return;
    const next = pollFavoriteQueue(this.favoriteAddQueue);
    if (next !== undefined) this.runFavoriteAdd(next.book, next.category, next.chapters);
  }

  /** 清消息（L159）。 */
  clearFavoriteActionMessage(): void {
    this.setState({ favoriteActionMessage: null });
  }

  /** 取消待确认（L160-165）：busy 时不允许取消。 */
  dismissFavoriteAdd(): void {
    if (this.stateValue.favoriteAddRequest?.busy === true) return;
    this.favoriteAddJob?.abort();
    this.favoriteAddJob = null;
    this.setState({ favoriteAddRequest: null });
    this.processFavoriteAddQueue();
  }

  /** 确认收藏（L167-205）：`replace === null` 直接 add，否则换源替换 + 迁移文案。 */
  confirmFavoriteAdd(replace: FavoriteEntity | null): void {
    const request = this.stateValue.favoriteAddRequest;
    if (request === null || request.busy) return;
    this.setState({ favoriteAddRequest: { ...request, busy: true, error: null } });
    const comicId = request.bookId.split('::')[1] ?? request.bookId;
    const book = {
      sourceId: request.sourceId,
      id: comicId,
      title: request.title,
      author: request.author,
      cover: request.cover,
    } as SearchBook;
    const controller = new AbortController();
    this.favoriteAddJob = controller;
    void (async () => {
      try {
        if (replace === null) {
          await this.deps.favoriteRepository.add(book, request.category, request.chapters);
          this.setState({
            favoriteAddRequest: null,
            favoriteActionMessage: '已收进「我喜欢的」♡',
          });
        } else {
          const source =
            this.deps.comicSourceProvider === undefined
              ? null
              : await this.deps.comicSourceProvider(book.sourceId);
          /**
           * Kotlin L178-184：
           *   when (val r = source?.getChapters(book.id)) {
           *     is Success -> r.data
           *     is Error   -> throw IllegalStateException(result.exception.message)
           *     else       -> throw IllegalStateException("新来源暂不可用，请稍后重试")
           *   }
           * Web 侧 `getChapters` 不返回 Success/Error 包装：reject ≈ Error，
           * `source === null` ≈ else 分支。两条文案都补齐（此前只留了超时那一条）。
           */
          let chapters = request.chapters;
          if (chapters.length === 0) {
            if (source === null) {
              throw new Error(FAVORITE_SOURCE_UNAVAILABLE);
            }
            try {
              chapters = await withTimeoutMs(
                source.getChapters(book.id),
                FAVORITE_CHAPTERS_TIMEOUT_MS,
                '来源响应超时，旧收藏已保留，可重试或选择并存',
              );
            } catch (error) {
              if (error instanceof Error && error.message.includes('来源响应超时')) throw error;
              // 书源自身报错：Kotlin 抛的是 result.exception.message
              throw new Error(error instanceof Error ? error.message : String(error));
            }
          }
          /**
           * MISSING 修正：Kotlin L185-186
           *   val detail = withTimeoutOrNull(15_000) { source?.getDetail(book.id) }
           *   if (detail is SourceResult.Success) book = book.withComicDetail(detail.data)
           * 此前整个 getDetail/withComicDetail 步骤缺失 → 换源替换收藏后作者 / 封面 /
           * 简介 / 标签一直沿用旧来源的快照。新增 `refreshBookWithDetail()`。
           */
          const refreshed = await refreshBookWithDetail(book, source);
          const report = await this.deps.favoriteRepository.replaceFavorite(
            { sourceId: replace.sourceId, comicId: replace.comicId },
            refreshed,
            chapters,
          );
          this.setState({
            favoriteAddRequest: null,
            favoriteActionMessage: buildReplaceFavoriteMessage(report),
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const timedOut =
          error instanceof Error && error.message.includes('来源响应超时');
        this.setState({
          favoriteAddRequest: {
            ...request,
            busy: false,
            error: timedOut
              ? '来源响应超时，旧收藏已保留，可重试或选择并存'
              : error instanceof Error
                ? error.message
                : '操作失败，旧收藏已保留',
          },
        });
      } finally {
        if (this.favoriteAddJob === controller) this.favoriteAddJob = null;
        this.processFavoriteAddQueue();
      }
    })();
  }

  /* ══════ 收藏分类（L209-240） ══════ */

  async addFavoriteCategory(name: string): Promise<void> {
    await this.deps.favoriteRepository.addFavoriteCategory(name);
  }

  async renameFavoriteCategory(oldName: string, newName: string): Promise<void> {
    await this.deps.favoriteRepository.renameFavoriteCategory(oldName, newName);
  }

  async deleteFavoriteCategory(name: string): Promise<void> {
    await this.deps.favoriteRepository.deleteFavoriteCategory(name);
  }

  async moveFavoritesToCategory(keys: string[], category: string): Promise<void> {
    await this.deps.favoriteRepository.moveToCategory(keys, category);
  }

  async removeFavorites(keys: string[]): Promise<void> {
    await this.deps.favoriteRepository.removeByKeys(keys);
  }

  /* ══════ 漫画进度（L251-280） ══════ */

  /**
   * 保存漫画阅读进度。翻页时调用（自动防抖 400ms）；
   * 退出阅读器 / 进入后台时用 `force = true` 立刻落库（L251-280）。
   */
  saveComicProgress(input: ComicProgressInput, force = false): void {
    if (!isValidComicProgress(input)) return;
    this.progressSaveJob?.abort();
    const write = (): Promise<void> =>
      this.deps.favoriteRepository.saveProgress(
        input.sourceId,
        input.comicId,
        input.chapterId,
        input.chapterIndex,
        input.pageIndex,
        input.pageCount,
      );
    if (force) {
      void write();
      return;
    }
    const controller = new AbortController();
    this.progressSaveJob = controller;
    setTimeout(() => {
      if (controller.signal.aborted) return;
      void write();
      if (this.progressSaveJob === controller) this.progressSaveJob = null;
    }, PROGRESS_DEBOUNCE_MS);
  }

  /* ══════ 章节书签 / 已读标记（L284-338） ══════ */

  async setChapterBookmark(
    sourceId: string,
    comicId: string,
    chapterId: string,
    chapterIndex: number,
    bookmarked: boolean,
  ): Promise<void> {
    await this.deps.favoriteRepository.setChapterBookmark(
      sourceId,
      comicId,
      chapterId,
      chapterIndex,
      bookmarked,
    );
  }

  async markComicSeen(
    sourceId: string,
    comicId: string,
    chapters: ComicChapter[],
  ): Promise<void> {
    await this.deps.favoriteRepository.markSeen(sourceId, comicId, chapters);
  }

  async markComicChapterRead(
    sourceId: string,
    comicId: string,
    chapterId: string,
    chapterIndex: number,
    read: boolean,
  ): Promise<void> {
    await this.deps.favoriteRepository.markChapter(
      sourceId,
      comicId,
      chapterId,
      chapterIndex,
      read,
    );
  }

  async markComicChaptersReadUpTo(
    sourceId: string,
    comicId: string,
    maxIndex: number,
  ): Promise<void> {
    await this.deps.favoriteRepository.markChaptersReadUpTo(sourceId, comicId, maxIndex);
  }

  /** 换源迁移（L324-338）：按「阅读序号」搬到新源的这本上。 */
  async migrateComic(
    fromSourceId: string,
    fromComicId: string,
    toSourceId: string,
    toComicId: string,
    newChapters: ComicChapter[] = [],
  ): Promise<number> {
    return this.deps.favoriteRepository.migrateByOrder(
      { sourceId: fromSourceId, comicId: fromComicId },
      { sourceId: toSourceId, comicId: toComicId },
      newChapters,
    );
  }

  async checkFavoriteUpdates(force = false): Promise<number> {
    return this.deps.favoriteRepository.checkUpdates(force);
  }

  /* ══════ 隐私模式（L944-999） ══════ */

  async enablePrivacyMode(pin: string): Promise<boolean> {
    const ok = await this.deps.privacy.enableWithPin(pin);
    if (ok) this.setState({ privacyModeEnabled: true });
    return ok;
  }

  async disablePrivacyMode(pin: string): Promise<boolean> {
    const ok = await this.deps.privacy.disable(pin);
    if (ok) {
      this.setState({ privacyModeEnabled: false, unlockedCategoryIds: new Set<number>() });
    }
    return ok;
  }

  verifyPrivacyPin(pin: string): Promise<boolean> {
    return this.deps.privacy.verifyPin(pin);
  }

  async changePrivacyPin(oldPin: string, newPin: string): Promise<boolean> {
    return this.deps.privacy.changePin(oldPin, newPin);
  }

  /** 仅在隐私模式开启时允许（L968）。 */
  async setCategoryProtected(categoryId: number, isProtected: boolean): Promise<void> {
    if (!this.stateValue.privacyModeEnabled) return;
    await this.deps.repository.setCategoryProtected(categoryId, isProtected);
    if (!isProtected) {
      const next = new Set(this.stateValue.unlockedCategoryIds);
      next.delete(categoryId);
      this.setState({ unlockedCategoryIds: next });
    }
  }

  /** 进入受保护分类：验证 PIN，成功则本次进程内解锁（L981-986）。 */
  async unlockCategory(categoryId: number, pin: string): Promise<boolean> {
    if (!this.stateValue.privacyModeEnabled) return false;
    if (!(await this.deps.privacy.verifyPin(pin))) return false;
    const next = new Set(this.stateValue.unlockedCategoryIds);
    next.add(categoryId);
    this.setState({ unlockedCategoryIds: next });
    return true;
  }

  /** 刷新受保护分类名集合（L354 / L360-362）。 */
  setCategories(
    categories: ReadonlyArray<{ name: string; isProtected: boolean }>,
  ): void {
    this.setState({ protectedCategoryNames: collectProtectedCategoryNames(categories) });
  }

  setIncognitoBrowsing(enabled: boolean): void {
    this.setState({ incognitoBrowsingEnabled: enabled });
    void this.deps.prefs.setIncognitoBrowsingEnabled(enabled);
  }

  setFavoritesProtected(enabled: boolean): void {
    this.setState({ favoritesProtected: enabled });
    void this.deps.prefs.setFavoritesProtected(enabled);
  }

  /* ══════ 偏好更新（L391-426） ══════ */

  async updateRenderQuality(quality: number): Promise<void> {
    await this.deps.prefs.setRenderQuality(quality);
    this.setState({ renderQuality: quality });
  }

  async updateAutoNightMode(enabled: boolean): Promise<void> {
    await this.deps.prefs.setAutoNightMode(enabled);
    this.setState({ autoNightMode: enabled });
  }

  async updateBlueLightFilter(enabled: boolean): Promise<void> {
    await this.deps.prefs.setBlueLightFilter(enabled);
    this.setState({ blueLightFilter: enabled });
  }

  async updateBlueLightAlpha(alpha: number): Promise<void> {
    await this.deps.prefs.setBlueLightAlpha(alpha);
    this.setState({ blueLightAlpha: alpha });
  }

  async updateScreenOrientationLock(mode: number): Promise<void> {
    await this.deps.prefs.setScreenOrientationLock(mode);
    this.setState({ screenOrientationLock: mode });
  }

  async updateHapticsEnabled(enabled: boolean): Promise<void> {
    await this.deps.prefs.setHapticsEnabled(enabled);
    this.setState({ hapticsEnabled: enabled });
  }

  async updateColorTheme(primary: number, secondary: number): Promise<void> {
    await this.deps.prefs.setColorPrimaryIndex(primary);
    await this.deps.prefs.setColorSecondaryIndex(secondary);
    this.setState({ colorPrimaryIndex: primary, colorSecondaryIndex: secondary });
  }

  /* ══════ 阅读器选书（L548-743） ══════ */

  /**
   * 选书（L610-687）。
   * 漫画：直接全量加载（正文只是图片路径，很小）；
   * 小说：懒加载 —— 建逻辑章节映射，只装载当前章 ±1。
   */
  selectBook(book: BookLike): void {
    this.searchJob?.abort();
    this.searchJob = null;
    this.reader = createReaderSelectionState();
    this.reader.selectedSourceBook = book;
    this.reader.readerLoading = true;
    this.reader.selectedBook = book;
    this.readerSelectionToken += 1;
    const token = this.readerSelectionToken;
    const controller = new AbortController();
    this.readerJobs.add(controller);

    void (async () => {
      try {
        if (book.isComic === true) {
          const rows = await this.deps.repository.getChaptersForBook(book.id);
          if (token !== this.readerSelectionToken || controller.signal.aborted) return;
          this.reader.chapters = rows;
          this.reader.readerLoading = false;
          await this.collectAnnotations(book.id);
          return;
        }
        const metadata = await this.deps.repository.getChaptersMetadataList(book.id);
        const logical = buildLogicalChapters(
          metadata.map((row) => ({
            id: row.id ?? 0,
            bookId: row.bookId,
            chapterOrder: row.chapterOrder,
            title: row.title,
            content: row.content,
            startCharIndex: row.startCharIndex,
            endCharIndex: row.endCharIndex,
          })),
        );
        if (logical.chapters.length === 0) throw new Error('这本书没有可读取的章节');
        if (token !== this.readerSelectionToken || controller.signal.aborted) return;
        this.reader.cachedMetadataList = metadata;
        this.reader.chapterMapping = logical;
        this.reader.lastLoadedBookId = book.id;

        const physicalStart = Math.max(book.currentChapterIndex ?? 0, 0);
        const { logicalStart, logicalOffset } = resolveLogicalStart(
          logical,
          physicalStart,
          book.scrollOffset ?? 0,
        );
        this.reader.lastLoadedChapterIndex = logicalStart;
        this.reader.selectedBook = {
          ...book,
          currentChapterIndex: logicalStart,
          scrollOffset: logicalOffset,
        };
        await this.collectAnnotations(book.id);
        await this.loadActiveChaptersContent(book.id, logicalStart, controller.signal);
      } catch (error) {
        if (token !== this.readerSelectionToken || controller.signal.aborted) return;
        this.reader.readerLoadError =
          error instanceof Error ? error.message : '书籍加载失败';
        this.reader.readerLoading = false;
      } finally {
        this.readerJobs.delete(controller);
      }
    })();
  }

  /** 切章立刻启动正文读取（L701-708）。 */
  ensureActiveChapter(bookId: number, logicalIndex: number): void {
    if (
      this.reader.selectedBook?.id !== bookId ||
      this.reader.lastLoadedBookId !== bookId ||
      logicalIndex < 0 ||
      logicalIndex >= this.reader.cachedMetadataList.length ||
      this.reader.lastLoadedChapterIndex === logicalIndex
    ) {
      return;
    }
    this.reader.lastLoadedChapterIndex = logicalIndex;
    this.reader.readerLoadError = null;
    this.reader.selectedBook = {
      ...this.reader.selectedBook,
      currentChapterIndex: logicalIndex,
      scrollOffset: 0,
    };
    const controller = new AbortController();
    this.readerJobs.add(controller);
    void this.loadActiveChaptersContent(bookId, logicalIndex, controller.signal).finally(() => {
      this.readerJobs.delete(controller);
    });
  }

  /** 装载当前章 ±1 的正文（L548-608）。 */
  private async loadActiveChaptersContent(
    bookId: number,
    currentLogicalIdx: number,
    signal: AbortSignal,
  ): Promise<void> {
    const token = this.readerSelectionToken;
    const mapping = this.reader.chapterMapping;
    const metadata = this.reader.cachedMetadataList;
    if (mapping === null || metadata.length === 0) throw new Error('没有可读取的章节');
    const needsCurrentChapter = !this.reader.loadedChapterIndices.has(currentLogicalIdx);
    this.reader.readerLoading = needsCurrentChapter;
    try {
      const targetLogical = activeLogicalWindow(currentLogicalIdx, metadata.length);
      const targetOrders = activePhysicalOrders(targetLogical, mapping);
      const activeParts = new Map<number, ChapterRow>();
      for (const row of await this.deps.repository.getChaptersByOrders(bookId, targetOrders)) {
        activeParts.set(row.chapterOrder, row);
      }
      const merged = mergeActiveChapterContent(metadata, targetLogical, mapping, activeParts);
      // 校验当前章数据齐全（L583-586）
      const currentPhysical = mapping.logicalToPhysicalOrders[currentLogicalIdx] ?? [];
      if (currentLogicalIdx < 0 || currentLogicalIdx >= merged.length) {
        throw new Error('当前章节数据缺失，请重试加载');
      }
      for (const order of currentPhysical) {
        if (!activeParts.has(order)) throw new Error('当前章节数据缺失，请重试加载');
      }
      if (signal.aborted || token !== this.readerSelectionToken) return;
      this.reader.chapters = merged;
      this.reader.loadedChapterIndices = new Set(
        targetLogical.filter((li) =>
          (mapping.logicalToPhysicalOrders[li] ?? []).every((order) => activeParts.has(order)),
        ),
      );
      this.reader.readerLoadError = null;
      this.reader.readerLoading = false;
    } catch (error) {
      if (signal.aborted || token !== this.readerSelectionToken) return;
      if (needsCurrentChapter) {
        this.reader.readerLoadError =
          error instanceof Error ? error.message : '章节加载失败';
        this.reader.readerLoading = false;
      }
    }
  }

  /** 书签 / 高亮收集并重映射（L710-743）。 */
  private async collectAnnotations(bookId: number): Promise<void> {
    const mapping = this.reader.chapterMapping;
    this.reader.bookmarks = remapBookmarks(
      await this.deps.repository.getBookmarksForBook(bookId),
      mapping,
    );
    this.reader.highlights = remapHighlights(
      await this.deps.repository.getHighlightsForBook(bookId),
      mapping,
    );
  }

  /** 检索失败后重试（L689-698）。 */
  async retrySelectedBook(): Promise<void> {
    const source = this.reader.selectedSourceBook;
    if (source === null) return;
    const fresh = (await this.deps.repository.getBook(source.id)) ?? source;
    this.selectBook(fresh as BookLike);
  }

  /* ══════ 全文检索（L1052-1100） ══════ */

  /**
   * 输入框逐字符触发：取消上一轮搜索 + 300ms 防抖，
   * 否则「插」的慢结果会晚于「插图」返回并覆盖结果列表（L1053-1055 注释）。
   */
  searchFullText(query: string): void {
    this.searchJob?.abort();
    if (query.trim() === '') {
      this.reader.searchResults = [];
      this.reader.isSearching = false;
      return;
    }
    const bookId = this.reader.selectedBook?.id;
    if (bookId === undefined) return;
    const token = this.readerSelectionToken;
    const mapping = this.reader.chapterMapping;
    this.reader.isSearching = true;
    const controller = new AbortController();
    this.searchJob = controller;
    setTimeout(() => {
      if (controller.signal.aborted) return;
      void (async () => {
        try {
          const matches: ChapterRow[] = [];
          let afterOrder = -1;
          let resultCount = 0;
          for (;;) {
            const batch = await this.deps.repository.searchChaptersBatch(bookId, query, afterOrder);
            if (batch.length === 0) break;
            const acc = accumulateSearchMatches(batch, query, resultCount);
            matches.push(...acc.matches);
            resultCount = acc.count;
            if (acc.reached) break;
            afterOrder = batch[batch.length - 1]?.chapterOrder ?? afterOrder;
          }
          const results = buildSearchResults(matches, query, mapping);
          if (controller.signal.aborted || token !== this.readerSelectionToken) return;
          if (this.reader.selectedBook?.id !== bookId) return;
          this.reader.searchResults = results;
          this.reader.isSearching = false;
        } catch {
          if (controller.signal.aborted) return;
          if (token === this.readerSelectionToken && this.reader.selectedBook?.id === bookId) {
            this.reader.isSearching = false;
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
  }

  /* ══════ 进度 / 书签 / 高亮（L745-925） ══════ */

  async moveBookToCategory(book: BookLike, newCategory: string): Promise<void> {
    await this.deps.repository.updateBook({ ...(book as object), category: newCategory } as never);
  }

  /**
   * 导入完成后的分类归一 + 状态消息（L752-778）。
   *
   * 2026-10-06 修正：`success: boolean` 这个签名表达不了 Kotlin 的三条分支
   * （L768 onSuccess / L771 onFailure / L775 未捕获异常），第三条的文案
   * `导入出错: …` 完全没地方出现。改成三态 `outcome`：
   *   `{ ok: true, book }`                                   → L759-768
   *   `{ ok: false, error }`                                 → L769-772（导入失败）
   *   `{ ok: false, error, thrown: true }`                   → L773-776（导入出错）
   * 三个文案由导出的纯函数生成，便于单测逐字断言。
   */
  /**
   * Kotlin `importBook`（L752-778）的收尾段。注意 Kotlin 的入参只有
   * `uri` / `fileName` / `category`，成功分支里的 `book` 来自
   * `result.onSuccess { book -> … }`，所以这里只需要 `outcome.book`，
   * 不需要额外的 `book` 形参。
   */
  async finishImport(requestedCategory: string, outcome: ImportOutcome): Promise<string> {
    if (!outcome.ok) {
      const message =
        outcome.thrown === true ? importThrowMessage(outcome.error) : importFailureMessage(outcome.error);
      this.importStatusMessage = message;
      return message;
    }
    const target = outcome.book;
    // Kotlin L759：书籍单一归属真实分类；旧聚合词归一为「默认」
    const normalized = normalizeImportCategory(requestedCategory);
    if (normalized !== target.category) {
      await this.deps.repository.updateBook({ ...(target as object), category: normalized } as never);
    }
    this.importStatusMessage = importSuccessMessage(target.title);
    return this.importStatusMessage;
  }

  clearImportMessage(): void {
    this.importStatusMessage = null;
  }

  /**
   * 保存小说进度（L785-796）。
   * 未读完时 400ms 防抖；读完立刻写。带 ContentMutationGate epoch。
   */
  updateProgress(
    bookId: number,
    chapterIndex: number,
    scrollOffset: number,
    isFinished: boolean,
  ): void {
    if (this.reader.selectedBook?.id !== bookId) return;
    const physicalIndex = toPhysicalIndex(this.reader.chapterMapping, chapterIndex);
    const epoch = ContentMutationGate.epoch;
    this.progressSaveJobs.get(bookId)?.abort();
    const controller = new AbortController();
    const write = (): void => {
      void this.deps.repository.updateProgress(bookId, physicalIndex, scrollOffset, isFinished, epoch);
      if (this.progressSaveJobs.get(bookId) === controller) this.progressSaveJobs.delete(bookId);
    };
    if (isFinished) {
      write();
      return;
    }
    this.progressSaveJobs.set(bookId, controller);
    setTimeout(() => {
      if (!controller.signal.aborted) write();
    }, PROGRESS_DEBOUNCE_MS);
  }

  /** 删书（L802-806）。 */
  async deleteBook(book: BookLike): Promise<void> {
    await this.deps.repository.deleteBook(book as never);
  }

  /**
   * 8 秒撤销删除（L817-828）：令牌仍在表里才真正落盘。
   * `onCommitted` 在确认后回调（把该批移出「软删除」列表）。
   */
  scheduleBooksDeletion(
    books: readonly BookLike[],
    token: string,
    onCommitted?: () => void,
  ): void {
    void this.deletionUndo.schedule(token).then((shouldCommit) => {
      if (!shouldCommit) return;
      for (const book of books) {
        void this.deps.repository.deleteBook(book as never).catch(() => undefined);
      }
      onCommitted?.();
    });
  }

  cancelBooksDeletion(token: string): boolean {
    return this.deletionUndo.cancel(token);
  }

  /** 删除前预估磁盘字节（L835）。 */
  booksDiskBytes(books: readonly BookLike[]): Promise<number> {
    return this.deps.repository.booksDiskBytes(books as never);
  }

  /** 书签增删切换（L862-904）。 */
  async toggleBookmark(
    bookId: number,
    chapterIndex: number,
    scrollOffset: number,
    title: string,
    snippet: string,
  ): Promise<void> {
    const existing = findExistingBookmark(this.reader.bookmarks, bookId, chapterIndex);
    if (existing !== undefined) {
      await this.deps.repository.deleteBookmark(existing.id ?? 0);
      this.reader.bookmarks = this.reader.bookmarks.filter(
      (b) => b.id !== existing.id,
    );
      return;
    }
    const physicalIndex = toPhysicalIndex(this.reader.chapterMapping, chapterIndex);
    await this.deps.repository.addBookmark({
      bookId,
      chapterIndex: physicalIndex,
      scrollOffset,
      title,
      snippet,
      createdTime: Date.now(),
    });
    this.reader.bookmarks = remapBookmarks(
      await this.deps.repository.getBookmarksForBook(bookId),
      this.reader.chapterMapping,
    );
  }

  async deleteBookmark(id: number): Promise<void> {
    await this.deps.repository.deleteBookmark(id);
  }

  async addHighlight(
    bookId: number,
    chapterIndex: number,
    selectedText: string,
    note: string,
    colorHex: string,
  ): Promise<void> {
    const physicalIndex = toPhysicalIndex(this.reader.chapterMapping, chapterIndex);
    await this.deps.repository.insertHighlight({
      bookId,
      chapterIndex: physicalIndex,
      selectedText,
      note,
      colorHex,
      createdTime: Date.now(),
    });
  }

  async deleteHighlight(id: number): Promise<void> {
    await this.deps.repository.deleteHighlight(id);
    this.reader.highlights = this.reader.highlights.filter((h) => h.id !== id);
  }

  /* ══════ 分类（L927-942） ══════ */

  async addCategory(name: string): Promise<void> {
    await this.deps.repository.insertCategory(name, 0);
  }

  /** 删除分类；默认分类不可删（L937-941）。 */
  async deleteCategory(category: { name: string }): Promise<boolean> {
    if (category.name === UNDELETABLE_CATEGORY) return false;
    await this.deps.repository.deleteCategoryRow(category as never);
    return true;
  }

  /* ══════ 阅读时长（L850-860 / L1021-1048） ══════ */

  /** 无痕浏览判定（当前选中书）。 */
  private readingIsIncognito(): boolean {
    return isIncognitoReading(
      this.stateValue.incognitoBrowsingEnabled,
      this.stateValue.privacyModeEnabled,
      this.stateValue.protectedCategoryNames,
      this.reader.selectedBook,
    );
  }

  /**
   * 记录阅读时长（L1021-1048）。
   * 第七轮第 6.5 条：无痕浏览不写入任何统计。
   * 全程串行（与 Kotlin `Mutex` 同语义）。
   */
  recordTime(
    seconds: number,
    title: string | null = null,
    onlineBook: SearchBook | null = null,
  ): void {
    if (seconds <= 0 || this.readingIsIncognito()) return;
    const epoch = ContentMutationGate.epoch;
    const end = Date.now();
    const { recordTitle, slices } = planRecordTime(
      seconds,
      end,
      this.reader.selectedBook,
      title,
      onlineBook,
    );
    const currentBook = onlineBook === null ? this.reader.selectedBook : null;
    const task = this.readingTimeMutex.then(async () => {
      const added = await this.deps.repository.addReadingTime(
        currentBook?.id ?? null,
        recordTitle,
        slices,
        epoch,
        this.deps.prefs,
      );
      if (!added) return;
      const total =
        (await this.deps.repository.totalRecordedSeconds()) +
        (await this.deps.prefs.legacyUnattributedSeconds);
      await this.deps.prefs.setTotalReadTimeSeconds(total);
      for (const slice of slices) {
        await this.deps.prefs.setDailyReadTime(
          slice.date,
          await this.deps.repository.recordedSecondsForDate(slice.date),
        );
      }
      this.setState({
        totalReadTimeSeconds: total,
        todayReadSeconds: await this.deps.repository.recordedSecondsForDate(formatDateKey(Date.now())),
        streakDays: await this.deps.prefs.calculateStreak(),
      });
    });
    this.readingTimeMutex = task.catch(() => undefined);
    void task.catch(() => undefined);
  }

  /** 一次性会话记录（L850-860）：无痕时不写。 */
  async addReadingSession(session: { durationSeconds: number }): Promise<void> {
    if (session.durationSeconds <= 0 || this.readingIsIncognito()) return;
    await this.deps.repository.addReadingSession(session as never);
  }

  /** 删除阅读记录（L837-846）：连带清封面缓存键。 */
  async deleteReadingRecord(id: number): Promise<void> {
    await this.deps.repository.deleteReadingRecord(id);
    this.coverValidCache.delete(String(id));
  }

  /* ══════ 封面有效性缓存（L384-385 / L471-491） ══════ */

  /**
   * 书架书籍封面有效性（MainViewModel L471-491）：
   * `file://` 前缀剥掉后 exists()；空 coverUri → false。
   * `exists` 由调用方注入（Android 是 `java.io.File(path).exists()`）。
   */
  annotateCoverValidity<T extends BookLike>(
    books: readonly T[],
    exists: (path: string) => boolean,
  ): BookWithCoverValidity<T>[] {
    return books.map((book) => {
      if (typeof book.coverUri === 'string' && book.coverUri !== '') {
        const key = book.coverUri;
        let valid = this.coverValidCache.get(key);
        if (valid === undefined) {
          const path = key.startsWith('file://') ? key.slice(7) : key;
          valid = exists(path);
          this.coverValidCache.set(key, valid);
        }
        return { ...book, isCoverValid: valid };
      }
      return { ...book, isCoverValid: false };
    });
  }

  /* ══════ 释放（L1102-1105 onCleared） ══════ */

  /** 取消所有在途任务（对应 onCleared）。 */
  dispose(): void {
    this.favoriteAddJob?.abort();
    this.progressSaveJob?.abort();
    this.searchJob?.abort();
    for (const job of this.readerJobs) job.abort();
    this.readerJobs.clear();
    for (const job of this.progressSaveJobs.values()) job.abort();
    this.progressSaveJobs.clear();
    this.listeners.clear();
  }
}

/** 书架书籍补充字段：封面有效性（L472-483）。 */
export type BookWithCoverValidity<T extends BookLike> = T & { isCoverValid: boolean };

/** 重导出本章用到的既有模块符号，便于调用方一处取齐（与 Kotlin 同包可见性）。 */
export {
  buildLogicalChapters,
  cleanSplitTitle,
  maxChapterOrder,
  MAX_CONTINUATION_PARTS,
  type Chapter,
  type LogicalChapterBook,
} from '@core/data/chapterMerger';
export { ReadingTimeSlices } from '@core/data/readingTimeSlices';
export { SearchLocator, type SearchResultItem } from '@core/data/searchLocator';
export { ContentMutationGate } from '@core/data/contentMutationGate';

/* ══════════════ 已导出类型汇总 ══════════════ */

export type { ComicChapter, SearchBook };
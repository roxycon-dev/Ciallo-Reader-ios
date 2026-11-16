/**
 * 收藏查重控制器（E106）— 「同一部漫画在多个源」的确认弹窗状态机。
 *
 * Android 权威链路（逐行对照）：
 *   MainViewModel.kt L98-149   `toggleFavorite`：非漫画源 / 已收藏 / 无其它来源 → 直接
 *                              `favoriteRepository.add`；否则 AniList 别名 + `candidates()`
 *                              查重，命中则把 `FavoriteAddRequest` 挂起等用户确认。
 *   MainViewModel.kt L151-157  收藏队列（`favoriteAddQueue` / `processFavoriteAddQueue`）。
 *   MainViewModel.kt L164-169  `dismissFavoriteAdd`：busy 时拒绝，否则清请求并推进队列。
 *   MainViewModel.kt L171-209  `confirmFavoriteAdd(replace)`：
 *                                replace == null → add + 「已收进「我喜欢的」♡」；
 *                                replace != null → 拉章节（30s 超时）/ 补详情（15s 不致命）
 *                                → `replaceFavorite(oldKey, book, chapters)` + 迁移文案。
 *   MainActivity.kt   L604-620  `favoriteAddRequest` / `favoriteActionMessage` → 弹窗 + Toast。
 *
 * 与 `MainViewModel` 的关系：Kotlin 的收藏查重逻辑直接搬进这里（单例、无 React），
 * 消息文案 / 超时常量 / `refreshBookWithDetail` / `shouldEnqueueFavorite` 全部复用
 * `@core/app/mainViewModel` 的既有导出，避免第二份实现。
 *
 * 数据源注入顺序（`FavoriteAddEnvironment`）：
 *   1. 显式 `configureFavoriteAddController({...})`（单测用）；
 *   2. 缺省时回落到 `getLibraryRuntime()`：`favorites`（FavoriteRepository）、
 *      `sourceManager.getSource(id).getDetail()`（换源补快照）；
 *      漫画源走 `@core/comic/comicChapters` 的 `resolveComicSource`。
 *
 * 纯 TypeScript：无 React / DOM / Capacitor（`src/core` 门禁）。
 */

import {
  FAVORITE_CHAPTERS_TIMEOUT_MS,
  FAVORITE_SOURCE_UNAVAILABLE,
  buildReplaceFavoriteMessage,
  compactAniListTitle,
  normalizeAniListTitle,
  refreshBookWithDetail,
  shouldEnqueueFavorite,
  withTimeoutMs,
  type ComicChapterSource,
} from '@core/app/mainViewModel';
import { resolveComicSource, type ComicSourcePort } from '@core/comic/comicChapters';
import type { SearchBook as SourceSearchBook } from '@core/source/searchBook';
import { candidates as comicFavoriteCandidates } from './comicFavoriteMatching';
import type { ComicChapter, SearchBook } from './comicSourceTypes';
import {
  FAV_DEFAULT_CATEGORY,
  favoriteKey,
  type ComicKey,
  type FavoriteAddRequest,
  type FavoriteEntity,
  type FavoriteMigrationReport,
} from './favoriteTypes';
import { getLibraryRuntime } from './libraryRuntime';

/* ══════════════ 文案（MainViewModel.kt 逐字） ══════════════ */

/** L178 `_favoriteActionMessage.value = "已收进「我喜欢的」♡"`。 */
export const FAVORITE_ADDED_MESSAGE = '已收进「我喜欢的」♡';
/** L202 `request.copy(error = "来源响应超时，旧收藏已保留，可重试或选择并存")`。 */
export const FAVORITE_TIMEOUT_MESSAGE = '来源响应超时，旧收藏已保留，可重试或选择并存';
/** L146 `e.message ?: "收藏失败，请重试"` 的兜底。 */
export const FAVORITE_ADD_FAILED_MESSAGE = '收藏失败，请重试';
/** L206 `e.message ?: "操作失败，旧收藏已保留"` 的兜底。 */
export const FAVORITE_CONFIRM_FAILED_MESSAGE = '操作失败，旧收藏已保留';

/* ══════════════ 依赖注入面 ══════════════ */

/**
 * 页面手里的书对象：书源侧 `SearchBook`（带 `novelInfo`）与
 * `library/comicSourceTypes.SearchBook`（同构、无 `novelInfo`）都能直接传进来。
 */
export type FavoriteAddBook = Omit<SourceSearchBook, 'novelInfo'> & {
  readonly novelInfo?: SourceSearchBook['novelInfo'];
};

/**
 * 控制器真正用到的仓库子集（`FavoriteRepository` 结构兼容）。
 * 只列 Android 调到的四个方法，单测可以用普通对象字面量实现。
 */
export interface FavoriteAddRepository {
  favorites(): Promise<FavoriteEntity[]>;
  isFavorite(sourceId: string, comicId: string): Promise<boolean>;
  add(book: SearchBook, category: string, chapters: ComicChapter[]): Promise<void>;
  replaceFavorite(
    from: ComicKey,
    book: SearchBook,
    newChapters: ComicChapter[],
  ): Promise<FavoriteMigrationReport>;
}

export interface FavoriteAddEnvironment {
  /** 缺省 `getLibraryRuntime()?.favorites`。 */
  repository?: FavoriteAddRepository | null;
  /** Android `comicSourceProvider?.invoke(sourceId)`。缺省 `resolveComicSource`。 */
  comicSource?: (sourceId: string) => Promise<ComicSourcePort | null>;
  /** Android `source?.getDetail(book.id)`，已解包 SourceResult（错误 → null）。 */
  comicDetail?: (sourceId: string, comicId: string) => Promise<SourceSearchBook | null>;
  /** Android `titleDao.findMediaIds(normalized, compact)`。 */
  findAniListMediaIds?: (normalized: string, compact: string) => Promise<number[]>;
  /** Android `titleDao.getRawTitlesFor(mediaIds)`。 */
  getAniListRawTitles?: (mediaIds: number[]) => Promise<string[]>;
}

export interface FavoriteAddInput {
  book: FavoriteAddBook;
  category?: string;
  chapters?: readonly ComicChapter[];
  /** 页面自建仓库（ComicChaptersPage）时显式传；否则走环境 / runtime。 */
  repository?: FavoriteAddRepository;
}

/** `favoriteAddRequest` + `favoriteActionMessage`（MainActivity L604-605 的两个 StateFlow）。 */
export interface FavoriteAddSnapshot {
  readonly request: FavoriteAddRequest | null;
  readonly message: string | null;
}

const EMPTY_SNAPSHOT: FavoriteAddSnapshot = { request: null, message: null };

interface QueuedFavorite {
  book: SourceSearchBook;
  category: string;
  chapters: ComicChapter[];
  repository: FavoriteAddRepository;
}

/* ══════════════ 控制器 ══════════════ */

export class FavoriteAddController {
  private env: FavoriteAddEnvironment;

  private snapshot: FavoriteAddSnapshot = EMPTY_SNAPSHOT;

  private readonly listeners = new Set<() => void>();

  private readonly committedListeners = new Set<(key: string) => void>();

  /** Kotlin `favoriteAddQueue`（L153）。 */
  private readonly queue: QueuedFavorite[] = [];

  /** Kotlin `favoriteAddJob?.isActive == true`（L108 / L155）。 */
  private jobActive = false;

  /**
   * `FavoriteAddRequest` 在 Web 侧是被扁平化的（`bookId/sourceId/title/author/cover`），
   * 拿不到完整 `book`（`comicInfo.status` 会丢 → 连载状态错）。Kotlin 的 request 持有整个
   * book 对象，这里用两个伴随字段复刻同样语义。
   */
  private pendingBook: SourceSearchBook | null = null;

  private pendingRepository: FavoriteAddRepository | null = null;

  constructor(env: FavoriteAddEnvironment = {}) {
    this.env = env;
  }

  /* ── 订阅面 ── */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): FavoriteAddSnapshot {
    return this.snapshot;
  }

  /** 收藏真正写库（add / replaceFavorite）之后触发，页面据此刷新 ♥ 状态。 */
  subscribeCommitted(listener: (key: string) => void): () => void {
    this.committedListeners.add(listener);
    return () => {
      this.committedListeners.delete(listener);
    };
  }

  setEnvironment(env: FavoriteAddEnvironment): void {
    this.env = env;
  }

  /* ── Android MainViewModel.toggleFavorite（L98-149） ── */

  async requestFavoriteAdd(input: FavoriteAddInput): Promise<void> {
    const book = toSourceBook(input.book);
    const category = input.category ?? FAV_DEFAULT_CATEGORY;
    const chapters = [...(input.chapters ?? [])];
    const repository = this.repositoryOf(input.repository);
    if (repository === null) {
      this.setMessage(FAVORITE_ADD_FAILED_MESSAGE);
      return;
    }
    // L108-115：已有任务在跑或已有待确认请求 → 入队（同一本不重复入队）。
    if (this.jobActive || this.snapshot.request !== null) {
      if (shouldEnqueueFavorite(this.jobActive, this.snapshot.request, book, this.queue)) {
        this.queue.push({ book, category, chapters, repository });
      }
      return;
    }
    await this.runFavoriteAdd(book, category, chapters, repository);
  }

  /** L116-148 `favoriteAddJob = viewModelScope.launch(…) { … }`。 */
  private async runFavoriteAdd(
    book: SourceSearchBook,
    category: string,
    chapters: ComicChapter[],
    repository: FavoriteAddRepository,
  ): Promise<void> {
    this.jobActive = true;
    try {
      // L118-122：非漫画源 / 已收藏 → 直接 add。
      const source = await this.comicSourceOf(book.sourceId);
      if (source === null || (await repository.isFavorite(book.sourceId, book.id))) {
        await repository.add(book, category, chapters);
        this.commitAdded(book);
        return;
      }
      // L123-127：没有其它来源的收藏 → 直接 add。
      const existing = (await repository.favorites()).filter((fav) => fav.sourceId !== book.sourceId);
      if (existing.length === 0) {
        await repository.add(book, category, chapters);
        this.commitAdded(book);
        return;
      }
      // L128-139：AniList 别名 + ComicFavoriteMatching.candidates。
      const aliases = await this.aliasesOf(book);
      const dupCandidates = comicFavoriteCandidates(book, existing, aliases);
      if (dupCandidates.length === 0) {
        await repository.add(book, category, chapters);
        this.commitAdded(book);
        return;
      }
      // L140-142：挂起等用户确认。
      this.pendingBook = book;
      this.pendingRepository = repository;
      this.setSnapshot({
        ...this.snapshot,
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
      });
    } catch (error) {
      // L146 `_favoriteActionMessage.value = e.message ?: "收藏失败，请重试"`。
      this.setMessage(messageOf(error, FAVORITE_ADD_FAILED_MESSAGE));
    } finally {
      this.jobActive = false;
      this.processFavoriteAddQueue();
    }
  }

  /** L154-157：队列推进。 */
  private processFavoriteAddQueue(): void {
    if (this.snapshot.request !== null || this.jobActive) return;
    const next = this.queue.shift();
    if (next !== undefined) {
      void this.runFavoriteAdd(next.book, next.category, next.chapters, next.repository);
    }
  }

  /* ── Android MainViewModel.dismissFavoriteAdd（L164-169） ── */

  dismissFavoriteAdd(): void {
    if (this.snapshot.request?.busy === true) return;
    this.pendingBook = null;
    this.pendingRepository = null;
    this.setSnapshot({ ...this.snapshot, request: null });
    this.processFavoriteAddQueue();
  }

  /* ── Android MainViewModel.confirmFavoriteAdd（L171-209） ── */

  async confirmFavoriteAdd(replace: FavoriteEntity | null): Promise<void> {
    const request = this.snapshot.request;
    if (request === null || request.busy) return;
    // L173 `_favoriteAddRequest.value = request.copy(busy = true, error = null)`。
    this.setSnapshot({
      ...this.snapshot,
      request: { ...request, busy: true, error: null },
    });
    const repository = this.pendingRepository ?? this.repositoryOf();
    const book = this.pendingBook ?? bookFromRequest(request);
    try {
      if (repository === null) throw new Error(FAVORITE_ADD_FAILED_MESSAGE);
      if (replace === null) {
        // L176-178。
        await repository.add(book, request.category, request.chapters);
        this.pendingBook = null;
        this.pendingRepository = null;
        this.setSnapshot({ request: null, message: FAVORITE_ADDED_MESSAGE });
      } else {
        // L180：新来源实例。
        const source = await this.comicSourceOf(book.sourceId);
        // L182-188：章节为空时按 30s 超时重取（错误文案逐条对齐）。
        let chapters = request.chapters;
        if (chapters.length === 0) {
          if (source === null) throw new Error(FAVORITE_SOURCE_UNAVAILABLE);
          chapters = await this.chaptersFor(source, book.id);
        }
        // L189-190：15s 超时补详情，失败沿用旧快照（恒不抛）。
        const refreshed = await refreshBookWithDetail(
          book,
          this.detailSourceOf(source, book.sourceId),
        );
        // L191-198：换源替换 + 迁移文案。
        const report = await repository.replaceFavorite(
          { sourceId: replace.sourceId, comicId: replace.comicId },
          refreshed,
          chapters,
        );
        this.pendingBook = null;
        this.pendingRepository = null;
        this.setSnapshot({ request: null, message: buildReplaceFavoriteMessage(report) });
      }
      this.commit(book);
    } catch (error) {
      // L201-207：超时单独一条文案；其余用 e.message，兜底「操作失败，旧收藏已保留」。
      const timedOut = error instanceof Error && error.message.includes('来源响应超时');
      this.setSnapshot({
        ...this.snapshot,
        request: {
          ...request,
          busy: false,
          error: timedOut ? FAVORITE_TIMEOUT_MESSAGE : messageOf(error, FAVORITE_CONFIRM_FAILED_MESSAGE),
        },
      });
    } finally {
      this.processFavoriteAddQueue();
    }
  }

  /* ── Android MainViewModel.clearFavoriteActionMessage（L163） ── */

  clearFavoriteActionMessage(): void {
    if (this.snapshot.message === null) return;
    this.setSnapshot({ ...this.snapshot, message: null });
  }

  /** 测试 / 热重载用：清空全部状态与队列。 */
  reset(): void {
    this.snapshot = EMPTY_SNAPSHOT;
    this.queue.length = 0;
    this.jobActive = false;
    this.pendingBook = null;
    this.pendingRepository = null;
    for (const listener of this.listeners) listener();
  }

  /* ── 内部：环境解析 ── */

  private repositoryOf(explicit?: FavoriteAddRepository): FavoriteAddRepository | null {
    if (explicit !== undefined) return explicit;
    if (this.env.repository !== undefined) return this.env.repository;
    return getLibraryRuntime()?.favorites ?? null;
  }

  private comicSourceOf(sourceId: string): Promise<ComicSourcePort | null> {
    const resolver = this.env.comicSource;
    return resolver === undefined ? resolveComicSource(sourceId) : resolver(sourceId);
  }

  private async comicDetailOf(sourceId: string, comicId: string): Promise<SourceSearchBook | null> {
    const custom = this.env.comicDetail;
    if (custom !== undefined) return custom(sourceId, comicId);
    const source = getLibraryRuntime()?.sourceManager?.getSource(sourceId) ?? null;
    if (source === null) return null;
    try {
      const detail = await source.getDetail(comicId);
      return detail.kind === 'success' ? detail.data : null;
    } catch {
      return null;
    }
  }

  /** `refreshBookWithDetail` 需要 `ComicChapterSource`，把端口适配过去。 */
  private detailSourceOf(
    source: ComicSourcePort | null,
    sourceId: string,
  ): ComicChapterSource | null {
    if (source === null) return null;
    return {
      isComicSource: true,
      getChapters: (comicId: string) => source.getChapters(comicId),
      getDetail: async (comicId: string) => {
        const detail = await this.comicDetailOf(sourceId, comicId);
        if (detail === null) throw new Error(FAVORITE_SOURCE_UNAVAILABLE);
        return detail;
      },
    };
  }

  /** L182-188 `withTimeout(30_000) { source?.getChapters(book.id) }` + 错误透传。 */
  private async chaptersFor(source: ComicSourcePort, comicId: string): Promise<ComicChapter[]> {
    try {
      return await withTimeoutMs(
        source.getChapters(comicId),
        FAVORITE_CHAPTERS_TIMEOUT_MS,
        FAVORITE_TIMEOUT_MESSAGE,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('来源响应超时')) throw error;
      throw new Error(messageOf(error, FAVORITE_ADD_FAILED_MESSAGE));
    }
  }

  /** L128-134：标题 → AniList mediaId → 原始标题别名（未接线时等价于空别名）。 */
  private async aliasesOf(book: SourceSearchBook): Promise<string[]> {
    const find = this.env.findAniListMediaIds;
    const raw = this.env.getAniListRawTitles;
    if (find === undefined || raw === undefined) return [];
    const titles = [book.title, ...(book.comicInfo?.alternateTitles ?? [])];
    let mediaIds: number[] = [];
    for (const title of titles) {
      const found = await find(normalizeAniListTitle(title), compactAniListTitle(title));
      mediaIds = mediaIds.concat(found);
    }
    const unique = Array.from(new Set(mediaIds));
    // L134 `if (mediaIds.size == 1) titleDao.getRawTitlesFor(mediaIds) else emptyList()`
    return unique.length === 1 ? raw(unique) : [];
  }

  /* ── 内部：状态变更 ── */

  private commit(book: SourceSearchBook): void {
    const key = favoriteKey(book.sourceId, book.id);
    for (const listener of this.committedListeners) listener(key);
  }

  /** Android L146 前一步：直接 add 成功 → 「已收进「我喜欢的」♡」+ 通知页面刷 ♥。 */
  private commitAdded(book: SourceSearchBook): void {
    this.commit(book);
    this.setMessage(FAVORITE_ADDED_MESSAGE);
  }

  private setMessage(message: string): void {
    this.setSnapshot({ ...this.snapshot, message });
  }

  private setSnapshot(next: FavoriteAddSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/* ══════════════ 模块级单例 ══════════════ */

/** 全 App 唯一实例（对应 Android 的 `MainViewModel` 单例）。 */
export const favoriteAddController = new FavoriteAddController();

/** 生产入口：先查重，命中则挂起等用户确认。 */
export function requestFavoriteAdd(input: FavoriteAddInput): Promise<void> {
  return favoriteAddController.requestFavoriteAdd(input);
}

export function confirmFavoriteAdd(replace: FavoriteEntity | null): Promise<void> {
  return favoriteAddController.confirmFavoriteAdd(replace);
}

export function dismissFavoriteAdd(): void {
  favoriteAddController.dismissFavoriteAdd();
}

export function clearFavoriteActionMessage(): void {
  favoriteAddController.clearFavoriteActionMessage();
}

export function subscribeFavoriteAdd(listener: () => void): () => void {
  return favoriteAddController.subscribe(listener);
}

export function getFavoriteAddSnapshot(): FavoriteAddSnapshot {
  return favoriteAddController.getSnapshot();
}

export function subscribeFavoriteCommitted(listener: (key: string) => void): () => void {
  return favoriteAddController.subscribeCommitted(listener);
}

/** 宿主（App 启动 / 单测）覆盖依赖；传 `{}` 即回到 runtime 缺省。 */
export function configureFavoriteAddController(env: FavoriteAddEnvironment): void {
  favoriteAddController.setEnvironment(env);
}

/** 单测用：清空状态并回到缺省环境。 */
export function resetFavoriteAddController(): void {
  favoriteAddController.setEnvironment({});
  favoriteAddController.reset();
}

/* ══════════════ 纯工具 ══════════════ */

function toSourceBook(book: FavoriteAddBook): SourceSearchBook {
  return { ...book, novelInfo: book.novelInfo ?? null };
}

/** MainViewModel L1009-1016：request 里只有扁平字段时重建一本最小 book。 */
function bookFromRequest(request: FavoriteAddRequest): SourceSearchBook {
  const comicId = request.bookId.split('::')[1] ?? request.bookId;
  return {
    id: comicId,
    sourceId: request.sourceId,
    title: request.title,
    author: request.author,
    cover: request.cover,
    description: null,
    format: 'epub',
    language: null,
    comicId: null,
    size: null,
    downloadUrl: null,
    eapiId: null,
    eapiHash: null,
    novelInfo: null,
    comicInfo: null,
  };
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

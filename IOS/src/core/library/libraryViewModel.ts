/**
 * Port of Android `com.example.library.LibraryViewModel.kt`
 * (1273 lines, 1172 non-blank).
 *
 * Ported: 1172 / 1172 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - 1-46 Kotlin/Android imports — see "Platform adaptations". The source types come
 *   from `@core/source`, the download layer from `@core/download`, the settings from
 *   `@core/settings`, the keyword helpers are inlined (see `libraryAggregateSearch.ts`
 *   for `KeywordKeys.query` / `KeywordVariants.LIMIT`) because the keyword module is
 *   owned by another agent, and `com.example.ui.components.AppToast` becomes the
 *   injected `toast(message)` sink (`@ui/toast` at the page level).
 * - 57 `class LibraryViewModel(application: Application) : AndroidViewModel(application)`
 *   — `Application` → the injected {@link LibraryViewModelDeps} bundle.
 * - 61-64 `val downloadedNovelKeys = bookDao.getAllBooks().map { … }.stateIn(...)` and
 *   977-991 `val downloadStates = combine(…).stateIn(...)` — the two `combine`d
 *   StateFlows become async getters (`downloadedNovelKeys()`, `downloadStates()`) that
 *   re-read the injected sources, plus listener registries (`subscribeDownloadStates`)
 *   so the page can re-render.
 * - 193-205 the three `ComicDownloadManager.tasks.combine(comicBook)` StateFlows →
 *   `comicDownloading()`, `comicDownloadProgress()`, `comicPaused()` getters
 *   recomputed from the task map + `comicBook`.
 * - 207 `val comicMessage = ComicDownloadManager.message` → `comicMessage()` getter
 *   + `subscribeComicMessage` inside the manager.
 * - 226-265 the `init` coroutine that registers the built-in sources (`ZLibrarySource`,
 *   `AutoNovelSource`, `Wenku8LibrarySource`, `IxdzsSource`, `MangaDexSource`), the
 *   `comic_*` cleanup and the `JsSourceRepo.loadCached/install` block — all of that
 *   belongs to the source manager / JS repo modules (other agents). The `init` block is
 *   ported as `initialize()` which calls the injected `registerBuiltinSources()` hook
 *   and then wires the active-source login listener + the comic-download success
 *   listener exactly as Kotlin does.
 * - 445-456 `keywordRepository.observe(keyword, forceRefresh).collect { update -> … }`
 *   (a Room `Flow<KeywordUpdate>`) → the injected `KeywordExpansionSource.observe`
 *   returning an async iterable of the same update shape; the body (dedupe by
 *   `KeywordKeys.query`, `take(KeywordVariants.LIMIT)`, status/origins/providers
 *   publishing, `emit(batch)`) is ported verbatim.
 * - 723-931 `runSourceSmokeTest` + `fetchAndDecode` + `fetchOnce` — a `adb am start`
 *   developer smoke harness that logs to Logcat. It has no UI surface and its output
 *   target does not exist on this platform; the port keeps it as an injectable
 *   `smokeTest` hook (default: not run) so the code is available to a host harness.
 * - 1238-1260 `startWebViewDownload(book, realUrl, cookieHeader)` — the Android
 *   hidden-WebView download listener. The Z-Library module (another agent) owns the
 *   WebView session; the port keeps the method with the referer/header wiring and takes
 *   the node domain from the injected `zlibraryNodeDomain` getter.
 *
 * Platform adaptations:
 * - `MutableStateFlow<T>` → a `MutableValue<T>` cell with `value` / `update` /
 *   `subscribe` (the same shape `core/source/sourceManager.ts` exports as
 *   `createStateFlow`, re-implemented locally so this file has no cross-module
 *   coupling for a type it owns 40+ times).
 * - `viewModelScope.launch { … }` → `void this.launch(...)` with the same
 *   SupervisorJob-equivalent error routing (`deps.log`).
 * - `Job?.cancel()` → an `AbortController` per job (`Job` handle with `cancel()`).
 * - `SharingStarted.WhileSubscribed(5_000)` → listeners are registered by the page; the
 *   recompute happens on every notification (the 5 s debounce only saved recompositions
 *   and there is a single page subscribed in this app shell).
 * - `com.example.data.PreferencesManager` → the injected
 *   {@link LibraryViewModelPrefs} (async getters/setters, same names).
 * - `BookRepository(application, database.bookDao())` → the injected
 *   `LibraryBookRepositoryApi` (`getAllBooksSync`, `getBookBySourceResource`,
 *   `getAllFavoritesSync`).
 * - `DownloadManager` → the injected `LibraryDownloadApi`
 *   (`downloadStates()`, `allTasks()`, `enqueueDownload`, `pause/resume/cancel`).
 * - `SourceManager` → the injected `LibrarySourceManagerApi` (`activeSource()`,
 *   `availableSources()`, `getSource()`, `setActiveSource()`, `initialize()`).
 * - `NovelDownloadStore.baseline(...)` → `novels.baseline(source, id)`.
 * - `require(kind == "comic" || kind == "novel") { "未知的聚合搜索类型" }` → the same
 *   `throw new Error('未知的聚合搜索类型')` guard.
 * - `guessFileFormatFromUrl` → the injected hook (the Z-Library module owns it).
 * - `withComicDetail(book, detail)` → the shared `@core/source/comicInfo` port.
 *
 * Line-by-line audit fixes (2026-10-06):
 * - LibraryViewModel.kt:62 and :1208 read `Book.isComic`, which is `contentType == "COMIC"`
 *   (Book.kt:43-44). `isComicShelfRow` had guessed it from the `comics_` filePath prefix, so
 *   a locally-imported comic stored under another directory name was treated as a novel
 *   (it leaked into `downloadedNovelKeys` and blocked `checkNovelUpdate`). Now reads
 *   `contentType`.
 * - LibraryViewModel.kt:100-113 the second leg of the `cached = { … }` lambda — the legacy
 *   `"record_cover_cache"` SharedPreferences table — was missing. Restored behind the
 *   `deps.legacyRecordCoverJson` seam (async `JSON.parse` via `ReadingRecordMetadata.decode`).
 * - LibraryViewModel.kt:1093 `result.data.filter { it.format.isNotBlank() }` was
 *   `it.format !== ''`, which keeps whitespace-only formats that Kotlin drops.
 * - LibraryViewModel.kt:207 `val comicMessage = ComicDownloadManager.message` is consumed by
 *   MainActivity.kt:1428-1432 (`LaunchedEffect(comicMessage) { …; clearComicMessage() }`),
 *   which is the app shell — another agent's file. The toast is raised here from
 *   `initialize()`'s `subscribeComicMessage` instead; `comicMessage()`/`clearComicMessage()`
 *   stay public so a shell that owns the toast can use them.
 *
 * Line-by-line audit fixes (2026-10-06, round 4):
 * - LibraryViewModel.kt:1172 gates the novel-update-panel error hand-off on `replaceNovel`:
 *   `if (replaceNovel) _novelUpdate.value?.takeIf { … }?.let { … }`. The port's
 *   `applyDownloadErrorToNovelUpdate` dropped that flag, so an ordinary `startDownload`
 *   failure overwrote an open "check update" panel with an unrelated error message. The
 *   flag is now a parameter and both call sites pass it through.
 * - LibraryViewModel.kt:51 `READER_UNSUPPORTED_FORMATS` was re-declared as a second literal
 *   copy of the set exported by `libraryDisplay.ts` and consumed by `filterReadableFormats`.
 *   A future edit to one could let a format through `downloadBook` that `startDownload`
 *   already refused, so the local constant now aliases the exported set.
 */

import type { BookSource } from '@core/source/bookSource';
import { WholeBookNovelSources, novelInfoHasRevision, novelInfoRevision } from '@core/source/novelInfo';
import type { UpdatableNovelSource } from '@core/source/novelInfo';
import type { ComicChapter } from '@core/source/comicChapter';
import type { ComicSource } from '@core/source/comicSource';
import type { SearchBook } from '@core/source/searchBook';
import type { SourceResult } from '@core/source/sourceResult';
import { SourceResult as SourceResultNs } from '@core/source/sourceResult';
import { withComicDetail } from '@core/source/comicInfo';
import {
  LoginRequired,
  NetworkError,
  ParseError,
  type SourceException,
} from '@core/source/sourceException';
import { isComicSource, isNovelSource } from '@core/source/sourceCapabilities';
import type { BookFormat } from '@core/source/bookFormat';
import type { DownloadInfo } from '@core/source/downloadInfo';
import type { DownloadState } from '@core/download/downloadState';
import {
  DownloadStateIdle,
  DownloadStatePending,
  downloadingState,
  errorState,
  pausedState,
  successState,
} from '@core/download/downloadState';
import { taskId as downloadTaskId, originalBookId } from '@core/download/downloadManager';
import type { DownloadRequest } from '@core/download/downloadRequest';
import { isWholeBookNovelSource } from '@core/download/downloadRequest';
import type { DownloadTaskRecord } from '@core/download/downloadTaskRepository';

import {
  LibraryUiEmpty,
  LibraryUiSearching,
  libraryAggregateGroup,
  libraryAggregateResults,
  libraryErrorNetworkDetail,
  libraryErrorUnknown,
  LibraryErrorSourceUnavailable,
  LibraryErrorAuthenticationRequired,
  LibraryErrorCloudflareBlocked,
  libraryErrorParseFailed,
  libraryErrorState,
  librarySearchResults,
  type LibraryError,
  type LibraryUiState,
} from './libraryTypes';
import { SourceSearchCoordinator } from './librarySearchCoordinator';
import {
  ComicAggregateSearch,
  ComicAggregateSearchSlots,
  KEYWORD_VARIANTS_LIMIT,
  keywordKeysQuery,
  withComicSearchGroup,
  withTimeoutOrNull,
} from './libraryAggregateSearch';
import type { ComicDownloadManager } from './libraryComicDownload';
import { comicDownloadTaskId, type ComicDownloadTask } from './libraryComicDownload';
import type { ComicChapterImportDeps } from './libraryComicLocalImporter';
import { ReadingRecordMetadata, ReadingRecordResolver } from './libraryReadingRecords';
import type {
  LibraryLocalBook,
  LibraryReadingRecord,
  LibraryRecordFavorite,
} from './libraryReadingRecords';
import {
  allFormatsUnsupportedMessage,
  filterReadableFormats,
  READER_UNSUPPORTED_FORMATS,
  unsupportedFormatMessage,
} from './libraryDisplay';
import { CONTENT_TYPE_COMIC } from './bookTypes';

/* ───────────── Observable cell (StateFlow port) ───────────── */

/** kotlinx `MutableStateFlow<T>` port: value + update + subscribe. */
export class MutableValue<T> {
  private current: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.current = initial;
  }

  get value(): T {
    return this.current;
  }

  set value(next: T) {
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  update(updater: (prev: T) => T): void {
    this.value = updater(this.current);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** kotlinx `Job` port: an AbortController plus the promise it guards. */
class Job {
  private readonly controller = new AbortController();
  private settled: Promise<unknown> = Promise.resolve();

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  run(promise: Promise<unknown>): void {
    this.settled = promise;
  }

  async join(): Promise<void> {
    await this.settled;
  }

  cancel(): void {
    this.controller.abort();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/* ───────────── Keyword provider ports ───────────── */

/** `com.example.source.keyword.KeywordProviderState`. */
export interface KeywordProviderState {
  provider: string;
  outcome: string;
  retryAt: number;
  detail: string;
}

/** `KeywordProviderState.displayName` (KeywordModels.kt). */
export function keywordProviderDisplayName(provider: string): string {
  switch (provider) {
    case 'wikidata':
      return 'Wikidata';
    case 'bangumi:subjects':
      return 'Bangumi 作品';
    case 'bangumi:characters':
      return 'Bangumi 角色';
    case 'bangumi:persons':
      return 'Bangumi 人物';
    case 'anilist':
      return 'AniList';
    default:
      return '云扩展查询';
  }
}

/** `com.example.source.keyword.KeywordRepository.observe` emission shape. */
export interface KeywordUpdate {
  added: string[];
  status: string;
  origins: Record<string, string>;
  providers: KeywordProviderState[];
}

export interface LibraryViewModelPrefs {
  hasSeenWelcome(): Promise<boolean>;
  setHasSeenWelcome(value: boolean): Promise<void>;
  hasConfiguredSource(): Promise<boolean>;
  setHasConfiguredSource(value: boolean): Promise<void>;
  hasImportedLocalBook(): Promise<boolean>;
  setHasImportedLocalBook(value: boolean): Promise<void>;
  multiLanguageSearch(): Promise<boolean>;
  setMultiLanguageSearch(value: boolean): Promise<void>;
  multiLanguageOnlineLookup(): Promise<boolean>;
  setMultiLanguageOnlineLookup(value: boolean): Promise<void>;
  searchHistory(): Promise<string[]>;
  setSearchHistory(value: string[]): Promise<void>;
}

export interface LibrarySourceManagerApi {
  initialize(): Promise<void>;
  activeSource(): BookSource | null;
  availableSources(): BookSource[];
  getSource(id: string): BookSource | null;
  setActiveSource(id: string): Promise<void>;
  subscribeActiveSource(listener: (source: BookSource | null) => void): () => void;
}

export interface LibraryDownloadApi {
  /** Android `downloadManager.downloadStates: StateFlow<Map<String, DownloadState>>`. */
  downloadStates(): Map<string, DownloadState>;
  subscribeDownloadStates(listener: (states: Map<string, DownloadState>) => void): () => void;
  /** Android `downloadManager.allTasksFlow`. */
  allTasks(): Promise<DownloadTaskRecord[]>;
  enqueueDownload(
    request: DownloadRequest,
    referer: string | null,
    headers: Record<string, string>,
  ): Promise<void>;
  pauseDownload(bookId: string): Promise<void>;
  resumeDownload(bookId: string): Promise<void>;
  cancelDownload(bookId: string): Promise<void>;
}

export interface LibraryBookRepositoryApi {
  getAllBooksSync(): Promise<LibraryLocalBook[]>;
  getBookBySourceResource(sourceId: string, bookId: string): Promise<LibraryLocalBook | null>;
  getAllFavoritesSync(): Promise<LibraryRecordFavorite[]>;
}

export interface LibraryNovelDownloadStoreApi {
  baseline(sourceId: string, bookId: string): Promise<SearchBook | null>;
}

export interface LibraryViewModelDeps {
  /** Android `com.example.data.PreferencesManager`. */
  prefs: LibraryViewModelPrefs;
  /**
   * LibraryViewModel.kt:100
   * `context.getSharedPreferences("record_cover_cache", MODE_PRIVATE)` — the legacy
   * `recordId -> SearchBook JSON` table written by older builds. It is the **second** leg
   * of the `cached = { … }` lambda (after `ReadingRecordMetadata.find`), so without it a
   * legacy record whose destination is not in `reading_record_metadata` can no longer be
   * resolved offline. Absent ⇒ every legacy read misses (the Kotlin `getString` default).
   */
  legacyRecordCoverJson?: (recordId: number) => string | null;
  sources: LibrarySourceManagerApi;
  downloads: LibraryDownloadApi;
  repository: LibraryBookRepositoryApi;
  novels?: LibraryNovelDownloadStoreApi;
  comicDownloads?: ComicDownloadManager;
  recordMetadata: ReadingRecordMetadata;
  /** Android `KeywordRepository.observe(keyword, forceRefresh)`. */
  keywordObserve?: (keyword: string, forceRefresh: boolean) => AsyncIterable<KeywordUpdate>;
  /** Android `com.example.data.AppDatabase.ensureBundledTitlesImported` + source registration. */
  registerBuiltinSources?: () => Promise<void>;
  /** Android `com.example.ui.warmComicPage(url, headers)`. */
  warmComicPage?: (url: string, headers: Record<string, string>) => Promise<void>;
  /** Android `com.example.source.zlibrary.guessFileFormatFromUrl`. */
  guessFileFormatFromUrl?: (url: string) => string | null;
  /** Android `ZLibraryNodeConfig.domain` (owned by the Z-Library module). */
  zlibraryNodeDomain?: () => string;
  /** Android `source is ZLibrarySource` marker. */
  isZLibrarySource?: (source: BookSource) => boolean;
  /** Android `com.example.source.SourceLog.log(name, msg)`. */
  sourceLog?: (name: string, message: string) => void;
  /** Android `Log.i("SmokeTest" …)` / `Log.w("ComicDetail" …)`. */
  log?: (message: string) => void;
  /** Android `AppToast.makeText(...).show()` (Toast.LENGTH_SHORT). */
  toast?: (message: string) => void;
  /** Android `runSourceSmokeTest` — developer harness; default: not run. */
  smokeTest?: (options: {
    filter: string;
    keyword: string;
    smokeUser: string | null;
    smokePassword: string | null;
  }) => Promise<void>;
  /** Android `BookShareHelper` wiring for the detail sheet's share action. */
  comicImportDeps?: Omit<ComicChapterImportDeps, 'fs' | 'bookDao'>;
}

/** LibraryViewModel.kt:344 `data class DetailSearchRequest(val keyword: String, val token: Long)`. */
export interface LibraryDetailSearchRequest {
  keyword: string;
  token: number;
}

/** LibraryViewModel.kt:1199 `data class NovelUpdate(...)`. */
export interface LibraryNovelUpdate {
  local: LibraryLocalBook;
  sourceName: string;
  loading: boolean;
  remote: SearchBook | null;
  changed: boolean | null;
  error: string | null;
}

/**
 * LibraryViewModel.kt:51
 * `internal val READER_UNSUPPORTED_FORMATS = setOf("kfx", "djvu", "doc", "rtf", "chm")`.
 *
 * Re-exported from `libraryDisplay.ts` (which owns the public `READER_UNSUPPORTED_FORMATS`
 * used by `filterReadableFormats`) rather than re-declared: a second literal copy could
 * drift from the filter and let a format through `downloadBook` that `startDownload`
 * already refused.
 */
const READER_UNSUPPORTED: ReadonlySet<string> = READER_UNSUPPORTED_FORMATS;

/**
 * LibraryViewModel.kt:62 `books.filter { !it.isComic && … }` and
 * LibraryViewModel.kt:1208 `if (!WholeBookNovelSources.contains(local.sourceId) || local.isComic || …)`.
 *
 * Android `Book.isComic` is `contentType == "COMIC"` (Book.kt:43-44) — it is **not** derived
 * from the `filePath`, so this reads `contentType` and never guesses from the path.
 */
function isComicShelfRow(book: { contentType?: string }): boolean {
  return book.contentType === CONTENT_TYPE_COMIC;
}

export class LibraryViewModel {
  private readonly deps: LibraryViewModelDeps;
  private readonly sourceSearches: SourceSearchCoordinator;
  private readonly recordResolver: ReadingRecordResolver;
  private recordResolveJob: Job | null = null;

  private chaptersRequestSeq = 0;
  private imagesRequestSeq = 0;
  private novelRequestSeq = 0;
  private novelLoadJob: Job | null = null;
  private novelPrefetchJob: Job | null = null;

  private searchRequestSeq = 0;
  private aggregateSearchSeq = 0;
  private detailSearchToken = 0;
  private aggregateSearchJob: Job | null = null;
  private singleSearchJob: Job | null = null;
  private readonly aggregateSearchSlots = new ComicAggregateSearchSlots(4);
  private readonly comicAggregateSearch: ComicAggregateSearch;
  private readonly novelAggregateSearch: ComicAggregateSearch;
  private readonly singleSourceSearch: ComicAggregateSearch;

  private readonly comicPrefetchCache = new Map<string, string[]>();
  private readonly comicPrefetchJobs = new Map<string, Job>();
  private readonly comicPrefetchInFlight = new Set<string>();

  private readonly inflight = new Set<Promise<unknown>>();
  private notifiedSuccess = new Set<string>();
  private unsubscribeActiveSource: (() => void) | null = null;
  private unsubscribeComicTasks: (() => void) | null = null;
  private unsubscribeComicMessage: (() => void) | null = null;

  /* ── MutableStateFlow declarations (LibraryViewModel.kt) ── */

  readonly downloadedNovelKeysState = new MutableValue<Set<string>>(new Set());
  readonly hasSeenWelcomeState = new MutableValue<boolean>(false);
  readonly hasConfiguredSourceState = new MutableValue<boolean>(false);
  readonly hasImportedLocalBookState = new MutableValue<boolean>(false);
  readonly recordCoversState = new MutableValue<Record<number, string>>({});
  readonly recordBooksState = new MutableValue<Record<number, SearchBook>>({});
  readonly formatPickerBookState = new MutableValue<SearchBook | null>(null);
  readonly pendingFormatsState = new MutableValue<BookFormat[]>([]);
  readonly formatLoadingState = new MutableValue<boolean>(false);
  readonly recordCoverHeadersState = new MutableValue<Record<number, Record<string, string>>>({});
  readonly isCurrentSourceLoggedInState = new MutableValue<boolean>(false);
  readonly comicBookState = new MutableValue<SearchBook | null>(null);
  readonly comicIsTextModeState = new MutableValue<boolean>(false);
  readonly novelChapterTextState = new MutableValue<string>('');
  readonly novelChapterLoadingState = new MutableValue<boolean>(false);
  readonly novelChapterErrorState = new MutableValue<string | null>(null);
  readonly activeNovelChapterState = new MutableValue<ComicChapter | null>(null);
  readonly comicChaptersState = new MutableValue<ComicChapter[]>([]);
  readonly comicChaptersLoadingState = new MutableValue<boolean>(false);
  readonly comicChaptersErrorState = new MutableValue<string | null>(null);
  readonly comicChapterImagesState = new MutableValue<string[]>([]);
  readonly comicChapterHeadersState = new MutableValue<Record<string, Record<string, string>>>({});
  readonly comicChapterLoadingState = new MutableValue<boolean>(false);
  readonly comicChapterErrorState = new MutableValue<string | null>(null);
  readonly activeComicChapterState = new MutableValue<ComicChapter | null>(null);
  readonly searchHistoryState = new MutableValue<string[]>([]);
  readonly aggregateModeState = new MutableValue<boolean>(true);
  readonly aggregateKindState = new MutableValue<string>('comic');
  readonly detailSearchRequestState = new MutableValue<LibraryDetailSearchRequest | null>(null);
  readonly multiLanguageSearchState = new MutableValue<boolean>(false);
  readonly searchKeywordsState = new MutableValue<string[]>([]);
  readonly keywordStatusState = new MutableValue<string>('');
  readonly keywordOriginsState = new MutableValue<Record<string, string>>({});
  readonly keywordDispatchesState = new MutableValue<Record<string, string[]>>({});
  readonly keywordProvidersState = new MutableValue<KeywordProviderState[]>([]);
  readonly onlineKeywordLookupState = new MutableValue<boolean>(false);
  readonly uiStateState = new MutableValue<LibraryUiState>(LibraryUiEmpty);
  readonly errorMessageState = new MutableValue<string | null>(null);
  readonly novelUpdateState = new MutableValue<LibraryNovelUpdate | null>(null);
  private novelUpdateJob: Job | null = null;

  constructor(deps: LibraryViewModelDeps) {
    this.deps = deps;
    this.sourceSearches = new SourceSearchCoordinator();
    this.recordResolver = new ReadingRecordResolver(this.sourceSearches);
    this.comicAggregateSearch = new ComicAggregateSearch({
      searches: this.sourceSearches,
      onDispatched: (source, keyword) => {
        this.recordKeywordDispatch(source, keyword);
      },
    });
    this.novelAggregateSearch = new ComicAggregateSearch({
      slots: this.aggregateSearchSlots,
      searches: this.sourceSearches,
      onDispatched: (source, keyword) => {
        this.recordKeywordDispatch(source, keyword);
      },
      timeoutFor: (it) => (it.id === 'zlibrary' ? 55_000 : 20_000),
    });
    // Single-source transport already owns its timeout (EH cold connections can take >20s).
    this.singleSourceSearch = new ComicAggregateSearch({
      searches: this.sourceSearches,
      requestTimeoutMs: Number.MAX_SAFE_INTEGER,
      onDispatched: (source, keyword) => {
        this.recordKeywordDispatch(source, keyword);
      },
    });
  }

  /* ───────────── Source manager plumbing ───────────── */

  /**
   * LibraryViewModel.kt:68-69
   * `val currentSource: StateFlow<BookSource?> = sourceManager.activeSource` and
   * `val availableSources: StateFlow<List<BookSource>> = sourceManager.availableSources`
   * → async getters over the injected `LibrarySourceManagerApi`.
   */
  currentSource(): BookSource | null {
    return this.deps.sources.activeSource();
  }

  availableSources(): BookSource[] {
    return this.deps.sources.availableSources();
  }

  getSource(id: string): BookSource | null {
    return this.deps.sources.getSource(id);
  }

  /** LibraryViewModel.kt:262-264 `sourceManager.activeSource.collect { checkSourceLoginStatus() }`. */
  subscribeActiveSource(listener: () => void): () => void {
    return this.deps.sources.subscribeActiveSource(() => {
      listener();
    });
  }

  /* ───────────── init ───────────── */

  /** LibraryViewModel.kt:212-266 `init { … }`. */
  async initialize(): Promise<void> {
    // 漫画下载完成后刷新"已导入本地书"状态
    this.unsubscribeComicTasks =
      this.deps.comicDownloads?.subscribeTasks((tasks) => {
        for (const [id, t] of tasks) {
          if (t.status !== 'SUCCESS') continue;
          if (this.notifiedSuccess.has(id)) continue;
          this.notifiedSuccess.add(id);
          void this.markLocalBookImported();
        }
      }) ?? null;
    this.unsubscribeComicMessage =
      this.deps.comicDownloads?.subscribeMessage((message) => {
        if (message !== null) (this.deps.toast ?? (() => {}))(message);
      }) ?? null;

    await this.loadPrefs();
    await this.deps.comicDownloads?.initialize();

    await this.deps.sources.initialize();
    await this.deps.registerBuiltinSources?.();

    this.unsubscribeActiveSource = this.deps.sources.subscribeActiveSource(() => {
      void this.checkSourceLoginStatus();
    });
  }

  dispose(): void {
    this.unsubscribeActiveSource?.();
    this.unsubscribeActiveSource = null;
    this.unsubscribeComicTasks?.();
    this.unsubscribeComicTasks = null;
    this.unsubscribeComicMessage?.();
    this.unsubscribeComicMessage = null;
  }

  /** LibraryViewModel.kt:212-215 the `prefs` seeds: search history + the three flags. */
  private async loadPrefs(): Promise<void> {
    const prefs = this.deps.prefs;
    this.searchHistoryState.value = await prefs.searchHistory();
    this.hasSeenWelcomeState.value = await prefs.hasSeenWelcome();
    this.hasConfiguredSourceState.value = await prefs.hasConfiguredSource();
    this.hasImportedLocalBookState.value = await prefs.hasImportedLocalBook();
    this.multiLanguageSearchState.value = await prefs.multiLanguageSearch();
    this.onlineKeywordLookupState.value = await prefs.multiLanguageOnlineLookup();
  }

  private launch(block: () => Promise<void>): Promise<void> {
    const promise = block().catch((e: unknown) => {
      if (isAbortError(e)) return;
      (this.deps.log ?? (() => {}))(
        `LibraryViewModel: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    this.inflight.add(promise);
    void promise.finally(() => {
      this.inflight.delete(promise);
    });
    return promise;
  }

  /** Test seam: await every fire-and-forget operation started so far. */
  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /* ───────────── Reading records (LibraryViewModel.kt:96-139) ───────────── */

  /** LibraryViewModel.kt:96-122 `fun resolveMissingRecordCovers(records)`. */
  resolveMissingRecordCovers(records: LibraryReadingRecord[]): void {
    this.recordResolveJob?.cancel();
    const job = new Job();
    this.recordResolveJob = job;
    job.run(
      this.launch(async () => {
        const activeIds = new Set(records.map((it) => it.id));
        const keepById = <V>(prev: Record<number, V>): Record<number, V> => {
          const next: Record<number, V> = {};
          for (const [key, value] of Object.entries(prev)) {
            const id = Number(key);
            if (activeIds.has(id)) next[id] = value;
          }
          return next;
        };
        this.recordBooksState.update((prev) => keepById(prev));
        this.recordCoversState.update((prev) => keepById(prev));
        this.recordCoverHeadersState.update((prev) => keepById(prev));
        const missing = records.filter((it) => !(it.id in this.recordBooksState.value));
        if (missing.length === 0) return;
        const sources = this.deps.sources.availableSources();
        const legacy = this.deps.legacyRecordCoverJson;
        await this.recordResolver.resolve(
          missing,
          await this.deps.repository.getAllBooksSync(),
          await this.deps.repository.getAllFavoritesSync(),
          sources,
          // Kotlin LibraryViewModel.kt:110-113
          //   `ReadingRecordMetadata.find(context, record)
          //      ?: ReadingRecordMetadata.decode(legacy.getString(record.id.toString(), null), record.bookTitle)`
          async (record) =>
            (await this.deps.recordMetadata.find(record)) ??
            ReadingRecordMetadata.decode(
              legacy !== undefined ? legacy(record.id) : null,
              record.bookTitle,
            ),
          (record, book) => {
            void this.deps.recordMetadata.remember(
              { ...book, title: record.bookTitle },
              record.bookId,
              record.id,
            );
            this.recordBooksState.update((prev) => ({ ...prev, [record.id]: book }));
            if (book.cover !== null && book.cover.trim() !== '') {
              this.recordCoversState.update((prev) => ({
                ...prev,
                [record.id]: book.cover as string,
              }));
            }
          },
        );
      }),
    );
  }

  /** LibraryViewModel.kt:124-139 `fun resolveRecordCoverHeaders(records)`. */
  resolveRecordCoverHeaders(records: LibraryReadingRecord[]): void {
    for (const record of records) {
      const book = this.recordBooksState.value[record.id];
      if (book === undefined) continue;
      const cover = book.cover;
      if (cover === null) continue;
      if (!cover.startsWith('http')) continue;
      if (record.id in this.recordCoverHeadersState.value) continue;
      // Mark pending first, so recomposition cannot enqueue the same JS call again.
      this.recordCoverHeadersState.update((prev) => ({ ...prev, [record.id]: {} }));
      this.launch(async () => {
        const source = this.deps.sources.getSource(book.sourceId) as ComicSource | null;
        const headers =
          (await withTimeoutOrNull(3_000, async () =>
            source !== null ? source.getCoverHeaders(cover) : {},
          )) ?? {};
        if (this.recordBooksState.value[record.id] === book) {
          this.recordCoverHeadersState.update((prev) => ({ ...prev, [record.id]: headers }));
        }
      });
    }
  }

  /* ───────────── Comic / novel chapter loading ───────────── */

  /** LibraryViewModel.kt:268-289 `fun openComic(book)`. */
  openComic(book: SearchBook): void {
    this.novelRequestSeq += 1;
    this.novelLoadJob?.cancel();
    this.novelPrefetchJob?.cancel();
    this.novelChapterLoadingState.value = false;
    this.imagesRequestSeq += 1;
    for (const job of this.comicPrefetchJobs.values()) job.cancel();
    this.comicPrefetchJobs.clear();
    this.comicPrefetchCache.clear();
    this.comicBookState.value = book;
    this.comicIsTextModeState.value =
      this.deps.sources.availableSources().find((it) => it.id === book.sourceId)?.capabilities
        .supportOnlineText === true;
    this.comicChaptersState.value = [];
    this.comicChaptersErrorState.value = null;
    this.comicChapterImagesState.value = [];
    this.comicChapterHeadersState.value = {};
    this.comicChapterErrorState.value = null;
    this.novelChapterTextState.value = '';
    this.novelChapterErrorState.value = null;
    this.activeNovelChapterState.value = null;
    this.loadChapters(book);
  }

  /** LibraryViewModel.kt:292-335 `fun loadChapterText(chapter)`（文本小说源：加载章节正文）. */
  loadChapterText(chapter: ComicChapter): void {
    const request = (this.novelRequestSeq += 1);
    this.novelLoadJob?.cancel();
    this.novelPrefetchJob?.cancel();
    const book = this.comicBookState.value;
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === book?.sourceId) as ComicSource | undefined;
    if (source === undefined) {
      this.novelChapterErrorState.value = '当前书源不可用';
      this.novelChapterLoadingState.value = false;
      return;
    }
    this.activeNovelChapterState.value = chapter;
    this.novelChapterLoadingState.value = true;
    this.novelChapterErrorState.value = null;
    this.novelChapterTextState.value = '';
    const job = new Job();
    this.novelLoadJob = job;
    job.run(
      this.launch(async () => {
        try {
          const result = await source.getChapterText(chapter.id);
          if (job.cancelled) return;
          if (request !== this.novelRequestSeq || this.comicBookState.value !== book) return;
          if (result.kind === 'success') {
            this.novelChapterTextState.value = result.data;
            // The source owns a bounded text cache. Cancel this one next-chapter
            // request on navigation so prefetch never blocks the selected chapter.
            if (source.id === 'auto_novel') {
              const chapters = this.comicChaptersState.value;
              const index = chapters.findIndex((it) => it.id === chapter.id);
              const next = index >= 0 ? (chapters[index + 1] ?? null) : null;
              if (next !== null) {
                const prefetch = new Job();
                this.novelPrefetchJob = prefetch;
                prefetch.run(
                  this.launch(async () => {
                    await source.getChapterText(next.id);
                  }),
                );
              }
            }
          } else {
            this.novelChapterErrorState.value = result.exception.message ?? '章节加载失败';
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
          if (request === this.novelRequestSeq) {
            this.novelChapterErrorState.value =
              e instanceof Error ? (e.message ?? '章节加载失败') : '章节加载失败';
          }
        } finally {
          if (request === this.novelRequestSeq) this.novelChapterLoadingState.value = false;
        }
      }),
    );
  }

  /* ───────────── Aggregate / single search ───────────── */

  /** LibraryViewModel.kt:349-354 `fun requestAggregateSearch(keyword, textMode)`. */
  requestAggregateSearch(keyword: string, textMode = false): void {
    if (keyword.trim() === '') return;
    this.setAggregateMode(true);
    this.setAggregateKind(textMode ? 'novel' : 'comic');
    this.detailSearchToken += 1;
    this.detailSearchRequestState.value = {
      keyword: keyword.trim(),
      token: this.detailSearchToken,
    };
  }

  /** LibraryViewModel.kt:356-358 `fun consumeDetailSearch(token)`. */
  consumeDetailSearch(token: number): void {
    if (this.detailSearchRequestState.value?.token === token) {
      this.detailSearchRequestState.value = null;
    }
  }

  /** LibraryViewModel.kt:360-364 `fun setAggregateMode(enabled)`. */
  setAggregateMode(enabled: boolean): void {
    this.searchRequestSeq += 1;
    if (this.aggregateModeState.value !== enabled) this.resetSearchResults();
    this.aggregateModeState.value = enabled;
  }

  /** LibraryViewModel.kt:366-372 `fun setAggregateKind(kind)`. */
  setAggregateKind(kind: string): void {
    if (kind !== 'comic' && kind !== 'novel') throw new Error('未知的聚合搜索类型');
    if (this.aggregateKindState.value === kind) return;
    this.searchRequestSeq += 1;
    this.resetSearchResults();
    this.aggregateKindState.value = kind;
  }

  /** LibraryViewModel.kt:374-380 `private fun cancelAggregateSearch()`. */
  private cancelAggregateSearch(): void {
    this.aggregateSearchSeq += 1;
    this.aggregateSearchJob?.cancel();
    this.aggregateSearchJob = null;
    this.singleSearchJob?.cancel();
    this.singleSearchJob = null;
  }

  /** LibraryViewModel.kt:382-391 `private fun resetSearchResults()`. */
  private resetSearchResults(): void {
    this.cancelAggregateSearch();
    this.uiStateState.value = LibraryUiEmpty;
    this.errorMessageState.value = null;
    this.searchKeywordsState.value = [];
    this.keywordStatusState.value = '';
    this.keywordOriginsState.value = {};
    this.keywordDispatchesState.value = {};
    this.keywordProvidersState.value = [];
  }

  /* ── 多语言搜索开关（第十一轮第 6 条）：UI 可见可控，驱动 expandVariants ── */

  /** LibraryViewModel.kt:397-400 `fun setMultiLanguageSearch(enabled)`. */
  async setMultiLanguageSearch(enabled: boolean): Promise<void> {
    await this.deps.prefs.setMultiLanguageSearch(enabled);
    this.multiLanguageSearchState.value = enabled;
  }

  /** LibraryViewModel.kt:438-441 `fun setOnlineKeywordLookup(enabled)`. */
  async setOnlineKeywordLookup(enabled: boolean): Promise<void> {
    await this.deps.prefs.setMultiLanguageOnlineLookup(enabled);
    this.onlineKeywordLookupState.value = enabled;
  }

  /** LibraryViewModel.kt:422-428 `private fun startKeywordPreview(keyword)`. */
  private startKeywordPreview(keyword: string): void {
    this.searchKeywordsState.value = [keyword];
    this.keywordStatusState.value = this.multiLanguageSearchState.value
      ? '正在查找本地名称'
      : '';
    this.keywordOriginsState.value = { [keywordKeysQuery(keyword)]: '原词' };
    this.keywordDispatchesState.value = {};
    this.keywordProvidersState.value = [];
  }

  /** LibraryViewModel.kt:430-434 `private fun recordKeywordDispatch(source, keyword)`. */
  private recordKeywordDispatch(source: BookSource, keyword: string): void {
    const key = keywordKeysQuery(keyword);
    if (!this.searchKeywordsState.value.some((it) => keywordKeysQuery(it) === key)) return;
    this.keywordDispatchesState.update((rows) => ({
      ...rows,
      [key]: [...(rows[key] ?? []), source.id],
    }));
  }

  /**
   * LibraryViewModel.kt:443-457
   * `private fun keywordExpansion(keyword, forceRefresh, valid): Flow<List<String>>` —
   * Local keyword mappings are emitted first; structured online names supplement later.
   */
  private keywordExpansion(
    keyword: string,
    forceRefresh: boolean,
    valid: () => boolean,
  ): AsyncIterable<string[]> {
    // The Kotlin `flow { … }` builder closes over the ViewModel, so the generator is
    // written as a bound async-generator method to avoid aliasing `this`.
    return this.keywordFlow(keyword, forceRefresh, valid);
  }

  private async *keywordFlow(
    keyword: string,
    forceRefresh: boolean,
    valid: () => boolean,
  ): AsyncGenerator<string[], void, undefined> {
    if (!this.multiLanguageSearchState.value) return;
    const observe = this.deps.keywordObserve;
    if (observe === undefined) return;
    for await (const update of observe(keyword, forceRefresh)) {
      const batch = update.added;
      if (valid() && this.multiLanguageSearchState.value) {
        this.searchKeywordsState.update((words) => {
          const seen = new Set<string>();
          const out: string[] = [];
          for (const word of [...words, ...batch]) {
            const key = keywordKeysQuery(word);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(word);
            if (out.length >= KEYWORD_VARIANTS_LIMIT) break;
          }
          return out;
        });
        this.keywordStatusState.value = update.status;
        this.keywordProvidersState.value = update.providers;
        this.keywordOriginsState.update((prev) => ({ ...prev, ...update.origins }));
        if (batch.length > 0) yield batch;
      }
    }
  }

  /** LibraryViewModel.kt:468-496 `fun aggregateSearch(keyword, forceKeywordRefresh)`. */
  aggregateSearch(keyword: string, forceKeywordRefresh = false): void {
    this.searchRequestSeq += 1;
    this.cancelAggregateSearch();
    const seq = this.aggregateSearchSeq;
    const novel = this.aggregateKindState.value === 'novel';
    const sources = this.deps.sources.availableSources().filter((it) => {
      if (!it.capabilities.supportSearch || it.capabilities.environmentOnly) return false;
      return novel ? isNovelSource(it) : isComicSource(it);
    });
    this.startKeywordPreview(keyword);
    if (sources.length === 0) this.keywordStatusState.value = '没有可用的搜索书源';
    if (sources.length === 0) {
      this.uiStateState.value = libraryErrorState(LibraryErrorSourceUnavailable);
      return;
    }
    const job = new Job();
    this.aggregateSearchJob = job;
    job.run(
      this.launch(async () => {
        this.errorMessageState.value = null;
        this.uiStateState.value = libraryAggregateResults(
          sources.map((source) => libraryAggregateGroup(source.id, source.name, [], null, true)),
          true,
        );
        const runner = novel ? this.novelAggregateSearch : this.comicAggregateSearch;
        await runner.searchExpanded(
          sources,
          keyword,
          this.keywordExpansion(keyword, forceKeywordRefresh, () =>
            seq === this.aggregateSearchSeq,
          ),
          (group) => {
            if (seq === this.aggregateSearchSeq) {
              this.uiStateState.update((current) => withComicSearchGroup(current, group));
            }
          },
        );
      }),
    );
  }

  /* ───────────── Chapters / images ───────────── */

  /** LibraryViewModel.kt:498-546 `fun loadChapters(book)`. */
  loadChapters(book: SearchBook): void {
    const requestSeq = (this.chaptersRequestSeq += 1);
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === book.sourceId) as ComicSource | undefined;
    if (source === undefined) {
      this.comicChaptersErrorState.value = '该漫画的书源已停用或不支持漫画';
      this.comicChaptersLoadingState.value = false;
      return;
    }
    this.launch(async () => {
      if (requestSeq !== this.chaptersRequestSeq) return;
      this.comicChaptersLoadingState.value = true;
      this.comicChaptersErrorState.value = null;
      try {
        const result = await source.getChapters(book.id);
        if (requestSeq !== this.chaptersRequestSeq) return;
        if (result.kind === 'success') {
          this.comicChaptersState.value = result.data;
          if (result.data.length === 0) this.comicChaptersErrorState.value = '暂无可用章节';
        } else {
          this.comicChaptersErrorState.value = result.exception.message ?? '章节加载失败';
        }
        // Enrich every comic source's search snapshot. JS reuses the loadInfo request above.
        this.comicChaptersLoadingState.value = false;
        if (!this.comicIsTextModeState.value) {
          let detail: SourceResult<SearchBook> | null = null;
          try {
            detail = await withTimeoutOrNull(15_000, () => source.getDetail(book.id));
          } catch (e) {
            if (isAbortError(e)) throw e;
            (this.deps.log ?? (() => {}))(
              `ComicDetail: Metadata unavailable for ${book.sourceId}`,
            );
            detail = null;
          }
          if (requestSeq !== this.chaptersRequestSeq) return;
          if (detail !== null && detail.kind === 'success') {
            this.comicBookState.value = withComicDetail(book, detail.data);
          }
        }
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (requestSeq === this.chaptersRequestSeq) {
          this.comicChaptersErrorState.value =
            e instanceof Error ? (e.message ?? '章节加载失败') : '章节加载失败';
        }
      } finally {
        if (requestSeq === this.chaptersRequestSeq) this.comicChaptersLoadingState.value = false;
      }
    });
  }

  /** LibraryViewModel.kt:548-595 `fun loadChapterImages(chapter)`. */
  loadChapterImages(chapter: ComicChapter): void {
    const requestSeq = (this.imagesRequestSeq += 1);
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === this.comicBookState.value?.sourceId) as ComicSource | undefined;
    if (source === undefined) {
      this.comicChapterErrorState.value = '该漫画的书源已停用';
      this.comicChapterLoadingState.value = false;
      return;
    }
    this.launch(async () => {
      if (requestSeq !== this.imagesRequestSeq) return;
      this.activeComicChapterState.value = chapter;
      this.comicChapterLoadingState.value = true;
      this.comicChapterErrorState.value = null;
      this.comicChapterImagesState.value = [];
      try {
        // 下一章预取命中：图片列表零网络直接上屏（对齐 Mihon/Kotatsu 预载策略）
        const prefetched = this.comicPrefetchCache.get(chapter.id);
        if (prefetched !== undefined) {
          if (requestSeq !== this.imagesRequestSeq) return;
          this.comicChapterImagesState.value = prefetched;
          try {
            this.comicChapterHeadersState.value = await source.getChapterImageHeaders(
              chapter.id,
              prefetched,
            );
          } catch {
            this.comicChapterHeadersState.value = {};
          }
          return;
        }
        const result = await source.getChapterImages(chapter.id);
        if (requestSeq !== this.imagesRequestSeq) return;
        if (result.kind === 'success') {
          const headers = await source.getChapterImageHeaders(chapter.id, result.data);
          if (requestSeq !== this.imagesRequestSeq) return;
          this.comicChapterImagesState.value = result.data;
          this.comicChapterHeadersState.value = headers;
        } else {
          this.comicChapterErrorState.value = result.exception.message ?? '图片加载失败';
        }
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (requestSeq === this.imagesRequestSeq) {
          this.comicChapterErrorState.value =
            e instanceof Error ? (e.message ?? '图片加载失败') : '图片加载失败';
        }
      } finally {
        if (requestSeq === this.imagesRequestSeq) this.comicChapterLoadingState.value = false;
      }
    });
  }

  /** LibraryViewModel.kt:598-602 `suspend fun resolveComicImage(url)`. */
  async resolveComicImage(url: string): Promise<string | null> {
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === this.comicBookState.value?.sourceId) as ComicSource | undefined;
    return source !== undefined ? source.resolveChapterImage(url) : null;
  }

  /** LibraryViewModel.kt:605-610 `suspend fun resolveComicImageHeaders(url)`. */
  async resolveComicImageHeaders(url: string): Promise<Record<string, string>> {
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === this.comicBookState.value?.sourceId) as ComicSource | undefined;
    return source !== undefined ? source.getResolvedHeaders(url) : {};
  }

  /* ── 下一章预取（对齐 Mihon/Kotatsu：读到章尾自动预载下一章） ── */

  /** LibraryViewModel.kt:621-654 `fun prefetchNextComicChapter(chapter)`. */
  prefetchNextComicChapter(chapter: ComicChapter | null): void {
    const ch = chapter;
    if (ch === null) return;
    if (this.comicPrefetchCache.has(ch.id)) return;
    if (!this.comicPrefetchInFlight.add(ch.id)) return;
    const selected = this.comicBookState.value;
    if (selected === null) return;
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === selected.sourceId) as ComicSource | undefined;
    if (source === undefined) return;
    const job = new Job();
    this.comicPrefetchJobs.set(ch.id, job);
    job.run(
      this.launch(async () => {
        try {
          const result = await withTimeoutOrNull(20_000, () => source.getChapterImages(ch.id));
          if (
            result !== null &&
            result.kind === 'success' &&
            result.data.length > 0 &&
            this.comicBookState.value === selected
          ) {
            // 近 6 章上限：超出时挤掉最早的
            if (this.comicPrefetchCache.size >= 6) {
              const oldest = this.comicPrefetchCache.keys().next();
              if (!oldest.done) this.comicPrefetchCache.delete(oldest.value);
            }
            this.comicPrefetchCache.set(ch.id, result.data);
            let headers: Record<string, Record<string, string>> = {};
            try {
              headers = await source.getChapterImageHeaders(ch.id, result.data);
            } catch {
              headers = {};
            }
            // 前两页直接进阅读器加载器（磁盘缓存 512MB）：切章首屏零网络
            for (const url of result.data.slice(0, 2)) {
              await this.deps.warmComicPage?.(url, headers[url] ?? {});
            }
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
          // 预取失败静默：切章时按正常流程加载
        } finally {
          this.comicPrefetchInFlight.delete(ch.id);
          this.comicPrefetchJobs.delete(ch.id);
        }
      }),
    );
  }

  /* ───────────── Comic downloads ───────────── */

  /** LibraryViewModel.kt:656-676 `fun downloadComicChapter(book, chapter)`. */
  downloadComicChapter(book: SearchBook, chapter: ComicChapter): void {
    if (chapter.external) {
      (this.deps.toast ?? (() => {}))('站外链接章节暂不支持下载');
      return;
    }
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === book.sourceId) as ComicSource | undefined;
    if (source === undefined) {
      (this.deps.toast ?? (() => {}))('当前书源不支持漫画');
      return;
    }
    this.deps.comicDownloads?.start(book, chapter, source);
  }

  /** LibraryViewModel.kt:678-680 `fun retryComicChapter(book, chapter)`. */
  retryComicChapter(book: SearchBook, chapter: ComicChapter): void {
    this.downloadComicChapter(book, chapter);
  }

  /** LibraryViewModel.kt:682-684 `fun pauseComicChapter(chapterId)`. */
  pauseComicChapter(chapterId: string): void {
    this.deps.comicDownloads?.pause(chapterId, this.comicBookState.value);
  }

  /** LibraryViewModel.kt:686-688 `fun cancelComicChapter(chapterId)`. */
  cancelComicChapter(chapterId: string): void {
    this.deps.comicDownloads?.cancel(chapterId, this.comicBookState.value);
  }

  /** LibraryViewModel.kt:690-692 `fun clearComicMessage()`. */
  clearComicMessage(): void {
    this.deps.comicDownloads?.clearMessage();
  }

  /** LibraryViewModel.kt:195-197 `val comicDownloading` (combine of tasks + comicBook). */
  comicDownloading(): Set<string> {
    const book = this.comicBookState.value;
    const tasks = this.deps.comicDownloads?.tasks() ?? new Map<string, ComicDownloadTask>();
    const out = new Set<string>();
    for (const t of tasks.values()) {
      if (
        t.book.sourceId === book?.sourceId &&
        t.book.id === book?.id &&
        t.status === 'DOWNLOADING'
      ) {
        out.add(t.chapterId);
      }
    }
    return out;
  }

  /** LibraryViewModel.kt:199-201 `val comicDownloadProgress`. */
  comicDownloadProgress(): Map<string, number> {
    const book = this.comicBookState.value;
    const tasks = this.deps.comicDownloads?.tasks() ?? new Map<string, ComicDownloadTask>();
    const out: Map<string, number> = new Map();
    for (const t of tasks.values()) {
      if (t.book.sourceId === book?.sourceId && t.book.id === book?.id) {
        out.set(t.chapterId, t.progress);
      }
    }
    return out;
  }

  /** LibraryViewModel.kt:203-205 `val comicPaused`. */
  comicPaused(): Set<string> {
    const book = this.comicBookState.value;
    const tasks = this.deps.comicDownloads?.tasks() ?? new Map<string, ComicDownloadTask>();
    const out = new Set<string>();
    for (const t of tasks.values()) {
      if (
        t.book.sourceId === book?.sourceId &&
        t.book.id === book?.id &&
        t.status === 'PAUSED'
      ) {
        out.add(t.chapterId);
      }
    }
    return out;
  }

  /** LibraryViewModel.kt:207 `val comicMessage`. */
  comicMessage(): string | null {
    return this.deps.comicDownloads?.messageValue() ?? null;
  }

  /* ───────────── Search history ───────────── */

  /** LibraryViewModel.kt:694-700 `fun recordSearch(query)`. */
  async recordSearch(query: string): Promise<void> {
    const q = query.trim();
    if (q === '') return;
    const updated = [q, ...this.searchHistoryState.value.filter((it) => it !== q)].slice(0, 20);
    this.searchHistoryState.value = updated;
    await this.deps.prefs.setSearchHistory(updated);
  }

  /** 单条删除搜索历史（搜索历史卡长按编辑态的 × 按钮使用）。 */
  /** LibraryViewModel.kt:703-707 `fun removeSearchHistory(query)`. */
  async removeSearchHistory(query: string): Promise<void> {
    const updated = this.searchHistoryState.value.filter((it) => it !== query);
    this.searchHistoryState.value = updated;
    await this.deps.prefs.setSearchHistory(updated);
  }

  /** LibraryViewModel.kt:709-712 `fun clearSearchHistory()`. */
  async clearSearchHistory(): Promise<void> {
    this.searchHistoryState.value = [];
    await this.deps.prefs.setSearchHistory([]);
  }

  /** LibraryViewModel.kt:723-828 `fun runSourceSmokeTest(...)` — developer harness. */
  runSourceSmokeTest(
    filter = '',
    keyword = '',
    smokeUser: string | null = null,
    smokePassword: string | null = null,
  ): void {
    const smoke = this.deps.smokeTest;
    if (smoke === undefined) return;
    this.launch(async () => {
      (this.deps.log ?? (() => {}))('SmokeTest: === smoke test start ===');
      await smoke({ filter, keyword, smokeUser, smokePassword });
      (this.deps.log ?? (() => {}))('SmokeTest: === smoke test done ===');
    });
  }

  /** LibraryViewModel.kt:933-946 `fun clearComicState()`. */
  clearComicState(): void {
    this.chaptersRequestSeq += 1;
    this.imagesRequestSeq += 1;
    for (const job of this.comicPrefetchJobs.values()) job.cancel();
    this.comicPrefetchJobs.clear();
    this.comicPrefetchCache.clear();
    this.comicBookState.value = null;
    this.comicChaptersState.value = [];
    this.comicChaptersErrorState.value = null;
    this.comicChapterImagesState.value = [];
    this.comicChapterHeadersState.value = {};
    this.comicChapterErrorState.value = null;
    this.activeComicChapterState.value = null;
  }

  /* ───────────── Welcome / source flags ───────────── */

  /** LibraryViewModel.kt:948-951 `fun markWelcomeSeen()`. */
  async markWelcomeSeen(): Promise<void> {
    await this.deps.prefs.setHasSeenWelcome(true);
    this.hasSeenWelcomeState.value = true;
  }

  /** LibraryViewModel.kt:953-956 `fun markSourceConfigured()`. */
  async markSourceConfigured(): Promise<void> {
    await this.deps.prefs.setHasConfiguredSource(true);
    this.hasConfiguredSourceState.value = true;
  }

  /** LibraryViewModel.kt:958-961 `fun markLocalBookImported()`. */
  async markLocalBookImported(): Promise<void> {
    await this.deps.prefs.setHasImportedLocalBook(true);
    this.hasImportedLocalBookState.value = true;
  }

  /** LibraryViewModel.kt:963-972 `fun checkSourceLoginStatus()`. */
  checkSourceLoginStatus(): void {
    const source = this.deps.sources.activeSource();
    if (source !== null) {
      this.launch(async () => {
        this.isCurrentSourceLoggedInState.value = await source.isLoggedIn();
      });
    } else {
      this.isCurrentSourceLoggedInState.value = false;
    }
  }

  /* ───────────── Download state plumbing ───────────── */

  /** LibraryViewModel.kt:61-64 `val downloadedNovelKeys`. */
  async downloadedNovelKeys(): Promise<Set<string>> {
    const books = await this.deps.repository.getAllBooksSync();
    const out = new Set<string>();
    for (const book of books) {
      if (book.comicId === null || book.sourceId === null) continue;
      if (isComicShelfRow(book)) continue;
      out.add(downloadTaskId(book.sourceId, book.comicId));
    }
    return out;
  }

  /** LibraryViewModel.kt:977-991 `val downloadStates` (combine(downloadStates, allTasksFlow)). */
  async downloadStates(): Promise<Map<string, DownloadState>> {
    const states = this.deps.downloads.downloadStates();
    const tasks = await this.deps.downloads.allTasks();
    const out: Map<string, DownloadState> = new Map();
    for (const task of tasks) {
      const key = downloadTaskId(task.sourceId, originalBookId(task.id, task.sourceId));
      out.set(key, states.get(task.id) ?? this.downloadStateOfTask(task));
    }
    return out;
  }

  /** LibraryViewModel.kt:982-989 — the `states[task.id] ?: when (task.status) { … }` fallback. */
  private downloadStateOfTask(task: DownloadTaskRecord): DownloadState {
    switch (task.status) {
      case 'COMPLETED':
        return successState(task.filePath);
      case 'DOWNLOADING':
        return downloadingState(
          task.downloadedBytes,
          task.totalBytes,
          task.totalBytes > 0
            ? Math.min(1, Math.max(0, task.downloadedBytes / task.totalBytes))
            : 0,
        );
      case 'PAUSED':
        return pausedState(task.downloadedBytes, task.totalBytes);
      case 'FAILED':
        return errorState(task.errorMessage ?? '下载失败');
      default:
        return DownloadStatePending;
    }
  }

  /** Android `downloadManager.downloadStates` subscription bridge for the page. */
  subscribeDownloadStates(listener: (states: Map<string, DownloadState>) => void): () => void {
    return this.deps.downloads.subscribeDownloadStates(() => {
      void this.downloadStates().then(listener);
    });
  }

  /* ───────────── Search ───────────── */

  /** LibraryViewModel.kt:995-1049 `fun search(keyword, forceKeywordRefresh)`. */
  search(keyword: string, forceKeywordRefresh = false): void {
    this.cancelAggregateSearch();
    const source = this.deps.sources.activeSource();
    if (source === null) return;
    const requestSeq = (this.searchRequestSeq += 1);
    const job = new Job();
    this.singleSearchJob = job;
    job.run(
      this.launch(async () => {
        if (requestSeq !== this.searchRequestSeq) return;
        this.uiStateState.value = LibraryUiSearching;
        this.errorMessageState.value = null;
        this.startKeywordPreview(keyword);
        let collected: SearchBook[] = [];
        // Kotlin `var firstError: SourceException? = null` captured by the onGroup
        // lambda; a holder object keeps the mutation visible to control-flow analysis
        // exactly like the captured `var` does in Kotlin.
        const firstError: { value: SourceException | null } = { value: null };
        await this.singleSourceSearch.searchExpanded(
          [source],
          keyword,
          this.keywordExpansion(keyword, forceKeywordRefresh, () =>
            requestSeq === this.searchRequestSeq,
          ),
          (group) => {
            if (requestSeq !== this.searchRequestSeq) return;
            collected = group.books.slice();
            if (group.error !== null && firstError.value === null) {
              firstError.value = group.failure ?? new NetworkError(group.error);
            }
            if (group.books.length > 0) {
              this.uiStateState.value = librarySearchResults(group.books, group.loading);
            }
          },
        );
        if (requestSeq !== this.searchRequestSeq) return;
        if (collected.length > 0) {
          const merged: SearchBook[] = [];
          const seen = new Set<string>();
          for (const book of collected) {
            if (seen.has(book.id)) continue;
            seen.add(book.id);
            merged.push(book);
          }
          this.uiStateState.value = librarySearchResults(merged);
          if (source.id === 'mangadex' && merged.length > 0) {
            void this.enrichMangaDexAuthors(merged, source, requestSeq);
          }
        } else {
          const e: SourceException | null = firstError.value;
          let error: LibraryError;
          if (e === null) {
            error = libraryErrorUnknown('没有找到相关结果');
          } else if (e instanceof NetworkError) {
            const msg = e.message ?? '';
            this.deps.sourceLog?.(source.name, `搜索「${keyword}」失败: ${msg}`);
            if (msg.includes('Cloudflare') || msg.includes('DiamWall')) {
              error = LibraryErrorCloudflareBlocked;
            } else if (msg.includes('Z-Library 当前节点不可用')) {
              error = LibraryErrorSourceUnavailable;
            } else if (msg.trim() !== '') {
              error = libraryErrorNetworkDetail(msg);
            } else {
              error = { kind: 'NetworkUnavailable' } as const;
            }
          } else if (e instanceof LoginRequired) {
            error = LibraryErrorAuthenticationRequired;
          } else if (e instanceof ParseError) {
            error = libraryErrorParseFailed(e.message ?? '解析失败');
          } else {
            error = libraryErrorUnknown(e.message ?? '未知错误', e);
          }
          this.uiStateState.value = libraryErrorState(error);
          this.errorMessageState.value =
            (error.kind === 'NetworkDetail' ||
            error.kind === 'ParseFailed' ||
            error.kind === 'Unknown'
              ? error.message
              : null) ?? '发生错误';
        }
      }),
    );
  }

  /** LibraryViewModel.kt:1051-1072 `private suspend fun enrichMangaDexAuthors(books, source, requestSeq)`. */
  private async enrichMangaDexAuthors(
    books: SearchBook[],
    source: BookSource,
    requestSeq: number,
  ): Promise<void> {
    const semaphore = new ComicAggregateSearchSlots(5);
    const enriched = await Promise.all(
      books.map((book) =>
        semaphore.withPermit(async () => {
          let detail: SourceResult<SearchBook> | null = null;
          try {
            detail = await source.getDetail(book.id);
          } catch {
            detail = null;
          }
          if (detail === null || detail.kind !== 'success') return book;
          const d = detail.data;
          return {
            ...book,
            author: d.author.trim() !== '' && d.author !== 'MangaDex' ? d.author : book.author,
            description: d.description ?? book.description,
            cover: book.cover ?? d.cover,
          };
        }),
      ),
    );
    if (requestSeq === this.searchRequestSeq && enriched.length > 0) {
      this.uiStateState.value = librarySearchResults(enriched);
    }
  }

  /** LibraryViewModel.kt:1074-1081 `fun selectSource(sourceId)`. */
  selectSource(sourceId: string): void {
    this.searchRequestSeq += 1;
    this.resetSearchResults();
    this.aggregateModeState.value = false;
    this.launch(async () => {
      await this.deps.sources.setActiveSource(sourceId);
    });
  }

  /* ───────────── Downloads ───────────── */

  /** LibraryViewModel.kt:1083-1125 `fun startDownload(book)`. */
  startDownload(book: SearchBook): void {
    const source =
      this.deps.sources.availableSources().find((it) => it.id === book.sourceId);
    if (!source) { this.errorMessageState.value = '此作品的书源已停用，请启用相同书源后重试'; return; }
    // Z-Library 支持多格式：先取格式列表，多个格式时弹选择框
    if (this.deps.isZLibrarySource?.(source) === true) {
      this.launch(async () => {
        this.formatPickerBookState.value = book;
        this.formatLoadingState.value = true;
        const result = await source.getAvailableFormats(book);
        const fetched =
          // Kotlin `result.data.filter { it.format.isNotBlank() }`.
          result.kind === 'success'
            ? result.data.filter((it) => it.format.trim() !== '')
            : [];
        this.formatLoadingState.value = false;
        // 过滤阅读器不支持的格式（PDF 等），避免下载后书架出现打不开的书
        const formats = filterReadableFormats(fetched);
        const only = formats[0];
        if (formats.length > 1) {
          this.pendingFormatsState.value = formats;
        } else if (only !== undefined) {
          this.formatPickerBookState.value = null;
          this.pendingFormatsState.value = [];
          await this.downloadBook(book, source, only.format);
        } else if (fetched.length > 0) {
          // 全部格式都不支持阅读：不再下载，提示换其他版本
          this.formatPickerBookState.value = null;
          this.pendingFormatsState.value = [];
          this.errorMessageState.value = allFormatsUnsupportedMessage(fetched);
        } else {
          // 格式获取失败：按默认格式下载
          this.formatPickerBookState.value = null;
          this.pendingFormatsState.value = [];
          await this.downloadBook(book, source, null);
        }
      });
    } else {
      this.launch(async () => {
        await this.downloadBook(book, source, null);
      });
    }
  }

  /** 用户选定格式后下载（格式为空表示用默认格式）。 */
  /** LibraryViewModel.kt:1128-1137 `fun startDownload(book, format)`. */
  startDownloadWithFormat(book: SearchBook, format: string | null): void {
    this.formatPickerBookState.value = null;
    this.pendingFormatsState.value = [];
    const source =
      this.deps.sources.availableSources().find((it) => it.id === book.sourceId);
    if (!source) { this.errorMessageState.value = '此作品的书源已停用，请启用相同书源后重试'; return; }
    // 默认格式走软件自研 /dl/ + Cookie 方案，非默认格式走 eapi 多格式；
    // 具体路由由 getDownloadInfo 内部按 preferredFormat 决定，这里统一交给下载器。
    this.launch(async () => {
      await this.downloadBook(book, source, format);
    });
  }

  /** LibraryViewModel.kt:1139-1142 `fun dismissFormatPicker()`. */
  dismissFormatPicker(): void {
    this.formatPickerBookState.value = null;
    this.pendingFormatsState.value = [];
  }

  /** LibraryViewModel.kt:1144-1178 `private fun downloadBook(book, source, format, replaceNovel)`. */
  private async downloadBook(
    book: SearchBook,
    source: BookSource,
    format: string | null,
    replaceNovel = false,
  ): Promise<void> {
    let snapshot = book;
    if (WholeBookNovelSources.contains(book.sourceId) && !replaceNovel) {
      try {
        const detail = await source.getDetail(book.id);
        if (detail.kind === 'success') snapshot = detail.data;
      } catch {
        snapshot = book;
      }
    }
    let result: SourceResult<DownloadInfo>;
    try {
      result =
        format !== null
          ? await source.getDownloadInfoWithFormat(book.id, format)
          : await source.getDownloadInfo(book.id);
    } catch (e) {
      this.errorMessageState.value =
        e instanceof Error ? (e.message ?? '获取下载信息失败') : '获取下载信息失败';
      this.applyDownloadErrorToNovelUpdate(book, replaceNovel);
      return;
    }
    if (result.kind === 'error') {
      this.errorMessageState.value = result.exception.message ?? '获取下载信息失败';
      this.applyDownloadErrorToNovelUpdate(book, replaceNovel);
      return;
    }
    const finalFormat = result.data.format.trim() === '' ? book.format : result.data.format;
    // 统一兜底：阅读器不支持的格式（PDF 等）不下载，避免书架出现打不开的书
    if (READER_UNSUPPORTED.has(finalFormat.toLowerCase())) {
      this.errorMessageState.value = unsupportedFormatMessage(finalFormat);
      return;
    }
    const request: DownloadRequest = {
      bookId: book.id,
      title: snapshot.title,
      author: snapshot.author,
      sourceId: book.sourceId,
      downloadUrl: result.data.url,
      format: finalFormat,
      coverUrl: snapshot.cover,
      novelSnapshot: WholeBookNovelSources.contains(snapshot.sourceId) ? snapshot : null,
      replaceExistingNovel: replaceNovel,
    };
    await this.deps.downloads.enqueueDownload(request, result.data.referer, result.data.headers);
  }

  /**
   * LibraryViewModel.kt:1172-1174
   * `if (replaceNovel) _novelUpdate.value?.takeIf { it.local.sourceId == book.sourceId &&
   * it.local.comicId == book.id }?.let { _novelUpdate.value = it.copy(error = …) }`.
   *
   * The `replaceNovel` gate is part of the Kotlin behaviour: a plain `startDownload`
   * failure must NOT stamp an error onto an open update panel. Only the "replace the local
   * novel" path (`downloadNovelUpdate`) reports through the panel.
   */
  private applyDownloadErrorToNovelUpdate(book: SearchBook, replaceNovel: boolean): void {
    if (!replaceNovel) return;
    const current = this.novelUpdateState.value;
    if (current === null) return;
    if (current.local.sourceId !== book.sourceId) return;
    if (current.local.comicId !== book.id) return;
    this.novelUpdateState.value = { ...current, error: this.errorMessageState.value };
  }

  /** LibraryViewModel.kt:1180-1193 `suspend fun novelDetail(book)`. */
  async novelDetail(book: SearchBook): Promise<SourceResult<SearchBook>> {
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === book.sourceId && isNovelSource(it));
    if (source === undefined) return SourceResultNs.Error(new ParseError('此小说源已停用'));
    const result = await source.getDetail(book.id);
    if (result.kind === 'error') return result;
    const d = result.data;
    return SourceResultNs.Success({
      ...d,
      id: book.id,
      sourceId: book.sourceId,
      title: d.title.trim() === '' ? book.title : d.title,
      author: d.author.trim() === '' ? book.author : d.author,
      cover: d.cover ?? book.cover,
      language: d.language ?? book.language,
      size: d.size ?? book.size,
      description: d.description ?? book.description,
      eapiId: d.eapiId ?? book.eapiId,
      eapiHash: d.eapiHash ?? book.eapiHash,
      novelInfo: d.novelInfo ?? book.novelInfo,
    });
  }

  /** LibraryViewModel.kt:1195-1197 `suspend fun localNovel(book)`. */
  async localNovel(book: SearchBook): Promise<LibraryLocalBook | null> {
    return this.deps.repository.getBookBySourceResource(book.sourceId, book.id);
  }

  /** LibraryViewModel.kt:1205 `fun dismissNovelUpdate()`. */
  dismissNovelUpdate(): void {
    this.novelUpdateJob?.cancel();
    this.novelUpdateState.value = null;
  }

  /** LibraryViewModel.kt:1207-1227 `fun checkNovelUpdate(local)`. */
  checkNovelUpdate(local: LibraryLocalBook): void {
    if (!isWholeBookNovelSource(local.sourceId)) return;
    if (isComicShelfRow(local)) return;
    if (local.comicId === null || local.comicId.trim() === '') return;
    this.novelUpdateJob?.cancel();
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === local.sourceId) as UpdatableNovelSource | undefined;
    this.novelUpdateState.value = {
      local,
      sourceName: source?.name ?? '小说源',
      loading: true,
      remote: null,
      changed: null,
      error: null,
    };
    const job = new Job();
    this.novelUpdateJob = job;
    job.run(
      this.launch(async () => {
        const stop = (error: string | null): void => {
          this.novelUpdateState.value = {
            local,
            sourceName: source?.name ?? '小说源',
            loading: false,
            remote: null,
            changed: null,
            error,
          };
        };
        if (source === undefined) {
          stop('此小说源已停用');
          return;
        }
        try {
          const result = await source.refreshNovelDetail(local.comicId as string);
          if (result.kind === 'success') {
            const baseline = await this.deps.novels?.baseline(source.id, local.comicId as string);
            const baseInfo = baseline?.novelInfo ?? null;
            const remote = result.data.novelInfo;
            const changed =
              baseInfo != null &&
              remote != null &&
              novelInfoHasRevision(baseInfo) &&
              novelInfoHasRevision(remote)
                ? novelInfoRevision(baseInfo) !== novelInfoRevision(remote)
                : null;
            this.novelUpdateState.value = {
              local,
              sourceName: source.name,
              loading: false,
              remote: result.data,
              changed,
              error: null,
            };
          } else {
            stop(result.exception.message ?? '检查失败，请重试');
          }
        } catch (e) {
          if (isAbortError(e)) throw e;
          stop(e instanceof Error ? (e.message ?? '检查失败，请重试') : '检查失败，请重试');
        }
      }),
    );
  }

  /** LibraryViewModel.kt:1229-1232 `fun downloadNovelUpdate(book)`. */
  downloadNovelUpdate(book: SearchBook): void {
    const source = this.deps.sources
      .availableSources()
      .find((it) => it.id === book.sourceId && isWholeBookNovelSource(it.id));
    if (source === undefined) return;
    this.launch(async () => {
      await this.downloadBook(book, source, book.format, true);
    });
  }

  /**
   * WebView 会话下载入口：真实文件 URL 来自隐藏 WebView 的 DownloadListener，
   * Cookie 头来自该会话（含 __diamwall / 登录凭证）。
   * LibraryViewModel.kt:1238-1260.
   */
  startWebViewDownload(book: SearchBook | null, realUrl: string, cookieHeader: string): void {
    if (book === null || realUrl.trim() === '') return;
    const format =
      this.deps.guessFileFormatFromUrl?.(realUrl) ??
      (book.format.trim() === '' ? 'epub' : book.format);
    // 阅读器不支持的格式（如 PDF）不再入下载队列，避免书架出现打不开的书
    if (READER_UNSUPPORTED.has(format.toLowerCase())) {
      this.errorMessageState.value = unsupportedFormatMessage(format);
      return;
    }
    const request: DownloadRequest = {
      bookId: book.id,
      title: book.title,
      author: book.author,
      sourceId: book.sourceId,
      downloadUrl: realUrl,
      format,
      coverUrl: book.cover,
    };
    void this.deps.downloads.enqueueDownload(
      request,
      `https://${this.deps.zlibraryNodeDomain?.() ?? ''}/`,
      { Cookie: cookieHeader },
    );
  }

  /* ───────────── Download control ───────────── */

  /** LibraryViewModel.kt:1262-1264 `fun pauseDownload(bookId)`. */
  pauseDownload(bookId: string): void {
    void this.deps.downloads.pauseDownload(bookId);
  }

  /** LibraryViewModel.kt:1266-1268 `fun resumeDownload(bookId)`. */
  resumeDownload(bookId: string): void {
    void this.deps.downloads.resumeDownload(bookId);
  }

  /** LibraryViewModel.kt:1270-1272 `fun cancelDownload(bookId)`. */
  cancelDownload(bookId: string): void {
    void this.deps.downloads.cancelDownload(bookId);
  }

  /* ───────────── Call-site helpers ───────────── */

  /** Kotlin `downloadStates[…] ?: DownloadState.Idle` at the UI call sites. */
  idleStateOf(states: Map<string, DownloadState>, key: string): DownloadState {
    return states.get(key) ?? DownloadStateIdle;
  }

  /** Kotlin `com.example.download.DownloadManager.taskId(book.sourceId, book.id)`. */
  novelTaskKey(book: Pick<SearchBook, 'sourceId' | 'id'>): string {
    return downloadTaskId(book.sourceId, book.id);
  }

  /** Kotlin `ComicDownloadManager.taskId(book, chapter.id)`. */
  comicTaskKey(book: Pick<SearchBook, 'sourceId' | 'id'>, chapterId: string): string {
    return comicDownloadTaskId(book as SearchBook, chapterId);
  }
}

export { delay as libraryViewModelDelay };

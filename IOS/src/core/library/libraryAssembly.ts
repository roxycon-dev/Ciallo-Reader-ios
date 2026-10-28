/**
 * `LibraryViewModel` 的宿主装配 —— 对应 Android
 * `com.example.library.LibraryViewModel` 的构造函数（`LibraryViewModel.kt:57-73`）：
 *
 * ```kotlin
 * class LibraryViewModel(application: Application) : AndroidViewModel(application) {
 *     val sourceManager = SourceManager(SharedPreferencesSourceStorage(application))   // L59
 *     val downloadManager = DownloadManager(application)                             // L62
 *     private val database = AppDatabase.getDatabase(application)                    // L67
 *     private val repository = BookRepository(application, database.bookDao())        // L68
 *     val prefs = com.example.data.PreferencesManager(application)                   // L73
 *     …
 * }
 * ```
 *
 * ## 为什么需要这个文件（E94）
 *
 * `libraryViewModel.ts`（1400+ 行）与它的全部依赖都已逐行移植、都有单测，但
 * `core/library/libraryRuntime.ts:52` 的 `setLibraryRuntime()` **全仓零调用方**，
 * 于是 `LibraryPage.tsx:2546` 的 `emptyRuntimeViewModel()`（18 个端口全是返回空值的桩）
 * 成了生产路径 —— 书库页的搜索、聚合搜索、关键词扩展、下载队列、书源管理、
 * 设置读取在 iOS 上全是空壳。
 *
 * 本模块是那个缺失的装配点。它**注入平台端口**（DB / FS / Settings / SecureStore / Http），
 * 不直接 import Capacitor，所以 `src/core/**` 仍然满足
 * `eslint.config.js` 的 `no-restricted-imports`（REVIEW_PROTOCOL 硬规则 3）。
 *
 * 装配顺序照 Kotlin L59→L73：SourceManager → DownloadManager → BookRepository → PreferencesManager。
 */

import { SourceManager } from '@core/source/sourceManager';
import type { SourceStorage } from '@core/source/sourceManager';
import { SharedPreferencesSourceStorage } from '@core/source/storage/sharedPreferencesSourceStorage';
import type { SourceConfigFilePort, SourcePrefsPort } from '@core/source/storage/sourceStorage';
import { DownloadManager } from '@core/download/downloadManager';
import type { DownloadTaskStore } from '@core/download/downloadTaskRepository';
import { DownloadProgressBroadcaster } from '@core/download/downloadProgressBroadcaster';
import { createDownloadTaskRepository } from '@core/download/downloadTaskRepository';
import { NovelDownloadStore } from '@core/download/novelDownloadStore';
import { BookRepository } from '@core/library/bookRepository';
import type { DatabaseLike } from '@core/library/bookRepository';
import { createFavoriteRepository } from '@core/library/favoriteRepository';
import type { FavoriteRepository } from '@core/library/favoriteRepository';
import type { FavoriteDao } from '@core/library/favoriteDao';
import type { ComicSourceResolver } from '@core/library/comicSourceTypes';
import type { BookshelfApi } from '@core/download/downloadWorker';
import type { NovelBookImporter } from '@core/download/downloadWorker';
import { ReadingRecordMetadata } from '@core/library/libraryReadingRecords';
import type {
  LibraryLocalBook,
  ReadingRecordMetadataPrefs,
} from '@core/library/libraryReadingRecords';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { createSearchBook } from '@core/source/searchBook';
import type { BookSource } from '@core/source/bookSource';
import { LibraryViewModel, type LibraryViewModelDeps } from './libraryViewModel';
import type { KeywordUpdate } from '@core/source/keyword/keywordModels';
import { setLibraryRuntime, type LibraryRuntime } from './libraryRuntime';
import type { FileSystemApi, HttpClient, SecureStore, SQLiteDatabase } from '@platform/interfaces';

/**
 * 平台端口 + 少量宿主决策。全部依赖注入 —— core 不碰 Capacitor。
 */
export interface LibraryAssemblyPorts {
  /** Shared with the source-management screen and online readers. */
  readonly sourceManager?: SourceManager;
  readonly novelImporter?: NovelBookImporter;
  readonly db: SQLiteDatabase;
  readonly fs: FileSystemApi;
  readonly http: HttpClient;
  readonly secrets: SecureStore;
  /** 书源配置的 SharedPreferences 端口（`SourcePrefsPort`）。 */
  readonly sourcePrefs: SourcePrefsPort;
  /** 书源配置文件读写（`source_configs/<sha256>.json`）。 */
  readonly sourceConfigs: SourceConfigFilePort;
  /** `DownloadManager.novels` 的偏好端口。 */
  readonly novelPrefs: {
    getString(key: string): Promise<string | null>;
    putString(key: string, value: string): Promise<boolean>;
    remove(key: string): Promise<void>;
  };
  /** `ReadingRecordMetadata` 的偏好端口。 */
  readonly recordMetadataPrefs: ReadingRecordMetadataPrefs;
  /** Android `AppDatabase.getDatabase(app).favoriteDao()` —— `FavoriteRepository` 需要它。 */
  readonly favoriteDao: FavoriteDao;
  /** Android `comicSourceOf` —— 收藏项回填书源名。 */
  readonly comicSourceOf: ComicSourceResolver;
  /** Android `downloadsDir`（`DownloadManager(application)` 内部解析的目录）。 */
  readonly downloadsDir: string;
  /** 内置书源注册（Android `AppDatabase.ensureBundledTitlesImported` 的近亲）。 */
  readonly registerBuiltinSources?: () => Promise<void>;
  /**
   * E60：Android `LibraryViewModel.kt:412-413`
   * `private val keywordRepository by lazy { KeywordRepository(application) }`。
   *
   * 六个 keyword 模块虽已逐行移植，但此前**没有任何调用方**，
   * 导致 `deps.keywordObserve` 恒为 `undefined` —— 多语言搜索时
   * `keywordFlow` 在 `libraryViewModel.ts:892` 直接 return，
   * 关键词扩展预览永远产不出词。
   *
   * 宿主应传 `buildKeywordObserve(ports)`（`core/source/keyword/keywordAssembly.ts`），
   * 它内部保留 Kotlin `by lazy` 语义：首次搜索时才建仓储。
   */
  readonly keywordObserve?: (keyword: string, forceRefresh: boolean) => AsyncIterable<KeywordUpdate>;
  /** Android `com.example.ui.warmComicPage(url, headers)`。 */
  readonly warmComicPage?: (url: string, headers: Record<string, string>) => Promise<void>;
  /** Android `ZLibraryNodeConfig.domain`。 */
  readonly zlibraryNodeDomain?: () => string;
  /** Android `source is ZLibrarySource` 判定。 */
  readonly isZLibrarySource?: (source: BookSource) => boolean;
  readonly openSourceLogin?: (source: BookSource) => void;
  /** Android `SourceLog.log(name, msg)`。 */
  readonly sourceLog?: (name: string, message: string) => void;
  /** Android `Log.i/w`。 */
  readonly log?: (message: string) => void;
  /** Android `AppToast.makeText(...).show()`。 */
  readonly toast?: (message: string) => void;
}

/** 已装配好的对象图，宿主可按需取用（测试与调试用）。 */
export interface LibraryAssembly {
  readonly viewModel: LibraryViewModel;
  readonly sourceManager: SourceManager;
  readonly downloadManager: DownloadManager;
  readonly repository: BookRepository;
  readonly favorites: FavoriteRepository;
  readonly prefs: PreferencesManager;
  readonly recordMetadata: ReadingRecordMetadata;
  readonly broadcaster: DownloadProgressBroadcaster;
  readonly downloadTasks: DownloadTaskStore;
}

/**
 * 装配 `LibraryViewModel`。
 *
 * 每一段都标注了它对应 Android 构造函数的哪一行 —— 便于逐行对拍。
 */
export function createLibraryAssembly(ports: LibraryAssemblyPorts): LibraryAssembly {
  // ── Android L59: SourceManager(SharedPreferencesSourceStorage(application)) ──
  const configFiles: SourceConfigFilePort = ports.sourceConfigs;
  const storage: SourceStorage = new SharedPreferencesSourceStorage({
    prefs: ports.sourcePrefs,
    files: configFiles,
  });
  const sourceManager = ports.sourceManager ?? new SourceManager(storage);

  // ── Android L62/L67: DownloadManager(application) ──
  //   `dao` ← `AppDatabase.getDatabase(app).downloadTaskDao()`
  const downloadTasks: DownloadTaskStore = createDownloadTaskRepository(ports.db);
  const broadcaster = new DownloadProgressBroadcaster();
  const novels = new NovelDownloadStore(ports.novelPrefs);
  const settingsRepo = new SettingsRepository(ports.db);
  const prefs = new PreferencesManager(settingsRepo);
  // Android L67/L68: BookRepository(application, database.bookDao())
  const repository = new BookRepository({
    db: ports.db as unknown as DatabaseLike,
    settings: prefs,
    ...(ports.log === undefined
      ? {}
      : { log: (tag: string, message: string) => ports.log?.(`${tag}: ${message}`) }),
  });
  // `BookshelfApi` (downloadWorker.ts) 需要两个方法；`BookRepository` 的返回行
  // 结构（`BOOK_COLUMNS`）本来就含 filePath / sourceId / comicId，窄化即可。
  const bookshelf: BookshelfApi = {
    getAllBooksSync: () => repository.getAllBooksSync(),
    getBookBySourceResource: (sourceId, bookId) =>
      repository.getBookBySourceResource(sourceId, bookId).then((row) =>
        // `BookshelfApi` 只要 `{ filePath: string }`；本地书一定有 filePath，
        // 远程导入的书（filePath 为 null）在这里被当作「不可分享」剔除，
        // 与 Kotlin `BookShareHelper.resolveShareTarget` 的判定一致。
        row === null || row.filePath === null ? null : { filePath: row.filePath },
      ),
  };
  const downloadManager = new DownloadManager({
    http: ports.http,
    fs: ports.fs,
    secrets: ports.secrets,
    novels,
    downloadsDir: ports.downloadsDir,
    dao: downloadTasks,
    books: bookshelf,
    broadcaster,
    ...(ports.novelImporter === undefined ? {} : { worker: { importer: ports.novelImporter } }),
    ...(ports.log === undefined ? {} : { log: ports.log }),
  });

  // ── Android `ReadingRecordMetadata(prefs)` ──
  const recordMetadata = new ReadingRecordMetadata(ports.recordMetadataPrefs);

  // ── 收藏：Android `FavoriteRepository(getDatabase(app).favoriteDao(), comicSourceOf)`
  //    `LibraryViewModel.getAllFavoritesSync()` 的数据来源。──
  // `fs` 在 `FavoriteRepositoryOptions` 里是可选的；`exactOptionalPropertyTypes` 下
  // 用条件展开会把它带上 `undefined`，所以分开构造。
  const favorites: FavoriteRepository =
    ports.fs === undefined
      ? createFavoriteRepository({ dao: ports.favoriteDao, comicSourceOf: ports.comicSourceOf })
      : createFavoriteRepository({
          dao: ports.favoriteDao,
          comicSourceOf: ports.comicSourceOf,
          fs: ports.fs,
        });

  // ── `LibraryViewModel(application)` 的 deps 装配 ──
  const deps: LibraryViewModelDeps = {
    // Android L73 `prefs = PreferencesManager(application)`。
    // `PreferencesManager` 只有 `hasSeenWelcome()` 这样的 getter，setter 走
    // `SettingsRepository.setBoolean(key, v)` —— 键名照抄各自的实现。
    prefs: {
      hasSeenWelcome: () => prefs.hasSeenWelcome(),
      setHasSeenWelcome: (v) => settingsRepo.setBoolean('has_seen_welcome', v),
      hasConfiguredSource: () => prefs.hasConfiguredSource(),
      setHasConfiguredSource: (v) => settingsRepo.setBoolean('has_configured_source', v),
      hasImportedLocalBook: () => prefs.hasImportedLocalBook(),
      setHasImportedLocalBook: (v) => settingsRepo.setBoolean('has_imported_local_book', v),
      multiLanguageSearch: () => prefs.multiLanguageSearch(),
      setMultiLanguageSearch: (v) => settingsRepo.setBoolean('multi_language_search', v),
      multiLanguageOnlineLookup: () => prefs.multiLanguageOnlineLookup(),
      setMultiLanguageOnlineLookup: (v) => prefs.setMultiLanguageOnlineLookup(v),
      searchHistory: () => prefs.searchHistory(),
      setSearchHistory: (v) => prefs.setSearchHistory(v),
    },
    sources: {
      initialize: () => sourceManager.initialize(),
      activeSource: () => sourceManager.activeSource.value,
      availableSources: () => sourceManager.availableSources.value,
      getSource: (id: string) => sourceManager.getSource(id),
      setActiveSource: (id: string) => sourceManager.setActiveSource(id),
      // `SourceManager.activeSource` 是 `StateFlow`，订阅走它自己的 `subscribe`。
      subscribeActiveSource: (listener) => sourceManager.activeSource.subscribe(listener),
    },
    downloads: {
      downloadStates: () => new Map(broadcaster.states),
      // `DownloadProgressBroadcaster.Listener` 收 `ReadonlyMap`，端口签名要 `Map`，
      // 快照已经是新 Map，直接转发。
      subscribeDownloadStates: (listener) =>
        broadcaster.subscribe(() => listener(new Map(broadcaster.states))),
      // Android `BackupManager.restoreBackupArchive` L31 读的是 `getAllTasksSync()`；
      // TS 侧的 `DownloadTaskStore.getAllTasks()` 就是它的等价物。
      allTasks: () => downloadTasks.getAllTasks(),
      enqueueDownload: (request, referer, headers) =>
        downloadManager.enqueueDownload(request, referer, headers),
      pauseDownload: (bookId) => downloadManager.pauseDownload(bookId),
      resumeDownload: (bookId) => downloadManager.resumeDownload(bookId),
      cancelDownload: (bookId) => downloadManager.cancelDownload(bookId),
    },
    repository: {
      // `BookRepository` 的行结构（`BOOK_COLUMNS`）与 `LibraryLocalBook` 一致，
      // 泛型不同而已 —— 窄化一次即可。
      getAllBooksSync: () => repository.getAllBooksSync() as Promise<LibraryLocalBook[]>,
      getBookBySourceResource: (sourceId, bookId) =>
        repository.getBookBySourceResource(sourceId, bookId) as Promise<LibraryLocalBook | null>,
      // `FavoriteEntity` → `LibraryRecordFavorite`：后者是前者在
      // `LibraryViewModel` 侧的窄化视图，字段逐一对应（前 5 个），逐字段显式映射
      // 而不是类型断言 —— 断言会在字段漂移时静默出错。
      getAllFavoritesSync: async () =>
        (await favorites.favorites()).map((f) => ({
          sourceId: f.sourceId,
          comicId: f.comicId,
          title: f.title,
          author: f.author,
          coverUrl: f.coverUrl,
          localThumbPath: f.localThumbPath,
        })),
    },
    novels: {
      // `NovelDownloadStore` 用的是 `downloadRequest.ts` 那份 `SearchBook`（字段全可选），
      // `LibraryViewModel` 要 `source/searchBook.ts` 那份（部分必填）。两份结构等价，
      // 用既有的 `createSearchBook()` 工厂做规范化（它就是为这个转换存在的）。
      baseline: async (sourceId, bookId) => {
        const raw = await novels.baseline(sourceId, bookId);
        if (raw === null) return null;
        // `exactOptionalPropertyTypes`：`createSearchBook` 的可选参数不能显式传
        // `undefined`，所以只传确实有值的字段（与它内部的 `?? null` 缺省等价）。
        return createSearchBook({
          id: raw.id,
          sourceId: raw.sourceId,
          title: raw.title,
          author: raw.author,
          cover: raw.cover ?? null,
          description: raw.description ?? null,
          format: raw.format ?? 'epub',
          language: raw.language ?? null,
          comicId: raw.comicId ?? null,
          size: raw.size ?? null,
          downloadUrl: raw.downloadUrl ?? null,
          eapiId: raw.eapiId ?? null,
          eapiHash: raw.eapiHash ?? null,
          // `novelInfo` 在两份 `SearchBook` 里来自不同模块（`downloadRequest` 的
          // 小说版 vs `source/novelInfo`），结构不同 —— 基线记录不需要它，置 null。
          novelInfo: null,
        });
      },
    },
    recordMetadata,
  };
  // 可选端口：`exactOptionalPropertyTypes` 下不能靠条件展开（会带上 `undefined`），
  // 只能在确认有值时逐个赋值。
  if (ports.registerBuiltinSources !== undefined) {
    deps.registerBuiltinSources = ports.registerBuiltinSources;
  }
  if (ports.keywordObserve !== undefined) deps.keywordObserve = ports.keywordObserve;
  if (ports.warmComicPage !== undefined) deps.warmComicPage = ports.warmComicPage;
  if (ports.zlibraryNodeDomain !== undefined) {
    deps.zlibraryNodeDomain = ports.zlibraryNodeDomain;
  }
  if (ports.isZLibrarySource !== undefined) {
    deps.isZLibrarySource = ports.isZLibrarySource;
  }
  if (ports.sourceLog !== undefined) deps.sourceLog = ports.sourceLog;
  if (ports.log !== undefined) deps.log = ports.log;
  if (ports.toast !== undefined) deps.toast = ports.toast;

  const viewModel = new LibraryViewModel(deps);
  return {
    viewModel,
    sourceManager,
    downloadManager,
    repository,
    favorites,
    prefs,
    recordMetadata,
    broadcaster,
    downloadTasks,
  };
}

/**
 * 装配并注册到 `libraryRuntime`，返回 runtime —— 宿主（App 启动处）一行即可接上。
 *
 * ⚠️ Android 的 `SourceManager` 需要 `initialize()` 才会加载持久化的书源状态
 * （`LibraryScreen` 的 `LaunchedEffect` 驱动）。这里**不**自动 initialize：
 * 由调用方按 UI 生命周期决定，避免在模块加载期就发起 IO。
 */
export function installLibraryRuntime(ports: LibraryAssemblyPorts): LibraryRuntime {
  const assembly = createLibraryAssembly(ports);
  const runtime: LibraryRuntime = {
    viewModel: assembly.viewModel,
    sourceManager: assembly.sourceManager,
    favorites: assembly.favorites,
    comicDownloads: null,
    shareHelper: null,
  };
  if (ports.openSourceLogin) runtime.openZLibraryLoginDialog = ports.openSourceLogin;
  setLibraryRuntime(runtime);
  return runtime;
}

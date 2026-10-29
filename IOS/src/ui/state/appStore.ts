/**
 * appStore — 全局状态中枢。
 *
 * Kotlin → TS 行号映射（本文件负责的那几处，其余字段的归属见 `src/core/app/mainViewModel.ts`）：
 *   `MainViewModel.kt` L364-365 `_autoNightMode` / `autoNightMode`   → `autoNightMode`（L…）＋ `setAutoNightModePreference`
 *   `MainViewModel.kt` L379-389 `_colorPrimaryIndex` / `_colorSecondaryIndex` / `_renderQuality` → `primaryIndex` / `secondaryIndex`
 *   `MainActivity.kt`  L418     `var selectedTab by rememberSaveable { mutableIntStateOf(1) }`
 *                                                              → `activeTab`（**默认 'bookshelf'**，见下）
 *   `MainActivity.kt`  L457     `if (viewModel.prefs.hasSeenOnboarding) "home" else "onboarding"`
 *                                                              → `hasSeenOnboarding`（本文件补了持久化）
 *   `MainViewModel.kt` L752-778 `importBook(...)` + `_importStatusMessage` → `importStatusMessage` / `finishImport`（`mainViewModel.ts`）
 *   `MainViewModel.kt` L1021-1048 `recordTime`                        → `mainViewModel.ts#recordTime`
 *   `MainActivity.kt`  L212-216 `MyApplicationTheme(darkTheme = autoNightMode, …)`
 *                                                              → `App.tsx` 写 `<html data-theme>`（不是 `prefers-color-scheme`）
 *
 * ── 本次审查修正（2026-10-06，逐行对照 Kotlin 后改） ──────────────────────────────
 *   BUG 1  `activeTab` 初值原为 `'library'`。Kotlin `MainActivity.kt` L418 是
 *          `mutableIntStateOf(1)`，而 `when (tab)` 的 1 分支是 **HomeScreen（书架）**，
 *          0 才是 LibraryScreen（书库）。首次冷启动落在哪个 Tab 与安卓相反 → 改成 `'bookshelf'`。
 *   MISSING 2 `hasSeenOnboarding` 只在内存里，刷新后永远回到 `false` → 引导页每次冷启动都重放。
 *          Kotlin 读写的是 `prefs.hasSeenOnboarding`（SharedPreferences，键 `has_seen_onboarding`），
 *          TS 的 `SettingsRepository.hasSeenOnboarding()` 已经存在但**没人调**。已在
 *          `bootstrapLibrary()` 里读、在 `setHasSeenOnboarding()` 里落库。
 *   MISSING 3 启动看门狗（Kotlin `MainActivity.kt` L119-140）此前完全没接线：`installBootGuard`
 *          零调用方，`docs/PARITY_EXCEPTIONS.md` E37 却写「语义一致」。已在 `bootstrapLibrary()`
 *          里、**任何 render_quality 读取之前**调用（与 Kotlin `onCreate` → `setContent` 的顺序一致）。
 */
import { create } from 'zustand';
import { BookRepository, ProgressSaveCoordinator } from '@core/library/bookRepository';
import type { BookRow, Bookmark, ChapterRow } from '@core/library/bookTypes';
import type { BootstrapAniListResult } from '@core/startup/bootstrapAnilist';
import type { CropParams } from '@core/god/godTypes';
// E50：shared-element 转场（对应 Kotlin `MainActivity.kt:472` 的 `SharedTransitionLayout`）。
import { withSharedElementTransition } from '@ui/shared/viewTransitions';

export type RouteKey =
  | 'splash'
  | 'onboarding'
  | 'main'
  | 'reader'
  | 'comicReader'
  | 'sourceManagement'
  | 'godRanking'
  | 'godEditor'
  | 'godCoverCrop'
  | 'comicChapters'
  | 'novelReaderOnline'
  | 'comicReaderOnline'
  | 'cacheManagement'
  | 'deviceTransfer';

/**
 * 神回封面裁剪信标（对应 Android GodCoverCropScreen 的入参 + 返回值）。
 * 编辑页设置 target → 跳 `godCoverCrop` → 裁剪页回写 result → 编辑页取用。
 */
export interface GodCropTarget {
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  initialCrop: CropParams;
}

let godCropTargetValue: GodCropTarget | null = null;
let godCropResultValue: CropParams | null = null;

export function setGodCropTarget(target: GodCropTarget): void {
  godCropTargetValue = target;
  godCropResultValue = null;
}

export function getGodCropTarget(): GodCropTarget | null {
  return godCropTargetValue;
}

export function clearGodCropTarget(): void {
  godCropTargetValue = null;
}

export function setGodCropResult(crop: CropParams | null): void {
  godCropResultValue = crop;
}

/** 读一次即清空（避免下次进入误用上一次的裁剪结果）。 */
export function takeGodCropResult(): CropParams | null {
  const value = godCropResultValue;
  godCropResultValue = null;
  return value;
}

export type TabKey = 'library' | 'discover' | 'bookshelf' | 'stats' | 'settings';

export interface Book {
  id: number;
  title: string;
  author: string;
  category: string;
  coverUri?: string;
  filePath?: string;
  currentChapterIndex: number;
  scrollOffset: number;
  totalChapters: number;
  lastReadTime: number;
  lastChapterTitle?: string;
}

export interface Category {
  id: number;
  name: string;
  isProtected: boolean;
}

export const READER_THEME_LABELS = ['纯白', '默认白', '羊皮纸', '夜间', '护眼绿', 'OLED'] as const;

export const READER_THEME_COLORS: ReadonlyArray<{ background: string; text: string }> = [
  { background: '#FFFFFF', text: '#222222' },
  { background: '#F7F7F7', text: '#333333' },
  { background: '#FBF0D9', text: '#5F4B32' },
  { background: '#18191C', text: '#D4D4D4' },
  { background: '#E8F5E9', text: '#1B5E20' },
  { background: '#000000', text: '#E0E0E0' },
];

export const PRIMARY_COLOR_LABELS = ['金色', '绿色', '蓝色', '橙色', '紫色'] as const;
export const SECONDARY_COLOR_LABELS = ['金色', '绿色', '蓝色', '橙色', '紫色'] as const;

export const FONT_FAMILY_LABELS = ['默认', '宋体', '黑体'] as const;
export const PAGE_TURN_LABELS = ['翻页', '滚动', '仿真'] as const;

let bookRepository: BookRepository | null = null;
let progressCoordinator: ProgressSaveCoordinator | null = null;
let anilistBootstrap: Promise<BootstrapAniListResult> | null = null;

/**
 * `has_seen_onboarding` 的落库助手（Kotlin `PreferencesManager.hasSeenOnboarding`，键名逐字照抄）。
 * 与 `setAutoNightModePreference` 同语义：落库失败不影响本次会话的行为，不抛。
 */
async function persistHasSeenOnboarding(seen: boolean): Promise<void> {
  try {
    const { getPlatform } = await import('@platform/index');
    const { SettingsRepository } = await import('@core/settings/settingsRepository');
    const settings = new SettingsRepository(getPlatform().db);
    await settings.setBoolean('has_seen_onboarding', seen);
  } catch {
    // 与 Android 单例 prefs 的失败语义一致：不抛
  }
}

export function setBookRepository(repo: BookRepository | null): void {
  bookRepository = repo;
  progressCoordinator = repo
    ? new ProgressSaveCoordinator((bookId, chapterIndex, scrollOffset, isFinished) =>
        repo.saveProgress(bookId, chapterIndex, scrollOffset, isFinished),
      )
    : null;
}

export function getBookRepository(): BookRepository | null {
  return bookRepository;
}

export function bookFromRow(row: BookRow): Book {
  const book: Book = {
    id: row.id ?? 0,
    title: row.title,
    author: row.author ?? '未知作者',
    category: row.category ?? '默认',
    currentChapterIndex: row.currentChapterIndex,
    scrollOffset: row.scrollOffset,
    totalChapters: row.totalChapters,
    lastReadTime: row.lastReadTime,
  };
  if (row.coverUri !== null) {
    book.coverUri = row.coverUri;
  }
  if (row.filePath !== null) {
    book.filePath = row.filePath;
  }
  return book;
}

interface AppState {
  route: RouteKey;
  activeTab: TabKey;
  readerTheme: number;
  primaryIndex: number;
  secondaryIndex: number;
  fontSize: number;
  fontFamilyIndex: number;
  pageTurnMode: number;
  autoNightMode: boolean;
  /**
   * 方向锁定（Android `MainViewModel.screenOrientationLock`，键 `screen_orientation_lock`）：
   * `0` 跟随系统 / `1` 锁定竖屏 / `2` 锁定横屏。
   * `MainActivity.kt:398-405` 的 `DisposableEffect(orientationLock)` 是**唯一**消费方，
   * 本项目在 `App.tsx` 里用 `orientationLock` 端口复刻那个 effect。
   */
  screenOrientationLock: number;
  privacyEnabled: boolean;
  hasSeenOnboarding: boolean;
  splashPureMode: boolean;
  currentBookId: number | null;
  books: Book[];
  categories: Category[];
  searchHistory: string[];
  chapters: ChapterRow[];
  bookmarks: Bookmark[];
  libraryReady: boolean;
  ensureAniListSeeded: () => Promise<BootstrapAniListResult>;
  setRoute: (route: RouteKey) => void;
  setTab: (tab: TabKey) => void;
  setReaderTheme: (i: number) => void;
  setPrimaryIndex: (i: number) => void;
  setSecondaryIndex: (i: number) => void;
  setFontSize: (size: number) => void;
  setFontFamilyIndex: (i: number) => void;
  setPageTurnMode: (i: number) => void;
  /** 夜间模式（Android `autoNightMode`）：写 store + 落库 `auto_night_mode`。 */
  setAutoNightModePreference: (enabled: boolean) => Promise<void>;
  /**
   * 方向锁定（Android `MainViewModel.kt:411 updateScreenOrientationLock(mode)`）：
   * 写 store + 落库 `screen_orientation_lock`。
   * ⚠️ **不**在这里直接调方向锁端口 —— Kotlin 也是靠
   * `MainActivity.kt:398` 的 `DisposableEffect(orientationLock)` 观察 state 变化
   * 才生效的，调用方（`App.tsx`）照抄同一结构。
   */
  setScreenOrientationLock: (mode: number) => Promise<void>;
  setPrivacyEnabled: (enabled: boolean) => void;
  setHasSeenOnboarding: (seen: boolean) => void;
  setSplashPureMode: (pure: boolean) => void;
  setCurrentBookId: (id: number | null) => void;
  loadLibrary: () => Promise<void>;
  restoreDownloads: () => Promise<void>;
  openBook: (bookId: number) => Promise<void>;
  saveReaderProgress: (chapterIndex: number, scrollOffset: number, isFinished?: boolean) => void;
  toggleBookmark: (
    chapterIndex: number,
    scrollOffset: number,
    title: string,
    snippet: string,
  ) => Promise<void>;
  importSampleBook: () => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  pushSearchHistory: (q: string) => void;
}

const SAMPLE_BOOKS: ReadonlyArray<Omit<Book, 'id' | 'lastReadTime'>> = [
  {
    title: '深夜书屋',
    author: '纯洁滴小龙',
    category: '悬疑',
    currentChapterIndex: 0,
    scrollOffset: 0,
    totalChapters: 1280,
  },
  {
    title: '大奉打更人',
    author: '卖报小郎君',
    category: '玄幻',
    currentChapterIndex: 12,
    scrollOffset: 0,
    totalChapters: 2000,
  },
  {
    title: '第一序列',
    author: '会说话的肘子',
    category: '末世',
    currentChapterIndex: 5,
    scrollOffset: 0,
    totalChapters: 1500,
  },
];

export const useAppStore = create<AppState>((set, get) => ({
  route: 'splash',
  /**
   * BUG 修正：`MainActivity.kt` L418 `var selectedTab by rememberSaveable { mutableIntStateOf(1) }`。
   * index 1 = `HomeScreen`（书架）；index 0 = `LibraryScreen`（书库）。见文件头。
   */
  activeTab: 'bookshelf',
  readerTheme: 0,
  // Android `Theme.kt` L36-37：`colorPrimaryIndex: Int = 2` / `colorSecondaryIndex: Int = 2`，
  // 也就是**绿**（BasePrimaryColors[2] = #059669，BaseSecondaryColors[2] = #10B981）。
  // 之前这里是 0/4（蓝 / 橙），首屏就跟安卓不一样了。
  primaryIndex: 2,
  secondaryIndex: 2,
  fontSize: 18,
  fontFamilyIndex: 0,
  pageTurnMode: 0,
  // Android `PreferencesManager.kt` L82 `autoNightMode`（默认 false），
  // 由 `MainActivity.kt` L213 `MyApplicationTheme(darkTheme = autoNightMode)` 消费。
  autoNightMode: false,
  // Android `PreferencesManager` 的 `screenOrientationLock`（键 `screen_orientation_lock`，
  // 默认 0 = 跟随系统）。`MainActivity.kt:399` 的 `when` 把 0 映射成
  // `SCREEN_ORIENTATION_UNSPECIFIED`，所以 0 必须是默认而不是"竖屏"。
  screenOrientationLock: 0,
  privacyEnabled: false,
  hasSeenOnboarding: false,
  splashPureMode: false,
  currentBookId: null,
  books: [],
  categories: [],
  searchHistory: [],
  chapters: [],
  bookmarks: [],
  libraryReady: false,

  ensureAniListSeeded: () => {
    anilistBootstrap ??= (async () => {
    await bootstrapLibrary();
    try {
      const { getPlatform } = await import('@platform/index');
      const { bootstrapAniListSeeding, createAniListAssetFetcher } = await import(
        '@core/startup/bootstrapAnilist'
      );
      const platform = getPlatform();
      return await bootstrapAniListSeeding({
        db: platform.db,
        secure: platform.secure,
        fetchAsset: createAniListAssetFetcher(platform.http),
      });
    } catch {
      return { seeded: false, rowCount: 0, durationMs: 0 };
    }
    })();
    return anilistBootstrap;
  },

  /**
   * E50：导航被 shared-element 转场包住。
   *
   * Kotlin 侧由 `MainActivity.kt:472` 的 `SharedTransitionLayout` 包住整个
   * `NavHost` 实现 —— 所有 `navigate()` 自动获得共享元素插值。本侧的唯一
   * 导航入口就是 `setRoute`，故在此包一次即可覆盖全部调用点（书库、书架、
   * 神回窗、漫画…），无需逐个改。
   *
   * 关键点：必须在 `set({ route })` **同步完成**后再让浏览器抓新旧快照，
   * 所以转场回调里只做这一件事；React 的重渲染由 store 订阅驱动。
   */
  setRoute: (route) => {
    // Startup already has its own fade. Snapshot overlays can swallow a quick
    // tap on the onboarding skip button while the splash transition is active.
    const liveReader = (value: RouteKey): boolean => ['reader', 'comicReader', 'novelReaderOnline', 'comicReaderOnline'].includes(value);
    if (get().route === 'splash' || get().route === 'onboarding' || liveReader(route) || liveReader(get().route)) {
      set({ route });
      return;
    }
    void withSharedElementTransition(() => {
      set({ route });
    });
  },
  setTab: (activeTab) => set({ activeTab }),
  setReaderTheme: (readerTheme) => set({ readerTheme }),
  setPrimaryIndex: (primaryIndex) => set({ primaryIndex }),
  setSecondaryIndex: (secondaryIndex) => set({ secondaryIndex }),
  setFontSize: (fontSize) => set({ fontSize }),
  setFontFamilyIndex: (fontFamilyIndex) => set({ fontFamilyIndex }),
  setPageTurnMode: (pageTurnMode) => set({ pageTurnMode }),

  /**
   * 夜间模式（Android `PreferencesManager.kt` L82-84 `autoNightMode`，键 `auto_night_mode`，默认 false）。
   * `MainActivity.kt` L213 用它当 `MyApplicationTheme(darkTheme = …)` 的入参。
   */
  setAutoNightModePreference: async (enabled) => {
    set({ autoNightMode: enabled });
    try {
      const { getPlatform } = await import('@platform/index');
      const { SettingsRepository } = await import('@core/settings/settingsRepository');
      const settings = new SettingsRepository(getPlatform().db);
      await settings.setBoolean('auto_night_mode', enabled);
    } catch {
      // 落库失败不影响本次会话的换肤（与 Android 单例 prefs 的失败语义一致：不抛）
    }
  },

  setPrivacyEnabled: (privacyEnabled) => set({ privacyEnabled }),
  /**
   * Android `MainViewModel.kt:411-413 updateScreenOrientationLock(mode)`：
   * `prefs.setScreenOrientationLock(mode)` + 写回 state。
   * 与 `setAutoNightModePreference` 同样的「落库失败不抛」语义
   * （Kotlin 的 SharedPreferences 写失败同样不该崩 UI）。
   */
  setScreenOrientationLock: async (mode) => {
    set({ screenOrientationLock: mode });
    try {
      const { getPlatform } = await import('@platform/index');
      const { SettingsRepository } = await import('@core/settings/settingsRepository');
      const settings = new SettingsRepository(getPlatform().db);
      await settings.setInt('screen_orientation_lock', mode);
    } catch {
      // 落库失败不影响本次会话的方向锁（与 Android 单例 prefs 的失败语义一致：不抛）
    }
  },
  /**
   * MISSING 修正：Kotlin `MainActivity.kt` L468 `viewModel.prefs.hasSeenOnboarding = true`
   * 写的是 SharedPreferences（`PreferencesManager.kt` L281-283，键 `has_seen_onboarding`）。
   * 原实现只 `set({ hasSeenOnboarding })`，刷新后引导页会重放；这里补上落库
   * （与 `setAutoNightModePreference` 同样的「失败不抛」语义）。
   */
  setHasSeenOnboarding: (seen) => {
    set({ hasSeenOnboarding: seen });
    void persistHasSeenOnboarding(seen);
  },
  setSplashPureMode: (splashPureMode) => set({ splashPureMode }),
  setCurrentBookId: (currentBookId) => set({ currentBookId }),

  loadLibrary: async () => {
    const repo = bookRepository;
    if (!repo) {
      set({ libraryReady: true });
      return;
    }
    const rows = await repo.getBookshelf();
    const categoryRows = await repo.listCategories();
    set({
      books: rows.map(bookFromRow),
      categories: categoryRows.map((row) => ({
        id: row.id ?? 0,
        name: row.name,
        isProtected: row.isProtected === 1,
      })),
      libraryReady: true,
    });
  },

  restoreDownloads: async () => {
    try {
      const { getPlatform } = await import('@platform/index');
      const { DownloadTaskRepository } = await import('@core/download/downloadTaskRepository');
      const { getOrCreateDownloadQueue } = await import('@core/download/downloadQueue');
      const platform = getPlatform();
      const queue = getOrCreateDownloadQueue({
        http: platform.http,
        maxConcurrent: 2,
        repository: new DownloadTaskRepository(platform.db),
      });
      await queue.restore();
    } catch {
      // best-effort restore at bootstrap
    }
  },

  openBook: async (bookId) => {
    const repo = bookRepository;
    set({ currentBookId: bookId });
    if (!repo) {
      set({ chapters: [], bookmarks: [] });
      return;
    }
    const chapters = await repo.listChapters(bookId);
    const bookmarks = await repo.getBookmarks(bookId);
    set({ chapters, bookmarks });
  },

  saveReaderProgress: (chapterIndex, scrollOffset, isFinished = false) => {
    const bookId = get().currentBookId;
    if (bookId == null) {
      return;
    }
    const chapterTitle = get().chapters[chapterIndex]?.title;
    set((state) => ({
      books: state.books.map((book) =>
        book.id === bookId
          ? {
              ...book,
              currentChapterIndex: chapterIndex,
              scrollOffset,
              lastReadTime: Date.now(),
              ...(chapterTitle !== undefined ? { lastChapterTitle: chapterTitle } : {}),
            }
          : book,
      ),
    }));
    if (progressCoordinator) {
      progressCoordinator.request(bookId, chapterIndex, scrollOffset, isFinished);
    } else if (bookRepository) {
      void bookRepository.saveProgress(bookId, chapterIndex, scrollOffset, isFinished);
    }
  },

  toggleBookmark: async (chapterIndex, scrollOffset, title, snippet) => {
    const repo = bookRepository;
    const bookId = get().currentBookId;
    if (!repo || bookId == null) {
      return;
    }
    const existing = get().bookmarks.find(
      (item) => item.bookId === bookId && item.chapterIndex === chapterIndex,
    );
    if (existing?.id != null) {
      await repo.removeBookmark(existing.id);
    } else {
      await repo.addBookmark({
        bookId,
        chapterIndex,
        scrollOffset,
        title,
        snippet,
        createdTime: Date.now(),
      });
    }
    const bookmarks = await repo.getBookmarks(bookId);
    set({ bookmarks });
  },

  importSampleBook: async () => {
    const repo = bookRepository;
    const state = get();
    const sample = SAMPLE_BOOKS[state.books.length % SAMPLE_BOOKS.length];
    if (!sample) {
      return;
    }
    const now = Date.now();
    if (repo) {
      await repo.insertBook({
        title: sample.title,
        author: sample.author,
        filePath: null,
        coverUri: null,
        category: sample.category,
        currentChapterIndex: sample.currentChapterIndex,
        scrollOffset: sample.scrollOffset,
        isFinished: 0,
        totalChapters: sample.totalChapters,
        contentType: 'novel',
        addedTime: now,
        lastReadTime: now,
        sourceId: null,
        comicId: null,
      });
      await get().loadLibrary();
      return;
    }
    const id = state.books.reduce((max, book) => (book.id > max ? book.id : max), 0) + 1;
    set({
      books: [
        ...state.books,
        {
          ...sample,
          id,
          lastReadTime: now,
        },
      ],
    });
  },

  addCategory: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const state = get();
    if (state.categories.some((category) => category.name === trimmed)) {
      return;
    }
    const repo = bookRepository;
    if (repo) {
      await repo.insertCategory(trimmed, 0);
      await get().loadLibrary();
      return;
    }
    const id = state.categories.reduce((max, category) => Math.max(max, category.id), 0) + 1;
    set({
      categories: [...state.categories, { id, name: trimmed, isProtected: false }],
    });
  },

  pushSearchHistory: (q) => {
    const query = q.trim();
    if (!query) {
      return;
    }
    set((state) => {
      const next = [query, ...state.searchHistory.filter((item) => item !== query)].slice(0, 10);
      return { searchHistory: next };
    });
  },
}));

let libraryBootstrap: Promise<void> | null = null;

/**
 * 启动水合：开库 → 装 BookRepository → 读书架 → 恢复下载任务。
 *
 * ⚠️ 这里**不做模块加载时自动执行**。早期版本在文件末尾直接
 * `void bootstrapLibrary()`，副作用会在 import 时就开库并异步写回 store，于是：
 *  - 单跑一个测试文件正常；全量并行跑时别的测试文件先开好了库，
 *    `bookRepository` 非空 → `importSampleBook` / `addCategory` 走异步 DB 分支，
 *    同步断言落空（appStore.test.ts 的 3 个假失败）。
 *  - 生产里也意味着「import 即开库」，导入顺序不可控。
 * 现在由 `App` 挂载时显式调用（见 `src/App.tsx`）：单一入口、可等待、可测。
 */
export function bootstrapLibrary(): Promise<void> {
  if (!libraryBootstrap) {
    libraryBootstrap = (async () => {
      performance.mark('app-bootstrap-start');
      const { reportStartup } = await import('@platform/ios-native/startupDiagnostics');
      await reportStartup('starting');
      const { getPlatform, getPlatformKind } = await import('@platform/index');
      const { openAppDatabase } = await import('@core/db/openDatabase');
      const platform = getPlatform();
      await openAppDatabase({ db: platform.db });
      if (getPlatformKind() === 'ios-native') {
        const { SETTINGS_TABLE_SQL } = await import('@core/settings/settingsRepository');
        const { createNativeTransferJournal } = await import('@platform/ios-native/transferJournalRuntime');
        await platform.db.execute(SETTINGS_TABLE_SQL);
        // Recover before publishing a repository, restoring downloads, or
        // constructing source caches that could observe a partial import.
        await createNativeTransferJournal(platform).recover();
      }
      performance.mark('app-database-ready');
      await reportStartup('starting', new Error('database: schema ready'));
      const repository = new BookRepository(platform.db);
      await repository.ensureDefaultCategory();
      setBookRepository(repository);
      await useAppStore.getState().loadLibrary();
      await useAppStore.getState().restoreDownloads();
      await reportStartup('starting', new Error('library: local records restored'));
      // 夜间模式必须在首帧前就位，否则会闪一下白底（MainActivity 在
      // setContent 之前就把 MyApplicationTheme 包好了）。
      const { SettingsRepository } = await import('@core/settings/settingsRepository');
      const settings = new SettingsRepository(platform.db);
      /**
       * MISSING 修正：启动看门狗（Kotlin `MainActivity.kt` L119-140）。
       *
       * 必须在**任何** `render_quality` 读取之前跑 —— Android 侧是
       * `onCreate()` 里同步跑完再看门狗，然后 `setContent{}` 才构造
       * `MainViewModel`（`MutableStateFlow(prefs.renderQuality)`），所以降级值
       * 同一次冷启动就生效。Web 侧存储是异步的，因此把这一步排在
       * `setBookRepository` 之后、任何渲染相关读取之前。
       * 语义逐条照抄：极致（3）画质 20 s 内连续两次启动 → 落回「高」（2）；
       * 存活满 20 s 由 `installBootGuard` 的定时器解除武装。
       * 失败不抛（与 Kotlin 的 `runCatching { … }` 一致）。
       */
      try {
        const { installBootGuardFromSettings } = await import('@core/app/bootGuard');
        await installBootGuardFromSettings(settings);
      } catch {
        // 看门狗只是保护性逻辑，失败不阻断启动
      }
      useAppStore.setState({
        autoNightMode: await settings.getBoolean('auto_night_mode', false),
        // Kotlin `MainActivity.kt` L457 读的是 prefs，这里同样要落库值而不是常量 false
        // Kotlin `PreferencesManager.kt` L281–283 `prefs.getBoolean("has_seen_onboarding", false)`。
        // 这里的 `settings` 是裸 `SettingsRepository`（KV 门面），没有具名访问器，
        // 所以直接按 Kotlin 的 key + 默认值取。
        hasSeenOnboarding: await settings.getBoolean('has_seen_onboarding', false),
        primaryIndex: await settings.getInt('color_primary_index', 2),
        secondaryIndex: await settings.getInt('color_secondary_index', 2),
        // Android `MainActivity.kt` L457 一并读的 prefs 集合里含方向锁；
        // `MainActivity.kt:398` 的 `DisposableEffect(orientationLock)` 首次组合时
        // 就会跑一次，所以首帧方向必须来自落库值而不是默认 0。
        screenOrientationLock: await settings.getInt('screen_orientation_lock', 0),
      });

      const { getPrivacyService } = await import('@platform/privacyRuntime');
      const privacy = getPrivacyService();
      useAppStore.getState().setPrivacyEnabled((await privacy.ready()).enabled);
      privacy.subscribe(() => useAppStore.getState().setPrivacyEnabled(privacy.getSnapshot().enabled));

      // E94：装配 `LibraryViewModel` 并注册到 `libraryRuntime`。
      // Android 侧这一切发生在 `LibraryViewModel(application)` 被 Hilt 构造时
      // （`LibraryViewModel.kt:57-73`）；iOS 侧没有 DI 容器，由这里显式建一次。
      // 放在 `openAppDatabase` 之后 —— 装配要拿 `platform.db` 建表/读偏好。
      // 失败不阻断启动（与本函数其余步骤一致：书库页退化成 inert fallback，
      // 其余页面不受影响），但**不静默**：console 留痕，便于真机排查。
      try {
        const { installLibraryRuntime } = await import('@core/library/libraryAssembly');
        const {
          FileSystemSourceConfigFile,
          SecureStoreNovelPrefs,
          SecureStoreRecordMetadataPrefs,
          SecureStoreSourcePrefs,
        } = await import('@platform/web/platformAdapters');
        const { FavoriteDao } = await import('@core/library/favoriteDao');
        const { createAppSourceManager, registerAppBuiltinSources } = await import('@platform/sourceAssembly');
        const { createNovelBookImporter } = await import('@platform/localBookImport');
        const { SharedPreferencesSourceStorage } = await import(
          '@core/source/storage/sharedPreferencesSourceStorage'
        );
        const { showToast } = await import('@ui/toast');
        const { ComicSource } = await import('@core/source/comicSource');
        // E60：装配 `KeywordRepository`（Android `LibraryViewModel.kt:412-413`
        // `by lazy { KeywordRepository(application) }`）。
        // 此前六个 keyword 模块虽已逐行移植，但**零实例化** ——
        // `deps.keywordObserve` 恒为 undefined，`libraryViewModel.ts:892` 直接
        // return，多语言搜索的关键词扩展预览永远产不出词。
        const { buildKeywordObserve, KEYWORD_ASSET_BASE } = await import(
          '@core/source/keyword/keywordAssembly'
        );
        const { PreferencesManager, SettingsRepository } = await import(
          '@core/settings/settingsRepository'
        );

        const secureStore = platform.secure;
        // 书源管理器装配一次，供 `comicSourceOf` 回填收藏项的书源名。
        const sourcePrefs = new SecureStoreSourcePrefs(secureStore);
        const sourceManager = createAppSourceManager(
          new SharedPreferencesSourceStorage({
            prefs: sourcePrefs,
            files: new FileSystemSourceConfigFile(platform.fs),
          }),
          platform.http,
        );
        await registerAppBuiltinSources(sourceManager, platform.http, platform.fs);
        await reportStartup('starting', new Error('sources: builtins registered'));
        performance.mark('app-builtin-sources-ready');
        const { installAppJsSources } = await import('@platform/jsSourceAssembly');
        await installAppJsSources(sourceManager, platform);
        await reportStartup('starting', new Error('sources: scripts registered'));
        performance.mark('app-js-sources-ready');
        const { installAppZLibrary } = await import('@platform/zLibraryAssembly');
        const zlibrary = await installAppZLibrary(sourceManager, platform);
        await reportStartup('starting', new Error('sources: Z-Library registered'));
        performance.mark('app-zlibrary-ready');
        const { showSourceLogin } = await import('@ui/sourceDialogs');

        // E60：keyword 子系统装配。
        //
        // `KeywordPrefsSource` 读的是**同步 boolean**，而 `SettingsRepository`
        // 的三个方法都是 async（底层 SharedPreferences/secure store 皆如此）。
        // Kotlin 侧同样是「构造时同步读一次 `PreferencesManager`」，所以这里
        // 在装配期把三个值**快照一次**再交给 repository —— 与 `by lazy` 的
        // 构造时点一致，也避免把 async 泄进 core 的同步接口。
        // `PreferencesManager` = Kotlin `PreferencesManager(app)`。它包一层
        // `SettingsRepository`（后者拿 SQLite 句柄），Android 侧也是这个组合。
        const settingsRepo = new SettingsRepository(platform.db);
        const prefsManager = new PreferencesManager(settingsRepo);
        const keywordPrefs = await Promise.all([
          prefsManager.multiLanguageSearch(),
          prefsManager.multiLanguageOnlineLookup(),
          prefsManager.incognitoBrowsingEnabled(),
        ]);

        // Kotlin `context.assets.open(name)` —— Web 侧走 public/ 静态资源。
        // 资源缺失时**显式抛错**（不静默降级）：`KeywordDictionary.prepare()`
        // 会因缺 `keyword_ehtag.tsv.gzip` 而整体失败，抛出比产出空词典更可诊断。
        const readAsset = async (name: string): Promise<Uint8Array> => {
          const response = await fetch(`${KEYWORD_ASSET_BASE}${name}`);
          if (!response.ok) {
            throw new Error(`关键词资源缺失：${KEYWORD_ASSET_BASE}${name}（HTTP ${response.status}）`);
          }
          return new Uint8Array(await response.arrayBuffer());
        };

        // `KeyValueStore`（Kotlin `SharedPreferences("keyword_dictionary")`）
        // 与 `SecureStore` 的 get/set 形状完全一致，只是命名空间不同 ——
        // 加前缀避免与书源/下载管理的键撞车。
        const keywordSettings = {
          get: (key: string) => secureStore.get(`keyword_dictionary.${key}`),
          set: (key: string, value: string) =>
            secureStore.set(`keyword_dictionary.${key}`, value),
        };

        const runtime = installLibraryRuntime({
          zlibraryNodeDomain: zlibrary.domain,
          openSourceLogin: showSourceLogin,
          isZLibrarySource: (source) => source.id === zlibrary.source.id,
          sourceManager,
          novelImporter: createNovelBookImporter(bookRepository!, platform.fs, () => useAppStore.getState().loadLibrary()),
          keywordObserve: buildKeywordObserve({
            readAsset,
            fs: platform.fs,
            db: platform.db,
            settings: keywordSettings,
            prefs: {
              multiLanguageSearch: keywordPrefs[0],
              multiLanguageOnlineLookup: keywordPrefs[1],
              incognitoBrowsingEnabled: keywordPrefs[2],
            },
            http: platform.http,
          }),
          db: platform.db,
          fs: platform.fs,
          http: platform.http,
          secrets: secureStore,
          sourcePrefs,
          sourceConfigs: new FileSystemSourceConfigFile(platform.fs),
          novelPrefs: new SecureStoreNovelPrefs(secureStore),
          recordMetadataPrefs: new SecureStoreRecordMetadataPrefs(secureStore),
          favoriteDao: new FavoriteDao(platform.db),
          comicSourceOf: async (sourceId) => {
            await sourceManager.initialize();
            const src = sourceManager.getSource(sourceId);
            if (!(src instanceof ComicSource)) return null;
            // `comicSourceTypes.ComicSource` 的契约只有 `getChapters(comicId)`，
            // 返回 `SourceResult<ComicChapter[]>`。真正的漫画书源由 `LibraryViewModel`
            // 自己解析（`registerBuiltinSources`），这里只提供「书源是否存在 + 章节」
            // 的最小实现：书源在册就返回空章节集，不在册返回 null。
            return src;
          },
          downloadsDir: 'downloads',
          toast: (message: string) => {
            void showToast(message);
          },
          log: (message: string) => {
            console.warn('[library]', message);
          },
        });
        const { installLibraryContentServices } = await import('@platform/libraryContentServices');
        await installLibraryContentServices(platform, runtime, bookRepository!, () => useAppStore.getState().loadLibrary());
        const { getPlatformKind } = await import('@platform/index');
        if (getPlatformKind() === 'ios-native') {
          const { runNativeSelfTests } = await import('@platform/ios-native/nativeSelfTest');
          await runNativeSelfTests(platform);
        }
        await reportStartup('ready');
      } catch (error) {
        throw new Error('书库初始化失败，请重试。', { cause: error });
      }
    })().catch((error: unknown) => {
      void import('@platform/ios-native/startupDiagnostics').then(({ reportStartup }) => reportStartup('error', error));
      libraryBootstrap = null;
      setBookRepository(null);
      useAppStore.setState({ libraryReady: false });
      throw error;
    });
  }
  return libraryBootstrap;
}

/** 测试用：清掉 bootstrap 缓存，让下次调用重新开库。 */
export function resetLibraryBootstrapForTest(): void {
  libraryBootstrap = null;
  anilistBootstrap = null;
  setBookRepository(null);
}

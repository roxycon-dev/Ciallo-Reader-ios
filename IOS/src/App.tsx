/**
 * App 根 — 路由表对齐 Android `MainActivity.kt` 的 NavHost 声明。
 *
 * Android（MainActivity.kt L442-449）：
 *   NavHost(navController, startDestination = "splash")，
 *   全部路由切换 fadeIn/fadeOut tween(250)。
 * Web 侧 = `useAppStore.route` + `src/core/app/navigation.ts` 的路由表。
 *
 * 路由名（Kotlin `composable("…")` ↔ 本文件的 `AppRoute`）：
 *   splash              → SplashPage
 *   onboarding          → OnboardingPage
 *   home                → MainShell（4 个 tab：书库/书架/统计/设置）
 *   reader              → ReaderPage
 *   comic_reader        → ComicReaderPage
 *   comic_chapters      → ComicChaptersPage
 *   source_management   → SourceManagementPage
 *   god_ranking         → GodRankingPage
 *   god_editor          → GodEditorPage
 *   novel_reader_online → NovelReaderOnlinePage
 *   comic_reader_online → ComicReaderOnlinePage
 *
 * ── 与 Kotlin NavHost 的三处结构差异（都登记在 docs/PARITY_EXCEPTIONS.md）──────
 *   ① `cache_management` 不是 Kotlin 的 NavHost 路由：`CacheManagementScreen` 在
 *      `SettingsTabScreen.kt` L1441 里由 `showCacheManager` 布尔量控制的全屏层，
 *      不是 `composable("cache_management")`。Web 侧用路由表达同一跳转，落点一致。
 *   ② `godCoverCrop` 在 Kotlin 里没有 NavHost 路由：
 *      `GodCoverCropScreen`（`god/GodCoverCropScreen.kt` L69）是被
 *      `god/GodMomentSheet.kt` L589 内嵌渲染的弹层，**不是独立 Activity**。
 *      （原 `downloadManager` 键已删除：`DownloadManagerScreen` 在整个 Kotlin
 *       源码里**不存在**，Android 侧无此界面 —— 见 REACHABILITY_AUDIT 组 1。）
 *   ③ 没有返回栈：`useAppStore.route` 是扁平字段，各页面的「返回」写死成
 *      `setRoute('main')` / `setRoute('comicChapters')`，因此系统返回键 /
 *      手势返回目前无处可接（Android 的 NavController 自动 popBackStack）。
 *
 * ── 2026-10-06 本次审查新增：逐条路由转场 ─────────────────────────────────────
 *   `MainActivity` 给 5 条路由单独声明了 enter/exit/popEnter/popExit
 *   （reader / comic_reader / comic_chapters / comic_reader_online /
 *   novel_reader_online），其余走 NavHost 默认的 250ms fade。数值逐条照抄进
 *   `@core/app/navigation` 的 `ROUTE_TRANSITIONS`，这里用 Web Animations API 在
 *   路由容器上播放**入场**那一半。出场（exit）那一半依赖返回栈，目前无法复现 ——
 *   同样登记为 E59。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SourceDialogs } from '@ui/sourceDialogs';
import { GlobalDownloadCenter } from '@ui/components/library/DownloadCenter';
import { SharedNovelTarget } from '@ui/sharedNovelTarget';
import { getPrivacyService } from '@platform/privacyRuntime';
import { ReaderPrivacyGate } from '@ui/components/privacy/ReaderPrivacyGate';
import { createSourceManagementIo } from '@ui/sourceManagementRuntime';
import { AppBottomTabBar } from '@ui/components/AppBottomTabBar';
import { CacheManagementPage } from '@ui/pages/CacheManagementPage';
import { ComicChaptersPage } from '@ui/pages/ComicChaptersPage';
import { OnlineReaderRoute } from '@ui/pages/OnlineReaderRoute';
import { LocalComicReaderRoute } from '@ui/pages/LocalComicReaderRoute';
import { GodCoverCropPage } from '@ui/pages/GodCoverCropPage';
import { GodEditorPage } from '@ui/pages/GodEditorPage';
import { GodRankingPage } from '@ui/pages/GodRankingPage';
import { HomePage } from '@ui/pages/HomePage';
import { LibraryPage } from '@ui/pages/LibraryPage';
import { mountLibraryPaperRoute, pruneLibraryPaperRoutes } from '@ui/shared/paperRouteHost';
import { pruneLibrarySearchSessions } from '@ui/pages/librarySearchSessions';
import { pruneComicChapterRouteTargets } from '@ui/pages/comicChapterRouteTargets';
import { DiscoverPage } from '@ui/pages/DiscoverPage';
import { OnboardingPage } from '@ui/pages/OnboardingPage';
import { ReaderPage, setInlineImageDecoder } from '@ui/pages/ReaderPage';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';
import { getPlatform, getPlatformKind } from '@platform/index';
import { useRenderQuality } from '@ui/components/GlassQuality';
import { reloadVisualAssets, useVisualAssets } from '@ui/lib/appVisualAssets';
import { createIosSettingsUpdateIo } from '@platform/ios-native/settingsUpdateRuntime';
import { SettingsPage } from '@ui/pages/SettingsPage';
import { ThemePalettePage } from '@ui/pages/ThemePalettePage';
import { CardAppearancePage } from '@ui/pages/CardAppearancePage';
import { useCardTweaks } from '@ui/components/CardTweaks';
import { setRuntimeCardTweaks } from '@ui/components/glassAppearanceRuntime';
import { writeCardTweaks } from '@ui/lib/cardTweaksPersistence';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { DeviceTransferPage } from '@ui/pages/DeviceTransferPage';
import { SourceManagementPage } from '@ui/pages/SourceManagementPage';
import { SplashPage } from '@ui/pages/SplashPage';
import { StatisticsPage } from '@ui/pages/StatisticsPage';
import { TabContent } from '@ui/shell/TabShell';
import {
  DEFAULT_ROUTE_TRANSITION,
  ROUTES,
  routeEnterDurationMs,
  routeEnterOptions,
  routeTransition,
  type RouteName,
  type RouteTransitionPart,
} from '@core/app/navigation';
import { AppLanguage } from '@core/i18n';
import {
  useAppStore,
  bootstrapLibrary,
  clearGodCropTarget,
  getGodCropTarget,
  setGodCropResult,
  type RouteKey,
  type LibrarySearchRequest,
  isLibrarySearchRoute,
  librarySessionIdFromRoute,
} from '@ui/state/appStore';
import { Toast, TOAST_DURATION_LONG, showToast } from '@ui/toast';
import { MascotOverlay } from '@ui/components/mascot/MascotAnimationController';
import { DuplicateFavoriteHost } from '@ui/components/favorite/DuplicateFavoriteHost';
import { RenderRecoveryBoundary } from '@ui/shell/RenderRecoveryBoundary';
import { getAutoBackupRuntime } from '@platform/autoBackupRuntime';
import type { AutoBackupOutcome } from '@core/backup/autoBackup';
import './styles/theme.css';
import './styles/home.css';
import './styles/shell.css';

type AppRoute =
  | RouteKey
  | 'godEditor'
  | 'novelReaderOnline'
  | 'comicReaderOnline'
  | 'cacheManagement';

/**
 * `appStore.RouteKey` ↔ Kotlin 的 `composable("…")` 路由名。
 * 两个在 Kotlin 里没有 NavHost 路由的键（`godCoverCrop` / `cacheManagement`）
 * 返回 `null` → 只吃 NavHost 默认的 250ms fade。
 * （原第三键 `downloadManager` 已删除：Android 侧无此界面，见组 1 清理。）
 *
 * `main` ↔ `ROUTES.home`：Compose 侧是 `composable("home")` 包着 MainShell，
 * Web 侧那个壳本身就是主路由，所以键名不同、目的地相同。
 */
const ROUTE_NAME_BY_KEY: Readonly<Partial<Record<AppRoute, RouteName | null>>> = {
  splash: ROUTES.splash,
  onboarding: ROUTES.onboarding,
  main: ROUTES.home,
  reader: ROUTES.reader,
  comicReader: ROUTES.comicReader,
  comicChapters: ROUTES.comicChapters,
  sourceManagement: ROUTES.sourceManagement,
  godRanking: ROUTES.godRanking,
  novelReaderOnline: ROUTES.novelReaderOnline,
  comicReaderOnline: ROUTES.comicReaderOnline,
  godEditor: ROUTES.godEditor,
  cacheManagement: ROUTES.cacheManagement,
  themePalette: ROUTES.themePalette,
  cardAppearance: ROUTES.cardAppearance,
  deviceTransfer: ROUTES.deviceTransfer,
  godCoverCrop: null,
};

/**
 * 某条路由的转场分组。`enter` = `navController.navigate(...)`，`popEnter` = `popBackStack()`
 * （`MainActivity.kt:632-660` 的 `enterTransition` / `popEnterTransition` 两支）。
 * 没有对应 `NavHost` 目的地时返回 null（走 `DEFAULT_ROUTE_TRANSITION`）。
 */
function routeTransitionFor(
  route: AppRoute,
  direction: 'enter' | 'popEnter',
): readonly RouteTransitionPart[] | null {
  if (isLibrarySearchRoute(route)) return null;
  const baseRoute = route.startsWith('comicChapters/') ? 'comicChapters' : route;
  const name = ROUTE_NAME_BY_KEY[baseRoute];
  if (name === null || name === undefined) return null;
  return routeTransition(name)[direction];
}

/** 没有 `NavHost` 目的地时落地到 `DEFAULT_ROUTE_TRANSITION`（= `paperPage*` 四件套）。 */
function routeTransitionForDefault(
  direction: 'enter' | 'popEnter',
): readonly RouteTransitionPart[] {
  return direction === 'popEnter'
    ? DEFAULT_ROUTE_TRANSITION.popEnter
    : DEFAULT_ROUTE_TRANSITION.enter;
}

function LibrarySearchRoute(props: { route: RouteKey; request: LibrarySearchRequest | undefined }) {
  const sessionId = librarySessionIdFromRoute(props.route);
  const goBack = useAppStore((state) => state.goBack);
  useEffect(() => {
    if (sessionId === null || props.request === undefined) goBack('comicChapters');
  }, [goBack, props.request, sessionId]);
  if (sessionId === null || props.request === undefined) return null;
  return (
    <LibraryPage
      sessionId={sessionId}
      searchRequest={props.request}
      onBack={() => goBack('comicChapters')}
      standalone
    />
  );
}

/**
 * 主壳（Android `composable("home")`，L476-…）：
 * tab 0 书库 → LibraryScreen，tab 1 书架 → HomeScreen，
 * tab 2 统计 → StatisticsScreen，tab 3 设置 → SettingsScreen。
 *
 * ⚠️ 冷启动落点：Kotlin `MainActivity.kt` L418 是 `mutableIntStateOf(1)`，
 * 而 `when (tab)` 的 1 分支是 `HomeScreen`（书架）。store 的 `activeTab`
 * 初值已按此对齐为 `'bookshelf'`（见 `appStore.ts` 文件头）。
 */
function MainShell() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setTab);
  const settingsUpdateIo = useMemo(() => getPlatformKind() === 'ios-native'
    ? createIosSettingsUpdateIo(getPlatform())
    : null, []);
  const [discoverRefresh, setDiscoverRefresh] = useState(0);
  const lastTap = useRef({ tab: activeTab, time: 0 });

  return (
    <div className="main-shell">
      {/* Android 用 AnimatedContent 做 fade-through（出 90ms / 入 210ms 延迟 90ms），
          两页永不同时可见。TabContent 复刻同一时序。 */}
      <TabContent tab={activeTab}>
        {(tab) => {
          switch (tab) {
            case 'library':
              return <LibraryPage />;
            case 'discover':
              return <DiscoverPage refreshRequest={discoverRefresh} />;
            case 'bookshelf':
              return <HomePage />;
            case 'stats':
              return <StatisticsPage />;
            default:
              return settingsUpdateIo === null
                ? <SettingsPage />
                : <SettingsPage updateIo={settingsUpdateIo} />;
          }
        }}
      </TabContent>
      <AppBottomTabBar active={activeTab} onChange={(tab) => {
        const now = performance.now();
        if (tab === 'discover' && activeTab === tab && lastTap.current.tab === tab && now - lastTap.current.time < 400) { setDiscoverRefresh((value) => value + 1); lastTap.current = { tab, time: 0 }; }
        else lastTap.current = { tab, time: now };
        setTab(tab);
      }} collapsed={false} />
    </div>
  );
}

/**
 * 神回封面裁剪路由壳：从 store 的信标取入参，回写结果后回编辑器页。
 * （Android 里 GodCoverCropScreen 是独立 Activity；web 侧用路由表达同一跳转。）
 */
function GodCoverCropRoute() {
  const target = getGodCropTarget();
  // RouteKey 已含 'godEditor'，直接用 store 的 setRoute（不再需要强转）
  const setRoute = useAppStore((s) => s.setRoute);
  const goBack = (): void => {
    clearGodCropTarget();
    setRoute('godEditor');
  };
  if (target === null) {
    // 没有信标 = 误进，直接回编辑器（Android 也会被系统 back 弹回）
    goBack();
    return null;
  }
  return (
    <GodCoverCropPage
      // 位图解码留空：裁剪屏用 <img src> + canvas 预览，
      // 真实像素合成走注入的 GodCoverImageDecoder（见 godReaderBinding.ts）。
      source={null}
      sourceUrl={target.sourceUrl}
      sourceWidth={target.sourceWidth}
      sourceHeight={target.sourceHeight}
      initialCrop={target.initialCrop}
      onCancel={goBack}
      onConfirm={(crop) => {
        setGodCropResult(crop);
        clearGodCropTarget();
        setRoute('godEditor');
      }}
    />
  );
}

/**
 * 主题配色页（Android `composable("theme_palette")`，MainActivity.kt L2032-2040）。
 * 页面不持有状态：每次点选立即写回 `color_primary_index` / `color_secondary_index`
 * 并同步 appStore，与 `MainViewModel.updateColorTheme` 同序。
 */
function ThemePaletteRoute() {
  const primaryIndex = useAppStore((s) => s.primaryIndex);
  const secondaryIndex = useAppStore((s) => s.secondaryIndex);
  const setPrimaryIndex = useAppStore((s) => s.setPrimaryIndex);
  const setSecondaryIndex = useAppStore((s) => s.setSecondaryIndex);
  const autoNightMode = useAppStore((s) => s.autoNightMode);
  const setTab = useAppStore((s) => s.setTab);
  const setRoute = useAppStore((s) => s.setRoute);
  const back = (): void => {
    setTab('settings');
    setRoute('main');
  };
  const write = (primary: number, secondary: number): void => {
    setPrimaryIndex(primary);
    setSecondaryIndex(secondary);
    void (async () => {
      try {
        const settings = new SettingsRepository(getPlatform().db);
        await settings.setInt('color_primary_index', primary);
        await settings.setInt('color_secondary_index', secondary);
      } catch {
        // Android SharedPreferences 写失败同样不阻断本次切换。
      }
    })();
  };
  return (
    <ThemePalettePage
      primaryIndex={primaryIndex}
      secondaryIndex={secondaryIndex}
      onPrimaryChange={(index) => write(index, secondaryIndex)}
      onSecondaryChange={(index) => write(primaryIndex, index)}
      onBack={back}
      dark={autoNightMode}
    />
  );
}

/**
 * 卡片外观页（Android `composable("card_appearance")`，MainActivity.kt L2042-2051）。
 * `updateCardTweaks` 传函数 → 写 runtime + 八个 `card_*` 持久化键。
 */
function CardAppearanceRoute() {
  const tweaks = useCardTweaks();
  const setTab = useAppStore((s) => s.setTab);
  const setRoute = useAppStore((s) => s.setRoute);
  const back = (): void => {
    setTab('settings');
    setRoute('main');
  };
  return (
    <CardAppearancePage
      value={tweaks}
      updateCardTweaks={(transform) => {
        const next = transform(tweaks);
        setRuntimeCardTweaks(next);
        void writeCardTweaks(new SettingsRepository(getPlatform().db), next).catch(() => {
          // Android 同样只在本次会话生效，落库失败不抛。
        });
      }}
      onBack={back}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 自动备份的启动 / 回前台接线（Android `MainViewModel.kt` L797-831）
 *
 * Kotlin 原文（`offerRestoreIfNeeded()`）：
 * ```kotlin
 * runCatching { autoBackup.runIfDue() }
 * runCatching {
 *     if (autoBackup.shouldOfferRestore()) {
 *         val latest = autoBackup.latest() ?: return@runCatching
 *         autoBackup.markRestoreOffered()
 *         _restoreOffer.value = latest
 *     }
 * }
 * ```
 * 三个 helper **不抛**（Kotlin `runCatching` 的等价物），失败只 `console.warn`：
 * 自动备份是锦上添花，任何一步坏掉都不该拦住启动。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L799 `runCatching { autoBackup.runIfDue() }` —— 启动与回前台共用这一条路径。 */
export async function runAutoBackupIfDue(): Promise<AutoBackupOutcome | null> {
  try {
    return await getAutoBackupRuntime().runIfDue();
  } catch (error) {
    // Kotlin `runCatching { … }`：异常吞掉，只留痕。
    console.warn('[auto-backup] 自动备份未执行', error);
    return null;
  }
}

/** Kotlin L821 `autoBackup.restore(snapshot.name)` + L822 `restoreCompleted++`（重载书库）。 */
export async function acceptAutoBackupRestore(): Promise<void> {
  try {
    const result = await getAutoBackupRuntime().restoreLatest();
    if (result === null) {
      showToast('没有可恢复的自动备份');
      return;
    }
    await useAppStore.getState().loadLibrary();
    showToast('已从备份恢复');
  } catch (error) {
    showToast(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败', { kind: 'error' });
  }
}

/**
 * Kotlin L798-807 `offerRestoreIfNeeded()` 的后半段。恢复入口用 `showToast` 的动作按钮
 * （`actionLabel`）承担「确认」，不弹原生 `confirm` —— 与 Android 的
 * `_restoreOffer` + `acceptRestore()` 同语义：提示一次、用户点了才覆盖。
 */
export async function offerAutoBackupRestore(): Promise<void> {
  try {
    const runtime = getAutoBackupRuntime();
    if (!(await runtime.shouldOfferRestore())) return;
    const latest = await runtime.latest();
    if (latest === null) return;
    await runtime.markRestoreOffered();
    showToast(`发现自动备份（${latest.name}），可立即恢复`, {
      actionLabel: '恢复',
      durationMs: TOAST_DURATION_LONG,
      onAction: () => {
        void acceptAutoBackupRestore();
      },
    });
  } catch (error) {
    // Kotlin 第二个 `runCatching { … }` —— 提示失败不影响启动。
    console.warn('[auto-backup] 恢复提示不可用', error);
  }
}

export function App() {
  const sourceManagementIo = useMemo(() => createSourceManagementIo(), []);
  const route = useAppStore((s) => s.route) as AppRoute;
  /** 界面语言 —— 订阅即「整棵 UI 重渲染」的等价物（见下方 lang effect）。 */
  const appLanguage = useAppStore((s) => s.appLanguage);
  const { wallpaper, mode: wallpaperMode, dim: wallpaperDim } = useVisualAssets();
  const quality = useRenderQuality();
  const activeWallpaper = wallpaperMode === 1 && quality !== 'MINIMAL' ? wallpaper : null;
  const previousRoute = useRef<AppRoute>(route);
  useEffect(() => {
    if (previousRoute.current === 'deviceTransfer' && route !== 'deviceTransfer') void reloadVisualAssets();
    previousRoute.current = route;
  }, [route]);
  const routeHistory = useAppStore((s) => s.routeHistory);
  const librarySearchRequests = useAppStore((s) => s.librarySearchRequests);
  const autoNightMode = useAppStore((s) => s.autoNightMode);
  const screenOrientationLock = useAppStore((s) => s.screenOrientationLock);
  useEffect(() => {
    const decoder = createFileInlineImageDecoder(getPlatform().fs);
    setInlineImageDecoder(decoder);
    return () => decoder.dispose();
  }, []);

  useEffect(() => {
    // 启动水合单一入口（appStore 不再在 import 时自动开库）
    // 水合完成后才碰自动备份：`AutoBackup.countBooksOr` 要读 `books` 表，
    // `restore()` 走 `importNativeArchive` 还要书源服务就绪。
    // 顺序照抄 Kotlin `MainViewModel.offerRestoreIfNeeded()`：先 runIfDue，再提示恢复。
    void bootstrapLibrary()
      .then(() => useAppStore.getState().ensureAniListSeeded())
      .then(() => runAutoBackupIfDue())
      .then(() => offerAutoBackupRestore())
      .catch((error: unknown) => {
        console.warn('[auto-backup] 启动自动备份未执行', error);
      });
  }, []);

  useEffect(() => {
    const retainedSessionIds = new Set<string>();
    const retainedRoutes = new Set<RouteKey>([route, ...routeHistory]);
    for (const entry of [route, ...routeHistory]) {
      const sessionId = librarySessionIdFromRoute(entry);
      if (sessionId !== null) retainedSessionIds.add(sessionId);
    }
    pruneLibrarySearchSessions(retainedSessionIds);
    pruneLibraryPaperRoutes(retainedRoutes);
    pruneComicChapterRouteTargets(retainedRoutes);
    useAppStore.getState().pruneLibrarySearchRequests(retainedSessionIds);
  }, [route, routeHistory]);

  /**
   * 前后台订阅**只留一个**：原来这里是「切后台 → `getPrivacyService().lock()`」，
   * 现在把「回前台 → `autoBackup.runIfDue()`」并进同一个回调 —— 两个
   * `appLifecycle.subscribe` 各自注册会让首次订阅的 `getState()` 派发跑两遍
   * （见 `appLifecyclePort.ts` 文件头「首次订阅会立刻派发一次」）。
   */
  useEffect(() => getPlatform().appLifecycle.subscribe((foreground) => {
    if (!foreground) {
      getPrivacyService().lock();
      return;
    }
    // Kotlin L798 `runCatching { autoBackup.runIfDue() }` —— 回前台同样补跑一次。
    void runAutoBackupIfDue();
  }), []);

  useEffect(() => {
    let disposed = false, remove: (() => void) | undefined;
    void (async () => {
      const { getPlatformKind } = await import('@platform/index'); if (disposed || getPlatformKind() !== 'ios-native') return;
      const { listenForOpenedTransfer } = await import('@platform/ios-native/archiveFilePort');
      const opened = () => { void (async () => {
        await bootstrapLibrary(); if (disposed) return;
        useAppStore.getState().setRoute('deviceTransfer');
        const { getDeviceTransferController } = await import('@platform/ios-native/deviceTransferRuntime');
        if (disposed) return; const controller = await getDeviceTransferController(); await controller.start(); if (!disposed) await controller.openFile(true);
      })().catch((error: unknown) => { if (!disposed) showToast(error instanceof Error ? error.message : '无法打开迁移包'); }); };
      const cleanup = await listenForOpenedTransfer(opened, (message) => { if (!disposed) showToast(message); });
      if (disposed) cleanup(); else remove = cleanup;
    })().catch((error: unknown) => { if (!disposed) showToast(error instanceof Error ? error.message : '无法接收系统迁移文件'); });
    return () => { disposed = true; remove?.(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let listener: { remove(): Promise<void> } | undefined;
    let last = '', lastAt = 0;
    const receive = (url: string): void => {
      if (disposed || url === last && Date.now() - lastAt < 1000) return;
      last = url; lastAt = Date.now();
      void import('@ui/lib/openSharedWork').then(({ openSharedWork }) => disposed ? false : openSharedWork(url))
        .catch((error: unknown) => { if (!disposed) showToast(error instanceof Error ? error.message : '无法打开分享作品'); });
    };
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (disposed || !Capacitor.isNativePlatform()) return;
      const { App: nativeApp } = await import('@capacitor/app');
      const handle = await nativeApp.addListener('appUrlOpen', ({ url }) => receive(url));
      if (disposed) { await handle.remove(); return; }
      listener = handle;
      const launch = await nativeApp.getLaunchUrl(); if (launch?.url) receive(launch.url);
    })().catch((error: unknown) => { if (!disposed) console.warn('[links] 分享链接接收不可用', error); });
    return () => { disposed = true; void listener?.remove(); };
  }, []);

  /**
   * 键盘 resize 模式 —— 对应 `AndroidManifest.xml` 的
   * `android:windowSoftInputMode="adjustResize"`。
   *
   * 那段 XML 注释原文点名了问题：「`enableEdgeToEdge()` 不会替你设置软键盘模式。
   * 缺省时部分 OEM ROM（MIUI / ColorOS 某些版本）走 `adjustPan`，键盘直接盖住
   * 底部面板的输入框。」iOS 侧的等价物是 `KeyboardResize.Body`
   * （只缩 `body`，视口 `vh` 不变）。
   *
   * ⚠️ 浏览器侧同一端口会抛 `KEYBOARD_RESIZE_UNAVAILABLE`（浏览器不提供这个控制），
   * 那是**预期**的能力边界，不该污染控制台 —— 故只在 native 平台下调用。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform() || cancelled) return;
        const { getPlatform } = await import('@platform/index');
        await getPlatform().keyboard.setResizeMode('body');
      } catch (error) {
        if (!cancelled) console.warn('[keyboard] adjustResize 未生效', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 夜间模式（Android `MainActivity.kt` L213 `MyApplicationTheme(darkTheme = autoNightMode)`）。
   *
   * 注意：**不是** `prefers-color-scheme` —— `isSystemInDarkTheme()` 只是
   * `Theme.kt` L35 的参数默认值，被 MainActivity 用设置项 `auto_night_mode` 覆盖了。
   * 所以这里读写 `data-theme` 属性，深色 token 由 `theme.css` 的 `[data-theme='dark']` 提供。
   */
  useEffect(() => {
    const root = document.documentElement;
    if (autoNightMode) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }, [autoNightMode]);

  /**
   * 界面语言 —— Android 侧 `AppLocale.language` 是 `mutableStateOf`，切语言会让整棵
   * Compose 树重组。Web 侧的等价物就是在这里订阅 `appLanguage`：它一变，`App` 重渲染，
   * 所有子组件（本项目没有任何 `React.memo` 边界）跟着重渲染，`tr()` 在渲染期重新求值。
   *
   * 刻意 **不** 用 `key={appLanguage}` 强制重挂载：`.app-route` 一换 key，当前路由的子树
   * （阅读器分页、滚动位置、草稿态）会整体重置，等于换语言顺便丢阅读进度。
   * `<html lang>` 跟着语言走，与 Kotlin 侧 `Locale` 的可见效果一致。
   */
  useEffect(() => {
    document.documentElement.lang = appLanguage === AppLanguage.EN ? 'en' : 'zh-CN';
  }, [appLanguage]);

  /**
   * 方向锁定 —— 逐行对应 Android `MainActivity.kt:398-405`：
   * ```kotlin
   * DisposableEffect(orientationLock) {
   *     requestedOrientation = when (orientationLock) {
   *         1 -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
   *         2 -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
   *         else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
   *     }
   *     onDispose {}
   * }
   * ```
   * 三个分支的映射在原生插件 `OrientationPlugin.swift` 里逐条对应
   * （iOS 没有 `requestActivity`，只能用 `UIWindowScene.requestGeometryUpdate`，
   * iOS 16+；本工程 deployment target 正是 iOS 16）。
   *
   * ⚠️ 浏览器侧 `screen.orientation.lock()` 需要全屏 + 只支持 `*-primary`，
   * 多数情况会抛错 —— 这不是 bug，是浏览器的能力边界（已登记）。
   * 按铁律**不静默**：`console.warn` 留痕，用户仍可正常使用（方向锁本来就是
   * 锦上添花，Kotlin 侧 `DisposableEffect` 失败也不会崩 Activity）。
   * 依赖数组就是 `orientationLock` 本身，与 Kotlin 的 `DisposableEffect` key 一致。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        await getPlatform().orientationLock.setLock(
          screenOrientationLock === 1 ? 1 : screenOrientationLock === 2 ? 2 : 0,
        );
      } catch (error) {
        if (!cancelled) console.warn('[orientation] 方向锁未生效', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screenOrientationLock]);

  /**
   * 底部避让唯一事实来源（`AppInsets.kt` L20-21 / `MainActivity.kt` L340/L343）：
   * `--app-bottom-inset` = 悬浮 Tab 栏总高 92px（12+68+12）+ 8px 视觉间隙 = **100px**，
   * `--app-bottom-inset-no-tab-bar` = 仅 8px（不含悬浮 Tab 栏）。
   *
   * ⚠️ 2026-10-06 更正：这两个变量**不含**安全区 —— Kotlin 的 `navBarBottom`
   * （`WindowInsets.navigationBars`）在 Web 上对应 `env(safe-area-inset-bottom)`，
   * 由 `theme.css` L84 的 `--safe-bottom` 提供，消费方各自相加
   * （`.toast` = `calc(var(--app-bottom-inset) + var(--safe-bottom))`，theme.css L1502）。
   * 所以这里**不能**写成 `calc(env(safe-area-inset-bottom) + 100px)`，否则 `.toast` 会重复加一次。
   * 两个值与 `theme.css` L90-91 的 `:root` 默认值一致；这里显式再写一遍是为了
   * 「单一真源」与 `resolveAppInsets()` 的算术保持肉眼可比。
   */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--app-bottom-inset', '100px');
    root.style.setProperty('--app-bottom-inset-no-tab-bar', '8px');
  }, []);

  /**
   * 逐条路由的入场转场（`@core/app/navigation` 的 `ROUTE_TRANSITIONS`，逐字照抄
   * `MainActivity.kt` 的 `enterTransition`）。用 Web Animations API 播在路由容器上。
   *
   * 触发时机：`route` 变化后容器整体重挂载（`key={route}`），effect 里对
   * **新** 元素播一次。`fill: 'both'` 保证首帧就是起点值（否则会闪一下终值）。
   * `prefers-reduced-motion: reduce` 时跳过 —— 与 Android `LocalReduceMotion` 分支一致。
   */
  const routeLayerRef = useRef<HTMLDivElement | null>(null);
  // 路由历史深度只增（push）或减（pop）—— 用来区分 `enterTransition` 与 `popEnterTransition`。
  const routeHistoryDepth = useAppStore((state) => state.routeHistory.length);
  const routeDepthRef = useRef(routeHistoryDepth);
  useLayoutEffect(() => {
    const surface = routeLayerRef.current;
    if (!surface || !isLibrarySearchRoute(route)) return;
    return mountLibraryPaperRoute(route, surface);
  }, [route]);
  useEffect(() => {
    const previousDepth = routeDepthRef.current;
    routeDepthRef.current = routeHistoryDepth;
    const el = routeLayerRef.current;
    if (el === null) return;
    if (typeof el.animate !== 'function') return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const direction = routeHistoryDepth < previousDepth ? 'popEnter' : 'enter';
    const spec = routeTransitionFor(route, direction) ?? routeTransitionForDefault(direction);
    if (spec === null) return;
    // `EnterTransition.None` 的等价物（`MainActivity.kt:1360-1363` 的 god_editor）。
    if (routeEnterDurationMs(spec) === 0) return;
    /*
     * Kotlin 的 `paperPage*` 是横向滑动（`slideInHorizontally { it }`），位移数据由
     * `routeEnterKeyframes(spec)` 给出、并被 `tests/unit/routeTransitionParity.test.ts`
     * 逐值钉死。**但 WebKit 播不了这条动画**：`.app-route` 一旦有位移动画，含内部滚动
     * 容器的页面（`source_management` 的 `.source-mgmt-scroll`）会让 renderer 直接
     * `Target crashed` —— 实测 `transform` / `translate` / `left` 三种写法全崩，
     * `contain: paint`、`will-change`、缩小位移幅度都不解决；只有纯 opacity 稳定。
     * 所以这里保留 Kotlin 的**时长与缓动**（420 / 320 ms + `pageEase`），放弃位移。
     * 已在 `docs/PARITY_EXCEPTIONS.md` E112 登记为平台限制。
     */
    const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], routeEnterOptions(spec));
    // A retained identity transform still creates a containing block for fixed
    // readers. Release the animation after entry so they stay viewport sized.
    // A retained identity transform still creates a containing block for fixed
    // readers. Release the animation after entry so they stay viewport sized.
    void animation.finished.then(() => animation.cancel()).catch(() => {});
    return () => {
      animation.cancel();
    };
  }, [route, routeHistoryDepth]);

  return (
    <div className="app-shell" data-wallpaper={activeWallpaper
      ? (activeWallpaper.tone * (1 - wallpaperDim / 100) > 0.4 ? 'light' : 'dark') : undefined}>
      {activeWallpaper && (
        <div className="app-wallpaper" aria-hidden="true">
          <img src={activeWallpaper.url} alt="" />
          <span style={{ opacity: wallpaperDim / 100 }} />
        </div>
      )}
      <div className="app-route" key={route} ref={routeLayerRef} data-route={route}>
        {route === 'splash' ? <SplashPage /> : null}
        {route === 'onboarding' ? <OnboardingPage /> : null}
        {/*
         * Kotlin `MainActivity.kt:690-706`：`HomeRenderRecovery.arm()` 只包主页
         * （`composable("home")`），所以错误边界也只包这一支 —— 其它路由的渲染异常
         * 不该被报成「主页渲染失败」。 */}
        {route === 'main' ? (
          <RenderRecoveryBoundary>
            <MainShell />
          </RenderRecoveryBoundary>
        ) : null}
        {route === 'reader' ? <ReaderPrivacyGate><ReaderPage /></ReaderPrivacyGate> : null}
        {route === 'comicReader' ? <ReaderPrivacyGate><LocalComicReaderRoute /></ReaderPrivacyGate> : null}
        {route === 'comicChapters' || route.startsWith('comicChapters/') ? <ComicChaptersPage /> : null}
        {isLibrarySearchRoute(route) ? (
          <LibrarySearchRoute
            route={route}
            request={librarySearchRequests[librarySessionIdFromRoute(route) ?? '']}
          />
        ) : null}
        {route === 'sourceManagement' ? <SourceManagementPage io={sourceManagementIo} /> : null}
        {route === 'novelReaderOnline' ? <OnlineReaderRoute textMode /> : null}
        {route === 'comicReaderOnline' ? <OnlineReaderRoute /> : null}
        {route === 'godRanking' ? <GodRankingPage /> : null}
        {route === 'godEditor' ? <GodEditorPage /> : null}
        {route === 'godCoverCrop' ? <GodCoverCropRoute /> : null}
        {route === 'cacheManagement' ? <CacheManagementPage /> : null}
        {route === 'themePalette' ? <ThemePaletteRoute /> : null}
        {route === 'cardAppearance' ? <CardAppearanceRoute /> : null}
        {route === 'deviceTransfer' ? <DeviceTransferPage /> : null}
      </div>
      <Toast />
      <SourceDialogs />
      <GlobalDownloadCenter />
      <SharedNovelTarget />
      {/* `MainActivity.kt:2086` `MascotOverlay()` —— 根部挂**一次**。
          吉祥物是 Activity 级覆盖层（`.mascot-overlay` 为 fixed + pointer-events:none，
          只有播放时才渲染出节点），页面只通过 `playMascotEvent()` 发事件。 */}
      <MascotOverlay />
      {/* `MainActivity.kt:604-620` 鈥?`favoriteAddRequest` 闈炵┖鏃舵覆鏌撴煡閲嶇‘璁ゅ脊绐楋紝
          `favoriteActionMessage` 璧?`AppToast`锛圠ENGTH_LONG锛夈€傚鏃呮寕鏍瑰眰涓€娆★紝
          涓変釜鍏ュ彛椤碉紙涔﹀簱 / 鍙戠幇 / 婕敾鐩綍锛夐兘缁?`requestFavoriteAdd` 鍙戣姹傘€?*/}
      <DuplicateFavoriteHost />
    </div>
  );
}

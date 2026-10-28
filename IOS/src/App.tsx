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
import { useEffect, useMemo, useRef } from 'react';
import { SourceDialogs } from '@ui/sourceDialogs';
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
import { OnboardingPage } from '@ui/pages/OnboardingPage';
import { ReaderPage, setInlineImageDecoder } from '@ui/pages/ReaderPage';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';
import { getPlatform } from '@platform/index';
import { SettingsPage } from '@ui/pages/SettingsPage';
import { SourceManagementPage } from '@ui/pages/SourceManagementPage';
import { SplashPage } from '@ui/pages/SplashPage';
import { StatisticsPage } from '@ui/pages/StatisticsPage';
import { TabContent } from '@ui/shell/TabShell';
import {
  ROUTES,
  routeEnterKeyframes,
  routeEnterOptions,
  routeTransition,
  type RouteName,
  type RouteTransitionPart,
} from '@core/app/navigation';
import {
  useAppStore,
  bootstrapLibrary,
  clearGodCropTarget,
  getGodCropTarget,
  setGodCropResult,
  type RouteKey,
} from '@ui/state/appStore';
import { Toast } from '@ui/toast';
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
const ROUTE_NAME_BY_KEY: Readonly<Record<AppRoute, RouteName | null>> = {
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
  godCoverCrop: null,
};

/** 某条路由的入场转场；Kotlin 里没有对应 NavHost 路由时返回 null（走默认淡入）。 */
function routeTransitionFor(route: AppRoute): readonly RouteTransitionPart[] | null {
  const name = ROUTE_NAME_BY_KEY[route];
  if (name === null || name === undefined) return null;
  return routeTransition(name).enter;
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

  return (
    <div className="main-shell">
      {/* Android 用 AnimatedContent 做 fade-through（出 90ms / 入 210ms 延迟 90ms），
          两页永不同时可见。TabContent 复刻同一时序。 */}
      <TabContent tab={activeTab}>
        {(tab) => {
          switch (tab) {
            case 'library':
              return <LibraryPage />;
            case 'bookshelf':
              return <HomePage />;
            case 'stats':
              return <StatisticsPage />;
            default:
              return <SettingsPage />;
          }
        }}
      </TabContent>
      <AppBottomTabBar active={activeTab} onChange={setTab} collapsed={false} />
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

export function App() {
  const sourceManagementIo = useMemo(() => createSourceManagementIo(), []);
  const route = useAppStore((s) => s.route) as AppRoute;
  const autoNightMode = useAppStore((s) => s.autoNightMode);
  const screenOrientationLock = useAppStore((s) => s.screenOrientationLock);
  useEffect(() => {
    const decoder = createFileInlineImageDecoder(getPlatform().fs);
    setInlineImageDecoder(decoder);
    return () => decoder.dispose();
  }, []);

  useEffect(() => {
    // 启动水合单一入口（appStore 不再在 import 时自动开库）
    void bootstrapLibrary().then(() => useAppStore.getState().ensureAniListSeeded());
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
  useEffect(() => {
    const el = routeLayerRef.current;
    if (el === null) return;
    if (typeof el.animate !== 'function') return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const spec = routeTransitionFor(route);
    if (spec === null) return;
    const animation = el.animate(routeEnterKeyframes(spec), routeEnterOptions(spec));
    // A retained identity transform still creates a containing block for fixed
    // readers. Release the animation after entry so they stay viewport sized.
    void animation.finished.then(() => animation.cancel()).catch(() => {});
    return () => {
      animation.cancel();
    };
  }, [route]);

  return (
    <div className="app-shell">
      <div className="app-route" key={route} ref={routeLayerRef} data-route={route}>
        {route === 'splash' ? <SplashPage /> : null}
        {route === 'onboarding' ? <OnboardingPage /> : null}
        {route === 'main' ? <MainShell /> : null}
        {route === 'reader' ? <ReaderPage /> : null}
        {route === 'comicReader' ? <LocalComicReaderRoute /> : null}
        {route === 'comicChapters' ? <ComicChaptersPage /> : null}
        {route === 'sourceManagement' ? <SourceManagementPage io={sourceManagementIo} /> : null}
        {route === 'novelReaderOnline' ? <OnlineReaderRoute textMode /> : null}
        {route === 'comicReaderOnline' ? <OnlineReaderRoute /> : null}
        {route === 'godRanking' ? <GodRankingPage /> : null}
        {route === 'godEditor' ? <GodEditorPage /> : null}
        {route === 'godCoverCrop' ? <GodCoverCropRoute /> : null}
        {route === 'cacheManagement' ? <CacheManagementPage /> : null}
      </div>
      <Toast />
      <SourceDialogs />
    </div>
  );
}

/**
 * 导航图 — 逐行移植 Android `MainActivity.kt` 的 NavHost 路由声明与跳转。
 *
 * Android 用 `androidx.navigation.compose.NavHost`：
 *   startDestination = "splash"，全部路由切换都是 250ms fadeIn/fadeOut
 *   （L444-448），`popUpTo(x) { inclusive = true }` 表示弹栈并清掉该页。
 *
 * Web 侧对应 = 一条显式路由栈（本文件）+ `src/ui/state/appStore.ts` 的 route。
 * 本文件负责：
 *  - 完整路由表（与 Kotlin 字符串逐字一致）
 *  - 栈的 push / pop / popUpTo(inclusive) 语义
 *  - 每条路由的 enter/exit/popEnter/popExit 转场（MainActivity 的 `composable(…, transition)`）
 *  - 一次性信标（跨路由传值，见下方 jump 模块）
 *  - 全部 23 处 `navController.navigate(...)` 的目标映射
 */

/** 与 MainActivity.kt 中 `composable("…")` 声明逐字一致的路由名。 */
export const ROUTES = {
  splash: 'splash',
  onboarding: 'onboarding',
  home: 'home',
  settings: 'settings',
  sourceManagement: 'source_management',
  godRanking: 'god_ranking',
  godEditor: 'god_editor',
  reader: 'reader',
  comicReader: 'comic_reader',
  comicChapters: 'comic_chapters',
  novelReaderOnline: 'novel_reader_online',
  comicReaderOnline: 'comic_reader_online',
  cacheManagement: 'cache_management',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

/** NavHost 的 250ms 交叉淡入淡出（L445-448）。 */
export const NAV_FADE_MS = 250;

/* ══════════════ 每条路由的转场（MainActivity 的 enter/exit/popEnter/popExit） ══════════════ */

/**
 * Kotlin `androidx.compose.animation.core.FastOutSlowInEasing` = `CubicBezierEasing(0.4f, 0f, 0.2f, 1f)`
 * （Compose 源码 `FastOutSlowInEasing.kt`）。与 `IosMotion.EaseOut`(0,0,0.58,1) 是两条不同的曲线，
 * 别混用：`MainActivity.kt` 的 `reader` / `comic_reader` 用的是这一条。
 */
export const FAST_OUT_SLOW_IN_CSS = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Kotlin `IosMotion.EaseOut` = `CubicBezierEasing(0f, 0f, 0.58f, 1f)`（`IosMotion.kt` L35）。
 * 数值与 `IOS_EASING_CSS.easeOut`（`@core/ui-theme/iosMotion`）同源；
 * 这里重复一份是为了让本文件不反向依赖 ui-theme（core/app ↔ core/ui-theme 无耦合）。
 */
export const EASE_OUT_CSS = 'cubic-bezier(0, 0, 0.58, 1)';

/** Kotlin `slideInHorizontally(initialOffsetX = …)` / `slideInHorizontally { … }` 的横向位移。 */
export const SLIDE_IN_KIND = 'slide-x';
/** Kotlin `scaleIn(initialScale = …)` / `scaleOut(targetScale = …)` 的缩放。 */
export const SCALE_KIND = 'scale';
/** Kotlin `fadeIn` / `fadeOut`。 */
export const FADE_KIND = 'fade';

export interface RouteTransitionPart {
  readonly kind: typeof FADE_KIND | typeof SLIDE_IN_KIND | typeof SCALE_KIND;
  readonly ms: number;
  /**
   * `slide-x` = 起始横向偏移占容器宽度的比例（`fullWidth / 3` = 1/3，`it / 4` = 1/4）。
   * `scale`   = 起始/目标缩放。
   * `fade`    = 无此字段（Compose `fadeIn` 没有强度参数）。
   */
  readonly value?: number;
  readonly easing: string;
}

export interface RouteTransition {
  /** `navController.navigate(...)` 时新页面的入场（= Compose `enterTransition`）。 */
  readonly enter: readonly RouteTransitionPart[];
  /** `navController.navigate(...)` 时旧页面的出场（= Compose `exitTransition`）。 */
  readonly exit: readonly RouteTransitionPart[];
  /** `popBackStack()` 回退时新页面（上一页）的入场（= Compose `popEnterTransition`）。 */
  readonly popEnter: readonly RouteTransitionPart[];
  /** `popBackStack()` 回退时离场页面的出场（= Compose `popExitTransition`）。 */
  readonly popExit: readonly RouteTransitionPart[];
}

/** NavHost 级默认转场（L445-448）：四个方向都是 250ms fade。 */
export const DEFAULT_ROUTE_TRANSITION: RouteTransition = {
  enter: [{ kind: FADE_KIND, ms: NAV_FADE_MS, easing: 'linear' }],
  exit: [{ kind: FADE_KIND, ms: NAV_FADE_MS, easing: 'linear' }],
  popEnter: [{ kind: FADE_KIND, ms: NAV_FADE_MS, easing: 'linear' }],
  popExit: [{ kind: FADE_KIND, ms: NAV_FADE_MS, easing: 'linear' }],
};

const fade = (ms: number): RouteTransitionPart => ({
  kind: FADE_KIND,
  ms,
  easing: 'linear',
});
const slideIn = (ms: number, fraction: number, easing = 'linear'): RouteTransitionPart => ({
  kind: SLIDE_IN_KIND,
  ms,
  value: fraction,
  easing,
});
const scaleIn = (ms: number, scale: number, easing = 'linear'): RouteTransitionPart => ({
  kind: SCALE_KIND,
  ms,
  value: scale,
  easing,
});

/**
 * 逐条照抄 `MainActivity.kt` 的 `composable(route, enterTransition = …, exitTransition = …,
 * popEnterTransition = …, popExitTransition = …)`。**没有**声明这四个参数的路由走
 * `DEFAULT_ROUTE_TRANSITION`（NavHost 级 250ms fade）。
 *
 *   reader                L1116-1136
 *   comic_reader          L1205-1226
 *   comic_chapters        L1270-1275
 *   comic_reader_online   L1570-1579
 *   novel_reader_online   L1694-1697（**只**声明 enter/exit，pop 走 NavHost 默认）
 */
export const ROUTE_TRANSITIONS: Readonly<Partial<Record<RouteName, RouteTransition>>> = {
  [ROUTES.reader]: {
    enter: [
      slideIn(280, 1 / 3, EASE_OUT_CSS),
      fade(200),
    ],
    exit: [fade(220)],
    popEnter: [fade(240)],
    popExit: [
      fade(220),
      { kind: SCALE_KIND, ms: 220, value: 0.96, easing: FAST_OUT_SLOW_IN_CSS },
    ],
  },
  [ROUTES.comicReader]: {
    enter: [fade(320), scaleIn(320, 0.96, FAST_OUT_SLOW_IN_CSS)],
    exit: [fade(220)],
    popEnter: [fade(300), scaleIn(300, 0.98, FAST_OUT_SLOW_IN_CSS)],
    popExit: [fade(220), { kind: SCALE_KIND, ms: 220, value: 0.96, easing: FAST_OUT_SLOW_IN_CSS }],
  },
  [ROUTES.comicChapters]: {
    enter: [fade(280), slideIn(280, 1 / 4)],
    exit: [fade(200)],
    popEnter: [fade(260)],
    popExit: [fade(200)],
  },
  [ROUTES.comicReaderOnline]: {
    enter: [fade(300), scaleIn(300, 0.96)],
    exit: [fade(220)],
    popEnter: [fade(280)],
    popExit: [fade(220)],
  },
  [ROUTES.novelReaderOnline]: {
    enter: [fade(300), slideIn(300, 1 / 4)],
    exit: [fade(200)],
    // Kotlin 这里没声明 popEnter/popExit → 回落 NavHost 默认的 250ms fade
    popEnter: DEFAULT_ROUTE_TRANSITION.popEnter,
    popExit: DEFAULT_ROUTE_TRANSITION.popExit,
  },
};

/** 取一条路由的转场；未声明的路由回落 NavHost 默认。 */
export function routeTransition(route: RouteName): RouteTransition {
  return ROUTE_TRANSITIONS[route] ?? DEFAULT_ROUTE_TRANSITION;
}

/**
 * 把 `RouteTransitionPart[]` 合成 Web Animations API 的关键帧。
 *
 * Compose 里的 `+`（EnterTransition/Transition 组合）是**并行**执行，`togetherWith`
 * 也是；WAAPI 的多关键帧数组同样是并行，因此可以直接按 part 顺序拼接。
 * 偏移量/缩放用百分比表达，保证与容器尺寸无关（`slideInHorizontally` 用的是
 * `fullWidth` / 容器宽度，也是相对的）。
 *
 * `value` 的含义按 `kind` 解释：`slide-x` = 起点横向偏移比例（1/3、1/4），
 * `scale` = 起始缩放（0.96 / 0.98）。
 */
export function routeEnterKeyframes(parts: readonly RouteTransitionPart[]): Keyframe[] {
  const from: Keyframe = { opacity: 0 };
  const to: Keyframe = { opacity: 1 };
  for (const part of parts) {
    if (part.kind === FADE_KIND) continue;
    if (part.kind === SLIDE_IN_KIND) {
      const pct = ((part.value ?? 0) * 100).toFixed(4);
      from.transform = `translateX(${pct}%)`;
      to.transform = 'translateX(0%)';
    } else {
      from.transform = `scale(${part.value ?? 1})`;
      to.transform = 'scale(1)';
    }
  }
  return [from, to];
}

/**
 * 一条路由入场的总时长（取各 part 的最大值 —— 它们是并行执行的，
 * 所以不能用求和，这正是 Compose 里 `+` 与 `togetherWith` 的区别）。
 * 空数组回落到 NavHost 默认的 250ms。
 */
export function routeEnterDurationMs(parts: readonly RouteTransitionPart[]): number {
  if (parts.length === 0) return NAV_FADE_MS;
  return parts.reduce((max, part) => (part.ms > max ? part.ms : max), 0);
}

/**
 * WAAPI 的 timing options。缓动取**最后一个**带 easing 的 part
 * （Kotlin 里 `slideInHorizontally(…, tween(280, IosMotion.EaseOut)) + fadeIn(tween(200))`
 * 两条曲线并存，WAAPI 只有一条，故取显式指定缓动的那条；全 linear 时保持 linear）。
 */
export function routeEnterOptions(parts: readonly RouteTransitionPart[]): {
  duration: number;
  easing: string;
  fill: 'both';
} {
  let easing = 'linear';
  for (const part of parts) {
    if (part.easing !== 'linear') easing = part.easing;
  }
  return { duration: routeEnterDurationMs(parts), easing, fill: 'both' };
}

/**
 * ── 与 `appStore.RouteKey` 的对应关系（2026-10-06 补注） ──────────────────────
 * `ROUTES.home === 'home'`，而 `appStore.RouteKey` 里同一个目的地叫 `'main'`
 * （因为 Compose 侧是 `composable("home")` 包着 MainShell，Web 侧直接就是主壳）。
 * `ROUTES` 里多出的 `cache_management` 与 `appStore` 多出的 `downloadManager` /
 * `godCoverCrop` 都没有 Kotlin NavHost 路由对应物 —— 见 `docs/PARITY_EXCEPTIONS.md`。
 * ⚠️ `NavStack` 目前**不是** appStore 的栈：store 只有一个扁平的 `route` 字段，
 * 各页面的「返回」是写死的 `setRoute('main')` / `setRoute('comicChapters')`，
 * 所以系统返回键 / 手势返回目前无处可接。同样登记在 PARITY_EXCEPTIONS。
 */
export const ROUTE_KEY_ALIASES: Readonly<Record<string, string>> = {
  [ROUTES.home]: 'main',
};

/** Tab 栏四项（L500-507），顺序与图标语义照抄。 */
export interface AppTabItem {
  label: string;
  outlinedIcon: string;
  filledIcon: string;
}

export const TAB_ITEMS: readonly AppTabItem[] = [
  { label: '书库', outlinedIcon: 'search', filledIcon: 'search-filled' },
  { label: '书架', outlinedIcon: 'bookmark-border', filledIcon: 'bookmark' },
  { label: '统计', outlinedIcon: 'bar-chart', filledIcon: 'bar-chart-filled' },
  { label: '设置', outlinedIcon: 'settings', filledIcon: 'settings-filled' },
];

/* ══════════════ 路由栈 ══════════════ */

export interface NavOptions {
  /** `popUpTo(x) { inclusive = true }` —— 弹栈并把 x 本身也移除。 */
  popUpTo?: string;
  inclusive?: boolean;
  /** `launchSingleTop = true` —— 目标已在栈顶时不重复压栈（MainActivity L1442）。 */
  launchSingleTop?: boolean;
}

/**
 * 最小导航栈：`splash` 为起点。
 * Android 的 NavController 内部维护同一份栈；这里显式建模，
 * 让「跳 A 再回来」与 Android 行为一致（后进先出）。
 */
export class NavStack {
  private stack: RouteName[];

  constructor(start: RouteName = ROUTES.splash) {
    this.stack = [start];
  }

  /** 当前栈顶（= 正在显示的页面）。 */
  get current(): RouteName {
    return this.stack[this.stack.length - 1] as RouteName;
  }

  /** 只读快照，供 UI 层判断「能否返回」。 */
  snapshot(): readonly RouteName[] {
    return this.stack;
  }

  canGoBack(): boolean {
    return this.stack.length > 1;
  }

  /** `navController.navigate(route)`。 */
  navigate(route: RouteName, options: NavOptions = {}): void {
    if (options.popUpTo !== undefined) {
      const index = this.stack.lastIndexOf(options.popUpTo as RouteName);
      if (index >= 0) {
        this.stack = options.inclusive === true
          ? this.stack.slice(0, index)
          : this.stack.slice(0, index + 1);
      }
    }
    // NavController 不会把已存在的栈顶重复压入（launchSingleTop 与
    // popUpTo 回退到同一路由两种情况都会命中这个去重）。
    if (this.current === route) return;
    this.stack.push(route);
  }

  /** `navController.popBackStack()`。栈只剩 1 项时不动（Android 同样行为）。 */
  popBackStack(): boolean {
    if (!this.canGoBack()) return false;
    this.stack.pop();
    return true;
  }

  /**
   * 返回到指定路由；不在栈里则不动。
   * 参数放宽到 `RouteName | string`：调用方常拿用户输入或后端返回的裸字符串来试，
   * 未知路由本来就该安静地返回 false（与 NavController 的 `popBackStack(route)` 一致）。
   */
  popBackTo(route: RouteName | (string & {}), inclusive = false): boolean {
    const index = this.stack.lastIndexOf(route as RouteName);
    if (index < 0) return false;
    this.stack = inclusive ? this.stack.slice(0, index) : this.stack.slice(0, index + 1);
    return true;
  }

  /** 开屏/引导页的固定跳转（L457-460 / L469-471）。 */
  leaveSplash(hasSeenOnboarding: boolean): void {
    this.navigate(hasSeenOnboarding ? ROUTES.home : ROUTES.onboarding, {
      popUpTo: ROUTES.splash,
      inclusive: true,
    });
  }
}

/* ══════════════ 跨路由一次性信标 ══════════════ */

/**
 * ComicJumpState（MainActivity.kt L77-81）：
 * 章节页 → 在线阅读器的起始页；阅读器退出时回写最近页。
 */
export const comicJump = {
  startPage: 0,
  lastPage: -1,
  /** 从在线阅读器回到章节页时清空（避免下次进入误用）。 */
  reset(): void {
    comicJump.startPage = 0;
    comicJump.lastPage = -1;
  },
};

/* ══════════════ sanitize（MainActivity.kt L1311-1314） ══════════════ */

/** 文件名净化：非法字符换下划线、trim、最多 120 字符。 */
export function sanitizeFileName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/gu, '_')
    .trim()
    .slice(0, 120);
}

/**
 * 判断某话是否已作为本地漫画下载（MainActivity.kt L1315-1324）。
 * 期望书名 = `sanitize("$comicTitle · ${ch.title}")`，且来源匹配或来源皆空。
 */
export function isChapterDownloadedLocally(
  chapterTitle: string,
  comicTitle: string,
  comicSourceId: string,
  comicId: string,
  allBooks: ReadonlyArray<{
    title: string;
    isComic?: boolean;
    sourceId?: string | null;
    comicId?: string | null;
  }>,
): boolean {
  if (comicTitle.trim() === '') return false;
  const expected = sanitizeFileName(`${comicTitle} · ${chapterTitle}`);
  return allBooks.some(
    (b) =>
      b.isComic === true &&
      b.title === expected &&
      ((b.sourceId === comicSourceId && b.comicId === comicId) ||
        ((b.sourceId === null || b.sourceId === undefined || b.sourceId.trim() === '') &&
          (b.comicId === null || b.comicId === undefined || b.comicId.trim() === ''))),
  );
}

/* ══════════════ formatShelfBytes（MainActivity.kt L556-…） ══════════════ */

/** 书架「用完即焚」临时分享文件的体积文案。 */
export function formatShelfBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/* ══════════════ 启动看门狗（MainActivity.kt L117-140） ══════════════ */

export const BOOT_GUARD_WINDOW_MS = 20_000;
export const BOOT_GUARD_MAX_CRASHES = 2;
/** 「极致」画质回落到「高」。 */
export const RENDER_QUALITY_EXTREME = 3;
export const RENDER_QUALITY_HIGH = 2;

export interface BootPrefsLike {
  getInt(key: string, fallback: number): number;
  getLong(key: string, fallback: number): number;
  putInt(key: string, value: number): void;
  putLong(key: string, value: number): void;
}

/**
 * 启动看门狗（L119-140）：
 * 「极致」画质在 20 秒内连续两次崩溃 → 自动降回「高」，避免实验性着色器
 * 造成「一崩就再也打不开」的死循环变砖。
 * 返回 `true` 表示已执行降级（调用方应重载着色器配置）。
 */
export function runBootGuard(
  prefs: BootPrefsLike,
  nowMs: number,
): { downgraded: boolean; disarm: boolean } {
  if (prefs.getInt('render_quality', RENDER_QUALITY_HIGH) !== RENDER_QUALITY_EXTREME) {
    return { downgraded: false, disarm: false };
  }
  const last = prefs.getLong('boot_guard_last', 0);
  let count = prefs.getInt('boot_guard_cnt', 0);
  count = last > 0 && nowMs - last < BOOT_GUARD_WINDOW_MS ? count + 1 : 1;
  prefs.putLong('boot_guard_last', nowMs);
  prefs.putInt('boot_guard_cnt', count);
  if (count >= BOOT_GUARD_MAX_CRASHES) {
    prefs.putInt('render_quality', RENDER_QUALITY_HIGH);
    prefs.putInt('boot_guard_cnt', 0);
    prefs.putLong('boot_guard_last', 0);
    return { downgraded: true, disarm: false };
  }
  // 存活满 20 秒即解除武装（正常使用不计入）
  return { downgraded: false, disarm: true };
}

/** 存活满窗口后调用（L135-137）。 */
export function disarmBootGuard(prefs: BootPrefsLike): void {
  prefs.putLong('boot_guard_last', 0);
}

/* ══════════════ 跳转目标映射（MainActivity.kt 全部 23 处 navigate） ══════════════ */

/**
 * MainActivity 里每一处跳转的语义，集中登记便于核对：
 *
 *  L458  splash 结束      → hasSeenOnboarding ? home : onboarding（popUpTo splash, inclusive）
 *  L469  onboarding 完成   → home（popUpTo onboarding, inclusive）
 *  L661  书库 → 书源管理    → source_management
 *  L674  书库 → 漫画主页    → comic_chapters
 *  L676  书库 → 本地小说    → reader（先 selectBook）
 *  L687  书库 → 本地漫画    → comic_reader
 *  L689  书库 → 小说阅读器  → reader
 *  L745  书架 → 漫画主页    → comic_chapters
 *  L852  书架 → 漫画主页    → comic_chapters
 *  L857  书架 → 本地漫画    → comic_reader
 *  L859  书架 → 小说阅读器  → reader
 *  L866  书架 → 神回排行榜  → god_ranking
 *  L893  书架 → 漫画主页    → comic_chapters
 *  L903  书架 → 神回编辑    → god_editor
 *  L920  书架 → 书源管理    → source_management
 *  L957  统计 → 神回排行榜  → god_ranking
 *  L996  设置 → 书源管理    → source_management
 *  L1041 设置 → 神回排行榜  → god_ranking
 *  L1074 神回页 → 漫画主页  → comic_chapters
 *  L1079 神回页 → 神回编辑  → god_editor
 *  L1085 神回页 → 设置      → settings
 *  L1442 章节页 → 回主页    → home（launchSingleTop）
 *  L1474 章节页 → 在线小说  → novel_reader_online
 *  L1477 章节页 → 在线漫画  → comic_reader_online
 *  L1510 章节页 → 在线小说  → novel_reader_online
 *  L1513 章节页 → 在线漫画  → comic_reader_online
 */
export const NAV_INTENTS = {
  finishSplash: { route: ROUTES.home, popUpTo: ROUTES.splash, inclusive: true },
  finishOnboarding: { route: ROUTES.home, popUpTo: ROUTES.onboarding, inclusive: true },
  openSourceManagement: { route: ROUTES.sourceManagement },
  openComicChapters: { route: ROUTES.comicChapters },
  openLocalNovelReader: { route: ROUTES.reader },
  openLocalComicReader: { route: ROUTES.comicReader },
  openGodRanking: { route: ROUTES.godRanking },
  openGodEditor: { route: ROUTES.godEditor },
  openSettings: { route: ROUTES.settings },
  backToHome: { route: ROUTES.home, launchSingleTop: true },
  openNovelReaderOnline: { route: ROUTES.novelReaderOnline },
  openComicReaderOnline: { route: ROUTES.comicReaderOnline },
} as const satisfies Record<string, NavOptions & { route: RouteName }>;
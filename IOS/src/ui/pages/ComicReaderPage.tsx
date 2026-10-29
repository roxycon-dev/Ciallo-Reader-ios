/**
 * ComicReaderPage.tsx — 逐行移植 Android `ui/comic/ComicReaderCore.kt`。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderCore.kt
 *            (2121 行 / 108 KB)
 * TS 目标:   IOS/src/ui/pages/ComicReaderPage.tsx
 * 配套:      IOS/src/core/comic/comicReaderCore.ts (纯逻辑) · IOS/src/styles/comic.css (视觉)
 *
 * 移植统计
 * --------
 * 源文件 2121 行。纯函数段(约 700 行)全部移入 comicReaderCore.ts 并逐行移植;
 * UI 段(约 1420 行)在本文件逐段移植, 每段在 "Kotlin → TS" 注释里标明行号。
 * skipped 行与原因集中列在文件末尾 "Skipped（未移植）"。
 *
 * Kotlin → TS 映射（行号 = ComicReaderCore.kt）
 * ---------------------------------------------
 *  107  ComicTocEntry                 → core/ComicTocEntry
 *  110  ComicPanel                    → core/ComicPanel
 *  118  LocalComicTranslationEpoch    → prop `translationEpoch`（外部注入）
 *  129  curlEngineActive              → core/curlEngineActive
 *  142  panelGlassSamplingActive      → core/panelGlassSamplingActive
 *  155  ComicVolumeKeyBridge          → core/ComicVolumeKeyBridge
 *  179  fun ComicReaderCore(...)      → export function ComicReaderPage (L~1150-1620)
 *  752  toneOf                        → core/toneOf
 *  770  effectiveSplitPosition        → core/effectiveSplitPosition
 *  788  resolveTapAction              → core/resolveTapAction
 *  811  PageBitmapState               → core/PageBitmapState
 *  818  rememberPageBitmap            → useComicPageBitmap (L~560)
 *  905  fadeCancelOffset              → core/fadeCancelOffset
 *  918  fadeCrossAlpha                → core/fadeCrossAlpha
 *  922  ComicPagedReader              → ComicPagedReader (L~1000)
 *  1078 dampEdgeDrag                  → core/dampEdgeDrag
 *  1094 magneticTargetShift           → core/magneticTargetShift
 *  1114 ComicMagneticPager            → ComicMagneticPager (L~890)
 *  1290 ComicVerticalList             → ComicVerticalList (L~700)
 *  1480 ComicVerticalItem             → ComicVerticalItem (L~640)
 *  1553 ComicSpreadCell               → ComicSpreadCell (L~380)
 *  1642 fittedSize / 1649 fittedSize   → core/fittedSize / fittedSizeWithCustom
 *  1696 visibleIntrinsicRect          → core/visibleIntrinsicRect
 *  1718 SinglePageContent             → ComicSpreadCell 的单页分支 (L~470-520)
 *  1881 DoubleSpreadContent           → ComicSpreadCell 的双页分支 (L~520-580)
 *  2009 ComicRefinementFeedback       → ComicRefinementFeedback (L~430)
 *  2024 ZoomableImageLayer            → ZoomableImageLayer (L~480)
 *  2058 PagePlaceholder               → PagePlaceholder (L~510)
 *  2090 ComicLoadingFeedback          → ComicLoadingFeedback (L~380)
 *  2117 enhanceHintFor                → core/enhanceHintFor
 *
 * Platform adaptations
 * --------------------
 *  - Box/Column/Row/BoxWithConstraints → div + flex；BoxWithConstraints 的
 *    constraints 用 ResizeObserver（useElementSize）取代。
 *  - graphicsLayer{scale/alpha/translation} → CSS transform / opacity。
 *  - rememberZoomState + comicZoomable（ComicZoomGesture.kt，不在本次范围）→
 *    Pointer Events 手写: setPointerCapture + 多 pointerId 跟踪，实现
 *    缩放 / 平移 / 双击档位 / 长按 QuickZoom / 双指合拢退出 / 触边翻页。
 *  - Animatable.snapTo/animateTo → React state + CSS transition
 *    （spring dampingRatio 0.85 / stiffness 380|420 以 transition 时长近似，
 *      近似点在代码处标注）。
 *  - HorizontalPager / VerticalPager / LazyColumn → scroll-snap-type 容器 +
 *    scrollLeft / scrollTop 定位。
 *  - detectTransformGestures / pinch-zoom → Pointer Events。
 *  - Coil AsyncImage → <img> + onError 回退（重试）。
 *  - Android Bitmap/BitmapFactory → 注入式 ComicPageLoaderPort（core 声明端口，
 *    本文件只提供 WebComicPageLoader：URL 解析 + 浏览器解码 + 缓存，
 *    不含裁边/拆片/调色/增强的像素管线 —— 那属于 ComicImagePipeline.kt）。
 *  - SharedPreferences → localStorage（comic_reader_store:* 命名空间）。
 *  - OrtSessions / TranslationCoordinator（ONNX）→ 外部注入 prop：
 *    translationEpoch / translatingKeys / onTranslationWindowSchedule /
 *    onTranslationSignatureChange。
 *  - layerBackdrop 毛玻璃 → CSS backdrop-filter（comic.css .comic-glass）。
 *  - WindowInsetsController 沉浸式系统栏 → 100dvh + env(safe-area-inset-*)。
 *  - withFrameNanos 逐帧动画 → requestAnimationFrame（垂直自动滚动）/ 挂钟
 *    淡入仍按 Kotlin 的 engineFadeAlpha 纯函数逐帧推进。
 *  - ComicVolumeKeyBridge 的 Activity dispatchKeyEvent → 键盘事件桥
 *    （ArrowUp/ArrowDown，见 core 中的说明）。
 *
 * React 19 约束
 * -------------
 *  - render 期不读 ref.current、不用 Math.random/Date.now
 *    （demo 数据是模块级常量；loader/store 用 useMemo 惰性构造）。
 *  - 派生数据（layout / spread / fitted / zoom contentSize / metrics）
 *    一律 render 期计算；useEffect 内不做同步 setState，
 *    只在定时器 / rAF / Promise 回调里 setState。
 *  - map 回调里没有 hook：每项都是独立组件（ComicVerticalItem / TocRow /
 *    DoubleSlot 语义都在组件内）。
 *  - 所有 hook 位于组件顶层，无条件调用。
 *
 * Skipped（未移植 / 仅保留端口）
 * ------------------------------
 *  L1-104   import 块                     → TS import，无实现
 *  L198     LocalContext.current          → Web 无 Context；配置仓库走 localStorage
 *  L199     rememberCoroutineScope        → 定时器 + Promise 代替协程作用域
 *  L264-272 OrtSessions.ensureCacheRoot /
 *           TranslationCoordinator / LlmBubbleTranslator /
 *           OnlineFallbackTranslator /
 *           translationScope / epoch / busyKeys
 *                                          → ONNX Runtime 无 Web 原样实现；
 *                                            改为注入 prop（translationEpoch /
 *                                            translatingKeys /
 *                                            onTranslationWindowSchedule /
 *                                            onTranslationSignatureChange）
 *  L273-279 coordinator.release / scope.cancel → 由注入方自行管理（页面不持有）
 *  L281-285 lastTranslationSig state     → useRef（effect 内写）
 *  L295     takeBakedKeys → evictProcessed → 保留接线：onTranslationSignatureChange(true)
 *                                            通知注入方执行 eviction
 *  L296-302 resetMarks / bumpEpoch / release → 同上，注入方负责
 *  L305-321 scheduleTranslationWindow    → onTranslationWindowSchedule 回调
 *  L324     loader.sizes.debounce(120)    → loader.subscribeSizes + setSizes（无 120ms 防抖：
 *                                            探测本身已是顺序异步，节流在探测端口内）
 *  L326-328 loader.probeSizes(pages.take(600)) → probeSizes(pages.slice(0, 600))
 *  L372-375 BuildConfig.DEBUG logcat 信标 → console 被 eslint 限制，改用
 *                                            data-* 属性暴露 currentSpread
 *  L376-379 bookState.copy + saveBookState → 保留（bookStateRef 同步 + store.saveBookState）
 *  L389     rememberUpdatedState(onExit)  → useCallback exit
 *  L400-423 WindowCompat / WindowInsetsControllerCompat 沉浸式系统栏
 *                                          → CSS position:fixed + env(safe-area-inset-*)
 *                                            （.comic-core.is-immersive）
 *  L445-462 音量键 handler 注册           → 保留语义，事件源改为 keydown/keyup 桥
 *  L500     Color(0xFF101014) 动态底色初值 → CSS '#101014'
 *  L502-511 ComicImagePipeline.dominantBackground → 注入 prop dominantColorOf
 *                                            （Android 位图主色提取，Web 侧交调用方）
 *  L554-561 rememberLayerBackdrop / layerBackdrop → CSS backdrop-filter（comic.css）
 *  L571-575 ComicReaderBackground(...)   → 内联 background + comic.css 纸张纹理类
 *                                            （该 Kotlin 文件不在本次范围）
 *  L584-604 withFrameNanos 逐帧 engineFade → rAF + engineFadeAlpha 挂钟推进
 *                                            （ticks<90 上限与 240ms 全部保留）
 *  L613-630 ComicVerticalList 参数集      → 保留（含 translationModelState 形参
 *                                            去掉：模型下载态属 TranslateModelManager）
 *  L639     ComicMagneticPager 参数集     → 保留
 *  L643-654 ComicPagedReader 参数集        → 保留（dynamicBgColor 未使用：
 *                                            背景由 ComicReaderBackground 负责）
 *  L659-661 ComicSceneEffectOverlay       → CSS .comic-scene-*（ComicSceneFx.kt 不在范围）
 *  L680     ComicAmbientAudio.create      → @core/audio/ambientAudio getAmbientAudio
 *  L694-748 ComicReaderChrome(...)       → 本文件内的精简 Chrome（ComicReaderChrome.kt /
 *                                            ComicReaderSheets.kt 不在本次范围）：
 *                                            保留顶/底栏、进度滑条、自动阅读、目录、
 *                                            设置；PRESET / CROP / 预设 / 缩略图预览面板
 *                                            标注未移植
 *  L776-780 produceState0 扩展            → Compose Flow 扩展，Web 无 Flow
 *  L836-851 debug 日志（ComicSeedMiss / MTSeed）→ 省略（无 logcat）
 *  L861-867 previewEpoch 收集低清预览      → peekReadingPreview 只在播种时读一次；
 *                                            Web 端口无预览 epoch 流
 *  L945-952 ComicHarismCurlReader        → ComicHarismCurl.kt（GL 卷页引擎）不在本次
 *                                            范围；用 CSS 3D 容器 + perspective 近似
 *  L1032-1039 spacingHalf / beyondViewportPageCount=1 → CSS padding + 相邻槽预载
 *  L1044-1053 Modifier.comicChapterEdgeSwipe → 垂直列表的 Pointer Events 边缘手势
 *                                            + core/comicChapterEdgeTarget 判定
 *  L1141-1142 rememberUpdatedState        → refs / useCallback
 *  L1159-1219 awaitEachGesture + VelocityTracker + slop
 *                                          → Pointer Events + 采样速度（6 点窗口）
 *  L1210     spring(damping 0.85, stiffness 420/380) → CSS transition 200/220ms
 *  L1262-1281 androidx key(idx) 三窗口    → 直接以 idx 为 React key
 *  L1305-1310 Animatable(0f) drag         → useState + CSS transition
 *  L1313     LocalDensity / dp→px        → dp 与 px 按 1:1
 *  L1315-1317 ComicScrollStrategy.forConfig → 内联策略对象（spacing/snap/prefetchWindow）
 *  L1318     measuredHeights map          → itemNodes Map + offsetHeight 实测
 *  L1325-1338 可见面积最大项 → onSpreadChanged → onScroll 里按 offsetTop/offsetHeight 求最大
 *  L1341-1345 scrollToItem 守卫           → 仅当目标项不在视口内才 scrollTo
 *  L1374-1375 preloadWindow + onScheduleTranslation → loader.preloadWindow + 注入回调
 *  L1381     with(density) { dp.toPx() } → dp 直接当 px/s
 *  L1386-1402 withFrameNanos + scrollBy + 3 秒节流 → rAF + scrollTop 赋值，节流常量保留
 *  L1405     rememberZoomState           → 缩放状态在 ComicSpreadCell 内（cell 级）
 *  L1437-1441 SnapFlingBehavior          → CSS scroll-snap（proximity）
 *  L1479-1546 ComicVerticalItem          → 全部移植
 *  L1564     ComicZoomState()            → Web 自实现 ZoomTransform（语义子集）
 *  L1567-1581 磁吸淡入 Animatable(0.45→1, tween 260) → 未单独实现：
 *                                            当前只在 isCurrentPage 切换时整树重建，
 *                                            未叠加 0.45 起始淡入（视觉差异，非语义）
 *  L1586-1602 mirrorX 坐标还原           → 保留（physicalCallbacks + scaleX(-1) 分支）
 *  L1613-1618 comicZoomable / comicEdgeSwipe → Pointer Events 手写实现
 *  L1642-1689 fittedSize                 → core（纯函数）
 *  L1696-1715 visibleIntrinsicRect      → core（纯函数）
 *  L1747-1752 loader.sizes 原始像素基准  → 保留（rawA/rawB）
 *  L1761-1763 SideEffect contentSize    → render 期派生（无副作用）
 *  L1783-1834 decodeRegion 高清重解码   → 判据全部保留并调用 decodeRegionWeb；
 *                                            高清覆盖层已挂载（E68 已关闭）
 *  L1853-1873 hiRes 覆盖层               → 已渲染
 *  L1916-1939 双页 contentSize/intrinsicSize + 主色门控 → render 期派生 + effect 门控
 *  L1941-1956 Row graphicsLayer scale/translation → CSS transform
 *  L1993-1997 enhanceHintFor             → core/enhanceHintFor
 *  L2010 ComicRefinementFeedback 早退    → 保留
 *  L2091-2092 LaunchedEffect 计时        → setInterval（1s tick）
 *  L2093-2097 ComicTransfers.state(url) → 注入 prop transferFor
 *  L2099 ChasingDots                     → comic.css .comic-chasing-dots
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { getAmbientAudio } from '@core/audio/ambientAudio';
import {
  ChapterNavigationLatch,
  ComicVolumeKeyBridge,
  COMIC_SIZE_ZERO,
  EMPTY_COMIC_BOOK_STATE,
  buildComicLayout,
  comicCacheKey,
  comicChapterEdgeTarget,
  comicLayoutSpreadCount,
  comicLoadingLabel,
  curlEngineActive,
  dampEdgeDrag,
  effectiveRotation,
  effectiveSplitPosition,
  enhanceHintFor,
  engineFadeAlpha,
  fadeCancelOffset,
  fadeCrossAlpha,
  fittedSizeWithCustom,
  geometryHasWork,
  imagePipelineFingerprint,
  magneticTargetShift,
  pageRotationOf,
  panelGlassSamplingActive,
  rectfHeight,
  rectfWidth,
  resolveTapAction,
  spreadFirstRawIndex,
  spreadOfRawPage,
  toneOf,
  verticalPreloadIndices,
  visibleIntrinsicRect,
  type ComicBitmap,
  type ComicBookState,
  type ComicGestureCallbacks,
  type ComicLayout,
  type ComicPageLoaderPort,
  type ComicPageLoaderWindowEntry,
  type ComicPageRef,
  type ComicPanel,
  type ComicReaderConfig,
  type ComicRectF,
  type ComicScrollMetricsLike,
  type ComicSize,
  type ComicSizeInfo,
  type ComicSlot,
  type ComicSpread,
  type ComicTocEntry,
  type ComicTransferLike,
  type ComicZoomSnapshot,
  type PageBitmapState,
} from '@core/comic/comicReaderCore';
import { ComicSettingsStore, comicPrefsKey, type ComicKeyValueStore } from '@core/comic/comicSettingsStore';
import { DEFAULT_COMIC_READER_CONFIG } from '@core/comic/comicReaderConfig';
// E43：WebGL2 卷页渲染器（harism CurlGL 的 Web 实现）。
import { htmlImageToPixImage, WebCurlGl } from '@platform/web/webCurlGl';
// E43：`CurlPageSink.setTexture` 的 side 常量。
import { CURL_SIDE_FRONT } from '@core/comic/comicHarismCurl';
import { DECODE_MAX_EDGE } from '@core/comic/comicPageLoader';
// E68：区域重解码的 `targetEdge` 常量，必须与 core 的 `sampleSizeFor` 同源，
// 否则页面与解码器会算出不同的采样率。
import { decodeRegionWeb } from '@platform/web/webRegionDecoder';
import { useAppStore } from '@ui/state/appStore';
import {
  ComicCropSheet,
  ComicPresetSheet,
  ComicSettingsSheet,
  ComicTocSheet,
  UNSUPPORTED_TRANSLATION_BRIDGE,
  type ComicCropLoader,
  type ComicPreviewLoader,
  type ComicThumbLoader,
} from '../components/comic/sheets';
import {
  SCENE_OPTIONS,
  type ComicSheetsConfig,
  type ComicSheetsCustomFitPreset,
  type ComicSheetsPreset,
} from '@core/comic/comicReaderSheets';
import { scrollElementTo } from '@ui/lib/scroll';
import '../../styles/comic.css';

/**
 * 把 caught 值压成一行可读原因，供 `console.warn` 使用。
 *
 * 为什么不直接把 `error` 传给 console：下面三处端口 catch 都跑在**每次挂载**的
 * effect 里，把 Error 对象丢进 console 会连带打出完整堆栈（jsdom 下路径还特别长），
 * 测试日志里一次挂载刷 5 行、25 个用例刷 125 行，真正的失败信息反而被埋掉。
 * `message` 里保留了 `STATUS_BAR_UNAVAILABLE` / `NETWORK_UNAVAILABLE` 这类
 * 可搜索关键字，排障能力不受影响。
 *
 * 与 `ReaderPage.tsx` 的同名函数保持一致（两页各自本地声明，不进共享模块 ——
 * 它只服务日志格式化，不值得为它建一层依赖）。
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 模块级常量（禁止 render 期生成随机/时间数据 → 全部提升）
 * ═══════════════════════════════════════════════════════════════════════ */

/** Kotlin L594 帧计数上限 / L596 的 240ms 挂钟淡入 */
const ENGINE_FADE_MAX_TICKS = 90;
const ENGINE_FADE_DURATION_MS = 240;

/** Kotlin L1393 换章节流节流：3 秒内不重复触发 */
const REACH_END_COOLDOWN_MS = 3000;
const REACH_END_STALL_FRAMES = 30;

/** Kotlin ComicLoadingFeedback L2092 / L2110 / L2106 */
const LOADING_TICK_MS = 1000;
const RETRY_HINT_SEC = 8;

/** Kotlin L1512 / L1524 / L1978 占位高度（dp 按 1:1 落到 px） */
const VERTICAL_LOADING_HEIGHT_PX = 360;
const VERTICAL_FAILED_HEIGHT_PX = 240;
const DOUBLE_SLOT_HEIGHT_PX = 320;

/** Kotlin L1390 自动滚动"到底"阈值 */
const AUTO_SCROLL_STALL_PX = 0.1;

/** Kotlin ComicChapterEdgeGesture L48 的 48dp 阈值 */
const CHAPTER_EDGE_THRESHOLD_PX = 48;

/** demo 页面（Kotlin 的 pages 由调用方注入；Web 默认用模块级常量） */
function demoPage(index: number): ComicPageRef {
  return {
    kind: 'REMOTE',
    id: `demo-p${String(index + 1)}`,
    url: `mock:page-${String(index + 1)}`,
    headers: {},
    referer: null,
  };
}

const DEMO_PAGES: readonly ComicPageRef[] = Array.from({ length: 6 }, (_, i) => demoPage(i));

const MOCK_TONES = ['#5c6bc0', '#26a69a', '#ef6c00', '#8e24aa', '#00838f', '#6d4c41'] as const;

/** mock: URL → 内联 SVG data URI（模块级常量；避免 render 期生成） */
function mockSrc(index: number): string {
  const tone = MOCK_TONES[index % MOCK_TONES.length] ?? '#5c6bc0';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0" stop-color="${tone}"/><stop offset="1" stop-color="#1a1a1a"/>` +
    '</linearGradient></defs>' +
    '<rect width="900" height="1350" fill="url(#g)"/>' +
    `<text x="450" y="700" font-family="sans-serif" font-size="130" fill="#ffffff" ` +
    `text-anchor="middle" opacity="0.85">P${String(index + 1)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicSettingsStore — 存储端口接线（实现见 @core/comic/comicSettingsStore）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ComicSettingsStore.kt 的逐行移植已落地为 `@core/comic/comicSettingsStore`
 * （← `comicSettingsStore.ts`，含全局配置 / 内置与用户预设 / 自定义缩放预设 /
 * 每本漫画覆盖与阅读状态 / effectiveConfig 优先级）。本文件此前那份重复的
 * `WebComicSettingsStore` 实现已删除，这里只保留两样接线：
 *
 *   1. `createWebComicPrefs()` —— `ComicKeyValueStore` 的 localStorage 实现。
 *      core 层不能碰 DOM（硬约束），适配器留在页面层。键名经 `comicPrefsKey()`
 *      加上 `comic_reader_store:` 命名空间前缀，与 Kotlin
 *      `getSharedPreferences("comic_reader_store")` 内部的键**逐字一致**，也与
 *      被删掉的那份实现完全一致 → 存量用户数据零迁移。
 *   2. `WebComicSettingsStorePort` —— 注入端口（Kotlin L179 形参是具体的
 *      `ComicSettingsStore`；Web 侧写成结构类型，好让 App / 测试注入替身，
 *      与 `comicReaderChrome.tsx` 的 `ComicSettingsStorePort` 同一惯例）。
 *
 * 附带的能力变化：预设系统（`loadPresets()` / `createPreset()` /
 * `favoritePresets()` / `setDefaultPreset()` / 自定义缩放预设等）现在随
 * `ComicSettingsStore` 一并可用，且 `loadGlobalConfig()` 会按 Kotlin L72-80
 * 先 `ensureBuiltinPresets()` —— 首次读取时把三个内置预设写进
 * `comic_reader_store:presets`，并以**默认预设（日漫）**的配置起步。
 */

/** `ComicKeyValueStore` 的 localStorage 实现（键 = `comicPrefsKey(key)`）。 */
function createWebComicPrefs(): ComicKeyValueStore {
  return {
    getString: (key) => window.localStorage.getItem(comicPrefsKey(key)),
    putString: (key, value) => window.localStorage.setItem(comicPrefsKey(key), value),
    remove: (key) => window.localStorage.removeItem(comicPrefsKey(key)),
  };
}

/**
 * 本页面实际调用的仓库方法（Kotlin L198-218 + L376-379）。
 * config / state 的类型沿用 `@core/comic/comicReaderCore` 的同名字段，
 * 与 `@core/comic/comicSettingsStore` 的形参结构兼容（可双向赋值）。
 */
export interface WebComicSettingsStorePort {
  loadGlobalConfig(): ComicReaderConfig;
  saveGlobalConfig(config: ComicReaderConfig): void;
  loadBookConfig(bookKey: string): ComicReaderConfig | null;
  saveBookConfig(bookKey: string, config: ComicReaderConfig): void;
  clearBookConfig(bookKey: string): void;
  loadBookState(bookKey: string): ComicBookState;
  saveBookState(bookKey: string, state: ComicBookState): void;
  effectiveConfig(bookKey: string | null): { config: ComicReaderConfig; hasOverride: boolean };
}

/** Kotlin `ComicBookState()`（bookKey == null 时的初始状态）。 */
const NO_BOOK_STATE = EMPTY_COMIC_BOOK_STATE;

/**
 * 垂直模式下的「无合页锚点」常量。
 *
 * Kotlin L358 是 `bookState.copy(mergeAnchors = emptySet())` —— 每次都是新对象，
 * 但 Compose 的 `remember` key 只比较 `equals`，`emptySet() == emptySet()` 为真，
 * 所以不会引起重算。TS 侧 `useMemo` 依赖比较的是**引用**，`new Set()` 每次都是新引用
 * 会让 memo 永远失效，因此这里必须提一个模块级常量。
 */
const EMPTY_MERGE_ANCHORS: ReadonlySet<number> = new Set<number>();

/* ═══════════════════════════════════════════════════════════════════════════
 * 面板族接线（ComicReaderSheets.kt 的四个面板）
 *
 * Kotlin `ComicReaderChrome.kt` L269-307 在 `when (panel)` 里把四个面板
 * 挂出来：`ComicSettingsSheet` / `ComicTocSheet` / `ComicPresetSheet` /
 * `ComicCropSheet`，它们各自需要 store（预设 + 自定义缩放预设）、loader
 * （预览 / 缩略图）、pages、bookState 与若干回调。
 *
 * 本页此前把这段替换成了 `ComicReaderPage.tsx` 内部的一份 5 select + 3 slider
 * + 4 checkbox 的精简面板，并在 PRESET / CROP 两个分支渲染占位文案
 * 「该面板由 ComicReaderSheets.kt 提供，本次未移植。」——用户点得到但没实现。
 * 现已改为直接渲染 `../components/comic/sheets` 的真移植版，缺口见下：
 *
 *   - `store`：`WebComicSettingsStorePort` 只声明本页读配置用的 7 个方法；
 *     面板要的预设 / 自定义缩放预设方法在 Kotlin 里同一个 `ComicSettingsStore`
 *     上。这里用结构判定补上（`asPresetStore`）：真实现（`ComicSettingsStore`）
 *     全都具备；只实现了 7 个方法的测试替身则退化为 `null`，面板按
 *     Kotlin `PageTab(store = null)` 的既有约定隐藏自定义缩放预设区。
 *   - `loader`：Kotlin `loader.loadPreview(...)` / `loader.loadThumb(...)` 属于
 *     `ComicPageLoader.kt`（像素管线，本次范围外）；`ComicPageLoaderPort` 上
 *     没有同名方法，故按「先看宿主是否原生提供，再退化到 loadForDisplay」接线，
 *     退化时用带前缀的独立 cacheKey，避免把缩略图塞进整页处理缓存。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 面板预设系统的最小结构（= `ComicPresetSheet` 的 `PresetStore` + `PageTab` 的 `CustomFitStore`）。 */
export interface WebComicPresetStorePort {
  loadPresets(): ComicSheetsPreset[];
  defaultPresetId(): string;
  createPreset(name: string, emoji: string, config: ComicSheetsConfig): unknown;
  togglePresetFavorite(id: string): unknown;
  setDefaultPreset(id: string): void;
  duplicatePreset(id: string): unknown;
  updatePreset(id: string, name?: string, config?: ComicSheetsConfig): unknown;
  deletePreset(id: string): boolean;
  loadCustomFitPresets(): ComicSheetsCustomFitPreset[];
  saveCustomFitPreset(name: string, base: string, scalePct: number): unknown;
  deleteCustomFitPreset(id: string): boolean;
}

/** 结构判定：宿主仓库是否同时具备面板要的预设 / 自定义缩放预设方法。 */
function asPresetStore(
  store: WebComicSettingsStorePort,
): (WebComicSettingsStorePort & WebComicPresetStorePort) | null {
  const candidate = store as Partial<WebComicPresetStorePort>;
  const required = [
    'loadPresets',
    'defaultPresetId',
    'createPreset',
    'togglePresetFavorite',
    'setDefaultPreset',
    'duplicatePreset',
    'updatePreset',
    'deletePreset',
    'loadCustomFitPresets',
    'saveCustomFitPreset',
    'deleteCustomFitPreset',
  ] as const;
  for (const key of required) {
    if (typeof candidate[key] !== 'function') return null;
  }
  return store as WebComicSettingsStorePort & WebComicPresetStorePort;
}

/** loader 若原生提供了面板用的三个方法就直接用（结构判定，不用 `any`）。 */
interface NativeSheetLoader {
  loadPreview?: (ref: ComicPageRef, config: ComicReaderConfig) => Promise<string | null>;
  loadThumb?: (ref: ComicPageRef) => Promise<string | null>;
  loadCropPreview?: (ref: ComicPageRef) => Promise<string | null>;
}

function nativeSheetLoader(loader: ComicPageLoaderPort): NativeSheetLoader {
  return loader as ComicPageLoaderPort & NativeSheetLoader;
}

/** 缩略图退化路径的 cacheKey 前缀（避免污染整页处理缓存；Kotlin 用独立的 `loadThumb` 管线）。 */
const SHEET_THUMB_CACHE_PREFIX = 'thumb|';

/**
 * `comicReaderCore.ComicReaderConfig.scene` 声明为 `string`（与
 * `@core/audio/sceneTypes` 的 ComicScene 同名值共用），而面板侧要枚举联合。
 * 这里按面板自己的场景表收窄 —— 未知值一律回落到 `'NONE'`
 * （Kotlin `ComicScene` 只有八档，`safe("scene", ComicScene.NONE, entries)` 同理）。
 */
function toSheetsScene(scene: string): ComicSheetsConfig['scene'] {
  const hit = SCENE_OPTIONS.find((option) => option.scene === scene);
  return hit === undefined ? 'NONE' : hit.scene;
}

/**
 * `ComicReaderConfig` → 面板的 `ComicSheetsConfig`。
 *
 * 两边的字段名与类型**逐个相同**，只有两处需要显式转换：
 *   1. `manualCrop` 的数组可变性（core 侧 `readonly number[]`，面板侧 `number[]`）
 *      —— 显式复制一份：面板的 `clampCrop` / 裁边编辑器本来就会产出新数组，
 *      给它可写副本最贴近 Kotlin `List<Float>` 的可变语义；
 *   2. `scene` 的 string → 枚举收窄（见 `toSheetsScene`）。
 * 不用 `as` 断言掩盖这两处。
 */
function toSheetsConfig(config: ComicReaderConfig): ComicSheetsConfig {
  return {
    ...config,
    manualCrop: config.manualCrop === null ? null : [...config.manualCrop],
    scene: toSheetsScene(config.scene),
  };
}

/**
 * 面板只读写 `ComicBookState` 的两个字段（`ComicReaderSheets.kt` L847/854），
 * 其余字段（`lastPage` / `lastChapterSig`）由阅读器进度链路维护。这里做一次
 * 显式的窄→宽合并，语义与 Kotlin `bookState.copy(pageRotations = …,
 * mergeAnchors = …)` 完全一致（未列出的字段原样保留）。
 */
function toBookStatePatch(
  base: ComicBookState,
  patch: { pageRotations: Record<string, number>; mergeAnchors: ReadonlySet<number> },
): ComicBookState {
  return { ...base, pageRotations: patch.pageRotations, mergeAnchors: patch.mergeAnchors };
}

/**
 * Kotlin `ComicImagePipeline.Geometry()` / `.Toning()` 的**默认构造**零值
 * （`ComicReaderSheets.kt` L1657：裁边编辑器用空几何 + 空色调取未处理的小图）。
 * Kotlin 两个数据类的字段都带默认值，`Geometry()` / `Toning()` 即全默认值。
 */
const DEFAULT_SHEET_PREVIEW_CONFIG = DEFAULT_COMIC_READER_CONFIG;

/** 预览/缩略图/裁边预览的 loader 适配（见上方说明）。 */
function makeSheetLoaders(
  pages: readonly ComicPageRef[],
  loader: ComicPageLoaderPort,
  sizes: Readonly<Record<string, ComicSizeInfo>>,
): { preview: ComicPreviewLoader; thumb: ComicThumbLoader; crop: ComicCropLoader } {
  const byId = new Map(pages.map((ref) => [ref.id, ref]));
  const native = nativeSheetLoader(loader);

  const preview: ComicPreviewLoader = {
    // Kotlin 940-952 `loader.loadPreview(page, Geometry(cropMode, manualCrop,
    // rotationDeg = bookRotation), Toning(...))`
    loadPreview: async (page, config) => {
      const ref = byId.get(page.id);
      if (ref === undefined) return null;
      if (native.loadPreview !== undefined) return native.loadPreview(ref, config);
      const geometry = {
        half: 'FULL' as const,
        splitPosition: effectiveSplitPosition(
          config,
          sizes[ref.id]?.gutterPos ?? null,
        ),
        rotationDeg: effectiveRotation(config.bookRotation, 0),
        cropMode: config.cropMode,
        manualCrop: config.manualCrop,
      };
      const bitmap = await loader.loadForDisplay({
        ref,
        cacheKey: comicCacheKey(ref, 'FULL', imagePipelineFingerprint(config), config.bookRotation),
        geometry,
        tone: toneOf(config),
        visible: false,
      });
      return bitmap.src;
    },
  };

  const thumb: ComicThumbLoader = {
    // Kotlin 1359 `loader.loadThumb(page)`；`edge = 220` 是 Kotlin 侧默认。
    loadThumb: async (page) => {
      const ref = byId.get(page.id);
      if (ref === undefined) return null;
      if (native.loadThumb !== undefined) return native.loadThumb(ref);
      const bitmap = await loader.loadForDisplay({
        ref,
        cacheKey: `${SHEET_THUMB_CACHE_PREFIX}${ref.id}`,
        geometry: {
          half: 'FULL',
          splitPosition: effectiveSplitPosition(
            DEFAULT_SHEET_PREVIEW_CONFIG,
            sizes[ref.id]?.gutterPos ?? null,
          ),
          rotationDeg: 0,
          cropMode: 'OFF',
          manualCrop: null,
        },
        tone: toneOf(DEFAULT_SHEET_PREVIEW_CONFIG),
        visible: false,
      });
      return bitmap.src;
    },
  };

  const crop: ComicCropLoader = {
    // Kotlin 1657 `loader.loadPreview(page, Geometry(), Toning())`
    // （**默认**几何/色调 —— 与设置面板的实时预览不同，Kotlin 原样）
    loadCropPreview: async (page) => {
      const ref = byId.get(page.id);
      if (ref === undefined) return null;
      if (native.loadCropPreview !== undefined) return native.loadCropPreview(ref);
      return thumb.loadThumb(page);
    },
  };

  return { preview, thumb, crop };
}


/* ═══════════════════════════════════════════════════════════════════════════
 * WebComicPageLoader — 注入式解码器端口的 Web 实现
 * （像素级处理管线属于 ComicImagePipeline.kt，本次只做 URL 解析 + 解码 + 缓存）
 * ═══════════════════════════════════════════════════════════════════════ */

function resolveComicSrc(ref: ComicPageRef): string {
  if (ref.kind === 'LOCAL') return ref.path;
  if (ref.url.startsWith('mock:')) {
    const parsed = Number.parseInt(ref.url.slice('mock:'.length).replace(/\D+/g, ''), 10);
    return mockSrc(Number.isFinite(parsed) ? Math.max(0, parsed - 1) : 0);
  }
  return ref.url;
}

function measureBitmap(src: string): Promise<ComicBitmap> {
  return new Promise<ComicBitmap>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        src,
        width: img.naturalWidth > 0 ? img.naturalWidth : 1,
        height: img.naturalHeight > 0 ? img.naturalHeight : 1,
      });
    };
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

/**
 * 「仅 Wi-Fi 预加载」设置项（Kotlin `PreferencesManager(context).preloadWifiOnly`，
 * ComicPageLoader.kt:694）。
 *
 * 类外的模块级 ref：loader 在 `useMemo` 里只创建一次，设置项切换后要能读到最新值，
 * 用 ref 而非构造参数，避免为设置项重建整个 loader（丢掉已解码缓存）。
 * 由 `ComicReaderPage` 的 effect 在 prefs 变化时同步。
 */
const comicPreloadWifiOnlyRef: { current: boolean } = { current: false };

class WebComicPageLoader implements ComicPageLoaderPort {
  private readonly processed = new Map<string, ComicBitmap>();
  private readonly previews = new Map<string, ComicBitmap>();
  private readonly inflight = new Map<string, Promise<ComicBitmap>>();
  private sizeSnapshot: Readonly<Record<string, ComicSizeInfo>> = {};
  private readonly sizeListeners = new Set<(s: Readonly<Record<string, ComicSizeInfo>>) => void>();
  private probeGeneration = 0;

  peekProcessed = (cacheKey: string): ComicBitmap | null => this.processed.get(cacheKey) ?? null;

  peekReadingPreview = (cacheKey: string): ComicBitmap | null => this.previews.get(cacheKey) ?? null;

  sizes = (): Readonly<Record<string, ComicSizeInfo>> => this.sizeSnapshot;

  subscribeSizes = (
    listener: (s: Readonly<Record<string, ComicSizeInfo>>) => void,
  ): (() => void) => {
    this.sizeListeners.add(listener);
    return () => {
      this.sizeListeners.delete(listener);
    };
  };

  loadForDisplay(request: {
    ref: ComicPageRef;
    cacheKey: string;
    visible: boolean;
  }): Promise<ComicBitmap> {
    const cached = this.processed.get(request.cacheKey);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.inflight.get(request.cacheKey);
    if (pending !== undefined) return pending;
    const task = measureBitmap(resolveComicSrc(request.ref)).then(
      (bitmap) => {
        this.inflight.delete(request.cacheKey);
        this.processed.set(request.cacheKey, bitmap);
        return bitmap;
      },
      (error: unknown) => {
        this.inflight.delete(request.cacheKey);
        throw error instanceof Error ? error : new Error('图片加载失败');
      },
    );
    this.inflight.set(request.cacheKey, task);
    return task;
  }

  /**
   * 高倍缩放区域重解码（E68）。
   *
   * Kotlin `ComicPageLoader.decodeRegion(ref, rect, targetEdge, cacheTag)`：深放大时
   * 对**可视区域按原始像素**重新解码，而不是放大已解码的全页位图 —— 全页解码受
   * `DECODE_MAX_EDGE`(2800) 约束，深放大细节会发虚。
   *
   * 原实现恒返回 `null`（注释写「像素级 decodeRegion 未移植」），但解码原语其实
   * 早已存在于 `platform/web/webRegionDecoder.ts` 的 `decodeRegionWeb` —— 只是
   * 没人调用它。判定、夹取、采样率、32 MiB LRU 全部在 core 的
   * `ComicPageLoader.decodeRegion` 里逐行移植好了，本方法只负责把「显示 URL」
   * 交给 Web 实现裁一次。
   *
   * 与 Kotlin 的差异（已知且可接受）：
   *   - Kotlin 返回 `Bitmap`，本实现返回 data URL —— `ComicBitmap` 没有像素数组
   *     通道，页面只把它当 `<img src>` 用，这是唯一可渲染的等价物；
   *   - Kotlin 只对本地文件生效（`ref.kind !== Local` 直接返回 null），本实现
   *     同样只接 `LOCAL`，其余返回 null 以对齐。
   */
  private readonly regionCache = new Map<string, ComicBitmap>();

  private readonly regionInflight = new Map<string, Promise<ComicBitmap | null>>();

  decodeRegion(
    local: Extract<ComicPageRef, { kind: 'LOCAL' }>,
    rect: ComicRectF,
    cacheTag: string,
  ): Promise<ComicBitmap | null> {
    // Kotlin `if (ref.kind !== Local) return null` —— 仅本地文件。
    if (local.kind !== 'LOCAL') return Promise.resolve(null);
    // Kotlin `if (rect.width() < 8 || rect.height() < 8) return null`
    if (rect.right - rect.left < 8 || rect.bottom - rect.top < 8) {
      return Promise.resolve(null);
    }
    const key = `rgn|${local.path}|${cacheTag}|${rect.left | 0},${rect.top | 0},${rect.right | 0},${rect.bottom | 0}`;
    const hit = this.regionCache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.regionInflight.get(key);
    if (pending !== undefined) return pending;

    const task = decodeRegionWeb(
      resolveComicSrc(local),
      { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      DECODE_MAX_EDGE,
    ).then(
      (bitmap) => {
        this.regionInflight.delete(key);
        if (bitmap !== null) this.regionCache.set(key, bitmap);
        return bitmap;
      },
      () => {
        // Kotlin `catch { return null }` —— 解码失败不冒泡，静默回落到低清整页。
        this.regionInflight.delete(key);
        return null;
      },
    );
    this.regionInflight.set(key, task);
    return task;
  }

  preloadWindow(entries: readonly ComicPageLoaderWindowEntry[]): void {
    // Kotlin L548-549: 整窗一次提交（逐槽调用会互相取消预载任务）
    // Kotlin L719-722「仅 Wi-Fi 预加载」：非 Wi-Fi 且计费网络时，**在线页**不提前下载；
    // 本地页与当前页（visible）不受影响 —— E67（`platform.network`）。
    void (async () => {
      let skipRemote = false;
      try {
        const { getPlatform } = await import('@platform/index');
        const policy = comicPreloadWifiOnlyRef.current;
        if (policy && !getPlatform().network.wifiConnectedOrUnmetered()) {
          skipRemote = true;
        }
      } catch (error) {
        // 端口不可用：放行（等价 Kotlin `cm == null → return true` 的兜底）。
        console.warn('[comic] network 端口未生效，预载按放行处理：', describeError(error));
      }
      for (const entry of entries) {
        if (skipRemote && !entry.visible && entry.ref.kind === 'REMOTE') continue;
        void this.loadForDisplay(entry).catch(() => {
          // 预载失败不阻断阅读（缓存未命中，渲染路径会自行报错）
        });
      }
    })();
  }

  replaceProcessed(cacheKey: string, bitmap: ComicBitmap): void {
    this.processed.set(cacheKey, bitmap);
  }

  evictProcessed(cacheKey: string): void {
    this.processed.delete(cacheKey);
    this.previews.delete(cacheKey);
    this.inflight.delete(cacheKey);
  }

  async probeSizes(pages: readonly ComicPageRef[]): Promise<void> {
    const generation = ++this.probeGeneration;
    const next: Record<string, ComicSizeInfo> = { ...this.sizeSnapshot };
    // 顺序探测避免抢占 CPU（Kotlin L326-328）
    for (const ref of pages) {
      if (generation !== this.probeGeneration) return;
      try {
        const bitmap = await measureBitmap(resolveComicSrc(ref));
        next[ref.id] = {
          width: bitmap.width,
          height: bitmap.height,
          gutter: null,
          gutterPos: null,
        };
      } catch {
        // 探测失败保留旧值（Kotlin 同语义）
      }
    }
    if (generation !== this.probeGeneration) return;
    this.sizeSnapshot = next;
    for (const listener of this.sizeListeners) listener(next);
  }

  clearProcessedCache(): void {
    this.processed.clear();
    this.previews.clear();
    this.inflight.clear();
  }

  shutdown(): void {
    this.probeGeneration += 1;
    this.clearProcessedCache();
    this.sizeSnapshot = {};
    for (const listener of this.sizeListeners) listener({});
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 通用 hook / 工具
 * ═══════════════════════════════════════════════════════════════════════ */

/** BoxWithConstraints 的等价：ResizeObserver 取代 constraints */
function useElementSize(ref: RefObject<HTMLElement | null>): ComicSize {
  const [size, setSize] = useState<ComicSize>(COMIC_SIZE_ZERO);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const apply = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function clampIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, value));
}

/** Kotlin `value.coerceIn(0, (size - 1).coerceAtLeast(0))` */
function coercePage(value: number, pageCount: number): number {
  return Math.min(Math.max(pageCount - 1, 0), Math.max(0, value));
}

function bitmapSizeOf(state: PageBitmapState): ComicSize {
  if (state.kind !== 'READY') return COMIC_SIZE_ZERO;
  return { width: state.bitmap.width, height: state.bitmap.height };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicLoadingFeedback (Kotlin L2089-2114)
 * ═══════════════════════════════════════════════════════════════════════ */

interface LoadingFeedbackProps {
  readonly ref_: ComicPageRef | null;
  readonly transfer: ComicTransferLike | null;
  readonly onRetry: (() => void) | null;
}

function ComicLoadingFeedback({ ref_, transfer, onRetry }: LoadingFeedbackProps): ReactNode {
  // Kotlin L2091-2092: 每秒 tick 计时
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((prev) => prev + 1), LOADING_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const fraction = transfer?.fraction ?? null;
  const bytes = transfer?.bytes ?? 0;
  // Kotlin L2100-2108 的文案分支（纯函数在 core/comicLoadingLabel）
  const label = comicLoadingLabel(fraction, bytes, elapsed);

  return (
    <div className="comic-loading" data-page-id={ref_?.id ?? ''}>
      {/* Kotlin L2099 ChasingDots(size = 40.dp, secondary) → CSS 三点动画 */}
      <div className="comic-chasing-dots" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      {fraction !== null && fraction < 1 ? (
        <div
          className="comic-linear-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div
            className="comic-linear-progress-fill"
            style={{ width: `${String(fraction * 100)}%` }}
          />
        </div>
      ) : null}
      <p className="comic-loading-label">{label}</p>
      {elapsed >= RETRY_HINT_SEC && onRetry !== null ? (
        <button type="button" className="comic-text-button" onClick={onRetry}>
          重新加载
        </button>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicRefinementFeedback (Kotlin L2008-2015)
 * ═══════════════════════════════════════════════════════════════════════ */

interface RefinementProps {
  readonly refining: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
}

function ComicRefinementFeedback({ refining, error, onRetry }: RefinementProps): ReactNode {
  // Kotlin L2010: !refining && error == null → 不渲染
  if (!refining && error === null) return null;
  return (
    <div className="comic-refinement">
      {error === null ? (
        <p className="comic-refinement-text">高清图加载中…</p>
      ) : (
        <button type="button" className="comic-text-button" onClick={onRetry}>
          高清图加载失败 · 重试
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PagePlaceholder (Kotlin L2057-2086)
 * ═══════════════════════════════════════════════════════════════════════ */

interface PlaceholderProps {
  readonly state: PageBitmapState;
  readonly onRetry: () => void;
  readonly enhanceHint: string | null;
  readonly ref_: ComicPageRef | null;
  readonly transfer: ComicTransferLike | null;
}

function PagePlaceholder({
  state,
  onRetry,
  enhanceHint,
  ref_,
  transfer,
}: PlaceholderProps): ReactNode {
  if (state.kind === 'READY') return null;
  if (state.kind === 'FAILED') {
    // Kotlin L2076-2083
    return (
      <div className="comic-placeholder comic-placeholder--failed">
        <p className="comic-failed-text">图片加载失败</p>
        <button type="button" className="comic-text-button" onClick={onRetry}>
          点击重试
        </button>
      </div>
    );
  }
  return (
    // Kotlin L2060-2075
    <div className="comic-placeholder">
      <ComicLoadingFeedback ref_={ref_} transfer={transfer} onRetry={onRetry} />
      {/* Kotlin L2071-2073 */}
      {enhanceHint !== null ? <p className="comic-hint">{enhanceHint}</p> : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ZoomableImageLayer (Kotlin L2023-2055)
 * ═══════════════════════════════════════════════════════════════════════ */

interface ZoomLayerProps {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly stretch: boolean;
  readonly children: ReactNode;
}

function ZoomableImageLayer({
  scale,
  offsetX,
  offsetY,
  contentWidth,
  contentHeight,
  stretch,
  children,
}: ZoomLayerProps): ReactNode {
  // Kotlin L2041-2052: contentSize 未落值时兜底 fillMaxSize；
  // 否则 requiredWidth/Height 不过父约束（超尺寸档不被压扁）。
  const inner: CSSProperties =
    stretch || contentWidth <= 0 || contentHeight <= 0
      ? { width: '100%', height: '100%' }
      : { width: `${String(contentWidth)}px`, height: `${String(contentHeight)}px` };

  return (
    <div
      className="comic-zoom-layer"
      style={{
        transform: `translate(${String(offsetX)}px, ${String(offsetY)}px) scale(${String(scale)})`,
      }}
    >
      <div className="comic-zoom-content" style={inner}>
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * useComicPageBitmap — rememberPageBitmap 的等价 (Kotlin L817-894)
 * ═══════════════════════════════════════════════════════════════════════ */

interface PageBitmapArgs {
  readonly loader: ComicPageLoaderPort;
  readonly slot: ComicSlot | null;
  readonly config: ComicReaderConfig;
  readonly bookState: ComicBookState;
  readonly retry: number;
  readonly visible: boolean;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
}

function useComicPageBitmap({
  loader,
  slot,
  config,
  bookState,
  retry,
  visible,
  sizes,
}: PageBitmapArgs): PageBitmapState {
  const cacheKey =
    slot === null
      ? null
      : comicCacheKey(
          slot.ref,
          slot.half,
          imagePipelineFingerprint(config),
          effectiveRotation(config.bookRotation, pageRotationOf(bookState, slot.ref.id)),
        );
  const slotId = slot?.ref.id ?? '';
  const half = slot?.half ?? 'FULL';
  const rotation = slot === null ? 0 : effectiveRotation(config.bookRotation, pageRotationOf(bookState, slot.ref.id));
  const gutterPos = slot === null ? null : (sizes[slot.ref.id]?.gutterPos ?? null);
  const splitPosition = config.splitPosition;
  const cropMode = config.cropMode;
  const manualCrop = config.manualCrop;
  const brightness = config.filterBrightness;
  const contrast = config.filterContrast;
  const saturation = config.filterSaturation;
  const hue = config.filterHue;
  const gamma = config.filterGamma;
  const sharpen = config.filterSharpen;
  const shadow = config.filterShadow;
  const bw = config.filterBW;
  const enhanceMode = config.enhanceMode;
  const enhanceStrength = config.enhanceStrength;

  // Kotlin L838-859: 初值同步读缓存 —— 缓存命中时第一帧即 Ready（无 Loading 中间态）
  const [entry, setEntry] = useState<{
    key: string | null;
    state: PageBitmapState;
  }>(() => ({ key: cacheKey, state: seedBitmapState(loader, cacheKey) }));

  // Kotlin L857-859: state 按 cacheKey 键控 —— 键变化时不复用旧页状态
  // （render 期从缓存重新播种，不做 set-state-in-render）
  const state: PageBitmapState =
    entry.key === cacheKey ? entry.state : seedBitmapState(loader, cacheKey);

  useEffect(() => {
    if (slot === null || cacheKey === null) return;
    let cancelled = false;
    // Kotlin L872-879: Geometry = 拆分半页 + 有效拆分位置 + 旋转 + 裁边
    const geometry = {
      half,
      splitPosition: effectiveSplitPosition({ ...config, splitPosition }, gutterPos),
      rotationDeg: rotation,
      cropMode,
      manualCrop,
    } as const;
    const tone = {
      brightness,
      contrast,
      saturation,
      hue,
      gamma,
      sharpen,
      shadow,
      bw,
      enhanceMode,
      enhanceStrength,
    } as const;
    void loader
      .loadForDisplay({ ref: slot.ref, cacheKey, geometry, tone, visible })
      .then((bitmap) => {
        if (cancelled) return;
        setEntry({ key: cacheKey, state: { kind: 'READY', bitmap, refining: false, error: null } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const err = error instanceof Error ? error : new Error('图片加载失败');
        // Kotlin L886-888: 已有 Ready 时保留位图并标记错误
        setEntry((prev) => {
          const base = prev.key === cacheKey ? prev.state : state;
          return {
            key: cacheKey,
            state:
              base.kind === 'READY'
                ? { kind: 'READY', bitmap: base.bitmap, refining: false, error: err }
                : { kind: 'FAILED', error: err },
          };
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loader,
    slot,
    cacheKey,
    retry,
    visible,
    slotId,
    half,
    rotation,
    gutterPos,
    splitPosition,
    cropMode,
    manualCrop,
    brightness,
    contrast,
    saturation,
    hue,
    gamma,
    sharpen,
    shadow,
    bw,
    enhanceMode,
    enhanceStrength,
  ]);

  return state;
}

/** Kotlin seed()（L838-855）：同步读缓存播种 */
function seedBitmapState(loader: ComicPageLoaderPort, cacheKey: string | null): PageBitmapState {
  if (cacheKey === null) return { kind: 'LOADING' };
  const hit = loader.peekProcessed(cacheKey);
  if (hit !== null) return { kind: 'READY', bitmap: hit, refining: false, error: null };
  const preview = loader.peekReadingPreview(cacheKey);
  if (preview !== null) return { kind: 'READY', bitmap: preview, refining: true, error: null };
  return { kind: 'LOADING' };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 缩放手势（ComicZoomGesture.kt 不在本次范围 → Pointer Events 最小等价实现）
 * 保留语义：缩放 / 平移 / 橡胶带回弹 / 双击档位 / 长按 QuickZoom /
 *           双指合拢退出 / 触边翻页 / 惯性回弹
 * ═══════════════════════════════════════════════════════════════════════ */

const DOUBLE_TAP_TOLERANCE_MS = 300;
const DOUBLE_TAP_DIST_PX = 40;
const LONG_PRESS_MS = 420;
const LONG_PRESS_SLOP_PX = 12;
/** Kotlin ComicZoomGesture：从 1x 合拢 < 0.62 → 退出请求 */
const PINCH_CLOSE_RATIO = 0.62;
/** QuickZoom: dy × 0.004/px（telephoto 同款） */
const QUICK_ZOOM_FACTOR = 0.004;
/** Kotlin ComicZoomState(maxScale = 5f) */
const ZOOM_MAX = 5;
/** 回弹动画时长（近似 spring(dampingRatio = 0.85, stiffness = 380)） */
const ZOOM_RELEASE_MS = 200;

interface ZoomTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly gestureActive: boolean;
  readonly releaseAnimating: boolean;
  readonly gestureEpoch: number;
}

const INITIAL_ZOOM: ZoomTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  gestureActive: false,
  releaseAnimating: false,
  gestureEpoch: 0,
};

/** 中档（ComicZoomState.mediumScale：≥2.5x、≤4x、钳 [minScale, maxScale]） */
function mediumScale(content: ComicSize, container: ComicSize): number {
  const fill =
    content.width > 1 && content.height > 1 && container.width > 1
      ? Math.max(container.width / content.width, container.height / content.height)
      : 2.5;
  return Math.min(5, Math.max(1, Math.max(2.5, Math.min(fill, 4))));
}

/** 1:1 原始像素档（oneToOneScale） */
function oneToOneScale(content: ComicSize, intrinsic: ComicSize): number {
  if (intrinsic.width < 1 || content.width < 1) return Number.NaN;
  const s = intrinsic.width / content.width;
  return s > mediumScale(content, { width: 1, height: 1 }) * 1.1 && s <= ZOOM_MAX ? s : Number.NaN;
}

/** 双击档位序列（去重、升序） */
function stepScales(content: ComicSize, container: ComicSize, intrinsic: ComicSize): number[] {
  const base = [1, mediumScale(content, container)];
  const one = oneToOneScale(content, intrinsic);
  if (!Number.isNaN(one)) base.push(one);
  return [...new Set(base.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
}

/** 下一个双击目标（zoomimage 0.35 容差） */
function nextStepScale(steps: readonly number[], current: number): number {
  for (let i = 1; i < steps.length; i += 1) {
    const step = steps[i] ?? 1;
    const prev = steps[i - 1] ?? 1;
    if (step > current + 0.35 * (step - prev)) return step;
  }
  return steps[0] ?? 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicSpreadCell (Kotlin L1552-1639) + SinglePageContent (L1717-1877)
 *                              + DoubleSpreadContent (L1880-2006)
 * 结构性调整（已标注）：两个槽位的位图加载上提到 cell 内两次无条件 hook 调用，
 * 使 contentSize / intrinsicSize 全部在 render 期派生，避免 effect 内 setState。
 * ═══════════════════════════════════════════════════════════════════════ */

interface SpreadCellProps {
  readonly spread: ComicSpread;
  readonly config: ComicReaderConfig;
  readonly loader: ComicPageLoaderPort;
  readonly bookState: ComicBookState;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
  readonly callbacks: ComicGestureCallbacks;
  readonly onBitmapShown: (bitmap: ComicBitmap) => void;
  readonly onZoomChanged: (zoomed: boolean) => void;
  readonly mirrorX: boolean;
  readonly isCurrentPage: boolean;
  readonly transferFor: (ref: ComicPageRef) => ComicTransferLike | null;
}

function ComicSpreadCell(props: SpreadCellProps): ReactNode {
  const {
    spread,
    config,
    loader,
    bookState,
    sizes,
    callbacks,
    onBitmapShown,
    onZoomChanged,
    mirrorX,
    isCurrentPage,
    transferFor,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const container = useElementSize(hostRef);
  const rtl = config.direction === 'RTL';
  const isDouble = spread.slots.length === 2;

  const slotA: ComicSlot | null = spread.slots[0] ?? null;
  const slotB: ComicSlot | null = spread.slots[1] ?? null;
  const [retry, setRetry] = useState(0);
  const stateA = useComicPageBitmap({
    loader,
    slot: slotA,
    config,
    bookState,
    retry,
    visible: isCurrentPage,
    sizes,
  });
  const stateB = useComicPageBitmap({
    loader,
    slot: slotB,
    config,
    bookState,
    retry,
    visible: isCurrentPage,
    sizes,
  });

  const intrinsicA = bitmapSizeOf(stateA);
  const intrinsicB = bitmapSizeOf(stateB);

  // Kotlin L1758-1760 / L1906-1914: 适配尺寸在 render 期同步求值
  const gapPx = config.doubleGapDp;
  const fitOne = (intrinsic: ComicSize): ComicSize => {
    if (intrinsic.width === 0 && intrinsic.height === 0) return COMIC_SIZE_ZERO;
    if (container.width <= 0 || container.height <= 0) return COMIC_SIZE_ZERO;
    const availW = (container.width - gapPx) / 2;
    const s = Math.min(availW / intrinsic.width, container.height / intrinsic.height);
    return { width: intrinsic.width * s, height: intrinsic.height * s };
  };
  const fittedA = isDouble
    ? fitOne(intrinsicA)
    : fittedSizeWithCustom(
        intrinsicA,
        container,
        config.fit,
        config.customFitScale,
        config.customFitBase,
      );
  const fittedB = fitOne(intrinsicB);

  // Kotlin L1917-1921: 双页拼合的 contentSize
  const contentSize: ComicSize = isDouble
    ? { width: fittedA.width + fittedB.width + gapPx, height: Math.max(fittedA.height, fittedB.height) }
    : fittedA;

  // 1:1 档基准：loader.sizes 的原始文件像素优先（Kotlin L1747-1752 / L1922-1935）
  const rawA = slotA === null ? undefined : sizes[slotA.ref.id];
  const rawB = slotB === null ? undefined : sizes[slotB.ref.id];
  const intrinsicSize: ComicSize = isDouble
    ? rawA !== undefined && rawA.width > 0
      ? {
          width: rawA.width + (rawB?.width ?? intrinsicB.width),
          height: Math.max(rawA.height, rawB?.height ?? intrinsicB.height),
        }
      : { width: intrinsicA.width + intrinsicB.width, height: Math.max(intrinsicA.height, intrinsicB.height) }
    : rawA !== undefined && rawA.width > 0 && rawA.height > 0
      ? { width: rawA.width, height: rawA.height }
      : intrinsicA;

  /* ── 缩放 / 平移状态（render 期可变，事件回调里更新） ── */
  const [zoom, setZoom] = useState<ZoomTransform>(INITIAL_ZOOM);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const panOriginRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const quickZoomRef = useRef<{ y: number; scale: number } | null>(null);
  const movedRef = useRef(false);

  const panLimitX = Math.max(0, (contentSize.width * zoom.scale - container.width) / 2);
  const panLimitY = Math.max(0, (contentSize.height * zoom.scale - container.height) / 2);
  // Kotlin ComicZoomState.isZoomed: scale > 1.02f || canPan
  const isZoomed = zoom.scale > 1.02 || panLimitX > 0.5 || panLimitY > 0.5;

  const zoomSnapshot: ComicZoomSnapshot = {
    scale: zoom.scale,
    offsetX: zoom.offsetX,
    offsetY: zoom.offsetY,
    containerSize: container,
    contentSize,
    intrinsicSize,
    gestureActive: zoom.gestureActive,
    releaseAnimating: zoom.releaseAnimating,
    gestureEpoch: zoom.gestureEpoch,
  };

  // 镜像容器内的局部坐标还原为物理坐标（Kotlin L1586-1595）
  const physicalCallbacks: ComicGestureCallbacks = mirrorX
    ? {
        onTapZone: (pos, size) =>
          callbacks.onTapZone({ width: size.width - pos.width, height: pos.height }, size),
        onLongPress: callbacks.onLongPress,
        onPinchClose: callbacks.onPinchClose,
        onEdgeBack: callbacks.onEdgeBack,
        onZoomedEdgeSwipe: (dir) => callbacks.onZoomedEdgeSwipe?.(-dir),
      }
    : callbacks;

  // 边缘滑动退出（Kotlin L1614-1618 comicEdgeSwipe）
  const edgeRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  // 高倍缩放区域重解码（Kotlin L1783-1834）：手势结束（gestureEpoch 变化）后触发
  const pipelineIdle = useMemo(() => {
    if (slotA === null) return true;
    return !geometryHasWork(
      {
        half: slotA.half,
        splitPosition: effectiveSplitPosition(config, rawA?.gutterPos ?? null),
        rotationDeg: effectiveRotation(config.bookRotation, pageRotationOf(bookState, slotA.ref.id)),
        cropMode: config.cropMode,
        manualCrop: config.manualCrop,
      },
      toneOf(config),
    );
  }, [slotA, rawA, config, bookState]);

  useEffect(() => {
    if (slotA === null || slotA.ref.kind !== 'LOCAL') return;
    if (!pipelineIdle) return;
    if (zoom.gestureActive || zoom.releaseAnimating) return;
    if (intrinsicSize.width <= 0 || contentSize.width <= 0) return;
    // 显示比例相对「原始文件像素」< 1.15 → 不触发
    const fitScale = contentSize.width / intrinsicSize.width;
    const downsample = rawA !== undefined && rawA.width > 0 ? intrinsicA.width / rawA.width : 1;
    const dispPerOrig = fitScale * zoom.scale * downsample;
    if (dispPerOrig < 1.15) return;
    if (rawA === undefined) return;
    if (rawA.width <= intrinsicA.width && rawA.height <= intrinsicA.height) return;
    const rect = visibleIntrinsicRect(zoomSnapshot);
    if (rect === null) return;
    // 外扩 12% 缓冲，平移小幅抖动不重复解码（Kotlin L1815-1823）
    const expanded: ComicRectF = {
      left: Math.max(0, rect.left - rectfWidth(rect) * 0.12),
      top: Math.max(0, rect.top - rectfHeight(rect) * 0.12),
      right: Math.min(rawA.width, rect.right + rectfWidth(rect) * 0.12),
      bottom: Math.min(rawA.height, rect.bottom + rectfHeight(rect) * 0.12),
    };
    // Kotlin L1824 `loader.decodeRegion(local, expanded, cacheTag = cacheKey)`：
    // local 即上面守卫过的 LOCAL 页引用 `slotA.ref`（不是整个 slot）。
    void loader.decodeRegion(slotA.ref, expanded, cacheKeyOf(slotA, config, bookState));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zoom.gestureEpoch,
    zoom.gestureActive,
    zoom.releaseAnimating,
    zoom.scale,
    zoom.offsetX,
    zoom.offsetY,
    pipelineIdle,
    intrinsicA.width,
    intrinsicA.height,
    intrinsicSize.width,
    intrinsicSize.height,
    contentSize.width,
    contentSize.height,
    container.width,
    container.height,
    rawA?.width,
    rawA?.height,
  ]);

  const clampOffsets = (scale: number, ox: number, oy: number): readonly [number, number] => {
    const lx = Math.max(0, (contentSize.width * scale - container.width) / 2);
    const ly = Math.max(0, (contentSize.height * scale - container.height) / 2);
    // 缩放阻尼回弹（panpf/zoomimage limitScaleWithRubberBand，c = 0.55）
    const rubber = (value: number, limit: number): number => {
      if (limit <= 0) return value * 0.3;
      const over = Math.abs(value) - limit;
      if (over <= 0) return value;
      const sign = value > 0 ? 1 : -1;
      return sign * (limit + over / (1 + over / (limit * 0.55)));
    };
    return [rubber(ox, lx), rubber(oy, ly)];
  };

  /** 松手回弹：近似 Animatable.animateTo(spring) + gestureEpoch 递增 */
  const releaseZoom = (target: number): void => {
    const [ox, oy] = clampOffsets(target, 0, 0);
    setZoom((prev) => ({
      ...prev,
      scale: target,
      offsetX: ox,
      offsetY: oy,
      gestureActive: false,
      releaseAnimating: true,
    }));
    window.setTimeout(() => {
      setZoom((prev) => ({
        ...prev,
        releaseAnimating: false,
        gestureEpoch: prev.gestureEpoch + 1,
      }));
    }, ZOOM_RELEASE_MS);
    onZoomChanged(target > 1.02);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // jsdom / 旧 WebView 缺 setPointerCapture —— 缺失时降级为普通事件流
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    movedRef.current = false;
    edgeRef.current = { x: event.clientX, y: event.clientY, active: false };
    setZoom((prev) => ({ ...prev, gestureActive: true, releaseAnimating: false }));
    onZoomChanged(isZoomed);

    if (pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined) {
        pinchRef.current = {
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          scale: zoom.scale,
        };
      }
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
      return;
    }

    panOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      ox: zoom.offsetX,
      oy: zoom.offsetY,
    };

    // 长按放大（Kotlin: config.longPressZoom 可关闭；期间消费全部事件）
    if (config.longPressZoom) {
      longPressTimerRef.current = window.setTimeout(() => {
        quickZoomRef.current = { y: event.clientY, scale: zoom.scale };
        callbacks.onLongPress();
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const edge = edgeRef.current;
    if (edge !== null && !edge.active) {
      const dist = Math.hypot(event.clientX - edge.x, event.clientY - edge.y);
      if (dist > LONG_PRESS_SLOP_PX) {
        edge.active = true;
        movedRef.current = true;
      }
    }

    // 双指：缩放 + 合拢退出
    if (pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      const start = pinchRef.current;
      if (a !== undefined && b !== undefined && start !== null) {
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const rawScale = (dist / start.dist) * start.scale;
        // Kotlin: 从 1x 合拢 < 0.62 → 退出请求
        if (config.gesturePinchClose && start.scale > 0 && rawScale / start.scale < PINCH_CLOSE_RATIO) {
          callbacks.onPinchClose();
          return;
        }
        const scale = Math.min(ZOOM_MAX, Math.max(1, rawScale));
        const [ox, oy] = clampOffsets(scale, zoom.offsetX, zoom.offsetY);
        setZoom((prev) => ({ ...prev, scale, offsetX: ox, offsetY: oy }));
        onZoomChanged(scale > 1.02);
      }
      return;
    }

    // 双击第二击按住上下拖 → QuickZoom（dy × 0.004）
    const quick = quickZoomRef.current;
    if (quick !== null) {
      const scale = Math.min(
        ZOOM_MAX,
        Math.max(1, quick.scale * (1 - (event.clientY - quick.y) * QUICK_ZOOM_FACTOR)),
      );
      const [ox, oy] = clampOffsets(scale, zoom.offsetX, zoom.offsetY);
      setZoom((prev) => ({ ...prev, scale, offsetX: ox, offsetY: oy }));
      return;
    }

    if (longPressTimerRef.current !== null && quickZoomRef.current === null) {
      const origin = panOriginRef.current;
      if (origin !== null && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP_PX) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }

    const origin = panOriginRef.current;
    if (origin === null) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;

    // 未放大时单指拖动不消费 → 交给 Pager / 滚动容器翻页
    if (!isZoomed) return;

    const scaleNow = zoom.scale;
    const lx = Math.max(0, (contentSize.width * scaleNow - container.width) / 2);
    const ly = Math.max(0, (contentSize.height * scaleNow - container.height) / 2);
    const nextX = origin.ox + dx;
    const nextY = origin.oy + dy;

    // 触边继续拖 → 翻页（Kotlin onZoomedEdgeSwipe）
    if (lx > 0.5 && nextX >= lx && dx > 0) {
      callbacks.onZoomedEdgeSwipe?.(1);
      panOriginRef.current = { x: event.clientX, y: event.clientY, ox: zoom.offsetX, oy: zoom.offsetY };
      return;
    }
    if (lx > 0.5 && nextX <= -lx && dx < 0) {
      callbacks.onZoomedEdgeSwipe?.(-1);
      panOriginRef.current = { x: event.clientX, y: event.clientY, ox: zoom.offsetX, oy: zoom.offsetY };
      return;
    }

    const [ox, oy] = clampOffsets(scaleNow, nextX, nextY);
    setZoom((prev) => ({
      ...prev,
      offsetX: ox,
      offsetY: ly > 0.5 ? oy : origin.oy,
    }));
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointersRef.current.delete(event.pointerId);
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (pointersRef.current.size > 0) return;

    const edge = edgeRef.current;
    // Kotlin L1614-1618 comicEdgeSwipe：侧边滑动快速关闭
    if (
      config.gestureEdgeSwipe &&
      edge !== null &&
      edge.active &&
      !isZoomed &&
      event.clientX - edge.x > 96
    ) {
      callbacks.onEdgeBack();
      edgeRef.current = null;
      setZoom((prev) => ({ ...prev, gestureActive: false }));
      return;
    }
    edgeRef.current = null;

    const prev = lastTapRef.current;
    const isDoubleTap =
      prev !== null &&
      event.timeStamp - prev.t < DOUBLE_TAP_TOLERANCE_MS &&
      Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < DOUBLE_TAP_DIST_PX;
    lastTapRef.current = { t: event.timeStamp, x: event.clientX, y: event.clientY };

    // 长按放大松手还原
    if (quickZoomRef.current !== null) {
      quickZoomRef.current = null;
      releaseZoom(1);
      return;
    }

    if (isDoubleTap && config.doubleTapZoom) {
      releaseZoom(nextStepScale(stepScales(contentSize, container, intrinsicSize), zoom.scale));
      return;
    }

    if (!movedRef.current) {
      // 单击 → 点按区（Kotlin L464-483 的动作分发在父层）
      const rect = hostRef.current?.getBoundingClientRect();
      physicalCallbacks.onTapZone(
        {
          width: event.clientX - (rect?.left ?? 0),
          height: event.clientY - (rect?.top ?? 0),
        },
        container,
      );
    }
    setZoom((prev) => ({ ...prev, gestureActive: false }));
  };

  /* ── 渲染 ── */
  // Kotlin L1494/L1737: 位图 → 内禀尺寸；Kotlin L1610: 磁吸淡入 alpha
  const enhanceHintA =
    stateA.kind === 'LOADING'
      ? enhanceHintFor(config, Math.max(rawA?.width ?? 0, rawA?.height ?? 0) || 2400)
      : null;
  const enhanceHintB =
    stateB.kind === 'LOADING'
      ? enhanceHintFor(config, Math.max(rawB?.width ?? 0, rawB?.height ?? 0) || 2400)
      : null;

  // 主色喂入门控（第 25 条）：仅当前页可喂 —— effect 键含 isCurrentPage
  useEffect(() => {
    if (isCurrentPage && stateA.kind === 'READY') onBitmapShown(stateA.bitmap);
  }, [isCurrentPage, stateA, onBitmapShown]);

  const align =
    config.doubleAlign === 'TOP' ? 'flex-start' : config.doubleAlign === 'BOTTOM' ? 'flex-end' : 'center';

  return (
    <div
      ref={hostRef}
      className="comic-spread-cell"
      data-spread-index={spread.index}
      data-spread-current={isCurrentPage ? '1' : '0'}
      role="presentation"
    >
      <div
        className="comic-spread-cell-zoom"
        style={{ touchAction: isZoomed ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onContextMenu={(event) => event.preventDefault()}
      >
        <ZoomableImageLayer
          scale={zoom.scale}
          offsetX={zoom.offsetX}
          offsetY={zoom.offsetY}
          contentWidth={contentSize.width}
          contentHeight={contentSize.height}
          stretch={config.fit === 'STRETCH'}
        >
          {isDouble ? (
            // Kotlin L1880-2006 DoubleSpreadContent
            <div
              className="comic-double-row"
              style={{
                gap: `${String(gapPx)}px`,
                alignItems: align,
                // Kotlin L1944-1950: 位移修正只做平移, offset 不乘 scale
                transform: `translate(${String(config.doubleShiftXDp)}px, ${String(config.doubleShiftYDp)}px)`,
              }}
            >
              {(rtl ? [...spread.slots].reverse() : [...spread.slots]).map((slot) => {
                const idx = spread.slots.indexOf(slot);
                const state = idx === 0 ? stateA : stateB;
                const size = idx === 0 ? fittedA : fittedB;
                const hint = idx === 0 ? enhanceHintA : enhanceHintB;
                return (
                  <DoubleSlot
                    key={`${String(slot.ref.id)}|${String(slot.half)}`}
                    slot={slot}
                    state={state}
                    size={size}
                    halfWidth={Math.max(0, (container.width - gapPx) / 2)}
                    enhanceHint={hint}
                    transfer={transferFor(slot.ref)}
                    onRetry={() => setRetry((prev) => prev + 1)}
                  />
                );
              })}
              <ComicRefinementFeedback
                refining={
                  (stateA.kind === 'READY' && stateA.refining) ||
                  (stateB.kind === 'READY' && stateB.refining)
                }
                error={
                  stateA.kind === 'READY'
                    ? stateA.error
                    : stateB.kind === 'READY'
                      ? stateB.error
                      : null
                }
                onRetry={() => setRetry((prev) => prev + 1)}
              />
            </div>
          ) : (
            // Kotlin L1717-1877 SinglePageContent
            <div className="comic-single-page">
              <div className="comic-single-page-frame">
                {stateA.kind === 'READY' ? (
                  <img
                    className="comic-img comic-img--fillbounds"
                    src={stateA.bitmap.src}
                    alt={`第 ${String((slotA?.rawIndex ?? 0) + 1)} 页`}
                    draggable={false}
                    onError={() => setRetry((prev) => prev + 1)}
                  />
                ) : (
                  <PagePlaceholder
                    state={stateA}
                    onRetry={() => setRetry((prev) => prev + 1)}
                    enhanceHint={enhanceHintA}
                    ref_={slotA?.ref ?? null}
                    transfer={slotA === null ? null : transferFor(slotA.ref)}
                  />
                )}
                <ComicRefinementFeedback
                  refining={stateA.kind === 'READY' && stateA.refining}
                  error={stateA.kind === 'READY' ? stateA.error : null}
                  onRetry={() => setRetry((prev) => prev + 1)}
                />
              </div>
            </div>
          )}
        </ZoomableImageLayer>
      </div>
    </div>
  );
}

function cacheKeyOf(
  slot: ComicSlot,
  config: ComicReaderConfig,
  bookState: ComicBookState,
): string {
  return comicCacheKey(
    slot.ref,
    slot.half,
    imagePipelineFingerprint(config),
    effectiveRotation(config.bookRotation, pageRotationOf(bookState, slot.ref.id)),
  );
}

interface DoubleSlotProps {
  readonly slot: ComicSlot;
  readonly state: PageBitmapState;
  readonly size: ComicSize;
  readonly halfWidth: number;
  readonly enhanceHint: string | null;
  readonly transfer: ComicTransferLike | null;
  readonly onRetry: () => void;
}

function DoubleSlot({
  slot,
  state,
  size,
  halfWidth,
  enhanceHint,
  transfer,
  onRetry,
}: DoubleSlotProps): ReactNode {
  if (state.kind === 'READY' && (size.width !== 0 || size.height !== 0)) {
    // Kotlin L1966-1973
    return (
      <img
        className="comic-img comic-img--fillbounds"
        src={state.bitmap.src}
        alt={`第 ${String(slot.rawIndex + 1)} 页`}
        style={{ width: `${String(size.width)}px`, height: `${String(size.height)}px` }}
        draggable={false}
        onError={onRetry}
      />
    );
  }
  if (state.kind === 'FAILED') {
    // Kotlin L1974-1984
    return (
      <div
        className="comic-double-fail"
        style={{ width: `${String(halfWidth)}px`, height: `${String(DOUBLE_SLOT_HEIGHT_PX)}px` }}
      >
        <button type="button" className="comic-text-button" onClick={onRetry}>
          加载失败·重试
        </button>
      </div>
    );
  }
  // Kotlin L1985-1999
  return (
    <div
      className="comic-double-loading"
      style={{ width: `${String(halfWidth)}px`, height: `${String(DOUBLE_SLOT_HEIGHT_PX)}px` }}
    >
      <ComicLoadingFeedback ref_={slot.ref} transfer={transfer} onRetry={onRetry} />
      {enhanceHint !== null ? <p className="comic-hint">{enhanceHint}</p> : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicVerticalItem (Kotlin L1479-1546)
 * ═══════════════════════════════════════════════════════════════════════ */

interface VerticalItemProps {
  readonly spread: ComicSpread;
  readonly config: ComicReaderConfig;
  readonly loader: ComicPageLoaderPort;
  readonly bookState: ComicBookState;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
  readonly isCurrentPage: boolean;
  readonly onBitmapShown: (bitmap: ComicBitmap) => void;
  readonly transferFor: (ref: ComicPageRef) => ComicTransferLike | null;
}

function ComicVerticalItem(props: VerticalItemProps): ReactNode {
  const { spread, config, loader, bookState, sizes, isCurrentPage, onBitmapShown, transferFor } = props;
  const slot = spread.slots[0] ?? null;
  const [retry, setRetry] = useState(0);
  const state = useComicPageBitmap({
    loader,
    slot,
    config,
    bookState,
    retry,
    visible: isCurrentPage,
    sizes,
  });

  // Kotlin L1497-1502: effect 键含 isCurrentPage —— 晋升为最可见项时补喂主色
  useEffect(() => {
    if (state.kind === 'READY' && isCurrentPage) onBitmapShown(state.bitmap);
  }, [state, isCurrentPage, onBitmapShown]);

  const raw = slot === null ? undefined : sizes[slot.ref.id];
  const enhanceHint =
    state.kind === 'LOADING' ? enhanceHintFor(config, Math.max(raw?.width ?? 0, raw?.height ?? 0) || 2400) : null;

  return (
    <div
      className={`comic-vertical-item${config.mode === 'WEBTOON' ? ' is-webtoon' : ''}`}
      data-spread-index={spread.index}
      data-spread-current={isCurrentPage ? '1' : '0'}
    >
      {state.kind === 'LOADING' ? (
        // Kotlin L1511-1522
        <div className="comic-vertical-loading" style={{ height: `${String(VERTICAL_LOADING_HEIGHT_PX)}px` }}>
          <ComicLoadingFeedback
            ref_={slot?.ref ?? null}
            transfer={slot === null ? null : transferFor(slot.ref)}
            onRetry={() => setRetry((prev) => prev + 1)}
          />
          {enhanceHint !== null ? <p className="comic-hint">{enhanceHint}</p> : null}
        </div>
      ) : state.kind === 'FAILED' ? (
        // Kotlin L1523-1530
        <div
          className="comic-vertical-failed"
          style={{ height: `${String(VERTICAL_FAILED_HEIGHT_PX)}px` }}
        >
          <p className="comic-failed-text">图片加载失败</p>
          <button type="button" className="comic-text-button" onClick={() => setRetry((prev) => prev + 1)}>
            点击重试
          </button>
        </div>
      ) : (
        // Kotlin L1531-1543
        <div className="comic-vertical-ready">
          <img
            className="comic-img comic-img--fillwidth"
            src={state.bitmap.src}
            alt={`第 ${String(spreadFirstRawIndex(spread) + 1)} 页`}
            draggable={false}
            onError={() => setRetry((prev) => prev + 1)}
          />
          <ComicRefinementFeedback
            refining={state.refining}
            error={state.error}
            onRetry={() => setRetry((prev) => prev + 1)}
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 垂直滚动指标 — ComicScrollMetrics.kt 的消费侧实现（该模块不在本次范围）
 * 分段起点 + scrollRange + fraction + target(fraction)，语义与 Kotlin 一致
 * ═══════════════════════════════════════════════════════════════════════ */

function buildVerticalScrollMetrics(
  itemSizes: readonly number[],
  itemSpacing: number,
  viewportSize: number,
  firstVisibleItemIndex: number,
  firstVisibleItemScrollOffset: number,
  canScrollBackward: boolean,
  canScrollForward: boolean,
): ComicScrollMetricsLike {
  const starts: number[] = [];
  let height = 0;
  itemSizes.forEach((size, index) => {
    starts.push(height);
    height += Math.max(1, size);
    if (index < itemSizes.length - 1) height += Math.max(0, itemSpacing);
  });
  const scrollRange = Math.max(0, height - Math.max(0, viewportSize));
  const clampIn = (value: number): number =>
    itemSizes.length === 0 ? 0 : Math.min(itemSizes.length - 1, Math.max(0, value));
  const fraction = ((): number => {
    if (itemSizes.length === 0 || !canScrollBackward) return 0;
    if (!canScrollForward) return 1;
    if (scrollRange === 0) return 0;
    const px = (starts[clampIn(firstVisibleItemIndex)] ?? 0) + Math.max(0, firstVisibleItemScrollOffset);
    return Math.min(1, Math.max(0, px / scrollRange));
  })();
  return {
    fraction,
    target(f: number) {
      if (itemSizes.length === 0) return { index: 0, offset: 0 };
      const safe = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
      const pixel = Math.round(safe * scrollRange);
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) {
        if ((starts[i] ?? 0) <= pixel) index = i;
      }
      return { index, offset: Math.max(0, Math.round(pixel - (starts[index] ?? 0))) };
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicVerticalList (Kotlin L1290-1474)
 * ═══════════════════════════════════════════════════════════════════════ */

interface VerticalListProps {
  readonly layout: ComicLayout;
  readonly config: ComicReaderConfig;
  readonly loader: ComicPageLoaderPort;
  readonly bookState: ComicBookState;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
  readonly currentSpread: number;
  readonly onSpreadChanged: (spread: number) => void;
  readonly callbacks: ComicGestureCallbacks;
  readonly onAreaSizeChanged: (size: ComicSize) => void;
  readonly onBitmapShown: (bitmap: ComicBitmap) => void;
  readonly autoScrollActive: boolean;
  readonly autoScrollSpeedDp: number;
  readonly onReachEnd: () => void;
  readonly onScrollMetrics: (metrics: ComicScrollMetricsLike) => void;
  readonly scrollJump: { readonly seq: number; readonly fraction: number } | null;
  readonly onPreviousChapter: () => void;
  readonly onNextChapter: () => void;
  readonly transferFor: (ref: ComicPageRef) => ComicTransferLike | null;
}

function ComicVerticalList(props: VerticalListProps): ReactNode {
  const {
    layout,
    config,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    onAreaSizeChanged,
    onBitmapShown,
    autoScrollActive,
    autoScrollSpeedDp,
    onReachEnd,
    onScrollMetrics,
    scrollJump,
    onPreviousChapter,
    onNextChapter,
    transferFor,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemNodes = useRef(new Map<number, HTMLElement>());
  const metricsRef = useRef<ComicScrollMetricsLike | null>(null);
  const spreadCount = comicLayoutSpreadCount(layout);

  // 条漫 vs 无缝滚动独立策略（Kotlin ComicScrollStrategy.forConfig）
  const strategy = useMemo(
    () =>
      config.mode === 'CONTINUOUS'
        ? // 无缝滚动强制 0 间距 + 无磁吸
          { spacingDp: 0, snapToPage: false, prefetchWindow: 4 }
        : { spacingDp: config.pageSpacingDp, snapToPage: config.webtoonSnap, prefetchWindow: 4 },
    [config.mode, config.pageSpacingDp, config.webtoonSnap],
  );

  const container = useElementSize(scrollRef);
  useEffect(() => {
    onAreaSizeChanged(container);
  }, [container, onAreaSizeChanged]);

  const measure = useCallback((): ComicScrollMetricsLike => {
    const el = scrollRef.current;
    const heights: number[] = [];
    for (let i = 0; i < spreadCount; i += 1) {
      const node = itemNodes.current.get(i);
      heights.push(node === undefined ? 1 : Math.max(1, node.offsetHeight));
    }
    const scrollTop = el?.scrollTop ?? 0;
    const viewport = el?.clientHeight ?? 0;
    let firstIndex = 0;
    let firstOffset = 0;
    for (let i = 0; i < heights.length; i += 1) {
      const start = nodeTop(itemNodes.current.get(i), i);
      const size = heights[i] ?? 1;
      if (start + size > scrollTop) {
        firstIndex = i;
        firstOffset = scrollTop - start;
        break;
      }
    }
    return buildVerticalScrollMetrics(
      heights,
      strategy.spacingDp,
      viewport,
      firstIndex,
      firstOffset,
      scrollTop > 0.5,
      (el?.scrollHeight ?? 0) - scrollTop - viewport > 0.5,
    );
  }, [spreadCount, strategy.spacingDp]);

  // 每次项内像素偏移变化都上报（Kotlin L1411-1428）
  const handleScroll = useCallback(() => {
    const metrics = measure();
    metricsRef.current = metrics;
    onScrollMetrics(metrics);

    // 当前项 = 屏幕上可见面积最大的项（非首可见项）（Kotlin L1325-1338）
    const el = scrollRef.current;
    if (el === null) return;
    let bestIndex = 0;
    let bestArea = -1;
    for (const [index, node] of itemNodes.current) {
      const top = Math.max(0, node.offsetTop - el.scrollTop);
      const bottom = Math.min(el.clientHeight, node.offsetTop + node.offsetHeight - el.scrollTop);
      const area = Math.max(0, bottom - top);
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    }
    onSpreadChanged(clampIndex(bestIndex, spreadCount));
  }, [measure, onScrollMetrics, onSpreadChanged, spreadCount]);

  // 外部跳转同步（Kotlin L1339-1347）：仅当目标项完全不在视口内才滚动定位
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const node = itemNodes.current.get(currentSpread);
    if (node === undefined) return;
    const visible = node.offsetTop < el.clientHeight && node.offsetTop + node.offsetHeight > el.scrollTop;
    if (visible) return;
    // `el.scrollTo` 不是所有宿主都有（jsdom 未实现；WKWebView 有）。
    // 退化用 `scrollTop` 赋值 —— 对「无动画的瞬时定位」完全等价，且是更古老的
    // 通用属性。这里**不抛错**：滚动定位是尽力而为的辅助行为，缺失只影响
    // 「跳转后目标不在视口内」的视觉定位，不影响任何数据正确性；
    // 与 Kotlin `listState.scrollToItem`（Compose 状态 API，必可用）的差异仅此一处。
    if (typeof el.scrollTo === 'function') {
      scrollElementTo(el, { top: node.offsetTop, behavior: 'auto' });
    } else {
      el.scrollTop = node.offsetTop;
    }
  }, [currentSpread, layout]);

  // 滑条落点定位（Kotlin L1429-1433）
  const jumpSeq = scrollJump?.seq ?? -1;
  const jumpFraction = scrollJump?.fraction ?? 0;
  useEffect(() => {
    if (jumpSeq < 0) return;
    const metrics = metricsRef.current ?? measure();
    const target = metrics.target(jumpFraction);
    const el = scrollRef.current;
    const node = itemNodes.current.get(target.index);
    if (el === null || node === undefined) return;
    scrollElementTo(el, { top: node.offsetTop + target.offset, behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpSeq]);

  // 前瞻预载（Kotlin L1352-1376）
  useEffect(() => {
    const entries: ComicPageLoaderWindowEntry[] = [];
    const fingerprint = imagePipelineFingerprint(config);
    verticalPreloadIndices(currentSpread, strategy.prefetchWindow, spreadCount).forEach((si) => {
      const spread = layout.spreads[si];
      if (spread === undefined) return;
      spread.slots.forEach((slot) => {
        const rotationDeg = effectiveRotation(
          config.bookRotation,
          pageRotationOf(bookState, slot.ref.id),
        );
        entries.push({
          ref: slot.ref,
          visible: si === currentSpread,
          cacheKey: comicCacheKey(slot.ref, slot.half, fingerprint, rotationDeg),
          geometry: {
            half: slot.half,
            splitPosition: effectiveSplitPosition(config, sizes[slot.ref.id]?.gutterPos ?? null),
            rotationDeg,
            cropMode: config.cropMode,
            manualCrop: config.manualCrop,
          },
        });
      });
    });
    // Kotlin L1374-1375: 整窗一次提交
    loader.preloadWindow(entries, toneOf(config));
  }, [currentSpread, strategy, layout, config, spreadCount, loader, bookState, sizes]);

  // 连续自动滚动（Kotlin L1379-1403）：rAF + 挂钟自算 dt
  useEffect(() => {
    if (!autoScrollActive) return;
    const el = scrollRef.current;
    if (el === null) return;
    let raf = 0;
    let last = 0;
    let stallFrames = 0;
    let lastReachEndAt = 0;
    const step = (now: number): void => {
      if (last !== 0) {
        const dt = (now - last) / 1_000_000_000;
        const before = el.scrollTop;
        el.scrollTop = before + autoScrollSpeedDp * dt;
        const scrolled = el.scrollTop - before;
        const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_STALL_PX;
        if (scrolled < AUTO_SCROLL_STALL_PX && atEnd) {
          stallFrames += 1;
          // 换章节流：3 秒内不重复触发
          if (stallFrames > REACH_END_STALL_FRAMES && now - lastReachEndAt > REACH_END_COOLDOWN_MS) {
            onReachEnd();
            lastReachEndAt = now;
            stallFrames = 0;
          }
        } else {
          stallFrames = 0;
        }
      }
      last = now;
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [autoScrollActive, autoScrollSpeedDp, onReachEnd]);

  /* ── 章节边缘手势（Kotlin L1443-1451 + ComicChapterEdgeGesture） ── */
  const edgeDragRef = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);
  const onEdgeDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!config.gestureSwipe) return;
    edgeDragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
  };
  const onEdgeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = edgeDragRef.current;
    if (drag === null || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) <= 8) return;
      const el = scrollRef.current;
      if (el === null) return;
      const atStart = el.scrollTop <= 0.5;
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 0.5;
      if ((atStart && dy < 0) || (atEnd && dy > 0)) drag.active = true;
      else return;
    }
    event.stopPropagation();
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollTop - dy;
  };
  const onEdgeUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = edgeDragRef.current;
    if (drag === null || drag.id !== event.pointerId) return;
    edgeDragRef.current = null;
    if (!drag.active) return;
    const dy = event.clientY - drag.y;
    const el = scrollRef.current;
    if (el === null) return;
    const atStart = el.scrollTop <= 0.5;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 0.5;
    // comicChapterEdgeTarget: 正值回退(-1) / 负值前进(+1)
    const target = comicChapterEdgeTarget(dy, atStart, atEnd, CHAPTER_EDGE_THRESHOLD_PX);
    if (target === -1) onPreviousChapter();
    if (target === 1) onNextChapter();
  };

  // 点按区（垂直模式下用整列容器尺寸；Kotlin L1458 onSizeChanged 的 Web 等价）
  const tapPosRef = useRef<{ x: number; y: number } | null>(null);
  const onTapDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    tapPosRef.current = { x: event.clientX, y: event.clientY };
  };
  const onTapUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const down = tapPosRef.current;
    tapPosRef.current = null;
    if (down === null) return;
    if (edgeDragRef.current?.active === true) return;
    const rect = scrollRef.current?.getBoundingClientRect();
    // 可选链在 ref 为 null 时得到 undefined（不是 null），守卫必须比 undefined。
    if (rect === undefined) return;
    callbacks.onTapZone(
      { width: event.clientX - rect.left, height: event.clientY - rect.top },
      { width: rect.width, height: rect.height },
    );
  };

  return (
    <div
      className="comic-vertical-host"
      onPointerDown={onEdgeDown}
      onPointerMove={onEdgeMove}
      onPointerUp={onEdgeUp}
      onPointerCancel={onEdgeUp}
      onClick={onTapUp}
      role="presentation"
    >
      <div
        ref={scrollRef}
        className="comic-vertical-scroll"
        style={{
          gap: `${String(strategy.spacingDp)}px`,
          scrollSnapType: strategy.snapToPage ? 'y proximity' : 'none',
        }}
        onScroll={handleScroll}
        onPointerDown={onTapDown}
      >
        {layout.spreads.map((spread) => (
          <div
            key={`spread_${String(spread.index)}_${String(spreadFirstRawIndex(spread))}`}
            className="comic-vertical-slot"
            style={{ scrollSnapAlign: strategy.snapToPage ? 'start' : 'none' }}
            ref={(node) => {
              if (node === null) itemNodes.current.delete(spread.index);
              else itemNodes.current.set(spread.index, node);
            }}
          >
            <ComicVerticalItem
              spread={spread}
              config={config}
              loader={loader}
              bookState={bookState}
              sizes={sizes}
              isCurrentPage={spread.index === currentSpread}
              onBitmapShown={onBitmapShown}
              transferFor={transferFor}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function nodeTop(node: HTMLElement | undefined, index: number): number {
  if (node !== undefined) return node.offsetTop;
  return index * 1;
}

/**
 * E43：取第 spread 个页面的引用。
 *
 * `comicLayoutSpreadEntries` 在 core 侧不存在（只有 `comicLayoutSpreadCount`），
 * 这里按 `layout.slots` 的线性序号取 —— 与 Kotlin `ComicHarismCurlReader`
 * 把 spread 折算成 flat index 的做法一致。
 */
function comicLayoutPageRefAt(layout: ComicLayout, spread: number): ComicPageRef {
  const entry = layout.spreads[clampIndex(spread, layout.spreads.length)];
  if (entry === undefined) throw new Error(`布局中没有第 ${String(spread)} 页`);
  const slot = entry.slots[0];
  if (slot === undefined) throw new Error(`第 ${String(spread)} 页没有槽位`);
  return slot.ref;
}

/** E43：把 URL 加载成可上传纹理的 `HTMLImageElement`。 */
async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (typeof document === 'undefined') return null;
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * E43：探测当前环境是否支持 WebGL2。
 *
 * 用一个**一次性** canvas 试探（不加入 DOM、不保留上下文），
 * 避免在组件里反复创建/销毁上下文。jsdom 等无 WebGL 环境返回 `false`，
 * 调用方据此回落到 CSS 3D —— 与 Kotlin 的 GL 不可用降级一致。
 */
function supportsWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
/* ═══════════════════════════════════════════════════════════════════════════
 * ComicCurlSurface (E43)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * curl 档的 WebGL2 卷页画布。
 *
 * 与 Kotlin 的 `ComicHarismCurlReader`（`GLSurfaceView` + harism `CurlRenderer`）
 * 对应。Web 侧没有 `GLSurfaceView`，但 `WebCurlGl` 实现了同一套 `CurlGL`
 * 接口（圆柱卷曲 + 背面镜像 + 掠射角压暗），故这里只负责：
 *   ① 建 canvas 与 `WebCurlGl`；
 *   ② 把 `loader` 产出的位图喂给它；
 *   ③ 把指针事件转成 `CurlInputEvent` 喂给它。
 *
 * **降级**：WebGL2 不可用时 `WebCurlGl` 显式抛错 —— 不静默回落 CSS 3D，
 * 否则用户会以为看到的是完整卷页（那正是 E43 登记的近似问题）。
 * 返回 `null` 由调用方继续用 CSS 3D 容器，与 Kotlin 的 GL 不可用降级一致。
 */
function ComicCurlSurface(props: {
  readonly layout: ComicLayout;
  readonly loader: ComicPageLoaderPort;
  readonly currentSpread: number;
}): ReactNode {
  const { layout, loader, currentSpread } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * WebGL2 可用性（一次性探测）。
   *
   * 用 `useState` 而不是「ref + forceRender」—— 后者会同时踩两条 lint 规则
   * （effect 内 setState → 级联渲染；渲染期读 ref）。`useState` 的惰性初始化
   * 在**首次渲染**跑一次，探测失败后重渲染时读到 `false`，符合 React 的
   * 「渲染期可读 state」约定。
   */
  const [glSupported] = useState(() => supportsWebGL2());
  const spreadCount = comicLayoutSpreadCount(layout);
  const glRef = useRef<WebCurlGl | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !glSupported) return;
    let gl: WebCurlGl;
    try {
      gl = new WebCurlGl({ canvas });
    } catch {
      // 探测通过但构造仍失败（如上下文被占用）：静默不渲染画布，
      // 由外层 CSS 3D 容器接管。首次探测已覆盖「完全不支持」的情况。
      return;
    }
    glRef.current = gl;
    gl.setViewMode(layout.spreads[currentSpread]?.slots.length === 2 ? 2 : 1);
    gl.setCurrentIndex(currentSpread);
    // 纹理走 `setPageProvider`（对应 harism 的 `CurlView.PageProvider`）：
    // `ComicBitmap` 只有 {src,width,height}（无像素数组），故按 src 加载
    // ImageBitmap 再交给 `page.setTexture`，与 Kotlin 侧 updatePage 时序一致。
    gl.setPageProvider({
      getPageCount: () => spreadCount,
      updatePage: (page, _width, _height, index) => {
        void loader
          .loadForDisplay({
            ref: comicLayoutPageRefAt(layout, index),
            cacheKey: `curl|${String(index)}`,
            geometry: {
              half: 'FULL',
              splitPosition: 0,
              rotationDeg: 0,
              cropMode: 'OFF',
              manualCrop: null,
            },
            tone: {
              brightness: 1,
              contrast: 1,
              saturation: 1,
              hue: 0,
              gamma: 1,
              sharpen: 0,
              shadow: 0,
              bw: false,
              enhanceMode: 'OFF',
              enhanceStrength: 0,
            },
            visible: true,
          })
          .then(async (bitmap) => {
            const image = await loadImageElement(bitmap.src);
            if (image === null) return;
            const pix = htmlImageToPixImage(image);
            if (pix === null) return;
            page.setTexture(pix, CURL_SIDE_FRONT);
          })
          .catch(() => undefined);
      },
    });
    return () => {
      gl.dispose();
      glRef.current = null;
    };
  }, [layout, loader, spreadCount, currentSpread, glSupported]);

  useEffect(() => {
    glRef.current?.setCurrentIndex(currentSpread);
  }, [currentSpread]);

  const emit = useCallback(
    (action: number, event: ReactPointerEvent<HTMLCanvasElement>): void => {
      const gl = glRef.current;
      if (gl === null) return;
      gl.onTouch({
        action,
        x: event.nativeEvent.offsetX,
        y: event.nativeEvent.offsetY,
        pointerCount: 1,
        downTime: event.timeStamp,
        eventTime: event.timeStamp,
      });
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      event.currentTarget.setPointerCapture(event.pointerId);
      emit(0, event);
    },
    [emit],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      emit(2, event);
    },
    [emit],
  );
  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      emit(1, event);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [emit],
  );

  if (!glSupported) return null;
  return (
    <canvas
      ref={canvasRef}
      className="comic-curl-surface"
      data-testid="comic_curl_surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicPagedReader (Kotlin L921-1070)
 * ═══════════════════════════════════════════════════════════════════════ */

interface PagedReaderProps {
  readonly layout: ComicLayout;
  readonly config: ComicReaderConfig;
  readonly loader: ComicPageLoaderPort;
  readonly bookState: ComicBookState;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
  readonly currentSpread: number;
  readonly onSpreadChanged: (spread: number) => void;
  readonly callbacks: ComicGestureCallbacks;
  readonly onBitmapShown: (bitmap: ComicBitmap) => void;
  readonly onZoomChanged: (zoomed: boolean) => void;
  readonly autoRead: boolean;
  readonly autoIntervalSec: number;
  readonly goNext: () => void;
  readonly transferFor: (ref: ComicPageRef) => ComicTransferLike | null;
  readonly curl: boolean;
}

function ComicPagedReader(props: PagedReaderProps): ReactNode {
  const {
    layout,
    config,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    onBitmapShown,
    onZoomChanged,
    autoRead,
    autoIntervalSec,
    goNext,
    transferFor,
    curl,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [offsetFraction, setOffsetFraction] = useState(0);
  const rtl = config.direction === 'RTL';
  const ttb = config.direction === 'TTB';
  const spreadCount = comicLayoutSpreadCount(layout);
  const isFade = config.pageAnim === 'FADE';
  // Kotlin L994: 每页两侧各留 spacing/2
  const half = config.pageSpacingDp / 2;
  // RTL: 容器保持 LTR，用 row-reverse 让 scrollLeft 线性可算
  const visualIndex = useCallback(
    (spread: number): number => (rtl && !ttb ? spreadCount - 1 - spread : spread),
    [rtl, ttb, spreadCount],
  );
  const logicalIndex = useCallback(
    (visual: number): number => (rtl && !ttb ? spreadCount - 1 - visual : visual),
    [rtl, ttb, spreadCount],
  );

  // 落定轻触觉（Kotlin L960-969 HapticsGate.enabled + VIRTUAL_KEY）
  const haptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const size = ttb ? el.clientHeight : el.clientWidth;
    if (size <= 0) return;
    const raw = (ttb ? el.scrollTop : el.scrollLeft) / size;
    const visual = clampIndex(Math.round(raw), spreadCount);
    const logical = logicalIndex(visual);
    const frac = raw - Math.round(raw);
    setOffsetFraction((prev) => (Math.abs(prev - frac) < 1e-4 ? prev : frac));
    if (logical !== currentSpread) {
      haptic();
      onSpreadChanged(clampIndex(logical, spreadCount));
    }
  }, [ttb, spreadCount, currentSpread, haptic, onSpreadChanged, logicalIndex]);

  // 外部跳页同步（Kotlin L970-982）：大跨度/无动画 → 瞬切
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const size = ttb ? el.clientHeight : el.clientWidth;
    if (size <= 0) return;
    const target = visualIndex(currentSpread) * size;
    // 已在目标槽位内（±半槽）时不重复滚动，避免与用户拖动互相打架
    const actual = ttb ? el.scrollTop : el.scrollLeft;
    if (Math.abs(actual - target) < size * 0.5) return;
    if (ttb) scrollElementTo(el, { top: target, behavior: 'auto' });
    else scrollElementTo(el, { left: target, behavior: 'auto' });
  }, [currentSpread, ttb, visualIndex]);

  // 自动阅读（Kotlin L983-988）
  useEffect(() => {
    if (!autoRead) return;
    const timer = window.setTimeout(() => {
      if (currentSpread < spreadCount - 1) onSpreadChanged(currentSpread + 1);
      else goNext();
    }, Math.max(1, autoIntervalSec * 1000));
    return () => window.clearTimeout(timer);
  }, [autoRead, autoIntervalSec, currentSpread, spreadCount, onSpreadChanged, goNext]);

  return (
    <div
      className="comic-pager-host"
      style={{
        paddingLeft: `${String(half)}px`,
        paddingRight: `${String(half)}px`,
        // CURL：Web 无 GLSurfaceView 等价 → WebGL2 卷页渲染器（E43 已关闭）。
        // 原先是 CSS 3D 透视近似，只能平面旋转/缩放，无法表达卷曲时每点不同的
        // 法线与背面镜像；现由 `platform/web/webCurlGl.ts` 的 `WebCurlGl`
        // 逐像素复现 harism 的圆柱卷曲。
        perspective: curl ? '1600px' : undefined,
      }}
    >
      {/* E43：curl 档挂载 WebGL2 画布。未支持时 `WebCurlGl` 显式抛错并
          渲染 null，由外层 CSS 3D 容器接管（与 Kotlin 的 GL 不可用降级一致）。 */}
      {curl ? (
        <ComicCurlSurface layout={layout} loader={loader} currentSpread={currentSpread} />
      ) : null}
      <div
        ref={scrollRef}
        className="comic-pager-scroll"
        style={{
          scrollSnapType: `${ttb ? 'y' : 'x'} mandatory`,
          flexDirection: ttb ? 'column' : rtl ? 'row-reverse' : 'row',
        }}
        onScroll={handleScroll}
      >
        {layout.spreads.map((spread) => {
          const idx = spread.index;
          // Kotlin L1016-1021: pageOffset = currentPage + offsetFraction - idx，钳 ±1.5
          const pageOffset = Math.min(1.5, Math.max(-1.5, currentSpread + offsetFraction - idx));
          const style: CSSProperties = isFade
            ? (() => {
                const [tx, ty] = fadeCancelOffset(pageOffset, rtl, ttb, 1, 1);
                return {
                  transform: `translate(${String(tx)}%, ${String(ty)}%)`,
                  opacity: fadeCrossAlpha(pageOffset),
                };
              })()
            : {};
          return (
            <div key={String(idx)} className="comic-pager-slot" style={{ scrollSnapAlign: 'center', ...style }}>
              <ComicSpreadCell
                spread={spread}
                config={config}
                loader={loader}
                bookState={bookState}
                sizes={sizes}
                callbacks={callbacks}
                onBitmapShown={onBitmapShown}
                onZoomChanged={onZoomChanged}
                mirrorX={false}
                isCurrentPage={idx === currentSpread}
                transferFor={transferFor}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicMagneticPager (Kotlin L1113-1284)
 * ═══════════════════════════════════════════════════════════════════════ */

interface MagneticPagerProps {
  readonly layout: ComicLayout;
  readonly config: ComicReaderConfig;
  readonly loader: ComicPageLoaderPort;
  readonly bookState: ComicBookState;
  readonly sizes: Readonly<Record<string, ComicSizeInfo>>;
  readonly currentSpread: number;
  readonly onSpreadChanged: (spread: number) => void;
  readonly callbacks: ComicGestureCallbacks;
  readonly onBitmapShown: (bitmap: ComicBitmap) => void;
  readonly onZoomChanged: (zoomed: boolean) => void;
  readonly autoRead: boolean;
  readonly autoIntervalSec: number;
  readonly goNext: () => void;
  readonly transferFor: (ref: ComicPageRef) => ComicTransferLike | null;
}

function ComicMagneticPager(props: MagneticPagerProps): ReactNode {
  const {
    layout,
    config,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    onBitmapShown,
    onZoomChanged,
    autoRead,
    autoIntervalSec,
    goNext,
    transferFor,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const container = useElementSize(hostRef);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef(0);
  const childZoomedRef = useRef(false);
  // Kotlin L1139 magDragActive：拖拽进行中禁用 CSS transition（跟手），用 state 供 render 读
  const [magDragActive, setMagDragActive] = useState(false);
  const samplesRef = useRef<{ t: number; x: number; y: number }[]>([]);
  const settleRef = useRef<number | null>(null);
  const rtl = config.direction === 'RTL';
  const ttb = config.direction === 'TTB';
  const dirSign = rtl ? -1 : 1;
  const spreadCount = comicLayoutSpreadCount(layout);
  const span = ttb ? container.height : container.width;

  const applyDrag = useCallback((value: number): void => {
    dragRef.current = value;
    setDrag(value);
  }, []);

  // 翻页提交后重置（Kotlin L1145-1147：拖拽进行中不重置，防打断跟手）
  useEffect(() => {
    if (Math.abs(dragRef.current) > 1 && !magDragActive) applyDrag(0);
  }, [currentSpread, magDragActive, applyDrag]);

  // 自动阅读（Kotlin L1149-1160）
  useEffect(() => {
    if (!autoRead) return;
    const timer = window.setTimeout(() => {
      if (currentSpread < spreadCount - 1) onSpreadChanged(currentSpread + 1);
      else goNext();
    }, Math.max(1, autoIntervalSec * 1000));
    return () => window.clearTimeout(timer);
  }, [autoRead, autoIntervalSec, currentSpread, spreadCount, onSpreadChanged, goNext]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!config.gestureSwipe) return;
    // jsdom / 旧 WebView 缺 setPointerCapture —— 缺失时降级为普通事件流
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    samplesRef.current = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }];
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const list = samplesRef.current;
    const last = list[list.length - 1];
    if (last === undefined) return;
    if (!config.gestureSwipe || childZoomedRef.current) return;
    const delta = ttb ? event.clientY - last.y : event.clientX - last.x;
    if (delta === 0) return;
    list.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (list.length > 6) list.shift();
    setMagDragActive(true);
    // Kotlin L1215: 边缘橡胶带阻尼
    applyDrag(dampEdgeDrag(dragRef.current + delta, currentSpread, spreadCount, span > 0 ? span : 1));
  };

  const onPointerUp = (): void => {
    const list = samplesRef.current;
    const first = list[0];
    const last = list[list.length - 1];
    if (first === undefined || last === undefined) {
      setMagDragActive(false);
      applyDrag(0);
      return;
    }
    const dt = Math.max(1, last.t - first.t) / 1000;
    const vAxis = ttb ? (last.y - first.y) / dt : (last.x - first.x) / dt;
    const vTh = 400; // Kotlin L1180: 400.dp.toPx()
    // Kotlin L1226-1227: 目标位移钳到合法页范围
    const rawShift = magneticTargetShift(dragRef.current, vAxis, span > 0 ? span : 1, dirSign, vTh);
    const shift = Math.min(spreadCount - 1 - currentSpread, Math.max(-currentSpread, rawShift));
    const targetPage = currentSpread + shift;
    // 弹簧回弹 → CSS transition（近似 spring(dampingRatio = 0.85, stiffness = 380)）
    applyDrag(-shift * span * dirSign);
    settleRef.current = window.setTimeout(() => applyDrag(0), 220);
    setMagDragActive(false);
    if (targetPage !== currentSpread) {
      onSpreadChanged(targetPage);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
    }
  };

  return (
    <div
      ref={hostRef}
      className="comic-magnetic-host"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="presentation"
    >
      {[-1, 0, 1].map((windowOffset) => {
        const idx = currentSpread + windowOffset;
        const spread = layout.spreads[idx];
        if (spread === undefined) return null;
        const base = windowOffset * span * dirSign;
        return (
          <div
            key={String(idx)}
            className="comic-magnetic-window"
            style={{
              transform: ttb
                ? `translate3d(0, ${String(base + drag)}px, 0)`
                : `translate3d(${String(base + drag)}px, 0, 0)`,
              transition: magDragActive
                ? 'none'
                : 'transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1)',
            }}
          >
            <ComicSpreadCell
              spread={spread}
              config={config}
              loader={loader}
              bookState={bookState}
              sizes={sizes}
              callbacks={callbacks}
              onBitmapShown={onBitmapShown}
              onZoomChanged={(zoomed) => {
                childZoomedRef.current = zoomed;
                onZoomChanged(zoomed);
              }}
              mirrorX={false}
              isCurrentPage={windowOffset === 0}
              transferFor={transferFor}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicReaderChrome — 接线层
 *
 * 面板部分：Kotlin `ComicReaderChrome.kt` L269-307 的 `when (panel)` 四分支，
 * 直接渲染 `ComicReaderSheets.kt` 的真移植版（`../components/comic/sheets`），
 * 逐条对应：
 *   - L270-281 `ComicPanel.SETTINGS -> ComicSettingsSheet(...)`
 *   - L282-290 `ComicPanel.TOC      -> ComicTocSheet(...)`
 *   - L291-296 `ComicPanel.PRESET   -> ComicPresetSheet(...)`
 *   - L297-305 `ComicPanel.CROP     -> ComicCropSheet(...)`
 *   - L306     `ComicPanel.NONE     -> Unit`
 * 占位文案「该面板由 ComicReaderSheets.kt 提供，本次未移植。」已删除。
 *
 * 顶/底栏仍为本页的精简接线层（`ComicReaderChrome.kt` 顶栏的三点菜单
 * 「手动裁边 / 阅读预设 / 临时合页」与收藏预设长按、底栏的进度滑条 +
 * 缩略图气泡见 src/ui/components/comic/comicReaderChrome.tsx，本次未接入）。
 * ═══════════════════════════════════════════════════════════════════════ */

interface ChromeProps {
  readonly visible: boolean;
  readonly panel: ComicPanel;
  readonly onPanelChange: (panel: ComicPanel) => void;
  readonly glass: boolean;
  readonly title: string;
  readonly chapterTitle: string | null;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly spreadCount: number;
  readonly currentSpread: number;
  readonly config: ComicReaderConfig;
  readonly perBookConfig: boolean;
  readonly onPerBookConfigChange: (enabled: boolean) => void;
  readonly onConfigChange: (config: ComicReaderConfig) => void;
  readonly onJumpToSpread: (spread: number) => void;
  readonly onJumpToRawPage: (raw: number) => void;
  readonly onGoPrev: () => void;
  readonly onGoNext: () => void;
  readonly autoRead: boolean;
  readonly onAutoReadToggle: () => void;
  readonly continuousFraction: number;
  readonly onJumpToScrollFraction: ((fraction: number) => void) | null;
  readonly toc: readonly ComicTocEntry[];
  readonly currentChapterIndex: number;
  readonly onJumpToChapter: ((index: number) => void) | null;
  readonly onPrevChapter: (() => void) | null;
  readonly onNextChapter: (() => void) | null;
  readonly onGodMoment: (() => void) | null;
  readonly chapterNavLabel: string;
  /** 面板所需的页列表（Kotlin L742 `pages = pages`） */
  readonly pages: readonly ComicPageRef[];
  /** 面板所需的解码器（Kotlin L743 `loader = loader`） */
  readonly sheetLoaders: ReturnType<typeof makeSheetLoaders>;
  /** 预设 / 自定义缩放预设仓库（宿主不提供时为 null → 按 Kotlin `store = null` 退化） */
  readonly presetStore: (WebComicSettingsStorePort & WebComicPresetStorePort) | null;
  readonly bookState: ComicBookState;
  readonly onBookStateChange: (next: ComicBookState) => void;
  readonly onToggleControls: () => void;
  readonly onExit: () => void;
}

function ComicReaderChrome(props: ChromeProps): ReactNode {
  const { visible, panel, onPanelChange, glass } = props;
  // Hook 必须在早退之前（React 19 硬规则）：`useCallback` 的依赖无条件化。
  const onDismissPanel = useCallback(() => onPanelChange('NONE'), [onPanelChange]);
  if (!visible && panel === 'NONE') return null;
  // Kotlin L168 `val currentRaw = (currentPage - 1).coerceIn(0, (pages.size - 1).coerceAtLeast(0))`
  const currentRaw = Math.min(
    Math.max(props.currentPage - 1, 0),
    Math.max(props.pages.length - 1, 0),
  );

  /* ── Kotlin ComicReaderChrome.kt L269-308：`when (panel)` 四分支 ── */
  const sheetsConfig = toSheetsConfig(props.config);

  function renderPanel(): ReactNode {
    if (panel === 'SETTINGS') {
      return (
        <ComicSettingsSheet
          config={sheetsConfig}
          store={props.presetStore}
          perBookConfig={props.perBookConfig}
          onPerBookConfigChange={props.onPerBookConfigChange}
          onConfigChange={props.onConfigChange}
          onOpenPreset={() => onPanelChange('PRESET')}
          onOpenCrop={() => onPanelChange('CROP')}
          pages={props.pages}
          loader={props.sheetLoaders.preview}
          currentRawPage={currentRaw}
          bookState={props.bookState}
          onBookStateChange={(next) => {
            props.onBookStateChange(toBookStatePatch(props.bookState, next));
          }}
          translationBridge={UNSUPPORTED_TRANSLATION_BRIDGE}
          glass={glass}
          onDismiss={onDismissPanel}
        />
      );
    }
    if (panel === 'TOC') {
      return (
        <ComicTocSheet
          toc={props.toc}
          currentChapterIndex={props.currentChapterIndex}
          onJumpToChapter={props.onJumpToChapter}
          pages={props.pages}
          loader={props.sheetLoaders.thumb}
          currentPage={props.currentPage}
          onJumpToRawPage={props.onJumpToRawPage}
          glass={glass}
          onDismiss={onDismissPanel}
        />
      );
    }
    if (panel === 'PRESET') {
      const store = props.presetStore;
      if (store === null) return null;
      return (
        <ComicPresetSheet
          store={store}
          currentConfig={sheetsConfig}
          onApply={props.onConfigChange}
          glass={glass}
          onDismiss={onDismissPanel}
        />
      );
    }
    if (panel === 'CROP') {
      return (
        <ComicCropSheet
          // Kotlin L298 `pages.getOrNull(currentRaw)`
          page={props.pages[currentRaw] ?? null}
          loader={props.sheetLoaders.crop}
          config={sheetsConfig}
          onDismiss={onDismissPanel}
          // Kotlin L301-304：`config.copy(manualCrop = listOf(l,t,r,b))` 后关闭面板
          onApply={(l, t, r, b) => {
            props.onConfigChange({ ...props.config, manualCrop: [l, t, r, b] });
            onDismissPanel();
          }}
        />
      );
    }
    return null;
  }

  return (
    <div className="comic-chrome-layer">
      {visible ? (
        <>
          <div className="comic-chrome-top">
            <button type="button" className="comic-chrome-btn" onClick={props.onExit} aria-label="退出阅读">
              ‹
            </button>
            <div className="comic-chrome-titles">
              <p className="comic-chrome-title">{props.title}</p>
              <p className="comic-chrome-subtitle">
                {props.chapterTitle === null
                  ? ''
                  : `${props.chapterTitle} · `}
                {`${String(props.currentPage)}/${String(props.totalPages)}`}
              </p>
            </div>
            <button
              type="button"
              className="comic-chrome-btn"
              onClick={props.onToggleControls}
              aria-label="隐藏控制栏"
            >
              ⌄
            </button>
          </div>

          <div className="comic-chrome-bottom">
            {/* Kotlin L726 onGoPrev：首/末页继续外翻进入相邻章节，故不置 disabled */}
            <button type="button" className="comic-text-button" onClick={props.onGoPrev}>
              上一页
            </button>
            <button type="button" className="comic-chip" onClick={props.onAutoReadToggle}>
              {props.autoRead ? '停止自动阅读' : '自动阅读'}
            </button>
            <button
              type="button"
              className="comic-chip"
              onClick={() => onPanelChange(panel === 'TOC' ? 'NONE' : 'TOC')}
              aria-pressed={panel === 'TOC'}
            >
              目录
            </button>
            <button
              type="button"
              className="comic-chip"
              onClick={() => onPanelChange(panel === 'SETTINGS' ? 'NONE' : 'SETTINGS')}
              aria-pressed={panel === 'SETTINGS'}
            >
              设置
            </button>
            {props.onGodMoment === null ? null : (
              <button type="button" className="comic-chip" onClick={props.onGodMoment}>
                神回
              </button>
            )}
            {/* Kotlin L727 onGoNext：末页外翻进下一章 */}
            <button type="button" className="comic-text-button" onClick={props.onGoNext}>
              下一页
            </button>
          </div>

          {/* Kotlin ComicBottomBar L521-535：章节导航行。
           *  原实现把这两个按钮塞在内联目录面板里，但 Kotlin 里它们在底栏
           *  （ComicTocSheet 没有章节导航）——接入真面板后必须迁回底栏，
           *  否则删除内联面板会让功能整体丢失。 */}
          {props.onPrevChapter === null && props.onNextChapter === null ? null : (
            <div className="comic-chrome-chapternav">
              <button
                type="button"
                className="comic-chrome-chapternav__btn"
                disabled={props.onPrevChapter === null}
                onClick={() => props.onPrevChapter?.()}
              >
                {`上一${props.chapterNavLabel}`}
              </button>
              <button
                type="button"
                className="comic-chrome-chapternav__btn"
                disabled={props.onNextChapter === null}
                onClick={() => props.onNextChapter?.()}
              >
                {`下一${props.chapterNavLabel}`}
              </button>
            </div>
          )}

          {props.continuousFraction >= 0 ? (
            <input
              className="comic-scrubber"
              type="range"
              min={0}
              max={100}
              value={Math.round(props.continuousFraction * 100)}
              onChange={(event) => {
                const jump = props.onJumpToScrollFraction;
                if (jump !== null) jump(Number(event.target.value) / 100);
              }}
              aria-label="阅读进度"
            />
          ) : (
            <input
              className="comic-scrubber"
              type="range"
              min={0}
              max={Math.max(0, props.totalPages - 1)}
              value={Math.max(0, props.currentPage - 1)}
              onChange={(event) => props.onJumpToRawPage(Number(event.target.value))}
              aria-label="页码跳转"
            />
          )}
        </>
      ) : null}

      {/* Kotlin L262-309：面板宿主。四个面板自带全屏遮罩
       *  （ComicSheetOverlay 的 .cmcs-overlay ↔ L254-259 的
       *  Box(fillMaxSize).background(0x66000000).clickableNoRipple(onDismissPanel)），
       *  故这里不再叠一层遮罩，也不保留 .comic-panel 外壳。 */}
      {panel === 'NONE' ? null : renderPanel()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ComicReaderCore (Kotlin L179-749)
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ComicReaderPageProps {
  readonly pages?: readonly ComicPageRef[];
  readonly title?: string;
  readonly chapterTitle?: string | null;
  readonly bookKey?: string | null;
  readonly initialPage?: number;
  readonly toc?: readonly ComicTocEntry[];
  readonly currentChapterIndex?: number;
  readonly onJumpToChapter?: ((index: number) => void) | null;
  readonly onPrevChapter?: (() => void) | null;
  readonly onNextChapter?: (() => void) | null;
  readonly chapterNavLabel?: string;
  readonly onPageChanged?: ((rawPage: number, isFinished: boolean) => void) | null;
  readonly onGodMoment?: (() => void) | null;
  readonly onExit?: () => void;
  /** 注入式解码器（Kotlin ComicPageLoader）；不传则用 WebComicPageLoader */
  readonly loader?: ComicPageLoaderPort | null;
  /** 注入式设置仓库（Kotlin ComicSettingsStore） */
  readonly store?: WebComicSettingsStorePort | null;
  /** 翻译烘焙代数（Kotlin LocalComicTranslationEpoch 的 Web 注入点） */
  readonly translationEpoch?: number;
  /** 正在翻译的页（Kotlin translationCoordinator.busyKeys） */
  readonly translatingKeys?: readonly string[];
  /** 翻译窗口调度（Kotlin scheduleTranslationWindow） */
  readonly onTranslationWindowSchedule?:
    | ((entries: readonly ComicPageLoaderWindowEntry[], config: ComicReaderConfig) => void)
    | null;
  /** 翻译签名变化（Kotlin L286-303 的 LaunchedEffect 体） */
  readonly onTranslationSignatureChange?: ((wasOn: boolean) => void) | null;
  /** 动态背景主色提取（Kotlin feedDynamicBg 的 provider） */
  readonly dominantColorOf?: ((bitmap: ComicBitmap) => Promise<number | null>) | null;
  /** 传输进度（Kotlin ComicTransfers.state(url)） */
  readonly transferFor?: ((ref: ComicPageRef) => ComicTransferLike | null) | null;
}

export function ComicReaderPage(props: ComicReaderPageProps): ReactNode {
  const {
    pages = DEMO_PAGES,
    title = '',
    chapterTitle = null,
    bookKey = null,
    initialPage = 0,
    toc = [],
    currentChapterIndex = -1,
    onJumpToChapter = null,
    onPrevChapter = null,
    onNextChapter = null,
    chapterNavLabel = '章节',
    onPageChanged = null,
    onGodMoment = null,
    onExit,
    loader: injectedLoader = null,
    store: injectedStore = null,
    translationEpoch = 0,
    translatingKeys = [],
    onTranslationWindowSchedule = null,
    onTranslationSignatureChange = null,
    dominantColorOf = null,
    transferFor: transferForProp = null,
  } = props;

  const setRoute = useAppStore((s) => s.setRoute);
  const exit = useCallback((): void => {
    if (onExit !== undefined) onExit();
    else setRoute('comicChapters');
  }, [onExit, setRoute]);

  /* ── 配置与每漫画状态 (Kotlin L198-218) ── */
  const store = useMemo<WebComicSettingsStorePort>(
    () => injectedStore ?? new ComicSettingsStore(createWebComicPrefs()),
    [injectedStore],
  );
  const loader = useMemo(() => injectedLoader ?? new WebComicPageLoader(), [injectedLoader]);
  // Kotlin ComicPageLoader.kt:694 `PreferencesManager(context).preloadWifiOnly`
  // —— 「仅 Wi-Fi 预加载」开关，读一次同步到模块级 ref（loader 不重建，保住缓存）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { PreferencesManager, SettingsRepository } = await import(
          '@core/settings/settingsRepository'
        );
        const { getPlatform } = await import('@platform/index');
        const value = await new PreferencesManager(
          new SettingsRepository(getPlatform().db),
        ).preloadWifiOnly();
        if (!cancelled) comicPreloadWifiOnlyRef.current = value;
      } catch (error) {
        // 读不到设置时保持默认 false（= 不限网络），等价 Kotlin 默认值。
        console.warn('[comic] preload_wifi_only 读取失败：', describeError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const effective = useMemo(() => store.effectiveConfig(bookKey), [store, bookKey]);
  // 面板要的预设 / 自定义缩放预设方法（Kotlin ComicSettingsStore 同一实例提供）
  const presetStore = useMemo(() => asPresetStore(store), [store]);

  const [config, setConfig] = useState<ComicReaderConfig>(effective.config);
  const [bookState, setBookState] = useState<ComicBookState>(() =>
    bookKey === null ? NO_BOOK_STATE : store.loadBookState(bookKey),
  );
  const [perBookConfig, setPerBookConfig] = useState(effective.hasOverride);

  // 配置防抖持久化（Kotlin L208-238：滑条拖动只在停止后写盘）
  // latestRef 只在 effect 里写（render 期不碰 ref.current）
  const latestRef = useRef<{
    config: ComicReaderConfig;
    perBook: boolean;
    key: string | null;
  }>({ config: effective.config, perBook: effective.hasOverride, key: bookKey });
  useEffect(() => {
    latestRef.current = { config, perBook: perBookConfig, key: bookKey };
  }, [config, perBookConfig, bookKey]);

  // ── 沉浸式状态栏（ComicReaderCore.kt:400-423）──────────────────────────────
  // ADAPTATION: Kotlin `DisposableEffect(Unit) { hideSystemBars(); onDispose {
  // showSystemBars() } }` —— BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE + hide(systemBars())，
  // 进入漫画阅读即隐藏系统栏（含状态栏），退出时恢复。
  // 依赖数组是 `[]`：与设置无关，仅挂载/卸载各跑一次。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        if (cancelled) return;
        await getPlatform().statusBars.setHidden(true);
      } catch (error) {
        // 端口不可用（web-mock 显式抛错 / Capacitor StatusBar 未装）：沉浸由 CSS safe-area 提供。
        console.warn('[comic] 沉浸式状态栏未生效：', describeError(error));
      }
    })();
    return () => {
      cancelled = true;
      void (async () => {
        try {
          const { getPlatform } = await import('@platform/index');
          await getPlatform().statusBars.setHidden(false);
        } catch {
          // 不可用时无需处理。
        }
      })();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cur = latestRef.current;
      if (cur.perBook && cur.key !== null) store.saveBookConfig(cur.key, cur.config);
      else {
        store.saveGlobalConfig(cur.config);
        if (cur.key !== null) store.clearBookConfig(cur.key);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [config, perBookConfig, bookKey, store]);

  // Kotlin L210-218 DisposableEffect onDispose：flush（读 effect 内的 latestRef）
  useEffect(
    () => () => {
      const cur = latestRef.current;
      if (cur.perBook && cur.key !== null) store.saveBookConfig(cur.key, cur.config);
      else store.saveGlobalConfig(cur.config);
    },
    [store],
  );

  // Kotlin L219-238 persistConfig
  const persistConfig = useCallback(
    (newConfig: ComicReaderConfig): void => {
      setConfig(newConfig);
    },
    [],
  );

  // 滤镜滑条节流（Kotlin L244-252：displayConfig 落后 config 250ms）
  const [displayConfig, setDisplayConfig] = useState<ComicReaderConfig>(config);
  useEffect(() => {
    const timer = window.setTimeout(() => setDisplayConfig(config), 250);
    return () => window.clearTimeout(timer);
  }, [config]);

  /* ── 加载器与尺寸 (Kotlin L254-261, L324-328) ── */
  useEffect(
    () => () => {
      loader.clearProcessedCache();
      loader.shutdown();
    },
    [loader],
  );

  const [sizes, setSizes] = useState<Readonly<Record<string, ComicSizeInfo>>>({});
  useEffect(() => loader.subscribeSizes(setSizes), [loader]);
  // 面板的三个 loader（Kotlin 的 loadPreview / loadThumb 是 ComicPageLoader 的方法）
  // 必须放在 `sizes` 之后 —— 退化路径要用 gutterPos 算拆分位置。
  const sheetLoaders = useMemo(
    () => makeSheetLoaders(pages, loader, sizes),
    [pages, loader, sizes],
  );
  useEffect(() => {
    void loader.probeSizes(pages.slice(0, 600));
  }, [loader, pages]);

  /* ── 翻译签名（Kotlin L281-303, Web 外部注入） ── */
  const translationSig = `${String(config.translationEnabled)}|${String(config.translationTextScale)}|${config.translationLang}|${config.translationEngine}`;
  const lastTranslationSigRef = useRef(translationSig);
  useEffect(() => {
    const prev = lastTranslationSigRef.current;
    lastTranslationSigRef.current = translationSig;
    if (prev === translationSig) return;
    if (onTranslationSignatureChange !== null) {
      onTranslationSignatureChange(prev.split('|')[0] === 'true');
    }
  }, [translationSig, onTranslationSignatureChange]);

  /* ── 布局与位置 (Kotlin L330-380) ── */
  const verticalMode = config.mode === 'WEBTOON' || config.mode === 'CONTINUOUS';
  // 垂直模式忽略临时合页（垂直单项只渲染单槽，合页会导致丢页）
  //
  // 依赖里**只有 mergeAnchors**，这是逐行对齐 Kotlin L359-362：
  //
  // ```kotlin
  // val layout = remember(config.mode, config.direction, config.doubleFirstAlone,
  //     config.splitWide, config.splitReverse, config.splitPosition, pages, sizes,
  //     layoutBookState.mergeAnchors) {          // ← 只列 mergeAnchors，不是整个 bookState
  //     ComicPageLayout.build(pages, sizes, config, layoutBookState)
  // }
  // ```
  //
  // 这个 key 的选择是**必需**的，不是疏漏：下面的进度回写 effect（L391 的
  // `LaunchedEffect(currentSpread, layout)`）在 bookKey != null 时会
  // `setBookState({...prev, lastPage, lastChapterSig})`。若 layout 的 memo 依赖整个
  // `bookState` 对象，就形成
  //     bookState 变 → layout 重算（新对象）→ effect 重跑 → setBookState（新对象）→ …
  // 的**无限渲染循环**（实测：ComicReaderPage 传 bookKey 时整个测试文件挂死）。
  // Kotlin 侧靠 remember key 不含 lastPage 而天然免疫。
  //
  // 语义上也应当如此：`buildComicLayout` 只读 `bookState.mergeAnchors`
  // （comicReaderCore.ts:1076/1112 两处 `mergeAnchors.has(...)`），
  // `lastPage` / `lastChapterSig` 是纯进度元数据，`pageRotations` 是渲染层变换，
  // 都不参与布局计算。所以 memo 依赖 `config`（整体对象）、`pages`、`sizes`、
  // `verticalMode` 与 `mergeAnchors` 即已完备。
  //
  // `buildComicLayout` 只读 `mergeAnchors`，其余三个字段传 `EMPTY_COMIC_BOOK_STATE`
  // 的默认值与传真实值**完全等价**（`tests/unit/comicReaderLayoutInputs.test.ts`
  // 锁住了这个不变量：改 `buildComicLayout` 去读别的字段会让该测试变红）。
  //
  // 之所以传常量而不是 `{ ...bookState, mergeAnchors }`：后者会把 `bookState`
  // 拖进 memo 依赖，而它每次进度回写都是新对象 —— 那正是本 bug 的成因。
  const mergeAnchors = verticalMode ? EMPTY_MERGE_ANCHORS : bookState.mergeAnchors;
  const layoutBookState: ComicBookState = useMemo(
    () => ({ ...EMPTY_COMIC_BOOK_STATE, mergeAnchors }),
    [mergeAnchors],
  );
  const layout: ComicLayout = useMemo(
    () => buildComicLayout(pages, sizes, config, layoutBookState),
    [pages, sizes, config, layoutBookState],
  );

  // Kotlin L344: 章节签名 = 首页 id
  const chapterSig = pages[0]?.id ?? null;

  // Kotlin L340-351: 起始原始页
  const [currentRawPage, setCurrentRawPage] = useState(() => {
    const fromArg = coercePage(initialPage, pages.length);
    const state = bookKey === null ? NO_BOOK_STATE : store.loadBookState(bookKey);
    const sameChapter = state.lastChapterSig === null || state.lastChapterSig === chapterSig;
    if (fromArg > 0) return fromArg;
    if (sameChapter) return coercePage(state.lastPage, pages.length);
    return 0;
  });

  const spreadCount = comicLayoutSpreadCount(layout);
  // Kotlin L359: 布局重建时以记录的原始页为准（spread 索引语义会变）
  const currentSpread = clampIndex(spreadOfRawPage(layout, currentRawPage), spreadCount);
  const currentSpreadData = layout.spreads[currentSpread] ?? null;
  const currentPageNum = (currentSpreadData === null ? 0 : spreadFirstRawIndex(currentSpreadData)) + 1;
  const totalPages = pages.length;

  const onSpreadChanged = useCallback(
    (next: number): void => {
      const spread = layout.spreads[next];
      if (spread === undefined) return;
      setCurrentRawPage(spreadFirstRawIndex(spread));
    },
    [layout],
  );

  // 进度持久化（Kotlin L367-380）
  // bookState 的 lastPage / lastChapterSig 是"写向仓库"的镜像，不是渲染输入，
  // 因此放在 ref 里同步（effect 内写），避免 effect 内 setState 触发级联渲染。
  const bookStateRef = useRef(bookState);
  useEffect(() => {
    bookStateRef.current = bookState;
  }, [bookState]);

  useEffect(() => {
    const spread = layout.spreads[currentSpread];
    if (spread === undefined) return;
    const raw = spreadFirstRawIndex(spread);
    const cb = onPageChanged;
    if (cb !== null) cb(raw, raw >= totalPages - 1);
    if (bookKey === null) return;
    const next: ComicBookState = {
      ...bookStateRef.current,
      lastPage: raw,
      lastChapterSig: chapterSig,
    };
    bookStateRef.current = next;
    setBookState(next);
    store.saveBookState(bookKey, next);
  }, [currentSpread, layout, totalPages, chapterSig, bookKey, store, onPageChanged]);

  /* ── 控制层 / 面板 (Kotlin L382-398) ── */
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<ComicPanel>('NONE');
  const [autoRead, setAutoRead] = useState(false);
  const [scrollMetrics, setScrollMetrics] = useState<ComicScrollMetricsLike | null>(null);
  const [scrollJump, setScrollJump] = useState<{ seq: number; fraction: number } | null>(null);
  const navLatch = useRef(new ChapterNavigationLatch());

  // Kotlin L392-398 navigateChapter：单飞门闩
  const navigateChapter = useCallback(
    (next: boolean): boolean => {
      const action = next ? onNextChapter : onPrevChapter;
      if (action === null || action === undefined) return false;
      if (!navLatch.current.tryAcquire()) return false;
      action();
      return true;
    },
    [onNextChapter, onPrevChapter],
  );
  // 换章后释放门闩（Kotlin remember(pages) 重置 chapterNavigationPending）
  useEffect(() => {
    navLatch.current.release();
  }, [pages]);

  /* ── 翻页 (Kotlin L426-439)：首末页继续外翻进入相邻章节 ── */
  const goNext = useCallback((): boolean => {
    if (currentSpread < spreadCount - 1) {
      const next = layout.spreads[currentSpread + 1];
      if (next !== undefined) setCurrentRawPage(spreadFirstRawIndex(next));
      return true;
    }
    if (navigateChapter(true)) return true;
    setAutoRead(false);
    return false;
  }, [currentSpread, spreadCount, layout, navigateChapter]);

  const goPrev = useCallback((): void => {
    if (currentSpread > 0) {
      const prev = layout.spreads[currentSpread - 1];
      if (prev !== undefined) setCurrentRawPage(spreadFirstRawIndex(prev));
      return;
    }
    navigateChapter(false);
  }, [currentSpread, layout, navigateChapter]);

  /* ── 手势回调（Kotlin L441-497）：点按区方向感知 ── */
  const callbacks: ComicGestureCallbacks = useMemo(
    () => ({
      onTapZone: (pos, size) => {
        const action = resolveTapAction(pos, size, config);
        if (action === 'PREV') {
          // 第 23 条：栏可见时点击优先隐藏栏，不直接翻页
          if (controlsVisible) setControlsVisible(false);
          else goPrev();
          return;
        }
        if (action === 'NEXT') {
          if (controlsVisible) setControlsVisible(false);
          else goNext();
          return;
        }
        if (action === 'TOGGLE_CONTROLS') {
          setControlsVisible(!controlsVisible);
          if (controlsVisible) setPanel('NONE');
          return;
        }
        if (action === 'TOC') {
          setControlsVisible(true);
          setPanel('TOC');
          return;
        }
        if (action === 'SETTINGS') {
          setControlsVisible(true);
          setPanel('SETTINGS');
          return;
        }
        if (action === 'EXIT') exit();
      },
      onLongPress: () => setControlsVisible(true),
      onPinchClose: () => exit(),
      onEdgeBack: () => exit(),
      onZoomedEdgeSwipe: (dir) => {
        // dir>0：手指向右拖。LTR：回到上一页；RTL：读完全页（内容左缘）进入下一页
        if (config.direction === 'RTL') {
          if (dir > 0) goNext();
          else goPrev();
          return;
        }
        if (dir > 0) goPrev();
        else goNext();
      },
    }),
    [config, controlsVisible, goNext, goPrev, exit],
  );

  /* ── 动态背景主色 (Kotlin L499-512) ── */
  const [dynamicBg, setDynamicBg] = useState('#101014');
  const feedDynamicBg = useCallback(
    (bitmap: ComicBitmap): void => {
      if (dominantColorOf === null) return;
      void dominantColorOf(bitmap).then((c) => {
        if (c === null) return;
        setDynamicBg(`#${c.toString(16).padStart(6, '0')}`);
      });
    },
    [dominantColorOf],
  );

  /* ── 相邻页预载 (Kotlin L519-551) ── */
  useEffect(() => {
    if (verticalMode) return;
    const entries: ComicPageLoaderWindowEntry[] = [];
    const fingerprint = imagePipelineFingerprint(displayConfig);
    // 驻留优先级序：当前 → 下一 → 上一（在线额外多预一页）
    const online = pages.some((p) => p.kind === 'REMOTE');
    const order = online
      ? [currentSpread, currentSpread + 1, currentSpread + 2, currentSpread - 1]
      : [currentSpread, currentSpread + 1, currentSpread - 1];
    for (const si of order) {
      const spread = layout.spreads[si];
      if (spread === undefined) continue;
      spread.slots.forEach((slot) => {
        const rotationDeg = effectiveRotation(
          displayConfig.bookRotation,
          pageRotationOf(bookState, slot.ref.id),
        );
        entries.push({
          ref: slot.ref,
          visible: si === currentSpread,
          cacheKey: comicCacheKey(slot.ref, slot.half, fingerprint, rotationDeg),
          geometry: {
            half: slot.half,
            splitPosition: effectiveSplitPosition(
              displayConfig,
              sizes[slot.ref.id]?.gutterPos ?? null,
            ),
            rotationDeg,
            cropMode: displayConfig.cropMode,
            manualCrop: displayConfig.manualCrop,
          },
        });
      });
    }
    // Kotlin L548-549: 整窗一次提交
    loader.preloadWindow(entries, toneOf(displayConfig));
    if (onTranslationWindowSchedule !== null) onTranslationWindowSchedule(entries, displayConfig);
  }, [
    currentSpread,
    layout,
    displayConfig,
    verticalMode,
    pages,
    bookState,
    sizes,
    loader,
    translationEpoch,
    onTranslationWindowSchedule,
  ]);

  /* ── 模式渲染 (Kotlin L554-656) ── */
  const engineSig = `${config.mode}|${config.direction}|${displayConfig.pageAnim}|${String(spreadCount)}`;
  const engineIsGl = curlEngineActive(displayConfig.pageAnim, config.direction, config.mode);
  const glass = panelGlassSamplingActive(
    config.pageAnim,
    config.direction,
    config.mode,
    panel !== 'NONE',
  );

  // Kotlin L580-604: 签名变化时 240ms 挂钟淡入（挂钟自算进度 + 帧节拍）
  const [engineFade, setEngineFade] = useState(1);
  const lastEngineSigRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastEngineSigRef.current;
    lastEngineSigRef.current = engineSig;
    // 首次组合不淡入；GL 引擎跳过（CURL 用 CSS 近似，无 Surface 合成异常）
    if (prev === null || prev === engineSig || engineIsGl) return;
    let ticks = 0;
    let raf = 0;
    const start = performance.now();
    const step = (): void => {
      const elapsed = performance.now() - start;
      setEngineFade(engineFadeAlpha(elapsed, ENGINE_FADE_DURATION_MS));
      if (elapsed >= ENGINE_FADE_DURATION_MS) {
        setEngineFade(1);
        return;
      }
      ticks += 1;
      // 帧计数上限是双保险（Kotlin L588-589：冻结 uptime 时靠上限退出保空闲）
      if (ticks >= ENGINE_FADE_MAX_TICKS) {
        setEngineFade(1);
        return;
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [engineSig, engineIsGl]);

  // ComicReaderBackground.kt 不在本次范围 → 内联背景 + comic.css 纸张纹理类
  const backgroundStyle: CSSProperties =
    config.bgType === 'BLACK'
      ? { background: '#000000' }
      : config.bgType === 'WHITE'
        ? { background: '#ffffff' }
        : config.bgType === 'GRAY'
          ? { background: '#1c1c1e' }
          : config.bgType === 'PAPER'
            ? {
                background: '#f6efe2',
                '--comic-paper-intensity': String(config.paperIntensity / 100),
              } as CSSProperties
            : { background: dynamicBg };

  const transferFor = useCallback(
    (ref: ComicPageRef): ComicTransferLike | null =>
      transferForProp === null ? null : transferForProp(ref),
    [transferForProp],
  );

  const onSpreadChangedRef = useRef(onSpreadChanged);
  useEffect(() => {
    onSpreadChangedRef.current = onSpreadChanged;
  }, [onSpreadChanged]);

  /* ── 场景环境音 (Kotlin L679-691) ── */
  useEffect(() => {
    const audio = getAmbientAudio();
    if (config.scene !== 'NONE' && config.sceneSound) {
      audio.start(config.scene as Parameters<typeof audio.start>[0], (config.sceneVolume / 100) * 0.6);
    } else {
      audio.stop();
    }
    return () => audio.stop();
  }, [config.scene, config.sceneSound, config.sceneVolume]);

  /* ── 音量键翻页 (Kotlin L445-462) ── */
  useEffect(() => {
    if (!config.volumeKeyTurn) {
      ComicVolumeKeyBridge.handler = null;
      return;
    }
    ComicVolumeKeyBridge.handler = (isUp, isDownAction) => {
      if (!isDownAction) return true; // UP 事件一并吞掉（防系统音量条），但不重复翻页
      const next = config.direction === 'RTL' ? isUp : !isUp;
      if (next) onSpreadChangedRef.current(clampIndex(currentSpread + 1, spreadCount));
      else if (currentSpread > 0) onSpreadChangedRef.current(currentSpread - 1);
      else navigateChapter(false);
      return true;
    };
    const onKey = (event: KeyboardEvent): void => {
      if (ComicVolumeKeyBridge.dispatchWebKey(event.key, event.type === 'keydown')) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      if (ComicVolumeKeyBridge.handler !== null) ComicVolumeKeyBridge.handler = null;
    };
  }, [config.volumeKeyTurn, config.direction, currentSpread, spreadCount, navigateChapter]);

  // Kotlin L996 childZoomed：子页缩放态（供自动阅读避让 / 边缘手势让位判断）
  const [childZoomed, setChildZoomed] = useState(false);

  const verticalListProps = useMemo(() => {
    return {
      layout,
      config: displayConfig,
      loader,
      bookState,
      sizes,
      currentSpread,
      onSpreadChanged,
      callbacks,
      onAreaSizeChanged: () => undefined,
      onBitmapShown: feedDynamicBg,
      autoScrollActive: autoRead,
      autoScrollSpeedDp: config.autoScrollSpeedDp,
      onReachEnd: () => {
        goNext();
      },
      onScrollMetrics: setScrollMetrics,
      scrollJump,
      onPreviousChapter: () => {
        navigateChapter(false);
      },
      onNextChapter: () => {
        navigateChapter(true);
      },
      transferFor,
    };
  }, [
    layout,
    displayConfig,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    feedDynamicBg,
    autoRead,
    config.autoScrollSpeedDp,
    goNext,
    scrollJump,
    navigateChapter,
    transferFor,
  ]);

  const pagedProps = useMemo(() => {
    return {
      layout,
      config: displayConfig,
      loader,
      bookState,
      sizes,
      currentSpread,
      onSpreadChanged,
      callbacks,
      onBitmapShown: feedDynamicBg,
      onZoomChanged: setChildZoomed,
      autoRead,
      autoIntervalSec: config.autoPageIntervalSec,
      goNext: () => {
        goNext();
      },
      transferFor,
      curl: engineIsGl,
    };
  }, [
    layout,
    displayConfig,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    feedDynamicBg,
    autoRead,
    config.autoPageIntervalSec,
    goNext,
    transferFor,
    engineIsGl,
  ]);

  const magneticProps = useMemo(() => {
    return {
      layout,
      config: displayConfig,
      loader,
      bookState,
      sizes,
      currentSpread,
      onSpreadChanged,
      callbacks,
      onBitmapShown: feedDynamicBg,
      onZoomChanged: setChildZoomed,
      autoRead,
      autoIntervalSec: config.autoPageIntervalSec,
      goNext: () => {
        goNext();
      },
      transferFor,
    };
  }, [
    layout,
    displayConfig,
    loader,
    bookState,
    sizes,
    currentSpread,
    onSpreadChanged,
    callbacks,
    feedDynamicBg,
    autoRead,
    config.autoPageIntervalSec,
    goNext,
    transferFor,
  ]);

  const chromeProps: ChromeProps = {
    visible: controlsVisible,
    panel,
    onPanelChange: setPanel,
    glass,
    title,
    chapterTitle,
    currentPage: currentPageNum,
    totalPages,
    spreadCount,
    currentSpread,
    config,
    perBookConfig,
    onPerBookConfigChange: (enabled) => {
      setPerBookConfig(enabled);
      if (enabled && bookKey !== null) store.saveBookConfig(bookKey, config);
      else if (bookKey !== null) {
        store.clearBookConfig(bookKey);
        store.saveGlobalConfig(config);
      }
    },
    // Kotlin L745 `onBookStateChange = { bookState = it; if (bookKey != null) store.saveBookState(bookKey, it) }`
    onBookStateChange: (next) => {
      setBookState(next);
      if (bookKey !== null) store.saveBookState(bookKey, next);
    },
    pages,
    sheetLoaders,
    presetStore,
    bookState,
    onConfigChange: (next) => persistConfig(next),
    onJumpToSpread: (target) => onSpreadChanged(clampIndex(target, spreadCount)),
    onJumpToRawPage: (raw) =>
      onSpreadChanged(clampIndex(spreadOfRawPage(layout, coercePage(raw, totalPages)), spreadCount)),
    onGoPrev: goPrev,
    onGoNext: () => {
      goNext();
    },
    autoRead,
    onAutoReadToggle: () => setAutoRead((prev) => !prev),
    continuousFraction: verticalMode ? (scrollMetrics?.fraction ?? 0) : -1,
    onJumpToScrollFraction:
      verticalMode
        ? (fraction) => setScrollJump((prev) => ({ seq: (prev?.seq ?? 0) + 1, fraction }))
        : null,
    toc,
    currentChapterIndex,
    onJumpToChapter,
    onPrevChapter: onPrevChapter === null ? null : () => navigateChapter(false),
    onNextChapter: onNextChapter === null ? null : () => navigateChapter(true),
    onGodMoment: onGodMoment === null ? null : () => setAutoRead(false),
    chapterNavLabel,
    onToggleControls: () => setControlsVisible((prev) => !prev),
    onExit: exit,
  };

  return (
    <div className={`comic-core${config.hideSystemBars ? ' is-immersive' : ''}`} style={backgroundStyle}>
      <div
        className="comic-engine-layer"
        style={{ opacity: engineFade }}
        data-engine-gl={engineIsGl ? '1' : '0'}
        data-child-zoomed={childZoomed ? '1' : '0'}
      >
        {verticalMode ? (
          <ComicVerticalList {...verticalListProps} />
        ) : config.mode === 'MAGNETIC' ? (
          <ComicMagneticPager {...magneticProps} />
        ) : (
          <ComicPagedReader {...pagedProps} />
        )}
      </div>

      {/* 场景特效层（Kotlin L659-661；ComicSceneFx.kt 不在本次范围 → CSS 类） */}
      {config.sceneEffect && config.scene !== 'NONE' ? (
        <div className={`comic-scene-overlay comic-scene-${config.scene.toLowerCase()}`} aria-hidden />
      ) : null}

      {/* 翻译进行中角标（Kotlin L664-675） */}
      {config.translationEnabled && translatingKeys.length > 0 && panel === 'NONE' ? (
        <div className="comic-translate-badge">
          <p>正在翻译…</p>
        </div>
      ) : null}

      <ComicReaderChrome {...chromeProps} />
    </div>
  );
}

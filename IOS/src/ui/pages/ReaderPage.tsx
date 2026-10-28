/**
 * ReaderPage.tsx — line-by-line port of Android `ui/ReaderScreen.kt` (5154 lines)
 * plus the helpers it leans on (`ReaderPagination.kt`, `ui/reader/*`).
 *
 * SOURCE MAP — Kotlin line ranges → this file
 *   ReaderScreen.kt 1-246    imports / annotations                    → SKIPPED (no imports in TS; `@OptIn` has no analogue)
 *   ReaderScreen.kt 248-298  fun ReaderScreen signature                → `ReaderPage()`
 *   ReaderScreen.kt 300-402  `remember` state hoists                   → local `useState`（沿用 Kotlin 变量名）
 *   ReaderScreen.kt 405-430  fontFileLauncher (GetContent font/ttf)   → `HiddenFontInput` + `installCustomFontFile`
 *   ReaderScreen.kt 432-488  readerPosterLauncher（开屏海报）           → SKIPPED（属 SplashScreen.kt，不在阅读器职责内）
 *   ReaderScreen.kt 492      currentChapter                           → `chapters[currentChapterIndex] ?? null`
 *   ReaderScreen.kt 494      scrollState                              → `<ScrollReader>` DOM 滚动容器
 *   ReaderScreen.kt 498-520  自动滚屏引擎                                → `useAutoScroll`
 *   ReaderScreen.kt 524-556  overscroll / chapter-entry state          → `useBoundaryPull` + CSS class
 *   ReaderScreen.kt 560-610  triggerSwitch（拉穿 130px / tween 110）      → `switchChapter` + `rd-scroll-inner--switching`
 *   ReaderScreen.kt 614-682  弹簧归零 / 新章节入场动画                    → `rd-scroll-inner--spring` / `rd-chapter-entry`
 *   ReaderScreen.kt 686-710  keepScreenOn                             → useEffect + `platform.screenAwake`（E52/E66 已接，2026-10-07）
 *   ReaderScreen.kt 709-726  沉浸式隐藏状态栏                            → useEffect + `platform.statusBars`（E62 已接，2026-10-07）
 *   ReaderScreen.kt 729-756  ReadingTimerEffect + 休息提醒               → `useReadingTimer`
 *   ReaderScreen.kt 760-845  进度恢复 / 4 条保存路径                     → `useReaderProgress` 内联的四个 effect
 *   ReaderScreen.kt 851-869  退出兜底保存                               → `useReaderProgress`（cleanup 分支）
 *   ReaderScreen.kt 873-901  toggleBookmark                           → `toggleBookmark`
 *   ReaderScreen.kt 904-948  switchPageMode                           → `switchPageMode`（`modeSwitchAnchor`）
 *   ReaderScreen.kt 952-968  readerTheme → (bgColor, textColor)       → `readerThemeColors`（readerScreenLogic.ts）
 *   ReaderScreen.kt 972-988  customTypeface / AppFonts                 → `readingFontFamilyCss`
 *   ReaderScreen.kt 992-1057 formattedContent / scrollChunks / ready  → `useMemo`（`formatForReader` / `chunkForScroll`）
 *   ReaderScreen.kt 1061-1089 模式切换锚定                             → `useEffect` × 2
 *   ReaderScreen.kt 1093-1138 共享封面转场                            → `ReaderCoverLayer`（CSS 420/480/380ms，残留 0.06）
 *   ReaderScreen.kt 1142-1216 Box + AsyncImage 共享封面                → `ReaderCoverLayer`
 *   ReaderScreen.kt 1218-1301 BoxWithConstraints + WindowInsets       → `useElementSize` + `useSafeInsets`
 *   ReaderScreen.kt 1298-1322 bodyTextStyle / titleStyle              → 内联样式 + `READER_TITLE_*` 令牌
 *   ReaderScreen.kt 1324-1350 textWidth/Height + titleReserve          → `measureTitleReservePx`
 *   ReaderScreen.kt 1354-1368 rememberChapterPages（当前章）           → `useChapterPages`
 *   ReaderScreen.kt 1372-1491 前后章分页与槽位                          → `useChapterPages` × 2 + `PageTurnHost`
 *   ReaderScreen.kt 1495-1529 activeSubPageIndex + 重锚定              → `pageIndexForOffset` + 重锚定 effect
 *   ReaderScreen.kt 1533-1549 updateSubPage                           → `updateSubPage`
 *   ReaderScreen.kt 1551-1658 滚动模式搜索跳转                         → 搜索跳转 effect 的 `scrollMode` 分支
 *   ReaderScreen.kt 1660-1677 相邻页插图预热                           → 预热 effect
 *   ReaderScreen.kt 1679-1714 翻页模式搜索跳转 + 高亮                  → 搜索跳转 effect 的翻页分支
 *   ReaderScreen.kt 1716-1728 离开目标页清除高亮                       → `shouldClearSearchHighlight`
 *   ReaderScreen.kt 1732-1773 handleNextPage                          → `handleNextPage`
 *   ReaderScreen.kt 1777-1809 handlePrevPage                          → `handlePrevPage`
 *   ReaderScreen.kt 1813-1821 readerLoadError                         → `LoadErrorState`（`章节加载失败：…` / `重试加载`）
 *   ReaderScreen.kt 1823-1832 加载指示器                               → `ReaderLoading`
 *   ReaderScreen.kt 1834-1854 UNSUPPORTED_CHAPTER_TITLE               → `UnsupportedChapterState`
 *   ReaderScreen.kt 1856-1859 本章暂无正文                              → `EmptyChapterState`
 *   ReaderScreen.kt 1864-1880 safeDrawingPadding Column               → CSS `padding-top/bottom: var(--safe-top/--safe-bottom)`
 *   ReaderScreen.kt 1884-1912 常驻占位版页眉                            → `ReaderOverlayHeader`
 *   ReaderScreen.kt 1916-1934 page container + onSizeChanged           → `useElementSize`
 *   ReaderScreen.kt 1940-2216 滚动档 currentSlot                       → `ScrollChapter` / `ScrollBlockSequence`
 *   ReaderScreen.kt 2218-2258 当前页 RenderSinglePage                 → `SinglePage`
 *   ReaderScreen.kt 2264-2377 下一页 RenderSinglePage（3 分支）          → `SinglePage`
 *   ReaderScreen.kt 2381-2496 上一页 RenderSinglePage（3 分支）          → `SinglePage`
 *   ReaderScreen.kt 2500-2549 PageCurlReaderContainer                 → `PageTurnHost`（`mode === 0` 分派给
 *                                                                        `@ui/components/pageturn/PageCurlReaderContainer`）
 *   ReaderScreen.kt 2551-2601 PageTurnContainer                       → `PageTurnHost`（其余档位分派给
 *                                                                        `@ui/components/pageturn/PageTurnContainer`）
 *   ReaderScreen.kt 2606-2637 PageScrubberOverlay                    → `@ui/components/pageturn/PageScrubberOverlay`（`PageScrubber.kt` 逐行移植）
 *   ReaderScreen.kt 4956-5002 RenderSinglePage 的图片块尺寸           → `PageBlock`（`block.heightPx` 来自
 *                                                                        `novelInlineImages.displaySize`，Kotlin 无二次 clamp）
 *   ReaderScreen.kt 4019 自定义字体未导入时的预览字族                  → `TypographySheet` 的 `NOTO_SANS_SC`（`AppFonts.Default`）
 *
 * REVIEW-2026-10-06（本轮逐行审查的改动，逐条对应 Kotlin）
 *   ① 删掉本文件自带的 `PageTurnHost` 手写翻页层（`PageLayer` / `pageLayerClass` /
 *      `rd-layer` CSS），改用 `ui/components/pageturn/*` 里已逐行移植好的容器，按
 *      ReaderScreen.kt:2500 的 `if (!isScrollMode && mode == SIMULATE) PageCurlReaderContainer
 *      else PageTurnContainer` 分派。理由：旧实现的 COVER 档把 current/prev 套同一个
 *      `translateX(p·100%)`（Kotlin 是 current=`p*0.15f`、prev=`p - widthPx`），
 *      SIMULATE 档没有 pagecurl 三页窗口，FADE 档同时点亮 next 与 prev。
 *   ② 删掉本文件自带的"快速翻页"紧凑 DOM 改写（横向页条 + scroll-snap），
 *      改用 `PageScrubber.kt` 的串珠环移植。原注释说"PageScrubber.kt 不在本模块范围"
 *      但 `PARITY_EXCEPTIONS.md` 无对应条目 —— 未登记的砍功能。
 *   ③ `pageBlocks` 不再二次扫描 `[IMG:]` 正则：Kotlin `InlineBlock.Image` 自带
 *      `path` / `widthPx` / `heightPx`，补齐后直接取用。
 *   ④ 图片块高度改为直接用 `block.heightPx`（Kotlin `height(block.heightPx.toDp())`），
 *      去掉 TS 侧多出来的 `max(1, min(h, maxImageHeightPx))` 二次 clamp。
 *   ⑤ 自定义字体未导入时预览字族 `MONOSPACE` → `NOTO_SANS_SC`（`AppFonts.Default`）。
 *   ⑥ 相邻页预热改用 `readerScreenLogic.prewarmImagePathsForPages`（删掉本地重复实现）。
 *   ⑦ 引入 `styles/pageturn.css`（此前 `src/ui/components/pageturn/*` 的样式从未被引用）。
 *   ⑧ 删除 EXTRA：`handleNextPage` / `handlePrevPage` 里的 `getPageFlipSound().play()`。
 *      Android 全仓仅 `ui/pageturn/PageScrubber.kt:97` 播 `R.raw.page_flip`（串珠遮罩用），
 *      普通翻页无声。串珠遮罩改用 `PageScrubberOverlay` 的 `pageFlipSoundUrl` 端口后，
 *      翻纸声回到它应在的位置。
 *
 *   未修（已登记为 E58，见报告）：ReaderScreen.kt:740 `onRecordTime(seconds)` 在本文件里
 *   是空实现（`onFlush: (seconds) => { void seconds; }`）—— 30 秒计时没有落库。
 *   修复需要实例化 `core/app/mainViewModel.ts` 的 `MainViewModel`，而该类当前没有任何
 *   地方 `new`，属于 app/statistics 模块的接线范围，超出本模块授权。
 *
 *   等价说明（未改）：
 *   - Kotlin 滚动档也把 `PageTurnContainer` 套在滚动内容外层（其 pointerInput 对 SCROLL
 *     直接 `return`）。TS 直接渲染滚动容器，省掉一层无行为的包装 —— COSMETIC。
 *   - `ReaderScreen.kt:1615-1632` 的"最多让出 6 帧"用 rAF 计数复现 —— COSMETIC。
 *   - `ReaderScreen.kt:1718-1728` 的 1500ms 保护期，TS 用 `setTimeout(max(0, 1500-elapsed)+16)`
 *     后再判定 —— COSMETIC（判定条件本身在 `shouldClearSearchHighlight` 中逐字对齐）。
 *   - `ReadingTimerEffect.kt:117` 的"屏幕亮着"闸门在 web 端换成
 *     `platform.appLifecycle`（E67，2026-10-08）；原生走 `@capacitor/app` 的
 *     `appStateChange`（UIApplication willResignActive/didBecomeActive），
 *     覆盖 `document.visibilityState` 覆盖不到的控制中心下拉/来电/锁屏等原生前后台切换。
 *   ReaderScreen.kt 2641-2764 越界切章提示 chip                        → `PullSwitchChip`
 *   ReaderScreen.kt 2766-2788 书签吊坠                                → `BookmarkRibbon`（4614-4696 的 SVG 化）
 *   ReaderScreen.kt 2794-2832 常驻占位版页脚                            → `ReaderOverlayFooter`
 *   ReaderScreen.kt 2836-2963 TTS 播放条                               → `TtsBar` + `PlatformTtsController`
 *   ReaderScreen.kt 2965-3006 返回上次处 chip                          → `ReturnChip`
 *   ReaderScreen.kt 3016-3066 自动滚屏指示器                            → `AutoScrollPill`
 *   ReaderScreen.kt 3070-3119 回到顶部                                  → `BackToTopButton`
 *   ReaderScreen.kt 3122-3144 亮度遮罩                                  → `<div className="rd-dim">`
 *   ReaderScreen.kt 3148-3186 菜单遮罩                                  → `<button className="rd-scrim">`
 *   ReaderScreen.kt 3190-3393 顶栏 + 更多菜单                            → `ReaderTopBar`
 *   ReaderScreen.kt 3399-3654 底栏 + FluidSlider × 3                   → `ReaderBottomBar` + `ReaderFluidSlider`
 *   ReaderScreen.kt 3668-3799 目录面板                                  → `TocSheet`
 *   ReaderScreen.kt 3803-4163 阅读排版面板                               → `TypographySheet`
 *   ReaderScreen.kt 4167-4310 全文搜索对话框                             → `SearchDialog`
 *   ReaderScreen.kt 4314-4402 书签记录面板                              → `AnnotationsSheet`
 *   ReaderScreen.kt 4406-4534 定时休息提醒                               → `RestDialog`
 *   ReaderScreen.kt 4538-4608 Ciallo～(∠・ω< )⌒★                        → `EasterEggOverlay`（`MascotAnimationController` 的 DOM 替身）
 *   ReaderScreen.kt 4614-4696 BookmarkHangingRibbon Canvas             → `BookmarkRibbon` SVG
 *   ReaderScreen.kt 4702-4720 formatForReader                         → readerScreenLogic.ts
 *   ReaderScreen.kt 4724-4762 chunkForScroll                          → readerScreenLogic.ts
 *   ReaderScreen.kt 4766-4834 measureTitleReservePx                   → readerScreenLogic.ts
 *   ReaderScreen.kt 4838-5009 RenderSinglePage                        → `SinglePage`
 *   ReaderScreen.kt 5011-5064 ReaderThemePreview(Card)                 → READER_THEME_PREVIEWS + `ThemePreviewCard`
 *   ReaderScreen.kt 5066-5110 ReaderPageModeChip                       → `PageModeChip`
 *   ReaderScreen.kt 5112-5154 ReaderFontOptionRow                      → `FontOptionRow`
 *   ReaderPagination.kt 40-388（整文件）                               → core/reader/readerPagination.ts
 *   reader/NovelInlineImages.kt 41-288 token/block/registry           → core/reader/novelInlineImages.ts + `ImageHitRegistry` + `InlineImageDecoder`
 *   reader/NovelInlineImages.kt 293-331 NovelInlineImage              → `InlineImage`
 *   reader/NovelInlineImages.kt 339-406 buildAnnotatedWithImages      → SKIPPED（块驱动渲染取代 AnnotatedString + InlineTextContent，见内注释）
 *   reader/NovelImageFullscreen.kt 46-172 NovelImageFullscreenViewer → `ImageFullscreenViewer`
 *   reader/NovelImageFullscreen.kt 174-204 saveNovelImageToGallery   → `saveNovelImage`（`图片读取失败` / `保存失败` / `已保存到相册 Pictures/Ciallo Reader`）
 *
 * ADAPTATIONS（core 层的清单见 readerScreenLogic.ts 文件头；此处为 UI 层）
 *   - Compose Canvas / 书本页绘制 → DOM + CSS 3D transform + 一枚 SVG 吊坠。
 *   - `HorizontalPager`（pageturn 模块，不在本模块范围）→ 三层绝对定位页面 + CSS
 *     transition；四种档位差异用 transform/opacity 表达。手势数学
 *     （touchSlop、`screenWidth * 0.15f` 阈值、0.35/0.65 点击区、
 *     `tween(180)`、先 `-0.05w tween(60)` 轻推、下拉书签 0.5 阻尼 clamp 160px /
 *     80px 触发、静置 1s 唤出串珠翻页）逐值移植。
 *   - `detectTransformGestures`（捏合）→ Pointer Events + `setPointerCapture`
 *     + 多指针 `Map<pointerId, Point>`。
 *   - Coil `AsyncImage` → `<img>` + 注入的 `InlineImageDecoder` 端口。
 *   - `BitmapFactory` 采样 → 只声明端口（浏览器负责解码）。
 *   - TTS → 注入的 `ReaderTtsController` 端口，默认实现基于
 *     `@platform` `TtsEngine`（`CapacitorTtsEngine` / `MockTtsEngine`）。
 *   - Room `Flow` → 异步 getter + `ListenerRegistry`。
 *   - `prefs: PreferencesManager`（SharedPreferences）→ `SettingsRepository`
 *     的原始键（键名与 SharedPreferences 一致），写入 300ms 防抖。
 *   - `searchResults` / `isSearching` ViewModel 流 → 本地 state +
 *     `BookRepository.searchChapters` + `SearchLocator.buildResults`。
 *   - `LaunchedEffect` → `useEffect`；所有 effect 都通过回调（setTimeout /
 *     Promise / rAF / observer / 订阅）发布状态，因为 `react-hooks/set-state-in-effect`
 *     禁止在 effect body 里同步 setState。
 *   - `UUID.randomUUID()`（4963）→ `useId()`。
 *   - `System.currentTimeMillis()`（1708）→ 仅在事件 / 定时器回调里 `Date.now()`。
 *   - 自定义字体：Android 落盘 `custom_font.ttf` + `Typeface.createFromFile`；
 *     web 用 `FontFace` + blob URL，仅会话内有效（对象 URL 不可持久化）。
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { splitIntoBlocks, stripTokens, type InlineBlock } from '@core/reader/novelInlineImages';
import {
  cachedChapterPages,
  loadChapterPages,
  paginationCacheKeyFor,
  shouldCelebrateAfterForwardTurn,
  type ChapterPaginationRequest,
  type MeasureLines,
} from '@core/reader/readerPagination';
import {
  AUTO_SCROLL_FRAME_MS,
  AUTO_SCROLL_STEP_PX,
  CHAPTER_ENTRY_PULL_DP,
  CUSTOM_FONT_INDEX,
  ImageHitRegistry,
  DEFAULT_READER_PREFS,
  DIM_ALPHA_SCALE,
  NOTO_SANS_SC,
  OVERSCROLL_FOLLOW,
  PAGE_TURN_SIMULATE,
  PAGE_TURN_TYPES,
  PAGE_TEXT_BOTTOM_PADDING_DP,
  PAGE_VERTICAL_PADDING_DP,
  READING_FLUSH_SECONDS,
  READING_FONT_FAMILIES,
  READER_THEME_PREVIEWS,
  READER_TITLE_FONT_SIZE_PX,
  READER_TITLE_LINE_HEIGHT_PX,
  RETURN_CHIP_AUTO_HIDE_MS,
  SCROLL_SAVE_DEBOUNCE_MS,
  SCROLL_THRESHOLD_DP,
  SEARCH_HIGHLIGHT_KEEP_MS,
  SWITCH_PULL_MS,
  TRANSITION_DELAY_MS,
  bookmarkSnippet,
  brightnessFromSlider,
  brightnessToSlider,
  chapterSwitchTarget,
  chunkForScroll,
  clampSubPageIndex,
  findPageForPosition,
  findScrollBlockTarget,
  formatClockHHmm,
  formatForReader,
  isScrollMode,
  lineHeightFromSlider,
  lineHeightToSlider,
  marginFromSlider,
  marginToSlider,
  measureTitleReservePx,
  modeSwitchAnchor,
  nextReaderLocation,
  onColor,
  pageIndexForOffset,
  pageTurnChipLabel,
  prewarmImagePathsForPages,
  prevReaderLocation,
  pullHintText,
  pullProgress,
  readerPercent,
  readerProgressFooterText,
  readerThemeColors,
  readingFontFamilyCss,
  readingFontName,
  resolveReaderProgress,
  scrollTargetForRatio,
  shouldClearSearchHighlight,
  shouldShowBackToTop,
  shouldShowRestReminder,
  splitByHighlights,
  stepFontSizeDown,
  stepFontSizeUp,
  subPageState,
  withAlpha,
  type InlineImageDecoder,
  type ReaderPrefs,
  type ReaderProgressInput,
  type ReaderTtsController,
  type ReadingSessionLike,
} from '@core/reader/readerScreenLogic';
import { UNSUPPORTED_CHAPTER_TITLE, type Bookmark, type ChapterRow } from '@core/library/bookTypes';
import { SearchLocator, type SearchResultItem } from '@core/data/searchLocator';
import { splitChapterText } from '@core/data/splitChapterText';
import { createSettingsRepository, type SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';
// E63 / E20：TTS 锁屏控制（`navigator.mediaSession`）+ 切后台即暂停。
import { createTtsMediaHost } from '@platform/web/ttsMediaSession';
// E6：Compose 排版的等价实现（canvas measureText + Intl.Segmenter + CJK 禁则）。
import { createCanvasMeasureLines } from '@platform/web/webTextLayout';
import type { TtsEngine } from '@platform/interfaces';
import { showToast } from '@ui/toast';
import { scrollElementIntoView, scrollElementTo } from '@ui/lib/scroll';
import { getBookRepository, useAppStore } from '@ui/state/appStore';
import { PageTurnContainer } from '@ui/components/pageturn/PageTurnContainer';
import { PageCurlReaderContainer } from '@ui/components/pageturn/PageCurlReaderContainer';
import { PageScrubberOverlay } from '@ui/components/pageturn/PageScrubber';
import '../../styles/reader.css';
import '../../styles/pageturn.css';

/**
 * 把 caught 值压成一行可读原因，供 `console.warn` 使用。
 *
 * 为什么不要直接把 `error` 传给 console：下面三处端口 catch 都跑在
 * **每次挂载** 的 effect 里，把 Error 对象丢进 console 会连带打出完整堆栈
 * （jsdom 下路径还特别长），测试日志里一次挂载刷 5 行、25 个用例刷 125 行，
 * 真正的失败信息反而被埋掉。`message` 里保留了 `WAKE_LOCK_UNAVAILABLE` /
 * `STATUS_BAR_UNAVAILABLE` 这类可搜索关键字，排障能力不受影响。
 *
 * 未知 thrown 值（非 Error）按 String() 兜底，不做 instanceof 之外的花活。
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ═════════════════════════════════════════════════════════════════════════════
// Module constants（渲染期绝不新建随机 / 时钟对象 —— React 纯性规则）
// ═════════════════════════════════════════════════════════════════════════════

/** ReaderScreen.kt:1258-1278 — fallback 容器尺寸下限 `.coerceAtLeast(100)`. */
const MIN_CONTAINER_PX = 100;

/** ReaderScreen.kt:1262-1270 — 页眉 / 页脚基础 24dp + 常驻占位时 48dp. */
const HEADER_FOOTER_PAD_DP = 24;
const HEADER_FOOTER_EXTRA_DP = 48;

/** ReaderScreen.kt:1642 — 搜索跳转等待目标块组合的最大帧数. */
const SEARCH_JUMP_FRAME_TRIES = 6;

/** TtsManager.kt:58 — `TextToSpeech.getMaxSpeechInputLength() - 1`. */
const MAX_SPEECH_INPUT_LENGTH = 4000;

/** TtsManager.kt:63-64 — 语速 / 音高 clamp 区间. */
const TTS_RATE_MIN = 0.25;
const TTS_RATE_MAX = 4;

/** Android `viewConfiguration.touchSlop`（≈8dp）—— 拖拽判定阈值. */
const TOUCH_SLOP_PX = 8;

/**
 * REVIEW-2026-10-06：`LONG_PRESS_MS = 1000`（PageTurnContainer.kt:161-163）已随
 * 宿主层的 `PageTurnHost` DOM 重写一起删除 —— 静置 1s 唤出串珠翻页的计时现在由
 * `ui/components/pageturn/PageTurnContainer` 与 `PageCurlReaderContainer` 各自持有，
 * 与 Kotlin 的 `longPressDeadline` 同一来源。
 */

/** ReaderScreen.kt:3488 / 3504 — 拖动条气泡取值. */
const EMPTY_PAGES: string[] = [];

/** Prefs 写入防抖（SharedPreferences.apply 本身即异步写入）. */
const PREFS_WRITE_DEBOUNCE_MS = 300;

/** MintPrimary（Color.kt:9-11 → MaterialTheme.colorScheme.primary）. */
const MINT_PRIMARY = '#059669';

/** MintGold（Color.kt:17）. */
const MINT_GOLD = '#E8C97A';

/**
 * PageScrubber.kt:97 — `soundPool.load(context, R.raw.page_flip, 1)` 的 web 替身。
 * 与 `core/audio/pageFlipSound` 共用同一份素材（Android 侧是 `res/raw/page_flip.ogg`，
 * 本项目打包为 m4a），音量 0.8 / 单流与 SoundPool 的 `play(soundId, 0.8f, 0.8f, 1, 0, 1f)` 对齐。
 */
const PAGE_FLIP_SOUND_URL = '/audio/page_flip.m4a';

// ═════════════════════════════════════════════════════════════════════════════
// Injected ports + default adapters
// ═════════════════════════════════════════════════════════════════════════════

let epzipImageResolver: ((spec: string) => string | null) | null = null;

/** 平台层注册 `epzip:` 引用解包器（NovelInlineImages.kt:92-129 的 iOS 对应物）. */
export function registerEpzipImageResolver(
  resolver: ((spec: string) => string | null) | null,
): void {
  epzipImageResolver = resolver;
}

/**
 * ADAPTATION of `BitmapFactory.decodeSampled` / `decodeSampledFromEpub`
 * （NovelInlineImages.kt:87-140）：采样与缓存交给浏览器，decoder 只把
 * `epzip:` 引用翻成可显示 URL。
 */
const browserInlineImageDecoder: InlineImageDecoder = {
  resolve(path: string): Promise<string | null> {
    if (path.startsWith('epzip:')) {
      return Promise.resolve(epzipImageResolver === null ? null : epzipImageResolver(path));
    }
    return Promise.resolve(path);
  },
  prewarm(paths: ReadonlyArray<string>): void {
    for (const path of paths) {
      if (path.length === 0) continue;
      void browserInlineImageDecoder.resolve(path);
    }
  },
};

let inlineImageDecoder: InlineImageDecoder = browserInlineImageDecoder;

/** PORT 注入点：平台层可覆盖插图解析（例如 `file://` → Capacitor convertFileSrc）。 */
export function setInlineImageDecoder(decoder: InlineImageDecoder): void {
  inlineImageDecoder = decoder;
}

/**
 * ADAPTATION of `TtsManager`（TtsManager.kt:14-108）：
 * `TextToSpeech` → `@platform` `TtsEngine`；`StateFlow<Boolean>` →
 * `getPlaying()` 异步 getter + `subscribePlaying()` 监听器注册表。
 * 段落切分、`(0.25f, 4f)` 语速 / 音高 clamp、上一段 / 下一段语义逐条保留。
 */
class PlatformTtsController implements ReaderTtsController {
  private engine: TtsEngine | null = null;

  private chunkIndex = 0;

  private chunks: Array<[number, string]> = [];

  private currentParagraphIndex = 0;

  private playing = false;

  private speed = 1;

  private pitch = 1;

  private readonly listeners = new Set<(playing: boolean) => void>();

  /**
   * E63 / E20：锁屏控制 + 后台暂停。
   *
   * Kotlin `TtsPlaybackService`（43 行）只是一个前台通知壳，真正的状态机在
   * `TtsManager.kt`（音频焦点请求/放弃、LOSS → pause、`generation` 防竞态）。
   * Web 侧对应物：
   *   - 前台通知 / `startForeground` → `navigator.mediaSession`（WKWebView 原生支持，
   *     会出现在 iOS 锁屏与控制中心）；
   *   - `AUDIOFOCUS_LOSS_TRANSIENT → pause()` → `visibilitychange` 切后台即暂停。
   * 详见 `platform/web/ttsMediaSession.ts` 头注的能力对照表。
   */
  private readonly media = createTtsMediaHost(() => {
    // 后台/离开页面 → 暂停朗读（对齐 Kotlin L30）。
    this.pause();
  });

  /** 锁屏界面要显示的书名与当前段文本。 */
  private mediaTitle = '';

  private mediaAlbum = '';

  private loadEngine(): TtsEngine | null {
    if (this.engine === null) {
      try {
        this.engine = getPlatform().tts;
      } catch {
        this.engine = null;
      }
    }
    return this.engine;
  }

  getPlaying(): Promise<boolean> {
    return Promise.resolve(this.playing);
  }

  /** UI 按钮需要同步快照（Android 的 `_isPlaying.value`）. */
  getPlayingSafe(): boolean {
    return this.playing;
  }

  subscribePlaying(listener: (playing: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.playing);
  }

  private clampRate(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(value, TTS_RATE_MIN), TTS_RATE_MAX);
  }

  async startReading(text: string, options: { speed: number; pitch: number }): Promise<void> {
    this.pauseInternal();
    const max = MAX_SPEECH_INPUT_LENGTH - 1;
    // TtsManager.kt:59-61 — 去 `[IMG:…]`、按行切段、按语音输入上限再切
    const stripped = text.replace(/\[IMG:[^\]]*]/g, '');
    const chunks: Array<[number, string]> = [];
    stripped
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .forEach((line, paragraph) => {
        for (const piece of splitChapterText(line, max)) chunks.push([paragraph, piece]);
      });
    this.chunks = chunks;
    this.chunkIndex = 0;
    this.speed = this.clampRate(options.speed);
    this.pitch = this.clampRate(options.pitch);
    if (chunks.length === 0) {
      this.pauseInternal();
      return;
    }
    await this.begin();
  }

  private async begin(): Promise<void> {
    this.playing = true;
    this.emit();
    // E63：向锁屏界面同步播放状态与当前段信息。
    this.media.setPlaying(true);
    this.media.setMetadata({
      title: this.mediaTitle,
      artist: this.chunks[this.chunkIndex]?.[1] ?? '',
      album: this.mediaAlbum,
    });
    const engine = this.loadEngine();
    if (engine === null) {
      this.pauseInternal();
      return;
    }
    const chunk = this.chunks[this.chunkIndex];
    if (chunk === undefined) {
      this.pauseInternal();
      return;
    }
    this.currentParagraphIndex = chunk[0];
    try {
      await engine.speak(chunk[1], { rate: this.speed, pitch: this.pitch });
    } catch {
      this.pauseInternal();
    }
  }

  /**
   * E63：设置锁屏界面显示的书名 / 章节名。
   * Kotlin 侧这两个值由 `LibraryScreen` 在起播时传给 `TtsManager`，
   * 最终进 `NotificationCompat` 的 `setContentTitle` / `setSubText`。
   */
  setMediaInfo(title: string, album: string): void {
    this.mediaTitle = title;
    this.mediaAlbum = album;
  }

  /**
   * E63：锁屏控制按钮。Android 侧这些 action 由 `MediaSession.Callback` 分发回
   * `TtsManager` 的 `toggle()` / `next()` / `prev()`，本侧等价。
   */
  installMediaHandlers(): void {
    this.media.setHandlers({
      // Android 侧没有「从暂停恢复」的单独特令：`MediaSession` 的 play/pause
      // 回到 `TtsManager.toggle()`，即「未播则从头播，已播则暂停」。
      // 本实现的等价语义是「未播 → 重新起播当前段；已播 → 暂停」。
      onPlay: () => {
        if (!this.playing) void this.begin();
      },
      onPause: () => {
        void this.pause();
      },
      onStop: () => {
        this.stop();
      },
      onNext: () => {
        void this.nextParagraph();
      },
      onPrevious: () => {
        void this.previousParagraph();
      },
    });
  }

  private pauseInternal(): void {
    this.playing = false;
    this.emit();
    // E63：同步锁屏界面的播放状态（等价 Kotlin `_isPlaying.value = false`）。
    this.media.setPlaying(false);
    const engine = this.engine;
    if (engine !== null) void engine.stop().catch(() => undefined);
  }

  async pause(): Promise<void> {
    this.pauseInternal();
  }

  async nextParagraph(): Promise<void> {
    const target = this.chunks.findIndex((chunk) => chunk[0] > this.currentParagraphIndex);
    if (target < 0) return;
    this.chunkIndex = target;
    this.playing = false;
    await this.begin();
  }

  async previousParagraph(): Promise<void> {
    const paragraph = Math.max(this.currentParagraphIndex - 1, 0);
    const target = this.chunks.findIndex((chunk) => chunk[0] === paragraph);
    if (target < 0) return;
    this.chunkIndex = target;
    this.playing = false;
    await this.begin();
  }

  stop(): void {
    this.pauseInternal();
  }
}

const platformTtsController = new PlatformTtsController();

/** NovelInlineImages.kt:167-224 — 插图屏幕矩形注册表（窗口坐标）. */
const imageHitRegistry = new ImageHitRegistry();

// ═════════════════════════════════════════════════════════════════════════════
// Preferences plumbing（PreferencesManager ↔ appStore）
// ═════════════════════════════════════════════════════════════════════════════

let prefsRepo: SettingsRepository | null = null;

function getPrefsRepo(): SettingsRepository | null {
  if (prefsRepo === null) {
    try {
      prefsRepo = createSettingsRepository(getPlatform().db);
    } catch {
      prefsRepo = null;
    }
  }
  return prefsRepo;
}

/**
 * PreferencesManager.kt:15-126 — 阅读器读写的全部设置项。
 * ADAPTATION: 直接走 `SettingsRepository` 的原始键（`PreferencesManager` 包装类只
 * 暴露了少数 setter），键名与 `SETTING_SPECS` / SharedPreferences 完全一致。
 */
async function loadReaderPrefs(repo: SettingsRepository): Promise<Partial<ReaderPrefs>> {
  const [
    fontSize,
    lineHeight,
    marginHorizontal,
    firstLineIndent,
    readerTheme,
    fontFamilyIndex,
    pageTurnMode,
    readerBrightness,
    showOverlayHeaderFooter,
    keepScreenOn,
    restReminderMinutes,
    ttsSpeed,
    ttsPitch,
    customFontPath,
  ] = await Promise.all([
    repo.getFloat('font_size'),
    repo.getFloat('line_height'),
    repo.getInt('margin_horizontal'),
    repo.getBoolean('first_line_indent'),
    repo.getInt('reader_theme'),
    repo.getInt('font_family_index'),
    repo.getInt('page_turn_mode'),
    repo.getFloat('reader_brightness'),
    repo.getBoolean('show_overlay_header_footer'),
    repo.getBoolean('keep_screen_on'),
    repo.getInt('rest_reminder_minutes'),
    repo.getFloat('tts_speed'),
    repo.getFloat('tts_pitch'),
    repo.getString('custom_font_path'),
  ]);
  return {
    fontSize,
    lineHeight,
    marginHorizontal,
    firstLineIndent,
    readerTheme,
    fontFamilyIndex,
    pageTurnMode,
    // PreferencesManager.kt:220 — readerBrightness 读取 clamp 到 (0.2, 1.0)
    readerBrightness: Math.min(Math.max(readerBrightness, 0.2), 1),
    showOverlayHeaderFooter,
    keepScreenOn,
    restReminderMinutes,
    ttsSpeed,
    ttsPitch,
    customFontPath,
  };
}

async function persistReaderPrefs(patch: Partial<ReaderPrefs>): Promise<void> {
  const repo = getPrefsRepo();
  if (repo === null) return;
  const writes: Array<Promise<void>> = [];
  if (patch.fontSize !== undefined) writes.push(repo.setFloat('font_size', patch.fontSize));
  if (patch.lineHeight !== undefined) writes.push(repo.setFloat('line_height', patch.lineHeight));
  if (patch.marginHorizontal !== undefined) {
    writes.push(repo.setInt('margin_horizontal', patch.marginHorizontal));
  }
  if (patch.firstLineIndent !== undefined) {
    writes.push(repo.setBoolean('first_line_indent', patch.firstLineIndent));
  }
  if (patch.readerTheme !== undefined) writes.push(repo.setInt('reader_theme', patch.readerTheme));
  if (patch.fontFamilyIndex !== undefined) {
    writes.push(repo.setInt('font_family_index', patch.fontFamilyIndex));
  }
  if (patch.pageTurnMode !== undefined) writes.push(repo.setInt('page_turn_mode', patch.pageTurnMode));
  if (patch.readerBrightness !== undefined) {
    // PreferencesManager.kt:221 — 写入时 clamp 到 (0.2f, 1.0f)
    writes.push(
      repo.setFloat('reader_brightness', Math.min(Math.max(patch.readerBrightness, 0.2), 1)),
    );
  }
  if (patch.customFontPath !== undefined) {
    writes.push(repo.setString('custom_font_path', patch.customFontPath));
  }
  await Promise.all(writes);
}

// ═════════════════════════════════════════════════════════════════════════════
// Small hooks
// ═════════════════════════════════════════════════════════════════════════════

interface Size {
  width: number;
  height: number;
}

const EMPTY_SIZE: Size = { width: 0, height: 0 };

interface Insets {
  top: number;
  bottom: number;
}

interface Viewport {
  width: number;
  height: number;
}

/** 替代 `Modifier.onSizeChanged`（ReaderScreen.kt:1924-1932）. */
function useElementRef<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  return ref;
}

/**
 * ADAPTATION: ref 与 size 拆成两个 hook —— 返回值里混装 `RefObject` 会让
 * `react-hooks/refs` 把整条读取链判成「渲染期读 ref」。
 */
function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): Size {
  const [size, setSize] = useState<Size>(EMPTY_SIZE);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const apply = (): void => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * ADAPTATION of `WindowInsets.displayCutout / statusBars / navigationBars`
 * （ReaderScreen.kt:1242-1254）：web 端由 CSS `env(safe-area-inset-*)` 承担
 * `maxOf(系统栏, 挖孔)`，这里只把令牌读成数值。
 */
function useSafeInsets(): Insets {
  const [insets, setInsets] = useState<Insets>({ top: 0, bottom: 0 });
  useEffect(() => {
    const apply = (): void => {
      const styles = getComputedStyle(document.documentElement);
      const top = Number.parseFloat(styles.getPropertyValue('--safe-top'));
      const bottom = Number.parseFloat(styles.getPropertyValue('--safe-bottom'));
      setInsets({
        top: Number.isFinite(top) ? top : 0,
        bottom: Number.isFinite(bottom) ? bottom : 0,
      });
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
  return insets;
}

/** ReaderScreen.kt:1258-1278 fallback 分支用的窗口尺寸. */
function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const apply = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight });
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
  return viewport;
}

/** ReaderPagination.kt:97-170 `rememberChapterPages` 的 Hook 形态. */
function useChapterPages(request: ChapterPaginationRequest): string[] {
  const key = paginationCacheKeyFor(request);
  const [state, setState] = useState<{ key: string; pages: string[] }>(() => ({
    key,
    pages: cachedChapterPages(request),
  }));

  /**
   * E6：真实排版测量器（等价 Kotlin 的 `android.text.Paragraph`）。
   *
   * `request.fontFamilyKey` 就是 CSS 字体串（`readingFontFamilyCss` 的产物），
   * 直接作为 canvas 的 `font` 简写用。**失败不阻断**：canvas 不可用时
   * 回落到 core 的估算器（与 Kotlin 无 Paragraph 时的降级一致）。
   */
  const canvasMeasure = useMemo<MeasureLines | undefined>(() => {
    if (typeof document === 'undefined') return undefined;
    if (request.fontSizePx <= 0 || request.widthPx <= 0) return undefined;
    try {
      const canvas = document.createElement('canvas');
      return createCanvasMeasureLines(canvas, {
        widthPx: request.widthPx,
        pageHeightPx: request.heightPx,
        firstPageHeightPx: Math.max(request.heightPx - request.titleReservePx, 80),
        fontSizePx: request.fontSizePx,
        lineHeightPx: request.lineHeightPx,
        titleReservePx: request.titleReservePx,
        font: `${String(request.fontSizePx)}px ${request.fontFamilyKey}`,
      });
    } catch {
      return undefined;
    }
  }, [
    request.widthPx,
    request.heightPx,
    request.fontSizePx,
    request.lineHeightPx,
    request.titleReservePx,
    request.fontFamilyKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadChapterPages(
        request,
        (next) => {
          if (cancelled) return;
          setState({ key, pages: next });
        },
        canvasMeasure,
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, request, canvasMeasure]);
  // 键变化（旋转 / 改字号 / 分页重算）时先回落到空页，等异步补齐 —— 与 Kotlin
  // `remember(key){ mutableStateOf(cache ?: emptyList()) }` 同构。
  if (state.key !== key) return EMPTY_PAGES;
  return state.pages;
}

/** 统一「延时后再改状态」的 effect 通道（`react-hooks/set-state-in-effect` 只允许回调里 setState）. */
function useDeferredEffect(
  run: () => void,
  delayMs: number,
  deps: ReadonlyArray<unknown>,
): void {
  const ref = useRef(run);
  useEffect(() => {
    ref.current = run;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      ref.current();
    }, delayMs);
    return () => window.clearTimeout(timer);
    // deps 由调用方显式传入（数组展开无法被静态分析）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps]);
}

/** ReadingTimerEffect.kt:36-127 —— 前台 + 屏幕亮着才累计，每 30 秒 flush. */
function useReadingTimer(args: {
  bookId: number | null;
  bookTitle: string;
  onFlush: (seconds: number) => void;
  onSessionEnd: (session: ReadingSessionLike) => void;
  onRestTick: (elapsedSeconds: number) => void;
}): void {
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  useEffect(() => {
    let active = true;
    let elapsed = 0;
    let lastFlush = 0;
    let sessionStartMs = 0;
    let sessionStartHour = -1;

    const endCurrentSession = (): void => {
      const remaining = elapsed - lastFlush;
      if (remaining > 0) argsRef.current.onFlush(remaining);
      if (sessionStartMs > 0) {
        const start = new Date(sessionStartMs);
        argsRef.current.onSessionEnd({
          bookId: argsRef.current.bookId,
          bookTitle: argsRef.current.bookTitle,
          dateStr: formatDateOnly(start),
          startTimeMs: sessionStartMs,
          endTimeMs: Date.now(),
          durationSeconds: Math.max(elapsed, 1),
          startHour:
            sessionStartHour >= 0 && sessionStartHour <= 23
              ? sessionStartHour
              : new Date().getHours(),
        });
        sessionStartMs = 0;
        sessionStartHour = -1;
      }
      elapsed = 0;
      lastFlush = 0;
    };

    const tick = (): void => {
      if (!active) return;
      if (sessionStartMs === 0) {
        sessionStartMs = Date.now();
        sessionStartHour = new Date().getHours();
      }
      elapsed += 1;
      if (elapsed - lastFlush >= READING_FLUSH_SECONDS) {
        argsRef.current.onFlush(elapsed - lastFlush);
        lastFlush = elapsed;
      }
      argsRef.current.onRestTick(elapsed);
    };

    // Kotlin ReadingTimerEffect.kt:91-107 —— `LifecycleEventObserver` 的
    // ON_START → active = true；ON_STOP → active = false + endCurrentSession()。
    // 原先这里直读 `document.visibilityState`，在 WKWebView 里覆盖不到
    // 「控制中心下拉 / 来电 / 锁屏 / 切走再回来」这类原生前后台切换；
    // 改走 `platform.appLifecycle`（iOS 由 @capacitor/app 的 appStateChange 提供，
    // 接 UIApplication 的 willResignActive / didBecomeActive）——E67。
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        if (disposed) return;
        // 挂载时若已在后台，不能沿用 Kotlin 的 `active = true` 初值（L47）——
        // 那初值的前提是组件在 ON_START 之后才组合。直接对齐当前状态。
        if (!getPlatform().appLifecycle.isForeground()) {
          active = false;
          return;
        }
        unsubscribe = getPlatform().appLifecycle.subscribe((foreground) => {
          if (foreground) {
            active = true;
            return;
          }
          active = false;
          endCurrentSession();
        });
      } catch (error) {
        // 端口不可用：退回标签页可见性（弱等价，浏览器语境够用）。
        console.warn('[reader] appLifecycle 未生效，回退 visibilityState：', describeError(error));
        if (disposed) return;
        const onVisibility = (): void => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            active = true;
            return;
          }
          active = false;
          endCurrentSession();
        };
        document.addEventListener('visibilitychange', onVisibility);
        unsubscribe = () => document.removeEventListener('visibilitychange', onVisibility);
      }
    })();

    const timer = window.setInterval(tick, 1000);
    return () => {
      disposed = true;
      unsubscribe?.();
      window.clearInterval(timer);
      active = false;
      endCurrentSession();
    };
  }, []);
}

/** ReadingTimerEffect.kt:67 — `SimpleDateFormat("yyyy-MM-dd")`. */
function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ReaderScreen.kt:500-520 `LaunchedEffect(isAutoScrolling, autoScrollSpeed, isScrollMode)`. */
function useAutoScroll(args: {
  enabled: boolean;
  scrollMode: boolean;
  speed: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onReachedEnd: () => void;
}): void {
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  useEffect(() => {
    if (!args.enabled || !args.scrollMode) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const el = argsRef.current.scrollRef.current;
      if (el === null) return;
      const max = Math.max(el.scrollHeight - el.clientHeight, 0);
      if (el.scrollTop >= max) {
        argsRef.current.onReachedEnd();
        return;
      }
      const delta = now - last;
      last = now;
      if (delta >= AUTO_SCROLL_FRAME_MS) {
        el.scrollTop += AUTO_SCROLL_STEP_PX * argsRef.current.speed * (delta / AUTO_SCROLL_FRAME_MS);
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [args.enabled, args.scrollMode]);
}

/**
 * ReaderScreen.kt:1972-2062 — 滚动模式统一手势。
 * ADAPTATION: `awaitEachGesture`（外层）+ `verticalScroll`（内层）的优先级 →
 * 在滚动容器上挂原生 `pointerdown/move/up`：只有章首 / 章尾继续越界才
 * `preventDefault()`（等价 Compose 的 `change.consume()`），中部拖拽完全不消费。
 */
function useBoundaryPull(args: {
  scrollRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  switching: boolean;
  onPull: (deltaPx: number, direction: number) => void;
  onRelease: (totalPx: number, direction: number) => void;
  onTap: () => void;
}): void {
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });
  const { scrollRef, enabled } = args;
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !enabled) return;
    let pointerId = -1;
    let lastY = 0;
    let totalX = 0;
    let totalY = 0;
    let boundaryPulling = false;
    let moved = false;

    const onDown = (event: PointerEvent): void => {
      pointerId = event.pointerId;
      lastY = event.clientY;
      totalX = 0;
      totalY = 0;
      moved = false;
      boundaryPulling = false;
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      const deltaY = event.clientY - lastY;
      lastY = event.clientY;
      totalY += deltaY;
      totalX += event.movementX;
      if (Math.abs(totalY) > TOUCH_SLOP_PX || Math.abs(totalX) > TOUCH_SLOP_PX) moved = true;
      const current = argsRef.current;
      if (!current.enabled) return;
      const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight;
      const atTop = el.scrollTop <= 0;
      const pullNext = atBottom && deltaY < 0 && current.hasNext && !current.switching;
      const pullPrev = atTop && deltaY > 0 && current.hasPrev && !current.switching;
      if (pullNext || pullPrev) {
        boundaryPulling = true;
        if (event.cancelable) event.preventDefault();
        current.onPull(Math.abs(deltaY), pullNext ? 1 : -1);
      } else if (boundaryPulling) {
        boundaryPulling = false;
        current.onPull(0, 0);
      }
    };

    const finish = (): void => {
      if (pointerId === -1) return;
      const current = argsRef.current;
      if (boundaryPulling && current.enabled) {
        current.onRelease(Math.abs(totalY), totalY < 0 ? 1 : -1);
      } else if (!moved) {
        current.onTap();
      }
      pointerId = -1;
      boundaryPulling = false;
      moved = false;
    };

    const onUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      finish();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [scrollRef, enabled]);
}

// ═════════════════════════════════════════════════════════════════════════════
// Inline-image plumbing
// ═════════════════════════════════════════════════════════════════════════════

interface PageBlockEntry {
  block: InlineBlock;
  path: string;
  heightPx: number;
}

/**
 * REVIEW-2026-10-06：删掉了本地那份重复的 `IMAGE_TOKEN_RE` + 二次正则扫描。
 * Kotlin 的 `splitIntoBlocks` 本身就产出 `path` / `widthPx` / `heightPx`，
 * 再扫一遍反而掩盖了「块里没有 path」的移植缺口。
 */

/** ReaderScreen.kt:4956 + NovelInlineImages.kt:254-287 — 页面 → (块, 图片路径, 高度). */
function pageBlocks(
  pageText: string,
  contentWidthPx: number,
  maxHeightPx: number,
): PageBlockEntry[] {
  return splitIntoBlocks(pageText, contentWidthPx, maxHeightPx).map((block) => ({
    block,
    path: block.kind === 'image' ? block.path : '',
    heightPx: block.kind === 'image' ? block.heightPx : 0,
  }));
}

interface BlockMeta {
  raw: string;
  isText: boolean;
}

/** ReaderScreen.kt:1585-1609 — 滚动模式块序列（全局块序号跨 chunk 累计）. */
function scrollBlockMeta(chunks: ReadonlyArray<string>, widthPx: number): BlockMeta[] {
  const out: BlockMeta[] = [];
  for (const chunk of chunks) {
    for (const block of splitIntoBlocks(chunk, widthPx, Number.MAX_VALUE)) {
      out.push({
        raw: block.kind === 'image' ? block.raw : block.text,
        isText: block.kind === 'text',
      });
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Presentational primitives
// ═════════════════════════════════════════════════════════════════════════════

/** Material `Icons.Filled.*` 的文本字形替身（本项目无图标字体）. */
function Glyph(props: { name: string; size?: number }): ReactNode {
  const size = props.size ?? 20;
  return (
    <span
      className="rd-glyph"
      style={{ fontSize: `${size}px`, lineHeight: `${size}px` }}
      aria-hidden="true"
    >
      {props.name}
    </span>
  );
}

/** ReaderScreen.kt:1906 — `remember(showBars) { SimpleDateFormat("HH:mm").format(Date()) }`. */
function HeaderClock(props: { resetKey: boolean }): ReactNode {
  const [text] = useState(() => formatClockHHmm(new Date()));
  void props.resetKey;
  return <span>{text}</span>;
}

/** ReaderScreen.kt:1884-1912 — 常驻占位版页眉（章节标题 + 时钟，菜单开合只切透明度）. */
function ReaderOverlayHeader(props: { title: string; hidden: boolean }): ReactNode {
  return (
    <div className={props.hidden ? 'rd-overlay-row rd-overlay-row--hidden' : 'rd-overlay-row'}>
      <span className="rd-overlay-title">{props.title}</span>
      <span className="rd-overlay-clock">
        <HeaderClock resetKey={props.hidden} />
      </span>
    </div>
  );
}

/** ReaderScreen.kt:2794-2832 — 常驻占位版页脚（页码进度 + 全书百分比）. */
function ReaderOverlayFooter(props: {
  progressText: string;
  percentText: string;
  hidden: boolean;
}): ReactNode {
  return (
    <div className={props.hidden ? 'rd-overlay-row rd-overlay-row--hidden' : 'rd-overlay-row'}>
      <span className="rd-overlay-title">{props.progressText}</span>
      <span className="rd-overlay-clock">{props.percentText}</span>
    </div>
  );
}

/** ReaderScreen.kt:4614-4696 BookmarkHangingRibbon — 20×34dp，V 缺口 8dp. */
function BookmarkRibbon(): ReactNode {
  return (
    <svg className="rd-ribbon" width="20" height="34" viewBox="0 0 20 34" role="img" aria-label="书签">
      <defs>
        <linearGradient id="rd-ribbon-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={MINT_GOLD} />
          <stop offset="50%" stopColor="#FFB300" />
          <stop offset="100%" stopColor="#E65100" />
        </linearGradient>
      </defs>
      <path
        d="M0 0 H20 V34 L10 26 L0 34 Z"
        fill="url(#rd-ribbon-grad)"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1"
      />
    </svg>
  );
}

/** ReaderScreen.kt:2645-2764 — 滚动模式越界切章提示 chip. */
function PullSwitchChip(props: { direction: number; progress: number }): ReactNode {
  if (props.direction === 0) return null;
  const isNext = props.direction === 1;
  return (
    <div className={isNext ? 'rd-pull-chip rd-pull-chip--bottom' : 'rd-pull-chip rd-pull-chip--top'}>
      <div className="rd-pull-chip-inner">
        <div className="rd-pull-chip-row">
          <Glyph name={isNext ? '↑' : '↓'} size={16} />
          <span>{pullHintText(props.progress, isNext)}</span>
        </div>
        <div className="rd-pull-chip-bar">
          <div className="rd-pull-chip-fill" style={{ width: `${props.progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/** ReaderScreen.kt:2840-2963 — 朗读播放器. */
function TtsBar(props: {
  playing: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <div className="rd-tts-bar">
      <div className="rd-tts-card">
        <div className="rd-tts-head">
          <p className="rd-tts-title">朗读播放器</p>
          <button type="button" className="rd-icon-btn" onClick={props.onClose} aria-label="关闭">
            <Glyph name="✕" />
          </button>
        </div>
        <div className="rd-tts-controls">
          <button type="button" className="rd-icon-btn" onClick={props.onPrevious} aria-label="上一段">
            <Glyph name="⏮" />
          </button>
          <button
            type="button"
            className="rd-tts-play"
            onClick={props.onPlayPause}
            aria-label="播放暂停"
          >
            <Glyph name={props.playing ? '⏸' : '▶'} size={22} />
          </button>
          <button type="button" className="rd-icon-btn" onClick={props.onNext} aria-label="下一段">
            <Glyph name="⏭" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** ReaderScreen.kt:2967-3006 — 返回上次处. */
function ReturnChip(props: { onClick: () => void }): ReactNode {
  return (
    <div className="rd-return-chip">
      <button type="button" className="rd-return-chip-body" onClick={props.onClick}>
        <Glyph name="↶" />
        <span>返回上次处</span>
      </button>
    </div>
  );
}

/** ReaderScreen.kt:3018-3066 — 自动滚屏指示器. */
function AutoScrollPill(props: { onStop: () => void }): ReactNode {
  return (
    <div className="rd-autoscroll">
      <button type="button" className="rd-autoscroll-body" onClick={props.onStop}>
        <Glyph name="⇕" size={16} />
        <span>自动滚屏中 · 点击停止</span>
      </button>
    </div>
  );
}

/** ReaderScreen.kt:3072-3119 — 回到顶部. */
function BackToTopButton(props: { onClick: () => void }): ReactNode {
  return (
    <button type="button" className="rd-backtop" onClick={props.onClick} aria-label="回到顶部">
      <Glyph name="⌃" size={22} />
    </button>
  );
}

/** ReaderScreen.kt:1828-1832 — CircularProgressIndicator. */
function ReaderLoading(): ReactNode {
  return (
    <div className="rd-loading">
      <div className="rd-spinner" role="progressbar" aria-label="加载中" />
    </div>
  );
}

/** ReaderScreen.kt:1813-1821 — 章节加载失败. */
function LoadErrorState(props: { message: string; onRetry: () => void }): ReactNode {
  return (
    <div className="rd-state">
      <p className="rd-state-message">{`章节加载失败：${props.message}`}</p>
      <button type="button" className="rd-text-btn" onClick={props.onRetry}>
        重试加载
      </button>
    </div>
  );
}

/** ReaderScreen.kt:1834-1854 — 该文件格式暂不支持阅读. */
function UnsupportedChapterState(): ReactNode {
  return (
    <div className="rd-state">
      <p className="rd-state-message">
        {'该文件格式暂不支持阅读（KFX / DJVU / DOC / RTF / CHM 等）\n请导入 EPUB、PDF、TXT 或漫画格式'}
      </p>
    </div>
  );
}

/** ReaderScreen.kt:1856-1859 — 本章暂无正文. */
function EmptyChapterState(): ReactNode {
  return (
    <div className="rd-state">
      <p className="rd-state-message">本章暂无正文</p>
    </div>
  );
}

/** ReaderScreen.kt:4540-4608 — Ciallo～(∠・ω< )⌒★（MascotAnimationController 的 DOM 替身）. */
function EasterEggOverlay(): ReactNode {
  return (
    <div className="rd-easter-egg" aria-hidden="true">
      <div className="rd-easter-egg-bubble">Ciallo～(∠・ω&lt; )⌒★</div>
      <div className="rd-easter-egg-mascot">Ciallo</div>
    </div>
  );
}

/** ReaderScreen.kt:1142-1216 — 共享封面转场层（封面淡成水印，正文从右侧滑入）. */
function ReaderCoverLayer(props: { coverUri: string | null; started: boolean }): ReactNode {
  if (props.coverUri === null || props.coverUri.length === 0) return null;
  return (
    <img
      className={props.started ? 'rd-cover rd-cover--settled' : 'rd-cover'}
      src={props.coverUri}
      alt="Shared Cover"
      draggable={false}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Inline image
// ═════════════════════════════════════════════════════════════════════════════

/** NovelInlineImages.kt:293-331 `NovelInlineImage` → `<img>`. */
function InlineImage(props: { path: string; onTap: () => void; enabled: boolean }): ReactNode {
  const [src, setSrc] = useState<string | null>(null);
  const [decodeDone, setDecodeDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void inlineImageDecoder.resolve(props.path).then((url) => {
      if (cancelled) return;
      setSrc(url);
      setDecodeDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [props.path]);
  return (
    <div
      className="rd-img-box"
      style={{ cursor: props.enabled ? 'pointer' : 'default' }}
      onClick={props.enabled ? props.onTap : undefined}
    >
      {src !== null ? (
        <img className="rd-img" src={src} alt="插图" draggable={false} />
      ) : decodeDone ? (
        <span className="rd-img-fail">图片读取失败</span>
      ) : null}
    </div>
  );
}

/** NovelInlineImages.kt:181-191 — 注册 / 注销插图的屏幕矩形. */
function useImageHitRegistration(args: {
  regId: string;
  path: string;
  pageKey: string | null;
  elementRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}): void {
  const { regId, path, pageKey, elementRef, enabled } = args;
  useLayoutEffect(() => {
    if (!enabled) return;
    const register = (): void => {
      const el = elementRef.current;
      if (el === null) return;
      const box = el.getBoundingClientRect();
      imageHitRegistry.register(
        regId,
        path,
        { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        pageKey,
      );
    };
    register();
    window.addEventListener('resize', register);
    window.addEventListener('orientationchange', register);
    return () => {
      window.removeEventListener('resize', register);
      window.removeEventListener('orientationchange', register);
      imageHitRegistry.unregister(regId);
    };
  }, [regId, path, pageKey, elementRef, enabled]);
}

// ═════════════════════════════════════════════════════════════════════════════
// RenderSinglePage
// ═════════════════════════════════════════════════════════════════════════════

/** ReaderScreen.kt:4956-5002 — 单页内的一个块. */
function PageBlock(props: {
  entry: PageBlockEntry;
  blockIndex: number;
  pageKey: string | null;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  textColor: string;
  highlightQuery: string | null;
  registerImageHit: boolean;
  interactive: boolean;
  onImageClick: (path: string) => void;
}): ReactNode {
  // ReaderScreen.kt:4962-4964 — 稳定随机串注册 id；React 侧用 useId()（规则 8）
  const instanceId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const regId = `img_${String(props.blockIndex)}_${instanceId}`;

  useImageHitRegistration({
    regId,
    path: props.entry.path,
    pageKey: props.registerImageHit ? props.pageKey : null,
    elementRef: boxRef,
    enabled: props.registerImageHit && props.entry.block.kind === 'image',
  });

  if (props.entry.block.kind === 'image') {
    // ReaderScreen.kt:4971 — `height(block.heightPx.toDp())`，displaySize 已按
    // maxImageHeightPx 收敛，这里不再二次 clamp（Kotlin 也没有）。
    return (
      <div className="rd-img-holder" ref={boxRef} style={{ height: `${props.entry.heightPx}px` }}>
        <InlineImage
          path={props.entry.path}
          onTap={() => props.onImageClick(props.entry.path)}
          enabled={props.interactive}
        />
      </div>
    );
  }

  const pieces = splitByHighlights(props.entry.block.text, props.highlightQuery);
  return (
    <div
      className="rd-text"
      style={{
        fontFamily: props.fontFamily,
        fontSize: `${props.fontSizePx}px`,
        lineHeight: `${props.lineHeightPx}px`,
        color: withAlpha(props.textColor, 0.92),
      }}
    >
      {pieces.map((piece, index) =>
        piece.hit ? (
          <mark className="rd-search-hl" key={`h${String(index)}`}>
            {piece.text}
          </mark>
        ) : (
          <span key={`t${String(index)}`}>{piece.text}</span>
        ),
      )}
    </div>
  );
}

/** ReaderScreen.kt:4838-5009 `RenderSinglePage`. */
function SinglePage(props: {
  pageIndex: number;
  pageText: string;
  chapterTitle: string | null;
  bg: string;
  textColor: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  titleReservePx: number;
  marginHorizontal: number;
  contentWidthPx: number;
  maxImageHeightPx: number;
  highlightQuery: string | null;
  registerImageHit: boolean;
  interactive: boolean;
  onImageClick: (path: string) => void;
}): ReactNode {
  // ReaderScreen.kt:4879-4883 — 本页成为「当前页」时更新命中表的页标识
  const { registerImageHit, pageText } = props;
  useEffect(() => {
    if (!registerImageHit) return;
    imageHitRegistry.setActivePage(pageText);
  }, [registerImageHit, pageText]);

  const entries = useMemo(
    () => pageBlocks(pageText, props.contentWidthPx, props.maxImageHeightPx),
    [pageText, props.contentWidthPx, props.maxImageHeightPx],
  );

  return (
    <div
      className="rd-page"
      style={{
        background: props.bg,
        padding: `${PAGE_VERTICAL_PADDING_DP}px ${props.marginHorizontal}px`,
      }}
    >
      {props.pageIndex === 0 && props.chapterTitle !== null && props.chapterTitle.length > 0 ? (
        <div
          className="rd-page-title-box"
          style={{ height: `${props.titleReservePx}px`, color: props.textColor }}
        >
          <div className="rd-page-title">{props.chapterTitle}</div>
        </div>
      ) : null}
      <div className="rd-page-body" style={{ paddingBottom: `${PAGE_TEXT_BOTTOM_PADDING_DP}px` }}>
        {entries.map((entry, index) => (
          <PageBlock
            key={`b${String(index)}`}
            entry={entry}
            blockIndex={index}
            pageKey={pageText}
            fontFamily={props.fontFamily}
            fontSizePx={props.fontSizePx}
            lineHeightPx={props.lineHeightPx}
            textColor={props.textColor}
            highlightQuery={props.highlightQuery}
            registerImageHit={props.registerImageHit}
            interactive={props.interactive}
            onImageClick={props.onImageClick}
          />
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Scroll mode blocks
// ═════════════════════════════════════════════════════════════════════════════

/** ReaderScreen.kt:2152-2180 — 滚动模式文本块（含搜索高亮 + 位置注册）. */
function ScrollTextBlock(props: {
  text: string;
  globalBlockIndex: number;
  highlightQuery: string | null;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  textColor: string;
  onGeometry: (blockIndex: number, topY: number) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const pieces = useMemo(
    () => splitByHighlights(props.text, props.highlightQuery),
    [props.text, props.highlightQuery],
  );
  const { globalBlockIndex, onGeometry } = props;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const apply = (): void => {
      onGeometry(globalBlockIndex, el.offsetTop);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [globalBlockIndex, onGeometry]);
  return (
    <div
      className="rd-body"
      ref={ref}
      style={{
        fontFamily: props.fontFamily,
        fontSize: `${props.fontSizePx}px`,
        lineHeight: `${props.lineHeightPx}px`,
        color: withAlpha(props.textColor, 0.92),
      }}
    >
      {pieces.map((piece, index) =>
        piece.hit ? (
          <mark className="rd-search-hl" key={`h${String(index)}`}>
            {piece.text}
          </mark>
        ) : (
          <span key={`t${String(index)}`}>{piece.text}</span>
        ),
      )}
    </div>
  );
}

/** ReaderScreen.kt:2136-2150 — 滚动模式图片块. */
function ScrollImageBlock(props: {
  path: string;
  heightPx: number;
  globalBlockIndex: number;
  onTap: (path: string) => void;
  onGeometry: (blockIndex: number, topY: number) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const { globalBlockIndex, onGeometry } = props;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const apply = (): void => {
      onGeometry(globalBlockIndex, el.offsetTop);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [globalBlockIndex, onGeometry]);
  return (
    <div className="rd-img-holder" ref={ref} style={{ height: `${props.heightPx}px` }}>
      <InlineImage path={props.path} onTap={() => props.onTap(props.path)} enabled />
    </div>
  );
}

/** ReaderScreen.kt:2121-2184 — 滚动正文块序列（全局块序号跨 chunk 累计）. */
function ScrollBlockSequence(props: {
  chunks: ReadonlyArray<string>;
  contentWidthPx: number;
  highlightQuery: string | null;
  highlightBlockIndex: number;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  textColor: string;
  onImageTap: (path: string) => void;
  onGeometry: (blockIndex: number, topY: number) => void;
}): ReactNode {
  const rows = useMemo(() => {
    const out: Array<PageBlockEntry & { index: number }> = [];
    let global = 0;
    for (const chunk of props.chunks) {
      for (const entry of pageBlocks(chunk, props.contentWidthPx, Number.MAX_VALUE)) {
        if (entry.block.kind === 'text' && entry.block.text.length === 0) continue;
        out.push({ ...entry, index: global });
        global += 1;
      }
    }
    return out;
  }, [props.chunks, props.contentWidthPx]);

  return (
    <>
      {rows.map((row) =>
        row.block.kind === 'image' ? (
          <ScrollImageBlock
            key={`g${String(row.index)}`}
            path={row.path}
            heightPx={row.heightPx}
            globalBlockIndex={row.index}
            onTap={props.onImageTap}
            onGeometry={props.onGeometry}
          />
        ) : (
          <ScrollTextBlock
            key={`g${String(row.index)}`}
            text={row.block.text}
            globalBlockIndex={row.index}
            highlightQuery={row.index === props.highlightBlockIndex ? props.highlightQuery : null}
            fontFamily={props.fontFamily}
            fontSizePx={props.fontSizePx}
            lineHeightPx={props.lineHeightPx}
            textColor={props.textColor}
            onGeometry={props.onGeometry}
          />
        ),
      )}
    </>
  );
}

/** ReaderScreen.kt:2078-2216 — 滚动档 currentSlot 的内容（不含手势容器）. */
function ScrollChapter(props: {
  chapterTitle: string;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  chunks: ReadonlyArray<string>;
  contentWidthPx: number;
  highlightQuery: string | null;
  highlightBlockIndex: number;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  textColor: string;
  onImageTap: (path: string) => void;
  onGeometry: (blockIndex: number, topY: number) => void;
}): ReactNode {
  return (
    <>
      {props.hasPrevChapter ? (
        <p className="rd-pull-hint">↓ 已到本章开头 · 继续下拉返回上一章</p>
      ) : null}
      <h2 className="rd-chapter-heading">{props.chapterTitle}</h2>
      <ScrollBlockSequence
        chunks={props.chunks}
        contentWidthPx={props.contentWidthPx}
        highlightQuery={props.highlightQuery}
        highlightBlockIndex={props.highlightBlockIndex}
        fontFamily={props.fontFamily}
        fontSizePx={props.fontSizePx}
        lineHeightPx={props.lineHeightPx}
        textColor={props.textColor}
        onImageTap={props.onImageTap}
        onGeometry={props.onGeometry}
      />
      <div className="rd-spacer-20" />
      <p className="rd-chapter-end">
        {props.hasNextChapter ? '—— 本章完 · 继续上滑进入下一章 ——' : '—— 全书完 ——'}
      </p>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Page turn host
// ═════════════════════════════════════════════════════════════════════════════

interface PageTurnHostProps {
  mode: number;
  pageKey: string;
  currentSlot: ReactNode;
  nextSlot: ReactNode;
  prevSlot: ReactNode;
  menuVisible: boolean;
  isBookmarked: boolean;
  paperColor: string;
  onNextPage: () => void;
  onPrevPage: () => void;
  onClickCenter: () => void;
  onToggleBookmark: () => void;
  onLongPressCenter: () => void;
  onImageTapAt: (point: { x: number; y: number }) => boolean;
}

/**
 * ReaderScreen.kt:2498-2603 — `if (!isScrollMode && pageTurnMode == SIMULATE.id)
 * PageCurlReaderContainer(...) else PageTurnContainer(...)`.
 *
 * REVIEW-2026-10-06：此前本文件自带一套 `PageTurnHost` + `PageLayer` 的 DOM 重写，
 * 与 `src/ui/components/pageturn/*` 里已经逐行移植好的两个容器并存（后者根本没被引用），
 * 并且行为不同：
 *   ① COVER 档把 `current` 与 `prev` 两层套了同一个 `translateX(p·100%)`
 *      （Kotlin CoverPageTurnLayout:1017-1032 是 current=`p*0.15f`、prev=`p - widthPx`）；
 *   ② SIMULATE 档没有走 pagecurl 三页窗口，而是把 current / prev 一起 rotateY；
 *   ③ FADE 档同时点亮 next 与 prev 两层（Kotlin 每次只显示其中一层）。
 * 现按 Kotlin 的分派把 0 档交给 `PageCurlReaderContainer`、其余交给 `PageTurnContainer`，
 * 手势数学（touchSlop / 0.15w 阈值 / 0.35·0.65 点击区 / 80·160px 下拉书签 / 静置 1s）
 * 由这两个已移植组件承载，与 Kotlin 单一来源一致。
 */
function PageTurnHost(props: PageTurnHostProps): ReactNode {
  if (props.mode === PAGE_TURN_SIMULATE) {
    return (
      <PageCurlReaderContainer
        currentContent={props.currentSlot}
        nextContent={props.nextSlot}
        prevContent={props.prevSlot}
        onNextPage={props.onNextPage}
        onPrevPage={props.onPrevPage}
        onClickCenter={props.onClickCenter}
        isCurrentBookmarked={props.isBookmarked}
        onToggleBookmark={props.onToggleBookmark}
        onLongPressCenter={props.onLongPressCenter}
        menuVisible={props.menuVisible}
        paperColor={props.paperColor}
        onImageTapAt={props.onImageTapAt}
      />
    );
  }
  return (
    <PageTurnContainer
      pageTurnMode={props.mode}
      pageKey={props.pageKey}
      menuVisible={props.menuVisible}
      currentContent={props.currentSlot}
      nextContent={props.nextSlot}
      prevContent={props.prevSlot}
      onNextPage={props.onNextPage}
      onPrevPage={props.onPrevPage}
      onClickCenter={props.onClickCenter}
      onClickLeft={props.onPrevPage}
      onClickRight={props.onNextPage}
      isBookmarked={props.isBookmarked}
      onToggleBookmark={props.onToggleBookmark}
      onLongPressCenter={props.onLongPressCenter}
      onImageTapAt={props.onImageTapAt}
      paperColor={props.paperColor}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════

/**
 * REVIEW-2026-10-06：删掉了本文件里的“快速翻页”紧凑 DOM 改写（横向页条 + scroll-snap），
 * 改用 `src/ui/components/pageturn/PageScrubber.tsx` —— `PageScrubber.kt` 的逐行移植
 * （圆柱内壁等距刚体模型 / 串珠惯性吸附 / 两端橡皮筋 / 点击某页进入 / 取消收拢）。
 * 原注释声称“PageScrubber.kt 不在本次移植范围”，但 `PARITY_EXCEPTIONS.md` 里并没有
 * 对应豁免条目 —— 属于未登记的砍功能。现已按原样接回。
 */
// ═════════════════════════════════════════════════════════════════════════════
// PageScrubberOverlay —— 见 `src/ui/components/pageturn/PageScrubber.tsx`（PageScrubber.kt 移植）
// ═════════════════════════════════════════════════════════════════════════════
// FluidSlider
// ═════════════════════════════════════════════════════════════════════════════

/** FluidSlider 复刻（barHeightDp = 26；拖动时气泡升起 28.6px，Overshoot 回弹）. */
function ReaderFluidSlider(props: {
  position: number;
  bubbleText: string;
  color: string;
  disabled: boolean;
  onPositionChange: (pos: number) => void;
  onPositionChangeFinished: (pos: number | null) => void;
}): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<number | null>(null);

  const positionOf = (clientX: number): number => {
    const el = trackRef.current;
    if (el === null) return 0;
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return 0;
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
  };

  const shown = live ?? props.position;

  return (
    <div
      className={dragging ? 'rd-fluid rd-fluid--dragging' : 'rd-fluid'}
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-label="阅读进度"
      onPointerDown={(event) => {
        if (props.disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        const pos = positionOf(event.clientX);
        setLive(pos);
        props.onPositionChange(pos);
      }}
      onPointerMove={(event) => {
        if (!dragging || props.disabled) return;
        const pos = positionOf(event.clientX);
        setLive(pos);
        props.onPositionChange(pos);
      }}
      onPointerUp={(event) => {
        if (!dragging || props.disabled) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
        props.onPositionChangeFinished(live);
      }}
      onPointerCancel={() => {
        if (!dragging || props.disabled) return;
        setDragging(false);
        props.onPositionChangeFinished(live);
      }}
    >
      <div className="rd-fluid-track" style={{ background: props.color }} />
      <div className="rd-fluid-bubble" style={{ left: `${shown * 100}%` }}>
        {props.bubbleText}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Bars
// ═════════════════════════════════════════════════════════════════════════════

/** ReaderScreen.kt:3200-3393 — 顶栏. */
function ReaderTopBar(props: {
  chapterTitle: string;
  chapterCount: number;
  chapterIndex: number;
  barFg: string;
  barBg: string;
  barLine: string;
  bookmarked: boolean;
  ttsPlaying: boolean;
  autoScrolling: boolean;
  showMoreMenu: boolean;
  onBack: () => void;
  onToggleBookmark: () => void;
  onToggleTts: () => void;
  onOpenToc: () => void;
  onToggleMoreMenu: () => void;
  onSearch: () => void;
  onBookmarks: () => void;
  onAutoScroll: () => void;
  onTypography: () => void;
}): ReactNode {
  return (
    <div
      className="rd-top-bar"
      style={{ background: props.barBg, borderBottomColor: props.barLine, color: props.barFg }}
    >
      <div className="rd-bar-row">
        <button type="button" className="rd-icon-btn" onClick={props.onBack} aria-label="返回">
          <Glyph name="‹" size={22} />
        </button>
        <div className="rd-bar-text">
          <p className="rd-bar-title">{props.chapterTitle}</p>
          <p className="rd-bar-sub">{`${props.chapterIndex + 1}/${props.chapterCount} 章`}</p>
        </div>
        <button
          type="button"
          className="rd-icon-btn"
          onClick={props.onToggleBookmark}
          aria-label="书签"
          aria-pressed={props.bookmarked}
          style={{ color: props.bookmarked ? MINT_GOLD : props.barFg }}
        >
          <Glyph name={props.bookmarked ? '★' : '☆'} size={20} />
        </button>
        <button
          type="button"
          className="rd-icon-btn"
          onClick={props.onToggleTts}
          aria-label="听书"
          style={{ color: props.ttsPlaying ? MINT_GOLD : props.barFg }}
        >
          <Glyph name={props.ttsPlaying ? '🔊' : '🎧'} size={20} />
        </button>
        <button type="button" className="rd-icon-btn" onClick={props.onOpenToc} aria-label="目录">
          <Glyph name="☰" size={20} />
        </button>
        <div className="rd-menu-wrap">
          <button
            type="button"
            className="rd-icon-btn"
            onClick={props.onToggleMoreMenu}
            aria-label="更多"
            aria-expanded={props.showMoreMenu}
          >
            <Glyph name="⋮" size={20} />
          </button>
          {props.showMoreMenu ? (
            <div className="rd-menu" role="menu">
              <button
                type="button"
                className="rd-menu-item"
                role="menuitem"
                onClick={() => {
                  props.onToggleMoreMenu();
                  props.onSearch();
                }}
              >
                <span className="rd-menu-item-icon">🔍</span>
                <span>全文搜索</span>
              </button>
              <button
                type="button"
                className="rd-menu-item"
                role="menuitem"
                onClick={() => {
                  props.onToggleMoreMenu();
                  props.onBookmarks();
                }}
              >
                <span className="rd-menu-item-icon" style={{ color: MINT_PRIMARY }}>
                  🔖
                </span>
                <span>书签列表</span>
              </button>
              <button
                type="button"
                className="rd-menu-item"
                role="menuitem"
                onClick={() => {
                  props.onToggleMoreMenu();
                  props.onAutoScroll();
                }}
              >
                <span
                  className="rd-menu-item-icon"
                  style={{ color: props.autoScrolling ? MINT_GOLD : undefined }}
                >
                  ⇕
                </span>
                <span>{props.autoScrolling ? '停止自动滚屏' : '自动滚屏'}</span>
              </button>
              <button
                type="button"
                className="rd-menu-item"
                role="menuitem"
                onClick={() => {
                  props.onToggleMoreMenu();
                  props.onTypography();
                }}
              >
                <span className="rd-menu-item-icon">⚙</span>
                <span>排版设置</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** ReaderScreen.kt:3399-3654 — 底栏（章节拖动条 + 进度行 + 听书按钮）. */
function ReaderBottomBar(props: {
  barFg: string;
  barBg: string;
  barLine: string;
  isScrollMode: boolean;
  pageCount: number;
  pageIndex: number;
  chapterIndex: number;
  chapterCount: number;
  chapterTitle: string;
  scrollValue: number;
  scrollMaxValue: number;
  dragPos: number | null;
  ttsPlaying: boolean;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onDragChange: (pos: number | null) => void;
  onPageSelected: (index: number) => void;
  onScrollSelected: (pos: number) => void;
  onToggleTts: () => void;
}): ReactNode {
  const canSlidePages = !props.isScrollMode && props.pageCount >= 2;
  const position = props.isScrollMode
    ? props.scrollValue / Math.max(props.scrollMaxValue, 1)
    : props.pageIndex / Math.max(props.pageCount - 1, 1);
  const shown = props.dragPos ?? position;
  const bubbleText = props.isScrollMode
    ? `${Math.round(shown * 100)}%`
    : `${Math.round(shown * Math.max(props.pageCount - 1, 1)) + 1}`;

  let statusText: string;
  if (props.dragPos !== null && canSlidePages) {
    const targetPage = Math.min(
      Math.max(Math.round(props.dragPos * Math.max(props.pageCount - 1, 1)), 0),
      props.pageCount - 1,
    );
    statusText = `跳转 → 本章第 ${targetPage + 1}/${props.pageCount} 页`;
  } else if (props.dragPos !== null && props.isScrollMode) {
    statusText = `跳转 → 本章 ${Math.trunc(props.dragPos * 100)}%`;
  } else if (props.chapterCount > 0) {
    statusText = `第 ${props.chapterIndex + 1} / ${props.chapterCount} 章 · ${props.chapterTitle}`;
  } else {
    statusText = `第 ${props.chapterIndex + 1} / ${props.chapterCount} 章`;
  }

  return (
    <div
      className="rd-bottom-bar"
      style={{ background: props.barBg, borderTopColor: props.barLine, color: props.barFg }}
    >
      <div className="rd-bottom-inner">
        <div className="rd-chapter-nav">
          <button
            type="button"
            className="rd-text-btn"
            disabled={props.chapterIndex <= 0}
            onClick={props.onPrevChapter}
          >
            上一章
          </button>
          <ReaderFluidSlider
            position={position}
            bubbleText={bubbleText}
            color={props.barFg}
            disabled={!canSlidePages && !props.isScrollMode}
            onPositionChange={(pos) => props.onDragChange(pos)}
            onPositionChangeFinished={(pos) => {
              props.onDragChange(pos);
              if (pos === null) return;
              if (props.isScrollMode) {
                props.onScrollSelected(pos);
                return;
              }
              const target = Math.min(
                Math.max(Math.round(pos * Math.max(props.pageCount - 1, 1)), 0),
                props.pageCount - 1,
              );
              if (target !== props.pageIndex) props.onPageSelected(target);
            }}
          />
          <button
            type="button"
            className="rd-text-btn"
            disabled={props.chapterIndex >= props.chapterCount - 1}
            onClick={props.onNextChapter}
          >
            下一章
          </button>
        </div>
        <div className="rd-progress-row">
          <span className="rd-progress-text">{statusText}</span>
          <button
            type="button"
            className="rd-tonal-btn"
            onClick={props.onToggleTts}
            style={{
              background: withAlpha(
                props.ttsPlaying ? MINT_GOLD : props.barFg,
                props.ttsPlaying ? 0.25 : 0.1,
              ),
              color: props.ttsPlaying ? MINT_GOLD : props.barFg,
            }}
          >
            <Glyph name={props.ttsPlaying ? '🔊' : '🎧'} size={18} />
            <span>{props.ttsPlaying ? '朗读中...' : '听书模式'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sheets / dialogs
// ═════════════════════════════════════════════════════════════════════════════

/** ReaderScreen.kt:3704-3797 — 目录面板. */
function TocSheet(props: {
  chapters: ReadonlyArray<ChapterRow>;
  currentChapterIndex: number;
  onSelect: (chapterOrder: number) => void;
  onClose: () => void;
  onCheckUpdate: (() => void) | null;
}): ReactNode {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (filter.trim().length === 0) return props.chapters;
    const needle = filter.toLowerCase();
    return props.chapters.filter((chapter) => chapter.title.toLowerCase().includes(needle));
  }, [props.chapters, filter]);

  // ReaderScreen.kt:3678-3692 — 打开目录时自动定位到当前章节
  const { currentChapterIndex } = props;
  useEffect(() => {
    if (filter.trim().length > 0) return;
    const el = document.querySelector('.rd-toc-item--current');
    if (el instanceof HTMLElement) scrollElementIntoView(el, { block: 'center' });
  }, [filter, currentChapterIndex]);

  return (
    <div className="rd-sheet-backdrop" onClick={props.onClose}>
      <div className="rd-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="rd-sheet-head">
          <h2 className="rd-sheet-title">{`目录 (${props.chapters.length}章)`}</h2>
          {props.onCheckUpdate === null ? null : (
            <button type="button" className="rd-text-btn" onClick={props.onCheckUpdate}>
              检查更新
            </button>
          )}
        </div>
        <div className="rd-spacer-12" />
        <input
          className="rd-field"
          type="search"
          value={filter}
          placeholder="搜索章节..."
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="rd-spacer-12" />
        <div className="rd-toc-list">
          {filtered.map((chapter) => {
            const isCurrent = chapter.chapterOrder === currentChapterIndex;
            return (
              <button
                type="button"
                key={`c${String(chapter.chapterOrder)}`}
                className={isCurrent ? 'rd-toc-item rd-toc-item--current' : 'rd-toc-item'}
                onClick={() => props.onSelect(chapter.chapterOrder)}
              >
                {chapter.title}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** ReaderScreen.kt:5019-5064 ReaderThemePreviewCard. */
function ThemePreviewCard(props: {
  name: string;
  bg: string;
  fg: string;
  selected: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={props.selected ? 'rd-theme-card rd-theme-card--selected' : 'rd-theme-card'}
      style={{ background: props.bg, color: props.fg }}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      <p className="rd-theme-sample">{'永远相信美好的\n事情正在发生'}</p>
      <span className="rd-theme-name">{props.name}</span>
      {props.selected ? (
        <span className="rd-theme-check" style={{ color: MINT_PRIMARY }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** ReaderScreen.kt:5071-5110 ReaderPageModeChip. */
function PageModeChip(props: { label: string; selected: boolean; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      className={props.selected ? 'rd-mode-chip rd-mode-chip--selected' : 'rd-mode-chip'}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      {props.selected ? <span>✓</span> : null}
      <span>{props.label}</span>
    </button>
  );
}

/** ReaderScreen.kt:5117-5154 ReaderFontOptionRow. */
function FontOptionRow(props: {
  name: string;
  sample: string;
  family: string;
  selected: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={props.selected ? 'rd-font-row rd-font-row--selected' : 'rd-font-row'}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      <span className="rd-font-icon">{props.selected ? '◉' : '○'}</span>
      <span className="rd-grow">
        <span className="rd-font-name" style={{ fontFamily: props.family }}>
          {props.name}
        </span>
        <span className="rd-font-sample" style={{ fontFamily: props.family }}>
          {props.sample}
        </span>
      </span>
    </button>
  );
}

/** ReaderScreen.kt:3803-4163 — 阅读排版面板. */
function TypographySheet(props: {
  prefs: ReaderPrefs;
  customFontLoaded: boolean;
  customFontFamily: string;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  onReset: () => void;
  onImportFont: () => void;
  onSelectMode: (mode: number) => void;
  onClose: () => void;
}): ReactNode {
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const fontName = readingFontName(props.prefs.fontFamilyIndex, props.customFontLoaded);

  return (
    <div className="rd-sheet-backdrop" onClick={props.onClose}>
      <div className="rd-sheet rd-sheet--settings" onClick={(event) => event.stopPropagation()}>
        <div className="rd-sheet-head">
          <Glyph name="⚙" size={22} />
          <h2 className="rd-sheet-title">阅读排版</h2>
          <span className="rd-grow" />
          <button type="button" className="rd-text-btn" onClick={props.onReset}>
            重置
          </button>
        </div>

        {/* 显 示 */}
        <div className="rd-group-label">显 示</div>
        <div className="rd-spacer-10" />
        <div className="rd-group">
          <div className="rd-row">
            <Glyph name="☀" size={16} />
            <span className="rd-label">亮度</span>
            <span className="rd-grow" />
            <span className="rd-value rd-value--gold">
              {`${Math.trunc(props.prefs.readerBrightness * 100)}%`}
            </span>
          </div>
          <input
            className="rd-slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(brightnessToSlider(props.prefs.readerBrightness) * 1000)}
            onChange={(event) =>
              props.onChange({
                readerBrightness: brightnessFromSlider(Number(event.target.value) / 1000),
              })
            }
            aria-label="亮度"
          />
          <div className="rd-row rd-row--tall">
            <span className="rd-grow">
              <span className="rd-label rd-block">首行缩进</span>
              <span className="rd-sublabel rd-block">段落首行自动空两格</span>
            </span>
            <input
              type="checkbox"
              checked={props.prefs.firstLineIndent}
              onChange={(event) => props.onChange({ firstLineIndent: event.target.checked })}
              aria-label="首行缩进"
            />
          </div>
        </div>

        {/* 文 字 */}
        <div className="rd-spacer-18" />
        <div className="rd-group-label">文 字</div>
        <div className="rd-spacer-10" />
        <div className="rd-group">
          <div className="rd-row">
            <span className="rd-label">字号</span>
            <span className="rd-grow" />
            <span className="rd-stepper">
              <button
                type="button"
                className="rd-text-btn rd-text-btn--inline"
                disabled={props.prefs.fontSize <= 12}
                onClick={() => props.onChange({ fontSize: stepFontSizeDown(props.prefs.fontSize) })}
              >
                A−
              </button>
              <span className="rd-stepper-value">{String(Math.trunc(props.prefs.fontSize))}</span>
              <button
                type="button"
                className="rd-text-btn rd-text-btn--inline"
                disabled={props.prefs.fontSize >= 36}
                onClick={() => props.onChange({ fontSize: stepFontSizeUp(props.prefs.fontSize) })}
              >
                A+
              </button>
            </span>
          </div>
          <div className="rd-divider" />

          <button
            type="button"
            className="rd-row rd-row--font"
            onClick={() => setFontPanelOpen((prev) => !prev)}
          >
            <span className="rd-label">字体</span>
            <span className="rd-value rd-value--primary rd-grow rd-left">{fontName}</span>
            <Glyph name={fontPanelOpen ? '⌃' : '⌄'} size={20} />
          </button>
          {fontPanelOpen ? (
            <div className="rd-font-panel">
              {READING_FONT_FAMILIES.map((font) => (
                <FontOptionRow
                  key={`f${String(font.index)}`}
                  name={font.name}
                  sample="永字八法，安静阅读 Aa 123"
                  family={font.cssFamily}
                  selected={props.prefs.fontFamilyIndex === font.index}
                  onClick={() => props.onChange({ fontFamilyIndex: font.index })}
                />
              ))}
              <FontOptionRow
                name="自定义字体"
                sample={
                  props.customFontLoaded ? '已导入字体效果预览 Aa' : '选择 TTF 文件后可在此预览'
                }
                // ReaderScreen.kt:4019 — `customTypeface?.let { FontFamily(it) } ?: AppFonts.Default`
                family={props.customFontLoaded ? props.customFontFamily : NOTO_SANS_SC}
                selected={props.prefs.fontFamilyIndex === CUSTOM_FONT_INDEX && props.customFontLoaded}
                onClick={() => {
                  if (props.customFontLoaded) {
                    props.onChange({ fontFamilyIndex: CUSTOM_FONT_INDEX });
                  } else {
                    props.onImportFont();
                  }
                }}
              />
              {/* ReaderScreen.kt:4028-4041 — 「自定义字体」行的 trailing 插槽 */}
              <div className="rd-font-trailing">
                <button
                  type="button"
                  className="rd-text-btn"
                  style={{ color: MINT_PRIMARY, fontSize: 12 }}
                  onClick={props.onImportFont}
                >
                  {props.customFontLoaded ? '换字体' : '+导入'}
                </button>
              </div>
            </div>
          ) : null}
          <div className="rd-divider" />

          <div className="rd-row">
            <span className="rd-label">行间距</span>
            <span className="rd-grow" />
            <span className="rd-value rd-value--primary">{`${Math.trunc(props.prefs.lineHeight)} sp`}</span>
          </div>
          <input
            className="rd-slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(lineHeightToSlider(props.prefs.lineHeight) * 1000)}
            onChange={(event) =>
              props.onChange({ lineHeight: lineHeightFromSlider(Number(event.target.value) / 1000) })
            }
            aria-label="行间距"
          />
          <div className="rd-row">
            <span className="rd-label">页边距</span>
            <span className="rd-grow" />
            <span className="rd-value rd-value--primary">{`${props.prefs.marginHorizontal} dp`}</span>
          </div>
          <input
            className="rd-slider"
            type="range"
            min={0}
            max={1000}
            value={Math.round(marginToSlider(props.prefs.marginHorizontal) * 1000)}
            onChange={(event) =>
              props.onChange({ marginHorizontal: marginFromSlider(Number(event.target.value) / 1000) })
            }
            aria-label="页边距"
          />
        </div>

        {/* 阅读主题 */}
        <div className="rd-spacer-18" />
        <div className="rd-group-label">阅读主题</div>
        <div className="rd-spacer-10" />
        <div className="rd-theme-grid">
          <div className="rd-theme-row">
            {READER_THEME_PREVIEWS.slice(0, 3).map((preview) => (
              <ThemePreviewCard
                key={`t${String(preview.id)}`}
                name={preview.name}
                bg={preview.bg}
                fg={preview.fg}
                selected={props.prefs.readerTheme === preview.id}
                onClick={() => props.onChange({ readerTheme: preview.id })}
              />
            ))}
          </div>
          <div className="rd-theme-row">
            {READER_THEME_PREVIEWS.slice(3).map((preview) => (
              <ThemePreviewCard
                key={`t${String(preview.id)}`}
                name={preview.name}
                bg={preview.bg}
                fg={preview.fg}
                selected={props.prefs.readerTheme === preview.id}
                onClick={() => props.onChange({ readerTheme: preview.id })}
              />
            ))}
          </div>
        </div>

        {/* 翻 页 */}
        <div className="rd-spacer-18" />
        <div className="rd-group-label">翻 页</div>
        <div className="rd-spacer-10" />
        <div className="rd-mode-grid">
          <div className="rd-mode-row">
            {PAGE_TURN_TYPES.slice(0, 3).map((mode) => (
              <PageModeChip
                key={`m${String(mode.id)}`}
                label={pageTurnChipLabel(mode.title)}
                selected={props.prefs.pageTurnMode === mode.id}
                onClick={() => props.onSelectMode(mode.id)}
              />
            ))}
          </div>
          <div className="rd-mode-row">
            {PAGE_TURN_TYPES.slice(3).map((mode) => (
              <PageModeChip
                key={`m${String(mode.id)}`}
                label={pageTurnChipLabel(mode.title)}
                selected={props.prefs.pageTurnMode === mode.id}
                onClick={() => props.onSelectMode(mode.id)}
              />
            ))}
            <span className="rd-mode-spacer" />
          </div>
        </div>
        <div className="rd-spacer-10" />
      </div>
    </div>
  );
}

/** ReaderScreen.kt:4170-4308 — 全文搜索对话框. */
function SearchDialog(props: {
  keyword: string;
  searching: boolean;
  results: ReadonlyArray<SearchResultItem>;
  onKeywordChange: (keyword: string) => void;
  onSelectResult: (item: SearchResultItem) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="rd-dialog-backdrop" onClick={props.onClose}>
      <div className="rd-dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="rd-dialog-title">全文搜索</h2>
        <input
          className="rd-field"
          type="search"
          value={props.keyword}
          placeholder="输入关键词..."
          onChange={(event) => props.onKeywordChange(event.target.value)}
        />
        <div className="rd-spacer-12" />
        {props.searching ? (
          <div className="rd-spinner" role="progressbar" aria-label="搜索中" />
        ) : props.results.length === 0 && props.keyword.trim().length > 0 ? (
          <p className="rd-empty">未找到匹配</p>
        ) : (
          <div className="rd-search-results">
            {props.results.map((item, index) => {
              const pieces = splitByHighlights(item.snippet, props.keyword);
              return (
                <button
                  type="button"
                  className="rd-search-card"
                  key={`r${String(index)}`}
                  onClick={() => props.onSelectResult(item)}
                >
                  <p className="rd-search-card-title">{item.chapterTitle}</p>
                  <p className="rd-search-card-snippet">
                    {pieces.map((piece, pieceIndex) =>
                      piece.hit ? (
                        <span className="rd-search-hit" key={`sh${String(pieceIndex)}`}>
                          {piece.text}
                        </span>
                      ) : (
                        <span key={`st${String(pieceIndex)}`}>{piece.text}</span>
                      ),
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        )}
        <div className="rd-dialog-actions">
          <button type="button" className="rd-text-btn" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** ReaderScreen.kt:4314-4402 — 书签记录面板. */
function AnnotationsSheet(props: {
  bookmarks: ReadonlyArray<Bookmark>;
  onSelect: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="rd-sheet-backdrop" onClick={props.onClose}>
      <div className="rd-sheet" onClick={(event) => event.stopPropagation()}>
        <h2 className="rd-sheet-title rd-sheet-title--sm">{`书签记录 (${props.bookmarks.length})`}</h2>
        <div className="rd-spacer-12" />
        {props.bookmarks.length === 0 ? (
          <p className="rd-empty">无书签</p>
        ) : (
          <div className="rd-bookmark-list">
            {props.bookmarks.map((bookmark) => (
              <div className="rd-bookmark-row" key={`b${String(bookmark.id ?? 0)}`}>
                <button
                  type="button"
                  className="rd-bookmark-main"
                  onClick={() => props.onSelect(bookmark)}
                >
                  <p className="rd-bookmark-title">{bookmark.title}</p>
                  <p className="rd-bookmark-snippet">{bookmark.snippet}</p>
                </button>
                <button
                  type="button"
                  className="rd-icon-btn"
                  aria-label="删除"
                  onClick={() => props.onDelete(bookmark)}
                >
                  <Glyph name="🗑" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** ReaderScreen.kt:4406-4534 — 定时休息提醒. */
function RestDialog(props: { restMinutes: number; onClose: () => void }): ReactNode {
  return (
    <div className="rd-dialog-backdrop" onClick={props.onClose}>
      <div className="rd-rest-card" onClick={(event) => event.stopPropagation()}>
        <div className="rd-rest-row">
          <div className="rd-rest-left">
            <Glyph name="⏲" size={28} />
            <span>
              <p className="rd-rest-title">定时休息提醒</p>
              <p className="rd-rest-body">
                {`已持续阅读 ${props.restMinutes} 分钟，建议远眺片刻！`}
              </p>
            </span>
          </div>
          <button type="button" className="rd-text-btn" onClick={props.onClose}>
            好的
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// NovelImageFullscreenViewer
// ═════════════════════════════════════════════════════════════════════════════

/**
 * reader/NovelImageFullscreenViewer.kt:46-172
 * ADAPTATION: `detectTransformGestures`（捏合缩放 + 拖动平移）→ Pointer Events +
 * `setPointerCapture` + 多指针 `Map<pointerId, {x, y}>`；
 * `graphicsLayer{scaleX/scaleY/translationX/translationY}` → CSS transform。
 */
function ImageFullscreenViewer(props: { path: string; onDismiss: () => void }): ReactNode {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ lastDist: 0, lastX: 0, lastY: 0 });
  const latestScale = useRef(1);
  useEffect(() => {
    latestScale.current = scale;
  }, [scale]);

  useEffect(() => {
    let cancelled = false;
    void inlineImageDecoder.resolve(props.path).then((url) => {
      if (cancelled) return;
      setSrc(url);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [props.path]);

  return (
    <div className="rd-fullscreen" role="dialog" aria-label="插图全屏">
      <div
        className="rd-fullscreen-stage"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          gesture.current.lastX = event.clientX;
          gesture.current.lastY = event.clientY;
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size >= 2) {
            const points = [...pointers.current.values()];
            const pointA = points[0] ?? { x: 0, y: 0 };
            const pointB = points[1] ?? { x: 0, y: 0 };
            const dist = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
            if (gesture.current.lastDist > 0 && dist > 0) {
              setScale((prev) => Math.min(Math.max(prev * (dist / gesture.current.lastDist), 1), 6));
            }
            gesture.current.lastDist = dist;
            return;
          }
          const dx = event.clientX - gesture.current.lastX;
          const dy = event.clientY - gesture.current.lastY;
          gesture.current.lastX = event.clientX;
          gesture.current.lastY = event.clientY;
          if (latestScale.current > 1) setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          gesture.current.lastDist = 0;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          gesture.current.lastDist = 0;
        }}
        onDoubleClick={() => {
          if (latestScale.current > 1.05) {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          } else {
            setScale(2.5);
          }
        }}
      >
        {src === null && !loaded ? (
          <div className="rd-spinner" role="progressbar" aria-label="图片读取中" />
        ) : src === null ? (
          <p className="rd-fullscreen-error">图片读取失败，请重新导入书籍</p>
        ) : (
          <img
            className="rd-fullscreen-img"
            src={src}
            alt="插图全屏"
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        )}
      </div>
      <div className="rd-fullscreen-bar">
        <button
          type="button"
          className="rd-fullscreen-btn"
          onClick={() => {
            void saveNovelImage(props.path);
          }}
        >
          保存
        </button>
        <button type="button" className="rd-fullscreen-btn" onClick={props.onDismiss}>
          关闭
        </button>
      </div>
    </div>
  );
}

/**
 * reader/NovelImageFullscreen.kt:174-204 `saveNovelImageToGallery`
 * ADAPTATION: `MediaStore` / `Environment.DIRECTORY_PICTURES` → 浏览器下载，
 * 文件名沿用 `novel_img_${System.currentTimeMillis()}.jpg`；
 * 返回值沿用原字符串：`图片读取失败` / `保存失败` / `已保存到相册 Pictures/Ciallo Reader`。
 */
async function saveNovelImage(path: string): Promise<string> {
  const url = await inlineImageDecoder.resolve(path);
  if (url === null) {
    showToast('图片读取失败');
    return '图片读取失败';
  }
  const fileName = `novel_img_${Date.now()}.jpg`;
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    showToast('保存失败');
    return '保存失败';
  }
  showToast('已保存到相册 Pictures/Ciallo Reader');
  return '已保存到相册 Pictures/Ciallo Reader';
}

/** ReaderScreen.kt:408-430 — GetContent("font/ttf") 的 web 替身. */
function HiddenFontInput(): ReactNode {
  return (
    <input
      className="rd-file-input"
      type="file"
      accept="font/ttf,font/otf,application/x-font-ttf"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file === undefined) return;
        void installCustomFontFile(file).then((result) => {
          window.dispatchEvent(
            new CustomEvent('rd-font-loaded', { detail: { family: result.family, name: result.name } }),
          );
        });
      }}
    />
  );
}

/**
 * ADAPTATION of `Typeface.createFromFile`（ReaderScreen.kt:978）：
 * `@font-face` + `FontFace`，object URL 仅会话内有效。
 */
async function installCustomFontFile(file: File): Promise<{ family: string; name: string }> {
  const buffer = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'font/ttf' }));
  const family = 'CialloCustomFont';
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  return { family: `"${family}", sans-serif`, name: file.name };
}

// ═════════════════════════════════════════════════════════════════════════════
// ReaderPage
// ═════════════════════════════════════════════════════════════════════════════

export function ReaderPage() {
  const setRoute = useAppStore((s) => s.setRoute);
  const books = useAppStore((s) => s.books);
  const currentBookId = useAppStore((s) => s.currentBookId);
  const chapters = useAppStore((s) => s.chapters);
  const bookmarks = useAppStore((s) => s.bookmarks);
  const libraryReady = useAppStore((s) => s.libraryReady);
  const openBook = useAppStore((s) => s.openBook);
  const saveReaderProgress = useAppStore((s) => s.saveReaderProgress);
  const toggleBookmarkStore = useAppStore((s) => s.toggleBookmark);
  const storeFontSize = useAppStore((s) => s.fontSize);
  const storeFontFamilyIndex = useAppStore((s) => s.fontFamilyIndex);
  const storePageTurnMode = useAppStore((s) => s.pageTurnMode);
  const storeReaderTheme = useAppStore((s) => s.readerTheme);
  const setFontSizeStore = useAppStore((s) => s.setFontSize);
  const setFontFamilyIndexStore = useAppStore((s) => s.setFontFamilyIndex);
  const setPageTurnModeStore = useAppStore((s) => s.setPageTurnMode);
  const setReaderThemeStore = useAppStore((s) => s.setReaderTheme);

  const book = useMemo(
    () => books.find((item) => item.id === currentBookId) ?? books[0] ?? null,
    [books, currentBookId],
  );

  // ── UI 状态（命名沿用 Kotlin）──────────────────────────────────────────
  const [showTocSheet, setShowTocSheet] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showAnnotationsSheet, setShowAnnotationsSheet] = useState(false);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [showTtsBar, setShowTtsBar] = useState(false);
  const [showRestDialog, setShowRestDialog] = useState(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [autoScrollSpeed] = useState(1); // 0.5=慢 / 1=中 / 2=快
  const [reachedBookEnd, setReachedBookEnd] = useState(false);
  const [celebratedBookComplete, setCelebratedBookComplete] = useState(false);
  const [showBars, setShowBars] = useState(false);
  const [previousPosition, setPreviousPosition] = useState<{
    chapterIndex: number;
    scrollOffset: number;
  } | null>(null);
  const [showReturnChip, setShowReturnChip] = useState(false);
  const [scrubberVisible, setScrubberVisible] = useState(false);
  const [fullscreenNovelImage, setFullscreenNovelImage] = useState<string | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentSubPageIndex, setCurrentSubPageIndex] = useState(0);
  const [currentCharOffset, setCurrentCharOffset] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingSearchJump, setPendingSearchJump] = useState<SearchResultItem | null>(null);
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null);
  const [searchHighlightPage, setSearchHighlightPage] = useState(-1);
  const [searchHighlightBlock, setSearchHighlightBlock] = useState(-1);
  const [searchHighlightAt, setSearchHighlightAt] = useState(0);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [entryToken, setEntryToken] = useState(0);
  const [overscrollPx, setOverscrollPx] = useState(0);
  const [overscrollDirection, setOverscrollDirection] = useState(0);
  const [switchingChapter, setSwitchingChapter] = useState(false);
  const [scrollValue, setScrollValue] = useState(0);
  const [scrollMaxValue, setScrollMaxValue] = useState(0);
  const [dragPos, setDragPos] = useState<number | null>(null);
  const [showReaderMoreMenu, setShowReaderMoreMenu] = useState(false);
  const [customFontCss, setCustomFontCss] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingScrollRatio, setPendingScrollRatio] = useState(-1);
  const [pendingCharTarget, setPendingCharTarget] = useState(-1);

  // ── 排版参数（PreferencesManager ↔ appStore）────────────────────────────
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => ({
    ...DEFAULT_READER_PREFS,
    fontSize: storeFontSize,
    fontFamilyIndex: storeFontFamilyIndex,
    pageTurnMode: storePageTurnMode,
    readerTheme: storeReaderTheme,
  }));

  const stageRef = useElementRef<HTMLDivElement>();
  const stageSize = useElementSize(stageRef);
  const insets = useSafeInsets();
  const viewport = useViewport();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const blockTops = useRef(new Map<number, number>());
  const skipFirstEntry = useRef(true);
  const reanchorKey = useRef<string[] | null>(null);
  const prefsWriteTimer = useRef(0);
const disposeProgress = useRef<{ chapterIndex: number; input: ReaderProgressInput | null }>({
    chapterIndex: 0,
    input: null,
  });

  /**
   * Kotlin `ReaderScreen.kt:690-710`：
   * ```kotlin
   * DisposableEffect(prefs.keepScreenOn) {
   *     val activity = context as? Activity
   *     if (prefs.keepScreenOn) activity?.window?.addFlags(FLAG_KEEP_SCREEN_ON)
   *     else activity?.window?.clearFlags(FLAG_KEEP_SCREEN_ON)
   *     onDispose { activity?.window?.clearFlags(FLAG_KEEP_SCREEN_ON) }
   * }
   * ```
   * 逐条对应：依赖数组是 `prefs.keepScreenOn`（设置变化即重跑），卸载时**无条件**
   * 关闭。Web 侧是 Screen Wake Lock（iOS 需 16.4+；缺 API 时端口会抛
   * `WAKE_LOCK_UNAVAILABLE`，见 `platform/capabilities.ts`）。
   *
   * 此前本条被登记为「SKIPPED（无 Android Window 端口）」，但端口其实早就声明好了
   * 且已装配进 web-mock 与 ios-native 两个工厂 —— 只是没人调用（E52 / E66）。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        if (cancelled) return;
        await getPlatform().screenAwake.setEnabled(prefs.keepScreenOn);
      } catch (error) {
        // 端口不可用（如 iOS < 16.4 无 Wake Lock）：按 Kotlin 的
        // `activity?.window?…` 安全调用语义，记一笔但不打断阅读。
        console.warn('[reader] keepScreenOn 未生效：', describeError(error));
      }
    })();
    return () => {
      cancelled = true;
      // Kotlin `onDispose { clearFlags(FLAG_KEEP_SCREEN_ON) }`
      void (async () => {
        try {
          const { getPlatform } = await import('@platform/index');
          await getPlatform().screenAwake.setEnabled(false);
        } catch {
          // 同上：不可用时无需处理。
        }
      })();
    };
  }, [prefs.keepScreenOn]);

  // ── 沉浸式状态栏（ReaderScreen.kt:709-726）──────────────────────────────
  // ADAPTATION: Kotlin `DisposableEffect(Unit) { hideSystemBars(); onDispose {
  // showSystemBars() } }` —— 进入阅读即隐藏状态栏（带滑动唤起，由平台
  // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE 提供），退出阅读无条件恢复。
  // 依赖数组是 `[]`：与设置无关，仅挂载/卸载各跑一次。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        if (cancelled) return;
        await getPlatform().statusBars.setHidden(true);
      } catch (error) {
        // 端口不可用（web-mock 显式抛错 / Capacitor StatusBar 未装）：按 Kotlin
        // `WindowCompat` 安全调用语义，记一笔但不打断阅读（沉浸由 CSS safe-area 提供）。
        console.warn('[reader] 沉浸式状态栏未生效：', describeError(error));
      }
    })();
    return () => {
      cancelled = true;
      // Kotlin `onDispose { show(statusBars()) }`
      void (async () => {
        try {
          const { getPlatform } = await import('@platform/index');
          await getPlatform().statusBars.setHidden(false);
        } catch {
          // 同上：不可用时无需处理。
        }
      })();
    };
  }, []);

  const chapterCount = chapters.length;
  const currentChapter = chapters[currentChapterIndex] ?? null;
  const nextChapter = chapters[currentChapterIndex + 1] ?? null;
  const prevChapter = chapters[currentChapterIndex - 1] ?? null;
  const scrollMode = isScrollMode(prefs.pageTurnMode);

  // ── 正文准备（ReaderScreen.kt:992-1057）────────────────────────────────
  // ADAPTATION: Kotlin 用 `withContext(Dispatchers.Default)` 异步格式化；JS 的
  // `formatForReader` / `chunkForScroll` 是 O(n) 纯字符串运算，比一次跨线程
  // 调度便宜得多，故改为 `useMemo` 同步计算，`contentReady` 恒为 true。
  const formattedContent = useMemo(
    () => formatForReader(currentChapter?.content ?? '', prefs.firstLineIndent),
    [currentChapter, prefs.firstLineIndent],
  );
  const scrollChunks = useMemo(() => chunkForScroll(formattedContent), [formattedContent]);
  const nextFormattedContent = useMemo(
    () => formatForReader(nextChapter?.content ?? '', prefs.firstLineIndent),
    [nextChapter, prefs.firstLineIndent],
  );
  const prevFormattedContent = useMemo(
    () => formatForReader(prevChapter?.content ?? '', prefs.firstLineIndent),
    [prevChapter, prefs.firstLineIndent],
  );

  // ── 容器尺寸（ReaderScreen.kt:1258-1326）───────────────────────────────
  const headerFooterPadPx =
    HEADER_FOOTER_PAD_DP + (prefs.showOverlayHeaderFooter ? HEADER_FOOTER_EXTRA_DP : 0);
  const containerWidthPx =
    stageSize.width > 0
      ? Math.max(stageSize.width - prefs.marginHorizontal * 2, MIN_CONTAINER_PX)
      : Math.max(viewport.width - prefs.marginHorizontal * 2, MIN_CONTAINER_PX);
  const containerHeightPx =
    stageSize.height > 0
      ? Math.max(stageSize.height - PAGE_VERTICAL_PADDING_DP * 2, MIN_CONTAINER_PX)
      : Math.max(viewport.height - insets.top - insets.bottom - headerFooterPadPx, MIN_CONTAINER_PX);
  const textWidthPx = containerWidthPx;
  const textHeightPx = Math.max(
    containerHeightPx - PAGE_TEXT_BOTTOM_PADDING_DP,
    PAGE_TEXT_BOTTOM_PADDING_DP,
  );

  const fontFamily = readingFontFamilyCss(prefs.fontFamilyIndex, customFontCss);

  const currentTitleReserve = useMemo(
    () =>
      measureTitleReservePx(
        currentChapter?.title ?? null,
        textWidthPx,
        textHeightPx,
        READER_TITLE_FONT_SIZE_PX,
        READER_TITLE_LINE_HEIGHT_PX,
      ),
    [currentChapter, textWidthPx, textHeightPx],
  );
  const nextTitleReserve = useMemo(
    () =>
      measureTitleReservePx(
        nextChapter?.title ?? null,
        textWidthPx,
        textHeightPx,
        READER_TITLE_FONT_SIZE_PX,
        READER_TITLE_LINE_HEIGHT_PX,
      ),
    [nextChapter, textWidthPx, textHeightPx],
  );
  const prevTitleReserve = useMemo(
    () =>
      measureTitleReservePx(
        prevChapter?.title ?? null,
        textWidthPx,
        textHeightPx,
        READER_TITLE_FONT_SIZE_PX,
        READER_TITLE_LINE_HEIGHT_PX,
      ),
    [prevChapter, textWidthPx, textHeightPx],
  );

  // ── 分页（ReaderScreen.kt:1354-1491）───────────────────────────────────
  const currentRequest = useMemo<ChapterPaginationRequest>(
    () => ({
      content: formattedContent,
      widthPx: textWidthPx,
      heightPx: textHeightPx,
      fontSizePx: prefs.fontSize,
      lineHeightPx: prefs.lineHeight,
      fontFamilyKey: fontFamily,
      titleReservePx: currentTitleReserve,
      isScrollMode: scrollMode,
    }),
    [
      formattedContent,
      textWidthPx,
      textHeightPx,
      prefs.fontSize,
      prefs.lineHeight,
      fontFamily,
      currentTitleReserve,
      scrollMode,
    ],
  );
  const nextRequest = useMemo<ChapterPaginationRequest>(
    () => ({
      content: nextFormattedContent,
      widthPx: textWidthPx,
      heightPx: textHeightPx,
      fontSizePx: prefs.fontSize,
      lineHeightPx: prefs.lineHeight,
      fontFamilyKey: fontFamily,
      titleReservePx: nextTitleReserve,
      isScrollMode: scrollMode,
    }),
    [
      nextFormattedContent,
      textWidthPx,
      textHeightPx,
      prefs.fontSize,
      prefs.lineHeight,
      fontFamily,
      nextTitleReserve,
      scrollMode,
    ],
  );
  const prevRequest = useMemo<ChapterPaginationRequest>(
    () => ({
      content: prevFormattedContent,
      widthPx: textWidthPx,
      heightPx: textHeightPx,
      fontSizePx: prefs.fontSize,
      lineHeightPx: prefs.lineHeight,
      fontFamilyKey: fontFamily,
      titleReservePx: prevTitleReserve,
      isScrollMode: scrollMode,
    }),
    [
      prevFormattedContent,
      textWidthPx,
      textHeightPx,
      prefs.fontSize,
      prefs.lineHeight,
      fontFamily,
      prevTitleReserve,
      scrollMode,
    ],
  );

  const pages = useChapterPages(currentRequest);
  const nextPages = useChapterPages(nextRequest);
  const prevPages = useChapterPages(prevRequest);

  const activeSubPageIndex = clampSubPageIndex(pages.length, currentSubPageIndex);

  const theme = readerThemeColors(prefs.readerTheme);
  const barFg = onColor(theme.bg);

  const isCurrentBookmarked = useMemo(
    () =>
      bookmarks.some(
        (item) =>
          (item.bookId === (book?.id ?? 0) || item.bookId === 0) &&
          item.chapterIndex === currentChapterIndex,
      ),
    [bookmarks, book, currentChapterIndex],
  );

  const bookId = book?.id ?? null;

  // ── 挂载：加载偏好 / 打开书籍 ───────────────────────────────────────────
  useEffect(() => {
    const repo = getPrefsRepo();
    if (repo === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadReaderPrefs(repo);
        if (cancelled) return;
        setPrefs((prev) => ({ ...prev, ...loaded }));
      } catch {
        /* 保留默认值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (bookId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        await openBook(bookId);
      } catch (error) {
        if (!cancelled) setLoadError(String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, openBook]);

  // ReaderScreen.kt:339-341 / 760-780 — 进度恢复（以 book.id 为键，避免副本竞态）
  useEffect(() => {
    if (book === null || chapterCount === 0 || book.scrollOffset <= 0) return;
    if (currentChapterIndex !== book.currentChapterIndex) return;
    if (scrollMode) {
      const el = scrollRef.current;
      if (el !== null) scrollElementTo(el, { top: book.scrollOffset });
      return;
    }
    const timer = window.setTimeout(() => setCurrentCharOffset(book.scrollOffset), 0);
    return () => window.clearTimeout(timer);
  }, [book, chapterCount, currentChapterIndex, scrollMode]);

  // ReaderScreen.kt:1099-1105 — 共享封面转场启动（delay 140ms）
  useEffect(() => {
    const timer = window.setTimeout(() => setTransitionStarted(true), TRANSITION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // ReaderScreen.kt:353-358 — 返回上次处气泡 5 秒自动消失
  useEffect(() => {
    if (!showReturnChip) return;
    const timer = window.setTimeout(() => setShowReturnChip(false), RETURN_CHIP_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showReturnChip]);

  // ReaderScreen.kt:399 — `ttsManager.isPlaying.collectAsStateWithLifecycle()` → 监听器注册表
  useEffect(() => platformTtsController.subscribePlaying(setIsTtsPlaying), []);

  // ── 分页重算后按 currentCharOffset 重锚定（ReaderScreen.kt:1501-1529）─────
  useEffect(() => {
    if (scrollMode || pages.length === 0) return;
    if (reanchorKey.current === pages) return;
    reanchorKey.current = pages;
    const timer = window.setTimeout(() => {
      setCurrentSubPageIndex(pageIndexForOffset(pages, currentCharOffset));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pages, scrollMode, currentCharOffset]);

  // ── 相邻页插图预热（ReaderScreen.kt:1660-1677）───────────────────────────
  useEffect(() => {
    if (scrollMode || pages.length === 0) return;
    inlineImageDecoder.prewarm(prewarmImagePathsForPages(pages, activeSubPageIndex));
  }, [activeSubPageIndex, pages, scrollMode]);

  // ── 新章节入场（ReaderScreen.kt:642-682）──────────────────────────────
  useEffect(() => {
    if (!scrollMode) return;
    if (skipFirstEntry.current) {
      skipFirstEntry.current = false;
      return;
    }
    const timer = window.setTimeout(() => setEntryToken((token) => token + 1), 0);
    return () => window.clearTimeout(timer);
  }, [currentChapterIndex, scrollMode]);

  // ── 模式切换锚定（ReaderScreen.kt:1061-1089）──────────────────────────
  useEffect(() => {
    if (!scrollMode || scrollMaxValue <= 0 || pendingScrollRatio < 0) return;
    const timer = window.setTimeout(() => {
      setPendingScrollRatio(-1);
      const el = scrollRef.current;
      if (el === null) return;
      scrollElementTo(el, { top: scrollTargetForRatio(scrollMaxValue, pendingScrollRatio) });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scrollMode, scrollMaxValue, pendingScrollRatio]);

  useEffect(() => {
    if (scrollMode || pendingCharTarget < 0) return;
    const timer = window.setTimeout(() => {
      setCurrentCharOffset(pendingCharTarget);
      setPendingCharTarget(-1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scrollMode, pendingCharTarget]);

  // ── 搜索跳转（ReaderScreen.kt:1551-1658 滚动 / 1679-1714 翻页）──────────
  useEffect(() => {
    if (pendingSearchJump === null) return;
    if (currentChapterIndex !== pendingSearchJump.chapterIndex) return;
    const jump = pendingSearchJump;
    const query = searchHighlightQuery ?? '';
    const timer = window.setTimeout(() => {
      if (!scrollMode) {
        if (pages.length === 0) return;
        const pos = SearchLocator.nthOccurrence(formattedContent, query, jump.occurrence);
        const page = findPageForPosition(pages, pos);
        if (page < 0) return;
        setSearchHighlightPage(page);
        setSearchHighlightAt(Date.now());
        setCurrentSubPageIndex(page);
        setCurrentCharOffset(pages.slice(0, page).reduce((sum, item) => sum + item.length, 0));
        setPendingSearchJump(null);
        return;
      }
      if (scrollChunks.length === 0 || formattedContent.length === 0) return;
      const pos = SearchLocator.nthOccurrence(formattedContent, query, jump.occurrence);
      if (pos < 0) {
        setPendingSearchJump(null);
        return;
      }
      const target = findScrollBlockTarget(scrollBlockMeta(scrollChunks, textWidthPx), pos);
      setSearchHighlightBlock(target.blockIndex);
      const el = scrollRef.current;
      if (el === null) return;
      // 等待目标块完成布局（ReaderScreen.kt:1615-1632 最多让出几帧）
      let tries = 0;
      const seek = (): void => {
        const top = blockTops.current.get(target.blockIndex);
        if (top === undefined && tries < SEARCH_JUMP_FRAME_TRIES) {
          tries += 1;
          window.requestAnimationFrame(seek);
          return;
        }
        const max = Math.max(el.scrollHeight - el.clientHeight, 0);
        scrollElementTo(el, { top: Math.min(Math.max(Math.trunc(top ?? 0), 0), max) });
        setPendingSearchJump(null);
      };
      window.requestAnimationFrame(seek);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    pendingSearchJump,
    currentChapterIndex,
    scrollMode,
    pages,
    scrollChunks,
    formattedContent,
    searchHighlightQuery,
    textWidthPx,
  ]);

  // 离开目标页后清除高亮（ReaderScreen.kt:1716-1728）
  useEffect(() => {
    if (searchHighlightQuery === null) return;
    const elapsed = Date.now() - searchHighlightAt;
    const delay = Math.max(0, SEARCH_HIGHLIGHT_KEEP_MS - elapsed) + 16;
    const timer = window.setTimeout(() => {
      if (
        shouldClearSearchHighlight(
          searchHighlightQuery,
          activeSubPageIndex,
          searchHighlightPage,
          Date.now() - searchHighlightAt,
        )
      ) {
        setSearchHighlightQuery(null);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [searchHighlightQuery, activeSubPageIndex, searchHighlightPage, searchHighlightAt]);

  // ── 切章立即读取正文（ReaderScreen.kt:785-789）─────────────────────────
  const ensureChapterLoaded = useCallback((id: number, index: number): void => {
    const chapter = useAppStore.getState().chapters[index];
    if (chapter !== undefined && chapter.content.length > 0) return;
    void useAppStore.getState().openBook(id);
  }, []);
  useEffect(() => {
    if (bookId === null || chapterCount === 0) return;
    ensureChapterLoaded(bookId, currentChapterIndex);
  }, [bookId, currentChapterIndex, chapterCount, ensureChapterLoaded]);

  // ── 进度保存（ReaderScreen.kt:793-869）─────────────────────────────────
  const progressInput = useMemo<ReaderProgressInput>(
    () => ({
      bookFinishedOrReachedEnd: reachedBookEnd,
      isScrollMode: scrollMode,
      chapterIndex: currentChapterIndex,
      chapterCount,
      currentChapterContentEmpty: (currentChapter?.content.length ?? 0) === 0,
      scrollOffset: scrollValue,
      scrollMaxValue,
      charOffset: currentCharOffset,
    }),
    [
      reachedBookEnd,
      scrollMode,
      currentChapterIndex,
      chapterCount,
      currentChapter,
      scrollValue,
      scrollMaxValue,
      currentCharOffset,
    ],
  );

  // ReaderScreen.kt:793-805 — 翻页 / 模式切换：立即保存进度
  useEffect(() => {
    disposeProgress.current = {
      chapterIndex: currentChapterIndex,
      input: progressInput,
    };
    if (bookId === null || chapterCount === 0) return;
    const resolved = resolveReaderProgress(progressInput);
    saveReaderProgress(currentChapterIndex, resolved.offset, resolved.isFinished);
  }, [bookId, chapterCount, currentChapterIndex, scrollMode, progressInput, saveReaderProgress]);

  // ReaderScreen.kt:811-827 — 滚动模式：1.5 秒防抖保存
  useDeferredEffect(
    () => {
      if (!scrollMode || bookId === null || chapterCount === 0) return;
      const resolved = resolveReaderProgress(progressInput);
      saveReaderProgress(currentChapterIndex, resolved.offset, resolved.isFinished);
    },
    SCROLL_SAVE_DEBOUNCE_MS,
    [scrollMode, bookId, chapterCount, progressInput, currentChapterIndex, saveReaderProgress],
  );

  // ReaderScreen.kt:851-869 — 退出阅读页时兜底保存一次（DisposableEffect(Unit)）
  useEffect(
    () => () => {
      const snapshot = disposeProgress.current;
      if (snapshot.input === null) return;
      const resolved = resolveReaderProgress(snapshot.input);
      useAppStore.getState().saveReaderProgress(
        snapshot.chapterIndex,
        resolved.offset,
        resolved.isFinished,
      );
    },
    [],
  );

  // ── 书签（ReaderScreen.kt:873-901）────────────────────────────────────
  const toggleBookmark = useCallback((): void => {
    if (book === null) return;
    const id = book.id;
    const existing = bookmarks.find(
      (item) =>
        (item.bookId === id || item.bookId === 0) && item.chapterIndex === currentChapterIndex,
    );
    if (existing !== undefined) {
      void toggleBookmarkStore(
        currentChapterIndex,
        existing.scrollOffset,
        existing.title,
        existing.snippet,
      );
      showToast('已取消书签');
      return;
    }
    const chapter = currentChapter;
    if (chapter === null) return;
    void toggleBookmarkStore(
      currentChapterIndex,
      scrollMode ? scrollValue : currentCharOffset,
      chapter.title,
      bookmarkSnippet(chapter.content, 60),
    );
  }, [
    book,
    bookmarks,
    currentChapterIndex,
    currentChapter,
    toggleBookmarkStore,
    scrollMode,
    scrollValue,
    currentCharOffset,
  ]);

  // ── 翻页 / 切章（ReaderScreen.kt:1732-1809）───────────────────────────
  const updateSubPage = useCallback(
    (newIndex: number): void => {
      const next = subPageState(pages, newIndex);
      setCurrentSubPageIndex(next.pageIndex);
      setCurrentCharOffset(next.charOffset);
    },
    [pages],
  );

  const scrollToTop = useCallback((): void => {
    const el = scrollRef.current;
    if (el !== null) scrollElementTo(el, { top: 0 });
    setScrollValue(0);
  }, []);

  const switchChapter = useCallback(
    (direction: 1 | -1): void => {
      if (switchingChapter) return;
      setOverscrollPx(0);
      setOverscrollDirection(0);
      setSwitchingChapter(true);
      const target = chapterSwitchTarget(currentChapterIndex, chapterCount, direction);
      window.setTimeout(() => {
        if (target !== null) setCurrentChapterIndex(target);
        scrollToTop();
        setSwitchingChapter(false);
      }, SWITCH_PULL_MS);
    },
    [switchingChapter, currentChapterIndex, chapterCount, scrollToTop],
  );

  const handleNextPage = useCallback((): void => {
    // REVIEW-2026-10-06：删除 EXTRA `getPageFlipSound().play()`。
    // Android 全仓只有 `ui/pageturn/PageScrubber.kt:97` 一处 `soundPool.load(R.raw.page_flip)`
    // （串珠快速翻页遮罩进场/掠页时播），普通翻页**不播声音**。
    if (scrollMode) {
      if (currentChapterIndex < chapterCount - 1) {
        setCurrentChapterIndex(currentChapterIndex + 1);
        scrollToTop();
      }
      return;
    }
    if (
      !celebratedBookComplete &&
      shouldCelebrateAfterForwardTurn(
        currentChapterIndex,
        chapterCount,
        activeSubPageIndex,
        pages,
        formattedContent.length,
      )
    ) {
      setCelebratedBookComplete(true);
      setReachedBookEnd(true);
      // MascotAnimationController.play(MascotEvent.BookComplete)（ReaderScreen.kt:1752）
      setShowEasterEgg(true);
      window.setTimeout(() => setShowEasterEgg(false), 1600);
    }
    const turn = nextReaderLocation({
      pageIndex: activeSubPageIndex,
      pageCount: pages.length,
      chapterIndex: currentChapterIndex,
      chapterCount,
    });
    if (turn.kind === 'page') {
      if (turn.pageIndex !== activeSubPageIndex) updateSubPage(turn.pageIndex);
      return;
    }
    setCurrentChapterIndex(turn.chapterIndex);
    setCurrentCharOffset(turn.charOffset);
    setCurrentSubPageIndex(turn.pageIndex);
    scrollToTop();
  }, [
    scrollMode,
    currentChapterIndex,
    chapterCount,
    activeSubPageIndex,
    pages,
    formattedContent.length,
    celebratedBookComplete,
    updateSubPage,
    scrollToTop,
  ]);

  const handlePrevPage = useCallback((): void => {
    // 同上：普通翻页不播翻纸声（Android 只有 PageScrubber 播）。
    if (scrollMode) {
      if (currentChapterIndex > 0) {
        setCurrentChapterIndex(currentChapterIndex - 1);
        scrollToTop();
      }
      return;
    }
    const turn = prevReaderLocation({
      pageIndex: activeSubPageIndex,
      chapterIndex: currentChapterIndex,
    });
    if (turn.kind === 'page') {
      if (turn.pageIndex !== activeSubPageIndex) updateSubPage(turn.pageIndex);
      return;
    }
    setCurrentChapterIndex(turn.chapterIndex);
    setCurrentCharOffset(turn.charOffset);
    setCurrentSubPageIndex(turn.pageIndex);
    scrollToTop();
  }, [scrollMode, currentChapterIndex, activeSubPageIndex, updateSubPage, scrollToTop]);

  // ── 切换阅读模式（ReaderScreen.kt:904-948）────────────────────────────
  const switchPageMode = useCallback(
    (newModeId: number): void => {
      const anchor = modeSwitchAnchor({
        oldMode: prefs.pageTurnMode,
        newMode: newModeId,
        currentCharOffset,
        contentLength: currentChapter?.content.length ?? 0,
        scrollValue,
        scrollMaxValue,
      });
      if (anchor.pendingScrollRatio >= 0) setPendingScrollRatio(anchor.pendingScrollRatio);
      if (anchor.pendingCharTarget >= 0) setPendingCharTarget(anchor.pendingCharTarget);
      setPrefs((prev) => ({ ...prev, pageTurnMode: newModeId }));
      setPageTurnModeStore(newModeId);
      void persistReaderPrefs({ pageTurnMode: newModeId });
      // 切换翻页模式时关闭自动滚屏（仅滚动模式支持）
      setIsAutoScrolling(false);
    },
    [prefs.pageTurnMode, currentCharOffset, currentChapter, scrollValue, scrollMaxValue, setPageTurnModeStore],
  );

  // ── 排版参数变更（ReaderScreen.kt:3803-4163）──────────────────────────
  const applyPrefs = useCallback(
    (patch: Partial<ReaderPrefs>): void => {
      setPrefs((prev) => ({ ...prev, ...patch }));
      if (patch.fontSize !== undefined) setFontSizeStore(patch.fontSize);
      if (patch.fontFamilyIndex !== undefined) setFontFamilyIndexStore(patch.fontFamilyIndex);
      if (patch.readerTheme !== undefined) setReaderThemeStore(patch.readerTheme);
      window.clearTimeout(prefsWriteTimer.current);
      prefsWriteTimer.current = window.setTimeout(() => {
        void persistReaderPrefs(patch);
      }, PREFS_WRITE_DEBOUNCE_MS);
    },
    [setFontSizeStore, setFontFamilyIndexStore, setReaderThemeStore],
  );

  const resetTypography = useCallback((): void => {
    applyPrefs({
      fontSize: DEFAULT_READER_PREFS.fontSize,
      lineHeight: DEFAULT_READER_PREFS.lineHeight,
      marginHorizontal: DEFAULT_READER_PREFS.marginHorizontal,
      readerBrightness: DEFAULT_READER_PREFS.readerBrightness,
    });
    showToast('排版参数已重置');
  }, [applyPrefs]);

  // ── TTS（ReaderScreen.kt:2907-2947 / 3312-3344 / 3596-3646）──────────
  const startTts = useCallback((): void => {
    setShowTtsBar(true);
    setIsAutoScrolling(false); // 与 TTS 互斥
    if (platformTtsController.getPlayingSafe()) return;
    const chapter = currentChapter;
    if (chapter === null) return;
    void platformTtsController.startReading(stripTokens(chapter.content), {
      speed: prefs.ttsSpeed,
      pitch: prefs.ttsPitch,
    });
    showToast('已开启语音听书');
  }, [currentChapter, prefs.ttsSpeed, prefs.ttsPitch]);

  const togglePlayPause = useCallback((): void => {
    if (platformTtsController.getPlayingSafe()) {
      void platformTtsController.pause();
      return;
    }
    const chapter = currentChapter;
    if (chapter === null) return;
    void platformTtsController.startReading(stripTokens(chapter.content), {
      speed: prefs.ttsSpeed,
      pitch: prefs.ttsPitch,
    });
  }, [currentChapter, prefs.ttsSpeed, prefs.ttsPitch]);

  const toggleAutoScroll = useCallback((): void => {
    if (!scrollMode) {
      showToast('自动滚屏需切换到滚动模式');
      return;
    }
    setIsAutoScrolling((prev) => {
      const next = !prev;
      if (next && platformTtsController.getPlayingSafe()) void platformTtsController.pause();
      return next;
    });
  }, [scrollMode]);

  // ── 目录 / 书签 / 搜索跳转 ────────────────────────────────────────────
  const jumpToChapter = useCallback(
    (index: number): void => {
      setPreviousPosition({ chapterIndex: currentChapterIndex, scrollOffset: scrollValue });
      setShowReturnChip(true);
      setCurrentChapterIndex(index);
      scrollToTop();
    },
    [currentChapterIndex, scrollValue, scrollToTop],
  );

  const runSearch = useCallback((keyword: string): void => {
    setSearchKeyword(keyword);
    const query = keyword.trim();
    if (query.length === 0) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const id = useAppStore.getState().currentBookId;
    const repo = getBookRepository();
    if (repo === null || id === null) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    void repo
      .searchChapters(id, query)
      .then((rows) => {
        const all = useAppStore.getState().chapters;
        const results = SearchLocator.buildResults(
          rows,
          query,
          (chapterOrder) => chapterOrder,
          (logicalIndex) => all[logicalIndex]?.title ?? null,
        );
        setSearchResults(results);
        setIsSearching(false);
      })
      .catch(() => {
        setSearchResults([]);
        setIsSearching(false);
      });
  }, []);

  const onSelectSearchResult = useCallback(
    (item: SearchResultItem): void => {
      setPreviousPosition({ chapterIndex: currentChapterIndex, scrollOffset: scrollValue });
      setShowReturnChip(true);
      setCurrentChapterIndex(item.chapterIndex);
      setSearchHighlightQuery(searchKeyword);
      setPendingSearchJump(item);
      setShowSearchDialog(false);
    },
    [currentChapterIndex, scrollValue, searchKeyword],
  );

  const onSelectBookmark = useCallback(
    (bookmark: Bookmark): void => {
      setPreviousPosition({ chapterIndex: currentChapterIndex, scrollOffset: scrollValue });
      setShowReturnChip(true);
      setCurrentChapterIndex(bookmark.chapterIndex);
      setShowAnnotationsSheet(false);
      window.setTimeout(() => {
        const el = scrollRef.current;
        if (el !== null && scrollMode) scrollElementTo(el, { top: bookmark.scrollOffset });
      }, 0);
    },
    [currentChapterIndex, scrollValue, scrollMode],
  );

  const onDeleteBookmark = useCallback((bookmark: Bookmark): void => {
    const repo = getBookRepository();
    const id = useAppStore.getState().currentBookId;
    if (repo === null || id === null || bookmark.id === undefined) return;
    void repo
      .removeBookmark(bookmark.id)
      .then(() => repo.getBookmarks(id))
      .then((rows) => useAppStore.setState({ bookmarks: rows }));
  }, []);

  // ── 阅读计时 + 休息提醒（ReaderScreen.kt:734-756）─────────────────────
  const readingTimerArgs = useMemo(
    () => ({
      bookId,
      bookTitle: currentChapter?.title ?? book?.title ?? '',
      onFlush: (seconds: number) => {
        void seconds;
      },
      onSessionEnd: (session: ReadingSessionLike) => {
        void session;
      },
      onRestTick: (elapsedSeconds: number) => {
        if (shouldShowRestReminder(prefs.restReminderMinutes, elapsedSeconds)) {
          setShowRestDialog(true);
        }
      },
    }),
    [bookId, currentChapter, book, prefs.restReminderMinutes],
  );
  useReadingTimer(readingTimerArgs);

  useAutoScroll({
    enabled: isAutoScrolling,
    scrollMode,
    speed: autoScrollSpeed,
    scrollRef,
    onReachedEnd: () => setIsAutoScrolling(false),
  });

  // ── 滚动模式边界拉动手势 ──────────────────────────────────────────────
  const onBoundaryPull = useCallback((deltaPx: number, direction: number): void => {
    if (direction === 0) {
      setOverscrollPx(0);
      setOverscrollDirection(0);
      return;
    }
    setOverscrollPx((prev) => prev + deltaPx);
    setOverscrollDirection(direction);
  }, []);

  const onBoundaryRelease = useCallback(
    (totalPx: number, direction: number): void => {
      if (direction !== 0 && totalPx >= SCROLL_THRESHOLD_DP && !switchingChapter) {
        switchChapter(direction === 1 ? 1 : -1);
        return;
      }
      setOverscrollPx(0);
      setOverscrollDirection(0);
    },
    [switchingChapter, switchChapter],
  );

  useBoundaryPull({
    scrollRef,
    enabled: scrollMode,
    hasPrev: currentChapterIndex > 0,
    hasNext: currentChapterIndex < chapterCount - 1,
    switching: switchingChapter,
    onPull: onBoundaryPull,
    onRelease: onBoundaryRelease,
    onTap: () => setShowBars((prev) => !prev),
  });

  // 自定义字体加载完成回调（由 HiddenFontInput 派发）
  useEffect(() => {
    const onLoaded = (event: Event): void => {
      const detail = (event as CustomEvent<{ family: string; name: string }>).detail;
      setCustomFontCss(detail.family);
      applyPrefs({ customFontPath: detail.name, fontFamilyIndex: CUSTOM_FONT_INDEX });
      showToast('自定义字体已导入');
    };
    window.addEventListener('rd-font-loaded', onLoaded);
    return () => window.removeEventListener('rd-font-loaded', onLoaded);
  }, [applyPrefs]);

  // ── 排版 CSS 变量 ─────────────────────────────────────────────────────
  const rootStyle = useMemo(
    () =>
      ({
        background: theme.bg,
        color: theme.text,
        '--rd-margin': `${prefs.marginHorizontal}px`,
        '--rd-bar-bg': withAlpha(theme.bg, 0.97),
        '--rd-bar-fg': barFg,
        '--rd-bar-line': withAlpha(barFg, 0.08),
        '--rd-text-92': withAlpha(theme.text, 0.92),
        '--rd-text-75': withAlpha(theme.text, 0.75),
        '--rd-overlay-color': withAlpha(theme.text, 0.5),
        '--rd-primary': MINT_PRIMARY,
        '--rd-gold': MINT_GOLD,
        '--rd-surface': theme.bg,
        '--rd-on-surface': theme.text,
        '--rd-on-surface-variant': withAlpha(theme.text, 0.62),
        '--rd-outline-variant': withAlpha(theme.text, 0.16),
        '--rd-surface-variant': withAlpha(theme.text, 0.08),
      }) as CSSProperties,
    [theme, prefs.marginHorizontal, barFg],
  );

  const dimAlpha = (1 - prefs.readerBrightness) * DIM_ALPHA_SCALE;

  const readerLoading = !libraryReady || chapterCount === 0 || (!scrollMode && pages.length === 0);
  const unsupported =
    currentChapter?.title === UNSUPPORTED_CHAPTER_TITLE &&
    (currentChapter?.content ?? '').trim().length === 0;
  const emptyChapter = !readerLoading && (currentChapter?.content ?? '').trim().length === 0;

  const followPx =
    overscrollDirection === 1 ? -overscrollPx * OVERSCROLL_FOLLOW : overscrollPx * OVERSCROLL_FOLLOW;
  const settle = overscrollDirection === 0 && !switchingChapter;

  const renderPage = (
    pageIndex: number,
    pageText: string,
    chapterTitle: string | null,
    titleReservePx: number,
    registerImageHit: boolean,
    interactive: boolean,
  ): ReactNode => (
    <SinglePage
      pageIndex={pageIndex}
      pageText={pageText}
      chapterTitle={chapterTitle}
      bg={theme.bg}
      textColor={theme.text}
      fontFamily={fontFamily}
      fontSizePx={prefs.fontSize}
      lineHeightPx={prefs.lineHeight}
      titleReservePx={titleReservePx}
      marginHorizontal={prefs.marginHorizontal}
      contentWidthPx={textWidthPx}
      maxImageHeightPx={textHeightPx}
      highlightQuery={searchHighlightQuery}
      registerImageHit={registerImageHit}
      interactive={interactive}
      onImageClick={setFullscreenNovelImage}
    />
  );

  const currentSlot = scrollMode ? (
    <ScrollChapter
      chapterTitle={currentChapter?.title ?? ''}
      hasPrevChapter={currentChapterIndex > 0}
      hasNextChapter={currentChapterIndex < chapterCount - 1}
      chunks={scrollChunks}
      contentWidthPx={textWidthPx}
      highlightQuery={searchHighlightQuery}
      highlightBlockIndex={searchHighlightBlock}
      fontFamily={fontFamily}
      fontSizePx={prefs.fontSize}
      lineHeightPx={prefs.lineHeight}
      textColor={theme.text}
      onImageTap={setFullscreenNovelImage}
      onGeometry={(index, topY) => {
        blockTops.current.set(index, topY);
      }}
    />
  ) : (
    renderPage(
      activeSubPageIndex,
      pages[activeSubPageIndex] ?? '',
      currentChapter?.title ?? null,
      currentTitleReserve,
      true,
      true,
    )
  );

  const nextSlot = scrollMode
    ? null
    : activeSubPageIndex < pages.length - 1
      ? renderPage(
          activeSubPageIndex + 1,
          pages[activeSubPageIndex + 1] ?? '',
          currentChapter?.title ?? null,
          currentTitleReserve,
          false,
          false,
        )
      : nextChapter !== null
        ? renderPage(0, nextPages[0] ?? '', nextChapter.title, nextTitleReserve, false, false)
        : renderPage(0, '已经是最后一页了', null, currentTitleReserve, false, false);

  const prevLastIndex = Math.max(prevPages.length - 1, 0);
  const prevSlot = scrollMode
    ? null
    : activeSubPageIndex > 0
      ? renderPage(
          activeSubPageIndex - 1,
          pages[activeSubPageIndex - 1] ?? '',
          currentChapter?.title ?? null,
          currentTitleReserve,
          false,
          false,
        )
      : prevChapter !== null
        ? renderPage(
            prevLastIndex,
            prevPages[prevLastIndex] ?? '',
            prevChapter.title,
            prevTitleReserve,
            false,
            false,
          )
        : renderPage(0, '已经是第一页了', null, currentTitleReserve, false, false);

  const onImageTapAt = useCallback(
    (point: { x: number; y: number }): boolean => {
      const hit = imageHitRegistry.hit(point.x, point.y);
      if (hit !== null) {
        setFullscreenNovelImage(hit);
        return true;
      }
      imageHitRegistry.purgeStale();
      return false;
    },
    [],
  );

  return (
    <div className="reader-page rd-root" style={rootStyle}>
      <ReaderCoverLayer coverUri={book?.coverUri ?? null} started={transitionStarted} />

      <div className="rd-content-layer">
        {prefs.showOverlayHeaderFooter ? (
          <ReaderOverlayHeader title={currentChapter?.title ?? ''} hidden={showBars} />
        ) : null}

        <div className="rd-stage" ref={stageRef}>
          {loadError !== null ? (
            <LoadErrorState
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                if (bookId !== null) void openBook(bookId);
              }}
            />
          ) : readerLoading ? (
            <ReaderLoading />
          ) : unsupported ? (
            <UnsupportedChapterState />
          ) : emptyChapter ? (
            <EmptyChapterState />
          ) : scrollMode ? (
            <div
              className="rd-scroll"
              ref={scrollRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                setScrollValue(el.scrollTop);
                setScrollMaxValue(Math.max(el.scrollHeight - el.clientHeight, 0));
              }}
            >
              <div
                key={`${String(currentChapterIndex)}-${String(entryToken)}`}
                className={entryToken > 0 ? 'rd-scroll-inner rd-chapter-entry' : 'rd-scroll-inner'}
                style={
                  {
                    transform: `translateY(${followPx}px)`,
                    '--rd-entry-offset': `${String(CHAPTER_ENTRY_PULL_DP)}px`,
                    transition: switchingChapter
                      ? 'transform 110ms cubic-bezier(0, 0, 0.58, 1)'
                      : settle
                        ? 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)'
                        : undefined,
                  } as CSSProperties
                }
              >
                <div
                  className="rd-scroll-inner-pad"
                  style={{ padding: `16px ${prefs.marginHorizontal}px` }}
                >
                  {currentSlot}
                </div>
              </div>
            </div>
          ) : (
            <PageTurnHost
              mode={prefs.pageTurnMode}
              pageKey={`${currentChapterIndex}-${activeSubPageIndex}`}
              currentSlot={currentSlot}
              nextSlot={nextSlot}
              prevSlot={prevSlot}
              menuVisible={showBars}
              isBookmarked={isCurrentBookmarked}
              paperColor={theme.bg}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              onClickCenter={() => setShowBars((prev) => !prev)}
              onToggleBookmark={toggleBookmark}
              onLongPressCenter={() => {
                if (pages.length >= 2) setScrubberVisible(true);
              }}
              onImageTapAt={onImageTapAt}
            />
          )}

          <PullSwitchChip
            direction={scrollMode && !switchingChapter ? overscrollDirection : 0}
            progress={pullProgress(overscrollPx, SCROLL_THRESHOLD_DP)}
          />

          {isCurrentBookmarked ? (
            <div className="rd-ribbon-slot">
              <BookmarkRibbon />
            </div>
          ) : null}

          {showTtsBar ? (
            <TtsBar
              playing={isTtsPlaying}
              onClose={() => setShowTtsBar(false)}
              onPrevious={() => void platformTtsController.previousParagraph()}
              onPlayPause={togglePlayPause}
              onNext={() => void platformTtsController.nextParagraph()}
            />
          ) : null}

          {showReturnChip && previousPosition !== null ? (
            <ReturnChip
              onClick={() => {
                const pos = previousPosition;
                if (pos !== null) {
                  setCurrentChapterIndex(pos.chapterIndex);
                  window.setTimeout(() => {
                    const el = scrollRef.current;
                    if (el !== null && scrollMode) scrollElementTo(el, { top: pos.scrollOffset });
                  }, 0);
                }
                setShowReturnChip(false);
              }}
            />
          ) : null}
        </div>

        {prefs.showOverlayHeaderFooter ? (
          <ReaderOverlayFooter
            progressText={readerProgressFooterText(
              scrollMode,
              currentChapterIndex,
              chapterCount,
              activeSubPageIndex,
              pages.length,
            )}
            percentText={`${readerPercent(currentChapterIndex, chapterCount)}%`}
            hidden={showBars}
          />
        ) : null}
      </div>

      {isAutoScrolling ? <AutoScrollPill onStop={() => setIsAutoScrolling(false)} /> : null}

      {shouldShowBackToTop(scrollMode, isAutoScrolling, scrollValue, scrollMaxValue) ? (
        <BackToTopButton
          onClick={() => {
            const el = scrollRef.current;
            if (el !== null) scrollElementTo(el, { top: 0, behavior: 'smooth' });
          }}
        />
      ) : null}

      {dimAlpha > 0.002 ? (
        <div className="rd-dim" style={{ opacity: dimAlpha, transitionDuration: '160ms' }} />
      ) : null}

      {showBars ? (
        <button
          type="button"
          className="rd-scrim"
          aria-label="关闭菜单"
          onClick={() => setShowBars(false)}
        />
      ) : null}

      {showBars ? (
        <ReaderTopBar
          chapterTitle={currentChapter?.title ?? book?.title ?? ''}
          chapterCount={chapterCount}
          chapterIndex={currentChapterIndex}
          barFg={barFg}
          barBg={withAlpha(theme.bg, 0.97)}
          barLine={withAlpha(barFg, 0.08)}
          bookmarked={isCurrentBookmarked}
          ttsPlaying={isTtsPlaying}
          autoScrolling={isAutoScrolling}
          showMoreMenu={showReaderMoreMenu}
          onBack={() => setRoute('main')}
          onToggleBookmark={toggleBookmark}
          onToggleTts={startTts}
          onOpenToc={() => setShowTocSheet(true)}
          onToggleMoreMenu={() => setShowReaderMoreMenu((prev) => !prev)}
          onSearch={() => setShowSearchDialog(true)}
          onBookmarks={() => setShowAnnotationsSheet(true)}
          onAutoScroll={toggleAutoScroll}
          onTypography={() => setShowSettingsSheet(true)}
        />
      ) : null}

      {showBars && chapterCount > 0 ? (
        <ReaderBottomBar
          barFg={barFg}
          barBg={withAlpha(theme.bg, 0.97)}
          barLine={withAlpha(barFg, 0.08)}
          isScrollMode={scrollMode}
          pageCount={pages.length}
          pageIndex={activeSubPageIndex}
          chapterIndex={currentChapterIndex}
          chapterCount={chapterCount}
          chapterTitle={currentChapter?.title ?? ''}
          scrollValue={scrollValue}
          scrollMaxValue={scrollMaxValue}
          dragPos={dragPos}
          ttsPlaying={isTtsPlaying}
          onPrevChapter={() => {
            if (currentChapterIndex > 0) {
              setCurrentChapterIndex(currentChapterIndex - 1);
              scrollToTop();
            }
          }}
          onNextChapter={() => {
            if (currentChapterIndex < chapterCount - 1) {
              setCurrentChapterIndex(currentChapterIndex + 1);
              scrollToTop();
            }
          }}
          onDragChange={setDragPos}
          onPageSelected={updateSubPage}
          onScrollSelected={(pos) => {
            const el = scrollRef.current;
            if (el !== null) scrollElementTo(el, { top: Math.trunc(pos * scrollMaxValue) });
          }}
          onToggleTts={startTts}
        />
      ) : null}

      {!scrollMode && scrubberVisible && pages.length >= 2 ? (
        <PageScrubberOverlay
          pageCount={pages.length}
          initialPage={activeSubPageIndex}
          pageFlipSoundUrl={PAGE_FLIP_SOUND_URL}
          onDismiss={() => setScrubberVisible(false)}
          onPageSelected={updateSubPage}
          pageContent={(index) =>
            renderPage(
              index,
              pages[index] ?? '',
              currentChapter?.title ?? null,
              currentTitleReserve,
              false,
              false,
            )
          }
        />
      ) : null}

      {showEasterEgg ? <EasterEggOverlay /> : null}

      {showTocSheet ? (
        <TocSheet
          chapters={chapters}
          currentChapterIndex={currentChapterIndex}
          onSelect={(chapterOrder) => {
            setShowTocSheet(false);
            jumpToChapter(chapterOrder);
          }}
          onClose={() => setShowTocSheet(false)}
          onCheckUpdate={null}
        />
      ) : null}

      {showSettingsSheet ? (
        <TypographySheet
          prefs={prefs}
          customFontLoaded={prefs.customFontPath.length > 0 && customFontCss.length > 0}
          customFontFamily={customFontCss}
          onChange={applyPrefs}
          onReset={resetTypography}
          onImportFont={() => {
            document.querySelector<HTMLInputElement>('.rd-file-input')?.click();
          }}
          onSelectMode={switchPageMode}
          onClose={() => setShowSettingsSheet(false)}
        />
      ) : null}

      {showSearchDialog ? (
        <SearchDialog
          keyword={searchKeyword}
          searching={isSearching}
          results={searchResults}
          onKeywordChange={runSearch}
          onSelectResult={onSelectSearchResult}
          onClose={() => setShowSearchDialog(false)}
        />
      ) : null}

      {showAnnotationsSheet ? (
        <AnnotationsSheet
          bookmarks={bookmarks}
          onSelect={onSelectBookmark}
          onDelete={onDeleteBookmark}
          onClose={() => setShowAnnotationsSheet(false)}
        />
      ) : null}

      {showRestDialog ? (
        <RestDialog
          restMinutes={prefs.restReminderMinutes}
          onClose={() => setShowRestDialog(false)}
        />
      ) : null}

      <HiddenFontInput />

      {fullscreenNovelImage !== null ? (
        <ImageFullscreenViewer
          path={fullscreenNovelImage}
          onDismiss={() => setFullscreenNovelImage(null)}
        />
      ) : null}
    </div>
  );
}

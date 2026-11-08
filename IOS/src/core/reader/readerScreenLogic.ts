/**
 * readerScreenLogic.ts — pure logic extracted from Android `ReaderScreen.kt`.
 *
 * SOURCE MAP (Kotlin → TS)
 *   ReaderScreen.kt 1-246    imports / @file:OptIn / @OptIn / @Composable decl   → SKIPPED (no imports in TS; annotations have no TS analogue)
 *   ReaderScreen.kt 248-298  fun ReaderScreen(...) 43-param signature             → declared as `ReaderScreenPorts` + component in ReaderPage.tsx
 *   ReaderScreen.kt 300-402  state hoists (showTocSheet…fontFamilyIndex)          → ReaderPage.tsx `useState` (see its header map)
 *   ReaderScreen.kt 405-488  fontFileLauncher / readerPosterLauncher GetContent   → ReaderPage.tsx `<input type=file>` (SKIP poster: 开屏海报 owned by SplashScreen.kt)
 *   ReaderScreen.kt 492      currentChapter                                      → readerScreenLogic.ts `chapterAt`
 *   ReaderScreen.kt 498-520  auto-scroll engine (1.2f * speed, delay 16)          → AUTO_SCROLL_STEP_PX / AUTO_SCROLL_FRAME_MS + ReaderPage.tsx rAF loop
 *   ReaderScreen.kt 524-557  overscroll / chapter-entry state + 120dp / 42dp      → SCROLL_THRESHOLD_DP / CHAPTER_ENTRY_PULL_DP
 *   ReaderScreen.kt 560-610  triggerSwitch (pull-through 130f, tween 110)         → SWITCH_PULL_PX / SWITCH_PULL_MS + `chapterSwitchDirection`
 *   ReaderScreen.kt 614-682  spring settle + chapter entry animation              → CSS `rd-scroll-inner--spring` / `rd-chapter-entry`
 *   ReaderScreen.kt 686-706  keepScreenOn WindowManager flag                     → SKIPPED (no Android window; declared on `ReaderScreenPorts`)
 *   ReaderScreen.kt 709-726  immersive status bar hide/restore                   → SKIPPED (Capacitor StatusBar plugin; not reader-owned)
 *   ReaderScreen.kt 729-756  ReadingTimerEffect + restReminderMinutes tick       → `REST_FLUSH_SECONDS` + ReaderPage.tsx `useReadingTimer`
 *   ReaderScreen.kt 760-845  progress restore / ensure-chapter / 4 save paths    → `resolveReaderProgress` + ReaderPage.tsx effects
 *   ReaderScreen.kt 851-869  DisposableEffect progress flush on exit              → `resolveReaderProgress` (dispose variant)
 *   ReaderScreen.kt 873-901  toggleBookmark                                     → ReaderPage.tsx (`toggleBookmark` store call)
 *   ReaderScreen.kt 904-948  switchPageMode ratio↔char anchoring                → `modeSwitchAnchor`
 *   ReaderScreen.kt 952-968  readerTheme → (bgColor, textColor)                  → `READER_THEMES` / `readerThemeColors`
 *   ReaderScreen.kt 972-988  customTypeface (TTF) + AppFonts.readingFontFamily   → `READING_FONT_FAMILIES` / `readingFontFamilyCss`
 *   ReaderScreen.kt 992-1057 formattedContent / scrollChunks / contentReady      → `formatForReader` / `chunkForScroll` + ReaderPage.tsx effect
 *   ReaderScreen.kt 1061-1089 mode switch anchoring effects                     → `modeSwitchAnchor` consumers
 *   ReaderScreen.kt 1093-1138 shared cover transition (140/420/480/380, 0.06f)  → CONTENT/COVER/BG transition constants + CSS
 *   ReaderScreen.kt 1142-1301 Box / shared cover / BoxWithConstraints / insets  → ReaderPage.tsx DOM (safe-area tokens in reader.css)
 *   ReaderScreen.kt 1298-1322 bodyTextStyle / titleStyle                         → READER_TITLE_FONT_SIZE_PX / READER_TITLE_LINE_HEIGHT_PX below
 *   ReaderScreen.kt 1324-1350 textWidth/Height + measureTitleReservePx          → `measureTitleReservePx`
 *   ReaderScreen.kt 1495-1549 activeSubPageIndex + updateSubPage                → `clampSubPageIndex` / `subPageState` / `pageIndexForOffset`
 *   ReaderScreen.kt 1551-1658 scroll-mode search jump (block loop, 6 frame wait) → `findScrollBlockTarget`
 *   ReaderScreen.kt 1660-1677 adjacent-page image prewarm                       → `prewarmImagePathsForPages` (+ decoder port)
 *   ReaderScreen.kt 1679-1728 paged-mode search jump + highlight clearing       → `findPageForPosition` / `shouldClearSearchHighlight`
 *   ReaderScreen.kt 1732-1809 handleNextPage / handlePrevPage                   → `nextReaderLocation` / `prevReaderLocation`
 *   ReaderScreen.kt 1813-1859 loading / unsupported / empty states               → ReaderPage.tsx (`章节加载失败：…` / `重试加载` / KFX 文案 / `本章暂无正文`)
 *   ReaderScreen.kt 1862-2216 scroll slot (gesture, heading, blocks, footer)     → ReaderPage.tsx `ScrollChapter` + `useBoundaryPull`
 *   ReaderScreen.kt 2218-2496 current/next/prev RenderSinglePage slots          → ReaderPage.tsx `SinglePage`
 *   ReaderScreen.kt 2498-2603 PageCurlReaderContainer / PageTurnContainer       → ReaderPage.tsx `PageTurnHost`
 *                                                    （只做档位分派，容器本体是 ui/components/pageturn/*）
 *   ReaderScreen.kt 2606-2637 PageScrubberOverlay                               → ui/components/pageturn/PageScrubberOverlay
 *   ReaderScreen.kt 2641-2764 overscroll switch hint chip                        → `pullHintText` / `pullProgress`
 *   ReaderScreen.kt 2766-2788 BookmarkHangingRibbon ribbon                      → `BookmarkRibbon` (SVG, 4614-4696)
 *   ReaderScreen.kt 2794-2832 persistent overlay header/footer                  → `readerProgressFooterText` / `readerPercent`
 *   ReaderScreen.kt 2836-2963 TTS player bar                                    → ReaderPage.tsx `TtsBar` + `ReaderTtsController` port
 *   ReaderScreen.kt 2965-3006 返回上次处 chip (auto-hide 5000ms)                → RETURN_CHIP_AUTO_HIDE_MS + ReaderPage.tsx `ReturnChip`
 *   ReaderScreen.kt 3016-3066 自动滚屏中 · 点击停止 pill                         → ReaderPage.tsx `AutoScrollPill`
 *   ReaderScreen.kt 3070-3119 回到顶部 button (20% threshold)                   → `shouldShowBackToTop`
 *   ReaderScreen.kt 3122-3144 dim overlay ((1-b)*0.6f, tween 160)              → `readerDimAlpha`
 *   ReaderScreen.kt 3148-3186 scrim (Black 0.6f)                                → CSS `rd-scrim`
 *   ReaderScreen.kt 3190-3393 top bar + more DropdownMenu                       → ReaderPage.tsx `ReaderTopBar`
 *   ReaderScreen.kt 3399-3654 bottom bar + FluidSlider (3 variants)             → ReaderPage.tsx `ReaderBottomBar` + `ReaderFluidSlider`
 *   ReaderScreen.kt 3668-3799 TOC ModalBottomSheet                              → ReaderPage.tsx `TocSheet`
 *   ReaderScreen.kt 3803-4163 阅读排版 sheet (亮度/缩进/字号/字体/行距/边距/主题/翻页) → ReaderPage.tsx `TypographySheet` + slider range helpers
 *   ReaderScreen.kt 4167-4310 全文搜索 AlertDialog                             → ReaderPage.tsx `SearchDialog`
 *   ReaderScreen.kt 4314-4402 书签记录 sheet                                     → ReaderPage.tsx `AnnotationsSheet`
 *   ReaderScreen.kt 4406-4534 定时休息提醒 dialog                               → ReaderPage.tsx `RestDialog`
 *   ReaderScreen.kt 4538-4608 Ciallo～(∠・ω< )⌒★ easter egg                    → ReaderPage.tsx `EasterEggOverlay`
 *   ReaderScreen.kt 4702-4720 formatForReader                                   → `formatForReader`
 *   ReaderScreen.kt 4724-4762 chunkForScroll                                    → `chunkForScroll`
 *   ReaderScreen.kt 4766-4834 measureTitleReservePx                             → `measureTitleReservePx`
 *   ReaderScreen.kt 4838-5009 RenderSinglePage                                 → ReaderPage.tsx `SinglePage`
 *   ReaderScreen.kt 5011-5064 ReaderThemePreview(Card)                          → READER_THEME_PREVIEWS + ReaderPage.tsx `ThemePreviewCard`
 *   ReaderScreen.kt 5066-5110 ReaderPageModeChip                                → `pageTurnChipLabel` + ReaderPage.tsx `PageModeChip`
 *   ReaderScreen.kt 5112-5154 ReaderFontOptionRow                               → READING_FONT_FAMILIES + ReaderPage.tsx `FontOptionRow`
 *
 * ADAPTATIONS (each one documented at its symbol)
 *   - Compose `Paragraph` text measurement → injectable `measureLines` estimate
 *     (`measureTitleReservePx`), because `src/core` may not touch the DOM.
 *   - `Color` / `onColor()` (Color.kt:39-48) → hex strings + `luminance`/`onColor`
 *     (2026-10-11 PARITY E56④: local copies removed, now re-exported from
 *     `../ui-theme/color` — the single line-by-line port of `ui/theme/Color.kt`).
 *   - `AppToast.makeText` → `showToast` in ReaderPage.tsx.
 *   - `android.graphics.BitmapFactory` → `InlineImageDecoder` port (declared, not implemented).
 *   - `TtsManager` + Room Flow `isPlaying` → `ReaderTtsController` port with
 *     async getter + `ListenerRegistry` (Room Flow → async getter + listener registry).
 *   - `Room Flow` progress → `useAppStore` selectors in ReaderPage.tsx.
 *   - `HorizontalPager` (pageturn module, out of scope) → scroll container +
 *     `scroll-snap-type` / CSS transitions; the gesture math is ported verbatim.
 *   - `detectTransformGestures` pinch → Pointer Events + `setPointerCapture`
 *     (see ReaderPage.tsx `ImageFullscreenViewer`).
 *
 * REVIEW-2026-10-06（本轮逐行审查）
 *   - `displaySize` 的唯一实现搬回 `./novelInlineImages`（Kotlin 里它就是
 *     `NovelInlineImages.displaySize`），本文件改为转出。此前两份拷贝 +
 *     `splitIntoBlocks` 里凭空发明的 `pageHeightPx * 0.6` 近似造成分页测量与
 *     渲染尺寸都拿不到真实长宽比。
 *   - 6 套阅读主题色、`reader_theme` 默认 1（白）、`READING_FONT_FAMILIES` 的
 *     id/名称、`readingFontFamilyCss` 的 4→custom 分支，全部逐值核对 **无差异**，未改。
 *   - 计时 30s flush / 书签高亮 1500ms 宽限 / 6 帧等待 / `Int.MAX_VALUE` 与 `9999`
 *     哨兵 / TTS `(0.25, 4)` 钳制，逐值核对 **无差异**，未改。
 *   - `chunkForScroll` 与 `pagination.splitChunks` 在换行处切分时**保留**该换行符，
 *     而 Kotlin `substring(start, newline)` 会丢掉它 —— 见「已知豁免」与 E59。
 */

import { charsPerLineFor } from './pagination';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — every value lifted verbatim from ReaderScreen.kt / PreferencesManager.kt
// ─────────────────────────────────────────────────────────────────────────────

/** ReaderScreen.kt:526 — `120.dp` 滚动越界切章阈值. */
export const SCROLL_THRESHOLD_DP = 120;

/** ReaderScreen.kt:550 — `42.dp` 新章节入场滑入距离. */
export const CHAPTER_ENTRY_PULL_DP = 42;

/** ReaderScreen.kt:580-582 — 拉穿动画 `pullSign * 130f`, `tween(110)`. */
export const SWITCH_PULL_PX = 130;
export const SWITCH_PULL_MS = 110;

/** ReaderScreen.kt:2016-2018 — 跟手位移 `overscrollPx * 0.35f`. */
export const OVERSCROLL_FOLLOW = 0.35;

/** ReaderScreen.kt:506-508 — 自动滚屏每帧 `1.2f * autoScrollSpeed`, `delay(16)`. */
export const AUTO_SCROLL_STEP_PX = 1.2;
export const AUTO_SCROLL_FRAME_MS = 16;

/** ReaderScreen.kt:355 — 返回上次处气泡 5 秒自动消失. */
export const RETURN_CHIP_AUTO_HIDE_MS = 5000;

/** ReaderScreen.kt:1101 — 共享封面转场启动延迟 `delay(140)`. */
export const TRANSITION_DELAY_MS = 140;

/** ReaderScreen.kt:1111 / 1124 / 1134 — content 420ms, cover 480ms, bg 380ms. */
export const CONTENT_ALPHA_MS = 420;
export const COVER_ALPHA_MS = 480;
export const BG_ALPHA_MS = 380;

/** ReaderScreen.kt:1119 — 封面转场后残留 alpha `0.06f`. */
export const COVER_ALPHA_TARGET = 0.06;

/** ReaderScreen.kt:1721 — 跳转后 1500ms 内是渐进分页期，不判定"离开目标页". */
export const SEARCH_HIGHLIGHT_KEEP_MS = 1500;

/** ReaderScreen.kt:815 — 滚动模式 1.5 秒防抖保存. */
export const SCROLL_SAVE_DEBOUNCE_MS = 1500;

/** ReaderScreen.kt:3128-3129 — 亮度遮罩 `(1f - readerBrightness) * 0.6f`, tween 160ms. */
export const DIM_ALPHA_SCALE = 0.6;
export const DIM_ALPHA_FADE_MS = 160;

/** ReaderScreen.kt:660 — 新章节入场 `tween(220)`. */
export const CHAPTER_ENTRY_ALPHA_MS = 220;

/** ReaderScreen.kt:3074 — 滚过 20% 显示"回到顶部". */
export const BACK_TO_TOP_RATIO = 0.2;

// ── ReaderPagination.kt ────────────────────────────────────────────────────────

/** ReaderPagination.kt:70 — RenderSinglePage 上下 padding (12dp). */
export const PAGE_VERTICAL_PADDING_DP = 12;

/** ReaderPagination.kt:73 — RenderSinglePage 正文 Text 底部 padding (16dp). */
export const PAGE_TEXT_BOTTOM_PADDING_DP = 16;

/** ReaderPagination.kt:86 — 章节标题块上下 padding 合计 (20dp). */
export const TITLE_BLOCK_PADDING_DP = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Page turn modes — PageTurnContainer.kt:62-68 (authoritative id mapping)
// ─────────────────────────────────────────────────────────────────────────────

export interface PageTurnMode {
  id: number;
  title: string;
  description: string;
}

/** 0=仿真3D卷页 1=覆盖翻页 2=平移翻页 3=渐变淡出 4=上下滚动 */
export const PAGE_TURN_SIMULATE = 0;
export const PAGE_TURN_COVER = 1;
export const PAGE_TURN_SLIDE = 2;
export const PAGE_TURN_FADE = 3;
export const PAGE_TURN_SCROLL = 4;

export const PAGE_TURN_TYPES: ReadonlyArray<PageTurnMode> = [
  { id: PAGE_TURN_SIMULATE, title: '仿真3D卷页', description: '真实书本折角弯曲与纸张阴影' },
  { id: PAGE_TURN_COVER, title: '覆盖翻页', description: '无缝推开上页，经典质感' },
  { id: PAGE_TURN_SLIDE, title: '平移翻页', description: '左右双页平滑滑移' },
  { id: PAGE_TURN_FADE, title: '渐变淡出', description: '优雅透明度切换' },
  { id: PAGE_TURN_SCROLL, title: '上下滚动', description: '连续纵向滚动阅读' },
];

/** ReaderScreen.kt:391 — `isScrollMode = pageTurnMode == PageTurnType.SCROLL.id`. */
export function isScrollMode(pageTurnMode: number): boolean {
  return pageTurnMode === PAGE_TURN_SCROLL;
}

/** ReaderScreen.kt:2500 — SIMULATE 档走 pagecurl 引擎. */
export function isSimulateMode(pageTurnMode: number): boolean {
  return pageTurnMode === PAGE_TURN_SIMULATE;
}

/** PageTurnContainer.kt:130 — 未知 id 回落 SIMULATE. */
export function resolvePageTurnMode(pageTurnMode: number): PageTurnMode {
  const found = PAGE_TURN_TYPES.find((mode) => mode.id === pageTurnMode);
  return found ?? (PAGE_TURN_TYPES[0] as PageTurnMode);
}

/**
 * ReaderScreen.kt:4137/4147 — chip label = `title.replace("翻页","").replace("卷页","").replace("渐变","")`.
 * `仿真3D卷页` → `仿真3D`；`覆盖翻页` → `覆盖`；`平移翻页` → `平移`；`渐变淡出` → `淡出`；`上下滚动` → `上下滚动`.
 */
export function pageTurnChipLabel(title: string): string {
  return title.replace('翻页', '').replace('卷页', '').replace('渐变', '');
}

/** PageTurnContainer.kt:158-161 — 翻页判定阈值 `screenWidth * 0.15f`, 点击区 0.35/0.65. */
export const PAGE_TURN_DRAG_THRESHOLD_RATIO = 0.15;
export const PAGE_TURN_LEFT_ZONE_RATIO = 0.35;
export const PAGE_TURN_RIGHT_ZONE_RATIO = 0.65;
export const PAGE_TURN_ANIM_TWEEN_MS = 180;
export const PAGE_TURN_NUDGE_RATIO = 0.05;
export const PAGE_TURN_NUDGE_MS = 60;

/** PageTurnContainer.kt:225-238 — 下拉书签：`rawY*0.5f` clamp 160px，80px 触发. */
export const PULL_DOWN_DAMPING = 0.5;
export const PULL_DOWN_MAX_PX = 160;
export const PULL_DOWN_TRIGGER_PX = 80;

/** PageTurnContainer.kt:404-409 — 下拉书签文案（顺序即判定优先级）. */
export function pullDownHintText(charged: boolean, isBookmarked: boolean): string {
  if (charged && isBookmarked) return '松开即可取消书签';
  if (charged && !isBookmarked) return '松开即可保存书签';
  if (isBookmarked) return '下拉取消书签';
  return '下拉添加书签';
}

/** PageScreen.kt:2665-2714 — 滚动模式越界切章提示文案. */
export function pullProgress(overscrollPx: number, thresholdPx: number): number {
  if (thresholdPx <= 0) return 0;
  return Math.min(Math.max(overscrollPx / thresholdPx, 0), 1);
}

export function pullHintText(progress: number, isNext: boolean): string {
  if (progress >= 1 && isNext) return '松开切换下一章';
  if (progress >= 1) return '松开返回上一章';
  if (isNext) return '继续上滑进入下一章';
  return '继续下拉返回上一章';
}

// ─────────────────────────────────────────────────────────────────────────────
// Reader themes — ReaderScreen.kt:952-968 (bgColor / textColor, verbatim hex)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReaderThemeColors {
  bg: string;
  text: string;
}

export const PURE_LIGHT_TEXT = '#18191C';
export const SEPIA_BG = '#FBF0D9';
export const SEPIA_TEXT = '#5F4B32';
export const NIGHT_BG = '#18191C';
export const NIGHT_TEXT = '#D4D4D4';
export const EYE_GREEN_BG = '#E8F5E9';
export const EYE_GREEN_TEXT = '#1B5E20';
export const OLED_BG = '#000000';
export const OLED_TEXT = '#E0E0E0';

export const READER_THEMES: ReadonlyArray<ReaderThemeColors> = [
  { bg: '#FFFFFF', text: PURE_LIGHT_TEXT }, // Pure Light
  { bg: '#FFFFFF', text: PURE_LIGHT_TEXT }, // Default White
  { bg: SEPIA_BG, text: SEPIA_TEXT }, // Sepia
  { bg: NIGHT_BG, text: NIGHT_TEXT }, // Dark
  { bg: EYE_GREEN_BG, text: EYE_GREEN_TEXT }, // Eye Green
  { bg: OLED_BG, text: OLED_TEXT }, // OLED Black
];

/** PreferencesManager.kt:31-33 — `reader_theme` 默认 1 (默认白). */
export const DEFAULT_READER_THEME = 1;

/**
 * ADAPTATION: `when (readerTheme) { … else -> White to #18191C }`
 * 越界 id 回落第 0 档（与 Kotlin `else` 分支同色）。
 */
export function readerThemeColors(readerTheme: number): ReaderThemeColors {
  return READER_THEMES[readerTheme] ?? (READER_THEMES[0] as ReaderThemeColors);
}

/** ReaderScreen.kt:4093-4099 — 排版面板主题预览卡数据（id 与阅读区一致）. */
export interface ReaderThemePreview {
  id: number;
  name: string;
  bg: string;
  fg: string;
}

export const READER_THEME_PREVIEWS: ReadonlyArray<ReaderThemePreview> = [
  { id: 1, name: '白底', bg: '#FFFFFF', fg: '#18191C' },
  { id: 2, name: '羊皮', bg: SEPIA_BG, fg: SEPIA_TEXT },
  { id: 3, name: '夜间', bg: NIGHT_BG, fg: NIGHT_TEXT },
  { id: 4, name: '护眼', bg: EYE_GREEN_BG, fg: EYE_GREEN_TEXT },
  { id: 5, name: '纯黑', bg: OLED_BG, fg: OLED_TEXT },
];

/**
 * Color.kt:39-48 — `luminance()` / `onColor()`（PARITY E56④，2026-10-11 收敛）。
 *
 * 本文件原先自带一份实现（cut-off 0.03928，与 Kotlin 一致，但仍是「同一 Kotlin 函数的
 * 第二份 TS 拷贝」）。现删除本地副本，改为从 `../ui-theme/color` 再导出 —— 那里是
 * `ui/theme/Color.kt` 的逐行移植（L40 cut-off 0.03928）、单一权威实现。对全部 8-bit hex
 * 输入数值逐位相同（旧实现的 `** 2.4` 与权威实现的 `Math.pow(…, 2.4)` 等价），行为无变化。
 */
export { luminance, onColor } from '../ui-theme/color';

/** ADAPTATION: `Color.copy(alpha = a)` → `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#RRGGBB` / `#RGB` → 0..1 channel triple. */
export function parseHexColor(hex: string): Rgb {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: ((int >> 16) & 0xff) / 255,
    g: ((int >> 8) & 0xff) / 255,
    b: (int & 0xff) / 255,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading fonts — AppFonts.kt:124-145 (id 不可重排；4 = 自定义)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadingFontOption {
  index: number;
  name: string;
  cssFamily: string;
}

/** AppFonts.kt:47-63 — 打包的 Noto Sans SC / Noto Serif SC 子集（web 端走同名 webfont）. */
export const NOTO_SANS_SC = '"Noto Sans SC", "PingFang SC", "Helvetica Neue", sans-serif';
export const NOTO_SERIF_SC = '"Noto Serif SC", "Songti SC", Georgia, serif';
export const MONOSPACE = '"SF Mono", "Roboto Mono", Menlo, monospace';

export const READING_FONT_FAMILIES: ReadonlyArray<ReadingFontOption> = [
  { index: 0, name: '默认字体', cssFamily: NOTO_SANS_SC },
  { index: 1, name: '衬线体', cssFamily: NOTO_SERIF_SC },
  { index: 2, name: '黑体', cssFamily: NOTO_SANS_SC },
  { index: 3, name: '等宽体', cssFamily: MONOSPACE },
];

/** AppFonts.kt:142 — `4 -> custom ?: ReadingSansSerif`. */
export const CUSTOM_FONT_INDEX = 4;

/** ReaderScreen.kt:3969-3970 — 面板上的当前字体名. */
export function readingFontName(fontFamilyIndex: number, customLoaded: boolean): string {
  const found = READING_FONT_FAMILIES.find((font) => font.index === fontFamilyIndex);
  if (found) return found.name;
  if (fontFamilyIndex === CUSTOM_FONT_INDEX) {
    return customLoaded ? '自定义字体' : '自定义字体（未导入）';
  }
  return '默认字体';
}

/** ADAPTATION: `AppFonts.readingFontFamily(index, custom)` → CSS font-family 值. */
export function readingFontFamilyCss(
  fontFamilyIndex: number,
  customCssFamily: string | null,
): string {
  switch (fontFamilyIndex) {
    case 1:
      return NOTO_SERIF_SC;
    case 2:
      return NOTO_SANS_SC;
    case 3:
      return MONOSPACE;
    case 4:
      return customCssFamily ?? NOTO_SANS_SC;
    default:
      return NOTO_SANS_SC;
  }
}

/** ReaderScreen.kt:1298-1322 — bodyLarge / headlineSmall 的字号行高（web 端 dp≡px）. */
export const READER_TITLE_FONT_SIZE_PX = 24;
export const READER_TITLE_LINE_HEIGHT_PX = 32;

// ─────────────────────────────────────────────────────────────────────────────
// Typography slider ranges — ReaderScreen.kt:3874 / 3929 / 3950 / 4057 / 4071
// ─────────────────────────────────────────────────────────────────────────────

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 36;
export const LINE_HEIGHT_MIN = 20;
export const LINE_HEIGHT_RANGE = 28; // 20f + it * 28f
export const MARGIN_HORIZONTAL_MIN = 8;
export const MARGIN_HORIZONTAL_RANGE = 40; // 8f + it * 40f
export const BRIGHTNESS_MIN = 0.2;
export const BRIGHTNESS_RANGE = 0.8; // 0.2f + it * 0.8f

/** PreferencesManager defaults; ReaderScreen.kt:3832-3834 「重置」按钮写回同一组值. */
export const RESET_FONT_SIZE = 18;
export const RESET_LINE_HEIGHT = 28;
export const RESET_MARGIN_HORIZONTAL = 16;
export const RESET_BRIGHTNESS = 1;

export function brightnessToSlider(readerBrightness: number): number {
  return Math.min(Math.max((readerBrightness - BRIGHTNESS_MIN) / BRIGHTNESS_RANGE, 0), 1);
}

export function brightnessFromSlider(slider: number): number {
  return BRIGHTNESS_MIN + slider * BRIGHTNESS_RANGE;
}

export function lineHeightToSlider(lineHeight: number): number {
  return Math.min(Math.max((lineHeight - LINE_HEIGHT_MIN) / LINE_HEIGHT_RANGE, 0), 1);
}

export function lineHeightFromSlider(slider: number): number {
  return LINE_HEIGHT_MIN + slider * LINE_HEIGHT_RANGE;
}

export function marginToSlider(marginHorizontal: number): number {
  return Math.min(
    Math.max((marginHorizontal - MARGIN_HORIZONTAL_MIN) / MARGIN_HORIZONTAL_RANGE, 0),
    1,
  );
}

export function marginFromSlider(slider: number): number {
  return Math.round(MARGIN_HORIZONTAL_MIN + slider * MARGIN_HORIZONTAL_RANGE);
}

export function stepFontSizeDown(fontSize: number): number {
  return Math.max(Math.round(fontSize) - 1, FONT_SIZE_MIN);
}

export function stepFontSizeUp(fontSize: number): number {
  return Math.min(Math.round(fontSize) + 1, FONT_SIZE_MAX);
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferences — PreferencesManager.kt defaults for every key ReaderScreen reads
// ─────────────────────────────────────────────────────────────────────────────

export interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  marginHorizontal: number;
  firstLineIndent: boolean;
  readerTheme: number;
  fontFamilyIndex: number;
  pageTurnMode: number;
  readerBrightness: number;
  showOverlayHeaderFooter: boolean;
  keepScreenOn: boolean;
  restReminderMinutes: number;
  ttsSpeed: number;
  ttsPitch: number;
  customFontPath: string;
  customSplashPosterUri: string;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 18,
  lineHeight: 28,
  marginHorizontal: 16,
  firstLineIndent: true,
  readerTheme: DEFAULT_READER_THEME,
  fontFamilyIndex: 0,
  pageTurnMode: PAGE_TURN_SIMULATE,
  readerBrightness: 1,
  showOverlayHeaderFooter: true,
  keepScreenOn: true,
  restReminderMinutes: 30,
  ttsSpeed: 1,
  ttsPitch: 1,
  customFontPath: '',
  customSplashPosterUri: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Text preparation — ReaderScreen.kt:4702-4762
// ─────────────────────────────────────────────────────────────────────────────

/** 两个全角空格（U+3000 U+3000）—— ReaderScreen.kt:4705. */
export const FIRST_LINE_INDENT = '\u3000\u3000';

/**
 * ReaderScreen.kt:4704-4720 `formatForReader`
 * 首行缩进格式化（与旧逻辑一致）：非空白且未缩进的行前缀两个全角空格。
 * ADAPTATION: `"\u3000\u3000"` 以 `\u3000` 转义书写（规则 8）。
 */
export function formatForReader(text: string, firstLineIndent: boolean): string {
  if (!firstLineIndent) return text;
  return text
    .split('\n')
    .map((line) => {
      if (line.trim().length > 0 && !line.startsWith(FIRST_LINE_INDENT)) {
        return `${FIRST_LINE_INDENT}${line}`;
      }
      return line;
    })
    .join('\n');
}

/**
 * ReaderScreen.kt:4726-4762 `chunkForScroll`（滚动模式大章分块，maxChars = 40000）
 * 与 `pagination.splitChunks` 的差异（照搬，不修正）：Kotlin 在换行处切时
 * `substring(start, newline)` **不含**该换行符，故分块拼接会丢掉边界处的 `\n`。
 */
export function chunkForScroll(content: string, maxChars = 40_000): string[] {
  if (content.length <= maxChars) return [content];
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    const end = Math.min(content.length, start + maxChars);
    if (end < content.length) {
      const newline = content.lastIndexOf('\n', end);
      if (newline > start + maxChars / 2) {
        chunks.push(content.substring(start, newline));
        start = newline + 1;
        continue;
      }
    }
    chunks.push(content.substring(start, end));
    start = end;
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Title reserve — ReaderScreen.kt:4766-4834
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ReaderScreen.kt:4776-4834 `measureTitleReservePx`
 * ADAPTATION: `Paragraph` 不可用（src/core 不得触碰 DOM），改用
 * `pagination.charsPerLineFor` 的等宽近似 + 行高乘行数；保留
 * 「无标题 → 0」与「上限 `maxHeightPx * 0.4f` 至少 60px」两条硬规则。
 *
 * @param density dp→px 系数（web 端 = 1；保留参数以便与 Android `LocalDensity` 对齐）。
 */
export function measureTitleReservePx(
  title: string | null,
  widthPx: number,
  maxHeightPx: number,
  fontSizePx: number,
  lineHeightPx: number,
  density = 1,
): number {
  if (title === null || title.length === 0 || widthPx <= 0) return 0;

  const fs = Math.max(fontSizePx * density, 8);
  const lh = Math.max(lineHeightPx * density, fs * 1.2);
  const perLine = charsPerLineFor(widthPx, fs);
  const lineCount = Math.ceil(title.length / perLine);
  // Kotlin: `if (lineCount == 0) lineHeightPx else getLineBottom(last) - getLineTop(0)`
  const titleHeight = lineCount === 0 ? lh : lineCount * lh;
  const blockPaddingPx = Math.trunc(TITLE_BLOCK_PADDING_DP * density);
  const cap = Math.max(Math.trunc(maxHeightPx * 0.4), 60);
  return Math.min(Math.max(Math.trunc(titleHeight) + blockPaddingPx, 0), cap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Page index / char offset — ReaderScreen.kt:1495-1549, 1533-1549
// ─────────────────────────────────────────────────────────────────────────────

/** ReaderScreen.kt:1495 — `currentSubPageIndex.coerceIn(0, (size - 1).coerceAtLeast(0))`. */
export function clampSubPageIndex(pageCount: number, pageIndex: number): number {
  return Math.min(Math.max(pageIndex, 0), Math.max(pageCount - 1, 0));
}

/** ReaderScreen.kt:1539-1547 — 页索引 → 累计字符偏移. */
export function charOffsetForPage(pages: ReadonlyArray<string>, pageIndex: number): number {
  let offset = 0;
  for (let i = 0; i < pageIndex && i < pages.length; i += 1) {
    offset += pages[i]?.length ?? 0;
  }
  return offset;
}

export interface SubPageState {
  pageIndex: number;
  charOffset: number;
}

/** ReaderScreen.kt:1533-1549 `updateSubPage` 的纯函数形态. */
export function subPageState(pages: ReadonlyArray<string>, newIndex: number): SubPageState {
  const clamped = clampSubPageIndex(pages.length, newIndex);
  return { pageIndex: clamped, charOffset: charOffsetForPage(pages, clamped) };
}

/**
 * ReaderScreen.kt:1501-1529 — 分页重算后按 `currentCharOffset` 重新锚定页索引。
 * `accumulated + pageLen > currentCharOffset || index == lastIndex` → 该页。
 */
export function pageIndexForOffset(pages: ReadonlyArray<string>, offset: number): number {
  if (pages.length === 0) return 0;
  let accumulated = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const pageLen = pages[index]?.length ?? 0;
    if (accumulated + pageLen > offset || index === pages.length - 1) {
      return index;
    }
    accumulated += pageLen;
  }
  return pages.length - 1;
}

/** ReaderScreen.kt:1799-1801 — 上一章时用哨兵值把子页索引甩到末页. */
export const PREV_CHAPTER_PAGE_SENTINEL = 9999;
export const PREV_CHAPTER_OFFSET_SENTINEL = 2147483647; // Kotlin `Int.MAX_VALUE`

/**
 * ReaderScreen.kt:584-602 `triggerSwitch` 的目标章计算：
 * `dir == 1 && currentChapterIndex < chapters.size - 1 → +1`；
 * `dir == -1 && currentChapterIndex > 0 → -1`；否则不切章。
 */
export function chapterSwitchTarget(
  currentIndex: number,
  chapterCount: number,
  direction: 1 | -1,
): number | null {
  if (direction === 1) {
    return currentIndex < chapterCount - 1 ? currentIndex + 1 : null;
  }
  if (currentIndex > 0) return currentIndex - 1;
  return null;
}

/**
 * NovelInlineImages.kt:276-287 `displaySize`
 * 长宽比换算 + 页高收敛。**唯一实现**在 `./novelInlineImages`（Kotlin 里的家就是
 * `NovelInlineImages.displaySize`），此处仅转出，避免两处公式漂移。
 * REVIEW-2026-10-06：此前本文件有一份拷贝，而 `novelInlineImages.splitIntoBlocks`
 * 用的是凭空发明的 `pageHeightPx * 0.6` 近似（Kotlin 无此函数），导致分页测量
 * 与渲染尺寸都拿不到真实长宽比。已收敛到 Kotlin 原式。
 */
export { displaySize } from './novelInlineImages';

// ─────────────────────────────────────────────────────────────────────────────
// Next / prev turn — ReaderScreen.kt:1732-1809
// ─────────────────────────────────────────────────────────────────────────────

export type ReaderTurn =
  | { kind: 'page'; pageIndex: number }
  | { kind: 'chapter'; chapterIndex: number; charOffset: number; pageIndex: number };

/**
 * ReaderScreen.kt:1732-1773 `handleNextPage`（非滚动分支）
 * 滚动模式下只切章（ReaderPage.tsx 内单独处理）。
 */
export function nextReaderLocation(args: {
  pageIndex: number;
  pageCount: number;
  chapterIndex: number;
  chapterCount: number;
}): ReaderTurn {
  const { pageIndex, pageCount, chapterIndex, chapterCount } = args;
  if (pageIndex < pageCount - 1) {
    return { kind: 'page', pageIndex: pageIndex + 1 };
  }
  if (chapterIndex < chapterCount - 1) {
    return { kind: 'chapter', chapterIndex: chapterIndex + 1, charOffset: 0, pageIndex: 0 };
  }
  return { kind: 'page', pageIndex };
}

/**
 * ReaderScreen.kt:1777-1809 `handlePrevPage`（非滚动分支）
 * 跨章回退时置 `Int.MAX_VALUE` / `9999`，由重锚定 effect 落到上一页（ReaderScreen.kt:1501-1529）。
 */
export function prevReaderLocation(args: {
  pageIndex: number;
  chapterIndex: number;
}): ReaderTurn {
  const { pageIndex, chapterIndex } = args;
  if (pageIndex > 0) {
    return { kind: 'page', pageIndex: pageIndex - 1 };
  }
  if (chapterIndex > 0) {
    return {
      kind: 'chapter',
      chapterIndex: chapterIndex - 1,
      charOffset: PREV_CHAPTER_OFFSET_SENTINEL,
      pageIndex: PREV_CHAPTER_PAGE_SENTINEL,
    };
  }
  return { kind: 'page', pageIndex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress resolution — ReaderScreen.kt:793-869
// ─────────────────────────────────────────────────────────────────────────────

export interface ReaderProgressInput {
  /** `book.isFinished || reachedBookEnd`. */
  bookFinishedOrReachedEnd: boolean;
  isScrollMode: boolean;
  chapterIndex: number;
  chapterCount: number;
  currentChapterContentEmpty: boolean;
  scrollOffset: number;
  scrollMaxValue: number;
  charOffset: number;
}

/**
 * ReaderScreen.kt:819-821（滚动防抖保存）与 859-861（退出兜底保存）共用同一判定：
 * `isFinished = book.isFinished || reachedBookEnd || (末章 && 正文非空 && maxValue > 0 && offset >= maxValue)`.
 */
export function resolveReaderProgress(input: ReaderProgressInput): {
  offset: number;
  isFinished: boolean;
} {
  const offset = input.isScrollMode ? input.scrollOffset : input.charOffset;
  const atScrollEnd =
    input.isScrollMode &&
    input.chapterIndex === input.chapterCount - 1 &&
    !input.currentChapterContentEmpty &&
    input.scrollMaxValue > 0 &&
    input.scrollOffset >= input.scrollMaxValue;
  return {
    offset,
    isFinished: input.bookFinishedOrReachedEnd || atScrollEnd,
  };
}

/** ReaderScreen.kt:1796 — 页脚 `((currentChapterIndex + 1) / chapters.size * 100).toInt()`. */
export function readerPercent(chapterIndex: number, chapterCount: number): number {
  if (chapterCount <= 0) return 0;
  return Math.trunc(((chapterIndex + 1) / chapterCount) * 100);
}

/** ReaderScreen.kt:2816-2824 — 页脚进度文案. */
export function readerProgressFooterText(
  isScrollMode: boolean,
  chapterIndex: number,
  chapterCount: number,
  pageIndex: number,
  pageCount: number,
): string {
  if (isScrollMode) {
    return `第 ${chapterIndex + 1}/${chapterCount} 章`;
  }
  return `第 ${pageIndex + 1}/${pageCount} 页 · 第 ${chapterIndex + 1}/${chapterCount} 章`;
}

/** ReaderScreen.kt:2818-2822 顶栏页眉的章节标题 + 时间（`SimpleDateFormat("HH:mm")`）. */
export function formatClockHHmm(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** ReaderScreen.kt:748 — `restMins > 0 && elapsedSec > 0 && elapsedSec % (restMins * 60) == 0L`. */
export function shouldShowRestReminder(
  restMinutes: number,
  elapsedSeconds: number,
): boolean {
  return restMinutes > 0 && elapsedSeconds > 0 && elapsedSeconds % (restMinutes * 60) === 0;
}

/** ReadingTimerEffect.kt:120 — 每 30 秒 flush 一次. */
export const READING_FLUSH_SECONDS = 30;

/** ReaderScreen.kt:3074 — `isScrollMode && !isAutoScrolling && scroll > max * 0.2f`. */
export function shouldShowBackToTop(
  isScrollMode: boolean,
  isAutoScrolling: boolean,
  scrollValue: number,
  scrollMaxValue: number,
): boolean {
  return isScrollMode && !isAutoScrolling && scrollValue > scrollMaxValue * BACK_TO_TOP_RATIO;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page mode switch anchoring — ReaderScreen.kt:904-948
// ─────────────────────────────────────────────────────────────────────────────

export interface ModeSwitchAnchor {
  /** 切到滚动模式后按比例还原的滚动位置（-1 = 无待办）. */
  pendingScrollRatio: number;
  /** 切到翻页模式后要还原的字符偏移（-1 = 无待办）. */
  pendingCharTarget: number;
}

export interface ModeSwitchInput {
  oldMode: number;
  newMode: number;
  currentCharOffset: number;
  contentLength: number;
  scrollValue: number;
  scrollMaxValue: number;
}

/** ReaderScreen.kt:907-948 `switchPageMode` 的纯函数形态. */
export function modeSwitchAnchor(input: ModeSwitchInput): ModeSwitchAnchor {
  const oldScroll = isScrollMode(input.oldMode);
  const newScroll = isScrollMode(input.newMode);
  let pendingScrollRatio = -1;
  let pendingCharTarget = -1;
  if (oldScroll !== newScroll) {
    if (newScroll) {
      pendingScrollRatio =
        input.contentLength > 0 ? input.currentCharOffset / input.contentLength : 0;
    } else {
      const ratio = input.scrollMaxValue > 0 ? input.scrollValue / input.scrollMaxValue : 0;
      pendingCharTarget = Math.trunc(input.contentLength * ratio);
    }
  }
  return { pendingScrollRatio, pendingCharTarget };
}

/** ReaderScreen.kt:1071 — `(scrollState.maxValue * ratio).toInt().coerceIn(0, maxValue)`. */
export function scrollTargetForRatio(scrollMaxValue: number, pendingScrollRatio: number): number {
  const ratio = Math.min(Math.max(pendingScrollRatio, 0), 1);
  return Math.min(Math.max(Math.trunc(scrollMaxValue * ratio), 0), scrollMaxValue);
}

// ─────────────────────────────────────────────────────────────────────────────
// Search jump targeting — ReaderScreen.kt:1551-1728
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrollBlockTarget {
  blockIndex: number;
  isText: boolean;
  localInBlock: number;
}

export interface ScrollBlockRaw {
  raw: string;
  isText: boolean;
}

/**
 * ReaderScreen.kt:1575-1609 — 滚动模式：在 `scrollChunks` 的块序列里定位 `pos`，
 * 全局块序号跨 chunk 累计；图片块滚到块顶（localInBlock = 0）。
 *
 * ADAPTATION: Kotlin 在循环体内对每个 chunk 调 `splitIntoBlocks(chunk, w, MAX)`；
 * 这里改为调用方传入**每块一段**的扁平序列（`flattenBlocks`），保证块序列与渲染
 * 侧（`ScrollBlockSequence`）逐块同源。块 raw 拼接 === formattedContent。
 */
export function findScrollBlockTarget(
  blocks: ReadonlyArray<ScrollBlockRaw>,
  pos: number,
): ScrollBlockTarget {
  let gb = 0;
  let acc = 0;
  for (const block of blocks) {
    const len = block.raw.length;
    if (pos < acc + len) {
      return {
        blockIndex: gb,
        isText: block.isText,
        localInBlock: Math.max(pos - acc, 0),
      };
    }
    acc += len;
    gb += 1;
  }
  // ReaderScreen.kt:1611 — 没命中就落到最后一个块，并按图片块处理（滚到块顶）
  return { blockIndex: Math.max(gb - 1, 0), isText: false, localInBlock: 0 };
}

/** ReaderScreen.kt:1692-1704 — 翻页模式：按累计页长换算目标页. */
export function findPageForPosition(pages: ReadonlyArray<string>, pos: number): number {
  if (pages.length === 0) return -1;
  let acc = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i] ?? '';
    if (pos < acc + page.length) return i;
    acc += page.length;
  }
  return pages.length - 1;
}

/** ReaderScreen.kt:1718-1728 — 翻页离开目标页后清除高亮（跳转后 1500ms 保护期内不清）. */
export function shouldClearSearchHighlight(
  highlightQuery: string | null,
  activeSubPageIndex: number,
  searchHighlightPage: number,
  elapsedSinceJumpMs: number,
): boolean {
  return (
    highlightQuery !== null &&
    activeSubPageIndex !== searchHighlightPage &&
    elapsedSinceJumpMs > SEARCH_HIGHLIGHT_KEEP_MS
  );
}

/**
 * ReaderScreen.kt:4945-4954 / 2154-2163 / 4266-4280 — 忽略大小写的关键词高亮区间。
 * 返回 `[start, end)` 区间列表（`addStyle` 的等价物）。
 */
export function highlightRanges(text: string, query: string | null): Array<[number, number]> {
  if (query === null || query.trim().length === 0) return [];
  const ranges: Array<[number, number]> = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    ranges.push([at, at + query.length]);
    at = haystack.indexOf(needle, at + query.length);
  }
  return ranges;
}

/** 把 [start,end) 区间切成 `<mark>` 片段序列，供 ReaderPage.tsx 渲染. */
export interface HighlightPiece {
  text: string;
  hit: boolean;
}

export function splitByHighlights(text: string, query: string | null): HighlightPiece[] {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) {
    return text.length === 0 ? [] : [{ text, hit: false }];
  }
  const pieces: HighlightPiece[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), hit: false });
    pieces.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), hit: false });
  return pieces;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjacent-page image prewarm — ReaderScreen.kt:1660-1677
// ─────────────────────────────────────────────────────────────────────────────

/** NovelInlineImages.kt:43 `TOKEN_REGEX` 的 group(1)（图片路径）. */
const IMAGE_TOKEN_REGEX = /\[IMG:([^|\]]+)\|(\d+)\|(\d+)]/g;

/** ReaderScreen.kt:1666-1671 — 上一页/下一页正文里的全部插图路径. */
export function imagePathsInPage(page: string | undefined): string[] {
  if (page === undefined) return [];
  const out: string[] = [];
  const regex = new RegExp(IMAGE_TOKEN_REGEX.source, 'g');
  let match = regex.exec(page);
  while (match !== null) {
    const path = match[1];
    if (path !== undefined) out.push(path);
    match = regex.exec(page);
  }
  return out;
}

/** ReaderScreen.kt:1666-1673 — 相邻页预解码入缓存（next 在前、prev 在后）. */
export function prewarmImagePathsForPages(
  pages: ReadonlyArray<string>,
  activeSubPageIndex: number,
): string[] {
  const upcoming: string[] = [];
  const next = pages[activeSubPageIndex + 1];
  const prev = pages[activeSubPageIndex - 1];
  if (next !== undefined) upcoming.push(...imagePathsInPage(next));
  if (prev !== undefined) upcoming.push(...imagePathsInPage(prev));
  return upcoming;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline image hit registry — NovelInlineImages.kt:158-224
// ─────────────────────────────────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

/**
 * NovelInlineImages.kt:167-224 `ImageHitRegistry`
 * key 是注册实例 id（非图片 path）：同一张图在正文多处引用时各占一条，互不覆盖；
 * hit 命中重叠矩形时取面积最小者（更靠前的图）；只认当前页条目。
 *
 * ADAPTATION: Android 的 `mutableStateMapOf` 触发重组；这里改为 `ListenerRegistry`
 * （Room Flow → 异步 getter + 监听器注册表的同构形态），由 ReaderPage.tsx 订阅。
 */
export class ImageHitRegistry {
  private entries = new Map<string, { path: string; rect: Rect; pageKey: string | null }>();

  private activePageKey: string | null = null;

  private readonly registry = new ListenerRegistry<void>();

  /** NovelInlineImages.kt:176-179 `setActivePage`. */
  setActivePage(pageKey: string | null): void {
    this.activePageKey = pageKey;
    this.registry.emit();
  }

  getActivePageKey(): string | null {
    return this.activePageKey;
  }

  /** NovelInlineImages.kt:181-184 `register`. */
  register(id: string, path: string, rect: Rect, pageKey: string | null): void {
    this.entries.set(id, { path, rect, pageKey });
    this.registry.emit();
  }

  /** NovelInlineImages.kt:186-191 `unregister`. */
  unregister(id: string): void {
    if (this.entries.delete(id)) {
      this.registry.emit();
    }
  }

  /** NovelInlineImages.kt:194-200 `purgeStale` — 清除非当前页的残留条目. */
  purgeStale(): number {
    let removed = 0;
    for (const [id, entry] of [...this.entries]) {
      if (entry.pageKey !== this.activePageKey) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.registry.emit();
    return removed;
  }

  /** NovelInlineImages.kt:207-218 `hit` — 命中返回图片 path，未命中 null. */
  hit(x: number, y: number): string | null {
    let best: { path: string; area: number } | null = null;
    for (const entry of this.entries.values()) {
      if (entry.pageKey !== this.activePageKey) continue;
      if (!rectContains(entry.rect, x, y)) continue;
      const area = (entry.rect.right - entry.rect.left) * (entry.rect.bottom - entry.rect.top);
      if (best === null || area < best.area) {
        best = { path: entry.path, area };
      }
    }
    return best?.path ?? null;
  }

  /** NovelInlineImages.kt:220-223 `clear`. */
  clear(): void {
    this.entries.clear();
    this.activePageKey = null;
    this.registry.emit();
  }

  subscribe(listener: () => void): () => void {
    return this.registry.subscribe(listener);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Injected ports (declared only — implementations live outside src/core)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PORT — Android `BitmapFactory` + `NovelInlineImages.NovelImageCache`
 * （NovelInlineImages.kt:65-156：48MB LRU + inflight 去重 + 相邻页 prewarm）。
 * iOS 侧不需要位图句柄：`<img src>` 由浏览器解码，decoder 只负责
 * `epzip:` 引用 → 可显示 URL 的解析与预热。**未实现**，仅声明端口。
 */
export interface InlineImageDecoder {
  /** 解析插图引用为可显示的 URL；不可解析时返回 null。 */
  resolve(path: string): Promise<string | null>;
  /** 相邻页预热（非阻塞）。 */
  prewarm(paths: ReadonlyArray<string>): void;
}

/**
 * PORT — Android `TtsManager` + Room `Flow<Boolean> isPlaying`
 * （ReaderScreen.kt:399 `collectAsStateWithLifecycle`）。
 * Room Flow → 异步 getter + 监听器注册表：**未实现**，仅声明端口。
 */
export interface ReaderTtsController {
  /** Flow<Boolean> isPlaying 的异步 getter. */
  getPlaying(): Promise<boolean>;
  /** Flow 订阅（返回取消订阅函数）. */
  subscribePlaying(listener: (playing: boolean) => void): () => void;
  /** ReaderScreen.kt:2925 / 3322 — `startReading(stripTokens(content), speed, pitch)`. */
  startReading(text: string, options: { speed: number; pitch: number }): Promise<void>;
  pause(): Promise<void>;
  previousParagraph(): Promise<void>;
  nextParagraph(): Promise<void>;
}

/**
 * PORT — Android `onCheckNovelUpdate` / `onEnsureChapterLoaded` / `onRecordTime` /
 * `onSessionEnd` 的宿主回调（ReaderScreen.kt:264-296）。仅声明，供 ReaderPage.tsx 接线。
 */
export interface ReaderScreenPorts {
  onRetryLoad(): void;
  onEnsureChapterLoaded(bookId: number, chapterIndex: number): void;
  onUpdateProgress(
    bookId: number,
    chapterIndex: number,
    offset: number,
    isFinished: boolean,
  ): void;
  onRecordTime(seconds: number): void;
  onSessionEnd(session: ReadingSessionLike): void;
  onCheckNovelUpdate(): void;
}

/** ReadingSession.kt:15-26 的结构子集（core 侧不依赖 Room 实体）。 */
export interface ReadingSessionLike {
  bookId: number | null;
  bookTitle: string;
  dateStr: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  startHour: number;
}

/** PORT — Android `rememberLauncherForActivityResult(GetContent())`（ReaderScreen.kt:408-488）。 */
export interface FilePickerPort {
  pick(mimeType: string): Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listener registry — Room Flow → 异步 getter + 监听器注册表
// ─────────────────────────────────────────────────────────────────────────────

/** 极简发布/订阅（无 React 依赖，src/core 纯 TS）。 */
export class ListenerRegistry<T> {
  private listeners = new Set<(value: T) => void>();

  private last: T | undefined = undefined;

  private hasValue = false;

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    if (this.hasValue) listener(this.last as T);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 带值的通知（Room `StateFlow<T>` 的等价物）. */
  notify(value: T): void {
    this.last = value;
    this.hasValue = true;
    this.emit();
  }

  /** 无值的「变了」通知（`mutableStateMapOf` 变更 / 脏标记）. */
  emit(): void {
    for (const listener of [...this.listeners]) listener(this.last as T);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** ReaderScreen.kt:492 — `chapters.getOrNull(currentChapterIndex)`. */
export function chapterAt<T>(chapters: ReadonlyArray<T>, index: number): T | null {
  return chapters[index] ?? null;
}

/** ReaderScreen.kt:895 — 书签摘要 `ch.content.take(60)`. */
export function bookmarkSnippet(content: string, take = 60): string {
  return content.slice(0, take);
}

/** ReaderScreen.kt:3445-3447 — 章节拖动预览索引. */
export function previewChapterIndex(
  dragPos: number | null,
  chapterCount: number,
  currentChapterIndex: number,
): number {
  if (dragPos === null) return currentChapterIndex;
  const last = Math.max(chapterCount - 1, 0);
  const round = Math.round(dragPos * Math.max(chapterCount - 1, 1));
  return Math.min(Math.max(round, 0), last);
}

/** ReaderScreen.kt:3478-3489 — 翻页档 FluidSlider 位置（0..1）. */
export function pageSliderPosition(pageIndex: number, pageCount: number): number {
  return pageIndex / Math.max(pageCount - 1, 1);
}

/** ReaderScreen.kt:3488 — `Math.round(p * (size - 1).coerceAtLeast(1))`. */
export function pageFromSliderPosition(pos: number, pageCount: number): number {
  return Math.min(
    Math.max(Math.round(pos * Math.max(pageCount - 1, 1)), 0),
    Math.max(pageCount - 1, 0),
  );
}

/** ReaderScreen.kt:3504 / 3511 — 滚动档 FluidSlider 位置与目标. */
export function scrollSliderPosition(scrollValue: number, scrollMaxValue: number): number {
  return scrollValue / Math.max(scrollMaxValue, 1);
}

export function scrollFromSliderPosition(pos: number, scrollMaxValue: number): number {
  return Math.trunc(pos * scrollMaxValue);
}
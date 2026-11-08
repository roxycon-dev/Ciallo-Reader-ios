/**
 * comicReaderChrome.tsx — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicReaderChrome.kt`（768 行 / 非空 741 行）。
 *
 * 控制层 + 面板调度（顶层 chrome）。
 * 正常阅读状态只显示漫画；呼出后呈现轻量控制栏；再进入分层设置/目录/预设/裁边面板。
 *
 * Kotlin 行号 → TS 对照：
 *   L1-L87   import（Compose / Material icons / backdrop / adaptive）→ 见「跳过说明」
 *   L88-L99  PanelBg / PanelBgGlass / PanelChipBg / PanelChipActiveBg / StrokeColor /
 *            TextPrimary / TextSecondary → CSS 变量（comicChrome.css 的 .comic-chrome），
 *            并在此导出等价的 TS 常量供单测/逻辑引用
 *   L101-L116 KDoc + `Modifier.comicPanelGlass(backdrop, shape)` → comicPanelGlassCss()
 *            （CSS backdrop-filter 等价；无 backdrop 时回退纯半透明）
 *   L118-L120 `ENTER_MS = 240` / `EXIT_MS = 180` → ENTER_MS / EXIT_MS
 *   L122-L166 KDoc + `fun ComicReaderChrome(…)` 38 个参数 → export function ComicReaderChrome(props)
 *   L167     `val onDismissPanel = { onPanelChange(ComicPanel.NONE) }` → props.onPanelChange(NONE)
 *   L168     currentRaw 钳位 → 逐行移植
 *   L169-L171 thumbPreviewRaw / thumbPreviewFraction 的 remember → useState
 *   L173-L174 `BackHandler(enabled = panel != NONE) { onDismissPanel() }`
 *            → Android 实体返回键 → `popstate` 监听（pushState 占位 + 监听器栈）
 *   L176-L201 顶部控制栏 AnimatedVisibility + ComicTopBar(…) → ComicTopBar 子组件
 *   L203-L246 底部控制栏 Box(fillMaxSize, BottomCenter) + AnimatedVisibility + ComicBottomBar(…)
 *              + 悬浮缩略图气泡条件与定位 → 逐行移植
 *   L248-L260 面板遮罩 AnimatedVisibility + Box(fillMaxSize).background(0x66000000)
 *              .clickableNoRipple(onDismissPanel) → div + CSS
 *   L262-L309 面板宿主 AnimatedVisibility + when(panel) 四分支（SETTINGS / TOC / PRESET / CROP）
 *              + NONE → Unit → 面板组件由注入的 `sheets` 端口提供（见「跳过说明」）
 *   L312-L423 ComicTopBar（完整移植，含两点菜单与收藏预设长按下拉）
 *   L425-L537 ComicBottomBar（完整移植，含滑条与章节导航）
 *   L539-L551 ChapterNavButton → 逐行移植
 *   L553-L589 ComicThumbPreview（produceState + Image/ChasingDots）→ useEffect + <img> / CSS
 *   L591-L609 ChromeIconButton → 逐行移植
 *   L611-L612 `Modifier.clickableNoRipple` → CSS 类 comic-no-ripple
 *   L614-L666 SegmentRow（FlowRow）→ CSS flex-wrap + 子组件
 *   L668-L695 SliderRow → 逐行移植
 *   L697-L710 SwitchRow → 逐行移植
 *   L712-L759 ComicSheetContainer（adaptiveSheetWidth + comicPanelGlass + 可滚动内容）
 *            → 逐行移植
 *   L761-L768 SectionLabel → 逐行移植
 *
 * 跳过说明：
 *   · `ComicSettingsSheet` / `ComicTocSheet` / `ComicPresetSheet` / `ComicCropSheet`
 *     （L270/L282/L291/L297）声明在 **ComicReaderSheets.kt**（另一 agent 拥有，本模块禁改）。
 *     为避免交叉依赖，这里把它们声明为**注入端口** `ComicSheetPorts`（props.sheets），
 *     由宿主页面接线。props 形状与 Kotlin 调用参数一一对应（含 `glassBackdrop`）。
 *   · `com.kashif_e.backdrop.Backdrop / LayerBackdrop / drawPlainBackdrop / blur(26.dp) /
 *     colorControls(saturation = 1.18f)`（L107-L116）无 Web 等价物（GL 采样）→
 *     CSS `backdrop-filter: blur(26px) saturate(1.18)`；backdrop 为 null 时按 L108 回退纯半透明。
 *     `panelGlassBackdrop: LayerBackdrop?` 参数保留为 `glassBackdrop: unknown | null`
 *     （端口：宿主传入，null 即回退）。
 *   · `androidx.activity.compose.BackHandler`（L174）：Android 实体/手势返回 →
 *     `history.pushState` 占位 + `popstate` 监听（iOS/Android WebView 均适用）。
 *     面板打开时先关面板（与 Kotlin 一致）。
 *   · `androidx.compose.foundation.Image`（L580）+ `Bitmap` → `<img>`；
 *     `Coil AsyncImage` 的 `onError` 回退 → `ChasingDots` 加载态 + `onError` 保持回退。
 *   · `androidx.compose.runtime.produceState<Bitmap?>(null, page?.id) { loader.loadThumb(it) }`
 *     （L561-L563）→ `useEffect` + 可取消的异步加载（`cancelled` 标记，效果与 keyed 重取一致）。
 *     `loader: ComicPageLoader` 是 ComicPageLoader.kt 的类型（另一 agent 拥有）→
 *     本文件只声明**端口** `ComicThumbLoader { loadThumb(ref, edge?): Promise<string | null> }`
 *     （返回可放进 `<img src>` 的 URL；`runCatching{}.getOrNull()` 的容错在 .tsx 内保留）。
 *   · `com.example.ui.components.ChasingDots`（L581-L584，size 20dp / MintPrimary）
 *     → CSS `.comic-chasing-dots`（comicChrome.css，几何常量取自 ChasingDots.kt）。
 *   · `Icons.*`（Material 图标，13 处）→ 内联 SVG（`<ComicIcon>` 组件）。
 *     路径为 Material Symbols 的等价简化路径（非官方资源，视觉近似）。
 *   · `com.example.ui.theme.MintPrimary`（L388/L484）→ CSS 变量 --comic-mint（深色面板固定薄荷绿）。
 *   · `com.example.god.GodGold.DarkStart`（L354，Color(0xFFE0CB96)）→ `#E0CB96` 常量。
 *   · `com.example.ui.adaptive.adaptiveSheetWidth()`（L728）→ CSS `max-width: 560px`
 *     + 横屏媒体查询 `840px`（AdaptiveSpec 的同一套规范，见 comicChrome.css 注释）。
 *   · `Modifier.semantics { contentDescription = "阅读进度"; progressBarRangeInfo = … }`
 *     （L515-L518）→ `role="slider"` + `aria-label` / `aria-valuenow` / `aria-valuemin|max`
 *     （PanelSlider 已支持 contentDescription prop）。
 *   · `AnimatedVisibility`（L177/L205/L249/L262）：Compose 会保留节点跑退出动画 →
 *     CSS transition（enter 240ms / exit 180ms）+ `pointer-events: none`；
 *     `tween(ENTER_MS)` / `tween(EXIT_MS)` 的时长在 CSS 里逐字保留。
 *     面板宿主 enter 用 `ENTER_MS + 40`（L264）、exit 用 `EXIT_MS - 20`（L265），同值。
 *   · `Box(Modifier.weight(1f))`（L342/L480）→ CSS `flex: 1 1 0%`。
 *   · `FlowRow`（L630）→ CSS `flex-wrap: wrap`（子组件已抽出，无 hook 在 map 内）。
 *   · `DropdownMenu` / `DropdownMenuItem`（L375/L399 等）→ 自绘下拉（CSS 类）。
 *   · `detectTapGestures(onLongPress, onTap)`（L363-L366）→ pointerdown 计时 500ms 长按
 *     + pointerup 短按（长按已触发则吞掉短按）。
 *   · `verticalScroll(rememberScrollState())`（L753）→ `overflow-y: auto`。
 *   · `statusBarsPadding()` / `navigationBarsPadding()` → `env(safe-area-inset-*)`。
 *   · `PanelChipActiveBg`（L95）在本文件内未被引用（ComicReaderSheets.kt 使用）→
 *     仍导出 CSS 变量与 TS 常量，保持令牌完整。
 *
 * 适配说明：
 *   · dp → CSS px 1:1，sp → CSS px 1:1（本项目统一约定）。
 *   · Kotlin `Int`/`Float` → `number`；`coerceIn/coerceAtLeast` → Math.min/max。
 *   · `config.mode.label` / `config.direction.label` → core 的 comicModeLabel / comicDirectionLabel。
 *   · `bookState.copy(mergeAnchors = anchors ± currentRaw)` → 对象展开（不改原对象）。
 *   · `config.copy(manualCrop = listOf(l, t, r, b))` → `{ ...config, manualCrop: [l, t, r, b] }`。
 *   · `pages.getOrNull(currentRaw)` → `pages[currentRaw] ?? null`。
 *
 * React 19 lint 合规说明：
 *   · `ref.current` 只在事件回调 / effect 里读，render 期零 ref 读取。
 *   · 无 `Math.random()` / `Date.now()`。
 *   · `ComicBottomBar` 的 slider 派生量（sliderRange / sliderValue / reverse）在 render
 *     里由 props 直接算出，**不用 setState 承载**（`dragging` / `dragTarget` 是真实的
 *     交互态，不是派生数据）。
 *   · 菜单项 / 章节按钮 / Segment 选项 / fav 菜单项都抽成无状态子组件，
 *     `.map()` 回调里没有 hook。
 *   · 所有 hook 在组件顶层无条件调用（面板分支用三元/早返回在 JSX 层处理，不用条件 hook）。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  comicDirectionLabel,
  comicModeLabel,
  spreadOfRawPage,
  type ComicBookState,
  type ComicPageRef,
  type ComicReaderConfig,
} from '@core/comic/comicPageLayout';
import {
  PanelSlider,
  PanelSwitch,
  comicPanelWithAlpha,
  resolveComicMintPrimary,
  type FloatRange,
} from './comicPanelDesign';
import '../../../styles/comicChrome.css';

//
// ── L88-L120  色彩令牌与过渡节奏
//

/** `internal val PanelBg = Color(0xD91A1A1E)`（L92）——Kotlin 是 AARRGGBB，此处为 CSS rgba。 */
export const PanelBg = 'rgba(26, 26, 30, 0.85)'
/** `internal val PanelBgGlass = Color(0xCC1A1A1E)`（L93） */
export const PanelBgGlass = 'rgba(26, 26, 30, 0.8)'
/** `internal val PanelChipBg = Color(0x16FFFFFF)`（L94） */
export const PanelChipBg = 'rgba(255, 255, 255, 0.086)'
/** `internal val PanelChipActiveBg = Color(0x30FFFFFF)`（L95） */
export const PanelChipActiveBg = 'rgba(255, 255, 255, 0.188)'
/** `internal val StrokeColor = Color(0x1FFFFFFF)`（L96） */
export const StrokeColor = 'rgba(255, 255, 255, 0.122)'
/** `internal val TextPrimary = Color(0xFFF2F2F4)`（L97） */
export const TextPrimary = '#F2F2F4'
/** 0xB3 alpha ≈ 70% 白，对 PanelBg 对比度 ≈ 5.9:1（旧 0x99 仅 ~4:1，12sp 标签低于 WCAG AA）（L98-L99） */
export const TextSecondary = 'rgba(255, 255, 255, 0.7)'
/** GodGold.DarkStart = `Color(0xFFE0CB96)`（L354） */
export const GodGoldDarkStart = '#E0CB96'

/** 面板/控件的统一过渡节奏 ── Android L119 ── */
export const ENTER_MS = 240
/** 面板/控件的统一过渡节奏 ── Android L120 ── */
export const EXIT_MS = 180

/**
 * 第 11 条终审版 + 第七轮第 3 条质感升级：面板真毛玻璃背景——采样模式渲染层
 * 做高斯模糊（26dp）+ 轻提饱和（玻璃通透感），再叠 0xCC 暗纱（比旧 0xD9 通透一档，
 * 摆脱"纯黑沉闷"；白纸页最坏情况下文字对比度仍 ≥ AA）。backdrop 为 null
 * （CURL 的 GL 层采不到）时回退纯半透明 PanelBg。
 * ── Android L101-L116 ──
 */
export function comicPanelGlassCss(backdrop: unknown | null): {
  background: string
  backdropFilter: string
} {
  if (backdrop === null || backdrop === undefined) {
    return { background: PanelBg, backdropFilter: 'none' }
  }
  return {
    // `blur(radius = 26.dp.toPx())` + `colorControls(saturation = 1.18f)`（L113-L114）
    background: PanelBgGlass,
    backdropFilter: 'blur(26px) saturate(1.18)',
  }
}

//
// ── 外部类型端口（owner: ComicReaderCore.kt / ComicReaderSheets.kt / ComicSettingsStore.kt）
//

/** `enum class ComicPanel { NONE, SETTINGS, TOC, PRESET, CROP }`（ComicReaderCore.kt L110）。 */
export const ComicPanel = {
  NONE: 'NONE',
  SETTINGS: 'SETTINGS',
  TOC: 'TOC',
  PRESET: 'PRESET',
  CROP: 'CROP',
} as const
export type ComicPanel = (typeof ComicPanel)[keyof typeof ComicPanel]

/** `data class ComicTocEntry(val id: String, val title: String)`（ComicReaderCore.kt L107）。 */
export interface ComicTocEntry {
  readonly id: string
  readonly title: string
}

/** `data class ComicPreset(...)`（ComicSettingsStore.kt L278-L286）——仅 chrome 用到的字段。 */
export interface ComicPreset {
  readonly id: string
  readonly name: string
  readonly emoji: string
  readonly config: ComicReaderConfig
  readonly favorite: boolean
}

/** ComicSettingsStore 端口（本模块只用 `favoritePresets()`，L329）。 */
export interface ComicSettingsStorePort {
  favoritePresets(): ComicPreset[]
}

/** ComicPageLoader 端口（本模块只用 `loadThumb`，L562；返回 `<img src>` URL）。 */
export interface ComicThumbLoader {
  loadThumb(ref: ComicPageRef, edge?: number): Promise<string | null>
}

/**
 * ComicReaderSheets.kt 的四个面板组件的**注入端口**（L270/L282/L291/L297）。
 * props 形状与 Kotlin 调用参数一一对应。
 */
export interface ComicSheetPorts {
  readonly settings: (props: {
    config: ComicReaderConfig
    store: ComicSettingsStorePort
    perBookConfig: boolean
    onPerBookConfigChange: (next: boolean) => void
    onConfigChange: (config: ComicReaderConfig) => void
    onOpenPreset: () => void
    onOpenCrop: () => void
    pages: readonly ComicPageRef[]
    loader: ComicThumbLoader
    currentRawPage: number
    bookState: ComicBookState
    onBookStateChange: (next: ComicBookState) => void
    onDismiss: () => void
    glassBackdrop: unknown | null
  }) => ReactNode
  readonly toc: (props: {
    toc: readonly ComicTocEntry[]
    currentChapterIndex: number
    onJumpToChapter: ((index: number) => void) | null
    pages: readonly ComicPageRef[]
    loader: ComicThumbLoader
    currentPage: number
    onJumpToRawPage: (raw: number) => void
    onDismiss: () => void
    glassBackdrop: unknown | null
  }) => ReactNode
  readonly preset: (props: {
    store: ComicSettingsStorePort
    currentConfig: ComicReaderConfig
    onApply: (config: ComicReaderConfig) => void
    onDismiss: () => void
    glassBackdrop: unknown | null
  }) => ReactNode
  readonly crop: (props: {
    page: ComicPageRef | null
    loader: ComicThumbLoader
    config: ComicReaderConfig
    onDismiss: () => void
    onApply: (l: number, t: number, r: number, b: number) => void
  }) => ReactNode
}

//
// ── Material 图标 → 内联 SVG（L340/L352/L354/L371/L398/L406/L411/L416/L488-L493）
//

type ComicIconName =
  | 'arrow-back'
  | 'auto-stories'
  | 'star-outline'
  | 'chevron-left'
  | 'chevron-right'
  | 'more-horiz'
  | 'pause'
  | 'play-arrow'
  | 'settings'

/** Material 图标的等价简化路径（24dp 视口，视觉近似，非官方资源）。 */
const COMIC_ICON_PATHS: Readonly<Record<ComicIconName, string>> = {
  'arrow-back': 'M15.5 4.5 8 12l7.5 7.5',
  'auto-stories': 'M5 4h5a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5zM19 4h-5a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h5z',
  'star-outline': 'M12 4.2 14.6 9l5.4.8-3.9 3.7.9 5.3-4.9-2.6-4.9 2.6.9-5.3L4.1 9.8 9.5 9z',
  'chevron-left': 'M14.5 5.5 8 12l6.5 6.5',
  'chevron-right': 'M9.5 5.5 16 12l-6.5 6.5',
  'more-horiz': 'M6 12h.01M12 12h.01M18 12h.01',
  pause: 'M9 5v14M15 5v14',
  'play-arrow': 'M7 4.5 19 12 7 19.5z',
  settings:
    'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM4 12a8 8 0 0 1 .12-1.4l-1.7-1.3 1.7-2.9 2 .8A8 8 0 0 1 8.3 5.6l-.3-2.1h3.4l.3 2.1a8 8 0 0 1 2.16 1.6l2-.8 1.7 2.9-1.7 1.3A8 8 0 0 1 16 12a8 8 0 0 1-.12 1.4l1.7 1.3-1.7 2.9-2-.8a8 8 0 0 1-2.16 1.6l-.3 2.1H8l-.3-2.1a8 8 0 0 1-2.16-1.6l-2 .8-1.7-2.9 1.7-1.3A8 8 0 0 1 4 12z',
}

/** Android `Icon(icon, desc, tint, Modifier.size(22.dp))` → 内联 SVG（统一描边风格）。 */
function ComicIcon(props: { name: ComicIconName; desc: string; tint: string }) {
  return (
    <svg
      className="comic-icon-button__glyph"
      viewBox="0 0 24 24"
      role={props.desc === '' ? 'presentation' : 'img'}
      aria-label={props.desc === '' ? undefined : props.desc}
      aria-hidden={props.desc === '' ? true : undefined}
      style={{ color: props.tint }}
    >
      <path
        d={COMIC_ICON_PATHS[props.name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

//
// ── L167-L310  ComicReaderChrome
//

export interface ComicReaderChromeProps {
  visible: boolean
  panel: ComicPanel
  onPanelChange: (panel: ComicPanel) => void
  /** Android: `panelGlassBackdrop: LayerBackdrop? = null`（L131）→ 端口（null 即回退） */
  panelGlassBackdrop?: unknown | null
  title: string
  chapterTitle: string | null
  currentPage: number
  totalPages: number
  spreadCount: number
  currentSpread: number
  config: ComicReaderConfig
  store: ComicSettingsStorePort
  perBookConfig: boolean
  onPerBookConfigChange: (next: boolean) => void
  onConfigChange: (config: ComicReaderConfig) => void
  onJumpToSpread: (spread: number) => void
  spreadFirstRaw: (spread: number) => number
  onJumpToRawPage: (raw: number) => void
  onGoPrev: () => void
  onGoNext: () => void
  autoRead: boolean
  onAutoReadToggle: () => void
  continuousFraction?: number
  onJumpToScrollFraction?: ((fraction: number) => void) | null
  spreadAtScrollFraction?: (fraction: number) => number
  toc: readonly ComicTocEntry[]
  currentChapterIndex: number
  onJumpToChapter: ((index: number) => void) | null
  onPrevChapter: (() => void) | null
  onNextChapter: (() => void) | null
  onGodMoment?: (() => void) | null
  chapterNavLabel: string
  pages: readonly ComicPageRef[]
  loader: ComicThumbLoader
  bookState: ComicBookState
  onBookStateChange: (next: ComicBookState) => void
  onToggleControls: () => void
  onExit: () => void
  /** ComicReaderSheets.kt 的四个面板组件（注入端口，见「跳过说明」）。 */
  sheets: ComicSheetPorts
}

export function ComicReaderChrome(props: ComicReaderChromeProps) {
  // ── Android L167: `val onDismissPanel = { onPanelChange(ComicPanel.NONE) }` ──
  const onDismissPanel = useCallback(() => {
    props.onPanelChange(ComicPanel.NONE)
  }, [props])

  // ── Android L168: `val currentRaw = (currentPage - 1).coerceIn(0, (pages.size - 1).coerceAtLeast(0))` ──
  const currentRaw = Math.min(Math.max(props.currentPage - 1, 0), Math.max(props.pages.length - 1, 0))

  // ── Android L169-L171: 进度条拖动中的缩略图预览目标页（-1 = 关闭） ──
  const [thumbPreviewRaw, setThumbPreviewRaw] = useState(-1)
  const [thumbPreviewFraction, setThumbPreviewFraction] = useState(-1)

  // ── Android L173-L174: BackHandler(enabled = panel != ComicPanel.NONE) { onDismissPanel() } ──
  // Android 实体返回键 → WebView/iOS 的 popstate（见「跳过说明」）
  useEffect(() => {
    if (props.panel === ComicPanel.NONE) return
    const onPopState = (): void => {
      onDismissPanel()
      window.history.pushState({ comicPanel: true }, '')
    }
    window.history.pushState({ comicPanel: true }, '')
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [props.panel, onDismissPanel])

  const onThumbPreview = useCallback((raw: number, fraction: number) => {
    setThumbPreviewRaw(raw)
    setThumbPreviewFraction(fraction)
  }, [])

  // ── Android L229-L231: 气泡可见条件 ──
  const showThumbBubble =
    props.visible &&
    props.panel === ComicPanel.NONE &&
    props.config.showThumbPreview &&
    thumbPreviewRaw >= 0 &&
    thumbPreviewRaw < props.pages.length &&
    props.spreadCount > 1

  // ── Android L233-L236: 气泡水平位置跟随进度滑块拇指 ──
  //      ±130dp 内偏移，避免贴边裁切
  const fraction =
    thumbPreviewFraction >= 0 && thumbPreviewFraction <= 1
      ? thumbPreviewFraction
      : Math.min(
          Math.max(thumbPreviewRaw / Math.max(props.pages.length - 1, 1), 0),
          1,
        )
  const visualFraction =
    props.config.direction === 'RTL' &&
    props.config.mode !== 'WEBTOON' &&
    props.config.mode !== 'CONTINUOUS'
      ? 1 - fraction
      : fraction

  // ── Android L193-L199: onToggleMerge 的状态翻转 ──
  const onToggleMerge = useCallback(() => {
    const anchors = props.bookState.mergeAnchors
    props.onBookStateChange({
      ...props.bookState,
      mergeAnchors: anchors.has(currentRaw)
        ? new Set([...anchors].filter((v) => v !== currentRaw))
        : new Set([...anchors, currentRaw]),
    })
  }, [props, currentRaw])

  // ── Android L249: 面板遮罩可见条件 ──
  const panelVisible = props.panel !== ComicPanel.NONE

  return (
    <div className="comic-chrome">
      {/* ── Android L176-L201: 顶部控制栏 AnimatedVisibility(visible && panel == NONE) ── */}
      <div className={chromeVisibleClass(props.visible && props.panel === ComicPanel.NONE, 'comic-top-bar')}>
        <ComicTopBar
          title={props.title}
          chapterTitle={props.chapterTitle}
          config={props.config}
          store={props.store}
          onApplyPresetConfig={props.onConfigChange}
          onExit={props.onExit}
          onOpenPanel={props.onPanelChange}
          onToggleMerge={onToggleMerge}
          onGodMoment={props.onGodMoment ?? null}
        />
      </div>

      {/* ── Android L203-L246: 底部控制栏 + 悬浮缩略图气泡 ──
          （气泡由 Chrome 层渲染，不占底栏布局） */}
      <div className={chromeVisibleClass(props.visible && props.panel === ComicPanel.NONE, 'comic-bottom-bar')}>
        <ComicBottomBar
          currentPage={props.currentPage}
          totalPages={props.totalPages}
          spreadCount={props.spreadCount}
          currentSpread={props.currentSpread}
          config={props.config}
          onThumbPreview={onThumbPreview}
          spreadFirstRaw={props.spreadFirstRaw}
          autoRead={props.autoRead}
          onAutoReadToggle={props.onAutoReadToggle}
          onJumpToSpread={props.onJumpToSpread}
          onGoPrev={props.onGoPrev}
          onGoNext={props.onGoNext}
          onPrevChapter={props.onPrevChapter}
          onNextChapter={props.onNextChapter}
          chapterNavLabel={props.chapterNavLabel}
          continuousFraction={props.continuousFraction ?? -1}
          onJumpToScrollFraction={props.onJumpToScrollFraction ?? null}
          spreadAtScrollFraction={props.spreadAtScrollFraction ?? ((): number => 0)}
        />
      </div>

      {showThumbBubble ? (
        /* ── Android L237-L244: ComicThumbPreview(Modifier.padding(bottom = 316.dp)
             .offset(x = ((visualFraction - 0.5f) * 260f).dp)) ── */
        <ComicThumbPreviewHost
          offsetX={(visualFraction - 0.5) * 260}
          page={props.pages[thumbPreviewRaw] ?? null}
          rawShown={thumbPreviewRaw}
          loader={props.loader}
        />
      ) : null}

      {/* ── Android L248-L260: 面板遮罩（与面板同节奏淡入淡出） ── */}
      {panelVisible ? (
        <div className="comic-panel-scrim" onClick={onDismissPanel} role="presentation" />
      ) : null}

      {/* ── Android L262-L309: 面板宿主 + when(panel) ── */}
      {panelVisible ? (
        <div className="comic-panel-host">
          {renderPanel(props, currentRaw, onDismissPanel)}
        </div>
      ) : null}
    </div>
  )
}

/** AnimatedVisibility 的 CSS 等价：可见 → 无 `--out`；隐藏 → 加 `--out`（跑退出动画）。 */
function chromeVisibleClass(visible: boolean, base: string): string {
  return visible ? base : `${base} ${base}--out`
}

/** ── Android L268-L308: `Box(fillMaxSize, BottomCenter) { when (panel) { … } }` ── */
function renderPanel(props: ComicReaderChromeProps, currentRaw: number, onDismiss: () => void): ReactNode {
  const glassBackdrop = props.panelGlassBackdrop ?? null
  if (props.panel === ComicPanel.SETTINGS) {
    return props.sheets.settings({
      config: props.config,
      store: props.store,
      perBookConfig: props.perBookConfig,
      onPerBookConfigChange: props.onPerBookConfigChange,
      onConfigChange: props.onConfigChange,
      onOpenPreset: () => {
        props.onPanelChange(ComicPanel.PRESET)
      },
      onOpenCrop: () => {
        props.onPanelChange(ComicPanel.CROP)
      },
      pages: props.pages,
      loader: props.loader,
      currentRawPage: currentRaw,
      bookState: props.bookState,
      onBookStateChange: props.onBookStateChange,
      onDismiss,
      glassBackdrop,
    })
  }
  if (props.panel === ComicPanel.TOC) {
    return props.sheets.toc({
      toc: props.toc,
      currentChapterIndex: props.currentChapterIndex,
      onJumpToChapter: props.onJumpToChapter,
      pages: props.pages,
      loader: props.loader,
      currentPage: props.currentPage,
      onJumpToRawPage: props.onJumpToRawPage,
      onDismiss,
      glassBackdrop,
    })
  }
  if (props.panel === ComicPanel.PRESET) {
    return props.sheets.preset({
      store: props.store,
      currentConfig: props.config,
      onApply: props.onConfigChange,
      onDismiss,
      glassBackdrop,
    })
  }
  if (props.panel === ComicPanel.CROP) {
    return props.sheets.crop({
      // ── Android L298: `pages.getOrNull(currentRaw)` ──
      page: props.pages[currentRaw] ?? null,
      loader: props.loader,
      config: props.config,
      onDismiss,
      // ── Android L301-L304: `onApply = { l, t, r, b -> onConfigChange(config.copy(manualCrop = listOf(l, t, r, b))); onDismissPanel() }` ──
      onApply: (l, t, r, b) => {
        props.onConfigChange({ ...props.config, manualCrop: [l, t, r, b] })
        onDismiss()
      },
    })
  }
  // ── Android L306: `ComicPanel.NONE -> Unit` ──
  return null
}

/* ══════════════ 顶栏（Android L312-L423） ══════════════ */
// 新反馈条目6：三点菜单"旋转本页 90°"入口已移除（按用户要求）；
// 旋转能力本体保留在设置面板·图像 Tab（"整本旋转/旋转本页 +90°"），
// pageRotations 状态模型不受影响（手动裁边/管线指纹仍引用）
// —— Android L190-L192 的注释原样保留；对应菜单项在 Kotlin 里也已删除，
//    故 TS 侧同样没有该分支（不是跳过，是源文件已无此代码）。

function ComicTopBar(props: {
  title: string
  chapterTitle: string | null
  config: ComicReaderConfig
  store: ComicSettingsStorePort
  onApplyPresetConfig: (config: ComicReaderConfig) => void
  onExit: () => void
  onOpenPanel: (panel: ComicPanel) => void
  onToggleMerge: () => void
  onGodMoment: (() => void) | null
}) {
  // ── Android L326: `var menuOpen by remember { mutableStateOf(false) }` ──
  const [menuOpen, setMenuOpen] = useState(false)
  // ── Android L327-L328: 收藏预设快捷应用（第 27 条）：长按"阅读设置"按钮直接弹出收藏列表一键应用 ──
  const [favMenuOpen, setFavMenuOpen] = useState(false)
  // ── Android L329: `val favorites by remember { mutableStateOf(store.favoritePresets()) }` ──
  const favorites = useMemo(() => props.store.favoritePresets(), [props.store])

  return (
    <div className="comic-top-bar__panel">
      <div className="comic-top-bar__row">
        {/* ── Android L340 ── */}
        <ChromeIconButton name="arrow-back" desc="返回" onClick={props.onExit} />
        {/* ── Android L341: Spacer(Modifier.width(4.dp)) ── */}
        <span className="comic-top-bar__gap4" />
        {/* ── Android L342-L351 ── */}
        <div className="comic-top-bar__titles">
          <span className="comic-top-bar__title">{props.title}</span>
          <span className="comic-top-bar__subtitle">
            {/* ── Android L348: `chapterTitle ?: ("${config.mode.label} · ${config.direction.label}")` ── */}
            {props.chapterTitle ?? `${comicModeLabel(props.config.mode)} · ${comicDirectionLabel(props.config.direction)}`}
          </span>
        </div>
        {/* ── Android L352 ── */}
        <ChromeIconButton
          name="auto-stories"
          desc="目录"
          onClick={() => {
            props.onOpenPanel(ComicPanel.TOC)
          }}
        />
        {/* ── Android L353-L355 ── */}
        {props.onGodMoment != null ? (
          <ChromeIconButton
            name="star-outline"
            desc="标记神回"
            tint={GodGoldDarkStart}
            onClick={props.onGodMoment}
          />
        ) : null}

        {/* ── Android L356-L396: 长按 = 收藏预设快捷应用（第 27 条）；点击 = 打开设置面板 ── */}
        <div style={{ position: 'relative' }}>
          <ChromeIconButton
            name="settings"
            desc="阅读设置"
            {...(favorites.length > 0
              ? {
                  onLongPress: () => {
                    setFavMenuOpen(true)
                  },
                }
              : {})}
            onClick={() => {
              props.onOpenPanel(ComicPanel.SETTINGS)
            }}
          />
          {favMenuOpen ? (
            <ComicFavMenu
              favorites={favorites}
              onDismiss={() => {
                setFavMenuOpen(false)
              }}
              onApply={(preset) => {
                // ── Android L389-L392: favMenuOpen = false; onApplyPresetConfig(p.config) ──
                setFavMenuOpen(false)
                props.onApplyPresetConfig(preset.config)
              }}
            />
          ) : null}
        </div>

        {/* ── Android L397-L420: 三点菜单 ── */}
        <div style={{ position: 'relative' }}>
          <ChromeIconButton
            name="more-horiz"
            desc="更多"
            onClick={() => {
              setMenuOpen(true)
            }}
          />
          {menuOpen ? (
            <ComicMoreMenu
              onDismiss={() => {
                setMenuOpen(false)
              }}
              onToggleMerge={() => {
                // ── Android L407: `menuOpen = false; onToggleMerge()` ──
                setMenuOpen(false)
                props.onToggleMerge()
              }}
              onOpenCrop={() => {
                // ── Android L412 ──
                setMenuOpen(false)
                props.onOpenPanel(ComicPanel.CROP)
              }}
              onOpenPreset={() => {
                // ── Android L417 ──
                setMenuOpen(false)
                props.onOpenPanel(ComicPanel.PRESET)
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** ── Android L375-L395: 收藏预设 DropdownMenu（containerColor = Color(0xFF232327)） ── */
function ComicFavMenu(props: {
  favorites: readonly ComicPreset[]
  onDismiss: () => void
  onApply: (preset: ComicPreset) => void
}) {
  return (
    <>
      {/* onDismissRequest（Android L377）：点外面关闭 */}
      <button type="button" className="comic-menu__dismiss" aria-label="关闭菜单" onClick={props.onDismiss} />
      <div className="comic-menu comic-menu--fav" role="menu">
        {/* ── Android L380-L384 ── */}
        <div className="comic-menu__heading">收藏预设</div>
        {props.favorites.map((p) => (
          <button key={p.id} type="button" className="comic-menu__item" role="menuitem" onClick={() => props.onApply(p)}>
            {/* ── Android L388: `leadingIcon = { Text(p.emoji, color = MintPrimary, fontSize = 12.sp) }` ── */}
            <span className="comic-menu__leading comic-menu__leading-emoji">{p.emoji}</span>
            {/* ── Android L387: `text = { Text(p.name, color = TextPrimary) }` ── */}
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** ── Android L399-L419: 三点菜单 DropdownMenu ── */
function ComicMoreMenu(props: {
  onDismiss: () => void
  onToggleMerge: () => void
  onOpenCrop: () => void
  onOpenPreset: () => void
}) {
  return (
    <>
      <button type="button" className="comic-menu__dismiss" aria-label="关闭菜单" onClick={props.onDismiss} />
      <div className="comic-menu comic-menu--more" role="menu">
        {/* ── Android L404-L408 ── */}
        <button type="button" className="comic-menu__item" role="menuitem" onClick={props.onToggleMerge}>
          <span className="comic-menu__leading">
            <ComicIcon name="auto-stories" desc="" tint={TextSecondary} />
          </span>
          <span>临时合页 / 取消</span>
        </button>
        {/* ── Android L409-L413 ── */}
        <button type="button" className="comic-menu__item" role="menuitem" onClick={props.onOpenCrop}>
          <span className="comic-menu__leading">
            <ComicIcon name="settings" desc="" tint={TextSecondary} />
          </span>
          <span>手动裁边</span>
        </button>
        {/* ── Android L414-L418 ── */}
        <button type="button" className="comic-menu__item" role="menuitem" onClick={props.onOpenPreset}>
          <span className="comic-menu__leading">
            <ComicIcon name="chevron-left" desc="" tint={TextSecondary} />
          </span>
          <span>阅读预设</span>
        </button>
      </div>
    </>
  )
}

/* ══════════════ 底栏（Android L425-L537） ══════════════ */

function ComicBottomBar(props: {
  currentPage: number
  totalPages: number
  spreadCount: number
  currentSpread: number
  config: ComicReaderConfig
  onThumbPreview: (raw: number, fraction: number) => void
  spreadFirstRaw: (spread: number) => number
  autoRead: boolean
  onAutoReadToggle: () => void
  onJumpToSpread: (spread: number) => void
  onGoPrev: () => void
  onGoNext: () => void
  onPrevChapter: (() => void) | null
  onNextChapter: (() => void) | null
  chapterNavLabel: string
  continuousFraction: number
  onJumpToScrollFraction: ((fraction: number) => void) | null
  spreadAtScrollFraction: (fraction: number) => number
}) {
  // ── Android L448: `var dragging by remember { mutableStateOf(false) }` ──
  const [dragging, setDragging] = useState(false)
  // ── Android L449: `val scrolling = continuousFraction in 0f..1f && onJumpToScrollFraction != null` ──
  const scrolling = props.continuousFraction >= 0 && props.continuousFraction <= 1 && props.onJumpToScrollFraction != null
  // ── Android L450: `val sliderRange = 0f..if (scrolling) 1f else (spreadCount - 1).coerceAtLeast(1).toFloat()` ──
  const sliderRange: FloatRange = [0, scrolling ? 1 : Math.max(props.spreadCount - 1, 1)]
  // ── Android L451: `val sliderValue = if (scrolling) continuousFraction else currentSpread.toFloat()` ──
  const sliderValue = scrolling ? props.continuousFraction : props.currentSpread
  // ── Android L452: `var dragTarget by remember(scrolling) { mutableFloatStateOf(sliderValue) }` ──
  // `remember(scrolling)` 的语义 = scrolling 翻转时丢弃旧值。Web 端用「记录写入时的 key」
  // 的方式在 render 期纯派生（不用 effect 同步 setState）：
  // dragKey !== scrolling 时视为未拖动 → 回落到 sliderValue。
  const [dragState, setDragState] = useState<{ dragKey: boolean; target: number } | null>(null)
  const dragTarget = dragState !== null && dragState.dragKey === scrolling ? dragState.target : sliderValue
  // ── Android L453: `val sliderEnabled = spreadCount > 1 || scrolling` ──
  const sliderEnabled = props.spreadCount > 1 || scrolling
  // ── Android L454-L455: `val reverse = …` ──
  const reverse =
    props.config.direction === 'RTL' &&
    props.config.mode !== 'WEBTOON' &&
    props.config.mode !== 'CONTINUOUS'

  // ── Android L467-L493: 状态行 ──
  const percentText = useMemo(() => {
    // 垂直列表按滚动位置，其余模式按页数。（Android L473）
    const raw =
      props.continuousFraction >= 0 && props.continuousFraction <= 1
        ? props.continuousFraction * 100
        : (props.currentPage / Math.max(props.totalPages, 1)) * 100
    return `· ${Math.trunc(raw)}%`
  }, [props.continuousFraction, props.currentPage, props.totalPages])

  return (
    <div className="comic-bottom-bar__panel">
      <div className="comic-bottom-bar__row">
        {/* ── Android L467-L470 ── */}
        <span className="comic-bottom-bar__page">
          {props.currentPage} / {props.totalPages}
        </span>
        {/* ── Android L471: Spacer(Modifier.width(8.dp)) ── */}
        <span className="comic-bottom-bar__gap8" />
        {/* ── Android L472-L479 ── */}
        <span className="comic-bottom-bar__percent">{percentText}</span>
        {/* ── Android L480: Spacer(Modifier.weight(1f)) ── */}
        <span className="comic-bottom-bar__spacer" />
        {/* ── Android L481-L486 ── */}
        <span className={props.autoRead ? 'comic-bottom-bar__status comic-bottom-bar__status--active' : 'comic-bottom-bar__status'}>
          {props.autoRead ? '自动阅读中' : comicModeLabel(props.config.mode)}
        </span>
        {/* ── Android L487: Spacer(Modifier.width(6.dp)) ── */}
        <span className="comic-bottom-bar__gap6" />
        {/* ── Android L488: 上一页（RTL 时换向） ── */}
        <ChromeIconButton
          name={reverse ? 'chevron-right' : 'chevron-left'}
          desc="上一页"
          onClick={props.onGoPrev}
        />
        {/* ── Android L489-L492 ── */}
        <ChromeIconButton
          name={props.autoRead ? 'pause' : 'play-arrow'}
          desc={props.autoRead ? '暂停自动阅读' : '开始自动阅读'}
          onClick={props.onAutoReadToggle}
        />
        {/* ── Android L493: 下一页（RTL 时换向） ── */}
        <ChromeIconButton
          name={reverse ? 'chevron-left' : 'chevron-right'}
          desc="下一页"
          onClick={props.onGoNext}
        />
      </div>

      {/* 第七轮第 3 条：底栏进度滑条同步迁移到面板统一滑条（同一套视觉语言） ── Android L496-L519 ── */}
      <PanelSlider
        value={dragging ? dragTarget : sliderValue}
        onValueChange={(next) => {
          // ── Android L499-L505 ──
          setDragging(true)
          setDragState({ dragKey: scrolling, target: next })
          const spreadIdx = Math.min(
            Math.max(scrolling ? props.spreadAtScrollFraction(next) : Math.trunc(next), 0),
            Math.max(props.spreadCount - 1, 0),
          )
          props.onThumbPreview(props.spreadFirstRaw(spreadIdx), next / sliderRange[1])
        }}
        onValueChangeFinished={() => {
          // ── Android L506-L511 ──
          if (scrolling) props.onJumpToScrollFraction?.(dragTarget)
          else props.onJumpToSpread(Math.trunc(dragTarget))
          setDragging(false)
          setDragState(null)
          props.onThumbPreview(-1, -1)
        }}
        enabled={sliderEnabled}
        reverse={reverse}
        valueRange={sliderRange}
        // ── Android L515-L518: `Modifier.semantics { contentDescription = "阅读进度"; … }` ──
        contentDescription="阅读进度"
      />

      {/* ── Android L521-L535: 章节导航行 ── */}
      {props.onPrevChapter != null || props.onNextChapter != null ? (
        <div className="comic-chapter-nav">
          <ChapterNavButton
            text={`上一${props.chapterNavLabel}`}
            enabled={props.onPrevChapter != null}
            onClick={() => {
              props.onPrevChapter?.()
            }}
          />
          <ChapterNavButton
            text={`下一${props.chapterNavLabel}`}
            enabled={props.onNextChapter != null}
            onClick={() => {
              props.onNextChapter?.()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

/** ── Android L539-L551: ChapterNavButton ── */
function ChapterNavButton(props: { text: string; enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={props.enabled ? 'comic-chapter-nav__button' : 'comic-chapter-nav__button comic-chapter-nav__button--disabled'}
      disabled={!props.enabled}
      onClick={() => {
        if (props.enabled) props.onClick()
      }}
    >
      {/* ── Android L549: `Text(text, color = if (enabled) TextPrimary else Color(0x55FFFFFF), fontSize = 12.sp)` ── */}
      <span className={props.enabled ? 'comic-chapter-nav__label' : 'comic-chapter-nav__label comic-chapter-nav__label--disabled'}>
        {props.text}
      </span>
    </button>
  )
}

/** ── Android L237-L244: ComicThumbPreview 的定位宿主（padding(bottom=316dp) + offset(x)） ── */
function ComicThumbPreviewHost(props: {
  offsetX: number
  page: ComicPageRef | null
  rawShown: number
  loader: ComicThumbLoader
}) {
  return (
    <div
      className="comic-thumb-preview"
      style={{ paddingBottom: 316, transform: `translateX(${props.offsetX}px)` }}
    >
      <ComicThumbPreview page={props.page} rawShown={props.rawShown} loader={props.loader} />
    </div>
  )
}

/** 滑条拖动时的页面缩略图气泡（悬浮，不占布局） ── Android L553-L589 ── */
export function ComicThumbPreview(props: {
  page: ComicPageRef | null
  rawShown: number
  loader: ComicThumbLoader
}) {
  // ── Android L561-L563:
  //   `val bitmap by produceState<Bitmap?>(null, page?.id) { page?.let { value = runCatching { loader.loadThumb(it) }.getOrNull() } }`
  //   produceState 的 key 是 `page?.id`：换页即丢弃旧值。Web 端用「记录归属页 id」
  //   的方式在 render 期纯派生（不在 effect 里同步 setState）：
  //   loaded.pageId !== 当前 pageId → 视为无结果 → 显示 ChasingDots。 ──
  const pageId = props.page?.id ?? null
  const [loaded, setLoaded] = useState<{ pageId: string | null; src: string | null } | null>(null)

  useEffect(() => {
    const page = props.page
    if (page === null || page === undefined) return
    let cancelled = false
    // `runCatching { … }.getOrNull()` → try/catch 容错
    Promise.resolve(props.loader.loadThumb(page))
      .then((url) => {
        if (!cancelled) setLoaded({ pageId: page.id, src: url })
      })
      .catch(() => {
        // Unsupported/truncated：保持回退态（与 Kotlin getOrNull() = null 一致）
        if (!cancelled) setLoaded({ pageId: page.id, src: null })
      })
    return () => {
      cancelled = true
    }
  }, [pageId, props.loader, props.page])

  // render 期纯派生：key 不匹配即为「未加载完成」
  const src = loaded !== null && loaded.pageId === pageId ? loaded.src : null

  return (
    <div className="comic-thumb-preview__card">
      <div className="comic-thumb-preview__frame">
        {src !== null ? (
          /* ── Android L580: `Image(it.asImageBitmap(), null, fillMaxSize, ContentScale.Crop)` ── */
          <img className="comic-thumb-preview__img" src={src} alt="" aria-hidden="true" />
        ) : (
          /* ── Android L581-L584: `com.example.ui.components.ChasingDots(size = 20.dp, color = MintPrimary)` ── */
          <span className="comic-chasing-dots" aria-hidden="true" />
        )}
      </div>
      {/* ── Android L586: Spacer(Modifier.height(4.dp)) ── */}
      {/* ── Android L587: `Text("第 ${rawShown + 1} 页", color = TextPrimary, fontSize = 11.sp)` ── */}
      <span className="comic-thumb-preview__label">第 {props.rawShown + 1} 页</span>
    </div>
  )
}

/* ══════════════ 通用控件（Android L591-L612） ══════════════ */

/** ── Android L593-L609: ChromeIconButton（44dp 圆形命中区 + 22dp 图标） ── */
export function ChromeIconButton(props: {
  name: ComicIconName
  desc: string
  tint?: string
  onClick: () => void
  /** Android L363-L366: `detectTapGestures(onLongPress = …, onTap = …)` */
  onLongPress?: () => void
}) {
  const tint = props.tint ?? TextPrimary
  const timerRef = useRef<number | null>(null)
  const longPressedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  return (
    <button
      type="button"
      className="comic-icon-button comic-no-ripple"
      aria-label={props.desc}
      style={{ color: tint }}
      onPointerDown={() => {
        if (props.onLongPress === undefined) return
        longPressedRef.current = false
        // ── Android L364: `onLongPress = { if (favorites.isNotEmpty()) favMenuOpen = true }` ──
        timerRef.current = window.setTimeout(() => {
          longPressedRef.current = true
          props.onLongPress?.()
        }, 500)
      }}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onClick={() => {
        // ── Android L365: `onTap = { onOpenPanel(ComicPanel.SETTINGS) }`（长按已触发则吞掉短按）
        if (longPressedRef.current) {
          longPressedRef.current = false
          return
        }
        props.onClick()
      }}
    >
      <ComicIcon name={props.name} desc={props.desc} tint={tint} />
    </button>
  )
}

/* ══════════════ SegmentRow / SliderRow / SwitchRow（Android L614-L710） ══════════════ */

/**
 * 分段选择器（id 由调用方定义）。
 *  FlowRow 流式布局：每项按文字实际宽度占位，一行放不下自动换行——
 *  修复"7 个手势选项/5 个长 label 挤同一行全部截断"的实机 bug（weight 均分压缩所致）。
 *  第七轮第 3 条：选中态 = 品牌薄荷半透明填充 + 细边框 + SemiBold 文字
 *  （不再只靠文字变色），与 Tab/场景/色卡同一套选中语言。
 * ── Android L619-L666 ──
 */
export function SegmentRow(props: {
  title: string
  options: readonly (readonly [number, string])[]
  selected: number
  onSelect: (id: number) => void
}) {
  const mint = resolveComicMintPrimary()
  return (
    <div className="comic-segment-row">
      {/* ── Android L628 ── */}
      <span className="comic-segment-row__title">{props.title}</span>
      {/* ── Android L629: Spacer(Modifier.height(6.dp)) ── */}
      <span className="comic-segment-row__gap6" />
      {/* ── Android L630-L637: FlowRow(spacedBy(3.dp, 3.dp)) ── */}
      <div
        className="comic-segment-row__flow"
        style={
          {
            '--comic-segment-active-bg': comicPanelWithAlpha(mint, 0.18),
            '--comic-segment-active-stroke': comicPanelWithAlpha(mint, 0.55),
          } as CSSProperties
        }
      >
        {props.options.map(([id, label]) => (
          <SegmentOption key={id} label={label} active={id === props.selected} onSelect={props.onSelect} id={id} />
        ))}
      </div>
    </div>
  )
}

/** ── Android L639-L663: SegmentRow 的单项（抽成子组件，map 回调内无 hook） ── */
function SegmentOption(props: { id: number; label: string; active: boolean; onSelect: (id: number) => void }) {
  return (
    <button
      type="button"
      className={props.active ? 'comic-segment-row__option comic-segment-row__option--active' : 'comic-segment-row__option'}
      aria-pressed={props.active}
      // ── Android L650: `.clickableNoRipple { onSelect(id) }` ──
      onClick={() => {
        props.onSelect(props.id)
      }}
    >
      {props.label}
    </button>
  )
}

/**
 * 滑条设置行（trailing lambda = onChange，实时预览；持久化由上层防抖）。
 *  第七轮第 3 条：M3 Slider → 面板统一自绘滑条（细玻璃轨道 + 薄荷填充 +
 *  白色圆钮），全面板唯一滑条样式。
 * ── Android L671-L695 ──
 */
export function SliderRow(props: {
  title: string
  value: number
  range: FloatRange
  steps?: number
  format: (value: number) => string
  onFinished?: () => void
  onChange: (value: number) => void
}) {
  return (
    <div className="comic-slider-row">
      {/* ── Android L682-L686 ── */}
      <div className="comic-slider-row__head">
        <span className="comic-slider-row__title">{props.title}</span>
        <span className="comic-bottom-bar__spacer" />
        <span className="comic-slider-row__value">{props.format(props.value)}</span>
      </div>
      {/* ── Android L687-L693 ── */}
      <PanelSlider
        value={props.value}
        onValueChange={props.onChange}
        valueRange={props.range}
        steps={props.steps ?? 0}
        {...(props.onFinished === undefined ? {} : { onValueChangeFinished: props.onFinished })}
      />
    </div>
  )
}

/** 开关行。第七轮第 3 条：M3 Switch → 面板统一玻璃胶囊开关。 ── Android L698-L710 ── */
export function SwitchRow(props: {
  title: string
  subtitle?: string | null
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="comic-switch-row">
      {/* ── Android L704-L707 ── */}
      <div className="comic-switch-row__text">
        <span className="comic-switch-row__title">{props.title}</span>
        {props.subtitle != null ? <span className="comic-switch-row__subtitle">{props.subtitle}</span> : null}
      </div>
      {/* ── Android L708 ── */}
      <PanelSwitch checked={props.checked} onChange={props.onChange} />
    </div>
  )
}

/* ══════════════ ComicSheetContainer / SectionLabel（Android L712-L768） ══════════════ */

/** 通用底部面板容器（贴底、圆角、毛玻璃；横屏限宽居中避免占满全屏） ── Android L713-L759 ── */
export function ComicSheetContainer(props: {
  title: string
  onDismiss: () => void
  heightFraction?: number
  scrollable?: boolean
  glassBackdrop?: unknown | null
  children: ReactNode
}) {
  // ── Android L717-L719: 默认 heightFraction = 0.66f / scrollable = true ──
  const heightFraction = props.heightFraction ?? 0.66
  const scrollable = props.scrollable ?? true
  // ── Android L107-L116: comicPanelGlass（blur 26dp + saturate 1.18；backdrop null → 回退 PanelBg）
  const glass = comicPanelGlassCss(props.glassBackdrop ?? null)

  return (
    <div
      className={props.glassBackdrop == null ? 'comic-sheet comic-sheet--no-glass' : 'comic-sheet'}
      style={{ height: `${heightFraction * 100}%`, background: glass.background, backdropFilter: glass.backdropFilter }}
      role="dialog"
      aria-label={props.title}
    >
      {/* ── Android L734-L742: 顶部拖拽把手 ── */}
      <div className="comic-sheet__handle-row">
        <div className="comic-sheet__handle" />
      </div>
      {/* ── Android L743-L747 ── */}
      <div className="comic-sheet__title">{props.title}</div>
      {/* ── Android L748-L757: `.fillMaxWidth().weight(1f).navigationBarsPadding()
           .then(if (scrollable) verticalScroll(rememberScrollState()) else Modifier)
           .padding(horizontal = 20.dp)` ── */}
      <div className={scrollable ? 'comic-sheet__body' : 'comic-sheet__body comic-sheet__body--static'}>
        {props.children}
      </div>
    </div>
  )
}

/** 面板小节标题（次级色：强调色收敛到激活态控件与滑条数值） ── Android L762-L768 ── */
export function SectionLabel(props: { text: string }) {
  return <div className="comic-section-label">{props.text}</div>
}

/** 导出 spread 定位助手，便于 chrome 侧与 core 共用同一处 clamp 语义。 */
export { spreadOfRawPage }

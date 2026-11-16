/**
 * 漫画主页面（漫画章节列表）纯逻辑层 — 逐行移植 Android
 * `com/example/ui/ComicChaptersScreen.kt`（共 1568 行）。
 *
 * 本文件只放**无 React / 无 DOM / 无 Capacitor** 的纯函数与两个「外部数据源」
 * 容器（Room DAO Flow → async getter + listener registry，见
 * `library/favoriteRepository.ts` 与 `download/downloadProgressBroadcaster.ts` 的既有写法）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Kotlin 行 → TS 位置对照
 * ─────────────────────────────────────────────────────────────────────────
 * | Kotlin 行 | 内容 | TS 位置 |
 * |---|---|---|
 * | 1–91 | package + import | 见下方 import（1:1 保留标识符） |
 * | 93–97 | GodGold / GodGoldStroke / GodScrimBase | `GodGold` `GodGoldStroke` `GodScrimBase` |
 * | 99–100 | `LIST_HEADER_ITEMS = 3` | `LIST_HEADER_ITEMS` |
 * | 102–109 | 页面 KDoc | 本文件头注释 |
 * | 110–162 | `fun ComicChaptersScreen(参数表)` | `ComicChaptersSnapshot` / `ComicChaptersStore`（参数 → 快照字段 + ports 回调，见 `ComicChaptersPorts`） |
 * | 163–170 | ordered / stateOnly / target / newIds | `stateOnlyOf` + `ComicChaptersStore`（ordered/target/newIds 由 `comicReadingLogic` 既有函数提供） |
 * | 172–175 | `sortDesc` + `displayChapters` | `displayChaptersOf` |
 * | 177–181 | listState / highlightId / selectionMode / selectedChapterIds | `TransientHighlightStore.highlightStore`（外部 store）+ 页面 useState |
 * | 183–184 | `rememberGodEditBinding()` / `rememberReduceMotion()` | 跳到既有 `@core/god`（`godMoments.setGodEditTarget` + 页面 `prefers-reduced-motion`），见下表「跳过」 |
 * | 186–191 | godList / godChapterIds / normalChapters | `godListOf` `godChapterIdsOf` `normalChaptersOf` |
 * | 193–200 | `rowIndexOf` | `rowIndexOf` / `listItemIndexOf` |
 * | 202–214 | godFocus 定位 + 金色高亮 | `ComicHighlightStore.pulse(id, 1600)`（见下） |
 * | 216–233 | 进入页面自动定位续读 | `focusIndexOf` + 页面 useEffect（高亮 1000ms） |
 * | 235–238 | `onMarkSeen()` | `ComicChaptersStore.markSeen()` |
 * | 240–241 | `readCount` | `readCountOf` |
 * | 243–253 | `continueTargetChapter()` | `continueTargetChapterOf` / `continueButtonLabelOf` |
 * | 255–258 | `exitSelection()` | 页面 `exitSelection()`（纯 setState，无需 core） |
 * | 260–264 | `BackHandler(多选时先退出多选)` | 页面 Escape 键拦截（Web 无 BackHandler，见下表） |
 * | 266–335 | Scaffold + topBar（多选顶栏 / 返回+标题） | 页面 `ComicTopBar`（`heroTitleOf`） |
 * | 336–448 | bottomBar（下载 N 话 / ♥ + 继续阅读） | `downloadButtonLabelOf` / `continueButtonLabelOf` + 页面 `ComicBottomBar` |
 * | 449–472 | loading / error 态 | 页面（`ChasingDots` / `重试` / `换源`） |
 * | 474–483 | `SourceUnavailableBanner` | 页面内联 `SourceUnavailableBanner`（源自 `favorite/ComicDetailActions.kt` L92–115） |
 * | 485–491 | LazyColumn(contentPadding 16/8, spacedBy 8) | `.cc-scroll`（`styles/comicChapters.css`） |
 * | 493 | hero item | `ComicHeroHeader` 组件（纯数据见 `hero*Of`） |
 * | 496–513 | 信息行 | `infoRowLabelOf` |
 * | 515–597 | 工具行（正序 / 跳到最新章 / 整本下载 / 多选） | 页面 `ComicToolbar`（下标算式见 `latestChapterListItemIndex`） |
 * | 599–628 | 多选快捷胶囊 | `quickSelectUnread` / `quickSelectLastTen` / `quickInvert` |
 * | 632–675 | 神回卡 item | `godChapterTitleOf` + 页面 `GodCard` |
 * | 676–742 | 普通章节 item | `chapterProgressOf` + `chapterCardSpecOf` + 页面 `ChapterCard` |
 * | 748–759 | 下载进度悬浮窗 | `downloadOverlayTitleOf` / `downloadOverlayPercentOf` + 页面 `DownloadProgressOverlay` + `ComicDownloadStore` |
 * | 761–769 | `GodMomentEditHost(binding, onSaved)` | 跳到既有 `GodEditorPage`（`setGodEditTarget` + `setRoute('godEditor')`），见下表 |
 * | 774–789 | `QuickPill` | 页面 `QuickPill` |
 * | 791–1055 | `ChapterCardSpec` | `chapterCardSpecOf` + 页面 `ChapterCard` |
 * | 1057–1242 | `GodCardSpec` | `godCaptionOf` / `godRatingTextOf` + 页面 `GodCard` |
 * | 1244–1274 | `CheckCircleSpec` | 页面 `CheckCircleSpec` |
 * | 1276–1460 | `ComicHeroHeader` | `hero*Of` + 页面 `ComicHeroHeader` |
 * | 1276 附 | `ComicMetadataBlock`（`ComicMetadataUi.kt` L24–83） | `comicMetadataModelOf` + 页面 `ComicMetadataBlock`（内联依赖） |
 * | 1462–1541 | `DownloadProgressOverlay` | 页面 `DownloadProgressOverlay` + `ComicDownloadStore` |
 * | 1543–1568 | `Modifier.longPressDetector(500ms)` | 页面 `useLongPressDetector` 语义（同一套 500ms / touchSlop 判定） |
 *
 * ── 跳过（逐条说明）────────────────────────────────────────────────────
 * - 5, 8, 9, 11, 12, 14–19, 22–23, 27, 31–33, 37, 38, 40, 42–43, 45–46,
 *   48, 52–56, 57, 59, 60, 61, 63, 65, 66, 67, 86–87, 89–90, 91：
 *   import 语句 —— 改为 TS import（1:1 保留被引用标识符；Android/Compose 专有类型
 *   如 Modifier / DrawScope / SemanticsPropertyReceiver 无对应物）。
 * - 39 `asComposeRenderEffect`、43 `PointerEventPass`、51 `coil.compose.AsyncImage`、
 *   66 `coil.request.ImageRequest`、85 `consistentShadow`、52–56 动画 API：
 *   平台 API —— 由 `<img>` + CSS（filter / box-shadow / transition / keyframes）承担，
 *   数值（blur 30、crossfade 220、tween 320/240/520、spring MediumLow）全部保留。
 * - 60 `zIndex`、`845` 同上：CSS `z-index`。
 * - 89 `LocalView` + 892/894/1106/1108 `performHapticFeedback`：
 *   HapticsGate 触觉反馈 —— Web 无等价 API（与 `GodRankingShared.tsx` 同样跳过），
 *   长按/滑动判定本身完整保留。
 * - 183 `rememberGodEditBinding()` + 761–769 `GodMomentEditHost`：本页自持的神回编辑窗
 *   （Android `GodMomentSheet.kt` 56KB）—— 复用本项目既有 `GodEditorPage`
 *   （长按神回卡 → `setGodEditTarget(id)` + `setRoute('godEditor')`），
 *   行为等价（编辑同一实体），不重复实现弹窗。
 * - 184 `rememberReduceMotion()`：Android 读 `ANIMATOR_DURATION_SCALE`；Web 用
 *   `prefers-reduced-motion`（页面 `usePrefersReducedMotion`，与 `GodRankingPage` 同款）。
 * - 262–264 `BackHandler`：Compose 路由级返回拦截；Web 路由由 store 驱动，
 *   以 Escape 键等价实现（见页面 `useEscapeExitSelection`）。
 * - 110 `Canvas`、1051 `graphicsLayer`：无自绘需求（本文件所有视觉均由 CSS/内联 SVG 承担）。
 *
 * ── 主题 ─────────────────────────────────────────────────────────────
 * 本页是**浅色**页：`Scaffold(containerColor = MaterialTheme.colorScheme.background)`，
 * `Theme.kt` L58–66 的 `lightColorScheme(background = LightBg #FFFFFF,
 * surface = PureWhite #FFFFFF, onBackground/onSurface = DarkCharcoal #18191C)`。
 * 调色板常量见页面 `LIGHT_SCHEME`（`onSurfaceVariant #49454F`、`error #B3261E`、
 * `surfaceVariant #E7E0EC`、`surfaceContainerHigh #ECE6F0` 取 Material3 浅色默认色板）。
 */

import type { ComicChapter, SearchBook } from '../library/comicSourceTypes'
import { isKnownComicAuthor } from '../library/comicSourceTypes'
import {
  ChapterReadState,
  chapterReadStateOf,
  type ChapterReadEntity,
  type ChapterReadStateCode,
  type ComicProgressEntity,
  type FavoriteEntity,
} from '../library/favoriteTypes'
import {
  chapterNumber,
  newChapterIds,
  ordered,
  resolveContinue,
  type ContinueTarget,
  type OrderedChapter,
} from '../library/comicReadingLogic'
import type { GodMoment } from '../god/godTypes'

/* ══════════════════════════════════════════════════════════════
 * 常量（Kotlin 93–100 / 159 / 1129–1147 / 901–930）
 * ══════════════════════════════════════════════════════════════ */

/** 神回金色（仅神回卡片使用）。 */
export const GodGold = '#E8C56A'
/** 神回描边 = Color(0xFFE8C56A).copy(alpha = 0.55f) */
export const GodGoldStroke = 'rgba(232, 197, 106, 0.55)'
/** 神回暗层基色 rgba(14,18,30,…) */
export const GodScrimBase = '#0E121E'
/** 神回卡片无封面时的横向渐变（L1129–1133）。 */
export const GodFallbackGradient = ['#242833', '#3A3140']
/** 神回卡片暗层横向渐变三停靠（L1136–1150）。 */
export const GodScrimGradient = [
  'rgba(14, 18, 30, 0.9)',
  'rgba(14, 18, 30, 0.6)',
  'rgba(14, 18, 30, 0.2)',
]
/** 排行榜跳转脉冲峰值（L1085）。 */
export const GOD_PULSE_ALPHA = 0.28

/** 列表头部的固定 item 数：hero + 信息行 + 工具行（滚动下标补偿用）。 */
export const LIST_HEADER_ITEMS = 3

/** 「下载 N 话 约 X MB」的每话体积估算（MB）—— Composable 默认参数。 */
export const DEFAULT_ESTIMATED_CHAPTER_SIZE_MB = 2.0

/** 滑动书签手势参数（L911–934）。 */
export const BOOKMARK_DRAG_LIMIT = 140
export const BOOKMARK_COMMIT_THRESHOLD = 40
export const BOOKMARK_RIBBON_WIDTH = 22
export const BOOKMARK_RIBBON_HEIGHT = 36

/** 500ms 长按检测（L1547 `withTimeoutOrNull(500L)`）。 */
export const LONG_PRESS_TIMEOUT_MS = 500
/** Android `viewConfiguration.touchSlop` ≈ 8dp。 */
export const TOUCH_SLOP = 8

/** 简介超过这个长度才出现「展开 / 收起」（L1450）。 */
export const DESCRIPTION_TOGGLE_MIN_LENGTH = 60
/** 别名 / 标签折叠前的预览条数（`ComicMetadataUi.kt` L53、L62）。 */
export const METADATA_ALIAS_PREVIEW = 3
export const METADATA_TAG_PREVIEW = 6

/** 「选后 10 话」（L618 `ordered.takeLast(10)`）。 */
export const QUICK_SELECT_LAST = 10

/* ══════════════════════════════════════════════════════════════
 * 章节视觉三态（favorite/ChapterStatusRow.kt L66–73）
 * ══════════════════════════════════════════════════════════════ */

export const ChapterVisual = {
  UNREAD: 'UNREAD',
  READING: 'READING',
  READ: 'READ',
} as const

export type ChapterVisualCode = (typeof ChapterVisual)[keyof typeof ChapterVisual]

/** `ChapterReadState.toVisual()` —— 纯函数，UNKNOWN 一律 UNREAD。 */
export function toVisualOf(state: ChapterReadStateCode | undefined): ChapterVisualCode {
  if (state === ChapterReadState.READ) return ChapterVisual.READ
  if (state === ChapterReadState.READING) return ChapterVisual.READING
  return ChapterVisual.UNREAD
}

/* ══════════════════════════════════════════════════════════════
 * 列表行模型（Kotlin 163–200）
 * ══════════════════════════════════════════════════════════════ */

/** 纯逻辑层只认状态枚举，这里把实体降维成 state（L166）。 */
export function stateOnlyOf(
  chapterStates: ReadonlyMap<string, ChapterReadEntity>,
): Map<string, ChapterReadStateCode> {
  const out = new Map<string, ChapterReadStateCode>()
  for (const [chapterId, entity] of chapterStates) {
    out.set(chapterId, chapterReadStateOf(entity.status))
  }
  return out
}

/** `if (sortDesc) ordered.asReversed() else ordered`（L173–175）。 */
export function displayChaptersOf(
  list: readonly OrderedChapter[],
  sortDesc: boolean,
): OrderedChapter[] {
  return sortDesc ? [...list].reverse() : [...list]
}

/** 神回卡按收藏顺序：`godMoments.values.sortedBy { it.createdAt }`（L187）。 */
export function godListOf(godMoments: ReadonlyMap<string, GodMoment>): GodMoment[] {
  return [...godMoments.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export function godChapterIdsOf(godList: readonly GodMoment[]): Set<string> {
  return new Set(godList.map((god) => god.chapterId))
}

/** 普通章节跟随（神回话不重复出卡，L189–191）。 */
export function normalChaptersOf(
  displayChapters: readonly OrderedChapter[],
  godChapterIds: ReadonlySet<string>,
): OrderedChapter[] {
  return displayChapters.filter((entry) => !godChapterIds.has(entry.chapter.id))
}

/** 章节 id → 列表行下标（神回卡在前）；找不到 -1（L194–200）。 */
export function rowIndexOf(
  chapterId: string,
  godList: readonly GodMoment[],
  normalChapters: readonly OrderedChapter[],
): number {
  const godIdx = godList.findIndex((god) => god.chapterId === chapterId)
  if (godIdx >= 0) return godIdx
  const normalIdx = normalChapters.findIndex((entry) => entry.chapter.id === chapterId)
  if (normalIdx >= 0) return godList.length + normalIdx
  return -1
}

/**
 * `rowIndexOf(id) + LIST_HEADER_ITEMS`（L206 / L226 / L553）。
 * 找不到行时返回 -1：Kotlin 写成 `idx = rowIndexOf(id) + 3; if (idx >= 0)`，
 * 该条件恒真（-1 + 3 = 2），这里按「行必须真的存在」的语义收紧，
 * 否则章节尚未加载完就会滚到第 3 行并把高亮信标清掉。
 */
export function listItemIndexOf(
  chapterId: string,
  godList: readonly GodMoment[],
  normalChapters: readonly OrderedChapter[],
): number {
  const row = rowIndexOf(chapterId, godList, normalChapters)
  return row < 0 ? -1 : row + LIST_HEADER_ITEMS
}

/** 「跳到最新章」的下标算式（L551–553）。 */
export function latestChapterListItemIndex(
  sortDesc: boolean,
  godList: readonly GodMoment[],
  normalChapters: readonly OrderedChapter[],
): number {
  const idx = sortDesc ? 0 : Math.max(0, normalChapters.length - 1)
  return godList.length + idx + LIST_HEADER_ITEMS
}

/** 已读话数（L241）。 */
export function readCountOf(
  list: readonly OrderedChapter[],
  stateOnly: ReadonlyMap<string, ChapterReadStateCode>,
): number {
  return list.filter((entry) => stateOnly.get(entry.chapter.id) === ChapterReadState.READ).length
}

/** 进入页面时的自动定位下标（L219–224）。 */
export function focusIndexOf(
  target: ContinueTarget,
  list: readonly OrderedChapter[],
  stateOnly: ReadonlyMap<string, ChapterReadStateCode>,
): number {
  if (target.kind === 'resume' || target.kind === 'next') return target.chapterIndex
  const idx = list.findIndex(
    (entry) => stateOnly.get(entry.chapter.id) === ChapterReadState.READING,
  )
  return idx >= 0 ? idx : 0
}

/* ══════════════════════════════════════════════════════════════
 * 多选（Kotlin 255–258 / 294–297 / 607–626 / 708–712 / 644–648）
 * ══════════════════════════════════════════════════════════════ */

export function toggleSelected(
  selected: ReadonlySet<string>,
  chapterId: string,
): Set<string> {
  const next = new Set(selected)
  if (!next.delete(chapterId)) next.add(chapterId)
  return next
}

/** 「全选」：`selectedChapterIds.addAll(ordered.map { it.chapter.id })`（L296）。 */
export function allChapterIdsOf(list: readonly OrderedChapter[]): string[] {
  return list.map((entry) => entry.chapter.id)
}

/** 「选未读」：state != READ（L610–612）。 */
export function quickSelectUnread(
  list: readonly OrderedChapter[],
  stateOnly: ReadonlyMap<string, ChapterReadStateCode>,
): string[] {
  return list
    .filter((entry) => stateOnly.get(entry.chapter.id) !== ChapterReadState.READ)
    .map((entry) => entry.chapter.id)
}

/** 「选后 10 话」：`ordered.takeLast(10)`（L618）。 */
export function quickSelectLastTen(list: readonly OrderedChapter[]): string[] {
  return list.slice(Math.max(0, list.length - QUICK_SELECT_LAST)).map((entry) => entry.chapter.id)
}

/** 「反选」：保留 `ordered` 顺序（L622–625）。 */
export function quickInvert(
  list: readonly OrderedChapter[],
  selected: ReadonlySet<string>,
): string[] {
  return list.map((entry) => entry.chapter.id).filter((id) => !selected.has(id))
}

/** 多选底栏的下载目标：`chapters.filter { it.id in selectedChapterIds }`（L346）。 */
export function chaptersInSelection(
  chapters: readonly ComicChapter[],
  selected: ReadonlySet<string>,
): ComicChapter[] {
  return chapters.filter((chapter) => selected.has(chapter.id))
}

/* ══════════════════════════════════════════════════════════════
 * 文案（Kotlin 358–380 / 420–443 / 496–513 / 955–959 / 1500 / 1518）
 * ══════════════════════════════════════════════════════════════ */

/** `String.format(Locale.US, "%.1f", v)`（L371 / L1218）。 */
export function formatDecimal1(value: number): string {
  return value.toFixed(1)
}

/** 两段式按钮文案：主段 + 半透明白字副段（SpanStyle White 0.85）。 */
export interface TwoToneLabel {
  strong: string
  soft: string
}

export function downloadButtonLabelOf(
  count: number,
  estimatedChapterSizeMb: number = DEFAULT_ESTIMATED_CHAPTER_SIZE_MB,
): TwoToneLabel {
  if (count === 0) return { strong: '选择要下载的章节', soft: '' }
  const mb = count * estimatedChapterSizeMb
  return { strong: `下载 ${count} 话`, soft: `  约 ${formatDecimal1(mb)} MB` }
}

/** 继续阅读落点（底部按钮文案与行为同源，L244–253）。 */
export interface ContinueLanding {
  chapter: ComicChapter
  page: number
}

export function continueTargetChapterOf(
  target: ContinueTarget,
  list: readonly OrderedChapter[],
): ContinueLanding | null {
  const first = list[0]?.chapter ?? null
  switch (target.kind) {
    case 'start':
      return first == null ? null : { chapter: first, page: 0 }
    case 'resume': {
      const chapter = list[target.chapterIndex]?.chapter ?? null
      return chapter == null ? null : { chapter: chapter, page: target.pageIndex }
    }
    case 'next': {
      const chapter = list[target.chapterIndex]?.chapter ?? null
      return chapter == null ? null : { chapter: chapter, page: 0 }
    }
    case 'upToDate':
      return first == null ? null : { chapter: first, page: 0 }
    default:
      return null
  }
}

/** 「继续阅读 第 $num 话 · P${page + 1}」（L420–437）。 */
export function continueButtonLabelOf(
  target: ContinueTarget,
  list: readonly OrderedChapter[],
): TwoToneLabel {
  const cont = continueTargetChapterOf(target, list)
  if (cont == null) return { strong: '继续阅读 ', soft: '第 1 话' }
  const num = chapterNumber(cont.chapter.title) ?? (list.findIndex(
    (entry) => entry.chapter.id === cont.chapter.id,
  ) + 1)
  return { strong: '继续阅读 ', soft: `第 ${num} 话 · P${cont.page + 1}` }
}

/** 信息行：源名 · 当前源共 N 话 · + 已读 N 话（L498–506）。 */
export interface AccentLabel {
  base: string
  accent: string
}

export function infoRowLabelOf(
  sourceName: string | null,
  book: SearchBook | null,
  chapterCount: number,
  readCount: number,
): AccentLabel {
  const source = sourceName ?? book?.sourceId ?? ''
  return {
    base: `${source} · 当前源共 ${chapterCount} 话 · `,
    accent: `已读 ${readCount} 话`,
  }
}

/** 章节卡说明行（L955–959）。 */
export function chapterCaptionOf(
  number: number,
  visual: ChapterVisualCode,
  pageCount: number,
  lastPage: number,
  isNew: boolean,
): string {
  if (visual === ChapterVisual.READING && pageCount > 0) {
    return `第 ${number} 话 · 读到 ${lastPage + 1} / ${pageCount} 页`
  }
  if (visual === ChapterVisual.READ) return `第 ${number} 话 · 已读`
  return `第 ${number} 话` + (isNew ? ' · 新' : '')
}

/** 章节卡无障碍描述（L871–883）。 */
export function chapterSemanticsLabelOf(
  title: string,
  visual: ChapterVisualCode,
  downloaded: boolean,
  bookmarked: boolean,
): string {
  const visualLabel =
    visual === ChapterVisual.READ
      ? '已读'
      : visual === ChapterVisual.READING
        ? '阅读中'
        : '未读'
  let label = `${title}，${visualLabel}`
  if (downloaded) label += '，已下载'
  if (bookmarked) label += '，已加书签'
  return label
}

/** 下载悬浮窗标题（L1500）。 */
export function downloadOverlayTitleOf(paused: boolean, title: string): string {
  return paused ? `已暂停：${title}` : `正在下载：${title}`
}

/** 下载悬浮窗百分比（L1518）。 */
export function downloadOverlayPercentOf(progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress))
  return `${Math.trunc(clamped * 100)}%`
}

/* ══════════════════════════════════════════════════════════════
 * 普通章节卡（Kotlin 676–742 组参 + 795–1055 渲染判定）
 * ══════════════════════════════════════════════════════════════ */

/** 章节的页码展示：章节实体优先，回落到漫画级进度（L680–683）。 */
export interface ChapterProgressView {
  pageIndex: number
  pageCount: number
}

export function chapterProgressOf(
  state: ChapterReadEntity | undefined,
  chapterId: string,
  progress: ComicProgressEntity | null,
): ChapterProgressView {
  const isLast = progress != null && progress.lastChapterId === chapterId
  const ownPageCount = state != null && state.pageCount > 0 ? state.pageCount : null
  return {
    pageIndex: state?.pageIndex ?? (isLast && progress != null ? progress.lastPageIndex : 0),
    pageCount: ownPageCount ?? (isLast && progress != null ? progress.lastPageCount : 0),
  }
}

/**
 * 章节卡的显示话数（Kotlin L685–686）：
 * ```kotlin
 * number = ComicReadingLogic.chapterNumber(chapter.title) ?: (entry.order + 1)
 * ```
 * 标题里能解析出话号就用话号（源站的「第 12 话」「#12」等命名千差万别）；
 * 解析不出才回落到阅读顺序下标 + 1。
 */
export function chapterNumberOf(
  chapter: ComicChapter,
  entry: OrderedChapter,
): number {
  return chapterNumber(chapter.title) ?? entry.order + 1
}

export type ChapterRightKind =
  | 'check'
  | 'downloading'
  | 'downloaded'
  | 'hidden'
  | 'downloadable'

export interface ChapterCardSpecInput {
  number: number
  title: string
  visual: ChapterVisualCode
  lastPage: number
  pageCount: number
  isNew: boolean
  downloaded: boolean
  downloading: boolean
  downloadProgress: number
  external: boolean
  selecting: boolean
  checked: boolean
  textMode: boolean
  bookmarked: boolean
}

export interface ChapterCardSpec {
  number: number
  title: string
  caption: string
  visual: ChapterVisualCode
  isCurrent: boolean
  isRead: boolean
  selecting: boolean
  emphasized: boolean
  isSelected: boolean
  lastPage: number
  pageCount: number
  /** 当前阅读底边进度线（L1038）。 */
  progressFraction: number
  downloadProgress: number
  semanticsLabel: string
  rightKind: ChapterRightKind
  rightLabel: string | null
  /** 用户书签 / 滑动预览（L1020）。 */
  showRibbon: boolean
}

export function chapterCardSpecOf(input: ChapterCardSpecInput): ChapterCardSpec {
  const isCurrent = input.visual === ChapterVisual.READING
  const isRead = input.visual === ChapterVisual.READ
  const emphasized = isCurrent && !input.selecting
  const isSelected = input.selecting && input.checked
  const rightKind: ChapterRightKind = input.selecting
    ? 'check'
    : input.downloading
      ? 'downloading'
      : input.downloaded
        ? 'downloaded'
        : input.external || input.textMode
          ? 'hidden'
          : 'downloadable'
  const rightLabel =
    rightKind === 'downloaded' ? '已下载' : rightKind === 'downloadable' ? '下载' : null
  return {
    number: input.number,
    title: input.title,
    caption: chapterCaptionOf(
      input.number,
      input.visual,
      input.pageCount,
      input.lastPage,
      input.isNew,
    ),
    visual: input.visual,
    isCurrent,
    isRead,
    selecting: input.selecting,
    emphasized,
    isSelected,
    lastPage: input.lastPage,
    pageCount: input.pageCount,
    progressFraction:
      isCurrent && input.pageCount > 0
        ? Math.min(1, Math.max(0, (input.lastPage + 1) / input.pageCount))
        : 0,
    downloadProgress: Math.min(1, Math.max(0, input.downloadProgress)),
    semanticsLabel: chapterSemanticsLabelOf(
      input.title,
      input.visual,
      input.downloaded,
      input.bookmarked,
    ),
    rightKind,
    rightLabel,
    showRibbon: input.bookmarked,
  }
}

/* ══════════════════════════════════════════════════════════════
 * 神回卡（Kotlin 632–675 组参 + 1061–1242 渲染判定）
 * ══════════════════════════════════════════════════════════════ */

/** `chapter?.title ?: g.chapterTitle.ifBlank { "第 ${g.chapterNumber} 话" }`（L635–637）。 */
export function godChapterTitleOf(god: GodMoment, chapter: ComicChapter | null): string {
  if (chapter != null) return chapter.title
  return god.chapterTitle.trim() === '' ? `第 ${god.chapterNumber} 话` : god.chapterTitle
}

/** 说明行：`if (name.isNullOrBlank()) "神回" else "神回 · $name"`（L1170–1172）。 */
export function godCaptionOf(god: GodMoment): string {
  const name = god.titleIsCustom && god.title.trim() !== '' ? god.title : null
  return name == null || name.trim() === '' ? '神回' : `神回 · ${name}`
}

/** `String.format(Locale.US, "%.1f", god.rating)`（L1218）。 */
export function godRatingTextOf(god: GodMoment): string {
  return formatDecimal1(god.rating)
}

/** `ImageRequest.memoryCacheKey("god_cover_${coverPath}_${updatedAt}")`（L1118）。 */
export function godCoverCacheKeyOf(god: GodMoment, coverPath: string): string {
  return `god_cover_${coverPath}_${god.updatedAt}`
}

/* ══════════════════════════════════════════════════════════════
 * 页面头部（Kotlin 1276–1460 + ComicMetadataUi.kt 24–86）
 * ══════════════════════════════════════════════════════════════ */

/** 顶栏标题：`book?.title ?: "漫画章节"`（L325）。 */
export function heroTitleOf(book: SearchBook | null): string {
  return book?.title ?? '漫画章节'
}

/** 圆形徽章：`if (textMode) "小说" else "漫画"`（L1402）。 */
export function heroBadgeOf(textMode: boolean): string {
  return textMode ? '小说' : '漫画'
}

/** 作者行（L1409–1423）。 */
export function heroAuthorLineOf(book: SearchBook): string {
  return isKnownComicAuthor(book.author) ? `作者：${book.author}` : '源站未提供作者'
}

/** 编号行（L1424–1432）。 */
export function heroComicIdLineOf(book: SearchBook): string | null {
  const comicId = (book.comicId ?? '').trim()
  return comicId === '' ? null : `编号：${comicId}`
}

/** 简介：`book.description?.takeIf { it.isNotBlank() }`（L1440）。 */
export function heroDescriptionOf(book: SearchBook): string | null {
  const desc = book.description
  return desc != null && desc.trim() !== '' ? desc : null
}

export function descriptionNeedsToggle(desc: string): boolean {
  return desc.length > DESCRIPTION_TOGGLE_MIN_LENGTH
}

export interface MetadataRow {
  label: string
  value: string
}

export interface ComicMetadataModel {
  rows: MetadataRow[]
  aliases: string[]
  tags: string[]
}

/** 连载状态文案（`ComicMetadataUi.kt` L32–38）。 */
export function metadataStatusLabelOf(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'ongoing':
      return '连载中'
    case 'completed':
    case 'finished':
      return '已完结'
    case 'hiatus':
      return '休刊中'
    case 'cancelled':
    case 'canceled':
      return '已中止'
    default:
      return raw
  }
}

/**
 * `Locale.forLanguageTag(code).getDisplayLanguage(SIMPLIFIED_CHINESE) ?: code`
 * （`ComicMetadataUi.kt` L85–86）。
 *
 * ⚠️ `getDisplayLanguage` 只返回**主语言子标签**的名字，region / script 子标签被丢弃：
 * `"en-US"` → `"英语"`，`"zh-Hans"` → `"中文"`。
 * `Intl.DisplayNames.of()` 会把 region/script 一起带出来（`"英语（美国）"` / `"简体中文"`），
 * 所以这里先裁到主子标签再查表，与 Kotlin 的取名范围一致。
 * 主子标签为空（`forLanguageTag` 解析不出语言）时 `getDisplayLanguage` 返回 `""` →
 * `takeIf { isNotBlank() }` 落空 → 回落原 `code`。
 */
export function metadataLanguageNameOf(code: string): string {
  const primary = code.split('-')[0] ?? '';
  if (primary === '') return code;
  try {
    const names = new Intl.DisplayNames(['zh-Hans'], { type: 'language' });
    const label = names.of(primary) ?? '';
    return label.trim() === '' ? code : label;
  } catch {
    return code;
  }
}

/** `tag.substringAfter('：', tag).trim().ifBlank { tag }`（L63）。 */
export function metadataTagNameOf(tag: string): string {
  const separator = '：'
  const raw = tag.includes(separator) ? tag.slice(tag.indexOf(separator) + 1) : tag
  const name = raw.trim()
  return name === '' ? tag : name
}

/** 别名去重且排除书名本身（L29）。 */
export function metadataAliasesOf(book: SearchBook): string[] {
  const all = book.comicInfo?.alternateTitles ?? []
  const out: string[] = []
  for (const alias of all) {
    if (alias === book.title) continue
    if (!out.includes(alias)) out.push(alias)
  }
  return out
}

/** 资料区行 + 别名 + 标签（`ComicMetadataUi.kt` L31–43）。 */
export function comicMetadataModelOf(book: SearchBook): ComicMetadataModel {
  const info = book.comicInfo
  const rows: MetadataRow[] = []
  const status = info?.status ?? null
  if (status != null) rows.push({ label: '状态', value: metadataStatusLabelOf(status) })
  if (book.language != null) rows.push({ label: '源站标注语言', value: book.language })
  const originalLanguage = info?.originalLanguage ?? null
  if (originalLanguage != null) {
    rows.push({ label: '原作语言', value: metadataLanguageNameOf(originalLanguage) })
  }
  const artists = info?.artists ?? []
  if (artists.length > 0) rows.push({ label: '画师', value: artists.join('、') })
  const updatedAt = info?.updatedAt ?? null
  if (updatedAt != null) rows.push({ label: '源站更新信息', value: updatedAt })
  return { rows, aliases: metadataAliasesOf(book), tags: info?.tags ?? [] }
}

/** 资料区为空时整块不渲染（`ComicMetadataUi.kt` L44）。 */
export function comicMetadataIsEmpty(model: ComicMetadataModel): boolean {
  return model.rows.length === 0 && model.aliases.length === 0 && model.tags.length === 0
}

/* ══════════════════════════════════════════════════════════════
 * 高亮脉冲（L178 / 204–214 / 217–233 / 828–832 / 1077–1088）
 *
 * Android 用 `highlightId` mutableState + `delay(...)`；Web 端 setState 放在
 * effect 里会被 react-hooks/set-state-in-effect 判错，故改成外部 store：
 * useSyncExternalStore 订阅，pulse() 内部定时器到期清空。
 * ══════════════════════════════════════════════════════════════ */

export class ComicHighlightStore {
  private value: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): string | null {
    return this.value
  }

  /** `highlightId = id; delay(ms); highlightId = null`（L209–211 / L229–231）。 */
  pulse(id: string, ms: number): void {
    if (this.timer != null) clearTimeout(this.timer)
    this.value = id
    this.notify()
    this.timer = setTimeout(() => {
      this.timer = null
      this.value = null
      this.notify()
    }, ms)
  }

  clear(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.value !== null) {
      this.value = null
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const comicHighlightStore = new ComicHighlightStore()

/* ══════════════════════════════════════════════════════════════
 * 数据源端口（Room DAO Flow → async getter + listener registry）
 * ══════════════════════════════════════════════════════════════ */

/** 当前打开的漫画（Kotlin `book` + MainActivity 的 comicSourceId/comicId）。 */
export interface ComicDetailTarget {
  sourceId: string
  comicId: string
  book: SearchBook | null
}

export function comicDetailTargetKey(target: ComicDetailTarget): string {
  return `${target.sourceId}::${target.comicId}`
}

/** `bookId`（神回用 "sourceId::comicId"）→ target（MainActivity L1054–1062）。 */
export function comicDetailTargetFromKey(
  key: string,
  book: SearchBook | null,
): ComicDetailTarget | null {
  const parts = key.split('::')
  const sourceId = parts[0] ?? ''
  const comicId = parts[1] ?? ''
  if (sourceId.trim() === '' || comicId.trim() === '') return null
  return { sourceId, comicId, book }
}

/** 无来源信息的书不能被喜欢（L133 `favoriteEnabled`）。 */
export function favoriteEnabledOf(target: ComicDetailTarget | null): boolean {
  return target != null && target.sourceId.trim() !== '' && target.comicId.trim() !== ''
}

/** 漫画源端口（`comicSourceTypes.ts` 的 ComicSource 去掉 Kotlin 默认方法）。 */
export interface ComicSourcePort {
  name: string
  /** `LibraryViewModel.openComic` L278–279：`capabilities.supportOnlineText == true`。 */
  supportOnlineText: boolean
  getChapters(comicId: string): Promise<ComicChapter[]>
  getChapterImages(chapterId: string): Promise<string[]>
  getChapterImageHeaders(
    chapterId: string,
    urls: string[],
  ): Promise<Record<string, Record<string, string>>>
}

export type ComicSourceResolver = (sourceId: string) => Promise<ComicSourcePort | null>

let comicSourceResolver: ComicSourceResolver | null = null

/** 由书源注册方（LibraryPage / SourceManagementPage）接线；未接线时返回 null。 */
export function attachComicSourceResolver(resolver: ComicSourceResolver | null): void {
  comicSourceResolver = resolver
}

export function resolveComicSource(sourceId: string): Promise<ComicSourcePort | null> {
  if (comicSourceResolver == null) return Promise.resolve(null)
  return comicSourceResolver(sourceId)
}

/** 章节加载端口：`onCached` 对应「缓存秒开」（MainActivity openComic 先发缓存再发网络）。 */
export interface ComicChaptersPorts {
  loadChapters(
    target: ComicDetailTarget,
    onCached: (cached: ComicChapter[]) => void,
  ): Promise<ComicChapter[]>
  chapterStates(target: ComicDetailTarget): Promise<ChapterReadEntity[]>
  progress(target: ComicDetailTarget): Promise<ComicProgressEntity | null>
  favorite(target: ComicDetailTarget): Promise<FavoriteEntity | null>
  downloadedChapterIds(target: ComicDetailTarget): Promise<string[]>
  sourceNameOf(sourceId: string): Promise<string | null>
  /** 文本小说模式：隐藏图片下载 / 多选 UI（L129）。 */
  textModeOf(target: ComicDetailTarget): boolean
  markSeen(target: ComicDetailTarget, chapters: readonly ComicChapter[]): Promise<void>
  setChapterBookmark(
    target: ComicDetailTarget,
    chapterId: string,
    chapterIndex: number,
    bookmarked: boolean,
  ): Promise<void>
  toggleFavorite(
    target: ComicDetailTarget,
    book: SearchBook,
    next: boolean,
    chapters: readonly ComicChapter[],
  ): Promise<void>
}

export interface ComicChaptersSnapshot {
  target: ComicDetailTarget | null
  book: SearchBook | null
  chapters: ComicChapter[]
  loading: boolean
  error: string | null
  chapterStates: Map<string, ChapterReadEntity>
  progress: ComicProgressEntity | null
  favorite: boolean
  favoriteEnabled: boolean
  downloadedChapterIds: Set<string>
  sourceName: string | null
  textMode: boolean
}

export const EMPTY_COMIC_CHAPTERS_SNAPSHOT: ComicChaptersSnapshot = {
  target: null,
  book: null,
  chapters: [],
  loading: false,
  error: null,
  chapterStates: new Map(),
  progress: null,
  favorite: false,
  favoriteEnabled: false,
  downloadedChapterIds: new Set(),
  sourceName: null,
  textMode: false,
}

/** 章节加载失败文案（与 `favoriteRepository.ts` L551 同源）。 */
export const CHAPTER_LOAD_ERROR = '章节加载失败'
/** 书源缺失（`LibraryViewModel.loadChapters` L502）。 */
export const COMIC_SOURCE_UNAVAILABLE_ERROR = '该漫画的书源已停用或不支持漫画'
/** 源返回空目录（`LibraryViewModel.loadChapters` L516）。 */
export const COMIC_NO_CHAPTERS_ERROR = '暂无可用章节'

export class ComicChaptersStore {
  private snapshot: ComicChaptersSnapshot = EMPTY_COMIC_CHAPTERS_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private ports: ComicChaptersPorts | null = null
  private token = 0

  attachPorts(ports: ComicChaptersPorts | null): void {
    this.ports = ports
  }

  getPorts(): ComicChaptersPorts | null {
    return this.ports
  }

  getSnapshot(): ComicChaptersSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** `openComic(book)`：缓存秒开 → 网络刷新（Kotlin 的 loading/error 三态来源）。 */
  async open(target: ComicDetailTarget | null): Promise<void> {
    this.token += 1
    const token = this.token
    const ports = this.ports
    if (target == null || ports == null) {
      this.publish({ ...EMPTY_COMIC_CHAPTERS_SNAPSHOT, target })
      return
    }
    this.publish({
      ...this.snapshot,
      target,
      book: target.book,
      favoriteEnabled: favoriteEnabledOf(target),
      loading: true,
      error: null,
    })
    const onCached = (cached: ComicChapter[]): void => {
      if (this.token !== token) return
      this.publish({ ...this.getSnapshot(), chapters: cached })
    }
    try {
      const [chapters, states, progress, favorite, downloaded, sourceName] = await Promise.all([
        ports.loadChapters(target, onCached),
        ports.chapterStates(target),
        ports.progress(target),
        ports.favorite(target),
        ports.downloadedChapterIds(target),
        ports.sourceNameOf(target.sourceId),
      ])
      if (this.token !== token) return
      this.publish({
        target,
        book: target.book,
        chapters,
        loading: false,
        error: null,
        chapterStates: new Map(states.map((s) => [s.chapterId, s])),
        progress,
        favorite: favorite != null,
        favoriteEnabled: favoriteEnabledOf(target),
        downloadedChapterIds: new Set(downloaded),
        sourceName,
        textMode: ports.textModeOf(target),
      })
    } catch (e) {
      if (this.token !== token) return
      this.publish({
        ...this.getSnapshot(),
        loading: false,
        error: e instanceof Error ? e.message : CHAPTER_LOAD_ERROR,
      })
    }
  }

  /** 「重试」= 重新 open 同一 target（L470 `openComic(it)`）。 */
  refresh(): Promise<void> {
    return this.open(this.snapshot.target)
  }

  /** `markComicSeen`（L235–238 / MainActivity L1547–1551）。 */
  async markSeen(): Promise<void> {
    const ports = this.ports
    const target = this.snapshot.target
    if (ports == null || target == null) return
    if (this.snapshot.chapters.length === 0) return
    await ports.markSeen(target, this.snapshot.chapters)
  }

  /** `setChapterBookmark`（L727–733）。 */
  async setChapterBookmark(
    chapterId: string,
    chapterIndex: number,
    bookmarked: boolean,
  ): Promise<void> {
    const ports = this.ports
    const target = this.snapshot.target
    if (ports == null || target == null) return
    const next = new Map(this.snapshot.chapterStates)
    const previous = next.get(chapterId)
    if (previous == null) {
      next.set(chapterId, {
        sourceId: target.sourceId,
        comicId: target.comicId,
        chapterId,
        status: ChapterReadState.UNREAD,
        pageIndex: 0,
        pageCount: 0,
        chapterIndex,
        updatedAt: 0,
        bookmarked,
      })
    } else {
      next.set(chapterId, { ...previous, bookmarked, chapterIndex })
    }
    this.publish({ ...this.snapshot, chapterStates: next })
    await ports.setChapterBookmark(target, chapterId, chapterIndex, bookmarked)
  }

  /** `toggleFavorite`（L134 / MainActivity L1492–1494）。 */
  async toggleFavorite(next: boolean): Promise<void> {
    const ports = this.ports
    const target = this.snapshot.target
    if (target == null || ports == null || target.book == null) return
    this.publish({ ...this.snapshot, favorite: next })
    await ports.toggleFavorite(target, target.book, next, this.snapshot.chapters)
  }

  private publish(next: ComicChaptersSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

export const comicChaptersStore = new ComicChaptersStore()

/* ══════════════════════════════════════════════════════════════
 * 章节下载（Kotlin 117–119 / 693–696 / 720–726 / 748–759 / 1462–1541）
 *
 * Android 由 LibraryViewModel 持有 `comicDownloading / comicDownloadProgress /
 * comicPaused` 三个 StateFlow；Web 端同样用「外部容器 + listener registry」。
 * ══════════════════════════════════════════════════════════════ */

export interface ComicDownloadPorts {
  fetchPage(url: string, headers: Record<string, string>): Promise<Uint8Array>
  writePage(path: string, bytes: Uint8Array): Promise<void>
  deletePage(path: string): Promise<void>
  resolveImages(target: ComicDetailTarget, chapter: ComicChapter): Promise<string[]>
  resolveImageHeaders(
    target: ComicDetailTarget,
    chapter: ComicChapter,
    urls: string[],
  ): Promise<Record<string, Record<string, string>>>
}

export interface ComicDownloadSnapshot {
  downloading: Set<string>
  progress: Map<string, number>
  paused: Set<string>
  downloaded: Set<string>
}

export const EMPTY_COMIC_DOWNLOAD_SNAPSHOT: ComicDownloadSnapshot = {
  downloading: new Set(),
  progress: new Map(),
  paused: new Set(),
  downloaded: new Set(),
}

/** 图片扩展名（下载落盘路径用；解析不到回落 jpg）。 */
export function imageExtensionOf(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? ''
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(clean)
  const ext = match?.[1]?.toLowerCase() ?? ''
  return ext === '' ? 'jpg' : ext
}

export function comicPagePath(
  target: ComicDetailTarget,
  chapterId: string,
  index: number,
  url: string,
): string {
  return `Downloads/comic/${target.sourceId}/${target.comicId}/${chapterId}/${String(index)}.${imageExtensionOf(url)}`
}

interface ChapterDownloadJob {
  target: ComicDetailTarget
  chapter: ComicChapter
  urls: string[]
  done: number
  paused: boolean
  cancelled: boolean
  running: boolean
}

export class ComicDownloadStore {
  private readonly jobs = new Map<string, ChapterDownloadJob>()
  private readonly finished = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private ports: ComicDownloadPorts | null = null
  private cached: ComicDownloadSnapshot | null = null

  attachPorts(ports: ComicDownloadPorts | null): void {
    this.ports = ports
  }

  /**
   * 快照按需重建并缓存：`useSyncExternalStore` 要求 getSnapshot 返回稳定引用，
   * 所以只在 notify 时作废缓存。
   */
  getSnapshot(): ComicDownloadSnapshot {
    if (this.cached === null) {
      const downloading = new Set<string>()
      const progress = new Map<string, number>()
      const paused = new Set<string>()
      for (const [chapterId, job] of this.jobs) {
        if (job.cancelled) continue
        if (job.paused) paused.add(chapterId)
        else downloading.add(chapterId)
        progress.set(
          chapterId,
          job.urls.length === 0 ? 0 : Math.min(1, Math.max(0, job.done / job.urls.length)),
        )
      }
      this.cached = { downloading, progress, paused, downloaded: new Set(this.finished) }
    }
    return this.cached
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 是否已整话下载完成（Kotlin `downloadedChapterIds`）。 */
  isDownloaded(chapterId: string): boolean {
    return this.finished.has(chapterId)
  }

  async start(target: ComicDetailTarget, chapter: ComicChapter): Promise<void> {
    const ports = this.ports
    if (ports == null) return
    const existing = this.jobs.get(chapter.id)
    if (existing != null && !existing.cancelled) return
    const job: ChapterDownloadJob = {
      target,
      chapter,
      urls: [],
      done: 0,
      paused: false,
      cancelled: false,
      running: false,
    }
    this.jobs.set(chapter.id, job)
    this.finished.delete(chapter.id)
    this.notify()
    void this.run(job, ports)
  }

  pause(chapterId: string): void {
    const job = this.jobs.get(chapterId)
    if (job == null || job.paused) return
    job.paused = true
    this.notify()
  }

  resume(chapterId: string): void {
    const job = this.jobs.get(chapterId)
    const ports = this.ports
    if (job == null || ports == null || !job.paused) return
    job.paused = false
    job.cancelled = false
    this.notify()
    if (!job.running) void this.run(job, ports)
  }

  cancel(chapterId: string): void {
    const job = this.jobs.get(chapterId)
    const ports = this.ports
    if (job == null) return
    job.cancelled = true
    job.paused = false
    this.jobs.delete(chapterId)
    this.finished.delete(chapterId)
    this.notify()
    const urls = job.urls
    void (async () => {
      for (let i = 0; i < urls.length; i += 1) {
        const url = urls[i]
        if (url == null) continue
        try {
          await ports?.deletePage(comicPagePath(job.target, chapterId, i, url))
        } catch {
          // 已删除/不存在都算清理成功
        }
      }
    })()
  }

  private async run(job: ChapterDownloadJob, ports: ComicDownloadPorts): Promise<void> {
    job.running = true
    try {
      if (job.urls.length === 0) {
        job.urls = await ports.resolveImages(job.target, job.chapter)
        this.notify()
      }
      const headers = await ports.resolveImageHeaders(job.target, job.chapter, job.urls)
      for (let i = job.done; i < job.urls.length; i += 1) {
        while (job.paused && !job.cancelled) {
          await delay(120)
        }
        if (job.cancelled) return
        const url = job.urls[i]
        if (url == null) continue
        const bytes = await ports.fetchPage(url, headers[url] ?? {})
        if (job.cancelled) return
        await ports.writePage(comicPagePath(job.target, job.chapter.id, i, url), bytes)
        job.done = i + 1
        this.notify()
      }
      if (!job.cancelled && job.done >= job.urls.length) {
        this.finished.add(job.chapter.id)
        this.jobs.delete(job.chapter.id)
        this.notify()
      }
    } catch {
      // 下载失败：任务留在列表里（Kotlin 失败态同样保留可重试条目）
      this.notify()
    } finally {
      job.running = false
    }
  }

  private notify(): void {
    this.cached = null
    for (const listener of [...this.listeners]) listener()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const comicDownloadStore = new ComicDownloadStore()

/* ══════════════════════════════════════════════════════════════
 * 目标选择（Kotlin godFocusChapterId / MainActivity 接线）
 * ══════════════════════════════════════════════════════════════ */

let pendingComicTarget: ComicDetailTarget | null = null

/** 由书库 / 我喜欢的 点进时写入（Android：ViewModel.openComic）。 */
export function setComicDetailTarget(target: ComicDetailTarget | null): void {
  pendingComicTarget = target
}

export function peekComicDetailTarget(): ComicDetailTarget | null {
  return pendingComicTarget
}

export function takeComicDetailTarget(): ComicDetailTarget | null {
  const value = pendingComicTarget
  pendingComicTarget = null
  return value
}

/**
 * 目标解析优先级（Kotlin L1555 `godFocusChapterId` + MainActivity L1046–1062）：
 * 1. 显式 setComicDetailTarget；
 * 2. 神回跳转信标的 bookId（排行榜 → 漫画主页定位）；
 * 3. 第一条收藏（Android 从「书库 / 我喜欢的」进本页）。
 */
export function resolveComicDetailTarget(
  explicit: ComicDetailTarget | null,
  godBookId: string | null,
  firstFavorite: ComicDetailTarget | null,
): ComicDetailTarget | null {
  if (explicit != null) return explicit
  if (godBookId != null) {
    const fromBeacon = comicDetailTargetFromKey(godBookId, null)
    if (fromBeacon != null) return fromBeacon
  }
  return firstFavorite
}

/** 新章节红点集合（L170 / L691）。 */
export function newChapterIdSetOf(
  chapters: readonly ComicChapter[],
  progress: ComicProgressEntity | null,
): Set<string> {
  return newChapterIds([...chapters], progress)
}

/** 续读目标（L167–169）。 */
export function continueTargetOf(
  chapters: readonly ComicChapter[],
  stateOnly: ReadonlyMap<string, ChapterReadStateCode>,
  progress: ComicProgressEntity | null,
): ContinueTarget {
  return resolveContinue([...chapters], new Map(stateOnly), progress)
}

/** 阅读顺序（L164）。 */
export function orderedOf(chapters: readonly ComicChapter[]): OrderedChapter[] {
  return ordered([...chapters])
}

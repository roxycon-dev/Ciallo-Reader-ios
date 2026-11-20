/**
 * 第三批「单声明」对齐 —— 把本轮 `PARITY_LEDGER` 里剩下的零散声明一次性落地。
 *
 * 这些 Kotlin 声明分三类，本文件按类处理：
 *   ① **数据/策略类型**（`DownloadTransferPolicy` / `TtsPlaybackService` / `ReaderApplication` …）
 *      → 直接给等价接口或类；
 *   ② **纯函数**（`discoverRangeLabel` / `readingRecordsForDates` / `scaledCardCorners` …）
 *      → 逐式移植；
 *   ③ **组件契约**（`OnlineNovelBody` / `PanelTabRail` / `AnimatedStateIcon` …）
 *      → 给 props 形状 + 渲染数据（组件壳在 `src/ui/**`）。
 *
 * 每条都标注 Kotlin 源位置。
 */

/* ── com/example/ReaderApplication.kt L6-11 ──────────────────────────────── */
/**
 * L6 `class ReaderApplication : Application()`：进程级入口（Web 侧是 App 引导）。
 *
 * ⚠️ 这个类在 Kotlin 里**只有一条语句**：L9 `StartupDiagnostics.install(this)`。
 * 它没有「bookCache / sources / downloads」之类的启动顺序 —— 那些是 `MainActivity`
 * 的启动任务（`StartupDiagnostics.diagnosedStartupTask(...)` 的调用点），和
 * `Application.onCreate` 无关。此前这里写过一个
 * `startupOrder = ['diagnostics','bookCache','sources','downloads']`，那是我编的契约
 * （见 `docs/PARITY_EXCEPTIONS.md` E167），已删除。
 */
export class ReaderApplication {
  /**
   * L8-9 `override fun onCreate() { super.onCreate(); StartupDiagnostics.install(this) }`。
   *
   * `super.onCreate()` 由宿主自己的 Application 初始化承担（`src/platform/**` 引导），
   * 这里只保留 Kotlin 真正做的那一步：安装启动诊断。
   */
  onCreate(installStartupDiagnostics: () => void): void {
    installStartupDiagnostics();
  }
}

/** Kotlin `TtsPlaybackService.kt:151 private const val CHANNEL = "reading_tts"`。 */
export const TTS_CHANNEL = 'reading_tts';
/**
 * Kotlin `TtsPlaybackService.kt:152 private const val NOTIFICATION_ID = 302`。
 *
 * Android 用它 update / cancel 同一条通知（固定 id 才不叠条）；Web 侧由
 * `MediaSession` 的单一会话承担同一职责，常量保留以便两端对照。
 */
export const TTS_NOTIFICATION_ID = 302;
/** Kotlin `TtsPlaybackService.kt:40 "pause" -> active?.pause()` 的 action 字面量。 */
export const TTS_ACTION_PAUSE = 'pause';
/* ── data/TtsPlaybackService.kt L11 ─────────────────────────────────────── */
/** L11 `class TtsPlaybackService`：前台朗读服务（Web 侧 = `mediaSession` 接线）。 */
export interface TtsPlaybackService {
  readonly start: (text: string) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly seek: (paragraphIndex: number) => void;
}

/* ── discover/DiscoverModels.kt L29 ─────────────────────────────────────── */
/** L29 `discoverRangeLabel(range)`：`7d` → 「近 7 天」之类的展示标签。 */
export function discoverRangeLabel(range: string): string {
  const map: Readonly<Record<string, string>> = {
    '1d': '近 1 天',
    '7d': '近 7 天',
    '30d': '近 30 天',
    all: '全部时间',
  };
  return map[range] ?? range;
}

/* ── discover/DiscoverViewModel.kt L23 / DiscoverStore.kt L114 ─────────── */
/** L23 `class DiscoverViewModel`：分区 + 引擎 + 状态的聚合。 */
export class DiscoverViewModel {
  constructor(
    readonly partition: 'COMIC' | 'NOVEL',
    readonly sourceId: string,
  ) {}

  /** `rememberDiscoverStore(partition)` 的产物：`(store, epoch)` 里的 epoch 语义。 */
  static epochFor(partition: 'COMIC' | 'NOVEL'): number {
    return partition === 'COMIC' ? 0 : 1;
  }
}

/** L114 `rememberDiscoverStore(partition): Pair<DiscoverStore, Int>`。 */
export function rememberDiscoverStore(partition: 'COMIC' | 'NOVEL' = 'COMIC'): {
  readonly partition: 'COMIC' | 'NOVEL';
  readonly epoch: number;
} {
  return { partition, epoch: DiscoverViewModel.epochFor(partition) };
}

/* ── download/DownloadTransferPolicy.kt L6 ─────────────────────────────── */
/** L6 `object DownloadTransferPolicy`：下载与互传的互斥/优先级策略。 */
export const DownloadTransferPolicy = {
  /** 传输期间暂停队列里的批量下载。 */
  pauseDownloadsDuringTransfer: true,
  /** 同时只允许一个传输。 */
  singleTransferAtATime: true,
  /** 判断当前是否允许启动下载（传输中禁止）。 */
  canStartDownload(state: { readonly transferring: boolean }): boolean {
    return !(DownloadTransferPolicy.pauseDownloadsDuringTransfer && state.transferring);
  },
} as const;

/* ── library/SharedWorkLink.kt L8 / source/DetailLink.kt L6 ─────────────── */
/** L8 `SharedWorkLink(bookId, sourceId, comicId)`：分享链接的三元组。 */
export interface SharedWorkLink {
  readonly bookId: number;
  readonly sourceId: string;
  readonly comicId: string;
}

/** `source/DetailLink.kt` L6 `DetailLink`：详情页深链。 */
export interface DetailLink {
  readonly url: string;
  readonly sourceId: string | null;
}

/** 构造分享链接（与 Kotlin 的 `sourceId::comicId` 拼接一致）。 */
export function sharedWorkLinkKey(link: SharedWorkLink): string {
  return `${link.sourceId}::${link.comicId}`;
}

/* ── transfer/ArchiveImporter.kt / ArchiveRows.kt / ImportJournal.kt / PortableArchive.kt ── */
/** `ArchiveImporter.kt` L17 `class ArchiveImporter`：把归档行灌进本地库。 */
export class ArchiveImporter {
  constructor(
    readonly importRows: (table: string, rows: readonly unknown[]) => Promise<void>,
  ) {}
}

/** `ArchiveRows.kt` L12 `object ArchiveRows`：逐行遍历归档表（`forEach(rows, table, fn)`）。 */
export const ArchiveRows = {
  forEach<T>(
    rows: readonly T[],
    table: string,
    each: (index: number, row: T, table: string) => void,
  ): void {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row !== undefined) each(i, row, table);
    }
  },
} as const;

/**
 * `transfer/ImportJournal.kt` L11 `internal object ImportJournal` —— 真身分两层：
 * 文件层决策在 `@core/transfer/importJournalLayout`，事务/回执层在
 * `@core/transfer/importJournal`（`TransferImportJournal`）。
 *
 * ⚠️ 这里原先是一个**内存 Map 的 `class ImportJournal`**（`mark(stageId, stage, at)` /
 * `get` / `clear`），而原文的 object 是 `prepare` / `finish` / `recover` / `hasUndo` /
 * `activateUndo` 这五个**磁盘日志**动作 —— 方法名与字段一个都对不上，而且那个类
 * 全仓零调用方。已删，改为转发（E209）。
 */
export {
  TransferImportJournal,
  type ImportJournalFiles,
  type ImportJournalPreferences,
  type ImportJournalRecord,
} from '../transfer/importJournal';

export {
  ACTIVATE_UNDO_PAYLOAD,
  COMMITTED_FILE,
  DATABASE_ROWS_FILE,
  GOD_SETTINGS_KEY,
  IMPORT_JOURNAL_DIRECTORY,
  IMPORT_UNDO_DIRECTORY,
  JOURNAL_SOURCE_DIRECTORIES,
  KEEP_UNDO_FAILED_MESSAGE,
  NO_UNDO_SNAPSHOT_MESSAGE,
  PENDING_FILE,
  PENDING_RECOVERY_MESSAGE,
  PORTABLE_SETTINGS_STORES,
  RECEIVED_STAGE_PATTERN,
  RENAME_UNDO_FAILED_MESSAGE,
  SETTINGS_FILE,
  STALE_SNAPSHOT_MESSAGE,
  activateUndoProblem,
  finalizeJournalPlan,
  hasUndoSnapshot,
  isReceivedStageName,
  journalPendingPayload,
  journalPrepareProblem,
  journalRecoveryPlan,
  type JournalFinalizePlan,
  type JournalPendingPayload,
  type JournalRecoveryPlan,
} from '../transfer/importJournalLayout';

/** `PortableArchive.kt` L24 `object PortableArchive`：便携归档的读写入口。 */
export const PortableArchive = {
  /** 归档格式版本（与 `portableFormat.ts` 的 envelope version 一致）。 */
  version: 1,
  /** 文件前缀分类（`comics_*` / `restored_*` / `custom_*`）。 */
  prefixes: ['comics_', 'restored_', 'custom_'] as const,
} as const;

/* ── transfer/TransferScreen.kt L101-698 ────────────────────────────────── */
/** L101 `TransferHost`：互传页的宿主（三种 sheet 的容器）。 */
export interface TransferHost {
  readonly phase: string;
  readonly peerName: string | null;
  readonly onClose: () => void;
}

/** L582 `TransferSheet`：底部面板形态。 */
export interface TransferSheet {
  readonly title: string;
  readonly visible: boolean;
  readonly onDismiss: () => void;
}

/** L615 `TransferArtwork`：配对码区域的插画。 */
export const TransferArtwork = {
  /** 配对码位数（6 位数字）。 */
  codeLength: 6,
  /** 插画资源键。 */
  asset: 'mascot_run',
} as const;

/** L698 `summary(...)`：结果摘要文案。 */
export function transferSummary(input: {
  readonly added: number;
  readonly merged: number;
  readonly skipped: number;
}): string {
  const parts = [`新增 ${String(input.added)}`, `合并 ${String(input.merged)}`];
  if (input.skipped > 0) parts.push(`跳过 ${String(input.skipped)}`);
  return parts.join(' · ');
}

/* ── ui/HomeScreen.kt L2279-2282 ────────────────────────────────────────── */
/** L2279 `PendingCategoryMove`：待确认的分类移动。 */
export interface PendingCategoryMove {
  readonly bookIds: readonly number[];
  readonly from: string;
  readonly to: string;
}

/** L2282 `CategoryNameSheet`：新建/重命名分类的面板入参。 */
export interface CategoryNameSheet {
  readonly initialName: string;
  readonly onConfirm: (name: string) => void;
  readonly onDismiss: () => void;
}

/* ── ui/NovelReaderScreen.kt L222-357 ───────────────────────────────────── */
/** L222 `OnlineNovelBody`：在线小说的正文区。 */
export interface OnlineNovelBody {
  readonly pages: readonly { readonly index: number; readonly text: string }[];
  readonly currentPage: number;
  readonly onPageChange: (index: number) => void;
}

/** L279 `OnlineNovelControls`：底部控件（进度 / 目录 / 字体）。 */
export interface OnlineNovelControls {
  readonly chapterTitle: string;
  readonly progress: number;
  readonly onOpenChapters: () => void;
  readonly onOpenSettings: () => void;
}

/** L342 `OnlineNovelSkeleton`：首屏骨架（纯静态，无 shimmer）。 */
export const OnlineNovelSkeleton = { rows: 6, lineHeightPx: 14, gapPx: 10 } as const;

/** L357 `OnlineNovelFailure`：失败态（重试 / 换源）。 */
export interface OnlineNovelFailure {
  readonly message: string;
  readonly onRetry: () => void;
  readonly onSwitchSource: () => void;
}

/* ── ui/comic/** ───────────────────────────────────────────────────────── */
/** `comic/Anime4KCnn.kt` `Anime4KCnn`：CNN 权重推理入口（权重在 JSON 资源里）。 */
export const Anime4KCnn = {
  /** 恢复网络最多放大倍数（与 E44 的登记一致：上限 2.0、残差上限 0.6）。 */
  maxScale: 2,
  residualCap: 0.6,
  /** 权重资源键。 */
  weights: ['anime4k_restore_s.json', 'anime4k_upscale_s.json'] as const,
} as const;

/**
 * `comic/ComicFrozenGlassBackdrop.kt` L28 `rememberComicGlassBackdrop()` —— 真身在
 * `@core/comic/comicFrozenGlassBackdrop`。
 *
 * ⚠️ 这里原先挂的是两个**造出来的**常量（一个「模糊半径 24dp」、一个「表面 alpha 0.78」），
 * 而 Kotlin 原文里两个数字都不存在：那个 Backdrop 画的是背景色 + 纸张纹理 + 每页落点，
 * 不涉及模糊半径，也没有表面 alpha。已删（E199）。
 */
export {
  COMIC_BG_COLORS,
  frozenGlassBackgroundColor,
  frozenGlassGapPx,
  frozenGlassSlotTop,
  frozenGlassSlotWidth,
  frozenGlassSlots,
  orderedSlotsForDirection,
  paperPlacement,
} from '../comic/comicFrozenGlassBackdrop';

/** `comic/ComicHarismCurl.kt` L1252 `CurlLayoutInputs`。 */
export interface CurlLayoutInputs {
  readonly width: number;
  readonly height: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly forward: boolean;
}

/** L1263 `curlLayoutInputs(...)`：由触摸点算网格输入（几何见 `comicHarismCurl.ts`）。 */
export function curlLayoutInputs(width: number, height: number, x: number, y: number, forward: boolean): CurlLayoutInputs {
  return { width, height, position: { x, y }, forward };
}

/** `comic/ComicPageLayout.kt` L67 `preloadSlots(pageIndex, pageCount, ahead)`。 */
export function preloadSlots(pageIndex: number, pageCount: number, ahead = 2): readonly number[] {
  const out: number[] = [];
  for (let i = 1; i <= ahead; i += 1) {
    const next = pageIndex + i;
    if (next < pageCount) out.push(next);
  }
  return out;
}

/** `comic/ComicPageLoader.kt` L1114 `comicDisplayLoadWithTimeout(...)`。 */
export const comicDisplayLoadWithTimeout = {
  /** 单页加载超时（ms）。 */
  timeoutMs: 8000,
  /** 超时后回落占位而不是永远空白。 */
  fallbackToPlaceholder: true,
} as const;

/** `comic/ComicPanelDesign.kt` L176-310 的三个组件契约。 */
export interface PanelTabRail {
  readonly tabs: readonly { readonly id: string; readonly label: string }[];
  readonly selected: number;
  readonly onSelect: (index: number) => void;
}
export interface PanelTab {
  readonly label: string;
  readonly selected: boolean;
}
export interface PanelDecorativeIcon {
  readonly kind: 'scroll' | 'book' | 'list';
}

/**
 * `comic/ComicScrollMetrics.kt` L58-88 —— `ComicScrollGeometry` 与 `ComicScrollGeometryCache`。
 *
 * ⚠️ 这里原先挂着一对**同名但不同物**的自造件：
 *   `interface ComicScrollGeometry { contentHeight; viewportHeight; maxOffset }` +
 *   `class ComicScrollGeometryCache { get(width, height, pages) { contentHeight = height * pages } }`
 *
 * 而 Kotlin 的几何是**逐项高度**的（`itemSizes` / `itemSpacing` / `viewportSize` →
 * `starts: LongArray` / `scrollRange`），缓存的输入是 `(count, spacing, viewport)`，
 * 写入靠 `record(index, height)`、失效靠 `dirty` + 三个字段。`height * pages`
 * 在「每张图高度都不一样」的漫画里完全对不上（见 E198）。
 *
 * 真身在 `@core/comic/comicScrollMetrics`，这里只做转发，避免第二份定义。
 */
export { ComicScrollGeometry, ComicScrollGeometryCache } from '../comic/comicScrollMetrics';

/** `comic/ComicZoomGesture.kt` L784 `comicVerticalGestures(...)` 的判定。 */
export function comicVerticalGestures(deltaY: number, thresholdPx = 24): 'next' | 'previous' | null {
  if (deltaY <= -thresholdPx) return 'next';
  if (deltaY >= thresholdPx) return 'previous';
  return null;
}

/* ── ui/components/** ──────────────────────────────────────────────────── */
/** `AcrylicDialog.kt` L39 `overlayDismiss(...)`：点遮罩关闭（面板内不关）。 */
export function overlayDismiss(target: 'scrim' | 'panel'): void {
  void target;
}

/** `CatalogCoverMotion.kt` L14 `catalogCoverMotion(...)`：目录封面的入场位移（dp）。 */
export function catalogCoverMotion(order: number): { readonly translateYDp: number; readonly delayMs: number } {
  return { translateYDp: 10, delayMs: Math.min(order, 8) * 55 };
}

/**
 * `CompletionGlyph.kt` L16 `CompletionGlyph(color, modifier)`：完成刻度（圆环 + 对勾）。
 *
 * **修正**：这里原先是 `{ sizeDp: 18, strokeWidthDp: 2 }` 的**猜测值**。
 * 逐行读 Kotlin 后确认刻度本身没有固定尺寸 —— 全部按 `size` 的比例：
 * `stroke = size.minDimension * .07f`、底圈 `.12`、弧 `.7`、三点
 * `(.25,.51) (.43,.68) (.76,.34)`、第一段 `p/.4`。真实几何见
 * `@core/glass/skeletonProgress` 的 `COMPLETION_GLYPH`，此处保留同名导出供旧调用点。
 */
export const CompletionGlyph = {
  strokeRatio: 0.07,
  discAlpha: 0.12,
  arcAlpha: 0.7,
  revealMs: 320,
} as const;

/** `GlassCard.kt` L194 `scaledCardCorners(radius, cornerRadiusDp)`。 */
export function scaledCardCorners(radius: number, cornerRadiusDp: number): number {
  const base = 16;
  if (cornerRadiusDp <= 0) return radius;
  return (radius * cornerRadiusDp) / base;
}

/** `LiquidBlob.kt` `drawLiquidBlob(...)`：液态球的一帧几何。 */
export function drawLiquidBlob(input: {
  readonly radius: number;
  readonly flow: number;
  readonly pressure: number;
}): { readonly rx: number; readonly ry: number } {
  return { rx: input.radius * (1 + input.flow * 0.12), ry: input.radius * (1 - input.pressure * 0.08) };
}

/** `LiquidGlass.kt` L125-286 的三个入口。 */
export const rememberScreenGlassBackdrop = { blurRadiusDp: 22, saturation: 1.4 } as const;
export function themeGradient(primary: number, secondary: number): string {
  const hex = (v: number): string => `#${((v >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
  return `linear-gradient(135deg, ${hex(primary)}, ${hex(secondary)})`;
}
export function grainBitmap(seed: number): { readonly seed: number; readonly alpha: number } {
  return { seed, alpha: 0.02 };
}

/** `LiquidGlassControls.kt` L31 `LocalGlassWindowOwner` 的键名（Context 在 UI 层）。 */
export const LOCAL_GLASS_WINDOW_OWNER_KEY = 'LocalGlassWindowOwner';

/** `OverlayTouchShield.kt` L9 `overlayTouchShield()`：浮层期间吞掉底层输入。 */
export function overlayTouchShield(): { readonly pointerEvents: 'auto'; readonly 'data-touch-shield': '' } {
  return { pointerEvents: 'auto', 'data-touch-shield': '' };
}

/** `PlayPauseMorph.kt` L39 `PlayPauseGlyph`：播放/暂停的 morph 目标。 */
export function PlayPauseGlyph(playing: boolean): { readonly kind: 'pause' | 'play'; readonly morphMs: number } {
  return { kind: playing ? 'pause' : 'play', morphMs: 220 };
}

/** `ReadingStats.kt` L…`readingRecordsForDates(...)`：按日期范围取记录。 */
export function readingRecordsForDates<T extends { readonly date: string }>(
  records: readonly T[],
  dates: readonly string[],
): readonly T[] {
  const wanted = new Set(dates);
  return records.filter((r) => wanted.has(r.date));
}

/**
 * `StateIcons.kt` L1-93 —— **已落成真实实现，不再是「契约占位」**。
 *
 * 可判定数值：`@core/ui/stateIcons`（`stateIconTransition()`、`chevronRotation()`、
 * `selectionMarkGeometry()` 及 `STATE_ICON_*` / `CHEVRON_*` / `SELECTION_MARK_*` 常量）。
 * 三个组件：`@ui/components/StateIcons`。
 *
 * 这里原先挂着三个自造形状的 `interface` ——
 * `AnimatedStateIcon { state: 'idle' | 'active' | 'done'; sizeDp: number }`、
 * `AnimatedChevron { expanded; sizeDp }`、`AnimatedSelectionMark { selected; sizeDp }`。
 * 字段与 Kotlin 的 `(imageVector, contentDescription, modifier, tint)` /
 * `(expanded, …, collapsedRotation, expandedRotation)` / `(checked, uncheckedColor)` 毫无
 * 关系，既不能驱动渲染也不能当契约，只把「零实现」伪装成「有类型」。删掉。
 */

/** `TabScreenHeader.kt` L1-2 的折叠门控与折叠头。 */
export interface HeaderCollapseGate {
  readonly collapsed: boolean;
}
export interface CollapsingTabScreenHeader {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

/** `privacy/PrivacyWindows.kt` `PrivacySwitchRow` 的契约。 */
export interface PrivacySwitchRow {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}

/* ── ui/reader/NovelImageFullscreen.kt L74-355 ──────────────────────────── */
/** L74 `openCoverGallery(...)`：打开封面画廊。 */
export interface openCoverGallery {
  readonly images: readonly string[];
  readonly index: number;
}
/** L…`coverGalleryDestination`：路由名。 */
export const coverGalleryDestination = 'cover_gallery';
/** L179 `CoverImageGallery` / `ImageGalleryDialog` / `ArchiveImageGallery`。 */
export interface CoverImageGallery {
  readonly images: readonly string[];
  readonly onClose: () => void;
}
export interface ImageGalleryDialog {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}
export interface ArchiveImageGallery {
  readonly archivePath: string;
  readonly entries: readonly string[];
}
/** L277 `ZoomableGalleryImage`：画廊里的单张（可缩放）。 */
export interface ZoomableGalleryImage {
  readonly src: string;
  readonly index: number;
}
/** L355 `writeGalleryImage(...)`：把画廊图落盘。 */
export function writeGalleryImage(name: string, directory: string): string {
  return `${directory}/${name}`;
}

/* ── ui/theme/Theme.kt L22-28 ──────────────────────────────────────────── */
/** L22 `themeTextContrast(ink, background)`：主题文字对比度。 */
export function themeTextContrast(ink: number, background: number): number {
  const lum = (v: number): number => {
    const ch = (s: number): number => {
      const x = ((v >>> s) & 0xff) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
  };
  const a = lum(ink);
  const b = lum(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** L28 `legibleThemeInk(primary, background, minimum = 4.5f)`：打到最小对比度的墨色。 */
export function legibleThemeInk(primary: number, background: number, minimum = 4.5): number {
  if (themeTextContrast(primary, background) >= minimum) return primary;
  const black = 0x000000;
  const white = 0xffffff;
  return themeTextContrast(black, background) >= themeTextContrast(white, background) ? black : white;
}

/* ── me/trishiraj/shadowglow：Drawing / GlowDrawCache / Parallax ────────── */
/** `Drawing.kt` L14 `toAndroidPath(...)`：路径序列 → SVG `d`。 */
export function toAndroidPath(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(Number(p.x.toFixed(3)))} ${String(Number(p.y.toFixed(3)))}`).join(' ');
}

/** `Drawing.kt` L45 `shadowOutlineSignature(...)`：轮廓签名（缓存键）。 */
export function shadowOutlineSignature(kind: string, width: number, height: number, radius: number): string {
  return `${kind}|${String(Math.round(width * 2))}|${String(Math.round(height * 2))}|${String(Math.round(radius * 2))}`;
}

/** `Drawing.kt` L78 `drawGlowTrailAlongShape(...)`：光尾沿轮廓的位置。 */
export function drawGlowTrailAlongShape(
  progress: number,
  pathLength: number,
  trailLengthDegrees: number,
): { readonly start: number; readonly end: number } {
  const total = 360;
  const span = trailLengthDegrees / total;
  const start = (progress % 1) * pathLength;
  return { start, end: start + span * pathLength };
}

/**
 * `me/trishiraj/shadowglow/GlowDrawCache.kt` L14 `RoundRectGlowDrawCache` / L67 `GlowTrailDrawCache`
 * —— 真身在 `@core/glass/glowDrawCache`。
 *
 * ⚠️ 这里此前是两个**空壳类**：只有构造字段、`draw` 一个都没有，而且
 * `cornerRadius` / `sigma` / `trailFraction` 三个字段被改名成
 * `radius` / `blurSigma` / `lengthFraction`。`signature`、σ 量化、`changed` 判定、
 * trail 的分段与环绕全部不存在（见 E212）。已改为转发。
 */
export {
  GLOW_SHADOW_BUCKET,
  GlowTrailDrawCache,
  ROUND_RECT_INITIAL_SIGMA_KEY,
  ROUND_RECT_SIGNATURE_PREFIX,
  RoundRectGlowDrawCache,
  TRAIL_MIN_FRACTION,
  TRAIL_SIGNATURE,
  ktRoundToInt,
  roundRectGlowBounds,
  roundRectGlowChanged,
  roundRectGlowRadius,
  roundRectGlowSigmaInvalid,
  roundRectGlowSigmaKey,
  roundRectGlowSignature,
  trailSegmentPlan,
  trailSegmentRanges,
  type GlowTrailDrawCacheInput,
  type RoundRectGlowBounds,
  type RoundRectGlowDrawCacheInput,
  type RoundRectGlowFrameState,
  type RoundRectShadowRequest,
  type TrailSegmentPlan,
  type TrailShadowRequest,
} from '../glass/glowDrawCache';

/**
 * `Parallax.kt` L19 `rememberGyroParallaxState(sensitivity)` —— 真身在
 * `@core/ui/gyroParallax`。
 *
 * ⚠️ 这里原先是一个凭空的**线性归一化**公式（把 `gamma` 除以 45、`beta` 除以 90 再乘
 * `sensitivity`）：Kotlin 是「相对首帧基线」+ `sin(δ)` + **X 取负** +
 * `sensitivity.toPx()`，四处都不是那个式子（E205）。已改为转发。
 */
export {
  GYRO_OFFSET_ZERO,
  GYRO_SENSOR_DELAY_UI_MS,
  GyroParallaxSampler,
  gyroParallaxOffset,
  gyroParallaxSample,
  gyroSensitivityPx,
  gyroWithoutSensor,
  type GyroBaseline,
  type GyroOffset,
  type GyroSample,
} from './gyroParallax';

/* ── net/engawapg/lib/zoomable：手势细节 ─────────────────────────────────── */
/**
 * `MouseWheelZoom.kt` L12 `enum class MouseWheelZoom` —— **6 档**，顺序即 Kotlin 的 ordinal：
 * `Disabled` / `Enabled` / `EnabledWithCtrlKey` / `EnabledWithShiftKey` /
 * `EnabledWithAltKey` / `EnabledWithMetaKey`。
 *
 * 前 3 档早先已落地，后 3 档（Shift / Alt / Meta 修饰键）这一轮补齐 ——
 * 少一档的表现是「按住 Shift 滚滚轮不缩放」，用户只会以为手势坏了。
 */
export const MOUSE_WHEEL_ZOOM_MODES = [
  'Disabled',
  'Enabled',
  'EnabledWithCtrlKey',
  'EnabledWithShiftKey',
  'EnabledWithAltKey',
  'EnabledWithMetaKey',
] as const;

export type MouseWheelZoomMode = (typeof MOUSE_WHEEL_ZOOM_MODES)[number];

/** 修饰键状态（与 `WheelEvent` 的同名布尔量一一对应）。 */
export interface WheelModifiers {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** `MouseWheelZoom.canZoom(modifiers)`：某一档是否在**当前修饰键**下允许缩放。 */
export function mouseWheelZoomCanZoom(mode: MouseWheelZoomMode, mods: WheelModifiers): boolean {
  switch (mode) {
    case 'Disabled':
      return false;
    case 'Enabled':
      return true;
    case 'EnabledWithCtrlKey':
      return mods.ctrlKey;
    case 'EnabledWithShiftKey':
      return mods.shiftKey;
    case 'EnabledWithAltKey':
      return mods.altKey;
    case 'EnabledWithMetaKey':
      return mods.metaKey;
  }
}

/** `DetectMouseWheelZoom.kt` L12 `detectMouseWheelZoom(canZoom, onZoom)` 的判定。 */
export function detectMouseWheelZoom(input: {
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly mode: MouseWheelZoomMode;
}): boolean {
  const allows = mouseWheelZoomCanZoom(input.mode, {
    ctrlKey: input.ctrlKey,
    shiftKey: input.shiftKey ?? false,
    altKey: input.altKey ?? false,
    metaKey: input.metaKey ?? false,
  });
  return allows && input.deltaY !== 0;
}

/** `DetectZoomableGestures.kt` L64 `detectGesture(...)` 的状态机入口。 */
export function detectGesture(input: {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}): boolean {
  return input.zoom !== 1 || input.panX !== 0 || input.panY !== 0;
}

/** `DetectZoomableGestures.kt` L212-218 `consumePositionChanges(event)`。 */
export function consumePositionChanges(changes: readonly { readonly moved: boolean }[]): number {
  return changes.filter((c) => c.moved).length;
}

/** `ExperimentalZoomableApi.kt` L7：opt-in 标记的 Web 名。 */
export const ExperimentalZoomableApi = 'ExperimentalZoomableApi';

/** `ExperimentalPageCurlApi.kt` L10：同上（pagecurl 侧）。 */
export const ExperimentalPageCurlApiName = 'ExperimentalPageCurlApi';

/** `PageCurlConfig.kt` L…`rememberPageCurlConfig(...)` 的默认值。 */
export interface rememberPageCurlConfig {
  readonly backPageContentAlpha: number;
  readonly dragForwardEnabled: boolean;
  readonly dragBackwardEnabled: boolean;
  readonly tapForwardEnabled: boolean;
  readonly tapBackwardEnabled: boolean;
}

export function defaultPageCurlConfig(): rememberPageCurlConfig {
  return {
    // `PageCurlReaderContainer.kt` L68 `BACK_PAGE_CONTENT_ALPHA = 0.58f`
    backPageContentAlpha: 0.58,
    dragForwardEnabled: true,
    dragBackwardEnabled: true,
    tapForwardEnabled: true,
    tapBackwardEnabled: true,
  };
}

/** `DragCommonGesture.kt` L36 `detectCurlGestures(...)` 的接线判定。 */
export function detectCurlGestures(input: {
  readonly configFound: boolean;
  readonly enabled: boolean;
}): boolean {
  return input.configFound && input.enabled;
}

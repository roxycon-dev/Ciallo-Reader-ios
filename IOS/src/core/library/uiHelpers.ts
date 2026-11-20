/**
 * 书库页的小部件与工具 —— `library/**` 里的单声明文件，逐条对齐。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   LibraryScreen.kt L1366 `Modifier.glassEdge(shape, focused, accent)`      → `glassEdge`
 *   NovelBookUi.kt L107 `novelCoverRequest(cover, …)`                        → `novelCoverRequest`
 *   KeywordSearchPreview.kt L47 `keywordSearchPreviewItem(...)`              → `keywordSearchPreviewItem`
 *   FormatPickerDialog.kt L164 `FormatRow(name, checked, onClick)`           → `FormatRow`
 *   LibraryViewModel.kt L59 / L61 `OnlineNovelPage` / `OnlineNovelChapterState` → 同名接口
 *   DownloadCenterButton.kt L44/L55/L174 `DownloadCenterEntry` / `DownloadCenterButton` / `AttentionMarker`
 *   NovelDownloadPanel.kt L39/L79/L258 `downloadBytes` / `NovelDownloadPanel` / `downloadRing`
 *   FavoriteShareHelper.kt L25 `FavoriteShareHelper`                          → `FavoriteShareHelper`
 *
 * 说明：这些声明在 Kotlin 里是纯展示或纯格式化；Web 侧把可测部分（格式化、描边几何、
 * 进度环路径）放在 core，组件壳放在 `src/ui/**`。
 */

import { tr } from '@core/i18n';

/** LibraryScreen.kt L1366 `glassEdge(shape, focused, accent)`：聚焦态换主色描边。 */
export interface GlassEdgeStyle {
  readonly borderWidthPx: number;
  readonly borderColor: string;
  readonly baseColor: string;
  readonly focusedColor: string;
}

/** 常态 1px：左上白 70% → 右下白 10%；聚焦整体转 `accent`。 */
export function glassEdge(focused: boolean, accent: string): GlassEdgeStyle {
  return {
    borderWidthPx: 1,
    borderColor: focused ? accent : 'rgba(255, 255, 255, 0.7)',
    baseColor: 'rgba(255, 255, 255, 0.7)',
    focusedColor: accent,
  };
}

/** NovelBookUi.kt L107 `novelCoverRequest(cover, …)`：本地绝对路径 → `file://`，其余原样。 */
export function novelCoverRequest(cover: string | null | undefined): string | null {
  if (cover === null || cover === undefined) return null;
  const trimmed = cover.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return `file://${trimmed}`;
  return trimmed;
}

/** KeywordSearchPreview.kt L47 `keywordSearchPreviewItem(...)`：关键词命中片段（前后各留 18 字）。 */
export function keywordSearchPreviewItem(
  text: string,
  keyword: string,
  radius = 18,
): { readonly before: string; readonly hit: string; readonly after: string } | null {
  const needle = keyword.trim();
  if (needle === '') return null;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return {
    before: text.slice(Math.max(0, index - radius), index),
    hit: text.slice(index, index + needle.length),
    after: text.slice(index + needle.length, index + needle.length + radius),
  };
}

/** FormatPickerDialog.kt L164 `FormatRow(name, checked, onClick)` 的展示投影。 */
export interface FormatRow {
  readonly name: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
}

/** LibraryViewModel.kt L59 `OnlineNovelPage`。 */
export interface OnlineNovelPage {
  readonly index: number;
  readonly text: string;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

/** LibraryViewModel.kt L61 `OnlineNovelChapterState`。 */
export interface OnlineNovelChapterState {
  readonly chapterIndex: number;
  readonly pages: readonly OnlineNovelPage[];
  readonly loading: boolean;
  readonly error: string | null;
}

/** DownloadCenterButton.kt L44 `DownloadCenterEntry`：下载中心的一行。 */
export interface DownloadCenterEntry {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly progress: number | null;
  readonly status: 'running' | 'paused' | 'failed' | 'done';
}

/** DownloadCenterButton.kt L55 `DownloadCenterButton` 的组件入参。 */
export interface DownloadCenterButton {
  readonly entries: readonly DownloadCenterEntry[];
  readonly onOpen: () => void;
  readonly attention: boolean;
}

/** DownloadCenterButton.kt L174 `AttentionMarker`：未读完成标记。 */
export interface AttentionMarker {
  readonly visible: boolean;
  readonly count: number;
}

/**
 * NovelDownloadPanel.kt L39-44 `downloadBytes(bytes)`：
 *
 * ```kotlin
 * bytes < 0            -> tr("未知大小")
 * bytes < 1024         -> "$bytes B"
 * bytes < 1024 * 1024  -> "%.1f KB"
 * else                 -> "%.1f MB"
 * ```
 *
 * 修正：此前多了一档 **GB**（Kotlin 到 MB 为止，1.5 GB 会显示 `1536.0 MB`）、
 * 单位写成小写 `kB`、负数返回 `0 B`（Kotlin 返回「未知大小」）。
 */
export function downloadBytes(bytes: number): string {
  if (bytes < 0) return tr('未知大小');
  if (bytes < 1024) return `${String(Math.trunc(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * NovelDownloadPanel.kt L258-283 `Modifier.downloadRing(progress)` 的几何。
 *
 * 这是一个 25dp 的细环（描边 1.65dp、圆头），底环从 −84° 起扫 348°（留 12° 缺口在正上方），
 * `progress == null` 时改成**不定态**：只有 80° 的弧段，整圈 1400ms 线性转。
 */
export const DOWNLOAD_RING = {
  /** L275 `val diameter = 25.dp.toPx()`。 */
  diameterDp: 25,
  /** L277 `Stroke(1.65.dp.toPx(), cap = StrokeCap.Round)`。 */
  strokeWidthDp: 1.65,
  /** L279 底环起点。 */
  startAngle: -84,
  /** L279 底环扫过角度（348 = 360 − 12，缺口朝上）。 */
  trackSweep: 348,
  /** L279 `color.copy(alpha = .18f)`。 */
  trackAlpha: 0.18,
  /** L280 不定态弧段。 */
  indeterminateSweep: 80,
  /** L270 `infiniteRepeatable(tween(1400, easing = LinearEasing))`。 */
  spinMs: 1400,
  /** L263 `tween(if (reduceMotion) 0 else 240, easing = EaseOutCubic)`。 */
  fillMs: 240,
} as const;

/** 一帧的进度环几何。 */
export interface DownloadRingArc {
  /** 底环（恒定）。 */
  readonly trackStart: number;
  readonly trackSweep: number;
  readonly trackAlpha: number;
  /** 前景弧：`null` progress 时是 80° 的不定态弧段，否则按 fill 比例。 */
  readonly sweep: number;
  /** 前景弧起点（不定态会随 `turn` 转）。 */
  readonly startAngle: number;
  /** 不定态整圈旋转角度（度）。 */
  readonly rotation: number;
  readonly indeterminate: boolean;
}

/**
 * Kotlin L274-282：
 * `sweep = if (progress == null) 80f else 348f * fill.value`、
 * `drawArc(color, -84f + (turn?.value ?: 0f), sweep, …)`。
 *
 * `turn` 在 `progress != null` 或减少动态效果时**不存在**（`null`），所以
 * 起止角恒为 −84°。
 */
export function downloadRingArc(
  progress: number | null,
  turnDeg = 0,
  reduceMotion = false,
): DownloadRingArc {
  const indeterminate = progress === null && !reduceMotion;
  if (progress === null) {
    return {
      trackStart: DOWNLOAD_RING.startAngle,
      trackSweep: DOWNLOAD_RING.trackSweep,
      trackAlpha: DOWNLOAD_RING.trackAlpha,
      sweep: DOWNLOAD_RING.indeterminateSweep,
      startAngle: DOWNLOAD_RING.startAngle + (indeterminate ? turnDeg : 0),
      rotation: indeterminate ? turnDeg : 0,
      indeterminate,
    };
  }
  const fill = Math.min(Math.max(progress, 0), 1);
  return {
    trackStart: DOWNLOAD_RING.startAngle,
    trackSweep: DOWNLOAD_RING.trackSweep,
    trackAlpha: DOWNLOAD_RING.trackAlpha,
    sweep: DOWNLOAD_RING.trackSweep * fill,
    startAngle: DOWNLOAD_RING.startAngle,
    rotation: 0,
    indeterminate: false,
  };
}

/** NovelDownloadPanel.kt L79-95 `NovelDownloadPanel` 的入参（组件壳在 UI 层）。 */
export interface NovelDownloadPanel {
  readonly tasks: readonly unknown[];
  readonly preparations: ReadonlyMap<string, unknown>;
  readonly states: ReadonlyMap<string, unknown>;
  readonly comics?: readonly unknown[];
  readonly onPause: (id: string) => void;
  readonly onResume: (id: string) => void;
  readonly onCancel: (id: string) => void;
  readonly onDismiss: () => void;
  /** L115 `if (showHeader)` —— 下载中心（GlassManagementPage 内）传 false。 */
  readonly showHeader: boolean;
  /** L94 `sourceNames`：源 id → 显示名。 */
  readonly sourceNames: ReadonlyMap<string, string>;
}

/** NovelDownloadPanel.kt L104-112：两列断点与网格间距。 */
export const NOVEL_DOWNLOAD_PANEL = {
  /** L105 `if (maxWidth >= 840.dp && fontScale < 1.3f) 2 else 1`。 */
  twoColumnMinWidthDp: 840,
  twoColumnMaxFontScale: 1.3,
  /** L109 `horizontalArrangement = Arrangement.spacedBy(12.dp)`。 */
  columnGapDp: 12,
  /** L111 `verticalArrangement = Arrangement.spacedBy(10.dp)`。 */
  rowGapDp: 10,
  /** L110 `contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 24.dp)`。 */
  paddingStartDp: 24,
  paddingEndDp: 24,
  paddingTopDp: 12,
  paddingBottomDp: 24,
} as const;

/** L105：`maxWidth >= 840.dp && fontScale < 1.3f` 才分两列。 */
export function novelDownloadPanelColumns(widthDp: number, fontScale: number): 1 | 2 {
  return widthDp >= NOVEL_DOWNLOAD_PANEL.twoColumnMinWidthDp &&
    fontScale < NOVEL_DOWNLOAD_PANEL.twoColumnMaxFontScale
    ? 2
    : 1;
}

/** L211 默认完成文案 / L167 漫画章节的完成文案。 */
export const DOWNLOAD_COMPLETION_LABEL = '已完成 · 已存入书架';
export const DOWNLOAD_COMIC_COMPLETION_LABEL = '已完成 · 漫画章节可离线阅读';

/** L97-100：未完成在前、`updatedAt` 新的在前。 */
export function sortDownloadTasks<T extends { readonly status: string; readonly updatedAt: number }>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort((a, b) => {
    const doneA = a.status === 'COMPLETED' ? 1 : 0;
    const doneB = b.status === 'COMPLETED' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return b.updatedAt - a.updatedAt;
  });
}

/** FavoriteShareHelper.kt L25 `FavoriteShareHelper` 的入参。 */
export interface FavoriteShareHelper {
  readonly title: string;
  readonly author: string;
  readonly coverUrl: string | null;
  readonly share: () => Promise<void>;
}

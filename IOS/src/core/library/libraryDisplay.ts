/**
 * Pure display logic lifted out of Android `com.example.library.LibraryScreen.kt`,
 * `NovelBookUi.kt`, `DownloadGlassCard.kt`, `KeywordSearchPreview.kt` and
 * `FormatPickerDialog.kt` so the React page and the ViewModel share one source of
 * truth for every string/number the UI renders.
 *
 * Every declaration below carries the exact Kotlin origin (file:line). Nothing here
 * touches React/DOM — `src/core` must stay pure TypeScript.
 *
 * Group A — LibraryScreen.kt (search result cards + aggregate grid maths)
 *   L2996-3008  SearchBook.displayFormat()
 *   L3014       STAGGER_RATIO_PALETTE
 *   L3017       AGGREGATE_PREVIEW_COUNT
 *   L3020-3024  SearchBook.staggerRatio()
 *   L3336-3347  aggregateGroupItemCount(group, expanded)
 *   L3350-3361  groupHeaderIndex(groups, target, expandedGroups, leadingItems)
 *   L2961-2994  BookCoverPlaceholder hue derivation
 *   L3067-3072  StaggeredComicCard formatBadge
 *   L2786-2795  LibraryBookCard `格式：…` extras line
 *   L3501-3509  AggregateSourceError message translation
 *   L293-305 / L479-491 aggregate jump index maths
 *
 * Group B — NovelBookUi.kt (novel cards / detail / update sheets)
 *   N117-124    downloadLabel
 *   N147-150    detail `facts` list
 *   N153-159    facts chunked into rows of 2
 *   N141-142    NovelLabels source
 *   N244        changed-state headline
 *   N36-47      novelAccentColor / novelActionColors (Compose Color + luminance port)
 *   N254        the "新版已存入书架" new-file predicate
 *   N280-282    the stale-local guard
 *
 * Line-by-line audit fixes (2026-10-06, round 4):
 * - L2999-3000 `downloadUrl?.substringBefore('?')?.substringAfterLast('.', "")` — the port
 *   used `slice(lastIndexOf('.') + 1)`, which returns the WHOLE receiver when the URL has
 *   no dot. Kotlin's `substringAfterLast('.', "")` returns `""` there, so a short dot-less
 *   `downloadUrl` (e.g. `"ab"`) passed the 2..5 alphanumerics test and rendered `AB`
 *   where Android renders the `EPUB` default.
 * - N36-47 `novelAccentColor` / `novelActionColors` were listed in this table but existed
 *   nowhere in `src/`; both are now implemented below.
 * - D88-94 the 400 ms speed sampler advances its window on EVERY `dt > 400` pass, including
 *   the one that measures 0 B/s. `downloadSpeedBps` alone cannot express that (it maps both
 *   "window not due" and "0 B/s" to 0), so `downloadSpeedSampleDue` was split out for the
 *   caller; keeping the old window across a stall divided the next burst by the stall.
 *
 * Group C — DownloadGlassCard.kt
 *   D102-107    progress derivation
 *   D114-121    statusText
 *   D122-125    statusColor role
 *   D253-256    speed text
 *   D269-272    剩余 / 共 line
 *   D332-338    primary action label
 *   D319-323    download controls visible predicate
 *   D360-367    formatSize
 *   D85-100     the 400 ms speed sampler window (`downloadSpeedSampleDue` + `downloadSpeedBps`)
 *
 * Group D — KeywordSearchPreview.kt
 *   K101-110    submitted-count line
 *   K119-124    provider outcome text
 *   K129-130    retry visibility predicate
 *
 * Group E — FormatPickerDialog.kt
 *   F163-171    loading vs. list branch (the `loading` flag is passed straight through)
 *
 * Group F — LibraryViewModel.kt
 *   V51         READER_UNSUPPORTED_FORMATS
 *   V54-55      filterReadableFormats
 */

import type { SearchBook } from '@core/source/searchBook';
import type { NovelInfo } from '@core/source/novelInfo';
import type { DownloadState } from '@core/download/downloadState';
import { lerpColor, luminance as luminanceOfHex } from '@core/glass/color';
import type { LibraryAggregateGroup, LibraryError } from './libraryTypes';

/* ───────────── Group A — LibraryScreen.kt ───────────── */

/** LibraryScreen.kt:2996 `private fun SearchBook.displayFormat(): String`. */
export function displayFormat(book: Pick<SearchBook, 'format' | 'downloadUrl'>): string {
  const raw =
    book.format.trim() === ''
      ? (guessExtensionFromDownloadUrl(book.downloadUrl) ?? '')
      : book.format;
  // Kotlin `raw.uppercase().ifBlank { "EPUB" }` — `ifBlank` folds whitespace-only too.
  const upper = raw.toUpperCase();
  return upper.trim() === '' ? 'EPUB' : upper;
}

/** LibraryScreen.kt:2999-3005 the `format.ifBlank { downloadUrl … }` fallback body. */
function guessExtensionFromDownloadUrl(downloadUrl: string | null): string | null {
  if (downloadUrl === null) return null;
  // Kotlin `downloadUrl?.substringBefore('?')` runs FIRST, then `substringAfterLast('.', "")`.
  const withoutQuery = downloadUrl.split('?')[0] ?? '';
  // Kotlin `substringAfterLast(delimiter, missingDelimiterValue = "")` returns the
  // **empty string** when the delimiter is absent — NOT the whole receiver. Reducing to the
  // whole string here would let a dot-less short URL such as "ab" pass the 2..5
  // alphanumerics test and render "AB" where Android renders the "EPUB" default.
  const dot = withoutQuery.lastIndexOf('.');
  const afterLastDot = dot < 0 ? '' : withoutQuery.slice(dot + 1);
  const lower = afterLastDot.toLowerCase();
  // Kotlin `it.all(Char::isLetterOrDigit)` — Unicode letter/digit, not ASCII-only.
  if (lower.length >= 2 && lower.length <= 5 && /^[\p{L}\p{Nd}]+$/u.test(lower)) {
    if (lower !== 'html' && lower !== 'php') return lower;
  }
  return null;
}

/** LibraryScreen.kt:3014 `private val STAGGER_RATIO_PALETTE`. */
export const STAGGER_RATIO_PALETTE: readonly number[] = [0.62, 0.7, 0.78, 0.9, 3 / 4];

/** LibraryScreen.kt:3017 `private const val AGGREGATE_PREVIEW_COUNT = 6`. */
export const AGGREGATE_PREVIEW_COUNT = 6;

/**
 * LibraryScreen.kt:3020-3024
 * `private fun SearchBook.staggerRatio(): Float` —
 * `val seed = "${sourceId}_$id"; val hash = (seed.hashCode().toLong() and 0x7fffffffL)`.
 */
export function staggerRatio(book: Pick<SearchBook, 'sourceId' | 'id'>): number {
  const seed = `${book.sourceId}_${book.id}`;
  const hash = javaStringHashCode(seed) & 0x7fffffff;
  const palette = STAGGER_RATIO_PALETTE;
  return palette[hash % palette.length] as number;
}

/**
 * LibraryScreen.kt:3359 `java.lang.String.hashCode()` semantics, reusing the shared
 * implementation from `@core/download/downloadWorker` (line 1 of that file declares
 * the same port) so the stable per-book ratio matches the Android build.
 */
function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * LibraryScreen.kt:3336-3347
 * `internal fun aggregateGroupItemCount(group, expanded = false): Int`
 * 每个源组在 StaggeredGrid 占用的 item 数：组头 + (shimmer×4 | 书卡[+展开按钮] | 错误卡)。
 */
export function aggregateGroupItemCount(group: LibraryAggregateGroup, expanded = false): number {
  if (group.books.length > 0) {
    const cards = expanded
      ? group.books.length
      : Math.min(group.books.length, AGGREGATE_PREVIEW_COUNT);
    if (!expanded && group.books.length > AGGREGATE_PREVIEW_COUNT) return cards + 1;
    return cards;
  }
  if (group.loading) return 4;
  return 1;
}

/** LibraryScreen.kt:3350-3361 `internal fun groupHeaderIndex(groups, target, expandedGroups, leadingItems)`. */
export function groupHeaderIndex(
  groups: LibraryAggregateGroup[],
  target: number,
  expandedGroups: Record<string, boolean> = {},
  leadingItems = 0,
): number {
  let index = leadingItems;
  const last = groups.length - 1;
  const clamped = Math.max(0, Math.min(target, last));
  for (let i = 0; i < clamped; i += 1) {
    const group = groups[i] as LibraryAggregateGroup;
    index += 1 + aggregateGroupItemCount(group, expandedGroups[group.sourceId] === true);
  }
  return index;
}

/**
 * LibraryScreen.kt:479-491 `val activeGroupIdx by remember(...) { derivedStateOf { … } }`
 * — which aggregate group the reader is currently looking at.
 */
export function activeAggregateGroupIndex(
  groups: LibraryAggregateGroup[],
  expandedGroups: Record<string, boolean>,
  firstVisibleItemIndex: number,
  keywordPreviewCount: number,
): number {
  if (groups.length === 0) return -1;
  let acc = keywordPreviewCount;
  let result = 0;
  groups.forEach((g, i) => {
    if (firstVisibleItemIndex >= acc) result = i;
    acc += 1 + aggregateGroupItemCount(g, expandedGroups[g.sourceId] === true);
  });
  return result;
}

/**
 * LibraryScreen.kt:363-379 `val headerFractionSource: () -> Float` —
 * progressive header collapse target (0 = fully expanded, 1 = fully collapsed).
 * `headerCollapsePx` is the 150.dp travel; the caller converts px with its own density.
 */
export function headerFraction(
  searchFocusedNow: boolean,
  gridFirstIndex: number,
  listFirstIndex: number,
  gridScrollOffsetPx: number,
  listScrollOffsetPx: number,
  headerCollapsePx: number,
): number {
  if (searchFocusedNow) return 1;
  if (gridFirstIndex > 0 || listFirstIndex > 0) return 1;
  const off = Math.max(gridScrollOffsetPx, listScrollOffsetPx);
  return Math.min(1, Math.max(0, off / headerCollapsePx));
}

/** LibraryScreen.kt:1266-1279 the three-stage header collapse mapping. */
export interface HeaderCollapseMetrics {
  compact: number;
  fade: number;
  collapse: number;
  titleSize: number;
  subAlpha: number;
  subHeight: number;
  outerVertical: number;
  innerVertical: number;
}

/** LibraryScreen.kt:1269-1279 — `fraction` in [0,1] → every derived header metric. */
export function headerCollapseMetrics(fraction: number): HeaderCollapseMetrics {
  const f0 = Math.min(1, Math.max(0, fraction));
  const compact = Math.min(1, Math.max(0, f0 / 0.5));
  const fade = Math.min(1, Math.max(0, (f0 - 0.4) / 0.4));
  const collapse = Math.min(1, Math.max(0, (f0 - 0.6) / 0.4));
  return {
    compact,
    fade,
    collapse,
    titleSize: 24 - 5 * compact,
    subAlpha: Math.min(1, Math.max(0, 1 - f0 / 0.3)),
    subHeight: 20 * Math.min(1, Math.max(0, 1 - f0 / 0.3)),
    outerVertical: 10 * (1 - collapse) * (1 - collapse),
    innerVertical: 12 - 8 * compact,
  };
}

/**
 * LibraryScreen.kt:938-945 the `else -> Triple("请求超时", error.message ?: …)` arm.
 *
 * VERDICT (round-4 audit of the two contradictory tests): Kotlin uses the **elvis**
 * operator, so an **empty but present** message is kept as-is; the fallback only fires for
 * the `InvalidFile` `object` (whose inherited `Exception.message` is `null`).
 * `LibraryError.Unknown.message` is declared a non-nullable `String` (LibraryError.kt:12),
 * so `Unknown("")` can NEVER reach the fallback and must render an empty description.
 * `libraryAuditRound2.test.ts` asserted that correctly and
 * `libraryModule.test.ts`'s `Unknown('') → 网络请求超时，请重试` contradicted it; that
 * assertion was the wrong one and has been corrected (both tests now agree).
 */
function libraryErrorFallbackCopy(message: string | null): {
  title: string;
  description: string;
  action: string;
} {
  return { title: '请求超时', description: message ?? '网络请求超时，请重试', action: '重试' };
}

/** LibraryScreen.kt:2963-2969 BookCoverPlaceholder — title hash → hue. */
export function coverPlaceholderHue(title: string): number {
  const hash = javaStringHashCode(title) & 0x7fffffff;
  return hash % 360;
}

/** LibraryScreen.kt:2966-2968 `Color.hsv(hue, 0.32f, 0.92f)` / `hsv(hue+42, 0.30f, 0.78f)`. */
export function coverPlaceholderGradient(title: string): [string, string] {
  const hue = coverPlaceholderHue(title);
  return [hsvToHex(hue, 0.32, 0.92), hsvToHex((hue + 42) % 360, 0.3, 0.78)];
}

/** `android.graphics.Color.hsv(h, s, v)` → `#RRGGBB`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const byte = (n: number): string =>
    Math.round(Math.min(1, Math.max(0, n + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** LibraryScreen.kt:3067-3072 `StaggeredComicCard`'s `formatBadge`. */
export function comicFormatBadge(
  book: Pick<SearchBook, 'comicId' | 'format'>,
  novel: boolean,
): string {
  const candidates: string[] = [];
  if (book.comicId !== null && book.comicId.trim() !== '') candidates.push(`#${book.comicId}`);
  if (book.format.trim() !== '' && book.format.toLowerCase() !== 'epub') {
    candidates.push(book.format.toUpperCase());
  }
  const first = candidates[0];
  return first !== undefined ? first : novel ? '小说' : '漫画';
}

/** LibraryScreen.kt:2786-2795 the `格式：…` line when the book has no description. */
export function bookCardMetaLine(book: Pick<SearchBook, 'comicId' | 'language'> & {
  format?: string;
  downloadUrl?: string | null;
}): string {
  const extras: string[] = [];
  if (book.comicId !== null && book.comicId.trim() !== '') extras.push(`#${book.comicId}`);
  if (book.language !== null && book.language.trim() !== '') extras.push(book.language);
  const fmt = displayFormat({
    format: book.format ?? '',
    downloadUrl: book.downloadUrl ?? null,
  });
  return extras.length > 0 ? `格式：${fmt} · ${extras.join(' · ')}` : `格式：${fmt}`;
}

/** LibraryScreen.kt:3501-3509 `AggregateSourceError`'s message translation. */
export function aggregateSourceErrorMessage(error: string | null): string {
  const timedOut =
    error !== null &&
    (error.toLowerCase().includes('timeout') ||
      error.toLowerCase().includes('timed out') ||
      error.includes('超时'));
  if (error === null || error.trim() === '') return '无结果';
  if (timedOut) return '链接超时';
  return friendlyJsSourceError(error);
}

/**
 * `com.example.source.js.friendlyJsSourceError(error)` — the JS-source error
 * translator lives in another agent's module; the raw message is surfaced verbatim
 * here and the module-level hook lets the host swap in the shared implementation.
 */
let friendlyErrorHook: ((error: string) => string) | null = null;
export function setFriendlyJsSourceError(hook: ((error: string) => string) | null): void {
  friendlyErrorHook = hook;
}
function friendlyJsSourceError(error: string): string {
  return friendlyErrorHook !== null ? friendlyErrorHook(error) : error;
}

/* ───────────── Group B — NovelBookUi.kt ───────────── */

/** NovelBookUi.kt:117-124 `val downloadLabel = when (state) { … }`. */
export function novelDownloadLabel(
  state: DownloadState,
  downloaded: boolean,
): string {
  switch (state.kind) {
    case 'Success':
      return '已在书架 · 离线阅读';
    case 'Downloading':
      return `整本下载 ${String(Math.trunc(state.progress * 100))}%`;
    case 'Pending':
      return '正在准备整本下载';
    case 'Paused':
      return '整本下载已暂停';
    case 'Error':
      return downloaded ? '可读离线版本 · 更新下载失败' : '下载失败 · 点开重试';
    default:
      return downloaded ? '已在书架 · 离线阅读' : '查看详情 · 整本下载';
  }
}

/** NovelBookUi.kt:147-150 `val facts = listOfNotNull(…)` — 6 label/value pairs. */
export function novelDetailFacts(
  book: Pick<SearchBook, 'size'>,
  info: NovelInfo | null,
): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (info !== null) {
    if (info.wordCount != null) facts.push(['字数', info.wordCount]);
    if (info.chapterCount != null) facts.push(['源站目录', `${String(info.chapterCount)} 章`]);
    if (info.volumeCount != null) facts.push(['收录卷数', `${String(info.volumeCount)} 卷`]);
  }
  if (book.size != null) {
    facts.push(['下载大小', `${(book.size / 1024 / 1024).toFixed(1)} MB`]);
  }
  if (info !== null) {
    if (info.publisher != null) facts.push(['出版社', info.publisher]);
    if (info.translation != null) facts.push(['阅读版本', info.translation]);
  }
  return facts;
}

/** NovelBookUi.kt:153-159 `facts.chunked(2).forEach { row -> … }` + the trailing Spacer. */
export function chunkFactsIntoRows(
  facts: Array<[string, string]>,
): Array<Array<[string, string]>> {
  const rows: Array<Array<[string, string]>> = [];
  for (let i = 0; i < facts.length; i += 2) {
    rows.push(facts.slice(i, i + 2));
  }
  return rows;
}

/**
 * NovelBookUi.kt:35-40 `private fun novelAccentColor(): Color`
 * `if (surface.luminance() < .3f) lerp(primary, Color.White, .35f) else lerp(primary, Color.Black, .18f)`.
 *
 * `lerp` here is Compose's `androidx.compose.ui.graphics.lerp(Color, Color, Float)`, i.e. a
 * per-channel interpolation of the **sRGB-encoded** 0..1 components (the lerp happens
 * before `luminance()`'s sRGB linearisation), which is exactly `lerpColor(a, b, t)`.
 */
export function novelAccentColor(primary: string, surface: string): string {
  return luminanceOfHex(surface) < 0.3
    ? lerpColor(primary, '#FFFFFF', 0.35)
    : lerpColor(primary, '#000000', 0.18);
}

/**
 * NovelBookUi.kt:42-47 `internal fun novelActionColors(): ButtonColors`
 * `val background = lerp(primary, Color.Black, .12f)` then
 * `contentColor = if (background.luminance() > .179f) Color(0xFF111111) else Color.White`.
 */
export function novelActionColors(primary: string): { container: string; content: string } {
  const background = lerpColor(primary, '#000000', 0.12);
  return {
    container: background,
    content: luminanceOfHex(background) > 0.179 ? '#111111' : '#FFFFFF',
  };
}

/** NovelBookUi.kt:104 `listOfNotNull(author.takeIf(String::isNotBlank), sourceName).joinToString(" · ")`. */
export function novelAuthorLine(book: Pick<SearchBook, 'author'>, sourceName: string): string {
  const parts: string[] = [];
  if (book.author.trim() !== '') parts.push(book.author);
  parts.push(sourceName);
  return parts.join(' · ');
}

/** NovelBookUi.kt:106 `NovelLabels(listOfNotNull(status, category, translation ?: language, format.uppercase()))`. */
export function novelSearchLabels(
  book: Pick<SearchBook, 'language' | 'format'>,
  info: NovelInfo | null,
): string[] {
  const out: string[] = [];
  if (info !== null) {
    if (info.status != null) out.push(info.status);
    if (info.category != null) out.push(info.category);
  }
  // Kotlin `info?.translation ?: book.language` is evaluated OUTSIDE the `info?.` guard, so a
  // `null` novelInfo still falls back to the search-result language. Mirrored exactly.
  if (info !== null && info.translation != null) out.push(info.translation);
  else if (book.language != null) out.push(book.language);
  out.push(book.format.toUpperCase());
  return out;
}

/** NovelBookUi.kt:115-116 `val facts = listOfNotNull(wordCount, "$it 卷", "$it 章")`. */
export function novelSearchFacts(info: NovelInfo | null): string[] {
  if (info === null) return [];
  const facts: string[] = [];
  if (info.wordCount != null) facts.push(info.wordCount);
  if (info.volumeCount != null) facts.push(`${String(info.volumeCount)} 卷`);
  if (info.chapterCount != null) facts.push(`${String(info.chapterCount)} 章`);
  return facts;
}

/** NovelBookUi.kt:142 `NovelLabels(listOfNotNull(status, category, format.uppercase(), language))`. */
export function novelDetailLabels(book: Pick<SearchBook, 'format' | 'language'>, info: NovelInfo | null): string[] {
  const out: string[] = [];
  if (info !== null) {
    if (info.status != null) out.push(info.status);
    if (info.category != null) out.push(info.category);
  }
  out.push(book.format.toUpperCase());
  if (book.language != null) out.push(book.language);
  return out;
}

/** NovelBookUi.kt:244 `Text(when (update.changed) { true … false … null … })`. */
export function novelUpdateHeadline(changed: boolean | null): string {
  if (changed === true) return '源站信息有更新';
  if (changed === false) return '源站信息未变化';
  return '已获取源站当前信息';
}

/** NovelBookUi.kt:254 `state.path != update.local.filePath.removePrefix("file://")`. */
export function novelUpdateNewFileStored(
  state: DownloadState,
  localFilePath: string,
): boolean {
  if (state.kind !== 'Success') return false;
  const local = localFilePath.startsWith('file://')
    ? localFilePath.slice('file://'.length)
    : localFilePath;
  return state.path !== local;
}

/** NovelBookUi.kt:280-282 `NovelUpdatePanel`'s stale-local guard. */
export function novelUpdatePanelIsStale(
  localBookId: number | null,
  updateLocalId: number,
): boolean {
  return localBookId !== updateLocalId;
}

/* ───────────── Group C — DownloadGlassCard.kt ───────────── */

/** DownloadGlassCard.kt:102-107 `val progress = when (state) { … }`. */
export function downloadCardProgress(state: DownloadState): number {
  switch (state.kind) {
    case 'Downloading':
      return Math.min(1, Math.max(0, state.progress));
    case 'Paused':
      return Math.min(
        1,
        Math.max(0, state.downloadedBytes / (state.totalBytes > 0 ? state.totalBytes : 1)),
      );
    case 'Success':
      return 1;
    default:
      return 0;
  }
}

/** DownloadGlassCard.kt:114-121 `val statusText = when (state) { … }`. */
export function downloadCardStatusText(state: DownloadState): string {
  switch (state.kind) {
    case 'Pending':
      return '等待下载…';
    case 'Downloading':
      return '下载中';
    case 'Paused':
      return '已暂停';
    case 'Success':
      return '下载完成';
    case 'Error':
      return '下载失败';
    default:
      return '';
  }
}

/** DownloadGlassCard.kt:122-125 `val statusColor` — error vs. secondary. */
export function downloadCardStatusRole(state: DownloadState): 'error' | 'secondary' {
  return state.kind === 'Error' ? 'error' : 'secondary';
}

/** DownloadGlassCard.kt:253-256 `val speedText = if (speedBps > 0) … else "计算速度…"`. */
export function downloadCardSpeedText(speedBps: number): string {
  return speedBps > 0 ? `${formatSize(speedBps)}/s` : '计算速度…';
}

/** DownloadGlassCard.kt:269-272 `"剩余 ${formatSize(remaining)} / 共 ${formatSize(total)}"`. */
export function downloadCardRemainingLine(state: DownloadState): string {
  if (state.kind !== 'Downloading') return '';
  const remaining = state.totalBytes - state.downloadedBytes;
  return `剩余 ${formatSize(remaining)} / 共 ${formatSize(state.totalBytes)}`;
}

/** DownloadGlassCard.kt:319-323 the "download controls visible" predicate. */
export function downloadCardShowsControls(state: DownloadState): boolean {
  return (
    state.kind === 'Pending' ||
    state.kind === 'Downloading' ||
    state.kind === 'Paused' ||
    state.kind === 'Error'
  );
}

/** DownloadGlassCard.kt:332-338 `text = when (state) { … }` for the primary action. */
export function downloadCardPrimaryLabel(state: DownloadState): string {
  if (state.kind === 'Paused') return '继续下载';
  if (state.kind === 'Error') return '重试';
  return '暂停';
}

/**
 * DownloadGlassCard.kt:88-94 — is the sampling window due?
 *
 * Kotlin updates `lastBytes` / `lastTime` on **every** pass where `dt > 400`, including the
 * one that measures 0 B/s (a stalled transfer). A caller that instead kept the old window
 * whenever the computed speed was 0 would divide the *next* burst by the whole stall
 * duration, under-reporting the rate after every pause. `downloadSpeedBps` alone cannot
 * express this because it collapses both cases to "no sample".
 */
export function downloadSpeedSampleDue(lastBytes: number, lastTime: number, now: number): boolean {
  if (lastBytes < 0 || lastTime <= 0) return false;
  return now - lastTime > 400;
}

/** DownloadGlassCard.kt:85-100 the speed sampler (400 ms minimum window, clamped ≥0). */
export function downloadSpeedBps(
  downloadedBytes: number,
  lastBytes: number,
  lastTime: number,
  now: number,
): number {
  if (downloadSpeedSampleDue(lastBytes, lastTime, now)) {
    const dt = now - lastTime;
    return Math.max(0, Math.floor(((downloadedBytes - lastBytes) * 1000) / dt));
  }
  return 0;
}

/** DownloadGlassCard.kt:360-367 `private fun formatSize(bytes: Long): String`. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/* ───────────── Group D — KeywordSearchPreview.kt ───────────── */

/** KeywordSearchPreview.kt:108-110 `"${origins[key] ?: "扩展名称"} · " + …`. */
export function keywordSubmittedLine(
  origin: string | null,
  submittedCount: number,
): string {
  const prefix = `${origin ?? '扩展名称'} · `;
  return submittedCount === 0
    ? `${prefix}等待提交`
    : `${prefix}已提交 ${String(submittedCount)} 个书源`;
}

/** KeywordSearchPreview.kt:119-124 `val outcome = when (state.outcome) { … }`. */
export function keywordProviderOutcome(outcome: string, detail: string): string {
  switch (outcome) {
    case 'found':
      return '已找到名称';
    case 'empty':
      return '未收录匹配名称';
    case 'ambiguous':
      return '存在同名，未自动采用';
    default:
      return detail.trim() === '' ? '查询失败，请稍后重试' : detail;
  }
}

/** KeywordSearchPreview.kt:129-130 the "重新查词" button visibility predicate. */
export function keywordRetryVisible(status: string): boolean {
  return (
    !status.startsWith('正在') &&
    (status.includes('失败') || status.includes('超时') || status.startsWith('未找到更多'))
  );
}

/** KeywordSearchPreview.kt:80 the status colour predicate. */
export function keywordStatusIsBusy(status: string): boolean {
  return status.startsWith('正在');
}

/* ───────────── Group E — FormatPickerDialog.kt ───────────── */

/** FormatPickerDialog.kt:149-174 — the loading branch replaces the format list. */
export function formatPickerShowsList(loading: boolean): boolean {
  return !loading;
}

/* ───────────── Group F — LibraryViewModel.kt ───────────── */

/**
 * LibraryViewModel.kt:48-51
 * 阅读器无法打开的格式（与 BookRepository.unsupportedBinaryExtensions 对齐）：
 * PDF 不拦——下载后由 ComicParser 逐页位图渲染，以翻页模式打开；
 * KFX/DJVU/DOC/RTF/CHM 无任何阅读管线，下载前拦截。
 */
export const READER_UNSUPPORTED_FORMATS: ReadonlySet<string> = new Set([
  'kfx',
  'djvu',
  'doc',
  'rtf',
  'chm',
]);

/** LibraryViewModel.kt:53-55 `internal fun filterReadableFormats(formats)`. */
export function filterReadableFormats<T extends { format: string }>(formats: T[]): T[] {
  return formats.filter((it) => !READER_UNSUPPORTED_FORMATS.has(it.format.trim().toLowerCase()));
}

/** LibraryViewModel.kt:1153-1156 the "unsupported final format" refusal message. */
export function unsupportedFormatMessage(finalFormat: string): string {
  return `该书文件为 ${finalFormat.toUpperCase()} 格式，App 内暂不支持阅读，请换其他版本`;
}

/** LibraryViewModel.kt:1109-1112 the "every format unsupported" refusal message. */
export function allFormatsUnsupportedMessage(formats: Array<{ format: string }>): string {
  return `该书仅有 ${formats.map((it) => it.format.toUpperCase()).join(' / ')} 格式，App 内暂不支持阅读，请换其他版本`;
}

/* ───────────── LibraryScreen.kt — search error state copy ───────────── */

/** LibraryScreen.kt:937-946 the `Triple(title, description, action)` per LibraryError branch. */
export function libraryErrorCopy(
  error: LibraryError,
): { title: string; description: string; action: string } {
  switch (error.kind) {
    case 'NetworkUnavailable':
      return { title: '无网络连接', description: '请检查网络设置后重试', action: '重试' };
    // v1.0.1：网络失败展示真实原因（HTTP 状态码 / DNS / TLS / 超时），便于排查
    case 'NetworkDetail':
      return { title: '请求失败', description: error.message, action: '重试' };
    case 'SourceUnavailable':
      return {
        title: '服务无响应',
        description: '当前书源站点暂无响应，请稍后重试或切换书源',
        action: '重试',
      };
    case 'AuthenticationRequired':
      return { title: '需要登录', description: '当前书源需要账号身份验证', action: '去登录' };
    case 'CloudflareBlocked':
      return { title: '安全验证拦截', description: '目标站点已启用安全防护，请稍后重试', action: '重试' };
    case 'ParseFailed':
      return {
        title: '数据解析失败',
        description: '返回数据格式异常，无法解析内容',
        action: '重试',
      };
    case 'Unknown':
      return libraryErrorFallbackCopy(error.message);
    default:
      // `InvalidFile` is the only remaining branch; it is an `object` singleton in Kotlin,
      // so `Exception.message` is `null` and the elvis fallback applies.
      return libraryErrorFallbackCopy(null);
  }
}

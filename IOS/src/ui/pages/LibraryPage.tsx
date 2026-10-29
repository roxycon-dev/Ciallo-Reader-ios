/**
 * LibraryPage — React port of Android `com.example.library.LibraryScreen.kt`
 * (3535 lines, 3441 non-blank) plus every dialog/composable it hosts:
 *   LibraryCollapsingHeader.kt portion (L1242-1333)
 *   UnifiedSearchField.kt portion (L1342-1514)
 *   SearchHistoryPanel / HistoryChips / HistoryChip (L1525-1833)
 *   SourcePickerSheet / SourceSheetDivider / SourceSectionLabel /
 *   AggregateOptionItem / SourceOptionItem (L1837-2305)
 *   ComicDownloadGlassCard / ComicDownloadTaskRow (L2308-2480)
 *   LibraryWelcomeScreen (L2483-2628)
 *   rememberCoverHeaders (L2631-2643) · SearchResultFavoriteButton (L2651-2690)
 *   LibraryBookCard (L2693-2958) · BookCoverPlaceholder (L2961-2994)
 *   displayFormat (L2996-3008) · STAGGER_RATIO_PALETTE (L3014) ·
 *   AGGREGATE_PREVIEW_COUNT (L3017) · staggerRatio (L3020-3024)
 *   StaggeredComicCard (L3027-3201) · AggregateSourceHeader (L3204-3276)
 *   AggregateExpandButton (L3283-3330) · aggregateGroupItemCount (L3336-3347)
 *   groupHeaderIndex (L3350-3361) · AggregateJumpSheet (L3369-3494)
 *   AggregateSourceError (L3497-3535)
 * and the standalone Compose files it renders:
 *   NovelBookUi.kt (288 lines, 232 non-blank) → NovelCover / NovelLabels /
 *     NovelSearchCard / NovelDetailContent / NovelDetailSheet / NovelUpdateSheet
 *   DownloadGlassCard.kt (367, 281 non-blank)
 *   FormatPickerDialog.kt (232, 172 non-blank)
 *   LibraryLoginDialog.kt (265, 205 non-blank)
 *   KeywordSearchPreview.kt (160, 118 non-blank)
 *
 * Pure logic (the numbers/strings each of those composables renders) lives in
 * `@core/library/libraryDisplay` so it is unit-testable without React; the state and
 * side effects live in `@core/library/libraryViewModel`.
 *
 * Platform adaptations (see the report for the full list):
 * - Compose `collectAsStateWithLifecycle()` on a `StateFlow` →
 *   `useSyncExternalStore` over `MutableValue.subscribe` (Room DAO Flow →
 *   async getter + listener registry, the pattern from `favoriteRepository.ts`).
 * - `LaunchedEffect(key) { … }` → `useEffect(..., [key])`;
 *   `DisposableEffect` → the effect's cleanup function.
 * - `remember { mutableStateOf(x) }` → `useState(() => x)` (lazy init, so
 *   `Math.random()`/`Date.now()` never run during render).
 * - `derivedStateOf` → `useMemo`.
 * - Coil `SubcomposeAsyncImage` / `AsyncImage` → `<img>` with an `onError` fallback that
 *   swaps in `BookCoverPlaceholder`.
 * - LibraryScreen.kt:226-233 `val imageLoader = remember(aggregateMode, currentSource?.id)
 *   { if (aggregateMode || currentSource?.id != "zlibrary") GenericCoverLoader.get(context)
 *   else ZLibraryCoverLoader.get(context) }` — SKIPPED. There is no Coil `ImageLoader` on
 *   the web; `GenericCoverLoader.kt` (45 non-blank lines) is an `okhttp3` + `coil`
 *   factory whose interceptor (10 s connect / 15 s read / HTTP_1_1 / a default Chrome UA
 *   / same-origin `JsCookieJar` cookie) belongs to the shared HTTP transport
 *   (`com.example.source.SharedHttpTransport` + `JsSourceProxy.failoverClient`), which is
 *   another agent's module — re-implementing it here would create a second HTTP stack.
 *   `ZLibraryCoverLoader` is likewise owned by the Z-Library module. The
 *   `aggregateMode || id != "zlibrary"` *decision* is preserved: covers are fetched
 *   directly by URL and per-source `Referer`/cookie policy is the fetch layer's job
 *   (see `libraryImageBytes.ts` and `rememberCoverHeaders` below).
 * - `LazyVerticalStaggeredGrid` / `LazyColumn` → CSS grid / flex with `content-visibility`
 *   so off-screen cards stay cheap.
 * - Compose `haze`/`liquidGlass`/`consistentShadow`/`filmGrain`/`iridescentBorder`/
 *   `ChasingDots`/`MascotEmptyState`/`SourceAvatar`/`PlayPauseMorphButton`/
 *   `AppActionButton`/`GlassKitCard` → the classes in `../../styles/library.css`.
 * - `BackHandler(enabled = editing)` → the panel's own close button + Esc key.
 * - `ZLibraryNativeSession` / `ZLibraryCoverLoader` / `ZLibraryLoginDialog` /
 *   `ZLibraryNodeConfig` / `LibraryLoginDialog`'s `ZLibraryNodeConfig.domain` — owned by
 *   the Z-Library module (another agent); those call sites are declared as props
 *   (`loginPort`, `registerUrl`) so no ZLibrary file is touched here.
 * - `MascotSpriteSheet` drawables → inline SVG glyphs (no bitmap assets in the web port).
 *
 * Line-by-line audit fixes (2026-10-06):
 * - `CoverImage` set `crossorigin="anonymous"` whenever the `headers` prop was *present*.
 *   LibraryScreen.kt:2727-2734 / :3105-3111 only build an `ImageRequest` (and therefore only
 *   need CORS) when `coverHeaders.isNotEmpty()`; with the always-`{}` port the old code sent
 *   every cover as a CORS request, so any CDN without `Access-Control-Allow-Origin` failed
 *   and fell back to the placeholder. Now keyed on a **non-empty** header map.
 * - LibraryScreen.kt:1182 `visibleSources.filter { it.isComicSource }` was
 *   `!isNovelSource(it)`, which also swept plain book sources (neither comic nor novel)
 *   into the "漫画源" section.
 * - LibraryScreen.kt:785-786 the aggregate-grid `NovelSearchCard` was rendered with a hard
 *   `DownloadStateIdle` / `downloaded=false`, so the download label never reflected the real
 *   state. Now wired to `downloadStateOf` / `downloadedNovelKeys` like the single-source list.
 * - NovelBookUi.kt:162 `!info?.latestChapter.isNullOrBlank() || !info?.updatedAt.isNullOrBlank()`
 *   is a **blank** test, not a null test — a whitespace-only value must not open the
 *   "连载进度" block.
 * - NovelBookUi.kt:240-268 the `when (state)` download-action block lives inside the
 *   `else ->` arm of `when { loading / error / else }`; the port rendered those buttons
 *   during a running or failed update check.
 * - LibraryScreen.kt:922-934 the searching branch is a bare `ChasingDots(size = 52.dp)` with
 *   no copy. The port had invented "正在搜索… / 正在向书源发起检索，请稍候" — EXTRA, removed.
 * - LibraryScreen.kt:1029-1031 (result card) and :1092-1093 (novel detail sheet) raise the
 *   login dialog when `capabilities.downloadRequiresLogin && !isLoggedIn()` instead of
 *   queueing the download. Restored behind the `LibraryRuntime.openZLibraryLoginDialog` seam
 *   (`ZLibraryLoginDialog` belongs to the Z-Library module).
 * - LibraryScreen.kt:897-909 the 源速跳 sheet scrolled to `groupHeaderIndex(groups, idx, …)`
 *   and kept re-aligning via `pendingJumpSourceId` until the target group stopped loading;
 *   the port always jumped back to the top. Restored with `data-agg-group` anchors.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { BookSource } from '@core/source/bookSource';
import type { SearchBook } from '@core/source/searchBook';
import type { NovelInfo } from '@core/source/novelInfo';
import type { BookFormat } from '@core/source/bookFormat';
import { createLoginCredential } from '@core/source/loginCredential';
import type { DownloadState } from '@core/download/downloadState';
import { DownloadStateIdle } from '@core/download/downloadState';
import { isComicSource, isNovelSource } from '@core/source/sourceCapabilities';
import {
  AGGREGATE_PREVIEW_COUNT,
  STAGGER_RATIO_PALETTE,
  activeAggregateGroupIndex,
  aggregateSourceErrorMessage,
  bookCardMetaLine,
  chunkFactsIntoRows,
  comicFormatBadge,
  coverPlaceholderGradient,
  displayFormat,
  downloadCardPrimaryLabel,
  downloadCardProgress,
  downloadCardRemainingLine,
  downloadCardShowsControls,
  downloadCardSpeedText,
  downloadCardStatusRole,
  downloadCardStatusText,
  downloadSpeedBps,
  downloadSpeedSampleDue,
  headerCollapseMetrics,
  headerFraction,
  keywordProviderOutcome,
  keywordRetryVisible,
  keywordStatusIsBusy,
  keywordSubmittedLine,
  libraryErrorCopy,
  novelAuthorLine,
  novelDetailFacts,
  novelDetailLabels,
  novelDownloadLabel,
  novelSearchFacts,
  novelSearchLabels,
  novelUpdateHeadline,
  novelUpdateNewFileStored,
  type HeaderCollapseMetrics,
} from '@core/library/libraryDisplay';
import {
  keywordProviderDisplayName,
  LibraryViewModel,
  type LibraryNovelUpdate,
  type MutableValue,
} from '@core/library/libraryViewModel';
import type { LibraryAggregateGroup } from '@core/library/libraryTypes';
import type { LibraryRuntime } from '@core/library/libraryRuntime';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import type { ComicDownloadTask } from '@core/library/libraryComicDownload';
import { ReadingRecordMetadata } from '@core/library/libraryReadingRecords';
import { useAppStore } from '@ui/state/appStore';
import { useFavoriteVisibility } from '@ui/hooks/useFavoriteVisibility';
// E50：shared-element 转场的 key 工厂（对应 Kotlin `rememberSharedContentState`）。
import { bookCoverKey } from '@ui/shared/viewTransitions';
import { showToast } from '@ui/toast';
import { openExternalUrl } from '@ui/lib/openExternalUrl';
import { openOnlineBook } from '@ui/lib/openOnlineBook';
import { scrollElementIntoView } from '@ui/lib/scroll';
import '../../styles/library.css';

/**
 * LibraryLoginDialog.kt:243 `val url = "https://${ZLibraryNodeConfig.domain}/registration"`.
 * `ZLibraryNodeConfig` belongs to the Z-Library module (another agent), so the node
 * host is a module constant here and `ZLibraryNodeConfig.domain` can be wired in by
 * the Z-Library module through `setLibraryRuntime().viewModel`'s `zlibraryNodeDomain`
 * hook (see `LibraryViewModelDeps`).
 */
const Z_LIBRARY_REGISTRATION_URL = 'https://z-library.sk/registration';

/**
 * NovelBookUi.kt:284
 * `val taskId = DownloadManager.taskId(local.sourceId.orEmpty(), local.comicId.orEmpty())`.
 */
function novelUpdateTaskKey(
  update: LibraryNovelUpdate,
): string | null {
  const sourceId = update.local.sourceId;
  const comicId = update.local.comicId;
  if (sourceId === null || comicId === null) return null;
  return `v2:${String(sourceId.length)}:${sourceId}${comicId}`;
}

/** NovelBookUi.kt:285 `states[taskId] ?: DownloadState.Idle`. */
function novelUpdateDownloadState(
  update: LibraryNovelUpdate,
  states: Map<string, DownloadState>,
): DownloadState {
  const key = novelUpdateTaskKey(update);
  return key === null ? DownloadStateIdle : (states.get(key) ?? DownloadStateIdle);
}

/* ─────────────── Kotlin L342 `150.dp.toPx()` at 1px = 1dp reference ─────────────── */

/** LibraryScreen.kt:342 `val headerCollapsePx = with(LocalDensity.current) { 150.dp.toPx() }`. */
const HEADER_COLLAPSE_PX = 150;

/** LibraryScreen.kt:120/1760 search history cap (`history.take(10)`, `take(20)`). */
const HISTORY_CHIP_LIMIT = 10;

/** LibraryScreen.kt:2351 `tasks.take(4)` in ComicDownloadGlassCard. */
const COMIC_TASK_PREVIEW_LIMIT = 4;

/** LibraryScreen.kt:299/313/683 history-panel settle delay (ms). */
const HISTORY_SETTLE_MS = 330;

/** LibraryScreen.kt:313/296 download timeout hint / login probe delay (ms). */
const DOWNLOAD_HINT_MS = 15_000;
const LOGIN_PROBE_MS = 1_200;

/** LibraryScreen.kt:354 header restore delay after blur (ms). */
const HEADER_RESTORE_MS = 120;

/* ─────────────── StateFlow bridge ─────────────── */

/** `collectAsStateWithLifecycle()` over a `MutableValue` (StateFlow port). */
function useFlow<T>(cell: MutableValue<T>): T {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => cell.subscribe(onChange), [cell]),
    useCallback(() => cell.value, [cell]),
    useCallback(() => cell.value, [cell]),
  );
}

/* ─────────────── Material icon glyphs (Icons.Default.*) ─────────────── */

/** Kotlin `String?.isNullOrBlank()` — null, empty and whitespace-only are all "blank". */
function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function IconArrowDropDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

function IconArrowUpward() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z" />
    </svg>
  );
}

function IconCheckCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z" />
    </svg>
  );
}

function IconErrorOutline() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 17h2v-6h-2zm1-15a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM11 9h2V7h-2z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19h4V5H6zm8-14v14h4V5z" />
    </svg>
  );
}

function IconPlayArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconTranslate() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.87 15.07 10.33 12.56l.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2zm-2.62 7 1.62-4.33L19.12 17z" />
    </svg>
  );
}

function IconFavorite(props: { filled: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"
        fill={props.filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IconMenuBook() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-3.8.4-5.5 1.5-1.7-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 3.8.4 5.5 1.5 1.7-1.1 3.55-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-.75zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.45.15 3.5.5v11.5z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z" />
    </svg>
  );
}

function IconTune() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 17v2h6v-2zM3 5v2h10V5zm10 16v-2h8v-2h-8v-2h-2v6zM7 9v2H3v2h4v2h2V9zm14 4v-2H11v2zm-6-4h2V7h4V5h-4V3h-2z" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM9 8V6a3 3 0 0 1 6 0v2z" />
    </svg>
  );
}

function IconDelete() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z" />
    </svg>
  );
}

function IconUnfoldMore() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
    </svg>
  );
}

function IconKeyboardArrowDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </svg>
  );
}

function IconExpandLess() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
    </svg>
  );
}

function IconExpandMore() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z" />
    </svg>
  );
}

/** ChasingDots.kt (LibraryScreen.kt:930 / 3237 / 3461). */
function ChasingDots(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <span className="lib-chasing" aria-hidden="true" style={{ gap: size / 6 }}>
      <span className="lib-chasing__dot" style={{ width: size / 3, height: size / 3 }} />
      <span className="lib-chasing__dot" style={{ width: size / 3, height: size / 3 }} />
      <span className="lib-chasing__dot" style={{ width: size / 3, height: size / 3 }} />
    </span>
  );
}

/** SourceAvatar.kt — hash-coloured initial disc. */
function SourceAvatar(props: { sourceId: string; sourceName: string; size: 16 | 24 | 28 | 32 }) {
  const [from, to] = useMemo(
    () => coverPlaceholderGradient(`${props.sourceId}|${props.sourceName}`),
    [props.sourceId, props.sourceName],
  );
  const initial = props.sourceName.trim().charAt(0).toUpperCase();
  return (
    <span
      className={`lib-avatar lib-avatar--${String(props.size)}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden="true"
    >
      {initial === '' ? '书' : initial}
    </span>
  );
}

/* ─────────────── BookCoverPlaceholder (LibraryScreen.kt:2961-2994) ─────────────── */

function BookCoverPlaceholder(props: { title: string; format: string }) {
  const [from, to] = useMemo(() => coverPlaceholderGradient(props.title), [props.title]);
  // LibraryScreen.kt:2980 `book.title.trim().firstOrNull()?.uppercase() ?: "书"`
  const trimmed = props.title.trim();
  const glyph = (trimmed.charAt(0).toUpperCase() || '书') as string;
  return (
    <span
      className="lib-cover-placeholder"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    >
      <p className="lib-cover-placeholder__glyph">{glyph}</p>
      <p className="lib-cover-placeholder__format">{props.format}</p>
    </span>
  );
}

/**
 * Coil `SubcomposeAsyncImage(model, …) { if (success) Content() else Placeholder() }`
 * → `<img>` with an `onError` fallback (the Coil state machine's success/error arms).
 */
function CoverImage(props: {
  src: string | null;
  alt: string;
  title: string;
  format: string;
  className?: string;
  headers?: Record<string, string>;
}) {
  const [failed, setFailed] = useState(false);
  // LibraryScreen.kt:2727-2734 / :3105-3111 `val coverModel = if (coverHeaders.isEmpty()) book.cover
  // else ImageRequest.Builder(…).addHeader(…)` — only the header-carrying arm needs a CORS
  // request, and `<img crossorigin>` makes a same-origin-only response FAIL to load, which
  // would swap in the placeholder for every cover that has no headers (the common case).
  const crossOrigin = useMemo(
    () => (props.headers !== undefined && Object.keys(props.headers).length > 0 ? 'anonymous' : undefined),
    [props.headers],
  );
  // Coil `remember(context, book.cover, book.sourceId)` — the load is restarted when the
  // source URL changes; `key` on the <img> gives the same semantics.
  if (props.src === null || props.src.trim() === '' || failed) {
    return <BookCoverPlaceholder title={props.title} format={props.format} />;
  }
  return (
    <img
      key={props.src}
      className={props.className}
      src={props.src}
      alt={props.alt}
      crossOrigin={crossOrigin}
      referrerPolicy="no-referrer"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/* ─────────────── LibraryCollapsingHeader (LibraryScreen.kt:1242-1333) ─────────────── */

function LibraryCollapsingHeader(props: {
  fraction: number;
  focusDriven: boolean;
  title: string;
  subtitle: string | null;
  titleColor: string;
  trailing?: ReactNode;
}) {
  const m: HeaderCollapseMetrics = useMemo(
    () => headerCollapseMetrics(props.fraction),
    [props.fraction],
  );
  return (
    <div className="lib-header-slot">
      <header
        className={props.focusDriven ? 'lib-header lib-header--focus' : 'lib-header'}
        style={{
          // L1290: height = placeable.height * (1 - collapse); padding scaled by (1-collapse)²
          maxHeight: `${String(Math.round(112 * (1 - m.collapse)))}px`,
          height: `${String(Math.round(112 * (1 - m.collapse)))}px`,
          paddingTop: `${String(m.outerVertical)}px`,
          paddingBottom: `${String(m.outerVertical)}px`,
          opacity: 1 - m.fade,
        }}
      >
        <div
          className="lib-header__text"
          style={{ paddingTop: `${String(m.innerVertical)}px`, paddingBottom: `${String(m.innerVertical)}px` }}
        >
          <p className="lib-header__title" style={{ fontSize: `${String(m.titleSize)}px`, color: props.titleColor }}>
            {props.title}
          </p>
          {props.subtitle !== null ? (
            <p className="lib-header__subtitle" style={{ height: `${String(m.subHeight)}px`, opacity: m.subAlpha }}>
              {props.subtitle}
            </p>
          ) : null}
        </div>
        {props.trailing !== undefined ? <div className="lib-header__trailing">{props.trailing}</div> : null}
      </header>
    </div>
  );
}

/* ─────────────── UnifiedSearchField (LibraryScreen.kt:1342-1492) ─────────────── */

function UnifiedSearchField(props: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onFocusChanged: (focused: boolean) => void;
  onSourceClick: () => void;
  sourceLabel: string;
  searchFocused: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="lib-search-wrap">
      <div className={props.searchFocused ? 'lib-search lib-search--focused' : 'lib-search'}>
        <button type="button" className="lib-search__source" onClick={props.onSourceClick}>
          <span className="lib-search__source-label">{props.sourceLabel}</span>
          <IconArrowDropDown />
        </button>
        <span className="lib-search__divider" aria-hidden="true" />
        <input
          ref={inputRef}
          className="lib-search__input"
          value={props.query}
          placeholder="搜索书名或作者"
          aria-label="搜索书名或作者"
          onChange={(event) => {
            props.onQueryChange(event.target.value);
          }}
          onFocus={() => {
            props.onFocusChanged(true);
          }}
          onBlur={() => {
            props.onFocusChanged(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onSearch();
              inputRef.current?.blur();
            }
          }}
        />
        {props.query.trim() !== '' ? (
          <button
            type="button"
            className="lib-icon-button lib-icon-button--sm lib-search__clear"
            aria-label="清空"
            onClick={() => {
              props.onQueryChange('');
            }}
          >
            <IconClose />
          </button>
        ) : (
          <span style={{ width: 4 }} />
        )}
        <button type="button" className="lib-search__go" aria-label="搜索" onClick={props.onSearch}>
          <IconSearch />
        </button>
      </div>
    </div>
  );
}

/* ─────────────── SearchHistoryPanel (LibraryScreen.kt:1525-1659) ─────────────── */

function SearchHistoryPanel(props: {
  history: string[];
  /** L1531 `lightweight: Boolean` — blur-only while the expand animation runs. */
  onPick: (query: string) => void;
  onDelete: (query: string) => void;
  onClearAll: () => void;
}) {
  // L1536-1538: editing / expanded / confirmClear
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // L682-690 `historyPanelSettled`: the blur is deferred until the expand animation
  // settles. The panel only exists while visible, so the state resets on unmount and
  // only the timer write has to happen here.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(true);
    }, HISTORY_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  // L1560 `val items = history.take(10)`
  const items = useMemo(() => props.history.slice(0, HISTORY_CHIP_LIMIT), [props.history]);

  return (
    <div className="lib-history" data-settled={settled} data-testid="search_history_panel">
      <div className="lib-history__head">
        <p className="lib-history__title">搜索历史</p>
        <button
          type="button"
          className="lib-history__clear"
          onClick={() => {
            setConfirmClear(true);
          }}
        >
          <IconDelete />
          清空
        </button>
      </div>
      <div
        className="lib-history__chips"
        onClick={() => {
          setEditing(false);
        }}
      >
        {items.map((query, index) =>
          index < HISTORY_CHIP_LIMIT && !expanded && index === HISTORY_CHIP_LIMIT - 1 &&
          items.length > HISTORY_CHIP_LIMIT ? (
            <button
              key={`more-${query}`}
              type="button"
              className="lib-chip lib-chip--muted"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
              }}
            >
              更多 ⌄
            </button>
          ) : (
            <HistoryChip
              key={query}
              text={query}
              editing={editing}
              onPick={() => {
                props.onPick(query);
              }}
              onDelete={() => {
                props.onDelete(query);
              }}
              onEnterEdit={() => {
                setEditing(true);
              }}
            />
          ),
        )}
        {!expanded && items.length <= HISTORY_CHIP_LIMIT && items.length > 2 ? (
          <button
            type="button"
            className="lib-chip lib-chip--muted"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(true);
            }}
          >
            更多 ⌄
          </button>
        ) : null}
        {expanded ? (
          <button
            type="button"
            className="lib-chip lib-chip--muted"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(false);
            }}
          >
            收起 ⌃
          </button>
        ) : null}
      </div>
      {confirmClear ? (
        <div className="lib-dialog-backdrop" onClick={() => { setConfirmClear(false); }}>
          <div className="lib-dialog" onClick={(event) => { event.stopPropagation(); }}>
            <p className="lib-dialog__title">清空搜索历史？</p>
            <p className="lib-confirm-text">
              将删除全部 {String(props.history.length)} 条历史搜索词，此操作不可撤销。
            </p>
            <div className="lib-dialog__body" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="lib-sheet__text-button"
                onClick={() => {
                  setConfirmClear(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="lib-sheet__text-button"
                style={{ color: 'var(--lib-error)' }}
                onClick={() => {
                  setConfirmClear(false);
                  setEditing(false);
                  props.onClearAll();
                }}
              >
                清空
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** HistoryChip.kt (LibraryScreen.kt:1743-1833). */
function HistoryChip(props: {
  text: string;
  editing: boolean;
  muted?: boolean;
  onPick: () => void;
  onDelete: () => void;
  onEnterEdit: () => void;
}) {
  return (
    <span
      className={[
        'lib-chip',
        props.muted === true ? 'lib-chip--muted' : '',
        props.editing ? 'lib-chip--editing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!props.editing) props.onPick();
        }
      }}
      onClick={() => {
        if (!props.editing) props.onPick();
      }}
      onDoubleClick={props.onEnterEdit}
    >
      <span>{props.text}</span>
      {props.editing ? (
        <button
          type="button"
          className="lib-chip__remove"
          aria-label="删除"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          <IconClose />
        </button>
      ) : null}
    </span>
  );
}

/* ─────────────── KeywordSearchPreview (KeywordSearchPreview.kt:53-137) ─────────────── */

function KeywordSearchPreview(props: {
  words: string[];
  status: string;
  origins: Record<string, string>;
  submitted: Record<string, string[]>;
  providers: Array<{ provider: string; outcome: string; retryAt: number; detail: string }>;
  onRetry: (() => void) | null;
}) {
  // L62 `var expanded by rememberSaveable(words.firstOrNull()) { mutableStateOf(false) }`
  // — the callers pass `key={words[0] ?? ''}`, so a new keyword remounts this
  // component and the state resets without a setState-in-effect.
  const [expanded, setExpanded] = useState(false);
  if (props.words.length === 0) return null;

  const busy = keywordStatusIsBusy(props.status);
  return (
    <section className="lib-keyword" data-testid="keyword_search_preview">
      <button
        type="button"
        className="lib-keyword__head"
        aria-expanded={expanded}
        aria-label={expanded ? '收起搜索用词' : '查看搜索用词'}
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        <span className="lib-keyword__icon">
          <IconTranslate />
        </span>
        <span className="lib-keyword__titles">
          <span className="lib-keyword__title-row">
            <span className="lib-keyword__title">搜索用词</span>
            <span className="lib-keyword__count">{String(props.words.length)} 个</span>
          </span>
          <p className={busy ? 'lib-keyword__status lib-keyword__status--busy' : 'lib-keyword__status'}>
            {props.status}
          </p>
        </span>
        {expanded ? <IconExpandLess /> : <IconExpandMore />}
      </button>

      {!expanded ? (
        <div className="lib-keyword__words">
          {props.words.map((word) => (
            <button
              key={word}
              type="button"
              className="lib-keyword__word"
              aria-label="查看完整搜索用词"
              onClick={() => {
                setExpanded(true);
              }}
            >
              {word}
            </button>
          ))}
        </div>
      ) : (
        <div className="lib-keyword__detail">
          {props.words.map((word) => {
            const key = word.trim().replace(/\s+/g, ' ').toLowerCase();
            const count = (props.submitted[key] ?? []).length;
            return (
              <div key={word} className="lib-keyword__detail-row">
                <p className="lib-keyword__detail-word">{word}</p>
                <p className="lib-keyword__detail-meta">
                  {keywordSubmittedLine(props.origins[key] ?? null, count)}
                </p>
              </div>
            );
          })}
          <p className="lib-keyword__note">
            已提交表示交给书源处理，结果由书源返回。长按名称可复制。
          </p>
        </div>
      )}

      {expanded && props.providers.length > 0 ? (
        <div>
          {props.providers.map((state) => (
            <p key={state.provider} className="lib-keyword__provider">
              {keywordProviderDisplayName(state.provider)} · {keywordProviderOutcome(state.outcome, state.detail)}
            </p>
          ))}
        </div>
      ) : null}

      {props.onRetry !== null && keywordRetryVisible(props.status) ? (
        <button
          type="button"
          className="lib-keyword__retry"
          onClick={() => {
            props.onRetry?.();
          }}
        >
          重新查词
        </button>
      ) : null}
    </section>
  );
}

/** KeywordSearchOptions.kt (KeywordSearchPreview.kt:141-160). */
function KeywordSearchOptions(props: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  online: boolean;
  onOnlineChange: (value: boolean) => void;
}) {
  return (
    <div>
      <div className="lib-option-row" data-testid="multilingual_option">
        <span className="lib-keyword__icon" style={{ color: props.enabled ? 'var(--lib-secondary)' : 'var(--lib-body)' }}>
          <IconTranslate />
        </span>
        <span className="lib-option-row__text">
          <p className="lib-option-row__headline">多语言搜索</p>
          <p className="lib-option-row__support">
            {props.enabled ? '开启：扩展常用词、作品、角色和作者别名' : '关闭：仅使用输入的原始关键词'}
          </p>
        </span>
        <AppSwitch checked={props.enabled} onChange={props.onEnabledChange} />
      </div>
      {props.enabled ? (
        <div className="lib-option-row" data-testid="online_keyword_option">
          <span style={{ width: 24, flex: '0 0 auto' }} aria-hidden="true" />
          <span className="lib-option-row__text">
            <p className="lib-option-row__headline">缺词时在线补充</p>
            <p className="lib-option-row__support">优先查本地资料；在线查询名称后缓存，无痕时暂停</p>
          </span>
          <AppSwitch checked={props.online} onChange={props.onOnlineChange} />
        </div>
      ) : null}
    </div>
  );
}

/** AppSwitch.kt (KeywordSearchPreview.kt:152/158). */
function AppSwitch(props: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={props.checked ? 'lib-switch lib-switch--on' : 'lib-switch'}
      onClick={() => {
        props.onChange(!props.checked);
      }}
    >
      <span className="lib-switch__knob" />
    </button>
  );
}

/* ─────────────── SearchResultFavoriteButton (LibraryScreen.kt:2651-2690) ─────────────── */

function SearchResultFavoriteButton(props: {
  favorite: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={['lib-fav', props.className ?? '', props.favorite ? 'lib-fav--on' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label={props.favorite ? '取消喜欢' : '加入我喜欢的'}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle(!props.favorite);
      }}
    >
      <IconFavorite filled={props.favorite} />
    </button>
  );
}

/* ─────────────── LibraryBookCard (LibraryScreen.kt:2693-2958) ─────────────── */

function LibraryBookCardItem(props: {
  book: SearchBook;
  downloadState: DownloadState;
  coverHeaders: Record<string, string>;
  comicMode: boolean;
  favorite: boolean;
  onToggleFavorite: (next: boolean) => void;
  onStartDownload: () => void;
  onPauseDownload: () => void;
  onResumeDownload: () => void;
  onCancelDownload: () => void;
}) {
  const { book, downloadState } = props;
  return (
    <article className="lib-book-card" data-testid="library_book_card">
      {/* E50：shared-element 标记 —— 对应 Kotlin `HomeScreen.kt:1554-1555`
          的 `boxModifier.sharedElement(rememberSharedContentState(
          key = "book_cover_${book.id}"))`。View Transitions 要求「同一 name 在
          转场瞬间只对应一个元素」，故 key 里用 `sourceId + bookId` 而非仅
          `bookId`（不同源可能有相同 bookId）。 */}
      <div
        className="lib-book-card__cover"
        data-shared-element={bookCoverKey(`${book.sourceId}-${book.id}`)}
      >
        <CoverImage
          src={book.cover}
          alt={book.title}
          title={book.title}
          format={displayFormat(book)}
          headers={props.coverHeaders}
        />
        <SearchResultFavoriteButton
          favorite={props.favorite}
          onToggle={props.onToggleFavorite}
        />
      </div>
      <div className="lib-book-card__body">
        <p className="lib-book-card__title">{book.title}</p>
        <p className="lib-book-card__author">{book.author}</p>
        {book.description !== null && book.description.trim() !== '' ? (
          <p className="lib-book-card__desc">{book.description}</p>
        ) : (
          <p className="lib-book-card__meta">{bookCardMetaLine(book)}</p>
        )}
        <div className="lib-book-card__action">
          <DownloadStateControl
            state={downloadState}
            comicMode={props.comicMode}
            onStart={props.onStartDownload}
            onPause={props.onPauseDownload}
            onResume={props.onResumeDownload}
            onCancel={props.onCancelDownload}
          />
        </div>
      </div>
    </article>
  );
}

/**
 * LibraryScreen.kt:2799-2954 `AnimatedContent(targetState = downloadState) { state -> … }` —
 * the per-state download control row.
 */
function DownloadStateControl(props: {
  state: DownloadState;
  comicMode: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { state } = props;
  switch (state.kind) {
    case 'Idle':
      return (
        <button
          type="button"
          className="lib-search__go"
          style={{ position: 'static', width: 'auto', minHeight: 32, height: 32, padding: '0 14px', borderRadius: 16 }}
          data-testid="download_button_idle"
          onClick={props.onStart}
        >
          {props.comicMode ? <IconMenuBook /> : <IconDownload />}
          {props.comicMode ? '阅读' : '下载'}
        </button>
      );
    case 'Error':
      return (
        <div className="lib-dl-row">
          <button
            type="button"
            className="lib-search__go"
            style={{ position: 'static', width: 'auto', minHeight: 32, height: 32, padding: '0 14px', borderRadius: 16 }}
            data-testid="download_button_retry"
            onClick={props.onStart}
          >
            <IconRefresh />
            重试
          </button>
          <span className="lib-dl-pill lib-dl-pill--error">
            <IconErrorOutline />
            下载失败: {state.message}
          </span>
        </div>
      );
    case 'Pending':
      return (
        <div className="lib-dl-row">
          <span className="lib-dl-pill">
            <span className="lib-spinner-inline" />
            正在准备...
          </span>
          <button
            type="button"
            className="lib-icon-button lib-icon-button--xs"
            aria-label="取消"
            onClick={props.onCancel}
          >
            <IconClose />
          </button>
        </div>
      );
    case 'Downloading':
    case 'Paused': {
      const paused = state.kind === 'Paused';
      const progress = paused ? 0 : state.progress;
      return (
        <div style={{ width: '100%', padding: '4px 0' }}>
          <div className="lib-dl-row" style={{ justifyContent: 'space-between' }}>
            <span className="lib-dl-row" style={{ gap: 6 }}>
              {paused ? <IconPause /> : <span className="lib-spinner-inline" />}
              <strong style={{ fontSize: 13, color: paused ? 'var(--lib-body)' : 'var(--lib-secondary)' }}>
                {paused ? '已暂停' : `下载中: ${String(Math.trunc(progress * 100))}%`}
              </strong>
            </span>
            <span className="lib-dl-row" style={{ gap: 4 }}>
              <button
                type="button"
                className="lib-icon-button lib-icon-button--sm"
                aria-label={paused ? '继续' : '暂停'}
                onClick={paused ? props.onResume : props.onPause}
              >
                {paused ? <IconPlayArrow /> : <IconPause />}
              </button>
              <button
                type="button"
                className="lib-icon-button lib-icon-button--sm"
                aria-label="取消"
                onClick={props.onCancel}
              >
                <IconClose />
              </button>
            </span>
          </div>
          {!paused ? (
            <div className="lib-dl-progress">
              <div
                className="lib-dl-progress__fill"
                style={{ width: `${String(Math.min(100, Math.max(0, progress * 100)))}%` }}
              />
            </div>
          ) : null}
        </div>
      );
    }
    case 'Success':
      return (
        <span className="lib-dl-pill lib-dl-pill--done">
          <IconCheckCircle />
          已存入书架
        </span>
      );
    default:
      return null;
  }
}

/* ─────────────── NovelBookUi.kt ─────────────── */

/** NovelBookUi.kt:50-67 NovelCover — 12dp radius gradient + Placeholder/Content arms. */
function NovelCover(props: { book: SearchBook; width: number; height: number }) {
  return (
    <div
      className="lib-cover"
      style={{
        width: props.width,
        height: props.height,
        borderRadius: 12,
        overflow: 'hidden',
        background:
          'linear-gradient(160deg, rgba(5,150,105,0.22), rgba(16,185,129,0.18))',
      }}
    >
      <CoverImage
        src={props.book.cover}
        alt={props.book.title}
        title={props.book.title}
        format={props.book.format.toUpperCase()}
      />
    </div>
  );
}

/** NovelBookUi.kt:79-87 NovelLabels — distinct non-blank FlowRow pills. */
function NovelLabels(props: { labels: string[] }) {
  const unique = useMemo(
    () => [...new Set(props.labels.filter((label) => label.trim() !== ''))],
    [props.labels],
  );
  return (
    <div className="lib-labels">
      {unique.map((label) => (
        <span key={label} className="lib-label">
          {label}
        </span>
      ))}
    </div>
  );
}

/** NovelBookUi.kt:90-129 NovelSearchCard. */
function NovelSearchCard(props: {
  book: SearchBook;
  sourceName: string;
  state: DownloadState;
  downloaded: boolean;
  onClick: () => void;
}) {
  const info = props.book.novelInfo;
  const latestChapter =
    info !== null && info.latestChapter !== null && info.latestChapter.trim() !== ''
      ? info.latestChapter
      : null;
  const synopsis =
    info !== null && info.synopsis !== null && info.synopsis.trim() !== ''
      ? info.synopsis
      : null;
  const facts = novelSearchFacts(info);
  return (
    <button type="button" className="lib-novel-card" onClick={props.onClick}>
      <NovelCover book={props.book} width={86} height={124} />
      <div className="lib-novel-card__body">
        <p className="lib-novel-card__title">{props.book.title}</p>
        <p className="lib-novel-card__byline">{novelAuthorLine(props.book, props.sourceName)}</p>
        <NovelLabels labels={novelSearchLabels(props.book, info)} />
        {latestChapter !== null ? (
          <p className="lib-novel-card__line">最新 · {latestChapter}</p>
        ) : null}
        {synopsis !== null ? <p className="lib-novel-card__line">{synopsis}</p> : null}
        {facts.length > 0 ? <p className="lib-novel-card__facts">{facts.join(' · ')}</p> : null}
        <p className="lib-novel-card__dl">{novelDownloadLabel(props.state, props.downloaded)}</p>
      </div>
    </button>
  );
}

/** NovelBookUi.kt:132-192 NovelDetailContent. */
function NovelDetailContent(props: {
  book: SearchBook;
  sourceName: string;
  loading: boolean;
  error: string | null;
}) {
  // NovelBookUi.kt:175 `var expanded by remember(book.id, book.sourceId)`
  const [expanded, setExpanded] = useState(false);
  const info = props.book.novelInfo;
  const facts = novelDetailFacts(props.book, info);
  const rows = useMemo(() => chunkFactsIntoRows(facts), [facts]);
  const originalTitle =
    info !== null && info.originalTitle !== null && info.originalTitle !== props.book.title && info.originalTitle.trim() !== ''
      ? info.originalTitle
      : null;
  const synopsis =
    info !== null && info.synopsis !== null && info.synopsis.trim() !== ''
      ? info.synopsis
      : props.book.description;
  const tags = info !== null && info.tags.length > 0 ? info.tags.slice(0, 12) : [];
  const notice = info !== null && info.notice !== null && info.notice.trim() !== '' ? info.notice : null;
  return (
    <div>
      <div className="lib-detail__hero">
        <div className="lib-detail__cover">
          <NovelCover book={props.book} width={106} height={150} />
        </div>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <p className="lib-detail__title">{props.book.title}</p>
          {props.book.author.trim() !== '' ? (
            <p className="lib-detail__author">{props.book.author}</p>
          ) : null}
          <p className="lib-detail__source">{props.sourceName}</p>
          <NovelLabels labels={novelDetailLabels(props.book, info)} />
        </div>
      </div>
      {props.loading ? <div className="lib-progress-track" style={{ marginTop: 18 }} /> : null}
      {props.error !== null ? <p className="lib-detail__error">{props.error}</p> : null}
      {facts.length > 0 ? (
        <div className="lib-detail__facts" style={{ marginTop: 18 }}>
          {rows.map((row, rowIndex) => (
            <div className="lib-detail__fact-row" key={`row-${String(rowIndex)}`}>
              {row.map(([label, value]) => (
                <div className="lib-detail__fact" key={label}>
                  <p className="lib-detail__fact-label">{label}</p>
                  <p className="lib-detail__fact-value">{value}</p>
                </div>
              ))}
              {row.length === 1 ? <div className="lib-detail__fact" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {(info !== null && !isBlank(info.latestChapter)) ||
      (info !== null && !isBlank(info.updatedAt)) ? (
        <div style={{ marginTop: 18 }}>
          <p className="lib-detail__section-title">连载进度</p>
          {/* Kotlin `info?.latestChapter?.let { … }` / `info?.updatedAt?.let { … }` print the
              raw value (they are only gated by the outer `isNullOrBlank` guard). */}
          {info.latestChapter !== null ? <p className="lib-detail__section-line">{info.latestChapter}</p> : null}
          {info.updatedAt !== null ? (
            <p className="lib-detail__section-sub">源站更新 {info.updatedAt}</p>
          ) : null}
        </div>
      ) : null}
      {originalTitle !== null ? (
        <p className="lib-detail__section-sub" style={{ marginTop: 18 }}>原名 · {originalTitle}</p>
      ) : null}
      {tags.length > 0 ? <NovelLabels labels={tags} /> : null}
      {synopsis !== null && synopsis.trim() !== '' ? (
        <div style={{ marginTop: 18 }}>
          <p className="lib-detail__section-title">作品简介</p>
          <p className={expanded ? 'lib-detail__synopsis' : 'lib-detail__synopsis lib-detail__synopsis--clamped'}>
            {synopsis}
          </p>
          {synopsis.length > 180 ? (
            <button
              type="button"
              className="lib-sheet__text-button"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? '收起简介' : '展开完整简介'}
            </button>
          ) : null}
        </div>
      ) : null}
      {notice !== null ? (
        <div className="lib-detail__notice" style={{ marginTop: 18 }}>
          <IconInfo />
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}

/** NovelBookUi.kt:196-229 NovelDetailSheet. */
export function NovelDetailSheet(props: {
  book: SearchBook;
  sourceName: string;
  loading: boolean;
  error: string | null;
  state: DownloadState;
  hasLocal: boolean;
  onDismiss: () => void;
  onDownload: () => void;
  onRead: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="lib-sheet-backdrop" onClick={props.onDismiss}>
      <div className="lib-sheet" onClick={(event) => { event.stopPropagation(); }}>
        <div className="lib-sheet__scroll">
          <NovelDetailContent
            book={props.book}
            sourceName={props.sourceName}
            loading={props.loading}
            error={props.error}
          />
        </div>
        <div className="lib-sheet__actions">
          <NovelDownloadActions
            state={props.state}
            hasLocal={props.hasLocal}
            loading={props.loading}
            onDownload={props.onDownload}
            onPause={props.onPause}
            onResume={props.onResume}
            onCancel={props.onCancel}
            onRead={props.onRead}
          />
        </div>
      </div>
    </div>
  );
}

/** NovelBookUi.kt:206-224 the `when (state)` download-action block. */
function NovelDownloadActions(props: {
  state: DownloadState;
  hasLocal: boolean;
  loading: boolean;
  onDownload: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRead: () => void;
}) {
  const { state } = props;
  return (
    <>
      {state.kind === 'Downloading' ? (
        <>
          <div className="lib-progress-track">
            <div
              className="lib-progress-track__fill"
              style={{ width: `${String(Math.min(100, Math.max(0, state.progress * 100)))}%` }}
            />
          </div>
          <div className="lib-dl-row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>整本下载 {String(Math.trunc(state.progress * 100))}%</span>
            <span className="lib-dl-row" style={{ gap: 8 }}>
              <button type="button" className="lib-sheet__text-button" onClick={props.onPause}>暂停</button>
              <button type="button" className="lib-sheet__text-button" onClick={props.onCancel}>取消</button>
            </span>
          </div>
        </>
      ) : null}
      {state.kind === 'Pending' ? (
        <>
          <div className="lib-progress-track" />
          <span style={{ fontSize: 12 }}>准备整本文件…</span>
          <button type="button" className="lib-sheet__text-button" onClick={props.onCancel}>取消</button>
        </>
      ) : null}
      {state.kind === 'Paused' ? (
        <button type="button" className="lib-sheet__full-button" onClick={props.onResume}>继续整本下载</button>
      ) : null}
      {state.kind === 'Success' ? (
        <button type="button" className="lib-sheet__full-button" onClick={props.hasLocal ? props.onRead : props.onDownload}>
          <IconMenuBook />
          {props.hasLocal ? '打开书架里的小说' : '整本下载到书架'}
        </button>
      ) : null}
      {(state.kind === 'Idle' || state.kind === 'Error') ? (
        <>
          {state.kind === 'Error' ? <p className="lib-detail__error">{state.message}</p> : null}
          <button
            type="button"
            className="lib-sheet__full-button"
            disabled={props.loading}
            onClick={props.onDownload}
          >
            <IconDownload />
            {state.kind === 'Error' ? '重试整本下载' : '整本下载到书架'}
          </button>
        </>
      ) : null}
      {props.hasLocal && state.kind !== 'Success' ? (
        <button type="button" className="lib-sheet__outline-button" onClick={props.onRead}>阅读已下载版本</button>
      ) : null}
    </>
  );
}

/** NovelBookUi.kt:233-273 NovelUpdateSheet. */
function NovelUpdateSheet(props: {
  localTitle: string;
  sourceName: string;
  loading: boolean;
  remoteInfo: NovelInfo | null;
  changed: boolean | null;
  error: string | null;
  state: DownloadState;
  localFilePath: string;
  onDismiss: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const info = props.remoteInfo;
  return (
    <div className="lib-sheet-backdrop" onClick={props.onDismiss}>
      <div className="lib-sheet" onClick={(event) => { event.stopPropagation(); }}>
        <div className="lib-sheet__scroll">
          <p className="lib-dialog__title" style={{ fontSize: 20 }}>检查小说更新</p>
          <p className="lib-detail__section-line" style={{ marginTop: 14 }}>{props.localTitle}</p>
          <p className="lib-detail__source">{props.sourceName}</p>
          {props.loading ? (
            <>
              <div className="lib-progress-track" style={{ marginTop: 14 }} />
              <p style={{ marginTop: 12 }}>正在获取源站最新信息…</p>
            </>
          ) : null}
          {props.error !== null ? (
            <>
              <p className="lib-detail__error">{props.error}</p>
              <button type="button" className="lib-sheet__outline-button" style={{ marginTop: 12 }} onClick={props.onRetry}>
                重试检查
              </button>
            </>
          ) : null}
          {!props.loading && props.error === null ? (
            <>
              <p style={{ fontWeight: 600, marginTop: 14 }}>{novelUpdateHeadline(props.changed)}</p>
              {info !== null ? (
                <div style={{ marginTop: 8 }}>
                  {info.latestChapter !== null ? <p>源站最新 · {info.latestChapter}</p> : null}
                  {info.updatedAt !== null ? <p className="lib-detail__section-sub">更新于 {info.updatedAt}</p> : null}
                  {info.chapterCount !== null ? (
                    <p className="lib-detail__section-sub">源站目录 {String(info.chapterCount)} 章</p>
                  ) : null}
                  {info.notice !== null ? <p className="lib-detail__section-sub">{info.notice}</p> : null}
                </div>
              ) : null}
              <p className="lib-detail__section-sub" style={{ marginTop: 12 }}>
                整本新版验证成功后替换，保留阅读位置、书签和笔记。
              </p>
            </>
          ) : null}
        </div>
        {/* Kotlin NovelBookUi.kt:240-268 — the `when (state)` action block lives INSIDE the
            `else ->` arm of `when { loading / error / else }`, so no download button is
            rendered while the update check is running or has failed. */}
        {!props.loading && props.error === null ? (
          <div className="lib-sheet__actions">
            {props.state.kind === 'Success' ? (
              novelUpdateNewFileStored(props.state, props.localFilePath) ? (
                <button type="button" className="lib-sheet__full-button" onClick={props.onDismiss}>
                  完成，继续阅读
                </button>
              ) : (
                <button type="button" className="lib-sheet__full-button" onClick={props.onDownload}>
                  {props.changed === true ? '下载整本新版' : '重新下载整本'}
                </button>
              )
            ) : null}
            {props.state.kind === 'Downloading' ? (
              <>
                <div className="lib-progress-track">
                  <div
                    className="lib-progress-track__fill"
                    style={{ width: `${String(Math.min(100, Math.max(0, props.state.progress * 100)))}%` }}
                  />
                </div>
                <span style={{ fontSize: 13 }}>正在下载整本新版 {String(Math.trunc(props.state.progress * 100))}%</span>
                <span className="lib-dl-row" style={{ gap: 8 }}>
                  <button type="button" className="lib-sheet__text-button" onClick={props.onPause}>暂停</button>
                  <button type="button" className="lib-sheet__text-button" onClick={props.onCancel}>取消</button>
                </span>
              </>
            ) : null}
            {props.state.kind === 'Pending' ? (
              <>
                <div className="lib-progress-track" />
                <span style={{ fontSize: 13 }}>正在准备整本新版…</span>
              </>
            ) : null}
            {props.state.kind === 'Paused' ? (
              <button type="button" className="lib-sheet__full-button" onClick={props.onResume}>继续下载新版</button>
            ) : null}
            {(props.state.kind === 'Idle' || props.state.kind === 'Error') ? (
              <>
                {props.state.kind === 'Error' ? <p className="lib-detail__error">{props.state.message}</p> : null}
                <button type="button" className="lib-sheet__full-button" onClick={props.onDownload}>
                  {props.changed === true ? '下载整本新版' : '重新下载整本'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────── StaggeredComicCard (LibraryScreen.kt:3027-3201) ─────────────── */

function StaggeredComicCardItem(props: {
  book: SearchBook;
  coverHeaders: Record<string, string>;
  sourceName: string;
  novel: boolean;
  favorite: boolean;
  onToggleFavorite: (next: boolean) => void;
  onClick: () => void;
}) {
  // LibraryScreen.kt:3039 `val coverRatio = book.staggerRatio()` — fixed from the first
  // frame so the grid never reflows when the cover finishes decoding.
  const ratio = useMemo(() => {
    const seed = `${props.book.sourceId}_${props.book.id}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
    }
    return STAGGER_RATIO_PALETTE[(hash & 0x7fffffff) % STAGGER_RATIO_PALETTE.length] as number;
  }, [props.book.sourceId, props.book.id]);
  const formatBadge = useMemo(
    () => comicFormatBadge(props.book, props.novel),
    [props.book, props.novel],
  );
  return (
    <button
      type="button"
      className="lib-stagger"
      style={{ paddingBottom: `${String(Math.round(100 / ratio))}%` }}
      onClick={props.onClick}
    >
      <span className="lib-stagger__cover" style={{ aspectRatio: `1 / ${String(ratio)}` }}>
        <CoverImage
          src={props.book.cover}
          alt={props.book.title}
          title={props.book.title}
          format={displayFormat(props.book)}
          headers={props.coverHeaders}
        />
        <span className="lib-stagger__scrim" aria-hidden="true" />
        <span className="lib-stagger__text">
          <span className="lib-stagger__title">{props.book.title}</span>
          {props.book.author.trim() !== '' ? (
            <span className="lib-stagger__author">{props.book.author}</span>
          ) : null}
        </span>
        <span className="lib-stagger__avatar">
          <SourceAvatar sourceId={props.book.sourceId} sourceName={props.sourceName} size={16} />
        </span>
        <span className="lib-stagger__fav">
          <SearchResultFavoriteButton
            favorite={props.favorite}
            onToggle={props.onToggleFavorite}
            className="lib-fav--stagger"
          />
        </span>
        <span className="lib-stagger__badge">{formatBadge}</span>
      </span>
    </button>
  );
}

/* ─────────────── AggregateSourceHeader (LibraryScreen.kt:3204-3276) ─────────────── */

function AggregateSourceHeader(props: {
  name: string;
  loading: boolean;
  resultCount: number;
  /** LibraryScreen.kt:763 `key = "agg_group_header_${group.sourceId}"` — the jump anchor. */
  anchorId: string;
  onClick: () => void;
}) {
  return (
    <div className="lib-grid__full" data-agg-group={props.anchorId}>
      <button type="button" className="lib-source-header" onClick={props.onClick}>
        <SourceAvatar sourceId={`agg_${props.name}`} sourceName={props.name} size={24} />
        <span style={{ width: 8 }} />
        {props.loading ? (
          <>
            <ChasingDots size={18} />
            <span style={{ width: 10 }} />
          </>
        ) : null}
        <p className="lib-source-header__name">{props.name}</p>
        {!props.loading && props.resultCount > 0 ? (
          <>
            <span style={{ width: 8 }} />
            <span className="lib-source-header__count">{String(props.resultCount)}</span>
          </>
        ) : null}
        <IconUnfoldMore />
        <span style={{ width: 2 }} />
      </button>
    </div>
  );
}

/** AggregateExpandButton.kt (LibraryScreen.kt:3283-3330). */
function AggregateExpandButton(props: { hiddenCount: number; onExpand: () => void }) {
  return (
    <div className="lib-grid__full">
      <button type="button" className="lib-expand" onClick={props.onExpand}>
        展开全部 {String(props.hiddenCount)} 条
        <IconKeyboardArrowDown />
      </button>
    </div>
  );
}

/** AggregateSourceError.kt (LibraryScreen.kt:3497-3535). */
function AggregateSourceError(props: { error: string | null }) {
  const message = aggregateSourceErrorMessage(props.error);
  const timedOut = message === '链接超时';
  return (
    <div className="lib-grid__full">
      <div className="lib-source-error">
        {timedOut ? <IconInfo /> : <IconErrorOutline />}
        <span>{message}</span>
      </div>
    </div>
  );
}

/** AggregateJumpSheet.kt (LibraryScreen.kt:3369-3494). */
function AggregateJumpSheet(props: {
  groups: LibraryAggregateGroup[];
  activeGroupIdx: number;
  onDismiss: () => void;
  onJump: (index: number) => void;
}) {
  return (
    <div className="lib-sheet-backdrop" onClick={props.onDismiss}>
      <div
        className="lib-sheet"
        style={{ maxHeight: '60vh', borderRadius: 24, margin: '0 12px' }}
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div style={{ padding: 8 }}>
          <div className="lib-jump-head">
            <IconUnfoldMore />
            <p className="lib-jump-head__title">跳转到源组</p>
            <button type="button" className="lib-icon-button" aria-label="关闭" onClick={props.onDismiss}>
              <IconClose />
            </button>
          </div>
          <div className="lib-jump-divider" />
          <div style={{ overflowY: 'auto', padding: '6px 0' }}>
            <button type="button" className="lib-jump-row" onClick={() => { props.onJump(-1); }}>
              <IconArrowUpward />
              <p className="lib-jump-row__name">回到搜索顶部</p>
            </button>
            {props.groups.map((group, idx) => (
              <button
                key={group.sourceId}
                type="button"
                className="lib-jump-row"
                onClick={() => { props.onJump(idx); }}
              >
                <SourceAvatar sourceId={`agg_${group.sourceName}`} sourceName={group.sourceName} size={28} />
                <p className="lib-jump-row__name">{group.sourceName}</p>
                {group.loading ? (
                  <ChasingDots size={14} />
                ) : group.books.length > 0 ? (
                  <span className="lib-source-header__count">{String(group.books.length)}</span>
                ) : (
                  <span style={{ color: 'rgba(220,38,38,0.7)' }}>
                    <IconErrorOutline />
                  </span>
                )}
                <span style={{ width: 10 }} />
                {idx === props.activeGroupIdx ? (
                  <span className="lib-sheet__check">
                    <IconCheckCircle />
                  </span>
                ) : (
                  <span style={{ width: 18 }} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── SourcePickerSheet (LibraryScreen.kt:1837-2113) ─────────────── */

function SourcePickerSheet(props: {
  aggregateMode: boolean;
  aggregateKind: string;
  currentSourceId: string | null;
  comicSources: BookSource[];
  novelSources: BookSource[];
  multiLanguageSearch: boolean;
  onToggleMultiLanguageSearch: (value: boolean) => void;
  onlineKeywordLookup: boolean;
  onToggleOnlineKeywordLookup: (value: boolean) => void;
  onSelectAggregate: (kind: string) => void;
  onSelectSource: (id: string) => void;
  onManageSources: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="lib-sheet-backdrop" onClick={props.onDismiss}>
      <div className="lib-sheet" onClick={(event) => { event.stopPropagation(); }}>
        <div className="lib-sheet__grip" aria-hidden="true" />
        <div className="lib-sheet__head">
          <p className="lib-sheet__title">选择书源</p>
          <button type="button" className="lib-sheet__manage" onClick={props.onManageSources}>
            管理书源
          </button>
        </div>
        <div className="lib-sheet__list">
          <p className="lib-sheet__label">聚合搜索</p>
          <AggregateOptionItem
            title="聚合漫画（全部）"
            subtitle="同时搜索所有已启用的漫画源"
            selected={props.aggregateMode && props.aggregateKind === 'comic'}
            onClick={() => { props.onSelectAggregate('comic'); }}
          />
          <AggregateOptionItem
            title="聚合小说（全部）"
            subtitle="同时搜索所有已启用的小说源（网文/电子书）"
            selected={props.aggregateMode && props.aggregateKind === 'novel'}
            onClick={() => { props.onSelectAggregate('novel'); }}
          />
          <div className="lib-sheet__divider" />
          <KeywordSearchOptions
            enabled={props.multiLanguageSearch}
            onEnabledChange={props.onToggleMultiLanguageSearch}
            online={props.onlineKeywordLookup}
            onOnlineChange={props.onToggleOnlineKeywordLookup}
          />
          <div className="lib-sheet__divider" />
          {props.comicSources.length > 0 ? (
            <>
              <p className="lib-sheet__label">漫画源</p>
              {props.comicSources.map((source) => (
                <SourceOptionItem
                  key={source.id}
                  source={source}
                  selected={!props.aggregateMode && props.currentSourceId === source.id}
                  onClick={() => { props.onSelectSource(source.id); }}
                />
              ))}
            </>
          ) : null}
          {props.novelSources.length > 0 ? (
            <>
              <p className="lib-sheet__label">小说源</p>
              {props.novelSources.map((source) => (
                <SourceOptionItem
                  key={source.id}
                  source={source}
                  selected={!props.aggregateMode && props.currentSourceId === source.id}
                  onClick={() => { props.onSelectSource(source.id); }}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** AggregateOptionItem.kt (LibraryScreen.kt:2143-2217). */
function AggregateOptionItem(props: {
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        props.selected
          ? 'lib-sheet__option lib-sheet__option--aggregate-selected'
          : 'lib-sheet__option'
      }
      onClick={props.onClick}
    >
      <span className={props.selected ? 'lib-sheet__check lib-sheet__check--secondary' : 'lib-keyword__icon'}>
        <IconMenuBook />
      </span>
      <span className="lib-sheet__option-text">
        <p className="lib-sheet__option-name" style={{ fontWeight: props.selected ? 700 : 600 }}>
          {props.title}
        </p>
        <p className="lib-sheet__option-sub">{props.subtitle}</p>
      </span>
      {props.selected ? (
        <span className="lib-sheet__check lib-sheet__check--secondary">
          <IconCheckCircle />
        </span>
      ) : null}
    </button>
  );
}

/** SourceOptionItem.kt (LibraryScreen.kt:2221-2305). */
function SourceOptionItem(props: {
  source: BookSource;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.selected ? 'lib-sheet__option lib-sheet__option--selected' : 'lib-sheet__option'}
      onClick={props.onClick}
    >
      <SourceAvatar sourceId={props.source.id} sourceName={props.source.name} size={32} />
      <span className="lib-sheet__option-text">
        <p className="lib-sheet__option-name" style={{ fontWeight: props.selected ? 700 : 600 }}>
          {props.source.name}
        </p>
        <p className="lib-sheet__option-id">{props.source.id}</p>
      </span>
      {props.selected ? (
        <span className="lib-sheet__check">
          <IconCheckCircle />
        </span>
      ) : null}
    </button>
  );
}

/* ─────────────── FormatPickerDialog (FormatPickerDialog.kt:46-232) ─────────────── */

function FormatPickerDialog(props: {
  bookTitle: string;
  formats: BookFormat[];
  loading: boolean;
  onPick: (format: BookFormat) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="lib-dialog-backdrop" onClick={() => { if (!props.loading) props.onDismiss(); }}>
      <div className="lib-dialog" onClick={(event) => { event.stopPropagation(); }}>
        <div className="lib-dialog__head">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <p className="lib-dialog__title">选择下载格式</p>
            <p className="lib-dialog__subtitle">{props.bookTitle}</p>
          </div>
          {!props.loading ? (
            <button type="button" className="lib-icon-button" aria-label="关闭" onClick={props.onDismiss}>
              <IconClose />
            </button>
          ) : null}
        </div>
        <div className="lib-dialog__body">
          {props.loading ? (
            <div className="lib-dl-row" style={{ padding: '20px 0' }}>
              <ChasingDots size={20} />
              <span style={{ fontSize: 14, color: 'var(--lib-body)' }}>正在获取可用格式…</span>
            </div>
          ) : (
            props.formats.map((fmt) => (
              <button
                key={`${fmt.format}-${fmt.eapiId ?? ''}`}
                type="button"
                className="lib-format-row"
                onClick={() => { props.onPick(fmt); }}
              >
                <span className="lib-format-row__icon">
                  <IconDownload />
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'left' }}>
                  <p className="lib-format-row__name">{fmt.format.toUpperCase()}</p>
                  {fmt.sizeText !== null && fmt.sizeText.trim() !== '' ? (
                    <p className="lib-format-row__size">{fmt.sizeText}</p>
                  ) : null}
                </span>
                <span className="lib-search__go" style={{ position: 'static', width: 'auto', height: 32, minHeight: 32, padding: '0 14px', borderRadius: 16, background: 'rgba(5,150,105,0.1)', color: 'var(--lib-primary)' }}>
                  下载
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── LibraryLoginDialog (LibraryLoginDialog.kt:53-265) ─────────────── */

function LibraryLoginDialog(props: {
  message: string;
  loading: boolean;
  registerUrl: string;
  onLogin: (email: string, password: string) => void;
  onDismiss: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="lib-dialog-backdrop" onClick={() => { if (!props.loading) props.onDismiss(); }}>
      <div
        className="lib-login"
        onClick={(event) => { event.stopPropagation(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!props.loading && email.trim() !== '' && password.trim() !== '') {
              props.onLogin(email, password);
            }
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="lib-login__badge">
            <IconLock />
          </span>
          <p className="lib-login__title">登录 Z-Library</p>
          <button
            type="button"
            className="lib-icon-button"
            aria-label="关闭"
            onClick={() => { if (!props.loading) props.onDismiss(); }}
          >
            <IconClose />
          </button>
        </div>
        <input
          className="lib-login__field"
          value={email}
          placeholder="邮箱 / 账号"
          aria-label="邮箱 / 账号"
          autoComplete="username"
          onChange={(event) => { setEmail(event.target.value); }}
        />
        <input
          className="lib-login__field lib-login__field--password"
          type="password"
          value={password}
          placeholder="密码"
          aria-label="密码"
          autoComplete="current-password"
          onChange={(event) => { setPassword(event.target.value); }}
        />
        {props.message.trim() !== '' ? (
          <p
            className={
              props.message.includes('成功')
                ? 'lib-login__message lib-login__message--ok'
                : 'lib-login__message'
            }
          >
            {props.message}
          </p>
        ) : null}
        {props.loading ? (
          <div className="lib-login__progress">
            <div className="lib-login__progress__fill" />
          </div>
        ) : null}
        <button
          type="button"
          className="lib-login__submit"
          disabled={props.loading || email.trim() === '' || password.trim() === ''}
          onClick={() => { props.onLogin(email, password); }}
        >
          {props.loading ? '登录中' : '确认登录'}
        </button>
        <button
          type="button"
          className="lib-login__register"
          onClick={() => {
            // Android `LibraryLoginDialog.kt:246`
            // `context.startActivity(Intent(ACTION_VIEW, Uri.parse(url)))`
            // + toast「无法打开注册页面」。
            // ⚠️ 原来这里是裸 `window.open(url,'_blank')`：WKWebView 会拦掉
            // `_blank` 导航且不报错 —— 用户点了没反应（静默失败）。改走
            // `externalBrowser` 端口（iOS = `SFSafariViewController`），
            // 且窗口被拦截时**显式抛错**，由这里 toast 回Kotlin 的那句文案。
            void openExternalUrl(props.registerUrl).then(
              () => {},
              () => showToast('无法打开注册页面'),
            );
          }}
        >
          没有账号？去注册
        </button>
      </div>
    </div>
  );
}

/* ─────────────── DownloadGlassCard (DownloadGlassCard.kt:68-358) ─────────────── */

function DownloadGlassCard(props: {
  book: SearchBook | null;
  state: DownloadState;
  onDismiss: (() => void) | null;
  onPause: (() => void) | null;
  onResume: (() => void) | null;
  onCancel: (() => void) | null;
}) {
  // DownloadGlassCard.kt:81-83 — speed sampler state, resampled every 400 ms while
  // downloading (the Kotlin `LaunchedEffect(state)` + 400 ms window).
  const [sample, setSample] = useState({ bytes: -1, at: 0, speed: 0 });
  const bytes =
    props.state.kind === 'Downloading' ? props.state.downloadedBytes : null;
  useEffect(() => {
    if (bytes === null) return undefined;
    const timer = window.setInterval(() => {
      const now = performance.now();
      setSample((prev) => {
        // Kotlin DownloadGlassCard.kt:95-98 — the FIRST sample only seeds the window.
        if (prev.bytes < 0 || prev.at <= 0) {
          return { bytes, at: now, speed: prev.speed };
        }
        // Kotlin lines 89-94 — `lastBytes`/`lastTime` advance on every `dt > 400` pass,
        // including one that measures 0 B/s. Skipping the window update for a zero speed
        // would fold the whole stall into the next sample's divisor.
        if (!downloadSpeedSampleDue(prev.bytes, prev.at, now)) return prev;
        return { bytes, at: now, speed: downloadSpeedBps(bytes, prev.bytes, prev.at, now) };
      });
    }, 400);
    return () => {
      window.clearInterval(timer);
    };
  }, [bytes, props.state]);
  const speedBps = sample.speed;

  const progress = downloadCardProgress(props.state);
  const statusRole = downloadCardStatusRole(props.state);

  if (props.book === null) {
    return (
      <div className="lib-download-overlay" onClick={() => { props.onDismiss?.(); }}>
        <div className="lib-download-card" onClick={(event) => { event.stopPropagation(); }}>
          <div className="lib-download-card__head">
            <span className="lib-download-card__icon">
              <IconDownload />
            </span>
            <p className="lib-download-card__title">下载管理中心</p>
            {props.onDismiss !== null ? (
              <button type="button" className="lib-icon-button" aria-label="关闭" onClick={() => { props.onDismiss?.(); }}>
                <IconClose />
              </button>
            ) : null}
          </div>
          <p className="lib-download-card__empty-desc" data-testid="download_panel_empty">
            暂无进行中的下载任务
            <br />
            在书库中搜索图书并点击“下载”，离线书籍将自动同步存入本地书架。
          </p>
          <button
            type="button"
            className="lib-sheet__outline-button"
            onClick={() => { props.onDismiss?.(); }}
          >
            知道了
          </button>
        </div>
      </div>
    );
  }

  const book = props.book;
  return (
    <div className="lib-download-overlay" onClick={() => { props.onDismiss?.(); }}>
      <div className="lib-download-card" onClick={(event) => { event.stopPropagation(); }}>
        <div className="lib-download-card__head">
          <CoverImage
            className="lib-download-card__cover"
            src={book.cover}
            alt=""
            title={book.title}
            format={displayFormat(book)}
          />
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <p className="lib-download-card__book-title">{book.title}</p>
            <p
              className={
                statusRole === 'error'
                  ? 'lib-download-card__status lib-download-card__status--error'
                  : 'lib-download-card__status'
              }
            >
              {downloadCardStatusText(props.state)}
            </p>
          </div>
          {props.onDismiss !== null ? (
            <button type="button" className="lib-icon-button" aria-label="关闭" onClick={() => { props.onDismiss?.(); }}>
              <IconClose />
            </button>
          ) : null}
        </div>

        <div className="lib-download-card__bar">
          <div
            className="lib-download-card__bar-fill"
            style={{ width: `${String(Math.min(100, Math.max(0, progress * 100)))}%` }}
          />
        </div>

        {props.state.kind === 'Downloading' ? (
          <>
            <div className="lib-download-card__stats">
              <p className="lib-download-card__percent">{String(Math.trunc(progress * 100))}%</p>
              <p className="lib-download-card__speed">{downloadCardSpeedText(speedBps)}</p>
            </div>
            <p className="lib-download-card__remaining">{downloadCardRemainingLine(props.state)}</p>
          </>
        ) : null}
        {props.state.kind === 'Success' ? (
          <div className="lib-download-card__done">
            <IconCheckCircle />
            已加入书架
          </div>
        ) : null}
        {props.state.kind === 'Error' ? (
          <p className="lib-download-card__note lib-download-card__note--error">{props.state.message}</p>
        ) : null}
        {props.state.kind === 'Paused' ? (
          <p className="lib-download-card__note">已暂停</p>
        ) : null}
        {(props.state.kind === 'Idle' || props.state.kind === 'Pending') ? (
          <p className="lib-download-card__note">准备中…</p>
        ) : null}

        {downloadCardShowsControls(props.state) ? (
          <div className="lib-download-card__actions">
            <button
              type="button"
              className="lib-sheet__outline-button"
              onClick={() => {
                if (props.state.kind === 'Paused' || props.state.kind === 'Error') {
                  props.onResume?.();
                } else {
                  props.onPause?.();
                }
              }}
            >
              {downloadCardPrimaryLabel(props.state)}
            </button>
            {props.onCancel !== null ? (
              <button type="button" className="lib-sheet__outline-button" onClick={() => { props.onCancel?.(); }}>
                取消
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────── ComicDownloadGlassCard (LibraryScreen.kt:2308-2480) ─────────────── */

function ComicDownloadGlassCard(props: {
  tasks: ComicDownloadTask[];
  onPause: (chapterId: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (chapterId: string) => void;
  onDismiss: () => void;
}) {
  const preview = props.tasks.slice(0, COMIC_TASK_PREVIEW_LIMIT);
  return (
    <div className="lib-download-card lib-comic-tasks">
      <div className="lib-download-card__head">
        <p className="lib-comic-tasks__title">漫画下载</p>
        <button type="button" className="lib-icon-button lib-icon-button--xs" aria-label="关闭" onClick={props.onDismiss}>
          <IconClose />
        </button>
      </div>
      {props.tasks.length === 0 ? (
        <p className="lib-comic-tasks__empty">暂无漫画下载任务</p>
      ) : (
        <>
          {preview.map((task) => (
            <ComicDownloadTaskRow
              key={`${task.book.sourceId}-${task.chapterId}`}
              task={task}
              onPause={props.onPause}
              onResume={props.onResume}
              onRetry={props.onRetry}
              onCancel={props.onCancel}
            />
          ))}
          {props.tasks.length > COMIC_TASK_PREVIEW_LIMIT ? (
            <p className="lib-comic-tasks__more">
              还有 {String(props.tasks.length - COMIC_TASK_PREVIEW_LIMIT)} 个任务…
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** ComicDownloadTaskRow.kt (LibraryScreen.kt:2374-2480). */
function ComicDownloadTaskRow(props: {
  task: ComicDownloadTask;
  onPause: (chapterId: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (chapterId: string) => void;
}) {
  const { task } = props;
  const title = task.chapter.title.trim() === '' ? '漫画章节' : task.chapter.title;
  const statusClass = (() => {
    switch (task.status) {
      case 'PAUSED':
        return 'lib-comic-task__status lib-comic-task__status--paused';
      case 'FAILED':
        return 'lib-comic-task__status lib-comic-task__status--failed';
      case 'SUCCESS':
        return 'lib-comic-task__status lib-comic-task__status--success';
      default:
        return 'lib-comic-task__status';
    }
  })();
  return (
    <div className="lib-comic-task">
      <div className="lib-comic-task__row">
        <p className="lib-comic-task__title">{title}</p>
        {task.status === 'DOWNLOADING' ? (
          <span className={statusClass}>{String(Math.trunc(Math.min(1, Math.max(0, task.progress)) * 100))}%</span>
        ) : task.status === 'PAUSED' ? (
          <span className={statusClass}>已暂停</span>
        ) : task.status === 'FAILED' ? (
          <span className={statusClass}>失败</span>
        ) : (
          <span className={statusClass}>已完成</span>
        )}
        {task.status === 'DOWNLOADING' || task.status === 'PAUSED' ? (
          <button
            type="button"
            className="lib-icon-button"
            aria-label={task.status === 'DOWNLOADING' ? '暂停' : '继续'}
            onClick={() => {
              if (task.status === 'DOWNLOADING') props.onPause(task.chapterId);
              else props.onResume(task.chapterId);
            }}
          >
            {task.status === 'DOWNLOADING' ? <IconPause /> : <IconPlayArrow />}
          </button>
        ) : null}
        {task.status === 'FAILED' ? (
          <button
            type="button"
            className="lib-icon-button lib-icon-button--sm"
            aria-label="重新下载"
            style={{ color: 'var(--lib-error)' }}
            onClick={() => { props.onRetry(task.chapterId); }}
          >
            <IconRefresh />
          </button>
        ) : null}
        <button
          type="button"
          className="lib-icon-button lib-icon-button--sm"
          aria-label="取消任务"
          onClick={() => { props.onCancel(task.chapterId); }}
        >
          <IconClose />
        </button>
      </div>
      {task.status === 'DOWNLOADING' ? (
        <div className="lib-dl-progress" style={{ marginTop: 6, height: 4 }}>
          <div
            className="lib-dl-progress__fill"
            style={{
              width: `${String(Math.trunc(Math.min(1, Math.max(0, task.progress)) * 100))}%`,
              background: 'var(--lib-primary)',
            }}
          />
        </div>
      ) : null}
      {task.status === 'FAILED' && task.error !== null && task.error.trim() !== '' ? (
        <p className="lib-comic-task__error">{task.error}</p>
      ) : null}
    </div>
  );
}

/* ─────────────── MascotEmptyState call sites ─────────────── */

function MascotEmptyState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  testTagPrefix?: string;
}) {
  return (
    <div className="lib-state" data-testid={props.testTagPrefix}>
      <p className="lib-state__title">{props.title}</p>
      <p className="lib-state__desc">{props.description}</p>
      {props.actionLabel !== undefined && props.onAction !== undefined ? (
        <button type="button" className="lib-search__go lib-state__action" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** LibraryWelcomeScreen.kt (LibraryScreen.kt:2483-2628). */
function LibraryWelcomeScreen(props: {
  onImportLocal: () => void;
  onOnlineSearch: () => void;
  onSourceManage: () => void;
  hasOnlineSource: boolean;
}) {
  return (
    <div className="lib-welcome">
      <span className="lib-welcome__mascot" aria-label="Roxy">
        ☕
      </span>
      <p className="lib-welcome__title">欢迎使用书库</p>
      <p className="lib-welcome__desc">
        在这里，您可以轻松导入本地电子书，或开启云端在线书源自由搜索。
      </p>
      <button type="button" className="lib-welcome__card" data-testid="welcome_import_local_card" onClick={props.onImportLocal}>
        <span className="lib-welcome__icon">
          <IconFolder />
        </span>
        <span>
          <p className="lib-welcome__card-title">本地阅读</p>
          <p className="lib-welcome__card-desc">直接导入手机中的 EPUB / TXT 电子书开始阅读</p>
        </span>
      </button>
      <button type="button" className="lib-welcome__card" data-testid="welcome_online_search_card" onClick={props.onOnlineSearch}>
        <span className="lib-welcome__icon lib-welcome__icon--secondary">
          <IconSearch />
        </span>
        <span>
          <p className="lib-welcome__card-title">在线搜索</p>
          <p className="lib-welcome__card-desc">
            {props.hasOnlineSource ? '开启云端搜索，检索图书资源' : '连接 Z-Library 云端书源检索图书'}
          </p>
        </span>
      </button>
      <button type="button" className="lib-welcome__card" data-testid="welcome_source_manage_card" onClick={props.onSourceManage}>
        <span className="lib-welcome__icon lib-welcome__icon--tertiary">
          <IconTune />
        </span>
        <span>
          <p className="lib-welcome__card-title">高级设置</p>
          <p className="lib-welcome__card-desc">管理书源或导入自定义 JSON 配置</p>
        </span>
      </button>
    </div>
  );
}

/* ─────────────── Aggregate grid body (LibraryScreen.kt:739-891) ─────────────── */

function AggregateGroupSection(props: {
  group: LibraryAggregateGroup;
  expanded: boolean;
  expandedNovel: Record<string, boolean>;
  coverHeadersFor: (book: SearchBook) => Record<string, string>;
  downloadStateOf: (book: SearchBook) => DownloadState;
  isDownloadedNovel: (book: SearchBook) => boolean;
  isFavorite: (book: SearchBook) => boolean;
  onToggleFavorite: (book: SearchBook, next: boolean) => void;
  onExpand: () => void;
  onOpenHeader: () => void;
  onOpenComic: (book: SearchBook) => void;
  onOpenNovelDetail: (book: SearchBook) => void;
}) {
  const { group } = props;
  const visibleBooks = useMemo(
    () => (props.expanded ? group.books : group.books.slice(0, AGGREGATE_PREVIEW_COUNT)),
    [group.books, props.expanded],
  );

  if (group.books.length > 0) {
    return (
      <>
        <AggregateSourceHeader
          name={group.sourceName}
          anchorId={group.sourceId}
          loading={group.loading}
          resultCount={group.books.length}
          onClick={props.onOpenHeader}
        />
        {visibleBooks.map((book) =>
          props.expandedNovel[book.sourceId] === true ? (
            <div key={`${group.sourceId}_${book.id}`} className="lib-grid__full">
              <NovelSearchCard
                book={book}
                sourceName={group.sourceName}
                state={props.downloadStateOf(book)}
                downloaded={props.isDownloadedNovel(book)}
                onClick={() => { props.onOpenNovelDetail(book); }}
              />
            </div>
          ) : (
            <StaggeredComicCardItem
              key={`${group.sourceId}_${book.id}`}
              book={book}
              coverHeaders={props.coverHeadersFor(book)}
              sourceName={group.sourceName}
              novel={false}
              favorite={props.isFavorite(book)}
              onToggleFavorite={(next) => { props.onToggleFavorite(book, next); }}
              onClick={() => { props.onOpenComic(book); }}
            />
          ),
        )}
        {!props.expanded && group.books.length > AGGREGATE_PREVIEW_COUNT ? (
          <AggregateExpandButton
            hiddenCount={group.books.length - visibleBooks.length}
            onExpand={props.onExpand}
          />
        ) : null}
      </>
    );
  }

  if (group.loading) {
    return (
      <>
        <AggregateSourceHeader
          name={group.sourceName}
          anchorId={group.sourceId}
          loading={group.loading}
          resultCount={0}
          onClick={props.onOpenHeader}
        />
        {STAGGER_RATIO_PALETTE.slice(0, 4).map((ratio, index) => (
          <div
            key={`skeleton-${String(index)}`}
            className="lib-skeleton"
            style={{ aspectRatio: `1 / ${String(ratio)}` }}
            aria-hidden="true"
          />
        ))}
      </>
    );
  }

  return (
    <>
      <AggregateSourceHeader
        name={group.sourceName}
        anchorId={group.sourceId}
        loading={group.loading}
        resultCount={0}
        onClick={props.onOpenHeader}
      />
      <AggregateSourceError error={group.error} />
    </>
  );
}

/* ─────────────── Runtime bootstrap ─────────────── */

/**
 * Android injects `LibraryViewModel(application)` through Hilt/ViewModelProvider; the
 * host here calls `setLibraryRuntime()` (see `core/library/libraryRuntime.ts`). Until a
 * host installs one, the page renders the Android `Empty` state, which is exactly what
 * the Kotlin screen shows with no sources registered.
 *
 * Read once at mount (like `viewModel { }`), never synchronised into state — a host that
 * installs a runtime later can remount the tab, exactly as Android recreates the screen.
 */
function useLibraryRuntime(): LibraryRuntime | null {
  return useMemo(() => getLibraryRuntime(), []);
}

/**
 * LibraryPage main component — a hook-order-safe rewrite of the
 * `LibraryScreen` body (LibraryScreen.kt:180-1231).
 *
 * Hook rules honoured here (React 19 / eslint-plugin-react-hooks v7):
 * - No conditional hooks: every `useState`/`useEffect`/`useMemo`/`useSyncExternalStore`
 *   runs unconditionally. The "no runtime installed yet" case is handled by an inert
 *   fallback `LibraryViewModel` (`emptyRuntimeViewModel()`) so `vm` is never null during
 *   render, and the fallback screens are returned AFTER all hooks.
 * - No `ref.current` read during render: the scroll helper writes a ref inside an effect
 *   and is only read from event handlers / effects.
 * - No `Math.random()` / `Date.now()` during render: the only time source is
 *   `performance.now()` inside the download-speed effect.
 * - No `setState` in a `useEffect` for derived data: derived values are `useMemo`;
 *   the effects that call setters only synchronise with external stores (the
 *   ViewModel's `MutableValue` cells, async getters, and the imported
 *   `preferencesreducedmotion`-style timers from the Kotlin `LaunchedEffect`s).
 * - No hooks inside `.map()`: every list item is a child component.
 */

let fallbackViewModel: LibraryViewModel | null = null;

/** An inert `LibraryViewModel` used until the host installs a real one. */
function emptyRuntimeViewModel(): LibraryViewModel {
  if (fallbackViewModel !== null) return fallbackViewModel;
  const noBooks = () => Promise.resolve([]);
  fallbackViewModel = new LibraryViewModel({
    prefs: {
      hasSeenWelcome: () => Promise.resolve(true),
      setHasSeenWelcome: () => Promise.resolve(),
      hasConfiguredSource: () => Promise.resolve(false),
      setHasConfiguredSource: () => Promise.resolve(),
      hasImportedLocalBook: () => Promise.resolve(false),
      setHasImportedLocalBook: () => Promise.resolve(),
      multiLanguageSearch: () => Promise.resolve(false),
      setMultiLanguageSearch: () => Promise.resolve(),
      multiLanguageOnlineLookup: () => Promise.resolve(false),
      setMultiLanguageOnlineLookup: () => Promise.resolve(),
      searchHistory: noBooks,
      setSearchHistory: () => Promise.resolve(),
    },
    sources: {
      initialize: () => Promise.resolve(),
      activeSource: () => null,
      availableSources: () => [],
      getSource: () => null,
      setActiveSource: () => Promise.resolve(),
      subscribeActiveSource: () => () => {},
    },
    downloads: {
      downloadStates: () => new Map(),
      subscribeDownloadStates: () => () => {},
      allTasks: noBooks,
      enqueueDownload: () => Promise.resolve(),
      pauseDownload: () => Promise.resolve(),
      resumeDownload: () => Promise.resolve(),
      cancelDownload: () => Promise.resolve(),
    },
    repository: {
      getAllBooksSync: noBooks,
      getBookBySourceResource: () => Promise.resolve(null),
      getAllFavoritesSync: noBooks,
    },
    recordMetadata: new ReadingRecordMetadata({
      getString: () => Promise.resolve(null),
      putString: () => Promise.resolve(),
    }),
  });
  return fallbackViewModel;
}

/**
 * 键盘避让高度 —— 对应 Android `LibraryScreen.kt:626-632` 的
 * `.windowInsetsPadding(WindowInsets.imeAnimationTarget)`。
 *
 * 端口层已经保证「一次升降只回调 2 次」（= 动画目标值，不是逐帧插值），
 * 那段 Kotlin 注释里的理由逐字适用：逐帧变化会让下方内容（检索图书插图、瀑布流网格）
 * 每帧重新测量布局，正是「点搜索框弹键盘卡」的根因。
 *
 * 所以这里只存一个数字，不做任何 transition/animation —— 让内容**跳**到
 * 最终位置，与 Kotlin 一致（Kotlin 侧同样没有位移动画）。
 *
 * ⚠️ 端口不可用（理论上不会：两套工厂都实现了 `keyboard`）时退回 0，
 * 即"没有键盘避让"，与 Kotlin 的 `WindowInsets.imeAnimationTarget` 为 0 等价。
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { getPlatform } = await import('@platform/index');
        const port = getPlatform().keyboard;
        if (cancelled) return;
        unsubscribe = port.subscribe((state) => {
          setInset(state.height);
        });
      } catch (error) {
        // 只取 message：这段每次挂载都跑，传整个 Error 会把堆栈刷进日志。
        // message 保留 `KEYBOARD_RESIZE_UNAVAILABLE` 等可搜索关键字。
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[library] keyboard 端口未生效，键盘避让按 0 处理：', reason);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return inset;
}

export function LibraryPage() {
  const runtime = useLibraryRuntime();
  const vm = runtime?.viewModel ?? emptyRuntimeViewModel();

  const setRoute = useAppStore((s) => s.setRoute);
  /* ── L622-632 `WindowInsets.imeAnimationTarget` 键盘避让 ── */
  const keyboardInset = useKeyboardInset();
  /* ── L238-250 local UI state (Compose `remember { mutableStateOf }`) ── */
  const [searchFieldFocused, setSearchFieldFocused] = useState(false);
  const [headerTailingOut, setHeaderTailingOut] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginMessage, setLoginMessage] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [activeDownloadBook, setActiveDownloadBook] = useState<SearchBook | null>(null);
  const [novelDetailBook, setNovelDetailBook] = useState<SearchBook | null>(null);
  const [novelDetailLoading, setNovelDetailLoading] = useState(false);
  const [novelDetailError, setNovelDetailError] = useState<string | null>(null);
  const [showSourceSheet, setShowSourceSheet] = useState(false);
  const [showJumpSheet, setShowJumpSheet] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [firstVisibleItem, setFirstVisibleItem] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [availableSources, setAvailableSources] = useState<BookSource[]>([]);
  const [currentSource, setCurrentSource] = useState<BookSource | null>(null);
  const [downloadStates, setDownloadStates] = useState<Map<string, DownloadState>>(new Map());
  const [downloadedNovelKeys, setDownloadedNovelKeys] = useState<Set<string>>(new Set());
  const [comicDownloadTasks, setComicDownloadTasks] = useState<ComicDownloadTask[]>([]);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const loginProbeTimer = useRef<number | null>(null);
  // LibraryScreen.kt:245 `var loginChecked by remember { mutableStateOf(false) }` — a
  // `remember` latch, so it survives recomposition but resets when the screen is re-entered.
  const loginCheckedRef = useRef(false);

  /* ── ViewModel lifecycle (Android `viewModelScope` + `DisposableEffect(Unit)`) ── */
  useEffect(() => {
    void vm.initialize();
    return () => {
      vm.dispose();
    };
  }, [vm]);

  /* ── L350-357 header collapse ──
   * ⚠️ 键盘收起瞬间卡顿的缓解：聚焦时立即收起；失焦时把「头部恢复」延后 120ms，
   * 让输入法的收起动画先跑完。That 120 ms tail is driven from the focus handler
   * (an event, not an effect) so no setState runs synchronously inside an effect. */
  const onSearchFocusChanged = useCallback((focused: boolean) => {
    setSearchFieldFocused(focused);
    setHeaderTailingOut(focused);
    if (!focused) {
      window.setTimeout(() => {
        setHeaderTailingOut(false);
      }, HEADER_RESTORE_MS);
    }
  }, []);
  const headerForceCollapse = searchFieldFocused || headerTailingOut;

  /* ── L426-443 the search field loses focus as soon as the list scrolls ── */
  useEffect(() => {
    if (!searchFieldFocused) return undefined;
    const onScroll = () => {
      onSearchFocusChanged(false);
    };
    const grid = gridRef.current;
    const results = resultsRef.current;
    grid?.addEventListener('scroll', onScroll, { passive: true });
    results?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      grid?.removeEventListener('scroll', onScroll);
      results?.removeEventListener('scroll', onScroll);
    };
  }, [searchFieldFocused, onSearchFocusChanged]);

  /* ── L381-395 performSearch: a new search always restarts at the top ── */
  const scrollToTop = useCallback(() => {
    scrollElementIntoView(gridRef.current, { block: 'start' });
    scrollElementIntoView(resultsRef.current, { block: 'start' });
  }, []);

  /* ── L892-911 / L494-504 AggregateJumpSheet → scroll the target group's header into view ── */
  const pendingJumpSourceId = useRef<string | null>(null);
  const scrollToGroup = useCallback((sourceId: string) => {
    const grid = gridRef.current;
    if (grid === null) return;
    const anchor = grid.querySelector(`[data-agg-group="${CSS.escape(sourceId)}"]`);
    const target = anchor ?? grid;
    scrollElementIntoView(target, { block: 'start' });
  }, []);

  const performSearch = useCallback(
    (keyword: string) => {
      if (keyword.trim() === '') return;
      // 新搜索从顶部开始：结果首屏回到中上部（修复视觉重心下移）
      scrollToTop();
      void vm.recordSearch(keyword);
      if (vm.aggregateModeState.value) {
        vm.aggregateSearch(keyword);
      } else {
        vm.search(keyword);
      }
    },
    [vm, scrollToTop],
  );

  /** L396-401 `val retryKeywordLookup: () -> Unit`. */
  const retryKeywordLookup = useCallback(() => {
    const keyword = vm.searchKeywordsState.value[0];
    if (keyword === undefined) return;
    if (vm.aggregateModeState.value) vm.aggregateSearch(keyword, true);
    else vm.search(keyword, true);
  }, [vm]);

  /* ── L727-737 expand-reset only on a genuinely new keyword ──
   * Kotlin `LaunchedEffect(searchQuery) { when (lastQueryForExpandReset) { … } }`.
   * Handled in `onSearchQueryChange` (the only writer of `searchQuery` in the Kotlin
   * screen), which keeps the "restore state is never cleared" rule without an effect. */
  const lastQueryForExpandReset = useRef<string | null>(null);
  const onSearchQueryChange = useCallback(
    (next: string) => {
      const last = lastQueryForExpandReset.current;
      if (last === null) {
        lastQueryForExpandReset.current = next;
      } else if (last !== next) {
        setExpandedGroups({});
        lastQueryForExpandReset.current = next;
      }
      setSearchQuery(next);
    },
    [],
  );

  /* ── L1083-1100 opening the novel detail sheet sets its loading/error state ── */
  const novelDetailRequestRef = useRef<SearchBook | null>(null);
  const openNovelDetail = useCallback((book: SearchBook) => {
    novelDetailRequestRef.current = book;
    setNovelDetailLoading(true);
    setNovelDetailError(null);
    setNovelDetailBook(book);
  }, []);

  /* ── L253-265 novel detail fetch on selection change ──
   * The effect is keyed on the (sourceId, id) pair exactly like Kotlin's
   * `LaunchedEffect(novelDetailBook?.sourceId, novelDetailBook?.id)`; the merge in
   * `novelDetail()` preserves both, so storing the resolved book never re-triggers it. */
  const detailSourceId = novelDetailBook?.sourceId ?? '';
  const detailId = novelDetailBook?.id ?? '';
  useEffect(() => {
    const book = novelDetailRequestRef.current;
    if (book === null) return undefined;
    let cancelled = false;
    void vm
      .novelDetail(book)
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'success') {
          setNovelDetailBook(result.data);
          setNovelDetailError(null);
        } else {
          setNovelDetailError(result.exception.message ?? '详情暂时无法加载');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setNovelDetailError(
          e instanceof Error ? (e.message ?? '详情暂时无法加载') : '详情暂时无法加载',
        );
      })
      .finally(() => {
        if (!cancelled) setNovelDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vm, detailSourceId, detailId]);

  /* ── L296-307 auto login probe ──
   * Kotlin: `LaunchedEffect(isZlibSource, aggregateMode) { if (isZlibSource &&
   * !aggregateMode && !loginChecked) { loginChecked = true; delay(1200); … } }`.
   * The gate and the `loginChecked` latch are load-bearing: without them the Z-Library
   * login sheet is raised for ANY active source that happens to be logged out. */
  useEffect(() => {
    // LibraryScreen.kt:236 `val isZlibSource = currentSource?.id == "zlibrary"`.
    if (currentSource?.id !== 'zlibrary') return undefined;
    if (vm.aggregateModeState.value) return undefined;
    if (loginCheckedRef.current) return undefined;
    loginCheckedRef.current = true;
    loginProbeTimer.current = window.setTimeout(() => {
      void vm.checkSourceLoginStatus();
      if (!vm.isCurrentSourceLoggedInState.value) {
        setShowLoginDialog(true);
        setLoginMessage('检测到未登录，登录后可正常下载（搜索无需登录）');
      }
    }, LOGIN_PROBE_MS);
    return () => {
      if (loginProbeTimer.current !== null) {
        window.clearTimeout(loginProbeTimer.current);
        loginProbeTimer.current = null;
      }
    };
    // `currentSource` and `aggregateModeState` mirror the two `LaunchedEffect` keys; the
    // `loginChecked` latch keeps this from re-arming on every one of their transitions.
  }, [vm, currentSource]);

  /* ── SourceManager subscription (L208 + L262-264) ── */
  useEffect(() => {
    const refresh = () => {
      setAvailableSources(vm.availableSources());
      setCurrentSource(vm.currentSource());
    };
    refresh();
    return vm.subscribeActiveSource(refresh);
  }, [vm]);

  /* ── Download state + shelf keys + comic task subscriptions ── */
  const comicDownloads = runtime?.comicDownloads ?? null;
  useEffect(() => {
    void vm.downloadStates().then(setDownloadStates);
    void vm.downloadedNovelKeys().then(setDownloadedNovelKeys);
    const offStates = vm.subscribeDownloadStates((next) => {
      setDownloadStates(next);
    });
    const offComic = comicDownloads?.subscribeTasks((tasks) => {
      setComicDownloadTasks([...tasks.values()]);
    });
    return () => {
      offStates();
      offComic?.();
    };
  }, [vm, comicDownloads]);

  /* ── rememberCoverHeaders (L2631-2643) ──
   * `LaunchedEffect(cover, book.sourceId) { source?.getCoverHeaders(cover) }` is
   * asynchronous; the web port renders the bare URL and falls back through the
   * `<img onError>` arm, which is the same visible result when a source adds no
   * mandatory headers (and never hangs the grid on a per-card network round trip). */
  const coverHeadersFor = useCallback((): Record<string, string> => ({}), []);

  /* ── L415-421 detail-page triggered search request ──
   * Kotlin `LaunchedEffect(detailSearchRequest?.token) { … }` → a subscription whose
   * callback performs the work, so no setState runs synchronously in the effect body. */
  useEffect(() => {
    let lastToken = 0;
    const off = vm.detailSearchRequestState.subscribe((request) => {
      if (request === null) return;
      if (request.token === lastToken) return;
      lastToken = request.token;
      setSearchQuery(request.keyword);
      performSearch(request.keyword);
      vm.consumeDetailSearch(request.token);
    });
    return off;
  }, [vm, performSearch]);

  /* ── Flows ── */
  const aggregateMode = useFlow(vm.aggregateModeState);
  const aggregateKind = useFlow(vm.aggregateKindState);
  const multiLangSearch = useFlow(vm.multiLanguageSearchState);
  const onlineKeywordLookup = useFlow(vm.onlineKeywordLookupState);
  const searchKeywords = useFlow(vm.searchKeywordsState);
  const keywordStatus = useFlow(vm.keywordStatusState);
  const keywordOrigins = useFlow(vm.keywordOriginsState);
  const keywordDispatches = useFlow(vm.keywordDispatchesState);
  const keywordProviders = useFlow(vm.keywordProvidersState);
  const searchHistory = useFlow(vm.searchHistoryState);
  const errorMessage = useFlow(vm.errorMessageState);
  const hasSeenWelcome = useFlow(vm.hasSeenWelcomeState);
  const isCurrentSourceLoggedIn = useFlow(vm.isCurrentSourceLoggedInState);
  const formatPickerBook = useFlow(vm.formatPickerBookState);
  const pendingFormats = useFlow(vm.pendingFormatsState);
  const formatLoading = useFlow(vm.formatLoadingState);
  const novelUpdate = useFlow(vm.novelUpdateState);
  const uiState = useFlow(vm.uiStateState);

  /* ── L321-325 auto-open the download panel when a comic download is live ── */
  const comicDownloadingCount = vm.comicDownloading().size;
  useEffect(() => {
    if (comicDownloadingCount === 0) return;
    const timer = window.setTimeout(() => {
      setShowDownloadPanel(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [comicDownloadingCount]);

  /* ── L721 `val aggResults = uiState as? LibraryUiState.AggregateResults` ── */
  const aggResults = uiState.kind === 'AggregateResults' ? uiState : null;

  /* ── L205-206 keywordPreviewWords / keywordPreviewCount ── */
  const keywordPreviewWords = useMemo(
    () => (multiLangSearch ? searchKeywords : []),
    [multiLangSearch, searchKeywords],
  );
  const keywordPreviewCount = keywordPreviewWords.length === 0 ? 0 : 1;

  /* ── L407-409 visibleSources + the v1.0.1 partitioned picker lists ── */
  const visibleSources = useMemo(
    () => availableSources.filter((it) => !it.capabilities.environmentOnly),
    [availableSources],
  );
  // L1182-1186 — `visibleSources.filter { it.isComicSource }`. NOT `!isNovelSource`:
  // a plain book source (no comic, no ebook/text) is neither, and Android hides it from
  // both sections.
  const comicSources = useMemo(() => visibleSources.filter((it) => isComicSource(it)), [visibleSources]);
  const novelSources = useMemo(() => visibleSources.filter((it) => isNovelSource(it)), [visibleSources]);
  const expandedNovelSources = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const source of availableSources) {
      if (isNovelSource(source)) out[source.id] = true;
    }
    return out;
  }, [availableSources]);

  /* ── L363-379 headerFraction ── */
  const fraction = useMemo(
    () =>
      headerFraction(
        headerForceCollapse || searchFieldFocused,
        firstVisibleItem,
        0,
        0,
        0,
        HEADER_COLLAPSE_PX,
      ),
    [headerForceCollapse, searchFieldFocused, firstVisibleItem],
  );

  const activeGroupIdx = useMemo(
    () =>
      aggResults === null
        ? -1
        : activeAggregateGroupIndex(
            aggResults.groups,
            expandedGroups,
            firstVisibleItem,
            keywordPreviewCount,
          ),
    [aggResults, expandedGroups, firstVisibleItem, keywordPreviewCount],
  );

  /* ── L680 the "curtain" history panel visibility ── */
  const historyPanelVisible =
    searchFieldFocused && searchQuery.trim() === '' && searchHistory.length > 0;

  /* ── L310-319 download timeout hint ── */
  const activeDownloadKey =
    activeDownloadBook === null ? '' : vm.novelTaskKey(activeDownloadBook);
  useEffect(() => {
    if (activeDownloadKey === '') return undefined;
    const timer = window.setTimeout(() => {
      const st = downloadStates.get(activeDownloadKey);
      if (st === undefined || st.kind === 'Idle') {
        showToast('未能获取下载链接（可能需要登录），可稍后重试');
      }
    }, DOWNLOAD_HINT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeDownloadKey, downloadStates]);

  /* ── Derived render inputs ── */
  const searchResults = useMemo(
    () => (uiState.kind === 'SearchResults' ? uiState.results : []),
    [uiState],
  );
  /** L187-191 favoriteKeys: "sourceId::comicId" set from the favorites table. */
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(runtime?.favoriteKeys ?? []);
  const favoritesVisible = useFavoriteVisibility();
  useEffect(() => {
    let cancelled = false;
    void runtime?.favorites?.favoriteKeys().then((keys) => { if (!cancelled) setFavoriteKeys([...keys]); });
    return () => { cancelled = true; };
  }, [runtime]);
  /** L799 / L1161 the favourite toggle entry point on a result card. */
  const onToggleFavorite = useCallback(
    (book: SearchBook, next: boolean) => {
      if (!favoritesVisible) { showToast('请先在书架验证「我喜欢的」隐私密码'); return; }
      if (runtime?.onToggleFavorite) { runtime.onToggleFavorite(book, next); return; }
      const favorites = runtime?.favorites;
      if (!favorites) { showToast('收藏服务尚未准备好，请重试'); return; }
      void (next ? favorites.add(book) : favorites.remove(book.sourceId, book.id))
        .then(() => favorites.favoriteKeys()).then((keys) => setFavoriteKeys([...keys]))
        .catch((error: unknown) => showToast(error instanceof Error ? error.message : '收藏保存失败'));
    },
    [runtime, favoritesVisible],
  );

  /* ── L463-477 only follow the first aggregate hit while at the top ── */
  const hasAggregateBooks =
    aggResults !== null && aggResults.groups.some((it) => it.books.length > 0);
  useEffect(() => {
    if (!hasAggregateBooks) return;
    if (firstVisibleItem !== 0) return;
    // Kotlin: `staggeredGridState.scrollToItem(0)` once the first hit lands at the top.
    scrollToTop();
  }, [hasAggregateBooks, firstVisibleItem, scrollToTop]);

  /* ── L493-504 a jump target re-aligns on every group update until it finishes loading ── */
  useEffect(() => {
    const targetId = pendingJumpSourceId.current;
    if (targetId === null || aggResults === null) return;
    const index = aggResults.groups.findIndex((it) => it.sourceId === targetId);
    if (index < 0) {
      pendingJumpSourceId.current = null;
      return;
    }
    scrollToGroup(targetId);
    const target = aggResults.groups[index];
    if (target !== undefined && !target.loading) pendingJumpSourceId.current = null;
  }, [aggResults, keywordPreviewCount, scrollToGroup]);

  const isSearching = uiState.kind === 'Searching';
  const errorCopy = uiState.kind === 'Error' ? libraryErrorCopy(uiState.error) : null;
  const currentSourceId = currentSource?.id ?? null;
  const sourceLabel = aggregateMode
    ? aggregateKind === 'novel'
      ? '全部小说'
      : '全部漫画'
    : (currentSource?.name ?? '书源');

  const downloadStateOf = useCallback(
    (book: SearchBook): DownloadState => vm.idleStateOf(downloadStates, vm.novelTaskKey(book)),
    [vm, downloadStates],
  );
  /** LibraryScreen.kt:786 `downloaded = taskId(book.sourceId, book.id) in downloadedNovelKeys`. */
  const isDownloadedNovel = useCallback(
    (book: SearchBook) => downloadedNovelKeys.has(vm.novelTaskKey(book)),
    [vm, downloadedNovelKeys],
  );
  const isFavorite = useCallback(
    (book: SearchBook) => favoritesVisible && favoriteKeys.includes(`${book.sourceId}::${book.id}`),
    [favoriteKeys, favoritesVisible],
  );
  const latestDownloadState = useMemo(
    () => (activeDownloadBook === null ? null : downloadStateOf(activeDownloadBook)),
    [activeDownloadBook, downloadStateOf],
  );

  /* ── L527-554 the welcome gate / the no-runtime fallback ── */
  if (runtime === null) {
    return (
      <div className="lib-page">
        <LibraryCollapsingHeader
          fraction={0}
          focusDriven={false}
          title="书库"
          subtitle="LIBRARY & SEARCH"
          titleColor="#18191C"
        />
        <MascotEmptyState
          title="检索图书"
          description="在上方输入书名、作者或关键词"
          actionLabel="管理与导入书源"
          testTagPrefix="search_empty_state"
          onAction={() => {
            setRoute('sourceManagement');
          }}
        />
      </div>
    );
  }

  if (!hasSeenWelcome) {
    return (
      <div className="lib-page">
        <LibraryWelcomeScreen
          hasOnlineSource={visibleSources.length > 0}
          onImportLocal={() => {
            void vm.markLocalBookImported();
            void vm.markWelcomeSeen();
            setRoute('main');
          }}
          onOnlineSearch={() => {
            const onlineSource = visibleSources[0];
            if (onlineSource !== undefined) {
              vm.selectSource(onlineSource.id);
              void vm.markWelcomeSeen();
            } else {
              setRoute('sourceManagement');
              void vm.markWelcomeSeen();
            }
          }}
          onSourceManage={() => {
            void vm.markWelcomeSeen();
            setRoute('sourceManagement');
          }}
        />
      </div>
    );
  }

  const comicActive = comicDownloadingCount > 0;

  return (
    <div className="lib-page">
      {/* L583-620 LibraryCollapsingHeader + the download-panel IconButton */}
      <LibraryCollapsingHeader
        fraction={fraction}
        focusDriven={headerForceCollapse}
        title="书库"
        subtitle="LIBRARY & SEARCH"
        titleColor="#18191C"
        trailing={
          <button
            type="button"
            className={
              latestDownloadState?.kind === 'Downloading' || comicActive
                ? 'lib-icon-button lib-icon-button--active'
                : 'lib-icon-button'
            }
            aria-label="下载任务"
            onClick={() => {
              setShowDownloadPanel(!showDownloadPanel);
            }}
          >
            {latestDownloadState?.kind === 'Downloading' || comicActive ? (
              <span className="lib-icon-button__spinner" />
            ) : null}
            <IconDownload />
          </button>
        }
      />

      {/* L622-632 的 `.windowInsetsPadding(WindowInsets.imeAnimationTarget)` —
          `keyboardInset` 是「动画目标值」高度，一次升降只变 2 次（不逐帧重排）。
          ⚠️ inline 里必须**保留** `env(safe-area-inset-bottom)`：CSS 原本的
          `padding-bottom: calc(16px + env(safe-area-inset-bottom))` 会被 inline 覆盖，
          漏掉它会让三键导航/底部手势条机型压住最后一排卡片。 */}
      <div
        className="lib-page__body"
        style={{
          paddingBottom: `calc(16px + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)`,
        }}
      >
        {/* L635-647 UnifiedSearchField */}
        <UnifiedSearchField
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          onSearch={() => {
            performSearch(searchQuery);
          }}
          onFocusChanged={onSearchFocusChanged}
          onSourceClick={() => {
            setShowSourceSheet(true);
          }}
          sourceLabel={sourceLabel}
          searchFocused={searchFieldFocused}
        />

        {/* L649-673 the errorContainer banner */}
        {errorMessage !== null ? (
          <div className="lib-error-banner">
            <p className="lib-error-banner__text">{errorMessage}</p>
            {currentSource?.capabilities.downloadRequiresLogin === true && !isCurrentSourceLoggedIn ? (
              <button
                type="button"
                className="lib-error-banner__action"
                onClick={() => {
                  setRoute('sourceManagement');
                }}
              >
                去管理/登录
              </button>
            ) : null}
          </div>
        ) : null}

        {/* L693-719 the search-history curtain */}
        {historyPanelVisible ? (
          <SearchHistoryPanel
            history={searchHistory}
            onPick={(query) => {
              setSearchQuery(query);
              performSearch(query);
            }}
            onDelete={(query) => {
              void vm.removeSearchHistory(query);
            }}
            onClearAll={() => {
              void vm.clearSearchHistory();
            }}
          />
        ) : null}

        {/* L721-912 the aggregate results grid */}
        {aggregateMode && aggResults !== null ? (
          <>
            <KeywordSearchPreview
              key={keywordPreviewWords[0] ?? '__none__'}
              words={keywordPreviewWords}
              status={keywordStatus}
              origins={keywordOrigins}
              submitted={keywordDispatches}
              providers={keywordProviders}
              onRetry={retryKeywordLookup}
            />
            <div
              className="lib-grid"
              ref={gridRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                setFirstVisibleItem(el.scrollTop < 24 ? 0 : Math.max(1, Math.round(el.scrollTop / 100)));
              }}
            >
              {aggResults.groups.map((group) => (
                <AggregateGroupSection
                  key={group.sourceId}
                  group={group}
                  expanded={expandedGroups[group.sourceId] === true}
                  expandedNovel={expandedNovelSources}
                  coverHeadersFor={coverHeadersFor}
                  downloadStateOf={downloadStateOf}
                  isDownloadedNovel={isDownloadedNovel}
                  isFavorite={isFavorite}
                  onToggleFavorite={onToggleFavorite}


                  onExpand={() => {
                    setExpandedGroups((prev) => ({ ...prev, [group.sourceId]: true }));
                  }}
                  onOpenHeader={() => {
                    setShowJumpSheet(true);
                  }}
                  onOpenComic={(book) => {
                    openOnlineBook(book);
                  }}
                  onOpenNovelDetail={(book) => {
                    openNovelDetail(book);
                  }}
                />
              ))}
              {!aggResults.running && !aggResults.groups.some((it) => it.books.length > 0) ? (
                <div className="lib-grid__full">
                  <MascotEmptyState
                    title="未找到结果"
                    description={`所有${aggregateKind === 'novel' ? '小说源' : '漫画源'}都没有匹配“${searchQuery}”的内容`}
                    actionLabel="管理与导入书源"
                    testTagPrefix="aggregate_empty_state"
                    onAction={() => {
                      setRoute('sourceManagement');
                    }}
                  />
                </div>
              ) : null}
            </div>
            {firstVisibleItem > 8 ? (
              <button
                type="button"
                className="lib-top-fab"
                aria-label="回到顶部"
                onClick={() => {
                  scrollToTop();
                }}
              >
                <IconArrowUpward />
              </button>
            ) : null}
            {showJumpSheet ? (
              <AggregateJumpSheet
                groups={aggResults.groups}
                activeGroupIdx={activeGroupIdx}
                onDismiss={() => {
                  setShowJumpSheet(false);
                }}
                onJump={(idx) => {
                  setShowJumpSheet(false);
                  // LibraryScreen.kt:897-909
                  if (idx < 0) {
                    pendingJumpSourceId.current = null;
                    scrollToTop();
                    return;
                  }
                  const target = aggResults.groups[idx];
                  if (target === undefined) {
                    pendingJumpSourceId.current = null;
                    return;
                  }
                  pendingJumpSourceId.current = target.sourceId;
                  scrollToGroup(target.sourceId);
                }}
              />
            ) : null}
          </>
        ) : null}

        {/* L913-990 searching / error / empty state */}
        {!aggregateMode && (isSearching || uiState.kind === 'Error' || searchResults.length === 0) ? (
          <div className="lib-results" ref={resultsRef}>
            <KeywordSearchPreview
              key={keywordPreviewWords[0] ?? '__none__'}
              words={keywordPreviewWords}
              status={keywordStatus}
              origins={keywordOrigins}
              submitted={keywordDispatches}
              providers={keywordProviders}
              onRetry={retryKeywordLookup}
            />
            {isSearching ? (
              // LibraryScreen.kt:922-934 — the searching branch is a bare
              // `ChasingDots(size = 52.dp, color = secondary)`, no title/description.
              <div className="lib-state" data-testid="search_status">
                <ChasingDots size={52} />
              </div>
            ) : errorCopy !== null ? (
              <MascotEmptyState
                title={errorCopy.title}
                description={errorCopy.description}
                actionLabel={errorCopy.action}
                testTagPrefix="search_error_state"
                onAction={() => {
                  if (uiState.kind === 'Error' && uiState.error.kind === 'AuthenticationRequired') {
                    setRoute('sourceManagement');
                  } else {
                    performSearch(searchQuery);
                  }
                }}
              />
            ) : (
              <MascotEmptyState
                title={searchQuery.trim() === '' ? '检索图书' : '未找到结果'}
                description={
                  searchQuery.trim() === ''
                    ? '在上方输入书名、作者或关键词'
                    : `未找到与“${searchQuery}”匹配的内容，请尝试更换关键词或书源`
                }
                actionLabel="管理与导入书源"
                testTagPrefix="search_empty_state"
                onAction={() => {
                  setRoute('sourceManagement');
                }}
              />
            )}
          </div>
        ) : null}

        {/* L992-1042 the single-source result list */}
        {!aggregateMode && !isSearching && uiState.kind !== 'Error' && searchResults.length > 0 ? (
          <div className="lib-results" ref={resultsRef}>
            <KeywordSearchPreview
              key={keywordPreviewWords[0] ?? '__none__'}
              words={keywordPreviewWords}
              status={keywordStatus}
              origins={keywordOrigins}
              submitted={keywordDispatches}
              providers={keywordProviders}
              onRetry={retryKeywordLookup}
            />
            {searchResults.map((book) =>
              currentSource !== null && isNovelSource(currentSource) ? (
                <NovelSearchCard
                  key={`${book.sourceId}_${book.id}`}
                  book={book}
                  sourceName={currentSource.name}
                  state={downloadStateOf(book)}
                  downloaded={downloadedNovelKeys.has(vm.novelTaskKey(book))}
                  onClick={() => {
                    openNovelDetail(book);
                  }}
                />
              ) : (
                <LibraryBookCardItem
                  key={`${book.sourceId}_${book.id}`}
                  book={book}
                  downloadState={downloadStateOf(book)}
                  coverHeaders={coverHeadersFor()}
                  comicMode={
                    currentSource?.capabilities.supportComic === true ||
                    currentSource?.capabilities.supportOnlineText === true
                  }
                  favorite={isFavorite(book)}
                  onToggleFavorite={(next) => {
                    onToggleFavorite(book, next);
                  }}
                  onStartDownload={() => {
                    if (
                      currentSource?.capabilities.supportComic === true ||
                      currentSource?.capabilities.supportOnlineText === true
                    ) {
                      openOnlineBook(book);
                    } else if (
                      // LibraryScreen.kt:1029-1031 — a source that requires login raises the
                      // login dialog instead of enqueuing the download.
                      currentSource?.capabilities.downloadRequiresLogin === true &&
                      !isCurrentSourceLoggedIn
                    ) {
                      runtime.openZLibraryLoginDialog?.(currentSource);
                    } else {
                      setActiveDownloadBook(book);
                      setShowDownloadPanel(true);
                      vm.startDownload(book);
                    }
                  }}
                  onPauseDownload={() => {
                    vm.pauseDownload(vm.novelTaskKey(book));
                  }}
                  onResumeDownload={() => {
                    vm.resumeDownload(vm.novelTaskKey(book));
                  }}
                  onCancelDownload={() => {
                    vm.cancelDownload(vm.novelTaskKey(book));
                  }}
                />
              ),
            )}
          </div>
        ) : null}
      </div>

      {/* L1046-1077 LibraryLoginDialog */}
      {showLoginDialog ? (
        <LibraryLoginDialog
          message={loginMessage}
          loading={loginLoading}
          registerUrl={Z_LIBRARY_REGISTRATION_URL}
          onLogin={(email, password) => {
            const src = currentSource;
            if (src === null) {
              setLoginLoading(false);
              setLoginMessage('当前书源不可用');
              return;
            }
            setLoginLoading(true);
            setLoginMessage('登录中…');
            void src
              .login(createLoginCredential({ username: email, password }))
              .then((result) => {
                if (result.kind === 'success') {
                  setLoginLoading(false);
                  setLoginMessage('登录成功');
                  setShowLoginDialog(false);
                  vm.checkSourceLoginStatus();
                } else {
                  setLoginLoading(false);
                  setLoginMessage(result.exception.message ?? '登录失败，请检查账号密码');
                }
              })
              .catch(() => {
                setLoginLoading(false);
                setLoginMessage('登录失败，请检查账号密码');
              });
          }}
          onDismiss={() => {
            if (!loginLoading) setShowLoginDialog(false);
          }}
        />
      ) : null}

      {/* L1083-1100 NovelDetailSheet */}
      {novelDetailBook !== null ? (
        <NovelDetailSheet
          book={novelDetailBook}
          sourceName={
            availableSources.find((it) => it.id === novelDetailBook.sourceId)?.name ?? ''
          }
          loading={novelDetailLoading}
          error={novelDetailError}
          state={downloadStateOf(novelDetailBook)}
          hasLocal={downloadedNovelKeys.has(vm.novelTaskKey(novelDetailBook))}
          onDismiss={() => {
            setNovelDetailBook(null);
          }}
          onDownload={() => {
            // LibraryScreen.kt:1089-1097 — `source.launch { if (downloadRequiresLogin &&
            // !source.isLoggedIn()) loginDialogSource = source else startDownload(…) }`.
            const src = availableSources.find((it) => it.id === novelDetailBook.sourceId);
            if (src === undefined) {
              if (novelDetailBook.sourceId === 'zlibrary') vm.startDownload(novelDetailBook);
              else vm.startDownloadWithFormat(novelDetailBook, novelDetailBook.format);
              return;
            }
            if (src.capabilities.downloadRequiresLogin !== true) {
              if (novelDetailBook.sourceId === 'zlibrary') vm.startDownload(novelDetailBook);
              else vm.startDownloadWithFormat(novelDetailBook, novelDetailBook.format);
              return;
            }
            void src.isLoggedIn().then((loggedIn) => {
              if (!loggedIn) {
                runtime.openZLibraryLoginDialog?.(src);
                return;
              }
              if (novelDetailBook.sourceId === 'zlibrary') vm.startDownload(novelDetailBook);
              else vm.startDownloadWithFormat(novelDetailBook, novelDetailBook.format);
            });
          }}
          onRead={() => {
            void vm.localNovel(novelDetailBook).then((local) => {
              if (local !== null) {
                setNovelDetailBook(null);
                setRoute('reader');
              }
            });
          }}
          onPause={() => {
            vm.pauseDownload(vm.novelTaskKey(novelDetailBook));
          }}
          onResume={() => {
            vm.resumeDownload(vm.novelTaskKey(novelDetailBook));
          }}
          onCancel={() => {
            vm.cancelDownload(vm.novelTaskKey(novelDetailBook));
          }}
        />
      ) : null}

      {/* NovelUpdatePanel (NovelBookUi.kt:276-288) */}
      {novelUpdate !== null ? (
        <NovelUpdateSheet
          localTitle={novelUpdate.local.title}
          sourceName={novelUpdate.sourceName}
          loading={novelUpdate.loading}
          remoteInfo={novelUpdate.remote?.novelInfo ?? null}
          changed={novelUpdate.changed}
          error={novelUpdate.error}
          state={novelUpdateDownloadState(novelUpdate, downloadStates)}
          localFilePath={novelUpdate.local.filePath ?? ''}
          onDismiss={() => {
            vm.dismissNovelUpdate();
          }}
          onRetry={() => {
            vm.checkNovelUpdate(novelUpdate.local);
          }}
          onDownload={() => {
            if (novelUpdate.remote !== null) vm.downloadNovelUpdate(novelUpdate.remote);
          }}
          onPause={() => {
            const key = novelUpdateTaskKey(novelUpdate);
            if (key !== null) vm.pauseDownload(key);
          }}
          onResume={() => {
            const key = novelUpdateTaskKey(novelUpdate);
            if (key !== null) vm.resumeDownload(key);
          }}
          onCancel={() => {
            const key = novelUpdateTaskKey(novelUpdate);
            if (key !== null) vm.cancelDownload(key);
          }}
        />
      ) : null}

      {/* L1103-1112 FormatPickerDialog */}
      {formatPickerBook !== null ? (
        <FormatPickerDialog
          bookTitle={formatPickerBook.title}
          formats={pendingFormats}
          loading={formatLoading}
          onPick={(fmt) => {
            vm.startDownloadWithFormat(formatPickerBook, fmt.format);
          }}
          onDismiss={() => {
            vm.dismissFormatPicker();
          }}
        />
      ) : null}

      {/* L1115-1176 the acrylic download-management overlay */}
      {showDownloadPanel ? (
        comicDownloadTasks.length > 0 ? (
          <div
            className="lib-download-overlay"
            onClick={() => {
              setShowDownloadPanel(false);
            }}
          >
            <ComicDownloadGlassCard
              tasks={comicDownloadTasks}
              onPause={(chapterId) => {
                vm.pauseComicChapter(chapterId);
              }}
              onResume={(id) => {
                const task = comicDownloadTasks.find((it) => it.chapterId === id);
                if (task !== undefined) vm.downloadComicChapter(task.book, task.chapter);
              }}
              onRetry={(id) => {
                const task = comicDownloadTasks.find((it) => it.chapterId === id);
                if (task !== undefined) vm.retryComicChapter(task.book, task.chapter);
              }}
              onCancel={(chapterId) => {
                vm.cancelComicChapter(chapterId);
              }}
              onDismiss={() => {
                setShowDownloadPanel(false);
              }}
            />
          </div>
        ) : (
          <DownloadGlassCard
            book={activeDownloadBook}
            state={latestDownloadState ?? DownloadStateIdle}
            onDismiss={() => {
              setShowDownloadPanel(false);
            }}
            onPause={
              activeDownloadBook === null
                ? null
                : () => {
                    vm.pauseDownload(vm.novelTaskKey(activeDownloadBook));
                  }
            }
            onResume={
              activeDownloadBook === null
                ? null
                : () => {
                    vm.resumeDownload(vm.novelTaskKey(activeDownloadBook));
                  }
            }
            onCancel={
              activeDownloadBook === null
                ? null
                : () => {
                    vm.cancelDownload(vm.novelTaskKey(activeDownloadBook));
                  }
            }
          />
        )
      ) : null}

      {/* L1179-1228 SourcePickerSheet */}
      {showSourceSheet ? (
        <SourcePickerSheet
          aggregateMode={aggregateMode}
          aggregateKind={aggregateKind}
          currentSourceId={currentSourceId}
          comicSources={comicSources}
          novelSources={novelSources}
          multiLanguageSearch={multiLangSearch}
          onToggleMultiLanguageSearch={(value) => {
            void vm.setMultiLanguageSearch(value);
          }}
          onlineKeywordLookup={onlineKeywordLookup}
          onToggleOnlineKeywordLookup={(value) => {
            if (value === onlineKeywordLookup) return;
            void vm.setOnlineKeywordLookup(value);
            // A finished preview belongs to the previous policy. Re-run the
            // submitted query when enabling, never an unfinished draft.
            if (value && searchKeywords.length > 0) {
              performSearch(searchKeywords[0] as string);
            }
          }}
          onSelectAggregate={(kind) => {
            vm.setAggregateMode(true);
            vm.setAggregateKind(kind);
            // 双状态残留修复：切模式后非活跃视图的滚动位置不清零会让折叠头部错误保持收起
            scrollToTop();
            setShowSourceSheet(false);
          }}
          onSelectSource={(id) => {
            vm.selectSource(id);
            scrollToTop();
            setShowSourceSheet(false);
          }}
          onManageSources={() => {
            setShowSourceSheet(false);
            setRoute('sourceManagement');
          }}
          onDismiss={() => {
            setShowSourceSheet(false);
          }}
        />
      ) : null}
    </div>
  );
}

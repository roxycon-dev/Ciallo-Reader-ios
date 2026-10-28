/**
 * 漫画主页面（漫画章节列表）— 逐行移植 Android
 * `com/example/ui/ComicChaptersScreen.kt`（共 1568 行）。
 *
 * 纯逻辑（行模型 / 文案 / 卡片规格 / 数据源）全部在
 * `@core/comic/comicChapters`；本文件只做「状态 → DOM」，样式在
 * `styles/comicChapters.css`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Kotlin 行 → TS 位置对照
 * ─────────────────────────────────────────────────────────────────────────
 * | Kotlin 行 | 内容 | TS 位置 |
 * |---|---|---|
 * | 1–91 | package + import | 见下方 import（标识符 1:1） |
 * | 93–100 | 神回配色 + `LIST_HEADER_ITEMS` | `@core/comic/comicChapters` 常量 + `GodGold*` CSS 变量 |
 * | 102–109 | 页面 KDoc | 本文件头注释 |
 * | 110–162 | `ComicChaptersScreen(参数表)` | `ComicChaptersPage()`；参数 → `useComicChaptersSnapshot()` 的快照字段 + `ComicChaptersPorts` 回调 |
 * | 163–170 | ordered / stateOnly / target / newIds | `orderedOf` `stateOnlyOf` `continueTargetOf` `newChapterIdSetOf`（useMemo） |
 * | 172–175 | `sortDesc` + `displayChapters` | `sortDesc` state + `displayChaptersOf` |
 * | 177 | `rememberLazyListState()` | `scrollRef` + `scrollToListItem()`（CSS `overflow-y` + `scrollTo`） |
 * | 178 | `highlightId` | `comicHighlightStore`（外部 store，`useSyncExternalStore`） |
 * | 179–180 | `selectionMode` / `selectedChapterIds` | `selectionMode` / `selectedChapterIds` state |
 * | 183 | `rememberGodEditBinding()` | 长按神回卡 → `setGodEditTarget(id)` + `setRoute('godEditor')`（既有 `GodEditorPage`） |
 * | 184 | `rememberReduceMotion()` | `usePrefersReducedMotion()`（`prefers-reduced-motion`，同 `GodRankingPage`） |
 * | 186–191 | godList / godChapterIds / normalChapters | `godListOf` `godChapterIdsOf` `normalChaptersOf` |
 * | 193–200 | `rowIndexOf` | `rowIndexOf` / `listItemIndexOf` |
 * | 202–214 | 神回跳转定位 + 金色高亮 | `useEffect` → `scrollToListItem` + `comicHighlightStore.pulse(id, 1600)` |
 * | 216–233 | 进入页面自动定位续读 | `useEffect` → `focusIndexOf` + `pulse(id, 1000)` |
 * | 235–238 | `onMarkSeen()` | `useEffect` → `comicChaptersStore.markSeen()` |
 * | 240–241 | `readCount` | `readCountOf` |
 * | 243–253 | `continueTargetChapter()` | `continueTargetChapterOf` / `continueButtonLabelOf` |
 * | 255–258 | `exitSelection()` | `exitSelection()` |
 * | 260–264 | 多选时 BackHandler 先退出多选 | `useEffect` Escape 键（Web 无 BackHandler） |
 * | 266–267 | `Scaffold(containerColor = background)` | `.cc-root`（浅色 `#FFFFFF`） |
 * | 268–335 | topBar（多选顶栏 / 返回+标题） | `ComicTopBar` |
 * | 336–448 | bottomBar（下载 N 话 / ♥ + 继续阅读） | `ComicBottomBar` |
 * | 449–460 | loading 态 | `.cc-state` + `ChasingDots`（`正在加载章节…`） |
 * | 461–472 | error 态 | `.cc-state` + `重试` / `换源` |
 * | 474–483 | `SourceUnavailableBanner` | 复用 `@ui/components/favorite/ComicDetailActions` |
 * | 485–491 | LazyColumn(contentPadding 16/8, spacedBy 8) | `.cc-scroll`（`padding: 8px 16px` + `gap: 8px`） |
 * | 493 | hero item | `ComicHeroHeader` + `ComicMetadataBlock` |
 * | 496–513 | 信息行 | `infoRowLabelOf` + `.cc-info` |
 * | 515–597 | 工具行 | `ComicToolbar` + `latestChapterListItemIndex` |
 * | 599–628 | 多选快捷胶囊 | `QuickPill` ×3 + `quickSelectUnread` / `quickSelectLastTen` / `quickInvert` |
 * | 632–675 | 神回卡 item | `GodCard` |
 * | 676–742 | 普通章节 item | `ChapterCard` + `chapterProgressOf` + `chapterCardSpecOf` |
 * | 748–759 | 下载进度悬浮窗 | `DownloadProgressOverlay` + `comicDownloadStore` |
 * | 761–769 | `GodMomentEditHost(onSaved)` | `GodEditorPage` 路由（保存后本页回到前台时不再重复提示） |
 * | 774–789 | `QuickPill` | `QuickPill` |
 * | 791–1055 | `ChapterCardSpec` | `ChapterCard`（`useCardGestures` 承担滑动书签 + 长按） |
 * | 1057–1242 | `GodCardSpec` | `GodCard` |
 * | 1244–1274 | `CheckCircleSpec` | `CheckCircle` |
 * | 1276–1460 | `ComicHeroHeader` | `ComicHeroHeader` |
 * | 1462–1541 | `DownloadProgressOverlay` | `DownloadProgressOverlay` |
 * | 1543–1568 | `Modifier.longPressDetector(500ms)` | `useLongPressDetector`（同 500ms + touchSlop 判定） |
 *
 * ── 跳过（逐条说明）────────────────────────────────────────────────────
 * - import 语句（L3–91）→ TS import。Compose/Android 专有类型
 *   （Modifier / DrawScope / SemanticsPropertyReceiver / Brush / Path…）无对应物。
 * - L89 `LocalView` + L892/894/1106/1108 `performHapticFeedback`：
 *   Android 触觉（`HapticsGate`）—— 长按/滑动判定完整保留，震动本身跳过。
 * - L183 + L761–769：页内自持的神回编辑窗（`GodMomentSheet.kt` 56KB）→
 *   复用既有 `GodEditorPage`（同一实体、同一保存路径）。
 * - L262–264 `BackHandler`：Web 无系统返回键 → Escape 等价。
 * - L1296–1330 `RenderEffect.createBlurEffect(30f, 30f, CLAMP)`（API 31+）
 *   与 L1305–1329 的低版本 `drawWithContent` 兜底 → 一律 `filter: blur(30px)`。
 * - L1118 `memoryCacheKey` / L1119 `crossfade(220)` → `<img>` 的 `onError`
 *   兜底 + CSS `transition: opacity 220ms`（key 字符串本身在 core 里保留）。
 * - L1365 `consistentShadow(12.dp, …)` / L1477 `consistentShadow(10.dp, …)`
 *   → `box-shadow`（数值保留）。
 * - L1367 `Color.Gray.copy(alpha = 0.3f)` → `rgba(128,128,128,0.3)`。
 * - L828–832 `animateFloatAsState(tween 320)` → CSS `transition 320ms`；
 *   L1021–1025 `spring(DampingRatioMediumBouncy)` → CSS 弹性曲线；
 *   L1084–1088 `tween(240/520)` 脉冲 → `@keyframes`（900ms 一轮，数值保留）。
 * - L102–108 文档字符串、`@OptIn` 注解 → 注释 / 无。
 * - L159 `estimatedChapterSizeMb` 默认 2.0 → `DEFAULT_ESTIMATED_CHAPTER_SIZE_MB`。
 * - 未使用的回调参数：L124 `onDownloadAll`、L137 `onFavoriteDisabledClick`
 *   （Android 体内也没调用；心形组件内部自带 `FAV_DISABLED_HINT`）、
 *   L145 `onMarkChapterRead`、L146 `onMarkReadUpTo`、L121 `onChapterClick`
 *   （仅作 L144 `onReadChapterAt` 的默认值）→ 不接线，行为零影响。
 *
 * ── 平台接线说明（本项目尚缺的部分，全部集中在 `create*Ports`）──────────
 * - 漫画源（章节 / 图片 / 请求头）由 `attachComicSourceResolver` 接收；
 *   未注册时 `loadChapters` 回落到 ChapterCatalog 缓存。
 * - `onSearchText` → 记录搜索历史并切到「书库」tab（聚合搜索页归 LibraryPage）。
 * - `onReadChapterAt` / `onDownloadNovel` → 交给既有 `ComicReaderOnlinePage` /
 *   `NovelReaderOnlinePage` 路由。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { getPlatform } from '@platform/index';
import { currentComicDownloads, subscribeComicDownloads, startComicDownload, controlComicDownload } from '@ui/lib/comicDownloadActions';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { NovelDownloadAction } from '@ui/components/NovelDownloadAction';
import { createSearchBook as createFullSearchBook } from '@core/source/searchBook';
import { bootstrapLibrary } from '@ui/state/appStore';
import { ChapterCatalog } from '@core/library/chapterCatalog';
import { FavoriteDao } from '@core/library/favoriteDao';
import { createFavoriteRepository, type FavoriteRepository } from '@core/library/favoriteRepository';
import {
  createSearchBook,
  isKnownComicAuthor,
  type ComicChapter,
  type SearchBook,
} from '@core/library/comicSourceTypes';
import { ChapterReadState, type FavoriteEntity } from '@core/library/favoriteTypes';
import {
  ChapterVisual,
  FAV_DISABLED_HINT,
  chapterReadStateToVisual,
  type ChapterVisualCode,
} from '@core/favorite/favoriteUi';
import { attachGodMomentRepository, hydrateGodMomentsFromDb, listGodMoments, setGodEditTarget } from '@core/god/godMoments';
import { setOnlineReaderTarget } from '@core/reader/onlineReaderSession';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import { takeGodJumpChapterId } from '@core/god/godRankingSettings';
import type { GodMoment } from '@core/god/godTypes';
import { AppButton } from '@ui/components/AppButton';
import { FavoriteHeartIcon } from '@ui/components/favorite/FavoriteHeart';
import { SourceUnavailableBanner } from '@ui/components/favorite/ComicDetailActions';
import { SourceMigrateSheet, type SourceCandidate } from '@ui/components/favorite/SourceMigration';
import { findSourceCandidates } from '@core/favorite/favoriteUi';
import { showToast } from '@ui/toast';
import { useAppStore } from '@ui/state/appStore';
import { COLORS } from '@ui/theme/tokens';
import {
  BOOKMARK_COMMIT_THRESHOLD,
  BOOKMARK_DRAG_LIMIT,
  CHAPTER_LOAD_ERROR,
  COMIC_NO_CHAPTERS_ERROR,
  COMIC_SOURCE_UNAVAILABLE_ERROR,
  DEFAULT_ESTIMATED_CHAPTER_SIZE_MB,
  GodFallbackGradient,
  GodGold,
  GodGoldStroke,
  GodScrimGradient,
  LIST_HEADER_ITEMS,
  LONG_PRESS_TIMEOUT_MS,
  METADATA_ALIAS_PREVIEW,
  METADATA_TAG_PREVIEW,
  QUICK_SELECT_LAST,
  TOUCH_SLOP,
  chapterCardSpecOf,
  chapterNumberOf,
  chapterProgressOf,
  chaptersInSelection,
  comicChaptersStore,
  comicDetailTargetFromKey,
  comicHighlightStore,
  comicMetadataIsEmpty,
  comicMetadataModelOf,
  continueButtonLabelOf,
  continueTargetChapterOf,
  continueTargetOf,
  descriptionNeedsToggle,
  displayChaptersOf,
  downloadButtonLabelOf,
  downloadOverlayPercentOf,
  downloadOverlayTitleOf,
  focusIndexOf,
  godCaptionOf,
  godChapterIdsOf,
  godChapterTitleOf,
  godListOf,
  godRatingTextOf,
  heroAuthorLineOf,
  heroBadgeOf,
  heroComicIdLineOf,
  heroDescriptionOf,
  heroTitleOf,
  infoRowLabelOf,
  latestChapterListItemIndex,
  listItemIndexOf,
  metadataTagNameOf,
  newChapterIdSetOf,
  normalChaptersOf,
  orderedOf,
  quickInvert,
  quickSelectLastTen,
  quickSelectUnread,
  readCountOf,
  resolveComicDetailTarget,
  resolveComicSource,
  setComicDetailTarget,
  stateOnlyOf,
  takeComicDetailTarget,
  toggleSelected,
  type ChapterCardSpec,
  type ComicChaptersPorts,
  type ComicChaptersSnapshot,
  type ComicDetailTarget,
} from '@core/comic/comicChapters';
import { scrollElementTo } from '@ui/lib/scroll';
import '../../styles/comicChapters.css';

/* ══════════════════════════════════════════════════════════════
 * 调色板 —— Theme.kt L58–66 的 lightColorScheme（+ Material3 浅色默认色板）
 * ══════════════════════════════════════════════════════════════ */

const LIGHT_SCHEME = {
  /** LightBg = Color(0xFFFFFFFF) */
  background: '#FFFFFF',
  /** PureWhite = Color(0xFFFFFFFF) */
  surface: '#FFFFFF',
  /** DarkCharcoal = Color(0xFF18191C) */
  onBackground: '#18191C',
  /** Material3 lightColorScheme() 默认值 */
  onSurfaceVariant: '#49454F',
  surfaceVariant: '#E7E0EC',
  surfaceContainerHigh: '#ECE6F0',
  error: '#B3261E',
} as const;

function withAlpha(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(24, 25, 28, ${String(alpha)})`;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, fraction: number): number {
  return start + (end - start) * fraction;
}

/* ══════════════════════════════════════════════════════════════
 * 图标（Material Icons 的 path data，viewBox 0 0 24 24）
 * ══════════════════════════════════════════════════════════════ */

const ICON_PATH = {
  arrowBack: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  sort: 'M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z',
  checklist:
    'M22 7h-9v2h9V7zm0 8h-9v2h9v-2zM5.54 11 2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 11zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 19z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  menuBook:
    'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
} as const;

type IconName = keyof typeof ICON_PATH;

function Icon(props: { name: IconName; size: number; label?: string; className?: string }) {
  const labelled = props.label !== undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size}
      height={props.size}
      fill="currentColor"
      className={props.className}
      {...(labelled ? { 'aria-label': props.label as string } : { 'aria-hidden': true })}
    >
      <path d={ICON_PATH[props.name]} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 加载动画 —— components/ChasingDots.kt L19–169
 * durationMillis 2000、delayBetweenDotsMillis 50、size 52、circleRatio 0.25
 * ══════════════════════════════════════════════════════════════ */

const CHASING_DOTS = 6;

function ChasingDots(props: { size: number; color: string; reduceMotion: boolean }) {
  const dots = [];
  for (let i = 0; i < CHASING_DOTS; i += 1) {
    // fraction 4 → 4 × 2000ms 跑 7 圈；后 4 个点 radius 呼吸，offsetMillis = 50 × (i-2)
    const pulsing = i >= 2;
    dots.push(
      <span
        key={`chasing-${String(i)}`}
        className={pulsing ? 'cc-chasing-dots__dot cc-chasing-dots__dot--pulse' : 'cc-chasing-dots__dot'}
        style={
          {
            '--cc-chasing-index': String(i),
            ...(pulsing ? { animationDelay: `${String((i - 2) * 50)}ms` } : {}),
          } as CSSProperties
        }
      >
        <span />
      </span>,
    );
  }
  return (
    <span
      className={props.reduceMotion ? 'cc-chasing-dots cc-chasing-dots--still' : 'cc-chasing-dots'}
      style={
        {
          width: props.size,
          height: props.size,
          '--cc-chasing-color': props.color,
          '--cc-chasing-radius': `${String(props.size / 2)}px`,
        } as CSSProperties
      }
      role="status"
      aria-label="正在加载章节"
    >
      <span className="cc-chasing-dots__ring">{dots}</span>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 进度指示（M3 CircularProgressIndicator / LinearProgressIndicator 的定值版）
 * ══════════════════════════════════════════════════════════════ */

function ProgressRing(props: {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor: string;
}) {
  const radius = (props.size - props.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="cc-ring"
      viewBox={`0 0 ${String(props.size)} ${String(props.size)}`}
      width={props.size}
      height={props.size}
      aria-hidden="true"
    >
      <circle
        cx={props.size / 2}
        cy={props.size / 2}
        r={radius}
        fill="none"
        stroke={props.trackColor}
        strokeWidth={props.strokeWidth}
      />
      <circle
        cx={props.size / 2}
        cy={props.size / 2}
        r={radius}
        fill="none"
        stroke={props.color}
        strokeWidth={props.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${String(circumference * clamp01(props.progress))} ${String(circumference)}`}
        transform={`rotate(-90 ${String(props.size / 2)} ${String(props.size / 2)})`}
      />
    </svg>
  );
}

function LinearProgress(props: { progress: number; color: string; trackColor: string }) {
  return (
    <span className="cc-linear" style={{ background: props.trackColor }}>
      <span
        className="cc-linear__fill"
        style={{ width: `${String(clamp01(props.progress) * 100)}%`, background: props.color }}
      />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
 * components/CustomButtons.kt L21–39 —— AppIconButton（48dp 圆形点击区）
 * ══════════════════════════════════════════════════════════════ */

function AppIconButton(props: {
  onClick: () => void;
  size?: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cc-icon-button"
      style={{ width: props.size ?? 48, height: props.size ?? 48 }}
      onClick={props.onClick}
      aria-label={props.label}
    >
      {props.children}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
 * components/PlayPauseMorph.kt L34–112 —— 播放/暂停形变（tween 500ms）
 * ══════════════════════════════════════════════════════════════ */

const MORPH_MS = 500;

function playPauseLeftPath(w: number, progress: number): string {
  const h = w;
  const cx = w / 2;
  const cy = h / 2;
  const triHalf = w * 0.32;
  const barHalfW = w * 0.12;
  const barGap = w * 0.18;
  const triTopX = cx - triHalf * 0.65;
  const triTopY = cy - triHalf;
  const triBotX = cx - triHalf * 0.65;
  const triBotY = cy + triHalf;
  const triRightX = cx + triHalf;
  const triRightY = cy;
  const leftBarL = cx - barGap - barHalfW;
  const leftBarR = cx - barGap + barHalfW;
  const barTop = cy - triHalf;
  const barBot = cy + triHalf;
  return [
    `M ${String(lerp(triTopX, leftBarL, progress))} ${String(lerp(triTopY, barTop, progress))}`,
    `L ${String(lerp(triRightX, leftBarR, progress))} ${String(lerp(triRightY, barTop, progress))}`,
    `L ${String(lerp(triRightX, leftBarR, progress))} ${String(lerp(triRightY, barBot, progress))}`,
    `L ${String(lerp(triBotX, leftBarL, progress))} ${String(lerp(triBotY, barBot, progress))}`,
    'Z',
  ].join(' ');
}

function playPauseRightPath(w: number, progress: number): string {
  const h = w;
  const cx = w / 2;
  const cy = h / 2;
  const triHalf = w * 0.32;
  const barHalfW = w * 0.12;
  const barGap = w * 0.18;
  const triRightX = cx + triHalf;
  const triRightY = cy;
  const rightBarL = cx + barGap - barHalfW;
  const rightBarR = cx + barGap + barHalfW;
  const barTop = cy - triHalf;
  const barBot = cy + triHalf;
  return [
    `M ${String(lerp(triRightX, rightBarL, progress))} ${String(lerp(triRightY, barTop, progress))}`,
    `L ${String(lerp(triRightX, rightBarR, progress))} ${String(lerp(triRightY, barTop, progress))}`,
    `L ${String(lerp(triRightX, rightBarR, progress))} ${String(lerp(triRightY, barBot, progress))}`,
    `L ${String(lerp(triRightX, rightBarL, progress))} ${String(lerp(triRightY, barBot, progress))}`,
    'Z',
  ].join(' ');
}

function PlayPauseMorphButton(props: {
  isPlaying: boolean;
  onClick: () => void;
  size: number;
  color: string;
  reduceMotion: boolean;
}) {
  // animateFloatAsState(tween(500))：rAF 插值（与 FavoriteHeart 的 burst 同一写法）
  const [progress, setProgress] = useState(props.isPlaying ? 1 : 0);
  useEffect(() => {
    const from = props.isPlaying ? 0 : 1;
    const to = props.isPlaying ? 1 : 0;
    if (props.reduceMotion) {
      // 减少动态效果：直接落到目标形态（不跑补间）
      const raf = window.requestAnimationFrame(() => {
        setProgress(to);
      });
      return () => window.cancelAnimationFrame(raf);
    }
    const started = performance.now();
    let raf = 0;
    const step = (): void => {
      const t = Math.min(1, (performance.now() - started) / MORPH_MS);
      // FastOutSlowInEasing（Compose tween 默认曲线）
      setProgress(lerp(from, to, 0.4 * t + 0.6 * t * t));
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [props.isPlaying, props.reduceMotion]);

  const box = props.size / 2;
  return (
    <button
      type="button"
      className="cc-playpause"
      style={{ width: props.size, height: props.size, background: props.color }}
      onClick={props.onClick}
      aria-label={props.isPlaying ? '暂停下载' : '继续下载'}
    >
      <svg viewBox={`0 0 ${String(box)} ${String(box)}`} width={box} height={box} aria-hidden="true">
        <path d={playPauseLeftPath(box, progress)} fill="#FFFFFF" />
        <path d={playPauseRightPath(box, progress)} fill="#FFFFFF" />
      </svg>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
 * L1244–1274 —— CheckCircleSpec
 * ══════════════════════════════════════════════════════════════ */

function CheckCircle(props: { checked: boolean; uncheckedStroke?: string }) {
  const stroke = props.uncheckedStroke ?? withAlpha(LIGHT_SCHEME.onBackground, 0.35);
  return (
    <span className="cc-check" aria-hidden="true">
      {props.checked ? (
        <span className="cc-check__on">
          <Icon name="check" size={14} />
        </span>
      ) : (
        <span className="cc-check__off" style={{ borderColor: stroke }} />
      )}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
 * favorite/ChapterStatusRow.kt L388–454 —— BookmarkRibbon（22×36，scale 出场）
 * ══════════════════════════════════════════════════════════════ */

function BookmarkRibbon(props: { visible: boolean; contentDescription: string | null }) {
  return (
    <span
      className={props.visible ? 'cc-ribbon cc-ribbon--on' : 'cc-ribbon'}
      {...(props.contentDescription === null
        ? { 'aria-hidden': true as const }
        : { role: 'img', 'aria-label': props.contentDescription })}
    />
  );
}

/* ══════════════════════════════════════════════════════════════
 * L774–789 —— QuickPill
 * ══════════════════════════════════════════════════════════════ */

function QuickPill(props: { text: string; onClick: () => void }) {
  return (
    <button type="button" className="cc-pill" onClick={props.onClick}>
      {props.text}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 手势：长按 500ms（L1543–1568）+ 滑动书签（L902–941）
 * ══════════════════════════════════════════════════════════════ */

interface CardGestureOptions {
  onLongPress: (() => void) | null;
  /** 横向滑动书签：null = 本行不武装手势。 */
  onSwipe: {
    limit: number;
    commitThreshold: number;
    onPreview: (previewing: boolean) => void;
    onCommit: () => void;
    onTranslate: (x: number) => void;
  } | null;
  onClick: () => void;
}

interface CardGestures {
  dragging: boolean;
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    onClick: () => void;
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  };
}

/**
 * Kotlin 两个 pointerInput 合并成一个 Web 手势层：
 * - 长按：500ms 内未抬起、未超过 touchSlop → 触发（L1547–1557）；
 * - 滑动书签：横向位移 > slop 且 ≥ 纵向 → 接管，跟手平移，松手回弹（L919–939）。
 */
function useCardGestures(options: CardGestureOptions): CardGestures {
  const [dragging, setDragging] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  // 手势过程量（只在事件回调里读写，不参与渲染）
  const state = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    totalX: 0,
    totalY: 0,
    dragX: 0,
    isDrag: false,
    longPressFired: false,
  });

  const clearLongPress = useCallback((): void => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    const s = state.current;
    s.pointerId = event.pointerId;
    s.startX = event.clientX;
    s.startY = event.clientY;
    s.totalX = 0;
    s.totalY = 0;
    s.dragX = 0;
    s.isDrag = false;
    s.longPressFired = false;
    if (options.onLongPress === null) return;
    longPressTimer.current = window.setTimeout(() => {
      const current = state.current;
      if (current.isDrag) return;
      current.longPressFired = true;
      options.onLongPress?.();
    }, LONG_PRESS_TIMEOUT_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const s = state.current;
    if (s.pointerId !== event.pointerId) return;
    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;
    s.totalX += dx;
    s.totalY += dy;
    const swipe = options.onSwipe;
    if (swipe === null) return;
    if (!s.isDrag && Math.abs(s.totalX) > TOUCH_SLOP && Math.abs(s.totalX) >= Math.abs(s.totalY)) {
      s.isDrag = true;
      clearLongPress();
      setDragging(true);
      swipe.onPreview(true);
      // Kotlin L922–924：`justActivated = true; dragX = totalX.coerceIn(-140f, 140f)`
      // —— 接管帧直接把累计位移写进 dragX；下面的 `if (isDrag)` 本帧**不再**叠加 delta。
      s.dragX = Math.min(swipe.limit, Math.max(-swipe.limit, s.totalX));
      swipe.onTranslate(s.dragX);
      return;
    }
    if (s.isDrag) {
      // Kotlin L929 `dragX = (dragX + delta.x).coerceIn(-140f, 140f)`
      s.dragX = Math.min(swipe.limit, Math.max(-swipe.limit, s.dragX + dx));
      swipe.onTranslate(s.dragX);
    }
  };

  const finish = (event: React.PointerEvent<HTMLElement>): void => {
    const s = state.current;
    if (s.pointerId !== event.pointerId) return;
    clearLongPress();
    const swipe = options.onSwipe;
    if (swipe !== null) {
      if (s.isDrag && Math.abs(s.dragX) > swipe.commitThreshold) swipe.onCommit();
      swipe.onPreview(false);
      swipe.onTranslate(0);
      setDragging(false);
    }
    s.isDrag = false;
    s.pointerId = -1;
  };

  const onClick = (): void => {
    if (state.current.isDrag || state.current.longPressFired) return;
    options.onClick();
  };

  // 桌面端等价长按
  const onContextMenu = (event: React.MouseEvent<HTMLElement>): void => {
    if (options.onLongPress === null) return;
    event.preventDefault();
    options.onLongPress();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      options.onLongPress?.();
    }
  };

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onKeyDown,
      onClick,
      onContextMenu,
    },
  };
}

/* ══════════════════════════════════════════════════════════════
 * Coil AsyncImage → <img>（onError 兜底 + crossfade 220ms）
 * ══════════════════════════════════════════════════════════════ */

/**
 * Coil `AsyncImage` 的失败兜底：`src` 为空或加载失败 → 走渐变兜底块。
 * 失败态按 src 记录（不在 effect 里 setState，src 变化即自动失效）。
 */
function useImageFallback(src: string | null): { missing: boolean; markFailed: () => void } {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const missing = src === null || src.trim() === '' || failedSrc === src;
  return {
    missing,
    markFailed: () => {
      setFailedSrc(src);
    },
  };
}

/* ══════════════════════════════════════════════════════════════
 * L791–1055 —— ChapterCardSpec
 * ══════════════════════════════════════════════════════════════ */

function ChapterCard(props: {
  spec: ChapterCardSpec;
  highlighted: boolean;
  bookmarkEnabled: boolean;
  onClick: () => void;
  onDownload: () => void;
  onToggleBookmark: () => void;
  onLongPress: () => void;
  primary: string;
  textMuted: string;
  textPrimary: string;
  textSecondary: string;
}) {
  const { spec } = props;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [dragPreviewBookmark, setDragPreviewBookmark] = useState(false);

  // 手势闭包每次渲染重建（useCardGestures 内不缓存 options），永远拿最新回调
  // Kotlin L885–899：多选态只挂 `clickable(onClick)`，**不**有长按；
  // Kotlin L900：滑动书签 pointerInput 的条件是 `bookmarkEnabled && !selecting`。
  // 两者都必须看 `selecting`，否则多选时长按会顺带把该话勾上（Android 不会）。
  const gestures = useCardGestures({
    onClick: props.onClick,
    onLongPress: spec.selecting ? null : () => {
      props.onLongPress();
    },
    onSwipe: props.bookmarkEnabled && !spec.selecting
      ? {
          limit: BOOKMARK_DRAG_LIMIT,
          commitThreshold: BOOKMARK_COMMIT_THRESHOLD,
          onPreview: setDragPreviewBookmark,
          onCommit: () => {
            props.onToggleBookmark();
          },
          onTranslate: (x: number) => {
            const node = cardRef.current;
            if (node !== null) node.style.transform = `translateX(${String(x)}px)`;
          },
        }
      : null,
  });

  const showUserRibbon = spec.showRibbon || dragPreviewBookmark;
  const captionColor = spec.isCurrent && !spec.selecting ? props.primary : props.textMuted;
  const titleColor = spec.isRead ? props.textSecondary : props.textPrimary;
  const rightInteractive = spec.rightKind === 'check' || spec.rightKind === 'downloadable';

  return (
    <div
      ref={cardRef}
      className={[
        'cc-chapter-card',
        spec.emphasized || spec.isSelected ? 'cc-chapter-card--accent' : '',
        props.highlighted ? 'cc-chapter-card--highlight' : '',
        gestures.dragging ? 'cc-chapter-card--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--cc-primary': props.primary,
        } as CSSProperties
      }
      role="button"
      tabIndex={0}
      aria-label={spec.semanticsLabel}
      {...gestures.handlers}
    >
      <span
        className="cc-chapter-card__highlight"
        style={{ background: withAlpha(props.primary, 0.1) }}
        aria-hidden="true"
      />
      <span className="cc-chapter-card__body">
        <span className="cc-chapter-card__slot" aria-hidden="true" />
        <span className="cc-chapter-card__text">
          <span className="cc-chapter-card__caption" style={{ color: captionColor }}>
            {spec.caption}
          </span>
          <span
            /* ⚠️ 深色模式（E55/E57）：`.cc-chapter-card__title` 的颜色由
             * comicChapters.css L1020-1028 的 `[data-theme='dark']` 规则以
             * `!important` 压住（那批 CSS 只认类名，拿不到内联的颜色）。
             * 「已读变淡」（Kotlin L822 `onSurface.copy(alpha = 0.55f)` /
             * L973 `color = if (isRead) textSecondary else textPrimary`）
             * 因此改用 **opacity** 表达：opacity 是另一条属性，主题规则管不到，
             * 而在浅色下 `color: textPrimary` + `opacity: .55` 与
             * `color: textSecondary`（= onBackground@55%）在卡片白底上完全等价。
             * 同时补 `cc-chapter-card__title--read` 类，供后续样式表挂钩。 */
            className={
              spec.isRead
                ? 'cc-chapter-card__title cc-chapter-card__title--read'
                : 'cc-chapter-card__title'
            }
            style={{ color: titleColor, opacity: spec.isRead ? 0.55 : 1 }}
          >
            {spec.title}
          </span>
        </span>
        <button
          type="button"
          className={
            rightInteractive
              ? 'cc-chapter-card__right'
              : 'cc-chapter-card__right cc-chapter-card__right--static'
          }
          onClick={(event) => {
            event.stopPropagation();
            if (spec.rightKind === 'check') props.onClick();
            else if (spec.rightKind === 'downloadable') props.onDownload();
          }}
          tabIndex={rightInteractive ? 0 : -1}
          {...(rightInteractive
            ? { 'aria-label': spec.rightLabel ?? '下载' }
            : { 'aria-hidden': true as const })}
        >
          {spec.rightKind === 'check' ? <CheckCircle checked={spec.isSelected} /> : null}
          {spec.rightKind === 'downloading' ? (
            <ProgressRing
              progress={spec.downloadProgress}
              size={20}
              strokeWidth={2.5}
              color={props.primary}
              trackColor={withAlpha(props.primary, 0.18)}
            />
          ) : null}
          {spec.rightKind === 'downloaded' ? (
            <span style={{ color: props.primary }}>
              <Icon name="download" size={20} label="已下载" />
            </span>
          ) : null}
          {spec.rightKind === 'downloadable' ? (
            /* ⚠️ 深色模式：Kotlin L823/L1012 的 `textMuted = onSurfaceVariant`
             * 是 M3 角色色，浅色 #49454F 在 #18191C 上只有 1.7:1。改取
             * `--cc-on-surface-variant` 变量 —— 浅色态由 .cc-root 内联喂
             * LIGHT_SCHEME.onSurfaceVariant（#49454F，零变化），深色态由
             * comicChapters.css L942 的 `!important` 重声明翻成 #CAC4D0。
             * （与 L1004 排序 chip 同一手法） */
            <span style={{ color: 'var(--cc-on-surface-variant)' }}>
              <Icon name="download" size={20} label="下载" />
            </span>
          ) : null}
        </button>
      </span>
      <BookmarkRibbon
        visible={showUserRibbon}
        contentDescription={spec.showRibbon ? '已加书签' : null}
      />
      {spec.isCurrent && spec.pageCount > 0 ? (
        <span className="cc-chapter-card__progress" aria-hidden="true">
          <span
            className="cc-chapter-card__progress-fill"
            style={{
              width: `${String(spec.progressFraction * 100)}%`,
              background: props.primary,
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * L1057–1242 —— GodCardSpec
 * ══════════════════════════════════════════════════════════════ */

function GodCard(props: {
  god: GodMoment;
  chapterTitle: string;
  highlighted: boolean;
  selecting: boolean;
  checked: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onToggleCheck: () => void;
  onLongPress: () => void;
  primary: string;
  reduceMotion: boolean;
}) {
  const { god } = props;
  const cover = useImageFallback(god.coverPath);
  const gestures = useCardGestures({
    onClick: props.onOpen,
    onLongPress: props.onLongPress,
    onSwipe: null,
  });
  const caption = godCaptionOf(god);
  return (
    <div
      className={[
        'cc-god-card',
        props.selecting && props.checked ? 'cc-god-card--selected' : '',
        props.highlighted && !props.reduceMotion ? 'cc-god-card--pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--cc-primary': props.primary,
          '--cc-god-gold': GodGold,
          '--cc-god-stroke': GodGoldStroke,
        } as CSSProperties
      }
      role="button"
      tabIndex={0}
      {...gestures.handlers}
    >
      {cover.missing ? (
        <span
          className="cc-god-card__cover cc-god-card__cover--fallback"
          style={{
            background: `linear-gradient(90deg, ${GodFallbackGradient[0]}, ${GodFallbackGradient[1]})`,
          }}
          aria-hidden="true"
        />
      ) : (
        <img
          className="cc-god-card__cover"
          src={god.coverPath ?? ''}
          alt=""
          onError={cover.markFailed}
        />
      )}
      <span
        className="cc-god-card__cover"
        style={{
          background: `linear-gradient(90deg, ${GodScrimGradient[0]}, ${GodScrimGradient[1]}, ${GodScrimGradient[2]})`,
        }}
        aria-hidden="true"
      />
      <span
        className="cc-god-card__cover cc-god-card__pulse"
        style={{ background: GodGold }}
        aria-hidden="true"
      />
      <span className="cc-god-card__body">
        <span className="cc-chapter-card__slot" aria-hidden="true" />
        <span className="cc-chapter-card__text">
          <span className="cc-chapter-card__caption" style={{ color: GodGold }}>
            {caption}
          </span>
          <span className="cc-chapter-card__title" style={{ color: '#FFFFFF' }}>
            {props.chapterTitle}
          </span>
        </span>
        <span className="cc-god-card__right">
          {props.selecting ? (
            <button
              type="button"
              className="cc-chapter-card__right"
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleCheck();
              }}
              aria-label="已选中"
            >
              <CheckCircle checked={props.checked} uncheckedStroke="rgba(255, 255, 255, 0.7)" />
            </button>
          ) : (
            <span className="cc-god-card__rating">
              <span style={{ color: GodGold }}>
                <Icon name="star" size={14} />
              </span>
              <span className="cc-god-card__rating-text">{godRatingTextOf(god)}</span>
            </span>
          )}
          {props.selecting ? null : (
            <button
              type="button"
              className="cc-chapter-card__right"
              onClick={(event) => {
                event.stopPropagation();
                props.onDownload();
              }}
              aria-label="下载"
            >
              <span style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                <Icon name="download" size={20} />
              </span>
            </button>
          )}
        </span>
      </span>
      {/* 用户定稿：神回卡片上不出现书签标志（书签只属于普通章节卡）。 */}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * L1276–1460 —— ComicHeroHeader（+ ComicMetadataUi.kt 24–86 内联）
 * ══════════════════════════════════════════════════════════════ */

function ComicMetadataBlock(props: { book: SearchBook; onSearch: (text: string) => void }) {
  const model = useMemo(() => comicMetadataModelOf(props.book), [props.book]);
  const [expanded, setExpanded] = useState(false);
  if (comicMetadataIsEmpty(model)) return null;
  const aliases = expanded ? model.aliases : model.aliases.slice(0, METADATA_ALIAS_PREVIEW);
  const tags = expanded ? model.tags : model.tags.slice(0, METADATA_TAG_PREVIEW);
  return (
    <div className="cc-metadata">
      <div className="cc-metadata__inner">
        {model.rows.map((row) => (
          <p key={`${row.label}-${row.value}`} className="cc-metadata__row">
            {`${row.label}：${row.value}`}
          </p>
        ))}
        {aliases.length > 0 ? (
          <p className="cc-metadata__row">{`别名：${aliases.join(' / ')}`}</p>
        ) : null}
        {tags.length > 0 ? (
          <>
            <p className="cc-metadata__row cc-metadata__row--label">标签</p>
            <div className="cc-metadata__tags">
              {tags.map((tag, index) => (
                <button
                  key={`${tag}-${String(index)}`}
                  type="button"
                  className="cc-tag"
                  onClick={() => {
                    props.onSearch(metadataTagNameOf(tag));
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {model.aliases.length > METADATA_ALIAS_PREVIEW || model.tags.length > METADATA_TAG_PREVIEW ? (
          <button
            type="button"
            className="cc-text-button cc-text-button--left"
            onClick={() => {
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? '收起资料' : '展开全部资料'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ComicHeroHeader(props: {
  book: SearchBook;
  textMode: boolean;
  onSearchText: (text: string) => void;
  primary: string;
  secondary: string;
}) {
  const { book } = props;
  // Kotlin L1282 `var descriptionExpanded by remember(book.sourceId, book.id)`
  // → 换书即重置。宿主在 hero 容器上挂 `key={sourceId::id}`（重挂载 = 重置）。
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const cover = useImageFallback(book.cover);
  const desc = heroDescriptionOf(book);
  const comicIdLine = heroComicIdLineOf(book);
  const heroAuthorKnown = isKnownComicAuthor(book.author);
  return (
    <div className="cc-hero">
      <div className="cc-hero__art">
        {cover.missing ? (
          <span
            className="cc-hero__bg cc-hero__bg--fallback"
            style={{
              background: `linear-gradient(180deg, ${withAlpha(props.primary, 0.55)}, ${withAlpha(props.secondary, 0.65)})`,
            }}
            aria-hidden="true"
          />
        ) : (
          <img
            className="cc-hero__bg cc-hero__bg--blur"
            src={book.cover ?? ''}
            alt=""
            onError={cover.markFailed}
          />
        )}
        <span
          className="cc-hero__bg cc-hero__bg--scrim"
          style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.82))' }}
          aria-hidden="true"
        />
        <div className="cc-hero__row">
          <div className="cc-hero__cover">
            {cover.missing ? (
              <span className="cc-hero__cover-fallback">
                <Icon name="menuBook" size={36} />
              </span>
            ) : (
              <img
                className="cc-hero__cover-img"
                src={book.cover ?? ''}
                alt={book.title}
                onError={cover.markFailed}
              />
            )}
          </div>
          <div className="cc-hero__body">
            <button
              type="button"
              className="cc-hero__title"
              /* Kotlin L1392 `comicSearchActions(label = if (textMode) "书名" else "漫画名", …)`
                 的 `onClickLabel = "搜索$label"`（无障碍点击提示）。 */
              aria-label={`搜索${props.textMode ? '书名' : '漫画名'}`}
              onClick={() => {
                if (book.title.trim() !== '') props.onSearchText(book.title);
              }}
            >
              {book.title}
            </button>
            <span className="cc-hero__badge">{heroBadgeOf(props.textMode)}</span>
            {heroAuthorKnown ? (
              <button
                type="button"
                className="cc-hero__author"
                /* Kotlin L1413 `comicSearchActions("作者名", …)` */
                aria-label="搜索作者名"
                onClick={() => {
                  if (book.author.trim() !== '') props.onSearchText(book.author);
                }}
              >
                {`作者：${book.author}`}
              </button>
            ) : (
              /* Kotlin L1420–1423：源站未提供作者时是**纯 Text**，没有 comicSearchActions，
                 也不可点（不能拿未知作者去搜索）。 */
              <span className="cc-hero__author">{heroAuthorLineOf(book)}</span>
            )}
            {comicIdLine === null ? null : (
              <button
                type="button"
                className="cc-hero__comic-id"
                /* Kotlin L1428 `comicSearchActions("作品编号", …)` */
                aria-label="搜索作品编号"
                onClick={() => {
                  const raw = (book.comicId ?? '').trim();
                  if (raw !== '') props.onSearchText(raw);
                }}
              >
                {comicIdLine}
              </button>
            )}
          </div>
        </div>
      </div>
      {props.textMode ? null : <ComicMetadataBlock book={book} onSearch={props.onSearchText} />}
      {desc !== null ? (
        <div className="cc-desc">
          <p className={descriptionExpanded ? 'cc-desc__text cc-desc__text--full' : 'cc-desc__text'}>
            {desc}
          </p>
          {descriptionNeedsToggle(desc) ? (
            <button
              type="button"
              className="cc-text-button"
              onClick={() => {
                setDescriptionExpanded((prev) => !prev);
              }}
            >
              {descriptionExpanded ? '收起' : '展开'}
            </button>
          ) : null}
        </div>
      ) : props.textMode ? null : (
        <p className="cc-desc__empty">源站暂未提供简介</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * L1462–1541 —— DownloadProgressOverlay
 * ══════════════════════════════════════════════════════════════ */

function DownloadProgressOverlay(props: {
  chapter: ComicChapter;
  progress: number;
  paused: boolean;
  primary: string;
  secondary: string;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  reduceMotion: boolean;
}) {
  const clamped = clamp01(props.progress);
  return (
    <div className="cc-download-overlay">
      <div className="cc-download-overlay__card">
        <ProgressRing
          progress={clamped}
          size={26}
          strokeWidth={3}
          color={props.primary}
          trackColor={LIGHT_SCHEME.surfaceVariant}
        />
        <div className="cc-download-overlay__body">
          <p className="cc-download-overlay__title">
            {downloadOverlayTitleOf(props.paused, props.chapter.title)}
          </p>
          <LinearProgress
            progress={clamped}
            color={props.primary}
            trackColor={LIGHT_SCHEME.surfaceVariant}
          />
        </div>
        {props.paused ? null : (
          <span className="cc-download-overlay__percent" style={{ color: props.primary }}>
            {downloadOverlayPercentOf(clamped)}
          </span>
        )}
        <PlayPauseMorphButton
          isPlaying={!props.paused}
          onClick={props.paused ? props.onResume : props.onPause}
          size={36}
          color={props.paused ? props.secondary : props.primary}
          reduceMotion={props.reduceMotion}
        />
        <AppIconButton onClick={props.onCancel} size={36} label="取消下载">
          {/* ⚠️ 深色模式：Kotlin L465 取 `MaterialTheme.colorScheme.error`；
              浅色值 #B3261E 在深色卡底 #222428@0.96 上只有 3.4:1。改取
              `--cc-error` 变量（浅色由 .cc-root 内联喂 LIGHT_SCHEME.error，
              深色由 comicChapters.css L949 重声明为 M3 基线 #FFB4AB）。 */}
          <span style={{ color: 'var(--cc-error)' }}>
            <Icon name="close" size={20} />
          </span>
        </AppIconButton>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 顶栏 / 底栏（L266–448）
 * ══════════════════════════════════════════════════════════════ */

function ComicTopBar(props: {
  selectionMode: boolean
  selectedCount: number
  title: string
  onExitSelection: () => void
  onSelectAll: () => void
  onBack: () => void
  onSearchText: (text: string) => void
  primary: string
}) {
  if (props.selectionMode) {
    return (
      <header className="cc-topbar">
        <AppIconButton onClick={props.onExitSelection} size={40} label="退出多选">
          <Icon name="close" size={22} />
        </AppIconButton>
        <span className="cc-topbar__count">{`已选 ${String(props.selectedCount)} 话`}</span>
        <button
          type="button"
          className="cc-text-button"
          style={{ color: props.primary }}
          onClick={props.onSelectAll}
        >
          全选
        </button>
      </header>
    );
  }
  return (
    <header className="cc-topbar">
      <AppIconButton onClick={props.onBack} label="返回">
        <Icon name="arrowBack" size={22} />
      </AppIconButton>
      <button
        type="button"
        className="cc-topbar__title"
        /* Kotlin L326 `comicSearchActions("漫画名", book?.title.orEmpty(), …)` */
        aria-label="搜索漫画名"
        onClick={() => {
          if (props.title.trim() !== '') props.onSearchText(props.title);
        }}
      >
        {props.title}
      </button>
    </header>
  );
}

function ComicBottomBar(props: {
  selectionMode: boolean
  selectedCount: number
  estimatedChapterSizeMb: number
  continueLabel: { strong: string; soft: string }
  favorite: boolean
  favoriteEnabled: boolean
  primary: string
  onDownloadSelected: () => void
  onContinue: () => void
  onToggleFavorite: (next: boolean) => void
  onFavoriteLongPress: () => void
  onFavoriteDisabledClick: () => void
}) {
  if (props.selectionMode) {
    const label = downloadButtonLabelOf(props.selectedCount, props.estimatedChapterSizeMb);
    return (
      <footer className="cc-bottombar">
        <button
          type="button"
          className="cc-primary-button"
          style={{ background: props.primary }}
          onClick={props.onDownloadSelected}
        >
          <span className="cc-primary-button__strong">{label.strong}</span>
          {label.soft === '' ? null : (
            <span className="cc-primary-button__soft">{label.soft}</span>
          )}
        </button>
      </footer>
    );
  }
  return (
    <footer className="cc-bottombar">
      <div className="cc-bottombar__heart">
        {/* L396: Box(40×48) + longPressDetector(onLongPress) 包住 FavoriteHeartIcon */}
        <LongPressZone onLongPress={props.onFavoriteLongPress}>
          <FavoriteHeartIcon
            favorite={props.favorite}
            enabled={props.favoriteEnabled}
            onToggle={props.onToggleFavorite}
          />
        </LongPressZone>
      </div>
      <button
        type="button"
        className="cc-primary-button cc-primary-button--grow"
        style={{ background: props.primary }}
        onClick={props.onContinue}
      >
        <span className="cc-primary-button__strong">{props.continueLabel.strong}</span>
        <span className="cc-primary-button__soft">{props.continueLabel.soft}</span>
      </button>
    </footer>
  );
}

/** L1543–1568 —— 500ms 长按检测（不消费 down/up，与内部点击共存）。 */
function LongPressZone(props: { onLongPress: () => void; children: ReactNode }) {
  const timer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const clear = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clear, [clear]);
  return (
    <span
      className="cc-longpress-zone"
      onPointerDown={(event) => {
        origin.current = { x: event.clientX, y: event.clientY };
        clear();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          props.onLongPress();
        }, LONG_PRESS_TIMEOUT_MS);
      }}
      onPointerMove={(event) => {
        const dx = event.clientX - origin.current.x;
        const dy = event.clientY - origin.current.y;
        if (Math.hypot(dx, dy) > TOUCH_SLOP) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onLongPress();
      }}
    >
      {props.children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 外部 store 桥（module 级 → getSnapshot 身份稳定）
 * ══════════════════════════════════════════════════════════════ */

function subscribeChapters(listener: () => void): () => void {
  return comicChaptersStore.subscribe(listener);
}

function getChapters(): ComicChaptersSnapshot {
  return comicChaptersStore.getSnapshot();
}

function subscribeDownloads(listener: () => void): () => void {
  return subscribeComicDownloads(listener);
}

function getDownloads() {
  return currentComicDownloads();
}

function subscribeHighlight(listener: () => void): () => void {
  return comicHighlightStore.subscribe(listener);
}

function getHighlight(): string | null {
  return comicHighlightStore.getSnapshot();
}

/** rememberReduceMotion() 的 web 等价。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

/** LazyListState.animateScrollToItem(index) 的 DOM 等价。 */
function scrollToListItem(container: HTMLElement | null, itemIndex: number): void {
  if (container === null || itemIndex < 0) return;
  const node = container.querySelector(`[data-list-item="${String(itemIndex)}"]`);
  if (!(node instanceof HTMLElement)) return;
  scrollElementTo(container, { top: node.offsetTop, behavior: 'smooth' });
}

/** Android：从「书库 / 我喜欢的」进本页时，comicBook 由 ViewModel 持有。 */
function bookFromFavorite(fav: FavoriteEntity): SearchBook {
  return createSearchBook({
    id: fav.comicId,
    sourceId: fav.sourceId,
    title: fav.title,
    author: fav.author,
    cover: fav.coverUrl,
  });
}

/* ══════════════════════════════════════════════════════════════
 * 平台接线（本项目里缺失的 ViewModel 层，全部收敛在下面两个工厂）
 * ══════════════════════════════════════════════════════════════ */

function createChaptersPorts(
  repo: FavoriteRepository,
  catalog: ChapterCatalog,
): ComicChaptersPorts {
  return {
    loadChapters: async (target, onCached) => {
      const source = await resolveComicSource(target.sourceId)
      if (source === null) {
        const cached = await catalog.read(target.sourceId, target.comicId)
        if (cached.length > 0) onCached(cached)
        throw new Error(COMIC_SOURCE_UNAVAILABLE_ERROR)
      }
      // 缓存秒开（MainActivity openComic：先发缓存再发网络）
      const cached = await catalog.read(target.sourceId, target.comicId)
      if (cached.length > 0) onCached(cached)
      const chapters = await source.getChapters(target.comicId)
      if (chapters.length === 0) {
        onCached([])
        throw new Error(COMIC_NO_CHAPTERS_ERROR)
      }
      return chapters
    },
    chapterStates: (target) => repo.chapterStatesFlow(target.sourceId, target.comicId),
    progress: (target) => repo.progressFlow(target.sourceId, target.comicId),
    favorite: (target) => repo.favoriteFlow(target.sourceId, target.comicId),
    downloadedChapterIds: () => Promise.resolve([...currentComicDownloads().downloaded]),
    // FavoriteRepository 未持有书源名表；为空时信息行回落到 book.sourceId（L499）
    sourceNameOf: async (sourceId) => {
      const source = await resolveComicSource(sourceId)
      return source?.name ?? null
    },
    textModeOf: (target) => getLibraryRuntime()?.sourceManager?.getSource(target.sourceId)?.capabilities.supportOnlineText ?? false,
    markSeen: (target, chapters) => repo.markSeen(target.sourceId, target.comicId, [...chapters]),
    setChapterBookmark: (target, chapterId, chapterIndex, bookmarked) =>
      repo
        .setChapterBookmark(target.sourceId, target.comicId, chapterId, chapterIndex, bookmarked)
        .then(() => {
          showToast(bookmarked ? '已添加书签' : '已取消书签')
        }),
    toggleFavorite: (target, book, next, chapters) =>
      next
        ? repo.add(book, undefined, [...chapters])
        : repo.remove(target.sourceId, target.comicId),
  }
}


/* ══════════════════════════════════════════════════════════════
 * 页面
 * ══════════════════════════════════════════════════════════════ */

export function ComicChaptersPage() {
  const setRoute = useAppStore((s) => s.setRoute);
  const setRouteGodEditor = setRoute;
  const setTab = useAppStore((s) => s.setTab);
  const pushSearchHistory = useAppStore((s) => s.pushSearchHistory);
  const primaryIndex = useAppStore((s) => s.primaryIndex);
  const secondaryIndex = useAppStore((s) => s.secondaryIndex);

  const snapshot = useSyncExternalStore(subscribeChapters, getChapters, getChapters);
  const downloads = useSyncExternalStore(subscribeDownloads, getDownloads, getDownloads);
  const highlightId = useSyncExternalStore(subscribeHighlight, getHighlight, getHighlight);
  const reduceMotion = usePrefersReducedMotion();

  const [sortDesc, setSortDesc] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [godMomentsReady, setGodMomentsReady] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateCandidates, setMigrateCandidates] = useState<ReadonlyArray<SourceCandidate>>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const migrationRequest = useRef(0);

  const primary = COLORS.primaryPalette[primaryIndex] ?? '#059669';
  const secondary = COLORS.secondaryPalette[secondaryIndex] ?? '#10B981';

  const { book, chapters, chapterStates, progress, textMode, favorite, favoriteEnabled } =
    snapshot;
  const bookId = snapshot.target === null ? null : `${snapshot.target.sourceId}::${snapshot.target.comicId}`;

  /* ── 神回（chapterId → 实体）：与 GodRankingPage 同样的读法 ── */
  const godMoments = useMemo(() => {
    const out = new Map<string, GodMoment>();
    if (bookId === null) return out;
    for (const moment of listGodMoments()) {
      if (moment.bookId === bookId) out.set(moment.chapterId, moment);
    }
    return out;
  }, [bookId]);

  /* ── L163–191 派生量 ── */
  const ordered = useMemo(() => orderedOf(chapters), [chapters]);
  const stateOnly = useMemo(() => stateOnlyOf(chapterStates), [chapterStates]);
  const target = useMemo(
    () => continueTargetOf(chapters, stateOnly, progress),
    [chapters, stateOnly, progress],
  );
  const newIds = useMemo(() => newChapterIdSetOf(chapters, progress), [chapters, progress]);
  const displayChapters = useMemo(
    () => displayChaptersOf(ordered, sortDesc),
    [ordered, sortDesc],
  );
  const godList = useMemo(() => godListOf(godMoments), [godMoments]);
  const godChapterIds = useMemo(() => godChapterIdsOf(godList), [godList]);
  const normalChapters = useMemo(
    () => normalChaptersOf(displayChapters, godChapterIds),
    [displayChapters, godChapterIds],
  );
  const readCount = useMemo(() => readCountOf(ordered, stateOnly), [ordered, stateOnly]);
  const continueLabel = useMemo(() => continueButtonLabelOf(target, ordered), [target, ordered]);
  const infoLabel = useMemo(
    () => infoRowLabelOf(snapshot.sourceName, book, chapters.length, readCount),
    [snapshot.sourceName, book, chapters.length, readCount],
  );
  const bookmarkedChapterIds = useMemo(() => {
    const out = new Set<string>();
    for (const [chapterId, state] of chapterStates) {
      if (state.bookmarked) out.add(chapterId);
    }
    return out;
  }, [chapterStates]);

  /* ── L255–258 exitSelection ── */
  const exitSelection = useCallback((): void => {
    setSelectedChapterIds(new Set<string>());
    setSelectionMode(false);
  }, []);

  const toggleChapterSelected = useCallback((chapterId: string): void => {
    setSelectedChapterIds((prev) => toggleSelected(prev, chapterId));
  }, []);

  /* ── L235–238 记录「已见」快照 ── */
  useEffect(() => {
    if (ordered.length === 0) return;
    void comicChaptersStore.markSeen();
  }, [ordered.length]);

  /* ── L202–214 排行榜跳转：定位 + 金色高亮（先声明，优先级高于下面的自动续读定位） ── */
  useEffect(() => {
    const focusId = pendingFocusRef.current;
    if (focusId === null) return;
    const idx = listItemIndexOf(focusId, godList, normalChapters);
    if (idx < 0) return;
    pendingFocusRef.current = null;
    scrollToListItem(scrollRef.current, idx);
    comicHighlightStore.pulse(focusId, 1600);
  }, [godList, normalChapters, ordered.length]);

  /* ── L216–233 进入页面：自动滚动到「阅读中」或「下一话」 ── */
  useEffect(() => {
    if (ordered.length === 0) return;
    const focusId = ordered[focusIndexOf(target, ordered, stateOnly)]?.chapter.id ?? null;
    if (focusId === null) return;
    const idx = listItemIndexOf(focusId, godList, normalChapters);
    if (idx < 0) return;
    scrollToListItem(scrollRef.current, idx);
    comicHighlightStore.pulse(focusId, 1000);
    // Android: LaunchedEffect(ordered.size, target)。这里把 stateOnly 一并列入依赖
    // （Kotlin L222 同样读 chapterStates 的 READING 态），不使用 eslint 消音。
  }, [ordered, target, stateOnly, godList, normalChapters]);

  /* ── L260–264 多选模式下按返回：先退出多选（Web 用 Escape 等价） ── */
  useEffect(() => {
    if (!selectionMode || textMode) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') exitSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, textMode, exitSelection]);

  /* ── 启动：打开数据库 → 接端口 → 解析目标（信标 / 显式 / 第一条收藏） ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const platform = getPlatform();
        await bootstrapLibrary();
        attachGodMomentRepository(new GodMomentRepository(platform.db));
        await hydrateGodMomentsFromDb();
        if (cancelled) return;
        setGodMomentsReady(true);

        const catalog = new ChapterCatalog(platform.fs);
        const repo = createFavoriteRepository({
          dao: new FavoriteDao(platform.db),
          comicSourceOf: async (sourceId) => {
            const source = await resolveComicSource(sourceId)
            if (source === null) return null
            return {
              getChapters: async (comicId) => ({ kind: 'success' as const, data: await source.getChapters(comicId) }),
            }
          },
          fs: platform.fs,
        });
        comicChaptersStore.attachPorts(createChaptersPorts(repo, catalog));

        // 排行榜 → 漫画主页的信标：chapterId 反查 bookId（MainActivity L1046–1062）
        const beaconChapterId = takeGodJumpChapterId();
        const beaconMoment =
          beaconChapterId === null
            ? null
            : (listGodMoments().find((moment) => moment.chapterId === beaconChapterId) ?? null);
        pendingFocusRef.current = beaconChapterId;
        // 信标命中时用神回里记的书名兜底（书源登记由 comicChaptersStore.open 完成后回填）
        if (beaconMoment !== null && beaconMoment.bookTitle !== '') {
          const parts = beaconMoment.bookId.split('::');
          setComicDetailTarget({
            sourceId: parts[0] ?? '',
            comicId: parts[1] ?? '',
            book: createSearchBook({
              id: parts[1] ?? '',
              sourceId: parts[0] ?? '',
              title: beaconMoment.bookTitle,
              author: '',
            }),
          });
        }

        const favorites = await repo.favorites();
        if (cancelled) return;
        const firstFavorite: ComicDetailTarget | null =
          favorites.length === 0
            ? null
            : {
                sourceId: favorites[0]?.sourceId ?? '',
                comicId: favorites[0]?.comicId ?? '',
                book: favorites[0] === undefined ? null : bookFromFavorite(favorites[0]),
              };
        // MainActivity L1046–1062：bookId 形如 "sourceId::comicId"
        const target = resolveComicDetailTarget(
          takeComicDetailTarget(),
          beaconMoment === null ? null : beaconMoment.bookId,
          firstFavorite,
        );
        await comicChaptersStore.open(target);
      } catch (e) {
        if (!cancelled) {
          comicChaptersStore.attachPorts(null)
          showToast(e instanceof Error ? e.message : CHAPTER_LOAD_ERROR)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── L545–565 工具行「跳到最新章」 ── */
  const jumpToLatest = useCallback((): void => {
    scrollToListItem(
      scrollRef.current,
      latestChapterListItemIndex(sortDesc, godList, normalChapters),
    )
  }, [sortDesc, godList, normalChapters])

  /* ── L469 / L714–719 错误态「换源」与 L550–555 换源弹层 ── */
  const openChangeSource = useCallback((): void => {
    const current = snapshot.target
    if (current === null || current.sourceId.trim() === '' || current.comicId.trim() === '') {
      showToast('这本书没有来源信息，无法换源')
      return
    }
    setMigrateOpen(true)
    setMigrateLoading(true)
    setMigrateCandidates([])
    const request = ++migrationRequest.current;
    const sources = getLibraryRuntime()?.sourceManager?.availableSources.value.filter((source) =>
      source.capabilities.supportSearch && (textMode ? source.capabilities.supportOnlineText : source.capabilities.supportComic)) ?? [];
    void findSourceCandidates(
      current.book?.title ?? '',
      current.sourceId,
      sources,
    ).then((candidates) => {
      if (request !== migrationRequest.current) return;
      setMigrateCandidates(candidates)
      setMigrateLoading(false)
    })
  }, [snapshot.target, textMode])

  /* ── L406–444 底部「继续阅读」 ── */
  const openReader = useCallback((chapter: ComicChapter, page = 0): void => {
    if (snapshot.target === null) { showToast('没有可阅读的作品'); return; }
    setOnlineReaderTarget({ target: snapshot.target, chapters: snapshot.chapters, chapterId: chapter.id, initialPage: page });
    setRoute(textMode ? 'novelReaderOnline' : 'comicReaderOnline');
  }, [snapshot.target, snapshot.chapters, textMode, setRoute]);

  const onContinue = useCallback((): void => {
    const cont = continueTargetChapterOf(target, ordered)
    if (cont === null) {
      showToast('暂无可阅读章节')
      return
    }
    openReader(cont.chapter, cont.page)
  }, [target, ordered, openReader])

  /* ── L342–349 多选底栏下载 ── */
  const onDownloadSelected = useCallback((): void => {
    if (selectedChapterIds.size === 0) {
      showToast('先勾选要下载的章节')
      return
    }
    const current = snapshot.target
    for (const chapter of chaptersInSelection(chapters, selectedChapterIds)) {
      if (current !== null) startComicDownload(current, chapter)
    }
    exitSelection()
  }, [selectedChapterIds, chapters, snapshot.target, exitSelection])

  const onSearchText = useCallback(
    (text: string): void => {
      if (text.trim() === '') return
      pushSearchHistory(text)
      setTab('library')
    },
    [pushSearchHistory, setTab],
  )

  const onToggleFavorite = useCallback((next: boolean): void => {
    void comicChaptersStore.toggleFavorite(next)
  }, [])

  const rootStyle = {
    '--cc-bg': LIGHT_SCHEME.background,
    '--cc-surface': LIGHT_SCHEME.surface,
    '--cc-on-bg': LIGHT_SCHEME.onBackground,
    '--cc-on-surface-variant': LIGHT_SCHEME.onSurfaceVariant,
    '--cc-surface-variant': LIGHT_SCHEME.surfaceVariant,
    '--cc-surface-container-high': LIGHT_SCHEME.surfaceContainerHigh,
    '--cc-error': LIGHT_SCHEME.error,
    '--cc-primary': primary,
    '--cc-secondary': secondary,
    // MintPrimary.copy(alpha = …) 的全部档位（L549 / L851 / L867 / L999–1000 / L1044–1050）
    '--cc-primary-08': withAlpha(primary, 0.08),
    '--cc-primary-10': withAlpha(primary, 0.1),
    '--cc-primary-12': withAlpha(primary, 0.12),
    '--cc-primary-18': withAlpha(primary, 0.18),
    // onSurface.copy(alpha = …)
    '--cc-on-bg-12': withAlpha(LIGHT_SCHEME.onBackground, 0.12),
    '--cc-on-bg-18': withAlpha(LIGHT_SCHEME.onBackground, 0.18),
    '--cc-on-bg-35': withAlpha(LIGHT_SCHEME.onBackground, 0.35),
  } as CSSProperties;

  const textSecondary = withAlpha(LIGHT_SCHEME.onBackground, 0.55);
  const textSecondaryCurrent = withAlpha(LIGHT_SCHEME.onBackground, 0.75);

  const activeDownloadChapter =
    chapters.find((chapter) => downloads.downloading.has(chapter.id)) ??
    chapters.find((chapter) => downloads.paused.has(chapter.id)) ??
    null;

  return (
    <div className="cc-root" style={rootStyle}>
      <ComicTopBar
        selectionMode={selectionMode && !textMode}
        selectedCount={selectedChapterIds.size}
        title={heroTitleOf(book)}
        onExitSelection={exitSelection}
        onSelectAll={() => {
          setSelectedChapterIds(new Set(ordered.map((entry) => entry.chapter.id)))
        }}
        onBack={() => setRoute('main')}
        onSearchText={onSearchText}
        primary={primary}
      />

      <div className="cc-content">
        {snapshot.loading && chapters.length === 0 ? (
          <div className="cc-state">
            <ChasingDots size={52} color={primary} reduceMotion={reduceMotion} />
            <p className="cc-state__text">正在加载章节…</p>
          </div>
        ) : snapshot.error !== null && chapters.length === 0 ? (
          <div className="cc-state">
            <p className="cc-state__error">{snapshot.error}</p>
            <AppButton variant="primary" size="md" onClick={() => void comicChaptersStore.refresh()}>
              重试
            </AppButton>
            <button type="button" className="cc-text-button" onClick={openChangeSource}>
              换源
            </button>
          </div>
        ) : (
          <>
            {snapshot.error !== null ? (
              <SourceUnavailableBanner
                message="来源暂不可用（已保留缓存信息与阅读进度）"
                onRetry={() => void comicChaptersStore.refresh()}
                onChangeSource={openChangeSource}
              />
            ) : null}
            <div className="cc-scroll" ref={scrollRef}>
              {book === null ? null : (
                // Kotlin L493 hero item；`key` 对应 L1282 / ComicMetadataUi.kt L28 的
                // `remember(book.sourceId, book.id)`（换书即重置展开态）。
                <div
                  data-list-item="0"
                  key={`${book.sourceId}::${book.id}`}
                >
                  <ComicHeroHeader
                    book={book}
                    textMode={textMode}
                    onSearchText={onSearchText}
                    primary={primary}
                    secondary={secondary}
                  />
                </div>
              )}

              <p className="cc-info" data-list-item="1">
                {infoLabel.base}
                <span className="cc-info__accent" style={{ color: primary }}>
                  {infoLabel.accent}
                </span>
              </p>

              <div data-list-item="2">
                <div className="cc-toolbar">
                  <button
                    type="button"
                    className="cc-toolbar__chip"
                    onClick={() => {
                      setSortDesc((prev) => !prev)
                    }}
                  >
                    <span style={{ color: LIGHT_SCHEME.onSurfaceVariant }}>
                      <Icon name="sort" size={16} />
                    </span>
                    <span
                      className="cc-toolbar__chip-text"
                      style={{ color: LIGHT_SCHEME.onSurfaceVariant }}
                    >
                      {sortDesc ? '倒序' : '正序'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cc-toolbar__latest"
                    style={{
                      background: withAlpha(primary, 0.12),
                      color: primary,
                    }}
                    onClick={jumpToLatest}
                  >
                    跳到最新章
                  </button>
                  <span className="cc-toolbar__spacer" />
                  {textMode && book ? <NovelDownloadAction book={createFullSearchBook({ ...book, novelInfo: null })} /> : null}
                  {textMode ? null : (
                    <button
                      type="button"
                      className="cc-toolbar__chip"
                      onClick={() => {
                        setSelectionMode(true)
                      }}
                    >
                      <span style={{ color: LIGHT_SCHEME.onBackground }}>
                        <Icon name="checklist" size={16} />
                      </span>
                      <span className="cc-toolbar__chip-text cc-toolbar__chip-text--strong">
                        多选
                      </span>
                    </button>
                  )}
                </div>
                {selectionMode && !textMode ? (
                  <div className="cc-pills">
                    <QuickPill
                      text="选未读"
                      onClick={() => {
                        setSelectedChapterIds(new Set(quickSelectUnread(ordered, stateOnly)))
                      }}
                    />
                    <QuickPill
                      text={`选后 ${String(QUICK_SELECT_LAST)} 话`}
                      onClick={() => {
                        setSelectedChapterIds(new Set(quickSelectLastTen(ordered)))
                      }}
                    />
                    <QuickPill
                      text="反选"
                      onClick={() => {
                        setSelectedChapterIds((prev) => new Set(quickInvert(ordered, prev)))
                      }}
                    />
                  </div>
                ) : null}
              </div>

              {godList.map((god, index) => {
                const chapter = chapters.find((c) => c.id === god.chapterId) ?? null
                return (
                  <div key={`god_${god.chapterId}`} data-list-item={LIST_HEADER_ITEMS + index}>
                    <GodCard
                      god={god}
                      chapterTitle={godChapterTitleOf(god, chapter)}
                      highlighted={highlightId === god.chapterId}
                      selecting={selectionMode && !textMode}
                      checked={selectedChapterIds.has(god.chapterId)}
                      onOpen={() => {
                        if (selectionMode && !textMode) {
                          toggleChapterSelected(god.chapterId)
                          return
                        }
                        const oc = ordered.find((entry) => entry.chapter.id === god.chapterId)
                        if (oc === undefined) {
                          showToast('该话暂不可读')
                        } else {
                          openReader(oc.chapter)
                        }
                      }}
                      onDownload={() => {
                        const target2 = chapters.find((c) => c.id === god.chapterId)
                        const current = snapshot.target
                        if (target2 === undefined || target2.external || current === null) {
                          showToast('站外链接章节暂不支持下载')
                        } else {
                          startComicDownload(current, target2)
                        }
                      }}
                      onToggleCheck={() => {
                        toggleChapterSelected(god.chapterId)
                      }}
                      onLongPress={() => {
                        setGodEditTarget(god.id)
                        setRouteGodEditor('godEditor')
                      }}
                      primary={primary}
                      reduceMotion={reduceMotion}
                    />
                  </div>
                )
              })}

              {normalChapters.map((entry, index) => {
                const chapter = entry.chapter
                const state = chapterStates.get(chapter.id)
                // L679：`st?.state?.toVisual() ?: ChapterVisual.UNREAD`
                const visual: ChapterVisualCode = chapterReadStateToVisual(
                  state?.status ?? ChapterReadState.UNREAD,
                )
                const view = chapterProgressOf(state, chapter.id, progress)
                const downloading = downloads.downloading.has(chapter.id)
                const bookmarkEnabled = godMomentsReady
                  ? !godMoments.has(chapter.id)
                  : false
                const spec = chapterCardSpecOf({
                  // L685–686（见 @core/comic/comicChapters 的 chapterNumberOf）
                  number: chapterNumberOf(chapter, entry),
                  title: chapter.title,
                  visual,
                  lastPage: view.pageIndex,
                  pageCount: view.pageCount,
                  isNew: newIds.has(chapter.id),
                  downloaded: downloads.downloaded.has(chapter.id),
                  downloading,
                  downloadProgress: downloads.progress.get(chapter.id) ?? 0,
                  external: chapter.external,
                  selecting: selectionMode && !textMode,
                  checked: selectedChapterIds.has(chapter.id),
                  textMode,
                  bookmarked: bookmarkedChapterIds.has(chapter.id),
                })
                return (
                  <div
                    key={chapter.id}
                    data-list-item={LIST_HEADER_ITEMS + godList.length + index}
                  >
                    <ChapterCard
                      spec={spec}
                      highlighted={highlightId === chapter.id}
                      bookmarkEnabled={bookmarkEnabled}
                      onClick={() => {
                        if (selectionMode && !textMode) {
                          toggleChapterSelected(chapter.id)
                        } else if (chapter.external) {
                          showToast('站外链接章节暂不支持在线阅读')
                        } else {
                          openReader(chapter)
                        }
                      }}
                      onDownload={() => {
                        const current = snapshot.target
                        if (chapter.external || current === null) {
                          showToast('站外链接章节暂不支持下载')
                        } else {
                          startComicDownload(current, chapter)
                        }
                      }}
                      onToggleBookmark={() => {
                        void comicChaptersStore.setChapterBookmark(
                          chapter.id,
                          entry.order,
                          !bookmarkedChapterIds.has(chapter.id),
                        )
                      }}
                      onLongPress={() => {
                        setSelectionMode(true)
                        setSelectedChapterIds((prev) =>
                          prev.has(chapter.id) ? prev : toggleSelected(prev, chapter.id),
                        )
                      }}
                      primary={primary}
                      textMuted={LIGHT_SCHEME.onSurfaceVariant}
                      textPrimary={LIGHT_SCHEME.onBackground}
                      textSecondary={visual === ChapterVisual.READING ? textSecondaryCurrent : textSecondary}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {activeDownloadChapter === null ? null : (
          <DownloadProgressOverlay
            chapter={activeDownloadChapter}
            progress={downloads.progress.get(activeDownloadChapter.id) ?? 0}
            paused={downloads.paused.has(activeDownloadChapter.id)}
            primary={primary}
            secondary={secondary}
            onPause={() => {
              controlComicDownload('pause', activeDownloadChapter)
            }}
            onResume={() => {
              controlComicDownload('resume', activeDownloadChapter)
            }}
            onCancel={() => {
              controlComicDownload('cancel', activeDownloadChapter)
            }}
            reduceMotion={reduceMotion}
          />
        )}
      </div>

      <ComicBottomBar
        selectionMode={selectionMode && !textMode}
        selectedCount={selectedChapterIds.size}
        estimatedChapterSizeMb={DEFAULT_ESTIMATED_CHAPTER_SIZE_MB}
        continueLabel={continueLabel}
        favorite={favorite}
        favoriteEnabled={favoriteEnabled}
        primary={primary}
        onDownloadSelected={onDownloadSelected}
        onContinue={onContinue}
        onToggleFavorite={onToggleFavorite}
        onFavoriteLongPress={() => {
          showToast('放入「我喜欢的」哪个分类？')
        }}
        onFavoriteDisabledClick={() => {
          showToast(FAV_DISABLED_HINT)
        }}
      />

      {migrateOpen ? (
        <SourceMigrateSheet
          title={book?.title ?? ''}
          candidates={migrateCandidates}
          loading={migrateLoading}
          onDismiss={() => {
            migrationRequest.current++;
            setMigrateOpen(false)
          }}
          onPick={(candidate) => {
            setMigrateOpen(false)
            const next = comicDetailTargetFromKey(
              `${candidate.sourceId}::${candidate.book.id}`,
              candidate.book,
            )
            if (next === null) return
            void (async () => {
              const current = snapshot.target, runtime = getLibraryRuntime(), repo = runtime?.favorites;
              const source = await resolveComicSource(next.sourceId);
              if (!source || !repo || !current) throw new Error('书源或阅读记录尚未准备好，请重试');
              const chapters = await source.getChapters(next.comicId);
              if (!chapters.length) throw new Error('新书源未返回可用目录，尚未迁移阅读记录');
              const count = await repo.migrateByOrder({ sourceId: current.sourceId, comicId: current.comicId }, { sourceId: next.sourceId, comicId: next.comicId }, chapters);
              await comicChaptersStore.open(next);
              showToast(`已换到「${candidate.sourceName}」，迁移 ${count} 条阅读记录`);
            })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '换源失败，请重试'));
          }}
        />
      ) : null}
    </div>
  );
}

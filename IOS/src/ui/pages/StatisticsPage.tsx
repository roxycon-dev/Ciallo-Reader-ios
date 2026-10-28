/**
 * StatisticsPage.tsx — line-by-line port of Android `com/example/ui/StatisticsScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/StatisticsScreen.kt`, 837 lines / 802 non-blank).
 *
 * This file already contained the period-overview / calendar / trend / weekly surfaces
 * before this port; every Kotlin member that was still missing is added below and each
 * one is listed in the "Added by this port" section.
 *
 * ── Line map (Kotlin → this file) ──────────────────────────────────────────────────
 *   1-77     package + Compose imports        → React imports (Compose imports SKIPPED)
 *   79-105   @OptIn + StatisticsScreen signature → StatisticsPageProps (below)
 *   106      totalReadTimeSecondsFlow.collectAsStateWithLifecycle() →
*            `useStatisticsData().totalReadTimeSeconds` (see F8; it is the persisted
*            counter read from PreferencesManager, NOT a live sum of the records)
*   107      finishedCount                   → finishedCount (from `getBookshelf()` rows)
 *   109-112  LaunchedEffect(readingRecords) { onResolveRecordCovers(readingRecords) } →
 *            useEffect(…, [readingRecords]) → props.onResolveRecordCovers
 *   113-116  LaunchedEffect(readingRecords, recordBooks) { onResolveRecordCoverHeaders(…) } →
 *            useEffect(…, [readingRecords, recordBooks])
 *   118-120  dailyTotals = remember(readingRecords) { readingRecordsToDailyTotals(…) } →
 *            useMemo
 *   122      var selectedDate                 → useState<string | null>
 *   124-134  Box(background = if (LocalAppBackgroundActive.current) Transparent else
 *            colorScheme.background) + rememberLazyListState + rememberHeaderCollapsedSource →
 *            root div background from `useAppBackgroundActive()`, a scroll ref and the
 *            collapse listener below
 *   135-146  Scaffold(containerColor = Transparent, topBar = TabScreenHeader(…,
 *            statusBarsPadding, glassTitleColor())) → the page root + `<TabScreenHeader/>`
 *            with `titleColor={glassTitleColor()}`
 *   150-163  Box(TopCenter) + LazyColumn(state, widthIn(pageContentMaxWidth), spacedBy(16),
 *            contentPadding top 12 bottom LocalAppBottomInset) → `.statistics-list`
 *            (gap 16px, padding-top 12px, padding-bottom 96px — LocalAppBottomInset value)
 *   164-174  item("stats_empty") MascotEmptyState(sadDrawable, 「暂无阅读统计记录」,
 *            …, actionLabel = "立即前往书架阅读", onActionClick = onGoToShelf,
 *            testTagPrefix = "stats_empty_state") → the existing `.stats-empty` block plus
 *            the ADDED action button
 *   176-185  item("stats_period") PeriodOverviewCard(…, dailyGoalMinutes, onGoalChange) →
 *            `<PeriodOverviewCard/>` (goal props ADDED)
 *   187-199  item("stats_god_ranking") GodRankingCard(…) → `<GodRankingCard/>` (pre-existing)
 *   201-207  item("stats_calendar") ReadingCalendarCard(dailyTotals, onDayClick) →
 *            `<ReadingCalendarCard/>` (pre-existing)
 *   209-215  item("stats_trend") ReadingTrendCard(dailyTotals, sessions) → `<ReadingTrendCard/>`
 *   217-226  item("stats_weekly_header") Text("本周阅读明细", 16.sp Bold, adaptiveTitleColor()) →
 *            `<h3 className="stats-weekly-header">`
 *   228-276  item("stats_weekly"): rememberTodayCalendar() / todayIdx /
 *            weekDatesOf(today).map(dateStrOf) / minutesList / booksList / dayRecords
 *            (+ sortedByDescending { it.id } then mergeDuplicateReadingRecords) →
 *            `useTodayCalendar()` (ADDED, refreshes at local midnight) + the existing memos
 *   263-275  WeeklyReadingChart(minutesPerDay, bookTitlesPerDay, todayIndex, dayRecords,
 *            books, recordCovers, recordBooks, recordCoverHeaders, onDeleteRecord,
 *            onOpenRecordDetail, onOpenBook) → `<WeeklyReadingChart/>`; the cover/header
 *            maps are NOT part of that component's prop contract (see skips)
 *   283-298  selectedDate?.let { DayDetailSheet(date, totalSeconds, records + merge, sessions
 *            sortedBy startTimeMs, recordCovers, recordBooks, recordCoverHeaders, books,
 *            onOpenRecordDetail, onOpenBook, onDeleteRecord, onDismiss) } →
 *            `<DayDetailSheet/>` (cover/header/local-book props ADDED)
 *   301-656  PeriodOverviewCard → the existing component (goal props ADDED, mascot emoji for
 *            MascotSpriteSheet.readingDrawable, share via navigator.share, GoalRing Canvas→SVG)
 *   658-663  PeriodRange data class → PeriodRange interface + computePeriodRange
 *   665-696  MiniStatCard → the existing component
 *   698-817  DayDetailSheet → the existing component (extended, see above)
 *   819-836  mergeDuplicateReadingRecords → `@ui/lib/readingStats.mergeDuplicateReadingRecords`
 *            (same LinkedHashMap-insertion-order merge, same `book:` / `title:` keys)
 *
 * ── Fixes applied by the statistics review agent (Kotlin → this file) ───────────────
 *  F1 `handleChartClick`: `Math.round(x / stepX)` → `Math.trunc` (Kotlin L272
 *    `(offset.x / stepX).toInt()` truncates toward zero; rounding shifts every tap
 *    half a bucket to the right).
 *  F2 `deltaPct`: `Math.floor` → `Math.trunc` (Kotlin L365 Long division truncates
 *    toward zero; `Math.floor` reports -17% where Kotlin reports -16%).
 *  F3 goal percentage (`GoalRing` + share text): `Math.round` → `Math.trunc`
 *    (Kotlin L469/L518 `(animatedGoal * 100).toInt()`).
 *  F4 share text: `Ciallo 阅读` → `Ciallo Reader` (Kotlin L511/L522).
 *  F5 peak-hour bars: dropped `Math.round(ratio * 100)`; Kotlin L363 feeds
 *    `ratio.coerceAtLeast(0.04f)` straight into `fillMaxHeight`.
 *  F6 `DayDetailSheet` cover: `localBook?.coverUri` first (Kotlin L749). The TS code
 *    read a `coverUrl` field that Kotlin's `ReadingRecord` does not have.
 *  F7 year heatmap: auto-scroll to `todayColumn − 3` weeks on open (Kotlin L334-345).
 *  F8 **removed the fabricated demo dataset** (`DEMO_BOOKS`/`DEMO_RECORDS`/`DEMO_SESSIONS`)
 *    and replaced it with a real load through `BookRepository.getBookshelf()` /
 *    `getAllReadingRecordsFlow()` / `getAllReadingSessionsFlow()` +
 *    `PreferencesManager.totalReadTimeSeconds()` / `.dailyGoalMinutes()` — Android feeds
 *    these from Room/DataStore (`MainActivity.kt` L833-838). `App.tsx` L86 renders
 *    `<StatisticsPage />` with no props, so every user was seeing one made-up book,
 *    one made-up 7-minute record and a made-up heat cell. `onGoalChange` now also
 *    persists to `daily_goal_minutes` (Kotlin `MainActivity.kt` L839-842).
 *    `totalReadTimeSeconds` is the persisted counter, not a live sum, so deleting a
 *    record does not flip the page back to the empty state (Kotlin L164 never updates
 *    the flow either).
 *  F9 `books` prop widened from `{ id }` to `StatisticsBook` so `coverUri`/`isFinished`
 *    reach `DayDetailSheet` / `finishedCount` (Kotlin L107 / L737 / L749 / L615).
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1-78   Compose imports (`material3.*`, `foundation.Canvas`, `LazyColumn`,
 *          `rememberScrollState`, `draw.shadow`, `ui.graphics.Brush`, `coil.compose.AsyncImage`,
 *          `ui.res.painterResource`, `lifecycle.compose.collectAsStateWithLifecycle`,
 *          `MascotSpriteSheet`, `AdaptiveSpec`, `DesignTokens`, `MaterialTheme` colors) →
 *          CSS / SVG / props. `Brush.sweepGradient` (L460) → an SVG `<linearGradient>`;
 *          `Canvas` goal ring (L442-467) → the existing `GoalRing` SVG with the same
 *          geometry (r = (54-6)/2 = 21, stroke 6, −90° start, round cap, gold halo ≥ 0.99).
 *  L83     `StateFlow<Long>` totalReadTimeSecondsFlow → `PreferencesManager
 *          .totalReadTimeSeconds()` (`@core/settings/settingsRepository`), the same store
 *          `MainViewModel.kt` L1039-1042 rewrites after every recorded session.
 *  L110-116 The two `LaunchedEffect`s call `onResolveRecordCovers` / `onResolveRecordCoverHeaders`;
 *          they are preserved as effects that call the injected props (the resolvers
 *          themselves live in the library module, owned by another agent).
 *  L133-134 `rememberLazyListState` + `rememberHeaderCollapsedSource` → a scroll listener that
 *          flips `collapsed` past a 24px threshold (the same `TabScreenHeader` contract).
 *  L166-173 `MascotEmptyState(mascotResId = MascotSpriteSheet.sadDrawable, …)` → the existing
 *          `.stats-empty-mascot` glyph; `testTagPrefix = "stats_empty_state"` →
 *          `data-testid="stats_empty_state"` on the block.
 *  L219-223 `adaptiveTitleColor()` → `adaptiveTitleColor(backgroundTone())` from
 *          `@ui/components/AppBackground` (the same LocalBackgroundTone contract).
 *  L231    `rememberTodayCalendar()` → `useTodayCalendar()`: a `useState` seeded with
 *          `todayCalendar()` plus a timer that re-seeds at the next local midnight, so
 *          "跨过午夜/跨周后不刷新" stays fixed (the 2026-09-21 bug the Kotlin comments cite).
 *  L243-246 minutesList `/ 60).toInt()` → `Math.floor(secs / 60)` (Kotlin `Int` division).
 *  L262-270 `WeeklyReadingChart(books, recordCovers, recordBooks, recordCoverHeaders,
 *          onOpenBook)` → those four maps + `onOpenBook` were NOT forwarded (the chart's
 *          prop contract had no such members). `WeeklyReadingChart.tsx` now accepts them
 *          and uses them exactly where Kotlin does (cover resolution L459/L485-500, the
 *          前往阅读 disabled state L564, onClick routing L464-470).
 *  L288    `readingSessions.filter { it.dateStr == date }.sortedBy { it.startTimeMs }` → the
 *          existing `selectedDaySessions` memo (identical).
 *  L506    `LocalContext.current.startActivity(ACTION_SEND createChooser)` → `navigator.share`
 *          with a `navigator.clipboard` fallback (same text built line by line).
 *  L632-636 `Image(painterResource(MascotSpriteSheet.readingDrawable))` → the `.stats-hint-mascot`
 *          glyph (the sprite sheet has no TS asset yet).
 *  L751-759 `ReadingRecordCover(cover, sourceId, headers, …)` (Coil AsyncImage with per-source
 *          loaders) → `<img>` with an `onError` fallback + a `data-source-id` attribute; the
 *          per-source image loaders (`ZLibraryCoverLoader` / `GenericCoverLoader`) are owned by
 *          the library module.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * Room DAO Flow → the `records` / `sessions` props (+ the injected resolvers).
 *  * `LaunchedEffect` → `useEffect`.
 *  * Compose Canvas charts → SVG (already in place for the goal ring and trend chart).
 *  * Coil `AsyncImage` → `<img onError>`.
 *  * `MascotEmptyState` action → an `<AppButton>` calling `onGoToShelf`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassCard } from '@ui/components/GlassCard';
import { SegmentedPillSelector } from '@ui/components/SegmentedPillSelector';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import { WeeklyReadingChart } from '@ui/components/WeeklyReadingChart';
import { GodRankingCard } from '@ui/components/god/GodRankingBody';
import { AppButton } from '@ui/components/AppButton';
import {
  adaptiveTitleColor,
  backgroundTone,
  useAppBackgroundActive,
} from '@ui/components/AppBackground';
import {
  getGodGyroParallaxEnabled,
  getGodRankingStyle,
  setGodJumpChapterId,
} from '@core/god/godRankingSettings';
import {
  deleteGodMoment,
  listGodMoments,
  setGodEditTarget,
} from '@core/god/godMoments';
import type { GodMoment } from '@core/god/godTypes';
import { showToast } from '@ui/toast';
import {
  bootstrapLibrary,
  getBookRepository,
  useAppStore,
} from '@ui/state/appStore';
import { getPlatform } from '@platform/index';
import {
  SettingsRepository,
  createPreferencesManager,
  type PreferencesManager,
} from '@core/settings/settingsRepository';
import {
  dateStrOf,
  dailySeries,
  daysReadBetween,
  formatReadDuration,
  formatSessionTime,
  formatShortDuration,
  heatAlphaLevel,
  mergeDuplicateReadingRecords,
  monthlySeries,
  peakHourTotals,
  readingRecordsToDailyTotals,
  streakEndingAt,
  sumSecondsBetween,
  todayCalendar,
  weekDatesOf,
  type ReadingRecord,
  type ReadingSession,
} from '@ui/lib/readingStats';
import '../../styles/statistics.css';

/* ══════════════════════════════════════════════════════════════════
   Kotlin `com.example.data.Book` subset the statistics page reads:
   L107 `books.count { it.isFinished }`, L615 `books.size`, L737/749 `it.id` / `it.coverUri`.
   ══════════════════════════════════════════════════════════════════ */

export interface StatisticsBook {
  id: number;
  title: string;
  /** Kotlin `Book.coverUri: String?` — 书架封面（可为 null）。 */
  coverUri?: string | null;
  /** Kotlin `Book.isFinished`。 */
  isFinished: boolean;
}

/* ── Icons (Material Icons paths, ported 1:1) ── */

function TimerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
    </svg>
  );
}

function ShowChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
    </svg>
  );
}

function CalendarMonthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

/* ── PeriodRange (StatisticsScreen.kt private data class) ── */

interface PeriodRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
}

function computePeriodRange(period: number, today: Date): PeriodRange {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start: Date;
  let prevStart: Date;
  let prevEnd: Date;

  if (period === 0) {
    // 本周：周一起始
    const week = weekDatesOf(today);
    start = week[0] ?? today;
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
  } else if (period === 1) {
    // 本月
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  } else {
    // 今年
    start = new Date(today.getFullYear(), 0, 1);
    prevStart = new Date(today.getFullYear() - 1, 0, 1);
    prevEnd = new Date(today.getFullYear() - 1, 11, 31);
  }
  return { start, end, prevStart, prevEnd };
}

/* ── MiniStatCard (StatisticsScreen.kt private composable) ── */

function MiniStatCard(props: {
  icon: 'book' | 'check';
  label: string;
  value: string;
}) {
  return (
    <GlassCard radius={16} padding={14} className="stats-mini-card">
      <div
        className={
          props.icon === 'book'
            ? 'stats-mini-icon stats-mini-icon--book'
            : 'stats-mini-icon stats-mini-icon--check'
        }
      >
        {props.icon === 'book' ? <BookIcon /> : <CheckCircleIcon />}
      </div>
      <div className="stats-mini-text">
        <p className="stats-mini-label">{props.label}</p>
        <p className="stats-mini-value">{props.value}</p>
      </div>
    </GlassCard>
  );
}

/* ── GoalRing: Canvas(54.dp) + stroke 6.dp + sweep gradient ── */

function GoalRing(props: { progress: number }) {
  const pct = Math.max(0, Math.min(1, props.progress));
  const radius = 21; // (54 - 6) / 2
  const circumference = 2 * Math.PI * radius;
  const strokeDash = circumference * pct;

  return (
    <div className="stats-goal-ring-wrap">
      <svg viewBox="0 0 54 54" aria-hidden>
        <defs>
          <linearGradient id="statsGoalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        {/* Track: primary.copy(alpha=0.15), full 360, stroke 6 */}
        <circle
          cx="27"
          cy="27"
          r={radius}
          fill="none"
          stroke="rgba(5,150,105,0.15)"
          strokeWidth="6"
        />
        {/* Progress: Brush.sweepGradient(primary, secondary), round cap */}
        {pct > 0 ? (
          <circle
            cx="27"
            cy="27"
            r={radius}
            fill="none"
            stroke="url(#statsGoalGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${circumference}`}
            transform="rotate(-90 27 27)"
            style={{
              transition: 'stroke-dasharray 450ms cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        ) : null}
        {/* Gold halo when goal nearly complete (>= 0.99) */}
        {pct >= 0.99 ? (
          <circle
            cx="27"
            cy="27"
            r={radius + 6}
            fill="none"
            stroke="rgba(232,201,122,0.35)"
            strokeWidth="3"
          />
        ) : null}
      </svg>
      <span className="stats-goal-ring-pct">{Math.trunc(pct * 100)}%</span>
    </div>
  );
}

/* ── PeriodOverviewCard ── */

function PeriodOverviewCard(props: {
  dailyTotals: Map<string, number>;
  books: readonly StatisticsBook[];
  finishedCount: number;
  totalReadTimeSeconds: number;
  /** Kotlin `dailyGoalMinutes: Int = 60`. */
  dailyGoalMinutes?: number;
  /** Kotlin `onGoalChange: (Int) -> Unit = {}`. */
  onGoalChange?: (minutes: number) => void;
}) {
  const { dailyTotals, books, finishedCount } = props;
  const [period, setPeriod] = useState(0); // 0=周 1=月 2=年
  // Kotlin L304 `dailyGoalMinutes: Int = 60` + `onGoalChange` — controlled when the page
  // supplies them, otherwise the local stepper state from before this port.
  const [localGoalMinutes, setLocalGoalMinutes] = useState(60);
  const dailyGoalMinutes = props.dailyGoalMinutes ?? localGoalMinutes;
  const emitGoalChange = props.onGoalChange;
  const setDailyGoalMinutes = useCallback(
    (minutes: number) => {
      if (props.dailyGoalMinutes === undefined) setLocalGoalMinutes(minutes);
      emitGoalChange?.(minutes);
    },
    [emitGoalChange, props.dailyGoalMinutes],
  );
  const today = useMemo(() => todayCalendar(), []);

  const range = useMemo(() => computePeriodRange(period, today), [period, today]);
  const periodTotal = useMemo(
    () => sumSecondsBetween(dailyTotals, range.start, range.end),
    [dailyTotals, range],
  );
  const prevTotal = useMemo(
    () => sumSecondsBetween(dailyTotals, range.prevStart, range.prevEnd),
    [dailyTotals, range],
  );
  const daysInPeriod = useMemo(() => {
    const ms = range.end.getTime() - range.start.getTime();
    return Math.max(1, Math.floor(ms / 86_400_000) + 1);
  }, [range]);
  const avgDaily = Math.floor(periodTotal / daysInPeriod);
  const daysRead = useMemo(
    () => daysReadBetween(dailyTotals, range.start, range.end),
    [dailyTotals, range],
  );
  const streak = useMemo(
    () => streakEndingAt(dailyTotals, todayCalendar()),
    [dailyTotals],
  );
  const deltaPct = useMemo(() => {
    if (prevTotal <= 0 && periodTotal > 0) return 100;
    if (prevTotal <= 0) return 0;
    // Kotlin L365 `((periodTotal - prevTotal) * 100 / prevTotal).toInt()` — Long 整除
    // 向零截断（不是向下取整），负增长率必须用 Math.trunc 而不是 Math.floor。
    return Math.trunc(((periodTotal - prevTotal) * 100) / prevTotal);
  }, [periodTotal, prevTotal]);
  const goalProgress = Math.max(
    0,
    Math.min(1, avgDaily / (dailyGoalMinutes * 60)),
  );

  const periodName = ['本周', '本月', '今年'][period] ?? '本周';
  const prevName = ['上周', '上月', '去年'][period] ?? '上周';

  const avgDailyText =
    avgDaily >= 1 && avgDaily <= 59 ? '不足1分钟' : formatShortDuration(avgDaily);
  const prevText =
    prevTotal <= 0 && periodTotal > 0 ? '首次记录' : `${deltaPct}%`;
  const prevColorClass =
    prevTotal <= 0 && periodTotal > 0
      ? 'stats-period-delta--first'
      : deltaPct > 0
        ? 'stats-period-delta--up'
        : deltaPct < 0
          ? ''
          : 'stats-period-delta--first';

  const weekDates = useMemo(
    () => weekDatesOf(todayCalendar()).map((d) => dateStrOf(d)),
    [],
  );

  const handleShare = () => {
    const shareLabel = period === 0 ? '周' : period === 1 ? '月' : '年';
    const lines = [
      `📚 我的阅读${shareLabel}报 · Ciallo Reader`,
      '────────────────────',
      periodTotal > 0
        ? `⏱ ${periodName}阅读 ${formatReadDuration(periodTotal)}（日均 ${avgDailyText}）`
        : `⏱ ${periodName}暂无阅读记录，从一页开始 ✨`,
      `🎯 每日目标 ${dailyGoalMinutes} 分钟 · 完成 ${Math.trunc(goalProgress * 100)}%`,
    ];
    if (streak > 0) lines.push(`🔥 连续阅读 ${streak} 天`);
    if (daysRead > 0) {
      lines.push(
        `📖 ${periodName}阅读 ${daysRead} 天 · 读完 ${finishedCount} 本`,
      );
    }
    lines.push('━━━━━━━━━━━━━━━━', 'Ciallo Reader · Roxy 陪伴 ✨');
    const text = lines.join('\n');
    if (navigator.share) {
      void navigator.share({ title: '分享阅读报告', text }).catch(() => {});
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <GlassCard radius={20} padding={20} className="stats-period-card">
      {/* ── Block 1: Timer icon + period duration ── */}
      <div className="stats-period-header">
        <div className="stats-timer-box">
          <TimerIcon />
        </div>
        <div className="stats-period-text">
          <p className="stats-period-label">{periodName}阅读时长</p>
          <p className="stats-period-value">{formatReadDuration(periodTotal)}</p>
          <p className={`stats-period-delta ${prevColorClass}`}>
            日均 {avgDailyText} · 较{prevName} {prevText}
          </p>
        </div>
      </div>

      <div className="stats-block-gap" />

      {/* ── Block 2: Goal ring + stepper ── */}
      <div className="stats-goal-row">
        <GoalRing progress={goalProgress} />
        <span className="stats-goal-label">每日目标</span>
        <div className="stats-goal-spacer" />
        <button
          type="button"
          className="stats-goal-step"
          aria-label="减少目标15分钟"
          disabled={dailyGoalMinutes <= 15}
          onClick={() => {
            if (dailyGoalMinutes > 15) setDailyGoalMinutes(dailyGoalMinutes - 15);
          }}
        >
          −
        </button>
        <p className="stats-goal-value">{dailyGoalMinutes}分钟</p>
        <button
          type="button"
          className="stats-goal-step"
          aria-label="增加目标15分钟"
          disabled={dailyGoalMinutes >= 480}
          onClick={() => {
            if (dailyGoalMinutes < 480) setDailyGoalMinutes(dailyGoalMinutes + 15);
          }}
        >
          +
        </button>
      </div>

      <div className="stats-block-gap" />

      {/* ── Block 3: Share report ── */}
      <button type="button" className="stats-share-btn" onClick={handleShare}>
        <ShareIcon />
        分享{periodName}阅读报告
      </button>

      <div className="stats-block-gap" />

      {/* SegmentedPillSelector 周/月/年 */}
      <div className="stats-period-selector">
        <SegmentedPillSelector
          options={[
            { value: 0, label: '周' },
            { value: 1, label: '月' },
            { value: 2, label: '年' },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </div>

      <div style={{ height: 14 }} />

      {/* MiniStatCards */}
      <div className="stats-mini-grid">
        <MiniStatCard
          icon="book"
          label={period === 0 ? '本周阅读天数' : '周期阅读天数'}
          value={`${daysRead} 天`}
        />
        <MiniStatCard icon="check" label="当前连续" value={`${streak} 天`} />
      </div>

      {/* Week lit dots (period == 0) */}
      {period === 0 ? (
        <>
          <div style={{ height: 10 }} />
          <div className="stats-week-lit">
            <p className="stats-week-lit-label">本周点亮</p>
            <div className="stats-week-lit-dots">
              {weekDates.map((date) => {
                const lit = (dailyTotals.get(date) ?? 0) > 0;
                return (
                  <span
                    key={date}
                    className={
                      lit
                        ? 'stats-week-lit-dot stats-week-lit-dot--lit'
                        : 'stats-week-lit-dot stats-week-lit-dot--unlit'
                    }
                  />
                );
              })}
            </div>
            <p className="stats-week-lit-meta">
              {books.length} 本藏书 · {finishedCount} 本读完
            </p>
          </div>
        </>
      ) : null}

      {/* Small-data mascot hint (periodTotal in 1..299) */}
      {periodTotal >= 1 && periodTotal < 300 ? (
        <>
          <div className="stats-block-gap" />
          <div className="stats-hint-row">
            <span className="stats-hint-mascot" aria-hidden>
              📖
            </span>
            <div>
              <p className="stats-hint-title">
                {periodName}只读了 {formatShortDuration(periodTotal)}
              </p>
              <p className="stats-hint-sub">Roxy 捧着魔法书等你翻开第一页～</p>
            </div>
          </div>
        </>
      ) : null}
    </GlassCard>
  );
}

/* ── ReadingCalendarCard ── */

const HEAT_LEVELS = [0.32, 0.52, 0.72, 0.95];

function heatBackground(seconds: number): string {
  const level = heatAlphaLevel(seconds);
  if (level === 0) return 'rgba(227,229,231,0.45)';
  return `rgba(5,150,105,${HEAT_LEVELS[level - 1] ?? 0.32})`;
}

function MonthGrid(props: {
  dailyTotals: Map<string, number>;
  year: number;
  month: number; // 0-based
  todayStr: string;
  onDayClick: (dateStr: string) => void;
}) {
  const { dailyTotals, year, month, todayStr, onDayClick } = props;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // leading: (DAY_OF_WEEK + 5) % 7 with Mon=0
  const leading = (first.getDay() + 5) % 7;

  const peakSeconds = useMemo(() => {
    let max = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const v = dailyTotals.get(ds) ?? 0;
      if (v > max) max = v;
    }
    return max > 0 ? max : 0;
  }, [dailyTotals, year, month, daysInMonth]);

  const rows = Math.ceil((leading + daysInMonth) / 7);
  const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div>
      <div className="stats-cal-weekdays">
        {weekdayLabels.map((d) => (
          <span key={d} className="stats-cal-weekday">
            {d}
          </span>
        ))}
      </div>
      <div className="stats-cal-grid">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="stats-cal-row">
            {Array.from({ length: 7 }, (_, col) => {
              const day = r * 7 + col - leading + 1;
              if (day < 1 || day > daysInMonth) {
                return <span key={col} className="stats-cal-cell stats-cal-cell--empty" />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const seconds = dailyTotals.get(dateStr) ?? 0;
              const isToday = dateStr === todayStr;
              const isPeak = seconds > 0 && seconds === peakSeconds;
              const filled = seconds > 0;
              const classes = [
                'stats-cal-cell',
                filled ? 'stats-cal-cell--filled' : 'stats-cal-cell--unread',
                isToday ? 'stats-cal-cell--today' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={col}
                  type="button"
                  className={classes}
                  style={filled ? { background: heatBackground(seconds) } : undefined}
                  onClick={() => onDayClick(dateStr)}
                >
                  {isPeak ? <span className="stats-cal-cell-peak" /> : null}
                  <span className="stats-cal-cell-day">{day}</span>
                  {filled ? (
                    <span className="stats-cal-cell-dur">
                      {formatShortDuration(seconds)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function YearHeatmap(props: {
  dailyTotals: Map<string, number>;
  year: number;
  todayStr: string;
  onDayClick: (dateStr: string) => void;
}) {
  const { dailyTotals, year, todayStr, onDayClick } = props;
  const cell = 16; // minCell
  const cellGap = 3;

  const grid = useMemo(() => {
    const first = new Date(year, 0, 1);
    const jan1Dow = (first.getDay() + 5) % 7; // Mon=0
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = isLeap ? 366 : 365;
    const columns = Math.ceil((jan1Dow + days) / 7);
    const cells: Array<string | null> = new Array(columns * 7).fill(null);
    const c = new Date(year, 0, 1);
    for (let d = 1; d <= days; d++) {
      const idx = jan1Dow + d - 1;
      if (idx >= 0 && idx < cells.length) {
        cells[idx] = dateStrOf(c);
      }
      c.setDate(c.getDate() + 1);
    }
    const monthStartColumn: number[] = [];
    for (let m = 0; m < 12; m++) {
      const c2 = new Date(year, m, 1);
      const doy = Math.round(
        (c2.getTime() - new Date(year, 0, 1).getTime()) / 86_400_000,
      );
      monthStartColumn.push(Math.floor((jan1Dow + doy) / 7));
    }
    const today = todayCalendar();
    const todayColumn =
      today.getFullYear() === year
        ? Math.floor(
            (jan1Dow +
              Math.round(
                (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
                  new Date(year, 0, 1).getTime()) /
                  86_400_000,
              )) /
              7,
          )
        : -1;
    return { columns, daysInYear: days, cells, monthStartColumn, todayColumn, jan1Dow };
  }, [year]);

  const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];

  // Kotlin L334-345 `rememberScrollState()` + `LaunchedEffect(year, step) { animateScrollTo(
  //   ((todayColumn - 3) * stepPx).coerceAtLeast(0).coerceAtMost(maxValue)) }` — 打开年视图
  // 先滚到「今天」附近，而不是停在 1 月。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const stepPx = cell + cellGap;
    const target =
      grid.todayColumn >= 0 ? Math.max(0, grid.todayColumn - 3) * stepPx : el.scrollWidth;
    el.scrollLeft = Math.min(target, Math.max(0, el.scrollWidth - el.clientWidth));
  }, [cell, cellGap, grid.todayColumn]);

  return (
    <div>
      <div className="stats-year-scroll" ref={scrollRef}>
        <div className="stats-year-inner">
          <div className="stats-year-labels">
            <div className="stats-year-labels-head" />
            {weekLabels.map((label, r) => (
              <div
                key={label}
                className="stats-year-week-label"
                style={{ height: cell + cellGap }}
              >
                {r === 0 || r === 2 || r === 4 || r === 6 ? label : ''}
              </div>
            ))}
          </div>
          <div className="stats-year-body">
            <div className="stats-year-months">
              {Array.from({ length: 12 }, (_, m) => {
                const start = grid.monthStartColumn[m] ?? 0;
                const end = m === 11 ? grid.columns : (grid.monthStartColumn[m + 1] ?? grid.columns);
                const span = Math.max(1, end - start);
                const w = span * (cell + cellGap);
                return (
                  <div key={m} className="stats-year-month" style={{ width: w }}>
                    {w >= 26 ? `${m + 1}月` : ''}
                  </div>
                );
              })}
            </div>
            {weekLabels.map((_, r) => (
              <div key={r} className="stats-year-row">
                {Array.from({ length: grid.columns }, (_, col) => {
                  const dateStr = grid.cells[col * 7 + r] ?? null;
                  if (dateStr == null) {
                    return (
                      <span
                        key={col}
                        style={{ width: cell, height: cell, flexShrink: 0 }}
                      />
                    );
                  }
                  const seconds = dailyTotals.get(dateStr) ?? 0;
                  const filled = seconds > 0;
                  const level = heatAlphaLevel(seconds);
                  const isTodayYear = dateStr === todayStr;
                  return (
                    <button
                      key={col}
                      type="button"
                      className={
                        filled
                          ? 'stats-year-cell stats-year-cell--filled'
                          : 'stats-year-cell'
                      }
                      style={{
                        ...(filled
                          ? {
                              background: `rgba(5,150,105,${HEAT_LEVELS[level - 1] ?? 0.32})`,
                            }
                          : {}),
                        ...(isTodayYear
                          ? {
                              outline: '1.5px solid var(--color-mint-gold, #e8c97a)',
                              outlineOffset: '-1.5px',
                            }
                          : {}),
                      }}
                      onClick={() => onDayClick(dateStr)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="stats-cal-legend">
        <p className="stats-cal-legend-label">少</p>
        {HEAT_LEVELS.map((a) => (
          <span
            key={a}
            className="stats-cal-legend-swatch"
            style={{ background: `rgba(5,150,105,${a})` }}
          />
        ))}
        <p className="stats-cal-legend-label" style={{ marginLeft: 4 }}>
          多
        </p>
        <p className="stats-cal-legend-hint">颜色越深 = 当天读得越久</p>
      </div>
    </div>
  );
}

function ReadingCalendarCard(props: {
  dailyTotals: Map<string, number>;
  onDayClick: (dateStr: string) => void;
}) {
  const { dailyTotals, onDayClick } = props;
  const today = useMemo(() => todayCalendar(), []);
  const todayStr = useMemo(() => dateStrOf(today), [today]);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [showYear, setShowYear] = useState(false);

  const navPrev = () => {
    if (showYear) setViewYear((y) => y - 1);
    else if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };
  const navNext = () => {
    if (showYear) setViewYear((y) => y + 1);
    else if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };
  const isCurrent =
    viewYear === today.getFullYear() &&
    (showYear || viewMonth === today.getMonth());

  return (
    <GlassCard radius={20} padding={16} className="stats-calendar-card">
      <div className="stats-card-header">
        <div className="stats-icon-circle">
          <CalendarMonthIcon />
        </div>
        <div className="stats-card-header-text">
          <p className="stats-card-title">阅读日历</p>
          <p className="stats-card-subtitle">每日阅读热力</p>
        </div>
        <div className="stats-card-header-spacer" />
        <div className="stats-calendar-selector">
          <SegmentedPillSelector
            options={[
              { value: 0, label: '月' },
              { value: 1, label: '年' },
            ]}
            value={showYear ? 1 : 0}
            onChange={(v) => setShowYear(v === 1)}
          />
        </div>
      </div>

      <div className="stats-cal-nav">
        <button type="button" className="stats-cal-nav-btn" aria-label="上个月/年" onClick={navPrev}>
          <ChevronLeftIcon />
        </button>
        <p className="stats-cal-nav-title">
          {showYear ? `${viewYear} 年` : `${viewYear}年${viewMonth + 1}月`}
        </p>
        <button type="button" className="stats-cal-nav-btn" aria-label="下个月/年" onClick={navNext}>
          <ChevronRightIcon />
        </button>
        {!isCurrent ? (
          <button
            type="button"
            className="stats-cal-today-btn"
            onClick={() => {
              setViewYear(today.getFullYear());
              setViewMonth(today.getMonth());
            }}
          >
            回到今天
          </button>
        ) : null}
      </div>

      <div style={{ marginTop: 8 }}>
        {showYear ? (
          <YearHeatmap
            dailyTotals={dailyTotals}
            year={viewYear}
            todayStr={todayStr}
            onDayClick={onDayClick}
          />
        ) : (
          <MonthGrid
            dailyTotals={dailyTotals}
            year={viewYear}
            month={viewMonth}
            todayStr={todayStr}
            onDayClick={onDayClick}
          />
        )}
      </div>
    </GlassCard>
  );
}

/* ── ReadingTrendCard ── */

function ReadingTrendCard(props: {
  dailyTotals: Map<string, number>;
  sessions: readonly ReadingSession[];
}) {
  const { dailyTotals, sessions } = props;
  const [tab, setTab] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(-1);
  const [selectedHour, setSelectedHour] = useState(-1);
  const today = useMemo(() => todayCalendar(), []);

  const series = useMemo(() => {
    if (tab === 0) {
      const from = new Date(today);
      from.setDate(from.getDate() - 13);
      return dailySeries(dailyTotals, from, today);
    }
    if (tab === 1) {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return dailySeries(dailyTotals, from, today);
    }
    return monthlySeries(dailyTotals, 12, today);
  }, [dailyTotals, tab, today]);

  const seriesLabel = ['近14天', '近30天', '近12个月'][tab] ?? '近14天';

  const peak = useMemo(() => {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return peakHourTotals(sessions, from, today);
  }, [sessions, today]);
  const peakMaxHour = peak.reduce(
    (best, v, i) => (v > (peak[best] ?? 0) ? i : best),
    0,
  );
  const peakTotal = peak.reduce((a, b) => a + b, 0);

  const maxSeconds = series.reduce((m, [, v]) => Math.max(m, v), 0);
  const seriesPeak = maxSeconds;
  const allZero = series.every(([, v]) => v <= 0);

  const W = 300;
  const H = 150;
  const topPad = 10;
  const bottomPad = 8;
  const maxVal = Math.max(1, seriesPeak);
  const stepX = series.length > 1 ? W / (series.length - 1) : W;
  const points = series.map(([, v], i) => ({
    x: i * stepX,
    y: H - bottomPad - (v / maxVal) * (H - topPad - bottomPad),
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const fillPath = points.length
    ? `${linePath} L${W},${H} L0,${H} Z`
    : '';
  const peakIndex = series.reduce(
    (best, [, v], i) => (v > (series[best]?.[1] ?? 0) ? i : best),
    0,
  );

  const handleChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (series.length <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    // Kotlin L272 `(offset.x / stepX).toInt().coerceIn(0, series.size - 1)` —
    // Float→Int 向零截断，不是四舍五入（取整会让点击整体偏移半个桶）。
    const idx = Math.max(0, Math.min(series.length - 1, Math.trunc(x / stepX)));
    setSelectedPoint(idx);
  };

  const selected = selectedPoint >= 0 ? series[selectedPoint] : null;
  const selectedHourValid =
    selectedHour >= 0 && selectedHour <= 23 && (peak[selectedHour] ?? 0) > 0;

  return (
    <GlassCard radius={20} padding={16} className="stats-trend-card">
      <div className="stats-card-header">
        <div className="stats-icon-circle">
          <ShowChartIcon />
        </div>
        <div className="stats-card-header-text">
          <p className="stats-card-title">阅读趋势</p>
          <p className="stats-card-subtitle">时长走势与高峰时段</p>
        </div>
        <div className="stats-card-header-spacer" />
        <div className="stats-trend-selector">
          <SegmentedPillSelector
            options={[
              { value: 0, label: '周' },
              { value: 1, label: '月' },
              { value: 2, label: '年' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className="stats-trend-meta">
        <p className="stats-trend-meta-label">阅读时长 · {seriesLabel}</p>
        <p className="stats-trend-meta-peak">峰值 {formatShortDuration(seriesPeak)}</p>
      </div>

      {selected ? (
        <div className="stats-trend-tooltip">
          {selected[0]} · {formatShortDuration(selected[1])}
        </div>
      ) : null}

      <div className="stats-trend-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onClick={handleChartClick}>
          <defs>
            <linearGradient id="statsTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(5,150,105,0.30)" />
              <stop offset="100%" stopColor="rgba(5,150,105,0)" />
            </linearGradient>
          </defs>
          {/* Grid lines g=1..3 */}
          {[1, 2, 3].map((g) => {
            const gy = topPad + ((H - topPad - bottomPad) * g) / 4;
            return (
              <line
                key={g}
                x1={0}
                y1={gy}
                x2={W}
                y2={gy}
                stroke="rgba(148,163,184,0.35)"
                strokeWidth={1}
              />
            );
          })}
          {/* Baseline */}
          <line
            x1={0}
            y1={H - bottomPad}
            x2={W}
            y2={H - bottomPad}
            stroke="rgba(148,163,184,0.77)"
            strokeWidth={1}
          />
          {series.length >= 2 ? (
            <>
              <path d={fillPath} fill="url(#statsTrendFill)" />
              <path
                d={linePath}
                fill="none"
                stroke="#059669"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {peakIndex >= 0 && points[peakIndex] ? (
                <>
                  <circle
                    cx={points[peakIndex]?.x ?? 0}
                    cy={points[peakIndex]?.y ?? 0}
                    r={7}
                    fill="#E8C97A"
                  />
                  <circle
                    cx={points[peakIndex]?.x ?? 0}
                    cy={points[peakIndex]?.y ?? 0}
                    r={3}
                    fill="#fff"
                  />
                </>
              ) : null}
              {selectedPoint < 0 && points.length > 0 ? (
                <>
                  <circle
                    cx={points[0]?.x ?? 0}
                    cy={points[0]?.y ?? 0}
                    r={4}
                    fill="#059669"
                  />
                  <circle
                    cx={points[points.length - 1]?.x ?? 0}
                    cy={points[points.length - 1]?.y ?? 0}
                    r={4}
                    fill="#059669"
                  />
                </>
              ) : null}
              {selectedPoint >= 0 && points[selectedPoint] ? (
                <>
                  <circle
                    cx={points[selectedPoint]?.x ?? 0}
                    cy={points[selectedPoint]?.y ?? 0}
                    r={12}
                    fill="rgba(5,150,105,0.35)"
                  />
                  <circle
                    cx={points[selectedPoint]?.x ?? 0}
                    cy={points[selectedPoint]?.y ?? 0}
                    r={5}
                    fill="#059669"
                  />
                  <circle
                    cx={points[selectedPoint]?.x ?? 0}
                    cy={points[selectedPoint]?.y ?? 0}
                    r={2}
                    fill="#fff"
                  />
                </>
              ) : null}
            </>
          ) : null}
        </svg>
        {maxSeconds > 0 ? (
          <span className="stats-trend-scale">满刻度 {formatShortDuration(maxSeconds)}</span>
        ) : null}
        {allZero ? (
          <div className="stats-trend-empty">还没有阅读时长——去读一页，让曲线开始生长</div>
        ) : null}
      </div>

      <div className="stats-peak-header">
        <p className="stats-peak-title">阅读高峰时段</p>
        {peakTotal > 0 ? (
          <p className="stats-peak-badge">
            高峰 {peakMaxHour}:00 - {peakMaxHour + 1}:00
          </p>
        ) : null}
      </div>

      {peakTotal > 0 ? (
        <>
          {selectedHourValid ? (
            <div className="stats-peak-tooltip">
              {selectedHour}:00 - {selectedHour + 1}:00 ·{' '}
              {formatShortDuration(peak[selectedHour] ?? 0)}
            </div>
          ) : null}
          <div className="stats-peak-bars">
            {peak.map((v, hour) => {
              const max = Math.max(1, ...peak);
              const ratio = v / max;
              const isMax = v > 0 && v === max;
              // Kotlin L363 `ratio.coerceAtLeast(0.04f)` 直接作为 fillMaxHeight 的比例，
              // 不做百分比取整（取整会把 4.5% 压成 4% 或 5%）。
              const heightPct = Math.max(4, ratio * 100);
              const barClass = [
                'stats-peak-bar',
                selectedHour === hour ? 'stats-peak-bar--selected' : '',
                isMax && selectedHour !== hour ? 'stats-peak-bar--max' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={hour}
                  type="button"
                  className="stats-peak-bar-col"
                  aria-label={`${hour}:00`}
                  onClick={() => setSelectedHour(hour)}
                >
                  <span
                    className={barClass}
                    style={{
                      height: `${String(heightPct)}%`,
                      transitionDelay: `${String(hour * 12)}ms`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="stats-peak-empty">
          暂无时段数据（更新后开始记录每次阅读的起止时间）
        </p>
      )}
    </GlassCard>
  );
}

/* ── DayDetailSheet (AcrylicBottomOverlay) ── */

/**
 * Android L751-759 `ReadingRecordCover(cover, sourceId, headers, contentDescription, …)`.
 * Coil `AsyncImage` with a per-source loader → `<img>` + `onError` fallback; the header
 * map is exposed as `data-headers` because a plain `<img>` cannot carry request headers.
 */
function ReadingRecordCover(props: {
  cover: string;
  sourceId: string | null;
  headers: Readonly<Record<string, string>>;
  contentDescription: string | null;
}) {
  const [failed, setFailed] = useState(false);
  // 换封面就重置失败标记 — React 官方的「渲染期校正 state」写法（等价于
  // `useEffect(() => setFailed(false), [cover])`，但不产生级联渲染）。
  const [renderedCover, setRenderedCover] = useState(props.cover);
  if (renderedCover !== props.cover) {
    setRenderedCover(props.cover);
    setFailed(false);
  }
  if (failed) return <BookIcon />;
  return (
    <img
      src={props.cover}
      alt={props.contentDescription ?? ''}
      data-source-id={props.sourceId ?? ''}
      data-headers={JSON.stringify(props.headers)}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

function DayDetailSheet(props: {
  date: string;
  totalSeconds: number;
  records: ReadingRecord[];
  sessions: ReadingSession[];
  /** Kotlin `recordCovers: Map<Int, String>` — 已删除书籍的封面补抓结果. */
  recordCovers?: ReadonlyMap<number, string>;
  /** Kotlin `recordBooks: Map<Int, SearchBook>` — keyed by reading-record id. */
  recordBooks?: ReadonlyMap<number, { sourceId: string }>;
  /** Kotlin `recordCoverHeaders: Map<Int, Map<String, String>>`. */
  recordCoverHeaders?: ReadonlyMap<number, Readonly<Record<string, string>>>;
  /** Kotlin L269-276 `books.firstOrNull { it.id == record.bookId }`. */
  books?: ReadonlyArray<StatisticsBook>;
  onOpenRecordDetail?: (record: ReadingRecord) => void;
  /** Kotlin `onOpenBook: (Book) -> Unit`. */
  onOpenBook?: (bookId: number) => void;
  onDeleteRecord?: (record: ReadingRecord) => void;
  onDismiss: () => void;
}) {
  const {
    date,
    totalSeconds,
    records,
    sessions,
    recordCovers,
    recordBooks,
    recordCoverHeaders,
    books = [],
    onOpenRecordDetail,
    onOpenBook,
    onDeleteRecord,
    onDismiss,
  } = props;

  return (
    <div
      className="stats-sheet-backdrop"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        className="stats-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="stats-sheet-title">{date} 阅读明细</h3>
        <p className="stats-sheet-total">共 {formatReadDuration(totalSeconds)}</p>
        <div className="stats-sheet-body">
          {records.length === 0 && sessions.length === 0 ? (
            <p className="stats-sheet-empty">这一天没有阅读记录</p>
          ) : null}

          {records.map((record) => {
            // Kotlin L737-745 `localBook` / `recordBook` resolution: 本地书优先，
            // 其次是 recordBooks 里 sourceId 非空的在线书。
            const localBook =
              record.bookId != null
                ? (books.find((book) => book.id === record.bookId) ?? null)
                : null;
            const recordBookSourceId = recordBooks?.get(record.id)?.sourceId ?? '';
            const hasRecordBook = recordBookSourceId !== '';
            // Kotlin L749 `val cover = localBook?.coverUri ?: recordCovers[record.id]`
            const cover = localBook?.coverUri ?? recordCovers?.get(record.id) ?? null;
            const headers = recordCoverHeaders?.get(record.id) ?? {};
            return (
              <button
                key={record.id}
                type="button"
                className="stats-sheet-record"
                disabled={localBook === null && !hasRecordBook}
                onClick={() => {
                  if (localBook !== null && onOpenBook !== undefined) onOpenBook(localBook.id);
                  else if (hasRecordBook) onOpenRecordDetail?.(record);
                }}
              >
                <div className="stats-sheet-record-cover">
                  {cover !== null && cover !== '' ? (
                    <ReadingRecordCover
                      cover={cover}
                      sourceId={recordBookSourceId === '' ? null : recordBookSourceId}
                      headers={headers}
                      contentDescription={record.bookTitle}
                    />
                  ) : (
                    <BookIcon />
                  )}
                </div>
                <div className="stats-sheet-record-text">
                  <p className="stats-sheet-record-title">{record.bookTitle}</p>
                  <p className="stats-sheet-record-dur">
                    {formatReadDuration(record.durationSeconds)}
                  </p>
                </div>
                <span
                  className="stats-sheet-record-del"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRecord?.(record);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onDeleteRecord?.(record);
                    }
                  }}
                >
                  删除
                </span>
              </button>
            );
          })}

          {sessions.length > 0 ? (
            <>
              <p className="stats-sheet-sessions-title">阅读时段</p>
              {sessions.map((session) => (
                <div key={session.id} className="stats-sheet-session">
                  <p className="stats-sheet-session-time">
                    {formatSessionTime(session)} 起
                  </p>
                  <p className="stats-sheet-session-dur">
                    {formatShortDuration(session.durationSeconds)}
                  </p>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   StatisticsScreen — main entry
   ══════════════════════════════════════════════════════════════════ */

export interface StatisticsPageProps {
  /** Kotlin `books: List<Book>` — the shelf list. */
  books?: readonly StatisticsBook[];
  /** Kotlin `readingRecords: List<ReadingRecord> = emptyList()`. */
  readingRecords?: readonly ReadingRecord[];
  /** Kotlin `readingSessions: List<ReadingSession> = emptyList()`. */
  readingSessions?: readonly ReadingSession[];
  /**
   * Kotlin `totalReadTimeSecondsFlow: StateFlow<Long>` — the persisted cumulative
   * counter (`totalRecordedSeconds() + legacyUnattributedSeconds`). Defaults to the
   * same value read from `PreferencesManager`; deleting a reading record does not
   * lower it (Kotlin L164 does not update the flow).
   */
  totalReadTimeSeconds?: number;
  /** Kotlin `onGoToShelf: () -> Unit = {}` — the empty-state action. */
  onGoToShelf?: () => void;
  /** Kotlin `onDeleteRecord: (ReadingRecord) -> Unit = {}`. */
  onDeleteRecord?: (record: ReadingRecord) => void;
  /** Kotlin `recordCovers: Map<Int, String> = emptyMap()`. */
  recordCovers?: ReadonlyMap<number, string>;
  /** Kotlin `recordBooks: Map<Int, SearchBook> = emptyMap()`. */
  recordBooks?: ReadonlyMap<number, { sourceId: string }>;
  /** Kotlin `recordCoverHeaders: Map<Int, Map<String, String>> = emptyMap()`. */
  recordCoverHeaders?: ReadonlyMap<number, Readonly<Record<string, string>>>;
  /** Kotlin `onResolveRecordCoverHeaders: (List<ReadingRecord>) -> Unit = {}`. */
  onResolveRecordCoverHeaders?: (records: readonly ReadingRecord[]) => void;
  /** Kotlin `onResolveRecordCovers: (List<ReadingRecord>) -> Unit = {}`. */
  onResolveRecordCovers?: (records: readonly ReadingRecord[]) => void;
  /** Kotlin `onOpenRecordDetail: (SearchBook) -> Unit = {}`. */
  onOpenRecordDetail?: (record: ReadingRecord) => void;
  /** Kotlin `onOpenBook: (Book) -> Unit = {}`. */
  onOpenBook?: (bookId: number) => void;
  /** Kotlin `dailyGoalMinutes: Int = 60`. */
  dailyGoalMinutes?: number;
  /** Kotlin `onGoalChange: (Int) -> Unit = {}`. */
  onGoalChange?: (minutes: number) => void;
}

/**
 * `rememberTodayCalendar()` — Android re-evaluates `todayCalendar()` once per day so the
 * week view resets after midnight. Ported with a timer that re-seeds at the next local
 * midnight (the 2026-09-21 bug this fixes is called out in StatisticsScreen.kt L229-230).
 */
function useTodayCalendar(): Date {
  const [today, setToday] = useState<Date>(() => todayCalendar());
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0,
    ).getTime();
    const timer = window.setTimeout(() => {
      setToday(todayCalendar());
    }, Math.max(1000, nextMidnight - now.getTime() + 500));
    return () => {
      window.clearTimeout(timer);
    };
  }, [today]);
  return today;
}

/**
 * Kotlin `MainActivity.kt` L833-861 injects the Room flows into `StatisticsScreen`:
 * `books = viewModel.books`, `readingRecords` / `readingSessions` from the DAO,
 * `totalReadTimeSecondsFlow = viewModel.totalReadTimeSeconds`
 * (L1039-1042: `totalRecordedSeconds() + prefs.legacyUnattributedSeconds`),
 * `dailyGoalMinutes = viewModel.prefs.dailyGoalMinutes`.
 *
 * The routed page passes no props (`App.tsx` L86 renders `<StatisticsPage />`), so the
 * data has to be loaded here — previously this fell back to hard-coded demo rows, which
 * made the whole page show a fabricated book / 7 分钟 / one heat cell to every user.
 * Props still win, so tests and previews can inject their own snapshots.
 */
function useStatisticsData(props: StatisticsPageProps): {
  books: readonly StatisticsBook[];
  readingRecords: readonly ReadingRecord[];
  readingSessions: readonly ReadingSession[];
  totalReadTimeSeconds: number;
  dailyGoalMinutes: number;
  setDailyGoalMinutes: (minutes: number) => void;
} {
  const platform = useMemo(() => getPlatform(), []);
  const prefs = useMemo<PreferencesManager>(
    () => createPreferencesManager(platform.db),
    [platform],
  );
  const settings = useMemo(() => new SettingsRepository(platform.db), [platform]);
  const libraryReady = useAppStore((s) => s.libraryReady);

  const [loadedBooks, setLoadedBooks] = useState<readonly StatisticsBook[]>([]);
  const [loadedRecords, setLoadedRecords] = useState<readonly ReadingRecord[]>([]);
  const [loadedSessions, setLoadedSessions] = useState<readonly ReadingSession[]>([]);
  const [loadedTotal, setLoadedTotal] = useState(0);
  const [loadedGoal, setLoadedGoal] = useState(60);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const repo = getBookRepository();
    try {
      await bootstrapLibrary();
    } catch {
      // 开库失败：保持空列表（与 Kotlin 首装无记录时的空状态一致），不伪造数据。
    }
    if (!aliveRef.current) return;
    try {
      const [shelf, records, sessions, total, goal] = await Promise.all([
        repo === null ? Promise.resolve([]) : repo.getBookshelf(),
        repo === null ? Promise.resolve([]) : repo.getAllReadingRecordsFlow(),
        repo === null ? Promise.resolve([]) : repo.getAllReadingSessionsFlow(),
        prefs.totalReadTimeSeconds(),
        prefs.dailyGoalMinutes(),
      ]);
      if (!aliveRef.current) return;
      setLoadedBooks(
        shelf.map((row) => ({
          id: row.id ?? 0,
          title: row.title,
          coverUri: row.coverUri,
          isFinished: row.isFinished === 1,
        })),
      );
      setLoadedRecords(
        records.map((row) => ({
          id: row.id ?? 0,
          bookId: row.bookId,
          bookTitle: row.bookTitle,
          dateStr: row.dateStr,
          durationSeconds: row.durationSeconds,
        })),
      );
      setLoadedSessions(
        sessions.map((row) => ({
          id: row.id ?? 0,
          dateStr: row.dateStr,
          startTimeMs: row.startTimeMs,
          startHour: row.startHour,
          durationSeconds: row.durationSeconds,
        })),
      );
      setLoadedTotal(total);
      setLoadedGoal(goal);
    } catch {
      // 读库失败：留在空状态，绝不显示编造的数字。
    }
  }, [prefs]);

  useEffect(() => {
    if (!libraryReady) return;
    void (async () => {
      await reload();
    })();
  }, [libraryReady, reload]);

  const setDailyGoalMinutes = useCallback(
    (minutes: number): void => {
      // Kotlin PreferencesManager.kt L216 `putInt("daily_goal_minutes", value.coerceIn(5, 480))`
      const clamped = Math.min(480, Math.max(5, minutes));
      setLoadedGoal(clamped);
      void settings.setInt('daily_goal_minutes', clamped);
    },
    [settings],
  );

  return {
    books: props.books ?? loadedBooks,
    readingRecords: props.readingRecords ?? loadedRecords,
    readingSessions: props.readingSessions ?? loadedSessions,
    // Kotlin L106 `totalReadTimeSecondsFlow.collectAsStateWithLifecycle()` —— 持久化的
    // 累计值（删一条阅读记录不会让它回落），不是当前记录的即时求和。
    totalReadTimeSeconds: props.totalReadTimeSeconds ?? loadedTotal,
    dailyGoalMinutes: props.dailyGoalMinutes ?? loadedGoal,
    setDailyGoalMinutes,
  };
}

export function StatisticsPage(props: StatisticsPageProps = {}) {
  const onGoalChangeProp = props.onGoalChange;
  const data = useStatisticsData(props);
  const books = data.books;
  const readingRecords = data.readingRecords;
  const readingSessions = data.readingSessions;
  const totalReadTimeSeconds = data.totalReadTimeSeconds;
  const dailyGoalMinutes = data.dailyGoalMinutes;
  const persistGoalMinutes = data.setDailyGoalMinutes;
  const handleGoalChange = useCallback(
    (minutes: number): void => {
      if (onGoalChangeProp !== undefined) onGoalChangeProp(minutes);
      persistGoalMinutes(minutes);
    },
    [onGoalChangeProp, persistGoalMinutes],
  );
  const finishedCount = books.filter((b) => b.isFinished).length;

  // 已删除书籍的封面补抓 — Kotlin L109-112
  const resolveCovers = props.onResolveRecordCovers;
  useEffect(() => {
    resolveCovers?.(readingRecords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRecords]);

  // Kotlin L113-116
  const resolveCoverHeaders = props.onResolveRecordCoverHeaders;
  const recordBooks = props.recordBooks;
  useEffect(() => {
    resolveCoverHeaders?.(readingRecords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRecords, recordBooks]);

  const dailyTotals = useMemo(
    () => readingRecordsToDailyTotals(readingRecords),
    [readingRecords],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 滚动联动折叠头部：StatisticsScreen.kt L133-134 (rememberLazyListState + collapsedSource)
  const listRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (el === null) return undefined;
    const onScroll = (): void => {
      setCollapsed(el.scrollTop > 24);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Kotlin L127-129 `if (LocalAppBackgroundActive.current) Color.Transparent else background`
  const appBackgroundActive = useAppBackgroundActive();
  const titleColor = adaptiveTitleColor(backgroundTone({
    mode: appBackgroundActive ? 1 : 0,
    uri: null,
    dim: 0,
  }));

  // Weekly detail: today index + week dates + minutes/books/records per day
  const todayCal = useTodayCalendar();
  const todayIdx = useMemo(
    () => (todayCal.getDay() + 5) % 7, // Calendar.DAY_OF_WEEK Mon-based
    [todayCal],
  );
  const weekDates = useMemo(
    () => weekDatesOf(todayCal).map((d) => dateStrOf(d)),
    [todayCal],
  );
  const minutesList = useMemo(
    () =>
      weekDates.map((date) => {
        const secs = readingRecords
          .filter((r) => r.dateStr === date)
          .reduce((s, r) => s + r.durationSeconds, 0);
        return Math.floor(secs / 60);
      }),
    [readingRecords, weekDates],
  );
  const booksList = useMemo(
    () =>
      weekDates.map((date) => {
        const daily = readingRecords.filter((r) => r.dateStr === date);
        if (daily.length === 0) return '';
        return Array.from(new Set(daily.map((r) => r.bookTitle))).join(', ');
      }),
    [readingRecords, weekDates],
  );
  const dayRecords = useMemo(
    () =>
      weekDates.map((date) =>
        mergeDuplicateReadingRecords(
          readingRecords
            .filter((r) => r.dateStr === date)
            .slice()
            .sort((a, b) => b.id - a.id),
        ),
      ),
    [readingRecords, weekDates],
  );

  const selectedDayRecords = useMemo(() => {
    if (!selectedDate) return [];
    return mergeDuplicateReadingRecords(
      readingRecords.filter((r) => r.dateStr === selectedDate),
    );
  }, [selectedDate, readingRecords]);

  const selectedDaySessions = useMemo(() => {
    if (!selectedDate) return [];
    return readingSessions
      .filter((s) => s.dateStr === selectedDate)
      .slice()
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
  }, [selectedDate, readingSessions]);

  /* ── 神回排行榜（StatisticsScreen L187-199：紧随核心数据卡片之后） ── */
  const setRoute = useAppStore((s) => s.setRoute);
  const godMoments = listGodMoments();
  const godStyle = getGodRankingStyle();
  const godGyroEnabled = getGodGyroParallaxEnabled();
  const godReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const handleGodItemClick = (moment: GodMoment): void => {
    const parts = moment.bookId.split('::');
    const sourceId = parts[0] ?? '';
    const comicId = parts[1] ?? '';
    if (sourceId.trim() !== '' && comicId.trim() !== '') {
      setGodJumpChapterId(moment.chapterId);
      setRoute('comicChapters');
    }
  };

  const handleGodEdit = (moment: GodMoment): void => {
    setGodEditTarget(moment.id);
    setRoute('godEditor');
  };

  const handleGodDelete = (moment: GodMoment): void => {
    deleteGodMoment(moment.id);
    showToast('已移除神回');
  };

  return (
    <div
      className="page statistics-page"
      style={appBackgroundActive ? { background: 'transparent' } : undefined}
    >
      <TabScreenHeader
        title="阅读统计"
        subtitle="STATISTICS & INSIGHTS"
        collapsed={collapsed}
        titleColor={titleColor}
      />

      {totalReadTimeSeconds === 0 ? (
        <div className="statistics-list" ref={listRef}>
          <div className="stats-empty" data-testid="stats_empty_state">
            <span className="stats-empty-mascot" aria-hidden>
              😢
            </span>
            <p className="stats-empty-title">「暂无阅读统计记录」</p>
            <p className="stats-empty-desc">
              您最近还没有在本软件中阅读过小说哦。Roxy
              已经乖乖为您备好了专属书签，快去读一章，开启您的阅读旅程并点亮统计图表吧！
            </p>
            {/* actionLabel = "立即前往书架阅读" / onActionClick = onGoToShelf */}
            <div className="stats-empty-action">
              <AppButton
                size="sm"
                {...(props.onGoToShelf !== undefined
                  ? { onClick: props.onGoToShelf }
                  : {})}
              >
                立即前往书架阅读
              </AppButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="statistics-list" ref={listRef}>
          {/* 周期总览 */}
          <PeriodOverviewCard
            dailyTotals={dailyTotals}
            books={books}
            finishedCount={finishedCount}
            totalReadTimeSeconds={totalReadTimeSeconds}
            dailyGoalMinutes={dailyGoalMinutes}
            onGoalChange={handleGoalChange}
          />

          {/* 神回排行榜（核心数据卡片之后） */}
          <GodRankingCard
            moments={godMoments}
            style={godStyle}
            gyroEnabled={godGyroEnabled}
            reduceMotion={godReduceMotion}
            onOpenAll={() => setRoute('godRanking')}
            onItemClick={handleGodItemClick}
            onEdit={handleGodEdit}
            onDelete={handleGodDelete}
          />

          {/* 日历视图 */}
          <ReadingCalendarCard
            dailyTotals={dailyTotals}
            onDayClick={setSelectedDate}
          />

          {/* 趋势图表 */}
          <ReadingTrendCard
            dailyTotals={dailyTotals}
            sessions={readingSessions}
          />

          {/* 本周阅读明细 */}
          <h3 className="stats-weekly-header" style={{ color: titleColor }}>
            本周阅读明细
          </h3>

          {/* 本周明细（周视图 + 封面轮播/删除） */}
          <WeeklyReadingChart
            minutesPerDay={minutesList}
            bookTitlesPerDay={booksList}
            todayIndex={todayIdx}
            dayRecords={dayRecords}
            books={books}
            {...(props.recordCovers !== undefined
              ? { recordCovers: props.recordCovers }
              : {})}
            {...(props.recordBooks !== undefined ? { recordBooks: props.recordBooks } : {})}
            {...(props.recordCoverHeaders !== undefined
              ? { recordCoverHeaders: props.recordCoverHeaders }
              : {})}
            onDeleteRecord={(record) => {
              props.onDeleteRecord?.(record);
            }}
            onOpenRecordDetail={(record) => {
              props.onOpenRecordDetail?.(record);
            }}
            {...(props.onOpenBook !== undefined
              ? { onOpenBook: (bookId: number) => props.onOpenBook?.(bookId) }
              : {})}
          />
        </div>
      )}

      {/* Day detail acrylic sheet */}
      {selectedDate ? (
        <DayDetailSheet
          date={selectedDate}
          totalSeconds={dailyTotals.get(selectedDate) ?? 0}
          records={selectedDayRecords}
          sessions={selectedDaySessions}
          {...(props.recordCovers !== undefined
            ? { recordCovers: props.recordCovers }
            : {})}
          {...(props.recordBooks !== undefined
            ? { recordBooks: props.recordBooks }
            : {})}
          {...(props.recordCoverHeaders !== undefined
            ? { recordCoverHeaders: props.recordCoverHeaders }
            : {})}
          books={books}
          onOpenRecordDetail={(record) => {
            props.onOpenRecordDetail?.(record);
          }}
          onOpenBook={(bookId) => {
            props.onOpenBook?.(bookId);
          }}
          onDeleteRecord={(record) => {
            props.onDeleteRecord?.(record);
          }}
          onDismiss={() => setSelectedDate(null)}
        />
      ) : null}
    </div>
  );
}

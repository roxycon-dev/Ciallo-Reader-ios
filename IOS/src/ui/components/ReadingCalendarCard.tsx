import { useEffect, useMemo, useRef, useState } from 'react';
import { withAlpha } from '../../core/glass/color';
import { GlassCard } from './GlassCard';
import { SegmentedPillSelector } from './SegmentedPillSelector';
import { AppIconButton } from './CustomButtons';
import { dateStrOf, formatShortDuration, useTodayCalendar } from './ReadingStats';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ReadingCalendarCard.kt` (515 non-blank lines) — FULL PORT
 *   lines 47-160  `@Composable ReadingCalendarCard(dailyTotals, onDayClick, modifier)`
 *                 → ReadingCalendarCard
 *   lines 52-55  the four local states (viewYear / viewMonth / showYear / today)
 *   lines 57-90  the GlassCard(20.dp) header with 月/年 pill (width 120.dp)
 *   lines 94-126 the month/year stepper row + 「回到今天」
 *   lines 162-227 `private MonthGrid`      → MonthGrid
 *   lines 230-290 `private DayCell`        → DayCell
 *   lines 305-448 `private YearHeatmap`    → YearHeatmap (GitHub-contribution layout)
 *   lines 451-486 `private YearCell`       → YearCell
 *   lines 488     `WEEKDAY_LABELS`        → WEEKDAY_LABELS
 *   lines 491-553 `private class YearGrid` + `buildYearGrid` → core helpers below
 *   lines 563-569 `heatAlpha`             → heatAlpha
 *   lines 575     `HEAT_LEVELS`           → HEAT_LEVELS
 *
 * ADAPTATION
 * - `AnimatedContent(targetState = Triple(showYear, viewYear, viewMonth))` with
 *   `fadeIn(200) + scaleIn(0.97) togetherWith fadeOut(120)` → the target snapshot is
 *   held in a React key + a CSS enter animation, so the outgoing view keeps its
 *   own (frozen) values exactly as the Kotlin `targetShowYear/targetYear/targetMonth`
 *   destructuring did (the 2026-09-21 fix for "读外部变量导致退场中的旧内容跳变").
 * - `rememberScrollState()` + `animateScrollTo` → a scroll container whose
 *   `scrollLeft` is set once on mount/year change (≈ todayColumn − 3 weeks).
 * - `Calendar` → `Date`; `getActualMaximum(DAY_OF_MONTH)` → `daysInMonth()`.
 */
export interface ReadingCalendarCardProps {
  /**
   * `yyyy-MM-dd` → seconds.
   * Accepts a Map or a plain record so callers can pass the app store's snapshot
   * directly; the Kotlin signature was `Map<String, Long>`.
   */
  dailyTotals: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  onDayClick: (dateStr: string) => void;
  className?: string;
}

/** Uniform accessor for the two accepted shapes. */
function secondsOf(
  totals: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  key: string,
): number {
  if (totals instanceof Map) return totals.get(key) ?? 0;
  return (totals as Readonly<Record<string, number>>)[key] ?? 0;
}

const MINT_PRIMARY = '#059669';
const MINT_GOLD = '#E8C97A';

/** Kotlin line 488 — `listOf("一", "二", "三", "四", "五", "六", "日")` */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/**
 * Kotlin lines 573-575 — 四档热力 alpha（由浅到深）。
 * 格子配色与底部图例共用同一份数据。
 */
export const HEAT_LEVELS: readonly number[] = [0.32, 0.52, 0.72, 0.95];

/** Kotlin lines 555-569 — 分钟数 -> 颜色 alpha（0/1-9/10-29/30-59/60+）. */
export function heatAlpha(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 600) return HEAT_LEVELS[0] ?? 0;
  if (seconds < 1800) return HEAT_LEVELS[1] ?? 0;
  if (seconds < 3600) return HEAT_LEVELS[2] ?? 0;
  return HEAT_LEVELS[3] ?? 0;
}

function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}
function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Kotlin `"%04d-%02d-%02d".format(year, month + 1, day)` (month is 0-based). */
function dateKey(year: number, month0: number, day: number): string {
  return `${pad4(year)}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export function ReadingCalendarCard(props: ReadingCalendarCardProps) {
  const todayCal = useTodayCalendar();
  const today = useMemo(
    () => new Date(todayCal.getFullYear(), todayCal.getMonth(), todayCal.getDate()),
    [todayCal],
  );
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [showYear, setShowYear] = useState(false);
  // The AnimatedContent target snapshot.
  const target = { showYear, viewYear, viewMonth };

  return (
    <GlassCard
      radius={20}
      className={['cal-card', props.className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="cal-card__body">
        <div className="cal-card__head">
          <span className="stats-icon-circle" style={{ background: withAlpha(MINT_PRIMARY, 0.12) }}>
            <CalendarMonthIcon color={MINT_PRIMARY} />
          </span>
          <span style={{ width: 10 }} />
          <div className="cal-card__head-texts">
            <p className="cal-card__title">阅读日历</p>
            <p className="cal-card__subtitle">每日阅读热力</p>
          </div>
          <span className="cal-card__spacer" />
          <div className="cal-card__tabs" style={{ width: 120 }}>
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

        <div style={{ height: 8 }} />

        <div className="cal-card__stepper">
          <AppIconButton
            onClick={() => {
              if (showYear) setViewYear((y) => y - 1);
              else if (viewMonth === 0) {
                setViewMonth(11);
                setViewYear((y) => y - 1);
              } else setViewMonth((m) => m - 1);
            }}
          >
            <span aria-label="上个月/年">
              <ChevronLeftIcon />
            </span>
          </AppIconButton>
          <p className="cal-card__period">
            {showYear ? `${viewYear} 年` : `${viewYear}年${viewMonth + 1}月`}
          </p>
          <AppIconButton
            onClick={() => {
              if (showYear) setViewYear((y) => y + 1);
              else if (viewMonth === 11) {
                setViewMonth(0);
                setViewYear((y) => y + 1);
              } else setViewMonth((m) => m + 1);
            }}
          >
            <span aria-label="下个月/年">
              <ChevronRightIcon />
            </span>
          </AppIconButton>
          {viewYear !== today.getFullYear() ||
          (!showYear && viewMonth !== today.getMonth()) ? (
            <button
              type="button"
              className="cal-card__back-today"
              onClick={() => {
                setViewYear(today.getFullYear());
                setViewMonth(today.getMonth());
              }}
            >
              回到今天
            </button>
          ) : null}
        </div>

        <div style={{ height: 8 }} />

        <div
          className="cal-card__view"
          // The month/year switch key: a fresh key remounts, which replays the
          // fadeIn(200) + scaleIn(0.97) enter — the React form of AnimatedContent.
          key={`${target.showYear}-${target.viewYear}-${target.viewMonth}`}
        >
          {target.showYear ? (
            <YearHeatmap
              dailyTotals={props.dailyTotals}
              year={target.viewYear}
              onDayClick={props.onDayClick}
            />
          ) : (
            <MonthGrid
              dailyTotals={props.dailyTotals}
              year={target.viewYear}
              month={target.viewMonth}
              onDayClick={props.onDayClick}
            />
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/** Kotlin lines 162-227 — MonthGrid. */
function MonthGrid(props: {
  dailyTotals: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  year: number;
  /** 0-based month, matching `Calendar.MONTH`. */
  month: number;
  onDayClick: (dateStr: string) => void;
}) {
  const todayCal = useTodayCalendar();
  const todayStr = useMemo(() => dateStrOf(todayCal), [todayCal]);
  const total = daysInMonth(props.year, props.month);
  // Mon = 0
  const leading = (new Date(props.year, props.month, 1).getDay() + 6) % 7;

  // 当月峰值日：金色圆点标记
  let peakSeconds: number | null = null;
  for (let d = 1; d <= total; d++) {
    const v = secondsOf(props.dailyTotals, dateKey(props.year, props.month, d));
    if (v > 0 && (peakSeconds === null || v > peakSeconds)) peakSeconds = v;
  }

  const rows = Math.ceil((leading + total) / 7);

  return (
    <div className="cal-month">
      <div className="cal-month__weekdays">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="cal-month__weekday">
            {w}
          </span>
        ))}
      </div>
      <div style={{ height: 4 }} />
      {Array.from({ length: rows }, (_, r) => (
        <div className="cal-month__row" key={r}>
          {Array.from({ length: 7 }, (_, col) => {
            const day = r * 7 + col - leading + 1;
            if (day < 1 || day > total) {
              return <span key={col} className="cal-month__cell-spacer" />;
            }
            const dateStr = dateKey(props.year, props.month, day);
            const seconds = secondsOf(props.dailyTotals, dateStr);
            return (
              <DayCell
                key={col}
                day={day}
                seconds={seconds}
                isToday={dateStr === todayStr}
                isPeak={seconds > 0 && peakSeconds !== null && seconds === peakSeconds}
                onClick={() => props.onDayClick(dateStr)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Kotlin lines 230-290 — DayCell. */
function DayCell(props: {
  day: number;
  seconds: number;
  isToday: boolean;
  isPeak: boolean;
  onClick: () => void;
}) {
  const alpha = heatAlpha(props.seconds);
  return (
    <button
      type="button"
      className="cal-day"
      style={{
        background:
          props.seconds > 0
            ? withAlpha(MINT_PRIMARY, alpha)
            : 'rgba(241, 243, 244, 0.45)',
        ...(props.isToday ? { border: `1.5px solid ${MINT_PRIMARY}` } : {}),
      }}
      onClick={props.onClick}
    >
      {props.isPeak ? (
        <span
          className="cal-day__peak"
          style={{ background: MINT_GOLD }}
        />
      ) : null}
      <span className="cal-day__num">{props.day}</span>
      {props.seconds > 0 ? (
        <span className="cal-day__dur">{formatShortDuration(props.seconds)}</span>
      ) : null}
    </button>
  );
}

export interface YearGrid {
  columns: number;
  daysInYear: number;
  todayColumn: number;
  monthStartColumn: readonly number[];
  /** `(col, row)` → `yyyy-MM-dd` or null. */
  cells: readonly (string | null)[];
}

/** Kotlin lines 509-553 `buildYearGrid(year)` — 列 = 周，行 = 星期（周一起始）. */
export function buildYearGrid(year: number, today: Date): YearGrid {
  const first = new Date(year, 0, 1);
  // Mon=0
  const jan1Dow = (first.getDay() + 6) % 7;
  const daysInYear =
    (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) / 86_400_000;
  const columns = Math.floor((jan1Dow + daysInYear + 6) / 7);

  const monthStartColumn: number[] = [];
  for (let m = 0; m <= 11; m++) {
    const firstOfMonth = new Date(year, m, 1);
    monthStartColumn.push(
      Math.floor((jan1Dow + dayOfYear(firstOfMonth) - 1) / 7),
    );
  }

  const todayColumn =
    today.getFullYear() === year
      ? Math.floor((jan1Dow + dayOfYear(today) - 1) / 7)
      : -1;

  const cells: (string | null)[] = new Array<string | null>(columns * 7).fill(null);
  const cursor = new Date(year, 0, 1);
  for (let d = 1; d <= daysInYear; d++) {
    cells[jan1Dow + d - 1] = dateKey(year, cursor.getMonth(), cursor.getDate());
    cursor.setDate(cursor.getDate() + 1);
  }

  return { columns, daysInYear, todayColumn, monthStartColumn, cells };
}

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
}

/** Kotlin lines 305-448 — YearHeatmap (GitHub contribution layout). */
function YearHeatmap(props: {
  dailyTotals: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  year: number;
  onDayClick: (dateStr: string) => void;
}) {
  const todayCal = useTodayCalendar();
  const todayStr = useMemo(() => dateStrOf(todayCal), [todayCal]);
  const today = useMemo(
    () => new Date(todayCal.getFullYear(), todayCal.getMonth(), todayCal.getDate()),
    [todayCal],
  );
  const grid = useMemo(() => buildYearGrid(props.year, today), [props.year, today]);
  const cellGap = 3;
  const minCell = 16;
  const weekdayLabelWidth = 20;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(minCell + cellGap);

  // 宽屏（平板 / 横屏 / 折叠屏展开）：整年铺满，格子自动变大；
  // 窄屏：保持最小边长，横向滚动查看全年。
  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (el === null || el === undefined) return;
    const avail = el.clientWidth - weekdayLabelWidth;
    const minStep = minCell + cellGap;
    setStep(minStep * grid.columns <= avail ? avail / grid.columns : minStep);
  }, [grid.columns]);

  // 打开年视图先滚到「今天」附近，而不是停在 1 月
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const target =
      grid.todayColumn >= 0
        ? Math.max(0, (grid.todayColumn - 3) * step)
        : el.scrollWidth;
    el.scrollLeft = Math.min(target, el.scrollWidth);
  }, [grid.todayColumn, step, props.year]);

  // 入场：按星期行错峰淡入（tween 240ms, delay = r * 45ms）
  // Kotlin: `var started by remember(year) { mutableStateOf(false) }` +
  // `LaunchedEffect(year) { started = true }`. The web equivalent is a CSS
  // `@keyframes` animation: the parent already carries a `key` that changes with
  // the year, so the rows remount and the animation replays from 0% — identical
  // behaviour with no `setState` in an effect (React 19 `set-state-in-effect`).

  const cell = step - cellGap;

  return (
    <div className="cal-year">
      <div className="cal-year__scroll" ref={scrollRef}>
        <div className="cal-year__weekday-col">
          {/* 与顶部月份标签行对齐 */}
          <div style={{ height: 16 }} />
          {[0, 1, 2, 3, 4, 5, 6].map((r) => (
            <div
              key={r}
              className="cal-year__weekday-slot"
              style={{ height: cell, width: weekdayLabelWidth }}
            >
              {r === 0 || r === 2 || r === 4 || r === 6 ? (
                <span className="cal-year__weekday">{WEEKDAY_LABELS[r]}</span>
              ) : null}
            </div>
          ))}
        </div>

        <div>
          {/* 横轴：月份标签。每个横跨约 4 周，宽度足够，看得清 */}
          <div className="cal-year__months" style={{ height: 16 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => {
              const start = grid.monthStartColumn[m] ?? 0;
              const end = m === 11 ? grid.columns : (grid.monthStartColumn[m + 1] ?? grid.columns);
              const span = Math.max(1, end - start);
              const w = step * span;
              return (
                <div key={m} style={{ width: w }}>
                  {/* 放不下就不画，宁缺毋滥（避免又挤成一团模糊） */}
                  {w >= 26 ? <span className="cal-year__month">{`${m + 1}月`}</span> : null}
                </div>
              );
            })}
          </div>

          {/* 7 行 x columns 列 的正方形格子 */}
          {[0, 1, 2, 3, 4, 5, 6].map((r) => (
            <div
              className="cal-year__row"
              key={r}
              style={{
                gap: `${cellGap}px`,
                animation: `cal-year-row-in 240ms cubic-bezier(0.4, 0, 0.2, 1) ${r * 45}ms both`,
              }}
            >
              {Array.from({ length: grid.columns }, (_, col) => {
                const idx = col * 7 + r;
                const dateStr = grid.cells[idx] ?? null;
                return (
                  <YearCell
                    key={col}
                    dateStr={dateStr}
                    seconds={dateStr !== null ? secondsOf(props.dailyTotals, dateStr) : 0}
                    isToday={dateStr !== null && dateStr === todayStr}
                    cell={cell}
                    onDayClick={props.onDayClick}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 10 }} />

      {/* 图例 */}
      <div className="cal-year__legend">
        <span className="cal-year__legend-label">少</span>
        {HEAT_LEVELS.map((a, i) => (
          <span key={`${a}-${i}`} style={{ width: 4 }} />
        ))}
        {HEAT_LEVELS.map((a, i) => (
          <span
            key={`cell-${a}-${i}`}
            className="cal-year__legend-cell"
            style={{ background: withAlpha(MINT_PRIMARY, a) }}
          />
        ))}
        <span style={{ width: 4 }} />
        <span className="cal-year__legend-label">多</span>
        <span className="cal-year__spacer" />
        <span className="cal-year__legend-label">颜色越深 = 当天读得越久</span>
      </div>
    </div>
  );
}

/** Kotlin lines 451-486 — YearCell：正方形，可点击. */
function YearCell(props: {
  dateStr: string | null;
  seconds: number;
  isToday: boolean;
  cell: number;
  onDayClick: (dateStr: string) => void;
}) {
  if (props.dateStr === null) {
    return <span className="cal-year__cell-spacer" style={{ width: props.cell, height: props.cell }} />;
  }
  const filled = props.seconds > 0;
  const dateStr = props.dateStr;
  return (
    <button
      type="button"
      className="cal-year__cell"
      aria-label={dateStr}
      style={{
        width: props.cell,
        height: props.cell,
        background: filled
          ? withAlpha(MINT_PRIMARY, heatAlpha(props.seconds))
          : // 2026-09-21 修复：原来是 surfaceVariant.copy(alpha = 0.35f)，
            // 在浅色主题下淡到几乎与卡片同色，整片年视图看起来是"全空白"。
            'rgba(24, 25, 28, 0.10)',
        ...(props.isToday ? { border: `1.5px solid ${MINT_GOLD}` } : {}),
      }}
      onClick={() => props.onDayClick(dateStr)}
    />
  );
}

function CalendarMonthIcon(props: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={props.color} aria-hidden="true">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

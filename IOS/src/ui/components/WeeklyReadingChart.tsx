import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassCard } from './GlassCard';
import {
  formatShortDuration,
  type ReadingRecord,
} from '../lib/readingStats';
import { scrollElementTo } from '../lib/scroll';

/**
 * Port of Android WeeklyReadingChart.kt — bar chart + selected-day cover carousel.
 *
 * Kotlin → TS line map (WeeklyReadingChart.kt, 663 lines):
 *   54-71    signature                 → WeeklyReadingChartProps
 *   72       dayNames 周一…周日        → DAY_NAMES
 *   73       selectedDayIndex         → useState(todayIndex.coerceIn(0,6))
 *   75-88    totalMinutes / maxMinutes / peakDayIdx → the matching useMemo trio
 *   91-111   barAnimatables + LaunchedEffect 320 ms + index*40 ms → CSS animation-delay
 *   113-396  GlassCard tree           → the JSX below
 *   400-442  DayCoverCarousel         → `.stats-cover-row` + 5 s auto-scroll
 *   443-635  DayCoverCard             → DayCoverCard (cover + long-press menu + detail)
 *   637-663  MenuActionRow            → `.stats-dialog-action` buttons
 *
 * ── Fixes applied by the statistics review agent ───────────────────────────────────
 *  W1 The long-press menu and the 阅读详情 dialog were driven by `selRecords[0]`, i.e.
 *     always the FIRST card of the day. Kotlin scopes `showMenu`/`showDetail` to the
 *     `DayCoverCard` instance that was long-pressed (L457-458) and every title/action
 *     uses *that* record. Long-pressing card #3 opened card #1's menu.
 *  W2 Kotlin L564 `MenuActionRow("前往阅读", enabled = book != null || recordBook != null)`
 *     greys the row out when the book has been removed; the port always enabled it.
 *  W3 Kotlin L620-627 only renders 该书已不在书库中 when `book == null && recordBook == null`;
 *     the port showed it unconditionally.
 *  W4 Kotlin L464-470 onClick order is `book → onOpenBook`, `recordBook →
 *     onOpenRecordDetail`, `else → showDetail`; the port called `onOpenRecordDetail`
 *     whenever the prop existed and only fell back to the detail sheet otherwise.
 *  W5 Kotlin L455-459 / L485-500 resolve the cover from the local book's `coverUri`
 *     (content:// / file:// / isCoverValid) before falling back to the resolved
 *     `recordCovers[record.id]`; the port only read a `coverUrl` field that Kotlin's
 *     `ReadingRecord` does not have. The `books` / `recordCovers` / `recordBooks` /
 *     `recordCoverHeaders` props below carry that data.
 */

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** Android `com.example.data.Book` subset DayCoverCard reads (L455-496). */
export interface WeeklyChartBook {
  readonly id: number;
  readonly title: string;
  readonly coverUri?: string | null;
  readonly isCoverValid?: boolean;
}

/** Android `recordBooks: Map<Int, SearchBook>` — 需 sourceId 非空才算在线书（L456）。 */
export interface WeeklyChartRecordBook {
  readonly sourceId: string;
  readonly cover?: string | null;
}

export interface WeeklyReadingChartProps {
  /** Reading minutes for Monday to Sunday (7 integers). */
  minutesPerDay: number[];
  /** Titles of books read on corresponding days. */
  bookTitlesPerDay?: string[];
  /** Merged reading records per day (index-aligned with minutesPerDay). */
  dayRecords?: ReadingRecord[][];
  /** Index of current day of week (0 = Monday ... 6 = Sunday). */
  todayIndex: number;
  /** Kotlin L268 `books: List<Book>`. */
  books?: readonly WeeklyChartBook[];
  /** Kotlin L269 `recordCovers: Map<Int, String>`. */
  recordCovers?: ReadonlyMap<number, string>;
  /** Kotlin L270 `recordBooks: Map<Int, SearchBook>`. */
  recordBooks?: ReadonlyMap<number, WeeklyChartRecordBook>;
  /** Kotlin L271 `recordCoverHeaders: Map<Int, Map<String, String>>`. */
  recordCoverHeaders?: ReadonlyMap<number, Readonly<Record<string, string>>>;
  /** Kotlin L272 `onDeleteRecord: (ReadingRecord) -> Unit = {}`. */
  onDeleteRecord?: (record: ReadingRecord) => void;
  /** Kotlin L273 `onOpenRecordDetail: (SearchBook) -> Unit = {}`. */
  onOpenRecordDetail?: (record: ReadingRecord) => void;
  /** Kotlin L274 `onOpenBook: (Book) -> Unit`. */
  onOpenBook?: (bookId: number) => void;
}

function BookIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
    </svg>
  );
}

function MenuBookIcon(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />
    </svg>
  );
}

/**
 * Android L443-635 `DayCoverCard`. The two dialogs live **inside** the card (Kotlin
 * L457-458 `var showMenu` / `var showDetail`), so each card has its own menu state.
 */
function DayCoverCard(props: {
  record: ReadingRecord;
  books: readonly WeeklyChartBook[];
  recordCovers: ReadonlyMap<number, string>;
  recordBooks: ReadonlyMap<number, WeeklyChartRecordBook>;
  recordCoverHeaders: ReadonlyMap<number, Readonly<Record<string, string>>>;
  onDeleteRecord?: (record: ReadingRecord) => void;
  onOpenRecordDetail?: (record: ReadingRecord) => void;
  onOpenBook?: (bookId: number) => void;
}) {
  const { record, books, recordCovers, recordBooks, recordCoverHeaders } = props;
  const longPressTimer = useRef<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const clearTimer = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  // Kotlin L455 `books.firstOrNull { it.id == record.bookId }`
  const book =
    record.bookId != null ? (books.find((b) => b.id === record.bookId) ?? null) : null;
  // Kotlin L456 `recordBooks[record.id]?.takeIf { it.sourceId.isNotBlank() }`
  const recordBookSourceId = recordBooks.get(record.id)?.sourceId ?? '';
  const recordBook = recordBookSourceId !== '' ? recordBooks.get(record.id) : undefined;

  // Kotlin L459 `val remoteCover = recordBook?.cover ?: recordCovers[record.id]`
  const remoteCover = recordBook?.cover ?? recordCovers.get(record.id) ?? null;
  // Kotlin L485-500 the local book wins when it has a usable coverUri.
  const cover =
    book != null && book.coverUri != null && book.coverUri !== '' ? book.coverUri : remoteCover;

  const onCoverClick = (): void => {
    if (book != null) props.onOpenBook?.(book.id);
    else if (recordBook !== undefined) props.onOpenRecordDetail?.(record);
    else setShowDetail(true);
  };

  return (
    <>
      <button
        type="button"
        className="stats-cover-card"
        onClick={onCoverClick}
        onPointerDown={() => {
          clearTimer();
          longPressTimer.current = window.setTimeout(() => {
            longPressTimer.current = null;
            setShowMenu(true);
          }, 480);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        data-source-id={recordBookSourceId === '' ? '' : recordBookSourceId}
        data-headers={JSON.stringify(recordCoverHeaders.get(record.id) ?? {})}
      >
        <div className="stats-cover-thumb">
          {cover != null && cover !== '' ? (
            <img src={cover} alt={record.bookTitle} />
          ) : (
            <MenuBookIcon className="stats-cover-placeholder-icon" />
          )}
          {/* Kotlin L522-538 the duration chip uses the shared short formatter. */}
          <span className="stats-cover-dur">
            {formatShortDuration(record.durationSeconds)}
          </span>
        </div>
        <p className="stats-cover-title">{record.bookTitle}</p>
      </button>

      {/* Kotlin L550-602 AcrylicDialog — 前往阅读 / 阅读详情 / 删除阅读历史 */}
      {showMenu ? (
        <div
          className="stats-dialog-backdrop"
          role="presentation"
          onClick={() => {
            setShowMenu(false);
          }}
        >
          <div
            className="stats-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 className="stats-dialog-title">{record.bookTitle}</h3>
            <div className="stats-dialog-body">
              <button
                type="button"
                className="stats-dialog-action"
                disabled={book === null && recordBook === undefined}
                onClick={() => {
                  setShowMenu(false);
                  if (book !== null) props.onOpenBook?.(book.id);
                  else if (recordBook !== undefined) props.onOpenRecordDetail?.(record);
                }}
              >
                前往阅读
              </button>
              <hr className="stats-dialog-divider" />
              <button
                type="button"
                className="stats-dialog-action"
                onClick={() => {
                  setShowMenu(false);
                  setShowDetail(true);
                }}
              >
                阅读详情
              </button>
              <hr className="stats-dialog-divider" />
              <button
                type="button"
                className="stats-dialog-action stats-dialog-action--destructive"
                onClick={() => {
                  setShowMenu(false);
                  props.onDeleteRecord?.(record);
                }}
              >
                删除阅读历史
              </button>
            </div>
            <div className="stats-dialog-footer">
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Kotlin L604-634 AcrylicDialog — 阅读详情 */}
      {showDetail ? (
        <div
          className="stats-dialog-backdrop"
          role="presentation"
          onClick={() => {
            setShowDetail(false);
          }}
        >
          <div
            className="stats-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3 className="stats-dialog-title">{record.bookTitle}</h3>
            <div className="stats-dialog-body">
              <p>阅读日期：{record.dateStr}</p>
              <p style={{ marginTop: 4 }}>
                时长：{formatShortDuration(record.durationSeconds)}
              </p>
              {/* Kotlin L620 `if (book == null && recordBook == null)` */}
              {book === null && recordBook === undefined ? (
                <p
                  style={{ marginTop: 8, fontSize: 12, color: 'var(--color-medium-gray, #61666d)' }}
                >
                  该书已不在书库中
                </p>
              ) : null}
            </div>
            <div className="stats-dialog-footer">
              <button
                type="button"
                onClick={() => {
                  setShowDetail(false);
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function WeeklyReadingChart(props: WeeklyReadingChartProps) {
  const {
    minutesPerDay,
    dayRecords = [],
    todayIndex,
    books = [],
    recordCovers,
    recordBooks,
    recordCoverHeaders,
    onDeleteRecord,
    onOpenRecordDetail,
    onOpenBook,
  } = props;
  // bookTitlesPerDay is accepted for Android API parity (unused in chart body,
  // same as WeeklyReadingChart.kt — books shown via dayRecords cover carousel).

  const [selectedDayIndex, setSelectedDayIndex] = useState(() =>
    Math.max(0, Math.min(6, todayIndex)),
  );
  const coverRowRef = useRef<HTMLDivElement | null>(null);
  const emptyMaps = useMemo(
    () => new Map<number, string>(),
    [],
  );
  const emptyBookMaps = useMemo(
    () => new Map<number, WeeklyChartRecordBook>(),
    [],
  );
  const emptyHeaderMaps = useMemo(
    () => new Map<number, Readonly<Record<string, string>>>(),
    [],
  );

  const totalMinutes = useMemo(
    () => minutesPerDay.reduce((sum, m) => sum + m, 0),
    [minutesPerDay],
  );
  const maxMinutes = useMemo(
    () => Math.max(1, ...minutesPerDay.map((m) => Math.max(0, m))),
    [minutesPerDay],
  );
  const peakDayIdx = useMemo(() => {
    let best = -1;
    let bestVal = 0;
    minutesPerDay.forEach((m, i) => {
      if (m > bestVal) {
        bestVal = m;
        best = i;
      }
    });
    return bestVal > 0 ? best : -1;
  }, [minutesPerDay]);

  // Auto-scroll carousel every 5s (Android LaunchedEffect in DayCoverCarousel).
  const selRecords = dayRecords[selectedDayIndex] ?? [];
  useEffect(() => {
    if (selRecords.length <= 1) return;
    const id = window.setInterval(() => {
      const el = coverRowRef.current;
      if (!el) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 4) return;
      const next = el.scrollLeft >= maxScroll - 4 ? 0 : el.scrollLeft + 94;
      scrollElementTo(el, { left: next, behavior: 'smooth' });
    }, 5000);
    return () => window.clearInterval(id);
  }, [selRecords.length]);

  const selMins = minutesPerDay[selectedDayIndex] ?? 0;
  const selDayName = DAY_NAMES[selectedDayIndex] ?? '';

  const detailText = (() => {
    if (selMins > 0 && selRecords.length > 0) {
      return `共 ${selRecords.length} 本 · 详情见下方封面`;
    }
    if (selMins > 0) return '自选阅读';
    return '无阅读记录';
  })();

  return (
    <GlassCard radius={20} padding={20} className="stats-weekly-card">
      {/* Header Row: Title & Total Minutes */}
      <div className="stats-card-header">
        <div className="stats-icon-circle">
          <BarChartIcon />
        </div>
        <div className="stats-card-header-text">
          <p className="stats-card-title">本周阅读趋势</p>
          <p className="stats-card-subtitle">周一 至 周日</p>
        </div>
        <div className="stats-card-header-spacer" />
        <span className="stats-weekly-badge">本周共 {totalMinutes} 分钟</span>
      </div>

      {/* Chart Bars Row */}
      <div className="stats-weekly-bars">
        {DAY_NAMES.map((dayName, index) => {
          const mins = minutesPerDay[index] ?? 0;
          const isToday = index === todayIndex;
          const isSelected = index === selectedDayIndex;
          const rawFraction =
            maxMinutes <= 0 || mins <= 0
              ? 0
              : Math.min(1, Math.max(0.04, mins / maxMinutes));
          const barHeightPct = Math.round(rawFraction * 100);

          const minsClass = [
            'stats-weekly-mins',
            isToday ? 'stats-weekly-mins--today' : '',
            index === peakDayIdx && mins > 0 ? 'stats-weekly-mins--peak' : '',
            isSelected && !isToday ? 'stats-weekly-mins--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const barClass = [
            'stats-weekly-bar',
            isToday || isSelected ? 'stats-weekly-bar--today' : '',
            !isToday && !isSelected && index === peakDayIdx && mins > 0
              ? 'stats-weekly-bar--peak'
              : '',
            !isToday && !isSelected && !(index === peakDayIdx && mins > 0) && mins > 0
              ? 'stats-weekly-bar--normal'
              : '',
          ]
            .filter(Boolean)
            .join(' ');

          const dayClass = [
            'stats-weekly-day',
            isToday ? 'stats-weekly-day--today' : '',
            isSelected && !isToday ? 'stats-weekly-day--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const colClass = [
            'stats-weekly-col',
            isSelected ? 'stats-weekly-col--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');

          // Stagger entrance: delay(index * 40ms) after 320ms page-switch delay
          const growDelay = `${320 + index * 40}ms`;

          return (
            <button
              key={dayName}
              type="button"
              className={colClass}
              onClick={() => setSelectedDayIndex(index)}
            >
              {/* 1. Top duration label box aligned at 20.dp height */}
              <div className="stats-weekly-mins-box">
                <p className={minsClass}>{mins > 0 ? `${mins}分` : '-'}</p>
              </div>

              {/* 2. Bar Container strictly 100.dp height */}
              <div className="stats-weekly-bar-track">
                <div className="stats-weekly-baseline" />
                {mins > 0 && rawFraction > 0.01 ? (
                  <div
                    className={barClass}
                    style={{
                      height: `${Math.max(4, barHeightPct)}%`,
                      animationDelay: growDelay,
                    }}
                  />
                ) : null}
              </div>

              {/* 3. Day label tag at bottom */}
              <p className={dayClass}>{dayName}</p>
            </button>
          );
        })}
      </div>

      {/* Detail Popover Card for Selected Day */}
      <div className="stats-weekly-detail">
        <div className="stats-weekly-detail-left">
          <MenuBookIcon className="stats-weekly-detail-icon" />
          <p className="stats-weekly-detail-label">{selDayName}阅读记录：</p>
          <p
            className={
              selMins > 0
                ? 'stats-weekly-detail-value'
                : 'stats-weekly-detail-value stats-weekly-detail-value--empty'
            }
          >
            {detailText}
          </p>
        </div>
        <p className="stats-weekly-detail-total">
          {selMins > 0 ? `共 ${selMins} 分钟` : '0 分钟'}
        </p>
      </div>

      {/* 选中日封面轮播：周几阅读记录直接接入漫画封面 */}
      {selRecords.length > 0 ? (
        <div className="stats-cover-row" ref={coverRowRef}>
          {selRecords.map((record) => (
            <DayCoverCard
              key={record.id}
              record={record}
              books={books}
              recordCovers={recordCovers ?? emptyMaps}
              recordBooks={recordBooks ?? emptyBookMaps}
              recordCoverHeaders={recordCoverHeaders ?? emptyHeaderMaps}
              {...(onDeleteRecord !== undefined ? { onDeleteRecord } : {})}
              {...(onOpenRecordDetail !== undefined ? { onOpenRecordDetail } : {})}
              {...(onOpenBook !== undefined ? { onOpenBook } : {})}
            />
          ))}
        </div>
      ) : null}

      {/* Suppress unused import lint for BookIcon when tree-shaken — kept for parity */}
      <span style={{ display: 'none' }} aria-hidden>
        <BookIcon />
      </span>
    </GlassCard>
  );
}

export type { WeeklyReadingChartProps as WeeklyReadingChartOptions };

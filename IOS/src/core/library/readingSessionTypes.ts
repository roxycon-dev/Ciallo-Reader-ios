/**
 * Reading session types — port of Android `ReadingSession.kt`.
 *
 * Single reading session (new stats channel). One row per continuous
 * "reader visible + app foreground" span.
 */

export interface ReadingSessionRow {
  id?: number
  bookId: number | null
  bookTitle: string
  /** Session start local date yyyy-MM-dd (cross-midnight sessions split). */
  dateStr: string
  startTimeMs: number
  endTimeMs: number
  durationSeconds: number
  /** 0-23 session start hour. */
  startHour: number
}

/** Daily total reading seconds (calendar heatmap / trends). */
export interface DailyReadingTotalRow {
  dateStr: string
  totalSeconds: number
}

/** Monthly total reading seconds. */
export interface MonthlyReadingTotalRow {
  month: string
  totalSeconds: number
}

/** Yearly total reading seconds. */
export interface YearlyReadingTotalRow {
  year: string
  totalSeconds: number
}

/** Book.kt — reading_records table row. */
export interface ReadingRecordRow {
  id?: number
  bookId: number | null
  bookTitle: string
  dateStr: string
  durationSeconds: number
}

/** Book.kt — highlights table row. */
export interface HighlightRow {
  id?: number
  bookId: number
  chapterIndex: number
  selectedText: string
  note: string
  colorHex: string
  createdTime: number
}

/** Book.kt — SearchResultItem. */
export interface SearchResultItem {
  chapterIndex: number
  chapterTitle: string
  snippet: string
  /** Keyword occurrence index in merged logical chapter text (0-based). */
  occurrence?: number
}

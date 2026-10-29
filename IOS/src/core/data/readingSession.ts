/**
 * Reading session entities — port of Android `ReadingSession.kt`.
 *
 * Room annotations (@Entity/@PrimaryKey) are omitted; shapes match the
 * `reading_sessions` table (see db/schemaV12.ts when wired).
 */

/**
 * 单次阅读会话（新统计口径）。
 * 每次“阅读器可见且 App 在前台”的连续时段记一行，用于：
 *  - 日历视图的时段明细
 *  - 趋势图的高峰时段分布（startHour）
 * 注意：阅读总时长仍以 reading_records（天 x 书）为聚合基准，
 * 会话表只补充明细/时段信息，避免两条链路重复累加。
 */
export interface ReadingSession {
  id: number;
  bookId: number | null;
  bookTitle: string;
  /** 会话开始时间的本地日期 yyyy-MM-dd（跨天会话按本地午夜拆分）。 */
  dateStr: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  /** 0-23，会话开始小时，用于高峰时段分布。 */
  startHour: number;
}

/** 某天阅读总时长（日历热力图 / 趋势用）。 */
export interface DailyReadingTotal {
  dateStr: string;
  totalSeconds: number;
}

/** 某月阅读总时长。 */
export interface MonthlyReadingTotal {
  month: string;
  totalSeconds: number;
}

/** 某年阅读总时长。 */
export interface YearlyReadingTotal {
  year: string;
  totalSeconds: number;
}

/** Room autoGenerate primary key default (id=0 before insert). */
export function createReadingSession(
  fields: Omit<ReadingSession, 'id'> & { id?: number },
): ReadingSession {
  return { id: fields.id ?? 0, ...fields };
}

import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/ReadingSession.kt（44 行）

/**
 * 单次阅读会话（新统计口径）。
 * 每次“阅读器可见且 App 在前台”的连续时段记一行，用于：
 *  - 日历视图的时段明细
 *  - 趋势图的高峰时段分布（startHour）
 * 注意：阅读总时长仍以 reading_records（天 x 书）为聚合基准，
 * 会话表只补充明细/时段信息，避免两条链路重复累加。
 */
struct ReadingSession: Identifiable, Hashable {
    var id: Int64 = 0
    var bookId: Int?
    var bookTitle: String
    /// 会话开始时间的本地日期 yyyy-MM-dd（跨天会话按本地午夜拆分）。
    var dateStr: String
    var startTimeMs: Int64
    var endTimeMs: Int64
    var durationSeconds: Int64
    /// 0-23，会话开始小时，用于高峰时段分布。
    var startHour: Int
}

/// 某天阅读总时长（日历热力图 / 趋势用）。
struct DailyReadingTotal: Hashable {
    let dateStr: String
    let totalSeconds: Int64
}

/// 某月阅读总时长。
struct MonthlyReadingTotal: Hashable {
    let month: String
    let totalSeconds: Int64
}

/// 某年阅读总时长。
struct YearlyReadingTotal: Hashable {
    let year: String
    let totalSeconds: Int64
}

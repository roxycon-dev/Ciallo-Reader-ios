import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/ReadingTimeSlices.kt（30 行）

struct ReadingTimeSlice: Equatable {
    let date: String
    let start: Int64
    let end: Int64
    let seconds: Int64
    let hour: Int
}

enum ReadingTimeSlices {
    static func split(_ start: Int64, _ end: Int64, _ seconds: Int64) -> [ReadingTimeSlice] {
        if end <= start || seconds <= 0 { return [] }
        precondition(end - start <= 7 * 24 * 60 * 60 * 1000, "阅读会话时间范围异常")
        let format = DateFormatter.isoDate // SimpleDateFormat("yyyy-MM-dd", Locale.US)
        let calendar = Calendar.current
        var result: [ReadingTimeSlice] = []
        var cursor = start
        var allocated: Int64 = 0
        while cursor < end {
            var cal = calendar
            let cursorDate = Date(timeIntervalSince1970: Double(cursor) / 1000.0)
            let date = format.string(from: cursorDate)
            let hour = calendar.component(.hour, from: cursorDate)
            // calendar.add(DAY_OF_YEAR, 1) + 清零时分秒毫秒 → 次日本地午夜
            let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: cursorDate))!
            let stopMs = min(end, Int64(nextDay.timeIntervalSince1970 * 1000))
            let through: Int64 = stopMs == end ? seconds
                : Int64(Double(seconds) * Double(stopMs - start) / Double(end - start))
            result.append(ReadingTimeSlice(date: date, start: cursor, end: stopMs, seconds: through - allocated, hour: hour))
            allocated = through
            cursor = stopMs
        }
        return result
    }
}

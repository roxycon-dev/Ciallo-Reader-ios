import Foundation

// MARK: - 偏好封装（data/PreferencesManager.kt 对应物，UserDefaults 同键语义）

final class Preferences {
    static let shared = Preferences()
    private let d = UserDefaults.standard

    // MARK: 基础读写

    func bool(for key: String, default def: Bool = false) -> Bool { d.object(forKey: key) as? Bool ?? def }
    func setBool(_ v: Bool, for key: String) { d.set(v, forKey: key) }

    func int(for key: String) -> Int? { d.object(forKey: key) as? Int }
    func setInt(_ v: Int, for key: String) { d.set(v, forKey: key) }

    func double(for key: String, default def: Double = 0) -> Double { d.object(forKey: key) as? Double ?? def }
    func setDouble(_ v: Double, for key: String) { d.set(v, forKey: key) }

    func string(for key: String) -> String? { d.string(forKey: key) }
    func setString(_ v: String, for key: String) { d.set(v, forKey: key) }

    func optionalString(for key: String) -> String? { d.string(forKey: key) }
    func setOptionalString(_ v: String?, for key: String) {
        if let v { d.set(v, forKey: key) } else { d.removeObject(forKey: key) }
    }

    func optionalBool(for key: String) -> Bool? { d.object(forKey: key) as? Bool }
    func setOptionalBool(_ v: Bool?, for key: String) {
        if let v { d.set(v, forKey: key) } else { d.removeObject(forKey: key) }
    }

    func stringArray(for key: String) -> [String] { d.stringArray(forKey: key) ?? [] }
    func setStringArray(_ v: [String], for key: String) { d.set(v, forKey: key) }

    func remove(_ key: String) { d.removeObject(forKey: key) }

    // MARK: 阅读目标与连续打卡（calculateStreak 同款逻辑）

    /// 连续打卡：lastReadingDay 今天 or 昨天 → 顺延，否则重置为 1。
    func calculateStreak(now: Date = Date()) -> Int {
        let cal = Calendar.current
        let today = cal.startOfDay(for: now)
        let lastDayString = string(for: "last_reading_day")
        let currentStreak = int(for: "reading_streak") ?? 0
        guard let lastDayString,
              let lastDay = DateFormatter.yyyyMMdd.date(from: lastDayString) else { return currentStreak }
        let diff = cal.dateComponents([.day], from: cal.startOfDay(for: lastDay), to: today).day ?? 0
        if diff == 0 { return currentStreak }
        if diff == 1 { return currentStreak + 1 }
        return 1
    }

    @MainActor
    func recordReadingDayIfNeeded(seconds: Int64) {
        let cal = Calendar.current
        let today = DateFormatter.yyyyMMdd.string(from: cal.startOfDay(for: Date()))
        let todayKey = "daily_reading_\(today)"
        let todaySeconds = int(for: todayKey) ?? 0 + Int(seconds)
        setInt(todaySeconds, for: todayKey)
        guard todaySeconds >= int(for: "daily_goal_minutes").map({ $0 * 60 }) ?? 1800 else { return }
        let lastDay = string(for: "last_reading_day")
        if lastDay != today {
            let streak = calculateStreak()
            setInt(streak, for: "reading_streak")
            setString(today, for: "last_reading_day")
        }
    }
}

extension DateFormatter {
    static let yyyyMMdd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.calendar = Calendar(identifier: .iso8601)
        f.timeZone = .current
        return f
    }()
    static let isoDate: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.calendar = Calendar(identifier: .iso8601)
        f.timeZone = .current
        return f
    }()
}

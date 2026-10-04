import Foundation

// MARK: - 偏好底层封装（iOS 侧辅助：UserDefaults 读写门面，Kotlin 无对应——对应 SharedPreferences 本体）

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

extension Preferences {
    /// Kotlin `edit().commit()` 语义（同步落盘并返回成败）；UserDefaults 用 synchronize 近似。
    @discardableResult
    func setBoolCommit(_ v: Bool, for key: String) -> Bool {
        UserDefaults.standard.set(v, forKey: key)
        return UserDefaults.standard.synchronize()
    }
}

// MARK: - 偏好管理（对齐 novel-reader/app/src/main/java/com/example/data/PreferencesManager.kt，324 行）
// SharedPreferences("novel_reader_prefs") → Preferences.shared（UserDefaults，同键语义）。
// Kotlin Float → Swift Double（存储与取值等价）。

final class PreferencesManager {
    /// Kotlin 构造参数 context → iOS 侧统一走 Preferences.shared。
    static let shared = PreferencesManager()
    private let prefs = Preferences.shared

    private init() {}

    private func int(_ key: String, _ def: Int) -> Int { prefs.int(for: key) ?? def }
    private func int64(_ key: String, _ def: Int64) -> Int64 { prefs.int(for: key).map(Int64.init) ?? def }
    private func double(_ key: String, _ def: Double) -> Double { prefs.double(for: key, default: def) }
    private func bool(_ key: String, _ def: Bool) -> Bool { prefs.bool(for: key, default: def) }
    private func string(_ key: String, _ def: String? = nil) -> String? { prefs.string(for: key) ?? def }

    private func writeLongCommit(_ key: String, _ value: Int64) -> Bool {
        UserDefaults.standard.set(Int(value), forKey: key)
        return UserDefaults.standard.synchronize()
    }

    var fontSize: Double {
        get { double("font_size", 18) }
        set { prefs.setDouble(newValue, for: "font_size") }
    }

    var lineHeight: Double {
        get { double("line_height", 28) }
        set { prefs.setDouble(newValue, for: "line_height") }
    }

    var marginHorizontal: Int {
        get { int("margin_horizontal", 16) }
        set { prefs.setInt(newValue, for: "margin_horizontal") }
    }

    var firstLineIndent: Bool {
        get { bool("first_line_indent", true) }
        set { prefs.setBool(newValue, for: "first_line_indent") }
    }

    var readerTheme: Int {
        get { int("reader_theme", 1) } // 0: 毛玻璃, 1: 默认白, 2: 护眼黄, 3: 夜间, 4: 护眼绿, 5: 纯黑
        set { prefs.setInt(newValue, for: "reader_theme") }
    }

    var customBgColor: Int {
        get { int("custom_bg_color", 0xFFFBF0D9) }
        set { prefs.setInt(newValue, for: "custom_bg_color") }
    }

    var customTextColor: Int {
        get { int("custom_text_color", 0xFF5F4B32) }
        set { prefs.setInt(newValue, for: "custom_text_color") }
    }

    var fontFamilyIndex: Int {
        get { int("font_family_index", 0) }
        set { prefs.setInt(newValue, for: "font_family_index") }
    }

    var pageTurnMode: Int {
        get { int("page_turn_mode", 0) } // 0: 3D仿真, 1: 覆盖, 2: 平移, 3: 渐变, 4: 滚动
        set { prefs.setInt(newValue, for: "page_turn_mode") }
    }

    var customSplashPosterUri: String? {
        get { string("custom_splash_poster_uri") }
        set { prefs.setOptionalString(newValue, for: "custom_splash_poster_uri") }
    }

    var splashPureMode: Bool {
        get { bool("splash_pure_mode", false) }
        set { prefs.setBool(newValue, for: "splash_pure_mode") }
    }

    /// 软件背景：0=默认（主题色），1=自定义图片。
    var appBackgroundMode: Int {
        get { int("app_background_mode", 0) }
        set { prefs.setInt(newValue, for: "app_background_mode") }
    }

    /// 自定义背景图片本地路径（file://...），横竖屏统一按 Crop 填充。
    var customAppBackgroundUri: String? {
        get { string("custom_app_background_uri") }
        set { prefs.setOptionalString(newValue, for: "custom_app_background_uri") }
    }

    /// 自定义背景上的深色遮罩强度（0-50，%），保证上层文字/卡片可读。
    var appBackgroundDim: Int {
        get { int("app_background_dim", 20) }
        set { prefs.setInt(min(max(newValue, 0), 50), for: "app_background_dim") }
    }

    var screenOrientationLock: Int {
        get { int("screen_orientation_lock", 0) } // 0: 跟随系统, 1: 锁定竖屏, 2: 锁定横屏
        set { prefs.setInt(newValue, for: "screen_orientation_lock") }
    }

    var restReminderMinutes: Int {
        get { int("rest_reminder_minutes", 30) }
        set { prefs.setInt(newValue, for: "rest_reminder_minutes") }
    }

    var autoNightMode: Bool {
        get { bool("auto_night_mode", false) }
        set { prefs.setBool(newValue, for: "auto_night_mode") }
    }

    var blueLightFilter: Bool {
        get { bool("blue_light_filter", false) }
        set { prefs.setBool(newValue, for: "blue_light_filter") }
    }

    var blueLightAlpha: Double {
        get { double("blue_light_alpha", 0.15) }
        set { prefs.setDouble(newValue, for: "blue_light_alpha") }
    }

    /**
     * 在线漫画：仅在 Wi-Fi（或不限量网络）下预加载后续页。
     * 默认 false = 移动网络也预加载；开启后省流量，但弱网首次翻页会等一下。
     * 只影响"提前下载还没看到的页"，当前页始终会加载。
     */
    var preloadWifiOnly: Bool {
        get { bool("preload_wifi_only", false) }
        set { prefs.setBool(newValue, for: "preload_wifi_only") }
    }

    /// 书架多选/拖拽的「再次长按可拖动」提示已展示次数（最多 3 次，之后不再打扰）。
    var shelfDragHintShown: Int {
        get { int("shelf_drag_hint_shown", 0) }
        set { prefs.setInt(min(max(newValue, 0), 3), for: "shelf_drag_hint_shown") }
    }

    var keepScreenOn: Bool {
        get { bool("keep_screen_on", true) }
        set { prefs.setBool(newValue, for: "keep_screen_on") }
    }

    /**
     * 触控反馈（触觉）总开关。此前 LocalHapticsEnabled 在 MainActivity 里被硬编码为 true，
     * 设置项不存在 → 用户想关马达没有任何入口。开启后同时约束两条通路：
     * Compose 的 LocalHapticFeedback（波纹/滑块/底栏等）与 AppHaptics 的语义化震动。
     */
    var hapticsEnabled: Bool {
        get { bool("haptics_enabled", true) }
        set { prefs.setBool(newValue, for: "haptics_enabled") }
    }

    var ttsSpeed: Double {
        get { double("tts_speed", 1.0) }
        set { prefs.setDouble(newValue, for: "tts_speed") }
    }

    var ttsPitch: Double {
        get { double("tts_pitch", 1.0) }
        set { prefs.setDouble(newValue, for: "tts_pitch") }
    }

    var totalReadTimeSeconds: Int64 {
        get { int64("total_read_time_seconds", 0) }
        set { writeLongCommit("total_read_time_seconds", newValue) }
    }

    /// Kotlin：check(edit().putBoolean(...).commit()) —— commit 失败即崩溃语义，此处以 assert 近似。
    var readingTotalsReconciled: Bool {
        get { bool("reading_totals_reconciled_v1", false) }
        set { assert(writeBoolCommit("reading_totals_reconciled_v1", newValue)) }
    }
    /// Kotlin：coerceAtLeast(0) + commit。
    var legacyUnattributedSeconds: Int64 {
        get { max(int64("legacy_unattributed_read_seconds", 0), 0) }
        set { assert(writeLongCommit("legacy_unattributed_read_seconds", max(newValue, 0))) }
    }
    private func writeBoolCommit(_ key: String, _ value: Bool) -> Bool {
        UserDefaults.standard.set(value, forKey: key)
        return UserDefaults.standard.synchronize()
    }
    func legacyDailyTotals() -> [String: Int64] {
        let regex = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)
        var out: [String: Int64] = [:]
        for (key, value) in UserDefaults.standard.dictionaryRepresentation() {
            guard key.hasPrefix("daily_read_time_") else { continue }
            let date = String(key.dropFirst("daily_read_time_".count))
            guard let seconds = value as? Int, seconds > 0 else { continue }
            let ns = date as NSString
            guard regex.firstMatch(in: date, options: [], range: NSRange(location: 0, length: ns.length)) != nil else { continue }
            out[date] = Int64(seconds)
        }
        return out
    }

    func getDailyReadTime(_ dateStr: String) -> Int64 {
        int64("daily_read_time_\(dateStr)", 0)
    }

    func setDailyReadTime(_ dateStr: String, _ seconds: Int64) {
        UserDefaults.standard.set(Int(max(seconds, 0)), forKey: "daily_read_time_\(dateStr)")
    }

    /// 第九轮：全局无痕浏览开关（开启后阅读不计入统计；持久化）
    var incognitoBrowsingEnabled: Bool {
        get { bool("incognito_browsing_enabled", false) }
        set { prefs.setBool(newValue, for: "incognito_browsing_enabled") }
    }

    /// 「我喜欢的」密码保护开关：开启后进入该板块需先验证隐私 PIN（持久化）
    var favoritesProtected: Bool {
        get { bool("favorites_protected", false) }
        set { prefs.setBool(newValue, for: "favorites_protected") }
    }

    /// 第十一轮第 6 条：多语言搜索开关（开启后搜索词自动扩展各语言标题变体；默认开启，持久化）
    var multiLanguageSearch: Bool {
        get { bool("multi_language_search", true) }
        set { prefs.setBool(newValue, for: "multi_language_search") }
    }

    func calculateStreak() -> Int {
        let sdf = DateFormatter.isoDate // SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        let calendar = Calendar.current
        var cursor = calendar.startOfDay(for: Date())
        var count = 0
        while true {
            let dateStr = sdf.string(from: cursor)
            let duration = getDailyReadTime(dateStr)
            if duration > 0 {
                count += 1
                guard let prev = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
                cursor = calendar.startOfDay(for: prev)
            } else {
                break
            }
        }
        return count
    }

    var showOverlayHeaderFooter: Bool {
        get { bool("show_overlay_header_footer", true) }
        set { prefs.setBool(newValue, for: "show_overlay_header_footer") }
    }

    var clickZoneLeftAction: Int {
        get { int("click_zone_left_action", 0) } // 0: prev, 1: toggle bars, 2: next
        set { prefs.setInt(newValue, for: "click_zone_left_action") }
    }

    var clickZoneCenterAction: Int {
        get { int("click_zone_center_action", 1) }
        set { prefs.setInt(newValue, for: "click_zone_center_action") }
    }

    var clickZoneRightAction: Int {
        get { int("click_zone_right_action", 2) }
        set { prefs.setInt(newValue, for: "click_zone_right_action") }
    }

    var colorPrimaryIndex: Int {
        get { int("color_primary_index", 2) }
        set { prefs.setInt(newValue, for: "color_primary_index") }
    }

    var colorSecondaryIndex: Int {
        get { int("color_secondary_index", 2) }
        set { prefs.setInt(newValue, for: "color_secondary_index") }
    }

    /// 界面渲染画质：0=流畅 1=均衡 2=高(默认) 3=极致。
    var renderQuality: Int {
        get { int("render_quality", 2) }
        set { prefs.setInt(min(max(newValue, 0), 3), for: "render_quality") }
    }

    /// 每日阅读目标（分钟）。默认 60 分钟。
    var dailyGoalMinutes: Int {
        get { int("daily_goal_minutes", 60) }
        set { prefs.setInt(min(max(newValue, 5), 480), for: "daily_goal_minutes") }
    }

    /// 阅读器屏幕亮度遮罩（0.2~1.0，1=不遮暗）。夜间阅读降低亮度刺眼感。
    var readerBrightness: Double {
        get { double("reader_brightness", 1.0) }
        set { prefs.setDouble(min(max(newValue, 0.2), 1.0), for: "reader_brightness") }
    }

    /// 自定义字体文件路径（内部存储）。空字符串表示未导入。
    var customFontPath: String {
        get { string("custom_font_path", "") ?? "" }
        set { prefs.setString(newValue, for: "custom_font_path") }
    }

    /* ── 卡片参数自定义（MAX 毛玻璃卡，设置页折叠栏可调）── */
    var cardBlurRadiusDp: Double {
        get { double("card_blur_dp", 22) }
        set { prefs.setDouble(min(max(newValue, 8), 40), for: "card_blur_dp") }
    }

    var cardCornerRadiusDp: Double {
        get { double("card_corner_dp", 16) }
        set { prefs.setDouble(min(max(newValue, 2), 48), for: "card_corner_dp") }
    }

    var cardTiltMaxDeg: Double {
        get { double("card_tilt_deg", 6) }
        set { prefs.setDouble(min(max(newValue, 0), 15), for: "card_tilt_deg") }
    }

    var cardCameraDistMult: Double {
        get { double("card_cam_mult", 5) }
        set { prefs.setDouble(min(max(newValue, 3), 12), for: "card_cam_mult") }
    }

    var cardRippleAlpha: Double {
        get { double("card_ripple_a", 0.42) }
        set { prefs.setDouble(min(max(newValue, 0.1), 0.8), for: "card_ripple_a") }
    }

    var cardTintMix: Double {
        get { double("card_tint_mix", 0.08) }
        set { prefs.setDouble(min(max(newValue, 0), 0.3), for: "card_tint_mix") }
    }

    var cardPressStrength: Double {
        get { double("card_press_s", 1.25) }
        set { prefs.setDouble(min(max(newValue, 0), 2), for: "card_press_s") }
    }

    var cardPressRadius: Double {
        get { double("card_press_r", 1.1) }
        set { prefs.setDouble(min(max(newValue, 0.5), 2.5), for: "card_press_r") }
    }

    var cardAlpha: Double {
        get { double("card_alpha", 1) }
        set { prefs.setDouble(min(max(newValue, 0.4), 1), for: "card_alpha") }
    }

    /**
     * 一次性迁移：把旧安装里沉淀的 v1 出厂参数升到 v2 更醒目的默认档。
     * 已执行过则幂等跳过；用户手动调过的自定义值会被本次覆盖一次（升级代价，仅此一回）。
     */
    func migrateCardTweaksDefaultsV2() {
        if bool("card_tweaks_migrated_v2", false) { return }
        prefs.setDouble(6, for: "card_tilt_deg")
        prefs.setDouble(5, for: "card_cam_mult")
        prefs.setDouble(0.42, for: "card_ripple_a")
        prefs.setDouble(1.25, for: "card_press_s")
        prefs.setDouble(1.1, for: "card_press_r")
        prefs.setBool(true, for: "card_tweaks_migrated_v2")
    }

    var hasSeenOnboarding: Bool {
        get { bool("has_seen_onboarding", false) }
        set { prefs.setBool(newValue, for: "has_seen_onboarding") }
    }

    var hasSeenWelcome: Bool {
        get { bool("has_seen_welcome", false) }
        set { prefs.setBool(newValue, for: "has_seen_welcome") }
    }

    var hasConfiguredSource: Bool {
        get { bool("has_configured_source", false) }
        set { prefs.setBool(newValue, for: "has_configured_source") }
    }

    var hasImportedLocalBook: Bool {
        get { bool("has_imported_local_book", false) }
        set { prefs.setBool(newValue, for: "has_imported_local_book") }
    }

    var hasImportedCommunityComics: Bool {
        get { bool("has_imported_community_comics_v1", false) }
        set { prefs.setBool(newValue, for: "has_imported_community_comics_v1") }
    }

    var showAdultSources: Bool {
        get { bool("show_adult_sources", false) }
        set { prefs.setBool(newValue, for: "show_adult_sources") }
    }

    var jsSourceRepoUrl: String {
        get {
            string("js_source_repo_url",
                   "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/index.json")
                ?? "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/index.json"
        }
        set { prefs.setString(newValue, for: "js_source_repo_url") }
    }

    var searchHistory: [String] {
        get {
            let raw = string("search_history_v1", "[]") ?? "[]"
            guard let arr = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [Any] else { return [] }
            return arr.compactMap { $0 as? String }
        }
        set {
            let arr = NSArray(array: Array(newValue.prefix(20)))
            if let data = try? JSONSerialization.data(withJSONObject: arr),
               let text = String(data: data, encoding: .utf8) {
                prefs.setString(text, for: "search_history_v1")
            }
        }
    }

    var jsSourceHealthChecked: Bool {
        get { bool("js_source_health_checked_v3", false) }
        set { prefs.setBool(newValue, for: "js_source_health_checked_v3") }
    }
}

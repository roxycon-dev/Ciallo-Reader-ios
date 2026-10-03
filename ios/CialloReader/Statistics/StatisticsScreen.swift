import SwiftUI

// MARK: - 阅读统计（ui/StatisticsScreen.kt 对应物）
// 周/月/年总览 + 连续打卡 + 时段分布 + GitHub 贡献图布局年热力图 + 神回排行榜入口。
// 已修口径：本周无记录时不把历史总时长塞进"今天"。

@MainActor
final class StatisticsModel: ObservableObject {
    @Published var sessions: [ReadingSession] = []
    @Published var period: Period = .week

    enum Period: String, CaseIterable, Identifiable {
        case week = "周"
        case month = "月"
        case year = "年"
        var id: String { rawValue }
    }

    init() {
        reload()
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    func reload() {
        sessions = (try? AppDatabase.shared.readingSessions()) ?? []
    }

    func totalSeconds(in period: Period) -> Int64 {
        let cal = Calendar.current
        let now = Date()
        let start: Date? = {
            switch period {
            case .week: return cal.dateInterval(of: .weekOfYear, for: now)?.start
            case .month: return cal.dateInterval(of: .month, for: now)?.start
            case .year: return cal.dateInterval(of: .year, for: now)?.start
            }
        }()
        guard let start else { return 0 }
        return sessions.filter { Date(timeIntervalSince1970: TimeInterval($0.startTimeMs) / 1000) >= start }
            .reduce(0) { $0 + $1.durationSeconds }
    }

    func dailyTotals(days: Int) -> [(date: Date, seconds: Int64)] {
        let cal = Calendar.current
        var out: [(Date, Int64)] = []
        for offset in (0..<days).reversed() {
            let day = cal.date(byAdding: .day, value: -offset, to: cal.startOfDay(for: Date()))!
            let key = DateFormatter.isoDate.string(from: day)
            let total = sessions.filter { $0.dateStr == key }.reduce(0) { $0 + $1.durationSeconds }
            out.append((day, total))
        }
        return out
    }

    var streak: Int { Preferences.shared.calculateStreak() }

    /// 时段分布（startHour 聚合）
    func peakHourTotals() -> [Int: Int64] {
        var out: [Int: Int64] = [:]
        for s in sessions { out[s.startHour, default: 0] += s.durationSeconds }
        return out
    }

    var longestBook: (title: String, seconds: Int64)? {
        let byTitle = Dictionary(grouping: sessions, by: { $0.bookTitle })
        let maxEntry = byTitle.max { $0.value.reduce(0) { $0 + $1.durationSeconds } < $1.value.reduce(0) { $0 + $1.durationSeconds } }
        guard let maxEntry else { return nil }
        return (maxEntry.key, maxEntry.value.reduce(0) { $0 + $1.durationSeconds })
    }
}

struct StatisticsScreen: View {
    @StateObject private var model = StatisticsModel()
    @Environment(\.appTheme) private var appTheme
    @State private var showGodRanking = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                periodCard
                streakAndPeak
                heatmapCard
                // 神回排行榜入口
                Button {
                    HapticsGate.light()
                    showGodRanking = true
                } label: {
                    GlassCard(cornerRadius: DT.rLG) {
                        HStack {
                            Image(systemName: "heart.fill")
                                .foregroundStyle(AppColor.heartMid)
                            Text("神回排行榜")
                                .font(.system(size: 15, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                    }
                    .pressableCard()
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DT.spPage)
            .padding(.bottom, 130)
        }
        .background(Color(.systemBackground))
        .sheet(isPresented: $showGodRanking) {
            NavigationStack {
                GodRankingView()
                    .navigationTitle("神回排行榜")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    private var header: some View {
        Text("阅读统计")
            .font(.system(size: 26, weight: .bold))
            .padding(.top, DT.spLG)
    }

    private var periodCard: some View {
        GlassCard(cornerRadius: DT.rLG) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("总览").font(.system(size: 15, weight: .semibold))
                    Spacer()
                    SegmentedPillSelector(options: StatisticsModel.Period.allCases, label: { $0.rawValue },
                                          selection: $model.period)
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(formatReadDuration(model.totalSeconds(in: model.period)))
                        .font(.system(size: 30, weight: .heavy))
                        .foregroundStyle(appTheme.primary)
                    if let longest = model.longestBook, model.period == .year {
                        Text("最爱《\(longest.title)》")
                            .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                // 柱状图
                let days = model.period == .week ? 7 : (model.period == .month ? 30 : 365)
                let series = model.dailyTotals(days: days)
                let maxV = max(series.map { $0.seconds }.max() ?? 1, 1)
                HStack(alignment: .bottom, spacing: series.count > 40 ? 1 : 4) {
                    ForEach(Array(series.enumerated()), id: \.offset) { _, item in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(item.seconds > 0 ? appTheme.primary.opacity(0.85) : Color.primary.opacity(0.08))
                            .frame(height: max(3, CGFloat(item.seconds) / CGFloat(maxV) * 90))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 92)
            }
        }
    }

    private var streakAndPeak: some View {
        HStack(spacing: 12) {
            miniCard(icon: "flame.fill", tint: .orange, value: "\(model.streak)", label: "连续打卡（天）")
            miniCard(icon: "clock.fill", tint: appTheme.primary, value: peakLabel, label: "最活跃时段")
        }
    }

    private var peakLabel: String {
        let totals = model.peakHourTotals()
        guard let peak = totals.max(by: { $0.value < $1.value }) else { return "—" }
        return "\(peak.key):00"
    }

    private func miniCard(icon: String, tint: Color, value: String, label: String) -> some View {
        GlassCard(cornerRadius: DT.rLG) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon).foregroundStyle(tint)
                Text(value).font(.system(size: 20, weight: .bold))
                Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// GitHub 贡献图布局年热力图（YearHeatmap：列=周、行=星期、正方形格子）
    private var heatmapCard: some View {
        GlassCard(cornerRadius: DT.rLG) {
            VStack(alignment: .leading, spacing: 10) {
                Text("全年热力图").font(.system(size: 15, weight: .semibold))
                let daily = Dictionary(uniqueKeysWithValues: model.dailyTotals(days: 365).map { (DateFormatter.isoDate.string(from: $0.date), $0.seconds) })
                YearHeatmap(dailyTotals: daily)
            }
        }
    }

    private func formatReadDuration(_ seconds: Int64) -> String {
        let h = seconds / 3600, m = (seconds % 3600) / 60
        if h > 0 { return "\(h)h\(m)m" }
        if m > 0 { return "\(m)min" }
        return "\(seconds)s"
    }
}

// MARK: - 年热力图

struct YearHeatmap: View {
    let dailyTotals: [String: Int64]
    private let cellSize: CGFloat = 12
    private let gap: CGFloat = 3

    var body: some View {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let yearStart = cal.date(byAdding: .year, value: -1, to: today)!
        // 起点：对齐到周开始
        let firstWeekStart = cal.dateInterval(of: .weekOfYear, for: yearStart)?.start ?? yearStart
        let weeks = cal.dateComponents([.weekOfYear], from: firstWeekStart, to: today).weekOfYear ?? 52

        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: gap) {
                ForEach(0..<max(weeks, 1), id: \.self) { week in
                    VStack(spacing: gap) {
                        ForEach(0..<7, id: \.self) { weekday in
                            let day = cal.date(byAdding: .day, value: week * 7 + weekday, to: firstWeekStart)!
                            let key = DateFormatter.isoDate.string(from: day)
                            let seconds = dailyTotals[key] ?? 0
                            RoundedRectangle(cornerRadius: 2)
                                .fill(heatColor(seconds))
                                .frame(width: cellSize, height: cellSize)
                        }
                    }
                }
            }
        }
    }

    private func heatColor(_ seconds: Int64) -> Color {
        guard seconds > 0 else { return Color.primary.opacity(0.06) }
        let levels: [Int64] = [600, 1800, 3600, 7200]
        let idx = levels.firstIndex { seconds < $0 } ?? levels.count
        let alpha = 0.25 + 0.19 * Double(min(idx, 3) + 1)
        return Color(hex: 0x2563EB).opacity(min(alpha, 1))
    }
}

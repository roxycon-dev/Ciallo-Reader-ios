import Foundation
import SwiftUI

// MARK: - 漫画阅读配置（ui/comic/ComicReaderConfig.kt + ComicSettingsStore.kt 对应物）
// 五模式 × 方向 × 适配 + 每本独立配置 + 预设。

enum ComicMode: String, Codable, CaseIterable, Identifiable {
    case pagedRtl = "日漫（RTL 翻页）"
    case pagedLtr = "翻页（LTR）"
    case webtoon = "条漫"
    case continuous = "无缝条漫"
    case vertical = "上下翻页"

    var id: String { rawValue }
    var isVertical: Bool { self == .webtoon || self == .continuous || self == .vertical }
}

enum ComicFit: String, Codable, CaseIterable, Identifiable {
    case fitWidth = "适配宽度"
    case fitScreen = "适配屏幕"
    case fitHeight = "适配高度"
    case original = "原始大小"

    var id: String { rawValue }
}

enum ComicBgStyle: String, Codable, CaseIterable, Identifiable {
    case auto = "跟随主题"
    case black = "纯黑"
    case paper = "纸纹"

    var id: String { rawValue }
}

struct ComicReaderConfig: Codable, Equatable {
    var mode: ComicMode = .pagedRtl
    var fit: ComicFit = .fitWidth
    var pageGap: CGFloat = 4
    var keepScreenOn: Bool = false
    var magnetSnap: Bool = true
    var preloadWindow: Int = 2
    var background: ComicBgStyle = .auto
    /// 每页旋转（手动旋转记忆）
    var pageRotations: [Int: Double] = [:]

    static let builtinPresets: [String: ComicReaderConfig] = [
        "preset_builtin_manga": ComicReaderConfig(mode: .pagedRtl, fit: .fitWidth),
        "preset_builtin_webtoon": ComicReaderConfig(mode: .webtoon, fit: .fitWidth),
        "preset_builtin_novel_illu": ComicReaderConfig(mode: .pagedLtr, fit: .fitScreen),
    ]
}

@MainActor
final class ComicSettingsStore: ObservableObject {
    static let shared = ComicSettingsStore()
    private let prefs = Preferences.shared

    @Published var global: ComicReaderConfig {
        didSet { persistGlobal() }
    }
    /// 每本独立配置（bookKey → config JSON）
    private var perBook: [String: ComicReaderConfig] = [:] {
        didSet { persistPerBook() }
    }
    @Published var activePreset: String = "preset_builtin_manga"

    private init() {
        if let raw = prefs.string(for: "comic_config_global"),
           let decoded = try? JSONDecoder().decode(ComicReaderConfig.self, from: Data(raw.utf8)) {
            global = decoded
        } else {
            global = ComicReaderConfig()
        }
        if let raw = prefs.string(for: "comic_config_perbook"),
           let dict = try? JSONDecoder().decode([String: ComicReaderConfig].self, from: Data(raw.utf8)) {
            perBook = dict
        }
        activePreset = prefs.string(for: "comic_active_preset") ?? "preset_builtin_manga"
    }

    func config(for bookKey: String?) -> ComicReaderConfig {
        if let key = bookKey, let hit = perBook[key] { return hit }
        return global
    }

    func set(config: ComicReaderConfig, for bookKey: String?, followGlobal: Bool) {
        if followGlobal || bookKey == nil {
            global = config
        } else if let key = bookKey {
            perBook[key] = config
        }
    }

    func applyPreset(_ id: String) {
        if let preset = ComicReaderConfig.builtinPresets[id] {
            global = preset
            activePreset = id
            prefs.setString(id, for: "comic_active_preset")
        }
    }

    private func persistGlobal() {
        if let data = try? JSONEncoder().encode(global) {
            prefs.setString(String(data: data, encoding: .utf8) ?? "{}", for: "comic_config_global")
        }
    }

    private func persistPerBook() {
        if let data = try? JSONEncoder().encode(perBook) {
            prefs.setString(String(data: data, encoding: .utf8) ?? "{}", for: "comic_config_perbook")
        }
    }
}

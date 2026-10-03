import SwiftUI
import UIKit

// MARK: - 阅读器设置（ReaderScreen 设置持久化 + 字体唯一来源 AppFonts.kt 对应物）

@MainActor
final class ReaderSettings: ObservableObject {
    static let shared = ReaderSettings()
    private let prefs = Preferences.shared

    /// 阅读主题：1 白底 2 羊皮 3 夜间 4 护眼 5 纯黑
    @Published var themeId: Int {
        didSet { prefs.setInt(themeId, for: "reader_theme") }
    }
    /// 字号 sp（默认 18）
    @Published var fontSize: CGFloat {
        didSet { prefs.setDouble(Double(fontSize), for: "reader_font_size") }
    }
    /// 行距倍数（默认 1.6，最小 1.0）
    @Published var lineHeight: CGFloat {
        didSet { prefs.setDouble(Double(lineHeight), for: "reader_line_height") }
    }
    @Published var pageTurn: PageTurnType {
        didSet { prefs.setInt(pageTurn.rawValue, for: "reader_page_turn") }
    }
    @Published var customBackgroundPath: String? {
        didSet { prefs.setOptionalString(customBackgroundPath, for: "reader_custom_bg") }
    }
    @Published var keepScreenOn: Bool {
        didSet { prefs.setBool(keepScreenOn, for: "reader_keep_screen_on") }
    }

    var theme: ReaderTheme {
        ReaderTheme.presets.first { $0.id == themeId } ?? ReaderTheme.presets[0]
    }

    var contentFont: Font { .system(size: fontSize) }

    private init() {
        themeId = prefs.int(for: "reader_theme") ?? 1
        fontSize = CGFloat(prefs.double(for: "reader_font_size", default: 18))
        lineHeight = CGFloat(prefs.double(for: "reader_line_height", default: 1.6))
        pageTurn = PageTurnType(rawValue: prefs.int(for: "reader_page_turn") ?? 1) ?? .cover
        customBackgroundPath = prefs.optionalString(for: "reader_custom_bg")
        keepScreenOn = prefs.bool(for: "reader_keep_screen_on", default: false)
    }
}

// MARK: - 亮度覆盖（阅读器内亮度滑条）

final class BrightnessController: ObservableObject {
    static let shared = BrightnessController()
    @Published var override: Double? = nil {
        didSet {
            if let override { UIScreen.main.brightness = override } else { UIScreen.main.brightness = 0.5 }
        }
    }
}

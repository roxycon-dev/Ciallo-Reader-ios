import SwiftUI
import UIKit

// MARK: - 设计令牌（镜像 ui/design/DesignTokens.kt）

enum DT {
    static let rXS: CGFloat = 8
    static let rSM: CGFloat = 12
    static let rMD: CGFloat = 16
    static let rLG: CGFloat = 20
    static let rXL: CGFloat = 24

    static let spXS: CGFloat = 4
    static let spSM: CGFloat = 8
    static let spMD: CGFloat = 12
    static let spLG: CGFloat = 16
    static let spXL: CGFloat = 20
    static let spXXL: CGFloat = 24
    static let spPage: CGFloat = 16

    static let cardElevation: CGFloat = 2
    static let floatingElevation: CGFloat = 8
}

// MARK: - 基础色（镜像 ui/theme/Color.kt）

enum AppColor {
    static let mintGold = Color(hex: 0xE8C97A)
    static let darkCharcoal = Color(hex: 0x18191C)
    static let mediumGray = Color(hex: 0x61666D)
    static let dividerGray = Color(hex: 0xE3E5E7)
    static let lightBg = Color.white
    static let pureWhite = Color.white

    // 阅读主题预置色
    static let sepiaBg = Color(hex: 0xFBF0D9)
    static let sepiaText = Color(hex: 0x5F4B32)
    static let eyeGreenBg = Color(hex: 0xE8F5E9)
    static let eyeGreenText = Color(hex: 0x1B5E20)
    static let nightBg = Color(hex: 0x18191C)
    static let nightText = Color(hex: 0xD4D4D4)
    static let oledBg = Color.black
    static let oledText = Color(hex: 0xE0E0E0)

    /// 心形美工唯一色（ui/favorite/HeartArt.kt）
    static let heartMid = Color(hex: 0xFF4D6D)
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    /// WCAG 相对亮度（底部 Tab 栏同款算法，与 Color.luminance() 对齐）。
    func luminance() -> CGFloat {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        func linear(_ c: CGFloat) -> CGFloat { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    /// 亮背景 → 近黑 #1A1A1E；暗背景 → 纯白。
    func onColor() -> Color { luminance() > 0.5 ? Color(hex: 0x1A1A1E) : .white }
}

// MARK: - 五套基础主题色（镜像 ui/theme/Theme.kt）

let basePrimaryColors: [Color] = [
    Color(hex: 0x2563EB), // 0: 蓝
    Color(hex: 0x7C3AED), // 1: 紫
    Color(hex: 0x059669), // 2: 绿
    Color(hex: 0xDB2777), // 3: 粉
    Color(hex: 0xEA580C), // 4: 橙
]

let baseSecondaryColors: [Color] = [
    Color(hex: 0x3B82F6),
    Color(hex: 0x8B5CF6),
    Color(hex: 0x10B981),
    Color(hex: 0xEC4899),
    Color(hex: 0xF97316),
]

// MARK: - 画质档（ui/components/GlassQuality.kt）

enum RenderQuality: String, CaseIterable, Identifiable {
    case smooth = "流畅"
    case balanced = "均衡"
    case high = "高"
    case max = "极致"

    var id: String { rawValue }
}

// MARK: - 全局主题中枢（镜像 MainViewModel 的主题/护眼/触觉等全局状态）

@MainActor
final class AppTheme: ObservableObject {
    static let shared = AppTheme()
    private let prefs = Preferences.shared

    @Published var colorPrimaryIndex: Int {
        didSet { prefs.setInt(colorPrimaryIndex, for: "theme_color_primary") }
    }
    @Published var colorSecondaryIndex: Int {
        didSet { prefs.setInt(colorSecondaryIndex, for: "theme_color_secondary") }
    }
    /// nil = 跟随系统
    @Published var darkMode: Bool? {
        didSet { prefs.setOptionalBool(darkMode, for: "theme_dark_mode") }
    }
    @Published var eyeProtection: Bool {
        didSet { prefs.setBool(eyeProtection, for: "eye_protection") }
    }
    @Published var eyeWarmth: Double {
        didSet { prefs.setDouble(eyeWarmth, for: "eye_warmth") }
    }
    @Published var hapticsEnabled: Bool {
        didSet { prefs.setBool(hapticsEnabled, for: "haptics_enabled") }
    }
    @Published var renderQuality: RenderQuality {
        didSet { prefs.setString(renderQuality.rawValue, for: "render_quality") }
    }
    @Published var customBackgroundPath: String? {
        didSet { prefs.setOptionalString(customBackgroundPath, for: "custom_background") }
    }
    @Published var backgroundTone: CGFloat = 0.5

    var primary: Color {
        basePrimaryColors.indices.contains(colorPrimaryIndex) ? basePrimaryColors[colorPrimaryIndex] : basePrimaryColors[2]
    }
    var secondary: Color {
        baseSecondaryColors.indices.contains(colorSecondaryIndex) ? baseSecondaryColors[colorSecondaryIndex] : baseSecondaryColors[2]
    }

    var preferredColorScheme: ColorScheme? { darkMode.map { $0 ? ColorScheme.dark : ColorScheme.light } }

    private init() {
        colorPrimaryIndex = prefs.int(for: "theme_color_primary") ?? 2
        colorSecondaryIndex = prefs.int(for: "theme_color_secondary") ?? 2
        darkMode = prefs.optionalBool(for: "theme_dark_mode")
        eyeProtection = prefs.bool(for: "eye_protection", default: false)
        eyeWarmth = prefs.double(for: "eye_warmth", default: 0.3)
        hapticsEnabled = prefs.bool(for: "haptics_enabled", default: true)
        renderQuality = RenderQuality(rawValue: prefs.string(for: "render_quality") ?? "") ?? .balanced
        customBackgroundPath = prefs.optionalString(for: "custom_background")
    }

    /// 玻璃卡上的标题色：壁纸亮度×30% + 表面亮度×70%（glassTitleColor 同款公式）。
    func glassTitleColor(surfaceLuminance: CGFloat) -> Color {
        let effective = backgroundTone * 0.30 + surfaceLuminance * 0.70
        return effective > 0.4 ? Color(hex: 0x1A1A1E) : .white
    }
}

// MARK: - 环境注入

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue: AppTheme = .shared
}

extension EnvironmentValues {
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }
}

// MARK: - 阅读主题（ReaderScreen 五档：1 白底 2 羊皮 3 夜间 4 护眼 5 纯黑）

struct ReaderTheme: Identifiable, Equatable {
    let id: Int
    let name: String
    let background: Color
    let foreground: Color

    static let presets: [ReaderTheme] = [
        ReaderTheme(id: 1, name: "白底", background: .white, foreground: Color(hex: 0x18191C)),
        ReaderTheme(id: 2, name: "羊皮", background: AppColor.sepiaBg, foreground: AppColor.sepiaText),
        ReaderTheme(id: 3, name: "夜间", background: AppColor.nightBg, foreground: AppColor.nightText),
        ReaderTheme(id: 4, name: "护眼", background: AppColor.eyeGreenBg, foreground: AppColor.eyeGreenText),
        ReaderTheme(id: 5, name: "纯黑", background: AppColor.oledBg, foreground: AppColor.oledText),
    ]
}

// MARK: - 阅读翻页模式（PageTurnType：仿真/覆盖/平移/渐变/滚动）

enum PageTurnType: Int, CaseIterable, Identifiable {
    case simulate = 0
    case cover = 1
    case slide = 2
    case fade = 3
    case scroll = 4

    var id: Int { rawValue }
    var title: String {
        switch self {
        case .simulate: return "仿真3D卷页"
        case .cover: return "覆盖翻页"
        case .slide: return "平移翻页"
        case .fade: return "渐变淡出"
        case .scroll: return "上下滚动"
        }
    }
    var description: String {
        switch self {
        case .simulate: return "真实书本折角弯曲与纸张阴影"
        case .cover: return "无缝推开上页，经典质感"
        case .slide: return "左右双页平滑滑移"
        case .fade: return "优雅透明度切换"
        case .scroll: return "连续纵向滚动阅读"
        }
    }
}

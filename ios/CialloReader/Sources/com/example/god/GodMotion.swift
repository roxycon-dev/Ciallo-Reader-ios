// 对齐 god/GodMotion.kt（191 行）
// 神回动效与视觉规范：所有时长/弹簧/配色集中在此，调参只需改这一处。

import SwiftUI
import UIKit

// MARK: - GodMotion（弹簧/时长/圆角/阈值/按压）

enum GodMotion {
    // 弹簧
    /// 主弹簧：dampingRatio 0.72 / stiffness 380 —— 有轻微回弹的"精致感"
    static func springMain() -> Animation {
        Animation.spring(response: 0.34, dampingFraction: 0.72) // stiffness 380 ≈ response 0.34s
    }

    /// 轻弹簧：按压、小控件
    static func springLight() -> Animation {
        Animation.spring(response: 0.28, dampingFraction: 0.85) // stiffness 520
    }

    /// 软弹簧：大位移 / 整页转场
    static func springSoft() -> Animation {
        Animation.spring(response: 0.44, dampingFraction: 0.90) // stiffness 220
    }

    /// 低阻尼弹簧（拍立得摆动、进场弹入）
    static func springBouncy() -> Animation {
        Animation.spring(response: 0.40, dampingFraction: 0.55) // stiffness 260
    }

    // 时长（250~450ms，无线性硬切）
    static let FAST_MS = 0.18
    static let NORMAL_MS = 0.26
    static let SLOW_MS = 0.38
    static let SHEET_MS = 0.42

    /// 区块错峰间隔（需求：50~70ms）
    static let STAGGER_MS = 60
    /// 拍立得错峰摆动
    static let SWING_STAGGER_MS = 60

    /// 慢速呼吸周期（第 1 名金色光环）
    static let BREATH_MS = 3.2
    /// 光泽扫过间隔（主按钮 / 标题流光）
    static let SHINE_MS = 2.6
    /// 黑胶旋转周期
    static let VINYL_SPIN_MS = 6.0
    /// 金色流光描边一圈（章节卡）
    static let BORDER_SWEEP_MS = 4.2

    static func fast() -> Animation { .easeInOut(duration: FAST_MS) }
    static func normal() -> Animation { .easeInOut(duration: NORMAL_MS) }
    static func slow() -> Animation { .easeInOut(duration: SLOW_MS) }

    // 圆角 / 尺寸
    static let SHEET_CORNER: CGFloat = 28
    static let CARD_CORNER: CGFloat = 18
    static let BUTTON_CORNER: CGFloat = 14

    // 触发阈值
    /// 阻尼拉伸触发阈值（dp 等效）
    static let PULL_THRESHOLD_DP: CGFloat = 96
    /// 橡胶带阻尼系数（越大越费力）
    static let PULL_DAMPING: CGFloat = 0.55

    // 按压反馈：缩放 0.96 + 亮度微变
    static let PRESS_SCALE: CGFloat = 0.96
    static let PRESS_ALPHA: CGFloat = 0.92
}

// MARK: - GodGold（金/琥珀渐变 + 金银铜）

enum GodGold {
    // 金
    static let LightStart = Color(hex: 0xFFE29A)
    static let LightMid = Color(hex: 0xF5B942)
    static let LightEnd = Color(hex: 0xD98E1F)

    static let DarkStart = Color(hex: 0xE0CB96)
    static let DarkMid = Color(hex: 0xC79A3E)
    static let DarkEnd = Color(hex: 0x9A7223)

    // 银
    static let SilverLightStart = Color(hex: 0xF1F3F8)
    static let SilverLightEnd = Color(hex: 0xAEB6C4)
    static let SilverDarkStart = Color(hex: 0xC6CAD3)
    static let SilverDarkEnd = Color(hex: 0x868D9A)

    // 铜
    static let BronzeLightStart = Color(hex: 0xF6CDA8)
    static let BronzeLightEnd = Color(hex: 0xC47F4E)
    static let BronzeDarkStart = Color(hex: 0xD4B295)
    static let BronzeDarkEnd = Color(hex: 0x96613C)

    /// 主强调渐变（横向）
    static func goldGradient(darkTheme: Bool) -> [Color] {
        darkTheme ? [DarkStart, DarkMid, DarkEnd] : [LightStart, LightMid, LightEnd]
    }

    /// 竖向渐变（按钮 / 台阶）
    static func goldVertical(darkTheme: Bool) -> LinearGradient {
        LinearGradient(colors: goldGradient(darkTheme), startPoint: .top, endPoint: .bottom)
    }

    /// 名次配色：1 金 / 2 银 / 3 铜，其余用主题次级色
    static func medalColors(rank: Int, darkTheme: Bool) -> [Color] {
        switch rank {
        case 1: return goldGradient(darkTheme)
        case 2: return darkTheme ? [SilverDarkStart, SilverDarkEnd] : [SilverLightStart, SilverLightEnd]
        case 3: return darkTheme ? [BronzeDarkStart, BronzeDarkEnd] : [BronzeLightStart, BronzeLightEnd]
        default: return [LightMid.opacity(0.75), LightEnd.opacity(0.55)]
        }
    }
}

// MARK: - 主题明暗统一入口
//
// ⚠️ 不能用 colorScheme 直接判定：本 App 有自己的主题设置（浅色/深色/跟随系统），
// 系统浅色而 App 深色时，神回的金色明度、纸面、随笔便签底色、星标配色会整套错位。
// 按配色方案背景的真实亮度判定（luminance < 0.4）。

@MainActor
func godIsDark() -> Bool {
    UIColor(.systemBackground).luminanceCG() < 0.4
}

extension UIColor {
    /// WCAG 相对亮度（与 ui/theme luminance 同款算法）
    func luminanceCG() -> CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        func linear(_ c: CGFloat) -> CGFloat { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
}

// MARK: - 系统减弱动态效果检查

/// 系统「移除动画 / 动画时长缩放为 0」检查。
/// 命中时所有无限循环动画停用，转场降级为简单淡入淡出。
@MainActor
func rememberReduceMotion() -> Bool {
    // iOS 无法直接读 animator_duration_scale；用无障碍"减弱动态效果"开关等价判定
    UIAccessibility.isReduceMotionEnabled
}

/// 减少动态效果时：用 120ms 纯淡入淡出代替弹簧/位移。
func godSpec(reduce: Bool, spec: () -> Animation) -> Animation {
    reduce ? .easeInOut(duration: 0.12) : spec()
}

// MARK: - 统一按压反馈

/// 统一按压反馈：缩放 GodMotion.PRESS_SCALE + 亮度微变。
/// 用 scaleEffect 键路径形式，按压不触发外部重组。
struct GodPressModifier: ViewModifier {
    var enabled: Bool = true
    var scale: CGFloat = GodMotion.PRESS_SCALE
    @State private var pressed = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(enabled && pressed ? scale : 1)
            .opacity(enabled && pressed ? GodMotion.PRESS_ALPHA : 1)
            .animation(GodMotion.springLight(), value: pressed)
            .onLongPressGesture(minimumDuration: .infinity, pressing: { p in
                withAnimation(GodMotion.springLight()) { pressed = p }
            }, perform: {})
    }
}

extension View {
    func godPress(enabled: Bool = true, scale: CGFloat = GodMotion.PRESS_SCALE) -> some View {
        modifier(GodPressModifier(enabled: enabled, scale: scale))
    }
}

/// 错峰延迟：第 index 块的入场延迟。
func staggerDelay(_ index: Int, base: Int = 0) -> Double {
    Double(base + index * GodMotion.STAGGER_MS) / 1000
}

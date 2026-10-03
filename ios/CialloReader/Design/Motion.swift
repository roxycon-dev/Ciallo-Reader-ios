import SwiftUI
import UIKit

// MARK: - 动效与触觉令牌（镜像 ui/feedback/Motion.kt）
// 约定：调手感只动这里的令牌，不要在业务里散落魔法数字。

enum AppMotion {
    static let springDefault = Animation.spring(response: 0.34, dampingFraction: 0.86)
    static let springLift = Animation.spring(response: 0.28, dampingFraction: 0.72)
    static let springJelly = Animation.spring(response: 0.42, dampingFraction: 0.55)
    static let springReturn = Animation.spring(response: 0.38, dampingFraction: 0.9)
    static let springSettle = Animation.spring(response: 0.45, dampingFraction: 0.95)
    static let springTilt = Animation.spring(response: 0.3, dampingFraction: 0.8)
    static let springStiff = Animation.spring(response: 0.22, dampingFraction: 0.92)

    /// iOS easeOut（主题色过渡用，600ms）
    static let easeOutTheme = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.6)
    static let easeOutCubic = Animation.timingCurve(0.33, 1, 0.68, 1, duration: 0.3)
    static let easeSuckIn = Animation.timingCurve(0.7, 0, 0.84, 0, duration: 0.35)

    /// 「减少动态效果」降级时长
    static let degradedDuration: TimeInterval = 0.12
}

// MARK: - 五级语义触觉（AppHaptics）

enum AppHaptics {
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func tick() { UISelectionFeedbackGenerator().selectionChanged() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    /// 神回越界过阈：LONG_PRESS 强触觉
    static func longPress() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(intensity: 1.0) }
}

/// 触觉总开关镜像（LocalHapticsEnabled + HapticsGate）。
@MainActor
enum HapticsGate {
    static var enabled: Bool { AppTheme.shared.hapticsEnabled }
    static func light() { if enabled { AppHaptics.light() } }
    static func medium() { if enabled { AppHaptics.medium() } }
    static func heavy() { if enabled { AppHaptics.heavy() } }
    static func tick() { if enabled { AppHaptics.tick() } }
    static func success() { if enabled { AppHaptics.success() } }
    static func error() { if enabled { AppHaptics.error() } }
    static func longPress() { if enabled { AppHaptics.longPress() } }
}

// MARK: - 按压反馈（clickableRowFeedback 三档：缩放 + 变暗）

struct PressScaleModifier: ViewModifier {
    var scale: CGFloat = 0.97
    var dimOpacity: Double = 0.9
    @State private var pressed = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(pressed ? scale : 1)
            .opacity(pressed ? dimOpacity : 1)
            .animation(AppMotion.springStiff, value: pressed)
            .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
                withAnimation(AppMotion.springStiff) { pressed = pressing }
                if pressing { HapticsGate.light() }
            }, perform: {})
    }
}

extension View {
    /// 列表行按压反馈（大控件档）
    func pressableRow() -> some View { modifier(PressScaleModifier(scale: 0.985, dimOpacity: 0.92)) }
    /// 卡片按压反馈（中控件档）
    func pressableCard() -> some View { modifier(PressScaleModifier(scale: 0.97, dimOpacity: 0.9)) }
    /// 图标按钮按压反馈（小控件档）
    func pressableIcon() -> some View { modifier(PressScaleModifier(scale: 0.92, dimOpacity: 0.85)) }
}

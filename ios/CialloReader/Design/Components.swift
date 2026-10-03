import SwiftUI

// MARK: - 统一组件库（ui/components/ 对应物）

/// AppButton：primary/secondary/ghost 变体，按压缩放 + 阴影。
enum AppButtonVariant { case primary, secondary, ghost }

struct AppButton: View {
    let title: String
    var icon: String? = nil
    var variant: AppButtonVariant = .primary
    var compact: Bool = false
    var enabled: Bool = true
    let action: () -> Void

    @Environment(\.appTheme) private var theme

    var body: some View {
        Button {
            guard enabled else { return }
            HapticsGate.light()
            action()
        } label: {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: compact ? 13 : 15, weight: .semibold)) }
                Text(title).font(.system(size: compact ? 13 : 15, weight: .semibold))
            }
            .padding(.horizontal, compact ? 14 : 20)
            .frame(height: compact ? 34 : 44)
            .frame(maxWidth: compact ? nil : .infinity)
            .foregroundStyle(foreground)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: DT.rMD, style: .continuous))
            .opacity(enabled ? 1 : 0.45)
        }
        .buttonStyle(PressableButtonStyle())
    }

    private var foreground: Color {
        switch variant {
        case .primary: return theme.primary.onColor()
        case .secondary: return theme.primary
        case .ghost: return .primary
        }
    }

    @ViewBuilder
    private var background: some View {
        switch variant {
        case .primary: AnyShapeStyle(theme.primary)
        case .secondary: AnyShapeStyle(theme.primary.opacity(0.14))
        case .ghost: AnyShapeStyle(Color.primary.opacity(0.06))
        }
    }
}

struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(AppMotion.springStiff, value: configuration.isPressed)
    }
}

/// AppIconButton：全局统一图标按钮。
struct AppIconButton: View {
    let systemName: String
    var size: CGFloat = 20
    var padding: CGFloat = 10
    var tint: Color = .primary
    let action: () -> Void

    var body: some View {
        Button {
            HapticsGate.light()
            action()
        } label: {
            Image(systemName: systemName)
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(tint)
                .padding(padding)
                .background(Circle().fill(Color.primary.opacity(0.06)))
        }
        .buttonStyle(PressableButtonStyle())
    }
}

/// AppSwitch：统一开关（受控）。
struct AppSwitch: View {
    @Binding var isOn: Bool

    var body: some View {
        Toggle("", isOn: $isOn)
            .labelsHidden()
            .tint(AppTheme.shared.primary)
            .onChange(of: isOn) { _ in HapticsGate.tick() }
    }
}

/// SegmentedPillSelector：分段胶囊选择器（SettingsControls.kt）。
struct SegmentedPillSelector<T: Hashable & Identifiable>: View {
    let options: [T]
    let label: (T) -> String
    @Binding var selection: T

    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options) { option in
                let selected = option == selection
                Button {
                    HapticsGate.tick()
                    withAnimation(AppMotion.springDefault) { selection = option }
                } label: {
                    Text(label(option))
                        .font(.system(size: 13, weight: selected ? .semibold : .regular))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(
                            Capsule().fill(selected ? theme.primary : Color.primary.opacity(0.05))
                        )
                        .foregroundStyle(selected ? theme.primary.onColor() : Color.primary.opacity(0.7))
                }
                .buttonStyle(PressableButtonStyle())
            }
        }
        .padding(4)
        .background(Capsule().fill(.ultraThinMaterial))
    }
}

/// ChasingDots：追逐圆点加载动画。
struct ChasingDots: View {
    var color: Color = .accentColor
    var size: CGFloat = 28
    @State private var animate = false

    var body: some View {
        ZStack {
            ForEach(0..<6, id: \.self) { i in
                Circle()
                    .fill(color.opacity(0.85))
                    .frame(width: size / 4, height: size / 4)
                    .offset(x: size / 2 * cos(CGFloat(i) / 6 * 2 * .pi),
                            y: size / 2 * sin(CGFloat(i) / 6 * 2 * .pi))
                    .scaleEffect(animate ? 1 : 0.35)
                    .animation(
                        .easeInOut(duration: 0.7)
                        .repeatForever(autoreverses: true)
                        .delay(Double(i) * 0.08),
                        value: animate
                    )
            }
        }
        .onAppear { animate = true }
    }
}

/// ShimmerBox：微光占位。
struct ShimmerBox: View {
    var height: CGFloat
    var cornerRadius: CGFloat = DT.rMD
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.primary.opacity(0.06))
            .frame(height: height)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.35), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: phase * geo.size.width * 1.6)
                }
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            )
            .onAppear {
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

/// SourceAvatar：书源头像（首字 + 主题底色）。
struct SourceAvatar: View {
    let name: String
    var size: CGFloat = 36

    @Environment(\.appTheme) private var theme

    var body: some View {
        ZStack {
            Circle().fill(theme.primary.opacity(0.16))
            Text(String(name.prefix(1)))
                .font(.system(size: size * 0.45, weight: .bold))
                .foregroundStyle(theme.primary)
        }
        .frame(width: size, height: size)
    }
}

/// HeartArt：唯一一套心形美工（渐变 + 高光 + 发光，HeartMid = #FF4D6D）。
struct HeartArt: View {
    var size: CGFloat = 24
    var filled: Bool = true

    var body: some View {
        ZStack {
            if filled {
                HeartShape()
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0xFF7B93), AppColor.heartMid, Color(hex: 0xE63E5D)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                // 高光
                HeartShape()
                    .fill(LinearGradient(colors: [.white.opacity(0.55), .clear], startPoint: .top, endPoint: .center))
                    .scaleEffect(0.55)
                    .offset(y: -size * 0.12)
                HeartShape()
                    .fill(AppColor.heartMid.opacity(0.55))
                    .blur(radius: size * 0.35)
                    .scaleEffect(1.15)
            } else {
                HeartShape().stroke(AppColor.heartMid, lineWidth: size * 0.09)
            }
        }
        .frame(width: size, height: size)
    }
}

struct HeartShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        var p = Path()
        p.move(to: CGPoint(x: w * 0.5, y: h * 0.92))
        p.addCurve(to: CGPoint(x: 0, y: h * 0.32),
                   control1: CGPoint(x: w * 0.18, y: h * 0.74),
                   control2: CGPoint(x: 0, y: h * 0.55))
        p.addArc(center: CGPoint(x: w * 0.26, y: h * 0.28), radius: w * 0.26,
                 startAngle: .degrees(160), endAngle: .degrees(0), clockwise: false)
        p.addArc(center: CGPoint(x: w * 0.74, y: h * 0.28), radius: w * 0.26,
                 startAngle: .degrees(180), endAngle: .degrees(20), clockwise: false)
        p.addCurve(to: CGPoint(x: w * 0.5, y: h * 0.92),
                   control1: CGPoint(x: w, y: h * 0.55),
                   control2: CGPoint(x: w * 0.82, y: h * 0.74))
        p.closeSubpath()
        return p
    }
}

/// HeartBurst：落点粒子反馈。
struct HeartBurst: View {
    @State private var fired = false

    var body: some View {
        ZStack {
            ForEach(0..<8, id: \.self) { i in
                HeartArt(size: 10)
                    .offset(x: fired ? cos(CGFloat(i) / 8 * 2 * .pi) * 44 : 0,
                            y: fired ? sin(CGFloat(i) / 8 * 2 * .pi) * 44 : 0)
                    .opacity(fired ? 0 : 1)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) { fired = true }
        }
    }
}

/// MascotEmptyState：吉祥物空状态（moods：float/breath/happyBounce/sadAlpha）。
struct MascotEmptyState: View {
    enum Mood { case float, breath, happyBounce, sadAlpha }
    let title: String
    var subtitle: String? = nil
    var mood: Mood = .float

    @State private var animate = false

    var body: some View {
        VStack(spacing: 12) {
            Image("AppLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 88, height: 72)
                .opacity(mood == .sadAlpha ? 0.45 : 1)
                .offset(y: animate ? offset.y : .zero)
                .animation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true), value: animate)
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.secondary)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
        .onAppear { animate = true }
    }

    private var offset: CGSize {
        switch mood {
        case .float: return CGSize(width: 0, height: -8)
        case .breath: return CGSize(width: 0, height: -3)
        case .happyBounce: return CGSize(width: 0, height: -14)
        case .sadAlpha: return CGSize(width: 0, height: 0)
        }
    }
}

// MARK: - 统一 Toast（AppToast：ERROR 走红色错误卡，其余中性卡）

enum AppSnackKind { case neutral, success, error }

struct AppSnack: Identifiable, Equatable {
    let id = UUID()
    let message: String
    var kind: AppSnackKind = .neutral
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
}

/// 全局 Snackbar 宿主（挂到根视图）。
final class AppToastCenter: ObservableObject {
    static let shared = AppToastCenter()
    @Published var current: AppSnack?

    @MainActor
    func show(_ message: String, kind: AppSnackKind = .neutral) {
        withAnimation(AppMotion.springDefault) {
            current = AppSnack(message: message, kind: kind)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { [weak self] in
            guard let self, self.current?.message == message else { return }
            withAnimation(AppMotion.springDefault) { self.current = nil }
        }
    }

    @MainActor
    func showError(_ message: String) { show(message, kind: .error) }
}

struct AppSnackbarHost: View {
    @ObservedObject private var center = AppToastCenter.shared

    var body: some View {
        VStack {
            Spacer()
            if let snack = center.current {
                snackbar(snack)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.horizontal, DT.spLG)
                    .padding(.bottom, 96)
            }
        }
        .allowsHitTesting(center.current != nil)
    }

    @ViewBuilder
    private func snackbar(_ snack: AppSnack) -> some View {
        HStack(spacing: 10) {
            if snack.kind == .error {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
            Text(snack.message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(snack.kind == .error ? Color(hex: 0xFFDAD6) : Color.primary)
                .lineLimit(3)
            Spacer(minLength: 0)
            if let actionTitle = snack.actionTitle, let action = snack.action {
                Button(actionTitle) {
                    action()
                    center.current = nil
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.shared.primary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: DT.rMD, style: .continuous)
                .fill(snack.kind == .error ? Color(hex: 0x8C1D18) : .regularMaterial)
        )
        .consistentShadow(radius: 12, y: 4, opacity: 0.2)
    }
}

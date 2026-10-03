import SwiftUI

// MARK: - 玻璃体系（GlassCard 第一套 + GlassKit 第二套的 SwiftUI 对应物）
//
// 安卓侧用 KMPLiquidGlass（AGSL shader 折射/虹彩/高光）；iOS 侧以系统材质
// （.ultraThinMaterial 等）打底，叠加自绘高光、发丝描边与按压缩放，观感对齐。

/// 统一阴影（对应 vendored shadowglow 的 Modifier.consistentShadow）：
/// iOS 上 shadow(color:radius:) 由系统合成，无 BlurMaskFilter 静默失效问题，
/// 但同样遵循「阴影可外溢 + 内容裁剪」的语义。
struct ConsistentShadow: ViewModifier {
    var radius: CGFloat
    var y: CGFloat = 2
    var opacity: Double = 0.12
    var color: Color = .black
    var shape: AnyShape?

    func body(content: Content) -> some View {
        if let shape {
            content
                .shadow(color: color.opacity(opacity), radius: radius, x: 0, y: y)
                .clipShape(shape)
        } else {
            content.shadow(color: color.opacity(opacity), radius: radius, x: 0, y: y)
        }
    }
}

extension View {
    func consistentShadow(radius: CGFloat, y: CGFloat = 2, opacity: Double = 0.12, color: Color = .black) -> some View {
        modifier(ConsistentShadow(radius: radius, y: y, opacity: opacity, color: color))
    }
}

/// 连续曲率圆角（GlassKit squircle 的超椭圆参数化）。
struct SquircleShape: Shape {
    var radius: CGFloat
    /// 超椭圆指数；Apple 卡片观感约 4~5
    var exponent: CGFloat = 4.2

    func path(in rect: CGRect) -> Path {
        let n = exponent
        let a = rect.width / 2, b = rect.height / 2
        let cx = rect.midX, cy = rect.midY
        var p = Path()
        let steps = max(32, Int(min(rect.width, rect.height)))
        for i in 0...steps {
            let t = CGFloat(i) / CGFloat(steps) * 2 * .pi
            let cosa = cos(t), sina = sin(t)
            let x = cx + a * pow(abs(cosa), 2 / n) * (cosa >= 0 ? 1 : -1)
            let y = cy + b * pow(abs(sina), 2 / n) * (sina >= 0 ? 1 : -1)
            if i == 0 { p.move(to: CGPoint(x: x, y: y)) } else { p.addLine(to: CGPoint(x: x, y: y)) }
        }
        p.closeSubpath()
        return p
    }
}

/// 玻璃卡片（GlassCard.kt 对应物）。
/// 用法：GlassCard { content }；支持按压跷跷板（pressTilt）与点击回调。
struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat = DT.rLG
    var padding: CGFloat = DT.spLG
    var blurRadius: CGFloat = 24
    var surfaceAlpha: Double = 0.78
    var pressTilt: Bool = false
    var useSquircle: Bool = false
    var onTap: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    @Environment(\.colorScheme) private var colorScheme
    @State private var pressed = false
    @State private var tiltX: CGFloat = 0

    var body: some View {
        let shape = useSquircle
            ? AnyShape(SquircleShape(radius: cornerRadius))
            : AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        Group {
            if let onTap {
                Button {
                    HapticsGate.light()
                    onTap()
                } label: {
                    inner(shape: shape)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(DragGesture(minimumDistance: 0)
                    .onChanged { v in withAnimation(AppMotion.springStiff) { pressed = v.location != .zero } }
                    .onEnded { _ in withAnimation(AppMotion.springReturn) { pressed = false } })
            } else {
                inner(shape: shape)
            }
        }
    }

    private func inner(shape: AnyShape) -> some View {
        content()
            .padding(padding)
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(colorScheme == .dark ? Color.white.opacity(0.06 * surfaceAlpha * 1.6) : Color.white.opacity(surfaceAlpha))
                    if colorScheme == .dark {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(Color.black.opacity(0.25))
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            )
            .overlay(
                // 发丝描边 + 顶部高光（对应 edgeLayer/lightPathLayer）
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                .white.opacity(colorScheme == .dark ? 0.16 : 0.55),
                                .white.opacity(colorScheme == .dark ? 0.04 : 0.15),
                            ],
                            startPoint: .top, endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .clipShape(shape)
            .scaleEffect(pressed && pressTilt ? 0.97 : 1)
            .rotation3DEffect(.degrees(pressed && pressTilt ? tiltX : 0), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
            .animation(pressed ? AppMotion.springStiff : AppMotion.springReturn, value: pressed)
            .consistentShadow(radius: 8, y: 3, opacity: 0.10)
    }
}

/// 亚克力弹窗表面（AcrylicDialog / godAcrylicPanel 同款词汇）：
/// 棱镜描边 + 虹彩，不采样阅读页内容（GL 卷页禁令在 iOS 上天然不适用，但保持同一降级词汇）。
struct AcrylicSurface: ViewModifier {
    var cornerRadius: CGFloat = DT.rXL

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [.pink.opacity(0.35), .mint.opacity(0.35), .purple.opacity(0.35), .orange.opacity(0.35)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
    }
}

extension View {
    func acrylicPanel(cornerRadius: CGFloat = DT.rXL) -> some View { modifier(AcrylicSurface(cornerRadius: cornerRadius)) }
}

/// 装饰光弧巡游（MaxFx.chromaFlowEdge 的简化对应；仅 RenderQuality.max 激活）。
struct ChromaFlowEdge: ViewModifier {
    @Environment(\.appTheme) private var theme

    func body(content: Content) -> some View {
        if theme.renderQuality == .max {
            content.overlay(
                TimelineView(.animation) { timeline in
                    let t = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 6) / 6
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(
                            AngularGradient(
                                colors: [.clear, .pink, .orange, .mint, .clear],
                                center: .center,
                                startAngle: .degrees(t * 360),
                                endAngle: .degrees(t * 360 + 120)
                            ),
                            lineWidth: 1.5
                        )
                        .opacity(0.6)
                }
            )
        } else {
            content
        }
    }
}

extension View {
    func maxCardAuraIfEligible() -> some View { modifier(ChromaFlowEdge()) }
}

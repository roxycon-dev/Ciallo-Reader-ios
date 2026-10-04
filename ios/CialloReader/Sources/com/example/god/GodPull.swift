// 对齐 god/GodPull.kt（395 行）
// 「神回」拉拽状态机（翻页模式与条漫模式共用）+ 边缘光晕浮层 + 提示胶囊 + 滚动连接。
// 阻尼：iOS UIScrollView 橡胶带公式 d = (1 - 1/(raw·c/span + 1))·(span/c)，c=0.55。
// 触发：阻尼后位移 ≥ 阈值（默认 96dp 等效）→ armed，过阈瞬间强触觉；松手 armed 则回调。

import SwiftUI
import UIKit

// MARK: - 拉拽方向：决定光晕出现在哪条边

enum GodPullEdge {
    case left, right, top, bottom
}

// MARK: - 拉拽状态机

/// 阻尼后的位移用 @Published 承载（对应 Kotlin Animatable + mutableStateOf）。
@MainActor
final class GodPullState: ObservableObject {
    /// 阻尼后的位移（px，≥0）
    @Published private(set) var offset: CGFloat = 0
    /// 是否已过阈值（过阈瞬间触发一次强触觉）
    @Published private(set) var armed = false
    /// 触发阈值（px）
    var thresholdPx: CGFloat = 1
    /// 阻尼基准长度（屏幕宽或高，px）
    var spanPx: CGFloat = 1
    /// 过阈回调（触觉）
    var onArm: (() -> Unit)?
    /// 触发回调（松手过阈时调用）
    var onTrigger: (() -> Unit)?

    private var raw: CGFloat = 0

    /// 0..1 进度（圆环用）
    var progress: CGFloat {
        thresholdPx <= 0 ? 0 : min(max(offset / thresholdPx, 0), 1)
    }

    private func damp(_ rawPx: CGFloat) -> CGFloat {
        guard spanPx > 0 else { return 0 }
        let c = GodMotion.PULL_DAMPING
        let maxY = spanPx / c
        return (1 - 1 / (rawPx * c / spanPx + 1)) * maxY
    }

    /// 设置累计的原始越界量（px，≥0）。
    func setRaw(_ rawPx: CGFloat) {
        let next = max(rawPx, 0)
        raw = next
        let d = damp(next)
        let nowArmed = d >= thresholdPx
        if nowArmed && !armed { onArm?() }
        armed = nowArmed
        offset = d
    }

    func addRaw(_ deltaPx: CGFloat) {
        setRaw(raw + deltaPx)
    }

    /// 松手：过阈就触发；随后弹簧回正。传 nil 时用 onTrigger。
    /// ⚠️ 千万别随手塞一个 {}：判空是 `onTriggered ?? onTrigger`，空闭包非 nil
    /// 会把它当成"宿主自己处理"而永远打不开神回窗口。
    func release(onTriggered: (() -> Unit)? = nil) {
        let wasArmed = armed
        armed = false
        raw = 0
        if wasArmed { (onTriggered ?? onTrigger)?() }
        withAnimation(GodMotion.springMain()) { offset = 0 }
    }

    /// 直接归零（取消手势 / 页面切换）
    func reset() {
        armed = false
        raw = 0
        withAnimation(GodMotion.springMain()) { offset = 0 }
    }

    /// 阻尼值 → 原始越界量（反向推导，用于滚动回退）。
    func dampedToRaw(_ damped: CGFloat) -> CGFloat {
        let c = GodMotion.PULL_DAMPING
        let span = spanPx
        guard span > 0 else { return 0 }
        let ratio = min(max(damped / (span / c), 0), 0.999)
        return (1 / (1 - ratio) - 1) * span / c
    }
}

// MARK: - 创建状态

/// 创建神回拉拽状态。edgeIsVertical true = 纵向（条漫），false = 横向（翻页）。
@MainActor
func makeGodPullState(edgeIsVertical: Bool,
                      threshold: CGFloat = GodMotion.PULL_THRESHOLD_DP,
                      onArmed: (() -> Unit)? = nil,
                      onTriggered: (() -> Unit)? = nil) -> GodPullState {
    let state = GodPullState()
    state.onArm = {
        HapticsGate.longPress() // LONG_PRESS 强触觉（对应 view.performHapticFeedback）
        onArmed?()
    }
    let bounds = UIScreen.main.bounds
    state.spanPx = edgeIsVertical ? bounds.height : bounds.width
    state.thresholdPx = threshold
    state.onTrigger = onTriggered
    return state
}

/// 供阅读器判断"是否在末页"用的小工具。
func isAtEnd(_ current: Int, _ count: Int) -> Bool {
    count > 0 && current >= count - 1
}

/// 绝对值工具（阅读器计算拉拽方向时避免符号错误）。
func godAbs(_ f: CGFloat) -> CGFloat { abs(f) }

// MARK: - 拉拽浮层：边缘渐进光晕 + 圆环进度 + 文案

struct GodPullOverlay: View {
    let state: GodPullState
    var edge: GodPullEdge = .right
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let p = state.progress
        let px = state.offset
        let dark = colorScheme == .dark
        let gold = GodGold.goldGradient(darkTheme: dark)
        GodPullCanvas(progress: p, offsetPx: px, edge: edge, gold: gold)
            .overlay(alignment: .center) {
                VStack(spacing: 4) {
                    Text(state.armed ? "✦" : "◇")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(gold[0])
                    Text(state.armed ? "松手，收藏这一刻" : "继续滑动")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(state.armed ? "神回已就绪" : "标记为神回")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.72))
                }
                .offset(y: edge == .bottom ? -px * 0.18 : 0)
            }
            .opacity(p > 0.01 ? 1 : 0)
            .animation(GodMotion.fast(), value: p > 0.01)
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }
}

/// 光晕 + 刻度 + 圆环 Canvas（对应 Kotlin Canvas 绘制段，逐段等价）。
private struct GodPullCanvas: View {
    let progress: CGFloat
    let offsetPx: CGFloat
    let edge: GodPullEdge
    let gold: [Color]

    var body: some View {
        Canvas { ctx, size in
            let p = progress
            // 边缘光晕（径向）
            let center: CGPoint = {
                switch edge {
                case .left: return CGPoint(x: 0, y: size.height / 2)
                case .right: return CGPoint(x: size.width, y: size.height / 2)
                case .top: return CGPoint(x: size.width / 2, y: 0)
                case .bottom: return CGPoint(x: size.width / 2, y: size.height)
                }
            }()
            let radius = max(size.width, size.height) * 0.75
            let glow = Gradient(colors: [gold[0].opacity(0.34 * p), .clear])
            ctx.fill(Path(CGRect(origin: .zero, size: size)),
                     with: .radialGradient(glow, center: center, startRadius: 0, endRadius: radius))

            // 从被拉动的边缘向内生长的金色刻度，进度越高越亮
            if edge == .left || edge == .right {
                let edgeX: CGFloat = edge == .left ? 0 : size.width
                let side: CGFloat = edge == .left ? 1 : -1
                let halfSpan = size.height * (0.12 + 0.32 * p)
                let lineGrad = Gradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: gold[0].opacity(0.90 * p), location: 0.5),
                    .init(color: .clear, location: 1),
                ])
                ctx.drawLayer { layer in
                    let path = Path { path in
                        path.move(to: CGPoint(x: edgeX + side * 3, y: size.height / 2 - halfSpan))
                        path.addLine(to: CGPoint(x: edgeX + side * 3, y: size.height / 2 + halfSpan))
                    }
                    layer.stroke(path, with: .linearGradient(
                        lineGrad,
                        startPoint: CGPoint(x: edgeX + side * 3, y: size.height / 2 - halfSpan),
                        endPoint: CGPoint(x: edgeX + side * 3, y: size.height / 2 + halfSpan)),
                        style: StrokeStyle(lineWidth: 2 + p * 5, ))
                }
                for i in -3...3 {
                    let y = size.height / 2 + CGFloat(i) * 34
                    let reach = (12 + 38 * p * (1 - CGFloat(abs(i)) * 0.14))
                    var tick = Path()
                    tick.move(to: CGPoint(x: edgeX, y: y))
                    tick.addLine(to: CGPoint(x: edgeX + side * reach, y: y))
                    ctx.stroke(tick, with: .color(gold[0].opacity(p * (0.40 + CGFloat(3 - abs(i)) * 0.12))),
                               lineWidth: 1, )
                }
            }

            // 圆环进度（居中偏内，随拉拽位移轻微跟手）
            let r = min(size.width, size.height) * 0.13
            let center = CGPoint(
                x: size.width / 2,
                y: size.height / 2 + (edge == .bottom ? -offsetPx * 0.18 : edge == .top ? offsetPx * 0.18 : 0)
            )
            ctx.fill(Path(ellipseIn: CGRect(x: center.x - r * 1.25, y: center.y - r * 1.25, width: r * 2.5, height: r * 2.5)),
                     with: .color(.white.opacity(0.10)))
            ctx.fill(Path(ellipseIn: CGRect(x: center.x - r * (1.1 + 0.22 * p), y: center.y - r * (1.1 + 0.22 * p),
                                            width: r * 2 * (1.1 + 0.22 * p), height: r * 2 * (1.1 + 0.22 * p))),
                     with: .color(gold[0].opacity(0.10 * p)))
            var ring = Path()
            ring.addEllipse(in: CGRect(x: center.x - r * 1.42, y: center.y - r * 1.42,
                                       width: r * 2.84, height: r * 2.84))
            ctx.stroke(ring, with: .color(gold[0].opacity(0.28 * p)), lineWidth: 1)

            var track = Path()
            track.addEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
            ctx.stroke(track, with: .color(.white.opacity(0.28)), style: StrokeStyle(lineWidth: 5, ))

            // 进度弧（sweep 渐变）
            var arc = Path()
            arc.addArc(center: center, radius: r,
                       startAngle: .degrees(-90),
                       endAngle: .degrees(-90 + 360 * p), clockwise: false)
            let sweepColors = gold + [gold[0]]
            ctx.stroke(arc, with: .angularGradient(Gradient(colors: sweepColors), center: center,
                                                   startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * p)),
                       style: StrokeStyle(lineWidth: 5, ))
        }
    }
}

// MARK: - 末页提示胶囊（淡入淡出，几秒后自动消失）

struct GodHintCapsule: View {
    var visible: Bool
    var text: String = "继续滑动 · 标记神回"

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 50).fill(Color(hex: 0x111318).opacity(0.80)))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.25), radius: 6, y: 3)
            .opacity(visible ? 1 : 0)
            .animation(GodMotion.normal(), value: visible)
    }
}

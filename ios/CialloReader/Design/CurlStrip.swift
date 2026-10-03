import SwiftUI
import UIKit

// MARK: - 仿真卷页（fi/harism/curl CurlMesh 圆柱投影的条带渲染移植）
//
// 安卓用 OpenGL 顶点网格做圆柱投影（x′ = F + R·sin(s/R)）；iOS 用同一条投影公式
// 以竖向条带逐条重映射位图：曲面只发生在卷筒段（θ∈[0,π]），卷筒前/后都是平面，
// 翻过卷筒（θ>π）的部分以镜像背面平铺在折缝另一侧（"单面印刷透纸"观感用压暗近似）。
// 每帧绘制 ~120 个条带矩形，Canvas 一次提交，开销与 GL 网格同量级。

enum CurlMath {
    static let pi = CGFloat.pi

    struct Geometry {
        /// 折缝屏幕位置（= 折缝源位置：平面段不位移）
        let fold: CGFloat
        /// 卷筒半径
        let radius: CGFloat
        /// 卷筒可用弧长（受页宽限制）
        let capArc: CGFloat
        /// 已翻过卷筒、平铺在折缝另一侧的长度（镜像背面）
        let flippedLen: CGFloat
        let width: CGFloat
        let rtl: Bool

        /// 屏幕位置：距折缝沿"翻页方向"的弧长 u 对应的投影
        func capScreenX(_ u: CGFloat) -> CGFloat {
            let sign: CGFloat = rtl ? -1 : 1
            return fold + sign * radius * sin(u / radius)
        }
        /// 源位置：同一弧长在原页上的坐标
        func capSourceX(_ u: CGFloat) -> CGFloat {
            let sign: CGFloat = rtl ? -1 : 1
            return fold + sign * u
        }
    }

    /// 由翻页进度 t（0=未翻，1=完全翻过）推导几何
    static func geometry(width: CGFloat, t: CGFloat, rtl: Bool, radiusBase: CGFloat? = nil) -> Geometry {
        let clamped = min(max(t, 0), 1)
        let fold = rtl ? width * clamped : width * (1 - clamped)
        // 卷筒随手势收紧（harism 手感：起卷缓、收卷急）
        let radius = max(24, (radiusBase ?? width * 0.16) * (1 - 0.35 * clamped))
        let remaining = rtl ? fold : (width - fold)
        let capArc = min(.pi * radius / 2, remaining)
        let flippedLen = max(0, remaining - .pi * radius)
        return Geometry(fold: fold, radius: radius, capArc: capArc, flippedLen: flippedLen, width: width, rtl: rtl)
    }
}

struct CurlStripCanvas: View {
    /// 源矩形 → 目标矩形的水平重映射绘制（source/dest 等高）
    static func drawStrip(_ ctx: inout GraphicsContext, image: Image, dest: CGRect, source: CGRect) {
        guard source.width > 0, dest.width > 0 else { return }
        let k = dest.width / source.width
        ctx.drawLayer { layer in
            layer.translateBy(x: dest.minX - source.minX * k, y: 0)
            layer.scaleBy(x: k, y: 1)
            layer.draw(image, in: source)
        }
    }
    let front: UIImage
    let beneath: UIImage?
    let t: CGFloat
    let rtl: Bool

    private let stripCount = 56

    var body: some View {
        Canvas { ctx, size in
            let geo = CurlMath.geometry(width: size.width, t: t, rtl: rtl)
            let H = size.height
            let image = Image(uiImage: front)

            // 1. 底层：下一页（或纸底）
            if let beneath {
                ctx.draw(Image(uiImage: beneath), in: CGRect(x: 0, y: 0, width: size.width, height: H))
            } else {
                ctx.fill(Path(CGRect(x: 0, y: 0, width: size.width, height: H)),
                         with: .color(Color(hex: 0x18191C)))
            }

            // 2. 未折平面段（当前页不动部分）
            let flatRect: CGRect
            if geo.rtl {
                flatRect = CGRect(x: geo.fold, y: 0, width: size.width - geo.fold, height: H)
            } else {
                flatRect = CGRect(x: 0, y: 0, width: geo.fold, height: H)
            }
            if flatRect.width > 0 {
                ctx.draw(image, in: flatRect)
            }

            // 3. 已翻过卷筒的镜像背面（压暗 = "透纸"）
            // 映射：screen = A - s（A = 2·fold + sign·πR），用先平移后镜像的图层实现
            if geo.flippedLen > 0 {
                let flippedSource: CGRect
                let sign: CGFloat = geo.rtl ? -1 : 1
                if geo.rtl {
                    flippedSource = CGRect(x: geo.fold - .pi * geo.radius - geo.flippedLen, y: 0,
                                           width: geo.flippedLen, height: H)
                } else {
                    flippedSource = CGRect(x: geo.fold + .pi * geo.radius, y: 0,
                                           width: geo.flippedLen, height: H)
                }
                if flippedSource.minX >= 0, flippedSource.maxX <= size.width {
                    let anchor = 2 * geo.fold + sign * .pi * geo.radius
                    ctx.drawLayer { layer in
                        layer.translateBy(x: anchor, y: 0)
                        layer.scaleBy(x: -1, y: 1)
                        layer.draw(image, in: flippedSource)
                    }
                    // 背面压暗（Android: 20% alpha 叠纸底 + 轻模糊的近似）
                    let flippedDest: CGRect = geo.rtl
                        ? CGRect(x: geo.fold, y: 0, width: geo.flippedLen, height: H)
                        : CGRect(x: geo.fold - geo.flippedLen, y: 0, width: geo.flippedLen, height: H)
                    let shade = Gradient(colors: [.black.opacity(0.24), .black.opacity(0.30)])
                    ctx.fill(Path(CGRect(origin: flippedDest.origin, size: flippedDest.size)),
                             with: .linearGradient(shade, startPoint: CGPoint(x: flippedDest.minX, y: 0),
                                                   endPoint: CGPoint(x: flippedDest.maxX, y: 0)))
                }
            }

            // 4. 卷筒段：θ ∈ [0, min(π/2, 剩余/R)]，x = fold + sign·R·sin(θ)
            if geo.capArc > 0 {
                let strips = stripCount
                for i in 0..<strips {
                    let u0 = geo.capArc * CGFloat(i) / CGFloat(strips)
                    let u1 = geo.capArc * CGFloat(i + 1) / CGFloat(strips)
                    let sx0 = geo.capScreenX(u0)
                    let sx1 = geo.capScreenX(u1)
                    let dest = CGRect(x: min(sx0, sx1), y: 0, width: abs(sx1 - sx0) + 0.75, height: H)
                    let srcW = u1 - u0
                    guard srcW > 0 else { continue }
                    // 纹理方向：靠近折缝的源列映射到靠近折缝的屏幕列（文字保持正向）
                    // LTR: dest 从 fold 向右增大，source 也从 fold 向右增大 → 取 s(u0)
                    // RTL: dest 从 fold 向左减小，source 从 fold 向左减小 → 取 s(u1) 再正序画
                    let srcX = geo.rtl ? geo.capSourceX(u1) : geo.capSourceX(u0)
                    let source = CGRect(x: srcX, y: 0, width: srcW, height: H)
                    CurlStripCanvas.drawStrip(&ctx, image: image, dest: dest, source: source)

                    // 曲面明暗（θ 越大越背光）
                    let theta = u1 / geo.radius
                    let darken = 0.16 * sin(theta)
                    if darken > 0.005 {
                        ctx.fill(Path(CGRect(origin: dest.origin, size: dest.size)),
                                 with: .color(.black.opacity(darken)))
                    }
                }
            }

            // 5. 折缝阴影（打在未折平面上）
            let shadowWidth: CGFloat = 44
            let shadowRect: CGRect
            let shade: LinearGradient
            if geo.rtl {
                shadowRect = CGRect(x: geo.fold, y: 0, width: min(shadowWidth, size.width - geo.fold), height: H)
                shade = LinearGradient(colors: [.black.opacity(0.20), .clear], startPoint: .leading, endPoint: .trailing)
            } else {
                shadowRect = CGRect(x: max(0, geo.fold - shadowWidth), y: 0, width: min(shadowWidth, geo.fold), height: H)
                shade = LinearGradient(colors: [.clear, .black.opacity(0.20)], startPoint: .leading, endPoint: .trailing)
            }
            if shadowRect.width > 0 {
                ctx.fill(Path(CGRect(origin: shadowRect.origin, size: shadowRect.size)),
                         with: .linearGradient(shade, startPoint: CGPoint(x: shadowRect.minX, y: 0),
                                               endPoint: CGPoint(x: shadowRect.maxX, y: 0)))
            }
        }
    }
}

// MARK: - 文字阅读器页快照（GL 纹理信箱的对应物：拖拽起手时快照当前/下一页）

@MainActor
enum PageSnapshotRenderer {
    static func render(_ view: some View, size: CGSize) -> UIImage? {
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.scale = UIScreen.main.scale
        renderer.proposedSize = ProposedViewSize(size)
        return renderer.uiImage
    }
}

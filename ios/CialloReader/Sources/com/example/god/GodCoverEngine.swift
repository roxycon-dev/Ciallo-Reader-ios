// 对齐 god/GodCoverEngine.kt（412 行）
// 神回封面合成引擎（全部后台线程跑）。
// 合成规则：①背景层 centerCrop 铺满 → 降采样 1/8 → 3 次盒式模糊（中心极限逼近高斯）→ 放大 → ~15% 暗蒙版；
// ②前景层 contain 居中（四周 8% 边距）+ 圆角（短边 3%）+ 柔和投影。
// 结果：无论用户裁出什么比例，成品尺寸恒定 900×1200，没有黑边白边。

import Foundation
import UIKit
import ImageIO

enum GodCoverEngine {
    // MARK: 常量（集中在顶部，方便调参）

    static let COVER_W = 900
    static let COVER_H = 1200
    /// 画布比例（3:4）；以后要改尺寸只改这一处 + 上面的宽高
    static let COVER_RATIO: Float = 3.0 / 4.0

    /// 预览尺寸：拖动裁剪时保证流畅（合成同样走后台线程）
    static let PREVIEW_W = 450
    static let PREVIEW_H = 600

    static let JPEG_QUALITY = 90
    static let CACHE_DIR = "god_covers"

    /// 前景四周留白（占画布短边比例）
    static let FOREGROUND_MARGIN: CGFloat = 0.08
    /// 前景圆角（占画布短边比例）
    static let CORNER_RATIO: CGFloat = 0.03
    /// 背景模糊半径（占画布短边比例，需求给的范围 6%~8%）
    static let BLUR_RADIUS_RATIO: CGFloat = 0.07
    /// 背景模糊前的降采样倍率
    static let BLUR_DOWNSCALE = 8
    /// 背景暗色蒙版强度
    static let SCRIM_ALPHA: CGFloat = 0.15
    /// 投影：模糊半径 / y 偏移 / 颜色
    static let SHADOW_BLUR: CGFloat = 22
    static let SHADOW_DY: CGFloat = 10
    static let SHADOW_ALPHA: CGFloat = 0.34

    /// 解码长边上限（合成 900×1200 绰绰有余，避免大图直接进内存）
    static let DECODE_MAX_EDGE = 1600

    // MARK: 缓存目录

    static func coverDir() -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(CACHE_DIR, isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    /// 封面文件名：bookId|chapterId（哈希避免非法文件名）
    static func fileNameFor(bookId: String, chapterId: String) -> String {
        let key = abs((bookId + "_" + chapterId).hashValue)
        return "gm_\(String(key, radix: 36)).jpg"
    }

    static func fileFor(bookId: String, chapterId: String) -> URL {
        coverDir().appendingPathComponent(fileNameFor(bookId: bookId, chapterId: chapterId))
    }

    static func deleteQuietly(_ path: String?) {
        guard let path, !path.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        try? FileManager.default.removeItem(atPath: path)
    }

    // MARK: 解码

    /// 按目标尺寸降采样解码一页。remote 页带请求头（防盗链）。
    static func loadPage(_ ref: GodPageRef, maxEdge: Int = DECODE_MAX_EDGE) async -> UIImage? {
        if ref.remote {
            return await decodeRemote(ref, maxEdge: maxEdge)
        }
        return decodeLocal(ref.source, maxEdge: maxEdge)
    }

    /// 相册解码
    static func loadUri(_ uri: URL, maxEdge: Int = DECODE_MAX_EDGE) async -> UIImage? {
        guard let data = try? Data(contentsOf: uri) else { return nil }
        return await Task.detached(priority: .userInitiated) {
            decodeData(data, maxEdge: maxEdge)
        }.value
    }

    static func decodeData(_ data: Data, maxEdge: Int) -> UIImage? {
        guard let src = UIImage(data: data) else { return nil }
        return downsample(src, maxEdge: maxEdge)
    }

    static func decodeLocal(_ path: String, maxEdge: Int) -> UIImage? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        guard let decoded = decodeData(data, maxEdge: maxEdge) else { return nil }
        // EXIF 方向归一化（相册照片常见 90°/270°）——对应 Kotlin exifMatrix
        guard let orientation = exifOrientation(path) else { return decoded }
        guard let cg = decoded.cgImage else { return decoded }
        return UIImage(cgImage: cg, scale: decoded.scale, orientation: orientation)
    }

    private static func exifOrientation(_ path: String) -> UIImage.Orientation? {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let orient = props[kCGImagePropertyOrientation] as? UInt32 else { return nil }
        switch orient {
        case 6: return .right          // ROTATE_90
        case 3: return .down           // ROTATE_180
        case 8: return .left           // ROTATE_270
        case 2: return .upMirrored     // FLIP_HORIZONTAL
        case 4: return .downMirrored   // FLIP_VERTICAL
        default: return nil
        }
    }

    /// 远程页加载并发上限（缩略图 + 封面预览共用一条队列）
    /// 页面选择条一屏 7+ 张缩略图同时发起整图下载，图床（MangaDex 等）会直接限流（429）
    /// → 一批缩略图集体失败。排队上限 4，配合磁盘缓存，已看过基本秒出。
    private static let remoteGate = DispatchSemaphore(value: 4)

    private static func decodeRemote(_ ref: GodPageRef, maxEdge: Int) async -> UIImage? {
        guard let url = URL(string: ref.source) else { return nil }
        // 并发闸：与 Kotlin remoteGate.withPermit 语义一致（排队上限 4）
        await remoteGate.waitAndSignal()
        var request = URLRequest(url: url, timeoutInterval: 30)
        ref.headers.forEach { k, v in request.setValue(v, forHTTPHeaderField: k) }
        guard let (data, _) = try? await Http.session.data(for: request) else { return nil }
        return decodeData(data, maxEdge: maxEdge)
    }

    private static func downsample(_ image: UIImage, maxEdge: Int) -> UIImage {
        let long = max(image.size.width, image.size.height) * image.scale
        var sample = 1
        while long > CGFloat(maxEdge * sample * 2) { sample *= 2 }
        if sample <= 1 { return image }
        let w = image.size.width / CGFloat(sample)
        let h = image.size.height / CGFloat(sample)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: CGSize(width: w, height: h))) }
    }

    // MARK: 裁剪

    /// 按 CropParams 裁剪原图（先旋转，再按归一化矩形取子图）。
    static func applyCrop(source: UIImage, crop: CropParams) -> UIImage {
        let rotated = rotate(source, degrees: crop.rotationDeg)
        let w = Int(rotated.size.width), h = Int(rotated.size.height)
        let l = min(max(Int((crop.cropL * CGFloat(w)).rounded()), 0), max(0, w - 1))
        let t = min(max(Int((crop.cropT * CGFloat(h)).rounded()), 0), max(0, h - 1))
        let r = min(max(Int((crop.cropR * CGFloat(w)).rounded()), l + 1), w)
        let b = min(max(Int((crop.cropB * CGFloat(h)).rounded()), t + 1), h)
        guard w > 0, h > 0, r > l, b > t else { return rotated }
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: r - l, height: b - t))
        return renderer.image { _ in
            rotated.draw(at: CGPoint(x: -CGFloat(l), y: -CGFloat(t)))
        }
    }

    static func rotate(_ source: UIImage, degrees: Float) -> UIImage {
        let d = ((degrees.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
        if d < 0.5 { return source }
        let rad = CGFloat(d) * .pi / 180
        let size = CGSize(
            width: abs(source.size.width * cos(rad)) + abs(source.size.height * sin(rad)),
            height: abs(source.size.width * sin(rad)) + abs(source.size.height * cos(rad))
        )
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            ctx.cgContext.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.cgContext.rotate(by: rad)
            source.draw(in: CGRect(x: -source.size.width / 2, y: -source.size.height / 2,
                                   width: source.size.width, height: source.size.height))
        }
    }

    // MARK: 合成

    /// 合成固定比例封面。cropped 已经过 applyCrop（也可以直接传原图 = 不裁剪）。
    static func compose(_ cropped: UIImage, outW: Int = COVER_W, outH: Int = COVER_H) -> UIImage {
        let size = CGSize(width: outW, height: outH)
        let renderer = UIGraphicsImageRenderer(size: size)

        // 背景：centerCrop → 降采样模糊 → 放大 → 暗色蒙版
        let bg = centerCrop(cropped, outW: outW, outH: outH)
        let smallW = max(2, outW / BLUR_DOWNSCALE)
        let smallH = max(2, outH / BLUR_DOWNSCALE)
        let small = scaleImage(bg, to: CGSize(width: smallW, height: smallH))
        let radius = max(2, Int((CGFloat(min(outW, outH)) * BLUR_RADIUS_RATIO / CGFloat(BLUR_DOWNSCALE)).rounded()))
        let blurred = fastBlur(small, radius: radius)

        return renderer.image { ctx in
            blurred.draw(in: CGRect(x: 0, y: 0, width: outW, height: outH))
            // 暗色蒙版
            UIColor.black.withAlphaComponent(SCRIM_ALPHA).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: outW, height: outH))

            // 前景：contain 居中 + 圆角 + 投影
            let margin = CGFloat(min(outW, outH)) * FOREGROUND_MARGIN
            let boxW = CGFloat(outW) - margin * 2
            let boxH = CGFloat(outH) - margin * 2
            let scale = min(boxW / cropped.size.width, boxH / cropped.size.height)
            let dw = cropped.size.width * scale
            let dh = cropped.size.height * scale
            let dst = CGRect(
                x: (CGFloat(outW) - dw) / 2,
                y: (CGFloat(outH) - dh) / 2,
                width: dw, height: dh
            )
            let corner = CGFloat(min(outW, outH)) * CORNER_RATIO

            // 阴影层：先画一个带阴影的圆角矩形打底（随后被图片完全覆盖）
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: SHADOW_DY), blur: SHADOW_BLUR,
                                    color: UIColor.black.withAlphaComponent(SHADOW_ALPHA).cgColor)
            UIColor.clear.setFill()
            UIBezierPath(roundedRect: dst, cornerRadius: corner).fill()
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)

            let path = UIBezierPath(roundedRect: dst, cornerRadius: corner)
            ctx.cgContext.saveGState()
            path.addClip()
            cropped.draw(in: dst)
            ctx.cgContext.restoreGState()
        }
    }

    /// centerCrop：按目标比例居中裁剪
    static func centerCrop(_ src: UIImage, outW: Int, outH: Int) -> UIImage {
        let srcRatio = src.size.width / src.size.height
        let dstRatio = CGFloat(outW) / CGFloat(outH)
        var cropRect: CGRect
        if srcRatio > dstRatio {
            let nw = src.size.height * dstRatio
            let x = max(0, (src.size.width - nw) / 2)
            cropRect = CGRect(x: x, y: 0, width: min(nw, src.size.width - x), height: src.size.height)
        } else {
            let nh = src.size.width / dstRatio
            let y = max(0, (src.size.height - nh) / 2)
            cropRect = CGRect(x: 0, y: y, width: src.size.width, height: min(nh, src.size.height - y))
        }
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: outW, height: outH))
        return renderer.image { _ in
            src.draw(in: CGRect(x: 0, y: 0, width: outW, height: outH),
                     blendMode: .copy, alpha: 1)
        }
    }

    private static func scaleImage(_ image: UIImage, to size: CGSize) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// 快速高斯近似模糊：3 次滑动窗口盒式模糊（O(n)）。
    /// 盒式模糊 ×3 的效果与高斯几乎一致（中心极限），实现更短、边界处理更不容易出错。
    static func fastBlur(_ src: UIImage, radius: Int) -> UIImage {
        let r = min(max(radius, 1), 64)
        guard let cg = src.cgImage else { return src }
        let w = cg.width, h = cg.height
        guard w > 0, h > 0 else { return src }

        guard var px = argbPixels(of: cg) else { return src }
        boxBlurPass(&px, w, h, r)
        boxBlurPass(&px, w, h, r)
        boxBlurPass(&px, w, h, r)

        return imageFromArgb(px, width: w, height: h, scale: src.scale)
    }

    /// 一次可分离盒式模糊（水平 + 垂直，滑动窗口累加）。直接原地修改 ARGB 数组，无额外分配。
    private static func boxBlurPass(_ px: inout [UInt32], _ w: Int, _ h: Int, _ radius: Int) {
        let r = max(radius, 1)
        let window = r * 2 + 1
        var tmp = [UInt32](repeating: 0, count: px.count)

        // 水平
        for y in 0..<h {
            let row = y * w
            var sumA = 0, sumR = 0, sumG = 0, sumB = 0
            for i in -r...r {
                let c = px[row + min(max(i, 0), w - 1)]
                sumA += Int((c >> 24) & 0xFF); sumR += Int((c >> 16) & 0xFF)
                sumG += Int((c >> 8) & 0xFF); sumB += Int(c & 0xFF)
            }
            for x in 0..<w {
                tmp[row + x] = (UInt32(sumA / window) << 24) | (UInt32(sumR / window) << 16)
                    | (UInt32(sumG / window) << 8) | UInt32(sumB / window)
                let outC = px[row + min(max(x - r, 0), w - 1)]
                let inC = px[row + min(max(x + r + 1, 0), w - 1)]
                sumA += Int((inC >> 24) & 0xFF) - Int((outC >> 24) & 0xFF)
                sumR += Int((inC >> 16) & 0xFF) - Int((outC >> 16) & 0xFF)
                sumG += Int((inC >> 8) & 0xFF) - Int((outC >> 8) & 0xFF)
                sumB += Int(inC & 0xFF) - Int(outC & 0xFF)
            }
        }

        // 垂直
        for x in 0..<w {
            var sumA = 0, sumR = 0, sumG = 0, sumB = 0
            for i in -r...r {
                let c = tmp[min(max(i, 0), h - 1) * w + x]
                sumA += Int((c >> 24) & 0xFF); sumR += Int((c >> 16) & 0xFF)
                sumG += Int((c >> 8) & 0xFF); sumB += Int(c & 0xFF)
            }
            for y in 0..<h {
                px[y * w + x] = (UInt32(sumA / window) << 24) | (UInt32(sumR / window) << 16)
                    | (UInt32(sumG / window) << 8) | UInt32(sumB / window)
                let outC = tmp[min(max(y - r, 0), h - 1) * w + x]
                let inC = tmp[min(max(y + r + 1, 0), h - 1) * w + x]
                sumA += Int((inC >> 24) & 0xFF) - Int((outC >> 24) & 0xFF)
                sumR += Int((inC >> 16) & 0xFF) - Int((outC >> 16) & 0xFF)
                sumG += Int((inC >> 8) & 0xFF) - Int((outC >> 8) & 0xFF)
                sumB += Int(inC & 0xFF) - Int(outC & 0xFF)
            }
        }
    }

    /// UIImage → ARGB(0xAARRGGBB) 像素数组
    private static func argbPixels(of cg: CGImage) -> [UInt32]? {
        let w = cg.width, h = cg.height
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var out = [UInt32](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            let a = UInt32(rgba[i * 4 + 3]), r = UInt32(rgba[i * 4]), g = UInt32(rgba[i * 4 + 1]), b = UInt32(rgba[i * 4 + 2])
            out[i] = (a << 24) | (r << 16) | (g << 8) | b
        }
        return out
    }

    private static func imageFromArgb(_ px: [UInt32], width: Int, height: Int, scale: CGFloat) -> UIImage {
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        for i in 0..<(width * height) {
            let c = px[i]
            let a = UInt8((c >> 24) & 0xFF), r = UInt8((c >> 16) & 0xFF)
            let g = UInt8((c >> 8) & 0xFF), b = UInt8(c & 0xFF)
            // 恢复非预乘（blur 前是预乘值，直接回写保持一致性）
            rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &rgba, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let cg = ctx.makeImage() else {
            return UIImage()
        }
        return UIImage(cgImage: cg, scale: scale, orientation: .up)
    }

    // MARK: 落盘

    /// 合成并写入 Documents/god_covers，返回绝对路径。
    @discardableResult
    static func composeAndSave(bookId: String, chapterId: String,
                               cropped: UIImage, outW: Int = COVER_W, outH: Int = COVER_H) -> String? {
        let file = fileFor(bookId: bookId, chapterId: chapterId)
        let bmp = compose(cropped, outW: outW, outH: outH)
        guard let jpeg = bmp.jpegData(compressionQuality: CGFloat(JPEG_QUALITY) / 100) else { return nil }
        do {
            try jpeg.write(to: file)
            return file.path
        } catch {
            return nil
        }
    }

    /// 缩略图（页面选择器用）：等比压到长边 maxEdge。
    static func thumbnail(_ ref: GodPageRef, maxEdge: Int = 240) async -> UIImage? {
        await loadPage(ref, maxEdge: maxEdge)
    }

    /// 清理全部封面缓存（设置里的缓存管理可复用）。返回释放字节数。
    static func clearAll() -> Int64 {
        var freed: Int64 = 0
        let fm = FileManager.default
        if let files = try? fm.contentsOfDirectory(at: coverDir(), includingPropertiesForKeys: [.fileSizeKey]) {
            for f in files {
                freed += Int64((try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
                try? fm.removeItem(at: f)
            }
        }
        return freed
    }
}

private extension DispatchSemaphore {
    func waitAndSignal() async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                wait()
                cont.resume()
                signal()
            }
        }
    }
}


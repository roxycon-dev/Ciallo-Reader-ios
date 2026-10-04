// 对齐 js/MxsSpacerPages.kt（32 行）
// MXS 有时会把白边切成一张独立的短 JPEG 放在章节开头。

import Foundation
import UIKit

/// 白边间隔页判定：宽 ≥300、高 ≤512 且高 < 宽/2，整页每像素都接近纯白。
func isMxsWhiteSpacer(_ bitmap: UIImage) -> Bool {
    let w = Int(bitmap.size.width), h = Int(bitmap.size.height)
    if w < 300 || h > 512 || h > w / 2 { return false }
    guard let cg = bitmap.cgImage else { return false }
    var rgba = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    for i in 0..<(w * h) {
        let a = rgba[i * 4 + 3]
        let r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
        if a != 0 && (r < 254 || g < 254 || b < 254) { return false }
    }
    return true
}

/// 剥掉章节开头的 MXS 白边间隔页（最多探测 3 张，有界前缀检查保证开章可预期；
/// 第一张真页由调用方在阅读器自己的缓存里预热）。
func stripLeadingMxsSpacers(_ urls: [String], load: (String) -> UIImage?) -> [String] {
    var skipped = 0
    for url in urls.prefix(3) {
        guard let bitmap = load(url) else { break }
        if !isMxsWhiteSpacer(bitmap) { break }
        skipped += 1
    }
    return Array(urls.dropFirst(skipped))
}

/// 异步版本（对应 Kotlin suspend load）。
func stripLeadingMxsSpacers(_ urls: [String], load: (String) async -> UIImage?) async -> [String] {
    var skipped = 0
    for url in urls.prefix(3) {
        guard let bitmap = await load(url) else { break }
        if !isMxsWhiteSpacer(bitmap) { break }
        skipped += 1
    }
    return Array(urls.dropFirst(skipped))
}

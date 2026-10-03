import SwiftUI
import UIKit
import ZIPFoundation

// MARK: - 小说内嵌图（ui/reader/NovelInlineImages.kt 对应物）
// TOKEN_REGEX 解析 `[IMG:epzip:file://书文件!包内条目|宽|高]` 与 `[IMG:file://路径|宽|高]`；
// epubImageRef 统一解码（预热/正文/全屏/保存共用）；解码失败显示明确错误。

enum NovelInlineImages {
    /// `[IMG:<uri>|宽|高]`
    static let tokenRegex = try? NSRegularExpression(pattern: #"\[IMG:([^\]]+)\|(\d+)\|(\d+)\]"#)

    struct ImageToken: Identifiable, Hashable {
        let uri: String
        let width: Int
        let height: Int
        var id: String { uri }
    }

    /// 正文切块：文本段 + 图片段（splitIntoBlocks）
    static func splitIntoBlocks(_ content: String) -> [Block] {
        var blocks: [Block] = []
        let ns = content as NSString
        guard let regex = tokenRegex else {
            return content.isEmpty ? [] : [.text(content)]
        }
        var cursor = 0
        let matches = regex.matches(in: content, options: [], range: NSRange(location: 0, length: ns.length))
        for m in matches {
            if m.range.location > cursor {
                let text = ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blocks.append(.text(text))
                }
            }
            let uri = ns.substring(with: m.range(at: 1))
            let w = Int(ns.substring(with: m.range(at: 2))) ?? 0
            let h = Int(ns.substring(with: m.range(at: 3))) ?? 0
            blocks.append(.image(ImageToken(uri: uri, width: w, height: h)))
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length {
            let text = ns.substring(from: cursor)
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blocks.append(.text(text))
            }
        }
        if blocks.isEmpty, !content.isEmpty { blocks.append(.text(content)) }
        return blocks
    }

    enum Block: Hashable {
        case text(String)
        case image(ImageToken)
    }

    /// 解析 epzip 引用：`epzip:file://书文件!包内条目` → (zipPath, entryPath)
    static func epubImageRef(_ uri: String) -> (bookPath: String, entry: String)? {
        guard uri.hasPrefix("epzip:file://") else { return nil }
        let body = String(uri.dropFirst("epzip:file://".count))
        guard let bang = body.firstIndex(of: "!") else { return nil }
        let bookPath = String(body[body.startIndex..<bang])
        let entry = String(body[body.index(after: bang)...])
        return (bookPath, entry)
    }

    /// 统一图片解码入口（预热/正文/全屏/保存共用）
    static func loadImageData(for uri: String) -> Data? {
        if let ref = epubImageRef(uri) {
            guard let archive = try? Archive(url: URL(fileURLWithPath: ref.bookPath), accessMode: .read),
                  let entry = archive.entries.first(where: { $0.path == ref.entry || $0.path.lowercased() == ref.entry.lowercased() }) else {
                return nil
            }
            return try? archive.extract(entry)
        }
        if uri.hasPrefix("file://") {
            let path = String(uri.dropFirst("file://".count))
            return try? Data(contentsOf: URL(fileURLWithPath: path))
        }
        if let url = URL(string: uri) {
            return try? Data(contentsOf: url)
        }
        return nil
    }
}

// MARK: 正文内嵌图视图

struct NovelInlineImageView: View {
    let token: NovelInlineImages.ImageToken
    let maxWidth: CGFloat
    @State private var image: UIImage? = nil
    @State private var failed = false
    @State private var showFullscreen = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: maxWidth)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .onTapGesture { showFullscreen = true }
            } else if failed {
                VStack(spacing: 4) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.system(size: 22))
                    Text("图片解码失败")
                        .font(.system(size: 11))
                }
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            } else {
                ShimmerBox(height: displayHeight, cornerRadius: 6)
            }
        }
        .frame(maxWidth: .infinity)
        .task(id: token.uri) {
            await decode()
        }
        .fullScreenCover(isPresented: $showFullscreen) {
            NovelImageFullscreen(token: token)
        }
    }

    private var displayHeight: CGFloat {
        guard token.width > 0, token.height > 0, maxWidth > 0 else { return 120 }
        return min(CGFloat(token.height) * (maxWidth / CGFloat(token.width)), 400)
    }

    private func decode() async {
        let data = await Task.detached(priority: .userInitiated) {
            NovelInlineImages.loadImageData(for: token.uri)
        }.value
        guard let data, let decoded = UIImage(data: data) else {
            failed = true
            return
        }
        image = decoded
    }
}

// MARK: 全屏查看 + 保存到相册（NovelImageFullscreen）

struct NovelImageFullscreen: View {
    let token: NovelInlineImages.ImageToken
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage? = nil
    @State private var failed = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .ignoresSafeArea()
            } else if failed {
                Text("图片解码失败")
                    .foregroundStyle(.white.opacity(0.7))
            }
            VStack {
                HStack {
                    AppIconButton(systemName: "xmark", tint: .white) { dismiss() }
                    Spacer()
                    AppIconButton(systemName: "square.and.arrow.down", tint: .white) { save() }
                }
                Spacer()
            }
            .padding()
        }
        .task {
            let data = await Task.detached(priority: .userInitiated) {
                NovelInlineImages.loadImageData(for: token.uri)
            }.value
            image = data.flatMap { UIImage(data: $0) }
            failed = image == nil
        }
    }

    private func save() {
        guard let image else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        AppToastCenter.shared.show("已保存到相册", kind: .success)
    }
}

import SwiftUI
import UIKit

// MARK: - 封面加载（GenericCoverLoader / ZLibraryCoverLoader 对应物）
// 在线封面带 Referer/Cookie；本地文件封面直接读；失败显示中性占位（不留白）。

struct BookCoverView: View {
    let cover: String?
    var cornerRadius: CGFloat = 8
    var referer: String? = nil

    @State private var image: UIImage? = nil
    @State private var failed = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.primary.opacity(0.06))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if failed {
                Image(systemName: "book.closed")
                    .font(.system(size: 24))
                    .foregroundStyle(.tertiary)
            } else {
                ShimmerBox(height: 0, cornerRadius: cornerRadius)
                    .padding(-4)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: cover) {
            await load()
        }
    }

    private func load() async {
        image = nil
        failed = false
        guard let cover, !cover.isEmpty else {
            failed = true
            return
        }
        if cover.hasPrefix("/") {
            image = UIImage(contentsOfFile: cover)
            failed = image == nil
            return
        }
        guard let url = URL(string: cover) else {
            failed = true
            return
        }
        // 神回/阅读器 Referer 防盗链：MangaDex 官方/镜像区分
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        if let referer { request.setValue(referer, forHTTPHeaderField: "Referer") }
        else if url.host?.contains("mangadex.org") == true { request.setValue(MangaDexSource.officialReferer, forHTTPHeaderField: "Referer") }
        else if url.host?.contains("mangadex.live") == true { request.setValue(MangaDexSource.mirrorReferer, forHTTPHeaderField: "Referer") }
        else if url.host?.contains("z-library") == true || url.host?.contains("zlib") == true || url.host?.contains("1lib") == true {
            let domain = url.host ?? ""
            let cookie = EncryptedCookieJar(scope: "zlib").cookieHeader(for: domain)
            if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
            request.setValue("https://\(domain)/", forHTTPHeaderField: "Referer")
        }
        do {
            let (data, response) = try await Http.session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                failed = true
                return
            }
            image = UIImage(data: data)
            failed = image == nil
        } catch {
            failed = true
        }
    }
}

// MARK: 漫画书卡（StaggeredComicCard 简化瀑布流）

struct LibraryBookCard: View {
    let title: String
    let author: String
    let cover: String?
    var sourceName: String? = nil
    var width: CGFloat = 110
    var referer: String? = nil
    var onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            BookCoverView(cover: cover, cornerRadius: 10, referer: referer)
                .frame(width: width, height: width * 1.4)
                .consistentShadow(radius: 6, y: 3, opacity: 0.14)
            Text(title)
                .font(.system(size: 12.5, weight: .medium))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(author.isEmpty ? (sourceName ?? "") : author)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: width)
        .contentShape(Rectangle())
        .onTapGesture {
            HapticsGate.light()
            onTap()
        }
    }
}

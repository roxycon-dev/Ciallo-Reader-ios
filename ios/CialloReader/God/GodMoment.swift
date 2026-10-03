import SwiftUI
import UIKit

// MARK: - 神回 GodMoment（god/ 包对应物）
// 末页拉拽状态机（GodPull）+ 自绘标记窗口（GodMomentSheet）+ 三种陈列排行榜（GodRanking）。
// 唯一索引 (bookId, chapterId)：同一话只有一个神回。

@MainActor
final class GodMomentRepository: ObservableObject {
    static let shared = GodMomentRepository()
    @Published private(set) var moments: [GodMomentEntity] = []
    private let db = AppDatabase.shared

    private init() {
        reload()
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    func reload() {
        moments = (try? db.godMoments()) ?? []
    }

    func upsert(_ g: GodMomentEntity) {
        try? db.upsertGodMoment(g)
        reload()
    }

    func moment(bookId: String, chapterId: String) -> GodMomentEntity? {
        (try? db.godMoment(bookId: bookId, chapterId: chapterId)) ?? nil
    }

    func delete(_ g: GodMomentEntity) {
        try? db.deleteGodMoment(id: g.id)
        if let path = g.coverPath { try? FileManager.default.removeItem(atPath: path) }
        reload()
    }
}

// MARK: - 末页拉拽浮层（GodPull：阻尼公式 (1 - 1/(raw·c/span + 1))·(span/c)，c=0.55）

struct GodPullOverlay: View {
    let progress: CGFloat
    let triggered: Bool
    @State private var showHint = false

    var body: some View {
        Group {
            if progress > 0.01 || triggered {
                VStack {
                    Spacer()
                    VStack(spacing: 8) {
                        // 双层光环 + 边缘刻度
                        ZStack {
                            Circle()
                                .stroke(AppColor.mintGold.opacity(0.5), lineWidth: 2)
                                .frame(width: 64 + progress * 30, height: 64 + progress * 30)
                            Circle()
                                .stroke(AppColor.mintGold.opacity(0.25), lineWidth: 5)
                                .frame(width: 78 + progress * 30, height: 78 + progress * 30)
                            Image(systemName: triggered ? "heart.fill" : "heart")
                                .font(.system(size: 26))
                                .foregroundStyle(AppColor.heartMid)
                        }
                        Text(triggered ? "松手标记神回" : "继续滑动 · 标记神回")
                            .font(.system(size: 12, weight: .medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(.regularMaterial))
                    }
                    .padding(.bottom, 130)
                    .opacity(Double(min(1, progress * 2)))
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: progress)
    }
}

/// 阻尼映射（GodPullState.dampened）
func godDampenedOffset(raw: CGFloat, span: CGFloat = 300) -> CGFloat {
    let c: CGFloat = 0.55
    if raw <= 0 { return 0 }
    return (1 - 1 / (raw * c / span + 1)) * (span / c)
}

// MARK: - 神回标记窗口（GodMomentSheet：占屏 92%、顶圆角 28、可下拉）

struct GodMomentSheet: View {
    let bookId: String
    let chapterId: String
    let bookTitle: String
    let chapterTitle: String
    let chapterNumber: Int
    var coverProvider: (() -> UIImage?)? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var appTheme
    @StateObject private var repo = GodMomentRepository.shared
    @State private var rating: Double = 0
    @State private var title: String = ""
    @State private var note: String = ""
    @State private var coverImage: UIImage? = nil
    @State private var existing: GodMomentEntity? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    // 章节语境标题
                    VStack(spacing: 4) {
                        Text("\(bookTitle)")
                            .font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                        Text("第 \(chapterNumber) 话 · \(chapterTitle)")
                            .font(.system(size: 17, weight: .bold)).lineLimit(2)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 6)

                    // 封面
                    ZStack {
                        if let coverImage {
                            Image(uiImage: coverImage)
                                .resizable().scaledToFill()
                                .frame(width: 160, height: 213)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .consistentShadow(radius: 12, y: 6, opacity: 0.25)
                        } else {
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color.primary.opacity(0.06))
                                .frame(width: 160, height: 213)
                                .overlay(Image(systemName: "photo").foregroundStyle(.tertiary))
                        }
                    }

                    // 评分：5 星 / 0.5 步长（GodStarRating）
                    HStack(spacing: 10) {
                        ForEach(1...5, id: \.self) { star in
                            Image(systemName: rating >= Double(star) ? "star.fill" : (rating >= Double(star) - 0.5 ? "star.leadinghalf.filled" : "star"))
                                .font(.system(size: 30))
                                .foregroundStyle(AppColor.mintGold)
                                .onTapGesture { location in
                                    // 半星：左半 0.5，右半 1
                                    HapticsGate.tick()
                                    let half = location.x < 16
                                    let value = Double(star) - (half ? 0.5 : 0)
                                    rating = rating == value ? 0 : value
                                }
                        }
                    }

                    // 命名
                    VStack(alignment: .leading, spacing: 6) {
                        sectionCard(title: "给它一个名字（可选）") {
                            TextField("例：那年夏天的回眸", text: $title)
                                .font(.system(size: 14))
                        }
                        sectionCard(title: "写点随笔（可选）") {
                            TextField("这一话神在哪？", text: $note, axis: .vertical)
                                .lineLimit(3...6)
                                .font(.system(size: 14))
                        }
                    }

                    HStack {
                        Text("「\(title.isEmpty ? chapterTitle : title)」 · \(String(format: "%.1f", rating)) 分")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                }
                .padding(DT.spLG)
            }
            .navigationTitle(existing == nil ? "标记神回" : "编辑神回")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .font(.system(size: 14, weight: .semibold))
                }
            }
        }
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
        .onAppear {
            existing = repo.moment(bookId: bookId, chapterId: chapterId)
            if let existing {
                rating = existing.rating
                title = existing.title
                note = existing.note
                if let path = existing.coverPath { coverImage = UIImage(contentsOfFile: path) }
            } else {
                coverImage = coverProvider?()
            }
        }
    }

    @ViewBuilder
    private func sectionCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: DT.rMD).fill(Color.primary.opacity(0.045)))
    }

    private func save() {
        guard rating > 0 else {
            AppToastCenter.shared.showError("先给这一话打个分吧")
            return
        }
        // 封面合成（GodCoverEngine：900×1200，JPEG 90，背景模糊 + 15% 暗蒙版）
        var coverPath: String? = existing?.coverPath
        if let source = coverImage {
            coverPath = GodCoverEngine.compose(source: source)
        }
        let entity = GodMomentEntity(
            id: existing?.id ?? 0,
            bookId: bookId, chapterId: chapterId,
            bookTitle: bookTitle, chapterTitle: chapterTitle,
            chapterNumber: chapterNumber,
            title: title.isEmpty ? chapterTitle : title,
            titleIsCustom: !title.isEmpty,
            rating: rating, note: note,
            coverPath: coverPath,
            coverSource: coverPath != nil ? "reader" : nil,
            createdAt: existing?.createdAt ?? Int64(Date().timeIntervalSince1970 * 1000))
        repo.upsert(entity)
        HapticsGate.success()
        AppToastCenter.shared.show("神回已标记 ⭐️\(String(format: "%.1f", rating))", kind: .success)
        dismiss()
    }
}

// MARK: - 封面合成引擎（GodCoverEngine：1/8 降采样 → 3 次盒式模糊 → 暗蒙版 → 前景 contain 圆角）

enum GodCoverEngine {
    static let coverWidth: CGFloat = 900
    static let coverHeight: CGFloat = 1200

    static func compose(source: UIImage, preview: Bool = false) -> String? {
        let size = preview ? CGSize(width: 450, height: 600) : CGSize(width: coverWidth, height: coverHeight)
        guard let bg = centerCrop(source, to: size),
              let blurred = boxBlur(bg, passes: 3, downsample: 8),
              let fg = containCrop(source, to: size) else { return nil }

        let renderer = UIGraphicsImageRenderer(size: size)
        let composed = renderer.image { ctx in
            blurred.draw(in: CGRect(origin: .zero, size: size))
            // 15% 暗色蒙版
            UIColor.black.withAlphaComponent(0.15).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            // 前景 contain 居中（8% 边距 + 圆角 3% 短边）
            let margin: CGFloat = size.width * 0.08
            let availW = size.width - margin * 2
            let availH = size.height - margin * 2
            let scale = min(availW / fg.size.width, availH / fg.size.height)
            let w = fg.size.width * scale, h = fg.size.height * scale
            let rect = CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
            let path = UIBezierPath(roundedRect: rect, cornerRadius: min(w, h) * 0.03)
            ctx.cgContext.saveGState()
            ctx.cgContext.addPath(path.cgPath)
            ctx.cgContext.clip()
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 6), blur: 18,
                                    color: UIColor.black.withAlphaComponent(0.4).cgColor)
            fg.draw(in: rect)
            ctx.cgContext.restoreGState()
        }
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("god_covers")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("god_\(UUID().uuidString).jpg")
        guard let jpeg = composed.jpegData(compressionQuality: 0.9) else { return nil }
        try? jpeg.write(to: file)
        return file.path
    }

    private static func centerCrop(_ image: UIImage, to size: CGSize) -> UIImage? {
        let scale = max(size.width / image.size.width, size.height / image.size.height)
        let w = image.size.width * scale, h = image.size.height * scale
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            image.draw(in: CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h))
        }
    }

    private static func containCrop(_ image: UIImage, to size: CGSize) -> UIImage { image }

    /// 1/8 降采样 → N 次盒式模糊（中心极限逼近高斯，全系统一致）
    private static func boxBlur(_ image: UIImage, passes: Int, downsample: Int) -> UIImage? {
        let small = CGSize(width: image.size.width / CGFloat(downsample), height: image.size.height / CGFloat(downsample))
        let downsampler = UIGraphicsImageRenderer(size: small)
        let smallImg = downsampler.image { _ in image.draw(in: CGRect(origin: .zero, size: small)) }
        guard let cg = smallImg.cgImage else { return nil }
        var result = cg
        for _ in 0..<passes {
            result = boxBlurOnce(result) ?? result
        }
        let out = UIGraphicsImageRenderer(size: CGSize(width: image.size.width, height: image.size.height))
        return out.image { _ in
            UIImage(cgImage: result).draw(in: CGRect(origin: .zero, size: image.size))
        }
    }

    private static func boxBlurOnce(_ input: CGImage) -> CGImage? {
        let w = input.width, h = input.height
        guard let inData = input.dataProvider?.data, let ptr = CFDataGetBytePtr(inData) else { return nil }
        let bytesPerRow = input.bytesPerRow
        var outData = Data(count: CFDataGetLength(inData))
        outData.withUnsafeMutableBytes { outPtr in
            let dst = outPtr.bindMemory(to: UInt8.self)
            let src = ptr
            for y in 0..<h {
                for x in 0..<w {
                    var r = 0, g = 0, b = 0, n = 0
                    for dy in -1...1 {
                        for dx in -1...1 {
                            let nx = min(max(x + dx, 0), w - 1)
                            let ny = min(max(y + dy, 0), h - 1)
                            let off = ny * bytesPerRow + nx * 4
                            r += Int(src[off]); g += Int(src[off + 1]); b += Int(src[off + 2]); n += 1
                        }
                    }
                    let off = y * bytesPerRow + x * 4
                    dst[off] = UInt8(r / n); dst[off + 1] = UInt8(g / n); dst[off + 2] = UInt8(b / n)
                    dst[off + 3] = 255
                }
            }
        }
        return CGImage(width: w, height: h, bitsPerComponent: input.bitsPerComponent, bitsPerPixel: input.bitsPerPixel,
                       bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: CGDataProvider(data: outData as CFData)!, decode: nil, shouldInterpolate: false,
                       intent: .defaultIntent)
    }
}

// MARK: - 神回排行榜（GodRankingCard：领奖台 / 唱片架 / 照片墙）

enum GodRankingStyle: String, CaseIterable, Identifiable {
    case podium = "领奖台"
    case records = "唱片架"
    case photoWall = "照片墙"

    var id: String { rawValue }
}

struct GodRankingView: View {
    @StateObject private var repo = GodMomentRepository.shared
    @State private var style: GodRankingStyle = .podium
    @Environment(\.appTheme) private var appTheme

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // 卷首展签
                HStack(spacing: 16) {
                    stat("\(repo.moments.count)", "标记")
                    stat(String(format: "%.1f", repo.moments.map { $0.rating }.max() ?? 0), "最高评分")
                    stat(repo.moments.first?.title ?? "—", "榜首")
                }
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: DT.rLG).fill(Color.primary.opacity(0.045)))

                // 陈列方式切换（液态玻璃控件）
                SegmentedPillSelector(options: GodRankingStyle.allCases, label: { $0.rawValue }, selection: $style)

                switch style {
                case .podium: podium
                case .records: records
                case .photoWall: photoWall
                }
            }
            .padding(DT.spPage)
        }
        .background(Color(.systemBackground))
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 16, weight: .bold)).lineLimit(1)
            Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // 领奖台：第 2 / 1 / 3 名高低台座 + 其余精简行
    private var podium: some View {
        let top3 = Array(repo.moments.prefix(3))
        let ordered: [GodMomentEntity?] = top3.count >= 3 ? [top3[1], top3[0], top3[2]] : top3.map { Optional($0) }
        return VStack(spacing: 14) {
            HStack(alignment: .bottom, spacing: 10) {
                ForEach(Array(ordered.enumerated()), id: \.offset) { index, moment in
                    if let moment {
                        podiumColumn(moment, rank: index == 0 ? 2 : (index == 1 ? 1 : 3))
                    } else {
                        Color.clear.frame(width: 90, height: 120)
                    }
                }
            }
            if repo.moments.count > 3 {
                ForEach(Array(repo.moments.dropFirst(3).enumerated()), id: \.offset) { index, moment in
                    row(moment, rank: index + 4)
                }
            }
        }
    }

    private func podiumColumn(_ moment: GodMomentEntity, rank: Int) -> some View {
        let heights: [CGFloat: CGFloat] = [1: 150, 2: 122, 3: 104]
        return VStack(spacing: 6) {
            GodCoverImage(moment: moment, size: 78)
            Text(moment.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
            Text("⭐️ \(String(format: "%.1f", moment.rating))").font(.system(size: 10)).foregroundStyle(AppColor.mintGold)
            // 台座（数字随台阶高度缩放：compact 19pt）
            RoundedRectangle(cornerRadius: 6)
                .fill(LinearGradient(colors: [appTheme.primary.opacity(0.25), appTheme.primary.opacity(0.1)], startPoint: .top, endPoint: .bottom))
                .frame(width: 84, height: heights[CGFloat(rank)] ?? 100)
                .overlay(Text("\(rank)").font(.system(size: rank == 1 ? 26 : 19, weight: .heavy)).foregroundStyle(appTheme.primary))
        }
    }

    // 唱片架：居中套封与唱片的横向翻阅
    private var records: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                ForEach(repo.moments) { moment in
                    VStack(spacing: 8) {
                        ZStack {
                            Circle()
                                .fill(LinearGradient(colors: [.black, Color(hex: 0x333)], startPoint: .top, endPoint: .bottom))
                                .frame(width: 96, height: 96)
                                .overlay(
                                    Circle().stroke(AppColor.mintGold.opacity(0.5), lineWidth: 1)
                                        .frame(width: 30, height: 30)
                                )
                            GodCoverImage(moment: moment, size: 82)
                                .clipShape(Circle())
                        }
                        Text(moment.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
                        Text(moment.bookTitle).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(width: 110)
                }
            }
            .padding(.horizontal, DT.spPage)
        }
    }

    // 照片墙：暖纸底双列相纸
    private var photoWall: some View {
        let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        return LazyVGrid(columns: columns, spacing: 12) {
            ForEach(Array(repo.moments.enumerated()), id: \.offset) { index, moment in
                VStack(alignment: .leading, spacing: 6) {
                    GodCoverImage(moment: moment, size: 140)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(moment.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    Text("第 \(moment.chapterNumber) 话 · ⭐️\(String(format: "%.1f", moment.rating))")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0xFBF6EC)))
                .rotationEffect(.degrees(index % 2 == 0 ? -0.8 : 0.8))
            }
        }
    }

    private func row(_ moment: GodMomentEntity, rank: Int) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)").font(.system(size: 14, weight: .bold)).foregroundStyle(appTheme.primary)
            GodCoverImage(moment: moment, size: 40)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(moment.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                Text(moment.bookTitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Text("⭐️\(String(format: "%.1f", moment.rating))")
                .font(.system(size: 12)).foregroundStyle(AppColor.mintGold)
        }
    }
}

/// 神回封面（解码等待/失败保留中性占位；key 含 updatedAt）
struct GodCoverImage: View {
    let moment: GodMomentEntity
    var size: CGFloat

    var body: some View {
        Group {
            if let path = moment.coverPath, let ui = UIImage(contentsOfFile: path) {
                Image(uiImage: ui).resizable().scaledToFill()
            } else {
                ZStack {
                    Rectangle().fill(Color.primary.opacity(0.07))
                    Image(systemName: "sparkles").foregroundStyle(.tertiary)
                }
            }
        }
        .frame(width: size, height: size * 4 / 3)
        .id(moment.updatedAt)
    }
}

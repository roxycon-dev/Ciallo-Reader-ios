import SwiftUI
import UIKit

// MARK: - 神回 GodMoment（god/ 包对应物）
// 末页拉拽状态机（GodPull）+ 自绘标记窗口（GodMomentSheet）+ 三种陈列排行榜（GodRanking）。
// 唯一索引 (bookId, chapterId)：同一话只有一个神回。

// 末页拉拽浮层与阻尼状态机已对齐至 GodPull.swift

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
                rating = Double(existing.rating)
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
            coverPath = GodCoverEngine.composeAndSave(bookId: bookId, chapterId: chapterId, cropped: source)
        }
        let entity = GodMomentEntity(
            id: existing?.id ?? 0,
            bookId: bookId, chapterId: chapterId,
            bookTitle: bookTitle, chapterTitle: chapterTitle,
            chapterNumber: chapterNumber,
            title: title.isEmpty ? chapterTitle : title,
            titleIsCustom: !title.isEmpty,
            rating: Float(rating), note: note,
            coverPath: coverPath,
            coverSource: (existing?.coverSource) ?? CoverSource.comicDefault().toTag,
            cropParams: (existing?.cropParams) ?? CropParams.DEFAULT.toTag,
            createdAt: existing?.createdAt ?? Int64(Date().timeIntervalSince1970 * 1000),
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000))
        repo.save(entity)
        HapticsGate.success()
        AppToastCenter.shared.show("神回已标记 ⭐️\(String(format: "%.1f", rating))", kind: .success)
        dismiss()
    }
}


// MARK: - 神回排行榜（GodRankingCard：领奖台 / 唱片架 / 照片墙）


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
                case .vinylShelf: records
                case .polaroidWall: photoWall
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

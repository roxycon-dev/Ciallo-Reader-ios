import SwiftUI
import UIKit

// MARK: - 本地/在线漫画阅读器（ComicReaderCore + OnlineComicReaderScreen 对应物）
// 翻页（LTR/RTL）+ 条漫/无缝 + 缩放手势 + 设置面板 + 章节边界手势 + 末页神回拉拽（GodPull）。
// 五模式 × 适配；页面加载多级缓存；进度实时写库。

struct ComicReaderScreen: View {
    let book: Book

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ComicReaderModel

    init(book: Book) {
        self.book = book
        _model = StateObject(wrappedValue: ComicReaderModel.local(book: book))
    }

    var body: some View {
        ComicReaderCore(model: model, onExit: {
            model.saveProgressNow()
            dismiss()
        })
    }
}

/// 在线漫画阅读入口（OnlineComicReaderScreen 对应物）
struct OnlineComicReaderScreen: View {
    let source: BookSource
    let comicId: String
    let title: String

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ComicReaderModel

    init(source: BookSource, comicId: String, title: String, startChapterId: String? = nil) {
        self.source = source
        self.comicId = comicId
        self.title = title
        _model = StateObject(wrappedValue: ComicReaderModel.online(source: source, comicId: comicId, title: title, startChapterId: startChapterId))
    }

    var body: some View {
        ComicReaderCore(model: model, onExit: {
            model.saveProgressNow()
            dismiss()
        })
    }
}

// MARK: - 阅读核心（统一本地与在线）

struct ComicReaderCore: View {
    @StateObject var model: ComicReaderModel
    var onExit: () -> Void

    @Environment(\.appTheme) private var appTheme
    @StateObject private var settings = ComicSettingsStore.shared
    @State private var pageIndex = 0
    @State private var chrome = true
    @State private var showChapters = false
    @State private var showSettings = false
    @State private var godPullProgress: CGFloat = 0
    @State private var godTriggered = false
    @State private var scale: CGFloat = 1
    // 卷页驱动（CurlMesh 圆柱投影条带渲染）
    @State private var curlT: CGFloat = 0
    @State private var curlActive = false
    @State private var curlBase = 0
    @State private var curlNext = 0
    @State private var curlFront: UIImage? = nil
    @State private var curlBeneath: UIImage? = nil

    var config: ComicReaderConfig { settings.config(for: model.bookKey) }

    var body: some View {
        ZStack {
            background
            if model.loading {
                VStack(spacing: 12) {
                    ChasingDots(color: .white.opacity(0.8))
                    Text(model.loadingText).font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                }
            } else if model.images.isEmpty {
                VStack(spacing: 10) {
                    Text("本章暂无内容").foregroundStyle(.white.opacity(0.7)).font(.system(size: 14))
                    Button("重试") { model.reloadChapter() }
                        .foregroundStyle(.white)
                }
            } else if config.mode.isVertical {
                verticalReader
            } else {
                pagedReader
            }

            // 末页神回拉拽浮层
            GodPullOverlay(progress: godPullProgress, triggered: godTriggered)

            if chrome {
                ComicTopBar(title: model.title, chapter: model.chapterTitle,
                            onBack: onExit, onChapters: { showChapters = true },
                            onSettings: { showSettings = true })
                ComicBottomBar(page: pageIndex, count: model.images.count,
                               onPrevChapter: { model.prevChapter() },
                               onNextChapter: { model.nextChapter() })
            }
        }
        .statusBar(hidden: !chrome)
        .onTapGesture { withAnimation(AppMotion.springDefault) { chrome.toggle() } }
        .task { await model.bootstrap() }
        .onDisappear { model.saveProgressNow() }
        .sheet(isPresented: $showChapters) {
            ComicChaptersSheet(model: model)
        }
        .sheet(isPresented: $showSettings) {
            ComicSettingsSheet(settings: settings, bookKey: model.bookKey)
        }
        .sheet(isPresented: $godTriggered) {
            GodMomentSheet(
                bookId: model.godBookId,
                chapterId: model.currentChapterId,
                bookTitle: model.title,
                chapterTitle: model.chapterTitle,
                chapterNumber: model.currentChapterIndex + 1,
                coverProvider: { model.currentImage() })
        }
    }

    private var background: some View {
        Group {
            switch config.background {
            case .black: Color.black
            case .paper: Color(hex: 0xF5EFE4)
            case .auto: Color.black.opacity(0.96)
            }
        }
        .ignoresSafeArea()
    }

    // MARK: 翻页模式（CurlMesh 圆柱投影条带卷页）

    private var pagedReader: some View {
        GeometryReader { geo in
            let rtl = config.mode == .pagedRtl
            ZStack {
                if curlActive, let front = curlFront {
                    CurlStripCanvas(front: front, beneath: curlBeneath, t: curlT, rtl: rtl)
                } else if pageIndex < model.images.count {
                    ComicPageView(image: model.images[pageIndex], fit: config.fit, scale: $scale)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 30)
                    .onChanged { value in
                        guard scale <= 1.01 else { return }   // 放大态不翻页
                        let w = max(geo.size.width, 1)
                        if !curlActive {
                            let forward = rtl ? value.translation.width > 0 : value.translation.width < 0
                            let target = forward ? pageIndex + 1 : pageIndex - 1
                            guard model.images.indices.contains(target) else { return } // 章节边界/神回交给 onEnded
                            curlBase = forward ? pageIndex : target
                            curlNext = forward ? target : pageIndex
                            curlFront = model.images[curlBase]
                            curlBeneath = model.images.indices.contains(curlNext) ? model.images[curlNext] : nil
                            curlT = forward ? 0 : 1
                            curlActive = true
                        }
                        // 沿前进方向的位移分量
                        let forwardDisp = rtl ? value.translation.width : -value.translation.width
                        let forwardPhase = curlBase == pageIndex
                        let raw = forwardPhase ? forwardDisp / w : 1 + forwardDisp / w
                        withAnimation(.linear(duration: 0.02)) {
                            curlT = min(max(raw, 0), 1)
                        }
                    }
                    .onEnded { value in
                        if !curlActive {
                            // 章节边界：末页前进方向拖拽 → 神回 / 下一话
                            let dx = value.translation.width
                            let forward = rtl ? dx > 60 : dx < -60
                            let backward = rtl ? dx < -60 : dx > 60
                            withAnimation(AppMotion.springSettle) {
                                if forward {
                                    if pageIndex + 1 >= model.images.count && canPullGod(dx: dx) {
                                        godTriggered = true
                                    } else {
                                        model.nextChapter()
                                    }
                                } else if backward {
                                    model.prevChapter()
                                }
                                scale = 1
                            }
                            return
                        }
                        // 过半推进，否则回卷（curlSyncPlan 相邻步进语义）
                        let commit = curlT > 0.5
                        withAnimation(AppMotion.springSettle) { curlT = commit ? 1 : 0 }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
                            pageIndex = commit ? curlNext : curlBase
                            curlActive = false
                            curlT = 0
                            curlFront = nil
                            curlBeneath = nil
                        }
                    }
            )
            .simultaneousGesture(MagnificationGesture()
                .onChanged { scale = max(1, min(4, $0)) }
                .onEnded { _ in withAnimation { scale = 1 } })
            .onChange(of: pageIndex) { newIndex in
                model.onPageChanged(page: newIndex)
            }
            .onChange(of: model.images.count) { _ in
                pageIndex = min(pageIndex, max(0, model.images.count - 1))
                model.restorePageIfPending { target in pageIndex = target }
            }
            .onAppear {
                model.restorePageIfPending { target in pageIndex = target }
            }
        }
    }

    /// 末页继续前进方向拖拽 → 喂神回状态机（ComicChapterEdgeGesture / GodPull 对应物）
    private func canPullGod(dx: CGFloat) -> Bool {
        let forward = config.mode == .pagedRtl ? dx > 0 : dx < 0
        return forward && pageIndex + 1 >= model.images.count
    }

    // MARK: 条漫 / 无缝

    private var verticalReader: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: config.mode == .continuous ? 0 : config.pageGap) {
                    ForEach(Array(model.images.enumerated()), id: \.offset) { index, image in
                        ComicPageView(image: image, fit: .fitWidth, scale: .constant(1))
                            .id(index)
                            .onAppear { model.onPageChanged(page: index) }
                    }
                    // 底部留白触发下一章
                    Color.clear.frame(height: 60)
                        .onAppear {
                            Task { await model.autoLoadNextChapter() }
                        }
                }
            }
            .onChange(of: model.images.count) { _ in
                model.restorePageIfPending { target in proxy.scrollTo(target, anchor: .top) }
            }
        }
    }
}

// MARK: - 单页

struct ComicPageView: View {
    let image: UIImage
    let fit: ComicFit
    @Binding var scale: CGFloat

    var body: some View {
        GeometryReader { geo in
            let size = fittedSize(in: geo.size)
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: size.width, height: size.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(scale)
                .animation(AppMotion.springDefault, value: scale)
        }
    }

    private func fittedSize(in container: CGSize) -> CGSize {
        guard image.size.width > 0, image.size.height > 0 else { return container }
        switch fit {
        case .fitWidth:
            let w = container.width
            return CGSize(width: w, height: w * image.size.height / image.size.width)
        case .fitScreen:
            let r = min(container.width / image.size.width, container.height / image.size.height)
            return CGSize(width: image.size.width * r, height: image.size.height * r)
        case .fitHeight:
            let h = container.height
            return CGSize(width: h * image.size.width / image.size.height, height: h)
        case .original:
            return image.size
        }
    }
}

// MARK: - 顶/底栏（ComicReaderChrome 对应物）

struct ComicTopBar: View {
    let title: String
    let chapter: String
    var onBack: () -> Void
    var onChapters: () -> Void
    var onSettings: () -> Void

    var body: some View {
        VStack {
            HStack {
                AppIconButton(systemName: "chevron.left", tint: .white) { onBack() }
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text(chapter).font(.system(size: 11)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                }
                Spacer()
                AppIconButton(systemName: "list.bullet", tint: .white) { onChapters() }
                AppIconButton(systemName: "slider.horizontal.3", tint: .white) { onSettings() }
            }
            .padding(.horizontal, 8)
            .padding(.top, 6)
            Spacer()
        }
        .background(
            LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
    }
}

struct ComicBottomBar: View {
    let page: Int
    let count: Int
    var onPrevChapter: () -> Void
    var onNextChapter: () -> Void

    var body: some View {
        VStack {
            Spacer()
            HStack(spacing: 16) {
                Button("上一话") { onPrevChapter() }
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.85))
                Spacer()
                Text("\(page + 1) / \(max(count, 1))")
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Spacer()
                Button("下一话") { onNextChapter() }
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.horizontal, DT.spLG)
            .padding(.vertical, 10)
            .background(
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea(edges: .bottom)
            )
        }
    }
}

// MARK: - 章节列表弹层（ComicChaptersScreen 弹层化）

struct ComicChaptersSheet: View {
    @ObservedObject var model: ComicReaderModel
    @Environment(\.appTheme) private var appTheme

    var body: some View {
        NavigationStack {
            List(model.orderedChapters) { chapter in
                Button {
                    model.jumpToChapter(chapter)
                } label: {
                    HStack {
                        Text(chapter.title)
                            .font(.system(size: 13.5))
                            .lineLimit(1)
                            .foregroundStyle(chapter.id == model.currentChapterId ? appTheme.primary : .primary)
                        Spacer()
                        if model.readChapterIds.contains(chapter.id) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 13))
                                .foregroundStyle(appTheme.primary.opacity(0.6))
                        }
                    }
                }
            }
            .navigationTitle("章节 · \(model.orderedChapters.count)")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - 漫画设置面板（ComicReaderSheets 六 Tab 收敛为单页）

struct ComicSettingsSheet: View {
    @ObservedObject var settings: ComicSettingsStore
    let bookKey: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var appTheme
    @State private var followGlobal = true
    @State private var draft = ComicReaderConfig()

    var body: some View {
        NavigationStack {
            Form {
                Section("阅读模式") {
                    Picker("模式", selection: $draft.mode) {
                        ForEach(ComicMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    Picker("适配", selection: $draft.fit) {
                        ForEach(ComicFit.allCases) { Text($0.rawValue).tag($0) }
                    }
                    if draft.mode == .webtoon {
                        Slider(value: $draft.pageGap, in: 0...24, step: 2) {
                            Text("页间距")
                        }
                    }
                    Picker("背景", selection: $draft.background) {
                        ForEach(ComicBgStyle.allCases) { Text($0.rawValue).tag($0) }
                    }
                }
                Section("行为") {
                    Toggle("保持屏幕常亮", isOn: $draft.keepScreenOn)
                    Toggle("条漫磁吸", isOn: $draft.magnetSnap)
                }
                Section {
                    Toggle("跟随全局（不为本书记忆）", isOn: $followGlobal)
                    if followGlobal {
                        Picker("应用预设", selection: $settings.activePreset) {
                            Text("日漫（RTL）").tag("preset_builtin_manga")
                            Text("条漫").tag("preset_builtin_webtoon")
                            Text("插页 LTR").tag("preset_builtin_novel_illu")
                        }
                        .onChange(of: settings.activePreset) { id in
                            settings.applyPreset(id)
                            draft = settings.global
                        }
                    }
                } footer: {
                    Text("与安卓版一致：预设迁移会保留每本书的独立配置。")
                }
            }
            .navigationTitle("漫画设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        settings.set(config: draft, for: bookKey, followGlobal: followGlobal)
                        dismiss()
                    }
                }
            }
            .onAppear { draft = settings.config(for: bookKey) }
        }
        .presentationDetents([.medium, .large])
    }
}

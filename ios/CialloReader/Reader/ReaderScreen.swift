import SwiftUI
import UIKit

// MARK: - 文字阅读器（ui/ReaderScreen.kt 对应物）
// 五档主题 + 五种翻页（仿真卷页/覆盖/平移/渐变/滚动）、目录/书签/全文搜索/TTS、
// 内嵌图片块、章节占位只显示加载状态、进度按 currentChapterIndex + page 实时保存。

struct ReaderScreen: View {
    let book: Book

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var appTheme
    @StateObject private var settings = ReaderSettings.shared
    @StateObject private var tts = TtsManager.shared
    @StateObject private var model: ReaderModel

    init(book: Book) {
        self.book = book
        _model = StateObject(wrappedValue: ReaderModel(book: book))
    }

    var body: some View {
        ZStack {
            // 阅读主题底色（自定义背景优先）
            readerBackground.ignoresSafeArea()

            if model.loadingChapter {
                VStack(spacing: 12) {
                    ChasingDots(color: settings.theme.foreground.opacity(0.6))
                    Text("加载中…").font(.system(size: 12)).foregroundStyle(settings.theme.foreground.opacity(0.5))
                }
            } else if model.pages.isEmpty {
                VStack(spacing: 10) {
                    Text("本章内容为空")
                        .font(.system(size: 14))
                        .foregroundStyle(settings.theme.foreground.opacity(0.6))
                    Button("重试") { model.reloadCurrentChapter() }
                        .font(.system(size: 13))
                }
            } else {
                ReaderPageTurnContainer(
                    mode: settings.pageTurn,
                    pageCount: model.pages.count,
                    pageIndex: $model.pageIndex,
                    theme: settings.theme,
                    pageContent: { index in
                        ReaderPageView(page: model.pages[index],
                                       settings: settings,
                                       availableWidth: model.lastPageSize.width)
                    }
                )
                .ignoresSafeArea()
            }

            // 顶部/底部 chrome
            if model.chromeVisible {
                topBar
                bottomBar
            }

            // TTS 条
            if tts.isPlaying || model.ttsActive {
                ttsBar
            }
        }
        .statusBar(hidden: model.chromeVisible == false)
        .onTapGesture { model.toggleChrome() }
        .task { await model.bootstrap() }
        .onDisappear { model.saveProgressNow(); model.flushSession(); TtsManager.shared.stop() }
        .background(
            GeometryReader { geo in
                Color.clear
                    .onAppear { model.updatePageSize(geo.size) }
                    .onChange(of: geo.size) { model.updatePageSize($0) }
            }
        )
        .sheet(isPresented: $model.showTOC) { tocSheet }
        .sheet(isPresented: $model.showBookmarks) { bookmarksSheet }
        .sheet(isPresented: $model.showSearch) { searchSheet }
        .sheet(isPresented: $model.showSettings) { readerSettingsSheet }
    }

    // MARK: 底色

    @ViewBuilder
    private var readerBackground: some View {
        if let bgPath = settings.customBackgroundPath, let ui = UIImage(contentsOfFile: bgPath) {
            Image(uiImage: ui).resizable().scaledToFill()
                .overlay(settings.theme.background.opacity(0.35))
        } else {
            settings.theme.background
        }
    }

    // MARK: Chrome

    private var topBar: some View {
        VStack {
            HStack {
                AppIconButton(systemName: "chevron.left") {
                    model.saveProgressNow()
                    dismiss()
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(book.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    Text(model.chapterTitle)
                        .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                AppIconButton(systemName: "text.magnifyingglass") { model.showSearch = true }
                AppIconButton(systemName: "speaker.wave.2") { model.toggleTTS() }
                AppIconButton(systemName: "slider.horizontal.3") { model.showSettings = true }
            }
            .padding(.horizontal, 8)
            .padding(.top, 6)
            .background(.thinMaterial)
            Spacer()
        }
    }

    private var bottomBar: some View {
        VStack {
            Spacer()
            VStack(spacing: 10) {
                HStack {
                    Text("\(model.pageIndex + 1) / \(max(model.pages.count, 1))")
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                    Spacer()
                    Text("\(model.currentChapterIndex + 1) / \(max(model.chapterCount, 1)) 章")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                Slider(value: Binding(
                    get: { Double(model.pageIndex) },
                    set: { model.pageIndex = Int($0) }
                ), in: 0...Double(max(model.pages.count - 1, 0)))
                .tint(appTheme.primary)
                HStack(spacing: 20) {
                    bottomButton("list.bullet", "目录") { model.showTOC = true }
                    bottomButton("bookmark", model.currentChapterBookmarked ? "bookmark.fill" : "bookmark") {
                        model.toggleBookmark()
                    }
                    bottomButton("square.on.square", "护眼") {
                        appTheme.eyeProtection.toggle()
                    }
                    bottomButton("sun.max", "亮度") {
                        model.brightnessSheet = true
                    }
                }
            }
            .padding(.horizontal, DT.spLG)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background(.thinMaterial)
        }
        .sheet(isPresented: $model.brightnessSheet) {
            VStack(spacing: 16) {
                Text("亮度").font(.system(size: 14, weight: .semibold))
                Slider(value: Binding(
                    get: { BrightnessController.shared.override ?? UIScreen.main.brightness },
                    set: { BrightnessController.shared.override = $0 }
                ), in: 0.05...1)
                .padding(.horizontal, 24)
            }
            .presentationDetents([.height(120)])
        }
    }

    private func bottomButton(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button {
            HapticsGate.light()
            action()
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 17))
                Text(label).font(.system(size: 10))
            }
            .foregroundStyle(.primary.opacity(0.8))
            .frame(maxWidth: .infinity)
        }
    }

    private var ttsBar: some View {
        VStack {
            Spacer()
            HStack(spacing: 16) {
                Image(systemName: "waveform")
                    .foregroundStyle(appTheme.primary)
                Text("TTS 朗读中 · 第 \(tts.currentParagraphIndex + 1) 段")
                    .font(.system(size: 12))
                Spacer()
                AppIconButton(systemName: "backward.end.fill", size: 14, padding: 8) { TtsManager.shared.previous() }
                AppIconButton(systemName: tts.isPlaying ? "pause.fill" : "play.fill", size: 14, padding: 8) {
                    if tts.isPlaying { TtsManager.shared.pause() } else { TtsManager.shared.resume() }
                }
                AppIconButton(systemName: "forward.end.fill", size: 14, padding: 8) { TtsManager.shared.next() }
                AppIconButton(systemName: "xmark", size: 14, padding: 8) {
                    model.ttsActive = false
                    TtsManager.shared.stop()
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: DT.rMD).fill(.regularMaterial))
            .padding(.horizontal, DT.spLG)
            .padding(.bottom, 84)
        }
    }

    // MARK: Sheets

    private var tocSheet: some View {
        NavigationStack {
            List(model.chapters) { chapter in
                Button {
                    model.jumpToChapter(order: chapter.chapterOrder)
                    model.showTOC = false
                } label: {
                    HStack {
                        Text(chapter.title)
                            .font(.system(size: 14))
                            .foregroundStyle(chapter.chapterOrder == model.currentChapterIndex ? appTheme.primary : .primary)
                            .lineLimit(1)
                        Spacer()
                        if model.loadedChapterSet.contains(chapter.chapterOrder) {
                            Circle().fill(appTheme.primary.opacity(0.4)).frame(width: 5, height: 5)
                        }
                    }
                }
            }
            .navigationTitle("目录 · \(model.chapterCount) 章")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private var bookmarksSheet: some View {
        NavigationStack {
            List {
                ForEach(model.bookmarks) { bm in
                    Button {
                        model.jumpToBookmark(bm)
                        model.showBookmarks = false
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(bm.title).font(.system(size: 14, weight: .medium))
                            Text(bm.snippet).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                }
                .onDelete { indexSet in
                    model.deleteBookmarks(at: indexSet)
                }
            }
            .navigationTitle("书签")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }

    private var searchSheet: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("搜索本书全文", text: $model.searchKeyword)
                        .submitLabel(.search)
                        .onSubmit { Task { await model.runSearch() } }
                    if model.searching { ProgressView() }
                }
                .padding(12)
                .background(Capsule().fill(Color.primary.opacity(0.06)))
                .padding(.horizontal, DT.spLG)
                List(model.searchResults, id: \.self) { item in
                    Button {
                        model.jumpToSearchResult(item)
                        model.showSearch = false
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.chapterTitle).font(.system(size: 13, weight: .medium))
                            Text(item.snippet).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                            Text("第 \(item.occurrence + 1) 处命中")
                                .font(.system(size: 10)).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .navigationTitle("书内搜索")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private var readerSettingsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 阅读主题（真实底色预览卡）
                    settingLabel("阅读主题")
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(ReaderTheme.presets) { preset in
                                let selected = settings.themeId == preset.id
                                Button {
                                    HapticsGate.tick()
                                    withAnimation(AppMotion.springDefault) { settings.themeId = preset.id }
                                } label: {
                                    VStack(spacing: 6) {
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(preset.background)
                                            .frame(width: 72, height: 48)
                                            .overlay(
                                                Text("文A")
                                                    .font(.system(size: 15, weight: .semibold))
                                                    .foregroundStyle(preset.foreground)
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 8)
                                                    .strokeBorder(selected ? appTheme.primary : .clear, lineWidth: 2)
                                            )
                                        Text(preset.name).font(.system(size: 11))
                                            .foregroundStyle(selected ? appTheme.primary : .secondary)
                                    }
                                }
                            }
                        }
                    }
                    settingLabel("字号 \(Int(settings.fontSize))")
                    Slider(value: $settings.fontSize, in: 12...32, step: 1).tint(appTheme.primary)
                    settingLabel("行距 \(String(format: "%.1f", settings.lineHeight))")
                    Slider(value: $settings.lineHeight, in: 1.0...2.4, step: 0.1).tint(appTheme.primary)
                    settingLabel("翻页方式")
                    ForEach(PageTurnType.allCases) { mode in
                        Button {
                            HapticsGate.tick()
                            settings.pageTurn = mode
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(mode.title).font(.system(size: 14, weight: .medium)).foregroundStyle(.primary)
                                    Text(mode.description).font(.system(size: 11)).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if settings.pageTurn == mode {
                                    Image(systemName: "checkmark").foregroundStyle(appTheme.primary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .padding(DT.spLG)
            }
            .navigationTitle("阅读设置")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func settingLabel(_ text: String) -> some View {
        Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
    }
}

// MARK: - 单页渲染（文本 + 内嵌图块）

struct ReaderPageView: View {
    let page: ReaderPage
    @ObservedObject var settings: ReaderSettings
    let availableWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(page.blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .text(let text):
                    Text(text.replacingOccurrences(of: "\\[IMG:[^\\]]*\\]", with: "", options: .regularExpression))
                        .font(.system(size: settings.fontSize))
                        .lineSpacing(max(0, UIFont.systemFont(ofSize: settings.fontSize).lineHeight * settings.lineHeight - UIFont.systemFont(ofSize: settings.fontSize).lineHeight))
                        .foregroundStyle(settings.theme.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .image(let token):
                    NovelInlineImageView(token: token, maxWidth: availableWidth > 0 ? availableWidth : 320)
                }
            }
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - 翻页容器（ui/pageturn/PageTurnContainer.kt 对应物）
// SIMULATE：2D 圆柱投影卷页（视觉同源）；COVER：推开；SLIDE：平移；FADE：淡入；SCROLL：纵滚。

struct ReaderPageTurnContainer<Page: View>: View {
    let mode: PageTurnType
    let pageCount: Int
    @Binding var pageIndex: Int
    let theme: ReaderTheme
    @ViewBuilder let pageContent: (Int) -> Page

    // 仿真卷页驱动（GL 纹理信箱的对应物：起手快照、拖拽喂 t、松手结算）
    @State private var curlT: CGFloat = 0
    @State private var curlActive = false
    @State private var curlBase = 0
    @State private var curlNext = 0
    @State private var curlFront: UIImage? = nil
    @State private var curlBeneath: UIImage? = nil

    var body: some View {
        Group {
            switch mode {
            case .scroll:
                scrollLayout
            case .simulate:
                simulateLayout
            default:
                gestureLayout
            }
        }
    }

    // MARK: 仿真卷页（CurlMesh 圆柱投影条带渲染）

    private var simulateLayout: some View {
        GeometryReader { geo in
            ZStack {
                if curlActive, let front = curlFront {
                    CurlStripCanvas(front: front, beneath: curlBeneath, t: curlT, rtl: false)
                } else {
                    pageContent(pageIndex)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 24)
                    .onChanged { value in
                        let w = max(geo.size.width, 1)
                        if !curlActive {
                            // 起手：判定方向并快照当前/目标页
                            let forward = value.translation.width < 0
                            let target = forward ? pageIndex + 1 : pageIndex - 1
                            guard target >= 0, target < pageCount else { return }
                            curlBase = forward ? pageIndex : target
                            curlNext = forward ? target : pageIndex
                            curlFront = PageSnapshotRenderer.render(pageContent(curlBase), size: geo.size)
                            curlBeneath = PageSnapshotRenderer.render(pageContent(curlNext), size: geo.size)
                            curlT = forward ? 0 : 1
                            curlActive = true
                        }
                        let forwardDrag = curlBase == pageIndex
                        let raw = forwardDrag
                            ? -value.translation.width / w
                            : 1 - value.translation.width / w
                        withAnimation(.linear(duration: 0.02)) {
                            curlT = min(max(raw, 0), 1)
                        }
                    }
                    .onEnded { _ in
                        guard curlActive else { return }
                        // 过半推进，否则回卷（同安卓 curlSyncPlan 的相邻步进语义）
                        let commit = curlT > 0.5
                        let endT: CGFloat = commit ? 1 : 0
                        withAnimation(AppMotion.springSettle) { curlT = endT }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
                            pageIndex = commit ? curlNext : curlBase
                            curlActive = false
                            curlT = 0
                            curlFront = nil
                            curlBeneath = nil
                        }
                    }
            )
            .overlay(
                HStack(spacing: 0) {
                    Color.clear.contentShape(Rectangle())
                        .onTapGesture { withAnimation(AppMotion.springDefault) { if pageIndex > 0 { pageIndex -= 1 } } }
                    Color.clear.contentShape(Rectangle())
                    Color.clear.contentShape(Rectangle())
                        .onTapGesture { withAnimation(AppMotion.springDefault) { if pageIndex + 1 < pageCount { pageIndex += 1 } } }
                }
            )
        }
    }

    private var scrollLayout: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 24) {
                    ForEach(0..<max(pageCount, 1), id: \.self) { index in
                        pageContent(index)
                            .id(index)
                    }
                }
            }
            .onChange(of: pageIndex) { newIndex in
                withAnimation { proxy.scrollTo(newIndex, anchor: .top) }
            }
        }
    }

    private var gestureLayout: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let progress = min(1, max(0, abs(drag) / max(w, 1)))
            ZStack {
                // 当前页
                pageContent(pageIndex)
                    .modifier(PageTransform(mode: mode, progress: direction < 0 ? progress : 0, width: w, isCurrent: true))
                // 下一页 / 上一页
                if direction < 0, pageIndex + 1 < pageCount {
                    pageContent(pageIndex + 1)
                        .modifier(PageTransform(mode: mode, progress: 1 - progress, width: w, isCurrent: false))
                } else if direction > 0, pageIndex - 1 >= 0 {
                    pageContent(pageIndex - 1)
                        .modifier(PageTransform(mode: mode, progress: 1 - progress, width: w, isCurrent: false, fromLeft: true))
                }
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 24, coordinateSpace: .local)
                    .updating($drag) { value, state, _ in
                        state = value.translation.width
                        if abs(value.translation.width) > abs(value.predictedEndTranslation.width - value.translation.width) {
                            // 保持直觉方向
                        }
                    }
                    .onChanged { value in
                        if direction == 0 {
                            direction = value.translation.width < 0 ? -1 : 1
                        }
                    }
                    .onEnded { value in
                        let threshold = w * 0.3
                        withAnimation(AppMotion.springSettle) {
                            if direction < 0, -value.translation.width > threshold, pageIndex + 1 < pageCount {
                                pageIndex += 1
                            } else if direction > 0, value.translation.width > threshold, pageIndex - 1 >= 0 {
                                pageIndex -= 1
                            }
                            direction = 0
                        }
                    }
            )
            // 点击分区翻页（左 1/3 上一页，右 1/3 下一页）
            .overlay(
                HStack(spacing: 0) {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { withAnimation(AppMotion.springDefault) { if pageIndex > 0 { pageIndex -= 1; direction = 1 } } }
                    Color.clear.contentShape(Rectangle())
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { withAnimation(AppMotion.springDefault) { if pageIndex + 1 < pageCount { pageIndex += 1; direction = -1 } } }
                }
                .allowsHitTesting(true)
            )
        }
    }
}

/// 翻页变换：SLIDE 平移 / FADE 透明 / COVER 上层推开 / SIMULATE 2D 卷页
struct PageTransform: ViewModifier {
    let mode: PageTurnType
    let progress: CGFloat      // 0 = 完全在位；1 = 完全离场/入场前
    let width: CGFloat
    let isCurrent: Bool
    var fromLeft: Bool = false

    func body(content: Content) -> some View {
        let sign: CGFloat = fromLeft ? -1 : 1
        switch mode {
        case .slide:
            content
                .offset(x: sign * progress * width)
                .zIndex(isCurrent ? 1 : 2)
        case .fade:
            content
                .opacity(isCurrent ? 1 : (1 - progress))
                .zIndex(isCurrent ? 1 : 2)
        case .cover:
            if isCurrent {
                content.zIndex(1)
            } else {
                content
                    .offset(x: fromLeft ? -progress * width : progress * width)
                    .zIndex(2)
                    .consistentShadow(radius: 12, y: 0, opacity: Double(0.25 * (1 - progress)))
            }
        case .simulate:
            if isCurrent {
                content
                    .zIndex(1)
                    .modifier(CurlReveal(progress: fromLeft ? progress : 0, fromLeft: fromLeft, width: width))
            } else {
                content
                    .zIndex(2)
                    .modifier(CurlCurl(progress: 1 - progress, fromLeft: fromLeft, width: width))
            }
        default:
            content
        }
    }
}

/// 卷页：当前页被"卷走"的部分用渐变遮罩模拟圆柱投影（x′ = F + R·sin(s/R) 视觉近似）
struct CurlReveal: ViewModifier {
    let progress: CGFloat
    let fromLeft: Bool
    let width: CGFloat

    func body(content: Content) -> some View {
        let edge = width * progress
        content
            .mask(alignment: fromLeft ? .trailing : .leading) {
                Rectangle().frame(width: max(0, width - edge))
                    .frame(maxWidth: .infinity, alignment: fromLeft ? .trailing : .leading)
            }
            .overlay(alignment: fromLeft ? .leading : .trailing) {
                // 折缝阴影
                LinearGradient(colors: [.clear, .black.opacity(0.25)], startPoint: .center, endPoint: fromLeft ? .leading : .trailing)
                    .frame(width: 36)
                    .offset(x: fromLeft ? edge : -edge)
                    .opacity(progress > 0.01 ? 1 : 0)
            }
    }
}

struct CurlCurl: ViewModifier {
    let progress: CGFloat   // 0 = 隐藏, 1 = 完全展开
    let fromLeft: Bool
    let width: CGFloat

    func body(content: Content) -> some View {
        let edge = width * (1 - progress)
        content
            .clipShape(CurlPath(progress: progress, fromLeft: fromLeft, width: width))
            .offset(x: fromLeft ? -edge : edge)
            .consistentShadow(radius: 10, y: 0, opacity: Double(0.2 * progress))
    }
}

/// 卷页裁剪路径（圆柱投影近似：卷起的弧线用二次贝塞尔）
struct CurlPath: Shape {
    let progress: CGFloat
    let fromLeft: Bool
    let width: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let curl = rect.width * (1 - progress)
        let radius = min(80, rect.height * 0.25)
        if fromLeft {
            let x = curl
            p.move(to: CGPoint(x: x, y: 0))
            p.addLine(to: CGPoint(x: x, y: rect.height))
            p.addLine(to: CGPoint(x: x + radius, y: rect.height))
            p.addQuadCurve(to: CGPoint(x: x + radius * 0.4, y: rect.height / 2),
                           control: CGPoint(x: x + radius, y: rect.height - radius))
            p.addQuadCurve(to: CGPoint(x: x, y: 0),
                           control: CGPoint(x: x + radius * 0.4, y: radius))
        } else {
            let x = rect.width - curl
            p.move(to: CGPoint(x: x, y: 0))
            p.addLine(to: CGPoint(x: x, y: rect.height))
            p.addLine(to: CGPoint(x: x - radius, y: rect.height))
            p.addQuadCurve(to: CGPoint(x: x - radius * 0.4, y: rect.height / 2),
                           control: CGPoint(x: x - radius, y: rect.height - radius))
            p.addQuadCurve(to: CGPoint(x: x, y: 0),
                           control: CGPoint(x: x - radius * 0.4, y: radius))
        }
        p.closeSubpath()
        return p
    }
}

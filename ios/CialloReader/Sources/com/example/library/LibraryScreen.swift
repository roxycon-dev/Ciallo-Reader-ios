import SwiftUI

// MARK: - 书库页（ui/LibraryScreen.kt 对应物）
// 搜索框 + 分类（小说/漫画）+ 源选择 + 聚合分组结果 + 详情弹窗（登录/格式/下载）。

struct LibraryScreen: View {
    @ObservedObject var viewModel: LibraryViewModel
    @ObservedObject private var sourceManager = SourceManager.shared

    @State private var showSourcePicker = false
    @State private var detailBook: SearchBook? = nil
    @State private var detailSource: BookSource? = nil

    @Environment(\.appTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            header
            searchBar
            if viewModel.searching && viewModel.groups.isEmpty {
                Spacer()
                ChasingDots(color: theme.primary)
                Spacer()
            } else if viewModel.groups.isEmpty {
                Spacer()
                MascotEmptyState(
                    title: viewModel.keyword.isEmpty ? "搜索书库，发现好书" : "没有找到结果",
                    subtitle: viewModel.keyword.isEmpty ? "支持 Z-Library / MangaDex / Legado 书源 / Venera 漫画源聚合搜索" : "换个关键词或更换书源试试",
                    mood: .float)
                Spacer()
            } else {
                resultList
            }
        }
        .background(Color(.systemBackground))
        .sheet(item: $detailBook) { book in
            BookDetailSheet(book: book, source: detailSource ?? sourceManager.source(byId: book.sourceId))
        }
        .sheet(isPresented: $showSourcePicker) {
            SourcePickerSheet(viewModel: viewModel)
        }
    }

    private var header: some View {
        HStack {
            Text("书库")
                .font(.system(size: 26, weight: .bold))
            Spacer()
            Button {
                HapticsGate.light()
                showSourcePicker = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "square.grid.2x2")
                    Text(sourceLabel).lineLimit(1)
                }
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Capsule().fill(theme.primary.opacity(0.12)))
                .foregroundStyle(theme.primary)
            }
        }
        .padding(.horizontal, DT.spPage)
        .padding(.top, DT.spLG)
    }

    private var sourceLabel: String {
        if !viewModel.aggregateMode, let active = SourceManager.shared.activeSource {
            return active.name
        }
        return "聚合 (\(viewModel.sources.count)源)"
    }

    private var searchBar: some View {
        VStack(spacing: 8) {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("搜索书名 / 作者", text: $viewModel.keyword)
                    .submitLabel(.search)
                    .onSubmit { viewModel.runSearch() }
                if !viewModel.keyword.isEmpty {
                    Button { viewModel.keyword = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Capsule().fill(Color.primary.opacity(0.06)))

            Button {
                viewModel.runSearch()
            } label: {
                Image(systemName: "arrow.right.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(theme.primary)
            }
        }
        .padding(.horizontal, DT.spPage)
        .padding(.vertical, DT.spSM)

        // 分类切换
        HStack(spacing: 8) {
            ForEach(LibraryViewModel.SourceCategory.allCases, id: \.self) { cat in
                let selected = viewModel.category == cat
                Button {
                    HapticsGate.tick()
                    viewModel.category = cat
                } label: {
                    Text(cat.rawValue)
                        .font(.system(size: 13, weight: selected ? .semibold : .regular))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(selected ? theme.primary.opacity(0.14) : Color.primary.opacity(0.05)))
                        .foregroundStyle(selected ? theme.primary : .secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, DT.spPage)
        .padding(.bottom, DT.spSM)
        }
    }

    private var resultList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18, pinnedViews: []) {
                ForEach(viewModel.groups) { group in
                    aggregateGroup(group)
                }
            }
            .padding(.horizontal, DT.spPage)
            .padding(.bottom, 120)
        }
    }

    @ViewBuilder
    private func aggregateGroup(_ group: ComicAggregateSearch.Group) -> some View {
        if !group.books.isEmpty || group.loading {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    SourceAvatar(name: SourceManager.shared.source(byId: group.sourceId)?.name ?? group.sourceId, size: 24)
                    Text(SourceManager.shared.source(byId: group.sourceId)?.name ?? group.sourceId)
                        .font(.system(size: 14, weight: .semibold))
                    if group.loading {
                        ChasingDots(color: theme.primary.opacity(0.6), size: 14)
                    }
                    Spacer()
                    Text("\(group.books.count) 条")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
                if !group.books.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(group.books.prefix(12)) { book in
                                LibraryBookCard(
                                    title: book.title, author: book.author, cover: book.cover,
                                    sourceName: SourceManager.shared.source(byId: book.sourceId)?.name) {
                                    detailSource = SourceManager.shared.source(byId: book.sourceId)
                                    detailBook = book
                                }
                            }
                        }
                    }
                }
                if let error = group.error, group.books.isEmpty {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}

// MARK: - 源选择弹窗（SourcePickerSheet）

struct SourcePickerSheet: View {
    @ObservedObject var viewModel: LibraryViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme

    var body: some View {
        NavigationStack {
            List {
                Section("搜索方式") {
                    Button {
                        viewModel.aggregateMode = true
                        dismiss()
                    } label: {
                        HStack {
                            Text("聚合搜索（全部启用源）")
                            Spacer()
                            if viewModel.aggregateMode { Image(systemName: "checkmark").foregroundStyle(theme.primary) }
                        }
                    }
                }
                Section("书源") {
                    ForEach(viewModel.sources, id: \.id) { source in
                        Button {
                            SourceManager.shared.setActive(source.id)
                            viewModel.aggregateMode = false
                            dismiss()
                        } label: {
                            HStack(spacing: 10) {
                                SourceAvatar(name: source.name, size: 30)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(source.name).foregroundStyle(.primary)
                                    Text(source.capabilities.isComicSource ? "漫画源" : "小说源")
                                        .font(.system(size: 11)).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if !viewModel.aggregateMode && SourceManager.shared.activeSourceId == source.id {
                                    Image(systemName: "checkmark").foregroundStyle(theme.primary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("选择书源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - 书籍详情弹窗（NovelBookUi / ComicMetadataUi 对应物）

struct BookDetailSheet: View {
    let book: SearchBook
    let source: BookSource?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var detail: SearchBook?
    @State private var loading = true
    @State private var errorText: String?
    @State private var formats: [BookFormat] = []
    @State private var chapters: [ComicChapter] = []
    @State private var showLogin = false
    @State private var downloading = false
    @State private var favorited = false
    @State private var startReading = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 14) {
                        BookCoverView(cover: (detail ?? book).cover, cornerRadius: 12)
                            .frame(width: 110, height: 154)
                        VStack(alignment: .leading, spacing: 8) {
                            Text((detail ?? book).title)
                                .font(.system(size: 18, weight: .bold))
                                .lineLimit(3)
                            Text((detail ?? book).author)
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                            HStack(spacing: 6) {
                                if let lang = (detail ?? book).language {
                                    TagChip(text: lang)
                                }
                                if !formats.isEmpty {
                                    TagChip(text: formats.map { $0.format.uppercased() }.joined(separator: " / "))
                                } else {
                                    TagChip(text: (detail ?? book).format.uppercased())
                                }
                            }
                            if let size = (detail ?? book).size, size > 0 {
                                Text(BookRepository.formatSize(size))
                                    .font(.system(size: 11))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        Spacer()
                    }

                    if let errorText {
                        Text(errorText)
                            .font(.system(size: 13))
                            .foregroundStyle(.red)
                    }

                    if let desc = (detail ?? book).description, !desc.isEmpty {
                        Text(desc)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .lineSpacing(4)
                    }

                    // 漫画章节预览
                    if !chapters.isEmpty {
                        Text("章节 (\(chapters.count))")
                            .font(.system(size: 15, weight: .semibold))
                        Button {
                            HapticsGate.medium()
                            startReading = true
                        } label: {
                            Text("开始阅读")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 42)
                                .background(RoundedRectangle(cornerRadius: DT.rMD).fill(theme.primary.opacity(0.12)))
                                .foregroundStyle(theme.primary)
                        }
                        ForEach(chapters.prefix(30)) { chapter in
                            HStack {
                                Text(chapter.title).font(.system(size: 13)).lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 6)
                        }
                    }

                    // 操作区
                    HStack(spacing: 12) {
                        Button {
                            HapticsGate.medium()
                            downloading = true
                            Task { await download() }
                        } label: {
                            HStack {
                                if downloading { ProgressView().tint(.white) }
                                Text(downloading ? "下载中…" : "下载")
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: DT.rMD).fill(theme.primary))
                            .foregroundStyle(theme.primary.onColor())
                        }
                        Button {
                            HapticsGate.light()
                            Task { await toggleFavorite() }
                        } label: {
                            HeartArt(size: 22, filled: favorited)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .background(RoundedRectangle(cornerRadius: DT.rMD).fill(theme.primary.opacity(0.1)))
                        }
                    }
                    .padding(.top, 6)

                    if source?.capabilities.downloadRequiresLogin == true {
                        Button {
                            showLogin = true
                        } label: {
                            Label("登录 \(source?.name ?? "书源")", systemImage: "person.circle")
                                .font(.system(size: 13, weight: .medium))
                                .frame(maxWidth: .infinity)
                                .frame(height: 40)
                                .background(RoundedRectangle(cornerRadius: DT.rMD).fill(Color.primary.opacity(0.06)))
                        }
                    }
                }
                .padding(DT.spLG)
            }
            .navigationTitle(source?.name ?? "书籍详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .sheet(isPresented: $showLogin) {
            if let source { SourceLoginSheet(source: source) }
        }
        .fullScreenCover(isPresented: $startReading) {
            if let source, source is ComicSourceProtocol {
                OnlineComicReaderScreen(source: source, comicId: book.id,
                                        title: (detail ?? book).title)
            } else {
                Text("该源不支持在线阅读")
            }
        }
        .task {
            await loadDetail()
        }
    }

    private func loadDetail() async {
        loading = true
        defer { loading = false }
        guard let source else { return }
        let result = await source.getDetail(bookId: book.id)
        switch result {
        case .success(let d):
            detail = d
        case .error(let e):
            errorText = e.errorDescription
        }
        if source.capabilities.isComicSource, let comic = source as? ComicSourceProtocol {
            if case .success(let chs) = await comic.getChapters(bookId: book.id) {
                chapters = chs
            }
        }
        if case .success(let f) = await source.getAvailableFormats(book: detail ?? book) {
            formats = f
        }
        favorited = await FavoriteRepository.shared.isFavorited(sourceId: book.sourceId, comicId: book.id)
    }

    private func download() async {
        guard let source else { return }
        // 有多格式且用户可选：默认取第一个
        let format = formats.first?.format ?? (detail ?? book).format
        let info: SourceResult<DownloadInfo>
        if let first = formats.first, let id = first.eapiId, let hash = first.eapiHash {
            var d = (detail ?? book)
            d.eapiId = id
            d.eapiHash = hash
            d.format = first.format
            info = await source.getDownloadInfo(bookId: d.id)
        } else {
            info = await source.getDownloadInfo(bookId: (detail ?? book).id)
        }
        await MainActor.run { downloading = false }
        switch info {
        case .success(let di):
            await DownloadManager.shared.enqueueDownload(sourceId: source.id, book: detail ?? book,
                                                         format: di.format, downloadInfo: di)
        case .error(let e):
            AppToastCenter.shared.showError(e.errorDescription ?? "下载失败")
        }
    }

    private func toggleFavorite() async {
        if favorited {
            await FavoriteRepository.shared.remove(sourceId: book.sourceId, comicId: book.id)
            favorited = false
            AppToastCenter.shared.show("已取消喜欢")
        } else {
            let ok = await FavoriteRepository.shared.add(book: detail ?? book, source: source)
            favorited = ok
            if ok { AppToastCenter.shared.show("已加入「我喜欢的」", kind: .success) }
        }
    }
}

struct TagChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.primary.opacity(0.07)))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

// MARK: - 通用书源登录弹窗（LibraryLoginDialog 对应物：账号密码 / Cookie）

struct SourceLoginSheet: View {
    let source: BookSource
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var username = ""
    @State private var password = ""
    @State private var cookie = ""
    @State private var useCookie = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("登录方式", selection: $useCookie) {
                        Text("账号密码").tag(false)
                        Text("Cookie").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
                if useCookie {
                    Section("Cookie") {
                        TextField("粘贴完整 Cookie 字符串", text: $cookie, axis: .vertical)
                            .lineLimit(3...6)
                            .font(.system(size: 12, design: .monospaced))
                    }
                } else {
                    Section("账号") {
                        TextField("用户名 / 邮箱", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("密码", text: $password)
                    }
                }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            if busy { ProgressView() }
                            Text(busy ? "登录中…" : "登录")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(busy)
                } footer: {
                    if let url = source.registrationUrl {
                        Text("还没有账号？注册地址：\(url)")
                    }
                }
            }
            .navigationTitle("登录 \(source.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }

    private func submit() async {
        busy = true
        let credential = useCookie
            ? LoginCredential(cookie: cookie)
            : LoginCredential(username: username, password: password)
        let result = await source.login(credential: credential)
        busy = false
        switch result {
        case .success:
            HapticsGate.success()
            AppToastCenter.shared.show("登录成功", kind: .success)
            dismiss()
        case .error(let e):
            HapticsGate.error()
            AppToastCenter.shared.showError(e.errorDescription ?? "登录失败")
        }
    }
}

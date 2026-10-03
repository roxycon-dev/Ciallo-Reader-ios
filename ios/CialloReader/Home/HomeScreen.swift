import SwiftUI
import UniformTypeIdentifiers

// MARK: - 书架主页（ui/HomeScreen.kt 对应物）
// 同一滚动容器：正在阅读 → 我的书架（分类栏 + 网格）→ 我喜欢的 → 阅读统计入口。
// 多选删除/移动分类；导入 TXT/EPUB/MOBI/DOCX/FB2/CBZ/PDF。

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var books: [Book] = []
    @Published var categories: [CategoryEntity] = []
    @Published var activeCategory: String = defaultCategory
    @Published var favorites: [FavoriteEntity] = []
    @Published var progressList: [ComicProgressEntity] = []
    @Published var selectionMode = false
    @Published var selectedKeys: Set<String> = []
    @Published var importing = false

    private let db = AppDatabase.shared

    init() {
        reload()
        Task {
            await SourceManager.shared.initialize()
            DownloadManager.shared.resumeUnfinished()
        }
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    func reload() {
        books = (try? db.allBooks()) ?? []
        categories = (try? db.categories()) ?? []
        if !categories.contains(where: { $0.name == activeCategory }) {
            activeCategory = defaultCategory
        }
        favorites = FavoriteRepository.shared.favorites
        progressList = (try? db.allProgress()) ?? []
    }

    var shelfBooks: [Book] {
        books.filter { $0.category == activeCategory }
    }

    /// 正在阅读：最近阅读的本地书 + 有进度的在线收藏
    var continueReadingBooks: [Book] {
        books.filter { $0.lastReadTime > 0 }.prefix(10).map { $0 }
    }

    func importFile(url: URL) async {
        importing = true
        defer { importing = false }
        do {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            let book = try await BookRepository.importBook(from: url)
            reload()
            AppToastCenter.shared.show("《\(book.title)》导入成功", kind: .success)
        } catch {
            AppToastCenter.shared.showError("导入失败：\(error.localizedDescription)")
        }
    }

    func deleteBooks(_ books: [Book]) async {
        for book in books {
            try? await BookRepository.deleteBookCascade(book)
        }
        reload()
        AppToastCenter.shared.show("已删除 \(books.count) 本", kind: .success)
    }

    func moveBooks(_ books: [Book], to category: String) {
        let db = AppDatabase.shared
        for book in books {
            try? db.db.exec("UPDATE books SET category=? WHERE id=?", [.text(category), .int(Int64(book.id))])
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
        reload()
    }
}

struct HomeScreen: View {
    @ObservedObject var viewModel: HomeViewModel
    @Environment(\.appTheme) private var theme

    @State private var showImporter = false
    @State private var readerTarget: Book? = nil
    @State private var onlineReaderTarget: FavoriteEntity? = nil
    @State private var showStats = false
    @State private var categorySheet = false

    private let importTypes: [UTType] = [.text, .data, .pdf, .zip]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                // 1. 正在阅读
                if !viewModel.continueReadingBooks.isEmpty {
                    sectionTitle("正在阅读", icon: "clock")
                    readingNow
                }
                // 2. 我的书架
                sectionTitle("我的书架", icon: "books.vertical", trailing: { shelfActions })
                categoryPills
                shelfGrid
                // 3. 我喜欢的
                if !viewModel.favorites.isEmpty {
                    sectionTitle("我喜欢的", icon: "heart.fill")
                    favoritesRow
                }
                // 4. 阅读统计入口
                sectionTitle("阅读统计", icon: "chart.bar")
                statsEntry
            }
            .padding(.horizontal, DT.spPage)
            .padding(.bottom, 130)
        }
        .background(Color(.systemBackground))
        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in
            if case .success(let url) = result {
                Task { await viewModel.importFile(url: url) }
            }
        }
        .fullScreenCover(item: $readerTarget) { book in
            if book.isComic {
                ComicReaderScreen(book: book)
            } else {
                ReaderScreen(book: book)
            }
        }
        .fullScreenCover(item: $onlineReaderTarget) { fav in
            if let source = SourceManager.shared.source(byId: fav.sourceId) {
                OnlineComicReaderScreen(source: source, comicId: fav.comicId, title: fav.title)
            } else {
                VStack { Text("书源已卸载").font(.system(size: 14)) }
            }
        }
        .sheet(isPresented: $categorySheet) {
            CategoryManageSheet(viewModel: viewModel)
        }
    }

    // MARK: 区块

    private var header: some View {
        HStack {
            Text("书架")
                .font(.system(size: 26, weight: .bold))
            Spacer()
            AppIconButton(systemName: "plus") { showImporter = true }
        }
        .padding(.top, DT.spLG)
    }

    private func sectionTitle(_ title: String, icon: String, @ViewBuilder trailing: () -> some View = { EmptyView() }) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(theme.primary)
            Text(title)
                .font(.system(size: 17, weight: .bold))
            Spacer()
            trailing()
        }
    }

    private var shelfActions: some View {
        HStack(spacing: 12) {
            Button {
                HapticsGate.light()
                withAnimation(AppMotion.springDefault) {
                    viewModel.selectionMode.toggle()
                    if !viewModel.selectionMode { viewModel.selectedKeys.removeAll() }
                }
            } label: {
                Text(viewModel.selectionMode ? "取消" : "多选")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.primary)
            }
            Button {
                HapticsGate.light()
                categorySheet = true
            } label: {
                Image(systemName: "folder.badge.gearshape")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.primary)
            }
        }
    }

    private var readingNow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(viewModel.continueReadingBooks) { book in
                    VStack(alignment: .leading, spacing: 6) {
                        BookCoverView(cover: book.coverUri, cornerRadius: 10)
                            .frame(width: 92, height: 129)
                        Text(book.title)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        Text("第 \(book.currentChapterIndex + 1) 章")
                            .font(.system(size: 10.5))
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 92)
                    .onTapGesture {
                        HapticsGate.light()
                        readerTarget = book
                    }
                }
            }
        }
    }

    private var categoryPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(viewModel.categories) { cat in
                    let selected = viewModel.activeCategory == cat.name
                    Button {
                        HapticsGate.tick()
                        withAnimation(AppMotion.springDefault) { viewModel.activeCategory = cat.name }
                    } label: {
                        HStack(spacing: 4) {
                            if cat.isProtected { Image(systemName: "lock.fill").font(.system(size: 9)) }
                            Text(cat.name)
                        }
                        .font(.system(size: 13, weight: selected ? .semibold : .regular))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(selected ? theme.primary : Color.primary.opacity(0.05)))
                        .foregroundStyle(selected ? theme.primary.onColor() : .primary)
                    }
                }
            }
        }
    }

    private var shelfGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 96), spacing: 14)]
        return Group {
            if viewModel.shelfBooks.isEmpty {
                MascotEmptyState(title: "书架空空的",
                                 subtitle: "点右上角 + 导入 TXT / EPUB / MOBI / CBZ",
                                 mood: .breath)
            } else {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(viewModel.shelfBooks) { book in
                        shelfCell(book)
                    }
                }
            }
        }
    }

    private func shelfCell(_ book: Book) -> some View {
        let key = "\(book.id)"
        let selected = viewModel.selectedKeys.contains(key)
        return VStack(spacing: 6) {
            ZStack(alignment: .topTrailing) {
                BookCoverView(cover: book.coverUri, cornerRadius: 10)
                    .frame(height: 132)
                    .frame(maxWidth: .infinity)
                if viewModel.selectionMode {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20))
                        .foregroundStyle(selected ? theme.primary : .white)
                        .shadow(radius: 2)
                        .padding(6)
                }
            }
            Text(book.title)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if viewModel.selectionMode {
                HapticsGate.tick()
                if selected { viewModel.selectedKeys.remove(key) } else { viewModel.selectedKeys.insert(key) }
            } else {
                HapticsGate.light()
                readerTarget = book
            }
        }
        .contextMenu {
            Button(role: .destructive) {
                Task { await viewModel.deleteBooks([book]) }
            } label: {
                Label("删除", systemImage: "trash")
            }
        }
    }

    private var favoritesRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(viewModel.favorites) { fav in
                    VStack(alignment: .leading, spacing: 6) {
                        BookCoverView(cover: fav.coverUrl.isEmpty ? nil : fav.coverUrl, cornerRadius: 10)
                            .frame(width: 92, height: 129)
                        Text(fav.title)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        if let latest = fav.latestChapterTitle {
                            Text(latest)
                                .font(.system(size: 10))
                                .foregroundStyle(AppColor.heartMid)
                                .lineLimit(1)
                        }
                    }
                    .frame(width: 92)
                    .onTapGesture {
                        HapticsGate.light()
                        onlineReaderTarget = fav
                    }
                }
            }
        }
    }

    private var statsEntry: some View {
        NavigationLink {
            StatisticsScreen()
        } label: {
            GlassCard(cornerRadius: DT.rLG, padding: DT.spLG) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("本周阅读")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Text(formatShortDuration(weeklySeconds()))
                            .font(.system(size: 22, weight: .bold))
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.tertiary)
                }
            }
            .pressableCard()
        }
        .buttonStyle(.plain)
    }

    private func weeklySeconds() -> Int64 {
        let sessions = (try? AppDatabase.shared.readingSessions()) ?? []
        let cal = Calendar.current
        let weekStart = cal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        return sessions.filter {
            Date(timeIntervalSince1970: TimeInterval($0.startTimeMs) / 1000) >= weekStart
        }.reduce(0) { $0 + $1.durationSeconds }
    }
}

private func formatShortDuration(_ seconds: Int64) -> String {
    let h = seconds / 3600, m = (seconds % 3600) / 60
    if h > 0 { return "\(h)小时\(m)分" }
    if m > 0 { return "\(m)分钟" }
    return "\(seconds)秒"
}

// MARK: - 分类管理（CategoryPickerSheet / AddCategoryPill）

struct CategoryManageSheet: View {
    @ObservedObject var viewModel: HomeViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var newCategory = ""
    @State private var moving = false

    var body: some View {
        NavigationStack {
            List {
                if viewModel.selectionMode && !viewModel.selectedKeys.isEmpty {
                    Section("移动 \(viewModel.selectedKeys.count) 本到分类") {
                        ForEach(viewModel.categories.filter { $0.name != defaultCategory || true }) { cat in
                            Button {
                                let targets = viewModel.books.filter { viewModel.selectedKeys.contains("\($0.id)") }
                                viewModel.moveBooks(targets, to: cat.name)
                                viewModel.selectedKeys.removeAll()
                                viewModel.selectionMode = false
                                moving = false
                                dismiss()
                            } label: {
                                Text(cat.name)
                            }
                        }
                    }
                }
                Section("分类") {
                    ForEach(viewModel.categories) { cat in
                        HStack {
                            Text(cat.name)
                            Spacer()
                            if cat.isProtected { Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(.secondary) }
                            if cat.name != defaultCategory {
                                Button(role: .destructive) {
                                    try? AppDatabase.shared.deleteCategory(name: cat.name)
                                    viewModel.reload()
                                } label: {
                                    Image(systemName: "trash").font(.system(size: 13))
                                }
                            }
                        }
                    }
                }
                Section("新建分类") {
                    HStack {
                        TextField("分类名", text: $newCategory)
                        Button("添加") {
                            guard !newCategory.isEmpty else { return }
                            try? AppDatabase.shared.addCategory(name: newCategory)
                            newCategory = ""
                            viewModel.reload()
                        }
                    }
                }
            }
            .navigationTitle("分类管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

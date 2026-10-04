import Foundation
import SwiftUI
import UIKit

// MARK: - 阅读器状态机（ReaderScreen 状态 + 本地书惰性加载代际隔离）
// 切章直接请求正文；切书取消旧任务并核对选择代；元数据占位 vs 真正空章区分。

@MainActor
final class ReaderModel: ObservableObject {
    let book: Book

    @Published var chapters: [Chapter] = []
    @Published var logicalChapters: [ChapterMerger.LogicalChapter] = []
    @Published var currentChapterIndex = 0
    @Published var pageIndex = 0
    @Published var pages: [ReaderPage] = []
    @Published var loadingChapter = false
    @Published var chromeVisible = false
    @Published var chapterCount = 0
    @Published var chapterTitle = ""
    @Published var loadedChapterSet: Set<Int> = []
    @Published var bookmarks: [Bookmark] = []
    @Published var showTOC = false
    @Published var showBookmarks = false
    @Published var showSearch = false
    @Published var showSettings = false
    @Published var brightnessSheet = false
    @Published var ttsActive = false
    @Published var searchKeyword = ""
    @Published var searching = false
    @Published var searchResults: [SearchResultItem] = []

    var currentChapterBookmarked: Bool {
        bookmarks.contains { $0.chapterIndex == currentChapterIndex }
    }

    private let db = AppDatabase.shared
    private let paginationCache = ReaderPaginationCache()
    var lastPageSize: CGSize = CGSize(width: 360, height: 640)
    private var generation = 0
    private var sessionStart: Date = Date()
    private var loadedBodyChapters: Set<Int> = []

    init(book: Book) {
        self.book = book
        currentChapterIndex = book.currentChapterIndex
    }

    // MARK: 生命周期

    func bootstrap() async {
        sessionStart = Date()
        generation += 1
        let gen = generation
        let bookId = book.id
        let loaded = await Task.detached(priority: .userInitiated) { () -> (chapters: [Chapter], logical: [ChapterMerger.LogicalChapter]) in
            let chapters = (try? AppDatabase.shared.chapters(bookId: bookId)) ?? []
            let logical = ChapterMerger.merge(chapters)
            return (chapters, logical)
        }.value
        guard gen == generation else { return }
        chapters = loaded.chapters
        logicalChapters = loaded.logical
        chapterCount = logicalChapters.count
        if let bms = try? db.bookmarks(bookId: book.id) {
            bookmarks = bms
        }
        await loadChapter(order: currentChapterIndex, restorePage: book.scrollOffset)
    }

    func reloadCurrentChapter() {
        Task { await loadChapter(order: currentChapterIndex) }
    }

    // MARK: 章节加载（合并逻辑章）

    private func logicalChapter(order: Int) -> ChapterMerger.LogicalChapter? {
        logicalChapters.indices.contains(order) ? logicalChapters[order] : nil
    }

    func loadChapter(order: Int, restorePage: Int = 0) async {
        guard let logical = logicalChapter(order: order) else { return }
        generation += 1
        let gen = generation
        loadingChapter = true
        currentChapterIndex = order
        chapterTitle = logical.title
        pageIndex = 0

        // 逐章已加载集合：未加载正文时先加载（惰性）
        let needsLoad = logical.orders.contains { !loadedBodyChapters.contains($0) }
        var content = ""
        if needsLoad {
            let bookId = book.id
            let orders = logical.orders
            let fetched = await Task.detached(priority: .userInitiated) { () -> [Int: String] in
                var out: [Int: String] = [:]
                for o in orders {
                    if let c = try? AppDatabase.shared.chapter(bookId: bookId, order: o) {
                        out[o] = c.content
                    }
                }
                return out
            }.value
            guard gen == generation else { return }
            for (o, c) in fetched { loadedBodyChapters.insert(o) }
            content = logical.orders.compactMap { fetched[$0] }.joined()
        } else {
            content = logical.contents.joined()
        }
        // 元数据正文为空不能当成已加载页面（显示加载圈 vs 真正空章）
        let isEmptyChapter = content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard gen == generation else { return }
        if isEmptyChapter {
            loadedChapterSet.insert(order)
            pages = []
            loadingChapter = false
            return
        }

        // 分页（块驱动 + LRU 缓存）
        let blocks = NovelInlineImages.splitIntoBlocks(content)
        let font = UIFont.systemFont(ofSize: ReaderSettings.shared.fontSize)
        let size = lastPageSize
        let lineHeight = ReaderSettings.shared.lineHeight
        let key = PaginationKey(contentHash: content.hashValue, width: size.width, height: size.height,
                                fontSize: font.pointSize, lineHeight: lineHeight)
        let cache = paginationCache
        let computed = await Task.detached(priority: .userInitiated) { () -> [ReaderPage] in
            ReaderPagination.paginate(blocks: blocks, pageSize: CGSize(width: size.width - 40, height: size.height - 60),
                                      font: font, lineHeight: lineHeight,
                                      titleReserve: 24,
                                      cache: cache, cacheKey: key)
        }.value
        guard gen == generation else { return }
        pages = computed
        loadedChapterSet.insert(order)
        loadingChapter = false
        pageIndex = min(restorePage, max(0, computed.count - 1))
        if restorePage > 0 {
            // scrollOffset 语义：字符偏移近似换算页
            pageIndex = min(computed.count - 1, restorePage / 1200)
        }
        saveProgressNow()
    }

    func jumpToChapter(order: Int) {
        Task { await loadChapter(order: order) }
    }

    func updatePageSize(_ size: CGSize) {
        guard size != lastPageSize else { return }
        lastPageSize = size
        paginationCache.invalidate()
        // 首次测量只在 bootstrap 分页时生效，避免与启动加载双跑
        if !loadingChapter && !pages.isEmpty {
            reloadCurrentChapter()
        }
    }

    // MARK: 翻页 / 进度

    func saveProgressNow() {
        _ = try? db.updateProgress(bookId: book.id, chapterIndex: currentChapterIndex, scrollOffset: pageIndex * 1200)
        Preferences.shared.recordReadingDayIfNeeded(seconds: Int64(Date().timeIntervalSince(sessionStart)))
    }

    /// 阅读会话（ReadingTimerEffect 对应物：会话结束 flush）
    func flushSession() {
        let duration = Int64(Date().timeIntervalSince(sessionStart))
        guard duration >= 10 else { return }
        let session = ReadingSession(
            bookId: book.id, bookTitle: book.title,
            dateStr: DateFormatter.isoDate.string(from: sessionStart),
            startTimeMs: Int64(sessionStart.timeIntervalSince1970 * 1000),
            endTimeMs: Int64(Date().timeIntervalSince1970 * 1000),
            durationSeconds: duration,
            startHour: Calendar.current.component(.hour, from: sessionStart))
        try? db.addReadingSession(session)
        Preferences.shared.recordReadingDayIfNeeded(seconds: duration)
        sessionStart = Date()
    }

    // MARK: 书签

    func toggleBookmark() {
        if let existing = bookmarks.first(where: { $0.chapterIndex == currentChapterIndex }) {
            try? db.removeBookmark(bookId: book.id, chapterIndex: currentChapterIndex)
            bookmarks.removeAll { $0.id == existing.id }
            AppToastCenter.shared.show("已移除书签")
        } else {
            let snippet = currentSnippet()
            let bm = Bookmark(bookId: book.id, chapterIndex: currentChapterIndex,
                              scrollOffset: pageIndex * 1200,
                              title: chapterTitle, snippet: snippet)
            try? db.addBookmark(bm)
            bookmarks.append(bm)
            HapticsGate.success()
            AppToastCenter.shared.show("书签已加在第 \(currentChapterIndex + 1) 章", kind: .success)
        }
    }

    func jumpToBookmark(_ bm: Bookmark) {
        jumpToChapter(order: bm.chapterIndex)
    }

    func deleteBookmarks(at offsets: IndexSet) {
        for offset in offsets {
            let bm = bookmarks[offset]
            try? db.removeBookmark(bookId: book.id, chapterIndex: bm.chapterIndex)
        }
        bookmarks.remove(atOffsets: offsets)
    }

    private func currentSnippet() -> String {
        let text = logicalChapter(order: currentChapterIndex).map { lc in
            lc.contents.joined()
        } ?? ""
        let plain = SearchLocator.stripImageTokens(text)
        let start = plain.index(plain.startIndex, offsetBy: min(pageIndex * 1200, plain.count), limitedBy: plain.endIndex) ?? plain.endIndex
        let end = plain.index(start, offsetBy: 60, limitedBy: plain.endIndex) ?? plain.endIndex
        return String(plain[start..<end]).replacingOccurrences(of: "\n", with: " ")
    }

    // MARK: TTS

    func toggleTTS() {
        if TtsManager.shared.isPlaying {
            TtsManager.shared.pause()
            ttsActive = false
        } else {
            let text = logicalChapter(order: currentChapterIndex).map { $0.contents.joined() } ?? ""
            let paragraphs = text.components(separatedBy: "\n\n").filter { !$0.isEmpty }
            TtsManager.shared.startReading(paragraphs: paragraphs, from: 0)
            ttsActive = true
        }
    }

    // MARK: 全文搜索（有界：分批 16 章、最多 1000 条）

    func runSearch() async {
        let kw = searchKeyword.trimmingCharacters(in: .whitespaces)
        guard !kw.isEmpty else { return }
        searching = true
        defer { searching = false }
        let bookId = book.id
        let results = await Task.detached(priority: .userInitiated) { () -> [SearchResultItem] in
            guard let chapters = try? AppDatabase.shared.chapters(bookId: bookId) else { return [] }
            return SearchLocator.buildResults(chapters: chapters, keyword: kw)
        }.value
        searchResults = results
    }

    func jumpToSearchResult(_ item: SearchResultItem) {
        jumpToChapter(order: item.chapterIndex)
    }

    func toggleChrome() {
        withAnimation(AppMotion.springDefault) { chromeVisible.toggle() }
    }
}

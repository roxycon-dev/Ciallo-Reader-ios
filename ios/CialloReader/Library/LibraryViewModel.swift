import Foundation
import SwiftUI

// MARK: - 同源搜索协调（library/SourceSearchCoordinator.kt 镜像）
// 源内互斥，完成后 1.1 秒间隔；60 秒正结果缓存（每源最多 8 关键词）；
// 空结果与错误不缓存；冷却不占跨站槽位。

actor SourceSearchCoordinator {
    private var perSourceTask: [String: Task<[SearchBook], Error>] = [:]
    private var lastFinishAt: [String: Date] = [:]
    private var cache: [String: [String: (at: Date, books: [SearchBook])]] = [:]
    private let sameSourceInterval: TimeInterval = 1.1
    private let cacheTTL: TimeInterval = 60

    func search(source: BookSource, keyword: String, slots: SlotPool) async -> [SearchBook] {
        let key = source.id
        // 重复成功结果 60 秒复用
        if let hit = cache[key]?[keyword], Date().timeIntervalSince(hit.at) < cacheTTL {
            return hit.books
        }
        // 同源互斥：取消旧任务
        perSourceTask[key]?.cancel()
        // 同站间隔（冷却不占跨站槽位）
        if let last = lastFinishAt[key], Date().timeIntervalSince(last) < sameSourceInterval {
            let wait = sameSourceInterval - Date().timeIntervalSince(last)
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        }
        await slots.acquire()
        defer {
            Task { await slots.release() }
            lastFinishAt[key] = Date()
        }
        do {
            let result = await source.search(keyword: keyword)
            switch result {
            case .success(let books):
                if !books.isEmpty {
                    var perSource = cache[key] ?? [:]
                    if perSource.count >= 8 { perSource.removeValue(forKey: perSource.keys.first ?? "") }
                    perSource[keyword] = (Date(), books)
                    cache[key] = perSource
                }
                return books
            case .error:
                return []
            }
        } catch {
            return []
        }
    }

    func invalidate(sourceId: String?) {
        if let sourceId { cache[sourceId] = nil } else { cache.removeAll() }
    }
}

/// 跨站并发槽池（8 路）
actor SlotPool {
    private let limit: Int
    private var active = 0

    init(limit: Int) { self.limit = limit }

    func acquire() async {
        while active >= limit {
            try? await Task.sleep(nanoseconds: 60_000_000)
        }
        active += 1
    }

    func release() {
        active = max(0, active - 1)
    }
}

// MARK: - 聚合搜索调度（library/ComicAggregateSearch.kt 镜像）
// 跨查询复用 8 个并发槽位；原词先排队；逐批发布；源内 ID 去重；有结果的分组按首次命中顺序置前。

@MainActor
final class ComicAggregateSearch: ObservableObject {
    struct Group: Identifiable {
        let sourceId: String
        var books: [SearchBook]
        var loading: Bool
        var error: String?
        var id: String { sourceId }
    }

    @Published var groups: [Group] = []
    private var generation = 0
    private let slots = SlotPool(limit: 8)
    private let coordinator = SourceSearchCoordinator()

    func search(keyword: String, sources: [BookSource]) async {
        generation += 1
        let gen = generation
        groups = sources.map { Group(sourceId: $0.id, books: [], loading: true, error: nil) }
        await withTaskGroup(of: Void.self) { group in
            for source in sources {
                group.addTask { [weak self] in
                    guard let self else { return }
                    let books = await self.coordinator.search(
                        source: source, keyword: keyword,
                        slots: self.slots)
                    await self.publish(gen: gen, sourceId: source.id, books: books)
                }
            }
        }
        if gen == generation {
            groups = groups.map { Group(sourceId: $0.sourceId, books: $0.books, loading: false, error: $0.error) }
        }
    }

    private func publish(gen: Int, sourceId: String, books: [SearchBook]) {
        guard gen == generation else { return }
        // 源内 ID 去重
        var seen = Set<String>()
        let deduped = books.filter { seen.insert($0.id).inserted }
        if let idx = groups.firstIndex(where: { $0.sourceId == sourceId }) {
            groups[idx].books = deduped
            groups[idx].loading = false
            // 有结果的分组按首次命中顺序置前
            let group = groups.remove(at: idx)
            groups.insert(group, at: 0)
        }
    }

    func cancel() {
        generation += 1
    }
}

// MARK: - 书库 ViewModel（LibraryViewModel 核心路径）

@MainActor
final class LibraryViewModel: ObservableObject {
    enum UiState: Equatable {
        case loading, empty, ready
    }

    @Published var keyword: String = ""
    @Published var state: UiState = .ready
    @Published var searching = false
    @Published var groups: [ComicAggregateSearch.Group] = []
    @Published var searchHistory: [String] = []
    @Published var category: SourceCategory = .novel
    @Published var activeSourceId: String? = SourceManager.shared.activeSourceId
    @Published var aggregateMode = true

    enum SourceCategory: String, CaseIterable {
        case novel = "小说"
        case comic = "漫画"
    }

    let aggregate = ComicAggregateSearch()
    private var searchTask: Task<Void, Never>?

    init() {
        searchHistory = Preferences.shared.stringArray(for: "library_search_history")
        Task { await SourceManager.shared.initialize() }
    }

    var sources: [BookSource] {
        let manager = SourceManager.shared
        return category == .novel ? manager.novelSources : manager.comicSources
    }

    func runSearch() {
        let kw = keyword.trimmingCharacters(in: .whitespaces)
        guard !kw.isEmpty else { return }
        searchTask?.cancel()
        searching = true
        addToHistory(kw)
        let sources: [BookSource]
        if !aggregateMode, let active = SourceManager.shared.activeSource ?? sources.first {
            sources = [active]
        } else {
            sources = self.sources
        }
        let isComic = category == .comic
        searchTask = Task {
            if isComic {
                await aggregate.search(keyword: kw, sources: sources)
                if !Task.isCancelled {
                    groups = aggregate.groups
                    searching = false
                }
            } else {
                // 小说：逐源并发（聚合同款展示）
                await withTaskGroup(of: (String, [SearchBook], String?).self) { group in
                    for source in sources {
                        group.addTask {
                            let result = await source.search(keyword: kw)
                            switch result {
                            case .success(let books): return (source.id, books, nil)
                            case .error(let e): return (source.id, [], e.errorDescription)
                            }
                        }
                    }
                    var collected: [ComicAggregateSearch.Group] = []
                    for await (sourceId, books, error) in group {
                        collected.append(.init(sourceId: sourceId, books: books, loading: false, error: error))
                    }
                    if !Task.isCancelled {
                        self.groups = collected
                        self.searching = false
                    }
                }
            }
        }
    }

    func cancelSearch() {
        searchTask?.cancel()
        aggregate.cancel()
        searching = false
    }

    private func addToHistory(_ kw: String) {
        var history = searchHistory.filter { $0 != kw }
        history.insert(kw, at: 0)
        if history.count > 20 { history.removeLast() }
        searchHistory = history
        Preferences.shared.setStringArray(history, for: "library_search_history")
    }

    func clearHistory() {
        searchHistory = []
        Preferences.shared.setStringArray([], for: "library_search_history")
    }
}

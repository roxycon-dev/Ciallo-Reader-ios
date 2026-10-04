import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/FavoriteRepository.kt（509 行）
// 收藏/进度/下载三态互不耦合的唯一出口。Room Flow → ObservableObject @Published + dbChangedNotification。

/** 距上次检查超过这个间隔才在「进入栏 / 下拉刷新」时联网检查更新。 */
let updateCheckIntervalMs: Int64 = 30 * 60 * 1000 // Kotlin: UPDATE_CHECK_INTERVAL_MS

/** 「全部」是筛选伪分类，不是真实分类行（不写进 favorite_categories）。 */
let allFavCategoryName = "全部" // Kotlin: ALL_FAV_CATEGORY_NAME

/**
 * 「我喜欢的」+ 阅读进度的仓库：收藏、进度、下载三态互不耦合的唯一出口。
 *
 * 设计要点：
 * - 收藏/进度用 (sourceId, comicId) 关联，与 Book（本地下载）完全独立：
 *   取消喜欢不动下载与进度，删除下载也不动喜欢与进度；
 * - 更新检查带两级限流（全局并发 ≤3 + 同一来源每秒最多 1 个请求），
 *   单本失败只标记该本、不影响其他本，避免被来源封禁。
 */
@MainActor
final class FavoriteRepository: ObservableObject {
    static let shared = FavoriteRepository()

    /// Kotlin: val favorites: StateFlow<List<FavoriteEntity>>
    @Published private(set) var favorites: [FavoriteEntity] = []
    /// Kotlin: val favoriteKeys: StateFlow<Set<String>>
    @Published private(set) var favoriteKeys: Set<String> = []
    /// Kotlin: val favoriteCategories: StateFlow<List<FavoriteCategoryEntity>>
    @Published private(set) var favoriteCategories: [FavoriteCategoryEntity] = []
    /// Kotlin: val progressByKey: StateFlow<Map<String, ComicProgressEntity>>
    @Published private(set) var progressByKey: [String: ComicProgressEntity] = [:]

    /// Kotlin 构造注入 dao + comicSourceOf → iOS 侧统一从 AppDatabase / SourceManager 取。
    private let dao: FavoriteDao
    private var comicSourceOf: (String) -> BookSource? {
        { SourceManager.shared.source(byId: $0) }
    }
    private let catalogMutex = ContentMutationGate()
    private var catalogRoot: URL? // Kotlin: var catalogContext: Context?
    private let db = AppDatabase.shared

    private init() {
        dao = FavoriteDao(db: AppDatabase.shared.db)
        reload()
        NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    /// reload()：iOS 侧 StateFlow 订阅等价物（DB 变更后全量刷新）。
    func reload() {
        favorites = (try? dao.allFavorites()) ?? []
        favoriteKeys = Set((try? dao.favoriteKeys()) ?? [])
        favoriteCategories = (try? dao.favoriteCategories()) ?? []
        progressByKey = Dictionary(
            ((try? dao.allProgress()) ?? []).map { (favoriteKey($0.sourceId, $0.comicId), $0) },
            uniquingKeysWith: { a, _ in a }
        )
    }

    /* ───────────── 收藏 ───────────── */

    /* ───────────── 收藏分类（独立于书架） ───────────── */

    /** 「我喜欢的」自己的分类体系；书架的 categories 与本表互不干涉。 */
    func addFavoriteCategory(_ name: String) async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return }
        let count = ((try? dao.favoriteCategoriesSync()) ?? []).count
        try? dao.insertFavoriteCategory(FavoriteCategoryEntity(
            name: name.trimmingCharacters(in: .whitespaces),
            sortOrder: count
        ))
        reload()
    }

    func renameFavoriteCategory(oldName: String, newName: String) async {
        let trimmed = newName.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || oldName == trimmed { return }
        try? dao.renameFavoriteCategoryCascade(oldName, trimmed)
        reload()
    }

    /** 删除分类：里面的收藏退回「默认」，绝不连带删除收藏本身。 */
    func deleteFavoriteCategory(_ name: String) async {
        if name == favDefaultCategory { return }
        try? dao.deleteFavoriteCategoryAndRetag(name, fallback: favDefaultCategory)
        reload()
    }

    /** 保证分类存在（收藏/拖拽落点前调用，避免出现"有收藏但没有分类行"）。 */
    func ensureFavoriteCategory(_ name: String) async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty || name == allFavCategoryName { return }
        let existing = (try? dao.favoriteCategoriesSync()) ?? []
        if !existing.contains(where: { $0.name == name }) {
            try? dao.insertFavoriteCategory(FavoriteCategoryEntity(name: name, sortOrder: existing.count))
        }
    }

    func isFavorite(sourceId: String, comicId: String) async -> Bool {
        (try? dao.favorite(sourceId: sourceId, comicId: comicId)) != nil
    }

    func favoritesSnapshot() async -> [FavoriteEntity] {
        (try? dao.allFavoritesSync()) ?? []
    }

    /// Kotlin replaceFavorite：换源后的收藏替换（章节映射）。
    @discardableResult
    func replaceFavorite(from: ComicKey, book: SearchBook, newChapters: [ComicChapter]) async throws -> FavoriteMigrationReport {
        precondition(from.valid && !book.sourceId.isEmpty && !book.id.isEmpty)
        precondition(from.raw != favoriteKey(book.sourceId, book.id))
        guard !newChapters.isEmpty else { throw ImportError("新来源暂无可用章节，暂时无法迁移") }
        return try await Task.detached(priority: .userInitiated) { [dao, comicSourceOf, catalogRoot] in
            var oldChapters: [ComicChapter] = []
            if let catalogRoot, let catalog = ChapterCatalog(filesRoot: catalogRoot) {
                oldChapters = catalog.read(source: from.sourceId, comic: from.comicId)
            }
            if oldChapters.isEmpty {
                if let source = comicSourceOf(from.sourceId) as? ComicSourceProtocol {
                    // withTimeoutOrNull(15_000)：iOS 侧直接等待（TODO: 超时包装）
                    if case .success(let data) = await source.getChapters(bookId: from.comicId) {
                        oldChapters = data
                    }
                }
            }
            let mapping = ComicChapterMatching.mapping(old: oldChapters, fresh: newChapters)
                .mapValues { $0.id }
            let ordered = ComicReadingLogic.ordered(newChapters)
            let latest = ordered.last
            var replacement = FavoriteEntity(
                sourceId: book.sourceId, comicId: book.id,
                title: book.title, author: book.author, coverUrl: book.cover ?? "")
            replacement.serialStatus = serialStatusOf(book.comicInfo?.author) // iOS 侧 ComicInfo 无 status（TODO）
            replacement.latestChapterId = latest?.chapter.id
            replacement.latestChapterTitle = latest?.chapter.title
            replacement.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
            // Write catalog first: a failed disk write must not remove the old favorite.
            if let catalogRoot, let catalog = ChapterCatalog(filesRoot: catalogRoot) {
                try? catalog.write(source: book.sourceId, comic: book.id, chapters: newChapters)
            }
            return try dao.replaceFavoriteMapped(
                from: from, replacement: replacement, mapping: mapping,
                chapterOrders: Dictionary(ordered.map { ($0.chapter.id, $0.order) }, uniquingKeysWith: { a, _ in a }),
                latestId: latest?.chapter.id)
        }.value
    }

    /** 加入收藏（幂等：已存在则只更新分类与快照）。 */
    func add(book: SearchBook, category: String = favDefaultCategory, chapters: [ComicChapter] = []) async {
        if book.sourceId.isEmpty || book.id.isEmpty { return }
        let top = ComicReadingLogic.ordered(chapters).last
        let existing = try? await daoFavorite(sourceId: book.sourceId, comicId: book.id)
        let useCategory = existing?.categoryName ?? category
        // 分类行必须存在（收藏可以指向任意分类名，但 chip 栏只认 favorite_categories 里的行）
        await ensureFavoriteCategory(useCategory)
        var entity = existing ?? FavoriteEntity(
            sourceId: book.sourceId, comicId: book.id,
            title: book.title, author: book.author, coverUrl: book.cover ?? "")
        entity.title = book.title
        entity.author = book.author
        entity.coverUrl = book.cover ?? existing?.coverUrl ?? ""
        entity.categoryName = useCategory
        entity.sourceAlive = true
        // iOS 侧 ComicInfo 无 status 字段（TODO：source 包落地后接入）
        entity.serialStatus = existing?.serialStatus ?? SerialStatus.unknown.rawValue
        entity.latestChapterId = top?.chapter.id ?? existing?.latestChapterId
        entity.latestChapterTitle = top?.chapter.title ?? existing?.latestChapterTitle
        try? dao.insertFavorite(entity)
        reload()
    }

    /// iOS 侧辅助：dao.favorite 的 async 包装。
    private func daoFavorite(sourceId: String, comicId: String) async throws -> FavoriteEntity? {
        try dao.favorite(sourceId: sourceId, comicId: comicId)
    }

    /// iOS 侧 facade（LibraryScreen 使用）：加入收藏并返回成败。
    @discardableResult
    func add(book: SearchBook, source: BookSource?) async -> Bool {
        var chapters: [ComicChapter] = []
        if let comic = source as? ComicSourceProtocol,
           case .success(let list) = await comic.getChapters(bookId: book.id) {
            chapters = list
        }
        let before = (try? dao.favorite(sourceId: book.sourceId, comicId: book.id)) != nil
        await add(book: book, chapters: chapters)
        return (try? dao.favorite(sourceId: book.sourceId, comicId: book.id)) != nil || before
    }

    /// 批量加入收藏：返回成功条数（无来源的书由调用方提前过滤）。
    func addAll(books: [SearchBook], category: String = favDefaultCategory) async -> Int {
        let valid = books.filter { !$0.sourceId.isEmpty && !$0.id.isEmpty }
        for book in valid { await add(book: book, category: category) }
        return valid.count
    }

    func remove(sourceId: String, comicId: String) async {
        try? dao.deleteFavorite(sourceId: sourceId, comicId: comicId)
        reload()
    }

    /// iOS 侧 facade（LibraryScreen 使用）：是否已收藏。
    func isFavorited(sourceId: String, comicId: String) async -> Bool {
        (try? dao.favorite(sourceId: sourceId, comicId: comicId)) != nil
    }

    func removeByKeys(_ keys: [String]) async {
        try? dao.deleteFavoritesByKeys(keys)
        reload()
    }

    func moveToCategory(keys: [String], category: String) async {
        await ensureFavoriteCategory(category)
        try? dao.moveFavoritesToCategory(keys, category: category)
        reload()
    }

    /// iOS 侧 facade（HomeScreen 使用）。
    func moveToCategory(keys: [ComicKey], categoryName: String?) {
        try? dao.moveFavoritesToCategory(keys.map { $0.raw }, category: categoryName ?? favDefaultCategory)
        reload()
    }

    /* ───────────── 阅读进度（与收藏、下载无关） ───────────── */

    func progressFlow(sourceId: String, comicId: String) async -> ComicProgressEntity? {
        try? dao.progress(sourceId: sourceId, comicId: comicId)
    }

    /// iOS 侧 facade（ComicReaderModel 使用）。
    func progress(sourceId: String, comicId: String) async -> ComicProgressEntity? {
        try? dao.progress(sourceId: sourceId, comicId: comicId)
    }

    func chapterStatesFlow(sourceId: String, comicId: String) async -> [ChapterReadEntity] {
        (try? dao.chapterStates(sourceId: sourceId, comicId: comicId)) ?? []
    }

    func chapterStates(sourceId: String, comicId: String) async -> [String: ChapterReadEntity] {
        Dictionary(((try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? [])
            .map { ($0.chapterId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// iOS 侧 facade（ComicReaderModel 使用）。
    func chapterReads(sourceId: String, comicId: String) async -> [ChapterReadEntity] {
        (try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? []
    }

    /**
     * 翻页时保存进度（调用方做防抖；退出阅读器/进后台强制调用一次）。
     * 同时维护章节级状态：未读完 → 阅读中，读完（最后一页 或 ≥90%）→ 已读。
     */
    func saveProgress(
        sourceId: String,
        comicId: String,
        chapterId: String,
        chapterIndex: Int,
        pageIndex: Int,
        pageCount: Int
    ) {
        let finished = ComicReadingLogic.isFinished(pageIndex, pageCount)
        try? dao.upsertProgress(ComicProgressEntity(
            sourceId: sourceId,
            comicId: comicId,
            lastChapterId: chapterId,
            lastChapterIndex: chapterIndex,
            lastPageIndex: max(pageIndex, 0),
            lastPageCount: max(pageCount, 0),
            lastReadAt: Int64(Date().timeIntervalSince1970 * 1000)
        ))
        // 读旧合并：REPLACE 会整行覆盖，直接构造会抹掉读者标注的书签
        let previous = ((try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? [])
            .first { $0.chapterId == chapterId }
        var state = previous ?? ChapterReadEntity(
            sourceId: sourceId, comicId: comicId, chapterId: chapterId, chapterIndex: chapterIndex)
        state.status = finished ? ChapterReadState.read.code : ChapterReadState.reading.code
        state.pageIndex = max(pageIndex, 0)
        state.pageCount = max(pageCount, 0)
        state.chapterIndex = chapterIndex
        state.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        try? dao.upsertChapterStates([state])
        reload()
    }

    /// 手动把某一章标记为已读/未读（长按章节）。
    func markChapter(sourceId: String, comicId: String, chapterId: String, chapterIndex: Int, read: Bool) async {
        // 读旧合并：保留书签列（REPLACE 会整行覆盖）
        let previous = ((try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? [])
            .first { $0.chapterId == chapterId }
        var state = previous ?? ChapterReadEntity(
            sourceId: sourceId, comicId: comicId, chapterId: chapterId, chapterIndex: chapterIndex)
        state.status = read ? ChapterReadState.read.code : ChapterReadState.unread.code
        state.chapterIndex = chapterIndex
        state.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        try? dao.upsertChapterStates([state])
        reload()
    }

    /// iOS 侧 facade（旧调用面）：翻页读态写入。
    func markChapterRead(sourceId: String, comicId: String, chapterId: String, chapterIndex: Int,
                         pageIndex: Int, pageCount: Int, finished: Bool) {
        let previous = ((try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? [])
            .first { $0.chapterId == chapterId }
        var state = previous ?? ChapterReadEntity(
            sourceId: sourceId, comicId: comicId, chapterId: chapterId, chapterIndex: chapterIndex)
        state.status = finished ? ChapterReadState.read.code : ChapterReadState.reading.code
        state.pageIndex = pageIndex
        state.pageCount = pageCount
        state.chapterIndex = chapterIndex
        state.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        try? dao.upsertChapterStates([state])
        reload()
    }

    /// 详情页左滑/右滑该话卡片：切换书签标注。
    func setChapterBookmark(sourceId: String, comicId: String, chapterId: String, chapterIndex: Int, bookmarked: Bool) async {
        let previous = ((try? dao.chapterStatesSync(sourceId: sourceId, comicId: comicId)) ?? [])
            .first { $0.chapterId == chapterId }
        var state = previous ?? ChapterReadEntity(
            sourceId: sourceId, comicId: comicId, chapterId: chapterId, chapterIndex: chapterIndex)
        state.bookmarked = bookmarked
        state.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        try? dao.upsertChapterStates([state])
        reload()
    }

    /// 「将以上全部标记为已读」（按阅读序号批量置位）。
    func markChaptersReadUpTo(sourceId: String, comicId: String, maxIndex: Int) async {
        try? dao.markChaptersReadUpTo(sourceId: sourceId, comicId: comicId, maxIndex: maxIndex)
        reload()
    }

    /// 进入章节列表时记录「已见」快照，用于之后显示「新」小红点。
    func markSeen(sourceId: String, comicId: String, chapters: [ComicChapter]) async {
        await reconcileCatalog(sourceId: sourceId, comicId: comicId, chapters: chapters)
        let seq = ComicReadingLogic.ordered(chapters)
        let top = seq.last?.chapter.id
        let cur = try? dao.progress(sourceId: sourceId, comicId: comicId)
        var p = cur ?? ComicProgressEntity(sourceId: sourceId, comicId: comicId)
        p.seenTopChapterId = top ?? cur?.seenTopChapterId
        p.seenChapterCount = seq.count
        try? dao.upsertProgress(p)
        reload()
    }

    /// 换源迁移（粗糙版）：收藏 + 进度 + 章节状态整体搬到新的 (sourceId, comicId)。
    func migrateKey(from: ComicKey, to: ComicKey) async {
        try? dao.migrateKey(fromSourceId: from.sourceId, fromComicId: from.comicId,
                            toSourceId: to.sourceId, toComicId: to.comicId)
        reload()
    }

    /**
     * 换源迁移（推荐）：按「阅读序号」把章节状态映射到新源的章节上。
     *
     * 不同书源的 chapterId 毫无关系，直接整体搬（migrateKey）会让已读状态全部错位；
     * 这里用归一化后的阅读序号做映射：旧源第 N 话的已读状态 → 新源第 N 话。
     * 差集（新源多出/缺失的章节）保持未读，不做猜测。
     *
     * @param newChapters 新源的章节列表（用于建立序号 → 新 chapterId 的映射）
     * @return 成功映射的章节条数
     */
    @discardableResult
    func migrateByOrder(from: ComicKey, to: ComicKey, newChapters: [ComicChapter]) async -> Int {
        if !from.valid || !to.valid || from.raw == to.raw { return 0 }
        let seq = ComicReadingLogic.ordered(newChapters)
        let oldStates = (try? dao.chapterStatesSync(sourceId: from.sourceId, comicId: from.comicId)) ?? []
        let oldProg = try? dao.progress(sourceId: from.sourceId, comicId: from.comicId)
        let oldFav = try? dao.favorite(sourceId: from.sourceId, comicId: from.comicId)

        let identities: [String: ComicChapter] = catalogRoot.map { root in
            let catalog = ChapterCatalog(filesRoot: root)
            return catalog.mapping(old: catalog.read(source: from.sourceId, comic: from.comicId), fresh: newChapters)
        } ?? [:]
        let orders = Dictionary(seq.map { ($0.chapter.id, $0.order) }, uniquingKeysWith: { a, _ in a })
        let mapped: [ChapterReadEntity] = oldStates.compactMap { state in
            guard let chapter = identities[state.chapterId] else { return nil }
            var c = state
            c.sourceId = to.sourceId
            c.comicId = to.comicId
            c.chapterId = chapter.id
            c.chapterIndex = orders[chapter.id] ?? -1
            return c
        }
        var newProgress: ComicProgressEntity? = nil
        if let oldProg, let progressChapter = oldProg.lastChapterId.flatMap({ identities[$0] }) {
            var p = oldProg
            p.sourceId = to.sourceId
            p.comicId = to.comicId
            p.lastChapterId = progressChapter.id
            p.lastChapterIndex = orders[progressChapter.id] ?? -1
            p.seenTopChapterId = seq.last?.chapter.id
            p.seenChapterCount = seq.count
            newProgress = p
        }
        let complete = mapped.count == oldStates.count && (oldProg?.lastChapterId == nil || newProgress != nil)
        try? dao.migrateResolved(from: from, to: to, states: mapped, progress: newProgress,
                                 favorite: oldFav.map { f in
                                     var c = f; c.sourceId = to.sourceId; c.comicId = to.comicId; return c
                                 },
                                 clearOld: complete)
        if let catalogRoot {
            try? ChapterCatalog(filesRoot: catalogRoot).write(source: to.sourceId, comic: to.comicId, chapters: newChapters)
        }
        reload()
        return mapped.count
    }

    private func reconcileCatalog(source: String, comic: String, chapters: [ComicChapter]) async {
        guard let catalogRoot else { return }
        catalogMutex.withLock {
            let catalog = ChapterCatalog(filesRoot: catalogRoot)
            let mapping = catalog.mapping(old: catalog.read(source: source, comic: comic), fresh: chapters)
            let orders = Dictionary(ComicReadingLogic.ordered(chapters).map { ($0.chapter.id, $0.order) },
                                    uniquingKeysWith: { a, _ in a })
            let states = (try? dao.chapterStatesSync(sourceId: source, comicId: comic)) ?? []
            let changed: [ChapterReadEntity] = states.compactMap { state in
                guard let chapter = mapping[state.chapterId], chapter.id != state.chapterId else { return nil }
                var c = state
                c.chapterId = chapter.id
                c.chapterIndex = orders[chapter.id] ?? state.chapterIndex
                return c
            }
            let progress = try? dao.progress(sourceId: source, comicId: comic)
            var updated: ComicProgressEntity? = nil
            if let progress, let mapped = progress.lastChapterId.flatMap({ mapping[$0] }) {
                var p = progress
                p.lastChapterId = mapped.id
                p.lastChapterIndex = orders[mapped.id] ?? progress.lastChapterIndex
                updated = p
            }
            let changedIds = Set(changed.map { $0.chapterId })
            let oldIds = states.filter { mapping[$0.chapterId].map({ changedIds.contains($0.id) }) == true }
                .map { $0.chapterId }
            try? dao.reconcileChapterIds(source: source, comic: comic, states: changed,
                                         progress: updated, oldIds: oldIds)
            try? catalog.write(source: source, comic: comic, chapters: chapters)
        }
    }

    /* ───────────── 更新检测 ───────────── */

    private let updateGate = ContentMutationGate() // Semaphore(3) 近似：iOS 侧以互斥串行化
    private var lastRequestAt: [String: Date] = [:]
    private var checking = false

    /** 单本失败不影响其他本；并发 ≤3，同一来源每秒最多 1 个请求。 */
    private func throttle(_ sourceId: String) async {
        let last = lastRequestAt[sourceId] ?? .distantPast
        let wait = last.addingTimeInterval(1.0).timeIntervalSinceNow
        if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(min(wait, 1.0) * 1_000_000_000)) }
        lastRequestAt[sourceId] = Date()
    }

    /**
     * 检查更新（stale-while-revalidate：先返回缓存快照，后台刷新不阻塞 UI）。
     * @param force true = 下拉刷新，忽略 30 分钟间隔
     * @return 本次真正联网检查过的条数
     */
    func checkUpdates(force: Bool = false) async -> Int {
        if checking { return 0 }
        checking = true
        defer { checking = false }
        let now = Date().timeIntervalSince1970 * 1000
        let targets = ((try? dao.allFavoritesSync()) ?? []).filter {
            force || now - $0.lastCheckedAt > updateCheckIntervalMs
        }
        await updateGate.withLockAsync {
            for fav in targets {
                do {
                    await throttle(fav.sourceId)
                    guard let source = comicSourceOf(fav.sourceId) as? ComicSourceProtocol else { continue }
                    let chapters: [ComicChapter]
                    switch await source.getChapters(bookId: fav.comicId) {
                    case .success(let data): chapters = data
                    case .error(let e): throw ImportError(e.errorDescription ?? "章节加载失败")
                    }
                    let top = ComicReadingLogic.ordered(chapters).last
                    // ⚠️ 回写前重读当前行：targets 是检查开始时的快照，检查期间
                    // 用户可能取消收藏 / 移动分类 —— 拿快照整行 REPLACE 会把
                    // 已删除的收藏"复活"、把分类跳回旧值。
                    guard let fresh = try? dao.favorite(sourceId: fav.sourceId, comicId: fav.comicId) else { continue }
                    // ⚠️ 「是否真的有新话」要走话数归一化判定（isNewChapterObserved）：
                    // 裸 id 比较在 id 不稳定的源上会把同一话反复判成新话。
                    let changed = ComicReadingLogic.isNewChapterObserved(fav.latestChapterId, fav.latestChapterTitle, top)
                    var updated = fresh
                    updated.latestChapterId = top?.chapter.id ?? fresh.latestChapterId
                    updated.latestChapterTitle = top?.chapter.title ?? fresh.latestChapterTitle
                    // ⚠️ 只有真的观察到新话才推进「更新时间」：以前每次检查
                    // 都盖 now —— 「最近更新」排序实际是「最近检查过」，
                    // 每 30 分钟自动检查后所有收藏都排到最前（用户实测排序乱跳）
                    updated.latestChapterUpdateAt = changed ? Int64(Date().timeIntervalSince1970 * 1000) : fresh.latestChapterUpdateAt
                    updated.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
                    updated.sourceAlive = true
                    try? dao.insertFavorite(updated)
                } catch {
                    // 单本失败只标记这一本：保留缓存信息与已读状态，UI 显示灰色警示。
                    // 同样重读当前行，避免复活竞态
                    if let fresh = try? dao.favorite(sourceId: fav.sourceId, comicId: fav.comicId) {
                        var updated = fresh
                        updated.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
                        updated.sourceAlive = false
                        try? dao.insertFavorite(updated)
                    }
                }
            }
        }
        reload()
        return targets.count
    }

    /// 来源失效后重试单本。
    func retrySource(sourceId: String, comicId: String) async -> Bool {
        var ok = false
        await updateGate.withLockAsync {
            do {
                await throttle(sourceId)
                guard let source = comicSourceOf(sourceId) as? ComicSourceProtocol else { ok = false; return }
                let chapters: [ComicChapter]
                switch await source.getChapters(bookId: comicId) {
                case .success(let data): chapters = data
                case .error: ok = false; return
                }
                let top = ComicReadingLogic.ordered(chapters).last
                // 与 checkUpdates 同款：重读当前行（防复活竞态）+ 话数归一化判定
                // + 只有真观察到新话才推进「更新时间」
                guard let fresh = try? dao.favorite(sourceId: sourceId, comicId: comicId) else { ok = false; return }
                let changed = ComicReadingLogic.isNewChapterObserved(fresh.latestChapterId, fresh.latestChapterTitle, top)
                var updated = fresh
                updated.latestChapterId = top?.chapter.id ?? fresh.latestChapterId
                updated.latestChapterTitle = top?.chapter.title ?? fresh.latestChapterTitle
                updated.latestChapterUpdateAt = changed ? Int64(Date().timeIntervalSince1970 * 1000) : fresh.latestChapterUpdateAt
                updated.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
                updated.sourceAlive = true
                try? dao.insertFavorite(updated)
                ok = true
            } catch {
                ok = false
            }
        }
        reload()
        return ok
    }

    /// iOS 侧 facade（旧调用面）：单本更新检查（ReaderLibrary 卡片刷新）。
    func checkUpdates(for fav: FavoriteEntity, source: BookSource) async -> FavoriteEntity? {
        let key = fav.id
        if let last = lastRequestAt[key], Date().timeIntervalSince(last) < 300 { return nil }
        lastRequestAt[key] = Date()
        guard let comic = source as? ComicSourceProtocol else { return nil }
        guard case .success(let chapters) = await comic.getChapters(bookId: fav.comicId),
              let latest = ComicReadingLogic.ordered(chapters).last else {
            if let fresh = try? dao.favorite(sourceId: fav.sourceId, comicId: fav.comicId) {
                var updated = fresh
                updated.sourceAlive = false
                updated.lastCheckedAt = Int64(Date().timeIntervalSince1970 * 1000)
                try? dao.insertFavorite(updated)
                reload()
                return updated
            }
            return nil
        }
        if let fresh = try? dao.favorite(sourceId: fav.sourceId, comicId: fav.comicId) {
            var updated = fresh
            updated.sourceAlive = true
            updated.latestChapterId = latest.chapter.id
            updated.latestChapterTitle = latest.chapter.title
            let changed = ComicReadingLogic.isNewChapterObserved(fresh.latestChapterId, fresh.latestChapterTitle, latest)
            updated.latestChapterUpdateAt = changed ? Int64(Date().timeIntervalSince1970 * 1000) : fresh.latestChapterUpdateAt
            updated.lastCheckedAt = updated.latestChapterUpdateAt
            try? dao.insertFavorite(updated)
            reload()
            return updated
        }
        return nil
    }

    /* ───────────── iOS 侧辅助 facade（ComicReaderModel 使用的旧静态 API） ───────────── */

    /// 章节排序键：卷号 + 章节序
    static func orderKey(_ c: ComicChapter) -> Float { c.order }

    static func ordered(_ chapters: [ComicChapter]) -> [ComicChapter] {
        chapters.sorted { orderKey($0) < orderKey($1) }
    }

    /// 续读目标
    static func resolveContinue(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> (chapter: ComicChapter, page: Int)? {
        guard !chapters.isEmpty else { return nil }
        let orderedChapters = ordered(chapters)
        if let progress,
           let hit = orderedChapters.first(where: { $0.id == progress.lastChapterId }) {
            return (hit, progress.lastPageIndex)
        }
        return (orderedChapters[0], 0)
    }

    static func continueLabel(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> String {
        guard let target = resolveContinue(progress: progress, chapters: chapters) else { return "开始阅读" }
        return "续读 \(target.chapter.title)"
    }

    /// 更新数：seenChapterCount 之后的新章
    static func newChapterIds(progress: ComicProgressEntity?, chapters: [ComicChapter]) -> Set<String> {
        guard let progress else { return [] }
        let orderedChapters = ordered(chapters)
        guard progress.seenChapterCount > 0, progress.seenChapterCount < orderedChapters.count else { return [] }
        return Set(orderedChapters[progress.seenChapterCount...].map { $0.id })
    }

    static func readRatio(reads: [ChapterReadEntity], chapters: [ComicChapter]) -> Double {
        guard !chapters.isEmpty else { return 0 }
        let finished = reads.filter { $0.state == .read }.count
        return Double(finished) / Double(chapters.count)
    }
}

private func serialStatusOf(_ raw: String?) -> String {
    switch raw?.trimmingCharacters(in: .whitespaces).lowercased() {
    case "completed", "finished", "已完结", "完结", "已完結", "完結":
        return SerialStatus.completed.code
    case "ongoing", "连载中", "連載中", "连载", "連載":
        return SerialStatus.ongoing.code
    case "hiatus", "paused", "暂停", "暫停", "休刊":
        return SerialStatus.hiatus.code
    default:
        return SerialStatus.unknown.code
    }
}

// MARK: - iOS 侧辅助（Kotlin 无对应）

extension ContentMutationGate {
    /// Kotlin `mutex.withLock { suspend block }` 的 async 对应物（互斥区串行）。
    func withLockAsync(_ body: () async -> Void) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                lock()
                let group = DispatchGroup()
                group.enter()
                Task { @MainActor in
                    await body()
                    group.leave()
                }
                group.wait()
                unlock()
                cont.resume()
            }
        }
    }
}

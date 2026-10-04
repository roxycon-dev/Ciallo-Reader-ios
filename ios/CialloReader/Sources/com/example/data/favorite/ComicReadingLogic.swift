import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/ComicReadingLogic.kt（190 行）
/**
 * 漫画阅读顺序 / 续读定位 / 章节状态的**纯函数**集合（无平台依赖、可单测）。
 *
 * 三条容易踩坑的规则在这里一次性收敛：
 * 1. 「下一话」必须按**来源自己的章节顺序索引**计算，而不是按列表下标——
 *    源可能正序也可能倒序返回，还可能缺章（order 不连续、中间被删）。
 * 2. 已读判定：读到最后一页 **或** 进度 ≥ 90%。
 * 3. 「新章节」= 上次进入章节列表后新增的章节（按阅读顺序比快照 id 更大）。
 */

/// 归一化到「阅读顺序」后的章节：携带原始列表下标、排序键、以及显示用的话数。
struct OrderedChapter {
    /// 在源返回的原始列表中的下标
    let rawIndex: Int
    /// 在阅读顺序（升序）中的序号：0 起，缺章也连续
    let order: Int
    let chapter: ComicChapter
    let orderKey: Float
    /// 从标题里解析出的话数（用于「继续阅读 · 第12话」文案）；解析不到则为序号+1
    let displayNumber: Int
}

enum ComicReadingLogic {

    /**
     * 章节排序键：源给的 ComicChapter.order 优先（它能表达缺章与乱序）；
     * 源没给（恒为 0）时退化为列表下标，保证正序/倒序列表都能排。
     */
    static func orderKey(_ chapter: ComicChapter, _ rawIndex: Int) -> Float {
        chapter.order.isFinite && chapter.order != 0 ? chapter.order : Float(rawIndex)
    }

    /// 把源返回的任意顺序列表归一化成阅读顺序（升序）。
    static func ordered(_ chapters: [ComicChapter]) -> [OrderedChapter] {
        let decorated = chapters.enumerated().map { (index: $0.offset, chapter: $0.element) }
        let sorted = decorated.sorted { a, b in
            let ka = orderKey(a.chapter, a.index)
            let kb = orderKey(b.chapter, b.index)
            if ka != kb { return ka < kb }
            return a.index < b.index
        }
        return sorted.enumerated().map { order, pair in
            OrderedChapter(
                rawIndex: pair.index,
                order: order,
                chapter: pair.chapter,
                orderKey: orderKey(pair.chapter, pair.index),
                displayNumber: chapterNumber(pair.chapter.title) ?? (order + 1)
            )
        }
    }

    /// 从「第 12 话 / 第12话 / 12話 / Chapter 12」等标题里取话数。
    static func chapterNumber(_ title: String) -> Int? {
        let regex = try! NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)"#)
        let ns = title as NSString
        guard let m = regex.firstMatch(in: title, options: [], range: NSRange(location: 0, length: ns.length)),
              m.numberOfRanges > 1 else { return nil }
        guard let f = Float(ns.substring(with: m.range(at: 1))) else { return nil }
        return Int(f)
    }

    /**
     * 更新检测：这次抓到的最新一话，是否真的算「有新话」。
     *
     * ⚠️ 不能只比 chapterId：有的源每次拉取都会生成不同的 id（URL 带时间戳/hash），
     * 裸 id 比较会把"同一话"判成"有更新"——角标永远亮着、「最近更新」排序永远在抖
     * （用户报的"检测是否新更新的算法有问题"）。话数归一化：两边都能从标题解析出
     * 话数且相等 → 是同一话，不算更新；任一边解析不到话数 → 退回纯 id 比较
     * （无法证伪，宁可报更新也别漏报）。
     *
     * @param oldLatestId  收藏快照里的最新章节 id（null = 从没抓到过 → 首次观察即"有"）
     * @param oldLatestTitle 收藏快照里的最新章节标题
     * @param newLatest    这次抓到的最新一话（null = 源没返回章节 → 算没有）
     */
    static func isNewChapterObserved(
        _ oldLatestId: String?,
        _ oldLatestTitle: String?,
        _ newLatest: OrderedChapter?
    ) -> Bool {
        guard let newLatest else { return false }
        guard let oldId = oldLatestId else { return true }
        if newLatest.chapter.id == oldId { return false }
        let newNum = chapterDecimal(newLatest.chapter.title)
        let oldNum = oldLatestTitle.flatMap { chapterDecimal($0) }
        if let newNum, let oldNum, newNum == oldNum { return false }
        return true
    }

    /// java.math.BigDecimal 比较（话数含小数时不丢精度）。
    private static func chapterDecimal(_ title: String) -> String? {
        let regex = try! NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)"#)
        let ns = title as NSString
        guard let m = regex.firstMatch(in: title, options: [], range: NSRange(location: 0, length: ns.length)),
              m.numberOfRanges > 1 else { return nil }
        let value = ns.substring(with: m.range(at: 1))
        guard value.count <= 64 else { return nil }
        return normalizedDecimal(value)
    }

    /// stripTrailingZeros().toPlainString() 对应物。
    static func normalizedDecimal(_ raw: String) -> String {
        var s = raw
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        if s.isEmpty { return "0" }
        // 去前导零（保至少一位）
        var t = s
        while t.count > 1 && t.hasPrefix("0") && !t.hasPrefix("0.") { t.removeFirst() }
        return t
    }

    /// 已读判定：最后一页 或 进度 ≥ 90%。
    static func isFinished(_ pageIndex: Int, _ pageCount: Int) -> Bool {
        if pageCount <= 0 { return false }
        if pageIndex >= pageCount - 1 { return true }
        return Float(pageIndex + 1) / Float(pageCount) >= 0.9
    }

    /// 续读目标（决定「继续阅读」按钮的文案与落点）。
    enum ContinueTarget: Equatable {
        /// 从未读过
        case start

        /// 有进度：精确回到上次章节与页码
        case resume(chapterIndex: Int, pageIndex: Int)

        /// 上次那一话已读完：跳下一话第 1 页
        case next(chapterIndex: Int)

        /// 已读到最新
        case upToDate
    }

    /**
     * 计算续读目标。
     * @param chapters 源返回的原始章节列表（顺序任意）
     * @param states   章节状态表（chapterId → 状态）
     * @param progress 漫画级进度（可为 null = 没读过）
     */
    static func resolveContinue(
        _ chapters: [ComicChapter],
        states: [String: ChapterReadState],
        progress: ComicProgressEntity?
    ) -> ContinueTarget {
        let seq = ordered(chapters)
        if seq.isEmpty { return .start }
        guard let lastId = progress?.lastChapterId else { return .start }

        // 上次读的章节可能已被源删除 → 退化成「第一条未读」，读不到就从头
        let lastOrder = seq.firstIndex { $0.chapter.id == lastId }
        guard let lastOrder else {
            let firstUnread = seq.first { states[$0.chapter.id] != .read }
            if let firstUnread { return .next(chapterIndex: firstUnread.order) }
            return .upToDate
        }
        let lastState = states[lastId] ?? .unread
        let finishedByPage = isFinished(progress?.lastPageIndex ?? 0, progress?.lastPageCount ?? 0)
        if lastState == .read || finishedByPage {
            let next = lastOrder + 1 < seq.count ? seq[lastOrder + 1] : nil
            if let next { return .next(chapterIndex: next.order) }
            return .upToDate
        }
        return .resume(chapterIndex: lastOrder, pageIndex: max(progress?.lastPageIndex ?? 0, 0))
    }

    /// 「继续阅读」按钮文案（带上下文）。
    static func continueLabel(_ target: ContinueTarget, chapters: [ComicChapter]) -> String {
        let seq = ordered(chapters)
        func number(_ index: Int) -> Int { seq.indices.contains(index) ? seq[index].displayNumber : index + 1 }
        switch target {
        case .start: return "开始阅读"
        case .resume(let chapterIndex, let pageIndex):
            let page = max(pageIndex + 1, 1)
            return "继续阅读 · 第\(number(chapterIndex))话 · 第\(page)页"
        case .next(let chapterIndex):
            return "继续阅读 · 第\(number(chapterIndex))话"
        case .upToDate: return "已读到最新"
        }
    }

    /**
     * 上次进入章节列表后新增的章节 id（用于「新」小红点）。
     * 优先按快照 id 的阅读顺序比较；快照 id 已失效时按章节数增量兜底取末尾若干条。
     */
    static func newChapterIds(
        chapters: [ComicChapter],
        progress: ComicProgressEntity?
    ) -> Set<String> {
        guard let progress else { return [] }
        let seq = ordered(chapters)
        if let topId = progress.seenTopChapterId,
           let idx = seq.firstIndex(where: { $0.chapter.id == topId }) {
            return Set(seq[(idx + 1)...].map { $0.chapter.id })
        }
        let delta = seq.count - progress.seenChapterCount
        if delta > 0 {
            return Set(seq.suffix(min(delta, seq.count)).map { $0.chapter.id })
        }
        return []
    }

    /// 已读章节占比（卡片底部细进度条）。
    static func readRatio(chapters: [ComicChapter], states: [String: ChapterReadState]) -> Float {
        if chapters.isEmpty { return 0 }
        let read = chapters.filter { states[$0.id] == .read }.count
        return Float(read) / Float(chapters.count)
    }

    /// 未读话数（卡片「未读 K 话」）。
    static func unreadCount(chapters: [ComicChapter], states: [String: ChapterReadState]) -> Int {
        chapters.filter { states[$0.id] != .read }.count
    }
}

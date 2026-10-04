import Foundation
import SwiftUI
import UIKit

// MARK: - 漫画阅读模型（ComicReaderCore 状态 + ComicPageLoader + 在线章节/图片加载）
// 本地：一页一章节（content=文件路径）；在线：JS/HTML 源章节 → 图片 URL（带逐图请求头）。

@MainActor
final class ComicReaderModel: ObservableObject {
    enum Source {
        case local(Book)
        case online(source: BookSource, comicId: String)
    }

    @Published var images: [UIImage] = []
    @Published var loading = true
    @Published var loadingText = "加载中…"
    @Published var chapterTitle = ""
    @Published var title = ""
    @Published var currentChapterIndex = 0
    @Published var orderedChapters: [ComicChapter] = []
    @Published var readChapterIds: Set<String> = []
    @Published var currentChapterId = ""

    var bookKey: String
    var godBookId: String
    private let origin: Source
    private var startChapterId: String?
    private var pendingRestorePage: Int?
    private var nextChapterBuffer: [UIImage] = []
    private var nextChapterId: String?

    init(source: Source, title fallback: String, bookKey: String, startChapterId: String? = nil) {
        self.origin = source
        self.title = fallback
        self.bookKey = bookKey
        self.godBookId = bookKey
        self.startChapterId = startChapterId
    }

    static func local(book: Book) -> ComicReaderModel {
        ComicReaderModel(source: .local(book), title: book.title, bookKey: "local_\(book.id)",
                         startChapterId: nil)
    }

    static func online(source: BookSource, comicId: String, title: String, startChapterId: String?) -> ComicReaderModel {
        ComicReaderModel(source: .online(source: source, comicId: comicId), title: title,
                         bookKey: "\(source.id)::\(comicId)", startChapterId: startChapterId)
    }

    // MARK: 启动

    func bootstrap() async {
        loadReadState()
        switch origin {
        case .local(let book):
            title = book.title
            let chapters = (try? AppDatabase.shared.chapters(bookId: book.id)) ?? []
            orderedChapters = chapters.map { ComicChapter(id: "p\($0.chapterOrder)", title: $0.title, order: Float($0.chapterOrder)) }
            currentChapterIndex = min(book.currentChapterIndex, max(0, orderedChapters.count - 1))
            pendingRestorePage = book.scrollOffset
            await loadLocalChapter(index: currentChapterIndex)
        case .online(let source, let comicId):
            loadingText = "获取章节…"
            guard let comic = source as? ComicSourceProtocol else {
                loading = false
                return
            }
            let result = await comic.getChapters(bookId: comicId)
            if case .success(let chapters) = result {
                orderedChapters = FavoriteRepository.ordered(chapters)
            }
            // 续读目标
            if let start = startChapterId, let idx = orderedChapters.firstIndex(where: { $0.id == start }) {
                currentChapterIndex = idx
            } else if let progress = await FavoriteRepository.shared.progress(sourceId: source.id, comicId: comicId),
                      let idx = orderedChapters.firstIndex(where: { $0.id == progress.lastChapterId }) {
                currentChapterIndex = idx
                pendingRestorePage = progress.lastPageIndex
            }
            await loadOnlineChapter(index: currentChapterIndex, comic: comic)
        }
    }

    private func loadReadState() {
        if case .online(let source, let comicId) = origin {
            Task {
                let reads = await FavoriteRepository.shared.chapterReads(sourceId: source.id, comicId: comicId)
                readChapterIds = Set(reads.filter { ChapterReadState(rawValue: $0.status) == ChapterReadState.finished }.map { $0.chapterId })
            }
        }
    }

    // MARK: 本地章节（一页一章节）

    private func loadLocalChapter(index: Int) async {
        guard case .local(let book) = origin else { return }
        loading = true
        loadingText = "加载页面…"
        let chapters = (try? AppDatabase.shared.chapters(bookId: book.id)) ?? []
        guard chapters.indices.contains(index) else {
            loading = false
            return
        }
        let paths = chapters.map { $0.content }
        let decoded = await Task.detached(priority: .userInitiated) { () -> [UIImage] in
            var out: [UIImage] = []
            for p in paths {
                if let data = try? Data(contentsOf: URL(fileURLWithPath: p)), let img = UIImage(data: data) {
                    out.append(img)
                }
            }
            return out
        }.value
        images = decoded
        chapterTitle = chapters[index].title
        currentChapterId = "p\(chapters[index].chapterOrder)"
        loading = false
    }

    // MARK: 在线章节

    private func loadOnlineChapter(index: Int, comic: ComicSourceProtocol) async {
        guard case .online(let source, let comicId) = origin else { return }
        guard orderedChapters.indices.contains(index) else {
            loading = false
            return
        }
        loading = true
        loadingText = "加载图片…"
        let chapter = orderedChapters[index]
        chapterTitle = chapter.title
        currentChapterId = chapter.id

        var urls: [String] = []
        var headers: [String: [String: String]] = [:]
        if let js = source as? JsComicSource {
            if case .success(let payload) = await js.getChapterImagesWithHeaders(comicId: comicId, chapterId: chapter.id) {
                urls = payload.urls
                headers = payload.headers
            }
        } else if case .success(let list) = await comic.getChapterImages(chapterId: chapter.id) {
            urls = list
            headers = await comic.getChapterImageHeaders(chapterId: chapter.id, urls: list)
        }
        guard !urls.isEmpty else {
            loading = false
            if urls.isEmpty && orderedChapters.isEmpty { /* keep empty state */ }
            return
        }
        let decoded = await Task.detached(priority: .userInitiated) { () -> [UIImage] in
            await withTaskGroup(of: (Int, UIImage?).self) { group in
                for (i, url) in urls.enumerated() {
                    group.addTask {
                        let img = await ComicImageLoader.load(url: url, headers: headers[url] ?? [:])
                        return (i, img)
                    }
                }
                var arr = [UIImage?](repeating: nil, count: urls.count)
                for await (i, img) in group { arr[i] = img }
                return arr.compactMap { $0 }
            }
        }.value
        images = decoded
        loading = false
        // 进度
        FavoriteRepository.shared.saveProgress(
            sourceId: source.id, comicId: comicId,
            chapterId: chapter.id, chapterIndex: index,
            pageIndex: 0, pageCount: decoded.count)
        // 预取下一章
        prefetchNextChapter(comic: comic, comicId: comicId)
    }

    private func prefetchNextChapter(comic: ComicSourceProtocol, comicId: String) {
        let nextIndex = currentChapterIndex + 1
        guard orderedChapters.indices.contains(nextIndex) else { return }
        let chapter = orderedChapters[nextIndex]
        Task {
            var urls: [String] = []
            if let js = comic as? JsComicSource,
               case .success(let payload) = await js.getChapterImagesWithHeaders(comicId: comicId, chapterId: chapter.id) {
                urls = payload.urls
            } else if case .success(let list) = await comic.getChapterImages(chapterId: chapter.id) {
                urls = list
            }
            var decoded: [UIImage] = []
            for url in urls.prefix(4) {
                if let img = await ComicImageLoader.load(url: url, headers: [:]) { decoded.append(img) }
            }
            nextChapterBuffer = decoded
            nextChapterId = chapter.id
        }
    }

    // MARK: 翻页 / 章节

    func onPageChanged(page: Int) {
        if case .online(let source, let comicId) = origin, orderedChapters.indices.contains(currentChapterIndex) {
            let chapter = orderedChapters[currentChapterIndex]
            FavoriteRepository.shared.saveProgress(
                sourceId: source.id, comicId: comicId,
                chapterId: chapter.id, chapterIndex: currentChapterIndex,
                pageIndex: page, pageCount: images.count)
        } else if case .local(let book) = origin {
            _ = try? AppDatabase.shared.updateProgress(bookId: book.id, chapterIndex: currentChapterIndex, scrollOffset: page)
        }
    }

    func restorePageIfPending(_ apply: (Int) -> Void) {
        if let target = pendingRestorePage {
            pendingRestorePage = nil
            apply(min(target, max(0, images.count - 1)))
        }
    }

    func nextChapter() {
        guard currentChapterIndex + 1 < orderedChapters.count else {
            AppToastCenter.shared.show("已经是最后一话")
            return
        }
        currentChapterIndex += 1
        Task { await reloadChapterTask() }
    }

    func prevChapter() {
        guard currentChapterIndex > 0 else {
            AppToastCenter.shared.show("已经是第一话")
            return
        }
        currentChapterIndex -= 1
        Task { await reloadChapterTask() }
    }

    func jumpToChapter(_ chapter: ComicChapter) {
        guard let idx = orderedChapters.firstIndex(where: { $0.id == chapter.id }) else { return }
        currentChapterIndex = idx
        Task { await reloadChapterTask() }
    }

    func autoLoadNextChapter() async {
        // 无缝条漫滚到底：自动加载下一章（简单实现：切换章节）
        if currentChapterIndex + 1 < orderedChapters.count {
            currentChapterIndex += 1
            await reloadChapterTask()
        }
    }

    func reloadChapter() {
        Task { await reloadChapterTask() }
    }

    private func reloadChapterTask() async {
        images = []
        pendingRestorePage = 0
        switch origin {
        case .local: await loadLocalChapter(index: currentChapterIndex)
        case .online(let source, let comicId):
            if let comic = source as? ComicSourceProtocol {
                await loadOnlineChapter(index: currentChapterIndex, comic: comic)
            }
        }
    }

    func saveProgressNow() {
        if case .local(let book) = origin {
            _ = try? AppDatabase.shared.updateProgress(bookId: book.id, chapterIndex: currentChapterIndex, scrollOffset: 0)
        }
    }

    func currentImage() -> UIImage? {
        images.first
    }
}

// MARK: - 页面加载器（ComicPageLoader 对应物：解码 + 多级缓存）

enum ComicImageLoader {
    private static let cache = NSCache<NSString, UIImage>()

    static func load(url: String, headers: [String: String]) async -> UIImage? {
        if let hit = cache.object(forKey: url as NSString) { return hit }
        guard let u = URL(string: url) else { return nil }
        var request = URLRequest(url: u, timeoutInterval: 30)
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        // 防盗链兜底
        if headers["Referer"] == nil {
            if let host = u.host { request.setValue("https://\(host)/", forHTTPHeaderField: "Referer") }
        }
        do {
            let (data, response) = try await Http.session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            // mhttu 图床解密域
            var finalData = data
            if let host = u.host, host.contains("mhttu") {
                finalData = MhttuImageDecryptor.decrypt(data)
            }
            guard let img = UIImage(data: finalData) else { return nil }
            cache.setObject(img, forKey: url as NSString)
            return img
        } catch {
            return nil
        }
    }
}

/// MhttuImageDecryptor：特定域名图片字节解密（轻量 XOR 兜底，扩展名判定保留）
enum MhttuImageDecryptor {
    static func decrypt(_ data: Data) -> Data {
        // mhttu 域名为 XOR 0x9D 混淆（与安卓实现一致的字节级变换）
        var out = Data(count: data.count)
        out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                let s = src.bindMemory(to: UInt8.self)
                let d = dst.bindMemory(to: UInt8.self)
                for i in 0..<s.count { d[i] = s[i] ^ 0x9D }
            }
        }
        // 校验头是否为已知图片格式；否则原样返回
        let head = [UInt8](out.prefix(4))
        let isImage = head.starts(with: [0xFF, 0xD8]) || head.starts(with: [0x89, 0x50]) || head.starts(with: [0x52, 0x49])
        return isImage ? out : data
    }
}

import Foundation
import CommonCrypto

// 对齐 novel-reader/app/src/main/java/com/example/data/favorite/ChapterCatalog.kt（45 行）
// Only unique chapter titles/volumes are reconciled; list positions never prove identity.
// Android AtomicFile（临时文件 + rename 的原子写）→ Swift 写 .tmp 再 replaceItem。

final class ChapterCatalog {
    private let filesRoot: URL // Kotlin context.filesDir

    init(filesRoot: URL) {
        self.filesRoot = filesRoot
    }

    /// 兼容入口：Kotlin 构造传 context，iOS 侧缺省取文档目录。
    convenience init() {
        self.init(filesRoot: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0])
    }

    private func file(source: String, comic: String) -> URL {
        let key = "\(source.count):\(source)\(comic)"
        let digest = InsecureSha256.sha256(Data(key.utf8))
        let hash = digest.map { String(format: "%02x", $0) }.joined()
        let dir = filesRoot.appendingPathComponent("chapter_catalogs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(hash).json")
    }

    func read(source: String, comic: String) -> [ComicChapter] {
        // runCatching { ... }.getOrDefault(emptyList())
        do {
            let f = file(source: source, comic: comic)
            guard FileManager.default.fileExists(atPath: f.path) else { return [] }
            let size = (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= 4 * 1024 * 1024 else { return [] } // require(f.length()<=4MB)
            let text = try String(contentsOf: f, encoding: .utf8)
            guard let arr = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any] else { return [] }
            guard arr.count <= 10_000 else { return [] } // require(a.length()<=10_000)
            return arr.compactMap { raw in
                guard let o = raw as? [String: Any],
                      let id = o["id"] as? String,
                      let title = o["title"] as? String else { return nil }
                let volumeRaw = o["volume"] as? String ?? ""
                let volume = volumeRaw.trimmingCharacters(in: .whitespaces).isEmpty ? nil : volumeRaw
                let order = (o["order"] as? NSNumber)?.floatValue ?? 0
                return ComicChapter(id: id, title: title, volume: volume, order: order)
            }
        } catch {
            return []
        }
    }

    func write(source: String, comic: String, chapters: [ComicChapter]) throws {
        precondition(chapters.count <= 10_000) // require(chapters.size<=10_000)
        var arr: [[String: Any]] = []
        for c in chapters {
            arr.append(["id": c.id, "title": c.title, "volume": c.volume ?? "", "order": c.order])
        }
        let raw = try JSONSerialization.data(withJSONObject: arr)
        guard raw.count <= 4 * 1024 * 1024 else { throw ImportError("章节目录过大") } // require(raw.size<=4MB)
        let target = file(source: source, comic: comic)
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        // AtomicFile.startWrite/finishWrite → 原子写
        let tmp = target.appendingPathExtension("tmp")
        try raw.write(to: tmp)
        _ = try FileManager.default.replaceItemAt(target, withItemAt: tmp, backupItemName: nil, options: [])
    }

    func mapping(old: [ComicChapter], fresh: [ComicChapter]) -> [String: ComicChapter] {
        func key(_ c: ComicChapter) -> String {
            let volumePart = (c.volume ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            let titlePart = c.title.trimmingCharacters(in: .whitespaces)
                .lowercased()
                .filter { !$0.isWhitespace }
            return volumePart + "|" + titlePart
        }
        func groupBy<T>(_ list: [T], key: (T) -> String) -> [String: [T]] {
            Dictionary(grouping: list, by: key)
        }
        let groupedOld = groupBy(old, key: key)
        let groupedNew = groupBy(fresh, key: key)
        let byId = Dictionary(fresh.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var result: [String: ComicChapter] = [:]
        for chapter in old {
            let exact = byId[chapter.id].flatMap { key($0) == key(chapter) ? $0 : nil }
            let newGroup = groupedNew[key(chapter)]
            let semantic = (newGroup?.count == 1 ? newGroup?.first : nil)
                .flatMap { groupedOld[key(chapter)]?.count == 1 ? $0 : nil }
            if let hit = exact ?? semantic {
                result[chapter.id] = hit
            }
        }
        return result
    }
}

// MARK: - iOS 侧辅助（Kotlin 无对应）：SHA-256 摘要工具

enum InsecureSha256 {
    static func sha256(_ data: Data) -> Data {
        // 复用 source 包若无；此处用 CommonCrypto（避免依赖 CryptoKit 的平台差异——两者均可）
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { raw in
            _ = CC_SHA256(raw.baseAddress, CC_LONG(data.count), &digest)
        }
        return Data(digest)
    }
}

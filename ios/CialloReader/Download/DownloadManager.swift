import Foundation
import CryptoKit

// MARK: - 下载层（download/ 对应物）
// DownloadManager + DownloadWorker + DownloadFileValidator + DownloadTransferPolicy：
// 断点续传（可信前缀 + If-Range + 严格 Content-Range）、64KiB 缓冲、300ms 内存进度 / 2s 持久化、
// 真实格式魔数校验、完成后自动入库；全局并发 2。

enum DownloadTransferPolicy {
    /// 严格解析 Content-Range：核对起点、终点、总长与正文长度
    static func validateContentRange(_ header: String?, expectedStart: Int64, bodyLength: Int64, expectedTotal: Int64) -> Bool {
        guard let header else { return false }
        // 形如 "bytes 100-999/1234"
        guard let range = header.range(of: "bytes\\s+(\\d+)-(\\d+)/(\\d+)", options: .regularExpression) else { return false }
        let parts = header[range].split(separator: " ").last?.split(separator: "/") ?? []
        guard parts.count == 2 else { return false }
        let segs = parts[0].split(separator: "-")
        guard segs.count == 2, let start = Int64(segs[0]), let end = Int64(segs[1]),
              let total = Int64(parts[1]) else { return false }
        return start == expectedStart && end == expectedStart + bodyLength - 1 && total == expectedTotal
    }

    /// 仅强验证器（强 ETag）允许 If-Range 续传
    static func ifRangeValue(etag: String?, lastModified: String?) -> String? {
        guard let etag, !etag.isEmpty, etag.hasPrefix("\"") else { return nil }
        return etag
    }
}

/// 真实格式魔数识别（DownloadFileValidator.detectRealFormat）
enum DownloadFileValidator {
    enum RealFormat: String {
        case pdf, fb2, docx, epub, cbz, mobi, txt, html
    }

    static func detect(data: Data, declaredFormat: String) -> RealFormat {
        let head = data.prefix(4096)
        // HTML 伪装检测
        let headText = String(decoding: head, as: UTF8.self).lowercased()
        if headText.hasPrefix("<!doctype html") || headText.hasPrefix("<html") || headText.hasPrefix("<head") {
            return .html
        }
        // %PDF-（前 1KB 窗口扫描）
        if scanWindow(data, bytes: Data("%PDF-".utf8), window: 1024) { return .pdf }
        // <?xml + <FictionBook
        let headStr = String(decoding: head, as: UTF8.self)
        if headStr.contains("<FictionBook") { return .fb2 }
        // PK（ZIP 家族）
        if data.starts(with: Data("PK".utf8)) {
            // 在条目名中查 word/document.xml=docx、META-INF/container.xml=epub、图片=cbz
            if containsZipEntry(data, name: "word/document.xml") { return .docx }
            if containsZipEntry(data, name: "META-INF/container.xml") || containsZipEntry(data, name: "mimetype") { return .epub }
            if zipHasImageEntries(data) { return .cbz }
        }
        // 偏移 60 BOOKMOBI
        if data.count > 68 {
            let at60 = data.subdata(in: 60..<68)
            if String(data: at60, encoding: .ascii) == "BOOKMOBI" { return .mobi }
        }
        // 文本启发式 → txt
        return .txt
    }

    static func scanWindow(_ data: Data, bytes: Data, window: Int) -> Bool {
        let limit = min(window, data.count - bytes.count)
        guard limit >= 0 else { return false }
        for offset in 0...max(0, limit) {
            if data.subdata(in: offset..<(offset + bytes.count)) == bytes { return true }
        }
        return false
    }

    /// 粗查 ZIP 中央/本地文件头条目名
    static func containsZipEntry(_ data: Data, name: String) -> Bool {
        scanWindow(data, bytes: Data(name.utf8), window: min(data.count, 256 * 1024))
    }

    static func zipHasImageEntries(_ data: Data) -> Bool {
        for ext in [".jpg", ".png", ".webp", ".jpeg"] {
            if scanWindow(data, bytes: Data(ext.utf8), window: min(data.count, 256 * 1024)) { return true }
        }
        return false
    }

    /// 完成后校验：声明格式与真实格式不一致时按真实格式放行（epub 实为 mobi/txt/pdf/cbz）
    static func validate(fileURL: URL, declaredFormat: String) throws -> RealFormat {
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
            throw ImportError("无法读取下载文件")
        }
        defer { try? handle.close() }
        let head = handle.readData(ofLength: 64 * 1024)
        // 已知验证/错误 HTML 终止
        let real = detect(data: head, declaredFormat: declaredFormat)
        if real == .html {
            let text = String(decoding: head, as: UTF8.self).lowercased()
            let challengeMarkers = ["error", "not found", "403", "404", "cloudflare", "captcha"]
            if declaredFormat.lowercased() == "txt" {
                // TXT 只拒绝已知挑战/错误标记；合法 TXT 内 HTML 放行
                if challengeMarkers.contains(where: { text.contains($0) }) {
                    throw ImportError("下载内容为错误页，已终止")
                }
            } else {
                throw ImportError("下载内容为 HTML 页面而非 \(declaredFormat)，已终止")
            }
        }
        return real
    }
}

// MARK: - 下载管理器

@MainActor
final class DownloadManager: ObservableObject {
    static let shared = DownloadManager()

    @Published private(set) var states: [String: DownloadState] = [:]   // DownloadProgressBroadcaster

    private let db = AppDatabase.shared
    private var running: [String: Task<Void, Never>] = [:]
    private let maxConcurrent = 2

    private init() {}

    // MARK: 任务身份（sourceId + 原始资源 ID 的长度前缀复合键）

    static func compositeId(sourceId: String, bookId: String) -> String {
        "\(sourceId.count):\(sourceId):\(bookId)"
    }

    func enqueueDownload(sourceId: String, book: SearchBook, format: String, downloadInfo: DownloadInfo) async {
        let id = Self.compositeId(sourceId: sourceId, bookId: book.id)
        // 已有任务去重
        if let tasks = try? db.allTasks(), tasks.contains(where: { $0.id == id && $0.status != DownloadStatus.error.rawValue }) {
            AppToastCenter.shared.show("下载任务已存在")
            return
        }
        let task = DownloadTaskEntity(
            id: id, sourceId: sourceId, title: book.title, author: book.author,
            coverUrl: book.cover ?? "", downloadUrl: downloadInfo.url,
            format: downloadInfo.format, status: DownloadStatus.pending.rawValue)
        try? db.upsertTask(task)
        states[id] = .pending
        // 并发控制：超出则排队（等待某个 running 完成）
        while running.count >= maxConcurrent {
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
        startWorker(task: task, headers: downloadInfo.headers, referer: downloadInfo.referer)
    }

    func resumeUnfinished() {
        guard let tasks = try? db.unfinishedTasks() else { return }
        for task in tasks where running[task.id] == nil {
            startWorker(task: task, headers: [:], referer: nil)
        }
    }

    private func startWorker(task: DownloadTaskEntity, headers: [String: String], referer: String?) {
        let t = Task { [weak self] in
            await self?.runWorker(task: task, headers: headers, referer: referer)
        }
        running[task.id] = t
    }

    func cancel(taskId: String) {
        running[taskId]?.cancel()
        running.removeValue(forKey: taskId)
        states[taskId] = .idle
        try? db.deleteTask(id: taskId)
    }

    func pause(taskId: String) {
        running[taskId]?.cancel()
        running.removeValue(forKey: taskId)
        states[taskId] = .paused
        if var task = (try? db.allTasks())?.first(where: { $0.id == taskId }) {
            task.status = DownloadStatus.paused.rawValue
            try? db.upsertTask(task)
        }
    }

    // MARK: Worker（DownloadWorker 算法）

    private func runWorker(task: DownloadTaskEntity, headers: [String: String], referer: String?) {
        let id = task.id
        Task {
            defer { running.removeValue(forKey: id) }
            states[id] = .downloading(progress: 0, bytesPerSecond: 0, remainingBytes: 0)
            do {
                guard let url = URL(string: task.downloadUrl) else { throw ImportError("无效下载地址") }
                var request = URLRequest(url: url, timeoutInterval: 60)
                request.httpMethod = "GET"
                for (k, v) in headers where k.lowercased() != "cookie" { request.setValue(v, forHTTPHeaderField: k) }
                if let referer { request.setValue(referer, forHTTPHeaderField: "Referer") }
                if let cookie = headers["Cookie"] { request.setValue(cookie, forHTTPHeaderField: "Cookie") }

                // 目标文件（文件名附 SHA-256 摘要避免替换/截断碰撞）
                let digest = String(Hex.sha256(Data("\(id)|\(task.downloadUrl)".utf8)).prefix(8))
                let fileName = "\(task.title)_\(digest).\(task.format)"
                let dest = BookRepository.downloadsDirectory.appendingPathComponent(fileName)
                let partial = dest.appendingPathExtension("part")
                var offset: Int64 = 0
                var etag: String?
                var lastModified: String?
                var totalBytes: Int64 = task.totalBytes

                if FileManager.default.fileExists(atPath: partial.path), task.downloadedBytes > 0 {
                    // 可信前缀续传：If-Range 仅在强 ETag 存在时使用
                    let sidecarData = try? Data(contentsOf: sidecarURL(dest))
                    if let data = sidecarData,
                       let saved = try? JSONDecoder().decode(Sidecar.self, from: data),
                       saved.url == task.downloadUrl {
                        etag = saved.etag
                        lastModified = saved.lastModified
                        totalBytes = saved.totalBytes ?? 0
                        if let ifRange = DownloadTransferPolicy.ifRangeValue(etag: etag, lastModified: lastModified) {
                            request.setValue("bytes=\(task.downloadedBytes)-", forHTTPHeaderField: "Range")
                            request.setValue(ifRange, forHTTPHeaderField: "If-Range")
                            offset = task.downloadedBytes
                        } else {
                            try? FileManager.default.removeItem(at: partial)
                        }
                    } else {
                        try? FileManager.default.removeItem(at: partial)
                    }
                }

                // 下载前检查空间
                if let free = try? FileManager.default.attributesOfFileSystem(forPath: NSTemporaryDirectory())[.systemFreeSize] as? Int64, free < 64 * 1024 * 1024 {
                    throw ImportError("存储空间不足")
                }

                let (bytes, response) = try await Http.session.bytes(for: request)
                guard let http = response as? HTTPURLResponse else { throw ImportError("非 HTTP 响应") }

                if http.statusCode == 200 {
                    // 200 → 重下
                    offset = 0
                    try? FileManager.default.removeItem(at: partial)
                    FileManager.default.createFile(atPath: partial.path, contents: nil)
                } else if http.statusCode == 206 {
                    let bodyLen = http.expectedContentLength
                    let valid = DownloadTransferPolicy.validateContentRange(
                        http.value(forHTTPHeaderField: "Content-Range"),
                        expectedStart: offset, bodyLength: bodyLen, expectedTotal: totalBytes)
                    if !valid {
                        // 严格校验失败 → 全量重启
                        offset = 0
                        try? FileManager.default.removeItem(at: partial)
                        FileManager.default.createFile(atPath: partial.path, contents: nil)
                    }
                } else if http.statusCode == 416 {
                    // 416 → 全量重启一次
                    offset = 0
                    try? FileManager.default.removeItem(at: partial)
                    FileManager.default.createFile(atPath: partial.path, contents: nil)
                    let (bytes2, response2) = try await Http.session.bytes(for: stripRange(request))
                    guard let http2 = response2 as? HTTPURLResponse, http2.statusCode == 200 else {
                        throw ImportError("下载失败 HTTP \((response2 as? HTTPURLResponse)?.statusCode ?? -1)")
                    }
                    return try await self.consume(bytes: bytes2, response: http2, task: task, dest: dest, partial: partial)
                } else if !(200..<300).contains(http.statusCode) {
                    throw HttpError.status(http.statusCode, nil)
                }

                if offset == 0 {
                    FileManager.default.createFile(atPath: partial.path, contents: nil)
                }
                etag = etag ?? http.value(forHTTPHeaderField: "ETag")
                lastModified = lastModified ?? http.value(forHTTPHeaderField: "Last-Modified")
                if totalBytes <= 0 { totalBytes = http.expectedContentLength > 0 ? http.expectedContentLength + offset : 0 }

                // 侧车保存 URL、强验证器、总长
                let sidecar = Sidecar(url: task.downloadUrl, etag: (etag?.hasPrefix("\"") ?? false) ? etag : nil,
                                      lastModified: etag == nil ? lastModified : nil, totalBytes: totalBytes > 0 ? totalBytes : nil)
                try? JSONEncoder().encode(sidecar).write(to: sidecarURL(dest))

                try await consume(bytes: bytes, response: http, task: task, dest: dest, partial: partial, offset: offset)
            } catch is CancellationError {
                // 取消：保留可信临时前缀
                states[id] = .paused
            } catch {
                states[id] = .error(Http.describe(error))
                if var t = (try? db.allTasks())?.first(where: { $0.id == id }) {
                    t.status = DownloadStatus.error.rawValue
                    t.errorMessage = Http.describe(error)
                    try? db.upsertTask(t)
                }
            }
        }
    }

    private func stripRange(_ request: URLRequest) -> URLRequest {
        var r = request
        r.setValue(nil, forHTTPHeaderField: "Range")
        r.setValue(nil, forHTTPHeaderField: "If-Range")
        return r
    }

    struct Sidecar: Codable {
        var url: String
        var etag: String?
        var lastModified: String?
        var totalBytes: Int64?
    }

    private func sidecarURL(_ dest: URL) -> URL { dest.appendingPathExtension("meta.json") }

    /// 64KiB 缓冲写盘 + 300ms 内存进度 / 2s 持久化节流 + EOF 核对
    private func consume(bytes: URLSession.AsyncBytes, response: HTTPURLResponse, task: DownloadTaskEntity,
                         dest: URL, partial: URL, offset: Int64 = 0) async throws {
        let id = task.id
        let fileHandle = try FileHandle(forWritingTo: partial)
        defer { try? fileHandle.close() }
        if offset > 0 { try? fileHandle.seek(toOffset: UInt64(offset)) }

        var downloaded = offset
        var lastMemoryUpdate = Date.distantPast
        var lastPersist = Date()
        var buffer = Data()
        buffer.reserveCapacity(64 * 1024)
        let startedAt = Date()
        let startBytes = offset

        var finished = false
        for try await byte in bytes {
            if Task.isCancelled { throw CancellationError() }
            buffer.append(byte)
            if buffer.count >= 64 * 1024 {
                try fileHandle.write(contentsOf: buffer)
                downloaded += Int64(buffer.count)
                buffer.removeAll(keepingCapacity: true)
                let now = Date()
                if now.timeIntervalSince(lastMemoryUpdate) >= 0.3 {
                    lastMemoryUpdate = now
                    let speed = Int64(Double(downloaded - startBytes) / max(0.001, now.timeIntervalSince(startedAt)))
                    let remaining = task.totalBytes > 0 ? max(0, task.totalBytes - downloaded) : 0
                    states[id] = .downloading(progress: task.totalBytes > 0 ? Double(downloaded) / Double(task.totalBytes) : 0,
                                              bytesPerSecond: speed, remainingBytes: remaining)
                }
                if now.timeIntervalSince(lastPersist) >= 2.0 {
                    lastPersist = now
                    persistProgress(task: task, downloaded: downloaded)
                }
            }
        }
        if !buffer.isEmpty {
            try fileHandle.write(contentsOf: buffer)
            downloaded += Int64(buffer.count)
        }
        finished = true
        _ = finished

        // EOF 核对长度
        if response.expectedContentLength > 0 {
            let expected = response.expectedContentLength + offset
            if downloaded != expected {
                throw ImportError("下载长度不符（\(downloaded)/\(expected)）")
            }
        }

        // 真实格式校验 + 改名
        let realFormat = try DownloadFileValidator.validate(fileURL: partial, declaredFormat: task.format)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: partial, to: dest)
        try? FileManager.default.removeItem(at: sidecarURL(dest))

        // 自动入库（导入成功才算完成；失败保留文件可离线重试导入）
        var updated = task
        updated.status = DownloadStatus.success.rawValue
        updated.downloadedBytes = downloaded
        updated.totalBytes = max(task.totalBytes, downloaded)
        updated.filePath = dest.path
        updated.format = realFormat.rawValue == "html" ? task.format : realFormat.rawValue
        try? db.upsertTask(updated)
        states[id] = .success
        do {
            _ = try await BookRepository.importBook(from: dest, suggestedName: "\(task.title).\(updated.format)")
            AppToastCenter.shared.show("《\(task.title)》已入库", kind: .success)
        } catch {
            var failed = updated
            failed.status = DownloadStatus.error.rawValue
            failed.errorMessage = "已下载但解析失败：\(error.localizedDescription)"
            try? db.upsertTask(failed)
            states[id] = .error(failed.errorMessage ?? "解析失败")
        }
    }

    private func persistProgress(task: DownloadTaskEntity, downloaded: Int64) {
        var t = task
        t.status = DownloadStatus.downloading.rawValue
        t.downloadedBytes = downloaded
        try? db.upsertTask(t)
    }
}

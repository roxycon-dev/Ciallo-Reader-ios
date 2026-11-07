import Capacitor
import CryptoKit
import Foundation

private func backgroundFailure(_ text: String) -> NSError {
    NSError(domain: "ReaderBackgroundDownload", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
}

/// One durable session. Only unauthenticated HTTPS transfers enter this session:
/// iOS follows background redirects without calling the app's redirect delegate.
final class ReaderBackgroundDownloadSession: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = ReaderBackgroundDownloadSession()
    static let identifier = "com.aistudio.ciallo.reader.background-books"
    private static let maxBytes: Int64 = 512 * 1024 * 1024
    private let queue = DispatchQueue(label: "reader.background-downloads", qos: .utility)
    private var callbacks: [() -> Void] = []
    private var discarded = Set<Int>()
    private var activeTasks: [String: URLSessionDownloadTask] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 3600
        config.httpMaximumConnectionsPerHost = 4
        let delegates = OperationQueue()
        delegates.maxConcurrentOperationCount = 1; delegates.underlyingQueue = queue
        return URLSession(configuration: config, delegate: self, delegateQueue: delegates)
    }()
    private struct Item: Codable {
        let fingerprint: String
        let status: Int?
        let headers: [String: String]?
        let url: String?
        let size: Int64?
        let error: String?
    }

    func connect(completion: (() -> Void)? = nil) {
        queue.async {
            if let completion = completion { self.callbacks.append(completion) }
            _ = self.session
        }
    }

    private func files(_ key: String, _ ext: String) throws -> URL {
        var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("reader-background-books", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        guard root.resolvingSymlinksInPath().path == root.path else { throw backgroundFailure("后台下载目录无效") }
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try? root.setResourceValues(values)
        return root.appendingPathComponent(key + "." + ext)
    }

    private func metadata(_ key: String) -> Item? {
        guard let path = try? files(key, "json"),
              let data = try? Data(contentsOf: path), data.count <= 300 * 1024 else { return nil }
        return try? JSONDecoder().decode(Item.self, from: data)
    }

    private func save(_ item: Item, key: String) throws {
        try JSONEncoder().encode(item).write(to: files(key, "json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func remove(_ key: String) {
        for ext in ["json", "body", "resume", "fingerprint"] {
            if let path = try? files(key, ext) { try? FileManager.default.removeItem(at: path) }
        }
    }

    private func identity(_ task: URLSessionTask) -> (key: String, fingerprint: String)? {
        let parts = task.taskDescription?.split(separator: ".", omittingEmptySubsequences: false)
        guard let parts = parts, parts.count == 2, let first = parts.first, let last = parts.last,
              Self.isKey(String(first)), Self.isKey(String(last)) else { return nil }
        return (String(first), String(last))
    }

    static func isKey(_ key: String) -> Bool { key.count == 64 && key.allSatisfy { "0123456789abcdef".contains($0) } }

    private func tasks(_ block: @escaping ([String: URLSessionDownloadTask]) -> Void) {
        session.getAllTasks { tasks in
            self.queue.async {
                var current = self.activeTasks
                for task in tasks {
                    if let item = self.identity(task), let download = task as? URLSessionDownloadTask,
                       task.state != .completed, task.state != .canceling, !self.discarded.contains(task.taskIdentifier) {
                        current[item.key] = current[item.key] ?? download
                    }
                }
                self.activeTasks = current
                block(current)
            }
        }
    }

    func start(_ call: CAPPluginCall, key: String, request: URLRequest, fingerprint: String) {
        queue.async {
            self.tasks { tasks in
                if let task = tasks[key], self.identity(task)?.fingerprint == fingerprint { call.resolve(); return }
                if let item = self.metadata(key), item.fingerprint == fingerprint, item.status != nil { call.resolve(); return }
                if let old = tasks[key] { self.discarded.insert(old.taskIdentifier); old.cancel(); self.activeTasks[key] = nil }
                do {
                    var resume: Data?
                    if let stamp = try? String(contentsOf: self.files(key, "fingerprint"), encoding: .utf8), stamp == fingerprint {
                        resume = try? Data(contentsOf: self.files(key, "resume"))
                        if (resume?.count ?? 0) > 4 * 1024 * 1024 { resume = nil }
                    }
                    let directory = try self.files(key, "body").deletingLastPathComponent()
                    let capacity = try directory.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity ?? 0
                    guard capacity >= 16 * 1024 * 1024 else { throw backgroundFailure("存储空间不足，请清理后重试") }
                    self.remove(key)
                    let task = resume.map { self.session.downloadTask(withResumeData: $0) } ?? self.session.downloadTask(with: request)
                    task.taskDescription = key + "." + fingerprint
                    self.activeTasks[key] = task
                    task.resume()
                    call.resolve()
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }

    func status(_ call: CAPPluginCall, key: String) {
        queue.async {
            self.tasks { tasks in
                if let item = self.metadata(key) {
                    if let error = item.error { call.resolve(["state": "failed", "error": error]); return }
                    if let status = item.status, let headers = item.headers, let url = item.url, let size = item.size {
                        call.resolve(["state": "ready", "status": status, "headers": headers, "url": url, "size": size]); return
                    }
                }
                if let task = tasks[key] {
                    call.resolve(["state": "running", "written": task.countOfBytesReceived, "total": task.countOfBytesExpectedToReceive]); return
                }
                call.resolve(["state": "missing"])
            }
        }
    }

    func read(_ call: CAPPluginCall, key: String, offset: Int64, length: Int) {
        queue.async {
            do {
                guard let size = self.metadata(key)?.size, offset <= size - Int64(length) else { throw backgroundFailure("后台下载文件读取范围无效") }
                let handle = try FileHandle(forReadingFrom: self.files(key, "body")); defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let bytes = try handle.read(upToCount: length) ?? Data()
                guard bytes.count == length else { throw backgroundFailure("后台下载文件不完整") }
                call.resolve(["data": bytes.base64EncodedString()])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    func stop(_ call: CAPPluginCall, key: String, keep: Bool) {
        queue.async {
            self.tasks { tasks in
                guard let task = tasks[key] else { if !keep { self.remove(key) }; call.resolve(); return }
                self.discarded.insert(task.taskIdentifier); self.activeTasks[key] = nil
                if !keep {
                    task.cancel(); self.remove(key); call.resolve(); return
                }
                let fingerprint = self.identity(task)?.fingerprint
                task.cancel(byProducingResumeData: { data in
                    self.queue.async {
                        if let data = data, let fingerprint = fingerprint, data.count <= 4 * 1024 * 1024 {
                            do {
                                try data.write(to: self.files(key, "resume"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                                try Data(fingerprint.utf8).write(to: self.files(key, "fingerprint"), options: .atomic)
                            } catch { self.remove(key) }
                        }
                        call.resolve()
                    }
                })
            }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard !discarded.contains(downloadTask.taskIdentifier) else { return }
        if totalBytesWritten > Self.maxBytes || totalBytesExpectedToWrite > Self.maxBytes {
            if let item = identity(downloadTask) {
                try? save(Item(fingerprint: item.fingerprint, status: nil, headers: nil, url: nil, size: nil, error: "下载文件过大"), key: item.key)
            }
            downloadTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let item = identity(downloadTask), !discarded.contains(downloadTask.taskIdentifier) else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, let final = response.url,
                  final.scheme?.lowercased() == "https",
                  let size = try location.resourceValues(forKeys: [.fileSizeKey]).fileSize, Int64(size) <= Self.maxBytes else {
                throw backgroundFailure("后台下载响应无效或超过大小限制")
            }
            var headers: [String: String] = [:]
            for (key, value) in response.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
            guard headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count }) <= 256 * 1024 else { throw backgroundFailure("后台下载响应头过大") }
            var status = response.statusCode
            // A download task resumed by Foundation can report 206 even though
            // its temp file contains the combined body from the original GET.
            if status == 206, let range = headers["content-range"], let total = range.split(separator: "/").last,
               Int64(total) == Int64(size) {
                status = 200
                headers.removeValue(forKey: "content-range")
                headers["content-length"] = String(size)
            }
            let file = try files(item.key, "body")
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            try FileManager.default.moveItem(at: location, to: file)
            try save(Item(fingerprint: item.fingerprint, status: status, headers: headers,
                          url: final.absoluteString, size: Int64(size), error: nil), key: item.key)
        } catch {
            remove(item.key)
            try? save(Item(fingerprint: item.fingerprint, status: nil, headers: nil, url: nil, size: nil, error: error.localizedDescription), key: item.key)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let item = identity(task) else { return }
        if activeTasks[item.key]?.taskIdentifier == task.taskIdentifier { activeTasks[item.key] = nil }
        guard discarded.remove(task.taskIdentifier) == nil, metadata(item.key) == nil else { return }
        if error != nil {
            try? save(Item(fingerprint: item.fingerprint, status: nil, headers: nil, url: nil, size: nil, error: "后台下载连接中断"), key: item.key)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let pending = callbacks; callbacks.removeAll()
        DispatchQueue.main.async { for callback in pending { callback() } }
    }
}

@objc(ReaderBackgroundDownloadsPlugin)
final class ReaderBackgroundDownloadsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ReaderBackgroundDownloadsPlugin"
    let jsName = "ReaderBackgroundDownloads"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]
    private let downloads = ReaderBackgroundDownloadSession.shared
    private func key(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), ReaderBackgroundDownloadSession.isKey(key) else {
            call.reject("后台下载任务无效"); return nil
        }
        return key
    }
    @objc func start(_ call: CAPPluginCall) {
        guard let key = key(call) else { return }
        guard let raw = call.getString("url"), raw.utf8.count <= 16 * 1024, let url = URL(string: raw),
              url.scheme?.lowercased() == "https", url.host != nil, url.user == nil, url.password == nil else {
            call.reject("后台下载需要公开 HTTPS 链接"); return
        }
        let headers = call.getObject("headers") ?? [:]
        let allowed = ["accept", "accept-encoding", "user-agent"]
        var request = URLRequest(url: url); request.httpShouldHandleCookies = false
        var identity = raw + "\n"
        for name in headers.keys.sorted() {
            guard allowed.contains(name.lowercased()), let value = headers[name] as? String,
                  value.utf8.count <= 4096, !value.contains("\r"), !value.contains("\n"), !value.contains("\0") else {
                call.reject("后台下载不能附带登录凭据"); return
            }
            request.setValue(value, forHTTPHeaderField: name); identity += "\(name.lowercased()):\(value)\n"
        }
        let fingerprint = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", Int($0)) }.joined()
        downloads.start(call, key: key, request: request, fingerprint: fingerprint)
    }
    @objc func status(_ call: CAPPluginCall) { if let key = key(call) { downloads.status(call, key: key) } }
    @objc func stop(_ call: CAPPluginCall) { if let key = key(call) { downloads.stop(call, key: key, keep: call.getBool("keep") == true) } }
    @objc func read(_ call: CAPPluginCall) {
        guard let key = key(call), let offset = call.getDouble("offset"), offset.isFinite,
              offset >= 0, offset <= 512 * 1024 * 1024, offset == offset.rounded(.down),
              let length = call.getInt("length"), (1...512 * 1024).contains(length) else {
            call.reject("后台下载读取参数无效"); return
        }
        downloads.read(call, key: key, offset: Int64(offset), length: length)
    }
}

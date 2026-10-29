import Foundation
import Capacitor
import Network

private func httpFailure(_ message: String) -> NSError { NSError(domain: "ReaderHttp", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

/// URLSession delivers original decoded entity bytes without JSON/string
/// interpretation. A private spool keeps the native bridge bounded.
@objc(ReaderHttpPlugin)
public class ReaderHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderHttpPlugin"
    public let jsName = "ReaderHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fixture", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "ciallo.http.requests", qos: .utility)
    private var requests: [String: NativeByteRequest] = [:]
    private var cancelled: [String: Date] = [:]
    deinit { let pending = Array(requests.values); queue.async { for operation in pending { operation.dispose() } } }
    public override func load() {
        queue.async {
            let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("reader-http", isDirectory: true)
            guard root.resolvingSymlinksInPath().path == root.path,
                  let files = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
            // There are no live operations when the plugin is first loaded.
            for file in files where file.pathExtension == "body" && UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil { try? FileManager.default.removeItem(at: file) }
        }
    }
    #if DEBUG && targetEnvironment(simulator)
    private var testServer: NativeHttpFixture?
    #endif
    @objc func fixture(_ call: CAPPluginCall) {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["CIALLO_NATIVE_TESTS"] == "1" else { call.reject("Native tests disabled"); return }
        queue.async {
            switch call.getString("action") ?? "" {
            case "start":
                guard self.testServer == nil else { call.reject("HTTP test server already started"); return }
                let server = NativeHttpFixture(queue: self.queue); self.testServer = server
                server.start { result in switch result { case .success(let url): call.resolve(["url": url]); case .failure(let error): self.testServer = nil; call.reject(error.localizedDescription) } }
            case "status": call.resolve(["cancelledSlowConnections": self.testServer?.cancelledSlowConnections ?? 0, "slowStarted": self.testServer?.slowStarted ?? 0, "activeRequests": self.requests.count])
            case "stop": self.testServer?.stop(); self.testServer = nil; call.resolve()
            default: call.reject("Unknown HTTP test action")
            }
        }
        #else
        call.reject("Native tests disabled")
        #endif
    }
    private func id(_ call: CAPPluginCall) -> String? {
        guard let id = call.getString("id"), UUID(uuidString: id)?.uuidString.lowercased() == id else { call.reject("HTTP 请求身份无效"); return nil }; return id
    }
    @objc func begin(_ call: CAPPluginCall) {
        guard let id = id(call), let raw = call.getString("url"), raw.utf8.count <= 16384,
              let url = URL(string: raw), Self.remote(url), let method = call.getString("method"),
              ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].contains(method) else { call.reject("HTTP 请求参数无效"); return }
        let timeout = call.getDouble("timeoutMs") ?? 30000, policy = call.getString("redirect") ?? "follow"
        guard timeout.isFinite, timeout >= 1, timeout <= 3600000, ["follow", "manual", "error"].contains(policy) else { call.reject("HTTP 超时或重定向设置无效"); return }
        let headers = call.getObject("headers") ?? [:]
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout / 1000)
        request.httpMethod = method
        guard headers.count <= 256 else { call.reject("HTTP 请求头过多"); return }
        var headerBytes = 0
        for (key, value) in headers {
            guard let value = value as? String, key.range(of: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$", options: .regularExpression) != nil,
                  !value.contains("\r"), !value.contains("\n"), !value.contains("\0") else { call.reject("HTTP 请求头无效"); return }
            headerBytes += key.utf8.count + value.utf8.count
            guard headerBytes <= 65536 else { call.reject("HTTP 请求头过大"); return }
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let encoded = call.getString("body") {
            guard encoded.utf8.count <= 44739244, let body = Data(base64Encoded: encoded), body.count <= 32 * 1024 * 1024 else { call.reject("HTTP 请求体过大或编码无效"); return }; request.httpBody = body
        }
        self.queue.async {
            self.cancelled = self.cancelled.filter { Date().timeIntervalSince($0.value) < 120 }
            guard self.cancelled.removeValue(forKey: id) == nil else { call.reject("HTTP 请求已取消"); return }
            guard self.requests[id] == nil, self.requests.count < 32 else { call.reject("HTTP 请求数量超限或身份重复"); return }
            do {
                let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("reader-http", isDirectory: true)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                guard root.resolvingSymlinksInPath().path == root.path else { throw httpFailure("HTTP 缓存目录无效") }
                let file = root.appendingPathComponent(id + ".body")
                let operation = try NativeByteRequest(request: request, file: file, queue: self.queue, timeout: timeout / 1000, redirect: policy) { [weak self] result in
                    switch result {
                    case .success(let response):
                        call.resolve(response)
                        let finished = self?.requests[id]
                        self?.queue.asyncAfter(deadline: .now() + 120) { [weak self, weak finished] in
                            guard let finished = finished, self?.requests[id] === finished else { return }; self?.requests.removeValue(forKey: id)?.dispose()
                        }
                    case .failure(let error): self?.requests.removeValue(forKey: id)?.dispose(); call.reject(error.localizedDescription)
                    }
                }
                self.requests[id] = operation; operation.start()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func read(_ call: CAPPluginCall) {
        guard let id = id(call), let offset = call.getDouble("offset"), let length = call.getInt("length"), offset.isFinite, offset >= 0, offset <= 512 * 1024 * 1024, offset.rounded(.down) == offset, length > 0, length <= 512 * 1024 else { call.reject("HTTP 分块参数无效"); return }
        queue.async {
            do {
                guard let operation = self.requests[id], operation.succeeded, Int64(offset) + Int64(length) <= operation.size else { throw httpFailure("HTTP 响应已释放或分块越界") }
                let input = try FileHandle(forReadingFrom: operation.file); defer { try? input.close() }
                try input.seek(toOffset: UInt64(offset)); let data = try input.read(upToCount: length) ?? Data()
                guard data.count == length else { throw httpFailure("HTTP 响应分块不完整") }; call.resolve(["data": data.base64EncodedString()])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = id(call) else { return }
        queue.async {
            if let operation = self.requests[id] { operation.abort(httpFailure("HTTP 请求已取消")); self.requests.removeValue(forKey: id)?.dispose() }
            else { if self.cancelled.count >= 128 { self.cancelled.removeAll() }; self.cancelled[id] = Date() }
            call.resolve()
        }
    }
    @objc func release(_ call: CAPPluginCall) {
        guard let id = id(call) else { return }
        queue.async { self.requests.removeValue(forKey: id)?.dispose(); self.cancelled.removeValue(forKey: id); call.resolve() }
    }
    fileprivate static func remote(_ url: URL) -> Bool { ["http", "https"].contains(url.scheme?.lowercased() ?? "") && url.host != nil && url.user == nil && url.password == nil }
}

#if DEBUG && targetEnvironment(simulator)
/// A real TCP fixture proves URLSession delegate bytes, redirects and socket
/// cancellation without depending on an external service or credentials.
private final class NativeHttpFixture {
    private let queue: DispatchQueue
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]
    private var ready: ((Result<String, Error>) -> Void)?
    private(set) var cancelledSlowConnections = 0
    private(set) var slowStarted = 0
    init(queue: DispatchQueue) { self.queue = queue }
    func start(_ completion: @escaping (Result<String, Error>) -> Void) {
        ready = completion
        do {
            let parameters = NWParameters.tcp; parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
            let listener = try NWListener(using: parameters, on: .any); self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in
                guard let self = self else { connection.cancel(); return }
                self.clients[ObjectIdentifier(connection)] = connection
                connection.stateUpdateHandler = { [weak self, weak connection] state in
                    guard let self = self, let connection = connection else { return }
                    if case .ready = state { self.read(connection, bytes: Data()) }
                }
                connection.start(queue: self.queue)
            }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self, let ready = self.ready else { return }
                if case .ready = state, let port = listener.port { self.ready = nil; ready(.success("http://127.0.0.1:\(port.rawValue)")) }
                else if case .failed(let error) = state { self.ready = nil; ready(.failure(error)); self.stop() }
            }
            listener.start(queue: queue)
        } catch { ready = nil; completion(.failure(error)) }
    }
    func stop() { listener?.cancel(); listener = nil; for client in clients.values { client.cancel() }; clients.removeAll() }
    private func close(_ connection: NWConnection) { clients.removeValue(forKey: ObjectIdentifier(connection)); connection.cancel() }
    private func read(_ connection: NWConnection, bytes: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self, weak connection] data, _, ended, error in
            guard let self = self, let connection = connection else { return }
            var bytes = bytes; if let data = data { bytes.append(data) }
            guard bytes.count <= 2 * 1024 * 1024 else { self.close(connection); return }
            if let boundary = bytes.range(of: Data("\r\n\r\n".utf8)), let header = String(data: bytes[..<boundary.lowerBound], encoding: .utf8) {
                let lines = header.components(separatedBy: "\r\n"), path = lines.first?.components(separatedBy: " ").dropFirst().first ?? "/"
                let length = lines.first(where: { $0.lowercased().hasPrefix("content-length:") }).flatMap { Int($0.dropFirst(15).trimmingCharacters(in: .whitespaces)) } ?? 0
                guard length >= 0, length <= 1024 * 1024 else { self.close(connection); return }
                if bytes.count - boundary.upperBound >= length {
                    let body = Data(bytes[boundary.upperBound..<(boundary.upperBound + length)])
                    if path == "/slow" {
                        self.slowStarted += 1
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self, weak connection] _, _, ended, error in
                            guard let self = self, let connection = connection else { return }
                            if ended || error != nil { self.cancelledSlowConnections += 1; self.close(connection) }
                        }
                        self.queue.asyncAfter(deadline: .now() + 2) { [weak self, weak connection] in
                            guard let self = self, let connection = connection, self.clients[ObjectIdentifier(connection)] != nil else { return }; self.respond(connection, path: "/binary", body: Data())
                        }
                    } else { self.respond(connection, path: path, body: body) }
                    return
                }
            }
            if ended || error != nil { self.close(connection) } else { self.read(connection, bytes: bytes) }
        }
    }
    private func respond(_ connection: NWConnection, path: String, body: Data) {
        let binary = Data([0, 255, 128, 0xd6, 0xd0, 0xce, 0xc4]), json = Data(" { \"z\":1, \"a\":2, \"a\":3 }\r\n".utf8)
        let payload = path == "/json" ? json : path == "/echo" ? body : path == "/redirect" ? Data("redirect".utf8) : binary
        let status = path == "/redirect" ? "302 Found" : "200 OK", location = path == "/redirect" ? "Location: /binary\r\n" : ""
        let length = path == "/large" ? 600 * 1024 * 1024 : payload.count
        var response = Data("HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(length)\r\n\(location)Connection: close\r\n\r\n".utf8)
        if path != "/large" { response.append(payload) }
        connection.send(content: response, completion: .contentProcessed { [weak self, weak connection] _ in if let connection = connection { self?.close(connection) } })
    }
}
#endif

private final class NativeByteRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    let file: URL
    private(set) var size: Int64 = 0
    private(set) var succeeded = false
    private var completed = false
    private var output: FileHandle?
    private let request: URLRequest, queue: DispatchQueue, timeout: TimeInterval, redirect: String
    private let complete: (Result<[String: Any], Error>) -> Void
    private var session: URLSession?, task: URLSessionDataTask?, timer: DispatchSourceTimer?
    private var response: HTTPURLResponse?
    private var redirects = 0
    init(request: URLRequest, file: URL, queue: DispatchQueue, timeout: TimeInterval, redirect: String, complete: @escaping (Result<[String: Any], Error>) -> Void) throws {
        self.request = request; self.file = file; self.queue = queue; self.timeout = timeout; self.redirect = redirect; self.complete = complete
        super.init()
        guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw httpFailure("无法创建 HTTP 缓存") }
        do { output = try FileHandle(forWritingTo: file) } catch { try? FileManager.default.removeItem(at: file); throw error }
    }
    func start() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout; configuration.timeoutIntervalForResource = timeout
        configuration.httpCookieStorage = .shared; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        let delegates = OperationQueue(); delegates.maxConcurrentOperationCount = 1; delegates.underlyingQueue = queue
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegates); self.session = session
        let timer = DispatchSource.makeTimerSource(queue: queue); self.timer = timer
        timer.schedule(deadline: .now() + timeout); timer.setEventHandler { [weak self] in self?.abort(httpFailure("HTTP 请求超时")) }; timer.resume()
        task = session.dataTask(with: request); task?.resume()
    }
    func abort(_ error: Error) {
        guard !completed else { return }; completed = true
        timer?.cancel(); timer = nil; task?.cancel(); session?.invalidateAndCancel(); try? output?.close(); output = nil; complete(.failure(error))
    }
    func dispose() { abort(httpFailure("HTTP 请求已释放")); try? output?.close(); output = nil; timer?.cancel(); timer = nil; session?.invalidateAndCancel(); try? FileManager.default.removeItem(at: file) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !completed, let response = response as? HTTPURLResponse else { completionHandler(.cancel); abort(httpFailure("HTTP 响应无效")); return }
        guard request.httpMethod == "HEAD" || response.expectedContentLength <= 512 * 1024 * 1024 else { completionHandler(.cancel); abort(httpFailure("HTTP 响应超过 512MiB")); return }
        self.response = response; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !completed else { return }
        do {
            guard Int64(data.count) <= 512 * 1024 * 1024 - size else { throw httpFailure("HTTP 响应超过 512MiB") }
            try output?.write(contentsOf: data); size += Int64(data.count)
        } catch { abort(error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !completed else { return }
        if let error = error { abort(error); return }
        do {
            guard let response = response else { throw httpFailure("HTTP 响应缺失") }
            try output?.synchronize(); try output?.close(); output = nil
            var headers: [String: String] = [:]
            for (key, value) in response.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
            guard headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count }) <= 256 * 1024 else { throw httpFailure("HTTP 响应头过大") }
            completed = true; succeeded = true; timer?.cancel(); timer = nil; session.finishTasksAndInvalidate()
            complete(.success(["status": response.statusCode, "headers": headers, "url": response.url?.absoluteString ?? request.url!.absoluteString, "size": size]))
        } catch { abort(error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard !completed else { completionHandler(nil); return }
        if redirect == "manual" { completionHandler(nil); return }
        guard redirect != "error", let url = request.url, ReaderHttpPlugin.remote(url), redirects < 20 else { completionHandler(nil); abort(httpFailure("HTTP 重定向被拒绝或次数过多")); return }
        redirects += 1; var next = request
        let previous = response.url
        if url.scheme != previous?.scheme || url.host != previous?.host || url.port != previous?.port {
            next.setValue(nil, forHTTPHeaderField: "Authorization"); next.setValue(nil, forHTTPHeaderField: "Proxy-Authorization"); next.setValue(nil, forHTTPHeaderField: "Cookie")
        }
        completionHandler(next)
    }
}

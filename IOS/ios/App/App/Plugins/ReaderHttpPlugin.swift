import Foundation
import Capacitor
import Network
import Security

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
    private static let insecureCredentialHeaders: Set<String> = [
        "authorization", "cookie", "cookie2", "set-cookie", "proxy-authorization", "proxy-authenticate",
        "api-key", "x-api-key", "x-auth-token", "x-access-token", "x-client-secret"
    ]
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
            case "policy":
                var request = URLRequest(url: URL(string: "https://example.com:443/next")!)
                for field in ["Authorization", "Proxy-Authorization", "Cookie", "X-Api-Key"] { request.setValue("isolated-test", forHTTPHeaderField: field) }
                let same = Self.redirectRequest(request, from: URL(string: "https://EXAMPLE.com/start"))
                let cross = Self.redirectRequest(request, from: URL(string: "https://other.example/start"))
                guard same.value(forHTTPHeaderField: "Authorization") == "isolated-test", ["Authorization", "Proxy-Authorization", "Cookie", "X-Api-Key"].allSatisfy({ cross.value(forHTTPHeaderField: $0) == nil }) else { call.reject("Native redirect credential policy differs"); return }
                call.resolve(["detail": "same-origin normalization and cross-origin credential removal verified"])
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
        let timeout = call.getDouble("timeoutMs") ?? 30000
        let requestedPolicy = call.getString("redirect") ?? "follow"
        let insecureTls = call.getBool("insecureTls") == true
        let policy = insecureTls ? "error" : requestedPolicy
        let maximum = call.getDouble("maxBytes") ?? 512 * 1024 * 1024
        guard timeout.isFinite, timeout >= 1, timeout <= 3600000, maximum.isFinite, maximum >= 1, maximum <= 512 * 1024 * 1024, maximum.rounded(.down) == maximum, ["follow", "manual", "error"].contains(requestedPolicy) else { call.reject("HTTP 超时、大小或重定向设置无效"); return }
        let headers = call.getObject("headers") ?? [:]
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout / 1000)
        request.httpMethod = method
        guard headers.count <= 256 else { call.reject("HTTP 请求头过多"); return }
        if insecureTls && (url.scheme?.lowercased() != "https" || headers.keys.contains(where: { Self.insecureCredentialHeaders.contains($0.lowercased()) })) {
            call.reject("不安全 TLS 书源仅支持无登录或代理凭据的 HTTPS 请求")
            return
        }
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
                let operation = try NativeByteRequest(request: request, file: file, queue: self.queue, timeout: timeout / 1000,
                                                      maximum: Int64(maximum), redirect: policy,
                                                      insecureTlsHost: insecureTls ? url.host?.lowercased() : nil,
                                                      progressive: call.getBool("progressive") == true,
                                                      resolve: { result in
                    switch result {
                    case .success(let response): call.resolve(response)
                    case .failure(let error): call.reject(error.localizedDescription)
                    }
                }, terminal: { [weak self] in
                    let finished = self?.requests[id]
                    self?.queue.asyncAfter(deadline: .now() + 120) { [weak self, weak finished] in
                        guard let finished = finished, self?.requests[id] === finished else { return }
                        self?.requests.removeValue(forKey: id)?.dispose()
                    }
                })
                self.requests[id] = operation; operation.start()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func read(_ call: CAPPluginCall) {
        guard let id = id(call), let offset = call.getDouble("offset"), let length = call.getInt("length"), offset.isFinite, offset >= 0, offset <= 512 * 1024 * 1024, offset.rounded(.down) == offset, length > 0, length <= 512 * 1024 else { call.reject("HTTP 分块参数无效"); return }
        queue.async {
            guard let operation = self.requests[id] else { call.reject("HTTP 响应已释放"); return }
            operation.read(offset: Int64(offset), length: length) { result in
                switch result {
                case .success(let data): call.resolve(["data": data.base64EncodedString()])
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
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
    fileprivate static func redirectRequest(_ request: URLRequest, from previous: URL?) -> URLRequest {
        func origin(_ value: URL?) -> String {
            guard let value = value else { return "" }; let scheme = value.scheme?.lowercased() ?? ""
            return "\(scheme)://\(value.host?.lowercased() ?? ""):\(value.port ?? (scheme == "https" ? 443 : 80))"
        }
        var next = request
        if origin(request.url) != origin(previous) {
            for field in ["Authorization", "Proxy-Authorization", "Cookie", "X-Api-Key"] { next.setValue(nil, forHTTPHeaderField: field) }
        }
        return next
    }
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
                    if path == "/zlib-fixture-entry" {
                        self.respondFixture(connection, status: "200 OK",
                            headers: "Content-Type: text/html; charset=utf-8\r\nSet-Cookie: ciallo_native_book=ready; Path=/\r\n",
                            body: Data("<html><body>Download entry</body></html>".utf8))
                    } else if path == "/zlib-fixture-download" {
                        self.respondFixture(connection, status: "302 Found", headers: "Location: /zlib-fixture-file\r\n", body: Data())
                    } else if path == "/zlib-fixture-file" {
                        let authorized = lines.contains { $0.lowercased().hasPrefix("cookie:") && $0.contains("ciallo_native_book=ready") }
                        self.respondFixture(connection, status: authorized ? "200 OK" : "403 Forbidden",
                            headers: authorized ? "Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=fixture.epub\r\n" : "Content-Type: text/html\r\n",
                            body: Data((authorized ? "attachment" : "<html>Missing entry cookie</html>").utf8))
                    } else if path == "/progressive" {
                        var response = Data("HTTP/1.1 200 OK\r\nContent-Length: 131072\r\nConnection: close\r\n\r\n".utf8)
                        response.append(Data(repeating: 0xA5, count: 64 * 1024))
                        connection.send(content: response, completion: .contentProcessed { _ in })
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self, weak connection] _, _, ended, error in
                            guard let self = self, let connection = connection else { return }
                            if ended || error != nil { self.cancelledSlowConnections += 1; self.close(connection) }
                        }
                    } else if path == "/slow" {
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
    private func respondFixture(_ connection: NWConnection, status: String, headers: String, body: Data) {
        var response = Data("HTTP/1.1 \(status)\r\n\(headers)Content-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { [weak self, weak connection] _ in
            if let connection = connection { self?.close(connection) }
        })
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
    private var succeeded = false
    private var failure: Error?
    private var declaredLength: Int64?
    private var waiting: (offset: Int64, length: Int, callback: (Result<Data, Error>) -> Void)?
    private var completed = false
    private var output: FileHandle?
    private let request: URLRequest, queue: DispatchQueue, timeout: TimeInterval, redirect: String
    private let insecureTlsHost: String?
    private let progressive: Bool
    private var resolve: ((Result<[String: Any], Error>) -> Void)?
    private let terminal: () -> Void
    private var session: URLSession?, task: URLSessionDataTask?, timer: DispatchSourceTimer?
    private var response: HTTPURLResponse?
    private var redirects = 0
    private let maximum: Int64
    init(request: URLRequest, file: URL, queue: DispatchQueue, timeout: TimeInterval, maximum: Int64, redirect: String,
         insecureTlsHost: String?, progressive: Bool,
         resolve: @escaping (Result<[String: Any], Error>) -> Void, terminal: @escaping () -> Void) throws {
        self.maximum = maximum
        self.request = request; self.file = file; self.queue = queue; self.timeout = timeout; self.redirect = redirect
        self.insecureTlsHost = insecureTlsHost
        self.progressive = progressive; self.resolve = resolve; self.terminal = terminal
        super.init()
        guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw httpFailure("无法创建 HTTP 缓存") }
        do { output = try FileHandle(forWritingTo: file) } catch { try? FileManager.default.removeItem(at: file); throw error }
    }
    func start() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout; configuration.timeoutIntervalForResource = timeout
        if insecureTlsHost != nil {
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.httpCookieAcceptPolicy = .never
        } else {
            configuration.httpCookieStorage = .shared
        }
        configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        let delegates = OperationQueue(); delegates.maxConcurrentOperationCount = 1; delegates.underlyingQueue = queue
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegates); self.session = session
        let timer = DispatchSource.makeTimerSource(queue: queue); self.timer = timer
        timer.schedule(deadline: .now() + timeout); timer.setEventHandler { [weak self] in self?.abort(httpFailure("HTTP 请求超时")) }; timer.resume()
        task = session.dataTask(with: request); task?.resume()
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard let expectedHost = insecureTlsHost else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        let space = challenge.protectionSpace
        if space.isProxy {
            completionHandler(.rejectProtectionSpace, nil)
            return
        }
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           space.host.lowercased() == expectedHost,
           let trust = space.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            // A mismatched challenge host keeps normal system trust.
            completionHandler(.performDefaultHandling, nil)
        } else {
            // Do not use credentials stored for this host in the relaxed-TLS path.
            completionHandler(.rejectProtectionSpace, nil)
        }
    }
    private func publish(_ result: Result<[String: Any], Error>) {
        let callback = resolve; resolve = nil; callback?(result)
    }

    func abort(_ error: Error) {
        guard !completed else { return }; completed = true; failure = error
        timer?.cancel(); timer = nil; task?.cancel(); session?.invalidateAndCancel(); try? output?.close(); output = nil
        publish(.failure(error)); drainRead(); terminal()
    }

    func dispose() { abort(httpFailure("HTTP 请求已释放")); try? output?.close(); output = nil; timer?.cancel(); timer = nil; session?.invalidateAndCancel(); try? FileManager.default.removeItem(at: file) }

    func read(offset: Int64, length: Int, callback: @escaping (Result<Data, Error>) -> Void) {
        if let failure = failure { callback(.failure(failure)); return }
        guard let expected = declaredLength ?? (succeeded ? size : nil),
              offset <= expected - Int64(length), waiting == nil else {
            callback(.failure(httpFailure("HTTP 响应分块越界或已有待处理读取"))); return
        }
        waiting = (offset, length, callback); drainRead()
    }

    private func drainRead() {
        guard let read = waiting else { return }
        if let failure = failure { waiting = nil; read.callback(.failure(failure)); return }
        let end = read.offset + Int64(read.length)
        // Deliver the last bytes only after URLSession finishes and validates length.
        guard end <= size, succeeded || end < (declaredLength ?? 0) else { return }
        waiting = nil
        read.callback(Result {
            let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
            try input.seek(toOffset: UInt64(read.offset))
            let data = try input.read(upToCount: read.length) ?? Data()
            guard data.count == read.length else { throw httpFailure("HTTP 响应分块不完整") }
            return data
        })
    }

    private func info(_ response: HTTPURLResponse, length: Int64) throws -> [String: Any] {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields { headers[String(describing: key).lowercased()] = String(describing: value) }
        guard headers.reduce(0, { $0 + $1.key.utf8.count + $1.value.utf8.count }) <= 256 * 1024 else { throw httpFailure("HTTP 响应头过大") }
        return ["status": response.statusCode, "headers": headers, "url": response.url?.absoluteString ?? request.url!.absoluteString, "size": length]
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !completed, let response = response as? HTTPURLResponse else { completionHandler(.cancel); abort(httpFailure("HTTP 响应无效")); return }
        guard request.httpMethod == "HEAD" || response.expectedContentLength <= maximum else { completionHandler(.cancel); abort(httpFailure("HTTP 响应超过大小限制")); return }
        self.response = response
        let encoding = response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased() ?? "identity"
        if progressive, request.httpMethod == "GET", [200, 206].contains(response.statusCode),
           response.expectedContentLength > 0, encoding == "identity",
           response.value(forHTTPHeaderField: "Transfer-Encoding") == nil {
            do {
                let length = response.expectedContentLength
                let metadata = try info(response, length: length)
                declaredLength = length
                publish(.success(metadata))
            } catch { completionHandler(.cancel); abort(error); return }
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !completed else { return }
        do {
            guard Int64(data.count) <= (declaredLength ?? maximum) - size else { throw httpFailure("HTTP 响应超过大小限制") }
            try output?.write(contentsOf: data); size += Int64(data.count); drainRead()
        } catch { abort(error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !completed else { return }
        if let error = error { abort(error); return }
        do {
            guard let response = response else { throw httpFailure("HTTP 响应缺失") }
            try output?.synchronize(); try output?.close(); output = nil
            if let expected = declaredLength, expected != size { throw httpFailure("HTTP 响应分块不完整") }
            let metadata = try info(response, length: size)
            completed = true; succeeded = true; timer?.cancel(); timer = nil; session.finishTasksAndInvalidate()
            publish(.success(metadata)); drainRead(); terminal()
        } catch { abort(error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard !completed else { completionHandler(nil); return }
        if redirect == "manual" { completionHandler(nil); return }
        guard redirect != "error", let url = request.url, ReaderHttpPlugin.remote(url), redirects < 20 else { completionHandler(nil); abort(httpFailure("HTTP 重定向被拒绝或次数过多")); return }
        redirects += 1; completionHandler(ReaderHttpPlugin.redirectRequest(request, from: response.url))
    }
}

import Foundation
import Network
import Security

// MARK: - 抗污染 DNS（zlibrary/network/ZLibraryDns.kt 对应物）
// ① 内置私有/保留网段 + Meta/Facebook 段黑名单前缀过滤；② 系统 DNS 结果仅进候选池（限时）；
// ③ AliDNS / DNSPod / Cloudflare / Google 四家 DoH 并行聚合 A 记录；
// ④ probeAndSort 对候选 IP 做 443 TCP 探测（1.5s）可达优先；⑤ 三级缓存
//（正向 5min、失败负缓存 5s、TCP 已验证可达 IP 24h）。

final class ZLibraryDns {
    static let shared = ZLibraryDns()

    struct ResolvedResult {
        let bestIP: String?
        let allCandidates: [String]
        let fromCache: Bool
    }

    private struct CacheEntry {
        let ips: [String]
        let verifiedIP: String?
        let at: Date
        let negative: Bool
    }

    private var cache: [String: CacheEntry] = [:]
    private let lock = NSLock()

    /// 黑名单：保留/私有网段前缀 + Meta/Facebook 段（防解析到墙内假 IP）
    private static let blacklistPrefixes: [String] = [
        "0.", "10.", "100.64.", "100.65.", "100.66.", "100.67.", "100.68.", "100.69.",
        "127.", "169.254.", "172.16.", "172.17.", "172.18.", "172.19.", "172.2", "172.30.", "172.31.",
        "192.0.0.", "192.0.2.", "192.168.", "198.18.", "198.19.", "198.51.100.", "203.0.113.",
        "224.", "225.", "226.", "227.", "228.", "229.", "230.", "231.", "232.", "233.", "234.", "235.",
        "236.", "237.", "238.", "239.", "240.", "241.", "242.", "243.", "244.", "245.", "246.", "247.",
        "248.", "249.", "250.", "251.", "252.", "253.", "254.", "255.",
        // Meta / Facebook
        "31.13.", "45.64.", "57.141.", "69.63.", "69.171.", "74.119.", "102.132.",
        "129.134.", "157.240.", "163.70.", "173.252.", "179.60.", "185.60.", "185.89.",
        "204.15.", "216.58.", "2620:0:", "2a03:2880:",
    ]

    private static let dohProviders: [(name: String, url: (String) -> String, accept: String)] = [
        ("AliDNS",     { "https://223.5.5.5/resolve?name=\($0)&type=A" }, "application/dns-json"),
        ("DNSPod",     { "https://doh.pub/dns-query?name=\($0)&type=A" }, "application/dns-json"),
        ("Cloudflare", { "https://1.1.1.1/dns-query?name=\($0)&type=A" }, "application/dns-json"),
        ("Google",     { "https://dns.google/resolve?name=\($0)&type=A" }, "application/dns-json"),
    ]

    // MARK: 主入口

    /// 解析并选出最优 IP（系统候选 + 四家 DoH 并行 → 黑名单过滤 → TCP 探测排序）
    func resolveBestIP(_ domain: String) async -> ResolvedResult {
        lock.lock()
        let hit = cache[domain]
        lock.unlock()
        if let hit {
            // ⑤ 三级缓存：负缓存 5s / 正向 5min / TCP 已验证可达 24h
            let ttl: TimeInterval = hit.negative ? 5 : (hit.verifiedIP != nil ? 24 * 3600 : 300)
            if Date().timeIntervalSince(hit.at) < ttl {
                return ResolvedResult(bestIP: hit.verifiedIP ?? hit.ips.first,
                                      allCandidates: hit.ips, fromCache: true)
            }
        }

        // ② 系统 DNS 候选（限时 2s）+ ③ 四家 DoH 并行
        let system = await Self.withTimeout(seconds: 2) {
            await Task.detached(priority: .utility) { Self.systemAddresses(domain) }.value
        }
        var candidates: [String] = []
        candidates.append(contentsOf: system ?? [])
        candidates.append(contentsOf: await resolveViaDoH(domain))

        // ① 黑名单过滤 + 去重
        var seen = Set<String>()
        let filtered = candidates.filter { ip in
            Self.isBlacklisted(ip) ? false : seen.insert(ip).inserted
        }

        guard !filtered.isEmpty else {
            lock.lock()
            cache[domain] = CacheEntry(ips: [], verifiedIP: nil, at: Date(), negative: true)
            lock.unlock()
            return ResolvedResult(bestIP: nil, allCandidates: [], fromCache: false)
        }

        // ④ TCP 探测排序（可达优先），首个可达者进 24h 缓存
        var verified: String? = nil
        var reachable: [String] = []
        await withTaskGroup(of: (String, Bool).self) { group in
            for ip in filtered.prefix(8) {
                group.addTask { (ip, await Self.tcpProbe(ip, port: 443, timeout: 1.5)) }
            }
            for await (ip, ok) in group {
                if ok {
                    reachable.append(ip)
                    if verified == nil { verified = ip }
                }
            }
        }
        let unreachable = filtered.filter { !reachable.contains($0) }
        let sorted = reachable + unreachable

        lock.lock()
        cache[domain] = CacheEntry(ips: sorted, verifiedIP: verified, at: Date(), negative: false)
        lock.unlock()
        return ResolvedResult(bestIP: sorted.first, allCandidates: sorted, fromCache: false)
    }

    func invalidate(_ domain: String? = nil) {
        lock.lock()
        if let domain { cache.removeValue(forKey: domain) } else { cache.removeAll() }
        lock.unlock()
    }

    // MARK: DoH

    private func resolveViaDoH(_ domain: String) async -> [String] {
        await withTaskGroup(of: [String].self) { group in
            for provider in Self.dohProviders {
                group.addTask {
                    guard let resp = try? await Http.get(provider.url(domain.urlEncode()),
                                                         headers: ["Accept": provider.accept],
                                                         timeout: 2) else { return [] }
                    guard (200..<300).contains(resp.status),
                          let obj = JsonPathResolver.parseJson(resp.text) as? [String: Any],
                          let answers = obj["Answer"] as? [[String: Any]] else { return [] }
                    return answers.compactMap { ans in
                        guard (ans["type"] as? Int) == 1, let ip = ans["data"] as? String else { return nil }
                        return ip
                    }
                }
            }
            var out: [String] = []
            for await ips in group { out.append(contentsOf: ips) }
            return out
        }
    }

    // MARK: 黑名单

    static func isBlacklisted(_ ip: String) -> Bool {
        for prefix in blacklistPrefixes where ip.hasPrefix(prefix) { return true }
        return false
    }

    // MARK: 系统 DNS（getaddrinfo）

    static func systemAddresses(_ host: String) -> [String] {
        var hints = addrinfo(ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_STREAM,
                             ai_protocol: IPPROTO_TCP, ai_addrlen: 0, ai_canonname: nil,
                             ai_addr: nil, ai_next: nil)
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, "443", &hints, &result) == 0, let first = result else { return [] }
        defer { freeaddrinfo(result) }
        var out: [String] = []
        var node: UnsafeMutablePointer<addrinfo>? = first
        while let cur = node {
            if cur.pointee.ai_family == AF_INET, let sa = cur.pointee.ai_addr {
                var addr = sockaddr_in()
                memcpy(&addr, sa, min(Int(cur.pointee.ai_addrlen), MemoryLayout<sockaddr_in>.size))
                var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                var inAddr = addr.sin_addr
                if inet_ntop(AF_INET, &inAddr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil {
                    out.append(String(cString: buf))
                }
            }
            node = cur.pointee.ai_next
        }
        return out
    }

    // MARK: TCP 探测（Network.framework，1.5s 超时）

    static func tcpProbe(_ ip: String, port: UInt16, timeout: TimeInterval) async -> Bool {
        await withCheckedContinuation { cont in
            let connection = NWConnection(
                host: NWEndpoint.Host(ip),
                port: NWEndpoint.Port(rawValue: port) ?? 443,
                using: .tcp)
            let done = NSLock()
            var finished = false
            func finish(_ value: Bool) {
                done.lock()
                let first = !finished
                finished = true
                done.unlock()
                if first {
                    connection.cancel()
                    cont.resume(returning: value)
                }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready: finish(true)
                case .failed, .cancelled: finish(false)
                default: break
                }
            }
            connection.start(queue: DispatchQueue.global(qos: .utility))
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                finish(false)
            }
        }
    }

    // MARK: 工具

    static func withTimeout<T: Sendable>(seconds: TimeInterval, _ body: @escaping @Sendable () async -> T) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await body() }
            group.addTask { () -> T? in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}

// MARK: - 自定义 SNI 传输（URLSession 无法按 IP 直连 + 指定 SNI，走 Network.framework 裸 HTTP/1.1）

final class SniHttpClient {
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: Data
    }

    enum TransportError: Error, LocalizedError {
        case tlsFailed
        case connectionFailed(String)
        case timeout
        var errorDescription: String? {
            switch self {
            case .tlsFailed: return "TLS 握手失败"
            case .connectionFailed(let m): return "连接失败：\(m)"
            case .timeout: return "响应超时"
            }
        }
    }

    /// 向 ip:443 发起 TLS（SNI = sniHost），发送 HTTP/1.1 请求并收完整响应
    static func send(ip: String, sniHost: String,
                     method: String, path: String,
                     headers: [String: String], body: Data?,
                     timeout: TimeInterval = 30) async throws -> Response {
        try await withCheckedThrowingContinuation { cont in
            let tlsOptions = NWProtocolTLS.Options()
            sec_protocol_options_set_tls_server_name(tlsOptions.securityProtocolOptions, sniHost)
            let params = NWParameters(tls: tlsOptions)
            params.connectTimeout = 10

            let connection = NWConnection(host: NWEndpoint.Host(ip), port: 443, using: params)
            let state = NSLock()
            var finished = false
            func finish(_ result: Result<Response, Error>) {
                state.lock()
                let first = !finished
                finished = true
                state.unlock()
                if first {
                    connection.cancel()
                    cont.resume(with: result)
                }
            }
            // 总超时
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                finish(.failure(TransportError.timeout))
            }
            connection.stateUpdateHandler = { ws in
                switch ws {
                case .ready:
                    // 发送请求
                    var headerLines = ["\(method) \(path) HTTP/1.1",
                                       "Host: \(sniHost)",
                                       "Connection: close",
                                       "Accept-Encoding: identity"]
                    for (k, v) in headers where k.lowercased() != "host" && k.lowercased() != "connection" {
                        headerLines.append("\(k): \(v)")
                    }
                    if let body, !body.isEmpty {
                        headerLines.append("Content-Length: \(body.count)")
                    }
                    var payload = Data(headerLines.joined(separator: "\r\n").utf8)
                    payload.append(Data("\r\n\r\n".utf8))
                    if let body, !body.isEmpty { payload.append(body) }
                    connection.send(content: payload, completion: .contentProcessed { sendError in
                        if let sendError {
                            finish(.failure(TransportError.connectionFailed(sendError.localizedDescription)))
                            return
                        }
                        // 接收循环
                        var buffer = Data()
                        func receiveLoop() {
                            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
                                if let data { buffer.append(data) }
                                if let error {
                                    finish(.failure(TransportError.connectionFailed(error.localizedDescription)))
                                    return
                                }
                                // 响应头已齐 → 判断是否收满
                                if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                                    let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
                                    let headerText = String(decoding: headerData, as: UTF8.self)
                                    let bodyStart = headerEnd.upperBound
                                    let bodyData = buffer.subdata(in: bodyStart..<buffer.endIndex)
                                    if Self.responseComplete(headerText: headerText, bodyBytes: bodyData) {
                                        finish(.success(Self.parse(headerText: headerText, body: bodyData)))
                                        return
                                    }
                                }
                                if isComplete {
                                    // 连接关闭：有响应头就交付
                                    if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                                        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
                                        let bodyData = buffer.subdata(in: headerEnd.upperBound..<buffer.endIndex)
                                        finish(.success(Self.parse(headerText: String(decoding: headerData, as: UTF8.self),
                                                                   body: bodyData)))
                                    } else {
                                        finish(.failure(TransportError.connectionFailed("空响应")))
                                    }
                                    return
                                }
                                receiveLoop()
                            }
                        }
                        receiveLoop()
                    })
                case .failed(let error):
                    if error.errorCode == 62 {
                        finish(.failure(TransportError.tlsFailed))
                    } else {
                        finish(.failure(TransportError.connectionFailed(error.localizedDescription)))
                    }
                case .cancelled:
                    finish(.failure(TransportError.timeout))
                default:
                    break
                }
            }
            connection.start(queue: DispatchQueue.global(qos: .userInitiated))
        }
    }

    private static func responseComplete(headerText: String, bodyBytes: Data) -> Bool {
        let lower = headerText.lowercased()
        if lower.contains("transfer-encoding: chunked") {
            // 终止块 "0\r\n\r\n"
            return bodyBytes.range(of: Data("0\r\n\r\n".utf8)) != nil
                || bodyBytes.range(of: Data("\r\n0\r\n".utf8)) != nil
        }
        for line in headerText.split(separator: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].lowercased().trimmingCharacters(in: .whitespaces) == "content-length",
               let len = Int(parts[1].trimmingCharacters(in: .whitespaces)) {
                return bodyBytes.count >= len
            }
        }
        return false
    }

    private static func parse(headerText: String, body rawBody: Data) -> Response {
        var lines = headerText.components(separatedBy: "\r\n")
        let statusLine = lines.isEmpty ? "" : lines.removeFirst()
        let status = Int(statusLine.split(separator: " ").dropFirst().first ?? "0") ?? 0
        var headers: [String: String] = [:]
        for line in lines {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2 {
                headers[parts[0].lowercased().trimmingCharacters(in: .whitespaces)] =
                    parts[1].trimmingCharacters(in: .whitespaces)
            }
        }
        var body = rawBody
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            body = Self.dechunk(body)
        }
        return Response(status: status, headers: headers, body: body)
    }

    private static func dechunk(_ data: Data) -> Data {
        var out = Data()
        var cursor = data.startIndex
        while cursor < data.endIndex {
            guard let lineEnd = data.range(of: Data("\r\n".utf8), in: cursor..<data.endIndex) else { break }
            let sizeLine = String(decoding: data[cursor..<lineEnd.lowerBound], as: UTF8.self)
                .split(separator: ";").first ?? ""
            guard let size = Int(sizeLine.trimmingCharacters(in: .whitespaces), radix: 16) else { break }
            if size == 0 { break }
            let chunkStart = lineEnd.upperBound
            guard let chunkEnd = data.index(chunkStart, offsetBy: size, limitedBy: data.endIndex) else { break }
            out.append(data[chunkStart..<chunkEnd])
            cursor = data.index(chunkEnd, offsetBy: 2, limitedBy: data.endIndex) ?? chunkEnd
        }
        return out
    }
}

// MARK: - Z-Library 统一传输门面（OkHttp + 自定义 DNS 拦截链的对应物）

enum ZLHttp {
    /// 普通请求（不带 PoW；DiamWall 求解器在其之上循环）
    static func request(_ req: Http.Request, depth: Int = 0) async throws -> HttpResponse {
        guard depth < 3, let url = URL(string: req.url), let host = url.host else {
            throw HttpError.invalidUrl
        }
        let resolved = await ZLibraryDns.shared.resolveBestIP(host)
        guard let ip = resolved.bestIP else {
            // DoH 全军覆没 → 退回系统栈
            return try await Http.send(req)
        }
        var path = url.path.isEmpty ? "/" : url.path
        if let q = url.query { path += "?\(q)" }
        let raw = try await SniHttpClient.send(
            ip: ip, sniHost: host,
            method: req.method, path: path,
            headers: req.headers, body: req.body,
            timeout: req.timeout + 10)
        let resp = HttpResponse(status: raw.status, data: raw.body,
                                headers: Dictionary(uniqueKeysWithValues: raw.headers.map { (AnyHashable($0.key), AnyHashable($0.value)) }),
                                url: url)
        // 手动跟随 3xx
        if (300..<400).contains(resp.status),
           let location = raw.headers["location"],
           let next = URL(string: location, relativeTo: url)?.absoluteString {
            var nextReq = req
            nextReq.url = next
            return try await request(nextReq, depth: depth + 1)
        }
        return resp
    }

    static func get(_ url: String, headers: [String: String] = [:], timeout: Double = 20) async throws -> HttpResponse {
        try await request(Http.Request(url: url, headers: headers, timeout: timeout))
    }
}

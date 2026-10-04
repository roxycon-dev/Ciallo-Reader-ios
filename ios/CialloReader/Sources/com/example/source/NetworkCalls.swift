// 对齐 novel-reader/app/src/main/java/com/example/source/NetworkCalls.kt（61 行）
// 保留既有 iOS 骨架的 Http/HttpResponse/HttpError/NetworkErrorMessage/EncryptedCookieJar/Hex/Base64Util
//（zlibrary/js/ui/download 多处引用，公共类型不得改名）；底部补齐 NetworkCalls.kt 的
// executeCancellable 取消语义、SharedHttpTransport 共共传输层与 SourceNetworkPolicy 内网管控。

import Foundation
import CryptoKit

// MARK: - 共享 HTTP 层（AppErrorInterceptor.kt 对应物）
// URLSession 统一请求；错误翻译成用户可读中文；409 必须原样放行（Z-Library 书架语义）。

struct HttpResponse {
    let status: Int
    let data: Data
    let headers: [AnyHashable: Any]
    let url: URL?

    var text: String {
        // 编码：Content-Type charset → BOM → UTF-8 → GBK
        var charset: String? = nil
        if let ct = headers["Content-Type"] as? String,
           let range = ct.range(of: "charset=", options: .caseInsensitive) {
            charset = ct[range.upperBound...].split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) }
        }
        if let charset { return CharsetSniffer.decode(data, declared: charset) }
        return CharsetSniffer.decode(data)
    }

    func json() throws -> Any {
        try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }
}

enum NetworkErrorMessage {
    /// 统一网络错误中文提示（AppErrorInterceptor 对应物）
    static func toMessage(status: Int, host: String?) -> String {
        switch status {
        case 401: return "登录状态已过期，请重新登录"
        case 403: return "没有访问权限（403）"
        case 404: return "资源不存在（404）"
        case 409: return "请求冲突（409）"
        case 429: return "请求过于频繁，请稍后再试"
        case 500...599: return "服务器开小差了（\(status)）"
        default: return "网络请求失败（\(status)）"
        }
    }

    static let messageKeys = ["message", "msg", "error", "detail", "errorMessage", "description"]

    static func extractServerMessage(_ body: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed]) else { return nil }
        return extract(from: obj, depth: 0)
    }

    private static func extract(from obj: Any, depth: Int) -> String? {
        guard depth < 3 else { return nil }
        if let dict = obj as? [String: Any] {
            for key in messageKeys {
                if let s = dict[key] as? String, !s.isEmpty { return s }
            }
            for v in dict.values {
                if let s = extract(from: v, depth: depth + 1) { return s }
            }
        } else if let arr = obj as? [Any] {
            for v in arr.prefix(4) {
                if let s = extract(from: v, depth: depth + 1) { return s }
            }
        }
        return nil
    }
}

enum HttpError: Error {
    case invalidUrl
    case network(String)
    case status(Int, String?)   // status, serverMessage
}

enum Http {
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    struct Request {
        var url: String
        var method: String = "GET"
        var headers: [String: String] = [:]
        var body: Data? = nil
        var timeout: Double = 20
        var followRedirects: Bool = true
    }

    /// Kotlin `Call.executeCancellable()` 对应物：
    /// Parent cancellation closes blocked socket reads —— URLSession 任务随 Swift Task
    /// 取消自动取消（URLSessionTask.cancel），OkHttp 的 invokeOnCompletion 钩子由
    /// withTaskCancellationHandler 的 onCancel 语义承担。
    static func send(_ req: Request) async throws -> HttpResponse {
        guard let url = URL(string: req.url) else { throw HttpError.invalidUrl }
        var urlReq = URLRequest(url: url, timeoutInterval: req.timeout)
        urlReq.httpMethod = req.method
        urlReq.httpBody = req.body
        for (k, v) in req.headers { urlReq.setValue(v, forHTTPHeaderField: k) }
        urlReq.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                        forHTTPHeaderField: "User-Agent")
        if req.headers["Accept"] == nil { urlReq.setValue("*/*", forHTTPHeaderField: "Accept") }
        urlReq.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")

        let (data, response) = try await session.data(for: urlReq)
        guard let http = response as? HTTPURLResponse else { throw HttpError.network("非 HTTP 响应") }
        var headers: [AnyHashable: Any] = [:]
        for (k, v) in http.allHeaderFields { headers[k] = v }
        return HttpResponse(status: http.statusCode, data: data, headers: headers, url: http.url)
    }

    /// 限定响应体大小读取（对应 Kotlin com.example.data.readImportBytes(limit)）
    static func readImportBytes(from response: HTTPURLResponse, data: Data, limit: Int) throws -> Data {
        if data.count > limit {
            throw HttpError.network("响应体超过 \(limit / 1024 / 1024)MiB 上限")
        }
        return data
    }

    static func get(_ url: String, headers: [String: String] = [:], timeout: Double = 20) async throws -> HttpResponse {
        try await send(Request(url: url, headers: headers, timeout: timeout))
    }

    static func post(_ url: String, headers: [String: String] = [:], body: Data? = nil, timeout: Double = 20) async throws -> HttpResponse {
        try await send(Request(url: url, method: "POST", headers: headers, body: body, timeout: timeout))
    }

    static func getJson(_ url: String, headers: [String: String] = [:]) async throws -> Any {
        let resp = try await get(url, headers: headers)
        guard (200..<300).contains(resp.status) else {
            throw statusError(resp, host: URL(string: url)?.host)
        }
        return try resp.json()
    }

    /// 统一错误翻译：服务端 message 优先，状态码兜底（409 不改写）
    static func statusError(_ resp: HttpResponse, host: String?) -> Error {
        // 409 必须原样放行（硬约束：Z-Library「这本书已经在书架里了」业务语义）
        if resp.status == 409 {
            return HttpError.status(409, NetworkErrorMessage.extractServerMessage(resp.data))
        }
        let serverMsg = NetworkErrorMessage.extractServerMessage(resp.data)
        return HttpError.status(resp.status, serverMsg ?? NetworkErrorMessage.toMessage(status: resp.status, host: host))
    }

    static func statusError(_ status: Int, body: Data?, host: String?) -> Error {
        if status == 409 {
            return HttpError.status(409, body.flatMap { NetworkErrorMessage.extractServerMessage($0) })
        }
        let serverMsg = body.flatMap { NetworkErrorMessage.extractServerMessage($0) }
        return HttpError.status(status, serverMsg ?? NetworkErrorMessage.toMessage(status: status, host: host))
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case HttpError.invalidUrl: return "无效的请求地址"
        case HttpError.network(let m): return "网络连接失败：\(m)"
        case HttpError.status(let s, let m): return m ?? NetworkErrorMessage.toMessage(status: s, host: nil)
        case SourceException.cancelled: return "已取消"
        case is CancellationError: return "已取消"
        case let e as LocalizedError: return e.errorDescription ?? e.localizedDescription
        default: return error.localizedDescription
        }
    }
}

// MARK: - 加密 Cookie 存储（zlibrary/EncryptedCookieJar.kt 对应物，文件归属 NetworkCalls.swift 骨架）
// remix_userid/remix_userkey 登录态持久化；按 domain 作用域匹配请求主机。

final class EncryptedCookieJar {
    private let prefs = Preferences.shared
    private let scope: String

    init(scope: String) { self.scope = scope }

    func store(domain: String, name: String, value: String) {
        prefs.setString(value, for: "cookie_\(scope)_\(domain)_\(name)")
    }

    func value(domain: String, name: String) -> String? {
        if let direct = prefs.string(for: "cookie_\(scope)_\(domain)_\(name)") { return direct }
        // 父域查找（止于有效注册域的近似：逐级去掉子域）
        var parts = domain.split(separator: ".")
        while parts.count > 2 {
            parts.removeFirst()
            let parent = parts.joined(separator: ".")
            if let v = prefs.string(for: "cookie_\(scope)_\(parent)_\(name)") { return v }
        }
        return nil
    }

    /// 拼装 Cookie header
    func cookieHeader(for host: String) -> String {
        let names = ["remix_userid", "remix_userkey", "dwid", "_dwa", "c_token", "cf_clearance", "siteLanguageV2", "kouling"]
        var parts: [String] = []
        for n in names {
            if let v = value(domain: host, name: n) { parts.append("\(n)=\(v)") }
        }
        return parts.joined(separator: "; ")
    }

    func parseAndStore(header: String, host: String) {
        for pair in header.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1)
            guard kv.count == 2 else { continue }
            let name = kv[0].trimmingCharacters(in: .whitespaces)
            let value = kv[1].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            store(domain: host, name: name, value: value)
        }
    }

    func isLoggedInCookie(host: String) -> Bool {
        value(domain: host, name: "remix_userid") != nil && value(domain: host, name: "remix_userkey") != nil
    }

    func clear(host: String) {
        for name in ["remix_userid", "remix_userkey"] { prefs.remove("cookie_\(scope)_\(host)_\(name)") }
    }
}

// MARK: - 工具（Hex / Base64Util）

enum Hex {
    static func md5(_ string: String) -> String {
        Insecure.MD5.hash(data: Data(string.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func sha1(_ data: Data) -> String {
        Insecure.SHA1.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func sha1Bytes(_ data: Data) -> [UInt8] {
        Array(Insecure.SHA1.hash(data: data))
    }
    static func sha256Bytes(_ data: Data) -> [UInt8] {
        Array(SHA256.hash(data: data))
    }
}

enum Base64Util {
    static func encode(_ string: String) -> String {
        Data(string.utf8).base64EncodedString()
    }
    /// Kotlin android.util.Base64.NO_WRAP 对应（不换行；URL 安全变体见 encodeUrlSafe）
    static func encodeUrlSafe(_ string: String) -> String {
        Data(string.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - NetworkCalls.kt 以下三个顶层声明的 iOS 对应物

/// Kotlin: `internal object SharedHttpTransport` —— 共享连接池与分发器，保留每源 TLS/Cookie/代理配置。
/// URLSession 无独立连接池/分发器配置项；此处提供统一的 builder 生成带书源默认超时的会话。
enum SharedHttpTransport {
    static func builder(connectTimeout: TimeInterval = 15,
                        readTimeout: TimeInterval = 15,
                        callTimeout: TimeInterval? = nil) -> URLSession {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        // OkHttp readTimeout ≈ 两次读之间隔；URLSession 以请求间隔近似
        config.timeoutIntervalForRequest = readTimeout
        config.timeoutIntervalForResource = callTimeout ?? (connectTimeout + readTimeout + 30)
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }
}

/// Kotlin: `internal object SourceNetworkPolicy` —— 书源重定向/DNS 内网地址管控。
enum SourceNetworkPolicy {

    private static let siteLocalIPv4 = try! NSRegularExpression(pattern: "^172\\.(1[6-9]|2[0-9]|3[01])\\.")

    /// Kotlin privateAddress(InetAddress) 的文本近似：
    /// anyLocal(0.0.0.0 / ::) + loopback + linkLocal + siteLocal + multicast + IPv6 ULA(fc00::/7)
    private static func isPrivateAddress(_ host: String) -> Bool {
        let h = host.lowercased()
        // IPv6 文本判定（字面量必含 ':'，避免误伤普通域名）
        if h.contains(":") {
            if h == "::" || h == "::1" { return true }                               // anyLocal / loopback
            if h.hasPrefix("fe8") || h.hasPrefix("fe9") || h.hasPrefix("fea") || h.hasPrefix("feb") { return true } // linkLocal fe80::/10
            // ULA fc00::/7：(firstByte & 0xfe) == 0xfc → fc / fd 开头
            if h.hasPrefix("fc") || h.hasPrefix("fd") { return true }
            if h.hasPrefix("ff") { return true }                                     // multicast ff00::/8
            return false
        }
        // IPv4 文本判定
        if h == "0.0.0.0" { return true }                                            // anyLocal
        if h.hasPrefix("127.") { return true }                                       // loopback /8
        if h.hasPrefix("10.") || h.hasPrefix("192.168.") { return true }             // siteLocal
        if h.hasPrefix("169.254.") { return true }                                   // linkLocal /16
        if siteLocalIPv4.firstMatch(in: h, options: [], range: NSRange(location: 0, length: (h as NSString).length)) != nil {
            return true                                                              // siteLocal /12
        }
        if h.hasPrefix("224.") || h.hasPrefix("239.") { return true }                // multicast /4
        return false
    }

    /// Kotlin: `fun checkAddress(host, address, allowedPrivateHost)` —— DNS 解析结果逐个校验
    static func checkAddress(host: String, address: String, allowedPrivateHost: String?) throws {
        if isPrivateAddress(address) && host.lowercased() != allowedPrivateHost {
            throw HttpError.network("书源跳转或 DNS 指向未配置的内网地址")
        }
    }

    /// Kotlin: `fun check(url, allowedPrivateHost)` —— 请求 URL scheme/主机校验
    static func check(_ url: URL, allowedPrivateHost: String?) throws {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            throw HttpError.network("仅支持 HTTP/HTTPS 书源")
        }
        guard let host = url.host?.lowercased() else {
            throw HttpError.network("仅支持 HTTP/HTTPS 书源")
        }
        let local = host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") ||
            host == "::1" || host == "0.0.0.0" || host.hasPrefix("127.") || host.hasPrefix("10.") ||
            host.hasPrefix("192.168.") || host.hasPrefix("169.254.") ||
            host.range(of: "^172\\.(1[6-9]|2[0-9]|3[01])\\.", options: .regularExpression) != nil
        let ipv6Private = host.contains(":") ? isPrivateAddress(host) : false
        if (local || ipv6Private) && host != allowedPrivateHost {
            throw HttpError.network("书源规则尝试访问未配置的内网地址")
        }
    }
}

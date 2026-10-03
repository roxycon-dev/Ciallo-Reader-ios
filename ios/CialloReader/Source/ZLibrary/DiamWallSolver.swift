import Foundation
import CryptoKit

// MARK: - DiamWall PoW 自动求解（zlibrary/DiamWallInterceptor.kt 逐条移植）
// 拦截 517/403/503/513（及 200+html 特征挑战页）→ 提取 dwid/_dwa → iframe 取真 PoW 页 →
// SHA-1 双字节（新版）或 SHA-256 前缀零（旧版）枚举 → 写 cookie / 跳 __ab/verify →
// 手动跟随重定向 + seenUrls 去重（最多 8 次 follow-up）。

final class DiamWallSolver {
    let cookieJar: EncryptedCookieJar
    private static let solveLock = NSLock()
    private static var solved: [String: Int64] = [:]
    private static var solvedOrder: [String] = []

    init(cookieJar: EncryptedCookieJar) {
        self.cookieJar = cookieJar
    }

    /// 发送请求并自动解 DiamWall 挑战（替代 OkHttp Interceptor）
    func execute(_ request: Http.Request, host: String) async throws -> HttpResponse {
        var current = request
        var followUpCount = 0
        var urlCounts: [String: Int] = [:]
        var response = try await ZLHttp.request(current)

        while followUpCount < 8 {
            let code = response.status
            let reqUrl = current.url
            // 循环守卫：307→503 合法往返同一 URL；仅当同 URL 4+ 次无进展才中止
            urlCounts[reqUrl, default: 0] += 1
            if urlCounts[reqUrl]! > 3 { break }

            let isChallengeCode = code == 517 || code == 403 || code == 503 || code == 513
            var smellsLikeDiamWall = false
            if !isChallengeCode && code == 200 {
                let ct = response.headers["Content-Type"] as? String ?? ""
                if ct.lowercased().contains("text/html") {
                    let peek = String(decoding: response.data.prefix(4096), as: UTF8.self).lowercased()
                    smellsLikeDiamWall = peek.contains("diamwall") || peek.contains("checking your browser")
                        || peek.contains("verify your browser") || peek.contains("var token=")
                }
            }
            guard isChallengeCode || smellsLikeDiamWall else {
                // 2. 手动跟随重定向（followRedirects=false 时）
                if response.status >= 300 && response.status < 400 {
                    guard let location = response.headers["Location"] as? String,
                          let newUrl = resolveUrl(location, base: reqUrl) else { break }
                    extractCookie(from: response, host: host, patterns: ["dwid"])
                    current.url = newUrl
                    response = try await ZLHttp.request(current)
                    followUpCount += 1
                    continue
                }
                break
            }

            let bodyString = response.text

            // dwid / _dwa cookie
            extractCookie(from: response, host: host, patterns: ["dwid", "_dwa"])

            // PoW 页（iframe 内）
            var powHtml = bodyString
            if let iframeMatch = firstRegex("<iframe[^>]*src=\"([^\"]+\\.well-known/diamwall/load/html/[^\"]*)\"[^>]*>", in: bodyString) {
                if let iframeUrl = resolveUrl(iframeMatch, base: reqUrl) {
                    let iframeResp = try await ZLHttp.get(iframeUrl, headers: ["Referer": reqUrl])
                    powHtml = iframeResp.text
                }
            }

            // 交互式 CAPTCHA：HTTP 客户端解不了，立即放弃（提示 WebView）
            let captcha = powHtml.lowercased().contains("solve this captcha")
                || powHtml.contains("Verifying your browser")
                || powHtml.contains("chl/v2/captcha")
                || powHtml.contains("cpt.lib")
            if captcha { break }

            // 新版 PoW：SHA-1(TOKEN+nonce)，校验 digest[n1]/[n1+1] 两个目标字节
            let powToken = firstRegex("['\"]([0-9A-Fa-f]{40})['\"]", in: bodyString)
            let byte1 = firstRegex("s\\[n1\\]===(0x[0-9a-fA-F]+)", in: powHtml)
            let byte2 = firstRegex("s\\[n1\\+0x1\\]===(0x[0-9a-fA-F]+)", in: powHtml)
            if let powToken, let b1s = byte1, let b2s = byte2 {
                let token = powToken.uppercased()
                guard let n1 = Int(String(token.prefix(1)), radix: 16),
                      let target1 = UInt8(b1s.dropFirst(2), radix: 16),
                      let target2 = UInt8(b2s.dropFirst(2), radix: 16) else { break }
                guard let nonce = Self.solveBounded(key: "sha1|\(token)|\(n1)|\(target1)|\(target2)") { input -> Bool in
                    let digest = Array(Insecure.SHA1.hash(data: Data(input.utf8)))
                    guard n1 + 1 < digest.count else { return false }
                    return digest[n1] == target1 && digest[n1 + 1] == target2
                } input: { nonce in token + String(nonce) } else { break }

                cookieJar.store(domain: host, name: "c_token", value: token + String(nonce))
                cookieJar.store(domain: host, name: "c_time", value: "1")
                response = try await ZLHttp.request(current)
                followUpCount += 1
                continue
            }

            // 旧版 PoW：SHA-256("TOKEN:nonce") 前缀 DIFF 个 0 → /__ab/verify
            if powHtml.contains("Checking your browser") || powHtml.range(of: "DiamWall", options: .caseInsensitive) != nil || powHtml.contains("TOKEN") {
                if let token = firstRegex("var TOKEN=\"([^\"]+)\"", in: powHtml),
                   let diffStr = firstRegex("var DIFF=(\\d+)", in: powHtml),
                   let diff = Int(diffStr) {
                    guard let nonce = Self.solveSha256(token: token, difficulty: diff) else { break }
                    var path = URL(string: reqUrl)?.path ?? "/"
                    var query = URL(string: reqUrl)?.query
                    let originalUrl = path + (query.map { "?\($0)" } ?? "")
                    _ = query
                    let verifyUrl = "https://\(host)/__ab/verify?t=\(token.urlEncode())&n=\(nonce)&r=\(originalUrl.urlEncode())"
                    current.url = verifyUrl
                    response = try await ZLHttp.request(current)
                    followUpCount += 1
                    continue
                }
            }
            break
        }
        return response
    }

    // MARK: 工具

    private func extractCookie(from response: HttpResponse, host: String, patterns: [String]) {
        let body = response.text
        for name in patterns {
            if let value = firstRegex("document\\.cookie=\"\(name)=([^;]+);", in: body) {
                cookieJar.store(domain: host, name: name, value: value)
            }
        }
    }

    private func resolveUrl(_ href: String, base: String) -> String? {
        if href.hasPrefix("http://") || href.hasPrefix("https://") { return href }
        guard let b = URL(string: base) else { return nil }
        return URL(string: href, relativeTo: b)?.absoluteString
    }

    private func firstRegex(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = text as NSString
        guard let m = regex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)),
              m.numberOfRanges > 1 else { return nil }
        return ns.substring(with: m.range(at: 1))
    }

    // MARK: PoW 求解（共享去重 + 5s / 100 万次上限）

    static func solveSha256(token: String, difficulty: Int) -> Int64? {
        guard difficulty >= 0, difficulty <= 6 else { return nil }
        return solveBounded(key: "sha256|\(token)|\(difficulty)") { input -> Bool in
            let digest = Array(SHA256.hash(data: Data(input.utf8)))
            for nibble in 0..<difficulty {
                let byte = digest[nibble / 2]
                let ok = nibble % 2 == 0 ? (byte >> 4) == 0 : (byte & 15) == 0
                if !ok { return false }
            }
            return true
        } input: { nonce in "\(token):\(nonce)" }
    }

    private static func solveBounded(key: String, matches: (String) -> Bool, input: (Int64) -> String) -> Int64? {
        solveLock.lock()
        defer { solveLock.unlock() }
        if let cached = solved[key] { return cached }
        let deadline = Date().addingTimeInterval(5)
        for nonce in 0..<1_000_000 {
            if nonce % 4096 == 0 && Date() >= deadline { return nil }
            if matches(input(nonce)) {
                if solvedOrder.count >= 64 {
                    let oldest = solvedOrder.removeFirst()
                    solved.removeValue(forKey: oldest)
                }
                solved[key] = nonce
                solvedOrder.append(key)
                return nonce
            }
        }
        return nil
    }
}

// 对齐 novel-reader/app/src/main/java/com/example/source/PufeiImageCacheRetry.kt（27 行）

import Foundation

/// Refresh one cached CDN server error without changing successful image/cache URLs.
/// Kotlin 为 OkHttp Interceptor；URLSession 无拦截器链，改为「请求方收到响应后调用」
/// 的静态判定 + 重试地址生成，判定条件与刷新策略逐行对齐。
enum PufeiImageCacheRetry {

    /// Kotlin: `request.url.host.endsWith(".6wm.top")`
    static let hostSuffix = ".6wm.top"
    /// Kotlin: `request.header("Referer") != "https://manhuafree.com/"`
    static let requiredReferer = "https://manhuafree.com/"

    /// 是否需要刷新重试（= Kotlin intercept() 中的提前 return 反向判定）
    static func shouldRetry(method: String, url: String, requestHeaders: [String: String], statusCode: Int) -> Bool {
        guard method == "GET" else { return false }
        guard let host = URL(string: url)?.host?.lowercased(), host.hasSuffix(hostSuffix) else { return false }
        guard requestHeaders["Referer"] == requiredReferer else { return false }
        return (500...599).contains(statusCode)
    }

    /// A fixed URL can keep serving an edge's cached 502, even after ordinary
    /// retries. Preserve path and headers; a minute bucket avoids random URLs
    /// and lets concurrent requests share the refreshed edge cache.
    /// （追加 pufei_retry = 分钟桶参数；重试请求需附 Cache-Control: no-cache）
    static func refreshedUrl(_ url: String, now: TimeInterval = Date().timeIntervalSince1970 * 1000) -> String {
        let bucket = Int(now / 60_000)
        guard var comps = URLComponents(string: url) else { return url }
        var items = comps.queryItems ?? []
        items.removeAll { $0.name == "pufei_retry" }
        items.append(URLQueryItem(name: "pufei_retry", value: String(bucket)))
        comps.queryItems = items
        return comps.url?.absoluteString ?? url
    }

    /// 重试请求应携带的头（Kotlin: `.header("Cache-Control", "no-cache")`）
    static func retryHeaders(_ original: [String: String]) -> [String: String] {
        var h = original
        h["Cache-Control"] = "no-cache"
        return h
    }
}

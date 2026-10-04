// 对齐 js/JsCookieJar.kt（130 行）
// JS 源共享 Cookie 存储读取器。与 JsMessageHandler 的 js_source_cookies 共用同一份数据，
// 供阅读器图片加载与章节下载使用——对齐 Venera 图片请求走共享 CookieJar 的行为。
// 存储：SharedPreferences("js_source_cookies") → UserDefaults 前缀 "js_source_cookies."。
// topPrivateDomain 用"末两段标签"近似（iOS 无 Public Suffix List 内建查询）。

import Foundation

enum JsCookieJar {
    private static let lock = NSLock()
    private static let domain = "js_source_cookies."

    private static func pairs(_ raw: String) -> LinkedHashMap<String, String> {
        var map = LinkedHashMap<String, String>()
        raw.components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.contains("=") }
            .forEach {
                let name = $0.split(separator: "=", maxSplits: 1).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
                if !name.isEmpty { map[name] = $0 }
            }
        return map
    }

    private static func metadata(_ raw: String?) -> [String: Any] {
        guard let raw, let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    private static func saveMetadata(_ attrs: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: attrs) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func prefsString(_ key: String) -> String {
        UserDefaults.standard.string(forKey: domain + key) ?? ""
    }

    private static func prefsSet(_ key: String, _ value: String) {
        UserDefaults.standard.set(value, forKey: domain + key)
    }

    private static func prefsRemove(_ key: String) {
        UserDefaults.standard.removeObject(forKey: key)
    }

    /// host 的公共后缀近似：最后两段（co.uk 等少数例外容忍偏差，注释注明）。
    private static func topPrivateDomain(_ host: String) -> String {
        let parts = host.split(separator: ".")
        guard parts.count >= 2 else { return host }
        return parts.suffix(2).joined(separator: ".")
    }

    /// 取某个 URL 的 Cookie 头（带过期/路径/secure/hostOnly 作用域过滤，父域逐级回溯）。
    static func cookieHeader(url: String) -> String {
        lock.lock()
        defer { lock.unlock() }
        guard let parsed = URL(string: url), let host = parsed.host?.lowercased() else { return "" }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let baseDomain = topPrivateDomain(host)
        var cookies = LinkedHashMap<String, String>()
        var current = host
        while !current.isEmpty {
            var stored = pairs(prefsString("ck_\(current)"))
            var attributes = metadata(prefsString("ck_meta_\(current)"))
            var changed = false
            var kept: [String] = []
            for (name, pair) in stored {
                let meta = attributes[name] as? [String: Any]
                // 迁移旧的 1 秒搜索节流，但不清掉登录会话
                let oldSearchThrottle = meta == nil && name == "ss_search_delay"
                    && (current == "ikmmh.com" || current.hasSuffix(".ikmmh.com"))
                let expiresAt = meta?["expiresAt"] as? Int64 ?? Int64.max
                let expired = oldSearchThrottle || expiresAt <= now
                if expired {
                    attributes.removeValue(forKey: name)
                    changed = true
                } else {
                    let path = meta?["path"] as? String ?? "/"
                    let reqPath = parsed.path.isEmpty ? "/" : parsed.path
                    let pathMatches = reqPath == path
                        || (reqPath.hasPrefix(path) && (path.hasSuffix("/") || reqPath.dropFirst(path.count).first == "/"))
                    let hostOnly = meta?["hostOnly"] as? Bool ?? false
                    let secure = meta?["secure"] as? Bool ?? false
                    let scopeMatches = meta == nil
                        || ((!hostOnly || current == host) && (!secure || parsed.scheme == "https") && pathMatches)
                    if scopeMatches, cookies[name] == nil { cookies[name] = pair }
                }
                if !expired { kept.append(pair) }
            }
            if changed {
                prefsSet("ck_\(current)", kept.joined(separator: "; "))
                prefsSet("ck_meta_\(current)", saveMetadata(attributes))
            }
            if current == baseDomain { break }
            // host 去掉首段，继续父域
            if let dot = current.firstIndex(of: ".") {
                current = String(current[current.index(after: dot)...])
            } else {
                break
            }
        }
        return cookies.values.joined(separator: "; ")
    }

    /// 保存 Set-Cookie 响应头（按 cookie 域分组）。
    static func saveSetCookies(url: String, headers: [String]) {
        lock.lock()
        defer { lock.unlock() }
        guard let parsed = URL(string: url), let reqHost = parsed.host?.lowercased() else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var byDomain: [String: [(String, String)]] = [:]  // domain → [(name, value)]
        var attrsByDomain: [String: [String: [String: Any]]] = [:]
        for header in headers {
            guard let cookie = HTTPCookie(properties: [
                .name: cookieName(from: header) ?? "",
                .value: cookieValue(from: header) ?? "",
                .domain: cookieDomain(from: header) ?? reqHost,
                .path: cookiePath(from: header),
            ]) ?? makeCookie(header: header, url: parsed) else { continue }
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            byDomain[domain, default: []].append((cookie.name, cookie.value))
            var attrs = attrsByDomain[domain] ?? [:]
            var meta: [String: Any] = ["path": cookie.path, "secure": cookie.isSecure, "hostOnly": cookie.domain == reqHost]
            if let expires = cookie.expiresDate {
                meta["expiresAt"] = Int64(expires.timeIntervalSince1970 * 1000)
            } else {
                meta["expiresAt"] = Int64.max
            }
            attrs[cookie.name] = meta
            attrsByDomain[domain] = attrs
        }
        for (host, updates) in byDomain {
            var stored = pairs(prefsString("ck_\(host)"))
            var attributes = metadata(prefsString("ck_meta_\(host)"))
            var kept: [String] = []
            for (name, value) in updates {
                // 过期 cookie：Kotlin 按 expiresAt <= now 删除；HTTPCookie 已无 expires 属性时视为会话 cookie
                stored[name] = "\(name)=\(value)"
                kept.append("\(name)=\(value)")
                if let meta = attrsByDomain[host]?[name], (meta["expiresAt"] as? Int64 ?? Int64.max) <= now {
                    stored.removeValue(forKey: name)
                    attributes.removeValue(forKey: name)
                    kept.removeAll { $0 == "\(name)=\(value)" }
                } else {
                    attributes[name] = attrsByDomain[host]?[name] ?? [:]
                }
            }
            prefsSet("ck_\(host)", stored.values.joined(separator: "; "))
            prefsSet("ck_meta_\(host)", saveMetadata(attributes))
            _ = now
        }
    }

    /// JS 与 WebView 提供的是活的 name/value 对（无 Set-Cookie 属性）。
    static func saveCookiePairs(host: String, updates: [String]) {
        lock.lock()
        defer { lock.unlock() }
        let trimmed = host.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        let domainHost = trimmed.drop(while:) { $0 == "." }.lowercased()
        var stored = pairs(prefsString("ck_\(domainHost)"))
        var attributes = metadata(prefsString("ck_meta_\(domainHost)"))
        for (name, pair) in pairs(updates.joined(separator: "; ")) {
            stored[name] = pair
            attributes.removeValue(forKey: name)
        }
        prefsSet("ck_\(domainHost)", stored.values.joined(separator: "; "))
        prefsSet("ck_meta_\(domainHost)", saveMetadata(attributes))
    }

    static func clear(host: String) {
        lock.lock()
        defer { lock.unlock() }
        prefsRemove(domain + "ck_\(host)")
        prefsRemove(domain + "ck_meta_\(host)")
    }

    // MARK: Set-Cookie 头解析辅助（HTTPCookie 需要拆好的属性）

    private static func firstPair(_ header: String) -> (String, String) {
        let first = header.split(separator: ";").first.map(String.init) ?? ""
        let kv = first.split(separator: "=", maxSplits: 1)
        let name = kv.first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let value = kv.count > 1 ? kv[1].trimmingCharacters(in: .whitespaces) : ""
        return (name, value)
    }

    private static func cookieName(from header: String) -> String? {
        let (n, _) = firstPair(header)
        return n.isEmpty ? nil : n
    }

    private static func cookieValue(from header: String) -> String? {
        let (_, v) = firstPair(header)
        return v.isEmpty ? nil : v
    }

    private static func attr(_ header: String, _ key: String) -> String? {
        for part in header.split(separator: ";") {
            let kv = part.split(separator: "=", maxSplits: 1)
            if kv.count == 2, kv[0].trimmingCharacters(in: .whitespaces).lowercased() == key {
                return kv[1].trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }

    private static func cookieDomain(from header: String) -> String? {
        attr(header, "domain").map { $0.hasPrefix(".") ? String($0.dropFirst()) : $0 }
    }

    private static func cookiePath(from header: String) -> String {
        attr(header, "path") ?? "/"
    }

    private static func makeCookie(header: String, url: URL) -> HTTPCookie? {
        guard let name = cookieName(from: header), let value = cookieValue(from: header) else { return nil }
        var props: [HTTPCookiePropertyKey: Any] = [
            .name: name, .value: value,
            .domain: cookieDomain(from: header) ?? url.host ?? "",
            .path: cookiePath(from: header),
        ]
        if let expires = attr(header, "expires") {
            props[.expires] = HTTPCookie.dateFormatter(from: expires) ?? Date().addingTimeInterval(86400 * 365)
        }
        if attr(header, "secure") != nil { props[.secure] = "TRUE" }
        return HTTPCookie(properties: props)
    }
}

private extension HTTPCookie {
    static func dateFormatter(from string: String) -> Date? {
        let formats = ["EEE, dd MMM yyyy HH:mm:ss zzz", "EEE, dd-MMM-yyyy HH:mm:ss zzz"]
        for f in formats {
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            df.timeZone = TimeZone(identifier: "GMT")
            df.dateFormat = f
            if let d = df.date(from: string) { return d }
        }
        return nil
    }
}

/// 保持插入序的小字典（对应 Kotlin LinkedHashMap）。
struct LinkedHashMap<K: Hashable, V> {
    private var keys: [K] = []
    private var map: [K: V] = [:]

    subscript(key: K) -> V? {
        get { map[key] }
        set {
            if let newValue {
                if map[key] == nil { keys.append(key) }
                map[key] = newValue
            } else {
                map.removeValue(forKey: key)
                keys.removeAll { $0 == key }
            }
        }
    }
    
    mutating func removeEntry(forKey key: K) {
        map.removeValue(forKey: key)
        keys.removeAll { $0 == key }
    }

    var values: [V] { keys.compactMap { map[$0] } }
    var entries: [(K, V)] { keys.compactMap { k in map[k].map { (k, $0) } } }
    func removeValue(forKey key: K) { removeEntry(forKey: key) }
    mutating func removeAll(where predicate: (K, V) -> Bool) {
        for (k, v) in entries where predicate(k, v) { self[k] = nil }
    }
}

extension LinkedHashMap: Sequence {
    struct Iterator: IteratorProtocol {
        let items: [(K, V)]
        var idx = 0
        mutating func next() -> (K, V)? {
            guard idx < items.count else { return nil }
            defer { idx += 1 }
            return items[idx]
        }
    }
    func makeIterator() -> Iterator { Iterator(items: entries) }
}

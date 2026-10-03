import Foundation

// MARK: - JS 源仓库（source/js/JsSourceRepo.kt 对应物）
// 远端索引（venera-configs）+ 本地内置源；四张策略表（成人/登录/排除/不安全 TLS）逐键一致。

final class JsSourceRepo: BookSource {
    static let shared = JsSourceRepo()

    static let adultKeys: Set<String> = [
        "nhentai", "ehentai", "hitomi", "jm", "picacg", "wnacg", "mxs",
        "mh18", "hcomic", "hot_manga",
    ]
    static let loginKeys: Set<String> = ["picacg", "ikmmh", "vomic"]
    static let excludedKeys: Set<String> = [
        "manga_dex", "lanraragi", "komga", "kavita",
        "baozi", "jcomic",
        "zaimanhua", "ManHuaGui", "ykmh", "happy", "Komiic",
        "ccc",
    ]
    static let insecureKeys: Set<String> = ["baozi"]
    static let localExtraSources: [(key: String, name: String, file: String)] = [
        ("bilimanga", "嗶哩漫畫", "bilimanga.js"),
        ("vomic", "vomic漫画", "vomic.js"),
        ("pufei", "扑飞漫画", "pufei.js"),
    ]

    struct SourceMeta {
        let key: String
        let name: String
        let url: String
        let version: String
    }

    private let indexMirrors = [
        "https://fastly.jsdelivr.net/gh/venera-app/venera-configs@main/index.json",
        "https://gcore.jsdelivr.net/gh/venera-app/venera-configs@main/index.json",
        "https://raw.githubusercontent.com/venera-app/venera-configs/main/index.json",
    ]

    /// 已加载的 JS 源（key → engine）
    private(set) var loadedSources: [String: JsComicSource] = [:]
    private var metas: [SourceMeta] = []
    private let lock = NSLock()
    private let prefs = Preferences.shared

    var id: String { "js_sources" }
    var name: String { "漫画源仓库" }
    var registrationUrl: String? { nil }
    var capabilities: SourceCapabilities { SourceCapabilities(supportComic: true, supportImport: true) }

    private init() {
        loadLocalExtras()
    }

    // MARK: 本地内置源

    private func loadLocalExtras() {
        for extra in Self.localExtraSources {
            guard let body = JsSourceEngine.loadBundleScript(extra.file),
                  validScript(body) else { continue }
            loadScript(key: extra.key, name: extra.name, script: body,
                       insecureTls: false, loginRequired: Self.loginKeys.contains(extra.key))
        }
    }

    private func validScript(_ body: String) -> Bool {
        body.contains("extends ComicSource")
    }

    // MARK: 远端索引

    func refreshJsSources() async -> SourceResult<Int> {
        do {
            var body: String?
            for url in indexMirrors {
                guard let resp = try? await Http.get(url, timeout: 15), (200..<300).contains(resp.status) else { continue }
                let text = resp.text
                if JsonPathResolver.parseJson(text) != nil { body = text; break }
            }
            guard let body else { return .error(.networkError("无法获取 JS 源索引")) }
            let arr = JsonPathResolver.parseJson(body) as? [[String: Any]] ?? []
            var newMetas: [SourceMeta] = []
            for item in arr {
                guard let key = item["key"] as? String else { continue }
                guard !Self.excludedKeys.contains(key) else { continue }
                let name = item["name"] as? String ?? key
                let url = item["url"] as? String ?? ""
                let version = item["version"] as? String ?? "1.0.0"
                newMetas.append(SourceMeta(key: key, name: name, url: url, version: version))
            }
            lock.lock()
            metas = newMetas
            lock.unlock()
            prefs.setString(SourceImporter.serialize(newMetas.map { ["key": $0.key, "name": $0.name, "url": $0.url, "version": $0.version] }),
                            for: "js_source_index")
            return .success(newMetas.count)
        } catch {
            return .error(.networkError(Http.describe(error)))
        }
    }

    func allKeys() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        let local = Array(loadedSources.keys)
        let remote = metas.map { $0.key }
        var seen = Set<String>()
        return (remote + local).filter { seen.insert($0).inserted }
    }

    func sourceName(forKey key: String) -> String {
        lock.lock()
        defer { lock.unlock() }
        if let s = loadedSources[key] { return s.name }
        return metas.first { $0.key == key }?.name ?? key
    }

    static func isAdult(sourceId: String) -> Bool {
        let key = sourceId.hasPrefix("js_") ? String(sourceId.dropFirst(3)) : sourceId
        return adultKeys.contains(key)
    }

    func loginRequired(key: String) -> Bool { Self.loginKeys.contains(key) }
    func insecureTls(key: String) -> Bool { Self.insecureKeys.contains(key) }

    /// 懒加载单个 JS 源（缓存复用同一 engine 实例）
    func loadSource(key: String) async -> JsComicSource? {
        lock.lock()
        if let cached = loadedSources[key] {
            lock.unlock()
            return cached
        }
        let metasSnapshot = metas
        lock.unlock()
        guard let meta = metasSnapshot.first(where: { $0.key == key }) else { return nil }
        do {
            let script = try await fetchScript(meta.url)
            return loadScript(key: key, name: meta.name, script: script,
                              insecureTls: insecureTls(key: key),
                              loginRequired: loginRequired(key: key))
        } catch {
            SourceLog.log("JsRepo", "加载源失败 \(key): \(error.localizedDescription)")
            return nil
        }
    }

    private func fetchScript(_ url: String) async throws -> String {
        for attempt in 0..<2 {
            if let resp = try? await Http.get(url, timeout: 20), (200..<300).contains(resp.status) {
                return resp.text
            }
            if attempt == 0 { try? await Task.sleep(nanoseconds: 500_000_000) }
        }
        throw SourceException.networkError("源脚本下载失败")
    }

    @discardableResult
    private func loadScript(key: String, name: String, script: String, insecureTls: Bool, loginRequired: Bool) -> JsComicSource? {
        let engine = JsSourceEngine(sourceId: key)
        do {
            try engine.bootstrap(script: script)
            let source = JsComicSource(engine: engine, key: key, name: engine.sourceName.isEmpty ? name : engine.sourceName,
                                       loginRequired: loginRequired)
            lock.lock()
            loadedSources[key] = source
            lock.unlock()
            return source
        } catch {
            SourceLog.log("JsRepo", "bootstrap 失败 \(key): \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: 仓库自身作为 BookSource 的占位实现（不参与搜索）

    func search(keyword: String) async -> SourceResult<[SearchBook]> { .success([]) }
    func getDetail(bookId: String) async -> SourceResult<SearchBook> { .error(.bookNotFound) }
    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> { .error(.parseError("仓库不提供下载")) }
    func login(credential: LoginCredential) async -> SourceResult<Bool> { .success(false) }
    func logout() async {}
    func isLoggedIn() async -> Bool { false }

    var loadedCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return loadedSources.count
    }
}

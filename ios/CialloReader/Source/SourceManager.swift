import Foundation

// MARK: - 书源管理器（SourceManager.kt + SourceViewModel.kt 对应物）
// 注册/启用/激活/持久化； adult 源开关；导入（文件/字符串/URL）。

@MainActor
final class SourceManager: ObservableObject {
    static let shared = SourceManager()

    @Published private(set) var allSources: [BookSource] = []
    @Published private(set) var enabledStates: [String: Bool] = [:]
    @Published private(set) var activeSourceId: String? = nil
    @Published var adultSourcesEnabled: Bool {
        didSet { Preferences.shared.setBool(adultSourcesEnabled, for: "source_adult_enabled") }
    }

    private let prefs = Preferences.shared
    private var initialized = false

    private init() {
        adultSourcesEnabled = prefs.bool(for: "source_adult_enabled", default: false)
    }

    func initialize() async {
        guard !initialized else { return }
        initialized = true
        registerBuiltins()
        // 自定义 JSON 源
        for (_, json) in customSourceJsons() {
            if let src = SourceImporter.importFromJsonString(json) {
                allSources.append(src)
            }
        }
        // 启用状态
        if let stored = Preferences.shared.string(for: "source_enabled_map")?.data(using: .utf8),
           let map = try? JSONSerialization.jsonObject(with: stored) as? [String: Bool] {
            enabledStates = map
        }
        activeSourceId = prefs.string(for: "source_active")
    }

    private func customSourceJsons() -> [String: String] {
        guard let raw = prefs.string(for: "custom_source_jsons"),
              let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return dict
    }

    private func registerBuiltins() {
        let builtins: [BookSource] = [
            ZLibrarySource(),
            MangaDexSource(),
            AutoNovelSource(),
            IxdzsSource(),
            Wenku8LibrarySource(),
            JsSourceRepo.shared,
        ]
        allSources.append(contentsOf: builtins)
    }

    var availableSources: [BookSource] {
        allSources.filter { isEnabled($0.id) && !isHidden($0) }
    }

    var novelSources: [BookSource] { availableSources.filter { $0.capabilities.isNovelSource } }
    var comicSources: [BookSource] { availableSources.filter { $0.capabilities.isComicSource } }

    func isHidden(_ source: BookSource) -> Bool {
        // MockBookSource 生产隐藏；成人源需开关
        if source.id == "mock" { return true }
        if source.capabilities.isComicSource && JsSourceRepo.isAdult(sourceId: source.id) && !adultSourcesEnabled { return true }
        return false
    }

    func isEnabled(_ id: String) -> Bool {
        enabledStates[id] ?? true
    }

    func setEnabled(_ id: String, _ enabled: Bool) {
        enabledStates[id] = enabled
        persist()
    }

    func setActive(_ id: String?) {
        activeSourceId = id
        prefs.setString(id ?? "", for: "source_active")
    }

    var activeSource: BookSource? {
        guard let activeSourceId else { return availableSources.first }
        return availableSources.first { $0.id == activeSourceId }
    }

    func source(byId id: String) -> BookSource? {
        allSources.first { $0.id == id }
    }

    func addCustomSource(json: String) async -> SourceResult<BookSource> {
        guard let source = SourceImporter.importFromJsonString(json) else {
            return .error(.parseError("书源 JSON 解析失败"))
        }
        if allSources.first(where: { $0.id == source.id }) != nil {
            allSources.removeAll { $0.id == source.id }
        }
        allSources.append(source)
        var dict = customSourceJsons()
        dict[source.id] = json
        prefs.setString(String(data: (try? JSONSerialization.data(withJSONObject: dict)) ?? Data(), encoding: .utf8), for: "custom_source_jsons")
        return .success(source)
    }

    func removeSource(id: String) {
        guard source(byId: id)?.capabilities.supportImport == true || customSourceJsons()[id] != nil else { return }
        allSources.removeAll { $0.id == id }
        var dict = customSourceJsons()
        dict.removeValue(forKey: id)
        prefs.setString(String(data: (try? JSONSerialization.data(withJSONObject: dict)) ?? Data(), encoding: .utf8), for: "custom_source_jsons")
        persist()
    }

    private func persist() {
        if let data = try? JSONSerialization.data(withJSONObject: enabledStates) {
            prefs.setString(String(data: data, encoding: .utf8), for: "source_enabled_map")
        }
    }
}

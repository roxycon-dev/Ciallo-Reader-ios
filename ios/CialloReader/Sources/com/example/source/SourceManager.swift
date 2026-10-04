// 对齐 novel-reader/app/src/main/java/com/example/source/SourceManager.kt（177 行）
// Kotlin MutableStateFlow → @Published；Mutex → 主线程（@MainActor）+ 存储层自带锁。
// 保留 iOS 骨架对外 API（shared 单例 / source(byId:) / setActive / addCustomSource /
// adultSourcesEnabled / isHidden 等，ui/ 与 library/ 引用）。

import Foundation

@MainActor
final class SourceManager: ObservableObject {
    static let shared = SourceManager()

    /// Kotlin: sourcesMap = LinkedHashMap（保持注册顺序）
    @Published private(set) var allSources: [BookSource] = []
    /// Kotlin: _enabledStates StateFlow
    @Published private(set) var enabledStates: [String: Bool] = [:]
    /// Kotlin: _availableSources StateFlow（iOS 额外叠加 isHidden 过滤：environmentOnly / 成人源开关）
    @Published private(set) var availableSources: [BookSource] = []
    /// Kotlin: _activeSource StateFlow
    @Published private(set) var activeSource: BookSource? = nil
    /// iOS 骨架遗留：成人源总开关（SourceManagementScreen 切换）
    @Published var adultSourcesEnabled: Bool {
        didSet { Preferences.shared.setBool(adultSourcesEnabled, for: "source_adult_enabled") }
    }

    /// Kotlin: activeSourceId 由 activeSource 派生
    var activeSourceId: String? { activeSource?.id }

    private var sourcesMap: [String: BookSource] = [:]
    private var enabledStatesMap: [String: Bool] = [:]
    private var customJsonsMap: [String: String] = [:]
    private var initialized = false
    private let storage: SourceStorage?
    private let prefs = Preferences.shared

    /// Kotlin: `class SourceManager(private val storage: SourceStorage? = null)`
    /// 默认存储：SharedPreferencesSourceStorage（iOS 对应物）
    private convenience init() {
        self.init(storage: SharedPreferencesSourceStorage())
    }

    init(storage: SourceStorage?) {
        self.storage = storage
        self.adultSourcesEnabled = prefs.bool(for: "source_adult_enabled", default: false)
    }

    // MARK: 初始化 / 持久化数据加载

    func initialize() async {
        guard !initialized else { return }
        initialized = true
        registerBuiltins()
        await loadPersistedDataInternal()
    }

    /// Kotlin: `suspend fun loadPersistedData() { initialize() }`
    func loadPersistedData() async {
        await initialize()
    }

    private func loadPersistedDataInternal() async {
        guard let store = storage else { return }
        let savedStates = await store.getSourceStates()
        for (id, state) in savedStates where enabledStatesMap[id] == nil {
            enabledStatesMap[id] = state
        }
        enabledStates = enabledStatesMap

        // Load user-imported custom sources
        let customJsons = (try? await store.getCustomSourceJsons()) ?? [:]
        for (sourceId, jsonStr) in customJsons {
            switch SourceImporter.importFromJsonString(jsonStr) {
            case .success(let source):
                setSourceInternal(source)
                customJsonsMap[sourceId] = jsonStr
            case .error:
                continue
            }
        }

        let savedActiveId = await store.getActiveSourceId()
        updateFlowsInternal()

        if let savedActiveId, !savedActiveId.isEmpty, sourcesMap[savedActiveId] != nil,
           isSourceEnabledInternal(savedActiveId) {
            activeSource = sourcesMap[savedActiveId]
        } else if activeSource == nil {
            activeSource = availableSources.first
        }
    }

    // MARK: 内置源注册（iOS 骨架既有编排）

    private func registerBuiltins() {
        let builtins: [BookSource] = [
            ZLibrarySource(),
            MangaDexSource(),
            AutoNovelSource(),
            IxdzsSource(),
            Wenku8LibrarySource(),
            JsSourceRepo.shared,
        ]
        for source in builtins where sourcesMap[source.id] == nil {
            setSourceInternal(source)
            if enabledStatesMap[source.id] == nil {
                enabledStatesMap[source.id] = true
            }
        }
        enabledStates = enabledStatesMap
    }

    private func setSourceInternal(_ source: BookSource) {
        sourcesMap[source.id] = source
        // Kotlin LinkedHashMap.values.toList() 顺序 = 首次注册顺序
        if !allSources.contains(where: { $0.id == source.id }) {
            allSources.append(source)
        } else {
            allSources = allSources.map { $0.id == source.id ? source : $0 }
        }
    }

    // MARK: 注册 / 注销

    /// Kotlin: `suspend fun registerSource(source, defaultEnabled = true, rawJson = null)`
    func registerSource(_ source: BookSource, defaultEnabled: Bool = true, rawJson: String? = nil) async {
        setSourceInternal(source)
        if enabledStatesMap[source.id] == nil {
            enabledStatesMap[source.id] = defaultEnabled
            enabledStates = enabledStatesMap
        }
        if let rawJson {
            customJsonsMap[source.id] = rawJson
            try? await storage?.saveCustomSourceJson(sourceId: source.id, jsonContent: rawJson)
        }
        updateFlowsInternal()
        if activeSource == nil && isSourceEnabledInternal(source.id) {
            await setActiveSourceInternal(source.id)
        }
    }

    /// Kotlin: `suspend fun addSource(source: BookSource)`
    func addSource(_ source: BookSource) async {
        await registerSource(source, defaultEnabled: true)
    }

    /// Kotlin: `suspend fun registerCustomSource(source, rawJson = null)`
    func registerCustomSource(_ source: BookSource, rawJson: String? = nil) async {
        await registerSource(source, defaultEnabled: true, rawJson: rawJson)
    }

    /// Kotlin: `suspend fun unregisterCustomSource(sourceId: String)`
    func unregisterCustomSource(sourceId: String) async {
        await unregisterSource(sourceId)
    }

    /// Kotlin: `suspend fun unregisterSource(sourceId: String)`
    func unregisterSource(sourceId: String) async {
        sourcesMap.removeValue(forKey: sourceId)
        allSources.removeAll { $0.id == sourceId }
        enabledStatesMap.removeValue(forKey: sourceId)
        enabledStates = enabledStatesMap
        customJsonsMap.removeValue(forKey: sourceId)
        await storage?.removeCustomSourceJson(sourceId: sourceId)
        if activeSource?.id == sourceId {
            activeSource = availableSources.first { $0.id != sourceId }
        }
        updateFlowsInternal()
    }

    /// Kotlin: `suspend fun removeSource(sourceId: String)`
    func removeSource(id: String) async {
        await unregisterSource(sourceId)
    }

    // MARK: 激活源

    /// Kotlin: `suspend fun setActiveSource(sourceId: String)`
    func setActiveSource(_ sourceId: String) async {
        await setActiveSourceInternal(sourceId)
    }

    private func setActiveSourceInternal(_ sourceId: String) async {
        if let source = sourcesMap[sourceId], isSourceEnabledInternal(sourceId) {
            activeSource = source
            await storage?.saveActiveSourceId(sourceId: sourceId)
        }
    }

    // MARK: 启用开关

    /// Kotlin: `suspend fun setSourceEnabled(sourceId: String, enabled: Boolean)`
    func setSourceEnabled(sourceId: String, _ enabled: Bool) async {
        enabledStatesMap[sourceId] = enabled
        enabledStates = enabledStatesMap
        await storage?.saveSourceState(sourceId: sourceId, enabled: enabled)
        updateFlowsInternal()
        if !enabled && activeSource?.id == sourceId {
            activeSource = availableSources.first
            if let current = activeSource {
                await setActiveSourceInternal(current.id)
            }
        }
    }

    /// Kotlin: `fun getSource(id: String): BookSource?`
    func getSource(id: String) -> BookSource? {
        sourcesMap[id]
    }

    // MARK: iOS 骨架对外 API（ui/library 引用，保留）

    func source(byId id: String) -> BookSource? {
        sourcesMap[id]
    }

    /// Kotlin: `fun isSourceEnabled(id: String): Boolean`
    func isSourceEnabled(_ id: String) -> Bool {
        enabledStatesMap[id] ?? true
    }

    func isSourceEnabledInternal(_ id: String) -> Bool {
        enabledStatesMap[id] ?? true
    }

    /// UI 兼容别名
    func isEnabled(_ id: String) -> Bool {
        isSourceEnabled(id)
    }

    func setEnabled(_ id: String, _ enabled: Bool) {
        enabledStatesMap[id] = enabled
        enabledStates = enabledStatesMap
        Task { await storage?.saveSourceState(sourceId: id, enabled: enabled) }
        updateFlowsInternal()
        if !enabled && activeSource?.id == id {
            activeSource = availableSources.first
            if let current = activeSource {
                Task { await setActiveSourceInternal(current.id) }
            }
        }
    }

    /// UI 兼容别名（Kotlin setActiveSource 的同步近似）
    func setActive(_ id: String?) {
        guard let id else {
            activeSource = nil
            return
        }
        if let source = sourcesMap[id], isSourceEnabledInternal(id) {
            activeSource = source
            Task { await storage?.saveActiveSourceId(sourceId: id) }
        }
    }

    /// Kotlin: `fun isCustomSource(sourceId: String): Boolean`
    func isCustomSource(_ sourceId: String) -> Bool {
        if let src = sourcesMap[sourceId] as? JsonBookSource {
            return src.config.isCustom || customJsonsMap[sourceId] != nil
        }
        return customJsonsMap[sourceId] != nil
    }

    // MARK: 隐藏与分类（iOS 骨架语义）

    var novelSources: [BookSource] { availableSources.filter { $0.isNovelSource } }
    var comicSources: [BookSource] { availableSources.filter { $0.isComicSource } }

    /// MockBookSource（environmentOnly）生产隐藏；成人源需开关（Kotlin 隐藏逻辑由
    /// environmentOnly + UI 过滤表达，此处集中为 iOS 侧 isHidden）。
    func isHidden(_ source: BookSource) -> Bool {
        if source.capabilities.environmentOnly { return true }
        if source.isComicSource && JsSourceRepo.isAdult(sourceId: source.id) && !adultSourcesEnabled { return true }
        return false
    }

    /// iOS 骨架遗留入口（SourceManagementScreen「粘贴 JSON 添加源」）：
    /// 单源导入 + 注册 + 持久化 rawJson。
    func addCustomSource(json: String) async -> SourceResult<BookSource> {
        switch SourceImporter.importFromJsonString(json) {
        case .success(let source):
            await registerSource(source, defaultEnabled: true, rawJson: json)
            return .success(source)
        case .error(let e):
            return .error(e)
        }
    }

    // MARK: Flow 更新（Kotlin updateFlowsInternal）

    private func updateFlowsInternal() {
        let allList = allSources
        let availableList = allList.filter { isSourceEnabledInternal($0.id) && !isHidden($0) }
        availableSources = availableList
        if let current = activeSource, !availableList.contains(where: { $0.id == current.id }) {
            activeSource = availableList.first
        } else if activeSource == nil, let first = availableList.first {
            activeSource = first
        }
    }
}

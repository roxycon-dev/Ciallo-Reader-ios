// 对齐 novel-reader/app/src/main/java/com/example/source/SourceViewModel.kt（188 行）
// AndroidViewModel → SwiftUI ObservableObject；viewModelScope.launch → Task；
// Uri → iOS 文件 URL；JsSourceRepo.install（Android 端按仓库重装 JS 源）在 iOS 侧
// 由 JsSourceRepo.refreshJsSources()（远端索引刷新）承担，JS 源本身懒加载。

import Foundation

@MainActor
final class SourceViewModel: ObservableObject {

    let sourceManager: SourceManager

    /// Kotlin: allSources/availableSources/activeSource/enabledStates 四个 StateFlow 直通
    var allSources: [BookSource] { sourceManager.allSources }
    var availableSources: [BookSource] { sourceManager.availableSources }
    var activeSource: BookSource? { sourceManager.activeSource }
    var enabledStates: [String: Bool] { sourceManager.enabledStates }

    /// Kotlin: _importStatus StateFlow
    @Published var importStatus: String? = nil

    /// Kotlin 次构造：`SourceManager(SharedPreferencesSourceStorage(application))`；
    /// iOS shared 单例已内置该存储。
    init(sourceManager: SourceManager = .shared) {
        self.sourceManager = sourceManager
        // Kotlin init { viewModelScope.launch(Dispatchers.IO) { sourceManager.initialize() } }
        Task { await sourceManager.initialize() }
    }

    // MARK: 启用 / 激活 / 移除

    func enableSource(id: String) {
        Task { await sourceManager.setSourceEnabled(sourceId: id, enabled: true) }
    }

    func disableSource(id: String) {
        Task { await sourceManager.setSourceEnabled(sourceId: id, enabled: false) }
    }

    func setActiveSource(id: String) {
        Task { await sourceManager.setActiveSource(id) }
    }

    func isSourceEnabled(id: String) -> Bool {
        sourceManager.isSourceEnabled(id)
    }

    func isCustomSource(id: String) -> Bool {
        sourceManager.isCustomSource(id)
    }

    func removeSource(id: String) {
        Task { await sourceManager.unregisterSource(id) }
    }

    // MARK: 导入

    /// Kotlin: `fun importSourceFromUri(uri: Uri)` —— iOS 以文件 URL 表达
    func importSourceFromUri(_ url: URL) {
        Task {
            let result = await SourceImporter.importBatchFromUri(url)
            if result.imported.isEmpty {
                importStatus = "导入失败: \(result.skipped.first?.reason ?? "未找到可导入的书源")"
            } else {
                for (source, rawJson) in result.imported {
                    await sourceManager.registerSource(source, defaultEnabled: true, rawJson: rawJson)
                }
                importStatus = buildImportStatus(result)
            }
        }
    }

    func importSourceFromJsonString(_ jsonStr: String) {
        Task {
            let result = SourceImporter.importBatchFromJsonString(jsonStr)
            if result.imported.isEmpty {
                importStatus = "导入失败: \(result.skipped.first?.reason ?? "未找到可导入的书源")"
            } else {
                for (source, rawJson) in result.imported {
                    await sourceManager.registerSource(source, defaultEnabled: true, rawJson: rawJson)
                }
                importStatus = buildImportStatus(result)
            }
        }
    }

    func importSourceFromUrl(_ url: String) {
        Task {
            importStatus = "正在从网络获取书源..."
            let result = await SourceImporter.importBatchFromUrl(url)
            if result.imported.isEmpty {
                importStatus = "网络导入失败: \(result.skipped.first?.reason ?? "未找到可导入的书源")"
            } else {
                for (source, rawJson) in result.imported {
                    await sourceManager.registerSource(source, defaultEnabled: true, rawJson: rawJson)
                }
                importStatus = buildImportStatus(result)
            }
        }
    }

    private func buildImportStatus(_ result: SourceImporter.BatchImportResult) -> String {
        let base = "成功导入 \(result.importedCount) 个书源"
        if result.skippedCount > 0 {
            let firstSkipped = result.skipped.first!.reason
            return "\(base)，跳过 \(result.skippedCount) 个（\(firstSkipped)）"
        }
        return base
    }

    func clearImportStatus() {
        importStatus = nil
    }

    // MARK: JS 源仓库

    /** 刷新 Venera 源仓库：移除现有 JS 源并从远程仓库重新安装。 */
    func refreshJsSources() {
        Task {
            importStatus = "正在刷新 JS 源仓库…"
            switch await JsSourceRepo.shared.refreshJsSources() {
            case .success(let count):
                // iOS 侧 JS 源挂在 JsSourceRepo（js_sources）单实体下，无需逐个注销/重注册
                importStatus = "源仓库刷新完成，共 \(count) 个漫画源"
            case .error:
                importStatus = "源仓库刷新失败或仓库为空，请检查网络后重试"
            }
        }
    }

    /**
     * 成人源开关：开启时自动从 Venera 仓库拉取并注册成人源；关闭时只移除成人源。
     * 不再做“能否连网站”的自动开关检测，开关状态完全由用户控制。
     * （iOS 侧：开关写入偏好，isHidden 过滤即时生效；远端索引同步刷新。）
     */
    func setAdultSourcesEnabled(_ enabled: Bool) {
        Task {
            sourceManager.adultSourcesEnabled = enabled
            if enabled {
                importStatus = "正在更新成人源…"
                switch await JsSourceRepo.shared.refreshJsSources() {
                case .success(let count):
                    importStatus = "成人源已更新（共 \(count) 个漫画源）"
                case .error:
                    importStatus = "成人源更新失败，请检查网络后重试"
                }
            } else {
                // 成人源实体（js_<key>）未在 iOS 侧注册，隐藏由 SourceManager.isHidden 承担
                importStatus = "成人源已隐藏"
            }
        }
    }
}

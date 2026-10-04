// 对齐 novel-reader/app/src/main/java/com/example/source/storage/SharedPreferencesSourceStorage.kt（85 行）

import Foundation
import CryptoKit

/// Kotlin SharedPreferences + filesDir/source_configs(AtomicFile) → iOS：
/// UserDefaults(suiteName: "book_sources_config") + Documents/source_configs 原子写文件。
final class SharedPreferencesSourceStorage: SourceStorage {

    private let defaults: UserDefaults
    private let directory: URL
    /// Kotlin: `companion object { private val storageLock = Any() }`
    private static let storageLock = NSLock()

    init() {
        // Kotlin: context.getSharedPreferences("book_sources_config", MODE_PRIVATE)
        self.defaults = UserDefaults(suiteName: "book_sources_config") ?? .standard
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        // Kotlin: File(context.filesDir, "source_configs").apply { mkdirs() }
        self.directory = docs.appendingPathComponent("source_configs", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: 启用状态

    func saveSourceState(sourceId: String, enabled: Bool) async {
        // Kotlin key: "source_enabled_$sourceId"
        defaults.set(enabled, forKey: "source_enabled_\(sourceId)")
    }

    func getSourceStates() async -> [String: Bool] {
        var result: [String: Bool] = [:]
        for (key, value) in defaults.dictionaryRepresentation() {
            if key.hasPrefix("source_enabled_"), let b = value as? Bool {
                let sourceId = String(key.dropFirst("source_enabled_".count))
                result[sourceId] = b
            }
        }
        return result
    }

    // MARK: 激活源

    func saveActiveSourceId(sourceId: String) async {
        // Kotlin key: "active_source_id"
        defaults.set(sourceId, forKey: "active_source_id")
    }

    func getActiveSourceId() async -> String? {
        defaults.string(forKey: "active_source_id")
    }

    // MARK: 自定义书源 JSON（文件按 SHA-256(id) 命名）

    private func configFile(_ id: String) -> URL {
        // Kotlin: MessageDigest SHA-256 → "%02x" 拼接 + ".json"
        let digest = SHA256.hash(data: Data(id.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined() + ".json"
        return directory.appendingPathComponent(name)
    }

    func saveCustomSourceJson(sourceId: String, jsonContent: String) async throws {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard Data(jsonContent.utf8).count <= 2 * 1024 * 1024 else {
            throw SourceException.parseError("书源配置超过 2MiB")
        }
        // Kotlin android.util.AtomicFile → Data.write(to:, options: .atomic)
        try jsonContent.data(using: .utf8)?.write(to: configFile(sourceId), options: .atomic)
        var ids = Set(defaults.stringArray(forKey: "custom_source_ids") ?? [])
        ids.insert(sourceId)
        defaults.set(Array(ids), forKey: "custom_source_ids")
        defaults.removeObject(forKey: "custom_source_json_\(sourceId)")
    }

    func getCustomSourceJsons() async throws -> [String: String] {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        var ids = Set(defaults.stringArray(forKey: "custom_source_ids") ?? [])
        // 迁移：legacy "custom_source_json_<id>" prefs 条目落盘到文件
        for (key, value) in defaults.dictionaryRepresentation() {
            if key.hasPrefix("custom_source_json_"), let value = value as? String {
                let id = String(key.dropFirst("custom_source_json_".count))
                guard Data(value.utf8).count <= 2 * 1024 * 1024 else {
                    throw SourceException.parseError("书源配置超过 2MiB")
                }
                try value.data(using: .utf8)?.write(to: configFile(id), options: .atomic)
                ids.insert(id)
                defaults.removeObject(forKey: key)
            }
        }
        defaults.set(Array(ids), forKey: "custom_source_ids")
        var result: [String: String] = [:]
        for id in ids {
            let f = configFile(id)
            guard FileManager.default.fileExists(atPath: f.path) else { continue }
            // Kotlin: f.isFile && f.length() <= 2MiB
            let size = (try? FileManager.default.attributesOfItem(atPath: f.path)[.size] as? Int) ?? 0
            if (size ?? 0) > 2 * 1024 * 1024 { continue }
            if let text = try? String(contentsOf: f, encoding: .utf8) {
                result[id] = text
            }
        }
        return result
    }

    func removeCustomSourceJson(sourceId: String) async {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        var ids = Set(defaults.stringArray(forKey: "custom_source_ids") ?? [])
        ids.remove(sourceId)
        defaults.set(Array(ids), forKey: "custom_source_ids")
        defaults.removeObject(forKey: "custom_source_json_\(sourceId)")
        defaults.removeObject(forKey: "source_enabled_\(sourceId)")
        try? FileManager.default.removeItem(at: configFile(sourceId))
    }
}

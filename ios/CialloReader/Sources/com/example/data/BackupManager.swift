import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/BackupManager.kt（109 行）

struct BackupPayload {
    var exportTime: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var booksCount: Int
    var preferences: [String: String]
}

/// Full portable ZIP backup plus compatibility JSON envelope.
final class BackupManager {
    static let shared = BackupManager()
    private let prefs = PreferencesManager.shared
    private var godRepository: GodMomentRepository? { GodMomentRepository.shared } // com.example.god.GodMomentRepository

    private init() {}

    // MARK: ZIP 备份/恢复

    func exportBackupArchive(target: URL) async throws -> URL {
        ContentMutationGate.shared.withLock {
            try BackupArchive.export(to: target) // mutex.lock()/unlock() 由同步体覆盖
        }
    }

    func restoreBackupArchive(archive: URL) async -> Bool {
        await DownloadManager.withControlLock {
            // ComicDownloadManager.withControlLock：library 包归别的代理，iOS 侧暂无并发下载控制器（TODO）
            let dao = DownloadTaskDao(db: AppDatabase.shared.db)
            for task in (try? dao.allTasksSync()) ?? [] {
                if task.statusValue == .pending || task.statusValue == .downloading {
                    Task { // was withTaskLock
                        let fresh = try? dao.taskById(task.id)
                        if let fresh, fresh.statusValue != .completed {
                            try? dao.updateProgressAndStatus(id: task.id, status: .paused,
                                                             downloadedBytes: fresh.downloadedBytes,
                                                             totalBytes: fresh.totalBytes, errorMessage: nil)
                        }
                    }
                }
            }
            for task in (try? dao.allTasksSync()) ?? [] {
                DownloadProgressBroadcaster.shared.removeState(task.id)
            }
            // ComicDownloadManager.pauseAllLocked：同上（TODO）
            return ContentMutationGate.shared.withLock {
                let ok = (try? BackupArchive.restore(from: archive)) ?? false
                if ok { ContentMutationGate.shared.invalidatePendingWrites() }
                return ok
            }
        }
    }

    // MARK: JSON 兼容信封

    func exportBackupJson() async throws -> String {
        let cache = FileManager.default.temporaryDirectory
        let archive = try await exportBackupArchive(target: cache.appendingPathComponent("backup_\(UUID().uuidString).zip"))
        let encoded: String
        do {
            let size = (try? archive.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= 16 * 1024 * 1024 else { throw ImportError("备份超过 JSON 容量，请使用 ZIP 备份接口") }
            encoded = Data(contentsOf: archive).base64EncodedString()
        }
        defer { try? FileManager.default.removeItem(at: archive) }
        // Kotlin：val godArray = godRepository?.runCatching { exportJson() }?.getOrNull()
        // TODO: GodMomentRepository.exportJson（god 包归别的代理，落地后接入）
        let godArray: [Any]? = nil
        let payload = BackupPayload(
            booksCount: (try? AppDatabase.shared.count("SELECT COUNT(*) FROM books")) ?? 0,
            preferences: [
                "fontSize": String(prefs.fontSize),
                "lineHeight": String(prefs.lineHeight),
                "readerTheme": String(prefs.readerTheme),
                "pageTurnMode": String(prefs.pageTurnMode),
                "splashPureMode": String(prefs.splashPureMode),
                "screenOrientationLock": String(prefs.screenOrientationLock),
                "restReminderMinutes": String(prefs.restReminderMinutes),
            ]
        )
        var json: [String: Any] = [
            "archive": encoded,
            "exportTime": payload.exportTime,
            "booksCount": payload.booksCount,
            "preferences": payload.preferences,
        ]
        if let godArray { json["godMoments"] = godArray }
        let data = try JSONSerialization.data(withJSONObject: json)
        let text = String(decoding: data, as: UTF8.self)
        let file = filesRoot.appendingPathComponent("novel_reader_backup.json")
        try text.write(to: file, atomically: true, encoding: .utf8)
        return text
    }

    func restoreBackupJson(_ jsonString: String) async -> Bool {
        do {
            guard let payload = try? JSONSerialization.jsonObject(with: Data(jsonString.utf8)) as? [String: Any] else { return false }
            if let encoded = payload["archive"] as? String, !encoded.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                guard encoded.count <= 24 * 1024 * 1024 else { throw ImportError("备份过大") }
                let archive = FileManager.default.temporaryDirectory.appendingPathComponent("restore_\(UUID().uuidString).zip")
                do {
                    guard let data = Data(base64Encoded: encoded) else { throw ImportError("备份内容损坏") }
                    try data.write(to: archive)
                    return try await withArchiveCleanup(archive) { await self.restoreBackupArchive(archive: $0) }
                }
            }
            guard let preferences = payload["preferences"] as? [String: Any] else { return false }

            func toFloat(_ key: String) -> Double? {
                (preferences[key] as? String).flatMap { Double($0) }
            }
            func toInt(_ key: String) -> Int? {
                (preferences[key] as? String).flatMap { Int($0) }
            }
            func toBool(_ key: String) -> Bool? {
                switch preferences[key] as? String {
                case "true": return true
                case "false": return false
                default: return nil
                }
            }
            if let v = toFloat("fontSize"), v.isFinite && v >= 8 && v <= 80 { prefs.fontSize = v }
            if let v = toFloat("lineHeight"), v.isFinite && v >= 8 && v <= 120 { prefs.lineHeight = v }
            if let v = toInt("readerTheme"), v >= 0 && v <= 5 { prefs.readerTheme = v }
            if let v = toInt("pageTurnMode"), v >= 0 && v <= 4 { prefs.pageTurnMode = v }
            if let v = toBool("splashPureMode") { prefs.splashPureMode = v }
            if let v = toInt("screenOrientationLock"), v >= 0 && v <= 2 { prefs.screenOrientationLock = v }
            if let v = toInt("restReminderMinutes"), v >= 0 && v <= 1440 { prefs.restReminderMinutes = v }

            // 神回：同 (bookId, chapterId) 覆盖；缺失字段走默认值，旧备份文件照样能读
            // TODO: GodMomentRepository.importJson（god 包归别的代理，落地后接入）
            if let godArray = payload["godMoments"] {
                _ = godArray
            }
            return true
        } catch {
            if error is CancellationError { return false }
            return false
        }
    }

    private func withArchiveCleanup(_ archive: URL, _ body: (URL) async -> Bool) async rethrows -> Bool {
        let ok = await body(archive)
        try? FileManager.default.removeItem(at: archive)
        return ok
    }

    private var filesRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    // MARK: iOS 侧辅助 facade（SettingsTabScreen 使用，Kotlin 无对应）

    static func exportBackup() async throws -> URL {
        let dir = filesRootStatic.appendingPathComponent("backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("ciallo_backup_\(Int(Date().timeIntervalSince1970)).zip")
        try? FileManager.default.removeItem(at: file)
        _ = try await shared.exportBackupArchive(target: file)
        return file
    }

    static func importBackup(from url: URL) async throws {
        _ = try await BackupArchive.restore(from: url)
    }

    private static var filesRootStatic: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
}

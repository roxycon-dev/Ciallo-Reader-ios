import Foundation

struct TransferJournalRecord: Codable {
    let version: Int
    let id: String
    let stageId: String
    let keepUndo: Bool
    let createdAt: Double
    let settings: [String: String?]
}
private struct TransferJournalMetadata: Codable {
    let record: TransferJournalRecord
    let presence: [String: Bool]
}
struct TransferUndoPending: Codable {
    let version: Int
    let operationId: String
    let snapshot: TransferJournalRecord
}
private struct TransferUndoMetadata: Codable {
    let pending: TransferUndoPending
    let presence: [String: Bool]
}

/// Device-private external-state undo log. The SQLite commit marker decides
/// whether these snapshots are restored or finalized; this class never copies
/// account Keychain items and never adds journal data to a portable archive.
final class TransferImportJournal {
    private let documents: URL
    private let names = ["source_configs", "js_sources"]
    init(documents: URL) { self.documents = documents.standardizedFileURL.resolvingSymlinksInPath() }
    private var root: URL { documents.appendingPathComponent("transfer/journal", isDirectory: true) }
    private var pendingURL: URL { root.appendingPathComponent("pending.json") }
    private var undo: URL { documents.appendingPathComponent("transfer/undo", isDirectory: true) }
    private var previousUndo: URL { documents.appendingPathComponent("transfer/undo.previous", isDirectory: true) }
    private var undoPendingURL: URL { root.appendingPathComponent("undo.pending.json") }
    private func validate(_ record: TransferJournalRecord) throws {
        guard record.version == 1, UUID(uuidString: record.id)?.uuidString.lowercased() == record.id,
              UUID(uuidString: record.stageId)?.uuidString.lowercased() == record.stageId,
              record.createdAt.isFinite, record.createdAt >= 0, record.settings.count <= 10000 else { throw TransferNativeError.invalid("导入恢复记录无效") }
    }
    private func directory(_ record: TransferJournalRecord) throws -> URL { try validate(record); return root.appendingPathComponent(record.id, isDirectory: true) }
    private func safe(_ url: URL) throws {
        let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
        guard resolved.path.hasPrefix(documents.path + "/"), resolved.path == url.standardizedFileURL.path else { throw TransferNativeError.invalid("导入日志路径越界") }
    }
    private func remove(_ url: URL) throws { try safe(url); if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
    private func atomic(_ bytes: Data, to url: URL) throws {
        try safe(url); guard bytes.count <= 8 * 1024 * 1024 else { throw TransferNativeError.invalid("本机恢复设置快照过大") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }; try handle.synchronize()
    }
    private func metadata(_ url: URL) throws -> TransferJournalMetadata {
        try safe(url)
        let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? Int.max
        guard size <= 8 * 1024 * 1024 else { throw TransferNativeError.invalid("本机导入日志过大") }
        let value = try JSONDecoder().decode(TransferJournalMetadata.self, from: Data(contentsOf: url)); try validate(value.record)
        guard Set(value.presence.keys) == Set(names) else { throw TransferNativeError.invalid("本机源快照不完整") }; return value
    }
    func pending() throws -> TransferJournalRecord? {
        guard FileManager.default.fileExists(atPath: pendingURL.path) else {
            // No operation begins until pending.json is durable. Directories
            // left by an interrupted preparation can therefore be removed.
            if FileManager.default.fileExists(atPath: root.path) {
                for child in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where UUID(uuidString: child.lastPathComponent) != nil { try remove(child) }
            }
            return nil
        }; return try metadata(pendingURL).record
    }
    private func copyDefinitions(_ source: URL, to destination: URL) throws {
        try safe(source); try safe(destination)
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: source.path, isDirectory: &directory), directory.boolValue,
              let files = FileManager.default.enumerator(at: source, includingPropertiesForKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey], options: []) else { throw TransferNativeError.invalid("本机源快照无法读取") }
        var count = 0, bytes: UInt64 = 0
        for case let file as URL in files {
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey])
            count += 1; guard count <= 50000, values.isSymbolicLink != true else { throw TransferNativeError.invalid("本机源目录包含链接或过多文件") }
            if values.isRegularFile == true { let size = values.fileSize ?? 0; guard size >= 0 else { throw TransferNativeError.invalid("本机源文件大小无效") }; bytes += UInt64(size); guard bytes <= 512 * 1024 * 1024 else { throw TransferNativeError.invalid("本机源快照超过容量限制") } }
        }
        try FileManager.default.copyItem(at: source, to: destination)
    }
    func prepare(_ record: TransferJournalRecord) throws {
        try validate(record)
        guard !FileManager.default.fileExists(atPath: undoPendingURL.path) else { throw TransferNativeError.invalid("上次撤回需要先完成") }
        guard try pending() == nil else { throw TransferNativeError.invalid("上次导入需要先恢复") }
        let directory = try self.directory(record); try safe(directory)
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw TransferNativeError.invalid("导入日志身份已存在") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var presence = [String: Bool]()
        do {
            for name in names {
                let source = documents.appendingPathComponent(name, isDirectory: true), exists = FileManager.default.fileExists(atPath: source.path)
                presence[name] = exists
                if exists { try copyDefinitions(source, to: directory.appendingPathComponent(name, isDirectory: true)) }
            }
            let bytes = try JSONEncoder().encode(TransferJournalMetadata(record: record, presence: presence))
            try atomic(bytes, to: directory.appendingPathComponent("metadata.json"))
            // This marker is published only after both complete snapshots exist.
            try atomic(bytes, to: pendingURL)
        } catch { if !FileManager.default.fileExists(atPath: pendingURL.path) { try? remove(directory) }; throw error }
    }
    func restore(_ expectedId: String) throws {
        let value = try metadata(pendingURL); guard value.record.id == expectedId else { throw TransferNativeError.invalid("导入恢复身份不符") }
        let directory = try self.directory(value.record)
        try restoreDefinitions(value, directory: directory)
        try remove(documents.appendingPathComponent("restored_transfer_" + value.record.stageId, isDirectory: true))
    }
    private func restoreDefinitions(_ value: TransferJournalMetadata, directory: URL) throws {
        for name in names where value.presence[name] == true {
            guard FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) else { throw TransferNativeError.invalid("本机源恢复快照缺失") }
        }
        for name in names {
            let target = documents.appendingPathComponent(name, isDirectory: true), backup = directory.appendingPathComponent(name, isDirectory: true)
            let candidate = directory.appendingPathComponent("restore-" + name, isDirectory: true), displaced = directory.appendingPathComponent("displaced-" + name, isDirectory: true)
            try remove(candidate)
            if value.presence[name] == true { try copyDefinitions(backup, to: candidate) }
            try remove(displaced); try safe(target)
            if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.moveItem(at: target, to: displaced) }
            if value.presence[name] == true { try FileManager.default.moveItem(at: candidate, to: target) }
            try remove(displaced)
        }
    }
    func undoSnapshot() throws -> TransferJournalRecord? {
        guard FileManager.default.fileExists(atPath: undo.path) else { return nil }
        return try metadata(undo.appendingPathComponent("metadata.json")).record
    }
    private func undoMetadata() throws -> TransferUndoMetadata? {
        guard FileManager.default.fileExists(atPath: undoPendingURL.path) else { return nil }
        try safe(undoPendingURL)
        let count = (try FileManager.default.attributesOfItem(atPath: undoPendingURL.path)[.size] as? NSNumber)?.intValue ?? Int.max
        guard count <= 8 * 1024 * 1024 else { throw TransferNativeError.invalid("撤回记录过大") }
        let value = try JSONDecoder().decode(TransferUndoMetadata.self, from: Data(contentsOf: undoPendingURL))
        try validate(value.pending.snapshot)
        guard value.pending.version == 1, UUID(uuidString: value.pending.operationId)?.uuidString.lowercased() == value.pending.operationId,
              value.pending.snapshot.keepUndo, Set(value.presence.keys) == Set(names) else { throw TransferNativeError.invalid("撤回记录无效") }; return value
    }
    func pendingUndo() throws -> TransferUndoPending? { try undoMetadata()?.pending }
    func beginUndo(_ operationId: String, snapshotId: String) throws -> TransferUndoPending {
        guard UUID(uuidString: operationId)?.uuidString.lowercased() == operationId,
              try pending() == nil, try pendingUndo() == nil else { throw TransferNativeError.invalid("上次恢复尚未完成或撤回身份无效") }
        let snapshot = try metadata(undo.appendingPathComponent("metadata.json"))
        guard snapshot.record.id == snapshotId, snapshot.record.keepUndo else { throw TransferNativeError.invalid("恢复快照已经改变") }
        let intent = TransferUndoPending(version: 1, operationId: operationId, snapshot: snapshot.record)
        try atomic(JSONEncoder().encode(TransferUndoMetadata(pending: intent, presence: snapshot.presence)), to: undoPendingURL); return intent
    }
    func restoreUndo(_ operationId: String) throws {
        guard let value = try undoMetadata(), value.pending.operationId == operationId,
              try metadata(undo.appendingPathComponent("metadata.json")).record.id == value.pending.snapshot.id else { throw TransferNativeError.invalid("撤回快照身份不符") }
        try restoreDefinitions(TransferJournalMetadata(record: value.pending.snapshot, presence: value.presence), directory: undo)
    }
    func finishUndo(_ operationId: String) throws {
        guard let value = try undoMetadata(), value.pending.operationId == operationId else { throw TransferNativeError.invalid("撤回记录身份不符") }
        if FileManager.default.fileExists(atPath: undo.path) {
            guard try metadata(undo.appendingPathComponent("metadata.json")).record.id == value.pending.snapshot.id else { throw TransferNativeError.invalid("撤回快照已经改变") }
        }
        // The complete pending record survives backup deletion. After a crash,
        // the committed SQLite marker can finish this cleanup without backups.
        try remove(documents.appendingPathComponent("restored_transfer_" + value.pending.snapshot.stageId, isDirectory: true))
        try remove(undo); try remove(undoPendingURL)
    }
    func discard(_ expectedId: String) throws {
        guard let record = try pending(), record.id == expectedId else { throw TransferNativeError.invalid("导入日志身份不符") }
        try remove(pendingURL); try remove(try directory(record))
    }
    func finish(_ expectedId: String) throws {
        guard let record = try pending(), record.id == expectedId else { throw TransferNativeError.invalid("导入日志身份不符") }
        let directory = try self.directory(record)
        if record.keepUndo {
            if FileManager.default.fileExists(atPath: directory.path) {
                if FileManager.default.fileExists(atPath: undo.path) { try remove(previousUndo); try safe(undo); try FileManager.default.moveItem(at: undo, to: previousUndo) }
                try safe(undo); try FileManager.default.moveItem(at: directory, to: undo)
            } else { guard try metadata(undo.appendingPathComponent("metadata.json")).record.id == record.id else { throw TransferNativeError.invalid("回退快照未能保存") } }
            try remove(previousUndo)
        } else { try remove(directory) }
        let imported = documents.appendingPathComponent("restored_transfer_" + record.stageId, isDirectory: true)
        for name in ["database.rows", "settings.json", "manifest.json"] { try remove(imported.appendingPathComponent(name)) }
        try remove(pendingURL)
    }
}

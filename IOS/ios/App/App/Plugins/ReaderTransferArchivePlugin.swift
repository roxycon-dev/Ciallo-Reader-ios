import Foundation
import Capacitor

@objc(ReaderTransferArchivePlugin)
public class ReaderTransferArchivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderTransferArchivePlugin"
    public let jsName = "ReaderTransferArchive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rows", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selfTest", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "ciallo.transfer.archive", qos: .utility)
    private let lock = NSLock()
    private var generation = 0
    private func epoch() -> Int { lock.lock(); defer { lock.unlock() }; return generation }
    private func validId(_ id: String) -> Bool { UUID(uuidString: id)?.uuidString.lowercased() == id }
    private var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath() }
    private func documentURL(_ path: String) throws -> URL {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"), path.utf8.count <= 4096,
              path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw TransferNativeError.invalid("本地资源路径无效") }
        let root = documents, url = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard url.path.hasPrefix(root.path + "/") else { throw TransferNativeError.invalid("本地资源路径越界") }; return url
    }
    private func stage(_ id: String) throws -> URL {
        guard validId(id) else { throw TransferNativeError.invalid("归档暂存身份无效") }
        return try documentURL("transfer/staging/\(id)")
    }
    private func metadataText(_ url: URL) throws -> String {
        let count = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.uint64Value ?? UInt64.max
        guard count <= 8 * 1024 * 1024 else { throw TransferNativeError.invalid("归档元数据过大") }
        return try String(contentsOf: url, encoding: .utf8)
    }
    @objc func prepare(_ call: CAPPluginCall) {
        queue.async {
            do {
                let id = UUID().uuidString.lowercased(), url = try self.stage(id)
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
                call.resolve(["stageId": id])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getString("stageId"), let name = call.getString("entry"), ["database.rows", "settings.json"].contains(name),
              let text = call.getString("text"), text.utf8.count <= 2 * 1024 * 1024 else { call.reject("归档写入范围无效"); return }
        let epoch = epoch()
        queue.async {
            do {
                guard self.epoch() == epoch else { throw TransferNativeError.invalid("归档操作已取消") }
                let url = try self.stage(id).appendingPathComponent(name), bytes = Data(text.utf8)
                guard FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path) else { throw TransferNativeError.invalid("归档暂存目录已失效") }
                if !FileManager.default.fileExists(atPath: url.path) { guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw TransferNativeError.invalid("无法创建归档数据") } }
                let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
                if call.getBool("reset") == true { try handle.truncate(atOffset: 0) }
                let position = try handle.seekToEnd()
                guard position + UInt64(bytes.count) <= TransferZip.entryMaximum else { throw TransferNativeError.invalid("归档数据文件超过 512MiB") }
                try handle.write(contentsOf: bytes); call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func pack(_ call: CAPPluginCall) {
        guard let id = call.getString("stageId"), let sessionId = call.getString("sessionId"), validId(sessionId),
              let resourceRows = call.getArray("resources") as? [[String: Any]], resourceRows.count < 49998,
              let metadata = call.getObject("metadata") else { call.reject("归档打包参数无效"); return }
        let epoch = epoch()
        queue.async {
            var temporary: URL?
            do {
                let directory = try self.stage(id), target = try self.documentURL("transfer/\(sessionId).outgoing")
                let pending = directory.appendingPathComponent("archive.tmp"); temporary = pending
                let cancelled = { self.epoch() != epoch }
                var sources: [(path: String, source: URL)] = [("database.rows", directory.appendingPathComponent("database.rows")), ("settings.json", directory.appendingPathComponent("settings.json"))]
                for resource in resourceRows {
                    guard let path = resource["path"] as? String, path.hasPrefix("files/"), let source = resource["sourcePath"] as? String else { throw TransferNativeError.invalid("归档资源无效") }
                    try TransferZip.validPath(path); sources.append((path, try self.documentURL(source)))
                }
                var entries = [[String: Any]](), expanded: UInt64 = 0, hashes = [String: String]()
                for source in sources {
                    guard !cancelled() else { throw TransferNativeError.invalid("归档操作已取消") }
                    let values = try source.source.resourceValues(forKeys: [.isRegularFileKey])
                    guard values.isRegularFile == true else { throw TransferNativeError.invalid("归档资源不是普通文件") }
                    let digest = try TransferZip.hashFile(source.source); expanded += digest.size
                    guard expanded <= TransferZip.maximum else { throw TransferNativeError.invalid("归档展开大小超过 4GiB") }
                    entries.append(["path": source.path, "size": digest.size, "sha256": digest.sha256])
                    hashes[source.path] = digest.sha256
                }
                var manifest: [String: Any] = ["format": "ciallo-transfer", "version": 2, "schema": 13, "entries": entries, "expandedBytes": expanded]
                for key in ["packageId", "createdAt", "categories", "counts", "warnings", "containsProtected", "protectedFavorites"] {
                    guard let value = metadata[key] else { throw TransferNativeError.invalid("归档清单缺失：\(key)") }; manifest[key] = value
                }
                let bytes = try JSONSerialization.data(withJSONObject: manifest)
                guard bytes.count <= 8 * 1024 * 1024 else { throw TransferNativeError.invalid("归档清单过大") }
                let manifestURL = directory.appendingPathComponent("manifest.json"); try bytes.write(to: manifestURL, options: .atomic)
                try TransferZip.pack([("manifest.json", manifestURL)] + sources, to: pending, expectedHashes: hashes, cancelled: cancelled)
                guard !cancelled(), !FileManager.default.fileExists(atPath: target.path) else { throw TransferNativeError.invalid("归档操作取消或发送文件已存在") }
                try FileManager.default.moveItem(at: pending, to: target); temporary = nil
                call.resolve(["path": "transfer/\(sessionId).outgoing", "manifest": String(data: bytes, encoding: .utf8)!])
            } catch { if let temporary = temporary { try? FileManager.default.removeItem(at: temporary) }; call.reject(error.localizedDescription) }
        }
    }
    @objc func extract(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), path.hasPrefix("transfer/") else { call.reject("归档接收路径无效"); return }
        let epoch = epoch()
        queue.async {
            var directory: URL?
            do {
                let archive = try self.documentURL(path), id = UUID().uuidString.lowercased(), stage = try self.stage(id); directory = stage
                let entries = try TransferZip.extract(archive, to: stage, cancelled: { self.epoch() != epoch })
                guard entries.contains(where: { $0.path == "database.rows" }), entries.contains(where: { $0.path == "settings.json" }) else { throw TransferNativeError.invalid("数据文件缺失") }
                let settings = try self.metadataText(stage.appendingPathComponent("settings.json"))
                let manifest: Any = entries.contains(where: { $0.path == "manifest.json" }) ? try self.metadataText(stage.appendingPathComponent("manifest.json")) : NSNull()
                call.resolve(["stageId": id, "settings": settings, "manifest": manifest,
                    "entries": entries.map { ["path": $0.path, "size": $0.size, "sha256": $0.sha256] as [String: Any] }])
                directory = nil
            } catch { if let directory = directory { try? FileManager.default.removeItem(at: directory) }; call.reject(error.localizedDescription) }
        }
    }
    @objc func rows(_ call: CAPPluginCall) {
        guard let id = call.getString("stageId"), let cursor = call.getDouble("cursor"), cursor >= 0, cursor <= Double(TransferZip.entryMaximum), cursor.rounded(.down) == cursor else { call.reject("数据行读取位置无效"); return }
        let epoch = epoch()
        queue.async {
            do {
                _ = try self.stage(id)
                let url = try self.documentURL("transfer/staging/\(id)/database.rows"), input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
                let size = try input.seekToEnd()
                guard UInt64(cursor) <= size, size <= TransferZip.entryMaximum else { throw TransferNativeError.invalid("数据行读取越界") }
                try input.seek(toOffset: UInt64(cursor))
                var lines = [String](), pending = Data(), position = UInt64(cursor), batchBytes = 0, finished = false
                while !finished {
                    guard self.epoch() == epoch else { throw TransferNativeError.invalid("归档操作已取消") }
                    let bytes = try input.read(upToCount: 65536) ?? Data()
                    if bytes.isEmpty {
                        if !pending.isEmpty {
                            guard let line = String(data: pending, encoding: .utf8), line.utf16.count <= 512 * 1024 else { throw TransferNativeError.invalid("数据行过大或 UTF-8 错误") }; lines.append(line)
                        }
                        finished = true; break
                    }
                    var offset = bytes.startIndex
                    while offset < bytes.endIndex {
                        let newline = bytes[offset...].firstIndex(of: 10), end = newline ?? bytes.endIndex
                        pending.append(bytes[offset..<end]); position += UInt64(end - offset)
                        guard pending.count <= 2 * 1024 * 1024 else { throw TransferNativeError.invalid("数据行过大") }
                        if newline != nil {
                            position += 1
                            guard let line = String(data: pending, encoding: .utf8), line.utf16.count <= 512 * 1024 else { throw TransferNativeError.invalid("数据行过大或 UTF-8 错误") }
                            lines.append(line); batchBytes += pending.count; pending.removeAll(keepingCapacity: true); offset = end + 1
                            if lines.count >= 128 || batchBytes >= 512 * 1024 { finished = true; break }
                        } else { offset = end }
                    }
                }
                call.resolve(["lines": lines, "cursor": position, "done": position == size])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func discard(_ call: CAPPluginCall) {
        guard let id = call.getString("stageId") else { call.reject("暂存身份缺失"); return }
        queue.async {
            do { let url = try self.stage(id); if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; call.resolve() }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func cancel(_ call: CAPPluginCall) { lock.lock(); generation += 1; lock.unlock(); call.resolve() }
    @objc func selfTest(_ call: CAPPluginCall) {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["CIALLO_NATIVE_TESTS"] == "1", let encoded = call.getString("data"), encoded.utf8.count <= 65536,
              let bytes = Data(base64Encoded: encoded), bytes.count > 100 else { call.reject("Simulator ZIP tests are disabled or fixture is invalid"); return }
        queue.async {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("transfer-zip-test-" + UUID().uuidString, isDirectory: true)
            let trace: (String) -> Void = { phase in
                let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("reader-transfer-zip-state.json")
                try? JSONSerialization.data(withJSONObject: ["phase": phase, "timestamp": Date().timeIntervalSince1970]).write(to: url, options: .atomic)
                NSLog("Ciallo transfer ZIP self-test: %@", phase)
            }
            defer { try? FileManager.default.removeItem(at: root) }
            do {
                trace("fixture.write")
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                let input = root.appendingPathComponent("android.zip"); try bytes.write(to: input)
                trace("android.extract")
                let extracted = root.appendingPathComponent("extracted"), first = try TransferZip.extract(input, to: extracted)
                guard first.count == 5, first.contains(where: { $0.path == "files/插图.bin" && $0.size == 1048613 }),
                      first.contains(where: { $0.path == "files/empty" && $0.size == 0 }) else { throw TransferNativeError.invalid("Android ZIP fixture entries mismatch") }
                let output = root.appendingPathComponent("ios.zip")
                trace("ios.pack")
                try TransferZip.pack(first.map { ($0.path, extracted.appendingPathComponent($0.path)) }, to: output)
                trace("ios.extract")
                let second = try TransferZip.extract(output, to: root.appendingPathComponent("roundtrip"))
                guard first.map({ $0.path + ":" + $0.sha256 }) == second.map({ $0.path + ":" + $0.sha256 }) else { throw TransferNativeError.invalid("Streamed ZIP roundtrip changed data") }
                var corrupt = bytes; corrupt[64] ^= 1; let damaged = root.appendingPathComponent("damaged.zip"); try corrupt.write(to: damaged)
                var rejected = false
                trace("damaged.extract")
                do { _ = try TransferZip.extract(damaged, to: root.appendingPathComponent("bad")) } catch { rejected = true }
                guard rejected else { throw TransferNativeError.invalid("Corrupted ZIP was accepted") }
                let exported = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("reader-transfer-stored.zip")
                if FileManager.default.fileExists(atPath: exported.path) { try FileManager.default.removeItem(at: exported) }
                try FileManager.default.copyItem(at: output, to: exported)
                trace("passed")
                call.resolve(["detail": "Android DEFLATE/data descriptors, Unicode filenames, zero-byte entry, CRC rejection and bounded native ZIP roundtrip verified"])
            } catch { trace("failed: " + error.localizedDescription); call.reject(error.localizedDescription) }
        }
        #else
        call.reject("Simulator tests are disabled")
        #endif
    }
}

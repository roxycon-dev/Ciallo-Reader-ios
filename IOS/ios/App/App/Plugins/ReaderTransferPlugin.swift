import Foundation
import UIKit
import Network
import CryptoKit
import Capacitor

private final class ReaderTransferConnection {
    let connection: NWConnection
    var opening: CAPPluginCall?
    var reading: CAPPluginCall?
    var writing: CAPPluginCall?
    var eof = false
    var ready = false
    init(_ connection: NWConnection, opening: CAPPluginCall?) { self.connection = connection; self.opening = opening }
}

@objc(ReaderTransferPlugin)
public class ReaderTransferPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderTransferPlugin"
    public let jsName = "ReaderTransfer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "file", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkpoint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selfTest", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "ciallo.transfer.network", qos: .userInitiated)
    private let files = DispatchQueue(label: "ciallo.transfer.files", qos: .utility)
    private let service = "_ciallo-xfer._tcp"
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var endpoints = [String: NWEndpoint]()
    private var connections = [String: ReaderTransferConnection]()
    private var identity: TransferIdentity?
    private var starting: CAPPluginCall?
    private var generation = 0
    #if DEBUG && targetEnvironment(simulator)
    private var loopbackTest: TransferLoopbackTest?
    private func runLoopbackTest(_ call: CAPPluginCall) {
        guard loopbackTest == nil else { call.reject("Native transfer test is already running"); return }
        let test = TransferLoopbackTest(queue: queue) { [weak self] result in
            self?.loopbackTest = nil
            switch result { case .success(let detail): call.resolve(["detail": detail]); case .failure(let error): call.reject(error.localizedDescription) }
        }
        loopbackTest = test; test.start()
    }
    #endif

    @objc func start(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty, id.utf8.count <= 128,
              let name = call.getString("name"), !name.isEmpty, name.utf8.count <= 192 else { call.reject("设备信息无效"); return }
        queue.async {
            guard self.listener == nil else { call.reject("互传已开启"); return }
            do {
                let identity = try TransferIdentity.load(); self.identity = identity
                let listener = try NWListener(using: identity.parameters(queue: self.queue), on: .any)
                self.listener = listener; self.starting = call
                self.generation += 1; let generation = self.generation
                var txt = Data()
                for entry in ["id=\(id)", "name=\(name)", "v=1"] {
                    let bytes = Data(entry.utf8); txt.append(UInt8(bytes.count)); txt.append(bytes)
                }
                listener.service = NWListener.Service(name: "Ciallo-\(id.prefix(8))", type: self.service, txtRecord: txt)
                listener.newConnectionHandler = { [weak self] connection in
                    guard let self = self, self.generation == generation, self.connections.isEmpty else { connection.cancel(); return }
                    self.track(connection, opening: nil)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self = self, self.generation == generation else { return }
                    switch state {
                    case .ready:
                        self.startBrowser(localId: id, generation: generation)
                        self.starting?.resolve(["port": Int(listener.port?.rawValue ?? 0), "fingerprint": identity.fingerprint]); self.starting = nil
                    case .failed(let error), .waiting(let error):
                        self.starting?.reject(error.localizedDescription); self.starting = nil
                        self.notifyListeners("transferError", data: ["message": "本地网络不可用，请检查系统中的本地网络权限：\(error.localizedDescription)"])
                        if case .failed = state { self.stopAll() }
                    default: break
                    }
                }
                listener.start(queue: self.queue)
                self.queue.asyncAfter(deadline: .now() + 12) {
                    if self.generation == generation, self.starting != nil { self.starting?.reject("开启本地网络超时，请检查权限"); self.starting = nil; self.stopAll() }
                }
            } catch { self.stopAll(); call.reject(error.localizedDescription) }
        }
    }
    private func startBrowser(localId: String, generation: Int) {
        guard browser == nil else { return }
        let params = NWParameters.tcp; params.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: service, domain: nil), using: params)
        self.browser = browser
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self = self, self.generation == generation else { return }
            var endpoints = [String: NWEndpoint](), peers = [[String: Any]]()
            for result in results {
                guard peers.count < 128, case .bonjour(let txt) = result.metadata,
                      let id = txt.dictionary["id"], id != localId, !id.isEmpty, id.utf8.count <= 128,
                      txt.dictionary["v"] == "1", let name = txt.dictionary["name"], name.utf8.count <= 192 else { continue }
                endpoints[id] = result.endpoint
                peers.append(["id": id, "name": String(name.prefix(64))])
            }
            self.endpoints = endpoints
            self.notifyListeners("peers", data: ["peers": peers.sorted { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }])
        }
        browser.stateUpdateHandler = { [weak self] state in
            guard let self = self, self.generation == generation else { return }
            if case .failed(let error) = state { self.notifyListeners("transferError", data: ["message": "设备发现失败：\(error.localizedDescription)"]) }
            if case .waiting(let error) = state { self.notifyListeners("transferError", data: ["message": "等待本地网络：\(error.localizedDescription)"]) }
        }
        browser.start(queue: queue)
    }
    @objc func connect(_ call: CAPPluginCall) {
        guard let peer = call.getString("peerId") else { call.reject("请选择设备"); return }
        queue.async {
            guard self.connections.isEmpty, let endpoint = self.endpoints[peer], let identity = self.identity else { call.reject("设备已离线或当前有未完成连接"); return }
            do { self.track(NWConnection(to: endpoint, using: try identity.parameters(queue: self.queue)), opening: call) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    private func track(_ connection: NWConnection, opening: CAPPluginCall?) {
        let id = UUID().uuidString, item = ReaderTransferConnection(connection, opening: opening)
        connections[id] = item
        connection.stateUpdateHandler = { [weak self, weak item] state in
            guard let self = self, let item = item, self.connections[id] === item else { return }
            switch state {
            case .ready:
                do {
                    guard let identity = self.identity else { throw TransferNativeError.invalid("互传身份已关闭") }
                    let peer = try TransferIdentity.peerFingerprint(connection)
                    let metadata: [String: Any] = ["connectionId": id, "localFingerprint": identity.fingerprint, "peerFingerprint": peer]
                    item.ready = true
                    if let opening = item.opening { item.opening = nil; opening.resolve(metadata) }
                    else { self.notifyListeners("connection", data: metadata) }
                } catch { self.closeConnection(id, message: error.localizedDescription) }
            case .failed(let error): self.closeConnection(id, message: error.localizedDescription)
            case .cancelled: self.closeConnection(id, message: "连接已关闭")
            default: break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 12) { [weak self, weak item] in
            guard let self = self, let item = item, self.connections[id] === item, !item.ready else { return }
            self.closeConnection(id, message: "TLS 连接超时")
        }
    }
    private func closeConnection(_ id: String, message: String) {
        guard let item = connections.removeValue(forKey: id) else { return }
        item.connection.stateUpdateHandler = nil; item.connection.cancel()
        item.opening?.reject(message); item.reading?.reject(message); item.writing?.reject(message)
        item.opening = nil; item.reading = nil; item.writing = nil
        notifyListeners("closed", data: ["connectionId": id, "message": message])
    }
    @objc func read(_ call: CAPPluginCall) {
        guard let id = call.getString("connectionId"), let maximum = call.getInt("maxBytes"), maximum > 0, maximum <= 65536 else { call.reject("读取范围无效"); return }
        queue.async {
            guard let item = self.connections[id], item.ready, item.reading == nil else { call.reject("连接已关闭或已有读取正在进行"); return }
            if item.eof { call.resolve(["eof": true]); return }
            item.reading = call
            item.connection.receive(minimumIncompleteLength: 1, maximumLength: maximum) { data, _, complete, error in
                guard self.connections[id] === item, item.reading === call else { return }
                item.reading = nil
                if let error = error { call.reject(error.localizedDescription); self.closeConnection(id, message: error.localizedDescription); return }
                item.eof = complete
                if let data = data, !data.isEmpty { call.resolve(["data": data.base64EncodedString(), "eof": false]) }
                else if complete { call.resolve(["eof": true]) }
                else { call.reject("传输流返回空数据"); self.closeConnection(id, message: "空数据") }
            }
        }
    }
    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getString("connectionId"), let encoded = call.getString("data"), encoded.utf8.count <= 1398104,
              let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 1048576 else { call.reject("写入数据无效"); return }
        queue.async {
            guard let item = self.connections[id], item.ready, item.writing == nil else { call.reject("连接已关闭或已有写入正在进行"); return }
            item.writing = call
            item.connection.send(content: bytes, completion: .contentProcessed { error in
                guard self.connections[id] === item, item.writing === call else { return }
                item.writing = nil
                if let error = error { call.reject(error.localizedDescription); self.closeConnection(id, message: error.localizedDescription) }
                else { call.resolve() }
            })
        }
    }
    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("connectionId") else { call.reject("连接标识缺失"); return }
        queue.async { self.closeConnection(id, message: "传输已取消"); call.resolve() }
    }
    private func stopAll() {
        generation += 1; listener?.stateUpdateHandler = nil; listener?.cancel(); listener = nil
        browser?.cancel(); browser = nil; endpoints.removeAll()
        for id in Array(connections.keys) { closeConnection(id, message: "互传已关闭") }
        starting?.reject("互传已关闭"); starting = nil; identity = nil
    }
    @objc func stop(_ call: CAPPluginCall) { queue.async { self.stopAll(); call.resolve() } }

    private func transferURL(_ path: String) throws -> URL {
        guard path.hasPrefix("transfer/"), !path.contains("\\"), !path.contains("\0"), !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }), path.utf8.count <= 1024 else { throw TransferNativeError.invalid("互传文件路径无效") }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
        let root = documents.appendingPathComponent("transfer", isDirectory: true)
        let url = documents.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard root.resolvingSymlinksInPath().path == root.path, url.path.hasPrefix(root.path + "/") else { throw TransferNativeError.invalid("互传文件路径越界") }
        return url
    }
    @objc func file(_ call: CAPPluginCall) {
        guard let action = call.getString("action"), let path = call.getString("path") else { call.reject("文件操作无效"); return }
        files.async {
            do {
                let url = try self.transferURL(path), manager = FileManager.default
                switch action {
                case "stat":
                    let attributes = try? manager.attributesOfItem(atPath: url.path)
                    let documents = manager.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    let capacity = try documents.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity ?? 0
                    call.resolve(["size": (attributes?[.size] as? NSNumber)?.uint64Value ?? 0, "exists": attributes != nil, "availableBytes": capacity])
                case "hash":
                    let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
                    var hash = SHA256(), total: UInt64 = 0
                    while true {
                        let bytes = try handle.read(upToCount: 65536) ?? Data(); if bytes.isEmpty { break }
                        total += UInt64(bytes.count); guard total <= 4294967296 else { throw TransferNativeError.invalid("归档超过 4GiB") }; hash.update(data: bytes)
                    }
                    call.resolve(["sha256": hash.finalize().map { String(format: "%02x", $0) }.joined()])
                case "read":
                    guard let offset = call.getDouble("offset"), offset >= 0, offset <= 4294967296, offset.rounded(.down) == offset,
                          let length = call.getInt("length"), length > 0, length <= 1048576 else { throw TransferNativeError.invalid("文件读取范围无效") }
                    let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }; try handle.seek(toOffset: UInt64(offset))
                    call.resolve(["data": (try handle.read(upToCount: length) ?? Data()).base64EncodedString()])
                case "truncate":
                    guard let length = call.getDouble("length"), length >= 0, length <= 4294967296, length.rounded(.down) == length else { throw TransferNativeError.invalid("文件截断范围无效") }
                    try manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    if !manager.fileExists(atPath: url.path) { guard length == 0, manager.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw TransferNativeError.invalid("续传文件缺失") } }
                    let handle = try FileHandle(forUpdating: url); defer { try? handle.close() }
                    guard length <= Double(try handle.seekToEnd()) else { throw TransferNativeError.invalid("续传文件过短") }
                    try handle.truncate(atOffset: UInt64(length)); try handle.synchronize(); call.resolve()
                case "append":
                    guard let encoded = call.getString("data"), encoded.utf8.count <= 1398104, let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 1048576 else { throw TransferNativeError.invalid("分块数据无效") }
                    let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
                    let offset = try handle.seekToEnd(); guard offset + UInt64(bytes.count) <= 4294967296 else { throw TransferNativeError.invalid("归档超过 4GiB") }
                    try handle.write(contentsOf: bytes); try handle.synchronize(); call.resolve()
                case "delete": if manager.fileExists(atPath: url.path) { try manager.removeItem(at: url) }; call.resolve()
                default: throw TransferNativeError.invalid("未知文件操作")
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func checkpoint(_ call: CAPPluginCall) {
        guard let direction = call.getString("direction"), direction == "incoming" || direction == "outgoing" else { call.reject("续传记录无效"); return }
        files.async {
            do {
                let url = try self.transferURL("transfer/\(direction).json")
                if call.getBool("remove") == true {
                    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; call.resolve(); return
                }
                if let text = call.getString("value") {
                    let bytes = Data(text.utf8); guard bytes.count <= 65536, (try JSONSerialization.jsonObject(with: bytes)) is [String: Any] else { throw TransferNativeError.invalid("续传记录格式无效") }
                    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }; try handle.synchronize(); call.resolve()
                } else {
                    guard FileManager.default.fileExists(atPath: url.path) else { call.resolve(["value": NSNull()]); return }
                    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
                    guard size <= 65536 else { throw TransferNativeError.invalid("续传记录过大") }
                    call.resolve(["value": try String(contentsOf: url, encoding: .utf8)])
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func selfTest(_ call: CAPPluginCall) {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["CIALLO_NATIVE_TESTS"] == "1" else { call.reject("Simulator tests are disabled"); return }
        queue.async { self.runLoopbackTest(call) }
        #else
        call.reject("Simulator tests are disabled")
        #endif
    }
}

#if DEBUG && targetEnvironment(simulator)
/// Exercises the same identity, verification callback and pull-based TLS APIs
/// on an actual simulator. No Bonjour service, external server or UI bypass.
private final class TransferLoopbackTest {
    private let queue: DispatchQueue
    private var completion: ((Result<String, Error>) -> Void)?
    private var listener: NWListener?
    private var client: NWConnection?
    private var server: NWConnection?
    private var serverIdentity: TransferIdentity?
    private var clientIdentity: TransferIdentity?
    private var received = 0
    private var digest = SHA256()
    private var response = Data()
    private let payload = Data((0..<(1048576 + 37)).map { UInt8($0 % 251) })
    init(queue: DispatchQueue, completion: @escaping (Result<String, Error>) -> Void) { self.queue = queue; self.completion = completion }
    func start() {
        do {
            let serverIdentity = try TransferIdentity.load(), clientIdentity = try TransferIdentity.load(label: "ciallo.transfer.ci.client.v1")
            self.serverIdentity = serverIdentity; self.clientIdentity = clientIdentity
            guard serverIdentity.fingerprint != clientIdentity.fingerprint,
                  try TransferIdentity.load().fingerprint == serverIdentity.fingerprint else { throw TransferNativeError.invalid("Device identity persistence failed") }
            var certificate: SecCertificate?
            guard SecIdentityCopyCertificate(serverIdentity.identity, &certificate) == errSecSuccess, let certificate = certificate else { throw TransferNativeError.invalid("Test identity certificate missing") }
            var changed = SecCertificateCopyData(certificate) as Data; changed[changed.count - 1] ^= 1
            guard let bad = SecCertificateCreateWithData(nil, changed as CFData) else { throw TransferNativeError.invalid("Cannot construct signature test") }
            do { _ = try TransferIdentity.validate(bad); throw TransferNativeError.invalid("Tampered signature accepted") }
            catch let error as TransferNativeError { if error.localizedDescription == "Tampered signature accepted" { throw error } }
            do { _ = try TransferIdentity.validate(certificate, now: Date(timeIntervalSince1970: 4133980800)); throw TransferNativeError.invalid("Expired certificate accepted") }
            catch let error as TransferNativeError { if error.localizedDescription == "Expired certificate accepted" { throw error } }
            let parameters = try serverIdentity.parameters(queue: queue)
            parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
            let listener = try NWListener(using: parameters, on: .any); self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                if case .ready = state { self.connect() }
                if case .failed(let error) = state { self.finish(.failure(error)) }
            }
            listener.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 25) { [weak self] in self?.finish(.failure(TransferNativeError.invalid("Native mutual TLS loopback timed out"))) }
        } catch { finish(.failure(error)) }
    }
    private func accept(_ connection: NWConnection) {
        guard server == nil else { connection.cancel(); return }; server = connection
        connection.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            if case .ready = state {
                do {
                    guard try TransferIdentity.peerFingerprint(connection) == self.clientIdentity?.fingerprint else { throw TransferNativeError.invalid("Client certificate fingerprint mismatch") }
                    self.receivePayload(connection)
                } catch { self.finish(.failure(error)) }
            }
            if case .failed(let error) = state { self.finish(.failure(error)) }
        }
        connection.start(queue: queue)
    }
    private func connect() {
        guard let port = listener?.port, let identity = clientIdentity else { finish(.failure(TransferNativeError.invalid("Loopback listener not ready"))); return }
        do {
            let connection = NWConnection(host: .ipv4(.loopback), port: port, using: try identity.parameters(queue: queue)); client = connection
            connection.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                if case .ready = state {
                    do {
                        guard try TransferIdentity.peerFingerprint(connection) == self.serverIdentity?.fingerprint else { throw TransferNativeError.invalid("Server certificate fingerprint mismatch") }
                        connection.send(content: self.payload, completion: .contentProcessed { [weak self] error in
                            if let error = error { self?.finish(.failure(error)) } else { self?.receiveReceipt(connection) }
                        })
                    } catch { self.finish(.failure(error)) }
                }
                if case .failed(let error) = state { self.finish(.failure(error)) }
            }
            connection.start(queue: queue)
        } catch { finish(.failure(error)) }
    }
    private func receivePayload(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: min(65536, payload.count - received)) { [weak self] data, _, _, error in
            guard let self = self else { return }
            if let error = error { self.finish(.failure(error)); return }
            guard let data = data, !data.isEmpty else { self.finish(.failure(TransferNativeError.invalid("TLS payload was truncated"))); return }
            self.digest.update(data: data); self.received += data.count
            if self.received == self.payload.count {
                let hash = self.digest.finalize().map { String(format: "%02x", $0) }.joined()
                connection.send(content: Data(hash.utf8), completion: .contentProcessed { [weak self] error in if let error = error { self?.finish(.failure(error)) } })
            } else { self.receivePayload(connection) }
        }
    }
    private func receiveReceipt(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 - response.count) { [weak self] data, _, _, error in
            guard let self = self else { return }
            if let error = error { self.finish(.failure(error)); return }
            guard let data = data, !data.isEmpty else { self.finish(.failure(TransferNativeError.invalid("TLS receipt was truncated"))); return }
            self.response.append(data)
            if self.response.count < 64 { self.receiveReceipt(connection); return }
            let expected = SHA256.hash(data: self.payload).map { String(format: "%02x", $0) }.joined()
            guard String(data: self.response, encoding: .utf8) == expected else { self.finish(.failure(TransferNativeError.invalid("TLS streamed payload hash mismatch"))); return }
            self.finish(.success("Persisted distinct RSA identities, self-signature/expiry rejection, mutual TLS 1.2+, certificate fingerprints and 1MiB+37 streamed bytes verified"))
        }
    }
    private func finish(_ result: Result<String, Error>) {
        guard let completion = completion else { return }; self.completion = nil
        listener?.stateUpdateHandler = nil; listener?.newConnectionHandler = nil; listener?.cancel(); listener = nil
        client?.stateUpdateHandler = nil; client?.cancel(); client = nil
        server?.stateUpdateHandler = nil; server?.cancel(); server = nil
        completion(result)
    }
}
#endif

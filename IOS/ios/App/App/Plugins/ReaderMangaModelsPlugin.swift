import Capacitor
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import OnnxRuntimeBindings

@objc(ReaderMangaModelsPlugin)
final class ReaderMangaModelsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ReaderMangaModelsPlugin"
    let jsName = "ReaderMangaModels"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "infer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
    ]
    private struct Spec {
        let file: String
        let minimum: Int
        let sha256: String
        let width: Int
        let height: Int
    }
    private static let specs = [
        "det": Spec(file: "ppocr_det.onnx", minimum: 9_000_000, sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e", width: 960, height: 960),
        "rec": Spec(file: "ppocr_rec.onnx", minimum: 19_000_000, sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634", width: 320, height: 48),
        "bubble": Spec(file: "mt_yolo_bubble.onnx", minimum: 4_000_000, sha256: "a01ad9477fac2b8815c2308c827c0a60a898f457a6692717201123911ba819c0", width: 1472, height: 1472),
    ]
    private static let limit = 128 * 1024 * 1024
    private let work = DispatchQueue(label: "reader.manga-models", qos: .userInitiated)
    private var environment: ORTEnv?
    private var sessions: [String: ORTSession] = [:]
    private var verified: [String: (stamp: String, size: Int)] = [:]
    private struct Output {
        let shape: [Int]
        let data: Data
    }
    // Outputs are kept outside WKWebView and read in bounded chunks.
    private var output: (id: String, tensors: [Output])?

    private static func failure(_ text: String) -> NSError {
        NSError(domain: "ReaderMangaModels", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }

    private func perform(_ call: CAPPluginCall, _ operation: @escaping () throws -> [String: Any]) {
        work.async {
            autoreleasepool {
                do { call.resolve(try operation()) }
                catch { call.reject(error.localizedDescription) }
            }
        }
    }

    private func model(_ call: CAPPluginCall) throws -> (String, Spec) {
        guard let key = call.getString("model"), let spec = Self.specs[key] else { throw Self.failure("翻译模型无效") }
        return (key, spec)
    }

    private func location(_ spec: Spec, partial: Bool = false) throws -> URL {
        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
        let folder = docs.appendingPathComponent("manga_translate_models", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var backupExcluded = folder
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        guard folder.resolvingSymlinksInPath().path == folder.path else { throw Self.failure("翻译模型目录无效") }
        try? backupExcluded.setResourceValues(values)
        let file = folder.appendingPathComponent(spec.file + (partial ? ".part" : ""))
        guard file.resolvingSymlinksInPath().path == file.path else { throw Self.failure("翻译模型路径无效") }
        return file
    }

    private func verify(_ file: URL, _ spec: Spec) throws -> Int {
        let stat = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey, .creationDateKey])
        guard stat.isRegularFile == true, stat.isSymbolicLink != true, let size = stat.fileSize, size >= spec.minimum, size <= Self.limit else {
            throw Self.failure("模型下载不完整或文件过大")
        }
        let stamp = "\(size):\(stat.contentModificationDate?.timeIntervalSince1970 ?? 0):\(stat.creationDate?.timeIntervalSince1970 ?? 0)"
        if let prior = verified[file.path], prior.stamp == stamp { return prior.size }
        let stream = try FileHandle(forReadingFrom: file); defer { try? stream.close() }
        var digest = SHA256(), read = 0
        while let chunk = try stream.read(upToCount: 512 * 1024), !chunk.isEmpty {
            read += chunk.count
            guard read <= size else { throw Self.failure("翻译模型在校验时发生变化") }
            digest.update(data: chunk)
        }
        guard read == size, digest.finalize().map({ String(format: "%02x", Int($0)) }).joined() == spec.sha256 else {
            throw Self.failure("模型校验失败，请重试")
        }
        // Only installed files are memoized; a failed or interrupted .part can be replaced.
        if file.pathExtension == "onnx" { verified[file.path] = (stamp, size) }
        return size
    }

    @objc func status(_ call: CAPPluginCall) {
        perform(call) {
            var files: [String: Int] = [:]
            for (key, spec) in Self.specs {
                files[key] = (try? self.verify(self.location(spec), spec)) ?? 0
            }
            return ["files": files]
        }
    }

    @objc func commit(_ call: CAPPluginCall) {
        perform(call) {
            let (key, spec) = try self.model(call)
            let source = try self.location(spec, partial: true), target = try self.location(spec)
            let count = try self.verify(source, spec)
            self.sessions[key] = nil; self.verified[target.path] = nil
            if FileManager.default.fileExists(atPath: target.path) {
                _ = try FileManager.default.replaceItemAt(target, withItemAt: source)
            } else {
                try FileManager.default.moveItem(at: source, to: target)
            }
            return ["size": count]
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        perform(call) {
            guard self.output == nil else { throw Self.failure("翻译正在进行，请稍后重试") }
            self.sessions.removeAll(); self.verified.removeAll()
            for spec in Self.specs.values {
                for partial in [false, true] {
                    let file = try self.location(spec, partial: partial)
                    if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
                }
            }
            return [:]
        }
    }

    private func session(_ key: String, _ spec: Spec) throws -> ORTSession {
        let file = try location(spec)
        _ = try verify(file, spec)
        if let session = sessions[key] { return session }
        let env = try environment ?? ORTEnv(loggingLevel: .warning)
        environment = env
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(2)
        try options.setGraphOptimizationLevel(.basic)
        let session = try ORTSession(env: env, modelPath: file.path, sessionOptions: options)
        sessions[key] = session
        return session
    }

    private static func tensor(_ encoded: String, _ key: String, _ spec: Spec, _ validWidth: Int) throws -> ORTValue {
        guard encoded.count <= 16 * 1024 * 1024, let png = Data(base64Encoded: encoded),
              let source = CGImageSourceCreateWithData(png as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              props[kCGImagePropertyPixelWidth] as? Int == spec.width, props[kCGImagePropertyPixelHeight] as? Int == spec.height,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw failure("翻译输入图像无效") }
        let plane = spec.width * spec.height
        var pixels = [UInt8](repeating: 0, count: plane * 4)
        let floats = NSMutableData(length: 3 * plane * MemoryLayout<Float>.stride)!
        let values = floats.mutableBytes.bindMemory(to: Float.self, capacity: 3 * plane)
        let mean: [Float] = [0.485, 0.456, 0.406], deviation: [Float] = [0.229, 0.224, 0.225]
        try pixels.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: spec.width, height: spec.height, bitsPerComponent: 8,
                                      bytesPerRow: spec.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { throw failure("无法读取翻译输入图像") }
            ctx.setBlendMode(.copy)
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: spec.width, height: spec.height))
            for i in 0..<plane {
                if key == "rec" && i % spec.width >= validWidth { continue }
                for channel in 0..<3 {
                    let component = Float(raw[i * 4 + channel]) / 255
                    values[i + channel * plane] = key == "det" ? (component - mean[channel]) / deviation[channel] :
                        key == "rec" ? (component - 0.5) / 0.5 : component
                }
            }
        }
        return try ORTValue(tensorData: floats, elementType: .float, shape: [1, 3, NSNumber(value: spec.height), NSNumber(value: spec.width)])
    }

    @objc func infer(_ call: CAPPluginCall) {
        perform(call) {
            // A caller must release results before starting another inference.
            guard self.output == nil else { throw Self.failure("上一批翻译推理结果尚未释放") }
            let (key, spec) = try self.model(call)
            let validWidth = call.getInt("validWidth") ?? spec.width
            guard let image = call.getString("image"), (1...spec.width).contains(validWidth) else { throw Self.failure("翻译输入无效") }
            let session = try self.session(key, spec)
            guard let inputName = try session.inputNames().first else { throw Self.failure("翻译模型缺少输入") }
            let names = try session.outputNames()
            let input = try Self.tensor(image, key, spec, validWidth)
            let result = try session.run(withInputs: [inputName: input], outputNames: Set(names), runOptions: nil)
            let id = UUID().uuidString
            if key == "rec" {
                guard let name = names.first, let tensor = result[name] else { throw Self.failure("文字识别结果无效") }
                let info = try tensor.tensorTypeAndShapeInfo(), data = try tensor.tensorData()
                let shape = info.shape.map(\.intValue)
                guard info.elementType == .float, shape.count == 3, shape[0] == 1, (1...512).contains(shape[1]),
                      shape[2] == 18710, data.length == shape[1] * shape[2] * 4 else { throw Self.failure("文字识别结果形状无效") }
                let scores = data.bytes.bindMemory(to: Float.self, capacity: data.length / 4)
                var tokens: [Int] = [], confidence: [Float] = []
                for row in 0..<shape[1] {
                    let start = row * shape[2]
                    var best = 0
                    for i in 1..<shape[2] where scores[start + i] > scores[start + best] { best = i }
                    tokens.append(best); confidence.append(scores[start + best].isFinite ? scores[start + best] : 0)
                }
                return ["tokens": tokens, "confidence": confidence]
            }
            let outputs = try names.map { name -> Output in
                guard let value = result[name] else { throw Self.failure("翻译模型缺少输出") }
                let info = try value.tensorTypeAndShapeInfo(), data = try value.tensorData()
                guard info.elementType == .float, data.length <= 32 * 1024 * 1024 else { throw Self.failure("翻译模型输出无效") }
                return Output(shape: info.shape.map(\.intValue), data: Data(referencing: data))
            }
            self.output = (id, outputs)
            return ["id": id, "tensors": outputs.map { ["shape": $0.shape, "size": $0.data.count] }]
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        perform(call) {
            guard let output = self.output, output.id == call.getString("id"),
                  let index = call.getInt("index"), output.tensors.indices.contains(index),
                  let offset = call.getInt("offset"), let length = call.getInt("length"),
                  offset >= 0, length > 0, length <= 512 * 1024, offset <= output.tensors[index].data.count - length else {
                throw Self.failure("翻译结果读取范围无效")
            }
            return ["data": output.tensors[index].data.subdata(in: offset..<(offset + length)).base64EncodedString()]
        }
    }

    @objc func release(_ call: CAPPluginCall) {
        perform(call) {
            if self.output?.id == call.getString("id") { self.output = nil }
            if call.getBool("sessions") == true { self.sessions.removeAll() }
            return [:]
        }
    }
}

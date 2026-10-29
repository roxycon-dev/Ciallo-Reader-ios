import UIKit
import UniformTypeIdentifiers
import Capacitor
import PDFKit
import CryptoKit

// File-provider URLs never cross the JavaScript bridge. Copy once in bounded
// chunks while hashing; the archive inspector consumes this immutable copy.
private enum TransferDocumentIO {
    static func failure(_ text: String) -> NSError { NSError(domain: "ReaderTransferFile", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    static func copy(_ source: URL, root: URL, maximum: Int64 = 4 * 1024 * 1024 * 1024, cancelled: () -> Bool) throws -> [String: Any] {
        guard source.isFileURL else { throw failure("请选择本地或文件提供商中的迁移包") }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?, outcome: Result<[String: Any], Error>?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: source, options: [], error: &coordinationError) { coordinated in
            outcome = Result {
                let values = try coordinated.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard values.isRegularFile == true, values.isSymbolicLink != true,
                      let expected = values.fileSize, expected > 0, Int64(expected) <= maximum else { throw failure("迁移文件为空、过大或不是普通文件") }
                if cancelled() { throw failure("已取消选择迁移文件") }
                let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
                let directory = canonical.appendingPathComponent("transfer", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                guard directory.standardizedFileURL.resolvingSymlinksInPath().path == directory.path else { throw failure("迁移缓存目录无效") }
                let free = try directory.resourceValues(forKeys: [.volumeAvailableCapacityKey]).volumeAvailableCapacity ?? 0
                guard free >= expected else { throw failure("空间不足，无法暂存迁移包") }
                let id = UUID().uuidString.lowercased(), relative = "transfer/\(id).incoming"
                let destination = canonical.appendingPathComponent(relative), partial = destination.appendingPathExtension("part")
                var published = false
                defer { if !published { try? FileManager.default.removeItem(at: partial); try? FileManager.default.removeItem(at: destination) } }
                guard FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw failure("无法创建迁移缓存") }
                let input = try FileHandle(forReadingFrom: coordinated); defer { try? input.close() }
                let output = try FileHandle(forWritingTo: partial); defer { try? output.close() }
                var count: Int64 = 0, hash = SHA256()
                while true {
                    if cancelled() { throw failure("已取消选择迁移文件") }
                    let ended = try autoreleasepool { () throws -> Bool in
                        let chunk = try input.read(upToCount: 64 * 1024) ?? Data()
                        if chunk.isEmpty { return true }
                        count += Int64(chunk.count)
                        guard count <= maximum, count <= Int64(expected) else { throw failure("迁移文件在读取时发生变化或超出限制") }
                        try output.write(contentsOf: chunk); hash.update(data: chunk); return false
                    }
                    if ended { break }
                }
                guard count == Int64(expected), !cancelled() else { throw failure("迁移文件未完整读取或已取消") }
                try output.synchronize(); try output.close()
                try FileManager.default.moveItem(at: partial, to: destination)
                published = true
                return ["sessionId": id, "path": relative, "name": String(source.lastPathComponent.prefix(255)), "size": count,
                        "sha256": hash.finalize().map { String(format: "%02x", $0) }.joined()]
            }
        }
        if let error = coordinationError { throw error }
        guard let result = outcome else { throw failure("文件提供商没有返回迁移文件") }
        return try result.get()
    }
}

@objc(ReaderDocumentsPlugin)
public class ReaderDocumentsPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ReaderDocumentsPlugin"
    public let jsName = "ReaderDocuments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transferFileSelfTest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeAtomic", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var exportDirectory: URL?
    private var transferPicker = false
    private var transferActivity: UIActivityViewController?
    private var transferShareCall: CAPPluginCall?
    private let transferLock = NSLock()
    private var transferGeneration = 0
    private func generation() -> Int { transferLock.lock(); defer { transferLock.unlock() }; return transferGeneration }
    private func cancelGeneration() { transferLock.lock(); transferGeneration += 1; transferLock.unlock() }

    @objc func pickTransfer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil, self.transferShareCall == nil else { call.reject("文件操作正在使用中"); return }
            self.pending = call; self.transferPicker = true
            // Some providers register .ciallo as generic data instead of ZIP.
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.zip, .data], asCopy: false)
            picker.allowsMultipleSelection = false; self.present(picker, call: call)
        }
    }

    @objc func cancelTransfer(_ call: CAPPluginCall) {
        self.cancelGeneration()
        DispatchQueue.main.async {
            if self.transferPicker {
                (self.bridge?.viewController?.presentedViewController as? UIDocumentPickerViewController)?.dismiss(animated: true)
                self.finish(transferFile: NSNull())
            }
            self.transferActivity?.dismiss(animated: true); self.transferActivity = nil
            let share = self.transferShareCall; self.transferShareCall = nil; share?.resolve(["completed": false])
            call.resolve()
        }
    }

    @objc func shareTransfer(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), path.range(of: "^transfer/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.outgoing$", options: .regularExpression) != nil,
              let name = call.getString("name"), !name.isEmpty, name.utf8.count <= 255, !name.contains("/"), !name.contains("\\"), !name.contains("\0"), name.hasSuffix(".ciallo") else { call.reject("无效的迁移包分享参数"); return }
        DispatchQueue.main.async {
            guard self.pending == nil, self.transferShareCall == nil else { call.reject("文件操作正在使用中"); return }
            self.transferShareCall = call
            let generation = self.generation()
            DispatchQueue.global(qos: .utility).async {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reader-transfer-share-" + UUID().uuidString, isDirectory: true)
                do {
                    let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
                    let source = root.appendingPathComponent(path)
                    guard source.standardizedFileURL.resolvingSymlinksInPath().path == source.path,
                          try source.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { throw TransferDocumentIO.failure("迁移缓存不存在或路径无效") }
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let copy = directory.appendingPathComponent(name)
                    try FileManager.default.copyItem(at: source, to: copy)
                    DispatchQueue.main.async {
                        guard self.transferShareCall === call, self.generation() == generation,
                              let host = self.bridge?.viewController, host.presentedViewController == nil else {
                            try? FileManager.default.removeItem(at: directory)
                            if self.transferShareCall === call { self.transferShareCall = nil; call.reject("当前无法打开系统分享") }; return
                        }
                        let activity = UIActivityViewController(activityItems: [copy], applicationActivities: nil)
                        self.transferActivity = activity
                        if let popover = activity.popoverPresentationController { popover.sourceView = host.view; popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1) }
                        activity.completionWithItemsHandler = { _, completed, _, error in
                            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 86400) { try? FileManager.default.removeItem(at: directory) }
                            guard self.transferShareCall === call else { return }
                            self.transferShareCall = nil; self.transferActivity = nil
                            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["completed": completed]) }
                        }
                        host.present(activity, animated: true)
                    }
                } catch {
                    try? FileManager.default.removeItem(at: directory)
                    DispatchQueue.main.async { if self.transferShareCall === call { self.transferShareCall = nil; call.reject(error.localizedDescription) } }
                }
            }
        }
    }

    @objc func transferFileSelfTest(_ call: CAPPluginCall) {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.environment["CIALLO_NATIVE_TESTS"] == "1" else { call.reject("Native tests disabled"); return }
        DispatchQueue.global(qos: .utility).async {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("transfer-copy-test-" + UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            do {
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                let source = root.appendingPathComponent("sample.zip"), data = Data((0..<(1024 * 1024 + 37)).map { UInt8($0 % 251) })
                try data.write(to: source)
                let documents = root.appendingPathComponent("Documents"); try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
                let copied = try TransferDocumentIO.copy(source, root: documents, cancelled: { false })
                guard copied["sha256"] as? String == SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined(), copied["size"] as? Int64 == Int64(data.count) else { throw TransferDocumentIO.failure("Copied archive bytes differ") }
                for mode in 0..<2 {
                    var rejected = false
                    do { _ = try TransferDocumentIO.copy(source, root: documents, maximum: mode == 0 ? 100 : 4 * 1024 * 1024 * 1024, cancelled: { mode == 1 }) } catch { rejected = true }
                    guard rejected else { throw TransferDocumentIO.failure("Invalid or cancelled archive accepted") }
                }
                let linked = root.appendingPathComponent("linked.zip"); try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: source)
                var sourceRejected = false; do { _ = try TransferDocumentIO.copy(linked, root: documents, cancelled: { false }) } catch { sourceRejected = true }
                guard sourceRejected else { throw TransferDocumentIO.failure("Symlink source accepted") }
                let redirected = root.appendingPathComponent("Redirected"), privateDirectory = root.appendingPathComponent("Private")
                try FileManager.default.createDirectory(at: redirected, withIntermediateDirectories: true); try FileManager.default.createDirectory(at: privateDirectory, withIntermediateDirectories: true)
                try FileManager.default.createSymbolicLink(at: redirected.appendingPathComponent("transfer"), withDestinationURL: privateDirectory)
                var rejected = false; do { _ = try TransferDocumentIO.copy(source, root: redirected, cancelled: { false }) } catch { rejected = true }
                guard rejected, try FileManager.default.contentsOfDirectory(atPath: privateDirectory.path).isEmpty else { throw TransferDocumentIO.failure("Symlink cache redirected transfer") }
                let names = try FileManager.default.contentsOfDirectory(atPath: documents.appendingPathComponent("transfer").path)
                guard names.count == 1, !names.contains(where: { $0.hasSuffix(".part") }) else { throw TransferDocumentIO.failure("Cancelled archive leaked temporary files") }
                call.resolve(["detail": "streamed copy, digest, cancellation, limits and symlink rejection verified"])
            } catch { call.reject(error.localizedDescription) }
        }
        #else
        call.reject("Native tests disabled")
        #endif
    }

    @objc func writeAtomic(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }),
              let encoded = call.getString("data"), encoded.utf8.count <= 22369624,
              let data = Data(base64Encoded: encoded), data.count <= 16 * 1024 * 1024 else { call.reject("原子文件写入参数无效"); return }
        DispatchQueue.global(qos: .utility).async {
            do {
                let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
                let target = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
                guard target.path.hasPrefix(root.path + "/") else { throw NSError(domain: "ReaderFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: "文件路径越界"]) }
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                let handle = try FileHandle(forWritingTo: target); defer { try? handle.close() }; try handle.synchronize(); call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func shareFile(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        let names = call.getArray("fileNames", String.self) ?? []
        guard !paths.isEmpty, paths.count <= 100, paths.count == names.count else { call.reject("请选择 1 至 100 本图书"); return }
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].standardizedFileURL.resolvingSymlinksInPath()
        var urls: [URL] = []
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reader-share-" + UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            for (index, path) in paths.enumerated() {
                let name = names[index]
                guard !path.hasPrefix("/"), !path.split(separator: "/").contains(".."), !path.contains("\\"),
                      !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\") else {
                    throw NSError(domain: "ReaderShare", code: 1, userInfo: [NSLocalizedDescriptionKey: "无效的分享文件路径"])
                }
                let source = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
                guard source.path.hasPrefix(root.path + "/"), FileManager.default.isReadableFile(atPath: source.path) else {
                    throw NSError(domain: "ReaderShare", code: 2, userInfo: [NSLocalizedDescriptionKey: "分享文件不存在"])
                }
                let child = directory.appendingPathComponent(String(index), isDirectory: true)
                try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
                let copy = child.appendingPathComponent(name)
                // APFS uses a copy-on-write clone where available; recipient sees the book's title.
                try FileManager.default.copyItem(at: source, to: copy)
                urls.append(copy)
            }
        } catch { try? FileManager.default.removeItem(at: directory); call.reject(error.localizedDescription); return }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, host.presentedViewController == nil else {
                try? FileManager.default.removeItem(at: directory)
                call.reject("请先关闭当前弹窗"); return
            }
            let activity = UIActivityViewController(activityItems: urls, applicationActivities: nil)
            activity.setValue(call.getString("title") ?? "分享图书", forKey: "subject")
            if let popover = activity.popoverPresentationController {
                popover.sourceView = host.view
                popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
            }
            activity.completionWithItemsHandler = { _, completed, _, error in
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 86400) { try? FileManager.default.removeItem(at: directory) }
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve(["presented": true, "completed": completed]) }
            }
            host.present(activity, animated: true)
        }
    }

    @objc func renderPdf(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.hasPrefix("/"),
              !path.split(separator: "/").contains("..") else { call.reject("无效的 PDF 路径"); return }
        DispatchQueue.global(qos: .userInitiated).async {
            let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let url = root.appendingPathComponent(path).standardizedFileURL
            guard url.path.hasPrefix(root.path + "/"), let document = PDFDocument(url: url) else { call.reject("无法打开 PDF"); return }
            guard !document.isLocked || document.unlock(withPassword: "") else { call.reject("PDF 已加密，请先解除密码保护"); return }
            guard document.pageCount > 0, document.pageCount <= 10000 else { call.reject("PDF 页数不在支持范围内"); return }
            let directory = url.deletingLastPathComponent().appendingPathComponent("pdf-pages", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                var pages: [String] = []
                for index in 0..<document.pageCount {
                    try autoreleasepool {
                        guard let page = document.page(at: index) else { throw NSError(domain: "ReaderPDF", code: 1, userInfo: [NSLocalizedDescriptionKey: "PDF 页面损坏"]) }
                        let bounds = page.bounds(for: .mediaBox)
                        guard bounds.width > 0, bounds.height > 0 else { throw NSError(domain: "ReaderPDF", code: 2, userInfo: [NSLocalizedDescriptionKey: "PDF 页面尺寸无效"]) }
                        let scale = min(2, 2240 / max(bounds.width, bounds.height))
                        let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
                        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
                        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
                            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                            context.cgContext.translateBy(x: 0, y: size.height)
                            context.cgContext.scaleBy(x: scale, y: -scale)
                            context.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
                            page.draw(with: .mediaBox, to: context.cgContext)
                        }
                        guard let data = image.jpegData(compressionQuality: 0.9) else { throw NSError(domain: "ReaderPDF", code: 3) }
                        let output = directory.appendingPathComponent(String(format: "page_%05d.jpg", index + 1))
                        try data.write(to: output, options: .atomic)
                        pages.append(String(output.path.dropFirst(root.path.count + 1)))
                    }
                }
                let attributes = document.documentAttributes ?? [:]
                call.resolve(["pages": pages, "title": attributes[PDFDocumentAttribute.titleAttribute] as? String ?? "",
                    "author": attributes[PDFDocumentAttribute.authorAttribute] as? String ?? ""])
            } catch { try? FileManager.default.removeItem(at: directory); call.reject(error.localizedDescription) }
        }
    }

    private func present(_ picker: UIDocumentPickerViewController, call: CAPPluginCall) {
        guard let host = bridge?.viewController, host.presentedViewController == nil else {
            finish(error: "当前无法打开文件选择器")
            return
        }
        picker.delegate = self
        host.present(picker, animated: true)
    }

    @objc func pickFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("文件选择器正在使用中"); return }
            self.pending = call
            let accept = call.getString("accept") ?? "*/*"
            var types = accept.split(separator: ",").compactMap { part -> UTType? in
                let value = part.trimmingCharacters(in: .whitespacesAndNewlines)
                if value == "*/*" { return .item }
                if value.hasPrefix(".") { return UTType(filenameExtension: String(value.dropFirst())) }
                if value == "image/*" { return .image }
                if value == "text/*" { return .text }
                return UTType(mimeType: value)
            }
            if types.isEmpty { types = [.item] }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = call.getBool("multiple") ?? false
            self.present(picker, call: call)
        }
    }

    @objc func saveFile(_ call: CAPPluginCall) {
        guard let name = call.getString("fileName"), !name.isEmpty,
              name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
              let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("无效的导出文件")
            return
        }
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("文件选择器正在使用中"); return }
            self.pending = call
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                self.exportDirectory = directory
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(name)
                try data.write(to: url, options: .atomic)
                let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                self.present(picker, call: call)
            } catch { self.finish(error: error.localizedDescription) }
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if exportDirectory != nil { finish(); return }
        if transferPicker {
            guard let source = urls.first, urls.count == 1, let call = pending else { finish(error: "请选择一个迁移文件"); return }
            let generation = self.generation()
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    let file = try TransferDocumentIO.copy(source, root: root, cancelled: { self.generation() != generation })
                    DispatchQueue.main.async {
                        guard self.pending === call, self.generation() == generation else {
                            if let path = file["path"] as? String { try? FileManager.default.removeItem(at: root.appendingPathComponent(path)) }; return
                        }
                        self.finish(transferFile: file)
                    }
                } catch { DispatchQueue.main.async { if self.pending === call { self.finish(error: error.localizedDescription) } } }
            }
            return
        }
        // File-provider reads may download from iCloud. Keep them off the UI thread.
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let files: [[String: String]] = try urls.map { url in
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    return ["name": url.lastPathComponent, "mime": mime, "data": data.base64EncodedString()]
                }
                DispatchQueue.main.async { self.finish(files: files) }
            } catch {
                DispatchQueue.main.async { self.finish(error: error.localizedDescription) }
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if transferPicker { finish(transferFile: NSNull()) }
        else if exportDirectory != nil { finish(error: "已取消保存文件") }
        else { finish(files: []) }
    }

    private func finish(files: [[String: String]]? = nil, error: String? = nil, transferFile: Any? = nil) {
        let call = pending
        pending = nil
        transferPicker = false
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil
        if let error = error { call?.reject(error) }
        else if let file = transferFile { call?.resolve(["file": file]) }
        else if let files = files { call?.resolve(["files": files]) }
        else { call?.resolve() }
    }
}

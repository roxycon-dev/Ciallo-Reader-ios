import UIKit
import UniformTypeIdentifiers
import Capacitor
import PDFKit

@objc(ReaderDocumentsPlugin)
public class ReaderDocumentsPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ReaderDocumentsPlugin"
    public let jsName = "ReaderDocuments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeAtomic", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var exportDirectory: URL?

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
        if exportDirectory != nil { finish(error: "已取消保存文件") }
        else { finish(files: []) }
    }

    private func finish(files: [[String: String]]? = nil, error: String? = nil) {
        let call = pending
        pending = nil
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil
        if let error = error { call?.reject(error) }
        else if let files = files { call?.resolve(["files": files]) }
        else { call?.resolve() }
    }
}

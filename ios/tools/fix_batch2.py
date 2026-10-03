import io, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CialloReader')

def patch(rel, pairs, must=True):
    p = os.path.join(BASE, rel)
    s = io.open(p, encoding='utf-8').read()
    ok = True
    for old, new in pairs:
        if old not in s:
            print(f"[MISS] {rel}: {old[:70]!r}")
            ok = False
            continue
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print(("OK  " if ok else "PART") + " " + rel)

# ---- EpubParser: 0.9.19 API（Entry 顶层类型；entries→Sequence；extract→to 文件）----
patch('Data/Parsers/EpubParser.swift', [
    ("    static func readEntry(_ archive: Archive, _ entry: Archive.Entry) throws -> Data {\n        let data = try archive.extract(entry)\n        var budget = ArchiveBudget()\n        try budget.copy(data.count)\n        return data\n    }",
     "    static func readEntry(_ archive: Archive, _ entry: Entry) throws -> Data {\n        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)\n        try archive.extract(entry, to: tmp)\n        defer { try? FileManager.default.removeItem(at: tmp) }\n        let data = try Data(contentsOf: tmp)\n        var budget = ArchiveBudget()\n        try budget.copy(data.count)\n        return data\n    }"),
    ("    static func readEntry(_ archive: Archive, _ entry: Archive.Entry) throws -> Data",
     "    static func readEntry(_ archive: Archive, _ entry: Entry) throws -> Data"),
    ("    private static func entryPath(of path: String, in all: [String]) -> String? {",
     "    private static func entryPath(of path: String, in all: [String]) -> String? {"),
    ("    private static func findCover(archive: Archive, entryPaths: [String], manifest: [String: (href: String, props: String, mediaType: String)], opfHtml: Document) -> Archive.Entry? {",
     "    private static func findCover(archive: Archive, entryPaths: [String], manifest: [String: (href: String, props: String, mediaType: String)], opfHtml: Document) -> Entry? {"),
    ("    static func extractCover(_ archive: Archive, entry: Archive.Entry) throws -> String {",
     "    static func extractCover(_ archive: Archive, entry: Entry) throws -> String {"),
    ("        guard let entry = archive.entries.first(where: { $0.path.lowercased() == imagePath.lowercased() }) else { return }",
     "        guard let entry = archive.first(where: { $0.path.lowercased() == imagePath.lowercased() }) else { return }"),
    ("        guard let head = try? archive.extract(entry),\n              let (w, h) = CharsetSniffer.imageSize(of: head) else { return }",
     "        let head = (try? readEntry(archive, entry)) ?? Data()\n        guard let (w, h) = CharsetSniffer.imageSize(of: head) else { return }"),
    ("        if let e = archive.entries.first(where: { $0.path.lowercased().contains(\"cover\") && isImageEntry($0.path) }) {\n            return e\n        }\n        // 首 spine 首图 / 体积最大图\n        if let e = archive.entries.first(where: { isImageEntry($0.path) }) {\n            return e\n        }",
     "        if let e = archive.first(where: { $0.path.lowercased().contains(\"cover\") && isImageEntry($0.path) }) {\n            return e\n        }\n        // 首 spine 首图 / 体积最大图\n        if let e = archive.first(where: { isImageEntry($0.path) }) {\n            return e\n        }"),
    ("        func entry(forHref href: String, in opfDir: String = \"\") -> Archive.Entry? {",
     "        func entry(forHref href: String, in opfDir: String = \"\") -> Entry? {"),
    ("        return entryPath(of: p, in: entryPaths).flatMap { path in archive.entries.first { $0.path == path } }",
     "        return entryPath(of: p, in: entryPaths).flatMap { path in archive.first { $0.path == path } }"),
    # L28 type-check timeout：拆分 guard
    ("        guard let containerEntry = entryPath(of: \"META-INF/container.xml\", in: entryPaths),\n              let opfPath = opfPath(archive: archive, entry: containerEntry) else {\n            throw ImportError(\"EPUB 缺少 container.xml\")\n        }",
     "        guard let containerEntry = entryPath(of: \"META-INF/container.xml\", in: entryPaths) else {\n            throw ImportError(\"EPUB 缺少 container.xml\")\n        }\n        guard let opfPath = opfPath(archive: archive, entry: containerEntry) else {\n            throw ImportError(\"EPUB 缺少 container.xml\")\n        }"),
])

# ---- ComicParser：extract 内存版 → to 文件 ----
patch('Data/Parsers/ComicParser.swift', [
    ("            let data = try archive.extract(entry)\n            try budget.copy(data.count)",
     "            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)\n            try archive.extract(entry, to: tmp)\n            let data = try Data(contentsOf: tmp)\n            try? FileManager.default.removeItem(at: tmp)\n            try budget.copy(data.count)"),
])

# ---- NovelInlineImages：entries → Sequence；extract → to 文件 ----
patch('Reader/NovelInlineImages.swift', [
    ("        if let ref = epubImageRef(uri) {\n            guard let archive = try? Archive(url: URL(fileURLWithPath: ref.bookPath), accessMode: .read),\n                  let entry = archive.entries.first(where: { $0.path == ref.entry || $0.path.lowercased() == ref.entry.lowercased() }) else {\n                return nil\n            }\n            return try? archive.extract(entry)\n        }",
     "        if let ref = epubImageRef(uri) {\n            guard let archive = try? Archive(url: URL(fileURLWithPath: ref.bookPath), accessMode: .read),\n                  let entry = archive.first(where: { $0.path == ref.entry || $0.path.lowercased() == ref.entry.lowercased() }) else {\n                return nil\n            }\n            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)\n            do {\n                try archive.extract(entry, to: tmp)\n                defer { try? FileManager.default.removeItem(at: tmp) }\n                return try? Data(contentsOf: tmp)\n            } catch {\n                return nil\n            }\n        }"),
])

# ---- BackupManager：provider 双参 + extract(entry) 内存版移除 + enumerate 非可选 ----
patch('Data/BackupManager.swift', [
    ("                                 bufferSize: 64 * 1024,\n                                 progress: nil) { position in\n                let start = Int(position)\n                return data.subdata(in: start..<min(start + 64 * 1024, data.count))\n            }",
     "                                 bufferSize: 64 * 1024,\n                                 progress: nil) { position, size in\n                let start = Int(position)\n                return data.subdata(in: start..<min(start + Int(size), data.count))\n            }"),
    ("                                              bufferSize: 128 * 1024,\n                                              progress: nil) { position in\n                        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return Data() }\n                        defer { try? handle.close() }\n                        try? handle.seek(toOffset: UInt64(position))\n                        return (try? handle.read(upToCount: 128 * 1024)) ?? Data()\n                    }",
     "                                              bufferSize: 128 * 1024,\n                                              progress: nil) { position, size in\n                        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return Data() }\n                        defer { try? handle.close() }\n                        try? handle.seek(toOffset: UInt64(position))\n                        return (try? handle.read(upToCount: Int(size))) ?? Data()\n                    }"),
    ("            let name = (entry.path as NSString).lastPathComponent.replacingOccurrences(of: \".ndjson\", with: \"\")\n            tableData[name] = String(decoding: try archive.extract(entry), as: UTF8.self)",
     "            let name = (entry.path as NSString).lastPathComponent.replacingOccurrences(of: \".ndjson\", with: \"\")\n            let tmp = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)\n            try archive.extract(entry, to: tmp)\n            defer { try? fm.removeItem(at: tmp) }\n            tableData[name] = String(decoding: try Data(contentsOf: tmp), as: UTF8.self)"),
    ("            for case let fileURL as URL in fm2.enumerator(at: src, includingPropertiesForKeys: nil) ?? [] {\n                let relative = fileURL.path.replacingOccurrences(of: src.path, with: \"\")\n                try? fm2.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)\n                try? fm2.removeItem(at: dest)\n                try? fm2.moveItem(at: fileURL, to: dest)\n            }",
     "            let enum2 = fm2.enumerator(at: src, includingPropertiesForKeys: nil)\n            for case let fileURL as URL in enum2 ?? [] {\n                let relative = fileURL.path.replacingOccurrences(of: src.path, with: \"\")\n                let dest = destDir.appendingPathComponent(relative)\n                try? fm2.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)\n                try? fm2.removeItem(at: dest)\n                try? fm2.moveItem(at: fileURL, to: dest)\n            }"),
])

# ---- BookRepository：Book() 与 parseTxt 哨兵混排 ----
patch('Data/BookRepository.swift', [
    ("        var book = Book()\n        book.title = parsed.title",
     "        var book = Book(title: \"\", filePath: \"\")\n        book.title = parsed.title"),
    ("        if matches.count >= 3 {\n            var lastTitle = \"开始\"\n            var bufferStart = 0\n            for m in matches + [NSRange(location: ns.length, length: 0)] {\n                let chunk = ns.substring(with: NSRange(location: bufferStart, length: max(0, m.location - bufferStart)))\n                    .trimmingCharacters(in: .whitespacesAndNewlines)\n                if !chunk.isEmpty {\n                    chapters.append(contentsOf: ChapterSplitter.split(chunk, title: lastTitle))\n                }\n                if m.location < ns.length {\n                    lastTitle = ns.substring(with: m.range).trimmingCharacters(in: .whitespacesAndNewlines)\n                    bufferStart = m.location + m.length\n                }\n            }\n        } else {",
     "        if matches.count >= 3 {\n            var lastTitle = \"开始\"\n            var bufferStart = 0\n            for m in matches {\n                let chunk = ns.substring(with: NSRange(location: bufferStart, length: max(0, m.location - bufferStart)))\n                    .trimmingCharacters(in: .whitespacesAndNewlines)\n                if !chunk.isEmpty {\n                    chapters.append(contentsOf: ChapterSplitter.split(chunk, title: lastTitle))\n                }\n                lastTitle = ns.substring(with: m.range).trimmingCharacters(in: .whitespacesAndNewlines)\n                bufferStart = m.location + m.length\n            }\n            let tail = ns.substring(from: bufferStart).trimmingCharacters(in: .whitespacesAndNewlines)\n            if !tail.isEmpty {\n                chapters.append(contentsOf: ChapterSplitter.split(tail, title: lastTitle))\n            }\n        } else {"),
])

# ---- CharsetSniffer：去掉 euc-kr（CFStringEncodings 案例名不可用）----
patch('Data/Parsers/CharsetSniffer.swift', [
    ("        case \"euc-kr\": return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.euc_KR.rawValue)))\n", ""),
])

# ---- CurlStrip：scaleEffect → scaleBy；补 drawStrip 助手 ----
patch('Design/CurlStrip.swift', [
    ("                        layer.scaleEffect(x: -1, y: 1)", "                        layer.scaleBy(x: -1, y: 1)"),
    ("                    CurlStripCanvas.drawStrip(&ctx, image: image, dest: dest, source: source)",
     "                    CurlStripCanvas.drawStrip(&ctx, image: image, dest: dest, source: source)"),
    ("struct CurlStripCanvas: View {",
     "struct CurlStripCanvas: View {\n    /// 源矩形 → 目标矩形的水平重映射绘制（source/dest 等高）\n    static func drawStrip(_ ctx: inout GraphicsContext, image: Image, dest: CGRect, source: CGRect) {\n        guard source.width > 0, dest.width > 0 else { return }\n        let k = dest.width / source.width\n        ctx.drawLayer { layer in\n            layer.translateBy(x: dest.minX - source.minX * k, y: 0)\n            layer.scaleBy(x: k, y: 1)\n            layer.draw(image, in: source)\n        }\n    }"),
    ("        let k = dest.width / source.width\n        ctx.drawLayer { layer in\n            layer.translateBy(x: dest.minX - source.minX * k, y: 0)\n            layer.scaleEffect(x: k, y: 1)\n            layer.draw(image, in: source)\n        }\n    }",
     "        let k = dest.width / source.width\n        ctx.drawLayer { layer in\n            layer.translateBy(x: dest.minX - source.minX * k, y: 0)\n            layer.scaleBy(x: k, y: 1)\n            layer.draw(image, in: source)\n        }\n    }"),
])

# ---- Comic/ComicSettings.swift：String(data:) 可选 + config(for:) 可接受 nil ----
patch('Comic/ComicSettings.swift', [
    ("            prefs.setString(String(data: data, encoding: .utf8), for: \"comic_config_global\")",
     "            prefs.setString(String(data: data, encoding: .utf8) ?? \"{}\", for: \"comic_config_global\")"),
    ("            prefs.setString(String(data: data, encoding: .utf8), for: \"comic_config_perbook\")",
     "            prefs.setString(String(data: data, encoding: .utf8) ?? \"{}\", for: \"comic_config_perbook\")"),
    ("    func config(for bookKey: String) -> ComicReaderConfig {", "    func config(for bookKey: String?) -> ComicReaderConfig {"),
])

# ---- Reader/ReaderScreen.swift：gestureLayout 需要的 drag/direction 声明补回一处 ----
patch('Reader/ReaderScreen.swift', [
    ("    @ViewBuilder let pageContent: (Int) -> Page\n\n    // 仿真卷页驱动（GL 纹理信箱的对应物：起手快照、拖拽喂 t、松手结算）",
     "    @ViewBuilder let pageContent: (Int) -> Page\n\n    @GestureState private var drag: CGFloat = 0\n    @State private var direction: Int = 0   // -1 下一页动画, +1 上一页\n    // 仿真卷页驱动（GL 纹理信箱的对应物：起手快照、拖拽喂 t、松手结算）"),
])

# ---- Home/HomeScreen.swift：importFile 调用恢复数组绑定 ----
patch('Home/HomeScreen.swift', [
    ("        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in\n            if case .success(let url) = result {\n                Task { await viewModel.importFile(url: url) }\n            }\n        }",
     "        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in\n            if case .success(let urls) = result, let url = urls.first {\n                Task { await viewModel.importFile(url: url) }\n            }\n        }"),
])

print("ALL PATCHES APPLIED")

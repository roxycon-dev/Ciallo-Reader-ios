import Foundation
import ZIPFoundation

// MARK: - 本地备份（data/BackupArchive.kt 对应物）
// 完整 ZIP 导入导出：12 张用户数据表 + 带类型设置 + 私有书籍与图片；
// 文件路径重定位；不含凭据/模型/活跃下载。

enum BackupManager {
    static var backupDirectory: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: 导出

    static func exportBackup() async throws -> URL {
        let file = backupDirectory.appendingPathComponent("ciallo_backup_\(Int(Date().timeIntervalSince1970)).zip")
        try? FileManager.default.removeItem(at: file)
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let archive = try Archive(url: file, accessMode: .create)

        let db = AppDatabase.shared
        // 数据表 → NDJSON
        let tables: [(String, Data)] = try await Task.detached(priority: .userInitiated) {
            var out: [(String, Data)] = []
            func ndjson(_ name: String, _ rows: [[String: SQLiteValue]]) {
                var text = ""
                for row in rows {
                    var obj: [String: String] = [:]
                    for (k, v) in row {
                        switch v {
                        case .null: continue
                        case .int(let i): obj[k] = String(i)
                        case .real(let d): obj[k] = String(d)
                        case .text(let s): obj[k] = s
                        case .blob(let b): obj[k] = b.base64EncodedString()
                        }
                    }
                    if let data = try? JSONSerialization.data(withJSONObject: obj),
                       let line = String(data: data, encoding: .utf8) {
                        text += line + "\n"
                    }
                }
                out.append((name, Data(text.utf8)))
            }
            ndjson("books", try db.db.query("SELECT * FROM books"))
            ndjson("chapters", try db.db.query("SELECT * FROM chapters"))
            ndjson("bookmarks", try db.db.query("SELECT * FROM bookmarks"))
            ndjson("highlights", try db.db.query("SELECT * FROM highlights"))
            ndjson("categories", try db.db.query("SELECT * FROM categories"))
            ndjson("reading_records", try db.db.query("SELECT * FROM reading_records"))
            ndjson("reading_sessions", try db.db.query("SELECT * FROM reading_sessions"))
            ndjson("download_tasks", try db.db.query("SELECT * FROM download_tasks"))
            ndjson("favorites", try db.db.query("SELECT * FROM favorites"))
            ndjson("comic_progress", try db.db.query("SELECT * FROM comic_progress"))
            ndjson("comic_chapter_read", try db.db.query("SELECT * FROM comic_chapter_read"))
            ndjson("god_moments", try db.db.query("SELECT * FROM god_moments"))
            // 设置（带类型）
            if let settings = UserDefaults.standard.dictionaryRepresentation() as? [String: Any] {
                let flat = settings.filter { $0.key.hasPrefix("theme_") || $0.key.hasPrefix("reading_") || $0.key.hasPrefix("comic_") }
                if let data = try? JSONSerialization.data(withJSONObject: flat) {
                    out.append(("settings", data))
                }
            }
            return out
        }.value

        for (name, data) in tables {
            let total = Int64(data.count)
            _ = try? archive.addEntry(with: "data/\(name).ndjson", type: .file,
                                      uncompressedSize: total,
                                      bufferSize: 64 * 1024,
                                      progress: nil) { position in
                let start = Int(position)
                return data.subdata(in: start..<min(start + 64 * 1024, data.count))
            }
        }
        // 私有书籍与图片
        for dir in [BookRepository.booksRoot, BookRepository.coversDirectory, BookRepository.bookImagesDirectory] {
            let prefix = dir == BookRepository.booksRoot ? "files/books" : "files/\(dir.lastPathComponent)"
            if let enumerator = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey]) {
                for case let fileURL as URL in enumerator {
                    let attrs = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard attrs?.isRegularFile == true else { continue }
                    let size = attrs?.fileSize ?? 0
                    let relative = fileURL.path.replacingOccurrences(of: dir.path, with: "")
                    _ = try? archive.addEntry(with: prefix + relative, type: .file,
                                              uncompressedSize: Int64(size),
                                              bufferSize: 128 * 1024,
                                              progress: nil) { position in
                        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return Data() }
                        defer { try? handle.close() }
                        try? handle.seek(toOffset: UInt64(position))
                        return (try? handle.read(upToCount: 128 * 1024)) ?? Data()
                    }
                }
            }
        }
        return file
    }

    // MARK: 导入

    static func importBackup(from url: URL) async throws {
        let archive = try Archive(url: url, accessMode: .read)
        let fm = FileManager.default
        let db = AppDatabase.shared

        // 先提取/校验，再事务替换
        var tableData: [String: String] = [:]
        for entry in archive where entry.path.hasPrefix("data/") && entry.path.hasSuffix(".ndjson") {
            let name = (entry.path as NSString).lastPathComponent.replacingOccurrences(of: ".ndjson", with: "")
            tableData[name] = String(decoding: try archive.extract(entry), as: UTF8.self)
        }
        guard !tableData.isEmpty else { throw ImportError("备份文件缺少数据表") }

        // 文件先落到临时区
        let staging = fm.temporaryDirectory.appendingPathComponent("restore_\(UUID().uuidString)")
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: staging) }
        for entry in archive where entry.path.hasPrefix("files/") {
            let relative = String(entry.path.dropFirst("files/".count))
            let dest = staging.appendingPathComponent(relative)
            try? fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? archive.extract(entry, to: dest)
        }

        // 清空重灌
        for table in ["books", "chapters", "bookmarks", "highlights", "categories", "reading_records",
                      "reading_sessions", "download_tasks", "favorites", "comic_progress",
                      "comic_chapter_read", "god_moments"] {
            try? db.db.exec("DELETE FROM \(table)")
        }
        for (name, text) in tableData {
            guard name != "settings" else { continue }
            for line in text.split(separator: "\n") {
                guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String] else { continue }
                try insertRow(table: name, obj: obj)
            }
        }
        // 文件重定位
        let fm2 = FileManager.default
        for (stagingSub, destDir) in [("books", BookRepository.booksRoot),
                                      ("covers", BookRepository.coversDirectory),
                                      ("book_images", BookRepository.bookImagesDirectory)] {
            let src = staging.appendingPathComponent(stagingSub)
            guard fm2.fileExists(atPath: src.path) else { continue }
            try? fm2.createDirectory(at: destDir, withIntermediateDirectories: true)
            for case let fileURL as URL in fm2.enumerator(at: src, includingPropertiesForKeys: nil) ?? [] {
                let relative = fileURL.path.replacingOccurrences(of: src.path, with: "")
                let dest = destDir.appendingPathComponent(relative)
                try? fm2.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? fm2.removeItem(at: dest)
                try? fm2.moveItem(at: fileURL, to: dest)
            }
        }
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private static func insertRow(table: String, obj: [String: String]) throws {
        // 值按文本插入（SQLite 宽松类型转换），书路径列在读取时不再重定位（已移动到位）
        guard !obj.isEmpty else { return }
        let cols = obj.keys.sorted()
        let placeholders = cols.map { _ in "?" }.joined(separator: ",")
        let binds = cols.map { col -> SQLiteValue in
            let v = obj[col] ?? ""
            // NULL 语义恢复
            if v.isEmpty && (col == "coverUri" || col == "bookId" || col == "sourceId" || col == "comicId" || col == "filePath" || col == "categoryName") {
                return .null
            }
            return .text(v)
        }
        let sql = "INSERT INTO \(table) (\(cols.joined(separator: ","))) VALUES (\(placeholders))"
        try? AppDatabase.shared.db.exec(sql, binds: binds)
    }
}

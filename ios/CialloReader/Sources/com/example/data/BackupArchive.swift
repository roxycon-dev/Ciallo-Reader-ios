import Foundation
import ZIPFoundation

// 对齐 novel-reader/app/src/main/java/com/example/data/BackupArchive.kt（204 行）
// Portable, streamed user data backup. Auth stores, models and active downloads are excluded.

enum BackupArchive {
    static let tables = ["books", "chapters", "bookmarks", "highlights", "categories",
                         "reading_records", "reading_sessions", "favorites", "comic_progress", "comic_chapter_read",
                         "favorite_categories", "god_moments"]
    static let ownedNames: Set<String> = ["imports", "epub_images", "docx_images", "fb2_images", "mobi_images",
                                          "epub_covers", "fb2_covers", "mobi_covers", "comic_covers", "god_covers", "sample_comic", "chapter_catalogs"]
    static func owned(_ name: String) -> Bool {
        ownedNames.contains(name) || name.hasPrefix("comics_") || name.hasPrefix("restored_") || name.hasPrefix("custom_poster_")
            || name.hasPrefix("custom_background_") || name.hasPrefix("custom_app_bg_") || name.hasPrefix("custom_font_")
    }
    static func safeSetting(_ key: String) -> Bool {
        // Kotlin: !Regex("(?i)(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)").containsMatchIn(key)
        if key.range(of: "(?i)(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)", options: .regularExpression) != nil {
            return false
        }
        return true
    }
    static let settingTypes: [String: String] = {
        var map: [String: String] = [:]
        for k in ["reading_totals_reconciled_v1", "first_line_indent", "splash_pure_mode", "auto_night_mode", "blue_light_filter", "preload_wifi_only", "keep_screen_on", "haptics_enabled", "incognito_browsing_enabled", "favorites_protected", "multi_language_search", "show_overlay_header_footer", "card_tweaks_migrated_v2", "has_seen_onboarding", "has_seen_welcome", "has_configured_source", "has_imported_local_book", "has_imported_community_comics_v1", "show_adult_sources", "js_source_health_checked_v3"] { map[k] = "boolean" }
        for k in ["font_size", "line_height", "blue_light_alpha", "tts_speed", "tts_pitch", "reader_brightness", "card_blur_dp", "card_corner_dp", "card_tilt_deg", "card_cam_mult", "card_ripple_a", "card_tint_mix", "card_press_s", "card_press_r", "card_alpha"] { map[k] = "float" }
        for k in ["margin_horizontal", "reader_theme", "custom_bg_color", "custom_text_color", "font_family_index", "page_turn_mode", "app_background_mode", "app_background_dim", "screen_orientation_lock", "rest_reminder_minutes", "shelf_drag_hint_shown", "click_zone_left_action", "click_zone_center_action", "click_zone_right_action", "color_primary_index", "color_secondary_index", "render_quality", "daily_goal_minutes"] { map[k] = "int" }
        for k in ["total_read_time_seconds", "legacy_unattributed_read_seconds"] { map[k] = "long" }
        for k in ["custom_splash_poster_uri", "custom_app_background_uri", "custom_font_path", "js_source_repo_url", "search_history_v1"] { map[k] = "string" }
        return map
    }()
    static func settingType(_ key: String) -> String? {
        settingTypes[key] ?? (key.range(of: #"^daily_read_time_\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? "long" : nil)
    }
    static func encode(_ value: Any) -> [String: Any] {
        let type: String
        switch value {
        case is Bool: type = "boolean"
        case is Int: type = "int"
        case is Int64: type = "long"
        case is Double: type = "float"
        case is Set<AnyHashable>: type = "set"
        default: type = "string"
        }
        let v: Any
        if let set = value as? Set<String> { v = Array(set) }
        else if let set = value as? Set<AnyHashable> { v = set.map { "\($0.base)" } }
        else { v = value }
        return ["type": type, "value": v]
    }

    /// Kotlin `context.filesDir` → iOS 文档目录
    static var filesRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    // MARK: 导出

    static func export(to target: URL) async throws -> URL {
        let db = AppDatabase.shared
        let fm = FileManager.default
        let cache = fm.temporaryDirectory
        let stage = cache.appendingPathComponent("backup_\(UUID().uuidString).rows")
        let temp = target.deletingLastPathComponent().appendingPathComponent("\(target.lastPathComponent).\(UUID().uuidString).tmp")
        defer { try? fm.removeItem(at: stage); try? fm.removeItem(at: temp) }
        try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let root = filesRoot.standardizedFileURL.path

        // database.rows：首行元数据 + 每行 {"table":..,"row":{..}}
        var rowsText = "{\"version\":1,\"schema\":12}\n"
        for table in tables {
            let rows = try db.db.query("SELECT * FROM `\(table)`")
            for row in rows {
                var r: [String: Any] = [:]
                for (name, value) in row {
                    switch value {
                    case .null: r[name] = NSNull()
                    case .int(let i): r[name] = NSNumber(value: i)
                    case .real(let d): r[name] = NSNumber(value: d)
                    case .text(let s): r[name] = s.replacingOccurrences(of: root, with: "@FILES@")
                    case .blob: throw ImportError("Unsupported backup column")
                    }
                }
                let lineObj: [String: Any] = ["table": table, "row": r]
                let line = String(decoding: try JSONSerialization.data(withJSONObject: lineObj), as: UTF8.self)
                rowsText += line + "\n"
            }
        }
        try Data(rowsText.utf8).write(to: stage)

        // 打包 ZIP
        try? fm.removeItem(at: temp)
        FileManager.default.createFile(atPath: temp.path, contents: nil)
        let zip = try Archive(url: temp, accessMode: .create)
        var expanded: Int64 = 0
        func entry(_ name: String, file: URL) throws {
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
            guard size <= 512 * 1024 * 1024 && expanded + size <= 4 * 1024 * 1024 * 1024 else {
                throw ImportError("备份内容超过容量限制")
            }
            expanded += size
            _ = try zip.addEntry(with: name, type: .file, uncompressedSize: size, bufferSize: 64 * 1024, progress: nil) { position, size in
                guard let handle = try? FileHandle(forReadingFrom: file) else { return Data() }
                defer { try? handle.close() }
                try? handle.seek(toOffset: UInt64(position))
                return (try? handle.read(upToCount: Int(size))) ?? Data()
            }
        }
        try entry("database.rows", file: stage)
        // 设置（novel_reader_prefs → UserDefaults）
        var settings: [String: Any] = [:]
        for (key, value) in UserDefaults.standard.dictionaryRepresentation() where safeSetting(key) {
            var v = value
            if let s = v as? String { v = s.replacingOccurrences(of: root, with: "@FILES@") }
            settings[key] = encode(v)
        }
        let settingsData = try JSONSerialization.data(withJSONObject: settings)
        let settingsTmp = cache.appendingPathComponent("settings_\(UUID().uuidString).json")
        try settingsData.write(to: settingsTmp)
        defer { try? fm.removeItem(at: settingsTmp) }
        try entry("settings.json", file: settingsTmp)
        // 私有书籍与图片
        for dir in (try? fm.contentsOfDirectory(at: filesRoot, includingPropertiesForKeys: [.isDirectoryKey], options: [])) ?? [] {
            let name = dir.lastPathComponent
            guard owned(name) else { continue }
            if let enumerator = fm.enumerator(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) {
                for case let fileURL as URL in enumerator {
                    let attrs = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard attrs?.isRegularFile == true else { continue }
                    guard !fileURL.lastPathComponent.hasSuffix(".part") && !fileURL.lastPathComponent.hasSuffix(".tmp") else { continue }
                    let relative = fileURL.path.replacingOccurrences(of: filesRoot.standardizedFileURL.path, with: "")
                        .replacingOccurrences(of: "\\", with: "/")
                    try entry("files" + relative, file: fileURL)
                }
            }
        }
        guard (try? fm.moveItem(at: temp, to: target)) != nil else { throw ImportError("备份保存失败") }
        return target
    }

    // MARK: 恢复

    static func restore(from archive: URL) async throws -> Bool {
        let fm = FileManager.default
        let stage = filesRoot.appendingPathComponent("restored_\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: stage, withIntermediateDirectories: true)
        var committed = false
        do {
            var budget = ArchiveBudget(maxEntryBytes: 512 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, maxEntries: 50_000)
            var seen = Set<String>()
            let zip = try Archive(url: archive, accessMode: .read)
            for entry in zip {
                let name = entry.path
                guard name.count <= 1024 && seen.count < 50_000 else { throw ImportError("备份条目过多") }
                guard seen.insert(name).inserted else { throw ImportError("备份包含重复条目") }
                guard name == "database.rows" || name == "settings.json" || name.hasPrefix("files/") else {
                    throw ImportError("备份包含非法条目: \(name)")
                }
                let destination = try ArchiveBudget.destination(root: stage, entryName: name)
                if entry.type == .file {
                    try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                    let tmp = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                    try zip.extract(entry, to: tmp)
                    let data = try Data(contentsOf: tmp)
                    try? fm.removeItem(at: tmp)
                    try budget.copyEntry(data)
                    try data.write(to: destination)
                }
            }

            let settingsFile = stage.appendingPathComponent("settings.json")
            let settingsSize = (try? settingsFile.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard fm.fileExists(atPath: settingsFile.path) && settingsSize <= 1024 * 1024 else { throw ImportError("备份缺少设置") }
            guard let settingsObj = try? JSONSerialization.jsonObject(with: Data(contentsOf: settingsFile)) as? [String: Any] else {
                throw ImportError("设置文件损坏")
            }
            let rowsFile = stage.appendingPathComponent("database.rows")
            let root = stage.appendingPathComponent("files", isDirectory: false).path

            // 清空已有受管设置
            for key in UserDefaults.standard.dictionaryRepresentation().keys where safeSetting(key) && settingType(key) != nil {
                UserDefaults.standard.removeObject(forKey: key)
            }
            for (key, raw) in settingsObj where safeSetting(key) {
                guard let expected = settingType(key), let item = raw as? [String: Any] else { continue }
                guard let actual = item["type"] as? String, actual == expected else {
                    throw ImportError("备份设置类型不符: \(key)")
                }
                switch expected {
                case "boolean":
                    UserDefaults.standard.set(item["value"] as? Bool ?? false, forKey: key)
                case "int":
                    guard let value = (item["value"] as? NSNumber)?.intValue else { throw ImportError("备份设置类型不符: \(key)") }
                    let range: ClosedRange<Int>
                    switch key {
                    case "reader_theme": range = 0...5
                    case "page_turn_mode": range = 0...4
                    case "screen_orientation_lock": range = 0...2
                    case "font_family_index": range = 0...20
                    case "app_background_mode": range = 0...1
                    case "app_background_dim": range = 0...50
                    case "daily_goal_minutes", "rest_reminder_minutes": range = 0...1440
                    default: range = Int.min...Int.max
                    }
                    guard range.contains(value) else { throw ImportError("备份设置越界: \(key)") }
                    UserDefaults.standard.set(value, forKey: key)
                case "long":
                    guard let value = (item["value"] as? NSNumber)?.int64Value else { throw ImportError("备份设置类型不符: \(key)") }
                    UserDefaults.standard.set(Int(value), forKey: key)
                case "float":
                    guard let number = (item["value"] as? NSNumber)?.doubleValue,
                          number.isFinite && abs(number) <= 10_000 else { throw ImportError("备份设置越界: \(key)") }
                    let clamped: Double
                    switch key {
                    case "font_size": clamped = min(max(number, 8), 80)
                    case "line_height": clamped = min(max(number, 8), 120)
                    default: clamped = number
                    }
                    UserDefaults.standard.set(clamped, forKey: key)
                case "string":
                    guard let value = item["value"] as? String else { throw ImportError("备份设置类型不符: \(key)") }
                    UserDefaults.standard.set(value.replacingOccurrences(of: "@FILES@", with: root), forKey: key)
                case "set":
                    guard let a = item["value"] as? [Any], a.count <= 10_000 else { throw ImportError("备份设置越界: \(key)") }
                    let set = Set(a.compactMap { $0 as? String })
                    UserDefaults.standard.set(Array(set), forKey: key)
                default: break
                }
            }

            let db = AppDatabase.shared
            var columnCache: [String: [String: (String, Bool)]] = [:]
            for table in tables {
                let cols = try db.db.query("PRAGMA table_info(`\(table)`)")
                var map: [String: (String, Bool)] = [:]
                for c in cols {
                    guard let name = c["name"]?.textValue, let type = c["type"]?.textValue else { continue }
                    map[name] = (type, (c["notnull"]?.intValue ?? 0) != 0)
                }
                columnCache[table] = map
            }

            try db.db.transaction {
                for table in tables.reversed() {
                    try db.db.exec("DELETE FROM `\(table)`")
                }
                let text = try String(contentsOf: rowsFile, encoding: .utf8)
                var iterator = text.split(separator: "\n", omittingEmptySubsequences: false).makeIterator()
                guard let headerLine = iterator.next(),
                      let header = try? JSONSerialization.jsonObject(with: Data(headerLine.utf8)) as? [String: Any],
                      (header["version"] as? NSNumber)?.intValue == 1,
                      (header["schema"] as? NSNumber)?.intValue == 12 else {
                    throw ImportError("不支持的备份版本")
                }
                var rowCount = 0
                while let line = iterator.next() {
                    rowCount += 1
                    guard rowCount <= 1_000_000 else { throw ImportError("备份行数过多") }
                    guard !line.isEmpty else { continue }
                    guard let item = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                          let table = item["table"] as? String,
                          let row = item["row"] as? [String: Any] else {
                        throw ImportError("备份行损坏")
                    }
                    guard tables.contains(table) else { throw ImportError("备份包含未知表: \(table)") }
                    if table == "chapters", let content = row["content"] as? String, content.count > 256_000 {
                        throw ImportError("备份章节超过存储安全限制")
                    }
                    if table == "reading_records" || table == "reading_sessions" {
                        if let d = row["durationSeconds"] as? NSNumber, d.int64Value < 0 { throw ImportError("备份时长为负") }
                    }
                    guard let columns = columnCache[table] else { throw ImportError("备份列与数据库不一致") }
                    let names = Array(row.keys)
                    guard Set(names) == Set(columns.keys) else { throw ImportError("备份列与数据库不一致") }
                    var binds: [SQLiteValue] = []
                    for name in names {
                        let value = row[name] ?? NSNull()
                        let (type, required) = columns[name]!
                        let isNull = value is NSNull
                        guard !isNull || !required else { throw ImportError("备份必填字段为空") }
                        if isNull {
                            binds.append(.null)
                        } else if let s = value as? String {
                            guard type == "TEXT" else { throw ImportError("备份数据库字段类型错误") }
                            binds.append(.text(s.replacingOccurrences(of: "@FILES@", with: root)))
                        } else if let n = value as? NSNumber {
                            switch type {
                            case "INTEGER": binds.append(.int(n.int64Value))
                            case "REAL":
                                guard n.doubleValue.isFinite else { throw ImportError("备份数据库字段类型错误") }
                                binds.append(.real(n.doubleValue))
                            default: throw ImportError("备份数据库字段类型错误")
                            }
                        } else {
                            throw ImportError("无效备份字段")
                        }
                    }
                    let colsSql = names.map { "`\($0)`" }.joined(separator: ",")
                    let qs = names.map { _ in "?" }.joined(separator: ",")
                    try db.db.exec("INSERT INTO `\(table)` (\(colsSql)) VALUES (\(qs))", binds)
                }
                for table in ["chapters", "bookmarks", "highlights"] {
                    let orphanRows = try db.db.query("SELECT COUNT(*) AS c FROM `\(table)` x LEFT JOIN books b ON x.bookId=b.id WHERE b.id IS NULL")
                    let orphan = orphanRows.first?["c"]?.intValue ?? 0
                    guard orphan == 0 else { throw ImportError("备份包含孤立的书籍关联") }
                }
            }
            committed = true
            try? fm.removeItem(at: rowsFile)
            try? fm.removeItem(at: settingsFile)
            UserDefaults.standard.synchronize()
            return true
        } catch {
            if !committed { try? fm.removeItem(at: stage) }
            throw error
        }
    }
}

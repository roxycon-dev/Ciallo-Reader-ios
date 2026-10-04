import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/LegacyDatabaseMigration.kt（78 行）
// Recover early schemas without destructive fallback. Unknown columns remain in legacy copies.
//
// iOS 侧说明：iOS 新装库由 AppDatabase.swift 直接按 Room v12 schema 建表，不存在 v1-v4
// 历史库；本类型保留迁移算法与校验入口——当用户提供从安卓侧拷贝过来的旧版本
// novel_reader.db（user_version < 12）时走同一套恢复逻辑，表结构与 v12 校验一致。

final class LegacyDatabaseMigration {
    let startVersion: Int

    init(_ from: Int) { startVersion = from }

    func migrate(_ db: SQLiteDatabase) throws {
        for sql in Self.tables {
            let table = Self.substring(sql, after: "`", before: "`")
            let existsRows = try db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [.text(table)])
            let exists = !existsRows.isEmpty
            if !exists { try db.exec(sql); continue }
            let old = "legacy_v\(startVersion)_\(table)"
            // 先删旧索引（RENAME 后会跟着表走，重建前必须清掉）
            let indexRows = try db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", [.text(table)])
            for row in indexRows {
                if let name = row["name"]?.textValue {
                    try db.exec("DROP INDEX `\(name.replacingOccurrences(of: "`", with: "``"))`")
                }
            }
            try db.exec("ALTER TABLE `\(table)` RENAME TO `\(old)`")
            try db.exec(sql)
            let oldColsRows = try db.query("PRAGMA table_info(`\(old)`)")
            let oldCols = Set(oldColsRows.compactMap { $0["name"]?.textValue })
            var names: [String] = []
            var values: [String] = []
            let newColsRows = try db.query("PRAGMA table_info(`\(table)`)")
            for row in newColsRows {
                guard let name = row["name"]?.textValue,
                      let type = row["type"]?.textValue,
                      let notNull = row["notnull"]?.intValue else { continue }
                names.append("`" + name + "`")
                if oldCols.contains(name) {
                    values.append("`" + name + "`")
                } else if notNull == 0 {
                    values.append("NULL")
                } else if name == "category" {
                    values.append("'默认'")
                } else if name == "contentType" {
                    values.append("'NOVEL'")
                } else if name == "author" {
                    values.append("'未知作者'")
                } else if name == "colorHex" {
                    values.append("'#7FD8C8'")
                } else if type == "TEXT" {
                    values.append("''")
                } else {
                    values.append("0")
                }
            }
            for indexSql in Self.indexes where indexSql.contains("ON `\(table)`") {
                try db.exec(indexSql)
            }
            let ordering = oldCols.contains("createdTime") ? " ORDER BY createdTime DESC" : ""
            try db.exec("INSERT OR IGNORE INTO `\(table)` (\(names.joined(separator: ", "))) SELECT \(values.joined(separator: ", ")) FROM `\(old)`\(ordering)")
        }
        for indexSql in Self.indexes {
            try db.exec(indexSql)
        }
    }

    /// 对照 Room v12 schema 的校验：逐表核对列名/类型（迁移说明要求，不真正升级 v1-v4）。
    static func validateSchemaV12(_ db: SQLiteDatabase) -> Bool {
        let expected: [String: [String]] = [
            "books": ["id", "title", "author", "filePath", "coverUri", "category", "currentChapterIndex",
                      "scrollOffset", "isFinished", "totalChapters", "contentType", "addedTime",
                      "lastReadTime", "sourceId", "comicId"],
            "chapters": ["id", "bookId", "chapterOrder", "title", "content", "startCharIndex", "endCharIndex"],
            "bookmarks": ["id", "bookId", "chapterIndex", "scrollOffset", "title", "snippet", "createdTime"],
            "highlights": ["id", "bookId", "chapterIndex", "selectedText", "note", "colorHex", "createdTime"],
            "categories": ["id", "name", "isProtected"],
            "reading_records": ["id", "bookId", "bookTitle", "dateStr", "durationSeconds"],
            "reading_sessions": ["id", "bookId", "bookTitle", "dateStr", "startTimeMs", "endTimeMs",
                                 "durationSeconds", "startHour"],
            "download_tasks": ["id", "sourceId", "title", "author", "coverUrl", "downloadUrl", "format",
                               "status", "downloadedBytes", "totalBytes", "filePath", "errorMessage", "updatedAt"],
            "anilist_titles": ["rowId", "mediaId", "titleType", "rawTitle", "normalizedTitle", "compactTitle"],
            "favorites": ["sourceId", "comicId", "title", "author", "coverUrl", "localThumbPath", "serialStatus",
                          "latestChapterId", "latestChapterTitle", "latestChapterUpdateAt", "lastCheckedAt",
                          "sourceAlive", "categoryName", "favoritedAt", "sortOrder"],
            "comic_progress": ["sourceId", "comicId", "lastChapterId", "lastChapterIndex", "lastPageIndex",
                               "lastPageCount", "lastReadAt", "seenTopChapterId", "seenChapterCount"],
            "comic_chapter_read": ["sourceId", "comicId", "chapterId", "status", "pageIndex", "pageCount",
                                   "chapterIndex", "updatedAt", "bookmarked"],
            "favorite_categories": ["name", "sortOrder", "createdAt"],
            "god_moments": ["id", "contentType", "bookId", "chapterId", "bookTitle", "chapterTitle",
                            "chapterNumber", "title", "titleIsCustom", "rating", "note", "coverPath",
                            "coverSource", "cropParams", "createdAt", "updatedAt"],
        ]
        for (table, columns) in expected {
            guard let rows = try? db.query("PRAGMA table_info(`\(table)`)") else { return false }
            let actual = rows.compactMap { $0["name"]?.textValue }
            if actual != columns { return false }
        }
        return true
    }

    private static func substring(_ s: String, after: String, before: String) -> String {
        guard let r1 = s.range(of: after) else { return s }
        let tail = s[r1.upperBound...]
        guard let r2 = tail.range(of: before) else { return String(tail) }
        return String(tail[tail.startIndex..<r2.lowerBound])
    }

    static let tables: [String] = [
        "CREATE TABLE IF NOT EXISTS `books` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `filePath` TEXT NOT NULL, `coverUri` TEXT, `category` TEXT NOT NULL, `currentChapterIndex` INTEGER NOT NULL, `scrollOffset` INTEGER NOT NULL, `isFinished` INTEGER NOT NULL, `totalChapters` INTEGER NOT NULL, `contentType` TEXT NOT NULL, `addedTime` INTEGER NOT NULL, `lastReadTime` INTEGER NOT NULL, `sourceId` TEXT, `comicId` TEXT)",
        "CREATE TABLE IF NOT EXISTS `chapters` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterOrder` INTEGER NOT NULL, `title` TEXT NOT NULL, `content` TEXT NOT NULL, `startCharIndex` INTEGER NOT NULL, `endCharIndex` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `bookmarks` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `scrollOffset` INTEGER NOT NULL, `title` TEXT NOT NULL, `snippet` TEXT NOT NULL, `createdTime` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `highlights` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `selectedText` TEXT NOT NULL, `note` TEXT NOT NULL, `colorHex` TEXT NOT NULL, `createdTime` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `categories` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `isProtected` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `reading_records` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER, `bookTitle` TEXT NOT NULL, `dateStr` TEXT NOT NULL, `durationSeconds` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `reading_sessions` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `bookId` INTEGER, `bookTitle` TEXT NOT NULL, `dateStr` TEXT NOT NULL, `startTimeMs` INTEGER NOT NULL, `endTimeMs` INTEGER NOT NULL, `durationSeconds` INTEGER NOT NULL, `startHour` INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `download_tasks` (`id` TEXT NOT NULL, `sourceId` TEXT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `coverUrl` TEXT, `downloadUrl` TEXT NOT NULL, `format` TEXT NOT NULL, `status` TEXT NOT NULL, `downloadedBytes` INTEGER NOT NULL, `totalBytes` INTEGER NOT NULL, `filePath` TEXT NOT NULL, `errorMessage` TEXT, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))",
        "CREATE TABLE IF NOT EXISTS `anilist_titles` (`rowId` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `mediaId` INTEGER NOT NULL, `titleType` TEXT NOT NULL, `rawTitle` TEXT NOT NULL, `normalizedTitle` TEXT NOT NULL, `compactTitle` TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS `favorites` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `title` TEXT NOT NULL, `author` TEXT NOT NULL, `coverUrl` TEXT, `localThumbPath` TEXT, `serialStatus` TEXT NOT NULL, `latestChapterId` TEXT, `latestChapterTitle` TEXT, `latestChapterUpdateAt` INTEGER NOT NULL, `lastCheckedAt` INTEGER NOT NULL, `sourceAlive` INTEGER NOT NULL, `categoryName` TEXT NOT NULL, `favoritedAt` INTEGER NOT NULL, `sortOrder` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`))",
        "CREATE TABLE IF NOT EXISTS `comic_progress` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `lastChapterId` TEXT, `lastChapterIndex` INTEGER NOT NULL, `lastPageIndex` INTEGER NOT NULL, `lastPageCount` INTEGER NOT NULL, `lastReadAt` INTEGER NOT NULL, `seenTopChapterId` TEXT, `seenChapterCount` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`))",
        "CREATE TABLE IF NOT EXISTS `comic_chapter_read` (`sourceId` TEXT NOT NULL, `comicId` TEXT NOT NULL, `chapterId` TEXT NOT NULL, `status` INTEGER NOT NULL, `pageIndex` INTEGER NOT NULL, `pageCount` INTEGER NOT NULL, `chapterIndex` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, `bookmarked` INTEGER NOT NULL, PRIMARY KEY(`sourceId`, `comicId`, `chapterId`))",
        "CREATE TABLE IF NOT EXISTS `favorite_categories` (`name` TEXT NOT NULL, `sortOrder` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, PRIMARY KEY(`name`))",
        "CREATE TABLE IF NOT EXISTS `god_moments` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `contentType` TEXT NOT NULL, `bookId` TEXT NOT NULL, `chapterId` TEXT NOT NULL, `bookTitle` TEXT NOT NULL, `chapterTitle` TEXT NOT NULL, `chapterNumber` INTEGER NOT NULL, `title` TEXT NOT NULL, `titleIsCustom` INTEGER NOT NULL, `rating` REAL NOT NULL, `note` TEXT NOT NULL, `coverPath` TEXT, `coverSource` TEXT NOT NULL, `cropParams` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL)",
    ]
    static let indexes: [String] = [
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_bookmarks_bookId_chapterIndex` ON `bookmarks` (`bookId`, `chapterIndex`)",
        "CREATE INDEX IF NOT EXISTS `index_anilist_titles_normalizedTitle` ON `anilist_titles` (`normalizedTitle`)",
        "CREATE INDEX IF NOT EXISTS `index_anilist_titles_compactTitle` ON `anilist_titles` (`compactTitle`)",
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_anilist_titles_mediaId_titleType_rawTitle` ON `anilist_titles` (`mediaId`, `titleType`, `rawTitle`)",
        "CREATE INDEX IF NOT EXISTS `index_favorites_categoryName` ON `favorites` (`categoryName`)",
        "CREATE INDEX IF NOT EXISTS `index_favorites_favoritedAt` ON `favorites` (`favoritedAt`)",
        "CREATE INDEX IF NOT EXISTS `index_favorites_lastCheckedAt` ON `favorites` (`lastCheckedAt`)",
        "CREATE INDEX IF NOT EXISTS `index_comic_progress_lastReadAt` ON `comic_progress` (`lastReadAt`)",
        "CREATE INDEX IF NOT EXISTS `index_comic_chapter_read_sourceId_comicId` ON `comic_chapter_read` (`sourceId`, `comicId`)",
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_god_moments_bookId_chapterId` ON `god_moments` (`bookId`, `chapterId`)",
        "CREATE INDEX IF NOT EXISTS `index_god_moments_rating` ON `god_moments` (`rating`)",
        "CREATE INDEX IF NOT EXISTS `index_god_moments_createdAt` ON `god_moments` (`createdAt`)",
    ]
}

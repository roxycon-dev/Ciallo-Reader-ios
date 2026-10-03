import Foundation
import SQLite3

// MARK: - SQLite 直连层（AppDatabase.kt / Room v12 的镜像）
//
// 表结构与安卓 Room v12（app/schemas/com.example.data.AppDatabase/12.json）逐字段一致，
// 备份文件可互读；所有时间戳一律毫秒 INTEGER。

let dbChangedNotification = Notification.Name("AppDatabaseDidChange")

enum SQLiteValue {
    case null
    case int(Int64)
    case real(Double)
    case text(String)
    case blob(Data)

    var intValue: Int64? {
        switch self {
        case .int(let v): return v
        case .real(let v): return Int64(v)
        case .text(let v): return Int64(v)
        default: return nil
        }
    }
    var doubleValue: Double? {
        switch self {
        case .int(let v): return Double(v)
        case .real(let v): return v
        default: return nil
        }
    }
    var textValue: String? {
        if case .text(let v) = self { return v }
        return nil
    }
    var blobValue: Data? {
        if case .blob(let v) = self { return v }
        return nil
    }
}

final class SQLiteDatabase {
    private var handle: OpaquePointer?
    private let queue = DispatchQueue(label: "app.database", qos: .userInitiated)

    init(url: URL) throws {
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &db, flags, nil) == SQLITE_OK else {
            let msg = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            throw NSError(domain: "SQLiteDatabase", code: -1, userInfo: [NSLocalizedDescriptionKey: msg])
        }
        handle = db
        exec("PRAGMA journal_mode=WAL")
        exec("PRAGMA foreign_keys=ON")
        exec("PRAGMA synchronous=NORMAL")
    }

    deinit {
        if let handle { sqlite3_close_v2(handle) }
    }

    // MARK: 基础执行

    @discardableResult
    func exec(_ sql: String, binds: [SQLiteValue] = []) throws -> Int {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw dbError(sql)
        }
        defer { sqlite3_finalize(stmt) }
        try bindValues(binds, to: stmt)
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw dbError(sql) }
        return Int(sqlite3_changes(handle))
    }

    func query(_ sql: String, binds: [SQLiteValue] = []) throws -> [[String: SQLiteValue]] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw dbError(sql)
        }
        defer { sqlite3_finalize(stmt) }
        try bindValues(binds, to: stmt)

        var rows: [[String: SQLiteValue]] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            var row: [String: SQLiteValue] = [:]
            let count = sqlite3_column_count(stmt)
            for i in 0..<count {
                let name = String(cString: sqlite3_column_name(stmt, i))
                switch sqlite3_column_type(stmt, i) {
                case SQLITE_NULL: row[name] = .null
                case SQLITE_INTEGER: row[name] = .int(sqlite3_column_int64(stmt, i))
                case SQLITE_FLOAT: row[name] = .real(sqlite3_column_double(stmt, i))
                case SQLITE_TEXT: row[name] = .text(String(cString: sqlite3_column_text(stmt, i)))
                case SQLITE_BLOB:
                    if let bytes = sqlite3_column_blob(stmt, i) {
                        let n = Int(sqlite3_column_bytes(stmt, i))
                        row[name] = .blob(Data(bytes: bytes, count: n))
                    } else {
                        row[name] = .blob(Data())
                    }
                default: row[name] = .null
                }
            }
            rows.append(row)
        }
        return rows
    }

    func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
            NotificationCenter.default.post(name: dbChangedNotification, object: nil)
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    private func bindValues(_ binds: [SQLiteValue], to stmt: OpaquePointer?) throws {
        for (i, v) in binds.enumerated() {
            let idx = Int32(i + 1)
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            switch v {
            case .null: sqlite3_bind_null(stmt, idx)
            case .int(let n): sqlite3_bind_int64(stmt, idx, n)
            case .real(let d): sqlite3_bind_double(stmt, idx, d)
            case .text(let s): sqlite3_bind_text(stmt, idx, s, -1, transient)
            case .blob(let d): d.withUnsafeBytes { raw in
                _ = sqlite3_bind_blob(stmt, idx, raw.baseAddress, Int32(d.count), transient)
            }
            }
        }
    }

    private func dbError(_ sql: String) -> Error {
        let msg = String(cString: sqlite3_errmsg(handle))
        return NSError(domain: "SQLiteDatabase", code: -2,
                       userInfo: [NSLocalizedDescriptionKey: "\(msg) @ \(sql.prefix(120))"])
    }
}

// MARK: - 数据库门面 + v12 Schema

final class AppDatabase {
    static let shared: AppDatabase = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try! AppDatabase(url: dir.appendingPathComponent("novel_reader.db"))
    }()

    let db: SQLiteDatabase

    init(url: URL) throws {
        db = try SQLiteDatabase(url: url)
        try migrate()
    }

    /// Room v12 建表 SQL（逐字段镜像，新装直接 v12）
    private func migrate() throws {
        let ddl: [String] = [
            """
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                filePath TEXT NOT NULL,
                coverUri TEXT,
                category TEXT NOT NULL,
                currentChapterIndex INTEGER NOT NULL,
                scrollOffset INTEGER NOT NULL,
                isFinished INTEGER NOT NULL,
                totalChapters INTEGER NOT NULL,
                contentType TEXT NOT NULL,
                addedTime INTEGER NOT NULL,
                lastReadTime INTEGER NOT NULL,
                sourceId TEXT,
                comicId TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bookId INTEGER NOT NULL,
                chapterOrder INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                startCharIndex INTEGER NOT NULL,
                endCharIndex INTEGER NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS index_chapters_bookId ON chapters (bookId)",
            """
            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bookId INTEGER NOT NULL,
                chapterIndex INTEGER NOT NULL,
                scrollOffset INTEGER NOT NULL,
                title TEXT NOT NULL,
                snippet TEXT NOT NULL,
                createdTime INTEGER NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS index_bookmarks_bookId_chapterIndex ON bookmarks (bookId, chapterIndex)",
            """
            CREATE TABLE IF NOT EXISTS highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bookId INTEGER NOT NULL,
                chapterIndex INTEGER NOT NULL,
                selectedText TEXT NOT NULL,
                note TEXT NOT NULL,
                colorHex TEXT NOT NULL,
                createdTime INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                isProtected INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS reading_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bookId INTEGER,
                bookTitle TEXT NOT NULL,
                dateStr TEXT NOT NULL,
                durationSeconds INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS reading_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bookId INTEGER,
                bookTitle TEXT NOT NULL,
                dateStr TEXT NOT NULL,
                startTimeMs INTEGER NOT NULL,
                endTimeMs INTEGER NOT NULL,
                durationSeconds INTEGER NOT NULL,
                startHour INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT NOT NULL PRIMARY KEY,
                sourceId TEXT NOT NULL,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                coverUrl TEXT NOT NULL,
                downloadUrl TEXT NOT NULL,
                format TEXT NOT NULL,
                status TEXT NOT NULL,
                downloadedBytes INTEGER NOT NULL,
                totalBytes INTEGER NOT NULL,
                filePath TEXT,
                errorMessage TEXT,
                updatedAt INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS anilist_titles (
                rowId INTEGER PRIMARY KEY AUTOINCREMENT,
                mediaId INTEGER NOT NULL,
                titleType TEXT NOT NULL,
                rawTitle TEXT NOT NULL,
                normalizedTitle TEXT NOT NULL,
                compactTitle TEXT NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS index_anilist_titles_normalizedTitle ON anilist_titles (normalizedTitle)",
            "CREATE INDEX IF NOT EXISTS index_anilist_titles_compactTitle ON anilist_titles (compactTitle)",
            "CREATE UNIQUE INDEX IF NOT EXISTS index_anilist_titles_mediaId_titleType_rawTitle ON anilist_titles (mediaId, titleType, rawTitle)",
            """
            CREATE TABLE IF NOT EXISTS favorites (
                sourceId TEXT NOT NULL,
                comicId TEXT NOT NULL,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                coverUrl TEXT NOT NULL,
                localThumbPath TEXT,
                serialStatus TEXT NOT NULL,
                latestChapterId TEXT,
                latestChapterTitle TEXT,
                latestChapterUpdateAt INTEGER NOT NULL,
                lastCheckedAt INTEGER NOT NULL,
                sourceAlive INTEGER NOT NULL,
                categoryName TEXT,
                favoritedAt INTEGER NOT NULL,
                sortOrder INTEGER NOT NULL,
                PRIMARY KEY (sourceId, comicId)
            )
            """,
            "CREATE INDEX IF NOT EXISTS index_favorites_categoryName ON favorites (categoryName)",
            "CREATE INDEX IF NOT EXISTS index_favorites_favoritedAt ON favorites (favoritedAt)",
            "CREATE INDEX IF NOT EXISTS index_favorites_lastCheckedAt ON favorites (lastCheckedAt)",
            """
            CREATE TABLE IF NOT EXISTS comic_progress (
                sourceId TEXT NOT NULL,
                comicId TEXT NOT NULL,
                lastChapterId TEXT NOT NULL,
                lastChapterIndex INTEGER NOT NULL,
                lastPageIndex INTEGER NOT NULL,
                lastPageCount INTEGER NOT NULL,
                lastReadAt INTEGER NOT NULL,
                seenTopChapterId TEXT,
                seenChapterCount INTEGER NOT NULL,
                PRIMARY KEY (sourceId, comicId)
            )
            """,
            "CREATE INDEX IF NOT EXISTS index_comic_progress_lastReadAt ON comic_progress (lastReadAt)",
            """
            CREATE TABLE IF NOT EXISTS comic_chapter_read (
                sourceId TEXT NOT NULL,
                comicId TEXT NOT NULL,
                chapterId TEXT NOT NULL,
                status INTEGER NOT NULL,
                pageIndex INTEGER NOT NULL,
                pageCount INTEGER NOT NULL,
                chapterIndex INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                bookmarked INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (sourceId, comicId, chapterId)
            )
            """,
            "CREATE INDEX IF NOT EXISTS index_comic_chapter_read_sourceId_comicId ON comic_chapter_read (sourceId, comicId)",
            """
            CREATE TABLE IF NOT EXISTS favorite_categories (
                name TEXT NOT NULL PRIMARY KEY,
                sortOrder INTEGER NOT NULL,
                createdAt INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS god_moments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contentType TEXT NOT NULL,
                bookId TEXT NOT NULL,
                chapterId TEXT NOT NULL,
                bookTitle TEXT NOT NULL,
                chapterTitle TEXT NOT NULL,
                chapterNumber INTEGER NOT NULL,
                title TEXT NOT NULL,
                titleIsCustom INTEGER NOT NULL,
                rating REAL NOT NULL,
                note TEXT NOT NULL,
                coverPath TEXT,
                coverSource TEXT,
                cropParams TEXT,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS index_god_moments_bookId_chapterId ON god_moments (bookId, chapterId)",
            "CREATE INDEX IF NOT EXISTS index_god_moments_rating ON god_moments (rating)",
            "CREATE INDEX IF NOT EXISTS index_god_moments_createdAt ON god_moments (createdAt)",
            // 兜底迁移：老结构补列
            "ALTER TABLE comic_chapter_read ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0",
        ]
        // ALTER 兜底在列已存在时会失败，属预期
        for sql in ddl {
            try? db.exec(sql)
        }
    }

    // MARK: - Book DAO

    func insertBook(_ b: Book, chapters: [Chapter]) throws -> Int {
        var bookId = b.id
        try db.transaction {
            if b.id > 0, try count("SELECT COUNT(*) FROM books WHERE id=?", [int(Int64(b.id))]) > 0 {
                try db.exec("DELETE FROM chapters WHERE bookId=?", [int(Int64(b.id))])
                try db.exec("""
                    UPDATE books SET title=?, author=?, filePath=?, coverUri=?, category=?, currentChapterIndex=?,
                    scrollOffset=?, isFinished=?, totalChapters=?, contentType=?, lastReadTime=?, sourceId=?, comicId=?
                    WHERE id=?
                    """, bookBinds(b) + [.int(Int64(b.id))])
                bookId = b.id
            } else {
                try db.exec("""
                    INSERT INTO books (title, author, filePath, coverUri, category, currentChapterIndex, scrollOffset,
                    isFinished, totalChapters, contentType, addedTime, lastReadTime, sourceId, comicId)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, bookBinds(b))
                bookId = Int(try lastInsertId())
            }
            for c in chapters {
                try db.exec("""
                    INSERT INTO chapters (bookId, chapterOrder, title, content, startCharIndex, endCharIndex)
                    VALUES (?,?,?,?,?,?)
                    """, [
                        .int(Int64(bookId)), .int(Int64(c.chapterOrder)), .text(c.title),
                        .text(c.content), .int(c.startCharIndex), .int(c.endCharIndex),
                    ])
            }
        }
        return bookId
    }

    private func bookBinds(_ b: Book) -> [SQLiteValue] {
        [
            .text(b.title), .text(b.author), .text(b.filePath),
            b.coverUri.map { .text($0) } ?? .null,
            .text(b.category),
            .int(Int64(b.currentChapterIndex)), .int(Int64(b.scrollOffset)),
            .int(b.isFinished ? 1 : 0), .int(Int64(b.totalChapters)),
            .text(b.contentType),
            .int(b.addedTime), .int(b.lastReadTime),
            b.sourceId.map { .text($0) } ?? .null,
            b.comicId.map { .text($0) } ?? .null,
        ]
    }

    func lastInsertId() throws -> Int64 {
        let rows = try db.query("SELECT last_insert_rowid() AS id")
        return rows.first?["id"]?.intValue ?? 0
    }

    func count(_ sql: String, _ binds: [SQLiteValue] = []) throws -> Int {
        let rows = try db.query(sql, binds)
        return Int(rows.first?.values.first?.intValue ?? 0)
    }

    private func book(from row: [String: SQLiteValue]) -> Book {
        var b = Book()
        b.id = Int(row["id"]?.intValue ?? 0)
        b.title = row["title"]?.textValue ?? ""
        b.author = row["author"]?.textValue ?? "未知作者"
        b.filePath = row["filePath"]?.textValue ?? ""
        b.coverUri = row["coverUri"]?.textValue
        b.category = row["category"]?.textValue ?? defaultCategory
        b.currentChapterIndex = Int(row["currentChapterIndex"]?.intValue ?? 0)
        b.scrollOffset = Int(row["scrollOffset"]?.intValue ?? 0)
        b.isFinished = (row["isFinished"]?.intValue ?? 0) != 0
        b.totalChapters = Int(row["totalChapters"]?.intValue ?? 0)
        b.contentType = row["contentType"]?.textValue ?? "NOVEL"
        b.addedTime = row["addedTime"]?.intValue ?? 0
        b.lastReadTime = row["lastReadTime"]?.intValue ?? 0
        b.sourceId = row["sourceId"]?.textValue
        b.comicId = row["comicId"]?.textValue
        return b
    }

    func allBooks() throws -> [Book] {
        try db.query("SELECT * FROM books ORDER BY lastReadTime DESC").map(book(from:))
    }

    func book(id: Int) throws -> Book? {
        try db.query("SELECT * FROM books WHERE id=?", [int(Int64(id))]).first.map(book(from:))
    }

    func updateProgress(bookId: Int, chapterIndex: Int, scrollOffset: Int) throws {
        try db.exec("UPDATE books SET currentChapterIndex=?, scrollOffset=?, lastReadTime=? WHERE id=?",
                    [.int(Int64(chapterIndex)), .int(Int64(scrollOffset)),
                     .int(Int64(Date().timeIntervalSince1970 * 1000)), .int(Int64(bookId))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteBook(id: Int) throws {
        try db.transaction {
            try db.exec("DELETE FROM chapters WHERE bookId=?", [int(Int64(id))])
            try db.exec("DELETE FROM bookmarks WHERE bookId=?", [int(Int64(id))])
            try db.exec("DELETE FROM highlights WHERE bookId=?", [int(Int64(id))])
            // 历史会话只断开 bookId（不删记录，统计保留）
            try db.exec("UPDATE reading_sessions SET bookId=NULL WHERE bookId=?", [int(Int64(id))])
            try db.exec("UPDATE reading_records SET bookId=NULL WHERE bookId=?", [int(Int64(id))])
            try db.exec("DELETE FROM books WHERE id=?", [int(Int64(id))])
        }
    }

    // MARK: - Chapter DAO

    private func chapter(from row: [String: SQLiteValue]) -> Chapter {
        Chapter(
            id: Int(row["id"]?.intValue ?? 0),
            bookId: Int(row["bookId"]?.intValue ?? 0),
            chapterOrder: Int(row["chapterOrder"]?.intValue ?? 0),
            title: row["title"]?.textValue ?? "",
            content: row["content"]?.textValue ?? "",
            startCharIndex: row["startCharIndex"]?.intValue ?? 0,
            endCharIndex: row["endCharIndex"]?.intValue ?? 0
        )
    }

    func chapters(bookId: Int) throws -> [Chapter] {
        try db.query("SELECT * FROM chapters WHERE bookId=? ORDER BY chapterOrder", [int(Int64(bookId))]).map(chapter(from:))
    }

    func chapter(bookId: Int, order: Int) throws -> Chapter? {
        try db.query("SELECT * FROM chapters WHERE bookId=? AND chapterOrder=? LIMIT 1",
                     [int(Int64(bookId)), .int(Int64(order))]).first.map(chapter(from:))
    }

    // MARK: - Bookmark / Highlight DAO

    func addBookmark(_ bm: Bookmark) throws {
        try db.exec("""
            INSERT INTO bookmarks (bookId, chapterIndex, scrollOffset, title, snippet, createdTime)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT (bookId, chapterIndex) DO UPDATE SET scrollOffset=excluded.scrollOffset,
            title=excluded.title, snippet=excluded.snippet, createdTime=excluded.createdTime
            """, [.int(Int64(bm.bookId)), .int(Int64(bm.chapterIndex)), .int(Int64(bm.scrollOffset)),
                  .text(bm.title), .text(bm.snippet), .int(bm.createdTime)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func removeBookmark(bookId: Int, chapterIndex: Int) throws {
        try db.exec("DELETE FROM bookmarks WHERE bookId=? AND chapterIndex=?", [.int(Int64(bookId)), .int(Int64(chapterIndex))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func bookmarks(bookId: Int) throws -> [Bookmark] {
        try db.query("SELECT * FROM bookmarks WHERE bookId=? ORDER BY chapterIndex", [int(Int64(bookId))]).map { row in
            Bookmark(id: Int(row["id"]?.intValue ?? 0),
                     bookId: Int(row["bookId"]?.intValue ?? 0),
                     chapterIndex: Int(row["chapterIndex"]?.intValue ?? 0),
                     scrollOffset: Int(row["scrollOffset"]?.intValue ?? 0),
                     title: row["title"]?.textValue ?? "",
                     snippet: row["snippet"]?.textValue ?? "",
                     createdTime: row["createdTime"]?.intValue ?? 0)
        }
    }

    func addHighlight(_ h: Highlight) throws {
        try db.exec("""
            INSERT INTO highlights (bookId, chapterIndex, selectedText, note, colorHex, createdTime)
            VALUES (?,?,?,?,?,?)
            """, [.int(Int64(h.bookId)), .int(Int64(h.chapterIndex)), .text(h.selectedText),
                  .text(h.note), .text(h.colorHex), .int(h.createdTime)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func highlights(bookId: Int) throws -> [Highlight] {
        try db.query("SELECT * FROM highlights WHERE bookId=? ORDER BY id", [int(Int64(bookId))]).map { row in
            Highlight(id: Int(row["id"]?.intValue ?? 0),
                      bookId: Int(row["bookId"]?.intValue ?? 0),
                      chapterIndex: Int(row["chapterIndex"]?.intValue ?? 0),
                      selectedText: row["selectedText"]?.textValue ?? "",
                      note: row["note"]?.textValue ?? "",
                      colorHex: row["colorHex"]?.textValue ?? "#7FD8C8",
                      createdTime: row["createdTime"]?.intValue ?? 0)
        }
    }

    // MARK: - Category DAO

    func categories() throws -> [CategoryEntity] {
        try db.query("SELECT * FROM categories ORDER BY id").map { row in
            CategoryEntity(id: Int(row["id"]?.intValue ?? 0),
                           name: row["name"]?.textValue ?? "",
                           isProtected: (row["isProtected"]?.intValue ?? 0) != 0)
        }
    }

    func ensureDefaultCategory() throws {
        if try count("SELECT COUNT(*) FROM categories WHERE name=?", [text(defaultCategory)]) == 0 {
            try db.exec("INSERT INTO categories (name, isProtected) VALUES (?,1)", [text(defaultCategory)])
        }
    }

    func addCategory(name: String) throws {
        try db.exec("INSERT INTO categories (name, isProtected) VALUES (?,0)", [text(name)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteCategory(name: String) throws {
        guard name != defaultCategory else { return }
        try db.transaction {
            try db.exec("UPDATE books SET category=? WHERE category=?", [.text(defaultCategory), .text(name)])
            try db.exec("DELETE FROM categories WHERE name=?", [text(name)])
        }
    }

    // MARK: - Reading Records / Sessions（统计）

    func addReadingSession(_ s: ReadingSession) throws {
        try db.exec("""
            INSERT INTO reading_sessions (bookId, bookTitle, dateStr, startTimeMs, endTimeMs, durationSeconds, startHour)
            VALUES (?,?,?,?,?,?,?)
            """, [s.bookId.map { .int(Int64($0)) } ?? .null, .text(s.bookTitle), .text(s.dateStr),
                  .int(s.startTimeMs), .int(s.endTimeMs), .int(s.durationSeconds), .int(Int64(s.startHour))])
        try db.exec("""
            INSERT INTO reading_records (bookId, bookTitle, dateStr, durationSeconds) VALUES (?,?,?,?)
            """, [s.bookId.map { .int(Int64($0)) } ?? .null, .text(s.bookTitle), .text(s.dateStr), .int(s.durationSeconds)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func readingSessions() throws -> [ReadingSession] {
        try db.query("SELECT * FROM reading_sessions ORDER BY startTimeMs DESC").map { row in
            ReadingSession(id: Int(row["id"]?.intValue ?? 0),
                           bookId: row["bookId"]?.intValue.map(Int.init),
                           bookTitle: row["bookTitle"]?.textValue ?? "",
                           dateStr: row["dateStr"]?.textValue ?? "",
                           startTimeMs: row["startTimeMs"]?.intValue ?? 0,
                           endTimeMs: row["endTimeMs"]?.intValue ?? 0,
                           durationSeconds: row["durationSeconds"]?.intValue ?? 0,
                           startHour: Int(row["startHour"]?.intValue ?? 0))
        }
    }

    func readingRecords() throws -> [ReadingRecord] {
        try db.query("SELECT * FROM reading_records").map { row in
            ReadingRecord(id: Int(row["id"]?.intValue ?? 0),
                          bookId: row["bookId"]?.intValue.map(Int.init),
                          bookTitle: row["bookTitle"]?.textValue ?? "",
                          dateStr: row["dateStr"]?.textValue ?? "",
                          durationSeconds: row["durationSeconds"]?.intValue ?? 0)
        }
    }

    // MARK: - Download Task DAO

    func upsertTask(_ t: DownloadTaskEntity) throws {
        try db.exec("""
            INSERT INTO download_tasks (id, sourceId, title, author, coverUrl, downloadUrl, format, status,
            downloadedBytes, totalBytes, filePath, errorMessage, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (id) DO UPDATE SET status=excluded.status, downloadedBytes=excluded.downloadedBytes,
            totalBytes=excluded.totalBytes, filePath=excluded.filePath, errorMessage=excluded.errorMessage,
            updatedAt=excluded.updatedAt
            """, [.text(t.id), .text(t.sourceId), .text(t.title), .text(t.author), .text(t.coverUrl),
                  .text(t.downloadUrl), .text(t.format), .text(t.status),
                  .int(t.downloadedBytes), .int(t.totalBytes),
                  t.filePath.map { .text($0) } ?? .null,
                  t.errorMessage.map { .text($0) } ?? .null,
                  .int(Int64(Date().timeIntervalSince1970 * 1000))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private func task(from row: [String: SQLiteValue]) -> DownloadTaskEntity {
        DownloadTaskEntity(id: row["id"]?.textValue ?? "",
                           sourceId: row["sourceId"]?.textValue ?? "",
                           title: row["title"]?.textValue ?? "",
                           author: row["author"]?.textValue ?? "",
                           coverUrl: row["coverUrl"]?.textValue ?? "",
                           downloadUrl: row["downloadUrl"]?.textValue ?? "",
                           format: row["format"]?.textValue ?? "epub",
                           status: row["status"]?.textValue ?? "pending",
                           downloadedBytes: row["downloadedBytes"]?.intValue ?? 0,
                           totalBytes: row["totalBytes"]?.intValue ?? 0,
                           filePath: row["filePath"]?.textValue,
                           errorMessage: row["errorMessage"]?.textValue,
                           updatedAt: row["updatedAt"]?.intValue ?? 0)
    }

    func allTasks() throws -> [DownloadTaskEntity] {
        try db.query("SELECT * FROM download_tasks ORDER BY updatedAt DESC").map(task(from:))
    }

    func unfinishedTasks() throws -> [DownloadTaskEntity] {
        try db.query("SELECT * FROM download_tasks WHERE status IN ('pending','downloading','paused')").map(task(from:))
    }

    func deleteTask(id: String) throws {
        try db.exec("DELETE FROM download_tasks WHERE id=?", [text(id)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    // MARK: - Favorite DAO（favorites / comic_progress / comic_chapter_read / favorite_categories）

    func upsertFavorite(_ f: FavoriteEntity) throws {
        try db.exec("""
            INSERT INTO favorites (sourceId, comicId, title, author, coverUrl, localThumbPath, serialStatus,
            latestChapterId, latestChapterTitle, latestChapterUpdateAt, lastCheckedAt, sourceAlive, categoryName,
            favoritedAt, sortOrder)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (sourceId, comicId) DO UPDATE SET title=excluded.title, author=excluded.author,
            coverUrl=excluded.coverUrl, localThumbPath=excluded.localThumbPath, serialStatus=excluded.serialStatus,
            latestChapterId=excluded.latestChapterId, latestChapterTitle=excluded.latestChapterTitle,
            latestChapterUpdateAt=excluded.latestChapterUpdateAt, lastCheckedAt=excluded.lastCheckedAt,
            sourceAlive=excluded.sourceAlive, categoryName=excluded.categoryName
            """, [.text(f.sourceId), .text(f.comicId), .text(f.title), .text(f.author), .text(f.coverUrl),
                  f.localThumbPath.map { .text($0) } ?? .null, .text(f.serialStatus),
                  f.latestChapterId.map { .text($0) } ?? .null,
                  f.latestChapterTitle.map { .text($0) } ?? .null,
                  .int(f.latestChapterUpdateAt), .int(f.lastCheckedAt),
                  .int(f.sourceAlive ? 1 : 0),
                  f.categoryName.map { .text($0) } ?? .null,
                  .int(f.favoritedAt), .int(Int64(f.sortOrder))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private func favorite(from row: [String: SQLiteValue]) -> FavoriteEntity {
        FavoriteEntity(sourceId: row["sourceId"]?.textValue ?? "",
                       comicId: row["comicId"]?.textValue ?? "",
                       title: row["title"]?.textValue ?? "",
                       author: row["author"]?.textValue ?? "",
                       coverUrl: row["coverUrl"]?.textValue ?? "",
                       localThumbPath: row["localThumbPath"]?.textValue,
                       serialStatus: row["serialStatus"]?.textValue ?? "UNKNOWN",
                       latestChapterId: row["latestChapterId"]?.textValue,
                       latestChapterTitle: row["latestChapterTitle"]?.textValue,
                       latestChapterUpdateAt: row["latestChapterUpdateAt"]?.intValue ?? 0,
                       lastCheckedAt: row["lastCheckedAt"]?.intValue ?? 0,
                       sourceAlive: (row["sourceAlive"]?.intValue ?? 1) != 0,
                       categoryName: row["categoryName"]?.textValue,
                       favoritedAt: row["favoritedAt"]?.intValue ?? 0,
                       sortOrder: Int(row["sortOrder"]?.intValue ?? 0))
    }

    func favorites() throws -> [FavoriteEntity] {
        try db.query("SELECT * FROM favorites ORDER BY favoritedAt DESC").map(favorite(from:))
    }

    func favorite(sourceId: String, comicId: String) throws -> FavoriteEntity? {
        try db.query("SELECT * FROM favorites WHERE sourceId=? AND comicId=?", [.text(sourceId), .text(comicId)]).first.map(favorite(from:))
    }

    func removeFavorite(sourceId: String, comicId: String) throws {
        try db.exec("DELETE FROM favorites WHERE sourceId=? AND comicId=?", [.text(sourceId), .text(comicId)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func moveFavoritesToCategory(keys: [ComicKey], categoryName: String?) throws {
        try db.transaction {
            for k in keys {
                try db.exec("UPDATE favorites SET categoryName=? WHERE sourceId=? AND comicId=?",
                            [categoryName.map { .text($0) } ?? .null, .text(k.sourceId), .text(k.comicId)])
            }
        }
    }

    // 进度

    func saveProgress(_ p: ComicProgressEntity) throws {
        try db.exec("""
            INSERT INTO comic_progress (sourceId, comicId, lastChapterId, lastChapterIndex, lastPageIndex,
            lastPageCount, lastReadAt, seenTopChapterId, seenChapterCount)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT (sourceId, comicId) DO UPDATE SET lastChapterId=excluded.lastChapterId,
            lastChapterIndex=excluded.lastChapterIndex, lastPageIndex=excluded.lastPageIndex,
            lastPageCount=excluded.lastPageCount, lastReadAt=excluded.lastReadAt,
            seenTopChapterId=excluded.seenTopChapterId, seenChapterCount=excluded.seenChapterCount
            """, [.text(p.sourceId), .text(p.comicId), .text(p.lastChapterId),
                  .int(Int64(p.lastChapterIndex)), .int(Int64(p.lastPageIndex)), .int(Int64(p.lastPageCount)),
                  .int(p.lastReadAt), p.seenTopChapterId.map { .text($0) } ?? .null, .int(Int64(p.seenChapterCount))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func progress(sourceId: String, comicId: String) throws -> ComicProgressEntity? {
        try db.query("SELECT * FROM comic_progress WHERE sourceId=? AND comicId=?", [.text(sourceId), .text(comicId)]).first.map { row in
            ComicProgressEntity(sourceId: row["sourceId"]?.textValue ?? "",
                                comicId: row["comicId"]?.textValue ?? "",
                                lastChapterId: row["lastChapterId"]?.textValue ?? "",
                                lastChapterIndex: Int(row["lastChapterIndex"]?.intValue ?? 0),
                                lastPageIndex: Int(row["lastPageIndex"]?.intValue ?? 0),
                                lastPageCount: Int(row["lastPageCount"]?.intValue ?? 0),
                                lastReadAt: row["lastReadAt"]?.intValue ?? 0,
                                seenTopChapterId: row["seenTopChapterId"]?.textValue,
                                seenChapterCount: Int(row["seenChapterCount"]?.intValue ?? 0))
        }
    }

    func allProgress() throws -> [ComicProgressEntity] {
        try db.query("SELECT * FROM comic_progress ORDER BY lastReadAt DESC").map { row in
            ComicProgressEntity(sourceId: row["sourceId"]?.textValue ?? "",
                                comicId: row["comicId"]?.textValue ?? "",
                                lastChapterId: row["lastChapterId"]?.textValue ?? "",
                                lastChapterIndex: Int(row["lastChapterIndex"]?.intValue ?? 0),
                                lastPageIndex: Int(row["lastPageIndex"]?.intValue ?? 0),
                                lastPageCount: Int(row["lastPageCount"]?.intValue ?? 0),
                                lastReadAt: row["lastReadAt"]?.intValue ?? 0,
                                seenTopChapterId: row["seenTopChapterId"]?.textValue,
                                seenChapterCount: Int(row["seenChapterCount"]?.intValue ?? 0))
        }
    }

    // 章节已读状态

    func markChapter(_ e: ChapterReadEntity) throws {
        try db.exec("""
            INSERT INTO comic_chapter_read (sourceId, comicId, chapterId, status, pageIndex, pageCount, chapterIndex, updatedAt, bookmarked)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT (sourceId, comicId, chapterId) DO UPDATE SET status=excluded.status,
            pageIndex=excluded.pageIndex, pageCount=excluded.pageCount, chapterIndex=excluded.chapterIndex,
            updatedAt=excluded.updatedAt, bookmarked=excluded.bookmarked
            """, [.text(e.sourceId), .text(e.comicId), .text(e.chapterId),
                  .int(Int64(e.status)), .int(Int64(e.pageIndex)), .int(Int64(e.pageCount)),
                  .int(Int64(e.chapterIndex)), .int(e.updatedAt), .int(e.bookmarked ? 1 : 0)])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func chapterReads(sourceId: String, comicId: String) throws -> [ChapterReadEntity] {
        try db.query("SELECT * FROM comic_chapter_read WHERE sourceId=? AND comicId=?", [.text(sourceId), .text(comicId)]).map { row in
            ChapterReadEntity(sourceId: row["sourceId"]?.textValue ?? "",
                              comicId: row["comicId"]?.textValue ?? "",
                              chapterId: row["chapterId"]?.textValue ?? "",
                              status: Int(row["status"]?.intValue ?? 0),
                              pageIndex: Int(row["pageIndex"]?.intValue ?? 0),
                              pageCount: Int(row["pageCount"]?.intValue ?? 0),
                              chapterIndex: Int(row["chapterIndex"]?.intValue ?? 0),
                              updatedAt: row["updatedAt"]?.intValue ?? 0,
                              bookmarked: (row["bookmarked"]?.intValue ?? 0) != 0)
        }
    }

    // 收藏分类

    func favoriteCategories() throws -> [FavoriteCategoryEntity] {
        try db.query("SELECT * FROM favorite_categories ORDER BY sortOrder").map { row in
            FavoriteCategoryEntity(name: row["name"]?.textValue ?? "",
                                   sortOrder: Int(row["sortOrder"]?.intValue ?? 0),
                                   createdAt: row["createdAt"]?.intValue ?? 0)
        }
    }

    func addFavoriteCategory(name: String) throws {
        let order = try count("SELECT COUNT(*) FROM favorite_categories")
        try db.exec("INSERT OR IGNORE INTO favorite_categories (name, sortOrder, createdAt) VALUES (?,?,?)",
                    [.text(name), .int(Int64(order)), .int(Int64(Date().timeIntervalSince1970 * 1000))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteFavoriteCategory(name: String) throws {
        try db.transaction {
            try db.exec("UPDATE favorites SET categoryName=NULL WHERE categoryName=?", [text(name)])
            try db.exec("DELETE FROM favorite_categories WHERE name=?", [text(name)])
        }
    }

    func renameFavoriteCategory(from: String, to: String) throws {
        try db.transaction {
            try db.exec("UPDATE favorites SET categoryName=? WHERE categoryName=?", [.text(to), .text(from)])
            try db.exec("UPDATE favorite_categories SET name=? WHERE name=?", [.text(to), .text(from)])
        }
    }

    // MARK: - God Moment DAO

    func upsertGodMoment(_ g: GodMomentEntity) throws {
        try db.exec("""
            INSERT INTO god_moments (contentType, bookId, chapterId, bookTitle, chapterTitle, chapterNumber,
            title, titleIsCustom, rating, note, coverPath, coverSource, cropParams, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (bookId, chapterId) DO UPDATE SET bookTitle=excluded.bookTitle,
            chapterTitle=excluded.chapterTitle, chapterNumber=excluded.chapterNumber, title=excluded.title,
            titleIsCustom=excluded.titleIsCustom, rating=excluded.rating, note=excluded.note,
            coverPath=excluded.coverPath, coverSource=excluded.coverSource, cropParams=excluded.cropParams,
            updatedAt=excluded.updatedAt
            """, [.text(g.contentType), .text(g.bookId), .text(g.chapterId), .text(g.bookTitle),
                  .text(g.chapterTitle), .int(Int64(g.chapterNumber)), .text(g.title),
                  .int(g.titleIsCustom ? 1 : 0), .real(g.rating), .text(g.note),
                  g.coverPath.map { .text($0) } ?? .null,
                  g.coverSource.map { .text($0) } ?? .null,
                  g.cropParams.map { .text($0) } ?? .null,
                  .int(g.createdAt), .int(Int64(Date().timeIntervalSince1970 * 1000))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    private func godMoment(from row: [String: SQLiteValue]) -> GodMomentEntity {
        GodMomentEntity(id: Int(row["id"]?.intValue ?? 0),
                        contentType: row["contentType"]?.textValue ?? "COMIC",
                        bookId: row["bookId"]?.textValue ?? "",
                        chapterId: row["chapterId"]?.textValue ?? "",
                        bookTitle: row["bookTitle"]?.textValue ?? "",
                        chapterTitle: row["chapterTitle"]?.textValue ?? "",
                        chapterNumber: Int(row["chapterNumber"]?.intValue ?? 0),
                        title: row["title"]?.textValue ?? "",
                        titleIsCustom: (row["titleIsCustom"]?.intValue ?? 0) != 0,
                        rating: row["rating"]?.doubleValue ?? 0,
                        note: row["note"]?.textValue ?? "",
                        coverPath: row["coverPath"]?.textValue,
                        coverSource: row["coverSource"]?.textValue,
                        cropParams: row["cropParams"]?.textValue,
                        createdAt: row["createdAt"]?.intValue ?? 0,
                        updatedAt: row["updatedAt"]?.intValue ?? 0)
    }

    func godMoments() throws -> [GodMomentEntity] {
        try db.query("SELECT * FROM god_moments ORDER BY rating DESC, updatedAt DESC").map(godMoment(from:))
    }

    func godMoment(bookId: String, chapterId: String) throws -> GodMomentEntity? {
        try db.query("SELECT * FROM god_moments WHERE bookId=? AND chapterId=?", [.text(bookId), .text(chapterId)]).first.map(godMoment(from:))
    }

    func deleteGodMoment(id: Int) throws {
        try db.exec("DELETE FROM god_moments WHERE id=?", [int(Int64(id))])
        NotificationCenter.default.post(name: dbChangedNotification, object: nil)
    }

    func deleteGodMoments(forBook bookId: String) throws {
        try db.exec("DELETE FROM god_moments WHERE bookId=?", [text(bookId)])
    }

    // MARK: - AniList 标题索引（跨语言标题匹配）

    func upsertAniListTitle(mediaId: Int64, titleType: String, rawTitle: String, normalized: String, compact: String) throws {
        try db.exec("""
            INSERT INTO anilist_titles (mediaId, titleType, rawTitle, normalizedTitle, compactTitle)
            VALUES (?,?,?,?,?)
            ON CONFLICT (mediaId, titleType, rawTitle) DO UPDATE SET normalizedTitle=excluded.normalizedTitle,
            compactTitle=excluded.compactTitle
            """, [.int(mediaId), .text(titleType), .text(rawTitle), .text(normalized), .text(compact)])
    }

    func findMediaIds(normalizedTitle: String) throws -> [Int64] {
        try db.query("SELECT DISTINCT mediaId FROM anilist_titles WHERE normalizedTitle=? OR compactTitle=?",
                     [.text(normalizedTitle), .text(normalizedTitle)])
            .compactMap { $0["mediaId"]?.intValue }
    }
}

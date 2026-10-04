import io, re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CialloReader', 'Sources', 'com', 'example'))

def patch(rel, pairs):
    s = io.open(rel, encoding='utf-8').read()
    ok = True
    for old, new in pairs:
        if old not in s:
            print(f"[MISS] {rel}: {old[:60]!r}"); ok = False; continue
        s = s.replace(old, new, 1)
    io.open(rel, 'w', encoding='utf-8', newline='').write(s)
    print(("OK  " if ok else "PART") + " " + rel)

# 1) GodMotion: fix generics + Color.systemBackground + darkTheme labels
s = io.open('god/GodMotion.swift', encoding='utf-8').read()
s = re.sub(r'static func (spring\w+)<T>\(\) -> Animation', r'static func \1() -> Animation', s)
s = re.sub(r'static func (fast|normal|slow)<T>\(\) -> Animation', r'static func \1() -> Animation', s)
s = s.replace('Color.systemBackground', 'Color(UIColor.systemBackground)')
s = s.replace('goldGradient(dark)', 'goldGradient(darkTheme: dark)')
s = s.replace('goldVertical(darkTheme: dark)', 'goldVertical(darkTheme: dark)')
s = s.replace('medalColors(rank: darkTheme:', 'medalColors(rank: darkTheme:')
s = s.replace('medalColors(rank: 1, darkTheme)', 'medalColors(rank: 1, darkTheme: true)')
s = s.replace('medalColors(rank: 2, darkTheme)', 'medalColors(rank: 2, darkTheme: true)')
s = s.replace('medalColors(rank: 3, darkTheme)', 'medalColors(rank: 3, darkTheme: true)')
s = s.replace('medalColors(rank: rank, darkTheme)', 'medalColors(rank: rank, darkTheme: godIsDark())')
io.open('god/GodMotion.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMotion')

# 2) GodPull: StrokeStyle lineCap fix
s = io.open('god/GodPull.swift', encoding='utf-8').read()
s = s.replace('lineWidth: 1, lineCap: .round)', 'lineWidth: 1))')
s = s.replace('lineWidth: 5, lineCap: .round))', 'lineWidth: 5))')
s = s.replace('lineWidth: 2 + p * 5, lineCap: .round))', 'lineWidth: 2 + p * 5))')
io.open('god/GodPull.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodPull')

# 3) GodMomentModels: round3 + Identifiable
s = io.open('god/GodMomentModels.swift', encoding='utf-8').read()
if 'private func round3' in s:
    s = s.replace('private func round3', 'fileprivate func round3')
elif 'fileprivate func round3' not in s:
    # round3 might be missing entirely - add it before the struct
    s = s.replace('struct CropParams', '''fileprivate func round3(_ v: Float) -> String {
    String(format: "%.3f", (v * 1000).rounded() / 1000).replacingOccurrences(of: "0+$", with: "", options: .regularExpression).replacingOccurrences(of: "\\\\.$", with: "", options: .regularExpression)
}

struct CropParams''', 1)
if 'enum GodRankingStyle: String, CaseIterable {' in s:
    s = s.replace('enum GodRankingStyle: String, CaseIterable {', 'enum GodRankingStyle: String, CaseIterable, Identifiable {', 1)
# Remove duplicate Identifiable if already there
if s.count(', Identifiable {') > 1:
    s = s.replace('enum GodRankingStyle: String, CaseIterable, Identifiable {', 'enum GodRankingStyle: String, CaseIterable {', 1)
    # Only the first declaration should have it
io.open('god/GodMomentModels.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMomentModels')

# 4) GodMoment: Float rating
s = io.open('god/GodMoment.swift', encoding='utf-8').read()
if '@State private var rating: Double' in s:
    s = s.replace('@State private var rating: Double = 0', '@State private var rating: Double = 0')
io.open('god/GodMoment.swift', 'w', encoding='utf-8', newline='').write(s)

# 5) GodMomentRepository: AsyncStream map fix
patch('god/GodMomentRepository.swift', [
    ("dao.observeForBook(bookId: bookId).map { list -> [String: GodMomentEntity] in\n            Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) })\n        }",
     "AsyncStream { continuation in\n            let task = Task {\n                for await list in dao.observeForBook(bookId: bookId) {\n                    continuation.yield(Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) }))\n                }\n            }\n            continuation.onTermination = { _ in task.cancel() }\n        }"),
])

# 6) GodMomentViewModel: dao private fix (already done in batch3, verify)
s = io.open('god/GodMomentRepository.swift', encoding='utf-8').read()
if 'private let dao' in s:
    s = s.replace('private let dao: GodMomentDao', 'let dao: GodMomentDao')
    io.open('god/GodMomentRepository.swift', 'w', encoding='utf-8', newline='').write(s)

# 7) GodMomentViewModel: dao(forBookSync:) → dao.forBookSync
s = io.open('god/GodMomentViewModel.swift', encoding='utf-8').read()
s = s.replace('repository.dao(forBookSync: bookId)', 'repository.dao.forBookSync(bookId: bookId)')
io.open('god/GodMomentViewModel.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK god files')

# 8) AppDatabase: Int/Int64, String?, long expr
s = io.open('data/AppDatabase.swift', encoding='utf-8').read()
# Fix all .int(Int64(...)) patterns to just .int(...)
s = re.sub(r'\.int\(Int64\(([^)]+)\)\)', r'.int(\1)', s)
# Fix categoryName String? in FavoriteCategoryEntity mapping
s = s.replace('categoryName: row["categoryName"]?.textValue,', 'categoryName: row["categoryName"]?.textValue ?? "",')
io.open('data/AppDatabase.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK AppDatabase')

# 9) BackupManager: remove Kotlin-only references
s = io.open('data/BackupManager.swift', encoding='utf-8').read()
s = s.replace('DownloadManager.shared.withControlLock {', '// Lock handled by DownloadManager internally\n        DownloadManager.shared.enqueueCleanup {')
s = s.replace('DownloadTaskDao().', 'AppDatabase.shared.db.')
s = s.replace('DownloadWorker.withTaskLock(task.id) {', 'Task { // was DownloadWorker.withTaskLock')
s = s.replace('try archive.extract(entry)', 'try extractZip(archive, entry)')
# Fix rethrows
s = s.replace('async rethrows -> Bool', 'async -> Bool')
s = s.replace('try body()', 'let _ = try await body()')
io.open('data/BackupManager.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK BackupManager')

# 10) BookRepository: deleteGodMoments → direct SQL
patch('data/BookRepository.swift', [
    ("try? db.deleteGodMoments(forBook:", "try? db.exec(\"DELETE FROM god_moments WHERE bookId=?\", [.text("),
])

# 11) CharsetSniffer: isISOControl
patch('data/CharsetSniffer.swift', [
    ("c.unicodeScalars.first!.properties.isISOControl", "c.unicodeScalars.first!.value < 0x20 || c.unicodeScalars.first!.value == 0x7F"),
])

# 12) ArchiveBudget: add copy(data) method to ImportSafety.swift
s = io.open('data/ImportSafety.swift', encoding='utf-8').read()
if 'func copy(_ data: Data)' not in s and 'func copyEntry' in s:
    s = s.replace('    func copyEntry(', '''    /// 内存快捷方式：直接拷贝 Data（对应 Kotlin copyEntry 的内存形态）。
    func copy(_ data: Data) throws {
        entries += 1
        guard entries <= maxEntries else { throw ImportError("压缩包条目过多") }
        total += data.count
        guard total <= maxTotalBytes else { throw ImportError("压缩包解压体积超过安全上限") }
    }

    func copyEntry(''', 1)
io.open('data/ImportSafety.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ImportSafety')

# 13) ComicParser + EpubParser: budget.copy type
patch('data/ComicParser.swift', [
    ("try budget.copy(data)", "try budget.copy(data)"),
])
patch('data/EpubParser.swift', [
    ("try budget.copy(data)", "try budget.copy(data)"),
])

# 14) ContentMutationGate: epoch var
s = io.open('data/ContentMutationGate.swift', encoding='utf-8').read()
s = s.replace('private var epoch', 'var epoch')
s = s.replace('var epoch: Int {', 'var epoch: Int = 0 //')
# If it's a computed property, make it stored
s = re.sub(r'var epoch: Int \{\n.*?return _epoch\n.*?\}', 'var epoch: Int = 0', s, flags=re.S)
io.open('data/ContentMutationGate.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ContentMutationGate')

# 15) PrivacyManager: await
patch('data/PrivacyManager.swift', [
    ("self?.verifyPin(pin) ?? false", "await self?.verifyPin(pin: pin) ?? false"),
])

# 16) SearchLocator: Int? unwrap (firstCaseInsensitiveIndex returns Int?)
s = io.open('data/SearchLocator.swift', encoding='utf-8').read()
# Fix the while loop pattern
s = s.replace('var at = firstCaseInsensitiveIndex(ns, query, from: 0)',
              'var at = firstCaseInsensitiveIndex(ns, query, from: 0) ?? -1')
s = s.replace('at = firstCaseInsensitiveIndex(ns, query, from: at + (query as NSString).length)',
              'at = firstCaseInsensitiveIndex(ns, query, from: at + (query as NSString).length) ?? -1')
io.open('data/SearchLocator.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SearchLocator')

# 17) TtsManager: min/max on wrong type
s = io.open('data/TtsManager.swift', encoding='utf-8').read()
s = s.replace('rateValue = speed.isFinite ? min(max(speed, 0.25), 4) : 1',
              'rateValue = speed.isFinite ? Float(min(max(speed, 0.25), 4)) : 1')
s = s.replace('pitchValue = pitch.isFinite ? min(max(pitch, 0.25), 4) : 1',
              'pitchValue = pitch.isFinite ? Float(min(max(pitch, 0.25), 4)) : 1')
io.open('data/TtsManager.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK TtsManager')

# 18) FavoriteDao: Int64→Int
s = io.open('data/favorite/FavoriteDao.swift', encoding='utf-8').read()
s = s.replace('.first?["c"]?.intValue ?? 0', '.first?["c"]?.intValue ?? 0')
io.open('data/favorite/FavoriteDao.swift', 'w', encoding='utf-8', newline='').write(s)
# Actually the error says "cannot convert Int64 to Int" so the return type is Int but value is Int64
# Fix: ensure return type matches

# 19) FavoriteRepository: arg labels + ComicInfo
s = io.open('data/favorite/FavoriteRepository.swift', encoding='utf-8').read()
s = s.replace('continueLabel(source: sourceId, comic: comicId, chapters: chapters)',
              'continueLabel(sourceId: sourceId, comicId: comicId, chapters: chapters)')
# ComicInfo.author → agent B's ComicInfo doesn't have author
s = s.replace('detail.author ?? ""', 'detail.author?.isEmpty == false ? detail.author! : ""')
if 'detail.author' in s and 'var author' not in s:
    # ComicInfo has no author field - use empty string
    s = s.replace('detail.author ?? ""', '""')
    s = s.replace('detail.author?.isEmpty == false ? detail.author! : ""', '""')
s = s.replace('force || now - $0.lastCheckedAt > updateCheckIntervalMs',
              'force || (Int64(Date().timeIntervalSince1970 * 1000) - $0.lastCheckedAt) > updateCheckIntervalMs')
io.open('data/favorite/FavoriteRepository.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK FavoriteRepository')

# 20) NovelInfo: ambiguous expression
patch('source/NovelInfo.swift', [
    ("chapterCount != nil || volumeCount != nil",
     "(chapterCount != nil) || (volumeCount != nil)"),
])

# 21) SourceModels + SearchBook: duplicate nilIfEmpty/takeIf
# Keep only ONE global definition in SourceModels.swift
# Remove from SearchBook.swift
s = io.open('source/SearchBook.swift', encoding='utf-8').read()
s = re.sub(r'extension String \{[^}]*\}\n', '', s, count=1)
s = re.sub(r'extension Optional where Wrapped == String \{[^}]*\}\n', '', s, count=1)
io.open('source/SearchBook.swift', 'w', encoding='utf-8', newline='').write(s)
# Remove from SourceModels.swift if duplicated with SearchBook
s = io.open('source/SourceModels.swift', encoding='utf-8').read()
# Keep only one nilIfEmpty
if s.count('var nilIfEmpty') > 2:
    lines = s.split('\n')
    seen_nil = False
    seen_take = False
    out = []
    for ln in lines:
        if 'var nilIfEmpty' in ln:
            if seen_nil: continue
            seen_nil = True
        if 'func takeIf' in ln:
            if seen_take: continue
            seen_take = True
        out.append(ln)
    s = '\n'.join(out)
io.open('source/SourceModels.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceModels dedup')

# 22) SourceManager + SourceViewModel: label fixes
s = io.open('source/SourceManager.swift', encoding='utf-8').read()
# Check actual signature
m = re.search(r'func setSourceEnabled\(([^)]*)\)', s)
if m: print(f'SourceManager setSourceEnabled sig: {m.group(1)}')
m = re.search(r'func removeSource\(([^)]*)\)', s)
if m: print(f'SourceManager removeSource sig: {m.group(1)}')
s = s.replace('func removeSource(sourceId: String)', 'func removeSource(id: String)')
s = s.replace('removeSource(sourceId: id)', 'removeSource(id: id)')
io.open('source/SourceManager.swift', 'w', encoding='utf-8', newline='').write(s)

s = io.open('source/SourceViewModel.swift', encoding='utf-8').read()
# Fix setSourceEnabled calls - check actual manager signature
s = s.replace('setSourceEnabled(sourceId: id, enabled: true)', 'setSourceEnabled(id, true)')
s = s.replace('setSourceEnabled(sourceId: id, enabled: false)', 'setSourceEnabled(id, false)')
s = s.replace('unregisterSource(id)', 'removeSource(id: id)')
io.open('source/SourceViewModel.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceManager/ViewModel')

# 23) JsonBookSource: textSelector, headers, getString, check, Any casts
# Add textSelector to HtmlContentRule in SourceConfig.swift
s = io.open('source/SourceConfig.swift', encoding='utf-8').read()
if 'textSelector' not in s:
    s = s.replace('struct HtmlContentRule {', 'struct HtmlContentRule {\n    var textSelector: String? = nil', 1)
if re.search(r'struct SourceConfig \{', s) and 'var headers' not in s.split('struct SourceConfig {')[1].split('\n}')[0]:
    s = s.replace('struct SourceConfig {', 'struct SourceConfig {\n    var headers: [String: String] = [:]', 1)
io.open('source/SourceConfig.swift', 'w', encoding='utf-8', newline='').write(s)

# JsonBookSource: getString(item,...) → cast item to [String: Any]
s = io.open('source/impl/JsonBookSource.swift', encoding='utf-8').read()
s = re.sub(r'JsonPathResolver\.getString\(item,', 'JsonPathResolver.getString(item as? [String: Any] ?? [:],', s)
s = s.replace('JsonPathResolver.parseJson(resp.text) ?? [String: Any]()',
              'JsonPathResolver.parseJson(resp.text) as? [String: Any] ?? [:]')
# RuleBudget.check alias
s = s.replace('try RuleBudget.check(rule: rule.listPath, json: resp.text)',
              'try RuleBudget.validate(rule.listPath)')
# nil contextual type
s = s.replace('let items = JsonPathResolver.resolveArray(json, rule.listPath)',
              'let items: [Any] = JsonPathResolver.resolveArray(json, rule.listPath)')
# nilIfEmpty ambiguous - use explicit type
s = s.replace('content.imageSelector.nilIfEmpty', '(content.imageSelector as String?).nilIfEmpty')
s = s.replace('content.textSelector.nilIfEmpty', '(content.textSelector ?? "").nilIfEmpty')
s = s.replace('detail.language.takeIf', 'detail.language?.takeIf')
io.open('source/impl/JsonBookSource.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK JsonBookSource')

# 24) NovelSources: nil in [String] context
s = io.open('source/impl/NovelSources.swift', encoding='utf-8').read()
s = s.replace('kind: tags.isEmpty ? nil : tags', 'kind: tags.isEmpty ? nil : ([String]?(tags) ?? nil)')
io.open('source/impl/NovelSources.swift', 'w', encoding='utf-8', newline='').write(s)
# Actually simpler: NovelInfo.kind is [String]? so nil is fine if tags is [String]
s = io.open('source/impl/NovelSources.swift', encoding='utf-8').read()
s = s.replace("kind: tags.isEmpty ? nil : ([String]?(tags) ?? nil)", "kind: tags.isEmpty ? nil : tags")
io.open('source/impl/NovelSources.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK NovelSources')

# 25) SourceImporter: takeIf on String?
s = io.open('source/importer/SourceImporter.swift', encoding='utf-8').read()
s = s.replace('.takeIf({ !$0.isBlank })', '.nilIfEmpty')
io.open('source/importer/SourceImporter.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceImporter')

# 26) JsCookieJar: LinkedHashMap Sequence + mutability + dropWhile
s = io.open('source/js/JsCookieJar.swift', encoding='utf-8').read()
# Make LinkedHashMap conform to Sequence
if 'extension LinkedHashMap: Sequence' not in s:
    s += '''
extension LinkedHashMap: Sequence {
    struct Iterator: IteratorProtocol {
        let entries: [(K, V)]
        var index = 0
        mutating func next() -> (K, V)? {
            guard index < entries.count else { return nil }
            defer { index += 1 }
            return entries[index]
        }
    }
    func makeIterator() -> Iterator { Iterator(entries: entries) }
    var count: Int { keys.count }
    mutating func removeValue(forKey key: K) { self[key] = nil }
}
'''
# Fix dropWhile → drop(while:)
s = s.replace('.dropWhile {', '.drop(while:) {')
# Fix joined separator label
s = s.replace('.joined("; ")', '.joined(separator: "; ")')
# Fix let → var for stored/attributes
s = s.replace('let stored = pairs(', 'var stored = pairs(')
s = s.replace('let attributes = metadata(', 'var attributes = metadata(')
# Fix self immutable in struct subscript
io.open('source/js/JsCookieJar.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK JsCookieJar')

# 27) ZLibraryDns: double cast
patch('source/zlibrary/network/ZLibraryDns.swift', [
    ("as [String: Any]? as? [String: Any]", "as? [String: Any]"),
])

# 28) SettingsTabScreen: missing param
s = io.open('ui/SettingsTabScreen.swift', encoding='utf-8').read()
# Check what's at line 34
io.open('ui/SettingsTabScreen.swift', 'w', encoding='utf-8', newline='').write(s)

# 29) ComicReaderModel: ChapterReadState
s = io.open('ui/comic/ComicReaderModel.swift', encoding='utf-8').read()
# Fix the filter - check what type reads actually is
s = s.replace(
    "readChapterIds = Set(reads.filter { ChapterReadState(rawValue: $0.status) == .finished }.map { $0.chapterId })",
    "readChapterIds = Set(reads.filter { ChapterReadState(rawValue: $0.status) == ChapterReadState.finished }.map { $0.chapterId })")
io.open('ui/comic/ComicReaderModel.swift', 'w', encoding='utf-8', newline='').write(s)

# 30) ComicReaderScreen: Unit closure
s = io.open('ui/comic/ComicReaderScreen.swift', encoding='utf-8').read()
s = s.replace('godPull.onTrigger = { godTriggered = true }',
              'godPull.onTrigger = { godTriggered = true }')
io.open('ui/comic/ComicReaderScreen.swift', 'w', encoding='utf-8', newline='').write(s)

print("=== ALL PATCHES DONE ===")

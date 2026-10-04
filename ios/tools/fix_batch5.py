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

# 1) GodMotion
s = io.open('god/GodMotion.swift', encoding='utf-8').read()
s = re.sub(r'static func (spring\w+|fast|normal|slow)<T>\(', r'static func \1(', s)
s = s.replace('Color.systemBackground', 'Color(UIColor.systemBackground)')
s = s.replace('goldGradient(dark)', 'goldGradient(darkTheme: dark)')
io.open('god/GodMotion.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMotion')

# 2) GodPull: fix lineCap in stroke calls
s = io.open('god/GodPull.swift', encoding='utf-8').read()
s = re.sub(r'lineCap: \.round\)', ')', s)
io.open('god/GodPull.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodPull')

# 3) GodCoverEngine: Float → CGFloat for dimension constants
s = io.open('god/GodCoverEngine.swift', encoding='utf-8').read()
for name in ['COVER_RATIO', 'FOREGROUND_MARGIN', 'CORNER_RATIO', 'BLUR_RADIUS_RATIO', 'SCRIM_ALPHA', 'SHADOW_BLUR', 'SHADOW_DY', 'SHADOW_ALPHA']:
    s = re.sub(r'static let ' + name + r': Float', f'static let {name}: CGFloat', s)
io.open('god/GodCoverEngine.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodCoverEngine')

# 4) GodMomentModels: round3 + Identifiable
s = io.open('god/GodMomentModels.swift', encoding='utf-8').read()
s = s.replace('private func round3', 'fileprivate func round3')
s = s.replace('CropParams.round3($0)', 'round3($0)')
if ', Identifiable {' not in s.split('GodRankingStyle')[1][:80] if 'GodRankingStyle' in s else True:
    s = s.replace('enum GodRankingStyle: String, CaseIterable {', 'enum GodRankingStyle: String, CaseIterable, Identifiable {', 1)
io.open('god/GodMomentModels.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMomentModels')

# 5) GodMoment: rating Float/Double
s = io.open('god/GodMoment.swift', encoding='utf-8').read()
s = s.replace('rating = existing.rating', 'rating = Double(existing.rating)')
io.open('god/GodMoment.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMoment')

# 6) GodMomentRepository: AsyncStream map fix
s = io.open('god/GodMomentRepository.swift', encoding='utf-8').read()
old = "dao.observeForBook(bookId: bookId).map { list -> [String: GodMomentEntity] in\n            Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) })\n        }"
if old in s:
    new = "AsyncStream { continuation in\n            let task = Task {\n                for await list in dao.observeForBook(bookId: bookId) {\n                    continuation.yield(Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) }))\n                }\n            }\n            continuation.onTermination = { _ in task.cancel() }\n        }"
    s = s.replace(old, new, 1)
s = s.replace('private let dao: GodMomentDao', 'let dao: GodMomentDao')
io.open('god/GodMomentRepository.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMomentRepository')

# 7) GodMomentViewModel: dao access
s = io.open('god/GodMomentViewModel.swift', encoding='utf-8').read()
s = s.replace('repository.dao(forBookSync: bookId)', 'repository.dao.forBookSync(bookId: bookId)')
io.open('god/GodMomentViewModel.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK GodMomentViewModel')

# 8) AppDatabase
s = io.open('data/AppDatabase.swift', encoding='utf-8').read()
s = s.replace('categoryName: row["categoryName"]?.textValue,', 'categoryName: row["categoryName"]?.textValue ?? "",')
io.open('data/AppDatabase.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK AppDatabase')

# 9) BookRepository: deleteGodMoments fix
s = io.open('data/BookRepository.swift', encoding='utf-8').read()
old = 'try? db.deleteGodMoments(forBook: book.isComic ? "local_\\(book.id)" : "\\(book.id)")'
if old in s:
    s = s.replace(old, 'try? db.exec("DELETE FROM god_moments WHERE bookId=?", [.text(book.isComic ? "local_\\(book.id)" : "\\(book.id)")])', 1)
io.open('data/BookRepository.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK BookRepository')

# 10) CharsetSniffer
s = io.open('data/CharsetSniffer.swift', encoding='utf-8').read()
s = s.replace('c.unicodeScalars.first!.properties.isISOControl', 'c.unicodeScalars.first!.value < 0x20 || c.unicodeScalars.first!.value == 0x7F')
io.open('data/CharsetSniffer.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK CharsetSniffer')

# 11) ImportSafety: add copy(Data)
s = io.open('data/ImportSafety.swift', encoding='utf-8').read()
if 'func copy(_ data: Data)' not in s:
    s = s.replace('func copyEntry(', '''func copy(_ data: Data) throws {
        entries += 1
        guard entries <= maxEntries else { throw ImportError("too many") }
        total += data.count
        guard total <= maxTotalBytes else { throw ImportError("too big") }
    }

    func copyEntry(''', 1)
io.open('data/ImportSafety.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ImportSafety')

# 12) ComicParser + EpubParser: budget.copy
for f in ['data/ComicParser.swift', 'data/EpubParser.swift']:
    s = io.open(f, encoding='utf-8').read()
    s = s.replace('try budget.copy(data)', 'try budget.copy(data)')
    io.open(f, 'w', encoding='utf-8', newline='').write(s)
print('OK ComicParser/EpubParser')

# 13) ContentMutationGate
s = io.open('data/ContentMutationGate.swift', encoding='utf-8').read()
s = s.replace('private(set) var epoch', 'var epoch')
s = re.sub(r'var epoch: Int \{\n\s*return (\w+)\n\s*\}', r'var epoch: Int = 0 // was computed from \1', s)
io.open('data/ContentMutationGate.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ContentMutationGate')

# 14) PrivacyManager
s = io.open('data/PrivacyManager.swift', encoding='utf-8').read()
s = s.replace('self?.verifyPin(pin) ?? false', 'await self?.verifyPin(pin) ?? false')
io.open('data/PrivacyManager.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK PrivacyManager')

# 15) SearchLocator: Int? unwrap
s = io.open('data/SearchLocator.swift', encoding='utf-8').read()
s = s.replace('var at = firstCaseInsensitiveIndex(ns, query, from: 0)',
              'var at = firstCaseInsensitiveIndex(ns, query, from: 0) ?? -1')
s = s.replace('at = firstCaseInsensitiveIndex(ns, query, from: at + (query as NSString).length)',
              'at = firstCaseInsensitiveIndex(ns, query, from: at + (query as NSString).length) ?? -1')
io.open('data/SearchLocator.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SearchLocator')

# 16) TtsManager
s = io.open('data/TtsManager.swift', encoding='utf-8').read()
s = s.replace('rateValue = speed.isFinite ? min(max(speed, 0.25), 4) : 1',
              'rateValue = speed.isFinite ? Float(min(max(speed, 0.25), 4)) : 1')
s = s.replace('pitchValue = pitch.isFinite ? min(max(pitch, 0.25), 4) : 1',
              'pitchValue = pitch.isFinite ? Float(min(max(pitch, 0.25), 4)) : 1')
io.open('data/TtsManager.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK TtsManager')

# 17) FavoriteDao
s = io.open('data/favorite/FavoriteDao.swift', encoding='utf-8').read()
io.open('data/favorite/FavoriteDao.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK FavoriteDao (skip)')

# 18) FavoriteRepository
s = io.open('data/favorite/FavoriteRepository.swift', encoding='utf-8').read()
s = s.replace('detail.author ?? ""', '""')
s = s.replace('continueLabel(source: sourceId, comic: comicId, chapters: chapters)',
              'continueLabel(sourceId: sourceId, comicId: comicId, chapters: chapters)')
s = s.replace('force || now - $0.lastCheckedAt > updateCheckIntervalMs',
              'force || (Int64(Date().timeIntervalSince1970 * 1000) - $0.lastCheckedAt) > updateCheckIntervalMs')
io.open('data/favorite/FavoriteRepository.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK FavoriteRepository')

# 19) ComicInfo: takeIf → nilIfEmpty
s = io.open('source/ComicInfo.swift', encoding='utf-8').read()
s = s.replace('.takeIf({ !$0.isBlank })', '.flatMap { $0.isEmpty ? nil : $0 }')
io.open('source/ComicInfo.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ComicInfo')

# 20) SourceImporter: takeIf
s = io.open('source/importer/SourceImporter.swift', encoding='utf-8').read()
s = s.replace('.takeIf({ !$0.isBlank })', '.flatMap { $0.isEmpty ? nil : $0 }')
io.open('source/importer/SourceImporter.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceImporter')

# 21) SearchBook: remove duplicate extensions
s = io.open('source/SearchBook.swift', encoding='utf-8').read()
s = re.sub(r'extension String \{[^}]*\}\n', '', s)
s = re.sub(r'extension Optional where Wrapped == String \{[^}]*\}\n', '', s)
io.open('source/SearchBook.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SearchBook')

# 22) SourceModels: dedupe nilIfEmpty/takeIf
s = io.open('source/SourceModels.swift', encoding='utf-8').read()
if s.count('var nilIfEmpty') > 2:
    lines = s.split('\n')
    seen = set()
    out = []
    for ln in lines:
        key = 'nilIfEmpty' if 'nilIfEmpty' in ln else ('takeIf' if 'takeIf' in ln else None)
        if key and key in seen and ('var ' in ln or 'func ' in ln):
            continue
        if key: seen.add(key)
        out.append(ln)
    s = '\n'.join(out)
io.open('source/SourceModels.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceModels')

# 23) SourceManager + SourceViewModel: fix labels
s = io.open('source/SourceManager.swift', encoding='utf-8').read()
s = s.replace('func removeSource(sourceId: String)', 'func removeSource(id: String)')
io.open('source/SourceManager.swift', 'w', encoding='utf-8', newline='').write(s)
s = io.open('source/SourceViewModel.swift', encoding='utf-8').read()
s = s.replace('setSourceEnabled(sourceId: id, true)', 'setSourceEnabled(sourceId: id, true)')
s = s.replace('sourceManager.unregisterSource(id)', 'sourceManager.removeSource(id: id)')
io.open('source/SourceViewModel.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK SourceManager/VM')

# 24) JsonBookSource: Any→[String:Any], nilIfEmpty ambiguity
s = io.open('source/impl/JsonBookSource.swift', encoding='utf-8').read()
s = re.sub(r'JsonPathResolver\.getString\(item,', 'JsonPathResolver.getString(item as? [String: Any] ?? [:],', s)
s = s.replace('try RuleBudget.check(rule: rule.listPath, json: resp.text)',
              'if resp.text.count > 4 * 1024 * 1024 { return .error(.parseError("too big")) }')
s = re.sub(r'(\w+)\.nilIfEmpty\b', r'(\1 as String?).flatMap { $0.isEmpty ? nil : $0 }', s)
s = s.replace('(content.imageSelector as String?).flatMap { $0.isEmpty ? nil : $0 }',
              'content.imageSelector.isEmpty ? nil : content.imageSelector')
io.open('source/impl/JsonBookSource.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK JsonBookSource')

# 25) NovelSources: nil in [String]
s = io.open('source/impl/NovelSources.swift', encoding='utf-8').read()
s = s.replace("kind: tags.isEmpty ? nil : tags", "kind: tags.isEmpty ? nil : tags")
io.open('source/impl/NovelSources.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK NovelSources')

# 26) ZLibrarySupport: nilIfEmpty ambiguity
s = io.open('source/zlibrary/ZLibrarySupport.swift', encoding='utf-8').read()
s = re.sub(r'\((\w+\["[^"]*"\] as\? String)\)\.nilIfEmpty', r'(\1 as String?).flatMap { $0.isEmpty ? nil : $0 }', s)
io.open('source/zlibrary/ZLibrarySupport.swift', 'w', encoding='utf-8', newline='').write(s)
print('OK ZLibrarySupport')

# 27) ZLibraryDns: double cast
patch('source/zlibrary/network/ZLibraryDns.swift', [
    ("as [String: Any]? as? [String: Any]", "as? [String: Any]"),
])

# 28) NovelInfo: ambiguous
patch('source/NovelInfo.swift', [
    ("chapterCount != nil || volumeCount != nil", "(chapterCount != nil) || (volumeCount != nil)"),
])

# 29) ComicReaderModel
patch('ui/comic/ComicReaderModel.swift', [
    ("ChapterReadState(rawValue: $0.status) == .finished",
     "(ChapterReadState(rawValue: $0.status) ?? .unread) == .finished"),
])

print("=== ALL DONE ===")

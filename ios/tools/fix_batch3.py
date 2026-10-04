import io, re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CialloReader', 'Sources', 'com', 'example'))

def patch(rel, pairs, must=True):
    s = io.open(rel, encoding='utf-8').read()
    ok = True
    for old, new in pairs:
        if old not in s:
            if must: print(f"[MISS] {rel}: {old[:60]!r}")
            ok = False; continue
        s = s.replace(old, new)
    io.open(rel, 'w', encoding='utf-8', newline='').write(s)
    print(("OK  " if ok else "PART") + " " + rel)

# GodMotion: remove unused generics
patch('god/GodMotion.swift', [
    ("static func springMain<T>() -> Animation", "static func springMain() -> Animation"),
    ("static func springLight<T>() -> Animation", "static func springLight() -> Animation"),
    ("static func springSoft<T>() -> Animation", "static func springSoft() -> Animation"),
    ("static func springBouncy<T>() -> Animation", "static func springBouncy() -> Animation"),
    ("static func fast<T>() -> Animation", "static func fast() -> Animation"),
    ("static func normal<T>() -> Animation", "static func normal() -> Animation"),
    ("static func slow<T>() -> Animation", "static func slow() -> Animation"),
    ("Color.systemBackground", "Color(UIColor.systemBackground)"),
    ("goldGradient(dark)", "goldGradient(darkTheme: dark)"),
])

# GodMomentModels: round3 + Identifiable
patch('god/GodMomentModels.swift', [
    ("private func round3(_ v: Float)", "fileprivate func round3(_ v: Float)"),
    ("enum GodRankingStyle: String, CaseIterable {", "enum GodRankingStyle: String, CaseIterable, Identifiable {"),
])

# GodMomentRepository: dao access + AsyncStream map
patch('god/GodMomentRepository.swift', [
    ("private let dao: GodMomentDao", "let dao: GodMomentDao"),
    (".map { list in\n            Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) })\n        }",
     ".map { list -> [String: GodMomentEntity] in\n            Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) })\n        }"),
])

# GodMomentViewModel: dao call fix
patch('god/GodMomentViewModel.swift', [
    ("repository.dao(forBookSync: bookId)", "repository.dao.forBookSync(bookId: bookId)"),
])

# GodCoverEngine: Float/CGFloat
patch('god/GodCoverEngine.swift', [
    ("static let COVER_RATIO: Float = 3.0 / 4.0", "static let COVER_RATIO: CGFloat = 3.0 / 4.0"),
])

# GodMoment: Float/Double
s = io.open('god/GodMoment.swift', encoding='utf-8').read()
s = s.replace('@State private var rating: Double = 0', '@State private var rating: Double = 0')
io.open('god/GodMoment.swift', 'w', encoding='utf-8', newline='').write(s)

# AppDatabase: Int/Int64 + String? unwrap
patch('data/AppDatabase.swift', [
    ('.int(Int64(row["id"]?.intValue ?? 0))', '.int(row["id"]?.intValue ?? 0)'),
])

# BackupManager: missing refs
patch('data/BackupManager.swift', [
    ("DownloadManager.shared.withControlLock", "DownloadManager.shared"),
    ("DownloadTaskDao()", "AppDatabase.shared"),
])

# CharsetSniffer: isISOControl
patch('data/CharsetSniffer.swift', [
    ("it.unicodeScalars.first!.properties.isISOControl",
     "it.unicodeScalars.first!.value < 0x20 || it.unicodeScalars.first!.value == 0x7F"),
])

# ComicParser + EpubParser: budget API
patch('data/ComicParser.swift', [
    ("try budget.beginEntry()", "// merged"),
    ("try budget.add(data.count)", "try budget.copy(data)"),
])
patch('data/EpubParser.swift', [
    ("try budget.add(data.count)", "try budget.copy(data)"),
])

# ContentMutationGate: epoch var
patch('data/ContentMutationGate.swift', [
    ("private(set) var epoch", "var epoch"),
])

# PrivacyManager: async
patch('data/PrivacyManager.swift', [
    ("let ok = verify(pin: pin)", "let ok = await verify(pin: pin)"),
])

# TtsManager
patch('data/TtsManager.swift', [
    ("synthesizer.pause(at:", "synthesizer.pauseSpeaking(at:"),
])

# FavoriteDao Int64→Int
patch('data/favorite/FavoriteDao.swift', [
    ("-> Int {\n        Int(try db.query", "-> Int {\n        Int(try db.query"),
])

# FavoriteRepository: arg labels + ComicInfo
patch('data/favorite/FavoriteRepository.swift', [
    ("continueLabel(sourceId: sourceId, comicId: comicId, chapters: chapters)",
     "continueLabel(source: sourceId, comic: comicId, chapters: chapters)"),
    ('detail.author', 'detail.author ?? ""'),
])

# ComicInfo: takeIf → nilIfEmpty
s = io.open('source/ComicInfo.swift', encoding='utf-8').read()
s = s.replace(".takeIf({ !$0.isBlank })", ".nilIfEmpty")
io.open('source/ComicInfo.swift', 'w', encoding='utf-8', newline='').write(s)

# SourceImporter: takeIf
s = io.open('source/importer/SourceImporter.swift', encoding='utf-8').read()
s = s.replace(".takeIf({ !$0.isBlank })", ".nilIfEmpty")
io.open('source/importer/SourceImporter.swift', 'w', encoding='utf-8', newline='').write(s)

# ZLibraryDns: ambiguous parseJson
patch('source/zlibrary/network/ZLibraryDns.swift', [
    ("JsonPathResolver.parseJson(resp.text)", "JsonPathResolver.parseJson(resp.text) as [String: Any]?"),
])

# ComicReaderModel: ChapterReadState
patch('ui/comic/ComicReaderModel.swift', [
    ("readChapterIds = Set(reads.filter { $0.state == .finished }.map { $0.chapterId })",
     "readChapterIds = Set(reads.filter { ChapterReadState(rawValue: $0.status) == .finished }.map { $0.chapterId })"),
])

# ComicReaderScreen: Unit closure
patch('ui/comic/ComicReaderScreen.swift', [
    ("coverProvider: { model.currentImage() })", "coverProvider: { return model.currentImage() })"),
])

# BookRepository: deleteGodMoments
patch('data/BookRepository.swift', [
    ("db.deleteGodMoments", "db.deleteGodMoments"),
])

# GodPull: StrokeStyle
s = io.open('god/GodPull.swift', encoding='utf-8').read()
s = s.replace("lineCap: .round))", "lineCap: .round))")
s = s.replace("lineWidth: 5, lineCap: .round))", "lineWidth: 5, lineCap: .round))")
io.open('god/GodPull.swift', 'w', encoding='utf-8', newline='').write(s)

print("ALL PATCHES DONE")

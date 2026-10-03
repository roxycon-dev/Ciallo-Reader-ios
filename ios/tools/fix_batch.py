import io, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CialloReader')

def patch(rel, pairs):
    p = os.path.join(BASE, rel)
    s = io.open(p, encoding='utf-8').read()
    ok = True
    for old, new in pairs:
        if old not in s:
            print(f"[MISS] {rel}: {old[:60]!r}")
            ok = False
            continue
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print(("OK  " if ok else "PART") + " " + rel)

# --- Source/SourceModels.swift ---
patch('Source/SourceModels.swift', [
    ("    var capabilities: SourceCapabilities {\n        SourceCapabilities(supportComic: true, downloadRequiresLogin: loginRequiredFlag)\n    }",
     "PLACEHOLDER_NOT_HERE"),
])

# --- Source/JS/JsSourceRepo.swift capabilities order ---
patch('Source/JS/JsSourceRepo.swift', [
    ("var capabilities: SourceCapabilities { SourceCapabilities(supportComic: true, supportImport: true) }",
     "var capabilities: SourceCapabilities { SourceCapabilities(supportImport: true, supportComic: true) }"),
])

# --- Source/JS/JsComicSource.swift ---
patch('Source/JS/JsComicSource.swift', [
    ("    var capabilities: SourceCapabilities {\n        SourceCapabilities(supportComic: true, downloadRequiresLogin: loginRequiredFlag)\n    }",
     "    var capabilities: SourceCapabilities {\n        SourceCapabilities(downloadRequiresLogin: loginRequiredFlag, supportComic: true)\n    }"),
])

# --- Source/JS/JsSourceEngine.swift ---
patch('Source/JS/JsSourceEngine.swift', [
    ("import JavaScriptCore\nimport CryptoKit", "import JavaScriptCore\nimport CryptoKit\nimport SwiftSoup"),
    ("    private let queue: DispatchQueue", "    let queue: DispatchQueue"),
    ("    private var instance: JSValue?", "    var instance: JSValue?"),
    ("SourceLog.log(engine.sourceId, text?.toString() ?? \"\")", "SourceLog.log(engine.sourceId, text.toString())"),
    ("forKeyedSubscript: \"__nativeLog\")", "forKeyedSubscript: \"__nativeLog\" as NSString)"),
    ("forKeyedSubscript: \"__nativeRequest\")", "forKeyedSubscript: \"__nativeRequest\" as NSString)"),
    ("forKeyedSubscript: \"__nativeConvert\")", "forKeyedSubscript: \"__nativeConvert\" as NSString)"),
    ("forKeyedSubscript: \"__nativeStorageGet\")", "forKeyedSubscript: \"__nativeStorageGet\" as NSString)"),
    ("forKeyedSubscript: \"__nativeStorageSet\")", "forKeyedSubscript: \"__nativeStorageSet\" as NSString)"),
    ("forKeyedSubscript: \"__nativeInputDialog\")", "forKeyedSubscript: \"__nativeInputDialog\" as NSString)"),
    ("forKeyedSubscript: \"__nativeHtmlParse\")", "forKeyedSubscript: \"__nativeHtmlParse\" as NSString)"),
    ("JsConvert.convert(type: type?.toString() ?? \"\", value: value?.toString() ?? \"\", arg: arg?.toString())",
     "JsConvert.convert(type: type.toString(), value: value.toString(), arg: arg.toString())"),
    ("let value = storage.get(key?.toString() ?? \"\")", "let value = storage.get(key.toString())"),
    ("storage.set(key?.toString() ?? \"\", value?.toString() ?? \"{}\")", "storage.set(key.toString(), value.toString())"),
    ("await JsUiInput.requestInput(prompt: prompt?.toString() ?? \"\")", "await JsUiInput.requestInput(prompt: prompt.toString())"),
    ("return JsHtmlBridge.parse(html?.toString() ?? \"\", baseUrl: baseUrl?.toString())",
     "return JsHtmlBridge.parse(html.toString(), baseUrl: baseUrl.toString())"),
    ("let json = JsNetwork.serialize(response)", "let json = JsNetwork.Response.serialize(response)"),
    ("        let stringify = ctx.objectForKeyedSubscript(\"JSON\")?.objectForKeyedSubscript(\"stringify\")",
     "        let stringify = ctx.objectForKeyedSubscript(\"JSON\").objectForKeyedSubscript(\"stringify\")"),
    ("        let stringify = context?.objectForKeyedSubscript(\"JSON\").objectForKeyedSubscript(\"stringify\")",
     "        let stringify = context?.objectForKeyedSubscript(\"JSON\").objectForKeyedSubscript(\"stringify\")"),
    ("case let s as String: return JSValue(string: s, in: ctx) ?? JSValue(nullIn: ctx)",
     "case let s as String: return JSValue(object: s, in: ctx) ?? JSValue(nullIn: ctx)"),
    ("if let b = UInt8(String(chars[i]...chars[i + 1]), radix: 16) { bytes.append(b) }",
     "if let b = UInt8(String([chars[i], chars[i + 1]]), radix: 16) { bytes.append(b) }"),
])

# --- Source/RuleEngine.swift extra: applyRegex leftover ---
patch('Source/RuleEngine.swift', [
    ("        let replacement = String(suffix[sepRange.upperBound...])\n            .replacingOccurrences(of: \"$1\", with: \"$1\")",
     "        let replacement = String(suffix[sepRange.upperBound...])"),
])

# --- Source/JsonBookSource.swift ---
patch('Source/JsonBookSource.swift', [
    ("                                                   format: JsonPathResolver.getString(json, f.format ?? \"\") ?? detailDefaultFormat,\n                                                   downloadUrl: JsonPathResolver.getString(json, f.downloadUrl ?? \"\"),\n                                                   size: JsonPathResolver.getString(json, \"size\").flatMap { Int64($0) }))",
     "                                                   format: JsonPathResolver.getString(json, f.format ?? \"\") ?? detailDefaultFormat,\n                                                   size: JsonPathResolver.getString(json, \"size\").flatMap { Int64($0) },\n                                                   downloadUrl: JsonPathResolver.getString(json, f.downloadUrl ?? \"\"))"),
])

# --- Source/MangaDexSource.swift ---
patch('Source/MangaDexSource.swift', [
    ("        let resp = await searchMirror(slug.urlEncode())",
     "        let resp = (try? await searchMirror(slug.urlEncode())) ?? []"),
    ("        let doc = try SwiftSoup(resp.text)\n        var chapters: [ComicChapter] = []",
     "        let doc = try SwiftSoup.parse(resp.text)\n        var chapters: [ComicChapter] = []"),
    ("            if let doc = try? SwiftSoup(resp.text),",
     "            if let doc = try? SwiftSoup.parse(resp.text),"),
])

# --- Source/NovelSources.swift ---
patch('Source/NovelSources.swift', [
    ("        let downloadHref = linkEl.attr(\"abs:href\").isEmpty ? linkEl.attr(\"href\") : linkEl.attr(\"abs:href\")",
     "        let downloadHref = ((try? linkEl.attr(\"abs:href\")) ?? \"\").isEmpty ? ((try? linkEl.attr(\"href\")) ?? \"\") : ((try? linkEl.attr(\"abs:href\")) ?? \"\")"),
    ("                let href = link.attr(\"abs:href\").isEmpty ? link.attr(\"href\") : link.attr(\"abs:href\")",
     "                let href = ((try? link.attr(\"abs:href\")) ?? \"\").isEmpty ? ((try? link.attr(\"href\")) ?? \"\") : ((try? link.attr(\"abs:href\")) ?? \"\")"),
    ("                let intro = (try? info.select(\".l-p2\")?.first()?.text()) ?? \"\" ?? \"\"",
     "                let intro = (try? info.select(\".l-p2\").first()?.text()) ?? \"\" ?? \"\""),
    ("                    author: (try? info.select(\".bauthor\")?.first()?.text()) ?? \"\" ?? \"\",",
     "                    author: (try? info.select(\".bauthor\").first()?.text()) ?? \"\" ?? \"\","),
    ("            author: (try? info?.select(\".bauthor\")?.first()?.text()) ?? \"\" ?? \"\",",
     "            author: (try? info?.select(\".bauthor\").first()?.text()) ?? \"\" ?? \"\","),
])

# --- Source/ZLibrary/ZLibrarySupport.swift ---
patch('Source/ZLibrary/ZLibrarySupport.swift', [
    ("                let title = ((try? container?.select(\"h3, .title, .book-title\").first()?.text()) ?? \"\") ?? link.text()",
     "                let fromCard = ((try? container?.select(\"h3, .title, .book-title\").first()?.text()) ?? \"\")\n                let title = fromCard.isEmpty ? ((try? link.text()) ?? \"\") : fromCard"),
])

# --- Source/ZLibrary/ZLibraryDns.swift ---
patch('Source/ZLibrary/ZLibraryDns.swift', [
    ("            let params = NWParameters(tls: tlsOptions)\n            params.connectTimeout = 10",
     "            let params = NWParameters(tls: tlsOptions)"),
])

# --- Source/ZLibrary/ZLibrarySource.swift ---
patch('Source/ZLibrary/ZLibrarySource.swift', [
    ("    func isLoggedIn() async -> Bool {\n        storage.isLoggedIn() && cookieJar.isLoggedInCookie(host: await provider.resolveDomain())\n    }",
     "    func isLoggedIn() async -> Bool {\n        let domain = await provider.resolveDomain()\n        return storage.isLoggedIn() && cookieJar.isLoggedInCookie(host: domain)\n    }"),
])

# --- Data/Parsers/ComicParser.swift ---
patch('Data/Parsers/ComicParser.swift', [
    ("        for entry in archive where !entry.isDirectory {",
     "        for entry in archive where entry.type == .file {"),
    ("                while ai < i {\n                    let digitOrder = ac[ai].compare(bc[bj], options: .caseInsensitive).rawValue\n                    ai += 1; bj += 1\n                    if digitOrder != 0 { return digitOrder }\n                }",
     "                while ai < i {\n                    let ca = ac[ai].lowercased(), cb = bc[bj].lowercased()\n                    if ca != cb { return ca < cb ? -1 : 1 }\n                    ai += 1; bj += 1\n                }"),
    ("        let lenOrder = (ac.count - i) - (bc.count - j)\n        return lenOrder != 0 ? lenOrder : a.compare(b)",
     "        let lenOrder = (ac.count - i) - (bc.count - j)\n        return lenOrder != 0 ? lenOrder : (a < b ? -1 : (a == b ? 0 : 1))"),
])

# --- Design/CurlStrip.swift ---
patch('Design/CurlStrip.swift', [
    ("            if flatRect.width > 0 {\n                ctx.draw(image, in: flatRect, source: flatRect)\n            }",
     "            if flatRect.width > 0 {\n                ctx.draw(image, in: flatRect)\n            }"),
    ("                    ctx.draw(image, in: dest, source: source)",
     "                    CurlStripCanvas.drawStrip(&ctx, image: image, dest: dest, source: source)"),
    ("            if flippedSource.minX >= 0, flippedSource.maxX <= size.width {\n                    let anchor = 2 * geo.fold + sign * .pi * geo.radius\n                    ctx.drawLayer { layer in\n                        layer.translateBy(x: anchor, y: 0)\n                        layer.scaleEffect(x: -1, y: 1)\n                        layer.draw(image, in: flippedSource, source: flippedSource)\n                    }",
     "            if flippedSource.minX >= 0, flippedSource.maxX <= size.width {\n                    let anchor = 2 * geo.fold + sign * .pi * geo.radius\n                    ctx.drawLayer { layer in\n                        layer.translateBy(x: anchor, y: 0)\n                        layer.scaleEffect(x: -1, y: 1)\n                        layer.draw(image, in: flippedSource)\n                    }"),
])

# --- Library/LibraryViewModel.swift SlotPool.max rename ---
patch('Library/LibraryViewModel.swift', [
    ("actor SlotPool {\n    private let max: Int\n    private var active = 0\n\n    init(max: Int) { self.max = max }",
     "actor SlotPool {\n    private let limit: Int\n    private var active = 0\n\n    init(limit: Int) { self.limit = limit }"),
    ("    func acquire() async {\n        while active >= max {",
     "    func acquire() async {\n        while active >= limit {"),
    ("    private let slots = SlotPool(max: 8)", "    private let slots = SlotPool(limit: 8)"),
])

# --- Design/AppTheme.swift ---
patch('Design/AppTheme.swift', [
    ("    var preferredColorScheme: ColorScheme? { darkMode }",
     "    var preferredColorScheme: ColorScheme? { darkMode.map { $0 ? ColorScheme.dark : ColorScheme.light } }"),
])

# --- Download/DownloadManager.swift ---
patch('Download/DownloadManager.swift', [
    ("        let t = Task { [weak self] in\n            await self?.runWorker(task: task, headers: headers, referer: referer)\n        }",
     "        let t = Task { [weak self] in\n            guard let self else { return }\n            await self.runWorker(task: task, headers: headers, referer: referer)\n        }"),
])

# --- God/GodMoment.swift ---
patch('God/GodMoment.swift', [
    ("        guard let bg = centerCrop(source, to: size),\n              let blurred = boxBlur(bg, passes: 3, downsample: 8),\n              let fg = containCrop(source, to: size) else { return nil }",
     "        guard let bg = centerCrop(source, to: size),\n              let blurred = boxBlur(bg, passes: 3, downsample: 8) else { return nil }\n        let fg = containCrop(source, to: size)"),
])

# --- Settings/SettingsTabScreen.swift ---
patch('Settings/SettingsTabScreen.swift', [
    ("        .fileImporter(isPresented: $showBackup, allowedContentTypes: [.zip, .data]) { result in\n            if case .success(let urls) = result, let url = urls.first {",
     "        .fileImporter(isPresented: $showBackup, allowedContentTypes: [.zip, .data]) { result in\n            if case .success(let url) = result {"),
])

# --- Home/HomeScreen.swift ---
patch('Home/HomeScreen.swift', [
    ("        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in\n            if case .success(let urls) = result, let url = urls.first {",
     "        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in\n            if case .success(let url) = result {"),
    ("                sectionTitle(\"我的书架\", icon: \"books.vertical\", trailing: shelfActions)",
     "                sectionTitle(\"我的书架\", icon: \"books.vertical\", trailing: { shelfActions })"),
])

# --- Design/Components.swift ---
patch('Design/Components.swift', [
    (".foregroundStyle(foreground)\n            .background(background)",
     ".foregroundStyle(foreground)\n            .background(backgroundStyle)"),
    ("    @ViewBuilder\n    private var background: some View {\n        switch variant {\n        case .primary: AnyShapeStyle(theme.primary)\n        case .secondary: AnyShapeStyle(theme.primary.opacity(0.14))\n        case .ghost: AnyShapeStyle(Color.primary.opacity(0.06))\n        }\n    }",
     "    private var backgroundStyle: AnyShapeStyle {\n        switch variant {\n        case .primary: return AnyShapeStyle(theme.primary)\n        case .secondary: return AnyShapeStyle(theme.primary.opacity(0.14))\n        case .ghost: return AnyShapeStyle(Color.primary.opacity(0.06))\n        }\n    }"),
    (".offset(y: animate ? offset.y : .zero)", ".offset(y: animate ? offset.height : .zero)"),
    ("struct AppSnack: Identifiable, Equatable {", "struct AppSnack: Identifiable {"),
    (".background(\n            RoundedRectangle(cornerRadius: DT.rMD, style: .continuous)\n                .fill(snack.kind == .error ? Color(hex: 0x8C1D18) : .regularMaterial)\n        )",
     ".background(\n            RoundedRectangle(cornerRadius: DT.rMD, style: .continuous)\n                .fill(snack.kind == .error ? AnyShapeStyle(Color(hex: 0x8C1D18)) : AnyShapeStyle(.regularMaterial))\n        )"),
])

# --- Reader/NovelInlineImages.swift / ComicParser extract: keep memory extract; pin ZIPFoundation in pbxproj ---

# --- Reader/ReaderScreen.swift redeclaration check handled separately ---

# --- Data/Parsers/MobiParser.swift ---
patch('Data/Parsers/MobiParser.swift', [
    ("        if mobiVersion >= 5, r0.count >= 244 { extraFlags = be16(r0, at: 242) }",
     "        if mobiVersion >= 5, r0.count >= 244 { extraFlags = UInt32(be16(r0, at: 242)) }"),
    ("            guard let rec = Int(try? img.attr(\"recindex\") ?? \"\"), let path = imageIndex[rec - 1] else { continue }",
     "            guard let recStr = try? img.attr(\"recindex\"), let rec = Int(recStr), let path = imageIndex[rec - 1] else { continue }"),
    ("    static func be32(_ d: Data, at i: Int) -> UInt32 {\n        guard i + 4 <= d.count else { return 0 }\n        let b = d[d.startIndex + i...]\n        return UInt32(b[b.startIndex]) << 24 | UInt32(b[b.startIndex + 1]) << 16 | UInt32(b[b.startIndex + 2]) << 8 | UInt32(b[b.startIndex + 3])\n    }",
     "    static func be32(_ d: Data, at i: Int) -> UInt32 {\n        guard i + 4 <= d.count else { return 0 }\n        let s = d.index(d.startIndex, offsetBy: i)\n        let b0 = UInt32(d[s])\n        let b1 = UInt32(d[d.index(s, offsetBy: 1)])\n        let b2 = UInt32(d[d.index(s, offsetBy: 2)])\n        let b3 = UInt32(d[d.index(s, offsetBy: 3)])\n        return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3\n    }"),
    ("    static func be16(_ d: Data, at i: Int) -> UInt16 {\n        guard i + 2 <= d.count else { return 0 }\n        let b = d[d.startIndex + i...]\n        return UInt16(b[b.startIndex]) << 8 | UInt16(b[b.startIndex + 1])\n    }",
     "    static func be16(_ d: Data, at i: Int) -> UInt16 {\n        guard i + 2 <= d.count else { return 0 }\n        let s = d.index(d.startIndex, offsetBy: i)\n        let b0 = UInt16(d[s])\n        let b1 = UInt16(d[d.index(s, offsetBy: 1)])\n        return b0 << 8 | b1\n    }"),
])

# --- Data/Parsers/HuffCdicDecoder.swift ---
patch('Data/Parsers/HuffCdicDecoder.swift', [
    ("    private struct Dict1Entry {\n        let codeLen: Int\n        let term: Bool\n        let maxCode: UInt64\n    }",
     "    private struct Dict1Entry {\n        let codeLen: Int\n        let term: Bool\n        var maxCode: UInt64\n    }"),
    ("                let resolved = unpack(sliceBytes)\n                dictionary[r] = (resolved, true)\n                sliceBytes = resolved",
     "                let resolvedBytes = [UInt8](unpack(sliceBytes))\n                dictionary[r] = (resolvedBytes, true)\n                sliceBytes = resolvedBytes"),
])

# --- Data/PrivacyManager.swift ---
patch('Data/PrivacyManager.swift', [
    ("        let salt = (0..<16).map { _ in UInt8.random(in: 0...255) }",
     "        let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })"),
])

# --- Data/TtsManager.swift ---
patch('Data/TtsManager.swift', [
    ("        synthesizer.pause(at: .immediate)", "        synthesizer.pauseSpeaking(at: .immediate)"),
])

# --- Comic/ComicSettings.swift enums Codable ---
patch('Comic/ComicSettings.swift', [
    ("enum ComicMode: String, CaseIterable, Identifiable {", "enum ComicMode: String, Codable, CaseIterable, Identifiable {"),
    ("enum ComicFit: String, CaseIterable, Identifiable {", "enum ComicFit: String, Codable, CaseIterable, Identifiable {"),
    ("enum ComicBgStyle: String, CaseIterable, Identifiable {", "enum ComicBgStyle: String, Codable, CaseIterable, Identifiable {"),
])

print("ALL PATCHES APPLIED")

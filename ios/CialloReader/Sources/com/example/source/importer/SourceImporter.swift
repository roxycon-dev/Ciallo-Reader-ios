// 对齐 novel-reader/app/src/main/java/com/example/source/importer/SourceImporter.kt（654 行）

import Foundation

/**
 * 书源导入器。
 *
 * 支持三种输入：
 * 1. 本项目原生 JSON 格式（search / htmlSearch / htmlChapters / htmlContent）
 * 2. Legado（开源阅读）书源格式：bookSourceName / bookSourceUrl / searchUrl /
 *    ruleSearch / ruleToc / ruleContent（社区「阅读」书源通用格式）
 * 3. 书源合集 JSON 数组（批量导入，跳过不兼容源）
 *
 * Legado 规则转换说明：
 * - {{key}} -> {keyword}，{{page}} -> {page}，支持 {{java.base64Encode(key)}} 与简单
 *   {{(page-1)*20}} 页面运算；POST 搜索源（,{ "method":"POST","body":... }）会透传 method/body
 * - ruleSearch.bookList 以 $ 或 @json: 开头时按 JSONPath 解析，否则按 HTML 规则解析
 * - 需要 @js: / webView / 嗅探 sourceRegex 的书源暂不支持，会明确跳过
 */
enum SourceImporter {

    /** 社区书源网络导入预设（用户可自行替换为任意 shuyuan 文件地址）。 */
    static let presetSourceUrls: [(url: String, label: String)] = [
        ("https://raw.ixnic.net/XIU2/Yuedu/master/shuyuan", "XIU2 精品书源（镜像）"),
        ("https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan", "XIU2 精品书源（CDN）"),
        ("https://raw.githubusercontent.com/XIU2/Yuedu/master/shuyuan", "XIU2 精品书源（GitHub 直连）"),
    ]

    struct BatchImportResult {
        var imported: [(source: JsonBookSource, rawJson: String)]
        var skipped: [(name: String, reason: String)]

        var importedCount: Int { imported.count }
        var skippedCount: Int { skipped.count }
    }

    /// Kotlin: urlClient = SharedHttpTransport.builder().connectTimeout(15s).readTimeout(20s).followRedirects(true)
    ///（iOS 统一走 Http.session，超时以参数表达）

    // MARK: - org.json 对应物（optString/optBoolean/optInt/optLong：缺失/NULL → 兜底，非字符串强转）

    static func str(_ dict: [String: Any]?, _ key: String, _ fallback: String = "") -> String {
        guard let dict, let v = dict[key], !(v is NSNull) else { return fallback }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        if let b = v as? Bool { return b ? "true" : "false" }
        return String(describing: v)
    }

    static func boolean(_ dict: [String: Any]?, _ key: String, _ fallback: Bool) -> Bool {
        guard let dict, let v = dict[key], !(v is NSNull) else { return fallback }
        if let b = v as? Bool { return b }
        if let s = v as? String { return s.lowercased() == "true" }
        if let n = v as? NSNumber { return n.boolValue }
        return fallback
    }

    static func int(_ dict: [String: Any]?, _ key: String, _ fallback: Int) -> Int {
        guard let dict, let v = dict[key], !(v is NSNull) else { return fallback }
        if let n = v as? NSNumber { return n.intValue }
        if let s = v as? String { return Int(s) ?? fallback }
        return fallback
    }

    static func long(_ dict: [String: Any]?, _ key: String, _ fallback: Int64) -> Int64 {
        guard let dict, let v = dict[key], !(v is NSNull) else { return fallback }
        if let n = v as? NSNumber { return n.int64Value }
        if let s = v as? String { return Int64(s) ?? fallback }
        return fallback
    }

    /// Kotlin `JSONObject.has(key)` 对应物（NULL 值视为不存在）
    static func has(_ dict: [String: Any], _ key: String) -> Bool {
        guard let v = dict[key] else { return false }
        return !(v is NSNull)
    }

    /// Kotlin `optJSONObject(key)` 对应物
    static func optObject(_ dict: [String: Any]?, _ key: String) -> [String: Any]? {
        guard let dict, let v = dict[key] as? [String: Any] else { return nil }
        return v
    }

    /// Kotlin `optJSONArray(key)` 对应物
    static func optArray(_ dict: [String: Any]?, _ key: String) -> [Any]? {
        guard let dict, let v = dict[key] as? [Any] else { return nil }
        return v
    }

    /// iOS 骨架遗留入口（js/JsSourceEngine、JsSourceRepo 引用）：任意 JSON 值序列化。
    /// 注：JSONSerialization 无 Kotlin JSONObject.toString 的插入序保证（平台差异）。
    static func serialize(_ obj: Any) -> String {
        if obj is NSNull { return "{}" }
        guard JSONSerialization.isValidJSONObject(obj) || (obj as? NSNumber) != nil || (obj as? String) != nil || (obj as? Bool) != nil else {
            return "{}"
        }
        if JSONSerialization.isValidJSONObject(obj),
           let data = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "\(obj)"
    }

    /// Kotlin com.example.data.readImportBytes(limit) 对应物：限定读取上限
    static func readImportBytes(_ data: Data, limit: Int) throws -> Data {
        guard data.count <= limit else {
            throw SourceException.parseError("内容超过 \(limit / 1024 / 1024)MiB 上限")
        }
        return data
    }

    // MARK: - 入口

    static func importFromJsonString(_ jsonStr: String) -> SourceResult<JsonBookSource> {
        let batch = parseBatch(jsonStr)
        if let first = batch.imported.first {
            return .success(first.source)
        }
        let reason = batch.skipped.first?.reason ?? "未找到可导入的书源"
        return .error(.parseError("导入失败：\(reason)"))
    }

    /** 批量导入（支持单源或 JSON 数组），返回导入成功与跳过的明细。 */
    static func importBatchFromJsonString(_ jsonStr: String) -> BatchImportResult {
        parseBatch(jsonStr)
    }

    /// Kotlin: `importFromUri(context, uri)` —— iOS 以文件 URL 读取
    static func importFromUri(_ fileUrl: URL) async -> SourceResult<(source: JsonBookSource, rawJson: String)> {
        do {
            guard FileManager.default.fileExists(atPath: fileUrl.path) else {
                return .error(.parseError("无法打开选择的文件"))
            }
            let raw = try Data(contentsOf: fileUrl)
            let jsonStr = String(data: try readImportBytes(raw, limit: 2 * 1024 * 1024), encoding: .utf8) ?? ""
            let batch = parseBatch(jsonStr)
            if let first = batch.imported.first {
                return .success(first)
            }
            return .error(.parseError(batch.skipped.first?.reason ?? "未找到可导入的书源"))
        } catch {
            // Kotlin 重抛 CancellationException；Swift Task 语境下按失败结果返回
            return .error(.parseError("读取文件失败: \(error.localizedDescription)"))
        }
    }

    static func importBatchFromUri(_ fileUrl: URL) async -> BatchImportResult {
        do {
            guard FileManager.default.fileExists(atPath: fileUrl.path) else {
                return BatchImportResult(imported: [], skipped: [("文件", "无法打开选择的文件")])
            }
            let raw = try Data(contentsOf: fileUrl)
            let jsonStr = String(data: try readImportBytes(raw, limit: 2 * 1024 * 1024), encoding: .utf8) ?? ""
            return parseBatch(jsonStr)
        } catch {
            // Kotlin 重抛 CancellationException；Swift Task 语境下按失败结果返回
            return BatchImportResult(imported: [], skipped: [("文件", "读取失败: \(error.localizedDescription)")])
        }
    }

    /** 从网络地址导入书源（支持单源 JSON 与合集数组）。 */
    static func importBatchFromUrl(_ url: String) async -> BatchImportResult {
        do {
            // Kotlin urlClient：connectTimeout 15s / readTimeout 20s / followRedirects(true)
            let resp = try await Http.get(
                url,
                headers: ["User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"],
                timeout: 20)
            guard (200..<300).contains(resp.status) else {
                return BatchImportResult(imported: [], skipped: [(url, "网络请求失败 HTTP \(resp.status)")])
            }
            let body = String(data: try readImportBytes(resp.data, limit: 2 * 1024 * 1024), encoding: .utf8) ?? ""
            if body.isBlank {
                return BatchImportResult(imported: [], skipped: [(url, "返回内容为空")])
            }
            return parseBatch(body)
        } catch {
            // Kotlin 重抛 CancellationException；Swift Task 语境下按失败结果返回
            return BatchImportResult(imported: [], skipped: [(url, "网络导入失败: \(error.localizedDescription)")])
        }
    }

    // MARK: - 核心解析

    private static func parseBatch(_ jsonStr: String) -> BatchImportResult {
        if jsonStr.isBlank {
            return BatchImportResult(imported: [], skipped: [("输入", "JSON内容为空")])
        }
        let trimmed = jsonStr.trimmingCharacters(in: .whitespacesAndNewlines)
        var imported: [(source: JsonBookSource, rawJson: String)] = []
        var skipped: [(name: String, reason: String)] = []

        do {
            try RuleBudget.json(jsonStr)
            guard let root = JsonPathResolver.parseJson(trimmed) else {
                throw SourceException.parseError("JSON 语法错误")
            }
            if let array = root as? [Any] {
                guard array.count <= 1000 else {
                    throw SourceException.parseError("一次最多导入 1000 个书源")
                }
                for obj in array {
                    guard let obj = obj as? [String: Any] else { continue }
                    if let converted = convertOne(obj) {
                        if let source = converted.source {
                            imported.append((source, converted.rawJson))
                        } else {
                            skipped.append((converted.name, converted.reason ?? "未知原因"))
                        }
                    }
                }
            } else if let obj = root as? [String: Any] {
                if let converted = convertOne(obj) {
                    if let source = converted.source {
                        imported.append((source, converted.rawJson))
                    } else {
                        skipped.append((converted.name, converted.reason ?? "未知原因"))
                    }
                }
            } else {
                throw SourceException.parseError("JSON 语法错误")
            }
        } catch let e as SourceException {
            return BatchImportResult(imported: [], skipped: [("输入", e.errorDescription ?? "解析失败")])
        } catch {
            // Kotlin 重抛 CancellationException；Swift Task 语境下按失败结果返回
            return BatchImportResult(imported: [], skipped: [("输入", "解析失败: \(error.localizedDescription)")])
        }
        return BatchImportResult(imported: imported, skipped: skipped)
    }

    private static func convertOne(_ obj: [String: Any]) -> ConvertedSource? {
        let rawJson = serialize(obj)
        // 优先按本项目原生格式解析
        if has(obj, "htmlSearch") || has(obj, "search") {
            switch parseNativeSource(obj) {
            case .success(let source):
                return ConvertedSource(source: source, rawJson: rawJson)
            case .error(let e):
                return ConvertedSource(source: nil, rawJson: rawJson,
                                       name: str(obj, "name", "书源"),
                                       reason: e.errorDescription)
            }
        }
        // Legado 格式
        if has(obj, "bookSourceName") || has(obj, "bookSourceUrl") || has(obj, "ruleSearch") {
            return convertLegadoSource(obj, rawJson)
        }
        return ConvertedSource(source: nil, rawJson: rawJson,
                               name: str(obj, "name", str(obj, "bookSourceName", "未知书源")),
                               reason: "既不是本项目 JSON 格式，也不是 Legado 书源格式")
    }

    private static func parseNativeSource(_ obj: [String: Any]) -> SourceResult<JsonBookSource> {
        do {
            let name = str(obj, "name").ifBlank("未命名书源")
            let id = str(obj, "id").ifBlank("custom_" + UUID().uuidString.prefix(8))
            let baseUrl = str(obj, "baseUrl")

            let searchObj = optObject(obj, "search")
            let htmlSearchObj = optObject(obj, "htmlSearch")
            if searchObj == nil && htmlSearchObj == nil {
                return .error(.parseError("缺少 search 或 htmlSearch 节点规则"))
            }

            let searchUrl = { () -> String in
                if let s = searchObj.flatMap({ str($0, "url").takeIf { !$0.isBlank } }) { return s }
                if let s = htmlSearchObj.flatMap({ str($0, "url").takeIf { !$0.isBlank } }) { return s }
                return ""
            }()
            if searchUrl.isBlank {
                return .error(.parseError("search/htmlSearch 规则中缺少 url 字段"))
            }

            let searchMethod = searchObj.map { str($0, "method", "GET") } ?? "GET"
            let searchListPath = searchObj.map { str($0, "listPath", "books") } ?? "books"

            // Kotlin: searchObj?.optJSONObject("fields") ?: searchObj（fields 缺省时字段直接放在 search 下）
            let searchFieldsObj = searchObj.flatMap { optObject($0, "fields") } ?? searchObj
            let searchFields = BookFieldRule(
                id: searchFieldsObj.map { str($0, "id", "id") } ?? "id",
                title: searchFieldsObj.map { str($0, "title", "title") } ?? "title",
                author: searchFieldsObj.map { str($0, "author", "author") },
                cover: searchFieldsObj.map { str($0, "cover", "cover") },
                description: searchFieldsObj.map { str($0, "description", "description") },
                format: searchFieldsObj.map { str($0, "format", "format") },
                downloadUrl: searchFieldsObj.map { str($0, "downloadUrl", "downloadUrl") }
            )

            let searchHeaders = parseHeaders(searchObj.flatMap { optObject($0, "headers") })
            let searchBody = searchObj.map { str($0, "body").takeIf { !$0.isBlank } } ?? nil

            let searchRule = SearchRule(
                url: searchUrl,
                method: searchMethod,
                listPath: searchListPath,
                fields: searchFields,
                headers: searchHeaders,
                body: searchBody
            )

            var detailRule: DetailRule? = nil
            if let detailObj = optObject(obj, "detail") {
                let detailUrl = str(detailObj, "url")
                if !detailUrl.isBlank {
                    let detailMethod = str(detailObj, "method", "GET")
                    let detailFieldsObj = optObject(detailObj, "fields") ?? detailObj
                    let detailFields = BookFieldRule(
                        id: str(detailFieldsObj, "id", "id"),
                        title: str(detailFieldsObj, "title", "title"),
                        author: str(detailFieldsObj, "author", "author"),
                        cover: str(detailFieldsObj, "cover", "cover"),
                        description: str(detailFieldsObj, "description", "description"),
                        format: str(detailFieldsObj, "format", "format"),
                        downloadUrl: str(detailFieldsObj, "downloadUrl", "downloadUrl")
                    )
                    let detailHeaders = parseHeaders(optObject(detailObj, "headers"))
                    let detailBody = str(detailObj, "body").takeIf { !$0.isBlank }
                    detailRule = DetailRule(
                        url: detailUrl,
                        method: detailMethod,
                        fields: detailFields,
                        headers: detailHeaders,
                        body: detailBody
                    )
                }
            }

            var downloadRule = DownloadRule()
            if let downloadObj = optObject(obj, "download") {
                let dlUrl = str(downloadObj, "url")
                let dlUrlField = str(downloadObj, "urlField", "downloadUrl")
                let dlFormat = str(downloadObj, "format", "epub")
                let dlHeaders = parseHeaders(optObject(downloadObj, "headers"))
                downloadRule = DownloadRule(
                    url: dlUrl.isNull_blank ? nil : dlUrl,
                    urlField: dlUrlField.isNull_blank ? nil : dlUrlField,
                    defaultFormat: dlFormat.ifBlank("epub"),
                    headers: dlHeaders
                )
            }

            let htmlSearch: HtmlSearchRule? = { () -> HtmlSearchRule? in
                guard let h = htmlSearchObj else { return nil }
                let rule = HtmlSearchRule(
                    url: str(h, "url"),
                    listSelector: str(h, "listSelector"),
                    titleSelector: str(h, "title"),
                    authorSelector: str(h, "author"),
                    coverSelector: str(h, "cover"),
                    detailUrlSelector: str(h, "detailUrl"),
                    introSelector: str(h, "intro"),
                    charset: str(h, "charset").takeIf { !$0.isBlank },
                    method: str(h, "method", "GET").ifBlank("GET").uppercased(),
                    body: str(h, "body").takeIf { !$0.isBlank }
                )
                return (!rule.url.isBlank && !rule.listSelector.isBlank) ? rule : nil
            }()

            let htmlChapters: HtmlChapterRule? = { () -> HtmlChapterRule? in
                guard let h = optObject(obj, "htmlChapters") else { return nil }
                let rule = HtmlChapterRule(
                    url: str(h, "url"),
                    listSelector: str(h, "listSelector"),
                    nameSelector: str(h, "name", "text"),
                    hrefSelector: str(h, "href", "href")
                )
                return (!rule.url.isBlank && !rule.listSelector.isBlank) ? rule : nil
            }()

            let htmlContent: HtmlContentRule? = { () -> HtmlContentRule? in
                guard let h = optObject(obj, "htmlContent") else { return nil }
                let rule = HtmlContentRule(
                    url: str(h, "url"),
                    imageSelector: str(h, "imageSelector")
                )
                return (!rule.url.isBlank && !rule.imageSelector.isBlank) ? rule : nil
            }()

            let config = SourceConfig(
                id: id,
                name: name,
                baseUrl: baseUrl,
                search: searchRule,
                detail: detailRule,
                download: downloadRule,
                htmlSearch: htmlSearch,
                htmlChapters: htmlChapters,
                htmlContent: htmlContent,
                enabled: true,
                isCustom: true,
                insecureTls: boolean(obj, "insecureTls", false),
                // 第三轮记录的遗留 NPE 修复：type 键缺失时 optString 返回 null，
                // 直接 .ifBlank 会抛空安全异常——任何不带 type 字段的书源导入必失败
                type: str(obj, "type").takeIf { !$0.isBlank }
            )

            return .success(JsonBookSource(config: config))
        } catch {
            // Kotlin 重抛 CancellationException；Swift Task 语境下按失败结果返回
            return .error(.parseError("解析书源失败: \(error.localizedDescription)"))
        }
    }

    private static func convertLegadoSource(_ obj: [String: Any], _ rawJson: String) -> ConvertedSource {
        let name = str(obj, "bookSourceName").ifBlank("未命名书源")
        let baseUrl = str(obj, "bookSourceUrl").trimmingCharacters(in: .whitespacesAndNewlines)
        if baseUrl.isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 bookSourceUrl")
        }
        let searchUrlRaw = str(obj, "searchUrl").trimmingCharacters(in: .whitespacesAndNewlines)
        if searchUrlRaw.isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 searchUrl")
        }

        guard let ruleSearch = parseRuleObject(obj, "ruleSearch") else {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 ruleSearch")
        }
        let ruleToc = parseRuleObject(obj, "ruleToc") ?? [:]
        let ruleContent = parseRuleObject(obj, "ruleContent") ?? [:]

        let allRules = [searchUrlRaw, serialize(ruleSearch), serialize(ruleToc), serialize(ruleContent)].joined(separator: "\n")
        if allRules.contains("@js:") || allRules.contains("{{java.") || allRules.contains("webView") ||
            allRules.contains("@js") || allRules.contains("webJs") ||
            !str(ruleContent, "sourceRegex").isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "包含 JS 脚本/WebView 嗅探，暂不支持")
        }
        if int(obj, "bookSourceType", 0) == 1 {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "有声书源（bookSourceType=1）暂不支持")
        }

        let bookList = str(ruleSearch, "bookList").trimmingCharacters(in: .whitespacesAndNewlines)
        if bookList.isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 ruleSearch.bookList")
        }
        let chapterList = str(ruleToc, "chapterList").trimmingCharacters(in: .whitespacesAndNewlines)
        if chapterList.isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 ruleToc.chapterList（无目录规则）")
        }
        let content = str(ruleContent, "content").trimmingCharacters(in: .whitespacesAndNewlines)
        if content.isBlank {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "缺少 ruleContent.content（无正文/图片规则）")
        }
        if content == "result" {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "正文依赖媒体嗅探（sourceRegex），暂不支持")
        }

        guard let converted = convertLegadoUrl(searchUrlRaw) else {
            return ConvertedSource(source: nil, rawJson: rawJson, name: name, reason: "搜索 URL 含无法转换的 JS 表达式")
        }

        let headers = parseHeaderString(str(obj, "header"))
        let charset = converted.charset.takeIf { !$0.isBlank }
        let id = "legado_" + baseUrl
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
            .ifBlank(String(UUID().uuidString.prefix(8)))

        let htmlSearch = HtmlSearchRule(
            url: converted.url,
            listSelector: bookList,
            titleSelector: str(ruleSearch, "name"),
            authorSelector: str(ruleSearch, "author"),
            coverSelector: str(ruleSearch, "coverUrl"),
            detailUrlSelector: str(ruleSearch, "bookUrl"),
            introSelector: str(ruleSearch, "intro"),
            charset: charset,
            method: converted.method,
            body: converted.body
        )

        let ruleBookInfo = parseRuleObject(obj, "ruleBookInfo") ?? [:]
        let chapterName = str(ruleToc, "chapterName", "text").ifBlank("text")
        let chapterUrl = str(ruleToc, "chapterUrl", "href").ifBlank("href")
        let htmlChapters = HtmlChapterRule(
            url: "{id}",
            listSelector: chapterList,
            nameSelector: chapterName,
            hrefSelector: chapterUrl,
            tocUrlSelector: str(ruleBookInfo, "tocUrl").trimmingCharacters(in: .whitespaces).takeIf { !$0.isBlank }
        )
        let htmlContent = HtmlContentRule(
            url: "{chapterUrl}",
            imageSelector: content
        )

        let searchRule = SearchRule(
            url: converted.url,
            method: "GET",
            listPath: "books",
            fields: BookFieldRule(),
            headers: headers
        )

        let config = SourceConfig(
            id: id,
            name: name,
            baseUrl: baseUrl,
            search: searchRule,
            detail: nil,
            download: DownloadRule(),
            htmlSearch: htmlSearch,
            htmlChapters: htmlChapters,
            htmlContent: htmlContent,
            enabled: true,
            isCustom: true
        )
        return ConvertedSource(source: JsonBookSource(config: config), rawJson: rawJson, name: name)
    }

    private static func parseRuleObject(_ obj: [String: Any], _ key: String) -> [String: Any]? {
        if let direct = optObject(obj, key) { return direct }
        let s = str(obj, key)
        if s.isBlank { return nil }
        return JsonPathResolver.parseJson(s) as? [String: Any]
    }

    // MARK: - Legado URL 转换

    /** 转换 Legado URL：去掉 ,{...} 选项后缀，{{key}} -> {keyword}，{{page}} -> {page}，支持简单运算。POST 源透传 method/body。 */
    private static func convertLegadoUrl(_ raw: String) -> LegadoUrl? {
        var url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var charset: String? = nil
        // 去掉请求选项后缀 ,{ "charset": ... , "method": ... , "body": ... }
        if let commaIdx = url.range(of: ",{") {
            let candidate = String(url[commaIdx.lowerBound...].dropFirst())
            if candidate.trimmingCharacters(in: .whitespaces).hasPrefix("{") {
                if let opt = JsonPathResolver.parseJson(candidate) as? [String: Any] {
                    url = String(url[url.startIndex..<commaIdx.lowerBound]).trimmingCharacters(in: .whitespaces)
                    charset = str(opt, "charset").takeIf { !$0.isBlank }
                    let optMethod = str(opt, "method", "GET").ifBlank("GET")
                    if optMethod.caseInsensitiveCompare("POST") == .orderedSame {
                        // POST 搜索源：透传 method/body，不再跳过
                        return postUrl(url, opt)
                    }
                }
            }
        }
        if url.contains("@js:") || url.contains("webView") { return nil }

        url = url
            .replacingOccurrences(of: "{{key}}", with: "{keyword}")
            .replacingOccurrences(of: "{{page}}", with: "{page}")
            .replacingOccurrences(of: #"\{\{java\.base64Encode\(key\)\}\}"#, with: "{keyword_b64}", options: .regularExpression)

        // 简单页面运算：{{(page-1)*20}}、{{page*10}}、{{(page-1)*50}} 等
        url = replaceTemplateExpressions(url) { expr in
            evalPageExpression(expr) // nil → 保留原样
        }
        return url.takeIf { !$0.contains("{{") }.map { LegadoUrl(url: $0, charset: charset) }
    }

    private struct LegadoUrl {
        var url: String
        var charset: String?
        var method: String = "GET"
        var body: String? = nil
    }

    /// Kotlin `Regex("""\{\{([^{}]+)\}\}""").replace(url) { m -> eval ?: m.value }` 对应物
    private static func replaceTemplateExpressions(_ text: String, using transform: (String) -> String?) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"\{\{([^{}]+)\}\}"#) else { return text }
        let ns = text as NSString
        var out = ""
        var cursor = 0
        for m in regex.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            let inner = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
            out += transform(inner) ?? ns.substring(with: m.range)
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length { out += ns.substring(from: cursor) }
        return out
    }

    /** POST 搜索源：处理 URL 与 body 模板中的 {{key}}/{{page}} 占位符，不再直接跳过。 */
    private static func postUrl(_ url: String, _ opt: [String: Any]) -> LegadoUrl? {
        var u = url
        if u.contains("@js:") || u.contains("webView") { return nil }
        u = u
            .replacingOccurrences(of: "{{key}}", with: "{keyword}")
            .replacingOccurrences(of: "{{page}}", with: "{page}")
            .replacingOccurrences(of: #"\{\{java\.base64Encode\(key\)\}\}"#, with: "{keyword_b64}", options: .regularExpression)
        var body = str(opt, "body").takeIf { !$0.isBlank }
        body = body?
            .replacingOccurrences(of: "{{key}}", with: "{keyword}")
            .replacingOccurrences(of: "{{page}}", with: "{page}")
        let charset = str(opt, "charset").takeIf { !$0.isBlank }
        return u.takeIf { !$0.contains("{{") }.map { LegadoUrl(url: $0, charset: charset, method: "POST", body: body) }
    }

    private static func evalPageExpression(_ expr: String) -> String? {
        let normalized = expr.replacingOccurrences(of: " ", with: "")
        if normalized.contains("?") { return nil }
        // 仅支持 page 与数字的四则运算（页面首次加载固定为 page=1）
        let tokens = normalized.replacingOccurrences(of: "page", with: "1")
        if tokens.range(of: "^[0-9+\\-*/()]+$", options: .regularExpression) == nil { return nil }
        guard let result = SimpleArithmetic(tokens).evaluate() else { return nil }
        return String(result)
    }

    /** 极简四则运算求值器（仅数字、+ - * / 与括号）。 */
    private final class SimpleArithmetic {
        private let expr: String
        private var pos = 0

        init(_ expr: String) { self.expr = expr }

        func evaluate() -> Int64? {
            if expr.count > 256 || expr.filter({ $0 == "(" }).count > 32 { return nil }
            guard let value = expression() else { return nil }
            return pos == expr.count ? value : nil
        }

        private var peek: Character? {
            let chars = Array(expr)
            return pos < chars.count ? chars[pos] : nil
        }

        private func number() -> Int64? {
            var sb = ""
            let chars = Array(expr)
            while pos < chars.count, chars[pos].isNumber {
                sb.append(chars[pos])
                pos += 1
            }
            return Int64(sb)
        }

        private func factor() -> Int64? {
            if peek == "(" {
                pos += 1
                guard let v = expression() else { return nil }
                guard peek == ")" else { return nil }
                pos += 1
                return v
            }
            return number()
        }

        private func term() -> Int64? {
            guard var value = factor() else { return nil }
            while true {
                switch peek {
                case "*":
                    pos += 1
                    guard let f = factor() else { return nil }
                    let (r, overflow) = value.multipliedReportingOverflow(by: f)
                    if overflow { return nil } // Kotlin Math.multiplyExact
                    value = r
                case "/":
                    pos += 1
                    guard let divisor = factor(), divisor != 0 else { return nil }
                    value /= divisor
                default:
                    return value
                }
            }
        }

        private func expression() -> Int64? {
            guard var value = term() else { return nil }
            while true {
                switch peek {
                case "+":
                    pos += 1
                    guard let t = term() else { return nil }
                    let (r, overflow) = value.addingReportingOverflow(t)
                    if overflow { return nil } // Kotlin Math.addExact
                    value = r
                case "-":
                    pos += 1
                    guard let t = term() else { return nil }
                    let (r, overflow) = value.subtractingReportingOverflow(t)
                    if overflow { return nil } // Kotlin Math.subtractExact
                    value = r
                default:
                    return value
                }
            }
        }
    }

    private static func parseHeaderString(_ headerJson: String) -> [String: String] {
        if headerJson.isBlank { return [:] }
        guard let parsed = JsonPathResolver.parseJson(headerJson) as? [String: Any] else { return [:] }
        return parseHeaders(parsed)
    }

    private static func parseHeaders(_ headersObj: [String: Any]?) -> [String: String] {
        guard let headersObj else { return [:] }
        var result: [String: String] = [:]
        for (key, value) in headersObj {
            let v: String
            if let s = value as? String { v = s }
            else if let n = value as? NSNumber { v = n.stringValue }
            else { v = String(describing: value) }
            let trimmed = v.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isBlank {
                result[key] = trimmed
            }
        }
        return result
    }

    private struct ConvertedSource {
        var source: JsonBookSource?
        var rawJson: String
        var name: String = "未知书源"
        var reason: String? = nil
    }
}

extension String {
    /// Kotlin `fun String?.isNull_blank()` 对应物（SourceImporter 私有扩展提升为 internal）
    var isNull_blank: Bool { trimmingCharacters(in: .whitespaces).isEmpty }
}

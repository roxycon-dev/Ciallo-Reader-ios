import Foundation

// MARK: - 书源配置（SourceConfig.kt 镜像）

struct BookFieldRule {
    var id: String = "id"
    var title: String = "title"
    var author: String? = "author"
    var cover: String? = "cover"
    var description: String? = "description"
    var format: String? = "format"
    var downloadUrl: String? = "downloadUrl"
}

struct SearchRule {
    var url: String
    var method: String = "GET"
    var listPath: String = "books"
    var fields: BookFieldRule = BookFieldRule()
    var headers: [String: String] = [:]
    var body: String? = nil
}

struct DetailRule {
    var url: String
    var method: String = "GET"
    var fields: BookFieldRule = BookFieldRule()
    var headers: [String: String] = [:]
    var body: String? = nil
}

struct DownloadRule {
    var url: String? = nil
    var urlField: String? = "downloadUrl"
    var defaultFormat: String = "epub"
    var headers: [String: String] = [:]
}

struct HtmlSearchRule {
    var url: String
    var listSelector: String
    var titleSelector: String = ""
    var authorSelector: String = ""
    var coverSelector: String = ""
    var detailUrlSelector: String = ""
    var introSelector: String = ""
    var charset: String? = nil
    var method: String = "GET"
    var body: String? = nil
}

struct HtmlChapterRule {
    var url: String
    var listSelector: String
    var nameSelector: String = "text"
    var hrefSelector: String = "href"
    var tocUrlSelector: String? = nil
}

struct HtmlContentRule {
    var url: String
    var imageSelector: String
    /// 章节文字（Legado ruleContent.content）
    var textSelector: String? = nil
}

struct SourceConfig {
    var id: String
    var name: String
    var baseUrl: String = ""
    var search: SearchRule
    var detail: DetailRule? = nil
    var download: DownloadRule = DownloadRule()
    var htmlSearch: HtmlSearchRule? = nil
    var htmlChapters: HtmlChapterRule? = nil
    var htmlContent: HtmlContentRule? = nil
    var enabled: Bool = true
    var priority: Int = 0
    var isCustom: Bool = true
    var insecureTls: Bool = false
    var type: String? = nil
    var headers: [String: String] = [:]
}

// MARK: - 书源导入器（source/importer/SourceImporter.kt 对应物）
// 原生 SourceConfig JSON + Legado 书源 JSON 双通道。

enum SourceImporter {
    static func importFromJsonString(_ json: String) -> BookSource? {
        guard let root = JsonPathResolver.parseJson(json) else { return nil }
        if let dict = root as? [String: Any] {
            // Legado 书源：有 bookSourceUrl / ruleSearch
            if dict["bookSourceUrl"] != nil || dict["ruleSearch"] != nil {
                return convertLegadoSource(dict)
            }
            // 原生 SourceConfig
            if dict["search"] != nil || dict["htmlSearch"] != nil {
                return parseNativeSource(dict)
            }
        }
        if let arr = root as? [[String: Any]], let first = arr.first {
            return importFromJsonString(serialize(first))
        }
        return nil
    }

    static func serialize(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: 原生 SourceConfig

    static func parseNativeSource(_ dict: [String: Any]) -> BookSource? {
        guard let id = dict["id"] as? String, let name = dict["name"] as? String else { return nil }
        guard let searchDict = dict["search"] as? [String: Any] else { return nil }

        var config = SourceConfig(id: id, name: name,
                                  search: SearchRule(url: searchDict["url"] as? String ?? ""))
        config.baseUrl = dict["baseUrl"] as? String ?? ""
        config.type = dict["type"] as? String
        config.insecureTls = dict["insecureTls"] as? Bool ?? false
        let sd = searchDict
        config.search.method = sd["method"] as? String ?? "GET"
        config.search.listPath = sd["listPath"] as? String ?? "books"
        config.search.body = sd["body"] as? String
        config.search.headers = sd["headers"] as? [String: String] ?? [:]
        if let f = sd["fields"] as? [String: Any] {
            config.search.fields = parseFieldRule(f)
        }
        if let d = dict["detail"] as? [String: Any] {
            var rule = DetailRule(url: d["url"] as? String ?? "")
            rule.method = d["method"] as? String ?? "GET"
            rule.body = d["body"] as? String
            rule.headers = d["headers"] as? [String: String] ?? [:]
            if let f = d["fields"] as? [String: Any] { rule.fields = parseFieldRule(f) }
            config.detail = rule
        }
        if let dl = dict["download"] as? [String: Any] {
            config.download.url = dl["url"] as? String
            config.download.urlField = dl["urlField"] as? String ?? "downloadUrl"
            config.download.defaultFormat = dl["defaultFormat"] as? String ?? "epub"
            config.download.headers = dl["headers"] as? [String: String] ?? [:]
        }
        if let hs = dict["htmlSearch"] as? [String: Any] {
            config.htmlSearch = HtmlSearchRule(
                url: hs["url"] as? String ?? "",
                listSelector: hs["listSelector"] as? String ?? "",
                titleSelector: hs["titleSelector"] as? String ?? "",
                authorSelector: hs["authorSelector"] as? String ?? "",
                coverSelector: hs["coverSelector"] as? String ?? "",
                detailUrlSelector: hs["detailUrlSelector"] as? String ?? "",
                introSelector: hs["introSelector"] as? String ?? "",
                charset: hs["charset"] as? String,
                method: hs["method"] as? String ?? "GET",
                body: hs["body"] as? String
            )
        }
        if let hc = dict["htmlChapters"] as? [String: Any] {
            config.htmlChapters = HtmlChapterRule(
                url: hc["url"] as? String ?? "",
                listSelector: hc["listSelector"] as? String ?? "",
                nameSelector: hc["nameSelector"] as? String ?? "text",
                hrefSelector: hc["hrefSelector"] as? String ?? "href",
                tocUrlSelector: hc["tocUrlSelector"] as? String
            )
        }
        if let hcon = dict["htmlContent"] as? [String: Any] {
            config.htmlContent = HtmlContentRule(
                url: hcon["url"] as? String ?? "",
                imageSelector: hcon["imageSelector"] as? String ?? "",
                textSelector: hcon["textSelector"] as? String
            )
        }
        return JsonBookSource(config: config)
    }

    private static func parseFieldRule(_ f: [String: Any]) -> BookFieldRule {
        BookFieldRule(id: f["id"] as? String ?? "id",
                      title: f["title"] as? String ?? "title",
                      author: f["author"] as? String,
                      cover: f["cover"] as? String,
                      description: f["description"] as? String,
                      format: f["format"] as? String,
                      downloadUrl: f["downloadUrl"] as? String)
    }

    // MARK: Legado 转换

    static func convertLegadoSource(_ dict: [String: Any]) -> BookSource? {
        let url = dict["bookSourceUrl"] as? String ?? ""
        guard !url.isEmpty else { return nil }
        let name = dict["bookSourceName"] as? String ?? URL(string: url)?.host ?? url
        let id = "legado_" + String(abs(url.hashValue))

        var config = SourceConfig(id: id,
                                  name: name,
                                  baseUrl: url,
                                  search: SearchRule(url: ""))
        config.isCustom = true
        // bookSourceType: 0=文本 1=音频 2=图片(漫画) 3=文件
        let srcType = (dict["bookSourceType"] as? Int) ?? 0
        config.type = srcType == 0 ? "text" : (srcType == 2 ? "comic" : nil)
        if let headersJson = dict["header"] as? String,
           let parsed = JsonPathResolver.parseJson(headersJson) as? [String: String] {
            config.headers = parsed
        }

        // 搜索 URL（支持 url,{json} 选项）
        let searchUrlRaw = dict["searchUrl"] as? String ?? ""
        var method = "GET"
        var body: String? = nil
        var charset: String? = nil
        var searchUrl = searchUrlRaw
        if let comma = searchUrlRaw.range(of: ",{") {
            searchUrl = String(searchUrlRaw[searchUrlRaw.startIndex..<comma.lowerBound])
            let optionJson = String(searchUrlRaw[comma.upperBound...])
            if let opts = JsonPathResolver.parseJson(optionJson) as? [String: Any] {
                method = opts["method"] as? String ?? "GET"
                body = opts["body"] as? String
                charset = opts["charset"] as? String
            }
        }
        let ruleSearch = dict["ruleSearch"] as? [String: Any] ?? [:]
        config.htmlSearch = HtmlSearchRule(
            url: searchUrl,
            listSelector: ruleSearch["bookList"] as? String ?? "",
            titleSelector: ruleSearch["name"] as? String ?? "",
            authorSelector: ruleSearch["author"] as? String ?? "",
            coverSelector: ruleSearch["coverUrl"] as? String ?? "",
            detailUrlSelector: ruleSearch["bookUrl"] as? String ?? "",
            introSelector: ruleSearch["intro"] as? String ?? "",
            charset: charset,
            method: method,
            body: body
        )
        // 详情
        let ruleBookInfo = dict["ruleBookInfo"] as? [String: Any] ?? [:]
        config.htmlChapters = HtmlChapterRule(
            url: "{id}",
            listSelector: (dict["ruleToc"] as? [String: Any])?["chapterList"] as? String ?? "",
            nameSelector: (dict["ruleToc"] as? [String: Any])?["chapterName"] as? String ?? "text",
            hrefSelector: (dict["ruleToc"] as? [String: Any])?["chapterUrl"] as? String ?? "href",
            tocUrlSelector: ruleBookInfo["tocUrl"] as? String
        )
        config.htmlContent = HtmlContentRule(
            url: "{chapterUrl}",
            imageSelector: "img@src",
            textSelector: (dict["ruleContent"] as? [String: Any])?["content"] as? String
        )
        return JsonBookSource(config: config)
    }
}

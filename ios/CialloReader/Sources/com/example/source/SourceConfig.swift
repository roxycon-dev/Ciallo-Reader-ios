// 对齐 novel-reader/app/src/main/java/com/example/source/SourceConfig.kt（85 行）

import Foundation

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
    var url: String // e.g. https://example.com/search?q={keyword}
    var method: String = "GET"
    var listPath: String = "books" // e.g. "data.books"
    var fields: BookFieldRule = BookFieldRule()
    var headers: [String: String] = [:]
    var body: String? = nil
}

struct DetailRule {
    var url: String // e.g. https://example.com/book/{id}
    var method: String = "GET"
    var fields: BookFieldRule = BookFieldRule()
    var headers: [String: String] = [:]
    var body: String? = nil
}

struct DownloadRule {
    var url: String? = nil // e.g. https://example.com/download/{id}
    var urlField: String? = "downloadUrl" // if url in JSON item
    var defaultFormat: String = "epub"
    var headers: [String: String] = [:]
}

/**
 * HTML(CSS 选择器) 书源规则 —— 允许用户在 App 内粘贴 JSON 定义任意 HTML 站点，
 * 无需修改代码即可添加小说/漫画源。
 */
struct HtmlSearchRule {
    var url: String                    // 搜索地址，支持 {keyword} {page}
    var listSelector: String           // 结果列表项 CSS
    var titleSelector: String = ""     // 标题，支持 "css@text" / "css@attr"
    var authorSelector: String = ""
    var coverSelector: String = ""
    var detailUrlSelector: String = "" // 详情链接，默认 "a@href"
    var introSelector: String = ""     // 简介（Legado ruleSearch.intro）
    var charset: String? = nil         // 页面编码（gbk / gb2312 / utf-8），默认自动
    var method: String = "GET"         // 请求方式（Legado 搜索支持 POST）
    var body: String? = nil            // POST 请求体模板，支持 {keyword}
}

struct HtmlChapterRule {
    var url: String                    // 目录页地址，支持 {id}
    var listSelector: String           // 章节列表项 CSS
    var nameSelector: String = "text"
    var hrefSelector: String = "href"
    /** 目录页跳转规则（Legado ruleBookInfo.tocUrl）：目录不在详情页时，
     *  先取 {id} 页，用此规则解析出目录页 URL；空则直接用 {id} 页作目录页 */
    var tocUrlSelector: String? = nil
}

struct HtmlContentRule {
    var textSelector: String? = nil
    var url: String                    // 阅读页地址，支持 {chapterUrl}
    var imageSelector: String          // 图片选择器，如 "img.page@src" 或 "img@data-src"
}

struct SourceConfig {
    var headers: [String: String] = [:]
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
    /// 可选：显式声明内容类型 "comic"/"novel"/"text"，不声明时按规则自动判断。
    var type: String? = nil
}

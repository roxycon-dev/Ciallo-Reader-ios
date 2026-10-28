/**
 * Android source: `com.example.source.SourceConfig.kt`
 * Data classes: BookFieldRule, SearchRule, DetailRule, DownloadRule,
 * HtmlSearchRule, HtmlChapterRule, HtmlContentRule, SourceConfig.
 */

export interface BookFieldRule {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly cover: string | null;
  readonly description: string | null;
  readonly format: string | null;
  readonly downloadUrl: string | null;
}

export function createBookFieldRule(overrides: Partial<BookFieldRule> = {}): BookFieldRule {
  return {
    id: 'id',
    title: 'title',
    author: 'author',
    cover: 'cover',
    description: 'description',
    format: 'format',
    downloadUrl: 'downloadUrl',
    ...overrides,
  };
}

export interface SearchRule {
  readonly url: string; // e.g. https://example.com/search?q={keyword}
  readonly method: string;
  readonly listPath: string; // e.g. "data.books"
  readonly fields: BookFieldRule;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export function createSearchRule(params: {
  url: string;
  method?: string;
  listPath?: string;
  fields?: BookFieldRule;
  headers?: Record<string, string>;
  body?: string | null;
}): SearchRule {
  return {
    url: params.url,
    method: params.method ?? 'GET',
    listPath: params.listPath ?? 'books',
    fields: params.fields ?? createBookFieldRule(),
    headers: params.headers ?? {},
    body: params.body ?? null,
  };
}

export interface DetailRule {
  readonly url: string; // e.g. https://example.com/book/{id}
  readonly method: string;
  readonly fields: BookFieldRule;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export function createDetailRule(params: {
  url: string;
  method?: string;
  fields?: BookFieldRule;
  headers?: Record<string, string>;
  body?: string | null;
}): DetailRule {
  return {
    url: params.url,
    method: params.method ?? 'GET',
    fields: params.fields ?? createBookFieldRule(),
    headers: params.headers ?? {},
    body: params.body ?? null,
  };
}

export interface DownloadRule {
  readonly url: string | null; // e.g. https://example.com/download/{id}
  readonly urlField: string | null; // if url in JSON item
  readonly defaultFormat: string;
  readonly headers: Record<string, string>;
}

export function createDownloadRule(
  params: {
    url?: string | null;
    urlField?: string | null;
    defaultFormat?: string;
    headers?: Record<string, string>;
  } = {},
): DownloadRule {
  return {
    url: params.url ?? null,
    urlField: params.urlField ?? 'downloadUrl',
    defaultFormat: params.defaultFormat ?? 'epub',
    headers: params.headers ?? {},
  };
}

/**
 * HTML(CSS 选择器) 书源规则 —— 允许用户在 App 内粘贴 JSON 定义任意 HTML 站点，
 * 无需修改代码即可添加小说/漫画源。
 */
export interface HtmlSearchRule {
  readonly url: string; // 搜索地址，支持 {keyword} {page}
  readonly listSelector: string; // 结果列表项 CSS
  readonly titleSelector: string; // 标题，支持 "css@text" / "css@attr"
  readonly authorSelector: string;
  readonly coverSelector: string;
  readonly detailUrlSelector: string; // 详情链接，默认 "a@href"
  readonly introSelector: string; // 简介（Legado ruleSearch.intro）
  readonly charset: string | null; // 页面编码（gbk / gb2312 / utf-8），默认自动
  readonly method: string; // 请求方式（Legado 搜索支持 POST）
  readonly body: string | null; // POST 请求体模板，支持 {keyword}
}

export function createHtmlSearchRule(params: {
  url: string;
  listSelector: string;
  titleSelector?: string;
  authorSelector?: string;
  coverSelector?: string;
  detailUrlSelector?: string;
  introSelector?: string;
  charset?: string | null;
  method?: string;
  body?: string | null;
}): HtmlSearchRule {
  return {
    url: params.url,
    listSelector: params.listSelector,
    titleSelector: params.titleSelector ?? '',
    authorSelector: params.authorSelector ?? '',
    coverSelector: params.coverSelector ?? '',
    detailUrlSelector: params.detailUrlSelector ?? '',
    introSelector: params.introSelector ?? '',
    charset: params.charset ?? null,
    method: params.method ?? 'GET',
    body: params.body ?? null,
  };
}

export interface HtmlChapterRule {
  readonly url: string; // 目录页地址，支持 {id}
  readonly listSelector: string; // 章节列表项 CSS
  readonly nameSelector: string;
  readonly hrefSelector: string;
  /**
   * 目录页跳转规则（Legado ruleBookInfo.tocUrl）：目录不在详情页时，
   * 先取 {id} 页，用此规则解析出目录页 URL；空则直接用 {id} 页作目录页
   */
  readonly tocUrlSelector: string | null;
}

export function createHtmlChapterRule(params: {
  url: string;
  listSelector: string;
  nameSelector?: string;
  hrefSelector?: string;
  tocUrlSelector?: string | null;
}): HtmlChapterRule {
  return {
    url: params.url,
    listSelector: params.listSelector,
    nameSelector: params.nameSelector ?? 'text',
    hrefSelector: params.hrefSelector ?? 'href',
    tocUrlSelector: params.tocUrlSelector ?? null,
  };
}

export interface HtmlContentRule {
  readonly url: string; // 阅读页地址，支持 {chapterUrl}
  readonly imageSelector: string; // 图片选择器，如 "img.page@src" 或 "img@data-src"
}

export function createHtmlContentRule(params: {
  url: string;
  imageSelector: string;
}): HtmlContentRule {
  return {
    url: params.url,
    imageSelector: params.imageSelector,
  };
}

export interface SourceConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly search: SearchRule;
  readonly detail: DetailRule | null;
  readonly download: DownloadRule;
  readonly htmlSearch: HtmlSearchRule | null;
  readonly htmlChapters: HtmlChapterRule | null;
  readonly htmlContent: HtmlContentRule | null;
  readonly enabled: boolean;
  readonly priority: number;
  readonly isCustom: boolean;
  readonly insecureTls: boolean;
  /** 可选：显式声明内容类型 "comic"/"novel"/"text"，不声明时按规则自动判断。 */
  readonly type: string | null;
}

export function createSourceConfig(params: {
  id: string;
  name: string;
  baseUrl?: string;
  search: SearchRule;
  detail?: DetailRule | null;
  download?: DownloadRule;
  htmlSearch?: HtmlSearchRule | null;
  htmlChapters?: HtmlChapterRule | null;
  htmlContent?: HtmlContentRule | null;
  enabled?: boolean;
  priority?: number;
  isCustom?: boolean;
  insecureTls?: boolean;
  type?: string | null;
}): SourceConfig {
  return {
    id: params.id,
    name: params.name,
    baseUrl: params.baseUrl ?? '',
    search: params.search,
    detail: params.detail ?? null,
    download: params.download ?? createDownloadRule(),
    htmlSearch: params.htmlSearch ?? null,
    htmlChapters: params.htmlChapters ?? null,
    htmlContent: params.htmlContent ?? null,
    enabled: params.enabled ?? true,
    priority: params.priority ?? 0,
    isCustom: params.isCustom ?? true,
    insecureTls: params.insecureTls ?? false,
    type: params.type ?? null,
  };
}

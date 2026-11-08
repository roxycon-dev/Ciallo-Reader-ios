/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/help/JsonSourceGuideCard.kt` (131 non-blank lines) — FULL PORT
 *   lines 19-138 `@Composable JsonSourceGuideCard(modifier)` → JsonSourceGuideCard
 *   lines 60-82 the JSON template string literal   → JSON_TEMPLATE (verbatim)
 *   lines 104-112 the `fields` list of pairs      → JSON_SOURCE_FIELDS (verbatim)
 *
 * Every user-visible Chinese string and every JSON key is preserved verbatim.
 *
 * ADAPTATION — the code block uses `AppFonts.Monospace` + `#1E1E1E` background with
 * `#D4D4D4` text; on a light theme the same pairing is kept (the block is
 * intentionally dark on Android, so it stays dark here).
 */
export const JSON_TEMPLATE = `{
  "id": "example_comic",
  "name": "示例漫画源",
  "baseUrl": "https://example.com",
  "htmlSearch": {
    "url": "/search?q={keyword}",
    "listSelector": "@css:ul.list li.item",
    "title": "@css:a.book-name@text",
    "author": "@css:span.author@text",
    "cover": "@css:img.cover@data-src",
    "detailUrl": "@css:a.book-name@href"
  },
  "htmlChapters": {
    "url": "{id}",
    "listSelector": "@css:ul.chapters li",
    "name": "@css:a@text",
    "href": "@css:a@href"
  },
  "htmlContent": {
    "url": "{chapterUrl}",
    "imageSelector": "@css:div.reader img@data-src"
  }
}`;

/** Kotlin lines 104-112 — 字段说明表, verbatim. */
export const JSON_SOURCE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['id', '唯一英文字符标识，保证书源独立性'],
  ['name', '在书源列表中显示的友好名称'],
  ['baseUrl', '站点主站域名，用于拼合相对路径'],
  ['htmlSearch.url', '搜索地址，{keyword} 替换关键词，{page} 替换页码'],
  ['htmlSearch.listSelector', '结果列表项规则（支持 Legado 语法与 @css:）'],
  ['htmlChapters.url', '目录页地址，{id} 为搜索结果详情链接'],
  ['htmlContent.imageSelector', '章节图片规则，支持 @src / @data-src / JSONPath'],
];

export function JsonSourceGuideCard(props: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={['json-source-guide', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <p className="json-source-guide__title">什么是 JSON 书源？</p>
      <div style={{ height: 6 }} />
      <p className="json-source-guide__lead">
        JSON 书源是一种不需要修改 APP 代码即可扩展站点检索的配置文件，兼容「开源阅读 Legado」社区规则。您只需用选择器描述搜索、目录和图片规则：
      </p>

      <div style={{ height: 12 }} />

      <p className="json-source-guide__subtitle">漫画/图集站 JSON 模板（可直接复制修改）：</p>
      <div style={{ height: 6 }} />
      <pre className="json-source-guide__code">
        <code>{JSON_TEMPLATE}</code>
      </pre>

      <div style={{ height: 16 }} />

      {/* Table Header */}
      <div className="json-source-guide__thead">
        <span className="json-source-guide__th json-source-guide__th--field">字段名称</span>
        <span className="json-source-guide__th json-source-guide__th--desc">对应描述与作用说明</span>
      </div>

      {JSON_SOURCE_FIELDS.map(([field, desc]) => (
        <div className="json-source-guide__row" key={field}>
          <span className="json-source-guide__td json-source-guide__td--field">{field}</span>
          <span className="json-source-guide__td json-source-guide__td--desc">{desc}</span>
        </div>
      ))}
    </div>
  );
}
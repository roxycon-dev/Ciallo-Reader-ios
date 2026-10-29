/**
 * Kotlin → TS map
 * ──────────────
 * Text-level parity tests for `ui/help/*.kt` → `src/ui/components/help/*.tsx`.
 *
 * The protocol requires Chinese copy to be transcribed **verbatim**; these tests
 * pin every user-visible string in the four files against the Kotlin source so a
 * later edit cannot silently reword the FAQ, the JSON-source guide (which book
 * source authors read) or the field table.
 *
 * Sources:
 *  - `ui/help/LibraryHelpBottomSheet.kt` L121, L131-151, L156/158, L164/166,
 *    L172/174, L180/182, L188-207, L214, L237, L285, L319, L338, L344, L253
 *  - `ui/help/JsonSourceGuideCard.kt` L29, L36, L46, L60-82, L99-100, L104-112
 *  - `ui/help/HelpSection.kt` — no copy of its own (all strings are props)
 */
import { readFileSync } from 'node:fs';
import { androidReference } from '../helpers/androidReference';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { JSON_SOURCE_FIELDS, JSON_TEMPLATE } from '../../src/ui/components/help/JsonSourceGuideCard';
import { COPY_TEMPLATE_MESSAGE } from '../../src/ui/components/help/LibraryHelpBottomSheet';
import { hashCode } from '../../src/ui/components/help/FaqExpandableItem';
import { HELP_PRIMARY } from '../../src/ui/components/help/HelpSection';

function kotlinSource(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/ui/${rel}`), 'utf8');
}

function tsSource(rel: string): string {
  return readFileSync(
    path.resolve(import.meta.dirname, '../../src/ui/components/help', rel),
    'utf8',
  );
}

/** Every `text = "…"`, `title = "…"`, `desc = "…"`, `question = "…"`, `answer = "…"` in Kotlin. */
function kotlinLiterals(src: string): string[] {
  // `m[1]` 在 `noUncheckedIndexedAccess` 下是 `string | undefined`，但这个正则一定
  // 捕获了第 1 组（组 1 是整个模式里唯一的捕获组），所以这里 filter 掉 undefined。
  return [...src.matchAll(/(?:title|desc|question|answer|text)\s*=\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined);
}

/** Code-ish fragments that can sit between `>` and `<` but are not user copy. */
const NOT_COPY = /[;(){}]|=>|\bconst\b|\breturn\b/;

/**
 * Every single-quoted literal, every double-quoted JSX prop, and every JSX text
 * node (single- **and** multi-line — the FAQ answers and the shortcut labels are
 * written on their own source line). Code fragments are filtered out.
 */
function tsLiterals(src: string): string[] {
  const out: string[] = [];
  // 三条正则各自都只有一个捕获组（索引 1 / 2 / 1），`noUncheckedIndexedAccess` 下
  // 读成 `string | undefined`，所以统一过滤掉 undefined（filter 保持原判断力）。
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    const s = m[1];
    if (s !== undefined) out.push(s.replace(/\\'/g, "'"));
  }
  for (const m of src.matchAll(/(?:^|[\s{(])([a-zA-Z-]+)="((?:[^"\\\n]|\\.)*)"/g)) {
    const s = m[2];
    if (s !== undefined) out.push(s);
  }
  for (const m of src.matchAll(/>([^<>{}]+)</g)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t !== '' && !NOT_COPY.test(t)) out.push(t);
  }
  return out;
}

const JSX_ENTITIES: Array<[RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&amp;/g, '&'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
];

function decode(s: string): string {
  // `JSX_ENTITIES` 是模块级字面量表（`[RegExp, string]` 元组），解构出来的 `re`/`to`
  // 一定是 `string`；`replace(re, to)` 只要求 `to` 是 string，`re` 走 string 形态。
  return JSX_ENTITIES.reduce((acc, pair) => acc.replace(pair[0], pair[1]), s);
}

describe('LibraryHelpBottomSheet — every FAQ / section string is verbatim', () => {
  const kotlin = kotlinLiterals(kotlinSource('help/LibraryHelpBottomSheet.kt'));
  const ts = tsLiterals(tsSource('LibraryHelpBottomSheet.tsx')).map(decode);

  it('found the expected number of Kotlin literals (guards the extractor)', () => {
    expect(kotlin.length).toBeGreaterThanOrEqual(34);
  });

  const missing = kotlin.filter((s) => !ts.includes(s));
  it(`all ${kotlin.length} Kotlin strings appear verbatim in the TSX (missing: ${missing.length})`, () => {
    expect(missing).toEqual([]);
  });

  it('the six section headers keep their numbering and wording', () => {
    for (const h of [
      '1. 快速上手',
      '2. 搜索与搜索历史',
      '3. 下载与进度',
      '4. 书源管理',
      '5. 漫画阅读',
      '6. 常见问题',
    ]) {
      expect(ts).toContain(h);
    }
  });

  it('the four FAQ questions and answers are byte-identical', () => {
    expect(ts).toContain('为什么搜索没有结果？');
    expect(ts).toContain(
      '确认当前书源已启用且网络正常；可尝试切换“聚合漫画（全部）”或更换关键词。个别源因站点维护 / 网络波动失败时，不影响其他源继续搜索。',
    );
    expect(ts).toContain('下载后书架没有书？');
    expect(ts).toContain(
      '下载完成后系统需要解析 / 打包，稍等片刻再进入书架刷新。漫画需要先在章节页下载章节，才会出现在书架。',
    );
    expect(ts).toContain('成人漫画源不显示？');
    expect(ts).toContain(
      '成人漫画源已固定开启，无需点击解锁或使用开关。请在书源管理中更新 Venera 源列表，更新完成后回到书库，在漫画书源选择器中选择需要的来源。',
    );
    expect(ts).toContain('自定义 JSON 源搜不到？');
    expect(ts).toContain(
      '先确认 listSelector / detailUrl 与站点当前 HTML 匹配，推荐先用 @css: 规则，并用浏览器开发者工具核对元素类名；需要登录或 JS 渲染的站点暂不支持。',
    );
  });

  it('the four 快速上手 steps keep title + desc', () => {
    expect(ts).toContain('选择书源');
    expect(ts).toContain(
      '顶部书源选择器可切换小说源或漫画源；选择“聚合漫画（全部）”可并行搜索已启用的漫画源。Venera 源可在书源管理中更新。',
    );
    expect(ts).toContain('搜索图书');
    expect(ts).toContain(
      '输入书名或作者后点击搜索 / 回车；可按小说或漫画查看分类结果。点击搜索框会显示搜索历史，点历史词可直接再次搜索，也可一键清空。',
    );
    expect(ts).toContain('下载与阅读');
    expect(ts).toContain(
      '结果卡片点击“下载/阅读”：小说自动后台下载到书架，漫画先进章节页，选择章节在线阅读或下载。',
    );
    expect(ts).toContain('打开书架');
    expect(ts).toContain('下载完成的书籍会出现在书架，点击即可打开阅读器，支持离线阅读。');
  });

  it('the shortcut labels and the version footer are verbatim', () => {
    expect(ts).toContain('快捷操作');
    expect(ts).toContain('打开书源管理');
    // Kotlin L285 says 「查看JSON模板」 even though the action copies — kept as-is.
    expect(ts).toContain('查看JSON模板');
    expect(ts).toContain('清除下载临时文件');
    expect(ts).toContain('Ciallo Reader · 书库引擎');
    expect(ts).toContain('Legado Rule Compatible · Venera JS 兼容');
    // Brand string must be `Ciallo Reader`, never `Ciallo阅读`.
    expect(ts.join('\n')).not.toContain('Ciallo阅读');
  });

  it('the clipboard toast matches Kotlin L253', () => {
    expect(COPY_TEMPLATE_MESSAGE).toBe('已复制 JSON 示例模板到剪贴板');
  });

  it('the two toast outcomes of the .tmp sweep match Kotlin L309', () => {
    const src = tsSource('LibraryHelpBottomSheet.tsx');
    expect(src).toContain('已清除 ${count} 个下载临时文件');
    expect(src).toContain('没有可清理的下载临时文件');
  });

  it('the sheet chrome keeps the Kotlin testTags', () => {
    const src = tsSource('LibraryHelpBottomSheet.tsx');
    for (const tag of [
      'library_help_bottom_sheet',
      'close_help_bottom_sheet_button',
      'shortcut_open_source_manager',
      'shortcut_copy_template',
      'shortcut_clear_cache',
    ]) {
      expect(src).toContain(tag);
    }
    // Kotlin L78 / L96 contentDescriptions.
    expect(src).toContain('帮助中心');
    expect(src).toContain('关闭帮助');
  });
});

describe('JsonSourceGuideCard — the book-source-author guide is verbatim', () => {
  const kotlin = kotlinSource('help/JsonSourceGuideCard.kt');
  const ts = tsSource('JsonSourceGuideCard.tsx');

  it('every prose string appears verbatim', () => {
    for (const s of [
      '什么是 JSON 书源？',
      'JSON 书源是一种不需要修改 APP 代码即可扩展站点检索的配置文件，兼容「开源阅读 Legado」社区规则。您只需用选择器描述搜索、目录和图片规则：',
      '漫画/图集站 JSON 模板（可直接复制修改）：',
      '字段名称',
      '对应描述与作用说明',
    ]) {
      expect(tsLiterals(ts).map(decode)).toContain(s);
    }
  });

  it('the copy template is character-for-character the Kotlin literal', () => {
    // Kotlin L60-82 is a raw string inside `text = """…"""`.
    const m = kotlin.match(/text\s*=\s*"""([\s\S]*?)"""/);
    expect(m).not.toBeNull();
    const ktTemplate = (m as RegExpMatchArray)[1];
    expect(JSON_TEMPLATE).toBe(ktTemplate?.replace(/\r\n/g, '\n'));
    // …and it is valid JSON, so 「可直接复制修改」 actually holds.
    expect(JSON.parse(JSON_TEMPLATE)).toMatchObject({
      id: 'example_comic',
      name: '示例漫画源',
      baseUrl: 'https://example.com',
    });
  });

  it('the field table keeps all seven rows in order with verbatim descriptions', () => {
    const ktRows = [...kotlin.matchAll(/"([^"]+)"\s+to\s+"((?:[^"\\]|\\.)*)"/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(ktRows).toHaveLength(7);
    expect(JSON_SOURCE_FIELDS).toEqual(ktRows);
  });
});

describe('HelpSection / FaqExpandableItem', () => {
  it('MintPrimary is the theme primary the Kotlin code samples (BasePrimaryColors[2])', () => {
    // Theme.kt L19 → Color(0xFF059669)
    expect(HELP_PRIMARY.toLowerCase()).toBe('#059669');
  });

  it('hashCode matches the JVM String.hashCode used by testTag("faq_item_…")', () => {
    // Fixed vectors from the JVM implementation (31*h + c, int overflow).
    expect(hashCode('')).toBe(0);
    expect(hashCode('a')).toBe(97);
    expect(hashCode('ab')).toBe(97 * 31 + 98);
    expect(hashCode('为什么搜索没有结果？')).toBe(hashCode('为什么搜索没有结果？'));
    // A 3-char string that overflows 2^31, to prove the |0 wraparound.
    expect(hashCode('~~~')).toBe((126 * 31 * 31 + 126 * 31 + 126) | 0);
  });

  it('the expand arrow contentDescription switches 展开 / 收起', () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, '../../src/ui/components/help/FaqExpandableItem.tsx'),
      'utf8',
    );
    expect(src).toContain("expanded ? '收起' : '展开'");
    expect(kotlinSource('help/FaqExpandableItem.kt')).toContain(
      'contentDescription = if (expanded) "收起" else "展开"',
    );
  });

  it('the FAQ answer animation is a 250ms grid-template-rows transition (expand/shrink)', () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, '../../src/styles/help.css'),
      'utf8',
    );
    expect(css).toContain("transition: grid-template-rows 250ms");
    expect(css).toContain('grid-template-rows: 0fr');
    expect(css).toContain("grid-template-rows: 1fr");
  });
});

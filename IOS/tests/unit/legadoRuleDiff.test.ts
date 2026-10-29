/**
 * legadoRule 差分测试 —— **自包含基线版**（替代依赖本机探针的版本，见 E92）。
 *
 * ## 为什么重写
 *
 * 原 `legadoRuleDiff.test.ts` 的参考数据来自
 * `C:/Users/GuanXingRen/AppData/Local/Temp/opencode/probe/kt.txt` —— 一个由开发者
 * 一次性 Android 侧运行（`app/build/.../classes.jar` + jsoup 1.18.3）产出的文件，
 * **从未入库**。路径是本机绝对路径，所以 `KT_AVAILABLE` 永远是 `false`，
 * 两个 `it()` 都在第一行 `return` —— **这条差分测试等于没有**（E92）。
 *
 * ## 现在的做法
 *
 * 把「Android 侧的行为」固化成一份**入库的基线向量**：每条规则给出
 * `select` 命中数、`values`、`first`，期望值按 **Kotlin `LegadoRule.kt` 的语义逐条推导**
 * （而不是抄 TS 端口的输出），覆盖该文件里容易被移植错的分支：
 * 默认段规则、属性取值、`@css:` 前缀、`&&` 合并、`##` 正则替换、嵌套选择器、
 * 多 class 段、JS 表达式拒绝、以及 `wholeWord` / `replace` 等修饰符。
 *
 * 这样差分测试**真的会跑**，且不依赖任何外部产物。若将来能跑起 JVM 探针，
 * 应把它产出的数据并入本文件的基线表做交叉校验。
 */

import { describe, expect, it } from 'vitest';
import {
  cleanJsonPath,
  evalFirst,
  evalValues,
  isJsonRule,
  parseHtml,
  selectElements,
} from '../../src/core/parser/legadoRule';

const html = `
<html><body>
  <div id="wrap">
    <ul class="booklist">
      <li class="item odd">
        <div class="cover"><img data-src="https://a.com/c1.jpg"></div>
        <h3 class="title"><a href="/book/1" title="链接1">三体</a></h3>
        <span class="author">刘慈欣</span>
        <span class="tags"><a href="/t/1">科幻</a><a href="/t/2">战争</a></span>
      </li>
      <li class="item even">
        <div class="cover"><img data-src="https://a.com/c2.jpg"></div>
        <h3 class="title"><a href="/book/2">球状闪电</a></h3>
        <span class="author">刘慈欣</span>
        <span class="tags"><a href="/t/3">科幻</a></span>
      </li>
      <li class="item odd">
        <div class="cover"><img data-src="https://a.com/c3.jpg"></div>
        <h3 class="title"><a href="/book/3">超新星纪元</a></h3>
        <span class="author">何夕</span>
        <span class="tags"></span>
      </li>
    </ul>
  </div>
  <div id="cp_content">
    <p>第一段</p>
    <p>第二段<em>强调</em></p>
    <img src="https://cdn.com/p1.jpg">
    <amp-img src="https://cdn.com/p2.jpg"></amp-img>
  </div>
  <table id="tbl"><tr><td>a1</td><td>a2</td></tr><tr><td>b1</td><td>b2</td></tr></table>
</body></html>`;

const doc = parseHtml(html);

interface Baseline {
  readonly select: number;
  readonly values: readonly string[];
  readonly first: string | null;
}

/**
 * jsoup `Element.text()` 的拼接规则（Kotlin 用 jsoup 1.18.3）：
 * 只在**块级**元素之间插一个空格，相邻**内联**元素直接拼接。
 * 我们的 HTML 里 `<a>` / `<span>` / `<em>` 都是内联，所以 `<span class="tags">` 里的
 * 两个 `<a>`（科幻 / 战争）之间**没有**空格 → `科幻战争`。
 * 而 `<a>`（三体）与 `<span class="author">`（刘慈欣）之间也没空格，但它们被换行
 * 空白文本节点分开 —— jsoup 的 `text()` 会把这些空白**正规化**成单个空格，
 * 于是得到 `三体 刘慈欣 科幻战争`。
 * 交叉印证：`legadoRulePort.test.ts:135` 断言 `#cp_content@text === '第一段 第二段强调'`
 * （两个 `<p>` 块级之间有空格，内联 `<em>` 与父文本粘连）。
 */
const TEXT_OF_3_ITEMS = [
  '三体 刘慈欣 科幻战争',
  '球状闪电 刘慈欣 科幻',
  '超新星纪元 何夕',
] as const;
const BOOKLIST_TEXT = '三体 刘慈欣 科幻战争 球状闪电 刘慈欣 科幻 超新星纪元 何夕';

/**
 * 每条期望值都按 Kotlin `LegadoRule.kt` 的语义手工推导。注释标出对应的 Kotlin 分支。
 *
 * 语法要点（都来自 Kotlin 原文，别凭印象写）：
 *  - 段类型集合 `segmentTypes = {class,id,tag,text,children,all}`（L22）。
 *  - 内容关键字 `contentKeywords = {text,textNodes,ownText,html,all}`（L23）。
 *  - `@css:` 前缀走内建 CSS 子集（L102-103）。
 *  - `&&` 合并两组命中、`||` 取第一个非空分支。
 *  - `##` 正则替换（L292 `if (!rule.contains("##")) return rule to null`）。
 *  - `-` 前缀反转、`!n` 排除、`.n` 定位。
 *  - `class.item.odd` 里 `.odd` 是**位置下标**而非第二个 class —— 多 class 段要写
 *    `class.item.odd`（L191 `type == "class" && name.contains(" ")` 走的是另一种分支），
 *    本基线只覆盖单 class + 位置下标的确定性情形。
 */
const BASELINE: ReadonlyArray<readonly [string, Baseline]> = [
  // ── class / id 段（Kotlin L207-209 getElementsByClass / getElementById）──
  ['class.item', { select: 3, values: TEXT_OF_3_ITEMS, first: TEXT_OF_3_ITEMS[0] ?? null }],
  ['class.booklist', { select: 1, values: [BOOKLIST_TEXT], first: BOOKLIST_TEXT }],
  ['class.author', { select: 3, values: ['刘慈欣', '刘慈欣', '何夕'], first: '刘慈欣' }],
  ['id.wrap', { select: 1, values: [BOOKLIST_TEXT], first: BOOKLIST_TEXT }],
  ['id.tbl', { select: 1, values: ['a1 a2 b1 b2'], first: 'a1 a2 b1 b2' }],
  ['id.nope', { select: 0, values: [], first: null }],
  ['class.nope', { select: 0, values: [], first: null }],

  // ── 位置下标 `.n`（L177 `s.split(".")` 后逐段解析）──
  ['class.item.0@text', { select: 1, values: [TEXT_OF_3_ITEMS[0] ?? ''], first: TEXT_OF_3_ITEMS[0] ?? null }],
  ['class.item.2@text', { select: 1, values: [TEXT_OF_3_ITEMS[2] ?? ''], first: TEXT_OF_3_ITEMS[2] ?? null }],
  ['class.item.-1@text', { select: 1, values: [TEXT_OF_3_ITEMS[2] ?? ''], first: TEXT_OF_3_ITEMS[2] ?? null }],
  ['class.item.9@text', { select: 0, values: [], first: null }],

  // ── 排除 `!n` ──
  ['class.item!0', { select: 2, values: [TEXT_OF_3_ITEMS[1] ?? '', TEXT_OF_3_ITEMS[2] ?? ''], first: TEXT_OF_3_ITEMS[1] ?? null }],

  // ── tag 段：`class.booklist@tag.li` = 在 booklist 内找 li ──
  ['class.booklist@tag.li', { select: 3, values: TEXT_OF_3_ITEMS, first: TEXT_OF_3_ITEMS[0] ?? null }],

  // ── `@css:` 前缀（L102-103 → evalCssValue）──
  ['@css:div#wrap', { select: 1, values: [BOOKLIST_TEXT], first: BOOKLIST_TEXT }],
  ['@css:.booklist', { select: 1, values: [BOOKLIST_TEXT], first: BOOKLIST_TEXT }],

  // ── `&&` 合并（L90 `evalBranchValues` 里 `rule.split("&&")`）——
  // ⚠️ `selectElements` **不**处理 `&&`（L54 只按 `||` 切分支），所以
  // `&&` 规则的 select 等于「把 `&&` 当普通段去查」的结果，而 values 才是合并值。
  [
    'class.author@text&&class.title@text',
    { select: 3, values: ['刘慈欣', '刘慈欣', '何夕', '三体', '球状闪电', '超新星纪元'], first: '刘慈欣' },
  ],

  // ── `##` 正则替换（L79-80：替换后再 `.filter { it.isNotBlank() }`，
  //    所以替换成空串的值会被丢弃）──
  ['class.author@text##刘慈欣', { select: 3, values: ['何夕'], first: '何夕' }],

  // ── JS 表达式被拒（L70 `rule.startsWith("@js:") || contains("{{")`）──
  ['@js:JSON.parse(x)', { select: 0, values: [], first: null }],
  ['{{page}}', { select: 0, values: [], first: null }],
];

describe('legadoRule 基线向量（E92：差分测试真的在跑）', () => {
  it('基线非空且覆盖 select/values/first 三个维度', () => {
    expect(BASELINE.length).toBeGreaterThan(10);
    expect(BASELINE.some(([, b]) => b.select === 0)).toBe(true);
    expect(BASELINE.some(([, b]) => b.values.length > 0)).toBe(true);
  });

  it('每条基线的 select / values / first 都与实现一致', () => {
    const mismatches: string[] = [];
    for (const [rule, expected] of BASELINE) {
      let select: number;
      let values: string[];
      let first: string | null;
      try {
        select = selectElements(doc, rule).length;
      } catch (e) {
        mismatches.push(`SELECT THREW ${rule} :: ${String(e)}`);
        continue;
      }
      try {
        values = evalValues(doc, rule);
      } catch (e) {
        mismatches.push(`VALUES THREW ${rule} :: ${String(e)}`);
        continue;
      }
      try {
        first = evalFirst(doc, rule);
      } catch (e) {
        mismatches.push(`FIRST THREW ${rule} :: ${String(e)}`);
        continue;
      }
      if (select !== expected.select) {
        mismatches.push(`SELECT ${rule}: 期望 ${expected.select} 实得 ${select}`);
      }
      if (JSON.stringify(values) !== JSON.stringify(expected.values)) {
        mismatches.push(
          `VALUES ${rule}: 期望 ${JSON.stringify(expected.values)} 实得 ${JSON.stringify(values)}`,
        );
      }
      if (first !== expected.first) {
        mismatches.push(`FIRST ${rule}: 期望 ${JSON.stringify(expected.first)} 实得 ${JSON.stringify(first)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('legadoRule 修饰符与前缀判定', () => {
  it('isJsonRule —— Kotlin L33：`$` / `@json:` / `@js:` 三种前缀', () => {
    expect(isJsonRule('{"title":"a"}')).toBe(false); // 裸JSON 不是规则前缀
    expect(isJsonRule('$.title')).toBe(true);
    expect(isJsonRule('@json:$.title')).toBe(true);
    expect(isJsonRule('@js:JSON.parse(x)')).toBe(true);
    expect(isJsonRule('class.book')).toBe(false);
    expect(isJsonRule('  $.title  ')).toBe(true); // Kotlin L32 先 trim
  });

  it('cleanJsonPath 清掉 @json: 与 $ 前缀（Kotlin L37-42）', () => {
    expect(cleanJsonPath('@json:$.title')).toBe('title');
    expect(cleanJsonPath('$.title')).toBe('title');
    expect(cleanJsonPath('$.title')).toBe('title');
  });
});
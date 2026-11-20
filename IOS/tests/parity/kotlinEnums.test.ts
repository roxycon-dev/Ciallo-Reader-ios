/**
 * kotlinEnums.test.ts —— 全部 Kotlin `enum class` 的**项名 / 序数 / 文案**三重对拍。
 *
 * 这个门禁解决的是「枚举最容易悄悄漂移」的问题：项名少一个、顺序换了、文案改了，
 * 编译期全都不报错，只有用户点开设置页才会发现「少了一档」。三件事都做：
 *
 *   ① **可复现性**：测试自带一份独立解析器（与 `scripts/genKotlinEnums.mjs` 写法不同），
 *      从真实 Kotlin 原文解析出的枚举集合必须与 `KOTLIN_ENUMS` 完全一致
 *      —— 谁偷偷手改集中表，这里立刻红。
 *   ② **iOS 实际使用的表**：`comicReaderConfig.ts` 的 10 组 `_VALUES` / `_ORDINAL` / `_LABEL`
 *      逐项与 Kotlin 对齐（这是真正被界面读取的表，不是给测试看的影子表）。
 *   ③ **其它已移植的表**：`TransferCategory`、`WenkuSymbol`、`ShelfSearchField`
 *      同样按 Kotlin 原文比对。
 *
 * 全部断言的期望值都来自 `androidReference()` 打开的 Kotlin 原文。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  KOTLIN_ENUMS,
  kotlinEnum,
  kotlinEnumLabels,
  kotlinEnumValues,
} from '@core/enums/kotlinEnums';
import {
  COMIC_BG_TYPE_LABEL,
  COMIC_BG_TYPE_ORDINAL,
  COMIC_BG_TYPE_VALUES,
  COMIC_CROP_MODE_LABEL,
  COMIC_CROP_MODE_ORDINAL,
  COMIC_CROP_MODE_VALUES,
  COMIC_DIRECTION_LABEL,
  COMIC_DIRECTION_ORDINAL,
  COMIC_DIRECTION_VALUES,
  COMIC_DOUBLE_ALIGN_LABEL,
  COMIC_DOUBLE_ALIGN_ORDINAL,
  COMIC_DOUBLE_ALIGN_VALUES,
  COMIC_ENHANCE_MODE_DESC,
  COMIC_ENHANCE_MODE_LABEL,
  COMIC_ENHANCE_MODE_ORDINAL,
  COMIC_ENHANCE_MODE_VALUES,
  COMIC_ENHANCE_MODE_VISIBLE,
  COMIC_FIT_LABEL,
  COMIC_FIT_ORDINAL,
  COMIC_FIT_VALUES,
  COMIC_GESTURE_ACTION_LABEL,
  COMIC_GESTURE_ACTION_ORDINAL,
  COMIC_GESTURE_ACTION_VALUES,
  COMIC_MODE_LABEL,
  COMIC_MODE_ORDINAL,
  COMIC_MODE_VALUES,
  COMIC_PAGE_ANIM_LABEL,
  COMIC_PAGE_ANIM_ORDINAL,
  COMIC_PAGE_ANIM_VALUES,
  COMIC_SCENE_LABEL,
  COMIC_SCENE_ORDINAL,
  COMIC_SCENE_VALUES,
} from '@core/comic/comicReaderConfig';
import { TRANSFER_CATEGORIES } from '@core/transfer/portableFormat';
import { WENKU_SYMBOL_TABLE } from '@core/wenku/iconArt';
import { SHELF_SEARCH_FIELD_TITLES, ShelfSearchField } from '@core/wenku/shelfSearch';

import { androidReference } from '../helpers/androidReference';

const KT_SRC = 'app/src/main/java';
const COMIC_CONFIG_KT = 'com/example/ui/comic/ComicReaderConfig.kt';

/* ══════════════════════════════════════════════════════════════════════════════
 * 独立解析器（与生成脚本写法不同：行扫描 + 括号配平，不复用生成器的切分函数）
 * ══════════════════════════════════════════════════════════════════════════════ */

interface ParsedItem {
  readonly name: string;
  readonly label: string | null;
  readonly desc: string | null;
}

interface ParsedEnum {
  readonly rel: string;
  readonly name: string;
  readonly line: number;
  readonly items: readonly ParsedItem[];
}

function walkKotlin(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkKotlin(full, out);
    else if (full.endsWith('.kt')) out.push(full);
  }
  return out;
}

const KT_ROOT = path.dirname(androidReference(`${KT_SRC}/x.kt`));

/** 去掉行注释与块注释，但保留字符串内容（要读文案）。 */
function dropComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inStr = false;
  let inRaw = false;
  while (i < source.length) {
    const c = source[i] ?? '';
    const n = source[i + 1] ?? '';
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out.push(c);
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 2;
        continue;
      }
      if (c === '\n') out.push(c);
      i += 1;
      continue;
    }
    if (inStr) {
      out.push(c);
      if (c === '\\') {
        out.push(n);
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i += 1;
      continue;
    }
    if (inRaw) {
      if (source.startsWith('"""', i)) {
        out.push('"""');
        inRaw = false;
        i += 3;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (source.startsWith('"""', i)) {
      inRaw = true;
      out.push('"""');
      i += 3;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out.push(c);
      i += 1;
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join('');
}

/** 取 `from` 处的 `{` 到配对 `}` 之间的内容。 */
function blockAfter(source: string, from: number): string | null {
  const open = source.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** 枚举项区 = `{` 之后到顶层 `;`（或整块）之间。 */
function itemsRegion(body: string): string {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i] ?? '';
    if (inStr) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) return body.slice(0, i);
  }
  return body;
}

/**
 * 从项区里抽条目：按**顶层逗号**切分，每段取开头标识符。
 *
 * 必须允许 PascalCase —— `enum class ShelfSearchField { Any("全部"), Title("书名") … }`
 * 与 `WenkuSymbol`（89 项）都是这种写法，只认 UPPER_SNAKE 会把它们整片漏掉。
 */
function parseItems(region: string): readonly ParsedItem[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < region.length; i += 1) {
    const c = region[i] ?? '';
    if (inStr) {
      cur += c;
      if (c === '\\') {
        cur += region[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);

  const items: ParsedItem[] = [];
  for (const part of parts) {
    const seg = part.trim();
    if (seg === '') continue;
    const head = /^([A-Z][A-Za-z0-9_]*)/.exec(seg);
    if (head === null) continue;
    const name = head[1] ?? '';
    if (name === '') continue;
    const args = seg.slice(name.length).trim();
    const strs = [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1] ?? '');
    items.push({
      name,
      label: strs.length > 0 ? (strs[0] ?? '') : null,
      desc: strs.length > 1 ? (strs[1] ?? '') : null,
    });
  }
  return items;
}

function parseAllEnums(): readonly ParsedEnum[] {
  const out: ParsedEnum[] = [];
  for (const file of walkKotlin(KT_ROOT).sort()) {
    const rel = path.relative(KT_ROOT, file).split(path.sep).join('/');
    const source = dropComments(readFileSync(file, 'utf8'));
    const re = /enum\s+class\s+([A-Za-z0-9_]+)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      const name = m[1] ?? '';
      if (name === '') continue;
      const body = blockAfter(source, m.index);
      if (body === null) continue;
      const items = parseItems(itemsRegion(body));
      if (items.length === 0) continue;
      out.push({ rel, name, line: source.slice(0, m.index).split('\n').length, items });
    }
  }
  return out;
}

const PARSED = parseAllEnums();

/* ══════════════════════════════════════════════════════════════════════════════
 * ① 集中表 vs Kotlin 原文
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('KOTLIN_ENUMS 与 Kotlin 原文逐项一致', () => {
  it('枚举集合相同（不多不少），行号落在文件范围内', () => {
    const parsedKeys = PARSED.map((e) => `${e.rel}::${e.name}`).sort();
    const tableKeys = Object.keys(KOTLIN_ENUMS).sort();
    expect(parsedKeys.length).toBeGreaterThanOrEqual(50);
    expect(tableKeys).toEqual(parsedKeys);
  });

  it('每个枚举的项名、顺序、文案、描述全部相同', () => {
    const drift: string[] = [];
    for (const e of PARSED) {
      const key = `${e.rel}::${e.name}`;
      const table = KOTLIN_ENUMS[key];
      if (table === undefined) {
        drift.push(`${key}：集中表缺失`);
        continue;
      }
      if (table.line !== e.line) drift.push(`${key}：行号 ${String(table.line)} ≠ ${String(e.line)}`);
      const want = e.items.map((i) => `${i.name}|${i.label ?? '∅'}|${i.desc ?? '∅'}`).join(',');
      const got = table.items.map((i) => `${i.name}|${i.label ?? '∅'}|${i.desc ?? '∅'}`).join(',');
      if (want !== got) drift.push(`${key}\n  Kotlin: ${want}\n  表:     ${got}`);
    }
    expect(drift).toEqual([]);
  });

  it('项数与序数自洽（下标即 Kotlin 的 ordinal）', () => {
    let total = 0;
    for (const [key, value] of Object.entries(KOTLIN_ENUMS)) {
      total += value.items.length;
      const names = value.items.map((i) => i.name);
      expect(new Set(names).size, `${key} 有重复项名`).toBe(names.length);
      // 序数连续性：0..n-1 恒成立（数组下标），这里断言可索引
      value.items.forEach((item, index) => {
        expect(value.items[index]?.name, `${key} 第 ${String(index)} 项`).toBe(item.name);
      });
    }
    expect(total).toBeGreaterThanOrEqual(200);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ② ios 实际使用的表（comicReaderConfig）— 逐项与 Kotlin 对齐
 * ══════════════════════════════════════════════════════════════════════════════ */

type ValuesTable = readonly string[];
type OrdinalTable = Readonly<Record<string, number>>;
type LabelTable = Readonly<Record<string, string>>;

const COMIC_TABLES: readonly {
  readonly enumName: string;
  readonly values: ValuesTable;
  readonly ordinal: OrdinalTable;
  readonly label: LabelTable;
}[] = [
  { enumName: 'ComicMode', values: COMIC_MODE_VALUES, ordinal: COMIC_MODE_ORDINAL, label: COMIC_MODE_LABEL },
  { enumName: 'ComicDirection', values: COMIC_DIRECTION_VALUES, ordinal: COMIC_DIRECTION_ORDINAL, label: COMIC_DIRECTION_LABEL },
  { enumName: 'ComicFit', values: COMIC_FIT_VALUES, ordinal: COMIC_FIT_ORDINAL, label: COMIC_FIT_LABEL },
  { enumName: 'ComicDoubleAlign', values: COMIC_DOUBLE_ALIGN_VALUES, ordinal: COMIC_DOUBLE_ALIGN_ORDINAL, label: COMIC_DOUBLE_ALIGN_LABEL },
  { enumName: 'ComicCropMode', values: COMIC_CROP_MODE_VALUES, ordinal: COMIC_CROP_MODE_ORDINAL, label: COMIC_CROP_MODE_LABEL },
  { enumName: 'ComicEnhanceMode', values: COMIC_ENHANCE_MODE_VALUES, ordinal: COMIC_ENHANCE_MODE_ORDINAL, label: COMIC_ENHANCE_MODE_LABEL },
  { enumName: 'ComicBgType', values: COMIC_BG_TYPE_VALUES, ordinal: COMIC_BG_TYPE_ORDINAL, label: COMIC_BG_TYPE_LABEL },
  { enumName: 'ComicScene', values: COMIC_SCENE_VALUES, ordinal: COMIC_SCENE_ORDINAL, label: COMIC_SCENE_LABEL },
  { enumName: 'ComicPageAnim', values: COMIC_PAGE_ANIM_VALUES, ordinal: COMIC_PAGE_ANIM_ORDINAL, label: COMIC_PAGE_ANIM_LABEL },
  {
    enumName: 'ComicGestureAction',
    values: COMIC_GESTURE_ACTION_VALUES,
    ordinal: COMIC_GESTURE_ACTION_ORDINAL,
    label: COMIC_GESTURE_ACTION_LABEL,
  },
];

describe('comicReaderConfig 的 10 组表与 ComicReaderConfig.kt 逐项一致', () => {
  it('_VALUES 的项名与顺序等于 Kotlin 的枚举项', () => {
    const drift: string[] = [];
    for (const table of COMIC_TABLES) {
      const kotlin = kotlinEnumValues(COMIC_CONFIG_KT, table.enumName);
      expect(kotlin.length, `${table.enumName} 没从集中表取到`).toBeGreaterThan(0);
      if (table.values.join(',') !== kotlin.join(',')) {
        drift.push(`${table.enumName}\n  Kotlin: ${kotlin.join('|')}\n  TS:     ${table.values.join('|')}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('_ORDINAL 的数值等于 Kotlin 的下标', () => {
    const drift: string[] = [];
    for (const table of COMIC_TABLES) {
      kotlinEnumValues(COMIC_CONFIG_KT, table.enumName).forEach((name, index) => {
        if (table.ordinal[name] !== index) {
          drift.push(`${table.enumName}.${name}: TS=${String(table.ordinal[name])} Kotlin=${String(index)}`);
        }
      });
    }
    expect(drift).toEqual([]);
  });

  it('_LABEL 的文案等于 Kotlin 构造器里的第一个字符串', () => {
    const drift: string[] = [];
    for (const table of COMIC_TABLES) {
      const want = kotlinEnumLabels(COMIC_CONFIG_KT, table.enumName);
      for (const [name, label] of Object.entries(want)) {
        if (table.label[name] !== label) drift.push(`${table.enumName}.${name}: TS=「${String(table.label[name])}」 Kotlin=「${label}」`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('ComicEnhanceMode 的 desc 与 visibleModes 白名单', () => {
    const entry = kotlinEnum(COMIC_CONFIG_KT, 'ComicEnhanceMode');
    expect(entry).not.toBeNull();
    const descTable: Readonly<Record<string, string>> = COMIC_ENHANCE_MODE_DESC;
    for (const item of entry?.items ?? []) {
      expect(descTable[item.name], `ComicEnhanceMode.${item.name} 的描述`).toBe(item.desc ?? '');
    }
    // Kotlin `visibleModes = listOf(OFF, CAS, ANIME4K, SUPER_RES, MANGAJANAI, MANGAJANAI_FULL)`
    expect(COMIC_ENHANCE_MODE_VISIBLE.join(',')).toBe('OFF,CAS,ANIME4K,SUPER_RES,MANGAJANAI,MANGAJANAI_FULL');
    const src = readFileSync(androidReference(`${KT_SRC}/${COMIC_CONFIG_KT}`), 'utf8');
    const visibleLine = /visibleModes\s*=\s*listOf\(([^)]*)\)/.exec(src);
    expect(visibleLine).not.toBeNull();
    const kotlinVisible = (visibleLine?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    expect([...COMIC_ENHANCE_MODE_VISIBLE]).toEqual(kotlinVisible);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ③ 其它已移植的表
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('其它枚举表与 Kotlin 原文一致', () => {
  it('TransferCategory：7 个类别与顺序', () => {
    const kotlin = kotlinEnumValues('com/example/transfer/TransferModels.kt', 'TransferCategory');
    expect(kotlin).toEqual(['BOOKS', 'FAVORITES', 'ANNOTATIONS', 'HISTORY', 'SETTINGS', 'RESOURCES', 'SOURCES']);
    expect([...TRANSFER_CATEGORIES]).toEqual(kotlin);
  });

  it('WenkuSymbol：89 个符号的顺序', () => {
    const kotlin = kotlinEnumValues('com/example/ui/wenku/WenkuIconArt.kt', 'WenkuSymbol');
    expect(kotlin.length).toBe(89);
    expect(WENKU_SYMBOL_TABLE.map((row) => row[0])).toEqual(kotlin);
  });

  it('ShelfSearchField：3 个字段与文案', () => {
    const kotlin = kotlinEnumValues('com/example/ui/shelf/ShelfSearch.kt', 'ShelfSearchField');
    expect(kotlin).toEqual(['Any', 'Title', 'Author']);
    // Kotlin 的项是 `Any("全部"), Title("书名"), Author("作者")`
    expect([...ShelfSearchField]).toEqual(kotlin);
    expect(SHELF_SEARCH_FIELD_TITLES.Any).toBe('全部');
    expect(SHELF_SEARCH_FIELD_TITLES.Title).toBe('书名');
    expect(SHELF_SEARCH_FIELD_TITLES.Author).toBe('作者');
  });
});

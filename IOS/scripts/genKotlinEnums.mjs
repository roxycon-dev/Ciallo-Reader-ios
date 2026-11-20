/**
 * 生成 `src/core/enums/kotlinEnums.ts`：把 478 个 Kotlin 文件里**全部** `enum class`
 * 的项名、序数、文案抽成一张集中表。
 *
 * 为什么集中：iOS 侧现有的枚举表命名不统一（`COMIC_MODE_LABEL` / `SHELF_SEARCH_FIELD_TITLES` /
 * `HAPTIC_TABLE` / `SHADOW_BLUR_STYLE_ORDINAL` …），无法机械核对。集中表用
 * `文件路径::枚举名` 作键，**零重名、零冲突**，每条都带 Kotlin 行号。
 *
 * 解析严格化：枚举项区按顶层逗号切分（括号内逗号不算），每段取开头的 `[A-Z][A-Z0-9_]*`。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const KT_ROOT = path.resolve('..', 'novel-reader', 'app', 'src', 'main', 'java');
const OUT = path.resolve('src', 'core', 'enums', 'kotlinEnums.ts');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.kt')) out.push(full);
  }
  return out;
}

/** 剥注释（保留字符串字面量，因为要读文案）。 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let mode = 'code';
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (ch === '"' && source.startsWith('"""', i)) { mode = 'raw'; out += '"""'; i += 3; continue; }
      if (ch === '"') { mode = 'str'; out += '"'; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (mode === 'line') { out += ch === '\n' ? '\n' : ' '; if (ch === '\n') mode = 'code'; i += 1; continue; }
    if (mode === 'block') { if (ch === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; } else { out += ch === '\n' ? '\n' : ' '; i += 1; } continue; }
    if (mode === 'str') {
      if (ch === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
      if (ch === '"') { mode = 'code'; out += '"'; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (mode === 'raw') {
      if (source.startsWith('"""', i)) { mode = 'code'; out += '"""'; i += 3; } else { out += ch; i += 1; }
    }
  }
  return out;
}

/** 找与 `open` 位置的花括号匹配的右花括号。 */
function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 按顶层逗号切分（跳过括号与字符串）。 */
function splitTopLevel(body) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\') { cur += body[i + 1] ?? ''; i += 1; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === '(' || ch === '<') depth += 1;
    else if (ch === ')' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseEnum(source, name) {
  const start = source.indexOf(`enum class ${name}`);
  if (start < 0) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart < 0) return null;
  const end = matchingBrace(source, braceStart);
  if (end < 0) return null;
  const body = source.slice(braceStart + 1, end);
  // 项区结束于顶层 `;`
  let depth = 0;
  let inStr = false;
  let semi = -1;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inStr) { if (ch === '\\') { i += 1; continue; } if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '(' || ch === '<') depth += 1;
    else if (ch === ')' || ch === '>') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) { semi = i; break; }
  }
  const region = semi >= 0 ? body.slice(0, semi) : body;
  const line = source.slice(0, start).split('\n').length;
  const items = [];
  for (const raw of splitTopLevel(region)) {
    const seg = raw.trim();
    if (seg === '') continue;
    // 项名允许 PascalCase：Kotlin 里 `enum class ShelfSearchField { Any("全部") … }` 合法，
    // 只认 UPPER_SNAKE 会漏掉 WenkuSymbol（89 项）与 ShelfSearchField 这类枚举。
    const m = /^([A-Z][A-Za-z0-9_]*)\s*(?:\(([\s\S]*)\))?$/.exec(seg);
    if (m === null) continue;
    const itemName = m[1] ?? '';
    if (itemName === '') continue;
    const args = m[2] ?? '';
    const strs = [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? '');
    items.push({ name: itemName, label: strs.length > 0 ? (strs[0] ?? '') : null, desc: strs.length > 1 ? (strs[1] ?? '') : null });
  }
  if (items.length === 0) return null;
  return { line, items };
}

const entries = [];
for (const file of walk(KT_ROOT).sort()) {
  const rel = path.relative(KT_ROOT, file).replace(/\\/g, '/');
  const source = stripComments(readFileSync(file, 'utf8'));
  const names = [...source.matchAll(/enum\s+class\s+([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? '').filter((x) => x !== '');
  for (const name of names) {
    const parsed = parseEnum(source, name);
    if (parsed === null) continue;
    entries.push({ rel, name, line: parsed.line, items: parsed.items });
  }
}

const ts = [];
ts.push('/**');
ts.push(' * `KOTLIN_ENUMS` —— 478 个 Kotlin 文件里**全部** `enum class` 的项名、序数、文案集中表。');
ts.push(' *');
ts.push(' * **机器生成**：`node scripts/genKotlinEnums.mjs`。不要手改。');
ts.push(' * 键是 `文件路径（相对 app/src/main/java）::枚举名`，因此零重名、零冲突；');
ts.push(' * `line` 是该 `enum class` 在 Kotlin 文件里的行号，便于逐条回查。');
ts.push(' *');
ts.push(' * 为什么需要它：iOS 侧原有的枚举表命名不统一（`COMIC_MODE_LABEL` /');
ts.push(' * `SHELF_SEARCH_FIELD_TITLES` / `HAPTIC_TABLE` / `SHADOW_BLUR_STYLE_ORDINAL` …），');
ts.push(' * 无法机械核对「Kotlin 的 5 个项 ↔ iOS 的 5 个项、序数与文案是否一致」。');
ts.push(' * 本表把这件事变成可断言的数据：`tests/parity/kotlinEnums.test.ts` 逐项比对。');
ts.push(' */');
ts.push('');
ts.push('export interface KotlinEnumItem {');
ts.push('  readonly name: string;');
ts.push('  /** 构造器里第一个字符串参数；没有则为 `null`（Kotlin `name` 的等价物）。 */');
ts.push('  readonly label: string | null;');
ts.push('  /** 构造器里第二个字符串参数（如 `ComicEnhanceMode` 的描述）；没有则为 `null`。 */');
ts.push('  readonly desc: string | null;');
ts.push('}');
ts.push('');
ts.push('export interface KotlinEnum {');
ts.push('  /** `enum class` 在 Kotlin 文件里的行号（1-based）。 */');
ts.push('  readonly line: number;');
ts.push('  readonly items: readonly KotlinEnumItem[];');
ts.push('}');
ts.push('');
ts.push('export const KOTLIN_ENUMS: Readonly<Record<string, KotlinEnum>> = {');
for (const e of entries) {
  const key = `${e.rel}::${e.name}`;
  ts.push(`  ${JSON.stringify(key)}: {`);
  ts.push(`    line: ${String(e.line)},`);
  ts.push('    items: [');
  for (const it of e.items) {
    ts.push(`      { name: ${JSON.stringify(it.name)}, label: ${it.label === null ? 'null' : JSON.stringify(it.label)}, desc: ${it.desc === null ? 'null' : JSON.stringify(it.desc)} },`);
  }
  ts.push('    ],');
  ts.push('  },');
}
ts.push('};');
ts.push('');
ts.push('/** 按 Kotlin 文件与枚举名取表（找不到返回 null）。 */');
ts.push('export function kotlinEnum(rel: string, name: string): KotlinEnum | null {');
ts.push('  return KOTLIN_ENUMS[`${rel}::${name}`] ?? null;');
ts.push('}');
ts.push('');
ts.push('/** 枚举项名数组（序数即下标），Kotlin `entries.map { it.name }` 的等价物。 */');
ts.push('export function kotlinEnumValues(rel: string, name: string): readonly string[] {');
ts.push('  const e = kotlinEnum(rel, name);');
ts.push('  return e === null ? [] : e.items.map((i) => i.name);');
ts.push('}');
ts.push('');
ts.push('/** 项名 → 文案；label 为 null 时回落项名（对齐 Kotlin `name` 属性）。 */');
ts.push('export function kotlinEnumLabels(rel: string, name: string): Readonly<Record<string, string>> {');
ts.push('  const e = kotlinEnum(rel, name);');
ts.push('  if (e === null) return {};');
ts.push('  const out: Record<string, string> = {};');
ts.push('  for (const i of e.items) out[i.name] = i.label ?? i.name;');
ts.push('  return out;');
ts.push('}');
ts.push('');

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, ts.join('\n'), 'utf8');

const totalItems = entries.reduce((a, e) => a + e.items.length, 0);
console.log(`enums=${String(entries.length)} items=${String(totalItems)} files=${String(new Set(entries.map((e) => e.rel)).size)}`);

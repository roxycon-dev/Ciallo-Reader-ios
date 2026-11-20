/**
 * parityScan.mjs —— 逐 Kotlin 文件核对 iOS 侧的声明覆盖度。
 *
 * 产出（都写进 `.tmp/`，不进交付物）：
 *   .tmp/parity_scan.json  每文件：物理行数 / 顶层声明 / 导出命中 / 任意标识符命中 / 最佳 TS 归属文件
 *   .tmp/parity_rows.md    可直接贴进 PARITY_MATRIX.md 的表格行
 *
 * 判定口径（与 docs/PARITY_MATRIX.md 的三种状态对齐）：
 *   anyHits == decls                  → 候选 PORTED（仍需 tests/ 里读 Kotlin 原文的测试才算数）
 *   0 < anyHits < decls               → MISSING（部分移植）
 *   anyHits == 0                      → MISSING
 *
 * 「命中」两种口径分开记：
 *   exported —— iOS 侧 `export` 出了同名符号（对外契约存在）
 *   any      —— 同名标识符在 iOS 侧任意位置出现（含私有 helper，仍算有对应实现）
 *
 * 用法：node scripts/parityScan.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KT_ROOT = path.resolve(ROOT, '..', 'novel-reader', 'app', 'src', 'main', 'java');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, '.tmp');

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** 顶层声明：只在花括号深度 0 处抓 `fun` / `val` / `var` / `class` / `object` / `interface`。 */
function topLevelDecls(source) {
  const decls = [];
  let depth = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    if (depth === 0) {
      const fn = /fun\s+(?:<[^>]*>\s*)?([A-Za-z0-9_.]+)\s*\(/.exec(line);
      if (fn !== null) {
        const name = fn[1].split('.').pop();
        if (name !== undefined && name !== '' && !decls.includes(name)) decls.push(name);
      } else {
        const trimmed = line.trim();
        const val =
          /^(?:@\w+\s*)?(?:internal |private |public |protected |const |lateinit )*(?:val|var)\s+([A-Za-z0-9_]+)/.exec(
            trimmed,
          );
        if (val !== null) {
          if (!decls.includes(val[1])) decls.push(val[1]);
        } else {
          const cls =
            /^(?:@\w+\s*)?(?:internal |private |public |abstract |sealed |data |enum |open |annotation )*(?:class|object|interface)\s+([A-Za-z0-9_]+)/.exec(
              trimmed,
            );
          if (cls !== null && !decls.includes(cls[1])) decls.push(cls[1]);
        }
      }
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return decls;
}

const tsFiles = walk(SRC, (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
const tsText = new Map();
for (const f of tsFiles) tsText.set(f, readFileSync(f, 'utf8'));

/** 导出符号表。 */
const exported = new Map();
/** 任意标识符表：symbol -> Set<file>。 */
const identifiers = new Map();

for (const [file, text] of tsText) {
  const re =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum|abstract class)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!exported.has(m[1])) exported.set(m[1], new Set());
    exported.get(m[1]).add(file);
  }
  const re2 = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((m = re2.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name === undefined || name === '') continue;
      if (!exported.has(name)) exported.set(name, new Set());
      exported.get(name).add(file);
    }
  }
  const re3 = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  while ((m = re3.exec(text)) !== null) {
    const sym = m[0];
    if (sym.length < 3) continue;
    if (!identifiers.has(sym)) identifiers.set(sym, new Set());
    identifiers.get(sym).add(file);
  }
}

const ktFiles = walk(KT_ROOT, (f) => f.endsWith('.kt'));
const results = [];

for (const file of ktFiles) {
  const rel = path.relative(KT_ROOT, file).replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');
  const physical = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  const nonBlank = source.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  const decls = topLevelDecls(source);
  const exportHit = [];
  const anyHit = [];
  const miss = [];
  const ownerScore = new Map();
  for (const d of decls) {
    const ex = exported.get(d);
    const any = identifiers.get(d);
    if (ex !== undefined && ex.size > 0) exportHit.push(d);
    if (any !== undefined && any.size > 0) {
      anyHit.push(d);
      for (const o of any) ownerScore.set(o, (ownerScore.get(o) ?? 0) + 1);
    } else miss.push(d);
  }
  const owners = [...ownerScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  results.push({
    rel,
    lines: physical,
    nonBlank,
    decls: decls.length,
    exportHits: exportHit.length,
    anyHits: anyHit.length,
    miss: miss.slice(0, 40),
    owners: owners.map(([f, n]) => ({ file: path.relative(ROOT, f).replace(/\\/g, '/'), hits: n })),
  });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'parity_scan.json'), JSON.stringify(results, null, 2), 'utf8');

const totalDecls = results.reduce((a, r) => a + r.decls, 0);
const totalAny = results.reduce((a, r) => a + r.anyHits, 0);
const totalExport = results.reduce((a, r) => a + r.exportHits, 0);
const full = results.filter((r) => r.decls > 0 && r.anyHits === r.decls);
const zero = results.filter((r) => r.decls > 0 && r.anyHits === 0);
const partial = results.filter((r) => r.decls > 0 && r.anyHits > 0 && r.anyHits < r.decls);
const empty = results.filter((r) => r.decls === 0);

const md = [];
for (const r of results.sort((a, b) => a.rel.localeCompare(b.rel))) {
  const owner = r.owners.length === 0 ? '—' : r.owners.map((o) => `${o.file}(${String(o.hits)})`).join('<br>');
  const status = r.decls > 0 && r.anyHits === r.decls ? 'PLAUSIBLE' : 'MISSING';
  const note =
    r.decls === 0
      ? '无顶层声明'
      : `${r.anyHits}/${r.decls} 声明有对应${r.miss.length === 0 ? '' : '；缺 ' + r.miss.join(', ')}`;
  md.push(`| ${r.rel} | ${r.lines} | ${owner} | ${status} | ${note} |`);
}
writeFileSync(path.join(OUT, 'parity_rows.md'), md.join('\n'), 'utf8');

console.log(`kotlin files       : ${results.length}`);
console.log(`kotlin phys lines  : ${results.reduce((a, r) => a + r.lines, 0)}`);
console.log(`kotlin non-blank   : ${results.reduce((a, r) => a + r.nonBlank, 0)}`);
console.log(`top-level decls    : ${totalDecls}`);
console.log(`exported resolved  : ${totalExport} (${((totalExport / totalDecls) * 100).toFixed(1)}%)`);
console.log(`any resolved       : ${totalAny} (${((totalAny / totalDecls) * 100).toFixed(1)}%)`);
console.log(`full coverage      : ${full.length}`);
console.log(`partial coverage   : ${partial.length}`);
console.log(`zero coverage      : ${zero.length}`);
console.log(`no top-level decl  : ${empty.length}`);

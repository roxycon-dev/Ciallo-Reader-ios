/*
 * 一次性审计脚本：把 `src/styles/**` 里每一处 `color-mix()` 展开成
 * Safari 16.0 可用的 `rgba()` 等价值（`color-mix(in srgb, C P%, transparent)`
 * 在预乘 alpha 规则下 ≡ `rgba(r,g,b,P%)`，前提是 C 是不透明色）。
 *
 * 用法：node scripts/audit-color-mix.mjs
 * 输出：file:line | 折叠色 | 期间（浅色 / 深色）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(root, 'src', 'styles');

/** `[data-theme='dark']` 块里这些 token 会翻转（theme.css L142-160）。 */
const DARK_TOKEN = {
  '--color-primary': '#059669',
  '--color-secondary': '#10b981',
  '--color-mint-gold': '#e8c97a',
  '--color-dark-charcoal': '#18191c',
  '--color-medium-gray': '#9aa0a6',
  '--color-divider-gray': '#2f3238',
  '--color-pure-white': '#222428',
  '--color-light-bg': '#18191c',
  '--color-on-light': '#d4d4d4',
  '--color-on-dark': '#d4d4d4',
  '--color-danger': '#dc2626',
  '--color-surface': '#222428',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hexToRgb(raw) {
  let h = raw.replace('#', '');
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join('');
  }
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** 把 `var(--t, #hex)` / `#hex` 解析成一个具体 hex；解析不出来返回 null。 */
function resolveColor(expr, dark) {
  const m = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/.exec(expr);
  if (m) {
    if (dark && DARK_TOKEN[m[1]] !== undefined) return DARK_TOKEN[m[1]];
    const fallback = (m[2] ?? '').trim();
    return HEX.test(fallback) ? fallback : null;
  }
  const token = expr.trim();
  return HEX.test(token) ? token : null;
}

const files = fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css'));
const rows = [];

for (const file of files) {
  const lines = fs.readFileSync(path.join(stylesDir, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes('color-mix(')) return;
    let selector = null;
    for (let j = index; j >= 0 && j >= index - 24; j -= 1) {
      if (lines[j].includes('{')) {
        selector = lines[j].trim().replace(/\{$/, '').trim();
        break;
      }
    }
    if (selector === null) return;
    const dark = selector.includes("[data-theme='dark']");
    // `var(--t, #hex)` 自身含逗号，所以第一段不能用 `[^,]`；改成惰性吃到
    // `, transparent)` 为止，再把结尾的百分比拆出来。
    const re = /color-mix\(\s*in srgb\s*,\s*(.+?)\s*,\s*transparent\s*\)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const pct = /([0-9.]+)%\s*$/.exec(m[1]);
      const colorExpr = pct === null ? m[1] : m[1].slice(0, pct.index);
      const hex = resolveColor(colorExpr, dark);
      let folded = 'UNRESOLVED: ' + colorExpr;
      if (hex !== null && pct !== null) {
        folded = `rgba(${hexToRgb(hex).join(', ')}, ${pct[1]}%)  [${hex}]`;
      }
      rows.push({
        at: `${file}:${index + 1}`,
        selector,
        dark,
        raw: m[0],
        folded,
      });
    }
  });
}

for (const row of rows) {
  console.log(`${row.at.padEnd(22)} ${row.dark ? 'DARK ' : 'LIGHT'} ${row.selector}`);
  console.log(`${' '.repeat(22)}   ${row.folded}`);
}
console.log(`\ntotal color-mix() 折叠点：${rows.length}`);

/* Temporary verification for the three night-mode CSS blocks. Deleted after the run. */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STYLE_DIR = path.join(ROOT, 'src', 'styles');
const FILES = ['home.css', 'homePage.css', 'library.css'];
const DARK = "[data-theme='dark']";

let fail = 0;
const bad = (m) => {
  fail += 1;
  console.log('  FAIL ' + m);
};
const ok = (m) => console.log('  ok   ' + m);

/** blank out comments (keeping newlines) so offsets stay aligned */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function readThemeTokens() {
  const theme = fs.readFileSync(path.join(STYLE_DIR, 'theme.css'), 'utf8');
  const rootStart = theme.indexOf(':root');
  const braceStart = theme.indexOf('{', rootStart);
  let depth = 0;
  let i = braceStart;
  for (; i < theme.length; i += 1) {
    if (theme[i] === '{') depth += 1;
    else if (theme[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = theme.slice(braceStart + 1, i);
  const vars = new Set();
  const re = /(--[a-zA-Z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) vars.add(m[1]);
  return vars;
}
const THEME_VARS = readThemeTokens();

/** specificity of one compound/complex selector (list-aware, :not unwrapped) */
function specificity(sel) {
  const s = sel.trim();
  let a = 0;
  let b = 0;
  let c = 0;
  // unwrap :not(...) -> contributes the specificity of its argument
  const flat = s.replace(/:not\(([^()]*)\)/g, '$1');
  const ids = flat.match(/#[A-Za-z0-9_-]+/g);
  if (ids) a += ids.length;
  const cls = flat.match(/\.[A-Za-z0-9_-]+/g) || [];
  const att = flat.match(/\[[^\]]*\]/g) || [];
  const psc = flat.match(/:{1,2}[A-Za-z-]+/g) || [];
  b += cls.length + att.length + psc.length;
  // type selectors only after start / combinators
  const type = flat.match(/(^|[\s>+~])([a-zA-Z][A-Za-z0-9]*)/g) || [];
  c += type.length;
  return a * 10000 + b * 100 + c;
}

function selList(prelude) {
  // naive split on commas not inside () or []
  const out = [];
  let cur = '';
  let p = 0;
  let br = 0;
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') br += 1;
    else if (ch === ')' || ch === ']') br -= 1;
    if (ch === ',' && br === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  void p;
  return out;
}

/** depth-first walk of every real (non-at) rule, with at-rule context.
 *  `limit` bounds the scan to the current block so nested at-rules terminate. */
function collectRules(css, atStack, acc, from, limit) {
  const end = limit === undefined ? css.length : limit;
  let i = from || 0;
  while (i < end) {
    const brace = css.indexOf('{', i);
    if (brace < 0 || brace >= end) break;
    const prelude = css.slice(i, brace).trim();
    let depth = 0;
    let j = brace;
    for (; j < end; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (prelude.startsWith('@')) {
      collectRules(css, atStack.concat([prelude]), acc, brace + 1, j);
    } else if (prelude) {
      acc.push({ sels: selList(prelude), body: css.slice(brace + 1, j), at: atStack, at0: i });
    }
    i = j + 1;
  }
}

function propsOf(body) {
  const out = new Set();
  const re = /(?:^|[;{])\s*([a-zA-Z-]+)\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) out.add(m[1]);
  return out;
}

console.log('theme.css :root declares ' + THEME_VARS.size + ' custom properties\n');

const perFile = {};

for (const f of FILES) {
  const raw = fs.readFileSync(path.join(STYLE_DIR, f), 'utf8');
  const code = blankComments(raw);
  console.log('=== ' + f + ' ===');

  // 1. prefers-color-scheme must never appear
  const pcm = (code.match(/prefers-color-scheme/g) || []).length;
  if (pcm === 0) ok('prefers-color-scheme occurrences = 0');
  else bad('prefers-color-scheme occurrences = ' + pcm);

  // 2. braces balanced, nesting never negative
  let depth = 0;
  let minDepth = 0;
  for (const ch of code) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
  }
  if (depth === 0 && minDepth >= 0) ok('braces balanced (final depth 0, min nesting depth ' + minDepth + ')');
  else bad('braces unbalanced: final depth ' + depth + ', min depth ' + minDepth);

  // 3. banner position measured on RAW text; no data-theme before it
  const bannerIdx = raw.indexOf('═');
  const firstDark = code.indexOf(DARK);
  if (bannerIdx < 0) bad('banner comment not found in raw text');
  else if (firstDark < bannerIdx) bad('data-theme appears BEFORE the banner');
  else ok('banner@' + bannerIdx + ' precedes every data-theme rule (first@' + firstDark + ')');

  // 4. collect rules
  const rules = [];
  collectRules(code, [], rules, 0, code.length);
  const baseRules = rules.filter((r) => !r.sels.some((s) => s.includes(DARK)));
  const darkRules = rules.filter((r) => r.sels.some((s) => s.includes(DARK)));

  // 5. every class used in a dark selector must exist in this file's own rules
  const known = new Set();
  for (const r of rules) for (const s of r.sels) for (const c of s.match(/\.[A-Za-z0-9_-]+/g) || []) known.add(c.slice(1));
  const missing = new Set();
  for (const r of darkRules) for (const s of r.sels) for (const c of s.match(/\.[A-Za-z0-9_-]+/g) || []) if (!known.has(c.slice(1))) missing.add(c);
  if (!missing.size) ok('all classes used in dark selectors exist in this file (' + known.size + ' distinct classes here)');
  else bad('unknown classes in dark selectors: ' + [...missing].join(', '));

  // 6. every var() in a dark block must be declared in theme.css :root
  const badTokens = new Set();
  for (const r of darkRules) for (const v of r.body.match(/var\(\s*(--[a-zA-Z0-9_-]+)/g) || []) {
    const n = v.replace(/var\(\s*/, '');
    if (!THEME_VARS.has(n)) badTokens.add(n);
  }
  if (!badTokens.size) ok('all var() tokens in dark blocks are declared in theme.css :root');
  else bad('undeclared tokens: ' + [...badTokens].join(', '));

  // 7. specificity audit: an existing rule that (a) can hit the same element and
  //    (b) sets the same property must not outrank the dark rule.
  const issues = [];
  for (const dr of darkRules) {
    const drTail = dr.sels.map((s) => {
      const m2 = s.match(/\.[A-Za-z0-9_-]+/g) || [];
      return m2[m2.length - 1];
    });
    const dSpec = Math.max(...dr.sels.map(specificity));
    const dProps = propsOf(dr.body);
    for (const br2 of baseRules) {
      if (br2.at.length > 0 && dr.at.length === 0) continue; // at-rule ctx differs
      if (br2.at.length === 0 && dr.at.length > 0) continue;
      for (const bs of br2.sels) {
        const bTailM = bs.match(/\.[A-Za-z0-9_-]+/g) || [];
        const bTail = bTailM[bTailM.length - 1];
        if (!bTail || !drTail.includes(bTail)) continue;
        const bSpec = specificity(bs);
        if (bSpec <= dSpec) continue;
        const bProps = propsOf(br2.body);
        for (const p of dProps) {
          if (bProps.has(p)) issues.push('`${p}` : ' + dr.sels.join(',') + ' (' + dSpec + ') < ' + bs + ' (' + bSpec + ')');
        }
      }
    }
  }
  if (!issues.length) ok('specificity audit: no existing rule outranks a dark rule on the same element + property');
  else [...new Set(issues)].forEach((x) => bad('specificity: ' + x));

  // 8. report
  perFile[f] = darkRules.length;
  console.log('  dark rules appended: ' + darkRules.length + ' / total rules in file: ' + rules.length);
  darkRules.forEach((r) => console.log('      ' + r.sels.join(' , ')));
  console.log('');
}

console.log('per-file dark rule counts:');
for (const f of FILES) console.log('  ' + f + ' = ' + perFile[f]);
console.log('');
for (const f of FILES) {
  const n = (blankComments(fs.readFileSync(path.join(STYLE_DIR, f), 'utf8')).match(/\[data-theme='dark'\]/g) || []).length;
  if (n > 0) ok(f + ": data-theme='dark' occurrences = " + n);
  else bad(f + ": data-theme='dark' occurrences = 0");
}

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
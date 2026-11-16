/*
 * check-dark-theme-css.mjs
 * ---------------------------------------------------------------------------
 * 夜间模式落地后的静态自检（只读，不改任何样式）：
 *   1. 每个文件里 CSS 花括号必须配平；
 *   2. 每个 `[data-theme='dark'] …` 选择器里引用的 class，必须已在**同一个文件**
 *      的既有规则（或同一条 override 里）出现过 —— 防止拼错类名导致整条规则失效；
 *   3. 不允许出现 `@media (prefers-color-scheme: …)`（触发器是 data-theme 属性）；
 *   4. 权重陷阱：若某条 dark override 改了属性 P，而同文件里存在同名 class 的
 *      `--modifier` / `__modifier` 变体也在改 P，且该变体**没有**对应的 dark
 *      兜底规则，那么这条变体会被 0-2-0 的 dark 规则静默吃掉（选中态 / 强调色
 *      在夜间模式下消失）。本项把这些全部列出来。
 *
 * 用法： node scripts/check-dark-theme-css.mjs
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'src/styles/reader.css',
  'src/styles/onboarding.css',
  'src/styles/splash.css',
  'src/styles/privacyWindows.css',
  'src/styles/mascot.css',
  'src/styles/help.css',
  'src/styles/pageturn.css',
];

/** 去掉注释，避免注释里的 `/* … *\/` 干扰括号统计与选择器解析。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取出所有选择器（含 `[data-theme='dark']` 覆盖块）。 */
function splitRules(css) {
  const out = [];
  let depth = 0;
  let buf = '';
  let at = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        at = buf.trim();
        buf = '';
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({ selector: at, body: buf });
        buf = '';
      } else {
        buf += ch;
      }
    } else if (depth > 0) {
      buf += ch;
    } else {
      buf += ch;
    }
  }
  return out;
}

const CLASS_RE = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;
const DECL_RE = /(?:^|[;{])\s*(-{0,2}[a-zA-Z][a-zA-Z0-9-]*)\s*:/g;

function declarations(body) {
  return new Set(
    Array.from(body.matchAll(DECL_RE), (m) => m[1].replace(/^--/, '')),
  );
}

/** 某个选择器里出现的 class 列表（去重）。 */
function classesOf(selector) {
  return Array.from(selector.matchAll(CLASS_RE), (m) => m[1]);
}

let failures = 0;
const log = [];

for (const rel of FILES) {
  const abs = join(ROOT, rel);
  const raw = readFileSync(abs, 'utf8');
  const css = stripComments(raw);

  // ── 1. 括号配平 ───────────────────────────────────────────────────────
  let depth = 0;
  let minDepth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
  }
  const balanced = depth === 0 && minDepth === 0;

  // ── 2. prefers-color-scheme 不得出现 ─────────────────────────────────
  const hasPrefers = /@media[^{]*prefers-color-scheme/.test(css);

  const rules = splitRules(css);

  // ── 3. dark 选择器里的 class 必须在本文件出现 ─────────────────────────
  const declaredClasses = new Set();
  for (const { selector } of rules) {
    if (selector.startsWith('@')) continue;
    for (const part of selector.split(',')) {
      for (const c of classesOf(part)) declaredClasses.add(c);
    }
  }

  const darkRules = []; // { selector, props }
  for (const { selector, body } of rules) {
    if (selector.startsWith('@')) continue;
    for (const part of selector.split(',')) {
      if (/^\s*\[data-theme=['"]dark['"]\]/.test(part)) {
        darkRules.push({ selector: part.trim(), props: declarations(body) });
      }
    }
  }

  const unknown = [];
  for (const { selector } of darkRules) {
    for (const c of classesOf(selector)) {
      if (!declaredClasses.has(c)) unknown.push(`.${c}  (in "${selector}")`);
    }
  }

  // ── 4. 权重陷阱：变体类是否有 dark 兜底 ────────────────────────────────
  // 只看**同元素**的修饰类 `block--modifier`（BEM 的 `--`）。
  // `block__element` 是子元素，父元素的 background 不会落到它身上，不算陷阱。
  // 若 base 上有 dark override 改了属性 P，某个 `--modifier` 也改了 P，
  // 而该 modifier 本身没有对应的 `[data-theme='dark']` 规则 → 会被静默吃掉。
  const variantProps = new Map(); // variantClass -> Set(prop)
  for (const { selector, body } of rules) {
    if (selector.startsWith('@')) continue;
    if (/\[data-theme=['"]dark['"]\]/.test(selector)) continue;
    for (const part of selector.split(',')) {
      const cls = classesOf(part);
      if (cls.length !== 1) continue;
      const [c] = cls;
      const m = /^(.+?)--([a-zA-Z0-9][a-zA-Z0-9-]*)$/.exec(c);
      if (!m) continue;
      if (!variantProps.has(c)) variantProps.set(c, declarations(body));
      else for (const p of declarations(body)) variantProps.get(c).add(p);
    }
  }

  const darkCoveredClasses = new Set(darkRules.flatMap((r) => classesOf(r.selector)));
  const traps = [];
  for (const { selector, props } of darkRules) {
    for (const base of classesOf(selector)) {
      for (const [variant, vProps] of variantProps) {
        if (!variant.startsWith(base)) continue;
        const suffix = variant.slice(base.length);
        if (suffix === '--') continue;
        for (const p of props) {
          if (!vProps.has(p)) continue;
          if (darkCoveredClasses.has(variant)) continue;
          traps.push(`${variant}{${p}} 会被 "${selector}"(0-2-0) 覆盖，且无 dark 兜底`);
        }
      }
    }
  }
  const uniqTraps = Array.from(new Set(traps));

  const ok = balanced && !hasPrefers && unknown.length === 0 && uniqTraps.length === 0;
  if (!ok) failures += 1;
  log.push(
    [
      `${ok ? 'PASS' : 'FAIL'}  ${rel}`,
      `        braces balanced        : ${balanced ? 'yes' : `NO (residual=${depth}, min=${minDepth})`}`,
      `        prefers-color-scheme   : ${hasPrefers ? 'FOUND (forbidden)' : 'absent'}`,
      `        dark selectors         : ${darkRules.length}`,
      `        unknown classes        : ${unknown.length === 0 ? 'none' : unknown.join('; ')}`,
      `        specificity traps      : ${uniqTraps.length === 0 ? 'none' : uniqTraps.join('; ')}`,
    ].join('\n'),
  );
}

process.stdout.write(log.join('\n') + '\n');
process.stdout.write(
  failures === 0
    ? '\nALL CHECKS PASSED\n'
    : `\n${failures} FILE(S) FAILED\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
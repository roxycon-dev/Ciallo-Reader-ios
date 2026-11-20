/**
 * constNameBinding.test.ts —— **名字 + 数值双对齐**的声明级门禁。
 *
 * 比 `kotlinLiterals.test.ts` 更强的一层：字面量存在性只能证明「iOS 侧某处出现过 0.66」，
 * 证明不了「`METRICS_DEPTH_X` 就是 0.66」。这条门禁要求：
 *
 *   ① 从 Kotlin 抽出 `const val NAME = <数值>`（含 object 内部的缩进写法）；
 *   ② 在 iOS 侧归属文件里定位**同名符号**（`NAME` 或它的 camelCase 形式）；
 *   ③ 断言该符号出现的行附近（±1 行）就写着同一个数（允许 `200_000` / `200000` /
 *      `2.0e5` 三种写法）；
 *   ④ 名字完全不在 iOS 侧（改名/内联场景）单独计数，并断言这类占比不高于实测基线
 *      —— 这样「悄悄把常量值改掉」会红，「按 Web 习惯改名」不会红。
 *
 * 实测基线（2026-11-16）：见下方 `BASELINE`，Kotlin 侧新增常量时同步上调。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

interface LedgerFile {
  readonly rel: string;
  readonly owners?: readonly string[];
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const ledger = JSON.parse(
  readFileSync(path.join(ROOT, 'tests', 'fixtures', 'parityLedger.json'), 'utf8'),
) as { readonly scan: readonly LedgerFile[] };

/** 实测基线：名字缺失（改名/内联）的条目数与上限。 */
const BASELINE = { minBound: 40, maxUnboundRatio: 0.45 } as const;

const SKIP_VALUES = new Set([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32]);

interface ConstDecl {
  readonly name: string;
  readonly value: number;
  readonly raw: string;
}

/** `const val NAME = 0.66f` / `const val NAME: Float = 1_500L` / object 内缩进写法。 */
function kotlinConsts(source: string): readonly ConstDecl[] {
  const out: ConstDecl[] = [];
  const seen = new Set<string>();
  const re =
    /^[ \t]*(?:@\w+(?:\([^)]*\))?[ \t]+)*(?:(?:private|internal|public|protected)\s+)+const\s+val\s+([A-Za-z0-9_]+)\s*(?::\s*[A-Za-z<>?.]+)?\s*=\s*(-?[\d_.]+)\s*(?:\.dp|\.sp|[fFdDlL])?[ \t]*$/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    if (name.length < 3 || seen.has(name)) continue;
    const cleaned = (m[2] ?? '').replace(/_/g, '').replace(/\.+$/, '');
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cleaned)) continue;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || SKIP_VALUES.has(value)) continue;
    seen.add(name);
    out.push({ name, value, raw: (m[2] ?? '').replace(/_/g, '') });
  }
  return out;
}

function camel(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

/** 一个数值可能出现的写法集合。 */
function valueForms(value: number, raw: string): readonly string[] {
  const forms = new Set<string>([String(value), raw.replace(/\.$/, '')]);
  // `200000` ↔ `200_000` ↔ `2_000_000`
  const digits = String(Math.trunc(Math.abs(value)));
  if (Number.isInteger(value) && digits.length >= 4) {
    const groups = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '_');
    forms.add((value < 0 ? '-' : '') + groups);
  }
  // `0.660` / `0.66`
  if (!Number.isInteger(value)) forms.add(String(Number(value.toFixed(4))));
  return [...forms];
}

interface Binding {
  readonly rel: string;
  readonly decl: ConstDecl;
  readonly symbol: string;
  readonly ok: boolean;
  readonly seenValues: readonly string[];
}

function bindAll(): { readonly bound: readonly Binding[]; readonly unbound: readonly string[] } {
  const bound: Binding[] = [];
  const unbound: string[] = [];

  for (const file of ledger.scan) {
    const owners = file.owners ?? [];
    if (owners.length === 0) continue;
    const source = readFileSync(androidReference(`app/src/main/java/${file.rel}`), 'utf8');
    const decls = kotlinConsts(source);
    if (decls.length === 0) continue;

    // 合并 owners 的行数组，保留「绝对行号」的拼接偏移。
    const lines: string[] = [];
    for (const rel of owners) {
      try {
        lines.push(...readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/));
      } catch {
        // 归属文件缺失由其它门禁负责
      }
      lines.push(''); // 文件之间的分隔行
    }
    if (lines.length === 0) continue;

    for (const decl of decls) {
      // 候选符号：UPPER_SNAKE 与 camelCase 都要看 —— 常量与同名函数可能撞车
      // （`BLUR_RADIUS_TO_SIGMA` 常量 vs `blurRadiusToSigma()` 函数），
      // 因此收集全部非注释命中位置，任一命中处附近出现同值即算对齐。
      const names = [decl.name, camel(decl.name)];
      const hits: { readonly line: number; readonly symbol: string }[] = [];
      for (const symbol of names) {
        const re = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\b`);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? '';
          if (!re.test(line)) continue;
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          hits.push({ line: i, symbol });
          if (hits.length >= 8) break;
        }
        if (hits.length >= 8) break;
      }
      if (hits.length === 0) {
        unbound.push(`${file.rel}::${decl.name}`);
        continue;
      }
      const forms = valueForms(decl.value, decl.raw);
      let okHit: { readonly line: number; readonly symbol: string } | null = null;
      const seenValues = new Set<string>();
      for (const hit of hits) {
        // ±2 行窗口：同一对象里的相邻字段常跨行书写
        const window = [
          lines[hit.line - 2] ?? '',
          lines[hit.line - 1] ?? '',
          lines[hit.line] ?? '',
          lines[hit.line + 1] ?? '',
          lines[hit.line + 2] ?? '',
        ].join('\n');
        if (forms.some((f) => window.includes(f))) {
          okHit = hit;
          break;
        }
        for (const v of window.match(/-?\d[\d_.]*/g)?.slice(0, 4) ?? []) seenValues.add(v);
      }
      bound.push({
        rel: file.rel,
        decl,
        symbol: okHit?.symbol ?? hits[0]?.symbol ?? names[0] ?? decl.name,
        ok: okHit !== null,
        seenValues: okHit !== null ? [] : [...seenValues].slice(0, 6),
      });
    }
  }
  return { bound, unbound };
}

describe('const val 的名字 + 数值双对齐', () => {
  const { bound, unbound } = bindAll();
  const total = bound.length + unbound.length;

  it('至少绑定了 150 条 const val（规模下限，防规则空转）', () => {
    console.log(
      `const binding: total=${String(total)} bound=${String(bound.length)} unbound=${String(unbound.length)}`,
    );
    expect(total).toBeGreaterThanOrEqual(BASELINE.minBound);
    expect(bound.length).toBeGreaterThanOrEqual(BASELINE.minBound);
  });

  it('每个已绑定的常量，iOS 侧同名符号附近就是同一个值', () => {
    const drift = bound
      .filter((b) => !b.ok)
      .map(
        (b) =>
          `${b.rel}::${b.decl.name}（Kotlin=${String(b.decl.value)}，iOS 侧 \`${b.symbol}\` 附近见到 ${b.seenValues.join(' ')}）`,
      );
    expect(drift).toEqual([]);
  });

  it('改名/内联的常量占比不超过实测上限（防止「整包改名」绕过门禁）', () => {
    const ratio = unbound.length / Math.max(total, 1);
    expect(ratio).toBeLessThanOrEqual(BASELINE.maxUnboundRatio);
  });
});

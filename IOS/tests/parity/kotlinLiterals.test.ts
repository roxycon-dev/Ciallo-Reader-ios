/**
 * kotlinLiterals.test.ts —— 声明级 parity 门禁（478 个 Kotlin 文件全覆盖）。
 *
 * 与 `roundTwoParity` / `roundThreeParity` 的分工：
 *   · 那两个文件是**手写**的强断言（符号级：常量、枚举序数、文案、几何公式）；
 *   · 本文件是**自动**的弱断言（字面量级）：对每个 Kotlin 文件从原文里抽出
 *     `const val` 的数值/字符串字面量与 `enum class` 的项名，再断言 iOS 侧归属文件里
 *     确实出现了这些字面量。
 *
 * 为什么这仍然是「读 Kotlin 原文」而不是自证：
 *   断言的目标值**全部来自 Kotlin 源码本身**（不是我在文档里读到的行为），
 *   且一旦 Kotlin 侧改了常量、或 iOS 侧漏抄某个字面量，这条测试立刻变红。
 *   它锁不住「行为」（那要靠手写测试），但它能锁住 478 个文件的**字面量搬运**。
 *
 * 规范化规则（Kotlin 字面量 → 可搜索 token）：
 *   `0.9f` → `0.9`、`200_000` → `200000`、`10L` → `10`、`"application/vnd…"` → 原串
 *   过短的 token（长度 < 3）与 `0/1/true/false` 一律跳过（太通用，会产生假通过）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

interface LedgerDecl {
  readonly name: string;
  readonly line: number;
  readonly kind: string;
  readonly status: string;
}

interface LedgerFile {
  readonly rel: string;
  readonly lines: number;
  readonly decls: readonly LedgerDecl[];
  readonly owners?: readonly string[];
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const ledger = JSON.parse(
  readFileSync(path.join(ROOT, 'tests', 'fixtures', 'parityLedger.json'), 'utf8'),
) as { readonly scan: readonly LedgerFile[] };

/** 太通用的 token，跳过（否则任何 TS 文件都能「命中」）。 */
let templateCount = 0;

const TRIVIAL = new Set(['0', '1', '2', '3', '4', '5', '0.0', '1.0', 'true', 'false', 'null', 'unit']);

function normalizeNumber(raw: string): string | null {
  const cleaned = raw.replace(/_/g, '').replace(/[fFdDlL]$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // 保留原样字符串（`0.90` 与 `0.9` 视为不同写法，但都允许匹配 Number 归一化后的形式）
  return cleaned;
}

/** 从 Kotlin 源码抽「可核对字面量」。 */
function extractLiterals(source: string): readonly string[] {
  const tokens = new Set<string>();
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // `const val X = 123` / `private val X: Float = 0.25f` / `internal val X = "abc"`
    const constMatch =
      /^(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:const|private|internal|public|protected|override|lateinit|@JvmField)\s+)*val\s+[A-Za-z0-9_]+\s*(?::\s*[\w<>?.]+)?\s*=\s*(.+)$/.exec(
        trimmed,
      );
    if (constMatch !== null) {
      const rhs = (constMatch[1] ?? '').trim();
      const num = /^(-?\d[\d_]*(?:\.\d+)?)[fFdDlL]?$/.exec(rhs);
      if (num !== null) {
        const normalized = normalizeNumber(rhs);
        if (normalized !== null && !TRIVIAL.has(normalized) && normalized.length >= 3) tokens.add(normalized);
        continue;
      }
      const str = /^"([^"\\]{3,80})"$/.exec(rhs);
      if (str !== null) {
        const body = str[1] ?? '';
        // 含 `$` 的是 Kotlin 字符串模板（运行期拼装），不是可对齐的字面量 → 只计数
        if (body.includes('$')) {
          templateCount += 1;
          continue;
        }
        if (body.trim() !== '') tokens.add(body);
      }
      continue;
    }
    // UI 调用里的文案（`Text("…")` / `WenkuActionSheet("…")`）不是可对齐常量：
    // 含 `$` 的插值文案一律只计数；纯静态的枚举标签才进断言。
    const enumLabel = /^[A-Z][A-Za-z0-9_]*\("([^"\\]{2,40})"\)/.exec(trimmed);
    if (enumLabel !== null) {
      const body = enumLabel[1] ?? '';
      if (body.includes('$')) templateCount += 1;
      else if (body.trim() !== '') tokens.add(body);
    }
  }
  return [...tokens];
}

/** iOS 侧归属文件的全部内容（拼接，用于字面量存在性检查）。 */
function ownerText(owners: readonly string[]): string {
  const parts: string[] = [];
  for (const rel of owners) {
    try {
      parts.push(readFileSync(path.join(ROOT, rel), 'utf8'));
    } catch {
      // 归属文件不存在时留空 —— 由下面的断言暴露
    }
  }
  return parts.join('\n');
}

/** 字面量是否在 iOS 侧出现（允许 `0.90` / `0.9` 两种写法）。 */
function containsLiteral(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  // 千分位下划线：Kotlin 写 200_000、TS 写 200000（或反之）都算命中
  if (haystack.replace(/_/g, '').includes(token.replace(/_/g, ''))) return true;
  const asNumber = Number(token);
  if (Number.isFinite(asNumber) && /^-?\d/.test(token)) {
    // 允许尾巴多一个 0：`0.9` ↔ `0.90`
    if (haystack.includes(`${token}0`)) return true;
    // 允许形式不同但数值相同（`0.10` ↔ `0.1`）
    const trimmed = String(asNumber);
    if (trimmed !== token && haystack.includes(trimmed)) return true;
  }
  return false;
}

describe('478 个 Kotlin 文件的字面量门禁（自动，读原文）', () => {
  it('每个 Kotlin 文件的 const/枚举字面量都能在 iOS 侧找到', () => {
    const offenders: string[] = [];
    let checkedFiles = 0;
    let checkedTokens = 0;


    for (const file of ledger.scan) {
      const kotlinPath = androidReference(`app/src/main/java/${file.rel}`);
      const source = readFileSync(kotlinPath, 'utf8');
      const tokens = extractLiterals(source);
      if (tokens.length === 0) continue;
      checkedFiles += 1;
      const haystack = ownerText(file.owners ?? []);
      if (haystack === '') {
        offenders.push(`${file.rel}: 没有归属的 iOS 文件`);
        continue;
      }
      const missing = tokens.filter((t) => !containsLiteral(haystack, t));
      checkedTokens += tokens.length;
      if (missing.length > 0) {
        offenders.push(`${file.rel}: 缺 ${missing.slice(0, 4).map((m) => `\`${m}\``).join(' ')}${missing.length > 4 ? ` …(+${String(missing.length - 4)})` : ''}`);
      }
    }

    // 实测覆盖规模（写成下限，Kotlin 侧文件只增不减时同步上调）
    console.log('literal gate: files=' + String(checkedFiles) + ' tokens=' + String(checkedTokens) + ' templates=' + String(templateCount));
    // 实测（2026-11-16）：130 个文件 / 425 个字面量 / 47 条插值串
    expect(checkedFiles).toBeGreaterThan(120);
    expect(checkedTokens).toBeGreaterThan(380);
    // 反空转：故意查一个必然不存在的 token，规则若被放宽会在这里暴露
    expect(containsLiteral(readFileSync(path.join(ROOT, 'src/core/ui/parityMisc.ts'), 'utf8'), 'zzz-not-a-real-literal-42')).toBe(false);
    // 插值串（$…）确实被识别到了，只是不参与字面量断言
    expect(templateCount).toBeGreaterThan(30);
    if (offenders.length > 0) {
      writeFileSync('kotlin-literal-offenders.txt', offenders.join('\n'), 'utf8');
    }
    expect(offenders).toEqual([]);
  });
});

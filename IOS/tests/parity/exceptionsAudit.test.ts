/**
 * exceptionsAudit.test.ts —— `docs/PARITY_EXCEPTIONS.md` 的**逐条实测复核**。
 *
 * 任务书要求「121 条 E 记录逐条实测复核，把已修的降级为已关闭」。人工读 148 行表格
 * 既慢又容易漏，所以把它变成门禁：
 *
 *   ① 抽出每条记录的 `ID / 模块 / iOS 行为 / 状态`；
 *   ② 从「Android 行为 + iOS 行为」两列里抓它引用的 **iOS 侧文件:行号**
 *      （`src/....ts:434`、`platform/web/webCrypto.ts:69`、`core/.../x.css` …）；
 *   ③ 逐个验证：文件真实存在；给了行号时，行号不超过该文件行数；
 *   ④ 状态自称「已关闭 / 已修复 / 已处理」却**没有引用任何 iOS 文件**的条目单列
 *      —— 这类就是「口头关闭」，必须补证据或改状态；
 *   ⑤ 状态仍写「未实现 / 待处理」但引用的符号其实已在 `src/` 里存在的条目单列
 *      —— 这类就是「文档过期」（E94 / E83 就是靠这条抓回来的）。
 *
 * 断言全部基于**当前工作区的真实文件**，不是文档自述。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOC = path.join(ROOT, 'docs', 'PARITY_EXCEPTIONS.md');

interface Entry {
  readonly id: string;
  readonly module: string;
  readonly android: string;
  readonly ios: string;
  readonly status: string;
}

/** 表格行：`| E12 | 模块 | Android 行为 | iOS 行为 | 原因 | 影响 | 状态 |`。 */
function parseEntries(markdown: string): readonly Entry[] {
  const out: Entry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*E\d+\s*\|/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] 是行首空串，cells[1] 是 ID；状态列是倒数第二格
    const status = cells[cells.length - 2] ?? '';
    out.push({
      id: cells[1] ?? '',
      module: cells[2] ?? '',
      android: cells[3] ?? '',
      ios: cells[4] ?? '',
      status,
    });
  }
  return out;
}

const doc = readFileSync(DOC, 'utf8');
const entries = parseEntries(doc);

/** iOS 侧源码清单（用于「符号是否已存在」的判断）。 */
const REF_EXTS = 'ts|tsx|css|json|plist|xml|m4a|ogg|ttf|otf|woff2?';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (new RegExp(`\\.(${REF_EXTS})$`).test(full)) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(path.join(ROOT, 'src'));
const SRC_TEXT = SRC_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
/**
 * 引用定位用的额外树：测试、静态资源、脚本、iOS 原生工程。
 * 不进 SRC_TEXT —— 它们只用于回答「文档点名的这个文件到底在不在」。
 */
const EXTRA_FILES = [
  ...walk(path.join(ROOT, 'tests')),
  ...walk(path.join(ROOT, 'public')),
  ...walk(path.join(ROOT, 'scripts')),
  ...(existsSync(path.join(ROOT, 'ios')) ? walk(path.join(ROOT, 'ios')) : []),
];

/** `basename（小写，去扩展名）→ 真实文件列表`；用于解析文档里省略前缀/大小写不一致的写法。 */
const BY_BASENAME = new Map<string, string[]>();
for (const file of [...SRC_FILES, ...EXTRA_FILES]) {
  const base = path.basename(file).replace(new RegExp(`\\.(${REF_EXTS})$`), '').toLowerCase();
  const list = BY_BASENAME.get(base) ?? [];
  list.push(file);
  BY_BASENAME.set(base, list);
}

/** 文档里出现这些片段时不是「iOS 文件引用」，跳过。 */
const IGNORED_REF =
  /^(?:org\.json|json\.ts|\.test\.ts|app\/src\/|AndroidManifest\.xml|build\.gradle|\.tsx?$)/;

/**
 * 引用两侧 48 字符内出现这些词，说明文档是在**描述一个已删除/不存在的文件**
 * （例如 E56 的「`PrivacySetupOverlay.tsx` 已删除，复核确认文件不存在」），
 * 不是在主张「这个文件存在」。这类不算缺失引用。
 */
const NEGATED_CONTEXT = /已删除|不存在|已收敛|作废|已移除|~~/;

/** 扩展名互换（文档常把 `.tsx` 写成 `.ts`）。 */
function swapExt(p: string): readonly string[] {
  if (p.endsWith('.ts')) return [p, `${p}x`];
  if (p.endsWith('.tsx')) return [p, p.slice(0, -1)];
  return [p];
}

/** 把文档里的相对路径解析成真实文件；解析不到返回 null。 */
function resolveIosFile(raw: string): string | null {
  // 目录引用（`src/core/audio/`、`IOS/public/fonts/`）—— 目录存在即算证据
  const asDir = raw.replace(/^`|`$/g, '').replace(/^IOS\//, '').replace(/^\.\//, '').replace(/^\/+/, '');
  if (asDir.endsWith('/')) {
    const dirCandidates = asDir.startsWith('src/')
      ? [asDir]
      : [asDir, `src/${asDir}`, `src/core/${asDir}`, `public/${asDir}`, `src/ui/${asDir}`];
    for (const rel of dirCandidates) {
      const abs = path.join(ROOT, rel);
      if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
    }
    return null;
  }
  const cleaned = asDir;
  if (!new RegExp(`\\.(${REF_EXTS})$`).test(cleaned)) return null;
  for (const variant of swapExt(cleaned)) {
    const candidates = variant.startsWith('src/')
      ? [variant]
      : [
          `src/${variant}`,
          `src/core/${variant}`,
          `src/ui/${variant}`,
          `src/platform/${variant}`,
          `src/ui/components/${variant}`,
          `src/ui/pages/${variant}`,
          `public/${variant}`,
          `tests/${variant}`,
          `ios/${variant}`,
          variant,
        ];
    for (const rel of candidates) {
      const abs = path.join(ROOT, rel);
      if (existsSync(abs) && statSync(abs).isFile()) return abs;
    }
  }
  // 退回 basename 索引（仅当唯一命中，或有命中的路径以文档给出的目录结尾）
  const base = path.basename(cleaned).replace(new RegExp(`\\.(${REF_EXTS})$`), '').toLowerCase();
  const hits = BY_BASENAME.get(base) ?? [];
  if (hits.length === 1) return hits[0] ?? null;
  if (hits.length > 1) {
    const dir = path.dirname(cleaned).toLowerCase().replace(/^\.\//, '');
    const tail = hits.find((h) => h.toLowerCase().replace(/\\/g, '/').includes(dir));
    return tail ?? null;
  }
  return null;
}

const FILE_REF = new RegExp(`([A-Za-z0-9_./-]+\\.(?:${REF_EXTS}))(?::(\\d+))?`, 'g');
/** 反引号内的目录引用：`` `src/core/audio/` ``。 */
const DIR_REF = /`(?:IOS\/)?((?:src|public|ios)\/[A-Za-z0-9_./-]+\/)`/g;

interface RefResult {
  readonly total: number;
  readonly missingFiles: readonly string[];
  readonly badLineNumbers: readonly string[];
  readonly noEvidence: readonly string[];
}

function auditRefs(): RefResult {
  let total = 0;
  const missingFiles: string[] = [];
  const badLineNumbers: string[] = [];

  for (const entry of entries) {
    // 模块列也常点名文件（E92 的 `legadoRuleDiff.test.ts` 就只在模块列），一并纳入扫描。
    const haystack = `${entry.module}\n${entry.android}\n${entry.ios}\n${entry.status}`;
    const seen = new Set<string>();

    // ① 目录引用
    DIR_REF.lastIndex = 0;
    let d;
    while ((d = DIR_REF.exec(haystack)) !== null) {
      const raw = d[1] ?? '';
      if (raw === '' || seen.has(`dir:${raw}`)) continue;
      seen.add(`dir:${raw}`);
      total += 1;
      if (resolveIosFile(raw) === null) missingFiles.push(`${entry.id} → ${raw}（目录）`);
    }

    // ② 文件引用
    let m;
    FILE_REF.lastIndex = 0;
    while ((m = FILE_REF.exec(haystack)) !== null) {
      const raw = m[1] ?? '';
      if (raw === '' || raw.includes('novel-reader/') || IGNORED_REF.test(raw)) continue;
      const key = `${raw}:${m[2] ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += 1;
      const abs = resolveIosFile(raw);
      if (abs === null) {
        // 若这句话本身是在说「该文件不存在/已删除」，不算缺失引用
        const around = haystack.slice(Math.max(0, m.index - 48), m.index + raw.length + 48);
        if (NEGATED_CONTEXT.test(around)) continue;
        missingFiles.push(`${entry.id} → ${raw}${m[2] === undefined ? '' : `:${m[2]}`}`);
        continue;
      }
      if (m[2] !== undefined) {
        const lineCount = readFileSync(abs, 'utf8').split(/\r?\n/).length;
        const lineNo = Number(m[2]);
        if (!(lineNo >= 1 && lineNo <= lineCount)) {
          badLineNumbers.push(`${entry.id} → ${raw}:${String(lineNo)}（文件只有 ${String(lineCount)} 行）`);
        }
      }
    }
  }

  // 自称「已关闭/已修复/已处理」却没有任何 iOS 侧引用 → 口头关闭
  const noEvidence = entries
    .filter((e) => /已关闭|已修复|已修|已处理|已接入|已核对|作废/.test(e.status))
    .filter((e) => {
      const haystack = `${e.module}\n${e.android}\n${e.ios}\n${e.status}`;
      DIR_REF.lastIndex = 0;
      let d;
      while ((d = DIR_REF.exec(haystack)) !== null) {
        if (resolveIosFile(d[1] ?? '') !== null) return false;
      }
      FILE_REF.lastIndex = 0;
      let m;
      while ((m = FILE_REF.exec(haystack)) !== null) {
        const raw = m[1] ?? '';
        if (raw === '' || raw.includes('novel-reader/') || IGNORED_REF.test(raw)) continue;
        if (resolveIosFile(raw) !== null) return false;
      }
      return true;
    })
    .map((e) => `${e.id}（状态：${e.status.slice(0, 40)}）`);

  return { total, missingFiles, badLineNumbers, noEvidence };
}

describe('PARITY_EXCEPTIONS.md 逐条实测复核', () => {
  const audit = auditRefs();

  it('解析到的 E 记录数量与文档规模一致', () => {
    console.log(
      `exceptions: entries=${String(entries.length)} fileRefs=${String(audit.total)} missing=${String(audit.missingFiles.length)} badLines=${String(audit.badLineNumbers.length)} noEvidence=${String(audit.noEvidence.length)}`,
    );
    expect(entries.length).toBeGreaterThanOrEqual(120);
    expect(audit.total).toBeGreaterThanOrEqual(100);
  });

  it('每条记录引用的 iOS 文件都必须真实存在', () => {
    console.log(`missingFiles(${String(audit.missingFiles.length)}): ${audit.missingFiles.join(' | ')}`);
    expect(audit.missingFiles.slice(0, 40)).toEqual([]);
  });

  it('每条记录都必须有 Kotlin 行号定位，或显式标注「Kotlin 侧无对应」', () => {
    const withKtLine = entries.filter((e) => /\.kt:\d+/.test(`${e.module}\n${e.android}\n${e.ios}\n${e.status}`));
    const noKotlin = entries.filter(
      (e) => !/\.kt:\d+/.test(`${e.module}\n${e.android}\n${e.ios}\n${e.status}`) && e.status.includes('NO_KOTLIN'),
    );
    const missing = entries
      .filter((e) => !/\.kt:\d+/.test(`${e.module}\n${e.android}\n${e.ios}\n${e.status}`))
      .filter((e) => !e.status.includes('NO_KOTLIN'))
      .map((e) => e.id);
    const ratio = (withKtLine.length + noKotlin.length) / Math.max(entries.length, 1);
    console.log(
      `kotlinLocator: 行号=${String(withKtLine.length)} 显式无对应=${String(noKotlin.length)} 缺=${String(missing.length)} 覆盖=${(ratio * 100).toFixed(1)}%`,
    );
    console.log(`withoutKotlinLocator(${String(missing.length)}): ${missing.join(' ')}`);
    // 交付线：每条 E 记录都要能追到 Kotlin 行号，或显式说明 Kotlin 侧无对应
    expect(missing).toEqual([]);
    expect(ratio).toBe(1);
  });

  it('引用里给了行号的，行号必须落在文件范围内', () => {
    console.log(`badLines(${String(audit.badLineNumbers.length)}): ${audit.badLineNumbers.join(' | ')}`);
    expect(audit.badLineNumbers.slice(0, 40)).toEqual([]);
  });

  it('自称已关闭/已修复的条目必须点名至少一个真实 iOS 文件', () => {
    console.log(`noEvidence(${String(audit.noEvidence.length)}): ${audit.noEvidence.join(' | ')}`);
    expect(audit.noEvidence.slice(0, 40)).toEqual([]);
  });

  it('状态仍写「未实现」但符号已在 src 里的条目为空（文档过期检测）', () => {
    // 「部分修复 / 部分完成 / 进行中」本身就在承认残留，不算过期结论；
    // 只有**整条宣称未做**却已落地大量符号的，才是文档过期。
    const stale = entries
      .filter((e) => /未实现|零调用方|缺失|待处理/.test(e.status))
      .filter((e) => !/部分修复|部分完成|进行中|已处理|待接线/.test(e.status))
      .flatMap((e) => {
        // 从 iOS 行为列里抽反引号内的标识符（长度 ≥ 8，避免 too generic）
        const symbols = [...e.ios.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]{7,})`/g)].map((m) => m[1] ?? '');
        const present = symbols.filter((s) => new RegExp(`\\b${s.replace(/[$]/g, '\\$')}\\b`).test(SRC_TEXT));
        // 阈值取 3：1–2 个符号可能只是「顺带提到」，3 个以上说明实现已成型
        return present.length >= 3 ? [`${e.id}（${present.slice(0, 3).join(' / ')} 已在 src）`] : [];
      });
    console.log(`stale(${String(stale.length)}): ${stale.join(' | ')}`);
    expect(stale.slice(0, 20)).toEqual([]);
  });
});

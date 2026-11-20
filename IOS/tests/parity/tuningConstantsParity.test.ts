/**
 * tuningConstantsParity.test.ts —— 第二批「调参常量」逐值对拍（8 个模块）。
 *
 * 覆盖：神回封面合成、神回动效曲线、自动备份、AliceSW 路由、Z-Library 端点、
 *       漫画场景特效、MangaJaNai 模型、小说分页缓存。
 *
 * 三类约束都要满足，缺一不可：
 *   ① **同名或显式改名**：iOS 侧的命名习惯不同（`GOD_` 前缀、`PAGE_BUFFER_` 前缀），
 *      映射表 `ALIASES` 逐条登记，绝不放宽成「随便找个同值的常量」。
 *   ② **数值相等**：单位不同的（秒 ↔ 毫秒）用 `scale` 换算后比较，换算本身也断言。
 *   ③ **死常量要证明是死的**：`GodMotion.kt` 的 `SWING_STAGGER_MS` / `BREATH_MS` /
 *      `VINYL_SPIN_MS` 在 Android 源码树里零引用（只有声明行），iOS 不实现它们是有依据的 ——
 *      测试去 Kotlin 全文数引用次数来证明，而不是嘴上说。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

const KT_ROOT = path.dirname(androidReference('app/src/main/java/x.kt'));

/* ══════════════════════════════════════════════════════════════════════════════
 * 解析器：Kotlin `const val` / TS `const` 与 `static readonly`
 * ══════════════════════════════════════════════════════════════════════════════ */

const ATOM = '(?:0[xX][0-9a-fA-F_]+|[\\d_]+(?:\\.[\\d_]+)?(?:[eE][-+]?\\d+)?)[fFlL]?';
/** `12 * 60 * 60 * 1000` / `3f / 4f` / `8L * 1024 * 1024` / 纯数字。 */
const EXPR = `-?${ATOM}(?:\\s*[*/]\\s*${ATOM})*`;

function evalExpr(raw: string): number | null {
  // 先清掉**每个**数字字面量的 f/L 后缀（`3f / 4f` → `3 / 4`、`8L * 1024` → `8 * 1024`），
  // 再清下划线分隔符。只清末尾是不够的：乘法表达式里的后缀在中间。
  const normalized = raw
    .replace(/(\d)[fFlL]\b/g, '$1')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^-?0[xX]/.test(normalized)) return Number.parseInt(normalized.replace(/^-/, ''), 16);
  if (!/^[\d.\s*/()+ -]+$/.test(normalized)) return null;
  try {
    const value = Function(`"use strict";return (${normalized});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function parseKotlinConsts(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(
    `(?:(?:private|internal|public)\\s+)?const\\s+val\\s+([A-Z][A-Z0-9_]*)\\s*(?::\\s*[\\w<>?.]+)?\\s*=\\s*(${EXPR})\\s*(?:\\.[dsp]+|[fFlL])?`,
    'g',
  );
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    const value = evalExpr(m[2] ?? '');
    if (name !== '' && value !== null && !out.has(name)) out.set(name, value);
  }
  return out;
}

function parseTsConsts(source: string): Map<string, number> {
  const out = new Map<string, number>();
  // `const NAME = …;` / `export const NAME = …;` / `static readonly NAME = …;`
  const re = new RegExp(
    `(?:(?:export)\\s+)?(?:(?:static)\\s+)?(?:const|readonly)\\s+([A-Z][A-Z0-9_]*)\\s*(?::[^=]+)?=\\s*(${EXPR})(?=\\s*(?:;|$))`,
    'gm',
  );
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    const value = evalExpr(m[2] ?? '');
    if (name !== '' && value !== null && !out.has(name)) out.set(name, value);
  }
  return out;
}

interface Alias {
  /** iOS 侧的常量名。 */
  readonly name: string;
  /** Kotlin → iOS 的单位换算（例如秒 → 毫秒填 1000）。 */
  readonly scale?: number;
}

interface PairSpec {
  readonly kt: string;
  readonly ts: readonly string[];
  readonly aliases?: Readonly<Record<string, Alias>>;
  /** 字符串常量（本测试只比数值，但要显式列出，避免「悄悄漏掉」）。 */
  readonly nonNumeric?: readonly string[];
}

const PAIRS: readonly PairSpec[] = [
  {
    kt: 'com/example/god/GodCoverEngine.kt',
    ts: ['src/core/god/godCoverEngine.ts'],
    aliases: {
      COVER_W: { name: 'GOD_COVER_WIDTH' },
      COVER_H: { name: 'GOD_COVER_HEIGHT' },
      COVER_RATIO: { name: 'GOD_COVER_RATIO' },
      PREVIEW_W: { name: 'GOD_PREVIEW_WIDTH' },
      PREVIEW_H: { name: 'GOD_PREVIEW_HEIGHT' },
      JPEG_QUALITY: { name: 'GOD_JPEG_QUALITY' },
      FOREGROUND_MARGIN: { name: 'GOD_FOREGROUND_MARGIN' },
      CORNER_RATIO: { name: 'GOD_CORNER_RATIO' },
      BLUR_RADIUS_RATIO: { name: 'GOD_BLUR_RADIUS_RATIO' },
      BLUR_DOWNSCALE: { name: 'GOD_BLUR_DOWNSCALE' },
      SCRIM_ALPHA: { name: 'GOD_SCRIM_ALPHA' },
      SHADOW_BLUR: { name: 'GOD_SHADOW_BLUR' },
      SHADOW_DY: { name: 'GOD_SHADOW_DY' },
      SHADOW_ALPHA: { name: 'GOD_SHADOW_ALPHA' },
      DECODE_MAX_EDGE: { name: 'GOD_DECODE_MAX_EDGE' },
      THUMB_MAX_EDGE: { name: 'GOD_THUMB_EDGE_THRESHOLD' },
    },
    nonNumeric: ['CACHE_DIR'],
  },
  {
    kt: 'com/example/god/GodMotion.kt',
    ts: ['src/core/god/godEasing.ts', 'src/core/god/godPull.ts', 'src/core/god/godChapterCard.ts'],
    aliases: {
      // iOS 用 GOD_ 前缀把神回动效常量与通用动效区分开
      FAST_MS: { name: 'GOD_FAST_MS' },
      NORMAL_MS: { name: 'GOD_NORMAL_MS' },
      SLOW_MS: { name: 'GOD_SLOW_MS' },
      SHEET_MS: { name: 'GOD_SHEET_MS' },
      STAGGER_MS: { name: 'GOD_STAGGER_MS' },
      SHINE_MS: { name: 'GOD_SHINE_MS' },
      BORDER_SWEEP_MS: { name: 'GOD_BORDER_SWEEP_MS' },
      SHEET_CORNER: { name: 'GOD_SHEET_CORNER' },
      CARD_CORNER: { name: 'GOD_CARD_CORNER' },
      BUTTON_CORNER: { name: 'GOD_BUTTON_CORNER' },
      PRESS_SCALE: { name: 'GOD_PRESS_SCALE' },
      PRESS_ALPHA: { name: 'GOD_PRESS_ALPHA' },
      PULL_THRESHOLD_DP: { name: 'GOD_PULL_THRESHOLD_DP' },
      PULL_DAMPING: { name: 'GOD_PULL_DAMPING' },
    },
  },
  {
    kt: 'com/example/data/AutoBackupStore.kt',
    ts: ['src/core/backup/autoBackupStore.ts'],
  },
  {
    kt: 'com/example/source/impl/AliceSwEndpoints.kt',
    ts: ['src/core/source/impl/aliceSwEndpoints.ts'],
    aliases: {
      // Kotlin 用秒、iOS 用毫秒：单位换算写在这里，值差 1000 倍是有意的
      PROBE_TIMEOUT_S: { name: 'PROBE_TIMEOUT_MS', scale: 1000 },
      DISCOVERY_TIMEOUT_S: { name: 'DISCOVERY_TIMEOUT_MS', scale: 1000 },
    },
  },
  {
    kt: 'com/example/source/zlibrary/ZLibraryEndpointProvider.kt',
    ts: ['src/core/source/zlibrary/zLibraryEndpointProvider.ts'],
    nonNumeric: ['PREFS_NAME', 'KEY_CACHED_DOMAIN', 'KEY_CACHED_TIMESTAMP', 'KEY_CUSTOM_ENDPOINT'],
  },
  {
    kt: 'com/example/ui/comic/ComicSceneFx.kt',
    ts: ['src/core/comic/comicSceneFx.ts'],
    nonNumeric: ['WAVE_FRONT', 'WAVE_BACK'],
  },
  {
    kt: 'com/example/ui/comic/MangaJaNai.kt',
    ts: ['src/core/comic/mangaJaNai.ts', 'src/core/comic/mangaJaNaiFull.ts'],
    aliases: {
      MODEL_BYTES: { name: 'MANGA_JANAI_MODEL_BYTES' },
      TILE: { name: 'MANGA_JANAI_TILE' },
      HALO: { name: 'MANGA_JANAI_HALO' },
      DEADLINE_NS: { name: 'MANGA_JANAI_DEADLINE_NS' },
    },
    nonNumeric: ['SHA256', 'PACK_URL'],
  },
  {
    kt: 'com/example/ui/ReaderPagination.kt',
    ts: ['src/core/reader/paginationEnvironment.ts'],
    aliases: {
      MAX_ENTRIES: { name: 'PAGE_BUFFER_MAX_ENTRIES' },
      MAX_BYTES: { name: 'PAGE_BUFFER_MAX_BYTES' },
    },
  },
];

/** `GodMotion.kt` 里在 Android 源码树中**零引用**的常量（只有声明行）。 */
const DEAD_CONSTS = [
  'com/example/god/GodMotion.kt::SWING_STAGGER_MS',
  'com/example/god/GodMotion.kt::BREATH_MS',
  'com/example/god/GodMotion.kt::VINYL_SPIN_MS',
];

function walkKotlin(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkKotlin(full, out);
    else if (full.endsWith('.kt')) out.push(full);
  }
  return out;
}

const ALL_KT_TEXT = walkKotlin(KT_ROOT)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('调参常量逐值对拍（8 个模块）', () => {
  it('每个 Kotlin 常量在 iOS 侧都有同名或显式改名的载体，且数值一致', () => {
    const drift: string[] = [];
    let checked = 0;

    for (const spec of PAIRS) {
      const kotlin = parseKotlinConsts(readFileSync(androidReference(`app/src/main/java/${spec.kt}`), 'utf8'));
      const ts = new Map<string, number>();
      for (const rel of spec.ts) {
        for (const [k, v] of parseTsConsts(readFileSync(rel, 'utf8'))) if (!ts.has(k)) ts.set(k, v);
      }
      const skip = new Set(spec.nonNumeric ?? []);

      for (const [name, ktValue] of kotlin) {
        if (skip.has(name)) continue;
        if (DEAD_CONSTS.includes(`${spec.kt}::${name}`)) continue;
        const alias = spec.aliases?.[name];
        const tsName = alias?.name ?? name;
        const expectValue = ktValue * (alias?.scale ?? 1);
        const tsValue = ts.get(tsName);
        if (tsValue === undefined) {
          drift.push(`${spec.kt}::${name} → ${spec.ts.join('|')} 缺 ${tsName}`);
          continue;
        }
        if (Math.abs(tsValue - expectValue) > 1e-9) {
          drift.push(`${spec.kt}::${name}：Kotlin=${String(ktValue)}${alias?.scale === undefined ? '' : `×${String(alias.scale)}`} iOS(${tsName})=${String(tsValue)}`);
          continue;
        }
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThanOrEqual(43);
    expect(drift).toEqual([]);
  });

  it('映射表里的每一条都真的被用到（防止留下失效映射）', () => {
    const unused: string[] = [];
    for (const spec of PAIRS) {
      const kotlin = parseKotlinConsts(readFileSync(androidReference(`app/src/main/java/${spec.kt}`), 'utf8'));
      for (const key of Object.keys(spec.aliases ?? {})) {
        if (!kotlin.has(key)) unused.push(`${spec.kt}::${key}`);
      }
    }
    expect(unused).toEqual([]);
  });

  it('死常量在 Android 源码树里确实零引用（只有声明本身）', () => {
    const wrong: string[] = [];
    for (const entry of DEAD_CONSTS) {
      const name = entry.split('::')[1] ?? '';
      // 统计 `name` 在全部 Kotlin 里出现次数：声明行 1 次，无其它引用
      const hits = ALL_KT_TEXT.split(new RegExp(`\\b${name}\\b`)).length - 1;
      if (hits > 1) wrong.push(`${entry}：Kotlin 里出现 ${String(hits)} 次（不是死常量）`);
    }
    expect(wrong).toEqual([]);
  });

  it('关键关系的语义方向正确（预览是成品的 1/2、预算 8 MiB、备份 12 小时）', () => {
    const cover = parseKotlinConsts(readFileSync(androidReference('app/src/main/java/com/example/god/GodCoverEngine.kt'), 'utf8'));
    expect(cover.get('PREVIEW_W')).toBe((cover.get('COVER_W') ?? 0) / 2);
    expect(cover.get('PREVIEW_H')).toBe((cover.get('COVER_H') ?? 0) / 2);
    // 成品 900×1200 → 3:4
    expect((cover.get('COVER_W') ?? 0) / (cover.get('COVER_H') ?? 0)).toBeCloseTo(0.75, 6);
    // 缩略图门槛必须**小于**默认解码长边（否则所有请求都走封面信号量）
    expect(cover.get('THUMB_MAX_EDGE') ?? 0).toBeLessThan(cover.get('DECODE_MAX_EDGE') ?? 0);

    const backup = parseKotlinConsts(readFileSync(androidReference('app/src/main/java/com/example/data/AutoBackupStore.kt'), 'utf8'));
    expect(backup.get('INTERVAL_MS')).toBe(12 * 60 * 60 * 1000);
    expect(backup.get('MAX_KEPT')).toBe(3);

    const pagination = parseKotlinConsts(readFileSync(androidReference('app/src/main/java/com/example/ui/ReaderPagination.kt'), 'utf8'));
    expect(pagination.get('MAX_BYTES')).toBe(8 * 1024 * 1024);
    expect(pagination.get('MAX_ENTRIES')).toBe(8);
  });
});

/**
 * mangaTranslateTuningParity.test.ts —— 漫画翻译的 **87 个调参常量**逐值对拍。
 *
 * 为什么这批重要：`PageRegionTiling` / `TextBlockMerger` / `MangaOcr` / `BubblePipeline`
 * 里的都是**启发式阈值**（长图切块比例、气泡去重 IoU、合并打分权重、OCR 输入尺寸…）。
 * 任何一个漂 0.05，表现都是「某些气泡漏译 / 框偏 / 断行」这类只在特定图上出现的毛病，
 * 编译期与常规 UI 测试都抓不到。
 *
 * 断言方式：iOS 侧这些常量是模块内 `const`（没有 `export`），因此从**源码文本**解析
 * `const NAME = <number>` 与 Kotlin 的 `const val NAME = <number>` 按名对拍。
 * 两边都是真实源码，任一侧改值都会红。
 *
 * 唯一的名字映射：`MangaOcr.kt` 的 `INPUT`（识别网络输入边长 960）在 iOS 侧叫
 * `DET_INPUT` —— 因为同模块还有检测网络的输入，必须区分。映射表 `RENAMED` 显式登记。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

const KT_DIR = 'app/src/main/java/com/example/mangatranslate';

const FILES: readonly (readonly [string, string])[] = [
  ['PageRegionTiling.kt', 'src/core/mangatranslate/pageRegionTiling.ts'],
  ['TextBlockMerger.kt', 'src/core/mangatranslate/textBlockMerger.ts'],
  ['MangaOcr.kt', 'src/core/mangatranslate/mangaOcr.ts'],
  ['BubblePipeline.kt', 'src/core/mangatranslate/bubblePipeline.ts'],
  ['PageRegionDetector.kt', 'src/core/mangatranslate/pageRegionDetector.ts'],
];

/** Kotlin 常量名 → iOS 侧的改名（只登记真实改名，不猜）。 */
const RENAMED: Readonly<Record<string, string>> = {
  // `MangaOcr.kt` L342 `const val INPUT = 960`（识别网络）→ iOS 区分检测/识别两个网络
  INPUT: 'DET_INPUT',
  // `MangaOcr.kt` L490-491 `IMG_H = 48` / `IMG_W = 320`（CRNN 输入）→ iOS 加 `REC_` 前缀
  IMG_H: 'REC_IMG_H',
  IMG_W: 'REC_IMG_W',
};

/** 数值字面量：十进制（可带分隔符/小数）或十六进制（`0xFF1B1B1B`）。 */
const NUM = '(?:0[xX][0-9a-fA-F_]+|-?[\\d_]+(?:\\.[\\d_]+)?(?:[eE][-+]?\\d+)?)';

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/_/g, '');
  const value = cleaned.toLowerCase().startsWith('0x') ? Number.parseInt(cleaned, 16) : Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** 从 Kotlin 抽 `const val NAME = <数字>`（允许下划线、`f/L` 后缀、`.dp/.sp`、`.toInt()`）。 */
function parseKotlinConsts(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(
    `(?:(?:private|internal|public)\\s+)?const\\s+val\\s+([A-Z][A-Z0-9_]*)\\s*(?::\\s*[\\w<>?.]+)?\\s*=\\s*(${NUM})\\s*(?:\\.[dsp]+|[fFlL])?`,
    'g',
  );
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    if (name === '') continue;
    const value = parseNumber(m[2] ?? '');
    if (value === null) continue;
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/** 从 TS 抽 `const NAME = <数字>`（含 `export const`，允许数字分隔符与十六进制）。 */
function parseTsConsts(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(`(?:export\\s+)?const\\s+([A-Z][A-Z0-9_]*)\\s*(?::[^=]+)?=\\s*(${NUM})\\s*;`, 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    if (name === '') continue;
    const value = parseNumber(m[2] ?? '');
    if (value === null) continue;
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

describe('漫画翻译调参常量逐值对拍', () => {
  it('五个模块的常量名与数值全部一致', () => {
    const drift: string[] = [];
    let checked = 0;

    for (const [ktName, tsPath] of FILES) {
      const kotlin = parseKotlinConsts(readFileSync(androidReference(`${KT_DIR}/${ktName}`), 'utf8'));
      const ts = parseTsConsts(readFileSync(tsPath, 'utf8'));

      for (const [name, ktValue] of kotlin) {
        const tsName = RENAMED[name] ?? name;
        const tsValue = ts.get(tsName);
        if (tsValue === undefined) {
          drift.push(`${ktName}::${name} → ${tsPath} 缺 ${tsName}`);
          continue;
        }
        if (Math.abs(tsValue - ktValue) > 1e-9) {
          drift.push(`${ktName}::${name}：Kotlin=${String(ktValue)} iOS=${String(tsValue)}`);
          continue;
        }
        checked += 1;
      }
    }

    // 实测规模（不许悄悄变少）
    expect(checked).toBeGreaterThanOrEqual(80);
    expect(drift).toEqual([]);
  });

  it('每个文件的常量条数达到实测基线（防止整段被删）', () => {
    const expected = new Map<string, number>([
      ['PageRegionTiling.kt', 42],
      ['TextBlockMerger.kt', 24],
      ['MangaOcr.kt', 12],
      ['BubblePipeline.kt', 8],
      ['PageRegionDetector.kt', 1],
    ]);
    const missing: string[] = [];
    for (const [ktName] of FILES) {
      const kotlin = parseKotlinConsts(readFileSync(androidReference(`${KT_DIR}/${ktName}`), 'utf8'));
      const want = expected.get(ktName) ?? 0;
      if (kotlin.size !== want) missing.push(`${ktName}: 解析到 ${String(kotlin.size)} 个，基线 ${String(want)}`);
    }
    expect(missing).toEqual([]);
  });

  it('关键阈值的语义方向没被写反（比例类都在 (0,1]，权重为正）', () => {
    const tiling = parseKotlinConsts(readFileSync(androidReference(`${KT_DIR}/PageRegionTiling.kt`), 'utf8'));
    for (const key of [
      'BUBBLE_DEDUP_IOU_THRESHOLD',
      'BUBBLE_DEDUP_CONTAINMENT_THRESHOLD',
      'BUBBLE_DEDUP_PARTIAL_OVERLAP_MIN_RATIO',
      'TILE_BOUNDARY_MARGIN_RATIO',
      'PAGE_REGION_TEXT_IOU_THRESHOLD',
      'TINY_TEXT_MAX_AREA_RATIO',
    ]) {
      const v = tiling.get(key);
      expect(v, `${key} 缺失`).toBeTypeOf('number');
      expect(v ?? 0).toBeGreaterThan(0);
      expect(v ?? 1).toBeLessThanOrEqual(1);
      // 去重阈值必须高于「弱重叠」阈值，否则会把相邻气泡吞掉
      if (key === 'BUBBLE_DEDUP_IOU_THRESHOLD') {
        expect(v ?? 0).toBeGreaterThan(tiling.get('BUBBLE_SPAN_MIN_PAIR_OVERLAP') ?? 0);
      }
    }

    const merger = parseKotlinConsts(readFileSync(androidReference(`${KT_DIR}/TextBlockMerger.kt`), 'utf8'));
    for (const key of ['ALIGNMENT_WEIGHT', 'CONNECTION_WEIGHT', 'OVERLAP_WEIGHT', 'THICKNESS_WEIGHT', 'SPACING_WEIGHT']) {
      expect(merger.get(key) ?? 0, `${key} 必须为正权重`).toBeGreaterThan(0);
    }
    // 打分门槛 = 5.4，而最高权重是 5 —— 单靠一项不可能过门槛（必须组合证据）
    expect(merger.get('MIN_MERGE_SCORE') ?? 0).toBeGreaterThan(merger.get('SPACING_WEIGHT') ?? 0);

    // 朝向判定用 1.35 的互为倒数区间：[1/1.35, 1.35]，中间是 AMBIGUOUS
    const aspect = merger.get('ORIENTATION_ASPECT_RATIO') ?? 0;
    expect(aspect).toBeGreaterThan(1);
    expect(1 / aspect).toBeLessThan(1);
  });
});

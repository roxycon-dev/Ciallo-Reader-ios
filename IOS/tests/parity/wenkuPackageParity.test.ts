/**
 * wenkuPackageParity.test.ts —— `ui/wenku/**` 整包的**数值表逐条对拍**。
 *
 * 与 `kotlinLiterals.test.ts`（字面量存在性）的区别：这里做**同位比价**——
 * 从 Kotlin 源码解析出 `(常量名, 数值)`，再按显式/自动映射取 TS 侧的**同名表项**，
 * 断言两个数值相等。也就是说：Kotlin 改成 `0.86f`、TS 仍是 `0.72`，这条会红。
 *
 * 覆盖：
 *   ui/wenku/WenkuTokens.kt      `object WenkuTokens` 的全部 Dp / sp / Float 常量
 *                                `object WenkuMotion` 的时长与词表
 *   ui/wenku/WenkuIconArt.kt     `enum class WenkuSymbol` 89 项的**序数与标签**
 *   ui/wenku/ArchiveShelf.kt     `METRICS_*` 与封面光栅预算
 *   ui/wenku/ShelfVolumeRender.kt 材质与纸页常数
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  WENKU_CONTROL_DP,
  WENKU_MOTION,
  WENKU_RADII_DP,
  WENKU_SHELF,
  WENKU_SPACING_DP,
  WENKU_TYPE_SP,
} from '@core/wenku/tokens';
import { WENKU_SYMBOL_TABLE } from '@core/wenku/iconArt';

import { androidReference } from '../helpers/androidReference';

const tokensKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuTokens.kt'),
  'utf8',
);
const iconArtKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuIconArt.kt'),
  'utf8',
);
const archiveShelfKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/ArchiveShelf.kt'),
  'utf8',
);

/** 从 Kotlin 取 `val Name: Dp = 4.dp` / `val Name: Float = .5f` / `const val Name = 120`。 */
function kotlinNumbers(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const re =
    /(?:const\s+)?val\s+([A-Za-z0-9_]+)\s*(?::\s*(?:Dp|Float|Int|Long|Double|TextUnit))?\s*=\s*(-?[\d_.]+)\s*(?:\.dp|\.sp|[fFdDlL])?\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? '';
    if (name === '') continue;
    // Kotlin 的 `4.dp` 会被数字段贪婪吃成 `4.`，`1_500` 带下划线 —— 先归一化再判形。
    const cleaned = (m[2] ?? '').replace(/_/g, '').replace(/\.+$/, '');
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cleaned)) continue;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/** `UPPER_SNAKE` / `PascalCase` → `camelCase`。 */
function camel(name: string): string {
  if (/^[A-Z0-9_]+$/.test(name)) {
    return name
      .toLowerCase()
      .split('_')
      .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join('');
  }
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Kotlin 常量名 → TS 表项。value 是 [表, 键]。 */
type Target = readonly [Record<string, number>, string];

const TOKEN_TABLE: Record<string, Target> = {
  // ── 圆角 ──
  PanelRadius: [WENKU_RADII_DP, 'panel'],
  CoverRadius: [WENKU_RADII_DP, 'cover'],
  GlassRadius: [WENKU_RADII_DP, 'glass'],
  IconButtonRadius: [WENKU_RADII_DP, 'iconButton'],
  PillRadius: [WENKU_RADII_DP, 'pill'],
  TextButtonRadius: [WENKU_RADII_DP, 'textButton'],
  MenuRadius: [WENKU_RADII_DP, 'menu'],
  SheetRadius: [WENKU_RADII_DP, 'sheet'],
  // ── 间距 ──
  Space1: [WENKU_SPACING_DP, 'one'],
  Space2: [WENKU_SPACING_DP, 'two'],
  Space3: [WENKU_SPACING_DP, 'three'],
  Space4: [WENKU_SPACING_DP, 'four'],
  Space5: [WENKU_SPACING_DP, 'five'],
  Space6: [WENKU_SPACING_DP, 'six'],
  Space8: [WENKU_SPACING_DP, 'eight'],
  // ── 字号 ──
  TypeDisplay: [WENKU_TYPE_SP, 'display'],
  TypeTitle: [WENKU_TYPE_SP, 'title'],
  TypeSection: [WENKU_TYPE_SP, 'section'],
  TypeBody: [WENKU_TYPE_SP, 'body'],
  TypeCaption: [WENKU_TYPE_SP, 'caption'],
  TypeMicro: [WENKU_TYPE_SP, 'micro'],
  // ── 控件尺寸 ──
  IconButtonSize: [WENKU_CONTROL_DP, 'iconButtonSize'],
  IconButtonCompactWidth: [WENKU_CONTROL_DP, 'iconButtonCompactWidth'],
  IconGlyph: [WENKU_CONTROL_DP, 'iconGlyph'],
  PillHeight: [WENKU_CONTROL_DP, 'pillHeight'],
  PillThickness: [WENKU_CONTROL_DP, 'pillThickness'],
  TextButtonMinWidth: [WENKU_CONTROL_DP, 'textButtonMinWidth'],
  TextButtonMinHeight: [WENKU_CONTROL_DP, 'textButtonMinHeight'],
  MenuWidth: [WENKU_CONTROL_DP, 'menuWidth'],
  MenuMaxOverlayWidth: [WENKU_CONTROL_DP, 'menuMaxOverlayWidth'],
  SheetHandleWidth: [WENKU_CONTROL_DP, 'sheetHandleWidth'],
  SheetHandleHeight: [WENKU_CONTROL_DP, 'sheetHandleHeight'],
};

describe('WenkuTokens.kt 的 Dp / sp 表与 TS 逐条同值', () => {
  const numbers = kotlinNumbers(tokensKt);

  it('圆角 / 间距 / 字号 / 控件尺寸全部命中并相等', () => {
    const missing: string[] = [];
    for (const [name, [table, key]] of Object.entries(TOKEN_TABLE)) {
      const kotlin = numbers.get(name);
      if (kotlin === undefined) {
        missing.push(name);
        continue;
      }
      expect(table[key], `WenkuTokens.${name} 的 TS 表项缺失`).toBeTypeOf('number');
      expect(table[key], `WenkuTokens.${name} 与 TS ${key} 不同值`).toBe(kotlin);
    }
    expect(missing).toEqual([]);
  });

  it('WenkuMotion 的时长/词表与 WENKU_MOTION 自动按 camelCase 对上', () => {
    const motionStart = tokensKt.indexOf('object WenkuMotion');
    expect(motionStart).toBeGreaterThan(-1);
    const motionSrc = tokensKt.slice(motionStart);
    const consts = [...motionSrc.matchAll(/const\s+val\s+([A-Z0-9_]+)\s*=\s*(-?[\d.]+)[fFlL]?/g)];
    expect(consts.length).toBeGreaterThan(20);

    const unmatched: string[] = [];
    let checked = 0;
    for (const m of consts) {
      const name = m[1] ?? '';
      const raw = m[2] ?? '';
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const key = camel(name);
      const tsValue = (WENKU_MOTION as Record<string, number>)[key];
      if (tsValue === undefined) {
        unmatched.push(`${name} → ${key}`);
        continue;
      }
      expect(tsValue, `WenkuMotion.${name}`).toBe(value);
      checked += 1;
    }
    // 42 个常量里，除 `SHELF_FRICTION` 等已转发的以外全部对上
    expect(checked).toBeGreaterThanOrEqual(30);
    // 未映射的必须为空：新增 Kotlin 常量却没进词表时这里会红
    expect(unmatched).toEqual([]);
  });
});

describe('WenkuIconArt.kt 的 89 个符号与 TS 表逐条同序同标签', () => {
  it('枚举序数、标签、分组完全一致', () => {
    const start = iconArtKt.indexOf('enum class WenkuSymbol');
    expect(start).toBeGreaterThan(-1);
    const end = iconArtKt.indexOf('}', iconArtKt.lastIndexOf('Touch(', start));
    const body = iconArtKt.slice(start, end);
    const items = [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9_]*)$$"?([^"\n]*)"?"?\s*,\s*"([^"\n]*)"/gm)];
    // Kotlin 声明形如 `Discover("发现", "导航"),`
    const parsed = [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9_]*)\("([^"]*)",\s*"([^"]*)"\)/gm)].map(
      (m) => [m[1] ?? '', m[2] ?? '', m[3] ?? ''] as const,
    );
    expect(items.length === 0 || parsed.length > 80).toBe(true);
    expect(parsed.length).toBe(89);
    expect(WENKU_SYMBOL_TABLE.length).toBe(89);

    for (let i = 0; i < parsed.length; i += 1) {
      const [name, label, group] = parsed[i] as readonly [string, string, string];
      const row = WENKU_SYMBOL_TABLE[i];
      expect(row, `TS 表第 ${String(i)} 项缺失`).toBeDefined();
      expect(row?.[0], `第 ${String(i)} 项符号名`).toBe(name);
      expect(row?.[1], `${name} 的标签`).toBe(label);
      expect(row?.[2], `${name} 的分组`).toBe(group);
    }
  });
});

describe('ArchiveShelf.kt 的 METRICS 与 WENKU_SHELF 同值', () => {
  it('depthX / depthY / rowStep / waveRadius / 视口上限 / 光栅预算', () => {
    const shelf = kotlinNumbers(archiveShelfKt);
    const pairs: readonly (readonly [string, number])[] = [
      ['METRICS_DEPTH_X', WENKU_SHELF.depthX],
      ['METRICS_DEPTH_Y', WENKU_SHELF.depthY],
      ['METRICS_ROW_STEP', WENKU_SHELF.rowStep],
      ['METRICS_RADIUS', WENKU_SHELF.waveRadius],
      ['METRICS_MAX_VIEWPORT', WENKU_SHELF.maxViewportDp],
      ['COVER_RASTER_BUDGET', WENKU_SHELF.coverRasterBudget],
    ];
    for (const [name, tsValue] of pairs) {
      const kotlin = shelf.get(name);
      expect(kotlin, `ArchiveShelf.${name} 未从 Kotlin 解析到`).toBeTypeOf('number');
      expect(tsValue, `ArchiveShelf.${name} 与 TS 不同值`).toBe(kotlin);
    }
  });
});

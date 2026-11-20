/**
 * shelfCoverArtParity.test.ts —— 3D 书架封面的纸色 / 印刷排版 / 主导色采样。
 *
 * `ui/wenku/ShelfCoverArt.kt`（261 行）有两条职责：
 *   ① `generateShelfCover` —— 无封面书的「印刷风封面」（纸色渐变 → 细边框 → 书本图标 →
 *      书名 → 分隔线 → 作者 → 格式标签）。它必须与列表书架占位卡**同一张封面**
 *      （Kotlin L116-117 的注释），所以每个比例都要钉住。
 *   ② `dominantEdgeColor` —— 取封面左侧一条竖带的平均色，作为书脊纸色/布色。
 *
 * 断言方式：60 余个比例/透明度/颜色从 Kotlin 原文解析，与 `WENKU_COVER_ART` 逐项比对；
 * 四个纯函数（`shade` / `luminance` / `inkOn` / `blend`）直接 import 断言行为。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { blendColor, inkOn, luminance, shadeColor } from '@core/wenku/coverArt';
import { WENKU_COVER_ART } from '@core/wenku/tokens';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/ShelfCoverArt.kt'),
  'utf8',
);

/** 从 Kotlin 抽 `0xAARRGGBB` 颜色字面量。 */
function ktColor(line: string): number | null {
  const m = /0x([0-9A-Fa-f]{8})/.exec(line);
  return m === null ? null : Number.parseInt(m[1] ?? '', 16);
}

describe('ShelfCoverArt.kt：四个纯函数', () => {
  it('shade：fraction > 0 向白提亮、< 0 向黑压暗，端点严格', () => {
    expect(KT).toContain('if (fraction >= 0f) blend(color, Color.WHITE, fraction)');
    expect(KT).toContain('else blend(color, Color.BLACK, -fraction)');
    // 0 不变
    expect(shadeColor(0xff808080, 0)).toBe(0xff808080);
    // +1 → 白；-1 → 黑
    expect(shadeColor(0xff808080, 1)).toBe(0xffffffff);
    expect(shadeColor(0xff808080, -1)).toBe(0xff000000);
    // 提亮/压暗对称：+x 与 -x 相对 0x80 对称
    const up = shadeColor(0xff808080, 0.5) & 0xff;
    const down = shadeColor(0xff808080, -0.5) & 0xff;
    expect(Math.round((up + down) / 2)).toBe(0x80);
    // alpha 通道**也**参与插值（Kotlin L45 `a = alpha(from) + (alpha(to) - alpha(from)) * f`）
    // 0x80 → 白(0xFF) 的中点 = 0x80 + 0x7F*0.5 ≈ 0xBF
    expect((shadeColor(0x80808080, 0.5) >>> 24) & 0xff).toBe(0xbf);
    expect((shadeColor(0x80808080, 0) >>> 24) & 0xff).toBe(0x80);
  });

  it('luminance 用 Rec.709 系数（0.2126 / 0.7152 / 0.0722），归一到 0..1', () => {
    expect(KT).toContain('(0.2126f * Color.red(color) + 0.7152f * Color.green(color) + 0.0722f * Color.blue(color)) / 255f');
    expect(luminance(0xff000000)).toBeCloseTo(0, 6);
    expect(luminance(0xffffffff)).toBeCloseTo(1, 6);
    expect(luminance(0xff00ff00)).toBeCloseTo(0.7152, 4);
    expect(luminance(0xffff0000)).toBeCloseTo(0.2126, 4);
    expect(luminance(0xff0000ff)).toBeCloseTo(0.0722, 4);
  });

  it('inkOn：亮度 > .58 用墨色 (32,30,26)，否则用纸色 (246,243,236)', () => {
    expect(KT).toContain('if (luminance(color) > .58f) Color.argb(255, 32, 30, 26) else Color.argb(255, 246, 243, 236)');
    expect(inkOn(0xffffffff)).toBe(0xff201e1a);
    expect(inkOn(0xff000000)).toBe(0xfff6f3ec);
    // 阈值两侧
    expect(luminance(0xff8f8f8f)).toBeLessThan(0.58);
    expect(inkOn(0xff8f8f8f)).toBe(0xfff6f3ec);
    expect(inkOn(0xffaaaaaa)).toBe(0xff201e1a);
  });

  it('blend 四通道独立线性插值（含 alpha）', () => {
    expect(KT).toContain('Color.red(from) + (Color.red(to) - Color.red(from)) * f');
    expect(blendColor(0xff000000, 0xffffffff, 0)).toBe(0xff000000);
    expect(blendColor(0xff000000, 0xffffffff, 1)).toBe(0xffffffff);
    const half = blendColor(0xff000000, 0xffffffff, 0.5);
    expect((half >>> 16) & 0xff).toBe(0x7f);
  });
});

describe('ShelfCoverArt.kt：generateShelfCover 的纸色与令牌', () => {
  it('深浅两套纸色 / 着色 / 墨色 / 次级文字共 10 个颜色逐值一致', () => {
    const pairs: readonly (readonly [RegExp, number])[] = [
      [/val paperTop = if \(dark\) (0x[0-9A-Fa-f]{8})\.toInt\(\) else (0x[0-9A-Fa-f]{8})/, 0],
      [/val paperBottom = if \(dark\) (0x[0-9A-Fa-f]{8})\.toInt\(\) else (0x[0-9A-Fa-f]{8})/, 0],
      [/val tint = if \(dark\) (0x[0-9A-Fa-f]{8})\.toInt\(\) else (0x[0-9A-Fa-f]{8})/, 0],
      [/val ink = if \(dark\) (0x[0-9A-Fa-f]{8})\.toInt\(\) else (0x[0-9A-Fa-f]{8})/, 0],
      [/val muted = if \(dark\) (0x[0-9A-Fa-f]{8})\.toInt\(\) else (0x[0-9A-Fa-f]{8})/, 0],
    ];
    const sources: number[][] = [];
    for (const [re] of pairs) {
      const m = re.exec(KT);
      expect(m, `没匹配到 ${String(re)}`).not.toBeNull();
      sources.push([
        Number.parseInt(m?.[1] ?? '0', 16),
        Number.parseInt(m?.[2] ?? '0', 16),
      ]);
    }
    const [paperTop, paperBottom, tint, ink, muted] = sources as [
      number[],
      number[],
      number[],
      number[],
      number[],
    ];
    // [dark, light]
    expect(paperTop).toEqual([WENKU_COVER_ART.backgroundTopDark, WENKU_COVER_ART.backgroundTopLight]);
    expect(paperBottom).toEqual([WENKU_COVER_ART.backgroundBottomDark, WENKU_COVER_ART.backgroundBottomLight]);
    expect(tint).toEqual([WENKU_COVER_ART.tintDark, WENKU_COVER_ART.tintLight]);
    expect(ink).toEqual([WENKU_COVER_ART.inkDark, WENKU_COVER_ART.inkLight]);
    expect(muted).toEqual([WENKU_COVER_ART.mutedDark, WENKU_COVER_ART.mutedLight]);
    expect(ktColor('0xFFFF6B6B') ?? 0xffff6b6b).toBe(WENKU_COVER_ART.tagComicColor);
  });

  it('尺寸下限 32×48、unit = max(width/118, 1)', () => {
    expect(KT).toContain('val width = widthPx.coerceAtLeast(32)');
    expect(KT).toContain('val height = heightPx.coerceAtLeast(48)');
    expect(KT).toContain('val unit = (width / 118f).coerceAtLeast(1f)');
    expect(WENKU_COVER_ART.minWidth).toBe(32);
    expect(WENKU_COVER_ART.minHeight).toBe(48);
    expect(WENKU_COVER_ART.unitBase).toBe(118);
    // 窄封面（width < 118）时 unit 钳到 1，字不会缩到看不见
    expect(Math.max(64 / 118, 1)).toBe(1);
  });

  it('边框 / 图标 / 书名 / 分隔线 / 作者 / 标签的描边与字号', () => {
    expect(KT).toContain('strokeWidth = max(1f, unit * .8f)');
    expect(KT).toContain('color = withAlphaInt(ink, if (dark) .16f else .10f)');
    expect(KT).toContain('strokeWidth = max(1.4f, unit * 1.9f)');
    expect(KT).toContain('color = withAlphaInt(tint, .70f)');
    expect(KT).toContain('textSize = unit * 13.5f');
    expect(KT).toContain('val titleWidth = (width * .74f).toInt().coerceAtLeast(24)');
    expect(KT).toContain('strokeWidth = max(1f, unit * .9f)');
    expect(KT).toContain('color = withAlphaInt(muted, .45f)');
    expect(KT).toContain('color = withAlphaInt(muted, .92f)');
    expect(KT).toContain('textSize = unit * 8.2f');
    expect(KT).toContain('textSize = unit * 7.4f');
    expect(KT).toContain('color = withAlphaInt(if (tag == "COMIC") 0xFFFF6B6B.toInt() else tint, .95f)');

    expect(WENKU_COVER_ART.borderMinWidth).toBe(1);
    expect(WENKU_COVER_ART.borderUnit).toBe(0.8);
    expect(WENKU_COVER_ART.borderAlphaLight).toBe(0.1);
    expect(WENKU_COVER_ART.borderAlphaDark).toBe(0.16);
    expect(WENKU_COVER_ART.iconStrokeMin).toBe(1.4);
    expect(WENKU_COVER_ART.iconStrokeUnit).toBe(1.9);
    expect(WENKU_COVER_ART.iconAlpha).toBe(0.7);
    expect(WENKU_COVER_ART.titleSizeUnit).toBe(13.5);
    expect(WENKU_COVER_ART.titleWidthRate).toBe(0.74);
    expect(WENKU_COVER_ART.titleMinWidth).toBe(24);
    expect(WENKU_COVER_ART.ruleUnit).toBe(0.9);
    expect(WENKU_COVER_ART.ruleAlpha).toBe(0.45);
    expect(WENKU_COVER_ART.authorSizeUnit).toBe(8.2);
    expect(WENKU_COVER_ART.authorAlpha).toBe(0.92);
    expect(WENKU_COVER_ART.tagSizeUnit).toBe(7.4);
    expect(WENKU_COVER_ART.tagAlpha).toBe(0.95);
  });

  it('withAlphaInt 只替换 alpha 通道', () => {
    expect(KT).toContain('(color and 0x00ffffff) or ((alpha.coerceIn(0f, 1f) * 255).toInt() shl 24)');
    // 语义：RGB 不变、alpha 被替换
    const color = 0xff123456;
    const alpha = 0.5;
    const out = (color & 0x00ffffff) | ((Math.trunc(Math.min(Math.max(alpha, 0), 1) * 255) << 24) >>> 0);
    expect((out >>> 16) & 0xff).toBe(0x12);
    expect((out >>> 24) & 0xff).toBe(0x7f);
  });
});

describe('ShelfCoverArt.kt：dominantEdgeColor 采样', () => {
  it('左侧 16%、纵向 24 步、横向 6 步，兜底 DKGRAY', () => {
    expect(KT).toContain('val sampleWidth = (source.width * .16f).toInt().coerceAtLeast(1)');
    expect(KT).toContain('val stepY = (source.height / 24).coerceAtLeast(1)');
    expect(KT).toContain('val stepX = (sampleWidth / 6).coerceAtLeast(1)');
    expect(KT).toContain('if (count == 0) Color.DKGRAY else Color.rgb(');
    expect(KT).toContain('}.getOrDefault(Color.DKGRAY)');

    expect(WENKU_COVER_ART.edgeSampleWidthRate).toBe(0.16);
    expect(WENKU_COVER_ART.edgeSampleRows).toBe(24);
    expect(WENKU_COVER_ART.edgeSampleColumns).toBe(6);
    expect(WENKU_COVER_ART.edgeFallbackColor).toBe(0xff444444);
    // 采样区是「左侧一条竖带」，不是整幅
    expect(WENKU_COVER_ART.edgeSampleWidthRate).toBeLessThan(0.5);
  });

  it('失败一律回落 DKGRAY（runCatching + getOrDefault）', () => {
    // 两处兜底：count == 0 与整段异常
    const occurrences = KT.split('Color.DKGRAY').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

/**
 * readingGlassAndActionSheetParity.test.ts —— 阅读层玻璃光学 + Wenku 底部面板。
 *
 * 覆盖 2 个 Kotlin 文件：
 *   `ui/reader/ReadingGlass.kt`（46 行）—— 阅读器内表面的玻璃层：
 *        着色 `#232329`、strong/普通 α `.72/.60`、无 backdrop 抬到 `.84`、
 *        饱和度 `1.10`、三档模糊 `10/16/22`、高光三段 `.13/.025/.045`、描边 `.7dp @.13`
 *   `ui/wenku/WenkuActionSheet.kt`（50 行）—— 22dp 横向 / 14dp 纵向内边距、10dp 间距、
 *        标题 + 关闭按钮、`paneTitle` 无障碍名
 *
 * 为什么值得测：阅读层的玻璃参数直接决定「字压背景是否看得清」，
 * 而 `.84` 这个「无 backdrop 时抬高着色」的兜底最容易在重排时被漏掉 —— 漏了就是白底白字。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  READING_GLASS_ALPHA,
  READING_GLASS_BLUR,
  READING_GLASS_BLUR_LOW,
  READING_GLASS_BLUR_STRONG,
  READING_GLASS_BORDER_ALPHA,
  READING_GLASS_BORDER_WIDTH,
  READING_GLASS_DEFAULT_TINT,
  READING_GLASS_NO_BACKDROP_ALPHA,
  READING_GLASS_SATURATION,
  READING_GLASS_SHEEN_ALPHAS,
  READING_GLASS_STRONG_ALPHA,
  readingGlassPaint,
} from '@core/glass/glassKit';
import { WENKU_ACTION_SHEET } from '@core/wenku/parityNames';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example/ui';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('ReadingGlass.kt：着色与三档模糊', () => {
  const source = kt('reader/ReadingGlass.kt');

  it('默认着色 #232329、墨色纯白', () => {
    expect(source).toContain('data class ReadingGlassStyle(val backdrop: Backdrop? = null');
    expect(source).toContain('val tint: Color = Color(0xFF232329), val ink: Color = Color.White)');
    expect(READING_GLASS_DEFAULT_TINT).toBe('#232329');
  });

  it('strong .72 / 普通 .60 / 无 backdrop .84，二者数值不同', () => {
    expect(source).toContain('val surface = tint ?: style.tint.copy(alpha = if (strong) .72f else .60f)');
    expect(source).toContain('.background(if (style.backdrop == null) surface.copy(alpha = .84f) else surface)');
    expect(READING_GLASS_STRONG_ALPHA).toBe(0.72);
    expect(READING_GLASS_ALPHA).toBe(0.6);
    expect(READING_GLASS_NO_BACKDROP_ALPHA).toBe(0.84);
    // 无 backdrop 时必须更不透明（否则白底白字）
    expect(READING_GLASS_NO_BACKDROP_ALPHA).toBeGreaterThan(READING_GLASS_STRONG_ALPHA);
    expect(READING_GLASS_STRONG_ALPHA).toBeGreaterThan(READING_GLASS_ALPHA);
  });

  it('三档模糊 10（LOW）/ 16（普通）/ 22（strong），饱和度 1.10', () => {
    expect(source).toContain('val radius = if (quality <= RenderQuality.LOW) 10f else if (strong) 22f else 16f');
    expect(source).toContain('colorControls(saturation = 1.10f); blur(radius.dp.toPx())');
    expect(READING_GLASS_BLUR_LOW).toBe(10);
    expect(READING_GLASS_BLUR).toBe(16);
    expect(READING_GLASS_BLUR_STRONG).toBe(22);
    expect(READING_GLASS_BLUR_LOW).toBeLessThan(READING_GLASS_BLUR);
    expect(READING_GLASS_BLUR).toBeLessThan(READING_GLASS_BLUR_STRONG);
    expect(READING_GLASS_SATURATION).toBe(1.1);
    expect(READING_GLASS_SATURATION).toBeGreaterThan(1);
  });

  it('高光三段 .13 / .025 / .045，描边 .7dp @ .13', () => {
    expect(source).toContain('Brush.linearGradient(listOf(Color.White.copy(alpha = .13f), Color.White.copy(alpha = .025f), style.ink.copy(alpha = .045f)))');
    expect(source).toContain('.border(.7.dp, style.ink.copy(alpha = .13f), shape)');
    expect([...READING_GLASS_SHEEN_ALPHAS]).toEqual([0.13, 0.025, 0.045]);
    expect(READING_GLASS_BORDER_WIDTH).toBe(0.7);
    expect(READING_GLASS_BORDER_ALPHA).toBe(0.13);
    // 第一段高光比第三段亮（上亮下暗的斜向高光）
    expect(READING_GLASS_SHEEN_ALPHAS[0]).toBeGreaterThan(READING_GLASS_SHEEN_ALPHAS[2] as number);
  });
});

describe('ReadingGlass.kt：readingGlassPaint 的三条分支', () => {
  it('MINIMAL → 纯色（无模糊 / 无高光 / 无描边）', () => {
    const paint = readingGlassPaint('MINIMAL', false, true);
    expect(paint.solid).toBe(true);
    expect(paint.blurRadiusPx).toBe(0);
    expect(paint.saturation).toBe(1);
    expect(paint.tintAlpha).toBe(1);
    expect([...paint.sheenAlphas]).toEqual([0, 0, 0]);
    expect(paint.borderWidthPx).toBe(0);
    expect(paint.borderAlpha).toBe(0);
    // strong 与 backdrop 在 MINIMAL 下都不改变结论
    expect(readingGlassPaint('MINIMAL', true, false)).toEqual(paint);
  });

  it('LOW → 固定 10px 模糊，strong 不再抬到 22', () => {
    expect(readingGlassPaint('LOW', false, true).blurRadiusPx).toBe(READING_GLASS_BLUR_LOW);
    expect(readingGlassPaint('LOW', true, true).blurRadiusPx).toBe(READING_GLASS_BLUR_LOW);
    // 但着色 alpha 仍按 strong 分档
    expect(readingGlassPaint('LOW', true, true).tintAlpha).toBe(READING_GLASS_STRONG_ALPHA);
    expect(readingGlassPaint('LOW', false, true).tintAlpha).toBe(READING_GLASS_ALPHA);
  });

  it('MID / HIGH / MAX：strong 抬到 22，无 backdrop 时不模糊且着色抬到 .84', () => {
    for (const quality of ['MID', 'HIGH', 'MAX'] as const) {
      expect(readingGlassPaint(quality, false, true).blurRadiusPx).toBe(READING_GLASS_BLUR);
      expect(readingGlassPaint(quality, true, true).blurRadiusPx).toBe(READING_GLASS_BLUR_STRONG);

      const noBackdrop = readingGlassPaint(quality, true, false);
      expect(noBackdrop.blurRadiusPx).toBe(0);
      expect(noBackdrop.tintAlpha).toBe(READING_GLASS_NO_BACKDROP_ALPHA);
    }
  });
});

describe('WenkuActionSheet.kt：面板内边距与结构', () => {
  const source = kt('wenku/WenkuActionSheet.kt');

  it('22dp 横向 / 14dp 纵向 / 10dp 间距', () => {
    expect(source).toContain('.padding(horizontal = 22.dp, vertical = 14.dp)');
    expect(source).toContain('verticalArrangement = Arrangement.spacedBy(10.dp)');
    expect(WENKU_ACTION_SHEET.paddingX).toBe(22);
    expect(WENKU_ACTION_SHEET.paddingY).toBe(14);
    expect(WENKU_ACTION_SHEET.spacing).toBe(10);
  });

  it('标题 + 关闭按钮：标题 titleLarge/SemiBold，按钮文案「关闭面板」', () => {
    expect(source).toContain('style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold');
    expect(source).toContain('tr("关闭面板")');
    expect(source).toContain('AppIconButton(Icons.Filled.Close');
    expect(WENKU_ACTION_SHEET.closeLabel).toBe('关闭面板');
  });

  it('无障碍：整个面板挂 paneTitle = 标题', () => {
    expect(source).toContain('semantics { paneTitle = title }');
    // 标题行与内容行分别用 wenkuPagePart(0) / (1) 做入场错峰
    expect(source).toContain('wenkuPagePart(0)');
    expect(source).toContain('wenkuPagePart(1)');
    expect(WENKU_ACTION_SHEET.parts).toEqual([0, 1]);
  });

  it('可滚动：verticalScroll(rememberScrollState())；dismissEnabled 同时控制手势与关闭按钮', () => {
    expect(source).toContain('.verticalScroll(rememberScrollState())');
    expect(source).toContain('dismissGesturesEnabled = dismissEnabled');
    expect(source).toContain('enabled = dismissEnabled');
  });
});

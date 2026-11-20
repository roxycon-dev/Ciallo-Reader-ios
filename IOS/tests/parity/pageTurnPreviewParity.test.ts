/**
 * pageTurnPreviewParity.test.ts —— 设置页「翻页动画」五行小预览的几何对拍。
 *
 * 覆盖 `ui/components/SettingsControls.kt` 的 `PageTurnPreview`（L324-465）。
 * 这个预览是用户**判断五种翻页效果差异的唯一入口**，几何错一点就会「五种看起来一样」，
 * 而它在 iOS 侧此前完全不存在（只有《翻页类型》的枚举表，没有预览几何）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  PAGE_TURN_PREVIEW_DIM_PHASE,
  PAGE_TURN_PREVIEW_EASING,
  PAGE_TURN_PREVIEW_METRICS,
  PAGE_TURN_PREVIEW_MS,
  PAGE_TURN_PREVIEW_SIZE,
  pageTurnPreviewFrame,
  previewLines,
} from '@core/components/pageTurnPreview';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/SettingsControls.kt'),
  'utf8',
);

/** 取出 `PageTurnPreview` 的函数体（表达式体用定长窗口，块体用花括号配平）。 */
const BODY = (() => {
  const start = KT.indexOf('private fun PageTurnPreview(');
  expect(start).toBeGreaterThan(-1);
  const slice = KT.slice(start, start + 6500);
  expect(slice, '窗口没覆盖到 SCROLL 分支').toContain('PageTurnType.SCROLL ->');
  return slice;
})();

describe('PageTurnPreview 的画布与纸面', () => {
  it('40×54dp、纸面圆角 6、描边 1dp', () => {
    expect(BODY).toContain('Canvas(modifier = modifier.size(width = 40.dp, height = 54.dp))');
    expect(PAGE_TURN_PREVIEW_SIZE).toEqual({ widthDp: 40, heightDp: 54 });
    expect(BODY).toContain('drawRoundRect(color = pageBg, cornerRadius = CornerRadius(6f, 6f))');
    expect(PAGE_TURN_PREVIEW_METRICS.surfaceCorner).toBe(6);
    expect(BODY).toContain('Stroke(width = 1.dp.toPx())');
    expect(PAGE_TURN_PREVIEW_METRICS.strokeWidth).toBe(1);
    // 竖版纸页：高 > 宽
    expect(PAGE_TURN_PREVIEW_SIZE.heightDp).toBeGreaterThan(PAGE_TURN_PREVIEW_SIZE.widthDp);
  });

  it('4 行文字：行宽 w-12（末行再短 .28w）、高 3、圆角 1.5、行距 (h-16)/4', () => {
    expect(BODY).toContain('val lineW = w - 12f - (if (i == 3) w * 0.28f else 0f)');
    expect(BODY).toContain('topLeft = Offset(6f + xShift, 8f + i * (h - 16f) / 4f)');
    expect(BODY).toContain('size = Size(lineW, 3f)');
    expect(BODY).toContain('cornerRadius = CornerRadius(1.5f, 1.5f)');
    expect(PAGE_TURN_PREVIEW_METRICS.lineCount).toBe(4);
    expect(PAGE_TURN_PREVIEW_METRICS.lineWidthInset).toBe(12);
    expect(PAGE_TURN_PREVIEW_METRICS.lastLineShortRatio).toBe(0.28);

    const lines = previewLines(40, 54);
    expect(lines).toHaveLength(4);
    // 第一行：x=6、y=8、宽 40-12=28、高 3
    expect(lines[0]).toEqual({ x: 6, y: 8, width: 28, height: 3, radius: 1.5 });
    // 行距 (54-16)/4 = 9.5
    expect(lines[1]?.y).toBeCloseTo(8 + 9.5, 9);
    // 末行再短 .28×40 = 11.2
    expect(lines[3]?.width).toBeCloseTo(28 - 40 * 0.28, 9);
    // xShift 作用于整组
    expect(previewLines(40, 54, -3)[0]?.x).toBe(3);
  });

  it('试翻 520ms、未选中定格 0.55', () => {
    expect(BODY).toContain('progress.animateTo(1f, tween(520, easing = easing))');
    expect(BODY).toContain('if (dimmed) progress.snapTo(0.55f)');
    expect(PAGE_TURN_PREVIEW_MS).toBe(520);
    expect(PAGE_TURN_PREVIEW_DIM_PHASE).toBe(0.55);
  });

  it('五种效果的缓动各不相同（SIMULATE 是纸张阻尼曲线、两种线性）', () => {
    expect(BODY).toContain('PageTurnType.SIMULATE -> CubicBezierEasing(0.2f, 0.7f, 0.25f, 1f)');
    expect(BODY).toContain('PageTurnType.SLIDE -> LinearEasing');
    expect(BODY).toContain('PageTurnType.SCROLL -> LinearEasing');
    expect(PAGE_TURN_PREVIEW_EASING.SIMULATE).toBe('cubic-bezier(0.2, 0.7, 0.25, 1)');
    expect(PAGE_TURN_PREVIEW_EASING.SLIDE).toBe('linear');
    expect(PAGE_TURN_PREVIEW_EASING.SCROLL).toBe('linear');
    // COVER 与 FADE 用同一条 FastOutSlowIn；不能五种全一样
    expect(PAGE_TURN_PREVIEW_EASING.COVER).toBe(PAGE_TURN_PREVIEW_EASING.FADE);
    expect(new Set(Object.values(PAGE_TURN_PREVIEW_EASING)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('五种效果的一帧几何', () => {
  const w = 40;
  const h = 54;

  it('SIMULATE：行左移 3p、折角 w*.62*p、折痕 .16p、纸缘高光 .55p', () => {
    expect(BODY).toContain('translate(left = -3f * p)');
    expect(BODY).toContain('val fold = (w * 0.62f) * p');
    expect(BODY).toContain('if (fold > 2f)');
    expect(BODY).toContain('Color.Black.copy(alpha = 0.16f * p)');
    expect(BODY).toContain('Color.White.copy(alpha = 0.55f * p)');

    const frame = pageTurnPreviewFrame('SIMULATE', w, h, 1);
    expect(frame.layers[0]?.xShift).toBe(-3);
    expect(frame.fold?.size).toBeCloseTo(40 * 0.62, 9);
    expect(frame.fold?.shadeAlpha).toBeCloseTo(0.16, 9);
    expect(frame.fold?.edgeAlpha).toBeCloseTo(0.55, 9);
    expect(frame.fold?.edgeWidth).toBe(1.5);
    // p 太小（fold ≤ 2）时不画折角
    expect(pageTurnPreviewFrame('SIMULATE', w, h, 0.05).fold).toBeNull();
  });

  it('COVER：覆盖片从右向左，左缘 7px 阴影（alpha .22）', () => {
    expect(BODY).toContain('val sheetX = w * (1f - p)');
    expect(BODY).toContain('listOf(Color.Black.copy(alpha = 0.22f), Color.Transparent)');
    expect(BODY).toContain('startX = sheetX - 5f');
    expect(BODY).toContain('size = Size(7f, h)');

    const frame = pageTurnPreviewFrame('COVER', w, h, 0.5);
    expect(frame.sheet?.x).toBeCloseTo(20, 9);
    expect(frame.sheet?.width).toBeCloseTo(20, 9);
    expect(frame.sheet?.shadeAlpha).toBe(0.22);
    // p = 1 时覆盖片盖满，左缘贴住 x=0
    const full = pageTurnPreviewFrame('COVER', w, h, 1);
    expect(full.sheet?.x).toBe(0);
    expect(full.sheet?.width).toBe(w);
  });

  it('SLIDE：前页 -w*.85p、后页 w*(1-p)*.9（alpha .45）', () => {
    expect(BODY).toContain('translate(left = -w * 0.85f * p)');
    expect(BODY).toContain('translate(left = w * (1f - p) * 0.9f)');
    expect(BODY).toContain('drawLines(0.45f, 0f, nextLineColor)');

    const frame = pageTurnPreviewFrame('SLIDE', w, h, 0.5);
    expect(frame.layers).toHaveLength(2);
    expect(frame.layers[0]?.xShift).toBeCloseTo(-40 * 0.85 * 0.5, 9);
    expect(frame.layers[1]?.xShift).toBeCloseTo(40 * 0.5 * 0.9, 9);
    expect(frame.layers[1]?.alpha).toBe(0.45);
    expect(frame.layers[1]?.role).toBe('next');
  });

  it('FADE：透明度交叉（1-p / p），位移 ±2p', () => {
    expect(BODY).toContain('drawLines(1f - p, -2f * p, lineColor)');
    expect(BODY).toContain('drawLines(p, 2f * p, nextLineColor)');

    const frame = pageTurnPreviewFrame('FADE', w, h, 0.25);
    expect(frame.layers[0]?.alpha).toBeCloseTo(0.75, 9);
    expect(frame.layers[1]?.alpha).toBeCloseTo(0.25, 9);
    expect(frame.layers[0]?.xShift).toBeCloseTo(-0.5, 9);
    expect(frame.layers[1]?.xShift).toBeCloseTo(0.5, 9);
    // 两层透明度之和恒为 1（真交叉淡出，不是叠白）
    expect((frame.layers[0]?.alpha ?? 0) + (frame.layers[1]?.alpha ?? 0)).toBeCloseTo(1, 9);
  });

  it('SCROLL：6 行铺满、整组上移 2.4 行距、滚动条 2.5×10 随 p 下移', () => {
    expect(BODY).toContain('translate(top = -p * gap * 2.4f)');
    expect(BODY).toContain('for (i in 0..5)');
    expect(BODY).toContain('if (i % 4 == 3)');
    expect(BODY).toContain('topLeft = Offset(w - 3f, 6f + p * (h - 18f))');
    expect(BODY).toContain('size = Size(2.5f, 10f)');
    expect(BODY).toContain('CornerRadius(1.2f, 1.2f)');

    const gap = (h - 16) / 4;
    const frame = pageTurnPreviewFrame('SCROLL', w, h, 0.5);
    expect(frame.layers[0]?.lines).toHaveLength(6);
    expect(frame.layers[0]?.yShift).toBeCloseTo(-0.5 * gap * 2.4, 9);
    // 第 4 行（i=3）与第 8 行（不存在）才短；这里 i=3 短
    expect(frame.layers[0]?.lines[3]?.width).toBeCloseTo(40 - 12 - 40 * 0.28, 9);
    expect(frame.layers[0]?.lines[2]?.width).toBeCloseTo(40 - 12, 9);
    expect(frame.scrollbar?.x).toBe(w - 3);
    expect(frame.scrollbar?.y).toBeCloseTo(6 + 0.5 * (h - 18), 9);
    expect(frame.scrollbar?.width).toBe(2.5);
    expect(frame.scrollbar?.height).toBe(10);
    expect(frame.scrollbar?.radius).toBe(1.2);
  });

  it('p 越界被钳制（Animatable 只会在 [0,1]）', () => {
    const over = pageTurnPreviewFrame('COVER', w, h, 2);
    const at1 = pageTurnPreviewFrame('COVER', w, h, 1);
    expect(over.sheet).toEqual(at1.sheet);
    const under = pageTurnPreviewFrame('FADE', w, h, -1);
    const at0 = pageTurnPreviewFrame('FADE', w, h, 0);
    expect(under.layers[0]?.alpha).toBeCloseTo(at0.layers[0]?.alpha ?? 0, 9);
  });
});

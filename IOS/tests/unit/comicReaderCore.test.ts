/**
 * comicReaderCore.test.ts — 钉死 Android `ComicReaderCore.kt` 纯函数语义。
 *
 * 覆盖 Kotlin 行号:
 *   129 curlEngineActive / 142 panelGlassSamplingActive / 155 ComicVolumeKeyBridge
 *   752 toneOf / 770 effectiveSplitPosition / 788 resolveTapAction
 *   905 fadeCancelOffset / 918 fadeCrossAlpha / 1078 dampEdgeDrag / 1094 magneticTargetShift
 *   1642/1649 fittedSize / 1696 visibleIntrinsicRect / 2117 enhanceHintFor
 *   + ComicPageLayout 镜像: engineFadeAlpha / verticalPreloadIndices / isWidePage / buildComicLayout
 *   + ComicChapterEdgeGesture 镜像: comicChapterEdgeTarget
 *   + ComicScrollMetrics 镜像: 滚动指标（页面内实现不在此测）
 */
import { describe, expect, it } from 'vitest';
import {
  ChapterNavigationLatch,
  ComicVolumeKeyBridge,
  DEFAULT_COMIC_READER_CONFIG,
  KEYCODE_VOLUME_DOWN,
  KEYCODE_VOLUME_UP,
  buildComicLayout,
  comicCacheKey,
  comicChapterEdgeTarget,
  comicLoadingLabel,
  curlEngineActive,
  dampEdgeDrag,
  effectiveRotation,
  effectiveSplitPosition,
  enhanceHintFor,
  engineFadeAlpha,
  fadeCancelOffset,
  fadeCrossAlpha,
  fittedSize,
  fittedSizeWithCustom,
  geometryHasWork,
  imagePipelineFingerprint,
  isWidePage,
  magneticTargetShift,
  pageRotationOf,
  panelGlassSamplingActive,
  resolveTapAction,
  spreadOfRawPage,
  toneOf,
  toningHasWork,
  verticalPreloadIndices,
  visibleIntrinsicRect,
  type ComicBookState,
  type ComicPageRef,
  type ComicReaderConfig,
} from '@core/comic/comicReaderCore';

const CONFIG = DEFAULT_COMIC_READER_CONFIG;

function cfg(patch: Partial<ComicReaderConfig>): ComicReaderConfig {
  return { ...CONFIG, ...patch };
}

function remote(id: string): ComicPageRef {
  return { kind: 'REMOTE', id, url: `https://x/${id}`, headers: {}, referer: null };
}

const BOOK_STATE: ComicBookState = {
  lastPage: 0,
  lastChapterSig: null,
  pageRotations: {},
  mergeAnchors: new Set<number>(),
};

describe('curlEngineActive (Kotlin L129-134)', () => {
  it('CURL + RTL + SINGLE 激活', () => {
    expect(curlEngineActive('CURL', 'RTL', 'SINGLE')).toBe(true);
  });
  it('TTB + SINGLE 强制走 Pager 路径', () => {
    expect(curlEngineActive('CURL', 'TTB', 'SINGLE')).toBe(false);
  });
  it('MAGNETIC/WEBTOON/CONTINUOUS 恒不激活', () => {
    expect(curlEngineActive('CURL', 'RTL', 'MAGNETIC')).toBe(false);
    expect(curlEngineActive('CURL', 'RTL', 'WEBTOON')).toBe(false);
    expect(curlEngineActive('CURL', 'RTL', 'CONTINUOUS')).toBe(false);
  });
  it('非 CURL 永不激活', () => {
    expect(curlEngineActive('FADE', 'RTL', 'SINGLE')).toBe(false);
    expect(curlEngineActive('SLIDE', 'LTR', 'DOUBLE')).toBe(false);
  });
});

describe('panelGlassSamplingActive (Kotlin L142-147)', () => {
  it('面板关闭时不采样', () => {
    expect(panelGlassSamplingActive('SLIDE', 'RTL', 'SINGLE', false)).toBe(false);
  });
  it('面板打开且无 GL 引擎时采样', () => {
    expect(panelGlassSamplingActive('SLIDE', 'RTL', 'SINGLE', true)).toBe(true);
  });
  it('CURL 引擎页回退纯半透明 PanelBg', () => {
    expect(panelGlassSamplingActive('CURL', 'RTL', 'SINGLE', true)).toBe(false);
  });
});

describe('ComicVolumeKeyBridge (Kotlin L155-168)', () => {
  it('无 handler 时不消费', () => {
    ComicVolumeKeyBridge.handler = null;
    expect(ComicVolumeKeyBridge.dispatch(KEYCODE_VOLUME_UP, true)).toBe(false);
    expect(ComicVolumeKeyBridge.dispatch(999, true)).toBe(false);
  });
  it('按 keyCode 分发上下键', () => {
    const seen: boolean[] = [];
    ComicVolumeKeyBridge.handler = (isUp) => {
      seen.push(isUp);
      return true;
    };
    expect(ComicVolumeKeyBridge.dispatch(KEYCODE_VOLUME_UP, true)).toBe(true);
    expect(ComicVolumeKeyBridge.dispatch(KEYCODE_VOLUME_DOWN, true)).toBe(true);
    ComicVolumeKeyBridge.handler = null;
    expect(seen).toEqual([true, false]);
  });
  it('Web 键桥：ArrowUp/ArrowDown 映射音量键，其它键不消费', () => {
    ComicVolumeKeyBridge.handler = () => true;
    expect(ComicVolumeKeyBridge.dispatchWebKey('ArrowUp', true)).toBe(true);
    expect(ComicVolumeKeyBridge.dispatchWebKey('ArrowDown', true)).toBe(true);
    expect(ComicVolumeKeyBridge.dispatchWebKey('KeyA', true)).toBe(false);
    ComicVolumeKeyBridge.handler = null;
  });
});

describe('ChapterNavigationLatch (Kotlin L391-398)', () => {
  it('单飞：抢到后第二次被拒，release 后可再抢', () => {
    const latch = new ChapterNavigationLatch();
    expect(latch.tryAcquire()).toBe(true);
    expect(latch.isPending()).toBe(true);
    expect(latch.tryAcquire()).toBe(false);
    latch.release();
    expect(latch.tryAcquire()).toBe(true);
  });
});

describe('toneOf (Kotlin L752-763) / toningHasWork / geometryHasWork', () => {
  it('字段逐一映射', () => {
    const c = cfg({
      filterBrightness: -10,
      filterContrast: 5,
      filterSaturation: 7,
      filterHue: 20,
      filterGamma: 1.4,
      filterSharpen: 30,
      filterShadow: -3,
      filterBW: true,
      enhanceMode: 'CAS',
      enhanceStrength: 70,
    });
    expect(toneOf(c)).toEqual({
      brightness: -10,
      contrast: 5,
      saturation: 7,
      hue: 20,
      gamma: 1.4,
      sharpen: 30,
      shadow: -3,
      bw: true,
      enhanceMode: 'CAS',
      enhanceStrength: 70,
    });
  });
  it('默认配置无像素工作', () => {
    expect(toningHasWork(toneOf(CONFIG))).toBe(false);
  });
  it('几何拆分/旋转/裁边即视为有工作', () => {
    const tone = toneOf(CONFIG);
    const base = { half: 'FULL', splitPosition: 0.5, rotationDeg: 0, cropMode: 'OFF', manualCrop: null } as const;
    expect(geometryHasWork(base, tone)).toBe(false);
    expect(geometryHasWork({ ...base, half: 'LEFT' }, tone)).toBe(true);
    expect(geometryHasWork({ ...base, rotationDeg: 90 }, tone)).toBe(true);
    expect(geometryHasWork({ ...base, cropMode: 'AUTO' }, tone)).toBe(true);
    expect(geometryHasWork({ ...base, manualCrop: [0, 0, 1, 1] }, tone)).toBe(true);
  });
});

describe('effectiveSplitPosition (Kotlin L770-773)', () => {
  it('无探测结论回落 0.5 基准', () => {
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), null)).toBeCloseTo(0.5, 6);
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), Number.NaN)).toBeCloseTo(0.5, 6);
  });
  it('以装订缝为基准 + 用户微调', () => {
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.55 }), 0.4)).toBeCloseTo(0.45, 6);
  });
  it('钳制到 [0.3, 0.7]', () => {
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), 0.95)).toBeCloseTo(0.7, 6);
    expect(effectiveSplitPosition(cfg({ splitPosition: 0.5 }), 0.05)).toBeCloseTo(0.3, 6);
  });
});

describe('resolveTapAction (Kotlin L788-807)', () => {
  const size = { width: 300, height: 600 };

  it('水平 RTL：左右三分随方向翻转', () => {
    const c = cfg({ mode: 'SINGLE', direction: 'RTL' });
    expect(resolveTapAction({ width: 10, height: 300 }, size, c)).toBe('NEXT');
    expect(resolveTapAction({ width: 290, height: 300 }, size, c)).toBe('PREV');
    expect(resolveTapAction({ width: 150, height: 300 }, size, c)).toBe('TOGGLE_CONTROLS');
  });

  it('水平 LTR：左=上一页侧', () => {
    const c = cfg({ mode: 'SINGLE', direction: 'LTR' });
    expect(resolveTapAction({ width: 10, height: 300 }, size, c)).toBe('PREV');
    expect(resolveTapAction({ width: 290, height: 300 }, size, c)).toBe('NEXT');
  });

  it('垂直模式上下三分：上=逻辑上一页侧', () => {
    const c = cfg({ mode: 'WEBTOON', direction: 'TTB' });
    expect(resolveTapAction({ width: 150, height: 10 }, size, c)).toBe('PREV');
    expect(resolveTapAction({ width: 150, height: 590 }, size, c)).toBe('NEXT');
    expect(resolveTapAction({ width: 150, height: 300 }, size, c)).toBe('TOGGLE_CONTROLS');
  });

  it('双页 + TTB 仍按水平解析', () => {
    const c = cfg({ mode: 'DOUBLE', direction: 'TTB' });
    expect(resolveTapAction({ width: 10, height: 300 }, size, c)).toBe('PREV');
  });

  it('可配置动作：点按区读取用户配置（默认 RTL：左三分之一取 gestureTapRight）', () => {
    const c = cfg({
      direction: 'RTL',
      gestureTapLeft: 'TOC',
      gestureTapRight: 'EXIT',
      gestureTapCenter: 'NONE',
    });
    expect(resolveTapAction({ width: 10, height: 300 }, size, c)).toBe('EXIT');
    expect(resolveTapAction({ width: 290, height: 300 }, size, c)).toBe('TOC');
    expect(resolveTapAction({ width: 150, height: 300 }, size, c)).toBe('NONE');
  });
});

describe('fadeCancelOffset (Kotlin L905-910) / fadeCrossAlpha (L918-919)', () => {
  it('TTB 只抵消纵向位移', () => {
    expect(fadeCancelOffset(0.5, false, true, 400, 800)).toEqual([0, 400]);
  });
  it('RTL 取反向号', () => {
    expect(fadeCancelOffset(0.5, true, false, 400, 800)).toEqual([-200, 0]);
  });
  it('LTR 正向抵消', () => {
    expect(fadeCancelOffset(0.5, false, false, 400, 800)).toEqual([200, 0]);
  });
  it('真交叉淡化：离场不透明，进场自 0 淡入', () => {
    expect(fadeCrossAlpha(0)).toBe(1);
    expect(fadeCrossAlpha(0.8)).toBe(1);
    expect(fadeCrossAlpha(-1)).toBe(0);
    expect(fadeCrossAlpha(-0.25)).toBeCloseTo(0.75, 6);
    expect(fadeCrossAlpha(-5)).toBe(0);
  });
});

describe('dampEdgeDrag (Kotlin L1078-1088)', () => {
  it('span<=0 时归零', () => {
    expect(dampEdgeDrag(100, 0, 3, 0)).toBe(0);
  });
  it('首页向后拖动被阻尼衰减且不超过 maxY', () => {
    const span = 400;
    const maxY = span / 0.55;
    const damped = dampEdgeDrag(50, 0, 5, span);
    expect(damped).toBeLessThan(50);
    expect(damped).toBeLessThan(maxY);
    expect(damped).toBeGreaterThan(0);
  });
  it('末页向前拖动取负号阻尼', () => {
    const damped = dampEdgeDrag(-50, 4, 5, 400);
    expect(damped).toBeLessThan(0);
    expect(damped).toBeGreaterThan(-50);
  });
  it('中间页原样透传', () => {
    expect(dampEdgeDrag(37, 2, 5, 400)).toBe(37);
    expect(dampEdgeDrag(-37, 2, 5, 400)).toBe(-37);
  });
});

describe('magneticTargetShift (Kotlin L1094-1111)', () => {
  it('低速度按位置过半判定', () => {
    expect(magneticTargetShift(-300, 0, 400, 1, 400)).toBe(1);
    expect(magneticTargetShift(300, 0, 400, 1, 400)).toBe(-1);
    expect(magneticTargetShift(-100, 0, 400, 1, 400)).toBe(0);
  });
  it('超过速度阈值按方向翻页', () => {
    expect(magneticTargetShift(-10, -900, 400, 1, 400)).toBe(1);
    expect(magneticTargetShift(10, 900, 400, 1, 400)).toBe(-1);
  });
  it('dirSign 翻转语义（RTL）', () => {
    expect(magneticTargetShift(-300, 0, 400, -1, 400)).toBe(-1);
  });
});

describe('fittedSize (Kotlin L1642-1689)', () => {
  const intrinsic = { width: 800, height: 1200 };
  const container = { width: 400, height: 800 };

  it('零内禀尺寸返回 Zero', () => {
    expect(fittedSize({ width: 0, height: 0 }, container, 'FIT_PAGE')).toEqual({
      width: 0,
      height: 0,
    });
  });
  it('FIT_PAGE: fit-inside 保持比例（min(400/800, 800/1200) = 0.5）', () => {
    const s = fittedSize(intrinsic, container, 'FIT_PAGE');
    expect(s.width).toBeCloseTo(400, 3);
    expect(s.height).toBeCloseTo(600, 3);
  });
  it('FIT_WIDTH: 宽度贴合容器，纵向溢出', () => {
    const s = fittedSize(intrinsic, container, 'FIT_WIDTH');
    expect(s.width).toBe(400);
    expect(s.height).toBe(600);
  });
  it('FIT_HEIGHT: 高度贴合容器', () => {
    const s = fittedSize(intrinsic, container, 'FIT_HEIGHT');
    expect(s.height).toBe(800);
    expect(s.width).toBeCloseTo(533.3333, 3);
  });
  it('ORIGINAL / FILL / STRETCH', () => {
    expect(fittedSize(intrinsic, container, 'ORIGINAL')).toEqual(intrinsic);
    const fill = fittedSize(intrinsic, container, 'FILL');
    expect(fill.height).toBe(800);
    expect(fill.width).toBeCloseTo(533.3333, 3);
    expect(fittedSize(intrinsic, container, 'STRETCH')).toEqual(container);
  });
  it('CUSTOM = 基础档 × 系数', () => {
    const s = fittedSizeWithCustom(intrinsic, container, 'CUSTOM', 2, 'FIT_WIDTH');
    expect(s.width).toBe(800);
    expect(s.height).toBe(1200);
  });
  it('CUSTOM 的 base 为 CUSTOM 时回落 FIT_PAGE', () => {
    const a = fittedSizeWithCustom(intrinsic, container, 'CUSTOM', 1, 'CUSTOM');
    const b = fittedSize(intrinsic, container, 'FIT_PAGE');
    expect(a).toEqual(b);
  });
});

describe('visibleIntrinsicRect (Kotlin L1696-1715)', () => {
  const base = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    containerSize: { width: 400, height: 400 },
    contentSize: { width: 400, height: 400 },
    intrinsicSize: { width: 800, height: 800 },
    gestureActive: false,
    releaseAnimating: false,
    gestureEpoch: 0,
  };

  it('未就绪返回 null', () => {
    expect(visibleIntrinsicRect({ ...base, scale: 0 })).toBeNull();
    expect(visibleIntrinsicRect({ ...base, contentSize: { width: 0, height: 0 } })).toBeNull();
    expect(visibleIntrinsicRect({ ...base, containerSize: { width: 0, height: 0 } })).toBeNull();
    expect(visibleIntrinsicRect({ ...base, intrinsicSize: { width: 0, height: 0 } })).toBeNull();
  });

  it('1:1 缩放映射回原始像素', () => {
    expect(visibleIntrinsicRect(base)).toEqual({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
    });
  });

  it('放大 2x 后可视区缩小到内容中心一半', () => {
    const r = visibleIntrinsicRect({ ...base, scale: 2 });
    expect(r).not.toBeNull();
    if (r !== null) {
      expect(r?.right - (r?.left ?? 0)).toBeCloseTo(400, 3);
    }
  });

  it('平移偏移反映到矩形左边界：内容左移 100px → 原始像素左边界 100', () => {
    // toContentX(0) = (0 - 200 - 100) / 2 + 200 = 50；再乘 sx = 800/400 = 2 → 100
    const r = visibleIntrinsicRect({ ...base, scale: 2, offsetX: 100 });
    expect(r?.left).toBeCloseTo(100, 3);
  });
});

describe('comicChapterEdgeTarget (ComicChapterEdgeGesture.kt L21-25 镜像)', () => {
  it('首/末页外翻阈值判定（单页书两端同时成立时按 Kotlin when 顺序取首分支）', () => {
    expect(comicChapterEdgeTarget(60, true, false, 48)).toBe(-1);
    expect(comicChapterEdgeTarget(-60, false, true, 48)).toBe(1);
    // Kotlin: atStart && drag >= threshold 为真 → -1（atEnd 分支不再求值）
    expect(comicChapterEdgeTarget(60, true, true, 48)).toBe(-1);
    expect(comicChapterEdgeTarget(-60, true, true, 48)).toBe(1);
    // 非外翻方向 / 未达阈值 → 0
    expect(comicChapterEdgeTarget(-60, true, false, 48)).toBe(0);
    expect(comicChapterEdgeTarget(60, false, true, 48)).toBe(0);
    expect(comicChapterEdgeTarget(10, true, false, 48)).toBe(0);
    expect(comicChapterEdgeTarget(60, false, false, 48)).toBe(0);
  });
});

describe('engineFadeAlpha (ComicPageLayout.kt L129-132 镜像)', () => {
  it('起始 0.35，结束 1，中点 smoothstep', () => {
    expect(engineFadeAlpha(0)).toBeCloseTo(0.35, 6);
    expect(engineFadeAlpha(240)).toBeCloseTo(1, 6);
    expect(engineFadeAlpha(120)).toBeCloseTo(0.675, 6);
  });
  it('超时长与零时长都落在 1', () => {
    expect(engineFadeAlpha(9999)).toBe(1);
    expect(engineFadeAlpha(10, 0)).toBe(1);
  });
});

describe('verticalPreloadIndices (ComicPageLayout.kt L117-123 镜像)', () => {
  it('优先级序 = 当前 → 前瞻近→远 → 上一页', () => {
    expect(verticalPreloadIndices(2, 2, 8)).toEqual([2, 3, 4, 1]);
  });
  it('全部钳制到 [0, count)', () => {
    expect(verticalPreloadIndices(0, 2, 2)).toEqual([0, 1]);
    expect(verticalPreloadIndices(7, 3, 8)).toEqual([7, 6]);
  });
  it('count<=0 返回空', () => {
    expect(verticalPreloadIndices(0, 4, 0)).toEqual([]);
  });
});

describe('isWidePage (ComicPageLayout.kt L148-154 镜像)', () => {
  const size = (w: number, h: number, gutter: boolean | null = null) => ({
    width: w,
    height: h,
    gutter,
    gutterPos: null,
  });

  it('阈值 1.35 / 1.8', () => {
    expect(isWidePage(size(1000, 800))).toBe(false); // 1.25
    expect(isWidePage(size(1400, 1000))).toBe(true); // 1.4 无结论 → 默认拆
    expect(isWidePage(size(1800, 1000))).toBe(true); // 1.8 无条件
    expect(isWidePage(size(1400, 1000, false))).toBe(false); // 有结论无缝 → 不拆
    expect(isWidePage(size(1400, 1000, true))).toBe(true);
    expect(isWidePage(null)).toBe(false);
  });
});

describe('buildComicLayout (ComicPageLayout.kt L162-250 镜像)', () => {
  const pages = [remote('p1'), remote('p2'), remote('p3'), remote('p4'), remote('p5')];

  it('单页模式：每页独立 spread', () => {
    const layout = buildComicLayout(pages, {}, cfg({ mode: 'SINGLE' }), BOOK_STATE);
    expect(layout.spreads).toHaveLength(5);
    expect(spreadOfRawPage(layout, 3)).toBe(3);
  });

  it('双页模式：两两配对', () => {
    const layout = buildComicLayout(pages, {}, cfg({ mode: 'DOUBLE' }), BOOK_STATE);
    expect(layout.spreads).toHaveLength(3);
    expect(layout.spreads[0]?.slots.map((s) => s.rawIndex)).toEqual([0, 1]);
    expect(layout.spreads[2]?.slots.map((s) => s.rawIndex)).toEqual([4]);
  });

  it('双页首页单独', () => {
    const layout = buildComicLayout(
      pages,
      {},
      cfg({ mode: 'DOUBLE', doubleFirstAlone: true }),
      BOOK_STATE,
    );
    expect(layout.spreads[0]?.slots.map((s) => s.rawIndex)).toEqual([0]);
    expect(layout.spreads[1]?.slots.map((s) => s.rawIndex)).toEqual([1, 2]);
  });

  it('临时合页锚点合成一个 spread', () => {
    const state: ComicBookState = { ...BOOK_STATE, mergeAnchors: new Set([1]) };
    const layout = buildComicLayout(pages, {}, cfg({ mode: 'SINGLE' }), state);
    expect(layout.spreads[1]?.slots.map((s) => s.rawIndex)).toEqual([1, 2]);
  });

  it('splitWide + RTL 默认右半在前', () => {
    const sizes = { p1: { width: 2400, height: 1000, gutter: null, gutterPos: null } };
    const layout = buildComicLayout(
      [pages[0] as ComicPageRef],
      sizes,
      cfg({ mode: 'SINGLE', splitWide: true, direction: 'RTL' }),
      BOOK_STATE,
    );
    expect(layout.spreads[0]?.slots[0]?.half).toBe('RIGHT');
    expect(layout.spreads[1]?.slots[0]?.half).toBe('LEFT');
  });

  it('splitReverse 反转拆分顺序', () => {
    const sizes = { p1: { width: 2400, height: 1000, gutter: null, gutterPos: null } };
    const layout = buildComicLayout(
      [pages[0] as ComicPageRef],
      sizes,
      cfg({ mode: 'SINGLE', splitWide: true, splitReverse: true, direction: 'RTL' }),
      BOOK_STATE,
    );
    expect(layout.spreads[0]?.slots[0]?.half).toBe('LEFT');
  });

  it('空页列表返回空布局', () => {
    expect(buildComicLayout([], {}, cfg({ mode: 'SINGLE' }), BOOK_STATE).spreads).toHaveLength(0);
  });
});

describe('comicCacheKey / effectiveRotation / pageRotationOf (Kotlin L533 L538 L831)', () => {
  it('cacheKey 模板保持一致', () => {
    const ref = remote('p1');
    expect(comicCacheKey(ref, 'LEFT', 'F|1', 90)).toBe('p1|LEFT|F|1|r90');
  });
  it('旋转归一到 [0,360)', () => {
    expect(effectiveRotation(270, 180)).toBe(90);
    expect(effectiveRotation(0, -90)).toBe(270);
    expect(effectiveRotation(90, 0)).toBe(90);
  });
  it('缺省页旋转为 0', () => {
    expect(pageRotationOf(BOOK_STATE, 'missing')).toBe(0);
    expect(pageRotationOf({ ...BOOK_STATE, pageRotations: { p1: 180 } }, 'p1')).toBe(180);
  });
});

describe('imagePipelineFingerprint (ComicReaderConfig.kt L164-170 镜像)', () => {
  it('默认配置的指纹固定且含 15 段', () => {
    const fp = imagePipelineFingerprint(CONFIG);
    expect(fp.split('|')).toHaveLength(15);
    expect(fp).toBe(imagePipelineFingerprint({ ...CONFIG }));
  });
  it('滤镜变化即改变指纹', () => {
    expect(imagePipelineFingerprint(cfg({ filterSharpen: 1 }))).not.toBe(
      imagePipelineFingerprint(CONFIG),
    );
  });
  it('filterGamma 以三位小数格式化', () => {
    expect(imagePipelineFingerprint(cfg({ filterGamma: 1.25 }))).toContain('1.250');
  });
});

describe('comicLoadingLabel (Kotlin L2100-2108)', () => {
  it('真实字节进度优先于 elapsed', () => {
    expect(comicLoadingLabel(1, 0, 9)).toBe('正在展开页面…');
    expect(comicLoadingLabel(0.426, 0, 0)).toBe('正在加载 · 42%');
    expect(comicLoadingLabel(null, 2048, 0)).toBe('已接收 2 KB');
    expect(comicLoadingLabel(null, 0, 5)).toBe('连接较慢，正在加载…');
    expect(comicLoadingLabel(null, 0, 0)).toBe('正在加载页面…');
  });
});

describe('enhanceHintFor (Kotlin L2117-2121)', () => {
  it('未开启增强返回 null', () => {
    expect(enhanceHintFor(CONFIG, 2400)).toBeNull();
  });
  it('整数秒去掉小数，非整数保留', () => {
    const cas = enhanceHintFor(cfg({ enhanceMode: 'CAS', enhanceStrength: 60 }), 1600);
    expect(cas).toMatch(/^AI 增强处理中 · 约 .+s$/);
    const waifu = enhanceHintFor(cfg({ enhanceMode: 'WAIFU2X', enhanceStrength: 100 }), 3000);
    expect(waifu).toMatch(/^AI 增强处理中 · 约 \d+(\.\d+)?s$/);
  });
  it('档位越高预计耗时越长', () => {
    const cas = enhanceHintFor(cfg({ enhanceMode: 'CAS' }), 2400);
    const upscale = enhanceHintFor(cfg({ enhanceMode: 'WAIFU2X' }), 2400);
    expect(cas).not.toBeNull();
    expect(upscale).not.toBeNull();
    expect(Number(upscale?.replace(/[^\d.]/g, ''))).toBeGreaterThan(
      Number(cas?.replace(/[^\d.]/g, '')),
    );
  });
});

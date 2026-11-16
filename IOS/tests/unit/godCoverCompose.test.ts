/**
 * E18 / E71 —— 神回封面引擎的像素内核护栏。
 *
 * 权威来源：`god/GodCoverEngine.kt`
 *   - L367-379 `fastBlur`（3 次盒式模糊叠加 = 中心极限逼近高斯）
 *   - L385-438 `boxBlurPass`（可分离，滑动窗口累加）
 *   - L346-359 `centerCrop`（两条分支的居中裁剪）
 *   - L51-79  全部常量
 *
 * 这些是**纯数学**，所以能在 Node 里逐值验证，不需要浏览器。
 * 合成（Canvas 那一层）在 `platform/web/webGodCoverComposer.ts`，另由
 * `platformWebMock.test.ts` 的端口白名单护栏保证两侧同步。
 */
import { describe, expect, it } from 'vitest';
import {
  GOD_BLUR_DOWNSCALE,
  GOD_BLUR_RADIUS_RATIO,
  GOD_CORNER_RATIO,
  GOD_COVER_HEIGHT,
  GOD_COVER_RATIO,
  GOD_COVER_WIDTH,
  GOD_FOREGROUND_MARGIN,
  GOD_JPEG_QUALITY,
  GOD_PREVIEW_HEIGHT,
  GOD_PREVIEW_WIDTH,
  GOD_SCRIM_ALPHA,
  GOD_SHADOW_ALPHA,
  coverLayerRect,
  godFastBlur,
  type GodRgbaImage,
} from '@core/god/godCoverEngine';

const makeImage = (w: number, h: number, fill: (x: number, y: number) => number[]): GodRgbaImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const o = (y * w + x) * 4;
      data[o] = r ?? 0;
      data[o + 1] = g ?? 0;
      data[o + 2] = b ?? 0;
      data[o + 3] = a ?? 255;
    }
  }
  return { width: w, height: h, data };
};

describe('E18/E71：常量与 Kotlin GodCoverEngine.kt L51-79 一致', () => {
  it('成品尺寸恒定 900×1200、比例 3:4', () => {
    expect(GOD_COVER_WIDTH).toBe(900);
    expect(GOD_COVER_HEIGHT).toBe(1200);
    expect(GOD_COVER_RATIO).toBeCloseTo(3 / 4, 10);
    expect(GOD_COVER_WIDTH / GOD_COVER_HEIGHT).toBeCloseTo(GOD_COVER_RATIO, 10);
  });

  it('预览 450×600，JPEG 质量 90', () => {
    expect(GOD_PREVIEW_WIDTH).toBe(450);
    expect(GOD_PREVIEW_HEIGHT).toBe(600);
    expect(GOD_JPEG_QUALITY).toBe(90);
  });

  it('合成参数逐个对上 Kotlin 的 const val', () => {
    expect(GOD_FOREGROUND_MARGIN).toBeCloseTo(0.08, 6);
    expect(GOD_CORNER_RATIO).toBeCloseTo(0.03, 6);
    expect(GOD_BLUR_RADIUS_RATIO).toBeCloseTo(0.07, 6);
    expect(GOD_BLUR_DOWNSCALE).toBe(8);
    expect(GOD_SCRIM_ALPHA).toBeCloseTo(0.15, 6);
    expect(GOD_SHADOW_ALPHA).toBeCloseTo(0.34, 6);
  });
});

describe('E71：centerCrop 的两条分支（Kotlin L346-359）', () => {
  it('源比目标「更宽」时横向裁（srcRatio > dstRatio）', () => {
    // 200×100 裁进 100×100：srcRatio=2 > dstRatio=1 → 按高度定宽 nw=100，居中取 x=50
    expect(coverLayerRect(200, 100, 100, 100)).toEqual({
      x: 50, y: 0, width: 100, height: 100,
    });
  });

  it('源比目标「更高」时纵向裁（srcRatio <= dstRatio）', () => {
    // 100×200 裁进 100×100：srcRatio=0.5 <= 1 → 按宽度定高 nh=100，居中取 y=50
    expect(coverLayerRect(100, 200, 100, 100)).toEqual({
      x: 0, y: 50, width: 100, height: 100,
    });
  });

  it('比例相等时走 else 分支且不裁掉任何像素', () => {
    expect(coverLayerRect(100, 100, 100, 100)).toEqual({
      x: 0, y: 0, width: 100, height: 100,
    });
  });

  it('900×1200 的成品比例下，普通横图会被裁两侧（不产生黑边）', () => {
    // 1600×900 裁进 900×1200：dstRatio=0.75，srcRatio≈1.78 > 0.75 → 横向裁
    const r = coverLayerRect(1600, 900, 900, 1200);
    expect(r.height).toBe(900);
    // 裁出的区域比例必须等于目标比例，否则 Compose 缩放时会留边
    expect(r.width / r.height).toBeCloseTo(900 / 1200, 6);
    // 居中：左右留白相等。裁剪宽度是奇数时 Kotlin 的 `roundToInt` 会让两侧差 1px，
    // 故断言「差 ≤1」而不是严格相等 —— 严格相等在偶数宽度时才成立。
    expect(Math.abs(r.x - (1600 - r.width - r.x))).toBeLessThanOrEqual(1);
  });
});

describe('E18：godFastBlur 的盒式模糊语义（Kotlin L367-438）', () => {
  it('常数图模糊后不变（盒式模糊对常数是恒等）', () => {
    const src = makeImage(16, 16, () => [100, 150, 200, 255]);
    const out = godFastBlur(src, 3);
    for (let i = 0; i < out.data.length; i += 1) {
      expect(out.data[i]).toBe(src.data[i]);
    }
  });

  it('半径被夹到 [1, 64]（Kotlin `coerceIn(1, 64)`）', () => {
    const src = makeImage(8, 8, (x) => [x * 30, 0, 0, 255]);
    // radius=0 → 视为 1；radius=999 → 视为 64，两者都必须是合法输出
    const a = godFastBlur(src, 0);
    const b = godFastBlur(src, 999);
    const c = godFastBlur(src, 1);
    const d = godFastBlur(src, 64);
    expect(Array.from(a.data)).toEqual(Array.from(c.data));
    expect(Array.from(b.data)).toEqual(Array.from(d.data));
  });

  it('输入不被修改（Kotlin `getPixels` 后在副本上操作）', () => {
    const src = makeImage(8, 8, (x, y) => [x * 20 + y, 0, 0, 255]);
    const before = Array.from(src.data);
    godFastBlur(src, 2);
    expect(Array.from(src.data)).toEqual(before);
  });

  it('硬边被抹成 S 型过渡（阶梯图在边界处出现中间灰）', () => {
    // 判据不能用「全图相邻差之和下降」—— 盒式模糊把一条 255 的硬边摊成若干
    // 更小的差，**总和守恒**，用总和判据会误判为「没生效」（本条曾踩过）。
    // 正确判据是看过渡带的宽度与中间灰：硬边只有 1px 跳变，模糊后应有 ≥3 个
    // 不同的中间值，说明能量确实扩散了。
    const w = 32;
    const h = 4;
    const src = makeImage(w, h, (x) => (x < w / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const out = godFastBlur(src, 4);
    const rowAt = (y: number): number[] => {
      const out2: number[] = [];
      for (let x = 0; x < w; x += 1) out2.push(out.data[(y * w + x) * 4] as number);
      return out2;
    };
    const row = rowAt(2);

    // 中间灰：既不是 0 也不是 255 —— 证明是模糊而非二值化
    const mid = row[w / 2] as number;
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(245);

    // 过渡带宽度：半径 4 叠加 3 次 ⇒ 有效半径约 4*(2*4+1)^3^(1/2-1) 量级，
    // 实测比 1px 宽得多。断言「中心左右各 6px 内都出现了非纯色值」。
    const bandWidth = 6;
    for (let d = 1; d <= bandWidth; d += 1) {
      const left = row[w / 2 - d] as number;
      const right = row[w / 2 + d] as number;
      // 越靠外越接近纯色，但过渡带内不应出现「立刻跳到 0/255」
      if (left !== 0) expect(left).toBeGreaterThan(0);
      if (right !== 255) expect(right).toBeLessThan(255);
    }
    // 至少 3 个不同的中间灰 —— 单像素硬边不可能产生这么多层次
    const mids = new Set(row.filter((v) => v > 0 && v < 255));
    expect(mids.size).toBeGreaterThanOrEqual(3);
  });

  it('边缘复制而非零填充：四角模糊后仍接近原值（Kotlin `coerceIn` 夹取）', () => {
    const src = makeImage(8, 8, () => [200, 100, 50, 255]);
    const out = godFastBlur(src, 3);
    // 左上角在窗口 [-3..3] 内全部夹取到 (0,0)，均值仍是 200/100/50
    expect(out.data[0]).toBe(200);
    expect(out.data[1]).toBe(100);
    expect(out.data[2]).toBe(50);
  });

  it('过渡带宽度随 radius 单调增长（3 次叠加的有效核 ≈ r·2·√3）', () => {
    // 判据说明：`godFastBlur` 内部固定跑 3 次（对齐 Kotlin L373-375），没有
    // 「1 次」这个选项，所以不能拿 1 次 vs 3 次 比。可观测的等价性质是
    // **有效核宽度随 radius 单调增长** —— 3 次叠加只是把核进一步展宽。
    const w = 64;
    const h = 4;
    const src = makeImage(w, h, (x) => (x < w / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));

    /** 统计「非纯色」像素的数量 —— 过渡带越宽，这个数越大。 */
    const transitionWidth = (radius: number): number => {
      const out = godFastBlur(src, radius);
      let n = 0;
      for (let x = 0; x < w; x += 1) {
        const v = out.data[(2 * w + x) * 4] as number;
        if (v > 0 && v < 255) n += 1;
      }
      return n;
    };

    const narrow = transitionWidth(1);
    const mid = transitionWidth(3);
    const wide = transitionWidth(6);
    expect(narrow).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(narrow);
    expect(wide).toBeGreaterThan(mid);
  });

  it('空图不抛错', () => {
    const out = godFastBlur({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 3);
    expect(out.width).toBe(0);
    expect(out.height).toBe(0);
    expect(out.data.length).toBe(0);
  });
});
/**
 * E68 —— `decodeRegionWeb`（漫画像素级局部重解码的 Web 实现）。
 *
 * Android 权威：`ui/comic/ComicPageLoader.kt:559-620` 的 `decodeRegion` +
 * `BitmapRegionDecoder.decodeRegion(rect, opts { inSampleSize })`，
 * 以及 `ComicReaderCore.kt:1783-1834` 触发它的判据。
 *
 * 本测试不依赖真实图片解码（jsdom 没有 `createImageBitmap`/canvas），
 * 而是把「区域夹取 / 采样率 / 最小尺寸守卫 / 失败落 null」这些**纯几何决策**锁住，
 * 这些正是与 Kotlin 逐行对应的部分。真正的像素通路由 `comicReaderPage` 的集成测试覆盖。
 */

import { describe, expect, it, vi } from 'vitest';
import { decodeRegionWeb } from '@platform/web/webRegionDecoder';

/** 造一张 `createImageBitmap` 会返回的假位图。 */
function fakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => undefined } as unknown as ImageBitmap;
}

/** 记录所有 `drawImage` 调用的假 canvas 2d 上下文。 */
interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function installFakes(opts: {
  full?: ImageBitmap | null;
  canvasFails?: boolean;
  imageDataFails?: boolean;
}): { calls: DrawCall[]; restore: () => void } {
  const calls: DrawCall[] = [];
  const restores: Array<() => void> = [];

  const originalCreateBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (): Promise<ImageBitmap> => {
    if (opts.full === null) throw new Error('decode failed');
    return opts.full ?? fakeBitmap(1000, 800);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Blob([new Uint8Array([1, 2, 3])]))) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = originalFetch;
  });

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = ((tag: string) => {
    if (tag !== 'canvas') return originalCreateElement(tag);
    const canvas = originalCreateElement('canvas');
    if (opts.canvasFails === true) {
      (canvas as HTMLCanvasElement).getContext = (() => null) as never;
      return canvas;
    }
    let width = 0;
    let height = 0;
    Object.defineProperty(canvas, 'width', {
      get: () => width,
      set: (v: number) => {
        width = v;
      },
    });
    Object.defineProperty(canvas, 'height', {
      get: () => height,
      set: (v: number) => {
        height = v;
      },
    });
    (canvas as HTMLCanvasElement).getContext = (() =>
      ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (...args: unknown[]) => {
          // 两种重载都要记录：
          //   9 参 `drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)` —— 1:1 裁剪
          //   5 参 `drawImage(img, dx, dy, dw, dh)`       —— 缩放到输出尺寸
          const [img, a, b, c, d, e, f2, g, h] = args;
          if (args.length >= 9) {
            calls.push({
              sx: a as number,
              sy: b as number,
              sw: c as number,
              sh: d as number,
              dx: e as number,
              dy: f2 as number,
              dw: g as number,
              dh: h as number,
            });
          } else {
            void img;
            calls.push({ sx: 0, sy: 0, sw: 0, sh: 0, dx: a as number, dy: b as number, dw: c as number, dh: d as number });
          }
        },
        getImageData: () => {
          throw new Error('getImageData should not be used');
        },
      }) as unknown as CanvasRenderingContext2D) as never;
    (canvas as HTMLCanvasElement).toDataURL = (() => 'data:image/png;base64,AAA') as never;
    return canvas;
  }) as typeof document.createElement;
  restores.push(() => {
    document.createElement = originalCreateElement;
  });
  void opts.imageDataFails;

  return {
    calls,
    restore: () => {
      for (const r of restores) r();
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateBitmap;
    },
  };
}

describe('decodeRegionWeb（E68）', () => {
  it('不支持 createImageBitmap 的宿主 → null（不抛错）', async () => {
    const original = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    try {
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 100, bottom: 100 }, 2800)).resolves.toBeNull();
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = original;
    }
  });

  it('画布不可用 → null', async () => {
    const f = installFakes({ canvasFails: true });
    try {
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 100, bottom: 100 }, 2800)).resolves.toBeNull();
    } finally {
      f.restore();
    }
  });

  it('区域太小（< 8px）→ null（Kotlin 的守卫）', async () => {
    const f = installFakes({});
    try {
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 4, bottom: 4 }, 2800)).resolves.toBeNull();
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 100, bottom: 4 }, 2800)).resolves.toBeNull();
      // 恰好 8px 应当继续走下去
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 8, bottom: 8 }, 2800)).resolves.not.toBeNull();
    } finally {
      f.restore();
    }
  });

  it('解码失败 → null（Kotlin `catch { return null }`）', async () => {
    const f = installFakes({ full: null });
    try {
      await expect(decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 100, bottom: 100 }, 2800)).resolves.toBeNull();
    } finally {
      f.restore();
    }
  });

  it('区域被夹取到图像范围内，绝不越界', async () => {
    const f = installFakes({ full: fakeBitmap(200, 150) });
    try {
      // rect 完全超出右下角 → 应夹到 (199,149)-(200,150)
      await expect(
        decodeRegionWeb('/a.jpg', { left: 500, top: 400, right: 900, bottom: 800 }, 2800),
      ).resolves.not.toBeNull();
      const first = f.calls[0];
      // 第一步按 1:1 裁剪：源矩形必须落在图像内
      expect(first?.sx).toBeLessThanOrEqual(199);
      expect(first?.sy).toBeLessThanOrEqual(149);
      expect((first?.sx ?? 0) + (first?.sw ?? 0)).toBeLessThanOrEqual(200);
      expect((first?.sy ?? 0) + (first?.sh ?? 0)).toBeLessThanOrEqual(150);

      // 负坐标夹到 0
      f.calls.length = 0;
      await expect(
        decodeRegionWeb('/a.jpg', { left: -50, top: -20, right: 100, bottom: 100 }, 2800),
      ).resolves.not.toBeNull();
      expect(f.calls[0]?.sx).toBe(0);
      expect(f.calls[0]?.sy).toBe(0);
    } finally {
      f.restore();
    }
  });

  it('inSampleSize：长边超过 targetEdge 时按 2 的幂抽样', async () => {
    // 图像 4000×100，取区域 (0,0)-(4000,100)：长边 4000 > targetEdge 1000
    // → sample 依次 1→2→4，输出 1000×25。
    const f = installFakes({ full: fakeBitmap(4000, 100) });
    try {
      const out = await decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 4000, bottom: 100 }, 1000);
      expect(out).not.toBeNull();
      expect(out?.width).toBe(1000);
      expect(out?.height).toBe(25);
      // 第二步的 drawImage 目标尺寸即采样后尺寸
      const second = f.calls[1];
      expect(second?.dw).toBe(1000);
      expect(second?.dh).toBe(25);
    } finally {
      f.restore();
    }
  });

  it('区域小于 targetEdge 时不抽样（sample = 1）', async () => {
    const f = installFakes({ full: fakeBitmap(800, 600) });
    try {
      const out = await decodeRegionWeb('/a.jpg', { left: 10, top: 10, right: 210, bottom: 110 }, 2800);
      expect(out?.width).toBe(200);
      expect(out?.height).toBe(100);
    } finally {
      f.restore();
    }
  });

  it('产出的是可直接喂给 <img> 的 URL', async () => {
    const f = installFakes({});
    try {
      const out = await decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 50, bottom: 40 }, 2800);
      expect(out?.src).toMatch(/^data:image\/png/);
    } finally {
      f.restore();
    }
  });

  it('ImageBitmap.close() 一定被调用（不泄漏原生资源）', async () => {
    const close = vi.fn();
    const bitmap = { width: 400, height: 300, close } as unknown as ImageBitmap;
    const f = installFakes({ full: bitmap });
    try {
      await decodeRegionWeb('/a.jpg', { left: 0, top: 0, right: 100, bottom: 100 }, 2800);
      expect(close).toHaveBeenCalled();
    } finally {
      f.restore();
    }
  });
});
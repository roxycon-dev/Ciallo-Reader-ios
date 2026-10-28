/**
 * E61 —— 离屏位图依赖注入（`src/core/**` 去 DOM 全局）。
 *
 * ## 背景
 *
 * `src/core/glass/liquidGlass.ts` 的 `filmGrainDataUrl()` 此前直接
 * `document.createElement('canvas')` + `getContext('2d')` + `toDataURL()` 生成
 * 64×64 噪点贴图。这让 `src/core/**` 依赖 DOM 全局（E61），核心层因此无法在
 * Node worker / 小程序壳里跑。
 *
 * ## 端口形状刻意极小
 *
 * 只暴露「生成 data URL」这一件事，不做通用画布 API。理由：core 真正用到的
 * 只有「逐像素写一张正方形位图」；暴露 `fillRect`/`drawImage`/`measureText` 之类
 * 会让 core 逐渐反向依赖平台层，破坏分层。**端口越小越不容易被污染。**
 *
 * Android 对照：`LiquidGlass.kt:340-369` 的 `createGrainBitmap()` +
 * `Bitmap.createBitmap(64, 64, ARGB_8888)` + `Canvas` 逐像素写。
 */

/** 逐像素写入器。`(x, y, r, g, b, a)`，每个分量 `0..255`。 */
export type PixelSetter = (x: number, y: number, r: number, g: number, b: number, a: number) => void;

/** 离屏位图端口的最小形状（与 `OffscreenBitmapPort` 结构兼容）。 */
export interface BitmapSource {
  /**
   * 用 `fill` 逐像素填充一张 `size × size` 位图，返回可放进 CSS 的 data URL。
   * 宿主无画布能力时返回 `null`（**不抛错** —— 噪点是纯装饰，缺失只影响观感，
   * 不影响阅读器正确性；抛错反而会炸掉整个设置页）。
   */
  createDataUrl(size: number, fill: (set: PixelSetter) => void): string | null;
}

/** 兜底：无画布能力时返回 null（对齐原 `typeof document === 'undefined'` 分支）。 */
const NO_BITMAP: BitmapSource = {
  createDataUrl: () => null,
};

let source: BitmapSource = NO_BITMAP;

/**
 * 装配处注入真实画布实现。传 `null` 恢复兜底（单测用）。
 *
 * ⚠️ **缓存失效提醒**：`liquidGlass.ts` 的 `filmGrainDataUrl` 会把首次生成的
 * data URL **永久 memoize**（`grainDataUrl` / `grainDataUrlCache`）。
 * 所以**必须先注入、再首次调用**；若在注入前已调用过并缓存了 `''`，
 * 换实现后需要调用 `resetFilmGrainCache()` 才会重新生成。
 */
export function setBitmapSource(next: BitmapSource | null): void {
  source = next ?? NO_BITMAP;
}

/** 当前生效的位图源。 */
export function getBitmapSource(): BitmapSource {
  return source;
}

/** 临时覆盖位图源，返回还原函数。供单测钉住分支。 */
export function withBitmapSource(override: BitmapSource): () => void {
  const previous = source;
  source = override;
  return () => {
    source = previous;
  };
}

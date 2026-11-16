/**
 * E68 —— 漫画像素级局部重解码的 Web/WKWebView 实现。
 *
 * 【2026-10-08 E61 归位】本文件原先放在 `src/core/comic/`，但它 100% 依赖
 * `document.createElement(`canvas`)` / `createImageBitmap` / `fetch` /
 * `URL.createObjectURL` —— 是**平台实现**而非核心逻辑。E61 要求
 * `src/core/**` 不碰任何 DOM 全局（否则 core 无法在 Node worker / 小程序壳里跑），
 * 故移入 `src/platform/web/`。本文件没有任何 `@core/**` import，
 * 移动不产生新依赖；生产代码此前也没有调用方（仅单测引用）。
 *
 * Android `ui/comic/ComicPageLoader.kt:559-620` 的 `decodeRegion(ref, rect, targetEdge, cacheTag)`：
 * 高倍缩放时对**可视区域按原始像素**重新解码（`BitmapRegionDecoder` + `inSampleSize`），
 * 而不是放大已解码的全页位图 —— 全页解码受 `DECODE_MAX_EDGE`（2800px）约束，
 * 深放大时细节会发虚。
 *
 * 移植现状：`core/comic/comicPageLoader.ts:1205-1250` 已把判据、`regionCache`
 * （32 MiB LRU）、`regionMutex` 串行、EXIF 归一化坐标映射、区域夹取、`sampleSizeFor`
 * 全部逐行移植；缺的只是解码原语。`WebComicPageLoader.decodeRegion()` 因此恒返回
 * `null`，高清覆盖层永不挂载 —— 已登记 `docs/PARITY_EXCEPTIONS.md` E68。
 *
 * ## 为什么产出的是 URL 而不是像素
 *
 * `ComicBitmap`（`core/comic/comicReaderCore.ts`）只有 `{ src, width, height }` ——
 * 页面用 `<img src={bitmap.src}>` 渲染，**没有像素数组通道**。所以 Web 上正确的等价物是
 * 「把区域裁剪成一张新的图片并给出它的 URL」，而不是回传 ARGB 缓冲：前者能直接被
 * `<img>` 消费，后者还需要一条本项目不存在的位图上传通道。
 *
 * 做法：`createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' })`
 * 让**浏览器原生解码器**按采样率解出目标尺寸，再 `OffscreenCanvas` / `<canvas>` 裁剪，
 * `toBlob` → `URL.createObjectURL`。`createImageBitmap` 不支持「只解某一矩形」，所以走
 * 「整页解一次（拿原始尺寸）→ canvas 按 rect 裁剪 → 按 sample 缩放」，与 Android 的
 * 「整页解一次（有上限）→ BitmapRegionDecoder 解区域」结构一致。
 *
 * `createImageBitmap` / canvas / `URL.createObjectURL` 在 Safari 与 WKWebView 都原生可用，
 * 与 Capacitor 插件无关 —— 所以这**不是**平台不可移植。
 *
 * `recycle()` 必须撤销 objectURL，否则每次深放大都会泄漏一个 Blob。
 */

/** Kotlin `ComicReaderCore.ComicRectF`。 */
export interface RegionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Kotlin `ComicReaderCore.ComicBitmap` —— 只有 src + 尺寸，页面按 `<img>` 渲染。 */
export interface RegionBitmap {
  src: string;
  width: number;
  height: number;
}

function makeCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  if (canvas.getContext === undefined || canvas.getContext('2d') === null) return null;
  return canvas;
}

async function fetchBlob(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`图片读取失败: ${response.status}`);
  return await response.blob();
}

function canvasToBitmapUrl(canvas: HTMLCanvasElement, width: number, height: number): RegionBitmap {
  // `toDataURL` 是同步的且在所有目标环境可用（`toBlob` 是异步的，且 WKWebView 旧版本
  // 对 OffscreenCanvas 的 `convertToBlob` 支持不一致）。页面只把它当 `<img src>` 用，
  // data URL 完全够用。
  return { src: canvas.toDataURL('image/png'), width, height };
}

/**
 * `WebComicPageLoader.decodeRegion` 的实现。
 *
 * @param targetEdge Kotlin 的 `targetEdge`（`DECODE_MAX_EDGE` = 2800）。区域解码后的
 *   长边上限 —— 用它算出 `inSampleSize`，与 core 的 `sampleSizeFor` 同一语义。
 */
export async function decodeRegionWeb(
  src: string,
  rect: RegionRect,
  targetEdge: number,
): Promise<RegionBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const canvas = makeCanvas();
  if (canvas === null) return null;

  const w = Math.max(0, Math.round(rect.right - rect.left));
  const h = Math.max(0, Math.round(rect.bottom - rect.top));
  // Kotlin `decodeRegion` 的守卫：区域太小直接跳过（core 侧也有一份）。
  if (w < 8 || h < 8) return null;

  let full: ImageBitmap | null = null;
  try {
    full = await createImageBitmap(await fetchBlob(src));
    const iw = full.width;
    const ih = full.height;
    if (iw <= 0 || ih <= 0) return null;

    // 区域夹取到图像范围内（core 的 `decodeRegion` 也夹了一次，这里夹一次是幂等的）。
    const left = Math.min(Math.max(Math.round(rect.left), 0), iw - 1);
    const top = Math.min(Math.max(Math.round(rect.top), 0), ih - 1);
    const right = Math.min(Math.max(Math.round(rect.right), left + 1), iw);
    const bottom = Math.min(Math.max(Math.round(rect.bottom), top + 1), ih);
    const rw = right - left;
    const rh = bottom - top;
    if (rw <= 0 || rh <= 0) return null;

    // Kotlin `BitmapFactory.Options.inSampleSize`：长边解码后不超过 targetEdge。
    const longEdge = Math.max(rw, rh);
    let sample = 1;
    while (Math.trunc(longEdge / sample) > targetEdge) sample *= 2;
    const outW = Math.max(1, Math.floor(rw / sample));
    const outH = Math.max(1, Math.floor(rh / sample));

    // 第一步：按 1:1 把区域画进临时画布（等价于 BitmapRegionDecoder 的原像素解码）。
    const scratch = makeCanvas();
    if (scratch === null) return null;
    scratch.width = rw;
    scratch.height = rh;
    const sctx = scratch.getContext('2d');
    if (sctx === null) return null;
    sctx.drawImage(full, left, top, rw, rh, 0, 0, rw, rh);

    // 第二步：按 sample 抽到输出画布。
    canvas.width = outW;
    canvas.height = outH;
    const octx = canvas.getContext('2d');
    if (octx === null) return null;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(scratch, 0, 0, outW, outH);
    return canvasToBitmapUrl(canvas, outW, outH);
  } catch {
    // Kotlin `ComicPageLoader.decodeRegion` 的 `catch { return null }`。
    return null;
  } finally {
    if (full !== null && typeof full.close === 'function') full.close();
  }
}
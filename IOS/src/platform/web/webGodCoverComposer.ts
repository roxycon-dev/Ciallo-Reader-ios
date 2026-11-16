/**
 * E18 —— 神回封面合成的 Web/WKWebView 实现。
 *
 * 逐行移植 Android `god/GodCoverEngine.kt` 的 `compose()`（L291-344）。
 * core 侧（`@core/god/godCoverEngine.ts`）只提供纯数学部分：
 * 全部常量、`coverLayerRect()` 的 centerCrop 几何、以及 `godFastBlur()` 的
 * 3 次盒式模糊。本文件负责把两者用 Canvas 拼起来 —— 因为它 100% 依赖
 * `document.createElement('canvas')` / `createImageBitmap` / `Image`，
 * 属**平台实现**，不能放 core（E61：`src/core/**` 不碰任何 DOM 全局）。
 *
 * ## 合成规则（Kotlin L38-46 的文档）
 *
 * 1. **背景层**：裁剪后的图 centerCrop 铺满画布 → 降采样到约 1/8 → 3 次盒式模糊
 *    → 放大回画布 → 叠 15% 暗色蒙版。
 * 2. **前景层**：裁剪后的原图 contain 居中（四周 8% 边距）+ 圆角（短边 3%）
 *    + 柔和投影。
 *
 * 结果：无论用户裁出什么比例，成品尺寸恒定 900×1200，没有黑边白边。
 *
 * ## 与 Kotlin 的两处等价性说明
 *
 *   - **降采样**：Kotlin 的 `Bitmap.createScaledBitmap(…, filter=true)` 是
 *     双线性插值；Canvas 的 `drawImage` 在缩放时同样走双线性（`imageSmoothingQuality`
 *     只影响高倍降采样的核选择），配合 `imageSmoothingQuality = 'high'` 对齐。
 *   - **投影**：Kotlin 用 `Paint.setShadowLayer`；Canvas 2D 无等价 API，
 *     用 `ctx.shadowBlur / shadowColor / shadowOffsetY` —— 两者都是「在形状下方
 *     画一层模糊副本」，语义一致。Kotlin 是先画一个**透明**圆角矩形打底
 *     （L330-334）再画图覆盖，Canvas 直接给图片设 shadow 即可，结果相同。
 *
 * ## 2026-10-11（E18 收口）新增：相册选图 → 裁剪 → 合成的接入件
 *
 * `GodEditorPage`（宿主）把 `platform.documents.pickFile({ accept: 'image/*' })`
 * 选中的图片送进本文件的两个入口：
 *
 *   - `blobToDataUrl()`：`FileReader.readAsDataURL` —— Android 相册 uri 是
 *     `content://`（自包含引用），Web 侧唯一自包含的 uri 形态是 data URL，
 *     它会随 `coverSourceToTag({ kind: 'album', uri })` 一起写进 `coverSource`
 *     列，重进编辑页时直接当 `<img src>` / 裁剪底图用。
 *   - `applyCropWeb()`：Kotlin `GodCoverEngine.applyCrop`（L262-281）的
 *     Canvas 逐句移植 —— 先旋转（`rotate` L283-291 的 0.5° 直通 + 包围盒），
 *     再按归一化矩形取子图（L268-273 的 `roundToInt` + `coerceIn` 逐条保留），
 *     裁剪失败回落旋转后的整图（L274-275 `getOrDefault(rotated)`）。解码预算
 *     照抄 `loadUri(uri, maxEdge = DECODE_MAX_EDGE = 1600)`（L122-125）与
 *     `sampleSizeFor`（2 的幂降采样，解码后长边落在 (1600, 3200]）。
 */

import {
  GOD_BLUR_DOWNSCALE,
  GOD_BLUR_RADIUS_RATIO,
  GOD_CORNER_RATIO,
  GOD_COVER_HEIGHT,
  GOD_COVER_WIDTH,
  GOD_FOREGROUND_MARGIN,
  GOD_SCRIM_ALPHA,
  GOD_SHADOW_ALPHA,
  GOD_SHADOW_BLUR,
  GOD_SHADOW_DY,
  coverLayerRect,
  godFastBlur,
  type GodRgbaImage,
} from '@core/god/godCoverEngine';
import { GOD_DECODE_MAX_EDGE } from '@core/god/godReaderBinding';
import type { CropParams } from '@core/god/godTypes';

/** Kotlin `COVER_W` = 900。 */
const COVER_W = GOD_COVER_WIDTH;
/** Kotlin `COVER_H` = 1200。 */
const COVER_H = GOD_COVER_HEIGHT;

export interface GodComposeOptions {
  /** 输出宽度（Kotlin `outW`，正式 900 / 预览 450）。 */
  outWidth?: number;
  /** 输出高度（Kotlin `outH`，正式 1200 / 预览 600）。 */
  outHeight?: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * 把已解码的源图解码成 canvas（Kotlin 侧的 `Bitmap` 在 Web 上的等价物）。
 * 用 `createImageBitmap` 而非 `<img>`：前者能拿到真正的像素（供模糊内核用），
 * 后者只有呈现层。
 */
async function bitmapToImageData(blob: Blob): Promise<GodRgbaImage | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(blob);
    const oc = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = oc.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data: id.data };
  } catch {
    return null;
  } finally {
    if (bmp !== null && typeof bmp.close === 'function') bmp.close();
  }
}

/** `GodRgbaImage` → 可 `drawImage` 的 canvas。 */
function rgbaToCanvas(img: GodRgbaImage): HTMLCanvasElement | null {
  const c = makeCanvas(img.width, img.height);
  if (c === null) return null;
  const ctx = c.getContext('2d');
  if (c === null || ctx === null) return null;
  // `ImageData` 的构造函数要求 `Uint8ClampedArray<ArrayBuffer>`，而 core 侧的
  // `GodRgbaImage.data` 声明为 `Uint8ClampedArray<ArrayBufferLike>`（可跨 Worker 传）。
  // 这里 copy 一份到确定由本页分配的 ArrayBuffer 上 —— 既有类型收窄，也避免
  // 把 core 的缓冲区直接交给 canvas（后者可能写入它）。
  const owned = new Uint8ClampedArray(img.data);
  ctx.putImageData(new ImageData(owned, img.width, img.height), 0, 0);
  return c;
}

/**
 * 合成神回封面 —— Kotlin `GodCoverEngine.compose()`（L291-344）。
 *
 * @param croppedBlob 已经过 `applyCrop` 的图（也可直接传原图 = 不裁剪）
 * @returns PNG data URL，或 `null`（环境不支持时 —— 调用方**不得**静默降级成
 *   「不封面」，应按未接线处理并显式报错）
 */
export async function composeGodCoverWeb(
  croppedBlob: Blob,
  options: GodComposeOptions = {},
): Promise<string | null> {
  const outW = options.outWidth ?? COVER_W;
  const outH = options.outHeight ?? COVER_H;

  const source = await bitmapToImageData(croppedBlob);
  if (source === null) return null;
  const sourceCanvas = rgbaToCanvas(source);
  if (sourceCanvas === null) return null;

  const out = makeCanvas(outW, outH);
  if (out === null) return null;
  const ctx = out.getContext('2d');
  if (ctx === null) return null;

  /* ── 背景：centerCrop → 降采样模糊 → 放大 → 暗色蒙版（Kotlin L299-312） ── */
  // Kotlin L300 `centerCrop(cropped, outW, outH)` —— 几何已逐句移植到
  // core 的 `coverLayerRect()`，这里只按它给的矩形裁。
  const bgRect = coverLayerRect(source.width, source.height, outW, outH);

  // Kotlin L301-303：降采样到 1/BLUR_DOWNSCALE（双线性）。
  const smallW = Math.max(2, Math.floor(outW / GOD_BLUR_DOWNSCALE));
  const smallH = Math.max(2, Math.floor(outH / GOD_BLUR_DOWNSCALE));
  const small = makeCanvas(smallW, smallH);
  if (small === null) return null;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (sctx === null) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(
    sourceCanvas,
    bgRect.x,
    bgRect.y,
    bgRect.width,
    bgRect.height,
    0,
    0,
    smallW,
    smallH,
  );

  // Kotlin L304-305：半径按「短边 × 比例 / 降采样倍数」算，再 fastBlur。
  // 用 core 的确定性盒式模糊（3 次），不用 `ctx.filter='blur()'` ——
  // 后者的核与端点处理由浏览器决定，跨引擎不一致，而 Kotlin 侧是自带算法。
  const radius = Math.max(
    2,
    Math.round((Math.min(outW, outH) * GOD_BLUR_RADIUS_RATIO) / GOD_BLUR_DOWNSCALE),
  );
  const smallId = sctx.getImageData(0, 0, smallW, smallH);
  const blurred = godFastBlur(
    { width: smallW, height: smallH, data: smallId.data },
    radius,
  );
  const blurredCanvas = rgbaToCanvas(blurred);
  if (blurredCanvas === null) return null;

  // Kotlin L309-310：放大回画布（`drawBitmap(blurred, null, RectF(0,0,outW,outH))`）。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurredCanvas, 0, 0, outW, outH);

  // Kotlin L312 `canvas.drawColor(Color.argb((SCRIM_ALPHA*255).roundToInt(), 0,0,0))`
  // —— 纯黑蒙版，`source-over` 直接覆盖。
  const scrim = Math.round(GOD_SCRIM_ALPHA * 255);
  ctx.fillStyle = `rgba(0, 0, 0, ${scrim / 255})`;
  ctx.fillRect(0, 0, outW, outH);

  /* ── 前景：contain 居中 + 圆角 + 投影（Kotlin L314-341） ── */
  // Kotlin L315-320
  const margin = Math.min(outW, outH) * GOD_FOREGROUND_MARGIN;
  const boxW = outW - margin * 2;
  const boxH = outH - margin * 2;
  const scale = Math.min(boxW / source.width, boxH / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  const dstX = (outW - dw) / 2;
  const dstY = (outH - dh) / 2;
  // Kotlin L327 `val corner = min(outW, outH) * CORNER_RATIO`
  const corner = Math.min(outW, outH) * GOD_CORNER_RATIO;

  // Kotlin L330-335：带 shadowLayer 的透明圆角矩形打底，随后被图片完全覆盖。
  // Canvas 2D 无 `setShadowLayer`，等价做法是给图片本身设 shadow。
  ctx.save();
  ctx.shadowBlur = GOD_SHADOW_BLUR;
  ctx.shadowColor = `rgba(0, 0, 0, ${Math.round(GOD_SHADOW_ALPHA * 255) / 255})`;
  ctx.shadowOffsetY = GOD_SHADOW_DY;
  // 先用透明矩形触发一次阴影（对齐 Kotlin「打底」那一步），
  // 这样阴影的圆角形状由 `corner` 决定而非图片的原始轮廓。
  ctx.fillStyle = 'rgba(0, 0, 0, 0.001)';
  roundRectPath(ctx, dstX, dstY, dw, dh, corner);
  ctx.fill();
  ctx.restore();

  // Kotlin L337-341：`clipPath(roundRect)` + `drawBitmap(cropped, null, dst)`。
  ctx.save();
  roundRectPath(ctx, dstX, dstY, dw, dh, corner);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, dstX, dstY, dw, dh);
  ctx.restore();

  // Kotlin 返回 Bitmap；Web 侧页面/存档只消费 URL，故导出 PNG data URL。
  return out.toDataURL('image/png');
}

/** Canvas 2D 的 `roundRect` 在旧版 WKWebView 上缺失，手写路径兜底。 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/* ══════════════ 相册选图接入件（E18，2026-10-11） ══════════════ */

/**
 * `FileReader.readAsDataURL` 的 Promise 包装。
 *
 * Android 相册选择的产物是 `content://` uri（`CoverSource.Album(uri.toString())`，
 * GodMomentSheet.kt L332）；Web 侧唯一「存进 tag 后重进编辑页仍可解」的自包含
 * uri 就是 data URL，因此 `coverSource` 列在 Web 上的 album uri 恒为 data URL。
 *
 * @returns data URL；`FileReader` 缺失 / 读取失败时返回 `null`（调用方按取消
 *   上报，不悬空回调 —— Android 无此分支，见 GodEditorPage 的注释）。
 */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Kotlin `applyCrop` 里的像素矩形（L268-273 四个 `val`）。 */
export interface GodCropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Kotlin `applyCrop` L268-273：归一化矩形 → 像素矩形。
 *
 * ```kotlin
 * val l = (crop.cropL * w).roundToInt().coerceIn(0, max(0, w - 1))
 * val t = (crop.cropT * h).roundToInt().coerceIn(0, max(0, h - 1))
 * val r = (crop.cropR * w).roundToInt().coerceIn(l + 1, w)
 * val b = (crop.cropB * h).roundToInt().coerceIn(t + 1, h)
 * ```
 * `Math.round` 与 Kotlin `roundToInt` 同为「半值向 +∞」；`coerceIn` 的
 * 下/上界逐条保留。宽高 < 1 时返回 `null`（Kotlin 侧 Bitmap 宽高恒 ≥ 1，
 * 该域不存在；coerceIn 的空区间会抛异常，这里用 null 显式表达）。
 */
export function godCropRect(crop: CropParams, width: number, height: number): GodCropRect | null {
  if (width < 1 || height < 1) return null;
  const l = Math.min(Math.max(Math.round(crop.cropL * width), 0), Math.max(0, width - 1));
  const t = Math.min(Math.max(Math.round(crop.cropT * height), 0), Math.max(0, height - 1));
  const r = Math.min(Math.max(Math.round(crop.cropR * width), l + 1), width);
  const b = Math.min(Math.max(Math.round(crop.cropB * height), t + 1), height);
  return { left: l, top: t, right: r, bottom: b };
}

/**
 * Kotlin `rotate`（L283-291）：`d = ((deg % 360) + 360) % 360`，`d < 0.5` 直通；
 * 否则 `Bitmap.createBitmap(…, matrix, true)` 输出**旋转后包围盒**尺寸
 * （w' = |w·cos d| + |h·sin d|，四角变换的极值）。90°/270° 时宽高互换。
 */
export function godRotatedBBox(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const d = ((degrees % 360) + 360) % 360;
  if (d < 0.5) return { width, height };
  const rad = (d * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.round(width * cos + height * sin),
    height: Math.round(width * sin + height * cos),
  };
}

/**
 * Kotlin `sampleSizeFor`（L98-102）：2 的幂降采样档位 ——
 * `while (long > maxEdge * sample * 2) sample *= 2`，即解码后长边落在
 * `(maxEdge, 2 * maxEdge]`。4032px 的相册照片在 Android 上也只解到 2016。
 */
export function godDecodeSampleSize(longEdge: number, maxEdge: number): number {
  let sample = 1;
  while (longEdge > maxEdge * sample * 2) sample *= 2;
  return sample;
}

/** `canvas.toBlob` 的 Promise 包装（PNG，无损，等价 Kotlin 的 ARGB_8888 Bitmap）。 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * 「解码（含 2 的幂降采样 + EXIF 方向归一化）→ 旋转 → 待裁剪」的中间产物。
 * Kotlin 侧这三步发生在 `BitmapFactory.decodeFile/stream` + `exifMatrix` +
 * `rotate`；Canvas 里统一表达成「先把位图画进一张画布」。
 */
function drawDecodedRotated(source: ImageBitmap, rotationDeg: number): HTMLCanvasElement | null {
  // Kotlin loadUri 的 maxEdge = DECODE_MAX_EDGE（L122-125）；sampleSizeFor 以
  // **长边**计（L99 `val long = max(w, h)`）。
  const long = Math.max(source.width, source.height);
  const sample = godDecodeSampleSize(long, GOD_DECODE_MAX_EDGE);
  const decodeW = Math.max(1, Math.floor(source.width / sample));
  const decodeH = Math.max(1, Math.floor(source.height / sample));
  const box = godRotatedBBox(decodeW, decodeH, rotationDeg);
  const canvas = makeCanvas(box.width, box.height);
  if (canvas === null) return null;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const d = ((rotationDeg % 360) + 360) % 360;
  if (d < 0.5) {
    // Kotlin L286 `if (d < 0.5f) return source` —— 直通（画布尺寸 = 解码尺寸）。
    ctx.drawImage(source, 0, 0, decodeW, decodeH);
    return canvas;
  }
  // Matrix.postRotate 绕原点旋转 + createBitmap(true) 取包围盒 ≡
  // 「画布取旋转后包围盒、图绕画布中心旋转绘制」。
  ctx.translate(box.width / 2, box.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(source, -decodeW / 2, -decodeH / 2, decodeW, decodeH);
  return canvas;
}

/**
 * Kotlin `GodCoverEngine.applyCrop`（L262-281）的 Web 移植：
 * 先旋转，再按归一化矩形取子图；裁剪失败回落旋转后的整图。
 *
 * EXIF 方向：Kotlin 在 decode 时用 `ExifInterface` 校正（L220-246，相册照片常见
 * 90°/270°）；Canvas 侧用 `createImageBitmap(…, { imageOrientation: 'from-image' })`
 * 同义（老 WebKit 忽略字典里的未知成员，不抛错）。
 *
 * @returns 裁剪后的 PNG blob；环境不支持（Node / 无 canvas）或解码失败时 `null`
 *   —— 调用方按「合成本不可得」回落 `existing.coverPath`（Kotlin doSave L355 的
 *   `?: existing?.coverPath` 同一出口）。
 */
export async function applyCropWeb(source: Blob, crop: CropParams): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null;
  }
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const rotated = drawDecodedRotated(bmp, crop.rotationDeg);
    if (rotated === null) return null;
    // Kotlin L274-275：`runCatching { Bitmap.createBitmap(rotated, l, t, r - l, b - t) }
    // .getOrDefault(rotated)` —— 裁剪失败回落旋转后的整图。
    try {
      const rect = godCropRect(crop, rotated.width, rotated.height);
      if (rect === null) return await canvasToBlob(rotated);
      const cropW = rect.right - rect.left;
      const cropH = rect.bottom - rect.top;
      const out = makeCanvas(cropW, cropH);
      const ctx = out === null ? null : out.getContext('2d');
      if (out === null || ctx === null) return await canvasToBlob(rotated);
      ctx.drawImage(rotated, rect.left, rect.top, cropW, cropH, 0, 0, cropW, cropH);
      return (await canvasToBlob(out)) ?? (await canvasToBlob(rotated));
    } catch {
      return await canvasToBlob(rotated);
    }
  } catch {
    // 解码失败（坏图 / 不支持的格式）—— Android loadUri 的 `catch → null` 同一出口。
    return null;
  } finally {
    if (bmp !== null && typeof bmp.close === 'function') bmp.close();
  }
}
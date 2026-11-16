/**
 * godCoverEngine.ts — 神回封面引擎的**纯常量 + 纯几何**部分。
 *
 * Read-only Kotlin 源：`novel-reader/app/src/main/java/com/example/god/GodCoverEngine.kt`
 * （479 行 / 445 非空）。
 *
 * Kotlin 行号映射（逐条核对过）：
 *   - 51-52   `COVER_W = 900` / `COVER_H = 1200`        → GOD_COVER_WIDTH / _HEIGHT
 *   - 54      `COVER_RATIO = 3f / 4f`                   → GOD_COVER_RATIO
 *   - 57-58   `PREVIEW_W = 450` / `PREVIEW_H = 600`      → GOD_PREVIEW_WIDTH / _HEIGHT
 *   - 60      `JPEG_QUALITY = 90`                       → GOD_JPEG_QUALITY
 *   - 61      `CACHE_DIR = "god_covers"`                → GOD_COVER_CACHE_DIR
 *   - 64      `FOREGROUND_MARGIN = 0.08f`               → GOD_FOREGROUND_MARGIN
 *   - 66      `CORNER_RATIO = 0.03f`                    → GOD_CORNER_RATIO
 *   - 68      `BLUR_RADIUS_RATIO = 0.07f`               → GOD_BLUR_RADIUS_RATIO
 *   - 70      `BLUR_DOWNSCALE = 8`                      → GOD_BLUR_DOWNSCALE
 *   - 72      `SCRIM_ALPHA = 0.15f`                     → GOD_SCRIM_ALPHA
 *   - 74-76   `SHADOW_BLUR = 22f` / `SHADOW_DY = 10f` / `SHADOW_ALPHA = 0.34f`
 *                                                          → GOD_SHADOW_*（本次补齐）
 *   - 79      `DECODE_MAX_EDGE = 1600`                  → `GOD_DECODE_MAX_EDGE`
 *                                                          （在 godReaderBinding.ts 声明）
 *   - 214     `THUMB_MAX_EDGE = 320`                    → `GOD_THUMB_MAX_EDGE`
 *                                                          （在 godReaderBinding.ts 声明）
 *   - 466     `thumbnail(maxEdge = 240)`                → GOD_THUMBNAIL_MAX_EDGE（本次补齐）
 *   - 80-96   `coverDir` / `fileNameFor` / `fileFor` / `deleteQuietly`
 *              → **未移植**：文件 IO（E36 登记：web 侧走 localStorage 后端）
 *   - 100-257 `loadPage` / `loadUri` / `decodeLocal` / `decodeRemote` / `exifMatrix` /
 *              `sampleSizeFor` / `thumbnailOf` / `THUMB_MAX_EDGE` 分流闸
 *              → **未移植**：位图解码（E35/E45 登记 + `GodCoverImageDecoder` 端口）
 *   - 259-281 `applyCrop` / `rotate` 的像素实现 → **未移植**（同 E35/E45）；
 *              其**逆运算**（舞台坐标 → 原图归一化）在
 *              `@ui/pages/GodCoverCropPage.tsx` 的 `stageNormToImageNorm`
 *              （对应 GodCoverCropScreen.kt L266-275 的 `mapX` / `mapY`）
 *   - 291-359 `compose` / `centerCrop` 的像素实现 → **未移植**（同 E35/E45）
 *   - 361-438 `fastBlur` / `boxBlurPass`               → **未移植**（同上）
 *   - 443-478 `composeAndSave` / `thumbnail` / `clearAll` → **未移植**（文件 IO）
 *
 * 本次逐行复核的修正：
 *   - **补 `centerCrop` 的纯几何**（GodCoverEngine.kt L347-359 `centerCrop(src, outW, outH)`）：
 *     位图那部分在 E35/E45 之外，但「按目标比例居中裁切」的矩形计算是纯算术，
 *     `coverLayerRect()` 直接实现了 Kotlin 的 `roundToInt` + `coerceIn` 分支。
 *   - `resolveCoverSource` 原是 `parseCoverSource` 的一份重复实现，且用了
 *     `Number.parseInt`（`"3abc"` → 3）；Kotlin `parseCoverSource` 用
 *     `toIntOrNull()`（整串必须是合法 Int，否则 0）。现在直接转调
 *     `godTypes.parseCoverSource`，只保留一份实现。
 *   - 补齐 Kotlin 里存在但本文件没导出的常量（SHADOW_* / JPEG_QUALITY /
 *     CACHE_DIR / thumbnail 的 240），便于合成侧逐值核对。
 *
 * ⚠️ **EXTRA（登记为 E71，已于 2026-10-07 删除）**：`computeCropParams()` 与
 * `composeCoverPreview()` 在 Kotlin 里**没有对应函数** —— Kotlin 的裁剪数学在
 * `GodCoverCropScreen.kt` 里是 `mapX` / `mapY`（舞台 → 原图，**方向相反**，
 * 已逐行移植在 `@ui/pages/GodCoverCropPage.tsx` 的 `stageNormToImageNorm()`）。
 * 这两个纯函数生产代码零调用点，按 REVIEW_PROTOCOL 规约第 4 条「EXTRA 一律删除」
 * 已连同 `CoverPreviewPlan` / `CoverPageRef` 与 `tests/unit/godCoverEngine.test.ts`
 * 里对应的 describe 块一起删除。`coverLayerRect()`（Kotlin `centerCrop` 的纯几何，
 * E71 要求补齐）**保留**。
 * ⚠️ 本文件原写的「登记为 E59」是**错误交叉引用**（E59 是「JS 漫画源章节顺序归一化」，
 * 与本模块无关）—— 与 `jsCookieJar.ts → E58` 那次同类错误，本次改正为 E71。
 */
import type { CoverSource, CropParams } from './godTypes';
import { parseCoverSource } from './godTypes';

export const GOD_COVER_WIDTH = 900;
export const GOD_COVER_HEIGHT = 1200;
export const GOD_COVER_RATIO = 3 / 4;
export const GOD_PREVIEW_WIDTH = 450;
export const GOD_PREVIEW_HEIGHT = 600;
export const GOD_FOREGROUND_MARGIN = 0.08;
export const GOD_CORNER_RATIO = 0.03;
export const GOD_BLUR_RADIUS_RATIO = 0.07;
export const GOD_BLUR_DOWNSCALE = 8;
export const GOD_SCRIM_ALPHA = 0.15;
/** `JPEG_QUALITY = 90`（GodCoverEngine.kt L60）。 */
export const GOD_JPEG_QUALITY = 90;
/** `CACHE_DIR = "god_covers"`（GodCoverEngine.kt L61）。 */
export const GOD_COVER_CACHE_DIR = 'god_covers';
/** `SHADOW_BLUR = 22f`（GodCoverEngine.kt L74）—— 前景投影模糊半径。 */
export const GOD_SHADOW_BLUR = 22;
/** `SHADOW_DY = 10f`（GodCoverEngine.kt L75）—— 前景投影 y 偏移。 */
export const GOD_SHADOW_DY = 10;
/** `SHADOW_ALPHA = 0.34f`（GodCoverEngine.kt L76）。 */
export const GOD_SHADOW_ALPHA = 0.34;
/** `thumbnail(…, maxEdge = 240)`（GodCoverEngine.kt L466）。 */
export const GOD_THUMBNAIL_MAX_EDGE = 240;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * `parseCoverSource(tag)`（GodMomentModels.kt L86-104）的别名。
 *
 * 此前本文件另写了一份 `resolveCoverSource`，用的是 `Number.parseInt` ——
 * `"3abc"` 会被读成 3，而 Kotlin 的 `toIntOrNull()` 返回 null → 0。
 * 现在只有一份实现，避免两端解析结果分叉。
 */
export function resolveCoverSource(tag: string | null | undefined): CoverSource {
  return parseCoverSource(tag);
}

export function coverSourceToTag(source: CoverSource): string {
  if (source.kind === 'comicPage') return `page|${source.pageIndex}|${source.pageId}`;
  if (source.kind === 'album') return `album|${source.uri}`;
  return `novel|${source.chapterId}|${source.start}|${source.end}`;
}

export function normalizeCropParams(params: CropParams): CropParams {
  const l = clamp01(params.cropL);
  const t = clamp01(params.cropT);
  const r = clamp01(params.cropR);
  const b = clamp01(params.cropB);
  const minL = Math.min(l, r);
  const minT = Math.min(t, b);
  return {
    scale: params.scale,
    offsetX: params.offsetX,
    offsetY: params.offsetY,
    rotationDeg: params.rotationDeg,
    cropL: minL,
    cropR: Math.min(1, Math.max(Math.max(l, r), minL + 0.02)),
    cropT: minT,
    cropB: Math.min(1, Math.max(Math.max(t, b), minT + 0.02)),
  };
}

/**
 * `centerCrop` 的纯几何（GodCoverEngine.kt L347-359）。
 *
 * Kotlin：`srcRatio > dstRatio` 时横向裁（`nw = (h*dstRatio).roundToInt()`，
 * `x = ((w-nw)/2f).roundToInt().coerceIn(0, max(0, w-1))`，宽 `nw.coerceAtMost(w - x)`），
 * 否则纵向裁（`nh = (w/dstRatio).roundToInt()`，`y` 同理）。
 *
 * 位图裁切本身在 E35/E45（浏览器异步解码），这里只给出矩形。
 */
export function coverLayerRect(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
): { x: number; y: number; width: number; height: number } {
  const srcRatio = srcWidth / srcHeight;
  const dstRatio = outWidth / outHeight;
  if (srcRatio > dstRatio) {
    const nw = Math.round(srcHeight * dstRatio);
    const x = Math.min(
      Math.max(0, Math.round((srcWidth - nw) / 2)),
      Math.max(0, srcWidth - 1),
    );
    return { x, y: 0, width: Math.min(nw, srcWidth - x), height: srcHeight };
  }
  const nh = Math.round(srcWidth / dstRatio);
  const y = Math.min(Math.max(0, Math.round((srcHeight - nh) / 2)), Math.max(0, srcHeight - 1));
  return { x: 0, y, width: srcWidth, height: Math.min(nh, srcHeight - y) };
}

/* ══════════════ 像素内核：3 次盒式模糊（Kotlin L367-438） ══════════════ */

/** 一张 RGBA 像素图（Kotlin 用 ARGB IntArray，这里拆成 4 通道字节）。 */
export interface GodRgbaImage {
  readonly width: number;
  readonly height: number;
  /** 行优先排列，长度 = `width * height * 4`。 */
  readonly data: Uint8ClampedArray;
}

/**
 * 一次可分离盒式模糊（水平 + 垂直，滑动窗口累加）—— Kotlin L385-438。
 *
 * 逐条对应关系（模糊结果对累加顺序与边界处理敏感，改动前先对照 Kotlin）：
 *   - 边界用 `coerceIn` 夹取（**边缘复制**，不是镜像或零填充）；
 *   - 滑动窗口的顺序是**先写输出、再更新四个累加器**；
 *   - 每通道**整除**（`sum / window` 的整数除法），不是四舍五入；
 *   - 水平 pass 读 `px` 写 `tmp`，垂直 pass 读 `tmp` 写回 `px`。
 *
 * 原地修改 `px`。
 */
function boxBlurPass(px: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const r = Math.max(1, radius);
  const window = r * 2 + 1;
  const tmp = new Uint8ClampedArray(px.length);
  const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

  // ── 水平 ──
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    let sumA = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = -r; i <= r; i += 1) {
      const o = row + clamp(i, w - 1) * 4;
      sumA += px[o] as number;
      sumR += px[o + 1] as number;
      sumG += px[o + 2] as number;
      sumB += px[o + 3] as number;
    }
    for (let x = 0; x < w; x += 1) {
      const o = row + x * 4;
      tmp[o] = sumA / window;
      tmp[o + 1] = sumR / window;
      tmp[o + 2] = sumG / window;
      tmp[o + 3] = sumB / window;
      // Kotlin L408-413：先记录输出，再把窗口两端一进一出。
      const outO = row + clamp(x - r, w - 1) * 4;
      const inO = row + clamp(x + r + 1, w - 1) * 4;
      sumA += (px[inO] as number) - (px[outO] as number);
      sumR += (px[inO + 1] as number) - (px[outO + 1] as number);
      sumG += (px[inO + 2] as number) - (px[outO + 2] as number);
      sumB += (px[inO + 3] as number) - (px[outO + 3] as number);
    }
  }

  // ── 垂直（读 tmp 写回 px）──
  for (let x = 0; x < w; x += 1) {
    let sumA = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = -r; i <= r; i += 1) {
      const o = clamp(i, h - 1) * w * 4 + x * 4;
      sumA += tmp[o] as number;
      sumR += tmp[o + 1] as number;
      sumG += tmp[o + 2] as number;
      sumB += tmp[o + 3] as number;
    }
    for (let y = 0; y < h; y += 1) {
      const o = (y * w + x) * 4;
      px[o] = sumA / window;
      px[o + 1] = sumR / window;
      px[o + 2] = sumG / window;
      px[o + 3] = sumB / window;
      const outO = clamp(y - r, h - 1) * w * 4 + x * 4;
      const inO = clamp(y + r + 1, h - 1) * w * 4 + x * 4;
      sumA += (tmp[inO] as number) - (tmp[outO] as number);
      sumR += (tmp[inO + 1] as number) - (tmp[outO + 1] as number);
      sumG += (tmp[inO + 2] as number) - (tmp[outO + 2] as number);
      sumB += (tmp[inO + 3] as number) - (tmp[outO + 3] as number);
    }
  }
}

/**
 * 3 次盒式模糊叠加 = 中心极限逼近高斯 —— Kotlin L367-379 `fastBlur`。
 *
 * 文档（Kotlin L40-42）特意说明「纯 Kotlin，不依赖 RenderScript / Modifier.blur，
 * 全系统版本一致」，所以这里也必须是**自带的确定性算法**，不能换成 Canvas 的
 * `ctx.filter = 'blur(Npx)'` —— 后者的核与端点处理由浏览器实现决定，跨引擎不一致。
 *
 * @param src   输入像素（**不修改**）
 * @param radius Kotlin `fastBlur` 的 `radius.coerceIn(1, 64)`
 * @returns 新图，尺寸与 `src` 相同
 */
export function godFastBlur(src: GodRgbaImage, radius: number): GodRgbaImage {
  const w = src.width;
  const h = src.height;
  if (w <= 0 || h <= 0) {
    return { width: w, height: h, data: new Uint8ClampedArray(0) };
  }
  const r = Math.min(64, Math.max(1, Math.round(radius)));
  const px = new Uint8ClampedArray(src.data);
  boxBlurPass(px, w, h, r);
  boxBlurPass(px, w, h, r);
  boxBlurPass(px, w, h, r);
  return { width: w, height: h, data: px };
}
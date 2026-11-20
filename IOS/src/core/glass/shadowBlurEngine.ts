/**
 * 确定性 CPU 模糊内核 —— `me/trishiraj/shadowglow/ShadowBlurEngine.kt` L56-580 的 TS 移植。
 *
 * 为什么 Web 端也要这份内核：Android 侧换掉 `BlurMaskFilter` 的原因是「硬件加速画布
 * 忽略 MaskFilter，模糊退化成实心硬边色块」。Web 的 `box-shadow` / `filter: blur()`
 * 由合成器做，不存在该问题；但 **`Canvas2D` 上自绘的辉光掩码** 仍需要一份「与
 * 设备无关、逐像素可复现」的模糊，用于 `GlowTrailDrawCache` 这类要在 canvas 里
 * 精确裁出 alpha 的场景。数学部分与 Kotlin 完全一致，因此两端探针可以逐像素比对。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L66/L67  `SHADOW_PERF_LOG` / `SHADOW_PERF_LOG_EVERY = 120L`   → 同名常量
 *   L84-90   `enum class ShadowCacheBucket { STATIC, ANIMATED }`   → `ShadowCacheBucket`
 *   L93      `SHADOW_MASK_CACHE_BYTES_STATIC = 10 * 1024 * 1024`   → 同名
 *   L102     `SHADOW_MASK_CACHE_BYTES_ANIMATED = 4 * 1024 * 1024`  → 同名
 *   L105     `SHADOW_MASK_MAX_SIDE = 2048`                         → 同名
 *   L108-114 `data class MaskKey(shapeSig, sigmaQ, scaleQ, strokeQ, colorArgb)` → `MaskKey`
 *   L116-177 `object ShadowMaskCache`（两个 LruCache + 命中计数 + `statsText()`）→ `ShadowMaskCache`
 *   L190-194 `object MaskScratchBuffers`                           → 复用 `ShadowScratchPool`
 *   L197     `Float.halfPx() = (this * 2f).roundToInt()`            → `halfPx`
 *   L205-210 `class ResolvedBlurredShadow(image, srcSize, dstOffset, dstSize)` → `ResolvedBlurredShadow`
 *   L223-303 `resolveBlurredShadow(...)`：α 早退 / σ 量化 / pad = 3σ + 描边/2 + 1.5 /
 *            `pickMaskScale` / 缓存键 / 目标矩形           → `resolveBlurredShadow`
 *   L306-318 `drawResolvedBlurredShadow`（绘制期只贴图）  → `ResolvedBlurredShadow` 的字段注释
 *   L327-357 `drawDeterministicBlurredPath`                → `deterministicBlurredPath`
 *   L363-383 `drawDeterministicGlowRoundRect` + 签名 `RR|w|h|r` → `deterministicGlowRoundRect`
 *   L401-408 `pickMaskScale(sigmaPx, bucket)`              → `pickMaskScale`
 *   L417-472 `buildMaskBitmap(...)`：位图尺寸上限 / 只模糊 alpha / RGB 常量重建
 *                                                          → `maskBitmapSize` + `blurAlphaChannel`
 *   L480-483 `sigmaToBoxRadius(sigma)`                     → `sigmaToBoxRadius`
 *   L491-501 `boxBlurThreePass`                            → `boxBlurThreePass`
 *   L504-549 `boxBlurHorizontal`                           → `boxBlurHorizontal`
 *   L552-580 `boxBlurVertical`                             → `boxBlurVertical`
 *
 * 与 Kotlin 的唯一差异（已登记 E124）：`buildMaskBitmap` 里「把 Path 画进位图」那一步在
 * Web 侧由调用方用 Canvas2D 完成，本文件只接 alpha 通道的模糊；这样 `src/core/**` 仍然
 * 不碰 DOM。位图尺寸、上限、采样比、三次盒式模糊与量化的数值逐项一致。
 */
import { ShadowScratchPool } from './shadowScratchPool';

/** L66 `SHADOW_PERF_LOG`（Kotlin 已置回 false；保留开关便于复测）。 */
export const SHADOW_PERF_LOG = false;
/** L67 `SHADOW_PERF_LOG_EVERY = 120L`。 */
export const SHADOW_PERF_LOG_EVERY = 120;

/** L84-90 `enum class ShadowCacheBucket`。 */
export const ShadowCacheBucket = ['STATIC', 'ANIMATED'] as const;
export type ShadowCacheBucket = (typeof ShadowCacheBucket)[number];

/** L93 静态阴影掩码字节预算（约 10 MiB）。 */
export const SHADOW_MASK_CACHE_BYTES_STATIC = 10 * 1024 * 1024;
/** L102 动画辉光掩码字节预算（约 4 MiB）。 */
export const SHADOW_MASK_CACHE_BYTES_ANIMATED = 4 * 1024 * 1024;
/** L105 掩码位图单边像素上限。 */
export const SHADOW_MASK_MAX_SIDE = 2048;

/** L108-114 `MaskKey`（值比较，与对象引用无关）。 */
export interface MaskKey {
  readonly shapeSig: string;
  readonly sigmaQ: number;
  readonly scaleQ: number;
  readonly strokeQ: number;
  readonly colorArgb: number;
}

export function maskKeyId(key: MaskKey): string {
  return `${key.shapeSig}|${String(key.sigmaQ)}|${String(key.scaleQ)}|${String(key.strokeQ)}|${String(key.colorArgb)}`;
}

/** L197 `Float.halfPx() = (this * 2f).roundToInt()`。 */
export function halfPx(value: number): number {
  return Math.round(value * 2);
}

interface CacheEntry<V> {
  value: V;
  bytes: number;
}

/** `LruCache<MaskKey, Bitmap>` 的等价物：按总字节上限淘汰最久未用。 */
class ByteLru<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    // 重新插入到末尾 = 标记最近使用（Map 保持插入序）。
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  put(key: string, value: V, bytes: number): void {
    if (bytes > this.maxBytes) return;
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.bytes -= existing.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      const entry = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (entry !== undefined) this.bytes -= entry.bytes;
    }
  }

  get byteCount(): number {
    return this.bytes;
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

/** L116-177 `object ShadowMaskCache`。 */
export class ShadowMaskCacheStore {
  private readonly staticLru = new ByteLru<Uint8ClampedArray>(SHADOW_MASK_CACHE_BYTES_STATIC);
  private readonly animatedLru = new ByteLru<Uint8ClampedArray>(SHADOW_MASK_CACHE_BYTES_ANIMATED);

  hits = 0;
  misses = 0;
  hitsStatic = 0;
  missesStatic = 0;
  hitsAnimated = 0;
  missesAnimated = 0;
  builds = 0;
  buildNanos = 0;

  /** L145-148 `recordBuild(nanos)`。 */
  recordBuild(nanos: number): void {
    this.builds += 1;
    this.buildNanos += nanos;
  }

  /** L151-152 `avgBuildMs()`：没有样本时返回 NaN。 */
  avgBuildMs(): number {
    if (this.builds === 0) return Number.NaN;
    return this.buildNanos / 1_000_000 / this.builds;
  }

  /** L154-157 `recordHit(bucket)`。 */
  recordHit(bucket: ShadowCacheBucket): void {
    this.hits += 1;
    if (bucket === 'ANIMATED') this.hitsAnimated += 1;
    else this.hitsStatic += 1;
  }

  /** L159-162 `recordMiss(bucket)`。 */
  recordMiss(bucket: ShadowCacheBucket): void {
    this.misses += 1;
    if (bucket === 'ANIMATED') this.missesAnimated += 1;
    else this.missesStatic += 1;
  }

  /** L164-167 `rate(h, m)`。 */
  private static rate(h: number, m: number): string {
    const total = h + m;
    return total === 0 ? 'n/a' : `${(h * 100 / total).toFixed(1)}%`;
  }

  /** L169-173 `statsText()`。 */
  statsText(): string {
    return (
      `total[hits=${String(this.hits)} misses=${String(this.misses)} rate=${ShadowMaskCacheStore.rate(this.hits, this.misses)}] ` +
      `STATIC[hits=${String(this.hitsStatic)} misses=${String(this.missesStatic)} rate=${ShadowMaskCacheStore.rate(this.hitsStatic, this.missesStatic)}] ` +
      `ANIMATED[hits=${String(this.hitsAnimated)} misses=${String(this.missesAnimated)} rate=${ShadowMaskCacheStore.rate(this.hitsAnimated, this.missesAnimated)}] ` +
      `avgBuildMs=${this.avgBuildMs().toFixed(3)} (n=${String(this.builds)})`
    );
  }

  /** L175-176 `lruFor(bucket)`。 */
  lruFor(bucket: ShadowCacheBucket): { get: (key: string) => Uint8ClampedArray | undefined; put: (key: string, value: Uint8ClampedArray) => void } {
    const lru = bucket === 'ANIMATED' ? this.animatedLru : this.staticLru;
    return {
      get: (key) => lru.get(key),
      put: (key, value) => {
        lru.put(key, value, value.length);
      },
    };
  }

  byteCount(bucket: ShadowCacheBucket): number {
    return (bucket === 'ANIMATED' ? this.animatedLru : this.staticLru).byteCount;
  }

  clear(): void {
    this.staticLru.clear();
    this.animatedLru.clear();
  }
}

/** 进程级单例（对应 Kotlin 的 `object ShadowMaskCache`）。 */
export const ShadowMaskCache = new ShadowMaskCacheStore();

/** L190-194 `object MaskScratchBuffers`。 */
const scratchPool = new ShadowScratchPool();

export const MaskScratchBuffers = {
  /** L192 `acquire(length)`。 */
  acquire(length: number): Int32Array {
    return scratchPool.acquire(length);
  },
  /** L193 `release(buffer)`。 */
  release(buffer: Int32Array): void {
    scratchPool.release(buffer);
  },
};

/** L205-210 `class ResolvedBlurredShadow` —— 绘制期只剩一次贴图（零分配、无路径运算）。 */
export interface ResolvedBlurredShadow {
  /** 掩码像素（RGBA，长度 = srcWidth * srcHeight * 4）。 */
  readonly image: Uint8ClampedArray;
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly dstOffsetX: number;
  readonly dstOffsetY: number;
  readonly dstWidth: number;
  readonly dstHeight: number;
}

export interface ResolveBlurredShadowInput {
  /** L226 `signature`：轮廓签名（缓存键的一部分）。 */
  readonly signature: string;
  /** L227 `color` 的 alpha（`color.alpha * alpha` 的合成由调用方给）。 */
  readonly effectiveAlpha: number;
  /** L227 `color` 的 RGB 打包成 `0x00RRGGBB`。 */
  readonly rgb: number;
  /** L228 `sigmaPx`。 */
  readonly sigmaPx: number;
  readonly dx: number;
  readonly dy: number;
  readonly boundsLeft: number;
  readonly boundsTop: number;
  readonly boundsRight: number;
  readonly boundsBottom: number;
  /** L231 `strokeWidthPx`（Fill 传 0）。 */
  readonly strokeWidthPx: number;
  readonly alpha?: number;
  readonly useCache?: boolean;
  readonly bucket?: ShadowCacheBucket;
  /** 把「路径按 (left, top, scale) 画进 bw×bh 位图」的绘制回调（由 UI 层给，core 不碰 DOM）。 */
  readonly drawMask: (left: number, top: number, scale: number, width: number, height: number) => Uint8ClampedArray;
}

/** L401-408 `pickMaskScale(sigmaPx, bucket)`。 */
export function pickMaskScale(sigmaPx: number, bucket: ShadowCacheBucket): number {
  if (sigmaPx <= 2.5) return 1;
  if (sigmaPx <= 8) return 0.5;
  if (sigmaPx <= 32) return 0.25;
  // 只有逐帧动画辉光允许再降一档；静态阴影一律停在 0.25，保证像素不变。
  if (bucket === 'ANIMATED') return 0.125;
  return 0.25;
}

/** L480-483 `sigmaToBoxRadius(sigma)`：`r = (−1 + √(1+4σ²)) / 2`，clamp 到 [1, 256]。 */
export function sigmaToBoxRadius(sigma: number): number {
  const r = (-1 + Math.sqrt(1 + 4 * sigma * sigma)) / 2;
  return Math.min(Math.max(Math.round(r), 1), 256);
}

/** L429-430 `buildMaskBitmap` 的位图尺寸（含上限与最小 1px）。 */
export function maskBitmapSize(
  left: number,
  top: number,
  right: number,
  bottom: number,
  scale: number,
): { readonly width: number; readonly height: number } {
  const bw = Math.min(Math.max(1, Math.ceil((right - left) * scale)), SHADOW_MASK_MAX_SIDE);
  const bh = Math.min(Math.max(1, Math.ceil((bottom - top) * scale)), SHADOW_MASK_MAX_SIDE);
  return { width: bw, height: bh };
}

/**
 * L450-470：只模糊 alpha 通道，再按 `rgb | (alpha << 24)` 重建像素。
 * 入参 `pixels` 是 RGBA8 的掩码（第 4 通道为 0 时视为不透明占位，alpha 从第 3 通道取）。
 */
export function blurAlphaChannel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sigmaScaled: number,
  rgb: number,
): Uint8ClampedArray {
  const boxRadius = sigmaScaled >= 0.3 ? sigmaToBoxRadius(sigmaScaled) : 0;
  if (boxRadius < 1) return pixels;
  const n = width * height;
  const alpha = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    // RGBA8 → 取第 4 通道（index*4 + 3）。
    alpha[i] = pixels[i * 4 + 3] ?? 0;
  }
  boxBlurThreePass(alpha, width, height, boxRadius, n);
  const out = new Uint8ClampedArray(pixels.length);
  const r = (rgb >>> 16) & 0xff;
  const g = (rgb >>> 8) & 0xff;
  const b = rgb & 0xff;
  for (let i = 0; i < n; i += 1) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alpha[i] ?? 0;
  }
  return out;
}

/** L223-303 `resolveBlurredShadow(...)`。 */
export function resolveBlurredShadow(input: ResolveBlurredShadowInput): ResolvedBlurredShadow | null {
  const alpha = input.alpha ?? 1;
  const effectiveAlpha = Math.min(Math.max(input.effectiveAlpha * alpha, 0), 1);
  if (effectiveAlpha <= 0.002) return null;
  if (Number.isNaN(input.sigmaPx) || input.sigmaPx < 0) return null;
  if (input.boundsRight <= input.boundsLeft || input.boundsBottom <= input.boundsTop) return null;

  // L243 量化到 0.5px，让缓存键稳定。
  const sigmaQ = Math.round(input.sigmaPx * 2) / 2;
  // L246 位图需覆盖「模糊可见范围（≈3σ）」+ 半个描边。
  const pad = sigmaQ * 3 + input.strokeWidthPx / 2 + 1.5;
  const left = input.boundsLeft - pad;
  const top = input.boundsTop - pad;
  const right = input.boundsRight + pad;
  const bottom = input.boundsBottom + pad;

  const bucket = input.bucket ?? 'STATIC';
  const scale = pickMaskScale(sigmaQ, bucket);
  const sigmaScaled = sigmaQ * scale;
  const bakeColorArgb = ((Math.round(effectiveAlpha * 255) & 0xff) << 24) | (input.rgb & 0xffffff);
  const { width, height } = maskBitmapSize(left, top, right, bottom, scale);
  const useCache = input.useCache !== false;

  const build = (): Uint8ClampedArray => {
    const startedAt = SHADOW_PERF_LOG ? performance.now() : 0;
    const drawn = input.drawMask(left, top, scale, width, height);
    const blurred = blurAlphaChannel(drawn, width, height, sigmaScaled, input.rgb & 0xffffff);
    if (SHADOW_PERF_LOG) ShadowMaskCache.recordBuild((performance.now() - startedAt) * 1_000_000);
    return blurred;
  };

  let mask: Uint8ClampedArray;
  if (useCache) {
    const key: MaskKey = {
      shapeSig: input.signature,
      sigmaQ: halfPx(sigmaQ),
      scaleQ: Math.round(scale * 1000),
      strokeQ: halfPx(input.strokeWidthPx * scale),
      colorArgb: bakeColorArgb,
    };
    const lru = ShadowMaskCache.lruFor(bucket);
    const cached = lru.get(maskKeyId(key));
    if (cached !== undefined) {
      ShadowMaskCache.recordHit(bucket);
      mask = cached;
    } else {
      ShadowMaskCache.recordMiss(bucket);
      mask = build();
      lru.put(maskKeyId(key), mask);
    }
  } else {
    mask = build();
  }

  return {
    image: mask,
    srcWidth: width,
    srcHeight: height,
    dstOffsetX: Math.round(left + input.dx),
    dstOffsetY: Math.round(top + input.dy),
    dstWidth: Math.max(Math.round(width / scale), 1),
    dstHeight: Math.max(Math.round(height / scale), 1),
  };
}

/** L327-357 `drawDeterministicBlurredPath(...)` 的可测部分：算 bounds + 调 resolve。 */
export function deterministicBlurredPath(
  input: ResolveBlurredShadowInput,
): ResolvedBlurredShadow | null {
  return resolveBlurredShadow(input);
}

/** L363-383 `drawDeterministicGlowRoundRect(...)` 的签名（`RR|w|h|r`）。 */
export function glowRoundRectSignature(
  left: number,
  top: number,
  right: number,
  bottom: number,
  cornerRadiusPx: number,
): string {
  const radius = Math.min(Math.max(cornerRadiusPx, 0), (right - left) / 2);
  return `RR|${String(halfPx(right - left))}|${String(halfPx(bottom - top))}|${String(halfPx(radius))}`;
}

/** L491-501 `boxBlurThreePass(alpha, w, h, radius, n)`。 */
export function boxBlurThreePass(alpha: Int32Array, w: number, h: number, radius: number, n: number): void {
  const tmp = MaskScratchBuffers.acquire(n);
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      boxBlurHorizontal(alpha, tmp, w, h, radius);
      boxBlurVertical(tmp, alpha, w, h, radius);
    }
  } finally {
    MaskScratchBuffers.release(tmp);
  }
}

/** L504-549 `boxBlurHorizontal(src, dst, w, h, r)` —— 端点复制 + Float 取整语义逐行照抄。 */
export function boxBlurHorizontal(src: Int32Array, dst: Int32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  const addEnd = Math.max(0, last - r);
  const leadingEnd = Math.min(r, w);
  for (let y = 0; y < h; y += 1) {
    const base = y * w;
    const first = src[base] ?? 0;
    const final = src[base + last] ?? 0;
    // L515-517：用整数乘法替代重复的端点累加。
    let sum = first * (r + 1);
    for (let i = 1; i <= Math.min(r, last); i += 1) sum += src[base + i] ?? 0;
    if (r > last) sum += final * (r - last);
    let x = 0;
    if (r < addEnd) {
      while (x < r) {
        dst[base + x] = Math.trunc(sum * inv + 0.5);
        sum += (src[base + x + r + 1] ?? 0) - first;
        x += 1;
      }
      while (x < addEnd) {
        dst[base + x] = Math.trunc(sum * inv + 0.5);
        sum += (src[base + x + r + 1] ?? 0) - (src[base + x - r] ?? 0);
        x += 1;
      }
    } else {
      while (x < addEnd) {
        dst[base + x] = Math.trunc(sum * inv + 0.5);
        sum += (src[base + x + r + 1] ?? 0) - first;
        x += 1;
      }
      while (x < leadingEnd) {
        dst[base + x] = Math.trunc(sum * inv + 0.5);
        sum += final - first;
        x += 1;
      }
    }
    while (x < w) {
      dst[base + x] = Math.trunc(sum * inv + 0.5);
      sum += final - (src[base + x - r] ?? 0);
      x += 1;
    }
  }
}

/** L552-580 `boxBlurVertical(src, dst, w, h, r)` —— 按行遍历连续内存，列和语义一致。 */
export function boxBlurVertical(src: Int32Array, dst: Int32Array, w: number, h: number, r: number): void {
  const div = 2 * r + 1;
  const inv = 1 / div;
  const last = h - 1;
  const sums = MaskScratchBuffers.acquire(w);
  try {
    for (let x = 0; x < w; x += 1) sums[x] = (src[x] ?? 0) * (r + 1);
    for (let row = 1; row <= Math.min(r, last); row += 1) {
      const base = row * w;
      for (let x = 0; x < w; x += 1) sums[x] = (sums[x] ?? 0) + (src[base + x] ?? 0);
    }
    if (r > last) {
      const base = last * w;
      for (let x = 0; x < w; x += 1) sums[x] = (sums[x] ?? 0) + (src[base + x] ?? 0) * (r - last);
    }
    let base = 0;
    for (let y = 0; y < h; y += 1) {
      const addBase = Math.min(y + r + 1, last) * w;
      const subBase = Math.max(y - r, 0) * w;
      for (let x = 0; x < w; x += 1) {
        dst[base + x] = Math.trunc((sums[x] ?? 0) * inv + 0.5);
        sums[x] = (sums[x] ?? 0) + (src[addBase + x] ?? 0) - (src[subBase + x] ?? 0);
      }
      base += w;
    }
  } finally {
    MaskScratchBuffers.release(sums);
  }
}

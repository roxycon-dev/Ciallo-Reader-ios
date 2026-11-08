/** CPU raster codec: ARGB packing, bilinear sampling, rotations, compositing and color matrices. */
import type {
  PixCodec,
  PixImage,
  PixOps,
  StripeRunner,
} from '@core/comic/comicPixOps'
import { serialStripes } from '@core/comic/comicPixOps'
import type { RectF } from '@core/comic/comicPortTypes'

/* ── 颜色工具（与 Android 0xAARRGGBB 逐位一致） ───────────────────────────── */

export const ARGB = (a: number, r: number, g: number, b: number): number =>
  (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0

export const rgb = (r: number, g: number, b: number): number => ARGB(0xff, r, g, b)

export const ANDROID_WHITE = rgb(0xff, 0xff, 0xff)
export const ANDROID_BLACK = rgb(0x00, 0x00, 0x00)
export const ANDROID_RED = rgb(0xff, 0x00, 0x00)
export const ANDROID_BLUE = rgb(0x00, 0x00, 0xff)
export const ANDROID_GREEN = rgb(0x00, 0xff, 0x00)
export const ANDROID_GRAY = rgb(0x80, 0x80, 0x80)
export const ANDROID_LTGRAY = rgb(0xcf, 0xcf, 0xcf)
export const ANDROID_DKGRAY = rgb(0x44, 0x44, 0x44)

/** `Color.red` / `Color.green` / `Color.blue`（无 alpha 版本）。 */
export const redOf = (p: number): number => (p >>> 16) & 0xff
export const greenOf = (p: number): number => (p >>> 8) & 0xff
export const blueOf = (p: number): number => p & 0xff

/** 0xFF000000 | r<<16 | g<<8 | b —— Android ColorMatrix 输出的 alpha 恒 255。 */
function packOpaque(r: number, g: number, b: number): number {
  return (0xff000000 | (r & 0xff) << 16 | (g & 0xff) << 8 | (b & 0xff)) >>> 0
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/* ── Bitmap.createBitmap(w, h, ARGB_8888) ─────────────────────────────────── */

export function bitmap(w: number, h: number, fill = 0): PixImage {
  const data = new Uint32Array(w * h)
  if (fill !== 0) data.fill(fill >>> 0)
  return { width: w, height: h, data }
}

/**
 * Kotlin 测试里的 `solidBitmap(w, h, color) { x, y -> … }` 等价物。
 * `content(x, y)` 返回 `null` 时回落到 `fill`（对应 Kotlin `content(x,y) ?: color`）。
 */
export function solidBitmap(
  w: number,
  h: number,
  fill: number,
  content: (x: number, y: number) => number | null = () => null,
): PixImage {
  const data = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = content(x, y)
      data[y * w + x] = (c === null ? fill : c) >>> 0
    }
  }
  return { width: w, height: h, data }
}

/* ── createScaledBitmap(filter = true)：中心对齐双线性 ──────────────────────── */

function sampleBilinear(src: PixImage, fx: number, fy: number): number {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const wx = fx - x0
  const wy = fy - y0
  // clamp 边缘采样（与 Android `Bitmap` 的边界钳一致）
  const cx0 = x0 < 0 ? 0 : x0 > src.width - 1 ? src.width - 1 : x0
  const cy0 = y0 < 0 ? 0 : y0 > src.height - 1 ? src.height - 1 : y0
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 > src.width - 1 ? src.width - 1 : x0 + 1
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 > src.height - 1 ? src.height - 1 : y0 + 1
  const p00 = src.data[cy0 * src.width + cx0] as number
  const p01 = src.data[cy0 * src.width + cx1] as number
  const p10 = src.data[cy1 * src.width + cx0] as number
  const p11 = src.data[cy1 * src.width + cx1] as number
  const ch = (p: number, shift: number): number => (p >>> shift) & 0xff
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
  const mix = (shift: number): number =>
    Math.round(
      lerp(
        lerp(ch(p00, shift), ch(p01, shift), wx),
        lerp(ch(p10, shift), ch(p11, shift), wx),
        wy,
      ),
    )
  return packOpaque(mix(16), mix(8), mix(0))
}

/* ── 参考 PixCodec ────────────────────────────────────────────────────────── */

export interface ReferencePixCodecOptions {
  /** `StripeRunner`；默认串行（与 Kotlin 单核回退路径逐位一致）。 */
  readonly stripes?: StripeRunner
  /** 注入 Anime4K 网络（`PixOps.cnn`）。 */
  readonly cnn?: PixOps['cnn']
}

export function referencePixOps(options: ReferencePixCodecOptions = {}): PixOps {
  const mirror = new WeakMap<PixImage, boolean>()

  const isMirrored = (dst: PixImage): boolean => mirror.get(dst) === true

  const put = (dst: PixImage, x: number, y: number, p: number): void => {
    if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return
    const tx = isMirrored(dst) ? dst.width - 1 - x : x
    dst.data[y * dst.width + tx] = p >>> 0
  }

  const codec: PixCodec = {
    createBitmap(w: number, h: number, pixels: Uint32Array): PixImage {
      const data = new Uint32Array(w * h)
      data.set(pixels.subarray(0, Math.min(pixels.length, w * h)))
      return { width: w, height: h, data }
    },

    createScaledBitmap(src: PixImage, w: number, h: number): PixImage {
      const out = bitmap(w, h)
      const scaleX = src.width / w
      const scaleY = src.height / h
      for (let y = 0; y < h; y++) {
        // 中心对齐：Android 把目标像素中心 (x+0.5, y+0.5) 映射回源坐标
        const sy = (y + 0.5) * scaleY - 0.5
        for (let x = 0; x < w; x++) {
          const sx = (x + 0.5) * scaleX - 0.5
          out.data[y * w + x] = sampleBilinear(src, sx, sy)
        }
      }
      return out
    },

    createBitmapRegion(src: PixImage, x: number, y: number, w: number, h: number): PixImage {
      const out = bitmap(w, h)
      for (let row = 0; row < h; row++) {
        const sy = y + row
        if (sy < 0 || sy >= src.height) continue
        for (let col = 0; col < w; col++) {
          const sx = x + col
          if (sx < 0 || sx >= src.width) continue
          out.data[row * w + col] = src.data[sy * src.width + sx] as number
        }
      }
      return out
    },

    createBitmapRotated(src: PixImage, degrees: number): PixImage {
      const deg = ((degrees % 360) + 360) % 360
      if (deg === 0) return src
      if (deg === 90) {
        // 顺时针 90°：dst(x,y) = src(y, h-1-x)
        const out = bitmap(src.height, src.width)
        for (let y = 0; y < src.width; y++) {
          for (let x = 0; x < src.height; x++) {
            out.data[x * src.width + (src.width - 1 - y)] = src.data[y * src.height + x] as number
          }
        }
        return out
      }
      if (deg === 180) {
        const out = bitmap(src.width, src.height)
        for (let i = 0; i < src.data.length; i++) {
          out.data[i] = src.data[src.data.length - 1 - i] as number
        }
        return out
      }
      if (deg === 270) {
        // 顺时针 270°：dst(x,y) = src(w-1-y, x)
        const out = bitmap(src.height, src.width)
        for (let y = 0; y < src.width; y++) {
          for (let x = 0; x < src.height; x++) {
            out.data[(src.height - 1 - x) * src.width + y] = src.data[y * src.height + x] as number
          }
        }
        return out
      }
      // 非 90 倍数：AOSP 走浮点矩阵；本参考实现不覆盖该分支
      throw new Error(`reference PixCodec: unsupported rotation ${degrees}`)
    },

    drawBitmap(dst: PixImage, src: PixImage, dx: number, dy: number, alpha = 255): void {
      const blend = alpha >= 255
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const p = src.data[y * src.width + x] as number
          const px = Math.trunc(dx) + x
          const py = Math.trunc(dy) + y
          if (blend) {
            put(dst, px, py, p)
          } else {
            const tx = isMirrored(dst) ? dst.width - 1 - px : px
            if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue
            const idx = py * dst.width + tx
            const d = dst.data[idx] as number
            const a = alpha / 255
            dst.data[idx] = packOpaque(
              Math.round(redOf(p) * a + redOf(d) * (1 - a)),
              Math.round(greenOf(p) * a + greenOf(d) * (1 - a)),
              Math.round(blueOf(p) * a + blueOf(d) * (1 - a)),
            )
          }
        }
      }
    },

    drawBitmapRect(
      dst: PixImage,
      src: PixImage,
      rect: RectF,
      alpha: number,
      _filter: boolean,
    ): void {
      const x0 = Math.round(rect.left)
      const y0 = Math.round(rect.top)
      const dw = Math.round(rect.right - rect.left)
      const dh = Math.round(rect.bottom - rect.top)
      const scaleX = src.width / (dw === 0 ? 1 : dw)
      const scaleY = src.height / (dh === 0 ? 1 : dh)
      const blend = alpha >= 255
      for (let y = 0; y < dh; y++) {
        const sy = Math.min(src.height - 1, Math.max(0, Math.round((y + 0.5) * scaleY - 0.5)))
        for (let x = 0; x < dw; x++) {
          const sx = Math.min(src.width - 1, Math.max(0, Math.round((x + 0.5) * scaleX - 0.5)))
          const p = src.data[sy * src.width + sx] as number
          const px = x0 + x
          const py = y0 + y
          if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue
          if (blend) {
            put(dst, px, py, p)
          } else {
            const tx = isMirrored(dst) ? dst.width - 1 - px : px
            const idx = py * dst.width + tx
            const d = dst.data[idx] as number
            const a = alpha / 255
            dst.data[idx] = packOpaque(
              Math.round(redOf(p) * a + redOf(d) * (1 - a)),
              Math.round(greenOf(p) * a + greenOf(d) * (1 - a)),
              Math.round(blueOf(p) * a + blueOf(d) * (1 - a)),
            )
          }
        }
      }
    },

    drawBitmapColorMatrix(dst: PixImage, src: PixImage, m: Float32Array): void {
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const p = src.data[y * src.width + x] as number
          const a = (p >>> 24) & 0xff
          const r = (p >>> 16) & 0xff
          const g = (p >>> 8) & 0xff
          const b = p & 0xff
          const nr = m[0]! * r + m[1]! * g + m[2]! * b + m[3]! + m[19]!
          const ng = m[5]! * r + m[6]! * g + m[7]! * b + m[8]! + m[14]!
          const nb = m[10]! * r + m[11]! * g + m[12]! * b + m[9]! + m[13]!
          dst.data[y * src.width + x] =
            ((a << 24) |
              (clamp255(Math.round(nr)) << 16) |
              (clamp255(Math.round(ng)) << 8) |
              clamp255(Math.round(nb))) >>>
            0
        }
      }
    },

    byteCount(src: PixImage): number {
      return src.width * src.height * 4
    },

    createBitmapMirroredX(src: PixImage): PixImage {
      const out = bitmap(src.width, src.height)
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          out.data[y * src.width + (src.width - 1 - x)] = src.data[y * src.width + x] as number
        }
      }
      return out
    },

    setMirrorX(dst: PixImage, enabled: boolean): void {
      mirror.set(dst, enabled)
    },
  }

  // `PixOps.cnn` 是 optional 且本项目开了 `exactOptionalPropertyTypes`，所以只在
  // 真的注入了网络时才带上这个键（写 `cnn: undefined` 不被允许）。
  const cnn = options.cnn
  return cnn === undefined
    ? { codec, stripes: options.stripes ?? serialStripes }
    : { codec, stripes: options.stripes ?? serialStripes, cnn }
}

/* ── android.graphics.Matrix 参考实现（exifDisplayMatrix 断言用） ───────────── */

/**
 * 3x3 仿射矩阵，`setRotate` / `setScale` / `postScale` 与 AOSP 语义一致：
 *   setRotate(d)   → M = R(d)（绕原点，无平移）
 *   setScale(sx,sy)→ M = S(sx,sy)
 *   postScale(sx,sy) → M' = S(sx,sy) * M（左乘）
 * `mapRect` 按 mapPoints + bounds 归一化。
 */
export class RefMatrix {
  // 行主序 3x3：m[row][col]
  private readonly m: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  static multiply(a: RefMatrix, b: RefMatrix): RefMatrix {
    const out = new RefMatrix()
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0
        for (let k = 0; k < 3; k++) s += a.at(r, k) * b.at(k, c)
        out.set(r, c, s)
      }
    }
    return out
  }

  private at(r: number, c: number): number {
    return (this.m[r] as number[])[c] as number
  }

  private set(r: number, c: number, v: number): void {
    ;(this.m[r] as number[])[c] = v
  }

  setRotate(degrees: number): this {
    const rad = (degrees * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    this.set(0, 0, c)
    this.set(0, 1, -s)
    this.set(1, 0, s)
    this.set(1, 1, c)
    return this
  }

  postScale(sx: number, sy: number): this {
    const scale = new RefMatrix()
    scale.set(0, 0, sx)
    scale.set(1, 1, sy)
    const next = RefMatrix.multiply(scale, this)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) this.set(r, c, next.at(r, c))
    }
    return this
  }

  mapPoint(x: number, y: number): { x: number; y: number } {
    const w = this.at(2, 0) * x + this.at(2, 1) * y + this.at(2, 2)
    const dx = (this.at(0, 0) * x + this.at(0, 1) * y + this.at(0, 2)) / w
    const dy = (this.at(1, 0) * x + this.at(1, 1) * y + this.at(1, 2)) / w
    return { x: dx, y: dy }
  }

  /** `Matrix.mapRect` — 映射两个对角点后取包围盒。 */
  mapRect(left: number, top: number, right: number, bottom: number): {
    left: number
    top: number
    right: number
    bottom: number
  } {
    const a = this.mapPoint(left, top)
    const b = this.mapPoint(right, bottom)
    return {
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      right: Math.max(a.x, b.x),
      bottom: Math.max(a.y, b.y),
    }
  }
}
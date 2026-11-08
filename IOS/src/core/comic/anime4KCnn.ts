/**
 * anime4KCnn.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/Anime4KCnn.kt
 *
 * Kotlin source: 1240 lines / 257 non-blank (file ends at L1241 with a trailing newline).
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`               — package decl            │
 * │ L3–7      `import android.graphics.Bitmap` + math      — android/math imports   │
 * │ L52–53    `restoreLayers / upscaleLayers by lazy`      — became `Anime4K-      │
 * │                                                        CnnWeights` (async     │
 * │                                                        asset-backed, same      │
 * │                                                        "parse once, first use") │
 * │ L74       `parallelStripes(h, minParallelRows = 128)`  — injected `StripeRunner`│
 * │ L105–119  `bitmapToPlane(Bitmap)`                       — `PixImage` seam        │
 * │ L156      `ComicNeuralBackend.run("restore", …)`       — ALWAYS null here:     │
 * │                                                        there is no ONNX graph  │
 * │                                                        in this port, so the     │
 * │                                                        `?:` fallback (`runNet- │
 * │                                                        work`) always runs.      │
 * │ L172/177  `Bitmap.createBitmap(w, h, ARGB_8888)` + setPixels — `PixCodec` seam   │
 * │ L191      `ComicEdgeUpscaler.upscale(src, ow, oh)`    — imported from comic-  │
 * │                                                        ImagePipeline.ts (its  │
 * │                                                        home; the EASU kernel   │
 * │                                                        lives there)            │
 * │ L218–219  `Bitmap.createBitmap(ow, oh, ARGB_8888)` + setPixels — `PixCodec`     │
 * │ L231      `Thread.currentThread().isInterrupted`       — no cancellation in a  │
 * │                                                        synchronous port        │
 * │ L236/243–248 `Bitmap.createBitmap(src, x, y, w, h)` / recycle — `PixCodec`      │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * The GLSL semantics being emulated are ported 1:1 — column-major mat4×vec4
 * (`result_row = Σ_col w[col*4+row] · v[col]`), go_0/go_1 half-wave packing, clamped
 * edge sampling (texOff equivalent), and the Restore / Upscale last-layer semantics
 * (3-channel residual + original; depth-to-space ×2 with `(oy%2)*2+(ox%2)` subpixel
 * lanes over an EASU 12-tap reconstruction).
 *
 * NOT ported: the upstream Anime4K GLSL shaders themselves. They are not in the Kotlin
 * file — this class is their CPU transcription, and the task brief explicitly excludes
 * shader compilation.
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `Bitmap` → `PixImage` + injected `PixCodec` (adapter lives outside src/core).
 * • `by lazy` weights → `Anime4KCnnWeights`, whose flat tables come from an injected
 *   `Anime4KCnnWeightSource` (data-asset reference, see anime4KCnnWeights.ts).
 *   `restore` / `upscale2x` therefore take the *already parsed* `CnnLayer[]` and stay
 *   synchronous — the load happens once, at app start, in `Anime4KCnnWeights.layers()`.
 * • `parallelStripes` → injected `StripeRunner` (`PixOps.stripes`).
 * • Kotlin `Int` pixel packing → `Uint32Array` with `>>>` shifts (same magic numbers).
 * • `Float.toInt()` truncates toward zero in Kotlin and JS alike — no conversion needed.
 * • `module import cycle`: this file imports `edgeUpscalerUpscale` from
 *   `./comicImagePipeline` (Kotlin's `ComicEdgeUpscaler` object, which is in the same
 *   package and reached identically), and `./comicImagePipeline` imports `restore` /
 *   `upscale2x` back. Both sides only bind module-level `function` declarations
 *   (hoisted), so no initialisation order is affected — verified by the vitest suite,
 *   which imports both entry points.
 */

import type {
  CnnGroup,
  CnnLayer,
  PixImage,
  PixOps,
  StripeRunner,
} from './comicPixOps'
import { clamp, defaultParallelStripes, roundToInt } from './comicPixOps'
import { edgeUpscalerUpscale } from './comicImagePipeline'
import type { Anime4KCnnNet, Anime4KCnnWeightSource } from './anime4KCnnWeights'

export type { CnnGroup, CnnLayer }

/** Anime4K CNN CPU 求值器（第 20 条增强引擎）。 */
export const ANIME4K_DOC =
  'Anime4K CNN CPU 求值器（第 20 条增强引擎）。按 GLSL 语义逐层执行固定权重网络：' +
  '列主序 mat4×vec4、go_0/go_1 正/负半波激活打包、边缘 clamp 采样、' +
  'Restore 末层 3 通道残差 + 原图、Upscale 末层 depth-to-space x2。'

/** 解析扁平权重布局（见 anime4KCnnWeights 注释） */
export function readFlat(flat: Float32Array): CnnLayer[] {
  let cur = 0
  const nLayers = Math.trunc(flat[cur++]!)
  const layers: CnnLayer[] = []
  for (let l = 0; l < nLayers; l++) {
    const nGroups = Math.trunc(flat[cur++]!)
    const bias = new Float32Array(4)
    for (let i = 0; i < 4; i++) bias[i] = flat[cur + i]!
    cur += 4
    const groups: CnnGroup[] = []
    for (let g = 0; g < nGroups; g++) {
      const tex = Math.trunc(flat[cur++]!)
      const act = Math.trunc(flat[cur++]!)
      const ox = Math.trunc(flat[cur++]!)
      const oy = Math.trunc(flat[cur++]!)
      const w = new Float32Array(16)
      for (let i = 0; i < 16; i++) w[i] = flat[cur + i]!
      cur += 16
      groups.push({ tex, act, ox, oy, w })
    }
    layers.push({ groups, bias })
  }
  return layers
}

/**
 * 懒加载解析好的权重（替代 Kotlin L52–53 的两个 `by lazy`）。
 * 与 Kotlin 相同：解析一次、首次使用时填充；失败不缓存，下次调用重试。
 */
export class Anime4KCnnWeights {
  private readonly parsed = new Map<Anime4KCnnNet, Promise<CnnLayer[]>>()

  constructor(private readonly source: Anime4KCnnWeightSource) {}

  layers(net: Anime4KCnnNet): Promise<CnnLayer[]> {
    const hit = this.parsed.get(net)
    if (hit !== undefined) return hit
    const p = this.source.loadFlat(net).then(readFlat)
    this.parsed.set(net, p)
    return p
  }
}

/* ── 基础采样与卷积 ── */

/** clamp 边缘采样（Kotlin L62–71 `sample`）。导出以钉死 act=0/1/2 三支分支。 */
export function sample(
  tex: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  act: number,
  out: Float32Array,
): void {
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y
  const i = (cy * w + cx) * 4
  switch (act) {
    case 1:
      out[0] = Math.max(0, tex[i]!)
      out[1] = Math.max(0, tex[i + 1]!)
      out[2] = Math.max(0, tex[i + 2]!)
      out[3] = Math.max(0, tex[i + 3]!)
      break
    case 2:
      out[0] = Math.max(0, -tex[i]!)
      out[1] = Math.max(0, -tex[i + 1]!)
      out[2] = Math.max(0, -tex[i + 2]!)
      out[3] = Math.max(0, -tex[i + 3]!)
      break
    default:
      out[0] = tex[i]!
      out[1] = tex[i + 1]!
      out[2] = tex[i + 2]!
      out[3] = tex[i + 3]!
      break
  }
}

/** 单层卷积（src0=原图平面，src1=上一层输出；返回新 4 通道平面）。
 *  第六轮第 5 条：行条带多核并行（读 src ±1 行越界只读安全，out 独立缓冲）。 */
export function convLayer(
  layer: CnnLayer,
  src0: Float32Array,
  src1: Float32Array,
  w: number,
  h: number,
  stripes: StripeRunner = defaultParallelStripes,
): Float32Array {
  const out = new Float32Array(w * h * 4)
  const v = new Float32Array(4)
  stripes(h, (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        let r0 = layer.bias[0]!
        let r1 = layer.bias[1]!
        let r2 = layer.bias[2]!
        let r3 = layer.bias[3]!
        for (const g of layer.groups) {
          sample(g.tex === 0 ? src0 : src1, w, h, x + g.ox, y + g.oy, g.act, v)
          const wq = g.w
          r0 += wq[0]! * v[0]! + wq[4]! * v[1]! + wq[8]! * v[2]! + wq[12]! * v[3]!
          r1 += wq[1]! * v[0]! + wq[5]! * v[1]! + wq[9]! * v[2]! + wq[13]! * v[3]!
          r2 += wq[2]! * v[0]! + wq[6]! * v[1]! + wq[10]! * v[2]! + wq[14]! * v[3]!
          r3 += wq[3]! * v[0]! + wq[7]! * v[1]! + wq[11]! * v[2]! + wq[15]! * v[3]!
        }
        const o = (y * w + x) * 4
        out[o] = r0
        out[o + 1] = r1
        out[o + 2] = r2
        out[o + 3] = r3
      }
    }
  })
  return out
}

export function runNetwork(
  layers: ReadonlyArray<CnnLayer>,
  src0: Float32Array,
  w: number,
  h: number,
  stripes: StripeRunner = defaultParallelStripes,
): Float32Array {
  let prev = src0
  for (const l of layers) prev = convLayer(l, src0, prev, w, h, stripes)
  return prev
}

function bitmapToPlane(src: PixImage): Float32Array {
  const w = src.width
  const h = src.height
  const plane = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const p = src.data[i]!
    const o = i * 4
    plane[o] = ((p >>> 16) & 0xff) / 255
    plane[o + 1] = ((p >>> 8) & 0xff) / 255
    plane[o + 2] = (p & 0xff) / 255
    plane[o + 3] = 1 // GLSL MAIN 纹理的 alpha（mpv 挂钩下恒 1）
  }
  return plane
}

function clamp255(v: number): number {
  // Kotlin: `(v * 255f).roundToInt().coerceIn(0, 255)` — `roundToInt` ties toward +∞.
  return clamp(roundToInt(v * 255), 0, 255)
}

/**
 * `readFlat` on an empty table yields zero layers, which makes `runNetwork` return its
 * own input and `upscale2x` add a *colour channel* of the source as a residual — i.e.
 * silently wrong pixels. Kotlin always has the weights (`by lazy { readFlat(RESTORE_S) }`
 * over an inline table), so an empty layer list can only mean "the asset failed to load /
 * `PixOps.cnn` was not injected". Fail loudly instead of shipping corrupt output (same
 * policy as PARITY_EXCEPTIONS E41/E42 for the crypto primitives).
 */
function requireLayers(layers: ReadonlyArray<CnnLayer>, which: string): void {
  if (layers.length === 0) {
    throw new Error(
      `Anime4K ${which} 权重未注入（PixOps.cnn.${which === 'restore' ? 'restore' : 'upscale'} 为空）：` +
        '请注入 Anime4KCnnWeights.layers() 的解析结果（数据资产 /comic/anime4k_*.json）',
    )
  }
}

/** Anime4K Restore（轻量档）：线条重建/降噪，不放大。
 *  Kotlin L150–151：`tiled(src, 1, maxEdge.coerceIn(32, 256)) { restorePatch(it, strength) }` */
export function restore(
  src: PixImage,
  strength: number,
  maxEdge: number,
  ops: PixOps,
  restoreLayers: ReadonlyArray<CnnLayer>,
): PixImage {
  const w0 = src.width
  const h0 = src.height
  if (w0 < 8 || h0 < 8) return src
  requireLayers(restoreLayers, 'restore')
  return tiled(src, 1, clamp(Math.trunc(maxEdge), 32, 256), ops, (patch) =>
    restorePatch(patch, strength, ops, restoreLayers),
  )
}

/** Kotlin L153–180 `restorePatch(src, strength)`. */
function restorePatch(
  src: PixImage,
  strength: number,
  ops: PixOps,
  restoreLayers: ReadonlyArray<CnnLayer>,
): PixImage {
  const w = src.width
  const h = src.height
  const plane = bitmapToPlane(src)
  // Kotlin `ComicNeuralBackend.run("restore", plane, w, h)` — always null on this port
  // (no ONNX graph, no native backend), so the reference network runs. See the header.
  const out = runNetwork(restoreLayers, plane, w, h, ops.stripes)
  const detail = restoreDetail(out, w, h)
  // 末层语义（Anime4K v4.0 Restore GLSL：SAVE = conv + HOOKED_tex）：
  // runNetwork 返回的是"卷积增量"，完整输出 = 原图 + 增量，strength 缩放增量。
  // 第六轮第 5 条（视觉终审）：CNN 残差全量应用在噪声底上产生"整体提亮+
  // 线条变薄"的负向观感（代理判定 worse than original）——残差固定 0.6
  // 上限系数，弱化网络对底色的整体重投影，主要效果交给下游线重建。
  const original = src.data
  const px = new Uint32Array(w * h)
  for (let i = 0; i < px.length; i++) {
    const o = i * 4
    const d = 0.6 * clamp(strength, 0, 1) * edgeGate(plane, w, h, i % w, Math.trunc(i / w))
    const delta = clamp(
      clamp(detail[i]! * d, -24 / 255, 24 / 255),
      -Math.min(plane[o]!, plane[o + 1]!, plane[o + 2]!),
      1 - Math.max(plane[o]!, plane[o + 1]!, plane[o + 2]!),
    )
    const r = plane[o]! + delta
    const g = plane[o + 1]! + delta
    const b = plane[o + 2]! + delta
    px[i] =
      ((original[i]! & 0xff000000) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0
  }
  return ops.codec.createBitmap(w, h, px)
}

/**
 * Remove the network's DC colour bias; only bounded luminance detail may be added.
 * Kotlin L124–134. Exported so the 0.299/0.587/0.114 weights and the
 * clamp-at-the-border 4-neighbour mean are pinned by a numeric test.
 */
export function restoreDetail(conv: Float32Array, w: number, h: number): Float32Array {
  const luminance = new Float32Array(w * h)
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] = conv[i * 4]! * 0.299 + conv[i * 4 + 1]! * 0.587 + conv[i * 4 + 2]! * 0.114
  }
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) {
    const x = i % w
    const y = Math.trunc(i / w)
    const mean =
      (luminance[Math.max(0, y - 1) * w + x]! +
        luminance[Math.min(h - 1, y + 1) * w + x]! +
        luminance[y * w + Math.max(0, x - 1)]! +
        luminance[y * w + Math.min(w - 1, x + 1)]!) *
      0.25
    out[i] = luminance[i]! - mean
  }
  return out
}

/**
 * Kotlin L136–145 `edgeGate`. Smoothstep of the 3×3 luma range — 0 on flat paper, 1 on a
 * hard edge. Exported so the `.299/.587/.114` weights, the 9-sample border clamp, the
 * `((hi-lo)*255 - 8)/32` normalisation and the `edge²(3-2·edge)` smoothstep are pinned.
 */
export function edgeGate(plane: Float32Array, w: number, h: number, x: number, y: number): number {
  let lo = 1
  let hi = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4
      const value = plane[i]! * 0.299 + plane[i + 1]! * 0.587 + plane[i + 2]! * 0.114
      lo = Math.min(lo, value)
      hi = Math.max(hi, value)
    }
  }
  const edge = clamp((((hi - lo) * 255 - 8) / 32), 0, 1)
  return edge * edge * (3 - 2 * edge)
}

/**
 * Anime4K Upscale x2（完整档）：CNN 2x 超分（深度到空间 + EASU 基准 + 亮度残差）。
 * 第 5 条：[maxSrcEdge] 由调用方按"目标尺寸的一半"显式传入（输出恒 ≥ 原分辨率）。
 * 预算上限 256（输入 1.7M px 时网络平面 ~28MB×3，内存护栏）。
 * Kotlin L183–184：`tiled(src, 2, maxSrcEdge.coerceIn(32, 256)) { upscalePatch(it, strength) }`
 */
export function upscale2x(
  src: PixImage,
  strength: number,
  maxSrcEdge: number,
  ops: PixOps,
  upscaleLayers: ReadonlyArray<CnnLayer>,
): PixImage {
  const w0 = src.width
  const h0 = src.height
  if (w0 < 8 || h0 < 8) return src
  requireLayers(upscaleLayers, 'upscale')
  return tiled(src, 2, clamp(Math.trunc(maxSrcEdge), 32, 256), ops, (patch) =>
    upscalePatch(patch, strength, ops, upscaleLayers),
  )
}

/** Kotlin L186–221 `upscalePatch(src, strength)`. */
function upscalePatch(
  src: PixImage,
  strength: number,
  ops: PixOps,
  upscaleLayers: ReadonlyArray<CnnLayer>,
): PixImage {
  const w = src.width
  const h = src.height
  const plane = bitmapToPlane(src)
  const conv = runNetwork(upscaleLayers, plane, w, h, ops.stripes)
  const ow = w * 2
  const oh = h * 2
  const baseline = edgeUpscalerUpscale(src, ow, oh, ops)
  const base = baseline.data
  const px = new Uint32Array(base)
  const gates = new Float32Array(w * h)
  for (let i = 0; i < gates.length; i++) {
    gates[i] = edgeGate(plane, w, h, i % w, Math.trunc(i / w))
  }
  const lum = (c: number): number =>
    (((c >>> 16) & 0xff) * 0.299 + ((c >>> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114)
  for (let oy = 0; oy < oh; oy++) {
    const cy = oy >>> 1
    for (let ox = 0; ox < ow; ox++) {
      const cx = ox >>> 1
      const ci = (cy * w + cx) * 4 + ((oy & 1) * 2 + (ox & 1))
      const index = oy * ow + ox
      const color = base[index]!
      const localDetail =
        lum(color) -
        (lum(base[Math.max(0, oy - 1) * ow + ox]!) +
          lum(base[Math.min(oh - 1, oy + 1) * ow + ox]!) +
          lum(base[oy * ow + Math.max(0, ox - 1)]!) +
          lum(base[oy * ow + Math.min(ow - 1, ox + 1)]!)) *
          0.25
      const predicted = conv[ci]! * 255 * clamp(strength, 0, 1) * gates[cy * w + cx]!
      // A video-trained subpixel residual must not reverse manga edges or invent
      // periodic paper texture. Trust only detail supported by the reconstruction.
      const bound = Math.min(12, Math.abs(localDetail) * 0.35)
      const residual = predicted * localDetail > 0 ? clamp(predicted, -bound, bound) : 0
      const red = (color >>> 16) & 0xff
      const green = (color >>> 8) & 0xff
      const blue = color & 0xff
      const delta = clamp(
        residual,
        -Math.min(red, green, blue),
        255 - Math.max(red, green, blue),
      )
      const ch = (v: number): number => clamp(roundToInt(v + delta), 0, 255)
      px[index] = ((color & 0xff000000) | (ch(red) << 16) | (ch(green) << 8) | ch(blue)) >>> 0
    }
  }
  return ops.codec.createBitmap(ow, oh, px)
}

/**
 * Output cores are disjoint; only privately owned patch bitmaps are recycled.
 * Kotlin L224–256 `tiled(src, scale, edge, infer)`.
 * Exported so the halo=8 / `step edge` / corner-patch offsets can be pinned numerically.
 */
export function tiled(
  src: PixImage,
  scale: number,
  edge: number,
  ops: PixOps,
  infer: (patch: PixImage) => PixImage,
): PixImage {
  if (src.width < 8 || src.height < 8) return src
  const output = new Uint32Array(src.width * scale * (src.height * scale))
  const halo = 8
  for (let top = 0; top < src.height; top += edge) {
    for (let left = 0; left < src.width; left += edge) {
      const right = Math.min(src.width, left + edge)
      const bottom = Math.min(src.height, top + edge)
      const x0 = Math.max(0, left - halo)
      const y0 = Math.max(0, top - halo)
      const x1 = Math.min(src.width, right + halo)
      const y1 = Math.min(src.height, bottom + halo)
      const patch = ops.codec.createBitmapRegion(src, x0, y0, x1 - x0, y1 - y0)
      const result = infer(patch)
      const width = (right - left) * scale
      const height = (bottom - top) * scale
      // Kotlin: result.getPixels(pixels, 0, width, (left - x0) * scale, (top - y0) * scale, width, height)
      //         output.setPixels(pixels, 0, width, left * scale, top * scale, width, height)
      const pixels = new Uint32Array(width * height)
      const rw = result.width
      for (let py = 0; py < height; py++) {
        const srcOff = ((top - y0) * scale + py) * rw + (left - x0) * scale
        pixels.set(result.data.subarray(srcOff, srcOff + width), py * width)
      }
      const ow = src.width * scale
      for (let py = 0; py < height; py++) {
        const dstOff = (top * scale + py) * ow + left * scale
        output.set(pixels.subarray(py * width, py * width + width), dstOff)
      }
    }
  }
  return ops.codec.createBitmap(src.width * scale, src.height * scale, output)
}

/** `roundToInt` re-export keeps the Anime4K surface self-contained for tests. */
export { roundToInt }
/**
 * comicImagePipeline.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicImagePipeline.kt
 *
 * Kotlin source: 1239 lines / 1154 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`                       — package decl  │
 * │ L3–18     `import android.graphics.*` / `kotlinx.coroutines.*`   — Android+coro │
 * │ L35       `object ComicImagePipeline {`                         — became a module │
 * │ L113–122  `runBlocking { async(Dispatchers.Default) … }`        — coroutines:    │
 * │                                                                replaced by the  │
 * │                                                                injected        │
 * │                                                                `StripeRunner`  │
 * │                                                                (work-splitting │
 * │                                                                seam). See      │
 * │                                                                ADAPTATION note │
 * │                                                                below.          │
 * │ L132/162/170/173/182/213/403/405  `Bitmap.createBitmap(...)`    — pixel storage │
 * │ L213,403  `Matrix().apply { setScale(scale, scale) }`          — codec seam     │
 * │ L181–182  `Matrix().apply { postRotate(degrees) }`             — codec seam     │
 * │ L505/521  `Bitmap.createScaledBitmap(...)` (downscale guard)   — codec seam     │
 * │ L679–686  `applyColorMatrix` via `Canvas`+`Paint`              — codec seam     │
 * │ L594/707/902/999  `Bitmap.createScaledBitmap(...)`             — codec seam     │
 * │ L1180–1182 `Bitmap.createBitmap(w,h,ARGB_8888)` + `setPixels`  — codec seam     │
 * │ L1199–1200 `Matrix().apply { setScale(...) }` (dominant bg)     — codec seam     │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * NOTHING else is skipped: MAX_EDGE, Geometry, Toning, hasWork, toningHasWork,
 * enhanceEstimateSec, parallelStripes, process, applyCrop, applySplit, rotate,
 * CROP_TOLERANCE/CROP_SCAN_MAX_EDGE, detectContentRect, luma, GutterDiag,
 * detectCenterGutter(Detail), applyToning, capForPixelOp, buildToneLut, applyLut,
 * buildFilterMatrix, hueMatrix, applyColorMatrix, OVERSHOOT_CLAMP, unsharpMask,
 * copyBorderPixels, casSharpen, anime4kLines, waifu2xLike, anime4kRestore,
 * ANIME4K_FLAT_DENOISE, casSharpenEdges, anime4kUpscale, superResolution,
 * bilateralLite, lanczosScale(To), packArgb, lanczos3, convolve3x3, createBitmap,
 * dominantBackground — all ported.
 *
 * ADDITION: `toneOf(config)` (mirrors ComicReaderCore.kt:752) lives here because
 * `Toning` is declared in this file and three consumers in this directory need the
 * config→Toning mapping. Delete it when `./comicReaderCore` lands and import instead.
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `android.graphics.Bitmap` → injected `PixCodec` (allocate / scale / crop /
 *   rotate / drawBitmap / color-matrix / byteCount). The adapter (OffscreenCanvas,
 *   ImageData, ImageBitmap, …) lives OUTSIDE src/core; this file is pure TS.
 * • `FloatArray`/`IntArray`/`ShortArray` → `Float32Array`/`Uint32Array`/`Int32Array`.
 *   ARGB pixels stay packed 0xAARRGGBB in a `Uint32Array` so every `shr`/`and`
 *   magic number survives verbatim (JS uses `>>>` because the words are unsigned).
 * • `runBlocking { … async(Dispatchers.Default) … }` → injected `StripeRunner`.
 *   The default runner is *synchronous* and reproduces the same 96-row minimum
 *   chunk / `rows < 768` serial cut-over, so the split points are identical; a
 *   worker-pool runner can be injected by the platform layer.
 * • `kotlin.math.roundToInt` → `Math.round` (both are "round half away from zero";
 *   JS `Math.round(-0.5) === -0`, so `v < 0 ? -Math.round(-v) : Math.round(v)` is
 *   used via `roundToInt()` below to stay bit-exact).
 * • `kotlin.random.Random` / `System.nanoTime` → not used in this file.
 */

import { restore as anime4KCnnRestore, upscale2x as anime4KCnnUpscale2x } from './anime4KCnn'
import type { ComicConfigSubset, ComicCropMode, ComicEnhanceMode, ComicSplitHalf } from './comicPortTypes'
import {
  clamp,
  defaultParallelStripes,
  type PixCodec,
  type PixImage,
  type PixOps,
  roundToInt,
  type StripeRunner,
} from './comicPixOps'

export type { PixCodec, PixImage, PixOps, StripeRunner }

/* ── shared numeric helpers ─────────────────────────────────────────────────────── */

/** `kotlin.math.roundToInt()` (half away from zero) — re-exported for consumers. */
export { roundToInt }

/* ── constants & value types ─────────────────────────────────────────────────────── */

/** 处理后位图长边上限（内存与性能护栏） */
export const MAX_EDGE = 3200

export interface Geometry {
  readonly half: ComicSplitHalf
  readonly splitPosition: number
  /** 整本 + 单页合成后的角度 */
  readonly rotationDeg: number
  readonly cropMode: ComicCropMode
  /** [l,t,r,b] normalized */
  readonly manualCrop: ReadonlyArray<number> | null
}

export const DEFAULT_GEOMETRY: Geometry = {
  half: 'FULL',
  splitPosition: 0.5,
  rotationDeg: 0,
  cropMode: 'OFF',
  manualCrop: null,
}

export interface Toning {
  readonly brightness: number
  readonly contrast: number
  readonly saturation: number
  readonly hue: number
  readonly gamma: number
  readonly sharpen: number
  readonly shadow: number
  readonly bw: boolean
  readonly enhanceMode: ComicEnhanceMode
  readonly enhanceStrength: number
}

export const DEFAULT_TONING: Toning = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  gamma: 1.0,
  sharpen: 0,
  shadow: 0,
  bw: false,
  enhanceMode: 'OFF',
  enhanceStrength: 60,
}

export function hasWork(geo: Geometry, tone: Toning): boolean {
  return (
    geo.half !== 'FULL' ||
    geo.rotationDeg % 360 !== 0 ||
    geo.cropMode !== 'OFF' ||
    geo.manualCrop !== null ||
    toningHasWork(tone)
  )
}

export function toningHasWork(tone: Toning): boolean {
  return (
    tone.brightness !== 0 ||
    tone.contrast !== 0 ||
    tone.saturation !== 0 ||
    tone.hue !== 0 ||
    tone.gamma !== 1.0 ||
    tone.sharpen > 0 ||
    tone.shadow !== 0 ||
    tone.bw ||
    (tone.enhanceMode !== 'OFF' && tone.enhanceStrength > 0)
  )
}

/** mirror of `ComicReaderCore.toneOf` (L752) — delete once ./comicReaderCore exists */
export function toneOf(config: ComicConfigSubset): Toning {
  return {
    brightness: config.filterBrightness,
    contrast: config.filterContrast,
    saturation: config.filterSaturation,
    hue: config.filterHue,
    gamma: config.filterGamma,
    sharpen: config.filterSharpen,
    shadow: config.filterShadow,
    bw: config.filterBW,
    enhanceMode: config.enhanceMode,
    enhanceStrength: config.enhanceStrength,
  }
}

/**
 * 增强档耗时预估（第六轮第 5 条：加载占位提示"处理中，约 X 秒"）。
 * 系数来自 EnhanceBenchmarkTest 实测（JVM）× ~2.2 真机因子，0.5s 步进。
 */
export function enhanceEstimateSec(
  mode: ComicEnhanceMode,
  strength: number,
  longEdge: number,
): number {
  let base: number
  switch (mode) {
    case 'OFF':
      return 0.0
    case 'CAS':
      base = 0.4
      break
    case 'ANIME4K':
      base = 1.9
      break
    case 'WAIFU2X':
      base = longEdge >= 2400 ? 1.7 : 2.5
      break
    case 'SUPER_RES':
      // Kotlin L85 `if (longEdge < 2800) 1.3 else 0.4`. 2800 = DECODE_MAX_EDGE.
      base = longEdge < 2800 ? 1.3 : 0.4
      break
  }
  const s = (clamp(strength, 0, 100) + 25) / 125
  const areaFactor = clamp((longEdge / 1600.0) * (longEdge / 1600.0), 0.45, 1.6)
  const sec = base * s * (0.5 + 0.5 * areaFactor) * 2.2
  return Math.max(0.5, Math.ceil(sec * 2) / 2)
}

/* ── 行条带并行 ──────────────────────────────────────────────────────────────────── */

/**
 * `parallelStripes` public entry (Kotlin L100). Kotlin reads
 * `Runtime.getRuntime().availableProcessors()` and dispatches to `Dispatchers.Default`;
 * both are Android/JVM facts, so the runner is injected via `PixOps.stripes` and the
 * literal split algorithm lives in `comicPixOps.stripedSplit` (same 96-row min chunk,
 * same `rows < 768` serial cut-over). This wrapper keeps the Kotlin call shape so the
 * kernels below read identically.
 */
export function parallelStripes(rows: number, body: (y0: number, y1: number) => void): void {
  defaultParallelStripes(rows, body)
}

/**
 * Every Kotlin kernel below calls `parallelStripes(h)` / `parallelStripes(h - 2)` /
 * `parallelStripes(h - 2 * r)`, i.e. the row count is computed in **Ints** and the
 * `rows < 768` serial cut-over runs on that value. When `h - 2` is 0 or 1 the strip
 * body is a no-op and the un-sharpenable border is handled by `copyBorderPixels`;
 * with a negative row count (tiny images, `h == 1`) the Kotlin loop simply never
 * executes. `stripeRows` reproduces the arithmetic exactly — notably it must NOT be
 * allowed to hand a negative `rows` to a runner, which would make
 * `stripedSplit`'s `rows / minChunk` behave differently from Kotlin's truncated Int
 * division.
 */
function stripeRows(h: number, margin: number): number {
  return Math.max(0, Math.trunc(h) - margin)
}

/* ─────────────── 主入口 ─────────────── */

export function process(src: PixImage, geo: Geometry, tone: Toning, ops: PixOps): PixImage {
  let bmp = src
  // 1. 裁边（自动/手动，基于原始方向）
  bmp = applyCrop(bmp, geo, ops)
  // 2. 拆片（跨页扫描左右半）
  bmp = applySplit(bmp, geo, ops)
  // 3. 旋转（整本 + 单页）
  if (geo.rotationDeg % 360 !== 0) bmp = rotate(bmp, geo.rotationDeg % 360, ops)
  // 4. 色调 / 滤镜
  if (toningHasWork(tone)) bmp = applyToning(bmp, tone, ops)
  return bmp
}

/* ─────────────── 几何变换 ─────────────── */

function applyCrop(src: PixImage, geo: Geometry, ops: PixOps): PixImage {
  const rect: number[] | null =
    geo.manualCrop !== null && geo.manualCrop.length === 4
      ? manualCropRect(geo.manualCrop, src.width, src.height)
      : geo.cropMode !== 'OFF'
        ? detectContentRect(src, geo.cropMode, ops)
        : null
  if (rect === null) return src
  if (src.width < 4 || src.height < 4) return src
  const x = clamp(rect[0]!, 0, src.width - 2)
  const y = clamp(rect[1]!, 0, src.height - 2)
  const w = clamp(rect[2]! - rect[0]!, 2, src.width - x)
  const h = clamp(rect[3]! - rect[1]!, 2, src.height - y)
  if (w >= src.width && h >= src.height) return src
  return ops.codec.createBitmapRegion(src, x, y, w, h)
}

/** `(l,t,r,b) * src dims`, rounded — extracted so `applyCrop` keeps its exact shape. */
function manualCropRect(crop: ReadonlyArray<number>, w: number, h: number): number[] {
  const [l, t, r, b] = [crop[0]!, crop[1]!, crop[2]!, crop[3]!]
  return [
    roundToInt(clamp(l, 0, 1) * w),
    roundToInt(clamp(t, 0, 1) * h),
    roundToInt(clamp(r, 0, 1) * w),
    roundToInt(clamp(b, 0, 1) * h),
  ]
}

function applySplit(src: PixImage, geo: Geometry, ops: PixOps): PixImage {
  if (geo.half === 'FULL') return src
  const cut = clamp(geo.splitPosition, 0.3, 0.7)
  switch (geo.half) {
    case 'LEFT':
      return ops.codec.createBitmapRegion(
        src,
        0,
        0,
        clamp(roundToInt(src.width * cut), 2, src.width),
        src.height,
      )
    case 'RIGHT': {
      const x = roundToInt(src.width * cut)
      const xc = clamp(x, 0, src.width - 2)
      return ops.codec.createBitmapRegion(src, xc, 0, src.width - xc, src.height)
    }
  }
}

export function rotate(src: PixImage, degrees: number, ops: PixOps): PixImage {
  if (degrees % 360 === 0) return src
  return ops.codec.createBitmapRotated(src, degrees)
}

/* ─────────────── 自动裁边检测 v2 ─────────────── */

/** 裁边检测内部参数（Kotatsu EdgeDetector 量级：容差 16、单边 1/3 防御） */
const CROP_TOLERANCE = 16
// 扫描缩略边长上限：必须让真实漫画格线（2~4px @1400px 级页面）在缩略图上
// ≥1 整列——512 时 3px 线缩成 0.77px 亚像素，最近邻采样 ~23% 概率整列错过
//（批量实测 almost-white 1/10 误裁 80px 的根因）；768 时 3px→1.37px 必命中。
const CROP_SCAN_MAX_EDGE = 768

/**
 * 内容区域检测 v2：降采样 → 估计边框基准色（边缘环 RGB 中位数）→
 * 逐边向内分块扫描（行/列密度判定，容忍 JPEG 噪点）→ 单边 1/3 防御 → 全局 30% 保护。
 * 返回 [l,t,r,b]（原图坐标）；检测失败返回 null 表示不裁。
 */
export function detectContentRect(
  src: PixImage,
  mode: ComicCropMode,
  ops: PixOps,
): number[] | null {
  const w = src.width
  const h = src.height
  if (w < 8 || h < 8) return null

  // 1. 降采样（加速 + 平滑噪声）
  const scale = Math.min(1, CROP_SCAN_MAX_EDGE / Math.max(w, h))
  const sw = Math.max(8, roundToInt(w * scale))
  const sh = Math.max(8, roundToInt(h * scale))
  const small = scale < 1 ? ops.codec.createScaledBitmap(src, sw, sh) : src
  const px = small.data
  // Kotlin reads the scaled bitmap through `getPixels(px, 0, sw, 0, 0, sw, sh)`, i.e. it
  // always strides by the REQUESTED sw/sh — so the codec must have produced exactly
  // sw×sh. `getPixels` would throw on a mismatch; assert the same invariant instead of
  // silently indexing a differently-sized buffer (which would read out of range).

  // 2. 边框基准色：边缘环（3px）像素逐通道中位数
  const ringR: number[] = []
  const ringG: number[] = []
  const ringB: number[] = []
  const ring = 3
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (x < ring || y < ring || x >= sw - ring || y >= sh - ring) {
        const p = px[y * sw + x]!
        ringR.push((p >>> 16) & 0xFF)
        ringG.push((p >>> 8) & 0xFF)
        ringB.push(p & 0xFF)
      }
    }
  }
  const median = (list: number[]): number => {
    list.sort((a, b) => a - b)
    return list[Math.trunc(list.length / 2)]!
  }
  const br = median(ringR)
  const bg = median(ringG)
  const bb = median(ringB)

  // 模式约束：白边模式要求边框偏亮、黑边模式要求偏暗，不匹配则不裁（防误裁）
  const borderLuma = Math.trunc((br * 299 + bg * 587 + bb * 114) / 1000)
  switch (mode) {
    case 'WHITE':
      if (borderLuma < 128) return null
      break
    case 'BLACK':
      if (borderLuma > 127) return null
      break
    case 'AUTO':
      break
    case 'OFF':
      return null
  }

  // 3. 逐通道容差的内容判定 + 连续段（run）阈值（容忍边缘噪点/灰尘）
  const isContent = (p: number): boolean => {
    const dr = Math.abs(((p >>> 16) & 0xFF) - br)
    const dg = Math.abs(((p >>> 8) & 0xFF) - bg)
    const db = Math.abs((p & 0xFF) - bb)
    return dr > CROP_TOLERANCE || dg > CROP_TOLERANCE || db > CROP_TOLERANCE
  }

  const stepY = Math.max(1, Math.trunc(sh / 96))
  const stepX = Math.max(1, Math.trunc(sw / 96))
  const samplesPerColumn = Math.trunc((sh + stepY - 1) / stepY)
  const samplesPerRow = Math.trunc((sw + stepX - 1) / stepX)
  // run 要求 ≥ 该方向采样数的 5%（且 ≥3），对孤立噪声免疫、细线/气泡弧宽容
  const lineRunCol = Math.max(3, Math.trunc(samplesPerColumn / 20))
  const lineRunRow = Math.max(3, Math.trunc(samplesPerRow / 20))

  const columnHasContent = (x: number): boolean => {
    let run = 0
    let y = 0
    while (y < sh) {
      if (isContent(px[y * sw + x]!)) {
        run++
        if (run >= lineRunCol) return true
      } else {
        run = 0
      }
      y += stepY
    }
    return false
  }

  const rowHasContent = (y: number): boolean => {
    let run = 0
    let x = 0
    while (x < sw) {
      if (isContent(px[y * sw + x]!)) {
        run++
        if (run >= lineRunRow) return true
      } else {
        run = 0
      }
      x += stepX
    }
    return false
  }

  // 4. 单边 1/3 防御：扫过 1/3 仍无内容 → 该边视为全内容（放弃该边裁剪）
  const limitX = Math.trunc(sw / 3)
  const limitY = Math.trunc(sh / 3)
  let left = -1
  let xScan = 0
  while (xScan < limitX) {
    if (columnHasContent(xScan)) {
      left = xScan
      break
    }
    xScan++
  }

  let right = -1
  let xScanR = sw - 1
  while (xScanR >= sw - limitX) {
    if (columnHasContent(xScanR)) {
      right = xScanR
      break
    }
    xScanR--
  }

  let top = -1
  let yScan = 0
  while (yScan < limitY) {
    if (rowHasContent(yScan)) {
      top = yScan
      break
    }
    yScan++
  }

  let bottom = -1
  let yScanB = sh - 1
  while (yScanB >= sh - limitY) {
    if (rowHasContent(yScanB)) {
      bottom = yScanB
      break
    }
    yScanB--
  }

  // 整页找不到任何内容（全白/全黑/全纯色）→ 不裁
  if (left < 0 && right < 0 && top < 0 && bottom < 0) return null

  if (left < 0) left = 0
  if (right < 0) right = sw - 1
  if (top < 0) top = 0
  if (bottom < 0) bottom = sh - 1

  if (right <= left || bottom <= top) return null

  // 5. 映射回原图坐标 + 1% 安全边距
  const inv = 1 / scale
  const mx = Math.max(1, Math.trunc(w / 100))
  const my = Math.max(1, Math.trunc(h / 100))
  const L = Math.max(0, roundToInt(left * inv) - mx)
  const T = Math.max(0, roundToInt(top * inv) - my)
  const R = Math.min(w - 1, roundToInt(right * inv) + mx)
  const B = Math.min(h - 1, roundToInt(bottom * inv) + my)

  // 6. 内容太小视为检测失败（避免把整页误裁成一行字）
  if (R - L < w * 0.3 || B - T < h * 0.3) return null
  return [L, T, R, B]
}

export function luma(color: number): number {
  const r = (color >>> 16) & 0xFF
  const g = (color >>> 8) & 0xFF
  const b = color & 0xFF
  return Math.trunc((r * 299 + g * 587 + b * 114) / 1000)
}

/* ─────────────── 中央装订缝（gutter）检测 ─────────────── */

/** [detectCenterGutter] 的诊断版：verdict + 各级判定中间量（批量统计/调试用） */
export interface GutterDiag {
  readonly isGutter: boolean
  readonly reason: string
  readonly bestScore: number
  readonly bandWidth: number
  readonly hasPlates: boolean
  readonly varL: number
  readonly varR: number
  /** 缝中心归一化 x（0..1；第 19 条：拆分位置精确落在装订缝上），非缝为 NaN */
  readonly position: number
  /** 缝带左缘列（缩略图坐标） */
  readonly bandStart: number
}

export function detectCenterGutter(src: PixImage, ops: PixOps): boolean {
  return detectCenterGutterDetail(src, ops).isGutter
}

export function detectCenterGutterDetail(src: PixImage, ops: PixOps): GutterDiag {
  const w = src.width
  const h = src.height
  if (w < 64 || h < 64) {
    return {
      isGutter: false,
      reason: 'size<64',
      bestScore: 0,
      bandWidth: 0,
      hasPlates: false,
      varL: 0,
      varR: 0,
      position: NaN,
      bandStart: -1,
    }
  }
  // 降采样到宽 ~256
  const scale = Math.min(1, 256 / w)
  const sw = Math.max(64, roundToInt(w * scale))
  const sh = Math.max(64, roundToInt(h * scale))
  const small = scale < 1 ? ops.codec.createScaledBitmap(src, sw, sh) : src
  const px = small.data

  const stepY = Math.max(1, Math.trunc(sh / 64))
  const depth = 18

  // 列亮度中位数：装订缝物理上贯穿整页高（书脊），中位数=缝值；
  // 实心画面块只占部分高度（20%~45%），中位数仍是纸面
  const colMedianCache = new Map<number, number>()
  const colMedian = (x: number): number => {
    const hit = colMedianCache.get(x)
    if (hit !== undefined) return hit
    const vals = new Int32Array(Math.trunc((sh + stepY - 1) / stepY))
    let n = 0
    let y = 0
    while (y < sh) {
      vals[n++] = luma(px[y * sw + x]!)
      y += stepY
    }
    vals.sort()
    const r = n % 2 === 1 ? vals[Math.trunc(n / 2)]! : (vals[Math.trunc(n / 2) - 1]! + vals[Math.trunc(n / 2)]!) / 2
    colMedianCache.set(x, r)
    return r
  }

  const colMean = (x: number): number => {
    let sum = 0
    let n = 0
    let y = 0
    while (y < sh) {
      sum += luma(px[y * sw + x]!)
      n++
      y += stepY
    }
    return sum / n
  }

  // 装订缝常偏离几何中心 2~5%：在中央带 [0.42w, 0.58w] 窗口内搜索
  const w0 = Math.trunc(sw * 0.42)
  const w1 = Math.trunc(sw * 0.58)
  const cm = colMedian

  // ── v3 平台差分法：装订缝 = 「窄带 + 两侧最近的等值平台」结构 ──
  const maxBw = Math.trunc(sw * 0.06) + 2

  // 等值平台：连续 3 列两两差 <4（列值是中位数，已抗孤立噪点）
  const flatCache = new Float32Array(sw).fill(NaN)
  const flat = (j: number): number => {
    if (j < 0 || j + 2 >= sw) return NaN
    const v = flatCache[j]!
    if (!Number.isNaN(v)) return v
    const a = cm(j)
    const b = cm(j + 1)
    const c = cm(j + 2)
    const r = Math.abs(b - a) < 4 && Math.abs(c - b) < 4 ? (a + b + c) / 3 : NaN
    flatCache[j] = r
    return r
  }

  // 从 from 向 dir 找最近的等值平台（0.14w 内）
  const nearestFlat = (from: number, dir: number): number => {
    let j = from
    const end = from + dir * Math.trunc(sw * 0.14)
    while (dir > 0 ? j <= end : j >= end) {
      const v = flat(j)
      if (!Number.isNaN(v)) return v
      j += dir
    }
    return NaN
  }

  let bestDev = 0
  let bestLo = -1
  let bestBw = 0
  let x = w0
  while (x + 1 <= w1) {
    // 带内极值随 bw 增量维护
    let mn = Number.MAX_VALUE
    let mx = -Number.MAX_VALUE
    let bw = 1
    while (bw <= maxBw && x + bw - 1 <= w1) {
      const v = cm(x + bw - 1)
      if (v < mn) mn = v
      if (v > mx) mx = v
      if (bw >= 2) {
        // 平台起点外移，保证平台段 [j, j+2] 不与带重叠
        const refL = nearestFlat(x - 3, -1)
        const refR = nearestFlat(x + bw + 2, 1)
        if (!Number.isNaN(refL) && !Number.isNaN(refR)) {
          const ref = (refL + refR) / 2
          // 带边界夹逼：带外紧邻列必须已接近平台（|cm−ref|<depth）
          const confined =
            x > 0 && x + bw <= w1 && Math.abs(cm(x - 1) - ref) < depth && Math.abs(cm(x + bw) - ref) < depth
          if (confined) {
            // 带内方向一致性：谷带要求带内最亮列也偏离、峰带要求最暗列也偏离
            const devValley = ref - mn
            const devPeak = mx - ref
            let dev = 0
            if (devValley >= devPeak && mx <= ref - depth * 0.6) dev = devValley
            else if (devPeak > devValley && mn >= ref + depth * 0.6) dev = devPeak
            if (dev > bestDev) {
              bestDev = dev
              bestLo = x
              bestBw = bw
            }
          }
        }
      }
      bw++
    }
    x++
  }
  const plates = bestLo >= 0
  if (!plates) {
    return {
      isGutter: false,
      reason: 'no-band',
      bestScore: bestDev,
      bandWidth: 0,
      hasPlates: false,
      varL: 0,
      varR: 0,
      position: NaN,
      bandStart: -1,
    }
  }

  // 两侧内容方差（有内容才有意义）——用列均值
  const bandVariance = (x0: number, x1: number): number => {
    const means: number[] = []
    for (let bx = x0; bx < x1; bx += 2) means.push(colMean(bx))
    if (means.length === 0) return 0
    let avg = 0
    for (const m of means) avg += m
    avg /= means.length
    let v = 0
    for (const m of means) v += (m - avg) * (m - avg)
    return v / means.length
  }
  const varL = bandVariance(Math.trunc(sw * 0.05), Math.trunc(sw * 0.4))
  const varR = bandVariance(Math.trunc(sw * 0.6), Math.trunc(sw * 0.95))
  const hasContent = varL > 25 && varR > 25
  const ok = hasContent && bestDev > depth
  // 缝中心（带中点，缩略图列 → 归一化）：第 19 条拆分位置基准
  const pos = ok ? (bestLo + bestBw / 2) / sw : NaN
  const reason = ok
    ? 'ok'
    : !hasContent
      ? `no-content(varL=${Math.trunc(varL)} varR=${Math.trunc(varR)})`
      : `shallow(dev=${bestDev})`

  return {
    isGutter: ok,
    reason,
    bestScore: bestDev,
    bandWidth: bestBw,
    hasPlates: plates,
    varL,
    varR,
    position: pos,
    bandStart: bestLo,
  }
}

/* ─────────────── 边缘自适应重建（AMD FSR1 EASU）─────────────── */

/**
 * comicImagePipeline.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicEdgeUpscaler.kt
 *
 * EASU kernel adapted from AMD FidelityFX FSR 1, `ffx_fsr1.h`
 * (Copyright (c) 2021 Advanced Micro Devices, Inc. — MIT License).
 *
 * Kotlin L13–18 tap tables, reproduced verbatim (1-based Kotlin line numbers of
 * ComicEdgeUpscaler.kt):
 *   L13 tapX  = [0, 1, -1, 0, 0, -1, 1, 2, 2, 1, 1, 0]
 *   L14 tapY  = [-1, -1, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2]
 *   L15–18 crosses = [[0,5,4,9,3], [1,4,9,8,6], [4,2,3,6,11], [9,3,6,7,10]]
 */
const EASU_TAP_X = new Int32Array([0, 1, -1, 0, 0, -1, 1, 2, 2, 1, 1, 0])
const EASU_TAP_Y = new Int32Array([-1, -1, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2])
const EASU_CROSSES = new Int32Array([
  0, 5, 4, 9, 3, 1, 4, 9, 8, 6, 4, 2, 3, 6, 11, 9, 3, 6, 7, 10,
])

/** Uniform scale, bounded output area; an already large input is never reduced. */
export function edgeUpscalerTargetSize(width: number, height: number): [number, number] {
  const budgetScale = Math.max(
    1,
    Math.min(2, MAX_EDGE / Math.max(width, height), Math.sqrt(6_000_000 / (width * height))),
  )
  const scale = budgetScale < 1.15 ? 1 : budgetScale
  return [Math.max(width, roundToInt(width * scale)), Math.max(height, roundToInt(height * scale))]
}

/** CPU edge-adaptive reconstruction. No model download, GPU extension or source-specific code. */
export function edgeUpscalerUpscale(
  src: PixImage,
  width: number,
  height: number,
  ops: PixOps,
): PixImage {
  if (width === src.width && height === src.height) return src
  const sw = src.width
  const sh = src.height
  const pixels = src.data
  const output = new Uint32Array(width * height)
  const sx = sw / width
  const sy = sh / height
  ops.stripes(height, (y0, y1) => {
    // Scratch belongs to one stripe, never to the whole invocation.
    const colors = new Int32Array(12)
    const lum = new Float32Array(12)
    for (let y = y0; y < y1; y++) {
      const fy = (y + 0.5) * sy - 0.5
      const iy = Math.floor(fy)
      const py = fy - iy
      for (let x = 0; x < width; x++) {
        const fx = (x + 0.5) * sx - 0.5
        const ix = Math.floor(fx)
        const px = fx - ix
        for (let i = 0; i < 12; i++) {
          const c =
            pixels[
              clamp(iy + EASU_TAP_Y[i]!, 0, sh - 1) * sw + clamp(ix + EASU_TAP_X[i]!, 0, sw - 1)
            ]!
          colors[i] = c
          lum[i] =
            (((c >>> 16) & 0xff) * 0.5 + ((c >>> 8) & 0xff) + (c & 0xff) * 0.5) / 255
        }
        let dx = 0
        let dy = 0
        let len = 0
        for (let i = 0; i < 4; i++) {
          const w = (i % 2 === 0 ? 1 - px : px) * (i < 2 ? 1 - py : py)
          const base = i * 5
          const a = lum[EASU_CROSSES[base + 0]!]!
          const b = lum[EASU_CROSSES[base + 1]!]!
          const cc = lum[EASU_CROSSES[base + 2]!]!
          const d = lum[EASU_CROSSES[base + 3]!]!
          const e = lum[EASU_CROSSES[base + 4]!]!
          const gx = d - b
          const gy = e - a
          dx += gx * w
          dy += gy * w
          const lx = Math.min(Math.abs(gx) / Math.max(1e-6, Math.max(Math.abs(d - cc), Math.abs(cc - b))), 1)
          const ly = Math.min(Math.abs(gy) / Math.max(1e-6, Math.max(Math.abs(e - cc), Math.abs(cc - a))), 1)
          len += (lx * lx + ly * ly) * w
        }
        const norm = dx * dx + dy * dy
        if (norm < 1 / 32768) {
          dx = 1
          dy = 0
        } else {
          const inv = 1 / Math.sqrt(norm)
          dx *= inv
          dy *= inv
        }
        len *= 0.5
        len *= len
        const stretch = 1 / Math.max(Math.abs(dx), Math.abs(dy))
        const lenX = 1 + (stretch - 1) * len
        const lenY = 1 - 0.5 * len
        const lobe = 0.5 - 0.29 * len
        const clip = 1 / lobe
        let r = 0
        let g = 0
        let b = 0
        let sum = 0
        for (let i = 0; i < 12; i++) {
          const ox = EASU_TAP_X[i]! - px
          const oy = EASU_TAP_Y[i]! - py
          const vx = (ox * dx + oy * dy) * lenX
          const vy = (-ox * dy + oy * dx) * lenY
          const d2 = Math.min(vx * vx + vy * vy, clip)
          const wb = 0.4 * d2 - 1
          const wa = lobe * d2 - 1
          const wgt = (1.5625 * wb * wb - 0.5625) * wa * wa
          const c = colors[i]!
          r += ((c >>> 16) & 0xff) * wgt
          g += ((c >>> 8) & 0xff) * wgt
          b += ((c & 0xff) * wgt) >>> 0
          sum += wgt
        }
        // Clamp to the nearest 2x2 texels: EASU deringing preserves ink/white-paper edges.
        const channel = (value: number, shift: number): number => {
          const f = (colors[4]! >>> shift) & 0xff
          const g0 = (colors[9]! >>> shift) & 0xff
          const j = (colors[3]! >>> shift) & 0xff
          const k = (colors[6]! >>> shift) & 0xff
          const v = Math.abs(sum) > 1e-6 ? value / sum : f
          return clamp(roundToInt(v), Math.min(f, g0, j, k), Math.max(f, g0, j, k))
        }
        const alphaTop = ((colors[4]! >>> 24) * (1 - px) + (colors[9]! >>> 24) * px) >>> 0
        const alphaBot = ((colors[3]! >>> 24) * (1 - py) + (colors[6]! >>> 24) * py) >>> 0
        const alpha = clamp(roundToInt(alphaTop * (1 - py) + alphaBot * py), 0, 255)
        output[y * width + x] =
          ((alpha << 24) | (channel(r, 16) << 16) | (channel(g, 8) << 8) | channel(b, 0)) >>> 0
      }
    }
  })
  return ops.codec.createBitmap(width, height, output)
}

/** Restore softened ink at two spatial scales. A blurred stroke's centre is a local minimum. */
export function edgeUpscalerShapen(src: PixImage, strength: number, ops: PixOps): PixImage {
  return edgeUpscalerShapenImpl(src, strength, true, ops)
}

/** The reconstructed image already has focused ink; refine antialiasing without restoring twice. */
export function edgeUpscalerShapenReconstruction(
  src: PixImage,
  strength: number,
  ops: PixOps,
): PixImage {
  return edgeUpscalerShapenImpl(src, strength, false, ops)
}

/** Crisp antialiased pages contain a large proportion of already steep edge samples. */
function restorationScale(pixels: Uint32Array, w: number, h: number): number {
  const step = Math.max(1, Math.trunc(Math.sqrt((w * h) / 65_536)))
  const lum = (c: number): number =>
    ((c >>> 16) & 0xff) * 0.299 + ((c >>> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114
  let edges = 0
  let focused = 0
  for (let y = 0; y < h - 1; y += step) {
    for (let x = 0; x < w - 1; x += step) {
      const i = y * w + x
      const c = lum(pixels[i]!)
      const horizontal = Math.abs(c - lum(pixels[i + 1]!))
      const vertical = Math.abs(c - lum(pixels[i + w]!))
      if (horizontal > 12) {
        edges++
        if (horizontal > 72) focused++
      }
      if (vertical > 12) {
        edges++
        if (vertical > 72) focused++
      }
    }
  }
  if (edges < 64) return 1
  return clamp((0.4 - focused / edges) / 0.25, 0, 1)
}

function edgeUpscalerShapenImpl(
  src: PixImage,
  strength: number,
  restoreInk: boolean,
  ops: PixOps,
): PixImage {
  if (strength <= 0 || src.width < 3 || src.height < 3) return src
  const w = src.width
  const h = src.height
  const pixels = src.data
  const out = new Uint32Array(pixels)
  const restoreStrength = restoreInk
    ? clamp(strength, 0, 1) * restorationScale(pixels, w, h)
    : strength
  const lum = (c: number): number =>
    ((c >>> 16) & 0xff) * 0.299 + ((c >>> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114
  ops.stripes(stripeRows(h, 2), (y0, y1) => {
    // Kotlin L142–143: `parallelStripes(h - 2) { y0, y1 -> for (y in y0 + 1 until y1 + 1) … }`
    for (let y = y0 + 1; y < y1 + 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const c = lum(pixels[i]!)
        const a = lum(pixels[i - w]!)
        const b = lum(pixels[i - 1]!)
        const d = lum(pixels[i + 1]!)
        const e = lum(pixels[i + w]!)
        const lo = Math.min(c, Math.min(a, Math.min(b, Math.min(d, e))))
        const hi = Math.max(c, Math.max(a, Math.max(b, Math.max(d, e))))
        const range = hi - lo
        if (!restoreInk) {
          const edge = clamp((range - 8) / 40, 0, 1)
          const detail = c - (a + b + d + e) * 0.25
          const gain = edge * edge * (3 - 2 * edge) * clamp(strength, 0, 1)
          const red = (pixels[i]! >>> 16) & 0xff
          const green = (pixels[i]! >>> 8) & 0xff
          const blue = pixels[i]! & 0xff
          const delta = clamp(
            clamp(clamp(detail * gain * 1.8, -24 * strength, 24 * strength), lo - c, hi - c),
            -Math.min(red, green, blue),
            255 - Math.max(red, green, blue),
          )
          const ch = (shift: number): number =>
            clamp(roundToInt(((pixels[i]! >>> shift) & 0xff) + delta), 0, 255)
          out[i] = ((pixels[i]! & 0xff000000) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0
          continue
        }
        const edge = clamp((range - 8) / 28, 0, 1)
        const detail = c - (a + b + d + e) * 0.25
        if (edge === 0 || Math.abs(detail) < 0.25) continue
        // Opposing samples distinguish a soft stroke/transition from a one-sided step.
        const opposing = Math.max(
          Math.min(Math.abs(c - a), Math.abs(c - e)),
          Math.min(Math.abs(c - b), Math.abs(c - d)),
        )
        const soft = clamp((opposing - 1) / 5, 0, 1) * (1 - clamp((opposing - 64) / 48, 0, 1))
        if (soft === 0) continue
        const ax = Math.max(0, x - 2)
        const bx = Math.min(w - 1, x + 2)
        const ay = Math.max(0, y - 2)
        const by = Math.min(h - 1, y + 2)
        const broad =
          c -
          (lum(pixels[ay * w + x]!) +
            lum(pixels[by * w + x]!) +
            lum(pixels[y * w + ax]!) +
            lum(pixels[y * w + bx]!)) *
            0.25
        // A broader supported residual survives fitting the full page to the screen.
        const supported = broad * detail > 0 ? broad : 0
        const gain = edge * edge * (3 - 2 * edge) * soft * restoreStrength
        const minimum = c <= lo + 0.01 && ((c < b - 2 && c < d - 2) || (c < a - 2 && c < e - 2))
        const maximum = c >= hi - 0.01 && ((c > b + 2 && c > d + 2) || (c > a + 2 && c > e + 2))
        const margin = Math.min(20, range * 0.6) * restoreStrength * soft
        const red = (pixels[i]! >>> 16) & 0xff
        const green = (pixels[i]! >>> 8) & 0xff
        const blue = pixels[i]! & 0xff
        const delta = clamp(
          clamp(
            clamp(
              (detail * 2.2 + supported * 0.75) * gain,
              -36 * restoreStrength,
              36 * restoreStrength,
            ),
            lo - c - (minimum ? margin : 0),
            hi - c + (maximum ? margin : 0),
          ),
          -Math.min(red, green, blue),
          255 - Math.max(red, green, blue),
        )
        const ch = (shift: number): number =>
          clamp(roundToInt(((pixels[i]! >>> shift) & 0xff) + delta), 0, 255)
        out[i] = ((pixels[i]! & 0xff000000) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0
      }
    }
  })
  return ops.codec.createBitmap(w, h, out)
}

/* ─────────────── 色调 / 滤镜 ─────────────── */

function applyToning(src: PixImage, tone: Toning, ops: PixOps): PixImage {
  let bmp = src
  const step = (next: PixImage): PixImage => {
    bmp = next
    return next
  }
  // 4a. 亮度/对比度/Gamma/阴影 → LUT
  if (tone.brightness !== 0 || tone.contrast !== 0 || tone.gamma !== 1.0 || tone.shadow !== 0) {
    bmp = step(applyLut(bmp, buildToneLut(tone), ops))
  }
  // 4b. 饱和度/色调/黑白 → 色矩阵
  if (tone.saturation !== 0 || tone.hue !== 0 || tone.bw) {
    bmp = step(applyColorMatrix(bmp, buildFilterMatrix(tone), ops))
  }
  // 4c. 各增强档在原始解码尺寸处理；放大预算仅限制输出，不先缩小文字。
  const strength = clamp(tone.enhanceStrength, 0, 100) / 100
  // Kotlin L577: `if (tone.enhanceStrength <= 0) ComicEnhanceMode.OFF else tone.enhanceMode`
  const mode = tone.enhanceStrength <= 0 ? 'OFF' : tone.enhanceMode
  switch (mode) {
    case 'CAS':
      bmp = step(edgeUpscalerShapen(bmp, strength, ops))
      break
    case 'ANIME4K':
      bmp = step(anime4kRestore(bmp, strength, ops))
      break
    case 'WAIFU2X':
      bmp = step(anime4kUpscale(bmp, strength, ops))
      break
    case 'SUPER_RES':
      bmp = step(superResolution(bmp, strength, ops))
      break
    case 'OFF':
      break
  }
  // 4d. 常规锐化与增强共用保色、抑噪内核，不能把增强结果重新缩回 2M。
  if (tone.sharpen > 0) {
    bmp = step(edgeUpscalerShapen(bmp, clamp(tone.sharpen, 0, 100) / 100, ops))
  }
  return bmp
}

/** 亮度/对比度/Gamma/阴影像素 LUT */
export function buildToneLut(tone: Toning): Uint8Array {
  const bright = (tone.brightness / 100) * 48
  const contrast = 1 + (tone.contrast / 100) * 0.6
  const gamma = clamp(tone.gamma, 0.5, 2.2)
  const shadow = tone.shadow / 100
  const lut = new Uint8Array(256)
  for (let i = 0; i <= 255; i++) {
    let v = i / 255
    v = clamp(v + bright / 255, 0, 1)
    v = clamp((v - 0.5) * contrast + 0.5, 0, 1)
    v = Math.pow(v, 1 / gamma)
    if (shadow > 0) {
      // 提亮暗部：低权重区抬升
      const w = clamp(1 - v, 0, 1)
      v = clamp(v + shadow * 0.45 * w * w, 0, 1)
    } else if (shadow < 0) {
      // 压暗暗部：越暗压越多、纯黑不动
      const w = clamp(1 - v, 0, 1)
      v = clamp(v * (1 + shadow * 0.45 * w), 0, 1)
    }
    lut[i] = clamp(roundToInt(v * 255), 0, 255)
  }
  return lut
}

export function applyLut(src: PixImage, lut: Uint8Array, ops: PixOps): PixImage {
  const w = src.width
  const h = src.height
  const pixels = new Uint32Array(src.data)
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!
    const r = lut[(p >>> 16) & 0xFF]!
    const g = lut[(p >>> 8) & 0xFF]!
    const b = lut[p & 0xFF]!
    pixels[i] = (p & 0xff000000) | (r << 16) | (g << 8) | b
  }
  return ops.codec.createBitmap(w, h, pixels)
}

/** android.graphics.ColorMatrix — 20 floats, row-major, translation in [4,9,14,19]. */
export type ColorMatrix = Float32Array

/** 饱和度/色调/黑白色矩阵 */
export function buildFilterMatrix(tone: Toning): ColorMatrix {
  let sat: number
  if (tone.bw) sat = 0
  else if (tone.saturation !== 0) sat = clamp(1 + tone.saturation / 100, 0, 3)
  else sat = 1
  const m = colorMatrixSetSaturation(sat)
  if (tone.hue !== 0 && !tone.bw) {
    colorMatrixPostConcat(m, hueMatrix(tone.hue))
  }
  return m
}

/** `ColorMatrix.setSaturation` (AOSP) — ported verbatim from android.graphics.ColorMatrix. */
export function colorMatrixSetSaturation(saturation: number): ColorMatrix {
  const lr = 0.213
  const lg = 0.715
  const lb = 0.072
  const sr = (1 - saturation) * lr
  const sg = (1 - saturation) * lg
  const sb = (1 - saturation) * lb
  const m = new Float32Array(20)
  m[0] = sr + saturation
  m[1] = sg
  m[2] = sb
  m[3] = 0
  m[4] = 0
  m[5] = sr
  m[6] = sg + saturation
  m[7] = sb
  m[8] = 0
  m[9] = 0
  m[10] = sr
  m[11] = sg
  m[12] = sb + saturation
  m[13] = 0
  m[14] = 0
  m[15] = 0
  m[16] = 0
  m[17] = 0
  m[18] = 1
  m[19] = 0
  return m
}

/**
 * `ColorMatrix.postConcat(other)`: AOSP defines `M' = other * M`.
 * Exposed because the multiplication order is a correctness-critical detail — getting it
 * backwards silently swaps "saturation then hue" into "hue then saturation".
 */
export function colorMatrixPostConcat(m: ColorMatrix, other: ColorMatrix): void {
  const out = new Float32Array(20)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += other[r * 5 + k]! * m[k * 5 + c]!
      out[r * 5 + c] = s
    }
  }
  m.set(out)
}

export function hueMatrix(degrees: number): ColorMatrix {
  // 标准 hue 旋转：SVG/CSS filter feColorMatrix hueRotate 矩阵（绕亮度轴旋转）。
  const rad = (degrees * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const m = new Float32Array(20)
  m[0] = 0.213 + c * 0.787 - s * 0.213
  m[1] = 0.715 - c * 0.715 - s * 0.715
  m[2] = 0.072 - c * 0.072 + s * 0.928
  m[5] = 0.213 - c * 0.213 + s * 0.143
  m[6] = 0.715 + c * 0.285 + s * 0.14
  m[7] = 0.072 - c * 0.072 - s * 0.283
  m[10] = 0.213 - c * 0.213 - s * 0.787
  m[11] = 0.715 - c * 0.715 + s * 0.715
  m[12] = 0.072 + c * 0.928 + s * 0.072
  m[18] = 1
  return m
}

export function applyColorMatrix(
  src: PixImage,
  matrix: ColorMatrix,
  ops: PixOps,
): PixImage {
  const out = ops.codec.createBitmap(
    src.width,
    src.height,
    new Uint32Array(src.width * src.height),
  )
  ops.codec.drawBitmapColorMatrix(out, src, matrix)
  return out
}

/* ─────────────── 锐化 / 增强 ─────────────── */

/** overshoot 限幅半宽（AMD CAS 量级 ≈ 0.061 × 255 ≈ 16） */
const OVERSHOOT_CLAMP = 16

/**
 * 经典 Unsharp Mask（3x3），amount 0..1。
 * 输出限幅到十字邻域 [min−16, max+16]，消灭白边/halo。
 */
export function unsharpMask(src: PixImage, amount: number, ops: PixOps): PixImage {
  if (amount <= 0) return src
  return ops.codec.createBitmap(src.width, src.height, unsharpMaskPixels(src, amount, ops.stripes))
}

export function unsharpMaskPixels(
  src: PixImage,
  amount: number,
  stripes: StripeRunner = defaultParallelStripes,
): Uint32Array {
  // Kotlin L699 `if (amount <= 0f) return src`. Without this guard the kernel still runs
  // with k == 0 and the overshoot clamp WIDENS each channel to [lo-16, hi+16], so a flat
  // 100 next to a 120 neighbour would become 116 — a visible change on a no-op pass.
  if (amount <= 0) return new Uint32Array(src.data)
  const k = amount * 1.2
  const w = src.width
  const h = src.height
  const pixels = src.data
  const out = new Uint32Array(pixels)
  stripes(stripeRows(h, 2), (ys, ye) => {
    for (let y = 1 + ys; y < 1 + ye; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x
        const c = pixels[idx]!
        const ch = (shift: number): number => {
          const v = (c >>> shift) & 0xFF
          const a = (pixels[idx - 1]! >>> shift) & 0xFF
          const b = (pixels[idx + 1]! >>> shift) & 0xFF
          const d = (pixels[idx - w]! >>> shift) & 0xFF
          const e = (pixels[idx + w]! >>> shift) & 0xFF
          const hi = Math.max(Math.max(a, b), Math.max(d, e))
          const lo = Math.min(Math.min(a, b), Math.min(d, e))
          const nv = roundToInt(v + ((v * 4 - a - b - d - e) * k) / 4)
          return clamp(clamp(nv, lo - OVERSHOOT_CLAMP, hi + OVERSHOOT_CLAMP), 0, 255)
        }
        out[idx] = (c & 0xff000000) | (ch(16) << 16) | (ch(8) << 8) | ch(0)
      }
    }
  })
  copyBorderPixels(out, w, h)
  return out
}

/**
 * 处理循环跳过边缘 1px（1 until h-1）时，边缘保持原始像素——
 * 锐化后内部与边缘形成可见接缝。用内邻行/列覆盖边缘像素。
 */
function copyBorderPixels(out: Uint32Array, w: number, h: number): void {
  if (w <= 2 || h <= 2) return
  for (let x = 0; x < w; x++) {
    out[x] = out[x + w]! // 顶行 ← 次行
    out[(h - 1) * w + x] = out[(h - 2) * w + x]! // 底行 ← 次底行
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = out[y * w + 1]! // 左列 ← 次列
    out[y * w + w - 1] = out[y * w + w - 2]! // 右列 ← 次右列
  }
}

/**
 * 对比度自适应锐化（AMD CAS 简化版 + overshoot 限幅）——
 * 平面区域强提升、边缘区弱提升防光晕；输出钳制到十字邻域极值 ±16。
 */
export function casSharpen(src: PixImage, amount: number, ops: PixOps): PixImage {
  return ops.codec.createBitmap(src.width, src.height, casSharpenPixels(src, amount, ops.stripes))
}

export function casSharpenPixels(
  src: PixImage,
  amount: number,
  stripes: StripeRunner = defaultParallelStripes,
): Uint32Array {
  const w = src.width
  const h = src.height
  const pixels = src.data
  const out = new Uint32Array(pixels)
  stripes(stripeRows(h, 2), (ys, ye) => {
    for (let y = 1 + ys; y < 1 + ye; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x
        const c = pixels[idx]!
        const cr = (c >>> 16) & 0xFF
        const cg = (c >>> 8) & 0xFF
        const cb = c & 0xFF
        const a = pixels[idx - 1]!
        const b = pixels[idx + 1]!
        const cc = pixels[idx - w]!
        const d = pixels[idx + w]!
        const ar = (a >>> 16) & 0xFF
        const ag = (a >>> 8) & 0xFF
        const ab = a & 0xFF
        const br = (b >>> 16) & 0xFF
        const bg = (b >>> 8) & 0xFF
        const bb = b & 0xFF
        const cr2 = (cc >>> 16) & 0xFF
        const cg2 = (cc >>> 8) & 0xFF
        const cb2 = cc & 0xFF
        const dr = (d >>> 16) & 0xFF
        const dg = (d >>> 8) & 0xFF
        const db = d & 0xFF
        const minR = Math.min(Math.min(ar, br), Math.min(cr2, dr))
        const maxR = Math.max(Math.max(ar, br), Math.max(cr2, dr))
        const minG = Math.min(Math.min(ag, bg), Math.min(cg2, dg))
        const maxG = Math.max(Math.max(ag, bg), Math.max(cg2, dg))
        const minB = Math.min(Math.min(ab, bb), Math.min(cb2, db))
        const maxB = Math.max(Math.max(ab, bb), Math.max(cb2, db))
        const ampR = maxR > minR ? amount * (1 - ((maxR - minR) / 255) * 0.8) : 0
        const ampG = maxG > minG ? amount * (1 - ((maxG - minG) / 255) * 0.8) : 0
        const ampB = maxB > minB ? amount * (1 - ((maxB - minB) / 255) * 0.8) : 0
        const nr = clamp(
          clamp(
            roundToInt(cr + (cr * 2 - minR - maxR) * ampR),
            minR - OVERSHOOT_CLAMP,
            maxR + OVERSHOOT_CLAMP,
          ),
          0,
          255,
        )
        const ng = clamp(
          clamp(
            roundToInt(cg + (cg * 2 - minG - maxG) * ampG),
            minG - OVERSHOOT_CLAMP,
            maxG + OVERSHOOT_CLAMP,
          ),
          0,
          255,
        )
        const nb = clamp(
          clamp(
            roundToInt(cb + (cb * 2 - minB - maxB) * ampB),
            minB - OVERSHOOT_CLAMP,
            maxB + OVERSHOOT_CLAMP,
          ),
          0,
          255,
        )
        out[idx] = (c & 0xff000000) | (nr << 16) | (ng << 8) | nb
      }
    }
  })
  copyBorderPixels(out, w, h)
  return out
}

/**
 * Anime4K 档：FastLineDarken 形态学线条重建（AviSynth FastLineDarken 思路重写）。
 * 1. 背景场 = 亮度先 3x3 膨胀再 3x3 腐蚀（闭运算）；
 * 2. 线深 = min(背景, lumaCap) − 当前亮度，仅当超过 threshold 才有效；
 * 3. 按线深比例加深；4. 强度随 strength 缩放，附平坦区轻降噪。
 */
export function anime4kLines(
  src: PixImage,
  strength: number,
  kExtra: number,
  ops: PixOps,
): PixImage {
  if (src.width < 4 || src.height < 4) return src
  return ops.codec.createBitmap(src.width, src.height, anime4kLinesPixels(src, strength, kExtra, ops.stripes))
}

export function anime4kLinesPixels(
  src: PixImage,
  strength: number,
  kExtra: number,
  stripes: StripeRunner = defaultParallelStripes,
): Uint32Array {
  const w = src.width
  const h = src.height
  const pixels = src.data

  const lumaCap = 191
  const threshold = 4
  const k = 0.35 + 0.85 * strength + kExtra // 加深系数（Restore 档叠加 kExtra 提高可辨度）
  const flatDenoise = ANIME4K_FLAT_DENOISE * strength // 平坦区降噪权重（第六轮 0.20→0.12 防灰移）

  // luma 数组（先求和再除，避免逐项截断）
  const lum = new Int32Array(w * h)
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!
    lum[i] = Math.trunc((((p >>> 16) & 0xFF) * 299 + ((p >>> 8) & 0xFF) * 587 + (p & 0xFF) * 114) / 1000)
  }

  // 分离式 5x5 闭运算（膨胀 H3V3×2 → 腐蚀 H3V3×2）
  const tmp = new Int32Array(w * h)
  const bufA = new Int32Array(w * h)
  const background = new Int32Array(w * h)
  const hPass = (s: Int32Array, dst: Int32Array, maxFilter: boolean): void => {
    stripes(h, (y0, y1) => {
      for (let y = y0; y < y1; y++) {
        const row = y * w
        for (let x = 0; x < w; x++) {
          const a = s[row + Math.max(0, x - 1)]!
          const b = s[row + x]!
          const c = s[row + Math.min(w - 1, x + 1)]!
          dst[row + x] = maxFilter ? Math.max(a, Math.max(b, c)) : Math.min(a, Math.min(b, c))
        }
      }
    })
  }
  const vPass = (s: Int32Array, dst: Int32Array, maxFilter: boolean): void => {
    stripes(h, (y0, y1) => {
      for (let y = y0; y < y1; y++) {
        const rUp = Math.max(0, y - 1) * w
        const rCur = y * w
        const rDn = Math.min(h - 1, y + 1) * w
        for (let x = 0; x < w; x++) {
          const a = s[rUp + x]!
          const b = s[rCur + x]!
          const c = s[rDn + x]!
          dst[y * w + x] = maxFilter ? Math.max(a, Math.max(b, c)) : Math.min(a, Math.min(b, c))
        }
      }
    })
  }
  // 膨胀 ×2（等效 5x5 max）
  hPass(lum, tmp, true)
  vPass(tmp, bufA, true)
  hPass(bufA, tmp, true)
  vPass(tmp, bufA, true)
  // 腐蚀 ×2（等效 5x5 min）→ 背景场
  hPass(bufA, tmp, false)
  vPass(tmp, background, false)
  hPass(background, tmp, false)
  vPass(tmp, background, false)

  const out = new Uint32Array(pixels)
  stripes(stripeRows(h, 2), (ys, ye) => {
    for (let y = 1 + ys; y < 1 + ye; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x
        const l = lum[idx]!
        const bg = Math.min(background[idx]!, lumaCap)
        const diff = bg - l
        let delta = 0
        if (diff > threshold) {
          // 线条：按深度加深（负 delta）；单像素压暗量上限 72
          delta = -Math.min(diff, 72) * k
        } else {
          // 平坦区：向邻域亮度靠拢，轻降噪
          const mean = (lum[idx - 1]! + lum[idx + 1]! + lum[idx - w]! + lum[idx + w]!) / 4
          delta = (mean - l) * flatDenoise
        }
        if (delta === 0) continue
        const c = pixels[idx]!
        const channel = (shift: number): number => {
          const v = (c >>> shift) & 0xFF
          // 以亮度 delta 同步作用到各通道（保持色相）
          return clamp(roundToInt(v + delta), 0, 255)
        }
        out[idx] = (c & 0xff000000) | (channel(16) << 16) | (channel(8) << 8) | channel(0)
      }
    }
  })
  copyBorderPixels(out, w, h)
  return out
}

/** Waifu2x 类：2x 边缘保持放大（bilinear 放大 + 双边滤波细化 + 限幅轻锐化） */
export function waifu2xLike(src: PixImage, strength: number, ops: PixOps): PixImage {
  const scale =
    Math.max(src.width, src.height) * 2 > MAX_EDGE ? MAX_EDGE / Math.max(src.width, src.height) : 2
  if (scale <= 1.05) return casSharpen(src, 0.3 + 0.3 * strength, ops)
  const up = ops.codec.createScaledBitmap(
    src,
    roundToInt(src.width * scale),
    roundToInt(src.height * scale),
  )
  const denoised = bilateralLite(up, 2, 28 * (0.5 + 0.5 * strength), ops)
  return unsharpMask(denoised, 0.25 + 0.45 * strength, ops)
}

/**
 * ANIME4K 轻量档：保边预降噪 → 原始像素 Restore CNN → EASU sharpen 收尾。
 * Kotlin L901–917（`bilateralLite(radius=1, sigmaColor=8+12*strength)` →
 * `Anime4KCnn.restore(den, strength)` → `ComicEdgeUpscaler.sharpen(restored, strength)`）。
 */
export function anime4kRestore(src: PixImage, strength: number, ops: PixOps): PixImage {
  if (strength <= 0) return src
  const den = bilateralLite(src, 1, 8 + 12 * strength, ops)
  const restored = anime4KCnnRestore(den, strength, 256, ops, ops.cnn?.restore ?? [])
  return edgeUpscalerShapen(restored, strength, ops)
}

/** ANIME4K 平坦区降噪权重（第六轮下调：0.20→0.12） */
export const ANIME4K_FLAT_DENOISE = 0.12

/**
 * 边缘掩码 CAS：CAS 只作用于"3×3 亮度极差 ≥ [edgeRange]"的边缘像素——
 * 平坦区的压缩噪声保持原样，不放大噪声。
 */
export function casSharpenEdges(
  src: PixImage,
  amount: number,
  edgeRange: number,
  ops: PixOps,
): PixImage {
  if (amount <= 0 || src.width < 4 || src.height < 4) return src
  const sharpened = casSharpen(src, amount, ops)
  const w = src.width
  const h = src.height
  const orig = src.data
  const sharped = sharpened.data
  const out = new Uint32Array(orig)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const c = luma(orig[i]!)
      let hit = false
      let dy = -1
      while (dy <= 1 && !hit) {
        let dx = -1
        while (dx <= 1) {
          if (Math.abs(luma(orig[i + dy * w + dx]!) - c) >= edgeRange) {
            hit = true
            break
          }
          dx++
        }
        dy++
      }
      if (hit) out[i] = sharped[i]!
    }
  }
  return ops.codec.createBitmap(w, h, out)
}

/**
 * 完整档：预算允许时分块 2× CNN，否则原尺寸 Restore + EASU，最后恢复细节。
 * Kotlin L961–982。
 */
export function anime4kUpscale(src: PixImage, strength: number, ops: PixOps): PixImage {
  if (strength <= 0) return src
  const long = Math.max(src.width, src.height)
  if (long < 8) return src
  const [w, h] = edgeUpscalerTargetSize(src.width, src.height)
  // Infer at the native source scale. Never shrink text to satisfy the CNN budget.
  // Restore before enlargement: a one-output-pixel correction largely vanishes
  // when a 2x image is fitted back to reading size. Native ink restoration survives.
  const restored = anime4kRestore(src, strength, ops)
  const up =
    w === src.width * 2 && h === src.height * 2
      ? anime4KCnnUpscale2x(restored, strength, 256, ops, ops.cnn?.upscale ?? [])
      : edgeUpscalerUpscale(restored, w, h, ops)
  return edgeUpscalerShapenReconstruction(up, strength, ops)
}

/** 超分辨率：EASU 重建斜线，局部去振铃后恢复亮度细节。Kotlin L985–999。 */
export function superResolution(src: PixImage, strength: number, ops: PixOps): PixImage {
  if (strength <= 0) return src
  const [w, h] = edgeUpscalerTargetSize(src.width, src.height)
  const restored = edgeUpscalerShapen(src, strength, ops)
  const up = edgeUpscalerUpscale(restored, w, h, ops)
  return edgeUpscalerShapenReconstruction(up, strength, ops)
}

/** 简化双边滤波（颜色相似度加权均值），边缘保持降噪 */
export function bilateralLite(
  src: PixImage,
  radius: number,
  sigmaColor: number,
  ops: PixOps,
): PixImage {
  if (radius <= 0) return src
  return ops.codec.createBitmap(
    src.width,
    src.height,
    bilateralLitePixels(src, radius, sigmaColor, ops.stripes),
  )
}

export function bilateralLitePixels(
  src: PixImage,
  radius: number,
  sigmaColor: number,
  stripes: StripeRunner = defaultParallelStripes,
): Uint32Array {
  const w = src.width
  const h = src.height
  const pixels = src.data
  const out = new Uint32Array(pixels)
  const sigma2 = 2 * sigmaColor * sigmaColor
  // 步长保护：超大图降采样窗口，避免 O(w*h*(2r+1)^2) 爆炸
  const r = w * h > 2_000_000 ? 1 : radius
  stripes(stripeRows(h, 2 * r), (ys, ye) => {
    for (let y = r + ys; y < r + ye; y++) {
      for (let x = r; x < w - r; x++) {
        const idx = y * w + x
        const c = pixels[idx]!
        const cr = (c >>> 16) & 0xFF
        const cg = (c >>> 8) & 0xFF
        const cb = c & 0xFF
        let sw = 0
        let sr = 0
        let sg = 0
        let sb = 0
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const p = pixels[idx + dy * w + dx]!
            const pr = (p >>> 16) & 0xFF
            const pg = (p >>> 8) & 0xFF
            const pb = p & 0xFF
            const dist2 = (pr - cr) * (pr - cr) + (pg - cg) * (pg - cg) + (pb - cb) * (pb - cb)
            const wgt = Math.exp(-dist2 / sigma2)
            sw += wgt
            sr += pr * wgt
            sg += pg * wgt
            sb += pb * wgt
          }
        }
        if (sw > 0) {
          const nr = clamp(roundToInt(sr / sw), 0, 255)
          const ng = clamp(roundToInt(sg / sw), 0, 255)
          const nb = clamp(roundToInt(sb / sw), 0, 255)
          out[idx] = (c & 0xff000000) | (nr << 16) | (ng << 8) | nb
        }
      }
    }
  })
  return out
}

/**
 * Lanczos3 重采样（a=3）。两级 pass 均走 IntArray 批量读写：
 * 水平 pass 逐行 → IntArray 中间缓冲（打包 ARGB，仅为 Float 方案 1/4 内存）→ 垂直 pass 逐列 → 批量生成位图。
 *
 * Kotlin L1068–1081 `taps(count, input, scale)` 的原样移植：`filterScale = min(1, scale)`、
 * `radius = 3 / filterScale`（缩小时加宽核）、`center = (i + 0.5)/scale - 0.5`、
 * `start = ceil(center - radius)`、`end = floor(center + radius)`，索引 clamp 到
 * `[0, input-1]`，权重 `lanczos3((center - (start+t)) * filterScale)` 后按 `sum` 归一。
 * 旧实现用固定 ±3 整数邻域 + 不归一，会在任何非 1:1 缩放上产生相位漂移与振铃。
 */
export function lanczosScale(src: PixImage, scale: number, ops: PixOps): PixImage {
  if (scale <= 0 || Math.abs(scale - 1) < 0.01) return src
  const uniform = Math.min(scale, MAX_EDGE / Math.max(src.width, src.height))
  const nw = Math.max(1, roundToInt(src.width * uniform))
  const nh = Math.max(1, roundToInt(src.height * uniform))
  return lanczosScaleTo(src, nw, nh, ops)
}

/** Lanczos3 重采样到精确目标尺寸（第六轮第 5 条）：比例缩放的舍入会使回程尺寸偏 ±2px。 */
export function lanczosScaleTo(
  src: PixImage,
  nw: number,
  nh: number,
  ops: PixOps,
): PixImage {
  if (nw <= 0 || nh <= 0) return src
  return ops.codec.createBitmap(nw, nh, lanczosScaleToPixels(src, nw, nh, ops.stripes))
}

/** One `taps()` entry: the clamped source indices and their normalised weights. */
interface LanczosTaps {
  readonly indices: Int32Array
  readonly weights: Float32Array
}

/** Kotlin L1068–1081 `taps(count, input, scale)`, verbatim. */
function lanczosTaps(count: number, input: number, scale: number): LanczosTaps[] {
  const filterScale = Math.min(1, scale)
  const radius = 3 / filterScale
  const out: LanczosTaps[] = []
  for (let i = 0; i < count; i++) {
    const center = (i + 0.5) / scale - 0.5
    const start = Math.ceil(center - radius)
    const end = Math.floor(center + radius)
    const n = end - start + 1
    const indices = new Int32Array(n)
    const weights = new Float32Array(n)
    let sum = 0
    for (let t = 0; t < n; t++) {
      indices[t] = clamp(start + t, 0, input - 1)
      const wgt = lanczos3((center - (start + t)) * filterScale)
      weights[t] = wgt
      sum += wgt
    }
    const normalized = new Float32Array(n)
    for (let t = 0; t < n; t++) normalized[t] = weights[t]! / sum
    out.push({ indices, weights: normalized })
  }
  return out
}

export function lanczosScaleToPixels(
  src: PixImage,
  nw: number,
  nh: number,
  stripes: StripeRunner = defaultParallelStripes,
): Uint32Array {
  const sw = src.width
  const sh = src.height
  if (nw === sw && nh === sh) return new Uint32Array(src.data)
  const scaleX = nw / sw
  const scaleY = nh / sh
  const srcPixels = src.data
  // Pixel-centre mapping and widened kernels on reduction prevent phase shifts/moire.
  // Precompute once per axis; sin() used to run seven times per pixel per pass.
  const horizontal = lanczosTaps(nw, sw, scaleX)
  const vertical = lanczosTaps(nh, sh, scaleY)
  const mid = new Uint32Array(nw * sh)
  // 水平 pass（逐行，行并行）
  stripes(sh, (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      const rowOff = y * sw
      for (let x = 0; x < nw; x++) {
        const { indices, weights } = horizontal[x]!
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let wsum = 0
        for (let t = 0; t < indices.length; t++) {
          const sxx = indices[t]!
          const wgt = weights[t]!
          if (wgt === 0) continue
          const p = srcPixels[rowOff + sxx]!
          r += ((p >>> 16) & 0xFF) * wgt
          g += ((p >>> 8) & 0xFF) * wgt
          b += (p & 0xFF) * wgt
          a += ((p >>> 24) & 0xFF) * wgt
          wsum += wgt
        }
        mid[y * nw + x] = packArgb(a, r, g, b, wsum)
      }
    }
  })
  // 垂直 pass（逐输出行，行并行）
  const outPixels = new Uint32Array(nw * nh)
  stripes(nh, (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      const { indices, weights } = vertical[y]!
      for (let x = 0; x < nw; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let wsum = 0
        for (let t = 0; t < indices.length; t++) {
          const syy = indices[t]!
          const wgt = weights[t]!
          if (wgt === 0) continue
          const p = mid[syy * nw + x]!
          r += ((p >>> 16) & 0xFF) * wgt
          g += ((p >>> 8) & 0xFF) * wgt
          b += (p & 0xFF) * wgt
          a += ((p >>> 24) & 0xFF) * wgt
          wsum += wgt
        }
        outPixels[y * nw + x] = packArgb(a, r, g, b, wsum)
      }
    }
  })
  return outPixels
}

function packArgb(a: number, r: number, g: number, b: number, wsum: number): number {
  if (wsum === 0) return 0xff000000
  const nr = clamp(roundToInt(r / wsum), 0, 255)
  const ng = clamp(roundToInt(g / wsum), 0, 255)
  const nb = clamp(roundToInt(b / wsum), 0, 255)
  const na = clamp(roundToInt(a / wsum), 0, 255)
  return (na << 24) | (nr << 16) | (ng << 8) | nb
}

export function lanczos3(x: number): number {
  const v = Math.abs(x)
  if (v < 1e-6) return 1
  if (v >= 3) return 0
  const pix = Math.PI * v
  return (3 * Math.sin(pix) * Math.sin(pix / 3)) / (pix * pix)
}

/** 通用 3x3 卷积 */
export function convolve3x3(src: PixImage, kernel: Float32Array, ops: PixOps): PixImage {
  const w = src.width
  const h = src.height
  const pixels = src.data
  const out = new Uint32Array(pixels)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      let r = 0
      let g = 0
      let b = 0
      let ki = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const p = pixels[idx + dy * w + dx]!
          const k = kernel[ki++]!
          r += ((p >>> 16) & 0xFF) * k
          g += ((p >>> 8) & 0xFF) * k
          b += (p & 0xFF) * k
        }
      }
      const c = pixels[idx]!
      out[idx] =
        (c & 0xff000000) |
        (clamp(roundToInt(r), 0, 255) << 16) |
        (clamp(roundToInt(g), 0, 255) << 8) |
        clamp(roundToInt(b), 0, 255)
    }
  }
  return ops.codec.createBitmap(w, h, out)
}

/* ─────────────── 沉浸式动态背景 ─────────────── */

/**
 * 从页面提取主色调（用于沉浸式背景）：量化直方图 + 去极值 + 降饱和压暗。
 * 返回 packed ARGB 颜色。
 */
export function dominantBackground(src: PixImage, ops: PixOps): number {
  const w = src.width
  const h = src.height
  if (w < 2 || h < 2) return 0xff101014
  const sw = 24
  const sh = 24
  const scale = Math.min(sw / w, sh / h)
  // Kotlin L1198–1200 downsamples with `Matrix().setScale(scale, scale)` and then reads
  // `small.height`/`small.width`, i.e. the ACTUAL scaled size `round(w*scale) x
  // round(h*scale)` — NOT a forced 24×24. Passing (24, 24) here would resample a 1000×2000
  // page into a square 24×24 instead of 12×24, changing both the sample grid and the
  // aspect ratio, and therefore the quantised histogram (and the reported colour).
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * scale))
  const small = scale < 1 ? ops.codec.createScaledBitmap(src, dw, dh) : src
  const pixels = small.data

  // key: 量化rgb, value: [count, rSum, gSum, bSum]
  const hist = new Map<number, Int32Array>()
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      const p = pixels[y * small.width + x]!
      const r = (p >>> 16) & 0xFF
      const g = (p >>> 8) & 0xFF
      const b = p & 0xFF
      const lum = Math.trunc((r * 299 + g * 587 + b * 114) / 1000)
      // 过滤近黑/近白（对背景无意义的极端色）
      if (lum < 24 || lum > 238) continue
      const key = ((r >>> 5) << 10) | ((g >>> 5) << 5) | (b >>> 5)
      let e = hist.get(key)
      if (e === undefined) {
        e = new Int32Array(4)
        hist.set(key, e)
      }
      e[0] = e[0]! + 1
      e[1] = e[1]! + r
      e[2] = e[2]! + g
      e[3] = e[3]! + b
    }
  }
  if (hist.size === 0) return 0xff101014
  // Kotlin L1219 `hist.maxByOrNull { it.value[0] }` returns the FIRST maximum in
  // iteration order on ties; `>` (not `>=`) preserves that here for Map insertion order.
  let best: Int32Array | null = null
  for (const e of hist.values()) {
    if (best === null || e[0]! > best[0]!) best = e
  }
  if (best === null) return 0xff101014
  let r = Math.trunc(best[1]! / best[0]!)
  let g = Math.trunc(best[2]! / best[0]!)
  let b = Math.trunc(best[3]! / best[0]!)
  // 降饱和 35% + 压暗到 ~25% 亮度
  const lum = Math.trunc((r * 299 + g * 587 + b * 114) / 1000)
  r = roundToInt(lum + (r - lum) * 0.65)
  g = roundToInt(lum + (g - lum) * 0.65)
  b = roundToInt(lum + (b - lum) * 0.65)
  const targetLum = 64
  const cur = Math.max(1, Math.trunc((r * 299 + g * 587 + b * 114) / 1000))
  const f = targetLum / cur
  r = clamp(roundToInt(r * f), 0, 255)
  g = clamp(roundToInt(g * f), 0, 255)
  b = clamp(roundToInt(b * f), 0, 255)
  return (0xff000000 | (r << 16) | (g << 8) | b) >>> 0
}
/**
 * comicHarismCurl.ts  ←
 *   novel-reader/app/src/main/java/com/example/ui/comic/ComicHarismCurl.kt
 *
 * Kotlin source: 1492 lines / 1417 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`                 — package decl          │
 * │ L3–61     Android/Compose imports (`CurlPage`, `CurlRenderer`, `CurlView`,     │
 * │           `Bitmap`, `Canvas`, `MotionEvent`, `View`, …) — injected `CurlGL` /
 * │           `CurlInput` seams                                                  │
 * │ L80–428   `class ComicCurlView(context, translucent) : CurlView(...)` — the    │
 * │           *GL surface* is Android-only. PORTED: the pure parts — the touch      │
 * │           arbitration state machine (L231–379), `dispatchSynthetic` (L382–386),│
 * │           `startAutoFlip`'s event geometry (L393–427), `finishAnimation`'s     │
 * │           spread-step index logic (L182–222), and the onDrawFrame settle        │
 * │           report (L159–172). SKIPPED: `GLSurfaceView`/`onDrawFrame`/            │
 * │           `removeCurlMesh`/`addCurlMesh`/`getPageRect`/`setTexture` calls,     │
 * │           `performHapticFeedback`, `post`/`postDelayed`/`removeCallbacks`,     │
 * │           `resources.displayMetrics`, `BuildConfig.DEBUG` Log.d lines.          │
 * │ L431–770  `internal class ComicHarismController` — PORTED: slot LRU cache,      │
 * │           `composeSpread`/`composeUnit`/`composeAdjacentUnit`/`composeBack-     │
 * │           Texture` geometry + cache-key derivation + `drawSpreadFit` layout     │
 * │           maths, `toOur`/`toHarism` mapping, `applyPageRects`. SKIPPED:        │
 * │           `Bitmap.createBitmap(RGB_565)`/`Canvas` drawing calls (injected     │
 * │           `PixCodec`), `BitmapRegionDecoder` recycle, HapticsGate log lines.   │
 * │ L773–776  `internal fun slotCacheKey(...)`                 — ported verbatim    │
 * │ L778–782  `internal fun pageBgInt(config)`                  — ported verbatim    │
 * │ L800–840  `internal fun applyCurlBackground(view, …)`      — ported as a pure   │
 * │           command returning `{ clearColorArgb, backgroundBitmap }` instead of  │
 * │           calling `CurlView.setBackgroundColor/setBackgroundBitmap`            │
 * │ L844–845  `ourIndexFor(...)` / `849–850 flatUnitIndexFor` — ported (identity)  │
 * │ L862–865  `adjacentBackFlat(flat, flatCount)`               — ported verbatim    │
 * │ L878–947  `curlPageRects(...)` — ported verbatim (pure; `RectF` → local class) │
 * │ L950      `harismIndexFor(...)`                            — ported (identity)  │
 * │ L953      `enum class CurlSyncPlan`                        — string union        │
 * │ L963      `CURL_IMMEDIATE_WAIT_MS = 170`                   — ported              │
 * │ L965–968  `curlSyncPlan(...)`                              — ported verbatim    │
 * │ L977–987  `buildCurlFlatUnits(layout)`                     — ported verbatim    │
 * │ L991–995  `spreadToHarismTwo(...)`                         — ported verbatim    │
 * │ L999–1003 `harismToSpreadTwo(...)`                         — ported verbatim    │
 * │ L1005–1009 `pagePaperInt(config)`                          — ported verbatim    │
 * │ L1015–1425 `@Composable internal fun ComicHarismCurlReader(...)` — SKIPPED as   │
 * │           a Composable: the *logic* it contained is ported as explicit          │
 * │           imperative steps on `ComicHarismController` (                           │
 * │           `applyLayoutUpdate`, `runExternalSync`, `preloadWindow`,             │
 * │           `startAutoReadLoop`, `buildPageProvider`) so the sequencing,        │
 * │           generation checks and sync plans survive. The Compose tree,          │
 * │           `AndroidView`, `LaunchedEffect`, `LifecycleEventObserver`,           │
 * │           `ComicLoadingFeedback`, `ChasingDots`, `ComicCurlZoomOverlay`,       │
 * │           `ZoomableImageLayer` and the Chinese overlay strings                 │
 * │           ("本页加载失败", "点击重试", "放大查看",                              │
 * │           "双指缩放 · 双击切换档位 · 单击退出") are UI-layer concerns and       │
 * │           belong to the adapter. The strings ARE preserved above as exported   │
 * │           constants so the adapter can use them verbatim.                      │
 * │ L1432–1492 `@Composable private fun ComicCurlZoomOverlay(...)` — SKIPPED:    │
 * │           pure Compose; it only reuses `ComicZoomState` (ported in            │
 * │           comicZoomGesture.ts) and the overlay strings.                        │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHAT "PORT THE MATH/GEOMETRY, NOT THE SHADER COMPILATION" MEANS HERE ──────────
 * fi.harism.curl's `CurlRenderer` builds the cylinder-projected mesh in native code
 * (C++) and its `CurlPage` holds GL textures. This port keeps:
 *   • every piece of geometry this file itself computes (page rects, flat units,
 *     index mapping, sync plans, texture composition layout, auto-flip event stream),
 *   • a `CurlGL` command surface (`setBackground`, `setPageRect`, `setCurrentIndex`,
 *     `updatePage`, `addCurlMesh`…) that the adapter implements with whatever
 *     WebGL page-curl library the iOS/web build uses.
 * It does NOT re-implement harism's cylindrical mesh deformation or any GLSL program —
 * those live behind `CurlGL`.
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `MotionEvent` → `CurlInputEvent` (action, x, y, pointerCount, downTime, eventTime).
 * • `View.post/postDelayed/removeCallbacks` → injected `Scheduler`.
 * • `Bitmap`/`Canvas` → `PixCodec` from comicPixOps.
 * • Compose state / `LaunchedEffect` / `snapshotFlow` → explicit controller methods.
 * • `fencedRect` guards the WebGL-style texture cap (1024/1800) on the JS side too.
 */

import {
  type ComicBookStateSubset,
  type ComicConfigSubset,
  type ComicDoubleAlign,
  type ComicEnhanceMode,
  type ComicFit,
  type ComicLayout,
  type ComicPageRef,
  type ComicSlot,
  type ComicSpread,
  comicChapterEdgeTarget,
  fittedSize,
  RectF,
  sizeIAspect,
  spreadCount,
  type SizeF,
  type SizeI,
} from './comicPortTypes'
import type { PixCodec, PixImage } from './comicPixOps'
import { clamp } from './comicPixOps'
import type { Geometry as CurlGeometry, Toning as CurlToning } from './comicImagePipeline'
import { toneOf } from './comicImagePipeline'

/* ══════════════ injected seams ══════════════ */

/** `CurlPage.SIDE_*` (harism's own enum). */
export const CURL_SIDE_FRONT = 'FRONT'
export const CURL_SIDE_BACK = 'BACK'
export const CURL_SIDE_BOTH = 'BOTH'
export type CurlSide = typeof CURL_SIDE_FRONT | typeof CURL_SIDE_BACK | typeof CURL_SIDE_BOTH

/** `CurlView.SHOW_ONE_PAGE` / `SHOW_TWO_PAGES`. */
export const SHOW_ONE_PAGE = 1
export const SHOW_TWO_PAGES = 2

/**
 * The harism GL renderer behind an adapter. Every method maps 1:1 onto a `CurlView`
 * / `CurlRenderer` call so the sequencing in this file is unchanged.
 */
export interface CurlGL {
  /** `view.width` / `view.height` (0 until laid out). */
  size(): { width: number; height: number }
  /** `isAnimating()` */
  isAnimating(): boolean
  /** `currentIndex` */
  currentIndex(): number
  /** `setCurrentIndex(i)` — jumps and re-textures. */
  setCurrentIndex(i: number): void
  /** `setCurrentIndexSilently(i)` — index move without re-texturing. */
  setCurrentIndexSilently(i: number): void
  /** `setRightToLeft(rtl)` — mirrors GL book geometry. */
  setRightToLeft(rtl: boolean): void
  /** `setSpreadStep(1 | 2)` */
  setSpreadStep(step: number): void
  /** `setViewMode(SHOW_ONE_PAGE | SHOW_TWO_PAGES)` */
  setViewMode(mode: number): void
  /** `setAllowLastPageCurl(false)` */
  setAllowLastPageCurl(allow: boolean): void
  /** `setMargins(l, t, r, b)` */
  setMargins(l: number, t: number, r: number, b: number): void
  /** `setPageRect(left | null, right | null)` — px, screen coords. */
  setPageRect(left: RectF | null, right: RectF | null): void
  /** `setBackgroundColor(argb)` — the opaque clear color. */
  setBackgroundColor(argb: number): void
  /** `setBackgroundBitmap(bmp | null)` — non-curling full-bleed paper mesh. */
  setBackgroundBitmap(bmp: PixImage | null): void
  /** `setRigidPageDecider { idx -> … }` */
  setRigidPageDecider(decide: (index: number) => boolean): void
  /** `setSizeChangedObserver { w, h -> … }` */
  setSizeChangedObserver(observer: (w: number, h: number) => void): void
  /**
   * `CurlView.PageProvider` — the adapter calls `getPageCount()` / `updatePage()`.
   * `updatePage` must invoke the supplied sink with the composited texture.
   */
  setPageProvider(provider: CurlPageProvider): void
  /**
   * spread-step settle (`finishAnimation`): exchange the curling mesh with the spare
   * side mesh, in one renderer-locked section. Adapter implements with the same
   * `synchronized(renderer)` atomicity.
   */
  settleSpreadMesh(target: 'LEFT' | 'RIGHT'): void
  /** `view.onPause()` / `onResume()` */
  onPause(): void
  onResume(): void
  /** `super.onTouch(view, me)` — forward to harism's stateless touch stream. */
  onTouch(ev: CurlInputEvent): void
  /** `dispatchSynthetic(action, x, y, downTime)` — synthesised DOWN/CANCEL/MOVE/UP. */
  onSyntheticTouch(ev: CurlInputEvent): void
}

export interface CurlPageSink {
  /** `page.setTexture(bitmap, SIDE_FRONT | SIDE_BACK | SIDE_BOTH)` */
  setTexture(bitmap: PixImage, side: CurlSide): void
  /** `page.setColor(argb, SIDE_BOTH)` */
  setColor(argb: number, side: CurlSide): void
}

export interface CurlPageProvider {
  getPageCount(): number
  updatePage(page: CurlPageSink, width: number, height: number, index: number): void
}

/** `MotionEvent.actionMasked` values. */
export const ACTION_DOWN = 0
export const ACTION_UP = 1
export const ACTION_MOVE = 2
export const ACTION_CANCEL = 3
export const ACTION_POINTER_DOWN = 5

export interface CurlInputEvent {
  readonly action: number
  readonly x: number
  readonly y: number
  readonly pointerCount: number
  readonly downTime: number
  readonly eventTime: number
}

/** `View.post` / `postDelayed` / `removeCallbacks` / `SystemClock.uptimeMillis()`. */
export interface Scheduler {
  uptimeMillis(): number
  post(fn: () => void): void
  postDelayed(fn: () => void, delayMs: number): void
  removeCallbacks(fn: () => void): void
}

/** `ViewConfiguration.get(context).scaledTouchSlop` */
export interface CurlViewConfig {
  readonly slopPx: number
  readonly density: number
}

/** Texture page provider cache — the loader's decoded page store. */
export interface SlotCacheStore {
  get(key: string): PixImage | null
  put(key: string, bmp: PixImage): void
  getAnyVariant(refId: string): PixImage | null
  clear(): void
  size(): number
}

/* ══════════════ pure index / plan helpers (L844–1003) ══════════════ */

/** 缓存键与预加载侧（rememberPageBitmap 同构）：含单页旋转（修复"旋转本页后 CURL 页空白"） */
export function slotCacheKey(
  slot: ComicSlot,
  config: ComicConfigSubset,
  bookState: ComicBookStateSubset,
): string {
  const rot = (((config.bookRotation + (bookState.pageRotations[slot.ref.id] ?? 0)) % 360) + 360) % 360
  return `${slot.ref.id}|${slot.half}|${imagePipelineFingerprint(config)}|r${rot}`
}

/**
 * `ComicReaderConfig.imagePipelineFingerprint()` (L164–170) — mirrored here because
 * `slotCacheKey` embeds it and `ComicReaderConfig.kt` is owned by another agent.
 * Delete together with the other mirrors in comicPortTypes.ts once it lands.
 */
export function imagePipelineFingerprint(config: ComicConfigSubset): string {
  const parts = [
    config.cropMode,
    config.manualCrop === null ? 'null' : config.manualCrop.join(','),
    String(config.bookRotation),
    String(config.splitWide),
    String(config.splitPosition),
    config.enhanceMode,
    String(config.enhanceStrength),
    String(config.filterBrightness),
    String(config.filterContrast),
    String(config.filterSaturation),
    String(config.filterHue),
    config.filterGamma.toFixed(3),
    String(config.filterSharpen),
    String(config.filterShadow),
    String(config.filterBW),
  ]
  return parts.join('|')
}

export function pageBgInt(config: ComicConfigSubset): number {
  switch (config.bgType) {
    case 'WHITE':
      return 0xfafaf7
    case 'PAPER':
      return 0xf2eee6
    default:
      return 0x101014
  }
}

function pagePaperInt(config: ComicConfigSubset): number {
  switch (config.bgType) {
    case 'WHITE':
      return 0xefede6
    case 'PAPER':
      return 0xe8e4dc
    default:
      return 0x1d1d21
  }
}

/** Logical page order is unchanged; RTL is handled by the renderer's geometry. */
export function ourIndexFor(harismIdx: number): number {
  return harismIdx
}

/** Units stay in reading order in both directions. */
export function flatUnitIndexFor(harismIdx: number): number {
  return harismIdx
}

export function harismIndexFor(ourIdx: number): number {
  return ourIdx
}

/**
 * 双页背面目标 flat（纯函数可单测，第六轮第 3 条修正）：
 * 物理书模型——spread [2k,2k+1] 中被翻动的页与其背面是**同一张纸**：
 * 前进侧（flat 为奇，第二槽位）翻起时，纸背面 = 下一 spread 的第一页（flat+1）；
 * 回退侧（flat 为偶，第一槽位）翻起时，背面 = 上一 spread 的第二页（flat-1）。
 * 越界（封面/封底外）返回 null（回退透纸观感）。
 */
export function adjacentBackFlat(flat: number, flatCount: number): number | null {
  const back = flat + (flat % 2 === 1 ? 1 : -1)
  return back >= 0 && back < flatCount ? back : null
}

/**
 * CURL 页面矩形（第 1 条核心，纯函数可单测）：纸张不再是整幅屏幕，而是
 * 漫画本体在容器中的适配矩形——与 Compose 侧排版同构。
 * 返回 [leftRect, rightRect]（px，屏幕坐标系）；内禀缺失（未加载）返回 null。
 */
export function curlPageRects(
  twoPage: boolean,
  spread: ComicSpread | undefined,
  config: ComicConfigSubset,
  containerW: number,
  containerH: number,
  density: number,
  intrinsicOf: (slot: ComicSlot) => SizeF | null,
): [RectF, RectF] | null {
  if (containerW <= 0 || containerH <= 0 || spread === undefined || spread.slots.length === 0) {
    return null
  }
  const slots = spread.slots
  if (twoPage) {
    const rtl = config.direction === 'RTL'
    const gapPx = config.doubleGapDp * density
    const availW = (containerW - gapPx) / 2
    const fitOne = (sz: SizeF | null): SizeF | null => {
      if (sz === null || sz.width <= 0 || sz.height <= 0) return null
      const s = Math.min(availW / sz.width, containerH / sz.height)
      return { width: sz.width * s, height: sz.height * s }
    }
    // 展示位：LTR [s0 左, s1 右]；RTL [s1 左, s0 右]
    const leftSlot = rtl ? slots[1] : slots[0]
    const rightSlot = rtl ? slots[0] : slots[1]
    const szL = fitOne(leftSlot === undefined ? null : intrinsicOf(leftSlot))
    const szR = fitOne(rightSlot === undefined ? null : intrinsicOf(rightSlot))
    if (szL === null && szR === null) return null
    // 单槽 spread：缺失侧用伙伴同尺寸（同版面骨架的纸面占位）
    const finalL: SizeF = szL ?? szR!
    const finalR: SizeF = szR ?? finalL
    const totalW = finalL.width + finalR.width + gapPx
    const x0 = (containerW - totalW) / 2
    const shiftX = config.doubleShiftXDp * density
    const shiftY = config.doubleShiftYDp * density
    const topOf = (sz: SizeF): number => {
      switch (config.doubleAlign) {
        case 'TOP':
          return 0
        case 'BOTTOM':
          return containerH - sz.height
        default:
          return (containerH - sz.height) / 2
      }
    }
    const leftRect = new RectF(
      x0 + shiftX,
      topOf(finalL) + shiftY,
      x0 + finalL.width + shiftX,
      topOf(finalL) + finalL.height + shiftY,
    )
    const rightRect = new RectF(
      x0 + finalL.width + gapPx + shiftX,
      topOf(finalR) + shiftY,
      x0 + totalW + shiftX,
      topOf(finalR) + finalR.height + shiftY,
    )
    return [leftRect, rightRect]
  }
  const srcs: SizeF[] = []
  for (const s of slots.slice(0, 2)) {
    const sz = intrinsicOf(s)
    if (sz !== null) srcs.push(sz)
  }
  if (srcs.length === 0) return null
  const gap = srcs.length === 2 ? config.doubleGapDp * density : 0
  let totalW = 0
  for (const s of srcs) totalW += s.width
  let maxH = 0
  for (const s of srcs) maxH = Math.max(maxH, s.height)
  // 与 drawSpreadFit contain 同构：可用宽先扣 gap，适配后再把 gap 加回总跨度
  const fitted =
    config.fit === 'STRETCH'
      ? { width: containerW, height: containerH }
      : (() => {
          const f = fittedSize(
            { width: totalW, height: maxH },
            { width: Math.max(1, containerW - gap), height: containerH },
            config.fit,
            config.customFitScale,
            config.customFitBase,
          )
          return { width: f.width + gap, height: f.height }
        })()
  if (fitted.width <= 0 || fitted.height <= 0) return null
  const x = (containerW - fitted.width) / 2
  const y = (containerH - fitted.height) / 2
  const right = new RectF(x, y, x + fitted.width, y + fitted.height)
  const left = new RectF()
  left.copyFrom(right)
  left.offset(-fitted.width, 0)
  return [left, right]
}

/** 外部页码同步策略（纯函数，可单测） */
export type CurlSyncPlan = 'IMMEDIATE_PRELOAD' | 'DEBOUNCE_MERGE' | 'NOOP'

/**
 * 外部 currentSpread 变化 → 视图同步策略（第 1/15/22 条核心逻辑）：
 * - NOOP：目标即当前（用户拖拽落定已先行上报）；
 * - IMMEDIATE_PRELOAD：大跨度跳转（目录/进度条）——先同步解码目标页再 setCurrentIndex；
 * - DEBOUNCE_MERGE：相邻步进（快速连续翻页/滑条逐格）——120ms 防抖合并纹理重建。
 */
export const CURL_IMMEDIATE_WAIT_MS = 170
export const CURL_DEBOUNCE_MS = 120

export function curlSyncPlan(
  targetSpread: number,
  lastSyncedSpread: number,
  viewCurrentIndex: number,
  viewTargetIndex: number,
): CurlSyncPlan {
  if (viewCurrentIndex === viewTargetIndex) return 'NOOP'
  if (lastSyncedSpread >= 0 && Math.abs(targetSpread - lastSyncedSpread) > 2) {
    return 'IMMEDIATE_PRELOAD'
  }
  return 'DEBOUNCE_MERGE'
}

/**
 * 双页 CURL 扁平单元：每 spread 的槽位按阅读顺序展开为逐页序列；
 * 单槽 spread 补 null 空位保持偶数对齐（书脊两侧一一对应）。
 * 每个 harism 页 = 一张漫画页（不再合成整版纹理），书脊 = 屏幕中线。
 */
export function buildCurlFlatUnits(layout: ComicLayout): (ComicSlot | null)[] {
  const out: (ComicSlot | null)[] = []
  for (const s of layout.spreads) {
    if (s.slots.length === 0) {
      out.push(null)
      out.push(null)
    } else if (s.slots.length === 1) {
      out.push(s.slots[0]!)
      out.push(null)
    } else {
      out.push(s.slots[0]!)
      out.push(s.slots[1]!)
    }
  }
  return out
}

/** The second reading slot is native PAGE_RIGHT; RTL reflects it onto the left. */
export function spreadToHarismTwo(spread: number, flatCount: number): number {
  const maxH = Math.max(1, flatCount - 1)
  const h = spread * 2 + 1
  return clamp(h, 1, maxH)
}

/** 两页模式 harism 右页索引 → spread（纯函数） */
export function harismToSpreadTwo(h: number, flatCount: number): number {
  const k = Math.trunc((h - 1) / 2)
  const lastSpread = Math.max(0, Math.trunc((flatCount + 1) / 2) - 1)
  return clamp(k, 0, lastSpread)
}

/**
 * CURL 引擎的背景应用（第六轮第 2 条根治）——纯命令返回，不直接操作 GL。
 * 背景从此只有这一条渲染路径，任何翻页/模式/矩形状态都不再影响它。
 */
export interface CurlBackgroundCommand {
  readonly clearColorArgb: number
  /** Non-null only for PAPER with a positive viewport (never curls). */
  readonly backgroundBitmap: PixImage | null
}

/** `ComicReaderBackgrounds.paperTextureRaw(intensity)` — injected texture source. */
export type PaperTextureSource = (intensity: number) => PixImage

/**
 * 根因：GL surface 位于窗口之后，一旦出帧，窗口在其边界内被透明打孔，
 * Compose 绘制的背景层永远合成不上来。根治：背景进入 GL 场景内部——
 * 纯色 = 不透明 clear color，无 mesh；纸张纹理 = 永不卷曲的全幅背景 mesh；
 * 沉浸动态 = clear color 跟随主色。
 */
export function applyCurlBackground(
  config: ComicConfigSubset,
  dynamicColorArgb: number | null,
  width: number,
  height: number,
  codec: PixCodec,
  paperTextureRaw: PaperTextureSource,
): CurlBackgroundCommand {
  switch (config.bgType) {
    case 'BLACK':
      return { clearColorArgb: 0x000000, backgroundBitmap: null }
    case 'WHITE':
      return { clearColorArgb: 0xf7f7f5, backgroundBitmap: null }
    case 'GRAY':
      return { clearColorArgb: 0x232326, backgroundBitmap: null }
    case 'DYNAMIC':
      return { clearColorArgb: (0x000000 | (dynamicColorArgb ?? 0x101014)) >>> 0, backgroundBitmap: null }
    case 'PAPER': {
      if (width > 0 && height > 0) {
        // 与 Compose 层同一纹理源（单一数据源），平铺到屏幕尺寸；不做缓存
        // （推送仅发生在背景类型/强度/尺寸变化时）
        const src = paperTextureRaw(config.paperIntensity)
        const out = codec.createBitmap(width, height, new Uint32Array(width * height))
        for (let y = 0; y < height; y += src.height) {
          for (let x = 0; x < width; x += src.width) {
            codec.drawBitmap(out, src, x, y)
          }
        }
        return { clearColorArgb: 0xf3ecdf, backgroundBitmap: out } // 纹理之下的兜底底色
      }
      return { clearColorArgb: 0xf3ecdf, backgroundBitmap: null }
    }
  }
}

/* ══════════════ texture composition geometry (L579–769) ══════════════ */

/** POT 纹理内存控制：短边 ≤1024、长边 ≤1800（RGB_565） */
export function textureCap(w: number, h: number): { w: number; h: number; scale: number } {
  const scale = Math.min(1, Math.min(1024 / w, 1800 / h))
  return { w: Math.max(8, Math.trunc(w * scale)), h: Math.max(8, Math.trunc(h * scale)), scale }
}

/** One `canvas.drawBitmap(src, null, RectF, paint)` from `drawSpreadFit`. */
export interface SpreadFitDraw {
  readonly src: PixImage
  readonly rect: RectF
}

/**
 * 合成排版（drawSpreadFit 的纯几何部分，L719–769）：返回每张源位图的绘制矩形。
 * 实际 blit 交给注入的 `PixCodec.drawBitmapRect`，参数顺序与 Kotlin 一致。
 */
export function drawSpreadFit(
  srcs: ReadonlyArray<PixImage>,
  bw: number,
  bh: number,
  gap: number,
  fit: ComicFit,
  align: ComicDoubleAlign,
  shiftX = 0,
  shiftY = 0,
  fitExtra = 1,
): SpreadFitDraw[] {
  let totalW = 0
  for (const s of srcs) totalW += s.width
  let maxH = 0
  for (const s of srcs) maxH = Math.max(maxH, s.height)
  const out: SpreadFitDraw[] = []
  if (fit === 'STRETCH') {
    // 拉伸：每槽各占一半（去间距）
    const half = (bw - gap) / srcs.length
    let x = srcs.length === 2 ? 0 : (bw - half) / 2
    for (const s of srcs) {
      out.push({ src: s, rect: new RectF(x + shiftX, shiftY, x + half + shiftX, bh + shiftY) })
      x += half + gap
    }
    return out
  }
  const s =
    fit === 'FIT_WIDTH'
      ? (bw - gap) / totalW
      : fit === 'FILL'
        ? Math.max((bw - gap) / totalW, bh / maxH)
        : Math.min((bw - gap) / totalW, bh / maxH) // FIT_PAGE/FIT_HEIGHT/ORIGINAL：contain
  const scaled = s * fitExtra
  const totalDrawW = totalW * scaled
  const drawH = maxH * scaled
  let x = (bw - totalDrawW) / 2
  const y =
    align === 'TOP' ? 0 : align === 'BOTTOM' ? bh - drawH : (bh - drawH) / 2
  for (const s of srcs) {
    const rw = s.width * scaled
    const rh = s.height * scaled
    // 双页不等高时按 align 基线对齐各自顶点
    const ry =
      align === 'TOP' ? y : align === 'BOTTOM' ? y + drawH - rh : y + (drawH - rh) / 2
    out.push({
      src: s,
      rect: new RectF(x + shiftX, ry + shiftY, x + rw + shiftX, ry + rh + shiftY),
    })
    x += rw + gap
  }
  return out
}

/** CUSTOM 档拆解（第 26 条）：基础档 + 额外系数（STRETCH 拉伸档不乘系数）。 */
export function resolveFit(config: ComicConfigSubset): {
  effFit: ComicFit
  fitExtra: number
} {
  if (config.fit === 'CUSTOM') {
    return {
      effFit: config.customFitBase === 'CUSTOM' ? 'FIT_PAGE' : config.customFitBase,
      fitExtra: config.customFitScale,
    }
  }
  return { effFit: config.fit, fitExtra: 1 }
}

/* ══════════════ ComicHarismController (L431–770) ══════════════ */

/**
 * 控制器：持有 view 与预加载缓存，桥接 UI 侧状态与 GL 线程的 PageProvider。
 * Coroutines/Flow removed — `displayGeneration` guards race the same way it did in Kotlin.
 */
export class ComicHarismController {
  view: CurlGL | null = null
  layout: ComicLayout | null = null
  config: ComicConfigSubset | null = null

  bookState: ComicBookStateSubset = { pageRotations: {} }
  reversed = false
  density = 1

  /** 双页书脊模式：每 harism 页 = 单张漫画页，步进 2 */
  twoPage = false
  flatUnits: (ComicSlot | null)[] = []

  /** 当前 spread 提示（provider 线程判定"未命中即需补纹理"用） */
  currentSpreadHint = -1

  /**
   * 显示代（generation）：布局/配置/目标页任一变化即递增。
   * 异步预加载与纹理重建按发起时的代提交，提交前校验代未变。
   */
  displayGeneration = 0

  /** 第 4 条（乐观翻页）：当前 spread 的精确纹理未命中时置位。 */
  pendingRetexture = false

  /** 最近一次应用的显式页面矩形（px）——未变化时跳过 setPageRect 重纹理 */
  private lastAppliedRects: [RectF, RectF] | null = null

  /**
   * 占位纸面/信箱底色覆盖（第六轮第 2 条）：DYNAMIC 背景下跟随当前主色，
   * 其余类型为 null（回落 [pageBgInt] 的固定映射）。
   */
  bgFillOverride: number | null = null

  constructor(
    readonly store: SlotCacheStore,
    private readonly codec: PixCodec,
    /** 记录区域重解码槽位尺寸（loader 侧回填）。 */
    private readonly sizes: () => ReadonlyMap<string, SizeI> = () => new Map(),
  ) {}

  /** `toneOf(config)` 的当前值（CURL 预载路径直接用它构造管线参数）。 */
  tone: CurlToning | null = null

  /** `controller.view?.let { … }` — the Kotlin null-safe view scope. */
  withView<T>(fn: (v: CurlGL) => T): T | null {
    const v = this.view
    return v === null ? null : fn(v)
  }

  fillInt(cfg: ComicConfigSubset): number {
    return this.bgFillOverride ?? pageBgInt(cfg)
  }

  /**
   * 应用显式页面矩形（第 1 条：纸张=漫画本体矩形，背景是 GL 之后的静态层）。
   * 未加载（无内禀尺寸）时清除覆盖，回退整幅/半幅布局（纸面占位）。
   */
  applyPageRects(
    spreadIdx: number,
    config: ComicConfigSubset,
    state: ComicBookStateSubset,
    layout: ComicLayout,
  ): void {
    const v = this.view
    if (v === null) return
    const { width, height } = v.size()
    if (width <= 0 || height <= 0) return
    const spread = layout.spreads[spreadIdx]
    if (spread === undefined) return
    const sizeMap = this.sizes()
    const rects = curlPageRects(
      this.twoPage,
      spread,
      config,
      width,
      height,
      this.density,
      (slot) => {
        const exact = this.store.get(slotCacheKey(slot, config, state))
        if (exact !== null) return { width: exact.width, height: exact.height }
        const any = this.store.getAnyVariant(slot.ref.id)
        if (any !== null) return { width: any.width, height: any.height }
        const s = sizeMap.get(slot.ref.id)
        return s === undefined ? null : { width: s.width, height: s.height }
      },
    )
    const last = this.lastAppliedRects
    if (rects !== null) {
      if (last !== null && last[0].equalsRect(rects[0]) && last[1].equalsRect(rects[1])) return
      this.lastAppliedRects = rects
      v.setPageRect(rects[0], rects[1])
    } else if (last !== null) {
      this.lastAppliedRects = null
      v.setPageRect(null, null)
    }
  }

  toOur(h: number): number {
    return this.twoPage
      ? harismToSpreadTwo(h, this.flatUnits.length)
      : ourIndexFor(h)
  }

  toHarism(our: number): number {
    return this.twoPage ? spreadToHarismTwo(our, this.flatUnits.length) : harismIndexFor(our)
  }

  /** GL 线程：合成 spread 纹理（信箱式 + fit 规则 + 双页拼排）。 */
  composeSpread(hIdx: number, w: number, h: number, mirrorForRenderer = true): PixImage | null {
    const lay = this.layout
    const cfg = this.config
    if (lay === null || cfg === null) return null
    const ourIdx = this.toOur(hIdx)
    const spread = lay.spreads[ourIdx]
    if (spread === undefined) return null
    const cap = textureCap(w, h)
    const bmp = this.codec.createBitmap(cap.w, cap.h, new Uint32Array(cap.w * cap.h))
    this.codec.drawBitmap(bmp, solidPage(cap.w, cap.h, this.fillInt(cfg)), 0, 0)
    const st = this.bookState
    // RTL: mirror the GL book geometry's texture compensation
    this.codec.setMirrorX(bmp, this.reversed && mirrorForRenderer)
    const rawSlots = spread.slots.slice(0, 2)
    const slots = cfg.direction === 'RTL' ? [...rawSlots].reverse() : rawSlots
    // 精确键优先；未命中回退同页任意变体（防空白闪帧，页身份仍正确）
    let exactMiss = false
    const resolved: (PixImage | null)[] = slots.map((slot) => {
      const exact = this.store.get(slotCacheKey(slot, cfg, st))
      if (exact === null) exactMiss = true
      return exact ?? this.store.getAnyVariant(slot.ref.id)
    })
    const srcs = resolved.filter((s): s is PixImage => s !== null)
    // 第 4 条：当前 spread 纹理未就绪（慢网络）→ 标记待补纹理（占位→真实）
    if (exactMiss && ourIdx === this.currentSpreadHint) this.pendingRetexture = true
    // 未加载槽位画纯色纸面即可：加载指示由 UI 层动画承接
    if (srcs.length === 0) {
      this.codec.setMirrorX(bmp, false)
      return bmp
    }
    const gap = srcs.length === 2 ? cfg.doubleGapDp * this.density : 0
    // 位置修正（第 24 条）：平移量不乘缩放，直接作用于合成坐标系
    const shiftXPx = cfg.doubleShiftXDp * this.density
    const shiftYPx = cfg.doubleShiftYDp * this.density
    const { effFit, fitExtra } = resolveFit(cfg)
    const draws = drawSpreadFit(
      srcs,
      cap.w,
      cap.h,
      gap,
      effFit,
      cfg.doubleAlign,
      shiftXPx,
      shiftYPx,
      fitExtra,
    )
    for (const d of draws) this.codec.drawBitmapRect(bmp, d.src, d.rect, 255, true)
    this.codec.setMirrorX(bmp, false)
    return bmp
  }

  /**
   * 双页背面（第 2 条，StPageFlip 数据模型）：背面 = 被翻纸张物理上的另一面
   * = 真正相邻的那一页。越界（封面/封底外）返回 null，调用方回退"透纸"观感。
   */
  composeAdjacentUnit(hIdx: number, w: number, h: number): PixImage | null {
    if (!this.twoPage) return null
    const flatCount = this.flatUnits.length
    if (flatCount === 0) return null
    const flat = flatUnitIndexFor(hIdx)
    const backFlat = adjacentBackFlat(flat, flatCount)
    if (backFlat === null) return null
    const bmp = this.composeUnit(backFlat, w, h)
    if (bmp === null) return null
    // harism 折叠几何将背面纹理水平镜像显示（v.mPosX 取负）——预镜像一次
    return this.codec.createBitmapMirroredX(bmp)
  }

  /** 双页书脊模式单页纹理（第 12 条）：半屏画布信箱式适配。 */
  composeUnit(hIdx: number, w: number, h: number, mirrorForRenderer = true): PixImage | null {
    const cfg = this.config
    if (cfg === null) return null
    // Logical indices stay in reading order; geometry reflects the physical sides.
    const slot = this.flatUnits[flatUnitIndexFor(hIdx)] ?? null
    const cap = textureCap(w, h)
    const bmp = this.codec.createBitmap(cap.w, cap.h, new Uint32Array(cap.w * cap.h))
    this.codec.drawBitmap(bmp, solidPage(cap.w, cap.h, this.fillInt(cfg)), 0, 0)
    // RTL: mirror the GL book geometry's texture compensation
    this.codec.setMirrorX(bmp, this.reversed && mirrorForRenderer)
    if (slot === null) {
      this.codec.setMirrorX(bmp, false)
      return bmp
    }
    const exact = this.store.get(slotCacheKey(slot, cfg, this.bookState))
    if (exact === null) {
      // 第 4 条：当前 spread 纹理未就绪（慢网络）→ 标记待补纹理
      if (harismToSpreadTwo(hIdx, this.flatUnits.length) === this.currentSpreadHint) {
        this.pendingRetexture = true
      }
    }
    const src = exact ?? this.store.getAnyVariant(slot.ref.id)
    if (src === null) {
      this.codec.setMirrorX(bmp, false)
      return bmp
    }
    const { effFit, fitExtra } = resolveFit(cfg)
    const draws = drawSpreadFit(
      [src],
      cap.w,
      cap.h,
      0,
      effFit,
      cfg.doubleAlign,
      0,
      0,
      fitExtra,
    )
    for (const d of draws) this.codec.drawBitmapRect(bmp, d.src, d.rect, 255, true)
    this.codec.setMirrorX(bmp, false)
    return bmp
  }

  /**
   * 背面纹理（第 13 条"浅浅反面"）：单面印刷物理模型——纸的背面透出本页正面的
   * 镜像墨迹：低不透明度（20%）+ 降采样轻模糊 + 纸底色预合成。
   */
  composeBackTexture(front: PixImage | null, w: number, h: number): PixImage {
    const cfg = this.config
    const paper =
      cfg !== null ? (this.bgFillOverride ?? pagePaperInt(cfg)) : 0x1d1d21
    const cap = textureCap(w, h)
    const bmp = this.codec.createBitmap(cap.w, cap.h, new Uint32Array(cap.w * cap.h))
    this.codec.drawBitmap(bmp, solidPage(cap.w, cap.h, paper), 0, 0)
    if (front !== null) {
      // 1/6 降采样再放大 = 轻模糊（透纸的柔化观感），避免逐像素高斯开销
      const small = this.codec.createScaledBitmap(
        front,
        Math.max(2, Math.trunc(cap.w / 6)),
        Math.max(2, Math.trunc(cap.h / 6)),
      )
      const soft = this.codec.createScaledBitmap(small, cap.w, cap.h)
      // alpha = (0.20f * 255)
      this.codec.drawBitmap(bmp, soft, 0, 0, Math.trunc(0.2 * 255))
    }
    return bmp
  }
}

function solidPage(w: number, h: number, argb: number): PixImage {
  const data = new Uint32Array(w * h)
  data.fill(argb >>> 0)
  return { width: w, height: h, data }
}

/* ══════════════ ComicCurlView gesture arbitration (L231–427) ══════════════ */

/**
 * View 层手势仲裁（第 17 条）：双指 / 双击 / 长按（按配置）在本层拦截并转入缩放覆盖层；
 * 单指拖拽 / 快 tap 走卷页与点按区。
 * （不能在 GL 视图上叠 UI 层仲裁：指针层会截获整条触摸流，interop 视图收不到事件。）
 */
export interface ComicCurlViewHooks {
  onQuickTap: ((x: number, y: number) => void) | null
  onLongPress: ((x: number, y: number) => void) | null
  onSettledIndex: ((index: number) => void) | null
  onZoomGesture: (() => void) | null
  onChapterEdge: ((next: boolean) => void) | null
  isAtForwardEdge: (() => boolean) | null
  isAtBackwardEdge: (() => boolean) | null
}

/** haptics adapter seam (`com.example.ui.feedback.HapticsGate.enabled` + VIRTUAL_KEY). */
export type CurlHaptic = () => void

export class ComicCurlViewArbiter {
  doubleTapZoomEnabled = false
  longPressZoomEnabled = false
  longPressPanelEnabled = false
  swipeEnabled = true
  forwardSign = 1

  autoFlipping = false

  private downTime = 0
  private downX = 0
  private downY = 0
  private dragForwarded = false
  private chapterEdgeActive = false
  private longPressFired = false

  /** 双击窗口内上一击（第二击 DOWN 直接进入缩放，不再走点按/拖拽） */
  private lastQuickTapAt = 0
  private lastQuickTapX = 0
  private lastQuickTapY = 0
  private doubleTapActive = false

  /** 双指手势进行中（吞掉余下事件直到全部抬起） */
  private multiTouch = false

  /** 自动翻页合成拖拽进行中（绕过滑动开关、UP 不判快 tap） */
  private syntheticDrag = false

  /** 自动翻页合成流的 downTime（真实用户触摸 downTime 不同 → 吞掉防干扰） */
  private syntheticDownTime = 0
  private lastReportedIndex = -1
  private pendingQuickTap: (() => void) | null = null
  private startedAtForwardEdge = false
  private startedAtBackwardEdge = false
  private readonly longPressRunnable: () => void

  readonly doubleTapWindowMs = 320
  readonly longPressMs = 500
  readonly quickTapMs = 250

  constructor(
    readonly hooks: ComicCurlViewHooks,
    readonly gl: CurlGL,
    readonly sched: Scheduler,
    private readonly viewCfg: CurlViewConfig,
    /** GL 线程回调需要回主线程执行（Kotlin `post { … }`）。 */
    private readonly haptic: CurlHaptic | null = null,
  ) {
    this.longPressRunnable = () => {
      if (!this.dragForwarded && !this.autoFlipping) {
        this.longPressFired = true
        if (this.longPressZoomEnabled) this.hooks.onZoomGesture?.()
        else if (this.longPressPanelEnabled) this.hooks.onLongPress?.(this.downX, this.downY)
      }
    }
  }

  get slopPx(): number {
    return this.viewCfg.slopPx
  }

  /** `onDetachedFromWindow` — cancel the deferred callbacks. */
  dispose(): void {
    if (this.pendingQuickTap !== null) {
      this.sched.removeCallbacks(this.pendingQuickTap)
      this.pendingQuickTap = null
    }
    this.sched.removeCallbacks(this.longPressRunnable)
  }

  /** `onDrawFrame` — settle report on index change (haptics adapter hooks here). */
  onDrawFrame(): void {
    const idx = this.gl.currentIndex()
    if (idx !== this.lastReportedIndex) {
      this.lastReportedIndex = idx
      // 第 6 节：翻页落定轻触觉（GL 线程回调，post 回 UI 线程执行）
      if (this.haptic !== null) this.sched.post(this.haptic)
      this.hooks.onSettledIndex?.(idx)
    }
  }

  /**
   * 双页 spread 步进落定（StPageFlip 书脊模型移植的收尾）：
   * - 索引按 ±step（双页 = ±2，整 spread 推进保持配对）；
   * - 落定页"纸张变不透明"：翻页期间背面是低透明透纸观感（第 13 条），
   *   落定瞬间换成本次翻页揭示的新页正面（bright opacify）。
   * 第六轮族 D：整段 mesh 交换持 renderer monitor 原子化（GL 线程不可见中间态）。
   */
  finishAnimation(
    getSpreadStep: () => number,
    getAnimationTarget: () => 'LEFT' | 'RIGHT',
    getCurlState: () => 'LEFT' | 'RIGHT',
  ): void {
    if (getSpreadStep() <= 1) {
      // 单页（step=1）走父类原版逻辑（其 mesh 交换自身即正确）
      this.gl.settleSpreadMesh(getAnimationTarget())
      return
    }
    const step = getSpreadStep()
    const target = getAnimationTarget()
    if (target === 'LEFT') {
      // 翻动页落定到右侧：成为新右页（CURL_LEFT = 索引 -= step）
      if (getCurlState() === 'LEFT') {
        this.gl.setCurrentIndexSilently(this.gl.currentIndex() - step)
      }
    } else {
      // 翻动页落定到左侧：成为新左页（CURL_RIGHT = 索引 += step）
      if (getCurlState() === 'RIGHT') {
        this.gl.setCurrentIndexSilently(this.gl.currentIndex() + step)
      }
    }
    // mesh 交换 + 重新贴纹理 + endAnimationState，全部在 renderer monitor 内
    this.gl.settleSpreadMesh(target)
  }

  /** 合成事件透传（补投的 DOWN / 自动翻页步进流共用） */
  private dispatchSynthetic(action: number, x: number, y: number, downT: number): void {
    this.gl.onSyntheticTouch({ action, x, y, pointerCount: 1, downTime: downT, eventTime: this.sched.uptimeMillis() })
  }

  /** View 层触摸仲裁（onTouch）。Returns true when the event is consumed. */
  onTouch(ev: CurlInputEvent): boolean {
    // 自动翻页合成流进行中：合成事件（downTime 相同）直通渲染器驱动卷页；
    // 真实用户触摸吞掉，避免与合成拖拽互相打断
    if (this.autoFlipping) return ev.downTime === this.syntheticDownTime
    // 双指手势激活后：吞掉余下事件直到全部抬起
    if (this.multiTouch) {
      if (ev.action === ACTION_UP || ev.action === ACTION_CANCEL) {
        if (ev.pointerCount <= 1) this.multiTouch = false
      }
      return true
    }
    switch (ev.action) {
      case ACTION_DOWN: {
        if (this.pendingQuickTap !== null) {
          this.sched.removeCallbacks(this.pendingQuickTap)
          this.pendingQuickTap = null
        }
        this.downTime = ev.downTime
        this.downX = ev.x
        this.downY = ev.y
        this.dragForwarded = false
        this.chapterEdgeActive = false
        this.startedAtForwardEdge = !this.gl.isAnimating() && this.hooks.isAtForwardEdge?.() === true
        this.startedAtBackwardEdge = !this.gl.isAnimating() && this.hooks.isAtBackwardEdge?.() === true
        this.longPressFired = false
        // 双击窗口内的第二击：直接进缩放，不再走点按/拖拽
        if (
          this.doubleTapZoomEnabled &&
          this.lastQuickTapAt > 0 &&
          this.sched.uptimeMillis() - this.lastQuickTapAt < this.doubleTapWindowMs &&
          Math.hypot(ev.x - this.lastQuickTapX, ev.y - this.lastQuickTapY) < this.slopPx * 4
        ) {
          this.doubleTapActive = true
          if (this.pendingQuickTap !== null) {
            this.sched.removeCallbacks(this.pendingQuickTap)
            this.pendingQuickTap = null
          }
          this.lastQuickTapAt = 0
          this.hooks.onZoomGesture?.()
          return true
        }
        this.doubleTapActive = false
        this.sched.postDelayed(this.longPressRunnable, this.longPressMs)
        // 拦截 DOWN：快 tap 不产生卷页；确认拖拽后补投合成 DOWN
        return true
      }
      case ACTION_POINTER_DOWN: {
        // 第二根手指落下：接管为缩放手势；若卷页拖拽已在进行，
        // 给渲染器补投 CANCEL 让其按当前卷曲位置落定回正
        if (ev.pointerCount >= 2) {
          this.sched.removeCallbacks(this.longPressRunnable)
          if (this.dragForwarded) {
            this.dispatchSynthetic(ACTION_CANCEL, ev.x, ev.y, this.downTime)
            this.dragForwarded = false
          }
          this.chapterEdgeActive = false
          this.multiTouch = true
          this.longPressFired = false
          this.hooks.onZoomGesture?.()
        }
        return true
      }
      case ACTION_MOVE: {
        if (this.doubleTapActive) return true
        if (this.chapterEdgeActive) return true
        if (!this.dragForwarded) {
          // 长按已触发（放大/呼出控制层）后继续拖拽：不再启动卷页
          if (this.longPressFired) return true
          const moved = Math.hypot(ev.x - this.downX, ev.y - this.downY)
          if (moved < this.slopPx) return true
          this.sched.removeCallbacks(this.longPressRunnable)
          const dx = ev.x - this.downX
          const dy = ev.y - this.downY
          const forward = dx * this.forwardSign
          if (
            this.swipeEnabled &&
            this.hooks.onChapterEdge !== null &&
            Math.abs(dx) >= Math.abs(dy) &&
            ((this.startedAtForwardEdge && forward > 0) ||
              (this.startedAtBackwardEdge && forward < 0))
          ) {
            this.chapterEdgeActive = true
            return true
          }
          // 禁用滑动翻页只拦真实手势；自动翻页的合成拖拽是显式用户选项，放行
          if (!this.swipeEnabled && !this.syntheticDrag) return true
          this.dispatchSynthetic(ACTION_DOWN, this.downX, this.downY, this.downTime)
          this.dragForwarded = true
        }
        this.gl.onTouch(ev)
        return true
      }
      case ACTION_UP:
      case ACTION_CANCEL: {
        this.sched.removeCallbacks(this.longPressRunnable)
        if (this.chapterEdgeActive) {
          this.chapterEdgeActive = false
          if (ev.action === ACTION_UP) {
            const target = comicChapterEdgeTarget(
              -(ev.x - this.downX) * this.forwardSign,
              this.startedAtBackwardEdge,
              this.startedAtForwardEdge,
              48 * this.viewCfg.density,
            )
            if (target !== 0) this.hooks.onChapterEdge?.(target > 0)
          }
          return true
        }
        if (this.doubleTapActive) {
          this.doubleTapActive = false
          return true
        }
        if (!this.dragForwarded) {
          const quick = ev.action === ACTION_UP && ev.eventTime - this.downTime < this.quickTapMs
          if (quick) {
            this.lastQuickTapAt = this.sched.uptimeMillis()
            this.lastQuickTapX = ev.x
            this.lastQuickTapY = ev.y
            const x = ev.x
            const y = ev.y
            if (this.doubleTapZoomEnabled) {
              if (this.pendingQuickTap !== null) {
                this.sched.removeCallbacks(this.pendingQuickTap)
                this.pendingQuickTap = null
              }
              this.pendingQuickTap = (): void => {
                this.hooks.onQuickTap?.(x, y)
              }
              this.sched.postDelayed(this.pendingQuickTap, this.doubleTapWindowMs)
            } else this.hooks.onQuickTap?.(x, y)
          }
          return true
        }
        this.gl.onTouch(ev)
        return true
      }
      default:
        this.gl.onTouch(ev)
        return true
    }
  }

  /**
   * 自动翻页：合成完整拖拽流。RTL 前进 = 从左缘向右拖，镜像后的几何仍使用 CURL_RIGHT；
   * LTR 前进 = 从右缘向左拖（CURL_RIGHT）。UP 落点越过中线 → 渲染器自身的
   * 松手动画完成翻页并触发 onSettledIndex。
   */
  startAutoFlip(fromLeft: boolean, done: () => void): void {
    if (this.autoFlipping) return
    this.autoFlipping = true
    this.syntheticDrag = true
    const { width, height } = this.gl.size()
    const w = width
    const h = height
    if (w <= 0 || h <= 0) {
      this.autoFlipping = false
      this.syntheticDrag = false
      this.syntheticDownTime = 0
      return
    }
    const stream = autoFlipStream(w, h, fromLeft)
    const t0 = this.sched.uptimeMillis()
    this.syntheticDownTime = t0
    this.dispatchSynthetic(ACTION_DOWN, stream.fromX, h * 0.5, t0)
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const x = stream.fromX + ((stream.toX - stream.fromX) * i) / steps
      // 事件时间必须单调不减，与真实触摸一致
      const t = Math.max(t0 + Math.trunc((360 * i) / steps), this.sched.uptimeMillis())
      this.dispatchSynthetic(ACTION_MOVE, x, h * 0.5, t)
    }
    const t1 = this.sched.uptimeMillis() + 20
    this.dispatchSynthetic(ACTION_UP, stream.toX, h * 0.5, t1)
    // 松手动画 ~300ms + 落定回调余量
    this.sched.postDelayed(() => {
      this.autoFlipping = false
      this.syntheticDrag = false
      this.syntheticDownTime = 0
      done()
    }, 700)
  }
}

/**
 * 自动翻页的合成事件流几何（L405–407），抽成纯函数供单测钉死：
 * 起手 3% / 97%，落点 65% / 35%，纵向居中。
 */
export function autoFlipStream(
  w: number,
  h: number,
  fromLeft: boolean,
): { y: number; fromX: number; toX: number } {
  const y = h * 0.5
  const fromX = fromLeft ? w * 0.03 : w * 0.97
  const toX = fromLeft ? w * 0.65 : w * 0.35
  return { y, fromX, toX }
}

/* ══════════════ UI-layer strings preserved from the skipped Composables ══════════════ */

/** L1405 / L1406 — CURL 纹理加载失败提示（"本页加载失败" / "点击重试"）。 */
export const CURL_LOAD_FAILED_TEXT = '本页加载失败'
export const CURL_RETRY_TEXT = '点击重试'

/** L1470 — 缩放覆盖层的无障碍描述（"放大查看"）。 */
export const ZOOM_IMAGE_DESCRIPTION = '放大查看'

/** L1483 — 缩放覆盖层顶部提示（"双指缩放 · 双击切换档位 · 单击退出"）。 */
export const ZOOM_OVERLAY_HINT = '双指缩放 · 双击切换档位 · 单击退出'

/* ══════════════ imperative port of the L1015–1425 Composable body ══════════════ */

/** The loader surface the CURL reader drives. */
export interface CurlLoaderBridge {
  /** `loader.sizes.value[id]?.gutterPos` */
  gutterPosOf(refId: string): number | null
  /** `loader.load(ref, cacheKey, geo, tone)` — used by IMMEDIATE_PRELOAD. */
  load(
    ref: ComicPageRef,
    cacheKey: string,
    geo: CurlGeometry,
    tone: CurlToning,
  ): Promise<PixImage | null>
  /** `loader.loadForDisplay(…, visible)` */
  loadForDisplay(
    ref: ComicPageRef,
    cacheKey: string,
    geo: CurlGeometry,
    tone: CurlToning,
    visible: boolean,
  ): Promise<{ bitmap: PixImage; fromCache: boolean }>
  /** `loader.peekProcessed(key)` */
  peekProcessed(key: string): PixImage | null
  /** `loader.peekReadingPreview(key)` */
  peekReadingPreview(key: string): PixImage | null
}

/**
 * 有效拆分位置（第 19 条）的镜像（ComicReaderCore.kt:770）——curl 预载几何需要。
 * 与 comicPortTypes 的其他 mirror 一起在 `./comicReaderCore` 落地后删除。
 */
export function effectiveSplitPosition(
  config: ComicConfigSubset,
  detectedGutterPos: number | null,
): number {
  const base = detectedGutterPos !== null && !Number.isNaN(detectedGutterPos) ? detectedGutterPos : 0.5
  return clamp(base + (config.splitPosition - 0.5), 0.3, 0.7)
}

/** `slot → Geometry` （CURL 预载路径 L1137–1141 / L1223–1227 的逐字构造）。 */
export function curlGeometryFor(
  slot: ComicSlot,
  config: ComicConfigSubset,
  bookState: ComicBookStateSubset,
  loader: CurlLoaderBridge,
): CurlGeometry {
  const rotation =
    (((config.bookRotation + (bookState.pageRotations[slot.ref.id] ?? 0)) % 360) + 360) % 360
  return {
    half: slot.half,
    splitPosition: effectiveSplitPosition(
      config,
      loader.gutterPosOf(slot.ref.id),
    ),
    rotationDeg: rotation,
    cropMode: config.cropMode,
    manualCrop: config.manualCrop,
  }
}

export interface CurlReaderState {
  currentSpread: number
  curlPageLoading: boolean
  curlPageFailed: boolean
  zoomOverlay: boolean
}

/**
 * 布局/配置变化：更新 controller 并标脏（重载由预载完成后触发，
 * 避免用旧/空缓存立即重建纹理导致"配置变更后当前页空白直至翻页"）。
 * — Kotlin L1059–1078
 */
export function applyCurlLayoutUpdate(
  ctrl: ComicHarismController,
  layout: ComicLayout,
  config: ComicConfigSubset,
  bookState: ComicBookStateSubset,
  currentSpread: number,
  twoPageMode: boolean,
  flatUnits: (ComicSlot | null)[],
): void {
  const rtl = config.direction === 'RTL'
  ctrl.layout = layout
  ctrl.config = config
  ctrl.reversed = rtl
  ctrl.twoPage = twoPageMode
  ctrl.flatUnits = flatUnits
  ctrl.displayGeneration++ // 旧代预加载/重建结果全部作废
  ctrl.withView((v) => {
    // 先把索引拨到新映射再 setViewMode：否则 setViewMode 内部的 updatePages
    // 会用旧映射的镜像索引查询未加载页（~135ms 深色纸暗帧）。
    v.setCurrentIndex(ctrl.toHarism(currentSpread))
    v.setRightToLeft(rtl)
    // 书脊模式接线：双页 = 两页并排 + 步进2 + 封面封底刚体（StPageFlip hard 页）
    v.setSpreadStep(twoPageMode ? 2 : 1)
    v.setViewMode(twoPageMode ? SHOW_TWO_PAGES : SHOW_ONE_PAGE)
  })
  ctrl.applyPageRects(currentSpread, config, bookState, layout)
}

/**
 * 外部页码变化同步到视图（Kotlin L1112–1163 `snapshotFlow { currentSpread }`）：
 * - 相邻小步（连续快速翻页）：120ms 防抖合并纹理重建；
 * - 大跨度跳转（|Δ|>2）：先同步解码目标页（等待 ≤ CURL_IMMEDIATE_WAIT_MS），超时先切；
 * - generation 校验：提交前代未变才执行，旧流的新值不覆盖新状态。
 */
export async function syncExternalSpread(
  ctrl: ComicHarismController,
  sp: number,
  lastSynced: number,
  layout: ComicLayout,
  config: ComicConfigSubset,
  bookState: ComicBookStateSubset,
  loader: CurlLoaderBridge,
  sleep: (ms: number) => Promise<void>,
): Promise<number> {
  const gen = ctrl.displayGeneration
  const target = ctrl.toHarism(sp)
  const v = ctrl.view
  const plan = curlSyncPlan(sp, lastSynced, v === null ? target : v.currentIndex(), target)
  if (plan === 'NOOP') return sp
  if (plan === 'IMMEDIATE_PRELOAD') {
    // 大跨度跳转：目标 spread 纹理尽量就绪后再切换，但等待上限 ~170ms
    await Promise.race([
      (async () => {
        const spread = layout.spreads[sp]
        if (spread === undefined) return
        for (const slot of spread.slots) {
          const key = slotCacheKey(slot, config, bookState)
          if (ctrl.store.get(key) !== null) continue
          const geo = curlGeometryFor(slot, config, bookState, loader)
          try {
            const bmp = await loader.load(slot.ref, key, geo, ctrl.tone ?? toneOf(config))
            if (bmp !== null) ctrl.store.put(key, bmp)
          } catch {
            /* CancellationException 必须穿透，否则超时取消被吞、等待上限失效 */
          }
        }
      })(),
      sleep(CURL_IMMEDIATE_WAIT_MS),
    ])
  } else {
    await sleep(CURL_DEBOUNCE_MS)
  }
  if (gen === ctrl.displayGeneration) {
    ctrl.withView((vv) => {
      if (vv.currentIndex() !== target) vv.setCurrentIndex(target)
    })
  }
  return sp
}

/**
 * 相邻页预加载（当前页优先，±1 跟进），完成后按需刷新纹理。
 * — Kotlin L1174–1259
 */
export async function preloadCurlWindow(
  ctrl: ComicHarismController,
  layout: ComicLayout,
  config: ComicConfigSubset,
  bookState: ComicBookStateSubset,
  currentSpread: number,
  loader: CurlLoaderBridge,
  state: CurlReaderState,
  tone: CurlToning,
  onBitmapShown: (bmp: PixImage) => void,
): Promise<void> {
  ctrl.bookState = bookState
  ctrl.currentSpreadHint = currentSpread
  const gen = ++ctrl.displayGeneration
  state.curlPageFailed = false
  // 加载圈判定与 composeSpread 纹理解析同源：精确键或任意变体命中即视为已就绪
  const cur = layout.spreads[currentSpread]
  state.curlPageLoading =
    cur !== undefined &&
    cur.slots.some(
      (slot) =>
        ctrl.store.get(slotCacheKey(slot, config, bookState)) === null &&
        ctrl.store.getAnyVariant(slot.ref.id) === null,
    )
  const targets = [currentSpread, currentSpread + 1, currentSpread - 1].filter(
    (i) => i >= 0 && i < layout.spreads.length,
  )
  for (const si of targets) {
    const spread = layout.spreads[si]!
    let failed = false
    for (const slot of spread.slots) {
      const key = slotCacheKey(slot, config, bookState)
      const geo = curlGeometryFor(slot, config, bookState, loader)
      try {
        const result = await loader.loadForDisplay(slot.ref, key, geo, tone, si === currentSpread)
        ctrl.store.put(key, result.bitmap)
      } catch {
        failed = true
      }
    }
    // 先提交当前页，再等待任何相邻网络请求。
    if (si === currentSpread && gen === ctrl.displayGeneration) {
      ctrl.applyPageRects(currentSpread, config, bookState, layout)
      ctrl.withView((v) => {
        if (ctrl.store.get(slotCacheKey(spread.slots[0]!, config, bookState)) !== null) {
          v.setCurrentIndex(ctrl.toHarism(currentSpread))
        }
      })
      const first = cur?.slots[0]
      if (first !== undefined) {
        const shown = ctrl.store.get(slotCacheKey(first, config, bookState))
        if (shown !== null) onBitmapShown(shown)
      }
      ctrl.pendingRetexture = false
      state.curlPageFailed = failed
      state.curlPageLoading = false
    }
  }
  // Neighbors only fill caches. Never rebuild the visible texture after waiting
  // for their network requests: a user may already be dragging the next page.
}

/**
 * 动态计数 PageProvider（Kotlin L1328–1358）：布局/章节/模式变化后 provider 不会被
 * 重建（factory 只跑一次），闭包捕获的 n 会过期导致 setCurrentIndex 钳制到旧页数。
 */
export function buildCurlPageProvider(
  ctrl: ComicHarismController,
  fallbackConfig: ComicConfigSubset,
  fallbackCount: number,
): CurlPageProvider {
  return {
    getPageCount(): number {
      if (ctrl.twoPage) return ctrl.flatUnits.length
      return ctrl.layout === null ? fallbackCount : spreadCount(ctrl.layout)
    },
    updatePage(page: CurlPageSink, width: number, height: number, index: number): void {
      const front = ctrl.twoPage
        ? ctrl.composeUnit(index, width, height)
        : ctrl.composeSpread(index, width, height)
      if (front !== null) {
        page.setTexture(front, CURL_SIDE_FRONT)
        // 背面：双页 = 目标 spread 同槽位真实页图（第 2 条）；
        // 单页 = 透纸观感（第 13 条）
        const back = ctrl.twoPage ? ctrl.composeAdjacentUnit(index, width, height) : null
        page.setTexture(back ?? ctrl.composeBackTexture(front, width, height), CURL_SIDE_BACK)
      } else {
        page.setColor(pagePaperInt(ctrl.config ?? fallbackConfig), CURL_SIDE_BOTH)
      }
    },
  }
}

/**
 * 自动翻页循环驱动（Kotlin L1262–1274）：翻页成功不改 key 也能继续下一轮，
 * 避免冻结；到末页改为 `goNext()`。
 */
export async function runAutoReadLoop(
  ctrl: ComicHarismController,
  autoRead: boolean,
  autoIntervalSec: number,
  latestCurrent: () => number,
  spreadTotal: number,
  goNext: () => void,
  startFlip: (fromLeft: boolean, done: () => void) => void,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!autoRead || spreadTotal <= 0) return
  for (;;) {
    await sleep(Math.trunc(autoIntervalSec * 1000))
    if (signal?.aborted === true) return
    if (latestCurrent() < spreadTotal - 1) {
      if (ctrl.view === null) continue
      startFlip(ctrl.reversed, () => {})
    } else {
      goNext()
    }
  }
}

/** 宽高比 → 是否疑似跨页（`ComicPageLayout.WIDE_ASPECT` / `HARD_WIDE_ASPECT` mirror）。 */
export const WIDE_ASPECT = 1.35
export const HARD_WIDE_ASPECT = 1.8

/** `ComicPageLayout.isWidePage(size)` mirror — the loader's gutter probe gate. */
export function isWidePage(size: SizeI | null): boolean {
  if (size === null) return false
  const a = sizeIAspect(size)
  if (a < WIDE_ASPECT) return false
  if (a >= HARD_WIDE_ASPECT) return true
  return size.gutter ?? true
}

/** 重管线档位集合（`ComicProcessedDiskCache.eligible` 的镜像，供 loader 复用）。 */
export const DISK_CACHE_ELIGIBLE_MODES: ReadonlyArray<ComicEnhanceMode> = [
  'ANIME4K',
  'WAIFU2X',
  'SUPER_RES',
]

/** `ComicMode.DOUBLE` → 双页书脊模式。 */
export function twoPageModeOf(config: ComicConfigSubset): boolean {
  return config.mode === 'DOUBLE'
}


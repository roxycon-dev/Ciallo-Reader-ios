/**
 * comicPageLoader.ts  ←
 *   novel-reader/app/src/main/java/com/example/ui/comic/ComicPageLoader.kt
 *
 * Kotlin source: 965 lines / 903 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`                 — package decl          │
 * │ L3–33     Android/Coil/coroutines imports (`Context`, `BitmapFactory`,         │
 * │           `BitmapRegionDecoder`, `LruCache`, `coil.*`, `Mutex`, `Semaphore`,   │
 * │           `ConcurrentHashMap`, `CoroutineScope`, `Dispatchers`, …) — replaced   │
 * │           by the injected `PageSource` / `PreloadPolicy` seams and plain        │
 * │           JS data structures                                                  │
 * │ L47–55    `companion object` constants — ported verbatim                       │
 * │ L58–60    `MutableStateFlow<Map<String,SizeI>>` + `StateFlow` — listener        │
 * │           registry (`onSizesChanged`) + a plain Map                           │
 * │ L62–73    `Runtime.getRuntime().maxMemory()` cache sizing — injected           │
 * │           `maxHeapBytes()`                                                    │
 * │ L75–91    `object : LruCache<String, Bitmap>(cacheBaseBytes)` (+ debug Log)    │
 * │           — `ByteLruCache` with an eviction callback                          │
 * │ L94–96    `cacheDbg { … Log.d("ComicCache", …) }` — the message builders are   │
 * │           ported as `CacheDebugLog` strings; the Android `Log.d` calls are    │
 * │           dropped (no platform logger in src/core)                            │
 * │ L99–112   preview / thumb / region LruCaches — `ByteLruCache`                 │
 * │ L118–127  `BitmapRegionDecoder` pool + `entryRemoved { recycle() }` — the      │
 * │           pool/`recycle()` calls moved onto the injected `PageSource`         │
 * │ L128      `private val regionMutex = Mutex()`               — `KeyedMutex`      │
 * │ L131–135  `preloadGate/decodeGate = Semaphore(2)`, `pixelOpGate = Semaphore(1)` │
 * │                                                            — `Semaphore` class  │
 * │ L147      `CoroutineScope(SupervisorJob() + Dispatchers.Default)` — injected    │
 * │           `scope.launch {}` → `taskRunner.run(fn)`                            │
 * │ L139/144  `MutableStateFlow<Long>` epoch counters          — listener registries│
 * │ L156      `ComicProcessedDiskCache(context)`               — ported as a ctor arg│
 * │ L161–172  `pinnedLock` / `pinned` / `windowKeys` priority residency table —   │
 * │           ported verbatim (JS is single-threaded; the lock becomes a no-op)    │
 * │ L244–322  EXIF: `exifCache`, `parseJpegExifOrientation`, `readOrientationFrom-  │
 * │            Tiff`, `exifDisplayMatrix`, `exifSwappedSize` — ported 1:1; the    │
 * │            `File(path).inputStream()` head read → injected `PageSource.        │
 * │            readFileHead(path, max)`; `android.graphics.Matrix` → `ExifMatrix`  │
 * │            (a 3-element op list mirroring setRotate/postScale exactly)         │
 * │ L341–347  `regionMutex.tryLock()` + `decoderPool.evictAll()` — ported to the    │
 * │            mutex's `tryWithLock`                                                │
 * │ L359      `withContext(Dispatchers.Default)`              — the whole body is   │
 * │                                                            already async         │
 * │ L376/395  `withContext(Dispatchers.IO)`                   — injected IO task    │
 * │                                                            runner (`io.run`)   │
 * │ L594–596  `capForPixelOp` — lives in comicImagePipeline (unchanged semantics)  │
 * │ L580–618  `BitmapRegionDecoder`/`BitmapFactory.Options` — injected `PageSource`│
 * │ L626–635  `exifRectToRaw`                                 — ported verbatim    │
 * │ L694      `PreferencesManager(context).preloadWifiOnly`  — injected `Preload-  │
 * │                                                            Policy`             │
 * │ L696–703  `ConnectivityManager` probe                     — injected `PageSource`│
 * │ L850–896  `decodeRaw` / `capEdge` / `decodeLocal`         — ported; the actual  │
 * │                                                            decoders are the seam │
 * │ L898–932  `decodeRemote` (Coil `ImageRequest`)            — ported as a seam    │
 * │            call; the Coil builder chain, `ImageRequest.ErrorResult` handling,  │
 * │            `diskCache.remove`, `ComicStreamPreview` tag and the long comments   │
 * │            about HARDWARE bitmaps / EXIF policy are ADAPTER concerns            │
 * │ L935–940  `sampleSizeFor`                                  — ported verbatim    │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * EVERY algorithmic piece is ported: `exifOrientationOf` / `exifDisplayMatrix` /
 * `exifSwappedSize` / `exifRectToRaw`, `sampleSizeFor`, `estimateProcessedBytes`,
 * `ensureWindowCapacity`, `cachedOrPinned`, `recordPageBytes`, `pinIfWindowed`,
 * `rebuildPinnedInPriorityOrder`, `previewCacheKey`, the cache-size derivations, the
 * failed-fallback semantics (a failed enhance result must never enter any cache tier),
 * the preview publication path, and the whole `preloadWindow` ordering contract
 * (window capacity → residency sync → enqueue → cancel out-of-batch).
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `LruCache` → `ByteLruCache` (Map + byte accounting + eviction callback).
 * • `Mutex` / `Semaphore` → `KeyedMutex` / `Semaphore` promise primitives.
 * • `StateFlow<T>` → `onXxxChanged` listener registries (the UI layer binds them).
 * • `CoroutineScope.launch` → injected `TaskRunner` (WorkManager equivalent).
 * • `android.util.LruCache.get/put/remove/evictAll/resize/maxSize/sizeOf/entryRemoved`
 *   → the same method names on `ByteLruCache`.
 */

import {
  type ComicBookStateSubset,
  type ComicConfigSubset,
  type ComicEnhanceMode,
  type ComicPageRef,
  type ComicSplitHalf,
  RectF,
  type SizeI,
} from './comicPortTypes'
import type { PixImage } from './comicPixOps'
import { kotlinFloatToString } from './comicPixOps'
import {
  DEFAULT_GEOMETRY,
  type Geometry,
  hasWork,
  type Toning,
  toningHasWork,
  edgeUpscalerTargetSize,
} from './comicImagePipeline'
import { ComicProcessedDiskCache, type DiskCacheStore } from './comicProcessedDiskCache'

/* ══════════════ ByteLruCache (android.util.LruCache) ══════════════ */

/**
 * Byte-accounted LRU with the same eviction hook Android's `LruCache` exposes.
 * `sizeOf` must return >= 1 for a value to be countable.
 */
export class ByteLruCache<T> {
  private readonly map = new Map<string, T>()
  private bytes = 0
  private limit: number

  constructor(
    limitBytes: number,
    private readonly sizeOf: (key: string, value: T) => number,
    private readonly onEntryRemoved?: (
      evicted: boolean,
      key: string,
      oldValue: T | undefined,
      newValue: T | undefined,
    ) => void,
  ) {
    this.limit = limitBytes
  }

  /** `LruCache.sizeOf` — sizes are never 0 for the caches in this module. */
  private sizeOfValue(key: string, value: T): number {
    const n = this.sizeOf(key, value)
    return Number.isFinite(n) ? n : 0
  }

  get size(): number {
    return this.map.size
  }

  get totalBytes(): number {
    return this.bytes
  }

  maxSize(): number {
    return this.limit
  }

  resize(limitBytes: number): void {
    if (limitBytes === this.limit) return
    this.limit = limitBytes
    this.trim()
  }

  get(key: string): T | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    // accessOrder = true: re-insert so iteration order is LRU order
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  peek(key: string): T | undefined {
    return this.map.get(key)
  }

  put(key: string, value: T): T | undefined {
    const old = this.map.get(key)
    const oldSize = old === undefined ? 0 : this.sizeOfValue(key, old)
    const newSize = this.sizeOfValue(key, value)
    if (old !== undefined) this.map.delete(key)
    this.map.set(key, value)
    this.bytes += newSize - oldSize
    this.trim()
    if (old !== undefined) this.onEntryRemoved?.(false, key, old, value)
    return old
  }

  remove(key: string): T | undefined {
    const old = this.map.get(key)
    if (old === undefined) return undefined
    this.map.delete(key)
    this.bytes -= this.sizeOfValue(key, old)
    this.onEntryRemoved?.(false, key, old, undefined)
    return old
  }

  evictAll(): void {
    const entries = [...this.map.entries()]
    this.map.clear()
    this.bytes = 0
    for (const [k, v] of entries) this.onEntryRemoved?.(true, k, v, undefined)
  }

  keys(): string[] {
    return [...this.map.keys()]
  }

  /** True when the key is present, WITHOUT touching LRU recency (`LruCache.snapshot`). */
  has(key: string): boolean {
    return this.map.has(key)
  }

  private trim(): void {
    let it = this.map.keys()
    for (const key of it) {
      if (this.map.size <= 0) return
      if (this.bytes <= this.limit && this.map.size >= 0) {
        // stop as soon as we are within budget
        if (this.bytes <= this.limit) return
      }
      const v = this.map.get(key)
      if (v === undefined) continue
      const len = this.sizeOfValue(key, v)
      this.map.delete(key)
      this.bytes -= len
      this.onEntryRemoved?.(true, key, v, undefined)
      it = this.map.keys()
    }
  }
}

/** Kotlin `android.util.LruCache<String, Int>(256)` — value-sized, not byte-sized. */
export class CountLruCache<T> {
  private readonly map = new Map<string, T>()

  constructor(private readonly limit: number) {}

  get(key: string): T | undefined {
    return this.map.get(key)
  }

  put(key: string, value: T): void {
    if (!this.map.has(key) && this.map.size >= this.limit) {
      const oldest = this.map.keys().next()
      if (!oldest.done) this.map.delete(oldest.value)
    }
    this.map.set(key, value)
  }

  remove(key: string): void {
    this.map.delete(key)
  }

  keys(): string[] {
    return [...this.map.keys()]
  }
}

/* ══════════════ concurrency primitives ══════════════ */

/** `kotlinx.coroutines.sync.Semaphore(permits)` */
export class Semaphore {
  private available: number
  private readonly waiters: (() => void)[] = []

  constructor(permits: number) {
    this.available = permits
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--
      return
    }
    await new Promise<void>((res) => this.waiters.push(res))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next === undefined) this.available++
    else next()
  }

  /** `withPermit { block }` */
  async withPermit<T>(block: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await block()
    } finally {
      this.release()
    }
  }
}

/** `kotlinx.coroutines.sync.Mutex` */
export class KeyedMutex {
  private tail: Promise<void> = Promise.resolve()
  private locked = false

  async withLock<T>(block: () => Promise<T>): Promise<T> {
    const prev = this.tail
    let release: () => void = () => {}
    this.tail = new Promise<void>((res) => {
      release = res
    })
    await prev
    this.locked = true
    try {
      return await block()
    } finally {
      this.locked = false
      release()
    }
  }

  /** `Mutex.tryLock()` — used for the decoder-pool teardown path. */
  tryWithLock<T>(block: () => T): T | undefined {
    if (this.locked) return undefined
    this.locked = true
    try {
      return block()
    } finally {
      this.locked = false
      let release: () => void = () => {}
      this.tail = new Promise<void>((res) => {
        release = res
      })
      release()
    }
  }
}

/**
 * `ComicLoadSupport.ComicLoadLocks` mirror (inline port — the file that owns it is not
 * in this module's list): waiters keep their lock registered until the last caller
 * leaves, including cancellation.
 */
export class ComicLoadLocks {
  private readonly entries = new Map<string, { mutex: KeyedMutex; users: number }>()

  acquire(key: string): KeyedMutex {
    let e = this.entries.get(key)
    if (e === undefined) {
      e = { mutex: new KeyedMutex(), users: 0 }
      this.entries.set(key, e)
    }
    e.users++
    return e.mutex
  }

  release(key: string): void {
    const e = this.entries.get(key)
    if (e === undefined) return
    if (--e.users === 0) this.entries.delete(key)
  }
}

/* ══════════════ injected seams ══════════════ */

/** A pooled `BitmapRegionDecoder` (APK path). */
export interface RegionDecoderHandle {
  readonly width: number
  readonly height: number
  /** `decoder.decodeRegion(rect, opts{inSampleSize})` */
  decodeRegion(rect: RegionInt, sampleSize: number): Promise<PixImage | null>
  /** `BitmapRegionDecoder.recycle()` */
  recycle(): void
}

export interface RegionInt {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Decode seam. Everything platform-specific (BitmapFactory, Coil, BitmapRegionDecoder,
 * ConnectivityManager) lives behind this interface; the adapter is NOT in src/core.
 */
export interface PageSource {
  /** Browser decoders expose pixels, bounds and regions in EXIF display coordinates. */
  readonly normalizedLocalCoordinates?: boolean;
  /** `decodeLocal(path, maxEdge)` — EXIF-normalised, sample-size-bounded decode. */
  decodeLocal(path: string, maxEdge: number): Promise<PixImage | null>
  /** `decodeRemote(ref, maxEdge, onPreview)` — streaming preview support optional. */
  decodeRemote(
    ref: ComicPageRef,
    maxEdge: number,
    onPreview: ((partial: PixImage) => void) | null,
  ): Promise<PixImage | null>
  /** `BitmapFactory.decodeFile(path, Options{inJustDecodeBounds=true})` */
  probeBoundsLocal(path: string): Promise<RegionInt | null>
  /** `File(path).inputStream().read(ByteArray(1 shl 20))` */
  readFileHead(path: string, maxBytes: number): Promise<Uint8Array>
  /** Pooled region decoder for a local path; the pool recycles on eviction. */
  openRegion(path: string): Promise<RegionDecoderHandle | null>
  /** `Bitmap.createBitmap(raw, …, m, true)` — apply an EXIF display matrix. */
  transformExif(src: PixImage, m: ExifMatrix): Promise<PixImage>
  /** 1/6-downscaled then back up (透纸 soft blur) — codec-backed in the adapter. */
  scaleTo(src: PixImage, w: number, h: number): PixImage
  /** `ConnectivityManager` Wi-Fi / unmetered probe. */
  wifiConnectedOrUnmetered(): boolean
  /** `remoteImageLoader.memoryCache?.clear()` on OOM recovery. */
  clearRemoteMemoryCache(): void
}

/** `PreferencesManager(context).preloadWifiOnly` */
export interface PreloadPolicy {
  preloadWifiOnly(): boolean
}

/** WorkManager equivalent: fire-and-forget background work. */
export interface TaskRunner {
  run(task: () => Promise<void>): void
}

/** Dispatchers.IO equivalent. */
export interface IoRunner {
  run<T>(task: () => Promise<T>): Promise<T>
}

/* ══════════════ EXIF (L244–322, L626–635) ══════════════ */

/** One `android.graphics.Matrix` op, in application order (`setRotate` then `postScale`). */
export type ExifMatrix =
  | { readonly op: 'rotate'; readonly degrees: number }
  | { readonly op: 'rotateThenScaleX'; readonly degrees: number }
  | { readonly op: 'scaleX'; readonly factor: number }

/** orientation → 显示变换矩阵（null = 恒等）。Android 画廊同款表。 */
export function exifDisplayMatrix(orientation: number): ExifMatrix | null {
  switch (orientation) {
    case 2:
      return { op: 'scaleX', factor: -1 }
    case 3:
      return { op: 'rotate', degrees: 180 }
    case 4:
      return { op: 'rotateThenScaleX', degrees: 180 }
    case 5:
      return { op: 'rotateThenScaleX', degrees: 90 }
    case 6:
      return { op: 'rotate', degrees: 90 }
    case 7:
      return { op: 'rotateThenScaleX', degrees: -90 }
    case 8:
      return { op: 'rotate', degrees: -90 }
    default:
      return null
  }
}

/** 旋转 90/270（5/6/7/8）时宽高互换后的尺寸 */
export function exifSwappedSize(w: number, h: number, orientation: number): SizeI {
  return orientation >= 5 && orientation <= 8 ? { width: h, height: w } : { width: w, height: h }
}

/** 显示坐标 rect → 文件原始坐标（逆 EXIF 变换，corner 映射精确）。 */
export function exifRectToRaw(
  rect: RectF,
  rawW: number,
  rawH: number,
  orientation: number,
): RectF {
  switch (orientation) {
    case 2:
      return new RectF(rawW - rect.right, rect.top, rawW - rect.left, rect.bottom)
    case 3:
      return new RectF(rawW - rect.right, rawH - rect.bottom, rawW - rect.left, rawH - rect.top)
    case 4:
      return new RectF(rect.left, rawH - rect.bottom, rect.right, rawH - rect.top)
    case 5:
      return new RectF(rect.top, rect.left, rect.bottom, rect.right)
    case 6:
      return new RectF(rect.top, rawH - rect.right, rect.bottom, rawH - rect.left)
    case 7:
      return new RectF(rawW - rect.bottom, rawH - rect.right, rawW - rect.top, rawH - rect.left)
    case 8:
      return new RectF(rawW - rect.bottom, rect.left, rawW - rect.top, rect.right)
    default:
      return new RectF(rect.left, rect.top, rect.right, rect.bottom)
  }
}

/** TIFF 头（II/MM 字节序）→ IFD0 → tag 0x0112 orientation */
export function readOrientationFromTiff(b: Uint8Array, off: number, limit: number): number {
  if (off + 8 > limit) return 1
  let little: boolean
  if (b[off] === 0x49 && b[off + 1] === 0x49) little = true
  else if (b[off] === 0x4d && b[off + 1] === 0x4d) little = false
  else return 1
  const u16 = (p: number): number =>
    little
      ? (((b[p + 1] ?? 0) << 8) | (b[p] ?? 0)) >>> 0
      : (((b[p] ?? 0) << 8) | (b[p + 1] ?? 0)) >>> 0
  const u32 = (p: number): number => {
    let v = 0
    if (little) for (let k = 3; k >= 0; k--) v = ((v << 8) | (b[p + k] ?? 0)) >>> 0
    else for (let k = 0; k <= 3; k++) v = ((v << 8) | (b[p + k] ?? 0)) >>> 0
    return v
  }
  if (u16(off + 2) !== 42) return 1
  const ifd0 = u32(off + 4)
  if (off + ifd0 + 2 > limit) return 1
  const count = u16(off + ifd0)
  let e = off + ifd0 + 2
  for (let i = 0; i < count; i++) {
    if (e + 12 > limit) return 1
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
    e += 12
  }
  return 1
}

/**
 * JPEG APP1-Exif IFD 手写解析（免新增依赖）。PNG/WebP 无此标签不受影响。
 * `head` 是文件前 [limit] 字节。
 */
export function parseJpegExifOrientation(head: Uint8Array, n: number): number {
  if (n < 4 || head[0] !== 0xff || head[1] !== 0xd8) return 1
  let i = 2
  while (i + 4 <= n) {
    if (head[i] !== 0xff) return 1
    const marker = head[i + 1] ?? 0
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1 // SOS/EOI：没遇到 Exif
    const segLen = (((head[i + 2] ?? 0) << 8) | (head[i + 3] ?? 0)) >>> 0
    if (marker === 0xe1 && segLen >= 8 && i + 4 + 6 <= n) {
      // APP1 "Exif\0\0"
      if (
        head[i + 4] === 0x45 && // E
        head[i + 5] === 0x78 && // x
        head[i + 6] === 0x69 && // i
        head[i + 7] === 0x66 && // f
        head[i + 8] === 0x00 &&
        head[i + 9] === 0x00
      ) {
        return readOrientationFromTiff(head, i + 10, n)
      }
    }
    i += 2 + segLen
  }
  return 1
}

/* ══════════════ constants ══════════════ */

/** 解码/处理长边上限 */
export const DECODE_MAX_EDGE = 2800
/** 处理结果缓存：堆的 1/6（与 Coil 缓存错开） */
export const CACHE_FRACTION = 6
export const PREVIEW_CACHE_BYTES = 6 << 20
/** 窗口驻留扩容硬上限：min(堆 1/3, 128MB) */
export const WINDOW_RETAIN_CEIL_BYTES = 128 << 20
export const WINDOW_RETAIN_FRACTION = 3

export interface PageLoadResult {
  readonly bitmap: PixImage
  readonly fromCache: boolean
}

/** 预载窗口条目：一个显示槽位的完整加载参数（整窗一次提交） */
export interface WindowEntry {
  readonly ref: ComicPageRef
  readonly cacheKey: string
  readonly geo: Geometry
  readonly visible: boolean
}

/**
 * 页处理结果字节上界估计（纯函数）：内禀尺寸 → 解码等比缩 2800 →
 * 重管线档（WAIFU2X / SUPER_RES）按 `ComicEdgeUpscaler.targetSize` 放大 → 长边上限 3200。
 *
 * Kotlin L864–884 逐行对应。注意判定集合是 `{WAIFU2X, SUPER_RES}`：
 * 第 20 条的 ANIME4K 现在是「保边预降噪 → Restore CNN → EASU 目标尺寸」，
 * `anime4kUpscale`(WAIFU2X) 与 `superResolution` 都调 `targetSize`，所以只有这两档会放大。
 */
export function estimateProcessedBytes(
  w: number,
  h: number,
  enhanceMode: ComicEnhanceMode,
): number {
  if (w <= 0 || h <= 0) {
    return Number(
      enhanceMode === 'OFF' || enhanceMode === 'CAS' ? 2800n * 2000n * 4n : 3200n * 2286n * 4n,
    )
  }
  let long = BigInt(Math.max(w, h))
  let short = BigInt(Math.min(w, h))
  if (long > BigInt(DECODE_MAX_EDGE)) {
    short = (short * BigInt(DECODE_MAX_EDGE)) / long
    long = BigInt(DECODE_MAX_EDGE)
  }
  if (enhanceMode === 'WAIFU2X' || enhanceMode === 'SUPER_RES') {
    const [tl, ts] = edgeUpscalerTargetSize(Number(long), Math.max(1, Number(short)))
    long = BigInt(tl)
    short = BigInt(ts)
  }
  return Number(long * short * 4n)
}

/**
 * Bound allocation before decoding; shrinking afterwards still allocates the large scan.
 *
 * Kotlin L935–940 divides **Ints**: `while (long / sample > maxEdge) sample *= 2`. JS `/`
 * is float division, so without `Math.trunc` a 5602-long edge would compare 2801 > 2800
 * at sample=2 (Kotlin: 5602/2 == 2801 → also true) but 5601/2 == 2800.5 (Kotlin:
 * 2800 → false) and keep doubling to sample=4 — a 4× smaller decode than Android.
 */
export function sampleSizeFor(w: number, h: number, maxEdge: number): number {
  let sample = 1
  const long = Math.max(w, h)
  while (Math.trunc(long / sample) > maxEdge) sample *= 2
  return sample
}

/**
 * `loadPreview` 的小图缓存键（L539–541 的模板串逐字保留）。
 *
 * `${geo.manualCrop}` renders Kotlin's `List<Float>.toString()` — `[0.1, 0.2, 0.9, 0.8]`
 * with brackets and ", " separators — or the literal `"null"`, matching the Kotlin
 * `kotlinx` interpolation byte-for-byte. `${tone.gamma}` is a Kotlin `Float`, so it
 * renders `1.0` rather than JS `1`; `kotlinFloatToString` reproduces that. The key is
 * self-consistent (only ever produced here), so an exact match is not strictly required
 * for correctness, but the review brief requires the template to be verbatim.
 */
export function previewCacheKey(ref: ComicPageRef, geo: Geometry, tone: Toning): string {
  const crop =
    geo.manualCrop === null
      ? 'null'
      : `[${geo.manualCrop.map((v) => kotlinFloatToString(v)).join(', ')}]`
  return (
    `pv|${ref.id}|${geo.half}|${kotlinFloatToString(geo.splitPosition)}|` +
    `${geo.rotationDeg}|${geo.cropMode}|${crop}` +
    `|${tone.brightness},${tone.contrast},${tone.saturation},${tone.hue},${kotlinFloatToString(tone.gamma)},` +
    `${tone.sharpen},${tone.shadow},${tone.bw},${tone.enhanceMode},${tone.enhanceStrength}`
  )
}

/** `decodeRegion` 的缓存键。 */
export function regionCacheKey(
  refId: string,
  cacheTag: string,
  rect: RectF,
): string {
  return `rgn|${refId}|${cacheTag}|${rect.left | 0},${rect.top | 0},${rect.right | 0},${rect.bottom | 0}`
}

/* ══════════════ ComicPageLoader ══════════════ */

/**
 * 漫画页位图加载器：本地文件 / 在线 URL 统一处理。
 * - 解码 → 管线处理 → 内存 LRU 缓存（按字节计量）
 * - 并发去重（同页同参数只处理一次，异常路径同样清理）
 * - 相邻页预加载 + 尺寸探测（拆页判定需要原始内在尺寸）
 * - 独立的小图预览管线（滤镜实时预览用，不污染主缓存）
 */
export class ComicPageLoader {
  /* ── 尺寸状态（`MutableStateFlow<Map<String,SizeI>>` → listener registry） ── */
  private readonly sizeMap = new Map<string, SizeI>()
  private readonly sizesListeners = new Set<(sizes: ReadonlyMap<string, SizeI>) => void>()

  /** Observe `sizes` (the Kotlin `StateFlow<Map<String, SizeI>>`). */
  onSizesChanged(listener: (sizes: ReadonlyMap<string, SizeI>) => void): () => void {
    this.sizesListeners.add(listener)
    listener(this.sizesSnapshot())
    return () => this.sizesListeners.delete(listener)
  }

  sizesSnapshot(): ReadonlyMap<string, SizeI> {
    return new Map(this.sizeMap)
  }

  /** Coarse field read (Compose only read `loader.sizes.value[id]?.gutterPos`). */
  gutterPosOf(refId: string): number | null {
    const s = this.sizeMap.get(refId)
    if (s === undefined || s.gutterPos === undefined) return null
    return s.gutterPos
  }

  private readonly cacheBaseBytes: number

  /** 窗口驻留容量硬上限（5.5 修复）：下限恒为基础值——扩容只增不减到基础值以下。 */
  private readonly cacheRetainCeilBytes: number

  private readonly cache: ByteLruCache<PixImage>
  private readonly previewCache: ByteLruCache<PixImage>
  private readonly thumbCache: ByteLruCache<PixImage>
  private readonly regionCache: ByteLruCache<PixImage>
  private readonly readingPreviews: ByteLruCache<PixImage>

  /** 5.5 排查信标（debug only）。 */
  private readonly debugLog: ((msg: string) => void) | null
  cacheDbg(msg: string): void {
    this.debugLog?.(msg)
  }

  /** `BitmapRegionDecoder` 复用池（按路径，最多 4 个）。 */
  private decoderPool: ByteLruCache<RegionDecoderHandle>
  private readonly regionMutex = new KeyedMutex()

  /** 预取并发闸门：无界并行时 N 页全尺寸解码+管线峰值内存 = N×数十 MB */
  private readonly preloadGate = new Semaphore(2)
  private readonly decodeGate = new Semaphore(2)

  /** 逐像素增强管线并发闸门：内存护栏 */
  private readonly pixelOpGate = new Semaphore(1)

  private readonly inFlight = new ComicLoadLocks()
  private readonly terminalLoads = new CountLruCache<boolean>(256)
  private readonly availabilityListeners = new Set<() => void>()
  private foregroundKeys = new Set<string>()

  private readonly previewEpochListeners = new Set<(epoch: number) => void>()
  private previewEpochValue = 0

  /** EXIF orientation memo (`ConcurrentHashMap<String, Int>`). */
  private readonly exifCache = new Map<string, number>()

  /**
   * 增强结果磁盘持久化缓存（第七轮第 1 条子问题 B）：
   * 重管线档的处理结果跨会话复用。仅本地/在线页 id 稳定时有效。
   */
  private readonly diskCache: ComicProcessedDiskCache

  /** 页处理结果历史最大字节（ref.id 键控） */
  private readonly pageBytes = new Map<string, number>()

  /* ── 阅读窗口驻留（5.5 修复，方向 a：显式优先级强引用）── */
  private readonly pinned = new Map<string, PixImage>() // 插入序 = 驻留优先级（高→低）
  private pinnedBytes = 0
  private readonly windowKeys = new Set<string>() // 迭代序 = 窗口优先级（高→低）

  private readonly preloadJobs = new Map<string, Cancellable>()
  private cancelled = false

  constructor(
    private readonly deps: {
      source: PageSource
      diskStore: DiskCacheStore
      policy: PreloadPolicy
      tasks: TaskRunner
      io: IoRunner
      maxHeapBytes: number
      debugLog?: ((msg: string) => void) | null
    },
  ) {
    const heap = deps.maxHeapBytes
    this.cacheBaseBytes = Math.min(
      Math.max(Math.trunc(heap / CACHE_FRACTION), 24 << 20),
      96 << 20,
    )
    this.cacheRetainCeilBytes = Math.max(
      this.cacheBaseBytes,
      Math.min(Math.trunc(heap / WINDOW_RETAIN_FRACTION), WINDOW_RETAIN_CEIL_BYTES),
    )
    this.debugLog = deps.debugLog ?? null
    this.cache = new ByteLruCache<PixImage>(
      this.cacheBaseBytes,
      (_k, v) => v.width * v.height * 4,
      (evicted, key, old) => {
        // 5.5 排查信标（debug only）：逐出事件
        if (evicted && old !== undefined) {
          this.cacheDbg(`evict key=${key} bytes=${old.width * old.height * 4} max=${this.cache.maxSize()}`)
        }
      },
    )
    this.previewCache = new ByteLruCache<PixImage>(PREVIEW_CACHE_BYTES, (_k, v) => v.width * v.height * 4)
    this.thumbCache = new ByteLruCache<PixImage>(8 << 20, (_k, v) =>
      Math.max(1, v.width * v.height * 4),
    )
    this.regionCache = new ByteLruCache<PixImage>(32 << 20, (_k, v) =>
      Math.max(1, v.width * v.height * 4),
    )
    this.readingPreviews = new ByteLruCache<PixImage>(8 << 20, (_k, v) => v.width * v.height * 4)
    this.decoderPool = new ByteLruCache<RegionDecoderHandle>(
      4,
      () => 1,
      (_evicted, _key, old) => {
        try {
          old?.recycle()
        } catch {
          /* runCatching { oldValue.recycle() } */
        }
      },
    )
    this.diskCache = new ComicProcessedDiskCache(deps.diskStore)
  }

  /* ══════════ 5.5 修复：读取路径 ══════════ */

  /**
   * All renderer modes share visible-page priority, Wi-Fi policy and preload limits.
   * `visible` pages skip the preload gate; neighbours wait for foreground + gate.
   */
  async loadForDisplay(
    ref: ComicPageRef,
    cacheKey: string,
    geo: Geometry,
    tone: Toning,
    visible: boolean,
  ): Promise<PageLoadResult> {
    if (visible) return this.load(ref, cacheKey, geo, tone)
    const cached = this.cachedOrPinned(cacheKey)
    if (cached !== null) return { bitmap: cached, fromCache: true }
    if (
      ref.kind === 'Remote' &&
      this.deps.policy.preloadWifiOnly() &&
      !this.deps.source.wifiConnectedOrUnmetered()
    ) {
      // Promotion to a visible page restarts its producer and bypasses this wait.
      return this.neverResolving()
    }
    return this.preloadGate.withPermit(async () => {
      if (ref.kind === 'Remote') await this.awaitForeground()
      return this.load(ref, cacheKey, geo, tone)
    })
  }

  /** `kotlinx.coroutines.awaitCancellation()` — a promise that never settles. */
  private neverResolving<T>(): Promise<T> {
    return new Promise<T>(() => {})
  }

  private awaitForeground(): Promise<void> {
    const ok = (): boolean => {
      for (const key of this.foregroundKeys) {
        if (this.peekProcessed(key) === null && this.terminalLoads.get(key) === undefined) {
          return false
        }
      }
      return true
    }
    if (ok()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (ok()) {
          this.availabilityListeners.delete(check)
          resolve()
        }
      }
      this.availabilityListeners.add(check)
    })
  }

  /**
   * 同步窥探处理结果缓存（第六轮族 A 根治）：组合期初值播种用。
   * 窗口驻留页可能已被 LRU 逐出但仍在驻留表——同样命中。
   */
  peekProcessed(cacheKey: string): PixImage | null {
    const lru = this.cache.get(cacheKey)
    if (lru !== undefined) return lru
    return this.pinned.get(cacheKey) ?? null
  }

  /** 测试专用：直接预填处理结果缓存（验证组合期播种语义）。 */
  putProcessedForTest(cacheKey: string, bmp: PixImage): void {
    this.cache.put(cacheKey, bmp)
  }

  /**
   * 漫画翻译（第十五轮）：以烘焙了译文的位图替换缓存中的原位图（同 key 覆盖）。
   * 不回收旧位图——替换后旧引用交由 GC。
   */
  replaceProcessed(cacheKey: string, baked: PixImage): void {
    this.cache.put(cacheKey, baked)
    if (this.windowKeys.has(cacheKey)) {
      const old = this.pinned.get(cacheKey)
      if (old !== undefined) this.pinnedBytes -= old.width * old.height * 4
      this.pinned.set(cacheKey, baked)
      this.pinnedBytes += baked.width * baked.height * 4
    }
  }

  /** 漫画翻译关闭/缩放变更时：解除单键驻留并移出缓存（不回收，防在用崩溃）。 */
  evictProcessed(cacheKey: string): void {
    this.cache.remove(cacheKey)
    const old = this.pinned.get(cacheKey)
    if (old !== undefined) this.pinnedBytes -= old.width * old.height * 4
    this.pinned.delete(cacheKey)
    this.windowKeys.delete(cacheKey)
  }

  /* ══════════ EXIF 方向归一化（第六轮第 4 条现象三） ══════════ */

  /** JPEG EXIF orientation（1..8；解析失败/无标签=1） */
  async exifOrientationOf(path: string): Promise<number> {
    if (this.deps.source.normalizedLocalCoordinates) return 1;
    const hit = this.exifCache.get(path)
    if (hit !== undefined) return hit
    let v = 1
    try {
      // IFD0 通常在文件头几 KB 内
      const head = await this.deps.source.readFileHead(path, 1 << 20)
      v = parseJpegExifOrientation(head, head.length)
    } catch {
      v = 1
    }
    this.exifCache.set(path, v)
    return v
  }

  /** 取消后台预取作业（阅读器退出时调用） */
  shutdown(): void {
    this.cancelled = true
    for (const job of this.preloadJobs.values()) job.cancel()
    this.preloadJobs.clear()
    this.readingPreviews.evictAll()
    this.pinned.clear()
    this.pinnedBytes = 0
    this.windowKeys.clear()
    // 释放 decoder 池持有的 native 文件句柄（最多 4 个）
    this.regionMutex.tryWithLock(() => this.decoderPool.evictAll())
  }

  /* ══════════ 加载并处理一页 ══════════ */

  /**
   * 加载并处理一页。cacheKey 相同的请求共享一次处理。
   * 逐像素增强经并发闸门串行化，防并行峰值内存翻倍。
   */
  async load(
    ref: ComicPageRef,
    cacheKey: string,
    geo: Geometry,
    tone: Toning,
  ): Promise<PageLoadResult> {
    const warm = this.cachedOrPinned(cacheKey)
    if (warm !== null) return { bitmap: warm, fromCache: true }
    this.terminalLoads.remove(cacheKey)
    const mutex = this.inFlight.acquire(cacheKey)
    let finished = false
    try {
      // 第七轮第 1 条子问题 A：处理失败的原图不允许进入任何缓存层——失败结果
      // 只保显示、不驻留。
      let failedFallback = false
      const bitmap = await mutex.withLock(async () => {
        const again = this.cachedOrPinned(cacheKey)
        if (again !== null) return again
        // 磁盘持久化命中（仅重管线档）：免解码+免推理直接用，并回填内存 LRU
        if (this.diskEligible(tone.enhanceMode)) {
          const fromDisk = await this.deps.io.run(() => this.diskCache.read(cacheKey))
          if (fromDisk !== null) {
            if (!this.sizeMap.has(ref.id)) {
              this.putSize(ref.id, { width: fromDisk.width, height: fromDisk.height })
            }
            this.cache.put(cacheKey, fromDisk)
            return fromDisk
          }
        }
        const raw = await this.decodeRaw(ref, DECODE_MAX_EDGE, (partial) => {
          // 组合期预览：只几何/色调（无增强），避免双份推理；从不进入最终结果缓存
          this.publishReadingPreview(cacheKey, partial, geo)
        })
        if (raw === null) {
          throw new Error(`图片解码失败: ${ref.id}`)
        }
        // 记录原始内在尺寸（区域重解码坐标换算与拆页判定基准）
        if (!this.sizeMap.has(ref.id)) {
          if (ref.kind === 'Local') {
            try {
              const bounds = await this.deps.io.run(() => this.deps.source.probeBoundsLocal(ref.path))
              if (bounds !== null && bounds.right > 0 && bounds.bottom > 0) {
                const o = await this.exifOrientationOf(ref.path)
                this.putSize(
                  ref.id,
                  exifSwappedSize(bounds.right, bounds.bottom, o),
                )
              }
            } catch {
              /* runCatching { … } */
            }
          } else {
            this.putSize(ref.id, { width: raw.width, height: raw.height })
          }
        }
        // 本地宽页：随加载顺带做中央装订缝探测（复用已解码位图，零额外解码）。
        // 第 19 条：保留缝的精确位置（拆分落点用），不止是布尔结论。
        if (ref.kind === 'Local') {
          const sz = this.sizeMap.get(ref.id)
          if (sz !== undefined && sz.gutter === undefined && this.probeGutter) {
            const a = raw.width / raw.height
            if (a >= 1.35 && a < 1.8) {
              const diag = this.probeGutter(raw)
              if (diag !== null) {
                const base = this.sizeMap.get(ref.id) ?? { width: raw.width, height: raw.height }
                this.updateSize(ref.id, {
                  ...base,
                  gutter: diag.isGutter,
                  ...(diag.isGutter ? { gutterPos: diag.position } : { gutterPos: null }),
                })
              }
            }
          }
        }
        // 管线异常语义：处理失败时返回原图保显示，但不写入缓存。
        // 第六轮族 A 根治：管线无任务时解码位图就是该 cacheKey 的确定性最终结果
        const didWork = hasWork(geo, tone)
        // One download. Publish a correctly cropped/rotated readable preview before
        // waiting for expensive enhancement. It never enters the final-result cache.
        if (ref.kind === 'Remote' && toningHasWork(tone)) {
          try {
            this.publishReadingPreview(
              cacheKey,
              this.capEdge(raw, 960),
              geo,
            )
          } catch {
            /* Preview failure does not block the full page. */
          }
        }
        let processed: PixImage | null = null
        if (didWork) {
          // 闸门覆盖所有重活：增强内核 + 锐化 + LUT/色矩阵类调色
          const heavy = toningHasWork(tone)
          const run = async (): Promise<PixImage | null> => {
            if (this.processor === null) return null
            try {
              return await this.processor(raw, geo, tone)
            } catch {
              return null
            }
          }
          processed = heavy
            ? await this.pixelOpGate.withPermit(run)
            : await run()
        }
        if (processed !== null) {
          this.cache.put(cacheKey, processed)
          // 重管线档结果异步落盘（无损编码；失败静默）
          if (this.diskEligible(tone.enhanceMode)) {
            const toStore = processed
            this.deps.tasks.run(async () => {
              try {
                await this.diskCache.write(cacheKey, toStore)
              } catch {
                /* 磁盘缓存只是加速器 */
              }
            })
          }
          return processed
        }
        if (!didWork) {
          // 无管线任务：解码结果即最终结果，确定性缓存
          this.cache.put(cacheKey, raw)
          return raw
        }
        // 处理失败（真异常）：显示原图、不缓存、不驻留（下次进入自动重试管线）
        failedFallback = true
        return raw
      })
      this.recordPageBytes(ref, bitmap)
      this.cacheDbg(
        `put key=${cacheKey} bytes=${bitmap.width * bitmap.height * 4} max=${this.cache.maxSize()}`,
      )
      if (!failedFallback) this.pinIfWindowed(cacheKey, bitmap)
      finished = true
      return { bitmap, fromCache: false }
    } finally {
      if (finished) this.terminalLoads.put(cacheKey, finished)
      this.bumpAvailability()
      // Keep the lock registered while other callers are still waiting on it.
      this.inFlight.release(cacheKey)
    }
  }

  private diskEligible(mode: ComicEnhanceMode): boolean {
    return mode === 'ANIME4K' || mode === 'WAIFU2X' || mode === 'SUPER_RES'
  }

  /* ── 注入的像素/装订缝探测钩子（由 UI 层注入，避免 src/core 依赖 raster） ── */

  /**
   * `ComicImagePipeline.process(raw, geo, tone)` — injected so this module stays free of
   * the raster seam. Wired by the platform layer to the real pipeline.
   */
  processor: ((src: PixImage, geo: Geometry, tone: Toning) => PixImage | Promise<PixImage>) | null = null

  /** `ComicImagePipeline.process(partial, geo, Toning())` for streaming previews. */
  previewProcessor:
    | ((src: PixImage, geo: Geometry, tone: Toning) => PixImage)
    | null = null

  /** `ComicImagePipeline.detectCenterGutterDetail(raw)` */
  probeGutter: ((raw: PixImage) => { isGutter: boolean; position: number } | null) | null = null

  private bumpAvailability(): void {
    for (const l of [...this.availabilityListeners]) l()
  }

  /* ══════════ 预览 epoch ══════════ */

  /** Observe `previewEpoch` (`MutableStateFlow<Long>`). */
  onPreviewEpoch(listener: (epoch: number) => void): () => void {
    this.previewEpochListeners.add(listener)
    return () => this.previewEpochListeners.delete(listener)
  }

  peekReadingPreview(key: string): PixImage | null {
    return this.readingPreviews.get(key) ?? null
  }

  /** Publish a readable preview for `cacheKey` (never enters the final-result cache). */
  publishReadingPreview(
    key: string,
    partial: PixImage,
    geo: Geometry,
  ): boolean {
    if (this.previewProcessor === null) return false
    try {
      const preview = this.previewProcessor(partial, geo, NO_TONING)
      this.readingPreviews.put(key, preview)
      this.previewEpochValue++
      for (const l of [...this.previewEpochListeners]) l(this.previewEpochValue)
      return true
    } catch {
      return false
    }
  }

  /* ══════════ 缓存/驻留表 ══════════ */

  /** LRU + 驻留表联合读取（驻留命中时回填 LRU，恢复常规近期性） */
  cachedOrPinned(cacheKey: string): PixImage | null {
    const lru = this.cache.get(cacheKey)
    if (lru !== undefined) return lru
    const pinnedHit = this.pinned.get(cacheKey)
    if (pinnedHit === undefined) return null
    this.cache.put(cacheKey, pinnedHit)
    return pinnedHit
  }

  /** 记录页处理结果实际字节（取历史最大，覆盖半页/整页变体） */
  private recordPageBytes(ref: ComicPageRef, bitmap: PixImage): void {
    const n = bitmap.width * bitmap.height * 4
    const prev = this.pageBytes.get(ref.id) ?? 0
    if (n > prev) this.pageBytes.set(ref.id, n)
  }

  /**
   * 加载完成的页若属于当前预载窗口，按窗口优先级序补入驻留表
   * （完成顺序 ≠ 优先级序——统一按 windowKeys 迭代序重建，超限丢尾部）
   */
  private pinIfWindowed(cacheKey: string, bitmap: PixImage): void {
    if (!this.windowKeys.has(cacheKey)) return
    this.pinned.set(cacheKey, bitmap)
    this.rebuildPinnedInPriorityOrder()
  }

  /** 按 windowKeys 优先级序重建驻留表，预算超限从尾部（最低优先级）丢弃 */
  private rebuildPinnedInPriorityOrder(): void {
    let budget = this.cacheRetainCeilBytes
    const rebuilt = new Map<string, PixImage>()
    for (const k of this.windowKeys) {
      const b = this.pinned.get(k)
      if (b === undefined) continue
      const n = b.width * b.height * 4
      if (n <= budget) {
        rebuilt.set(k, b)
        budget -= n
      }
    }
    this.pinnedBytes = this.cacheRetainCeilBytes - budget
    this.pinned.clear()
    for (const [k, v] of rebuilt) this.pinned.set(k, v)
  }

  /* ══════════ 预览管线 ══════════ */

  /**
   * 预览管线：小图（≤540px）+ 独立缓存，用于设置面板实时预览，
   * 不重处理全尺寸页、不挤占主缓存。
   */
  async loadPreview(
    ref: ComicPageRef,
    geo: Geometry,
    tone: Toning,
  ): Promise<PixImage | null> {
    const key = previewCacheKey(ref, geo, tone)
    const hit = this.previewCache.get(key)
    if (hit !== undefined) return hit
    const small = await this.decodeRaw(ref, 540, null)
    if (small === null) return null
    let out = small
    if (this.processor !== null) {
      try {
        out = await this.processor(small, geo, tone)
      } catch {
        out = small
      }
    }
    this.previewCache.put(key, out)
    return out
  }

  /** 进度缩略图 */
  async loadThumb(ref: ComicPageRef, edge = 220): Promise<PixImage | null> {
    const key = `thumb|${ref.id}|${edge}`
    const hit = this.thumbCache.get(key)
    if (hit !== undefined) return hit
    const bmp = await this.decodeRaw(ref, edge, null)
    if (bmp === null) return null
    this.thumbCache.put(key, bmp)
    return bmp
  }

  /* ══════════ 区域重解码 ══════════ */

  /**
   * 高倍缩放区域重解码：当显示比例超过已解码分辨率时，对当前可视区域按原始像素
   * 重新解码，深放大下细节不再受 2800px 全页解码上限约束。仅本地文件。
   *
   * @param rect 可视区域（**EXIF 归一化后**的显示坐标系像素）
   */
  async decodeRegion(
    ref: ComicPageRef,
    rect: RectF,
    targetEdge = DECODE_MAX_EDGE,
    cacheTag = '',
  ): Promise<PixImage | null> {
    if (ref.kind !== 'Local') return null
    if (rect.width() < 8 || rect.height() < 8) return null
    const key = regionCacheKey(ref.id, cacheTag, rect)
    const hit = this.regionCache.get(key)
    if (hit !== undefined) return hit
    return this.regionMutex.withLock(async () => {
      try {
        return await this.deps.io.run(async () => {
          const decoder = await this.acquireDecoder(ref.path)
          if (decoder === null) return null
          const iw = decoder.width
          const ih = decoder.height
          if (iw <= 0 || ih <= 0) return null
          // rect 在 EXIF 归一化坐标系：先映射回文件原始坐标再解码
          const o = await this.exifOrientationOf(ref.path)
          const rawRect = exifRectToRaw(rect, iw, ih, o)
          // 区域夹取到图像范围内
          const r: RegionInt = {
            left: Math.min(Math.max(rawRect.left | 0, 0), iw - 1),
            top: Math.min(Math.max(rawRect.top | 0, 0), ih - 1),
            right: Math.min(Math.max(rawRect.right | 0, 1), iw),
            bottom: Math.min(Math.max(rawRect.bottom | 0, 1), ih),
          }
          // 采样率：区域长边解码后不超过 targetEdge
          // (Kotlin computes `longEdge` from the clamped rect, then halves `sample`;
          //  `sampleSizeFor` re-derives the same long edge from the same rect.)
          const sample = sampleSizeFor(r.right - r.left, r.bottom - r.top, targetEdge)
          const raw = await decoder.decodeRegion(r, sample)
          if (raw === null) return null
          // 输出应用同一 EXIF 显示变换，与底层全页位图同向
          const m = exifDisplayMatrix(o)
          const bmp = m === null ? raw : await this.deps.source.transformExif(raw, m)
          this.regionCache.put(key, bmp)
          return bmp
        })
      } catch {
        return null
      }
    })
  }

  /** Pooled decoder: `decoderPool.get(path)` or open + put. */
  private async acquireDecoder(path: string): Promise<RegionDecoderHandle | null> {
    const hit = this.decoderPool.get(path)
    if (hit !== undefined) return hit
    const d = await this.deps.source.openRegion(path)
    if (d === null) return null
    this.decoderPool.put(path, d)
    return d
  }

  /* ══════════ 尺寸探测 ══════════ */

  /** 预取原始尺寸（本地文件仅解码边界，非常廉价）；远程跳过 */
  probeSize(ref: ComicPageRef): void {
    if (this.sizeMap.has(ref.id)) return
    if (ref.kind === 'Local') {
      this.deps.tasks.run(async () => {
        await this.probeLocalSize(ref)
      })
    }
  }

  /** 批量顺序预取（单协程逐个进行，避免瞬时抢占 CPU） */
  probeSizes(refs: ReadonlyArray<ComicPageRef>): void {
    this.deps.tasks.run(async () => {
      for (const ref of refs) {
        if (ref.kind === 'Local' && !this.sizeMap.has(ref.id)) {
          await this.probeLocalSize(ref)
        }
      }
    })
  }

  private async probeLocalSize(ref: ComicPageRef): Promise<void> {
    if (ref.kind !== 'Local') return
    try {
      const bounds = await this.deps.io.run(() => this.deps.source.probeBoundsLocal(ref.path))
      if (bounds !== null && bounds.right > 0 && bounds.bottom > 0) {
        // EXIF 旋转后的显示尺寸（与 decodeLocal 的归一化输出一致）
        const o = await this.exifOrientationOf(ref.path)
        this.putSize(ref.id, exifSwappedSize(bounds.right, bounds.bottom, o))
      }
    } catch {
      /* runCatching { … } */
    }
  }

  private putSize(id: string, size: SizeI): void {
    if (this.sizeMap.has(id)) return
    this.sizeMap.set(id, size)
    this.emitSizes()
  }

  private updateSize(id: string, size: SizeI): void {
    this.sizeMap.set(id, size)
    this.emitSizes()
  }

  private emitSizes(): void {
    const snap = this.sizesSnapshot()
    for (const l of [...this.sizesListeners]) l(snap)
  }

  /* ══════════ 预加载窗口 ══════════ */

  /**
   * 批量预加载（整窗一次调用，5.5 修复）。旧 API 按单页逐次调用时，每次调用的
   * "批次外取消"会立即取消同窗口其它槽位刚入队的任务。现在整窗一次提交，按序原子完成：
   * 1) [ensureWindowCapacity] 主 LRU 扩容到能容纳整个窗口；
   * 2) 驻留表同步（入窗驻留、离窗解除，预算内按传入优先级保留）；
   * 3) 未命中页全部入队（并发闸门内解码+处理）；
   * 4) 批次外的旧预取任务取消（快速翻页节流）。
   */
  preloadWindow(entries: ReadonlyArray<WindowEntry>, tone: Toning): void {
    // 仅 Wi-Fi 预加载：非 Wi-Fi 且是计费网络时，跳过在线页的提前下载
    const effective =
      this.deps.policy.preloadWifiOnly() && !this.deps.source.wifiConnectedOrUnmetered()
        ? entries.filter((it) => it.visible || it.ref.kind !== 'Remote')
        : entries
    const newForeground = new Set(effective.filter((it) => it.visible).map((it) => it.cacheKey))
    if (!sameSet(newForeground, this.foregroundKeys)) {
      for (const k of newForeground) this.terminalLoads.remove(k)
      let anyPending = false
      for (const k of newForeground) {
        if (this.peekProcessed(k) === null) {
          anyPending = true
          break
        }
      }
      if (anyPending) {
        for (const [key, job] of [...this.preloadJobs]) {
          // Preserve an in-flight request that has become the foreground page.
          if (!newForeground.has(key)) {
            job.cancel()
            this.preloadJobs.delete(key)
          }
        }
      }
    }
    this.foregroundKeys = newForeground
    this.bumpAvailability()
    this.ensureWindowCapacity(effective, tone)
    this.cacheDbg(`window keys=${effective.map((e) => e.cacheKey).join(' ')}`)
    // 驻留表同步：离窗解除；按优先级序重建（超限丢尾部）
    const oldPinned = new Map(this.pinned)
    this.pinned.clear()
    for (const e of effective) {
      const found = this.cache.get(e.cacheKey) ?? oldPinned.get(e.cacheKey)
      if (found !== undefined) this.pinned.set(e.cacheKey, found)
    }
    this.rebuildPinnedInPriorityOrder()
    this.windowKeys.clear()
    for (const e of effective) this.windowKeys.add(e.cacheKey)

    const batchKeys = new Set<string>()
    for (const e of effective) {
      batchKeys.add(e.cacheKey)
      const probeHit = this.cachedOrPinned(e.cacheKey)
      this.cacheDbg(`probe key=${e.ref.id} hit=${probeHit !== null}`)
      // Visible pages have their own foreground producer and never wait for this gate.
      if (probeHit === null && !e.visible && !this.preloadJobs.has(e.cacheKey)) {
        this.startPreload(e, tone)
      }
    }
    // 取消已不在当前窗口的等待中任务（快速翻页旧页预取）
    for (const [k, job] of [...this.preloadJobs]) {
      if (!batchKeys.has(k)) {
        job.cancel()
        this.preloadJobs.delete(k)
      }
    }
  }

  private startPreload(e: WindowEntry, tone: Toning): void {
    let aborted = false
    const handle: Cancellable = {
      cancel: () => {
        aborted = true
      },
    }
    this.preloadJobs.set(e.cacheKey, handle)
    this.deps.tasks.run(async () => {
      try {
        // 并发闸门：最多 2 页同时解码+处理（无界并行峰值内存 = N×数十 MB）
        await this.preloadGate.withPermit(async () => {
          if (aborted || this.cancelled) return
          if (e.ref.kind === 'Remote') await this.awaitForeground()
          if (aborted || this.cancelled) return
          try {
            await this.load(e.ref, e.cacheKey, e.geo, tone)
          } catch {
            /* runCatching { load(…) } */
          }
        })
      } finally {
        // 条件移除：仅当映射仍是自己（被新任务顶替时不误删）
        if (this.preloadJobs.get(e.cacheKey) === handle) this.preloadJobs.delete(e.cacheKey)
      }
    })
  }

  /**
   * 窗口容量保障（5.5 修复方向 c）：主 LRU 上限 = 堆 1/6（24-96MB），而单页处理
   * 结果最高 ~29MB，预载窗口字节量轻松超过上限——窗口页在翻到之前被逐出。
   * 目标值钳在 [基础上限, 窗口驻留硬上限]。
   */
  ensureWindowCapacity(entries: ReadonlyArray<WindowEntry>, tone: Toning): void {
    let needed = 0n
    for (const e of entries) {
      const measured = this.pageBytes.get(e.ref.id)
      if (measured !== undefined) {
        needed += BigInt(measured)
        continue
      }
      const s = this.sizeMap.get(e.ref.id)
      needed += BigInt(estimateProcessedBytes(s?.width ?? 0, s?.height ?? 0, tone.enhanceMode))
    }
    const base = BigInt(this.cacheBaseBytes)
    const ceil_ = BigInt(this.cacheRetainCeilBytes)
    const target = Number(
      needed > base ? (needed < ceil_ ? needed : ceil_) : base,
    )
    if (target !== this.cache.maxSize()) {
      this.cacheDbg(`resize needed=${needed} target=${target} from=${this.cache.maxSize()}`)
      this.cache.resize(target)
    }
  }

  /* ══════════ 测试专用访问器 ══════════ */

  /** 测试专用：当前主缓存上限（窗口驻留扩容断言用） */
  cacheLimitForTest(): number {
    return this.cache.maxSize()
  }

  /** 测试专用：存活预载任务键集（整窗入队/批次外取消语义断言用） */
  activePreloadKeysForTest(): Set<string> {
    return new Set(this.preloadJobs.keys())
  }

  /** 测试专用：驻留表键序（优先级序契约断言用：当前→下一→上一/前瞻近→远） */
  pinnedOrderForTest(): string[] {
    return [...this.pinned.keys()]
  }

  /* ══════════ 解码 ══════════ */

  private async decodeRaw(
    ref: ComicPageRef,
    maxEdge = DECODE_MAX_EDGE,
    onPreview: ((partial: PixImage) => void) | null,
  ): Promise<PixImage | null> {
    return this.decodeGate.withPermit(async () => {
      const decode = (edge: number): Promise<PixImage | null> => {
        switch (ref.kind) {
          case 'Local':
            return this.deps.source.decodeLocal(ref.path, edge)
          case 'Remote':
            return this.deps.source.decodeRemote(ref, edge, onPreview)
        }
      }
      let decoded: PixImage | null
      try {
        decoded = await decode(maxEdge)
      } catch (e) {
        // Large scans must produce a readable page or a retry state, not kill the reader.
        // Preserve referenced bitmaps; only release cache ownership.
        //
        // Kotlin enters this branch only on `OutOfMemoryError`; any other throwable
        // propagates so `load()` surfaces the real failure. JS has no OOM class, so
        // re-throw unless the error is allocation-shaped (RangeError from a typed-array
        // allocation, or a DOMException whose name mentions allocation) — otherwise a
        // plain 404 would silently wipe the processed cache and retry at 1280px.
        if (!isAllocationFailure(e)) throw e
        this.clearProcessedCache()
        this.deps.source.clearRemoteMemoryCache()
        try {
          decoded = await decode(Math.min(maxEdge, 1280))
        } catch {
          throw new Error('页面过大，内存不足，请重试')
        }
      }
      return decoded === null ? null : this.capEdge(decoded, maxEdge)
    })
  }

  private capEdge(src: PixImage, maxEdge: number): PixImage {
    const long = Math.max(src.width, src.height)
    if (long <= maxEdge) return src
    const scale = maxEdge / long
    // 不 recycle：src 可能是 Coil 内存缓存中的共享实例
    return this.deps.source.scaleTo(
      src,
      Math.max(1, Math.trunc(src.width * scale)),
      Math.max(1, Math.trunc(src.height * scale)),
    )
  }

  clearProcessedCache(): void {
    this.cache.evictAll()
    // 驻留键含管线指纹：配置变更后旧键全失效，一并清空（防陈旧位图继续显示）
    this.pinned.clear()
    this.pinnedBytes = 0
    this.windowKeys.clear()
    this.previewCache.evictAll()
    this.readingPreviews.evictAll()
    // regionCache 条目虽含指纹 key，但陈旧 tile 仍占 32MB LRU 空间——一并清空
    this.regionCache.evictAll()
    // decoder 池同样回收：必须先拿 regionMutex（与进行中的 decodeRegion 并发
    // recycle 正在使用的 decoder 会崩溃）；拿不到锁就跳过（shutdown 路径兜底）
    this.regionMutex.tryWithLock(() => this.decoderPool.evictAll())
  }
}

/** `comicImagePipeline.Toning()` — the neutral preview toning (Kotlin L385/433). */
const NO_TONING: Toning = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  gamma: 1,
  sharpen: 0,
  shadow: 0,
  bw: false,
  enhanceMode: 'OFF',
  enhanceStrength: 60,
}

/** Cancellable preload job handle. */
export interface Cancellable {
  cancel(): void
}

/**
 * JS stand-in for Kotlin's `catch (oom: OutOfMemoryError)` in `decodeRaw`: recognises
 * the two allocation-shaped failures a browser surfaces (an oversized typed-array /
 * ImageData allocation raises `RangeError`; WebGL/wasm allocation raises a
 * `DOMException`/`RangeError` naming allocation). Everything else is a real decode error.
 */
function isAllocationFailure(e: unknown): boolean {
  if (e instanceof RangeError) return true
  if (typeof e === 'object' && e !== null && 'name' in e) {
    const name = String((e as { name: unknown }).name)
    return name === 'RangeError' || name === 'QuotaExceededError' || name === 'OutOfMemoryError'
  }
  return false
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/** Re-exported so callers can build a default Geometry without importing the pipeline. */
export { DEFAULT_GEOMETRY }

/** `ComicPageLayout.ComicPageLayout.WIDE_ASPECT` gate used by the gutter probe. */
export const COMIC_SPLIT_HALF_DEFAULT: ComicSplitHalf = 'FULL'

/** `ComicBookState` subset accepted by the loader's cache keys. */
export type { ComicBookStateSubset, ComicConfigSubset }

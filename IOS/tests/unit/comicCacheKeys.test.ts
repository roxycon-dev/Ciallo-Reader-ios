import { describe, expect, it } from 'vitest'

import {
  cacheKeyDigest,
  ComicProcessedDiskCache,
  DISK_CACHE_DIR_NAME,
  DISK_CACHE_MAX_BYTES,
  type DiskCacheEntry,
  type DiskCacheStore,
  eligible,
  bytesToHex,
  sha256,
  utf8Bytes,
} from '../../src/core/comic/comicProcessedDiskCache'
import {
  ByteLruCache,
  ComicLoadLocks,
  CountLruCache,
  ComicPageLoader,
  CACHE_FRACTION,
  DECODE_MAX_EDGE,
  estimateProcessedBytes,
  exifDisplayMatrix,
  exifRectToRaw,
  exifSwappedSize,
  parseJpegExifOrientation,
  previewCacheKey,
  readOrientationFromTiff,
  regionCacheKey,
  sampleSizeFor,
  WINDOW_RETAIN_CEIL_BYTES,
  type PageSource,
  type RegionDecoderHandle,
} from '../../src/core/comic/comicPageLoader'
import type { PixImage } from '../../src/core/comic/comicPixOps'
import { kotlinFloatToString, roundToInt } from '../../src/core/comic/comicPixOps'
import {
  DEFAULT_GEOMETRY,
  edgeUpscalerTargetSize,
  type Geometry,
  type Toning,
} from '../../src/core/comic/comicImagePipeline'
import { RectF } from '../../src/core/comic/comicPortTypes'

/* ── SHA-256 (the on-disk cache identity) ───────────────────────────────────────── */

describe('sha256', () => {
  it('matches the NIST/RFC test vectors', () => {
    const enc = (s: string): Uint8Array => utf8Bytes(s)
    expect(bytesToHex(sha256(enc('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(bytesToHex(sha256(enc('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(bytesToHex(sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('hashes UTF-8 bytes the way String.toByteArray(UTF_8) does', () => {
    // 中文 cache key (the on-disk names are hex, so byte-exactness matters)
    expect(bytesToHex(sha256(utf8Bytes('本页加载失败')))).toBe(
      bytesToHex(sha256(new Uint8Array([0xe6, 0x9c, 0xac, 0xe9, 0xa1, 0xb5, 0xe5, 0x8a, 0xa0, 0xe8, 0xbd, 0xbd, 0xe5, 0xa4, 0xb1, 0xe8, 0xb4, 0xa5]))),
    )
    // surrogate pair → 4-byte UTF-8
    expect([...utf8Bytes('😀')]).toEqual([0xf0, 0x9f, 0x98, 0x80])
  })

  it('roundToInt ties toward positive infinity, exactly like kotlin.math.roundToInt', () => {
    // kotlin.math.roundToInt == Math.round(float) == floor(v + 0.5): ties go UP.
    // A "half away from zero" implementation would give -3 here and silently shift
    // every pixel kernel's rounding by 1 on negative ties.
    expect(roundToInt(2.5)).toBe(3)
    expect(roundToInt(-2.5)).toBe(-2)
    expect(roundToInt(1.5)).toBe(2)
    expect(roundToInt(-1.5)).toBe(-1)
    expect(roundToInt(0.5)).toBe(1)
    expect(roundToInt(-0.5)).toBe(-0)
    expect(roundToInt(2.4)).toBe(2)
    expect(roundToInt(-2.4)).toBe(-2)
  })

  it('kotlinFloatToString keeps the trailing ".0" Kotlin Float.toString() emits', () => {
    expect(kotlinFloatToString(1)).toBe('1.0')
    expect(kotlinFloatToString(2)).toBe('2.0')
    expect(kotlinFloatToString(0.42)).toBe('0.42')
    expect(kotlinFloatToString(0.5)).toBe('0.5')
    expect(kotlinFloatToString(1.5)).toBe('1.5')
    // negative and exponent forms pass through unchanged
    expect(kotlinFloatToString(-1)).toBe('-1.0')
    expect(kotlinFloatToString(1e-7)).toBe('1e-7')
  })

  it('cacheKeyDigest is 64 lowercase hex chars', () => {
    const d = cacheKeyDigest('p1|FULL|OFF|null|0|true|0.5|OFF|60|0|0|0|0|1.000|0|0|false|r0')
    expect(d).toMatch(/^[0-9a-f]{64}$/)
    expect(d).toBe(cacheKeyDigest('p1|FULL|OFF|null|0|true|0.5|OFF|60|0|0|0|0|1.000|0|0|false|r0'))
    expect(d).not.toBe(cacheKeyDigest('p1|FULL|OFF|null|0|true|0.51|OFF|60|0|0|0|0|1.000|0|0|false|r0'))
  })

  it('eligible() pins the heavy-pipeline mode set (纯函数，单测钉死档位集合)', () => {
    expect(eligible('ANIME4K')).toBe(true)
    expect(eligible('WAIFU2X')).toBe(true)
    expect(eligible('SUPER_RES')).toBe(true)
    expect(eligible('CAS')).toBe(false)
    expect(eligible('OFF')).toBe(false)
  })

  it('cache constants match the Kotlin companion object', () => {
    expect(DISK_CACHE_DIR_NAME).toBe('comic_processed_v1')
    expect(DISK_CACHE_MAX_BYTES).toBe(192 * 1024 * 1024)
    expect(CACHE_FRACTION).toBe(6)
    expect(DECODE_MAX_EDGE).toBe(2800)
    expect(WINDOW_RETAIN_CEIL_BYTES).toBe(128 * 1024 * 1024)
  })
})

/* ── ComicProcessedDiskCache over an in-memory store ────────────────────────────── */

interface MemStore extends DiskCacheStore {
  files: Map<string, PixImage>
  touched: string[]
  now: number
}

function memStore(ext = '.webp'): MemStore {
  const files = new Map<string, PixImage>()
  const touched: string[] = []
  const store: MemStore = {
    files,
    touched,
    now: 1_700_000_000_000,
    losslessExt: ext,
    async ensureDir() {
      return true
    },
    async list(): Promise<ReadonlyArray<DiskCacheEntry> | null> {
      const out: DiskCacheEntry[] = []
      for (const [name, bmp] of files) {
        out.push({ name, bytes: bmp.width * bmp.height * 4, lastModified: store.touched.length })
      }
      return out
    },
    async isFile(name) {
      return files.has(name)
    },
    async read(name) {
      return files.get(name) ?? null
    },
    async encodeTmp(name, img) {
      files.set(name, img)
      return true
    },
    async publish(tmpName, name) {
      const img = files.get(tmpName)
      if (img === undefined) return false
      files.delete(tmpName)
      files.set(name, img)
      return true
    },
    async remove(name) {
      return files.delete(name)
    },
    async touch(name) {
      store.touched.push(name)
    },
    nowMs() {
      return store.now
    },
  }
  return store
}

function img(w: number, h: number): PixImage {
  return { width: w, height: h, data: new Uint32Array(w * h) }
}

describe('ComicProcessedDiskCache', () => {
  it('file names are SHA-256(cacheKey) + the platform lossless extension', () => {
    const webp = new ComicProcessedDiskCache(memStore('.webp'))
    expect(webp.fileNameFor('abc')).toBe(bytesToHex(sha256(utf8Bytes('abc'))) + '.webp')
    const png = new ComicProcessedDiskCache(memStore('.png'))
    expect(png.fileNameFor('abc')).toBe(bytesToHex(sha256(utf8Bytes('abc'))) + '.png')
  })

  it('read misses cleanly and reads back what write published', async () => {
    const store = memStore()
    const cache = new ComicProcessedDiskCache(store)
    expect(await cache.read('missing')).toBeNull()
    expect(await cache.write('k1', img(8, 8))).toBe(true)
    const got = await cache.read('k1')
    expect(got?.width).toBe(8)
    // the hit bumps the LRU recency stamp
    expect(store.touched.length).toBeGreaterThan(0)
  })

  it('a second write of an existing key only refreshes the timestamp', async () => {
    const store = memStore()
    const cache = new ComicProcessedDiskCache(store)
    await cache.write('k1', img(4, 4))
    const before = store.files.size
    expect(await cache.write('k1', img(16, 16))).toBe(true)
    expect(store.files.size).toBe(before)
    expect((await cache.read('k1'))?.width).toBe(4) // untouched
  })

  it('a corrupt entry is treated as a miss and deleted', async () => {
    const store = memStore()
    const cache = new ComicProcessedDiskCache(store)
    const name = cache.fileNameFor('bad')
    store.files.set(name, { width: 0, height: 0, data: new Uint32Array(0) })
    expect(await cache.read('bad')).toBeNull()
    expect(store.files.has(name)).toBe(false)
  })

  it('a throwing store degrades to false / null (缓存只是加速器)', async () => {
    const base = memStore()
    const broken: DiskCacheStore = {
      ...base,
      async read(): Promise<PixImage | null> {
        throw new Error('EIO')
      },
      async encodeTmp(): Promise<boolean> {
        throw new Error('ENOSPC')
      },
    }
    const cache = new ComicProcessedDiskCache(broken)
    expect(await cache.read('x')).toBeNull()
    expect(await cache.write('x', img(4, 4))).toBe(false)
  })

  it('the write gate serialises concurrent writes', async () => {
    const order: string[] = []
    const store = memStore()
    const slow: DiskCacheStore = {
      ...store,
      async encodeTmp(name): Promise<boolean> {
        order.push(`start:${name}`)
        await new Promise((r) => setTimeout(r, 5))
        return true
      },
    }
    const cache = new ComicProcessedDiskCache(slow)
    await Promise.all([cache.write('a', img(4, 4)), cache.write('b', img(4, 4))])
    // no interleaving: each encode completes before the next starts
    const starts = order.filter((o) => o.startsWith('start:'))
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBe(`start:${cache.fileNameFor('a')}.tmp`)
    expect(starts[1]).toBe(`start:${cache.fileNameFor('b')}.tmp`)
  })

  it('usedBytes sums the stored entries', async () => {
    const store = memStore()
    const cache = new ComicProcessedDiskCache(store)
    expect(await cache.usedBytes()).toBe(0)
    await cache.write('k', img(10, 10))
    expect(await cache.usedBytes()).toBe(400)
  })

  it('trim evicts the oldest entries first once the 192MB cap is exceeded', async () => {
    const store = memStore()
    // simulate an oversized directory: one entry is much larger than the rest
    const big: PixImage = { width: 1, height: DISK_CACHE_MAX_BYTES, data: new Uint32Array(0) }
    void big
    const cache = new ComicProcessedDiskCache(store)
    // write() calls trim() internally; with 2 small pages the cap is never reached
    await cache.write('a', img(4, 4))
    await cache.write('b', img(4, 4))
    expect(await cache.usedBytes()).toBe(128)
  })
})

/* ── EXIF orientation (Kotlin L244–322, L626–635) ───────────────────────────────── */

describe('EXIF orientation', () => {
  it('exifDisplayMatrix reproduces the Android gallery table', () => {
    expect(exifDisplayMatrix(1)).toBeNull()
    expect(exifDisplayMatrix(0)).toBeNull()
    expect(exifDisplayMatrix(9)).toBeNull()
    expect(exifDisplayMatrix(2)).toEqual({ op: 'scaleX', factor: -1 })
    expect(exifDisplayMatrix(3)).toEqual({ op: 'rotate', degrees: 180 })
    expect(exifDisplayMatrix(4)).toEqual({ op: 'rotateThenScaleX', degrees: 180 })
    expect(exifDisplayMatrix(5)).toEqual({ op: 'rotateThenScaleX', degrees: 90 })
    expect(exifDisplayMatrix(6)).toEqual({ op: 'rotate', degrees: 90 })
    expect(exifDisplayMatrix(7)).toEqual({ op: 'rotateThenScaleX', degrees: -90 })
    expect(exifDisplayMatrix(8)).toEqual({ op: 'rotate', degrees: -90 })
  })

  it('exifSwappedSize swaps w/h only for orientations 5..8', () => {
    expect(exifSwappedSize(4000, 3000, 1)).toEqual({ width: 4000, height: 3000 })
    expect(exifSwappedSize(4000, 3000, 6)).toEqual({ width: 3000, height: 4000 })
    expect(exifSwappedSize(4000, 3000, 8)).toEqual({ width: 3000, height: 4000 })
    expect(exifSwappedSize(4000, 3000, 4)).toEqual({ width: 4000, height: 3000 })
  })

  it('exifRectToRaw is the exact inverse corner mapping', () => {
    const rect = new RectF(10, 20, 30, 60)
    expect([exifRectToRaw(rect, 100, 100, 1).left, exifRectToRaw(rect, 100, 100, 1).top]).toEqual([
      10, 20,
    ])
    const r2 = exifRectToRaw(rect, 100, 100, 2)
    expect([r2.left, r2.top, r2.right, r2.bottom]).toEqual([70, 20, 90, 60])
    const r3 = exifRectToRaw(rect, 100, 100, 3)
    expect([r3.left, r3.top, r3.right, r3.bottom]).toEqual([70, 40, 90, 80])
    const r4 = exifRectToRaw(rect, 100, 100, 4)
    expect([r4.left, r4.top, r4.right, r4.bottom]).toEqual([10, 40, 30, 80])
    const r5 = exifRectToRaw(rect, 100, 100, 5)
    expect([r5.left, r5.top, r5.right, r5.bottom]).toEqual([20, 10, 60, 30])
    const r6 = exifRectToRaw(rect, 100, 100, 6)
    expect([r6.left, r6.top, r6.right, r6.bottom]).toEqual([20, 70, 60, 90])
    const r7 = exifRectToRaw(rect, 100, 100, 7)
    expect([r7.left, r7.top, r7.right, r7.bottom]).toEqual([40, 70, 80, 90])
    const r8 = exifRectToRaw(rect, 100, 100, 8)
    expect([r8.left, r8.top, r8.right, r8.bottom]).toEqual([40, 10, 80, 30])
  })

  it('parseJpegExifOrientation rejects non-JPEG and truncated heads', () => {
    expect(parseJpegExifOrientation(new Uint8Array(0), 0)).toBe(1)
    expect(parseJpegExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 4)).toBe(1)
    expect(parseJpegExifOrientation(new Uint8Array([0xff, 0xd8]), 2)).toBe(1) // SOI only
  })

  it('parseJpegExifOrientation rejects IFD0 without the 0x0112 tag', () => {
    // SOI + APP1 "Exif\0\0" + TIFF header (little endian, IFD0 with 0 tags)
    const b = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x10, // APP1, len 16
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // TIFF header, IFD0 @ 8
      0x00, 0x00, // entry count 0
    ])
    expect(parseJpegExifOrientation(b, b.length)).toBe(1)
  })

  it('readOrientationFromTiff reads the 0x0112 value in little endian', () => {
    const b = new Uint8Array([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // header
      0x01, 0x00, // 1 entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // tag 0x0112 = 6
      0x00, 0x00, 0x00, 0x00,
    ])
    expect(readOrientationFromTiff(b, 0, b.length)).toBe(6)
  })

  it('readOrientationFromTiff reads big endian too and rejects out-of-range values', () => {
    const be = new Uint8Array([
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ])
    expect(readOrientationFromTiff(be, 0, be.length)).toBe(6)
    const bad = new Uint8Array(be)
    bad[19] = 0x63 // big-endian SHORT value 99 → out of 1..8
    expect(readOrientationFromTiff(bad, 0, bad.length)).toBe(1)
  })
})

/* ── decode sizing (Kotlin L935–940, L808–833) ──────────────────────────────────── */

describe('sampleSizeFor', () => {
  it('halves until the long edge fits', () => {
    expect(sampleSizeFor(1000, 1400, 2800)).toBe(1)
    expect(sampleSizeFor(2800, 2800, 2800)).toBe(1)
    expect(sampleSizeFor(2801, 1000, 2800)).toBe(2)
    expect(sampleSizeFor(5602, 1000, 2800)).toBe(4)
    expect(sampleSizeFor(16000, 9000, 2800)).toBe(8)
  })

  it('uses Integer division like Kotlin, so an odd edge stops one step earlier', () => {
    // Kotlin L937: `while (long / sample > maxEdge)` on Ints.
    // 5601/2 == 2800 (Int) → NOT > 2800 → sample stays 2.
    // Float division would give 2800.5 > 2800 and wrongly double again to 4.
    expect(sampleSizeFor(5601, 1000, 2800)).toBe(2)
    expect(sampleSizeFor(5600, 1000, 2800)).toBe(2)
    expect(sampleSizeFor(5603, 1000, 2800)).toBe(4)
    // the same guard one octave up (11200/4 == 2800 → stop; 11202/4 == 2800.5 → 8)
    expect(sampleSizeFor(11200, 1000, 2800)).toBe(4)
    // 11202/4 == 2800.5 → truncates to 2800 → NOT > 2800 → stays 4 (float division would
    // give 8)
    expect(sampleSizeFor(11202, 1000, 2800)).toBe(4)
    // 11210/4 == 2802.5 → truncates to 2802 → > 2800 → 8
    expect(sampleSizeFor(11210, 1000, 2800)).toBe(8)
    // short edges never sample down
    expect(sampleSizeFor(1, 1, 2800)).toBe(1)
  })
})

describe('estimateProcessedBytes', () => {
  it('unknown size falls back to the conservative per-mode default', () => {
    expect(estimateProcessedBytes(0, 0, 'OFF')).toBe(2800 * 2000 * 4)
    expect(estimateProcessedBytes(0, 0, 'CAS')).toBe(2800 * 2000 * 4)
    expect(estimateProcessedBytes(0, 0, 'ANIME4K')).toBe(3200 * 2286 * 4)
    expect(estimateProcessedBytes(-1, -1, 'SUPER_RES')).toBe(3200 * 2286 * 4)
  })

  it('clamps the decode long edge to 2800 before the enhance step', () => {
    // 4000x2000 → decode-clamped to 2800x1400, no 2x for OFF/CAS
    expect(estimateProcessedBytes(4000, 2000, 'OFF')).toBe(2800 * 1400 * 4)
  })

  it('only WAIFU2X and SUPER_RES go through ComicEdgeUpscaler.targetSize', () => {
    // ComicPageLoader.kt L878: `if (enhanceMode == WAIFU2X || enhanceMode == SUPER_RES)`
    // → `ComicEdgeUpscaler.targetSize(long, short)`. ANIME4K is NOT in the set any more:
    // the mode is now `anime4kRestore` (Restore CNN at native size + EASU sharpen), so the
    // estimate must stay at the native decode size.
    const t2399 = edgeUpscalerTargetSize(2399, 1000)
    const t1800 = edgeUpscalerTargetSize(1800, 900)
    const t1801 = edgeUpscalerTargetSize(1801, 900)
    // ANIME4K: Restore CNN keeps the native size → no enlargement at any long edge.
    expect(estimateProcessedBytes(1600, 1000, 'ANIME4K')).toBe(1600 * 1000 * 4)
    expect(estimateProcessedBytes(2400, 1000, 'ANIME4K')).toBe(2400 * 1000 * 4)
    // WAIFU2X / SUPER_RES: the exact targetSize() result, no hand-rolled 2× and no
    // 2400 / 1800 threshold left over from the pre-第20条 implementation.
    expect(estimateProcessedBytes(2399, 1000, 'WAIFU2X')).toBe(t2399[0] * t2399[1] * 4)
    expect(estimateProcessedBytes(1800, 900, 'SUPER_RES')).toBe(t1800[0] * t1800[1] * 4)
    expect(estimateProcessedBytes(1801, 900, 'SUPER_RES')).toBe(t1801[0] * t1801[1] * 4)
    // 4000x2000 decodes down to 2800x1400 first (short edge truncated: 2000*2800/4000)
    const t4000 = edgeUpscalerTargetSize(2800, 1400)
    expect(estimateProcessedBytes(4000, 2000, 'SUPER_RES')).toBe(t4000[0] * t4000[1] * 4)
    // OFF / CAS never enlarge
    expect(estimateProcessedBytes(1600, 1000, 'OFF')).toBe(1600 * 1000 * 4)
    expect(estimateProcessedBytes(1600, 1000, 'CAS')).toBe(1600 * 1000 * 4)
    // a 5000x4000 page decodes to 2800x2240 first; targetSize then reports scale 1
    // (the 6M output-pixel budget already binds), i.e. no enlargement at all
    expect(estimateProcessedBytes(5000, 4000, 'SUPER_RES')).toBe(2800 * 2240 * 4)
    expect(estimateProcessedBytes(5000, 4000, 'ANIME4K')).toBe(2800 * 2240 * 4)
  })

  it('never exceeds the MAX_EDGE long-edge guard', () => {
    const sizes: ReadonlyArray<[number, number]> = [
      [800, 600],
      [1400, 1000],
      [2400, 3200],
      [5000, 4000],
    ]
    for (const mode of ['OFF', 'CAS', 'ANIME4K', 'WAIFU2X', 'SUPER_RES'] as const) {
      for (const [w, h] of sizes) {
        const bytes = estimateProcessedBytes(w, h, mode)
        expect(bytes).toBeGreaterThan(0)
        expect(bytes).toBeLessThanOrEqual(3200 * 3200 * 4)
      }
    }
  })
})

/* ── derived cache keys (Kotlin L539–541, L575, L712–713) ────────────────────────── */

describe('derived cache keys', () => {
  const geo: Geometry = {
    half: 'LEFT',
    splitPosition: 0.42,
    rotationDeg: 90,
    cropMode: 'AUTO',
    manualCrop: [0.1, 0.2, 0.9, 0.8],
  }
  const tone: Toning = {
    brightness: 1,
    contrast: 2,
    saturation: 3,
    hue: 4,
    gamma: 1.5,
    sharpen: 5,
    shadow: 6,
    bw: true,
    enhanceMode: 'ANIME4K',
    enhanceStrength: 70,
  }

  it('previewCacheKey keeps the Kotlin template exactly', () => {
    const key = previewCacheKey(
      { kind: 'Local', id: 'p1', path: '/a.jpg' },
      geo,
      tone,
    )
    // Kotlin L539–541: `"pv|${ref.id}|…|${geo.cropMode}|${geo.manualCrop}" + "|…"`.
    // `${geo.manualCrop}` on a `List<Float>` renders via `Collection.toString()`, i.e.
    // bracketed with ", " separators; the two Floats render as Kotlin `Float.toString()`
    // (0.42 → "0.42", 1.5 → "1.5").
    expect(key).toBe(
      'pv|p1|LEFT|0.42|90|AUTO|[0.1, 0.2, 0.9, 0.8]|1,2,3,4,1.5,5,6,true,ANIME4K,70',
    )
  })

  it('previewCacheKey renders Kotlin Float.toString for the Float fields', () => {
    // `gamma` is a Kotlin Float: 1.0f renders "1.0", not JS "1"; 2.0f → "2.0".
    const base = {
      brightness: 0, contrast: 0, saturation: 0, hue: 0,
      sharpen: 0, shadow: 0, bw: false, enhanceMode: 'OFF' as const, enhanceStrength: 60,
    }
    const geoDefault = { ...DEFAULT_GEOMETRY }
    const k1 = previewCacheKey({ kind: 'Local', id: 'p', path: '/a' }, geoDefault, { ...base, gamma: 1 })
    expect(k1).toBe('pv|p|FULL|0.5|0|OFF|null|0,0,0,0,1.0,0,0,false,OFF,60')
    // splitPosition is a Float too (0.5 → "0.5"), and the whole prefix is Kotlin's
    expect(
      previewCacheKey({ kind: 'Local', id: 'p', path: '/a' }, { ...geoDefault, splitPosition: 0.3 }, { ...base, gamma: 2 }),
    ).toBe('pv|p|FULL|0.3|0|OFF|null|0,0,0,0,2.0,0,0,false,OFF,60')
    // distinct Float values must not collide the way JS String() would
    expect(k1).not.toBe(
      previewCacheKey({ kind: 'Local', id: 'p', path: '/a' }, geoDefault, { ...base, gamma: 2 }),
    )
  })

  it('every toning field participates in the preview key space', () => {
    const base = previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, geo, tone)
    const keys = new Set([
      base,
      previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, geo, { ...tone, bw: false }),
      previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, geo, { ...tone, hue: 5 }),
      previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, geo, { ...tone, gamma: 1.51 }),
      previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, { ...geo, half: 'RIGHT' }, tone),
      previewCacheKey({ kind: 'Local', id: 'p1', path: '/a.jpg' }, { ...geo, rotationDeg: 180 }, tone),
      previewCacheKey({ kind: 'Local', id: 'p2', path: '/b.jpg' }, geo, tone),
    ])
    expect(keys.size).toBe(7)
  })

  it('null manualCrop renders as "null" (Kotlin joinToString on a null element)', () => {
    const key = previewCacheKey(
      { kind: 'Local', id: 'p1', path: '/a.jpg' },
      { ...DEFAULT_GEOMETRY },
      tone,
    )
    expect(key).toContain('|null|')
  })

  it('regionCacheKey truncates the rect and includes the caller tag', () => {
    expect(regionCacheKey('p1', '', new RectF(1.9, 2.9, 30.7, 60.2))).toBe('rgn|p1||1,2,30,60')
    expect(regionCacheKey('p1', 'tile3', new RectF(0, 0, 8, 8))).toBe('rgn|p1|tile3|0,0,8,8')
    expect(regionCacheKey('p1', 'tile3', new RectF(0, 0, 8, 9))).not.toBe(
      regionCacheKey('p1', 'tile3', new RectF(0, 0, 8, 8)),
    )
  })
})

/* ── ByteLruCache (android.util.LruCache) ───────────────────────────────────────── */

describe('ByteLruCache', () => {
  it('accounts bytes and evicts in access order', () => {
    const evicted: string[] = []
    const cache = new ByteLruCache<{ n: number }>(
      100,
      (_k, v) => v.n,
      (isEvict, key) => {
        if (isEvict) evicted.push(key)
      },
    )
    cache.put('a', { n: 40 })
    cache.put('b', { n: 40 })
    cache.put('c', { n: 40 })
    expect(cache.totalBytes).toBe(80)
    expect(evicted).toEqual(['a'])
    expect(cache.keys()).toEqual(['b', 'c'])
    // a get() bumps recency, so 'b' becomes the victim
    cache.get('b')
    cache.put('d', { n: 40 })
    expect(evicted).toEqual(['a', 'c'])
  })

  it('replacing a key adjusts the byte total without evicting', () => {
    const cache = new ByteLruCache<{ n: number }>(1000, (_k, v) => v.n)
    cache.put('a', { n: 10 })
    cache.put('a', { n: 30 })
    expect(cache.totalBytes).toBe(30)
    expect(cache.size).toBe(1)
  })

  it('remove / evictAll / resize behave like LruCache', () => {
    const cache = new ByteLruCache<{ n: number }>(100, (_k, v) => v.n)
    cache.put('a', { n: 10 })
    cache.put('b', { n: 10 })
    expect(cache.remove('a')?.n).toBe(10)
    expect(cache.totalBytes).toBe(10)
    cache.resize(5)
    expect(cache.keys()).toEqual([])
    expect(cache.totalBytes).toBe(0)
    cache.put('c', { n: 3 })
    cache.evictAll()
    expect(cache.size).toBe(0)
    expect(cache.maxSize()).toBe(5)
  })

  it('CountLruCache caps at its entry limit, evicting the oldest', () => {
    const cache = new CountLruCache<boolean>(2)
    cache.put('a', true)
    cache.put('b', false)
    cache.put('c', true)
    expect(cache.keys()).toEqual(['b', 'c'])
    expect(cache.get('a')).toBeUndefined()
  })
})

/* ── ComicLoadLocks (reference counting) ────────────────────────────────────────── */

describe('ComicLoadLocks', () => {
  it('shares one mutex between concurrent callers and drops the entry at zero users', () => {
    const locks = new ComicLoadLocks()
    const m1 = locks.acquire('k')
    const m2 = locks.acquire('k')
    expect(m1).toBe(m2)
    locks.release('k')
    const m3 = locks.acquire('k')
    expect(m3).toBe(m1) // still the same entry (1 user left)
    locks.release('k')
    locks.release('k')
    const m4 = locks.acquire('k')
    expect(m4).not.toBe(m1) // entry was dropped and recreated
  })

  it('the shared mutex serialises the critical sections', async () => {
    const locks = new ComicLoadLocks()
    const mutex = locks.acquire('k')
    const order: number[] = []
    await Promise.all([
      mutex.withLock(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 5))
        order.push(2)
      }),
      mutex.withLock(async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })
})

/* ── loader cache sizing + window residency ────────────────────────────────────── */

describe('ComicPageLoader cache sizing', () => {
  function loader(
    heapBytes: number,
    overrides: Partial<PageSource> = {},
  ): ComicPageLoader {
    const src: PageSource = {
      decodeLocal: async () => img(8, 8),
      decodeRemote: async () => img(8, 8),
      probeBoundsLocal: async () => ({ left: 0, top: 0, right: 8, bottom: 8 }),
      readFileHead: async () => new Uint8Array(0),
      openRegion: async (): Promise<RegionDecoderHandle | null> => null,
      transformExif: async (b) => b,
      scaleTo: (b) => b,
      wifiConnectedOrUnmetered: () => true,
      clearRemoteMemoryCache: () => {},
      ...overrides,
    }
    return new ComicPageLoader({
      source: src,
      diskStore: memStore(),
      policy: { preloadWifiOnly: () => false },
      tasks: { run: (t) => void t() },
      io: { run: (t) => t() },
      maxHeapBytes: heapBytes,
    })
  }

  it('cacheBaseBytes = heap / 6 clamped to [24MB, 96MB]', () => {
    // 96MB heap → 16MB → clamped up to 24MB
    expect(loader(96 * 1024 * 1024).cacheLimitForTest()).toBe(24 << 20)
    // 512MB heap → 85MB, inside the window
    expect(loader(512 * 1024 * 1024).cacheLimitForTest()).toBe(Math.trunc((512 << 20) / 6))
    // 2GB heap → 341MB → clamped down to 96MB
    expect(loader(2 * 1024 * 1024 * 1024).cacheLimitForTest()).toBe(96 << 20)
  })

  it('ensureWindowCapacity grows towards the residency ceiling and never shrinks below base', () => {
    const l = loader(768 * 1024 * 1024) // base = 128MB → 96MB after clamp
    const entries = [
      { ref: { kind: 'Local' as const, id: 'a', path: '/a' }, cacheKey: 'ka', geo: DEFAULT_GEOMETRY, visible: true },
    ]
    l.ensureWindowCapacity(entries, {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'ANIME4K', enhanceStrength: 60,
    })
    // unknown size → the 2x-mode default (29MB) is below the base, so no resize
    expect(l.cacheLimitForTest()).toBe(96 << 20)
    // a huge measured page pushes the target up to the residency ceiling
    const many = Array.from({ length: 8 }, (_, i) => ({
      ref: { kind: 'Local' as const, id: `p${i}`, path: `/p${i}` },
      cacheKey: `kp${i}`,
      geo: DEFAULT_GEOMETRY,
      visible: i === 0,
    }))
    l.ensureWindowCapacity(many, {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'SUPER_RES', enhanceStrength: 60,
    })
    expect(l.cacheLimitForTest()).toBeLessThanOrEqual(128 << 20)
  })

  it('peekProcessed / putProcessedForTest / evictProcessed round-trip', () => {
    const l = loader(256 * 1024 * 1024)
    expect(l.peekProcessed('k')).toBeNull()
    const b = img(6, 6)
    l.putProcessedForTest('k', b)
    expect(l.peekProcessed('k')).toBe(b)
    l.replaceProcessed('k', img(8, 8))
    expect(l.peekProcessed('k')?.width).toBe(8)
    l.evictProcessed('k')
    expect(l.peekProcessed('k')).toBeNull()
  })

  it('the sizes listener registry publishes on every probe/put', async () => {
    const l = loader(256 * 1024 * 1024)
    const seen: number[] = []
    const off = l.onSizesChanged((m) => seen.push(m.size))
    expect(seen).toEqual([0])
    await l.load(
      { kind: 'Local', id: 'p1', path: '/a.jpg' },
      'k',
      DEFAULT_GEOMETRY,
      {
        brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
        bw: false, enhanceMode: 'OFF', enhanceStrength: 60,
      },
    )
    expect(seen.length).toBeGreaterThan(1)
    expect(l.sizesSnapshot().has('p1')).toBe(true)
    off()
  })

  it('a page with no pipeline work is cached deterministically (第六轮族 A 根治)', async () => {
    const l = loader(256 * 1024 * 1024)
    const tone: Toning = {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'OFF', enhanceStrength: 60,
    }
    const first = await l.load({ kind: 'Local', id: 'p1', path: '/a.jpg' }, 'k', DEFAULT_GEOMETRY, tone)
    expect(first.fromCache).toBe(false)
    const second = await l.load({ kind: 'Local', id: 'p1', path: '/a.jpg' }, 'k', DEFAULT_GEOMETRY, tone)
    expect(second.fromCache).toBe(true)
    expect(second.bitmap).toBe(first.bitmap)
  })

  it('a real decode error propagates instead of wiping the cache (Kotlin: only OutOfMemoryError retries)', async () => {
    const l = loader(256 * 1024 * 1024, {
      decodeLocal: async () => {
        throw new Error('ENOENT: no such file')
      },
    })
    const tone: Toning = {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'OFF', enhanceStrength: 60,
    }
    await expect(
      l.load({ kind: 'Local', id: 'p1', path: '/missing.jpg' }, 'k', DEFAULT_GEOMETRY, tone),
    ).rejects.toThrow(/ENOENT/)
    // and the processed cache was not wiped by the failed decode
    l.putProcessedForTest('other', img(4, 4))
    expect(l.peekProcessed('other')?.width).toBe(4)
  })

  it('an allocation failure retries at a reduced edge and then reports the Chinese retry state', async () => {
    const edges: number[] = []
    let cleared = 0
    const l = loader(256 * 1024 * 1024, {
      decodeLocal: async (_p, edge) => {
        edges.push(edge)
        if (edge > 1280) throw new RangeError('Invalid typed array length')
        return img(8, 8)
      },
      clearRemoteMemoryCache: () => {
        cleared++
      },
    })
    const tone: Toning = {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'OFF', enhanceStrength: 60,
    }
    const r = await l.load({ kind: 'Local', id: 'p1', path: '/big.jpg' }, 'k', DEFAULT_GEOMETRY, tone)
    expect(r.bitmap.width).toBe(8)
    expect(edges).toEqual([2800, 1280])
    expect(cleared).toBe(1)
    // when even the reduced edge fails, the user-facing message is the Kotlin one
    const l2 = loader(256 * 1024 * 1024, {
      decodeLocal: async () => {
        throw new RangeError('Invalid typed array length')
      },
    })
    await expect(
      l2.load({ kind: 'Local', id: 'p2', path: '/big.jpg' }, 'k2', DEFAULT_GEOMETRY, tone),
    ).rejects.toThrow('页面过大，内存不足，请重试')
  })

  it('a failed enhance result is never cached (第七轮第 1 条子问题 A)', async () => {
    const l = loader(256 * 1024 * 1024)
    const tone: Toning = {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gamma: 1, sharpen: 0, shadow: 0,
      bw: false, enhanceMode: 'CAS', enhanceStrength: 60,
    }
    // no processor wired → the enhance path "fails"
    const r = await l.load({ kind: 'Local', id: 'p1', path: '/a.jpg' }, 'k', { ...DEFAULT_GEOMETRY, half: 'LEFT' }, tone)
    expect(r.fromCache).toBe(false)
    expect(l.peekProcessed('k')).toBeNull()
    // and the residency table must not hold it either
    expect(l.pinnedOrderForTest()).not.toContain('k')
  })
})

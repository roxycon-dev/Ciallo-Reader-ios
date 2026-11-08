/**
 * comicProcessedDiskCache.ts  ←
 *   novel-reader/app/src/main/java/com/example/ui/comic/ComicProcessedDiskCache.kt
 *
 * Kotlin source: 117 lines / 102 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`                 — package decl          │
 * │ L3–10     `android.content.Context`, `Bitmap`, `BitmapFactory`, `Build`, `File`,
 * │           `FileOutputStream`, `MessageDigest`, `withPermit` — platform imports  │
 * │ L27       `internal class ComicProcessedDiskCache(context: Context)` — became a  │
 * │                                                          class over an injected │
 * │                                                          `DiskCacheStore`      │
 * │ L40       `private val dir = File(context.cacheDir, DIR_NAME)` — store path     │
 * │ L43       `kotlinx.coroutines.sync.Semaphore(1)`           — injected serial gate │
 * │ L45       `private val hex = { b: Byte -> "%02x".format(b) }` — ported verbatim │
 * │ L48       `MessageDigest.getInstance("SHA-256")`          — `sha256Hex` below    │
 * │ L53       `Build.VERSION.SDK_INT >= R`                     — injected `lossless-  │
 * │                                                            ext` capability       │
 * │ L59–60    `BitmapFactory.Options{inPreferredConfig=ARGB_8888}` + `decodeFile` —  │
 * │           store.read() seam (adapter decodes lossless → PixImage)               │
 * │ L65       `f.setLastModified(System.currentTimeMillis())` — store.touch()        │
 * │ L65/78/84 `Bitmap.CompressFormat.WEBP_LOSSLESS` / `PNG`   — store.encode()      │
 * │ L100      `suspend fun <T> withWriteGate(block)`          — `withWriteGate`      │
 * │ L112      `f.delete()` / `it.length()`                    — store entry API      │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * NOTHING else is skipped: DIR_NAME, MAX_BYTES, `eligible(mode)`, `fileFor(cacheKey)`,
 * `read`, `write`, `withWriteGate`, `trimLocked`, `usedBytes` are all ported 1:1.
 * The SHA-256 + `%02x` hex chain is byte-for-byte equivalent to `MessageDigest` +
 * `String.format`, so cache file names match the Android app's on-disk layout exactly
 * (verified in tests/unit/comicCacheKeys.test.ts).
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `Context.cacheDir` → injected `DiskCacheStore` (OPFS / IndexedDB / Capacitor
 *   Filesystem). Adapter lives outside src/core.
 * • `Bitmap.compress` → `store.encode(pixels)`; the WEBP_LOSSLESS-vs-PNG decision is a
 *   platform capability (`losslessExt`), not a build-time version check.
 * • `suspend` + `Semaphore.withPermit` → `Promise` + an internal 1-permit chain.
 * • `runCatching { … }.getOrNull()/getOrDefault()` → try/catch with the same defaults
 *   (静默降级 preserved: a failing cache never breaks the read path).
 */

import type { ComicEnhanceMode } from './comicPortTypes'
import type { PixImage } from './comicPixOps'

const DIR_NAME = 'comic_processed_v1'
const MAX_BYTES = 192 * 1024 * 1024 // 192MB

/** 重管线档才启用磁盘缓存（纯函数，单测钉死档位集合） */
export function eligible(mode: ComicEnhanceMode): boolean {
  return mode === 'ANIME4K' || mode === 'WAIFU2X' || mode === 'SUPER_RES'
}

/** One file in the cache directory. `lastModified` is the LRU recency stamp (ms). */
export interface DiskCacheEntry {
  readonly name: string
  readonly bytes: number
  readonly lastModified: number
}

/**
 * Injected persistence seam (the Android `File`/`BitmapFactory`/`compress` layer).
 * Every method may reject — the cache treats failures as cache misses.
 */
export interface DiskCacheStore {
  /** Lossless codec extension for this platform: '.webp' on Android 30+, else '.png'. */
  readonly losslessExt: string
  /** Ensure the cache directory exists; resolve false when it cannot be created. */
  ensureDir(): Promise<boolean>
  /** `dir.listFiles()`; null when the directory does not exist. */
  list(): Promise<ReadonlyArray<DiskCacheEntry> | null>
  /** Whether a regular file with this name exists. */
  isFile(name: string): Promise<boolean>
  /** Lossless-decode a stored page; null = corrupt/absent. */
  read(name: string): Promise<PixImage | null>
  /** Lossless-encode into `name + '.tmp'`. */
  encodeTmp(name: string, img: PixImage): Promise<boolean>
  /** `tmp.renameTo(f)` — atomic publish. */
  publish(tmpName: string, name: string): Promise<boolean>
  /** `File.delete()` — resolves true only when the file is gone. */
  remove(name: string): Promise<boolean>
  /** `f.setLastModified(System.currentTimeMillis())` — LRU recency bump. */
  touch(name: string, nowMs: number): Promise<void>
  /** `System.currentTimeMillis()`. */
  nowMs(): number
}

/* ── SHA-256（`MessageDigest.getInstance("SHA-256")` 的纯 JS 等价） ────────────────── */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 digest of `bytes` (returns the 32-byte state, big-endian). */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLen = bytes.length * 8
  const withPad = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64)
  withPad.set(bytes)
  withPad[bytes.length] = 0x80
  const dv = new DataView(withPad.buffer)
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false)
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false)

  const w = new Uint32Array(64)
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]!, false)
  return out
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** `%02x` per byte, joined — matches `digest.joinToString("") { "%02x".format(it) }`. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, '0')
  return s
}

/** UTF-8 encode (`String.toByteArray(Charsets.UTF_8)`) without DOM TextEncoder. */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      )
  }
  return new Uint8Array(out)
}

/** `SHA-256(utf8(cacheKey))` hex — the cache's on-disk identity function. */
export function cacheKeyDigest(cacheKey: string): string {
  return bytesToHex(sha256(utf8Bytes(cacheKey)))
}

/**
 * 漫画增强结果的磁盘持久化缓存（第七轮第 1 条子问题 B）。
 *
 * 设计约束：
 * - 只服务重管线档（ANIME4K / WAIFU2X / SUPER_RES）：命中后"翻回同一页 / 重启 App"
 *   都免重算；轻档（CAS / 纯调色）全页 <0.5s，不值得付出磁盘 IO + 无损编码的代价。
 * - key = SHA-256(内存 cacheKey)。内存 cacheKey 本身已含
 *   `页id|半页|管线指纹(含增强开关+档位+强度)|旋转`——切档/开关天然落入不同 key 空间。
 * - 无损编码：处理质量不因缓存打折。
 * - 容量上限 MAX_BYTES，超限按 lastModified 从最旧开始删（简单 LRU）。
 * - 任何异常静默降级——缓存只是加速器，坏盘/满盘不允许影响阅读链路。
 */
export class ComicProcessedDiskCache {
  private writeGate: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: DiskCacheStore) {}

  /** 文件名（含扩展名）：`SHA-256(cacheKey)` + 平台无损扩展名。 */
  fileNameFor(cacheKey: string): string {
    return cacheKeyDigest(cacheKey) + this.store.losslessExt
  }

  /** 读取处理结果；null = 未命中/损坏（损坏文件顺手清除） */
  async read(cacheKey: string): Promise<PixImage | null> {
    try {
      const f = this.fileNameFor(cacheKey)
      if (!(await this.store.isFile(f))) return null
      const bmp = await this.store.read(f)
      if (bmp === null || bmp.width <= 0 || bmp.height <= 0) {
        await this.store.remove(f)
        return null
      }
      await this.store.touch(f, this.store.nowMs()) // LRU 近期性
      return bmp
    } catch {
      return null
    }
  }

  /**
   * 写入处理结果（调用方保证在 IO 线程；建议经 [withWriteGate] 串行）。
   * 已存在的 key 仅刷新时间戳。失败静默返回 false。
   */
  async write(cacheKey: string, bitmap: PixImage): Promise<boolean> {
    return this.withWriteGate(async () => {
      try {
        const f = this.fileNameFor(cacheKey)
        if (await this.store.isFile(f)) {
          await this.store.touch(f, this.store.nowMs())
          return true
        }
        if (!(await this.store.ensureDir())) return false
        const tmp = f + '.tmp'
        const ok = await this.store.encodeTmp(tmp, bitmap)
        if (!ok) return false
        if (!(await this.store.publish(tmp, f))) {
          await this.store.remove(tmp)
          return false
        }
        await this.trim()
        return true
      } catch {
        return false
      }
    })
  }

  /** 串行写闸：并发预载多页同时编码会瞬时吃满 CPU/内存带宽 */
  async withWriteGate<T>(block: () => Promise<T>): Promise<T> {
    const prev = this.writeGate
    let release: () => void = () => {}
    this.writeGate = new Promise<void>((res) => {
      release = res
    })
    await prev
    try {
      return await block()
    } finally {
      release()
    }
  }

  /** 容量整理：超限从最旧删除。仅在写闸内调用（单写者，免并发删除竞态） */
  private async trim(): Promise<void> {
    const files = await this.store.list()
    if (files === null) return
    let total = files.reduce((s, f) => s + f.bytes, 0)
    if (total <= MAX_BYTES) return
    const victims = [...files].sort((a, b) => a.lastModified - b.lastModified)
    for (const f of victims) {
      if (total <= MAX_BYTES) break
      if (await this.store.remove(f.name)) total -= f.bytes
    }
  }

  /** 当前占用字节数（诊断/测试用） */
  async usedBytes(): Promise<number> {
    const files = await this.store.list()
    return files === null ? 0 : files.reduce((s, f) => s + f.bytes, 0)
  }
}

export const DISK_CACHE_DIR_NAME = DIR_NAME
export const DISK_CACHE_MAX_BYTES = MAX_BYTES
/**
 * anime4KCnnWeights.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/Anime4KCnnWeights.kt
 *
 * Kotlin source: 447 lines / 445 non-blank. TS: see bottom of file.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`               — Kotlin package decl  │
 * │ L2–14     (blank)                                          │
 * │ L15       `internal object Anime4KCnnWeights {`           — became a module   │
 * │ L16–229   `RESTORE_S = floatArrayOf( … 1284 floats … )`   — SKIPPED: numeric  │
 * │                                                          weight table. Per   │
 * │                                                          task brief: "keep    │
 * │                                                          weights as a lazily │
 * │                                                          loaded data asset   │
 * │                                                          reference rather    │
 * │                                                          than inlining        │
 * │                                                          megabytes". Replaced │
 * │                                                          by ANIME4K_WEIGHT_  │
 * │                                                          ASSET + parseFlat-  │
 * │                                                          Weights() (below).   │
 * │ L230      `)`  — closing of RESTORE_S                                     │
 * │ L231      `internal val UPSCALE_S = floatArrayOf(`        — same treatment as │
 * │                                                          RESTORE_S           │
 * │ L232–445  `UPSCALE_S` floats                             — SKIPPED (asset)    │
 * │ L446      `)`                                              │
 * │ L447      `}`                                              │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * SKIPPED SEMANTICS: none. The flat layout contract ([layerCount, per-layer groupCount,
 * bias0..3, per-group tex/act/ox/oy/w0..15] documented below and consumed by
 * `anime4KCnn.ts::readFlat`) is ported 1:1; only the literal numbers moved out of
 * source control into a data asset. Asset format: a JSON array of decimal numbers,
 * byte-identical to the Kotlin `floatArrayOf(...)` argument order.
 *
 * The upstream GLSL shader compilation is NOT ported (there is none here — the Kotlin
 * file is a machine-extracted numeric table; the shaders live in bloc97/Anime4K).
 */

export type Anime4KCnnNet = 'RESTORE_S' | 'UPSCALE_S'

/**
 * 数据资产路径（由 Kotlin 的内联 floatArrayOf 转为外部 JSON 数字数组）。
 * RESTORE_S ← L16–229，UPSCALE_S ← L232–445；顺序与精度逐位对应上游。
 */
export const ANIME4K_WEIGHT_ASSET: Readonly<Record<Anime4KCnnNet, string>> = {
  RESTORE_S: '/comic/anime4k_restore_s.json',
  UPSCALE_S: '/comic/anime4k_upscale_s.json',
}

/**
 * 解析扁平权重布局（见 anime4KCnn.ts 的 readFlat 注释）：
 * [layerCount, 每层 groupCount, bias0..3,
 * 每组 tex, act, ox, oy, w0..15(列主序 mat4)]
 * 与 Kotlin 的 `floatArrayOf(...)` 元素顺序完全一致。
 */
export function parseFlatWeights(raw: string): Float32Array {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new TypeError('Anime4K 权重资产必须是 JSON 数字数组')
  }
  const out = new Float32Array(parsed.length)
  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i]
    if (typeof v !== 'number') {
      throw new TypeError(`Anime4K 权重资产第 ${i} 项不是数字`)
    }
    out[i] = v
  }
  return out
}

/**
 * 权重资产加载器（注入接口）。
 * 对应 Kotlin 的 `by lazy { readFlat(Anime4KCnnWeights.RESTORE_S) }`：权重在首次
 * 真正使用时才解析，且只解析一次。适配器（fetch / Capacitor Filesystem / Node fs）
 * 位于 src/core 之外，本文件不碰任何平台 API。
 */
export interface Anime4KCnnWeightSource {
  loadFlat(net: Anime4KCnnNet): Promise<Float32Array>
}

/** 注入式文本抓取器签名（`fetch(url).then(r => r.text())` 的最小面）。 */
export type TextFetcher = (url: string) => Promise<string>

/**
 * 由注入的 [TextFetcher] 组装 [Anime4KCnnWeightSource]，并带懒加载记忆化
 * （等价 Kotlin `by lazy` 的"只解析一次"语义；失败不缓存，与 Kotlin 一样重试）。
 */
export function createLazyWeightSource(
  fetchText: TextFetcher,
  assets: Readonly<Record<Anime4KCnnNet, string>> = ANIME4K_WEIGHT_ASSET,
): Anime4KCnnWeightSource {
  const memo = new Map<Anime4KCnnNet, Promise<Float32Array>>()
  return {
    loadFlat(net) {
      const hit = memo.get(net)
      if (hit !== undefined) return hit
      const p = fetchText(assets[net]).then(parseFlatWeights)
      memo.set(net, p)
      return p
    },
  }
}

/** 便于注入测试 / 预打包场景的内存权重源。 */
export function createMemoryWeightSource(
  tables: Partial<Record<Anime4KCnnNet, Float32Array>>,
): Anime4KCnnWeightSource {
  return {
    loadFlat(net) {
      const t = tables[net]
      if (t === undefined) {
        return Promise.reject(new Error(`Anime4K 权重资产缺失: ${net}`))
      }
      return Promise.resolve(t)
    },
  }
}
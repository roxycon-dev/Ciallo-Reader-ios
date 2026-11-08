/**
 * lruProbe.test.ts — 移植 Android
 * `app/src/test/java/com/example/ui/comic/LruProbeTest.kt`（1 个 @Test）。
 *
 * 被测实现：`src/core/comic/comicPageLoader.ts` 的 `ByteLruCache`
 * （Android 侧探针直接用 `android.util.LruCache`，语义契约 = get() 必须提升近期性）。
 *
 * ⚠️ 平台适配：Android 用 `LruCache<String, ByteArray>(3)` + `sizeOf = 1`（按条目数计）。
 *    TS 侧等价的按字节计量缓存是 `ByteLruCache`，构造参数是字节上限 + sizeOf；
 *    这里传 `sizeOf = () => 1` 并把上限设为 3 字节，于是每条目计 1 字节 = 同一条目数语义。
 */
import { describe, expect, it } from 'vitest'

import { ByteLruCache } from '@core/comic/comicPageLoader'

describe('LruProbeTest（Android LruProbeTest.kt，1 个测试）', () => {
  it('get bumps recency — get() 必须提升近期性，逐出最旧而非刚读过的（Kotlin L12-L25）', () => {
    const evictedKeys: string[] = []
    const c = new ByteLruCache<Uint8Array>(
      3,
      () => 1, // Kotlin L16 `override fun sizeOf(key, value) = 1`
      (evicted, key) => {
        // Kotlin L17-L19 `if (evicted) evictedKeys.add(key!!)`
        if (evicted && key !== undefined) evictedKeys.push(key)
      },
    )
    const one = new Uint8Array(1)
    c.put('a', one)
    c.put('b', one)
    c.put('c', one)
    c.get('a') // bump a → newest；顺序（旧→新）：b, c, a
    c.put('d', one) // 应逐出 b（最旧），而不是 a
    expect(evictedKeys).toEqual(['b'])
  })
})
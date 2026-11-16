/**
 * comicLoadSupport.test.ts — 逐条移植 Android
 * `app/src/test/java/com/example/ui/comic/ComicLoadingReliabilityTest.kt` 中
 * `class ComicLoadSupportTest` 的前 3 个 @Test（Kotlin L41-L65）。
 *
 * 被测实现：`src/core/comic/comicLoadSupport.ts`
 *   - ComicLoadLocks              ← Kotlin `ComicLoadLocks`
 *   - comicRemoteCacheIdentity    ← Kotlin `comicRemoteCacheKey` 的 identity 拼接段
 *   - comicTransferFraction       ← Kotlin `ComicTransferProgress.fraction`
 *
 * ⚠️ 平台适配（已在被测模块文件头登记）：Kotlin `comicRemoteCacheKey` 是同步
 *    `MessageDigest("SHA-256")`；Web 端只有异步 `crypto.subtle.digest`，因此 TS 把
 *    拼接段拆成同步的 `comicRemoteCacheIdentity`（字符串部分与 Kotlin 逐字节一致）。
 *    本测试的全部断言都作用在**拼接结果**上（相等/不等/不含明文头名），
 *    摘要段与拼��串是同一个单射映射，故断言强度不变。
 */
import { describe, expect, it } from 'vitest'

import {
  ComicLoadLocks,
  comicRemoteCacheIdentity,
  comicTransferFraction,
  comicTransferProgress,
} from '@core/comic/comicLoadSupport'

describe('ComicLoadSupportTest（Android ComicLoadingReliabilityTest.kt L40-L77，3 个测试）', () => {
  it('waiters preserve the same mutex until the final caller leaves — 同一 key 在最后一个调用者离开前共用一把锁（Kotlin L41-L50）', () => {
    const locks = new ComicLoadLocks()
    const a = locks.acquire('page')
    expect(locks.acquire('page')).toBe(a)
    locks.release('page')
    expect(locks.acquire('page')).toBe(a)
    locks.release('page')
    locks.release('page')
    expect(locks.acquire('page')).not.toBe(a)
  })

  it('cache identity separates credentials and normalizes header spelling and order — 缓存身份区分凭据且归一化头名大小写与顺序（Kotlin L52-L58）', () => {
    const key = comicRemoteCacheIdentity('https://example.org/p', { Cookie: 'a', Referer: 'r' })
    expect(key).toBe(
      comicRemoteCacheIdentity('https://example.org/p', { referer: 'r', cookie: 'a' }),
    )
    expect(key).toBe(comicRemoteCacheIdentity('https://example.org/p', { cookie: 'a' }, 'r'))
    expect(key).not.toBe(
      comicRemoteCacheIdentity('https://example.org/p', { Cookie: 'b' }, 'r'),
    )
    expect(key.includes('Cookie')).toBe(false)
  })

  it('unknown content length is indeterminate and known progress is clamped — 未知总长为不定，已知进度钳位（Kotlin L60-L65）', () => {
    expect(comicTransferFraction(comicTransferProgress(100, -1))).toBeNull()
    expect(comicTransferFraction(comicTransferProgress(100, 0))).toBeNull()
    expect(comicTransferFraction(comicTransferProgress(50, 100))).toBeCloseTo(0.5, 3)
    expect(comicTransferFraction(comicTransferProgress(200, 100))).toBeCloseTo(1, 3)
  })
})
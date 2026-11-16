/**
 * comicLoadSupport.test.ts — 钉死 Android `ComicLoadSupport.kt`（L1-L54）行为。
 * 端口：`src/core/comic/comicLoadSupport.ts`。
 */
import { describe, expect, it } from 'vitest';
import {
  ComicLoadLocks,
  ComicTransfers,
  comicRemoteCacheIdentity,
  comicRemoteCacheKey,
  comicTransferFraction,
  comicTransferProgress,
} from '@core/comic/comicLoadSupport';

describe('comicRemoteCacheIdentity（L9-L17）', () => {
  it('长度前缀格式：`url.length:url` 后接每个 header 的 `k.length:k + v.length:v`', () => {
    expect(comicRemoteCacheIdentity('ab', {})).toBe('2:ab')
    // Kotlin L10 先 `it.key.lowercase()`，所以参与 identity 的键一律小写
    expect(comicRemoteCacheIdentity('ab', { Authorization: 'tok' })).toBe('2:ab13:authorization3:tok')
  })

  it('header 键统一小写（L10）', () => {
    expect(comicRemoteCacheIdentity('u', { AUTHORIZATION: 'x' })).toBe('1:u13:authorization1:x')
    // 大小写不同的同一 header 名 → 同一 identity（与 Kotlin `lowercase()` 一致）
    expect(comicRemoteCacheIdentity('u', { Referer: 'x' })).toBe(
      comicRemoteCacheIdentity('u', { referer: 'x' }),
    )
  })

  it('referer 非空白才参与（L11）', () => {
    expect(comicRemoteCacheIdentity('u', {}, 'https://r/')).toBe('1:u7:referer10:https://r/')
    expect(comicRemoteCacheIdentity('u', {}, '')).toBe('1:u')
    expect(comicRemoteCacheIdentity('u', {}, '   ')).toBe('1:u')
    expect(comicRemoteCacheIdentity('u', {}, null)).toBe('1:u')
  })

  it('header 按键升序排序（L14 toSortedMap）', () => {
    expect(comicRemoteCacheIdentity('u', { b: '2', a: '1' })).toBe('1:u1:a1:11:b1:2')
  })

  it('长度前缀避免拼接歧义：不同 (k,v) 切分得到不同 identity', () => {
    expect(comicRemoteCacheIdentity('u', { a: 'bc' })).not.toBe(
      comicRemoteCacheIdentity('u', { ab: 'c' }),
    )
  })

  it('authorization 参与缓存身份（值不出现在 key 名里，但参与摘要输入）', () => {
    const a = comicRemoteCacheIdentity('u', { authorization: 'tok1' })
    const b = comicRemoteCacheIdentity('u', { authorization: 'tok2' })
    expect(a).not.toBe(b)
  })
})

describe('comicRemoteCacheKey（L18-L23）', () => {
  it('SHA-256 小写 hex，长度 64', async () => {
    const key = await comicRemoteCacheKey('u', {})
    expect(key).toHaveLength(64)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('同输入 → 同 key；换 header → 换 key', async () => {
    expect(await comicRemoteCacheKey('u', { a: '1' })).toBe(await comicRemoteCacheKey('u', { a: '1' }))
    expect(await comicRemoteCacheKey('u', { a: '1' })).not.toBe(await comicRemoteCacheKey('u', { a: '2' }))
  })
})

describe('ComicTransferProgress（L26-L28）', () => {
  it('默认 bytes=0 / total=-1；fraction 为 null', () => {
    const p = comicTransferProgress()
    expect(p.bytes).toBe(0)
    expect(p.total).toBe(-1)
    expect(comicTransferFraction(p)).toBeNull()
  })

  it('total>0 → bytes/total 钳 [0,1]', () => {
    expect(comicTransferFraction(comicTransferProgress(50, 100))).toBe(0.5)
    expect(comicTransferFraction(comicTransferProgress(-10, 100))).toBe(0)
    expect(comicTransferFraction(comicTransferProgress(500, 100))).toBe(1)
  })

  it('total=0 → null（不除零）', () => {
    expect(comicTransferFraction(comicTransferProgress(10, 0))).toBeNull()
  })
})

describe('ComicTransfers（L30-L41）', () => {
  it('update → state().value() 反映最新进度；subscribe 收到快照', () => {
    const url = 'https://a/1.jpg'
    ComicTransfers.update(url, 30, 60)
    const handle = ComicTransfers.state(url)
    expect(handle.value().bytes).toBe(30)
    expect(comicTransferFraction(handle.value())).toBe(0.5)

    const seen: number[] = []
    const off = handle.subscribe((p) => seen.push(p.bytes))
    ComicTransfers.update(url, 60, 60)
    off()
    ComicTransfers.update(url, 90, 90)
    expect(seen).toEqual([60])
  })

  it('上限 128：超出后淘汰最久未访问的条目（accessOrder = true，L32）', () => {
    const states = ComicTransfers.states
    states.clear()
    const urls = Array.from({ length: 140 }, (_, i) => `https://lrubench/${i}.jpg`)
    urls.forEach((u) => {
      ComicTransfers.update(u, 1, 10)
    })
    expect(states.size).toBe(128)
    // url[0] 是最久未访问 → 应被淘汰
    expect(states.has(urls[0] as string)).toBe(false)
    expect(states.has(urls[139] as string)).toBe(true)
    states.clear()
  })
})

describe('ComicLoadLocks（L44-L53）', () => {
  it('acquire 增加 users；release 归零后删除条目（L47-L53）', () => {
    const locks = new ComicLoadLocks()
    const m1 = locks.acquire('k')
    const m2 = locks.acquire('k')
    expect(m2).toBe(m1)
    expect(locks.usersOf('k')).toBe(2)
    expect(locks.entryCount()).toBe(1)

    locks.release('k')
    expect(locks.usersOf('k')).toBe(1)
    locks.release('k')
    expect(locks.entryCount()).toBe(0)
  })

  it('release 未持有的 key 不抛错（Kotlin `?.let`）', () => {
    const locks = new ComicLoadLocks()
    expect(() => locks.release('missing')).not.toThrow()
  })

  it('withLock 串行化临界区', async () => {
    const locks = new ComicLoadLocks()
    const mutex = locks.acquire('serial')
    const order: string[] = []
    const slow = mutex.withLock(async () => {
      order.push('a-start')
      await Promise.resolve()
      order.push('a-end')
    })
    const fast = mutex.withLock(() => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
    locks.release('serial')
  })

  it('临界区抛错不卡死后续等待者（与 Kotlin 取消语义一致）', async () => {
    const locks = new ComicLoadLocks()
    const mutex = locks.acquire('err')
    const failing = mutex.withLock(() => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    await expect(mutex.withLock(() => 'ok')).resolves.toBe('ok')
    locks.release('err')
  })
})

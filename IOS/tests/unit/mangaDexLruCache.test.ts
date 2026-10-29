/**
 * E90 —— `LruCacheImpl` 必须复刻 Kotlin `LinkedHashMap`（accessOrder = false）的
 * **插入序**语义，而不是「最近使用序」。
 *
 * Kotlin `source/impl/MangaDexSource.kt` 三个缓存：
 * ```kotlin
 * private val officialTitleCache  = LinkedHashMap<String, String>()   // L310
 * private val mirrorToOfficialCache = LinkedHashMap<String, String>() // L311
 * private val mirrorSlugCache     = LinkedHashMap<String, String>()   // L314
 * …
 * mirrorToOfficialCache[mirrorMatch.id] = api.id                     // L110
 * if (mirrorToOfficialCache.size > 64) mirrorToOfficialCache.remove(mirrorToOfficialCache.keys.first())  // L111-112
 * ```
 *
 * `LinkedHashMap` 的默认构造是 **insertion-ordered**：`put` 一个已存在的 key **只更新值、
 * 不改变它在迭代序里的位置**。而 `keys.first()` 拿的是迭代序的第一个 = **最早插入**的键。
 *
 * iOS 侧原先写的是 `if (has) delete(); set()` —— 那是「先删再插」，把覆盖变成了移到队尾，
 * 于是「同一个 key 被反复续写」时驱逐对象与 Android 不同（缓存内容一致，只是淘汰顺序不同）。
 */

import { describe, expect, it } from 'vitest';
import { LruCacheImpl } from '@core/source/impl/mangaDexSource';

describe('LruCacheImpl — LinkedHashMap 插入序（E90）', () => {
  it('超过容量时驱逐最早插入的键', () => {
    const cache = new LruCacheImpl<string, number>(3);
    cache.put('a', 1);
    cache.put('b', 2);
    cache.put('c', 3);
    cache.put('d', 4);
    // 'a' 最早插入 → 被驱逐
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('覆盖已有键只更新值、不改插入位（这是与 Android 一致的关键）', () => {
    const cache = new LruCacheImpl<string, number>(3);
    cache.put('a', 1);
    cache.put('b', 2);
    cache.put('c', 3);
    // 覆盖 'a' —— 它仍在**最早**位置
    cache.put('a', 99);
    cache.put('d', 4);
    // 若覆盖会移到队尾，则被驱逐的应该是 'b'；LinkedHashMap 语义下是 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('反复续写同一个键不会让它变成「最新」（旧实现会）', () => {
    const cache = new LruCacheImpl<string, number>(2);
    cache.put('x', 1);
    cache.put('y', 2);
    // 反复续写 'x' 20 次
    for (let i = 0; i < 20; i += 1) cache.put('x', i);
    cache.put('z', 3);
    // 'x' 仍是最早插入的那个 → 被驱逐
    expect(cache.get('x')).toBeUndefined();
    expect(cache.get('y')).toBe(2);
    expect(cache.get('z')).toBe(3);
  });

  it('容量为 1 时行为正确', () => {
    const cache = new LruCacheImpl<string, number>(1);
    cache.put('a', 1);
    cache.put('b', 2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    cache.put('b', 20);
    cache.put('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('与 MangaDexSource 的三个缓存容量一致（64/64/32，见 Kotlin L310-314 的 remove 阈值）', () => {
    // Kotlin：officialTitle/mirrorToOfficial 的阈值是 64，mirrorSlug 是 32。
    // 逐个塞满 +1 个，验证最老的被驱逐。
    for (const cap of [64, 32]) {
      const cache = new LruCacheImpl<string, number>(cap);
      for (let i = 0; i < cap; i += 1) cache.put(`k${i}`, i);
      expect(cache.get('k0'), `cap=${cap} 未溢出时 k0 应在`).toBe(0);
      cache.put('overflow', 999);
      expect(cache.get('k0'), `cap=${cap} 溢出后 k0 应被驱逐`).toBeUndefined();
      expect(cache.get('overflow')).toBe(999);
    }
  });

  it('get 不影响插入序（Kotlin 只读不重排）', () => {
    const cache = new LruCacheImpl<string, number>(2);
    cache.put('a', 1);
    cache.put('b', 2);
    // 读 'a' 几次
    expect(cache.get('a')).toBe(1);
    expect(cache.get('a')).toBe(1);
    cache.put('c', 3);
    // 'a' 依旧最早 → 被驱逐
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });
});
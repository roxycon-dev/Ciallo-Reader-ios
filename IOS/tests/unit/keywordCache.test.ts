/**
 * E89 —— `KeywordCache.read` 对畸形条目的容忍度必须与 Kotlin 一致。
 *
 * Kotlin `source/keyword/KeywordCache.kt:21-44`：
 * ```kotlin
 * @Synchronized fun read(input: String): Entry? = runCatching {
 *     …
 *     val states = … KeywordProviderState(row.getString("id"), row.getString("outcome"),
 *                                        row.getLong("retryAt"), row.optString("detail"))
 *     Entry(concepts, version >= 3 && obj.getLong("expires") > now(), states)
 * }.getOrNull()
 * ```
 *
 * 关键：`getLong("retryAt")` / `getLong("expires")` 用的是 **`getLong` 而不是
 * `optLong`** —— 字段缺失时 org.json 抛 `JSONException`，被最外层的 `runCatching`
 * 吞掉，于是**整条缓存被当作「不存在」**（返回 null）。
 *
 * iOS 侧此前用 `optLong(…, 0)`，缺失字段被当成 0，坏条目会被解读成
 * 「存在但已过期 / retryAt=0」。这是重建型缓存的一次性行为差。
 */

import { describe, expect, it } from 'vitest';
import { KeywordCache } from '@core/source/keyword/keywordCache';
import { MemoryFileSystem } from '@platform/web-mock';
import type { KeywordConcept } from '@core/source/keyword/keywordModels';

function concept(id: string): KeywordConcept {
  // `kind` 是派生函数 `kindOf(concept)`（Kotlin `val KeywordConcept.kind get()`），
  // 不是存储字段，所以这里只给三个真实字段。
  return {
    id,
    names: [{ text: `${id}-name`, language: 'en' }],
    source: '测试',
  };
}

describe('KeywordCache.read — getLong 缺失即整条作废（E89）', () => {
  it('正常条目：expires 在未来 → fresh=true', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const entry = await cache.read('海贼王');
    expect(entry).not.toBeNull();
    expect(entry?.fresh).toBe(true);
    expect(entry?.concepts).toHaveLength(1);
  });

  it('expires 在过去 → fresh=false（但条目仍存在）', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const later = new KeywordCache(fs, 'kw', () => 1_000 + 120_000);
    const entry = await later.read('海贼王');
    expect(entry).not.toBeNull();
    expect(entry?.fresh).toBe(false);
  });

  it('expires 字段缺失 → 整条返回 null（不是 fresh=false）', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    // 删掉 expires，只留 version/concepts/providers
    await fs.writeFile(
      `kw/${name}`,
      new TextEncoder().encode(
        JSON.stringify({
          version: 3,
          concepts: [
            { id: 'c1', source: '测试', names: [{ text: 'x', lang: 'en' }] },
          ],
          providers: [],
        }),
      ),
    );
    // Kotlin：`getLong("expires")` 抛 → runCatching → null
    await expect(cache.read('海贼王')).resolves.toBeNull();
  });

  it('provider 行的 retryAt 缺失 → 整条返回 null', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    await fs.writeFile(
      `kw/${name}`,
      new TextEncoder().encode(
        JSON.stringify({
          version: 3,
          expires: 1_000 + 60_000,
          concepts: [
            { id: 'c1', source: '测试', names: [{ text: 'x', lang: 'en' }] },
          ],
          // retryAt 缺失
          providers: [{ id: 'p1', outcome: 'ok', detail: '' }],
        }),
      ),
    );
    await expect(cache.read('海贼王')).resolves.toBeNull();
  });

  it('version 不在 1..3 → null（Kotlin L26）', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    for (const version of [0, 4, 99]) {
      await fs.writeFile(
        `kw/${name}`,
        new TextEncoder().encode(
          JSON.stringify({
            version,
            expires: 1_000 + 60_000,
            concepts: [
              { id: 'c1', source: '测试', names: [{ text: 'x', lang: 'en' }] },
            ],
            providers: [],
          }),
        ),
      );
      await expect(cache.read('海贼王'), `version=${version}`).resolves.toBeNull();
    }
  });

  it('concepts 超过 16 条 → null（Kotlin L28 require）', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    const many = Array.from({ length: 17 }, (_v, i) => ({
      id: `c${i}`,
      source: '测试',
      names: [{ text: `n${i}`, lang: 'en' }],
    }));
    await fs.writeFile(
      `kw/${name}`,
      new TextEncoder().encode(
        JSON.stringify({ version: 3, expires: 1_000 + 60_000, concepts: many, providers: [] }),
      ),
    );
    await expect(cache.read('海贼王')).resolves.toBeNull();
  });

  it('names 超过 64 条 → null（Kotlin L32 require）', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    const names = Array.from({ length: 65 }, (_v, i) => ({ text: `n${i}`, lang: 'en' }));
    await fs.writeFile(
      `kw/${name}`,
      new TextEncoder().encode(
        JSON.stringify({
          version: 3,
          expires: 1_000 + 60_000,
          concepts: [{ id: 'c1', source: '测试', names }],
          providers: [],
        }),
      ),
    );
    await expect(cache.read('海贼王')).resolves.toBeNull();
  });

  it('JSON 损坏 → null', async () => {
    const fs = new MemoryFileSystem();
    const cache = new KeywordCache(fs, 'kw', () => 1_000);
    await cache.write('海贼王', [concept('c1')], 60_000);
    const name = (await fs.list('kw'))[0] as string;
    await fs.writeFile(`kw/${name}`, new TextEncoder().encode('{ not json'));
    await expect(cache.read('海贼王')).resolves.toBeNull();
  });

  it('文件不存在 → null', async () => {
    const cache = new KeywordCache(new MemoryFileSystem(), 'kw', () => 1_000);
    await expect(cache.read('从未搜索过的词')).resolves.toBeNull();
  });
});
/**
 * `ShadowScratchPool` —— `me/trishiraj/shadowglow/ShadowScratchPool.kt` L7-50 的逐行 TS 移植。
 *
 * Kotlin 是「有上限的草稿缓冲池」：领取的数组一定不在池里，归还时按 4096 个 int 对齐分桶，
 * 超预算就从最旧桶逐出。Web 端同样的内存压力来自「每帧新建 Uint8ClampedArray 做掩码」，
 * 所以这里保留同一套预算与对齐规则。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L8-10  `byteBudget = 4 MiB` / `maxPooledInts = 262144` / `buffersPerBucket = 4`
 *   L12    `LinkedHashMap<Int, ArrayDeque<IntArray>>(16, .75f, true)` → `Map`（插入序即可）
 *   L16    `require(byteBudget >= 0 && maxPooledInts >= 4096 && buffersPerBucket > 0)`
 *   L19-27 `acquire(length)`：向上取整到 4096 的倍数，超出上限直接新分配
 *   L29-46 `release(buffer)`：空 / 超上限 / 未对齐 / 超预算一律丢弃；满桶或重复不入池
 *   L49    `retainedByteCount`
 */
export class ShadowScratchPool {
  private readonly buckets = new Map<number, Int32Array[]>();
  private cachedBytes = 0;

  constructor(
    private readonly byteBudget: number = 4 * 1024 * 1024,
    private readonly maxPooledInts: number = 262144,
    private readonly buffersPerBucket: number = 4,
  ) {
    if (!(byteBudget >= 0 && maxPooledInts >= 4096 && buffersPerBucket > 0)) {
      throw new RangeError('ShadowScratchPool: invalid capacity arguments');
    }
  }

  /** L19-27。 */
  acquire(length: number): Int32Array {
    if (length < 0) throw new RangeError('ShadowScratchPool.acquire: negative length');
    if (length > this.maxPooledInts) return new Int32Array(length);
    const size = Math.trunc((length + 4095) / 4096) * 4096;
    const bucket = this.buckets.get(size);
    if (bucket !== undefined && bucket.length > 0) {
      const reused = bucket.pop();
      if (reused !== undefined) {
        this.cachedBytes -= reused.length * 4;
        return reused;
      }
    }
    return new Int32Array(size);
  }

  /** L29-46。 */
  release(buffer: Int32Array): void {
    const bytes = buffer.length * 4;
    if (buffer.length === 0) return;
    if (buffer.length > this.maxPooledInts) return;
    if (buffer.length % 4096 !== 0) return;
    if (bytes > this.byteBudget) return;
    let queue = this.buckets.get(buffer.length);
    if (queue === undefined) {
      queue = [];
      this.buckets.set(buffer.length, queue);
    }
    if (queue.length >= this.buffersPerBucket) return;
    if (queue.includes(buffer)) return;
    while (this.cachedBytes + bytes > this.byteBudget) {
      // L36-43：优先逐出「最早插入」的桶头部；本轮没逐出任何东西就停止，避免死循环。
      let evictedAny = false;
      for (const old of this.buckets.values()) {
        const evicted = old.shift();
        if (evicted === undefined) continue;
        this.cachedBytes -= evicted.length * 4;
        evictedAny = true;
        break;
      }
      if (!evictedAny) break;
    }
    queue.push(buffer);
    this.cachedBytes += bytes;
  }

  /** L49 `retainedByteCount`。 */
  get retainedByteCount(): number {
    return this.cachedBytes;
  }
}

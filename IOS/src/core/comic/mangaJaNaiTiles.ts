/**
 * mangaJaNaiTiles.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNaiTiles.kt
 *
 * Kotlin source: 64 lines / 47 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-3     package + `import android.graphics.Bitmap` — package decl / import    │
 * │ L5-8     doc comment                          — kept verbatim                 │
 * │ L9-39    `class MangaJaNaiTileCache`          — ported verbatim               │
 * │ L41-63   `fun readMangaJaNaiTile(...)`        — ported verbatim               │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comments kept verbatim:
 *   "Exact input matches only. Stores FP32 network cores before strength/detail
 *    composition. Mobile caller keeps one entry (910,336 B); no page-sized cache
 *    or second session. Access is serialized by MangaJaNai's page lock."
 *   "One native pixel read per tile, followed by the same clamped edge replication
 *    as before."
 *
 * ADAPTATIONS
 * - `IntArray` → `Int32Array` (identical 32-bit signed packing, same `contentEquals`
 *   semantics when compared element-wise).
 * - `FloatArray` → `Float32Array` (IEEE-754 binary32, matching the JVM's `float`).
 * - `input.contentHashCode()` → `Arrays.hashCode` semantics, i.e. the same
 *   `31 * h + element` recurrence over the *same* element order. The hash is only
 *   ever used as a fast pre-filter — the authoritative check stays
 *   `contentEquals` — so a divergence would cost performance, never correctness.
 * - `ArrayList.removeAt(index)` / `add(entry)` → `splice` + `push`; the LRU
 *   move-to-end behaviour is identical.
 * - `Bitmap.getPixels(...)` → the caller supplies a `readPixels` seam; the port
 *   itself only does the edge replication that Kotlin does afterwards.
 * - `java.util.Arrays.fill(target, from, to, value)` → `TypedArray.fill(value, from, to)`.
 * - `target.copyInto(target, dst, srcFrom, srcTo)` → `TypedArray.copyWithin`.
 */

/** Kotlin `IntArray` for this file's purposes. */
type IntArrayLike = Int32Array;
/** Kotlin `FloatArray`. */
type FloatArrayLike = Float32Array;

/** Kotlin `Arrays.hashCode(IntArray)` — the standard 31-multiplier recurrence. */
export function intArrayHashCode(array: IntArrayLike): number {
  let hash = 1;
  for (let i = 0; i < array.length; i += 1) {
    hash = (Math.imul(31, hash) + (array[i] as number)) | 0;
  }
  return hash;
}

/** Kotlin `IntArray.contentEquals(other)`. */
export function intArrayContentEquals(a: IntArrayLike, b: IntArrayLike): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Kotlin L9-39 `internal class MangaJaNaiTileCache(private val capacity: Int = 8)`.
 *
 * LRU over *exact* input matches. On a hit the entry moves to the end; on a miss
 * with a full cache the oldest entry is **reused in place** (Kotlin's `require`
 * that the replacement has the same shape is kept as a throw).
 */
export class MangaJaNaiTileCache {
  private readonly entries: Array<{ hash: number; input: IntArrayLike; output: FloatArrayLike }> = [];

  constructor(private readonly capacity: number = 8) {}

  /** Kotlin L12 `internal val size: Int get() = entries.size`. */
  get size(): number {
    return this.entries.length;
  }

  /** Kotlin L14-21 `fun find(input: IntArray): FloatArray?`. */
  find(input: IntArrayLike): FloatArrayLike | null {
    const hash = intArrayHashCode(input);
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index] as {
        hash: number;
        input: IntArrayLike;
        output: FloatArrayLike;
      };
      if (entry.hash === hash && intArrayContentEquals(entry.input, input)) {
        this.entries.splice(index, 1);
        this.entries.push(entry);
        return entry.output;
      }
    }
    return null;
  }

  /** Kotlin L23-36 `fun put(input: IntArray, output: FloatArray)`. */
  put(input: IntArrayLike, output: FloatArrayLike): void {
    if (this.capacity <= 0) return;
    if (this.entries.length < this.capacity) {
      this.entries.push({
        hash: intArrayHashCode(input),
        input: input.slice() as IntArrayLike,
        output: output.slice() as FloatArrayLike,
      });
      return;
    }
    const oldest = this.entries[0] as {
      hash: number;
      input: IntArrayLike;
      output: FloatArrayLike;
    };
    if (oldest.input.length !== input.length || oldest.output.length !== output.length) {
      // Kotlin L29 `require(it.input.size == input.size && it.output.size == output.size)`
      throw new RangeError('MangaJaNai tile 缓存条目尺寸不一致');
    }
    this.entries.shift();
    oldest.hash = intArrayHashCode(input);
    oldest.input.set(input);
    oldest.output.set(output);
    this.entries.push(oldest);
  }

  /** Kotlin L38 `fun clear() = entries.clear()`. */
  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * Kotlin L42-63 `fun readMangaJaNaiTile(source, x, y, target, tileSize, halo)`.
 *
 * Fills `target` (a `side × side` `IntArray`, row-major) with the tile at `(x, y)`
 * of `source`, replicating edge pixels outside the bitmap — exactly one native
 * pixel read, then the same clamped fill as Kotlin.
 *
 * @param readRect 宿主像素读入缝（对应 `Bitmap.getPixels`）。签名为
 *   `(dst, dstOffset, dstStride, srcLeft, srcTop, width, height)`，与
 *   `Bitmap.getPixels(target, dy*side+dx, side, left, top, width, height)` 逐参数对应。
 */
export function readMangaJaNaiTile(
  readRect: (
    dst: IntArrayLike,
    dstOffset: number,
    dstStride: number,
    srcLeft: number,
    srcTop: number,
    width: number,
    height: number,
  ) => void,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  target: IntArrayLike,
  tileSize: number,
  halo: number,
): void {
  const side = tileSize + halo * 2;
  const left = Math.max(0, x - halo);
  const top = Math.max(0, y - halo);
  const right = Math.min(sourceWidth, x + tileSize + halo);
  const bottom = Math.min(sourceHeight, y + tileSize + halo);
  const dx = left - x + halo;
  const dy = top - y + halo;
  const width = right - left;
  const height = bottom - top;

  // Kotlin L53 `source.getPixels(target, dy * side + dx, side, left, top, width, height)`
  readRect(target, dy * side + dx, side, left, top, width, height);

  // Kotlin L54-58 — 左右边缘按行复制（行内 `dx` 与 `side-dx-width` 两段）
  for (let row = dy; row < dy + height; row += 1) {
    const offset = row * side;
    const leftFill = target[offset + dx] as number;
    target.fill(leftFill, offset, offset + dx);
    const rightFill = target[offset + dx + width - 1] as number;
    target.fill(rightFill, offset + dx + width, offset + side);
  }

  // Kotlin L59 — 顶部缺失的行整行复制自第一有效行
  for (let row = 0; row < dy; row += 1) {
    target.copyWithin(row * side, dy * side, (dy + 1) * side);
  }

  // Kotlin L60-62 — 底部缺失的行整行复制自最后有效行
  for (let row = dy + height; row < side; row += 1) {
    target.copyWithin(row * side, (dy + height - 1) * side, dy + height * side);
  }
}

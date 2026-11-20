/**
 * 书架碎裂/飞散效果的纯几何 —— `ui/shelf/ShelfMotion.kt` L87-117 的 TS 移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L87 `class ShelfBurst(key, bitmap, origin, shards)` → `ShelfBurst`（`progress` 由 UI 持有）
 *   L91 `data class ShelfShard(points, center, velocity, spin, delay)` → `ShelfShard`
 *   L96-117 `shelfShards(width, height, seed)`：
 *     `columns = 4` / `rows = 6`；网格顶点在内部格点上抖动 `±.25`；
 *     三角形按 `(x + y) % 2` 交错切分（`a,b,c`+`a,c,d` 或 `a,b,d`+`b,c,d`）；
 *     速度 `Offset(radial * .75f + (rand - .5f) * width * .35f, -height * (.12f + rand * .18f))`；
 *     自旋 `(rand - .5f) * 70f`；延迟 `(center.y / height) * .12f + rand * .04f`
 *   L73 `if (created.isEmpty()) delay(120)`
 *   L75 `tween(660, easing = LinearEasing)`
 *   L53 `fresh.take(8)`（最多 8 张卡片做快照）
 *   L153-155 渲染期：`travel = 1 - (1-t)²`、`fade = (1 - ((t-.22)/.78).clamp(0,1))^1.5`
 *   L156 `translate(velocity * travel, velocity.y * travel + h * .75f * t²)`
 *   L157-159 `rotate(spin * travel)` + `scale(1 - .24f * t)`
 *
 * 平台差异（已登记 E121）
 * ─────────────────────
 *  * Kotlin 用 `kotlin.random.Random(seed)`（XorWowRandom）抖动网格；Web 侧用 mulberry32。
 *    分布、范围、数量（4×6×2 = 48 片）完全一致，**具体抖动值不同** —— 逐帧重放不要求
 *    与 Android 像素级一致（这是纯装饰），但片数与运动方程逐值照抄。
 *  * `GraphicsLayer.toImageBitmap()` 的快照 → `<canvas>` 截图（`ShelfMotion.tsx`）。
 */

/** L98 / L99。 */
export const SHELF_SHARD_COLUMNS = 4;
export const SHELF_SHARD_ROWS = 6;
/** L53 `fresh.take(8)`。 */
export const SHELF_BURST_MAX_CAPTURES = 8;
/** L73 `delay(120)`（去重确认的防抖）。 */
export const SHELF_BURST_DEBOUNCE_MS = 120;
/** L75 `tween(660, easing = LinearEasing)`。 */
export const SHELF_BURST_MS = 660;
/** L155 淡出起点与指数。 */
export const SHELF_SHARD_FADE_START = 0.22;
export const SHELF_SHARD_FADE_POWER = 1.5;
/** L158 缩放衰减。 */
export const SHELF_SHARD_SCALE_DECAY = 0.24;
/** L156 下坠系数。 */
export const SHELF_SHARD_FALL = 0.75;

export interface ShelfPoint {
  readonly x: number;
  readonly y: number;
}

/** L91 `ShelfShard`。`path` 由渲染期按 `points` 重建（Canvas2D `moveTo/lineTo/closePath`）。 */
export interface ShelfShard {
  readonly points: readonly ShelfPoint[];
  readonly center: ShelfPoint;
  readonly velocity: ShelfPoint;
  readonly spin: number;
  readonly delay: number;
}

/** mulberry32：32 位确定性 PRNG（替代 `kotlin.random.Random(seed)`，见文件头差异说明）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L96-117 `shelfShards(width, height, seed)`。 */
export function shelfShards(width: number, height: number, seed: number): readonly ShelfShard[] {
  const random = mulberry32(seed);
  const columns = SHELF_SHARD_COLUMNS;
  const rows = SHELF_SHARD_ROWS;
  const grid: ShelfPoint[][] = [];
  for (let y = 0; y <= rows; y += 1) {
    const row: ShelfPoint[] = [];
    for (let x = 0; x <= columns; x += 1) {
      const jitterX = x > 0 && x < columns ? random() * 0.5 - 0.25 : 0;
      const jitterY = y > 0 && y < rows ? random() * 0.5 - 0.25 : 0;
      row.push({ x: ((x + jitterX) * width) / columns, y: ((y + jitterY) * height) / rows });
    }
    grid.push(row);
  }
  const out: ShelfShard[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const row = grid[y];
      const nextRow = grid[y + 1];
      if (row === undefined || nextRow === undefined) continue;
      const a = row[x];
      const b = row[x + 1];
      const c = nextRow[x + 1];
      const d = nextRow[x];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      const triangles =
        (x + y) % 2 === 0
          ? [
              [a, b, c],
              [a, c, d],
            ]
          : [
              [a, b, d],
              [b, c, d],
            ];
      for (const points of triangles) {
        const p0 = points[0];
        const p1 = points[1];
        const p2 = points[2];
        if (p0 === undefined || p1 === undefined || p2 === undefined) continue;
        const center = {
          x: (p0.x + p1.x + p2.x) / 3,
          y: (p0.y + p1.y + p2.y) / 3,
        };
        const radial = (center.x / width - 0.5) * width;
        out.push({
          points,
          center,
          velocity: {
            x: radial * 0.75 + (random() - 0.5) * width * 0.35,
            y: -height * (0.12 + random() * 0.18),
          },
          spin: (random() - 0.5) * 70,
          delay: (center.y / height) * 0.12 + random() * 0.04,
        });
      }
    }
  }
  return out;
}

/** L153 `t = ((progress - shard.delay) / (1 - shard.delay)).coerceIn(0, 1)`。 */
export function shelfShardProgress(progress: number, delay: number): number {
  return Math.min(Math.max((progress - delay) / (1 - delay), 0), 1);
}

/** L154 `travel = 1 - (1 - t)²`。 */
export function shelfShardTravel(t: number): number {
  return 1 - (1 - t) ** 2;
}

/** L155 `fade = (1 - ((t - .22) / .78).coerceIn(0, 1))^1.5`。 */
export function shelfShardFade(t: number): number {
  return (1 - Math.min(Math.max((t - SHELF_SHARD_FADE_START) / (1 - SHELF_SHARD_FADE_START), 0), 1)) **
    SHELF_SHARD_FADE_POWER;
}

/** L158 `scale = 1 - .24f * t`。 */
export function shelfShardScale(t: number): number {
  return 1 - SHELF_SHARD_SCALE_DECAY * t;
}

/** L156 `translate(dx, dy + h * .75f * t * t)`。 */
export function shelfShardOffset(
  velocity: ShelfPoint,
  travel: number,
  bitmapHeight: number,
  t: number,
): ShelfPoint {
  return {
    x: velocity.x * travel,
    y: velocity.y * travel + bitmapHeight * SHELF_SHARD_FALL * t * t,
  };
}

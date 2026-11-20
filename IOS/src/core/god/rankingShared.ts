/**
 * 神回排行页的共享视觉与稳定随机 —— `god/GodRankingShared.kt` L213-343 的纯逻辑移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L213-228 `GodMenuItem(text, onClick, danger = false)`：132×42、14sp Medium、start 16dp、
 *            danger → `colorScheme.error`                         → `GOD_MENU_ITEM`
 *   L230-231 `Modifier.clickableItem(onClick)` = `pullOutClickable` → `clickableItem`
 *   L330     `centerCropRatio(w, h) = if (h > 0) w/h else 1f`        → 同名
 *   L333-340 `stableRandom(id, salt = 0)`：`x = id*31 + salt*7919`，三次 xor-shift + 乘，
 *            `abs(x % 10000) / 10000`，夹到 [0, 1]                    → 同名
 *   L343     `stableTiltDeg(id, salt = 0) = stableRandom * 12 - 6`    → 同名
 *
 * 注意：`stableRandom` 用 `Long` 运算，JS 侧必须用 `BigInt` 才能逐位一致；
 * 这里用 `BigInt` 实现并在末尾还原成 Number（结果只用到 `% 10000`）。
 */

/** L214-226 的几何常量。 */
export const GOD_MENU_ITEM = {
  widthDp: 132,
  heightDp: 42,
  fontSizeSp: 14,
  paddingStartDp: 16,
} as const;

/** L217 `Modifier.clickableItem(onClick)` 的等价标注（Web 由 `pullOutClickable` 承担）。 */
export function clickableItem(): 'pullOutClickable' {
  return 'pullOutClickable';
}

/** L330 `centerCropRatio(w, h)`。 */
export function centerCropRatio(w: number, h: number): number {
  return h > 0 ? w / h : 1;
}

const MASK64 = (1n << 64n) - 1n;

/** L333-340 `stableRandom(id, salt = 0)`：由 id 决定的固定值，重组后不跳变。 */
export function stableRandom(id: number, salt = 0): number {
  let x = (BigInt(Math.trunc(id)) * 31n + BigInt(Math.trunc(salt)) * 7919n) & MASK64;
  x = x ^ (x >> 13n);
  x = (x * 0x5deece66dn) & MASK64;
  x = x ^ (x >> 17n);
  const mod = x % 10000n;
  const v = Number(mod < 0n ? -mod : mod) / 10000;
  return Math.max(0, Math.min(v, 1));
}

/** L343 `stableTiltDeg(id, salt = 0)`：-6° ~ +6°。 */
export function stableTiltDeg(id: number, salt = 0): number {
  return stableRandom(id, salt) * 12 - 6;
}

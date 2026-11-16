/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidBlob.kt` (53 non-blank lines)
 *   `DrawScope.drawLiquidBlob(from, to, radius, intensity, color)` (lines 21-68)
 *   → `liquidBlobSvg()` returning the two end circles plus the bridging `<path>`.
 *
 * ADAPTATION — Compose Canvas → SVG
 * ─────────────────────────────────
 * `drawCircle` → `<circle>`, `Path.moveTo/lineTo/cubicTo/close` → SVG `d`.
 * The geometry maths (unit vectors, neck narrowing as a function of separation,
 * the distance clamp) is ported verbatim, so the blob outline is identical.
 */

/**
 * 液桥（Metaball Bridge）：两个圆之间的"液滴拉丝"连接体。
 *
 * @param from    液桥起点（固定端圆心）
 * @param to      液桥终点（运动端圆心）
 * @param radius  两端圆半径（当前按同半径处理）
 * @param intensity 液桥强度 0..1：0=完全缩入滑块不可见，1=最饱满
 */
export function liquidBlobSvg(
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  intensity: number,
): string {
  if (intensity <= 0.02) return '';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < radius * 0.5) {
    // 距离过近：直接画一个融合的大圆即可
    const r = radius * (1 + 0.25 * intensity);
    return `<circle cx="${to.x}" cy="${to.y}" r="${r}" />`;
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;

  // 液桥颈部随距离增大而收细；intensity 越大越饱满
  const separation = Math.max(0, dist - radius * 2) / Math.max(1, dist);
  const neckScale = ((1 - separation) * 0.9 + 0.18) * intensity;
  const neck = radius * neckScale;

  // 上轮廓：from 顶 → 贝塞尔鼓包 → to 顶；下轮廓回到起点
  const d =
    `M${from.x + nx * radius},${from.y + ny * radius} ` +
    `C${from.x + nx * (radius + neck)},${from.y + ny * (radius + neck)} ` +
    `${to.x + nx * (radius + neck)},${to.y + ny * (radius + neck)} ` +
    `${to.x + nx * radius},${to.y + ny * radius} ` +
    `L${to.x - nx * radius},${to.y - ny * radius} ` +
    `C${to.x - nx * (radius + neck)},${to.y - ny * (radius + neck)} ` +
    `${from.x - nx * (radius + neck)},${from.y - ny * (radius + neck)} ` +
    `${from.x - nx * radius},${from.y - ny * radius} Z`;

  // 端点圆保证与滑块无缝融合
  return (
    `<circle cx="${from.x}" cy="${from.y}" r="${radius}" />` +
    `<circle cx="${to.x}" cy="${to.y}" r="${radius}" />` +
    `<path d="${d}" />`
  );
}
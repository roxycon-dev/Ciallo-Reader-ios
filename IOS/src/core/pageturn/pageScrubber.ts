/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PageScrubber.kt` — the pure geometry / inertia maths.
 *   (the whole 520-line Composable lives in src/ui/components/pageturn/PageScrubber.tsx)
 *
 *   lines 166-174 pageScale / pageW / pageH / topY / baseX → scrubberGeometry()
 *   lines 182-189 slotAngle / kR / stride / camR / offsetFor() → scrubberGeometry()
 *   lines 191-200 minOff / maxOff / initial / centerIdx    → scrubberGeometry(), centerIndexOf()
 *   lines 269-288 `suspend fun settle(velocity)`           → settleTarget()
 *   lines 377-385 renderOrder computation                  → scrubberRenderOrder()
 *   lines 404-424 per-page 3D transform                    → scrubberPageTransform()
 *
 * Compose `Animatable<Float>` → a plain mutable number driven by rAF; the maths
 * is unchanged.
 */

export interface ScrubberGeometry {
  pageScale: number;
  pageW: number;
  pageH: number;
  topY: number;
  baseX: number;
  /** 相邻页圆心角（度） */
  slotAngle: number;
  /** 环半径：侧页内缘与中心页留 ~65px 间隙、可见约 150px */
  kR: number;
  /** 弧长步进：中心页屏幕位移 ≈ offset 位移（拖动跟手 1:1） */
  stride: number;
  minOff: number;
  maxOff: number;
  initialOffset: number;
}

/** PageScrubber.kt lines 166-195. */
export function scrubberGeometry(
  screenW: number,
  screenH: number,
  pageCount: number,
  initialPage: number,
): ScrubberGeometry {
  // 页面缩放：必须与内容纵横比一致。0.60 → 页宽略小于弦距，两侧各露出约一页的斜面。
  const pageScale = 0.6;
  const pageW = screenW * pageScale;
  const pageH = screenH * pageScale;
  const topY = (screenH - pageH) / 2;
  const baseX = (screenW - pageW) / 2;

  const slotAngle = 30;
  const kR = screenW * 1.24;
  const stride = kR * ((slotAngle * Math.PI) / 180);

  const offsetFor = (i: number): number => -i * stride;
  const minOff = offsetFor(pageCount - 1);
  const maxOff = offsetFor(0);
  const initial = Math.max(0, Math.min(pageCount - 1, initialPage));

  return {
    pageScale,
    pageW,
    pageH,
    topY,
    baseX,
    slotAngle,
    kR,
    stride,
    minOff,
    maxOff,
    initialOffset: offsetFor(initial),
  };
}

/** PageScrubber.kt lines 198-202 `derivedStateOf { (-offset.value / stride).roundToInt() }`. */
export function centerIndexOf(offset: number, stride: number, pageCount: number): number {
  const raw = Math.round(-offset / stride);
  return Math.max(0, Math.min(pageCount - 1, raw));
}

/**
 * PageScrubber.kt lines 269-288 `settle(velocity)` —
 * 甩动惯性：带初速度的弹簧吸附到目标页——只吸附，不进入。
 * 时间常数 0.7s：慢拖松手（~400px/s）→ 不足一页；普通快甩（~2500px/s）→ 2~3 页；
 * 用力甩（~6000px/s）→ 6 页；极速封顶 12 页。
 */
export function settleTarget(
  velocity: number,
  centerIdx: number,
  stride: number,
  pageCount: number,
): number {
  const dist = velocity * 0.7;
  const pages = Math.min(12, Math.round(Math.abs(dist) / stride));
  if (pages === 0) return centerIdx;
  return Math.max(
    0,
    Math.min(pageCount - 1, centerIdx + (dist < 0 ? pages : -pages)),
  );
}

/** PageScrubber.kt line 284 — 贴边目标加大阻尼，避免过冲到空白弧段。 */
export function settleDamping(target: number, pageCount: number): number {
  const atEdge = target === 0 || target === pageCount - 1;
  return atEdge ? 0.95 : 0.85;
}

/**
 * PageScrubber.kt lines 377-385 —
 * 绘制顺序按离中心距离降序：中心页最后画（压最上层），弧上两侧层层后退。
 * 进入/取消时，目标页强制提到最上层飞行。
 * 只组合中心附近 ±6 页（内容仅 ±3 页），长章节不至组合上百节点。
 */
export function scrubberRenderOrder(
  pageCount: number,
  centerIdx: number,
  committed: number | null,
): number[] {
  const list: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (Math.abs(i - centerIdx) <= 6) list.push(i);
  }
  list.sort((a, b) => Math.abs(b - centerIdx) - Math.abs(a - centerIdx));
  if (committed !== null && list.includes(committed)) {
    return [...list.filter((i) => i !== committed), committed];
  }
  return list;
}

export interface ScrubberPageTransform {
  /** `d = i + offset / stride` — 该页相对中心的弧位（可为小数）。 */
  d: number;
  /** `phi = d * slotAngle * e` (deg) */
  phi: number;
  /** 进场/退场收缩/放大因子 `s`. */
  s: number;
  /** 中心页贴近时的轻微 pop 因子。 */
  pop: number;
  /** `k = s * pop` */
  k: number;
  /** `rotationY = -phi` (deg) */
  rotationY: number;
  /** `translationX = k * kR * sin(phi)` (px) */
  translationX: number;
  scaleX: number;
  scaleY: number;
  /** CSS `perspective()` value in px (Compose cameraDistance in dp). */
  perspective: number;
  /** 圆柱内壁暗纱 alpha；null = 不画暗纱。 */
  shade: number | null;
}

/** PageScrubber.kt lines 404-424 + 437-448. */
export function scrubberPageTransform(options: {
  index: number;
  offset: number;
  enter: number;
  geometry: ScrubberGeometry;
  committed: number | null;
  specialPage: number;
  /** 内容窗口 ±3 页之外不合成内容。 */
  inWindow: boolean;
}): ScrubberPageTransform {
  const { index, offset, enter, geometry, committed, specialPage } = options;
  const e = enter;
  const d = index + offset / geometry.stride;
  const phi = d * geometry.slotAngle * e;
  const rad = (phi * Math.PI) / 180;
  // 进场/退场：目标页在"满屏 ↔ 环上一页"之间收缩/放大
  const flying = committed !== null || e < 0.999;
  const s = index === specialPage && flying ? 1 + (1 - e) * (1 / geometry.pageScale - 1) : 1;
  // 中心页贴近时轻微 pop（手感强调，非远近模拟）
  const pop = 1 + 0.035 * (1 - Math.min(1, Math.abs(d))) * Math.max(0, Math.min(1, e));
  const k = s * pop;

  let shade: number | null = null;
  if (!(index === specialPage && flying)) {
    const shadeValue =
      (Math.max(0, Math.min(0.45, (Math.abs(d) - 0.22) / 3.2)) * Math.max(0, Math.min(1, e))) +
      (1 - e) * 0.55;
    shade = shadeValue > 0.004 ? Math.max(0, Math.min(1, shadeValue)) : null;
  }

  return {
    d,
    phi,
    s,
    pop,
    k,
    rotationY: -phi,
    translationX: k * geometry.kR * Math.sin(rad),
    scaleX: k,
    scaleY: k,
    perspective: geometry.kR,
    shade,
  };
}

/** PageScrubber.kt lines 330-345 — 两端橡皮筋阻力：越拉越紧 + 到边振动一次。 */
export function rubberBandOffset(raw: number, maxOff: number, minOff: number): number {
  if (raw > maxOff) return maxOff + (raw - maxOff) * 0.32;
  if (raw < minOff) return minOff + (raw - minOff) * 0.32;
  return raw;
}

/** PageScrubber.kt line 249 — `enter.animateTo(1f, spring(0.75f, 380f))` → CSS. */
export const ENTER_SPRING = {
  dampingRatio: 0.75,
  stiffness: 380,
  bezier: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
};
export const SETTLE_STIFFNESS = 380;
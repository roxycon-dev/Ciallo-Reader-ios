/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PageTurnContainer.kt` lines 52-68 (the `BACKSIDE_CONTENT_ALPHA`
 *   constant + its long comment), 938-990 (the pure geometry helpers).
 *
 *   line  52 `private fun midPoint(a, b)`          → midPoint()
 *   line 941 `private fun curlNormal(...)`          → curlNormal()
 *   line 950 `private fun shadowStripPath(...)`     → shadowStripPath()
 *   line 963 `private fun mirrorAngleDeg(...)`      → mirrorAngleDeg()
 *   line 970 `private fun buildFlapPath(...)`       → buildFlapPath()
 *   line 511-551 Simulate3DCurlLayout geometry      → computeCurlGeometry()
 *
 * ADAPTATION — Compose `Path` → SVG path `d` strings
 * ───────────────────────────────────────────────────
 * `Path.moveTo/lineTo/cubicTo/close` map 1:1 onto SVG path commands, so the
 * fold/flap outlines are geometrically identical to Android's.
 * `drawWithContent { clip = shape }` → an SVG `<clipPath>` referenced by
 * `clip-path: url(#…)`, which is the only faithful way to clip a DOM subtree by
 * an arbitrary bezier outline.
 */

/** PageTurnContainer.kt line 60 — `BACKSIDE_CONTENT_ALPHA = 0.88f`. */
export const BACKSIDE_CONTENT_ALPHA = 0.88;

export interface Pt {
  x: number;
  y: number;
}

/** PageTurnContainer.kt line 938. */
export function midPoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** PageTurnContainer.kt line 941. */
export function curlNormal(fromTop: Pt, fromBottom: Pt, sign: number): Pt {
  const dx = fromBottom.x - fromTop.x;
  const dy = fromBottom.y - fromTop.y;
  const len = Math.max(0.001, Math.hypot(dx, dy));
  let n: Pt = { x: -dy / len, y: dx / len };
  if (sign > 0 !== n.x > 0) n = { x: -n.x, y: -n.y };
  return n;
}

/** PageTurnContainer.kt line 950. */
export function shadowStripPath(
  fromTop: Pt,
  fromBottom: Pt,
  normal: Pt,
  width: number,
): string {
  return (
    `M${fromTop.x},${fromTop.y} ` +
    `L${fromBottom.x},${fromBottom.y} ` +
    `L${fromBottom.x + normal.x * width},${fromBottom.y + normal.y * width} ` +
    `L${fromTop.x + normal.x * width},${fromTop.y + normal.y * width} Z`
  );
}

/** PageTurnContainer.kt line 963. */
export function mirrorAngleDeg(foldTop: Pt, foldBottom: Pt): number {
  const dx = foldTop.x - foldBottom.x;
  const dy = foldTop.y - foldBottom.y;
  const angle = Math.PI - 2 * Math.atan2(dy, dx);
  return (angle * 180) / Math.PI;
}

/** PageTurnContainer.kt line 970. */
export function buildFlapPath(options: {
  foldTop: Pt;
  foldBottom: Pt;
  touchTop: Pt;
  touchBottom: Pt;
  creaseX: number;
  touchX: number;
  arcOffset: number;
  heightPx: number;
  bulgeSign: number;
}): string {
  const { foldTop, foldBottom, touchTop, touchBottom, arcOffset, heightPx, bulgeSign } = options;
  const foldMidX = options.creaseX + bulgeSign * arcOffset;
  const touchMidX = options.touchX + bulgeSign * arcOffset * 0.5;
  return (
    `M${foldTop.x},0 ` +
    `C${foldMidX},${heightPx * 0.35} ${foldMidX},${heightPx * 0.65} ${foldBottom.x},${heightPx} ` +
    `L${touchBottom.x},${heightPx} ` +
    `C${touchMidX},${heightPx * 0.65} ${touchMidX},${heightPx * 0.35} ${touchTop.x},0 Z`
  );
}

export interface CurlGeometry {
  isNext: boolean;
  absDragX: number;
  progress: number;
  isTopCorner: boolean;
  isBottomCorner: boolean;
  anchorY: number;
  anchorF: Pt;
  touchP: Pt;
  distanceV: number;
  midpointM: Pt;
  /** Kotlin computes it but never uses it (dead local) — kept for 1:1 parity. */
  foldLineDirectionDeg: number;
  curlRadius: number;
  arcOffset: number;
  creaseX: number;
  touchX: number;
  flapWidth: number;
  foldTop: Pt;
  foldBottom: Pt;
  touchTop: Pt;
  touchBottom: Pt;
}

/**
 * PageTurnContainer.kt lines 496-551 / 687-725 — the shared curl math for both
 * directions. `anchorX` is `widthPx` for next-page and `0` for previous-page.
 */
export function computeCurlGeometry(options: {
  dragPx: number;
  dragPy: number;
  touchDownY: number;
  widthPx: number;
  heightPx: number;
}): CurlGeometry {
  const { dragPx, dragPy, touchDownY, widthPx, heightPx } = options;
  const isNext = dragPx < 0;
  const absDragX = Math.abs(dragPx);
  const progress = Math.max(0, Math.min(1, absDragX / widthPx));

  const isTopCorner = touchDownY < heightPx * 0.35;
  const isBottomCorner = touchDownY > heightPx * 0.65;
  const anchorY = isTopCorner ? 0 : isBottomCorner ? heightPx : Math.max(0, Math.min(heightPx, touchDownY));
  const anchorX = isNext ? widthPx : 0;
  const anchorF: Pt = { x: anchorX, y: anchorY };
  const touchP: Pt = {
    x: isNext
      ? Math.max(0, Math.min(widthPx, widthPx + dragPx))
      : Math.max(0, Math.min(widthPx, dragPx)),
    y: Math.max(0, Math.min(heightPx, anchorY + dragPy)),
  };

  const vectorV: Pt = { x: touchP.x - anchorF.x, y: touchP.y - anchorF.y };
  const distanceV = Math.max(0.1, Math.hypot(vectorV.x, vectorV.y));
  const midpointM: Pt = { x: (anchorF.x + touchP.x) / 2, y: (anchorF.y + touchP.y) / 2 };

  // Fold line direction angle in degrees
  const foldLineAngleRad = Math.atan2(vectorV.y, vectorV.x) + Math.PI / 2;
  const foldLineDirectionDeg = (foldLineAngleRad * 180) / Math.PI;

  // Curl radius as a function of distance |V|
  const curlRadius = (32 + 0.16 * distanceV) * (0.65 + 0.35 * (1 - progress));
  const arcOffset = Math.max(4, Math.min(40, curlRadius * 0.6 * (1 - progress)));

  const creaseX = midpointM.x;
  const touchX = touchP.x;
  const flapWidth = isNext ? creaseX - touchX : touchX - creaseX;
  const dy = touchP.y - anchorY;

  const foldTopX = isTopCorner ? clamp(creaseX + dy * 0.15, 0, widthPx) : creaseX;
  const foldBottomX = isBottomCorner ? clamp(creaseX + dy * 0.15, 0, widthPx) : creaseX;
  const foldTop: Pt = { x: foldTopX, y: 0 };
  const foldBottom: Pt = { x: foldBottomX, y: heightPx };

  const touchTopX = isTopCorner ? clamp(touchX + dy * 0.15, 0, widthPx) : touchX;
  const touchBottomX = isBottomCorner ? clamp(touchX + dy * 0.15, 0, widthPx) : touchX;
  const touchTop: Pt = { x: touchTopX, y: 0 };
  const touchBottom: Pt = { x: touchBottomX, y: heightPx };

  return {
    isNext,
    absDragX,
    progress,
    isTopCorner,
    isBottomCorner,
    anchorY,
    anchorF,
    touchP,
    distanceV,
    midpointM,
    foldLineDirectionDeg,
    curlRadius,
    arcOffset,
    creaseX,
    touchX,
    flapWidth,
    foldTop,
    foldBottom,
    touchTop,
    touchBottom,
  };
}

/**
 * PageTurnContainer.kt lines 550-598 / 727-752 — the clip outline for the flat
 * (non-flipped) region of the current page. Two branches: next-page keeps the
 * left region, previous-page keeps the region right of the fold.
 */
export function flatClipPath(g: CurlGeometry, widthPx: number, heightPx: number): string {
  if (g.isNext) {
    const base = `M0,0 L0,${heightPx}`;
    if (g.isTopCorner) {
      return (
        `${base} L${widthPx},${heightPx} L${g.foldBottom.x},${heightPx} ` +
        `C${g.creaseX - g.arcOffset},${heightPx * 0.65} ${g.creaseX - g.arcOffset},${heightPx * 0.35} ${g.foldTop.x},0 Z`
      );
    }
    if (g.isBottomCorner) {
      return (
        `${base} L${g.foldBottom.x},${heightPx} ` +
        `C${g.creaseX - g.arcOffset},${heightPx * 0.65} ${g.creaseX - g.arcOffset},${heightPx * 0.35} ${g.foldTop.x},0 ` +
        `L${widthPx},0 Z`
      );
    }
    // Standard vertical drag must NOT keep top-right or bottom-right corner!
    // It should clip strictly at the fold line crease!
    return (
      `${base} L${g.foldBottom.x},${heightPx} ` +
      `C${g.creaseX - g.arcOffset},${heightPx * 0.65} ${g.creaseX - g.arcOffset},${heightPx * 0.35} ${g.foldTop.x},0 Z`
    );
  }
  return (
    `M0,0 L${g.foldTop.x},0 ` +
    `C${g.creaseX + g.arcOffset},${heightPx * 0.35} ${g.creaseX + g.arcOffset},${heightPx * 0.65} ${g.foldBottom.x},${heightPx} ` +
    `L0,${heightPx} Z`
  );
}

/**
 * PageTurnContainer.kt lines 602-658 / 759-777 — the shadow + inner-crease +
 * edge-highlight strips, expressed as `{d, gradient, gradientId}` so the component
 * can render them as SVG paths with linearGradient fills.
 */
export interface ShadowStrip {
  d: string;
  /** linear gradient stops, from `start` → `end`. */
  stops: string[];
  start: Pt;
  end: Pt;
}

export function dropShadowStrips(g: CurlGeometry): {
  drop: ShadowStrip | null;
  inner: ShadowStrip | null;
  edge: ShadowStrip | null;
} {
  const p = g.progress;
  let drop: ShadowStrip | null = null;
  const shadowWidth = Math.max(0, Math.min(140, g.curlRadius * 2.4 * (1 - p)));

  if (g.isNext) {
    const normal = curlNormal(g.foldTop, g.foldBottom, 1);
    const midFold = midPoint(g.foldTop, g.foldBottom);
    if (shadowWidth > 0) {
      drop = {
        d: shadowStripPath(g.foldTop, g.foldBottom, normal, shadowWidth),
        stops: [
          `rgba(0, 0, 0, ${0.26 * (1 - p)})`,
          `rgba(0, 0, 0, ${0.09 * (1 - p)})`,
          'rgba(0, 0, 0, 0)',
        ],
        start: midFold,
        end: { x: midFold.x + normal.x * shadowWidth, y: midFold.y + normal.y * shadowWidth },
      };
    }
    const innerShadowWidth = Math.max(15, Math.min(60, g.curlRadius * 1.0));
    let inner: ShadowStrip | null = null;
    if (g.creaseX > innerShadowWidth) {
      inner = {
        d: shadowStripPath(g.foldTop, g.foldBottom, normal, -innerShadowWidth),
        stops: ['rgba(0, 0, 0, 0)', `rgba(0, 0, 0, ${0.15 * (1 - p)})`],
        start: { x: midFold.x - normal.x * innerShadowWidth, y: midFold.y - normal.y * innerShadowWidth },
        end: midFold,
      };
    }
    const edgeHighlightWidth = Math.max(2, Math.min(6, g.curlRadius * 0.16));
    const edge: ShadowStrip = {
      d: shadowStripPath(g.foldTop, g.foldBottom, normal, edgeHighlightWidth),
      stops: [`rgba(255, 255, 255, ${0.3 * (1 - p)})`, 'rgba(255, 255, 255, 0)'],
      start: midFold,
      end: { x: midFold.x + normal.x * edgeHighlightWidth, y: midFold.y + normal.y * edgeHighlightWidth },
    };
    return { drop, inner, edge };
  }

  const normal = curlNormal(g.touchTop, g.touchBottom, 1);
  const midTouch = midPoint(g.touchTop, g.touchBottom);
  if (shadowWidth > 0) {
    drop = {
      d: shadowStripPath(g.touchTop, g.touchBottom, normal, shadowWidth),
      stops: [
        `rgba(0, 0, 0, ${0.26 * (1 - p)})`,
        `rgba(0, 0, 0, ${0.09 * (1 - p)})`,
        'rgba(0, 0, 0, 0)',
      ],
      start: midTouch,
      end: { x: midTouch.x + normal.x * shadowWidth, y: midTouch.y + normal.y * shadowWidth },
    };
  }
  return { drop, inner: null, edge: null };
}

/** PageTurnContainer.kt lines 887-893 — 柱面明暗 (cylinder shading) stops. */
export function flapShadeStops(fade: number): {
  stops: string[];
  positions: string[];
} {
  return {
    positions: ['0%', '18%', '40%', '58%', '82%', '100%'],
    stops: [
      `rgba(0, 0, 0, ${0.17 * fade})`,
      `rgba(0, 0, 0, ${0.07 * fade})`,
      `rgba(255, 255, 255, ${0.09 * fade})`,
      `rgba(255, 255, 255, ${0.04 * fade})`,
      `rgba(0, 0, 0, ${0.03 * fade})`,
      'rgba(0, 0, 0, 0)',
    ],
  };
}

/** PageTurnContainer.kt lines 918-923 — 沿移动边缘的纸张厚度路径. */
export function touchEdgePath(
  touchTop: Pt,
  touchBottom: Pt,
  touchX: number,
  arcOffset: number,
  bulgeSign: number,
  heightPx: number,
): string {
  const touchMidX = touchX + bulgeSign * arcOffset * 0.5;
  return (
    `M${touchTop.x},0 ` +
    `C${touchMidX},${heightPx * 0.35} ${touchMidX},${heightPx * 0.65} ${touchBottom.x},${heightPx} Z`
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
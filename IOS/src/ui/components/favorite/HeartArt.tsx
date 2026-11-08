/**
 * Port of Android `ui/favorite/HeartArt.kt` (99 lines total / 88 non-blank / 69 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–28   package + imports + the long KDoc explaining WHY not `Icons.Filled.Favorite`
 *          → file header (verbatim prose preserved).
 *   30–38  `fun heartPathPx(w, h): Path` (4 cubicTo + close) → `heartPathD()` in
 *          `@core/favorite/favoriteUi` + `HEART_PATH_D` below (same numbers).
 *   40–52  the HeartTop / HeartMid / HeartBottom KDoc + 3 `val Color(0x…)`
 *          → re-exported from favoriteUi (single source of truth).
 *   50–52  `private val ART_TOP/ART_MID/ART_BOTTOM` → `HeartPalette` in favoriteUi.
 *   54–58  HeartArt KDoc (`@param glow`) → component KDoc.
 *   59–63  `@Composable fun HeartArt(modifier, glow = 1f)` → `HeartArt` props.
 *   64     `Canvas(modifier) { … }` → `<svg viewBox="0 0 1 1">` with `<defs>`.
 *   65–67  `val w/h; if (w <= 0f || h <= 0f) return@Canvas` → viewBox is unit-sized,
 *          so the guard is structurally unnecessary; preserved as `size <= 0` early
 *          return so a zero-sized parent still renders nothing.
 *   68     `val path = heartPathPx(w, h)` → `HEART_PATH_D` const.
 *   70–81  ① 外发光 radial circle (ART_MID 0.34·glow → Transparent, center
 *          (0.5w, 0.52h), radius 0.78w) → `<circle class="fav-heart__glow">`
 *          with `<radialGradient>`; `glow > 0.01f` gate preserved.
 *   83–91  ② 主体 vertical gradient (ART_TOP → ART_MID → ART_BOTTOM, y 0→h)
 *          → `<linearGradient x1=0 y1=0 x2=0 y2=1>` on `<path>`.
 *   93–102 ③ 高光 white 0.42 radial at (0.36w, 0.28h), radius 0.20w
 *          → `<circle class="fav-heart__sheen">`.
 *   104–109 ④ 收边 white 0.20 stroke, `width = max(0.030w, 0.8f)`
 *          → `<path class="fav-heart__edge" vector-effect="non-scaling-stroke">`
 *          with `strokeWidth = max(0.03, 0.8 / size)`.
 *   110–111 closing braces.
 *   113–114 `val HeartArtDefaultSize = 46.dp` → `HeartArtDefaultSize` re-export.
 *
 * Skipped: nothing. The only structural change is Compose `Canvas` → SVG, which is
 * the documented adaptation; every magic number survives verbatim.
 */

import { useId } from 'react';
import {
  HeartPalette,
  HEART_EDGE_ALPHA,
  HEART_EDGE_MIN_PX,
  HEART_EDGE_WIDTH_FACTOR,
  HEART_GLOW_ALPHA,
  HEART_GLOW_CENTER,
  HEART_GLOW_RADIUS,
  HEART_SHEEN_ALPHA,
  HEART_SHEEN_CENTER,
  HEART_SHEEN_RADIUS,
  heartPathD,
} from '@core/favorite/favoriteUi';

export {
  HeartTop,
  HeartMid,
  HeartBottom,
  HeartPalette,
  HEART_ART_DEFAULT_SIZE,
} from '@core/favorite/favoriteUi';

/** HeartArtDefaultSize (Kotlin L114) — 心形画布的默认边长（按钮/飞行的公共尺寸基准）。 */
export const HeartArtDefaultSize = 46;

/** The single shared path, normalised to a 0..1 × 0..1 viewBox. */
const HEART_PATH_D = heartPathD();

/**
 * 一颗"有质感"的心。
 *
 * @param glow 外发光强度（0 = 不发光）。刚被点亮的那一瞬给 1，飞远了自然衰减。
 */
export function HeartArt(props: { size: number; glow?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glow = props.glow ?? 1;
  const size = props.size;

  // Kotlin L67: `if (w <= 0f || h <= 0f) return@Canvas`
  if (size <= 0) {
    return null;
  }

  // Kotlin L108: `Stroke(width = (w * 0.030f).coerceAtLeast(0.8f))` — the stroke is
  // expressed in viewBox units, so a 0.030 factor of 1.0 becomes 0.03 and the floor
  // is converted back from px into the same unit space.
  const strokeWidth = Math.max(HEART_EDGE_WIDTH_FACTOR, HEART_EDGE_MIN_PX / size);
  const showGlow = glow > 0.01;

  return (
    <svg
      className={props.className === undefined ? 'fav-heart' : `fav-heart ${props.className}`}
      width={size}
      height={size}
      viewBox="0 0 1 1"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {showGlow ? (
          <radialGradient
            id={`fav-heart-glow-gradient-${uid}`}
            cx={String(HEART_GLOW_CENTER.x)}
            cy={String(HEART_GLOW_CENTER.y)}
            r={String(HEART_GLOW_RADIUS)}
          >
            <stop
              offset="0"
              stopColor={HeartPalette.mid}
              stopOpacity={String(HEART_GLOW_ALPHA * glow)}
            />
            <stop offset="1" stopColor={HeartPalette.mid} stopOpacity="0" />
          </radialGradient>
        ) : null}
        <linearGradient id={`fav-heart-body-gradient-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={HeartPalette.top} />
          <stop offset="0.5" stopColor={HeartPalette.mid} />
          <stop offset="1" stopColor={HeartPalette.bottom} />
        </linearGradient>
        <radialGradient
          id={`fav-heart-sheen-gradient-${uid}`}
          cx={String(HEART_SHEEN_CENTER.x)}
          cy={String(HEART_SHEEN_CENTER.y)}
          r={String(HEART_SHEEN_RADIUS)}
        >
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={String(HEART_SHEEN_ALPHA)} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {showGlow ? (
        <circle
          className="fav-heart__glow"
          cx={HEART_GLOW_CENTER.x}
          cy={HEART_GLOW_CENTER.y}
          r={HEART_GLOW_RADIUS}
          fill={`url(#fav-heart-glow-gradient-${uid})`}
        />
      ) : null}

      <path className="fav-heart__body" d={HEART_PATH_D} fill={`url(#fav-heart-body-gradient-${uid})`} />

      <circle
        className="fav-heart__sheen"
        cx={HEART_SHEEN_CENTER.x}
        cy={HEART_SHEEN_CENTER.y}
        r={HEART_SHEEN_RADIUS}
        fill={`url(#fav-heart-sheen-gradient-${uid})`}
      />

      <path
        className="fav-heart__edge"
        d={HEART_PATH_D}
        strokeWidth={strokeWidth}
        strokeOpacity={HEART_EDGE_ALPHA}
      />
    </svg>
  );
}

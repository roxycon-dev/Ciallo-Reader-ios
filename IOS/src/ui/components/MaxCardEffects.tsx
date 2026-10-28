import { useRef, type CSSProperties } from 'react';
import { useRenderQuality } from './GlassQuality';
import { useMaxFxFrame } from './maxFxFrame';
import { chromaFlowEdgeCss, shimmerPearlCss } from '../../core/glass/maxFx';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/MaxCardEffects.kt` (130 non-blank lines) — FULL PORT
 *   line 44 `fun of(id: Int)`                              → see GlassQuality.tsx
 *   lines 40-88  `Modifier.chromaFlowEdge(primary, secondary, cornerRadiusDp, durationMillis)`
 *                 → ChromaFlowEdge
 *   lines 104-136 `Modifier.shimmerPearl(baseColor, durationMillis)`
 *                 → ShimmerPearl
 *   lines 138-151 `private fun Path.addRoundRect(w, h, r)`   → addRoundRectPath (core)
 *
 * File header verbatim:
 *   MAX 卡片增强特效 —— 概念源自 ChromaFlow(扫光辉光) + Shimmerfy(珠光流动)。
 *    · Modifier.chromaFlowEdge()：一道彩色光带沿卡片边缘顺时针巡游（ChromaFlow 思路）；
 *    · Modifier.shimmerPearl()：卡面珠光微光层缓慢漂移（ShimmerFy 思路）；
 *    · 叠加 glassSheen 高光扫过 = 三层动态效果。
 *   仅在 RenderQuality.MAX 时生效，其余档位零开销。
 *
 * `chromaFlowEdge` / `shimmerPearl` also live in `src/ui/components/MaxFx.tsx`
 * (they're referenced by GlassCard.kt alongside `glassSheen`); this file is the
 * one-tick-per-file home required by the porting plan, and re-exports the same
 * components so both import paths resolve to one implementation.
 *
 * ADAPTATION — Compose `drawBehind` → absolutely-positioned CSS overlay
 * `Brush.sweepGradient` → `conic-gradient`; `Brush.radialGradient` → `radial-gradient`.
 * The infinite transitions become CSS `@keyframes` declared in
 * `src/styles/components.css` (`chroma-flow-spin`, `shimmer-pearl-drift`).
 */

export {
  CHROMA_FLOW_DURATION_MS,
  SHIMMER_PEARL_DURATION_MS,
  addRoundRectPath,
  chromaFlowEdgeCss,
  shimmerPearlCss,
} from '../../core/glass/maxFx';

export interface MaxCardEffectProps {
  width: number;
  height: number;
  primary: string;
  secondary: string;
  /** MaxCardEffects.kt line 43 — default 24f */
  cornerRadiusDp?: number;
  /** MaxCardEffects.kt line 44 — default 3500 */
  durationMillis?: number;
  /** MaxCardEffects.kt line 107 — default 4000 */
  pearlDurationMillis?: number;
  /** MaxCardEffects.kt line 106 `baseColor` — kept for parity; unused on the web. */
  baseColor?: string;
  className?: string;
  style?: CSSProperties;
}

/** 边缘彩色光带巡游：沿卡片轮廓画一圈渐变描边，亮段沿周长匀速移动。 */
export function ChromaFlowEdge(props: MaxCardEffectProps) {
  // 仅在 RenderQuality.MAX 时生效，其余档位零开销
  if (useRenderQuality() !== 'MAX') return null;
  const css = chromaFlowEdgeCss({
    width: props.width,
    height: props.height,
    primary: props.primary,
    secondary: props.secondary,
    cornerRadiusDp: props.cornerRadiusDp ?? 24,
    strokeWidth: 2,
  });
  if (css === '') return null;
  return (
    <span
      className={props.className ?? 'chroma-flow-edge'}
      aria-hidden="true"
      style={{ ...(css as unknown as CSSProperties), ...props.style }}
    />
  );
}

/** 珠光微光层：卡面上一块柔和的椭圆渐变光斑缓慢漂移（ShimmerFy 思路）。 */
export function ShimmerPearl(props: MaxCardEffectProps) {
  const max = useRenderQuality() === 'MAX';
  const ref = useRef<HTMLSpanElement | null>(null);
  const { width, height } = props;

  useMaxFxFrame(ref, (el, p) => {
    el.style.cssText = shimmerPearlCss(width, height, p.pearl);
  });

  if (!max) return null;
  const initial = shimmerPearlCss(width, height, 0);
  if (initial === '') return null;
  return (
    <span
      ref={ref}
      className={props.className ?? 'shimmer-pearl'}
      aria-hidden="true"
      style={{ ...(initial as unknown as CSSProperties), ...props.style }}
    />
  );
}
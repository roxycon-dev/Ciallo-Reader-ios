import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useRenderQuality } from './GlassQuality';
import { useMaxFxFrame } from './maxFxFrame';
import {
  AURA_ALPHA_MAX,
  AURA_ALPHA_MIN,
  CHROMA_FLOW_DURATION_MS,
  chromaFlowEdgeCss,
  glassSheenCss,
  maxCardAuraCss,
  shimmerPearlCss,
} from '../../core/glass/maxFx';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/MaxFx.kt` (151 non-blank lines)
 *   line  47 `Modifier.glassSheen()`   → GlassSheen
 *   line 135 `Modifier.maxCardAura(primary, secondary, cornerRadiusDp)` → MaxCardAura
 * - `ui/components/MaxCardEffects.kt` (130 non-blank lines)
 *   line  40 `Modifier.chromaFlowEdge(primary, secondary, cornerRadiusDp, durationMillis)`
 *        → ChromaFlowEdge
 *   line 104 `Modifier.shimmerPearl(baseColor, durationMillis)` → ShimmerPearl
 *
 * ADAPTATION — Compose `drawBehind` → CSS overlay layers
 * ───────────────────────────────────────────────────
 * All four are `drawBehind` overlays gated on `LocalRenderQuality.current != MAX`
 * (early `return this` on the Kotlin side). Here each becomes an absolutely
 * positioned overlay element mounted only when `useRenderQuality() === 'MAX'` —
 * the identical gate.
 *
 * The infinite transitions (`rememberInfiniteTransition().animateFloat(...)`) are
 * evaluated from one **shared** `requestAnimationFrame` clock and written straight
 * onto the layer nodes, i.e. no React state and no per-card rAF. This mirrors
 * Compose's deferred `drawBehind` read and keeps a screen full of MAX cards at a
 * single frame callback. The stylesheet keyframes that previously drove these
 * layers (`glass-sheen-sweep`, `shimmer-pearl-drift`, `card-aura-breathe`,
 * `card-aura-hue`) carried geometry that does not match the Kotlin numbers — see
 * the review report; the phases now come from `core/glass/maxFx.ts#maxFxPhases`.
 */

/* ── shared frame clock ──────────────────────────────────────────────────── */

/** MaxFx.kt line 48 — `if (LocalRenderQuality.current != RenderQuality.MAX) return this`. */
function useMaxGate(): boolean {
  return useRenderQuality() === 'MAX';
}

export interface MaxFxLayerProps {
  width: number;
  height: number;
  primary: string;
  secondary: string;
  cornerRadiusDp?: number;
  className?: string;
  style?: CSSProperties;
}

function cssProps(css: string, extra?: CSSProperties): CSSProperties {
  return { ...(css as unknown as CSSProperties), ...extra };
}

/**
 * MAX 档专属：每 ~6s 一道柔和光带斜向掠过卡面。
 * 必须挂在卡片 `.clip(shape)` 之后（自动被圆角裁剪）→ the overlay sits inside the
 * card's own `overflow: hidden` box, so it is clipped by the same radius.
 */
export function GlassSheen(props: MaxFxLayerProps) {
  const max = useMaxGate();
  const ref = useRef<HTMLSpanElement | null>(null);
  const { width, height } = props;

  useMaxFxFrame(ref, (el, p) => {
    el.style.cssText = glassSheenCss(width, height, p.sheen);
  });

  if (!max) return null;
  return <span ref={ref} className={props.className ?? 'glass-sheen'} aria-hidden="true" style={props.style} />;
}

/**
 * MAX 档专属：卡片**内缘**的虹彩呼吸细边。
 * 呼吸 alpha 在 AURA_ALPHA_MIN…AURA_ALPHA_MAX 之间往复（周期 ~3s）；
 * 色相沿 primary↔secondary 插值（周期 ~8s）。
 * 原实现从「外圈 3 层辉光」改成「内缘 1 圈细边」——这一圈是**故意画在卡内**的。
 */
export function MaxCardAura(props: MaxFxLayerProps) {
  const max = useMaxGate();
  const ref = useRef<HTMLSpanElement | null>(null);
  const { width, height, primary, secondary } = props;
  const cornerRadiusDp = props.cornerRadiusDp ?? 24;

  useMaxFxFrame(ref, (el, p) => {
    el.style.cssText = maxCardAuraCss({
      width,
      height,
      primary,
      secondary,
      cornerRadiusDp,
      breathe: p.auraBreathe,
      hueShift: p.auraHue,
    });
  });

  if (!max) return null;
  // 极小卡片不画（MaxFx.kt line 166 的 guard）：先算一次静态版判定，避免挂空节点。
  const initial = maxCardAuraCss({ width, height, primary, secondary, cornerRadiusDp });
  if (initial === '') return null;
  return (
    <span
      ref={ref}
      className={props.className ?? 'max-card-aura'}
      aria-hidden="true"
      style={cssProps(initial, props.style)}
    />
  );
}

/**
 * 边缘彩色光带巡游：沿卡片轮廓画一圈渐变描边，亮段沿周长匀速移动。
 * 灵感来自 ChromaFlow 的 sweep glow，适配为 border 巡游。
 */
export function ChromaFlowEdge(props: MaxFxLayerProps) {
  const max = useMaxGate();
  if (!max) return null;
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
      style={cssProps(css, props.style)}
    />
  );
}

/** 珠光微光层：卡面上一块柔和的椭圆渐变光斑缓慢漂移（ShimmerFy 思路）。 */
export function ShimmerPearl(props: MaxFxLayerProps) {
  const max = useMaxGate();
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
      style={cssProps(initial, props.style)}
    />
  );
}

/**
 * Mount every MAX-tier `GlassCard.kt` overlay in Kotlin's modifier order:
 * `maxCardAura` → `glassSheen` → `shimmerPearl`.
 * The layer order matches the Kotlin draw order so the same layer ends up on top.
 */
export function MaxCardLayers(props: {
  width: number;
  height: number;
  primary: string;
  secondary: string;
  cornerRadiusDp?: number;
  /** `auroraSecondary` (GlassCard.kt lines 547-553) = secondary lerped 45% to tertiary. */
  auroraSecondary: string;
  children?: ReactNode;
}): ReactNode {
  const layer = {
    width: props.width,
    height: props.height,
    primary: props.primary,
    cornerRadiusDp: props.cornerRadiusDp ?? 24,
  };
  return (
    <>
      <MaxCardAura {...layer} secondary={props.auroraSecondary} />
      <GlassSheen {...layer} secondary={props.secondary} />
      <ShimmerPearl {...layer} secondary={props.secondary} />
      {props.children}
    </>
  );
}

/** Re-exported so callers can read the breathing alpha window without importing core. */
export const AURA_ALPHA_RANGE = { min: AURA_ALPHA_MIN, max: AURA_ALPHA_MAX } as const;
export { CHROMA_FLOW_DURATION_MS };

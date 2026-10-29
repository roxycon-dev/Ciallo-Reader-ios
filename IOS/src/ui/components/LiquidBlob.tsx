import { type CSSProperties } from 'react';
import { liquidBlobSvg } from '../../core/glass/liquidBlob';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/LiquidBlob.kt` (53 non-blank lines) — FULL PORT
 *   lines 21-68 `DrawScope.drawLiquidBlob(from, to, radius, intensity, color)`
 *              → `liquidBlobSvg` (core/glass/liquidBlob.ts) + `LiquidBlob` below
 *
 * Header comment verbatim:
 *   液桥（Metaball Bridge）：两个圆之间的"液滴拉丝"连接体。
 *   开关切换时，滑块与目标端之间会拉出一根先变粗后收细的液桥，
 *   到位瞬间液桥缩回滑块——替代此前缺乏美感的单色粒子。
 *   纯 Canvas 路径实现，无着色器依赖。
 *
 * (The "no shader dependency" note is accurate for the Kotlin original and is why
 * this file ports 1:1 with no GPU approximation.)
 */

export interface LiquidBlobProps {
  /** 液桥起点（固定端圆心） */
  from: { x: number; y: number };
  /** 液桥终点（运动端圆心） */
  to: { x: number; y: number };
  /** 两端圆半径（当前按同半径处理） */
  radius: number;
  /** 液桥强度 0..1：0=完全缩入滑块不可见，1=最饱满 */
  intensity: number;
  color: string;
  /** SVG viewBox side in px; defaults to 100. */
  viewBox?: number;
  className?: string;
  style?: CSSProperties;
}

export function LiquidBlob(props: LiquidBlobProps) {
  const viewBox = props.viewBox ?? 100;
  const d = liquidBlobSvg(props.from, props.to, props.radius, props.intensity);
  // `if (intensity <= 0.02f) return` — the bridge is fully collapsed, draw nothing.
  if (d === '') return null;
  return (
    <svg
      className={['liquid-blob', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      aria-hidden="true"
      role="presentation"
      fill={props.color}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
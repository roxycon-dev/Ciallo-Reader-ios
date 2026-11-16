import { hsvToHex, withAlpha } from '../../core/glass/color';
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

/** 液桥强度 0..1：0=完全缩入滑块不可见，1=最饱满 */
export interface LiquidBlobProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  radius: number;
  intensity: number;
  color: string;
  /** SVG viewBox side in px; defaults to 100. */
  viewBox?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function LiquidBlob(props: LiquidBlobProps) {
  const viewBox = props.viewBox ?? 100;
  const d = liquidBlobSvg(props.from, props.to, props.radius, props.intensity);
  if (d === '') return null;
  return (
    <svg
      className={props.className}
      style={props.style}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      aria-hidden="true"
      role="presentation"
      fill={props.color}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/**
 * 按源 ID 哈希取色 + 首字母生成的源站头像，纯 Compose 绘制。
 *
 * Port of `ui/components/SourceAvatar.kt` (56 non-blank lines):
 *   lines 29-58 `SourceAvatar(sourceId, sourceName, size = 32.dp, shape = CircleShape, modifier)`
 *   line 37-39  `Color.hsv(sourceId.hashCode().toUInt() % 360u, 0.52f, 0.86f)`
 *   line 42     `sourceName.trim().firstOrNull()?.uppercase() ?: "?"`
 *   line 49     `.border(1.dp, Color.White.copy(alpha = 0.85f), shape)`
 *   line 56     `fontSize = (size.value / 2.2f).sp`
 *
 * `String.hashCode()` is the JVM's 31-multiplier string hash; `hashColor()` below
 * reproduces it so the avatar colours are identical to Android's.
 */
export interface SourceAvatarProps {
  sourceId: string;
  sourceName: string;
  size?: number;
  /** Kotlin default `CircleShape` → `border-radius: 50%`. Pass a px value for rounded square. */
  shapeRadius?: number | 'circle';
  className?: string;
  style?: React.CSSProperties;
}

/** JVM `String.hashCode()` (s[0]*31^(n-1) + …), kept in 32-bit signed range. */
export function hashColor(sourceId: string): string {
  let h = 0;
  for (let i = 0; i < sourceId.length; i++) {
    h = (Math.imul(31, h) + sourceId.charCodeAt(i)) | 0;
  }
  // Kotlin `.toUInt()` reinterprets the signed int as unsigned → % 360u.
  const unsigned = h >>> 0;
  const hue = unsigned % 360;
  return hsvToHex(hue, 0.52, 0.86);
}

export function SourceAvatar(props: SourceAvatarProps) {
  const size = props.size ?? 32;
  const bg = hashColor(props.sourceId);
  const letter = (props.sourceName.trim().charAt(0) || '?').toUpperCase();
  const radius =
    props.shapeRadius === undefined || props.shapeRadius === 'circle'
      ? '50%'
      : `${props.shapeRadius}px`;

  return (
    <div
      className={['source-avatar', props.className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
      role="presentation"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        border: `1px solid ${withAlpha('#FFFFFF', 0.85)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...props.style,
      }}
    >
      <span
        style={{
          color: '#FFFFFF',
          fontWeight: 700,
          fontSize: size / 2.2,
          lineHeight: 1,
        }}
      >
        {letter}
      </span>
    </div>
  );
}
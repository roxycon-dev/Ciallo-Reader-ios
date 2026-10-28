import { type CSSProperties, type ReactNode } from 'react';

/**
 * Light-theme port of Android GlassCard.kt.
 *
 * Android (GlassCard.kt):
 * - tint default: surface.copy(alpha = 0.82f) → rgba(255,255,255,0.82)
 * - themedTint = lerp(tint, primary, tintMix≈0.08) — faint primary wash on white glass
 * - strokeTint = lerp(White, primary, 0.38)
 * - Layer 7A ambient shadow: primary @ 0.10 alpha, elevation ~12dp
 * - Layer 7B contact shadow: black @ 0.08 / 0.15, elevation 4dp
 * - DesignTokens glass card: blur 24px (Android comment) / 22px (tokens file), surface alpha 0.78
 * - LOW quality fallback in React = translucent base (no realtime backdrop blur sampling)
 */
export function GlassCard(props: {
  children: ReactNode;
  className?: string;
  radius?: number;
  padding?: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  // Android default card radius from LocalCardTweaks = 16dp (DesignTokens.RadiusMd)
  const radius = props.radius ?? 16;
  // Compose GlassCard default contentPadding = 0.dp; existing React pages relied on 16.
  // Call sites that mirror Android pass explicit padding (hero/stats/header).
  const padding = props.padding ?? 16;
  const interactive = props.onClick !== undefined;
  const className = [
    'glass-card',
    interactive ? 'glass-card--interactive' : '',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      onClick={props.onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.onClick?.();
              }
            }
          : undefined
      }
      style={{
        borderRadius: radius,
        padding: padding > 0 ? padding : undefined,
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

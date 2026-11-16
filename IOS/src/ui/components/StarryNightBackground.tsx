import { type ReactNode } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/StarryNightBackground.kt` (70 non-blank lines) — FULL PORT
 *   lines 22-26 the five celestial colour constants → `STARRY_COLORS`
 *   lines 34-36 `bgColor` / `isDark` / `currentPrimary` → theme props
 *   lines 38-44 the Box + `LocalAppBackgroundActive` transparent branch
 *   lines 45-68 the Canvas radial "weak radial gradient" (showLamp)
 *   lines 70-73 the content Box
 *
 * Colours verbatim:
 *   GlassBorderWhite  = 0xFFE3E5E7
 *   GlassBorderDark   = 0xFF2D2E32
 *   GlassWhite        = 0xFFF4F4F4
 *   GlassDark         = 0xFF222428
 *   WarmLampYellow    = 0xFFFFD166
 *
 * `showLamp` values verbatim:
 *   isDark  → listOf(primary@0.12f, Transparent),  center (0.5w, 0.3h), radius = w
 *   !isDark → listOf(primary@0.05f, White@0.0f),   center (0.5w, 0.3h), radius = w
 *   "Draw a subtle radial gradient (max 8% opacity)"
 *
 * ADAPTATION — Compose Canvas → CSS radial-gradient on a pseudo-layer.
 * `LocalAppBackgroundActive` (a CompositionLocal telling the page whether a
 * wallpaper is already painted behind it) becomes the `backgroundActive` prop:
 * when true the base layer is transparent exactly as on Android.
 */
export const STARRY_COLORS = {
  GlassBorderWhite: '#E3E5E7',
  GlassBorderDark: '#2D2E32',
  GlassWhite: '#F4F4F4',
  GlassDark: '#222428',
  WarmLampYellow: '#FFD166',
} as const;

export interface StarryNightBackgroundProps {
  className?: string;
  style?: React.CSSProperties;
  /** We will use this to determine if we show the weak radial gradient */
  showLamp?: boolean;
  /** Kotlin `LocalAppBackgroundActive.current` — when true the base is transparent. */
  backgroundActive?: boolean;
  /** Kotlin `MaterialTheme.colorScheme.background`. */
  background?: string;
  /** Kotlin `bgColor == DarkCharcoal` (0xFF18191C) drives the light/dark gradient. */
  isDark?: boolean;
  /** Kotlin `currentPrimary = MintPrimary`. */
  primary?: string;
  children?: ReactNode;
}

export function StarryNightBackground(props: StarryNightBackgroundProps) {
  const showLamp = props.showLamp !== false;
  const background = props.background ?? '#FFFFFF';
  const isDark = props.isDark === true;
  const primary = props.primary ?? '#059669';
  const backgroundActive = props.backgroundActive === true;

  // center = Offset(size.width * 0.5f, size.height * 0.3f), radius = size.width
  const lamp = isDark
    ? `radial-gradient(circle at 50% 30%, ${rgba(primary, 0.12)} 0%, rgba(255,255,255,0) 100%)`
    : `radial-gradient(circle at 50% 30%, ${rgba(primary, 0.05)} 0%, ${rgba('#FFFFFF', 0)} 100%)`;

  return (
    <div
      className={['starry-night-background', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        background: backgroundActive ? 'transparent' : background,
        ...props.style,
      }}
    >
      {showLamp ? (
        <span className="starry-night-background__lamp" aria-hidden="true" style={{ backgroundImage: lamp }} />
      ) : null}
      {/* Main screen content */}
      <div className="starry-night-background__content">{props.children}</div>
    </div>
  );
}

function rgba(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
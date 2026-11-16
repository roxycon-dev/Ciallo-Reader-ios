import { type CSSProperties, type ReactNode } from 'react';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/CustomButtons.kt` (71 non-blank lines) — FULL PORT
 *   lines 21-39  `AppIconButton(onClick, modifier, enabled, content)`
 *                → AppIconButton
 *   lines 46-74  `AppButton(onClick, modifier, enabled, containerColor, contentColor,
 *                 shape, contentPadding, content)`
 *                → AppPillButton (named to avoid clashing with AppButton.tsx)
 *
 *   A highly polished icon button component with built-in spring-scale animation
 *   and unbounded/borderless Material Ripple.   (header comment, verbatim)
 *   A highly polished button component with built-in spring-scale animation
 *   and bounded Material Ripple.                (header comment, verbatim)
 *
 * ADAPTATION — `clickableWithFeedback(bounded = …)` → CSS
 * ─────────────────────────────────────────────────
 * - bounded ripple    → a radial-gradient `::after` that scales+fades on :active,
 *                       clipped by the element's own border-radius (bounded).
 * - unbounded ripple  → the same gradient with `overflow: visible` on the host, so
 *                       the ring is not clipped by any ancestor (borderless).
 * - spring scale 0.88 ↔ 1.0 → `transform: scale()` on a 350ms
 *   `cubic-bezier(0.25, 1, 0.5, 1)` (AppMotion.springDefault).
 *
 * NOTE: the plain `<button>` element is used rather than the shared
 * `AppButton.tsx`, because the shared one has a *different* public API
 * (children-based, `variant`/`size` unions) that other agents' pages depend on.
 */

/**
 * A highly polished icon button component with built-in spring-scale animation
 * and unbounded/borderless Material Ripple.
 */
export function AppIconButton(props: {
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  enabled?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}) {
  const enabled = props.enabled !== false;
  return (
    <button
      type="button"
      className={['app-icon-button', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
      disabled={!enabled}
      data-testid={props['data-testid']}
      onClick={props.onClick}
    >
      {/* Unbounded borderless ripple */}
      <span className="app-icon-button__ripple" aria-hidden="true" />
      {props.children}
    </button>
  );
}

/**
 * A highly polished button component with built-in spring-scale animation
 * and bounded Material Ripple.
 *
 * Named `AppPillButton` in TS: `AppButton` is already taken by the shared
 * `src/ui/components/AppButton.tsx` (other agents' pages import it with a
 * children-based API). The Kotlin overload set is preserved via props.
 */
export function AppPillButton(props: {
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
  enabled?: boolean;
  /** Kotlin default `containerColor = MintPrimary`. */
  containerColor?: string;
  /** Kotlin default `contentColor = Color.White`. */
  contentColor?: string;
  /** Kotlin default `shape = CircleShape`; CSS border-radius in px. */
  shapeRadius?: number;
  /** Kotlin default `PaddingValues(horizontal = 16.dp, vertical = 10.dp)`. */
  contentPadding?: { horizontal: number; vertical: number };
  children: ReactNode;
  'data-testid'?: string;
}) {
  const enabled = props.enabled !== false;
  const containerColor = props.containerColor ?? '#059669';
  const contentColor = props.contentColor ?? '#FFFFFF';
  const pad = props.contentPadding ?? { horizontal: 16, vertical: 10 };

  return (
    <button
      type="button"
      className={['app-pill-button', props.className ?? ''].filter(Boolean).join(' ')}
      disabled={!enabled}
      data-testid={props['data-testid']}
      onClick={props.onClick}
      style={{
        background: enabled ? containerColor : withAlphaHex(containerColor, 0.5),
        color: enabled ? contentColor : withAlphaHex(contentColor, 0.5),
        borderRadius: props.shapeRadius ?? 999,
        padding: `${pad.vertical}px ${pad.horizontal}px`,
        ...props.style,
      }}
    >
      {/* Bounded Material Ripple */}
      <span className="app-pill-button__ripple" aria-hidden="true" />
      <span className="app-pill-button__content">{props.children}</span>
    </button>
  );
}

function withAlphaHex(hex: string, alpha: number): string {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
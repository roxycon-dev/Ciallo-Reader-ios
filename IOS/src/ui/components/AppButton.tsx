import { type CSSProperties, type ReactElement, type ReactNode } from 'react';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'outline';
export type AppButtonSize = 'sm' | 'md' | 'lg';

const HEIGHTS: Record<AppButtonSize, number> = {
  sm: 36,
  md: 44,
  lg: 52,
};

const secondaryStyles: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.78)',
  color: '#18191C',
  border: '1px solid #E3E5E7',
  boxShadow: '0 2px 8px rgba(24, 25, 28, 0.06)',
};

const VARIANTS: Record<AppButtonVariant, CSSProperties> = {
  primary: {
    background: 'linear-gradient(135deg, #2563EB 0%, #059669 100%)',
    color: '#FFFFFF',
    boxShadow: '0 8px 20px rgba(5, 150, 105, 0.28)',
  },
  secondary: secondaryStyles,
  outline: secondaryStyles,
  tertiary: {
    background: 'transparent',
    color: '#61666D',
  },
  destructive: {
    background: 'linear-gradient(135deg, #F87171 0%, #DC2626 100%)',
    color: '#FFFFFF',
    boxShadow: '0 8px 20px rgba(220, 38, 38, 0.28)',
  },
};

export function AppButton(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: CSSProperties;
  /** Leading icon (Android AppActionButton.icon) */
  icon?: ReactNode;
  /** Test id passthrough (Android testTag) */
  'data-testid'?: string;
  /**
   * ADDITIVE (module-A port of Android `AppButton.kt` → `GradientActionButton.kt`):
   * the Kotlin `AppActionButton` forwards `modifier`, so the ported
   * `GradientActionButton` needs to pass a class through. Optional, appended after
   * the built-in variant/size classes, so existing call sites are unaffected.
   */
  className?: string;
}): ReactElement {
  const variant = props.variant ?? 'primary';
  const size = props.size ?? 'md';
  const disabled = props.disabled === true;
  const loading = props.loading === true;
  const interactive = !disabled && !loading;

  return (
    <button
      type="button"
      className={[
        'app-button',
        `app-button--${variant}`,
        `app-button--${size}`,
        props.fullWidth === true ? 'app-button--full' : '',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={props['data-testid']}
      style={{
        height: HEIGHTS[size],
        borderRadius: HEIGHTS[size] / 2,
        ...VARIANTS[variant],
        ...props.style,
      }}
      disabled={!interactive}
      onClick={interactive ? props.onClick : undefined}
    >
      {loading ? (
        <span className="app-button__spinner" aria-hidden="true" />
      ) : null}
      {props.icon !== undefined ? <span className="app-button__icon">{props.icon}</span> : null}
      {props.children}
    </button>
  );
}

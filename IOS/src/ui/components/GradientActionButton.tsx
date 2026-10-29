import type { ReactNode } from 'react';
import { AppButton, type AppButtonSize, type AppButtonVariant } from './AppButton';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/GradientActionButton.kt` (30 non-blank lines) — FULL PORT
 *   lines 12-33 `GradientActionButton(text, onClick, modifier, icon, enabled,
 *             variant, size, loading, fullWidth)`
 *             → GradientActionButton
 *
 * Header comment verbatim:
 *   兼容旧调用的按钮入口：默认 Primary（原渐变胶囊），可按需指定变体。
 *   实现已统一迁移到 [AppActionButton]（四变体 + 液态玻璃 + gel-press + loading）。
 *
 * The Kotlin function is a thin forwarder; so is this one.  It delegates to the
 * shared `AppButton` (which is this project's port of `AppActionButton` — same
 * four variants, same gel-press scale, same loading state).
 *
 * `icon: ImageVector?` → `icon?: ReactNode` (Compose ImageVector → SVG node).
 */
export function GradientActionButton(props: {
  text: string;
  onClick: () => void;
  className?: string;
  icon?: ReactNode;
  enabled?: boolean;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  'data-testid'?: string;
}) {
  return (
    <AppButton
      onClick={props.onClick}
      variant={props.variant ?? 'primary'}
      size={props.size ?? 'md'}
      fullWidth={props.fullWidth === true}
      disabled={props.enabled === false}
      loading={props.loading === true}
      {...(props.icon !== undefined ? { icon: props.icon } : {})}
      {...(props['data-testid'] !== undefined ? { 'data-testid': props['data-testid'] } : {})}
      {...(props.className !== undefined ? { className: props.className } : {})}
    >
      {props.text}
    </AppButton>
  );
}
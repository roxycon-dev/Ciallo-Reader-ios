import { type ReactNode } from 'react';
import { withAlpha } from '../../core/glass/color';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/AppSnackbar.kt` (153 non-blank lines) — FULL PORT
 *   line 50   `enum class AppSnackKind { ERROR, TOAST }` → AppSnackKind
 *   lines 56-62 `class AppSnackbarVisuals`            → AppSnackbarVisuals
 *   lines 65-78 `suspend fun SnackbarHostState.showAppSnackbar(...)`
 *              → AppSnackbarQueue (module-level, see below)
 *   lines 87-170 `@Composable AppToastSnackbar(...)`  → AppToastSnackbar
 *
 * ADAPTATION — `SnackbarHostState` → a module-level queue
 * ───────────────────────────────────────────────────────
 * Compose's `SnackbarHostState.showSnackbar` is a suspending call that queues one
 * message at a time and resolves when dismissed. The web equivalent is a small
 * observable store; `AppSnackbarHost` subscribes and renders the current entry.
 * The semantic split (`ERROR` vs `TOAST`) that the Kotlin file insists on —
 * "每条 snackbar 必须自带语义，宿主再按语义挑皮肤" — is preserved verbatim.
 */

export type AppSnackKind = 'ERROR' | 'TOAST';

/**
 * 带语义的 SnackbarVisuals：message 保持**纯净**（「复制日志」复制到的就是它，
 * 不能为了分流往文本里塞前缀），语义走独立的 kind 字段。
 */
export interface AppSnackbarVisuals {
  message: string;
  actionLabel: string | null;
  withDismissAction: boolean;
  /** Short / Long — maps onto the DOM auto-dismiss timeout. */
  duration: 'Short' | 'Long';
  kind: AppSnackKind;
}

export interface AppSnackEntry extends AppSnackbarVisuals {
  id: number;
  onAction?: (() => void) | null;
  onDismiss?: (() => void) | null;
}

const DURATION_MS: Record<'Short' | 'Long', number> = { Short: 4000, Long: 10000 };

let seq = 0;
let current: AppSnackEntry | null = null;
const listeners = new Set<(e: AppSnackEntry | null) => void>();
let timer: number | null = null;

/**
 * 统一的 snackbar 入口：默认按「普通提示」走，错误才显式声明。
 * `showAppSnackbar(message, kind = TOAST, actionLabel = null, duration = Short)`.
 */
export function showAppSnackbar(options: {
  message: string;
  kind?: AppSnackKind;
  actionLabel?: string | null;
  duration?: 'Short' | 'Long';
  onAction?: (() => void) | null;
  onDismiss?: (() => void) | null;
}): number {
  seq += 1;
  const entry: AppSnackEntry = {
    id: seq,
    message: options.message,
    actionLabel: options.actionLabel ?? null,
    withDismissAction: false,
    duration: options.duration ?? 'Short',
    kind: options.kind ?? 'TOAST',
    onAction: options.onAction ?? null,
    onDismiss: options.onDismiss ?? null,
  };
  current = entry;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => dismissAppSnackbar(entry.id), DURATION_MS[entry.duration]);
  for (const cb of [...listeners]) cb(entry);
  return entry.id;
}

export function dismissAppSnackbar(id?: number): void {
  if (current === null) return;
  if (id !== undefined && current.id !== id) return;
  const done = current;
  current = null;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  done.onDismiss?.();
  for (const cb of [...listeners]) cb(null);
}

export function currentAppSnackbar(): AppSnackEntry | null {
  return current;
}

export function subscribeAppSnackbar(cb: (e: AppSnackEntry | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export interface AppToastSnackbarProps {
  message: string;
  actionLabel?: string | null;
  onActionClick?: (() => void) | null;
  onDismissClick?: (() => void) | null;
  /** Theme tokens (Compose read MaterialTheme.colorScheme.*). */
  primary?: string;
  onSurface?: string;
  onSurfaceVariant?: string;
  outline?: string;
  children?: ReactNode;
}

/**
 * 普通 / 成功的提示卡（取代原来"所有提示都套红色错误框"的做法）。
 *
 * 与 AppErrorSnackbar 刻意拉开差距：主色是薄荷而不是 error 红，左侧是勾选而不是
 * 感叹号，**没有「操作出错」这个标题**——成功提示不该有任何"出事了"的暗示。
 */
export function AppToastSnackbar(props: AppToastSnackbarProps) {
  const primary = props.primary ?? '#059669';
  const onSurface = props.onSurface ?? '#18191C';
  const onSurfaceVariant = props.onSurfaceVariant ?? '#61666D';
  const outline = props.outline ?? '#E3E5E7';

  return (
    <div
      className="app-toast-snackbar"
      role="status"
      aria-live="polite"
      data-testid="app_toast_snackbar"
    >
      <div className="app-snackbar__row">
        <span
          className="app-snackbar__icon"
          style={{ background: withAlpha(primary, 0.14) }}
        >
          <CheckCircleIcon />
        </span>
        <span className="app-snackbar__spacer" style={{ width: 12 }} />
        <p
          className="app-snackbar__message"
          style={{ color: onSurface }}
        >
          {props.message}
        </p>
        {props.actionLabel !== null && props.actionLabel !== undefined && props.onActionClick != null ? (
          <>
            <span style={{ width: 8 }} />
            <button
              type="button"
              className="app-snackbar__action"
              style={{ color: primary }}
              onClick={props.onActionClick}
            >
              {props.actionLabel}
            </button>
          </>
        ) : null}
        {props.onDismissClick != null ? (
          <button
            type="button"
            className="app-snackbar__close"
            style={{ color: onSurfaceVariant }}
            aria-label="关闭"
            onClick={props.onDismissClick}
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>
      <span className="app-snackbar__border" style={{ borderColor: withAlpha(outline, 0.14) }} />
    </div>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      style={{ color: 'currentColor' }}
      aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

export type { AppToastSnackbarProps as AppToastSnackbarOptions };
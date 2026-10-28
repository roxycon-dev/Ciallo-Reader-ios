import { useState } from 'react';
import { withAlpha } from '../../core/glass/color';
import { showToast } from './Toast';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/AppErrorSnackbar.kt` (156 non-blank lines) — FULL PORT
 *   lines 43-53  `remember(message) { … friendlyMessage … }` → `friendlyMessage()`
 *   lines 55-70  Card (consistentShadow 8.dp / border 1.5.dp error@0.9 / surface 0.92)
 *   lines 71-115 Row → icon + 「操作出错」 + friendlyMessage
 *   lines 119-147 TextButton 「复制日志」 → clipboard write + `AppToast.makeText(...)`
 *   lines 149-161 AppIconButton 「关闭」
 *
 * ADAPTATION — `LocalClipboardManager.setText` → `navigator.clipboard.writeText`
 * `AppToast.makeText(context, …, Toast.LENGTH_SHORT).show()` → `showToast()`
 * (both are the app's existing toast channel; see Toast.tsx / AppToast.tsx).
 */

export const ERROR_COPIED_MESSAGE = '错误日志已剪贴板';

/**
 * AppErrorSnackbar.kt lines 43-53 — the friendly-message mapping.
 * All five branches and their Chinese strings are preserved verbatim.
 */
export function friendlyMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('connect')) {
    return '网络连接超时，请检查网络设置';
  }
  if (lower.includes('json') || lower.includes('format')) {
    return '书源文件解析失败：JSON 格式非法';
  }
  if (lower.includes('backup') || lower.includes('restore')) {
    return '备份恢复失败，请选择正确的备份包';
  }
  if (lower.includes('404')) {
    return '书源接口未找到 (404)，该书源可能已失效';
  }
  if (lower.includes('500') || lower.includes('502')) {
    return '远程服务器内部错误 (500/502)，请稍后再试';
  }
  return message;
}

/** AppErrorSnackbar.kt line 127 — the exact toast text after copying the log. */
export const COPY_LOG_MESSAGE = '错误日志已复制到剪贴板';

export interface AppErrorSnackbarProps {
  message: string;
  actionLabel?: string | null;
  onActionClick?: (() => void) | null;
  onDismissClick?: (() => void) | null;
  /** Theme tokens (Compose read MaterialTheme.colorScheme.*). */
  error?: string;
  errorContainer?: string;
  onSurface?: string;
  onSurfaceVariant?: string;
  outline?: string;
  /** Injected clipboard — defaults to `navigator.clipboard`. */
  copyToClipboard?: (text: string) => Promise<void> | void;
}

export function AppErrorSnackbar(props: AppErrorSnackbarProps) {
  const error = props.error ?? '#DC2626';
  const onSurface = props.onSurface ?? '#18191C';
  const onSurfaceVariant = props.onSurfaceVariant ?? '#61666D';
  const outline = props.outline ?? '#E3E5E7';
  const [copied, setCopied] = useState(false);
  const friendly = friendlyMessage(props.message);

  const copy = props.copyToClipboard ?? defaultCopy;

  return (
    <div
      className="app-error-snackbar"
      role="alert"
      data-testid="app_error_snackbar"
    >
      <div className="app-snackbar__row app-error-snackbar__row">
        <div className="app-error-snackbar__left">
          <span className="app-snackbar__icon" style={{ background: props.errorContainer ?? '#FEE2E2' }}>
            <ErrorOutlineIcon color={error} />
          </span>
          <span className="app-snackbar__spacer" style={{ width: 12 }} />
          <div className="app-error-snackbar__texts">
            <p className="app-error-snackbar__title" style={{ color: error }}>
              操作出错
            </p>
            <div style={{ height: 2 }} />
            <p className="app-error-snackbar__body" style={{ color: onSurface }}>
              {friendly}
            </p>
          </div>
        </div>
        <span style={{ width: 8 }} />
        <div className="app-error-snackbar__actions">
          <button
            type="button"
            className="app-error-snackbar__copy"
            style={{ color: outline }}
            onClick={() => {
              void Promise.resolve(copy(props.message)).then(() => {
                setCopied(true);
                showToast(COPY_LOG_MESSAGE);
                props.onActionClick?.();
              });
            }}
          >
            <ContentCopyIcon color={outline} />
            <span style={{ width: 4 }} />
            <span>复制日志</span>
          </button>
          {props.onDismissClick != null ? (
            <button
              type="button"
              className="app-error-snackbar__close"
              style={{ color: onSurfaceVariant }}
              aria-label="关闭"
              onClick={props.onDismissClick}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>
      <span
        className="app-snackbar__border app-snackbar__border--error"
        style={{ borderColor: withAlpha(error, 0.9) }}
      />
      {copied ? <span className="sr-only" role="status">{COPY_LOG_MESSAGE}</span> : null}
    </div>
  );
}

async function defaultCopy(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text);
  }
}

function ErrorOutlineIcon(props: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path
        d="M11 15h2v2h-2zm0-8h2v6h-2zm0.5-5C6.47 2 2 6.48 2 12s4.47 10 9.5 10S21 17.52 21 12 17.53 2 11.5 2zM12 20c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
        fill={props.color}
      />
    </svg>
  );
}

function ContentCopyIcon(props: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path
        d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
        fill={props.color}
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}
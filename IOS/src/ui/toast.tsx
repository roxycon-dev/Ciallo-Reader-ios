/**
 * 全局提示条 — 语义对齐 Android `ui/components/AppToast.kt` + `AppSnackbar.kt`。
 *
 * Android 的关键规则（MainActivity L610-627 的注释原文）：
 *  - **按语义挑皮肤**：成功提示走 TOAST 皮肤，错误走 ERROR 皮肤。
 *    一律渲染成红色错误卡是错的 ——
 *    用户原话：「操作总是出错，问题是操作根本没有出错」。
 *  - 支持 actionLabel（「撤销」）+ onAction。
 *  - short / long 两种时长。
 *  - `role=status / aria-live=polite` 对应 Compose 的 semantics。
 */
import { useEffect } from 'react';
import { create } from 'zustand';

/** 与 Android `AppSnackKind` 一致。 */
export type ToastKind = 'error' | 'toast';

export interface ToastOptions {
  kind?: ToastKind;
  /** `undefined` = 无动作按钮（不是空串） */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  durationMs?: number | undefined;
}

/** Android `SnackbarDuration.Short` ≈ 4s。 */
export const TOAST_DURATION_SHORT = 4000;
/** Android `SnackbarDuration.Long` ≈ 10s。 */
export const TOAST_DURATION_LONG = 10000;

interface ToastState {
  message: string | null;
  kind: ToastKind;
  actionLabel: string | null;
  onAction: (() => void) | null;
  durationMs: number;
  show: (message: string, options?: ToastOptions) => void;
  hide: () => void;
}

const useToastStore = create<ToastState>((set) => ({
  message: null,
  kind: 'toast',
  actionLabel: null,
  onAction: null,
  durationMs: TOAST_DURATION_SHORT,
  show: (message, options) =>
    set({
      message,
      kind: options?.kind ?? 'toast',
      actionLabel: options?.actionLabel ?? null,
      onAction: options?.onAction ?? null,
      durationMs: options?.durationMs ?? TOAST_DURATION_SHORT,
    }),
  hide: () => set({ message: null, actionLabel: null, onAction: null }),
}));

export function showToast(message: string, options?: ToastOptions): void {
  useToastStore.getState().show(message, options);
}

export function hideToast(): void {
  useToastStore.getState().hide();
}

export function Toast() {
  const message = useToastStore((s) => s.message);
  const kind = useToastStore((s) => s.kind);
  const actionLabel = useToastStore((s) => s.actionLabel);
  const onAction = useToastStore((s) => s.onAction);
  const durationMs = useToastStore((s) => s.durationMs);
  const hide = useToastStore((s) => s.hide);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(hide, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, hide]);

  if (!message) return null;

  return (
    <div
      className={kind === 'error' ? 'toast toast--error' : 'toast toast--ok'}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="toast__text">{message}</span>
      {actionLabel !== null ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            hide();
            onAction?.();
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
/**
 * 主壳提示条（Snackbar host）— 逐行移植 Android `MainActivity.kt` L541-584、
 * L603-629 的语义分流。
 *
 * Android 的关键规则（原文注释）：
 *  - `showUndo` 是「**成功 + 撤销**」提示，**不是错误**；走 TOAST 语义，
 *    否则会被渲染成红色「操作出错」卡 ——
 *    用户原话：「操作总是出错，问题是操作根本没有出错」。
 *  - 书源错误消息走 ERROR 语义、Short 时长。
 *  - 导入消息只有含「失败」/「出错」时才走 ERROR（成功是安静提示）。
 *  - SnackbarHost 底部要避开 Tab 栏 + 导航栏内缩。
 */
import { useEffect, useRef } from 'react';
import { showToast } from '@ui/toast';
import '../../styles/shell.css';

/** 与 Android `AppSnackKind` 一致。 */
export type AppSnackKind = 'error' | 'toast';

export interface AppSnackbarVisuals {
  kind: AppSnackKind;
  message: string;
  actionLabel?: string | undefined;
}

/** 与 Android `SnackbarDuration` 对齐（毫秒）。 */
export const SNACKBAR_DURATION: Record<'short' | 'long', number> = {
  short: 4000,
  long: 10000,
};

/** 语义判定（L541-584）。 */
export function classifyShelfMessage(message: string): AppSnackKind {
  // L576：只有含「失败」/「出错」的导入消息才是错误
  return message.includes('失败') || message.includes('出错') ? 'error' : 'toast';
}

export interface UndoHandle {
  /** 显示「成功 + 撤销」提示；点撤销回调，返回 dismiss 函数。 */
  show(message: string, undo: () => void): () => void;
}

/**
 * 全局提示宿主（对应 `BindAppToastHost(snackbarHostState)` + `showAppSnackbar`）。
 * 主页在场时，全站 Toast 统一走这一套皮肤（L512-513）。
 */
export class SnackbarHost {
  private current: (() => void) | null = null;

  /** 核心渲染入口（L546-552 / L566-571 / L577-582）。 */
  showAppSnackbar(
    visuals: AppSnackbarVisuals,
    action?: () => void,
    duration: 'short' | 'long' = 'short',
  ): void {
    this.dismissCurrent();
    showToast(visuals.message, {
      kind: visuals.kind,
      actionLabel: visuals.actionLabel ?? (action === undefined ? undefined : '撤销'),
      onAction: action,
      durationMs: SNACKBAR_DURATION[duration],
    });
    const timer = window.setTimeout(() => {
      this.current = null;
    }, SNACKBAR_DURATION[duration]);
    this.current = () => {
      clearTimeout(timer);
    };
  }

  /**
   * 书架删除撤销（L541-554）：Long 时长 + 「撤销」动作。
   * 绝不能降级成 ERROR 皮肤。
   */
  showUndo(message: string, undo: () => void): () => void {
    this.showAppSnackbar({ kind: 'toast', message, actionLabel: '撤销' }, undo, 'long');
    return () => this.dismissCurrent();
  }

  /** 书源错误（L564-572）：ERROR + Short。 */
  showError(message: string): void {
    this.showAppSnackbar({ kind: 'error', message }, undefined, 'short');
  }

  dismissCurrent(): void {
    if (this.current !== null) {
      this.current();
      this.current = null;
    }
  }
}

let host: SnackbarHost | null = null;

export function getSnackbarHost(): SnackbarHost {
  if (host === null) host = new SnackbarHost();
  return host;
}

/**
 * 订阅宿主消息并渲染提示条。
 * 挂载在主壳上，对应 Android 的 `SnackbarHost`。
 */
export function SnackbarHostView(props: { host?: SnackbarHost }) {
  void (props.host ?? getSnackbarHost());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 底部避让 Tab 栏 + 导航栏内缩（L606-607）
    ref.current?.style.setProperty('--shell-snackbar-bottom', 'calc(var(--tab-bar-height, 68px) + var(--safe-bottom, 0px))');
  }, []);

  return (
    <div className="shell-snackbar-host" ref={ref} role="status" aria-live="polite" />
  );
}
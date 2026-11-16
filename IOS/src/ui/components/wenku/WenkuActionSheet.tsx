/**
 * Wenku 玻璃面板 —— `ui/wenku/WenkuActionSheet.kt` + `WenkuMenuHost.kt` L379-1092 的 CSS 版。
 *
 * Kotlin → TS 映射
 * ─────────────────
 * `WenkuActionSheet.kt` L22-50
 *   L23-30  title / onDismiss / dismissEnabled / fitKeyboard / requestDismiss
 *   L31-33  WenkuSheetDialog(onDismissRequest, dismissGesturesEnabled, fitKeyboard, requestDismiss)
 *   L35-48  WenkuLoadedContentSequence + 22dp 横向 / 14dp 纵向内边距 + 10dp 间距
 *           + 首行标题 + 关闭按钮 + 内容列（8dp 间距）
 * `WenkuMenuHost.kt`
 *   L379-390  WenkuSheetHost 参数（grabber / viewportContent / wideMaxWidth = 560.dp）
 *   L901-973  拖拽关闭：累计 dy ≥ 预览高度 × .24 或 velocity.y > 550（WenkuTokens）
 *   L979-1025 WenkuSheetSurface：28dp 圆角 + 12dp 顶距 + 32×3 抓取条（ink .18）+ 底部 8dp
 *   L1034-1092 WenkuSheetDialog：全屏容器、遮罩由宿主负责（window.setDimAmount(0f)）
 *   L114-152  WenkuSheetBarrier = WenkuTokens.Scrim（black @ .16）
 *
 * 未移植：
 *   - L379-585 `WenkuSheetHost` 的「有锚点走 SizeTransition / 无锚点走斜切平面」二选一入场
 *     （`GlassOverlayTransition`，motion_ui.dart:1139-1188）。本组件只实现 **无锚点** 分支：
 *     底部上滑 + 淡入，时长取 `WenkuMotion.ENTER_MS` / `EXIT_MS`。
 *   - L1034-1092 的 Dialog 窗口句柄、IME insets 监听与 `fitInsetTypes` 改写（平台层）。
 *     这里 `fitKeyboard` 只加大底部内边距。
 *   - L1100-1120 `WenkuSheetRegistry.openCount`（Android 用来抬 Tab 栏 z 序）。Web 端
 *     面板层级由 z-index 直接决定（`--wenku-sheet` = 70）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';

import { useWenkuReducedMotion } from './WenkuGlass';
import { WenkuIcon } from './WenkuIcon';
import type { WenkuSymbol } from './WenkuIcon';
import { tr } from '@core/i18n';

/** `WenkuTokens.ENTER_MS` / `EXIT_MS`（WenkuTokens.kt L121-156）。 */
export const WENKU_SHEET_ENTER_MS = 420;
export const WENKU_SHEET_EXIT_MS = 320;
/** `WenkuTokens.SheetDismissVelocity` / `SheetDismissFraction`（L84-85）。 */
export const WENKU_SHEET_DISMISS_VELOCITY = 550;
export const WENKU_SHEET_DISMISS_FRACTION = 0.24;
/** `WenkuTokens.SheetHandleWidth` / `SheetHandleHeight`（L82-83）。 */
export const WENKU_SHEET_HANDLE_WIDTH = 32;
export const WENKU_SHEET_HANDLE_HEIGHT = 3;

export interface WenkuActionSheetProps {
  readonly title: string;
  readonly onDismiss: () => void;
  /** `dismissEnabled`：false 时遮罩点击 / 返回 / 拖拽都不关闭（L26）。 */
  readonly dismissEnabled?: boolean;
  /** `fitKeyboard`：留出 IME 高度（Web 端表现为额外底部内边距）。 */
  readonly fitKeyboard?: boolean;
  /** `requestDismiss`：调用方主动收面板（L28）。 */
  readonly requestDismiss?: boolean;
  /** `grabber`：顶部 32×3 抓取条（默认开）。 */
  readonly grabber?: boolean;
  /** 面板正文；每个直接子元素自动获得错峰浮现（`WenkuLoadedContentSequence`）。 */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

interface DragState {
  startY: number;
  startTime: number;
  lastY: number;
  lastTime: number;
  offset: number;
}

/**
 * 玻璃底部面板。可见性由「挂载」表达：父组件卸载即收起——但为了让 320ms 的退场能被看到，
 * 本组件在 `requestDismiss` / 拖拽关闭时会先播完退场再调 `onDismiss`。
 */
export function WenkuActionSheet(props: WenkuActionSheetProps) {
  const reduceMotion = useWenkuReducedMotion();
  const dismissEnabled = props.dismissEnabled !== false;
  const { onDismiss } = props;
  const [open, setOpen] = useState(false);
  const [dragPx, setDragPx] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = (): void => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // 入场：挂载后下一帧置 open，让 translateY(100%) → 0 的过渡真正发生。
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const requestClose = useCallback(() => {
    if (!dismissEnabled) return;
    clearCloseTimer();
    setOpen(false);
    if (reduceMotion) {
      onDismiss();
      return;
    }
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      onDismiss();
    }, WENKU_SHEET_EXIT_MS);
  }, [dismissEnabled, onDismiss, reduceMotion]);

  // `requestDismiss`（L28）：调用方要求收起。走 rAF 起播退场，避免在 effect 里同步 setState。
  const requestDismiss = props.requestDismiss === true;
  useEffect(() => {
    if (!requestDismiss) return undefined;
    const id = requestAnimationFrame(() => requestClose());
    return () => cancelAnimationFrame(id);
  }, [requestDismiss, requestClose]);

  useEffect(() => () => clearCloseTimer(), []);

  // Android 的返回键 = Esc。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dismissEnabled) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startY: event.clientY,
      startTime: event.timeStamp,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      offset: 0,
    };
    event.stopPropagation();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current;
    if (state === null) return;
    const delta = event.clientY - state.startY;
    state.offset = Math.max(0, delta);
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    setDragPx(state.offset);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = dragRef.current;
    dragRef.current = null;
    if (state === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    const elapsed = Math.max(1, state.lastTime - state.startTime);
    const velocity = ((state.lastY - state.startY) / elapsed) * 1000;
    const passed =
      velocity > WENKU_SHEET_DISMISS_VELOCITY || state.offset > height * WENKU_SHEET_DISMISS_FRACTION;
    if (passed) {
      requestClose();
      return;
    }
    // 回弹：`animateTo(0, 420ms, easeOutCubic)`（L964-971）。
    setDragPx(0);
  };

  const layerStyle: CSSProperties = {
    ['--wenku-sheet-drag' as string]: `${dragPx}px`,
  } as CSSProperties;

  const closeDisabled = !dismissEnabled;

  return (
    <div
      className="wenku-root wenku-sheet-layer"
      data-wenku-open={open ? 'true' : 'false'}
      style={layerStyle}
      data-testid={props.testId ?? 'wenku-action-sheet'}
    >
      <button
        type="button"
        className="wenku-sheet__scrim"
        aria-label={tr('关闭面板')}
        tabIndex={-1}
        disabled={closeDisabled}
        data-testid="wenku-action-sheet-scrim"
        onClick={() => requestClose()}
      />
      <div
        ref={panelRef}
        className={props.className === undefined ? 'wenku-sheet' : `wenku-sheet ${props.className}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        style={{
          paddingBottom: props.fitKeyboard === true
            ? `calc(240px + var(--space-2) + var(--safe-bottom))`
            : undefined,
        }}
      >
        {props.grabber === false ? null : (
          <div
            className="wenku-sheet__grabber"
            data-testid="wenku-action-sheet-grabber"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        )}
        <div className="wenku-sheet__body">
          <div className="wenku-sheet__head wenku-sheet__part">
            <h3 className="wenku-sheet__title">{props.title}</h3>
            <button
              type="button"
              className="wenku-sheet__close"
              aria-label={tr('关闭面板')}
              disabled={closeDisabled}
              data-testid="wenku-action-sheet-close"
              onClick={() => requestClose()}
            >
              <WenkuIcon symbol="Close" size={20} />
            </button>
          </div>
          <div className="wenku-sheet__content">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * `MoreActionSheet`（`ui/shelf/ShelfSelectionHost.kt` L547-560）：玻璃面板里一排整行按钮。
 * 标题固定「更多操作」，最后一项若是删除类自动上分隔线。
 */
export interface WenkuActionSheetRow {
  readonly label: string;
  readonly icon?: WenkuSymbol;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
}

export function WenkuActionSheetList(props: {
  readonly rows: readonly WenkuActionSheetRow[];
  readonly title?: string;
  readonly onDismiss: () => void;
  readonly dismissEnabled?: boolean;
  readonly testId?: string;
}): ReactElement {
  return (
    <WenkuActionSheet
      title={props.title ?? tr('更多操作')}
      onDismiss={props.onDismiss}
      {...(props.dismissEnabled === undefined ? null : { dismissEnabled: props.dismissEnabled })}
      {...(props.testId === undefined ? null : { testId: props.testId })}
    >
      {props.rows.map((row, index) => (
        <button
          key={`${row.label}-${index}`}
          type="button"
          className={
            row.destructive === true
              ? 'wenku-sheet__row wenku-sheet__row--destructive wenku-sheet__part'
              : 'wenku-sheet__row wenku-sheet__part'
          }
          disabled={row.disabled === true}
          data-testid="wenku-action-sheet-row"
          onClick={() => row.onSelect?.()}
        >
          {row.icon === undefined ? null : <WenkuIcon symbol={row.icon} size={20} />}
          <span className="wenku-menu__label">{row.label}</span>
        </button>
      ))}
    </WenkuActionSheet>
  );
}

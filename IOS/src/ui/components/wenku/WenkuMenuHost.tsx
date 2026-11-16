/**
 * Wenku 长按菜单宿主 —— `ui/wenku/WenkuMenuHost.kt` + `ui/shelf/ShelfSelectionHost.kt` L442-560。
 *
 * Kotlin → TS 映射
 * ─────────────────
 * `WenkuMenuHost.kt`
 *   L162-163   wenkuMenuSourceAlpha（来源图标 1 - Interval(0,.22,easeInOut)）→ 未移植（见下）
 *   L195-214   WenkuMenuStretch(progress, anchor, target, content)
 *              → `.wenku-menu__card` 的 anchor 定位 + scale 入场
 *   L232-359   WenkuMenuHost(visible, anchorBounds, sourceRadius, onDismiss, dismissRequested,
 *              onHidden, borderlessSurface, content)
 *              → `WenkuMenuHost`（visible / anchor / onDismiss / onHidden / children）
 *   L135-146   WenkuMenuHitThreshold .15 / WenkuMenuContentThreshold .34 / 错峰 .025 × clamp(0,8)
 *              → 菜单项 `transition-delay: order*25ms`（wenku.css）
 *   L149-152   barrier：menu = 透明，sheet = WenkuTokens.Scrim → menu `.wenku-menu__scrim` = scrim
 * `ShelfSelectionHost.kt`
 *   L442-449   data class ShelfAction(label, icon, onClick, enabled, destructive) → `WenkuMenuEntry`
 *   L451-545   MultiSelectActionBar（毛玻璃胶囊、弹簧滑入、48dp 项、10sp 标签、0.95 按压缩放）
 *              → `WenkuActionBar`
 *   L547-560   MoreActionSheet(actions: List<Pair<String, WenkuSymbol>>, onPick, onDismiss)
 *              → `WenkuShelfMoreMenu`
 *
 * 未移植（都在「转场几何」这一层，Web 无等价 RenderBox 能力）：
 *   - L662-777 `WenkuMenuStretchCore`：把 anchor 矩形按
 *     `width: Cubic(.18,1.10,.30,1)` / `height: Cubic(.22,1.04,.32,1)` 长到 target、
 *     位置走 `Rect.lerp(anchor, target, easeOutCubic)`、原点贴右贴顶的**非等比** morph。
 *     Web 端固定宽度菜单 + `transform-origin` 落在锚点 + 等比 scale(.86→1)，观感一致但
 *     不是逐帧同一个矩形；`--wenku-anchor-*` 已把锚点交给 CSS，后续可补 keyframes。
 *   - L883-911 `wenkuPointerGate` / `wenkuBlockPointer`（转场期间拦截输入）：这里用
 *     `pointer-events: none` + `inert` 语义近似。
 *   - L1100-1120 `WenkuSheetRegistry`：Web 端 z-index 直接分层。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { WenkuActionSheet } from './WenkuActionSheet';
import type { WenkuActionSheetRow } from './WenkuActionSheet';
import { WenkuGlass, useWenkuReducedMotion } from './WenkuGlass';
import { WenkuIcon } from './WenkuIcon';
import type { WenkuSymbol } from './WenkuIcon';
import { tr } from '@core/i18n';

/** `WenkuMotion.ENTER_MS` / `EXIT_MS`（WenkuTokens.kt L121-156）。 */
export const WENKU_MENU_ENTER_MS = 420;
export const WENKU_MENU_EXIT_MS = 320;
/** `WenkuTokens.MenuWidth = 248.dp`。 */
export const WENKU_MENU_WIDTH = 248;
/** `WenkuMenuStretch` 默认 `sourceRadius = 24.dp`（WenkuMenuHost.kt L204-205）。 */
export const WENKU_MENU_SOURCE_RADIUS = 24;

/** 一个菜单项：`ShelfAction`（ShelfSelectionHost.kt L443-449）+ `WenkuTextButton` 的 wenkuSymbol。 */
export interface WenkuMenuEntry {
  readonly key: string;
  readonly label: string;
  readonly icon?: WenkuSymbol;
  readonly enabled?: boolean;
  readonly destructive?: boolean;
  /** 选中态（`多选/已喜欢` 这类开关项）——对齐 `WenkuTextButton(selected = ...)`。 */
  readonly selected?: boolean;
  /** 该项下面加分隔线（「更多」类收尾项常用）。 */
  readonly separated?: boolean;
  readonly onSelect?: () => void;
}

/** 触发控件矩形：接受 Compose `Rect`（left/top）或 DOM 习惯（x/y）两种写法。 */
export type WenkuMenuAnchor =
  | { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

function anchorLeft(anchor: WenkuMenuAnchor): number {
  return 'x' in anchor ? anchor.x : anchor.left;
}

function anchorTop(anchor: WenkuMenuAnchor): number {
  return 'y' in anchor ? anchor.y : anchor.top;
}

export interface WenkuMenuHostProps {
  readonly visible: boolean;
  /** 触发控件矩形（宿主本地 px）；null = 居中静态呈现、无 morph（L342-350）。 */
  readonly anchor?: WenkuMenuAnchor | null;
  readonly entries: readonly WenkuMenuEntry[];
  /** 菜单顶部的说明行（一般是书名）。 */
  readonly title?: string;
  readonly onDismiss: () => void;
  /** 退场动画播完后回调（L240 `onHidden`）。 */
  readonly onHidden?: () => void;
  readonly testId?: string;
}

/**
 * 玻璃菜单宿主：遮罩可点、Esc 关闭、项错峰浮现、退场 320ms 后卸载。
 */
export function WenkuMenuHost(props: WenkuMenuHostProps): ReactElement | null {
  const reduceMotion = useWenkuReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);
  const { onDismiss } = props;
  const onHidden = props.onHidden;
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExit = (): void => {
    if (exitTimer.current !== null) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  };

  /* L266-281：`visible` 一开立刻渲染（首帧 open=false），下一帧推 `open` 跑入场；
     关掉时先跑完 320ms 退场再卸载。effect 本体只做编排，setState 都在 rAF / timer 里落地。 */
  useEffect(() => {
    clearExit();
    if (props.visible) {
      mountedRef.current = true;
      const id = requestAnimationFrame(() => {
        setMounted(true);
        setOpen(true);
      });
      return () => cancelAnimationFrame(id);
    }
    const closeFrame = requestAnimationFrame(() => setOpen(false));
    if (!mountedRef.current) return () => cancelAnimationFrame(closeFrame);
    const finish = (): void => {
      mountedRef.current = false;
      setMounted(false);
      onHidden?.();
    };
    if (reduceMotion) {
      const quick = requestAnimationFrame(finish);
      return () => {
        cancelAnimationFrame(closeFrame);
        cancelAnimationFrame(quick);
      };
    }
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      finish();
    }, WENKU_MENU_EXIT_MS);
    return () => {
      cancelAnimationFrame(closeFrame);
      clearExit();
    };
  }, [props.visible, reduceMotion, onHidden]);

  useEffect(() => () => clearExit(), []);

  useEffect(() => {
    if ((!props.visible && !mounted) || typeof window === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.visible, mounted, onDismiss]);

  const select = useCallback((entry: WenkuMenuEntry) => {
    if (entry.enabled === false) return;
    entry.onSelect?.();
  }, []);

  if (!props.visible && !mounted) return null;

  const anchor = props.anchor ?? null;
  const layerStyle: CSSProperties = {
    ...(anchor === null
      ? null
      : {
          ['--wenku-anchor-x' as string]: `${Math.round(anchorLeft(anchor))}px`,
          ['--wenku-anchor-y' as string]: `${Math.round(anchorTop(anchor))}px`,
          transformOrigin: `${Math.round(anchorLeft(anchor) + anchor.width / 2)}px ${Math.round(anchorTop(anchor))}px`,
        }),
  } as CSSProperties;

  return (
    <div
      className="wenku-root wenku-menu-layer"
      data-wenku-open={open ? 'true' : 'false'}
      style={layerStyle}
      data-testid={props.testId ?? 'wenku-menu-host'}
    >
      <button
        type="button"
        className="wenku-menu__scrim"
        aria-label={tr('关闭面板')}
        tabIndex={-1}
        data-testid="wenku-menu-scrim"
        onClick={onDismiss}
      />
      <WenkuGlass
        className="wenku-menu__card"
        radius={24}
        blur={16}
        testId="wenku-menu"
      >
        {props.title === undefined ? null : (
          <p className="wenku-menu__title" data-testid="wenku-menu-title">
            {props.title}
          </p>
        )}
        {props.entries.map((entry, index) => {
          const classes = ['wenku-menu__item'];
          if (entry.destructive === true) classes.push('wenku-menu__item--destructive');
          if (entry.separated === true) classes.push('wenku-menu__item--separated');
          return (
            <button
              key={entry.key}
              type="button"
              className={classes.join(' ')}
              style={{ transitionDelay: `${Math.min(index, 8) * 25}ms` }}
              disabled={entry.enabled === false}
              aria-pressed={entry.selected === undefined ? undefined : entry.selected}
              data-testid="wenku-menu-item"
              data-wenku-entry={entry.key}
              onClick={() => select(entry)}
            >
              {entry.icon === undefined ? null : (
                <WenkuIcon symbol={entry.icon} size={20} active={entry.selected === true} />
              )}
              <span className="wenku-menu__label">{entry.label}</span>
              {entry.selected === true ? (
                <WenkuIcon symbol="Check" size={18} className="wenku-menu__check" />
              ) : null}
            </button>
          );
        })}
      </WenkuGlass>
    </div>
  );
}

export interface WenkuActionBarProps {
  readonly visible: boolean;
  readonly actions: readonly WenkuMenuEntry[];
  /** 栏上方的小字提示（`MultiSelectActionBar(hint = ...)`）。 */
  readonly hint?: string | null;
  readonly testId?: string;
}

/**
 * 底部悬浮操作栏（`ShelfSelectionHost.kt` L451-545 `MultiSelectActionBar`）。
 * 布局是「毛玻璃胶囊 + 每项 20dp 图标 + 10sp 标签」，`enabled == false` 时整项 .35 透明。
 */
export function WenkuActionBar(props: WenkuActionBarProps): ReactElement {
  const reduceMotion = useWenkuReducedMotion();
  return (
    <div
      className="wenku-root wenku-actionbar-layer"
      data-wenku-open={props.visible ? 'true' : 'false'}
      data-reduce-motion={reduceMotion ? 'true' : 'false'}
      data-testid={props.testId ?? 'wenku-action-bar'}
    >
      {props.hint !== undefined && props.hint !== null && props.hint !== '' ? (
        <p className="wenku-sheet__hint" data-testid="wenku-action-bar-hint">
          {props.hint}
        </p>
      ) : null}
      <WenkuGlass className="wenku-actionbar" radius={26} blur={16} flat>
        {props.actions.map((action, index) => {
          const classes = ['wenku-actionbar__item'];
          if (action.destructive === true) classes.push('wenku-actionbar__item--destructive');
          return (
            <button
              key={action.key}
              type="button"
              className={classes.join(' ')}
              style={{ transitionDelay: `${Math.min(index, 8) * 25}ms` }}
              disabled={!props.visible || action.enabled === false}
              data-testid="wenku-action-bar-item"
              data-wenku-entry={action.key}
              onClick={() => action.onSelect?.()}
            >
              {action.icon === undefined ? null : (
                <WenkuIcon symbol={action.icon} size={20} active={action.selected === true} />
              )}
              <span className="wenku-actionbar__label">{action.label}</span>
            </button>
          );
        })}
      </WenkuGlass>
    </div>
  );
}

export interface WenkuShelfMoreMenuProps {
  readonly visible: boolean;
  readonly rows: readonly WenkuActionSheetRow[];
  readonly onDismiss: () => void;
  readonly title?: string;
}

/**
 * 「更多操作」玻璃面板（`MoreActionSheet`，ShelfSelectionHost.kt L547-560）：
 * 一行一项，删除类自动用 error 色。
 */
export function WenkuShelfMoreMenu(props: WenkuShelfMoreMenuProps): ReactElement | null {
  if (!props.visible) return null;
  const sheetTitle = props.title ?? tr('更多操作');
  return (
    <WenkuActionSheet
      title={sheetTitle}
      onDismiss={props.onDismiss}
      testId="wenku-shelf-more-sheet"
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
          data-testid="wenku-sheet-row"
          onClick={() => row.onSelect?.()}
        >
          {row.icon === undefined ? null : <WenkuIcon symbol={row.icon} size={20} />}
          <span className="wenku-menu__label">{row.label}</span>
        </button>
      ))}
    </WenkuActionSheet>
  );
}

/** 便捷：把 `WenkuMenuEntry[]` 转成 `WenkuActionSheetRow[]`（「更多」面板复用同一份动作表）。 */
export function wenkuEntriesToSheetRows(entries: readonly WenkuMenuEntry[]): WenkuActionSheetRow[] {
  return entries.map((entry) => ({
    label: entry.label,
    ...(entry.icon === undefined ? null : { icon: entry.icon }),
    ...(entry.onSelect === undefined ? null : { onSelect: entry.onSelect }),
    destructive: entry.destructive === true,
    disabled: entry.enabled === false,
  }));
}

/** 供 `ArchiveShelf` 复用的节点类型（不引入额外依赖）。 */
export type WenkuMenuChildren = ReactNode;

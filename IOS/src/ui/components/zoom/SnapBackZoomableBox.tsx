/**
 * `SnapBackZoomableBox` 一族 —— `net/engawapg/lib/zoomable/SnapBackZoomableBox.kt`（433 行）的 Web 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L63-92   `ZoomablePopupState`（anchorWindowBounds / windowSize / positionProvider）→ `ZoomablePopupState`
 *   L97-98   `rememberZoomablePopupState()`                                  → `useZoomablePopupState`（原名出口）
 *   L109-114 `SnapBackZoomableOverlayController`（hostCoordinates / entries）→ `SnapBackZoomableOverlayController`
 *   L116-122 `SnapBackZoomableOverlayEntry(zoomState, scrim, content)`        → `SnapBackZoomableOverlayEntry`
 *   L124-125 `LocalSnapBackZoomableOverlayController`                        → 同名 Context
 *   L150-169 `SnapBackZoomableOverlayHost(modifier, content)`                → 同名组件
 *   L199-231 `SnapBackZoomableBox(modifier, zoomState, scrim = Black@.6, onTap, content)`
 *            → 同名组件（有 host 走 host，否则走 popup）
 *   L233-263 `HostedSnapBackZoomableBox(...)`：`isActive` 时内容移到覆盖层、原位留 `ReservedSpace`
 *   L269     `scrimAlphaForScale(scale) = ((scale - 1f) * 2f).coerceIn(0f, 1f)` → 同名
 *   L271-276 `rememberScrimAlpha(zoomState)`                                 → `useScrimAlpha`
 *   L278-300 `HostedZoomOverlay(entry, hostCoords)`                          → `HostedZoomOverlay`
 *   L333-380 `PopupSnapBackZoomableBox(...)`                                 → `PopupSnapBackZoomableBox`
 *   L381+    `ZoomablePopup(...)`                                            → `ZoomablePopup`
 *   `ReservedSpace(anchorSize)`：手势期间在原位保留同样大小的占位
 *
 * 平台差异（已登记 E130）
 * ─────────────────────
 *  * Compose `Popup`（独立窗口）→ `position: fixed` 覆盖层：两者都让放大内容越过父级裁剪边界。
 *  * `movableContentOf`（同一子树在锚点与覆盖层之间搬移）→ Web 用「锚点留占位、内容只画在
 *    覆盖层」表达同一视觉结果。
 *  * `mutableStateOf` 字段 → React state：`anchorCoordinates` 与 `hostCoordinates` 都是
 *    state（渲染期只读，写入只发生在 `ref` 回调 / `onGloballyPositioned`）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { createZoomState, type ZoomSize } from '@core/zoom/zoomState';
import { useSnapBackZoomable, type ZoomableBinding } from './Zoomable';
import '../../../styles/zoomable.css';

/** `ZoomState` 在 Web 侧的对外形态（`scale` + 手势绑定）。 */
export interface ZoomableHandle {
  readonly binding: ZoomableBinding;
  readonly ref: (element: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly scale: number;
  readonly active: boolean;
}

export interface AnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** L63-92 `ZoomablePopupState`（Web 侧保留 positionProvider 的语义：恒返回原点）。 */
export interface ZoomablePopupState {
  /** L71-81 `calculatePosition(...)` 恒返回 `IntOffset.Zero`（覆盖层自己算位置）。 */
  readonly positionProvider: (popupContentSize: ZoomSize) => { readonly x: number; readonly y: number };
}

/** L97-98 `rememberZoomablePopupState()`。 */
export function useZoomablePopupState(): ZoomablePopupState {
  return useMemo<ZoomablePopupState>(
    () => ({
      positionProvider: (popupContentSize) => {
        void popupContentSize;
        return { x: 0, y: 0 };
      },
    }),
    [],
  );
}

/** Kotlin 原名出口。 */
export const rememberZoomablePopupState = useZoomablePopupState;

export interface SnapBackZoomableOverlayEntry {
  readonly zoomState: ZoomableHandle;
  /** `Color.Black.copy(alpha = 0.6f)` 由 `SnapBackZoomableBox` 默认给出。 */
  readonly scrim: string;
  readonly content: ReactNode;
  /** `entry.anchorCoordinates`：锚点在窗口中的矩形（`onGloballyPositioned` 写入）。 */
  readonly anchor: AnchorRect | null;
}

/** L109-114 `SnapBackZoomableOverlayController`。 */
export interface SnapBackZoomableOverlayController {
  readonly entries: readonly SnapBackZoomableOverlayEntry[];
  readonly add: (entry: SnapBackZoomableOverlayEntry) => void;
  readonly remove: (entry: SnapBackZoomableOverlayEntry) => void;
}

/** L124-125 `LocalSnapBackZoomableOverlayController`。 */
export const LocalSnapBackZoomableOverlayController =
  createContext<SnapBackZoomableOverlayController | null>(null);

export interface SnapBackZoomableOverlayHostProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** L150-169 `SnapBackZoomableOverlayHost(modifier, content)`。 */
export function SnapBackZoomableOverlayHost(props: SnapBackZoomableOverlayHostProps) {
  const [entries, setEntries] = useState<readonly SnapBackZoomableOverlayEntry[]>([]);
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null);

  const controller = useMemo<SnapBackZoomableOverlayController>(
    () => ({
      entries,
      add: (entry) => {
        setEntries((cur) => (cur.includes(entry) ? cur : [...cur, entry]));
      },
      remove: (entry) => {
        setEntries((cur) => cur.filter((x) => x !== entry));
      },
    }),
    [entries],
  );

  return (
    <LocalSnapBackZoomableOverlayController.Provider value={controller}>
      <div
        className={['snapback-host', props.className].filter(Boolean).join(' ')}
        style={props.style}
        ref={setHostElement}
      >
        {props.children}
        {entries.map((entry, index) => (
          <HostedZoomOverlay key={`${String(index)}:${entry.scrim}`} entry={entry} host={hostElement} />
        ))}
      </div>
    </LocalSnapBackZoomableOverlayController.Provider>
  );
}

/** L269 `scrimAlphaForScale(scale) = ((scale - 1f) * 2f).coerceIn(0f, 1f)`。 */
export function scrimAlphaForScale(scale: number): number {
  return Math.min(Math.max((scale - 1) * 2, 0), 1);
}

/** L271-276 `rememberScrimAlpha(zoomState)`。 */
export function useScrimAlpha(scale: number): number {
  return useMemo(() => scrimAlphaForScale(scale), [scale]);
}

export interface SnapBackZoomableBoxProps {
  readonly children: ReactNode;
  /** L204 `scrim: Color = Color.Black.copy(alpha = 0.6f)`。 */
  readonly scrim?: string;
  readonly onTap?: (position: { readonly x: number; readonly y: number }) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/** L199-231 `SnapBackZoomableBox(...)`。 */
export function SnapBackZoomableBox(props: SnapBackZoomableBoxProps) {
  const controller = useContext(LocalSnapBackZoomableOverlayController);
  const scrim = props.scrim ?? 'rgba(0, 0, 0, 0.6)';
  if (controller !== null) {
    return <HostedSnapBackZoomableBox {...props} scrim={scrim} controller={controller} />;
  }
  return <PopupSnapBackZoomableBox {...props} scrim={scrim} />;
}

interface HostedProps extends SnapBackZoomableBoxProps {
  readonly scrim: string;
  readonly controller: SnapBackZoomableOverlayController;
}

/** L233-263 `HostedSnapBackZoomableBox(...)`。 */
function HostedSnapBackZoomableBox(props: HostedProps) {
  const zoom = useSnapBackZoomable({ onTap: (position) => props.onTap?.(position) });
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const zoomState = useMemo<ZoomableHandle>(
    () => ({
      binding: zoom,
      ref: zoom.ref,
      style: zoom.style,
      scale: zoom.scale,
      active: zoom.active,
    }),
    [zoom],
  );

  const entry = useMemo<SnapBackZoomableOverlayEntry>(
    () => ({ zoomState, scrim: props.scrim, content: props.children, anchor }),
    [zoomState, props.scrim, props.children, anchor],
  );

  useEffect(() => {
    props.controller.add(entry);
    return () => props.controller.remove(entry);
  }, [props.controller, entry]);

  /** `onGloballyPositioned { entry.anchorCoordinates = it }` + `onSizeChanged`。 */
  const attach = useCallback(
    (element: HTMLDivElement | null): void => {
      zoom.ref(element);
      if (element === null) {
        setAnchor(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    },
    [zoom],
  );

  return (
    <div
      ref={attach}
      className={['snapback-anchor', props.className].filter(Boolean).join(' ')}
      style={props.style}
      data-testid={props.testId}
      {...zoom.handlers}
    >
      {zoom.active ? <ReservedSpace /> : props.children}
    </div>
  );
}

/** L333-380 `PopupSnapBackZoomableBox(...)`：没有 host 时用固定定位的覆盖层。 */
function PopupSnapBackZoomableBox(props: SnapBackZoomableBoxProps & { readonly scrim: string }) {
  const zoom = useSnapBackZoomable({ onTap: (position) => props.onTap?.(position) });
  const scrimAlpha = useScrimAlpha(zoom.scale);
  // `Modifier.snapBackZoomable` 的宿主节点：attach 里只做「登记元素 + 改手势状态」，
  // 渲染期不读任何 ref（同 `HostedSnapBackZoomableBox`）。
  const attach = useCallback(
    (element: HTMLDivElement | null): void => {
      zoom.ref(element);
    },
    [zoom],
  );
  return (
    <>
      <div
        ref={attach}
        className={['snapback-anchor', props.className].filter(Boolean).join(' ')}
        style={props.style}
        data-testid={props.testId}
        {...zoom.handlers}
      >
        {zoom.active ? <ReservedSpace /> : props.children}
      </div>
      {zoom.active ? (
        <ZoomablePopup scrim={props.scrim} scrimAlpha={scrimAlpha} zoomStyle={zoom.style}>
          {props.children}
        </ZoomablePopup>
      ) : null}
    </>
  );
}

/** L381+ `ZoomablePopup(...)`：`position: fixed` 的整窗覆盖层 + scrim。 */
export function ZoomablePopup(props: {
  readonly scrim: string;
  readonly scrimAlpha: number;
  readonly zoomStyle: CSSProperties;
  readonly children: ReactNode;
}) {
  return (
    <div className="snapback-popup" role="presentation">
      <div
        className="snapback-popup__scrim"
        style={{ background: props.scrim, opacity: props.scrimAlpha }}
        aria-hidden
      />
      <div className="snapback-popup__content" style={props.zoomStyle}>
        {props.children}
      </div>
    </div>
  );
}

/** L278-300 `HostedZoomOverlay(entry, hostCoords)`：把放大内容画在宿主覆盖层里。 */
export function HostedZoomOverlay(props: {
  readonly entry: SnapBackZoomableOverlayEntry;
  readonly host: HTMLElement | null;
}) {
  const { entry, host } = props;
  const anchor = entry.anchor;
  if (!entry.zoomState.active) return null;
  if (anchor === null) return null;
  const hostRect = host === null ? { left: 0, top: 0 } : host.getBoundingClientRect();
  const scrimAlpha = scrimAlphaForScale(entry.zoomState.scale);
  return (
    <div className="snapback-overlay" role="presentation">
      <div
        className="snapback-overlay__scrim"
        style={{ background: entry.scrim, opacity: scrimAlpha }}
        aria-hidden
      />
      <div
        className="snapback-overlay__content"
        style={{
          left: `${String(anchor.left - hostRect.left)}px`,
          top: `${String(anchor.top - hostRect.top)}px`,
          width: `${String(anchor.width)}px`,
          height: `${String(anchor.height)}px`,
          ...entry.zoomState.style,
        }}
      >
        {entry.content}
      </div>
    </div>
  );
}

/** `ReservedSpace(anchorSize)`：手势期间在原位保留同样大小的占位。 */
export function ReservedSpace() {
  return <div className="snapback-reserved" aria-hidden style={{ visibility: 'hidden' }} />;
}

/** `rememberZoomState()`（`ZoomState.kt` L54）的 Web 形态：仅用于断言默认值。 */
export const ZOOM_STATE_DEFAULTS = createZoomState();

/**
 * TouchZoneEditor.tsx — line-by-line port of Android
 * `com/example/ui/reader/TouchZoneEditor.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/reader/TouchZoneEditor.kt`, 387 lines / 366 non-blank),
 * plus the data model it is defined against: `com/example/ui/reader/TouchZones.kt`
 * (101 lines — `TouchAction` / `SwipeAction` / `TouchZone` / `hit` / `normalized` /
 * `encode` / `decode` / `swipeGuideSign`).
 *
 * REVIEW-2026-11-16：模型已迁到 **`@core/reader/touchZones`**（唯一实现）——阅读器
 * （`ReaderPage.tsx`）、漫画配置（`comicReaderConfig.ts`）与手势层
 * （`touchZoneGestures.ts`）共用同一份；本文件只保留编辑器 + 对既有 import 路径的
 * 再导出（`export … from '@core/reader/touchZones'`）。此处原有的模型拷贝已删除。
 *
 * Kotlin → TS line map (TouchZoneEditor.kt)
 * ────────────────────────────────────────
 *   L1-48    package + imports                          → React imports; Compose/Android imports SKIPPED
 *   L49-59   `fun TouchZoneEditor(zones, defaults, defaultDistanceDp, comic, vertical,
 *            onSave, onDismiss, resetZones, onRestoreDefault, viewportInWindow,
 *            onPreview, reverse)`                      → `TouchZoneEditorProps` (same names/order)
 *   L60-72   draft / resetRequested / visible / selectedId / selected / range / calibrating /
 *            completed / sample / controlsExpanded / toolsAtTop / trying / origin
 *                                                       → `useState` + `useRef` block
 *   L78      `fun edit(zone)`                           → `edit()` / `editZoneById()`
 *   L79      `fun startCalibration()`                   → `startCalibration()`
 *   L80-81   `rememberUpdatedState(onPreview)` + `LaunchedEffect(draft, trying, resetRequested)`
 *                                                       → `previewRef` + `useEffect`
 *   L82      `DisposableEffect(Unit) { onDispose { onPreview(null, false) } }`
 *                                                       → unmount cleanup `useEffect`
 *   L83      `BackHandler { if (trying) trying = false else onDismiss() }`
 *                                                       → `Escape` keydown listener (Web 无系统返回键)
 *   L84      `dim by animateFloatAsState(if (trying) 0f else .17f)`
 *                                                       → `.tze__dim` CSS opacity transition (.17 → 0)
 *   L85-91   `BoxWithConstraints` + `viewportInWindow` intersection → `.tze__layer` (`viewport` prop,
 *                                                       same intersect/fallback rule: empty ⇒ full)
 *   L92      `Box(background(Color.Black.copy(alpha = dim)))` → `.tze__dim`
 *   L93-99   sibling shield (`awaitEachGesture` consumes every event) → `.tze__shield`
 *                                                       (`touch-action: none`, own stacking layer)
 *   L100-101 viewport offset + size                      → inline `left/top/width/height`
 *   L102-132 zone list: `key(zone.id)`, fill + 3dp white stroke + 1dp accent hairline +
 *            4 corner knobs, label overlay (`"${i+1} · ${tap}\n${swipe}"`, width clamp,
 *            scrim@.5, padding SpaceCompact)            → `<ZoneRect/>` + `.tze__zone*` CSS
 *   L133-144 gesture locals (grab/start/handle/dragTotal/measuring/rawDown/multiPointer)
 *                                                       → `dragRef` (never read during render)
 *   L145-153 `awaitEachGesture` multi-pointer detector    → `pointersRef` (size > 1 ⇒ multiPointer)
 *   L154-158 `detectTapGestures { … }`                   → pointer-up tap branch (same slop rule)
 *   L159-215 `detectDragGestures(onDragStart/onDrag/onDragEnd/onDragCancel)`
 *                                                       → `handlePointerDown/Move/Up/Cancel`
 *   L171-175 bar length / bar start / `handle = 4` when swipe == PAGE and
 *            `(point - end).getDistance() < 22.dp`        → `detectHandle()`, 22px hit radius
 *   L184-189 calibrating sampling + range-drag (`amount * 2f`, `coerceIn(12f, 360f)`)
 *                                                       → same
 *   L190-199 handle 0/1/2/3 + move (`coerceIn(-left, 1 - right)`) → `applyZoneDrag()` (pure, exported)
 *   L204-213 drag end: commit sample when `sample >= 12f`, clear grab/measuring
 *                                                       → same (+ CSS completion flash instead of haptics)
 *   L217-219 `SwipeCalibrationArt(...)` when `selected?.swipe == SwipeAction.PAGE`
 *                                                       → `<SwipeCalibrationArt/>` (SVG)
 *   L222-243 top tool bar: close (`取消编辑`) / title (`正在真实试读` | `自定义触控分区`) /
 *            subtitle (`使用未保存的分区，可直接翻页` | `试着用自己最舒适的方式滑动一页` |
 *            `✓ 已记住你的手势 · 可继续微调` | `原尺寸阅读画面 · 拖动移动 / 四角缩放`) /
 *            `返回编辑` | `保存`                     → `.tze__bar--primary`
 *   L244-293 bottom tool bar: `添加分区` (enabled `< 64`) / `设置功能`|`收起工具` / `试读` /
 *            `工具移到另一侧`; expanded controls: `分区 n` / `置顶` / `删除分区` / `点击行为` /
 *            `滑动行为` / `沿用原有阅读器判定 · 校准快速完成距离`|`触发距离 n dp` / 12…360 滑杆 /
 *            说明文案 / `重新校准` / footnote / `恢复原有默认`; collapsed range row
 *            (`本次 n dp` | `原有判定 · 可拖动范围端点` | `触发距离 n dp`) + `手动调整`|`重新校准`
 *                                                       → `.tze__bar--tools`
 *   L297-303 `ActionChoices(items, selected, label, choose)` — `FlowRow` of `FilterChip`
 *                                                       → `ActionChoices` using the shared `CategoryPill`
 *   L305-387 `SwipeCalibrationArt` Canvas                → `SwipeCalibrationArt` (SVG, same geometry)
 *
 * ── Persistence keys (Kotlin `NovelTouchZoneStore`, TouchZones.kt L64-70) ──────────
 *   SharedPreferences name `reader_touch_zones_v1`, key `novel`, JSON array of ≤ 64 zones,
 *   each `{id,l,t,r,b,tap,swipe,distance?}`. Exported as `TOUCH_ZONE_PREFS` with
 *   `encodeZones()` / `decodeZones()` so the caller owns the store — this file writes none.
 *
 * ── Unit convention ──────────────────────────────────────────────────────────────
 *   Android 用 dp 判定阈值、用 px 布局；Web 直接使用 CSS px。1x 基准下 1 CSS px ≙ 1 dp，
 *   于是 `DesignTokens.*.toPx()` 的换算退化为恒等（`density == 1`）。所有阈值
 *   （24 = SpaceXxl 角点、22 = 范围端点、12 = 最短距离、360 = 最长距离、8% = 最小边长、
 *   64 = 分区上限）与 Kotlin 完全一致。
 *
 * ── Adaptations ────────────────────────────────────────────────────────────────
 *  * `Canvas` 手绘 → DOM（区域框、角点）+ SVG（校准示意）。几何公式、线宽（3dp / 1dp）、
 *    圆角 10dp、配色 alpha 与 Kotlin 逐项相同。
 *  * `Animatable` 的 phase 演示循环（`tween(2200, LinearEasing)` + `delay(450)`）→
 *    CSS 关键帧，同一 2200ms/450ms 周期；`reduceMotion` 时全部关闭。
 *  * `haptics.performHapticFeedback(TextHandleMove)` → 无 Web 等价物，改为完成时的视觉闪烁
 *    （Kotlin 同一分支的 `flash` 圈 / `success` 圈），不伪造振动 API 调用。
 *  * `BackHandler` → `Escape` 键。
 *  * `viewportInWindow` 用 `positionInWindow()` 求交集 → 由 `viewport` prop 直接给出同一个矩形，
 *    宽或高 ≤ 0 时回退整屏（同 L89）。
 *  * `LiquidSlider` → 原生 `<input type="range">`，值域 12…360、步长 1dp（显示 `roundToInt`）。
 *  * `PullOutTextButton` / `PullOutIconButton` → 共享 `AppButton` / `AppIconButton`；
 *    `FilterChip` → 共享 `CategoryPill`（同 32dp 胶囊、选中态主色）。
 *  * 未移植：`Modifier.safeDrawingPadding()`（Web 用 `env(safe-area-inset-*)`）、
 *    `Modifier.acrylicPanel` 的 GPU 图层（CSS `backdrop-filter` + 同 alpha .92/.94）、
 *    `PullOutVisibility` 的高度动画（CSS `grid-template-rows` 过渡）。
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { AppButton } from '@ui/components/AppButton';
import { AppIconButton } from '@ui/components/CustomButtons';
import { CategoryPill } from '@ui/components/Chips';
import { withAlpha } from '@core/glass/color';
import '../../../styles/touchZoneEditor.css';

/* ══════════════════════════════════════════════════════════════════════════════
   Model — 唯一实现在 @core/reader/touchZones（TouchZones.kt 的逐行移植）
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 模型（`TouchAction` / `SwipeAction` / `TouchZone` / `contains` / `normalized` /
 * `json` / `encode` / `decode` / `hit` / `swipeGuideSign`）已迁到
 * `@core/reader/touchZones` —— 阅读器（`ReaderPage.tsx`）、漫画配置
 * （`comicReaderConfig.ts`）与手势层（`touchZoneGestures.ts`）共用同一份实现，
 * 这里**不再保留第二份**。
 *
 * 下面的 import 供本文件内部使用；`export … from` 保证既有调用点
 * （`tests/unit/newSettingsScreens.test.tsx` 等从
 * `@ui/components/reader/TouchZoneEditor` 取模型的写法）继续可用。
 */
import {
  MAX_DISTANCE_DP,
  MIN_DISTANCE_DP,
  SWIPE_ACTIONS,
  SWIPE_ACTION_LABELS,
  TOUCH_ACTIONS,
  TOUCH_ACTION_LABELS,
  TOUCH_ZONE_PREFS,
  applyZoneDrag,
  createTouchZone,
  makeUuid,
  normalizeZone,
  swipeGuideSign,
  zoneContains,
  zoneHit,
  type TouchAction,
  type TouchZone,
  type TouchZoneConfig,
} from '@core/reader/touchZones';
import { tr } from '@core/i18n';

export type { SwipeAction, TouchAction, TouchZone, TouchZoneConfig } from '@core/reader/touchZones';
export {
  MAX_DISTANCE_DP,
  MIN_DISTANCE_DP,
  MIN_ZONE_EDGE,
  SWIPE_ACTIONS,
  SWIPE_ACTION_LABELS,
  TOUCH_ACTIONS,
  TOUCH_ACTION_LABELS,
  TOUCH_ZONE_PREFS,
  applyZoneDrag,
  createTouchZone,
  decodeZones,
  encodeZones,
  makeUuid,
  normalizeTouchZones,
  normalizeZone,
  swipeGuideSign,
  touchZoneJson,
  zoneContains,
  zoneHit,
  zoneTapAction,
} from '@core/reader/touchZones';

/** Kotlin `Float.coerceIn(min, max)` —— 编辑器内部夹紧（模型侧同名函数未导出）。 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/* ══════════════════════════════════════════════════════════════════════════════
   DesignTokens (ui/design/DesignTokens.kt) — the reader-chrome subset this file uses
   ══════════════════════════════════════════════════════════════════════════════ */

const HAIRLINE = 1; // DesignTokens.Hairline
const STROKE_STRONG = 3; // DesignTokens.StrokeStrong
const SPACE_XS = 4; // DesignTokens.SpaceXs
const SPACE_COMPACT = 6; // DesignTokens.SpaceCompact
const SPACE_SM = 8; // DesignTokens.SpaceSm
const SPACE_XXL = 24; // DesignTokens.SpaceXxl — corner-knob hit radius (L170)
const CARD_ELEVATION = 2; // DesignTokens.CardElevation
const TYPE_CAPTION = 12; // DesignTokens.TypeCaption
const RANGE_ENDPOINT_HIT = 22; // TouchZoneEditor.kt L175 `22.dp.toPx()`
const CALIBRATION_MIN_SAMPLE = 12; // L206 `sample >= 12f`
const TAP_SLOP_PX = 8; // `detectTapGestures` touch slop (ViewConfiguration default)
const LABEL_OFFSET_DP = 80; // L128 `-80f * pixelDensity`
const LABEL_MIN_TOP_DP = 12; // L128 `+12f * pixelDensity`
const LABEL_MIN_WIDTH_DP = 120; // L123 `max(120f * pixelDensity, …)`

/* ══════════════════════════════════════════════════════════════════════════════
   Props
   ══════════════════════════════════════════════════════════════════════════════ */

export interface TouchZoneEditorProps {
  /** Kotlin `zones: List<TouchZone>?` — persisted value (`null` = never customised). */
  zones: TouchZoneConfig;
  /** Kotlin `defaults: List<TouchZone>`. */
  defaults: readonly TouchZone[];
  /** Kotlin `defaultDistanceDp: Float` — the reader's own threshold. */
  defaultDistanceDp: number;
  /** Kotlin `comic: Boolean = false` — hides `听书`. */
  comic?: boolean;
  /** Kotlin `vertical: Boolean = false` — vertical swipe axis. */
  vertical?: boolean;
  /** Kotlin `onSave: (List<TouchZone>?) -> Unit`. */
  onSave: (zones: TouchZoneConfig) => void;
  /** Kotlin `onDismiss: () -> Unit`. */
  onDismiss: () => void;
  /** Kotlin `resetZones: List<TouchZone> = defaults`. */
  resetZones?: readonly TouchZone[];
  /** Kotlin `onRestoreDefault: () -> Unit = {}`. */
  onRestoreDefault?: () => void;
  /** Kotlin `onPreview: (List<TouchZone>?, Boolean) -> Unit = { _, _ -> }`. */
  onPreview?: (zones: TouchZoneConfig, trying: boolean) => void;
  /** Kotlin `reverse: Boolean = false` — RTL guide direction. */
  reverse?: boolean;
  /** Kotlin `viewportInWindow: Rect?` — CSS px rect of the real reader viewport. */
  viewport?: { left: number; top: number; width: number; height: number } | null;
  /** Test seam for `UUID.randomUUID()`. */
  makeZoneId?: () => string;
  /** Theme accents (Kotlin `MaterialTheme.colorScheme`). */
  primary?: string;
  secondary?: string;
  surface?: string;
  /** Kotlin `LocalReduceMotion.current` — disables the guide loop. */
  reduceMotion?: boolean;
}

/** The value `onPreview` reports when the editor closes (Kotlin L82). */
export const PREVIEW_NONE: TouchZoneConfig = null;

/* ══════════════════════════════════════════════════════════════════════════════
   TouchZoneEditor — Kotlin L49-295
   ══════════════════════════════════════════════════════════════════════════════ */

export function TouchZoneEditor(props: TouchZoneEditorProps): ReactElement {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const surface = props.surface ?? '#FFFFFF';
  const reduceMotion = props.reduceMotion === true;
  const resetZones = props.resetZones ?? props.defaults;

  // Kotlin L60-72
  const [draft, setDraft] = useState<TouchZoneConfig>(props.zones);
  const [resetRequested, setResetRequested] = useState(false);
  const visible: readonly TouchZone[] = draft ?? (resetRequested ? resetZones : props.defaults);
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id ?? null);
  const selected = visible.find((zone) => zone.id === selectedId) ?? null;
  const range = selected?.distanceDp ?? props.defaultDistanceDp;
  const [calibrating, setCalibrating] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [sample, setSample] = useState(0);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [toolsAtTop, setToolsAtTop] = useState(false);
  const [trying, setTrying] = useState(false);
  const [layerSize, setLayerSize] = useState({ width: 0, height: 0 });

  const layerRef = useRef<HTMLDivElement | null>(null);
  const sampleRef = useRef(0);
  const dragRef = useRef<{
    zone: TouchZone;
    handle: number;
    pointerId: number;
    clientX: number;
    clientY: number;
    measuring: boolean;
    multi: boolean;
  } | null>(null);
  const pointersRef = useRef<Set<number>>(new Set<number>());

  // Kotlin L80 `rememberUpdatedState(onPreview)` / L83 `onDismiss` captured by the handler.
  const previewRef = useRef(props.onPreview);
  const dismissRef = useRef(props.onDismiss);
  useEffect(() => {
    previewRef.current = props.onPreview;
    dismissRef.current = props.onDismiss;
  });

  // Kotlin L78 `fun edit(zone)` — `visible.map { if (it.id == zone.id) zone.normalized() else it }`.
  const edit = (zone: TouchZone): void => {
    setDraft(visible.map((item) => (item.id === zone.id ? normalizeZone(zone) : item)));
  };

  // Kotlin L79 `fun startCalibration()`.
  const startCalibration = (): void => {
    setTrying(false);
    setCalibrating(true);
    setCompleted(false);
    setSample(0);
    sampleRef.current = 0;
    setControlsExpanded(false);
  };

  // Kotlin L81 `LaunchedEffect(draft, trying, resetRequested) { onPreview(if (resetRequested && draft == null) resetZones else draft, trying) }`
  useEffect(() => {
    previewRef.current?.(resetRequested && draft === null ? resetZones : draft, trying);
  }, [draft, resetRequested, resetZones, trying]);

  // Kotlin L82 `DisposableEffect(Unit) { onDispose { onPreview(null, false) } }`
  useEffect(() => {
    return () => {
      previewRef.current?.(null, false);
    };
  }, []);

  // Kotlin L83 `BackHandler { if (trying) trying = false else onDismiss() }`
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (trying) setTrying(false);
      else dismissRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [trying]);

  // Kotlin L85 `onGloballyPositioned { origin = it.positionInWindow() }` → the layer is the
  // coordinate origin here, so only its size is needed (for the calibration art + label clamp).
  useEffect(() => {
    const element = layerRef.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setLayerSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [trying]);

  const editZoneById = (id: string, next: TouchZone): void => {
    setDraft(visible.map((item) => (item.id === id ? normalizeZone(next) : item)));
  };

  /** Kotlin L166-176 — corner knobs first, then the range endpoint (handle `4`). */
  const detectHandle = (zone: TouchZone, pointX: number, pointY: number, width: number, height: number): number => {
    const corners: readonly (readonly [number, number])[] = [
      [zone.left * width, zone.top * height],
      [zone.right * width, zone.top * height],
      [zone.left * width, zone.bottom * height],
      [zone.right * width, zone.bottom * height],
    ];
    for (let index = 0; index < corners.length; index += 1) {
      const corner = corners[index];
      if (corner === undefined) continue;
      if (Math.hypot(corner[0] - pointX, corner[1] - pointY) < SPACE_XXL) return index;
    }
    const vertical = props.vertical === true;
    const barLength = zone.distanceDp ?? props.defaultDistanceDp;
    const barStartX = ((zone.left + zone.right) / 2) * width - (vertical ? 0 : barLength / 2);
    const barStartY = ((zone.top + zone.bottom) / 2) * height - (vertical ? barLength / 2 : 0);
    const endX = barStartX + (vertical ? 0 : barLength);
    const endY = barStartY + (vertical ? barLength : 0);
    if (zone.swipe === 'PAGE' && Math.hypot(pointX - endX, pointY - endY) < RANGE_ENDPOINT_HIT) {
      return 4;
    }
    return -1;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointersRef.current.add(event.pointerId);
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const previousSelected = selectedId;
    // Kotlin L156/L163 — during calibration only the selected zone is hit-testable.
    const hit = calibrating
      ? (visible.find((zone) => zone.id === previousSelected && zoneContains(zone, x, y)) ?? null)
      : zoneHit(visible, x, y);
    // Kotlin L157/L164 — selection happens on both the tap and the drag path.
    if (hit === null) {
      dragRef.current = null;
      return;
    }
    setSelectedId(hit.id);
    const measuring = calibrating && hit.id === previousSelected;
    dragRef.current = {
      zone: hit,
      handle: measuring
        ? -1
        : detectHandle(hit, event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height),
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      measuring,
      multi: false,
    };
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    if (pointersRef.current.size > 1) drag.multi = true;
    if (drag.multi) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dxPx = event.clientX - drag.clientX;
    const dyPx = event.clientY - drag.clientY;
    const dx = dxPx / rect.width;
    const dy = dyPx / rect.height;
    if (drag.measuring) {
      // Kotlin L185 `sample = dragTotal.getDistance() / pixelDensity`
      const next = Math.hypot(dxPx, dyPx);
      sampleRef.current = next;
      setSample(next);
      return;
    }
    if (drag.handle === 4) {
      // Kotlin L187-188 `amount = if (vertical) dy * viewportHeight else dx * viewportWidth`
      const amount = props.vertical === true ? dy * rect.height : dx * rect.width;
      const next = clamp(
        (drag.zone.distanceDp ?? props.defaultDistanceDp) + amount * 2,
        MIN_DISTANCE_DP,
        MAX_DISTANCE_DP,
      );
      editZoneById(drag.zone.id, { ...drag.zone, distanceDp: next });
      return;
    }
    editZoneById(drag.zone.id, applyZoneDrag(drag.zone, drag.handle, dx, dy));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointersRef.current.delete(event.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null) return;
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (drag.measuring) {
      // Kotlin L206-210 — commit the measured trip, then leave calibration mode.
      const measured = sampleRef.current;
      if (!drag.multi && measured >= CALIBRATION_MIN_SAMPLE) {
        editZoneById(drag.zone.id, {
          ...drag.zone,
          distanceDp: clamp(measured, MIN_DISTANCE_DP, MAX_DISTANCE_DP),
        });
        setCalibrating(false);
        setCompleted(true);
      }
      return;
    }
    if (!drag.multi && moved < TAP_SLOP_PX) {
      // Kotlin L157 `if (hit != null) { selectedId = hit.id; controlsExpanded = !currentCalibration }`
      setControlsExpanded(!calibrating);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointersRef.current.delete(event.pointerId);
    dragRef.current = null;
    sampleRef.current = 0;
    setSample(0);
  };

  /** Kotlin L239 — save, or leave try-out mode. */
  const saveOrBack = (): void => {
    if (trying) {
      setTrying(false);
      return;
    }
    previewRef.current?.(null, false);
    if (resetRequested) props.onRestoreDefault?.();
    props.onSave(draft);
    props.onDismiss();
  };

  /** Kotlin L249 — `val added = TouchZone(); draft = visible + added; selectedId = added.id; startCalibration()`. */
  const addZone = (): void => {
    const id = (props.makeZoneId ?? makeUuid)();
    const added = createTouchZone(id);
    setDraft([...visible, added]);
    setSelectedId(added.id);
    startCalibration();
  };

  const subtitle = trying
    ? tr('使用未保存的分区，可直接翻页')
    : calibrating
      ? tr('试着用自己最舒适的方式滑动一页')
      : completed
        ? tr('✓ 已记住你的手势 · 可继续微调')
        : tr('原尺寸阅读画面 · 拖动移动 / 四角缩放');

  const toolsTop = toolsAtTop && !trying;
  const layerStyle: CSSProperties =
    props.viewport === null || props.viewport === undefined
      ? {}
      : {
          left: props.viewport.left,
          top: props.viewport.top,
          width: props.viewport.width,
          height: props.viewport.height,
        };
  const themeVars = {
    '--tze-primary': primary,
    '--tze-secondary': secondary,
    '--tze-surface': surface,
  } as CSSProperties;

  return (
    <div className="tze" role="dialog" aria-modal="true" aria-label={tr('自定义触控分区')} style={themeVars}>
      {/* Kotlin L92 `Box(background(Color.Black.copy(alpha = dim)))` */}
      <div
        className="tze__dim"
        style={{ opacity: trying ? 0 : 0.17 }}
        aria-hidden="true"
        data-testid="tze_dim"
      />

      {trying ? null : (
        <>
          {/* Kotlin L93-99 — sibling shield; never an ancestor gesture interceptor. */}
          <div className="tze__shield" aria-hidden="true" />
          <div
            ref={layerRef}
            className="tze__layer"
            style={layerStyle}
            role="group"
            aria-label={tr('真实阅读区域：拖动区域移动，四角缩放；校准时在选中区域滑动')}
            data-testid="tze_layer"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            {visible.map((zone, index) => (
              <ZoneRect
                key={zone.id}
                zone={zone}
                index={index}
                active={zone.id === selectedId}
                primary={primary}
                surface={surface}
                reduceMotion={reduceMotion}
                width={layerSize.width}
                height={layerSize.height}
              />
            ))}
            {selected !== null && selected.swipe === 'PAGE' ? (
              <SwipeCalibrationArt
                zone={selected}
                distance={range}
                vertical={props.vertical === true}
                width={layerSize.width}
                height={layerSize.height}
                guiding={calibrating}
                complete={completed}
                sample={sample}
                reverse={props.reverse === true}
                reduceMotion={reduceMotion}
                primary={primary}
                secondary={secondary}
                surface={surface}
              />
            ) : null}
          </div>
        </>
      )}

      {/* Kotlin L223-243 — top tool bar. */}
      <div
        className={[
          'tze__bar',
          'tze__bar--primary',
          toolsTop ? 'tze__bar--top' : 'tze__bar--bottom',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="tze__bar-row">
          {trying ? null : (
            <AppIconButton onClick={props.onDismiss} className="tze__close">
              <span className="tze__sr-only">{tr('取消编辑')}</span>
              <CloseIcon />
            </AppIconButton>
          )}
          <div className="tze__bar-titles">
            <p className="tze__bar-title">{trying ? tr('正在真实试读') : tr('自定义触控分区')}</p>
            <p className="tze__bar-subtitle">{subtitle}</p>
          </div>
          <AppButton variant="tertiary" size="sm" onClick={saveOrBack}>
            {trying ? tr('返回编辑') : tr('保存')}
          </AppButton>
        </div>
      </div>

      {/* Kotlin L244-293 — bottom tool bar. */}
      {trying ? null : (
        <div
          className={[
            'tze__bar',
            'tze__bar--tools',
            toolsAtTop ? 'tze__bar--top' : 'tze__bar--bottom',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="tze__bar-row tze__bar-row--actions">
            <AppButton
              size="sm"
              variant="secondary"
              disabled={visible.length >= TOUCH_ZONE_PREFS.maxZones}
              onClick={addZone}
            >
              {tr('添加分区')}
            </AppButton>
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => {
                setControlsExpanded(!controlsExpanded);
              }}
            >
              {controlsExpanded ? tr('收起工具') : tr('设置功能')}
            </AppButton>
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => {
                setCalibrating(false);
                setControlsExpanded(false);
                setTrying(true);
              }}
            >
              {tr('试读')}
            </AppButton>
            <AppIconButton
              onClick={() => {
                setToolsAtTop(!toolsAtTop);
              }}
              className="tze__swap"
            >
              <span className="tze__sr-only">{tr('工具移到另一侧')}</span>
              <SwapVertIcon />
            </AppIconButton>
          </div>

          {/* Kotlin L258 `PullOutVisibility(visible = controlsExpanded)`：收起时不可聚焦、不可读屏，
              但仍然保留在 DOM 里，让 `grid-template-rows` 的展开/收起有内容可动画。 */}
          <div
            className={controlsExpanded ? 'tze__controls tze__controls--open' : 'tze__controls'}
            inert={!controlsExpanded}
            aria-hidden={!controlsExpanded}
          >
            <div className="tze__controls-inner">
              {selected !== null ? (
                <>
                  <div className="tze__row">
                    <span className="tze__section-title">
                      分区 {visible.findIndex((zone) => zone.id === selected.id) + 1}
                    </span>
                    <AppButton
                      size="sm"
                      variant="tertiary"
                      onClick={() => {
                        setDraft([
                          ...visible.filter((zone) => zone.id !== selected.id),
                          selected,
                        ]);
                      }}
                    >
                      {tr('置顶')}
                    </AppButton>
                    <AppIconButton
                      onClick={() => {
                        const next = visible.filter((zone) => zone.id !== selected.id);
                        setDraft(next);
                        setSelectedId(next[next.length - 1]?.id ?? null);
                        setCalibrating(false);
                      }}
                      className="tze__delete"
                    >
                      <span className="tze__sr-only">{tr('删除分区')}</span>
                      <DeleteIcon />
                    </AppIconButton>
                  </div>

                  <p className="tze__label">{tr('点击行为')}</p>
                  <ActionChoices
                    items={TOUCH_ACTIONS.filter(
                      (action) => props.comic !== true || action !== 'LISTEN',
                    )}
                    selected={selected.tap}
                    labelOf={(action) => TOUCH_ACTION_LABELS[action]}
                    onChoose={(action) => {
                      edit({ ...selected, tap: action });
                    }}
                  />

                  <p className="tze__label">{tr('滑动行为')}</p>
                  <ActionChoices
                    items={SWIPE_ACTIONS}
                    selected={selected.swipe}
                    labelOf={(action) => SWIPE_ACTION_LABELS[action]}
                    onChoose={(action) => {
                      edit({ ...selected, swipe: action });
                      if (action === 'PAGE') startCalibration();
                      else setCalibrating(false);
                    }}
                  />

                  {selected.swipe === 'PAGE' ? (
                    <>
                      <p className="tze__range-caption" data-testid="tze_range_caption">
                        {selected.distanceDp === null
                          ? tr('沿用原有阅读器判定 · 校准快速完成距离')
                          : `触发距离 ${String(Math.round(range))} dp`}
                      </p>
                      <div className="tze__range-track">
                        <span
                          className="tze__range-fill"
                          aria-hidden="true"
                          style={{
                            width: `${String(
                              ((clamp(range, MIN_DISTANCE_DP, MAX_DISTANCE_DP) -
                                MIN_DISTANCE_DP) /
                                (MAX_DISTANCE_DP - MIN_DISTANCE_DP)) *
                                100,
                            )}%`,
                          }}
                        />
                        <input
                          className="tze__range"
                          type="range"
                          min={MIN_DISTANCE_DP}
                          max={MAX_DISTANCE_DP}
                          step={1}
                          value={clamp(range, MIN_DISTANCE_DP, MAX_DISTANCE_DP)}
                          aria-label="触发距离"
                          aria-valuetext={`${String(Math.round(range))} dp`}
                          onChange={(event) => {
                            edit({ ...selected, distanceDp: Number(event.currentTarget.value) });
                            setCompleted(false);
                          }}
                        />
                      </div>
                      <p className="tze__hint">
                        {tr('仅调整快速翻页的完成距离；慢速拖角、卷起与回退保持原样，滑动不限方向。')}
                      </p>
                      <AppButton size="sm" variant="tertiary" onClick={startCalibration}>
                        {tr('重新校准')}
                      </AppButton>
                    </>
                  ) : null}
                </>
              ) : null}

              <p className="tze__hint">
                {tr('后添加 / 置顶区域优先；空白区域不操作。点击和滑动独立，双指缩放优先。')}
              </p>
              <AppButton
                size="sm"
                variant="tertiary"
                onClick={() => {
                  setDraft(null);
                  setResetRequested(true);
                  setSelectedId(resetZones[0]?.id ?? null);
                  setCalibrating(false);
                  setCompleted(false);
                }}
              >
                {tr('恢复原有默认')}
              </AppButton>
            </div>
          </div>

          {!controlsExpanded && selected !== null && selected.swipe === 'PAGE' ? (
            <div className="tze__row tze__range-row">
              <span className="tze__range-caption tze__range-caption--row">
                {calibrating && sample >= CALIBRATION_MIN_SAMPLE
                  ? `本次 ${String(Math.round(sample))} dp`
                  : selected.distanceDp === null
                    ? tr('原有判定 · 可拖动范围条端点')
                    : `触发距离 ${String(Math.round(range))} dp`}
              </span>
              <AppButton
                size="sm"
                variant="tertiary"
                onClick={() => {
                  if (calibrating) setCalibrating(false);
                  else startCalibration();
                }}
              >
                {calibrating ? tr('手动调整') : tr('重新校准')}
              </AppButton>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Kotlin L297-303 `ActionChoices` — FlowRow of FilterChips. ── */
function ActionChoices<T extends string>(props: {
  items: readonly T[];
  selected: T;
  labelOf: (item: T) => string;
  onChoose: (item: T) => void;
}): ReactElement {
  return (
    <div className="tze__choices">
      {props.items.map((item) => (
        <CategoryPill
          key={item}
          label={props.labelOf(item)}
          selected={item === props.selected}
          onClick={() => {
            props.onChoose(item);
          }}
        />
      ))}
    </div>
  );
}

/* ── Kotlin L102-132 — zone rectangle (fill + 3dp white stroke + 1dp accent hairline),
       4 corner knobs, and the two-line label overlay. ── */
function ZoneRect(props: {
  zone: TouchZone;
  index: number;
  active: boolean;
  primary: string;
  surface: string;
  reduceMotion: boolean;
  width: number;
  height: number;
}): ReactElement {
  const { zone, active } = props;
  const label = `${String(props.index + 1)} · ${TOUCH_ACTION_LABELS[zone.tap]}\n${SWIPE_ACTION_LABELS[zone.swipe]}`;
  const zoneWidthPx = (zone.right - zone.left) * props.width;
  // Kotlin L123 `max(120f * density, min(viewport.width * .8f, (r-l) * viewport.width - 16f * density))`
  const labelWidth = Math.max(LABEL_MIN_WIDTH_DP, Math.min(props.width * 0.8, zoneWidthPx - 16));
  const centerX = ((zone.left + zone.right) / 2) * props.width;
  const labelLeft = Math.min(
    Math.max(centerX - labelWidth / 2, 0),
    Math.max(props.width - labelWidth, 0),
  );
  // Kotlin L128 `((t+b)*.5*viewport.height) - 80dp`, floored at `t*viewport.height + 12dp`
  const centerY = ((zone.top + zone.bottom) / 2) * props.height;
  const labelTop = Math.max(zone.top * props.height + LABEL_MIN_TOP_DP, centerY - LABEL_OFFSET_DP);
  const corners: readonly (readonly [number, number])[] = [
    [zone.left, zone.top],
    [zone.right, zone.top],
    [zone.left, zone.bottom],
    [zone.right, zone.bottom],
  ];

  return (
    <>
      <div
        className={active ? 'tze__zone tze__zone--active' : 'tze__zone'}
        style={{
          left: `${String(zone.left * 100)}%`,
          top: `${String(zone.top * 100)}%`,
          width: `${String((zone.right - zone.left) * 100)}%`,
          height: `${String((zone.bottom - zone.top) * 100)}%`,
          // Kotlin L114 `.025f + active * .065f`
          background: withAlpha(props.primary, 0.025 + (active ? 0.065 : 0)),
          borderColor: withAlpha('#FFFFFF', 0.42),
          borderWidth: STROKE_STRONG,
          // Kotlin L116 `primary@(.5f + active * .5f)` hairline, inside the 3dp white ring
          boxShadow: `inset 0 0 0 ${String(HAIRLINE)}px ${withAlpha(props.primary, active ? 1 : 0.5)}`,
          transition: props.reduceMotion ? 'none' : undefined,
        }}
        data-testid={`tze_zone_${String(props.index)}`}
        aria-hidden="true"
      />
      {active
        ? corners.map(([x, y], index) => (
            <span
              key={`knob-${String(index)}`}
              className="tze__knob"
              aria-hidden="true"
              style={{
                left: `${String(x * 100)}%`,
                top: `${String(y * 100)}%`,
                background: props.surface,
                borderColor: props.primary,
                borderWidth: STROKE_STRONG,
              }}
            />
          ))
        : null}
      {/* Kotlin L124-131 — labels are overlays so narrow edge regions keep their true size.
          Rendered unconditionally: before the first measurement the layer has no size and the
          overlay is simply invisible, never removed (that would flash the label away). */}
      <span
        className="tze__zone-label"
        aria-hidden="true"
        style={{
          left: labelLeft,
          top: labelTop,
          width: labelWidth,
          fontSize: TYPE_CAPTION,
          padding: SPACE_COMPACT,
          color: '#FFFFFF',
          background: withAlpha('#000000', 0.5),
        }}
      >
        {label}
      </span>
    </>
  );
}

/* ── Kotlin L305-387 `SwipeCalibrationArt` — decoration only, never intercepts pointers. ── */
function SwipeCalibrationArt(props: {
  zone: TouchZone;
  distance: number;
  vertical: boolean;
  width: number;
  height: number;
  guiding: boolean;
  complete: boolean;
  sample: number;
  reverse: boolean;
  reduceMotion: boolean;
  primary: string;
  secondary: string;
  surface: string;
}): ReactElement | null {
  if (props.width <= 0 || props.height <= 0) return null;
  const { zone, vertical, width, height, primary, secondary, surface } = props;
  const centerX = ((zone.left + zone.right) / 2) * width;
  const centerY = ((zone.top + zone.bottom) / 2) * height;
  // Kotlin L329-330 `axisScale = size.height / viewportH` (or width) and `length = distance * axisScale`.
  // The layer *is* the viewport in this port, so the scale degenerates to 1 and dp ≙ px.
  const length = props.distance;
  const axisX = vertical ? 0 : 1;
  const axisY = vertical ? 1 : 0;
  const startX = centerX - axisX * (length / 2);
  const startY = centerY - axisY * (length / 2);
  const endX = centerX + axisX * (length / 2);
  const endY = centerY + axisY * (length / 2);
  // Kotlin L345 `normal = if (vertical) Offset(1f, 0f) else Offset(0f, -1f)`
  const normalX = vertical ? 1 : 0;
  const normalY = vertical ? 0 : -1;
  const bidirectional = zone.tap !== 'PREVIOUS' && zone.tap !== 'NEXT';
  const actions: readonly TouchAction[] = bidirectional ? ['PREVIOUS', 'NEXT'] : [zone.tap];

  return (
    <svg
      className={props.reduceMotion ? 'tze__art tze__art--still' : 'tze__art'}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      aria-hidden="true"
      focusable="false"
      data-testid="tze_art"
    >
      {/* Kotlin L334-335 — accent rail + halo. */}
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={withAlpha(primary, 0.12)}
        strokeWidth={14}
        strokeLinecap="round"
      />
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={withAlpha(primary, 0.7)}
        strokeWidth={STROKE_STRONG}
        strokeLinecap="round"
      />
      {/* Kotlin L336-337 — start / end knobs. */}
      <circle cx={startX} cy={startY} r={SPACE_COMPACT} fill={surface} />
      <circle
        cx={startX}
        cy={startY}
        r={SPACE_COMPACT}
        fill="none"
        stroke={primary}
        strokeWidth={STROKE_STRONG}
      />
      <circle cx={endX} cy={endY} r={props.complete ? 9 : 7} fill={surface} />
      <circle cx={endX} cy={endY} r={SPACE_XS} fill="none" stroke={primary} strokeWidth={SPACE_XS} />

      {/* Kotlin L338-343 — completion flash + success ring. */}
      {props.complete ? (
        <>
          <circle
            className="tze__flash"
            cx={endX}
            cy={endY}
            r={20}
            fill="none"
            stroke={withAlpha(secondary, 0.24)}
            strokeWidth={CARD_ELEVATION}
          />
          <circle
            className="tze__success"
            cx={endX}
            cy={endY}
            r={18}
            fill="none"
            stroke={withAlpha(secondary, 0.16)}
            strokeWidth={CARD_ELEVATION}
          />
        </>
      ) : null}

      {/* Kotlin L344-362 — the two physical directions, labelled (`上一页` / `下一页`). */}
      {actions.map((action, index) => {
        const sign = swipeGuideSign(action, props.reverse);
        const laneOffset = index === 0 ? 22 : -22;
        const laneX = centerX + normalX * laneOffset;
        const laneY = centerY + normalY * laneOffset;
        const headX = laneX + axisX * ((sign * length) / 2);
        const headY = laneY + axisY * ((sign * length) / 2);
        const tailX = laneX - axisX * ((sign * length) / 2);
        const tailY = laneY - axisY * ((sign * length) / 2);
        return (
          <g key={`guide-${action}`}>
            <path
              d={`M ${String(tailX)} ${String(tailY)} Q ${String(centerX + normalX * SPACE_SM)} ${String(
                centerY + normalY * SPACE_SM,
              )} ${String(headX)} ${String(headY)}`}
              fill="none"
              stroke={withAlpha(primary, 0.5)}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="4 5"
            />
            <path
              d={`M ${String(headX)} ${String(headY)} L ${String(
                headX - axisX * sign * 7 + normalX * 4,
              )} ${String(headY - axisY * sign * 7 + normalY * 4)}`}
              fill="none"
              stroke={primary}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <path
              d={`M ${String(headX)} ${String(headY)} L ${String(
                headX - axisX * sign * 7 - normalX * 4,
              )} ${String(headY - axisY * sign * 7 - normalY * 4)}`}
              fill="none"
              stroke={primary}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <text
              x={laneX + normalX * 12}
              y={laneY + normalY * 12}
              fill={primary}
              fontSize={11}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {TOUCH_ACTION_LABELS[action]}
            </text>
          </g>
        );
      })}

      {/* Kotlin L363-385 — demo swipe loop (`tween(2200)` + `delay(450)`), one per direction. */}
      {props.guiding
        ? actions.map((action, index) => {
            const sign = swipeGuideSign(action, props.reverse);
            const startDemoX = centerX - axisX * sign * (length / 2);
            const startDemoY = centerY - axisY * sign * (length / 2);
            const tipX = startDemoX + axisX * sign * length;
            const tipY = startDemoY + axisY * sign * length;
            return (
              <g key={`demo-${action}`}>
                <path
                  className={index === 0 ? 'tze__demo tze__demo--a' : 'tze__demo tze__demo--b'}
                  d={`M ${String(startDemoX)} ${String(startDemoY)} C ${String(
                    startDemoX + axisX * sign * length * 0.32 + normalX * 7,
                  )} ${String(startDemoY + axisY * sign * length * 0.32 + normalY * 7)} ${String(
                    tipX - axisX * sign * length * 0.15 + normalX * 5,
                  )} ${String(tipY - axisY * sign * length * 0.15 + normalY * 5)} ${String(tipX)} ${String(
                    tipY,
                  )}`}
                  fill="none"
                  stroke={primary}
                  strokeWidth={CARD_ELEVATION}
                  strokeLinecap="round"
                  strokeDasharray={`${String(SPACE_XS)} 5`}
                />
                <circle cx={tipX} cy={tipY} r={SPACE_XS} fill={withAlpha(primary, 0.7)} />
              </g>
            );
          })
        : null}

      {/* Kotlin L384 — live measurement read-out (`secondary` stroke, `sample * axisScale`). */}
      {props.sample > 0 ? (
        <line
          x1={centerX - axisX * (props.sample / 2)}
          y1={centerY - axisY * (props.sample / 2)}
          x2={centerX + axisX * (props.sample / 2)}
          y2={centerY + axisY * (props.sample / 2)}
          stroke={secondary}
          strokeWidth={CARD_ELEVATION}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function SwapVertIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden="true">
      <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
    </svg>
  );
}

function DeleteIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

export default TouchZoneEditor;
/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/WenkuCoverFlight.kt`
 *   L81-92    WENKU_MESH_COLUMNS / ROWS / EDGE_SAMPLES / PI_F / BACKING_ARGB → WENKU_FLIGHT（tokens.ts）
 *   L99-117   WenkuFlightRect（width/height/center/inflate/shift）          → FlightRect 工具函数
 *   L132-333  object WenkuFlightPose（bezier/easeInOutCubic/easeOutCubic/easeInOut/heroClock/
 *             smooth/travel/heroTimeline/depthAt/lift/roll/columnInset/radiusX/radiusY/
 *             meshRows/bendPoints/rectAt）                                  → 同名导出
 *   L350-383  object WenkuPlanePose（ease/offsetX/offsetY/slant/viewportPoints） → planeEase 等
 *   L389-406  WenkuPaperMesh.fill                                        → paperMeshPositions
 *   L426-513  WenkuCoverFlight 的 begin/end/时长选择                      → coverFlightBegin / coverFlightDurationMs
 *   L516-617  WenkuCoverArrivalFrame（ready/presented/started 三态）        → coverArrivalRenderState /
 *                                                                          coverArrivalStart
 *   L621-635  WenkuCoverArrivalCache                                      → CoverArrivalCache
 *   L648-788  drawWenkuCoverFlight（scrim/lift/roll/opacity/圆角/网格）     → coverFlightFramePlan
 *   L791-811  wenkuCoverSilhouette                                       → 计划里的 occlusion
 *   L814-840  wenkuPaperFlight（lift/roll 半强度）                         → paperFlightTransform
 * `ui/wenku/WenkuFlightBridge.kt`
 *   L26-41    WenkuFlightRequest                                          → CoverFlightRequest（types.ts）
 *   L44-91    object WenkuFlightBridge（begin/arrive/reverse/finished/cancel） → coverFlightBegin / coverFlightArrive /
 *                                                                          coverFlightReverse / coverFlightFinished /
 *                                                                          coverFlightCancel
 *   L94-104   fitWenkuCover                                               → coverArt.fitWenkuCover
 *   L114-135  cropCoverToAspect                                           → coverArt.cropCoverToAspectPlan
 *   L139-198  WenkuFlightOverlay（viewport→bounds、shelfBounds 选择）      → coverFlightLayout
 * `ui/wenku/WenkuVolumeFlight.kt`
 *   L41-55    WenkuVolumeFlightRequest                                    → VolumeFlightRequest（types.ts）
 *   L57-145   WenkuVolumeFlightBridge（begin/reverse/publish/finished/cancel/awaitIdle）
 *                                                                          → volumeFlightBegin / volumeFlightReverse /
 *                                                                            volumeFlightPublish / volumeFlightFinished /
 *                                                                            volumeFlightCancel / volumeFlightIdle
 *   L153-244  drawFlightVolume + poseAt 调用 + 归位 alphaOverride          → volumeFlightPose / closeFadeAlpha
 *   L247-250  ARRIVE_P / CLOSE_FADE_IN                                    → WENKU_VOLUME_FLIGHT（tokens.ts）
 *
 * 未移植（Canvas / 协程 / 组合运行时）：
 * - `drawBitmapMesh` / `saveLayer` / `PorterDuffXfermode(DST_OUT)` / `Path.addRoundRect`：
 *   计划里输出网格顶点、圆角半径、轮廓矩形与 alpha，UI 用同一套 API 自绘。
 * - `Animatable.animateTo`、`LaunchedEffect`、`withFrameNanos`、`delay(16)` 的 `awaitIdle` 轮询：
 *   本层输出目标时长与每帧计划；轮询改为 `volumeFlightIdle(state, bookKey)` 判定。
 * - `WenkuFlightBridge.arrive` 之外的路由时序（`readerBookKey` / `delay(COVER_FLIGHT_MS + 240)`）。
 */

import {
  fitWenkuCover,
  cropCoverToAspectPlan,
} from './coverArt';
import { clamp, cubicBezier, easeCurve, roundToInt, truncToInt } from './motion';
import {
  CLOSE_MS,
  fillScale,
  OPEN_MS,
  poseAt,
} from './volumeRender';
import {
  WENKU_FLIGHT,
  WENKU_MOTION,
  WENKU_VOLUME_FLIGHT,
} from './tokens';
import type {
  BitmapSize,
  CoverFlightFramePlan,
  CoverFlightRequest,
  CoverFlightSource,
  CoverFlightTarget,
  CoverFlightState,
  FlightRect,
  RectF,
  ShelfVolumeArt,
  ShelfVolumePose,
  Size2,
  Vec2,
  VolumeFlightRequest,
  VolumeFlightState,
} from './types';

const PI_F = WENKU_FLIGHT.piFloat;

/* ───────────────────────────── 矩形工具 ───────────────────────────── */

export function flightRect(left: number, top: number, right: number, bottom: number): FlightRect {
  return { left, top, right, bottom };
}

export function rectWidth(rect: FlightRect | RectF): number {
  return rect.right - rect.left;
}

export function rectHeight(rect: FlightRect | RectF): number {
  return rect.bottom - rect.top;
}

export function rectCenterX(rect: FlightRect | RectF): number {
  return (rect.left + rect.right) * 0.5;
}

export function rectCenterY(rect: FlightRect | RectF): number {
  return (rect.top + rect.bottom) * 0.5;
}

export function inflateRect(rect: FlightRect, delta: number): FlightRect {
  return {
    left: rect.left - delta,
    top: rect.top - delta,
    right: rect.right + delta,
    bottom: rect.bottom + delta,
  };
}

export function shiftRect(rect: FlightRect, dx: number, dy: number): FlightRect {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
  };
}

function toSize(rect: RectF): Size2 {
  return { width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/* ───────────────────────────── WenkuFlightPose ───────────────────────────── */

/** `WenkuFlightPose.bezier`：20 步二分解 x。 */
export function bezier(x1: number, y1: number, x2: number, y2: number, value: number): number {
  return cubicBezier(x1, y1, x2, y2)(value);
}

export function easeInOutCubic(value: number): number {
  return bezier(0.645, 0.045, 0.355, 1, value);
}

export function easeOutCubic(value: number): number {
  return bezier(0.215, 0.61, 0.355, 1, value);
}

export function easeInOut(value: number): number {
  return bezier(0.42, 0, 0.58, 1, value);
}

/** `Cubic(.4, 0, .2, 1)`（`heroClock`）。 */
export function heroClock(value: number): number {
  return bezier(0.4, 0, 0.2, 1, value);
}

/** `_smooth`：`x²(3-2x)`。 */
export function flightSmooth(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

/** `travel(p) = easeInOutCubic(((p - .12) / .46).coerceIn(0, 1))`。 */
export function travel(progress: number): number {
  return easeInOutCubic(
    clamp(
      (progress - WENKU_FLIGHT.travelStart) / WENKU_FLIGHT.travelSpan,
      0,
      1,
    ),
  );
}

/** `heroTimeline`：对 `smooth` 求逆后代入 `Cubic(.4, 0, .2, 1)` 的 x 分量。 */
export function heroTimeline(value: number): number {
  if (value <= 0 || value >= 1) return clamp(value, 0, 1);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i += 1) {
    const parameter = (low + high) / 2;
    if (flightSmooth(parameter) < value) low = parameter;
    else high = parameter;
  }
  const t = (low + high) / 2;
  const remaining = 1 - t;
  return 1.2 * remaining * remaining * t + 0.6 * remaining * t * t + t * t * t;
}

/**
 * 纸页弯曲深度：`peel * floating * (17 + 7 sin(vπ) + 3 breeze sin(pπ))`。
 * `u` = 列（0..1）、`v` = 行（0..1）、`p` = 进度。
 */
export function depthAt(u: number, v: number, p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const row = clamp(v, 0, 1);
  const column = clamp(u, 0, 1);
  const peel = flightSmooth(
    (p - WENKU_FLIGHT.depthPeelStart - row * WENKU_FLIGHT.depthPeelSpan) /
      WENKU_FLIGHT.depthPeelSpan,
  );
  const landing = clamp(
    (p - WENKU_FLIGHT.depthLandingStart) / WENKU_FLIGHT.depthLandingSpan,
    0,
    1,
  );
  const contact = (1 - row) * 0.66 + column * 0.34;
  const floating = 1 - flightSmooth((landing - contact * 0.7) / 0.3);
  const breeze = Math.sin((row * 1.3 - p * 1.6) * PI_F * 2);
  return (
    peel *
    floating *
    (WENKU_FLIGHT.depthMax +
      WENKU_FLIGHT.depthRowWave * Math.sin(row * PI_F) +
      WENKU_FLIGHT.depthBreeze * breeze * Math.sin(p * PI_F))
  );
}

/** `lift(p) = 18 * smooth(p/.18) * (1 - smooth((p-.42)/.16))`。 */
export function lift(p: number): number {
  return 18 * flightSmooth(p / 0.18) * (1 - flightSmooth((p - 0.42) / 0.16));
}

/** `roll(p) = -.045 sin(πp) (1 - smooth((p-.42)/.16))`。 */
export function roll(p: number): number {
  return -0.045 * Math.sin(clamp(p, 0, 1) * PI_F) * (1 - flightSmooth((p - 0.42) / 0.16));
}

/** 圆角列的横向内缩：`corner = min(v, 1-v) / radiusY`。 */
export function columnInset(row: number, radiusX: number, radiusY: number): number {
  if (radiusY <= 0) return 0;
  const v = clamp(row, 0, 1);
  const corner = Math.min(v, 1 - v) / radiusY;
  if (corner >= 1) return 0;
  return radiusX * (1 - Math.sqrt(Math.max(0, 1 - (1 - corner) * (1 - corner))));
}

/** `radiusX = clamp(8 / 120, 0, .5)`。 */
export function radiusX(): number {
  return clamp(WENKU_FLIGHT.cornerInset / WENKU_FLIGHT.referenceFaceWidth, 0, 0.5);
}

/** `radiusY = clamp(8 / 164, 0, .5)`。 */
export function radiusY(): number {
  return clamp(WENKU_FLIGHT.cornerInset / WENKU_FLIGHT.referenceFaceHeight, 0, 0.5);
}

/** 网格行：32 等分 + 两端各 8 个圆角加密采样，去重后升序。 */
export function meshRows(radius: number): number[] {
  const r = clamp(radius, 0, 0.5);
  const rows = new Set<number>();
  for (let i = 0; i <= WENKU_FLIGHT.meshRows; i += 1) {
    rows.add(i / WENKU_FLIGHT.meshRows);
  }
  for (let i = 1; i <= WENKU_FLIGHT.meshEdgeSamples; i += 1) {
    const v = r * (1 - Math.cos((i / WENKU_FLIGHT.meshEdgeSamples) * (PI_F / 2)));
    rows.add(v);
    rows.add(1 - v);
  }
  return [...rows].sort((a, b) => a - b);
}

/** 每一行的内缩量（`bendPoints`）。 */
export function bendPoints(): { readonly v: number; readonly inset: number }[] {
  const rx = radiusX();
  const ry = radiusY();
  return meshRows(ry).map((v) => ({ v, inset: columnInset(v, rx, ry) }));
}

export interface RectAtInput {
  readonly begin: FlightRect;
  readonly end: FlightRect;
  readonly returning: boolean;
  readonly value: number;
  readonly endPaintOffsetX?: number;
  readonly endPaintOffsetY?: number;
  readonly heroCurve?: boolean;
}

/** `rectAt`：起飞/落地矩形之间的 hero 插值（含 lift 抛物线）。 */
export function rectAt(input: RectAtInput): FlightRect {
  const offsetX = input.endPaintOffsetX ?? 0;
  const offsetY = input.endPaintOffsetY ?? 0;
  const target = shiftRect(input.end, offsetX, offsetY);
  if (input.value <= 0) return input.begin;
  if (input.value >= 1) return target;
  const t = input.heroCurve === true ? heroTimeline(input.value) : input.value;
  const journey = input.returning ? 1 - travel(1 - t) : travel(t);
  if (journey <= 0) return input.begin;
  if (journey >= 1) return target;
  const centerX = rectCenterX(input.begin) + (rectCenterX(target) - rectCenterX(input.begin)) * journey;
  const centerY = rectCenterY(input.begin) + (rectCenterY(target) - rectCenterY(input.begin)) * journey;
  const distance = Math.hypot(
    rectCenterX(target) - rectCenterX(input.begin),
    rectCenterY(target) - rectCenterY(input.begin),
  );
  const liftValue =
    Math.min(
      WENKU_FLIGHT.rectLiftLimit,
      WENKU_FLIGHT.rectLiftBase + distance * WENKU_FLIGHT.rectLiftPerPixel,
    ) * Math.sin(journey * PI_F);
  const width = rectWidth(input.begin) + (rectWidth(target) - rectWidth(input.begin)) * journey;
  const height = rectHeight(input.begin) + (rectHeight(target) - rectHeight(input.begin)) * journey;
  return {
    left: centerX - width * 0.5,
    top: centerY - liftValue - height * 0.5,
    right: centerX + width * 0.5,
    bottom: centerY - liftValue + height * 0.5,
  };
}

/* ───────────────────────────── WenkuPlanePose ───────────────────────────── */

export function planeEase(raw: number): number {
  return bezier(0.18, 0.72, 0.18, 1, raw);
}

export function planeOffsetX(progress: number, direction = 1): number {
  return -24 * direction * (1 - progress);
}

export function planeOffsetY(progress: number): number {
  return 12 * (1 - progress);
}

export function planeSlant(widthPx: number, maxSlantPx: number): number {
  return Math.min(maxSlantPx, widthPx * 0.46);
}

/** 斜切揭示窗口的 4 个顶点（扁平成 8 个数，与 Kotlin 一致）。 */
export function planeViewportPoints(
  width: number,
  height: number,
  progress: number,
  direction: number,
  slant: number,
): readonly [number, number, number, number, number, number, number, number] {
  const p = clamp(progress, 0, 1);
  const edge = (width + slant) * p;
  const x = (value: number): number => (direction >= 0 ? value : width - value);
  return [x(0), 0, x(edge), 0, x(edge - slant), height, x(0), height];
}

/* ───────────────────────────── 纸页网格 ───────────────────────────── */

/**
 * `WenkuPaperMesh.fill`：`(ROWS+1) × COLUMNS` 个顶点的位置。
 * 返回扁平的 `[x0,y0,x1,y1,…]`（UI 直接交给 `drawBitmapMesh` / 自定义网格）。
 */
export function paperMeshPositions(progress: number, width: number, height: number): number[] {
  const lastColumn = WENKU_FLIGHT.meshColumns - 1;
  const positions = new Array<number>((WENKU_FLIGHT.meshRows + 1) * WENKU_FLIGHT.meshColumns * 2).fill(0);
  for (let row = 0; row <= WENKU_FLIGHT.meshRows; row += 1) {
    const v = row / WENKU_FLIGHT.meshRows;
    for (let column = 0; column <= lastColumn; column += 1) {
      const u = column / lastColumn;
      const depth = depthAt(u, v, progress);
      const scale = WENKU_FLIGHT.bendFocal / (WENKU_FLIGHT.bendFocal - depth);
      const index = (row * WENKU_FLIGHT.meshColumns + column) * 2;
      positions[index] = width * (0.5 + (u - 0.5) * scale);
      positions[index + 1] = height * (0.5 + (v - 0.5) * scale);
    }
  }
  return positions;
}

/* ───────────────────────────── 封面飞行 ───────────────────────────── */

export interface CoverFlightFrameInput {
  readonly progress: number;
  readonly seamless: boolean;
  readonly departing: boolean;
  readonly begin: RectF;
  readonly end: RectF;
  readonly silhouetteBounds: RectF;
  readonly cornerRadiusPx: number;
  readonly density: number;
}

function toFlightRect(rect: RectF, units: number): FlightRect {
  return {
    left: rect.left / units,
    top: rect.top / units,
    right: rect.right / units,
    bottom: rect.bottom / units,
  };
}

function fromFlightRect(rect: FlightRect, units: number): FlightRect {
  return {
    left: rect.left * units,
    top: rect.top * units,
    right: rect.right * units,
    bottom: rect.bottom * units,
  };
}

/**
 * `drawWenkuCoverFlight` 的每帧参数。
 * 返回 null 等价于 Kotlin 的四个提前 return（起止矩形退化 / 目标矩形退化 / 不透明度为 0）。
 */
export function coverFlightFramePlan(input: CoverFlightFrameInput): CoverFlightFramePlan | null {
  const beginW = input.begin.right - input.begin.left;
  const beginH = input.begin.bottom - input.begin.top;
  const endW = input.end.right - input.end.left;
  const endH = input.end.bottom - input.end.top;
  if (beginW <= 0 || beginH <= 0) return null;
  if (endW <= 0 || endH <= 0) return null;

  const p = clamp(input.progress, 0, 1);
  const returning = !input.departing;
  const scrimAlpha = input.departing
    ? flightSmooth(clamp(p / WENKU_FLIGHT.scrimRiseSpan, 0, 1)) *
      (1 -
        flightSmooth(
          clamp((p - WENKU_FLIGHT.scrimFallStart) / WENKU_FLIGHT.scrimFallSpan, 0, 1),
        ))
    : 0;

  const units = input.density;
  const rectValue =
    input.seamless && !returning
      ? clamp(
          WENKU_FLIGHT.travelStart +
            WENKU_FLIGHT.travelSpan * (p / WENKU_FLIGHT.seamlessReach),
          0,
          1,
        )
      : p;
  const rectDp = rectAt({
    begin: toFlightRect(input.begin, units),
    end: toFlightRect(input.end, units),
    returning,
    value: rectValue,
  });
  if (rectWidth(rectDp) <= 0 || rectHeight(rectDp) <= 0) return null;
  const rect = fromFlightRect(rectDp, units);
  const paintBounds = inflateRect(rectDp, WENKU_FLIGHT.paintInflateDp);

  const pose = heroClock(p);
  const liftPx = lift(pose) * units;
  const rollDegrees = roll(pose) * (180 / PI_F);

  const occlusion = coverSilhouettePlan(
    pose,
    input.departing,
    input.silhouetteBounds,
    WENKU_FLIGHT.silhouetteLipDp * units,
    input.cornerRadiusPx,
  );

  const openingProgress = input.departing ? p : 1 - p;
  const opacity =
    1 -
    flightSmooth(
      clamp(
        (openingProgress - WENKU_FLIGHT.handoffStart) / WENKU_FLIGHT.handoffSpan,
        0,
        1,
      ),
    );
  if (opacity <= 0) return null;
  const traveled = input.departing ? clamp(p, 0, 1) : 1 - clamp(p, 0, 1);
  const flightRadius = input.cornerRadiusPx * (1 - flightSmooth(traveled));

  return {
    scrimAlpha,
    rect,
    paintBounds,
    liftPx,
    rollDegrees,
    opacity,
    alpha: truncToInt(opacity * 255),
    flightRadius,
    meshPositions: paperMeshPositions(pose, rectWidth(rect), rectHeight(rect)),
    occlusion,
  };
}

/** `wenkuCoverSilhouette`：唇边轮廓 + 淡出 alpha。 */
export function coverSilhouettePlan(
  progress: number,
  departing: boolean,
  bounds: RectF,
  lipHeightPx: number,
  cornerRadiusPx: number,
): { readonly lip: RectF; readonly radiusPx: number; readonly alpha: number } | null {
  if (bounds.right - bounds.left <= 0 || bounds.bottom - bounds.top <= 0) return null;
  let alpha: number;
  if (departing) {
    if (progress >= WENKU_FLIGHT.silhouetteOutStart) return null;
    alpha = 1 - easeInOut(clamp(progress / WENKU_FLIGHT.silhouetteOutStart, 0, 1));
  } else {
    if (progress <= WENKU_FLIGHT.silhouetteInStart) return null;
    alpha = easeInOut(
      clamp(
        (progress - WENKU_FLIGHT.silhouetteInStart) / WENKU_FLIGHT.silhouetteSpan,
        0,
        1,
      ),
    );
  }
  if (alpha <= 0.001) return null;
  return {
    lip: {
      left: bounds.left,
      top: bounds.bottom,
      right: bounds.right,
      bottom: bounds.bottom + lipHeightPx,
    },
    radiusPx: cornerRadiusPx,
    alpha,
  };
}

/** `wenkuPaperFlight`：`lift * .5` 的下沉与 roll 旋转。 */
export function paperFlightTransform(
  p: number,
  strength: number,
  density: number,
): { readonly translationY: number; readonly rotationZ: number } {
  const pose = heroClock(clamp(p, 0, 1));
  return {
    translationY: -lift(pose) * strength * density,
    rotationZ: roll(pose) * (180 / PI_F),
  };
}

/* ───────────────────────────── 封面飞行桥（列表卡片） ───────────────────────────── */

/** 空状态：没有飞行请求，也没有"上一次"可归位。 */
export const EMPTY_COVER_FLIGHT_STATE: CoverFlightState = { request: null, last: null };

export interface CoverFlightBeginInput {
  readonly bookKey: string;
  readonly bounds: RectF;
  readonly image: BitmapSize | null;
  readonly radiusPx: number;
  readonly returnBounds: RectF | null;
  readonly seamless: boolean;
}

/** `WenkuFlightBridge.begin`：bounds 退化时请求为 null。`_state` 只用于表达"上一次被清空"。 */
export function coverFlightBegin(
  _state: CoverFlightState,
  input: CoverFlightBeginInput,
): CoverFlightState {
  const width = input.bounds.right - input.bounds.left;
  const height = input.bounds.bottom - input.bounds.top;
  const request: CoverFlightRequest | null =
    width > 0 && height > 0
      ? {
          bookKey: input.bookKey,
          sourceBounds: input.bounds,
          sourceImage: input.image,
          sourceRadiusPx: input.radiusPx,
          targetBounds: null,
          returning: false,
          returnBounds: input.returnBounds,
          seamless: input.seamless,
        }
      : null;
  return { request, last: null };
}

/** `arrive(current, viewport)`：只在还没有 targetBounds 时补一次。 */
export function coverFlightArrive(
  state: CoverFlightState,
  current: CoverFlightRequest,
  viewport: RectF,
): CoverFlightState {
  if (state.request !== current || current.targetBounds !== null) return state;
  return { ...state, request: { ...current, targetBounds: viewport } };
}

/** `reverse(bookKey)`：用上一次请求反向播放。 */
export function coverFlightReverse(state: CoverFlightState, bookKey: string): CoverFlightState {
  const previous = state.last;
  if (previous === null || previous.bookKey !== bookKey) return { request: null, last: null };
  return { request: { ...previous, returning: true }, last: null };
}

/** `finished(current)`：身份相等才收尾；去程留下 `last` 供归位。 */
export function coverFlightFinished(
  state: CoverFlightState,
  current: CoverFlightRequest,
): CoverFlightState {
  if (state.request !== current) return state;
  return { request: null, last: current.returning ? state.last : current };
}

/** `cancel()`。 */
export function coverFlightCancel(): CoverFlightState {
  return EMPTY_COVER_FLIGHT_STATE;
}

/** `WenkuFlightOverlay` 的落地矩形：优先 `targetBounds`，否则视口本身。 */
export function coverFlightTargetBounds(request: CoverFlightRequest, root: RectF): RectF {
  return request.targetBounds ?? root;
}

/** 飞行层实际使用的贴图尺寸：先裁成书架封面比例，再等比塞进 bounds。 */
export function coverFlightLayout(
  request: CoverFlightRequest,
  root: RectF,
): {
  readonly shelfBounds: RectF;
  readonly target: RectF;
  readonly image: BitmapSize | null;
  readonly coverSize: Size2;
  readonly source: RectF;
  readonly destination: RectF;
  readonly sourceSize: { readonly width: number; readonly height: number };
} {
  const shelfBounds = request.returnBounds ?? request.sourceBounds;
  const crop = cropCoverToAspectPlan(request.sourceImage, toSize(shelfBounds));
  const image =
    request.sourceImage !== null && crop !== null
      ? {
          width: crop.crop.right - crop.crop.left,
          height: crop.crop.bottom - crop.crop.top,
        }
      : request.sourceImage;
  const target = coverFlightTargetBounds(request, root);
  const coverSize = image ?? toSize(shelfBounds);
  return {
    shelfBounds,
    target,
    image,
    coverSize,
    source: fitWenkuCover(shelfBounds, coverSize),
    destination: fitWenkuCover(target, coverSize),
    sourceSize: coverSize,
  };
}

/* ───────────────────────────── 封面到达（阅读器落点） ───────────────────────────── */

export type CoverArrivalRender = 'content' | 'hold' | 'animate';

/** `WenkuCoverArrivalFrame` 的三态渲染分支（L566-616）。 */
export function coverArrivalRenderState(
  hasFrame: boolean,
  presented: boolean,
  started: boolean,
): CoverArrivalRender {
  if (!hasFrame) return 'content';
  if (!started && !presented) return 'hold';
  if (presented) return 'content';
  return 'animate';
}

export interface CoverArrivalStart {
  readonly started: boolean;
  readonly presented: boolean;
  readonly animate: boolean;
}

/** `LaunchedEffect(hasFrame)` 的起跑判定：减少动效直接标已呈现。 */
export function coverArrivalStart(input: {
  readonly hasFrame: boolean;
  readonly presented: boolean;
  readonly started: boolean;
  readonly reduceMotion: boolean;
}): CoverArrivalStart {
  if (!input.hasFrame || input.presented || input.started) {
    return { started: input.started, presented: input.presented, animate: false };
  }
  if (input.reduceMotion) return { started: input.started, presented: true, animate: false };
  return { started: true, presented: false, animate: true };
}

/** `WenkuCoverArrivalCache`：进程内"已呈现过"集合（Kotlin 用 WeakHashMap，key 由调用方持有）。 */
export class CoverArrivalCache {
  private readonly presented = new Map<string, boolean>();

  wasPresented(key: string | null): boolean {
    if (key === null) return false;
    return this.presented.get(key) === true;
  }

  markPresented(key: string | null): void {
    if (key !== null) this.presented.set(key, true);
  }

  clear(key: string | null): void {
    if (key !== null) this.presented.delete(key);
  }
}

/* ───────────────────────────── 3D 书飞行桥 ───────────────────────────── */

export const EMPTY_VOLUME_FLIGHT_STATE: VolumeFlightState = {
  request: null,
  last: null,
  progress: 0,
  suppressRouteMotion: false,
};

export interface VolumeFlightBeginInput {
  readonly bookKey: string;
  readonly bookId: number;
  readonly art: ShelfVolumeArt;
  readonly restOx: number;
  readonly restOy: number;
}

/**
 * `WenkuVolumeFlightBridge.begin`：没有封面贴图时返回 `started: false`，
 * 调用方（ArchiveShelf.openBook）会直接进阅读器，绝不出现"点了没反应"。
 */
export function volumeFlightBegin(
  state: VolumeFlightState,
  input: VolumeFlightBeginInput,
): { readonly state: VolumeFlightState; readonly started: boolean } {
  if (input.art.cover === null) return { state, started: false };
  const request: VolumeFlightRequest = {
    bookKey: input.bookKey,
    bookId: input.bookId,
    cover: input.art.cover,
    art: input.art,
    restOx: input.restOx,
    restOy: input.restOy,
    returning: false,
    progress: 0,
  };
  return {
    state: { request, last: state.last, progress: 0, suppressRouteMotion: true },
    started: true,
  };
}

/** `reverse(bookKey)`：回程用的是起飞时同一份素材与静止姿态。 */
export function volumeFlightReverse(
  state: VolumeFlightState,
  bookKey: string,
): { readonly state: VolumeFlightState; readonly started: boolean } {
  const previous = state.request ?? state.last;
  if (previous === null || previous.bookKey !== bookKey) {
    return { state, started: false };
  }
  return {
    state: {
      request: { ...previous, returning: true, progress: 1 },
      last: state.last,
      progress: 1,
      suppressRouteMotion: true,
    },
    started: true,
  };
}

/** `publish(value)`：覆盖层与书架共享同一个进度。 */
export function volumeFlightPublish(state: VolumeFlightState, value: number): VolumeFlightState {
  return {
    ...state,
    progress: value,
    request: state.request === null ? null : { ...state.request, progress: value },
  };
}

/** `finished(current)`：身份相等才收尾；去程留下 `last` 供归位。 */
export function volumeFlightFinished(
  state: VolumeFlightState,
  current: VolumeFlightRequest,
): VolumeFlightState {
  if (state.request !== current) return state;
  return {
    request: null,
    last: current.returning ? state.last : current,
    progress: 0,
    suppressRouteMotion: false,
  };
}

/** `cancel()`。 */
export function volumeFlightCancel(): VolumeFlightState {
  return EMPTY_VOLUME_FLIGHT_STATE;
}

/** `awaitIdle(bookKey)` 的纯判定：为 true 时书架可以解锁连点保护。 */
export function volumeFlightIdle(state: VolumeFlightState, bookKey: string): boolean {
  return state.request === null || state.request.bookKey !== bookKey;
}

/** 飞行时长：去程 `OPEN_MS`，归位 `CLOSE_MS`。 */
export function volumeFlightDurationMs(returning: boolean): number {
  return returning ? CLOSE_MS : OPEN_MS;
}

/** 归位时封面从阅读器一侧淡入的 alpha（前 `CLOSE_COVER_IN_MS`）。 */
export function closeFadeAlpha(p: number): number {
  const q = 1 - clamp(p, 0, 1);
  const t = clamp(q / WENKU_VOLUME_FLIGHT.closeFadeIn, 0, 1);
  return t * t * (3 - 2 * t);
}

/** `onArrive` 的触发判定：去程且首次越过 `ARRIVE_P`。 */
export function volumeFlightShouldArrive(
  returning: boolean,
  arrived: boolean,
  value: number,
): boolean {
  return !returning && !arrived && value >= WENKU_VOLUME_FLIGHT.arriveP;
}

/**
 * `drawFlightVolume` 的每帧姿态：`poseAt` + 归位 alphaOverride + 铺满缩放。
 * `viewport` 是根覆盖层的 root 矩形（`positionInRoot` + `size`）。
 */
export function volumeFlightPose(
  request: VolumeFlightRequest,
  p: number,
  viewport: RectF,
): ShelfVolumePose {
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  const targetScale = fillScale(request.art, width, height);
  return poseAt({
    p,
    art: request.art,
    restOx: request.restOx - viewport.left,
    restOy: request.restOy - viewport.top,
    targetCenterX: width * 0.5,
    targetCenterY: height * 0.5,
    targetScale,
    alphaOverride: request.returning ? closeFadeAlpha(clamp(p, 0, 1)) : null,
  });
}

/** 覆盖层是否应该绘制（`request != null` 且视口非退化）。 */
export function volumeFlightVisible(
  state: VolumeFlightState,
  viewport: RectF | null,
): boolean {
  if (state.request === null || viewport === null) return false;
  return viewport.right > viewport.left && viewport.bottom > viewport.top;
}

/** 归位淡入比例（`CLOSE_COVER_IN_MS / CLOSE_MS`），供 UI 对照。 */
export const VOLUME_CLOSE_FADE_IN = WENKU_VOLUME_FLIGHT.closeFadeIn;
/** 打开时切路由的进度。 */
export const VOLUME_ARRIVE_P = WENKU_VOLUME_FLIGHT.arriveP;
/** 书架让位的进度（必须为 0）。 */
export const VOLUME_HANDOFF_P = WENKU_VOLUME_FLIGHT.handoffP;

/** `WenkuMotion.kt` 引用的 ENTER/EXIT 也在本层导出，避免调用点硬编码数字。 */
export const WENKU_ENTER_MS = WENKU_MOTION.enterMs;
export const WENKU_EXIT_MS = WENKU_MOTION.exitMs;

/** `easeCurve` 在飞行里对应 `WenkuMotion.ease`（`coverFlightTween`）。 */
export const flightEase = easeCurve;

/** `roundToInt` 在飞行计划里只用于顶点取整，导出以免调用点各写一份。 */
export const flightRound = roundToInt;

/** 未被计划函数使用、但 UI 需要判断"是否还需要画轮廓"的辅助类型出口。 */
export type { CoverFlightSource, CoverFlightTarget, Vec2 };

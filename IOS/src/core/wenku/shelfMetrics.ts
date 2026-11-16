/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/ArchiveShelf.kt`
 *   L751-756  METRICS_DEPTH_X / DEPTH_Y / ROW_STEP / RADIUS / MAX_VIEWPORT / CENTRE_CURVE
 *   L252      rowHeight = baseYPx + bodyPx + 12dp                → shelfRowHeightPx / shelfRowHeightDp
 *   L256-257  bitmapWidth / bitmapHeight                         → coverBitmapSize
 *   L303      center = startX + pull * depthX                    → shelfCentreX
 *   L352-373  centre(target)                                     → centreStep
 *   L375-391  slotAt(point)                                      → hitTestSlot
 *   L393-408  tap(point)                                         → resolveTap
 *   L484-577  pointerInput 手势（tap / 横拖 / 惯性 / 减少动效）      → classifyDrag / dragFocus /
 *                                                                  planShelfInertia / ShelfScrollSimulation
 *   L765-848  private class ShelfMetrics + companion of()        → ShelfMetrics
 *   L850-855  floorMod                                            → floorMod
 *   L857-862  wrapFocus                                          → wrapFocus
 *   L867-883  inkStartOf / inkProgressOf / loadingLiftPx          → 同名函数
 *   L889-964  SHELF_DRAG_RATE / SHELF_OMEGA / ShelfScrollSimulation → ShelfScrollSimulation
 *   L1067-1083 shelfWarmWindow                                   → shelfWarmWindow
 *   L1120-1138 shelfSlotOf / slotOriginX / slotOriginY            → 同名函数
 *   L1240-1337 ShelfScenePainter.draw 的槽位/剔除/让位           → layoutVisibleSlots
 *   L1347-1376 shelfSemanticBox                                  → semanticBoxRect
 *
 * 未移植：
 * - `ArchiveShelf.kt` L175-597 的组合与布局副作用（`Animatable`、`SideEffect` 光栅化预算、
 *   `drawWithCache`、语义节点挂载）。本层只输出"给定帧输入 → 几何"。
 * - L1297-1300 地面路径的实际绘制（几何在 volumeRender.floorPlan，绘制由 UI 调 Canvas）。
 * - L539 / L551 触觉反馈与 L525 `scope.launch` 的协程调度。
 * - `ArchiveShelfMemory`（L1105-1117）是进程级可变单例；本层只提供 `startingIndex` 的纯决策，
 *   记忆表由 UI 层持有（见 index.ts 的 API 说明）。
 */

import { absf, clamp, easeCurve, roundToInt, shelfOmega, truncToInt } from './motion';
import { WENKU_SHELF } from './tokens';
import type {
  CentreStep,
  CoverBitmapSize,
  ShelfFrameInput,
  SemanticBox,
  ShelfVolume,
  TapAction,
  Vec2,
  VisibleSlot,
} from './types';
import { WENKU_VOLUME_FLIGHT } from './tokens';

const SHELF_TOKENS = WENKU_SHELF;

/** 槽位常量：`METRICS_DEPTH_X` / `METRICS_DEPTH_Y`。 */
export const METRICS_DEPTH_X = SHELF_TOKENS.depthX;
export const METRICS_DEPTH_Y = SHELF_TOKENS.depthY;
export const METRICS_ROW_STEP = SHELF_TOKENS.rowStep;
export const METRICS_RADIUS = SHELF_TOKENS.waveRadius;

/** `ShelfMetrics`：全部字段 px（= dp × density），比例与 Kotlin 完全一致。 */
export class ShelfMetrics {
  readonly density: number;
  readonly viewportPx: number;
  readonly spinePx: number;
  readonly pitchPx: number;
  readonly coverPx: number;
  readonly bodyPx: number;
  readonly baseYPx: number;
  readonly rowHeightPx: number;
  readonly footprintPx: number;
  readonly pullPx: number;
  readonly startXPx: number;
  readonly edgeSlots: number;

  private constructor(
    density: number,
    viewportPx: number,
    spinePx: number,
    pitchPx: number,
    coverPx: number,
    bodyPx: number,
    baseYPx: number,
    rowHeightPx: number,
    footprintPx: number,
    pullPx: number,
    startXPx: number,
    edgeSlots: number,
  ) {
    this.density = density;
    this.viewportPx = viewportPx;
    this.spinePx = spinePx;
    this.pitchPx = pitchPx;
    this.coverPx = coverPx;
    this.bodyPx = bodyPx;
    this.baseYPx = baseYPx;
    this.rowHeightPx = rowHeightPx;
    this.footprintPx = footprintPx;
    this.pullPx = pullPx;
    this.startXPx = startXPx;
    this.edgeSlots = edgeSlots;
  }

  /** `ShelfMetrics.of(widthDp, density)`（L780-808）。 */
  static of(widthDp: number, density: number): ShelfMetrics {
    const spine = clamp(widthDp * SHELF_TOKENS.spineRate, SHELF_TOKENS.spineMinDp, SHELF_TOKENS.spineMaxDp);
    const pitch = spine + SHELF_TOKENS.pitchGapDp;
    const cover = clamp(widthDp * SHELF_TOKENS.coverRate, SHELF_TOKENS.coverMinDp, SHELF_TOKENS.coverMaxDp);
    const body =
      ((cover - SHELF_TOKENS.bodyInsetDp) * SHELF_TOKENS.bodyRatioNumerator) /
        SHELF_TOKENS.bodyRatioDenominator +
      SHELF_TOKENS.bodyConstantDp;
    const baseY = -cover * METRICS_DEPTH_Y + body * SHELF_TOKENS.baseYBodyFactor + SHELF_TOKENS.baseYConstantDp;
    const rowHeight = baseY + body + SHELF_TOKENS.rowHeightTailDp;
    const footprint = spine + cover * METRICS_DEPTH_X;
    const pull = cover * SHELF_TOKENS.pullRate;
    const edgeSlots =
      Math.ceil(
        (widthDp / 2 + footprint + pull * METRICS_DEPTH_X) / pitch,
      ) + SHELF_TOKENS.edgeSlotsPad;
    const start = widthDp / 2 - footprint / 2 + pull * METRICS_DEPTH_X;
    return new ShelfMetrics(
      density,
      widthDp * density,
      spine * density,
      pitch * density,
      cover * density,
      body * density,
      baseY * density,
      rowHeight * density,
      footprint * density,
      pull * density,
      start * density,
      edgeSlots,
    );
  }

  /** `railY(distance)`：`clamp(d, -7, 7) * 2.5 + d² * .45`，再乘 density。 */
  railY(distance: number): number {
    const d = clamp(distance, -7, 7);
    return (d * METRICS_ROW_STEP + d * d * 0.45) * this.density;
  }

  /** `weight = cos(d / 1.48 * π/2)²`；`d ≥ 1.48` 直接 0。 */
  weight(distance: number): number {
    const d = absf(distance);
    if (d >= METRICS_RADIUS) return 0;
    const value = Math.cos((d / METRICS_RADIUS) * (Math.PI / 2));
    return value * value;
  }

  /** `pullPx * w * (1.24 - .24w)`（L824-827，Kotlin 里是 private）。 */
  private pullOf(distance: number): number {
    const w = this.weight(distance);
    return this.pullPx * w * (SHELF_TOKENS.weightFactor - SHELF_TOKENS.weightBias * w);
  }

  /** `originX = -pullOf * depthX`。 */
  originX(distance: number): number {
    return -this.pullOf(distance) * METRICS_DEPTH_X;
  }

  /** `originY = baseY - pullOf * depthY - body * .60 * lift`，`lift = w²(3-2w)`。 */
  originY(distance: number): number {
    const w = this.weight(distance);
    const lift = w * w * (3 - 2 * w);
    return this.baseYPx - this.pullOf(distance) * METRICS_DEPTH_Y - this.bodyPx * 0.6 * lift;
  }

  /** 焦点槽位：`count < 2 → 0`，否则 `edgeSlots + logicalFocus`。 */
  focusOf(logicalFocus: number, count: number): number {
    return count < 2 ? 0 : this.edgeSlots + logicalFocus;
  }

  /** 槽位 → 书号：`count < 2 → 0`，否则 `floorMod(slot - edgeSlots, count)`。 */
  bookIndexOf(slot: number, count: number): number {
    return count < 2 ? 0 : floorMod(slot - this.edgeSlots, count);
  }
}

/** 取模到 `0 until count`（负数也落到正区间；`-0` 归一成 `0`，与 Kotlin `Int` 一致）。 */
export function floorMod(value: number, count: number): number {
  if (count <= 0) return 0;
  const result = value % count;
  if (result < 0) return result + count;
  return result === 0 ? 0 : result;
}

/** 把无限增长的焦点折回 `0 until count`；小数部分保留。 */
export function wrapFocus(value: number, count: number): number {
  if (count <= 0) return 0;
  const result = value % count;
  if (result < 0) return result + count;
  return result === 0 ? 0 : result;
}

/** `inkStartOf(distance) = clamp((d + 8) / 24, 0, .65)`。 */
export function inkStartOf(distance: number): number {
  return clamp((distance + 8) / 24, 0, 0.65);
}

/** `inkProgressOf(entrance, start)`：区间 `[start, start + .35]` 上的 easeOutCubic。 */
export function inkProgressOf(entrance: number, start: number): number {
  const end = start + 0.35;
  const t = clamp(entrance, 0, 1);
  if (t <= start) return 0;
  if (t >= end) return 1;
  return easeCurve((t - start) / (end - start));
}

/** `loadingLiftPx`：载入波纹上浮（负值向上），返回 px。 */
export function loadingLiftPx(
  frameNanos: number,
  distance: number,
  remaining: number,
  density: number,
): number {
  if (remaining <= 0) return 0;
  const phase = frameNanos / 1_700_000_000 - distance * 0.075;
  const crest = (1 + Math.sin(phase * (2 * Math.PI))) / 2;
  return -9 * crest * crest * remaining * density;
}

/** 绘制盒高度 px：`baseYPx + bodyPx + 12dp`（L252）。 */
export function shelfRowHeightPx(metrics: ShelfMetrics): number {
  return metrics.baseYPx + metrics.bodyPx + SHELF_TOKENS.drawBoxPadDp * metrics.density;
}

/** 绘制盒高度 dp（Compose `height(rowHeight)`）。 */
export function shelfRowHeightDp(metrics: ShelfMetrics): number {
  return shelfRowHeightPx(metrics) / metrics.density;
}

/** 画布中心 x：`startXPx + pullPx * depthX`（L303 / L398）。 */
export function shelfCentreX(metrics: ShelfMetrics): number {
  return metrics.startXPx + metrics.pullPx * METRICS_DEPTH_X;
}

/** 封面位图尺寸：宽 `round(coverPx).clamp(64, 288)`，高 `round(w*body/cover).clamp(64, 512)`。 */
export function coverBitmapSize(metrics: ShelfMetrics): CoverBitmapSize {
  const width = clamp(
    roundToInt(metrics.coverPx),
    SHELF_TOKENS.coverBitmapMinWidth,
    SHELF_TOKENS.coverBitmapMaxWidth,
  );
  const height = clamp(
    roundToInt((width * metrics.bodyPx) / metrics.coverPx),
    SHELF_TOKENS.coverBitmapMinHeight,
    SHELF_TOKENS.coverBitmapMaxHeight,
  );
  return { width, height };
}

/** 某一本书"离焦点最近的那个副本"的槽位号（L1120-1126）。 */
export function shelfSlotOf(
  metrics: ShelfMetrics,
  logicalFocus: number,
  count: number,
  index: number,
): number {
  if (count <= 1) return 0;
  const focus = metrics.focusOf(logicalFocus, count);
  const base = metrics.edgeSlots + index;
  const k = roundToInt((focus - base) / count);
  return base + k * count;
}

/** 那本书在画布里的左上角 x（行内坐标）。 */
export function slotOriginX(
  metrics: ShelfMetrics,
  logicalFocus: number,
  count: number,
  index: number,
): number {
  const distance = shelfSlotOf(metrics, logicalFocus, count, index) - metrics.focusOf(logicalFocus, count);
  return metrics.startXPx + distance * metrics.pitchPx + metrics.originX(distance);
}

/** 那本书在画布里的左上角 y（不含入场浮动）。 */
export function slotOriginY(
  metrics: ShelfMetrics,
  logicalFocus: number,
  count: number,
  index: number,
): number {
  const distance = shelfSlotOf(metrics, logicalFocus, count, index) - metrics.focusOf(logicalFocus, count);
  return metrics.railY(distance) + metrics.originY(distance);
}

/** 预光栅化窗口：离焦点由近到远、剔除屏幕外的书号（L1067-1083）。 */
export function shelfWarmWindow(active: number, count: number, metrics: ShelfMetrics): number[] {
  if (count <= 0) return [];
  const result = new Set<number>();
  const reach = metrics.edgeSlots + 2;
  const cull = metrics.coverPx * SHELF_TOKENS.cullFactor;
  for (let step = 0; step <= reach; step += 1) {
    const deltas = step === 0 ? [0] : [step, -step];
    for (const d of deltas) {
      const x = metrics.startXPx + d * metrics.pitchPx + metrics.originX(d);
      if (x > metrics.viewportPx + cull) continue;
      if (x + metrics.footprintPx < -cull) continue;
      result.add(floorMod(active + d, count));
      if (result.size >= count) return [...result];
    }
  }
  return [...result];
}

/** 命中测试：返回槽位号，未命中返回 `null`（Kotlin `Int?`）。 */
export function hitTestSlot(
  metrics: ShelfMetrics,
  point: Vec2,
  logicalFocus: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  const focus = metrics.focusOf(logicalFocus, count);
  const first = truncToInt(Math.floor(focus - metrics.edgeSlots - 2));
  const last = truncToInt(Math.ceil(focus + metrics.edgeSlots + 2));
  let hit: number | null = null;
  for (let slot = first; slot <= last; slot += 1) {
    const distance = slot - focus;
    const left = metrics.startXPx + distance * metrics.pitchPx + metrics.originX(distance);
    const top =
      metrics.railY(distance) + metrics.originY(distance) + metrics.coverPx * METRICS_DEPTH_Y;
    const right = left + metrics.footprintPx;
    const bottom =
      top + metrics.bodyPx + metrics.coverPx * -METRICS_DEPTH_Y + metrics.spinePx * 0.1;
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) hit = slot;
  }
  return hit;
}

/**
 * `tap(point)` 的纯决策：
 * - 未命中槽位：靠近中心（或只有一本）→ 打开当前书，否则无动作；
 * - 命中且 `|slot - focus| < .30` → 打开这一本；
 * - 否则 → `centre(bookIndex)`。
 */
export function resolveTap(
  metrics: ShelfMetrics,
  point: Vec2,
  logicalFocus: number,
  count: number,
  activeIndex: number,
): TapAction {
  if (count <= 0) return { kind: 'none' };
  const focus = metrics.focusOf(logicalFocus, count);
  const slot = hitTestSlot(metrics, point, logicalFocus, count);
  if (slot === null) {
    const centreX = shelfCentreX(metrics);
    if (count <= 1 || absf(point.x - centreX) <= metrics.coverPx * SHELF_TOKENS.tapCenterTolerance) {
      return activeIndex >= 0 && activeIndex < count ? { kind: 'openActive' } : { kind: 'none' };
    }
    return { kind: 'none' };
  }
  const bookIndex = metrics.bookIndexOf(slot, count);
  if (absf(slot - focus) < SHELF_TOKENS.tapFocusSlop) return { kind: 'open', bookIndex };
  return { kind: 'centre', bookIndex };
}

/** `centre(target)` 的目标槽位（取离当前焦点最近的那个等价副本）。 */
export function centreStep(
  logicalFocus: number,
  target: number,
  count: number,
): CentreStep | null {
  if (count < 2) return null;
  const base = floorMod(target, count);
  const k = roundToInt((logicalFocus - base) / count);
  const destination = base + k * count;
  return {
    base,
    k,
    destination,
    skip: absf(logicalFocus - destination) < SHELF_TOKENS.centreEpsilon,
  };
}

/** 当前书号：`floorMod(round(logicalFocus), count)`（L236-238）。 */
export function activeBookIndex(logicalFocus: number, count: number): number {
  return count <= 0 ? 0 : floorMod(roundToInt(logicalFocus), count);
}

/**
 * 起始焦点：`initialIndex ?: 记忆里的书号 ?: 最近阅读的那本`，最后 `coerceIn(0, lastIndex)`。
 * 记忆表本身（`ArchiveShelfMemory`）由 UI 层保存，这里只吃已经查好的下标。
 */
export function startingIndex(
  books: readonly { readonly id: number; readonly lastReadTime: number }[],
  initialIndex: number | null,
  rememberedIndex: number | null,
): number {
  if (books.length === 0) return 0;
  let index = initialIndex;
  if (index === null) index = rememberedIndex;
  if (index === null) {
    let best = 0;
    let bestTime = books[0]?.lastReadTime ?? 0;
    for (let i = 1; i < books.length; i += 1) {
      const time = books[i]?.lastReadTime ?? 0;
      if (time > bestTime) {
        best = i;
        bestTime = time;
      }
    }
    index = best;
  }
  return Math.trunc(clamp(index, 0, books.length - 1));
}

/** 只暴露当前书与左右邻书的语义下标（L452-456）。 */
export function semanticIndices(activeIndex: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const n = count;
  return [...new Set([activeIndex, (activeIndex - 1 + n) % n, (activeIndex + 1) % n])];
}

/** 语义盒的布局矩形（L1347-1376）：`footprint × (body + cover * -depthY)`。 */
export function semanticBoxRect(
  metrics: ShelfMetrics,
  logicalFocus: number,
  count: number,
  index: number,
): SemanticBox {
  const width = roundToInt(metrics.footprintPx);
  const height = roundToInt(metrics.bodyPx + metrics.coverPx * -METRICS_DEPTH_Y);
  const focus = metrics.focusOf(logicalFocus, count);
  const base = metrics.edgeSlots + index;
  const slot =
    count <= 1 ? 0 : base + roundToInt((focus - base) / count) * count;
  const distance = slot - focus;
  return {
    left: roundToInt(metrics.startXPx + distance * metrics.pitchPx + metrics.originX(distance)),
    top: roundToInt(
      metrics.railY(distance) + metrics.originY(distance) + metrics.coverPx * METRICS_DEPTH_Y,
    ),
    width,
    height,
  };
}

/* ───────────────────────────── 手势 ───────────────────────────── */

export type DragPhase = 'pending' | 'horizontal' | 'cancelled';

export interface DragClassification {
  readonly phase: DragPhase;
  readonly moved: boolean;
  /** 横向锁定那一帧的最后一个 x（Kotlin `lastX`）。 */
  readonly lastX: number;
}

/**
 * 方向判定（L509-518）：超过 touchSlop 之后，
 * `|dx| > |dy| * 1.2` → 横向；否则 `|dy| >= |dx|` → 取消（纵向把手势交给宿主）。
 */
export function classifyDrag(
  dx: number,
  dy: number,
  touchSlop: number,
  alreadyHorizontal: boolean,
  lastX: number,
  positionX: number,
): DragClassification {
  if (alreadyHorizontal) return { phase: 'horizontal', moved: true, lastX: positionX };
  const distance = Math.hypot(dx, dy);
  if (distance <= touchSlop) return { phase: 'pending', moved: false, lastX };
  if (absf(dx) > absf(dy) * SHELF_TOKENS.dragAxisRatio) {
    const sign = dx === 0 ? 0 : Math.sign(dx);
    return {
      phase: 'horizontal',
      moved: true,
      lastX: positionX - (dx - sign * touchSlop),
    };
  }
  if (absf(dy) >= absf(dx)) return { phase: 'cancelled', moved: true, lastX };
  return { phase: 'pending', moved: true, lastX };
}

/** 拖拽：`next = focus - amount / pitch`（不夹在 0..count 内，无限轮播）。 */
export function dragFocus(focus: number, amountPx: number, pitchPx: number): number {
  return focus - amountPx / pitchPx;
}

/* ───────────────────── 惯性 + 临界阻尼落地（L889-964） ───────────────────── */

/**
 * `ArchiveScrollSimulation`：先在 `v0 · e^-4.4t` 的惯性下滑行，再三次多项式落地；
 * 无方向释放时走 `k = ω² = 144`、`c = 2ω = 24` 的临界阻尼弹簧。
 */
export class ShelfScrollSimulation {
  readonly position: number;
  readonly velocity: number;
  readonly pitch: number;
  readonly minVelocity: number;
  readonly speed: number;
  readonly directional: boolean;
  readonly release: number;
  readonly target: number;
  readonly coastDuration: number;
  readonly handoffPosition: number;
  readonly handoffVelocity: number;
  readonly landingDuration: number;

  constructor(position: number, velocity: number, pitch: number, minVelocity: number) {
    this.position = position;
    this.velocity = velocity;
    this.pitch = pitch;
    this.minVelocity = minVelocity;
    this.speed = absf(velocity);
    this.directional = this.speed >= minVelocity;
    this.release = this.directional ? velocity : 0;

    let destination =
      roundToInt((position + this.release / 4.4) / pitch) * pitch;
    if (
      this.directional &&
      (destination - position) * Math.sign(this.release) < this.speed / shelfOmega
    ) {
      const runway = position + this.release / shelfOmega;
      destination = (this.release > 0 ? Math.ceil(runway / pitch) : Math.floor(runway / pitch)) * pitch;
    }
    this.target = destination;
    const handoffSpeed = pitch * 4;
    this.coastDuration =
      this.speed > handoffSpeed && this.directional
        ? Math.log(this.speed / handoffSpeed) / 4.4
        : 0;
    this.handoffPosition = this.coastX(this.coastDuration);
    this.handoffVelocity = this.coastV(this.coastDuration);
    this.landingDuration = this.directional
      ? (3 * (this.target - this.handoffPosition)) / this.handoffVelocity
      : 0;
  }

  coastX(time: number): number {
    return this.position + (this.release / 4.4) * (1 - Math.exp(-4.4 * time));
  }

  coastV(time: number): number {
    return this.release * Math.exp(-4.4 * time);
  }

  x(time: number): number {
    if (this.landingDuration === 0) return this.springX(time);
    if (time < this.coastDuration) return this.coastX(time);
    const remaining = clamp(1 - (time - this.coastDuration) / this.landingDuration, 0, 1);
    return this.target - (this.target - this.handoffPosition) * remaining * remaining * remaining;
  }

  private springX(time: number): number {
    const delta = this.position - this.target;
    if (delta === 0) return this.target;
    return this.target + (delta + shelfOmega * delta * time) * Math.exp(-shelfOmega * time);
  }

  private springV(time: number): number {
    const delta = this.position - this.target;
    return -shelfOmega * shelfOmega * delta * time * Math.exp(-shelfOmega * time);
  }

  isDone(time: number): boolean {
    if (this.landingDuration === 0) {
      return absf(this.x(time) - this.target) < 0.01 && absf(this.springV(time)) < 0.1;
    }
    return time >= this.coastDuration + this.landingDuration;
  }

  /** 以 1/240s 步长扫到 2s，找第一个落定时刻；找不到就返回 2s。 */
  durationSeconds(): number {
    const step = 1 / 240;
    let time = step;
    while (time < 2) {
      if (this.isDone(time)) return time;
      time += step;
    }
    return 2;
  }
}

export interface InertiaPlan {
  readonly simulation: ShelfScrollSimulation;
  /** 目标焦点（`simulation.target / pitch`）。 */
  readonly targetFocus: number;
  /** `|toPx - fromPx| < .01`：直接 snap，不播动画。 */
  readonly snap: boolean;
  readonly fromPx: number;
  readonly toPx: number;
  readonly spanPx: number;
  readonly durationMs: number;
  /** `tween` 的 easing：`((x(f·duration) - fromPx) / span).clamp(0, 1)`。 */
  readonly progressAt: (fraction: number) => number;
}

/**
 * 松手后的滚动计划。
 *
 * ⚠️ 符号：拖拽里 `next = focus - amount/pitch`，即"手指往左（amount<0）→ 焦点往后翻"。
 * 惯性模拟的 position 用的是 `focus*pitch`，所以必须喂**取反后的**手指速度
 * （`ArchiveShelf.kt` L536 `val velocity = -tracker.calculateVelocity().x`）。
 * 本函数吃的是 tracker 原始 x 速度，内部取反。
 */
export function planShelfInertia(input: {
  readonly fromFocus: number;
  readonly pointerVelocityX: number;
  readonly pitchPx: number;
  readonly density: number;
}): InertiaPlan {
  const velocity = -input.pointerVelocityX;
  const simulation = new ShelfScrollSimulation(
    input.fromFocus * input.pitchPx,
    velocity,
    input.pitchPx,
    SHELF_TOKENS.scrollMinVelocityDp * input.density,
  );
  const targetFocus = simulation.target / input.pitchPx;
  const fromPx = input.fromFocus * input.pitchPx;
  const toPx = targetFocus * input.pitchPx;
  const spanPx = toPx - fromPx;
  const durationSeconds = simulation.durationSeconds();
  const durationMs = Math.trunc(
    clamp(roundToInt(durationSeconds * 1000), SHELF_TOKENS.inertiaMinMs, SHELF_TOKENS.inertiaMaxMs),
  );
  return {
    simulation,
    targetFocus,
    snap: absf(toPx - fromPx) < SHELF_TOKENS.centreEpsilon,
    fromPx,
    toPx,
    spanPx,
    durationMs,
    progressAt: (fraction: number): number => {
      if (spanPx === 0) return 1;
      return clamp((simulation.x(fraction * durationSeconds) - fromPx) / spanPx, 0, 1);
    },
  };
}

/* ───────────────────────────── 每帧可见槽位 ───────────────────────────── */

/**
 * `ShelfScenePainter.draw` 的纯几何版本：给定焦点/入场/飞行状态，
 * 返回**按绘制顺序（槽位升序）**排列的可见卷，并标出被覆盖层接手的那一本。
 *
 * 与 Kotlin 逐行对应：L1256-1301 的 `first/last`、剔除、`ink <= .01` 跳过、
 * `loadingLiftPx`、L1305-1316 的"取离焦点最近的同名副本"。
 */
export function layoutVisibleSlots(
  metrics: ShelfMetrics,
  input: ShelfFrameInput,
  volumes: readonly Pick<ShelfVolume, 'id'>[],
  viewportWidthPx: number,
): VisibleSlot[] {
  const count = volumes.length;
  if (count <= 0) return [];
  const focus = metrics.focusOf(input.logicalFocus, count);
  const first = truncToInt(Math.floor(focus - metrics.edgeSlots - 2));
  const last = truncToInt(Math.ceil(focus + metrics.edgeSlots + 2));
  if (last < first) return [];
  const cull = metrics.coverPx * SHELF_TOKENS.cullFactor;
  const entranceValue = input.reduceMotion ? 1 : input.entrance;
  const hideFlying =
    input.flyingBookId !== null && input.flyingProgress > WENKU_VOLUME_FLIGHT.handoffP;

  const visible: VisibleSlot[] = [];
  for (let slot = first; slot <= last; slot += 1) {
    const distance = slot - focus;
    const restX = metrics.startXPx + distance * metrics.pitchPx;
    const restY = metrics.railY(distance);
    const ox = restX + metrics.originX(distance);
    if (ox > viewportWidthPx + cull || ox + metrics.footprintPx < -cull) continue;
    const oy = restY + metrics.originY(distance);
    const ink = input.reduceMotion ? 1 : inkProgressOf(entranceValue, inkStartOf(distance));
    if (ink <= 0.01) continue;
    const liftPx = input.reduceMotion
      ? 0
      : loadingLiftPx(input.frameNanos, distance, 1 - ink, metrics.density);
    visible.push({
      slot,
      distance,
      bookIndex: metrics.bookIndexOf(slot, count),
      restX,
      restY,
      x: ox,
      y: oy + liftPx,
      floorX: restX,
      floorY: restY + metrics.baseYPx + metrics.bodyPx,
      ink,
      liftPx,
      hidden: false,
    });
  }

  if (hideFlying && input.flyingBookId !== null) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < visible.length; i += 1) {
      const entry = visible[i];
      if (entry === undefined) continue;
      const book = volumes[entry.bookIndex];
      if (book === undefined || book.id !== input.flyingBookId) continue;
      const slotDistance = absf(entry.slot - focus);
      if (slotDistance < bestDistance) {
        bestDistance = slotDistance;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      const chosen = visible[bestIndex];
      if (chosen !== undefined) visible[bestIndex] = { ...chosen, hidden: true };
    }
  }
  return visible;
}

/** 入场阶段仍然画在书架上的书号集合（已剔除被覆盖层接手的那本）。 */
export function paintedBookIndices(slots: readonly VisibleSlot[]): number[] {
  return slots.filter((slot) => !slot.hidden).map((slot) => slot.bookIndex);
}

/** 地面阴影的绘制平移量（L1298 `translate(restX, restY + baseY + body)`）。 */
export function floorOrigin(metrics: ShelfMetrics, distance: number): Vec2 {
  return {
    x: metrics.startXPx + distance * metrics.pitchPx,
    y: metrics.railY(distance) + metrics.baseYPx + metrics.bodyPx,
  };
}

/** 减少动效时的入场：`reveal` 直接 1（L214-219）。 */
export function entranceFor(reduceMotion: boolean, reveal: number): number {
  return reduceMotion ? 1 : reveal;
}

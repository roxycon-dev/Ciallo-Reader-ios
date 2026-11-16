/**
 * 3D 书架核心层（`src/core/wenku/**`）的固定向量测试。
 *
 * 取值来源分两类，全部可追溯：
 * 1. **Kotlin 源码常量**：`androidReference()` 指向工作区里的 `novel-reader/`（CI 回落到打包快照），
 *    测试直接读源码、用正则抓常量，再和 TS 侧导出的值逐一比对 —— 任何一边改动都会当场失败。
 * 2. **公式手算向量**：槽位几何、透视权重、厚度、封面裁切、飞行时间轴、重排断点。这些数字由
 *    Kotlin 的公式手算得出（推导写在用例注释里），不是从实现反推。
 *
 * Android 权威：
 * - `ui/wenku/ArchiveShelf.kt`（槽位/透视/滚动/无限轮播/命中测试/让位）
 * - `ui/wenku/ShelfVolumeRender.kt`（姿态/时间轴/厚度/调色板）
 * - `ui/wenku/ShelfCoverArt.kt`（封面裁切/生成/取色）
 * - `ui/wenku/WenkuTokens.kt`（动效词表）
 * - `ui/wenku/WenkuReflow.kt`（重排断点）
 * - `ui/wenku/WenkuCoverFlight.kt` / `WenkuFlightBridge.kt` / `WenkuVolumeFlight.kt`（飞行）
 * - `data/PreferencesManager.kt`（两个 3D 开关的 key 与默认值）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';
import {
  CLOSE_MS,
  GEOMETRY_END,
  METRICS_DEPTH_X,
  METRICS_DEPTH_Y,
  METRICS_RADIUS,
  METRICS_ROW_STEP,
  OPEN_MS,
  REFLOW_DURATION_MS,
  REFLOW_RISE_DP,
  REFLOW_STAGGER_BANDS,
  REFLOW_STAGGER_STEP,
  RESTING_VOLUME_POSE,
  ShelfCoverStore,
  ShelfMetrics,
  ShelfScrollSimulation,
  VOLUME_ARRIVE_P,
  VOLUME_CLOSE_FADE_IN,
  VOLUME_HANDOFF_P,
  WENKU_COVER_ART,
  WENKU_FLIGHT,
  WENKU_MOTION,
  WENKU_PREFERENCE_KEYS,
  WENKU_REFLOW,
  WENKU_SHELF,
  WENKU_SPRING_DAMPING_RATIO,
  WENKU_TOKENS,
  WENKU_VOLUME,
  WENKU_VOLUME_FLIGHT,
  activeBookIndex,
  archiveSpineRuns,
  argb,
  averageEdgeColor,
  blendColor,
  centreStep,
  classifyDrag,
  clothTilePixels,
  closeFadeAlpha,
  coverArrivalRenderState,
  coverArrivalStart,
  coverBitmapSize,
  coverFlightBegin,
  coverFlightDurationMs,
  coverFlightFramePlan,
  coverFlightLayout,
  coverFlightReverse,
  coverSilhouettePlan,
  cropCoverToAspectPlan,
  cubicBezier,
  depthAt,
  dominantEdgeColorPlan,
  dragFocus,
  easeCurve,
  fallbackTint,
  fillScale,
  fitWenkuCover,
  floorPlan,
  floorMod,
  generatedCoverPlan,
  heroTimeline,
  hitTestSlot,
  inkOn,
  inkProgressOf,
  inkStartOf,
  jelly,
  layoutVisibleSlots,
  lift,
  listEnd,
  listStart,
  loadingLiftPx,
  luminance,
  meshRows,
  paperMeshPositions,
  planeEase,
  planeViewportPoints,
  planShelfInertia,
  planVolumeDraw,
  poseAt,
  rasterizeShelfCoverPlan,
  rectAt,
  resolveTap,
  reflowItemTransform,
  reflowProgress,
  roll,
  semanticBoxRect,
  semanticIndices,
  shadeColor,
  shelfCentreX,
  shelfPalette,
  shelfRowHeightDp,
  shelfSlotOf,
  shelfVolumeOf,
  shelfWarmWindow,
  slotOriginX,
  slotOriginY,
  splitWorkspaceLayout,
  staggerProgress,
  startingIndex,
  toneColor,
  travel,
  volumeFlightBegin,
  volumeFlightFinished,
  volumeFlightPose,
  volumeFlightPublish,
  volumeFlightReverse,
  volumeFlightShouldArrive,
  volumeHeightScale,
  volumeMaterial,
  volumeThicknessPx,
  wenkuColors,
  withAlpha,
  wrapFocus,
  EMPTY_COVER_FLIGHT_STATE,
  type BookSource,
  type ShelfVolumeArt,
} from '../../src/core/wenku';

/* ───────────────────────────── 工具 ───────────────────────────── */

function need<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`missing test value: ${label}`);
  return value;
}

function readKotlin(relative: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${relative}`), 'utf8');
}

function kotlinNumber(source: string, pattern: RegExp): number {
  const raw = pattern.exec(source)?.[1];
  if (raw === undefined) throw new Error(`Kotlin constant not found: ${pattern}`);
  return Number(raw);
}

const ARCHIVE = readKotlin('ui/wenku/ArchiveShelf.kt');
const RENDER = readKotlin('ui/wenku/ShelfVolumeRender.kt');
const COVER = readKotlin('ui/wenku/ShelfCoverArt.kt');
const TOKENS = readKotlin('ui/wenku/WenkuTokens.kt');
const REFLOW = readKotlin('ui/wenku/WenkuReflow.kt');
const COVER_FLIGHT = readKotlin('ui/wenku/WenkuCoverFlight.kt');
const VOLUME_FLIGHT = readKotlin('ui/wenku/WenkuVolumeFlight.kt');
const FLIGHT_BRIDGE = readKotlin('ui/wenku/WenkuFlightBridge.kt');
const PREFS = readKotlin('data/PreferencesManager.kt');

const BOOK: BookSource = {
  id: 7,
  title: 'Alpha Beta',
  author: 'YG',
  isComic: false,
  totalChapters: 1,
  lastReadTime: 3,
};

/** 411dp / density 1：所有手算向量的基准。 */
const M = ShelfMetrics.of(411, 1);

function makeArt(overrides: Partial<ShelfVolumeArt> = {}): ShelfVolumeArt {
  return {
    id: 7,
    coverWidth: 128,
    body: 205.9322033898305,
    thickness: 12.337,
    topInset: 0,
    tint: 0xffd9c9ae,
    material: 1,
    cover: null,
    number: '01',
    fileCode: 'WK-00007',
    runs: [],
    truncated: false,
    palette: shelfPalette(wenkuColors(false), 1),
    unit: 1,
    ...overrides,
  };
}

const restingPose = (ox: number, oy: number) => ({
  ...RESTING_VOLUME_POSE,
  ox,
  oy,
});

/* ───────────────────────────── 常量对照 ───────────────────────────── */

describe('Kotlin 常量对照（直接读源码）', () => {
  it('ArchiveShelf.kt 的槽位/透视/滚动常量', () => {
    expect(METRICS_DEPTH_X).toBe(kotlinNumber(ARCHIVE, /METRICS_DEPTH_X = (-?[\d.]+)f/));
    expect(METRICS_DEPTH_Y).toBe(kotlinNumber(ARCHIVE, /METRICS_DEPTH_Y = (-?[\d.]+)f/));
    expect(METRICS_ROW_STEP).toBe(kotlinNumber(ARCHIVE, /METRICS_ROW_STEP = (-?[\d.]+)f/));
    expect(METRICS_RADIUS).toBe(kotlinNumber(ARCHIVE, /METRICS_RADIUS = (-?[\d.]+)f/));
    expect(WENKU_SHELF.maxViewportDp).toBe(
      kotlinNumber(ARCHIVE, /METRICS_MAX_VIEWPORT = (\d+)\.dp/),
    );
    expect(WENKU_SHELF.coverRasterBudget).toBe(
      kotlinNumber(ARCHIVE, /COVER_RASTER_BUDGET = (\d+)/),
    );
    expect(WENKU_SHELF.pullRate).toBe(kotlinNumber(ARCHIVE, /val pull = cover \* (\.\d+)f/));
    expect(WENKU_SHELF.waveRadius).toBe(METRICS_RADIUS);
    expect(kotlinNumber(ARCHIVE, /SHELF_DRAG_RATE = ([\d.]+)f/)).toBe(4.4);
    expect(kotlinNumber(ARCHIVE, /SHELF_OMEGA = ([\d.]+)f/)).toBe(12);
    expect(WENKU_SHELF.tapFocusSlop).toBe(kotlinNumber(ARCHIVE, /abs\(slot - focus\) < (\.\d+)f/));
    expect(WENKU_SHELF.tapCenterTolerance).toBe(
      kotlinNumber(ARCHIVE, /metrics\.coverPx \* (\.\d+)f/),
    );
    expect(WENKU_SHELF.dragAxisRatio).toBe(
      kotlinNumber(ARCHIVE, /abs\(dx\) > abs\(dy\) \* ([\d.]+)f/),
    );
    expect(WENKU_SHELF.scrollMinVelocityDp).toBe(
      kotlinNumber(ARCHIVE, /minVelocity = (\d+)f \* densityScale/),
    );
    expect(WENKU_SHELF.inertiaMaxMs).toBe(
      kotlinNumber(ARCHIVE, /roundToInt\(\)\.coerceIn\(1, (\d+)\)/),
    );
  });

  it('ShelfOpenTimeline 的四个常量', () => {
    expect(OPEN_MS).toBe(kotlinNumber(RENDER, /const val OPEN_MS = (\d+)/));
    expect(CLOSE_MS).toBe(kotlinNumber(RENDER, /const val CLOSE_MS = (\d+)/));
    expect(GEOMETRY_END).toBe(kotlinNumber(RENDER, /const val GEOMETRY_END = (\.\d+)f/));
    expect(VOLUME_CLOSE_FADE_IN).toBe(
      kotlinNumber(RENDER, /const val CLOSE_COVER_IN_MS = (\d+)/) / CLOSE_MS,
    );
    expect(RENDER).toContain('const val CLOSE_COVER_IN_MS = 120');
  });

  it('厚度公式与兜底页数（clamp(6 + sqrt(pages)*.40, 7.5, 25)）', () => {
    expect(RENDER).toMatch(/6\.0f \+ sqrt\(pages\) \* \.40f\)\.coerceIn\(7\.5f, 25f\)/);
    expect(WENKU_VOLUME.thicknessBaseDp).toBe(6);
    expect(WENKU_VOLUME.thicknessSqrtRate).toBe(0.4);
    expect(WENKU_VOLUME.thicknessMinDp).toBe(7.5);
    expect(WENKU_VOLUME.thicknessMaxDp).toBe(25);
    expect(WENKU_VOLUME.pagesPerChapter).toBe(9);
    expect(RENDER).toContain('140f + (abs(id * 37) % 240)');
  });

  it('WenkuTokens 的动效词表与曲线控制点', () => {
    expect(WENKU_MOTION.enterMs).toBe(kotlinNumber(TOKENS, /const val ENTER_MS = (\d+)/));
    expect(WENKU_MOTION.exitMs).toBe(kotlinNumber(TOKENS, /const val EXIT_MS = (\d+)/));
    expect(WENKU_MOTION.coverFlightMs).toBe(
      kotlinNumber(TOKENS, /const val COVER_FLIGHT_MS = (\d+)/),
    );
    expect(WENKU_MOTION.coverReturnMs).toBe(
      kotlinNumber(TOKENS, /const val COVER_RETURN_MS = (\d+)/),
    );
    expect(WENKU_MOTION.listWindow).toBe(kotlinNumber(TOKENS, /LIST_WINDOW = ([\d.]+)f/));
    expect(WENKU_MOTION.listDelayStep).toBe(
      kotlinNumber(TOKENS, /LIST_DELAY_STEP = ([\d.]+)f/),
    );
    expect(WENKU_MOTION.listMaxDelayBands).toBe(
      kotlinNumber(TOKENS, /LIST_MAX_DELAY_BANDS = (\d+)/),
    );
    expect(TOKENS).toContain('CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)');
    expect(TOKENS).toContain('CubicBezierEasing(0.2f, 1.08f, 0.34f, 1f)');
    expect(TOKENS).toContain('CubicBezierEasing(0.18f, 0.72f, 0.18f, 1f)');
    expect(TOKENS).toContain('19f / (2f * kotlin.math.sqrt(270f * 0.64f))');
    expect(WENKU_SPRING_DAMPING_RATIO).toBeCloseTo(19 / (2 * Math.sqrt(270 * 0.64)), 12);
  });

  it('WenkuReflow 的重排断点', () => {
    expect(REFLOW_DURATION_MS).toBe(kotlinNumber(REFLOW, /REFLOW_DURATION_MS = (\d+)/));
    expect(WENKU_REFLOW.workspaceCloseMs).toBe(
      kotlinNumber(REFLOW, /WORKSPACE_CLOSE_MS = (\d+)/),
    );
    expect(REFLOW_STAGGER_STEP).toBe(kotlinNumber(REFLOW, /REFLOW_STAGGER_STEP = ([\d.]+)f/));
    expect(REFLOW_STAGGER_BANDS).toBe(kotlinNumber(REFLOW, /REFLOW_STAGGER_BANDS = (\d+)/));
    expect(REFLOW_RISE_DP).toBe(kotlinNumber(REFLOW, /REFLOW_RISE_DP = (\d+)f/));
    expect(WENKU_REFLOW.wideMinWidthDp).toBe(
      kotlinNumber(REFLOW, /WORKSPACE_WIDE_MIN_WIDTH_DP = (\d+)f/),
    );
    expect(WENKU_REFLOW.wideMinHeightDp).toBe(
      kotlinNumber(REFLOW, /WORKSPACE_WIDE_MIN_HEIGHT_DP = (\d+)f/),
    );
    expect(WENKU_REFLOW.maxWidthDp).toBe(kotlinNumber(REFLOW, /WORKSPACE_MAX_WIDTH_DP = (\d+)f/));
    expect(WENKU_REFLOW.selectedMaxWidthDp).toBe(
      kotlinNumber(REFLOW, /WORKSPACE_SELECTED_MAX_WIDTH_DP = (\d+)f/),
    );
    expect(WENKU_REFLOW.gapDp).toBe(kotlinNumber(REFLOW, /WORKSPACE_GAP_DP = (\d+)f/));
    expect(REFLOW).toContain('path.lineTo(edge - slant, size.height)');
  });

  it('封面飞行/3D 飞行桥的常量', () => {
    expect(WENKU_FLIGHT.meshColumns).toBe(
      kotlinNumber(COVER_FLIGHT, /WENKU_MESH_COLUMNS: Int = (\d+)/),
    );
    expect(WENKU_FLIGHT.meshRows).toBe(
      kotlinNumber(COVER_FLIGHT, /WENKU_MESH_ROWS: Int = (\d+)/),
    );
    expect(WENKU_FLIGHT.meshEdgeSamples).toBe(
      kotlinNumber(COVER_FLIGHT, /WENKU_MESH_EDGE_SAMPLES: Int = (\d+)/),
    );
    expect(WENKU_FLIGHT.piFloat).toBe(kotlinNumber(COVER_FLIGHT, /PI_F: Float = ([\d.]+)f/));
    expect(WENKU_FLIGHT.backingColor).toBe(0xff202020);
    expect(VOLUME_ARRIVE_P).toBe(kotlinNumber(VOLUME_FLIGHT, /ARRIVE_P = (\.\d+)f/));
    expect(VOLUME_HANDOFF_P).toBe(kotlinNumber(VOLUME_FLIGHT, /HANDOFF_P = (\d+)f/));
    expect(WENKU_COVER_ART.aspectTolerance).toBe(
      kotlinNumber(FLIGHT_BRIDGE, /sourceAspect\) \/ sourceAspect < (\.\d+)f/),
    );
  });

  it('PreferencesManager 的两个 3D 开关（key + 默认 true）', () => {
    expect(WENKU_PREFERENCE_KEYS.shelfUses3dView).toBe(
      /SHELF_USES_3D_VIEW = "([^"]+)"/.exec(PREFS)?.[1],
    );
    expect(WENKU_PREFERENCE_KEYS.favoritesUse3dView).toBe(
      /FAVORITES_USE_3D_VIEW = "([^"]+)"/.exec(PREFS)?.[1],
    );
    expect(PREFS).toContain('prefs.getBoolean(SHELF_USES_3D_VIEW, true)');
    expect(PREFS).toContain('prefs.getBoolean(FAVORITES_USE_3D_VIEW, true)');
    expect(WENKU_PREFERENCE_KEYS.defaultUses3dView).toBe(true);
  });

  it('调色板/封面生成的颜色常量与源码一致', () => {
    expect(COVER).toContain('0xFFF4F3EF.toInt()');
    expect(COVER).toContain('0xFFEAE7DE.toInt()');
    expect(COVER).toContain('0xFF7FD8C8.toInt()');
    expect(COVER).toContain('0xFFFF6B6B.toInt()');
    expect(COVER).toContain('0xFF2B2B29.toInt()');
    expect(RENDER).toContain('0xFF3B3A34');
    expect(RENDER).toContain('0xFFF4EFE1');
    expect(RENDER).toContain('Color(0xFF8A806B)');
    expect(WENKU_TOKENS.inkLight).toBe(0xff161613);
    expect(WENKU_TOKENS.inkSecondaryLight).toBe(0xff646b62);
  });
});

/* ───────────────────────────── 槽位几何 ───────────────────────────── */

describe('ShelfMetrics.of(411dp, 1x) —— 逐字段手算', () => {
  it('spine/pitch/cover/body/baseY/rowHeight/footprint/pull/start/edgeSlots', () => {
    // spine = clamp(411*.043, 14, 18) = 17.673
    expect(M.spinePx).toBeCloseTo(17.673, 12);
    expect(M.pitchPx).toBeCloseTo(28.673, 12);
    // cover = clamp(411*.32, 100, 128) = 128
    expect(M.coverPx).toBe(128);
    // body = (128-20)*166/118 + 54
    expect(M.bodyPx).toBeCloseTo(205.9322033898305, 10);
    // baseY = -cover*depthY + body*.60 + 12
    expect(M.baseYPx).toBeCloseTo(156.0393220338983, 10);
    expect(M.rowHeightPx).toBeCloseTo(421.9715254237288, 10);
    // footprint = spine + cover*.66
    expect(M.footprintPx).toBeCloseTo(102.153, 12);
    // pull = cover*.84
    expect(M.pullPx).toBeCloseTo(107.52, 12);
    // start = 205.5 - 51.0765 + 70.9632
    expect(M.startXPx).toBeCloseTo(225.3867, 12);
    // edgeSlots = ceil((205.5 + 102.153 + 70.9632) / 28.673) + 2 = 16
    expect(M.edgeSlots).toBe(16);
    expect(M.viewportPx).toBe(411);
    expect(M.density).toBe(1);
  });

  it('railY 在 ±7 处夹紧', () => {
    expect(M.railY(0)).toBe(0);
    expect(M.railY(1)).toBeCloseTo(2.95, 12);
    expect(M.railY(7)).toBeCloseTo(39.55, 12);
    expect(M.railY(10)).toBeCloseTo(39.55, 12);
    expect(M.railY(-7)).toBeCloseTo(4.55, 12);
  });

  it('weight = cos(d/1.48*pi/2)^2，焦点 1、半径处 0', () => {
    expect(M.weight(0)).toBe(1);
    expect(M.weight(1)).toBeCloseTo(0.2378463582213842, 12);
    expect(M.weight(METRICS_RADIUS)).toBe(0);
    expect(M.weight(2)).toBe(0);
    // 0.74 正好是 cos(pi/4)^2 = 0.5
    expect(M.weight(0.74)).toBeCloseTo(0.5, 12);
  });

  it('originX / originY：焦点处下拉 pull*0.66，抬起 body*.60', () => {
    expect(M.originX(0)).toBeCloseTo(-70.9632, 12);
    expect(M.originY(0)).toBeCloseTo(49.6832, 12);
    expect(M.originX(7)).toBeCloseTo(0, 12);
    expect(M.originY(7)).toBeCloseTo(M.baseYPx, 12);
    // 两侧对称：d=+1 与 d=-1 的水平位移相同，railY 不同
    expect(M.originX(1)).toBeCloseTo(M.originX(-1), 12);
    expect(M.originY(1)).toBeCloseTo(143.23492825136938, 10);
  });

  it('绘制盒高度 = baseY + body + 12dp；封面位图 128x206', () => {
    expect(shelfRowHeightDp(M)).toBeCloseTo(M.baseYPx + M.bodyPx + 12, 10);
    expect(coverBitmapSize(M)).toEqual({ width: 128, height: 206 });
  });

  it('焦点槽位与中心 x', () => {
    expect(M.focusOf(0, 3)).toBe(16);
    expect(M.focusOf(3.5, 12)).toBe(19.5);
    expect(M.focusOf(3.5, 1)).toBe(0);
    expect(shelfCentreX(M)).toBeCloseTo(225.3867 + 107.52 * 0.66, 12);
  });

  it('slotOrigin 与该书最近的副本（无限轮播）', () => {
    expect(shelfSlotOf(M, 0, 12, 0)).toBe(16);
    expect(shelfSlotOf(M, 11.6, 12, 0)).toBe(28);
    expect(slotOriginX(M, 0, 12, 0)).toBeCloseTo(154.4235, 10);
    expect(slotOriginY(M, 0, 12, 0)).toBeCloseTo(49.6832, 10);
    expect(slotOriginX(M, 0, 12, 1)).toBeCloseTo(234.0940283607369, 9);
  });

  it('语义盒：footprint x (body + cover*-depthY)，取最近副本', () => {
    expect(semanticBoxRect(M, 0, 3, 0)).toEqual({
      left: 154,
      top: 29,
      width: 102,
      height: 226,
    });
    expect(semanticIndices(0, 6)).toEqual([0, 5, 1]);
    expect(semanticIndices(0, 1)).toEqual([0]);
    expect(semanticIndices(0, 2)).toEqual([0, 1]);
  });
});

/* ───────────────────────────── 无限轮播 ───────────────────────────── */

describe('无限轮播（floorMod / bookIndexOf / wrapFocus / centre）', () => {
  it('floorMod 负数落到正区间', () => {
    expect(floorMod(0, 12)).toBe(0);
    expect(floorMod(11, 12)).toBe(11);
    expect(floorMod(12, 12)).toBe(0);
    expect(floorMod(-1, 12)).toBe(11);
    expect(floorMod(-13, 12)).toBe(11);
    expect(floorMod(5, 0)).toBe(0);
    expect(Object.is(floorMod(-12, 12), 0)).toBe(true);
  });

  it('bookIndexOf：12 的右边接回 1、2、3', () => {
    expect(M.bookIndexOf(16, 12)).toBe(0);
    expect(M.bookIndexOf(27, 12)).toBe(11);
    expect(M.bookIndexOf(28, 12)).toBe(0);
    expect(M.bookIndexOf(15, 12)).toBe(11);
    expect(M.bookIndexOf(17, 12)).toBe(1);
    expect(M.bookIndexOf(999, 12)).toBe(floorMod(999 - 16, 12));
    expect(M.bookIndexOf(0, 1)).toBe(0);
    expect(M.bookIndexOf(123, 0)).toBe(0);
  });

  it('wrapFocus 保留小数、折回 0..count', () => {
    expect(wrapFocus(3.5, 12)).toBe(3.5);
    expect(wrapFocus(12, 12)).toBe(0);
    expect(wrapFocus(-0.5, 12)).toBe(11.5);
    expect(wrapFocus(-12, 12)).toBe(0);
    expect(Object.is(wrapFocus(-0, 12), 0)).toBe(true);
    expect(wrapFocus(7, 0)).toBe(0);
  });

  it('activeBookIndex = floorMod(round(focus), count)', () => {
    expect(activeBookIndex(11.6, 12)).toBe(0);
    expect(activeBookIndex(11.4, 12)).toBe(11);
    expect(activeBookIndex(-0.2, 12)).toBe(0);
    expect(activeBookIndex(0, 0)).toBe(0);
  });

  it('centreStep 取离焦点最近的等价槽位', () => {
    // 焦点 11、目标 0：k=round(11/12)=1 → 12（向前一格，而不是倒着扫 11 格）
    expect(centreStep(11, 0, 12)).toEqual({ base: 0, k: 1, destination: 12, skip: false });
    expect(centreStep(0, 0, 12)).toEqual({ base: 0, k: 0, destination: 0, skip: true });
    expect(centreStep(0.005, 0, 12)?.skip).toBe(true);
    expect(centreStep(0.02, 0, 12)?.skip).toBe(false);
    // 负数焦点：-1 → base 11、k=round(-12/12)=-1 → -1
    expect(centreStep(-1, 11, 12)).toEqual({ base: 11, k: -1, destination: -1, skip: true });
    expect(centreStep(0, 0, 1)).toBeNull();
  });

  it('起始焦点：initialIndex > 记忆 > 最近阅读（并列取第一本）', () => {
    const books = [
      { id: 1, lastReadTime: 5 },
      { id: 2, lastReadTime: 9 },
      { id: 3, lastReadTime: 9 },
      { id: 4, lastReadTime: 1 },
    ];
    expect(startingIndex(books, 2, 0)).toBe(2);
    expect(startingIndex(books, null, 3)).toBe(3);
    expect(startingIndex(books, null, null)).toBe(1);
    expect(startingIndex(books, 99, null)).toBe(3);
    expect(startingIndex(books, -5, null)).toBe(0);
    expect(startingIndex([], null, null)).toBe(0);
  });
});

/* ───────────────────────────── 命中测试 ───────────────────────────── */

describe('命中测试与点按 / 居中（越界返回 -1 语义 → null）', () => {
  it('命中焦点书：open；命中邻书：centre；空处：按中心容差开当前书', () => {
    expect(hitTestSlot(M, { x: 160, y: 60 }, 0, 3)).toBe(16);
    expect(resolveTap(M, { x: 160, y: 60 }, 0, 3, 0)).toEqual({ kind: 'open', bookIndex: 0 });

    // (240,250) 同时落在 slot 16 与 17，Kotlin 不 break → 后者覆盖
    expect(hitTestSlot(M, { x: 240, y: 250 }, 0, 3)).toBe(17);
    expect(resolveTap(M, { x: 240, y: 250 }, 0, 3, 0)).toEqual({
      kind: 'centre',
      bookIndex: 1,
    });

    // 空处但离中心 0 → 打开当前书
    const centreX = shelfCentreX(M);
    expect(hitTestSlot(M, { x: centreX, y: 420 }, 0, 3)).toBeNull();
    expect(resolveTap(M, { x: centreX, y: 420 }, 0, 3, 2)).toEqual({ kind: 'openActive' });

    // 空处且离中心太远 → 无动作
    expect(resolveTap(M, { x: 5, y: 420 }, 0, 3, 0)).toEqual({ kind: 'none' });
    // 只有一本时任何空处都开它
    expect(resolveTap(M, { x: 5, y: 420 }, 0, 1, 0)).toEqual({ kind: 'openActive' });
    expect(hitTestSlot(M, { x: 5, y: 5 }, 0, 0)).toBeNull();
    expect(resolveTap(M, { x: 5, y: 5 }, 0, 0, 0)).toEqual({ kind: 'none' });
  });

  it('中心容差是 coverPx * .42', () => {
    const centreX = shelfCentreX(M);
    const tolerance = M.coverPx * WENKU_SHELF.tapCenterTolerance;
    expect(resolveTap(M, { x: centreX + tolerance, y: 420 }, 0, 3, 1).kind).toBe('openActive');
    expect(resolveTap(M, { x: centreX + tolerance + 0.5, y: 420 }, 0, 3, 1).kind).toBe('none');
  });
});

/* ───────────────────────────── 可见槽位 ───────────────────────────── */

describe('每帧可见槽位 / 入场 / 让位', () => {
  const volumes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));

  it('入场 0 时没有任何卷（ink <= .01 全部跳过）', () => {
    const slots = layoutVisibleSlots(
      M,
      {
        logicalFocus: 0,
        entrance: 0,
        frameNanos: 0,
        reduceMotion: false,
        flyingBookId: null,
        flyingProgress: 0,
      },
      volumes,
      411,
    );
    expect(slots).toEqual([]);
  });

  it('入场完成后按槽位升序、书号对 count 取模', () => {
    const slots = layoutVisibleSlots(
      M,
      {
        logicalFocus: 0,
        entrance: 1,
        frameNanos: 0,
        reduceMotion: false,
        flyingBookId: null,
        flyingProgress: 0,
      },
      volumes,
      411,
    );
    // 槽位范围 [-2, 34]；视口 411 + cull 230.4 只留下 d ∈ [-18, 14] → 33 本
    expect(slots.length).toBe(33);
    expect(slots.every((slot) => slot.bookIndex >= 0 && slot.bookIndex < 12)).toBe(true);
    for (let i = 1; i < slots.length; i += 1) {
      expect(need(slots[i], 'slot').slot).toBe(need(slots[i - 1], 'prev').slot + 1);
    }
    const focused = slots.find((slot) => slot.slot === 16);
    expect(focused?.bookIndex).toBe(0);
    expect(focused?.x).toBeCloseTo(154.4235, 9);
    expect(focused?.y).toBeCloseTo(49.6832, 9);
    expect(focused?.floorY).toBeCloseTo(M.baseYPx + M.bodyPx, 9);
  });

  it('入场中段只画已过 inkStart 的槽位', () => {
    const slots = layoutVisibleSlots(
      M,
      {
        logicalFocus: 0,
        entrance: 0.4,
        frameNanos: 0,
        reduceMotion: false,
        flyingBookId: null,
        flyingProgress: 0,
      },
      volumes,
      411,
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThan(33);
    // 焦点附近 inkStart=.333，entrance=.4 已经过半 → ink>0
    expect(need(slots.find((slot) => slot.slot === 16), 'focus').ink).toBeGreaterThan(0);
  });

  it('飞行中隐藏离焦点最近的那个副本（HANDOFF_P = 0）', () => {
    const slots = layoutVisibleSlots(
      M,
      {
        logicalFocus: 0,
        entrance: 1,
        frameNanos: 0,
        reduceMotion: false,
        flyingBookId: 1,
        flyingProgress: 0.5,
      },
      volumes,
      411,
    );
    const hidden = slots.filter((slot) => slot.hidden);
    expect(hidden).toHaveLength(1);
    expect(need(hidden[0], 'hidden').slot).toBe(16);
    expect(need(hidden[0], 'hidden').bookIndex).toBe(0);
  });

  it('减少动效：ink 恒为 1、不做载入上浮', () => {
    const slots = layoutVisibleSlots(
      M,
      {
        logicalFocus: 0,
        entrance: 0,
        frameNanos: 0,
        reduceMotion: true,
        flyingBookId: null,
        flyingProgress: 0,
      },
      volumes,
      411,
    );
    expect(slots.length).toBe(33);
    expect(slots.every((slot) => slot.ink === 1 && slot.liftPx === 0)).toBe(true);
  });

  it('预光栅化窗口：由近到远、去重、不超过 count', () => {
    const warm = shelfWarmWindow(0, 12, M);
    expect(need(warm[0], 'warm0')).toBe(0);
    expect(new Set(warm).size).toBe(warm.length);
    expect(warm.length).toBe(12);
    const small = shelfWarmWindow(0, 3, M);
    expect(small).toEqual([0, 1, 2].map((d) => floorMod(d, 3)));
    expect(shelfWarmWindow(0, 0, M)).toEqual([]);
  });
});

/* ───────────────────────────── 姿态 / 时间轴 ───────────────────────────── */

describe('ShelfOpenTimeline.poseAt：p=0 静止、p=.78 铺满', () => {
  const art = makeArt();

  it('p = 0 与书架静止姿态逐参数相同', () => {
    const pose = poseAt({
      p: 0,
      art,
      restOx: 100,
      restOy: 50,
      targetCenterX: 500,
      targetCenterY: 400,
      targetScale: 3,
      alphaOverride: null,
    });
    expect(pose).toEqual(restingPose(100, 50));
    expect(pose.depthX).toBe(RESTING_VOLUME_POSE.depthX);
    expect(pose.thicknessScale).toBe(1);
    expect(pose.detail).toBe(1);
    expect(pose.alpha).toBe(1);
    expect(pose.scale).toBe(1);
  });

  it('p = .78：转正完成、书脊收薄、工艺归零、封面铺满且仍不透明', () => {
    const targetScale = fillScale(art, 1000, 800);
    expect(targetScale).toBeCloseTo(1000 / 128, 12);
    const pose = poseAt({
      p: GEOMETRY_END,
      art,
      restOx: 100,
      restOy: 50,
      targetCenterX: 500,
      targetCenterY: 400,
      targetScale,
      alphaOverride: null,
    });
    expect(pose.depthX).toBe(1);
    // Kotlin 这里会得到 -0.0f，数值上等于 0
    expect(pose.depthY).toBeCloseTo(0, 12);
    expect(pose.skew).toBeCloseTo(0, 12);
    expect(pose.thicknessScale).toBe(0);
    expect(pose.detail).toBe(0);
    expect(pose.alpha).toBe(1);
    expect(pose.scale).toBeCloseTo(targetScale, 12);
    expect(pose.ox).toBeCloseTo(500 - 128 / 2, 12);
    expect(pose.oy).toBeCloseTo(400 - art.body / 2, 12);
    // 封面面 = 128 x body，缩放后正好盖满 1000 x 800（裁切不留边）
    expect(128 * pose.scale).toBeCloseTo(1000, 9);
    expect(art.body * pose.scale).toBeGreaterThanOrEqual(800);
  });

  it('p = .9 只剩淡出（smooth .5 → alpha .5）', () => {
    const pose = poseAt({
      p: 0.9,
      art,
      restOx: 0,
      restOy: 0,
      targetCenterX: 0,
      targetCenterY: 0,
      targetScale: 1,
      alphaOverride: null,
    });
    expect(pose.alpha).toBeCloseTo(0.5, 12);
  });

  it('alphaOverride 直接接管透明度（归位淡入）', () => {
    const pose = poseAt({
      p: 0.5,
      art,
      restOx: 0,
      restOy: 0,
      targetCenterX: 0,
      targetCenterY: 0,
      targetScale: 1,
      alphaOverride: 0.25,
    });
    expect(pose.alpha).toBe(0.25);
  });

  it('归位淡入比例 = CLOSE_COVER_IN_MS / CLOSE_MS', () => {
    expect(VOLUME_CLOSE_FADE_IN).toBeCloseTo(120 / 720, 12);
    expect(closeFadeAlpha(1)).toBe(0);
    expect(closeFadeAlpha(1 - 120 / 720)).toBe(1);
    expect(closeFadeAlpha(0)).toBe(1);
  });
});

/* ───────────────────────────── 卷数据 ───────────────────────────── */

describe('卷数据 / 厚度 / 高度 / 材质 / 兜底色', () => {
  it('archiveSpineRuns：拉丁连排、CJK 单字、空白裁剪', () => {
    expect(archiveSpineRuns('ABC 中文 D')).toEqual([
      { text: 'ABC', latin: true },
      { text: '中', latin: false },
      { text: '文', latin: false },
      { text: 'D', latin: true },
    ]);
    expect(archiveSpineRuns('   ')).toEqual([]);
  });

  it('shelfVolumeOf：编号 2/3 位补零、FAV 前缀、前 7 段截断', () => {
    const volume = shelfVolumeOf(0, BOOK);
    expect(volume.number).toBe('01');
    expect(volume.coverCode).toBe('NO.001');
    expect(volume.fileCode).toBe('WK-00007');
    expect(shelfVolumeOf(41, { ...BOOK, id: 123456 }).fileCode).toBe('WK-123456');
    expect(shelfVolumeOf(0, { ...BOOK, id: -3 }).fileCode).toBe('FAV-00003');
    expect(volume.truncated).toBe(false);
    const long = shelfVolumeOf(0, { ...BOOK, title: '一二三四五六七八' });
    expect(long.runs).toHaveLength(7);
    expect(long.truncated).toBe(true);
    const latin = archiveSpineRuns('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    expect(need(latin[0], 'latin').text).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  });

  it('厚度 clamp(6 + sqrt(pages)*.40, 7.5, 25)', () => {
    // chapters=1 → pages=9 → 6+3*.4=7.2 → 夹到 7.5
    expect(volumeThicknessPx(1, 7, 1)).toBeCloseTo(7.5, 12);
    expect(volumeThicknessPx(1, 7, 2)).toBeCloseTo(15, 12);
    // chapters=0、id=3 → pages=140+111=251
    expect(volumeThicknessPx(0, 3, 1)).toBeCloseTo(6 + Math.sqrt(251) * 0.4, 12);
    expect(volumeThicknessPx(0, -3, 1)).toBeCloseTo(volumeThicknessPx(0, 3, 1), 12);
    // chapters=5000 → pages=45000 → 90.85 → 夹到 25
    expect(volumeThicknessPx(5000, 1, 1)).toBe(25);
  });

  it('高度差 ±3.5%、材质三分支', () => {
    // id=0 → abs(0)%100=0 → swing=-.5 → 1-.035
    expect(volumeHeightScale(0)).toBeCloseTo(0.965, 12);
    expect(volumeHeightScale(100)).toBeCloseTo(0.965, 12);
    // id=1 → abs(131)%100=31 → swing=-.19 → 1-.19*.07
    expect(volumeHeightScale(1)).toBeCloseTo(1 - 0.19 * 0.07, 12);
    expect(volumeMaterial(1, 1)).toBe(WENKU_VOLUME.materialCloth);
    expect(volumeMaterial(1, 2)).toBe(WENKU_VOLUME.materialMatte);
    expect(volumeMaterial(1, 3)).toBe(WENKU_VOLUME.materialGloss);
    expect(volumeMaterial(-1, 3)).toBe(WENKU_VOLUME.materialGloss);
  });

  it('无封面兜底色：abs(id) % 4 的纸色系（绝无深蓝灰）', () => {
    expect(fallbackTint(0)).toBe(0xffefe9dc);
    expect(fallbackTint(1)).toBe(0xffd9c9ae);
    expect(fallbackTint(2)).toBe(0xffc9c2b4);
    expect(fallbackTint(3)).toBe(0xffdcd3c2);
    expect(fallbackTint(-1)).toBe(0xffd9c9ae);
    expect(fallbackTint(-4)).toBe(0xffefe9dc);
    expect(fallbackTint(5)).toBe(0xffd9c9ae);
  });
});

/* ───────────────────────────── 单卷绘制计划 ───────────────────────────── */

describe('planVolumeDraw：一套参数 = 一本书的全部几何', () => {
  const art = makeArt();
  const plan = planVolumeDraw(art, restingPose(100, 50), null, null);

  it('pivot 等于反解出的封面面中心', () => {
    expect(plan.pivotX).toBeCloseTo(100 + 12.337 + 128 * 0.66 * 0.5, 10);
    expect(plan.pivotY).toBeCloseTo(50 + (-128 * 0.16) / 2 + art.body / 2, 10);
    expect(plan.visible).toBe(true);
    expect(plan.alpha255).toBe(255);
  });

  it('顶面四点是 [origin, +front, +front+depth, +depth]', () => {
    const points = plan.topFace.quad.points;
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]?.x).toBeCloseTo(12.337, 12);
    expect(points[1]?.y).toBeCloseTo(1.2337, 12);
    expect(points[2]?.x).toBeCloseTo(12.337 + 84.48, 12);
    expect(points[2]?.y).toBeCloseTo(1.2337 - 20.48, 12);
    expect(points[3]).toEqual({ x: 84.48, y: -20.48 });
  });

  it('纸页块、纸页线、前口高光', () => {
    const pagePoints = plan.pageFace.quad.points;
    expect(pagePoints[0]?.x).toBeCloseTo(2.1, 12);
    expect(pagePoints[0]?.y).toBeCloseTo(0.21, 12);
    expect(pagePoints[1]?.x).toBeCloseTo(10.237, 12);
    expect(pagePoints[2]?.x).toBeCloseTo(12.337 - 2.1 + 0.9875 * 84.48, 9);
    expect(plan.pageLines).toHaveLength(5);
    expect(need(plan.pageLines[0], 'line').alpha).toBe(86);
    expect(plan.foreEdgeHairline.width).toBeCloseTo(Math.max(0.6, 12.337 * 0.04), 12);
    // 纸页压影裁到纸页四边形：这里直接给出同一组顶点
    expect(plan.pageClip).toEqual(plan.pageFace.quad);
    expect(plan.pageShades).toHaveLength(2);
  });

  it('书脊：斜切矩阵、圆脊半径、六段渐变、编号留白', () => {
    expect(plan.spine.matrix.values).toEqual([1, 0, 0, 0.1, 1, 0, 0, 0, 1]);
    expect(plan.spine.rect.right).toBeCloseTo(12.337, 12);
    expect(plan.spine.radius).toBeCloseTo(4.4, 12);
    expect(plan.spine.fillGradient.stops).toHaveLength(6);
    expect(plan.spine.fillGradient.stops.map((stop) => stop.position)).toEqual([
      0, 0.16, 0.34, 0.58, 0.82, 1,
    ]);
    expect(plan.spine.shadeGradient.stops.map((stop) => stop.position)).toEqual([
      0, 0.18, 0.36, 0.6, 0.86, 1,
    ]);
    expect(plan.spine.shadeAlpha * 255).toBeCloseTo(235, 9);
    // 没有贴图 → 不画包裹、编号无法度量 → 不画
    expect(plan.spine.wrapSource).toBeNull();
    expect(plan.spine.details.numberText).toBeNull();
    expect(plan.spine.details.headBands).toHaveLength(2);
    expect(plan.spine.details.separators).toHaveLength(2);
  });

  it('封面：矩阵 [dx,0,t, dy,1,t*skew]、纸色打底、编号在左下', () => {
    expect(plan.cover.matrix.values).toEqual([0.66, 0, 12.337, -0.16, 1, 1.2337, 0, 0, 1]);
    expect(plan.cover.baseColor).toBe(0xfff4efe1);
    expect(plan.cover.bitmap).toBeNull();
    expect(plan.cover.codeText.x).toBeCloseTo(2.4 + 3, 12);
    expect(plan.cover.codeText.y).toBeCloseTo(art.body - 4.6, 12);
    expect(plan.cover.codeText.monospace).toBe(true);
    expect(plan.cover.chamfers).toHaveLength(4);
    expect(plan.cover.hingeRects).toHaveLength(2);
    expect(plan.hingeCenterLine.segment.x0).toBeCloseTo(12.337 - 0.55, 12);
  });

  it('材质：哑光无附加层、布面加纹理、覆膜加斜向反光', () => {
    const matte = planVolumeDraw(makeArt({ material: 1 }), restingPose(0, 0), null, null);
    expect(matte.cover.sheen).toBeNull();
    expect(matte.cover.cloth).toBeNull();
    const cloth = planVolumeDraw(makeArt({ material: 0 }), restingPose(0, 0), null, null);
    expect(cloth.cover.sheen).toBeNull();
    expect(need(cloth.cover.cloth, 'cloth').alpha).toBe(58);
    expect(need(cloth.cover.cloth, 'cloth').tileScale).toBeCloseTo(0.55, 12);
    const gloss = planVolumeDraw(makeArt({ material: 2 }), restingPose(0, 0), null, null);
    expect(need(gloss.cover.sheen, 'sheen').rotationDeg).toBe(-14);
    expect(need(gloss.cover.sheen, 'sheen').alpha).toBe(140);
  });

  it('带贴图时输出封面/书脊的裁切矩形', () => {
    const textured = planVolumeDraw(
      makeArt({ cover: 7 }),
      restingPose(0, 0),
      { width: 256, height: 412 },
      null,
    );
    expect(need(textured.cover.bitmap, 'bitmap').destination.right).toBe(128);
    expect(need(textured.cover.bitmap, 'bitmap').alpha).toBe(1);
    expect(need(textured.spine.wrapSource, 'wrap').left).toBe(15);
    expect(need(textured.spine.wrapSource, 'wrap').right).toBe(56);
    expect(need(textured.spine.wrapDestination, 'wrap').right).toBe(12);
  });

  it('尺寸退化时 visible=false', () => {
    const tiny = planVolumeDraw(makeArt({ coverWidth: 2 }), RESTING_VOLUME_POSE, null, null);
    expect(tiny.visible).toBe(false);
  });

  it('地面：六边形 + 右上 10% 墨水渐变', () => {
    const palette = shelfPalette(wenkuColors(false), 1);
    const floor = floorPlan(M, palette);
    expect(floor.points[0]).toEqual({ x: 0, y: 0 });
    expect(floor.points[1]?.x).toBeCloseTo(17.673, 12);
    expect(floor.points[1]?.y).toBeCloseTo(1.4, 12);
    expect(floor.points[5]).toEqual({ x: -10, y: 10 });
    expect(floor.bounds.left).toBe(-10);
    expect(floor.bounds.right).toBeCloseTo(102.153, 12);
    expect(floor.gradient.x0).toBe(floor.bounds.right);
    expect(floor.gradient.stops[0]?.color).toBe(withAlpha(palette.floorInk, 0.1));
    expect(floor.gradient.stops[1]?.color).toBe(withAlpha(palette.floorInk, 0));
  });
});

/* ───────────────────────────── 封面素材 ───────────────────────────── */

describe('封面裁切 / 生成 / 取色 / LRU', () => {
  it('centerCrop：max 缩放 + 居中平移（不留纸边）', () => {
    const plan = need(rasterizeShelfCoverPlan({ width: 800, height: 1200 }, 128, 206), 'raster');
    expect(plan.scale).toBeCloseTo(206 / 1200, 12);
    expect(plan.drawnWidth).toBe(137);
    expect(plan.drawnHeight).toBe(206);
    expect(plan.translateX).toBeCloseTo(-4.5, 12);
    expect(plan.translateY).toBe(0);
    expect(plan.clip).toEqual({ left: 0, top: 0, right: 128, bottom: 206 });
    expect(rasterizeShelfCoverPlan(null, 128, 206)).toBeNull();
    expect(rasterizeShelfCoverPlan({ width: 10, height: 10 }, 0, 206)).toBeNull();
  });

  it('cropCoverToAspect：2% 容差内不裁，超出按中心裁', () => {
    expect(cropCoverToAspectPlan({ width: 800, height: 1200 }, { width: 128, height: 206 })).toEqual({
      crop: { left: 27, top: 0, right: 772, bottom: 1200 },
    });
    expect(cropCoverToAspectPlan({ width: 128, height: 206 }, { width: 128, height: 206 })).toBeNull();
    expect(cropCoverToAspectPlan({ width: 1000, height: 1000 }, { width: 128, height: 206 })).toEqual({
      crop: { left: 189, top: 0, right: 810, bottom: 1000 },
    });
    expect(cropCoverToAspectPlan(null, { width: 128, height: 206 })).toBeNull();
    expect(cropCoverToAspectPlan({ width: 0, height: 0 }, { width: 128, height: 206 })).toBeNull();
  });

  it('fitWenkuCover：等比塞入并保持中心', () => {
    const fitted = fitWenkuCover(
      { left: 0, top: 0, right: 100, bottom: 200 },
      { width: 128, height: 206 },
    );
    expect(fitted.left).toBeCloseTo(0, 12);
    expect(fitted.right).toBeCloseTo(100, 12);
    expect(fitted.top).toBeCloseTo(19.53125, 10);
    expect(fitted.bottom).toBeCloseTo(180.46875, 10);
    expect(fitWenkuCover({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
  });

  const measure = (text: string, size: number, width: number, maxLines: number) => ({
    height: Math.max(1, Math.ceil(text.length / Math.max(1, Math.floor(width / size))) * size),
    lineCount: maxLines,
  });
  const measureWidth = (text: string, size: number) => text.length * size;

  it('生成封面：纸色渐变、边框、图标、书名字号不缩', () => {
    const plan = generatedCoverPlan(
      { title: '短书名', author: '', tag: 'TXT', dark: false, widthPx: 128, heightPx: 206 },
      measure,
      measureWidth,
    );
    expect(plan.width).toBe(128);
    expect(plan.height).toBe(206);
    expect(plan.unit).toBeCloseTo(128 / 118, 12);
    expect(plan.paperTop).toBe(WENKU_COVER_ART.backgroundTopLight);
    expect(plan.paperBottom).toBe(WENKU_COVER_ART.backgroundBottomLight);
    expect(plan.title.attempts).toBe(0);
    expect(plan.title.textSize).toBeCloseTo((128 / 118) * 13.5, 12);
    expect(plan.title.widthPx).toBe(94);
    expect(plan.title.translateX).toBeCloseTo((128 - 94) / 2, 12);
    expect(plan.title.translateY).toBeCloseTo(206 * 0.3, 12);
    expect(plan.title.maxLines).toBe(4);
    expect(plan.title.lineSpacingMultiplier).toBe(1.12);
    expect(plan.rule.segment.y0).toBeCloseTo(206 * 0.8, 12);
    // 空作者回退到破折号
    expect(plan.author.text).toBe('\u2014');
    expect(plan.tag.text).toBe('TXT');
    expect(plan.tag.color).toBe(argb(242, 0x7f, 0xd8, 0xc8));
  });

  it('生成封面：放不下按 .88 缩字号，最多 6 次', () => {
    const tall = () => ({ height: 999, lineCount: 9 });
    const plan = generatedCoverPlan(
      { title: '很长很长很长的书名', author: 'A', tag: 'COMIC', dark: true, widthPx: 128, heightPx: 206 },
      tall,
      measureWidth,
    );
    expect(plan.title.attempts).toBe(WENKU_COVER_ART.titleMaxAttempts);
    const unit = 128 / 118;
    expect(plan.title.textSize).toBeCloseTo(unit * 13.5 * 0.88 ** 6, 10);
    expect(plan.tag.color).toBe(argb(242, 0xff, 0x6b, 0x6b));
    expect(plan.paperTop).toBe(WENKU_COVER_ART.backgroundTopDark);
  });

  it('生成封面的尺寸下限与颜色分支', () => {
    const plan = generatedCoverPlan(
      { title: 'x', author: 'y', tag: 'TXT', dark: true, widthPx: 1, heightPx: 1 },
      measure,
      measureWidth,
    );
    expect(plan.width).toBe(WENKU_COVER_ART.minWidth);
    expect(plan.height).toBe(WENKU_COVER_ART.minHeight);
    expect(plan.unit).toBe(1);
    expect(plan.ink).toBe(WENKU_COVER_ART.inkDark);
    expect(plan.muted).toBe(WENKU_COVER_ART.mutedDark);
  });

  it('取色：左侧 16% 竖带、24 行、6 列，均值回 ARGB', () => {
    // 128x206 → 竖带 20px、stepY=8（ceil(206/8)=26 行）、stepX=3（ceil(20/3)=7 列）
    const plan = dominantEdgeColorPlan(128, 206);
    expect(plan.sampleWidth).toBe(20);
    expect(plan.stepY).toBe(8);
    expect(plan.stepX).toBe(3);
    expect(plan.count).toBe(26 * 7);
    expect(averageEdgeColor([])).toBe(WENKU_COVER_ART.edgeFallbackColor);
    expect(
      averageEdgeColor([
        { r: 10, g: 20, b: 30 },
        { r: 30, g: 40, b: 50 },
      ]),
    ).toBe(argb(255, 20, 30, 40));
  });

  it('布纹：48x48、确定、alpha 在 16..37', () => {
    const pixels = clothTilePixels();
    expect(pixels).toHaveLength(48 * 48);
    expect(clothTilePixels()).toEqual(pixels);
    // 前几个像素 = java.util.Random(11) 的前几次 nextInt
    expect(pixels[0]).toBe(0x208d8d8d);
    expect(pixels[1]).toBe(0x1f828282);
    expect(pixels[2]).toBe(0x176e6e6e);
    expect(pixels[3]).toBe(0x1d5f5f5f);
    expect(pixels[48]).toBe(0x11818181);
    for (const pixel of pixels) {
      const alpha = (pixel >>> 24) & 0xff;
      expect(alpha).toBeGreaterThanOrEqual(16);
      expect(alpha).toBeLessThanOrEqual(37);
    }
  });

  it('封面 LRU：容量 64、访问序淘汰、占位标记', () => {
    const store = new ShelfCoverStore(2);
    store.put(1, 1, 0xff000000);
    store.put(2, 2, 0xff000000, true);
    expect(store.isPlaceholder(2)).toBe(true);
    // 读 1 → 1 变成最新，再放 3 时淘汰 2
    expect(store.get(1)).toBe(1);
    store.put(3, 3, 0xff000000);
    expect(store.keys()).toEqual([1, 3]);
    expect(store.isPlaceholder(2)).toBe(false);
    expect(store.tintOf(1)).toBe(0xff000000);
    store.put(1, 1, 0xff111111);
    expect(store.isPlaceholder(1)).toBe(false);
    expect(store.get(4)).toBeNull();
    expect(new ShelfCoverStore().put).toBeTypeOf('function');
  });

  it('颜色工具：blend/shade/tone 的取整与 Kotlin 一致', () => {
    expect(blendColor(0xff000000, 0xffffffff, 0.5)).toBe(argb(255, 127, 127, 127));
    expect(shadeColor(0xff808080, 0.5)).toBe(argb(255, 191, 191, 191));
    expect(shadeColor(0xff808080, -0.5)).toBe(argb(255, 64, 64, 64));
    expect(toneColor(0xffabcdef, 0.5, 0.5)).toBe(0x40abcdef);
    expect(toneColor(0xffabcdef, 1, 1)).toBe(0xffabcdef);
  });
});

/* ───────────────────────────── 动效 / 滚动 ───────────────────────────── */

describe('WenkuMotion / 滚动模拟', () => {
  it('easeOutCubic(.5) = .87509（20 步二分解）', () => {
    expect(easeCurve(0.5)).toBeCloseTo(0.8750934799882268, 12);
    expect(easeCurve(0)).toBe(0);
    expect(easeCurve(1)).toBe(1);
    expect(cubicBezier(0.215, 0.61, 0.355, 1)(0.5)).toBeCloseTo(0.8750934799882268, 12);
  });

  it('jelly / listStart / listEnd', () => {
    expect(jelly(0)).toBe(0);
    expect(jelly(0.5)).toBeCloseTo(-0.25, 12);
    expect(listStart(3)).toBeCloseTo(0.165, 12);
    expect(listEnd(3)).toBeCloseTo(0.685, 12);
    expect(listStart(20)).toBeCloseTo(8 * 0.055, 12);
  });

  it('coverFlightDurationMs 去程 1000 / 归程 840', () => {
    expect(coverFlightDurationMs(true)).toBe(1000);
    expect(coverFlightDurationMs(false)).toBe(840);
  });

  it('inkStartOf / inkProgressOf（easeOutCubic 区间）', () => {
    expect(inkStartOf(0)).toBeCloseTo(1 / 3, 12);
    expect(inkStartOf(-10)).toBe(0);
    expect(inkStartOf(8)).toBeCloseTo(0.65, 12);
    expect(inkProgressOf(0.5, 1 / 3)).toBeCloseTo(0.8588271256665058, 12);
    expect(inkProgressOf(0.2, 1 / 3)).toBe(0);
    expect(inkProgressOf(0.9, 1 / 3)).toBe(1);
  });

  it('loadingLiftPx：帧时间戳驱动的 -9dp 波纹', () => {
    expect(loadingLiftPx(0, 0, 1, 1)).toBeCloseTo(-2.25, 12);
    expect(loadingLiftPx(0, 0, 0, 1)).toBe(0);
    // phase = 0.25 → sin(2π*0.25)=1 → crest=1
    expect(loadingLiftPx(1_700_000_000 / 4, 0, 1, 1)).toBeCloseTo(-9, 12);
    expect(loadingLiftPx(1_700_000_000 / 4, 0, 1, 2)).toBeCloseTo(-18, 12);
  });

  it('手势：越 slop 后横向锁定 / 纵向取消，纵向位移给宿主', () => {
    expect(classifyDrag(3, 3, 8, false, 0, 3).phase).toBe('pending');
    const horizontal = classifyDrag(20, 2, 8, false, 0, 20);
    // lastX = 20 - (20 - 8) = 8：越过 slop 的那一段不产生位移
    expect(horizontal).toEqual({ phase: 'horizontal', moved: true, lastX: 8 });
    expect(classifyDrag(2, 20, 8, false, 0, 2).phase).toBe('cancelled');
    expect(classifyDrag(9, 8, 8, false, 0, 9).phase).toBe('pending');
    expect(classifyDrag(0, 0, 8, true, 0, 5)).toEqual({
      phase: 'horizontal',
      moved: true,
      lastX: 5,
    });
    expect(dragFocus(3, -28.673, 28.673)).toBeCloseTo(4, 12);
  });

  it('ShelfScrollSimulation：惯性 → 三次落地；无方向时临界阻尼', () => {
    const sim = new ShelfScrollSimulation(0, 1000, 100, 50);
    expect(sim.directional).toBe(true);
    expect(sim.target).toBe(200);
    expect(sim.coastDuration).toBeCloseTo(Math.log(2.5) / 4.4, 12);
    expect(sim.handoffPosition).toBeCloseTo(136.36363636363637, 10);
    expect(sim.handoffVelocity).toBeCloseTo(400, 10);
    expect(sim.landingDuration).toBeCloseTo(0.4772727272727273, 10);
    expect(sim.x(0)).toBeCloseTo(0, 12);
    expect(sim.x(sim.coastDuration)).toBeCloseTo(136.36363636363637, 9);
    expect(sim.x(sim.coastDuration + sim.landingDuration / 2)).toBeCloseTo(192.04545454545456, 9);
    expect(sim.x(1)).toBeCloseTo(200, 12);
    expect(sim.durationSeconds()).toBeCloseTo(0.6875, 12);

    const spring = new ShelfScrollSimulation(0, 0, 100, 50);
    expect(spring.directional).toBe(false);
    expect(spring.target).toBe(0);
    expect(spring.coastDuration).toBe(0);
    expect(spring.landingDuration).toBe(0);
    expect(spring.x(0.1)).toBe(0);
    expect(spring.durationSeconds()).toBeCloseTo(1 / 240, 12);

    // 速度刚过阈值：runway=5 → ceil(5/100)=1 → 目标 100，三次落地 5s → 时长夹到 2s
    const slow = new ShelfScrollSimulation(0, 60, 100, 50);
    expect(slow.target).toBe(100);
    expect(slow.durationSeconds()).toBe(2);
  });

  it('planShelfInertia 取反手指速度（拖拽符号）', () => {
    // tracker 的 x 速度 = -1000（手指往左）→ 模拟速度 +1000
    const plan = planShelfInertia({
      fromFocus: 0,
      pointerVelocityX: -1000,
      pitchPx: 100,
      density: 1,
    });
    expect(plan.targetFocus).toBe(2);
    expect(plan.snap).toBe(false);
    expect(plan.durationMs).toBeGreaterThanOrEqual(687);
    expect(plan.durationMs).toBeLessThanOrEqual(688);
    expect(plan.progressAt(0)).toBeCloseTo(0, 9);
    expect(plan.progressAt(1)).toBeCloseTo(1, 9);
    // 反向：手指往右 → 焦点回退
    const back = planShelfInertia({
      fromFocus: 10,
      pointerVelocityX: 1000,
      pitchPx: 100,
      density: 1,
    });
    expect(back.targetFocus).toBe(8);
  });
});

/* ───────────────────────────── 重排 ───────────────────────────── */

describe('WenkuReflow：断点 / 错峰 / 项目变换', () => {
  it('宽屏判据 1000x500，列宽 total/split/master/detail', () => {
    expect(splitWorkspaceLayout({ maxWidthDp: 1200, maxHeightDp: 800, expanded: true, closing: false })).toEqual({
      wide: true,
      selected: true,
      total: 1200,
      split: 588,
      master: 588,
      masterLeft: 0,
      detailLeft: 612,
      detailWidth: 588,
      listHidden: false,
    });
    // 900dp 宽不是宽屏：主列占满、详情列不显示
    expect(splitWorkspaceLayout({ maxWidthDp: 900, maxHeightDp: 800, expanded: true, closing: false })).toEqual({
      wide: false,
      selected: true,
      total: 900,
      split: 438,
      master: 900,
      masterLeft: 0,
      detailLeft: 0,
      detailWidth: 900,
      listHidden: true,
    });
    // 高度 400dp 也不是宽屏
    expect(
      splitWorkspaceLayout({ maxWidthDp: 1200, maxHeightDp: 400, expanded: true, closing: false }).wide,
    ).toBe(false);
    // selected + wide + closing：主列回到 split，且整列居中
    expect(
      splitWorkspaceLayout({ maxWidthDp: 1400, maxHeightDp: 900, expanded: true, closing: true }),
    ).toEqual({
      wide: true,
      selected: true,
      total: 1400,
      split: 688,
      master: 1200,
      masterLeft: 100,
      detailLeft: 712,
      detailWidth: 688,
      listHidden: false,
    });
    // 收起后主列上限 1200
    expect(
      splitWorkspaceLayout({ maxWidthDp: 1600, maxHeightDp: 900, expanded: false, closing: false }).total,
    ).toBe(1200);
  });

  it('错峰：(order % 9) * .025，9 的倍数不延迟', () => {
    expect(staggerProgress(0, 0)).toBe(0);
    expect(staggerProgress(1, 5)).toBe(1);
    expect(staggerProgress(0.5, 0)).toBe(0.5);
    expect(staggerProgress(0.5, 9)).toBe(0.5);
    expect(staggerProgress(0.5, 10)).toBeCloseTo((0.5 - 0.025) / 0.975, 12);
    expect(staggerProgress(0.5, -1)).toBeCloseTo((0.5 - 0.2) / 0.8, 12);
    expect(staggerProgress(0.2, 8)).toBe(0);
  });

  it('参与重排：平移 (source-live)*(1-p)；同尺寸不裁剪', () => {
    const transform = reflowItemTransform({
      active: true,
      progress: 0.5,
      source: { left: 0, top: 0, right: 100, bottom: 100 },
      live: { left: 40, top: 20, right: 140, bottom: 120 },
      layout: { width: 100, height: 100 },
      order: 0,
      density: 2,
    });
    expect(transform.translationX).toBe(-20);
    expect(transform.translationY).toBe(-10);
    expect(transform.alpha).toBe(1);
    expect(transform.clip).toBeNull();
    // 尺寸变化超过 .5dp 才裁剪
    const resized = reflowItemTransform({
      active: true,
      progress: 0.5,
      source: { left: 0, top: 0, right: 100, bottom: 100 },
      live: { left: 0, top: 0, right: 100, bottom: 100 },
      layout: { width: 60, height: 100 },
      order: 0,
      density: 1,
    });
    expect(resized.clip).toEqual({ width: 80, height: 100 });
  });

  it('未参与重排：10dp 上浮 + 透明度揭示；未激活恒为终态', () => {
    const fresh = reflowItemTransform({
      active: true,
      progress: 0.5,
      source: null,
      live: null,
      layout: { width: 100, height: 100 },
      order: 0,
      density: 2,
    });
    expect(fresh).toEqual({ translationX: 0, translationY: 10, alpha: 0.5, clip: null });
    const idle = reflowItemTransform({
      active: false,
      progress: 0.2,
      source: { left: 0, top: 0, right: 10, bottom: 10 },
      live: null,
      layout: { width: 10, height: 10 },
      order: 3,
      density: 1,
    });
    expect(idle).toEqual({ translationX: 0, translationY: 0, alpha: 1, clip: null });
    expect(reflowProgress(0.5, false)).toBe(1);
    expect(reflowProgress(0.5, true)).toBeCloseTo(planeEase(0.5), 12);
  });
});

/* ───────────────────────────── 飞行 ───────────────────────────── */

describe('WenkuFlightPose / 平面揭示', () => {
  const begin = { left: 0, top: 0, right: 100, bottom: 100 };
  const end = { left: 200, top: 200, right: 300, bottom: 300 };

  it('rectAt：两端精确、中段走 travel + 抛物线 lift', () => {
    expect(rectAt({ begin, end, returning: false, value: 0 })).toEqual(begin);
    expect(rectAt({ begin, end, returning: false, value: 1 })).toEqual(end);
    const mid = rectAt({ begin, end, returning: false, value: 0.5 });
    // 起止同尺寸（100x100）→ 宽度不变，只有中心与 lift 变化
    expect(mid.right - mid.left).toBeCloseTo(100, 12);
    expect((mid.left + mid.right) / 2).toBeCloseTo(50 + (250 - 50) * travel(0.5), 9);
    expect(mid.bottom - mid.top).toBeCloseTo(100, 12);
    // 抛物线 lift 把矩形整体抬高：top < centerY - 50
    expect(mid.top).toBeLessThan((mid.top + mid.bottom) / 2 - 49.9);
    // 去程与回程在 journey 上互为镜像
    const back = rectAt({ begin, end, returning: true, value: 0.5 });
    expect((back.left + back.right) / 2).toBeCloseTo(50 + (250 - 50) * (1 - travel(0.5)), 9);
  });

  it('travel / heroTimeline 的端点与单调性', () => {
    expect(travel(0.12)).toBe(0);
    expect(travel(0.58)).toBeCloseTo(1, 9);
    expect(travel(0.5)).toBeCloseTo(0.9707643804586188, 12);
    expect(heroTimeline(0)).toBe(0);
    expect(heroTimeline(1)).toBe(1);
    expect(heroTimeline(0.5)).toBeCloseTo(0.3499988555930031, 9);
  });

  it('depthAt / lift / roll / columnInset / 网格', () => {
    expect(depthAt(0.5, 0.5, 0)).toBe(0);
    expect(depthAt(0.5, 0.5, 1)).toBe(0);
    expect(depthAt(0.5, 0.5, 0.5)).toBeCloseTo(21.572948992323848, 10);
    expect(lift(0)).toBe(0);
    expect(lift(0.18)).toBeCloseTo(18, 12);
    expect(roll(0)).toBeCloseTo(0, 12);
    expect(roll(0.5)).toBeCloseTo(-0.022499999999999992, 12);
    expect(meshRows(0.04878048780487805)).toHaveLength(49);
    expect(paperMeshPositions(0.5, 100, 200)).toHaveLength(33 * 17 * 2);
  });

  it('planeViewportPoints：斜切窗口四顶点', () => {
    const points = planeViewportPoints(1000, 800, 0.5, 1, 360);
    expect(points[0]).toBe(0);
    expect(points[2]).toBeCloseTo((1000 + 360) * 0.5, 12);
    expect(points[4]).toBeCloseTo((1000 + 360) * 0.5 - 360, 12);
    expect(points[7]).toBe(800);
    expect(planeViewportPoints(1000, 800, 0.5, -1, 360)[2]).toBeCloseTo(1000 - 680, 12);
  });
});

describe('封面飞行（列表卡片）/ 3D 书飞行桥', () => {
  it('coverFlightFramePlan：scrim、hero 矩形、lift/roll、不透明度', () => {
    const plan = need(
      coverFlightFramePlan({
        progress: 0.3,
        seamless: false,
        departing: true,
        begin: { left: 0, top: 0, right: 100, bottom: 100 },
        end: { left: 0, top: 0, right: 400, bottom: 800 },
        silhouetteBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        cornerRadiusPx: 6,
        density: 2,
      }),
      'plan',
    );
    expect(plan.scrimAlpha).toBe(1);
    expect(plan.rect.left).toBeCloseTo(0, 9);
    // 计划里的矩形已换算回 px（dp × density=2）
    expect(plan.rect.top).toBeCloseTo(-38.098969, 4);
    expect(plan.rect.right).toBeCloseTo(177.431159, 4);
    expect(plan.rect.bottom).toBeCloseTo(242.573737, 4);
    expect(plan.liftPx).toBeCloseTo(36, 9);
    expect(plan.rollDegrees).toBeCloseTo(-2.3574701735284966, 9);
    expect(plan.opacity).toBe(1);
    expect(plan.alpha).toBe(255);
    expect(plan.flightRadius).toBeCloseTo(6 * (1 - 0.216), 9);
    expect(plan.meshPositions).toHaveLength(33 * 17 * 2);
    // 起点/终点退化 → 不画
    expect(
      coverFlightFramePlan({
        progress: 0.3,
        seamless: false,
        departing: true,
        begin: { left: 0, top: 0, right: 0, bottom: 0 },
        end: { left: 0, top: 0, right: 400, bottom: 800 },
        silhouetteBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        cornerRadiusPx: 6,
        density: 2,
      }),
    ).toBeNull();
  });

  it('轮廓唇边只在行程两端出现', () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(coverSilhouettePlan(0.5, true, bounds, 56, 6)).toBeNull();
    expect(coverSilhouettePlan(0.5, false, bounds, 56, 6)).toBeNull();
    const out = need(coverSilhouettePlan(0.02, true, bounds, 56, 6), 'out');
    expect(out.lip.top).toBe(100);
    expect(out.radiusPx).toBe(6);
    expect(out.alpha).toBeGreaterThan(0);
    const back = need(coverSilhouettePlan(0.99, false, bounds, 56, 6), 'in');
    expect(back.alpha).toBeGreaterThan(0.9);
  });

  it('飞行桥：begin 校验 bounds、arrive 补 target、reverse 归位', () => {
    const started = coverFlightBegin(EMPTY_COVER_FLIGHT_STATE, {
      bookKey: 'b1',
      bounds: { left: 10, top: 20, right: 110, bottom: 220 },
      image: { width: 128, height: 206 },
      radiusPx: 14,
      returnBounds: null,
      seamless: true,
    });
    expect(started.request?.seamless).toBe(true);
    expect(started.request?.targetBounds).toBeNull();
    const empty = coverFlightBegin(EMPTY_COVER_FLIGHT_STATE, {
      bookKey: 'b2',
      bounds: { left: 0, top: 0, right: 0, bottom: 0 },
      image: null,
      radiusPx: 14,
      returnBounds: null,
      seamless: false,
    });
    expect(empty.request).toBeNull();
    const reversed = coverFlightReverse({ request: null, last: started.request }, 'b1');
    expect(reversed.request?.returning).toBe(true);
    expect(coverFlightReverse({ request: null, last: started.request }, 'nope').request).toBeNull();
  });

  it('coverFlightLayout：先裁比例再等比塞入', () => {
    const layout = coverFlightLayout(
      {
        bookKey: 'b1',
        sourceBounds: { left: 0, top: 0, right: 128, bottom: 206 },
        sourceImage: { width: 800, height: 1200 },
        sourceRadiusPx: 14,
        targetBounds: null,
        returning: false,
        returnBounds: null,
        seamless: false,
      },
      { left: 0, top: 0, right: 400, bottom: 800 },
    );
    expect(layout.image).toEqual({ width: 745, height: 1200 });
    expect(layout.target).toEqual({ left: 0, top: 0, right: 400, bottom: 800 });
    // 裁成 745x1200 后按 min(128/745, 206/1200) 缩放：高度正好 206，宽 127.89
    expect(layout.source.bottom - layout.source.top).toBeCloseTo(206, 9);
    expect(layout.source.left + layout.source.right).toBeCloseTo(128, 9);
  });

  it('阅读器落点：三态（content / hold / animate）', () => {
    expect(coverArrivalRenderState(false, false, false)).toBe('content');
    expect(coverArrivalRenderState(true, false, false)).toBe('hold');
    expect(coverArrivalRenderState(true, true, true)).toBe('content');
    expect(coverArrivalRenderState(true, false, true)).toBe('animate');
    expect(
      coverArrivalStart({ hasFrame: true, presented: false, started: false, reduceMotion: true }),
    ).toEqual({ started: false, presented: true, animate: false });
    expect(
      coverArrivalStart({ hasFrame: true, presented: false, started: false, reduceMotion: false }),
    ).toEqual({ started: true, presented: false, animate: true });
    expect(
      coverArrivalStart({ hasFrame: false, presented: false, started: false, reduceMotion: false }),
    ).toEqual({ started: false, presented: false, animate: false });
  });

  it('3D 书飞行：无贴图拒飞、publish、ARRIVE_P、归位 alpha', () => {
    const art = makeArt();
    const refused = volumeFlightBegin(
      { request: null, last: null, progress: 0, suppressRouteMotion: false },
      { bookKey: 'k', bookId: 7, art, restOx: 100, restOy: 50 },
    );
    expect(refused.started).toBe(false);

    const begun = volumeFlightBegin(
      { request: null, last: null, progress: 0, suppressRouteMotion: false },
      { bookKey: 'k', bookId: 7, art: makeArt({ cover: 7 }), restOx: 100, restOy: 50 },
    );
    expect(begun.started).toBe(true);
    expect(begun.state.suppressRouteMotion).toBe(true);
    const published = volumeFlightPublish(begun.state, 0.5);
    expect(published.progress).toBe(0.5);
    expect(published.request?.progress).toBe(0.5);
    expect(volumeFlightShouldArrive(false, false, 0.78)).toBe(true);
    expect(volumeFlightShouldArrive(false, false, 0.7799)).toBe(false);
    expect(volumeFlightShouldArrive(true, false, 1)).toBe(false);

    const finished = volumeFlightFinished(published, need(published.request, 'req'));
    expect(finished.request).toBeNull();
    expect(finished.last?.bookKey).toBe('k');
    const back = volumeFlightReverse(finished, 'k');
    expect(back.started).toBe(true);
    expect(back.state.request?.returning).toBe(true);
    expect(back.state.progress).toBe(1);
    expect(volumeFlightReverse(finished, 'other').started).toBe(false);
  });

  it('3D 书飞行姿态：p=0 与静止逐参数一致、p=.78 铺满视口', () => {
    const art = makeArt({ cover: 7 });
    const state = volumeFlightBegin(
      { request: null, last: null, progress: 0, suppressRouteMotion: false },
      { bookKey: 'k', bookId: 7, art, restOx: 100, restOy: 50 },
    ).state;
    const request = need(state.request, 'request');
    const viewport = { left: 0, top: 0, right: 1000, bottom: 800 };
    expect(volumeFlightPose(request, 0, viewport)).toEqual(restingPose(100, 50));
    const full = volumeFlightPose(request, VOLUME_ARRIVE_P, viewport);
    expect(full.depthX).toBe(1);
    expect(full.alpha).toBe(1);
    expect(full.ox).toBeCloseTo(500 - 64, 12);
    expect(full.oy).toBeCloseTo(400 - art.body / 2, 12);
  });
});

/* ───────────────────────────── 其他导出兜底 ───────────────────────────── */

describe('token/辅助导出的完整性', () => {
  it('WENKU_SHELF 的关键常量与 Kotlin 同值', () => {
    expect(WENKU_SHELF.depthX).toBe(0.66);
    expect(WENKU_SHELF.depthY).toBe(-0.16);
    expect(WENKU_SHELF.rowStep).toBe(2.5);
    expect(WENKU_SHELF.coverMinDp).toBe(100);
    expect(WENKU_SHELF.coverMaxDp).toBe(128);
    expect(WENKU_SHELF.spineMinDp).toBe(14);
    expect(WENKU_SHELF.spineMaxDp).toBe(18);
    expect(WENKU_SHELF.edgeSlotsPad).toBe(2);
    expect(WENKU_SHELF.drawBoxPadDp).toBe(12);
    expect(WENKU_SHELF.coverBitmapMinWidth).toBe(64);
    expect(WENKU_SHELF.coverBitmapMaxHeight).toBe(512);
  });

  it('WENKU_VOLUME 的材质/厚度常量', () => {
    expect(WENKU_VOLUME.materialCloth).toBe(0);
    expect(WENKU_VOLUME.materialMatte).toBe(1);
    expect(WENKU_VOLUME.materialGloss).toBe(2);
    expect(WENKU_VOLUME.clothTileSeed).toBe(11);
    expect(WENKU_VOLUME.codeAlpha).toBeCloseTo(0.62, 12);
    expect(WENKU_VOLUME.spineFillPositions).toEqual([0, 0.16, 0.34, 0.58, 0.82, 1]);
    expect(WENKU_VOLUME_FLIGHT.closeFadeIn).toBeCloseTo(120 / 720, 12);
  });

  it('颜色工具链（luminance / inkOn）在亮暗底上的分支', () => {
    expect(luminance(0xffffffff)).toBeCloseTo(1, 12);
    expect(luminance(0xff000000)).toBe(0);
    expect(luminance(0xff7fd8c8)).toBeGreaterThan(0.58);
    expect(inkOn(0xffffffff)).toBe(argb(255, 32, 30, 26));
    expect(inkOn(0xff000000)).toBe(argb(255, 246, 243, 236));
  });

  it('边缘常量与 Kotlin 的 extra slots / cull 因子一致', () => {
    expect(WENKU_SHELF.edgeSlotsPad).toBe(2);
    expect(WENKU_SHELF.cullFactor).toBe(1.8);
    expect(WENKU_SHELF.coverStoreCapacity).toBe(64);
    expect(WENKU_COVER_ART.edgeSampleWidthRate).toBe(0.16);
    expect(WENKU_COVER_ART.titleMaxAttempts).toBe(6);
    expect(WENKU_COVER_ART.titleShrink).toBe(0.88);
    expect(inkStartOf(0)).toBeCloseTo(1 / 3, 12);
  });
});

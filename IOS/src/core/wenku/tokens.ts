/**
 * Kotlin → TS 行号映射
 * ─────────────────────
 * `ui/wenku/WenkuTokens.kt`
 *   L31-95    object WenkuTokens（颜色 / 圆角 / 间距 / 字号 / 控件尺寸 / 抽屉常数）
 *             → WENKU_TOKENS / WENKU_RADII_DP / WENKU_SPACING_DP / WENKU_TYPE_SP
 *   L97-106   object WenkuShapes                → 圆角数值（本层只出 dp，不出 Shape）
 *   L108-118  object WenkuSpacing               → WENKU_SPACING_DP
 *   L121-220  object WenkuMotion                → WENKU_MOTION + 曲线控制点
 *   L222-238  data class WenkuColors            → ShelfColorsInput（types.ts）
 *   L240-266  wenkuColors()                     → wenkuColors(isDark)
 *   L316-319  wenkuSmooth                       → motion.ts `smoothStep`
 *   L322-348  WenkuReaderPhysics                → 未移植到本层（阅读器翻页，见 reader 模块）
 * `ui/wenku/ArchiveShelf.kt`
 *   L751-756  METRICS_* / SHELF_CENTRE_CURVE     → WENKU_SHELF
 *   L1086     COVER_RASTER_BUDGET                → WENKU_SHELF.coverRasterBudget
 *   L247-257  标题/封面位图尺寸                    → WENKU_SHELF.coverBitmap*
 * `ui/wenku/ShelfVolumeRender.kt`
 *   L104-113  ShelfOpenTimeline 常量             → WENKU_OPEN_TIMELINE
 *   L544-549  MATERIAL_* / CLOTH_TILE_SEED / CODE_ALPHA → WENKU_VOLUME
 * `ui/wenku/ShelfCoverArt.kt`
 *   L118-122  生成封面颜色                         → WENKU_COVER_ART
 * `ui/wenku/WenkuCoverFlight.kt`
 *   L81-92    WENKU_MESH_* / PI_F / BACKING_ARGB  → WENKU_FLIGHT
 * `ui/wenku/WenkuVolumeFlight.kt`
 *   L247-250  ARRIVE_P / CLOSE_FADE_IN            → WENKU_VOLUME_FLIGHT
 * `ui/wenku/WenkuReflow.kt`
 *   L77-96    REFLOW_* / WORKSPACE_*              → WENKU_REFLOW
 * `data/PreferencesManager.kt`
 *   L104-110  shelfUses3dView / favoritesUse3dView（默认 true）
 *   L126-130  SHELF_USES_3D_VIEW / FAVORITES_USE_3D_VIEW → WENKU_PREFERENCE_KEYS
 *
 * 未移植：
 * - `WenkuTokens.kt` L283-313 `rememberWenkuAccessibility` / `readHighContrast`
 *   （读系统设置与 Compose CompositionLocal，属 UI/平台层）
 * - L322-348 `WenkuReaderPhysics`（阅读器翻页提交物理，不属 3D 书架）
 */

import type { ColorArgb, ShelfColorsInput } from './types';

/** `0xAARRGGBB` 的无符号 32 位打包（Kotlin `Int` 常量）。 */
export const WENKU_TOKENS = {
  paperLight: 0xfff4f3ef,
  panelLight: 0xfffdfcfa,
  milkLight: 0xfffefdf8,
  inkLight: 0xff161613,
  inkSecondaryLight: 0xff646b62,

  paperDark: 0xff191919,
  panelDark: 0xff242424,
  milkDark: 0xfff6f6f6,
  raisedDark: 0xff2d2d2d,
  raisedHighDark: 0xff3a3a3a,
  outlineDark: 0xff3c3c3c,
  inkDark: 0xfff2f2f2,
  inkSecondaryDark: 0xffb7b7b7,

  /** `Color.Black.copy(alpha = .16f)`：alpha 单独给，不烘焙进 ARGB。 */
  scrimColor: 0xff000000,
  scrimAlpha: 0.16,

  /** `wenkuColors()` 亮色分支里 3D 书架会读到的两个额外的值（raised / raisedHigh/outline）。 */
  raisedLight: 0xfff7f5ef,
  raisedHighLight: 0xffefede6,
  outlineLight: 0xffd9d5ca,
} as const;

export const WENKU_RADII_DP = {
  panel: 4,
  cover: 3,
  glass: 28,
  iconButton: 24,
  pill: 22,
  textButton: 22,
  menu: 4,
  sheet: 28,
} as const;

export const WENKU_SPACING_DP = {
  hairline: 0.5,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  eight: 32,
  page: 20,
} as const;

export const WENKU_TYPE_SP = {
  display: 34,
  title: 24,
  section: 12,
  body: 15,
  caption: 12,
  micro: 10,
} as const;

export const WENKU_CONTROL_DP = {
  iconButtonSize: 46,
  iconButtonCompactWidth: 48,
  iconGlyph: 21,
  pillHeight: 54,
  pillThickness: 16,
  textButtonMinWidth: 64,
  textButtonMinHeight: 48,
  menuWidth: 248,
  menuMaxOverlayWidth: 440,
  sheetHandleWidth: 32,
  sheetHandleHeight: 3,
} as const;

export const WENKU_SHEET_DISMISS = {
  velocity: 550,
  fraction: 0.24,
} as const;

/** `WenkuTokens.kt` L121-156 的时长/常量词表。 */
export const WENKU_MOTION = {
  contactMs: 120,
  enterMs: 420,
  exitMs: 320,
  coverFlightMs: 1000,
  coverReturnMs: 840,

  pageClockMs: 620,
  paperTurnMs: 440,
  coverTurnMs: 340,
  fadeTurnMs: 300,
  slideTurnMs: 300,

  listWindow: 0.52,
  listDelayStep: 0.055,
  listMaxDelayBands: 8,

  dockFollow: 0.8,
  dockStretchFactor: 0.028,
  dockStretchLimit: 24,
  dockStretchLerp: 0.55,
  dockIdleMs: 100,
  dockProject: 0.055,
  dockProjectLimit: 0.22,
  dockVelocityClamp: 5,

  shelfFriction: 4.4,
  shelfHandoffPitch: 4,
  shelfWaveRadius: 1.48,

  readerCommitFraction: 0.1,
  readerCommitMinDp: 28,
  readerCommitMaxDp: 48,
  readerVelocityThreshold: 360,
  readerFastDistance: 8,
  readerSpringMaxVelocity: 2400,
} as const;

/** `WenkuTokens.kt` L158-171 的五条 `CubicBezierEasing` 控制点。 */
export const WENKU_CURVE_POINTS = {
  /** Curves.easeOutCubic */
  ease: [0.215, 0.61, 0.355, 1],
  /** Curves.easeInCubic */
  retract: [0.55, 0.055, 0.675, 0.19],
  settle: [0.2, 1.08, 0.34, 1],
  plane: [0.18, 0.72, 0.18, 1],
  heroX: [0.4, 0, 0.2, 1],
  /** `WenkuMotion.kt` L478 `readerLocationEase`（与 icon 的 easeInOutCubic 同参数）。 */
  readerLocation: [0.645, 0.045, 0.355, 1],
  /** `ArchiveShelf.kt` L756 `SHELF_CENTRE_CURVE`。 */
  shelfCentre: [0.2, 1.06, 0.35, 1],
  /** `WenkuReflow.kt` L96 `ReflowEasing`（与 plane 同参数）。 */
  reflow: [0.18, 0.72, 0.18, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** `WenkuTokens.kt` L174：`19f / (2f * sqrt(270f * 0.64f))`。 */
export const WENKU_SPRING_DAMPING_RATIO = 19 / (2 * Math.sqrt(270 * 0.64));

/** `WenkuTokens.kt` L177：`spring(dampingRatio, stiffness = 270f)`。 */
export const WENKU_SPRING_STIFFNESS = 270;

/** `ArchiveShelf.kt` L751-756 + L247-257 + L1086 的几何/封面常量。 */
export const WENKU_SHELF = {
  /** `METRICS_DEPTH_X`：封面面水平投影系数。 */
  depthX: 0.66,
  /** `METRICS_DEPTH_Y`：封面面垂直投影系数（负值 = 俯视）。 */
  depthY: -0.16,
  /** `METRICS_ROW_STEP`。 */
  rowStep: 2.5,
  /** `METRICS_RADIUS`：波浪半径（槽位）。 */
  waveRadius: 1.48,
  /** `METRICS_MAX_VIEWPORT = 520.dp`。 */
  maxViewportDp: 520,

  /** 书脊厚度 dp：`(width * .043).coerceIn(14, 18)`。 */
  spineRate: 0.043,
  spineMinDp: 14,
  spineMaxDp: 18,
  /** `pitch = spine + 11`。 */
  pitchGapDp: 11,
  /** 封面宽 dp：`(width * .32).coerceIn(100, 128)`。 */
  coverRate: 0.32,
  coverMinDp: 100,
  coverMaxDp: 128,
  /** `body = (cover - 20) * 166 / 118 + 54`。 */
  bodyInsetDp: 20,
  bodyRatioNumerator: 166,
  bodyRatioDenominator: 118,
  bodyConstantDp: 54,
  /** `baseY = -cover * depthY + body * .60 + 12`。 */
  baseYBodyFactor: 0.6,
  baseYConstantDp: 12,
  /** `rowHeight = baseY + body + 60`（参考实现；本 app 的绘制盒另算）。 */
  rowHeightTailDp: 60,
  /** 本 app 绘制盒：`baseYPx + bodyPx + 12dp`。 */
  drawBoxPadDp: 12,
  /** `footprint = spine + cover * depthX`。 */
  /** `pull = cover * .84`。 */
  pullRate: 0.84,
  /** `edgeSlots = ceil((w/2 + footprint + pull*depthX)/pitch) + 2`。 */
  edgeSlotsPad: 2,
  /** `weight = cos(d / 1.48 * pi/2)^2`。 */
  weightFactor: 1.24,
  weightBias: 0.24,

  /** 入场揭示：`tween(520, LinearEasing)`。 */
  revealMs: 520,
  /** `centre()` 的 `.01f` 容差。 */
  centreEpsilon: 0.01,
  /** `tap()` 的 `abs(slot - focus) < .30f`。 */
  tapFocusSlop: 0.3,
  /** `tap()` 落到中心书的 `coverPx * .42f` 判定。 */
  tapCenterTolerance: 0.42,
  /** 手势方向判定 `abs(dx) > abs(dy) * 1.2f`。 */
  dragAxisRatio: 1.2,
  /** `ShelfScrollSimulation` 的 `minVelocity = 50f * density`。 */
  scrollMinVelocityDp: 50,
  /** 惯性 tween 的 `durationMillis.coerceIn(1, 1400)`。 */
  inertiaMinMs: 1,
  inertiaMaxMs: 1400,

  /** `COVER_RASTER_BUDGET`。 */
  coverRasterBudget: 6,
  /** 封面位图宽：`coverPx.roundToInt().coerceIn(64, 288)`。 */
  coverBitmapMinWidth: 64,
  coverBitmapMaxWidth: 288,
  /** 封面位图高：`(width * body / cover).roundToInt().coerceIn(64, 512)`。 */
  coverBitmapMinHeight: 64,
  coverBitmapMaxHeight: 512,
  /** `ImageRequest.size(256)`。 */
  coverDecodeRequestPx: 256,
  /** `cull = coverPx * 1.8f`。 */
  cullFactor: 1.8,
  /** `ShelfCoverStore(capacity = 64)`。 */
  coverStoreCapacity: 64,
} as const;

/** `ShelfOpenTimeline`（ShelfVolumeRender.kt L102-176）。 */
export const WENKU_OPEN_TIMELINE = {
  openMs: 880,
  closeMs: 720,
  closeCoverInMs: 120,
  geometryEnd: 0.78,
  /** 转正区间：`(p - .02) / .62`。 */
  flattenStart: 0.02,
  flattenSpan: 0.62,
  /** 工艺收束：`(p - .30) / .44`。 */
  detailStart: 0.3,
  detailSpan: 0.44,
  /** 打开时淡出：`(p - .80) / .20`。 */
  alphaStart: 0.8,
  alphaSpan: 0.2,
} as const;

/** `ShelfVolumeRender.kt` L544-549 + L617-635 的厚度/高度/材质常量。 */
export const WENKU_VOLUME = {
  materialCloth: 0,
  materialMatte: 1,
  materialGloss: 2,
  clothTileSeed: 11,
  /** `clothTile()` 的 `size = 48`。 */
  clothTileSize: 48,
  clothTileWeaveEven: 10,
  clothTileWeaveOdd: -8,
  clothTileBase: 118,
  clothTileJitter: 46,
  clothTileCenter: 23,
  clothTileAlphaBase: 16,
  clothTileAlphaJitter: 22,
  codeAlpha: 0.62,
  /** 章节 → 页数：一章按 9 页估。 */
  pagesPerChapter: 9,
  /** 无章节时的页数兜底：`140 + (abs(id * 37) % 240)`。 */
  fallbackPagesBase: 140,
  fallbackPagesSeed: 37,
  fallbackPagesModulus: 240,
  /** 厚度：`clamp(6 + sqrt(pages) * .40, 7.5, 25)`。 */
  thicknessBaseDp: 6,
  thicknessSqrtRate: 0.4,
  thicknessMinDp: 7.5,
  thicknessMaxDp: 25,
  /** 高度差：`1 + swing * .07`，`swing = (abs(id*131) % 100)/100 - .5`。 */
  heightSeed: 131,
  heightSwing: 0.07,
  /** 材质：`abs(id * 17 + titleLength) % 3`。 */
  materialSeed: 17,
  materialModulus: 3,
  /** 书脊渐变 stop（L259-271）。 */
  spineFillPositions: [0, 0.16, 0.34, 0.58, 0.82, 1] as readonly number[],
  spineShadePositions: [0, 0.18, 0.36, 0.6, 0.86, 1] as readonly number[],
  /** 书脊圆柱半径：`min(t * .46f, palette.spineRadius)`。 */
  spineRadiusFactor: 0.46,
  /** 封面工艺细节。 */
  glossSheenRotationDeg: -14,
  glossSheenAlpha: 0.55,
  clothAlpha: 58,
  codeLineHeightFactor: 1.3,
  titleLineHeightFactor: 1.06,
  /** `drawVolume` 里 `cover < 4f || body < 4f` 直接 return。 */
  minFacePx: 4,
  /** `pose.alpha <= .004f` 直接 return。 */
  minAlpha: 0.004,
} as const;

/** `ShelfCoverArt.kt` L101-237 的生成封面常量。 */
export const WENKU_COVER_ART = {
  /** `widthPx.coerceAtLeast(32)` / `heightPx.coerceAtLeast(48)`。 */
  minWidth: 32,
  minHeight: 48,
  /** `unit = (width / 118f).coerceAtLeast(1f)`。 */
  unitBase: 118,
  backgroundTopLight: 0xfff4f3ef,
  backgroundBottomLight: 0xffeae7de,
  tintLight: 0xff7fd8c8,
  inkLight: 0xff161613,
  mutedLight: 0xff646b62,
  backgroundTopDark: 0xff2b2b29,
  backgroundBottomDark: 0xff232322,
  tintDark: 0xff9fd8c8,
  inkDark: 0xfff2f2f2,
  mutedDark: 0xffb7b7b7,
  /** 品牌色斜向光 alpha。 */
  brandGlowAlpha: 0.16,
  /** 边框：`max(1f, unit * .8f)`，颜色 `withAlpha(ink, dark ? .16 : .10)`。 */
  borderMinWidth: 1,
  borderUnit: 0.8,
  borderAlphaLight: 0.1,
  borderAlphaDark: 0.16,
  /** 图标：`iconW = width * .26f`、`iconH = iconW * .78f`、`iconY = height * .10f`。 */
  iconWidthRate: 0.26,
  iconHeightRate: 0.78,
  iconTopRate: 0.1,
  iconStrokeMin: 1.4,
  iconStrokeUnit: 1.9,
  iconAlpha: 0.7,
  iconRadiusUnit: 1.6,
  /** 书名：`textSize = unit * 13.5f`、宽 `width * .74f`、行距 1.12、最多 4 行。 */
  titleSizeUnit: 13.5,
  titleWidthRate: 0.74,
  titleMinWidth: 24,
  titleTopRate: 0.3,
  titleMaxHeightRate: 0.46,
  titleMaxLines: 4,
  titleShrink: 0.88,
  titleMaxAttempts: 6,
  titleLineSpacing: 1.12,
  /** 底部：`ruleY = height * .80`、作者 `textSize = unit * 8.2`。 */
  ruleYRate: 0.8,
  ruleMinWidth: 1,
  ruleUnit: 0.9,
  ruleAlpha: 0.45,
  authorSizeUnit: 8.2,
  authorAlpha: 0.92,
  authorLetterSpacing: 0.04,
  authorWidthRate: 0.64,
  authorBaselineUnit: 12,
  /** 格式标签：`textSize = unit * 7.4`、y = `height - height * .055`。 */
  tagSizeUnit: 7.4,
  tagAlpha: 0.95,
  tagLetterSpacing: 0.16,
  tagComicColor: 0xffff6b6b,
  tagBottomRate: 0.055,
  /** `dominantEdgeColor` 采样：左侧 16%，纵向最多 24 步，横向 6 步。 */
  edgeSampleWidthRate: 0.16,
  edgeSampleRows: 24,
  edgeSampleColumns: 6,
  /** `Color.DKGRAY`。 */
  edgeFallbackColor: 0xff444444,
  /** `cropCoverToAspect` 的容差。 */
  aspectTolerance: 0.02,
} as const;

/** `WenkuCoverFlight.kt` L81-92 + L226-243。 */
export const WENKU_FLIGHT = {
  meshColumns: 17,
  meshRows: 32,
  meshEdgeSamples: 8,
  piFloat: 3.1415927,
  backingColor: 0xff202020,
  referenceFaceWidth: 120,
  referenceFaceHeight: 164,
  cornerInset: 8,
  rectLiftLimit: 32,
  rectLiftBase: 12,
  rectLiftPerPixel: 0.075,
  bendFocal: 300,
  /** `travel = easeInOutCubic((p - .12) / .46)`。 */
  travelStart: 0.12,
  travelSpan: 0.46,
  depthPeelStart: 0.025,
  depthPeelSpan: 0.11,
  depthLandingStart: 0.58,
  depthLandingSpan: 0.42,
  depthMax: 17,
  depthRowWave: 7,
  depthBreeze: 3,
  /** scrim 包络：`rise = smooth(p/.12)`、`fall = smooth((p - .30)/.34)`。 */
  scrimRiseSpan: 0.12,
  scrimFallStart: 0.3,
  scrimFallSpan: 0.34,
  /** 交接：`opacity = 1 - smooth((p - .78)/.22)`。 */
  handoffStart: 0.78,
  handoffSpan: 0.22,
  /** 圆角随行程收直。 */
  cornerMinPx: 0.35,
  /** 轮廓唇边高度 `28f * density`。 */
  silhouetteLipDp: 28,
  silhouetteOutStart: 0.12,
  silhouetteInStart: 0.88,
  silhouetteSpan: 0.12,
  /** `seamless` 重映射：`.12 + .46 * (p / .58)`。 */
  seamlessReach: 0.58,
  /** `paintBounds = rectDp.inflate(28f)`。 */
  paintInflateDp: 28,
} as const;

/** `WenkuVolumeFlight.kt` L247-250。 */
export const WENKU_VOLUME_FLIGHT = {
  /** `ARRIVE_P`：封面铺满、切路由。 */
  arriveP: 0.78,
  /** `HANDOFF_P`：书架让位点（必须为 0）。 */
  handoffP: 0,
  /** `LAST` 保持的归位淡入比例：`CLOSE_COVER_IN_MS / CLOSE_MS`。 */
  closeFadeIn: WENKU_OPEN_TIMELINE.closeCoverInMs / WENKU_OPEN_TIMELINE.closeMs,
} as const;

/** `WenkuReflow.kt` L77-96。 */
export const WENKU_REFLOW = {
  durationMs: 420,
  workspaceCloseMs: 280,
  staggerStep: 0.025,
  staggerBands: 9,
  riseDp: 10,
  wideMinWidthDp: 1000,
  wideMinHeightDp: 500,
  maxWidthDp: 1200,
  selectedMaxWidthDp: 1440,
  gapDp: 24,
  /** 视口/尺寸插值里的"同尺寸"容差：`abs(source - layout) < .5f`。 */
  sizeEpsilon: 0.5,
} as const;

/** `PreferencesManager.kt` L104-110 / L126-130。 */
export const WENKU_PREFERENCE_KEYS = {
  shelfUses3dView: 'shelf_uses_3d_view',
  favoritesUse3dView: 'favorites_use_3d_view',
  /** 两个开关的 Kotlin 默认值都是 true。 */
  defaultUses3dView: true,
} as const;

/** `ArchiveShelf.kt` L1097-1102：没有贴图时的兜底书脊色（必须纸色系）。 */
export const WENKU_FALLBACK_TINTS: readonly ColorArgb[] = [
  0xffefe9dc, 0xffd9c9ae, 0xffc9c2b4, 0xffdcd3c2,
] as const;

/** `wenkuColors()` 的纯数据版本：`isDark` 决定全部 9 个字段。 */
export function wenkuColors(isDark: boolean): ShelfColorsInput {
  return isDark
    ? {
        isDark: true,
        milk: WENKU_TOKENS.milkDark,
        outline: WENKU_TOKENS.outlineDark,
        ink: WENKU_TOKENS.inkDark,
        inkSecondary: WENKU_TOKENS.inkSecondaryDark,
      }
    : {
        isDark: false,
        milk: WENKU_TOKENS.milkLight,
        outline: WENKU_TOKENS.outlineLight,
        ink: WENKU_TOKENS.inkLight,
        inkSecondary: WENKU_TOKENS.inkSecondaryLight,
      };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * `WenkuTokens.kt` 后半段（L97-348）的逐项移植
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** L97-106 `object WenkuShapes`：8 个命名圆角（dp）。 */
export const WenkuShapes = {
  Panel: WENKU_RADII_DP.panel,
  Cover: WENKU_RADII_DP.cover,
  Glass: WENKU_RADII_DP.glass,
  IconButton: WENKU_RADII_DP.iconButton,
  Pill: WENKU_RADII_DP.pill,
  TextButton: WENKU_RADII_DP.textButton,
  Menu: WENKU_RADII_DP.menu,
  Sheet: WENKU_RADII_DP.sheet,
} as const;

/** L108-118 `object WenkuSpacing`。 */
export const WenkuSpacing = {
  Hairline: WENKU_SPACING_DP.hairline,
  One: WENKU_SPACING_DP.one,
  Two: WENKU_SPACING_DP.two,
  Three: WENKU_SPACING_DP.three,
  Four: WENKU_SPACING_DP.four,
  Five: WENKU_SPACING_DP.five,
  Six: WENKU_SPACING_DP.six,
  Eight: WENKU_SPACING_DP.eight,
  Page: WENKU_SPACING_DP.page,
} as const;

/** L222-238 `data class WenkuColors`。 */
export interface WenkuColors {
  readonly paper: number;
  readonly panel: number;
  readonly milk: number;
  readonly raised: number;
  readonly raisedHigh: number;
  readonly outline: number;
  readonly ink: number;
  readonly inkSecondary: number;
  readonly isDark: boolean;
}

/** L234 `glassTint = milk.copy(alpha = if (isDark) .024f else .010f)`。 */
export function wenkuGlassTintAlpha(isDark: boolean): number {
  return isDark ? 0.024 : 0.01;
}

/** L235 `hairline = ink.copy(alpha = if (isDark) .14f else .10f)`。 */
export function wenkuHairlineAlpha(isDark: boolean): number {
  return isDark ? 0.14 : 0.1;
}

/** L236 `selection = ink.copy(alpha = if (isDark) .10f else .07f)`。 */
export function wenkuSelectionAlpha(isDark: boolean): number {
  return isDark ? 0.1 : 0.07;
}

/** L240-266 `wenkuColors()` 的全字段版本（`ShelfColorsInput` 只带 kit 用到的那几个）。 */
export function wenkuColorSet(isDark: boolean): WenkuColors {
  return isDark
    ? {
        paper: WENKU_TOKENS.paperDark,
        panel: WENKU_TOKENS.panelDark,
        milk: WENKU_TOKENS.milkDark,
        raised: WENKU_TOKENS.raisedDark,
        raisedHigh: WENKU_TOKENS.raisedHighDark,
        outline: WENKU_TOKENS.outlineDark,
        ink: WENKU_TOKENS.inkDark,
        inkSecondary: WENKU_TOKENS.inkSecondaryDark,
        isDark: true,
      }
    : {
        paper: WENKU_TOKENS.paperLight,
        panel: WENKU_TOKENS.panelLight,
        milk: WENKU_TOKENS.milkLight,
        raised: WENKU_TOKENS.raisedLight,
        raisedHigh: WENKU_TOKENS.raisedHighLight,
        outline: WENKU_TOKENS.outlineLight,
        ink: WENKU_TOKENS.inkLight,
        inkSecondary: WENKU_TOKENS.inkSecondaryLight,
        isDark: false,
      };
}

/** L283-288 `data class WenkuAccessibility`。 */
export interface WenkuAccessibility {
  readonly highContrast: boolean;
  readonly reduceMotion: boolean;
  readonly blurEnabled: boolean;
  readonly decorativeMotion: boolean;
}

/**
 * L307-313 `readHighContrast(context)`：Android 读三个 `Settings.Secure/Global` 键。
 * Web 等价物是系统对比度偏好 `prefers-contrast: more`（同一份无障碍设置）。
 */
export function readHighContrast(matches: (query: string) => boolean): boolean {
  try {
    return matches('(prefers-contrast: more)') || matches('(forced-colors: active)');
  } catch {
    return false;
  }
}

/** L316-319 `wenkuSmooth(t) = x*x*(3 - 2x)`。 */
export function wenkuSmooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** L322-348 `object WenkuReaderPhysics`。 */
export const WenkuReaderPhysics = {
  /** L323-328 `commitDistancePx(viewportPx, density)`。 */
  commitDistancePx(viewportPx: number, density: number): number {
    return Math.min(
      Math.max(viewportPx * WENKU_MOTION.readerCommitFraction, WENKU_MOTION.readerCommitMinDp * density),
      WENKU_MOTION.readerCommitMaxDp * density,
    );
  },
  /** L334-347 `commit(viewportPx, deltaPx, velocityPx, density)`。 */
  commit(
    viewportPx: number,
    deltaPx: { readonly x: number; readonly y: number },
    velocityPx: { readonly x: number; readonly y: number },
    density: number,
  ): boolean {
    const distance = Math.abs(deltaPx.x);
    const speed = Math.abs(velocityPx.x);
    const velocityThreshold = WENKU_MOTION.readerVelocityThreshold * density;
    const reversing = speed >= velocityThreshold && velocityPx.x * deltaPx.x < 0;
    const fast = speed >= velocityThreshold && distance >= WENKU_MOTION.readerFastDistance * density;
    const commitDistance = WenkuReaderPhysics.commitDistancePx(viewportPx, density);
    return !reversing && (distance >= commitDistance || fast);
  },
};

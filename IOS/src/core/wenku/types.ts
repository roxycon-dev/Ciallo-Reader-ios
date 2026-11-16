/**
 * Kotlin → TS 行号映射（纯数据结构层）
 * ────────────────────────────────────
 * `ui/wenku/ShelfVolumeRender.kt`
 *   L37-52    ShelfVolumePose                 → ShelfVolumePose
 *   L55-65    RESTING_VOLUME_POSE             → RESTING_VOLUME_POSE（volumeRender.ts）
 *   L68-86    ShelfVolumeArt                  → ShelfVolumeArt（cover 位图换成 CoverTextureId）
 *   L89       SpineRun                        → SpineRun
 *   L585-614  ShelfPalette                    → ShelfPalette / ShelfColorsInput
 * `ui/wenku/ArchiveShelf.kt`
 *   L765-778  ShelfMetrics 字段                → ShelfMetrics 字段（shelfMetrics.ts）
 *   L989-1020 ShelfVolume（private）            → ShelfVolume
 *   L1075-1082 shelfWarmWindow 结果            → VisibleSlot / number[]
 * `ui/wenku/WenkuCoverFlight.kt`
 *   L99-117   WenkuFlightRect                 → FlightRect
 *   L426-437  WenkuCoverSource / Target       → CoverFlightSource / CoverFlightTarget
 * `ui/wenku/WenkuVolumeFlight.kt`
 *   L41-55    WenkuVolumeFlightRequest        → VolumeFlightRequest
 * `ui/wenku/WenkuFlightBridge.kt`
 *   L26-41    WenkuFlightRequest              → CoverFlightRequest
 * `ui/wenku/WenkuReflow.kt`
 *   L112-313  WenkuReflowState 的可观察面      → ReflowRect / ReflowItemTransform
 *
 * 未移植（本文件不做，属 UI 层）：
 * - `ArchiveShelf.kt` L176-597 的 @Composable / Modifier / pointerInput 生命周期
 * - `ShelfVolumeRender.kt` L182-541 ShelfVolumeArtist 的 Canvas 调用（几何部分见 volumeRender.ts）
 *
 * 约定：所有坐标都是 px；颜色是 `0xAARRGGBB` 的 number（Android `Int` 语义，含符号位；
 * 本层统一用 `>>> 0` 归一化的无符号 32 位值，避免 Kotlin `Int` 溢出为负数）。
 */

/** Android `Color` 打包值（0xAARRGGBB），始终以无符号 32 位保存。 */
export type ColorArgb = number;

/** 封面贴图句柄。core 层不持有像素，只持有"这本书有贴图"的身份（= book id）。 */
export type CoverTextureId = number;

/** `MATERIAL_CLOTH = 0` / `MATERIAL_MATTE = 1` / `MATERIAL_GLOSS = 2`。 */
export type MaterialKind = 0 | 1 | 2;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Size2 {
  readonly width: number;
  readonly height: number;
}

export interface RectF {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Android `Matrix.setValues` 的 3x3 行主序。 */
export interface Matrix3 {
  readonly values: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

/** 四边形：`[origin, origin+front, origin+front+depth, origin+depth]` 顺序与原实现一致。 */
export interface Quad {
  readonly points: readonly [Vec2, Vec2, Vec2, Vec2];
}

export interface LineSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GradientStop {
  readonly color: ColorArgb;
  readonly position: number;
}

export interface LinearGradientPlan {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stops: readonly GradientStop[];
}

/** 文本绘制的纯参数（UI 层自行选字体：monospace / serif）。 */
export interface TextRunPlan {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly letterSpacing: number;
  readonly color: ColorArgb;
  readonly alpha: number;
  readonly monospace: boolean;
  readonly bold: boolean;
}

export interface FillRectPlan {
  readonly rect: RectF;
  readonly color: ColorArgb;
  readonly alpha: number;
}

export interface StrokeLinePlan {
  readonly segment: LineSegment;
  readonly color: ColorArgb;
  readonly alpha: number;
  readonly width: number;
}

export interface BitmapDrawPlan {
  readonly source: RectF;
  readonly destination: RectF;
  readonly alpha: number;
}

/* ───────────────────────────── 书 / 卷 ───────────────────────────── */

/** `archive_spine_title.dart` L5：拉丁连排、CJK 单字。 */
export interface SpineRun {
  readonly text: string;
  readonly latin: boolean;
}

/** `data/Book` 里 3D 书架真正读到的字段（其余字段与本层无关）。 */
export interface BookSource {
  readonly id: number;
  readonly title: string;
  readonly author: string;
  readonly isComic: boolean;
  readonly totalChapters: number;
  readonly lastReadTime: number;
}

export interface ShelfVolume {
  readonly id: number;
  readonly title: string;
  readonly number: string;
  readonly coverCode: string;
  readonly fileCode: string;
  readonly runs: readonly SpineRun[];
  readonly truncated: boolean;
  readonly chapters: number;
}

/* ───────────────────────────── 姿态 ───────────────────────────── */

/** `ShelfVolumeRender.kt` L37-52。 */
export interface ShelfVolumePose {
  readonly ox: number;
  readonly oy: number;
  readonly depthX: number;
  readonly depthY: number;
  readonly skew: number;
  readonly thicknessScale: number;
  readonly detail: number;
  readonly alpha: number;
  readonly scale: number;
}

/* ───────────────────────────── 调色 ───────────────────────────── */

/** `wenkuColors()` 里 3D 书架用到的 5 个字段（`WenkuTokens.kt` L240-266）。 */
export interface ShelfColorsInput {
  readonly isDark: boolean;
  readonly milk: ColorArgb;
  readonly outline: ColorArgb;
  readonly ink: ColorArgb;
  readonly inkSecondary: ColorArgb;
}

/** `ShelfVolumeRender.kt` L585-614。 */
export interface ShelfPalette {
  readonly isDark: boolean;
  readonly densityUnit: number;
  readonly floorInk: ColorArgb;
  readonly border: ColorArgb;
  readonly ink: ColorArgb;
  readonly secondary: ColorArgb;
  readonly paper: ColorArgb;
  readonly paperDeep: ColorArgb;
  readonly pageLine: ColorArgb;
  readonly highlight: ColorArgb;
  readonly codeSize: number;
  readonly codeLine: number;
  readonly codeSpacing: number;
  readonly titleSize: number;
  readonly titleLine: number;
  readonly spinePadV: number;
  readonly gapAfterNumber: number;
  readonly gapBeforeDot: number;
  readonly dotRadius: number;
  readonly dotSize: number;
  readonly hairline: number;
  readonly pageInset: number;
  readonly overhang: number;
  readonly spineRadius: number;
  readonly hingeWidth: number;
}

/* ───────────────────────────── 素材 ───────────────────────────── */

/** `ShelfVolumeRender.kt` L68-86；`cover` 由 UI 层的 ImageBitmap 换成贴图身份。 */
export interface ShelfVolumeArt {
  readonly id: number;
  readonly coverWidth: number;
  readonly body: number;
  readonly thickness: number;
  readonly topInset: number;
  readonly tint: ColorArgb;
  readonly material: MaterialKind;
  readonly cover: CoverTextureId | null;
  readonly number: string;
  readonly fileCode: string;
  readonly runs: readonly SpineRun[];
  readonly truncated: boolean;
  readonly palette: ShelfPalette;
  readonly unit: number;
}

/** 已解码位图的尺寸（`ImageBitmap.width/height`）。 */
export interface BitmapSize {
  readonly width: number;
  readonly height: number;
}

/* ───────────────────────────── 绘制计划 ───────────────────────────── */

/** 书脊细节：堵头布 + 分隔线 + 编号（`ShelfVolumeRender.kt` L498-533）。 */
export interface SpineDetailPlan {
  readonly headBands: readonly FillRectPlan[];
  readonly separators: readonly StrokeLinePlan[];
  readonly numberText: TextRunPlan | null;
}

export interface CoverSheenPlan {
  readonly rotationDeg: number;
  readonly rect: RectF;
  readonly gradient: LinearGradientPlan;
  readonly alpha: number;
}

export interface CoverClothPlan {
  readonly alpha: number;
  readonly tileScale: number;
}

/** `ShelfVolumeArtist.drawVolume` 的完整几何/绘制参数（L319-495）。 */
export interface VolumeDrawPlan {
  readonly visible: boolean;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly scale: number;
  readonly coverWidth: number;
  readonly body: number;
  readonly thickness: number;
  readonly ink: number;
  readonly detail: number;
  readonly alpha255: number;
  readonly dx: number;
  readonly dy: number;
  readonly topFace: { readonly quad: Quad; readonly color: ColorArgb; readonly alpha: number };
  readonly pageFace: { readonly quad: Quad; readonly color: ColorArgb; readonly alpha: number };
  /** `pageShades` 的裁剪路径（Kotlin `canvas.clipPath(pagePath)`）。 */
  readonly pageClip: Quad;
  readonly pageLines: readonly StrokeLinePlan[];
  readonly pageShades: readonly FillRectPlan[];
  readonly foreEdgeHairline: StrokeLinePlan;
  readonly spine: {
    readonly matrix: Matrix3;
    readonly rect: RectF;
    readonly radius: number;
    readonly fillGradient: LinearGradientPlan;
    readonly fillAlpha: number;
    readonly wrapSource: RectF | null;
    readonly wrapDestination: RectF | null;
    readonly wrapAlpha: number;
    readonly shadeGradient: LinearGradientPlan;
    readonly shadeAlpha: number;
    readonly details: SpineDetailPlan;
  };
  readonly hingeCenterLine: StrokeLinePlan;
  readonly cover: {
    readonly matrix: Matrix3;
    readonly rect: RectF;
    readonly baseColor: ColorArgb;
    readonly baseAlpha: number;
    readonly bitmap: BitmapDrawPlan | null;
    readonly sheen: CoverSheenPlan | null;
    readonly cloth: CoverClothPlan | null;
    readonly shades: readonly FillRectPlan[];
    readonly hingeRects: readonly FillRectPlan[];
    readonly chamfers: readonly StrokeLinePlan[];
    readonly codeText: TextRunPlan;
  };
}

/** `ArchiveShelf.kt` L1213-1238 `buildFloor` 的六边形与墨水渐变。 */
export interface FloorPlan {
  readonly points: readonly Vec2[];
  readonly bounds: RectF;
  readonly gradient: LinearGradientPlan;
}

/* ───────────────────────────── 书架构图输出 ───────────────────────────── */

/** 一个"会被画到屏幕上的槽位"（`ShelfScenePainter.draw` L1240-1337）。 */
export interface VisibleSlot {
  readonly slot: number;
  readonly distance: number;
  readonly bookIndex: number;
  /** 不含 origin 的地面锚点（`startX + distance*pitch`）。 */
  readonly restX: number;
  /** `railY(distance)`。 */
  readonly restY: number;
  /** `restX + originX(distance)`，即书的左上后角 x。 */
  readonly x: number;
  /** `restY + originY(distance) + lift`。 */
  readonly y: number;
  /** 地面阴影的平移锚点（`restX, restY + baseY + body`）。 */
  readonly floorX: number;
  readonly floorY: number;
  /** 入场墨水进度（0..1）。 */
  readonly ink: number;
  /** 载入波纹上浮（px，负值向上）。 */
  readonly liftPx: number;
  /** 正在被覆盖层接手的那一本：本帧不画。 */
  readonly hidden: boolean;
}

export interface ShelfFrameInput {
  readonly logicalFocus: number;
  readonly entrance: number;
  readonly frameNanos: number;
  readonly reduceMotion: boolean;
  readonly flyingBookId: number | null;
  readonly flyingProgress: number;
}

export type TapAction =
  | { readonly kind: 'open'; readonly bookIndex: number }
  | { readonly kind: 'openActive' }
  | { readonly kind: 'centre'; readonly bookIndex: number }
  | { readonly kind: 'none' };

export interface CentreStep {
  readonly base: number;
  readonly k: number;
  readonly destination: number;
  /** |logicalFocus - destination| < .01 时为 true（原实现直接 return）。 */
  readonly skip: boolean;
}

export interface SemanticBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CoverBitmapSize {
  readonly width: number;
  readonly height: number;
}

/* ───────────────────────────── 封面素材 ───────────────────────────── */

/** `rasterizeShelfCover` L70-95：等价于 `centerCrop` 的变换参数。 */
export interface RasterCoverPlan {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly drawnWidth: number;
  readonly drawnHeight: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly clip: RectF;
  readonly bounds: RectF;
}

/** `cropCoverToAspect`（WenkuFlightBridge.kt L114-135）的裁切矩形。 */
export interface CoverCropPlan {
  readonly crop: RectF;
}

export interface TextLayoutMetrics {
  readonly height: number;
  readonly lineCount: number;
}

/** StaticLayout 的替代：UI 层注入的纯测量函数（返回高度与行数）。 */
export type TextMeasure = (
  text: string,
  textSizePx: number,
  widthPx: number,
  maxLines: number,
) => TextLayoutMetrics;

/** `Paint.measureText` 的替代：只需要宽度（居中/省略号判定用）。 */
export type MeasureTextWidth = (text: string, textSizePx: number, letterSpacing: number) => number;

export interface GeneratedCoverInput {
  readonly title: string;
  readonly author: string;
  readonly tag: string;
  readonly dark: boolean;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface GeneratedCoverPlan {
  readonly width: number;
  readonly height: number;
  readonly unit: number;
  readonly paperTop: ColorArgb;
  readonly paperBottom: ColorArgb;
  readonly tint: ColorArgb;
  readonly ink: ColorArgb;
  readonly muted: ColorArgb;
  readonly backgroundGradient: LinearGradientPlan;
  readonly lightGradient: LinearGradientPlan;
  readonly border: { readonly rect: RectF; readonly width: number; readonly color: ColorArgb };
  readonly icon: {
    readonly rect: RectF;
    readonly strokeWidth: number;
    readonly color: ColorArgb;
    readonly radius: number;
    readonly spineLine: LineSegment;
  };
  readonly title: {
    readonly text: string;
    readonly textSize: number;
    readonly widthPx: number;
    readonly translateX: number;
    readonly translateY: number;
    readonly maxLines: number;
    readonly lineSpacingMultiplier: number;
    readonly attempts: number;
    readonly color: ColorArgb;
  };
  readonly rule: { readonly segment: LineSegment; readonly width: number; readonly color: ColorArgb };
  readonly author: {
    readonly text: string;
    readonly textSize: number;
    readonly letterSpacing: number;
    readonly color: ColorArgb;
    readonly x: number;
    readonly y: number;
    readonly maxWidthPx: number;
  };
  readonly tag: {
    readonly text: string;
    readonly textSize: number;
    readonly letterSpacing: number;
    readonly color: ColorArgb;
    readonly x: number;
    readonly y: number;
  };
}

/** `dominantEdgeColor` L240-261 的采样计划。 */
export interface EdgeColorSamplePlan {
  readonly sampleWidth: number;
  readonly stepX: number;
  readonly stepY: number;
  readonly count: number;
}

/* ───────────────────────────── 飞行 ───────────────────────────── */

/** `WenkuCoverFlight.kt` L99-117。 */
export interface FlightRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CoverFlightSource {
  readonly bounds: RectF;
  /** null = 没有快照贴图（`image == null`）。 */
  readonly image: BitmapSize | null;
  readonly cornerRadiusPx: number;
}

export interface CoverFlightTarget {
  readonly bounds: RectF;
  readonly image: BitmapSize | null;
  readonly cornerRadiusPx: number;
}

/** `WenkuCoverFlight.kt` L648-788 `drawWenkuCoverFlight` 的每帧参数。 */
export interface CoverFlightFramePlan {
  readonly scrimAlpha: number;
  readonly rect: FlightRect;
  readonly paintBounds: FlightRect;
  readonly liftPx: number;
  readonly rollDegrees: number;
  readonly opacity: number;
  readonly alpha: number;
  readonly flightRadius: number;
  readonly meshPositions: readonly number[];
  readonly occlusion: { readonly lip: RectF; readonly radiusPx: number; readonly alpha: number } | null;
}

/** `WenkuVolumeFlight.kt` L41-55。 */
export interface VolumeFlightRequest {
  readonly bookKey: string;
  readonly bookId: number;
  /** 贴图身份；null = 没有贴图（begin 会拒绝起飞）。 */
  readonly cover: CoverTextureId | null;
  readonly art: ShelfVolumeArt;
  readonly restOx: number;
  readonly restOy: number;
  readonly returning: boolean;
  readonly progress: number;
}

/** `WenkuFlightBridge.kt` L26-41。 */
export interface CoverFlightRequest {
  readonly bookKey: string;
  readonly sourceBounds: RectF;
  readonly sourceImage: BitmapSize | null;
  readonly sourceRadiusPx: number;
  readonly targetBounds: RectF | null;
  readonly returning: boolean;
  readonly returnBounds: RectF | null;
  readonly seamless: boolean;
}

/** `object WenkuFlightBridge` 的可观察状态（request + last）。 */
export interface CoverFlightState {
  readonly request: CoverFlightRequest | null;
  readonly last: CoverFlightRequest | null;
}

/** `object WenkuVolumeFlightBridge` 的可观察状态（request + progress + last + 路由抑制）。 */
export interface VolumeFlightState {
  readonly request: VolumeFlightRequest | null;
  readonly last: VolumeFlightRequest | null;
  readonly progress: number;
  readonly suppressRouteMotion: boolean;
}

/* ───────────────────────────── 重排 ───────────────────────────── */

export interface ReflowItemTransform {
  readonly translationX: number;
  readonly translationY: number;
  readonly alpha: number;
  readonly clip: Size2 | null;
}

export interface SplitWorkspaceLayout {
  readonly wide: boolean;
  readonly selected: boolean;
  readonly total: number;
  readonly split: number;
  readonly master: number;
  readonly masterLeft: number;
  readonly detailLeft: number;
  readonly detailWidth: number;
  readonly listHidden: boolean;
}

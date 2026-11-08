/**
 * comicReaderCore.ts — 逐行移植 Android `ComicReaderCore.kt` 中与 Compose 无关的纯逻辑。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderCore.kt (2121 行)
 * TS 目标:   IOS/src/core/comic/comicReaderCore.ts
 *
 * 移植统计:
 *   - Kotlin 源文件 2121 行 / 本文件 ported 段 ~640 行(含注释)
 *   - 纯函数与状态机 100% 移植(见下方 Ported sections)
 *   - skipped 见文件末尾 "Skipped" 表
 *
 * 移植统计:
 *   - Kotlin 源文件 2121 行
 *   - 本文件 ported: 上表 15 个纯函数/类型/状态机段（Kotlin 约 420 行含注释）
 *     全部 1:1 移植；另有 5 段"依赖模块镜像"（ComicPageLayout.kt 的
 *     engineFadeAlpha / verticalPreloadIndices / isWidePage / buildComicLayout、
 *     ComicChapterEdgeGesture.kt 的 comicChapterEdgeTarget、
 *     ComicImagePipeline.kt 的 hasWork/enhanceEstimateSec/imagePipelineFingerprint、
 *     ComicReaderConfig.kt 的 imagePipelineFingerprint、
 *     ComicScrollMetrics.kt 的消费侧契约）逐行镜像并逐条标注来源。
 *   - skipped: 全部 UI/平台段，见文件末尾 "Skipped"。
 *
 * Ported sections (Kotlin 行号 → 本文件):
 *   107        ComicTocEntry                → ComicTocEntry
 *   110        ComicPanel 枚举               → ComicPanel
 *   118        LocalComicTranslationEpoch    → comicTranslationEpochContext (类型说明, 无 Compose)
 *   129-134    curlEngineActive             → curlEngineActive
 *   142-147    panelGlassSamplingActive     → panelGlassSamplingActive
 *   155-168    ComicVolumeKeyBridge         → ComicVolumeKeyBridge
 *   752-763    toneOf                       → toneOf
 *   770-773    effectiveSplitPosition       → effectiveSplitPosition
 *   788-807    resolveTapAction             → resolveTapAction
 *   811-815    PageBitmapState              → PageBitmapState
 *   905-910    fadeCancelOffset             → fadeCancelOffset
 *   918-919    fadeCrossAlpha               → fadeCrossAlpha
 *   1078-1088  dampEdgeDrag                 → dampEdgeDrag
 *   1094-1111  magneticTargetShift          → magneticTargetShift
 *   1642-1689  fittedSize (x2)              → fittedSize / fittedSizeWithCustom
 *   1696-1715  visibleIntrinsicRect         → visibleIntrinsicRect
 *   2117-2121  enhanceHintFor               → enhanceHintFor
 *
 * Platform adaptations (documented inline):
 *   - Kotlin `Float` → `number`; `Long` → `number`;
 *     `Size`/`RectF` → `ComicSize`/`ComicRectF`(自带 width()/height())。
 *   - Android `Bitmap` → 注入式 `ComicBitmap`({ src, width, height });解码器不实现,
 *     只声明端口 `ComicPageLoaderPort`(见下方 "Injected decoder port")。
 *   - Kotlin `Color(0xAARRGGBB)` 字面量在 UI 层转换为 CSS,本文件只保留数值常量。
 */

/* ─────────────────────────── 目录 / 面板 ─────────────────────────── */

/** 目录条目（在线=章节；本地=页码） */
export interface ComicTocEntry {
  readonly id: string;
  readonly title: string;
}

/** 面板层级 */
export type ComicPanel = 'NONE' | 'SETTINGS' | 'TOC' | 'PRESET' | 'CROP';

/**
 * 漫画翻译烘焙代数（第十五轮）：每次译文位图替换缓存后 +1。
 * rememberPageBitmap 把它纳入 produceState 键——同 cacheKey 的位图被
 * 烘焙版本替换后重新播种（缓存命中即换图，不重解码）；CURL 引擎把它
 * 纳入预载 effect 键，重推纹理。
 *
 * Kotlin: `val LocalComicTranslationEpoch = compositionLocalOf { 0 }`
 * Web: 无 CompositionLocal；代数由外部（翻译协调器实现）以 prop 传入，
 * 本文件只导出缺省常量。
 */
export const DEFAULT_COMIC_TRANSLATION_EPOCH = 0;

/* ─────────────────────────── 配置模型（类型镜像） ─────────────────────────── */

/**
 * 以下类型只镜像 `ComicReaderConfig.kt` / `ComicPageLayout.kt` 中
 * ComicReaderCore.kt 实际消费的字段（那两个模块不在本次移植范围）。
 * 字段名、默认值与 Kotlin 一一对应，保证字符串/数值字面量不变。
 */

export type ComicMode = 'SINGLE' | 'DOUBLE' | 'WEBTOON' | 'CONTINUOUS' | 'MAGNETIC';
export type ComicDirection = 'LTR' | 'RTL' | 'TTB';
export type ComicFit =
  | 'FIT_WIDTH'
  | 'FIT_HEIGHT'
  | 'ORIGINAL'
  | 'FILL'
  | 'STRETCH'
  | 'FIT_PAGE'
  | 'CUSTOM';
export type ComicDoubleAlign = 'TOP' | 'CENTER' | 'BOTTOM';
export type ComicCropMode = 'OFF' | 'WHITE' | 'BLACK' | 'AUTO';
export type ComicEnhanceMode = 'OFF' | 'CAS' | 'ANIME4K' | 'WAIFU2X' | 'SUPER_RES';
export type ComicBgType = 'BLACK' | 'WHITE' | 'GRAY' | 'PAPER' | 'DYNAMIC';
export type ComicPageAnim = 'NONE' | 'SLIDE' | 'FADE' | 'CURL';
export type ComicGestureAction =
  | 'NONE'
  | 'PREV'
  | 'NEXT'
  | 'TOGGLE_CONTROLS'
  | 'TOC'
  | 'SETTINGS'
  | 'EXIT';

export interface ComicManualCrop {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ComicReaderConfig {
  /* ── 阅读模式 ── */
  readonly mode: ComicMode;
  readonly direction: ComicDirection;
  /** 条漫模式磁吸到页边界（第 6/7 条：可关闭；无缝滚动恒无磁吸） */
  readonly webtoonSnap: boolean;

  /* ── 页面显示 ── */
  readonly fit: ComicFit;
  readonly customFitBase: ComicFit;
  readonly customFitScale: number;
  readonly pageSpacingDp: number; // 连续页面间距（滚动/条漫模式）
  readonly doubleGapDp: number; // 双页左右间距
  readonly doubleFirstAlone: boolean; // 双页模式首页单独显示（封面页）
  readonly doubleAlign: ComicDoubleAlign;
  readonly doubleShiftXDp: number; // 双页位置修正（扫描错位）
  readonly doubleShiftYDp: number;

  /* ── 缩放 ── */
  readonly doubleTapZoom: boolean;
  readonly longPressZoom: boolean;
  readonly zoomWhileTurn: boolean;

  /* ── 旋转 ── */
  readonly bookRotation: number; // 整本旋转 0/90/180/270

  /* ── 裁边 ── */
  readonly cropMode: ComicCropMode;
  readonly manualCrop: readonly number[] | null; // 手动裁边 [left,top,right,bottom] 归一化，null=未设置

  /* ── 大图拆分 ── */
  readonly splitWide: boolean;
  readonly splitReverse: boolean;
  readonly splitPosition: number;

  /* ── 画质增强 ── */
  readonly enhanceMode: ComicEnhanceMode;
  readonly enhanceStrength: number; // 0..100

  /* ── 滤镜 ── */
  readonly filterBrightness: number;
  readonly filterContrast: number;
  readonly filterSaturation: number;
  readonly filterHue: number;
  readonly filterGamma: number;
  readonly filterSharpen: number;
  readonly filterShadow: number;
  readonly filterBW: boolean;

  /* ── 阅读背景 ── */
  readonly bgType: ComicBgType;
  readonly paperIntensity: number; // 纸张纹理强度 0..100

  /* ── 场景 ── */
  readonly scene: string; // ComicScene（SNAIL: 与 @core/audio/sceneTypes 的 ComicScene 同名值）
  readonly sceneSound: boolean;
  readonly sceneEffect: boolean;
  readonly sceneVolume: number; // 0..100

  /* ── 翻页动画 ── */
  readonly pageAnim: ComicPageAnim;

  /* ── 自动阅读 ── */
  readonly autoPageIntervalSec: number;
  readonly autoScrollSpeedDp: number;

  /* ── 手势 ── */
  readonly gestureTapLeft: ComicGestureAction;
  readonly gestureTapRight: ComicGestureAction;
  readonly gestureTapCenter: ComicGestureAction;
  readonly gestureSwipe: boolean;
  readonly gesturePinchClose: boolean;
  readonly gestureEdgeSwipe: boolean;
  readonly gestureLongPressPanel: boolean;
  readonly volumeKeyTurn: boolean;

  /* ── 其它 ── */
  readonly showThumbPreview: boolean;
  readonly hideSystemBars: boolean;

  /* ── 漫画翻译 ── */
  readonly translationEnabled: boolean;
  readonly translationLang: string;
  readonly translationTextScale: number;
  readonly translationEngine: string;
}

/** Kotlin `ComicReaderConfig()` 的默认构造值，逐字段对照移植。 */
export const DEFAULT_COMIC_READER_CONFIG: ComicReaderConfig = {
  mode: 'SINGLE',
  direction: 'RTL',
  webtoonSnap: true,
  fit: 'FIT_WIDTH',
  customFitBase: 'FIT_PAGE',
  customFitScale: 1.0,
  pageSpacingDp: 8,
  doubleGapDp: 8,
  doubleFirstAlone: false,
  doubleAlign: 'CENTER',
  doubleShiftXDp: 0,
  doubleShiftYDp: 0,
  doubleTapZoom: true,
  longPressZoom: true,
  zoomWhileTurn: false,
  bookRotation: 0,
  cropMode: 'OFF',
  manualCrop: null,
  splitWide: false,
  splitReverse: false,
  splitPosition: 0.5,
  enhanceMode: 'OFF',
  enhanceStrength: 60,
  filterBrightness: 0,
  filterContrast: 0,
  filterSaturation: 0,
  filterHue: 0,
  filterGamma: 1.0,
  filterSharpen: 0,
  filterShadow: 0,
  filterBW: false,
  bgType: 'BLACK',
  paperIntensity: 35,
  scene: 'NONE',
  sceneSound: true,
  sceneEffect: true,
  sceneVolume: 40,
  pageAnim: 'SLIDE',
  autoPageIntervalSec: 6,
  autoScrollSpeedDp: 40,
  gestureTapLeft: 'PREV',
  gestureTapRight: 'NEXT',
  gestureTapCenter: 'TOGGLE_CONTROLS',
  gestureSwipe: true,
  gesturePinchClose: true,
  gestureEdgeSwipe: true,
  gestureLongPressPanel: false,
  volumeKeyTurn: true,
  showThumbPreview: true,
  hideSystemBars: true,
  translationEnabled: false,
  translationLang: 'auto',
  translationTextScale: 1.0,
  translationEngine: 'online',
};

/** 每本漫画的阅读状态（独立于配置）：上次读到哪页、单页旋转、临时合页锚点。 */
export interface ComicBookState {
  readonly lastPage: number;
  /** lastPage 所属章节的首页 id（换章时不恢复旧页码） */
  readonly lastChapterSig: string | null;
  /** 页 id → 旋转角度（0/90/180/270），仅作用于该页 */
  readonly pageRotations: Readonly<Record<string, number>>;
  /** 临时合页：以该页为左页与下一页组成跨页（显示层行为） */
  readonly mergeAnchors: ReadonlySet<number>;
}

export const EMPTY_COMIC_BOOK_STATE: ComicBookState = {
  lastPage: 0,
  lastChapterSig: null,
  pageRotations: {},
  mergeAnchors: new Set<number>(),
};

/* ─────────────────────────── 页面引用 / 布局类型 ─────────────────────────── */

/** 一张漫画图片的引用：本地文件或在线 URL */
export type ComicPageRef =
  | { readonly kind: 'LOCAL'; readonly id: string; readonly path: string }
  | {
      readonly kind: 'REMOTE';
      readonly id: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly referer: string | null;
    };

/** 图片实测尺寸 + 装订缝探测结论 */
export interface ComicSizeInfo {
  readonly width: number;
  readonly height: number;
  /** 中央装订缝探测结论：null=未探测（在线页/未加载），true/false=已探测有无 */
  readonly gutter: boolean | null;
  /** 缝中心归一化 x；仅 gutter=true 时有效 */
  readonly gutterPos: number | null;
}

/** 拆分半页 */
export type ComicSplitHalf = 'FULL' | 'LEFT' | 'RIGHT';

/** 一个显示槽位：完整页或拆分后的半页 */
export interface ComicSlot {
  readonly ref: ComicPageRef;
  readonly rawIndex: number;
  readonly half: ComicSplitHalf;
}

/** 一个跨页：1 或 2 个槽位（slots 为阅读顺序） */
export interface ComicSpread {
  readonly index: number;
  readonly slots: readonly ComicSlot[];
}

/** Kotlin `androidx.compose.ui.geometry.Size` → 纯数据结构 */
export interface ComicSize {
  readonly width: number;
  readonly height: number;
}

export const COMIC_SIZE_ZERO: ComicSize = { width: 0, height: 0 };

/** Kotlin `android.graphics.RectF` → 纯数据结构（right/bottom 语义保留） */
export interface ComicRectF {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function rectfWidth(rect: ComicRectF): number {
  return rect.right - rect.left;
}

export function rectfHeight(rect: ComicRectF): number {
  return rect.bottom - rect.top;
}

/* ─────────────────────────── 引擎路由 ─────────────────────────── */

/**
 * GL 引擎（CURL/harism）是否激活：页面渲染在 GLSurfaceView 的独立 Surface 层，
 * 不参与 Compose 图层树（graphicsLayer alpha/layerBackdrop 均不可作用于其上；
 * 强行施加会引发 Surface 合成异常——如切换黑屏）。TTB+单页的 CURL 被既有
 * 语义强制走 Pager 路径（无 GL 视图）；MAGNETIC/WEBTOON/CONTINUOUS 恒走
 * Compose 路径（磁吸 Pager / LazyColumn），即便 pageAnim=CURL 也不存在 GL
 * 视图（第六轮 Agent C 补审 F5：此前误判导致这些组合的面板毛玻璃被无谓关闭）。
 * 与 ComicPagedReader 的引擎路由条件一致。
 */
export function curlEngineActive(
  pageAnim: ComicPageAnim,
  direction: ComicDirection,
  mode: ComicMode,
): boolean {
  return (
    pageAnim === 'CURL' &&
    !(direction === 'TTB' && mode === 'SINGLE') &&
    mode !== 'MAGNETIC' &&
    mode !== 'WEBTOON' &&
    mode !== 'CONTINUOUS'
  );
}

/**
 * 第 11 条毛玻璃采样开关（纯函数，单测钉死语义）：
 * - 仅面板打开期间采样：阅读期不挂 layerBackdrop，阅读内容零每帧重录开销；
 * - CURL 引擎页面在 GLSurfaceView（独立 Surface 层，Compose graphicsLayer 采不到，
 *   强行采样只会得到背景色而盖住页），回退纯半透明 PanelBg。
 */
export function panelGlassSamplingActive(
  pageAnim: ComicPageAnim,
  direction: ComicDirection,
  mode: ComicMode,
  panelOpen: boolean,
): boolean {
  return panelOpen && !curlEngineActive(pageAnim, direction, mode);
}

/**
 * 音量键翻页桥（第 28 条）：阅读器组合期注册处理器，MainActivity 的
 * dispatchKeyEvent 优先咨询。handler 返回 true = 已消费（不弹系统音量条）；
 * 阅读器退出（onDispose）即注销——非阅读页音量键行为与系统原生完全一致。
 * 语义随阅读方向反转：LTR/TTB 下 VolDown=下一页；RTL（日漫物理方向）VolUp=下一页。
 *
 * Web 适配：Android keyCode 常量（VOLUME_UP=24 / VOLUME_DOWN=25）保留为
 * 数值，另提供 dispatchWebKey() 把 KeyboardEvent.key 映射到同一语义
 * （Web 上不存在音量键实体键，映射到 ArrowUp/ArrowDown 属实现约定，已标注）。
 */
export const KEYCODE_VOLUME_UP = 24;
export const KEYCODE_VOLUME_DOWN = 25;

export type ComicVolumeKeyHandler = (isVolumeUp: boolean, isDownAction: boolean) => boolean;

class ComicVolumeKeyBridgeHolder {
  handler: ComicVolumeKeyHandler | null = null;

  /** Activity 层入口：返回 true 表示事件被阅读器消费 */
  dispatch(keyCode: number, isDownAction: boolean): boolean {
    const h = this.handler;
    if (h === null) return false;
    if (keyCode === KEYCODE_VOLUME_UP) return h(true, isDownAction);
    if (keyCode === KEYCODE_VOLUME_DOWN) return h(false, isDownAction);
    return false;
  }

  /**
   * 键盘层入口（Web 适配，非 Kotlin 原行）：KeyboardEvent.key 约定映射
   * ArrowUp=VolUp、ArrowDown=VolDown。非方向键直接返回 false（不消费）。
   */
  dispatchWebKey(key: string, isDownAction: boolean): boolean {
    if (key === 'ArrowUp') return this.dispatch(KEYCODE_VOLUME_UP, isDownAction);
    if (key === 'ArrowDown') return this.dispatch(KEYCODE_VOLUME_DOWN, isDownAction);
    return false;
  }
}

export const ComicVolumeKeyBridge = new ComicVolumeKeyBridgeHolder();

/* ─────────────────────────── 管线参数 ─────────────────────────── */

/**
 * ComicImagePipeline.Toning 的字段镜像（ComicImagePipeline.kt 不在本次范围，
 * 只声明消费侧结构）。
 */
export interface ComicToning {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly hue: number;
  readonly gamma: number;
  readonly sharpen: number;
  readonly shadow: number;
  readonly bw: boolean;
  readonly enhanceMode: ComicEnhanceMode;
  readonly enhanceStrength: number;
}

/** ComicImagePipeline.Geometry 的字段镜像 */
export interface ComicGeometry {
  readonly half: ComicSplitHalf;
  readonly splitPosition: number;
  readonly rotationDeg: number;
  readonly cropMode: ComicCropMode;
  readonly manualCrop: readonly number[] | null;
}

/** 配置 → 管线调色参数 */
export function toneOf(config: ComicReaderConfig): ComicToning {
  return {
    brightness: config.filterBrightness,
    contrast: config.filterContrast,
    saturation: config.filterSaturation,
    hue: config.filterHue,
    gamma: config.filterGamma,
    sharpen: config.filterSharpen,
    shadow: config.filterShadow,
    bw: config.filterBW,
    enhanceMode: config.enhanceMode,
    enhanceStrength: config.enhanceStrength,
  };
}

/** Toning.hasWork()（ComicImagePipeline.kt L68-70 的镜像） */
export function toningHasWork(tone: ComicToning): boolean {
  return (
    tone.brightness !== 0 ||
    tone.contrast !== 0 ||
    tone.saturation !== 0 ||
    tone.hue !== 0 ||
    tone.gamma !== 1.0 ||
    tone.sharpen > 0 ||
    tone.shadow !== 0 ||
    tone.bw ||
    tone.enhanceMode !== 'OFF'
  );
}

/** ComicImagePipeline.hasWork(geo, tone)（L63-66 的镜像） */
export function geometryHasWork(geo: ComicGeometry, tone: ComicToning): boolean {
  return (
    geo.half !== 'FULL' ||
    geo.rotationDeg % 360 !== 0 ||
    geo.cropMode !== 'OFF' ||
    geo.manualCrop !== null ||
    toningHasWork(tone)
  );
}

/**
 * 指纹/增强耗时：ComicImagePipeline.kt 不在本次移植范围，此处按其公式
 * 逐行镜像（增强估计 L80-92，hasWork L63-73，fingerprint L164-170）。
 */
export function enhanceEstimateSec(
  mode: ComicEnhanceMode,
  strength: number,
  longEdge: number,
): number {
  let base = 0;
  switch (mode) {
    case 'OFF':
      return 0.0;
    case 'CAS':
      base = 0.4;
      break;
    case 'ANIME4K':
      base = 1.9;
      break;
    case 'WAIFU2X':
      base = longEdge >= 2400 ? 1.7 : 2.5;
      break;
    case 'SUPER_RES':
      base = longEdge <= 1800 ? 1.3 : 0.4;
      break;
    default:
      return 0.0;
  }
  const clamped = Math.min(100, Math.max(0, strength));
  const s = (clamped + 25) / 125;
  const rawArea = longEdge / 1600.0;
  const areaFactor = Math.min(1.6, Math.max(0.45, rawArea * rawArea));
  const sec = base * s * (0.5 + 0.5 * areaFactor) * 2.2;
  return Math.max(0.5, Math.ceil(sec * 2) / 2);
}

/** 滤镜/增强/裁边相关的指纹，用于位图处理缓存键（ComicReaderConfig.kt L164-170 镜像） */
export function imagePipelineFingerprint(config: ComicReaderConfig): string {
  return [
    config.cropMode,
    config.manualCrop === null ? null : config.manualCrop.join(','),
    String(config.bookRotation),
    String(config.splitWide),
    String(config.splitPosition),
    config.enhanceMode,
    String(config.enhanceStrength),
    String(config.filterBrightness),
    String(config.filterContrast),
    String(config.filterSaturation),
    String(config.filterHue),
    config.filterGamma.toFixed(3),
    String(config.filterSharpen),
    String(config.filterShadow),
    String(config.filterBW),
  ].join('|');
}

/**
 * 有效拆分位置（第 19 条）：以 detectCenterGutterDetail 检测到的装订缝位置为基准，
 * 用户的"拆分位置"滑条作为微调偏移（0.5=不偏移）——拆分点真正落在装订缝上，
 * 而非简单二分中点；无缝探测结果时基准回落 0.5。
 */
export function effectiveSplitPosition(
  config: ComicReaderConfig,
  detectedGutterPos: number | null | undefined,
): number {
  const base = detectedGutterPos != null && !Number.isNaN(detectedGutterPos) ? detectedGutterPos : 0.5;
  return Math.min(0.7, Math.max(0.3, base + (config.splitPosition - 0.5)));
}

/* ─────────────────────────── 点按区解析 ─────────────────────────── */

/** 手势动作结果类型（与 ComicGestureAction 同名，复用该联合类型） */
export type ComicTapAction = ComicGestureAction;

/**
 * 方向感知点按区：水平模式左右三分（"上一页侧/下一页侧"随 RTL 翻转），
 * 垂直模式上下三分。双页+TTB 组合仍按水平解析（双页为横向排版）。
 */
export function resolveTapAction(
  pos: ComicSize, // 用作 { x: width, y: height } 的坐标载体见下
  size: ComicSize,
  config: ComicReaderConfig,
): ComicTapAction {
  const vertical =
    config.mode === 'WEBTOON' ||
    config.mode === 'CONTINUOUS' ||
    (config.direction === 'TTB' && config.mode !== 'DOUBLE');
  if (vertical) {
    const third = size.height / 3;
    if (pos.height < third) return config.gestureTapLeft; // 上 = 逻辑上一页侧
    if (pos.height > third * 2) return config.gestureTapRight;
    return config.gestureTapCenter;
  }
  const third = size.width / 3;
  const rtl = config.direction === 'RTL';
  if (pos.width < third) return rtl ? config.gestureTapRight : config.gestureTapLeft;
  if (pos.width > third * 2) return rtl ? config.gestureTapLeft : config.gestureTapRight;
  return config.gestureTapCenter;
}

/* ─────────────────────────── 页面位图加载（注入式解码器端口） ─────────────────────────── */

/**
 * Injected decoder port —— Android `Bitmap` / `BitmapFactory` 的 Web 等价声明。
 * 本文件只声明接口，不实现（像素级解码/滤镜管线不在本次移植范围）。
 *
 * Kotlin → Web 映射说明:
 *   Bitmap                → ComicBitmap { src, width, height }（src 为可渲染 URL / objectURL）
 *   loader.loadForDisplay → loadForDisplay
 *   loader.peekProcessed  → peekProcessed（同步缓存命中，播种用）
 *   loader.decodeRegion   → decodeRegion（高倍缩放区域重解码）
 */
export interface ComicBitmap {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export interface ComicLoadForDisplayRequest {
  readonly ref: ComicPageRef;
  readonly cacheKey: string;
  readonly geometry: ComicGeometry;
  readonly tone: ComicToning;
  readonly visible: boolean;
}

export interface ComicPageLoaderWindowEntry {
  readonly ref: ComicPageRef;
  readonly visible: boolean;
  readonly cacheKey: string;
  readonly geometry: ComicGeometry;
}

export interface ComicPageLoaderPort {
  /** 同步读处理后缓存（produceState 初值播种用） */
  peekProcessed(cacheKey: string): ComicBitmap | null;
  /** 同步读低清预览（refining 占位） */
  peekReadingPreview(cacheKey: string): ComicBitmap | null;
  /** 解码 + 管线处理 + 缓存 */
  loadForDisplay(request: ComicLoadForDisplayRequest): Promise<ComicBitmap>;
  /** 高倍缩放区域重解码（仅本地文件）；未实现时返回 null */
  decodeRegion(
    local: Extract<ComicPageRef, { kind: 'LOCAL' }>,
    rect: ComicRectF,
    cacheTag: string,
  ): Promise<ComicBitmap | null>;
  /** 整窗一次提交预载 */
  preloadWindow(entries: readonly ComicPageLoaderWindowEntry[], tone: ComicToning): void;
  /** 烘焙译文替换缓存 */
  replaceProcessed(cacheKey: string, bitmap: ComicBitmap): void;
  /** 预载窗口外取消 / 释放 */
  evictProcessed(cacheKey: string): void;
  /** 顺序探测原始尺寸（宽页拆分判定需要） */
  probeSizes(pages: readonly ComicPageRef[]): Promise<void>;
  /** 释放已解码缓存 */
  clearProcessedCache(): void;
  /** 关闭底层工作线程 */
  shutdown(): void;
  /** 已探测尺寸快照 + 订阅（Kotlin `loader.sizes` StateFlow） */
  sizes(): Readonly<Record<string, ComicSizeInfo>>;
  subscribeSizes(listener: (sizes: Readonly<Record<string, ComicSizeInfo>>) => void): () => void;
}

/* ─────────────────────────── 页面位图状态 ─────────────────────────── */

export type PageBitmapState =
  | { readonly kind: 'LOADING' }
  | {
      readonly kind: 'READY';
      readonly bitmap: ComicBitmap;
      readonly refining: boolean;
      readonly error: Error | null;
    }
  | { readonly kind: 'FAILED'; readonly error: Error | null };

/* ─────────────────────────── FADE 交叉淡化 ─────────────────────────── */

/**
 * FADE 渐变模式的位移抵消（第 5 条，纯函数可单测）。
 * pager 布局位移方向随引擎镜像：LTR 横向 = -off·w（旧页左移）、RTL
 * reverseLayout 水平轴镜像 = +off·w（旧页右移）、TTB 纵向 = -off·h；
 * 抵消平移必须逐引擎取反向号——统一 +off·w 在 RTL 下会加倍漂移
 * （第三轮逐帧复审实测旧页 +2/+14/+60px 递增即此因）。
 */
export function fadeCancelOffset(
  pageOffset: number,
  rtl: boolean,
  ttb: boolean,
  w: number,
  h: number,
): readonly [number, number] {
  if (ttb) return [0, pageOffset * h] as const;
  if (rtl) return [-pageOffset * w, 0] as const;
  return [pageOffset * w, 0] as const;
}

/**
 * FADE 真交叉淡化 alpha（第 5 条，纯函数可单测）：离场页（off≥0）保持
 * 不透明作底，进场页（off<0）alpha=1+off 自 0 淡入；进场页层序在上，
 * 合成恒为 (1-p)·旧页 + p·新页，中点不下陷发黑（旧版两页同衰减到 0.08，
 * 拖拽中段整屏发黑即此病）。
 */
export function fadeCrossAlpha(pageOffset: number): number {
  if (pageOffset >= 0) return 1;
  return Math.min(1, Math.max(0, 1 + pageOffset));
}

/* ─────────────────────────── 磁吸模式 ─────────────────────────── */

/**
 * 边缘橡胶带阻尼（iOS UIScrollView c=0.55 公式）：首/末页越界拖动渐近衰减。
 * drag 语义与翻页一致：负值 = 阅读方向推进，正值 = 回退。
 */
export function dampEdgeDrag(
  raw: number,
  page: number,
  count: number,
  span: number,
  c = 0.55,
): number {
  if (span <= 0) return 0;
  const maxY = span / c;
  if (page <= 0 && raw > 0) {
    return (1 - 1 / (raw * c / span + 1)) * maxY;
  }
  if (page >= count - 1 && raw < 0) {
    return -(1 - 1 / (-raw * c / span + 1)) * maxY;
  }
  return raw;
}

/**
 * 松手目标页判定（对齐 Compose Pager 官方参数）：
 * 速度 ≥ vTh（400dp/s）按速度方向翻页；否则按位置（过半即翻）。
 */
export function magneticTargetShift(
  dragValue: number,
  velocityPxPerSec: number,
  span: number,
  dirSign: number,
  vTh: number,
): number {
  const shiftFloat = (-dragValue / span) * dirSign;
  if (Math.abs(velocityPxPerSec) >= vTh) {
    const vShift = (-velocityPxPerSec / span) * dirSign;
    return vShift > 0 ? 1 : -1;
  }
  if (shiftFloat > 0.5) return 1;
  if (shiftFloat < -0.5) return -1;
  return 0;
}

/* ─────────────────────────── 适配尺寸 ─────────────────────────── */

/** 计算适配后的显示尺寸（fit 决定基准缩放） */
export function fittedSize(intrinsic: ComicSize, container: ComicSize, fit: ComicFit): ComicSize {
  return fittedSizeWithCustom(intrinsic, container, fit, 1, 'FIT_PAGE');
}

/**
 * 适配计算（第 10 条五种数学定义 + 第 26 条自定义档）。
 * customScale/customBase 仅对 CUSTOM 档生效（基础档缩放 × 系数）。
 */
export function fittedSizeWithCustom(
  intrinsic: ComicSize,
  container: ComicSize,
  fit: ComicFit,
  customScale: number,
  customBase: ComicFit,
): ComicSize {
  if (intrinsic.width <= 0 || intrinsic.height <= 0) return COMIC_SIZE_ZERO;
  switch (fit) {
    case 'FIT_PAGE':
      // 整页：fit-inside（完整可见，比例保持，短边贴合留白在长边）
      return {
        width:
          intrinsic.width *
          Math.min(container.width / intrinsic.width, container.height / intrinsic.height),
        height:
          intrinsic.height *
          Math.min(container.width / intrinsic.width, container.height / intrinsic.height),
      };
    case 'FIT_WIDTH': {
      // 宽度贴合容器 + 竖向自然溢出（可平移/滚动）——与 FIT_HEIGHT 语义对称；
      // 旧实现 min(...) 是 fit-center（两侧留黑边），名为"适应宽度"却永不贴合
      const s = container.width / intrinsic.width;
      return { width: intrinsic.width * s, height: intrinsic.height * s };
    }
    case 'FIT_HEIGHT': {
      const s = container.height / intrinsic.height;
      return { width: intrinsic.width * s, height: intrinsic.height * s };
    }
    case 'ORIGINAL':
      return intrinsic;
    case 'FILL': {
      const s = Math.max(container.width / intrinsic.width, container.height / intrinsic.height);
      return { width: intrinsic.width * s, height: intrinsic.height * s };
    }
    case 'STRETCH':
      return container;
    case 'CUSTOM': {
      // 自定义：用户选定的基础档 × 缩放系数（0.5..2.5）
      const base = fittedSize(intrinsic, container, customBase === 'CUSTOM' ? 'FIT_PAGE' : customBase);
      return { width: base.width * customScale, height: base.height * customScale };
    }
    default:
      return COMIC_SIZE_ZERO;
  }
}

/** ComicZoomState 的可观察字段镜像（ComicZoomGesture.kt 不在本次范围，仅消费侧） */
export interface ComicZoomSnapshot {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly containerSize: ComicSize;
  /** 内容适配后（scale=1 时）的显示尺寸（px） */
  readonly contentSize: ComicSize;
  /** 原始位图像素尺寸（双击 1:1 档位计算用；未设置时不提供该档） */
  readonly intrinsicSize: ComicSize;
  /** 手势进行中 */
  readonly gestureActive: boolean;
  /** 松手动画进行中 */
  readonly releaseAnimating: boolean;
  /** 每次手势结束递增 */
  readonly gestureEpoch: number;
}

/**
 * 可视内容区域（原始图像素坐标）。渲染模型反解：
 * screen = containerCenter + (content − contentCenter) × scale + offset。
 * 返回 null 表示状态未就绪。纯函数，可单测。
 */
export function visibleIntrinsicRect(z: ComicZoomSnapshot): ComicRectF | null {
  if (
    z.contentSize.width <= 0 ||
    z.contentSize.height <= 0 ||
    z.containerSize.width <= 0 ||
    z.containerSize.height <= 0 ||
    z.scale <= 0
  ) {
    return null;
  }
  if (z.intrinsicSize.width <= 0 || z.intrinsicSize.height <= 0) return null;
  const cx = z.containerSize.width / 2;
  const cy = z.containerSize.height / 2;
  const ccx = z.contentSize.width / 2;
  const ccy = z.contentSize.height / 2;
  const toContentX = (px: number): number => (px - cx - z.offsetX) / z.scale + ccx;
  const toContentY = (py: number): number => (py - cy - z.offsetY) / z.scale + ccy;
  const l = Math.min(z.contentSize.width, Math.max(0, toContentX(0)));
  const r = Math.min(z.contentSize.width, Math.max(0, toContentX(z.containerSize.width)));
  const t = Math.min(z.contentSize.height, Math.max(0, toContentY(0)));
  const b = Math.min(z.contentSize.height, Math.max(0, toContentY(z.containerSize.height)));
  if (r - l < 1 || b - t < 1) return null;
  const sx = z.intrinsicSize.width / z.contentSize.width;
  const sy = z.intrinsicSize.height / z.contentSize.height;
  return { left: l * sx, top: t * sy, right: r * sx, bottom: b * sy };
}

/* ─────────────────────────── 章节边缘手势 ─────────────────────────── */

/**
 * 正值回退、负值前进；只允许从起手时已停住的首末页跨章。
 *
 * 来源：ComicChapterEdgeGesture.kt L21-25（该模块不在本次移植范围，
 * 消费侧必须有同一判定语义，故按原行镜像并在此标注）。
 */
export function comicChapterEdgeTarget(
  drag: number,
  atStart: boolean,
  atEnd: boolean,
  threshold: number,
): number {
  if (atStart && drag >= threshold) return -1;
  if (atEnd && drag <= -threshold) return 1;
  return 0;
}

/* ─────────────────────────── 布局辅助（来自 ComicPageLayout.kt） ─────────────────────────── */

/**
 * 引擎/布局切换淡入 alpha（补1）：240ms smoothstep（≈FastOutSlowIn），起始 0.35
 * 不全黑——挂钟驱动动画的进度函数抽纯函数供单测。
 *
 * 来源：ComicPageLayout.kt L129-132（该模块不在本次范围，按原行镜像）。
 */
export function engineFadeAlpha(elapsedMs: number, durationMs = 240): number {
  const t = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs));
  return 0.35 + 0.65 * (t * t * (3 - 2 * t));
}

/**
 * 垂直模式前瞻预载索引（第 6 条 prefetchWindow 接线），返回 **预载驻留优先级序**：
 * 当前页 → 前瞻 +1..+window（近→远）→ 上一页，全部钳制到 [0, count)。
 *
 * 来源：ComicPageLayout.kt L117-123（该模块不在本次范围，按原行镜像）。
 */
export function verticalPreloadIndices(current: number, window: number, count: number): number[] {
  if (count <= 0) return [];
  const fwd: number[] = [];
  for (let i = 1; i <= window; i += 1) {
    const candidate = current + i;
    if (candidate >= 0 && candidate < count) fwd.push(candidate);
  }
  const back: number[] = [];
  if (current - 1 >= 0 && current - 1 < count) back.push(current - 1);
  const head: number[] = [];
  if (current >= 0 && current < count) head.push(current);
  return [...head, ...fwd, ...back];
}

/* ─────────────────────────── 滚动指标（消费侧契约） ─────────────────────────── */

/** 滑条落点反算到项内像素偏移，长图和末图都能精确定位。 */
export interface ComicScrollTarget {
  readonly index: number;
  readonly offset: number;
}

/** ComicScrollMetrics.kt（不在本次范围）的消费侧契约 */
export interface ComicScrollMetricsLike {
  readonly fraction: number;
  target(fraction: number): ComicScrollTarget;
}

/* ─────────────────────────── 加载反馈文案 ─────────────────────────── */

/** 传输进度（ComicLoadSupport.kt 不在本次范围，仅消费侧契约） */
export interface ComicTransferLike {
  readonly bytes: number;
  readonly fraction: number | null;
}

export type ComicTransferLookup = (ref: ComicPageRef) => ComicTransferLike | null;

/**
 * ComicLoadingFeedback 的文案分支（Kotlin L2100-2108 的纯函数化）。
 * 抽成纯函数以便单测；UI 层只负责渲染返回值。
 */
export function comicLoadingLabel(fraction: number | null, bytes: number, elapsed: number): string {
  if (fraction === 1) return '正在展开页面…';
  if (fraction !== null) return `正在加载 · ${String(Math.trunc(fraction * 100))}%`;
  if (bytes > 0) return `已接收 ${String(Math.trunc(bytes / 1024))} KB`;
  if (elapsed >= 5) return '连接较慢，正在加载…';
  return '正在加载页面…';
}

/** 增强处理耗时提示文案（null = 未开启增强，不显示） */
export function enhanceHintFor(config: ComicReaderConfig, longEdge: number): string | null {
  if (config.enhanceMode === 'OFF') return null;
  const sec = enhanceEstimateSec(config.enhanceMode, config.enhanceStrength, longEdge);
  return `AI 增强处理中 · 约 ${String(sec === Math.trunc(sec) ? String(Math.trunc(sec)) : String(sec))}s`;
}

/* ─────────────────────────── 手势回调集合 ─────────────────────────── */

/** 手势回调集合（ComicZoomGesture.kt L366-373 的镜像） */
export interface ComicGestureCallbacks {
  /** 点按区命中（pos 为容器内坐标，size 为容器尺寸） */
  readonly onTapZone: (pos: ComicSize, size: ComicSize) => void;
  readonly onLongPress: () => void;
  readonly onPinchClose: () => void;
  readonly onEdgeBack: () => void;
  /** 放大状态下滑到边缘继续翻页（dir>0 屏幕向右拖） */
  readonly onZoomedEdgeSwipe?: ((dir: number) => void) | undefined;
}

/** Compose `Offset` 在 Web 的等价（用 width/x 与 height/y 两个分量承载） */
export interface ComicPoint {
  readonly x: number;
  readonly y: number;
}

export function pointToSize(p: ComicPoint): ComicSize {
  return { width: p.x, height: p.y };
}

/* ─────────────────────────── 章节导航门闩 ─────────────────────────── */

/**
 * 首末页继续外翻进入相邻章节时的单飞门闩（Kotlin L391-398 的状态机）。
 * chapterNavigationPending=true 时所有导航请求返回 false；
 * 调用方在换章成功后调用 release()。
 */
export class ChapterNavigationLatch {
  private pending = false;

  /** 返回 true 表示本次调用抢到了导航权（调用方应执行 action） */
  tryAcquire(): boolean {
    if (this.pending) return false;
    this.pending = true;
    return true;
  }

  isPending(): boolean {
    return this.pending;
  }

  release(): void {
    this.pending = false;
  }
}

/* ─────────────────────────── 布局构建（临时替身） ─────────────────────────── */

/** 宽高比超过该值进入「疑似跨页」区间（需 gutter 佐证） */
export const WIDE_ASPECT = 1.35;

/** 宽高比超过该值无条件视为跨页扫描图（KCC BISECT_THRESHOLD 经验值） */
export const HARD_WIDE_ASPECT = 1.8;

/** ComicPageLayout.isWidePage 的镜像（ComicPageLayout.kt L148-154） */
export function isWidePage(size: ComicSizeInfo | null | undefined): boolean {
  if (size == null) return false;
  const aspect = size.height > 0 ? size.width / size.height : 0;
  if (aspect < WIDE_ASPECT) return false;
  if (aspect >= HARD_WIDE_ASPECT) return true;
  return size.gutter ?? true;
}

export interface ComicLayout {
  readonly spreads: readonly ComicSpread[];
  /** 原始页 → 首个所在 spread 索引 */
  readonly rawToSpread: Readonly<Record<number, number>>;
}

export const EMPTY_COMIC_LAYOUT: ComicLayout = { spreads: [], rawToSpread: {} };

export function comicLayoutSpreadCount(layout: ComicLayout): number {
  return layout.spreads.length;
}

/** ComicLayout.spreadOfRawPage（L60） */
export function spreadOfRawPage(layout: ComicLayout, raw: number): number {
  return layout.rawToSpread[raw] ?? 0;
}

/** ComicLayout.spreadIndexOf（L62-63） */
export function spreadIndexOf(layout: ComicLayout, raw: number): number {
  const idx = layout.spreads.findIndex((s) => s.slots.some((it) => it.rawIndex === raw));
  return idx >= 0 ? idx : 0;
}

/** ComicSpread.isDouble / firstRawIndex（L49-50） */
export function spreadIsDouble(spread: ComicSpread): boolean {
  return spread.slots.length === 2;
}

export function spreadFirstRawIndex(spread: ComicSpread): number {
  return spread.slots[0]?.rawIndex ?? 0;
}

/**
 * ComicPageLayout.build（ComicPageLayout.kt L162-250）的临时替身实现。
 *
 * 注意：ComicPageLayout.kt 是另一个独立 Kotlin 模块，不在本次移植范围；
 * 但 ComicReaderCore 依赖它才能产出 spreads，因此在此按原逻辑逐行镜像一份，
 * 标注 TEMPORARY SHIM。若 `src/core/comic/comicPageLayout.ts` 后续落地，
 * 应删除本函数并改为 import。
 */
export function buildComicLayout(
  pages: readonly ComicPageRef[],
  sizes: Readonly<Record<string, ComicSizeInfo>>,
  config: ComicReaderConfig,
  bookState: ComicBookState,
): ComicLayout {
  if (pages.length === 0) return EMPTY_COMIC_LAYOUT;
  const rtl = config.direction === 'RTL';
  const double = config.mode === 'DOUBLE';

  // 1. 展开为显示单元：宽页按需拆分（记录原始页索引，合页锚点按原始索引判断）
  interface RawUnit {
    readonly slot: ComicSlot;
    readonly fromSplit: boolean;
    /** 未拆分的宽页（双页模式下应独占） */
    readonly wideFull: boolean;
  }
  interface RawUnitGroup {
    readonly rawIndex: number;
    readonly units: RawUnit[];
  }

  const rawGroups: RawUnitGroup[] = [];
  pages.forEach((page, idx) => {
    const size = sizes[page.id];
    const isWide = isWidePage(size);
    const anchorMerged = bookState.mergeAnchors.has(idx);
    if (config.splitWide && isWide && !anchorMerged) {
      // 拆分顺序：默认 RTL 先右半边；splitReverse 反转手动纠正扫描顺序。
      const rightFirst = config.splitReverse ? !rtl : rtl;
      const left: RawUnit = {
        slot: { ref: page, rawIndex: idx, half: 'LEFT' },
        fromSplit: true,
        wideFull: false,
      };
      const right: RawUnit = {
        slot: { ref: page, rawIndex: idx, half: 'RIGHT' },
        fromSplit: true,
        wideFull: false,
      };
      const ordered = rightFirst ? [right, left] : [left, right];
      ordered.forEach((it) => rawGroups.push({ rawIndex: idx, units: [it] }));
    } else {
      rawGroups.push({
        rawIndex: idx,
        units: [
          {
            slot: { ref: page, rawIndex: idx, half: 'FULL' },
            fromSplit: false,
            wideFull: isWide,
          },
        ],
      });
    }
  });

  // 2. 临时合页锚点 → 两页组成一个 spread（显示层行为，不破坏原始数据）
  const pending: RawUnit[][] = [];
  let i = 0;
  while (i < rawGroups.length) {
    const group = rawGroups[i];
    const groupUnits = group?.units ?? [];
    const isAnchor = bookState.mergeAnchors.has(group?.rawIndex ?? -1);
    if (isAnchor && i + 1 < rawGroups.length && groupUnits.length === 1 && !groupUnits[0]!.fromSplit) {
      const nextUnits = rawGroups[i + 1]?.units ?? [];
      if (nextUnits.length === 1 && !nextUnits[0]!.fromSplit) {
        pending.push([...groupUnits, ...nextUnits]);
        i += 2;
        continue;
      }
    }
    pending.push(groupUnits);
    i += 1;
  }

  // 3. 分组为 spread
  const groups: RawUnit[][] = [];
  let cursor = 0;
  const firstAlone = config.doubleFirstAlone && double;
  if (firstAlone && pending.length > 0) {
    groups.push(pending[0] ?? []);
    cursor = 1;
  }
  while (cursor < pending.length) {
    const cur = pending[cursor] ?? [];
    if (!double || cur.length > 1 || cur[0]!.wideFull) {
      // 单页模式 / 已是合页组 / 未拆分宽页 → 独立 spread
      groups.push(cur);
      cursor += 1;
    } else {
      const next = pending[cursor + 1];
      if (next !== undefined && next.length === 1 && !next[0]!.wideFull) {
        groups.push([...cur, ...next]);
        cursor += 2;
      } else {
        groups.push(cur);
        cursor += 1;
      }
    }
  }

  const spreads: ComicSpread[] = groups.map((units, si) => ({
    index: si,
    slots: units.map((u) => u.slot),
  }));
  const rawToSpread: Record<number, number> = {};
  spreads.forEach((s) => {
    s.slots.forEach((slot) => {
      if (rawToSpread[slot.rawIndex] === undefined) rawToSpread[slot.rawIndex] = s.index;
    });
  });
  return { spreads, rawToSpread };
}

/* ─────────────────────────── 缓存键 ─────────────────────────── */

/** cacheKey 拼装（Kotlin L538 / L831 / L1364 / L1739 的统一模板） */
export function comicCacheKey(
  ref: ComicPageRef,
  half: ComicSplitHalf,
  fingerprint: string,
  rotationDeg: number,
): string {
  return `${ref.id}|${half}|${fingerprint}|r${String(rotationDeg)}`;
}

/** Kotlin `((bookRotation + pageRot) % 360 + 360) % 360`（L533 / L830 / L1359 / L1740 / L1775） */
export function effectiveRotation(bookRotation: number, pageRot: number): number {
  return (((bookRotation + pageRot) % 360) + 360) % 360;
}

/** Kotlin `(bookState.pageRotations[slot.ref.id] ?: 0)` */
export function pageRotationOf(bookState: ComicBookState, refId: string): number {
  return bookState.pageRotations[refId] ?? 0;
}

/* ─────────────────────────── Skipped ─────────────────────────── */

/**
 * 未移植的 Kotlin 行与原因（全部为 Compose/平台专有，无等价物）：
 *
 *  - L1-104   import 块                        → TS import，无对应实现
 *  - L198-200 LocalContext/rememberCoroutineScope/ComicSettingsStore
 *                                             → 平台能力；store 由 Web localStorage
 *                                               实现（见 ComicReaderPage.tsx）
 *  - L210-218 DisposableEffect(Unit) onDispose → useEffect cleanup（UI 层）
 *  - L219-242 persistConfig/updateConfig     → 依赖 store + 协程（UI 层）
 *  - L247-252 displayConfig debounce(250)     → 依赖 snapshotFlow（UI 层）
 *  - L255-261 ComicPageLoader 生命周期        → 注入式 loader（UI 层 effect）
 *  - L264-303 TranslationCoordinator/OrtSessions/ONNX
 *                                             → ONNX Runtime 无 Web 原样实现；
 *                                               改为外部注入 busy/epoch（UI 层 prop）
 *  - L305-321 scheduleTranslationWindow       → 同上（UI 层）
 *  - L324-328 loader.sizes debounce(120)      → UI 层（useEffect + setTimeout）
 *  - L330-380 布局/位置/进度链路               → UI 层（useMemo / useEffect）
 *  - L382-439 控制层状态 / 翻页 / 沉浸式系统栏 → UI 层；系统栏 → CSS fullscreen
 *  - L441-497 手势回调装配                     → UI 层 Pointer Events
 *  - L499-512 feedDynamicBg (Bitmap 主色)     → 注入式 dominantColor provider（UI 层）
 *  - L519-551 相邻页预载窗口                   → UI 层（useEffect 调 loader）
 *  - L554-577 layerBackdrop / 动态背景         → CSS backdrop-filter（UI 层 + comic.css）
 *  - L580-604 engineFade 逐帧挂钟动画          → CSS transition（UI 层）
 *  - L612-661 模式渲染分支 / 场景特效层        → UI 层
 *  - L663-675 翻译角标                         → UI 层（文案保留）
 *  - L679-691 场景环境音                       → UI 层（@core/audio/ambientAudio）
 *  - L694-748 ComicReaderChrome 调用          → UI 层（ComicReaderChrome.kt 不在本次范围）
 *  - L776-780 produceState0                   → Compose Flow 扩展，Web 无 Flow
 *  - L817-894 rememberPageBitmap              → UI 层 hook（useComicPageBitmap）
 *  - L921-1070 ComicPagedReader               → UI 层（scroll-snap 容器）
 *  - L1113-1284 ComicMagneticPager            → UI 层（Pointer Events + spring）
 *  - L1288-1474 ComicVerticalList            → UI 层（scroll-snap + rAF）
 *  - L1479-1546 ComicVerticalItem             → UI 层
 *  - L1552-1639 ComicSpreadCell               → UI 层
 *  - L1717-1877 SinglePageContent             → UI 层
 *  - L1880-2006 DoubleSpreadContent           → UI 层
 *  - L2008-2015 ComicRefinementFeedback       → UI 层
 *  - L2023-2055 ZoomableImageLayer            → UI 层（CSS transform）
 *  - L2057-2086 PagePlaceholder               → UI 层
 *  - L2089-2114 ComicLoadingFeedback          → UI 层（文案已抽 comicLoadingLabel）
 *  - L1564    ComicZoomState / comicZoomable / comicEdgeSwipe
 *                                             → ComicZoomGesture.kt 不在本次范围；
 *                                               缩放手势在 UI 层以 Pointer Events 重写
 *  - L945-952 ComicHarismCurlReader           → ComicHarismCurl.kt（GL 引擎）不在本次范围
 */

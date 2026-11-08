/**
 * comicReaderSheets.ts — 纯逻辑层（无 React / 无 DOM / 无 Compose 依赖）。
 *
 * Kotlin 来源映射（novel-reader/app/src/main/java/com/example/ui/comic/）：
 *   - `ComicReaderSheets.kt` 132–149   AccentColor / SettingsTabs
 *   - `ComicReaderSheets.kt` 282–503   TranslationTab（可抽出的常量与格式化）
 *   - `ComicReaderSheets.kt` 357, 401–409  页面文字语言下标 ↔ 代码
 *   - `ComicReaderSheets.kt` 370–388  翻译引擎状态文案
 *   - `ComicReaderSheets.kt` 413–502  离线模型 / 缓存文案（31MB、64MB）
 *   - `ComicReaderSheets.kt` 505–610  ModeTab / ModeGrid / DirectionGrid
 *   - `ComicReaderSheets.kt` 614–625  FitOptions / fitLabel
 *   - `ComicReaderSheets.kt` 643–655  自定义缩放基础适配
 *   - `ComicReaderSheets.kt` 662–713  自定义缩放预设（名称/删除/保存）
 *   - `ComicReaderSheets.kt` 718–766  间距 / 双页排列 / 缩放
 *   - `ComicReaderSheets.kt` 783–915  裁边 / 大图拆分 / 旋转 / 画质增强 / 滤镜
 *   - `ComicReaderSheets.kt` 979–1037 BgSwatchRow
 *   - `ComicReaderSheets.kt` 1040–1092 SceneOptionFlow
 *   - `ComicReaderSheets.kt` 1186–1276 EffectTab / AutoTab / GestureTab
 *   - `ComicReaderSheets.kt` 1280–1391 ComicTocSheet 网格参数
 *   - `ComicReaderSheets.kt` 1395–1608 ComicPresetSheet（排序 / 内置标记 / 新建默认名）
 *   - `ComicReaderSheets.kt` 1645–1872 ComicCropSheet / CropCanvas（钳制 / 命中 / 百分比文案）
 *
 * 逐行跳过说明：
 *   - Kotlin 1–130 `import`：Compose/Android 导入，纯 TS 无对应物。
 *   - Kotlin 134 `AccentColor`：Compose `Color` 常量 → 见 CSS `--cmcs-accent`（#F0D9C0），
 *     在本文件只保留 `ACCENT_COLOR` 字符串常量供测试与 Canvas 描边复用。
 *   - Kotlin 141–149 `SettingsTabs`：仅保留标签与图标名（Material Icon 名保持原样）。
 *   - Kotlin 287–330 `TranslationTab` 的 LocalContext / rememberCoroutineScope /
 *     TranslateModelManager / TranslationCache / LlmBubbleTranslator /
 *     OnlineFallbackTranslator / android.widget.Toast：Android 平台绑定，
 *     改为组件侧注入的 props（本文件不含副作用）。
 *   - Kotlin 352–411 的三个引擎子页与功能卡片：分支结构留在 .tsx，本文件只留文案常量。
 *   - Kotlin 507–610 的 FlowRow / Box / Modifier 链：布局，改由 .tsx + CSS 承担。
 *   - Kotlin 627–767 / 771–916 各 composable 体：Compose 布局，改由 .tsx 承担。
 *   - Kotlin 918–930 `ActionChip`、932–974 `FilterPreview`：UI，迁 .tsx。
 *   - Kotlin 1186–1276 三个 Tab：布局，迁 .tsx；可复用常量已抽出。
 *   - Kotlin 1280–1391 `ComicTocSheet` / `PageThumbCell`：UI，迁 .tsx。
 *   - Kotlin 1395–1608 `ComicPresetSheet`：UI，迁 .tsx；排序/默认名逻辑已抽出。
 *   - Kotlin 1611–1641 `PresetNameDialog`：AlertDialog，迁 .tsx；take(12) 已抽出。
 *   - Kotlin 1645–1728 `ComicCropSheet` / 1730–1772 `BoxWithImageLayout`：
 *     UI + Bitmap，迁 .tsx（<img> + onError）；钳制逻辑已抽出。
 *   - Kotlin 1775–1872 `CropCanvas`：Compose Canvas 绘制，迁 .tsx 的 SVG/DOM 覆盖层；
 *     命中判定与拖动派生数学已抽出为 `cropHandleFromPoint` / `applyCropHandleDrag`。
 */

/* ══════════════ 类型（镜像 Kotlin，只声明面板用到的字段） ══════════════ */

/** 阅读模式（ComicReaderConfig.kt 242–245）：单页/双页/条漫/无缝滚动/磁吸 */
export type ComicMode = 'SINGLE' | 'DOUBLE' | 'WEBTOON' | 'CONTINUOUS' | 'MAGNETIC';

/** 阅读方向（ComicReaderConfig.kt 247–250） */
export type ComicDirection = 'LTR' | 'RTL' | 'TTB';

/** 页面显示方式（ComicReaderConfig.kt 262–265） */
export type ComicFit =
  | 'FIT_WIDTH'
  | 'FIT_HEIGHT'
  | 'ORIGINAL'
  | 'FILL'
  | 'STRETCH'
  | 'FIT_PAGE'
  | 'CUSTOM';

/** 双页对齐（ComicReaderConfig.kt 268–270） */
export type ComicDoubleAlign = 'TOP' | 'CENTER' | 'BOTTOM';

/** 自动裁边模式（ComicReaderConfig.kt 273–275） */
export type ComicCropMode = 'OFF' | 'WHITE' | 'BLACK' | 'AUTO';

/** 画质增强（ComicReaderConfig.kt 281–287） */
export type ComicEnhanceMode = 'OFF' | 'CAS' | 'ANIME4K' | 'WAIFU2X' | 'SUPER_RES';

/** 阅读背景（ComicReaderConfig.kt 290–292） */
export type ComicBgType = 'BLACK' | 'WHITE' | 'GRAY' | 'PAPER' | 'DYNAMIC';

/** 场景（ComicReaderConfig.kt 295–299） */
export type ComicScene = 'NONE' | 'RAIN' | 'SNOW' | 'SAKURA' | 'FIREFLY' | 'OCEAN' | 'CAMPFIRE' | 'NIGHT';

/** 翻页动画（ComicReaderConfig.kt 302–304） */
export type ComicPageAnim = 'NONE' | 'SLIDE' | 'FADE' | 'CURL';

/** 手势动作（ComicReaderConfig.kt 308–311） */
export type ComicGestureAction =
  | 'NONE'
  | 'PREV'
  | 'NEXT'
  | 'TOGGLE_CONTROLS'
  | 'TOC'
  | 'SETTINGS'
  | 'EXIT';

/**
 * 面板所需的配置字段（结构镜像 `ComicReaderConfig.kt` 14–105 的对应子集）。
 * 说明：`src/core/comic/` 下配置模块由另一位 agent 负责；此处只声明面板读写的
 * 字段（结构兼容），待其落地后可把 import 换为官方类型。
 */
export interface ComicSheetsConfig {
  mode: ComicMode;
  direction: ComicDirection;
  webtoonSnap: boolean;
  fit: ComicFit;
  customFitBase: ComicFit;
  customFitScale: number;
  pageSpacingDp: number;
  doubleGapDp: number;
  doubleFirstAlone: boolean;
  doubleAlign: ComicDoubleAlign;
  doubleShiftXDp: number;
  doubleShiftYDp: number;
  doubleTapZoom: boolean;
  longPressZoom: boolean;
  zoomWhileTurn: boolean;
  bookRotation: number;
  cropMode: ComicCropMode;
  manualCrop: number[] | null;
  splitWide: boolean;
  splitReverse: boolean;
  splitPosition: number;
  enhanceMode: ComicEnhanceMode;
  enhanceStrength: number;
  filterBrightness: number;
  filterContrast: number;
  filterSaturation: number;
  filterHue: number;
  filterGamma: number;
  filterSharpen: number;
  filterShadow: number;
  filterBW: boolean;
  bgType: ComicBgType;
  paperIntensity: number;
  scene: ComicScene;
  sceneSound: boolean;
  sceneEffect: boolean;
  sceneVolume: number;
  pageAnim: ComicPageAnim;
  autoPageIntervalSec: number;
  autoScrollSpeedDp: number;
  gestureTapLeft: ComicGestureAction;
  gestureTapRight: ComicGestureAction;
  gestureTapCenter: ComicGestureAction;
  gestureSwipe: boolean;
  gesturePinchClose: boolean;
  gestureEdgeSwipe: boolean;
  gestureLongPressPanel: boolean;
  volumeKeyTurn: boolean;
  showThumbPreview: boolean;
  hideSystemBars: boolean;
  translationEnabled: boolean;
  translationLang: string;
  translationTextScale: number;
  translationEngine: string;
}

/** 每本漫画阅读状态（ComicReaderConfig.kt 316–324 中面板用到的字段） */
export interface ComicSheetsBookState {
  pageRotations: Record<string, number>;
  mergeAnchors: ReadonlySet<number>;
}

/** 一套预设（ComicSettingsStore.kt 278–286 中预设面板用到的字段） */
export interface ComicSheetsPreset {
  id: string;
  name: string;
  emoji: string;
  config: ComicSheetsConfig;
  builtIn: boolean;
  favorite: boolean;
}

/** 自定义缩放预设（ComicSettingsStore.kt 309–314） */
export interface ComicSheetsCustomFitPreset {
  id: string;
  name: string;
  base: ComicFit;
  scalePct: number;
}

/** 页面引用（ComicPageLayout.kt 12–21：面板只用 id） */
export interface ComicSheetsPageRef {
  id: string;
}

/** 目录条目（ComicReaderCore.kt `data class ComicTocEntry(val id, val title)`） */
export interface ComicSheetsTocEntry {
  id: string;
  title: string;
}

/* ══════════════ 颜色 / 品牌常量（Kotlin 134, 963–1014, 1843–1868） ══════════════ */

/** Kotlin 134 `private val AccentColor = Color(0xFFF0D9C0)` */
export const ACCENT_COLOR = '#F0D9C0';

/* ══════════════ 设置分组 Tab（Kotlin 136–149） ══════════════ */

export interface SettingsTabData {
  label: string;
  /** Material Icon 名，原样保留（Android：Icons.AutoMirrored.Filled.MenuBook 等） */
  icon: string;
}

/** Tab 命名对齐规范第 1 节词汇：翻页（模式/方向/动画）、显示（缩放/间距）、
 *  主题（背景/场景/沉浸式）；图像 Tab 内含"画质增强"与"滤镜"两个规范名段落，
 *  自动/手势为 28 条修复演进出的超集能力（规范未设同名 Tab）。
 *  第七轮第 3 条：Tab 增加简洁线性图标（书页/眼睛/图片/调色板/时钟/手掌），
 *  作为完整导航区域设计——图标+文字+统一高度+明确但克制的选中反馈。 */
export const SETTINGS_TABS: readonly SettingsTabData[] = [
  { label: '翻页', icon: 'MenuBook' },
  { label: '显示', icon: 'Visibility' },
  { label: '图像', icon: 'Image' },
  { label: '翻译', icon: 'Translate' },
  { label: '主题', icon: 'Palette' },
  { label: '自动', icon: 'Schedule' },
  { label: '手势', icon: 'PanTool' },
];

/* ══════════════ 阅读模式 / 方向（Kotlin 505–610） ══════════════ */

export interface ModeOption {
  mode: ComicMode;
  label: string;
}

/** Kotlin 509–511 `ModeGrid(config.mode)` 的选项来源 `ComicMode.entries` */
export const MODE_OPTIONS: readonly ModeOption[] = [
  { mode: 'SINGLE', label: '单页' },
  { mode: 'DOUBLE', label: '双页' },
  { mode: 'WEBTOON', label: '条漫' },
  { mode: 'CONTINUOUS', label: '无缝滚动' },
  { mode: 'MAGNETIC', label: '磁吸' },
];

export interface DirectionOption {
  direction: ComicDirection;
  label: string;
}

/** Kotlin 512–514 `DirectionGrid(config.direction)` 的选项来源 `ComicDirection.entries` */
export const DIRECTION_OPTIONS: readonly DirectionOption[] = [
  { direction: 'LTR', label: '左 → 右' },
  { direction: 'RTL', label: '右 → 左' },
  { direction: 'TTB', label: '上 → 下' },
];

/* ══════════════ 翻页动画（Kotlin 515–526） ══════════════ */

export interface SegmentOption {
  id: number;
  label: string;
}

/** Kotlin 516–524：ComicPageAnim.NONE/SLIDE/FADE/CURL 的 ordinal + 短标签 */
export const PAGE_ANIM_SEGMENT: readonly SegmentOption[] = [
  { id: 0, label: '无' },
  { id: 1, label: '平移' },
  { id: 2, label: '渐变' },
  { id: 3, label: '仿真' },
];

const PAGE_ANIM_ORDER: readonly ComicPageAnim[] = ['NONE', 'SLIDE', 'FADE', 'CURL'];

/** Kotlin 525 `ComicPageAnim.entries[i]` */
export function pageAnimByIndex(i: number): ComicPageAnim {
  return PAGE_ANIM_ORDER[i] ?? 'NONE';
}

/** Kotlin 524 `config.pageAnim.ordinal` */
export function pageAnimIndex(anim: ComicPageAnim): number {
  const idx = PAGE_ANIM_ORDER.indexOf(anim);
  return idx > 0 ? idx : 0;
}

/* ══════════════ 缩放档（Kotlin 614–625, 643–655） ══════════════ */

/** 缩放档位展示序列（第 10 条五种数学定义 + 第 26 条自定义档） */
export const FIT_OPTIONS: ReadonlyArray<readonly [ComicFit, string]> = [
  ['FIT_PAGE', '整页'],
  ['FIT_HEIGHT', '高度'],
  ['ORIGINAL', '原始'],
  ['FILL', '铺满'],
  ['STRETCH', '拉伸'],
  ['CUSTOM', '自定义'],
];

const FIT_LABEL_FALLBACK: Readonly<Record<ComicFit, string>> = {
  FIT_WIDTH: '适应宽度',
  FIT_HEIGHT: '高度',
  ORIGINAL: '原始大小',
  FILL: '铺满裁切',
  STRETCH: '拉伸铺满',
  FIT_PAGE: '整页',
  CUSTOM: '自定义',
};

function fitEnumLabel(fit: ComicFit): string {
  return FIT_LABEL_FALLBACK[fit];
}

/** Kotlin 624–625 `fitLabel` */
export function fitLabel(fit: ComicFit): string {
  const hit = FIT_OPTIONS.find((entry) => entry[0] === fit);
  if (hit) return hit[1];
  return fit === 'FIT_WIDTH' ? '适应宽度' : fitEnumLabel(fit);
}

/** Kotlin 636–638 `FitOptions.indexOfFirst { it.first == config.fit }.coerceAtLeast(0)` */
export function fitSegmentIndex(fit: ComicFit): number {
  const idx = FIT_OPTIONS.findIndex((entry) => entry[0] === fit);
  return idx > 0 ? idx : 0;
}

/** Kotlin 638 `FitOptions[i].first` */
export function fitBySegmentIndex(i: number): ComicFit {
  return FIT_OPTIONS[i]?.[0] ?? 'FIT_WIDTH';
}

/** 自定义缩放的"基础适配"档（Kotlin 645–650） */
export const CUSTOM_FIT_BASES: ReadonlyArray<readonly [ComicFit, string]> = [
  ['FIT_PAGE', '整页'],
  ['FIT_WIDTH', '适应宽度'],
  ['FIT_HEIGHT', '高度'],
  ['ORIGINAL', '原始'],
];

/** Kotlin 649–650 `indexOf(config.customFitBase).coerceAtLeast(0)` */
export function customFitBaseSegmentIndex(base: ComicFit): number {
  const idx = CUSTOM_FIT_BASES.findIndex((entry) => entry[0] === base);
  return idx > 0 ? idx : 0;
}

/** Kotlin 653 `listOf(FIT_PAGE, FIT_WIDTH, FIT_HEIGHT, ORIGINAL)[i]` */
export function customFitBaseBySegmentIndex(i: number): ComicFit {
  return CUSTOM_FIT_BASES[i]?.[0] ?? 'FIT_PAGE';
}

/* ══════════════ 双页对齐（Kotlin 735–743） ══════════════ */

/** Kotlin 737–741：ComicDoubleAlign.TOP/CENTER/BOTTOM 的 ordinal + 短标签 */
export const DOUBLE_ALIGN_SEGMENT: readonly SegmentOption[] = [
  { id: 0, label: '顶部' },
  { id: 1, label: '居中' },
  { id: 2, label: '底部' },
];

/** Kotlin 743 `ComicDoubleAlign.entries[i]` */
export const DOUBLE_ALIGN_ORDER: readonly ComicDoubleAlign[] = ['TOP', 'CENTER', 'BOTTOM'];

/** Kotlin 743 `ComicDoubleAlign.entries[i]` */
export function doubleAlignByIndex(i: number): ComicDoubleAlign {
  return DOUBLE_ALIGN_ORDER[i] ?? 'CENTER';
}

/** Kotlin 742 `config.doubleAlign.ordinal` */
export function doubleAlignIndex(align: ComicDoubleAlign): number {
  const idx = DOUBLE_ALIGN_ORDER.indexOf(align);
  return idx > 0 ? idx : 0;
}

/* ══════════════ 自动裁边（Kotlin 784–793） ══════════════ */

/** Kotlin 785–791：ComicCropMode.OFF/WHITE/BLACK/AUTO 的 ordinal + 短标签 */
export const CROP_MODE_SEGMENT: readonly SegmentOption[] = [
  { id: 0, label: '关闭' },
  { id: 1, label: '白边' },
  { id: 2, label: '黑边' },
  { id: 3, label: '自动' },
];

const CROP_MODE_ORDER: readonly ComicCropMode[] = ['OFF', 'WHITE', 'BLACK', 'AUTO'];

/** Kotlin 793 `ComicCropMode.entries[i]` */
export function cropModeByIndex(i: number): ComicCropMode {
  return CROP_MODE_ORDER[i] ?? 'OFF';
}

/** Kotlin 792 `config.cropMode.ordinal` */
export function cropModeIndex(mode: ComicCropMode): number {
  const idx = CROP_MODE_ORDER.indexOf(mode);
  return idx > 0 ? idx : 0;
}

/* ══════════════ 整本旋转（Kotlin 837–842） ══════════════ */

/** Kotlin 840 `listOf(0 to "0°", 90 to "90°", 180 to "180°", 270 to "270°")` */
export const BOOK_ROTATION_SEGMENT: readonly SegmentOption[] = [
  { id: 0, label: '0°' },
  { id: 90, label: '90°' },
  { id: 180, label: '180°' },
  { id: 270, label: '270°' },
];

/** Kotlin 841 `((config.bookRotation % 360) + 360) % 360` */
export function normalizeBookRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Kotlin 845–852：旋转本页 +90°（`cur + 90` 再 `% 360`，写回 pageRotations） */
export function nextPageRotation(current: number): number {
  return (current + 90) % 360;
}

/** Kotlin 844, 846–852 `pages.getOrNull(currentRawPage)` 为 null 时按钮无副作用 */
export function pageRotationFor(
  rotations: Readonly<Record<string, number>>,
  pageId: string | null,
): number | null {
  if (pageId === null) return null;
  return rotations[pageId] ?? 0;
}

/** Kotlin 854–861：与下一页临时合页 / 取消临时合页 */
export function toggleMergeAnchor(anchors: ReadonlySet<number>, rawPage: number): Set<number> {
  const next = new Set(anchors);
  if (next.has(rawPage)) {
    next.delete(rawPage);
  } else {
    next.add(rawPage);
  }
  return next;
}

/** Kotlin 854 按钮文案：当前页是否已作为临时合页锚点 */
export function mergeAnchorLabel(anchors: ReadonlySet<number>, rawPage: number): string {
  return anchors.has(rawPage) ? '取消临时合页' : '与下一页临时合页';
}

/* ══════════════ 画质增强（Kotlin 866–881） ══════════════ */

export interface EnhanceOption {
  mode: ComicEnhanceMode;
  label: string;
  desc: string;
}

/** Kotlin 869 `ComicEnhanceMode.entries.map { it.ordinal to it.label }`（含 desc） */
export const ENHANCE_OPTIONS: readonly EnhanceOption[] = [
  { mode: 'OFF', label: '关闭', desc: '' },
  {
    mode: 'CAS',
    label: '锐化增强',
    desc: '对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）',
  },
  {
    mode: 'ANIME4K',
    label: 'Anime4K 轻量',
    desc: 'Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）',
  },
  {
    mode: 'WAIFU2X',
    label: '超分 完整',
    desc: 'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
  },
  {
    mode: 'SUPER_RES',
    label: '超分辨率',
    desc: 'Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）',
  },
];

/** Kotlin 872 `ComicEnhanceMode.entries[config.enhanceMode.ordinal]` */
export function enhanceOption(mode: ComicEnhanceMode): EnhanceOption {
  return ENHANCE_OPTIONS.find((entry) => entry.mode === mode) ?? ENHANCE_OPTIONS[0]!;
}

/** Kotlin 869 的分段选项（id = 枚举下标） */
export const ENHANCE_SEGMENT: readonly SegmentOption[] = ENHANCE_OPTIONS.map((entry, i) => ({
  id: i,
  label: entry.label,
}));

/** Kotlin 871 `ComicEnhanceMode.entries[i]` */
export function enhanceModeByIndex(i: number): ComicEnhanceMode {
  return ENHANCE_OPTIONS[i]?.mode ?? 'OFF';
}

/** Kotlin 870 `config.enhanceMode.ordinal` */
export function enhanceSegmentIndexOf(mode: ComicEnhanceMode): number {
  const idx = ENHANCE_OPTIONS.findIndex((entry) => entry.mode === mode);
  return idx > 0 ? idx : 0;
}

/* ══════════════ 滤镜（Kotlin 883–915） ══════════════ */

/** Kotlin 907–913 `重置全部滤镜` 的目标值 */
export const FILTER_RESET_PATCH = {
  filterBrightness: 0,
  filterContrast: 0,
  filterSaturation: 0,
  filterHue: 0,
  filterGamma: 1.0,
  filterSharpen: 0,
  filterShadow: 0,
  filterBW: false,
} as const;

/* ══════════════ 阅读背景色卡（Kotlin 979–1037） ══════════════ */

export interface BgSwatch {
  type: ComicBgType;
  label: string;
  /** Kotlin 986–990 的 Compose Color 字面量，原样保留 */
  fill: string;
}

/** 背景类型的可视化色卡（选中 = 品牌描边环；内容直观看，无需解释文字） */
export const BG_SWATCHES: readonly BgSwatch[] = [
  { type: 'BLACK', label: '纯黑', fill: '#0A0A0C' },
  { type: 'WHITE', label: '纯白', fill: '#FAFAF7' },
  { type: 'GRAY', label: '深灰', fill: '#2A2A2E' },
  { type: 'PAPER', label: '纸张', fill: '#E9E2D0' },
  { type: 'DYNAMIC', label: '沉浸', fill: '#35323A' },
];

/**
 * Kotlin 1012–1014 选中对勾的着色：BLACK/GRAY/DYNAMIC 用薄荷绿，
 * 纯白/纸张用深棕（否则浅色卡上看不见）。
 */
export function bgCheckTint(type: ComicBgType): string {
  return type === 'BLACK' || type === 'GRAY' || type === 'DYNAMIC'
    ? 'var(--cmcs-mint)'
    : '#44403A';
}

/* ══════════════ 场景（Kotlin 1040–1092） ══════════════ */

export interface SceneOption {
  scene: ComicScene;
  label: string;
  /** Material Icon 名，原样保留 */
  icon: string;
}

/** 场景图标卡（4 列 FlowRow；选中 = 品牌半透明填充 + 细边框） */
export const SCENE_OPTIONS: readonly SceneOption[] = [
  { scene: 'NONE', label: '关闭', icon: 'Block' },
  { scene: 'RAIN', label: '雨夜', icon: 'WaterDrop' },
  { scene: 'SNOW', label: '落雪', icon: 'AcUnit' },
  { scene: 'SAKURA', label: '樱花', icon: 'LocalFlorist' },
  { scene: 'FIREFLY', label: '萤火', icon: 'AutoAwesome' },
  { scene: 'OCEAN', label: '海边', icon: 'Waves' },
  { scene: 'CAMPFIRE', label: '篝火', icon: 'LocalFireDepartment' },
  { scene: 'NIGHT', label: '夏夜', icon: 'NightsStay' },
];

/* ══════════════ 手势动作（Kotlin 1245–1258） ══════════════ */

export interface GestureActionOption {
  action: ComicGestureAction;
  label: string;
}

/** Kotlin 1248 `ComicGestureAction.entries.map { it.ordinal to it.label }` */
export const GESTURE_ACTIONS: readonly GestureActionOption[] = [
  { action: 'NONE', label: '无操作' },
  { action: 'PREV', label: '上一页' },
  { action: 'NEXT', label: '下一页' },
  { action: 'TOGGLE_CONTROLS', label: '呼出/隐藏控制' },
  { action: 'TOC', label: '目录' },
  { action: 'SETTINGS', label: '设置' },
  { action: 'EXIT', label: '退出' },
];

/** Kotlin 1248 的分段选项（id = 枚举下标） */
export const GESTURE_SEGMENT: readonly SegmentOption[] = GESTURE_ACTIONS.map((entry, i) => ({
  id: i,
  label: entry.label,
}));

/** Kotlin 1250 / 1253 / 1256 `ComicGestureAction.entries[i]` */
export function gestureActionByIndex(i: number): ComicGestureAction {
  return GESTURE_ACTIONS[i]?.action ?? 'NONE';
}

/** Kotlin 1249 / 1252 / 1255 `config.gestureTapXxx.ordinal` */
export function gestureIndexOf(action: ComicGestureAction): number {
  const idx = GESTURE_ACTIONS.findIndex((entry) => entry.action === action);
  return idx > 0 ? idx : 0;
}

/* ══════════════ 翻译 Tab 纯逻辑（Kotlin 357, 370–388, 401–409, 470–502） ══════════════ */

/** Kotlin 360, 404 `listOf(0 to "自动识别", 1 to "日文", 2 to "英文")` */
export const TRANSLATION_LANG_SEGMENT: readonly SegmentOption[] = [
  { id: 0, label: '自动识别' },
  { id: 1, label: '日文' },
  { id: 2, label: '英文' },
];

/** Kotlin 357, 401 `when (config.translationLang) { "ja" -> 1; "en" -> 2; else -> 0 }` */
export function translationLangIndex(lang: string): number {
  if (lang === 'ja') return 1;
  if (lang === 'en') return 2;
  return 0;
}

/** Kotlin 363, 407 `when (i) { 1 -> "ja"; 2 -> "en"; else -> "auto" }` */
export function translationLangByIndex(i: number): string {
  if (i === 1) return 'ja';
  if (i === 2) return 'en';
  return 'auto';
}

/** Kotlin 370 `llmUrl.isNotBlank() && llmModel.isNotBlank()` */
export function isAiConfigured(url: string, model: string): boolean {
  return url.trim() !== '' && model.trim() !== '';
}

/** Kotlin 374–378 自定义 AI 接口卡片的状态文案 */
export function aiEngineState(engine: string, configured: boolean): string {
  if (engine === 'ai' && configured) return '当前使用 · 已配置';
  if (configured) return '已配置 · 点击选用并配置';
  return '未配置 · 点击选用并配置';
}

/** Kotlin 388 在线翻译卡片的状态文案 */
export function onlineEngineState(engine: string): string {
  return engine === 'online' ? '当前使用' : '点击选用';
}

/** Kotlin 416 `OCR 模型（约 31MB，已下载）` 的 31MB 常量 */
export const OCR_MODEL_MB = 31;

/** Kotlin 442 `需要下载离线 OCR 模型（约 31MB，仅一次）` 的 31MB 常量 */
export const OCR_MODEL_SIZE_HINT = `需要下载离线 OCR 模型（约 ${OCR_MODEL_MB}MB，仅一次）`;

/** Kotlin 416 `OCR 模型（约 31MB，已下载）` */
export const OCR_MODEL_READY_LABEL = `OCR 模型（约 ${OCR_MODEL_MB}MB，已下载）`;

/** Kotlin 482 `"已缓存译文（${cacheBytes / 1024 / 1024}MB / 64MB）"`（Long 整除） */
export const TRANSLATION_CACHE_LIMIT_MB = 64;

/** Kotlin 482：Long 整除截断，保留 Kotlin 的整数除法语义 */
export function translationCacheLabel(cacheBytes: number): string {
  const mb = Math.floor(cacheBytes / 1024 / 1024);
  return `已缓存译文（${mb}MB / ${TRANSLATION_CACHE_LIMIT_MB}MB）`;
}

/** Kotlin 421 `"正在下载模型 ${(downloading * 100).toInt()}%"`（Float.toInt = 截断） */
export function downloadProgressLabel(downloading: number): string {
  return `正在下载模型 ${Math.trunc(downloading * 100)}%`;
}

/** Kotlin 464 `"下载失败：$it（可切换网络后重试）"` */
export function downloadErrorLabel(message: string): string {
  return `下载失败：${message}（可切换网络后重试）`;
}

/** Kotlin 329 LLM 配置保存失败的 Toast 文案 */
export const LLM_SAVE_ERROR = '配置保存失败';

/** Kotlin 1589 新建预设默认名 `name.ifBlank { "我的预设" }` */
export const PRESET_DEFAULT_NAME = '我的预设';

/** Kotlin 1589 默认 emoji `name.take(2).ifBlank { "SC" }` */
export function presetEmojiFromName(name: string): string {
  const trimmed = name.trim();
  const two = trimmed.slice(0, 2);
  return two.trim() === '' ? 'SC' : two;
}

/** Kotlin 1601 重命名预设 `name.ifBlank { target.name }` */
export function presetNameOrFallback(name: string, fallback: string): string {
  return name.trim() === '' ? fallback : name;
}

/** Kotlin 1625 `name = it.take(12)` */
export const PRESET_NAME_MAX_LEN = 12;

export function clampPresetName(name: string): string {
  return name.slice(0, PRESET_NAME_MAX_LEN);
}

/* ══════════════ 数值格式化（Kotlin 475, 658, 721, 732, 746, 750, 832, 877, 885–905） ══════════════ */

/** Kotlin 475 `"${it.toInt()}%"` */
export function formatPercent(v: number): string {
  return `${Math.trunc(v)}%`;
}

/** Kotlin 658 `"${(it * 100).toInt()}%"` */
export function formatScalePercent(scale: number): string {
  return `${Math.trunc(scale * 100)}%`;
}

/** Kotlin 721, 732, 746, 750 `"${it.toInt()} dp"` */
export function formatDp(v: number): string {
  return `${Math.trunc(v)} dp`;
}

/** Kotlin 832 `"%.0f%%".format(it * 100)`（四舍五入） */
export function formatSplitPosition(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Kotlin 894 `"${it.toInt()}°"` */
export function formatDegrees(v: number): string {
  return `${Math.trunc(v)}°`;
}

/** Kotlin 897 `"%.2f".format(it)` */
export function formatGamma(v: number): string {
  return v.toFixed(2);
}

/** Kotlin 877, 885–893, 900, 903 `"${it.toInt()}"` */
export function formatInt(v: number): string {
  return `${Math.trunc(v)}`;
}

/** Kotlin 1231 `"${it.toInt()} 秒"` */
export function formatSeconds(v: number): string {
  return `${Math.trunc(v)} 秒`;
}

/** Kotlin 1238 `"${it.toInt()} dp/s"` */
export function formatDpPerSec(v: number): string {
  return `${Math.trunc(v)} dp/s`;
}

/** Kotlin 476 `(v / 100f).coerceIn(0.8f, 1.4f)` */
export function scaleToTranslationTextScale(v: number): number {
  return Math.min(1.4, Math.max(0.8, v / 100));
}

/** Kotlin 678 `${p.name}（${fitLabel(p.base)} × ${p.scalePct}%）` */
export function customFitPresetLabel(preset: ComicSheetsCustomFitPreset): string {
  return `${preset.name}（${fitLabel(preset.base)} × ${preset.scalePct}%）`;
}

/* ══════════════ 滤镜/增强/裁边指纹（Kotlin ComicReaderConfig.kt 163–170） ══════════════ */

/**
 * 滤镜/增强/裁边相关的指纹，用于位图处理缓存键。
 * 来源 `ComicReaderConfig.imagePipelineFingerprint()`；设置面板用它当预览图的
 * 失效键（Kotlin 936），故在此镜像一份纯函数版本。
 * 注：`String.format(Locale.ROOT, "%.3f", filterGamma)` → `toFixed(3)`。
 */
export function imagePipelineFingerprint(config: ComicSheetsConfig): string {
  return [
    config.cropMode,
    // Kotlin `manualCrop?.joinToString(",")` → null 时列表里存 null，
    // `joinToString` 渲染成字符串 "null"（JS Array.join 会渲染成空串，故显式转换）
    config.manualCrop === null ? 'null' : config.manualCrop.join(','),
    config.bookRotation,
    config.splitWide,
    config.splitPosition,
    config.enhanceMode,
    config.enhanceStrength,
    config.filterBrightness,
    config.filterContrast,
    config.filterSaturation,
    config.filterHue,
    config.filterGamma.toFixed(3),
    config.filterSharpen,
    config.filterShadow,
    config.filterBW,
  ].join('|');
}

/* ══════════════ 预设列表排序（Kotlin 1420） ══════════════ */

/**
 * 收藏置顶（第 27 条）：列表按 favorite 降序**稳定**排序，收藏组永远在最前。
 * `Array.prototype.sort` 在 ES2019+ 规范上即稳定，等价 Kotlin `sortedByDescending`。
 */
export function sortPresetsFavoritesFirst<T extends { favorite: boolean }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite));
}

/* ══════════════ 预设副标题（Kotlin 1471–1474） ══════════════ */

/** `${preset.config.mode.label} · ${preset.config.direction.label} · ${preset.config.pageAnim.label}` */
export function presetSubtitle(config: ComicSheetsConfig): string {
  const mode = MODE_OPTIONS.find((e) => e.mode === config.mode)?.label ?? config.mode;
  const dir = DIRECTION_OPTIONS.find((e) => e.direction === config.direction)?.label ?? config.direction;
  const anim = PAGE_ANIM_OPTIONS_LABEL[config.pageAnim] ?? config.pageAnim;
  return `${mode} · ${dir} · ${anim}`;
}

/** `ComicPageAnim.label`（ComicReaderConfig.kt 302–304） */
export const PAGE_ANIM_OPTIONS_LABEL: Readonly<Record<ComicPageAnim, string>> = {
  NONE: '无动画',
  SLIDE: '平移',
  FADE: '渐变',
  CURL: '仿真翻页',
};

/* ══════════════ 手动裁边（Kotlin 1661–1684, 1720–1725, 1774–1872） ══════════════ */

/** Kotlin 1664 / 1698 默认裁剪框 */
export const DEFAULT_CROP: readonly [number, number, number, number] = [0.06, 0.06, 0.94, 0.94];

/** Kotlin 1674–1677 最小裁剪区 5% */
export const MIN_CROP_SIZE = 0.05;

function coerceIn(v: number, lo: number, hi: number): number {
  if (lo > hi) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Kotlin 1672–1684 `onCropChangeWithHaptic` 的钳制部分：
 * 限制最小裁剪区 5%；贴边（0/1 边界被钳制）时应有轻触觉反馈。
 * 返回新数组（Kotlin `raw.copyOf()`），不修改入参。
 *
 * 一处防御性差异：Kotlin `Float.coerceIn(min, max)` 在 `min > max` 时抛
 * IllegalArgumentException。Kotlin 1674 `raw[0].coerceIn(0f, raw[2] - 0.05f)`
 * 在「右边界被拖到左边界左侧」时会命中该分支并崩溃；这里改为返回 `lo`，
 * 使矩形退化为最小 5% 而不是抛错（拖动仍可继续反向拉回）。
 */
export function clampCrop(raw: readonly number[]): [number, number, number, number] {
  const next: [number, number, number, number] = [
    raw[0] ?? 0,
    raw[1] ?? 0,
    raw[2] ?? 1,
    raw[3] ?? 1,
  ];
  next[0] = coerceIn(next[0], 0, next[2] - MIN_CROP_SIZE);
  next[1] = coerceIn(next[1], 0, next[3] - MIN_CROP_SIZE);
  next[2] = coerceIn(next[2], next[0] + MIN_CROP_SIZE, 1);
  next[3] = coerceIn(next[3], next[1] + MIN_CROP_SIZE, 1);
  return next;
}

/** Kotlin 1678–1682 贴边判定（驱动 HapticsGate + performHapticFeedback） */
export function cropTouchesEdge(crop: readonly number[]): boolean {
  return crop[0] === 0 || crop[1] === 0 || crop[2] === 1 || crop[3] === 1;
}

/**
 * Kotlin 1720–1723
 * `"L %.0f%% · T %.0f%% · R %.0f%% · B %.0f%%".format(crop[0]*100, crop[1]*100, (1-crop[2])*100, (1-crop[3])*100)`
 */
export function cropInsetsLabel(crop: readonly number[]): string {
  const l = Math.round((crop[0] ?? 0) * 100);
  const t = Math.round((crop[1] ?? 0) * 100);
  const r = Math.round((1 - (crop[2] ?? 1)) * 100);
  const b = Math.round((1 - (crop[3] ?? 1)) * 100);
  return `L ${l}% · T ${t}% · R ${r}% · B ${b}%`;
}

/** Kotlin 1781 `val handleR = 14.dp`，Kotlin 1807/1809 命中半径 `hr * 1.6f` */
export const CROP_HANDLE_RADIUS_PX = 14;
export const CROP_HANDLE_HIT_SCALE = 1.6;

/** 命中对象：0..3 四角，4..7 四边（Kotlin 1782 注释 "0..3 角 4..7 边"） */
export type CropHandle = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const NO_HANDLE = -1;

/** Kotlin 1799–1804 角点与边中点（以像素坐标表达） */
export function cropAnchorPoints(crop: readonly number[], w: number, h: number): {
  corners: ReadonlyArray<readonly [number, number]>;
  edges: ReadonlyArray<readonly [number, number]>;
} {
  const x0 = (crop[0] ?? 0) * w;
  const y0 = (crop[1] ?? 0) * h;
  const x1 = (crop[2] ?? 1) * w;
  const y1 = (crop[3] ?? 1) * h;
  return {
    corners: [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ],
    edges: [
      [(x0 + x1) / 2, y0],
      [(x0 + x1) / 2, y1],
      [x0, (y0 + y1) / 2],
      [x1, (y0 + y1) / 2],
    ],
  };
}

/**
 * Kotlin 1806–1810：命中判定基于「上一次调整后」的最新框位置。
 * 先角后边（角优先），命中半径 `hr * 1.6f`。未命中返回 -1。
 */
export function cropHandleFromPoint(
  crop: readonly number[],
  w: number,
  h: number,
  px: number,
  py: number,
): CropHandle | -1 {
  const hitR = CROP_HANDLE_RADIUS_PX * CROP_HANDLE_HIT_SCALE;
  const { corners, edges } = cropAnchorPoints(crop, w, h);
  let active: CropHandle | -1 = NO_HANDLE;
  corners.forEach((c, i) => {
    if (Math.hypot(px - c[0], py - c[1]) < hitR) active = i as CropHandle;
  });
  if (active === NO_HANDLE) {
    edges.forEach((c, i) => {
      if (Math.hypot(px - c[0], py - c[1]) < hitR) active = (i + 4) as CropHandle;
    });
  }
  return active;
}

/**
 * Kotlin 1811–1830：拖动派生。`px`/`py` 已由 Kotlin 1816–1817 钳制到 0..1，
 * 派生基准 = 最新 crop（连续交替拖动四边互不回退）。
 */
export function applyCropHandleDrag(
  crop: readonly number[],
  active: CropHandle,
  px: number,
  py: number,
): [number, number, number, number] {
  const n: [number, number, number, number] = [
    crop[0] ?? 0,
    crop[1] ?? 0,
    crop[2] ?? 1,
    crop[3] ?? 1,
  ];
  const cx = Math.min(1, Math.max(0, px));
  const cy = Math.min(1, Math.max(0, py));
  switch (active) {
    case 0:
      n[0] = cx;
      n[1] = cy;
      break;
    case 1:
      n[2] = cx;
      n[1] = cy;
      break;
    case 2:
      n[0] = cx;
      n[3] = cy;
      break;
    case 3:
      n[2] = cx;
      n[3] = cy;
      break;
    case 4:
      n[1] = cy;
      break;
    case 5:
      n[3] = cy;
      break;
    case 6:
      n[0] = cx;
      break;
    default:
      n[2] = cx;
      break;
  }
  return n;
}

/* ══════════════ 面板布局常量（Kotlin 173–188, 1293, 1415） ══════════════ */

/** Kotlin 175 `if (landscape) 0.94f else 0.72f` */
export const SHEET_HEIGHT_LANDSCAPE = 0.94;
export const SHEET_HEIGHT_PORTRAIT = 0.72;

/** Kotlin 176 `if (landscape) 840.dp else 560.dp` */
export const SHEET_MAX_WIDTH_LANDSCAPE = 840;
export const SHEET_MAX_WIDTH_PORTRAIT = 560;

/** Kotlin 1293 `heightFraction = 0.7f`（目录面板） */
export const TOC_SHEET_HEIGHT = 0.7;

/** Kotlin 1415 `heightFraction = 0.62f`（预设面板） */
export const PRESET_SHEET_HEIGHT = 0.62;

/** Kotlin 1388 `GridCells.Adaptive(72.dp)`（目录页缩略图网格） */
export const TOC_THUMB_MIN_WIDTH = 72;

/**
 * comicReaderConfig.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/comic/ComicReaderConfig.kt`（352 行 / 321 非空）。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderConfig.kt
 * TS 目标:   IOS/src/core/comic/comicReaderConfig.ts
 * 配套:      IOS/src/core/comic/comicSettingsStore.ts（仓库）
 *            IOS/src/ui/pages/ComicReaderPage.tsx（消费侧）
 *
 * Kotlin → TS 映射（行号 = ComicReaderConfig.kt）
 * ----------------------------------------------
 *   1       `package com.example.ui.comic`        → 无对应物（TS 无包）
 *   3-4     `org.json.JSONArray` / `JSONObject`   → 本文件底部的
 *                                                     `optString/optBoolean/optInt/
 *                                                      optDouble/optJSONArray/
 *                                                      optJSONObject`（Android
 *                                                      `JSONObject` 语义逐条照搬）
 *   6-13    文件 KDoc「漫画阅读器完整配置模型」    → 本文件头（压缩保留）
 *   14-105  `data class ComicReaderConfig(…)`      → `interface ComicReaderConfig`
 *                                                      + `DEFAULT_COMIC_READER_CONFIG`
 *                                                      + `createComicReaderConfig()`
 *                                                      （Kotlin 的默认参数 → TS 的
 *                                                       全字段工厂，逐字段默认值照抄）
 *   106-161 `fun toJson(): JSONObject`             → `comicReaderConfigToJson()`（键序照抄）
 *   163-170 `fun imagePipelineFingerprint()`       → `imagePipelineFingerprint()`
 *   172-239 `companion object { fun fromJson }`   → `comicReaderConfigFromJson()`
 *                                                      + 本地函数 `safe()`（L174-175）
 *                                                      + `coerceIn` / `coerceAtLeast` 助手
 *   242-245 `enum class ComicMode(val label)`     → `ComicMode` + `COMIC_MODE_ORDINAL`
 *                                                      + `COMIC_MODE_LABEL`
 *   247-250 `enum class ComicDirection(val label)` → 同上（`ComicDirection`）
 *   252-265 `enum class ComicFit(val label)`      → 同上（`ComicFit`）
 *   267-270 `enum class ComicDoubleAlign`         → 同上
 *   272-275 `enum class ComicCropMode`            → 同上
 *   277-287 `enum class ComicEnhanceMode(label, desc)`
 *                                                  → 同上 + `COMIC_ENHANCE_MODE_DESC`
 *   289-292 `enum class ComicBgType`              → 同上
 *   294-299 `enum class ComicScene`               → 同上
 *   301-304 `enum class ComicPageAnim`            → 同上
 *   306-311 `enum class ComicGestureAction`       → 同上
 *   313-315 `ComicBookState` KDoc                 → 本文件头对应小节
 *   316-324 `data class ComicBookState(…)`        → `interface ComicBookState` +
 *                                                      `EMPTY_COMIC_BOOK_STATE`
 *   325-332 `fun toJson(): JSONObject`            → `comicBookStateToJson()`
 *   334-351 `companion object { fun fromJson }`   → `comicBookStateFromJson()`
 *                                                      （两处 `runCatching` 的兜底语义保留）
 *
 * 枚举 ordinal（**持久化契约**）
 * --------------------------
 *  Kotlin 的 `Enum.ordinal` 就是声明顺序下标；`entries` 的下标同样如此。
 *  本文件为每个枚举同时提供：
 *    · `XXX_ORDINAL`  —— ordinal → 名称 的显式表（**load-bearing：持久化的 int**）
 *    · `XXX_VALUES`   —— 声明顺序数组
 *    · `XXX_LABEL`    —— `val label` 的中文（逐字搬运）
 *  顺序一旦改动，缓存键与旧存档全部失效 —— 单元测试逐项锁定。
 *
 * 与既有镜像文件的一致性（**未改动的文件**）
 * --------------------------------------
 *  以下文件在本次之前已经声明了同名的字符串联合 / 结构子集，本文件的值与它们
 *  逐字相同，因此可以双向赋值、无需 cast：
 *    · `comicPortTypes.ts`（`ComicMode`…`ComicPageAnim`、`ComicConfigSubset`）
 *    · `comicReaderCore.ts`（同名联合 + `ComicReaderConfig` + `imagePipelineFingerprint`）
 *    · `comicPageLayout.ts`（`ComicMode`/`ComicDirection`/`ComicBgType` 子集）
 *    · `comicReaderSheets.ts`（九种枚举，含 `ComicScene`）
 *
 *  ⚠️ 两处**已存在的分歧**，本文件按 Kotlin 为准并在此登记（我没有改那些文件）：
 *  1. `manualCrop == null` 时 Kotlin `listOf(...).joinToString("|")` 渲染成
 *     `"…|null|…"`（`joinToString` 把 null 元素写成 `"null"`），
 *     而 `comicReaderCore.imagePipelineFingerprint` 用 JS `Array.join('|')`
 *     把 null 渲染成空串 → `"…||…"`。本文件用 Kotlin 的 `"null"`。
 *     影响面：`comicCacheKey` 的取值；两处并存期间两种 key 都可能出现在缓存里。
 *  2. `splitPosition` 的 `Float.toString()`：Kotlin 是 float32 的最短可往返表示，
 *     JS `String(number)` 是 float64。本文件用 `String(value)`（与
 *     `comicReaderCore` 一致），否则两处算出的指纹会不同。
 *  另外 Kotlin 的 `Float`（32 位）在 `fromJson` 里经过 `.toFloat()` 收窄，
 *  本文件全程 float64（不 `Math.fround`）——与本仓库既有所有 Kotlin-Float 端口
 *  的做法一致，`comicReaderCore` 亦然。
 *
 * 与 `comicReaderCore.ts` 的 `imagePipelineFingerprint` 比较：
 *  Kotlin L165 用 `cropMode.name` 等**枚举名**（字符串），L169 用
 *  `String.format(ROOT, "%.3f", filterGamma)`；`String.format` 用
 *  HALF_UP + `Locale.ROOT`（小数点 `.`），JS `toFixed(3)` 的舍入规则与之
 *  一致（半数远离零），小数点同为 `.`，故逐字采用 `toFixed(3)`。
 *
 * Skipped（未移植 + 原因）
 * ------------------------
 *   L14      `data class` 自动生成的 `copy()/equals()/hashCode()/componentN()`
 *            → 未生成。本仓库对 `ComicReaderConfig` 一律用对象展开
 *              `{ ...config, x: y }`（见 `comicReaderChrome.tsx` L302 的等价做法）。
 *              `ComicPreset` 的 `copy()` 有真实调用点（L119/L171/L184），
 *              在 `comicSettingsStore.ts` 里以显式展开实现。
 *   L195-198 `manualCrop` 的 `runCatching { … }`            → `manualCropFromJson()`，
 *            异常语义（`optJSONArray` 为 null / 长度≠4 / 元素无法转 double → null）照搬
 *   L336-343 `ComicBookState.fromJson` 的两处 `runCatching`
 *                                                   → 显式 try/catch 语义照搬：
 *              `pageRotations` 解码失败 → 空 map；`mergeAnchors` 任一元素无法
 *              转 int → 整个集合退化为空集
 *   L174-175 `fun <E : Enum<E>> safe(name, fallback, values)` → `enumFromJson()`
 *              （泛型在 TS 里退化成「值数组 + fallback」的联合类型参数）
 *   L172-239 `companion object` 的 Kotlin 特性（`ComicReaderConfig.fromJson`）
 *                                                   → 自由函数 `comicReaderConfigFromJson`
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin 枚举区（L242-311）— 声明顺序 / ordinal / label 逐字保留
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L242「阅读模式：单页/双页/条漫/无缝滚动/磁吸」+ L243 `enum class ComicMode`。 */
export type ComicMode = 'SINGLE' | 'DOUBLE' | 'WEBTOON' | 'CONTINUOUS' | 'MAGNETIC';

/** Kotlin L244 声明顺序（ordinal = 下标）。 */
export const COMIC_MODE_VALUES: readonly ComicMode[] = [
  'SINGLE',
  'DOUBLE',
  'WEBTOON',
  'CONTINUOUS',
  'MAGNETIC',
];

/** Kotlin `ComicMode.ordinal`。 */
export const COMIC_MODE_ORDINAL: Readonly<Record<ComicMode, number>> = {
  SINGLE: 0,
  DOUBLE: 1,
  WEBTOON: 2,
  CONTINUOUS: 3,
  MAGNETIC: 4,
};

/** Kotlin L244 `val label`。 */
export const COMIC_MODE_LABEL: Readonly<Record<ComicMode, string>> = {
  SINGLE: '单页',
  DOUBLE: '双页',
  WEBTOON: '条漫',
  CONTINUOUS: '无缝滚动',
  MAGNETIC: '磁吸',
};

/** Kotlin L247-248。 */
export type ComicDirection = 'LTR' | 'RTL' | 'TTB';

/** Kotlin L249 声明顺序。 */
export const COMIC_DIRECTION_VALUES: readonly ComicDirection[] = ['LTR', 'RTL', 'TTB'];

/** Kotlin `ComicDirection.ordinal`。 */
export const COMIC_DIRECTION_ORDINAL: Readonly<Record<ComicDirection, number>> = {
  LTR: 0,
  RTL: 1,
  TTB: 2,
};

/** Kotlin L249 `val label`（「左 → 右」等含 U+2192 箭头，逐字保留）。 */
export const COMIC_DIRECTION_LABEL: Readonly<Record<ComicDirection, string>> = {
  LTR: '左 → 右',
  RTL: '右 → 左',
  TTB: '上 → 下',
};

/** Kotlin L252-261 的 KDoc（第 10 条数学定义）见下方注释；L262-265 枚举本体。 */
export type ComicFit =
  | 'FIT_WIDTH'
  | 'FIT_HEIGHT'
  | 'ORIGINAL'
  | 'FILL'
  | 'STRETCH'
  | 'FIT_PAGE'
  | 'CUSTOM';

/**
 * 页面显示方式（第 10 条数学定义，严格实现）：
 * - FIT_WIDTH 适应宽度：按容器宽缩放，纵向自然溢出（可滚动）；
 * - FIT_HEIGHT 高度：按容器高缩放，宽度可能超出（左右平移查看）；
 * - ORIGINAL 原始：图片原始像素 1:1；
 * - FILL 铺满：填满容器居中裁剪多余（crop-to-fill）；
 * - STRETCH 拉伸：不保持比例强制铺满；
 * - FIT_PAGE 整页：完整装入容器保持比例（fit-inside，可能有留白）；
 * - CUSTOM 自定义（第 26 条）：基础档 × 用户缩放系数。
 */
export const COMIC_FIT_VALUES: readonly ComicFit[] = [
  'FIT_WIDTH',
  'FIT_HEIGHT',
  'ORIGINAL',
  'FILL',
  'STRETCH',
  'FIT_PAGE',
  'CUSTOM',
];

/** Kotlin `ComicFit.ordinal`。 */
export const COMIC_FIT_ORDINAL: Readonly<Record<ComicFit, number>> = {
  FIT_WIDTH: 0,
  FIT_HEIGHT: 1,
  ORIGINAL: 2,
  FILL: 3,
  STRETCH: 4,
  FIT_PAGE: 5,
  CUSTOM: 6,
};

/** Kotlin L263-264 `val label`。 */
export const COMIC_FIT_LABEL: Readonly<Record<ComicFit, string>> = {
  FIT_WIDTH: '适应宽度',
  FIT_HEIGHT: '适应高度',
  ORIGINAL: '原始大小',
  FILL: '铺满裁切',
  STRETCH: '拉伸铺满',
  FIT_PAGE: '整页',
  CUSTOM: '自定义',
};

/** Kotlin L267-268。 */
export type ComicDoubleAlign = 'TOP' | 'CENTER' | 'BOTTOM';

/** Kotlin L269 声明顺序。 */
export const COMIC_DOUBLE_ALIGN_VALUES: readonly ComicDoubleAlign[] = ['TOP', 'CENTER', 'BOTTOM'];

/** Kotlin `ComicDoubleAlign.ordinal`。 */
export const COMIC_DOUBLE_ALIGN_ORDINAL: Readonly<Record<ComicDoubleAlign, number>> = {
  TOP: 0,
  CENTER: 1,
  BOTTOM: 2,
};

/** Kotlin L269 `val label`。 */
export const COMIC_DOUBLE_ALIGN_LABEL: Readonly<Record<ComicDoubleAlign, string>> = {
  TOP: '顶部对齐',
  CENTER: '居中对齐',
  BOTTOM: '底部对齐',
};

/** Kotlin L272-273。 */
export type ComicCropMode = 'OFF' | 'WHITE' | 'BLACK' | 'AUTO';

/** Kotlin L274 声明顺序。 */
export const COMIC_CROP_MODE_VALUES: readonly ComicCropMode[] = ['OFF', 'WHITE', 'BLACK', 'AUTO'];

/** Kotlin `ComicCropMode.ordinal`。 */
export const COMIC_CROP_MODE_ORDINAL: Readonly<Record<ComicCropMode, number>> = {
  OFF: 0,
  WHITE: 1,
  BLACK: 2,
  AUTO: 3,
};

/** Kotlin L274 `val label`。 */
export const COMIC_CROP_MODE_LABEL: Readonly<Record<ComicCropMode, string>> = {
  OFF: '关闭',
  WHITE: '裁白边',
  BLACK: '裁黑边',
  AUTO: '自动识别',
};

/** Kotlin L281-287。 */
export type ComicEnhanceMode = 'OFF' | 'CAS' | 'ANIME4K' | 'WAIFU2X' | 'SUPER_RES';

/** Kotlin L282-287 声明顺序。 */
export const COMIC_ENHANCE_MODE_VALUES: readonly ComicEnhanceMode[] = [
  'OFF',
  'CAS',
  'ANIME4K',
  'WAIFU2X',
  'SUPER_RES',
];

/** Kotlin `ComicEnhanceMode.ordinal`。 */
export const COMIC_ENHANCE_MODE_ORDINAL: Readonly<Record<ComicEnhanceMode, number>> = {
  OFF: 0,
  CAS: 1,
  ANIME4K: 2,
  WAIFU2X: 3,
  SUPER_RES: 4,
};

/** Kotlin L282-287 `val label`。 */
export const COMIC_ENHANCE_MODE_LABEL: Readonly<Record<ComicEnhanceMode, string>> = {
  OFF: '关闭',
  CAS: '锐化增强',
  ANIME4K: 'Anime4K 轻量',
  WAIFU2X: '超分 完整',
  SUPER_RES: '超分辨率',
};

/**
 * Kotlin L277-280 的 KDoc：画质增强是真实像素级处理（非状态开关）。
 * 四档效果取向互异（第六轮第 5 条）：CAS = 同尺寸锐化（最快）；
 * ANIME4K = 同尺寸线条重建+降噪（深线清洁）；WAIFU2X = 低分辨率页 2× 神经网络超分 /
 * 高分辨率页细节强化（最慢，有耗时提示）；SUPER_RES = 低分辨率页 Lanczos 2× 重建+强锐化。
 * —— `val desc` 逐字搬运（L283-286）：
 * - CAS      对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）
 * - ANIME4K  Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）
 * - WAIFU2X  Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）
 * - SUPER_RES Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）
 * - OFF      ""（L282）
 */
export const COMIC_ENHANCE_MODE_DESC: Readonly<Record<ComicEnhanceMode, string>> = {
  OFF: '',
  CAS: '对比度自适应锐化，强化线条与小字（最快，约 0.5 秒/页）',
  ANIME4K: 'Anime4K Restore CNN 线条重建降噪，不放大（约 2-4 秒/页）',
  WAIFU2X: 'Anime4K Upscale CNN ×2 神经网络超分（低分辨率页收益最大；约 2-6 秒/页，处理时有预计耗时提示）',
  SUPER_RES: 'Lanczos 2× 重建 + 自适应锐化（低分辨率页翻倍清晰度）',
};

/** Kotlin L289-290。 */
export type ComicBgType = 'BLACK' | 'WHITE' | 'GRAY' | 'PAPER' | 'DYNAMIC';

/** Kotlin L291 声明顺序。 */
export const COMIC_BG_TYPE_VALUES: readonly ComicBgType[] = [
  'BLACK',
  'WHITE',
  'GRAY',
  'PAPER',
  'DYNAMIC',
];

/** Kotlin `ComicBgType.ordinal`。 */
export const COMIC_BG_TYPE_ORDINAL: Readonly<Record<ComicBgType, number>> = {
  BLACK: 0,
  WHITE: 1,
  GRAY: 2,
  PAPER: 3,
  DYNAMIC: 4,
};

/** Kotlin L291 `val label`。 */
export const COMIC_BG_TYPE_LABEL: Readonly<Record<ComicBgType, string>> = {
  BLACK: '纯黑',
  WHITE: '纯白',
  GRAY: '深灰',
  PAPER: '纸张纹理',
  DYNAMIC: '沉浸动态',
};

/** Kotlin L294-295。 */
export type ComicScene = 'NONE' | 'RAIN' | 'SNOW' | 'SAKURA' | 'FIREFLY' | 'OCEAN' | 'CAMPFIRE' | 'NIGHT';

/** Kotlin L296-298 声明顺序。 */
export const COMIC_SCENE_VALUES: readonly ComicScene[] = [
  'NONE',
  'RAIN',
  'SNOW',
  'SAKURA',
  'FIREFLY',
  'OCEAN',
  'CAMPFIRE',
  'NIGHT',
];

/** Kotlin `ComicScene.ordinal`。 */
export const COMIC_SCENE_ORDINAL: Readonly<Record<ComicScene, number>> = {
  NONE: 0,
  RAIN: 1,
  SNOW: 2,
  SAKURA: 3,
  FIREFLY: 4,
  OCEAN: 5,
  CAMPFIRE: 6,
  NIGHT: 7,
};

/** Kotlin L296-298 `val label`。 */
export const COMIC_SCENE_LABEL: Readonly<Record<ComicScene, string>> = {
  NONE: '关闭',
  RAIN: '雨夜',
  SNOW: '落雪',
  SAKURA: '樱花',
  FIREFLY: '萤火',
  OCEAN: '海边',
  CAMPFIRE: '篝火',
  NIGHT: '夏夜',
};

/** Kotlin L301-302。 */
export type ComicPageAnim = 'NONE' | 'SLIDE' | 'FADE' | 'CURL';

/** Kotlin L303 声明顺序。 */
export const COMIC_PAGE_ANIM_VALUES: readonly ComicPageAnim[] = ['NONE', 'SLIDE', 'FADE', 'CURL'];

/** Kotlin `ComicPageAnim.ordinal`。 */
export const COMIC_PAGE_ANIM_ORDINAL: Readonly<Record<ComicPageAnim, number>> = {
  NONE: 0,
  SLIDE: 1,
  FADE: 2,
  CURL: 3,
};

/** Kotlin L303 `val label`。 */
export const COMIC_PAGE_ANIM_LABEL: Readonly<Record<ComicPageAnim, string>> = {
  NONE: '无动画',
  SLIDE: '平移',
  FADE: '渐变',
  CURL: '仿真翻页',
};

/** Kotlin L306-307。 */
export type ComicGestureAction =
  | 'NONE'
  | 'PREV'
  | 'NEXT'
  | 'TOGGLE_CONTROLS'
  | 'TOC'
  | 'SETTINGS'
  | 'EXIT';

/** Kotlin L308-310 声明顺序。 */
export const COMIC_GESTURE_ACTION_VALUES: readonly ComicGestureAction[] = [
  'NONE',
  'PREV',
  'NEXT',
  'TOGGLE_CONTROLS',
  'TOC',
  'SETTINGS',
  'EXIT',
];

/** Kotlin `ComicGestureAction.ordinal`。 */
export const COMIC_GESTURE_ACTION_ORDINAL: Readonly<Record<ComicGestureAction, number>> = {
  NONE: 0,
  PREV: 1,
  NEXT: 2,
  TOGGLE_CONTROLS: 3,
  TOC: 4,
  SETTINGS: 5,
  EXIT: 6,
};

/** Kotlin L308-310 `val label`。 */
export const COMIC_GESTURE_ACTION_LABEL: Readonly<Record<ComicGestureAction, string>> = {
  NONE: '无操作',
  PREV: '上一页',
  NEXT: '下一页',
  TOGGLE_CONTROLS: '呼出/隐藏控制',
  TOC: '目录',
  SETTINGS: '设置',
  EXIT: '退出',
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L14-105 — `data class ComicReaderConfig`
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 漫画阅读器完整配置模型。
 *
 * 全部设置集中在一个 data class 中，序列化为 JSON 持久化：
 * - 全局默认配置（用户手动调整后保存）
 * - 预设（整套配置的快照，可创建/编辑/复制/删除/设为默认）
 * - 每本漫画独立覆盖（重新打开时自动恢复）
 */
export interface ComicReaderConfig {
  /* ── 阅读模式 ── */
  readonly mode: ComicMode;
  readonly direction: ComicDirection;
  /** 条漫模式磁吸到页边界（第 6/7 条：可关闭；无缝滚动恒无磁吸） */
  readonly webtoonSnap: boolean;

  /* ── 页面显示 ── */
  readonly fit: ComicFit;
  /** 自定义缩放档（第 26 条）：基础适配方式 */
  readonly customFitBase: ComicFit;
  /** 自定义缩放档：在基础适配上的附加缩放（0.5..2.5） */
  readonly customFitScale: number;
  readonly pageSpacingDp: number; // 连续页面间距（滚动/条漫模式）
  readonly doubleGapDp: number; // 双页左右间距
  readonly doubleFirstAlone: boolean; // 双页模式首页单独显示（封面页）
  readonly doubleAlign: ComicDoubleAlign;
  readonly doubleShiftXDp: number; // 双页位置修正（扫描错位）
  readonly doubleShiftYDp: number;

  /* ── 缩放 ── */
  readonly doubleTapZoom: boolean; // 双击放大（可关闭）
  readonly longPressZoom: boolean; // 长按放大
  readonly zoomWhileTurn: boolean; // 放大状态允许翻页

  /* ── 旋转 ── */
  readonly bookRotation: number; // 整本旋转 0/90/180/270

  /* ── 裁边 ── */
  readonly cropMode: ComicCropMode;
  readonly manualCrop: readonly number[] | null; // 手动裁边 [left,top,right,bottom] 归一化，null=未设置

  /* ── 大图拆分 ── */
  readonly splitWide: boolean; // 自动拆分宽页（跨页扫描）
  readonly splitReverse: boolean; // 拆分后左右顺序反转
  readonly splitPosition: number; // 手动拆分位置（0.3~0.7），0.5=居中

  /* ── 画质增强 ── */
  readonly enhanceMode: ComicEnhanceMode;
  readonly enhanceStrength: number; // 0..100

  /* ── 滤镜 ── */
  readonly filterBrightness: number; // -100..100
  readonly filterContrast: number; // -100..100
  readonly filterSaturation: number; // -100..100
  readonly filterHue: number; // -180..180
  readonly filterGamma: number; // 0.5..2.2
  readonly filterSharpen: number; // 0..100 锐化强度
  readonly filterShadow: number; // -100..100 阴影提亮/压暗
  readonly filterBW: boolean; // 黑白

  /* ── 阅读背景 ── */
  readonly bgType: ComicBgType;
  readonly paperIntensity: number; // 纸张纹理强度 0..100

  /* ── 场景 ── */
  readonly scene: ComicScene;
  readonly sceneSound: boolean; // 场景声音独立开关
  readonly sceneEffect: boolean; // 场景特效独立开关
  readonly sceneVolume: number; // 0..100

  /* ── 翻页动画 ── */
  readonly pageAnim: ComicPageAnim;

  /* ── 自动阅读 ── */
  readonly autoPageIntervalSec: number; // 自动翻页间隔
  readonly autoScrollSpeedDp: number; // 条漫自动滚动速度 dp/s

  /* ── 手势 ── */
  readonly gestureTapLeft: ComicGestureAction;
  readonly gestureTapRight: ComicGestureAction;
  readonly gestureTapCenter: ComicGestureAction;
  readonly gestureSwipe: boolean; // 单指滑动翻页
  readonly gesturePinchClose: boolean; // 双指合拢退出
  readonly gestureEdgeSwipe: boolean; // 侧边滑动快速关闭
  readonly gestureLongPressPanel: boolean; // 长按呼出控制层（与长按放大冲突时放大优先）
  /** 音量键翻页（第 28 条）：仅漫画阅读页拦截；随阅读方向反转上下键语义 */
  readonly volumeKeyTurn: boolean;

  /* ── 其它 ── */
  readonly showThumbPreview: boolean; // 进度条拖动缩略图
  readonly hideSystemBars: boolean; // 沉浸式

  /* ── 漫画翻译（第十五轮）：OCR 全离线；译文缓存按页持久化 ── */
  readonly translationEnabled: boolean;
  /** 源语言：auto=按文字系统自动判定 / ja / en / ko */
  readonly translationLang: string;
  /** 译文字号缩放（0.8..1.4） */
  readonly translationTextScale: number;
  /** 翻译引擎（第十八轮二级导航显式选择）：ai=自定义接口 / online=在线翻译 */
  readonly translationEngine: string;
}

/** Kotlin L16-104 的默认参数值，逐字段照抄（= `ComicReaderConfig()`）。 */
export const DEFAULT_COMIC_READER_CONFIG: ComicReaderConfig = {
  // L16 mode = ComicMode.SINGLE
  mode: 'SINGLE',
  // L17 direction = ComicDirection.RTL
  direction: 'RTL',
  // L19 webtoonSnap = true
  webtoonSnap: true,
  // L22 fit = ComicFit.FIT_WIDTH
  fit: 'FIT_WIDTH',
  // L24 customFitBase = ComicFit.FIT_PAGE
  customFitBase: 'FIT_PAGE',
  // L26 customFitScale = 1.0f
  customFitScale: 1.0,
  // L27 pageSpacingDp = 8f
  pageSpacingDp: 8,
  // L28 doubleGapDp = 8f
  doubleGapDp: 8,
  // L29 doubleFirstAlone = false
  doubleFirstAlone: false,
  // L30 doubleAlign = ComicDoubleAlign.CENTER
  doubleAlign: 'CENTER',
  // L31 doubleShiftXDp = 0f
  doubleShiftXDp: 0,
  // L32 doubleShiftYDp = 0f
  doubleShiftYDp: 0,
  // L35 doubleTapZoom = true
  doubleTapZoom: true,
  // L36 longPressZoom = true
  longPressZoom: true,
  // L37 zoomWhileTurn = false
  zoomWhileTurn: false,
  // L40 bookRotation = 0
  bookRotation: 0,
  // L43 cropMode = ComicCropMode.OFF
  cropMode: 'OFF',
  // L44 manualCrop = null
  manualCrop: null,
  // L47 splitWide = false
  splitWide: false,
  // L48 splitReverse = false
  splitReverse: false,
  // L49 splitPosition = 0.5f
  splitPosition: 0.5,
  // L52 enhanceMode = ComicEnhanceMode.OFF
  enhanceMode: 'OFF',
  // L53 enhanceStrength = 60
  enhanceStrength: 60,
  // L56 filterBrightness = 0
  filterBrightness: 0,
  // L57 filterContrast = 0
  filterContrast: 0,
  // L58 filterSaturation = 0
  filterSaturation: 0,
  // L59 filterHue = 0
  filterHue: 0,
  // L60 filterGamma = 1.0f
  filterGamma: 1.0,
  // L61 filterSharpen = 0
  filterSharpen: 0,
  // L62 filterShadow = 0
  filterShadow: 0,
  // L63 filterBW = false
  filterBW: false,
  // L66 bgType = ComicBgType.BLACK
  bgType: 'BLACK',
  // L67 paperIntensity = 35
  paperIntensity: 35,
  // L70 scene = ComicScene.NONE
  scene: 'NONE',
  // L71 sceneSound = true
  sceneSound: true,
  // L72 sceneEffect = true
  sceneEffect: true,
  // L73 sceneVolume = 40
  sceneVolume: 40,
  // L76 pageAnim = ComicPageAnim.SLIDE
  pageAnim: 'SLIDE',
  // L79 autoPageIntervalSec = 6f
  autoPageIntervalSec: 6,
  // L80 autoScrollSpeedDp = 40f
  autoScrollSpeedDp: 40,
  // L83 gestureTapLeft = ComicGestureAction.PREV
  gestureTapLeft: 'PREV',
  // L84 gestureTapRight = ComicGestureAction.NEXT
  gestureTapRight: 'NEXT',
  // L85 gestureTapCenter = ComicGestureAction.TOGGLE_CONTROLS
  gestureTapCenter: 'TOGGLE_CONTROLS',
  // L86 gestureSwipe = true
  gestureSwipe: true,
  // L87 gesturePinchClose = true
  gesturePinchClose: true,
  // L88 gestureEdgeSwipe = true
  gestureEdgeSwipe: true,
  // L89 gestureLongPressPanel = false
  gestureLongPressPanel: false,
  // L91 volumeKeyTurn = true
  volumeKeyTurn: true,
  // L94 showThumbPreview = true
  showThumbPreview: true,
  // L95 hideSystemBars = true
  hideSystemBars: true,
  // L98 translationEnabled = false
  translationEnabled: false,
  // L100 translationLang = "auto"
  translationLang: 'auto',
  // L102 translationTextScale = 1.0f
  translationTextScale: 1.0,
  // L104 translationEngine = "online"
  translationEngine: 'online',
};

/**
 * Kotlin L14-105 的具名参数构造：`ComicReaderConfig(mode = …, direction = …)`。
 * 供内置预设（`ComicSettingsStore.kt` L36-65）与设置面板构造局部配置。
 * 未给出的字段一律取 `DEFAULT_COMIC_READER_CONFIG` 的值 —— 与 Kotlin 的默认参数
 * 语义完全一致。
 */
export function createComicReaderConfig(patch: Partial<ComicReaderConfig> = {}): ComicReaderConfig {
  return { ...DEFAULT_COMIC_READER_CONFIG, ...patch };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L106-161 — `fun toJson(): JSONObject`
 * ═══════════════════════════════════════════════════════════════════════════ */

export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * Kotlin L106-161 `fun toJson(): JSONObject`。键名与**键序**逐条照抄
 * （L124 `manualCrop?.let { put("manualCrop", JSONArray(it)) }` —— 为 null 时
 * 该键**不出现**在 JSON 里）。
 */
export function comicReaderConfigToJson(config: ComicReaderConfig): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  json['mode'] = config.mode; // L107 put("mode", mode.name)
  json['direction'] = config.direction; // L108
  json['webtoonSnap'] = config.webtoonSnap; // L109
  json['fit'] = config.fit; // L110
  json['customFitBase'] = config.customFitBase; // L111
  json['customFitScale'] = config.customFitScale; // L112
  json['pageSpacingDp'] = config.pageSpacingDp; // L113
  json['doubleGapDp'] = config.doubleGapDp; // L114
  json['doubleFirstAlone'] = config.doubleFirstAlone; // L115
  json['doubleAlign'] = config.doubleAlign; // L116
  json['doubleShiftXDp'] = config.doubleShiftXDp; // L117
  json['doubleShiftYDp'] = config.doubleShiftYDp; // L118
  json['doubleTapZoom'] = config.doubleTapZoom; // L119
  json['longPressZoom'] = config.longPressZoom; // L120
  json['zoomWhileTurn'] = config.zoomWhileTurn; // L121
  json['bookRotation'] = config.bookRotation; // L122
  json['cropMode'] = config.cropMode; // L123
  if (config.manualCrop !== null) {
    // L124 manualCrop?.let { put("manualCrop", JSONArray(it)) }
    json['manualCrop'] = [...config.manualCrop];
  }
  json['splitWide'] = config.splitWide; // L125
  json['splitReverse'] = config.splitReverse; // L126
  json['splitPosition'] = config.splitPosition; // L127
  json['enhanceMode'] = config.enhanceMode; // L128
  json['enhanceStrength'] = config.enhanceStrength; // L129
  json['filterBrightness'] = config.filterBrightness; // L130
  json['filterContrast'] = config.filterContrast; // L131
  json['filterSaturation'] = config.filterSaturation; // L132
  json['filterHue'] = config.filterHue; // L133
  json['filterGamma'] = config.filterGamma; // L134
  json['filterSharpen'] = config.filterSharpen; // L135
  json['filterShadow'] = config.filterShadow; // L136
  json['filterBW'] = config.filterBW; // L137
  json['bgType'] = config.bgType; // L138
  json['paperIntensity'] = config.paperIntensity; // L139
  json['scene'] = config.scene; // L140
  json['sceneSound'] = config.sceneSound; // L141
  json['sceneEffect'] = config.sceneEffect; // L142
  json['sceneVolume'] = config.sceneVolume; // L143
  json['pageAnim'] = config.pageAnim; // L144
  json['autoPageIntervalSec'] = config.autoPageIntervalSec; // L145
  json['autoScrollSpeedDp'] = config.autoScrollSpeedDp; // L146
  json['gestureTapLeft'] = config.gestureTapLeft; // L147
  json['gestureTapRight'] = config.gestureTapRight; // L148
  json['gestureTapCenter'] = config.gestureTapCenter; // L149
  json['gestureSwipe'] = config.gestureSwipe; // L150
  json['gesturePinchClose'] = config.gesturePinchClose; // L151
  json['gestureEdgeSwipe'] = config.gestureEdgeSwipe; // L152
  json['gestureLongPressPanel'] = config.gestureLongPressPanel; // L153
  json['volumeKeyTurn'] = config.volumeKeyTurn; // L154
  json['showThumbPreview'] = config.showThumbPreview; // L155
  json['hideSystemBars'] = config.hideSystemBars; // L156
  json['translationEnabled'] = config.translationEnabled; // L157
  json['translationLang'] = config.translationLang; // L158
  json['translationTextScale'] = config.translationTextScale; // L159
  json['translationEngine'] = config.translationEngine; // L160
  return json;
}

/** `comicReaderConfigToJson` 的字符串形态（Kotlin `config.toJson().toString()`）。 */
export function comicReaderConfigToJsonString(config: ComicReaderConfig): string {
  return JSON.stringify(comicReaderConfigToJson(config));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L163-170 — `fun imagePipelineFingerprint(): String`
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 滤镜/增强/裁边相关的指纹，用于位图处理缓存键。
 *
 * Kotlin L164-170：
 * ```
 * listOf(
 *   cropMode.name, manualCrop?.joinToString(","), bookRotation,
 *   splitWide, splitPosition,
 *   enhanceMode.name, enhanceStrength,
 *   filterBrightness, filterContrast, filterSaturation, filterHue,
 *   String.format(Locale.ROOT, "%.3f", filterGamma), filterSharpen, filterShadow, filterBW
 * ).joinToString("|")
 * ```
 * `List<Any?>.joinToString` 把 `null` 元素渲染成字面量 `"null"`，故
 * `manualCrop == null` 时第 2 段是 `"null"` 而不是空串（见文件头的分歧登记）。
 */
export function imagePipelineFingerprint(config: ComicReaderConfig): string {
  const parts: Array<string> = [
    config.cropMode,
    config.manualCrop === null ? 'null' : config.manualCrop.join(','),
    String(config.bookRotation),
    String(config.splitWide),
    String(config.splitPosition),
    config.enhanceMode,
    String(config.enhanceStrength),
    String(config.filterBrightness),
    String(config.filterContrast),
    String(config.filterSaturation),
    String(config.filterHue),
    // L169 `String.format(java.util.Locale.ROOT, "%.3f", filterGamma)`
    config.filterGamma.toFixed(3),
    String(config.filterSharpen),
    String(config.filterShadow),
    String(config.filterBW),
  ];
  return parts.join('|');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L172-239 — `companion object { fun fromJson(json: JSONObject) }`
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L174-175 的 `safe()`。 */
function enumFromJson<E extends string>(json: JsonObject, name: string, fallback: E, values: readonly E[]): E {
  const raw = optString(json, name, fallback);
  return values.find((candidate) => candidate === raw) ?? fallback;
}

/**
 * Kotlin L183-236 `optInt(...).coerceIn(min, max)`。
 *
 * Kotlin 的 `coerceIn` 定义是 `if (this < min) min else if (this > max) max else this`
 * —— NaN 两个比较都为 false，因此 **NaN 原样穿过**。这里照搬该形状，
 * 不用 `Math.min/Math.max`（后者会把 NaN 变成 NaN→被 clamp 成 min/max 之一）。
 */
export function coerceIn(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Kotlin L195-198 的 `manualCrop` 解码（含 `runCatching` 的三处 null 出口）。 */
function manualCropFromJson(json: JsonObject): number[] | null {
  const arr = optJSONArray(json, 'manualCrop'); // L196 ?: return@runCatching null
  if (arr === null) return null;
  if (arr.length !== 4) return null; // L197 `if (arr.length() == 4) … else null`
  const out: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    // L197 `FloatArray(4) { arr.getDouble(it).toFloat() }`
    //     `JSONArray.getDouble` 对无法转 double 的元素抛 JSONException
    //     → 被外层 runCatching 吞掉 → 整体为 null。
    const value = jsonArrayGetDouble(arr, i);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/** Kotlin L183-238。逐行照抄，含全部 `coerceIn` 与两处 `takeIf`。 */
export function comicReaderConfigFromJson(json: JsonObject): ComicReaderConfig {
  return {
    // L178 mode = safe("mode", ComicMode.SINGLE, ComicMode.entries.toTypedArray())
    mode: enumFromJson(json, 'mode', 'SINGLE', COMIC_MODE_VALUES),
    // L179
    direction: enumFromJson(json, 'direction', 'RTL', COMIC_DIRECTION_VALUES),
    // L180
    webtoonSnap: optBoolean(json, 'webtoonSnap', true),
    // L181
    fit: enumFromJson(json, 'fit', 'FIT_WIDTH', COMIC_FIT_VALUES),
    // L182
    customFitBase: enumFromJson(json, 'customFitBase', 'FIT_PAGE', COMIC_FIT_VALUES),
    // L183 coerceIn(0.5f, 2.5f)
    customFitScale: coerceIn(optDouble(json, 'customFitScale', 1.0), 0.5, 2.5),
    // L184（无钳位）
    pageSpacingDp: optDouble(json, 'pageSpacingDp', 8.0),
    // L185（无钳位）
    doubleGapDp: optDouble(json, 'doubleGapDp', 8.0),
    // L186
    doubleFirstAlone: optBoolean(json, 'doubleFirstAlone', false),
    // L187
    doubleAlign: enumFromJson(json, 'doubleAlign', 'CENTER', COMIC_DOUBLE_ALIGN_VALUES),
    // L188-189（无钳位）
    doubleShiftXDp: optDouble(json, 'doubleShiftXDp', 0.0),
    doubleShiftYDp: optDouble(json, 'doubleShiftYDp', 0.0),
    // L190-192
    doubleTapZoom: optBoolean(json, 'doubleTapZoom', true),
    longPressZoom: optBoolean(json, 'longPressZoom', true),
    zoomWhileTurn: optBoolean(json, 'zoomWhileTurn', false),
    // L193（无钳位）
    bookRotation: optInt(json, 'bookRotation', 0),
    // L194
    cropMode: enumFromJson(json, 'cropMode', 'OFF', COMIC_CROP_MODE_VALUES),
    // L195-198
    manualCrop: manualCropFromJson(json),
    // L199-200
    splitWide: optBoolean(json, 'splitWide', false),
    splitReverse: optBoolean(json, 'splitReverse', false),
    // L201 coerceIn(0.3f, 0.7f)
    splitPosition: coerceIn(optDouble(json, 'splitPosition', 0.5), 0.3, 0.7),
    // L202
    enhanceMode: enumFromJson(json, 'enhanceMode', 'OFF', COMIC_ENHANCE_MODE_VALUES),
    // L203 coerceIn(0, 100)
    enhanceStrength: coerceIn(optInt(json, 'enhanceStrength', 60), 0, 100),
    // L204-206 coerceIn(-100, 100)
    filterBrightness: coerceIn(optInt(json, 'filterBrightness', 0), -100, 100),
    filterContrast: coerceIn(optInt(json, 'filterContrast', 0), -100, 100),
    filterSaturation: coerceIn(optInt(json, 'filterSaturation', 0), -100, 100),
    // L207 coerceIn(-180, 180)
    filterHue: coerceIn(optInt(json, 'filterHue', 0), -180, 180),
    // L208 coerceIn(0.5f, 2.2f)
    filterGamma: coerceIn(optDouble(json, 'filterGamma', 1.0), 0.5, 2.2),
    // L209 coerceIn(0, 100)
    filterSharpen: coerceIn(optInt(json, 'filterSharpen', 0), 0, 100),
    // L210 coerceIn(-100, 100)
    filterShadow: coerceIn(optInt(json, 'filterShadow', 0), -100, 100),
    // L211
    filterBW: optBoolean(json, 'filterBW', false),
    // L212
    bgType: enumFromJson(json, 'bgType', 'BLACK', COMIC_BG_TYPE_VALUES),
    // L213 coerceIn(0, 100)
    paperIntensity: coerceIn(optInt(json, 'paperIntensity', 35), 0, 100),
    // L214
    scene: enumFromJson(json, 'scene', 'NONE', COMIC_SCENE_VALUES),
    // L215-217
    sceneSound: optBoolean(json, 'sceneSound', true),
    sceneEffect: optBoolean(json, 'sceneEffect', true),
    sceneVolume: coerceIn(optInt(json, 'sceneVolume', 40), 0, 100),
    // L218
    pageAnim: enumFromJson(json, 'pageAnim', 'SLIDE', COMIC_PAGE_ANIM_VALUES),
    // L219 coerceIn(1f, 120f)
    autoPageIntervalSec: coerceIn(optDouble(json, 'autoPageIntervalSec', 6.0), 1, 120),
    // L220 coerceIn(5f, 400f)
    autoScrollSpeedDp: coerceIn(optDouble(json, 'autoScrollSpeedDp', 40.0), 5, 400),
    // L221-223
    gestureTapLeft: enumFromJson(json, 'gestureTapLeft', 'PREV', COMIC_GESTURE_ACTION_VALUES),
    gestureTapRight: enumFromJson(json, 'gestureTapRight', 'NEXT', COMIC_GESTURE_ACTION_VALUES),
    gestureTapCenter: enumFromJson(
      json,
      'gestureTapCenter',
      'TOGGLE_CONTROLS',
      COMIC_GESTURE_ACTION_VALUES,
    ),
    // L224-228
    gestureSwipe: optBoolean(json, 'gestureSwipe', true),
    gesturePinchClose: optBoolean(json, 'gesturePinchClose', true),
    gestureEdgeSwipe: optBoolean(json, 'gestureEdgeSwipe', true),
    gestureLongPressPanel: optBoolean(json, 'gestureLongPressPanel', false),
    // L228 volumeKeyTurn
    volumeKeyTurn: optBoolean(json, 'volumeKeyTurn', true),
    // L229-230
    showThumbPreview: optBoolean(json, 'showThumbPreview', true),
    hideSystemBars: optBoolean(json, 'hideSystemBars', true),
    // L231
    translationEnabled: optBoolean(json, 'translationEnabled', false),
    // L232-233 `takeIf { it in setOf("auto","ja","en","ko") } ?: "auto"`
    translationLang: takeIfIn(
      optString(json, 'translationLang', 'auto'),
      TRANSLATION_LANGS,
      'auto',
    ),
    // L234 coerceIn(0.8f, 1.4f)
    translationTextScale: coerceIn(optDouble(json, 'translationTextScale', 1.0), 0.8, 1.4),
    // L235-236 `takeIf { it in setOf("ai","online") } ?: "online"`
    translationEngine: takeIfIn(optString(json, 'translationEngine', 'online'), TRANSLATION_ENGINES, 'online'),
  };
}

/** Kotlin L233 `setOf("auto", "ja", "en", "ko")`。 */
export const TRANSLATION_LANGS: readonly string[] = ['auto', 'ja', 'en', 'ko'];

/** Kotlin L236 `setOf("ai", "online")`。 */
export const TRANSLATION_ENGINES: readonly string[] = ['ai', 'online'];

/** Kotlin `String?.takeIf { it in allowed } ?: fallback`。 */
export function takeIfIn<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L313-352 — `data class ComicBookState`
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 每本漫画的阅读状态（独立于配置）：上次读到哪页、单页旋转、临时合页锚点。
 */
export interface ComicBookState {
  readonly lastPage: number;
  /** lastPage 所属章节的首页 id（换章时不恢复旧页码） */
  readonly lastChapterSig: string | null;
  /** 页 id → 旋转角度（0/90/180/270），仅作用于该页 */
  readonly pageRotations: Readonly<Record<string, number>>;
  /** 临时合页：以该页为左页与下一页组成跨页（显示层行为） */
  readonly mergeAnchors: ReadonlySet<number>;
}

/** Kotlin L317-321 的默认参数值（= `ComicBookState()`）。 */
export const EMPTY_COMIC_BOOK_STATE: ComicBookState = {
  lastPage: 0,
  lastChapterSig: null,
  pageRotations: {},
  mergeAnchors: new Set<number>(),
};

/** Kotlin L325-332。`lastChapterSig` 为 null 时该键不出现（L327 的 `?.let`）。 */
export function comicBookStateToJson(state: ComicBookState): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  json['lastPage'] = state.lastPage; // L326
  if (state.lastChapterSig !== null) {
    json['lastChapterSig'] = state.lastChapterSig; // L327
  }
  json['pageRotations'] = { ...state.pageRotations }; // L328-330
  json['mergeAnchors'] = [...state.mergeAnchors]; // L331 `JSONArray(mergeAnchors)`
  return json;
}

/** `comicBookStateToJson` 的字符串形态。 */
export function comicBookStateToJsonString(state: ComicBookState): string {
  return JSON.stringify(comicBookStateToJson(state));
}

/** Kotlin L334-351。 */
export function comicBookStateFromJson(json: JsonObject): ComicBookState {
  // L336-339 runCatching { … }.getOrDefault(emptyMap())
  let pageRotations: Record<string, number> = {};
  const rotObj = optJSONObject(json, 'pageRotations'); // L337 `?: JSONObject()`
  if (rotObj !== null) {
    const decoded: Record<string, number> = {};
    // L338 `o.keys().asSequence().associateWith { o.optInt(it) }`
    //     注意 `optInt(it)` **无默认值** → 非数字/缺失一律 0（不抛异常）。
    for (const key of Object.keys(rotObj)) {
      decoded[key] = optInt(rotObj, key, 0);
    }
    pageRotations = decoded;
  }

  // L340-343 runCatching { … }.getOrDefault(emptySet())
  let mergeAnchors = new Set<number>();
  const arr = optJSONArray(json, 'mergeAnchors'); // L341 `?: JSONArray()`
  if (arr !== null) {
    const collected: number[] = [];
    let ok = true;
    for (let i = 0; i < arr.length; i += 1) {
      // L342 `arr.getInt(it)`：无法转 int 会抛 JSONException
      //     → 被 runCatching 吞掉 → 整个集合退化为空集（不是「跳过该元素」）。
      const value = jsonArrayGetInt(arr, i);
      if (value === null) {
        ok = false;
        break;
      }
      collected.push(value);
    }
    mergeAnchors = ok ? new Set(collected) : new Set<number>();
  }

  // L346 `json.optString("lastChapterSig").ifBlank { null }`
  //     无默认值 → 缺失得 "" → ifBlank → null；空白串同样归 null。
  const sig = optStringOrEmpty(json, 'lastChapterSig');
  return {
    // L345
    lastPage: optInt(json, 'lastPage', 0),
    lastChapterSig: sig.trim() === '' ? null : sig,
    pageRotations,
    mergeAnchors,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin 3-4 — `org.json.JSONObject` / `org.json.JSONArray` 语义
 *
 * Android 的 `JSONObject.opt*(name, fallback)` 语义（不是 JS 的直译）：
 *  - 键缺失或值为 `JSONObject.NULL` → 返回 fallback；
 *  - `optBoolean` **只接受真正的 boolean**（字符串 "true" 会回退到 fallback）；
 *  - `optString` 对非字符串走 `String.valueOf`（数字→"5"，布尔→"true"）；
 *  - `optInt` 接受 Number（向零截断 + int32 饱和）或可解析的字符串；
 *  - `optDouble` 接受 Number 或可解析的字符串。
 * 下面逐条实现，配置解码与仓库解码共用。
 * ═══════════════════════════════════════════════════════════════════════════ */

export type JsonArray = readonly unknown[];

/** `JSONObject.opt(name)`：缺失或 JSON null → null。 */
function jsonOpt(json: JsonObject, name: string): unknown {
  const value = json[name];
  return value === undefined ? null : value;
}

/** `JSONObject.optJSONArray(name)`：非数组 → null。 */
export function optJSONArray(json: JsonObject, name: string): JsonArray | null {
  const value = jsonOpt(json, name);
  return Array.isArray(value) ? (value as JsonArray) : null;
}

/** `JSONObject.optJSONObject(name)`：非对象 → null。 */
export function optJSONObject(json: JsonObject, name: string): JsonObject | null {
  const value = jsonOpt(json, name);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** Android `JSON.toString(Object)` 的等价：非字符串走 `String.valueOf`。 */
function jsonToStringValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (value === null || value === undefined) return null;
  // JSONObject/JSONArray 的 toString() 是其 JSON 文本。
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** `JSONObject.optString(name, fallback)`。 */
export function optString(json: JsonObject, name: string, fallback: string): string {
  return jsonToStringValue(jsonOpt(json, name)) ?? fallback;
}

/** `JSONObject.optString(name)`（无默认值时缺失得 `""`）。 */
export function optStringOrEmpty(json: JsonObject, name: string): string {
  return optString(json, name, '');
}

/** `JSONObject.optBoolean(name, fallback)` —— 只认真 boolean。 */
export function optBoolean(json: JsonObject, name: string, fallback: boolean): boolean {
  const value = jsonOpt(json, name);
  return typeof value === 'boolean' ? value : fallback;
}

/** Android `JSON.toInteger(Object)`。失败返回 null。 */
function jsonToInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // `Number.intValue()`：向零截断 + int32 饱和
    const truncated = Math.trunc(value);
    if (truncated > 2147483647) return 2147483647;
    if (truncated < -2147483648) return -2147483648;
    return truncated;
  }
  if (typeof value === 'string') {
    const asInt = Number.parseInt(value, 10);
    if (Number.isFinite(asInt) && /^[+-]?\d+$/.test(value.trim())) return asInt;
    const asDouble = Number.parseFloat(value);
    if (!Number.isNaN(asDouble) && Number.isFinite(asDouble)) return Math.trunc(asDouble);
  }
  return null;
}

/** `JSONObject.optInt(name, fallback)`。 */
export function optInt(json: JsonObject, name: string, fallback: number): number {
  return jsonToInteger(jsonOpt(json, name)) ?? fallback;
}

/** Android `JSON.toDouble(Object)`。失败返回 null。 */
function jsonToDouble(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `JSONObject.optDouble(name, fallback)`。 */
export function optDouble(json: JsonObject, name: string, fallback: number): number {
  return jsonToDouble(jsonOpt(json, name)) ?? fallback;
}

/** `JSONArray.getDouble(index)`；元素缺失 / 无法转 double 时返回 null（等价抛异常）。 */
export function jsonArrayGetDouble(array: JsonArray, index: number): number | null {
  const value = index < array.length ? (array[index] ?? null) : null;
  return jsonToDouble(value);
}

/** `JSONArray.getInt(index)`；元素缺失 / 无法转 int 时返回 null（等价抛异常）。 */
export function jsonArrayGetInt(array: JsonArray, index: number): number | null {
  const value = index < array.length ? (array[index] ?? null) : null;
  return jsonToInteger(value);
}

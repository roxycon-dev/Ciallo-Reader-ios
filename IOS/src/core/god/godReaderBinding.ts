/**
 * Port of Android `god/GodReaderBinding.kt` (line by line) + `god/GodStarRating.kt`
 * 的**可交互半边**与 `god/GodMomentSheet.kt` 的表单判定 —— **纯逻辑部分**。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/`）：
 *
 * `GodReaderBinding.kt`（163 行 / 147 非空）：
 *   - 21-48   `class GodMomentBinding`（`onOpenCurrent` / `request` / `enabled` /
 *              `openEdit`）→ `GodReaderBinding` + `createGodReaderBinding()` /
 *              `godBindingEnabled()` / `godBindingOpenEdit()`
 *   - 45      `(existing.source as? CoverSource.ComicPage)?.pageIndex ?: 0` → `godBindingOpenEdit`
 *   - 56-84   `rememberGodMomentBinding(ctx, pages, currentPage)` → `godBindingBuildRequest()`
 *   - 64      `if (ctx != null)` 的 null 门 → `godBindingBuildRequest` 返回 `null`
 *   - 70      `latestPage().coerceIn(0, (latestPages.size - 1).coerceAtLeast(0))`
 *              → `godBindingClampPageIndex()`
 *   - 96-97   `val request = binding.request ?: return` / `val context = ctx ?: return`
 *              → `null` 即"不渲染"
 *   - 100-106 `remember(request.bookId, request.chapterId)` + `LaunchedEffect` + 加载门
 *              → `godBindingLoadKey()`（门控 key 的纯计算）
 *   - 110     `BackHandler { binding.request = null }` → 宿主用 `null` 关闭（同构）
 *   - 112-122 `GodMomentSheet(...)` 调用 → 组件 `GodMomentSheet.tsx`
 *   - 125-127 `godContextWithLoader(ctx, loader)` → `godContextWithLoader()`
 *   - 132-135 `rememberGodEditBinding()` → `createGodReaderBinding()`
 *   - 141-183 `GodMomentEditHost(...)`（含 167-170 远程 loader 按需构建）→
 *              `godBindingNeedsRemoteLoader()` + 宿主 `useEffect`
 *   - 3-12    Compose 依赖 import → 见"适配"节
 *
 * `GodStarRating.kt` 的可交互半边（313 行 / 297 非空）：
 *   - 52-54   `GOD_RATING_MIN/MAX/STEP` → 复用 `@core/god/godTypes` 同名常量（已端口）
 *   - 56-58   `Float.coerceRating()` → `clampGodRating()`（已端口于 godTypes.ts L91-95）
 *   - 85      `var lastHaptic by remember { mutableFloatStateOf(rating) }`
 *              → `godRatingShouldHaptic(next, last)`（跳过 Web 触觉，仅保留判定）
 *   - 87-94   `sparkKey` 自增（评分变化才 +）→ `nextGodSparkKey(sparkKey, rating, lastRating)`
 *   - 96-104  `fun commit(raw)`：`coerceRating` → 相等则 return → 触觉 → `onRatingChange`
 *              → `godRatingCommit(rating, raw, lastHaptic)` 返回 `{ value, changed, haptic }`
 *   - 111-120 `detectTapGestures { offset -> commit((offset.x / w) * 5f).coerceIn(MIN, MAX) }`
 *              → `godRatingFromX(x, width)`
 *   - 121-134 `detectHorizontalDragGestures { commit((position.x / w) * 5f).coerceIn(MIN,MAX) }`
 *              → `godRatingFromX(x, width)`（同一换算，抽成一个函数）
 *   - 113/122 `if (!enabled) return@pointerInput` → `godRatingIsInteractive(enabled)`
 *   - 138     `val filled = (rating - (i - 1)).coerceIn(0f, 1f)` → `godStarFill(rating, index1)`
 *   - 185     `val target = if (filled > 0f) 1f else 0.82f` → `godStarScaleTarget(filled)`
 *   - 196-233 `GodStar`（Canvas：底轨 / 微光 / clipRect 半星 / 描边）→ SVG，见组件
 *   - 236-268 `GodSparks`（6 粒金屑 520ms）→ `godSparkParticles(progress)`（纯计算）
 *   - 175-239 单颗星的绘制与金屑在组件层；此处只导出可测的数学
 *   - 286-319 `GodStarsReadonly` → **已端口**于 `GodRankingShared.tsx` L200-272，本文件不重复
 *
 * `GodMomentSheet.kt` 的表单判定（本文件只取纯逻辑，组件部分见 `GodMomentSheet.tsx`）：
 *   - 221-223 `TITLE_MAX` / `NOTE_MAX` / `SHEET_HEIGHT_FRACTION` → 复用 godTypes + 本文件常量
 *   - 252-256 `coverSourceTag` 初值 = `existing?.source ?: ComicPage(initialPageIndex)`
 *              → `godSheetInitialCoverTag()`
 *   - 265-267 `rating` 初值 = `(existing?.rating ?: 5f).coerceIn(MIN, MAX)` → `godSheetInitialRating()`
 *   - 268-272 `titleCustom` / `titleText` 初值 → `godSheetInitialTitleState()`
 *   - 274-275 `defaultTitle` / `shownTitle` → `godSheetDefaultTitle()` / `godSheetShownTitle()`
 *   - 337-346 `val dirty = remember(...)` 全量未保存判定 → `godSheetIsDirty()`
 *   - 278     `coverRetry` 以 `coverSourceTag` 为 key → `godSheetCoverLoadKey()`
 *   - 484     `if (coverSource == ComicPage(idx) && !loadingCover && sourceBitmap == null) coverRetry++`
 *              → `godSheetShouldRetryCover()`
 *   - 483-487 `onPickPage` 整体 → `godSheetPickPage()`
 *
 * `GodPull.kt` 的提示胶囊门控（GodPull.kt L293-320 `GodHintCapsule`）：
 *   - 295     `text: String = "继续滑动 · 标记神回"` → `GOD_HINT_CAPSULE_TEXT`
 *   - 300-305 `animateFloatAsState` + `if (alpha <= 0.01f) return` → `godHintCapsuleShouldRender()`
 *
 * 适配与跳过（原因）：
 *   - `@Composable` / `LaunchedEffect` / `remember` / `viewModel()` / `BackHandler`
 *     → 本文件是纯函数；组合部分在 `GodMomentSheet.tsx`（`useEffect` / `useState`）。
 *   - `viewModel()`（L98, L148）→ 直接用 `@core/god/godMoments` 的进程内 store +
 *     `GodMomentRepository`（已端口），无需 ViewModel 层。
 *   - `coil.ImageLoader`（L169 `com.example.ui.comicImageLoader(context)`）→
 *     `godBindingNeedsRemoteLoader()` 返回布尔，**loader 本身不注入**（声明为
 *     `GodCoverImageDecoder` 端口，见下）。
 *   - `performHapticFeedback` → 跳过（Web 无 API），仅保留 `haptic` 判定位。
 *   - `androidx.activity.compose.BackHandler` → 宿主用 `Escape` 键 + 遮罩点击关闭，
 *     语义等价（Kotlin 侧拦截的是系统返回键）。
 *
 * 本次逐行复核的修正：
 *   - `godSheetIsDirty()` 新增配套的 `godSheetNormalizedCropTag()`：Kotlin L344 比的是
 *     `crop.toTag()`，而 `crop = CropParams.parse(cropTag)`（L262）已经归一化过，
 *     直接比原始 `cropTag` 字符串会与安卓不同（同一组裁剪参数、不同字节时，
 *     安卓判「未改动」而 TS 判「已改动」→ 打开编辑窗就弹放弃确认）。
 */

/* ══════════════ 请求 / 上下文模型（GodMomentModels.kt 已端口的类型在本文件补齐） ══════════════ */

import {
  GOD_RATING_MAX,
  GOD_RATING_MIN,
  clampGodRating,
  type CoverSource,
  type CropParams,
  type GodMoment,
} from './godTypes';

/** `GodPageRef`（GodMomentModels.kt L281-288）—— 页面引用（与阅读器解耦）。 */
export interface GodPageRef {
  id: string;
  /** 本地文件路径 或 在线 URL */
  source: string;
  remote: boolean;
  /** 在线页的请求头（在线源需要 referer/自定义头） */
  headers?: Readonly<Record<string, string>>;
}

/**
 * `GodPageRef.headers` 的 `Map<String, String> = emptyMap()`（GodMomentModels.kt L286）
 * → TS 用可选字段表达缺省，读处统一走 `?? {}`。
 */
export function godPageHeaderMap(ref: GodPageRef): Record<string, string> {
  return ref.headers ?? {};
}

/**
 * `godPageHeaders(headers, referer)`（GodMomentModels.kt L291-297）。
 * 已有源专用 Referer 时优先保留。
 */
export function godPageHeaders(
  headers: Readonly<Record<string, string>>,
  referer: string | null | undefined,
): Record<string, string> {
  const hasReferer = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'referer',
  );
  if (referer === null || referer === undefined || referer.trim() === '' || hasReferer) {
    return { ...headers };
  }
  return { ...headers, Referer: referer };
}

/**
 * `GodMomentContext`（GodMomentModels.kt L250-262）——
 * 阅读器 → 神回窗口的上下文。`remoteLoader` 不再进模型（见 `GodCoverImageDecoder`）。
 */
export interface GodMomentContext {
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle?: string;
  chapterNumber?: number;
}

/** `GodMomentContext.enabled`（GodMomentModels.kt L261）。 */
export function godContextEnabled(ctx: GodMomentContext | null): boolean {
  return ctx !== null && ctx.bookId !== '' && ctx.chapterId !== '';
}

/**
 * `GodMomentRequest`（GodMomentModels.kt L266-277）——
 * 建立 / 更新神回的请求（阅读器触发 & 详情页编辑共用）。
 */
export interface GodMomentRequest {
  contentType: 'comic' | 'novel';
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  /** 本话全部页引用（页面选择器用） */
  pages: readonly GodPageRef[];
  /** 默认选中页（用户当前读到的页） */
  initialPageIndex: number;
}

/**
 * `GodMomentRequest` 的默认值（GodMomentModels.kt L267-276）——
 * `contentType = COMIC` / `chapterTitle = ""` / `chapterNumber = 0` /
 * `pages = emptyList()` / `initialPageIndex = 0`。
 */
export function createGodMomentRequest(
  init: Pick<GodMomentRequest, 'bookId' | 'chapterId' | 'bookTitle'> &
    Partial<GodMomentRequest>,
): GodMomentRequest {
  return {
    contentType: init.contentType ?? 'comic',
    bookId: init.bookId,
    chapterId: init.chapterId,
    bookTitle: init.bookTitle,
    chapterTitle: init.chapterTitle ?? '',
    chapterNumber: init.chapterNumber ?? 0,
    pages: init.pages ?? [],
    initialPageIndex: init.initialPageIndex ?? 0,
  };
}

/* ══════════════ 绑定对象（GodReaderBinding.kt L21-48） ══════════════ */

/**
 * `class GodMomentBinding`（GodReaderBinding.kt L21-48）——
 * `onOpenCurrent` / `request` 是 Compose 状态，TS 侧交给宿主 `useState`。
 * 这里只保留**请求的纯构造**与判定。
 */
export interface GodReaderBinding {
  /** 当前打开的神回请求（null = 窗口关闭） */
  request: GodMomentRequest | null;
}

/** `rememberGodEditBinding()` / `rememberGodMomentBinding(...)` 的初值（L62, L134）。 */
export function createGodReaderBinding(): GodReaderBinding {
  return { request: null };
}

/** `val enabled: Boolean get() = onOpenCurrent != null`（GodReaderBinding.kt L30）。 */
export function godBindingEnabled(
  onOpenCurrent: (() => void) | null,
): boolean {
  return onOpenCurrent !== null;
}

/**
 * `fun openEdit(existing, pages)`（GodReaderBinding.kt L36-47）。
 *
 * L45 `initialPageIndex = (existing.source as? CoverSource.ComicPage)?.pageIndex ?: 0`
 * —— 只有漫画页来源才带页号，相册 / 小说摘录一律回 0。
 */
export function godBindingOpenEdit(
  existing: GodMoment,
  pages: readonly GodPageRef[] = [],
  parseSource: (tag: string) => CoverSource,
): GodMomentRequest {
  const source = parseSource(existing.coverSource);
  const pageIndex = source.kind === 'comicPage' ? source.pageIndex : 0;
  return createGodMomentRequest({
    contentType: existing.contentType,
    bookId: existing.bookId,
    chapterId: existing.chapterId,
    bookTitle: existing.bookTitle,
    chapterTitle: existing.chapterTitle,
    chapterNumber: existing.chapterNumber,
    pages,
    initialPageIndex: pageIndex,
  });
}

/**
 * `idx = latestPage().coerceIn(0, (latestPages.size - 1).coerceAtLeast(0))`
 * （GodReaderBinding.kt L70）。空页列表时收敛到 0。
 */
export function godBindingClampPageIndex(currentPage: number, pageCount: number): number {
  const maxIndex = Math.max(0, pageCount - 1);
  if (!Number.isFinite(currentPage)) return 0;
  return Math.min(maxIndex, Math.max(0, Math.trunc(currentPage)));
}

/**
 * `rememberGodMomentBinding` 里的 `onOpenCurrent`（GodReaderBinding.kt L64-82）。
 *
 * `if (ctx != null)` 为假时返回 null（该场景未启用神回，L64）。
 * `contentType = GodContentType.COMIC` 固定（L72）。
 */
export function godBindingBuildRequest(
  ctx: GodMomentContext | null,
  pages: readonly GodPageRef[],
  currentPage: () => number,
): GodMomentRequest | null {
  if (ctx === null) return null;
  const idx = godBindingClampPageIndex(currentPage(), pages.length);
  return createGodMomentRequest({
    contentType: 'comic',
    bookId: ctx.bookId,
    chapterId: ctx.chapterId,
    bookTitle: ctx.bookTitle,
    chapterTitle: ctx.chapterTitle ?? '',
    chapterNumber: ctx.chapterNumber ?? 0,
    pages,
    initialPageIndex: idx,
  });
}

/**
 * 已有神回的加载门 key（GodReaderBinding.kt L100-105, L153-158）。
 *
 * Kotlin 用 `remember(request.bookId, request.chapterId)` + `LaunchedEffect` 一次性
 * 查库，未加载完成前 `if (!loaded) return`（L106, L159）不渲染窗口 ——
 * 表单各字段只在首帧组合时取 `existing` 初始化，早期用 `Flow + null` 会永远显示
 * 默认文字（L149-152 注释记录的用户实测 bug）。TS 侧用同一 key 挂载
 * `<GodMomentSheet key={…}>` 达到"重挂载 = 重新初始化"，语义完全一致。
 */
export function godBindingLoadKey(request: GodMomentRequest): string {
  return `${request.bookId} ${request.chapterId}`;
}

/**
 * `GodMomentEditHost` 的远程 loader 按需构建（GodReaderBinding.kt L164-170）：
 * `if (request.pages.any { it.remote }) comicImageLoader(context) else null`
 * —— 本地书没有远程页，不为纯本地场景拉起整套加载器。
 */
export function godBindingNeedsRemoteLoader(pages: readonly GodPageRef[]): boolean {
  return pages.some((page) => page.remote);
}

/**
 * `godContextWithLoader(ctx, loader)`（GodReaderBinding.kt L126-127）——
 * Kotlin `ctx.copy(remoteLoader = loader)`。TS 侧模型已无 loader 字段，
 * 该函数保留签名意图：原样返回 ctx（loader 由 `GodCoverImageDecoder` 端口承载）。
 */
export function godContextWithLoader(
  ctx: GodMomentContext,
  _loader: GodCoverImageDecoder | null,
): GodMomentContext {
  return ctx;
}

/* ══════════════ 封面解码端口（GodCoverEngine.loadPage/loadUri 的注入端口） ══════════════ */

/**
 * PORT — Android `GodCoverEngine.loadPage()` / `loadUri()` / `thumbnailOf()`
 * （GodCoverEngine.kt L104-139, L220-233）。**未实现，仅声明端口**。
 *
 * 裁剪与预览需要**位图**（不是 `<img>` 的 URL），因为：
 * 1. 旋转在后台线程算（GodCoverCropScreen.kt L81-85 `GodCoverEngine.rotate`）；
 * 2. 裁剪坐标要换算回"（旋转后）原图归一化矩形"（同文件 L266-275）；
 * 3. 缩略图需要按 `THUMB_MAX_EDGE = 320` 降采样（GodCoverEngine.kt L214）。
 *
 * 宿主实现用 `createImageBitmap` / `<canvas>`（见 `GodCoverCropPage.tsx` 头注）。
 */
export interface GodCoverImageDecoder {
  /** 按目标最长边降采样解码一页。失败返回 null。 */
  decodePage(ref: GodPageRef, maxEdge: number): Promise<GodDecodedImage | null>;
  /** 相册 Uri 解码。失败返回 null。 */
  decodeUri(uri: string, maxEdge: number): Promise<GodDecodedImage | null>;
  /** 缩略图（`GodCoverEngine.thumbnailOf`，THUMB_MAX_EDGE = 320）。 */
  thumbnail(image: GodDecodedImage): GodDecodedImage;
}

/** 平台位图句柄（web = `ImageBitmap`，由宿主注入；core 不认识 DOM）。 */
export type GodDecodedImage = unknown;

/** `GodCoverEngine.DECODE_MAX_EDGE = 1600`（GodCoverEngine.kt L79）。 */
export const GOD_DECODE_MAX_EDGE = 1600;

/** `GodCoverEngine.THUMB_MAX_EDGE = 320`（GodCoverEngine.kt L214，`internal`）。 */
export const GOD_THUMB_MAX_EDGE = 320;

/** `GodCoverEngine.PREVIEW_W` / `PREVIEW_H`（GodCoverEngine.kt L57-58）→ 复用已端口常量。 */
export { GOD_PREVIEW_HEIGHT, GOD_PREVIEW_WIDTH } from './godCoverEngine';

/** `GodCoverEngine.COVER_RATIO`（GodCoverEngine.kt L54）→ 复用已端口常量。 */
export { GOD_COVER_RATIO } from './godCoverEngine';

/* ══════════════ 可编辑星级（GodStarRating.kt 可交互半边） ══════════════ */

/** 是否接受手势（`if (!enabled) return@pointerInput`，GodStarRating.kt L113-114, L122-123）。 */
export function godRatingIsInteractive(enabled: boolean): boolean {
  return enabled === true;
}

/**
 * `commit` 的判定（GodStarRating.kt L96-104）。
 *
 * - `val v = raw.coerceRating()` → `clampGodRating(raw)`（godTypes.ts L91-95）
 * - `if (v == rating) return` → `changed: false`
 * - `if (HapticsGate.enabled && v != lastHaptic)` → `haptic: boolean`（Web 不执行）
 */
export function godRatingCommit(
  rating: number,
  raw: number,
  lastHaptic: number,
): { value: number; changed: boolean; haptic: boolean; nextLastHaptic: number } {
  // clampGodRating 内部完成 0.5 步长取整 + [0.5, 5] 夹紧（GodStarRating.kt L56-58）
  const value = clampRating(raw);
  if (value === rating) {
    return { value, changed: false, haptic: false, nextLastHaptic: lastHaptic };
  }
  const haptic = value !== lastHaptic;
  return { value, changed: true, haptic, nextLastHaptic: value };
}

/**
 * `Float.coerceRating()`（GodStarRating.kt L56-58）。
 * 与 `clampGodRating`（godTypes.ts L91-95）逐式等价，此处**直接复用**，
 * 只保留本名字以便对照 Kotlin 行号。
 */
export function clampRating(value: number): number {
  return clampGodRating(value);
}

/**
 * x 坐标 → 评分。Kotlin L118 / L130：
 * `commit(((offset.x / w) * 5f).coerceIn(GOD_RATING_MIN, GOD_RATING_MAX))`
 * 两次出现（点按 + 横向拖动），抽成一个函数。
 *
 * 宽度 ≤ 0 时直接返回 null（`if (w <= 0f) return`，L117）。
 */
export function godRatingFromX(x: number, width: number): number | null {
  if (width <= 0) return null;
  return Math.min(GOD_RATING_MAX, Math.max(GOD_RATING_MIN, (x / width) * 5));
}

/**
 * 半星检测：第 `i` 颗（1 起）的填充比例。
 * Kotlin `val filled = (rating - (i - 1)).coerceIn(0f, 1f)`（GodStarRating.kt L138）。
 *
 * 测试用它区分「整星」与「半星」：`0 < filled < 1` 即半星（`clipRect` 左半边，L220）。
 */
export function godStarFill(rating: number, i: number): number {
  return Math.min(1, Math.max(0, rating - (i - 1)));
}

/** 是否半星（`filled > 0 && filled < 1`，对应 `clipRect(right = w * filled)`，L220）。 */
export function godStarIsHalfFilled(rating: number, i: number): boolean {
  const filled = godStarFill(rating, i);
  return filled > 0 && filled < 1;
}

/** `val target = if (filled > 0f) 1f else 0.82f`（GodStarRating.kt L185）。 */
export function godStarScaleTarget(filled: number): number {
  return filled > 0 ? 1 : 0.82;
}

/**
 * `sparkKey` 自增（GodStarRating.kt L87-94）：
 * `if (rating != lastRating) { lastRating = rating; sparkKey++ }`。
 */
export function nextGodSparkKey(
  sparkKey: number,
  rating: number,
  lastRating: number,
): { sparkKey: number; lastRating: number } {
  if (rating !== lastRating) return { sparkKey: sparkKey + 1, lastRating: rating };
  return { sparkKey, lastRating };
}

/** 星屑粒子（GodSparks，GodStarRating.kt L253-267）。 */
export interface GodSparkParticle {
  angle: number;
  distance: number;
  alpha: number;
  radius: number;
}

/**
 * `GodSparks` 的 6 粒金屑（GodStarRating.kt L254-266）。
 *
 * - `for (i in 0 until 6)`、`angle = -PI/2 + i * 2PI/6`
 * - `dist = width * 0.55f * progress`
 * - `alpha = (1 - progress).coerceIn(0f, 1f) * 0.9f`
 * - `radius = width * 0.055f * (1 - progress * 0.5f)`
 *
 * `progress <= 0 || progress >= 1` 时不绘制（L254），此处返回空数组。
 */
export function godSparkParticles(progress: number, width: number): GodSparkParticle[] {
  if (progress <= 0 || progress >= 1) return [];
  const out: GodSparkParticle[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + i * ((2 * Math.PI) / 6);
    out.push({
      angle,
      distance: width * 0.55 * progress,
      alpha: Math.min(1, Math.max(0, 1 - progress)) * 0.9,
      radius: width * 0.055 * (1 - progress * 0.5),
    });
  }
  return out;
}

/* ══════════════ Sheet 表单判定（GodMomentSheet.kt） ══════════════ */

/** `private const val TITLE_MAX = 30`（GodMomentSheet.kt L221）→ 复用 godTypes 同值。 */
export const GOD_SHEET_TITLE_MAX = 30;

/** `private const val NOTE_MAX = 500`（GodMomentSheet.kt L222）→ 复用 godTypes 同值。 */
export const GOD_SHEET_NOTE_MAX = 500;

/** `private const val SHEET_HEIGHT_FRACTION = 0.92f`（GodMomentSheet.kt L223）。 */
export const GOD_SHEET_HEIGHT_FRACTION = 0.92;

/**
 * `coverSourceTag` 初值（GodMomentSheet.kt L252-256）：
 * `(existing?.source ?: CoverSource.ComicPage(request.initialPageIndex.coerceAtLeast(0))).toTag()`
 *
 * `initialPageIndex` 为负时钳到 0（`coerceAtLeast(0)`）。
 */
export function godSheetInitialCoverTag(
  existing: GodMoment | null,
  request: GodMomentRequest,
  toTag: (source: CoverSource) => string,
): string {
  if (existing !== null) return existing.coverSource;
  return toTag({ kind: 'comicPage', pageIndex: Math.max(0, request.initialPageIndex), pageId: '' });
}

/** `rating` 初值（GodMomentSheet.kt L265-267）。 */
export function godSheetInitialRating(existing: GodMoment | null): number {
  const raw = existing?.rating ?? 5;
  return Math.min(GOD_RATING_MAX, Math.max(GOD_RATING_MIN, raw));
}

/**
 * `titleCustom` / `titleText` 初值（GodMomentSheet.kt L268-272）。
 * `rememberSaveable` 的初值只在首次组合求一次。
 */
export function godSheetInitialTitleState(existing: GodMoment | null): {
  titleCustom: boolean;
  titleText: string;
} {
  const titleCustom = existing?.titleIsCustom ?? false;
  return {
    titleCustom,
    titleText: titleCustom ? (existing?.title ?? '') : '',
  };
}

/** `val defaultTitle = "${request.bookTitle} 第${request.chapterNumber}话"`（L274）。 */
export function godSheetDefaultTitle(request: GodMomentRequest): string {
  return `${request.bookTitle} 第${request.chapterNumber}话`;
}

/** `val shownTitle = if (titleCustom && titleText.isNotBlank()) titleText else defaultTitle`（L275）。 */
export function godSheetShownTitle(
  titleCustom: boolean,
  titleText: string,
  defaultTitle: string,
): string {
  return titleCustom && titleText.trim() !== '' ? titleText : defaultTitle;
}

/**
 * `onValueChange = { raw -> val v = raw.take(TITLE_MAX); titleText = v; titleCustom = v.isNotBlank() }`
 * （GodMomentSheet.kt L523-528）—— 清空 = 放弃自定义 → 自动回退默认标题。
 */
export function godSheetTitleChanged(raw: string): {
  titleText: string;
  titleCustom: boolean;
} {
  const titleText = raw.slice(0, GOD_SHEET_TITLE_MAX);
  return { titleText, titleCustom: titleText.trim() !== '' };
}

/** `onValueChange = { note = it.take(NOTE_MAX) }`（GodMomentSheet.kt L543）。 */
export function godSheetNoteChanged(raw: string): string {
  return raw.slice(0, GOD_SHEET_NOTE_MAX);
}

/**
 * 裁剪参数的「Kotlin 序列化」值 —— `CropParams.parse(cropTag).toTag()`。
 *
 * Kotlin L344 的 dirty 判定比的是 `crop.toTag() != base.cropParams`，其中
 * `val crop: CropParams = CropParams.parse(cropTag)`（L262）已经**归一化**过，
 * 再 `toTag()` 会重新 round3 + 按 Kotlin `Float.toString()` 落格式。
 * 直接拿原始 `cropTag` 字符串比会与安卓不同（例如安卓写出的
 * `"1.0,0.0,…,1.0,1.0"` 与旧数据 `"1,0,0,0,0,0,1,1"` 语义相同但不等值，
 * 安卓会判「未改动」，直接比字符串会判「已改动」→ 打开编辑窗就弹放弃确认）。
 */
export function godSheetNormalizedCropTag(
  cropTag: string,
  parse: (tag: string) => CropParams,
  toTag: (crop: CropParams) => string,
): string {
  return toTag(parse(cropTag));
}

/**
 * `val dirty = remember(editing, rating, titleCustom, titleText, note, coverSource, crop)`
 * （GodMomentSheet.kt L337-346）—— 全量未保存判定，遮罩点击 / 取消都依赖它。
 *
 * - 新建：任何非默认值都算 dirty（L340）
 * - 编辑：与实体逐字段比对（L342-345）
 *
 * ⚠️ `cropTag` 必须传 `godSheetNormalizedCropTag()` 的结果（见上）。
 */
export function godSheetIsDirty(args: {
  existing: GodMoment | null;
  rating: number;
  titleCustom: boolean;
  titleText: string;
  note: string;
  coverSourceTag: string;
  cropTag: string;
  request: GodMomentRequest;
  comicPageTag: (pageIndex: number) => string;
}): boolean {
  const base = args.existing;
  if (base === null) {
    return (
      args.rating !== 5 ||
      args.titleCustom ||
      args.note.trim() !== '' ||
      args.coverSourceTag !== args.comicPageTag(args.request.initialPageIndex)
    );
  }
  return (
    args.rating !== base.rating ||
    args.titleCustom !== base.titleIsCustom ||
    args.titleText !== (base.titleIsCustom ? base.title : '') ||
    args.note !== base.note ||
    args.coverSourceTag !== base.coverSource ||
    args.cropTag !== base.cropParams
  );
}

/** `initialCoverTag` 形参未用时的占位（保持签名可读；调用方已从 request 推导）。 */
export type GodSheetInitialCoverTag = typeof godSheetInitialCoverTag;

/**
 * `coverRetry` / `sourceBitmap` / `loadingCover` 的 `remember(coverSourceTag, coverRetry, ...)`
 * 键（GodMomentSheet.kt L278-281）—— 换来源时旧请求 / 旧合成结果不能冒充新页。
 */
export function godSheetCoverLoadKey(args: {
  coverSourceTag: string;
  coverRetry: number;
  pages: readonly GodPageRef[];
  fallbackCoverPath: string | null | undefined;
  hasRemoteLoader: boolean;
}): string {
  const pageKey = args.pages.map((page) => page.id).join(',');
  const fallback = args.fallbackCoverPath ?? '';
  return `${args.coverSourceTag}#${args.coverRetry}#${pageKey}#${fallback}#${args.hasRemoteLoader ? 1 : 0}`;
}

/**
 * `onPickPage`（GodMomentSheet.kt L483-487）：
 * `if (coverSource == ComicPage(idx) && !loadingCover && sourceBitmap == null) coverRetry++`
 * —— 重选同一页且当前没图 → 强制重解码（此前的解码失败了）。
 */
export function godSheetShouldRetryCover(args: {
  currentSource: CoverSource;
  pageIndex: number;
  loading: boolean;
  hasBitmap: boolean;
}): boolean {
  const isSame =
    args.currentSource.kind === 'comicPage' && args.currentSource.pageIndex === args.pageIndex;
  return isSame && !args.loading && !args.hasBitmap;
}

/** `onPickPage` 完整结果（GodMomentSheet.kt L483-487）。 */
export function godSheetPickPage(args: {
  currentSource: CoverSource;
  pageIndex: number;
  loading: boolean;
  hasBitmap: boolean;
}): { retry: number; coverSource: CoverSource } {
  const retry = godSheetShouldRetryCover(args) ? 1 : 0;
  return {
    retry,
    coverSource: { kind: 'comicPage', pageIndex: args.pageIndex, pageId: '' },
  };
}

/* ══════════════ 末页提示胶囊（GodPull.kt L293-320） ══════════════ */

/** `text: String = "继续滑动 · 标记神回"`（GodPull.kt L297）。 */
export const GOD_HINT_CAPSULE_TEXT = '继续滑动 · 标记神回';

/**
 * `if (alpha <= 0.01f) return`（GodPull.kt L305）的门控。
 * Kotlin 的 alpha 由 `animateFloatAsState(targetValue = if (visible) 1f else 0f, GodMotion.normal())`
 * 驱动（L300-304）；TS 侧用 CSS transition 表达同样的淡入淡出，判定保留为纯函数。
 */
export function godHintCapsuleShouldRender(alpha: number): boolean {
  return alpha > 0.01;
}

/** 胶囊文本随 armed 状态切换（GodPullOverlay 的三行文案，L272-288）。 */
export function godPullOverlayText(armed: boolean): {
  glyph: string;
  primary: string;
  secondary: string;
} {
  return armed
    ? { glyph: '✦', primary: '松手，收藏这一刻', secondary: '神回已就绪' }
    : { glyph: '◇', primary: '继续滑动', secondary: '标记为神回' };
}

/**
 * GodMomentSheet.tsx — 「标记为神回」底部面板（阅读器内入口，**深色为主**）。
 *
 * Ported line-by-line from Android `god/GodMomentSheet.kt` (1334 lines / 1278 non-blank).
 * Read-only source: novel-reader/app/src/main/java/com/example/god/GodMomentSheet.kt
 *
 * 主题依据（任务要求「阅读器内 → 深色」）：Android 的 `godIsDark()`
 * （GodMotion.kt L142-143）按 App 配色方案背景亮度判定；`GodAcrylicPanel` /
 * `GodFormSection` / `GodNoteField` 三处都按 `dark` 分叉（见下表），
 * 阅读器路由在 TS 侧由 `.app-shell` 的实际背景亮度决定（`godIsDark()` 已端口）。
 *
 * Kotlin 行号映射（本文件）：
 *   - 130-135 `rememberGodPrismColors`（金调内部色散 6 色）→ `godPrismColors()`
 *   - 152-217 `Modifier.godAcrylicPanel(shape, darkTheme, surfaceAlpha = 0.74f)`
 *              （双层 consistentShadow → clip → 半透明基底 → 顶棱抛光带 →
 *                125° 对角光束 → filmGrain → iridescentBorder → crystalInnerBevel）
 *              → `.god-sheet__panel` 的 CSS 分层（见 god.css 新增段）
 *   - 221     `TITLE_MAX = 30`  → `GOD_SHEET_TITLE_MAX`（core）
 *   - 222     `NOTE_MAX = 500`   → `GOD_SHEET_NOTE_MAX`（core）
 *   - 223     `SHEET_HEIGHT_FRACTION = 0.92f` → `GOD_SHEET_HEIGHT_FRACTION`（core）
 *   - 234-241 `GodMomentSheet(request, existing, viewModel, remoteLoader,
 *              onDismiss, onSaved)` 签名
 *   - 242-247 `context` / `scope` / `density` / `reduce` / `dark` / `editing`
 *   - 252-259 `coverSourceTag` rememberSaveable + `parseCoverSource`
 *   - 261-263 `cropTag` rememberSaveable + `CropParams.parse`
 *   - 265-267 `rating` 初值
 *   - 268-272 `titleCustom` / `titleText`
 *   - 274-275 `defaultTitle` / `shownTitle`
 *   - 278-285 `coverRetry` / `sourceBitmap` / `preview` / `loadingCover` /
 *              `showCrop` / `saving` / `burst` / `confirmClose`
 *   - 290-308 载入封面来源（ComicPage / Album / NovelExcerpt 三分支 + 后台解码）
 *   - 311-323 预览合成（450×600，`GodCoverEngine.applyCrop` + `compose`）
 *   - 326-335 相册（`PickVisualMedia`，null → Toast「未选择图片」）
 *   - 337-346 `dirty` 全量判定
 *   - 349-383 `doSave()`（防抖 → 裁剪 → `composeAndSave` → 构造实体 → 保存
 *              → `burst = true` → `delay(620)` → `onSaved`）
 *   - 385-402 背景遮罩（`radialGlassScrim` + 点击：有脏则确认，无脏则关闭）
 *   - 405-417 Sheet 表面（`RoundedCornerShape(SHEET_CORNER)` 顶角 +
 *              `fillMaxHeight(0.92f)` + `imePadding()` + `godAcrylicPanel`）
 *   - 419-431 下拉把手（44×5 胶囊，`onSurface@0.24`）
 *   - 433-459 可滚动内容（`verticalScroll` + 底部 44dp 渐隐 `BlendMode.DstIn`）
 *   - 460-469 ① 标题（`GodSheetTitle`）
 *   - 471-500 ② 封面（`GodCoverSection`：3D 倾斜预览 + 裁剪/相册 chip + 页缩略图行）
 *   - 502-513 ③ 评分（`GodStarRating` → `GodStarRatingEditable`）
 *   - 515-535 ④ 名称（`GodTitleField`，TITLE_MAX 截断 + 清空回退默认）
 *   - 537-547 ⑤ 随笔（`GodNoteField`，便签纸质感 + 横线）
 *   - 550     底部 34dp 留白（滚到底不被渐隐带吃掉）
 *   - 554-570 ⑥ 吸底操作栏（`GodActionBar`：标题 + `★ rating` + 取消 + 主按钮）
 *   - 575-577 保存成功 `GodBurstOverlay`
 *   - 580-585 `GodConfirmCloseDialog`
 *   - 588-598 `showCrop` → `GodCoverCropScreen`
 *   - 603-697 `GodSheetTitle`（流光标题 + 漂移光斑 + 4 颗闪烁星点）
 *   - 703-730 `GodSheetBlock`（错峰入场：淡入 + 上浮 26dp，`STAGGER_MS = 60`）
 *   - 734-791 `GodCoverSection`（页选择器 LazyRow，`initialFirstVisibleItemIndex`）
 *   - 795-884 `GodTiltCover`（按压 3D 倾斜 ±12°，`CROSSFADE`）
 *   - 886-893 `GodThumbCache`（12MB LruCache，按 byteCount）
 *   - 895-982 `GodPageThumb`（52×70，渐进预览，点击重试）
 *   - 986-992 `SectionLabel`（labelLarge 槽位）
 *   - 996-1036 `GodFormSection`（number + title + caption，20dp 圆角）
 *   - 1038-1077 `GodTitleField`（`{len}/30` 计数 + 「还原默认」trailing icon）
 *   - 1079-1125 `GodNoteField`（纸色 + 26dp 横线 + `{len}/500`）
 *   - 1129-1172 `GodActionBar`
 *   - 1175-1261 `GodShineButton`（金色渐变 + 定时扫过的光泽 + 顶部受光带）
 *   - 1269-1311 `GodChipButton`（半透明 + 1dp 描边 + 内侧顶部高光）
 *   - 1315-1362 `GodBurstOverlay`（18 粒放射 + 封面上浮淡出）
 *   - 1364-1376 `GodConfirmCloseDialog`（AlertDialog：「放弃这次编辑？」）
 *
 * 纯逻辑（`dirty` / 初值 / 封面 key / 重选判定）落在 `@core/god/godReaderBinding`。
 *
 * 适配与跳过（原因）：
 *   - **没有 `ModalBottomSheet`**：Kotlin 注释 L227-231 明确说明是自绘 Sheet
 *     （ModalBottomSheet 走 Popup 子窗口，背后内容不受控）。TS 侧等价做法就是
 *     `position: fixed` 的底部 overlay + scrim，见 `.god-sheet` / `.god-sheet__scrim`。
 *   - `rememberLauncherForActivityResult(PickVisualMedia)` → `<input type="file"
 *     accept="image/*">`（宿主 `onPickAlbum` 传入的回调负责打开）。
 *   - `Bitmap` 封面 → `previewUrl: string | null`（`<img>` 直接用 URL）。
 *     位图合成由注入的 `GodCoverImageDecoder` 端口承担（core 已声明）。
 *   - `LaunchedEffect` → `useEffect`；`rememberSaveable` → `useState`（+ `key` 重挂载
 *     实现 Kotlin `remember(bookId, chapterId)` 的语义，见 `GodReaderBinding` 头注）。
 *   - `Box(weight(1f))` / `Column` / `Row` → flex。
 *   - `graphicsLayer` / `drawBehind` / `drawWithContent` / `Brush.*` / `BlendMode.DstIn`
 *     → CSS 多层渐变 + `mask-image`（渐隐带用 `linear-gradient` + `mask`）。
 *   - `CircularProgressIndicator` → `.god-spinner`（CSS 旋转弧）。
 *   - `Icons.Filled.Crop` / `PhotoLibrary` / `Refresh` → 文本符号，无障碍文案保留。
 *   - `HapticsGate` / `performHapticFeedback` → **跳过**（无 Web API）。
 *   - `AndroidViewModel` / `viewModel()` → `@core/god/godMoments` 的进程内 store
 *     （已端口）+ 宿主注入的 `onSave` 回调（本文件不碰数据库）。
 *   - `Toast.makeText` → `showToast()`（`@ui/toast`）。
 *   - `delay(620)`（L380）→ `setTimeout(620)`。
 *
 * 本次逐行复核的修正（对照 Kotlin 原文）：
 *   - L246 分区序号：删掉凭空加的 `✦` 前缀（Kotlin L1017-1023 只有 `number`）。
 *   - L241 分区描边：补回 Kotlin L1011 的浅色分支
 *     （`GodGold.LightMid.copy(alpha = if (dark) 0.25f else 0.19f)`），
 *     此前恒用 0.25。
 *   - L580 吸底评分：Kotlin L1153 `"★ $rating"`（Float → `"5.0"`），
 *     改用 `godRatingText()`，此前渲染成 `★ 5`。
 *   - L693 `doSave`：补回 Kotlin L350 的 `sourceBitmap == null` 门。
 *   - L657 / L751 / 裁剪回填：`cropTag` 一律走 core 的 `cropParamsToTag()`，
 *     与 Kotlin L261（`existing?.crop ?: DEFAULT` → `toTag()`）、L486、
 *     L594（`setCrop`）同一条序列化路径，不再手写 `'1,0,0,0,0,0,1,1'`。
 *   - L337-346 `dirty`：Kotlin 比的是 `crop.toTag()`，而 `crop = CropParams.parse(cropTag)`
 *     （L262）已归一化过；此前 TS 直接拿原始 `cropTag` 字符串比，两端对「同一份
 *     裁剪参数、不同字节」的处理会不同（安卓判「未改动」）。现传
 *     `godSheetNormalizedCropTag(cropTag, parseCropParams, cropParamsToTag)`。
 *   - `GodSheetBlock`（L718-722 `animateFloatAsState(tween(reduce?120:320))`）：alpha 与
 *     translationY 是**同一条** tween，默认缓动 `FastOutSlowInEasing`；此前给 opacity
 *     写 `ease-out`、给 transform 写弹簧近似曲线 —— 那是弹簧不是 tween。现统一
 *     `GOD_FAST_OUT_SLOW_IN_CSS` = `cubic-bezier(0.4, 0, 0.2, 1)`。
 *   - `GodTiltCover`（L830-835）：`rotY/rotX` 改用**逐事件增量**（Compose
 *     `detectDragGestures` 的 `drag` 是自上一事件以来的位移），此前 TS 用从按下点算的
 *     总量 → 按住不动会一直保持最大倾角。
 *   - `staggerDelay` 的默认 `base` 改成 0（Kotlin L191 `base: Int = 0`）；唯一调用点
 *     仍传 60（Kotlin L714），行为不变。
 *
 * 2026-10-11（E18 收口）改动：
 *   - `onPickAlbum` 的签名从 `() => void` 改为
 *     `(onPicked: (uri: string | null) => void) => void`：Kotlin 的 picker 结果回调
 *     （L325-335）本来就在**本组件**里（写回 `CoverSource.Album` + `CropParams.DEFAULT`），
 *     宿主只负责打开选择器（`rememberLauncherForActivityResult` ↔
 *     `platform.documents.pickFile`），结果经 `onPicked` 回传 —— 这是文件头
 *     L74-75 / props L701「宿主负责打开文件选择器，**回填 uri**」的本意。
 *   - 补两个可选 prop：`cropSourceUrl`（Kotlin L588-598 给裁剪屏传的是
 *     `sourceBitmap` **原图**，不是合成预览）与 `onCropApplied`（Kotlin L594
 *     `setCrop(newCrop)` 后由 LaunchedEffect(sourceBitmap, crop) 重合成预览，
 *     TS 侧预览归宿主，经此回调触发同一效果）。
 *   - `doSave` 改为等宿主 `onSave` 的 Promise 再 burst（Kotlin L349-381 本来就是
 *     协程顺序：裁剪合成 + 落库**完成后**才 `burst = true` → `delay(620)` →
 *     `onSaved()`；宿主的 Canvas 合成是异步的，此前「同步调 onSave + 定时器」
 *     会让关窗跑在落库前面）。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  GOD_SHEET_HEIGHT_FRACTION,
  GOD_SHEET_NOTE_MAX,
  GOD_SHEET_TITLE_MAX,
  godSheetDefaultTitle,
  godSheetInitialCoverTag,
  godSheetInitialRating,
  godSheetInitialTitleState,
  godSheetIsDirty,
  godSheetNormalizedCropTag,
  godSheetNoteChanged,
  godSheetPickPage,
  godSheetShownTitle,
  godSheetTitleChanged,
  godBindingNeedsRemoteLoader,
  type GodMomentContext,
  type GodMomentRequest,
  type GodPageRef,
} from '@core/god/godReaderBinding';
import { coverSourceToTag, resolveCoverSource } from '@core/god/godCoverEngine';
import { GOD_FAST_OUT_SLOW_IN_CSS } from '@core/god/godEasing';
import {
  DEFAULT_CROP_PARAMS,
  cropParamsToTag,
  parseCropParams,
  type CropParams,
  type GodMoment,
} from '@core/god/godTypes';
import { findGodMoment } from '@core/god/godMoments';
import { showToast } from '@ui/toast';
import { GodDialog, godGoldGradient, godIsDark, godRatingText } from './GodRankingShared';
import { GodStarRatingEditable } from './GodStarRatingEditable';
import { GodCoverCropPage } from '@ui/pages/GodCoverCropPage';
import '../../../styles/god.css';

/** GodMotion.SHEET_CORNER = 28f（GodMotion.kt L70）→ 顶角圆角。 */
const SHEET_CORNER = 28;
/** GodMotion.SHINE_MS = 2600（GodMotion.kt L59）→ 流光周期。 */
const SHINE_MS = 2600;
/** GodMotion.STAGGER_MS = 60（GodMotion.kt L52）→ 区块错峰间隔。 */
const STAGGER_MS = 60;
/**
 * `staggerDelay(index, base)`（GodMotion.kt L191）= `base + index * STAGGER_MS`。
 * 调用点 `GodMomentSheet.kt:714` 传的是 `staggerDelay(index, 60)`。
 */
function staggerDelay(index: number, base = 0): number {
  return base + index * STAGGER_MS;
}
/** Kotlin 383 `delay(620)` → 保存成功到关窗之间的停顿。 */
const SAVE_BURST_DELAY_MS = 620;
/** Kotlin 733 → 上浮距离 26dp。 */
const BLOCK_RISE_PX = 26;

/**
 * Kotlin L330：相册取消的 Toast 文案（`uri == null` 分支）。
 * 导出给宿主复用 —— 异步 reject（打开失败）的文案也在这里统一出处。
 */
export const GOD_TOAST_NO_IMAGE = '未选择图片';
/** Kotlin L492：`picker.launch` 抛错（runCatching onFailure）的 Toast 文案。 */
export const GOD_TOAST_OPEN_FAILED = '无法打开相册';

/**
 * `rememberGodPrismColors(darkTheme)`（GodMomentSheet.kt L130-135）。
 * 金调内部色散：浅金 → 金 → 珍珠白 → 深金 → 金 → 浅金。
 */
export function godPrismColors(dark: boolean): string[] {
  const gold = godGoldGradient(dark);
  return [gold[0], gold[1], '#EAF5F8', gold[2], gold[1], gold[0]];
}

/* ══════════════ ① 标题区（Kotlin L603-697） ══════════════ */

function GodSheetTitle(props: {
  editing: boolean;
  reduce: boolean;
  dark: boolean;
  bookTitle: string;
  chapterTitle: string;
}) {
  const gold = godGoldGradient(props.dark);
  // Kotlin 613-628：shift（-1→1，SHINE_MS 线性循环）+ drift（0→1，9000ms 线性循环）
  const shift = props.reduce ? 0.5 : 'var(--god-sheet-shift)';
  return (
    <div className={['god-sheet__title', props.reduce ? '' : 'god-sheet__title--shine']
      .filter(Boolean)
      .join(' ')}
      style={
        {
          '--god-sheet-shift': shift,
          '--god-sheet-shine-ms': `${SHINE_MS}ms`,
          // Kotlin L641/L654 都取 `gold.first()` —— 金色渐变的第一档。
          '--god-sheet-glow': gold[0],
        } as CSSProperties
      }
    >
      {/* Kotlin L634-656 `drawBehind`：
          ① 缓慢漂移的径向金光斑（半径 size.width*0.55，圆心随 drift 在
             0.25w~0.75w × 0.3h~0.7h 之间走），`gold.first()` 的 alpha 0.13；
          ② 4 颗闪烁星点（`a = drift*2π + i*1.7`，`alpha = (0.22 + 0.22·sin a)`
             夹在 0.04~0.44，半径 2.2dp，x = 0.62w + i*0.11w）。
          `if (reduce) return@drawBehind` —— 减弱动效时整段不画（E73）。
          用两层 `radial-gradient` 背景 + `god-star-*` 的 `@keyframes` 表达，
          几何常数逐个照抄 Kotlin。 */}
      {props.reduce ? null : (
        <span className="god-sheet__glow" aria-hidden="true">
          <span className="god-sheet__star god-sheet__star--0" />
          <span className="god-sheet__star god-sheet__star--1" />
          <span className="god-sheet__star god-sheet__star--2" />
          <span className="god-sheet__star god-sheet__star--3" />
        </span>
      )}
      <p className="god-sheet__eyebrow" style={{ color: gold[1] }}>
        {props.editing ? 'MOMENT / EDIT' : 'MOMENT / NEW'}
      </p>
      <h2 className="god-sheet__headline">
        {props.editing ? '重写这一刻 ✦' : '收藏这一刻 ✦'}
      </h2>
      <p className="god-sheet__book">
        {props.bookTitle}  /  {props.chapterTitle}
      </p>
    </div>
  );
}

/* ══════════════ 区块错峰入场（Kotlin L703-730） ══════════════ */

function GodSheetBlock(props: { index: number; reduce: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(props.reduce);
  useEffect(() => {
    if (props.reduce) return;
    const timer = window.setTimeout(
      () => setVisible(true),
      staggerDelay(props.index, 60),
    );
    return () => window.clearTimeout(timer);
  }, [props.index, props.reduce]);

  return (
    <div
      className="god-sheet__block"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : `translateY(${BLOCK_RISE_PX}px)`,
        // Kotlin L718-722：`animateFloatAsState(targetValue, tween(if (reduce) 120 else 320))`
        // —— alpha 与 translationY 用**同一条** tween，其默认缓动是
        // `FastOutSlowInEasing` = cubic-bezier(0.4, 0, 0.2, 1)。
        // 此前这里给 opacity 写 `ease-out`、给 transform 写弹簧近似
        // `cubic-bezier(0.3, 1.05, 0.5, 1)` —— 那是**弹簧**曲线，与 tween 不是同一条。
        transition: `opacity ${props.reduce ? 120 : 320}ms ${GOD_FAST_OUT_SLOW_IN_CSS}, transform ${
          props.reduce ? 120 : 320
        }ms ${GOD_FAST_OUT_SLOW_IN_CSS}`,
      }}
    >
      {props.children}
    </div>
  );
}

/* ══════════════ 分区容器（Kotlin L986-1036） ══════════════ */

function SectionLabel(props: { text: string; dark: boolean }) {
  return (
    <span
      className="god-sheet__label"
      style={{ color: props.dark ? 'rgba(255, 255, 255, 0.70)' : 'rgba(24, 25, 28, 0.70)' }}
    >
      {props.text}
    </span>
  );
}

function GodFormSection(props: {
  number: string;
  title: string;
  caption: string;
  dark: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="god-sheet__section"
      style={
        {
          // Kotlin L1008：`if (dark) White@0.055f else White@0.48f`
          background: props.dark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(255, 255, 255, 0.48)',
          // Kotlin L1011：`GodGold.LightMid.copy(alpha = if (dark) 0.25f else 0.19f)`
          borderColor: props.dark ? 'rgba(245, 185, 66, 0.25)' : 'rgba(245, 185, 66, 0.19)',
        } as CSSProperties
      }
    >
      <div className="god-sheet__section-head">
        {/* Kotlin L1017-1023：`Text(number, color = GodGold.LightMid, …)` — 只有序号本身，
            此前多写了一个 ✦ 前缀（Kotlin 里没有）。 */}
        <span className="god-sheet__section-number">{props.number}</span>
        <SectionLabel text={props.title} dark={props.dark} />
      </div>
      <p className="god-sheet__section-caption">{props.caption}</p>
      <div className="god-sheet__section-body">{props.children}</div>
    </div>
  );
}

/* ══════════════ ④ 名称输入（Kotlin L1038-1077） ══════════════ */

function GodTitleField(props: {
  value: string;
  placeholder: string;
  custom: boolean;
  onValueChange: (raw: string) => void;
  onResetDefault: () => void;
}) {
  return (
    <div className="god-sheet__titlefield">
      <div className="god-sheet__input-wrap">
        <input
          className="god-sheet__input"
          value={props.value}
          onChange={(event) => props.onValueChange(event.target.value)}
          placeholder={props.placeholder}
          aria-label="神回名称"
          maxLength={GOD_SHEET_TITLE_MAX}
        />
        {props.custom ? (
          <button
            type="button"
            className="god-sheet__reset"
            onClick={props.onResetDefault}
            aria-label="还原默认"
          >
            ↻
          </button>
        ) : null}
      </div>
      <span className="god-sheet__counter">
        {props.value.length}/{GOD_SHEET_TITLE_MAX}
      </span>
    </div>
  );
}

/* ══════════════ ⑤ 随笔输入（Kotlin L1079-1125） ══════════════ */

function GodNoteField(props: {
  value: string;
  onValueChange: (raw: string) => void;
  dark: boolean;
}) {
  // Kotlin 1086-1087：便签纸底色 + 横线色
  const paper = props.dark ? '#26282E' : '#FBF6E9';
  const line = props.dark ? 'rgba(255, 255, 255, 0.06)' : '#D9CDB4';
  return (
    <div className="god-sheet__note" style={{ background: paper }}>
      <div
        className="god-sheet__note-lines"
        aria-hidden="true"
        style={
          {
            backgroundImage: `repeating-linear-gradient(180deg, transparent 0 25px, ${line} 25px 26px)`,
          } as CSSProperties
        }
      />
      <textarea
        className="god-sheet__textarea"
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        placeholder="写下这一话为什么是神回……"
        aria-label="随笔"
        maxLength={GOD_SHEET_NOTE_MAX}
      />
      <span className="god-sheet__note-count">
        {props.value.length}/{GOD_SHEET_NOTE_MAX}
      </span>
    </div>
  );
}

/* ══════════════ ② 封面区（Kotlin L734-982） ══════════════ */

/** `GodTiltCover`（Kotlin L795-884）：按压拖动 → 3D 倾斜，松手弹簧回正。 */
function GodTiltCover(props: {
  previewUrl: string | null;
  loading: boolean;
  reduce: boolean;
  gold: readonly string[];
}) {
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [press, setPress] = useState(1);
  const lastRef = useRef({ x: 0, y: 0 });
  // Kotlin 831: `val maxTilt = 12f`
  const maxTilt = 12;
  // Kotlin 833-834：rotY = drag.x / 4dp，rotX = -drag.y / 6dp
  const dragDivX = 4;
  const dragDivY = 6;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.reduce) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastRef.current = { x: event.clientX, y: event.clientY };
    setPress(0.97);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.reduce) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    // ⚠️ Kotlin L830-835：`detectDragGestures { _, drag -> rotY.snapTo(drag.x / 4dp) … }`
    // 里的 `drag` 是**自上一个事件以来**的位移（Compose 逐事件给增量），
    // 不是从按下点算起的总位移。此前 TS 用 `clientX - startRef.x`（总量），
    // 结果是「按住不动就永远保持最大倾角」，与安卓的「停手即回正」不同。
    const dx = event.clientX - lastRef.current.x;
    const dy = event.clientY - lastRef.current.y;
    lastRef.current = { x: event.clientX, y: event.clientY };
    setRotY(Math.min(maxTilt, Math.max(-maxTilt, dx / dragDivX)));
    setRotX(Math.min(maxTilt, Math.max(-maxTilt, -dy / dragDivY)));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (props.reduce) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPress(1);
    setRotX(0);
    setRotY(0);
  };

  return (
    <div
      className="god-sheet__cover"
      style={{
        // Kotlin 842: `cameraDistance = 16f * density * 100f`（dp≈px → 1600px）
        transform: props.reduce
          ? undefined
          : `perspective(1600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${press})`,
        borderImageSource: `linear-gradient(90deg, ${props.gold[0]}, ${props.gold[1]}, ${props.gold[2]})`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="神回封面预览"
    >
      {props.previewUrl !== null ? (
        <img
          key={props.previewUrl}
          className="god-sheet__cover-img"
          src={props.previewUrl}
          alt="神回封面预览"
        />
      ) : props.loading ? (
        <span className="god-spinner" aria-label="加载中" />
      ) : (
        <span className="god-sheet__cover-empty">封面不可用</span>
      )}
    </div>
  );
}

/** `GodChipButton`（Kotlin L1269-1311）。 */
function GodChipButton(props: {
  text: string;
  icon: string;
  onClick: () => void;
  dark: boolean;
}) {
  return (
    <button
      type="button"
      className="god-chip"
      onClick={props.onClick}
      style={{ background: props.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.62)' }}
    >
      <span className="god-chip__icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="god-chip__text">{props.text}</span>
    </button>
  );
}

/** `GodPageThumb`（Kotlin L895-982）：52×70 缩略图 + 页码 + 状态。 */
function GodPageThumb(props: {
  ref_: GodPageRef;
  index: number;
  selected: boolean;
  thumbUrl: string | null;
  failed: boolean;
  onClick: () => void;
  dark: boolean;
}) {
  const indexLabel = `${props.index + 1}`;
  const state = props.thumbUrl !== null ? '已加载' : props.failed ? '加载失败，点按重试' : '加载中';
  return (
    <button
      type="button"
      className={['god-thumb', props.selected ? 'god-thumb--sel' : ''].filter(Boolean).join(' ')}
      onClick={props.onClick}
      aria-label={`第${indexLabel}页封面`}
      aria-description={state}
      style={
        props.selected
          ? { borderColor: '#F5B942', borderWidth: 2 }
          : { borderColor: 'rgba(24, 25, 28, 0.28)', borderWidth: 1 }
      }
    >
      {props.thumbUrl !== null ? (
        <img className="god-thumb__img" src={props.thumbUrl} alt="" />
      ) : (
        <span className="god-thumb__label">{indexLabel}</span>
      )}
      {props.thumbUrl !== null ? <span className="god-thumb__badge">{indexLabel}</span> : null}
    </button>
  );
}

/** `GodCoverSection`（Kotlin L734-791）。 */
function GodCoverSection(props: {
  previewUrl: string | null;
  loading: boolean;
  pages: readonly GodPageRef[];
  selected: number;
  albumSelected: boolean;
  initialPage: number;
  reduce: boolean;
  dark: boolean;
  thumbUrls: ReadonlyMap<string, string>;
  thumbFailed: ReadonlySet<string>;
  onPickPage: (index: number) => void;
  onPickAlbum: () => void;
  onCrop: () => void;
}) {
  const gold = godGoldGradient(props.dark);
  // Kotlin 749-750：只在打开时定位（点按可见候选不会把整排图片横向推走）
  const initialIndex = Math.min(
    Math.max(0, props.pages.length - 1),
    Math.max(0, props.selected >= 0 ? props.selected : props.initialPage),
  );

  return (
    <div className="god-sheet__coversec">
      <GodTiltCover
        previewUrl={props.previewUrl}
        loading={props.loading}
        reduce={props.reduce}
        gold={gold}
      />
      <div className="god-sheet__chips">
        <GodChipButton text="裁剪" icon="⛶" onClick={props.onCrop} dark={props.dark} />
        <GodChipButton
          text="从相册选择"
          icon="🖼"
          onClick={props.onPickAlbum}
          dark={props.dark}
        />
      </div>
      {props.pages.length > 0 ? (
        <div className="god-sheet__thumbs" role="list">
          {/* 只把 initialIndex 附近的页渲染进 DOM（LazyRow 的等价：窗口化） */}
          {props.pages.map((ref, index) => {
            if (Math.abs(index - initialIndex) > 8) return null;
            return (
              <div role="listitem" key={`${index}:${ref.id}`}>
                <GodPageThumb
                  ref_={ref}
                  index={index}
                  selected={!props.albumSelected && index === props.selected}
                  thumbUrl={props.thumbUrls.get(ref.id) ?? null}
                  failed={props.thumbFailed.has(ref.id)}
                  onClick={() => props.onPickPage(index)}
                  dark={props.dark}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════ ⑥ 吸底操作栏（Kotlin L1129-1261） ══════════════ */

/** `GodShineButton`（Kotlin L1175-1261）。 */
function GodShineButton(props: {
  text: string;
  loading: boolean;
  enabled: boolean;
  reduce: boolean;
  dark: boolean;
  onClick: () => void;
}) {
  const gold = godGoldGradient(props.dark);
  return (
    <button
      type="button"
      className={['god-shine', props.loading ? 'god-shine--loading' : ''].filter(Boolean).join(' ')}
      disabled={!props.enabled}
      onClick={() => {
        if (props.loading || !props.enabled) return;
        props.onClick();
      }}
      style={{
        background: `linear-gradient(90deg, ${gold[0]}, ${gold[1]}, ${gold[2]})`,
        ['--god-shine-ms' as string]: `${SHINE_MS}ms`,
      }}
    >
      {props.loading ? (
        <span className="god-spinner god-spinner--ink" aria-label="保存中" />
      ) : (
        <span className="god-shine__label">{props.text}</span>
      )}
    </button>
  );
}

function GodActionBar(props: {
  editing: boolean;
  saving: boolean;
  enabled: boolean;
  coverReady: boolean;
  reduce: boolean;
  dark: boolean;
  title: string;
  rating: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="god-sheet__actions">
      <div className="god-sheet__actions-row">
        <span className="god-sheet__actions-title">{props.title}</span>
        <span className="god-sheet__actions-rating">
          {/* Kotlin L1153：`Text("★ $rating", …)`，rating 是 Float →
              Kotlin `Float.toString()` 恒为一位小数（"5.0"）。 */}
          ★ {godRatingText(props.rating)}
        </span>
      </div>
      <div className="god-sheet__actions-row god-sheet__actions-row--btns">
        <button
          type="button"
          className="god-sheet__cancel"
          onClick={props.onCancel}
          disabled={!props.enabled}
        >
          取消
        </button>
        <GodShineButton
          text={props.editing ? '保存' : '添加到神回排行榜'}
          loading={props.saving}
          enabled={props.enabled && props.coverReady}
          reduce={props.reduce}
          dark={props.dark}
          onClick={props.onConfirm}
        />
      </div>
    </div>
  );
}

/* ══════════════ 保存成功动效（Kotlin L1315-1362） ══════════════ */

function GodBurstOverlay(props: { previewUrl: string | null; reduce: boolean }) {
  return (
    <div className="god-burst" aria-hidden="true">
      <span className="god-burst__rays" />
      <span className="god-burst__ring" />
      {props.previewUrl !== null ? (
        <img className="god-burst__cover" src={props.previewUrl} alt="" />
      ) : null}
    </div>
  );
}

/* ══════════════ 主组件（Kotlin L234-599） ══════════════ */

export interface GodMomentSheetProps {
  request: GodMomentRequest;
  /** 已有神回（该话已标记时自动进入编辑态）。null = 新建。 */
  existing: GodMoment | null;
  /** 预览 / 缩略图的可显示 URL（`GodCoverImageDecoder` 端口产物）。 */
  previewUrl: string | null;
  loadingCover: boolean;
  thumbUrls: ReadonlyMap<string, string>;
  thumbFailed: ReadonlySet<string>;
  /**
   * 相册选择 —— Kotlin `onPickAlbum`（L489-493）+ picker 结果回调（L325-335）。
   *
   * 宿主负责打开系统选择器（Android = `PickVisualMedia`；web/WKWebView =
   * `platform.documents.pickFile({ accept: 'image/*' })`），结果经 `onPicked` 回传：
   *   - `onPicked(uri)`：选定图片（Web 侧 uri = data URL）→ 本组件写回
   *     `CoverSource.Album(uri)` + `CropParams.DEFAULT`（Kotlin L332-333）；
   *   - `onPicked(null)`：用户取消 → Toast「未选择图片」（Kotlin L330）；
   *   - 同步抛错：打开失败 → Toast「无法打开相册」（Kotlin L492 的
   *     `runCatching { picker.launch(…) }.onFailure`）。
   */
  onPickAlbum: (onPicked: (uri: string | null) => void) => void;
  /** 保存（宿主负责裁剪合成 + 落库 + 派发 onSaved）。返回 Promise 时 doSave 等它完成再 burst。 */
  onSave: (input: {
    crop: CropParams;
    coverSourceTag: string;
    rating: number;
    title: string;
    titleIsCustom: boolean;
    note: string;
  }) => void | Promise<void>;
  /**
   * 裁剪屏的源图 URL。Kotlin L588-598 传的是 `sourceBitmap`（**原图**，
   * `GodCoverEngine.loadUri` 的产物），不是 450×600 的合成预览；宿主在相册
   * 选图后必须把原图 data URL 传进来，否则裁剪框是在已模糊/加框的预览上取景。
   * 缺省退回 `previewUrl`（编辑既有神回时两者同源：退化用已合成封面做底图，
   * GodMomentSheet.kt L288-289）。
   */
  cropSourceUrl?: string | null;
  /**
   * 裁剪确认后的回调（Kotlin L594 `setCrop(newCrop)` 之后由
   * `LaunchedEffect(sourceBitmap, crop)` 重合成预览；TS 侧预览归宿主，
   * 宿主借此用新 crop 重跑 `applyCropWeb + composeGodCoverWeb`）。
   * 第二参是**当前** coverSource tag —— 宿主据此解析 sourceBitmap
   * （本会话相册 blob / 既有 album data URL），不依赖渲染期读到的新值。
   */
  onCropApplied?: (crop: CropParams, coverSourceTag: string) => void;
  onDismiss: () => void;
  onSaved?: (moment: GodMoment) => void;
  reduceMotion?: boolean;
  className?: string;
}

export function GodMomentSheet(props: GodMomentSheetProps) {
  const { request, existing } = props;
  const editing = existing !== null;
  // Kotlin 246 `val dark = godIsDark()`（GodMotion.kt L142-143：按 App 背景真实亮度判定）
  const dark = godIsDark();
  const reduce = props.reduceMotion ?? false;

  /* ── 表单状态（Kotlin L252-272：rememberSaveable → useState） ── */
  const [coverSourceTag, setCoverSourceTag] = useState(() =>
    godSheetInitialCoverTag(existing, request, coverSourceToTag),
  );
  // Kotlin L261：`rememberSaveable { mutableStateOf((existing?.crop ?: CropParams.DEFAULT).toTag()) }`
  // —— `existing.crop` 是 `CropParams.parse(cropParams)`（归一化后的对象），
  // 所以初值要过一遍 parse → toTag，而不是直接沿用原始字符串。
  const [cropTag, setCropTag] = useState(() =>
    existing !== null
      ? cropParamsToTag(parseCropParams(existing.cropParams))
      : cropParamsToTag(DEFAULT_CROP_PARAMS),
  );
  const [rating, setRating] = useState(() => godSheetInitialRating(existing));
  const [{ titleCustom, titleText }, setTitle] = useState(() =>
    godSheetInitialTitleState(existing),
  );
  const [note, setNote] = useState(() => existing?.note ?? '');
  const [coverRetry, setCoverRetry] = useState(0);
  const [showCrop, setShowCrop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [burst, setBurst] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // Kotlin 258：局部变量不能带 getter —— 每次渲染从 tag 解析（纯函数，成本可忽略）
  const coverSource = resolveCoverSource(coverSourceTag);
  // Kotlin 262：`CropParams.parse(cropTag)`（复用 godTypes 的 `parseCropParams`）
  const crop = parseCropParams(cropTag);

  const defaultTitle = godSheetDefaultTitle(request);
  const shownTitle = godSheetShownTitle(titleCustom, titleText, defaultTitle);

  // Kotlin 337-346（⚠️ `cropTag` 传的是 `CropParams.parse(cropTag).toTag()` 的结果 ——
  // Kotlin L344 比的是 `crop.toTag()`，而 `crop` 已在 L262 归一化过）
  const dirty = godSheetIsDirty({
    existing,
    rating,
    titleCustom,
    titleText,
    note,
    coverSourceTag,
    cropTag: godSheetNormalizedCropTag(cropTag, parseCropParams, cropParamsToTag),
    request,
    comicPageTag: (pageIndex: number) =>
      coverSourceToTag({ kind: 'comicPage', pageIndex, pageId: '' }),
  });

  /* ── 保存（Kotlin L349-383） ── */
  const doSave = useCallback(() => {
    // Kotlin L350：`if (saving || loadingCover || sourceBitmap == null) return`
    // —— 三个门都要有；少了第三个会在位图为空时把空裁剪提交出去。
    if (saving || props.loadingCover || props.previewUrl === null) return;
    setSaving(true);
    // Kotlin L349-381 本来就是协程顺序：裁剪合成 + 落库**完成后**才
    // `burst = true` → `delay(620)` → `onSaved()`。宿主的 Canvas 合成是异步的
    // （E18 相册选图后保存要跑 applyCropWeb + composeGodCoverWeb），这里用
    // Promise 串起来 —— 此前「同步调 onSave + 定时器」会让关窗跑在落库前面。
    void Promise.resolve(
      props.onSave({
        crop,
        coverSourceTag,
        rating,
        title: titleCustom ? titleText : defaultTitle,
        titleIsCustom: titleCustom,
        note,
      }),
    ).then(
      () => {
        // Kotlin 379-381：burst = true → delay(620) → onSaved
        setBurst(true);
        window.setTimeout(() => {
          const saved = props.onSaved;
          if (saved !== undefined) {
            saved(
              findGodMoment(request.bookId, request.chapterId) ??
                buildEntity(request, {
                  title: titleCustom ? titleText : defaultTitle,
                  titleIsCustom: titleCustom,
                  rating,
                  note,
                  coverSourceTag,
                  cropTag,
                }),
            );
          }
        }, SAVE_BURST_DELAY_MS);
      },
      () => {
        // 宿主 onSave 不应 reject（Kotlin L355 合成失败有 `?: existing?.coverPath`
        // 兜底）；这里只是「不能把面板永久卡在 saving」的保险丝。
        setSaving(false);
      },
    );
  }, [
    coverSourceTag,
    crop,
    cropTag,
    defaultTitle,
    note,
    props,
    rating,
    request,
    saving,
    titleCustom,
    titleText,
  ]);

  const requestCancel = (): void => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else props.onDismiss();
  };

  /* Kotlin 481-487：重选同一页且当前没图 → 强制重解码 */
  const pickPage = (index: number): void => {
    const next = godSheetPickPage({
      currentSource: coverSource,
      pageIndex: index,
      loading: props.loadingCover,
      hasBitmap: props.previewUrl === null,
    });
    if (next.retry > 0) setCoverRetry(next.retry);
    setCoverSourceTag(coverSourceToTag(next.coverSource));
    // Kotlin L486：`setCrop(CropParams.DEFAULT)`
    setCropTag(cropParamsToTag(DEFAULT_CROP_PARAMS));
  };

  /* Kotlin 495-498：只有解码出位图才允许进裁剪 */
  const openCrop = (): void => {
    if (props.previewUrl !== null) setShowCrop(true);
    else showToast('封面尚未就绪');
  };

  /* Kotlin 325-335：picker 结果回调（就在本组件里）——
     `uri == null`（用户取消）→ Toast「未选择图片」；
     否则 `setCoverSource(CoverSource.Album(uri))` + `setCrop(CropParams.DEFAULT)`。
     宿主只负责打开选择器，选中/取消经 `props.onPickAlbum(onPicked)` 回传。 */
  const applyPickedAlbum = useCallback((uri: string | null): void => {
    if (uri === null) {
      showToast(GOD_TOAST_NO_IMAGE);
      return;
    }
    setCoverSourceTag(coverSourceToTag({ kind: 'album', uri }));
    // Kotlin L333：`setCrop(CropParams.DEFAULT)`
    setCropTag(cropParamsToTag(DEFAULT_CROP_PARAMS));
  }, [setCoverSourceTag, setCropTag]);

  const prism = godPrismColors(dark);
  const albumSelected = coverSource.kind === 'album';
  const selected = coverSource.kind === 'comicPage' ? coverSource.pageIndex : -1;

  // Kotlin 278-281 的 `remember(coverSourceTag, coverRetry, request.pages,
  // existing?.coverPath)` 键 —— 换来源时旧请求 / 旧合成结果不能冒充新页。
  // TS 侧把它算成 `data-cover-key` 挂在根节点：宿主可以
  //   document.querySelector('.god-sheet')?.dataset.coverKey
  // 或更直接地在自己解码的 effect 里用同一份 `coverSourceTag` + `coverRetry` 做依赖。
  const coverLoadKey = `${coverSourceTag}#${coverRetry}#${request.pages
    .map((page) => page.id)
    .join(',')}#${existing?.coverPath ?? ''}#${godBindingNeedsRemoteLoader(request.pages) ? 1 : 0}`;

  return (
    <div className="god-sheet" data-cover-key={coverLoadKey} data-dirty={dirty ? '1' : '0'}>
      {/* 背景遮罩（Kotlin L386-402：径向聚光 scrim + 点击关闭） */}
      <div
        className="god-sheet__scrim"
        onClick={requestCancel}
        role="presentation"
        aria-hidden="true"
      />

      {/* Sheet 表面（Kotlin L405-417） */}
      <div
        className="god-sheet__panel"
        style={
          {
            height: `${GOD_SHEET_HEIGHT_FRACTION * 100}%`,
            borderTopLeftRadius: SHEET_CORNER,
            borderTopRightRadius: SHEET_CORNER,
            ['--god-prism' as string]: prism.join(', '),
          } as CSSProperties
        }
        role="dialog"
        aria-modal="true"
        aria-label={editing ? '编辑神回' : '新建神回'}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') requestCancel();
        }}
      >
        {/* 下拉把手（Kotlin L419-431：44×5 胶囊） */}
        <div className="god-sheet__grip" aria-hidden="true" />

        {/* 可滚动内容（Kotlin L433-459：底部 44dp 渐隐） */}
        <div className="god-sheet__scroll">
          {/* ① 标题（Kotlin L461-469） */}
          <GodSheetBlock index={0} reduce={reduce}>
            <GodSheetTitle
              editing={editing}
              reduce={reduce}
              dark={dark}
              bookTitle={request.bookTitle}
              chapterTitle={request.chapterTitle}
            />
          </GodSheetBlock>

          {/* ② 封面（Kotlin L473-500） */}
          <GodSheetBlock index={1} reduce={reduce}>
            <div className="god-sheet__gap14">
              <GodCoverSection
                previewUrl={props.previewUrl}
                loading={props.loadingCover}
                pages={request.pages}
                selected={selected}
                albumSelected={albumSelected}
                initialPage={request.initialPageIndex}
                reduce={reduce}
                dark={dark}
                thumbUrls={props.thumbUrls}
                thumbFailed={props.thumbFailed}
                onPickPage={pickPage}
                onPickAlbum={() => {
                  // Kotlin L489-493：
                  // `runCatching { picker.launch(…) }.onFailure {
                  //     Toast.makeText(context, "无法打开相册", Toast.LENGTH_SHORT).show() }`
                  try {
                    props.onPickAlbum(applyPickedAlbum);
                  } catch {
                    showToast(GOD_TOAST_OPEN_FAILED);
                  }
                }}
                onCrop={openCrop}
              />
            </div>
          </GodSheetBlock>

          {/* ③ 评分（Kotlin L504-513） */}
          <GodSheetBlock index={2} reduce={reduce}>
            <div className="god-sheet__gap18">
              <GodFormSection
                number="01"
                title="为这一话打分"
                caption="半星也能准确表达喜欢的程度"
                dark={dark}
              >
                <GodStarRatingEditable
                  rating={rating}
                  onRatingChange={setRating}
                  reduceMotion={reduce}
                />
              </GodFormSection>
            </div>
          </GodSheetBlock>

          {/* ④ 名称（Kotlin L517-535） */}
          <GodSheetBlock index={3} reduce={reduce}>
            <div className="god-sheet__gap18">
              <GodFormSection
                number="02"
                title="留下它的名字"
                caption="留空时自动使用书名和章节号"
                dark={dark}
              >
                <GodTitleField
                  value={titleCustom ? titleText : ''}
                  placeholder={defaultTitle}
                  custom={titleCustom}
                  onValueChange={(raw) => setTitle(godSheetTitleChanged(raw))}
                  onResetDefault={() => setTitle({ titleCustom: false, titleText: '' })}
                />
              </GodFormSection>
            </div>
          </GodSheetBlock>

          {/* ⑤ 随笔（Kotlin L539-547） */}
          <GodSheetBlock index={4} reduce={reduce}>
            <GodFormSection number="03" title="这一刻的想法" caption="写给下次重读的自己" dark={dark}>
              <GodNoteField
                value={note}
                onValueChange={(raw) => setNote(godSheetNoteChanged(raw))}
                dark={dark}
              />
            </GodFormSection>
          </GodSheetBlock>

          {/* 底部留白（Kotlin L550：34dp） */}
          <div className="god-sheet__gap34" aria-hidden="true" />
        </div>

        {/* ⑥ 吸底操作栏（Kotlin L554-570） */}
        <GodActionBar
          editing={editing}
          saving={saving}
          enabled={!saving}
          coverReady={!props.loadingCover && props.previewUrl !== null}
          reduce={reduce}
          dark={dark}
          title={shownTitle}
          rating={rating}
          onCancel={requestCancel}
          onConfirm={doSave}
        />
      </div>

      {/* 保存成功（Kotlin L575-577） */}
      {burst ? <GodBurstOverlay previewUrl={props.previewUrl} reduce={reduce} /> : null}

      {/* 未保存修改二次确认（Kotlin L580-585） */}
      {confirmClose ? (
        <GodDialog
          title="放弃这次编辑？"
          confirmLabel="放弃"
          confirmDanger
          onConfirm={() => {
            setConfirmClose(false);
            props.onDismiss();
          }}
          dismissLabel="继续编辑"
          onDismiss={() => setConfirmClose(false)}
        >
          已经改过的内容不会保存。
        </GodDialog>
      ) : null}

      {/* 裁剪全屏页（Kotlin L588-598） */}
      {showCrop ? (
        <GodCoverCropPage
          // Kotlin L588-598：裁剪屏拿到的是 `sourceBitmap`（**原图**，
          // `GodCoverEngine.loadUri` 的产物），不是 450×600 的合成预览 ——
          // 相册选图后宿主经 `cropSourceUrl` 传原图 data URL。
          source={props.cropSourceUrl ?? props.previewUrl}
          sourceUrl={props.cropSourceUrl ?? props.previewUrl}
          // 宿主不知道原图像素；裁剪页会在 <img onLoad> 里读 naturalWidth/Height，
          // 这两个 0 只是兜底（传 0 时 fitRect 会退化成 null = 裁剪框失效）。
          sourceWidth={0}
          sourceHeight={0}
          initialCrop={crop}
          onCancel={() => setShowCrop(false)}
          onConfirm={(next) => {
            // Kotlin L594：`setCrop(newCrop)` → `CropParams.toTag()`（GodMomentModels.kt L135-137）
            setCropTag(cropParamsToTag(next));
            setShowCrop(false);
            // Kotlin L594 之后由 `LaunchedEffect(sourceBitmap, crop)` 重合成预览；
            // TS 侧预览归宿主，经此回调触发同一效果（E18，2026-10-11）。
            // 第二参带当前 tag：宿主解析 sourceBitmap 用，避免读渲染期闭包旧值。
            props.onCropApplied?.(next, coverSourceTag);
          }}
        />
      ) : null}
    </div>
  );
}

/* ══════════════ 辅助 ══════════════ */

/** Kotlin 360-377 的实体构造（`onSaved` 兜底用，宿主未回传时）。 */
function buildEntity(
  request: GodMomentRequest,
  form: {
    title: string;
    titleIsCustom: boolean;
    rating: number;
    note: string;
    coverSourceTag: string;
    cropTag: string;
  },
): GodMoment {
  return {
    id: 0,
    contentType: request.contentType,
    bookId: request.bookId,
    chapterId: request.chapterId,
    bookTitle: request.bookTitle,
    chapterTitle: request.chapterTitle,
    chapterNumber: request.chapterNumber,
    title: form.title,
    titleIsCustom: form.titleIsCustom,
    rating: form.rating,
    note: form.note,
    coverPath: null,
    coverSource: form.coverSourceTag,
    cropParams: form.cropTag,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 供 `GodMomentEditHost`（GodReaderBinding.kt L141-183）组合时传入的上下文构造。 */
export function godSheetContext(
  request: GodMomentRequest,
  pages: readonly GodPageRef[],
): { request: GodMomentRequest; pages: readonly GodPageRef[] } {
  return { request, pages };
}

export type { GodMomentContext, GodMomentRequest, GodPageRef };

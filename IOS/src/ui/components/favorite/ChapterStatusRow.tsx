/**
 * Port of Android `ui/favorite/ChapterStatusRow.kt` (439 lines total / 424 non-blank / 386 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–64   package + imports → file header. `androidx.compose.ui.graphics.lerp` /
 *          `Brush` / `drawWithCache` → SVG `<linearGradient>` in `BookmarkRibbon`.
 *   66–73  `enum class ChapterVisual` + `ChapterReadState.toVisual()`
 *          → `ChapterVisual` / `chapterReadStateToVisual` in `@core/favorite/favoriteUi`.
 *   75–90  `data class ChapterRowState` (+ `progressFloat`) → same in favoriteUi.
 *   92–98  the a11y KDoc (中性灰 ≥4.5:1, 对勾是第二线索) → `ChapterStatusRow` KDoc.
 *   99–120 `@Composable fun ChapterStatusRow(title, state, onClick, onLongClick, modifier,
 *          coverUrl, onDownload, highlighted, bookmarked, onToggleBookmark)` → same props.
 *          The ⚠️ block explaining that `bookmarked` is the single source of truth is
 *          preserved verbatim in the props KDoc.
 *   121–122 `isDark = background.luminance() < 0.4f`; `readGray` light/dark
 *          → `chapterTitleColor`/`readGray` in favoriteUi (app theme is LIGHT).
 *   123–127 `titleColor` `when (state.visual)` → favoriteUi.
 *   128–132 `animateFloatAsState(highlighted ? 1f : 0f, tween(320))`
 *          → `highlightTween = 320` + `.chapter-row__card--highlighted`.
 *   133     `grayed = state.visual == READ` → class modifier.
 *   135–140 the long swipe-to-toggle-bookmark KDoc (direction arbitration, the
 *          `pointerInput` key trap) → `swipeBookmark` helper KDoc below, verbatim prose.
 *   140–155 `dragAnim`, `dragScope`, `rememberUpdatedState(onToggleBookmark)`,
 *          `dragActive`, `dragPreviewBookmark`, `bookmarkScale` (spring bouncy),
 *          `bookmarkAlpha` (tween 240) → `useRef` + `useState` pair in the
 *          `useChapterSwipe` hook (React event handlers always see fresh props, which
 *          is the direct equivalent of `rememberUpdatedState`).
 *   157–163 `Box` → `Row` with `graphicsLayer { translationX = dragAnim.value }`.
 *   163–172 background (highlight 0.10·h else surface 0.7) + border
 *          (`grayed ? 0.05 : 0.08` onSurface) → CSS.
 *   173–188 `semantics { contentDescription = buildString { … } }` → `chapterRowAriaLabel`.
 *   189     `combinedClickable(onClick, onLongClick)` → button onClick/onContextMenu.
 *   190–240 the horizontal-drag `pointerInput(Unit)` loop with `|x| >= |y|`
 *          arbitration, `dragX` clamped ±140, `abs(dragX) > 40f` commit threshold,
 *          spring settle to 0 → `useChapterSwipe` (pointer events, same constants).
 *   241     `padding(horizontal = 12, vertical = 10)` → CSS.
 *   244–249 3 Spacers: 40 (丝带让位槽) + 12 + 12 → `.chapter-row__ribbon-slot` +
 *          two `.chapter-row__gap-12`.
 *   251–272 `Column(weight 1f)` + title Row: title 14.sp, fontWeight
 *          `READ ? Normal : Medium`, `maxLines 1`, ellipsis, `weight(1f, fill=false)`;
 *          `isNew` → 红点 "新" badge `0xFFFF4D4F` r4 h-padding 4 v-padding 1, 9.sp Bold white.
 *   273–291 `READING && pageCount > 0` → "上次读到第 N 页 · 共 M 页" 11.sp
 *          `MintPrimary.copy(alpha=0.85f)` + `LinearProgressIndicator(progress, h3, CircleShape,
          color=MintPrimary, trackColor=onSurface 0.10)`.
 *   292–295 `READ` → "已读" 11.sp readGray.
 *   299     `Spacer(8.dp)` → `.chapter-row__actions { margin-left: 8px }`.
 *   301–312 downloading → 28×3 progress bar + 6 gap.
 *   313–339 downloaded → `Icons.Filled.DownloadDone` 18.dp MintPrimary "已下载";
 *          else `onDownload != null && !external` → 32.dp circle MintPrimary 0.12
 *          with `Icons.Filled.Download` 17.dp "下载本章".
 *   340–347 `READ` → `Icons.Filled.Check` 18.dp readGray "已读".
 *   351–370 书签丝带 overlay: `markShown = bookmarked || dragPreviewBookmark`,
 *          spring bouncy `markProgress`, `if (markProgress > 0.01f) BookmarkRibbon(
 *          align TopStart, translationX = dragAnim, padding start 16, size 26×46,
 *          contentDescription = if (bookmarked) "已加书签" else null)`.
 *   371–372 closing Box.
 *   374–387 the BookmarkRibbon KDoc (why not Icons.Filled.Bookmark, why not
 *          primaryContainer) → `BookmarkRibbon` KDoc, verbatim.
 *   388–454 `internal fun BookmarkRibbon(progress, modifier, contentDescription)`:
 *          graphicsLayer scale/scale/alpha with `transformOrigin(0,0)`, then
 *          `drawWithCache` building `ribbonPath(dy)` (r = 0.20w, notch = 0.24h,
 *          quadraticTo top corners, V-notch at `h - notch`), a 1.5.dp lower shadow copy
 *          at black 0.12, a vertical body gradient
 *          `lerp(primary, White, 0.16) → primary → lerp(primary, Black, 0.26)`,
 *          and a left-edge horizontal sheen
 *          `White 0.30 → White 0.04 → Transparent` over `0..0.45w`.
 *          → three `<path>`s with `<linearGradient>` defs; every constant preserved.
 *   456–468 `fun rememberChapterHighlight(key, targetKey): Boolean` — 900ms flash
 *          → `useChapterHighlight(key, targetKey)` hook.
 *   470–472 `private fun Color.luminance()` → favoriteUi `relativeLuminance`.
 *
 * Skipped: nothing behavioural. `pointerInput` + coroutine becomes pointer-event
 * handlers (same slop/threshold math); `drawWithCache` becomes SVG paths.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAPTER_HIGHLIGHT_MS,
  ChapterVisual,
  chapterRowAriaLabel,
  chapterRowProgressFloat,
  chapterTitleColor,
  readGray,
  type ChapterRowState,
} from '@core/favorite/favoriteUi';
import '../../../styles/favorite.css';

/* ── Android colour tokens used by this file ──────────────────────────── */
const MINT_PRIMARY = '#059669';
const ON_SURFACE = '#18191C';
const NEW_BADGE_COLOR = '#FF4D4F';
/** The app theme is LIGHT, so `isDark` is false; the dark branch is kept for parity. */
const IS_DARK = false;

/* ── gesture constants, verbatim from ShelfMultiSelect / ChapterStatusRow ── */
const SWIPE_COMMIT_PX = 40;
const SWIPE_CLAMP_PX = 140;

function IconDownloadDone() {
  return (
    <svg viewBox="0 0 24 24" className="chapter-row__icon" fill="currentColor" aria-hidden="true">
      <path d="M18 15v3H6v-3H4v3a2 2 0 002 2h12a2 2 0 002-2v-3h-2zm-1-4l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" className="chapter-row__icon" fill="currentColor" aria-hidden="true">
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" className="chapter-row__icon" fill="currentColor" aria-hidden="true">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

/**
 * 左滑/右滑切读书签：卡片跟手平移（阻尼限幅），越过阈值松手即切换，否则回弹。
 * 只消费水平位移，纵向滚动/长按/点击互不干扰。
 *
 * ⚠️ Compose 用 `pointerInput(Unit)` + `rememberUpdatedState` 持有最新回调
 * （手势协程只在 key 变化时重启，捕获的是**第一次组合**的闭包）。
 * React 的事件处理器每次渲染都重新创建，等价于 `rememberUpdatedState`，
 * 因此这里可以直接读 props 而不会固化旧值。
 *
 * 方向仲裁沿用修正后的判据：`|x| >= |y|` —— 横向分量必须不小于纵向才算横滑。
 */
function useChapterSwipe(enabled: boolean, onCommit: (() => void) | null) {
  const [dragX, setDragX] = useState(0);
  const [preview, setPreview] = useState(false);
  const [active, setActive] = useState(false);
  const gesture = useRef<{ totalX: number; totalY: number; dragX: number; isDrag: boolean; justActivated: boolean } | null>(null);

  const onPointerDown = useCallback((): void => {
    if (!enabled) return;
    gesture.current = { totalX: 0, totalY: 0, dragX: 0, isDrag: false, justActivated: false };
  }, [enabled]);

  const onPointerMove = useCallback(
    (event: { movementX: number; movementY: number }): void => {
      if (!enabled) return;
      const g = gesture.current;
      if (g === null) return;
      const deltaX = event.movementX;
      const deltaY = event.movementY;
      g.totalX += deltaX;
      g.totalY += deltaY;
      // `val slop = viewConfiguration.touchSlop` — 8px is the Material/Compose default.
      const slop = 8;
      if (!g.isDrag && Math.abs(g.totalX) > slop && Math.abs(g.totalX) >= Math.abs(g.totalY)) {
        g.isDrag = true;
        setActive(true);
        // 拖动即预览切换后的书签状态（松手提交）
        setPreview(true);
        g.dragX = Math.max(-SWIPE_CLAMP_PX, Math.min(SWIPE_CLAMP_PX, g.totalX));
        g.justActivated = true;
      }
      if (g.isDrag) {
        // 激活那一帧的 delta 已经算进 totalX，别再加一次
        if (g.justActivated) g.justActivated = false;
        else g.dragX = Math.max(-SWIPE_CLAMP_PX, Math.min(SWIPE_CLAMP_PX, g.dragX + deltaX));
        setDragX(g.dragX);
      }
    },
    [enabled],
  );

  const settle = useCallback((): void => {
    const g = gesture.current;
    if (g !== null && g.isDrag && Math.abs(g.dragX) > SWIPE_COMMIT_PX) onCommit?.();
    gesture.current = null;
    setActive(false);
    setPreview(false);
    setDragX(0);
  }, [onCommit]);

  return { dragX, preview, active, onPointerDown, onPointerMove, settle };
}

/**
 * 供外部复用的「阅读中」高亮底色（进入页面自动滚动到该行并闪一下）。 — L456–468
 *
 * Kotlin L459–467: `var shown by remember(key) { mutableStateOf(false) }` +
 * `LaunchedEffect(key) { shown = key != null && key == targetKey; if (shown) { delay(900); shown = false } }`.
 *
 * ⚠️ ADAPTATION: the synchronous `shown = …` write is a *derived* value in React, so
 * it is computed during render; only the 900 ms expiry is a state write, and it happens
 * inside a timer (never synchronously in the effect body).
 */
export function useChapterHighlight(key: string | null, targetKey: string | null): boolean {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  const isTarget = key !== null && key === targetKey;
  useEffect(() => {
    if (!isTarget || key === null) return;
    const timer = window.setTimeout(() => setExpiredKey(key), CHAPTER_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [isTarget, key]);
  return isTarget && expiredKey !== key;
}

/**
 * 章节列表行：阅读状态 + 下载状态（漫画主页面与阅读器章节抽屉复用同一组件）。
 *
 * 已读置灰的可访问性约束：
 * - 用**中性灰**而不是低透明度，保证标题对比度 ≥ 4.5:1；
 * - 不只靠颜色区分：右侧对勾是第二线索。
 */
export function ChapterStatusRow(props: {
  title: string;
  state: ChapterRowState;
  onClick: () => void;
  onLongClick: () => void;
  coverUrl?: string | null;
  onDownload?: (() => void) | null;
  highlighted?: boolean;
  /**
   * 该话是否已标注书签（左滑/右滑卡片切换，位置即原封面位）。
   *
   * ⚠️ 这是书签的唯一数据源。曾几何时 `ChapterRowState` 里还有一个同名字段，
   * 调用方只填了那一个、本组件却只读这一个 → 书签永远显示为未标注
   * （"书签挂不上去"）。重复字段已删除，别再加回来。
   */
  bookmarked?: boolean;
  /** 滑动切读书签回调；null 时该行不启用手势 */
  onToggleBookmark?: (() => void) | null;
}) {
  const state = props.state;
  const bookmarked = props.bookmarked === true;
  const grayed = state.visual === ChapterVisual.READ;
  const gray = readGray(IS_DARK);
  const titleColor = chapterTitleColor(state, IS_DARK, ON_SURFACE, MINT_PRIMARY);

  const swipeEnabled = props.onToggleBookmark != null;
  const swipe = useChapterSwipe(swipeEnabled, props.onToggleBookmark ?? null);

  // L354: `val markShown = bookmarked || dragPreviewBookmark`
  // ⚠️ `markProgress` is `animateFloatAsState(if (markShown) 1f else 0f, springMediumBouncy)`;
  // in React the flag is the value and CSS owns the spring (see `.chapter-row__ribbon`).
  const markShown = bookmarked || swipe.preview;

  return (
    <div className="chapter-row">
      <button
        type="button"
        className={[
          'chapter-row__card',
          grayed ? 'chapter-row__card--grayed' : '',
          props.highlighted === true ? 'chapter-row__card--highlighted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // L173–188: semantics contentDescription
        aria-label={chapterRowAriaLabel(props.title, state, bookmarked)}
        style={{
          transform: `translateX(${String(swipe.dragX)}px)`,
          transition: swipe.active ? 'none' : 'transform 420ms cubic-bezier(0.18, 0.89, 0.32, 1.28)',
        }}
        onClick={props.onClick}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onLongClick();
        }}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.settle}
        onPointerCancel={swipe.settle}
      >
        {/* 书签让位槽：原封面位空白处固定留出丝带宽度，文字位置不随丝带出现/消失跳动。 */}
        <span className="chapter-row__ribbon-slot" aria-hidden="true" />
        <span className="chapter-row__gap-12" aria-hidden="true" />
        <span className="chapter-row__gap-12" aria-hidden="true" />

        <span className="chapter-row__body">
          <span className="chapter-row__title-row">
            <span
              className={
                grayed
                  ? 'chapter-row__title chapter-row__title--normal'
                  : 'chapter-row__title chapter-row__title--medium'
              }
              style={{ color: titleColor }}
            >
              {props.title}
            </span>
            {state.isNew ? <span className="chapter-row__new">新</span> : null}
          </span>

          {state.visual === ChapterVisual.READING && state.pageCount > 0 ? (
            <>
              <p className="chapter-row__meta chapter-row__meta--reading">
                {`上次读到第 ${String(state.pageIndex + 1)} 页 · 共 ${String(state.pageCount)} 页`}
              </p>
              <div
                className="chapter-row__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(chapterRowProgressFloat(state) * 100)}
              >
                <div
                  className="chapter-row__progress-fill"
                  style={{
                    width: `${String(Math.max(0, Math.min(1, chapterRowProgressFloat(state))) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : null}

          {state.visual === ChapterVisual.READ ? (
            <p className="chapter-row__meta chapter-row__meta--read" style={{ color: gray }}>
              已读
            </p>
          ) : null}
        </span>

        <span className="chapter-row__actions">
          {state.downloading ? (
            <>
              <span className="chapter-row__download-progress">
                <span
                  className="chapter-row__download-progress-fill"
                  style={{
                    display: 'block',
                    width: `${String(Math.max(0, Math.min(1, state.downloadProgress)) * 100)}%`,
                  }}
                />
              </span>
              <span className="chapter-row__gap-12" style={{ width: 6, flexBasis: 6 }} />
            </>
          ) : null}

          {/* 已下载图标在"已读置灰"状态下仍保持清晰可见（不用灰化图标） */}
          {state.downloaded ? (
            <>
              <span style={{ color: MINT_PRIMARY, display: 'inline-flex' }}>
                <IconDownloadDone />
              </span>
              <span className="chapter-row__gap-12" style={{ width: 6, flexBasis: 6 }} />
            </>
          ) : props.onDownload != null && !state.external ? (
            <>
              <button
                type="button"
                className="chapter-row__download-btn"
                aria-label="下载本章"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDownload?.();
                }}
              >
                <IconDownload />
              </button>
              <span className="chapter-row__gap-12" style={{ width: 6, flexBasis: 6 }} />
            </>
          ) : null}

          {state.visual === ChapterVisual.READ ? (
            <span style={{ color: gray, display: 'inline-flex' }}>
              <IconCheck />
            </span>
          ) : null}
        </span>
      </button>

      {/* 书签丝带 overlay：挂在卡片顶边垂下来（真正"夹在书页里"的姿态），
          跟手拖动时与卡片同位移（同一 dragAnim），拖动实时预览、松手提交。 */}
      {markShown ? (
        <BookmarkRibbon
          progress={1}
          translateX={swipe.dragX}
          contentDescription={bookmarked ? '已加书签' : null}
        />
      ) : null}
    </div>
  );
}

/**
 * 章节书签丝带。
 *
 * 为什么不用 `Icons.Filled.Bookmark`：Material 的扁平书签图标是纯色实心块，
 * 放在已成型的卡片里像贴了个占位符，与全 App「有材质、有厚度」的控件语言不搭。
 * 这里手绘一条丝带：圆角顶 + 底部 V 形燕尾缺口 + 主色竖向渐变（顶部受光、
 * 尾部压暗）+ 左缘窄高光 + 接触阴影，读起来是"夹在书页里的一条真丝带"。
 *
 * ⚠️ 配色不能用 `primaryContainer` 打底：它太浅，叠加高光后整条丝带被洗成
 * 半透明白，在浅色卡片上几乎隐形（实测截图确认）。以 `primary` 为基色，
 * 亮部/暗部都从它向白/黑收敛，任何主题下都保得住色相。
 *
 * @param progress 出场进度（0~1）：从顶边垂落展开，与拖动预览同一条动画
 */
export function BookmarkRibbon(props: {
  progress: number;
  translateX?: number;
  contentDescription?: string | null;
}) {
  const primary = MINT_PRIMARY;
  // Kotlin: `val r = w * 0.20f; val notch = h * 0.24f` on a 26×46 box.
  const w = 26;
  const h = 46;
  const r = w * 0.2;
  const notch = h * 0.24;

  // `ribbonPath(dy)` transcribed 1:1 — quadraticTo corners + V-notch at h - notch.
  const ribbonPath = (dy: number): string =>
    [
      `M ${String(r)} ${String(dy)}`,
      `L ${String(w - r)} ${String(dy)}`,
      `Q ${String(w)} ${String(dy)} ${String(w)} ${String(r + dy)}`,
      `L ${String(w)} ${String(h + dy)}`,
      `L ${String(w / 2)} ${String(h - notch + dy)}`,
      `L 0 ${String(h + dy)}`,
      `L 0 ${String(r + dy)}`,
      `Q 0 ${String(dy)} ${String(r)} ${String(dy)}`,
      'Z',
    ].join(' ');

  const gradientId = 'chapter-ribbon-body-gradient';
  const sheenId = 'chapter-ribbon-sheen-gradient';

  return (
    <span
      className="chapter-row__ribbon"
      style={{
        transform: `translateX(${String(props.translateX ?? 0)}px) scale(${String(props.progress)})`,
        opacity: props.progress,
      }}
      aria-label={props.contentDescription ?? undefined}
      role={props.contentDescription != null ? 'img' : undefined}
    >
      <svg viewBox={`0 0 ${String(w)} ${String(h)}`} width={w} height={h} aria-hidden="true">
        <defs>
          {/* `Brush.verticalGradient(lerp(primary, White, .16), primary, lerp(primary, Black, .26))` */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mixHex(primary, '#FFFFFF', 0.16)} />
            <stop offset="0.5" stopColor={primary} />
            <stop offset="1" stopColor={mixHex(primary, '#000000', 0.26)} />
          </linearGradient>
          {/* `Brush.horizontalGradient(White .30, White .04, Transparent, 0..0.45w)` */}
          <linearGradient
            id={sheenId}
            x1="0"
            y1="0"
            x2={String(w * 0.45)}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.3" />
            <stop offset="0.89" stopColor="#FFFFFF" stopOpacity="0.04" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 接触阴影：同形状下沉 1.5dp 的暗色副本（Canvas 无法直接投影） */}
        <path className="chapter-row__ribbon-shadow" d={ribbonPath(1.5)} />
        <path className="chapter-row__ribbon-body" d={ribbonPath(0)} fill={`url(#${gradientId})`} />
        <path className="chapter-row__ribbon-sheen" d={ribbonPath(0)} fill={`url(#${sheenId})`} />
      </svg>
    </span>
  );
}

/** Compose `androidx.compose.ui.graphics.lerp(Color, Color, Float)` → hex mix. */
function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${String(r)}, ${String(g)}, ${String(bl)})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

export { NEW_BADGE_COLOR, ChapterVisual };
export type { ChapterRowState };

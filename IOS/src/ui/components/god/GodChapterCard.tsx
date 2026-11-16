/**
 * Port of Android `god/GodChapterCard.kt` (line by line) — **UI 层**。
 *
 * Android source (read-only): novel-reader/app/src/main/java/com/example/god/GodChapterCard.kt
 * (257 lines / 248 non-blank). 纯计算在 `@core/god/godChapterCard`（带完整行号映射）。
 *
 * Kotlin 行号映射（本文件）：
 *   - 51      `.height(96.dp)` / `.clip(shape)`                 → 固定高度 + border-radius
 *   - 62-73   `@Composable fun GodChapterCard(moment, chapterTitle, subtitle,
 *              highlighted, reduceMotion, onClick, onLongClick, modifier)`
 *              → 同名 props
 *   - 74-76   `godIsDark()` / `GodGold.goldGradient` / `RoundedCornerShape(CARD_CORNER)`
 *   - 79-90   高亮脉冲（`LaunchedEffect(highlighted)` + `delay(900)` + `animateFloatAsState`）
 *              → `useEffect` + `setTimeout(900)` + CSS opacity transition
 *   - 93-103  流光描边角（`infiniteRepeatable(0→360, tween(4200, Linear), Restart)`）
 *              → SVG `linearGradient` + `<animateTransform type="rotate">`
 *              （4200ms linear indefinite，E77 真旋转，见下）
 *   - 105-117 `Box(fillMaxWidth → height(96) → clip → combinedClickable → background)`
 *   - 110-115 `combinedClickable(onClickLabel = "阅读", onLongClickLabel = "编辑神回")`
 *              → Pointer Events + 500ms 长按定时器
 *   - 119-132 封面底图（有 `coverPath` → `AsyncImage` Crop；无 → gold 横向渐变）
 *   - 133-146 可读性渐变（三档 0xCC/0x66/0x22 `#0B0C0E`）
 *   - 148-154 高亮脉冲叠层（`gold.first().copy(alpha = pulseAlpha)`）
 *   - 157-188 流光描边（`drawWithContent` + 旋转 5 停靠点线性渐变 + `Stroke(2.dp)`）
 *   - 191-233 文本列（`align(CenterStart)` + `padding(start = 16, end = 92)`）
 *   - 197     `moment.effectiveTitle()` / maxLines 1 / Ellipsis
 *   - 206     `chapterTitle.ifBlank { "第${chapterNumber}话" }`
 *   - 213-232 星级行（`GodStarsReadonly(13.dp)` + `String.format("%.1f")` + 可选 subtitle）
 *   - 236-240 右上徽章（`align(TopEnd)` + `padding(10.dp)`）
 *   - 246-264 `GodBadge`（`RoundedCornerShape(50)` + gold 横向渐变 + `spacedBy(3.dp)` +
 *              两段 `#3B2A08` 文字）
 *
 * 复用（不重复实现）：`GodStarsReadonly`（`GodRankingShared.tsx` L200-272）、
 * `effectiveGodTitle`（`@core/god/godTypes`）、`godGoldGradient` / `godIsDark`
 * （`GodRankingShared.tsx` L35-91）。
 *
 * 适配与跳过（原因）：
 *   - Compose `Canvas` / `drawWithContent` → SVG：E77 之前描边用
 *     `linear-gradient` 叠 `border` + `@keyframes` 平移 `background-position`
 *     近似 —— 渐变角度固定在挂载瞬间（按 320×96 硬编码宽度算出），方位与
 *     安卓不同、宽卡片渐变条被拉伸。现改为 **SVG 真旋转**：`<rect
 *     rx=18 stroke=url(#g)>` 的 `linearGradient` 用 `gradientUnits=
 *     "userSpaceOnUse"`、基准轴向 (cx+r, cy)→(cx−r, cy)（r = max(w, h)，
 *     Kotlin L165），再由 `<animateTransform attributeName="gradientTransform"
 *     type="rotate" from="0 cx cy" to="360 cx cy" dur="4200ms" linear
 *     indefinite>` 绕 (cx, cy) 旋转 —— 与 Kotlin L160-187 的
 *     `start = (cx + cos a·r, cy + sin a·r)` / `end = (cx − cos a·r, …)`
 *     逐参数等价。卡片实际宽度用 ResizeObserver 实测（React 19 禁止渲染期
 *     读 ref.current，参照 SettingsControls.tsx 的既定模式：state + 等值守卫）。
 *     reduceMotion 时 Kotlin L103 钉死 angle=0 → 不渲染 animateTransform。
 *   - `coil.compose.AsyncImage(model = java.io.File(path), ContentScale.Crop)`
 *     → `<img src={path} object-fit: cover>`（Android 侧 path 是文件路径，web 直接当 URL）。
 *   - `TextOverflow.Ellipsis` + `maxLines` → CSS `white-space: nowrap; overflow: hidden;
 *     text-overflow: ellipsis`。
 *   - `MaterialTheme.colorScheme.outline` 等主题色 → 复用 godRankingPage 一套硬编码
 *     半透明墨色（`GodRankingShared.tsx` 的 `godIsDark()` 已按 App 背景亮度判定）。
 *   - `composed { }` / `LocalDensity` → CSS 绝对像素（1dp ≈ 1px）。
 *   - `delay(900)` / `animateFloatAsState` → `setTimeout` + CSS transition；
 *     `reduceMotion` 时脉冲与流光都退化为静态（与 Kotlin L86-88 / L103 一致）。
 *
 * 本次逐行复核的修正：
 *   - 脉冲总时长：Kotlin L79-90 是 `tween(240)` 淡入 → 保持 0.42 到 `delay(900)`
 *     → `tween(520)` 淡出，一轮 **1420ms**。CSS 此前把整轮压成 900ms
 *     （26.7% = 240/900），淡出只有 660ms；现改用
 *     `GOD_CHAPTER_PULSE_TOTAL_MS` 并把 keyframes 停靠点改成
 *     16.9% / 63.38%（= 240 / 1420、900 / 1420）。
 *   - 脉冲叠层颜色（Kotlin L152 `gold.first()`）：此前写死浅色金 `rgba(255, 226, 154, …)`，
 *     深色模式下应为 `#E0CB96`（`GodGold.DarkStart`）。现取 `godGoldGradient(dark)[0]`。
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  GOD_BORDER_SWEEP_MS,
  GOD_CHAPTER_BADGE_GLYPH,
  GOD_CHAPTER_BADGE_INK,
  GOD_CHAPTER_BADGE_TEXT,
  GOD_CHAPTER_CARD_CORNER,
  GOD_CHAPTER_CARD_HEIGHT_PX,
  GOD_CHAPTER_LONG_PRESS_MS,
  GOD_CHAPTER_PULSE_MS,
  GOD_CHAPTER_PULSE_TOTAL_MS,
  GOD_CHAPTER_SCRIM_CSS,
  GOD_CHAPTER_STAR_SIZE,
  GOD_CHAPTER_STROKE_PX,
  GOD_CHAPTER_TEXT_PAD_LEFT,
  GOD_CHAPTER_TEXT_PAD_RIGHT,
  godChapterBackdrop,
  godChapterCardSpec,
  godChapterPulseSpec,
} from '@core/god/godChapterCard';
import type { GodMoment } from '@core/god/godTypes';
import { GodStarsReadonly, godGoldGradient, godIsDark } from './GodRankingShared';
import '../../../styles/god.css';

/**
 * 描边渐变的 5 停靠点（GodChapterCard.kt L172-178）。
 *
 * ⚠️ Kotlin 这里用的是 `GodGold.LightStart / LightMid` **编译期常量**（没有
 * dark 分支），所以深色模式下描边依旧是浅金 —— 与安卓逐字一致。
 * 数值与 core 的 `GOD_CHAPTER_SWEEP_STOPS`（CSS 字符串形态）同一组；
 * SVG 侧需要 `<stop>` 元素，故展开为结构化数据。
 */
const GOD_CHAPTER_SWEEP_STOPS_SVG: ReadonlyArray<{
  offset: string;
  color: string;
  opacity: number;
}> = [
  { offset: '0', color: '#FFE29A', opacity: 0 },
  { offset: '0.25', color: '#FFE29A', opacity: 0.9 },
  { offset: '0.5', color: '#F5B942', opacity: 1 },
  { offset: '0.75', color: '#FFE29A', opacity: 0.9 },
  { offset: '1', color: '#FFE29A', opacity: 0 },
];

/** 「神回 ✦」小徽章（GodChapterCard.kt L246-264）。 */
export function GodBadge(props: { className?: string; style?: CSSProperties }) {
  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  return (
    <span
      className={['god-chapter__badge', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        background: `linear-gradient(90deg, ${gold[0]}, ${gold[1]}, ${gold[2]})`,
        ...props.style,
      }}
    >
      <span style={{ color: GOD_CHAPTER_BADGE_INK, fontWeight: 700 }}>{GOD_CHAPTER_BADGE_TEXT}</span>
      <span style={{ color: GOD_CHAPTER_BADGE_INK, fontWeight: 700 }}>{GOD_CHAPTER_BADGE_GLYPH}</span>
    </span>
  );
}

export function GodChapterCard(props: {
  moment: GodMoment;
  chapterTitle: string;
  subtitle?: string | null;
  highlighted: boolean;
  reduceMotion: boolean;
  onClick: () => void;
  onLongClick: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { moment, reduceMotion } = props;

  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  const spec = godChapterCardSpec({
    moment,
    chapterTitle: props.chapterTitle,
    ...(props.subtitle !== undefined ? { subtitle: props.subtitle } : {}),
  });
  const backdrop = godChapterBackdrop(moment, gold);

  /* 高亮脉冲：排行榜跳转定位后播一次（Kotlin L79-90）
     ⚠️ Kotlin 用 `LaunchedEffect(highlighted) { pulse = true; delay(900); pulse = false }`
     + `animateFloatAsState(tween(if (pulse) 240 else 520))`。DOM 侧改成**纯 CSS**
     keyframe（900ms 内 0 → 0.42 → 0，入 240ms / 出 520ms，见 god.css），
     `highlighted` 直接驱动挂载 —— 与 Kotlin 的「播一次然后自动回落」等价，
     且避免了在 effect 里 setState（React 19 lint 会拦）。
     纯计算见 core 的 `godChapterPulseSpec`（供测试对齐）。 */
  const pulseSpec = godChapterPulseSpec(props.highlighted ? 0 : GOD_CHAPTER_PULSE_MS);

  // Kotlin 93-103：`infinite.animateFloat(0→360, tween(4200, Linear), Restart)`。
  // E77：旋转由 SVG `<animateTransform>`（gradientTransform rotate 0→360，
  // 4200ms linear indefinite）承担 —— 渐变矢量真旋转，不再是 background-position
  // 平移近似；reduceMotion 时 Kotlin L103 钉死 angle=0 → 不渲染 animateTransform。

  /* E77：渐变几何需要卡片实际宽度（r = maxOf(w, h)，Kotlin L165）。
     React 19 禁止渲染期读 ref.current —— 参照 SettingsControls.tsx 的既定
     模式：ResizeObserver + state + 等值守卫（回调异步触发，不在 effect 体内
     同步 setState；observe() 的首次观测在下一帧渲染步骤前送达，无闪帧）。 */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: GOD_CHAPTER_CARD_HEIGHT_PX,
  });
  useEffect(() => {
    const el = cardRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setCardSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* 长按：combinedClickable.onLongClick（Kotlin L111-115） */
  const timerRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const clearLongPress = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => clearLongPress, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    movedRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    clearLongPress();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!movedRef.current) props.onLongClick();
    }, GOD_CHAPTER_LONG_PRESS_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > 8) {
      // ViewConfiguration scaledTouchSlop ≈ 8dp：移动超过 slop → 取消长按
      movedRef.current = true;
      clearLongPress();
    }
  };

  /* E77 渐变几何（Kotlin L162-169）：cx/cy = 卡片中心，r = maxOf(w, h)；
     基准轴向 (cx + r, cy) → (cx − r, cy)（angle = 0 的 start/end），
     0→360 的旋转交给 `<animateTransform>`（绕 cx,cy）。 */
  const sweepCx = cardSize.w / 2;
  const sweepCy = cardSize.h / 2;
  const sweepR = Math.max(cardSize.w, cardSize.h);
  // 一页可能同时挂多张章节卡 → 渐变 id 每实例唯一（useId 去掉装饰字符后仍全树唯一）。
  const sweepGradientId = `god-chapter-sweep-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div
      ref={cardRef}
      className={['god-chapter', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        height: GOD_CHAPTER_CARD_HEIGHT_PX,
        borderRadius: GOD_CHAPTER_CARD_CORNER,
        background: backdrop.css,
        ...props.style,
      }}
      onClick={() => {
        if (movedRef.current) return;
        props.onClick();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onLongClick();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          props.onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={spec.clickLabel}
      aria-description={spec.longClickLabel}
    >
      {/* 封面底图 — Kotlin L119-132 */}
      {backdrop.kind === 'image' && backdrop.src !== null ? (
        <img className="god-chapter__cover" src={backdrop.src} alt="" />
      ) : null}

      {/* 可读性渐变 — Kotlin L134-146 */}
      <span className="god-chapter__scrim" style={{ background: GOD_CHAPTER_SCRIM_CSS }} />

      {/* 高亮脉冲 — Kotlin L148-154（脉冲曲线在 CSS @keyframes 里）
          ⚠️ Kotlin L152 是 `gold.first()`（随主题翻转：深色 `#E0CB96` / 浅色 `#FFE29A`），
             此前这里写死浅色金 → 深色模式下脉冲发白。 */}
      {pulseSpec.pulse ? (
        <span
          className="god-chapter__pulse"
          style={{
            background: gold[0],
            // Kotlin：240ms 淡入 → 保持到 900ms → 520ms 淡出 = 1420ms 一轮
            animationDuration: `${GOD_CHAPTER_PULSE_TOTAL_MS}ms`,
          }}
        />
      ) : null}

      {/* 流光描边 — Kotlin L157-188（E77：SVG 真旋转）。
          路径 = 内缩 sw/2 的圆角矩形（rx = CARD_CORNER − sw/2），让 2dp 描边
          全部落在卡内 —— 与旧 CSS `border: 2px` 版本的几何逐像素一致
          （Kotlin 的 drawRoundRect 描边中心线在卡界、外半被 clip 裁掉；
          端口既有观感是完整 2dp，E77 只修旋转不改描边重量）。
          未量到宽度前不渲染，ResizeObserver 首帧就会送来尺寸。 */}
      {cardSize.w > 0 ? (
        <svg
          className="god-chapter__border-svg"
          width={cardSize.w}
          height={cardSize.h}
          viewBox={`0 0 ${cardSize.w} ${cardSize.h}`}
          /* offsetWidth 是整数量测，CSS 盒可能是小数宽 —— none 让用户单位
             双向铺满视口（偏差 ≤0.5px，远小于描边抗锯齿），避免 meet 的留缝。 */
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id={sweepGradientId}
              gradientUnits="userSpaceOnUse"
              x1={sweepCx + sweepR}
              y1={sweepCy}
              x2={sweepCx - sweepR}
              y2={sweepCy}
            >
              {GOD_CHAPTER_SWEEP_STOPS_SVG.map((stop) => (
                <stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={stop.color}
                  stopOpacity={stop.opacity}
                />
              ))}
              {!reduceMotion ? (
                <animateTransform
                  attributeName="gradientTransform"
                  attributeType="XML"
                  type="rotate"
                  from={`0 ${sweepCx} ${sweepCy}`}
                  to={`360 ${sweepCx} ${sweepCy}`}
                  dur={`${GOD_BORDER_SWEEP_MS}ms`}
                  repeatCount="indefinite"
                />
              ) : null}
            </linearGradient>
          </defs>
          <rect
            x={GOD_CHAPTER_STROKE_PX / 2}
            y={GOD_CHAPTER_STROKE_PX / 2}
            width={cardSize.w - GOD_CHAPTER_STROKE_PX}
            height={cardSize.h - GOD_CHAPTER_STROKE_PX}
            rx={GOD_CHAPTER_CARD_CORNER - GOD_CHAPTER_STROKE_PX / 2}
            ry={GOD_CHAPTER_CARD_CORNER - GOD_CHAPTER_STROKE_PX / 2}
            fill="none"
            stroke={`url(#${sweepGradientId})`}
            strokeWidth={GOD_CHAPTER_STROKE_PX}
          />
        </svg>
      ) : null}

      {/* 文本 — Kotlin L191-233 */}
      <div
        className="god-chapter__text"
        style={{ paddingLeft: GOD_CHAPTER_TEXT_PAD_LEFT, paddingRight: GOD_CHAPTER_TEXT_PAD_RIGHT }}
      >
        <p className="god-chapter__title">{spec.title}</p>
        <p className="god-chapter__subtitle">{spec.subtitle}</p>
        <div className="god-chapter__meta">
          <GodStarsReadonly rating={moment.rating} starSize={GOD_CHAPTER_STAR_SIZE} />
          <span className="god-chapter__rating">{spec.ratingText}</span>
          {spec.hasSubtitle ? (
            <span className="god-chapter__note">{props.subtitle ?? ''}</span>
          ) : null}
        </div>
      </div>

      {/* 右上徽章 — Kotlin L236-240 */}
      <GodBadge className="god-chapter__badge-slot" />
    </div>
  );
}

/** 供 CSS 对齐 Kotlin L98 的 `GodMotion.BORDER_SWEEP_MS`。 */
export const GOD_CHAPTER_BORDER_SWEEP_MS = GOD_BORDER_SWEEP_MS;

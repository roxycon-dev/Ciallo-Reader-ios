/**
 * Port of Android `god/GodChapterCard.kt` (line by line) — **纯计算部分**。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodChapterCard.kt`，
 * 257 行 / 248 非空）：
 *   - 51      `.height(96.dp)`                                 → `GOD_CHAPTER_CARD_HEIGHT_PX = 96`
 *   - 76      `RoundedCornerShape(GodMotion.CARD_CORNER.dp)`    → `GOD_CHAPTER_CARD_CORNER = 18`
 *   - 79-90   高亮脉冲（`pulse` 状态 + `delay(900)` + `animateFloatAsState`）
 *              → `godChapterPulseSpec()`（纯：900ms 窗口 + 240/520 时长）
 *   - 93-103  流光描边角度（`infiniteRepeatable(0→360, tween(BORDER_SWEEP_MS), Restart)`）
 *              → `godChapterSweepAngle(elapsedMs, reduceMotion)`
 *   - 108     `.height(96.dp)`                                   → 同 L51
 *   - 119-132 封面底图（有 coverPath → AsyncImage Crop；无 → gold 横向渐变）
 *              → `godChapterBackdrop(moment, dark)`
 *   - 133-146 可读性渐变 `horizontalGradient(0xCC0B0C0E, 0x660B0C0E, 0x220B0C0E)`
 *              → `GOD_CHAPTER_SCRIM_CSS` 常量
 *   - 148-154 高亮脉冲叠层 `gold.first().copy(alpha = pulseAlpha)`
 *              → `godChapterPulseAlpha(pulse)` + 组件内 inline style
 *   - 160-187 `drawWithContent` 流光描边（旋转线性渐变描边，2dp 描边）
 *              → `godChapterSweepGradient(angle, w, h)`（返回 CSS 渐变几何）
 *   - 182-185 `CornerRadius(CARD_CORNER)` + `Stroke(2.dp)`      → 常量
 *   - 197     `text = moment.effectiveTitle()`                 → 复用 `effectiveGodTitle`
 *   - 206     `chapterTitle.ifBlank { "第${moment.chapterNumber}话" }` → `godChapterSubtitle`
 *   - 214     `GodStarsReadonly(rating, starSize = 13.dp)`      → `GOD_CHAPTER_STAR_SIZE = 13`
 *   - 217     `String.format(Locale.ROOT, "%.1f", moment.rating)` → 复用 `formatGodRating`
 *   - 222     `if (!subtitle.isNullOrBlank())`                  → `godChapterHasSubtitle`
 *   - 260-261 徽章文案 `"神回"` / `"✦"`，色 `#3B2A08`            → 常量 + `GodChapterBadge`
 *
 * 跳过的 Kotlin 部分（全在 UI 层，落在 `src/ui/components/god/GodChapterCard.tsx`）：
 *   - 62-73   `@Composable fun GodChapterCard(...)` 全签名 → 组件 props
 *   - 80-90   `LaunchedEffect(highlighted) { pulse = true; delay(900); pulse = false }`
 *              → 组件 `useEffect` + `setTimeout(900)`（见组件头注）
 *   - 86-90   `animateFloatAsState`  → CSS transition（240ms in / 520ms out）
 *   - 93-103  `rememberInfiniteTransition` + `animateFloat` → CSS `@keyframes` 旋转
 *   - 110-115 `combinedClickable(onClickLabel = "阅读", onLongClickLabel = "编辑神回")`
 *              → 组件 Pointer Events + `window.setTimeout(500)` 长按
 *   - 120-125 `AsyncImage(model = File(coverPath), ContentScale.Crop)` → `<img object-fit: cover>`
 *   - 211/218/229 `TextOverflow.Ellipsis` + `maxLines`            → CSS `-webkit-line-clamp`
 *   - 246-264 `GodBadge` Composable                                → 组件内子组件
 *
 * 适配与跳过（原因）：
 *   - Compose `Canvas` / `drawWithContent` 流光描边 → CSS `linear-gradient` 背景 +
 *     `@keyframes god-chapter-sweep` 旋转 `background-position`；这**不是**逐像素
 *     等价（Compose 旋转的是渐变矢量，CSS 旋转的是图层），但视觉与时序一致。
 *   - `coil.compose.AsyncImage` → `<img>`（Android 用 `File(path)`；web 直接 `src=path`）。
 *   - `MaterialTheme.colorScheme.*` → `godIsDark()` + 已在 `godRankingShared.tsx`
 *     端口的 `GOD_GOLD` 调色板。
 *   - `composed { }` / `LocalDensity` → CSS 绝对像素（1dp ≈ 1px）。
 *
 * 本文件是 `src/core`，不 import React / DOM / Capacitor。
 */

import { effectiveGodTitle, formatGodRating, type GodMoment } from './godTypes';

/** `.height(96.dp)`（GodChapterCard.kt L108）→ CSS dp≈px。 */
export const GOD_CHAPTER_CARD_HEIGHT_PX = 96;

/** `RoundedCornerShape(GodMotion.CARD_CORNER.dp)`（L76；GodMotion.kt L71 CARD_CORNER = 18f）。 */
export const GOD_CHAPTER_CARD_CORNER = 18;

/** `Modifier.padding(start = 16.dp, end = 92.dp)`（L194）—— 右侧给徽章留位。 */
export const GOD_CHAPTER_TEXT_PAD_LEFT = 16;
export const GOD_CHAPTER_TEXT_PAD_RIGHT = 92;

/** `GodStarsReadonly(starSize = 13.dp)`（L214）。 */
export const GOD_CHAPTER_STAR_SIZE = 13;

/** `Stroke(width = 2.dp.toPx())` 流光描边（L185）。 */
export const GOD_CHAPTER_STROKE_PX = 2;

/** 高亮脉冲窗口 `delay(900)`（L83）：pulse = true 后保持 900ms 才置 false。 */
export const GOD_CHAPTER_PULSE_MS = 900;

/** `tween(if (pulse) 240 else 520)`（L88）—— 淡入 / 淡出时长。 */
export const GOD_CHAPTER_PULSE_IN_MS = 240;
export const GOD_CHAPTER_PULSE_OUT_MS = 520;

/**
 * 一轮脉冲的总时长（L80-90）。
 *
 * Kotlin：`pulse = true` → `animateFloatAsState(0 → 0.42, tween(240))`；
 * 900ms 后 `pulse = false` → `animateFloatAsState(0.42 → 0, tween(520))`。
 * 即 **240ms 淡入 → 保持 0.42 到 900ms → 520ms 淡出**，整轮 1420ms。
 * CSS 单条 keyframes 必须按这个总时长铺（`god.css` 的 `god-chapter-pulse`）。
 */
export const GOD_CHAPTER_PULSE_TOTAL_MS =
  GOD_CHAPTER_PULSE_MS + GOD_CHAPTER_PULSE_OUT_MS;

/** 脉冲峰值 `targetValue = if (pulse) 0.42f else 0f`（L87）。 */
export const GOD_CHAPTER_PULSE_PEAK = 0.42;

/** `GodMotion.BORDER_SWEEP_MS = 4200`（L98；GodMotion.kt L63）—— 描边一圈。 */
export const GOD_BORDER_SWEEP_MS = 4200;

/** 长按 `combinedClickable.onLongClick` → `ViewConfiguration.getLongPressTimeout()`。 */
export const GOD_CHAPTER_LONG_PRESS_MS = 500;

/**
 * 可读性渐变三档（GodChapterCard.kt L139-143）：`0xCC0B0C0E` / `0x660B0C0E` / `0x220B0C0E`。
 *
 * ⚠️ Compose `Brush.horizontalGradient(colors)` 默认 `start = Offset.Zero`、
 * `end = Offset.Infinite`，三个颜色**等分**在 0% / 50% / 100%。此前 CSS 把中间档放在
 * 55%，与安卓的明暗过渡节奏不同（这一层是卡片正文可读性的主要来源）。
 */
export const GOD_CHAPTER_SCRIM_CSS =
  'linear-gradient(90deg, rgba(11, 12, 14, 0.8) 0%, rgba(11, 12, 14, 0.4) 50%, rgba(11, 12, 14, 0.133) 100%)';

/** 徽章文字色（GodChapterCard.kt L260-261 `Color(0xFF3B2A08)`）。 */
export const GOD_CHAPTER_BADGE_INK = '#3B2A08';

/** 「神回 ✦」徽章两段文案（GodChapterCard.kt L260-261）。 */
export const GOD_CHAPTER_BADGE_TEXT = '神回';
export const GOD_CHAPTER_BADGE_GLYPH = '✦';

/**
 * 脉冲目标值（GodChapterCard.kt L87 `targetValue = if (pulse) 0.42f else 0f`）。
 *
 * 脉冲只播一次（`LaunchedEffect(highlighted)` + `delay(900)` 后置 false，L80-85）。
 * `elapsedMs` 从 `highlighted` 变 true 起算。
 */
export function godChapterPulseSpec(elapsedMs: number): {
  pulse: boolean;
  alpha: number;
  durationMs: number;
} {
  if (elapsedMs < 0 || elapsedMs >= GOD_CHAPTER_PULSE_MS) {
    return { pulse: false, alpha: 0, durationMs: GOD_CHAPTER_PULSE_OUT_MS };
  }
  return { pulse: true, alpha: GOD_CHAPTER_PULSE_PEAK, durationMs: GOD_CHAPTER_PULSE_IN_MS };
}

/**
 * 流光描边角度（GodChapterCard.kt L96-103）：
 * `infiniteRepeatable(animateFloat(0f → 360f, tween(4200, LinearEasing), Restart))`
 * → `angle = (elapsedMs / 4200 * 360) mod 360`。
 *
 * `reduceMotion` 时 Kotlin L103 强制 `angle = 0f`（静态描边）。
 */
export function godChapterSweepAngle(elapsedMs: number, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return ((elapsedMs / GOD_BORDER_SWEEP_MS) * 360) % 360;
}

/**
 * 描边渐变几何（GodChapterCard.kt L160-187）。
 *
 * Kotlin 在 `drawRoundRect` 上以
 * `start = (cx + cos(a)·r, cy + sin(a)·r)` / `end = (cx - cos(a)·r, cy - sin(a)·r)`
 * 起一个 5 停靠点线性渐变，其中 `r = maxOf(size.width, size.height)`。
 * CSS 的 `linear-gradient` 以角度描述，起点恒在图形中心，因此这里
 * **只回传角度**（度）与半径基准，中心在 CSS 侧天然满足。
 */
export function godChapterSweepGradient(
  angle: number,
  width: number,
  height: number,
): { angleDeg: number; radiusPx: number } {
  // Kotlin 的 start/end 方向是 (cos a, sin a) → CSS 0° 指向正上方，故减 90°
  return {
    angleDeg: (angle + 90) % 360,
    radiusPx: Math.max(width, height),
  };
}

/**
 * 描边的 5 停靠点颜色（GodChapterCard.kt L172-178）：
 * `Transparent → LightStart@0.9 → LightMid → LightStart@0.9 → Transparent`。
 */
export const GOD_CHAPTER_SWEEP_STOPS =
  'rgba(255, 226, 154, 0) 0%, rgba(255, 226, 154, 0.9) 25%, rgba(245, 185, 66, 1) 50%, rgba(255, 226, 154, 0.9) 75%, rgba(255, 226, 154, 0) 100%';

/**
 * 封面底图（GodChapterCard.kt L119-132）：
 * 有 `coverPath` → `AsyncImage`（ContentScale.Crop）；无 → `Brush.linearGradient(gold)`。
 */
export function godChapterBackdrop(
  moment: GodMoment,
  goldGradient: readonly [string, string, string],
): { kind: 'image' | 'gradient'; src: string | null; css: string } {
  const path = moment.coverPath;
  if (path !== null && path.trim() !== '') {
    return { kind: 'image', src: path, css: '' };
  }
  return {
    kind: 'gradient',
    src: null,
    css: `linear-gradient(90deg, ${goldGradient[0]}, ${goldGradient[1]}, ${goldGradient[2]})`,
  };
}

/**
 * 副标题（GodChapterCard.kt L206）：
 * `chapterTitle.ifBlank { "第${moment.chapterNumber}话" }`。
 */
export function godChapterSubtitle(chapterTitle: string, chapterNumber: number): string {
  return chapterTitle.trim() === '' ? `第${chapterNumber}话` : chapterTitle;
}

/** `if (!subtitle.isNullOrBlank())`（L222）—— null 与空串都不显示。 */
export function godChapterHasSubtitle(subtitle: string | null | undefined): boolean {
  return subtitle !== null && subtitle !== undefined && subtitle.trim() !== '';
}

/**
 * 卡片文本内容（GodChapterCard.kt L197-231）。
 * 标题走 `effectiveTitle()`（L197 → godTypes.ts L113-121 的 `effectiveGodTitle`）。
 */
export interface GodChapterCardSpec {
  title: string;
  subtitle: string;
  ratingText: string;
  hasSubtitle: boolean;
  clickLabel: string;
  longClickLabel: string;
}

export function godChapterCardSpec(args: {
  moment: GodMoment;
  chapterTitle: string;
  /** 可选副标题（Kotlin `subtitle: String?`，L66）。 */
  subtitle?: string | null;
}): GodChapterCardSpec {
  const { moment } = args;
  return {
    title: effectiveGodTitle(moment),
    subtitle: godChapterSubtitle(args.chapterTitle, moment.chapterNumber),
    // String.format(Locale.ROOT, "%.1f", rating) — L217
    ratingText: formatGodRating(moment.rating),
    hasSubtitle: godChapterHasSubtitle(args.subtitle),
    // combinedClickable 的无障碍标签 — L113-114
    clickLabel: '阅读',
    longClickLabel: '编辑神回',
  };
}

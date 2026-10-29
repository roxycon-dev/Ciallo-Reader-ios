/**
 * Port of the **INTERACTIVE** half of Android `god/GodStarRating.kt`
 * (`fun GodStarRating`, L69-173) + `GodStar` (L177-240) + `GodSparks` (L244-268).
 *
 * The read-only half `GodStarsReadonly` (L287-319) is ALREADY ported in
 * `GodRankingShared.tsx` L200-272 — this file does **not** duplicate it.
 *
 * Android source (read-only): novel-reader/app/src/main/java/com/example/god/GodStarRating.kt
 * (313 lines / 297 non-blank). Pure math lives in `@core/god/godReaderBinding`
 * (which carries the full line-by-line map); this file is the rendering layer.
 *
 * Kotlin line map for the JSX below:
 *   - 79-82   `view` / `dark` / `gold` / `trackColor = onSurface.copy(alpha = 0.18f)`
 *   - 85      `lastHaptic`（触觉去重，Web 不执行，保留判定）
 *   - 87-94   `sparkKey` 自增 + `lastRating` → `useState` + `useEffect`
 *   - 96-104  `fun commit(raw)` → `commit()` in this file
 *   - 106-110 `Row(spacedBy = starGap)` → flex row with `gap: starGap`
 *   - 111-120 `pointerInput { detectTapGestures { commit((x / w) * 5).coerceIn(MIN,MAX)) } }`
 *   - 121-134 `pointerInput { detectHorizontalDragGestures { … same formula … } }`
 *   - 113/122 `if (!enabled) return@pointerInput` → `pointer-events: none` when disabled
 *   - 136-148 内层 `Row` 5 颗 `GodStar(filled = (rating - (i-1)).coerceIn(0,1))`
 *   - 145     `sparkKey = if (filled >= 1f) sparkKey else -1` → 只有整星撒金屑
 *   - 151-171 `AnimatedContent` 分数（slideInVertically + fadeIn / slideOut + fadeOut）
 *   - 165     `String.format(Locale.ROOT, "%.1f", value)`
 *   - 168     `color = if (dark) GodGold.DarkMid else GodGold.LightEnd`
 *   - 185     `target = if (filled > 0f) 1f else 0.82f`（弹性缩放）
 *   - 191-195 `glow` 弹簧（springMain）
 *   - 201     `starPath(w * 0.5f * scale, center)` → SVG path generator
 *   - 204     `drawPath(path, trackColor)`（未点亮底轨）
 *   - 209-219 微光扩散 `radialGradient(gold[0]@0.34·glow → Transparent, radius = w·0.95)`
 *   - 220-229 `clipRect(right = w * filled) { drawPath(path, linearGradient(gold)) }`（半星）
 *   - 232     `drawPath(path, White@0.22f, Stroke(1.dp))`（细描边）
 *   - 236-238 `if (sparkKey >= 0 && !reduceMotion) GodSparks(key, gold.first())`
 *   - 254     `if (progress <= 0f || progress >= 1f) return` → 粒子数组为空
 *   - 256-266 6 粒金屑几何 → `godSparkParticles()`（core）
 *
 * Adaptations (documented, behavior preserved):
 *   - `Animatable` spring → CSS transform transitions. Per-spring cubic-beziers
 *     are declared in `@core/god/godPull` (`GOD_SPRING_MAIN_CSS` /
 *     `GOD_SPRING_BOUNCY_CSS`), since GodMotion.kt L34/L43 is the single source
 *     of truth for damping/stiffness. starScale uses springBouncy (L188), glow
 *     uses springMain (L193).
 *   - `detectTapGestures` + `detectHorizontalDragGestures` → one Pointer Events
 *     handler with `setPointerCapture`; the *same* x→rating formula serves both
 *     (Kotlin duplicates it at L118 and L130).
 *   - `HapticsGate.enabled` + `performHapticFeedback(CLOCK_TICK)` (L99-101) →
 *     **skipped**: no Web API. `navigator.vibrate` fires only when the host opts
 *     in via the `hapticsEnabled` prop, mirroring how `ComicCropSheet.tsx`
 *     handles `HapticsGate`.
 *   - `pointerInput` keys `(enabled, rating)` (L113, L122) → the handler reads
 *     `props.rating` from the current render closure, so re-keying is unnecessary.
 *   - `AnimatedContent` slide-in/slide-out (L152-162) → a keyed `<span>` with a
 *     CSS enter animation; exit animation is dropped (Android's is 260ms and
 *     overlaps the enter; DOM removal is immediate without a transition group).
 *   - `String.format(Locale.ROOT, "%.1f", value)` → `toFixed(1)`, which is
 *     locale-independent by definition (JavaScript has no `Locale.ROOT`).
 *   - `MaterialTheme.colorScheme.onSurface.copy(alpha = 0.18f)` (L82) → the same
 *     literal the already-ported read-only stars use: `rgba(24, 25, 28, 0.18)`.
 *   - `trackColor` note: the read-only port uses alpha `0.16` (L295) while the
 *     editable one uses `0.18` (L82). Both literals are preserved as-is, and
 *     both now branch on `godIsDark()` (`onSurface` flips with the theme —
 *     hardcoding the light-theme ink made the unlit star track invisible in
 *     dark mode; same class of bug already fixed for `GodEmptyState`'s ink).
 *   - `GodSparks` (L244-252): `animate(0f, 1f, tween(520))` — `tween()`'s default
 *     easing is `FastOutSlowInEasing`, so the rAF now runs its progress through
 *     `godFastOutSlowIn()`; it used to be linear.
 *
 * 本次逐行复核的修正：
 *   - 金色填充路径从 `showGlow`（`filled > 0.02`）分支里挪出来。Kotlin L207-229 的
 *     结构是 `if (filled > 0f) { if (glow > 0.02f) 微光; clipRect 金色 }` ——
 *     两道门互相独立，`0 < filled ≤ 0.02` 时仍要画那一丝金色；此前整颗不亮。
 *   - 星星的弹性缩放（Kotlin L185-190 `target = if (filled > 0f) 1f else 0.82f`
 *     + `animateFloatAsState(springBouncy)`）此前**完全没生效**：`scaleTarget`
 *     只被算进了路径半径 `d`，却从没应用到元素上，而 `.god-rate-star--bouncy`
 *     只有 transition 没有目标值。现在用外层 span 的 `transform: scale(...)`
 *     承载（Kotlin 是改路径半径 `starPath(w*0.5*scale, …)`，绕中心缩放等价）。
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampRating,
  godRatingCommit,
  godRatingFromX,
  godSparkParticles,
  godStarFill,
  godStarScaleTarget,
  nextGodSparkKey,
} from '@core/god/godReaderBinding';
import { GOD_SPRING_BOUNCY_CSS, GOD_SPRING_MAIN_CSS } from '@core/god/godPull';
import { godFastOutSlowIn } from '@core/god/godEasing';
import { GOD_RATING_MAX, GOD_RATING_MIN } from '@core/god/godTypes';
import { godGoldGradient, godIsDark } from './GodRankingShared';
import '../../../styles/god.css';

/**
 * Kotlin L82：`MaterialTheme.colorScheme.onSurface.copy(alpha = 0.18f)`
 *
 * ⚠️ `onSurface` 随主题翻转（深色下是浅色）。此前写死浅色底的墨色 `#18191c`，
 * 深色模式下未点亮的星形轨几乎不可见 —— 与同文件 `GodEmptyState` 已修的 ink 同类问题，
 * 这里按 `godIsDark()` 分叉。
 */
const TRACK_COLOR_LIGHT = 'rgba(24, 25, 28, 0.18)';
const TRACK_COLOR_DARK = 'rgba(255, 255, 255, 0.18)';

/** Kotlin 232: `Color.White.copy(alpha = 0.22f)` 的描边色 */
const STAR_STROKE_COLOR = 'rgba(255, 255, 255, 0.22)';

/** 金屑动画时长（Kotlin 250 `tween(520)`） */
const SPARK_MS = 520;

/**
 * 五角星路径（外半径 R，内半径 0.46R，起始角 -90°）——
 * Kotlin `private fun starPath(radius, center)` L271-283。
 * `GodRankingShared.tsx` 有同名私有函数；此处保留本文件独立副本，
 * 因为 Android 源里也是两个文件各有一份（可编辑 L271 / 只读 L271 同款）。
 */
function starPath(radius: number, cx: number, cy: number): string {
  const inner = radius * 0.46;
  let d = '';
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + i * (Math.PI / 5);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)} `;
  }
  return `${d}Z`;
}

/* ── GodSparks（L244-268） ── */

function GodSparks(props: { sparkKey: number; color: string; size: number }) {
  const [progress, setProgress] = useState(0);
  // Kotlin 246-252: `LaunchedEffect(key) { progress = 0f; animate(0f→1f, tween(520)) }`
  // React 19: 不能在 useEffect 里同步 setState 派生渲染值 ——
  // 用 `key` 挂载时 progress 已是 0（L246 的 `progress = 0f` 由初值承担），
  // effect 只负责推进动画。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const started = window.performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / SPARK_MS);
      // Kotlin L250：`animate(0f, 1f, animationSpec = tween(520))`
      // ⚠️ `tween(520)` 的默认缓动是 `FastOutSlowInEasing`（cubic-bezier(0.4,0,0.2,1)），
      // 不是线性 —— 金屑的「扩散快、收尾慢」手感全靠它。此前这里是线性 rAF。
      setProgress(godFastOutSlowIn(t));
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [props.sparkKey]);

  // Kotlin 254: `if (progress <= 0f || progress >= 1f) return@Canvas`
  const particles = godSparkParticles(progress, props.size);
  if (particles.length === 0) return null;

  const cx = props.size / 2;
  const cy = props.size / 2;
  return (
    <span className="god-rate-sparks" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          key={i}
          className="god-rate-spark"
          style={{
            left: `${cx + Math.cos(p.angle) * p.distance}px`,
            top: `${cy + Math.sin(p.angle) * p.distance}px`,
            width: p.radius * 2,
            height: p.radius * 2,
            background: props.color,
            opacity: p.alpha,
          }}
        />
      ))}
    </span>
  );
}

/* ── GodStar（L177-240） ── */

function GodStar(props: {
  filled: number;
  gold: readonly string[];
  reduceMotion: boolean;
  size: number;
  sparkKey: number;
}) {
  const { filled, gold, size } = props;
  const gradientId = `god-rate-grad-${useId().replaceAll(':', '')}`;
  const glowId = `glow-${gradientId}`;

  // Kotlin 185-195: target scale / glow 都是 animateFloatAsState(弹簧)，
  // 由 CSS transition 承担（transition 写在 class 上）。
  const scaleTarget = godStarScaleTarget(filled);
  // Kotlin L201 用 `starPath(w * 0.5f * scale, …)` 直接改路径半径（等价于绕中心
  // 缩放）；CSS 用外层 span 的 `transform: scale()` 表达，过渡走 springBouncy。
  // 此前只把 scaleTarget 算进 `d`，却从没把 scale 应用到元素上 —— 星星根本
  // 不会做「点亮弹一下 / 熄灭缩到 0.82」这个动作。
  const d = starPath(size * 0.5, size / 2, size / 2);

  // 微光：filled > 0.02 才画（Kotlin 209）
  const showGlow = filled > 0.02;
  // 半星：clipRect(right = w · filled) → SVG clipPath 的矩形宽度
  const clipWidth = Math.min(1, Math.max(0, filled)) * size;
  const trackColor = godIsDark() ? TRACK_COLOR_DARK : TRACK_COLOR_LIGHT;

  return (
    <span
      className={['god-rate-star', props.reduceMotion ? '' : 'god-rate-star--bouncy']
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size, transform: `scale(${scaleTarget})` }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {/* Kotlin 222-228: Brush.linearGradient(gold, (0,0) → (w,h)) */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {gold.map((color, index) => (
              <stop key={color} offset={`${index * 50}%`} stopColor={color} />
            ))}
          </linearGradient>
          {/* Kotlin 210-218: radialGradient(gold[0]@0.34·glow → Transparent, r = w·0.95) */}
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor={gold[0] ?? '#FFE29A'} stopOpacity={0.34 * filled} />
            <stop offset="100%" stopColor={gold[0] ?? '#FFE29A'} stopOpacity={0} />
          </radialGradient>
        </defs>
      </svg>

      <svg
        className="god-rate-star__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {/* 未点亮底轨 — Kotlin 204 */}
        <path d={d} fill={trackColor} />
        {showGlow ? (
          // 微光扩散 — Kotlin 209-218（`if (glow > 0.02f)`）
          <circle cx={size / 2} cy={size / 2} r={size * 0.95} fill={`url(#${glowId})`} />
        ) : null}
        {/* 点亮部分（半星 = 只裁左半边）— Kotlin 220-229。
            ⚠️ Kotlin 的门是 `if (filled > 0f)`，与微光的 `glow > 0.02f` 无关：
            0 < filled ≤ 0.02 时依然要画那一丝金色。此前本段被塞在 showGlow 里，
            这段区间会整颗不亮。 */}
        {filled > 0 ? (
          <>
            <clipPath id={`clip-${gradientId}`}>
              <rect x="0" y="0" width={clipWidth} height={size} />
            </clipPath>
            <path d={d} fill={`url(#${gradientId})`} clipPath={`url(#clip-${gradientId})`} />
          </>
        ) : null}
        {/* 细描边 — Kotlin 232 */}
        <path d={d} fill="none" stroke={STAR_STROKE_COLOR} strokeWidth="1" />
      </svg>

      {/* 金粒：点亮瞬间撒几颗（一次性动画，非常驻）— Kotlin 236-238 */}
      {props.sparkKey >= 0 && !props.reduceMotion ? (
        <GodSparks key={props.sparkKey} sparkKey={props.sparkKey} color={gold[0] ?? '#FFE29A'} size={size} />
      ) : null}
    </span>
  );
}

/* ── GodStarRating（L69-173） ── */

export function GodStarRatingEditable(props: {
  rating: number;
  onRatingChange: (value: number) => void;
  starSize?: number;
  starGap?: number;
  enabled?: boolean;
  reduceMotion?: boolean;
  showScore?: boolean;
  /** Web 触觉（Android `HapticsGate.enabled` + CLOCK_TICK 的等价开关）。 */
  hapticsEnabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const starSize = props.starSize ?? 34;
  const starGap = props.starGap ?? 6;
  const enabled = props.enabled ?? true;
  const reduceMotion = props.reduceMotion ?? false;
  const showScore = props.showScore ?? true;
  const hapticsEnabled = props.hapticsEnabled ?? false;

  const dark = godIsDark();
  const gold = godGoldGradient(dark);

  // Kotlin 85: `var lastHaptic by remember { mutableFloatStateOf(rating) }`
  const lastHapticRef = useRef(props.rating);
  // Kotlin 87-88: sparkKey / lastRating
  const [sparkKey, setSparkKey] = useState(0);
  const lastRatingRef = useRef(props.rating);
  const rowRef = useRef<HTMLSpanElement | null>(null);

  // Kotlin 89-94: `LaunchedEffect(rating) { if (rating != lastRating) { …; sparkKey++ } }`
  useEffect(() => {
    if (props.rating === lastRatingRef.current) return;
    const next = nextGodSparkKey(sparkKey, props.rating, lastRatingRef.current);
    lastRatingRef.current = next.lastRating;
    setSparkKey(next.sparkKey);
  }, [props.rating, sparkKey]);

  // Kotlin 96-104: `fun commit(raw)`
  const commit = (raw: number): void => {
    const result = godRatingCommit(props.rating, raw, lastHapticRef.current);
    if (!result.changed) return;
    if (result.haptic && hapticsEnabled) {
      // Android: `view.performHapticFeedback(CLOCK_TICK)` (L100)
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(1);
      }
    }
    lastHapticRef.current = result.nextLastHaptic;
    props.onRatingChange(result.value);
  };

  // Kotlin 115-119（点按）与 127-132（横向拖动）共用同一换算
  const ratingFromEvent = (clientX: number): void => {
    const el = rowRef.current;
    if (el === null) return;
    const width = el.getBoundingClientRect().width;
    const next = godRatingFromX(clientX - el.getBoundingClientRect().left, width);
    if (next === null) return;
    commit(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!enabled) return; // Kotlin 113-114
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!enabled) return; // Kotlin 122-123
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    ratingFromEvent(event.clientX);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (!enabled) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Android 的 detectTapGestures 与 detectHorizontalDragGestures 是两个独立
    // pointerInput；DOM 里 pointerup 一次即可同时满足"点按"与"拖动抬起"。
    ratingFromEvent(event.clientX);
  };

  return (
    <span
      className={['god-rate', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ ...props.style, gap: starGap }}
    >
      <span
        ref={rowRef}
        className={enabled ? 'god-rate__row' : 'god-rate__row god-rate__row--disabled'}
        style={{ gap: starGap }}
        role="slider"
        tabIndex={enabled ? 0 : -1}
        aria-label="评分"
        aria-valuemin={GOD_RATING_MIN}
        aria-valuemax={GOD_RATING_MAX}
        aria-valuenow={props.rating}
        aria-valuetext={`评分 ${props.rating.toFixed(1)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          // 无障碍等价：←/→ 走 0.5 步长
          if (!enabled) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            commit(clampRating(props.rating + 0.5));
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            commit(clampRating(props.rating - 0.5));
          }
        }}
      >
        {[1, 2, 3, 4, 5].map((i) => {
          const filled = godStarFill(props.rating, i);
          return (
            <GodStar
              key={i}
              filled={filled}
              gold={gold}
              reduceMotion={reduceMotion}
              size={starSize}
              // Kotlin 145: `sparkKey = if (filled >= 1f) sparkKey else -1`
              sparkKey={filled >= 1 ? sparkKey : -1}
            />
          );
        })}
      </span>

      {showScore ? (
        // Kotlin 151-171 AnimatedContent + 165/168
        <span
          key={props.rating}
          className={reduceMotion ? 'god-rate__score god-rate__score--quick' : 'god-rate__score'}
          style={{ color: dark ? '#C79A3E' : '#D98E1F' }}
        >
          {props.rating.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}

/** 供 CSS / 测试对齐 Kotlin 行号：scale 用 springBouncy(L188)，glow 用 springMain(L193)。 */
export const GOD_RATE_SCALE_TRANSITION = GOD_SPRING_BOUNCY_CSS;
export const GOD_RATE_GLOW_TRANSITION = GOD_SPRING_MAIN_CSS;

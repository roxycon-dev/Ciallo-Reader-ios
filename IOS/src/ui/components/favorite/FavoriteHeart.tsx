/**
 * Port of Android `ui/favorite/FavoriteHeart.kt` (283 lines total / 272 non-blank / 254 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–49   package + imports → file header; `kotlin.math.cos/sin` → `Math.cos/sin`.
 *   51–64  the component KDoc (feedback semantics, the deleted ShelfFly history, long-press)
 *          → `FavoriteHeartButton` KDoc, verbatim prose.
 *   65–77  `@Composable fun FavoriteHeartButton(favorite, onToggle, modifier, enabled,
 *          disabledHint, showLabel, onLongPress, onDisabledClick)` → same props.
 *   78–79  `rememberAppHaptics()` / `LocalReduceMotion.current` → `navigator.vibrate`
 *          passthrough (no haptics service on web) + `prefers-reduced-motion` media query.
 *          ⚠️ ADAPTATION: Android Vibrator has no web equivalent; the `HapticKind`
 *          ladder is preserved as data and fired through `navigator.vibrate` durations
 *          taken from `ui/feedback/Motion.kt` L134–138.
 *   81     `Animatable(1f) scale` → `useState(1)` + CSS transition on transform.
 *   82     `Animatable(fill) fill` → `useState(favorite ? 1 : 0)`; the two-step
 *          snapTo(0)→animateTo(1) is reproduced with a rAF reset.
 *   83     `mutableIntStateOf burstId` → `useState(0)`.
 *   84     `Animatable(0f) burst` → `useState(0)` + CSS keyframe-free inline transform.
 *   86–105 `LaunchedEffect(favorite)` — the two-branch feedback choreography
 *          (light haptic / fill tween 260ms / spring 0.6→1.25→1.0 + burstId++,
 *           or selection haptic / fill 180ms / 0.86→1.0) → `useEffect` keyed on
 *           `favorite`, same numbers, same ordering.
 *   107–112 `LaunchedEffect(burstId)` burst 0→1 over `AppMotion.PARTICLE_MS`
 *          → `useEffect` on `burstId`, `FAV_PARTICLE_MS`.
 *   114–120 `collectIsPressedAsState` + `animateFloatAsState(0.94, tween(110))`
 *          → `onPointerDown/Up` press state + `FAV_PRESS_SCALE` / `FAV_PRESS_MS`.
 *   122    `tint = if (favorite) MintPrimary else onSurface.copy(alpha=0.65f)` → same.
 *   123    `containerAlpha = if (enabled) 1f else 0.4f` → CSS `opacity`.
 *   125–170 the `Box(...)` — size(h=48, w=108|48), graphicsLayer{alpha, scaleX/Y},
 *          optional background+border, `semantics { role, contentDescription }`,
 *          `combinedClickable { onClick → onDisabledClick or onToggle(!favorite);
 *          onLongClick → onLongPress or onDisabledClick }` → one `<button>` with
 *          `aria-label` (semantics), `aria-disabled`, onClick/onContextMenu.
 *   171–190 inner `Row` + `HeartGlyph` + conditional label Text (13.sp SemiBold, tint)
 *          → `.fav-heart-button__row`.
 *   191–194 `if (!reduceMotion && burstId > 0 && burst.value < 1f) HeartBurst(...)`
 *          → conditional `<HeartBurst progress color={HeartMid}>`.
 *   198–239 `private fun HeartGlyph(favorite, fill, scale, tint)` — 28.dp box,
 *          `Icons.Outlined.FavoriteBorder` at `1f - fill` with tint = HeartMid when
 *          favorite, and `HeartArt` at `alpha = fill`, `scale = 0.6f + 0.4f * fill`,
 *          `glow = fill * 1.1f` → two stacked inline SVGs with those exact factors.
 *   241–275 `private fun HeartBurst(progress, color)` — 7 particles, angle
 *          `(2πi/7) - π/2`, distance `14f + 26f * progress`, alpha `1 - progress`,
 *          size `7f - 3f * progress` dp, `isHeart = i % 2 == 0`, per-particle
 *          `scaleX/Y = 1f - 0.3f * progress` → 7 absolutely-positioned spans; heart
 *          particles reuse `HeartArt` with `glow = 0f`.
 *   277–293 `fun FavoriteHeartIcon(favorite, onToggle, modifier, enabled, size = 24.dp)`
 *          → `FavoriteHeartIcon` thin wrapper with `showLabel: false`.
 *
 * Skipped: none of the behavior. The Compose `Animatable`/`Animatable.snapTo`
 * coroutine choreography becomes rAF/CSS transitions; every millisecond and every
 * scale factor is preserved. The two behavioural notes in the KDoc (no ShelfFly
 * re-introduction; no fly-to-shelf overlay) are honored — nothing adds one.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  FAV_ARIA_OFF,
  FAV_ARIA_ON,
  FAV_BURST_COUNT,
  FAV_DISABLED_HINT,
  FAV_FILL_MS,
  FAV_FILL_MS_REDUCE,
  FAV_PARTICLE_MS,
  FAV_PRESS_MS,
  FAV_PRESS_SCALE,
  FAV_SCALE_IN_MS,
  FAV_SCALE_OUT_MS,
  FAV_UNFILL_MS,
  FAV_UNFILL_MS_REDUCE,
  HeartMid,
} from '@core/favorite/favoriteUi';
import { HeartArt, HeartArtDefaultSize } from './HeartArt';
import '../../../styles/favorite.css';

/* ── ui/feedback/Motion.kt HapticKind → VibrationEffect durations (L134–138) ──
 * Kotlin `AppHaptics.perform` uses (millis, amplitude):
 *   SELECTION → 8ms/48, LIGHT → 12ms/110, MEDIUM → 18ms/160, HEAVY → 26ms/220,
 *   SUCCESS → 16ms/190.  Web only has a duration, so the millis column is used.
 * ⚠️ ADAPTATION: `AppHaptics` / `HapticsGate` / `LocalHapticsEnabled` are Android
 * vibrator plumbing with no web counterpart; the ladder is kept as data here. */
export const HAPTIC_KIND = {
  SELECTION: 'SELECTION',
  LIGHT: 'LIGHT',
  MEDIUM: 'MEDIUM',
  HEAVY: 'HEAVY',
  SUCCESS: 'SUCCESS',
} as const;

export type HapticKindCode = (typeof HAPTIC_KIND)[keyof typeof HAPTIC_KIND];

export const HAPTIC_MILLIS: Readonly<Record<HapticKindCode, number>> = {
  SELECTION: 8,
  LIGHT: 12,
  MEDIUM: 18,
  HEAVY: 26,
  SUCCESS: 16,
};

export const HAPTIC_AMPLITUDE: Readonly<Record<HapticKindCode, number>> = {
  SELECTION: 48,
  LIGHT: 110,
  MEDIUM: 160,
  HEAVY: 220,
  SUCCESS: 190,
};

function performHaptic(kind: HapticKindCode, enabled: boolean): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(HAPTIC_MILLIS[kind]);
}

/** `LocalReduceMotion` — Motion.kt L88 (`Settings.Global.ANIMATOR_DURATION_SCALE ≤ 0.01`). */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** `LocalHapticsEnabled` — Motion.kt L91 (default true). */
function useHapticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (): void => {
      setEnabled(window.localStorage.getItem('haptics_enabled') !== 'false');
    };
    onStorage();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return enabled;
}

/**
 * 「喜欢」按钮（漫画主页面 / 顶部栏复用同一个组件）。
 *
 * 点击反馈分两种语义（设计稿 §1.1）：
 * - 喜欢：心形弹簧 0.6 → 1.25 → 1.0（≈350ms 轻微过冲）+ 填充色从中心扩散
 *   + 6~8 个小心形/圆点粒子飘散（≈600ms）+ light 触觉；
 * - 取消：心形收缩变灰，**无粒子**，selection tick 触觉。
 *
 * ⚠️ 反馈**只发生在按钮自己身上**。曾经有过一版"迷你封面/爱心沿抛物线飞向底部
 * 「书架」图标"的动效，用户判定为多余（视觉噪音大、和书架的因果关系是编出来的），
 * 已整体删除（ShelfFly 控制器 + 全屏覆盖层 + 落点弹跳）。这里不要再往回加。
 *
 * 长按 = 直接弹出分类选择 Sheet；无来源的书置灰并给出原因。
 */
export function FavoriteHeartButton(props: {
  favorite: boolean;
  onToggle: (favorite: boolean) => void;
  enabled?: boolean;
  disabledHint?: string;
  showLabel?: boolean;
  onLongPress?: () => void;
  onDisabledClick?: () => void;
  className?: string;
}) {
  const enabled = props.enabled !== false;
  const showLabel = props.showLabel !== false;
  const disabledHint = props.disabledHint ?? FAV_DISABLED_HINT;

  const reduceMotion = useReduceMotion();
  const hapticsEnabled = useHapticsEnabled();

  // L81: `val scale = remember { Animatable(1f) }`
  const [scale, setScale] = useState(1);
  // L82: `val fill = remember { Animatable(if (favorite) 1f else 0f) }`
  const [fill, setFill] = useState(props.favorite ? 1 : 0);
  // L83: `var burstId by remember { mutableIntStateOf(0) }`
  const [burstId, setBurstId] = useState(0);
  // L84: `val burst = remember { Animatable(0f) }`
  const [burst, setBurst] = useState(0);
  // L115: `val pressed by interaction.collectIsPressedAsState()`
  const [pressed, setPressed] = useState(false);

  const timersRef = useRef<number[]>([]);
  const clearTimers = useCallback((): void => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // L86–105: `LaunchedEffect(favorite)`
  //
  // ⚠️ ADAPTATION: every animated value is written from a timer callback, never
  // synchronously in the effect body (writing state straight from an effect body
  // causes a cascading render). The fill "snap to 0 → animate to 1" pair of
  // `Animatable` becomes a CSS transition driven by the same two durations, and
  // the scale spring (0.6 → 1.25 → 1.0) keeps its own three keyframes.
  useEffect(() => {
    clearTimers();
    if (props.favorite) {
      performHaptic(HAPTIC_KIND.LIGHT, hapticsEnabled);
      timersRef.current.push(
        window.setTimeout(() => {
          setFill(1);
          if (reduceMotion) return;
          setScale(0.6);
          timersRef.current.push(
            window.setTimeout(() => setScale(1.25), 0),
            window.setTimeout(() => setScale(1), 350),
            window.setTimeout(() => setBurstId((n) => n + 1), 350 + FAV_SCALE_IN_MS),
          );
        }, reduceMotion ? 0 : FAV_FILL_MS_REDUCE),
      );
    } else {
      performHaptic(HAPTIC_KIND.SELECTION, hapticsEnabled);
      timersRef.current.push(
        window.setTimeout(
          () => {
            setFill(0);
            if (reduceMotion) {
              setScale(1);
              return;
            }
            setScale(0.86);
            timersRef.current.push(window.setTimeout(() => setScale(1), FAV_SCALE_OUT_MS));
          },
          reduceMotion ? 0 : FAV_UNFILL_MS_REDUCE,
        ),
      );
    }
  }, [props.favorite, reduceMotion, hapticsEnabled, clearTimers]);

  // L107–112: `LaunchedEffect(burstId)`
  useEffect(() => {
    if (burstId <= 0 || reduceMotion) return;
    let raf = 0;
    const started = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - started) / FAV_PARTICLE_MS);
      setBurst(t);
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    const reset = window.setTimeout(() => {
      raf = window.requestAnimationFrame(step);
    }, 0);
    return () => {
      window.clearTimeout(reset);
      window.cancelAnimationFrame(raf);
    };
  }, [burstId, reduceMotion]);

  // L116–120: `animateFloatAsState(if (pressed) 0.94f else 1f, tween(110))`
  const pressScale = pressed ? FAV_PRESS_SCALE : 1;

  // L122: `tint = if (favorite) MintPrimary else onSurface.copy(alpha = 0.65f)`
  const tint = props.favorite ? '#059669' : 'rgba(24, 25, 28, 0.65)';
  // L123: `containerAlpha = if (enabled) 1f else 0.4f`
  const containerAlpha = enabled ? 1 : 0.4;
  // `fill.animateTo(if (favorite) 1f else 0f, tween(if (reduceMotion) 100 else 260 | 180))`
  const fillMs = reduceMotion
    ? props.favorite
      ? FAV_FILL_MS_REDUCE
      : FAV_UNFILL_MS_REDUCE
    : props.favorite
      ? FAV_FILL_MS
      : FAV_UNFILL_MS;

  const handleClick = (): void => {
    // L158–164
    if (!enabled) {
      props.onDisabledClick?.();
      return;
    }
    props.onToggle(!props.favorite);
  };

  const handleLongPress = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    // L165–167: `onLongClick = { if (enabled) onLongPress?.invoke() else onDisabledClick?.invoke() }`
    event.preventDefault();
    if (enabled) props.onLongPress?.();
    else props.onDisabledClick?.();
  };

  return (
    <button
      type="button"
      className={[
        'fav-heart-button',
        showLabel ? 'fav-heart-button--labelled' : 'fav-heart-button--icon',
        props.favorite ? 'fav-heart-button--on' : '',
        enabled ? '' : 'fav-heart-button--disabled',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      // L148–153: `semantics { role = Role.Button; contentDescription = … }`
      aria-label={!enabled ? disabledHint : props.favorite ? FAV_ARIA_ON : FAV_ARIA_OFF}
      aria-disabled={!enabled}
      style={{
        opacity: containerAlpha,
        transform: `scale(${String(pressScale * scale)})`,
        transition: `transform ${String(FAV_PRESS_MS)}ms ease-out`,
      }}
      onClick={handleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onContextMenu={handleLongPress}
    >
      <span className="fav-heart-button__row">
        <HeartGlyph favorite={props.favorite} fill={fill} scale={scale} tint={tint} fillMs={fillMs} />
        {showLabel ? (
          <span className="fav-heart-button__label" style={{ color: tint }}>
            {props.favorite ? '已喜欢' : '喜欢'}
          </span>
        ) : null}
      </span>
      {/* L191–194: `if (!reduceMotion && burstId > 0 && burst.value < 1f)` */}
      {!reduceMotion && burstId > 0 && burst < 1 ? (
        <HeartBurst progress={burst} color={HeartMid} />
      ) : null}
    </button>
  );
}

/** 心形本体：描边 → 实心从中心扩散（两个图标叠加按 fill 交叉淡化）。 — L198–239 */
function HeartGlyph(props: {
  favorite: boolean;
  fill: number;
  scale: number;
  tint: string;
  fillMs: number;
}) {
  return (
    <span className="fav-heart-button__glyph">
      {/* 空心态：Material 的描边心足够干净，保留。
          已喜欢时描边改成心形的正红，淡出过程才不会出现"薄荷绿→正红"的脏交叉过渡。 */}
      <svg
        viewBox="0 0 24 24"
        style={{ opacity: 1 - props.fill, transition: `opacity ${String(props.fillMs)}ms linear` }}
        aria-hidden="true"
      >
        <path
          className="fav-heart-button__outline"
          d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"
          stroke={props.favorite ? HeartMid : props.tint}
        />
      </svg>
      {/* 实心态：**必须是 [HeartArt]** —— Material 自带的实心心形图标是纯色扁平剪影，
          和空心态那颗渐变心不是同一个东西，点亮瞬间会"换个材质"。
          渐变心从中心长出来（0.6 → 1.0），外发光随 fill 淡入。 */}
      <span
        style={{
          position: 'absolute',
          inset: '2px',
          opacity: props.fill,
          transform: `scale(${String(0.6 + 0.4 * props.fill)})`,
          transition: `opacity ${String(props.fillMs)}ms linear, transform ${String(props.fillMs)}ms linear`,
        }}
      >
        <HeartArt size={20} glow={props.fill * 1.1} />
      </span>
    </span>
  );
}

/** 6~8 个小心形/圆点粒子：从中心向外飘散并淡出（≈600ms）。 — L241–275 */
function HeartBurst(props: { progress: number; color: string }) {
  const count = FAV_BURST_COUNT;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2.0 * i) / count - Math.PI / 2.0;
    const distance = 14 + 26 * props.progress;
    const alpha = Math.max(0, Math.min(1, 1 - props.progress));
    const size = Math.max(1, 7 - 3 * props.progress);
    const isHeart = i % 2 === 0;
    // L255–259: `graphicsLayer { translationX/Y = cos/sin(angle) * distance; alpha;
    //            scaleX/Y = 1f - 0.3f * progress }`
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    const particleScale = 1 - 0.3 * props.progress;
    items.push(
      <span
        // Kotlin `repeat(count) { i -> … }` — index is the stable identity here.
        key={`fav-burst-${String(i)}`}
        className="fav-heart-button__burst"
        style={{
          left: `calc(50% + ${String(tx)}px)`,
          top: `calc(50% + ${String(ty)}px)`,
          width: `${String(size)}px`,
          height: `${String(size)}px`,
          opacity: alpha,
          transform: `scale(${String(particleScale)})`,
        }}
      >
        {isHeart ? (
          // 粒子的心也用同一颗渐变心（4~7dp 下渐变几乎看不出来，
          // 但外轮廓是同一套贝塞尔，缩放时不会变形）
          <HeartArt size={size} glow={0} />
        ) : (
          <span
            className="fav-heart-button__burst-dot"
            style={{ background: props.color, width: '100%', height: '100%' }}
          />
        )}
      </span>,
    );
  }
  return <span className="fav-heart-button__burst-layer">{items}</span>;
}

/** 顶部栏/卡片右下角的纯图标小心形（热区仍保证 ≥48dp）。 — L277–293 */
export function FavoriteHeartIcon(props: {
  favorite: boolean;
  onToggle: (favorite: boolean) => void;
  enabled?: boolean;
  size?: number;
}) {
  return (
    <FavoriteHeartButton
      favorite={props.favorite}
      onToggle={props.onToggle}
      // `exactOptionalPropertyTypes` is on: pass `undefined` only when absent.
      {...(props.enabled === undefined ? {} : { enabled: props.enabled })}
      showLabel={false}
    />
  );
}

export { HeartArtDefaultSize };

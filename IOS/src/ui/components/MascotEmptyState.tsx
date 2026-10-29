import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { hsvToHex, withAlpha } from '../../core/glass/color';
import { mascotMoodOf, type MascotMood } from '../../core/mascot/mascotSpriteSheet';
import { useRenderQuality } from './GlassQuality';
import { AppButton } from './AppButton';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/MascotEmptyState.kt` (195 non-blank lines) — FULL PORT
 *   lines 39-40  `mascotMoodOf(mascotResId)` / `mascotAnimOn`  → moodOf() + LOW gate
 *   lines 42-106 the five mood-driven infinite animations (float / breath /
 *                 bounce / runJitter / sadAlpha) — all `infiniteRepeatable(tween, Reverse)`
 *   lines 108-113 `scale` / `shiftX` / `alpha` selection by mood
 *   lines 115-206 Card(24dp, surface@0.85, consistentShadow 2dp) + Column layout
 *   line 151    `painterResource(mascotResId)` → `<img src>`
 *
 * Android per-mood parameters, verbatim:
 *   float:  -6f → 6f, 2200ms (3200ms when SAD), EaseInOutSine, Reverse
 *   breath: 0.97f → 1.04f, 2400ms (3600ms when SAD), EaseInOutSine, Reverse
 *   bounce: 1f → 1.08f, 500ms, FastOutSlowInEasing, Reverse          (HAPPY only)
 *   run:    -4f → 4f, 260ms, EaseInOutSine, Reverse                 (RUN only)
 *   sad:    0.9f → 1f, 2000ms, EaseInOutSine, Reverse                (SAD only)
 *
 * ADAPTATION
 * - `rememberInfiniteTransition` → one rAF loop reading a phase clock, so the
 *   five signals stay exactly in phase as they do in Compose (all five share the
 *   *same* `rememberInfiniteTransition(label = "mascot_float")` instance on Kotlin).
 * - `painterResource` → `<img>`; `LocalRenderQuality.LOW` skips every decorative
 *   loop animation, which is preserved.
 */

export interface MascotEmptyStateProps {
  /** Asset URL for the mascot image (Kotlin `painterResource(mascotResId)`). */
  mascotSrc: string;
  /**
   * Kotlin derived the mood from the drawable id (`mascotMoodOf(resId)`).
   * The web has an asset URL instead, so the mood is an explicit prop; when it is
   * omitted the IDLE track is used (the same fallback `mascotMoodOf` returns for
   * any unrecognised asset).
   */
  mood?: MascotMood;
  title: string;
  description: string;
  className?: string;
  style?: CSSProperties;
  actionLabel?: string | null;
  onActionClick?: (() => void) | null;
  /** Kotlin default `"mascot_empty_state"`. */
  testTagPrefix?: string;
  /** Brand mint; Kotlin `MintPrimary`. */
  primary?: string;
}

export function MascotEmptyState(props: MascotEmptyStateProps) {
  const quality = useRenderQuality();
  // 流畅档（渲染画质=低）：跳过全部装饰性循环动画，静态展示以省电省性能
  const mascotAnimOn = quality !== 'LOW';
  // 根据素材情绪选择动效；未给出 mood 时走 mascotMoodOf 的 IDLE 兜底分支
  const mood: MascotMood =
    props.mood ?? mascotMoodOf(mascotAssetKeyFor(props.mascotSrc));
  const primary = props.primary ?? '#059669';
  const prefix = props.testTagPrefix ?? 'mascot_empty_state';

  const phase = useMoodPhase(mascotAnimOn, mood);

  const floatOffset = moodDuration(mood) === 3200 ? range(-6, 6, phase, 3200) : range(-6, 6, phase, 2200);
  const breath = moodDuration(mood) === 3600 ? range(0.97, 1.04, phase, 3600) : range(0.97, 1.04, phase, 2400);
  const happyBounce = range(1, 1.08, phase, 500);
  const runJitter = range(-4, 4, phase, 260);
  const sadAlpha = range(0.9, 1, phase, 2000);

  // 根据素材情绪选择动效：呼吸/漂浮/弹跳/奔跑抖动/低落摇摆，让静态图"活"起来
  const scale = mood === 'HAPPY' ? happyBounce : breath;
  const shiftX = mood === 'RUN' ? runJitter : 0;
  const alpha = mood === 'SAD' ? sadAlpha : 1;

  const [imgOk, setImgOk] = useState(true);

  return (
    <div
      className={['mascot-empty-state', props.className ?? ''].filter(Boolean).join(' ')}
      data-testid={prefix}
      style={props.style}
    >
      <div className="mascot-empty-state__body">
        <div className="mascot-empty-state__glow">
          {imgOk ? (
            <img
              className="mascot-empty-state__image"
              src={props.mascotSrc}
              alt="Mascot Roxy Empty State Illustration"
              data-testid={`${prefix}_mascot_image`}
              style={{
                transform: `translate(${shiftX}px, ${floatOffset}px) scale(${scale})`,
                opacity: alpha,
              }}
              onError={() => setImgOk(false)}
            />
          ) : (
            <span
              className="mascot-empty-state__image mascot-empty-state__image--fallback"
              data-testid={`${prefix}_mascot_image`}
              aria-label="Mascot Roxy Empty State Illustration"
            >
              🐾
            </span>
          )}
        </div>

        <div style={{ height: 20 }} />

        <p className="mascot-empty-state__title" data-testid={`${prefix}_title`}>
          {props.title}
        </p>

        <div style={{ height: 8 }} />

        <p
          className="mascot-empty-state__description"
          data-testid={`${prefix}_description`}
        >
          {props.description}
        </p>

        {props.actionLabel != null && props.onActionClick != null ? (
          <>
            <div style={{ height: 24 }} />
            <AppButton
              variant="primary"
              size="md"
              onClick={props.onActionClick}
              data-testid={`${prefix}_action_button`}
            >
              {props.actionLabel}
            </AppButton>
          </>
        ) : null}
      </div>
      {/* 背景光晕：Brush.radialGradient(MintPrimary@0.12 → Transparent) */}
      <span
        aria-hidden="true"
        className="mascot-empty-state__halo"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${withAlpha(primary, 0.12)} 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
    </div>
  );
}

/** The per-mood duration tweak for the float / breath tracks. */
function moodDuration(mood: MascotMood): number {
  return mood === 'SAD' ? 3200 : 2200;
}

/**
 * `mascotMoodOf(drawableId)` compared against the R.drawable *keys*; the web only
 * has a URL, so the trailing path segment is matched against the same keys
 * (`mascot_idle`, `mascot_sad`, …). Anything unrecognised → the IDLE branch,
 * exactly as the Kotlin `else -> MascotMood.IDLE` did.
 */
function mascotAssetKeyFor(src: string): string {
  const tail = src.split('/').pop() ?? src;
  return tail.replace(/\.[a-z0-9]+$/i, '');
}

/**
 * One shared phase clock. Compose uses a *single*
 * `rememberInfiniteTransition(label = "mascot_float")` for all five signals, so
 * they are phase-locked; a single rAF clock reproduces that exactly.
 * Each track then applies its own EaseInOutSine / FastOutSlowIn shape over the
 * portion of the cycle that its own `tween(duration)` would have covered.
 */
function useMoodPhase(enabled: boolean, _mood: MascotMood): number {
  const [t, setT] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = typeof performance !== 'undefined' ? performance.now() : 0;
    let alive = true;
    const step = (): void => {
      if (!alive) return;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      // 3600ms is the longest track; wrapping at the LCM keeps all tracks
      // continuous across the wrap because each uses its own duration divisor.
      ref.current = (ref.current + (now - last)) % 3600;
      last = now;
      setT(ref.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  void _mood;
  return t;
}

/**
 * Reverse-repeating tween value at time `t` within a `duration` track.
 * `infiniteRepeatable(tween(duration), RepeatMode.Reverse)` is a triangle wave.
 * The easing is applied to the ramp half:
 *  - EaseInOutSine → 0.5 − 0.5·cos(π·x)
 *  - FastOutSlowInEasing → the Material standard curve (cubic-bezier(0.4,0,0.2,1))
 */
function range(from: number, to: number, t: number, duration: number): number {
  const cycle = (t % (duration * 2)) / duration;
  const x = cycle <= 1 ? cycle : 2 - cycle;
  const eased = easeInOutSine(x);
  return from + (to - from) * eased;
}

function easeInOutSine(x: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export { hsvToHex };
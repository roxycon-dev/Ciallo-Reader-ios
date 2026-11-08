import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CONFETTI_SEEDS,
  MASCOT_DURATION_MS,
  popupAlphaComplete,
  popupScaleComplete,
  type MotionTransform,
} from '../../../core/mascot/mascotEvents';
import { MascotSpriteSheet, mascotAssetUrl } from '../../../core/mascot/mascotSpriteSheet';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/BookCompleteAnimation.kt` (162 non-blank lines) — FULL PORT
 *   lines 30-38  `Animatable(0f)` → `tween(1400, LinearEasing)` + onComplete
 *   lines 42-47  the `popupScale` breakpoints (0.15 / 0.24 / 0.85)
 *   lines 49-53  the `popupAlpha` breakpoints (0.12 / 0.85)
 *   lines 56-80  the 6-phase Roxy 三段动作 keyframes (蓄力 → 跳起双跳 → 落地 → 收势)
 *   line 83      `currentDrawableRes = MascotSpriteSheet.celebrateDrawable`
 *   lines 86-137 the 金色庆祝彩带粒子 (10 dots, 4-colour cycle)
 *   lines 139-179 the popup content (image + 🎉 / Roxy 为你欢呼)
 *
 * ADAPTATION — `Animatable.animateTo(tween(1400, LinearEasing))` → a rAF clock, so
 * the keyframe *values* (not a CSS approximation) drive the transforms; this keeps
 * the piecewise-linear curves with their hard phase boundaries exactly as written.
 *
 * REVIEW 2026-10-06
 *   F2 `MASCOT_CELEBRATE_SRC` was the literal `'mascot_celebrate.png'`, a file
 *      that never existed in `public/` → `onError` hid the mascot. Now routed
 *      through `mascotAssetUrl()` (the real shipped `.webp`).
 *   F10 `useTween` listed `onComplete` in its effect deps. Kotlin's
 *      `LaunchedEffect(Unit)` restarts **only** when the composable is re-created
 *      (i.e. the `key(id)` change in `MascotOverlay`), never on an unrelated
 *      recomposition. The inline `onComplete` closure got a new identity on every
 *      parent render, so any unrelated re-render of the host restarted the tween
 *      from t=0. `onComplete` now goes through a ref and the effect keys on
 *      `durationMs` only — identical to `LaunchedEffect(Unit)`.
 */

export function BookCompleteAnimation(props: { onComplete: () => void }) {
  const progress = useTween(MASCOT_DURATION_MS.bookComplete, props.onComplete);

  const popupScale = popupScaleComplete(progress);
  const popupAlpha = popupAlphaComplete(progress);
  const transform = bookCompleteTransform(progress);

  /* 素材：庆祝姿态全程 */
  const currentDrawableRes = MascotSpriteSheet.celebrateDrawable;

  return (
    <div
      className="mascot-popup mascot-popup--complete"
      style={{
        transform: `scale(${popupScale})`,
        opacity: popupAlpha,
        background: 'linear-gradient(180deg, rgba(42, 36, 24, 0.949) 0%, rgba(30, 26, 16, 0.949) 100%)',
        borderColor: 'transparent',
        boxShadow: '0 24px 48px rgba(240, 185, 94, 0.55)',
      }}
    >
      <MascotPrismBorder from="#F0B95E" fromAlpha={0.9} to="#D9A441" toAlpha={0.35} />

      {/* 彩带粒子层 */}
      <ConfettiLayer progress={progress} />

      <div className="mascot-popup__column">
        <div className="mascot-popup__figure">
          <img
            src={mascotAssetUrl(currentDrawableRes)}
            alt="Roxy 庆祝"
            style={{
              transform: `translateY(${transform.translationOffset}px) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotationDeg}deg)`,
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <div style={{ height: 10 }} />

        <p className="mascot-popup__title" style={{ color: '#F0B95E' }}>
          🎉 恭喜读完这本书！
        </p>

        <div style={{ height: 4 }} />

        <p className="mascot-popup__subtitle">Roxy 为你欢呼 ～✨</p>
      </div>
    </div>
  );
}

/**
 * BookCompleteAnimation.kt lines 56-80 — Roxy 三段动作：
 * 蓄力 → 跳起欢呼（双跳）→ 落地。 Each branch is a linear ramp over its slice.
 */
export function bookCompleteTransform(progress: number): MotionTransform {
  if (progress < 0.12) return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
  if (progress < 0.28) {
    const p = (progress - 0.12) / 0.16;
    return {
      scaleX: 1 + p * 0.2,
      scaleY: 1 - p * 0.2,
      translationOffset: p * 10,
      rotationDeg: -p * 3,
    }; // 蓄力下蹲
  }
  if (progress < 0.5) {
    const p = (progress - 0.28) / 0.22;
    return {
      scaleX: 1.2 - p * 0.38,
      scaleY: 0.8 + p * 0.42,
      translationOffset: 10 - p * 44,
      rotationDeg: -3 + p * 10,
    }; // 第一跳
  }
  if (progress < 0.68) {
    const p = (progress - 0.5) / 0.18;
    return {
      scaleX: 0.84 + p * 0.3,
      scaleY: 1.16 - p * 0.3,
      translationOffset: -34 + p * 30,
      rotationDeg: 7 - p * 6,
    }; // 落地
  }
  if (progress < 0.84) {
    const p = (progress - 0.68) / 0.16;
    return {
      scaleX: 1.16 - p * 0.3,
      scaleY: 0.88 + p * 0.34,
      translationOffset: -4 - p * 40,
      rotationDeg: 1 - p * 5,
    }; // 二连跳
  }
  const p = Math.max(0, Math.min(1, (progress - 0.84) / 0.16));
  return {
    scaleX: 0.86 + p * 0.2,
    scaleY: 1.22 - p * 0.27,
    translationOffset: -44 + p * 44,
    rotationDeg: 2 - p * 2,
  }; // 收势
}

/** BookCompleteAnimation.kt lines 85-137 — 金色庆祝彩带粒子. */
function ConfettiLayer(props: { progress: number }) {
  return (
    <div className="mascot-popup__confetti" aria-hidden="true">
      {CONFETTI_SEEDS.map((seed, i) => {
        const t = (props.progress * 1.4 + seed.x) % 1;
        const dir = i % 2 === 0 ? -1 : 1;
        const color = [GOLD, MINT, WHITE, CORAL][i % 4] ?? GOLD;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: i % 3 === 0 ? 5 : 3,
              height: i % 3 === 0 ? 5 : 3,
              borderRadius: '50%',
              background: color,
              opacity: (1 - t) * 0.9,
              transform: `translate(${dir * (30 + seed.y * 60) * t}px, ${-t * 90 + seed.x * 40}px)`,
            }}
          />
        );
      })}
    </div>
  );
}

const GOLD = '#F0B95E';
const MINT = '#52D1AC';
const WHITE = '#FFFFFF';
const CORAL = '#E17055';

/** Shared popup chrome: 1.5dp gradient border (Mascot*Animation.kt lines 105-114). */
export function MascotPrismBorder(props: {
  from: string;
  fromAlpha: number;
  to: string;
  toAlpha: number;
  children?: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="mascot-popup__border"
        style={{
          backgroundImage: `linear-gradient(${props.from} ${props.fromAlpha}, ${props.to} ${props.toAlpha})`,
        }}
      />
    </>
  );
}

/**
 * `Animatable.animateTo(target, tween(duration, LinearEasing))` + `onComplete()`.
 * LinearEasing → the raw `p` value (no easing curve), so the Kotlin keyframe
 * breakpoints land at exactly the same instants.
 *
 * REVIEW 2026-10-06 (F10) — the effect keys on `durationMs` only, mirroring
 * `LaunchedEffect(Unit)`. `onComplete` is read through a ref so an unrelated
 * parent re-render cannot restart the tween; the restart-on-interrupt path is
 * `MascotOverlay`'s `key={instance.id}` (Kotlin `key(currentInstance?.id)`),
 * which remounts the component and therefore re-runs this effect from t = 0.
 */
export function useTween(durationMs: number, onComplete: () => void): number {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const [p, setP] = useState(0);
  useEffect(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    let done = false;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / durationMs);
      setP(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else if (!done) {
        done = true;
        onCompleteRef.current();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  return p;
}

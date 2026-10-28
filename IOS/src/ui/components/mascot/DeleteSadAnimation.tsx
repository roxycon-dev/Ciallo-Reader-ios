import {
  MASCOT_DURATION_MS,
  popupAlphaStandard,
  popupScaleStandard,
  type MotionTransform,
} from '../../../core/mascot/mascotEvents';
import { MascotSpriteSheet, mascotAssetUrl } from '../../../core/mascot/mascotSpriteSheet';
import { MascotPrismBorder, useTween } from './BookCompleteAnimation';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/DeleteSadAnimation.kt` (138 non-blank lines) — FULL PORT
 *   lines 26-34  `Animatable(0f)` → `tween(850, LinearEasing)` + onComplete
 *   lines 39-44  `popupScale` (0.2 / 0.28 / 0.8)
 *   lines 46-51  `popupAlpha` (0.15 / 0.8)
 *   lines 53-71  the 3-phase sad transform (Shrink → Shiver → Sigh)
 *   lines 74-77  the pose switch (idle → sad)
 *   lines 79-107 the popup chrome (spotColor 0xFFFF6B81, gradient border)
 *   lines 109-149 image + 「🌧️ 成功移出书架」 + 「别难过，随时可以在新分类重新找到它~」
 *
 * REVIEW 2026-10-06 (F2) — `src` was `` `${currentDrawableRes}.png` ``, a path that
 * never existed in `public/` (Android ships `mascot_*.webp`) → 404 + hidden `<img>`.
 * Now `mascotAssetUrl(key)`.
 */

export function DeleteSadAnimation(props: { onComplete: () => void }) {
  const progress = useTween(MASCOT_DURATION_MS.deleteSad, props.onComplete);
  const popupScale = popupScaleStandard(progress);
  const popupAlpha = popupAlphaStandard(progress);
  const transform = deleteSadTransform(progress);

  // Keyframe pose switching
  const currentDrawableRes =
    progress < 0.25 ? MascotSpriteSheet.idleDrawable : MascotSpriteSheet.sadDrawable;

  return (
    <div
      className="mascot-popup mascot-popup--delete"
      style={{
        transform: `scale(${popupScale})`,
        opacity: popupAlpha,
        background: 'linear-gradient(180deg, rgba(40, 24, 34, 0.949) 0%, rgba(28, 18, 26, 0.949) 100%)',
        boxShadow: '0 24px 48px rgba(255, 107, 129, 0.55)',
      }}
    >
      <MascotPrismBorder from="#FF6B81" fromAlpha={0.8} to="#E91E63" toAlpha={0.3} />

      <div className="mascot-popup__column">
        <div className="mascot-popup__figure">
          <img
            src={mascotAssetUrl(currentDrawableRes)}
            alt="Sad Mascot"
            style={{
              transform: `translateX(${transform.translationOffset}px) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotationDeg}deg)`,
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <div style={{ height: 10 }} />

        <p className="mascot-popup__title" style={{ color: '#FF6B81' }}>
          🌧️ 成功移出书架
        </p>

        <div style={{ height: 4 }} />

        <p className="mascot-popup__subtitle mascot-popup__subtitle--muted">
          别难过，随时可以在新分类重新找到它~
        </p>
      </div>
    </div>
  );
}

/**
 * DeleteSadAnimation.kt lines 53-71 — 3-Phase Sad Motion:
 * Anticipation (Shrink) -> Action (Shiver) -> Recovery (Sigh)
 */
export function deleteSadTransform(progress: number): MotionTransform {
  if (progress < 0.18) return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
  if (progress < 0.35) {
    const p = (progress - 0.18) / 0.17;
    return {
      scaleX: 1 - p * 0.15,
      scaleY: 1 - p * 0.1,
      translationOffset: 0,
      rotationDeg: p * 6,
    }; // Shrink
  }
  if (progress < 0.65) {
    const p = (progress - 0.35) / 0.3;
    const shiver = Math.sin(p * Math.PI * 6) * 10;
    return {
      scaleX: 0.85 + Math.sin(p * Math.PI * 4) * 0.1,
      scaleY: 0.9,
      translationOffset: shiver,
      rotationDeg: 6 - p * 12,
    }; // Shiver
  }
  if (progress < 0.82) {
    const p = (progress - 0.65) / 0.17;
    return {
      scaleX: 0.95 + p * 0.05,
      scaleY: 0.9 + p * 0.1,
      translationOffset: 0,
      rotationDeg: -6 + p * 6,
    }; // Sigh
  }
  return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
}
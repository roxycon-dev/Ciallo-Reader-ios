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
 * - `ui/mascot/MoveBookAnimation.kt` (137 non-blank lines) — FULL PORT
 *   lines 26-34  `Animatable(0f)` → `tween(850, LinearEasing)` + onComplete
 *   lines 39-44  `popupScale` (0.2 / 0.28 / 0.8)
 *   lines 46-51  `popupAlpha` (0.15 / 0.8)
 *   lines 53-70  the 3-phase transform (Lean left anticipation → Carry swing → Settle nod)
 *   lines 73-77  the pose switch (idle → move)
 *   lines 78-107 the popup chrome (spotColor 0xFF5CB8E4, gradient border)
 *   lines 109-148 image + 「📦 已移动到新书架」 + 「藏书整理得整整齐齐啦~」
 *
 * REVIEW 2026-10-06 (F2) — `src` was `` `${currentDrawableRes}.png` ``, a path that
 * never existed in `public/` (Android ships `mascot_*.webp`) → 404 + hidden `<img>`.
 * Now `mascotAssetUrl(key)`.
 */

export function MoveBookAnimation(props: { onComplete: () => void }) {
  const progress = useTween(MASCOT_DURATION_MS.moveBook, props.onComplete);
  const popupScale = popupScaleStandard(progress);
  const popupAlpha = popupAlphaStandard(progress);
  const transform = moveBookTransform(progress);

  // Keyframe pose switching
  const currentDrawableRes =
    progress < 0.25 ? MascotSpriteSheet.idleDrawable : MascotSpriteSheet.moveDrawable;

  return (
    <div
      className="mascot-popup mascot-popup--move"
      style={{
        transform: `scale(${popupScale})`,
        opacity: popupAlpha,
        background: 'linear-gradient(180deg, rgba(22, 34, 42, 0.949) 0%, rgba(16, 24, 32, 0.949) 100%)',
        boxShadow: '0 24px 48px rgba(92, 184, 228, 0.55)',
      }}
    >
      <MascotPrismBorder from="#5CB8E4" fromAlpha={0.8} to="#03A9F4" toAlpha={0.3} />

      <div className="mascot-popup__column">
        <div className="mascot-popup__figure">
          <img
            src={mascotAssetUrl(currentDrawableRes)}
            alt="Move Mascot"
            style={{
              transform: `translateX(${transform.translationOffset}px) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotationDeg}deg)`,
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <div style={{ height: 10 }} />

        <p className="mascot-popup__title" style={{ color: '#5CB8E4' }}>
          📦 已移动到新书架
        </p>

        <div style={{ height: 4 }} />

        <p className="mascot-popup__subtitle mascot-popup__subtitle--muted">
          藏书整理得整整齐齐啦~
        </p>
      </div>
    </div>
  );
}

/**
 * MoveBookAnimation.kt lines 53-70 — 3-Phase Move Motion:
 * Anticipation -> Action -> Recovery
 */
export function moveBookTransform(progress: number): MotionTransform {
  if (progress < 0.18) return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
  if (progress < 0.35) {
    const p = (progress - 0.18) / 0.17;
    return {
      scaleX: 1.1,
      scaleY: 0.92,
      translationOffset: -15 * p,
      rotationDeg: -10 * p,
    }; // Lean left anticipation
  }
  if (progress < 0.65) {
    const p = (progress - 0.35) / 0.3;
    return {
      scaleX: 0.92 + p * 0.16,
      scaleY: 1.08 - p * 0.16,
      translationOffset: -15 + p * 30,
      rotationDeg: -10 + p * 20,
    }; // Carry swing action
  }
  if (progress < 0.82) {
    const p = (progress - 0.65) / 0.17;
    return {
      scaleX: 1.08 - p * 0.08,
      scaleY: 0.92 + p * 0.08,
      translationOffset: 15 - p * 15,
      rotationDeg: 10 - p * 10,
    }; // Settle nod recovery
  }
  return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
}
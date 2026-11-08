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
 * - `ui/mascot/BookmarkHappyAnimation.kt` (138 non-blank lines) — FULL PORT
 *   lines 26-34  `Animatable(0f)` → `tween(850, LinearEasing)` + onComplete
 *   lines 39-44  `popupScale` (0.2 / 0.28 / 0.8 breakpoints)
 *   lines 46-51  `popupAlpha` (0.15 / 0.8)
 *   lines 53-70  the 3-phase transform (蓄力下蹲 → 跳起 → 落地)
 *   lines 73-77  the keyframe pose switch (idle → bookmark → happy)
 *   lines 79-107 the popup chrome (24dp, spotColor 0xFF52D1AC, gradient border)
 *   lines 109-149 image + 「✨ 书签已保存」 + 「Ciallo～(∠・ω< )⌒★」
 *
 * All four mascot animations share the popup scale/alpha curves, so they live in
 * `core/mascot/mascotEvents.ts` (`popupScaleStandard` / `popupAlphaStandard`).
 *
 * REVIEW 2026-10-06 (F2) — `src` was `` `${currentDrawableRes}.png` ``, a path
 * that never existed in `public/` (the Android art ships as `mascot_*.webp`), so
 * the `<img>` 404'd and `onError` hid it. Now `mascotAssetUrl(key)`.
 */

export function BookmarkHappyAnimation(props: { onComplete: () => void }) {
  const progress = useTween(MASCOT_DURATION_MS.bookmarkHappy, props.onComplete);
  const popupScale = popupScaleStandard(progress);
  const popupAlpha = popupAlphaStandard(progress);
  const transform = bookmarkTransform(progress);

  // Keyframe pose switching based on animation phase
  const currentDrawableRes =
    progress < 0.25
      ? MascotSpriteSheet.idleDrawable
      : progress < 0.75
        ? MascotSpriteSheet.bookmarkDrawable
        : MascotSpriteSheet.happyDrawable;

  return (
    <div
      className="mascot-popup mascot-popup--bookmark"
      style={{
        transform: `scale(${popupScale})`,
        opacity: popupAlpha,
        background: 'linear-gradient(180deg, rgba(28, 34, 48, 0.949) 0%, rgba(19, 22, 34, 0.949) 100%)',
        boxShadow: '0 24px 48px rgba(82, 209, 172, 0.55)',
      }}
    >
      <MascotPrismBorder from="#52D1AC" fromAlpha={0.8} to="#4DB6AC" toAlpha={0.3} />

      <div className="mascot-popup__column">
        <div className="mascot-popup__figure">
          <img
            src={mascotAssetUrl(currentDrawableRes)}
            alt="Bookmark Mascot"
            style={{
              transform: `translateY(${transform.translationOffset}px) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotationDeg}deg)`,
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <div style={{ height: 10 }} />

        <p className="mascot-popup__title" style={{ color: '#52D1AC' }}>
          ✨ 书签已保存
        </p>

        <div style={{ height: 4 }} />

        <p className="mascot-popup__subtitle">Ciallo～(∠・ω&lt; )⌒★</p>
      </div>
    </div>
  );
}

/**
 * BookmarkHappyAnimation.kt lines 53-70 — Mascot 3-Phase Motion:
 * Anticipation (Crouch) -> Action (Leap) -> Recovery (Land)
 */
export function bookmarkTransform(progress: number): MotionTransform {
  if (progress < 0.15) return { scaleX: 1, scaleY: 1, translationOffset: 0, rotationDeg: 0 };
  if (progress < 0.32) {
    const p = (progress - 0.15) / 0.17;
    return {
      scaleX: 1 + p * 0.22,
      scaleY: 1 - p * 0.22,
      translationOffset: p * 12,
      rotationDeg: -p * 4,
    }; // Crouch
  }
  if (progress < 0.62) {
    const p = (progress - 0.32) / 0.3;
    return {
      scaleX: 1.22 - p * 0.4,
      scaleY: 0.78 + p * 0.45,
      translationOffset: 12 - p * 48,
      rotationDeg: -4 + p * 12,
    }; // Leap
  }
  if (progress < 0.82) {
    const p = (progress - 0.62) / 0.2;
    return {
      scaleX: 0.82 + p * 0.24,
      scaleY: 1.23 - p * 0.28,
      translationOffset: -36 + p * 36,
      rotationDeg: 8 - p * 8,
    }; // Land
  }
  return { scaleX: 1.06, scaleY: 0.95, translationOffset: 0, rotationDeg: 0 };
}
import { useCallback, useEffect, useState } from 'react';
import { MascotAnimationController } from '../../../core/mascot/mascotEvents';
import type { MascotEventInstance } from '../../../core/mascot/mascotEvents';
import { BookCompleteAnimation } from './BookCompleteAnimation';
import { BookmarkHappyAnimation } from './BookmarkHappyAnimation';
import { DeleteSadAnimation } from './DeleteSadAnimation';
import { MoveBookAnimation } from './MoveBookAnimation';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/MascotAnimationController.kt` (85 non-blank lines) — FULL PORT
 *   lines 14-21  `sealed class MascotEvent`   → core MascotEvent union
 *   lines 26-33  `data class MascotEventInstance` → core, `AtomicLong` id preserved
 *   lines 38-43  `data class MotionTransform` → core
 *   lines 56-63  `object MascotAnimationController` → core subscriber set
 *   lines 70-100 `@Composable MascotOverlay(modifier)` → MascotOverlay
 *
 * Interruption Strategy A, verbatim:
 *   当用户快速连续触发操作（例如 3 秒内连续添加 5 次书签或连续点击移动）时，如果使用队列策略
 *   (Queue)，动画会无限排队延迟播放，导致界面操作体验显得滞后黏性。
 *   采用【打断重播策略】，每次新事件触发时会发出一个新的 MascotEventInstance（带唯一 ID）。
 *   界面层收到新事件时，会直接打断当前未播完的旧动画，并重置入场动画从 t=0 开始为新事件播放。
 *
 * ADAPTATION — `key(currentInstance?.id)` → `key={instance.id}` on the animation
 * element, which is React's exact equivalent of the Compose `key()` block: the
 * subtree is torn down and remounted, so the animation restarts at t = 0 with no
 * leftover state.
 *
 * REVIEW 2026-10-06 (F9) — the header above documented `key={instance.id}`, but the
 * JSX never had it. Without the key React reused the mounted component when two
 * consecutive events were the same type, and the tween only restarted because
 * `useTween` happened to list `onComplete` in its deps (now removed, see
 * `BookCompleteAnimation.tsx`). The key is restored so 方案 A (打断重播) is
 * implemented by the same mechanism as Compose: a full remount at t = 0.
 */

export { MascotAnimationController };
export type { MascotEventInstance };

/**
 * Screen Center Duolingo-Style Floating Mascot Feedback Overlay.
 * Appears in the center of the screen with non-blocking interaction.
 */
export function MascotOverlay(props: { className?: string }) {
  // One slot: the newest instance always wins, which *is* Interruption Strategy A.
  // (Kotlin kept `latestEventInstance` + `currentInstance` and promoted inside a
  // `LaunchedEffect`; collapsing them into one observable is the same behaviour
  // without a `setState` inside an effect — React 19 `set-state-in-effect`.)
  const [current, setCurrent] = useState<MascotEventInstance | null>(null);

  useEffect(
    () =>
      MascotAnimationController.subscribe((instance) => {
        setCurrent(instance);
      }),
    [],
  );

  // `key(id) { when (...) }` — one stable closure identity so the remount (not a
  // prop change) is what restarts the tween.
  const clear = useCallback((): void => setCurrent(null), []);

  if (current === null) return null;

  return (
    <div className={['mascot-overlay', props.className ?? ''].filter(Boolean).join(' ')}>
      {current.event === 'DeleteBook' ? (
        <DeleteSadAnimation key={current.id} onComplete={clear} />
      ) : null}
      {current.event === 'AddBookmark' ? (
        <BookmarkHappyAnimation key={current.id} onComplete={clear} />
      ) : null}
      {current.event === 'MoveBook' ? (
        <MoveBookAnimation key={current.id} onComplete={clear} />
      ) : null}
      {current.event === 'BookComplete' ? (
        <BookCompleteAnimation key={current.id} onComplete={clear} />
      ) : null}
      {current.event === 'CleanComplete' ? (
        <BookCompleteAnimation key={current.id} onComplete={clear} />
      ) : null}
    </div>
  );
}
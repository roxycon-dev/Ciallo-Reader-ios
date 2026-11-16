/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/MascotAnimationController.kt` (85 non-blank lines)
 *
 *   lines 14-21   sealed class MascotEvent (5 objects) → MascotEvent union
 *   lines 26-33   data class MascotEventInstance + AtomicLong id → MascotEventInstance
 *   lines 38-43   data class MotionTransform → MotionTransform
 *   lines 56-63   object MascotAnimationController (MutableSharedFlow) → subscribe/play
 *   lines 70-100  @Composable MascotOverlay → src/ui/components/mascot/MascotAnimationController.tsx
 *
 * ADAPTATION — `MutableSharedFlow(extraBufferCapacity = 16)` → a subscriber Set
 * ────────────────────────────────────────────────────────────────────────────
 * `tryEmit` on a SharedFlow with a buffer never suspends and drops when the
 * buffer is full; `tryEmitLatest`-style "latest wins" behaviour is what the
 * Interruption Strategy A comment depends on, so a single `latest` slot plus a
 * synchronous fan-out to subscribers reproduces it exactly.
 */

/** MascotAnimationController.kt lines 14-21. */
export type MascotEvent =
  | 'DeleteBook'
  | 'AddBookmark'
  | 'MoveBook'
  | 'BookComplete'
  /** 清理缓存成功（B6：原先只有 Toast + 打勾，缺吉祥物反馈）。 */
  | 'CleanComplete';

/**
 * Event wrapper with a unique ID for interruption tracking.
 * MascotAnimationController.kt lines 26-33.
 */
export interface MascotEventInstance {
  event: MascotEvent;
  id: number;
}

let idCounter = 0;

/** Kotlin `AtomicLong(0).incrementAndGet()` — starts at 1. */
function nextId(): number {
  idCounter += 1;
  return idCounter;
}

/** Test seam so interruption-id assertions are deterministic. */
export function __resetMascotEventIds(): void {
  idCounter = 0;
}

/**
 * Mascot Animation Controller.
 *
 * 连续触发策略选择：【方案 A：打断重播策略 (Interruption Strategy)】
 * 选型原因：当用户快速连续触发操作（例如 3 秒内连续添加 5 次书签或连续点击移动）时，
 * 如果使用队列策略 (Queue)，动画会无限排队延迟播放，导致界面操作体验显得滞后黏性。
 * 采用【打断重播策略】，每次新事件触发时会发出一个新的 MascotEventInstance（带唯一 ID）。
 * 界面层收到新事件时，会直接打断当前未播完的旧动画，并重置入场动画从 t=0 开始为新事件播放。
 * 这确保了用户的每一次快速点击都能得到 100% 实时、即时、生动的反馈，没有任何事件丢失。
 */
type Subscriber = (instance: MascotEventInstance) => void;

const subscribers = new Set<Subscriber>();

export const MascotAnimationController = {
  /** Subscribe; returns the unsubscribe function (`asSharedFlow().collect`). */
  subscribe(cb: Subscriber): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  },

  /** `fun play(event: MascotEvent)` → `_events.tryEmit(MascotEventInstance(event))`. */
  play(event: MascotEvent): MascotEventInstance {
    const instance: MascotEventInstance = { event, id: nextId() };
    for (const cb of [...subscribers]) cb(instance);
    return instance;
  },

  /** Test seam. */
  subscriberCount(): number {
    return subscribers.size;
  },
};

/**
 * Data class representing 3-phase motion transformations
 * (Anticipation -> Action -> Recovery).  MascotAnimationController.kt lines 38-43.
 */
export interface MotionTransform {
  scaleX: number;
  scaleY: number;
  translationOffset: number;
  rotationDeg: number;
}

/**
 * The `popupScale` / `popupAlpha` curves are identical in all four animations
 * except BookComplete (different breakpoints), so they are shared here:
 *   scale: 0.4 → 1.08 overshoot → 1.00 settle → 0.8 exit
 *   alpha: 0 → 1 over the first 15%, holds, then fades out over the last 20%.
 * `src/ui/components/mascot/*.tsx` use these for the 0.2/0.28/0.8 keys and
 * `BookCompleteAnimation` uses its own (0.15/0.24/0.85).
 */
export function popupScaleStandard(progress: number): number {
  if (progress < 0.2) return 0.4 + (progress / 0.2) * 0.68;
  if (progress < 0.28) return 1.08 - ((progress - 0.2) / 0.08) * 0.08;
  if (progress > 0.8) return 1.0 - ((progress - 0.8) / 0.2) * 0.2;
  return 1.0;
}

export function popupAlphaStandard(progress: number): number {
  if (progress < 0.15) return progress / 0.15;
  if (progress > 0.8) return 1.0 - (progress - 0.8) / 0.2;
  return 1.0;
}

/** BookCompleteAnimation.kt lines 42-53 — its own breakpoints (0.15/0.24/0.85). */
export function popupScaleComplete(progress: number): number {
  if (progress < 0.15) return 0.4 + (progress / 0.15) * 0.68;
  if (progress < 0.24) return 1.08 - ((progress - 0.15) / 0.09) * 0.08;
  if (progress > 0.85) return 1.0 - ((progress - 0.85) / 0.15) * 0.2;
  return 1.0;
}

export function popupAlphaComplete(progress: number): number {
  if (progress < 0.12) return progress / 0.12;
  if (progress > 0.85) return 1.0 - (progress - 0.85) / 0.15;
  return 1.0;
}

/** Total tween duration of each animation (LaunchedEffect animateTo target). */
export const MASCOT_DURATION_MS = {
  bookComplete: 1400,
  bookmarkHappy: 850,
  deleteSad: 850,
  moveBook: 850,
} as const;

/**
 * Confetti seeds — BookCompleteAnimation.kt line 86 uses
 * `List(10) { Offset(Math.random(), Math.random()) }`.
 *
 * React rule: no `Math.random()` during render. The seeds are therefore drawn once
 * from a deterministic module-level LCG (so they are stable across re-renders and
 * across HMR), which is also what the Kotlin code effectively achieves via
 * `remember { }`. Visual result is identical.
 */
export const CONFETTI_SEEDS: readonly { x: number; y: number }[] = (() => {
  let s = 0x2f6e2b1 >>> 0;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: 10 }, () => ({ x: next(), y: next() }));
})();
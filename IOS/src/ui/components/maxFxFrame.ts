import { useEffect, useRef, type RefObject } from 'react';
import { maxFxPhases, type MaxFxPhases } from '../../core/glass/maxFx';

/**
 * One shared `requestAnimationFrame` clock for every MAX-tier card layer
 * (`MaxFx.kt` / `MaxCardEffects.kt`).
 *
 * Compose creates one `rememberInfiniteTransition` **per composable** and reads
 * it inside `drawBehind { }`, i.e. the animation never drives recomposition. The
 * web equivalent is a single module-level rAF that writes the layer's inline
 * style directly on the DOM node — no React state, no per-card frame callback,
 * and therefore no re-render while the sheen / aura / pearl are animating.
 *
 * Why this is not `@keyframes`: the stylesheet keyframes that used to drive these
 * layers (`glass-sheen-sweep`, `shimmer-pearl-drift`, `card-aura-breathe`,
 * `card-aura-hue` in `src/styles/components.css`) carry geometry that does not
 * match the Kotlin numbers; the phases are therefore evaluated here from the
 * Kotlin expressions in `core/glass/maxFx.ts`.
 */

type FrameListener = (phases: MaxFxPhases) => void;

const frameListeners = new Set<FrameListener>();
let frameHandle = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function frame(): void {
  frameHandle = 0;
  const phases = maxFxPhases(now());
  for (const cb of [...frameListeners]) cb(phases);
  if (frameListeners.size > 0) frameHandle = requestAnimationFrame(frame);
}

/**
 * Subscribe `node` to the shared MAX clock. `apply` receives the node plus the
 * five Kotlin transition phases and is expected to write an inline style.
 * Never triggers a React render.
 */
export function useMaxFxFrame(
  node: RefObject<HTMLElement | null>,
  apply: (el: HTMLElement, phases: MaxFxPhases) => void,
): void {
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);
  useEffect(
    () => {
      const cb: FrameListener = (phases) => {
        const el = node.current;
        if (el !== null) applyRef.current(el, phases);
      };
      frameListeners.add(cb);
      if (frameHandle === 0) frameHandle = requestAnimationFrame(frame);
      return () => {
        frameListeners.delete(cb);
        if (frameListeners.size === 0 && frameHandle !== 0) {
          cancelAnimationFrame(frameHandle);
          frameHandle = 0;
        }
      };
    },
    [node],
  );
}

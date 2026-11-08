import { type ReactNode } from 'react';
import { OVERLAY_ENTRANCE } from '../../core/glass/motion';

/**
 * Kotlin 鈫?TS map
 * 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
 * - `ui/components/OverlayAnimations.kt` (73 non-blank lines) 鈥?FULL PORT
 *   lines 27-48 `DialogEntrance`      鈫?DialogEntrance
 *   lines 51-71 `BottomSheetEntrance`  鈫?BottomSheetEntrance
 *   lines 74-88 `ScrimEntrance`       鈫?ScrimEntrance
 *
 * The Kotlin file uses `AnimatedVisibility(visibleState = MutableTransitionState(false)
 * .apply { targetState = true })` 鈥?i.e. the overlay mounts already-visible and the
 * *entrance* plays on the first frame.  React mounts the element with the animation
 * declared, so a CSS `animation` with no `fill-mode` replays exactly once on mount.
 *
 * All three `durationMillis` params are accepted for API parity; the actual timing
 * comes from the named transition each function uses (Android hard-codes the
 * durations inside `tween(...)`, ignoring the parameter 鈥?see the report).
 */

export interface EntranceProps {
  children: ReactNode;
  className?: string;
  /** Android's unused `durationMillis` param 鈥?kept for call-site parity. */
  durationMillis?: number;
  style?: React.CSSProperties;
}

/** 灞呬腑寮圭獥鍏ュ満锛氭贰鍏?+ 0.96鈫? 缂╂斁锛堜笌 Nav 寮圭獥杞満鍚屾鑺傚锛夈€?*/
export function DialogEntrance(props: EntranceProps) {
  const m = OVERLAY_ENTRANCE.dialog;
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--dialog', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ animation: m.animation, ...props.style }}
      data-duration-millis={props.durationMillis ?? m.durationMs}
    >
      {props.children}
    </div>
  );
}

/** 搴曢儴闈㈡澘鍏ュ満锛氭贰鍏?+ 浠庡簳閮ㄤ笂婊戯紙搴曢儴寮瑰眰/闀挎寜鎿嶄綔鑿滃崟锛夈€?*/
export function BottomSheetEntrance(props: EntranceProps) {
  const m = OVERLAY_ENTRANCE.bottomSheet;
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--sheet', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ animation: m.animation, ...props.style }}
      data-duration-millis={props.durationMillis ?? m.durationMs}
    >
      {props.children}
    </div>
  );
}

/** 閬僵灞傚叆鍦猴細绾贰鍏ワ紙涓嶆姠闈㈡澘涓讳綋鍔ㄧ敾锛夈€?*/
export function ScrimEntrance(props: EntranceProps) {
  const m = OVERLAY_ENTRANCE.scrim;
  return (
    <div
      className={['overlay-entrance', 'overlay-entrance--scrim', props.className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ animation: m.animation, ...props.style }}
      data-duration-millis={props.durationMillis ?? m.durationMs}
    >
      {props.children}
    </div>
  );
}


/**
 * Kotlin → TS: `app/src/main/java/com/example/ui/theme/ModifierExtensions.kt`
 *             (152 lines incl. trailing newline, 139 non-blank)
 *          → `src/core/ui-theme/modifierExtensions.ts`
 *
 * WHY DESCRIPTORS INSTEAD OF `Modifier`
 * ──────────────────────────────────────
 * All three Kotlin members are `Modifier` extensions built on `composed {}`, i.e. they run
 * inside the Compose composition: they read `MutableInteractionSource`, `LaunchedEffect`,
 * `LocalHapticFeedback` and `animateFloatAsState`. None of that exists on the web, so each
 * `Modifier.clickableXxx(…)` becomes a **framework-agnostic descriptor + resolver**:
 *
 *   Kotlin                                        → TS
 *   ─────────────────────────────────────────────────────────────────────────────────────
 *   Modifier.clickableWithFeedback(…)             → pressFeedback({ enabled, isPressed })
 *   Modifier.clickableRowFeedback(…)              → rowPressFeedback({ enabled, isPressed })
 *   Modifier.animateAlpha(target, ms, label)      → alphaTransition({ target, durationMillis, label })
 *
 * A descriptor is plain data: the numbers Compose would have animated are returned as the
 * concrete `scale` / `alpha` / `background` / `transition` the host should apply, and each one
 * also ships the equivalent CSS strings (`css` fields + `*_CSS` constants) so a DOM host can
 * paste them straight into a stylesheet. Nothing here touches React, the DOM or Capacitor.
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.ui.theme`                    → SKIPPED (TS has no packages)
 *   L2        (blank)                                            → SKIPPED
 *   L3        `import …core.EaseOut`                             → `IOS_EASINGS.EaseOut`
 *   L4        `import …core.animateFloatAsState`                 → RESOLVED EAGERLY: the resolver
 *                                                                   takes the settled value instead
 *                                                                   of running the animation, so the
 *                                                                   host owns the interpolation and
 *                                                                   still uses the exact spec below
 *   L5        `import …core.tween`                                → `TweenSpec` / `transitionCss`
 *   L6        `import …foundation.clickable`                     → SKIPPED: there is no Modifier;
 *                                                                   `onClick` is passed through
 *                                                                   untouched on the descriptor
 *   L7        `import …interaction.MutableInteractionSource`     → SKIPPED: `isPressed` is an input
 *   L8        `import …interaction.collectIsPressedAsState`      → the `isPressed` input
 *   L9        `import …runtime.Composable`                       → SKIPPED (no composition)
 *   L10       `import …runtime.LaunchedEffect`                   → the press **edge** helper
 *                                                                   `onPressEdge(isPressed, tick)`
 *                                                                   (fire once per false→true hop)
 *   L11       `import …runtime.getValue`                          → SKIPPED (Kotlin property delegate)
 *   L12       `import …runtime.remember`                          → SKIPPED (no recomposition)
 *   L13       `import androidx.compose.ui.Modifier`               → SKIPPED (see the note above)
 *   L14       `import androidx.compose.ui.composed`               → SKIPPED (see the note above)
 *   L15       `import …draw.drawBehind`                           → the `backgroundCss` /
 *                                                                   `backgroundRgba` fields
 *   L16       `import androidx.compose.ui.graphics.Color`         → hex strings / rgba()
 *   L17       `import …graphics.graphicsLayer`                   → the `transformCss` (scale) and
 *                                                                   `opacity` fields
 *   L18       `import …hapticfeedback.HapticFeedbackType`         → `HapticFeedbackType.TextHandleMove`
 *   L19       `import …platform.LocalHapticFeedback`             → the injected `haptics: (type) => void`
 *   L20       (blank)                                            → SKIPPED
 *   L21-27    the `clickableWithFeedback` KDoc (four numbered   → kept verbatim on
 *              traits: no ripple, 0.96 scale, glow, haptic)       `PressFeedbackSpec`
 *   L28       `fun Modifier.clickableWithFeedback(enabled = true, bounded = true, onClick)`
 *                                                              → `pressFeedback({ enabled, bounded, … })`
 *   L29       `enabled: Boolean = true`                           → `PressFeedbackOptions.enabled`
 *   L30       `bounded: Boolean = true`                          → `PressFeedbackOptions.bounded`
 *                                                                   (see the note on L30 below)
 *   L31       `onClick: () -> Unit`                              → `PressFeedbackOptions.onClick`
 *   L32       `): Modifier = composed {`                         → a plain object literal
 *   L33       `remember { MutableInteractionSource() }`           → SKIPPED (no composition)
 *   L34       `val isPressed by interactionSource.collectIsPressedAsState()`
 *                                                              → the `isPressed` option
 *   L35       `val haptics = LocalHapticFeedback.current`        → the injected `haptics` option
 *   L36       (blank)                                            → SKIPPED
 *   L37-44    `animateFloatAsState(if (isPressed) 0.96f else 1.0f, tween(100 / 150, EaseOut), "click_scale")`
 *                                                              → `PRESS_SCALE` + `scaleTransitionCss`
 *   L38       `targetValue = if (isPressed) 0.96f else 1.0f`    → `PRESSED_SCALE` / `RESTING_SCALE`
 *   L39-42    `tween(durationMillis = if (isPressed) 100 else 150, easing = EaseOut)`
 *                                                              → `PRESS_DOWN_MS = 100` /
 *                                                                   `PRESS_UP_MS = 150`
 *   L43       `label = "click_scale"`                            → `PressFeedbackSpec.label`
 *   L44       `)`                                                → n/a
 *   L45       (blank)                                            → SKIPPED
 *   L46-49    the "2026-09-21 修复" comment (the white-rect        → kept verbatim on `PRESSED_DIM_ALPHA`
 *              highlight was cheap and dirty; iOS dims to 0.7)     and in the module doc below
 *   L50-57    `animateFloatAsState(if (isPressed) 0.7f else 1f, tween(100 / 180, EaseOut), "click_dim")`
 *                                                              → `PRESSED_DIM_ALPHA` +
 *                                                                   `DIM_DOWN_MS = 100` / `DIM_UP_MS = 180`
 *   L51       `targetValue = if (isPressed) 0.7f else 1f`        → verbatim
 *   L58-61    the "Haptic tick on press. 修复" comment            → kept verbatim on `onPressEdge`
 *   L62-66    `LaunchedEffect(isPressed) { if (isPressed) haptics.performHapticFeedback(TextHandleMove) }`
 *                                                              → `onPressEdge` — one tick per hop
 *   L63       `if (isPressed) {`                                 → the guard
 *   L64       `haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)` → the tick
 *   L65-66    the braces / `LaunchedEffect` close                → n/a
 *   L67       (blank)                                            → SKIPPED
 *   L68       `this`                                             → SKIPPED (the Modifier chain)
 *   L69       `.graphicsLayer {`                                 → `PressFeedbackSpec.style.transform`
 *   L70       `scaleX = scaleState.value`                        → `transformCss`'s `scale(...)`
 *   L71       `scaleY = scaleState.value`                        → the same value on both axes
 *   L72       `alpha = dimState.value`                           → `PressFeedbackSpec.style.opacity`
 *   L73       `}`                                                → n/a
 *   L74-79    `.clickable(interactionSource, indication = null, enabled, onClick)`
 *                                                              → `indication = null` becomes
 *                                                                   `ripple: false` on the descriptor;
 *                                                                   `enabled` / `onClick` pass through
 *   L80       `}`                                                → n/a
 *   L81       (blank)                                            → SKIPPED
 *   L82-89    the `clickableRowFeedback` KDoc                    → kept verbatim
 *   L90       `fun Modifier.clickableRowFeedback(enabled = true, onClick): Modifier = composed {`
 *                                                              → `rowPressFeedback({ enabled, … })`
 *   L91-96    `remember` / `collectIsPressedAsState` / `haptics`  → same treatment as L33-L35
 *   L97       (blank)                                            → SKIPPED
 *   L98       the 80ms/220ms asymmetry comment                   → kept verbatim
 *   L99-106   `animateFloatAsState(if (isPressed) 1f else 0f, tween(80 / 220, EaseOut), "row_highlight")`
 *                                                              → `ROW_DOWN_MS = 80` / `ROW_UP_MS = 220`
 *   L107      (blank)                                            → SKIPPED
 *   L108-112  the second `LaunchedEffect(isPressed)` haptic tick → `onPressEdge` again
 *   L113      (blank)                                            → SKIPPED
 *   L114      `this`                                             → SKIPPED
 *   L115      `.drawBehind {`                                    → `backgroundRgba` / `backgroundCss`
 *   L116      `if (highlightAlpha > 0f) {`                       → the `> 0` guard
 *   L117      the "中性灰 …" comment                             → kept verbatim on `ROW_HIGHLIGHT_GRAY`
 *   L118-121  `drawRect(color = Color.Gray.copy(alpha = 0.16f * highlightAlpha), size = size)`
 *                                                              → `ROW_HIGHLIGHT_ALPHA = 0.16`
 *   L122-123  the `if` / `drawBehind` braces                     → n/a
 *   L124-129  `.clickable(…, indication = null, enabled, onClick)` → same as L74-L79
 *   L130      `}`                                                → n/a
 *   L131      (blank)                                            → SKIPPED
 *   L132-138  the `animateAlpha` KDoc (it exists so a            → kept verbatim
 *             graphicsLayer alpha stops "瞬间闪没"; it adds no
 *             clickable / pointerInput so it is safe on
 *             hit-test-disabled decoration chains)
 *   L139      `fun Modifier.animateAlpha(target: Float, durationMillis: Int = 220, label: String = "animateAlpha")`
 *                                                              → `alphaTransition({ target, durationMillis, label })`
 *   L140      `target: Float`                                    → `AlphaTransitionOptions.target`
 *   L141      `durationMillis: Int = 220`                        → `ALPHA_DEFAULT_MS = 220`
 *   L142      `label: String = "animateAlpha"`                   → `AlphaTransitionOptions.label`
 *   L143      `): Modifier = composed {`                         → a plain object literal
 *   L144-148  `animateFloatAsState(target, tween(durationMillis), label)`
 *                                                              → `AlphaTransitionSpec` — note this
 *                                                                   tween passes **no** easing, so it
 *                                                                   is Compose's default LinearEasing,
 *                                                                   NOT `IosMotion.EaseOut`
 *   L149      `this.graphicsLayer { this.alpha = alpha }`         → `style.opacity`
 *   L150      `}`                                                → n/a
 *   L151      (blank)                                            → SKIPPED
 *
 * ── `bounded` (L30) ────────────────────────────────────────────────────────────
 * `bounded` is accepted by `clickableWithFeedback` but never read inside the body — Kotlin's
 * `clickable(interactionSource, indication, enabled, onClick)` overload has no `bounded`
 * parameter either. It is therefore carried through as an option and never consumed, exactly as
 * on Android.
 */

import { IOS_EASINGS, type Easing, easingCss } from './iosMotion';

// ── Shared constants ───────────────────────────────────────────────────────────

/** Kotlin L18 `HapticFeedbackType.TextHandleMove` — the only haptic kind used here. */
export const HAPTIC_TYPE_TEXT_HANDLE_MOVE = 'TextHandleMove';

export type HapticFeedbackType = typeof HAPTIC_TYPE_TEXT_HANDLE_MOVE;

/** Kotlin L18/L64/L110 — `LocalHapticFeedback.current`. */
export type PerformHapticFeedback = (type: HapticFeedbackType) => void;

/**
 * 2026-09-21 修复：按压高亮原本是 drawWithContent 叠一层 **白色矩形**（alpha 0.25）。
 * 在深色卡片 / 毛玻璃上按下会闪出一块白斑，在彩色内容上则整体泛白 —— 廉价且脏，
 * 是全局最不像 iOS 的一处交互。iOS 的按压反馈是「整体变淡」（dim 到 0.7），
 * 只改透明度、不改变任何颜色关系，对任意底色都成立。
 */
export const PRESSED_DIM_ALPHA = 0.7;

/** Kotlin L51 `if (isPressed) 0.7f else 1f` — the resting value. */
export const RESTING_DIM_ALPHA = 1;

/** Kotlin L38 `if (isPressed) 0.96f else 1.0f`. */
export const PRESSED_SCALE = 0.96;

/** Kotlin L38 `if (isPressed) 0.96f else 1.0f`. */
export const RESTING_SCALE = 1;

/** Kotlin L40 `durationMillis = if (isPressed) 100 else 150` — press down. */
export const PRESS_DOWN_MS = 100;

/** Kotlin L40 `durationMillis = if (isPressed) 100 else 150` — release. */
export const PRESS_UP_MS = 150;

/** Kotlin L53 `durationMillis = if (isPressed) 100 else 180` — dim down. */
export const DIM_DOWN_MS = 100;

/** Kotlin L53 `durationMillis = if (isPressed) 100 else 180` — dim release. */
export const DIM_UP_MS = 180;

/** Kotlin L102 `durationMillis = if (isPressed) 80 else 220` — row highlight in. */
export const ROW_DOWN_MS = 80;

/** Kotlin L102 `durationMillis = if (isPressed) 80 else 220` — row highlight out. */
export const ROW_UP_MS = 220;

/** Kotlin L100 `if (isPressed) 1f else 0f`. */
export const ROW_HIGHLIGHT_ON = 1;

/** Kotlin L100 `if (isPressed) 1f else 0f`. */
export const ROW_HIGHLIGHT_OFF = 0;

/**
 * Kotlin L117 comment: 中性灰，深浅主题下都成立；不用白色（深色卡片上会发白）
 * `androidx.compose.ui.graphics.Color.Gray` is `0xFF808080`. (Note this is Compose's Gray, not
 * `android.graphics.Color.GRAY` which is `0xFF888888` — the import at L16 is the Compose one.)
 */
export const ROW_HIGHLIGHT_GRAY = '#808080';

/** Kotlin L119 `Color.Gray.copy(alpha = 0.16f * highlightAlpha)`. */
export const ROW_HIGHLIGHT_ALPHA = 0.16;

/** Kotlin L141 `durationMillis: Int = 220`. */
export const ALPHA_DEFAULT_MS = 220;

/**
 * Kotlin L146 `tween(durationMillis = durationMillis)` — **no** easing argument, so Compose's
 * default `LinearEasing` applies. Deliberately NOT `IosMotion.EaseOut`; preserved as-is.
 */
export const ALPHA_EASING: Easing = { x1: 0, y1: 0, x2: 1, y2: 1 };

/** `linear` — what `tween(ms)` resolves to on Android. */
export const ALPHA_EASING_CSS = easingCss(ALPHA_EASING);

// ── Press-edge helper (Kotlin L62-L66 / L108-L112) ─────────────────────────────

/**
 * Haptic tick on press。
 * 修复：原先直接在组合期调用，重组会重复触发（同一按住状态被振多次）。
 * 放进 LaunchedEffect 后只在「从未按下 -> 按下」这一跳变时执行一次。
 *
 * @param previous the value of `isPressed` on the previous render
 * @param current  the value of `isPressed` now
 * @returns `true` (and ticks) exactly once per false → true hop
 */
export function onPressEdge(
  previous: boolean,
  current: boolean,
  haptics: PerformHapticFeedback,
): boolean {
  if (current && !previous) {
    haptics(HAPTIC_TYPE_TEXT_HANDLE_MOVE);
    return true;
  }
  return false;
}

// ── Modifier.clickableWithFeedback (Kotlin L28-L80) ────────────────────────────

/**
 * A highly polished custom clickable modifier that combines:
 * 1) No default ripple/highlight
 * 2) Smooth scale feedback (shrinks to 0.96 on press, eases back to 1.0 on release)
 * 3) Subtle glow overlay
 * 4) Haptic tick on press (tactile confirmation)
 */
export interface PressFeedbackOptions {
  /** Kotlin L29 `enabled: Boolean = true`. */
  readonly enabled?: boolean;
  /** Kotlin L30 `bounded: Boolean = true` — accepted but never read (see the header note). */
  readonly bounded?: boolean;
  /** Kotlin L34 `val isPressed by interactionSource.collectIsPressedAsState()`. */
  readonly isPressed: boolean;
  /** Kotlin L35 `LocalHapticFeedback.current`. */
  readonly haptics: PerformHapticFeedback;
  /** Kotlin L31 `onClick: () -> Unit` — passed through untouched. */
  readonly onClick: () => void;
}

/** The resolved CSS declarations for one frame. */
export interface PressFeedbackStyle {
  /** Kotlin L70-L71 — both axes share one animated value. */
  readonly transform: string;
  /** Kotlin L72 `alpha = dimState.value`. */
  readonly opacity: number;
  /** `transition: transform …, opacity …` built from both tweens. */
  readonly transition: string;
}

/** A fully resolved press-feedback frame. */
export interface PressFeedbackSpec {
  /** Kotlin L28-L31, echoed for the host. */
  readonly enabled: boolean;
  /** Kotlin L30, echoed for the host (unused on both sides). */
  readonly bounded: boolean;
  /** Kotlin L31, passed through untouched. */
  readonly onClick: () => void;
  /** Kotlin L74-L78 `indication = null` — there is no ripple on this control. */
  readonly ripple: false;
  /** Kotlin L43 `label = "click_scale"`. */
  readonly label: string;
  /** Kotlin L64 — `TextHandleMove` on the press edge. */
  readonly haptic: HapticFeedbackType;
  /** Kotlin L38 `targetValue = if (isPressed) 0.96f else 1.0f`. */
  readonly scale: number;
  /** Kotlin L51 `targetValue = if (isPressed) 0.7f else 1f`. */
  readonly dim: number;
  /** Kotlin L69-L73 `graphicsLayer { scaleX; scaleY; alpha }`. */
  readonly style: PressFeedbackStyle;
}

function transitionCss(pressed: boolean, downMs: number, upMs: number, easing: Easing): string {
  const ms = pressed ? downMs : upMs;
  return `${ms}ms ${easingCss(easing)}`;
}

/** Resolve `Modifier.clickableWithFeedback(…)` for the current `isPressed` state. */
export function pressFeedback(options: PressFeedbackOptions): PressFeedbackSpec {
  const { isPressed } = options;
  const scale = isPressed ? PRESSED_SCALE : RESTING_SCALE;
  const dim = isPressed ? PRESSED_DIM_ALPHA : RESTING_DIM_ALPHA;
  return {
    enabled: options.enabled ?? true,
    bounded: options.bounded ?? true,
    onClick: options.onClick,
    ripple: false,
    label: 'click_scale',
    haptic: HAPTIC_TYPE_TEXT_HANDLE_MOVE,
    scale,
    dim,
    style: {
      // Kotlin L70-L71 — scaleX and scaleY are the same animated float.
      transform: `scale(${scale})`,
      opacity: dim,
      transition:
        `transform ${transitionCss(isPressed, PRESS_DOWN_MS, PRESS_UP_MS, IOS_EASINGS.EaseOut)}, ` +
        `opacity ${transitionCss(isPressed, DIM_DOWN_MS, DIM_UP_MS, IOS_EASINGS.EaseOut)}`,
    },
  };
}

// ── Modifier.clickableRowFeedback (Kotlin L90-L130) ────────────────────────────

/**
 * iOS 列表行的按压反馈（2026-09-21 新增）。
 *
 * 与 [clickableWithFeedback] 的区别：列表行（整行宽、44dp 高以上）按下时
 * **只铺一层次级背景色，不改变尺寸**。iOS 的 UITableViewCell 就是这么做的 ——
 * 整行缩放到 0.96 会显得晃眼，而整个 App 一起变淡也太重。
 * 手感：按下瞬间出现浅灰底（80ms），松手后缓慢淡出（220ms），并给一次轻震动。
 */
export interface RowPressFeedbackOptions {
  /** Kotlin L91 `enabled: Boolean = true`. */
  readonly enabled?: boolean;
  /** Kotlin L95 `val isPressed by interactionSource.collectIsPressedAsState()`. */
  readonly isPressed: boolean;
  /** Kotlin L96 `LocalHapticFeedback.current`. */
  readonly haptics: PerformHapticFeedback;
  /** Kotlin L92 `onClick: () -> Unit`. */
  readonly onClick: () => void;
}

export interface RowPressFeedbackSpec {
  readonly enabled: boolean;
  readonly onClick: () => void;
  /** Kotlin L124-L128 `indication = null`. */
  readonly ripple: false;
  /** Kotlin L105 `label = "row_highlight"`. */
  readonly label: string;
  /** Kotlin L110 — `TextHandleMove` on the press edge. */
  readonly haptic: HapticFeedbackType;
  /** Kotlin L100 `targetValue = if (isPressed) 1f else 0f`. */
  readonly highlightAlpha: number;
  /** Kotlin L118-L121 `drawRect(Color.Gray.copy(alpha = 0.16f * highlightAlpha), size = size)`. */
  readonly backgroundRgba: string;
  /** The same fill as a CSS declaration. */
  readonly backgroundCss: string;
  /** Kotlin L101-L105 — the 80 / 220 ms asymmetry. */
  readonly transition: string;
}

/** Resolve `Modifier.clickableRowFeedback(…)` for the current `isPressed` state. */
export function rowPressFeedback(options: RowPressFeedbackOptions): RowPressFeedbackSpec {
  const { isPressed } = options;
  const highlightAlpha = isPressed ? ROW_HIGHLIGHT_ON : ROW_HIGHLIGHT_OFF;
  // 按下要“立刻”有反应（80ms），松手则缓慢淡出（220ms），这个不对称是 iOS 手感的关键
  const transition = transitionCss(isPressed, ROW_DOWN_MS, ROW_UP_MS, IOS_EASINGS.EaseOut);
  const alpha = ROW_HIGHLIGHT_ALPHA * highlightAlpha;
  return {
    enabled: options.enabled ?? true,
    onClick: options.onClick,
    ripple: false,
    label: 'row_highlight',
    haptic: HAPTIC_TYPE_TEXT_HANDLE_MOVE,
    highlightAlpha,
    backgroundRgba: `rgba(128, 128, 128, ${alpha})`,
    backgroundCss: `background-color: rgba(128, 128, 128, ${alpha})`,
    transition: `background-color ${transition}`,
  };
}

// ── Modifier.animateAlpha (Kotlin L139-L150) ──────────────────────────────────

/**
 * 透明度过渡：把 `graphicsLayer { alpha = if (x) 0f else 1f }` 这种**瞬间闪没**
 * 改成平滑淡入淡出。
 *
 * 只叠 graphicsLayer，不会引入 clickable / pointerInput，
 * 因此用于「禁止命中测试」的装饰链（如阅读页页眉页脚）是安全的。
 */
export interface AlphaTransitionOptions {
  /** Kotlin L140 `target: Float`. */
  readonly target: number;
  /** Kotlin L141 `durationMillis: Int = 220`. */
  readonly durationMillis?: number;
  /** Kotlin L142 `label: String = "animateAlpha"`. */
  readonly label?: string;
}

export interface AlphaTransitionSpec {
  /** Kotlin L142, defaulted. */
  readonly label: string;
  /** Kotlin L140 `target: Float`. */
  readonly target: number;
  /** Kotlin L141 `durationMillis`, defaulted to 220. */
  readonly durationMillis: number;
  /** Kotlin L144-L149 — the animated alpha's settled value. */
  readonly opacity: number;
  /** Kotlin L149 `this.graphicsLayer { this.alpha = alpha }`. */
  readonly style: { readonly opacity: number };
  /** Kotlin L146 — `tween(durationMillis)` with the default (linear) easing. */
  readonly transition: string;
  /** The same transition as a bare CSS timing string. */
  readonly css: string;
}

/** Resolve `Modifier.animateAlpha(…)`. */
export function alphaTransition(options: AlphaTransitionOptions): AlphaTransitionSpec {
  const durationMillis = options.durationMillis ?? ALPHA_DEFAULT_MS;
  const label = options.label ?? 'animateAlpha';
  const css = `${durationMillis}ms ${ALPHA_EASING_CSS}`;
  return {
    label,
    target: options.target,
    durationMillis,
    opacity: options.target,
    style: { opacity: options.target },
    transition: `opacity ${css}`,
    css,
  };
}

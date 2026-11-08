/**
 * readingTimer.ts — line-by-line port of Android `com/example/ui/ReadingTimerEffect.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/ReadingTimerEffect.kt`, 122 lines / 115 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-25    package + Compose/Lifecycle imports → plain TS; lifecycle + visibility ports
 *                                               declared below (the `local/…` imports are the port)
 *   27-35   KDoc (lifecycle-aware timer)      → ReadingTimerState KDoc
 *   36-43   @Composable signature             → createReadingTimer() factory (plain TS)
 *   44-58   LocalContext / LocalLifecycleOwner / remember states /
 *            rememberUpdatedState / PowerManager →
 *                                            ReadingTimerDeps (screenOn(), latest callbacks)
 *   60-89   fun endCurrentSession()           → ReadingTimerState.endCurrentSession (pure)
 *   91-107  DisposableEffect(lifecycleOwner)  → attach()/detach() on the controller
 *   109-126 LaunchedEffect(active) 1s loop    → start()/stop() tick loop (setInterval, 1000ms)
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L3-4   `android.content.Context` / `android.os.PowerManager` → injected
 *         `ReadingTimerDeps.screenOn(): boolean` port (Android
 *         `PowerManager.isInteractive`); core stays pure TS with no DOM.
 *  L5-19  `androidx.compose.runtime.*` → `useReadingTimer()` React binding lives in the
 *         consuming pages; this file is the portable state machine.
 *  L20    `LocalLifecycleOwner.current` → `ReadingTimerDeps.isForeground(): boolean` +
 *         `onVisibilityChange(listener)` (Android `LifecycleEventObserver` ON_START/ON_STOP).
 *  L22-24 `SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())` → `formatLocalDate()` below
 *         (same calendar fields, same zero padding).
 *  L25    `java.util.Calendar` → `new Date()` / `Date.getHours()`.
 *  L47-51 Compose `remember { mutableStateOf(...) }` → `ReadingTimerState` fields.
 *  L53-55 `rememberUpdatedState(onFlush / onSessionEnd / onRestTick)` → the deps object is
 *         re-read on every tick (same "latest callback" guarantee).
 *  L56-58 `context.getSystemService(Context.POWER_SERVICE) as? PowerManager` → the
 *         `screenOn` port member (default `() => true` mirrors `?: true`).
 *  L75    `System.currentTimeMillis()` → `deps.nowMs()`.
 *  L80    `Calendar.getInstance().get(Calendar.HOUR_OF_DAY)` → `new Date().getHours()`.
 *  L111-112 `System.currentTimeMillis()` / `Calendar…HOUR_OF_DAY` → `deps.nowMs()` / `now.getHours()`.
 *  L114-125 `while (active) { delay(1000) … }` → a `setInterval` tick that is stopped by
 *         `stop()`; the same 1-second cadence and the same screen-on skip are preserved.
 *  L124   `latestOnRestTick?.invoke(elapsed)` → optional `onRestTick` callback.
 *
 * ── Platform adaptations (documented inline) ───────────────────────────────────────
 *  * `Lifecycle.Event.ON_START` → `ReadingTimerVisibilityPort.start()`.
 *  * `Lifecycle.Event.ON_STOP`   → `.stop()` (which also ends the current session).
 *  * `DisposableEffect.onDispose { … endCurrentSession() }` → `detach()`.
 *  * Browser tab visibility maps onto the same port (the React binding wires
 *    `document.visibilityState`); the state machine is identical.
 *
 * ReadingSession shape matches `@core/data/readingSession.ts` (same fields the Android
 * `ReadingSession` entity has); the Room annotations are not part of the port.
 */

import type { ReadingSession } from '@core/data/readingSession';

export { createReadingSession } from '@core/data/readingSession';

/** Flutter of flush cadence — Kotlin L120 `if (elapsed - lastFlush >= 30L)`. */
export const FLUSH_INTERVAL_SECONDS = 30;

/** Tick cadence — Kotlin L115 `delay(1000)`. */
export const TICK_INTERVAL_MS = 1000;

/**
 * Android `Lifecycle.State` bridge. The React binding supplies the real
 * `document.visibilityState`; core only needs start/stop + a subscription.
 */
export interface ReadingTimerVisibilityPort {
  /** Android `Lifecycle.Event.ON_START` → resume counting. */
  start(): void;
  /** Android `Lifecycle.Event.ON_STOP` → pause counting and end the session. */
  stop(): void;
  /** Android `lifecycle.addObserver(observer)`; returns the remover. */
  subscribe(onVisibility: (visible: boolean) => void): () => void;
}

/**
 * Injected platform members. Every Android framework call in ReadingTimerEffect.kt
 * lands here so `core/reader` stays pure TypeScript.
 */
export interface ReadingTimerDeps {
  /** Android `powerManager?.isInteractive ?: true` (screen-on gate). */
  screenOn?: () => boolean;
  /** Android `System.currentTimeMillis()`. */
  nowMs?: () => number;
  /** Android `LocalLifecycleOwner.current.lifecycle`. */
  visibility: ReadingTimerVisibilityPort;
  /** Android `onFlush: (Long) -> Unit` — seconds since the last flush. */
  onFlush: (seconds: number) => void;
  /** Android `onSessionEnd: (ReadingSession) -> Unit`. */
  onSessionEnd?: (session: ReadingSession) => void;
  /** Android `onRestTick: ((Long) -> Unit)?`. */
  onRestTick?: (elapsedSeconds: number) => void;
}

/** Mutable state — the Compose `remember` fields of Kotlin L47-51. */
export interface ReadingTimerState {
  /** Kotlin L47 `active`. */
  active: boolean;
  /** Kotlin L48 `elapsed`. */
  elapsed: number;
  /** Kotlin L49 `lastFlush`. */
  lastFlush: number;
  /** Kotlin L50 `sessionStartMs`. */
  sessionStartMs: number;
  /** Kotlin L51 `sessionStartHour`. */
  sessionStartHour: number;
}

/** Android `SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())` on local fields. */
export function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${String(d.getFullYear())}-${month < 10 ? '0' : ''}${String(month)}-${day < 10 ? '0' : ''}${String(day)}`;
}

/** Initial state — Kotlin L47-51 (`active = true`, everything else zeroed). */
export function createReadingTimerState(): ReadingTimerState {
  return {
    active: true,
    elapsed: 0,
    lastFlush: 0,
    sessionStartMs: 0,
    sessionStartHour: -1,
  };
}

/**
 * The lifecycle-aware reading timer.
 *
 * Only accumulates while "app foregrounded + screen on"; flushes every 30 seconds and
 * reports the remainder on leave/background/destroy; writes one [ReadingSession] per
 * continuous foreground span.
 *
 * Fixes the historical bug the KDoc mentions: the old `while(true){delay(1000)}` loop
 * kept counting while locked/backgrounded, producing "200+ minutes read" phantom totals.
 */
export interface ReadingTimer {
  /** Kotlin L91-107 — subscribe to lifecycle start/stop. */
  start(): void;
  /** Kotlin L107 `onDispose { endCurrentSession() }`. */
  stop(): void;
  /** Current state snapshot (tests / diagnostics). */
  getState(): ReadingTimerState;
}

/**
 * Kotlin L60-89 `fun endCurrentSession()` — pure so it can be unit tested.
 *
 * Returns the session to report (or `null`) plus the flush amount; the caller applies
 * the state reset, which keeps this function free of hidden mutation.
 */
export function endCurrentSession(
  state: ReadingTimerState,
  bookId: number | null,
  bookTitle: string,
  nowMs: number,
): { session: ReadingSession | null; flushSeconds: number; next: ReadingTimerState } {
  const remaining = state.elapsed - state.lastFlush;
  if (remaining > 0) {
    // Caller invokes onFlush(remaining) — see `createReadingTimer`.
  }
  let session: ReadingSession | null = null;
  if (state.sessionStartMs > 0) {
    const total = Math.max(1, state.elapsed);
    const startDate = formatLocalDate(state.sessionStartMs);
    session = {
      id: 0,
      bookId,
      bookTitle,
      dateStr: startDate,
      startTimeMs: state.sessionStartMs,
      endTimeMs: nowMs,
      durationSeconds: total,
      startHour:
        state.sessionStartHour >= 0 && state.sessionStartHour <= 23
          ? state.sessionStartHour
          : new Date(nowMs).getHours(),
    };
  }
  const next: ReadingTimerState = {
    active: state.active,
    elapsed: 0,
    lastFlush: 0,
    sessionStartMs: 0,
    sessionStartHour: -1,
  };
  return { session, flushSeconds: Math.max(0, remaining), next };
}

/**
 * Kotlin L36-127 `fun ReadingTimerEffect(...)`, as a plain controller.
 *
 * The React pages call this through `useReadingTimer`; see the header for the
 * Compose → React mapping.
 */
export function createReadingTimer(
  bookId: number | null,
  bookTitle: string,
  deps: ReadingTimerDeps,
  initial: ReadingTimerState = createReadingTimerState(),
): ReadingTimer {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const screenOn = deps.screenOn ?? (() => true);
  let state = initial;
  let interval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const endCurrent = (): void => {
    const result = endCurrentSession(state, bookId, bookTitle, nowMs());
    if (result.flushSeconds > 0) deps.onFlush(result.flushSeconds);
    if (result.session !== null) deps.onSessionEnd?.(result.session);
    state = result.next;
  };

  // Kotlin L109-113 — the session opens when counting resumes.
  const openSession = (): void => {
    if (!state.active || state.sessionStartMs !== 0) return;
    const now = new Date(nowMs());
    state = { ...state, sessionStartMs: now.getTime(), sessionStartHour: now.getHours() };
  };

  // Kotlin L114-125 — one tick per second, screen-on gated, 30s flush.
  const tick = (): void => {
    // 屏幕熄灭（部分 OEM 锁屏不触发 ON_STOP）时也不累计
    if (!screenOn()) return;
    state = { ...state, elapsed: state.elapsed + 1 };
    if (state.elapsed - state.lastFlush >= FLUSH_INTERVAL_SECONDS) {
      deps.onFlush(state.elapsed - state.lastFlush);
      state = { ...state, lastFlush: state.elapsed };
    }
    deps.onRestTick?.(state.elapsed);
  };

  const ensureInterval = (): void => {
    if (interval !== null || !state.active) return;
    interval = setInterval(tick, TICK_INTERVAL_MS);
  };

  const stopInterval = (): void => {
    if (interval === null) return;
    clearInterval(interval);
    interval = null;
  };

  // Kotlin L91-107 DisposableEffect(lifecycleOwner)
  unsubscribe = deps.visibility.subscribe((visible) => {
    if (visible) {
      // Lifecycle.Event.ON_START -> active = true
      state = { ...state, active: true };
      openSession();
      ensureInterval();
      return;
    }
    // Lifecycle.Event.ON_STOP -> active = false; endCurrentSession()
    state = { ...state, active: false };
    stopInterval();
    endCurrent();
  });

  // The composable starts with `active = true` (Kotlin L47).
  openSession();
  ensureInterval();

  return {
    start(): void {
      state = { ...state, active: true };
      openSession();
      ensureInterval();
    },
    stop(): void {
      // onDispose { lifecycleOwner.lifecycle.removeObserver(observer); endCurrentSession() }
      stopInterval();
      unsubscribe?.();
      unsubscribe = null;
      endCurrent();
    },
    getState(): ReadingTimerState {
      return { ...state };
    },
  };
}

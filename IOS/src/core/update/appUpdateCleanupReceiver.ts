/**
 * appUpdateCleanupReceiver.ts — line-by-line port of Android
 * `com/example/data/AppUpdateCleanupReceiver.kt`
 * (`novel-reader/app/src/main/java/com/example/data/AppUpdateCleanupReceiver.kt`,
 * 17 lines / 12 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-5    package + imports              → see "Skipped lines" below
 *   7      the class doc comment          → kept verbatim above `handlePackageReplaced`
 *   8      class AppUpdateCleanupReceiver → `AppUpdateCleanupReceiver`
 *   9      override fun onReceive(...)    → `AppUpdateCleanupReceiver.onReceive()`
 *   10     the ACTION_MY_PACKAGE_REPLACED guard → `ACTION_MY_PACKAGE_REPLACED` check
 *   11-15  `goAsync()` + `Thread { … runCatching { … }; result.finish() }.start()`
 *                                          → `onReceive(action, finish)`
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L2     `android.content.Context` — only `context.applicationContext` reaches
 *         `AppUpdateStore`, which the host already holds.
 *  L3     `android.content.Intent` — the broadcast action arrives as a plain string;
 *         `ACTION_MY_PACKAGE_REPLACED` is the literal from `appUpdateInstaller.ts`.
 *  L4     `android.content.BroadcastReceiver` — framework base class; the port is the
 *         plain `AppUpdateCleanupReceiver` shape below.
 *  L11    `goAsync()` — the broadcast result token; becomes the `finish()` callback the
 *         platform invokes once the cleanup settles (it must always be invoked, exactly
 *         as `result.finish()` is in the Kotlin `finally`).
 *  L12-15 `Thread { … }.start()` — a detached async task. The `finally { result.finish() }`
 *         is preserved, so a failing `cleanupInstalled()` still releases the broadcast.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * Android-only lifecycle: `ACTION_MY_PACKAGE_REPLACED` fires when the package is
 *    replaced, killing the old process mid-flight, so the NEW version does the cleanup.
 *    iOS has no equivalent broadcast — an App Store update replaces the bundle between
 *    launches — so this receiver has NO iOS counterpart at all; it is registered as a
 *    parity exception (E60) rather than being given an invented trigger. The functional
 *    equivalent on iOS is `AppUpdateManager`'s constructor pass, which runs
 *    `store.cleanupInstalled()` on every cold start (Kotlin L49-L52 runs the very same
 *    call, precisely because the broadcast is unreliable there too), and
 *    `handlePackageReplaced` below exposes that one call for a host that wants an
 *    explicit trigger. The `onReceive` entry point is kept so a Capacitor `App` plugin
 *    can still forward the Android action on the Android build.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ────────────────────────────────
 *  All 17 Kotlin lines, in order: L10 the action guard (`!== ACTION_MY_PACKAGE_REPLACED`
 *  returns early, and the Kotlin `return` also skips `finish()` — the port calls
 *  `finish()` unconditionally instead, which is strictly safer because `goAsync()` was
 *  never taken on that branch); L13 `runCatching { AppUpdateStore(context.applicationContext)
 *  .cleanupInstalled() }` ✔; L14 `finally { result.finish() }` ✔.
 *  `handlePackageReplaced` (the 3-line helper at the bottom) is NOT in Kotlin. Kept
 *  deliberately, not left as dead code: it is the documented iOS entry point for the
 *  one call this receiver makes, and `AppUpdateManager.initialize()` performs it
 *  automatically — the helper exists so a host can force it without constructing a
 *  manager.
 */

import { ACTION_MY_PACKAGE_REPLACED } from './appUpdateInstaller';

export { ACTION_MY_PACKAGE_REPLACED };

/** The Android broadcast the Kotlin receiver listens for (Kotlin L10). */
export const PACKAGE_REPLACED_ACTION = ACTION_MY_PACKAGE_REPLACED;

/** Android L13 `AppUpdateStore(context.applicationContext).cleanupInstalled()`. */
export interface AppUpdateCleanupTarget {
  cleanupInstalled(): Promise<boolean>;
}

/** Android L8-16 `class AppUpdateCleanupReceiver : BroadcastReceiver()`. */
export interface AppUpdateCleanupReceiver {
  /**
   * Android L9 `override fun onReceive(context, intent)`.
   *
   * @param action Kotlin `intent.action` — `null` stands in for a missing extra.
   * @param finish Kotlin `result.finish()`; always invoked, in a `finally`.
   * @returns the detached cleanup task, so a host can await it in tests.
   */
  onReceive(action: string | null, finish: () => void): Promise<void>;
}

/**
 * Package replacement kills the old process; cleanup is performed by the new version.
 *
 * Returns the receiver instead of registering it: `src/core/**` never touches the
 * platform event bus, so the host (`src/platform/**` or `App.tsx`) wires the action.
 */
export function createAppUpdateCleanupReceiver(
  store: AppUpdateCleanupTarget,
  onError?: (error: unknown) => void,
): AppUpdateCleanupReceiver {
  return {
    onReceive(action: string | null, finish: () => void): Promise<void> {
      // Kotlin L10 `if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return`
      if (action !== ACTION_MY_PACKAGE_REPLACED) {
        finish();
        return Promise.resolve();
      }
      const cleanup = (async (): Promise<void> => {
        try {
          // Kotlin L13 `runCatching { … }` — every failure is absorbed.
          try {
            await store.cleanupInstalled();
          } catch (error) {
            onError?.(error);
          }
        } finally {
          // Kotlin L14 `finally { result.finish() }`
          finish();
        }
      })();
      cleanup.catch(() => undefined);
      return cleanup;
    },
  };
}

/**
 * iOS/web start-up equivalent of `onReceive(PACKAGE_REPLACED_ACTION, finish)` — Kotlin
 * L13's single `AppUpdateStore(context.applicationContext).cleanupInstalled()` call.
 *
 * NOT part of the Kotlin source: added because iOS has no package-replaced broadcast
 * (see the header). `AppUpdateManager.initialize()` already makes this call on every
 * cold start, so this helper is only for a host that wants to trigger it explicitly.
 */
export function handlePackageReplaced(store: AppUpdateCleanupTarget): Promise<boolean> {
  return store.cleanupInstalled();
}

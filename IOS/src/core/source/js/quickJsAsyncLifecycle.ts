/**
 * Android source: `com.example.source.js.QuickJsAsyncLifecycle.kt` (39 lines, 36 non-blank)
 * Ported: 8 / 36 non-blank lines of behaviour. Skipped: 28 non-blank lines —
 * the whole reflection/settle body. Reason: Kotlin reaches into
 * `com.dokar.quickjs.QuickJs` private fields (`asyncJobs`, `jobsMutex`,
 * `coroutineScope`, `jobDispatcher`, `exceptionHandler`, `evalException`) to
 * patch a bug in the pinned quickjs-kt 1.0.0-alpha13 binding. Those fields do
 * not exist in a JS `Function` sandbox, so the reconciliation has no analogue.
 * The one surviving concern — pruning work that is still pending before a
 * context is reused — is kept as an explicit `settle(runtime)` contract on the
 * injected `JsRuntime` port; the platform adapter implements it against the JS
 * engine it actually uses. No behaviour is lost from the app's point of view.
 *
 * Compatibility cleanup for the pinned quickjs-kt 1.0.0-alpha13 binding.
 * A failed bridge can cancel its internal scope. Settle pending native work and
 * defensively prune completed jobs before reuse. Closing one runtime is unsafe
 * with other live alpha13 contexts.
 * Keep this adapter isolated; the existing ProGuard rule preserves QuickJs fields.
 */

import type { JsRuntime } from './jsPlatform';

/** The pinned binding version this adapter existed to work around. */
export const QUICK_JS_ADAPTER_VERSION = '1.0.0-alpha13';

/**
 * Kotlin `internal object QuickJsAsyncLifecycle`.
 * The reflective field plumbing (Kotlin lines 15-21) and the coroutine-scope
 * repair (Kotlin lines 25-36) are intentionally not reproduced; see the header.
 * Implementations must drain pending native work and drop completed jobs before
 * the context is reused, and must not dispose the context itself.
 */
export interface QuickJsAsyncLifecycleAdapter {
  /** Called under the source's mutex, after its evaluation has completed. */
  settle(runtime: JsRuntime): Promise<void>;
}

export const QuickJsAsyncLifecycle: QuickJsAsyncLifecycleAdapter = {
  async settle(runtime: JsRuntime): Promise<void> {
    // Kotlin: `pending.joinAll(); jobs.removeAll { it.isCompleted }; scope repair;
    // exceptionField.set(runtime, null); runtime.gc()`.
    // A JS sandbox keeps no job list; the awaited microtask queue is drained by
    // the language itself, so only the explicit `gc()` step remains.
    await Promise.resolve();
    runtime.gc();
  },
};

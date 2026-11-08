/**
 * Privacy gate for manga translation — port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/TranslationPrivacy.kt`
 * (8 lines total, 6 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * This file is nevertheless **fully ported** because the gate is a pure two-input
 * predicate and the surrounding app (privacy mode, incognito reading) needs the same
 * answer on iOS for the *non*-manga paths too.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.mangatranslate` → module header.
 *   2        (blank)
 *   3        `import android.content.Context` → the two inputs are injected instead
 *            (core must not touch `android.*` or Capacitor).
 *   4        (blank)
 *   5        `internal object TranslationPrivacy {` → {@link TranslationPrivacy}.
 *   6        `fun allowed(context:Context):Boolean = !com.example.data.PrivacyManager(context).isEnabled() &&`
 *   7        `    !com.example.data.PreferencesManager(context).incognitoBrowsingEnabled`
 *            → {@link TranslationPrivacy.allowed}. Both conjuncts, their order and the
 *              negation are preserved exactly. `PrivacyManager.isEnabled()` reads the
 *              `privacy_prefs` key `privacy_mode_enabled` (default false) —
 *              see `privacy/pinKdf.ts`; `PreferencesManager.incognitoBrowsingEnabled`
 *              reads `incognito_browsing_enabled` (default false) —
 *              see `settings/settingsRepository.ts`.
 *   8        `}` → end of object.
 *
 * Skipped lines and why: none. Only the `Context` plumbing changed shape.
 */

/**
 * 翻译隐私门：隐私模式开启或无痕浏览开启时，禁止任何漫画翻译（含云端 LLM）。
 * Port of `TranslationPrivacy.allowed(context)`.
 */
export const TranslationPrivacy = {
  /**
   * @param privacyModeEnabled `PrivacyManager.isEnabled()` (`privacy_mode_enabled`).
   * @param incognitoBrowsing `PreferencesManager.incognitoBrowsingEnabled` (`incognito_browsing_enabled`).
   */
  allowed(privacyModeEnabled: boolean, incognitoBrowsing: boolean): boolean {
    return !privacyModeEnabled && !incognitoBrowsing;
  },
};
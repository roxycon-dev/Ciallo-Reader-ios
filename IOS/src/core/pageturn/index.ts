/**
 * Barrel for `src/core/pageturn/` — pure TypeScript, no React/DOM/Capacitor.
 *
 * Kotlin → TS:
 * - `ui/pageturn/PaperPalette.kt`     → `./paperPalette`
 * - `ui/pageturn/PageTurnContainer.kt` → `./pageTurn`
 * - `ui/pageturn/PageScrubber.kt`      → `./pageScrubber`
 */
export * from './paperPalette';
export * from './pageTurn';
export * from './pageScrubber';
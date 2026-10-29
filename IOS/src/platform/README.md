/**
 * Layer map for the iOS port.

 * ui/       React pages/components. Visual parameters come from src/ui/tokens.ts
 *           (generated from Android DesignTokens/Color/IosMotion — see npm run tokens).
 * core/     Pure TypeScript algorithms ported from Android Kotlin. MUST NOT import
 *           react, DOM globals, or @capacitor/*. ESLint enforces this.
 * platform/ Interfaces (interfaces.ts) + web-mock (dev/test) + ios-native (Capacitor).
 */

import { useMemo } from 'react';
import { paperPaletteOf, type PaperPalette } from '../../../core/pageturn/paperPalette';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/pageturn/PaperPalette.kt` (73 non-blank lines)
 *   lines 25-41  `data class PaperPalette`   → PaperPalette (core)
 *   lines 44-46  `@Composable rememberPaperPalette(paperColor)`
 *                  → usePaperPalette() (the `remember` cache, memoised by colour)
 *   lines 49-76  `fun paperPaletteOf(source)`  → paperPaletteOf() (core)
 *   lines 79-87  `private fun Color.mix`       → core/glass/color#mixHex
 *   lines 90-93  `private fun Color.desaturate`→ core/glass/color#desaturateHex
 *
 * Nothing skipped. Kotlin's `remember(paperColor)` memoises on the colour key; the
 * `useMemo` with `[paperColor]` dependency reproduces that exactly.
 */
export type { PaperPalette };
export { paperPaletteOf };

/** [remember] 版：[paperColor] 不变时不重算。 */
export function usePaperPalette(paperColor: string): PaperPalette {
  return useMemo(() => paperPaletteOf(paperColor), [paperColor]);
}

/**
 * 「纸张」配色：由阅读主题的背景色推导，而不是写死米黄。
 *
 * 统一由这里按阅读区背景色推导：
 *  - 浅色纸：在原背景色基础上轻微提亮 + 降饱和，得到"纸面"而不是纯背景色；
 *  - 深色纸：在原背景色基础上加深 + 降饱和，同时厚度高光/描边反过来提亮——
 *    否则黑底上的描边和高光会完全消失，卷页边缘看着像是没有厚度。
 */
export const PAPER_PALETTE_DOC = true;
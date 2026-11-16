/**
 * `src/ui/components/wenku` 公共入口 —— Android `ui/wenku/**` 的 React 侧出口。
 *
 * 与 Kotlin 的对应关系：
 *   ArchiveShelf.tsx    → `ArchiveShelf.kt`（1376 行，3D 书架组合层）
 *   WenkuIcon.tsx       → `WenkuIcon.kt` + `WenkuIconArt.kt` + `WenkuIconMapping.kt`
 *   WenkuMenuHost.tsx   → `WenkuMenuHost.kt`（L195-1120）+ `shelf/ShelfSelectionHost.kt` L442-560
 *   WenkuGlass.tsx      → `WenkuGlass.kt` L85-232（玻璃面）
 *   WenkuActionSheet.tsx→ `WenkuActionSheet.kt` + `WenkuMenuHost.kt` L379-1092（玻璃面板）
 *   `src/styles/wenku.css` ← `WenkuTokens.kt` / `WenkuGlass.kt` / `WenkuMenuHost.kt` 的视觉常量
 *
 * 几何一律来自 `src/core/wenku/**`，本层不重算布局：
 *   `ShelfMetrics`（shelfMetrics.ts）/ `layoutVisibleSlots` / `resolveTap` / `hitTestSlot` /
 *   `planShelfInertia` / `centreStep` / `buildVolumeArt` / `generatedCoverPlan` / `fallbackTint`。
 */

export {
  ArchiveShelf,
  ArchiveShelfMemory,
  COVER_RASTER_BUDGET,
  MAX_SHELF_BOOKS,
  SHELF_CENTRE_MS,
  SHELF_LONG_PRESS_MS,
  SHELF_REVEAL_MS,
  defaultShelfMenuEntries,
  shelfMoreRows,
  wenkuShelfCentreX,
} from './ArchiveShelf';
export type { ArchiveShelfBook, ArchiveShelfProps } from './ArchiveShelf';

export {
  WENKU_ICON_ART,
  WENKU_SYMBOL_LABELS,
  WenkuButtonGlyph,
  WenkuIcon,
  wenkuIconHasArt,
  wenkuIconPosesOf,
  wenkuIconStrokeWidth,
  wenkuSymbolForIconName,
} from './WenkuIcon';
export type { WenkuIconPose, WenkuIconProps, WenkuIconStroke, WenkuSymbol } from './WenkuIcon';

export {
  WENKU_GLASS_BLUR_PX,
  WENKU_GLASS_ELEVATION_PX,
  WENKU_GLASS_RADIUS_PX,
  WenkuGlass,
  useWenkuReducedMotion,
  wenkuBlurSupported,
} from './WenkuGlass';
export type { WenkuGlassProps } from './WenkuGlass';

export {
  WENKU_SHEET_DISMISS_FRACTION,
  WENKU_SHEET_DISMISS_VELOCITY,
  WENKU_SHEET_ENTER_MS,
  WENKU_SHEET_EXIT_MS,
  WENKU_SHEET_HANDLE_HEIGHT,
  WENKU_SHEET_HANDLE_WIDTH,
  WenkuActionSheet,
  WenkuActionSheetList,
} from './WenkuActionSheet';
export type { WenkuActionSheetProps, WenkuActionSheetRow } from './WenkuActionSheet';

export {
  WENKU_MENU_ENTER_MS,
  WENKU_MENU_EXIT_MS,
  WENKU_MENU_SOURCE_RADIUS,
  WENKU_MENU_WIDTH,
  WenkuActionBar,
  WenkuMenuHost,
  WenkuShelfMoreMenu,
  wenkuEntriesToSheetRows,
} from './WenkuMenuHost';
export type {
  WenkuActionBarProps,
  WenkuMenuEntry,
  WenkuMenuHostProps,
  WenkuShelfMoreMenuProps,
} from './WenkuMenuHost';

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
  WENKU_ICON_BUTTON_DISABLED_ALPHA,
  WENKU_ICON_BUTTON_GLYPH_PX,
  WENKU_ICON_BUTTON_PRESS_SCALE,
  WENKU_ICON_BUTTON_RADIUS_PX,
  WENKU_ICON_BUTTON_REST_ALPHA_DARK,
  WENKU_ICON_BUTTON_REST_ALPHA_LIGHT,
  WENKU_ICON_BUTTON_SIZE_PX,
  WENKU_PILL_BORDER_ALPHA_PRIMARY,
  WENKU_PILL_BORDER_ALPHA_SECONDARY,
  WENKU_PILL_BORDER_PX,
  WENKU_PILL_DISABLED_ALPHA,
  WENKU_PILL_GAP_PX,
  WENKU_PILL_GLYPH_PX,
  WENKU_PILL_HEIGHT_PX,
  WENKU_PILL_LABEL_SP,
  WENKU_PILL_MIN_WIDTH_PRIMARY_PX,
  WENKU_PILL_MIN_WIDTH_SECONDARY_PX,
  WENKU_PILL_PADDING_PX,
  WENKU_PILL_PRESS_SCALE,
  WENKU_PILL_RADIUS_PX,
  WENKU_SEARCH_CLEAR_LABEL,
  WENKU_SEARCH_COLLAPSE_LABEL,
  WENKU_SEARCH_COMPACT_SCALE_STEP,
  WENKU_SEARCH_FIELD_ACTION_SIZE_PX,
  WENKU_SEARCH_FIELD_ICON_PX,
  WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX,
  WENKU_SEARCH_FIELD_LEADING_WIDTH_PX,
  WENKU_SEARCH_FIELD_LINE_HEIGHT_SP,
  WENKU_SEARCH_FIELD_MIN_HEIGHT_PX,
  WENKU_SEARCH_FIELD_RADIUS_PX,
  WENKU_SEARCH_FIELD_TEXT_SP,
  WENKU_SEARCH_FIELD_TRAILING_SPACER_PX,
  WENKU_SEARCH_MIN_WIDTH_PX,
  WENKU_SEARCH_OPEN_LABEL,
  WENKU_SEARCH_WOBBLE_SCALE_X,
  WENKU_SEARCH_WOBBLE_SCALE_Y,
  WENKU_TEXT_BUTTON_BORDER_PX,
  WENKU_TEXT_BUTTON_DISABLED_ALPHA,
  WENKU_TEXT_BUTTON_GAP_PX,
  WENKU_TEXT_BUTTON_GLYPH_PX,
  WENKU_TEXT_BUTTON_LABEL_SP,
  WENKU_TEXT_BUTTON_MIN_HEIGHT_PX,
  WENKU_TEXT_BUTTON_PADDING_COMPACT_PX,
  WENKU_TEXT_BUTTON_PADDING_PX,
  WENKU_TEXT_BUTTON_RADIUS_PX,
  WENKU_TEXT_BUTTON_SELECTED_FRACTION,
  WENKU_JELLY_TAP_PRESS_SCALE,
  WENKU_MENU_PANEL_BORDER_ALPHA,
  WENKU_MENU_PANEL_BORDER_PX,
  WENKU_MENU_PANEL_MAX_WIDTH_PX,
  WENKU_MENU_PANEL_PADDING_Y_PX,
  WENKU_MENU_PANEL_RADIUS_PX,
  WENKU_MENU_PANEL_WIDTH_PX,
  WenkuExpandableSearch,
  WenkuGlass,
  WenkuIconButton,
  WenkuJellyTapSurface,
  WenkuMenu,
  WenkuPillButton,
  WenkuSearchField,
  WenkuTextButton,
  useWenkuDark,
  useWenkuReducedMotion,
  wenkuBlurSupported,
  wenkuInk,
  wenkuInkSecondary,
  wenkuOutline,
  wenkuPanel,
  wenkuPaper,
  wenkuRaised,
  wenkuTint,
} from './WenkuGlass';
export type {
  WenkuExpandableSearchProps,
  WenkuGlassProps,
  WenkuIconButtonProps,
  WenkuJellyTapSurfaceProps,
  WenkuMenuProps,
  WenkuPillButtonProps,
  WenkuSearchFieldProps,
  WenkuTextButtonProps,
} from './WenkuGlass';

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

/**
 * index.ts — 漫画阅读器面板族导出。
 *
 * 覆盖 Android `novel-reader/app/src/main/java/com/example/ui/comic/ComicReaderSheets.kt`
 * （1872 行）的全部底部面板 / 对话框：
 *   - ComicSettingsSheet        L151–278（含 7 个 Tab：TranslationTab / ModeTab /
 *                               PageTab / ImageTab / EffectTab / AutoTab / GestureTab）
 *   - ComicTocSheet             L1280–1348 + PageThumbCell L1350–1391
 *   - ComicPresetSheet          L1395–1608（含 PresetNameDialog L1611–1641）
 *   - ComicCropSheet            L1645–1872
 */
export { ComicSettingsSheet } from './ComicSettingsSheet';
export type { ComicSettingsSheetProps, ComicPreviewLoader, CustomFitStore } from './ComicSettingsSheet';

export { TranslationTab, UNSUPPORTED_TRANSLATION_BRIDGE, TRANSLATION_UNAVAILABLE_MESSAGE } from './ComicSettingsTranslationTab';
export type { TranslationBridge, TranslationTabProps } from './ComicSettingsTranslationTab';

export { ModeTab } from './ComicSettingsModeTab';
export type { ModeTabProps } from './ComicSettingsModeTab';

export { PageTab } from './ComicSettingsPageTab';
export type { PageTabProps } from './ComicSettingsPageTab';

export { ImageTab } from './ComicSettingsImageTab';
export type { ImageTabProps } from './ComicSettingsImageTab';

export { EffectTab } from './ComicSettingsEffectTab';
export type { EffectTabProps } from './ComicSettingsEffectTab';

export { AutoTab } from './ComicSettingsAutoTab';
export type { AutoTabProps } from './ComicSettingsAutoTab';

export { GestureTab } from './ComicSettingsGestureTab';
export type { GestureTabProps } from './ComicSettingsGestureTab';

export { ComicTocSheet } from './ComicTocSheet';
export type { ComicTocSheetProps, ComicThumbLoader } from './ComicTocSheet';

export { ComicPresetSheet } from './ComicPresetSheet';
export type { ComicPresetSheetProps, PresetStore } from './ComicPresetSheet';

export { PresetNameDialog } from './PresetNameDialog';

export { ComicCropSheet } from './ComicCropSheet';
export type { ComicCropSheetProps, ComicCropLoader } from './ComicCropSheet';

export { ComicIcon } from './ComicIcon';
export {
  ActionChip,
  ChasingDots,
  ComicSheetOverlay,
  EngineCard,
  PanelRow,
  PanelSectionCard,
  PanelSwitch,
  PanelTabRow,
  PanelTextField,
  SegmentRow,
  SheetGrabHandle,
  SliderRow,
  SwitchRow,
} from './comicSheetParts';

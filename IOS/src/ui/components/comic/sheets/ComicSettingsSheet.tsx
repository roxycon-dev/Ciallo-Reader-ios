/**
 * ComicSettingsSheet.tsx — 阅读设置面板（第二层：分组展示）。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt` 1872 行）：
 *   - 132–149   AccentColor + SettingsTabs（常量 → `@core/comic/comicReaderSheets`）
 *   - 151–278   ComicSettingsSheet
 *
 * Compose → TS 适配记录：
 *   - L173–177 `BoxWithConstraints { maxWidth > maxHeight }`：改为
 *     `useSyncExternalStore` 订阅 `matchMedia('(orientation: landscape)')`；
 *     高度/最大宽仍为 0.94/0.72 与 840/560。
 *   - L181–189 `Column(widthIn(max).fillMaxHeight(f).clip(shape).comicPanelGlass().border())`
 *     → `.cmcs-sheet` + CSS `backdrop-filter`（毛玻璃）。
 *   - L216–233 分组内容区 `verticalScroll` → `overflow-y: auto`。
 *   - L235–275 底部配置区 `navigationBarsPadding` → `env(safe-area-inset-bottom)`。
 *   - L243–266 「预设管理」入口 → 按钮，`onOpenPreset` 透传。
 *   - L268–273 「本漫画独立设置」→ SwitchRow（AppSwitch 模式）。
 *   - 全部 7 个 Tab 的实体迁到同目录的 `ComicSettings*Tab.tsx`，
 *     `when (tab)` → `switch (tab)`；Tab 内 composable 全部提到组件顶层，
 *     避免 `.map()` 回调内出现 Hook。
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  SETTINGS_TABS,
  SHEET_HEIGHT_LANDSCAPE,
  SHEET_HEIGHT_PORTRAIT,
  SHEET_MAX_WIDTH_LANDSCAPE,
  SHEET_MAX_WIDTH_PORTRAIT,
  type ComicSheetsBookState,
  type ComicSheetsConfig,
  type ComicSheetsCustomFitPreset,
  type ComicSheetsPageRef,
} from '@core/comic/comicReaderSheets';
import { ComicIcon } from './ComicIcon';
import { ComicSheetOverlay, PanelTabRow, SwitchRow } from './comicSheetParts';
import { TranslationTab, type TranslationBridge } from './ComicSettingsTranslationTab';
import { ModeTab } from './ComicSettingsModeTab';
import { PageTab } from './ComicSettingsPageTab';
import { ImageTab } from './ComicSettingsImageTab';
import { EffectTab } from './ComicSettingsEffectTab';
import { AutoTab } from './ComicSettingsAutoTab';
import { GestureTab } from './ComicSettingsGestureTab';

/* ── 横竖屏（替代 L173–174 的 BoxWithConstraints） ── */

const LANDSCAPE_QUERY = '(orientation: landscape)';

function subscribeOrientation(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(LANDSCAPE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function readLandscape(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(LANDSCAPE_QUERY).matches;
}

/* ── 预设仓库的最小接口（Kotlin ComicSettingsStore，只用到自定义缩放预设） ── */

export interface CustomFitStore {
  loadCustomFitPresets(): ComicSheetsCustomFitPreset[];
  saveCustomFitPreset(name: string, base: string, scalePct: number): unknown;
  deleteCustomFitPreset(id: string): boolean;
}

export interface ComicSettingsSheetProps {
  config: ComicSheetsConfig;
  /** Kotlin `store: ComicSettingsStore`（可为 null → 隐藏自定义缩放预设区，L661） */
  store: CustomFitStore | null;
  perBookConfig: boolean;
  onPerBookConfigChange: (next: boolean) => void;
  onConfigChange: (next: ComicSheetsConfig) => void;
  onOpenPreset: () => void;
  onOpenCrop: () => void;
  pages: readonly ComicSheetsPageRef[];
  /** Kotlin `loader: ComicPageLoader`（面板只用预览图） */
  loader: ComicPreviewLoader;
  currentRawPage: number;
  bookState: ComicSheetsBookState;
  onBookStateChange: (next: ComicSheetsBookState) => void;
  /**
   * 漫画翻译平台桥（Kotlin L282-503 依赖的 `TranslateModelManager` /
   * `TranslationCache` / `LlmBubbleTranslator` / `OnlineFallbackTranslator`）。
   *
   * iOS 侧 ONNX 推理不可用（见 docs/PARITY_EXCEPTIONS.md E1），
   * 所以宿主应传 `UNSUPPORTED_TRANSLATION_BRIDGE`，让「翻译」Tab 显示
   * 「漫画翻译在 iOS 上不可用」而不是静默消失。
   */
  translationBridge: TranslationBridge;
  /**
   * Kotlin `ComicReaderChrome.kt` L107-116 `comicPanelGlass(backdrop, shape)`：
   * 宿主传 `panelGlassSamplingActive(...)`。`false`（CURL 的 GL 层采不到 backdrop）
   * 时回退 `PanelBg` 纯半透明；缺省 = 有 backdrop。
   */
  glass?: boolean | undefined;
  onDismiss: () => void;
}

/** 预览管线（Kotlin 940–952 `loader.loadPreview`）：返回可用 URL 或 null */
export interface ComicPreviewLoader {
  loadPreview(page: ComicSheetsPageRef, config: ComicSheetsConfig): Promise<string | null>;
}

export function ComicSettingsSheet(props: ComicSettingsSheetProps) {
  const [tab, setTab] = useState(0);
  const landscape = useSyncExternalStore(subscribeOrientation, readLandscape, () => false);

  // Kotlin 169 `val update: ((ComicReaderConfig) -> ComicReaderConfig) -> Unit = { onConfigChange(it(config)) }`
  // 用 setState 无关的稳定回调表达：直接透传 config 的函数式更新。
  const update = useCallback(
    (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => {
      props.onConfigChange(mutate(props.config));
    },
    [props],
  );

  const sheetHeight = landscape ? SHEET_HEIGHT_LANDSCAPE : SHEET_HEIGHT_PORTRAIT;
  const sheetMaxWidth = landscape ? SHEET_MAX_WIDTH_LANDSCAPE : SHEET_MAX_WIDTH_PORTRAIT;

  return (
    <ComicSheetOverlay
      onDismiss={props.onDismiss}
      ariaLabel="阅读设置"
      className="cmcs-sheet--settings"
      style={{ height: `${sheetHeight * 100}dvh`, maxWidth: `${sheetMaxWidth}px` }}
      glass={props.glass}
    >
      {/* L199–203 标题 */}
      <div className="cmcs-sheet__title">阅读设置</div>

      {/* L206–212 分组 Tab（固定） */}
      <div className="cmcs-sheet__tabs-pad">
        <PanelTabRow tabs={SETTINGS_TABS} selected={tab} onSelect={setTab} />
      </div>
      <div className="cmcs-sheet__gap6" />

      {/* L216–233 分组内容（滚动） */}
      <div className="cmcs-sheet__body">
        {tab === 0 ? <ModeTab config={props.config} update={update} /> : null}
        {tab === 1 ? (
          <PageTab config={props.config} update={update} store={props.store} />
        ) : null}
        {tab === 2 ? (
          <ImageTab
            config={props.config}
            update={update}
            onOpenCrop={props.onOpenCrop}
            pages={props.pages}
            loader={props.loader}
            currentRawPage={props.currentRawPage}
            bookState={props.bookState}
            onBookStateChange={props.onBookStateChange}
          />
        ) : null}
        {tab === 3 ? (
          <TranslationTab
            config={props.config}
            update={update}
            bridge={props.translationBridge}
          />
        ) : null}
        {tab === 4 ? <EffectTab config={props.config} update={update} /> : null}
        {tab === 5 ? <AutoTab config={props.config} update={update} /> : null}
        {tab === 6 ? <GestureTab config={props.config} update={update} /> : null}
        <div className="cmcs-sheet__gap12" />
      </div>

      {/* L235–275 配置区（固定在底部） */}
      <div className="cmcs-sheet__footer">
        <div className="cmcs-sheet__divider" />
        <button type="button" className="cmcs-chiprow" onClick={props.onOpenPreset}>
          <span className="cmcs-chiprow__icon" style={{ color: 'rgba(5, 150, 105, 0.9)' }} aria-hidden="true">
            <ComicIcon name="Tune" size={16} />
          </span>
          <span className="cmcs-chiprow__gap8" />
          <span className="cmcs-chiprow__label">预设管理</span>
          <span className="cmcs-chiprow__chev" aria-hidden="true">
            <ComicIcon name="ChevronRight" size={16} />
          </span>
        </button>
        <div className="cmcs-sheet__gap4" />
        <SwitchRow
          title="本漫画独立设置"
          subtitle={props.perBookConfig ? '仅当前漫画生效' : '跟随全局设置'}
          checked={props.perBookConfig}
          onChange={props.onPerBookConfigChange}
        />
        <div className="cmcs-sheet__gap6" />
      </div>
    </ComicSheetOverlay>
  );
}

/**
 * ComicSettingsAutoTab.tsx — 设置面板 Tab 5「自动阅读」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt` 1224–1241）：
 *   - 1226–1241 AutoTab
 *   - 1228–1233  「自动翻页」`SliderRow("翻页间隔", 2f..60f, "${it.toInt()} 秒")`
 *   - 1235–1240  「自动滚动」`SliderRow("滚动速度", 10f..300f, "${it.toInt()} dp/s")`
 *
 * 适配与跳过：
 *   - `Slider` → `<input type="range">`（Adaptation #3），格式化交 `@core/comic`
 *     的 `formatSeconds` / `formatDpPerSec`。
 *   - Kotlin 1236–1239 的尾随 lambda `onChange` → props 里的 `onChange`。
 */
import { formatDpPerSec, formatSeconds, type ComicSheetsConfig } from '@core/comic/comicReaderSheets';
import { PanelSectionCard, SliderRow } from './comicSheetParts';

export interface AutoTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
}

export function AutoTab(props: AutoTabProps) {
  const { config, update } = props;
  return (
    <>
      {/* L1228–1233 自动翻页 */}
      <PanelSectionCard title="自动翻页" icon="Schedule">
        <SliderRow
          title="翻页间隔"
          value={config.autoPageIntervalSec}
          range={[2, 60]}
          format={formatSeconds}
          onChange={(v) => update((c) => ({ ...c, autoPageIntervalSec: v }))}
        />
      </PanelSectionCard>

      {/* L1235–1240 自动滚动 */}
      <PanelSectionCard title="自动滚动" icon="SwipeVertical">
        <SliderRow
          title="滚动速度"
          value={config.autoScrollSpeedDp}
          range={[10, 300]}
          format={formatDpPerSec}
          onChange={(v) => update((c) => ({ ...c, autoScrollSpeedDp: v }))}
        />
      </PanelSectionCard>
    </>
  );
}

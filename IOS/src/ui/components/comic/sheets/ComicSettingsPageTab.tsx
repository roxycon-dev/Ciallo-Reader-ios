/**
 * ComicSettingsPageTab.tsx — 设置面板 Tab 1「显示（缩放/间距）」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 612–625  缩放档展示序列 + `fitLabel`（常量已抽到 `@core/comic/comicReaderSheets`）
 *   - 627–639  PageTab 首段「缩放方式」
 *   - 641–716  「自定义缩放」（仅 `fit == CUSTOM` 时显示）
 *   - 718–729  「间距」
 *   - 731–754  「双页排列」
 *   - 756–766  「缩放」
 *
 * 适配与跳过：
 *   - L634–638 `FitOptions.mapIndexed { i, (_, label) -> i to label }` → `.map` 直接出
 *     `{id, label}`（同样的 FlowRow 分段控件由 `SegmentRow` 承担）。
 *   - L656–660 `SliderRow("缩放系数", 0.5f..2.5f)` → `<input type="range">`。
 *   - L664–669 `ActionChip("保存当前组合")` 打开 `PresetNameDialog`（本文件内联实现，
 *     与 Kotlin 1611–1641 同一组件，另见 `PresetNameDialog.tsx`；此处复用其导出）。
 *   - L670–701 自定义缩放预设列表（点击套用 / 删除）：`.map` 内无 Hook，删除直接调 store。
 *   - L702–713 `nameDialog` → 本地 state + `PresetNameDialog`。
 *   - L661 `if (store != null)` → `store === null` 时整块隐藏（与 Kotlin 一致）。
 *   - L718–729 / 731–754 / 756–766 的 `format` lambda → `@core/comic` 的格式化函数。
 */
import { useState } from 'react';
import {
  DOUBLE_ALIGN_SEGMENT,
  CUSTOM_FIT_BASES,
  FIT_OPTIONS,
  clampPresetName,
  customFitBaseBySegmentIndex,
  customFitBaseSegmentIndex,
  doubleAlignByIndex,
  doubleAlignIndex,
  fitBySegmentIndex,
  fitLabel,
  fitSegmentIndex,
  formatDp,
  formatScalePercent,
  type ComicSheetsConfig,
  type ComicSheetsCustomFitPreset,
} from '@core/comic/comicReaderSheets';
import type { CustomFitStore } from './ComicSettingsSheet';
import { ActionChip, PanelSectionCard, SegmentRow, SliderRow, SwitchRow } from './comicSheetParts';
import { PresetNameDialog } from './PresetNameDialog';

export interface PageTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
  /** Kotlin 631 `store: ComicSettingsStore? = null` */
  store: CustomFitStore | null;
}

/* ── 单条自定义缩放预设（提取为组件，避免 .map() 内 Hook） ── */

function CustomFitPresetRow(props: {
  preset: ComicSheetsCustomFitPreset;
  onApply: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="cmcs-fitrow">
      <button
        type="button"
        className="cmcs-fitrow__chip"
        onClick={props.onApply}
        title={`${props.preset.name}（${fitLabel(props.preset.base)} × ${props.preset.scalePct}%）`}
      >
        {`${props.preset.name}（${fitLabel(props.preset.base)} × ${props.preset.scalePct}%）`}
      </button>
      <button type="button" className="cmcs-textbtn cmcs-textbtn--sm" onClick={props.onDelete}>
        删除
      </button>
    </div>
  );
}

export function PageTab(props: PageTabProps) {
  const { config, update, store } = props;
  // Kotlin 662–663：`presets` / `nameDialog` 两份 state
  const [presets, setPresets] = useState<ComicSheetsCustomFitPreset[]>(() =>
    store === null ? [] : store.loadCustomFitPresets(),
  );
  const [nameDialog, setNameDialog] = useState(false);

  const refresh = () => {
    if (store === null) return;
    setPresets(store.loadCustomFitPresets());
  };

  return (
    <>
      {/* L633–639 缩放方式 */}
      <PanelSectionCard title="缩放方式" icon="AspectRatio">
        <SegmentRow
          title="适配"
          options={FIT_OPTIONS.map((entry, i) => ({ id: i, label: entry[1] }))}
          selected={fitSegmentIndex(config.fit)}
          onSelect={(i) => update((c) => ({ ...c, fit: fitBySegmentIndex(i) }))}
        />
      </PanelSectionCard>

      {/* L641–716 自定义缩放 */}
      {config.fit === 'CUSTOM' ? (
        <PanelSectionCard title="自定义缩放" icon="Tune">
          <SegmentRow
            title="基础适配"
            options={CUSTOM_FIT_BASES.map((entry, i) => ({ id: i, label: entry[1] }))}
            selected={customFitBaseSegmentIndex(config.customFitBase)}
            onSelect={(i) =>
              update((c) => ({ ...c, customFitBase: customFitBaseBySegmentIndex(i) }))
            }
          />
          <SliderRow
            title="缩放系数"
            value={config.customFitScale}
            range={[0.5, 2.5]}
            format={formatScalePercent}
            onChange={(v) => update((c) => ({ ...c, customFitScale: v }))}
          />
          {store !== null ? (
            <>
              <div className="cmcs-fitrow-actions">
                <ActionChip text="保存当前组合" onClick={() => setNameDialog(true)} />
              </div>
              {presets.map((p) => (
                <CustomFitPresetRow
                  key={p.id}
                  preset={p}
                  onApply={() =>
                    update((c) => ({
                      ...c,
                      fit: 'CUSTOM',
                      customFitBase: p.base,
                      customFitScale: p.scalePct / 100,
                    }))
                  }
                  onDelete={() => {
                    store.deleteCustomFitPreset(p.id);
                    refresh();
                  }}
                />
              ))}
              {nameDialog ? (
                <PresetNameDialog
                  title="保存自定义缩放"
                  initial=""
                  onConfirm={(rawName) => {
                    store.saveCustomFitPreset(
                      clampPresetName(rawName),
                      config.customFitBase,
                      Math.trunc(config.customFitScale * 100),
                    );
                    refresh();
                    setNameDialog(false);
                  }}
                  onDismiss={() => setNameDialog(false)}
                />
              ) : null}
            </>
          ) : null}
        </PanelSectionCard>
      ) : null}

      {/* L718–729 间距 */}
      <PanelSectionCard title="间距" icon="Height">
        <SliderRow
          title="页面间距"
          value={config.pageSpacingDp}
          range={[0, 40]}
          format={formatDp}
          onChange={(v) => update((c) => ({ ...c, pageSpacingDp: v }))}
        />
        <SliderRow
          title="双页间距"
          value={config.doubleGapDp}
          range={[0, 40]}
          format={formatDp}
          onChange={(v) => update((c) => ({ ...c, doubleGapDp: v }))}
        />
      </PanelSectionCard>

      {/* L731–754 双页排列 */}
      <PanelSectionCard title="双页排列" icon="Bookmark">
        <SwitchRow
          title="首页单独显示"
          subtitle="封面页不与正文配对"
          checked={config.doubleFirstAlone}
          onChange={(v) => update((c) => ({ ...c, doubleFirstAlone: v }))}
        />
        <SegmentRow
          title="对齐"
          options={DOUBLE_ALIGN_SEGMENT}
          selected={doubleAlignIndex(config.doubleAlign)}
          onSelect={(i) => update((c) => ({ ...c, doubleAlign: doubleAlignByIndex(i) }))}
        />
        <SliderRow
          title="位置修正 X"
          value={config.doubleShiftXDp}
          range={[-40, 40]}
          format={formatDp}
          onChange={(v) => update((c) => ({ ...c, doubleShiftXDp: v }))}
        />
        <SliderRow
          title="位置修正 Y"
          value={config.doubleShiftYDp}
          range={[-40, 40]}
          format={formatDp}
          onChange={(v) => update((c) => ({ ...c, doubleShiftYDp: v }))}
        />
      </PanelSectionCard>

      {/* L756–766 缩放 */}
      <PanelSectionCard title="缩放" icon="ZoomIn">
        <SwitchRow
          title="双击放大"
          subtitle="再次双击还原"
          checked={config.doubleTapZoom}
          onChange={(v) => update((c) => ({ ...c, doubleTapZoom: v }))}
        />
        <SwitchRow
          title="长按放大"
          subtitle="按住临时放大，松手还原"
          checked={config.longPressZoom}
          onChange={(v) => update((c) => ({ ...c, longPressZoom: v }))}
        />
        <SwitchRow
          title="放大状态翻页"
          subtitle="滑动到边缘继续翻页"
          checked={config.zoomWhileTurn}
          onChange={(v) => update((c) => ({ ...c, zoomWhileTurn: v }))}
        />
      </PanelSectionCard>
    </>
  );
}

/**
 * ComicSettingsModeTab.tsx — 设置面板 Tab 0「翻页（模式/方向/动画）」。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 505–539  ModeTab
 *   - 541–578  ModeGrid（FlowRow maxItemsInEachRow = 3）
 *   - 580–610  DirectionGrid（同上）
 *
 * 适配与跳过：
 *   - L545–550 / 583–588 `FlowRow(maxItemsInEachRow = 3)` → CSS grid
 *     `grid-template-columns: repeat(3, 1fr)`（放不下的项自动换行，文字零截断）。
 *   - L556–562 `Modifier.weight(1f)` 等宽格 → grid `1fr`。
 *   - L560/597 `MintPrimary.copy(alpha=0.6f)` 边框 → CSS 选中态 `border-color`。
 *   - L567–574 `maxLines = 2, softWrap = true` → CSS line-clamp 2。
 *   - L527–538：条漫/无缝滚动才显示「垂直滚动」分区
 *     （WEBTOON 可关磁吸；CONTINUOUS 恒真、不可改）。
 */
import {
  DIRECTION_OPTIONS,
  MODE_OPTIONS,
  PAGE_ANIM_SEGMENT,
  pageAnimByIndex,
  pageAnimIndex,
  type ComicSheetsConfig,
} from '@core/comic/comicReaderSheets';
import { PanelSectionCard, SegmentRow, SwitchRow } from './comicSheetParts';

export interface ModeTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
}

/* ── 单个格子（提取为组件，避免在 .map() 回调里出现 Hook） ── */

function GridCell(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={props.active ? 'cmcs-grid__cell cmcs-grid__cell--active' : 'cmcs-grid__cell'}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <span
        className={props.active ? 'cmcs-grid__label cmcs-grid__label--active' : 'cmcs-grid__label'}
      >
        {props.label}
      </span>
    </button>
  );
}

export function ModeTab(props: ModeTabProps) {
  const { config, update } = props;
  return (
    <>
      {/* L509–511 阅读模式 */}
      <PanelSectionCard title="阅读模式" icon="AutoStories">
        <div className="cmcs-grid cmcs-grid--3">
          {MODE_OPTIONS.map((opt) => (
            <GridCell
              key={opt.mode}
              label={opt.label}
              active={opt.mode === config.mode}
              onClick={() => update((c) => ({ ...c, mode: opt.mode }))}
            />
          ))}
        </div>
      </PanelSectionCard>

      {/* L512–514 阅读方向 */}
      <PanelSectionCard title="阅读方向" icon="SwapHoriz">
        <div className="cmcs-grid cmcs-grid--3">
          {DIRECTION_OPTIONS.map((opt) => (
            <GridCell
              key={opt.direction}
              label={opt.label}
              active={opt.direction === config.direction}
              onClick={() => update((c) => ({ ...c, direction: opt.direction }))}
            />
          ))}
        </div>
      </PanelSectionCard>

      {/* L515–526 翻页动画 */}
      <PanelSectionCard title="翻页动画" icon="Animation">
        <SegmentRow
          title="动画"
          options={PAGE_ANIM_SEGMENT}
          selected={pageAnimIndex(config.pageAnim)}
          onSelect={(i) => update((c) => ({ ...c, pageAnim: pageAnimByIndex(i) }))}
        />
      </PanelSectionCard>

      {/* L527–538 垂直滚动（仅条漫 / 无缝滚动） */}
      {config.mode === 'WEBTOON' || config.mode === 'CONTINUOUS' ? (
        <PanelSectionCard title="垂直滚动" icon="SwipeVertical">
          {config.mode === 'WEBTOON' ? (
            <SwitchRow
              title="磁吸到页边界"
              subtitle="松手自动对齐到最近页"
              checked={config.webtoonSnap}
              onChange={(v) => update((c) => ({ ...c, webtoonSnap: v }))}
            />
          ) : (
            <SwitchRow
              title="无缝拼接"
              subtitle="页间距为 0，连续不断停"
              checked
              onChange={() => {}}
            />
          )}
        </PanelSectionCard>
      ) : null}
    </>
  );
}

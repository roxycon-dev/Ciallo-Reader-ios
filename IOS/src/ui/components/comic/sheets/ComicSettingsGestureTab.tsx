/**
 * ComicSettingsGestureTab.tsx — 设置面板 Tab「手势」。
 *
 * Kotlin 行号映射（`com.example.ui.comic.ComicReaderSheets.kt`）：
 *   - 1403      `/* ── Tab 5：手势 ── *\/`
 *   - 1405–1446 `private fun GestureTab(config, update)`
 *   - 1407      `PanelSectionCard("点按区域动作", Icons.Filled.PanTool)`
 *   - 1408–1410 `PanelHint(if (direction == RTL && mode != WEBTOON && mode != CONTINUOUS) … else …)`
 *   - 1411      `val actions = ComicGestureAction.entries.map { it.ordinal to it.label }`
 *   - 1412–1414 `vertical` / `reverse` 的推导
 *   - 1415–1417 `SegmentRow(if (vertical) "顶部区域" else if (reverse) "右侧区域" else "左侧区域", …)`
 *   - 1418–1420 `SegmentRow("中间区域", …)`
 *   - 1421–1423 `SegmentRow(if (vertical) "底部区域" else if (reverse) "左侧区域" else "右侧区域", …)`
 *   - 1424–1427 `TextButton` 「恢复默认点按动作」
 *   - 1430      `PanelSectionCard("手势开关", Icons.Filled.TouchApp)`
 *   - 1431–1444 5 个 `SwitchRow`
 *
 * 适配与跳过：
 *   - L1411 `ComicGestureAction.entries.map { it.ordinal to it.label }` →
 *     `GESTURE_SEGMENT`（@core/comic/comicReaderSheets，7 项顺序与中文标签原样）。
 *   - L1416/1419/1422 `config.gestureTapXxx.ordinal` → `gestureIndexOf`（@core/comic）。
 *   - L1424 `TextButton` → 面板既有的 `.cmcs-textbtn`（次级文字按钮，与 Kotlin
 *     `TextButton` 的 `TextSecondary` 配色一致）。
 *   - L1408 `PanelHint` → 新增 `PanelHint`（`comicSheetParts.tsx` + `.cmcs-hint`），
 *     样式照 `ComicPanelDesign.kt:190-193` 的 TypeCaption / SpaceXs。
 *   - `SegmentRow` 的 FlowRow 由 `comicSheetParts.tsx` 以 flex-wrap 承担，
 *     7 个选项放不下自动换行（对应 Kotlin L616–617 注释修复的实机 bug）。
 */
import {
  GESTURE_SEGMENT,
  gestureActionByIndex,
  gestureIndexOf,
  type ComicGestureAction,
  type ComicSheetsConfig,
} from '@core/comic/comicReaderSheets';
import { PanelHint, PanelSectionCard, SegmentRow, SwitchRow } from './comicSheetParts';

export interface GestureTabProps {
  config: ComicSheetsConfig;
  update: (mutate: (current: ComicSheetsConfig) => ComicSheetsConfig) => void;
}

type GestureField = 'gestureTapLeft' | 'gestureTapCenter' | 'gestureTapRight';

export function GestureTab(props: GestureTabProps) {
  const { config, update } = props;

  const pick = (field: GestureField) => (i: number) =>
    update((c) => ({ ...c, [field]: gestureActionByIndex(i) }));

  const row = (field: GestureField, title: string) => (
    <SegmentRow
      key={field}
      title={title}
      options={GESTURE_SEGMENT}
      selected={gestureIndexOf(config[field] as ComicGestureAction)}
      onSelect={pick(field)}
    />
  );

  /* Kotlin L1408-1410 — the hint text flips with RTL horizontal reading. */
  const rtlHorizontal =
    config.direction === 'RTL' && config.mode !== 'WEBTOON' && config.mode !== 'CONTINUOUS';
  const hint = rtlHorizontal
    ? '右至左阅读：左侧对应下一页区域，右侧对应上一页区域。'
    : '按阅读轴分为三个区域；控制栏显示时，翻页点按先收起控制栏。';

  /* Kotlin L1412-1414 — `vertical` / `reverse` drive the three region labels. */
  const vertical =
    config.mode === 'WEBTOON' ||
    config.mode === 'CONTINUOUS' ||
    (config.direction === 'TTB' && config.mode !== 'DOUBLE');
  const reverse = config.direction === 'RTL' && !vertical;

  return (
    <>
      {/* L1407 点按区域动作 */}
      <PanelSectionCard title="点按区域动作" icon="PanTool">
        <PanelHint text={hint} />
        {row('gestureTapLeft', vertical ? '顶部区域' : reverse ? '右侧区域' : '左侧区域')}
        {row('gestureTapCenter', '中间区域')}
        {row('gestureTapRight', vertical ? '底部区域' : reverse ? '左侧区域' : '右侧区域')}
        {/* L1424-1427 恢复默认点按动作 */}
        <button
          type="button"
          className="cmcs-textbtn"
          onClick={() =>
            update((c) => ({
              ...c,
              gestureTapLeft: 'PREV',
              gestureTapCenter: 'TOGGLE_CONTROLS',
              gestureTapRight: 'NEXT',
            }))
          }
        >
          恢复默认点按动作
        </button>
      </PanelSectionCard>

      {/* L1430 手势开关 */}
      <PanelSectionCard title="手势开关" icon="TouchApp">
        <SwitchRow
          title="单指滑动翻页"
          checked={config.gestureSwipe}
          onChange={(v) => update((c) => ({ ...c, gestureSwipe: v }))}
        />
        <SwitchRow
          title="双指合拢退出"
          subtitle="缩小到阈值时退出阅读"
          checked={config.gesturePinchClose}
          onChange={(v) => update((c) => ({ ...c, gesturePinchClose: v }))}
        />
        <SwitchRow
          title="侧边滑动关闭"
          subtitle="从两侧边缘向内滑动；放大查看时不触发"
          checked={config.gestureEdgeSwipe}
          onChange={(v) => update((c) => ({ ...c, gestureEdgeSwipe: v }))}
        />
        <SwitchRow
          title="长按呼出控制层"
          subtitle="与长按放大互斥（放大优先）"
          checked={config.gestureLongPressPanel}
          onChange={(v) => update((c) => ({ ...c, gestureLongPressPanel: v }))}
        />
        {/* 第 28 条：音量键翻页（方向感知：RTL 下音量上=下一页），仅阅读页拦截 */}
        <SwitchRow
          title="音量键翻页"
          checked={config.volumeKeyTurn}
          onChange={(v) => update((c) => ({ ...c, volumeKeyTurn: v }))}
        />
      </PanelSectionCard>
    </>
  );
}
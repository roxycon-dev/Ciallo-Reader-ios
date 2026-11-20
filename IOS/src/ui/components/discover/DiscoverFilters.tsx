/**
 * 发现页筛选条 —— `discover/DiscoverFilters.kt` L42-148 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L43-131 `DiscoverFilters(tabs, onTab, source, onSource, selected, onCategory, onRemove, onClear,
 *            refreshing, onRefresh, sorts, onSort, statuses, status, statusHint, onStatus)`
 *     L50  `duration = if (LocalReduceMotion.current) 0 else 180`       → `DISCOVER_TAB_FADE_MS`
 *     L51  `GlassCard(RoundedCornerShape(20.dp), padding start 14 / top 4 / end 16 / bottom 6)`
 *     L52  `LazyRow(spacedBy(24.dp))` + `testTag("discover_dimension_tabs")`
 *     L55-57 选中态：ink = `discoverAccentText()`，字重 Bold
 *     L58  底部 3dp 指示条（选中 = primary）
 *     L62  `HorizontalDivider(.5.dp, outline@.24)`
 *     L64-70 行内 `WenkuTextButton`（书源 / 分类 / 排序 / 状态）
 *   L133-148 `Modifier.discoverPressSelect(selected, onClick)`：选中态按压（120ms 接触）
 */
import { useMemo, type CSSProperties } from 'react';

import { discoverAccentText } from '@core/discover/design';
import { useWenkuReducedMotion } from '../wenku/WenkuGlass';
import { WenkuTextButton } from '../wenku/WenkuGlass';
import { GlassCard } from '../GlassCard';
import '../../../styles/discover.css';

/** L50 `if (reduceMotion) 0 else 180`。 */
export const DISCOVER_TAB_FADE_MS = 180;
/** L51 `RoundedCornerShape(20.dp)` 与四向内边距。 */
export const DISCOVER_FILTER_RADIUS_PX = 20;
export const DISCOVER_FILTER_PADDING = { start: 14, top: 4, end: 16, bottom: 6 } as const;
/** L52 `spacedBy(24.dp)`。 */
export const DISCOVER_TAB_GAP_PX = 24;
/** L56 `heightIn(min = 48.dp)`。 */
export const DISCOVER_TAB_MIN_HEIGHT_PX = 48;
/** L57 字号 / 行高。 */
export const DISCOVER_TAB_FONT_SP = 16;
export const DISCOVER_TAB_LINE_SP = 20;
/** L58 指示条高度（3.dp）。 */
export const DISCOVER_TAB_INDICATOR_PX = 3;
/** L62 分隔线（.5.dp，outline @.24）。 */
export const DISCOVER_FILTER_DIVIDER_PX = 0.5;
export const DISCOVER_FILTER_DIVIDER_ALPHA = 0.24;
/** L52 `testTag("discover_dimension_tabs")`。 */
export const DISCOVER_DIMENSION_TABS_TAG = 'discover_dimension_tabs';

export interface DiscoverFiltersProps {
  /** L43 `tabs: List<Pair<String, Boolean>>`（label, checked）。 */
  readonly tabs: ReadonlyArray<readonly [string, boolean]>;
  readonly onTab: (index: number) => void;
  readonly source: string;
  readonly onSource: () => void;
  /** 已选分类 id 集合（L69 的 `分类 N`）。 */
  readonly selected: ReadonlySet<string>;
  readonly onCategory: () => void;
  readonly onRemove: (id: string) => void;
  readonly onClear: () => void;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly sorts: ReadonlyArray<readonly [string, boolean]>;
  readonly onSort: (index: number) => void;
  readonly statuses: readonly string[];
  readonly status: string;
  readonly statusHint?: string | null;
  readonly onStatus: (status: string) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** L42-131 `DiscoverFilters`。 */
export function DiscoverFilters(props: DiscoverFiltersProps) {
  const reduceMotion = useWenkuReducedMotion();
  const duration = reduceMotion ? 0 : DISCOVER_TAB_FADE_MS;
  const accentInk = useMemo(() => `#${discoverAccentText(0x059669, 0xffffff).toString(16).padStart(6, '0')}`, []);
  const categoryLabel =
    props.selected.size === 0 ? '分类' : `分类 ${String(props.selected.size)}`;

  return (
    <GlassCard radius={DISCOVER_FILTER_RADIUS_PX} padding={0} className="discover-filters">
      <div
        className="discover-filters__tabs"
        data-testid={DISCOVER_DIMENSION_TABS_TAG}
        style={{
          display: 'flex',
          gap: `${String(DISCOVER_TAB_GAP_PX)}px`,
          paddingInlineStart: `${String(DISCOVER_FILTER_PADDING.start)}px`,
          paddingInlineEnd: `${String(DISCOVER_FILTER_PADDING.end)}px`,
          paddingTop: `${String(DISCOVER_FILTER_PADDING.top)}px`,
          overflowX: 'auto',
        }}
      >
        {props.tabs.map(([label, checked], index) => (
          <button
            key={`${String(index)}:${label}`}
            type="button"
            className={['discover-filters__tab', checked ? 'is-checked' : ''].filter(Boolean).join(' ')}
            aria-selected={checked}
            onClick={() => props.onTab(index)}
            style={{
              minHeight: `${String(DISCOVER_TAB_MIN_HEIGHT_PX)}px`,
              fontSize: `${String(DISCOVER_TAB_FONT_SP)}px`,
              lineHeight: `${String(DISCOVER_TAB_LINE_SP)}px`,
              fontWeight: checked ? 700 : 400,
              color: checked ? accentInk : 'var(--color-medium-gray)',
              transition: `color ${String(duration)}ms var(--ease-out)`,
            }}
          >
            <span className="discover-filters__tab-label">{label}</span>
            <span
              className="discover-filters__tab-indicator"
              style={{
                height: `${String(DISCOVER_TAB_INDICATOR_PX)}px`,
                background: checked ? 'var(--color-primary)' : 'transparent',
              }}
            />
          </button>
        ))}
      </div>
      <div
        className="discover-filters__divider"
        style={{
          height: `${String(DISCOVER_FILTER_DIVIDER_PX)}px`,
          background: `color-mix(in srgb, var(--color-divider-gray) ${String(
            DISCOVER_FILTER_DIVIDER_ALPHA * 100,
          )}%, transparent)`,
        }}
      />
      <div
        className="discover-filters__row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: `2px ${String(DISCOVER_FILTER_PADDING.end)}px ${String(
            DISCOVER_FILTER_PADDING.bottom,
          )}px ${String(DISCOVER_FILTER_PADDING.start)}px`,
        }}
      >
        <WenkuTextButton text={props.source} onClick={props.onSource} compact symbol="Folder" style={{ flex: '1 1 0' }} />
        <WenkuTextButton
          text={categoryLabel}
          onClick={props.onCategory}
          selected={props.selected.size > 0}
          compact
          symbol="Filter"
        />
        <WenkuTextButton
          text="刷新"
          onClick={props.onRefresh}
          compact
          symbol="Refresh"
          {...(props.refreshing ? { enabled: false } : null)}
        />
      </div>
      {props.statusHint === null || props.statusHint === undefined ? null : (
        <p className="discover-filters__hint">{props.statusHint}</p>
      )}
      <div className="discover-filters__chips">
        {[...props.selected].map((id) => (
          <button key={id} type="button" className="discover-filters__chip" onClick={() => props.onRemove(id)}>
            {id} ✕
          </button>
        ))}
        {props.selected.size === 0 ? null : (
          <button type="button" className="discover-filters__chip" onClick={props.onClear}>
            清除
          </button>
        )}
      </div>
    </GlassCard>
  );
}

/** L133-148 `Modifier.discoverPressSelect(selected, onClick)`：返回按压态需要的 className。 */
export function discoverPressSelect(selected: boolean, disabled = false): {
  readonly className: string;
  readonly 'aria-selected': boolean;
  readonly 'aria-disabled': boolean;
} {
  return {
    className: [
      'discover-press-select',
      selected ? 'is-selected' : '',
      disabled ? 'is-disabled' : '',
    ]
      .filter(Boolean)
      .join(' '),
    'aria-selected': selected,
    'aria-disabled': disabled,
  };
}

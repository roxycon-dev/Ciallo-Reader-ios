/**
 * 发现页面板 —— `discover/DiscoverPanels.kt` L26-184 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L26-59  `DiscoverSourceStatusSheet(visible, sources, rows, state, …)` → `DiscoverSourceStatusSheet`
 *   L61-77  `DiscoverSourcePicker(sources, enabled, selected, …)`         → `DiscoverSourcePicker`
 *   L79-90  `SourceOption(id, title, enabled, selected, onSelect)`        → `SourceOption`
 *   L92-171 `DiscoverCategorySheet(entries, selected, …)`                → `DiscoverCategorySheet`
 *   L173-184 `CategorySearchHeader(search, facet, onSearch, onFacet)`     → `CategorySearchHeader`
 *
 * 平台差异（已登记 E136）：Compose `ModalBottomSheet` / `LazyColumn` → 固定定位面板 +
 * 滚动容器；可见性与关闭动画沿用 `WENKU_SHEET_ENTER_MS` / `WENKU_SHEET_EXIT_MS`。
 */
import { useMemo, useState, type CSSProperties } from 'react';

import { DiscoverTaxonomy, type DiscoverCategory } from '@core/discover/taxonomy';
import { GlassCard } from '../GlassCard';
import { WenkuTextButton } from '../wenku/WenkuGlass';
import '../../../styles/discover.css';

export interface DiscoverSourceLike {
  readonly id: string;
  readonly name: string;
}

export interface DiscoverSourceStatusSheetProps {
  readonly visible: boolean;
  readonly sources: readonly DiscoverSourceLike[];
  /** 每个源的状态行（`rows` 里的计数/错误）。 */
  readonly status: Readonly<Record<string, { readonly label: string; readonly count?: number; readonly error?: string | null }>>;
  readonly onClose: () => void;
  readonly onRetry?: (sourceId: string) => void;
}

/** L26-59 `DiscoverSourceStatusSheet`。 */
export function DiscoverSourceStatusSheet(props: DiscoverSourceStatusSheetProps) {
  if (!props.visible) return null;
  return (
    <div className="discover-sheet" role="dialog" aria-modal data-testid="discover_source_status_sheet">
      <div className="discover-sheet__scrim" onClick={props.onClose} />
      <div className="discover-sheet__panel">
        <GlassCard radius={28} padding={16}>
          <h3 className="discover-sheet__title">书源状态</h3>
          <ul className="discover-sheet__list">
            {props.sources.map((source) => {
              const row = props.status[source.id];
              return (
                <li key={source.id} className="discover-sheet__row">
                  <span className="discover-sheet__row-name">{source.name}</span>
                  <span className="discover-sheet__row-state">
                    {row?.error === null || row?.error === undefined
                      ? (row?.label ?? '待加载')
                      : `失败：${row.error}`}
                  </span>
                  {row?.count === undefined ? null : (
                    <span className="discover-sheet__row-count">{String(row.count)} 条</span>
                  )}
                  {row?.error === null || row?.error === undefined ? null : (
                    <WenkuTextButton
                      text="重试"
                      onClick={() => props.onRetry?.(source.id)}
                      compact
                      symbol="Refresh"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="discover-sheet__actions">
            <WenkuTextButton text="关闭" onClick={props.onClose} compact symbol="Close" />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

export interface DiscoverSourcePickerProps {
  readonly sources: readonly DiscoverSourceLike[];
  readonly enabled: Readonly<Record<string, boolean>>;
  readonly selected: string;
  readonly onSelect: (sourceId: string) => void;
  readonly className?: string;
}

/** L61-77 `DiscoverSourcePicker`。 */
export function DiscoverSourcePicker(props: DiscoverSourcePickerProps) {
  return (
    <div className={['discover-source-picker', props.className].filter(Boolean).join(' ')} role="radiogroup">
      {props.sources.map((source) => (
        <SourceOption
          key={source.id}
          id={source.id}
          title={source.name}
          enabled={props.enabled[source.id] !== false}
          selected={props.selected}
          onSelect={props.onSelect}
        />
      ))}
    </div>
  );
}

/** L79-90 `SourceOption`。 */
export function SourceOption(props: {
  readonly id: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const active = props.selected === props.id;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={!props.enabled}
      className={['discover-source-option', active ? 'is-selected' : ''].filter(Boolean).join(' ')}
      onClick={() => {
        if (props.enabled) props.onSelect(props.id);
      }}
    >
      {props.title}
    </button>
  );
}

export interface DiscoverCategorySheetProps {
  readonly visible: boolean;
  /** 可选的分类叶子（默认用 `DiscoverTaxonomy`）。 */
  readonly categories?: readonly DiscoverCategory[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

/** L92-171 `DiscoverCategorySheet`。 */
export function DiscoverCategorySheet(props: DiscoverCategorySheetProps) {
  const roots = props.categories ?? DiscoverTaxonomy.roots;
  const [search, setSearch] = useState('');
  const [facet, setFacet] = useState<string>(roots[0]?.id ?? 'genre');
  const activeRoot = useMemo(() => roots.find((r) => r.id === facet) ?? roots[0], [roots, facet]);
  const branches = useMemo(() => {
    if (activeRoot === undefined) return [];
    const needle = search.trim().toLowerCase();
    return activeRoot.children
      .map((b) => ({
        ...b,
        visible: b.children.filter(
          (c) => needle === '' || c.label.toLowerCase().includes(needle) || c.id.includes(needle),
        ),
      }))
      .filter((b) => b.visible.length > 0 || needle === '');
  }, [activeRoot, search]);
  if (!props.visible) return null;
  return (
    <div className="discover-sheet" role="dialog" aria-modal data-testid="discover_category_sheet">
      <div className="discover-sheet__scrim" onClick={props.onClose} />
      <div className="discover-sheet__panel">
        <GlassCard radius={28} padding={16}>
          <CategorySearchHeader
            search={search}
            facet={facet}
            roots={roots}
            onSearch={setSearch}
            onFacet={setFacet}
          />
          <div className="discover-category-sheet__body">
            {branches.map((b) => (
              <section key={b.id} className="discover-category-sheet__branch">
                <h4 className="discover-category-sheet__branch-title">{b.label}</h4>
                <div className="discover-category-sheet__leaves">
                  {b.visible.map((leaf) => (
                    <button
                      key={leaf.id}
                      type="button"
                      className={['discover-category-sheet__leaf', props.selected.has(leaf.id) ? 'is-selected' : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={props.selected.has(leaf.id)}
                      onClick={() => props.onToggle(leaf.id)}
                    >
                      {leaf.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="discover-sheet__actions">
            <WenkuTextButton text="清除" onClick={props.onClear} compact symbol="CloseCircle" />
            <WenkuTextButton text="完成" onClick={props.onClose} compact symbol="Check" />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

/** L173-184 `CategorySearchHeader`。 */
export function CategorySearchHeader(props: {
  readonly search: string;
  readonly facet: string;
  readonly roots: readonly DiscoverCategory[];
  readonly onSearch: (value: string) => void;
  readonly onFacet: (id: string) => void;
}) {
  const style: CSSProperties = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' };
  return (
    <div className="discover-category-sheet__header" style={style}>
      <input
        className="discover-category-sheet__search"
        type="search"
        value={props.search}
        placeholder="搜索分类"
        onChange={(event) => props.onSearch(event.target.value)}
      />
      {props.roots.map((root) => (
        <button
          key={root.id}
          type="button"
          className={['discover-category-sheet__facet', props.facet === root.id ? 'is-active' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => props.onFacet(root.id)}
        >
          {root.label}
        </button>
      ))}
    </div>
  );
}

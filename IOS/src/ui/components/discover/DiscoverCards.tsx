/**
 * 发现页卡片 —— `discover/DiscoverCards.kt` L47-338 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L48-145 `DiscoverCard(work, dimension, layout, rank, …)`   → `DiscoverCard`
 *   L147-232 `Cover(...)`：封面 + 角标 + 遮罩                     → `Cover`
 *   L234-237 `SourceBadge(label, modifier)`                     → `SourceBadge`
 *   L239-246 `FollowButton(followed, compact, onClick)`          → `FollowButton`
 *   L248-257 `TagRow(tags, status)`                             → `TagRow`
 *   L265-286 `CardDataLine(work, dimension)` → `@core/discover/cards` 的 `cardDataLine`
 *   L305-321 `Trend(work, dimension, reverse, idleColor)`        → `Trend`
 *   L323+    `DiscoverSkeleton(layout)`                          → `DiscoverSkeleton`
 *
 * 数字格式（`1.2w` / `3.4k`）与日期（`yyyy-MM-dd`）都由 `@core/discover/cards` 统一给，
 * 不在组件里重算。
 */
import type { CSSProperties, ReactNode } from 'react';

import { cardCompact, cardDataLine, dateLabel, discoverCardRadiusDp, type DiscoverDimension, type DiscoverWorkLike } from '@core/discover/cards';
import { DISCOVER_FALL, DISCOVER_RISE, DISCOVER_STOPPED, DISCOVER_WARNING, discoverHex } from '@core/discover/design';
import '../../../styles/discover.css';

export interface DiscoverCardWork extends DiscoverWorkLike {
  readonly id: string;
  readonly title: string;
  readonly coverUrl?: string | null;
  readonly tags?: readonly string[];
  readonly status?: string | null;
  readonly followed?: boolean;
  readonly sourceLabel?: string | null;
  readonly trend?: number | null;
}

/**
 * Kotlin `DiscoverLayout { LIST, GRID, LARGE }` 的小写投影。
 *
 * 修正：第三档原写作 `'compact'`，但 CSS 类（`discover-results--${layout}`）与
 * Kotlin 枚举都是 **large**；`compact` 只是 `DiscoverCardProps` 内部对
 * 「GRID 用 48dp 热区」这个布尔值的旧命名。
 */
export type DiscoverLayout = 'list' | 'grid' | 'large';

export interface DiscoverCardProps {
  readonly work: DiscoverCardWork;
  readonly dimension: DiscoverDimension;
  readonly layout: DiscoverLayout;
  readonly rank?: number | null;
  readonly onOpen?: (work: DiscoverCardWork) => void;
  readonly onFollow?: (work: DiscoverCardWork) => void;
  readonly onTag?: (tag: string) => void;
  readonly className?: string;
}

/** L48-145 `DiscoverCard`。 */
export function DiscoverCard(props: DiscoverCardProps) {
  // Kotlin：只有 GRID 的 FollowButton 传 `compact = true`（48dp 热区），LIST / LARGE 都是 28dp。
  const compact = props.layout === 'grid';
  return (
    <article
      className={['discover-card', `discover-card--${props.layout}`, props.className].filter(Boolean).join(' ')}
      style={{ borderRadius: `${String(discoverCardRadiusDp(props.layout))}px` }}
      data-testid="discover_card"
      onClick={() => props.onOpen?.(props.work)}
    >
      <Cover work={props.work} rank={props.rank ?? null} layout={props.layout} />
      <div className="discover-card__body">
        <div className="discover-card__title-row">
          <span className="discover-card__title">{props.work.title}</span>
          {props.work.sourceLabel === null || props.work.sourceLabel === undefined ? null : (
            <SourceBadge label={props.work.sourceLabel} />
          )}
        </div>
        <TagRow
          tags={props.work.tags ?? []}
          status={props.work.status ?? null}
          {...(props.onTag === undefined ? null : { onTag: props.onTag })}
        />
        <CardDataLineInline work={props.work} dimension={props.dimension} />
        <Trend work={props.work} dimension={props.dimension} />
      </div>
      <FollowButton
        followed={props.work.followed === true}
        compact={compact}
        onClick={() => props.onFollow?.(props.work)}
      />
    </article>
  );
}

/**
 * L147-232 `Cover`。
 *
 * 宽高比按 Kotlin 逐档：LIST 的封面盒是 `width(120.dp).fillMaxHeight()`（在 160dp 行内 → 3/4）、
 * GRID 显式 `aspectRatio(3f / 4f)`、LARGE 显式 `aspectRatio(4f / 3f)`（**横版**）。
 * 原先写的是 `compact ? '3 / 4' : '2 / 3'`：LARGE 会变成竖版、LIST 也不是 3/4。
 */
export function Cover(props: {
  readonly work: DiscoverCardWork;
  readonly rank: number | null;
  readonly layout: DiscoverLayout;
}) {
  const style: CSSProperties = {
    // Kotlin L101 / L121：LARGE 显式 `aspectRatio(4f / 3f)`；LIST（120×160）与 GRID 都是 3:4。
    aspectRatio: props.layout === 'large' ? '4 / 3' : '3 / 4',
    background: 'var(--color-divider-gray)',
  };
  return (
    <div className="discover-card__cover" style={style}>
      {props.work.coverUrl === null || props.work.coverUrl === undefined ? null : (
        <img className="discover-card__cover-img" src={props.work.coverUrl} alt="" loading="lazy" />
      )}
      {props.rank === null ? null : (
        <span className="discover-card__rank">
          <span className="discover-card__rank-num">{String(props.rank)}</span>
        </span>
      )}
    </div>
  );
}

/** L234-237 `SourceBadge`。 */
export function SourceBadge(props: { readonly label: string }) {
  return <span className="discover-card__source-badge">{props.label}</span>;
}

/** L239-246 `FollowButton`。 */
export function FollowButton(props: {
  readonly followed: boolean;
  readonly compact: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={['discover-card__follow', props.followed ? 'is-followed' : '', props.compact ? 'is-compact' : '']
        .filter(Boolean)
        .join(' ')}
      aria-pressed={props.followed}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      {props.followed ? '已关注' : '关注'}
    </button>
  );
}

/** L248-257 `TagRow(tags, status)`。 */
export function TagRow(props: {
  readonly tags: readonly string[];
  readonly status: string | null;
  readonly onTag?: (tag: string) => void;
}) {
  const all = props.status === null || props.status.trim() === '' ? props.tags : [props.status, ...props.tags];
  if (all.length === 0) return null;
  return (
    <div className="discover-card__tags">
      {all.slice(0, 4).map((tag) => (
        <button
          key={tag}
          type="button"
          className="discover-card__tag"
          onClick={(event) => {
            event.stopPropagation();
            props.onTag?.(tag);
          }}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}

/** L265-286 `CardDataLine`：数据来自 `@core/discover/cards`。 */
function CardDataLineInline(props: { readonly work: DiscoverWorkLike; readonly dimension: DiscoverDimension }) {
  const line = cardDataLine(props.work, props.dimension);
  if (line === null) return null;
  return (
    <div className="discover-card__data">
      {line.date === null ? null : <span className="discover-card__date">{line.date}</span>}
      {line.icon === null ? null : (
        <span className="discover-card__data-icon" aria-hidden>
          {line.icon === 'chat' ? '💬' : line.icon === 'favorite' ? '♥' : '👁'}
        </span>
      )}
      {line.text === null ? null : <span className="discover-card__data-text">{line.text}</span>}
    </div>
  );
}

/** L305-321 `Trend(work, dimension, reverse, idleColor)`。 */
export function Trend(props: { readonly work: DiscoverCardWork; readonly dimension: DiscoverDimension }) {
  const delta = props.work.trend ?? null;
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className="discover-card__trend"
      style={{ color: discoverHex(up ? DISCOVER_RISE : DISCOVER_FALL) }}
      title={up ? '较上次上升' : '较上次下降'}
    >
      {up ? '▲' : '▼'} {String(Math.abs(delta))}
    </span>
  );
}

/** L323+ `DiscoverSkeleton(layout)`。 */
export function DiscoverSkeleton(props: { readonly layout: DiscoverLayout }): ReactNode {
  const rows = props.layout === 'list' ? 5 : 6;
  return (
    <div className={['discover-skeleton', `discover-skeleton--${props.layout}`].join(' ')} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={String(i)} className="discover-skeleton__card" />
      ))}
    </div>
  );
}

/** `cardCompact` 的再导出（调用点按 Kotlin 名使用）。 */
export { cardCompact, dateLabel };

/** 三档徽标色（`DiscoverDesign.kt` L27-30）。 */
export const DISCOVER_TREND_COLORS = {
  rise: DISCOVER_RISE,
  fall: DISCOVER_FALL,
  warning: DISCOVER_WARNING,
  stopped: DISCOVER_STOPPED,
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * `DiscoverScreen.kt` L100-103 `DiscoverPartitionContent` 与 L444-460 `DiscoverChip`
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L100-103 `DiscoverPartitionContent(manager, favorites, favoriteKeys, …, partition, onPartition, downloadEntry)`。 */
export interface DiscoverPartitionContentProps {
  readonly partition: 'COMIC' | 'NOVEL';
  readonly onPartition: (next: 'COMIC' | 'NOVEL') => void;
  readonly favorites: readonly string[];
  readonly favoriteKeys: ReadonlySet<string>;
  readonly readingTitles: ReadonlySet<string>;
  readonly onFollow: (work: DiscoverCardWork, followed: boolean) => void;
  readonly onOpen: (work: DiscoverCardWork) => void;
  readonly onLatest: (work: DiscoverCardWork) => void;
  readonly onSourceManagement: () => void;
  readonly refreshRequest: number;
  readonly downloadEntry?: ReactNode;
  readonly children?: ReactNode;
}

/** L100 `DiscoverPartitionContent`：分区内容（`rememberDiscoverStore(partition)` 的宿主）。 */
export function DiscoverPartitionContent(props: DiscoverPartitionContentProps) {
  return (
    <div className="discover-partition" data-partition={props.partition}>
      {props.downloadEntry}
      {props.children}
    </div>
  );
}

/**
 * L444-460 `DiscoverChip(label, selected, onClick, solid = true, visualHeight = 32,
 * dimmed = false, icon = null, outlined = false, modifier)`：
 * 最小点击区 48×48、可视高度 `visualHeight`、圆形；选中 = 主色（solid）或 tint；
 * `outlined` 追加 1dp 描边；`dimmed` 整体 alpha .5。
 */
export function DiscoverChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly solid?: boolean;
  readonly visualHeight?: number;
  readonly dimmed?: boolean;
  readonly icon?: ReactNode;
  readonly outlined?: boolean;
  readonly className?: string;
}) {
  const visualHeight = props.visualHeight ?? 32;
  const solid = props.solid !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.selected}
      className={['discover-chip', props.outlined === true ? 'is-outlined' : '', props.className]
        .filter(Boolean)
        .join(' ')}
      style={{
        minWidth: '48px',
        minHeight: '48px',
        opacity: props.dimmed === true ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
      }}
      onClick={props.onClick}
    >
      <span
        className={['discover-chip__pill', props.selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          minHeight: `${String(visualHeight)}px`,
          paddingInline: visualHeight === 36 ? '14px' : '12px',
          paddingBlock: '4px',
          borderRadius: '999px',
          background: props.selected
            ? solid
              ? 'var(--color-primary)'
              : 'color-mix(in srgb, var(--color-primary) 14%, transparent)'
            : solid
              ? 'color-mix(in srgb, var(--color-surface) 40%, transparent)'
              : 'transparent',
          border: props.outlined === true
            ? `1px solid ${props.selected ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-on-light) 12%, transparent)'}`
            : 'none',
          color: props.selected && solid ? 'var(--color-surface)' : 'var(--color-on-light)',
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          whiteSpace: 'nowrap',
        }}
      >
        {props.icon}
        {props.label}
      </span>
    </button>
  );
}

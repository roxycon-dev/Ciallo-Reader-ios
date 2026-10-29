import type { ReactNode } from 'react';

/**
 * Port of Android shelf/ShelfChips.kt (CategoryPill + HomeActionChip usage in HomeScreen.kt).
 *
 * CategoryPill (ShelfChips.kt lines 61–184):
 * - height 32.dp, RoundedCornerShape(16.dp)
 * - selected/dropHighlight: accent.copy(alpha=1) bg, white text, no border
 * - unselected: onSurface.copy(alpha=0.06) bg, onSurface.copy(alpha=0.72) text,
 *   border 0.5.dp onSurface.copy(alpha=0.10)
 * - text 12.5.sp, SemiBold when selected else Medium
 * - padding horizontal 13.dp
 * - locked: Lock icon 12.dp after label
 * - count badge: radius 7.dp, selected white 0.24 bg / unselected onSurface 0.08,
 *   text 10.sp SemiBold, alpha 1.0 selected / 0.62 unselected
 *
 * HomeActionChip (HomeScreen.kt ~1277): icon + label glass pill; emphasized uses primary.
 */

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

export function CategoryPill(props: {
  label: string;
  selected?: boolean;
  locked?: boolean;
  count?: number;
  onClick?: () => void;
  onLongClick?: () => void;
}) {
  const selected = props.selected === true;
  const locked = props.locked === true;
  const interactive = !locked && props.onClick !== undefined;
  const hasCount = typeof props.count === 'number' && props.count >= 0;

  return (
    <button
      type="button"
      className={[
        'category-pill',
        selected ? 'category-pill--selected' : '',
        locked ? 'category-pill--locked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={locked}
      onClick={interactive ? props.onClick : undefined}
      onContextMenu={(event) => {
        if (props.onLongClick) {
          event.preventDefault();
          props.onLongClick();
        }
      }}
    >
      <span className="category-pill__label">{props.label}</span>
      {locked ? (
        <span className="category-pill__lock">
          <LockIcon />
        </span>
      ) : null}
      {hasCount ? (
        <span className="category-pill__count">{props.count}</span>
      ) : null}
    </button>
  );
}

/** Back-compat alias used by other pages. */
export const CategoryChip = CategoryPill;

export function ActionChip(props: {
  label: string;
  icon?: ReactNode;
  emphasized?: boolean;
  onClick?: () => void;
}) {
  const emphasized = props.emphasized === true;

  return (
    <button
      type="button"
      className={
        emphasized ? 'home-action-chip home-action-chip--emphasized' : 'home-action-chip'
      }
      onClick={props.onClick}
    >
      {props.icon !== undefined ? (
        <span className="home-action-chip__icon" aria-hidden="true">
          {props.icon}
        </span>
      ) : null}
      {props.label}
    </button>
  );
}

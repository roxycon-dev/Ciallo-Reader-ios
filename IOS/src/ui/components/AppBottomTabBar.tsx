import { type ReactNode } from 'react';
import { MOTION } from '../theme/tokens';

export type TabKey = 'library' | 'bookshelf' | 'stats' | 'settings';

type TabDef = {
  key: TabKey;
  label: string;
  icon: ReactNode;
};

/**
 * Icons match Android Material icons used in MainActivity tab list
 * (Search / MenuBook / BarChart / Settings) drawn as SVG.
 */
function LibraryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Icons.Filled.Search */}
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

function BookshelfIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Icons.Filled.MenuBook */}
      <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Icons.Filled.BarChart */}
      <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Icons.Filled.Settings */}
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

const TAB_DEFS: readonly TabDef[] = [
  { key: 'library', label: '书库', icon: <LibraryIcon /> },
  { key: 'bookshelf', label: '书架', icon: <BookshelfIcon /> },
  { key: 'stats', label: '统计', icon: <StatsIcon /> },
  { key: 'settings', label: '设置', icon: <SettingsIcon /> },
];

/**
 * Port of Android AppBottomTabBar.kt floating-pill design.
 *
 * Android constants:
 * - TabBarShape = RoundedCornerShape(50) → CSS pill (border-radius 999px)
 * - height 68.dp expanded / 52.dp collapsed
 * - horizontalMargin 16.dp / 48.dp; vertical padding 12.dp
 * - glass: surface alpha 0.78 (MID) + primary tint gradient (0/22%/62%/100%)
 * - TAB_UNSELECTED_ALPHA = 0.48
 * - indicator: top 2.dp, height 3.dp, width = itemWidth * 0.40, centered
 * - icon 22.dp, label 10.sp, item padding h14 v6
 * - badge 18.dp #E5484D, ring 1.5.dp barBase, text 9.sp bold, "99+" if >99
 */
export function AppBottomTabBar(props: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  collapsed: boolean;
  badges?: Partial<Record<TabKey, number>>;
}) {
  const { active, onChange, collapsed, badges } = props;
  const count = TAB_DEFS.length;
  const activeIndex = Math.max(
    0,
    TAB_DEFS.findIndex((t) => t.key === active),
  );
  const itemWidthPct = 100 / count;
  const indicatorWidthPct = itemWidthPct * 0.4;
  const indicatorLeftPct =
    activeIndex * itemWidthPct + (itemWidthPct - indicatorWidthPct) / 2;

  return (
    <div
      className="app-tabbar-shell"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        margin: collapsed ? 48 : 16,
        transition: `margin ${MOTION.headerCollapse}ms ${MOTION.easeOut}`,
      }}
    >
      <div
        className="glass-tabbar"
        style={{
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: 720,
          height: collapsed ? 52 : 68,
          transition: `height ${MOTION.headerCollapse}ms ${MOTION.easeOut}`,
        }}
      >
        <div
          className="app-tabbar-indicator"
          style={{
            left: `${indicatorLeftPct}%`,
            width: `${indicatorWidthPct}%`,
          }}
        />
        {TAB_DEFS.map((tab) => {
          const selected = tab.key === active;
          const badge = badges?.[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              className={
                selected
                  ? 'app-tabbar-item app-tabbar-item--selected'
                  : 'app-tabbar-item app-tabbar-item--unselected'
              }
              aria-current={selected ? 'page' : undefined}
              onClick={() => onChange(tab.key)}
            >
              <span className="app-tabbar-icon">{tab.icon}</span>
              <span
                className={
                  collapsed
                    ? 'app-tabbar-label app-tabbar-label--hidden'
                    : 'app-tabbar-label'
                }
              >
                {tab.label}
              </span>
              {badge !== undefined ? (
                <span
                  className={
                    badge > 0
                      ? 'app-tabbar-badge'
                      : 'app-tabbar-badge app-tabbar-badge--empty'
                  }
                >
                  {badge > 99 ? '99+' : badge > 0 ? String(badge) : ''}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

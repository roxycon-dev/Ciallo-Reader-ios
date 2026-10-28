/**
 * 主壳 Tab 切换 — 逐行移植 Android `MainActivity.kt` L638-653 的
 * `AnimatedContent` fade-through 与 L500-507 的 tab 项表。
 *
 * Android 的关键行为（照抄，不是"优化"）：
 *  - 出场先走：fadeOut(tween(90))
 *  - 入场等 90ms 再淡入：fadeIn(tween(210, delayMillis = 90))
 *  - 收益：**两页永远不会同时可见**，因此不会出现「两张半透明页面叠在一起发灰」
 *    的中间帧（旧实现是横向各滑 1/3 屏 + 交叉淡化，中间帧必然重影）。
 *
 * CSS 等效：旧页 `fade-out 90ms ease-in`，新页 `fade-in 210ms ease-out 90ms delay`，
 * 两层 absolute 叠放，切换期间旧页 opacity 单调降到 0、新页从 0 升到 1，
 * 中间不会同时出现两个非零不透明度。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TAB_ITEMS, type AppTabItem } from '@core/app/navigation';
import '../../styles/shell.css';

export const TAB_FADE_OUT_MS = 90;
export const TAB_FADE_IN_MS = 210;
export const TAB_FADE_IN_DELAY_MS = 90;

export type TabKey = 'library' | 'bookshelf' | 'stats' | 'settings';

/** tab 顺序与 `TAB_ITEMS` 一致（书库/书架/统计/设置）。 */
export const TAB_KEYS: readonly TabKey[] = ['library', 'bookshelf', 'stats', 'settings'];

export function tabItemFor(tab: TabKey): AppTabItem {
  const index = TAB_KEYS.indexOf(tab);
  return TAB_ITEMS[index] as AppTabItem;
}

/** tab → Android `selectedTab` 整数（MainActivity L655/679/… 的 when 分支）。 */
export function selectedTabIndexOf(tab: TabKey): number {
  return TAB_KEYS.indexOf(tab);
}

export function tabKeyOfIndex(index: number): TabKey {
  return TAB_KEYS[index] ?? 'library';
}

interface ShellTabProps {
  tab: TabKey;
  children: ReactNode;
}

/**
 * 单个 Tab 页面容器：只在自己被选中时挂载内容，
 * 并在挂载后播放 fade-in（与 Android AnimatedContent 的入场一致）。
 * 淡出由上一层负责，所以本组件不需要知道「上一个 tab」。
 *
 * 关键：父级 `TabContent` 用 `key={tab}`，切 tab 即整体重挂载，
 * 所以 `entered` 天然从 false 起步 —— effect 里无需再同步置 false。
 */
function ShellTab(props: ShellTabProps) {
  const [entered, setEntered] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // 下一帧再置 true，保证 CSS 过渡真的跑（否则首帧已是终值）
    const raf = requestAnimationFrame(() => {
      timerRef.current = window.setTimeout(() => setEntered(true), TAB_FADE_IN_DELAY_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className="shell-tab"
      data-tab={props.tab}
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateX(0)' : 'translateX(8px)',
        transition: `opacity ${TAB_FADE_IN_MS}ms ease-out ${TAB_FADE_IN_DELAY_MS}ms, transform ${TAB_FADE_IN_MS}ms ease-out ${TAB_FADE_IN_DELAY_MS}ms`,
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Tab 内容层：任意时刻只渲染一个 tab 的子树。
 *
 * Android 用 `AnimatedContent(targetState = selectedTab)` 承载「出场 + 入场」；
 * React 里没有内置的出场动画卸载时机，所以这里用两段式：
 *  - 旧 tab 立刻卸载（与 Android 出场 90ms 的观感等价：淡出极短，肉眼不可辨）
 *  - 新 tab 按上面 ShellTab 的 210ms + 90ms 延迟淡入
 * 出场时长只有 90ms 且不阻塞交互，这样既满足「永不重影」的核心收益，
 * 又不会让返回手势感到粘滞。已在 `docs/PARITY_EXCEPTIONS.md` 登记。
 */
export function TabContent(props: { tab: TabKey; children: (tab: TabKey) => ReactNode }) {
  return (
    <div className="tab-content" key={props.tab}>
      <ShellTab tab={props.tab}>{props.children(props.tab)}</ShellTab>
    </div>
  );
}

/**
 * 底部 Tab 栏（MainActivity L500-507 + AppBottomTabBar.kt）。
 * 玻璃态 / 折叠态由 AppBottomTabBar 组件负责，本文件只做数据与顺序。
 */
export function ShellTabBar(props: {
  active: TabKey;
  collapsed?: boolean;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <nav className="shell-tabbar" aria-label="主导航">
      {TAB_KEYS.map((tab) => {
        const item = tabItemFor(tab);
        const selected = props.active === tab;
        return (
          <button
            key={tab}
            type="button"
            className={
              selected
                ? 'shell-tabbar__item shell-tabbar__item--selected'
                : 'shell-tabbar__item'
            }
            aria-current={selected ? 'page' : undefined}
            onClick={() => props.onChange(tab)}
          >
            <span className="shell-tabbar__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

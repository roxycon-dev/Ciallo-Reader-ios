/**
 * Port of the *presentational* halves of Android `ui/source/SourceManagementScreen.kt`
 * (1600 lines total / 1519 non-blank / 1311 code).
 *
 * `SourceManagementPage.tsx` owns the state and the wiring; this file owns the pieces:
 *
 *   Kotlin line                                     → here
 *   144–260  设计令牌 block (圆角/间距/字号/文字层级)  → CSS in `sources.css` +
 *                                                   the exported token constants below
 *   226–260  primaryText / secondaryText / accentText / accentContainer / dividerColor
 *                                                   → the exported token constants
 *   265–749  SourceManagementScreen body              → SourceManagementPage.tsx
 *   751–803  SourceCollapsingTopBar                    → `SourceCollapsingTopBar`
 *   805–1094 ④ A 快捷入口卡 (SourceQuickTilesRow, SourceTileStatusText,
 *              SourceTileDivider, SourceQuickTile, SourceVeneraTile,
 *              VeneraSpinningIcon, BreathingDot)      → `SourceQuickTilesRow` (+ helpers)
 *   1096–1338 ⑤ B/C 分组卡 (SourceGroupKind, SourceGroup, SourceLine,
 *              SourceGroupCard, SourceGroupHeader, SourceCountBadge,
 *              SourceExpandRestRow)                   → `SourceGroupCard` (+ helpers)
 *   1340–1512 ⑥ 单个书源行 (SourceRow, ActiveDot, SourceMiniLabel,
 *              SourceMiniActionChip)                  → `SourceRow` (+ helpers)
 *   1514–1557 ⑦ D 导入行 (SourceImportEntryRow)       → `SourceImportEntryRow`
 *   1559–1600 通用小工具 (dashedOutline, desaturate) → CSS classes
 *
 * Skipped (recorded in the page's header, repeated here):
 *   - `GlassKitCard` / `GlassTopBarStrip` / `HazeState` realtime backdrop sampling:
 *     Android GPU-only. CSS `backdrop-filter` + gradient borders stand in.
 *   - `Modifier.desaturate()` (BlendMode.Saturation offscreen layer) → CSS `grayscale()`.
 *   - `animateFloatAsState` on the Venera spinner → a CSS keyframe.
 */

import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { isComicSource, isNovelSource, type SourceCapabilities } from '@core/source/sourceCapabilities';
import type { BookSource } from '@core/source/bookSource';
import '../../../styles/sources.css';
import '../../../styles/favorite.css';

/* ═══════════════════════════════════════════════════════════════════════
 * ① 设计令牌（2026-09-24 重排版） — Kotlin L144–260, values verbatim.
 * ═══════════════════════════════════════════════════════════════════════ */

/** 圆角：页面上**只允许三种** —— 玻璃卡 24 / 小元素（头像·图标底）12·10 / 胶囊全圆。 */
export const SOURCE_AVATAR_RADIUS = 12; // 书源行头像
export const SOURCE_ICON_RADIUS = 10; // 快捷入口的淡染图标底
export const SOURCE_IMPORT_RADIUS = 20; // D 导入行（虚线）
export const PILL_RADIUS = 50; // PillShape

/** 规范硬性尺寸 — Kotlin L166–181. */
export const SOURCE_PAGE_MARGIN = 16;
export const SOURCE_CARD_GAP = 12;
export const SOURCE_HEADER_HEIGHT = 48;
export const SOURCE_ROW_HEIGHT = 60;
export const SOURCE_AVATAR_SIZE = 36;
/** 行分割线的左缩进：卡片内边距 16 + 头像 36 + 头像与文字间距 12 = 64（对齐文字起点）。 */
export const SOURCE_ROW_DIVIDER_INDENT = 64;
export const SOURCE_QUICK_CARD_MIN_HEIGHT = 84;
export const SOURCE_QUICK_ICON_BOX = 40;
export const SOURCE_QUICK_ICON_SIZE = 28;
export const SOURCE_CHIP_HEIGHT = 26;
export const SOURCE_EXPAND_ROW_HEIGHT = 44;
export const SOURCE_IMPORT_ROW_HEIGHT = 48;
export const SOURCE_DIVIDER_WIDTH = 0.5;
/** Material3 LargeTopAppBar 展开态高度（用于顶部渐变遮罩的高度计算）。 */
export const SOURCE_LARGE_TITLE_HEIGHT = 152;

export const TITLE_EXPANDED_SP = 28;
export const TITLE_COLLAPSED_SP = 20;

/** 漫画组折叠态默认露出前 N 个，其余走「展开其余 N 个」。 — Kotlin L188 */
export const COMIC_GROUP_PREVIEW_COUNT = 6;

/** 表格数字对齐：`tnum` 让 0-9 等宽，X 由 9 变 10 时后面的文字不会横向抖一下。 — L191 */
export const NUMERIC_FEATURE = 'tnum';

/** 「分组标题」14sp 对应的 0.02em 字距（标题越大字距越小，避免松散）。 — L194 */
export const GROUP_LETTER_SPACING = 0.28; // 14 * 0.02 = 0.28px

/* ── 文字层级（本页唯一入口，禁止各写各的 alpha）— Kotlin L226–259 ── */

export const SOURCE_PRIMARY_TEXT = '#18191C';
/** 次要文字（ID / 状态）：onSurface 70% —— 规范下限，任何地方都不得低于此值。 */
export const SOURCE_SECONDARY_TEXT = 'rgba(24, 25, 28, 0.7)';
/** 标签 / 徽标 / 小胶囊的底色：`primary` 12%（规范值）。 */
export const SOURCE_ACCENT_CONTAINER = 'rgba(5, 150, 105, 0.12)';
/** 卡内分割线：onSurface 10%。 */
export const SOURCE_DIVIDER = 'rgba(24, 25, 28, 0.1)';
export const SOURCE_PRIMARY = '#059669';

/**
 * 标签文字：`primary` **同色系加深 20%**（HSL 明度 ×0.8）。
 *
 * 不用 `lerp(primary, Black, .2f)` —— 那会顺带把色相往灰里拖，浅色主题下标签会发脏；
 * 只压明度能保持"同一个色的深色版"，与 12% 的淡染底配对后正文对比度 ≥4.5:1。
 */
export function accentText(primary: string = SOURCE_PRIMARY): string {
  const hex = primary.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return primary;
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  // Kotlin L248: `hsl[2] = (hsl[2] * 0.8f).coerceIn(0f, 1f)`
  const l2 = Math.max(0, Math.min(1, l * 0.8));
  return hslToHex(h, s, l2);
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${[v, v, v].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const parts = [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((n) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${parts.join('')}`;
}

/* ═══════════════════════════════════════════════════════════════════════
 * ③ 大标题：随滚动缩放，折叠后顶栏带毛玻璃 — Kotlin L755–803
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 「书源管理」折叠大标题（Compose 侧的 SliverAppBar + FlexibleSpaceBar 等价实现）。
 *
 * 大→小的折叠行为与高度插值直接复用 Material3 的 [LargeTopAppBar] +
 * `exitUntilCollapsedScrollBehavior`（不自己算），只额外做两件事：
 * - 标题字号 28sp → 20sp 跟着 `collapsedFraction` 连续过渡；
 * - 一旦开始折叠（`collapsedFraction > 0`）就把顶栏挂上毛玻璃。
 *
 * 「展开时有大标题没有玻璃」与「折叠后有玻璃没有大标题」是互斥的，
 * 所以这块玻璃不会与页面级遮罩长期叠加。
 *
 * ⚠️ ADAPTATION: `collapsedFraction` comes from a scroll listener; `animateFloatAsState`
 * becomes a CSS `transition` on `font-size`.
 */
export function SourceCollapsingTopBar(props: {
  collapsedFraction: number;
  onBack: () => void;
}) {
  const fraction = props.collapsedFraction;
  // Kotlin L787–788: `TITLE_EXPANDED_SP - (TITLE_EXPANDED_SP - TITLE_COLLAPSED_SP) * fraction`
  const titleSize = TITLE_EXPANDED_SP - (TITLE_EXPANDED_SP - TITLE_COLLAPSED_SP) * fraction;
  return (
    <header
      className="source-mgmt-header source-mgmt-header--glass"
      style={{ backdropFilter: fraction > 0 ? 'blur(8px)' : 'none' }}
    >
      <button
        type="button"
        className="source-mgmt-back-btn"
        onClick={props.onBack}
        aria-label="返回"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
            fill="currentColor"
          />
        </svg>
      </button>
      <h1
        className="source-mgmt-title"
        style={{
          fontSize: titleSize,
          // 主文字 onSurface 100%：大标题是整页唯一压在"背景"上的文字，
          // 由顶部渐变遮罩保护，这里不再降透明度。
          color: SOURCE_PRIMARY_TEXT,
          transition: 'font-size 220ms ease-out',
        }}
      >
        书源管理
      </h1>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * ④ A 快捷入口卡 — Kotlin L805–1094
 * ═══════════════════════════════════════════════════════════════════════ */

/** Venera 砖的状态机：0 待机 / 1 更新中 / 2 刚完成。 */
export const VENERA_IDLE = 0;
export const VENERA_BUSY = 1;
export const VENERA_DONE = 2;

/** 快捷入口的状态行：11sp、onSurface 70%、单行截断。 — L899–909 */
function SourceTileStatusText(props: { text: string }) {
  return <span className="source-quick-tile__status">{props.text}</span>;
}

/** 三等分格之间的细竖线（玻璃卡内部的层次只靠它，不再靠第二层玻璃）。 — L911–921 */
function SourceTileDivider() {
  return <span className="source-quick-tile__divider" aria-hidden="true" />;
}

function IconCheckCircleSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z" />
    </svg>
  );
}

function IconLockSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z" />
    </svg>
  );
}

function IconCodeSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6zM14.6 16.6l4.6-4.6-4.6-4.6L16 6l6 6-6 6z" />
    </svg>
  );
}

function IconLinkSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7a5 5 0 000 10h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4a5 5 0 000-10z" />
    </svg>
  );
}

function IconRefreshSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.65 6.35A7.96 7.96 0 0012 4a8 8 0 108 8h-2a6 6 0 11-6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
    </svg>
  );
}

/**
 * 登录状态呼吸圆点（6px 强调色）—— 本页**唯一**允许的常驻循环动画，且有明确语义
 * （「这个账号现在是通的」），不是装饰。
 *
 * 尊重系统「减少动态效果」：关掉动画时退化为常亮实心点，信息不丢。
 * — L1065–1094
 */
function BreathingDot() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return (
    <span
      className={reduced ? 'source-breath-dot source-breath-dot--static' : 'source-breath-dot'}
      aria-hidden="true"
    />
  );
}

/** Venera 砖的转圈图标（L1041–1063）— `infiniteRepeatable(tween(1000, LinearEasing))`. */
function VeneraSpinningIcon() {
  return <IconRefreshSvg />;
}

/**
 * 一块「快捷入口格」：淡染圆角方形图标底（28px 图标 / 底圆角 10）+ 名称 13 + 状态 11。
 *
 * 外层那张卡是唯一的 1 层玻璃（`GlassKitCard`，含 blur + lens + 高光），
 * 格子本身**不再自带玻璃**，只用 primary 12% 平涂做图标底 —— 禁止玻璃套玻璃。
 * — L923–971
 */
function SourceQuickTile(props: {
  icon: ReactNode;
  name: string;
  status: ReactNode;
  onClick: () => void;
  enabled?: boolean;
}) {
  const enabled = props.enabled !== false;
  return (
    <button
      type="button"
      className="source-quick-tile"
      style={{ opacity: enabled ? 1 : 0.55 }}
      disabled={!enabled}
      onClick={props.onClick}
    >
      <span className="source-quick-tile__iconbox">{props.icon}</span>
      <span className="source-quick-tile__name">{props.name}</span>
      {props.status}
    </button>
  );
}

/**
 * Venera 砖：点击触发更新，更新中图标旋转，完成后短暂显示 ✓。
 *
 * 转圈是本页唯一允许的「进行中」循环动画（它是有明确语义的进度反馈，不是装饰）。
 * — L973–1039
 */
function SourceVeneraTile(props: { onRefresh: () => void }) {
  const [phase, setPhase] = useState(VENERA_IDLE);
  useEffect(() => {
    if (phase !== VENERA_BUSY) return;
    // 至少转 900ms，避免「闪一下就停」让人怀疑到底有没有点中；
    // 之后收 ✓ 停 1200ms 再回到常态。
    const a = window.setTimeout(() => setPhase(VENERA_DONE), 900);
    const b = window.setTimeout(() => setPhase(VENERA_IDLE), 900 + 1200);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [phase]);

  return (
    <SourceQuickTile
      icon={
        phase === VENERA_BUSY ? (
          <span className="source-venera-spin">
            <VeneraSpinningIcon />
          </span>
        ) : phase === VENERA_DONE ? (
          <IconCheckCircleSvg />
        ) : (
          <IconLinkSvg />
        )
      }
      name="Venera 源"
      status={
        <SourceTileStatusText
          text={
            phase === VENERA_BUSY ? '更新中…' : phase === VENERA_DONE ? '已更新' : '点击更新'
          }
        />
      }
      onClick={() => {
        // 更新中重复点击无效，避免连开两个「完成」计时器互相打架
        if (phase !== VENERA_BUSY) {
          setPhase(VENERA_BUSY);
          props.onRefresh();
        }
      }}
    />
  );
}

/**
 * 一张玻璃卡内的三等分：Z-Library 账号 / Venera 源仓库 / 调试日志。
 *
 * ⚠️ 规范：三个入口**合并为一张玻璃卡内的三等分区域**，格间用 0.5px 细竖线分隔，
 * 卡高由内容撑开（minHeight 84）。格子本身完全透明 —— 全页只有这 1 层玻璃，
 * 禁止玻璃套玻璃。
 * — L814–897
 */
export function SourceQuickTilesRow(props: {
  hasZLibrary: boolean;
  loggedIn: boolean;
  onLoginClick: () => void;
  onRefreshVenera: () => void;
  onOpenDebugLog: () => void;
}) {
  return (
    <div className="source-quick-tiles">
      <SourceQuickTile
        icon={props.loggedIn ? <IconCheckCircleSvg /> : <IconLockSvg />}
        name="Z-Library"
        status={
          <span className="source-quick-tile__statusrow">
            {props.loggedIn ? <BreathingDot /> : null}
            <SourceTileStatusText
              text={props.loggedIn ? '已登录' : props.hasZLibrary ? '未登录' : '未内置'}
            />
          </span>
        }
        // Z-Library 未内置时这颗砖只作状态展示，不该把人带进一个必然失败的登录弹窗
        onClick={props.onLoginClick}
        enabled={props.hasZLibrary}
      />

      <SourceTileDivider />
      <SourceVeneraTile onRefresh={props.onRefreshVenera} />

      <SourceTileDivider />
      <SourceQuickTile
        icon={<IconCodeSvg />}
        name="调试日志"
        status={<SourceTileStatusText text="查看日志" />}
        onClick={props.onOpenDebugLog}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * ⑤ B / C 分组卡（结构完全一致）— Kotlin L1096–1338
 * ═══════════════════════════════════════════════════════════════════════ */

export const SourceGroupKind = {
  NOVEL: 'NOVEL',
  COMIC: 'COMIC',
  CUSTOM: 'CUSTOM',
  OTHER: 'OTHER',
} as const;

export type SourceGroupKindCode = (typeof SourceGroupKind)[keyof typeof SourceGroupKind];

export interface SourceGroup {
  title: string;
  kind: SourceGroupKindCode;
  sources: BookSource[];
}

/** 卡内分割线：0.5px、onSurface 10%。是否缩进由调用方给 padding 决定。 — L1108–1117 */
function SourceLine(props: { indentStart?: number }) {
  return (
    <span
      className="source-card-line"
      style={props.indentStart === undefined ? undefined : { marginLeft: props.indentStart }}
      aria-hidden="true"
    />
  );
}

/** 卡头的数量徽标（primary 12% 底 + 加深 20% 的主色文字，数字等宽 + tnum）。 — L1273–1292 */
function SourceCountBadge(props: { text: string }) {
  return (
    <span className="source-count-badge" style={{ color: accentText() }}>
      {props.text}
    </span>
  );
}

function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </svg>
  );
}

/**
 * 卡片头部（高 48，水平内边距 16）：标题 14 semi-bold + 数量徽标 + 右侧 chevron。
 *
 * 点击整行折叠 / 展开（chevron 旋转 180°）。徽标即原先那行摘要：「已启用 / 总数」。
 * — L1222–1271
 */
function SourceGroupHeader(props: {
  title: string;
  badge: string;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <button
      type="button"
      className="source-card-header"
      onClick={props.onToggleExpand}
      aria-expanded={props.expanded}
    >
      <span className="source-card-header__title">{props.title}</span>
      <SourceCountBadge text={props.badge} />
      <span className="source-card-header__spacer" />
      <span
        className="source-card-header__chevron"
        style={{ color: SOURCE_SECONDARY_TEXT, transform: props.expanded ? 'none' : 'rotate(-180deg)' }}
      >
        <IconChevronDown />
      </span>
    </button>
  );
}

/**
 * 「展开其余 N 个」（行高 44，居中，12sp primary，chevron 随展开态旋转）。
 *
 * 上方有一条分割线；点击后文字变「收起」，高度与宽度变化交给外层 `animateContentSize`。
 * — L1294–1338
 */
function SourceExpandRestRow(props: {
  rest: number;
  showAll: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="source-card-expand"
      onClick={props.onClick}
      style={{ color: accentText() }}
    >
      {props.showAll ? '收起' : `展开其余 ${String(props.rest)} 个`}
      <span
        className="source-card-expand__chevron"
        style={{ transform: props.showAll ? 'rotate(180deg)' : 'none' }}
      >
        <IconChevronDown />
      </span>
    </button>
  );
}

/* ── ⑥ 单个书源行 — Kotlin L1340–1512 ── */

/** 「当前使用」的实心小圆点（纯 primary，用于选中态）。 — L1459–1468 */
function ActiveDot() {
  return <span className="source-row__active-dot" aria-hidden="true" />;
}

/** 名称后面的小标签（「需登录」）：primary 12% 底 + 加深 20% 的主色文字，11sp。 — L1470–1487 */
function SourceMiniLabel(props: { text: string }) {
  return <span className="source-row__label" style={{ color: accentText() }}>{props.text}</span>;
}

/** 开关左侧的淡色小胶囊（登录 / 节点）：高 26、水平内边距 12、字号 12。 — L1489–1512 */
function SourceMiniActionChip(props: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="source-row__chip"
      style={{ color: accentText() }}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  );
}

/** Java String.hashCode → uint (SourceAvatar.kt color source). */
function javaHashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** Kotlin `SourceAvatar` — `Color.hsv(hue, 0.52f, 0.86f)`, CircleShape by default. */
export function SourceAvatar(props: {
  sourceId: string;
  sourceName: string;
  size?: number;
  /** Kotlin `RoundedCornerShape(12.dp)` for this page's rows. */
  rounded?: boolean;
  /** Kotlin `Modifier.desaturate()` on a disabled row. */
  desaturated?: boolean;
}) {
  const hue = javaHashCode(props.sourceId) % 360;
  const s = 0.52;
  const v = 0.86;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const size = props.size ?? SOURCE_AVATAR_SIZE;
  const letter = props.sourceName.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="source-row__avatar"
      style={
        {
          width: size,
          height: size,
          borderRadius: props.rounded === true ? SOURCE_AVATAR_RADIUS : '50%',
          background: `rgb(${String(Math.round((r + m) * 255))}, ${String(Math.round((g + m) * 255))}, ${String(Math.round((b + m) * 255))})`,
          filter: props.desaturated === true ? 'grayscale(1)' : undefined,
          fontSize: size / 2.2,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/**
 * 一行书源：36×36 圆角方形头像（圆角 12）+ 12 间距 + 文字块 + [可选] 小胶囊 + 8 + 开关。
 *
 * - 行高固定 60（垂直 padding 10，行高不再随内容浮动）；
 * - 头像沿用 [SourceAvatar]，**保留每个书源自己的既定配色**（由 sourceId 哈希出的
 *   稳定 HSV 色，换形状不改色），本页显式传 `RoundedCornerShape(12)` 走圆角方形，
 *   禁用时再叠一层 [desaturate]；
 * - 禁用态：整行 0.55 透明 + 头像去饱和。
 * — L1344–1457
 */
function SourceRow(props: {
  source: BookSource;
  isActive: boolean;
  isEnabled: boolean;
  isCustom: boolean;
  onToggleEnable: (enabled: boolean) => void;
  onOpenLogin: (() => void) | null;
  onOpenNodeManager: (() => void) | null;
  onDelete: () => void;
  onOpenInfo: () => void;
}) {
  const source = props.source;
  const enabled = props.isEnabled;
  return (
    <div className="source-row" style={{ opacity: enabled ? 1 : 0.55 }}>
      <SourceAvatar
        sourceId={source.id}
        sourceName={source.name}
        rounded
        desaturated={!enabled}
      />
      <div className="source-row__body">
        <div className="source-row__title-row">
          <span className="source-row__name">{source.name}</span>
          {props.isActive && enabled ? <ActiveDot /> : null}
          {sourceRequiresLoginLabel(source.capabilities) ? (
            <SourceMiniLabel text="需登录" />
          ) : null}
        </div>
        <p className="source-row__id">{source.id}</p>
        {isComicSource(source) ? (
          <button type="button" className="source-row__info" onClick={props.onOpenInfo}>
            漫画源 · 查看资料
          </button>
        ) : null}
      </div>
      <div className="source-row__actions">
        {props.onOpenLogin !== null ? (
          <SourceMiniActionChip text="登录" onClick={props.onOpenLogin} />
        ) : null}
        {props.onOpenNodeManager !== null ? (
          <SourceMiniActionChip text="节点" onClick={props.onOpenNodeManager} />
        ) : null}
        <button
          type="button"
          className={enabled ? 'source-row__switch source-row__switch--on' : 'source-row__switch'}
          role="switch"
          aria-checked={enabled}
          aria-label={`${source.name} 启用开关`}
          onClick={() => props.onToggleEnable(!enabled)}
        >
          <span className="source-row__switch-thumb" />
        </button>
        {props.isCustom ? (
          <button
            type="button"
            className="source-row__delete"
            aria-label="删除书源"
            onClick={props.onDelete}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Kotlin L1204: `source.capabilities.requiresLogin` (== `downloadRequiresLogin`). */
function sourceRequiresLoginLabel(caps: SourceCapabilities): boolean {
  return caps.downloadRequiresLogin;
}

/**
 * 一组书源的主体玻璃卡：**头部 + 行列表**。
 *
 * 原「内置书源 / 已启用 X / Y」那行裸在壁纸上的摘要已删除，数量信息并入卡头徽标
 * （「已启用 / 总数」）—— 页面上不再有任何裸文字。
 *
 * **只有这一层做模糊**：卡内的每一行都是普通 Row，不做各自的背景采样，
 * 满足「列表内的行不要各自做模糊，只在分组卡上做一次」。
 * — L1119–1220
 */
export function SourceGroupCard(props: {
  group: SourceGroup;
  expanded: boolean;
  showAll: boolean;
  onToggleExpand: () => void;
  onToggleShowAll: () => void;
  activeSourceId: string | null;
  enabledStates: ReadonlyMap<string, boolean>;
  onToggleEnable: (source: BookSource, enabled: boolean) => void;
  onOpenLogin: (source: BookSource) => void;
  onOpenNodeManager: () => void;
  onDelete: (source: BookSource) => void;
  onOpenInfo: (source: BookSource) => void;
}) {
  const group = props.group;
  const previewLimit =
    group.kind === SourceGroupKind.COMIC ? COMIC_GROUP_PREVIEW_COUNT : Number.MAX_SAFE_INTEGER;
  const hidden = Math.max(0, group.sources.length - previewLimit);
  let enabledCount = 0;
  for (const s of group.sources) {
    if (props.enabledStates.get(s.id) ?? true) enabledCount += 1;
  }
  const visibleSources =
    props.showAll || hidden === 0 ? group.sources : group.sources.slice(0, previewLimit);

  return (
    <section className="source-card">
      <SourceGroupHeader
        title={group.title}
        badge={`${String(enabledCount)} / ${String(group.sources.length)}`}
        expanded={props.expanded}
        onToggleExpand={props.onToggleExpand}
      />
      <SourceLine />
      {props.expanded ? (
        <div className="source-card__body">
          {visibleSources.map((source, index) => (
            <div key={source.id}>
              <SourceRow
                source={source}
                isActive={props.activeSourceId === source.id}
                isEnabled={props.enabledStates.get(source.id) ?? true}
                isCustom={group.kind === SourceGroupKind.CUSTOM}
                onToggleEnable={(next) => props.onToggleEnable(source, next)}
                onOpenLogin={
                  sourceRequiresLoginLabel(source.capabilities) && source.id !== 'zlibrary'
                    ? () => props.onOpenLogin(source)
                    : null
                }
                onOpenNodeManager={source.id === 'zlibrary' ? props.onOpenNodeManager : null}
                onDelete={() => props.onDelete(source)}
                onOpenInfo={() => props.onOpenInfo(source)}
              />
              {/* 行分割线：左侧从文字起点开始（缩进 64），右侧到卡片边缘；最后一行不画 */}
              {index < visibleSources.length - 1 ? (
                <SourceLine indentStart={SOURCE_ROW_DIVIDER_INDENT} />
              ) : null}
            </div>
          ))}
          {hidden > 0 || props.showAll ? (
            <>
              <SourceLine />
              <SourceExpandRestRow
                rest={hidden}
                showAll={props.showAll}
                onClick={props.onToggleShowAll}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 显式标注类型：`allSources` 是 StateFlow 里的 List<BookSource>，但一旦这里靠推断，
 * 后面任何一处写法改变都会把类型错误一路传染到几十行之外（.size / ?.id 全部误报）。
 * — Kotlin L339–342, plus the group builder L344–358
 */
export function buildSourceGroups(
  allSources: ReadonlyArray<BookSource>,
  customSources: ReadonlyArray<BookSource>,
): SourceGroup[] {
  const builtinSources = allSources.filter((s) => !customSources.includes(s));
  const groups: SourceGroup[] = [];
  const novels = builtinSources.filter((s) => isNovelSource(s));
  const comics = builtinSources.filter((s) => isComicSource(s));
  const others = builtinSources.filter((s) => !isNovelSource(s) && !isComicSource(s));
  if (novels.length > 0) groups.push({ title: '小说', kind: SourceGroupKind.NOVEL, sources: novels });
  if (comics.length > 0) groups.push({ title: '漫画', kind: SourceGroupKind.COMIC, sources: comics });
  if (others.length > 0) groups.push({ title: '其他', kind: SourceGroupKind.OTHER, sources: others });
  if (customSources.length > 0) {
    groups.push({ title: '自定义', kind: SourceGroupKind.CUSTOM, sources: [...customSources] });
  }
  return groups;
}

function IconAddSvg() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

/**
 * 自定义书源的入口：**不要插画、不要空状态大卡**，只有一条虚线描边的行
 * （圆角 20、高 48、居中「＋ 导入 JSON 书源」、14sp primary）。
 *
 * 点击后弹出导入方式面板（本地文件 / 粘贴 JSON / 网络导入）—— 三条导入路径都是
 * 功能而不是装饰，收敛进弹窗是为了让页面结构里只有「3 张玻璃卡 + 1 个导入行」。
 * — L1514–1557
 */
export function SourceImportEntryRow(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="source-import-row"
      style={{ color: accentText() }}
      onClick={props.onClick}
    >
      <IconAddSvg />
      导入 JSON 书源
    </button>
  );
}

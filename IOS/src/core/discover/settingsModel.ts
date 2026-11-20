/**
 * `discover/DiscoverSettings.kt`（75 行）的**可判定部分** —— 设置窗的取值、选项、
 * 尺寸常量与二级「屏蔽管理」的行文案。
 *
 * 为什么单开一层：Kotlin 的 `@Composable fun DiscoverSettings(...)` 不是「外部塞一堆
 * row 进来我渲染」的通用容器，而是**自包含**的两级设置窗 —— 它自己读
 * `rememberDiscoverStore(partition)` 的五个键（`layout` / `personalization` /
 * `green_rise` / `cache` / `cache_hours`），并自带「屏蔽管理」二级对话框
 * （`blockedWorks()` / `unblock(key)` / `clearBlocked()`）。
 *
 * 端口此前的 `DiscoverSettings.tsx` 只接受 `rows` + `onToggle`，于是在 production 里
 * **零调用**：布局选择、缓存时长联动、清除离线缓存、整块屏蔽管理全都没有入口（E187）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L18 `partition: DiscoverPartition = DiscoverPartition.COMIC` → `DISCOVER_SETTINGS_DEFAULT_PARTITION`
 *   L21 `heightIn(max = 460.dp)`                               → `DISCOVER_SETTINGS_MAX_HEIGHT_DP`
 *   L21 `tr("发现设置")`                                        → `DISCOVER_SETTINGS_TITLE`
 *   L23 `verticalArrangement = Arrangement.spacedBy(16.dp)`      → `DISCOVER_SETTINGS_CARD_GAP_DP`
 *   L25/32/37 `GlassCard(contentPadding = PaddingValues(16.dp))` → `DISCOVER_SETTINGS_PADDING_DP`
 *   L26 `tr("浏览布局")`                                        → `DISCOVER_LAYOUT_SECTION_TITLE`
 *   L27 `Spacer(Modifier.height(12.dp))`                        → `DISCOVER_SETTINGS_SPACER_DP`
 *   L28-30 `store.string("layout", "GRID")` + `indexOfFirst`     → `discoverLayoutOptions` / `discoverLayoutIndex`
 *   L33 `个性化推荐` / `结合喜欢的作品与阅读记录` / `flag("personalization")` → `PERSONALIZATION_SETTING`
 *   L35 `绿涨红跌` / `关闭时为红涨绿跌` / `flag("green_rise", false)`      → `GREEN_RISE_SETTING`
 *   L38 `离线缓存` / `下次打开立即显示上次内容` / `flag("cache")`         → `CACHE_SETTING`
 *   L39-43 `if (store.flag("cache"))` + 6/24/72 选择              → `CACHE_HOUR_OPTIONS` / `cacheHoursSelection`
 *   L44 `清除离线缓存` → `store.cache.edit().clear()`              → `CLEAR_CACHE_LABEL`
 *   L46 `屏蔽管理` → `blockedOpen = true`                          → `BLOCKED_SECTION_LABEL`
 *   L48/49 `完成` → `close {}`                                     → `DONE_LABEL`
 *   L50 `heightIn(max = 320.dp)`                                   → `BLOCKED_DIALOG_MAX_HEIGHT_DP`
 *   L54 `tr("还没有屏蔽作品")`                                      → `BLOCKED_EMPTY_LABEL`
 *   L56-58 `PullOutTextButton { Text("解除 · $title") }`            → `blockedRowLabel(title)`
 *   L62 `全部解除` → `store.clearBlocked()`                        → `UNBLOCK_ALL_LABEL`
 *   L67 `heightIn(min = 56.dp)`                                    → `SETTINGS_TOGGLE_MIN_HEIGHT_DP`
 *   L68 `spacedBy(12.dp)`                                          → `SETTINGS_TOGGLE_GAP_DP`
 *   L34 `outlineVariant.copy(alpha = .4f)`                          → `SETTINGS_DIVIDER_ALPHA`
 *
 * ⚠️ 一处**语义不对称**（Kotlin 原样，不"修正"）：
 *   · 布局选择传的是**索引**（`entries.indexOfFirst { it.name == store.string("layout","GRID") }.coerceAtLeast(0)`）；
 *   · 缓存时长传的是**值**（`store.string("cache_hours","24").toIntOrNull() ?: 24`，直接就是 24 而不是 1）。
 * 两者喂给同一个 `SegmentedPillSelector`，行为差异只在「取值落在选项之外」时暴露。
 * 端口照抄，不移平 —— 移平就等于换了一套落库值。
 */

import {
  DISCOVER_LAYOUTS,
  DISCOVER_LAYOUT_LABELS,
  type DiscoverLayout,
  type DiscoverPartition,
} from './models';

/** Kotlin L18 `partition: DiscoverPartition = DiscoverPartition.COMIC`。 */
export const DISCOVER_SETTINGS_DEFAULT_PARTITION: DiscoverPartition = 'COMIC';

/** Kotlin L21 `tr("发现设置")`。 */
export const DISCOVER_SETTINGS_TITLE = '发现设置';
/** Kotlin L21 `heightIn(max = 460.dp)`。 */
export const DISCOVER_SETTINGS_MAX_HEIGHT_DP = 460;
/** Kotlin L23 `Arrangement.spacedBy(16.dp)`。 */
export const DISCOVER_SETTINGS_CARD_GAP_DP = 16;
/** Kotlin L25/32/37 `PaddingValues(16.dp)`。 */
export const DISCOVER_SETTINGS_PADDING_DP = 16;
/** Kotlin L26 `tr("浏览布局")`。 */
export const DISCOVER_LAYOUT_SECTION_TITLE = '浏览布局';
/** Kotlin L27 / L40 `Spacer(Modifier.height(12.dp))`。 */
export const DISCOVER_SETTINGS_SPACER_DP = 12;
/** Kotlin L34 `outlineVariant.copy(alpha = .4f)`。 */
export const SETTINGS_DIVIDER_ALPHA = 0.4;
/** Kotlin L67 `heightIn(min = 56.dp)`。 */
export const SETTINGS_TOGGLE_MIN_HEIGHT_DP = 56;
/** Kotlin L68 `Arrangement.spacedBy(12.dp)`。 */
export const SETTINGS_TOGGLE_GAP_DP = 12;
/** Kotlin L50 `heightIn(max = 320.dp)`。 */
export const BLOCKED_DIALOG_MAX_HEIGHT_DP = 320;
/** Kotlin L46 / L50 `tr("屏蔽管理")`。 */
export const BLOCKED_SECTION_LABEL = '屏蔽管理';
/** Kotlin L48 `tr("完成")`。 */
export const DONE_LABEL = '完成';
/** Kotlin L54 `tr("还没有屏蔽作品")`。 */
export const BLOCKED_EMPTY_LABEL = '还没有屏蔽作品';
/** Kotlin L62 `tr("全部解除")`。 */
export const UNBLOCK_ALL_LABEL = '全部解除';
/** Kotlin L44 `tr("清除离线缓存")`。 */
export const CLEAR_CACHE_LABEL = '清除离线缓存';

/** Kotlin `DiscoverStore.string("layout", "GRID")` 的默认值。 */
export const DISCOVER_LAYOUT_DEFAULT: DiscoverLayout = 'GRID';
/** Kotlin `DiscoverStore.string("cache_hours", "24")` 的默认值。 */
export const DISCOVER_CACHE_HOURS_DEFAULT = '24';

/** Kotlin L28 `DiscoverLayout.entries.map { it.ordinal to it.label }`。 */
export interface DiscoverLayoutOption {
  /** `it.ordinal`。 */
  readonly ordinal: number;
  /** `it.name` —— 落库的就是这个字段。 */
  readonly name: DiscoverLayout;
  /** `it.label`（`DISCOVER_LAYOUT_LABELS`）。 */
  readonly label: string;
}

/** Kotlin L28 的布局选项表（顺序 = `DiscoverLayout.entries`）。 */
export const DISCOVER_LAYOUT_OPTIONS: readonly DiscoverLayoutOption[] = DISCOVER_LAYOUTS.map(
  (name, ordinal) => ({ ordinal, name, label: DISCOVER_LAYOUT_LABELS[name] }),
);

/**
 * Kotlin L29 `DiscoverLayout.entries.indexOfFirst { it.name == store.string("layout", "GRID") }.coerceAtLeast(0)`。
 *
 * 落库值未知/损坏时 `indexOfFirst` 返回 −1 → `coerceAtLeast(0)` → 第 0 项（列表）。
 */
export function discoverLayoutIndex(stored: string | null | undefined): number {
  const name = stored == null || stored === '' ? DISCOVER_LAYOUT_DEFAULT : stored;
  const index = DISCOVER_LAYOUT_OPTIONS.findIndex((option) => option.name === name);
  return index < 0 ? 0 : index;
}

/** Kotlin L30 `store.put("layout", DiscoverLayout.entries[it].name)`。 */
export function discoverLayoutNameAt(index: number): DiscoverLayout {
  const option = DISCOVER_LAYOUT_OPTIONS[Math.min(Math.max(index, 0), DISCOVER_LAYOUT_OPTIONS.length - 1)];
  return (option ?? DISCOVER_LAYOUT_OPTIONS[0]!).name;
}

/** Kotlin L41 `listOf(6 to tr("6小时"), 24 to tr("24小时"), 72 to tr("72小时"))`。 */
export const CACHE_HOUR_OPTIONS: ReadonlyArray<{ readonly hours: number; readonly label: string }> = [
  { hours: 6, label: '6小时' },
  { hours: 24, label: '24小时' },
  { hours: 72, label: '72小时' },
];

/**
 * Kotlin L42 `store.string("cache_hours", "24").toIntOrNull() ?: 24`。
 *
 * 注意返回的是**小时值**（6/24/72），不是索引 —— 与 `discoverLayoutIndex` 不对称，
 * 这是 Kotlin 原样（见文件头）。
 */
export function cacheHoursSelection(stored: string | null | undefined): number {
  const raw = stored == null || stored === '' ? DISCOVER_CACHE_HOURS_DEFAULT : stored;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 24;
}

/** Kotlin L42 `store.put("cache_hours", it.toString())`。 */
export function cacheHoursValue(hours: number): string {
  return String(hours);
}

/** 一条 `DiscoverSettingToggle(title, description, checked, onChange)` 的描述。 */
export interface DiscoverSettingDefinition {
  /** Kotlin 的 `store.flag(key, default)` 用的键。 */
  readonly key: string;
  /** Kotlin `title`（已是 `tr()` 之前的原文）。 */
  readonly title: string;
  /** Kotlin `description`。 */
  readonly description: string;
  /** Kotlin `flag(key, default)` 的 default。 */
  readonly defaultChecked: boolean;
}

/** Kotlin L33 `DiscoverSettingToggle(tr("个性化推荐"), tr("结合喜欢的作品与阅读记录"), store.flag("personalization"))`。 */
export const PERSONALIZATION_SETTING: DiscoverSettingDefinition = {
  key: 'personalization',
  title: '个性化推荐',
  description: '结合喜欢的作品与阅读记录',
  defaultChecked: true,
};

/** Kotlin L35 `DiscoverSettingToggle(tr("绿涨红跌"), tr("关闭时为红涨绿跌"), store.flag("green_rise", false))`。 */
export const GREEN_RISE_SETTING: DiscoverSettingDefinition = {
  key: 'green_rise',
  title: '绿涨红跌',
  description: '关闭时为红涨绿跌',
  defaultChecked: false,
};

/** Kotlin L38 `DiscoverSettingToggle(tr("离线缓存"), tr("下次打开立即显示上次内容"), store.flag("cache"))`。 */
export const CACHE_SETTING: DiscoverSettingDefinition = {
  key: 'cache',
  title: '离线缓存',
  description: '下次打开立即显示上次内容',
  defaultChecked: true,
};

/** 设置窗里三段卡片的标题（Kotlin 只给第一段写了标题）。 */
export interface DiscoverSettingsSection {
  /** 卡片标题；Kotlin 只有「浏览布局」这一段有标题。 */
  readonly title: string | null;
  /** 段内条目。 */
  readonly settings: readonly DiscoverSettingDefinition[];
}

/**
 * Kotlin L25-45 的三段卡片结构：
 *   ① 浏览布局（SegmentedPillSelector，不是 toggle）
 *   ② 个性化推荐 / 绿涨红跌
 *   ③ 离线缓存（+ 缓存时长 + 清除）
 *
 * 布局与缓存时长是选择器，不在这张表里 —— 表只列 `DiscoverSettingToggle`。
 */
export const DISCOVER_SETTINGS_SECTIONS: readonly DiscoverSettingsSection[] = [
  { title: DISCOVER_LAYOUT_SECTION_TITLE, settings: [] },
  { title: null, settings: [PERSONALIZATION_SETTING, GREEN_RISE_SETTING] },
  { title: null, settings: [CACHE_SETTING] },
];

/** Kotlin L56-58 `Text("解除 · $title")`。 */
export function blockedRowLabel(title: string): string {
  return `解除 · ${title}`;
}

/** Kotlin L52-59 的 `blocked.forEach { (key, title) -> … }` 渲染行。 */
export interface BlockedRow {
  readonly key: string;
  readonly title: string;
  readonly label: string;
}

/** `store.blockedWorks()` → 渲染行（标签逐字 `解除 · <书名>`）。 */
export function blockedRows(works: ReadonlyArray<{ readonly key: string; readonly title: string }>): BlockedRow[] {
  return works.map((work) => ({ key: work.key, title: work.title, label: blockedRowLabel(work.title) }));
}

/**
 * Kotlin L39 `if (store.flag("cache"))` —— 缓存时长选择器只在「离线缓存」开着时出现。
 * 同时决定 L44「清除离线缓存」按钮是否总是可见（Kotlin 里它**无条件**在，关缓存时也能点）。
 */
export function showsCacheHours(cacheEnabled: boolean): boolean {
  return cacheEnabled;
}

/** Kotlin L38 `if (!it) store.cache.edit().clear()` —— 关掉缓存时立刻清盘。 */
export function shouldClearCacheOnToggle(cacheEnabled: boolean): boolean {
  return !cacheEnabled;
}

/**
 * 发现页设置窗 —— `discover/DiscoverSettings.kt`（75 行）的逐行移植。
 *
 * ⚠️ 端口此前是一个**通用容器**：`DiscoverSettingsProps` 收 `rows` + 一个开关回调，
 * 自己只画一堆开关。于是它在 production 里**零调用** —— 布局选择、缓存时长联动、
 * 清除离线缓存、整块「屏蔽管理」全都没有入口（E187）。本轮按 Kotlin 的**自包含**
 * 结构重写：自己读 `store` 的五个键，自带二级「屏蔽管理」对话框。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L19 `val (store, revision) = rememberDiscoverStore(partition)` → `props.store`（注入）
 *   L20 `var blockedOpen by remember { mutableStateOf(false) }`     → `useState(false)`
 *   L21-49 `AcrylicDialog(title = tr("发现设置"), …)`              → 第一个 `<AcrylicDialog>`
 *   L23 `heightIn(max = 460.dp)` + `verticalScroll`                → `maxHeight` + `overflowY: auto`
 *   L25-31 布局卡 + `SegmentedPillSelector(ordinal → label)`        → `DISCOVER_LAYOUT_OPTIONS`
 *   L32-36 个性化推荐 / 绿涨红跌 + 0.4 alpha 分隔线                 → `PERSONALIZATION_SETTING` / `GREEN_RISE_SETTING`
 *   L37-45 离线缓存 + (`if flag("cache")` 时) 6/24/72 + 清除        → `CACHE_SETTING` / `CACHE_HOUR_OPTIONS`
 *   L46 `AppActionButton(tr("屏蔽管理"))`                          → `AppButton(variant=secondary, fullWidth)`
 *   L48-49 confirmButton `完成`                                     → `confirmButton`
 *   L50-62 二级 `AcrylicDialog(tr("屏蔽管理"))`（320dp）            → 第二个 `<AcrylicDialog>`
 *   L66-75 `DiscoverSettingToggle`                                  → `DiscoverSettingToggle`
 *
 * 组件对应（都在项目里已有，没有降级）：
 *   · `AcrylicDialog` → `@ui/components/AcrylicDialog`（同名）
 *   · `GlassCard(contentPadding = 16.dp)` → `<GlassCard padding={16}>`
 *   · `SegmentedPillSelector` → 同名组件（`{ value, label }` 选项）
 *   · `AppActionButton` → `AppButton`（`variant` / `fullWidth`）
 *   · `PullOutTextButton` → `WenkuTextButton`（`compact` 保留紧凑样式）
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';

import { tr } from '@core/i18n';
import type { DiscoverPartition } from '@core/discover/models';
import {
  BLOCKED_DIALOG_MAX_HEIGHT_DP,
  BLOCKED_EMPTY_LABEL,
  BLOCKED_SECTION_LABEL,
  CACHE_HOUR_OPTIONS,
  CACHE_SETTING,
  CLEAR_CACHE_LABEL,
  DISCOVER_LAYOUT_OPTIONS,
  DISCOVER_LAYOUT_SECTION_TITLE,
  DISCOVER_SETTINGS_CARD_GAP_DP,
  DISCOVER_SETTINGS_DEFAULT_PARTITION,
  DISCOVER_SETTINGS_MAX_HEIGHT_DP,
  DISCOVER_SETTINGS_PADDING_DP,
  DISCOVER_SETTINGS_SPACER_DP,
  DISCOVER_SETTINGS_TITLE,
  DONE_LABEL,
  GREEN_RISE_SETTING,
  PERSONALIZATION_SETTING,
  SETTINGS_DIVIDER_ALPHA,
  SETTINGS_TOGGLE_GAP_DP,
  SETTINGS_TOGGLE_MIN_HEIGHT_DP,
  UNBLOCK_ALL_LABEL,
  blockedRows,
  cacheHoursSelection,
  cacheHoursValue,
  discoverLayoutIndex,
  discoverLayoutNameAt,
  showsCacheHours,
  shouldClearCacheOnToggle,
  type DiscoverSettingDefinition,
} from '@core/discover/settingsModel';

import { AcrylicDialog } from '../AcrylicDialog';
import { AppButton } from '../AppButton';
import { GlassCard } from '../GlassCard';
import { SegmentedPillSelector } from '../SegmentedPillSelector';
import { WenkuTextButton } from '../wenku/WenkuGlass';
import '../../../styles/discover.css';

/**
 * `DiscoverStore` 里设置窗真正用到的那七个成员。
 *
 * Kotlin 直接 `rememberDiscoverStore(partition)` 拿真对象；TS 侧收窄成结构接口，
 * 这样 UI 不必依赖 `DiscoverStore` 的具体实现（测试也能给一个纯内存替身）。
 */
export interface DiscoverSettingsStorePort {
  /** Kotlin `store.string(key, fallback)`（`layout` / `cache_hours`）。 */
  string(key: string, fallback: string): string;
  /** Kotlin `store.flag(key, default)`（`personalization` / `green_rise` / `cache`）。 */
  flag(key: string, fallback?: boolean): boolean;
  /** Kotlin `store.put(key, value)`。 */
  put(key: string, value: string | boolean): void;
  /** Kotlin `store.blockedWorks()`。 */
  blockedWorks(): ReadonlyArray<{ readonly key: string; readonly title: string }>;
  /** Kotlin `store.unblock(key)`。 */
  unblock(key: string): void;
  /** Kotlin `store.clearBlocked()`。 */
  clearBlocked(): void;
  /** Kotlin `store.cache.edit().clear()`（关缓存时与「清除离线缓存」都走它）。 */
  clearCache(): Promise<void>;
}

export interface DiscoverSettingsProps {
  readonly store: DiscoverSettingsStorePort;
  /** Kotlin L18 `onDismissRequest`。 */
  readonly onDismissRequest: () => void;
  /** Kotlin L18 `partition: DiscoverPartition = DiscoverPartition.COMIC`。 */
  readonly partition?: DiscoverPartition;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Kotlin L66-75 `DiscoverSettingToggle(title, description, checked, onChange)`。 */
export function DiscoverSettingToggle(props: {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <label
      className="discover-setting"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SETTINGS_TOGGLE_GAP_DP,
        minHeight: SETTINGS_TOGGLE_MIN_HEIGHT_DP,
      }}
    >
      <span className="discover-setting__text" style={{ flex: 1, minWidth: 0 }}>
        <span className="discover-setting__title">{props.title}</span>
        <span className="discover-setting__description">{props.description}</span>
      </span>
      <input
        className="discover-setting__switch"
        type="checkbox"
        role="switch"
        aria-label={props.title}
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

/** Kotlin L33/L35/L38 —— 一条开关：`flag(key, default)` 读、`put(key, it)` 写。 */
function SettingRow(props: { store: DiscoverSettingsStorePort; setting: DiscoverSettingDefinition }) {
  const { store, setting } = props;
  return (
    <DiscoverSettingToggle
      title={tr(setting.title)}
      description={tr(setting.description)}
      checked={store.flag(setting.key, setting.defaultChecked)}
      onChange={(next) => store.put(setting.key, next)}
    />
  );
}

/** Kotlin L18-64 `DiscoverSettings`。 */
export function DiscoverSettings(props: DiscoverSettingsProps) {
  const store = props.store;
  // Kotlin L20 `var blockedOpen by remember { mutableStateOf(false) }`
  const [blockedOpen, setBlockedOpen] = useState(false);
  // `partition` 只影响 `rememberDiscoverStore(partition)`（已由调用方注入 store），
  // 这里保留字段以便调用点保持与 Kotlin 同形，并给 data-partition 供样式/测试使用。
  const partition = props.partition ?? DISCOVER_SETTINGS_DEFAULT_PARTITION;

  const cacheEnabled = store.flag(CACHE_SETTING.key, CACHE_SETTING.defaultChecked);

  return (
    <>
      <AcrylicDialog
        onDismissRequest={props.onDismissRequest}
        title={<span className="discover-sheet__title">{tr(DISCOVER_SETTINGS_TITLE)}</span>}
        data-testid="discover_settings"
        text={
          <div
            className={['discover-settings', props.className].filter(Boolean).join(' ')}
            data-partition={partition}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: DISCOVER_SETTINGS_CARD_GAP_DP,
              maxHeight: DISCOVER_SETTINGS_MAX_HEIGHT_DP,
              overflowY: 'auto',
              ...props.style,
            }}
          >
            {/* L25-31 浏览布局 */}
            <GlassCard padding={DISCOVER_SETTINGS_PADDING_DP}>
              <p className="discover-settings__section-title">{tr(DISCOVER_LAYOUT_SECTION_TITLE)}</p>
              <div style={{ height: DISCOVER_SETTINGS_SPACER_DP }} />
              <SegmentedPillSelector
                options={DISCOVER_LAYOUT_OPTIONS.map((option) => ({
                  value: option.ordinal,
                  label: tr(option.label),
                }))}
                value={discoverLayoutIndex(store.string('layout', 'GRID'))}
                onChange={(index) => store.put('layout', discoverLayoutNameAt(index))}
              />
            </GlassCard>

            {/* L32-36 个性化推荐 / 绿涨红跌 */}
            <GlassCard padding={DISCOVER_SETTINGS_PADDING_DP}>
              <SettingRow store={store} setting={PERSONALIZATION_SETTING} />
              <div
                className="discover-settings__divider"
                style={{
                  height: 1,
                  margin: '8px 0',
                  background: 'var(--color-outline-variant, #e3e5e7)',
                  opacity: SETTINGS_DIVIDER_ALPHA,
                }}
              />
              <SettingRow store={store} setting={GREEN_RISE_SETTING} />
            </GlassCard>

            {/* L37-45 离线缓存 */}
            <GlassCard padding={DISCOVER_SETTINGS_PADDING_DP}>
              <DiscoverSettingToggle
                title={tr(CACHE_SETTING.title)}
                description={tr(CACHE_SETTING.description)}
                checked={cacheEnabled}
                onChange={(next) => {
                  store.put(CACHE_SETTING.key, next);
                  // L38 `if (!it) store.cache.edit().clear()`
                  if (shouldClearCacheOnToggle(next)) void store.clearCache();
                }}
              />
              {showsCacheHours(cacheEnabled) ? (
                <>
                  <div style={{ height: DISCOVER_SETTINGS_SPACER_DP }} />
                  <SegmentedPillSelector
                    options={CACHE_HOUR_OPTIONS.map((option) => ({
                      value: option.hours,
                      label: tr(option.label),
                    }))}
                    value={cacheHoursSelection(store.string('cache_hours', '24'))}
                    onChange={(hours) => store.put('cache_hours', cacheHoursValue(hours))}
                  />
                </>
              ) : null}
              <WenkuTextButton
                text={tr(CLEAR_CACHE_LABEL)}
                onClick={() => void store.clearCache()}
                compact
              />
            </GlassCard>

            {/* L46 屏蔽管理入口 */}
            <AppButton variant="secondary" fullWidth onClick={() => setBlockedOpen(true)}>
              {tr(BLOCKED_SECTION_LABEL)}
            </AppButton>
          </div>
        }
        confirmButton={
          // L48-49 `AppActionButton(tr("完成"), { close {} }, Primary)`
          <AppButton variant="primary" onClick={props.onDismissRequest}>
            {tr(DONE_LABEL)}
          </AppButton>
        }
      />

      {blockedOpen ? (
        <AcrylicDialog
          onDismissRequest={() => setBlockedOpen(false)}
          title={<span className="discover-sheet__title">{tr(BLOCKED_SECTION_LABEL)}</span>}
          data-testid="discover_blocked"
          text={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                maxHeight: BLOCKED_DIALOG_MAX_HEIGHT_DP,
                overflowY: 'auto',
              }}
            >
              {blockedRows(store.blockedWorks()).length === 0 ? (
                // L54 `if (blocked.isEmpty()) Text(tr("还没有屏蔽作品"))`
                <p className="discover-settings__empty">{tr(BLOCKED_EMPTY_LABEL)}</p>
              ) : (
                blockedRows(store.blockedWorks()).map((row) => (
                  // L56-58 `PullOutTextButton(onClick = { store.unblock(key) }) { Text("解除 · $title") }`
                  <WenkuTextButton
                    key={row.key}
                    text={row.label}
                    onClick={() => store.unblock(row.key)}
                    compact
                  />
                ))
              )}
            </div>
          }
          confirmButton={
            // L62 `AppActionButton(tr("全部解除"), { store.clearBlocked(); close {} })`
            <AppButton
              variant="primary"
              onClick={() => {
                store.clearBlocked();
                setBlockedOpen(false);
              }}
            >
              {tr(UNBLOCK_ALL_LABEL)}
            </AppButton>
          }
        />
      ) : null}
    </>
  );
}

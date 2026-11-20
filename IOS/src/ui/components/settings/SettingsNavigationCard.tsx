/**
 * SettingsNavigationCard.tsx — `ui/SettingsTabScreen.kt` L1232-1256 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L1237-1243 `private fun SettingsNavigationCard(title, symbol, modifier, subtitle = null, onClick)`
 *                                                              → `SettingsNavigationCardProps`
 *   L1245 `GlassCard(modifier.fillMaxWidth().wenkuTabTitle(2, strength = .55f),
 *          shape = RoundedCornerShape(16.dp), onClick = onClick)` → `<GlassCard radius={16} onClick>`
 *   L1246 `Row(Modifier.fillMaxWidth().padding(16.dp), CenterVertically)` → `.settings-navigation-card__row`
 *   L1247 `WenkuIcon(symbol, size = 24.dp, tint = colors.primary, entrance = false)`
 *                                                              → `<WenkuIcon size={24} tint="var(--color-primary)">`
 *   L1248 `Spacer(Modifier.width(12.dp))`                       → `.settings-navigation-card__gap`
 *   L1250 `Text(title, SemiBold, 15.sp)`                        → `__title`（15sp / 600）
 *   L1251 `if (subtitle != null) Text(subtitle, bodySmall, colors.onSurfaceVariant)`
 *                                                              → `__subtitle`（12sp/16sp / `--color-medium-gray`）
 *   L1253 `WenkuIcon(WenkuSymbol.Forward, 18.dp, colors.onSurfaceVariant.copy(alpha = .6f))`
 *                                                              → `<WenkuIcon symbol="Forward" size={18}>`
 *
 * 常量来源
 * ───────
 *   L1245 `RoundedCornerShape(16.dp)`、L1246 `padding(16.dp)`、L1248 `width(12.dp)`、
 *   L1247 `size = 24.dp`、L1250 `fontSize = 15.sp`、L1253 `size = 18.dp` / `alpha = .6f`
 *   `MaterialTheme.colorScheme.primary` = `--color-primary`（`theme.css` L23）
 *   `onSurfaceVariant` = `--color-medium-gray`（`theme.css` L28 / L152，与 `SettingsSectionHeader` 同一映射）
 *   `MaterialTheme.typography.bodySmall` = 12sp / 16sp（Material3 默认，`Type.kt` 未覆盖 bodySmall）
 *
 * 与 Kotlin 的差异
 * ───────────────
 *  * `wenkuTabTitle(2, strength = .55f)` 是**挂载时钟**修饰符（`WenkuMotion.kt` L175-191），
 *    Web 端没有 `LocalWenkuSequence`；与 `WenkuSectionHeader` 同一决策：默认关，终端几何一致，
 *    只省掉入场位移/alpha 的那 420ms。
 *  * `modifier.testTag(...)` → `data-testid`（调用点 `device_transfer_entry` /
 *    `library_help_entry_card`，`SettingsTabScreen.kt` L956 / L967）。
 */

import type { CSSProperties } from 'react';

import { GlassCard } from '../GlassCard';
import { WenkuIcon } from '../wenku/WenkuIcon';
import type { WenkuSymbol } from '../wenku/WenkuIcon';
import '../../../styles/settings.css';

/** L1245 `RoundedCornerShape(16.dp)`。 */
export const SETTINGS_NAV_CARD_RADIUS_PX = 16;
/** L1246 `Modifier.fillMaxWidth().padding(16.dp)`。 */
export const SETTINGS_NAV_CARD_PADDING_PX = 16;
/** L1248 `Spacer(Modifier.width(12.dp))`。 */
export const SETTINGS_NAV_CARD_GAP_PX = 12;
/** L1247 `WenkuIcon(symbol, size = 24.dp)`。 */
export const SETTINGS_NAV_CARD_ICON_PX = 24;
/** L1253 `WenkuIcon(WenkuSymbol.Forward, size = 18.dp)`。 */
export const SETTINGS_NAV_CARD_CHEVRON_PX = 18;
/** L1253 `onSurfaceVariant.copy(alpha = .6f)`。 */
export const SETTINGS_NAV_CARD_CHEVRON_ALPHA = 0.6;
/** L1250 `fontSize = 15.sp`（`FontWeight.SemiBold`）。 */
export const SETTINGS_NAV_CARD_TITLE_SP = 15;
/** `MaterialTheme.typography.bodySmall`（Material3 默认 12sp / lineHeight 16sp）。 */
export const SETTINGS_NAV_CARD_SUBTITLE_SP = 12;
export const SETTINGS_NAV_CARD_SUBTITLE_LINE_SP = 16;
/** L1245 `wenkuTabTitle(2, strength = .55f)` 的两个参数（登记用，Web 端不入场）。 */
export const SETTINGS_NAV_CARD_TAB_TITLE_ORDER = 2;
export const SETTINGS_NAV_CARD_TAB_TITLE_STRENGTH = 0.55;

export interface SettingsNavigationCardProps {
  readonly title: string;
  readonly symbol: WenkuSymbol;
  /** Kotlin `subtitle: String? = null` —— 为 null/undefined 时整行不渲染。 */
  readonly subtitle?: string;
  readonly onClick: () => void;
  /** Kotlin `modifier` 里的 `testTag(...)`。 */
  readonly testId?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 设置页跳转卡片：16px 圆角玻璃卡 + 24px 主色图标 + 15sp 标题（可选 12sp 副标题）+ 18px 右箭头。
 * Kotlin: `ui/SettingsTabScreen.kt` L1232-1256（6 个生产调用点）。
 */
export function SettingsNavigationCard(props: SettingsNavigationCardProps) {
  const classNames = ['settings-navigation-card'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  return (
    <div className={classNames.join(' ')} data-testid={props.testId} style={props.style}>
      <GlassCard
        radius={SETTINGS_NAV_CARD_RADIUS_PX}
        padding={SETTINGS_NAV_CARD_PADDING_PX}
        onClick={props.onClick}
      >
        <div className="settings-navigation-card__row">
          <WenkuIcon
            symbol={props.symbol}
            size={SETTINGS_NAV_CARD_ICON_PX}
            tint="var(--color-primary)"
          />
          <span
            className="settings-navigation-card__gap"
            style={{ width: `${String(SETTINGS_NAV_CARD_GAP_PX)}px` }}
          />
          <span className="settings-navigation-card__text">
            <span
              className="settings-navigation-card__title"
              style={{ fontSize: `${String(SETTINGS_NAV_CARD_TITLE_SP)}px` }}
            >
              {props.title}
            </span>
            {props.subtitle === undefined ? null : (
              <span
                className="settings-navigation-card__subtitle"
                style={{
                  fontSize: `${String(SETTINGS_NAV_CARD_SUBTITLE_SP)}px`,
                  lineHeight: `${String(SETTINGS_NAV_CARD_SUBTITLE_LINE_SP)}px`,
                }}
              >
                {props.subtitle}
              </span>
            )}
          </span>
          <WenkuIcon
            symbol="Forward"
            size={SETTINGS_NAV_CARD_CHEVRON_PX}
            tint={`color-mix(in srgb, var(--color-medium-gray) ${
              String(SETTINGS_NAV_CARD_CHEVRON_ALPHA * 100)
            }%, transparent)`}
          />
        </div>
      </GlassCard>
    </div>
  );
}

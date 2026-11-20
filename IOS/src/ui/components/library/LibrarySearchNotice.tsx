/**
 * LibrarySearchNotice.tsx — `library/LibraryScreen.kt` L1195-1231 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L1196-1203 `private fun LibrarySearchNotice(title, description, action, tag, symbol, onAction)`
 *                                                              → `LibrarySearchNoticeProps`
 *   L1204-1209 `GlassCard(Modifier.fillMaxWidth().testTag(tag),
 *                shape = MaterialTheme.shapes.large,
 *                tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.90f),
 *                contentPadding = PaddingValues(14.dp))`       → `<GlassCard radius={16} padding={14}>`
 *                                                                + `data-testid={tag}` + `background: surface@.90`
 *   L1210-1223 `Row(spacedBy(12.dp), CenterVertically)` + `Image(readingDrawable, size 54.dp)`
 *                + `Column(spacedBy(3.dp))` 两颗文本     → `.library-search-notice__row` / `__mascot` / `__text`
 *   L1220 `Text(title, titleMedium + SemiBold)`          → `.library-search-notice__title`（16sp/24sp/600）
 *   L1221 `Text(description, bodySmall, onSurfaceVariant)` → `.library-search-notice__description`（12sp/16sp）
 *   L1224 `Spacer(Modifier.height(8.dp))`                → `.library-search-notice__gap`
 *   L1225-1229 `WenkuTextButton(action, onAction, align(End), compact = true, wenkuSymbol = symbol)`
 *                                                        → `<WenkuTextButton compact symbol>` + 右对齐
 *
 * 常量来源
 * ───────
 *   `MaterialTheme.shapes.large` = 16.dp（`Theme.kt` 没有覆盖 `Shapes`，走 Material3 默认）
 *   `MaterialTheme.colorScheme.surface` = `--color-surface`（`theme.css` L35 / L147）
 *   `surface @ .90`（L1207）、`contentPadding 14.dp`（L1208）、`spacedBy(12.dp)`（L1212）、
 *   `size(54.dp)`（L1217）、`spacedBy(3.dp)`（L1219）、`Spacer(8.dp)`（L1224）
 *   `MascotSpriteSheet.readingDrawable`（L1215）= `mascot_reading`（`core/mascot` L36）
 *
 * 与 Kotlin 的差异
 * ───────────────
 *  * `GlassCard.kt` 的 `tint` 参数在 `GlassCard.tsx` 里没有对应 prop，这里用内联
 *    `background` 表达同一层底色（`GlassCard.tsx` L233 把 `props.style` 放在最后，覆盖安全）。
 *  * `Modifier.fillMaxWidth()` → `width: 100%`。
 *  * `testTag(tag)` → `data-testid={tag}`；三个调用点分别是 `search_error_state` /
 *    `search_empty_state`（`LibraryScreen.kt` L959 / L975）。
 */

import type { CSSProperties } from 'react';

import { mascotAssetUrl, MascotSpriteSheet } from '@core/mascot';
import { GlassCard } from '../GlassCard';
import { WenkuTextButton } from '../wenku/WenkuGlass';
import type { WenkuSymbol } from '../wenku/WenkuIcon';
import '../../../styles/library.css';

/** `MaterialTheme.shapes.large`（Material3 默认，`Theme.kt` 未覆盖 `Shapes`）。 */
export const LIBRARY_SEARCH_NOTICE_RADIUS_PX = 16;
/** L1208 `contentPadding = PaddingValues(14.dp)`。 */
export const LIBRARY_SEARCH_NOTICE_PADDING_PX = 14;
/** L1207 `surface.copy(alpha = 0.90f)`。 */
export const LIBRARY_SEARCH_NOTICE_SURFACE_ALPHA = 0.9;
/** L1212 `Arrangement.spacedBy(12.dp)`。 */
export const LIBRARY_SEARCH_NOTICE_ROW_GAP_PX = 12;
/** L1217 `Modifier.size(54.dp)`。 */
export const LIBRARY_SEARCH_NOTICE_MASCOT_PX = 54;
/** L1219 `Arrangement.spacedBy(3.dp)` —— 标题与描述之间。 */
export const LIBRARY_SEARCH_NOTICE_TEXT_GAP_PX = 3;
/** L1224 `Spacer(Modifier.height(8.dp))` —— Row 与按钮之间。 */
export const LIBRARY_SEARCH_NOTICE_ACTION_GAP_PX = 8;
/** `MaterialTheme.typography.titleMedium`（Material3 默认 16sp / lineHeight 24sp）。 */
export const LIBRARY_SEARCH_NOTICE_TITLE_SP = 16;
export const LIBRARY_SEARCH_NOTICE_TITLE_LINE_SP = 24;
/** `MaterialTheme.typography.bodySmall`（Material3 默认 12sp / lineHeight 16sp）。 */
export const LIBRARY_SEARCH_NOTICE_DESCRIPTION_SP = 12;
export const LIBRARY_SEARCH_NOTICE_DESCRIPTION_LINE_SP = 16;
/** L1215 的 `MascotSpriteSheet.readingDrawable`。 */
export const LIBRARY_SEARCH_NOTICE_MASCOT_ASSET = 'mascot_reading';

export interface LibrarySearchNoticeProps {
  /** Kotlin `title: String` —— 调用点已 `tr()` 过。 */
  readonly title: string;
  /** Kotlin `description: String`。 */
  readonly description: string;
  /** Kotlin `action: String` —— 按钮文案。 */
  readonly action: string;
  /** Kotlin `tag: String` —— 原样落到 `data-testid`（`search_error_state` 等）。 */
  readonly tag: string;
  /** Kotlin `symbol: WenkuSymbol` —— 按钮前置图标。 */
  readonly symbol: WenkuSymbol;
  readonly onAction: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 搜索态提示卡：54px 读书吉祥物 + 标题/描述 + 右对齐紧凑文字按钮。
 * Kotlin: `library/LibraryScreen.kt` L1195-1231（2 个生产调用点：错误态 / 空态）。
 */
export function LibrarySearchNotice(props: LibrarySearchNoticeProps) {
  const classNames = ['library-search-notice'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  /** L1207 `tint = surface.copy(alpha = 0.90f)`。 */
  const cardStyle: CSSProperties = {
    background: `color-mix(in srgb, var(--color-surface) ${
      String(LIBRARY_SEARCH_NOTICE_SURFACE_ALPHA * 100)
    }%, transparent)`,
    ...props.style,
  };

  return (
    <div className={classNames.join(' ')} data-testid={props.tag}>
      <GlassCard
        radius={LIBRARY_SEARCH_NOTICE_RADIUS_PX}
        padding={LIBRARY_SEARCH_NOTICE_PADDING_PX}
        style={cardStyle}
      >
        <div
          className="library-search-notice__row"
          style={{ gap: `${String(LIBRARY_SEARCH_NOTICE_ROW_GAP_PX)}px` }}
        >
          <img
            className="library-search-notice__mascot"
            src={mascotAssetUrl(MascotSpriteSheet.readingDrawable)}
            alt=""
            aria-hidden
            width={LIBRARY_SEARCH_NOTICE_MASCOT_PX}
            height={LIBRARY_SEARCH_NOTICE_MASCOT_PX}
          />
          <div
            className="library-search-notice__text"
            style={{ gap: `${String(LIBRARY_SEARCH_NOTICE_TEXT_GAP_PX)}px` }}
          >
            <span
              className="library-search-notice__title"
              style={{
                fontSize: `${String(LIBRARY_SEARCH_NOTICE_TITLE_SP)}px`,
                lineHeight: `${String(LIBRARY_SEARCH_NOTICE_TITLE_LINE_SP)}px`,
              }}
            >
              {props.title}
            </span>
            <span
              className="library-search-notice__description"
              style={{
                fontSize: `${String(LIBRARY_SEARCH_NOTICE_DESCRIPTION_SP)}px`,
                lineHeight: `${String(LIBRARY_SEARCH_NOTICE_DESCRIPTION_LINE_SP)}px`,
              }}
            >
              {props.description}
            </span>
          </div>
        </div>
        <span
          className="library-search-notice__gap"
          style={{ height: `${String(LIBRARY_SEARCH_NOTICE_ACTION_GAP_PX)}px` }}
        />
        <div className="library-search-notice__action">
          <WenkuTextButton
            text={props.action}
            onClick={props.onAction}
            compact
            symbol={props.symbol}
          />
        </div>
      </GlassCard>
    </div>
  );
}

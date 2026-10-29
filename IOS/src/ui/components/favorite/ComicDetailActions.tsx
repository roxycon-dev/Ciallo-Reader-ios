/**
 * Port of Android `ui/favorite/ComicDetailActions.kt` (121 lines total / 114 non-blank / 106 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–26   package + imports → file header.
 *   27–35  the fixed-bottom-action-bar KDoc (design §1.1 thumb-zone rationale, the three
 *          reasons for a bottom bar, the "any position can favorite" note)
 *          → `ComicBottomActionBar` KDoc, verbatim prose.
 *   36–90  `@Composable fun ComicBottomActionBar(favorite, favoriteEnabled, continueLabel,
 *          isUpToDate, onToggleFavorite, onContinue, onDownload, onFavoriteLongPress, modifier)`
 *          `Row(fillMaxWidth, padding h16 v10, CenterVertically)`:
 *   54–61    `FavoriteHeartButton(favorite, enabled = favoriteEnabled, showLabel = false,
 *              onToggle = onToggleFavorite, onLongPress = onFavoriteLongPress, size 48)`
 *              → `<FavoriteHeartButton showLabel={false}>`.
 *   62       `Spacer(width = 10.dp)` → `.comic-action-bar__gap-10`.
 *   63–73    `isUpToDate` branch: `AppActionButton(text = continueLabel, variant = Secondary,
 *              size = Medium, modifier = weight(1f))` + `TextButton(onClick = onContinue)
 *              { Text("从头重读", 12.sp, MintPrimary, SemiBold) }`
 *              → a `<button class="comic-action-bar__restart">从头重读</button>`.
 *   74–80    else `GradientActionButton(text = continueLabel, onClick = onContinue, weight 1f)`
 *              → the same primary-weight button without the restart link.
 *   81       `Spacer(width = 10.dp)` → `.comic-action-bar__gap-10`.
 *   82–88    `AppActionButton(text = "下载", variant = Secondary, size = Small, icon = Download)`
 *              → `.comic-action-bar__download` with an inline SVG.
 *   92–115 `@Composable fun SourceUnavailableBanner(message, onRetry, onChangeSource, modifier)`
 *          `Row(fillMaxWidth, padding h12 v8, CenterVertically)`:
 *   105–111   `Text(message, 12.sp, colorScheme.error, weight 1f)`
 *   112       `TextButton(onClick = onRetry) { Text("重试", 12.sp) }`
 *   113       `TextButton(onClick = onChangeSource) { Text("换源", 12.sp) }`
 *              → `.comic-source-banner`.
 *   117–121 `fun continueReadingLabel(target, chapters) = ComicReadingLogic.continueLabel(target, chapters)`
 *              → re-exported from `@core/favorite/favoriteUi` (single implementation).
 *
 * Skipped: nothing. `AppActionButton` / `GradientActionButton` are project-wide
 * primitives already ported as `@ui/components/AppButton`; the variants/sizes and
 * every label string are preserved.
 */

import { AppButton } from '@ui/components/AppButton';
import { FavoriteHeartButton } from './FavoriteHeart';
import { continueReadingLabel } from '@core/favorite/favoriteUi';
import type { ComicChapter } from '@core/library/comicSourceTypes';
import type { ContinueTarget } from '@core/library/comicReadingLogic';
import '../../../styles/favorite.css';

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
    </svg>
  );
}

/**
 * 漫画主页面的固定底部操作栏（设计稿 §1.1 的拇指位方案）：
 *
 * 层级：**继续阅读（主按钮，右） > 喜欢（次，图标+文字，左） > 下载**。
 * 选「底部固定操作栏」而不是"封面信息区下方一排"的原因：
 * 1. 章节列表是长列表，信息区会随滚动离屏，主操作跟着消失；
 * 2. 底部栏是拇指自然落点，与列表滚动不冲突；
 * 3. 顶部栏在滚动后另出小心形（见 [FavoriteHeartIcon]），保证任何位置都能一键喜欢。
 */
export function ComicBottomActionBar(props: {
  favorite: boolean;
  favoriteEnabled: boolean;
  continueLabel: string;
  isUpToDate: boolean;
  onToggleFavorite: (favorite: boolean) => void;
  onContinue: () => void;
  onDownload: () => void;
  onFavoriteLongPress: () => void;
}) {
  return (
    <div className="comic-action-bar">
      <FavoriteHeartButton
        favorite={props.favorite}
        enabled={props.favoriteEnabled}
        showLabel={false}
        onToggle={props.onToggleFavorite}
        onLongPress={props.onFavoriteLongPress}
      />
      <span className="comic-action-bar__gap-10" />
      {props.isUpToDate ? (
        <div className="comic-action-bar__grow">
          <AppButton
            size="md"
            variant="secondary"
            fullWidth
            onClick={props.onContinue}
          >
            {props.continueLabel}
          </AppButton>
          <button
            type="button"
            className="comic-action-bar__restart"
            onClick={props.onContinue}
          >
            从头重读
          </button>
        </div>
      ) : (
        <div className="comic-action-bar__grow">
          <AppButton size="md" variant="primary" fullWidth onClick={props.onContinue}>
            {props.continueLabel}
          </AppButton>
        </div>
      )}
      <span className="comic-action-bar__gap-10" />
      <AppButton size="sm" variant="secondary" onClick={props.onDownload} icon={<IconDownload />}>
        下载
      </AppButton>
    </div>
  );
}

/** 来源失效提示条：保留缓存信息与已读状态，提供「重试」「换源」。 */
export function SourceUnavailableBanner(props: {
  message: string;
  onRetry: () => void;
  onChangeSource: () => void;
}) {
  return (
    <div className="comic-source-banner">
      <p className="comic-source-banner__msg">{props.message}</p>
      <button type="button" className="comic-source-banner__btn" onClick={props.onRetry}>
        重试
      </button>
      <button type="button" className="comic-source-banner__btn" onClick={props.onChangeSource}>
        换源
      </button>
    </div>
  );
}

export { continueReadingLabel };
export type { ContinueTarget, ComicChapter };

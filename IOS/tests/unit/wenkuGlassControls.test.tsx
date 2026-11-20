/**
 * wenkuGlassControls.test.tsx — `WenkuGlass.kt` L236-648 五个控件原语的门禁。
 *
 * 权威源（全部用 `androidReference()` 读真实 Kotlin 原文，CI 缺 live 树时回落到
 * `tests/reference/android/` 快照）：
 *   - `ui/wenku/WenkuGlass.kt`  L236-312 `WenkuIconButton`
 *                               L319-412 `WenkuTextButton`（119 处调用）
 *                               L437-500 `WenkuExpandableSearch`
 *                               L503-582  `WenkuSearchField`
 *                               L586-648 `WenkuPillButton`
 *   - `ui/wenku/WenkuTokens.kt` L73-81 控件尺寸词表
 *   - `library/LibraryScreen.kt` L1195-1231 `LibrarySearchNotice`
 *   - `ui/SettingsTabScreen.kt`  L1232-1256 `SettingsNavigationCard`
 *
 * 每条断言都是「先从 Kotlin 原文里取字面量，再和 TS 侧导出值/渲染结果比对」，
 * 不写「文档说应该是 22」这类自证式断言。
 */

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WENKU_ICON_BUTTON_DISABLED_ALPHA,
  WENKU_ICON_BUTTON_GLYPH_PX,
  WENKU_ICON_BUTTON_PRESS_SCALE,
  WENKU_ICON_BUTTON_RADIUS_PX,
  WENKU_ICON_BUTTON_REST_ALPHA_DARK,
  WENKU_ICON_BUTTON_REST_ALPHA_LIGHT,
  WENKU_ICON_BUTTON_SIZE_PX,
  WENKU_JELLY_TAP_PRESS_SCALE,
  WENKU_MENU_PANEL_BORDER_ALPHA,
  WENKU_MENU_PANEL_BORDER_PX,
  WENKU_MENU_PANEL_MAX_WIDTH_PX,
  WENKU_MENU_PANEL_PADDING_Y_PX,
  WENKU_MENU_PANEL_RADIUS_PX,
  WENKU_MENU_PANEL_WIDTH_PX,
  WENKU_PILL_BORDER_ALPHA_PRIMARY,
  WENKU_PILL_BORDER_ALPHA_SECONDARY,
  WENKU_PILL_BORDER_PX,
  WENKU_PILL_DISABLED_ALPHA,
  WENKU_PILL_GAP_PX,
  WENKU_PILL_GLYPH_PX,
  WENKU_PILL_HEIGHT_PX,
  WENKU_PILL_LABEL_SP,
  WENKU_PILL_MIN_WIDTH_PRIMARY_PX,
  WENKU_PILL_MIN_WIDTH_SECONDARY_PX,
  WENKU_PILL_PADDING_PX,
  WENKU_PILL_PRESS_SCALE,
  WENKU_PILL_RADIUS_PX,
  WENKU_PRESS_MS,
  WENKU_SEARCH_CLEAR_LABEL,
  WENKU_SEARCH_COLLAPSE_LABEL,
  WENKU_SEARCH_COMPACT_SCALE_STEP,
  WENKU_SEARCH_FIELD_ACTION_SIZE_PX,
  WENKU_SEARCH_FIELD_ICON_PX,
  WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX,
  WENKU_SEARCH_FIELD_LEADING_WIDTH_PX,
  WENKU_SEARCH_FIELD_LINE_HEIGHT_SP,
  WENKU_SEARCH_FIELD_MIN_HEIGHT_PX,
  WENKU_SEARCH_FIELD_RADIUS_PX,
  WENKU_SEARCH_FIELD_TEXT_SP,
  WENKU_SEARCH_FIELD_TRAILING_SPACER_PX,
  WENKU_SEARCH_MIN_WIDTH_PX,
  WENKU_SEARCH_OPEN_LABEL,
  WENKU_SEARCH_WOBBLE_SCALE_X,
  WENKU_SEARCH_WOBBLE_SCALE_Y,
  WENKU_SETTLE_MS,
  WENKU_TEXT_BUTTON_BORDER_PX,
  WENKU_TEXT_BUTTON_DISABLED_ALPHA,
  WENKU_TEXT_BUTTON_GAP_PX,
  WENKU_TEXT_BUTTON_GLYPH_PX,
  WENKU_TEXT_BUTTON_LABEL_SP,
  WENKU_TEXT_BUTTON_MIN_HEIGHT_PX,
  WENKU_TEXT_BUTTON_PADDING_COMPACT_PX,
  WENKU_TEXT_BUTTON_PADDING_PX,
  WENKU_TEXT_BUTTON_RADIUS_PX,
  WENKU_TEXT_BUTTON_SELECTED_FRACTION,
  WenkuIconButton,
  WenkuPillButton,
  WenkuSearchField,
  WenkuTextButton,
} from '@ui/components/wenku/WenkuGlass';
import {
  LIBRARY_SEARCH_NOTICE_ACTION_GAP_PX,
  LIBRARY_SEARCH_NOTICE_MASCOT_ASSET,
  LIBRARY_SEARCH_NOTICE_MASCOT_PX,
  LIBRARY_SEARCH_NOTICE_PADDING_PX,
  LIBRARY_SEARCH_NOTICE_RADIUS_PX,
  LIBRARY_SEARCH_NOTICE_ROW_GAP_PX,
  LIBRARY_SEARCH_NOTICE_SURFACE_ALPHA,
  LIBRARY_SEARCH_NOTICE_TEXT_GAP_PX,
} from '@ui/components/library/LibrarySearchNotice';
import {
  SETTINGS_NAV_CARD_CHEVRON_ALPHA,
  SETTINGS_NAV_CARD_CHEVRON_PX,
  SETTINGS_NAV_CARD_GAP_PX,
  SETTINGS_NAV_CARD_ICON_PX,
  SETTINGS_NAV_CARD_PADDING_PX,
  SETTINGS_NAV_CARD_RADIUS_PX,
  SETTINGS_NAV_CARD_SUBTITLE_LINE_SP,
  SETTINGS_NAV_CARD_SUBTITLE_SP,
  SETTINGS_NAV_CARD_TITLE_SP,
} from '@ui/components/settings/SettingsNavigationCard';

import { androidReference } from '../helpers/androidReference';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GLASS_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuGlass.kt'),
  'utf8',
);
const TOKENS_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuTokens.kt'),
  'utf8',
);
const LIBRARY_KT = readFileSync(
  androidReference('app/src/main/java/com/example/library/LibraryScreen.kt'),
  'utf8',
);
const SETTINGS_KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/SettingsTabScreen.kt'),
  'utf8',
);

/** 把 Kotlin 片段压成单行空格，跨行声明也能用同一串做包含断言。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** 取 `fun <name>(...) { … }` 的顶层函数体（Kotlin 顶层 `}` 在行首）。 */
function kotlinFun(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `missing ${signature}`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf('\n}');
  const body = end === -1 ? rest : rest.slice(0, end + 2);
  return squeeze(body);
}

/** `WenkuTokens.PillHeight` 之类的 `val X: Dp = N.dp` 取数。 */
function tokenDp(source: string, name: string): number {
  const match = new RegExp(`val ${name}: Dp = ([\\d.]+)\\.dp`).exec(source);
  expect(match, `missing token ${name}`).not.toBeNull();
  return Number(match?.[1]);
}

describe('WenkuGlass.kt 控件原语：常量与 Kotlin 字面量逐条对齐', () => {
  it('WenkuIconButton（L236-312）', () => {
    const body = kotlinFun(GLASS_KT, 'fun WenkuIconButton(');
    expect(body).toContain('size(WenkuTokens.IconButtonSize)');
    expect(body).toContain('clip(WenkuTokens.iconButtonShape)');
    expect(body).toContain('targetValue = if (pressed && enabled && !a11y.reduceMotion) 0.97f else 1f');
    expect(body).toContain('.copy(alpha = if (enabled) 1f else .35f)');
    expect(body).toContain(
      'ink.copy(alpha = if (wenkuColors().isDark) 0.06f else 0.04f)',
    );
    expect(body).toContain('size = WenkuTokens.IconGlyph');

    expect(WENKU_ICON_BUTTON_SIZE_PX).toBe(tokenDp(TOKENS_KT, 'IconButtonSize'));
    expect(WENKU_ICON_BUTTON_GLYPH_PX).toBe(tokenDp(TOKENS_KT, 'IconGlyph'));
    expect(WENKU_ICON_BUTTON_RADIUS_PX).toBe(24); // WenkuTokens.kt L52 IconButtonRadius
    expect(WENKU_ICON_BUTTON_PRESS_SCALE).toBe(0.97);
    expect(WENKU_ICON_BUTTON_DISABLED_ALPHA).toBe(0.35);
    expect(WENKU_ICON_BUTTON_REST_ALPHA_DARK).toBe(0.06);
    expect(WENKU_ICON_BUTTON_REST_ALPHA_LIGHT).toBe(0.04);
  });

  it('WenkuTextButton（L319-412，119 处调用）', () => {
    const body = kotlinFun(GLASS_KT, 'fun WenkuTextButton(');
    expect(body).toContain('shape = RoundedCornerShape(22.dp)');
    expect(body).toContain('contentPadding = PaddingValues(horizontal = if (compact) 10.dp else 14.dp)');
    expect(body).toContain('heightIn(min = 48.dp)');
    expect(body).toContain('fontSize = 14.sp');
    expect(body).toContain('fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium');
    expect(body).toContain('size = 18.dp');
    expect(body).toContain('Spacer(Modifier.size(8.dp))');
    expect(body).toContain('.copy(alpha = if (enabled) 1f else .35f)');
    expect(body).toContain(
      'androidx.compose.ui.graphics.lerp( colors.panel, androidx.compose.material3.MaterialTheme.colorScheme.primary, .17f )',
    );

    expect(WENKU_TEXT_BUTTON_RADIUS_PX).toBe(22);
    expect(WENKU_TEXT_BUTTON_MIN_HEIGHT_PX).toBe(tokenDp(TOKENS_KT, 'TextButtonMinHeight'));
    expect(WENKU_TEXT_BUTTON_PADDING_COMPACT_PX).toBe(10);
    expect(WENKU_TEXT_BUTTON_PADDING_PX).toBe(14);
    expect(WENKU_TEXT_BUTTON_LABEL_SP).toBe(14);
    expect(WENKU_TEXT_BUTTON_GLYPH_PX).toBe(18);
    expect(WENKU_TEXT_BUTTON_GAP_PX).toBe(8);
    expect(WENKU_TEXT_BUTTON_DISABLED_ALPHA).toBe(0.35);
    expect(WENKU_TEXT_BUTTON_SELECTED_FRACTION).toBe(0.17);
    expect(WENKU_TEXT_BUTTON_BORDER_PX).toBe(0.7); // L209 border(0.7.dp, …)
  });

  it('WenkuSearchField（L503-582）', () => {
    const body = kotlinFun(GLASS_KT, 'fun WenkuSearchField(');
    expect(body).toContain('shape = RoundedCornerShape(24.dp)');
    expect(body).toContain('contentPadding = PaddingValues(0.dp)');
    expect(body).toContain('heightIn(min = 46.dp)');
    expect(body).toContain('size(width = 44.dp, height = 46.dp)');
    expect(body).toContain('WenkuSymbol.Search, size = 19.dp, tint = colors.inkSecondary');
    expect(body).toContain('padding(vertical = 8.dp)');
    expect(body).toContain('fontSize = 14.sp');
    expect(body).toContain('lineHeight = 18.sp');
    expect(body).toContain('Modifier.size(40.dp)');
    expect(body).toContain('Spacer(Modifier.size(12.dp))');
    expect(body).toContain('tr("清空搜索")');
    expect(body).toContain('tr("收起搜索")');

    expect(WENKU_SEARCH_FIELD_RADIUS_PX).toBe(24);
    expect(WENKU_SEARCH_FIELD_MIN_HEIGHT_PX).toBe(46);
    expect(WENKU_SEARCH_FIELD_LEADING_WIDTH_PX).toBe(44);
    expect(WENKU_SEARCH_FIELD_ICON_PX).toBe(19);
    expect(WENKU_SEARCH_FIELD_TEXT_SP).toBe(14);
    expect(WENKU_SEARCH_FIELD_LINE_HEIGHT_SP).toBe(18);
    expect(WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX).toBe(8);
    expect(WENKU_SEARCH_FIELD_ACTION_SIZE_PX).toBe(40);
    expect(WENKU_SEARCH_FIELD_TRAILING_SPACER_PX).toBe(12);
    expect(WENKU_SEARCH_CLEAR_LABEL).toBe('清空搜索');
    expect(WENKU_SEARCH_COLLAPSE_LABEL).toBe('收起搜索');
  });

  it('WenkuExpandableSearch（L437-500）', () => {
    const body = kotlinFun(GLASS_KT, 'fun BoxScope.WenkuExpandableSearch(');
    expect(body).toContain('tr("搜索书架")');
    expect(body).toContain('scaleX = 1f - (5f / 24f) * compactFraction');
    expect(body).toContain('val minWidth = 46.dp.roundToPx().coerceAtMost(fullWidth)');
    expect(body).toContain('scaleX = 1f + .026f * wobble');
    expect(body).toContain('scaleY = 1f - .042f * wobble');
    expect(body).toContain('transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, .5f)');
    expect(body).toContain('.clip(RoundedCornerShape(24.dp))');

    expect(WENKU_SEARCH_OPEN_LABEL).toBe('搜索书架');
    expect(WENKU_SEARCH_COMPACT_SCALE_STEP).toBe(5 / 24);
    expect(WENKU_SEARCH_MIN_WIDTH_PX).toBe(46);
    expect(WENKU_SEARCH_WOBBLE_SCALE_X).toBe(0.026);
    expect(WENKU_SEARCH_WOBBLE_SCALE_Y).toBe(0.042);
  });

  it('WenkuPillButton（L586-648，6 处调用）', () => {
    const body = kotlinFun(GLASS_KT, 'fun WenkuPillButton(');
    expect(body).toContain('height(WenkuTokens.PillHeight)');
    expect(body).toContain('widthIn(min = if (primary) 148.dp else 106.dp)');
    expect(body).toContain('clip(WenkuTokens.pillShape)');
    expect(body).toContain('background(base.copy(alpha = if (enabled) 1f else 0.42f))');
    expect(body).toContain(
      'border(0.7.dp, colors.ink.copy(alpha = if (primary) 0.08f else 0.12f), WenkuTokens.pillShape)',
    );
    expect(body).toContain('padding(horizontal = 22.dp)');
    expect(body).toContain('WenkuButtonGlyph(icon, 18.dp, fg)');
    expect(body).toContain('Spacer(Modifier.size(8.dp))');
    expect(body).toContain('fontSize = 15.sp');
    expect(body).toContain('fontWeight = FontWeight.Bold');
    expect(body).toContain('targetValue = if (pressed && enabled && !a11y.reduceMotion) 0.975f else 1f');

    expect(WENKU_PILL_HEIGHT_PX).toBe(tokenDp(TOKENS_KT, 'PillHeight'));
    expect(WENKU_PILL_RADIUS_PX).toBe(22); // WenkuTokens.kt L53 PillRadius
    expect(WENKU_PILL_MIN_WIDTH_PRIMARY_PX).toBe(148);
    expect(WENKU_PILL_MIN_WIDTH_SECONDARY_PX).toBe(106);
    expect(WENKU_PILL_DISABLED_ALPHA).toBe(0.42);
    expect(WENKU_PILL_BORDER_PX).toBe(0.7);
    expect(WENKU_PILL_BORDER_ALPHA_PRIMARY).toBe(0.08);
    expect(WENKU_PILL_BORDER_ALPHA_SECONDARY).toBe(0.12);
    expect(WENKU_PILL_PADDING_PX).toBe(22);
    expect(WENKU_PILL_GLYPH_PX).toBe(18);
    expect(WENKU_PILL_GAP_PX).toBe(8);
    expect(WENKU_PILL_LABEL_SP).toBe(15);
    expect(WENKU_PILL_PRESS_SCALE).toBe(0.975);
  });

  it('WenkuJellyTapSurface（L651-677）与 WenkuMenu（L716-731）', () => {
    const jelly = kotlinFun(GLASS_KT, 'fun WenkuJellyTapSurface(');
    expect(jelly).toContain('targetValue = if (pressed && enabled && !a11y.reduceMotion) 0.985f else 1f');
    expect(jelly).toContain('pullOutClickable(');
    expect(WENKU_JELLY_TAP_PRESS_SCALE).toBe(0.985);

    const menu = kotlinFun(GLASS_KT, 'fun WenkuMenu(');
    expect(menu).toContain('widthIn(min = WenkuTokens.MenuWidth, max = WenkuTokens.MenuMaxOverlayWidth)');
    expect(menu).toContain('clip(WenkuTokens.shapes.Menu)');
    expect(menu).toContain('background(colors.panel)');
    expect(menu).toContain('border(0.7.dp, colors.outline.copy(alpha = 0.5f), WenkuTokens.shapes.Menu)');
    expect(menu).toContain('padding(vertical = 4.dp)');

    expect(WENKU_MENU_PANEL_WIDTH_PX).toBe(tokenDp(TOKENS_KT, 'MenuWidth'));
    expect(WENKU_MENU_PANEL_MAX_WIDTH_PX).toBe(tokenDp(TOKENS_KT, 'MenuMaxOverlayWidth'));
    expect(WENKU_MENU_PANEL_RADIUS_PX).toBe(4); // WenkuTokens.kt L55 MenuRadius
    expect(WENKU_MENU_PANEL_BORDER_PX).toBe(0.7);
    expect(WENKU_MENU_PANEL_BORDER_ALPHA).toBe(0.5);
    expect(WENKU_MENU_PANEL_PADDING_Y_PX).toBe(4);
  });

  it('按下/释放时长来自 contactSpec / settleSpec（WenkuTokens.kt L179-197）', () => {
    expect(squeeze(TOKENS_KT)).toContain('const val CONTACT_MS = 120');
    expect(squeeze(TOKENS_KT)).toContain('const val ENTER_MS = 420');
    expect(WENKU_PRESS_MS).toBe(120);
    expect(WENKU_SETTLE_MS).toBe(420);
  });
});

describe('LibrarySearchNotice（LibraryScreen.kt L1195-1231）', () => {
  const body = kotlinFun(LIBRARY_KT, 'private fun LibrarySearchNotice(');

  it('GlassCard 参数与三段间距', () => {
    expect(body).toContain('shape = MaterialTheme.shapes.large');
    expect(body).toContain('tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.90f)');
    expect(body).toContain('contentPadding = PaddingValues(14.dp)');
    expect(body).toContain('horizontalArrangement = Arrangement.spacedBy(12.dp)');
    expect(body).toContain('modifier = Modifier.size(54.dp)');
    expect(body).toContain('verticalArrangement = Arrangement.spacedBy(3.dp)');
    expect(body).toContain('Spacer(Modifier.height(8.dp))');
    expect(body).toContain('compact = true');
    expect(body).toContain('MascotSpriteSheet.readingDrawable');
    expect(body).toContain('style = MaterialTheme.typography.titleMedium');
    expect(body).toContain('style = MaterialTheme.typography.bodySmall');

    // Material3 默认 shapes.large = 16.dp（`Theme.kt` 没有覆盖 `Shapes`）。
    expect(LIBRARY_SEARCH_NOTICE_RADIUS_PX).toBe(16);
    expect(LIBRARY_SEARCH_NOTICE_PADDING_PX).toBe(14);
    expect(LIBRARY_SEARCH_NOTICE_SURFACE_ALPHA).toBe(0.9);
    expect(LIBRARY_SEARCH_NOTICE_ROW_GAP_PX).toBe(12);
    expect(LIBRARY_SEARCH_NOTICE_MASCOT_PX).toBe(54);
    expect(LIBRARY_SEARCH_NOTICE_TEXT_GAP_PX).toBe(3);
    expect(LIBRARY_SEARCH_NOTICE_ACTION_GAP_PX).toBe(8);
    expect(LIBRARY_SEARCH_NOTICE_MASCOT_ASSET).toBe('mascot_reading');
  });

  it('两个调用点的 testTag 与图标（L958-978）', () => {
    expect(squeeze(LIBRARY_KT)).toContain('"search_error_state"');
    expect(squeeze(LIBRARY_KT)).toContain('"search_empty_state"');
    expect(squeeze(LIBRARY_KT)).toContain(
      'symbol = if (error is LibraryError.AuthenticationRequired) WenkuSymbol.Shield else WenkuSymbol.Refresh',
    );
    expect(squeeze(LIBRARY_KT)).toContain('symbol = WenkuSymbol.Folder');
  });
});

describe('SettingsNavigationCard（SettingsTabScreen.kt L1232-1256）', () => {
  const body = kotlinFun(SETTINGS_KT, 'private fun SettingsNavigationCard(');

  it('卡片与行内几何', () => {
    expect(body).toContain('shape = RoundedCornerShape(16.dp)');
    expect(body).toContain('padding(16.dp)');
    expect(body).toContain('WenkuIcon(symbol, size = 24.dp, tint = colors.primary, entrance = false)');
    expect(body).toContain('Spacer(Modifier.width(12.dp))');
    expect(body).toContain('fontWeight = FontWeight.SemiBold, fontSize = 15.sp');
    expect(body).toContain('style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant');
    expect(body).toContain('WenkuIcon(WenkuSymbol.Forward, size = 18.dp');
    expect(body).toContain('colors.onSurfaceVariant.copy(alpha = .6f)');
    expect(body).toContain('wenkuTabTitle(2, strength = .55f)');

    expect(SETTINGS_NAV_CARD_RADIUS_PX).toBe(16);
    expect(SETTINGS_NAV_CARD_PADDING_PX).toBe(16);
    expect(SETTINGS_NAV_CARD_GAP_PX).toBe(12);
    expect(SETTINGS_NAV_CARD_ICON_PX).toBe(24);
    expect(SETTINGS_NAV_CARD_CHEVRON_PX).toBe(18);
    expect(SETTINGS_NAV_CARD_CHEVRON_ALPHA).toBe(0.6);
    expect(SETTINGS_NAV_CARD_TITLE_SP).toBe(15);
    expect(SETTINGS_NAV_CARD_SUBTITLE_SP).toBe(12);
    expect(SETTINGS_NAV_CARD_SUBTITLE_LINE_SP).toBe(16);
  });

  it('6 个生产调用点的 testTag 与图标', () => {
    expect(squeeze(SETTINGS_KT)).toContain('testTag("device_transfer_entry")');
    expect(squeeze(SETTINGS_KT)).toContain('testTag("library_help_entry_card")');
    expect(squeeze(SETTINGS_KT)).toContain('str.t("发现设置"), symbol = WenkuSymbol.Discover');
    expect(squeeze(SETTINGS_KT)).toContain('symbol = WenkuSymbol.Folder,');
    expect(squeeze(SETTINGS_KT)).toContain('WenkuSymbol.Help,');
    expect(squeeze(SETTINGS_KT)).toContain('WenkuSymbol.Layers,');
    expect(squeeze(SETTINGS_KT)).toContain('WenkuSymbol.Brightness,');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
 * 渲染层：几何真的落在 DOM 上（Kotlin 值 → CSS px）
 * ═══════════════════════════════════════════════════════════════════════════════ */

describe('渲染出来的按钮几何', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('WenkuTextButton：48 最小高 / 22 圆角 / 14px 文案 / compact 10px 内边距', () => {
    act(() => {
      root.render(<WenkuTextButton text="导入" onClick={() => {}} compact />);
    });
    const button = container.querySelector('button.wenku-text-button');
    expect(button).not.toBeNull();
    const style = (button as HTMLElement).style;
    expect(style.minHeight).toBe(`${String(WENKU_TEXT_BUTTON_MIN_HEIGHT_PX)}px`);
    expect(style.borderRadius).toBe(`${String(WENKU_TEXT_BUTTON_RADIUS_PX)}px`);
    expect(style.paddingLeft).toBe(`${String(WENKU_TEXT_BUTTON_PADDING_COMPACT_PX)}px`);
    expect(style.paddingRight).toBe(`${String(WENKU_TEXT_BUTTON_PADDING_COMPACT_PX)}px`);
    const label = container.querySelector('.wenku-text-button__label') as HTMLElement | null;
    expect(label?.textContent).toBe('导入');
    expect(label?.style.fontSize).toBe(`${String(WENKU_TEXT_BUTTON_LABEL_SP)}px`);
    expect(label?.style.fontWeight).toBe('500');
  });

  it('WenkuTextButton：选中态 Bold + 图标 18px', () => {
    act(() => {
      root.render(<WenkuTextButton text="已选" onClick={() => {}} selected symbol="Check" />);
    });
    const label = container.querySelector('.wenku-text-button__label') as HTMLElement | null;
    expect(label?.style.fontWeight).toBe('700');
    const gap = container.querySelector('.wenku-text-button__gap') as HTMLElement | null;
    expect(gap?.style.width).toBe(`${String(WENKU_TEXT_BUTTON_GAP_PX)}px`);
    expect(container.querySelector('button.wenku-text-button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('WenkuTextButton：禁用时 disabled + 文案 alpha .35', () => {
    act(() => {
      root.render(<WenkuTextButton text="禁用" onClick={() => {}} enabled={false} />);
    });
    const button = container.querySelector('button.wenku-text-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const label = container.querySelector('.wenku-text-button__label') as HTMLElement | null;
    expect(label?.style.color).toContain(String(WENKU_TEXT_BUTTON_DISABLED_ALPHA));
  });

  it('WenkuPillButton：54 高 / 148 最小宽 / 22 圆角 / 22 内边距 / 15px Bold', () => {
    act(() => {
      root.render(<WenkuPillButton text="开始" onClick={() => {}} />);
    });
    const button = container.querySelector('button.wenku-pill-button') as HTMLElement;
    expect(button.style.height).toBe(`${String(WENKU_PILL_HEIGHT_PX)}px`);
    expect(button.style.minWidth).toBe(`${String(WENKU_PILL_MIN_WIDTH_PRIMARY_PX)}px`);
    expect(button.style.borderRadius).toBe(`${String(WENKU_PILL_RADIUS_PX)}px`);
    expect(button.style.paddingLeft).toBe(`${String(WENKU_PILL_PADDING_PX)}px`);
    const label = container.querySelector('.wenku-pill-button__label') as HTMLElement | null;
    expect(label?.textContent).toBe('开始');
    expect(label?.style.fontSize).toBe(`${String(WENKU_PILL_LABEL_SP)}px`);
    expect(label?.style.fontWeight).toBe('700');
  });

  it('WenkuPillButton：次态 106 最小宽 + 0.42 禁用底', () => {
    act(() => {
      root.render(<WenkuPillButton text="取消" onClick={() => {}} primary={false} enabled={false} />);
    });
    const button = container.querySelector('button.wenku-pill-button') as HTMLButtonElement;
    expect(button.style.minWidth).toBe(`${String(WENKU_PILL_MIN_WIDTH_SECONDARY_PX)}px`);
    expect(button.style.background).toContain(String(WENKU_PILL_DISABLED_ALPHA));
    expect(button.disabled).toBe(true);
  });

  it('WenkuSearchField：空值出 hint / 非空出清空按钮 / onClose 决定收起按钮', () => {
    act(() => {
      root.render(<WenkuSearchField value="" onValueChange={() => {}} hint="搜索书名" />);
    });
    expect(container.querySelector('.wenku-search-field__hint')?.textContent).toBe('搜索书名');
    expect(container.querySelector('input.wenku-search-field__input')?.getAttribute('enterkeyhint')).toBe('search');
    expect(container.querySelector(`[aria-label="${WENKU_SEARCH_CLEAR_LABEL}"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${WENKU_SEARCH_COLLAPSE_LABEL}"]`)).toBeNull();

    act(() => {
      root.render(<WenkuSearchField value="三体" onValueChange={() => {}} hint="搜索书名" onClose={() => {}} />);
    });
    expect(container.querySelector('.wenku-search-field__hint')).toBeNull();
    expect(container.querySelector(`[aria-label="${WENKU_SEARCH_CLEAR_LABEL}"]`)).not.toBeNull();
    expect(container.querySelector(`[aria-label="${WENKU_SEARCH_COLLAPSE_LABEL}"]`)).not.toBeNull();
    const input = container.querySelector('input.wenku-search-field__input') as HTMLInputElement;
    expect(input.value).toBe('三体');
    expect(input.style.fontSize).toBe(`${String(WENKU_SEARCH_FIELD_TEXT_SP)}px`);
    expect(input.style.lineHeight).toBe(`${String(WENKU_SEARCH_FIELD_LINE_HEIGHT_SP)}px`);
  });

  it('WenkuIconButton：46 盒 / 24 圆角 / 禁用 .35 glyph', () => {
    act(() => {
      root.render(<WenkuIconButton symbol="Search" contentDescription="搜索" onClick={() => {}} />);
    });
    const button = container.querySelector('button.wenku-icon-button') as HTMLElement;
    expect(button.style.width).toBe(`${String(WENKU_ICON_BUTTON_SIZE_PX)}px`);
    expect(button.style.height).toBe(`${String(WENKU_ICON_BUTTON_SIZE_PX)}px`);
    expect(button.style.borderRadius).toBe(`${String(WENKU_ICON_BUTTON_RADIUS_PX)}px`);
    expect(button.getAttribute('aria-label')).toBe('搜索');

    act(() => {
      root.render(
        <WenkuIconButton symbol="Search" contentDescription="搜索" enabled={false} onClick={() => {}} />,
      );
    });
    expect((container.querySelector('button.wenku-icon-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

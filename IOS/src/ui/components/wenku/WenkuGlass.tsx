/**
 * Wenku 玻璃面 —— `ui/wenku/WenkuGlass.kt` L85-232（`WenkuGlassSurface`）的 CSS 版。
 *
 * Kotlin → TS 映射
 * ─────────────────
 *   L101-113  pressed → contact（contact 120ms / settle 240ms）  → CSS `:active` + `--motion-fast`
 *   L152-159  实时模糊判定 + surfaceTint（dark .86 / light .72）  → `--wenku-glass-surface`（wenku.css）
 *   L166-198  drawBackdrop(blur / lens) + 0.7dp 描边            → `backdrop-filter` + `border`
 *   L199-210  无实时模糊回退：elevation 4dp + ambient .05/spot .10 → `box-shadow`
 *   L211-231  pullOutClickable + 内容槽                          → `role` + children
 *
 * 未移植：`kashif_e.backdrop` 的 `lens(refraction 12/18dp)` 边缘折射（依赖 RenderEffect，
 * Web 无等价能力；`backdrop-filter` 已给出模糊与饱和度）。
 *
 * `RenderQuality.MAX` 的边缘折射在 Web 端没有对应实现，故 `cardTweaks` 不参与本组件。
 *
 * 同一 Kotlin 文件里的其余控件原语也收在本文件（一个 Kotlin 文件 ↔ 一个 TS 文件）：
 *   L236-312 `WenkuIconButton`       → `WenkuIconButton`
 *   L319-412 `WenkuTextButton`       → `WenkuTextButton`
 *   L437-500 `WenkuExpandableSearch` → `WenkuExpandableSearch`
 *   L503-582 `WenkuSearchField`      → `WenkuSearchField`
 *   L586-648 `WenkuPillButton`       → `WenkuPillButton`
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

import { WENKU_CONTROL_DP, WENKU_MOTION, WENKU_RADII_DP, WENKU_TOKENS } from '@core/wenku/tokens';
import { useAppHaptics } from '../feedback/Motion';
import { WenkuIcon } from './WenkuIcon';
import type { WenkuSymbol } from './WenkuIcon';
import '../../../styles/wenku.css';

/** \`blur: Dp = 16.dp\`（WenkuGlass.kt L203）。 */
export const WENKU_GLASS_BLUR_PX = 16;
/** \`WenkuTokens.GlassRadius = 28.dp\`。 */
export const WENKU_GLASS_RADIUS_PX = 28;
/** \`consistentShadow(elevation = 4.dp, ambient .05, spot .10)\`（L201-206）。 */
export const WENKU_GLASS_ELEVATION_PX = 4;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari 13 之前只有 addListener；保留以对齐项目既有写法。
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * 系统「减少动态效果」。与 Kotlin \`rememberWenkuAccessibility().reduceMotion\` 同义：
 * 组件据此跳过入场/惯性/飞行，但**保留**布局与最终几何。
 */
export function useWenkuReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/** 运行时是否允许实时毛玻璃（\`backdrop-filter\` 支持检测，避免旧内核整块糊成灰）。 */
export function wenkuBlurSupported(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return false;
  if (typeof CSS.supports !== 'function') return false;
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

export interface WenkuGlassProps {
  readonly children?: ReactNode;
  /** \`WenkuGlassSurface\` 的 \`onClick\`：非 null 时整块可点并带 0.97 按压缩放。 */
  readonly onClick?: () => void;
  /** 传了就整套换成 `background`（\`tint != null\` 分支，L156）。 */
  readonly tint?: string;
  /** \`blur\`（dp → px），默认 16。传 0 等价关闭实时模糊。 */
  readonly blur?: number;
  /** 圆角，默认 28（\`WenkuTokens.GlassRadius\`）。 */
  readonly radius?: number;
  /** 去掉 elevation 阴影（用于本来就贴在别的玻璃面上的层）。 */
  readonly flat?: boolean;
  /** 高对比/禁用模糊：退回 \`panel@.95\` 不透明底（L158）。 */
  readonly solid?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 玻璃面容器。Kotlin 里它是个 \`Column\`（L223-231）；Web 端用 \`div\` 并保留
 * \`display: flex; flex-direction: column\` 的内容槽，子元素排布与 Compose 一致。
 */
export function WenkuGlass(props: WenkuGlassProps) {
  const reduceMotion = useWenkuReducedMotion();
  const interactive = typeof props.onClick === 'function';
  const solid = props.solid === true || props.blur === 0 || !wenkuBlurSupported();
  const blurPx = props.blur ?? WENKU_GLASS_BLUR_PX;
  const radiusPx = props.radius ?? WENKU_GLASS_RADIUS_PX;

  const classNames = ['wenku-glass'];
  if (interactive && !reduceMotion) classNames.push('wenku-glass--interactive');
  if (props.flat === true) classNames.push('wenku-glass--flat');
  if (solid || reduceMotion) classNames.push('wenku-glass--solid');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style: CSSProperties = {
    borderRadius: `${radiusPx}px`,
    ['--wenku-glass-blur' as string]: `${blurPx}px`,
    ['--wenku-glass-radius' as string]: `${radiusPx}px`,
    display: 'flex',
    flexDirection: 'column',
    ...(props.tint !== undefined ? { background: props.tint } : null),
    ...props.style,
  } as CSSProperties;

  if (!interactive) {
    return (
      <div className={classNames.join(' ')} style={style} data-testid={props.testId}>
        {props.children}
      </div>
    );
  }
  return (
    <div
      className={classNames.join(' ')}
      style={style}
      role="button"
      tabIndex={0}
      data-testid={props.testId}
      onClick={() => props.onClick?.()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onClick?.();
      }}
    >
      {props.children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 颜色 / 主题工具（`wenkuColors()` 的逐字搬运，`WenkuTokens.kt` L240-266）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `0xAARRGGBB` + alpha → CSS `rgba()`；alpha 走浮点，不经 8 位量化。 */
export function wenkuTint(color: number, alpha: number): string {
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(Number(alpha.toFixed(4)))})`;
}

/** `wenkuColors().paper`（`WenkuTokens.kt` L32 / L38）。 */
export function wenkuPaper(dark: boolean): number {
  return dark ? WENKU_TOKENS.paperDark : WENKU_TOKENS.paperLight;
}

/** `wenkuColors().panel`（L33 / L40）。 */
export function wenkuPanel(dark: boolean): number {
  return dark ? WENKU_TOKENS.panelDark : WENKU_TOKENS.panelLight;
}

/** `wenkuColors().ink`（L35 / L44）。 */
export function wenkuInk(dark: boolean): number {
  return dark ? WENKU_TOKENS.inkDark : WENKU_TOKENS.inkLight;
}

/** `wenkuColors().inkSecondary`（L36 / L45）。 */
export function wenkuInkSecondary(dark: boolean): number {
  return dark ? WENKU_TOKENS.inkSecondaryDark : WENKU_TOKENS.inkSecondaryLight;
}

/** `wenkuColors().raised`（`RaisedDark` L41 / `Color(0xFFF7F5EF)` L258）。 */
export function wenkuRaised(dark: boolean): number {
  return dark ? WENKU_TOKENS.raisedDark : WENKU_TOKENS.raisedLight;
}

/** `wenkuColors().outline`（L43 / L260）。 */
export function wenkuOutline(dark: boolean): number {
  return dark ? WENKU_TOKENS.outlineDark : WENKU_TOKENS.outlineLight;
}

function readDocumentDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function subscribeDocumentDark(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {};
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/**
 * `LocalAppDarkTheme`（`Theme.kt`）的 Web 等价物：`<html data-theme="dark">`
 * （`App.tsx` 写入）。`archiveShelf` / `WenkuSectionHeader` 用的是同一读法。
 */
export function useWenkuDark(): boolean {
  return useSyncExternalStore(subscribeDocumentDark, readDocumentDark, () => false);
}

/**
 * Kotlin 三处按钮都调 `performHapticFeedback(HapticFeedbackType.TextHandleMove)`
 * （`WenkuGlass.kt` L280 / L362 / L622）—— 一枚轻 tick，对应 `HAPTIC_TABLE.SELECTION`
 * 的 8ms / amplitude 48（`core/glass/motion.ts` L202）。
 */
const WENKU_TAP_HAPTIC = 'SELECTION' as const;

/* ═══════════════════════════════════════════════════════════════════════════════
 * WenkuIconButton —— `ui/wenku/WenkuGlass.kt` L236-312（14 处调用）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `WenkuTokens.IconButtonSize = 46.dp`（`WenkuTokens.kt` L73）。 */
export const WENKU_ICON_BUTTON_SIZE_PX = WENKU_CONTROL_DP.iconButtonSize;
/** `WenkuTokens.IconButtonRadius = 24.dp`（L52）。 */
export const WENKU_ICON_BUTTON_RADIUS_PX = WENKU_RADII_DP.iconButton;
/** `WenkuTokens.IconGlyph = 21.dp`（L75）。 */
export const WENKU_ICON_BUTTON_GLYPH_PX = WENKU_CONTROL_DP.iconGlyph;
/** `WenkuGlass.kt` L251 按下缩放。 */
export const WENKU_ICON_BUTTON_PRESS_SCALE = 0.97;
/** `WenkuGlass.kt` L289 禁用档 glyph alpha。 */
export const WENKU_ICON_BUTTON_DISABLED_ALPHA = 0.35;
/** `WenkuGlass.kt` L272 静止底：`ink.copy(alpha = isDark ? .06f : .04f)`。 */
export const WENKU_ICON_BUTTON_REST_ALPHA_DARK = 0.06;
export const WENKU_ICON_BUTTON_REST_ALPHA_LIGHT = 0.04;
/** `WenkuMotion.contactSpec()` 的时长（`WenkuTokens.kt` L122 `CONTACT_MS`）。 */
export const WENKU_PRESS_MS = WENKU_MOTION.contactMs;
/** `WenkuMotion.settleSpec()` 的时长（`WenkuTokens.kt` L123 `ENTER_MS`）。 */
export const WENKU_SETTLE_MS = WENKU_MOTION.enterMs;

export interface WenkuIconButtonProps {
  readonly symbol: WenkuSymbol;
  /** Kotlin `contentDescription`（`semantics { contentDescription = … }`，L300-302）。 */
  readonly contentDescription?: string;
  readonly onClick: () => void;
  /** 覆盖 `WenkuTokens.IconButtonSize`（调用点常写 `Modifier.size(40.dp)`）。 */
  readonly size?: number;
  /** `Color.Unspecified` 时用 `wenkuColors().ink`（L288）。 */
  readonly tint?: string;
  readonly enabled?: boolean;
  /** `a11y.highContrast`：底色换成不透明 `panel`（L272）。 */
  readonly highContrast?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 46×46、24px 圆角、`ink@.04`（暗色 `.06`）底、按下 0.97、禁用 glyph `@.35`。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L236-312。
 */
export function WenkuIconButton(props: WenkuIconButtonProps): ReactNode {
  const dark = useWenkuDark();
  const reduceMotion = useWenkuReducedMotion();
  const haptics = useAppHaptics();
  const enabled = props.enabled !== false;
  const box = props.size ?? WENKU_ICON_BUTTON_SIZE_PX;
  const ink = wenkuInk(dark);
  const restAlpha = dark ? WENKU_ICON_BUTTON_REST_ALPHA_DARK : WENKU_ICON_BUTTON_REST_ALPHA_LIGHT;
  const background =
    props.highContrast === true ? wenkuTint(wenkuPanel(dark), 1) : wenkuTint(ink, restAlpha);
  const glyphTint = props.tint ?? wenkuTint(ink, enabled ? 1 : WENKU_ICON_BUTTON_DISABLED_ALPHA);

  const classNames = ['wenku-icon-button'];
  if (reduceMotion) classNames.push('wenku-icon-button--static');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style: CSSProperties = {
    width: `${String(box)}px`,
    height: `${String(box)}px`,
    borderRadius: `${String(WENKU_ICON_BUTTON_RADIUS_PX)}px`,
    background,
    ...props.style,
  };

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      style={style}
      disabled={!enabled}
      aria-label={props.contentDescription}
      data-testid={props.testId}
      onClick={() => {
        if (!enabled) return;
        haptics.perform(WENKU_TAP_HAPTIC);
        props.onClick();
      }}
    >
      <WenkuIcon symbol={props.symbol} size={WENKU_ICON_BUTTON_GLYPH_PX} tint={glyphTint} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * WenkuTextButton —— `ui/wenku/WenkuGlass.kt` L319-412（119 处调用）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `RoundedCornerShape(22.dp)`（L354）= `WenkuTokens.TextButtonRadius`。 */
export const WENKU_TEXT_BUTTON_RADIUS_PX = WENKU_RADII_DP.textButton;
/** L370 `heightIn(min = 48.dp)`。 */
export const WENKU_TEXT_BUTTON_MIN_HEIGHT_PX = WENKU_CONTROL_DP.textButtonMinHeight;
/** L367 `PaddingValues(horizontal = if (compact) 10.dp else 14.dp)`。 */
export const WENKU_TEXT_BUTTON_PADDING_COMPACT_PX = 10;
export const WENKU_TEXT_BUTTON_PADDING_PX = 14;
/** L405 `fontSize = 14.sp`。 */
export const WENKU_TEXT_BUTTON_LABEL_SP = 14;
/** L378 `WenkuIcon(..., size = 18.dp)`。 */
export const WENKU_TEXT_BUTTON_GLYPH_PX = 18;
/** L384 / L399 `Spacer(Modifier.size(8.dp))`。 */
export const WENKU_TEXT_BUTTON_GAP_PX = 8;
/** L379 / L389 / L403 禁用档 alpha。 */
export const WENKU_TEXT_BUTTON_DISABLED_ALPHA = 0.35;
/** L355-357 选中态：`lerp(panel, primary, .17f)`。 */
export const WENKU_TEXT_BUTTON_SELECTED_FRACTION = 0.17;
/** L209 非实时描边 0.7dp / alpha 暗 .55、亮 .38。 */
export const WENKU_TEXT_BUTTON_BORDER_PX = 0.7;

export interface WenkuTextButtonProps {
  readonly text: string;
  readonly onClick: () => void;
  readonly selected?: boolean;
  readonly enabled?: boolean;
  /** Kotlin `wenkuSymbol`（`icon` 的 `ImageVector` 在 Web 端统一成 symbol）。 */
  readonly symbol?: WenkuSymbol;
  readonly compact?: boolean;
  /** `Color.Unspecified` 时用 `wenkuColors().ink`（L334）。 */
  readonly color?: string;
  readonly highContrast?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 22px 圆角 / 最小高 48 / 水平内边距 10（compact）或 14 / 14sp Medium（选中 Bold）/
 * 图标 18 + 8 间距 / 按下 0.97（contact 120ms → settle 420ms）/ 禁用整体 `.35`。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L319-412。
 */
export function WenkuTextButton(props: WenkuTextButtonProps): ReactNode {
  const dark = useWenkuDark();
  const reduceMotion = useWenkuReducedMotion();
  const haptics = useAppHaptics();
  const enabled = props.enabled !== false;
  const selected = props.selected === true;

  const ink = wenkuInk(dark);
  const panel = wenkuPanel(dark);
  const outline = wenkuOutline(dark);
  const alpha = enabled ? 1 : WENKU_TEXT_BUTTON_DISABLED_ALPHA;
  /**
   * `WenkuGlassSurface(blur = 0.dp)` ⇒ `realtime == false`，所以底色走 L157-158 的
   * `panel @ (dark .86 / light .72)`；选中态整体换成 L355-357 的 `lerp(panel, primary, .17)`。
   */
  const background = selected
    ? `color-mix(in srgb, ${wenkuTint(panel, 1)} 83%, var(--color-primary) 17%)`
    : props.highContrast === true
      ? wenkuTint(panel, 1)
      : wenkuTint(panel, dark ? 0.86 : 0.72);
  const borderColor = wenkuTint(outline, dark ? 0.55 : 0.38);

  const classNames = ['wenku-text-button'];
  if (enabled && !reduceMotion) classNames.push('wenku-text-button--interactive');
  if (selected) classNames.push('wenku-text-button--selected');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const padding = props.compact === true
    ? WENKU_TEXT_BUTTON_PADDING_COMPACT_PX
    : WENKU_TEXT_BUTTON_PADDING_PX;

  const style: CSSProperties = {
    minHeight: `${String(WENKU_TEXT_BUTTON_MIN_HEIGHT_PX)}px`,
    paddingLeft: `${String(padding)}px`,
    paddingRight: `${String(padding)}px`,
    borderRadius: `${String(WENKU_TEXT_BUTTON_RADIUS_PX)}px`,
    borderWidth: `${String(WENKU_TEXT_BUTTON_BORDER_PX)}px`,
    borderColor,
    background,
    ...props.style,
  };

  const glyphTint = props.color ?? wenkuTint(ink, alpha);

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      style={style}
      disabled={!enabled}
      role="button"
      aria-pressed={selected}
      data-testid={props.testId}
      onClick={() => {
        if (!enabled) return;
        haptics.perform(WENKU_TAP_HAPTIC);
        props.onClick();
      }}
    >
      <span className="wenku-text-button__row">
        {props.symbol === undefined ? null : (
          <>
            <WenkuIcon symbol={props.symbol} size={WENKU_TEXT_BUTTON_GLYPH_PX} tint={glyphTint} active={selected} />
            <span className="wenku-text-button__gap" style={{ width: `${String(WENKU_TEXT_BUTTON_GAP_PX)}px` }} />
          </>
        )}
        <span
          className="wenku-text-button__label"
          style={{
            color: props.color ?? wenkuTint(ink, alpha),
            fontSize: `${String(WENKU_TEXT_BUTTON_LABEL_SP)}px`,
            fontWeight: selected ? 700 : 500,
          }}
        >
          {props.text}
        </span>
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * WenkuSearchField / WenkuExpandableSearch —— `WenkuGlass.kt` L437-582
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** L517 `RoundedCornerShape(24.dp)`。 */
export const WENKU_SEARCH_FIELD_RADIUS_PX = 24;
/** L521 `heightIn(min = 46.dp)`。 */
export const WENKU_SEARCH_FIELD_MIN_HEIGHT_PX = 46;
/** L524 `Box(Modifier.size(width = 44.dp, height = 46.dp))`。 */
export const WENKU_SEARCH_FIELD_LEADING_WIDTH_PX = 44;
/** L525 `WenkuIcon(WenkuSymbol.Search, size = 19.dp)`。 */
export const WENKU_SEARCH_FIELD_ICON_PX = 19;
/** L535-536 `fontSize = 14.sp` / `lineHeight = 18.sp`。 */
export const WENKU_SEARCH_FIELD_TEXT_SP = 14;
export const WENKU_SEARCH_FIELD_LINE_HEIGHT_SP = 18;
/** L530 `.padding(vertical = 8.dp)`。 */
export const WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX = 8;
/** L565 / L574 `Modifier.size(40.dp)`。 */
export const WENKU_SEARCH_FIELD_ACTION_SIZE_PX = 40;
/** L578 `Spacer(Modifier.size(12.dp))`。 */
export const WENKU_SEARCH_FIELD_TRAILING_SPACER_PX = 12;
/** L562 / L572 / L456 的 `tr()` 文案。 */
export const WENKU_SEARCH_CLEAR_LABEL = '清空搜索';
export const WENKU_SEARCH_COLLAPSE_LABEL = '收起搜索';
export const WENKU_SEARCH_OPEN_LABEL = '搜索书架';
/** L493 `46.dp.roundToPx()`：展开前的最小宽度。 */
export const WENKU_SEARCH_MIN_WIDTH_PX = 46;
/** L459 `1f - (5f / 24f) * compactFraction`。 */
export const WENKU_SEARCH_COMPACT_SCALE_STEP = 5 / 24;
/** L485-488 展开时的果冻形变系数。 */
export const WENKU_SEARCH_WOBBLE_SCALE_X = 0.026;
export const WENKU_SEARCH_WOBBLE_SCALE_Y = 0.042;

export interface WenkuSearchFieldProps {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly hint: string;
  readonly enabled?: boolean;
  /** Kotlin `onClose: (() -> Unit)? = null` —— 传了才出「收起搜索」按钮。 */
  readonly onClose?: () => void;
  /** Kotlin focusRequester.requestFocus(): mount/expand 完成后自动聚焦。 */
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 24px 圆角玻璃搜索框：44×46 前置搜索图标 + 14sp/18sp 单行输入 + 清空 + 收起。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L503-582。
 */
export function WenkuSearchField(props: WenkuSearchFieldProps): ReactNode {
  const dark = useWenkuDark();
  const enabled = props.enabled !== false;
  const inputEl = useRef<HTMLInputElement | null>(null);
  const autoFocus = props.autoFocus === true;
  useEffect(() => {
    if (!autoFocus) return;
    inputEl.current?.focus();
  }, [autoFocus]);
  const ink = wenkuInk(dark);
  const inkSecondary = wenkuInkSecondary(dark);

  const classNames = ['wenku-search-field'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  return (
    <WenkuGlass
      radius={WENKU_SEARCH_FIELD_RADIUS_PX}
      className={classNames.join(' ')}
      {...(props.testId === undefined ? null : { testId: props.testId })}
    >
      <div className="wenku-search-field__row" style={props.style}>
        <span
          className="wenku-search-field__leading"
          style={{
            width: `${String(WENKU_SEARCH_FIELD_LEADING_WIDTH_PX)}px`,
            height: `${String(WENKU_SEARCH_FIELD_MIN_HEIGHT_PX)}px`,
          }}
        >
          <WenkuIcon symbol="Search" size={WENKU_SEARCH_FIELD_ICON_PX} tint={wenkuTint(inkSecondary, 1)} />
        </span>
        <span className="wenku-search-field__input-wrap">
          {props.value === '' ? (
            <span
              className="wenku-search-field__hint"
              style={{ color: wenkuTint(inkSecondary, 1), fontSize: `${String(WENKU_SEARCH_FIELD_TEXT_SP)}px` }}
            >
              {props.hint}
            </span>
          ) : null}
          <input
            ref={inputEl}
            className="wenku-search-field__input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={props.value}
            disabled={!enabled}
            aria-label={props.hint}
            onChange={(event) => props.onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.currentTarget.blur();
            }}
            style={{
              color: wenkuTint(ink, 1),
              caretColor: wenkuTint(ink, 1),
              fontSize: `${String(WENKU_SEARCH_FIELD_TEXT_SP)}px`,
              lineHeight: `${String(WENKU_SEARCH_FIELD_LINE_HEIGHT_SP)}px`,
              paddingTop: `${String(WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX)}px`,
              paddingBottom: `${String(WENKU_SEARCH_FIELD_INPUT_PADDING_Y_PX)}px`,
            }}
          />
        </span>
        {props.value === '' ? null : (
          <WenkuIconButton
            symbol="CloseCircle"
            contentDescription={WENKU_SEARCH_CLEAR_LABEL}
            size={WENKU_SEARCH_FIELD_ACTION_SIZE_PX}
            enabled={enabled}
            onClick={() => props.onValueChange('')}
          />
        )}
        {props.onClose === undefined ? (
          <span
            className="wenku-search-field__spacer"
            style={{ width: `${String(WENKU_SEARCH_FIELD_TRAILING_SPACER_PX)}px` }}
          />
        ) : (
          <WenkuIconButton
            symbol="Close"
            contentDescription={WENKU_SEARCH_COLLAPSE_LABEL}
            size={WENKU_SEARCH_FIELD_ACTION_SIZE_PX}
            enabled={enabled}
            onClick={props.onClose}
          />
        )}
      </div>
    </WenkuGlass>
  );
}

export interface WenkuExpandableSearchProps {
  readonly expanded: boolean;
  /** Kotlin `motion: State<Float>` 的当前值（0 → 收起，1 → 全宽）。 */
  readonly motion: number;
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly hint: string;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** Kotlin focusRequester.requestFocus(): mount/expand 完成后自动聚焦。 */
  readonly autoFocus?: boolean;
  /** L446 `compactFraction`：未展开时图标的额外收缩量。 */
  readonly compactFraction?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * 右锚点展开：未展开只留 46px 图标，展开后拉到容器全宽。
 *
 * 宽度近似：Kotlin 在 `layout{}` 里 `lerp(46dp, fullWidth, ease(p))`，Web 端没有
 * 同步测量，改用 `width: p·100%（min-width 46px）`。终态一致（100% ⇔ fullWidth），
 * 中间段比 Kotlin 略快一点（46px 兜底把 0..5% 压平），几何终值与入口行为相同。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L437-500。
 */
export function WenkuExpandableSearch(props: WenkuExpandableSearchProps): ReactNode {
  const reduceMotion = useWenkuReducedMotion();
  const mounted = props.expanded || props.motion > 0;

  if (!mounted) {
    const compact = props.compactFraction ?? 0;
    const scale = 1 - WENKU_SEARCH_COMPACT_SCALE_STEP * compact;
    return (
      <WenkuIconButton
        symbol="Search"
        contentDescription={WENKU_SEARCH_OPEN_LABEL}
        size={WENKU_SEARCH_MIN_WIDTH_PX}
        onClick={props.onOpen}
        className={['wenku-expandable-search__open', props.className].filter(Boolean).join(' ')}
        style={{ transform: `scale(${String(Number(scale.toFixed(4)))})` }}
      />
    );
  }

  const p = Math.max(0, Math.min(1, props.motion));
  const jelly = Math.sin(3 * Math.PI * p) * (1 - p) * (1 - p);
  const scaleX = 1 + WENKU_SEARCH_WOBBLE_SCALE_X * jelly;
  const scaleY = 1 - WENKU_SEARCH_WOBBLE_SCALE_Y * jelly;
  const motionStyle: CSSProperties = reduceMotion
    ? { width: '100%', minWidth: `${String(WENKU_SEARCH_MIN_WIDTH_PX)}px` }
    : {
        width: `${String(Number((p * 100).toFixed(2)))}%`,
        minWidth: `${String(WENKU_SEARCH_MIN_WIDTH_PX)}px`,
        transform: `scale(${String(Number(scaleX.toFixed(4)))}, ${String(Number(scaleY.toFixed(4)))})`,
        transformOrigin: '100% 50%',
      };

  return (
    <WenkuSearchField
      value={props.value}
      onValueChange={props.onValueChange}
      hint={props.hint}
      enabled={props.expanded}
      onClose={props.onClose}
      autoFocus={props.expanded}
      className={['wenku-expandable-search', props.className].filter(Boolean).join(' ')}
      style={{ ...motionStyle, ...props.style }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * WenkuPillButton —— `ui/wenku/WenkuGlass.kt` L586-648（6 处调用）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** `WenkuTokens.PillHeight = 54.dp`（`WenkuTokens.kt` L76）。 */
export const WENKU_PILL_HEIGHT_PX = WENKU_CONTROL_DP.pillHeight;
/** `WenkuTokens.PillRadius = 22.dp`（L53）。 */
export const WENKU_PILL_RADIUS_PX = WENKU_RADII_DP.pill;
/** L610 `widthIn(min = if (primary) 148.dp else 106.dp)`。 */
export const WENKU_PILL_MIN_WIDTH_PRIMARY_PX = 148;
export const WENKU_PILL_MIN_WIDTH_SECONDARY_PX = 106;
/** L613 禁用底色 alpha。 */
export const WENKU_PILL_DISABLED_ALPHA = 0.42;
/** L614 描边 0.7dp；alpha primary .08 / secondary .12。 */
export const WENKU_PILL_BORDER_PX = 0.7;
export const WENKU_PILL_BORDER_ALPHA_PRIMARY = 0.08;
export const WENKU_PILL_BORDER_ALPHA_SECONDARY = 0.12;
/** L628 `.padding(horizontal = 22.dp)`。 */
export const WENKU_PILL_PADDING_PX = 22;
/** L634 `WenkuButtonGlyph(icon, 18.dp, fg)`。 */
export const WENKU_PILL_GLYPH_PX = 18;
/** L636 `Spacer(Modifier.size(8.dp))`。 */
export const WENKU_PILL_GAP_PX = 8;
/** L641 `fontSize = 15.sp` / L642 `FontWeight.Bold`。 */
export const WENKU_PILL_LABEL_SP = 15;
/** L600 按下缩放。 */
export const WENKU_PILL_PRESS_SCALE = 0.975;

export interface WenkuPillButtonProps {
  readonly text: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
  readonly enabled?: boolean;
  readonly symbol?: WenkuSymbol;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 54 高、22 圆角、最小宽 148（primary）/ 106（secondary）、水平内边距 22、
 * 15sp Bold、按下 0.975。主态 `ink` 底 + `paper` 字，次态 `raised` 底 + `ink` 字。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L586-648。
 */
export function WenkuPillButton(props: WenkuPillButtonProps): ReactNode {
  const dark = useWenkuDark();
  const reduceMotion = useWenkuReducedMotion();
  const haptics = useAppHaptics();
  const enabled = props.enabled !== false;
  const primary = props.primary !== false;

  const ink = wenkuInk(dark);
  const base = primary ? ink : wenkuRaised(dark);
  const fg = primary ? wenkuPaper(dark) : ink;

  const classNames = ['wenku-pill-button'];
  if (enabled && !reduceMotion) classNames.push('wenku-pill-button--interactive');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style: CSSProperties = {
    height: `${String(WENKU_PILL_HEIGHT_PX)}px`,
    minWidth: `${String(primary ? WENKU_PILL_MIN_WIDTH_PRIMARY_PX : WENKU_PILL_MIN_WIDTH_SECONDARY_PX)}px`,
    borderRadius: `${String(WENKU_PILL_RADIUS_PX)}px`,
    background: wenkuTint(base, enabled ? 1 : WENKU_PILL_DISABLED_ALPHA),
    borderWidth: `${String(WENKU_PILL_BORDER_PX)}px`,
    borderColor: wenkuTint(
      ink,
      primary ? WENKU_PILL_BORDER_ALPHA_PRIMARY : WENKU_PILL_BORDER_ALPHA_SECONDARY,
    ),
    paddingLeft: `${String(WENKU_PILL_PADDING_PX)}px`,
    paddingRight: `${String(WENKU_PILL_PADDING_PX)}px`,
    color: wenkuTint(fg, 1),
    ...props.style,
  };

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      style={style}
      disabled={!enabled}
      data-testid={props.testId}
      onClick={() => {
        if (!enabled) return;
        haptics.perform(WENKU_TAP_HAPTIC);
        props.onClick();
      }}
    >
      {props.symbol === undefined ? null : (
        <>
          <WenkuIcon symbol={props.symbol} size={WENKU_PILL_GLYPH_PX} tint={wenkuTint(fg, 1)} />
          <span className="wenku-pill-button__gap" style={{ width: `${String(WENKU_PILL_GAP_PX)}px` }} />
        </>
      )}
      <span
        className="wenku-pill-button__label"
        style={{ fontSize: `${String(WENKU_PILL_LABEL_SP)}px`, fontWeight: 700 }}
      >
        {props.text}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * WenkuJellyTapSurface / WenkuMenu —— `ui/wenku/WenkuGlass.kt` L651-677 / L716-731
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** L662 按下缩放。 */
export const WENKU_JELLY_TAP_PRESS_SCALE = 0.985;

export interface WenkuJellyTapSurfaceProps {
  readonly onClick: () => void;
  readonly enabled?: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 0.985 按压缩放的可点表面（无底色、无描边，只提供触感与缩放）。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L651-677。
 */
export function WenkuJellyTapSurface(props: WenkuJellyTapSurfaceProps): ReactNode {
  const reduceMotion = useWenkuReducedMotion();
  const enabled = props.enabled !== false;
  const classNames = ['wenku-jelly-tap'];
  if (enabled && !reduceMotion) classNames.push('wenku-jelly-tap--interactive');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  return (
    <div
      className={classNames.join(' ')}
      style={props.style}
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-disabled={!enabled}
      data-testid={props.testId}
      onClick={() => {
        if (!enabled) return;
        props.onClick();
      }}
      onKeyDown={(event) => {
        if (!enabled) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onClick();
      }}
    >
      {props.children}
    </div>
  );
}

/** `WenkuTokens.MenuWidth = 248.dp`（`WenkuTokens.kt` L80）。 */
export const WENKU_MENU_PANEL_WIDTH_PX = WENKU_CONTROL_DP.menuWidth;
/** `WenkuTokens.MenuMaxOverlayWidth = 440.dp`（L81）。 */
export const WENKU_MENU_PANEL_MAX_WIDTH_PX = WENKU_CONTROL_DP.menuMaxOverlayWidth;
/** `WenkuTokens.MenuRadius = 4.dp`（L55）。 */
export const WENKU_MENU_PANEL_RADIUS_PX = WENKU_RADII_DP.menu;
/** L727 `border(0.7.dp, colors.outline.copy(alpha = 0.5f), …)`。 */
export const WENKU_MENU_PANEL_BORDER_PX = 0.7;
export const WENKU_MENU_PANEL_BORDER_ALPHA = 0.5;
/** L728 `.padding(vertical = 4.dp)`。 */
export const WENKU_MENU_PANEL_PADDING_Y_PX = 4;

export interface WenkuMenuProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 下拉菜单底板：248–440 宽、4px 圆角、不透明 `panel` 底、0.7px `outline@.5` 描边、上下 4px 内边距。
 * Kotlin: `ui/wenku/WenkuGlass.kt` L716-731。
 */
export function WenkuMenu(props: WenkuMenuProps): ReactNode {
  const dark = useWenkuDark();
  const classNames = ['wenku-menu-panel'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style: CSSProperties = {
    minWidth: `${String(WENKU_MENU_PANEL_WIDTH_PX)}px`,
    maxWidth: `${String(WENKU_MENU_PANEL_MAX_WIDTH_PX)}px`,
    borderRadius: `${String(WENKU_MENU_PANEL_RADIUS_PX)}px`,
    background: wenkuTint(wenkuPanel(dark), 1),
    borderWidth: `${String(WENKU_MENU_PANEL_BORDER_PX)}px`,
    borderColor: wenkuTint(wenkuOutline(dark), WENKU_MENU_PANEL_BORDER_ALPHA),
    paddingTop: `${String(WENKU_MENU_PANEL_PADDING_Y_PX)}px`,
    paddingBottom: `${String(WENKU_MENU_PANEL_PADDING_Y_PX)}px`,
    ...props.style,
  };

  return (
    <div className={classNames.join(' ')} style={style} data-testid={props.testId}>
      {props.children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * rememberWenkuSearchMotion —— `ui/wenku/WenkuGlass.kt` L418-433
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * L419-433 `rememberWenkuSearchMotion(expanded)`：
 * `animateFloatAsState(targetValue = if (expanded) 1f else 0f, animationSpec = tween(
 *  durationMillis = if (reduceMotion) 0 else if (expanded) ENTER_MS else EXIT_MS,
 *  easing = LinearEasing))`。
 *
 * 返回 0→1 的当前值（线性时钟，供 `WenkuExpandableSearch` 的宽度与果冻形变使用）。
 * ESLint 只认 `use*` 前缀，故实现名 `useWenkuSearchMotion`，对外仍用 Kotlin 原名导出。
 */
export function useWenkuSearchMotion(expanded: boolean): number {
  const reduceMotion = useWenkuReducedMotion();
  const [value, setValue] = useState(expanded ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const duration = expanded ? WENKU_MOTION.enterMs : WENKU_MOTION.exitMs;
    const from = value;
    const to = expanded ? 1 : 0;
    if (from === to) return undefined;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (): void => {
      const p = Math.min((performance.now() - startedAt) / duration, 1);
      setValue(from + (to - from) * p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `value` 故意不入依赖：只在 expanded / reduceMotion 变化时启动一次时钟。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, reduceMotion]);
  return reduceMotion ? (expanded ? 1 : 0) : value;
}

/** Kotlin 原名出口（见上）。 */
export const rememberWenkuSearchMotion = useWenkuSearchMotion;
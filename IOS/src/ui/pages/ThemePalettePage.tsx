/**
 * ThemePalettePage.tsx — line-by-line port of Android
 * `com/example/ui/ThemePaletteScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/ThemePaletteScreen.kt`, 229 lines / 215 non-blank).
 *
 * Kotlin → TS line map
 * ────────────────────
 *   L1-43    package + Compose imports                    → React imports; Compose/Android imports SKIPPED
 *   L45      `paletteLabels = listOf("蓝","紫","绿","粉","橙").map { tr(it) }` → `PALETTE_LABELS`
 *   L47-54   `ThemePaletteScreen(primaryIndex, secondaryIndex, onPrimaryChange,
 *            onSecondaryChange, onBack)` signature       → `ThemePalettePageProps` (same names)
 *   L56      `GlassManagementPage(tr("主题配色方案"), "APPEARANCE / PALETTE", onBack)`
 *                                                         → `.page` + `TabScreenHeader` (title/subtitle/leading)
 *   L57-63   `preview` lambda: WenkuSectionHeader("01","TONAL PALETTE",tr("实时预览"))
 *            + `ThemePalettePreview(palette)`             → `<WenkuSectionHeader/>`（共享组件） + `<PalettePreview/>`
 *   L64-68   `AdaptiveWorkspace(controls = { if (split) … })`
 *                                                         → CSS container branch: `.theme-palette__layout`
 *                                                           becomes 2 columns at ≥ 1060px (same bound as
 *                                                           `AdaptiveWorkspace`), preview moves into the
 *                                                           sticky controls column; below it stays first.
 *   L70-74   LazyColumn(contentPadding 24/12/24/24, spacedBy 16.dp) → `.theme-palette__list`
 *   L75      `if (!split) item("preview")`                → preview is the first grid child below 1060px
 *   L76-81   item("primary")  PaletteOptions("02", "PRIMARY COLOR", tr("主色调"), BasePrimaryColors, …)
 *   L82-87   item("secondary") PaletteOptions("03","ACCENT COLOR", tr("强调色"), BaseSecondaryColors, …)
 *   L94-125  `ThemePalettePreview(colors: ColorScheme)`   → `PalettePreview`
 *   L127-172 `PaletteOptions(number, code, title, palette, selectedIndex, modifier, onSelect)`
 *                                                         → `PaletteOptions`
 *   L155-169 BoxWithConstraints branch (single Row when `maxWidth >= 48.dp * n + 7.dp * (n-1)`,
 *            otherwise FlowRow of 56.dp tiles)           → CSS `@container (min-width: 268px)`
 *                                                           (`48*5 + 7*4 = 268`), tiles 56px wide and
 *                                                           `max-width: 82px` in row mode (`82*5 + 28`)
 *   L174-229 `PaletteSwatch(color, label, description, modifier, checked, onClick)`
 *                                                         → `PaletteSwatch`
 *
 * ── Value fidelity ────────────────────────────────────────────────────────────────
 *  * 调色板取值 `BasePrimaryColors` / `BaseSecondaryColors` 来自
 *    `@core/ui-theme/theme`（Theme.kt L16-30 的逐行移植），默认索引 2（绿），
 *    与 `Theme.kt` L36-37 的 `colorPrimaryIndex = 2` / `colorSecondaryIndex = 2` 一致。
 *  * `MaterialTheme.colorScheme` → `resolveColorScheme({ colorPrimaryIndex, colorSecondaryIndex,
 *    darkTheme })`（Theme.kt L34-91 的移植）。Kotlin 的 `lightColorScheme(...)` 只传了
 *    primary/secondary/tertiary/background/surface/onBackground/onSurface 七个槽位，
 *    其余槽位保留 Material3 基线默认值；预览条用到其中两个，于是按基线取值写成常量：
 *      `surfaceContainerHighest` = `#E6E0E9`（暗色 `#36343B`）
 *      `onSurfaceVariant`        = `#49454F`（暗色 `#CAC4D0`）
 *      `outlineVariant`          = `#CAC4D0`（暗色 `#49454F`，选中描边未选态）
 *    这三个值不是新造的设计 token，而是 M3 `ColorLightTokens` / `ColorDarkTokens` 的基线。
 *  * 预览色条顺序逐字照抄 L108-113：primary、secondary、`lerp(surface, primary, .22f)`、
 *    `lerp(surface, secondary, .16f)`、`surfaceContainerHighest`；
 *    `androidx.compose.ui.graphics.lerp(a, b, t)` → `mixHex(a, b, t)`。
 *  * `"#%06X".format(color.toArgb() and 0xFFFFFF)` → `hexStateDescription()`（大写六位、带 `#`）。
 *
 * ── Adaptations (no behaviour loss) ───────────────────────────────────────────────
 *  * `WenkuGlassSurface(blur = 0.dp, contentPadding = 4.dp, role = Role.RadioButton)` →
 *    `<button role="radio" aria-checked>` + `.theme-palette__swatch`。这里不复用 `GlassCard`
 *    的唯一原因是 `GlassCard` 不透传 `role` / `aria-checked` / `aria-description`，而
 *    Kotlin 的 `PaletteSwatch` 明确是 RadioButton 语义（L196 `role = Role.RadioButton`），
 *    读屏可选中状态必须保留。底色/描边/阴影仍取项目玻璃 token，不另造视觉。
 *  * `WenkuContentPanel` → 共享 `GlassCard`（radius 20 = DesignTokens.RadiusLg）。
 *  * `AnimatedVisibility(fadeIn()+scaleIn(.72f))` 的勾选徽标 → CSS `tp-check-pop`
 *    （同 0.72 起始缩放）；`rememberWenkuAccessibility().reduceMotion` 为 true 时改为
 *    `EnterTransition.None`/`ExitTransition.None`，CSS 侧用 `prefers-reduced-motion` +
 *    `reduceMotion` prop 关闭动画（`tp-no-motion`）。
 *  * `Modifier.wenkuPagePart(n)` 的错峰入场 → `--tp-part` + `WENKU_MOTION.listDelayStep (0.055 s)`
 *    的 `animation-delay`（`wenkuPagePart` 就是 WenkuMotion 的错峰常量）。
 *  * `WenkuIcon(WenkuSymbol.Book / Check)` → 内联 SVG（同 Material 图形）。
 *  * 未移植：`Modifier.semantics(mergeDescendants = true)`（Web 上 `<button>` 已是叶子节点，
 *    无需合并语义树）。
 */

import { type ReactElement } from 'react';
import { GlassCard } from '@ui/components/GlassCard';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import { mixHex } from '@core/glass/color';
import {
  BASE_PRIMARY_COLORS,
  BASE_SECONDARY_COLORS,
  DEFAULT_PRIMARY_INDEX,
  DEFAULT_SECONDARY_INDEX,
  resolveColorScheme,
} from '@core/ui-theme/theme';
import { DESIGN_TOKENS } from '@ui/theme/tokens';
import { tr } from '@core/i18n';
import { WenkuSectionHeader } from '@ui/components/wenku/WenkuSectionHeader';
import '../../styles/themePalette.css';

/** Kotlin L45 — `listOf("蓝","紫","绿","粉","橙").map { tr(it) }`. */
export const PALETTE_LABELS: readonly [string, string, string, string, string] = [
  '蓝',
  '紫',
  '绿',
  '粉',
  '橙',
];

/** Kotlin L45 — the five labels line up with the two five-entry palettes. */
export const PALETTE_SIZE = 5;

/**
 * Material3 baseline leftovers after `Theme.kt`'s seven named slots
 * (`ColorLightTokens` / `ColorDarkTokens`) — see the header note.
 */
export const SURFACE_CONTAINER_HIGHEST_LIGHT = '#E6E0E9';
export const SURFACE_CONTAINER_HIGHEST_DARK = '#36343B';
export const ON_SURFACE_VARIANT_LIGHT = '#49454F';
export const ON_SURFACE_VARIANT_DARK = '#CAC4D0';
export const OUTLINE_VARIANT_LIGHT = '#CAC4D0';
export const OUTLINE_VARIANT_DARK = '#49454F';

/** Kotlin `Theme.kt` L36-37 defaults — the value the screen was opened with. */
export interface ThemePaletteValue {
  primaryIndex: number;
  secondaryIndex: number;
}

/** Kotlin `colorPrimaryIndex = 2` / `colorSecondaryIndex = 2`. */
export const DEFAULT_THEME_PALETTE: ThemePaletteValue = {
  primaryIndex: DEFAULT_PRIMARY_INDEX,
  secondaryIndex: DEFAULT_SECONDARY_INDEX,
};

export interface ThemePalettePageProps {
  /** Kotlin `primaryIndex: Int` — defaults to the persisted `colorPrimaryIndex` (2). */
  primaryIndex?: number;
  /** Kotlin `secondaryIndex: Int`. */
  secondaryIndex?: number;
  /** Kotlin `onPrimaryChange: (Int) -> Unit`. */
  onPrimaryChange?: (index: number) => void;
  /** Kotlin `onSecondaryChange: (Int) -> Unit`. */
  onSecondaryChange?: (index: number) => void;
  /** Kotlin `onBack: () -> Unit` — `GlassManagementPage`'s back action. */
  onBack?: () => void;
  /** Kotlin `MaterialTheme.colorScheme` came from `darkTheme`; LIGHT is the app default. */
  dark?: boolean;
  /** Kotlin `rememberWenkuAccessibility().reduceMotion`. */
  reduceMotion?: boolean;
}

/** `Color.toArgb() and 0xFFFFFF` → `#RRGGBB` (Kotlin L118). */
export function hexStateDescription(hex: string): string {
  const raw = hex.trim().replace(/^#/, '').toUpperCase();
  return `#${raw.padStart(6, '0').slice(-6)}`;
}

/** Kotlin L108-113 — the five preview tones, in order. */
export function palettePreviewSwatches(
  primaryIndex: number,
  secondaryIndex: number,
  dark = false,
): readonly [string, string, string, string, string] {
  const { colorScheme } = resolveColorScheme({
    colorPrimaryIndex: primaryIndex,
    colorSecondaryIndex: secondaryIndex,
    darkTheme: dark,
  });
  return [
    colorScheme.primary,
    colorScheme.secondary,
    mixHex(colorScheme.surface, colorScheme.primary, 0.22),
    mixHex(colorScheme.surface, colorScheme.secondary, 0.16),
    dark ? SURFACE_CONTAINER_HIGHEST_DARK : SURFACE_CONTAINER_HIGHEST_LIGHT,
  ];
}

/**
 * Kotlin `ThemePaletteScreen` (L47-92).
 *
 * `primaryIndex` / `secondaryIndex` are the *persisted* accents; the screen never owns state —
 * every tap goes straight out through `onPrimaryChange` / `onSecondaryChange`, exactly like the
 * Kotlin callbacks that write `PreferencesManager.colorPrimaryIndex`.
 */
export function ThemePalettePage(props: ThemePalettePageProps): ReactElement {
  const dark = props.dark === true;
  const reduceMotion = props.reduceMotion === true;
  const primaryIndex = props.primaryIndex ?? DEFAULT_PRIMARY_INDEX;
  const secondaryIndex = props.secondaryIndex ?? DEFAULT_SECONDARY_INDEX;
  const { colorScheme } = resolveColorScheme({
    colorPrimaryIndex: primaryIndex,
    colorSecondaryIndex: secondaryIndex,
    darkTheme: dark,
  });
  const outlineVariant = dark ? OUTLINE_VARIANT_DARK : OUTLINE_VARIANT_LIGHT;
  const surface = colorScheme.surface;

  const rootClass = [
    'page',
    'theme-palette-page',
    reduceMotion ? 'theme-palette-page--no-motion' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      <TabScreenHeader
        title="主题配色方案"
        subtitle="APPEARANCE / PALETTE"
        titleColor={colorScheme.onBackground}
        {...(props.onBack === undefined
          ? {}
          : {
              leading: (
                <button
                  type="button"
                  className="settings-header-back"
                  onClick={props.onBack}
                  aria-label="返回"
                >
                  <ArrowBackIcon />
                </button>
              ),
            })}
      />

      <div className="theme-palette__layout">
        {/* Kotlin L58-63 wiring: the preview is `wenkuPagePart(1)` either way. */}
        <div className="theme-palette__preview-part" style={{ ['--tp-part' as string]: 1 }}>
          <WenkuSectionHeader index="01" latin="TONAL PALETTE" title={tr('实时预览')} />
          <div className="theme-palette__part-body">
            <PalettePreview
              primaryIndex={primaryIndex}
              secondaryIndex={secondaryIndex}
              dark={dark}
            />
          </div>
        </div>

        <div className="theme-palette__list">
          <section className="theme-palette__part" style={{ ['--tp-part' as string]: 2 }}>
            <PaletteOptions
              number="02"
              code="PRIMARY COLOR"
              title={tr('主色调')}
              palette={BASE_PRIMARY_COLORS}
              selectedIndex={primaryIndex}
              primaryColor={colorScheme.primary}
              surface={surface}
              outlineVariant={outlineVariant}
              reduceMotion={reduceMotion}
              onSelect={(index) => props.onPrimaryChange?.(index)}
            />
          </section>
          <section className="theme-palette__part" style={{ ['--tp-part' as string]: 3 }}>
            <PaletteOptions
              number="03"
              code="ACCENT COLOR"
              title={tr('强调色')}
              palette={BASE_SECONDARY_COLORS}
              selectedIndex={secondaryIndex}
              primaryColor={colorScheme.primary}
              surface={surface}
              outlineVariant={outlineVariant}
              reduceMotion={reduceMotion}
              onSelect={(index) => props.onSecondaryChange?.(index)}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Kotlin L94-125 `ThemePalettePreview(colors: ColorScheme)`. */
function PalettePreview(props: {
  primaryIndex: number;
  secondaryIndex: number;
  dark: boolean;
}): ReactElement {
  const { colorScheme } = resolveColorScheme({
    colorPrimaryIndex: props.primaryIndex,
    colorSecondaryIndex: props.secondaryIndex,
    darkTheme: props.dark,
  });
  const swatches = palettePreviewSwatches(props.primaryIndex, props.secondaryIndex, props.dark);
  const onSurfaceVariant = props.dark ? ON_SURFACE_VARIANT_DARK : ON_SURFACE_VARIANT_LIGHT;

  return (
    <GlassCard radius={DESIGN_TOKENS.radius.lg} padding={16}>
      <div className="theme-palette__preview">
        <div className="theme-palette__preview-head">
          <span className="theme-palette__preview-icon" style={{ color: colorScheme.primary }}>
            <BookIcon />
          </span>
          <span className="theme-palette__preview-title">Ciallo 阅览室</span>
        </div>
        <p className="theme-palette__preview-desc" style={{ color: onSurfaceVariant }}>
          配色会即时应用到页面、玻璃卡片和控件。
        </p>
        <div className="theme-palette__tones">
          {swatches.map((color, index) => (
            <span
              key={`tone-${String(index)}`}
              className="theme-palette__tone"
              data-testid={`theme_palette_preview_${String(index)}`}
              style={{ background: color }}
              aria-label={hexStateDescription(color)}
              title={hexStateDescription(color)}
            />
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

/** Kotlin L127-172 `PaletteOptions(number, code, title, palette, selectedIndex, …)`. */
function PaletteOptions(props: {
  number: string;
  code: string;
  title: string;
  palette: readonly string[];
  selectedIndex: number;
  primaryColor: string;
  surface: string;
  outlineVariant: string;
  reduceMotion: boolean;
  onSelect: (index: number) => void;
}): ReactElement {
  return (
    <div className="theme-palette__options">
      <WenkuSectionHeader index={props.number} latin={props.code} title={props.title} />
      <div className="theme-palette__swatch-area">
        {props.palette.map((color, index) => {
          const label = PALETTE_LABELS[index] ?? String(index + 1);
          return (
            <PaletteSwatch
              key={`${props.code}-${String(index)}`}
              color={color}
              label={label}
              title={props.title}
              checked={index === props.selectedIndex}
              primaryColor={props.primaryColor}
              surface={props.surface}
              outlineVariant={props.outlineVariant}
              reduceMotion={props.reduceMotion}
              onSelect={() => props.onSelect(index)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Kotlin L174-229 `PaletteSwatch(color, label, description, modifier, checked, onClick)`. */
function PaletteSwatch(props: {
  color: string;
  label: string;
  title: string;
  checked: boolean;
  primaryColor: string;
  surface: string;
  outlineVariant: string;
  reduceMotion: boolean;
  onSelect: () => void;
}): ReactElement {
  const description = `${props.title} · ${props.label}`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      aria-label={description}
      aria-description={props.checked ? '已选择' : '未选择'}
      className={
        props.checked
          ? 'theme-palette__swatch theme-palette__swatch--checked'
          : 'theme-palette__swatch'
      }
      onClick={props.onSelect}
    >
      <span
        className="theme-palette__tile"
        style={{
          borderWidth: props.checked ? 1.6 : 0.7,
          borderColor: props.checked ? props.primaryColor : props.outlineVariant,
        }}
      >
        <span className="theme-palette__tile-tones">
          {[props.color, mixHex(props.surface, props.color, 0.48), mixHex(props.surface, props.color, 0.22)].map(
            (tone, index) => (
              <span
                key={`tile-${String(index)}`}
                className="theme-palette__tile-tone"
                style={{ background: tone }}
              />
            ),
          )}
        </span>
        {props.checked ? (
          <span
            className={
              props.reduceMotion
                ? 'theme-palette__check theme-palette__check--instant'
                : 'theme-palette__check'
            }
            style={{ background: props.surface }}
          >
            <CheckIcon />
          </span>
        ) : null}
      </span>
      <span
        className="theme-palette__label"
        style={{ fontWeight: props.checked ? 600 : 400 }}
      >
        {props.label}
      </span>
    </button>
  );
}

function ArrowBackIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

function BookIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
    </svg>
  );
}

function CheckIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

export default ThemePalettePage;

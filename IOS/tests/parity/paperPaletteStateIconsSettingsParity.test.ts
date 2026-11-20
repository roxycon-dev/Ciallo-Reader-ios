/**
 * paperPaletteStateIconsSettingsParity.test.ts
 *   ├ `ui/pageturn/PaperPalette.kt`      （93 行）→ `@core/pageturn/paperPalette` + `@core/glass/color`
 *   ├ `ui/components/StateIcons.kt`      （93 行）→ `@core/ui/stateIcons` + `@ui/components/StateIcons`
 *   ├ `ui/reader/ReadingSettingsPanel.kt`（92 行）→ `@core/reader/readingSettingsPanel` + `styles/reader.css`
 *   └ `source/impl/MockBookSource.kt`    （95 行）→ `@core/source/impl/mockBookSource`
 *
 * 这四个文件同属 65–96 行档，形态也相同：**端口早就有实现，但没有一条读 Kotlin 原文的
 * 测试**，于是矩阵只能记 `ADAPTED`。本轮补测试时又抓出三处真错：
 *
 *   ① `desaturate()` 被写成「灰度先量化到 8-bit、再混」——Kotlin 全程 float，只在最终
 *      落到像素时量化一次。`#3C3C5E @ 0.22` 在 Kotlin 是 `#3D3D57`，双量化给 `#3C3C57`。
 *   ② `StateIcons.kt` 的三个组件在端口里**只有三个空 interface**（`state: 'idle' | 'active'
 *      | 'done'` 这种自造形状），动效时长 / 缩放 / 勾的几何全部不存在。
 *   ③ `.rd-sheet--settings` 被套上了 `ReadingGlass` 的光学参数（`saturate(1.1) blur(16px)`、
 *      三段高光、`0.7px @ .13` 描边、外加 `LOW`/`MINIMAL` 两条画质分支），而
 *      `ReadingSettingsPanel.kt` 自己写的是 `blur(8dp)` + `themeColor@.56` + `white@.10` +
 *      `1dp@.12`，**全文没有 `LocalRenderQuality`**。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { desaturateHex, mixHex } from '@core/glass/color';
import { setAppLanguage } from '@core/i18n/locale';
import { tr } from '@core/i18n';
import { paperPaletteOf } from '@core/pageturn/paperPalette';
import {
  READING_SETTINGS_BLUR_PX,
  READING_SETTINGS_BORDER_ALPHA,
  READING_SETTINGS_BORDER_WIDTH_PX,
  READING_SETTINGS_BREAKPOINT_PX,
  READING_SETTINGS_NARROW_MAX_HEIGHT,
  READING_SETTINGS_NARROW_MAX_WIDTH_PX,
  READING_SETTINGS_RADIUS_PX,
  READING_SETTINGS_SCRIM_ALPHA,
  READING_SETTINGS_SHADOW,
  READING_SETTINGS_SHEEN_ALPHA,
  READING_SETTINGS_SPACE_TIGHT_PX,
  READING_SETTINGS_SPACE_XL_PX,
  READING_SETTINGS_TINT_ALPHA,
  READING_SETTINGS_WIDE_MAX_HEIGHT,
  READING_SETTINGS_WIDE_MAX_WIDTH_PX,
  readingSettingsPanelLayout,
} from '@core/reader/readingSettingsPanel';
import { createLoginCredential } from '@core/source/loginCredential';
import { MockBookSource } from '@core/source/impl/mockBookSource';
import { BookNotFound } from '@core/source/sourceException';
import { SourceResult } from '@core/source/sourceResult';
import {
  CHEVRON_COLLAPSED_ROTATION,
  CHEVRON_EXPANDED_ROTATION,
  SELECTION_MARK_CHECK_STROKE_UNITS,
  SELECTION_MARK_SIZE_DP,
  SELECTION_MARK_STROKE_DP,
  SELECTION_MARK_UNCHECKED_ALPHA,
  chevronRotation,
  selectionMarkForegroundVisible,
  selectionMarkGeometry,
  selectionMarkLabel,
  selectionMarkProgress,
  stateIconTransition,
} from '@core/ui/stateIcons';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① PaperPalette.kt L25-93
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PaperPalette.kt L25-41 data class + baseAlpha', () => {
  const src = kt('ui/pageturn/PaperPalette.kt');

  it('L40 `baseAlpha = if (isDark) 0.93f else 0.90f` —— 深色纸 alpha 更高', () => {
    expect(src).toContain('val baseAlpha: Float = if (isDark) 0.93f else 0.90f');
    expect(paperPaletteOf('#1A1A1E').baseAlpha).toBe(0.93);
    expect(paperPaletteOf('#F5F0E6').baseAlpha).toBe(0.9);
  });

  it('L50 `luminance() < 0.25f` —— `#888888` 落暗档、`#898989` 落亮档', () => {
    expect(src).toContain('val isDark = source.luminance() < 0.25f');
    expect(paperPaletteOf('#888888').isDark).toBe(true);
    expect(paperPaletteOf('#898989').isDark).toBe(false);
    // 同一个 baseAlpha 也随之切换 —— 两个值必须成对，不能只改阈值。
    expect(paperPaletteOf('#888888').baseAlpha).toBe(0.93);
    expect(paperPaletteOf('#898989').baseAlpha).toBe(0.9);
  });
});

describe('PaperPalette.kt L49-76 paperPaletteOf 的四组混色', () => {
  const src = kt('ui/pageturn/PaperPalette.kt');

  it('L52-56 face：暗档 `mix(0xFF0B0C0E, 0.18).desaturate(0.16)`、亮档 `mix(White, 0.10).desaturate(0.22)`', () => {
    expect(src).toContain('source.mix(Color(0xFF0B0C0E), 0.18f).desaturate(0.16f)');
    expect(src).toContain('source.mix(Color.White, 0.10f).desaturate(0.22f)');
    // 逐值对拍（期望值由 Kotlin 公式的 float 路径独立算出）
    expect(paperPaletteOf('#F5F0E6').face).toBe('#F5F2EB');
    expect(paperPaletteOf('#1A1A1E').face).toBe('#17171A');
    // 与 core 的两个原语组合一致 —— 防有人只改 paperPalette 不改 color.ts
    expect(paperPaletteOf('#F5F0E6').face).toBe(desaturateHex(mixHex('#F5F0E6', '#FFFFFF', 0.1), 0.22));
  });

  it('L58-62 edgeHighlight：暗档 `mix(0xFF8A8F97, 0.55)`、亮档 `mix(White, 0.72)`', () => {
    expect(src).toContain('face.mix(Color(0xFF8A8F97), 0.55f)');
    expect(src).toContain('face.mix(Color.White, 0.72f)');
    expect(paperPaletteOf('#F5F0E6').edgeHighlight).toBe('#FCFBF9');
    expect(paperPaletteOf('#1A1A1E').edgeHighlight).toBe('#56595F');
  });

  it('L64-68 edgeStroke：暗档 `mix(0xFF6E7480, 0.62)`、亮档 `mix(0xFF8A7C60, 0.62)`', () => {
    expect(src).toContain('face.mix(Color(0xFF6E7480), 0.62f)');
    expect(src).toContain('face.mix(Color(0xFF8A7C60), 0.62f)');
    expect(paperPaletteOf('#F5F0E6').edgeStroke).toBe('#B3A995');
    expect(paperPaletteOf('#1A1A1E').edgeStroke).toBe('#4D5159');
  });

  it('L79-87 mix：`ratio.coerceIn(0f, 1f)`，两端点原样返回', () => {
    expect(src).toContain('val t = ratio.coerceIn(0f, 1f)');
    expect(mixHex('#123456', '#FFFFFF', 0)).toBe('#123456');
    expect(mixHex('#123456', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHex('#123456', '#FFFFFF', -3)).toBe('#123456');
    expect(mixHex('#123456', '#FFFFFF', 9)).toBe('#FFFFFF');
  });

  it('L90-93 desaturate 用 Rec.709 系数、且**全程 float**（只量化一次）', () => {
    expect(src).toContain('val gray = 0.2126f * red + 0.7152f * green + 0.0722f * blue');
    // 关键回归：灰度先量化到 8-bit 再混会得到 #3C3C57，Kotlin 的 float 路径是 #3D3D57。
    expect(desaturateHex('#3C3C5E', 0.22)).toBe('#3D3D57');
    expect(desaturateHex('#000020', 0.22)).toBe('#010119');
    // 纯灰永不被改变；amount=0 原样返回；amount=1 完全去色
    expect(desaturateHex('#808080', 0.22)).toBe('#808080');
    expect(desaturateHex('#3C3C5E', 0)).toBe('#3C3C5E');
    // amount=1 时三通道都等于 luma：0.2126*200 + 0.7152*30 + 0.0722*50 = 67.586 → 68 = 0x44
    expect(desaturateHex('#C81E32', 1)).toBe('#444444');
    // 同样走 float 路径的边界：luma 恰落在 .5 上不许提前 round
    expect(desaturateHex('#808081', 1)).toBe('#808080');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② StateIcons.kt L32-93
   ══════════════════════════════════════════════════════════════════════════════ */

describe('StateIcons.kt L32-49 AnimatedStateIcon 的进出场', () => {
  const src = kt('ui/components/StateIcons.kt');
  const motion = kt('ui/feedback/Motion.kt');

  it('L39/L43-44 全部走 `AppMotion.icon()`，而它是 **tween(240, easeOutCubic)**，不是弹簧', () => {
    // Kotlin 原文：`fun <T> icon() = tween<T>(ICON_MS, easing = easeOutCubic)` + `ICON_MS = 240`
    expect(motion).toContain('const val ICON_MS = 240');
    expect(motion).toContain('fun <T> icon() = androidx.compose.animation.core.tween<T>(ICON_MS, easing = easeOutCubic)');
    expect(motion).toContain('const val PRESS_MS = 110');
    expect(src).toContain('AppMotion.icon()');
    // 端口：三处时长同源
    const normal = stateIconTransition(false);
    expect(normal.colorMs).toBe(240);
    expect(normal.enterScaleMs).toBe(240);
    expect(normal.exitScaleMs).toBe(240);
    expect(normal.easing).toBe('cubic-bezier(0.215, 0.61, 0.355, 1)');
  });

  it('L43-44 `initialScale = .82f` / `targetScale = .92f`，出场淡出用 PRESS_MS=110', () => {
    expect(src).toContain('scaleIn(AppMotion.icon(), initialScale = .82f)');
    expect(src).toContain('fadeOut(tween(AppMotion.PRESS_MS))');
    expect(src).toContain('scaleOut(AppMotion.icon(), targetScale = .92f)');
    const normal = stateIconTransition(false);
    expect(normal.enterScaleFrom).toBe(0.82);
    expect(normal.exitScaleTo).toBe(0.92);
    expect(normal.exitFadeMs).toBe(110);
    expect(normal.enterFadeMs).toBe(240);
  });

  it('L38/L42 `LocalReduceMotion` → `snap()`：全部时长归零、缩放恒等', () => {
    expect(src).toContain('if (reduce) snap() else AppMotion.icon()');
    expect(src).toContain('if (reduce) EnterTransition.None togetherWith ExitTransition.None');
    const reduced = stateIconTransition(true);
    expect(reduced).toMatchObject({
      colorMs: 0,
      enterFadeMs: 0,
      enterScaleMs: 0,
      exitFadeMs: 0,
      exitScaleMs: 0,
      enterScaleFrom: 1,
      exitScaleTo: 1,
    });
  });

  it('`src/styles/stateIcons.css` 的内联字面量与 core 常量同值', () => {
    const css = repoText('src/styles/stateIcons.css');
    expect(css).toContain(`animation: state-icon-in ${String(stateIconTransition(false).enterFadeMs)}ms cubic-bezier(0.215, 0.61, 0.355, 1)`);
    expect(css).toContain(`animation: state-icon-out ${String(stateIconTransition(false).exitFadeMs)}ms`);
    expect(css).toContain('scale(0.82)');
    expect(css).toContain('scale(0.92)');
  });
});

describe('StateIcons.kt L53-65 AnimatedChevron', () => {
  const src = kt('ui/components/StateIcons.kt');

  it('L58-59 默认 `0f ↔ 180f`，走 `graphicsLayer { rotationZ }` 而不是改布局', () => {
    expect(src).toContain('collapsedRotation: Float = 0f');
    expect(src).toContain('expandedRotation: Float = 180f');
    expect(src).toContain('modifier.graphicsLayer { rotationZ = rotation.value }');
    expect(CHEVRON_COLLAPSED_ROTATION).toBe(0);
    expect(CHEVRON_EXPANDED_ROTATION).toBe(180);
    expect(chevronRotation(false)).toBe(0);
    expect(chevronRotation(true)).toBe(180);
  });

  it('自定义角度原样透传（`expandedRotation` / `collapsedRotation` 都可覆盖）', () => {
    expect(chevronRotation(true, 90, 270)).toBe(270);
    expect(chevronRotation(false, 90, 270)).toBe(90);
  });
});

describe('StateIcons.kt L69-93 AnimatedSelectionMark', () => {
  const src = kt('ui/components/StateIcons.kt');

  it('L72/L79/L80 三个尺寸：未选中 alpha .35、描边 1.5dp、画布 22dp', () => {
    expect(src).toContain('uncheckedColor: Color = MaterialTheme.colorScheme.onBackground.copy(alpha = .35f)');
    expect(src).toContain('Stroke(with(density) { 1.5.dp.toPx() })');
    expect(src).toContain('Canvas(modifier.size(22.dp)');
    expect(SELECTION_MARK_UNCHECKED_ALPHA).toBe(0.35);
    expect(SELECTION_MARK_STROKE_DP).toBe(1.5);
    expect(SELECTION_MARK_SIZE_DP).toBe(22);
  });

  it('L80 `contentDescription = if (checked) "已选中" else "未选中"` —— 裸字面量，没包 tr()', () => {
    expect(src).toContain('contentDescription = if (checked) "已选中" else "未选中"');
    expect(selectionMarkLabel(true)).toBe('已选中');
    expect(selectionMarkLabel(false)).toBe('未选中');
  });

  it('L81-90 进度为 1 的整套几何', () => {
    const g = selectionMarkGeometry(1, 22, 1.5);
    expect(g.unit).toBe(1);
    expect(g.outerRadius).toBe(10.25); // (22 - 1.5) / 2
    expect(g.outerAlpha).toBe(0); // .35 * (1 - 1)
    expect(g.innerRadius).toBeCloseTo(11, 10); // 11 * (.8 + .2 * 1)
    expect(g.innerAlpha).toBe(1);
    expect(g.inkAlpha).toBe(1);
    expect(g.checkStroke).toBe(1.8);
    expect(g.check[0]).toEqual([6, 11]);
    expect(g.check[1]).toEqual([9, 14]);
    expect(g.check[2]).toEqual([16, 7]); // (9 + 7, 14 - 7)
  });

  it('L81-90 进度为 0：勾的末端与中点重合，内圆缩到 0.8', () => {
    const g = selectionMarkGeometry(0, 22, 1.5);
    expect(g.outerAlpha).toBe(0.35);
    expect(g.innerAlpha).toBe(0);
    expect(g.innerRadius).toBeCloseTo(8.8, 10); // 11 * 0.8
    expect(g.check[2]).toEqual([9, 14]);
  });

  it('L85 `if (p > 0f)` —— 进度 0 时整段前景都不画', () => {
    expect(src).toContain('if (p > 0f) {');
    expect(selectionMarkForegroundVisible(0)).toBe(false);
    expect(selectionMarkForegroundVisible(0.0001)).toBe(true);
    expect(selectionMarkProgress(false)).toBe(0);
    expect(selectionMarkProgress(true)).toBe(1);
  });

  it('L89-90 折线中点固定、末端随 p 生长；线宽 `1.8 * unit`', () => {
    expect(src).toContain('drawLine(ink, Offset(6f * unit, 11f * unit), middle, 1.8f * unit, StrokeCap.Round)');
    expect(src).toContain(
      'drawLine(ink, middle, Offset((9f + 7f * p) * unit, (14f - 7f * p) * unit), 1.8f * unit, StrokeCap.Round)',
    );
    const half = selectionMarkGeometry(0.5, 22, 1.5);
    expect(half.check[1]).toEqual([9, 14]);
    expect(half.check[2]).toEqual([12.5, 10.5]);
    expect(half.innerRadius).toBeCloseTo(9.9, 10); // 11 * 0.9
    expect(half.outerAlpha).toBeCloseTo(0.175, 10); // .35 * .5
    // unit 随画布缩放：44dp 画布上 `unit = 2`
    const big = selectionMarkGeometry(1, 44, 1.5);
    expect(big.unit).toBe(2);
    expect(big.check[0]).toEqual([12, 22]);
    expect(big.checkStroke).toBe(SELECTION_MARK_CHECK_STROKE_UNITS * 2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ ReadingSettingsPanel.kt L41-92
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ReadingSettingsPanel.kt L58-71 布局判定', () => {
  const src = kt('ui/reader/ReadingSettingsPanel.kt');

  it('L59 `maxWidth >= 600.dp || maxWidth > maxHeight`', () => {
    expect(src).toContain('val wide = maxWidth >= 600.dp || maxWidth > maxHeight');
    expect(READING_SETTINGS_BREAKPOINT_PX).toBe(600);
    // 竖屏手机
    expect(readingSettingsPanelLayout(400, 800).wide).toBe(false);
    // 恰好 600 命中第一项
    expect(readingSettingsPanelLayout(600, 900).wide).toBe(true);
    // 599 但横屏命中第二项
    expect(readingSettingsPanelLayout(599, 400).wide).toBe(true);
    // 两者都不满足
    expect(readingSettingsPanelLayout(400, 400).wide).toBe(false);
    expect(readingSettingsPanelLayout(599, 600).wide).toBe(false);
  });

  it('L70 `widthIn(max = if (wide) 440.dp else 560.dp)`', () => {
    expect(src).toContain('Modifier.widthIn(max = if (wide) 440.dp else 560.dp).fillMaxWidth()');
    expect(readingSettingsPanelLayout(400, 800).maxWidthPx).toBe(READING_SETTINGS_NARROW_MAX_WIDTH_PX);
    expect(readingSettingsPanelLayout(900, 400).maxWidthPx).toBe(READING_SETTINGS_WIDE_MAX_WIDTH_PX);
    expect(READING_SETTINGS_NARROW_MAX_WIDTH_PX).toBe(560);
    expect(READING_SETTINGS_WIDE_MAX_WIDTH_PX).toBe(440);
  });

  it('L71 `heightIn(max = maxHeight * if (wide) 0.94f else 0.80f)`', () => {
    expect(src).toContain('.heightIn(max = maxHeight * if (wide) 0.94f else 0.80f)');
    expect(readingSettingsPanelLayout(400, 800).maxHeightFactor).toBe(READING_SETTINGS_NARROW_MAX_HEIGHT);
    expect(readingSettingsPanelLayout(900, 400).maxHeightFactor).toBe(READING_SETTINGS_WIDE_MAX_HEIGHT);
    expect(READING_SETTINGS_NARROW_MAX_HEIGHT).toBe(0.8);
    expect(READING_SETTINGS_WIDE_MAX_HEIGHT).toBe(0.94);
  });

  it('L66-67 对齐与内边距：宽屏 `CenterEnd` + `SpaceXl`，窄屏 `BottomCenter` + `SpaceTight`', () => {
    expect(src).toContain('.align(if (wide) Alignment.CenterEnd else Alignment.BottomCenter)');
    expect(src).toContain(
      '.padding(horizontal = if (wide) DesignTokens.SpaceXl else DesignTokens.SpaceTight, vertical = DesignTokens.SpaceTight)',
    );
    const narrow = readingSettingsPanelLayout(400, 800);
    const wide = readingSettingsPanelLayout(900, 400);
    expect(narrow.align).toBe('bottom-center');
    expect(wide.align).toBe('center-end');
    expect(narrow.sidePaddingPx).toBe(READING_SETTINGS_SPACE_TIGHT_PX);
    expect(wide.sidePaddingPx).toBe(READING_SETTINGS_SPACE_XL_PX);
    // 垂直边距两档相同
    expect(narrow.edgePaddingPx).toBe(10);
    expect(wide.edgePaddingPx).toBe(10);
  });
});

describe('ReadingSettingsPanel.kt L60-86 容器视觉参数', () => {
  const src = kt('ui/reader/ReadingSettingsPanel.kt');
  const css = repoText('src/styles/reader.css');

  it('L60/L62 圆角 `RadiusOverlay` 与遮罩 `PullOutConfig.SCRIM`', () => {
    expect(src).toContain('RoundedCornerShape(DesignTokens.RadiusOverlay)');
    expect(src).toContain('background(Color.Black.copy(alpha = com.example.ui.components.PullOutConfig.SCRIM))');
    expect(READING_SETTINGS_RADIUS_PX).toBe(28);
    expect(css).toContain(`border-radius: ${String(READING_SETTINGS_RADIUS_PX)}px;`);
    expect(css).toContain(`background: rgba(0, 0, 0, ${String(READING_SETTINGS_SCRIM_ALPHA)});`);
  });

  it('L72 `shadow(SpaceTight, ambient .08, spot .10)` 的三个可判定量', () => {
    expect(src).toContain(
      '.shadow(DesignTokens.SpaceTight, shape, clip = false, ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.10f))',
    );
    expect(READING_SETTINGS_SHADOW).toEqual({ elevationPx: 10, ambientAlpha: 0.08, spotAlpha: 0.1 });
    expect(css).toContain(`0 2px 6px rgb(0 0 0 / ${String(READING_SETTINGS_SHADOW.ambientAlpha)})`);
    expect(css).toContain(`0 10px 24px -6px rgb(0 0 0 / ${String(READING_SETTINGS_SHADOW.spotAlpha)})`);
  });

  it('L74-77 `drawPlainBackdrop { blur(SpaceSm.toPx()) }` —— 8px，且**没有** saturate', () => {
    expect(src).toContain('effects = { blur(DesignTokens.SpaceSm.toPx()) }');
    expect(READING_SETTINGS_BLUR_PX).toBe(8);
    expect(css).toContain(`backdrop-filter: blur(${String(READING_SETTINGS_BLUR_PX)}px);`);
    expect(css).toContain(`-webkit-backdrop-filter: blur(${String(READING_SETTINGS_BLUR_PX)}px);`);
  });

  it('L78 `themeColor.copy(alpha = 0.56f)` —— 不是 ReadingGlass 的 .60/.84/0.93', () => {
    expect(src).toContain('.background(themeColor.copy(alpha = 0.56f))');
    expect(READING_SETTINGS_TINT_ALPHA).toBe(0.56);
    expect(css).toContain(`--rd-settings-tint-alpha: ${String(READING_SETTINGS_TINT_ALPHA)};`);
    // 旧的 .93 底色必须已经被替换掉
    expect(css).not.toContain('background-color: var(--rd-surface-93);');
  });

  it('L79 `verticalGradient(white@.10f, Transparent)` —— 两段，末段透明', () => {
    expect(src).toContain(
      '.background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.10f), Color.Transparent)))',
    );
    expect(READING_SETTINGS_SHEEN_ALPHA).toBe(0.1);
    expect(css).toContain(`--rd-settings-sheen: ${String(READING_SETTINGS_SHEEN_ALPHA)};`);
    expect(css).toContain('transparent 100%');
  });

  it('L80 `border(1.dp, contentColor.copy(alpha = 0.12f), shape)`', () => {
    expect(src).toContain('.border(1.dp, contentColor.copy(alpha = 0.12f), shape)');
    expect(READING_SETTINGS_BORDER_WIDTH_PX).toBe(1);
    expect(READING_SETTINGS_BORDER_ALPHA).toBe(0.12);
    expect(css).toContain(`--rd-settings-border-width: ${String(READING_SETTINGS_BORDER_WIDTH_PX)}px;`);
    expect(css).toContain(`--rd-settings-border-alpha: ${String(READING_SETTINGS_BORDER_ALPHA)};`);
  });

  it('L86 仍向面板内部提供 `LocalReadingGlass`（tint/ink 两个变量必须在）', () => {
    expect(src).toContain('LocalReadingGlass provides ReadingGlassStyle(backdrop, themeColor, contentColor)');
    expect(css).toContain('--rd-reading-glass-tint: var(--rd-surface, #232329);');
    expect(css).toContain('--rd-reading-glass-ink: var(--rd-on-surface, #ffffff);');
  });

  it('这个面板不用 ReadingGlass：全文没有 `LocalRenderQuality`、CSS 无画质分支', () => {
    expect(src).not.toContain('LocalRenderQuality');
    expect(src).not.toContain('RenderQuality');
    expect(css).not.toContain('.rd-sheet--settings[data-render-quality=');
    const page = repoText('src/ui/pages/ReaderPage.tsx');
    expect(page).not.toContain('data-render-quality={renderQuality}');
  });

  it('L57 `setDimAmount(0f)`：Android 的窗口 dim 被显式关掉（Web 无系统 dim）', () => {
    expect(src).toContain('window?.setDimAmount(0f)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ MockBookSource.kt L18-95
   ══════════════════════════════════════════════════════════════════════════════ */

describe('MockBookSource.kt L18-47 身份与样本书', () => {
  const src = kt('source/impl/MockBookSource.kt');

  it('L19-26 id / name / 四个 capability（含 environmentOnly）', () => {
    expect(src).toContain('override val id: String = "mock"');
    expect(src).toContain('override val name: String = "Mock 测试书源"');
    expect(src).toContain('environmentOnly = true');
    const source = new MockBookSource();
    expect(source.id).toBe('mock');
    expect(source.name).toBe('Mock 测试书源');
    expect(source.capabilities).toMatchObject({
      supportSearch: true,
      supportDownload: true,
      supportDebug: true,
      environmentOnly: true,
    });
  });

  it('L29-46 两本样书：slug id、epub、cover=null、example.com 下载地址', () => {
    expect(src).toContain('id = "mock/pride-and-prejudice"');
    expect(src).toContain('id = "mock/three-body"');
    expect(src).toContain('author = "Jane Austen"');
    expect(src).toContain('author = "刘慈欣"');
    expect(src).toContain('cover = null');
    expect(src).toContain('downloadUrl = "https://example.com/mock/pride-and-prejudice.epub"');
    expect(src).toContain('downloadUrl = "https://example.com/mock/three-body.epub"');
    expect(src.match(/format = "epub"/g)).toHaveLength(2);
  });

  it('L41 `title = tr("三体 (The Three-Body Problem)")` —— 包了 tr()，英文界面必须跟着变', () => {
    expect(src).toContain('title = tr("三体 (The Three-Body Problem)")');
    try {
      setAppLanguage('en');
      const english = new MockBookSource();
      return english.search('three-body').then((result) => {
        const books = SourceResult.getOrNull(result) ?? [];
        expect(books).toHaveLength(1);
        expect(books[0]?.title).toBe('The Three-Body Problem');
      });
    } finally {
      setAppLanguage('zh');
    }
  });

  it('中文界面下原名逐字保留', () => {
    setAppLanguage('zh');
    expect(tr('三体 (The Three-Body Problem)')).toBe('三体 (The Three-Body Problem)');
  });
});

describe('MockBookSource.kt L49-95 五个接口', () => {
  const source = new MockBookSource();

  it('L50-57 `keyword.isBlank()` 走全量，否则 title/author 双向 `ignoreCase` 过滤', async () => {
    const src = kt('source/impl/MockBookSource.kt');
    expect(src).toContain('val filtered = if (keyword.isBlank()) {');
    expect(src).toContain('it.title.contains(keyword, ignoreCase = true) ||');
    expect(src).toContain('it.author.contains(keyword, ignoreCase = true)');

    expect(SourceResult.getOrNull(await source.search(''))).toHaveLength(2);
    // `isBlank()` 认全空白 → 空关键字
    expect(SourceResult.getOrNull(await source.search('   '))).toHaveLength(2);
    expect(SourceResult.getOrNull(await source.search('\u3000'))).toHaveLength(2);
    // 书名大小写不敏感
    const pride = SourceResult.getOrNull(await source.search('PRIDE')) ?? [];
    expect(pride.map((b) => b.id)).toEqual(['mock/pride-and-prejudice']);
    // 作者命中
    expect((SourceResult.getOrNull(await source.search('austen')) ?? []).map((b) => b.id)).toEqual([
      'mock/pride-and-prejudice',
    ]);
    expect((SourceResult.getOrNull(await source.search('刘慈欣')) ?? []).map((b) => b.id)).toEqual([
      'mock/three-body',
    ]);
    expect(SourceResult.getOrNull(await source.search('zzz'))).toEqual([]);
  });

  it('L61-68 `getDetail` 未命中 → `SourceException.BookNotFound`', async () => {
    const src = kt('source/impl/MockBookSource.kt');
    expect(src).toContain('com.example.source.SourceException.BookNotFound');
    const hit = SourceResult.getOrNull(await source.getDetail('mock/three-body'));
    expect(hit?.author).toBe('刘慈欣');
    expect(hit?.format).toBe('epub');
    const miss = await source.getDetail('mock/nope');
    expect(miss.kind).toBe('error');
    // Kotlin `SourceResult.Error(SourceException.BookNotFound)` —— 是 `object BookNotFound`，
    // 端口用 `class BookNotFound extends SourceException` 保留 instanceof 语义。
    if (miss.kind === 'error') expect(miss.exception).toBeInstanceOf(BookNotFound);
    if (miss.kind === 'error') expect(miss.exception.message).toBe('未能找到对应图书');
  });

  it('L70-82 `getDownloadInfo`：url 回落到 `mock/<id>.epub`，referer 固定 example.com', async () => {
    const src = kt('source/impl/MockBookSource.kt');
    expect(src).toContain('detail.downloadUrl ?: "https://example.com/mock/${detail.id}.epub"');
    expect(src).toContain('referer = "https://example.com/"');
    const info = SourceResult.getOrNull(await source.getDownloadInfo('mock/pride-and-prejudice'));
    expect(info).toMatchObject({
      url: 'https://example.com/mock/pride-and-prejudice.epub',
      fileName: 'Pride and Prejudice',
      format: 'epub',
      referer: 'https://example.com/',
    });
    // 未命中时与 getDetail 同样的 BookNotFound
    const miss = await source.getDownloadInfo('mock/nope');
    expect(miss.kind).toBe('error');
  });

  it('L84-95 login/logout/isLoggedIn/认证态：恒成功、无需登录', async () => {
    const src = kt('source/impl/MockBookSource.kt');
    expect(src).toContain('AuthenticationState.NotRequired');
    expect(SourceResult.getOrNull(await source.login(createLoginCredential()))).toBe(true);
    await expect(source.logout()).resolves.toBeUndefined();
    await expect(source.isLoggedIn()).resolves.toBe(true);
    await expect(source.getAuthenticationState()).resolves.toBe('NotRequired');
  });
});

afterEach(() => {
  setAppLanguage('zh');
});

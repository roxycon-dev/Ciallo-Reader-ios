/**
 * themePaletteScreenParity.test.ts —— 主题配色方案页（`ui/ThemePaletteScreen.kt`，229 行）。
 *
 * 这一页几乎全是几何与配色数值，错一位就「看着不对」：
 *   · 五个标签「蓝紫绿粉橙」必须与两条调色板一一对应；
 *   · 预览色条顺序 + 两个 `lerp(surface, color, .22/.16)`；
 *   · 色块 42dp 高、内部三段 `lerp(.48/.22)`、勾选徽标 18dp@6px、描边 1.6↔0.7；
 *   · 断点 `48·n + 7·(n−1) = 268` 决定「单行 weight」还是「56dp 流式」。
 *
 * 本轮修掉的两处：
 *   ① 勾选徽标贴在色块外沿 2px，而 Kotlin 是 `contentPadding 4dp` + `.padding(2dp)`
 *      → 距外沿 **6px**；
 *   ② 预览区「标题 → 面板」之间没有纵向间距（Kotlin `Column(spacedBy(8.dp))`）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PALETTE,
  OUTLINE_VARIANT_DARK,
  OUTLINE_VARIANT_LIGHT,
  PALETTE_LABELS,
  PALETTE_SIZE,
  SURFACE_CONTAINER_HIGHEST_DARK,
  SURFACE_CONTAINER_HIGHEST_LIGHT,
  hexStateDescription,
  palettePreviewSwatches,
} from '@ui/pages/ThemePalettePage';
import { BASE_PRIMARY_COLORS, BASE_SECONDARY_COLORS, resolveColorScheme } from '@core/ui-theme/theme';
import { mixHex } from '@core/glass/color';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/ThemePaletteScreen.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/pages/ThemePalettePage.tsx', 'utf8');
const CSS = readFileSync('src/styles/themePalette.css', 'utf8');

describe('ThemePaletteScreen.kt：五个标签与两条调色板', () => {
  it('标签是「蓝紫绿粉橙」，与调色板逐项对齐', () => {
    expect(KT).toContain('private val paletteLabels = listOf("蓝", "紫", "绿", "粉", "橙").map { com.example.i18n.tr(it) }');
    expect([...PALETTE_LABELS]).toEqual(['蓝', '紫', '绿', '粉', '橙']);
    expect(PALETTE_SIZE).toBe(5);
    expect(BASE_PRIMARY_COLORS).toHaveLength(5);
    expect(BASE_SECONDARY_COLORS).toHaveLength(5);
    // 标签数必须等于调色板长度（否则 Swatch 的 label 会 undefined）
    expect(PALETTE_LABELS).toHaveLength(BASE_PRIMARY_COLORS.length);
    expect(PALETTE_LABELS).toHaveLength(BASE_SECONDARY_COLORS.length);
  });

  it('默认索引 2（绿），与 Theme.kt 的 colorPrimaryIndex/colorSecondaryIndex 一致', () => {
    expect(KT).toContain('primaryIndex: Int');
    expect(KT).toContain('secondaryIndex: Int');
    expect(DEFAULT_THEME_PALETTE.primaryIndex).toBe(2);
    expect(DEFAULT_THEME_PALETTE.secondaryIndex).toBe(2);
    // 索引 2 就是「绿」
    expect(PALETTE_LABELS[DEFAULT_THEME_PALETTE.primaryIndex]).toBe('绿');
  });

  it('三个分区的编号与拉丁副标题逐字', () => {
    expect(KT).toContain('WenkuSectionHeader("01", "TONAL PALETTE", tr("实时预览"))');
    expect(KT).toContain('"02", "PRIMARY COLOR", com.example.i18n.tr("主色调")');
    expect(KT).toContain('"03", "ACCENT COLOR", com.example.i18n.tr("强调色")');
    expect(TSX).toContain('index="01"');
    expect(TSX).toContain('latin="TONAL PALETTE"');
    expect(TSX).toContain('code="PRIMARY COLOR"');
    expect(TSX).toContain('code="ACCENT COLOR"');
  });

  it('页面标题 / 副标题 / 预览文案逐字', () => {
    expect(KT).toContain('com.example.i18n.tr("主题配色方案")');
    expect(KT).toContain('"APPEARANCE / PALETTE"');
    expect(KT).toContain('tr("Ciallo 阅览室")');
    expect(KT).toContain('com.example.i18n.tr("配色会即时应用到页面、玻璃卡片和控件。")');
    expect(TSX).toContain('Ciallo 阅览室');
    expect(TSX).toContain('配色会即时应用到页面、玻璃卡片和控件。');
  });
});

describe('ThemePaletteScreen.kt：预览色条（L107-121）', () => {
  it('五个色块顺序：primary / secondary / lerp .22 / lerp .16 / surfaceContainerHighest', () => {
    expect(KT).toContain('colors.primary,');
    expect(KT).toContain('colors.secondary,');
    expect(KT).toContain('lerp(colors.surface, colors.primary, .22f)');
    expect(KT).toContain('lerp(colors.surface, colors.secondary, .16f)');
    expect(KT).toContain('colors.surfaceContainerHighest');

    const { colorScheme } = resolveColorScheme({
      colorPrimaryIndex: 2,
      colorSecondaryIndex: 2,
      darkTheme: false,
    });
    const swatches = palettePreviewSwatches(2, 2, false);
    expect(swatches).toHaveLength(5);
    expect(swatches[0]).toBe(colorScheme.primary);
    expect(swatches[1]).toBe(colorScheme.secondary);
    expect(swatches[2]).toBe(mixHex(colorScheme.surface, colorScheme.primary, 0.22));
    expect(swatches[3]).toBe(mixHex(colorScheme.surface, colorScheme.secondary, 0.16));
    expect(swatches[4]).toBe(SURFACE_CONTAINER_HIGHEST_LIGHT);
  });

  it('深浅两套的 surfaceContainerHighest / onSurfaceVariant / outlineVariant', () => {
    expect(SURFACE_CONTAINER_HIGHEST_LIGHT).toBe('#E6E0E9');
    expect(SURFACE_CONTAINER_HIGHEST_DARK).toBe('#36343B');
    expect(palettePreviewSwatches(2, 2, true)[4]).toBe(SURFACE_CONTAINER_HIGHEST_DARK);
    // 选中态描边未选值随主题反转
    expect(OUTLINE_VARIANT_LIGHT).toBe('#CAC4D0');
    expect(OUTLINE_VARIANT_DARK).toBe('#49454F');
    expect(OUTLINE_VARIANT_LIGHT).not.toBe(OUTLINE_VARIANT_DARK);
  });

  it('色条几何：间距 5dp、高 25dp、圆角 3dp', () => {
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(5.dp)');
    expect(KT).toContain('.height(25.dp)');
    expect(KT).toContain('RoundedCornerShape(3.dp)');
    expect(CSS).toContain('gap: 5px;');
    expect(CSS).toContain('height: 25px;');
    expect(CSS).toContain('border-radius: 3px;');
  });

  it('色值播报是 `#RRGGBB` 大写六位（`"#%06X".format(argb and 0xFFFFFF)`）', () => {
    expect(KT).toContain('stateDescription = "#%06X".format(color.toArgb() and 0xFFFFFF)');
    expect(hexStateDescription('#059699')).toBe('#059699');
    expect(hexStateDescription('ff0000')).toBe('#FF0000');
    expect(hexStateDescription('#0a0b0c')).toBe('#0A0B0C');
    // 固定六位（前导零不丢）
    expect(hexStateDescription('#000102')).toBe('#000102');
    expect(hexStateDescription('#05969')).toBe('#005969');
  });
});

describe('ThemePaletteScreen.kt：色块与断点', () => {
  it('断点 = 48·n + 7·(n−1)；n=5 时 268，单行上限 = 82·n + 7·(n−1)', () => {
    expect(KT).toContain('val spacing = 7.dp');
    expect(KT).toContain('if (maxWidth >= 48.dp * palette.size + totalSpacing)');
    expect(KT).toContain('Modifier.widthIn(max = 82.dp * palette.size + totalSpacing).fillMaxWidth()');
    const n = PALETTE_SIZE;
    expect(48 * n + 7 * (n - 1)).toBe(268);
    expect(82 * n + 7 * (n - 1)).toBe(438);
    expect(CSS).toContain('@container (min-width: 268px)');
    expect(CSS).toContain('max-width: 82px;');
    // 窄屏流式分支：固定 56dp
    expect(KT).toContain('palette.indices.forEach { Swatch(it, Modifier.width(56.dp)) }');
    expect(CSS).toContain('flex: 0 0 56px;');
  });

  it('色块 42dp 高、圆角 8、内容内缩 4、内部再裁 4dp、描边 1.6↔0.7', () => {
    expect(KT).toContain('.height(42.dp)');
    expect(KT).toContain('.border(if (checked) 1.6.dp else .7.dp');
    expect(KT).toContain('val shape = RoundedCornerShape(8.dp)');
    expect(KT).toContain('.padding(4.dp).clip(RoundedCornerShape(4.dp))');
    expect(CSS).toContain('height: 42px;');
    expect(CSS).toContain('border-radius: var(--radius-xs, 8px);');
    expect(CSS).toContain('padding: 4px;');
    expect(CSS).toContain('border-radius: 4px;');
    expect(TSX).toContain('borderWidth: props.checked ? 1.6 : 0.7');
  });

  it('色块内部三段 = color / lerp .48 / lerp .22', () => {
    expect(KT).toContain('listOf(color, lerp(colors.surface, color, .48f), lerp(colors.surface, color, .22f))');
    expect(TSX).toContain('mixHex(props.surface, props.color, 0.48)');
    expect(TSX).toContain('mixHex(props.surface, props.color, 0.22)');
    // lerp 的端点语义：t=0 是 surface、t=1 是 color，中间的 .48 必须更靠近 color
    const surface = '#FFFFFF';
    const color = '#059669';
    expect(mixHex(surface, color, 0)).toBe(surface);
    expect(mixHex(surface, color, 1)).toBe(color);
    const deep = mixHex(surface, color, 0.48);
    const light = mixHex(surface, color, 0.22);
    expect(deep).not.toBe(light);
    // 与 Kotlin 同一个 mixHex（`lerp(a, b, t)`）实现：.48 档比 .22 档更暗
    const lum = (hex: string): number => {
      const raw = hex.replace('#', '');
      return parseInt(raw.slice(0, 2), 16) + parseInt(raw.slice(2, 4), 16) + parseInt(raw.slice(4, 6), 16);
    };
    expect(lum(deep)).toBeLessThan(lum(light));
  });

  it('勾选徽标：18dp / 圆角 5 / 底 surface / 勾 14dp / 距外沿 6px / 起始缩放 .72', () => {
    expect(KT).toContain('.padding(2.dp).size(18.dp)');
    expect(KT).toContain('RoundedCornerShape(5.dp)');
    expect(KT).toContain('WenkuIcon(WenkuSymbol.Check, size = 14.dp, tint = colors.onSurface');
    expect(KT).toContain('scaleIn(initialScale = .72f)');
    expect(KT).toContain('scaleOut(targetScale = .72f)');
    expect(CSS).toContain('width: 18px;');
    expect(CSS).toContain('border-radius: 5px;');
    expect(CSS).toContain('transform: scale(0.72);');
    // 4dp 内容内缩 + 2dp = 6px（本轮修：此前 2px）
    expect(CSS).toContain('top: 6px;');
    expect(CSS).toContain('right: 6px;');
    expect(CSS).not.toContain('top: 2px; /* Kotlin L215');
  });

  it('标签：labelSmall、选中 SemiBold、上下 3/2dp', () => {
    expect(KT).toContain('padding(top = 3.dp, bottom = 2.dp)');
    expect(KT).toContain('fontWeight = if (checked) FontWeight.SemiBold else FontWeight.Normal');
    expect(CSS).toContain('padding-top: 3px;');
    expect(CSS).toContain('padding-bottom: 2px;');
    expect(TSX).toContain('fontWeight: props.checked ? 600 : 400');
  });

  it('语义是单选：role=radio + 选中态播报', () => {
    expect(KT).toContain('role = Role.RadioButton');
    expect(KT).toContain('selected = checked');
    expect(KT).toContain('stateDescription = if (checked) tr("已选择") else tr("未选择")');
    expect(KT).toContain('contentDescription = description');
    expect(KT).toContain('description = "$title · $label"');
    expect(TSX).toContain('role="radio"');
    expect(TSX).toContain('aria-checked={props.checked}');
    expect(TSX).toContain("aria-description={props.checked ? '已选择' : '未选择'}");
    expect(TSX).toContain('const description = `${props.title} · ${props.label}`;');
  });
});

describe('ThemePaletteScreen.kt：布局与错峰入场', () => {
  it('外层最大 1060dp；列表内边距 24/12/24/24；条目间距 16', () => {
    expect(KT).toContain('Modifier.widthIn(max = 1060.dp).fillMaxSize()');
    expect(KT).toContain('contentPadding = PaddingValues(start = 24.dp, top = 12.dp, end = 24.dp, bottom = 24.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(16.dp)');
    expect(CSS).toContain('max-width: 1060px;');
    expect(CSS).toContain('gap: 16px;');
    expect(CSS).toContain('margin-top: 12px;');
  });

  it('页序 wenkuPagePart 1/2/3 用于错峰', () => {
    expect(KT).toContain('Box(Modifier.wenkuPagePart(1))');
    expect(KT).toContain('Modifier.wenkuPagePart(2)');
    expect(KT).toContain('Modifier.wenkuPagePart(3)');
    expect(TSX).toContain("['--tp-part' as string]: 1");
    expect(TSX).toContain("['--tp-part' as string]: 2");
    expect(TSX).toContain("['--tp-part' as string]: 3");
    expect(CSS).toContain('calc(var(--tp-part, 1) * 55ms)');
  });

  it('预览区：标题与面板之间 8dp（本轮修：此前没有间距）', () => {
    expect(KT).toContain('Column(verticalArrangement = Arrangement.spacedBy(8.dp))');
    expect(CSS).toContain('.theme-palette__preview-part {');
    expect(CSS).toContain('gap: 8px;');
    expect(CSS).toContain('flex-direction: column;');
  });

  it('预览内容：标题 16sp 600、说明 12sp/16、图标 24dp、内部间距 12 与 10', () => {
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(12.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(10.dp)');
    expect(KT).toContain('WenkuIcon(WenkuSymbol.Book, size = 24.dp');
    expect(CSS).toContain('font-size: 16px;');
    expect(CSS).toContain('font-size: 12px;');
    expect(CSS).toContain('width: 24px;');
  });

  it('减少动态效果时徽标动画直接关掉', () => {
    expect(KT).toContain('enter = if (reduceMotion) EnterTransition.None else fadeIn() + scaleIn(initialScale = .72f)');
    expect(CSS).toContain('.theme-palette__check--instant');
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(TSX).toContain('props.reduceMotion');
  });
});

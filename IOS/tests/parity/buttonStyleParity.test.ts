/**
 * buttonStyleParity.test.ts —— `ui/components/AppButton.kt` 的尺寸 / 变体 / 玻璃参数对拍。
 *
 * 为什么单独一个文件：`AppButton` 是被 100+ 处调用的基础件，它的三组数值
 * （尺寸四元组、Primary 玻璃样式、禁用透明度与阴影）一旦漂移，全站视觉一起歪，
 * 而且编译期完全不报错。此前该文件只有一条 `ADAPTED_NOTES` 备注、没有任何读原文的断言。
 *
 * 断言方式：从 Kotlin 原文**解析**出
 *   · `enum class AppButtonSize(...)` 三个条目的四元组
 *   · `primaryGlassStyle(...)` 里的 10 个具名参数
 * 再与 TS 侧 `APP_BUTTON_SIZES` / `PRIMARY_GLASS_STYLE` 逐值比对。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  APP_BUTTON_DISABLED_ALPHA,
  APP_BUTTON_PRIMARY_VARIANT_MIX,
  APP_BUTTON_SHADOW,
  APP_BUTTON_SIZES,
  APP_BUTTON_VARIANTS,
  PRIMARY_GLASS_STYLE,
  appButtonColors,
  lerpArgbColor,
  primaryGlassCss,
} from '@core/components/appButtonStyle';
import { kotlinEnum } from '@core/enums/kotlinEnums';

import { androidReference } from '../helpers/androidReference';

const APP_BUTTON_KT = 'app/src/main/java/com/example/ui/components/AppButton.kt';
const source = readFileSync(androidReference(APP_BUTTON_KT), 'utf8');

describe('AppButton.kt 的变体与尺寸', () => {
  it('AppButtonVariant：Primary / Secondary / Tertiary / Destructive，顺序一致', () => {
    const entry = kotlinEnum('com/example/ui/components/AppButton.kt', 'AppButtonVariant');
    expect(entry).not.toBeNull();
    const want = (entry?.items ?? []).map((i) => i.name);
    expect(want).toEqual(['Primary', 'Secondary', 'Tertiary', 'Destructive']);
    expect([...APP_BUTTON_VARIANTS]).toEqual(want);
    // Kotlin 侧没有 outline —— Web 追加的 outline 属于 E132 的表单差异，不能混进变体序数
    expect([...APP_BUTTON_VARIANTS]).not.toContain('outline');
  });

  it('AppButtonSize：三档四条数值全部相等（高度 / 横向内边距 / 字号 / 图标）', () => {
    const parsed: { name: string; height: number; pad: number; font: number; icon: number }[] = [];
    const re =
      /(Small|Medium|Large)\(\s*height\s*=\s*(\d+)\.dp,\s*horizontalPadding\s*=\s*(\d+)\.dp,\s*fontSize\s*=\s*(\d+)\.sp,\s*iconSize\s*=\s*(\d+)\.dp\s*\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      parsed.push({
        name: m[1] ?? '',
        height: Number(m[2]),
        pad: Number(m[3]),
        font: Number(m[4]),
        icon: Number(m[5]),
      });
    }
    expect(parsed.map((p) => p.name)).toEqual(['Small', 'Medium', 'Large']);

    for (const item of parsed) {
      const ts = APP_BUTTON_SIZES[item.name as keyof typeof APP_BUTTON_SIZES];
      expect(ts, `TS 缺 ${item.name}`).toBeDefined();
      expect(ts.height, `${item.name}.height`).toBe(item.height);
      expect(ts.horizontalPadding, `${item.name}.horizontalPadding`).toBe(item.pad);
      expect(ts.fontSize, `${item.name}.fontSize`).toBe(item.font);
      expect(ts.iconSize, `${item.name}.iconSize`).toBe(item.icon);
    }
    // 高度必须严格递增（UI 上「小 → 中 → 大」不能乱序）
    const heights = parsed.map((p) => p.height);
    expect(heights[0]).toBeLessThan(heights[1] ?? 0);
    expect(heights[1]).toBeLessThan(heights[2] ?? 0);
  });
});

describe('AppButton.kt 的 Primary 玻璃样式', () => {
  /**
   * 只在 `primaryGlassStyle(...)` 的表达式体内搜索。
   *
   * 该函数是**表达式体**（`... = GlassStyle.Regular.interactive().copy(...)`），
   * 没有 `{ }` 块，所以不能用花括号配平定位；用「起点 + 定长窗口」并在测试里
   * 断言窗口确实覆盖到 `chromaticAberration`（最后一行），窗口不全会直接红。
   * 另外文件里还有 `blurRadius = 48.dp` 的 GlassCard 样式与 `blurRadius = 20.dp` 的本函数，
   * 全局搜索会抓错，所以必须限定窗口。
   */
  const primaryGlassBody = (() => {
    const start = source.indexOf('private fun primaryGlassStyle(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 900);
    expect(body, '窗口没覆盖到函数末尾').toContain('chromaticAberration');
    return body;
  })();

  it('10 个具名参数逐值一致', () => {
    const grab = (name: string): number | null => {
      const m = new RegExp(`${name}\\s*=\\s*(-?[\\d.]+)`).exec(primaryGlassBody);
      return m === null ? null : Number(m[1]);
    };
    expect(grab('blurRadius')).toBe(20);
    expect(PRIMARY_GLASS_STYLE.blurRadiusDp).toBe(20);

    expect(grab('saturation')).toBe(1.5);
    expect(PRIMARY_GLASS_STYLE.saturation).toBe(1.5);

    const refraction = /GlassRefraction\(height\s*=\s*(\d+)\.dp,\s*amount\s*=\s*(\d+)\.dp\)/.exec(primaryGlassBody);
    expect(refraction, 'refraction 没匹配到').not.toBeNull();
    expect(PRIMARY_GLASS_STYLE.refractionHeightDp).toBe(Number(refraction?.[1]));
    expect(PRIMARY_GLASS_STYLE.refractionAmountDp).toBe(Number(refraction?.[2]));

    const highlight = /GlassHighlight\(\s*width\s*=\s*(\d+)\.dp,\s*alpha\s*=\s*([\d.]+)f,\s*lightAngleDegrees\s*=\s*([\d.]+)f/.exec(
      primaryGlassBody,
    );
    expect(highlight, 'highlight 没匹配到').not.toBeNull();
    expect(PRIMARY_GLASS_STYLE.highlightWidthDp).toBe(Number(highlight?.[1]));
    expect(PRIMARY_GLASS_STYLE.highlightAlpha).toBe(Number(highlight?.[2]));
    expect(PRIMARY_GLASS_STYLE.highlightAngleDeg).toBe(Number(highlight?.[3]));

    const tint = /tint\s*=\s*colors\.primary\.copy\(alpha\s*=\s*([\d.]+)f\)/.exec(primaryGlassBody);
    expect(tint).not.toBeNull();
    expect(PRIMARY_GLASS_STYLE.tintAlpha).toBe(Number(tint?.[1]));

    expect(PRIMARY_GLASS_STYLE.noiseAlpha).toBe(grab('noiseAlpha'));
    expect(PRIMARY_GLASS_STYLE.chromaticAberration).toBe(grab('chromaticAberration'));
    // Capsule 形状（Web 侧用 padding-inline 折算的半圆角，这里只断言原始值在）
    expect(primaryGlassBody).toContain('shape = GlassShape.Capsule');
  });

  it('primaryGlassCss 把数值烘进 CSS（blur / saturate / 白高光宽度）', () => {
    const css = primaryGlassCss({ primary: 0x059669, primaryVariant: 0x34d399, accent: 0x2563eb, destructive: 0xdc2626 });
    expect(css.backdropFilter).toContain('blur(20px)');
    expect(css.backdropFilter).toContain('saturate(1.5)');
    expect(css.boxShadow).toContain('3px');
    expect(css.boxShadow).toContain('0.85');
  });
});

describe('AppButton.kt 的禁用态与阴影', () => {
  it('disabledAlpha = 0.4f', () => {
    const m = /val disabledAlpha\s*=\s*([\d.]+)f/.exec(source);
    expect(m, 'disabledAlpha 没匹配到').not.toBeNull();
    expect(APP_BUTTON_DISABLED_ALPHA).toBe(Number(m?.[1]));
    expect(APP_BUTTON_DISABLED_ALPHA).toBe(0.4);
  });

  it('只有 Primary 有阴影：常态 16dp、按下 2dp，其它变体 0', () => {
    expect(source).toContain('if (variant == AppButtonVariant.Primary) animateDpAsState(');
    expect(source).toContain('targetValue = if (pressed && actionable && !reduceMotion) 2.dp else 16.dp');
    expect(APP_BUTTON_SHADOW.primaryPressedDp).toBe(2);
    expect(APP_BUTTON_SHADOW.primaryRestDp).toBe(16);
    expect(APP_BUTTON_SHADOW.otherVariantDp).toBe(0);
    // 断言真实分支：非 Primary 走 `remember { mutableStateOf(0.dp) }`
    expect(source).toContain('else remember { mutableStateOf(0.dp) }');
  });
});

describe('AppButton.kt 的主色派生', () => {
  it('primaryVariant = lerp(themePrimary, Color.White, 0.35f)，lerp 行为与 Compose 一致', () => {
    const m = /lerp\(themePrimary,\s*Color\.White,\s*([\d.]+)f\)/.exec(source);
    expect(m, 'L118 的 lerp 系数没匹配到').not.toBeNull();
    expect(APP_BUTTON_PRIMARY_VARIANT_MIX).toBe(Number(m?.[1]));
    expect(APP_BUTTON_PRIMARY_VARIANT_MIX).toBe(0.35);

    // t = 0 原样、t = 1 全白、通道独立四舍五入
    expect(lerpArgbColor(0x123456, 0xffffff, 0)).toBe(0x123456);
    expect(lerpArgbColor(0x123456, 0xffffff, 1)).toBe(0xffffff);
    expect(lerpArgbColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  it('appButtonColors 的 primaryVariant 就是 lerp 结果', () => {
    const colors = appButtonColors(0x204060, 0x80a0c0, 0xdc2626);
    expect(colors.primary).toBe(0x204060);
    expect(colors.accent).toBe(0x80a0c0);
    expect(colors.destructive).toBe(0xdc2626);
    expect(colors.primaryVariant).toBe(lerpArgbColor(0x204060, 0xffffff, 0.35));
  });
});

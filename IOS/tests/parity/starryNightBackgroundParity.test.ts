/**
 * starryNightBackgroundParity.test.ts —— `ui/components/StarryNightBackground.kt`（75 行 / 70 非空）。
 *
 * 组件本体早就在 `src/ui/components/StarryNightBackground.tsx`，本轮补两处真漂移：
 *   1. 深色档的第二颗色标是 `Color.Transparent`（透明**黑** `#00000000`），端口写成了
 *      `rgba(255,255,255,0)`；浅色档才是 `Color.White.copy(alpha = 0f)`；
 *   2. `isDark` 读的是 `LocalAppDarkTheme.current`（全局主题），端口此前只认 props，
 *      首页 `<StarryNightBackground showLamp backgroundActive />` 根本没传，深色主题
 *      一直拿浅色档的 5%。现在默认读 `<html data-theme>`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { STARRY_COLORS, starryLampGradient } from '@ui/components/StarryNightBackground';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('StarryNightBackground.kt L22-26 五个天穹色', () => {
  const KT = kt('ui/components/StarryNightBackground.kt');

  it('常量逐字一致（含 0xFF 不透明前缀）', () => {
    expect(KT).toContain('val GlassBorderWhite = Color(0xFFE3E5E7)');
    expect(KT).toContain('val GlassBorderDark = Color(0xFF2D2E32)');
    expect(KT).toContain('val GlassWhite = Color(0xFFF4F4F4)');
    expect(KT).toContain('val GlassDark = Color(0xFF222428)');
    expect(KT).toContain('val WarmLampYellow = Color(0xFFFFD166)');
    expect(STARRY_COLORS).toEqual({
      GlassBorderWhite: '#E3E5E7',
      GlassBorderDark: '#2D2E32',
      GlassWhite: '#F4F4F4',
      GlassDark: '#222428',
      WarmLampYellow: '#FFD166',
    });
  });
});

describe('StarryNightBackground.kt L45-68 台灯径向渐变', () => {
  const KT = kt('ui/components/StarryNightBackground.kt');
  const TSX = readFileSync('src/ui/components/StarryNightBackground.tsx', 'utf8');

  it('圆心 (0.5w, 0.3h)、半径 w —— CSS 侧对应 `circle at 50% 30%`', () => {
    expect(KT).toContain('center = Offset(size.width * 0.5f, size.height * 0.3f)');
    expect(KT).toContain('radius = size.width');
    expect(starryLampGradient(false, '#059669')).toContain('circle at 50% 30%');
  });

  it('深色档 12% + Color.Transparent（透明黑），浅色档 5% + 透明白', () => {
    expect(KT).toContain('currentPrimary.copy(alpha = 0.12f)');
    expect(KT).toContain('currentPrimary.copy(alpha = 0.05f)');
    expect(KT).toContain('Color.White.copy(alpha = 0.0f)');
    const dark = starryLampGradient(true, '#059669');
    expect(dark).toContain('rgba(5, 150, 105, 0.12)');
    expect(dark).toContain('rgba(0, 0, 0, 0)');
    expect(dark).not.toContain('rgba(255, 255, 255, 0)');
    const light = starryLampGradient(false, '#059669');
    expect(light).toContain('rgba(5, 150, 105, 0.05)');
    expect(light).toContain('rgba(255, 255, 255, 0)');
    expect(light).not.toContain('rgba(0, 0, 0, 0)');
  });

  it('`LocalAppBackgroundActive` 为真时底色透明（壁纸已经在下面）', () => {
    expect(KT).toContain('if (LocalAppBackgroundActive.current) Color.Transparent else bgColor');
    expect(TSX).toContain("background: backgroundActive ? 'transparent' : background");
  });

  it('`isDark` 默认取 `LocalAppDarkTheme.current`（`<html data-theme>`），不是写死 false', () => {
    expect(KT).toContain('val isDark = com.example.ui.theme.LocalAppDarkTheme.current');
    expect(TSX).toContain("document.documentElement.getAttribute('data-theme') === 'dark'");
    expect(TSX).toContain('const isDark = props.isDark ?? documentDark;');
  });

  it('内容层与渐变层是两个兄弟节点（Canvas 在 Box 内，content 之后）', () => {
    expect(KT).toContain('Canvas(modifier = Modifier.fillMaxSize())');
    expect(KT).toContain('Box(modifier = Modifier.fillMaxSize()) {');
    const lampIndex = TSX.indexOf('starry-night-background__lamp');
    const contentIndex = TSX.indexOf('starry-night-background__content');
    expect(lampIndex).toBeGreaterThan(0);
    expect(contentIndex).toBeGreaterThan(lampIndex);
  });
});
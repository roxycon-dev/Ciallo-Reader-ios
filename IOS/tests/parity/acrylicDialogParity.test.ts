/**
 * acrylicDialogParity.test.ts —— 亚克力弹窗（`ui/components/AcrylicDialog.kt`，201 行）。
 *
 * 三块：`Modifier.acrylicPanel`（双层阴影 + 主题 tint + 颗粒 + 虹彩描边）、
 * `AcrylicDialog`（居中弹窗）、`AcrylicBottomOverlay`（贴底面板）。
 *
 * 本轮修掉的四处漂移：
 *   ① **阴影浓 10 倍**：Kotlin 走 `consistentShadow`，其有效 alpha 还要 ×
 *      `SHADOW_*_ALPHA_GAIN = 0.10`（`ShadowGlow.kt` L229/L230），且 spot 层额外下移
 *      `elevation × 0.28`、`σ = elevation × 0.22`；端口写成 `0 32px 64px primary@0.14`
 *      —— alpha 没折损，还把「高度」当成了「向下偏移 32px」；
 *   ② 面板底色写死 `#FFFFFF`，而 Kotlin 是 `colorScheme.surface`（深色主题下是深灰）；
 *   ③ 多画了一圈 `crystalInnerBevel`：`acrylicPanel` 只调 `filmGrain` + `iridescentBorder`，
 *      `crystalInnerBevel` 全仓唯一调用点是 `GodMomentSheet.kt:221`；
 *   ④ `GlassDialogWindowEffect` 只做 blur，端口却加了 `saturate(1.15)`；
 *      贴底面板还漏了 Kotlin 的四个开关与 `maxHeight * .9f`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SHADOW_AMBIENT_ALPHA_GAIN,
  SHADOW_AMBIENT_BLUR_FACTOR,
  SHADOW_SPOT_ALPHA_GAIN,
  SHADOW_SPOT_BLUR_FACTOR,
  SHADOW_SPOT_OFFSET_FACTOR,
  consistentShadow,
} from '@core/glass/shadowGlow';
import { ACRYLIC_BLUR_DP, acrylicPanelStyle } from '@ui/components/AcrylicDialog';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/AcrylicDialog.kt'),
  'utf8',
);
const SRC = readFileSync('src/ui/components/AcrylicDialog.tsx', 'utf8');
const SHADOW_KT = readFileSync(
  androidReference('app/src/main/java/me/trishiraj/shadowglow/ShadowGlow.kt'),
  'utf8',
);

describe('AcrylicDialog.kt：acrylicPanel 的面板材质', () => {
  it('默认 r24 / surfaceAlpha .50；极简档退化成纯 surface', () => {
    expect(KT).toContain('shape: Shape = RoundedCornerShape(24.dp)');
    expect(KT).toContain('surfaceAlpha: Float = 0.50f');
    expect(KT).toContain('if (LocalRenderQuality.current.minimal) return clip(shape).background(MaterialTheme.colorScheme.surface)');
    const style = acrylicPanelStyle({ primary: '#059669', secondary: '#10B981' });
    expect(style['borderRadius']).toBe('24px');
  });

  it('底色是**主题 surface**（不是白色），alpha 取 surfaceAlpha', () => {
    expect(KT).toContain('val surface = MaterialTheme.colorScheme.surface.copy(alpha = surfaceAlpha)');
    expect(KT).toContain('.background(surface)');
    const light = acrylicPanelStyle({ primary: '#059669', secondary: '#10B981', surface: '#F4F3EF' });
    expect(light['backgroundColor']).toBe('rgba(244, 243, 239, 0.5)');
    const dark = acrylicPanelStyle({ primary: '#059669', secondary: '#10B981', surface: '#1C1C1E' });
    expect(dark['backgroundColor']).toBe('rgba(28, 28, 30, 0.5)');
    // 深色不再退化成白玻璃
    expect(dark['backgroundColor']).not.toBe(light['backgroundColor']);
  });

  it('颗粒 .035 + 虹彩描边 1.5dp @ .38（且**没有**内棱）', () => {
    expect(KT).toContain('.filmGrain(alpha = 0.035f)');
    expect(KT).toContain('width = 1.5.dp');
    expect(KT).toContain('alpha = 0.38f');
    expect(SRC).toContain('filmGrainLayerCss(0.035)');
    expect(SRC).toContain('width: 1.5');
    // `acrylicPanel` 只画 iridescentBorder；bevel 是 GodMomentSheet 自己的追加
    const panelBody = KT.slice(KT.indexOf('fun Modifier.acrylicPanel'), KT.indexOf('/** 统一亚克力弹窗'));
    expect(panelBody).not.toContain('crystalInnerBevel');
    expect(SRC).not.toContain('crystalInnerBevelCss');
  });

  it('两层 consistentShadow：32dp 主题色、8dp 黑色，alpha 都要 ×0.10', () => {
    expect(KT).toContain('elevation = 32.dp');
    expect(KT).toContain('ambientColor = primary.copy(alpha = 0.14f)');
    expect(KT).toContain('spotColor = primary.copy(alpha = 0.18f)');
    expect(KT).toContain('elevation = 8.dp');
    expect(KT).toContain('ambientColor = Color.Black.copy(alpha = 0.18f)');
    expect(KT).toContain('spotColor = Color.Black.copy(alpha = 0.22f)');
    expect(SHADOW_KT).toContain('SHADOW_AMBIENT_ALPHA_GAIN = 0.10f');
    expect(SHADOW_KT).toContain('SHADOW_SPOT_ALPHA_GAIN = 0.10f');
    expect(SHADOW_AMBIENT_ALPHA_GAIN).toBe(0.1);
    expect(SHADOW_SPOT_ALPHA_GAIN).toBe(0.1);

    // 32dp 层：primary 0.14/0.18 → 有效 0.014/0.018
    const primaryRgb: [number, number, number] = [5, 150, 105];
    const layer32 = consistentShadow({
      elevationPx: 32,
      ambientRgb: primaryRgb,
      ambientAlpha: 0.14,
      spotRgb: primaryRgb,
      spotAlpha: 0.18,
    });
    expect(layer32).toContain('0.014');
    expect(layer32).toContain('0.018');
    // 不能出现未折损的 0.14 / 0.18
    expect(layer32).not.toContain('0.14)');
    expect(layer32).not.toContain('0.18)');
    // spot 层比 ambient 层更低（elevation × 0.28 = 8.96）
    expect(layer32).toContain('8.96px');
    // 两层模糊都按 σ = e × 0.22 再 ×2
    expect(SHADOW_AMBIENT_BLUR_FACTOR).toBe(0.22);
    expect(SHADOW_SPOT_BLUR_FACTOR).toBe(0.22);
    expect(SHADOW_SPOT_OFFSET_FACTOR).toBe(0.28);

    const style = acrylicPanelStyle({ primary: '#059669', secondary: '#10B981' });
    const shadow = style['boxShadow'] ?? '';
    // 4 条阴影（两层 × ambient/spot），稀疏到几乎不可见
    expect(shadow.split('rgba(').length - 1).toBe(4);
    expect(shadow).toContain('0.014');
    expect(shadow).not.toContain('0 32px 64px');
  });
});

describe('AcrylicDialog.kt：居中弹窗', () => {
  it('窗口模糊 18dp、内容宽 86%、内边距 24、标题/正文间距 12、按钮区间距 18', () => {
    expect(KT).toContain('val blurPx = with(LocalDensity.current) { 18.dp.toPx() }');
    expect(KT).toContain('.adaptiveDialogWidth(0.86f)');
    expect(KT).toContain('.padding(24.dp)');
    expect(KT).toContain('Spacer(modifier = Modifier.height(12.dp))');
    expect(KT).toContain('Spacer(modifier = Modifier.height(18.dp))');
    expect(ACRYLIC_BLUR_DP).toBe(18);
    expect(SRC).toContain('adaptiveDialogWidthStyle(0.86)');
    expect(SRC).toContain('padding: 24');
    expect(SRC).toContain('height: 12');
    expect(SRC).toContain('height: 18');
  });

  it('按钮顺序：取消 → 8dp → 确认（右对齐）', () => {
    expect(KT).toContain('horizontalArrangement = Arrangement.End');
    expect(KT).toContain('Spacer(modifier = Modifier.width(8.dp))');
    const dismissAt = KT.indexOf('dismissButton?.invoke(');
    const confirmAt = KT.indexOf('confirmButton?.invoke(');
    expect(dismissAt).toBeGreaterThan(0);
    expect(confirmAt).toBeGreaterThan(dismissAt);
    expect(SRC).toContain('width: 8');
  });

  it('点遮罩关闭、点面板不关（`detectTapGestures(onTap = {})` 吞掉点击）', () => {
    expect(KT).toContain('dismissOnClickOutside = false');
    expect(KT).toContain('onClick = { close {} }');
    expect(KT).toContain('detectTapGestures(onTap = {})');
    expect(SRC).toContain('onClick={props.onDismissRequest}');
  });

  it('窗口模糊只有 blur，没有 saturate/colorControls', () => {
    const windowKt = readFileSync(
      androidReference('app/src/main/java/com/example/ui/components/WindowBackdrop.kt'),
      'utf8',
    );
    expect(windowKt).toContain('GlassWindowBlur.acquire(background, owner, blurRadiusPx * progress)');
    expect(windowKt).not.toContain('saturate');
    expect(SRC).not.toContain('saturate(1.15)');
    expect(SRC).toContain('blur(${ACRYLIC_BLUR_DP}px)');
  });
});

describe('AcrylicDialog.kt：贴底面板', () => {
  it('默认顶角 24、surfaceAlpha .40、宽度按 560/840 屏宽分档', () => {
    expect(KT).toContain('shape: Shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)');
    expect(KT).toContain('Modifier.acrylicPanel(shape = shape, surfaceAlpha = 0.40f)');
    expect(KT).toContain('.adaptiveSheetWidth()');
    expect(SRC).toContain('surfaceAlpha: 0.4');
    expect(SRC).toContain('adaptiveSheetWidthStyle(');
    expect(SRC).toContain('borderBottomLeftRadius: 0');
    expect(SRC).toContain('borderBottomRightRadius: 0');
  });

  it('四个开关全部落地：点背景关闭 / 撑满可用高 / 装饰面板 / 纯色遮罩', () => {
    expect(KT).toContain('dismissOnBackgroundClick: Boolean = true');
    expect(KT).toContain('fitAvailableHeight: Boolean = false');
    expect(KT).toContain('decoratePanel: Boolean = true');
    expect(KT).toContain('uniformScrim: Boolean = false');
    expect(KT).toContain('if (dismissOnBackgroundClick) close {}');
    expect(SRC).toContain('dismissOnBackgroundClick');
    expect(SRC).toContain('fitAvailableHeight');
    expect(SRC).toContain('decoratePanel');
    expect(SRC).toContain('uniformScrim');
  });

  it('撑满可用高时高度 = maxHeight × 0.9，且底部留 16dp；否则走 navigationBarsPadding', () => {
    expect(KT).toContain('val sheetHeight = maxHeight * .9f');
    expect(KT).toContain('Modifier.height(sheetHeight)');
    expect(KT).toContain('Modifier.padding(bottom = 16.dp)');
    expect(KT).toContain('.then(if (fitAvailableHeight) Modifier else Modifier.navigationBarsPadding())');
    expect(SRC).toContain("height: '90dvh'");
    expect(SRC).toContain('paddingBottom: 16');
  });

  it('装饰关闭时不挂颗粒与虹彩描边（Kotlin `if (decoratePanel)` 同一处）', () => {
    expect(KT).toContain('.then(if (decoratePanel) Modifier.acrylicPanel(shape = shape, surfaceAlpha = 0.40f) else Mod');
    expect(SRC).toContain('decoratePanel ? panel : {}');
    expect(SRC).toContain("decoratePanel && supportsRealtimeBlur()");
  });
});

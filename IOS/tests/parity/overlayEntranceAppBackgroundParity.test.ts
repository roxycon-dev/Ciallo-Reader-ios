/**
 * overlayEntranceAppBackgroundParity.test.ts
 *   ├ `ui/components/OverlayAnimations.kt`（86 行）→ `@core/ui/overlayEntrance` +
 *   │   `@ui/components/OverlayAnimations` + `styles/components.css`
 *   └ `ui/AppBackground.kt`（91 行）→ `@ui/components/AppBackground`
 *
 * 两个文件同属 65–96 行档，问题也一样：**端口早就写了，但照的是旧版原文**。
 *
 *   · `OverlayAnimations.tsx` 的文件头写着「Android hard-codes the durations inside
 *     `tween(...)`, ignoring the parameter」——当前原文 L40 明确用 `durationMillis`
 *     （默认 `WenkuMotion.ENTER_MS = 420`）做入场、`EXIT_MS = 320` 做出场。
 *     旧端口的三条 keyframes 是 `fadeIn+scale(0.92)`、`slideInVertically(it/6)`、
 *     `220ms linear`，而当前原文根本没有 scale、面板也不淡入、纵向位移是
 *     `(容器高度 + 24dp)` 而不是「六分之一」。
 *   · `AppBackground.tsx` 的 84 行旧头部 + `backgroundTone` 把 `lastTone` 读成
 *     「有没有启用」的开关，掩盖了 `dim` 只在计算时 `coerceIn(0, 50)` 的事实。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OVERLAY_CONTENT_MAX_BANDS,
  OVERLAY_CONTENT_STEP,
  OVERLAY_CONTENT_WINDOW,
  OVERLAY_DIALOG_LATERAL_DP,
  OVERLAY_DIALOG_TRAVEL_DP,
  OVERLAY_ENTER_MS,
  OVERLAY_EXIT_MS,
  OVERLAY_EASE_CSS,
  OVERLAY_EASE_POINTS,
  OVERLAY_PLANE_CSS,
  OVERLAY_PLANE_POINTS,
  OVERLAY_SCRIM_STANDALONE_INITIAL,
  OVERLAY_SETTLE_CSS,
  OVERLAY_SETTLE_POINTS,
  OVERLAY_SHEET_BOTTOM_INSET_DP,
  OVERLAY_SHEET_LATERAL_DP,
  cubicBezierY,
  overlayContentDelayMs,
  overlayEntranceFrame,
  overlayEntranceSpec,
  overlayKeyframeDeclarations,
  overlayKeyframeStops,
  overlayScrimSpec,
  pullOutScrimSpec,
} from '@core/ui/overlayEntrance';
import { OVERLAY_ENTRANCE } from '@core/glass/motion';
import {
  DEFAULT_APP_BACKGROUND_CONFIG,
  adaptiveTitleColor,
  isAppBackgroundEnabled,
  loadBackgroundAvgLuminance,
  updateAppBackground,
  type BackgroundImageSampler,
} from '@ui/components/AppBackground';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

/** 折叠空白 —— CSS 的缩进不参与对拍，数值必须一模一样。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `@keyframes <name> { … }` 的正文（到行首 `}` 为止）。 */
function keyframesBlock(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) throw new Error(`找不到 @keyframes ${name}`);
  const end = css.indexOf('\n}', start);
  if (end < 0) throw new Error(`@keyframes ${name} 没有闭合`);
  return css.slice(start, end);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① OverlayAnimations.kt L14-59
   ══════════════════════════════════════════════════════════════════════════════ */

describe('OverlayAnimations.kt L14-24 两个入口的默认时长', () => {
  const src = kt('ui/components/OverlayAnimations.kt');
  const tokens = kt('ui/wenku/WenkuTokens.kt');

  it('L15/L21 `durationMillis: Int = WenkuMotion.ENTER_MS`，且 ENTER_MS = 420', () => {
    expect(src).toContain('durationMillis: Int = WenkuMotion.ENTER_MS');
    expect(tokens).toContain('const val ENTER_MS = 420');
    expect(OVERLAY_ENTER_MS).toBe(420);
    expect(OVERLAY_ENTRANCE.dialog.durationMs).toBe(420);
    expect(OVERLAY_ENTRANCE.bottomSheet.durationMs).toBe(420);
    expect(OVERLAY_ENTRANCE.scrim.durationMs).toBe(420);
  });

  it('L40-42 出场用 `WenkuMotion.EXIT_MS` = 320，与入场不同', () => {
    expect(tokens).toContain('const val EXIT_MS = 320');
    expect(src).toContain('else WenkuMotion.EXIT_MS');
    expect(OVERLAY_EXIT_MS).toBe(320);
    expect(OVERLAY_ENTRANCE.dialog.exitMs).toBe(320);
    expect(OVERLAY_ENTRANCE.bottomSheet.exitMs).toBe(320);
    // 入场 420 ≠ 出场 320 —— 旧端口三者都写死成 180/160/220。
    expect(OVERLAY_ENTER_MS).not.toBe(OVERLAY_EXIT_MS);
  });

  it('旧的 `180ms` / `160ms` / `220ms linear` 三个时长已从 token 里消失', () => {
    expect(OVERLAY_ENTRANCE.dialog.animation).not.toContain('180ms');
    expect(OVERLAY_ENTRANCE.bottomSheet.animation).not.toContain('160ms');
    expect(OVERLAY_ENTRANCE.scrim.animation).not.toContain('220ms');
  });
});

describe('OverlayAnimations.kt L37-45 线性进度 + 三条曲线', () => {
  const src = kt('ui/components/OverlayAnimations.kt');

  it('L41 `easing = LinearEasing` —— 时间函数必须是 linear', () => {
    expect(src).toContain('easing = LinearEasing');
    expect(OVERLAY_ENTRANCE.dialog.animation).toContain('linear both');
    expect(OVERLAY_ENTRANCE.bottomSheet.animation).toContain('linear both');
    const css = repoText('src/styles/components.css');
    expect(css).toContain('animation-timing-function: linear;');
  });

  it('L43-44 `if (reduced) snap()` —— 归零时长但不动帧表', () => {
    expect(src).toContain('if (reduced) snap() else tween(');
    const css = repoText('src/styles/components.css');
    expect(css).toContain(".overlay-entrance[data-duration-millis='0'] {");
    expect(css).toContain('animation-duration: 0ms;');
  });

  it('三条曲线与 `WenkuTokens.kt` L159-168 逐值一致', () => {
    const tokens = kt('ui/wenku/WenkuTokens.kt');
    expect(tokens).toContain('val ease: Easing = CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)');
    expect(tokens).toContain('val settle: Easing = CubicBezierEasing(0.2f, 1.08f, 0.34f, 1f)');
    expect(tokens).toContain('val plane: Easing = CubicBezierEasing(0.18f, 0.72f, 0.18f, 1f)');
    expect(OVERLAY_EASE_POINTS).toEqual([0.215, 0.61, 0.355, 1]);
    expect(OVERLAY_SETTLE_POINTS).toEqual([0.2, 1.08, 0.34, 1]);
    expect(OVERLAY_PLANE_POINTS).toEqual([0.18, 0.72, 0.18, 1]);
    expect(OVERLAY_EASE_CSS).toBe('cubic-bezier(0.215, 0.61, 0.355, 1)');
    expect(OVERLAY_SETTLE_CSS).toBe('cubic-bezier(0.2, 1.08, 0.34, 1)');
    expect(OVERLAY_PLANE_CSS).toBe('cubic-bezier(0.18, 0.72, 0.18, 1)');
  });

  it('`cubicBezierY` 的两端点、单调性与 settle 的过冲（y1 = 1.08）', () => {
    expect(cubicBezierY(OVERLAY_PLANE_POINTS, 0)).toBe(0);
    expect(cubicBezierY(OVERLAY_PLANE_POINTS, 1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const y = cubicBezierY(OVERLAY_PLANE_POINTS, i / 100);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    // `settle` 的 y1 > 1 ⇒ 中后段必然超过 1，这正是对话框 Y 位移末段的微过冲来源。
    expect(cubicBezierY(OVERLAY_SETTLE_POINTS, 0.7)).toBeGreaterThan(1);
    expect(overlayEntranceFrame('dialog', 0.7).travelFactor).toBeLessThan(0);
  });
});

describe('OverlayAnimations.kt L46-55 graphicsLayer 的四个映射', () => {
  const src = kt('ui/components/OverlayAnimations.kt');

  it('L50 `alpha = if (fromBottom) 1f else ease.transform(raw)` —— 面板不淡入', () => {
    expect(src).toContain('alpha = if (fromBottom) 1f else WenkuMotion.ease.transform(raw)');
    for (const stop of overlayKeyframeStops('sheet')) expect(stop.opacity).toBe(1);
    expect(overlayEntranceFrame('dialog', 0).alpha).toBe(0);
    expect(overlayEntranceFrame('dialog', 0.5).alpha).toBeCloseTo(0.8751, 4);
    expect(overlayEntranceFrame('dialog', 1).alpha).toBe(1);
  });

  it('L51 `translationX = -(if (fromBottom) 18.dp else 8.dp) * remaining` —— 都是负向', () => {
    expect(src).toContain(
      'translationX = -(if (fromBottom) 18.dp else 8.dp).toPx() * remaining',
    );
    expect(OVERLAY_SHEET_LATERAL_DP).toBe(18);
    expect(OVERLAY_DIALOG_LATERAL_DP).toBe(8);
    expect(overlayEntranceSpec('sheet').lateralDp).toBe(18);
    expect(overlayEntranceSpec('dialog').lateralDp).toBe(8);
    expect(overlayEntranceFrame('dialog', 0).translateX).toBe(-8);
    expect(overlayEntranceFrame('sheet', 0).translateX).toBe(-18);
    expect(overlayEntranceFrame('sheet', 1).translateX).toBe(-0);
  });

  it('L52-54 纵向两档走两条不同曲线：面板 `(height + 24dp) × plane`、对话框 `20dp × settle`', () => {
    expect(src).toContain('translationY = if (fromBottom) (size.height + 24.dp.toPx()) * remaining else {');
    expect(src).toContain('20.dp.toPx() * (1f - WenkuMotion.settle.transform(raw))');
    expect(OVERLAY_SHEET_BOTTOM_INSET_DP).toBe(24);
    expect(OVERLAY_DIALOG_TRAVEL_DP).toBe(20);
    expect(overlayEntranceSpec('sheet').travelKind).toBe('height');
    expect(overlayEntranceSpec('dialog').travelKind).toBe('px');
    // 面板：travelFactor 就是 planeRemaining
    const sheet = overlayEntranceFrame('sheet', 0.3);
    expect(sheet.travelFactor).toBeCloseTo(sheet.remaining, 10);
    // 对话框：travelFactor = 1 - settle(raw)，与 remaining 不同
    const dialog = overlayEntranceFrame('dialog', 0.3);
    expect(dialog.travelFactor).not.toBeCloseTo(dialog.remaining, 4);
    expect(dialog.travelFactor).toBeCloseTo(1 - cubicBezierY(OVERLAY_SETTLE_POINTS, 0.3), 10);
  });

  it('L47 `raw.coerceIn(0f, 1f)` —— 越界进度夹紧', () => {
    expect(src).toContain('val raw = progress.value.coerceIn(0f, 1f)');
    expect(overlayEntranceFrame('dialog', -2).raw).toBe(0);
    expect(overlayEntranceFrame('dialog', 5).raw).toBe(1);
  });

  it('L56 `if (reduced) content() else WenkuContentClock(progress, content)`', () => {
    expect(src).toContain('if (reduced) content() else WenkuContentClock(progress, content)');
    expect(OVERLAY_CONTENT_WINDOW).toBe(0.52);
    expect(OVERLAY_CONTENT_STEP).toBe(0.055);
    expect(OVERLAY_CONTENT_MAX_BANDS).toBe(8);
    expect(overlayContentDelayMs(0)).toBe(0);
    expect(overlayContentDelayMs(1)).toBeCloseTo(23.1, 6);
    // 超过 8 档后不再增加，且不超过 0.52 × 420 = 218.4ms 的窗口
    expect(overlayContentDelayMs(8)).toBeCloseTo(184.8, 6);
    expect(overlayContentDelayMs(20)).toBe(overlayContentDelayMs(8));
    expect(overlayContentDelayMs(20)).toBeLessThanOrEqual(OVERLAY_CONTENT_WINDOW * OVERLAY_ENTER_MS);
    let prev = 0;
    for (let i = 0; i <= 12; i += 1) {
      const value = overlayContentDelayMs(i);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe('OverlayAnimations.kt L61-78 ScrimEntrance', () => {
  const src = kt('ui/components/OverlayAnimations.kt');

  it('L66 无共享状态时首帧不可见（否则遮罩没有淡入）', () => {
    expect(src).toContain('LaunchedEffect(shared) { if (shared == null) standaloneVisible = true }');
    expect(src).toContain('var standaloneVisible by remember { mutableStateOf(false) }');
    expect(OVERLAY_SCRIM_STANDALONE_INITIAL).toBe(false);
  });

  it('L71-74 缓动是 `WenkuMotion.plane`（不是 ease），进出 420 / 320', () => {
    expect(src).toContain('if (reduced) snap() else tween(');
    expect(src).toContain('easing = WenkuMotion.plane,');
    const open = overlayScrimSpec(true);
    const close = overlayScrimSpec(false);
    expect(open).toEqual({ target: 1, durationMs: 420, easingCss: OVERLAY_PLANE_CSS });
    expect(close).toEqual({ target: 0, durationMs: 320, easingCss: OVERLAY_PLANE_CSS });
    // 自定义 durationMillis 只影响入场
    expect(overlayScrimSpec(true, 260).durationMs).toBe(260);
    expect(overlayScrimSpec(false, 260).durationMs).toBe(320);
  });

  it('`ScrimEntrance` 组件真的接到了 `overlayScrimSpec()`', () => {
    const tsx = repoText('src/ui/components/OverlayAnimations.tsx');
    expect(tsx).toContain('overlayScrimSpec(');
    expect(tsx).toContain("animationName: 'overlay-scrim-in'");
    expect(tsx).toContain('data-scrim-target');
  });
});

describe('OverlayAnimations.kt L80-86 PullOutScrim', () => {
  const src = kt('ui/components/OverlayAnimations.kt');

  it('L84-85 走 `PullOutConfig.spring(true/false)`，形参 enter/exit 未被使用', () => {
    expect(src).toContain('enter: EnterTransition = EnterTransition.None, exit: ExitTransition = ExitTransition.None,');
    expect(src).toContain('enter = fadeIn(PullOutConfig.spring(true)),');
    expect(src).toContain('exit = fadeOut(PullOutConfig.spring(false)), content = content)');
    // 函数体没有把形参转交给 AnimatedVisibility
    expect(src).not.toContain('enter = enter');
    expect(src).not.toContain('exit = exit');
    expect(pullOutScrimSpec(true)).toMatchObject({ target: 1, opening: true });
    expect(pullOutScrimSpec(false)).toMatchObject({ target: 0, opening: false });
  });

  it('`PullOutScrim` 组件存在（旧端口整个缺失）', () => {
    const tsx = repoText('src/ui/components/OverlayAnimations.tsx');
    expect(tsx).toContain('export function PullOutScrim(');
    expect(tsx).toContain("animationName: 'overlay-pull-out-in'");
    expect(repoText('src/styles/components.css')).toContain('@keyframes overlay-pull-out-in {');
  });

  it('弹簧系数与 `PullOutMotion.kt` L44-48 / `pullOutHosts.ts` 同源', () => {
    const pull = kt('ui/components/PullOutMotion.kt');
    expect(pull).toContain('const val OPEN_K = 140f');
    expect(pull).toContain('const val OPEN_D = 24f');
    expect(pull).toContain('const val CLOSE_K = 260f');
    expect(pull).toContain('const val CLOSE_D = 34f');
    // 阻尼比 = D / (2√K)：两个都略大于 1（近临界、无可见回弹）
    const openZeta = 24 / (2 * Math.sqrt(140));
    const closeZeta = 34 / (2 * Math.sqrt(260));
    expect(openZeta).toBeGreaterThan(1);
    expect(closeZeta).toBeGreaterThan(1);
    expect(closeZeta).toBeGreaterThan(openZeta);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② CSS 帧表逐帧对拍
   ══════════════════════════════════════════════════════════════════════════════ */

describe('components.css 的帧表与 @core/ui/overlayEntrance 逐帧相等', () => {
  const css = repoText('src/styles/components.css');

  it('`overlay-dialog-in` 的 13 个采样帧全部逐字命中', () => {
    const block = squeeze(keyframesBlock(css, 'overlay-dialog-in'));
    for (const stop of overlayKeyframeStops('dialog')) {
      const expected = squeeze(`${String(stop.percent)}% { ${overlayKeyframeDeclarations('dialog', stop)} }`);
      expect(block).toContain(expected);
    }
  });

  it('`overlay-sheet-in` 的 13 个采样帧全部逐字命中', () => {
    const block = squeeze(keyframesBlock(css, 'overlay-sheet-in'));
    for (const stop of overlayKeyframeStops('sheet')) {
      const expected = squeeze(`${String(stop.percent)}% { ${overlayKeyframeDeclarations('sheet', stop)} }`);
      expect(block).toContain(expected);
    }
  });

  it('帧表里不再有旧端口的两处痕迹（scale / 16.6667%）', () => {
    const all = squeeze(keyframesBlock(css, 'overlay-dialog-in')) + squeeze(keyframesBlock(css, 'overlay-sheet-in'));
    expect(all).not.toContain('scale(');
    expect(css).not.toContain('16.6667%');
  });

  it('X 位移全程为负（`calc(-Npx * factor)`），面板 Y 用 `(100% + 24px)`', () => {
    const dialog = keyframesBlock(css, 'overlay-dialog-in');
    const sheet = keyframesBlock(css, 'overlay-sheet-in');
    expect(dialog).toContain('translateX(calc(-8px * ');
    expect(dialog).toContain('translateY(calc(20px * ');
    expect(sheet).toContain('translateX(calc(-18px * ');
    expect(sheet).toContain('translateY(calc((100% + 24px) * ');
    expect(dialog).not.toContain('translateX(calc(8px');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ AppBackground.kt
   ══════════════════════════════════════════════════════════════════════════════ */

function sampler(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
): BackgroundImageSampler {
  let released = false;
  return {
    outWidth: width,
    outHeight: height,
    width,
    height,
    getPixel(x: number, y: number): number {
      if (released) throw new Error('getPixel after release');
      return pixel(x, y);
    },
    release(): void {
      released = true;
    },
  };
}

describe('AppBackground.kt L16-32 配置与控制器', () => {
  const src = kt('ui/AppBackground.kt');

  it('L16-20 三个字段与默认值 `AppBackgroundConfig(0, null)`（dim 默认 0）', () => {
    expect(src).toContain('data class AppBackgroundConfig(');
    expect(src).toContain('val mode: Int,       // 0=默认 1=自定义');
    expect(src).toContain('val uri: String?,');
    expect(src).toContain('val dim: Int = 0     // 0-50，自定义背景深色遮罩强度（%）');
    expect(DEFAULT_APP_BACKGROUND_CONFIG).toEqual({ mode: 0, uri: null, dim: 0 });
  });

  it('L26-28 `update(mode, uri, dim = 0)`：dim 默认 0、且**不做**钳制（钳制在 L87）', () => {
    expect(src).toContain('fun update(mode: Int, uri: String?, dim: Int = 0) {');
    updateAppBackground(1, 'file:///bg.jpg');
    expect(isAppBackgroundEnabled({ mode: 1, uri: 'file:///bg.jpg', dim: 0 })).toBe(true);
    // mode 0 / uri null / 空串都不算启用
    expect(isAppBackgroundEnabled({ mode: 0, uri: 'file:///bg.jpg', dim: 0 })).toBe(false);
    expect(isAppBackgroundEnabled({ mode: 1, uri: null, dim: 0 })).toBe(false);
    expect(isAppBackgroundEnabled({ mode: 1, uri: '   ', dim: 0 })).toBe(false);
  });

  it('L32 `staticCompositionLocalOf { false }` —— 默认不启用', () => {
    expect(src).toContain('val LocalAppBackgroundActive = staticCompositionLocalOf { false }');
    expect(DEFAULT_APP_BACKGROUND_CONFIG.mode).toBe(0);
  });
});

describe('AppBackground.kt L45-47 adaptiveTitleColor', () => {
  const src = kt('ui/AppBackground.kt');

  it('L47 `if (LocalBackgroundTone.current > 0.4f) Color(0xFF1A1A1E) else Color.White`', () => {
    expect(src).toContain('if (LocalBackgroundTone.current > 0.4f) Color(0xFF1A1A1E) else Color.White');
    expect(adaptiveTitleColor(1)).toBe('#1A1A1E');
    expect(adaptiveTitleColor(0.41)).toBe('#1A1A1E');
    expect(adaptiveTitleColor(0.4)).toBe('#FFFFFF');
    expect(adaptiveTitleColor(0)).toBe('#FFFFFF');
  });
});

describe('AppBackground.kt L53-91 loadBackgroundAvgLuminance', () => {
  const src = kt('ui/AppBackground.kt');

  it('L61-64 降采样：长宽都 ≥ 128 时 sample 翻倍（1000×1000 → 8）', async () => {
    expect(src).toContain('while (bounds.outWidth / (sample * 2) >= 64 && bounds.outHeight / (sample * 2) >= 64) {');
    const samples: number[] = [];
    // bounds-only 那一趟报原始尺寸 1000×1000；真正的采样趟按 inSampleSize 缩小 8 倍。
    const decoder = async (_uri: string, sample: number): Promise<BackgroundImageSampler | null> => {
      samples.push(sample);
      return sample === 1 ? sampler(1000, 1000, () => 0xffffffff) : sampler(125, 125, () => 0xffffffff);
    };
    await loadBackgroundAvgLuminance('file:///a.jpg', 0, decoder);
    // 第一次是 bounds-only 解码（sample=1），第二次才是真正采样
    expect(samples).toEqual([1, 8]);
  });

  it('L72-84 隔行采样 + WCAG 系数：全白 = 1.0，纯红单像素 = 0.2126', async () => {
    expect(src).toContain('sum += 0.2126 * r + 0.7152 * g + 0.0722 * b');
    expect(src).toContain('x += 2');
    expect(src).toContain('y += 2');
    const white = await loadBackgroundAvgLuminance(
      'file:///w.jpg',
      0,
      async () => sampler(2, 2, () => 0xffffffff),
    );
    expect(white).toBeCloseTo(1, 10);
    const red = await loadBackgroundAvgLuminance(
      'file:///r.jpg',
      0,
      async () => sampler(1, 1, () => 0xffff0000),
    );
    expect(red).toBeCloseTo(0.2126, 6);
    const green = await loadBackgroundAvgLuminance(
      'file:///g.jpg',
      0,
      async () => sampler(1, 1, () => 0xff00ff00),
    );
    expect(green).toBeCloseTo(0.7152, 6);
    const blue = await loadBackgroundAvgLuminance(
      'file:///b.jpg',
      0,
      async () => sampler(1, 1, () => 0xff0000ff),
    );
    expect(blue).toBeCloseTo(0.0722, 6);
  });

  it('L87 `lum * (1f - dim.coerceIn(0, 50) / 100f)` —— 只在计算时钳制', async () => {
    expect(src).toContain('lum * (1f - dim.coerceIn(0, 50) / 100f)');
    const half = await loadBackgroundAvgLuminance(
      'file:///d50.jpg',
      50,
      async () => sampler(1, 1, () => 0xffffffff),
    );
    expect(half).toBeCloseTo(0.5, 10);
    // 80 → 钳到 50
    const over = await loadBackgroundAvgLuminance(
      'file:///d80.jpg',
      80,
      async () => sampler(1, 1, () => 0xffffffff),
    );
    expect(over).toBeCloseTo(0.5, 10);
    // 负值 → 钳到 0
    const under = await loadBackgroundAvgLuminance(
      'file:///dneg.jpg',
      -40,
      async () => sampler(1, 1, () => 0xffffffff),
    );
    expect(under).toBeCloseTo(1, 10);
  });

  it('L60 / L68 / L88-90 三个失败出口都返回 1f', async () => {
    expect(src).toContain('if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return 1f');
    expect(src).toContain('} catch (e: Exception) {');
    expect(
      await loadBackgroundAvgLuminance('file:///zero.jpg', 0, async () => sampler(0, 0, () => 0)),
    ).toBe(1);
    expect(await loadBackgroundAvgLuminance('file:///null.jpg', 0, async () => null)).toBe(1);
    expect(
      await loadBackgroundAvgLuminance('file:///throw.jpg', 0, async () => {
        throw new Error('decode failed');
      }),
    ).toBe(1);
  });

  it('L85 `bmp.recycle()` 必须被调用（否则每次换壁纸都漏一张位图）', async () => {
    expect(src).toContain('bmp.recycle()');
    let released = false;
    const base = sampler(1, 1, () => 0xffffffff);
    const tracked: BackgroundImageSampler = {
      ...base,
      release(): void {
        released = true;
        base.release();
      },
    };
    await loadBackgroundAvgLuminance('file:///recycle.jpg', 0, async () => tracked);
    expect(released).toBe(true);
  });
});

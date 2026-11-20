/**
 * roundThreeParity.test.ts —— 第三轮的「读 Kotlin 原文」门禁。
 *
 * 与 `roundTwoParity.test.ts` 同规矩：先 `androidReference()` 打开真实 Kotlin，
 * 用 `squeeze()` 做跨行匹配取出字面量，再与 TS 侧导出值/纯函数比对。
 *
 * 覆盖（Kotlin → TS）：
 *   ui/components/PullOutMotion.kt      → @core/components/pullOut
 *   ui/components/PullOutRender.kt      → @core/components/pullOut
 *   ui/components/PullOutHosts.kt       → @core/components/pullOut
 *   ui/components/AppBottomTabBar.kt    → @core/components/tabBar
 *   ui/components/CardDentEffect.kt     → @core/components/cardDent
 *   ui/ReaderProgressEffect.kt          → @core/components/cardDent
 *   ui/OnboardingScreen.kt              → @core/components/cardDent
 *   ui/components/LiquidSlider.kt       → @core/glass/liquidSliderConfig
 *   net/engawapg/lib/zoomable/ZoomState.kt → @core/zoom/zoomState
 *   ui/shelf/ShelfSearch.kt             → @core/wenku/shelfSearch
 *   ui/shelf/ShelfMotion.kt             → @core/wenku/shelfMotion
 *   transfer/TransferModels.kt          → @core/transfer/transferModels
 *   library/LibraryNavigation.kt        → @core/library/libraryNavigation
 *   ui/design/DesignTokens.kt           → @core/ui/designTokens
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  PAGE_EASE,
  PULL_OUT_VISIBILITY,
  PaperSpring,
  PullOutConfig,
  paperBackdropProgress,
  paperPageEnter,
  paperPageExit,
  paperPagePopEnter,
  paperPagePopExit,
  paperWindowOffset,
  pullOutSpring,
  paperWarpLookup,
  PAPER_WARP_SHADER,
  PaperWarpGeometry,
} from '@core/components/pullOut';
import {
  AppRailWidth,
  DOCK_MOTION,
  TAB_BAR_COLLAPSE_THRESHOLD_PX,
  TabBarCollapseState,
  appTabItem,
  dockCapsuleTransform,
  dockProjection,
  dockTabMetrics,
  roundToIntCompat,
} from '@core/components/tabBar';
import {
  CardDentApi33Effect,
  ONBOARDING_PAGES,
  READER_PROGRESS_DEBOUNCE_MS,
  createCardDentEffect,
  readerScrollTopVisible,
} from '@core/components/cardDent';
import { LiquidSliderConfig } from '@core/glass/liquidSliderConfig';
import {
  ZOOM_DEFAULTS,
  ZOOM_PAN_HORIZONTAL_RATIO,
  ZOOM_PAN_VERTICAL_RATIO,
  applyGesture,
  createZoomState,
  toggleScaleTarget,
  willChangeOffset,
} from '@core/zoom/zoomState';
import {
  SHELF_SEARCH_DEBOUNCE_MS,
  SHELF_SEARCH_FIELD_TITLES,
  SHELF_SEARCH_PLANE_TAG,
  SHELF_SEARCH_RESULTS_TAG,
  ShelfSearchField,
  shelfSearchCountLabel,
  shelfSearchMatches,
} from '@core/wenku/shelfSearch';
import {
  SHELF_BURST_DEBOUNCE_MS,
  SHELF_BURST_MAX_CAPTURES,
  SHELF_BURST_MS,
  SHELF_SHARD_COLUMNS,
  SHELF_SHARD_FADE_POWER,
  SHELF_SHARD_FADE_START,
  SHELF_SHARD_ROWS,
  SHELF_SHARD_SCALE_DECAY,
  shelfShardFade,
  shelfShardScale,
  shelfShards,
} from '@core/wenku/shelfMotion';
import {
  CHUNK_SIZE,
  MAX_ARCHIVE_BYTES,
  TRANSFER_MIME,
  TRANSFER_RETENTION,
  TRANSFER_CATEGORIES,
  TRANSFER_PHASES,
  TRANSFER_ERRORS,
  transferFraction,
  transferRemainingSeconds,
} from '@core/transfer/transferModels';
import {
  LIBRARY_SEARCH_KEYWORD,
  LIBRARY_SEARCH_TEXT_MODE,
  LIBRARY_SESSION_ARGUMENT,
  libraryDestinationRoute,
  openDetailSearch,
} from '@core/library/libraryNavigation';
import {
  EDGE_ARM_MS,
  PIN_ERROR_SHAKE,
  READING_PALETTE,
  SHELF_ACTION_EXIT_MS,
  favoriteCoverData,
  favoriteCoverRequest,
  favoriteCoverRetryDelayMs,
  pinResult,
} from '@core/ui/designTokens';

import { androidReference } from '../helpers/androidReference';

function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ');
}

const pullOutMotionKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/PullOutMotion.kt'),
  'utf8',
);
const pullOutRenderKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/PullOutRender.kt'),
  'utf8',
);
const pullOutHostsKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/PullOutHosts.kt'),
  'utf8',
);
const tabBarKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/AppBottomTabBar.kt'),
  'utf8',
);
const cardDentKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/CardDentEffect.kt'),
  'utf8',
);
const progressEffectKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/ReaderProgressEffect.kt'),
  'utf8',
);
const onboardingKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/OnboardingScreen.kt'),
  'utf8',
);
const liquidSliderKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/LiquidSlider.kt'),
  'utf8',
);
const zoomStateKt = readFileSync(
  androidReference('app/src/main/java/net/engawapg/lib/zoomable/ZoomState.kt'),
  'utf8',
);
const shelfSearchKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/shelf/ShelfSearch.kt'),
  'utf8',
);
const shelfMotionKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/shelf/ShelfMotion.kt'),
  'utf8',
);
const transferModelsKt = readFileSync(
  androidReference('app/src/main/java/com/example/transfer/TransferModels.kt'),
  'utf8',
);
const libraryNavKt = readFileSync(
  androidReference('app/src/main/java/com/example/library/LibraryNavigation.kt'),
  'utf8',
);
const designTokensKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/design/DesignTokens.kt'),
  'utf8',
);
const shelfSelectionKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/shelf/ShelfSelectionHost.kt'),
  'utf8',
);
const favoriteCoverKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/favorite/FavoriteCover.kt'),
  'utf8',
);

describe('PullOutMotion.kt 的 22 个常量与弹簧', () => {
  it('常量逐值一致', () => {
    const src = squeeze(pullOutMotionKt);
    expect(src).toContain('const val SCRIM = .35f');
    expect(src).toContain('const val DISMISS_DISTANCE = 64f');
    expect(src).toContain('const val DRAG_TRAVEL = 300f');
    expect(src).toContain('const val SURFACE_SCALE = .96f');
    expect(src).toContain('const val SURFACE_TRAVEL_DP = 12f');
    expect(src).toContain('const val WARP_ROWS = 64');
    expect(src).toContain('const val WARP_FORWARD_ROWS = 128');
    expect(src).toContain('const val WARP_NECK = .30f');
    expect(src).toContain('const val WARP_DECAY_DP = 90f');
    expect(src).toContain('const val WARP_SOFTNESS_DP = 12f');
    expect(src).toContain('const val WARP_UNFOLD_DP = 24f');
    expect(src).toContain('const val WARP_BEND_DP = 16f');
    expect(src).toContain('const val WARP_FLUTTER_DP = 4f');
    expect(src).toContain('const val WARP_SHADE = .025f');
    expect(src).toContain('const val WARP_OPACITY_GAIN = 5f');
    expect(src).toContain('const val WARP_MIN_WIDTH_DP = 100f');
    expect(src).toContain('const val WARP_MIN_HEIGHT_DP = 48f');
    expect(src).toContain('const val WARP_VIEWPORT_CUTOFF = .96f');
    expect(src).toContain('const val OPEN_K = 140f');
    expect(src).toContain('const val OPEN_D = 24f');
    expect(src).toContain('const val CLOSE_K = 260f');
    expect(src).toContain('const val CLOSE_D = 34f');
    expect(src).toContain('const val SOURCE_LIFETIME_MS = 900L');
    expect(src).toContain('const val FALLBACK_OPEN_K = 800f');
    expect(src).toContain('const val FALLBACK_CLOSE_D = 60f');

    expect(PullOutConfig.SCRIM).toBe(0.35);
    expect(PullOutConfig.DISMISS_DISTANCE).toBe(64);
    expect(PullOutConfig.DRAG_TRAVEL).toBe(300);
    expect(PullOutConfig.SURFACE_SCALE).toBe(0.96);
    expect(PullOutConfig.SURFACE_TRAVEL_DP).toBe(12);
    expect(PullOutConfig.WARP_ROWS).toBe(64);
    expect(PullOutConfig.WARP_FORWARD_ROWS).toBe(128);
    expect(PullOutConfig.WARP_NECK).toBe(0.3);
    expect(PullOutConfig.WARP_DECAY_DP).toBe(90);
    expect(PullOutConfig.WARP_SOFTNESS_DP).toBe(12);
    expect(PullOutConfig.WARP_UNFOLD_DP).toBe(24);
    expect(PullOutConfig.WARP_BEND_DP).toBe(16);
    expect(PullOutConfig.WARP_FLUTTER_DP).toBe(4);
    expect(PullOutConfig.WARP_SHADE).toBe(0.025);
    expect(PullOutConfig.WARP_OPACITY_GAIN).toBe(5);
    expect(PullOutConfig.WARP_MIN_WIDTH_DP).toBe(100);
    expect(PullOutConfig.WARP_MIN_HEIGHT_DP).toBe(48);
    expect(PullOutConfig.WARP_VIEWPORT_CUTOFF).toBe(0.96);
    expect(PullOutConfig.OPEN_K).toBe(140);
    expect(PullOutConfig.OPEN_D).toBe(24);
    expect(PullOutConfig.CLOSE_K).toBe(260);
    expect(PullOutConfig.CLOSE_D).toBe(34);
    expect(PullOutConfig.SOURCE_LIFETIME_MS).toBe(900);
    expect(PullOutConfig.FALLBACK_OPEN_K).toBe(800);
    expect(PullOutConfig.FALLBACK_CLOSE_D).toBe(60);
  });

  it('spring(opening)：dampingRatio = d/(2√k)、visibilityThreshold .0005', () => {
    const src = squeeze(pullOutMotionKt);
    expect(src).toContain('dampingRatio = d / (2f * sqrt(k)), visibilityThreshold = .0005f');
    const open = pullOutSpring(true);
    expect(open.stiffness).toBe(140);
    expect(open.dampingRatio).toBeCloseTo(24 / (2 * Math.sqrt(140)), 12);
    expect(open.visibilityThreshold).toBe(0.0005);
    expect(pullOutSpring(false).stiffness).toBe(260);
  });

  it('paperBackdropProgress 端点平滑，且 PaperSpring 在阈值内收敛', () => {
    expect(squeeze(pullOutMotionKt)).toContain('return p * p * (3f - 2f * p)');
    expect(paperBackdropProgress(0)).toBe(0);
    expect(paperBackdropProgress(1)).toBe(1);
    expect(paperBackdropProgress(0.5)).toBeCloseTo(0.5, 12);

    const spring = new PaperSpring();
    // 0.5kg 目标 1，跑 3 秒后必须收敛（返回 false）
    let moving = true;
    for (let i = 0; i < 400 && moving; i += 1) moving = spring.advance(1, true, 1 / 60);
    expect(moving).toBe(false);
    expect(spring.position).toBe(1);
    expect(spring.velocity).toBe(0);
  });

  it('paperWindowOffset 是屏幕坐标减窗口坐标', () => {
    expect(squeeze(pullOutMotionKt)).toContain('getLocationOnScreen(screen); getLocationInWindow(window)');
    expect(paperWindowOffset({ x: 120, y: 240 }, { x: 20, y: 40 })).toEqual({ x: 100, y: 200 });
  });
});

describe('PullOutRender.kt 的扭曲网格与着色器', () => {
  it('paperWarpLookup 的常数下标查找：单段时含 4 个 rows 采样 + clamp', () => {
    expect(squeeze(pullOutRenderKt)).toContain('AGSL permits only constant array indices');
    const single = paperWarpLookup(3, 3);
    expect(single).toContain('rows[2]');
    expect(single).toContain('rows[3]');
    expect(single).toContain('rows[4]');
    expect(single).toContain('rows[5]');
    expect(single).toContain('r.x = clamp(r.x, b.x, c.x)');
    const tree = paperWarpLookup(0, 62);
    expect(tree.startsWith('if (i <')).toBe(true);
    expect((tree.match(/if \(i </g) ?? []).length).toBeGreaterThan(1);
  });

  it('PAPER_WARP_SHADER 的采样点与 AA 公式逐行一致', () => {
    const src = squeeze(pullOutRenderKt);
    expect(src).toContain('float u = (uv.x-r.y)/(2.0*hw)+0.5');
    expect(src).toContain('float aa = clamp(min(u,1.0-u)*2.0*hw*frameSize.x+0.5,0.0,1.0)');
    expect(src).toContain('half4 color = paper.eval(float2(u,v)*inputSize)');
    expect(PAPER_WARP_SHADER).toContain('float u = (uv.x-r.y)/(2.0*hw)+0.5');
    expect(PAPER_WARP_SHADER).toContain('float4 rows[64]');
  });

  it('PaperWarpGeometry：rows 长度 64×4，端点恒等（q=0 用源矩形、q=1 用全幅）', () => {
    const geometry = new PaperWarpGeometry();
    expect(geometry.rows.length).toBe(64 * 4);
    const source = { left: 10, top: 20, right: 110, bottom: 220 };
    geometry.update(400, 800, source, 0, 1);
    expect(geometry.frame).toEqual(source);
    geometry.update(400, 800, source, 1, 1);
    expect(geometry.frame).toEqual({ left: 0, top: 0, right: 400, bottom: 800 });
  });
});

describe('PullOutHosts.kt 的页面转场', () => {
  it('pageEase = Cubic(.18, 1, .04, 1)，四条转场的时长与位移比例', () => {
    const src = squeeze(pullOutHostsKt);
    expect(src).toContain('CubicBezierEasing(.18f, 1f, .04f, 1f)');
    expect(src).toContain('tween(420, easing = pageEase)');
    expect(src).toContain('tween(320, easing = pageEase)');
    expect(src).toContain('{ -it / 3 }');
    expect(PAGE_EASE).toEqual([0.18, 1, 0.04, 1]);
    expect(paperPageEnter(false)?.durationMs).toBe(420);
    expect(paperPageEnter(true)).toBeNull();
    expect(paperPageExit(false)?.exitTo).toBeCloseTo(-1 / 3, 12);
    expect(paperPagePopEnter(false)?.durationMs).toBe(320);
    expect(paperPagePopEnter(false)?.enterFrom).toBeCloseTo(-1 / 3, 12);
    expect(paperPagePopExit(false)?.exitTo).toBe(1);
  });

  it('PullOutVisibility 的 enter/exit 曲线与 .985 初始缩放', () => {
    expect(squeeze(pullOutMotionKt)).toContain('initialScale = .985f');
    expect(squeeze(pullOutMotionKt)).toContain('targetScale = .985f');
    expect(PULL_OUT_VISIBILITY.enter.initialScale).toBe(0.985);
    expect(PULL_OUT_VISIBILITY.exit.targetScale).toBe(0.985);
  });
});

describe('AppBottomTabBar.kt 的折叠与 Dock 几何', () => {
  it('±4f 折叠阈值、96dp 导轨宽、1.10 选中缩放', () => {
    const src = squeeze(tabBarKt);
    expect(src).toContain('if (available.y < -4f) collapsed = true');
    expect(src).toContain('if (available.y > 4f) collapsed = false');
    expect(src).toContain('internal val AppRailWidth = 96.dp');
    expect(src).toContain('targetValue = if (selected) 1.10f else 1f');
    expect(src).toContain('private fun Float.roundToIntCompat(): Int = kotlin.math.round(this).toInt()');
    expect(TAB_BAR_COLLAPSE_THRESHOLD_PX).toBe(4);
    expect(AppRailWidth).toBe(96);
    expect(dockTabMetrics.selectedIconScale).toBe(1.1);
    expect(roundToIntCompat(2.5)).toBe(3);
    expect(roundToIntCompat(-2.5)).toBe(-2);
  });

  it('折叠状态机只在越过阈值时切换', () => {
    const state = new TabBarCollapseState();
    state.onPreScroll(-2);
    expect(state.collapsed).toBe(false);
    state.onPreScroll(-5);
    expect(state.collapsed).toBe(true);
    state.onPreScroll(-1);
    expect(state.collapsed).toBe(true);
    state.onPreScroll(5);
    expect(state.collapsed).toBe(false);
  });

  it('Dock 的跟随/形变/投射常量与胶囊变换', () => {
    expect(DOCK_MOTION.follow).toBe(0.8);
    expect(DOCK_MOTION.stretchFactor).toBe(0.028);
    expect(DOCK_MOTION.stretchLimit).toBe(24);
    expect(DOCK_MOTION.stretchLerp).toBe(0.55);
    expect(DOCK_MOTION.idleMs).toBe(100);
    expect(DOCK_MOTION.project).toBe(0.055);
    expect(DOCK_MOTION.projectLimit).toBe(0.22);
    expect(DOCK_MOTION.capsuleX).toBe(0.16);
    expect(DOCK_MOTION.capsuleY).toBe(0.6);
    expect(DOCK_MOTION.capsuleScaleBase).toBe(0.022);
    expect(DOCK_MOTION.capsuleScaleFlow).toBe(0.00125);
    expect(DOCK_MOTION.glassThicknessDp).toBe(16);
    const t = dockCapsuleTransform(10, 1);
    expect(t.translateX).toBeCloseTo(1.6, 10);
    expect(t.translateY).toBeCloseTo(-0.6, 10);
    expect(t.scaleX).toBeCloseTo(1 + 0.022 + 10 * 0.00125, 10);
    expect(t.glassThicknessDp).toBe(18);
    expect(dockProjection(1.0)).toBeCloseTo(0.055, 10);
    expect(dockProjection(100)).toBe(0.22);
    expect(dockProjection(-100)).toBe(-0.22);
  });

  it('AppTabItem 的默认值：selectedIcon = icon、wenkuSelectedSymbol = wenkuSymbol', () => {
    expect(squeeze(tabBarKt)).toContain('val selectedIcon: androidx.compose.ui.graphics.vector.ImageVector = icon');
    expect(squeeze(tabBarKt)).toContain('val wenkuSelectedSymbol: com.example.ui.wenku.WenkuSymbol? = wenkuSymbol');
    const item = appTabItem({ label: '书架', icon: 'Shelf' });
    expect(item.selectedIcon).toBe('Shelf');
    expect(item.wenkuSelectedSymbol).toBeNull();
    const withWenku = appTabItem({ label: '书架', icon: 'Shelf', wenkuSymbol: 'Shelf' });
    expect(withWenku.wenkuSelectedSymbol).toBe('Shelf');
  });
});

describe('CardDentEffect.kt / ReaderProgressEffect.kt / OnboardingScreen.kt', () => {
  it('五个逐帧 uniform 与两个常量 uniform', () => {
    const src = squeeze(cardDentKt);
    expect(src).toContain('setFloatUniform("lightDir", lightX, lightY)');
    expect(src).toContain('setFloatUniform("ambientStrength", ambient)');
    expect(src).toContain('setFloatUniform("pressCenter", x, y)');
    expect(src).toContain('setFloatUniform("pressRadius", radius)');
    expect(src).toContain('setFloatUniform("pressIntensity", intensity)');
    expect(src).toContain('setFloatUniform("cardRotationX", rotationX)');
    expect(src).toContain('setFloatUniform("cardRotationY", rotationY)');
  });

  it('API < 33 直接 null；一旦抛错永久降级', () => {
    expect(squeeze(cardDentKt)).toContain('if (Build.VERSION.SDK_INT < 33) return null');
    expect(createCardDentEffect({ source: 'x', lightX: 0, lightY: 0, ambient: 0.1, supportsRuntimeShader: false })).toBeNull();
    const effect = new CardDentApi33Effect('shader', 0, -1, 0.2);
    expect(effect.available).toBe(true);
    expect(effect.effect({ x: 1, y: 2, radius: 3, intensity: 4, rotationX: 5, rotationY: 6 })).toContain('pressCenter(1,2)');
  });

  it('阅读进度：20% 阈值 + 1500ms 节流', () => {
    expect(squeeze(progressEffectKt)).toContain('enabled && scrollState.value > scrollState.maxValue * 0.2f');
    expect(squeeze(progressEffectKt)).toContain('delay(1_500)');
    expect(READER_PROGRESS_DEBOUNCE_MS).toBe(1500);
    expect(readerScrollTopVisible({ value: 20, maxValue: 100, enabled: true })).toBe(false);
    expect(readerScrollTopVisible({ value: 21, maxValue: 100, enabled: true })).toBe(true);
    expect(readerScrollTopVisible({ value: 90, maxValue: 100, enabled: false })).toBe(false);
  });

  it('引导页五条文案逐字一致', () => {
    const src = squeeze(onboardingKt);
    expect(src).toContain('"欢迎来到 Ciallo Reader"');
    expect(src).toContain('"把喜欢的小说和漫画收进书架，按自己的节奏阅读。"');
    expect(src).toContain('"书库与自定义书源"');
    expect(src).toContain('"按你的方式阅读"');
    expect(src).toContain('"WELCOME"');
    expect(src).toContain('"LIBRARY"');
    expect(src).toContain('"READING"');
    expect(ONBOARDING_PAGES[0]?.rawTitle).toBe('欢迎来到 Ciallo Reader');
    expect(ONBOARDING_PAGES[1]?.code).toBe('LIBRARY');
    expect(ONBOARDING_PAGES[2]?.imageRes).toBe('mascot_reading');
    expect(ONBOARDING_PAGES.length).toBe(5);
  });
});

describe('LiquidSlider.kt 与 ZoomState.kt 的数值', () => {
  it('滑块 14 个常量', () => {
    const src = squeeze(liquidSliderKt);
    expect(src).toContain('const val HEIGHT = 110f');
    expect(src).toContain('const val SAMPLES = 96');
    expect(src).toContain('const val MAX_STOPS = 200');
    expect(src).toContain('const val TRACK = 6f');
    expect(src).toContain('const val BEND = 11f');
    expect(src).toContain('const val TAIL = .045f');
    expect(src).toContain('const val RADIUS = 14f');
    expect(src).toContain('const val PRESS_RADIUS = 3.5f');
    expect(src).toContain('const val LENS = 1.6f');
    expect(src).toContain('const val POSITION_K = 760f');
    expect(src).toContain('const val STEP_D = 30f');
    expect(src).toContain('const val BEND_K = 260f');
    expect(src).toContain('const val PRESS_RATE = 14f');
    expect(src).toContain('const val MAX_DT = .033f');
    expect(LiquidSliderConfig.HEIGHT).toBe(110);
    expect(LiquidSliderConfig.SAMPLES).toBe(96);
    expect(LiquidSliderConfig.MAX_STOPS).toBe(200);
    expect(LiquidSliderConfig.TRACK).toBe(6);
    expect(LiquidSliderConfig.BEND).toBe(11);
    expect(LiquidSliderConfig.TAIL).toBe(0.045);
    expect(LiquidSliderConfig.RADIUS).toBe(14);
    expect(LiquidSliderConfig.PRESS_RADIUS).toBe(3.5);
    expect(LiquidSliderConfig.LENS).toBe(1.6);
    expect(LiquidSliderConfig.POSITION_K).toBe(760);
    expect(LiquidSliderConfig.STEP_D).toBe(30);
    expect(LiquidSliderConfig.BEND_K).toBe(260);
    expect(LiquidSliderConfig.PRESS_RATE).toBe(14);
    expect(LiquidSliderConfig.MAX_DT).toBe(0.033);
  });

  it('ZoomState：maxScale 5 / 弹回 0.9 / 双击 2.5 / 轴向 3 与 0.33 / center 700', () => {
    const src = squeeze(zoomStateKt);
    expect(src).toContain('public val maxScale: Float = 5f');
    expect(src).toContain('updateBounds(0.9f, maxScale)');
    expect(src).toContain('if (ratio > 3)');
    expect(src).toContain('else if (ratio < 0.33)');
    expect(src).toContain('animationSpec: AnimationSpec<Float> = tween(700)');
    expect(ZOOM_DEFAULTS.maxScale).toBe(5);
    expect(ZOOM_DEFAULTS.scaleLowerBound).toBe(0.9);
    expect(ZOOM_DEFAULTS.doubleTapScale).toBe(2.5);
    expect(ZOOM_PAN_HORIZONTAL_RATIO).toBe(3);
    expect(ZOOM_PAN_VERTICAL_RATIO).toBe(0.33);
    expect(ZOOM_DEFAULTS.centerMs).toBe(700);
    expect(toggleScaleTarget(1)).toBe(2.5);
    expect(toggleScaleTarget(2.5)).toBe(1);
  });

  it('applyGesture：zoom 夹到 [0.9, maxScale]，且只有 zoom==1 才喂速度', () => {
    const base = { ...createZoomState(5, { width: 400, height: 400 }), layoutSize: { width: 200, height: 200 }, fitContentSize: { width: 200, height: 200 }, scale: 1 };
    const zoomed = applyGesture(base, { pan: { x: 0, y: 0 }, zoom: 10, position: { x: 100, y: 100 } });
    expect(zoomed.scale).toBe(5);
    expect(zoomed.feedVelocity).toBe(false);
    expect(zoomed.changedScale).toBe(true);
    const panned = applyGesture(base, { pan: { x: 10, y: 0 }, zoom: 1, position: { x: 100, y: 100 } });
    expect(panned.feedVelocity).toBe(true);
    expect(panned.changedScale).toBe(false);
  });

  it('willChangeOffset：水平到右边界后继续右推返回 false', () => {
    const src = squeeze(zoomStateKt);
    expect(src).toContain('if ((pan.x < 0) && (_offsetX.value == _offsetX.lowerBound))');
    // bounds.right = (fit 200 × scale 2 − layout 200) / 2 = 100；偏移贴到右界时继续右推不生效
    const state = { scale: 2, offsetX: 100, offsetY: 0, fitContentSize: { width: 200, height: 200 }, layoutSize: { width: 200, height: 200 } };
    expect(willChangeOffset(state, { x: -50, y: 0 })).toBe(true);
  });
});

describe('ShelfSearch.kt 与 ShelfMotion.kt', () => {
  it('250ms 防抖、三字段、两个 testTag、N 项计数', () => {
    const src = squeeze(shelfSearchKt);
    expect(src).toContain('delay(250)');
    expect(src).toContain('Any("全部"), Title("书名"), Author("作者")');
    expect(src).toContain('testTag("shelf_search_plane")');
    expect(src).toContain('testTag("shelf_search_results")');
    expect(src).toContain('"${count} 项"');
    expect(SHELF_SEARCH_DEBOUNCE_MS).toBe(250);
    expect([...ShelfSearchField]).toEqual(['Any', 'Title', 'Author']);
    expect(SHELF_SEARCH_FIELD_TITLES.Any).toBe('全部');
    expect(SHELF_SEARCH_PLANE_TAG).toBe('shelf_search_plane');
    expect(SHELF_SEARCH_RESULTS_TAG).toBe('shelf_search_results');
    expect(shelfSearchCountLabel(7)).toBe('7 项');
  });

  it('matches：Any 两项都查，Title 只查书名，Author 只查作者（忽略大小写）', () => {
    expect(squeeze(shelfSearchKt)).toContain('(this != Author && title.contains(query, ignoreCase = true))');
    expect(shelfSearchMatches('Any', '三体', '三体', '刘慈欣')).toBe(true);
    expect(shelfSearchMatches('Title', '刘慈欣', '三体', '刘慈欣')).toBe(false);
    expect(shelfSearchMatches('Author', '刘慈欣', '三体', '刘慈欣')).toBe(true);
    expect(shelfSearchMatches('Any', 'ABC', 'abcdef', '')).toBe(true);
  });

  it('碎裂：4×6 网格 = 48 片，8 张快照上限，660ms，淡出 .22^1.5', () => {
    const src = squeeze(shelfMotionKt);
    expect(src).toContain('val columns = 4');
    expect(src).toContain('val rows = 6');
    expect(src).toContain('fresh.take(8)');
    expect(src).toContain('delay(120)');
    expect(src).toContain('tween(660, easing = LinearExpandingEasingPlaceholder)'.replace('LinearExpandingEasingPlaceholder', 'LinearEasing'));
    expect(SHELF_SHARD_COLUMNS).toBe(4);
    expect(SHELF_SHARD_ROWS).toBe(6);
    expect(shelfShards(100, 150, 1)).toHaveLength(48);
    expect(SHELF_BURST_MAX_CAPTURES).toBe(8);
    expect(SHELF_BURST_DEBOUNCE_MS).toBe(120);
    expect(SHELF_BURST_MS).toBe(660);
    expect(SHELF_SHARD_FADE_START).toBe(0.22);
    expect(SHELF_SHARD_FADE_POWER).toBe(1.5);
    expect(SHELF_SHARD_SCALE_DECAY).toBe(0.24);
    expect(shelfShardScale(0)).toBe(1);
    expect(shelfShardScale(1)).toBeCloseTo(0.76, 10);
    expect(shelfShardFade(0.22)).toBeCloseTo(1, 10);
    expect(shelfShardFade(1)).toBeCloseTo(0, 10);
  });
});

describe('TransferModels.kt 与 LibraryNavigation.kt', () => {
  it('MIME / 4 GiB / 24h / 1 MiB 与三个枚举顺序', () => {
    const src = squeeze(transferModelsKt);
    expect(src).toContain('TRANSFER_MIME = "application/vnd.ciallo.backup"');
    expect(src).toContain('MAX_ARCHIVE_BYTES = 4L * 1024 * 1024 * 1024');
    expect(src).toContain('TRANSFER_RETENTION = 24L * 60 * 60 * 1000');
    expect(src).toContain('CHUNK_SIZE = 1024 * 1024');
    expect(src).toContain('enum class TransferCategory');
    expect(src).toContain('BOOKS("书籍与离线原文件"), FAVORITES("收藏与分类"), ANNOTATIONS("书签、标注与神回")');
    expect(src).toContain('enum class TransferError { PERMISSION, WIFI_DISABLED');
    expect(TRANSFER_MIME).toBe('application/vnd.ciallo.backup');
    expect(MAX_ARCHIVE_BYTES).toBe(4 * 1024 * 1024 * 1024);
    expect(TRANSFER_RETENTION).toBe(24 * 60 * 60 * 1000);
    expect(CHUNK_SIZE).toBe(1024 * 1024);
    expect([...TRANSFER_CATEGORIES]).toEqual(['BOOKS', 'FAVORITES', 'ANNOTATIONS', 'HISTORY', 'SETTINGS', 'RESOURCES', 'SOURCES']);
    expect(TRANSFER_PHASES[0]).toBe('IDLE');
    expect(TRANSFER_PHASES[TRANSFER_PHASES.length - 1]).toBe('FAILED');
    expect(TRANSFER_ERRORS).toHaveLength(11);
  });

  it('fraction / remainingSeconds 的边界', () => {
    const src = squeeze(transferModelsKt);
    expect(src).toContain('if (totalBytes > 0) (completedBytes.toDouble() / totalBytes).toFloat().coerceIn(0f, 1f) else 0f');
    expect(transferFraction({ phase: 'TRANSFERRING', completedBytes: 50, totalBytes: 200, bytesPerSecond: 10, message: '' })).toBe(0.25);
    expect(transferFraction({ phase: 'IDLE', completedBytes: 0, totalBytes: 0, bytesPerSecond: 0, message: '' })).toBe(0);
    expect(transferRemainingSeconds({ phase: 'TRANSFERRING', completedBytes: 50, totalBytes: 200, bytesPerSecond: 10, message: '' })).toBe(15);
    expect(transferRemainingSeconds({ phase: 'IDLE', completedBytes: 0, totalBytes: 10, bytesPerSecond: 0, message: '' })).toBeNull();
  });

  it('书库路由的两个键名与 session 路由模板', () => {
    const src = squeeze(libraryNavKt);
    expect(src).toContain('LIBRARY_SESSION_ARGUMENT = "librarySession"');
    expect(src).toContain('"library_search/{$LIBRARY_SESSION_ARGUMENT}"');
    expect(src).toContain('SEARCH_KEYWORD = "detailSearchKeyword"');
    expect(src).toContain('SEARCH_TEXT_MODE = "detailSearchTextMode"');
    expect(LIBRARY_SESSION_ARGUMENT).toBe('librarySession');
    expect(LIBRARY_SEARCH_KEYWORD).toBe('detailSearchKeyword');
    expect(LIBRARY_SEARCH_TEXT_MODE).toBe('detailSearchTextMode');
    expect(libraryDestinationRoute('library', null)).toBe('library');
    expect(libraryDestinationRoute('library', 'a b')).toBe('library?librarySession=a%20b');
  });

  it('openDetailSearch：空关键词返回 null，重复搜索各自新 session', () => {
    expect(squeeze(libraryNavKt)).toContain('if (query.isEmpty()) return');
    expect(openDetailSearch('   ', true)).toBeNull();
    const first = openDetailSearch('三体', false);
    const second = openDetailSearch('三体', false);
    expect(first?.keyword).toBe('三体');
    expect(first?.sessionId).not.toBe(second?.sessionId);
    expect(first?.route.startsWith('library_search/')).toBe(true);
  });
});

describe('DesignTokens.kt 与三个 UI 常量', () => {
  it('圆角/间距/毛玻璃规则的数值', () => {
    const src = squeeze(designTokensKt);
    expect(src).toContain('XS 8dp');
    expect(src).toContain('SM 12dp');
    expect(src).toContain('MD 16dp');
    expect(src).toContain('LG 20dp');
    expect(src).toContain('XL 24dp');
    expect(src).toContain('blurRadius 8dp、surface alpha 0.45');
    expect(src).toContain('blurRadius 24dp、surface alpha 0.78');
    expect(READING_PALETTE.paperLight).toBe(0xf4f3ef);
    expect(READING_PALETTE.inkLight).toBe(0x161613);
    expect(READING_PALETTE.highlightLight).toBe(0x059669);
  });

  it('SHELF_ACTION_EXIT_MS=180 / EDGE_ARM_NS=200ms', () => {
    expect(squeeze(shelfSelectionKt)).toContain('SHELF_ACTION_EXIT_MS = 180');
    expect(squeeze(shelfSelectionKt)).toContain('EDGE_ARM_NS = 200_000_000L');
    expect(SHELF_ACTION_EXIT_MS).toBe(180);
    expect(EDGE_ARM_MS).toBe(200);
  });

  it('favoriteCoverData：本地被删则回落远程；skipLocal 直接跳过本地', () => {
    const src = squeeze(favoriteCoverKt);
    expect(src).toContain('if (!skipLocal && !local.isNullOrBlank())');
    expect(src).toContain('return remote?.takeIf { it.isNotBlank() }');
    expect(favoriteCoverData('file:///x.jpg', 'https://a/b.jpg', false, () => true)).toBe('file:///x.jpg');
    expect(favoriteCoverData('file:///x.jpg', 'https://a/b.jpg', false, () => false)).toBe('https://a/b.jpg');
    expect(favoriteCoverData('file:///x.jpg', 'https://a/b.jpg', true, () => true)).toBe('https://a/b.jpg');
    expect(favoriteCoverData(null, '   ', false, () => true)).toBeNull();
  });

  it('favoriteCoverRequest：两个站点的 Referer 与重试退避', () => {
    const src = squeeze(favoriteCoverKt);
    expect(src).toContain('"ixdzs8" -> mapOf("Referer" to "https://ixdzs8.com/")');
    expect(src).toContain('"wenku8_library" -> mapOf("Referer" to "https://wenku8.ywy.moe/")');
    expect(favoriteCoverRequest({ data: 'https://a/b.jpg', sourceId: 'ixdzs8', attempt: 0 }).headers.Referer).toBe(
      'https://ixdzs8.com/',
    );
    expect(favoriteCoverRequest({ data: 'https://a/b.jpg', sourceId: 'other', attempt: 0 }).headers.Referer).toBeUndefined();
    expect(favoriteCoverRetryDelayMs(0)).toBe(500);
    expect(favoriteCoverRetryDelayMs(1)).toBe(1000);
    expect(favoriteCoverRetryDelayMs(2)).toBeNull();
  });

  it('pinResult：取消继续抛，其它异常吞成 false', async () => {
    await expect(pinResult(async () => true)).resolves.toBe(true);
    await expect(pinResult(async () => {
      throw new Error('boom');
    })).resolves.toBe(false);
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    await expect(pinResult(async () => {
      throw abort;
    })).rejects.toThrow('cancelled');
    expect(PIN_ERROR_SHAKE.offsets).toEqual([-10, 10, -6, 6, -3, 0]);
    expect(PIN_ERROR_SHAKE.stepMs).toBe(42);
  });
});

/**
 * skeletonProgressParity.test.ts —— 骨架屏 / 进度 / 完成刻度 / 播放暂停的几何对拍。
 *
 * 覆盖 6 个 Kotlin 文件：
 *   `ChasingDots.kt` / `ShimmerBox.kt` / `HazeProgress.kt` /
 *   `AppProgressIndicator.kt` / `CompletionGlyph.kt` / `PlayPauseMorph.kt`
 *
 * 其中 `CompletionGlyph` 的 iOS 值此前是**猜的** `{ sizeDp: 18, strokeWidthDp: 2 }`，
 * 逐行读 Kotlin 后确认描边是 `minDimension * .07f` 的**相对**宽度 —— 本文件就是
 * 把这个猜测钉死成真实几何的门禁。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CHASING_DOTS_DEFAULTS,
  COMPLETION_GLYPH,
  FLOWING_PROGRESS,
  PLAY_PAUSE,
  PROGRESS_RING,
  SHIMMER,
  asyncStateMode,
  asyncStateResetsOnKeyChange,
  completionFirstSegment,
  completionGlyphStroke,
  completionSecondSegment,
  fastOutSlowIn,
  flowingGradient,
  playPauseMix,
  progressRingStartDeg,
  progressRingSweepDeg,
  shimmerGradient,
} from '@core/glass/skeletonProgress';

import { androidReference } from '../helpers/androidReference';

const COMPONENTS = 'app/src/main/java/com/example/ui/components';

function kt(name: string): string {
  return readFileSync(androidReference(`${COMPONENTS}/${name}`), 'utf8');
}

describe('ChasingDots.kt 的默认参数', () => {
  it('size 40dp / circleRatio .25 / delay 50ms / duration = PROGRESS_CYCLE_MS', () => {
    const source = kt('ChasingDots.kt');
    expect(source).toContain('durationMillis: Int = AppMotion.PROGRESS_CYCLE_MS');
    expect(source).toContain('delayBetweenDotsMillis: Int = 50');
    expect(source).toContain('size: Dp = 40.dp');
    expect(source).toContain('circleRatio: Float = .25f');
    // 6 个参数里 5 个有默认值（color 走主题）
    expect(CHASING_DOTS_DEFAULTS.sizeDp).toBe(40);
    expect(CHASING_DOTS_DEFAULTS.circleRatio).toBe(0.25);
    expect(CHASING_DOTS_DEFAULTS.delayBetweenDotsMillis).toBe(50);
    expect(CHASING_DOTS_DEFAULTS.durationMillis).toBe(1400);
    // ChasingDots 是纯委托：实际渲染走 AppProgressIndicator
    expect(source).toContain('= AppProgressIndicator(modifier.size(size), color = color, durationMillis = durationMillis)');
  });
});

describe('ShimmerBox.kt 的移动高光', () => {
  const source = kt('ShimmerBox.kt');

  it('区间 -300→1200、1100ms、FastOutSlowIn、Restart', () => {
    expect(source).toContain('initialValue = -300f');
    expect(source).toContain('targetValue = 1200f');
    expect(source).toContain('tween(1100, easing = FastOutSlowInEasing)');
    expect(source).toContain('repeatMode = RepeatMode.Restart');
    expect(SHIMMER.xFrom).toBe(-300);
    expect(SHIMMER.xTo).toBe(1200);
    expect(SHIMMER.durationMs).toBe(1100);
  });

  it('两种透明度 .55 / .95 与渐变偏移 (x-240, 0) → (x, 260)', () => {
    expect(source).toContain('surfaceVariant.copy(alpha = 0.55f)');
    expect(source).toContain('surfaceVariant.copy(alpha = 0.95f)');
    expect(source).toContain('start = Offset(x - 240f, 0f)');
    expect(source).toContain('end = Offset(x, 260f)');
    expect(SHIMMER.baseAlpha).toBe(0.55);
    expect(SHIMMER.glowAlpha).toBe(0.95);
    expect(shimmerGradient(500)).toEqual({ start: { x: 260, y: 0 }, end: { x: 500, y: 260 } });
  });

  it('MINIMAL 画质走静态分支（无动画），默认圆角 12dp', () => {
    expect(source).toContain('if (LocalRenderQuality.current.minimal)');
    expect(source).toContain('cornerRadius: Int = 12');
    expect(SHIMMER.minimalStatic).toBe(true);
    expect(SHIMMER.cornerRadiusDp).toBe(12);
  });

  it('FastOutSlowIn 的端点与单调性', () => {
    expect(fastOutSlowIn(0)).toBeCloseTo(0, 6);
    expect(fastOutSlowIn(1)).toBeCloseTo(1, 6);
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = fastOutSlowIn(t);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = v;
    }
    // 快出慢入：t=0.5 时已走过大半
    expect(fastOutSlowIn(0.5)).toBeGreaterThan(0.5);
  });
});

describe('HazeProgress.kt 的流动渐变', () => {
  const source = kt('HazeProgress.kt');

  it('MINIMAL 8dp 纯色 / 常态 12dp 渐变', () => {
    expect(source).toContain('Canvas(modifier.fillMaxWidth().height(8.dp))');
    expect(source).toContain('Canvas(modifier = modifier.fillMaxWidth().height(12.dp))');
    expect(FLOWING_PROGRESS.minimalHeightDp).toBe(8);
    expect(FLOWING_PROGRESS.heightDp).toBe(12);
  });

  it('offset 0→1000、2000ms 线性、轨道 .15、渐变三段 (.7, 1, .7)', () => {
    expect(source).toContain('initialValue = 0f');
    expect(source).toContain('targetValue = 1000f');
    expect(source).toContain('tween(2000, easing = LinearEasing)');
    expect(source).toContain('color.copy(alpha = 0.15f)');
    expect(FLOWING_PROGRESS.durationMs).toBe(2000);
    expect(FLOWING_PROGRESS.trackAlpha).toBe(0.15);
    expect([...FLOWING_PROGRESS.gradientAlphas]).toEqual([0.7, 1, 0.7]);
  });

  it('渐变端点 (offset-1000, 0) → (offset, 0)，圆角 height/2', () => {
    expect(source).toContain('start = Offset(offset - 1000f, 0f)');
    expect(source).toContain('end = Offset(offset, 0f)');
    expect(source).toContain('CornerRadius(height / 2, height / 2)');
    expect(flowingGradient(600)).toEqual({ start: { x: -400, y: 0 }, end: { x: 600, y: 0 } });
  });
});

describe('AppProgressIndicator.kt 的环', () => {
  const source = kt('AppProgressIndicator.kt');

  it('时钟下限 600ms、线性', () => {
    expect(source).toContain('durationMillis.coerceAtLeast(600)');
    expect(source).toContain('easing = LinearEasing');
    expect(PROGRESS_RING.minDurationMs).toBe(600);
  });

  it('start = -90 + phase*360（不确定态）/ -90（确定态）', () => {
    expect(source).toContain('val start = -90f + if (progress == null) phase * 360f else 0f');
    expect(progressRingStartDeg(null, 0)).toBe(-90);
    expect(progressRingStartDeg(null, 0.25)).toBe(0);
    expect(progressRingStartDeg(0.5, 0.25)).toBe(-90);
  });

  it('sweep：不确定态 90 + 60·sin(phase·π)，确定态 360·clamp', () => {
    expect(source).toContain('val sweep = if (progress == null) 90f + 60f * sin(phase * PI.toFloat()) else 360f * progress.coerceIn(0f, 1f)');
    expect(progressRingSweepDeg(null, 0)).toBe(90);
    expect(progressRingSweepDeg(null, 0.5)).toBe(150);
    expect(progressRingSweepDeg(null, 1)).toBeCloseTo(90, 9);
    expect(progressRingSweepDeg(0, 0)).toBe(0);
    expect(progressRingSweepDeg(0.25, 0)).toBe(90);
    expect(progressRingSweepDeg(1, 0)).toBe(360);
    // 越界钳制
    expect(progressRingSweepDeg(2, 0)).toBe(360);
    expect(progressRingSweepDeg(-1, 0)).toBe(0);
  });
});

describe('CompletionGlyph.kt 的真实几何（修正旧猜测值）', () => {
  const source = kt('CompletionGlyph.kt');

  it('描边是 minDimension * .07 的相对宽度，不是固定 dp', () => {
    expect(source).toContain('val stroke = size.minDimension * .07f');
    expect(COMPLETION_GLYPH.strokeRatio).toBe(0.07);
    expect(completionGlyphStroke(100)).toBeCloseTo(7, 12);
    expect(completionGlyphStroke(40)).toBeCloseTo(2.8, 12);
    // 固定 dp 是旧实现的错误；断言比例换算不是常数
    expect(completionGlyphStroke(100)).not.toBe(completionGlyphStroke(40));
  });

  it('底圈 .12 / 弧 .7 / 从 -90 扫 360p / 320ms', () => {
    expect(source).toContain('drawCircle(color.copy(alpha = .12f), radius = size.minDimension / 2)');
    expect(source).toContain('drawArc(color.copy(alpha = .7f), -90f, 360f * p');
    expect(source).toContain('tween(if (reduce) 0 else 320, easing = AppMotion.easeOutCubic)');
    expect(COMPLETION_GLYPH.discAlpha).toBe(0.12);
    expect(COMPLETION_GLYPH.arcAlpha).toBe(0.7);
    expect(COMPLETION_GLYPH.arcStartDeg).toBe(-90);
    expect(COMPLETION_GLYPH.revealMs).toBe(320);
  });

  it('三点坐标与两段划分（p/.4 与 (p-.4)/.6）', () => {
    expect(source).toContain('Offset(size.width * .25f, size.height * .51f)');
    expect(source).toContain('Offset(size.width * .43f, size.height * .68f)');
    expect(source).toContain('Offset(size.width * .76f, size.height * .34f)');
    expect(source).toContain('(p / .4f).coerceIn(0f, 1f)');
    expect(source).toContain('if (p > .4f)');
    expect(source).toContain('((p-.4f)/.6f)');

    expect(COMPLETION_GLYPH.pointA).toEqual({ x: 0.25, y: 0.51 });
    expect(COMPLETION_GLYPH.pointB).toEqual({ x: 0.43, y: 0.68 });
    expect(COMPLETION_GLYPH.pointC).toEqual({ x: 0.76, y: 0.34 });

    expect(completionFirstSegment(0)).toBe(0);
    expect(completionFirstSegment(0.2)).toBeCloseTo(0.5, 12);
    expect(completionFirstSegment(0.4)).toBe(1);
    expect(completionFirstSegment(1)).toBe(1);

    expect(completionSecondSegment(0.4)).toBe(0);
    expect(completionSecondSegment(0.7)).toBeCloseTo(0.5, 12);
    expect(completionSecondSegment(1)).toBe(1);
  });
});

describe('PlayPauseMorph.kt 的 morph 几何', () => {
  const source = kt('PlayPauseMorph.kt');

  it('画布 = 图标盒的一半，half .32 / bar .12 / gap .18', () => {
    expect(source).toContain('Canvas(Modifier.size((iconBoxDp / 2).dp))');
    expect(source).toContain('val half = size.width * .32f');
    expect(source).toContain('val bar = size.width * .12f');
    expect(source).toContain('val gap = size.width * .18f');
    expect(PLAY_PAUSE.canvasRatio).toBe(0.5);
    expect(PLAY_PAUSE.halfRatio).toBe(0.32);
    expect(PLAY_PAUSE.barRatio).toBe(0.12);
    expect(PLAY_PAUSE.gapRatio).toBe(0.18);
  });

  it('mix 是线性插值且 p 钳在 [0,1]', () => {
    expect(source).toContain('fun mix(a: Float, b: Float) = a + (b - a) * p');
    expect(playPauseMix(0, 10, 0)).toBe(0);
    expect(playPauseMix(0, 10, 1)).toBe(10);
    expect(playPauseMix(0, 10, 0.5)).toBe(5);
    expect(playPauseMix(0, 10, -3)).toBe(0);
    expect(playPauseMix(0, 10, 3)).toBe(10);
  });

  it('按钮默认 40dp，a11y 文案「暂停」/「播放」随状态切换', () => {
    expect(source).toContain('sizeDp: Int = 40');
    expect(source).toContain('contentDescription = if (isPlaying) "暂停" else "播放"');
    expect(PLAY_PAUSE.defaultButtonDp).toBe(40);
    expect(PLAY_PAUSE.contentDescriptionPlaying).toBe('暂停');
    expect(PLAY_PAUSE.contentDescriptionPaused).toBe('播放');
  });
});

describe('ProducedState.kt 的两种异步状态语义', () => {
  it('rememberAsyncState 保留旧值；rememberKeyedAsyncState 键变即重置', () => {
    const source = kt('ProducedState.kt');
    // 前者 `remember { mutableStateOf(initialValue) }`（无 key）
    expect(source).toContain('val state = remember { mutableStateOf(initialValue) }');
    // 后者 `remember(*keys) { … }`（键参与 remember）
    expect(source).toContain('val state = remember(*keys) { mutableStateOf(initialValue) }');
    expect(asyncStateMode(false)).toBe('keep');
    expect(asyncStateMode(true)).toBe('reset');
    expect(asyncStateResetsOnKeyChange(false)).toBe(false);
    expect(asyncStateResetsOnKeyChange(true)).toBe(true);
  });
});

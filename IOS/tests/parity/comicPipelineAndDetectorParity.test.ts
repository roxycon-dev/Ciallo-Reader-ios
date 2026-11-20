/**
 * comicPipelineAndDetectorParity.test.ts —— 漫画图像管线 / 页面加载 / Z-Library 会话 / 气泡检测的常量与纯函数对拍。
 *
 * 覆盖 4 个 Kotlin 文件：
 *   `ui/comic/ComicImagePipeline.kt`   5 个阈值（最大边 3200、裁边容差 16、扫描边 768、过冲 16、降噪 0.12）
 *   `ui/comic/ComicPageLoader.kt`      5 个缓存/解码预算（解码 2800、缓存堆 1/6、预览 6 MiB、窗口 128 MiB、1/3）
 *   `library/ZLibraryNativeSession.kt` 4 个轮询/超时（5 次、10 次、2500ms、30000ms）
 *   `mangatranslate/BubbleDetector.kt` 4 个检测常量 + `letterboxInverseX/Y` + `retainLargestConnectedComponent`
 *
 * iOS 侧这些常量大多是**模块内 `const`（没有 export）**，所以从两侧源码文本解析后对拍；
 * 纯函数则直接 import 真实实现断言行为。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DECODE_MAX_EDGE } from '@core/comic/comicPageLoader';
import {
  BUBBLE_INPUT_SIZE,
  BUBBLE_IOU_THRESHOLD,
  BUBBLE_MAX_CONTOUR_SAMPLES,
  BUBBLE_MIN_CONFIDENCE,
  letterboxInverseX,
  letterboxInverseY,
  retainLargestConnectedComponent,
} from '@core/mangatranslate/bubbleDetector';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function ktSource(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

function tsSource(rel: string): string {
  return readFileSync(rel, 'utf8');
}

/** 从 Kotlin 抽 `const val NAME = <数值>`；支持 `6 shl 20` 与算术表达式。 */
function ktNumber(source: string, name: string): number | null {
  const re = new RegExp(
    `const\\s+val\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*(0[xX][0-9a-fA-F]+|[\\d_.]+(?:\\s*(?:shl|shr|\\*|/|\\+|-)\\s*[\\d_.]+)*)`,
  );
  const m = re.exec(source);
  if (m === null) return null;
  const raw = (m[1] ?? '').replace(/_/g, '').replace(/(\d)[fFlLdD]\b/g, '$1').replace(/\s+/g, ' ').trim();
  if (/^0[xX]/.test(raw)) return Number.parseInt(raw, 16);
  // `6 shl 20` → 6 * 2**20
  const shl = /^(\d+) shl (\d+)$/.exec(raw);
  if (shl !== null) return Number(shl[1]) * 2 ** Number(shl[2]);
  if (!/^[\d.\s*/()+ -]+$/.test(raw)) return null;
  try {
    const value = Function(`"use strict";return (${raw});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** 从 TS 抽 `const NAME = <数值>`（含 export / static readonly）。 */
function tsNumber(source: string, name: string): number | null {
  const re = new RegExp(
    `(?:export\\s+)?(?:static\\s+)?(?:const|readonly)\\s+${name}\\s*(?::[^=]+)?=\\s*(0[xX][0-9a-fA-F_]+|-?[\\d_]+(?:\\.[\\d_]+)?(?:[eE][-+]?\\d+)?)(?:\\s*[*/]\\s*(?:0[xX][0-9a-fA-F_]+|-?[\\d_]+(?:\\.[\\d_]+)?))*[ \\t]*(?=;|$)`,
    'm',
  );
  const m = re.exec(source);
  if (m === null) return null;
  const raw = (m[1] ?? '').replace(/_/g, '').trim();
  if (/^0[xX]/.test(raw)) return Number.parseInt(raw, 16);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

describe('ComicImagePipeline.kt 的 5 个阈值', () => {
  const kt = ktSource('ui/comic/ComicImagePipeline.kt');
  const ts = tsSource('src/core/comic/comicImagePipeline.ts');

  it('全部与 Kotlin 原文逐值一致', () => {
    for (const name of ['MAX_EDGE', 'CROP_TOLERANCE', 'CROP_SCAN_MAX_EDGE', 'OVERSHOOT_CLAMP', 'ANIME4K_FLAT_DENOISE']) {
      const ktValue = ktNumber(kt, name);
      const tsValue = tsNumber(ts, name);
      expect(ktValue, `${name} 没从 Kotlin 解析到`).toBeTypeOf('number');
      expect(tsValue, `${name} 没从 iOS 解析到`).toBeTypeOf('number');
      expect(tsValue, `${name} 与 Kotlin 不同值`).toBe(ktValue);
    }
  });

  it('语义关系：解码上限 > 裁边扫描上限（先大图解码再小图扫描）', () => {
    const maxEdge = ktNumber(kt, 'MAX_EDGE') ?? 0;
    const scanEdge = ktNumber(kt, 'CROP_SCAN_MAX_EDGE') ?? 0;
    expect(maxEdge).toBe(3200);
    expect(scanEdge).toBe(768);
    expect(scanEdge).toBeLessThan(maxEdge);
    // 裁边容差 16 与过冲限幅 16 恰好同值，但语义不同（一个比像素差、一个比通道值）
    expect(ktNumber(kt, 'CROP_TOLERANCE')).toBe(16);
    expect(ktNumber(kt, 'OVERSHOOT_CLAMP')).toBe(16);
    expect(ktNumber(kt, 'ANIME4K_FLAT_DENOISE')).toBe(0.12);
  });
});

describe('ComicPageLoader.kt 的 5 个预算', () => {
  const kt = ktSource('ui/comic/ComicPageLoader.kt');
  const ts = tsSource('src/core/comic/comicPageLoader.ts');

  it('解码长边 2800 / 缓存堆 1/6 / 预览 6 MiB / 窗口 128 MiB 与 1/3', () => {
    expect(ktNumber(kt, 'DECODE_MAX_EDGE')).toBe(2800);
    expect(DECODE_MAX_EDGE).toBe(2800);

    for (const name of ['CACHE_FRACTION', 'WINDOW_RETAIN_FRACTION']) {
      const ktValue = ktNumber(kt, name);
      expect(ktValue, `${name} 没从 Kotlin 解析到`).toBeTypeOf('number');
      expect(tsNumber(ts, name), `${name} 与 Kotlin 不同值`).toBe(ktValue);
    }
    expect(ktNumber(kt, 'CACHE_FRACTION')).toBe(6);
    expect(ktNumber(kt, 'WINDOW_RETAIN_FRACTION')).toBe(3);
  });

  it('两个字节预算是 shl 表达式：6 MiB 与 128 MiB', () => {
    // Kotlin：`6 shl 20` / `128 shl 20`
    expect(ktNumber(kt, 'PREVIEW_CACHE_BYTES')).toBe(6 * 1024 * 1024);
    expect(ktNumber(kt, 'PREVIEW_CACHE_BYTES')).toBe(6_291_456);
    expect(ktNumber(kt, 'WINDOW_RETAIN_CEIL_BYTES')).toBe(128 * 1024 * 1024);
    expect(ktNumber(kt, 'WINDOW_RETAIN_CEIL_BYTES')).toBe(134_217_728);
    // 窗口上限必须远大于预览缓存（窗口是「整章留存」的上限）
    expect(ktNumber(kt, 'WINDOW_RETAIN_CEIL_BYTES') ?? 0).toBeGreaterThan((ktNumber(kt, 'PREVIEW_CACHE_BYTES') ?? 0) * 10);
  });
});

describe('ZLibraryNativeSession.kt 的 4 个超时', () => {
  const kt = ktSource('library/ZLibraryNativeSession.kt');
  const ts = tsSource('src/core/library/zLibraryNativeSession.ts');

  it('轮询 5 次 / 挑战 10 次 / 间隔 2500ms / 搜索超时 30000ms', () => {
    for (const name of ['MAX_POLL_TRIES', 'MAX_CHALLENGE_POLL_TRIES', 'POLL_DELAY_MS', 'SEARCH_TIMEOUT_MS']) {
      const ktValue = ktNumber(kt, name);
      expect(ktValue, `${name} 没从 Kotlin 解析到`).toBeTypeOf('number');
      expect(tsNumber(ts, name), `${name} 与 Kotlin 不同值`).toBe(ktValue);
    }
    expect(ktNumber(kt, 'MAX_POLL_TRIES')).toBe(5);
    expect(ktNumber(kt, 'MAX_CHALLENGE_POLL_TRIES')).toBe(10);
    expect(ktNumber(kt, 'POLL_DELAY_MS')).toBe(2500);
    expect(ktNumber(kt, 'SEARCH_TIMEOUT_MS')).toBe(30_000);
  });

  it('挑战轮询比普通轮询多一倍，且 5 次 × 2500ms = 12.5s < 30s 搜索超时', () => {
    const poll = ktNumber(kt, 'MAX_POLL_TRIES') ?? 0;
    const challenge = ktNumber(kt, 'MAX_CHALLENGE_POLL_TRIES') ?? 0;
    const delay = ktNumber(kt, 'POLL_DELAY_MS') ?? 0;
    const timeout = ktNumber(kt, 'SEARCH_TIMEOUT_MS') ?? 0;
    expect(challenge).toBe(poll * 2);
    expect(poll * delay).toBeLessThan(timeout);
    // 挑战轮询则可能超过（这正是要单独给更长预算的原因）
    expect(challenge * delay).toBeLessThanOrEqual(timeout);
  });
});

describe('BubbleDetector.kt 的常量与两个纯函数', () => {
  const kt = ktSource('mangatranslate/BubbleDetector.kt');

  it('输入 1472 / 置信度 0.15 / IoU 0.65 / 轮廓样本 48（iOS 用 BUBBLE_ 前缀）', () => {
    expect(ktNumber(kt, 'INPUT_SIZE')).toBe(1472);
    expect(ktNumber(kt, 'MIN_CONFIDENCE')).toBe(0.15);
    expect(ktNumber(kt, 'IOU_THRESHOLD')).toBe(0.65);
    expect(ktNumber(kt, 'MAX_CONTOUR_SAMPLES')).toBe(48);

    expect(BUBBLE_INPUT_SIZE).toBe(1472);
    expect(BUBBLE_MIN_CONFIDENCE).toBe(0.15);
    expect(BUBBLE_IOU_THRESHOLD).toBe(0.65);
    expect(BUBBLE_MAX_CONTOUR_SAMPLES).toBe(48);
    // 1472 是 32 的倍数（YOLO 的 stride 38 与 32 通道 proto 都要求对齐）
    expect(BUBBLE_INPUT_SIZE % 32).toBe(0);
    expect(BUBBLE_IOU_THRESHOLD).toBeGreaterThan(BUBBLE_MIN_CONFIDENCE);
  });

  it('letterboxInverseX/Y 是 (v - pad) / gain', () => {
    expect(kt).toContain('(inputX - pre.padX) / pre.gainX');
    expect(kt).toContain('(inputY - pre.padY) / pre.gainY');
    const pre = { padX: 120, padY: 60, gainX: 2, gainY: 1.5 };
    expect(letterboxInverseX(320, pre)).toBe(100);
    expect(letterboxInverseY(210, pre)).toBe(100);
    // gain = 1 / pad = 0 时是恒等变换
    expect(letterboxInverseX(77, { padX: 0, padY: 0, gainX: 1, gainY: 1 })).toBe(77);
  });

  it('retainLargestConnectedComponent：8 邻域 BFS，保留最大一片，边界情况返回 null', () => {
    expect(kt).toContain('if (width <= 0 || height <= 0 || foreground.size != width * height) return null');
    // 2×3：上行两格一片（2 像素）、下行一格一片（1 像素），两片不相邻 → 保留上面那片
    const grid = [true, true, false, false, false, true];
    expect(retainLargestConnectedComponent(grid, 2, 3)).toEqual([true, true, false, false, false, false]);
    // 8 邻域：对角相连算同一片 → 2×2 的左下与右上仍属一片，全保留
    const diag = [false, true, true, false];
    expect(retainLargestConnectedComponent(diag, 2, 2)).toEqual(diag);
    // 全空 → null（Kotlin L400 `if (largestLabel == 0) return null`）
    expect(kt).toContain('if (largestLabel == 0) return null');
    expect(retainLargestConnectedComponent([false, false, false, false], 2, 2)).toBeNull();
    // 尺寸不符 / 空尺寸 → null
    expect(retainLargestConnectedComponent([true, true], 3, 3)).toBeNull();
    expect(retainLargestConnectedComponent([], 0, 0)).toBeNull();
  });
});

/**
 * roundTwoParity.test.ts —— 第二轮新增模块的「读 Kotlin 原文」门禁。
 *
 * 每条断言都先用 `androidReference()` 打开**真实 Kotlin 文件**，用正则从源码里取字面量，
 * 再与 TS 侧导出的常量/纯函数结果比对。禁止「按文档描述写断言」。
 *
 * 覆盖（Kotlin → TS）：
 *   me/trishiraj/shadowglow/ShadowGlow.kt          → @core/glass/shadowGlow
 *   me/trishiraj/shadowglow/ShadowBlurEngine.kt    → @core/glass/shadowBlurEngine
 *   me/trishiraj/shadowglow/ShadowScratchPool.kt   → @core/glass/shadowScratchPool
 *   transfer/NearbyHandshake.kt                    → @core/transfer/nearby
 *   source/ComicChapterTitle.kt                    → @core/source/sourceText
 *   ui/wenku/WenkuMenuHost.kt                      → @core/wenku/menuGeometry
 *   ui/ReaderPagination.kt                         → @core/reader/paginationEnvironment
 *   data/AppUpdateAutoCheck.kt / AppUpdateDownload.kt → @core/data/appUpdate
 *   library/DownloadIndicatorState.kt              → @core/library/downloadIndicatorState
 *   ui/components/LiquidSegmentPhysics.kt          → @core/glass/liquidSegmentPhysics
 *   ui/components/LiquidSegmentShader.kt           → @core/glass/liquidSegmentShader
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BLUR_RADIUS_TO_SIGMA,
  SHADOW_AMBIENT_ALPHA_GAIN,
  SHADOW_AMBIENT_BLUR_FACTOR,
  SHADOW_SPOT_ALPHA_GAIN,
  SHADOW_SPOT_BLUR_FACTOR,
  SHADOW_SPOT_OFFSET_FACTOR,
  blurRadiusToSigma,
  consistentShadowLayers,
} from '@core/glass/shadowGlow';
import {
  SHADOW_MASK_CACHE_BYTES_ANIMATED,
  SHADOW_MASK_CACHE_BYTES_STATIC,
  SHADOW_MASK_MAX_SIDE,
  boxBlurHorizontal,
  halfPx,
  maskBitmapSize,
  pickMaskScale,
  sigmaToBoxRadius,
} from '@core/glass/shadowBlurEngine';
import { ShadowScratchPool } from '@core/glass/shadowScratchPool';
import {
  NEARBY_ID_MAX,
  NEARBY_MAGIC,
  NEARBY_NAME_MAX,
  NEARBY_PORT,
  NEARBY_UTF_LIMIT,
  NEARBY_VERSION,
  readNearbyOffer,
  writeNearbyOffer,
} from '@core/transfer/nearby';
import { ComicChapterTitle, comicChapterNumber } from '@core/source/sourceText';
import {
  WENKU_MENU_CONTENT_THRESHOLD,
  WENKU_MENU_HIT_THRESHOLD,
  WenkuMenuStaggerEnd,
  WenkuMenuStaggerMaxOrder,
  WenkuMenuStaggerStart,
  WenkuMenuStaggerStep,
  wenkuMenuTargetRect,
  wenkuStaggerPartWindow,
  wenkuMenuCurrentRect,
} from '@core/wenku/menuGeometry';
import {
  EAGER_CHAPTER_THRESHOLD,
  LARGE_CHAPTER_THRESHOLD,
  PAGE_TEXT_BOTTOM_PADDING_DP,
  PAGE_VERTICAL_PADDING_DP,
  PAGINATION_CHUNK_CHARS,
  TITLE_BLOCK_PADDING_DP,
  pageIndexAtOffset,
  paginationChunkRanges,
  paginationImageTokenRanges,
  shouldCelebrateAfterForwardTurn,
} from '@core/reader/paginationEnvironment';
import {
  GITHUB_DOWNLOAD_HOSTS,
  UPDATE_CHECK_RECENT_WINDOW_MS,
  UPDATE_MIRROR_HOST,
  UPDATE_MIRROR_PREFIX,
  mirrorDownloadUrl,
  officialDownloadUrl,
} from '@core/data/appUpdate';
import {
  DOWNLOAD_INDICATOR_STATUS,
  DownloadCompletionTracker,
  downloadDescription,
  downloadIndicatorState,
  downloadStatus,
} from '@core/library/downloadIndicatorState';
import { LiquidSegmentPhysics } from '@core/glass/liquidSegmentPhysics';
import { LIQUID_SEGMENT_SHADER } from '@core/glass/liquidSegmentShader';

import { androidReference } from '../helpers/androidReference';

const shadowGlowKt = readFileSync(
  androidReference('app/src/main/java/me/trishiraj/shadowglow/ShadowGlow.kt'),
  'utf8',
);
const shadowBlurKt = readFileSync(
  androidReference('app/src/main/java/me/trishiraj/shadowglow/ShadowBlurEngine.kt'),
  'utf8',
);
const scratchKt = readFileSync(
  androidReference('app/src/main/java/me/trishiraj/shadowglow/ShadowScratchPool.kt'),
  'utf8',
);
const nearbyKt = readFileSync(
  androidReference('app/src/main/java/com/example/transfer/NearbyHandshake.kt'),
  'utf8',
);
const comicTitleKt = readFileSync(
  androidReference('app/src/main/java/com/example/source/ComicChapterTitle.kt'),
  'utf8',
);
const menuHostKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/wenku/WenkuMenuHost.kt'),
  'utf8',
);
const paginationKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/ReaderPagination.kt'),
  'utf8',
);
const appUpdateKt = readFileSync(
  androidReference('app/src/main/java/com/example/data/AppUpdateAutoCheck.kt'),
  'utf8',
);
const appUpdateDownloadKt = readFileSync(
  androidReference('app/src/main/java/com/example/data/AppUpdateDownload.kt'),
  'utf8',
);
const downloadIndicatorKt = readFileSync(
  androidReference('app/src/main/java/com/example/library/DownloadIndicatorState.kt'),
  'utf8',
);
const segmentPhysicsKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/LiquidSegmentPhysics.kt'),
  'utf8',
);
const segmentShaderKt = readFileSync(
  androidReference('app/src/main/java/com/example/ui/components/LiquidSegmentShader.kt'),
  'utf8',
);

function squeeze(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('ShadowGlow.kt 的六个系数', () => {
  it('ambient/spot 的模糊、偏移与 alpha 增益逐值一致', () => {
    const src = squeeze(shadowGlowKt);
    expect(src).toContain('SHADOW_AMBIENT_BLUR_FACTOR = 0.22f');
    expect(src).toContain('SHADOW_SPOT_BLUR_FACTOR = 0.22f');
    expect(src).toContain('SHADOW_SPOT_OFFSET_FACTOR = 0.28f');
    expect(src).toContain('SHADOW_AMBIENT_ALPHA_GAIN = 0.10f');
    expect(src).toContain('SHADOW_SPOT_ALPHA_GAIN = 0.10f');
    expect(src).toContain('BLUR_RADIUS_TO_SIGMA = 0.577f');

    expect(SHADOW_AMBIENT_BLUR_FACTOR).toBe(0.22);
    expect(SHADOW_SPOT_BLUR_FACTOR).toBe(0.22);
    expect(SHADOW_SPOT_OFFSET_FACTOR).toBe(0.28);
    expect(SHADOW_AMBIENT_ALPHA_GAIN).toBe(0.1);
    expect(SHADOW_SPOT_ALPHA_GAIN).toBe(0.1);
    expect(BLUR_RADIUS_TO_SIGMA).toBe(0.577);
    expect(blurRadiusToSigma(10)).toBeCloseTo(5.77, 10);
  });

  it('consistentShadow 的 alpha 合成：ambient .08 / spot .15 × gain', () => {
    const layers = consistentShadowLayers({ elevationPx: 12 });
    expect(layers).toHaveLength(2);
    // ambient: .08 × .10 = .008；spot: .15 × .10 = .015
    expect(layers[0]?.color).toContain('0.008');
    expect(layers[1]?.color).toContain('0.015');
    // spot 的下移 = 12 × .28 = 3.36
    expect(layers[1]?.offsetYPx).toBeCloseTo(3.36, 6);
  });
});

describe('ShadowBlurEngine.kt 的缓存与量化', () => {
  it('两个桶的字节预算与单边上限', () => {
    expect(squeeze(shadowBlurKt)).toContain('SHADOW_MASK_CACHE_BYTES_STATIC = 10 * 1024 * 1024');
    expect(squeeze(shadowBlurKt)).toContain('SHADOW_MASK_CACHE_BYTES_ANIMATED = 4 * 1024 * 1024');
    expect(squeeze(shadowBlurKt)).toContain('SHADOW_MASK_MAX_SIDE = 2048');
    expect(SHADOW_MASK_CACHE_BYTES_STATIC).toBe(10 * 1024 * 1024);
    expect(SHADOW_MASK_CACHE_BYTES_ANIMATED).toBe(4 * 1024 * 1024);
    expect(SHADOW_MASK_MAX_SIDE).toBe(2048);
  });

  it('pickMaskScale 四档：≤2.5→1、≤8→.5、≤32→.25、ANIMATED→.125', () => {
    expect(squeeze(shadowBlurKt)).toContain('sigmaPx <= 2.5f -> 1f');
    expect(squeeze(shadowBlurKt)).toContain('sigmaPx <= 8f -> 0.5f');
    expect(squeeze(shadowBlurKt)).toContain('sigmaPx <= 32f -> 0.25f');
    expect(squeeze(shadowBlurKt)).toContain('bucket == ShadowCacheBucket.ANIMATED -> 0.125f');
    expect(pickMaskScale(2.5, 'STATIC')).toBe(1);
    expect(pickMaskScale(8, 'STATIC')).toBe(0.5);
    expect(pickMaskScale(32, 'STATIC')).toBe(0.25);
    expect(pickMaskScale(33, 'STATIC')).toBe(0.25);
    expect(pickMaskScale(33, 'ANIMATED')).toBe(0.125);
  });

  it('sigmaToBoxRadius 用 r=(−1+√(1+4σ²))/2 并夹在 [1,256]', () => {
    expect(squeeze(shadowBlurKt)).toContain('val r = (-1f + sqrt(1f + 4f * sigma * sigma)) / 2f');
    expect(squeeze(shadowBlurKt)).toContain('r.roundToInt().coerceIn(1, 256)');
    expect(sigmaToBoxRadius(0)).toBe(1);
    expect(sigmaToBoxRadius(1)).toBe(Math.round((-1 + Math.sqrt(5)) / 2));
    expect(sigmaToBoxRadius(1000)).toBe(256);
  });

  it('halfPx 与位图尺寸上限', () => {
    expect(squeeze(shadowBlurKt)).toContain('private fun Float.halfPx(): Int = (this * 2f).roundToInt()');
    expect(halfPx(1.26)).toBe(3);
    expect(halfPx(1.24)).toBe(2);
    expect(maskBitmapSize(0, 0, 1, 1, 1)).toEqual({ width: 1, height: 1 });
    expect(maskBitmapSize(0, 0, 5000, 5000, 1).width).toBe(2048);
  });

  it('水平盒式模糊的端点复制与取整：常量图恒等', () => {
    const w = 5;
    const h = 2;
    const src = new Int32Array([7, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
    const dst = new Int32Array(w * h);
    boxBlurHorizontal(src, dst, w, h, 2);
    expect([...dst]).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
  });
});

describe('ShadowScratchPool.kt 的分桶与预算', () => {
  it('acquire 向上取整到 4096 的倍数，release 后可按同档复用', () => {
    expect(squeeze(scratchKt)).toContain('val size = ((length + 4095) / 4096) * 4096');
    const pool = new ShadowScratchPool();
    const buffer = pool.acquire(5000);
    expect(buffer.length).toBe(8192);
    pool.release(buffer);
    expect(pool.retainedByteCount).toBe(8192 * 4);
    // 档位是「不小于申请长度的最小 4096 倍」：4096 → 4096，不会命中 8192 档
    // （Kotlin 的整数除法同样如此），于是池里的 8192 仍保留。
    const again = pool.acquire(4096);
    expect(again.length).toBe(4096);
    expect(pool.retainedByteCount).toBe(8192 * 4);
    const reused = pool.acquire(5000);
    expect(reused.length).toBe(8192);
    expect(pool.retainedByteCount).toBe(0);
  });

  it('未对齐 / 超上限的缓冲不入池', () => {
    const pool = new ShadowScratchPool(1024 * 1024, 4096, 4);
    const big = new Int32Array(8192);
    pool.release(big);
    expect(pool.retainedByteCount).toBe(0);
    pool.release(new Int32Array(100));
    expect(pool.retainedByteCount).toBe(0);
  });
});

describe('NearbyHandshake.kt 的线上协议', () => {
  it('端口 / 版本 / 魔数 / UTF 上限逐值一致', () => {
    const src = squeeze(nearbyKt);
    expect(src).toContain('const val PORT=38843');
    expect(src).toContain('const val VERSION=2');
    expect(src).toContain('const val MAGIC=0x4349414c');
    expect(src).toContain('val length=input.readUnsignedShort();require(length<=256)');
    expect(src).toContain('require(offer.id.length in 1..64 && offer.name.length<=64)');
    expect(NEARBY_PORT).toBe(38843);
    expect(NEARBY_VERSION).toBe(2);
    expect(NEARBY_MAGIC).toBe(0x4349414c);
    expect(NEARBY_UTF_LIMIT).toBe(256);
    expect(NEARBY_ID_MAX).toBe(64);
    expect(NEARBY_NAME_MAX).toBe(64);
  });

  it('write → read 往返一致，其它魔数抛「协议不兼容」', () => {
    const bytes = writeNearbyOffer({ id: 'dev-1', name: 'Pixel', sending: true, busy: false });
    expect(readNearbyOffer(bytes)).toEqual({ id: 'dev-1', name: 'Pixel', sending: true, busy: false });
    const tampered = bytes.slice();
    tampered[0] = 0;
    expect(() => readNearbyOffer(tampered)).toThrow('附近互传协议不兼容，请更新双方应用');
  });
});

describe('ComicChapterTitle.kt 的章节编号', () => {
  it('五条正则逐字一致', () => {
    const src = squeeze(comicTitleKt);
    expect(src).toContain('private const val numeral = "[0-9零〇一二两兩三四五六七八九十百千]+(?:\\\\.[0-9]+)?"');
    expect(src).toContain('Regex("^(?:第\\\\s*)?($numeral)\\\\s*[话話章回]")');
    expect(src).toContain('番外|特別|特别|特典');
    expect(src).toContain('公告|通知|告知|停更');
  });

  it('中文/英文/裸序号都能解析，特殊篇与公告返回 null', () => {
    expect(comicChapterNumber('第12话 相遇')).toBe(12);
    expect(comicChapterNumber('第十二话')).toBe(12);
    expect(comicChapterNumber('Chapter 7.5')).toBe(7.5);
    expect(comicChapterNumber('3 序章')).toBe(3);
    expect(comicChapterNumber('番外篇')).toBeNull();
    expect(comicChapterNumber('停更公告')).toBeNull();
    expect(ComicChapterTitle.number('第3章')).toBe(3);
  });
});

describe('WenkuMenuHost.kt 的菜单几何', () => {
  it('错峰常量与命中阈值', () => {
    const src = squeeze(menuHostKt);
    expect(src).toContain('WenkuMenuStaggerStart = 0.06f');
    expect(src).toContain('WenkuMenuStaggerEnd = 0.62f');
    expect(src).toContain('WenkuMenuStaggerStep = 0.025f');
    expect(src).toContain('WenkuMenuStaggerMaxOrder = 8');
    expect(src).toContain('WenkuMenuHitThreshold = 0.15f');
    expect(src).toContain('WenkuMenuContentThreshold = 0.34f');
    expect(WenkuMenuStaggerStart).toBe(0.06);
    expect(WenkuMenuStaggerEnd).toBe(0.62);
    expect(WenkuMenuStaggerStep).toBe(0.025);
    expect(WenkuMenuStaggerMaxOrder).toBe(8);
    expect(WENKU_MENU_HIT_THRESHOLD).toBe(0.15);
    expect(WENKU_MENU_CONTENT_THRESHOLD).toBe(0.34);
  });

  it('order 超过 8 被夹到 8', () => {
    expect(wenkuStaggerPartWindow(0)).toEqual({ start: 0.06, end: 0.62 });
    expect(wenkuStaggerPartWindow(9)).toEqual({ start: 0.06 + 8 * 0.025, end: 0.62 + 8 * 0.025 });
  });

  it('target rect：横向贴右、纵向放不下时翻到锚点上方', () => {
    const anchor = { left: 100, top: 100, right: 140, bottom: 140 };
    const area = { left: 0, top: 0, right: 400, bottom: 400 };
    const below = wenkuMenuTargetRect(anchor, { width: 200, height: 100 }, area);
    // anchor.right - width = -60，夹到 area.left(0)：最终右边界 = 0 + 200\n    expect(below.left).toBe(0);\n    expect(below.right).toBe(200);
    expect(below.top).toBe(100);
    const tooTall = wenkuMenuTargetRect(anchor, { width: 200, height: 380 }, area);
    expect(tooTall.top).toBe(Math.max(0, 140 - 380));
  });

  it('current rect：progress 0 → 锚点尺寸，1 → 目标矩形', () => {
    const anchor = { left: 10, top: 10, right: 40, bottom: 40 };
    const target = { left: 100, top: 100, right: 300, bottom: 260 };
    const at0 = wenkuMenuCurrentRect(0, anchor, target);
    expect(at0.right - at0.left).toBeCloseTo(30, 6);
    const at1 = wenkuMenuCurrentRect(1, anchor, target);
    expect(at1.left).toBeCloseTo(target.left, 6);
    expect(at1.right - at1.left).toBeCloseTo(200, 6);
  });
});

describe('ReaderPagination.kt 的常量与分块', () => {
  it('四个 padding/阈值常量逐值一致', () => {
    const src = squeeze(paginationKt);
    expect(src).toContain('PAGE_VERTICAL_PADDING_DP = 12');
    expect(src).toContain('PAGE_TEXT_BOTTOM_PADDING_DP = 16');
    expect(src).toContain('TITLE_BLOCK_PADDING_DP = 20');
    expect(src).toContain('LARGE_CHAPTER_THRESHOLD = 200_000');
    expect(src).toContain('PAGINATION_CHUNK_CHARS = 40_000');
    expect(src).toContain('EAGER_CHAPTER_THRESHOLD = 60_000');
    expect(PAGE_VERTICAL_PADDING_DP).toBe(12);
    expect(PAGE_TEXT_BOTTOM_PADDING_DP).toBe(16);
    expect(TITLE_BLOCK_PADDING_DP).toBe(20);
    expect(LARGE_CHAPTER_THRESHOLD).toBe(200_000);
    expect(PAGINATION_CHUNK_CHARS).toBe(40_000);
    expect(EAGER_CHAPTER_THRESHOLD).toBe(60_000);
  });

  it('pageIndexAtOffset 命中第一个累计长度大于 offset 的页', () => {
    expect(squeeze(paginationKt)).toContain('if (accumulated > offset || index == pages.lastIndex) return index');
    const pages = ['abc', 'de', 'fghi'];
    expect(pageIndexAtOffset(pages, 0)).toBe(0);
    expect(pageIndexAtOffset(pages, 3)).toBe(1);
    expect(pageIndexAtOffset(pages, 5)).toBe(2);
    expect(pageIndexAtOffset(pages, 999)).toBe(2);
  });

  it('分块在块的后半段找换行，且不切断图片 token', () => {
    const content = 'a'.repeat(60) + '\n' + 'b'.repeat(60);
    const ranges = paginationChunkRanges(content, 80);
    const joined = ranges.map(([s, e]) => content.slice(s, e)).join('');
    expect(joined).toBe(content);
    expect(ranges.every(([s, e]) => e > s)).toBe(true);
    const withToken = 'x'.repeat(70) + '[IMG:p|10|20]' + 'y'.repeat(40);
    const tokenRanges = paginationImageTokenRanges(withToken);
    expect(tokenRanges).toHaveLength(1);
    const chunks = paginationChunkRanges(withToken, 80);
    // token 不能被切开：每个块的边界都不落在 token 内部
    for (const [s, e] of chunks) {
      const insideToken = tokenRanges.some(([ts, te]) => s > ts && s <= te) || tokenRanges.some(([ts, te]) => e > ts && e < te);
      expect(insideToken).toBe(false);
    }
  });

  it('shouldCelebrateAfterForwardTurn 要求「最后一章 + 倒数第二页 + 总长吻合」', () => {
    expect(squeeze(paginationKt)).toContain('pageIndex >= pages.lastIndex - 1');
    expect(shouldCelebrateAfterForwardTurn(2, 3, 1, ['ab', 'cd'], 4)).toBe(true);
    expect(shouldCelebrateAfterForwardTurn(1, 3, 1, ['ab', 'cd'], 4)).toBe(false);
    // 两页时 lastIndex-1 = 0，所以 pageIndex 0 也满足「倒数第二页」\n    expect(shouldCelebrateAfterForwardTurn(2, 3, 0, ['ab', 'cd'], 4)).toBe(true);
    expect(shouldCelebrateAfterForwardTurn(2, 3, 1, ['ab', 'cd'], 5)).toBe(false);
  });
});

describe('AppUpdateAutoCheck.kt 的镜像规则', () => {
  it('镜像前缀 / 主机 / 90s 窗口 / 三个下载主机', () => {
    const src = squeeze(appUpdateKt);
    expect(src).toContain('UPDATE_MIRROR_PREFIX = "https://gh-proxy.com/"');
    expect(src).toContain('UPDATE_MIRROR_HOST = "gh-proxy.com"');
    expect(src).toContain('fun completedRecently(windowMs: Long = 90_000)');
    expect(squeeze(appUpdateDownloadKt)).toContain(
      'setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")',
    );
    expect(UPDATE_MIRROR_PREFIX).toBe('https://gh-proxy.com/');
    expect(UPDATE_MIRROR_HOST).toBe('gh-proxy.com');
    expect(UPDATE_CHECK_RECENT_WINDOW_MS).toBe(90_000);
    expect(GITHUB_DOWNLOAD_HOSTS).toEqual([
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com',
    ]);
  });

  it('缺 sha256 / 非官方资产一律不给镜像；官方下载永不走镜像', () => {
    const good = {
      name: 'app.apk',
      url: 'https://github.com/owner/repo/releases/download/v1.2.3/app.apk',
      sha256: 'a'.repeat(64),
    };
    expect(mirrorDownloadUrl('v1.2.3', good)).toBe(`https://gh-proxy.com/${good.url}`);
    expect(officialDownloadUrl('v1.2.3', good)).toBe(good.url);
    expect(mirrorDownloadUrl('v1.2.3', { ...good, sha256: 'abc' })).toBeNull();
    expect(mirrorDownloadUrl('v9.9.9', good)).toBeNull();
    expect(officialDownloadUrl('v9.9.9', good)).toBeNull();
  });
});

describe('DownloadIndicatorState.kt 的状态与文案', () => {
  it('枚举顺序与四段文案逐字一致', () => {
    const src = squeeze(downloadIndicatorKt);
    expect(src).toContain('enum class DownloadIndicatorStatus { Idle, Running, Paused, Failed }');
    expect(src).toContain('"$activeCount 项下载中"');
    expect(src).toContain('"$failedCount 项失败"');
    expect(src).toContain('"$pausedCount 项暂停"');
    expect(src).toContain('"无进行中的下载"');
    expect([...DOWNLOAD_INDICATOR_STATUS]).toEqual(['Idle', 'Running', 'Paused', 'Failed']);
  });

  it('running 优先于 failed；只有全部 running 都有进度时才给总体进度', () => {
    const state = downloadIndicatorState(
      new Map([
        ['v2:a', { kind: 'Downloading', progress: 0.5, totalBytes: 10 }],
        ['v2:b', { kind: 'Error' }],
      ]),
      new Map(),
    );
    expect(downloadStatus(state)).toBe('Running');
    expect(state.progress).toBe(0.5);
    expect(downloadDescription(state)).toBe('1 项下载中');

    const partial = downloadIndicatorState(
      new Map([
        ['v2:a', { kind: 'Downloading', progress: 0.5, totalBytes: 10 }],
        ['v2:b', { kind: 'Pending' }],
      ]),
      new Map(),
    );
    expect(partial.progress).toBeNull();
  });

  it('只有「上一轮在跑、本轮已完成且已静息」才算完成回执', () => {
    const tracker = new DownloadCompletionTracker();
    const running = downloadIndicatorState(
      new Map([['v2:a', { kind: 'Downloading', progress: 1, totalBytes: 1 }]]),
      new Map(),
    );
    expect(tracker.update(running)).toBe(false);
    const done = downloadIndicatorState(new Map([['v2:a', { kind: 'Success' }]]), new Map());
    expect(tracker.update(done)).toBe(true);
    // 再次 update（历史里已有 completed）不应重放
    expect(tracker.update(done)).toBe(false);
  });
});

describe('LiquidSegmentPhysics.kt 与着色器', () => {
  it('三个卫星的 anchor/stiffness/radius/offsetY 与阻尼系数', () => {
    const src = squeeze(segmentPhysicsKt);
    expect(src).toContain(
      'satellites = arrayOf(Satellite(-.3f, 140f, 11f, 3f), Satellite(.15f, 95f, 8f, -4f), Satellite(-.05f, 65f, 5.5f, 1f))',
    );
    expect(src).toContain('val damping = 2f * sqrt(stiffness) * .62f');
    const physics = new LiquidSegmentPhysics();
    expect(physics.satellites.map((s) => [s.anchor, s.stiffness, s.radius, s.offsetY])).toEqual([
      [-0.3, 140, 11, 3],
      [0.15, 95, 8, -4],
      [-0.05, 65, 5.5, 1],
    ]);
    expect(physics.satellites[0]?.damping).toBeCloseTo(2 * Math.sqrt(140) * 0.62, 10);
  });

  it('slotWidth = ((width - 8) / count) 且至少 1', () => {
    expect(squeeze(segmentPhysicsKt)).toContain(
      'val slotWidth get() = ((width - 8f) / count.coerceAtLeast(1)).coerceAtLeast(1f)',
    );
    const physics = new LiquidSegmentPhysics();
    physics.resize(208, 48, 4, 0);
    expect(physics.slotWidth).toBeCloseTo(50, 10);
    expect(physics.left.target).toBeCloseTo(4, 10);
    expect(physics.right.target).toBeCloseTo(54, 10);
  });

  it('着色器常量：按压高度 .09、方向压扁 .16、折射 17.0、高光指数 30/22', () => {
    const shader = squeeze(segmentShaderKt);
    expect(shader).toContain('float boxDistance(float2 q, float2 b, float r)');
    expect(shader).toContain('* (1.0 + press * .09)');
    expect(shader).toContain('* (1.0 - abs(dir) * .16)');
    expect(shader).toContain('n * (17.0 * edge * edge)');
    expect(shader).toContain('0.0), 30.0) * .85');
    expect(shader).toContain('0.0), 22.0) * .30');
    // TS 版是 GLSL ES 3.00：uniform 名与常量必须保留
    expect(LIQUID_SEGMENT_SHADER).toContain('uniform float leftEdge, rightEdge, velocity, wobble, press;');
    expect(LIQUID_SEGMENT_SHADER).toContain('* (1.0 + press * .09)');
    expect(LIQUID_SEGMENT_SHADER).toContain('n * (17.0 * edge * edge)');
  });
});

/**
 * 顶层声明零命中的 21 个 Kotlin 文件 —— GAP 补齐项的回归门禁。
 *
 * 每条用例对应 docs/PARITY_EXCEPTIONS.md E110 的一行：
 *   GAP 项至少断言 1 条 Kotlin 常量 / 分支 / 中文字符串；
 *   EQUIVALENT 项只核对「落点文件存在且导出对应符号」，不重复测别人的实现。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildLogicalChapters,
  loadReaderChapterWindow,
  type Chapter,
} from '@core/data/chapterMerger';
import {
  FAVORITE_COVER_MAX_ATTEMPT,
  favoriteCoverAttemptDelayMs,
  favoriteCoverData,
  favoriteCoverOnError,
} from '@core/favorite/favoriteUi';
import {
  AppMotion,
  PROGRESS_RING_SIZE_DP,
  PROGRESS_RING_STROKE_DP,
  PROGRESS_TRACK_ALPHA,
  appProgressRing,
} from '@core/glass/motion';
import {
  CATALOG_COVER_MOTION_MS,
  catalogCoverKey,
  catalogCoverMotionEnabled,
} from '@core/motion/navigationMotion';
import {
  GUEST_RETRY_ATTEMPTS,
  guestNovelIoRetry,
  guestRetryDelayMs,
  isGuestRetryableError,
} from '@core/source/impl/guestNovelTransport';
import { SourceNetworkError } from '@core/source/impl/sourceHttp';
import { NetworkError, ParseError } from '@core/source/sourceException';
import {
  MAX_CONNECTION_ROUTES,
  MAX_PEER_ROUTES,
  connectionRoutes,
  createTransferPeer,
  createTransferRoute,
  mergePeer,
} from '@core/transfer/transferRoutes';
import {
  WENKU_COUNT_UP_MS,
  WENKU_MORPH_MAX_DELAY,
  WENKU_TEXT_FOLD_MS,
  WENKU_TEXT_MAX_CHARS,
  kotlinStringHashCode,
  wenkuCountUpDefaultFormat,
  wenkuCountUpValue,
  wenkuMorphAlpha,
  wenkuMorphChars,
  wenkuMorphDelays,
  wenkuMorphNeeded,
  wenkuTextAnimated,
} from '@core/wenku/motion';
import { producedSignature, resolveProducedValue } from '@ui/components/useProducedState';
import { startupDiagnosticFileName } from '@ui/components/StartupDiagnosticsExportButton';
import {
  READING_GLASS_BLUR,
  READING_GLASS_BLUR_LOW,
  READING_GLASS_BLUR_STRONG,
  READING_GLASS_BORDER_ALPHA,
  READING_GLASS_BORDER_WIDTH,
  READING_GLASS_DEFAULT_TINT,
  READING_GLASS_NO_BACKDROP_ALPHA,
  READING_GLASS_SATURATION,
  READING_GLASS_SHEEN_ALPHAS,
  readingGlassPaint,
} from '@core/glass/glassKit';

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. data/ReaderChapterWindow.kt — 三章窗口
 * ══════════════════════════════════════════════════════════════════════════════ */

function physical(order: number, title: string, content: string): Chapter {
  return {
    id: order + 1,
    bookId: 1,
    chapterOrder: order,
    title,
    content,
    startCharIndex: 0,
    endCharIndex: content.length,
  };
}

describe('ReaderChapterWindow.kt', () => {
  const mapping = buildLogicalChapters([
    physical(0, '第一章', 'A'),
    physical(1, '第二章', 'B'),
    physical(2, '第三章', 'C'),
    physical(3, '第四章', 'D'),
  ]);

  it('L21 只取 currentIndex-1..currentIndex+1 且裁到 metadata.indices', async () => {
    const asked: number[][] = [];
    const window = await loadReaderChapterWindow(mapping, 0, [], new Set(), (orders) => {
      asked.push(orders);
      return Promise.resolve(orders.map((order) => physical(order, `第${order}章`, 'X')));
    });
    expect(asked).toEqual([[0, 1]]);
    expect(window.chapters).toHaveLength(4);
    expect(window.chapters[1]?.content).toBe('X');
    expect([...window.loaded].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('L22/L24 已加载且在 previous 范围内 → 完全不读网络，且沿用同一对象', async () => {
    const first = await loadReaderChapterWindow(mapping, 1, [], new Set(), (orders) =>
      Promise.resolve(orders.map((order) => physical(order, `第${order}章`, 'B'))),
    );
    const readParts = vi.fn(() => Promise.resolve<Chapter[]>([]));
    const second = await loadReaderChapterWindow(mapping, 1, first.chapters, first.loaded, readParts);
    expect(readParts).not.toHaveBeenCalled();
    expect(second.chapters[1]).toBe(first.chapters[1]);
    expect([...second.loaded].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('L20 越界 → tr("没有可读取的章节")', async () => {
    await expect(
      loadReaderChapterWindow(mapping, 4, [], new Set(), () => Promise.resolve([])),
    ).rejects.toThrow('没有可读取的章节');
    await expect(
      loadReaderChapterWindow(mapping, -1, [], new Set(), () => Promise.resolve([])),
    ).rejects.toThrow('没有可读取的章节');
  });

  it('L27 当前章缺数据 → tr("当前章节数据缺失，请重试加载")', async () => {
    await expect(
      loadReaderChapterWindow(mapping, 1, [], new Set(), () => Promise.resolve([])),
    ).rejects.toThrow('当前章节数据缺失，请重试加载');
  });

  it('L34-37 逻辑章的多个物理片段按 order 顺序无分隔拼接', async () => {
    const merged = buildLogicalChapters([
      physical(0, '第一章', '上半'),
      physical(1, '第一章 (续)', '下半'),
    ]);
    expect(merged.logicalToPhysicalOrders[0]).toEqual([0, 1]);
    const window = await loadReaderChapterWindow(merged, 0, [], new Set(), (orders) =>
      Promise.resolve(orders.map((order) => (order === 0 ? physical(0, '第一章', '上半') : physical(1, '第一章 (续)', '下半')))),
    );
    expect(window.chapters[0]?.content).toBe('上半下半');
  });

  it('E110：取消语义用 AbortSignal 替代 ensureActive()', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadReaderChapterWindow(
        mapping,
        1,
        [],
        new Set(),
        () => Promise.resolve([]),
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. ui/wenku/WenkuTextMotion.kt — 逐字符折变 / 数字滚动
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('WenkuTextMotion.kt', () => {
  it('L105/L46/L115 常量：780ms / 512 字 / 340ms', () => {
    expect(WENKU_TEXT_FOLD_MS).toBe(780);
    expect(WENKU_TEXT_MAX_CHARS).toBe(512);
    expect(WENKU_COUNT_UP_MS).toBe(340);
    expect(WENKU_MORPH_MAX_DELAY).toBeCloseTo(0.52, 10);
  });

  it('L50-52 animated = morphOnChange && !reduceMotion && decorative', () => {
    expect(wenkuTextAnimated(true, false, true)).toBe(true);
    expect(wenkuTextAnimated(false, false, true)).toBe(false);
    expect(wenkuTextAnimated(true, true, true)).toBe(false);
    expect(wenkuTextAnimated(true, false, false)).toBe(false);
  });

  it('L62-70 文本未变 / 未开动效 / 超 512 字 → 不播折变', () => {
    expect(wenkuMorphNeeded('a', 'a', true)).toBe(false);
    expect(wenkuMorphNeeded('a', 'b', false)).toBe(false);
    expect(wenkuMorphNeeded('a', 'x'.repeat(513), true)).toBe(false);
    expect(wenkuMorphNeeded('a', 'x'.repeat(512), true)).toBe(true);
  });

  it('L75-77 同一颗种子（hashCode xor generation）给出可复现的 [0,.52) 延迟', () => {
    const first = wenkuMorphDelays('章节标题', 1, 8);
    const again = wenkuMorphDelays('章节标题', 1, 8);
    const other = wenkuMorphDelays('章节标题', 2, 8);
    expect(first).toHaveLength(8);
    expect([...first]).toEqual([...again]);
    expect([...first]).not.toEqual([...other]);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(WENKU_MORPH_MAX_DELAY);
    }
  });

  it('Kotlin String.hashCode() 逐位一致（31 基、Int32 回绕）', () => {
    expect(kotlinStringHashCode('')).toBe(0);
    expect(kotlinStringHashCode('a')).toBe(97);
    expect(kotlinStringHashCode('ab')).toBe(97 * 31 + 98);
    expect(kotlinStringHashCode('章节')).toBe(
      (Math.imul(31456, 31) + 33410) | 0,
    );
  });

  it('L92-93 alpha 折线：t=0 → 1，t=.5 → .08，t=1 → 1，下界 .08', () => {
    expect(wenkuMorphAlpha(0, 0)).toBeCloseTo(1, 10);
    expect(wenkuMorphAlpha(0.24, 0)).toBeCloseTo(0.08, 10);
    expect(wenkuMorphAlpha(0.48, 0)).toBeCloseTo(1, 10);
    for (let clock = 0; clock <= 1; clock += 0.01) {
      const alpha = wenkuMorphAlpha(clock, 0.13);
      expect(alpha).toBeGreaterThanOrEqual(0.08);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('L94-98 t<.5 用旧字、t>=.5 用新字，超出 source 长度的位跳过', () => {
    const delays = new Float64Array([0, 0]);
    expect(wenkuMorphChars(0, delays, 'ab', 'xy').map((it) => it.char)).toEqual(['a', 'b']);
    expect(wenkuMorphChars(0.48, delays, 'ab', 'xy').map((it) => it.char)).toEqual(['x', 'y']);
    expect(wenkuMorphChars(0.48, delays, 'ab', 'xy').every((it) => it.from === 'to')).toBe(true);
    // to 比 from 短：index 2 在新字串里不存在 → 跳过
    expect(wenkuMorphChars(0.48, new Float64Array([0, 0, 0]), 'abc', 'xy')).toHaveLength(2);
  });

  it('L131 value * progress.coerceIn(0,1)；L116 默认格式是 toInt().toString()', () => {
    expect(wenkuCountUpValue(10, 0.5)).toBe(5);
    expect(wenkuCountUpValue(10, 3)).toBe(10);
    expect(wenkuCountUpValue(10, -3)).toBe(0);
    expect(wenkuCountUpDefaultFormat(3.94)).toBe('3');
    expect(wenkuCountUpDefaultFormat(-0.4)).toBe('0');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. ui/favorite/FavoriteCover.kt — 封面数据 + 重试
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('FavoriteCover.kt', () => {
  it('L26-33 本地缩略图失效 → 回落在还活着的在线封面', () => {
    expect(favoriteCoverData('/data/thumb.jpg', 'https://x/cover.jpg', false, () => false)).toBe(
      'https://x/cover.jpg',
    );
    expect(favoriteCoverData('/data/thumb.jpg', 'https://x/cover.jpg', false, () => true)).toBe(
      '/data/thumb.jpg',
    );
  });

  it('L28 content:// 直接返回（无法 stat，也不需要 stat）', () => {
    const probe = vi.fn(() => false);
    expect(favoriteCoverData('content://media/external/1', 'https://x/c.jpg', false, probe)).toBe(
      'content://media/external/1',
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it('L29 removePrefix("file://") 后交给探测；skipLocal 直接跳过本地', () => {
    const seen: string[] = [];
    favoriteCoverData('file:///data/a.jpg', null, false, (absolute) => {
      seen.push(absolute);
      return true;
    });
    expect(seen).toEqual(['/data/a.jpg']);
    expect(favoriteCoverData('/data/a.jpg', 'https://x/c.jpg', true, () => true)).toBe(
      'https://x/c.jpg',
    );
  });

  it('远程封面为空/空白 → null（takeIf { it.isNotBlank() }）', () => {
    expect(favoriteCoverData(null, null)).toBeNull();
    expect(favoriteCoverData('   ', '   ')).toBeNull();
    expect(favoriteCoverData(null, 'https://x/c.jpg')).toBe('https://x/c.jpg');
  });

  it('L75-81 非 http(s) 失败一次就永久弃用本地；远程按 500/1000ms 退避', () => {
    expect(favoriteCoverOnError('file:///data/a.jpg', false, 0)).toEqual({
      skipLocal: true,
      attempt: 0,
      retry: false,
      delayMs: 0,
    });
    expect(favoriteCoverOnError('https://x/c.jpg', false, 0)).toEqual({
      skipLocal: false,
      attempt: 1,
      retry: true,
      delayMs: 500,
    });
    expect(favoriteCoverOnError('https://x/c.jpg', false, 1)).toEqual({
      skipLocal: false,
      attempt: 2,
      retry: true,
      delayMs: 1000,
    });
    expect(favoriteCoverOnError('https://x/c.jpg', false, 2)).toEqual({
      skipLocal: false,
      attempt: 2,
      retry: false,
      delayMs: 0,
    });
    expect(favoriteCoverAttemptDelayMs(2)).toBe(1500);
    expect(FAVORITE_COVER_MAX_ATTEMPT).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. ui/components/AppProgressIndicator.kt — 环形进度几何
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('AppProgressIndicator.kt', () => {
  it('L24-26 / L47-48 / L59 令牌：ICON 240、PROGRESS 220、CYCLE 1400、40dp、2dp、.13', () => {
    expect(AppMotion.ICON_MS).toBe(240);
    expect(AppMotion.PROGRESS_MS).toBe(220);
    expect(AppMotion.PROGRESS_CYCLE_MS).toBe(1400);
    expect(PROGRESS_RING_SIZE_DP).toBe(40);
    expect(PROGRESS_RING_STROKE_DP).toBe(2);
    expect(PROGRESS_TRACK_ALPHA).toBeCloseTo(0.13, 10);
  });

  it('L38-39 确定进度：起点固定 -90°，扫角 = 360°×coerceIn(0,1)', () => {
    expect(appProgressRing(0.25, 0)).toEqual({ startDeg: -90, sweepDeg: 90 });
    expect(appProgressRing(0, 0.7)).toEqual({ startDeg: -90, sweepDeg: 0 });
    expect(appProgressRing(2, 0)).toEqual({ startDeg: -90, sweepDeg: 360 });
  });

  it('L38-39 不确定进度：起点 -90+phase×360，扫角 90+60·sin(π·phase)', () => {
    expect(appProgressRing(null, 0)).toEqual({ startDeg: -90, sweepDeg: 90 });
    expect(appProgressRing(null, 0.5).startDeg).toBeCloseTo(90, 10);
    expect(appProgressRing(null, 0.5).sweepDeg).toBeCloseTo(150, 10);
    expect(appProgressRing(null, 1).sweepDeg).toBeCloseTo(90, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. ui/components/CatalogCoverMotion.kt — 目录封面共享元素
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('CatalogCoverMotion.kt', () => {
  it('L20 共享内容 key = "catalog_cover_${sourceId}_$bookId"', () => {
    expect(catalogCoverKey('ixdzs8', '42')).toBe('catalog_cover_ixdzs8_42');
  });

  it('L21 boundsTransform = tween(360, easeOutCubic)', () => {
    expect(CATALOG_COVER_MOTION_MS).toBe(360);
  });

  it('L17 scope 缺失或减少动效 → 原样返回，不加共享元素', () => {
    expect(catalogCoverMotionEnabled(true, true, false)).toBe(true);
    expect(catalogCoverMotionEnabled(false, true, false)).toBe(false);
    expect(catalogCoverMotionEnabled(true, false, false)).toBe(false);
    expect(catalogCoverMotionEnabled(true, true, true)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. source/impl/GuestNovelTransport.kt — guestNovelIoRetry
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('GuestNovelTransport.kt guestNovelIoRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('L13-14 retryable = IOException | NetworkError(HTTP 408/429/5xx)', () => {
    expect(isGuestRetryableError(new SourceNetworkError('断网'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('源站返回 HTTP 503'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('源站返回 HTTP 429'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('源站返回 HTTP 408'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('源站返回 HTTP 404'))).toBe(false);
    expect(isGuestRetryableError(new ParseError('页面结构异常'))).toBe(false);
    expect(isGuestRetryableError(new Error('boom'))).toBe(false);
  });

  it('L17 delay = 750ms × (attempt+1)，共 3 次尝试', () => {
    expect(GUEST_RETRY_ATTEMPTS).toBe(3);
    expect(guestRetryDelayMs(0)).toBe(750);
    expect(guestRetryDelayMs(1)).toBe(1500);
  });

  it('L15/L17 两次重试后第 3 次失败原样抛出', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const promise = guestNovelIoRetry(() => {
      calls += 1;
      return Promise.reject(new SourceNetworkError('断网'));
    });
    const settled = expect(promise).rejects.toBeInstanceOf(SourceNetworkError);
    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(1500);
    await settled;
    expect(calls).toBe(3);
  });

  it('L15 不可重试的错误立即抛出，不等待', async () => {
    let calls = 0;
    await expect(
      guestNovelIoRetry(() => {
        calls += 1;
        return Promise.reject(new ParseError('页面结构异常'));
      }),
    ).rejects.toBeInstanceOf(ParseError);
    expect(calls).toBe(1);
  });

  it('L16 首次成功不产生任何延迟', async () => {
    await expect(guestNovelIoRetry(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. ui/reader/ReadingGlass.kt — readingGlass 的光学档位
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('ReadingGlass.kt', () => {
  it('L37 模糊半径三档：LOW 恒 10，其余 strong 22 / 否则 16', () => {
    expect(readingGlassPaint('LOW', true, true).blurRadiusPx).toBe(READING_GLASS_BLUR_LOW);
    expect(readingGlassPaint('LOW', false, true).blurRadiusPx).toBe(10);
    expect(readingGlassPaint('MID', true, true).blurRadiusPx).toBe(READING_GLASS_BLUR_STRONG);
    expect(readingGlassPaint('MAX', false, true).blurRadiusPx).toBe(READING_GLASS_BLUR);
    expect(READING_GLASS_BLUR_LOW).toBe(10);
    expect(READING_GLASS_BLUR).toBe(16);
    expect(READING_GLASS_BLUR_STRONG).toBe(22);
  });

  it('L36 / L43 着色 alpha：strong .72、否则 .60；无 backdrop 时 .84', () => {
    expect(readingGlassPaint('HIGH', true, true).tintAlpha).toBeCloseTo(0.72, 10);
    expect(readingGlassPaint('HIGH', false, true).tintAlpha).toBeCloseTo(0.6, 10);
    expect(readingGlassPaint('HIGH', false, false).tintAlpha).toBeCloseTo(
      READING_GLASS_NO_BACKDROP_ALPHA,
      10,
    );
    expect(readingGlassPaint('HIGH', true, false).blurRadiusPx).toBe(0);
  });

  it('L35 极简档只有 clip + background(tint)，没有模糊/渐变/描边', () => {
    const minimal = readingGlassPaint('MINIMAL', true, true);
    expect(minimal.solid).toBe(true);
    expect(minimal.blurRadiusPx).toBe(0);
    expect(minimal.borderWidthPx).toBe(0);
    expect(minimal.sheenAlphas).toEqual([0, 0, 0]);
  });

  it('L23 / L40 / L44 / L45 其余常量逐值对齐', () => {
    expect(READING_GLASS_DEFAULT_TINT).toBe('#232329');
    expect(READING_GLASS_SATURATION).toBeCloseTo(1.1, 10);
    expect([...READING_GLASS_SHEEN_ALPHAS]).toEqual([0.13, 0.025, 0.045]);
    expect(READING_GLASS_BORDER_WIDTH).toBeCloseTo(0.7, 10);
    expect(READING_GLASS_BORDER_ALPHA).toBeCloseTo(0.13, 10);
    expect(readingGlassPaint('HIGH', false, true).borderWidthPx).toBeCloseTo(0.7, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. transfer/TransferRoutes.kt — mergePeer / connectionRoutes
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('TransferRoutes.kt', () => {
  it('L4-6 新发现优先；同一 networkHandle 的老路由被丢弃，其余保留', () => {
    const merged = mergePeer(
      createTransferPeer({
        id: 'p1',
        name: '旧',
        host: '10.0.0.5',
        port: 8000,
        p2pAddress: 'p2p-old',
        directPort: 7,
        nearbyProtocol: 2,
        routes: [createTransferRoute('10.0.0.5', 8000, 1)],
      }),
      createTransferPeer({
        id: 'p1',
        name: '新',
        routes: [createTransferRoute('10.0.0.9', 8100, 2)],
      }),
    );
    expect(merged.name).toBe('新');
    expect(merged.host).toBe('10.0.0.5');
    expect(merged.port).toBe(8000);
    expect(merged.p2pAddress).toBe('p2p-old');
    expect(merged.directPort).toBe(7);
    expect(merged.nearbyProtocol).toBe(2);
    expect(merged.routes.map((it) => it.host)).toEqual(['10.0.0.9', '10.0.0.5']);

    const dropped = mergePeer(
      createTransferPeer({ id: 'p1', name: '旧', routes: [createTransferRoute('10.0.0.5', 8000, 1)] }),
      createTransferPeer({ id: 'p1', name: '新', routes: [createTransferRoute('10.0.0.9', 8100, 1)] }),
    );
    expect(dropped.routes.map((it) => it.host)).toEqual(['10.0.0.9']);
  });

  it('L7-9 host / port / p2pAddress / directPort 的继承规则', () => {
    const freshWithHost = mergePeer(null, createTransferPeer({ id: 'p', name: 'n', host: '1.2.3.4', port: 9000 }));
    expect(freshWithHost.port).toBe(9000);
    // fresh.host == null 且 old.host == null → 仍用 fresh.port
    const noHost = mergePeer(null, createTransferPeer({ id: 'p', name: 'n' }));
    expect(noHost.host).toBeNull();
    expect(noHost.port).toBe(0);
    // fresh.p2pAddress != null → nearbyProtocol 取 fresh
    const nearby = mergePeer(
      createTransferPeer({ id: 'p', name: 'n', nearbyProtocol: 5 }),
      createTransferPeer({ id: 'p', name: 'n', p2pAddress: 'x', nearbyProtocol: 9 }),
    );
    expect(nearby.nearbyProtocol).toBe(9);
  });

  it('L5-6 distinct().take(8)', () => {
    const route = createTransferRoute('10.0.0.1', 1, 4);
    const duplicated = mergePeer(
      null,
      createTransferPeer({ id: 'p', name: 'n', routes: [route, { ...route }] }),
    );
    expect(duplicated.routes).toHaveLength(1);
    const many = mergePeer(
      null,
      createTransferPeer({
        id: 'p',
        name: 'n',
        routes: Array.from({ length: 10 }, (_unused, index) => createTransferRoute(`10.0.0.${index}`, 1000 + index)),
      }),
    );
    expect(many.routes).toHaveLength(MAX_PEER_ROUTES);
    expect(MAX_PEER_ROUTES).toBe(8);
  });

  it('L15-17 端口过滤 / (host,port) 去重 / IPv6 排后 / take(4)', () => {
    const peer = createTransferPeer({
      id: 'p',
      name: 'n',
      host: '10.0.0.1',
      port: 8000,
      routes: [
        createTransferRoute('10.0.0.1', 8000),
        createTransferRoute('fe80::1', 8001),
        createTransferRoute('h2', 7000),
        createTransferRoute('x', 0),
        createTransferRoute('y', 70000),
      ],
    });
    expect(connectionRoutes(peer).map((it) => `${it.host}:${it.port}`)).toEqual([
      '10.0.0.1:8000',
      'h2:7000',
      'fe80::1:8001',
    ]);

    const many = createTransferPeer({
      id: 'p',
      name: 'n',
      routes: Array.from({ length: 6 }, (_unused, index) => createTransferRoute(`h${index}`, 1000 + index)),
    });
    expect(connectionRoutes(many)).toHaveLength(MAX_CONNECTION_ROUTES);
    expect(MAX_CONNECTION_ROUTES).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. ui/components/ProducedState.kt — 保留 / 丢弃两条语义
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('ProducedState.kt', () => {
  it('L12 remember { mutableStateOf(initial) } → 键不变时沿用上一次产出的值', () => {
    const slot = { signature: producedSignature(['a']), value: 'loaded' };
    expect(resolveProducedValue(slot, producedSignature(['a']), 'initial')).toBe('loaded');
  });

  it('L32 remember(*keys) { mutableStateOf(initial) } → 键变化时立即回到 initialValue', () => {
    const slot = { signature: producedSignature(['a']), value: 'stale' };
    expect(resolveProducedValue(slot, producedSignature(['b']), 'initial')).toBe('initial');
  });

  it('键的判等按内容（Compose 用 equals，这里用序列化）', () => {
    expect(producedSignature([1, 'x'])).toBe(producedSignature([1, 'x']));
    expect(producedSignature([1, 'x'])).not.toBe(producedSignature([1, 'y']));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. ui/components/StartupDiagnosticsExportButton.kt
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('StartupDiagnosticsExportButton.kt', () => {
  it('L46 文件名 "Ciallo-Reader-diagnostic-${VERSION_NAME}-${currentTimeMillis}.txt"', () => {
    expect(startupDiagnosticFileName('1.6.4', 1_700_000_000_000)).toBe(
      'Ciallo-Reader-diagnostic-1.6.4-1700000000000.txt',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * EQUIVALENT 抽查：只核对落点文件存在且导出对应符号
 * ══════════════════════════════════════════════════════════════════════════════ */

const repoRoot = process.cwd();

function sourceText(relative: string): string {
  const absolute = path.resolve(repoRoot, relative);
  expect(existsSync(absolute), `${relative} 不存在`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('EQUIVALENT 落点抽查', () => {
  it('ReaderProgressEffect.kt → core/reader/readerScreenLogic.ts', () => {
    const text = sourceText('src/core/reader/readerScreenLogic.ts');
    expect(text).toContain('export function shouldShowBackToTop(');
    expect(text).toContain('export const SCROLL_SAVE_DEBOUNCE_MS = 1500;');
    expect(text).toContain('export const BACK_TO_TOP_RATIO = 0.2;');
  });

  it('DiscoverFilters.kt / DiscoverSettings.kt → ui/pages/DiscoverPage.tsx', () => {
    const text = sourceText('src/ui/pages/DiscoverPage.tsx');
    expect(text).toContain('discover-filters');
    expect(text).toContain("store.put('personalization'");
    expect(text).toContain("store.string('cache_hours', '24')");
    expect(text).toContain("store.blockedWorks()");
  });

  it('ZLibraryNodeSelection.kt → core/source/zlibrary/{zLibraryEndpointProvider,endpointHealthChecker}.ts', () => {
    expect(sourceText('src/core/source/zlibrary/zLibraryEndpointProvider.ts')).toContain(
      'async scanForLiveNode(',
    );
    const health = sourceText('src/core/source/zlibrary/endpointHealthChecker.ts');
    for (const marker of ['zlibrary.js', 'z-cover', 'z-bookcard', 'book-item']) {
      expect(health).toContain(marker);
    }
  });

  it('ReadingSettingsPanel.kt → styles/reader.css 的 :has(.rd-sheet--settings)', () => {
    const css = sourceText('src/styles/reader.css');
    expect(css).toContain('.rd-sheet-backdrop:has(.rd-sheet--settings)');
    expect(css).toContain('max-height: 94dvh;');
    expect(css).toContain('border-radius: 28px;');
  });
});

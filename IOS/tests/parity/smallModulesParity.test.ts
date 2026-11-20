/**
 * smallModulesParity.test.ts —— 6 个「小但有用」的 Kotlin 文件逐项对拍（首批小模块收口）。
 *
 * 覆盖：
 *   `source/SourceRegistration.kt`        1 个纯函数（只放行 http/https 且无凭据的 URL）
 *   `pagecurl/utils/RectUtils.kt`         1 个扩展函数（归一化矩形 × 像素尺寸）
 *   `transfer/TransferRoutes.kt`          2 个纯函数（peer 合并 / 路由候选）
 *   `ui/comic/ComicTurnGesture.kt`        3 个函数（翻页行程 0.18 bounded 64~104、意图判定）
 *   `source/js/MxsSpacerPages.kt`         2 个函数（白边页判定 + 有界前缀跳过）
 *   `source/NovelContentChecks.kt`        11 条「内容缺失」文案
 *
 * 这些文件都很短，但每条都是「错了会静默失效」的类型：
 * URL 校验漏一个斜杠就被当成可跳转、翻页行程漂一点手感就变、白边页判定错一张图就少一页。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { validRegistrationUrl } from '@core/source/sourceRegistration';
import { multiplyRect } from '@core/pagecurl/pageCurl';
import { connectionRoutes, mergePeer, type TransferPeer } from '@core/transfer/transferRoutes';
import { comicTurnIntent, comicTurnTravel } from '@core/comic/comicTurnGesture';
import { isMxsWhiteSpacer, stripLeadingMxsSpacers } from '@core/source/js/mxsSpacerPages';
import { hasMissingNovelContent } from '@core/source/impl/novelParts';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('SourceRegistration.kt：只放行可安全外部打开的 URL', () => {
  const source = kt('com/example/source/SourceRegistration.kt');

  it('Kotlin 用 toHttpUrlOrNull + username/password 双空判定', () => {
    expect(source).toContain('?.toHttpUrlOrNull()?.takeIf { it.username.isEmpty() && it.password.isEmpty() }?.toString()');
  });

  it('http/https 放行；其它协议、带凭据、非 URL 一律 null', () => {
    expect(validRegistrationUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(validRegistrationUrl('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(validRegistrationUrl(null)).toBeNull();
    expect(validRegistrationUrl(undefined)).toBeNull();
    expect(validRegistrationUrl('   ')).toBeNull();
    expect(validRegistrationUrl('not a url')).toBeNull();
    // 非 web 协议
    expect(validRegistrationUrl('javascript:alert(1)')).toBeNull();
    expect(validRegistrationUrl('file:///etc/passwd')).toBeNull();
    expect(validRegistrationUrl('mailto:a@b.c')).toBeNull();
    // 带凭据
    expect(validRegistrationUrl('https://user:pass@example.com/')).toBeNull();
    expect(validRegistrationUrl('https://user@example.com/')).toBeNull();
    // 允许带端口与空路径
    expect(validRegistrationUrl('http://example.com:8080/')).toBe('http://example.com:8080/');
  });
});

describe('RectUtils.kt：归一化矩形 × 像素尺寸', () => {
  const source = kt('eu/wewox/pagecurl/utils/RectUtils.kt');

  it('四个角各自乘对应轴', () => {
    expect(source).toContain('topLeft = Offset(size.width * left, size.height * top)');
    expect(source).toContain('bottomRight = Offset(size.width * right, size.height * bottom)');
    expect(multiplyRect({ left: 0.25, top: 0.5, right: 0.75, bottom: 1 }, 400, 200)).toEqual({
      left: 100,
      top: 100,
      right: 300,
      bottom: 200,
    });
    // 单位矩形 → 整幅
    expect(multiplyRect({ left: 0, top: 0, right: 1, bottom: 1 }, 30, 40)).toEqual({ left: 0, top: 0, right: 30, bottom: 40 });
  });
});

describe('TransferRoutes.kt：peer 合并与路由候选', () => {
  const source = kt('com/example/transfer/TransferRoutes.kt');

  it('合并规则：新值优先、旧值兜底、路由去重后 take(8)', () => {
    expect(source).toContain('.distinct().take(8)');
    expect(source).toContain('port=if(fresh.host!=null)fresh.port else');

    const oldPeer = {
      id: 'p1',
      name: 'old',
      host: 'old.local',
      port: 1111,
      p2pAddress: '192.168.1.2',
      directPort: 2222,
      routes: [{ host: 'a.local', port: 1, networkHandle: 7 }],
      nearbyProtocol: 1,
    } as unknown as TransferPeer;
    const freshPeer = {
      id: 'p1',
      name: 'fresh',
      host: null,
      port: 3333,
      p2pAddress: null,
      directPort: null,
      routes: [{ host: 'b.local', port: 2, networkHandle: 8 }],
      nearbyProtocol: 2,
    } as unknown as TransferPeer;

    const merged = mergePeer(oldPeer, freshPeer);
    // host 回落旧值（fresh.host 为 null）
    expect(merged.host).toBe('old.local');
    // 因为 host 来自旧值，端口也用旧值（保持 host/port 成对）
    expect(merged.port).toBe(1111);
    // p2pAddress / directPort 回落旧值
    expect(merged.p2pAddress).toBe('192.168.1.2');
    expect(merged.directPort).toBe(2222);
    // 两条路由都保留（networkHandle 不同）
    expect(merged.routes).toHaveLength(2);
  });

  it('connectionRoutes：带 host 时补一条、过滤非法端口、按 host:port 去重、IPv6 排后面、take(4)', () => {
    expect(source).toContain('.filter {it.port in 1..65535}.distinctBy {it.host to it.port}');
    expect(source).toContain(".sortedBy {if(it.host.contains(':'))1 else 0}.take(4)");

    const peer = {
      id: 'x',
      name: 'x',
      host: 'h.local',
      port: 8080,
      p2pAddress: null,
      directPort: null,
      routes: [
        { host: 'h.local', port: 8080, networkHandle: 1 }, // 与 host:port 重复
        { host: '::1', port: 9090, networkHandle: 2 }, // IPv6
        { host: 'z.local', port: 0, networkHandle: 3 }, // 非法端口
      ],
      nearbyProtocol: 1,
    } as unknown as TransferPeer;

    const routes = connectionRoutes(peer);
    expect(routes.map((r) => `${r.host}:${r.port}`)).toEqual(['h.local:8080', '::1:9090']);
    expect(routes.length).toBeLessThanOrEqual(4);
  });
});

describe('ComicTurnGesture.kt：翻页行程与意图', () => {
  const source = kt('com/example/ui/comic/ComicTurnGesture.kt');

  it('行程 = clamp(span × 0.18, 64·density, 104·density)', () => {
    expect(source).toContain('(spanPx * 0.18f).coerceIn(64f * density, 104f * density)');
    // 小屏：0.18 不足 64，取 64
    expect(comicTurnTravel(100, 1)).toBe(64);
    expect(comicTurnTravel(100, 2)).toBe(128);
    // 大屏：0.18 超过 104，取 104
    expect(comicTurnTravel(1000, 1)).toBe(104);
    // 中间：正好 0.18
    expect(comicTurnTravel(500, 1)).toBeCloseTo(90, 9);
    // 平板不因屏幕变长而要求更长滑动
    expect(comicTurnTravel(2000, 2)).toBe(208);
  });

  it('意图：反向快甩 → 0；远距离 → ±1；短距快甩 → ±1；短距慢移 → 0', () => {
    expect(source).toContain('val reversed = velocityPx * distancePx < 0f && abs(velocityPx) >= 850f * density');
    expect(source).toContain('val flick = distance >= 18f * density && abs(velocityPx) >= 850f * density && velocityPx * distancePx > 0f');

    // 反向快甩（往左拖但速度朝右、超过 850）
    expect(comicTurnIntent(-50, 2000, 400, 1)).toBe(0);
    // 远距离：超过行程即可，速度不限
    expect(comicTurnIntent(120, 0, 400, 1)).toBe(1);
    expect(comicTurnIntent(-120, 0, 400, 1)).toBe(-1);
    // 短距快甩（>18 且同向且 >850）
    expect(comicTurnIntent(30, 1200, 400, 1)).toBe(1);
    // 短距慢移
    expect(comicTurnIntent(30, 100, 400, 1)).toBe(0);
    // 非法输入
    expect(comicTurnIntent(Number.NaN, 0, 400, 1)).toBe(0);
    expect(comicTurnIntent(50, 0, 0, 1)).toBe(0);
    expect(comicTurnIntent(50, 0, 400, 0)).toBe(0);
  });
});

type SpacerBitmap = Parameters<typeof isMxsWhiteSpacer>[0];

/** 构造一个「整张同色」的 Bitmap 替身（只实现 `isMxsWhiteSpacer` 用到的三个成员）。 */
function spacerBitmap(width: number, height: number, pixel: number): SpacerBitmap {
  return {
    width,
    height,
    getPixels: (_x: number, _y: number, w: number) => new Array<number>(w).fill(pixel),
  } as unknown as SpacerBitmap;
}

describe('MxsSpacerPages.kt：白边页判定与有界前缀跳过', () => {
  const source = kt('com/example/source/js/MxsSpacerPages.kt');

  it('三条尺寸门槛：宽 ≥300、高 ≤512、高 ≤ 宽/2；像素必须接近纯白（≥254）', () => {
    expect(source).toContain('if (bitmap.width < 300 || bitmap.height > 512 || bitmap.height > bitmap.width / 2) return false');
    expect(source).toContain('< 254');


    const white = 0xffffffff;
    const offWhite = 0xfffdfdfd; // 253 灰阶
    expect(isMxsWhiteSpacer(spacerBitmap(400, 200, white))).toBe(true);
    // 宽度不足
    expect(isMxsWhiteSpacer(spacerBitmap(299, 100, white))).toBe(false);
    // 太高
    expect(isMxsWhiteSpacer(spacerBitmap(400, 513, white))).toBe(false);
    // 高宽比 > 1/2
    expect(isMxsWhiteSpacer(spacerBitmap(400, 201, white))).toBe(false);
    // 不是纯白
    expect(isMxsWhiteSpacer(spacerBitmap(400, 200, offWhite))).toBe(false);
    // 全透明像素视为「不是墨」，仍算空白
    expect(isMxsWhiteSpacer(spacerBitmap(400, 200, 0x00ffffff))).toBe(true);
  });

  it('前缀检查有界：只看前 3 个 URL，遇到非白页或加载失败即停', async () => {
    expect(source).toContain('for (url in urls.take(3))');

    const whites = new Set(['w1', 'w2', 'w3', 'w4']);
    const loaded: string[] = [];
    const result = await stripLeadingMxsSpacers(['w1', 'w2', 'w3', 'w4', 'r1'], async (url) => {
      loaded.push(url);
      if (url === 'r1') return spacerBitmap(400, 200, 0xff000000);
      return whites.has(url) ? spacerBitmap(400, 200, 0xffffffff) : null;
    });
    // 前 3 个都是白页 → 跳过 3 个，从第 4 个开始
    expect(result).toEqual(['w4', 'r1']);
    expect(loaded).toEqual(['w1', 'w2', 'w3']);
  });
});

describe('NovelContentChecks.kt：11 条「内容缺失」文案', () => {
  const source = kt('com/example/source/NovelContentChecks.kt');

  it('Kotlin 列出的每条文案都必须被 iOS 识别（逐条从原文解析）', () => {
    const markers = [...source.matchAll(/"([^"\n]{2,20})"/g)].map((m) => m[1] ?? '').filter((s) => s !== '');
    expect(markers).toHaveLength(11);
    expect(markers).toContain('内容加载失败');
    expect(markers).toContain('內容加載失敗');
    expect(markers).toContain('本章节内容正在手打中');

    const missed = markers.filter((m) => !hasMissingNovelContent(`正常段落。${m}。正常段落。`));
    expect(missed).toEqual([]);
    // 单独成段也要命中
    expect(markers.filter((m) => !hasMissingNovelContent(m))).toEqual([]);
  });

  it('正常正文与空串不误报', () => {
    expect(hasMissingNovelContent('')).toBe(false);
    expect(hasMissingNovelContent('第一章 风起\n他推开门，雨下得很大。')).toBe(false);
    // 只差一个字也不该命中（不是模糊匹配）
    expect(hasMissingNovelContent('内容加载失')).toBe(false);
  });
});

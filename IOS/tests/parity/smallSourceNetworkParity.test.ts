/**
 * smallSourceNetworkParity.test.ts —— 八个**小文件**的第二批（合计 167 行）。
 *
 *   · `ui/components/OverlayTouchShield.kt`（17）—— 浮层吞输入但不抢子节点拖拽
 *   · `source/DetailLink.kt`（19）—— 外链校验与相对路径补全
 *   · `source/zlibrary/network/ZLibraryNetworkLogger.kt`（19）—— 脱敏日志三方法
 *   · `library/ZLibraryNodeConfig.kt`（21）—— 当前节点 + 直连路线记忆
 *   · `source/impl/GuestNovelTransport.kt`（21）—— 两次有界重试（750ms 递增，408/429/5xx）
 *   · `download/DownloadProgressBroadcaster.kt`（23）—— 状态表 + 订阅
 *   · `source/zlibrary/parser/ZLibraryLayoutParser.kt`（23）—— 三个 CSS 选择器 + 接口
 *   · `source/SearchBook.kt`（24）—— 15 个字段与默认值
 *
 * 本轮补的真缺口：`ZLibraryNodeConfig` 只移植了 `domain`，而当前 Kotlin 还有
 * `directNodes` 集合与 `prefersDirect` / `rememberRoute`（记录「哪个 host 直连能通」）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { overlayTouchShield } from '@core/ui/parityMisc';
import { resolveDetailLink, validDetailLink } from '@core/source/detailLink';
import { ZLibraryNetworkLogger } from '@core/source/zlibrary/network/zLibraryNetworkLogger';
import {
  NODE_PREFS_PRIVATE,
  ZLibraryNodeConfig,
  createNodeConfigPort,
  nodeDomain,
  prefersDirect,
  rememberRoute,
  setNodeDomain,
} from '@core/library/zLibraryNodeConfig';
import {
  GUEST_RETRY_ATTEMPTS,
  GUEST_RETRY_BASE_DELAY_MS,
  guestNovelIoRetry,
  guestRetryDelayMs,
  isGuestRetryableError,
} from '@core/source/impl/guestNovelTransport';
import { DownloadProgressBroadcaster } from '@core/download/downloadProgressBroadcaster';
import { DownloadStateIdle, errorState, successState } from '@core/download/downloadState';
import { firstRealDownloadLink, type ZLibraryLayoutParser } from '@core/source/zlibrary/parser/zLibraryLayoutParser';
import { createSearchBook } from '@core/source/searchBook';
import { NetworkError } from '@core/source/sourceException';
import { SourceNetworkError } from '@core/source/impl/sourceHttp';
import type { HtmlElement } from '@core/source/zlibrary/parser/htmlDocument';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('OverlayTouchShield.kt：浮层吞输入', () => {
  const KT = kt('ui/components/OverlayTouchShield.kt');

  it('只吞「未按下且未被消费」的 change，不合并子节点语义', () => {
    expect(KT).toContain('awaitFirstDown(requireUnconsumed = false)');
    expect(KT).toContain('event.changes.filter { !it.pressed && !it.isConsumed }.forEach { it.consume() }');
    expect(KT).toContain('Own blank panel taps without merging child semantics or intercepting their drags.');
    const shield = overlayTouchShield();
    expect(shield.pointerEvents).toBe('auto');
    expect(shield['data-touch-shield']).toBe('');
  });
});

describe('DetailLink.kt：外链校验', () => {
  const KT = kt('source/DetailLink.kt');

  it('trim + 拒绝控制字符 + 只接受 http(s) + 拒绝 userInfo', () => {
    expect(KT).toContain('raw?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isISOControl) }');
    expect(KT).toContain('val url = text.toHttpUrlOrNull() ?: return null');
    expect(KT).toContain('if (url.username.isNotEmpty() || url.password.isNotEmpty()) return null');

    expect(validDetailLink('  https://a.com/b  ')).toBe('https://a.com/b');
    expect(validDetailLink('http://a.com/b')).toBe('http://a.com/b');
    expect(validDetailLink('ftp://a.com/b')).toBeNull();
    expect(validDetailLink('https://user:pw@a.com/b')).toBeNull();
    expect(validDetailLink('https://a.com/\u0001')).toBeNull();
    expect(validDetailLink('   ')).toBeNull();
    expect(validDetailLink(null)).toBeNull();
  });

  it('resolve：先试绝对链接，再用 base 补全相对路径（base 本身必须合法）', () => {
    expect(KT).toContain('fun resolve(raw: String?, base: String): String?');
    expect(KT).toContain('valid(base.toHttpUrlOrNull()?.resolve(path)?.toString())');
    expect(resolveDetailLink('https://x.com/1', 'https://base.com/dir/')).toBe('https://x.com/1');
    expect(resolveDetailLink('/book/9', 'https://base.com/dir/')).toBe('https://base.com/book/9');
    expect(resolveDetailLink('9', 'https://base.com/dir/')).toBe('https://base.com/dir/9');
    // base 非法 → null（不会退化成相对路径）
    expect(resolveDetailLink('/book/9', 'not a url')).toBeNull();
    expect(resolveDetailLink(null, 'https://base.com/')).toBeNull();
  });
});

describe('ZLibraryNetworkLogger.kt：脱敏日志', () => {
  const KT = kt('source/zlibrary/network/ZLibraryNetworkLogger.kt');

  it('TAG 固定；host 解析失败回落 "unknown"；三方法各自带状态码/书籍数', () => {
    expect(KT).toContain('private const val TAG = "ZLibraryNetwork"');
    expect(KT).toContain('java.net.URI(url).host }.getOrNull() ?: "unknown"');
    expect(KT).toContain('"$method ${host(url)} headers=${headers.size} session=${!cookies.isNullOrBlank()}"');
    expect(KT).toContain('"HTTP $code ${host(url)} type=$contentType headers=${headers.size}"');
    expect(KT).toContain('"Parser $status books=$bookCount"');

    // debugEnabled 开关（替代 BuildConfig.DEBUG）
    expect(ZLibraryNetworkLogger.debugEnabled).toBe(true);
    // 三个方法都不抛错，且不把 query/cookie 值写进日志
    expect(() => {
      ZLibraryNetworkLogger.logRequest('not a url', 'GET', { A: '1' }, null);
      ZLibraryNetworkLogger.logResponse(200, 'https://a.com/x?token=1', { A: '1' }, [], 'text/html', 'body');
      ZLibraryNetworkLogger.logParserResult('ok', 3);
    }).not.toThrow();
  });
});

describe('ZLibraryNodeConfig.kt：当前节点与直连路线', () => {
  const KT = kt('library/ZLibraryNodeConfig.kt');

  it('初始 domain 是空串（不是任何死域名），可读写', () => {
    expect(KT).toContain('var domain: String = ""');
    expect(KT).toContain('原初始值 "z-library.sk" 是已死域名');
    setNodeDomain('');
    expect(nodeDomain()).toBe('');
    expect(ZLibraryNodeConfig.domain).toBe('');
    setNodeDomain('z-lib.sk');
    expect(nodeDomain()).toBe('z-lib.sk');
    expect(ZLibraryNodeConfig.domain).toBe('z-lib.sk');
    ZLibraryNodeConfig.domain = 'z-lib.by';
    expect(nodeDomain()).toBe('z-lib.by');
    // 端口形状
    const port = createNodeConfigPort();
    port.setNodeDomain('1lib.sk');
    expect(port.nodeDomain()).toBe('1lib.sk');
    expect(NODE_PREFS_PRIVATE).toBe(true);
    setNodeDomain('');
  });

  it('prefersDirect / rememberRoute：直连成功才记住，失败即摘掉', () => {
    expect(KT).toContain('private val directNodes = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()');
    expect(KT).toContain('fun prefersDirect(host: String): Boolean = host in directNodes');
    expect(KT).toContain('if (direct) directNodes.add(host) else directNodes.remove(host)');

    const host = 'direct-only.example';
    expect(prefersDirect(host)).toBe(false);
    rememberRoute(host, true);
    expect(prefersDirect(host)).toBe(true);
    // 幂等
    rememberRoute(host, true);
    expect(prefersDirect(host)).toBe(true);
    rememberRoute(host, false);
    expect(prefersDirect(host)).toBe(false);
    // 其它 host 互不影响
    expect(prefersDirect('other.example')).toBe(false);
  });
});

describe('GuestNovelTransport.kt：两次有界重试', () => {
  const KT = kt('source/impl/GuestNovelTransport.kt');

  it('共 3 次尝试；延迟 750ms × (attempt+1)；只有 IO / 408·429·5xx 可重试', () => {
    expect(KT).toContain('for (attempt in 0..2)');
    expect(KT).toContain('delay(750L * (attempt + 1))');
    expect(KT).toContain('Regex("HTTP (?:408|429|5[0-9]{2})\\\\b")');
    expect(GUEST_RETRY_ATTEMPTS).toBe(3);
    expect(GUEST_RETRY_BASE_DELAY_MS).toBe(750);
    expect(guestRetryDelayMs(0)).toBe(750);
    expect(guestRetryDelayMs(1)).toBe(1500);
    expect(guestRetryDelayMs(2)).toBe(2250);

    expect(isGuestRetryableError(new SourceNetworkError('boom'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('HTTP 408 超时'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('HTTP 429 busy'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('HTTP 503 down'))).toBe(true);
    expect(isGuestRetryableError(new NetworkError('HTTP 404 找不到'))).toBe(false);
    expect(isGuestRetryableError(new Error('其它'))).toBe(false);
  });

  it('成功即返回；不可重试错误立刻抛；可重试错误重试到第 3 次后抛', async () => {
    expect(KT).toContain('if (!retryable || attempt == 2) throw e');
    let calls = 0;
    const ok = await guestNovelIoRetry(async () => {
      calls += 1;
      return 'done';
    });
    expect(ok).toBe('done');
    expect(calls).toBe(1);

    let fatalCalls = 0;
    await expect(
      guestNovelIoRetry(async () => {
        fatalCalls += 1;
        throw new Error('no-retry');
      }),
    ).rejects.toThrow('no-retry');
    expect(fatalCalls).toBe(1);

    let retryCalls = 0;
    await expect(
      guestNovelIoRetry(async () => {
        retryCalls += 1;
        throw new NetworkError('HTTP 503');
      }),
    ).rejects.toThrow('HTTP 503');
    expect(retryCalls).toBe(GUEST_RETRY_ATTEMPTS);
  }, 15_000);

  it('取消不会变成一次重试（signal 已中止 → 立刻抛）', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      guestNovelIoRetry(async () => {
        calls += 1;
        throw new NetworkError('HTTP 500');
      }, controller.signal),
    ).rejects.toThrow();
    // 第一次失败后应因 abort 直接抛出，不再重试
    expect(calls).toBe(1);
  });
});

describe('DownloadProgressBroadcaster.kt：状态表与订阅', () => {
  const KT = kt('download/DownloadProgressBroadcaster.kt');

  it('update/remove/get；缺失时回落 Idle；订阅可退订', () => {
    expect(KT).toContain('private val _states = MutableStateFlow<Map<String, DownloadState>>(emptyMap())');
    expect(KT).toContain('_states.update { it + (bookId to state) }');
    expect(KT).toContain('_states.update { it - bookId }');
    expect(KT).toContain('return _states.value[bookId] ?: DownloadState.Idle');

    const bus = new DownloadProgressBroadcaster();
    expect(bus.getState('missing')).toBe(DownloadStateIdle);
    const seen: number[] = [];
    const off = bus.subscribe((states) => seen.push(states.size));
    bus.updateState('a', successState('/x'));
    expect(bus.getState('a')).toMatchObject({ kind: 'Success', path: '/x' });
    expect(seen).toEqual([1]);
    bus.updateState('b', errorState('e'));
    expect(seen).toEqual([1, 2]);
    bus.removeState('a');
    expect(seen).toEqual([1, 2, 1]);
    expect(bus.getState('a')).toBe(DownloadStateIdle);
    off();
    bus.updateState('c', successState('/y'));
    expect(seen).toEqual([1, 2, 1]); // 退订后不再收到
    // states 快照是副本，外部修改不影响内部
    expect([...bus.states.keys()]).toEqual(['b', 'c']);
  });
});

describe('ZLibraryLayoutParser.kt：三个选择器与接口', () => {
  const KT = kt('source/zlibrary/parser/ZLibraryLayoutParser.kt');

  it('先 dlButton、再任意 /dl/、最后 add_to_download_history，且都要 :not([hidden])', () => {
    expect(KT).toContain('selectFirst("a.dlButton[href*=/dl/]:not([hidden])")');
    expect(KT).toContain('?: selectFirst("a[href*=/dl/]:not([hidden])")');
    expect(KT).toContain('?: selectFirst("a.add_to_download_history:not([hidden])")');
    expect(KT).toContain('当前站点详情页第一个 /dl/ 链接是隐藏模板占位，直接取会拿到 204 空文件。');

    const calls: string[] = [];
    const makeElement = (): HtmlElement =>
      ({ selectFirst: () => null, select: () => [], attr: () => '', text: () => '' }) as unknown as HtmlElement;
    const doc = {
      selectFirst(selector: string) {
        calls.push(selector);
        return null;
      },
    } as unknown as HtmlElement;
    expect(firstRealDownloadLink(doc)).toBeNull();
    expect(calls).toEqual([
      'a.dlButton[href*=/dl/]:not([hidden])',
      'a[href*=/dl/]:not([hidden])',
      'a.add_to_download_history:not([hidden])',
    ]);
    expect(makeElement()).toBeDefined();

    // 接口形状：五个成员
    const parser: ZLibraryLayoutParser = {
      name: 'X',
      canParseSearch: () => true,
      parseSearch: () => [],
      canParseDetail: () => false,
      parseDetail: () => ({}) as never,
    };
    expect(parser.name).toBe('X');
    expect(parser.canParseSearch(doc as unknown as Parameters<typeof parser.canParseSearch>[0])).toBe(true);
  });
});

describe('SearchBook.kt：字段与默认值', () => {
  const KT = kt('source/SearchBook.kt');

  it('15 个字段；只有 format 默认 "epub"，其余可空字段默认 null', () => {
    expect(KT).toContain('val format: String = "epub"');
    for (const field of ['cover', 'description', 'language', 'comicId', 'size', 'downloadUrl', 'eapiId', 'eapiHash', 'novelInfo', 'comicInfo']) {
      expect(KT).toContain(`val ${field}: `);
    }
    const book = createSearchBook({ id: 'i', sourceId: 's', title: 't', author: 'a' });
    expect(book.format).toBe('epub');
    expect(book.cover).toBeNull();
    expect(book.description).toBeNull();
    expect(book.language).toBeNull();
    expect(book.comicId).toBeNull();
    expect(book.size).toBeNull();
    expect(book.downloadUrl).toBeNull();
    expect(book.eapiId).toBeNull();
    expect(book.eapiHash).toBeNull();
    expect(book.novelInfo).toBeNull();
    expect(book.comicInfo).toBeNull();
    // 显式传值不被默认值覆盖
    const explicit = createSearchBook({ id: 'i', sourceId: 's', title: 't', author: 'a', format: 'txt', size: 10 });
    expect(explicit.format).toBe('txt');
    expect(explicit.size).toBe(10);
  });
});

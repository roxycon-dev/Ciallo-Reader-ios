/**
 * E99 —— 四站强制 HTTP/1.1 的「断连分类 + 换栈重试」接线测试。
 *
 * 权威行为：`src/core/source/js/JsMessageHandler.kt:198-209`（Android 只读参考）
 *
 *   CronetEngine.Builder(context)
 *       // 部分站点（拷贝漫画/漫画柜）对 HTTP/2 直接断连，强制 HTTP/1.1 与 Venera 一致
 *       .enableHttp2(sourceKey in setOf("mycomic", "nhentai", "pufei", "bilimanga"))
 *       .enableBrotli(true)
 *       .enableQuic(false)
 *
 * iOS 的 WKWebView / URLSession 由 ALPN 协商协议，JS 与原生插件都没有「本请求
 * 禁用 h2」的开关，所以最强等效是：首次按默认发（可能走 h2）→ 被对端断连时
 * `isHttp2Rejection` 分类 → `markHttp1Forced` 标记该源 → **只重试一次** →
 * 仍失败则把**原错误**上抛。
 *
 * 本文件锁的正是这条接线 —— `platform/web/webHttpProtocol.ts` 此前全仓零 import，
 * 而这 5 个导出被接上之后，任何一处回退（漏接 catch、重试两次、吞掉错误、
 * 把 CORS 也当成 h2 断连）都会在这里炸。
 *
 * `SourceWorkerEngine.requestWithHttp1Fallback`（host-call 分支）用同一策略，
 * 但它需要真实的 `Worker`，jsdom 提供不了，故由 `sourceWorkerLifecycle` /
 * `veneraWorker` 那两个套件覆盖其生命周期部分，策略本身与 handler 共用同一对
 * 纯函数（`isHttp2Rejection` / `markHttp1Forced`），此处不重复造桩。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JsCookieJarStore } from '../../src/core/source/js/jsCookieJar';
import { JsHtmlStore } from '../../src/core/source/js/jsHtmlStore';
import {
  JsMessageHandler,
  type JsMessageHandlerDeps,
} from '../../src/core/source/js/jsMessageHandler';
import {
  createMemoryKeyValueStorage,
  type HtmlDomParser,
  type HttpRequestSpec,
  type HttpResponseSpec,
} from '../../src/core/source/js/jsPlatform';
import {
  HTTP1_FORCE_SOURCES,
  isHttp2Rejection,
  markHttp1Forced,
  needsHttp1,
  resetHttp1ForceCache,
} from '../../src/platform/web/webHttpProtocol';

// ----------------------------------------------------------------------
// stubs
// ----------------------------------------------------------------------

/** `JsHtmlStore` 在 http 路径上不会被碰到，这里只满足构造签名。 */
const unusedDom: HtmlDomParser = {
  parse: () => {
    throw new Error('E99 测试不解析 HTML');
  },
  wholeText: () => '',
};

function okResponse(bodyText: string): HttpResponseSpec {
  return {
    status: 200,
    finalUrl: 'https://example.com/api',
    headers: { 'content-type': 'text/plain' },
    setCookies: [],
    body: new TextEncoder().encode(bodyText),
  };
}

interface Harness {
  readonly handler: JsMessageHandler;
  /** 每次真正打到传输层的请求，用来断言「重试了几次」「重试带了什么头」。 */
  readonly calls: HttpRequestSpec[];
}

function createHandler(
  sourceKey: string,
  execute: (request: HttpRequestSpec, attempt: number) => Promise<HttpResponseSpec>,
): Harness {
  const prefs = createMemoryKeyValueStorage();
  const calls: HttpRequestSpec[] = [];
  const deps: JsMessageHandlerDeps = {
    dataPrefs: prefs,
    htmlStore: new JsHtmlStore(unusedDom),
    crypto: {
      digest: () => new Uint8Array(16),
      hmac: () => new Uint8Array(32),
      aesDecrypt: () => new Uint8Array(0),
      rsaDecrypt: () => new Uint8Array(0),
      randomUUID: () => 'uuid',
      randomInt: (min: number) => min,
      randomDouble: (min: number) => min,
    },
    http: {
      execute: (request: HttpRequestSpec): Promise<HttpResponseSpec> => {
        calls.push(request);
        return execute(request, calls.length);
      },
    },
    cookies: new JsCookieJarStore(prefs),
    sourceProxy: {
      matches: () => false,
      rememberProxySuccess: () => undefined,
      forgetRoute: () => undefined,
    },
    solveCloudflare: async () => false,
    isChallengeResponse: () => false,
    // 系统代理为 null → `handleHttp` 不会走 retryViaProxy 分支，读到的次数只来自本改动。
    systemProxy: () => null,
    gunzipIfNeeded: (bytes) => bytes,
    timeouts: { connectMs: 20_000, readMs: 30_000, callMs: 0 },
    decodeCharset: (_label, bytes) => new TextDecoder().decode(bytes),
    decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
    encodeUtf8: (value) => new TextEncoder().encode(value),
    encodeCharset: (_label, value) => new TextEncoder().encode(value),
    decodeLatin1: (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''),
    elapsedRealtime: () => Date.now(),
    wallClock: () => Date.now(),
    maxMemory: () => 256 * 1024 * 1024,
    startPolling: () => () => undefined,
    sleep: () => undefined,
    showInputDialog: async () => '',
  };
  return { handler: new JsMessageHandler(deps, sourceKey, false), calls };
}

interface ScriptHttpResponse {
  readonly status?: number;
  readonly url?: string;
  readonly body?: string | null;
  readonly error?: string;
}

async function request(handler: JsMessageHandler, headers: Record<string, string> = {}): Promise<ScriptHttpResponse> {
  const raw = await handler.handleAsync({
    method: 'http',
    url: 'https://example.com/api',
    http_method: 'GET',
    headers,
  });
  return JSON.parse(String(raw)) as ScriptHttpResponse;
}

beforeEach(() => {
  // 标记表是模块级状态：每个用例从「空持久层 + 空内存」开始。
  sessionStorage.clear();
  resetHttp1ForceCache();
});

// ----------------------------------------------------------------------
// 白名单（Kotlin L202）
// ----------------------------------------------------------------------

describe('E99：HTTP1_FORCE_SOURCES / needsHttp1', () => {
  it('四站 id 全部命中 needsHttp1，且集合就是 Kotlin 那四个', () => {
    expect([...HTTP1_FORCE_SOURCES].sort()).toEqual(['bilimanga', 'mycomic', 'nhentai', 'pufei']);
    for (const id of ['mycomic', 'nhentai', 'pufei', 'bilimanga']) {
      expect(needsHttp1(id), id).toBe(true);
    }
  });

  it('非四站不命中（白名单不是「全部 true」）', () => {
    for (const id of ['ikmmh', 'test', 'ehentai', 'alicesw', 'guanxingren']) {
      expect(needsHttp1(id), id).toBe(false);
    }
  });
});

// ----------------------------------------------------------------------
// 断连分类
// ----------------------------------------------------------------------

describe('E99：isHttp2Rejection', () => {
  it('网络层断连（TypeError）报 true', () => {
    // Safari / Chromium / WKWebView 的三种实际文案
    expect(isHttp2Rejection(new TypeError('Failed to fetch'))).toBe(true);
    expect(isHttp2Rejection(new TypeError('Load failed'))).toBe(true);
    expect(isHttp2Rejection(new TypeError('The network connection was lost.'))).toBe(true);
    expect(isHttp2Rejection(new TypeError('net::ERR_HTTP2_PROTOCOL_ERROR'))).toBe(true);
    expect(isHttp2Rejection(new TypeError('The request timed out.'))).toBe(true);
  });

  it('CORS / AbortError / TLS 报 false（降级也救不了的原因不能触发重试）', () => {
    // CORS：`TypeError` 但明确是跨域策略
    expect(isHttp2Rejection(new TypeError('CORS request rejected'))).toBe(false);
    expect(isHttp2Rejection(new TypeError('Cross-origin resource blocked'))).toBe(false);
    // 取消 / 超时：AbortError 不是 TypeError，且文案含 abort
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    expect(isHttp2Rejection(abortError)).toBe(false);
    expect(isHttp2Rejection(new DOMException('Aborted', 'AbortError'))).toBe(false);
    expect(isHttp2Rejection(new TypeError('The user aborted a request'))).toBe(false);
    // TLS / 证书
    expect(isHttp2Rejection(new TypeError('SSL certificate problem: self signed'))).toBe(false);
    expect(isHttp2Rejection(new TypeError('TLS handshake failed'))).toBe(false);
    expect(isHttp2Rejection(new TypeError('net::ERR_CERT_AUTHORITY_INVALID'))).toBe(false);
    // 非网络异常 / 空消息
    expect(isHttp2Rejection(new Error('Failed to fetch'))).toBe(false);
    expect(isHttp2Rejection('Failed to fetch')).toBe(false);
    expect(isHttp2Rejection(null)).toBe(false);
    expect(isHttp2Rejection(new TypeError(''))).toBe(false);
  });
});

// ----------------------------------------------------------------------
// 标记
// ----------------------------------------------------------------------

describe('E99：markHttp1Forced', () => {
  it('命中后 needsHttp1 变 true，并且写进了 sessionStorage（跨页保持）', () => {
    expect(needsHttp1('demo-source')).toBe(false);
    markHttp1Forced('demo-source');
    expect(needsHttp1('demo-source')).toBe(true);
    // 重读持久层：模块级表被清掉后仍然为 true，说明 sessionStorage 那一层也写了。
    resetHttp1ForceCache();
    expect(needsHttp1('demo-source')).toBe(true);
  });

  it('Worker 宿主（没有 sessionStorage）：标记表退化成模块级内存，判定照样生效', () => {
    // `sourceWorker/entry.ts` 跑在 Worker 里，那里没有 `sessionStorage`。
    // `webHttpProtocol` 用 `typeof sessionStorage === 'undefined'` 守卫取值，
    // 于是持久层写入变成 no-op —— 但模块级标记表必须照常工作，否则 Worker
    // 里这四个站的判定会永远为 false。
    vi.stubGlobal('sessionStorage', undefined);
    try {
      expect(needsHttp1('worker-source')).toBe(false);
      markHttp1Forced('worker-source');
      expect(needsHttp1('worker-source')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    // 已知限制（E99 报告里登记，不修）：Worker 被 `reset()` 重建后标记丢失 ——
    // 没有持久层可回读，内存里的这条随 `resetHttp1ForceCache` 一起清掉。
    sessionStorage.clear();
    resetHttp1ForceCache();
    expect(needsHttp1('worker-source')).toBe(false);
  });
});

// ----------------------------------------------------------------------
// 接线：handler 的 http 出口
// ----------------------------------------------------------------------

describe('E99：JsMessageHandler 的 http 出口', () => {
  it('h2 断连 → 重试一次；第二次成功则返回数据，并把源标记为 HTTP/1.1', async () => {
    const { handler, calls } = createHandler('demo-source', async (_request, attempt) => {
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return okResponse('{"ok":true}');
    });

    expect(needsHttp1('demo-source')).toBe(false);
    const response = await request(handler);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('https://example.com/api');
    expect(calls[1]?.method).toBe('GET');
    expect(response.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    // 标记必须在这次请求里完成，后续请求才不会又白挨一次断连。
    expect(needsHttp1('demo-source')).toBe(true);
  });

  it('重试仍失败 → 原错误上抛且只重试一次（不吞、不换成第二次的错误）', async () => {
    const { handler, calls } = createHandler('demo-source', async (_request, attempt) => {
      throw new TypeError(attempt === 1 ? 'Failed to fetch' : 'Load failed');
    });

    const response = await request(handler);

    expect(calls).toHaveLength(2);
    expect(response.error).toContain('Failed to fetch');
    expect(response.error).not.toContain('Load failed');
    // 文案保持 Kotlin 的形状：`[url] message`
    expect(response.error).toContain('https://example.com/api');
    // 失败也要标记：下一次请求就不必再挨一次 h2 断连。
    expect(needsHttp1('demo-source')).toBe(true);
  });

  it('非 h2 断连（CORS TypeError）不重试，直接返回原错误', async () => {
    const { handler, calls } = createHandler('demo-source', async () => {
      throw new TypeError('CORS request rejected');
    });

    const response = await request(handler);

    expect(calls).toHaveLength(1);
    expect(response.error).toContain('CORS request rejected');
    expect(needsHttp1('demo-source')).toBe(false);
  });

  it('已标记的源在请求前就丢掉 h2 专有的 Priority 头（白名单四站同理）', async () => {
    const { handler, calls } = createHandler('mycomic', async () => okResponse('ok'));

    expect(needsHttp1('mycomic')).toBe(true);
    await request(handler, { Priority: 'u=0, i', 'X-Keep': '1' });

    expect(calls).toHaveLength(1);
    const sent = calls[0]?.headers ?? {};
    expect(Object.keys(sent).some((name) => name.toLowerCase() === 'priority')).toBe(false);
    // 非 h2 专有头必须原样保留
    expect(sent['X-Keep']).toBe('1');
  });
});

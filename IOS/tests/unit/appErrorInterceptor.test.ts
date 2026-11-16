/**
 * Tests for `src/core/data/remote/appErrorInterceptor.ts` — port of Android
 * `data/remote/AppErrorInterceptor.kt` (Module A).
 *
 * Every expectation below is derived from the Kotlin source, not from the TS
 * implementation: the Chinese message templates, the status-code dispatch, the
 * MESSAGE_KEYS order, the 160/80 char clamps and the 409 pass-through.
 */
import { describe, expect, it } from 'vitest';
import {
  AppErrorInterceptor,
  NetworkErrorMessage,
  ServerMessageExtractor,
  isNonRetryableError,
  type NetworkResponse,
} from '../../src/core/data/remote/appErrorInterceptor';

describe('NetworkErrorMessage (Android NetworkErrorMessage.kt 19..69)', () => {
  it('serverHttp maps 401/403 to the re-login message', () => {
    const e = NetworkErrorMessage.serverHttp(401, null, 'https://x/');
    expect(e.message).toBe('服务器拒绝访问（401），可能需要重新登录或书源已失效');
    expect(e.url).toBe('https://x/');
    expect(e.responseCode).toBe(401);
  });

  it('serverHttp maps 404 / 429 / 5xx verbatim', () => {
    expect(NetworkErrorMessage.serverHttp(404, null).message).toBe('服务器上没有这个内容（404）');
    expect(NetworkErrorMessage.serverHttp(429, null).message).toBe(
      '请求过于频繁，服务器暂时拒绝了请求（429）',
    );
    expect(NetworkErrorMessage.serverHttp(503, null).message).toBe(
      '服务器出错了（503），通常是源站繁忙，稍后再试',
    );
    expect(NetworkErrorMessage.serverHttp(500, null).message).toBe(
      '服务器出错了（500），通常是源站繁忙，稍后再试',
    );
  });

  it('serverHttp falls back to the trimmed server message for other codes', () => {
    expect(NetworkErrorMessage.serverHttp(418, '  teapot  ').message).toBe('teapot');
    expect(NetworkErrorMessage.serverHttp(400, null).message).toBe('服务器返回错误（400）');
  });

  it('serverHttp appends the server reason without duplicating it', () => {
    // Android: base contains the reason already -> no second append.
    const e = NetworkErrorMessage.serverHttp(400, '服务器返回错误（400）');
    expect(e.message).toBe('服务器返回错误（400）');
  });

  it('serverUnknown / networkTimeout / networkGeneric keep their literals', () => {
    expect(NetworkErrorMessage.serverUnknown(502, 'u').message).toBe('服务器返回未知响应（502）');
    expect(NetworkErrorMessage.networkTimeout().message).toBe('连接超时，请检查网络后重试');
    expect(NetworkErrorMessage.networkGeneric().message).toBe('网络异常，请稍后重试');
  });

  it('fromCause reproduces the java.net / javax.net.ssl mapping (Kotlin 25..34)', () => {
    expect(NetworkErrorMessage.fromCause('SocketTimeoutException', 'x').message).toBe(
      '连接超时，请检查网络后重试',
    );
    expect(NetworkErrorMessage.fromCause('UnknownHostException', 'x').message).toBe(
      '无法解析服务器地址，请检查网络或书源',
    );
    expect(NetworkErrorMessage.fromCause('ConnectException', 'x').message).toBe('无法连接到服务器');
    expect(NetworkErrorMessage.fromCause('SSLException', 'x').message).toBe(
      '安全连接失败，服务器证书可能不受信任',
    );
    // else branch: non-blank cause message wins, blank/null falls back.
    expect(NetworkErrorMessage.fromCause('other', 'boom').message).toBe('boom');
    expect(NetworkErrorMessage.fromCause('other', '   ').message).toBe('网络请求失败');
    expect(NetworkErrorMessage.fromCause('other', null).message).toBe('网络请求失败');
  });

  it('toMessage ignores its context argument (Kotlin 40)', () => {
    const e = new NetworkErrorMessage('hi');
    expect(e.toMessage()).toBe('hi');
    expect(e.toMessage({} as never)).toBe('hi');
  });
});

describe('ServerMessageExtractor (Android 78..110)', () => {
  it('exposes MESSAGE_KEYS in Android order', () => {
    expect([...ServerMessageExtractor.MESSAGE_KEYS]).toEqual([
      'message',
      'msg',
      'error',
      'detail',
      'errorMsg',
      'messageStr',
    ]);
  });

  it('picks the first present key and clamps to 160 chars', () => {
    const long = 'x'.repeat(161);
    expect(ServerMessageExtractor.extract('{"msg":"ok"}', 400)).toBe('服务器返回错误（400）（ok）');
    expect(ServerMessageExtractor.extract(JSON.stringify({ detail: long }), 400)).toBe(
      '服务器返回错误（400）',
    );
    expect(ServerMessageExtractor.extract(JSON.stringify({ message: 'a'.repeat(160) }), 400)).toBe(
      '服务器返回错误（400）（' + 'a'.repeat(160) + '）',
    );
  });

  it('prefers the earliest key even when a later one is shorter', () => {
    const body = JSON.stringify({ msg: 'first', error: 'second' });
    expect(ServerMessageExtractor.extract(body, 400)).toBe('服务器返回错误（400）（first）');
  });

  it('short-circuits on an EMPTY body before any status table (Kotlin 84..85)', () => {
    // Kotlin: `if (text.isEmpty()) return "服务器返回错误（$code）"` runs first, so an empty
    // body never reaches the 429/401/404/5xx fallback table.
    expect(ServerMessageExtractor.extract(null, 429)).toBe('服务器返回错误（429）');
    expect(ServerMessageExtractor.extract('', 401)).toBe('服务器返回错误（401）');
    expect(ServerMessageExtractor.extract('   ', 404)).toBe('服务器返回错误（404）');
    expect(ServerMessageExtractor.extract('', 502)).toBe('服务器返回错误（502）');
  });

  it('handles the 429 short-circuit for a non-empty body (Kotlin 88..91)', () => {
    expect(ServerMessageExtractor.extract('{}', 429)).toBe('请求过于频繁，服务器暂时拒绝了请求（429）');
    expect(ServerMessageExtractor.extract('{"msg":"slow down"}', 429)).toBe(
      '请求过于频繁，服务器暂时拒绝了请求（429）（slow down）',
    );
  });

  it('uses the non-429 fallback table for a non-empty body', () => {
    expect(ServerMessageExtractor.extract('{}', 401)).toBe(
      '服务器拒绝访问（401），可能需要重新登录或书源已失效',
    );
    expect(ServerMessageExtractor.extract('{}', 403)).toBe(
      '服务器拒绝访问（403），可能需要重新登录或书源已失效',
    );
    expect(ServerMessageExtractor.extract('{}', 404)).toBe('服务器上没有这个内容（404）');
    expect(ServerMessageExtractor.extract('{}', 502)).toBe(
      '服务器出错了（502），通常是源站繁忙，稍后再试',
    );
    expect(ServerMessageExtractor.extract('{}', 418)).toBe('服务器返回错误（418）');
  });

  it('truncates non-JSON bodies to 80 chars and skips HTML (Kotlin 107..108)', () => {
    const plain = 'gateway error '.repeat(20);
    const out = ServerMessageExtractor.extract(plain, 400);
    expect(out.startsWith('服务器返回错误（400）（')).toBe(true);
    expect(out.endsWith('）')).toBe(true);
    // Kotlin `.take(80)` happens BEFORE `.trim()`, so the payload is exactly 80 chars.
    expect(out.slice('服务器返回错误（400）（'.length, out.length - 1)).toHaveLength(80);
    expect(ServerMessageExtractor.extract('<html>404</html>', 404)).toBe('服务器上没有这个内容（404）');
  });

  it('rejects a non-object JSON payload and falls back to the raw-text branch', () => {
    // Kotlin: JSONObject("[1,2]") throws -> catch branch -> text does not start with '<'
    expect(ServerMessageExtractor.extract('[1,2]', 400)).toBe('服务器返回错误（400）（[1,2]）');
  });
});

describe('isNonRetryableError (Android 146..150)', () => {
  it('is true only for 401/403 NetworkErrorMessage', () => {
    expect(isNonRetryableError(NetworkErrorMessage.serverHttp(401, null))).toBe(true);
    expect(isNonRetryableError(NetworkErrorMessage.serverHttp(403, null))).toBe(true);
    expect(isNonRetryableError(NetworkErrorMessage.serverHttp(500, null))).toBe(false);
    expect(isNonRetryableError(new Error('服务器拒绝访问（401）'))).toBe(false);
    expect(isNonRetryableError('401')).toBe(false);
    expect(isNonRetryableError(null)).toBe(false);
  });
});

describe('AppErrorInterceptor (Android 112..144)', () => {
  const interceptor = new AppErrorInterceptor();

  function resp(status: number, body: string | null, closed = { value: false }): NetworkResponse {
    return { status, body, close: () => { closed.value = true; } };
  }

  it('passes 2xx through untouched (no body read, no close)', async () => {
    const closed = { value: false };
    const r = resp(200, 'body', closed);
    const out = await interceptor.intercept({ url: 'https://x/' }, async () => r);
    expect(out).toBe(r);
    expect(closed.value).toBe(false);
  });

  it('passes 409 through WITHOUT reading or closing (Kotlin 130..135)', async () => {
    const closed = { value: false };
    const r = resp(409, '{"message":"这本书已经在书架里了"}', closed);
    const out = await interceptor.intercept({ url: 'https://x/' }, async () => r);
    expect(out).toBe(r);
    expect(closed.value).toBe(false);
  });

  it('rewrites a non-2xx into NetworkErrorMessage and closes the response', async () => {
    const closed = { value: false };
    const r = resp(500, '<html>oops</html>', closed);
    await expect(
      interceptor.intercept({ url: 'https://x/a' }, async () => r),
    ).rejects.toThrow('服务器出错了（500），通常是源站繁忙，稍后再试');
    expect(closed.value).toBe(true);
  });

  it('wraps transport failures via the java.net mapping', async () => {
    const timeout = Object.assign(new Error('read timed out'), { name: 'SocketTimeoutException' });
    await expect(
      interceptor.intercept({ url: 'https://x/a' }, async () => {
        throw timeout;
      }),
    ).rejects.toThrow('连接超时，请检查网络后重试');

    await expect(
      interceptor.intercept({ url: 'https://x/a' }, async () => {
        throw new Error('weird socket error');
      }),
    ).rejects.toThrow('weird socket error');
  });

  it('treats a missing body as an empty string (Kotlin 136 + the 84..85 early return)', async () => {
    const r = resp(404, null);
    await expect(
      interceptor.intercept({ url: 'https://x/a' }, async () => r),
    ).rejects.toThrow('服务器返回错误（404）');
  });
});
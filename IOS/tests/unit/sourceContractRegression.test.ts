/**
 * Regression pins for the four behaviour bugs this review found and fixed in the
 * `com.example.source` contract layer. Each test names the Kotlin line that decides it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  executeCancellable,
  executeFetchWithCancellation,
  isPrivateAddress,
} from '../../src/core/source/networkCalls';
import {
  PUFEI_IMAGE_REFERER,
  PUFEI_RETRY_PARAM,
  intercept,
} from '../../src/core/source/pufeiImageCacheRetry';
import type { HttpRequest, HttpResponse } from '../../src/platform/interfaces';

describe('PufeiImageCacheRetry — OkHttp header semantics', () => {
  const base: HttpRequest = {
    url: 'https://img1.6wm.top/chapter/1/2.jpg',
    method: 'GET',
    headers: { Referer: PUFEI_IMAGE_REFERER },
  };

  const run = async (
    request: HttpRequest,
    statuses: number[],
  ): Promise<{ urls: string[]; headers: Array<Record<string, string> | undefined>; last: HttpResponse }> => {
    const urls: string[] = [];
    const headers: Array<Record<string, string> | undefined> = [];
    let call = 0;
    const last = await intercept({
      request,
      proceed: (req) => {
        urls.push(req.url);
        headers.push(req.headers);
        const status = statuses[Math.min(call, statuses.length - 1)] ?? 200;
        call += 1;
        return Promise.resolve({ status, headers: {}, body: new Uint8Array(), url: req.url });
      },
      isCanceled: () => false,
    });
    return { urls, headers, last };
  };

  it('matches the Referer case-insensitively (Kotlin L14 `request.header("Referer")`)', async () => {
    // OkHttp's Headers is a case-insensitive multimap; a plain Record lookup missed this.
    const { urls } = await run({ ...base, headers: { referer: PUFEI_IMAGE_REFERER } }, [502, 200]);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1] as string).searchParams.has(PUFEI_RETRY_PARAM)).toBe(true);
  });

  it('still matches the exact-case header', async () => {
    const { urls } = await run(base, [502, 200]);
    expect(urls).toHaveLength(2);
  });

  it('a differently-cased Referer with a different value still blocks the retry', async () => {
    const { urls } = await run(
      { ...base, headers: { REFERER: 'https://elsewhere.example/' } },
      [502, 502],
    );
    expect(urls).toHaveLength(1);
  });

  it('replaces a pre-existing Cache-Control instead of adding a second one (Headers.Builder.set)', async () => {
    const { headers } = await run(
      { ...base, headers: { Referer: PUFEI_IMAGE_REFERER, 'cache-control': 'max-age=600' } },
      [500, 200],
    );
    const retried = headers[1] ?? {};
    expect(Object.keys(retried).filter((k) => k.toLowerCase() === 'cache-control')).toEqual([
      'Cache-Control',
    ]);
    expect(retried['Cache-Control']).toBe('no-cache');
    // Unrelated headers survive.
    expect(retried['Referer']).toBe(PUFEI_IMAGE_REFERER);
  });

  it('leaves the FIRST request completely untouched (no headers mutated)', async () => {
    const original: Record<string, string> = {
      Referer: PUFEI_IMAGE_REFERER,
      'cache-control': 'max-age=600',
    };
    await run({ ...base, headers: original }, [500, 200]);
    expect(original).toEqual({
      Referer: PUFEI_IMAGE_REFERER,
      'cache-control': 'max-age=600',
    });
  });

  it('the minute bucket is floor(now / 60_000) (Kotlin L22 integer division)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_123_456);
    try {
      const { urls } = await run(base, [502, 200]);
      const bucket = new URL(urls[1] as string).searchParams.get(PUFEI_RETRY_PARAM);
      expect(bucket).toBe(String(Math.floor(1_700_000_123_456 / 60_000)));
      expect(bucket).toBe('28333335');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('replaces an existing pufei_retry rather than appending (OkHttp setQueryParameter)', async () => {
    const { urls } = await run(
      { ...base, url: `${base.url}?${PUFEI_RETRY_PARAM}=old` },
      [503, 200],
    );
    expect(urls[1]?.match(new RegExp(PUFEI_RETRY_PARAM, 'g'))).toHaveLength(1);
    expect(new URL(urls[1] as string).searchParams.get(PUFEI_RETRY_PARAM)).not.toBe('old');
  });

  it('a missing method defaults to GET (Kotlin Request.method is never null)', async () => {
    // Omit `method` entirely rather than setting it to `undefined`: the Kotlin
    // case under test is the *absent* property, and `exactOptionalPropertyTypes`
    // forbids an explicit `undefined`.
    const { method: _omitted, ...withoutMethod } = base;
    const { urls } = await run(withoutMethod, [502, 200]);
    expect(urls).toHaveLength(2);
  });

  it('the 5xx window is inclusive at both ends (Kotlin L15 `code !in 500..599`)', async () => {
    for (const status of [500, 599]) {
      const { urls } = await run(base, [status, 200]);
      expect(urls, String(status)).toHaveLength(2);
    }
    for (const status of [499, 600]) {
      const { urls } = await run(base, [status, 200]);
      expect(urls, String(status)).toHaveLength(1);
    }
  });
});

describe('networkCalls — IPv4-mapped IPv6 is not a guard bypass', () => {
  it('classifies ::ffff:<v4> as its IPv4 address', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.1.2.3')).toBe(true);
    expect(isPrivateAddress('0:0:0:0:0:ffff:c0a8:1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('does not treat a non-mapped ::ffff:0:… / ::ffff:ffff:… as IPv4', () => {
    // Java's isIPv4MappedAddress requires bytes 0-9 == 0 and bytes 10-11 == 0xff.
    expect(isPrivateAddress('::ffff:0:127.0.0.1')).toBe(false);
    expect(isPrivateAddress('::ffff:ffff:127.0.0.1')).toBe(false);
  });

  it('still classifies the plain IPv6 ranges after the rewrite', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['2001:4860:4860::8888', '2606:4700::1111', 'not-an-address', '']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('networkCalls — executeCancellable on a no-body HTTP status', () => {
  const realFetch = globalThis.fetch;

  const stubFetch = (status: number, body: string | null): void => {
    globalThis.fetch = vi.fn(async () =>
      body === null
        ? new Response(null, { status })
        : new Response(body, { status }),
    ) as unknown as typeof fetch;
  };

  it('returns a 204 response instead of throwing (Kotlin wraps every OkHttp body)', async () => {
    // A real 204 never carries a body, so the stub must not try to build one.
    stubFetch(204, null);
    try {
      const response = await executeCancellable('https://e.com/a');
      expect(response.status).toBe(204);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns a 304 response too', async () => {
    stubFetch(304, null);
    try {
      const response = await executeCancellable('https://e.com/a');
      expect(response.status).toBe(304);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('still streams a normal body through the wrapper', async () => {
    stubFetch(200, 'hello');
    try {
      const response = await executeCancellable('https://e.com/a');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hello');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects immediately when the parent signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    globalThis.fetch = vi.fn(async () => {
      called = true;
      return new Response('x', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await expect(
        executeFetchWithCancellation('https://e.com/a', {}, controller.signal),
      ).rejects.toBeDefined();
      // Kotlin `job?.ensureActive()` throws before `execute()` is ever called.
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects when the parent aborts mid-flight', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    try {
      const pending = executeFetchWithCancellation(
        'https://e.com/a',
        {},
        controller.signal,
      );
      controller.abort();
      await expect(pending).rejects.toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
/**
 * genericCoverLoaderParity.test.ts —— `library/GenericCoverLoader.kt`（49 行）。
 *
 * 本轮的真缺口（E176）：这个 loader 的 UA 与「只补缺、不覆盖」的 Cookie/UA 逻辑
 * 此前**一处都没有**（`grep "Mozilla/5.0 (Linux; Android 13)"` 全仓 0 命中），
 * 于是「通用封面」在 iOS/Web 上既没有浏览器身份、也带不上已登录源的 cookie。
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  GENERIC_COVER_CONFIG,
  GENERIC_COVER_USER_AGENT,
  GenericCoverLoader,
  buildGenericCoverHeaders,
  buildGenericCoverLoader,
  currentGenericCoverLoader,
} from '@core/library/genericCoverLoader';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/library/GenericCoverLoader.kt'),
  'utf8',
);

describe('GenericCoverLoader.kt：配置与 UA', () => {
  it('connect 10s / read 15s / 只走 HTTP/1.1 / crossfade(true)', () => {
    expect(KT).toContain('.connectTimeout(10, TimeUnit.SECONDS)');
    expect(KT).toContain('.readTimeout(15, TimeUnit.SECONDS)');
    expect(KT).toContain('.protocols(listOf(Protocol.HTTP_1_1))');
    expect(KT).toContain('.crossfade(true)');
    expect(GENERIC_COVER_CONFIG).toEqual({
      connectTimeoutMs: 10_000,
      readTimeoutMs: 15_000,
      protocols: ['http/1.1'],
      crossfade: true,
    });
  });

  it('UA 是 Android 13 + Chrome/108 那一条，逐字（不是 Z-Library 的 Android 14 + Chrome/120）', () => {
    expect(KT).toContain(
      '"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36"',
    );
    expect(GENERIC_COVER_USER_AGENT).toBe(
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36',
    );
    expect(GENERIC_COVER_USER_AGENT).not.toContain('Android 14');
    expect(GENERIC_COVER_USER_AGENT).not.toContain('Chrome/120');
  });

  it('failover 开关（Kotlin `JsSourceProxy.failoverClient`）保留在描述符上', () => {
    expect(KT).toContain('.okHttpClient(com.example.source.js.JsSourceProxy.failoverClient(context, clientBuilder.build()))');
    const loader = buildGenericCoverLoader({ cookies: { getCookie: () => null } });
    expect(loader.failover).toBe(true);
    expect(loader.crossfade).toBe(true);
  });
});

describe('GenericCoverLoader.kt：只补缺，不覆盖', () => {
  it('没有 Cookie 才补；已有（大小写任意）就不动', () => {
    expect(KT).toContain('if (cookie.isNotBlank() && req.header("Cookie").isNullOrBlank()) {');
    // 无头 → 补
    expect(buildGenericCoverHeaders({ url: 'https://a/1.jpg', cookie: 'sid=1' })).toEqual({
      Cookie: 'sid=1',
      'User-Agent': GENERIC_COVER_USER_AGENT,
    });
    // 已有 Cookie → 不覆盖
    const withCookie = buildGenericCoverHeaders({
      url: 'https://a/1.jpg',
      cookie: 'sid=1',
      existingHeaders: { Cookie: 'other=2' },
    });
    expect(withCookie['Cookie']).toBe('other=2');
    // 小写 cookie 也算「已有」（OkHttp header() 大小写不敏感）
    const lower = buildGenericCoverHeaders({
      url: 'https://a/1.jpg',
      cookie: 'sid=1',
      existingHeaders: { cookie: 'other=2' },
    });
    expect(Object.keys(lower).filter((k) => k.toLowerCase() === 'cookie')).toEqual(['cookie']);
    // cookie 为空/空白 → 不补
    expect(buildGenericCoverHeaders({ url: 'https://a/1.jpg', cookie: '  ' })).not.toHaveProperty('Cookie');
    expect(buildGenericCoverHeaders({ url: 'https://a/1.jpg', cookie: null })).not.toHaveProperty('Cookie');
  });

  it('没有 UA 才补；已有（大小写任意）就保留调用方的', () => {
    expect(KT).toContain('if (req.header("User-Agent").isNullOrBlank()) {');
    const custom = buildGenericCoverHeaders({
      url: 'https://a/1.jpg',
      cookie: null,
      existingHeaders: { 'user-agent': 'CustomUA/1.0' },
    });
    expect(custom['user-agent']).toBe('CustomUA/1.0');
    expect(Object.keys(custom).filter((k) => k.toLowerCase() === 'user-agent')).toHaveLength(1);
  });

  it('其它请求头原样保留（Referer 等）', () => {
    const headers = buildGenericCoverHeaders({
      url: 'https://a/1.jpg',
      cookie: 'sid=1',
      existingHeaders: { Referer: 'https://site/' },
    });
    expect(headers).toEqual({
      Referer: 'https://site/',
      Cookie: 'sid=1',
      'User-Agent': GENERIC_COVER_USER_AGENT,
    });
  });

  it('headersFor(url) 用注入的 jar 取该 URL 的 cookie', () => {
    const seen: string[] = [];
    const loader = buildGenericCoverLoader({
      cookies: {
        getCookie: (url) => {
          seen.push(url);
          return url.includes('a.com') ? 'sid=1' : null;
        },
      },
    });
    expect(loader.headersFor('https://a.com/1.jpg')).toMatchObject({ Cookie: 'sid=1' });
    expect(loader.headersFor('https://b.com/1.jpg')).not.toHaveProperty('Cookie');
    expect(seen).toEqual(['https://a.com/1.jpg', 'https://b.com/1.jpg']);
  });
});

describe('GenericCoverLoader.kt：单例复用', () => {
  beforeEach(() => {
    GenericCoverLoader.reset();
  });

  it('Kotlin L15-22：`cachedLoader ?: synchronized { … }` —— 第二次拿到同一个实例', () => {
    expect(KT).toContain('@Volatile');
    expect(KT).toContain('private var cachedLoader: ImageLoader? = null');
    expect(KT).toContain('return cachedLoader ?: synchronized(this) {');
    expect(currentGenericCoverLoader()).toBeNull();

    const deps = { cookies: { getCookie: () => 'sid=1' } };
    const first = GenericCoverLoader.get(deps);
    const second = GenericCoverLoader.get({ cookies: { getCookie: () => 'other=2' } });
    expect(second).toBe(first);
    // 单例后换依赖不生效（与 Kotlin 一致：靠进程重启换）
    expect(second.headersFor('https://a/1.jpg')['Cookie']).toBe('sid=1');

    GenericCoverLoader.reset();
    expect(currentGenericCoverLoader()).toBeNull();
    const third = GenericCoverLoader.get({ cookies: { getCookie: () => 'other=2' } });
    expect(third).not.toBe(first);
    expect(third.headersFor('https://a/1.jpg')['Cookie']).toBe('other=2');
  });
});

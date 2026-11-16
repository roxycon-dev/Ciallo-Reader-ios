/**
 * Unit tests for the ported Z-Library network / storage / node layer.
 *
 * Kotlin sources covered:
 *   source/zlibrary/ZLibraryCredentialStorage.kt     (64 lines)
 *   source/zlibrary/EncryptedCookieJar.kt            (124 lines)
 *   source/zlibrary/EndpointHealthChecker.kt         (224 lines)
 *   source/zlibrary/ZLibraryEndpointProvider.kt      (273 lines)
 *   source/zlibrary/ZLibraryDomainResolver.kt        (44 lines)
 *   source/zlibrary/RemoteEndpointProvider.kt        (170 lines)
 *   source/zlibrary/RemoteEndpointConfig.kt          (13 lines)
 *   source/zlibrary/ZLibraryEapiClient.kt            (266 lines)
 *   source/zlibrary/network/ZLibraryHttpClient.kt    (171 lines)
 *   source/zlibrary/network/ZLibraryNetworkLogger.kt (19 lines)
 *   source/zlibrary/network/ZLibrarySessionManager.kt(50 lines)
 *   source/zlibrary/network/SystemProxyResolver.kt   (49 lines)
 *   source/zlibrary/network/ZLibraryDns.kt           (332 lines)
 *
 * Every Android/OkHttp collaborator is replaced by a fake here, which is the point of the
 * injected interfaces: the caching, ordering, timeout and error-mapping logic is verified
 * without any network.
 */
import { describe, expect, it, vi } from 'vitest';
import { SourceLog } from '../../src/core/source/sourceLog';
import { EncryptedCookieJar, buildCookie } from '../../src/core/source/zlibrary/encryptedCookieJar';
import {
  EndpointHealthChecker,
  HEALTH_CLIENT_CONFIG,
  HEALTH_DEFAULT_HEADERS,
} from '../../src/core/source/zlibrary/endpointHealthChecker';
import { md5Hex } from '../../src/core/source/zlibrary/md5';
import {
  DEFAULT_ACCEPT,
  DEFAULT_ACCEPT_LANG,
  DEFAULT_USER_AGENT,
  ZLibraryHttpClient,
  ZLibraryHttpClientConfig,
  applyDefaultHeaders,
  formBodyOf,
  formBodyOfPairs,
  isSuccessfulCode,
  type ZLibraryHttpRequestSpec,
  type ZLibraryHttpResponse,
  type ZLibraryHttpTransport,
} from '../../src/core/source/zlibrary/network/zLibraryHttpClient';
import {
  DOH_BOOTSTRAP_HOSTS,
  DOH_PROVIDERS,
  ZLibraryDns,
  parseIpString,
  type ZLibraryDnsResolver,
  type ZLibraryDohTransport,
  type ZLibraryTcpProbe,
} from '../../src/core/source/zlibrary/network/zLibraryDns';
import { ZLibraryNetworkLogger } from '../../src/core/source/zlibrary/network/zLibraryNetworkLogger';
import { ZLibrarySessionManager } from '../../src/core/source/zlibrary/network/zLibrarySessionManager';
import {
  SystemProxyResolver,
  type SystemProxyInfo,
  type SystemProxyProvider,
} from '../../src/core/source/zlibrary/network/systemProxyResolver';
import { RemoteEndpointProvider } from '../../src/core/source/zlibrary/remoteEndpointProvider';
import { ZLibraryDomainResolver } from '../../src/core/source/zlibrary/zLibraryDomainResolver';
import { ZLibraryEndpointProvider, PRESET_DOMAINS } from '../../src/core/source/zlibrary/zLibraryEndpointProvider';
import { ZLibraryEapiClient } from '../../src/core/source/zlibrary/zLibraryEapiClient';
import {
  DEFAULT_DOMAIN,
  ZLibraryCredentialStorage,
  createEncryptedSecretStoreAdapter,
  type ZLibraryCredentialStore,
} from '../../src/core/source/zlibrary/zLibraryCredentialStorage';
import { javaUrlEncode, peekBody, type ZLibraryPrefsStore } from '../../src/core/source/zlibrary/zLibraryHost';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class MemoryCredentialStore implements ZLibraryCredentialStore {
  readonly map = new Map<string, string>();
  constructor(readonly available = true) {}
  async getString(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) this.map.delete(key);
    else this.map.set(key, value);
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

class MemoryPrefsStore implements ZLibraryPrefsStore {
  readonly map = new Map<string, string>();
  async getString(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) this.map.delete(key);
    else this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

interface FakeReply {
  code?: number;
  body?: string;
  headers?: Record<string, string>;
  setCookies?: string[];
  url?: string;
  throws?: Error;
}

function fakeResponse(reply: FakeReply): ZLibraryHttpResponse {
  const headers = reply.headers ?? {};
  return {
    code: reply.code ?? 200,
    url: reply.url ?? 'https://z-lib.by/',
    headers,
    setCookies: reply.setCookies ?? [],
    body: reply.body ?? '',
    isSuccessful: isSuccessfulCode(reply.code ?? 200),
    close: () => {},
  };
}

class FakeTransport implements ZLibraryHttpTransport {
  readonly specs: ZLibraryHttpRequestSpec[] = [];
  constructor(private readonly replies: (spec: ZLibraryHttpRequestSpec) => FakeReply) {}
  async send(spec: ZLibraryHttpRequestSpec): Promise<ZLibraryHttpResponse> {
    this.specs.push(spec);
    const reply = this.replies(spec);
    if (reply.throws !== undefined) throw reply.throws;
    return fakeResponse({ url: spec.url, ...reply });
  }
}

function memoryStorage(
  available = true,
): { store: MemoryCredentialStore; storage: ZLibraryCredentialStorage } {
  const store = new MemoryCredentialStore(available);
  return { store, storage: new ZLibraryCredentialStorage(store) };
}

// ---------------------------------------------------------------------------
// ZLibraryCredentialStorage
// ---------------------------------------------------------------------------

describe('ZLibraryCredentialStorage', () => {
  it('uses 1lib.sk as the default domain and stores the four keys', async () => {
    const { store, storage } = memoryStorage();
    expect(DEFAULT_DOMAIN).toBe('1lib.sk');
    await storage.saveCredentials({ userId: '42', userKey: 'key42', cookies: 'remix_userkey=key42' });
    expect(store.map.get('userId')).toBe('42');
    expect(store.map.get('userKey')).toBe('key42');
    expect(store.map.get('domain')).toBe('1lib.sk');
    expect(store.map.get('cookies')).toBe('remix_userkey=key42');
    expect(await storage.getDomain()).toBe('1lib.sk');
  });

  it('falls back to the default domain for a blank value', async () => {
    const { store, storage } = memoryStorage();
    await storage.saveCredentials({ domain: '   ' });
    expect(store.map.get('domain')).toBe(DEFAULT_DOMAIN);
  });

  it('null values delete their key (Android putString(key, null))', async () => {
    const { store, storage } = memoryStorage();
    await storage.saveCredentials({ userId: '1', userKey: 'k' });
    await storage.saveCredentials({ userId: null, userKey: 'k' });
    expect(store.map.has('userId')).toBe(false);
    expect(await storage.getUserId()).toBeNull();
  });

  it('isLoggedIn() accepts either a remix cookie or a stored user key', async () => {
    const { storage } = memoryStorage();
    expect(await storage.isLoggedIn()).toBe(false);
    await storage.saveCredentials({ cookies: 'remix_userid=1' });
    expect(await storage.isLoggedIn()).toBe(true);
    await storage.saveCredentials({ cookies: null, userKey: 'k' });
    expect(await storage.isLoggedIn()).toBe(true);
    await storage.saveCredentials({ cookies: null, userKey: null });
    expect(await storage.isLoggedIn()).toBe(false);
  });

  it('clear() wipes every key', async () => {
    const { store, storage } = memoryStorage();
    await storage.saveCredentials({ userId: '1', userKey: 'k', cookies: 'c' });
    await storage.clear();
    expect(store.map.size).toBe(0);
  });

  it('throws the Android error text when the secure store is unavailable', async () => {
    const { storage } = memoryStorage(false);
    await expect(storage.saveCredentials({ userId: '1' })).rejects.toThrow(
      '系统安全存储不可用，无法保存登录凭据，请修复系统密钥后重试',
    );
    // reads degrade to null / the default domain instead of throwing
    expect(await storage.getUserId()).toBeNull();
    expect(await storage.getDomain()).toBe(DEFAULT_DOMAIN);
  });

  it('createEncryptedSecretStoreAdapter reports availability from the SecureStore', () => {
    expect(createEncryptedSecretStoreAdapter(null).available).toBe(false);
    expect(
      createEncryptedSecretStoreAdapter({
        get: async () => null,
        set: async () => {},
        remove: async () => {},
      }).available,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EncryptedCookieJar
// ---------------------------------------------------------------------------

describe('EncryptedCookieJar', () => {
  it('loads cookies from storage on construction', async () => {
    const { storage } = memoryStorage();
    await storage.saveCredentials({
      domain: 'z-lib.by',
      cookies: 'remix_userkey=abc; remix_userid=7; dwid=dw1',
    });
    const jar = new EncryptedCookieJar(storage);
    const cookies = await jar.loadForRequest(new URL('https://z-lib.by/s/abc'));
    expect(cookies.map((c) => c.name).sort()).toEqual(['dwid', 'remix_userid', 'remix_userkey']);
  });

  it('matches by the cookie own domain, not by the node the user currently selected', async () => {
    // The Kotlin comment at L67-69: the jar must NOT filter by "the domain the account was
    // saved with" — otherwise a c_token earned on one node is never sent to the next one and
    // the DiamWall retry loops on 503 forever. The cookie's OWN domain still has to match.
    const { storage } = memoryStorage();
    await storage.saveCredentials({ domain: 'new-node.example', cookies: 'c_token=tok' });
    const jar = new EncryptedCookieJar(storage, { nodeDomain: () => 'other.example' });
    expect(
      (await jar.loadForRequest(new URL('https://new-node.example/'))).map((c) => c.name),
    ).toEqual(['c_token']);
    // an unrelated host still gets nothing
    expect(await jar.loadForRequest(new URL('https://unrelated.example/'))).toEqual([]);
  });

  it('injects remix_userkey / remix_userid only for the active node host', async () => {
    const { storage } = memoryStorage();
    await storage.saveCredentials({ domain: '1lib.sk', userKey: 'K', userId: 'U' });
    const jar = new EncryptedCookieJar(storage, {
      nodeDomain: () => '1lib.sk',
    });
    const onNode = await jar.loadForRequest(new URL('https://1lib.sk/'));
    expect(onNode.map((c) => `${c.name}=${c.value}`).sort()).toEqual([
      'remix_userid=U',
      'remix_userkey=K',
    ]);
    const elsewhere = await jar.loadForRequest(new URL('https://unrelated.example/'));
    expect(elsewhere).toEqual([]);
  });

  it('accepts subdomains of the active node (loginMatches endsWith check)', async () => {
    const { storage } = memoryStorage();
    await storage.saveCredentials({ domain: 'z-lib.by', userKey: 'K' });
    const jar = new EncryptedCookieJar(storage, { nodeDomain: () => 'zh.z-lib.by' });
    const cookies = await jar.loadForRequest(new URL('https://zh.z-lib.by/s/x'));
    expect(cookies.map((c) => c.name)).toEqual(['remix_userkey']);
  });

  it('falls back to the stored domain when the node getter throws', async () => {
    const { storage } = memoryStorage();
    await storage.saveCredentials({ domain: 'fallback.example', userKey: 'K' });
    const jar = new EncryptedCookieJar(storage, {
      nodeDomain: () => {
        throw new Error('not restored yet');
      },
    });
    const cookies = await jar.loadForRequest(new URL('https://fallback.example/'));
    expect(cookies.map((c) => c.name)).toEqual(['remix_userkey']);
  });

  it('saveFromResponse persists the merged cookie string and the remix ids', async () => {
    const { store, storage } = memoryStorage();
    await storage.saveCredentials({ domain: 'z-lib.by', cookies: 'keep=1' });
    const jar = new EncryptedCookieJar(storage);
    await jar.saveFromResponse(new URL('https://z-lib.by/'), [
      buildCookie('remix_userid', '99', 'z-lib.by'),
      buildCookie('remix_userkey', 'KK', 'z-lib.by'),
      buildCookie('c_time', '1', 'z-lib.by'),
    ]);
    expect(store.map.get('userId')).toBe('99');
    expect(store.map.get('userKey')).toBe('KK');
    const persisted = store.map.get('cookies') ?? '';
    expect(persisted).toContain('keep=1');
    expect(persisted).toContain('remix_userkey=KK');
    expect(persisted).toContain('c_time=1');
  });

  it('drops cookies whose path does not prefix the request path', async () => {
    const { storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    await jar.saveFromResponse(new URL('https://z-lib.by/'), [
      { name: 'deep', value: 'v', domain: 'z-lib.by', path: '/dl/only', expiresAt: Number.POSITIVE_INFINITY, secure: false },
    ]);
    expect(await jar.loadForRequest(new URL('https://z-lib.by/s/x'))).toEqual([]);
    expect(
      (await jar.loadForRequest(new URL('https://z-lib.by/dl/only'))).map((c) => c.name),
    ).toEqual(['deep']);
  });

  it('syncFromRawCookieString stores the raw string and the remix ids verbatim', async () => {
    const { store, storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    await jar.syncFromRawCookieString('remix_userid=5; remix_userkey=RK; dwid=W', '1lib.sk');
    expect(store.map.get('domain')).toBe('1lib.sk');
    expect(store.map.get('cookies')).toBe('remix_userid=5; remix_userkey=RK; dwid=W');
    expect(store.map.get('userId')).toBe('5');
    expect(store.map.get('userKey')).toBe('RK');
    const cookies = await jar.loadForRequest(new URL('https://1lib.sk/'));
    expect(cookies.map((c) => c.name).sort()).toEqual(['dwid', 'remix_userid', 'remix_userkey']);
  });

  it('buildCookie() reproduces the OkHttp builder defaults (path "/", never expires)', () => {
    const cookie = buildCookie('n', 'v', 'host');
    expect(cookie.path).toBe('/');
    expect(cookie.expiresAt).toBe(Number.POSITIVE_INFINITY);
    expect(cookie.secure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ZLibraryHttpClient + ZLibraryNetworkLogger
// ---------------------------------------------------------------------------

describe('ZLibraryHttpClientConfig / applyDefaultHeaders', () => {
  it('keeps the OkHttp builder values', () => {
    expect(ZLibraryHttpClientConfig.connectTimeoutMs).toBe(8_000);
    expect(ZLibraryHttpClientConfig.readTimeoutMs).toBe(12_000);
    expect(ZLibraryHttpClientConfig.writeTimeoutMs).toBe(12_000);
    // manual redirect handling: OkHttp's auto-follow loops forever on the 307 dance
    expect(ZLibraryHttpClientConfig.followRedirects).toBe(false);
    expect(ZLibraryHttpClientConfig.followSslRedirects).toBe(false);
  });

  it('keeps the three default header literals verbatim', () => {
    expect(DEFAULT_USER_AGENT).toBe(
      'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    );
    expect(DEFAULT_ACCEPT).toBe(
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    );
    expect(DEFAULT_ACCEPT_LANG).toBe('zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
  });

  it('fills in every default header only when the request has none', () => {
    const filled = applyDefaultHeaders();
    expect(filled['User-Agent']).toBe(DEFAULT_USER_AGENT);
    expect(filled['Sec-Ch-Ua']).toBe('"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
    expect(filled['Sec-Ch-Ua-Mobile']).toBe('?1');
    expect(filled['Sec-Ch-Ua-Platform']).toBe('"Android"');
    expect(filled['Sec-Fetch-Dest']).toBe('document');
    expect(filled['Sec-Fetch-Mode']).toBe('navigate');
    expect(filled['Sec-Fetch-Site']).toBe('same-origin');
    expect(filled['Upgrade-Insecure-Requests']).toBe('1');

    const preset = applyDefaultHeaders({ 'User-Agent': 'custom', Accept: 'text/plain' });
    expect(preset['User-Agent']).toBe('custom');
    expect(preset.Accept).toBe('text/plain');
    // case-insensitive override, like OkHttp's Headers
    expect(applyDefaultHeaders({ 'user-agent': 'lower' })['User-Agent']).toBeUndefined();
  });

  it('formBody helpers preserve field order and values', () => {
    expect(formBodyOf({ action: 'login', email: 'a@b.c' })).toEqual([
      { name: 'action', value: 'login' },
      { name: 'email', value: 'a@b.c' },
    ]);
    expect(
      formBodyOfPairs([
        ['action', 'login'],
        ['is_remember', '1'],
      ]),
    ).toEqual([
      { name: 'action', value: 'login' },
      { name: 'is_remember', value: '1' },
    ]);
  });
});

describe('ZLibraryHttpClient', () => {
  it('GET passes the referer, extra headers and callTimeout through to the transport', async () => {
    const { storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    const transport = new FakeTransport(() => ({ code: 200, body: 'ok' }));
    const client = new ZLibraryHttpClient(storage, jar, transport);
    const response = await client.get('https://z-lib.by/s/x', 'https://z-lib.by/', { 'X-Test': '1' }, 4500);
    expect(response.body).toBe('ok');
    const spec = transport.specs[0] as ZLibraryHttpRequestSpec;
    expect(spec.method).toBe('GET');
    expect(spec.referer).toBe('https://z-lib.by/');
    expect(spec.extraHeaders).toEqual({ 'X-Test': '1' });
    expect(spec.callTimeoutMs).toBe(4500);
    expect(spec.formFields).toBeNull();
  });

  it('POST sends the form fields and no callTimeout', async () => {
    const { storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    const transport = new FakeTransport(() => ({ code: 200, body: '{"success":1}' }));
    const client = new ZLibraryHttpClient(storage, jar, transport);
    await client.postForm('https://z-lib.by/rpc.php', formBodyOf({ action: 'login' }), 'https://z-lib.by/');
    const spec = transport.specs[0] as ZLibraryHttpRequestSpec;
    expect(spec.method).toBe('POST');
    expect(spec.formFields).toEqual([{ name: 'action', value: 'login' }]);
    expect(spec.callTimeoutMs).toBeNull();
  });
});

describe('ZLibraryNetworkLogger', () => {
  it('emits one line per request/response/parser result and honours debugEnabled', () => {
    // `ZLibraryNetworkLogger` writes through `SourceLog.log(...)` (the port of
    // `android.util.Log.d`), so spying there captures the message without depending on which
    // sink `SourceLog` itself ends up printing to.
    const spy = vi.spyOn(SourceLog, 'log').mockImplementation(() => {});
    try {
      ZLibraryNetworkLogger.debugEnabled = false;
      ZLibraryNetworkLogger.logRequest('https://z-lib.by/s/x', 'GET', {}, null);
      expect(spy).not.toHaveBeenCalled();

      ZLibraryNetworkLogger.debugEnabled = true;
      ZLibraryNetworkLogger.logRequest('https://z-lib.by/s/x', 'GET', { a: '1', b: '2' }, 'c=1');
      ZLibraryNetworkLogger.logResponse(503, 'not a url', {}, [], null, '');
      ZLibraryNetworkLogger.logParserResult('SUCCESS', 7, 'ignored');
      const lines = spy.mock.calls.map((call) => String(call[1]));
      expect(lines).toHaveLength(3);
      // credentials / query strings are excluded: only host + counts survive
      expect(lines[0]).toContain('GET z-lib.by headers=2 session=true');
      expect(lines[1]).toContain('HTTP 503 unknown');
      expect(lines[2]).toContain('Parser SUCCESS books=7');
    } finally {
      ZLibraryNetworkLogger.debugEnabled = true;
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// ZLibrarySessionManager
// ---------------------------------------------------------------------------

describe('ZLibrarySessionManager', () => {
  const build = async (
    reply: (spec: ZLibraryHttpRequestSpec) => FakeReply,
  ): Promise<{ manager: ZLibrarySessionManager; transport: FakeTransport; storage: ZLibraryCredentialStorage }> => {
    const { storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    const transport = new FakeTransport(reply);
    const client = new ZLibraryHttpClient(storage, jar, transport);
    return { manager: new ZLibrarySessionManager(client, storage), transport, storage };
  };

  it('pre-warms the homepage with a 4500ms budget and marks the session ready', async () => {
    const { manager, transport } = await build(() => ({ code: 200 }));
    expect(await manager.ensureSessionInitialized('1lib.sk')).toBe(true);
    expect(transport.specs[0]?.url).toBe('https://1lib.sk/');
    expect(transport.specs[0]?.callTimeoutMs).toBe(4500);
    expect(manager.isInitialized()).toBe(true);
    expect(manager.getActiveDomain()).toBe('1lib.sk');
  });

  it('treats the DiamWall 517 and the 307 challenge as an initialized session', async () => {
    for (const code of [517, 307]) {
      const { manager } = await build(() => ({ code }));
      expect(await manager.ensureSessionInitialized('1lib.sk')).toBe(true);
    }
  });

  it('reports failure for other HTTP codes and for transport errors', async () => {
    const bad = await build(() => ({ code: 500 }));
    expect(await bad.manager.ensureSessionInitialized('1lib.sk')).toBe(false);
    expect(bad.manager.isInitialized()).toBe(false);
    const boom = await build(() => ({ throws: new Error('socket closed') }));
    expect(await boom.manager.ensureSessionInitialized('1lib.sk')).toBe(false);
  });

  it('skips the second pre-warm unless forceRefresh is set', async () => {
    const { manager, transport } = await build(() => ({ code: 200 }));
    await manager.ensureSessionInitialized('1lib.sk');
    await manager.ensureSessionInitialized('1lib.sk');
    expect(transport.specs).toHaveLength(1);
    await manager.ensureSessionInitialized('1lib.sk', true);
    expect(transport.specs).toHaveLength(2);
    manager.invalidateSession();
    expect(manager.isInitialized()).toBe(false);
  });

  it('defaults the active domain to z-library.sk', () => {
    const { storage } = memoryStorage();
    const jar = new EncryptedCookieJar(storage);
    const manager = new ZLibrarySessionManager(
      new ZLibraryHttpClient(storage, jar, new FakeTransport(() => ({}))),
      storage,
    );
    expect(manager.getActiveDomain()).toBe('z-library.sk');
  });
});

// ---------------------------------------------------------------------------
// SystemProxyResolver
// ---------------------------------------------------------------------------

describe('SystemProxyResolver', () => {
  const provider = (defaultProxy: SystemProxyInfo | null, selected: SystemProxyInfo | null): SystemProxyProvider => ({
    defaultProxy: () => defaultProxy,
    selectDefaultProxy: () => selected,
  });

  it('prefers the Android defaultProxy entry', () => {
    expect(
      SystemProxyResolver.resolve(provider({ host: '127.0.0.1', port: 7890 }, { host: 'other', port: 1 })),
    ).toEqual({ host: '127.0.0.1', port: 7890 });
  });

  it('falls back to the JVM ProxySelector for a blank host or a non-positive port', () => {
    const selected = { host: '10.0.0.1', port: 8080 };
    expect(SystemProxyResolver.resolve(provider({ host: '  ', port: 7890 }, selected))).toEqual(selected);
    expect(SystemProxyResolver.resolve(provider({ host: 'h', port: 0 }, selected))).toEqual(selected);
  });

  it('swallows a throwing defaultProxy and uses the selector', () => {
    const throwing: SystemProxyProvider = {
      defaultProxy: () => {
        throw new Error('no CONNECTIVITY_SERVICE');
      },
      selectDefaultProxy: () => ({ host: '10.0.0.1', port: 8080 }),
    };
    expect(SystemProxyResolver.resolve(throwing)).toEqual({ host: '10.0.0.1', port: 8080 });
  });

  it('returns null when there is no provider at all (no Context)', () => {
    expect(SystemProxyResolver.resolve(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZLibraryDns
// ---------------------------------------------------------------------------

describe('ZLibraryDns', () => {
  const dohAnswer = (ip: string): unknown => ({ Answer: [{ type: 1, data: ip }] });

  const build = (opts: {
    system?: string[];
    systemThrows?: boolean;
    dohByHost?: Record<string, string[]>;
    reachable?: string[];
  }): { dns: ZLibraryDns; resolver: ZLibraryDnsResolver } => {
    const resolver: ZLibraryDnsResolver = {
      systemLookup: async () => {
        if (opts.systemThrows === true) throw new Error('SERVFAIL');
        return opts.system ?? [];
      },
    };
    const doh: ZLibraryDohTransport = {
      queryDoh: async (url) => {
        const host = new URL(url).hostname;
        const ips = opts.dohByHost?.[host] ?? [];
        return dohAnswer(ips[0] ?? '0.0.0.1');
      },
    };
    const probe: ZLibraryTcpProbe = {
      tcpReachable: async (ip) => (opts.reachable ?? []).includes(ip),
    };
    return {
      dns: new ZLibraryDns({ resolver, doh, probe, watcher: null }),
      resolver,
    };
  };

  it('exposes the four DoH providers and the pinned bootstrap hosts', () => {
    expect(DOH_PROVIDERS.map((p) => p.name)).toEqual(['AliDNS', 'DNSPod', 'Cloudflare', 'Google']);
    expect(DOH_PROVIDERS.every((p) => p.accept === 'application/dns-json')).toBe(true);
    expect(DOH_BOOTSTRAP_HOSTS['dns.alidns.com']).toBe('223.5.5.5');
    expect(DOH_BOOTSTRAP_HOSTS['doh.pub']).toBe('1.12.12.12');
  });

  it('aggregates system + DoH answers and puts TCP-reachable IPs first', async () => {
    const { dns } = build({
      system: ['9.9.9.9'],
      dohByHost: {
        'dns.alidns.com': ['1.2.3.4'],
        'doh.pub': ['5.6.7.8'],
        '1.1.1.1': ['1.2.3.4'],
        'dns.google': ['5.6.7.8'],
      },
      reachable: ['5.6.7.8'],
    });
    const resolved = await dns.lookup('z-lib.sk');
    expect(resolved[0]).toBe('5.6.7.8');
    expect(resolved).toContain('9.9.9.9');
    expect(resolved).toContain('1.2.3.4');
  });

  it('filters poisoned (private) answers out of the system hint', async () => {
    const { dns } = build({
      system: ['127.0.0.1', '157.240.1.1'],
      dohByHost: { 'dns.alidns.com': ['8.8.8.8'] },
    });
    const resolved = await dns.lookup('z-lib.sk');
    expect(resolved).not.toContain('127.0.0.1');
    expect(resolved).toContain('8.8.8.8');
  });

  it('serves the second lookup from the positive cache and never re-queries', async () => {
    const resolver = { systemLookup: vi.fn(async () => ['9.9.9.9']) };
    const doh = {
      queryDoh: vi.fn(async () => dohAnswer('1.1.1.1')),
    };
    const probe = { tcpReachable: async () => true };
    const dns = new ZLibraryDns({ resolver, doh, probe, watcher: null });
    await dns.lookup('z-lib.sk');
    const firstCalls = resolver.systemLookup.mock.calls.length;
    await dns.lookup('z-lib.sk');
    expect(resolver.systemLookup.mock.calls.length).toBe(firstCalls);
  });

  it('negative-caches a failure with the exact Android error text', async () => {
    const { dns } = build({ system: [], dohByHost: {} });
    await expect(dns.lookup('dead.example')).rejects.toThrow(
      'Unable to resolve host "dead.example" via System DNS or DoH',
    );
    // the second attempt hits the negative cache
    await expect(dns.lookup('dead.example')).rejects.toThrow(
      'Unable to resolve host "dead.example" (recent failure)',
    );
  });

  it('clearCaches() wipes all three caches', async () => {
    const { dns } = build({ system: ['9.9.9.9'], dohByHost: { 'dns.alidns.com': ['9.9.9.9'] } });
    await dns.lookup('z-lib.sk');
    expect(() => dns.clearCaches()).not.toThrow();
  });

  it('parseIpString keeps only 4-part addresses and truncates like Int.toByte()', () => {
    expect(parseIpString('1.2.3.4')).toBe('1.2.3.4');
    expect(parseIpString(' 8.8.8.8 ')).toBe('8.8.8.8');
    expect(parseIpString('1.2.3')).toBeNull();
    expect(parseIpString('1.2.3.4.5')).toBeNull();
    expect(parseIpString('a.b.c.d')).toBeNull();
    expect(parseIpString('999.0.0.1')).toBe('231.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// EndpointHealthChecker
// ---------------------------------------------------------------------------

describe('EndpointHealthChecker', () => {
  const ZLIB_HOME = '<html><body><z-bookcard></z-bookcard><script src="/js/zlibrary.js"></script></body></html>';
  const SEARCH_OK = '<html><body><z-bookcard href="/book/1"><div slot="title">三体</div></z-bookcard></body></html>';

  const build = (
    replies: (spec: ZLibraryHttpRequestSpec) => FakeReply,
    dnsOk = true,
  ): { checker: EndpointHealthChecker; transport: FakeTransport } => {
    const transport = new FakeTransport(replies);
    const checker = new EndpointHealthChecker(transport, {
      lookup: async () => {
        if (!dnsOk) throw new Error('UnknownHostException');
        return ['1.2.3.4'];
      },
    });
    return { checker, transport };
  };

  it('keeps the Kotlin timeout constants and the health-check header set', () => {
    expect(HEALTH_CLIENT_CONFIG.callTimeoutMs).toBe(12_000);
    expect(HEALTH_CLIENT_CONFIG.connectTimeoutMs).toBe(10_000);
    expect(HEALTH_CLIENT_CONFIG.readTimeoutMs).toBe(10_000);
    // the health checker's Accept differs from ZLibraryHttpClient's on purpose
    expect(HEALTH_DEFAULT_HEADERS['Accept']).toBe(
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    );
  });

  it('reports a DNS failure without issuing any request', async () => {
    const { checker, transport } = build(() => ({}), false);
    const health = await checker.checkHealth('z-lib.sk');
    expect(transport.specs).toHaveLength(0);
    expect(health).toMatchObject({ isAvailable: false, dnsOk: false, tlsOk: false, httpCode: -1, error: 'DNS 解析失败' });
  });

  it('classifies a Cloudflare/DiamWall challenge as blocked-but-alive', async () => {
    const { checker } = build((spec) =>
      spec.url.endsWith('/') ? { code: 503, body: '<html>diamwall</html>' } : { code: 503 },
    );
    const health = await checker.checkHealth('z-lib.sk');
    expect(health).toMatchObject({ isAvailable: false, isCloudflare: true, dnsOk: true, tlsOk: true, httpCode: 503 });
    expect(health.error).toBe('触发 Cloudflare / DiamWall 交互验证（PoW 无法自动解算）');
  });

  it('rejects a parked domain that serves 200 without any zlib structure marker', async () => {
    const { checker } = build((spec) =>
      spec.url.endsWith('/')
        ? { code: 200, body: '<html><body>Z-Library ebook SEO article</body></html>' }
        : { code: 200, body: '' },
    );
    const health = await checker.checkHealth('parked.example');
    expect(health.isAvailable).toBe(false);
    expect(health.isRealZlib).toBe(false);
    expect(health.error).toBe('非 Z-Library 站点（可能是停放域名）');
  });

  it('marks a node available when the homepage, eapi and search probes all pass', async () => {
    const { checker, transport } = build((spec) => {
      if (spec.url.endsWith('/eapi/info')) return { code: 200, body: '{"success":1}' };
      if (spec.url.includes('/s/')) return { code: 200, body: SEARCH_OK, url: spec.url };
      return { code: 200, body: ZLIB_HOME };
    });
    const health = await checker.checkHealth('1lib.sk');
    expect(health).toMatchObject({
      isAvailable: true,
      isRealZlib: true,
      searchAvailable: true,
      isCloudflare: false,
      error: null,
    });
    // the search probe must use %20 and not "+"
    const searchSpec = transport.specs.find((s) => s.url.includes('/s/'));
    expect(searchSpec?.url).toBe('https://1lib.sk/s/%E4%B8%89%E4%BD%93');
  });

  it('reports "搜索服务暂不可用（官网故障）" when the search service is down', async () => {
    const { checker } = build((spec) => {
      if (spec.url.includes('/s/')) {
        return { code: 200, body: 'Search service temporary unavailable!', url: spec.url };
      }
      if (spec.url.endsWith('/eapi/info')) return { code: 200, body: '{"success":1}' };
      return { code: 200, body: ZLIB_HOME };
    });
    const health = await checker.checkHealth('1lib.sk');
    expect(health.isAvailable).toBe(true);
    expect(health.searchAvailable).toBe(false);
    expect(health.error).toBe('搜索服务暂不可用（官网故障）');
  });

  it('detects an entry-redirect domain (final path is not /s/)', async () => {
    const { checker } = build((spec) => {
      if (spec.url.includes('/s/')) {
        // the portal drops the path and lands on the homepage
        return { code: 200, body: ZLIB_HOME, url: 'https://zh.101z.by/' };
      }
      if (spec.url.endsWith('/eapi/info')) return { code: 200, body: '{"success":1}' };
      return { code: 200, body: ZLIB_HOME };
    });
    const health = await checker.checkHealth('zh.101z.by');
    expect(health.searchAvailable).toBe(false);
    expect(health.error).toBe('搜索被重定向到主页（入口跳转域，非真实镜像）');
  });

  it('reports both layers down when eapi and search both fail', async () => {
    const { checker } = build((spec) => {
      if (spec.url.includes('/s/')) return { code: 200, body: '<html>无关键词</html>', url: spec.url };
      if (spec.url.endsWith('/eapi/info')) return { code: 500, body: '' };
      return { code: 200, body: ZLIB_HOME };
    });
    const health = await checker.checkHealth('z-lib.sk');
    expect(health.isAvailable).toBe(true);
    // the `!eapiOk && !searchAvailable` branch wins over the searchDetail text
    expect(health.error).toBe('站点可达，但 API 与搜索均异常');
  });

  it('surfaces the searchDetail text when only the search probe fails', async () => {
    const { checker } = build((spec) => {
      if (spec.url.includes('/s/')) return { code: 200, body: '<html>无关键词</html>', url: spec.url };
      if (spec.url.endsWith('/eapi/info')) return { code: 200, body: '{"success":1}' };
      return { code: 200, body: ZLIB_HOME };
    });
    const health = await checker.checkHealth('z-lib.sk');
    expect(health.isAvailable).toBe(true);
    expect(health.searchAvailable).toBe(false);
    expect(health.error).toBe('搜索结果与关键词无关（疑似主页充数）');
  });

  it('surfaces a TLS failure from the transport', async () => {
    const { checker } = build(() => ({ throws: new Error('SSL handshake failed') }));
    const health = await checker.checkHealth('z-lib.by');
    expect(health).toMatchObject({ isAvailable: false, tlsOk: false, error: 'SSL handshake failed' });
  });
});

// ---------------------------------------------------------------------------
// ZLibraryEndpointProvider + ZLibraryDomainResolver
// ---------------------------------------------------------------------------

describe('ZLibraryEndpointProvider', () => {
  const nodeConfig = (domain: string | (() => string)) => ({
    nodeDomain: () => (typeof domain === 'function' ? domain() : domain),
    setNodeDomain: vi.fn(),
  });

  const build = async (opts: {
    selected?: string | (() => string);
    health?: (domain: string) => { isAvailable: boolean; searchAvailable: boolean; isCloudflare: boolean; error: string | null };
    remote?: string[] | null;
    /** Hosts whose TCP/HTTP stack does not answer at all (a thrown transport error, which is
     *  exactly what `it.code > 0` in the Kotlin quick check is testing for). A 503 would NOT
     *  count as unreachable — challenge codes are deliberately "alive". */
    deadHosts?: string[];
  }): Promise<{
    provider: ZLibraryEndpointProvider;
    prefs: MemoryPrefsStore;
    transport: FakeTransport;
    healthChecker: EndpointHealthChecker;
    config: ReturnType<typeof nodeConfig>;
    credentialStorage: ZLibraryCredentialStorage;
  }> => {
    const prefs = new MemoryPrefsStore();
    const dead = new Set(opts.deadHosts ?? []);
    const transport = new FakeTransport((spec) => {
      if (dead.has(new URL(spec.url).hostname)) throw new Error('connect timeout');
      return { code: 200 };
    });
    const healthChecker = new EndpointHealthChecker(transport, { lookup: async () => ['1.2.3.4'] });
    const spy = opts.health ?? (() => ({ isAvailable: true, searchAvailable: true, isCloudflare: false, error: null }));
    vi.spyOn(healthChecker, 'checkHealth').mockImplementation(async (domain) => {
      const r = spy(domain);
      return {
        domain,
        isAvailable: r.isAvailable,
        rtt: 5,
        isCloudflare: r.isCloudflare,
        dnsOk: true,
        tlsOk: true,
        httpCode: r.isAvailable ? 200 : 503,
        isRealZlib: r.isAvailable,
        searchAvailable: r.searchAvailable,
        error: r.error,
      };
    });
    const remote = new RemoteEndpointProvider(
      { getString: async () => null, putString: async () => {}, remove: async () => {} },
      new FakeTransport(() => ({ code: 200, body: (opts.remote ?? []).join(' ') })),
    );
    const config = nodeConfig(opts.selected ?? '1lib.sk');
    const { storage: credentialStorage } = memoryStorage();
    const provider = new ZLibraryEndpointProvider(
      prefs,
      config,
      { defaultNode: 'z-lib.sk', getScrapedNodes: () => [], getCustomNodes: () => [] },
      healthChecker,
      remote,
      transport,
      credentialStorage,
    );
    return { provider, prefs, transport, healthChecker, config, credentialStorage };
  };

  it('returns the reachable selected node without scanning', async () => {
    const { provider, healthChecker } = await build({});
    expect(await provider.getEndpoint()).toBe('1lib.sk');
    expect(healthChecker.checkHealth).not.toHaveBeenCalled();
  });

  it('strips scheme and trailing slash from the selected node', async () => {
    const { provider } = await build({ selected: 'https://zh.z-lib.by/' });
    expect(await provider.getEndpoint()).toBe('zh.z-lib.by');
  });

  it('fails over to a scanned node when the selected one cannot be reached', async () => {
    const { provider, config } = await build({
      selected: 'dead.example',
      deadHosts: ['dead.example'],
      health: (domain) => ({
        isAvailable: domain === 'z-lib.by',
        searchAvailable: domain === 'z-lib.by',
        isCloudflare: false,
        error: null,
      }),
    });
    expect(await provider.getEndpoint()).toBe('z-lib.by');
    // adoptLiveNode() also follows the failover with the in-memory node choice
    expect(config.setNodeDomain).toHaveBeenCalledWith('z-lib.by');
  });

  it('keeps the selected node when nothing in the pool is reachable', async () => {
    const { provider } = await build({
      selected: 'dead.example',
      deadHosts: ['dead.example'],
      health: () => ({ isAvailable: false, searchAvailable: false, isCloudflare: false, error: 'down' }),
    });
    // failoverFrom() returns null → the selected node itself is returned (WebView may still
    // reach it through the system proxy), NOT the first preset
    expect(await provider.getEndpoint()).toBe('dead.example');
    expect(PRESET_DOMAINS[0]).toBe('1lib.sk');
  });

  it('falls back to the first preset domain on a forced rescan when the whole pool is down', async () => {
    const { provider } = await build({
      selected: '1lib.sk',
      health: () => ({ isAvailable: false, searchAvailable: false, isCloudflare: false, error: 'down' }),
      remote: null,
    });
    // forceRefresh skips every cache branch, the scan finds nothing, so PRESET_DOMAINS[0] wins
    expect(await provider.getEndpoint(true)).toBe('1lib.sk');
  });

  it('reuses a fresh 24h cached node and invalidates it once the quick check fails', async () => {
    const alive = await build({ selected: '' });
    await alive.prefs.putString('cached_domain', 'z-lib.by');
    await alive.prefs.putString('cached_timestamp', String(Date.now()));
    expect(await alive.provider.getEndpoint()).toBe('z-lib.by');
    expect(alive.healthChecker.checkHealth).not.toHaveBeenCalled();

    const dead = await build({
      selected: '',
      deadHosts: ['z-lib.by'],
      health: () => ({ isAvailable: false, searchAvailable: false, isCloudflare: false, error: 'down' }),
    });
    await dead.prefs.putString('cached_domain', 'z-lib.by');
    await dead.prefs.putString('cached_timestamp', String(Date.now()));
    await dead.provider.getEndpoint();
    // a stale cache is never handed back: it is dropped and the pool is rescanned
    expect(await dead.prefs.getString('cached_domain')).toBeNull();
    expect(await dead.prefs.getString('cached_timestamp')).toBeNull();
  });

  it('ignores a cache older than 24 hours', async () => {
    const { provider, prefs } = await build({ selected: '' });
    await prefs.putString('cached_domain', 'z-lib.by');
    await prefs.putString('cached_timestamp', String(Date.now() - 25 * 60 * 60 * 1000));
    // z-lib.app always comes from remote discovery and is the first search-capable candidate
    expect(await provider.getEndpoint()).toBe('z-lib.app');
  });

  it('prefers a search-capable node over a merely reachable one', async () => {
    const { provider } = await build({
      selected: '',
      health: (domain) => ({
        isAvailable: true,
        searchAvailable: domain === 'z-library.sk',
        isCloudflare: false,
        error: null,
      }),
    });
    expect(await provider.getEndpoint()).toBe('z-library.sk');
  });

  it('setCustomEndpoint strips the scheme and rewrites the stored domain', async () => {
    const { provider, prefs, credentialStorage } = await build({});
    await credentialStorage.saveCredentials({ userId: '1', userKey: 'k', cookies: 'c' });
    await provider.setCustomEndpoint('https://z-lib.by/');
    expect(await provider.getCustomEndpoint()).toBe('z-lib.by');
    expect(await credentialStorage.getDomain()).toBe('z-lib.by');
    // a null value clears the custom endpoint without touching the credentials
    await provider.setCustomEndpoint(null);
    expect(await provider.getCustomEndpoint()).toBeNull();
    expect(await credentialStorage.getDomain()).toBe('z-lib.by');
    expect(prefs.map.size).toBe(0);
  });

  it('diagnoseEndpoint() returns the same eight keys', async () => {
    const { provider } = await build({});
    const diag = await provider.diagnoseEndpoint();
    expect(Object.keys(diag).sort()).toEqual(
      ['dnsOk', 'endpoint', 'error', 'httpCode', 'isAvailable', 'isCloudflare', 'rtt', 'tlsOk'].sort(),
    );
    expect(diag['endpoint']).toBe('z-lib.app');
    // Kotlin L263: `"error" to (health.error ?: "None")`
    expect(diag['error']).toBe('None');
    expect(diag['isAvailable']).toBe(true);
  });

  it('diagnoseAllEndpoints() checks the custom node plus every preset, without duplicates', async () => {
    const { provider, healthChecker } = await build({ selected: '1lib.sk' });
    await provider.setCustomEndpoint('1lib.sk');
    const all = await provider.diagnoseAllEndpoints();
    expect(all).toHaveLength(PRESET_DOMAINS.length);
    expect(healthChecker.checkHealth).toHaveBeenCalledTimes(PRESET_DOMAINS.length);
  });
});

describe('ZLibraryDomainResolver', () => {
  it('delegates resolveDomain with the forceScan flag as forceRefresh', async () => {
    const endpointProvider = {
      getEndpoint: vi.fn(async () => '1lib.sk'),
      saveCache: vi.fn(async () => {}),
      invalidateCache: vi.fn(async () => {}),
    };
    const resolver = new ZLibraryDomainResolver(
      endpointProvider as unknown as ZLibraryEndpointProvider,
      { checkHealth: async () => ({}) } as unknown as EndpointHealthChecker,
    );
    expect(await resolver.resolveDomain()).toBe('1lib.sk');
    expect(endpointProvider.getEndpoint).toHaveBeenCalledWith(false);
    await resolver.resolveDomain(true);
    expect(endpointProvider.getEndpoint).toHaveBeenCalledWith(true);
    await resolver.saveToCache('z-lib.by');
    await resolver.invalidateCache();
    expect(endpointProvider.saveCache).toHaveBeenCalledWith('z-lib.by');
    expect(endpointProvider.invalidateCache).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RemoteEndpointProvider
// ---------------------------------------------------------------------------

describe('RemoteEndpointProvider', () => {
  const portalHtml = `
    <a href="https://z-lib.by/s/x">real mirror</a>
    <a href="https://zh.z-library.se/s/y">other mirror</a>
    <a href="https://z-lib.app/">portal hub</a>
    <a href="https://zlib.wwkejishe.top/logo.png">image, not a domain</a>
    <a href="https://cdn.example.com/1lib.js">script, not a domain</a>
    <a href="https://example.com/">unrelated</a>`;

  it('scrapes the six portal sources and ranks real mirrors above hubs', async () => {
    const seen: string[] = [];
    const transport = new FakeTransport((spec) => {
      seen.push(spec.url);
      expect(spec.extraHeaders['Accept']).toBe('text/html');
      return { code: 200, body: portalHtml };
    });
    const prefs = new MemoryPrefsStore();
    const provider = new RemoteEndpointProvider(prefs, transport);
    const configs = await provider.fetchLatestEndpoints();
    expect(configs).not.toBeNull();
    expect(seen).toHaveLength(6);
    const urls = (configs ?? []).map((c) => c.url);
    expect(urls).toContain('z-lib.by');
    expect(urls).toContain('zh.z-library.se');
    // DEPRIORITIZE pushes z-lib.app / pages.dev style hubs to the tail
    expect(urls.indexOf('z-lib.app')).toBeGreaterThan(urls.indexOf('z-lib.by'));
    // .png / .js / unrelated hosts are filtered out
    expect(urls.some((u) => u.endsWith('.png') || u.endsWith('.js'))).toBe(false);
    expect(urls).not.toContain('example.com');
    // priority counts down from the ranked size
    expect((configs ?? [])[0]?.priority).toBe(urls.length);
    expect((configs ?? [])[0]?.version).toBe('portal');
    // the discovery result is cached as JSON
    expect(await prefs.getString('cached_portal_domains')).toContain('z-lib.by');
  });

  it('always contributes z-lib.app, so the "all sources disclosed nothing" branch is unreachable', async () => {
    // Kotlin L97-98 does `found.add("z-lib.app")` BEFORE the L100 `if (found.isEmpty())` check,
    // so a total portal outage still yields the portal itself. Pinned because it decides
    // whether the negative cache is ever consulted.
    const prefs = new MemoryPrefsStore();
    await prefs.putString(
      'cached_portal_domains',
      JSON.stringify([{ url: 'cached.example', priority: 1, updatedAt: 5, version: 'portal' }]),
    );
    const transport = new FakeTransport(() => ({ throws: new Error('blocked') }));
    const provider = new RemoteEndpointProvider(prefs, transport);
    const configs = await provider.fetchLatestEndpoints();
    expect(configs?.map((c) => c.url)).toEqual(['z-lib.app']);
    // the cache is overwritten with the new discovery result
    expect(await prefs.getString('cached_portal_domains')).toContain('z-lib.app');
  });

  it('getCachedEndpoints() reads the cached JSON', async () => {
    const prefs = new MemoryPrefsStore();
    const provider = new RemoteEndpointProvider(prefs, new FakeTransport(() => ({})));
    expect(await provider.getCachedEndpoints()).toBeNull();
    await prefs.putString('cached_portal_domains', '[{"url":"a","priority":1,"updatedAt":2,"version":"portal"}]');
    expect(await provider.getCachedEndpoints()).toEqual([
      { url: 'a', priority: 1, updatedAt: 2, version: 'portal' },
    ]);
  });

  it('parseConfigs tolerates missing fields and malformed JSON', () => {
    const provider = new RemoteEndpointProvider(new MemoryPrefsStore(), new FakeTransport(() => ({})));
    expect(provider.parseConfigs('[{"url":"a"},{"url":"b","priority":2,"updatedAt":3,"version":"portal"},7]')).toEqual([
      { url: 'a', priority: 0, updatedAt: 0, version: '' },
      { url: 'b', priority: 2, updatedAt: 3, version: 'portal' },
    ]);
    expect(provider.parseConfigs('not json')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZLibraryEapiClient
// ---------------------------------------------------------------------------

describe('ZLibraryEapiClient', () => {
  const build = (
    replies: (spec: ZLibraryHttpRequestSpec) => FakeReply,
    loggedIn = true,
  ): { eapi: ZLibraryEapiClient; storage: ZLibraryCredentialStorage; transport: FakeTransport; store: MemoryCredentialStore } => {
    const { store, storage } = memoryStorage();
    const transport = new FakeTransport(replies);
    const jar = new EncryptedCookieJar(storage);
    const client = new ZLibraryHttpClient(storage, jar, transport);
    if (loggedIn) {
      void storage.saveCredentials({ userId: '1', userKey: 'K', cookies: 'remix_userkey=K' });
    }
    return { eapi: new ZLibraryEapiClient(client, storage), storage, transport, store };
  };

  it('login() sends the three-segment MD5 password transform', async () => {
    const { eapi, transport } = build(() => ({
      code: 200,
      body: JSON.stringify({ success: 1, user: { id: 77, remix_userkey: 'RK' } }),
    }));
    expect(await eapi.login('a@b.c', 'secret', '1lib.sk')).toBe(true);
    const spec = transport.specs[0] as ZLibraryHttpRequestSpec;
    expect(spec.url).toBe('https://1lib.sk/eapi/user/login');
    expect(spec.referer).toBe('https://1lib.sk/');
    const fields = Object.fromEntries((spec.formFields ?? []).map((f) => [f.name, f.value]));
    expect(fields['email']).toBe('a@b.c');
    expect(fields['site_mode']).toBe('books');
    expect(fields['action']).toBe('login');
    expect(fields['password']).toBe(md5Hex(`a@b.c:secret:${md5Hex('secret')}`));
  });

  it('login() returns false on a failed attempt and keeps the stored credentials', async () => {
    const { eapi, store } = build(() => ({ code: 200, body: '{"success":0}' }));
    expect(await eapi.login('a@b.c', 'wrong', '1lib.sk')).toBe(false);
    expect(store.map.get('userId')).toBe('1');
  });

  it('getDailyDownloadLimit parses (today, limit) and rejects incomplete data', async () => {
    const ok = build(() => ({ code: 200, body: JSON.stringify({ success: 1, user: { downloads_today: 3, downloads_limit: 10 } }) }));
    expect(await ok.eapi.getDailyDownloadLimit('1lib.sk')).toEqual([3, 10]);
    const noFlag = build(() => ({ code: 200, body: '{"success":1,"user":{}}' }));
    expect(await noFlag.eapi.getDailyDownloadLimit('1lib.sk')).toBeNull();
    const httpError = build(() => ({ code: 503, body: '' }));
    expect(await httpError.eapi.getDailyDownloadLimit('1lib.sk')).toBeNull();
  });

  it('search() requires a login and maps the eapi book objects', async () => {
    const body = JSON.stringify({
      success: 1,
      books: [
        {
          url: '/book/11/aa',
          id: '11',
          hash: 'haa',
          title: '三体',
          author: '刘慈欣',
          cover: 'https://cdn/x.jpg',
          extension: 'EPUB',
          language: 'chinese',
          filesize: 1024,
          dl: '/dl/11/aa',
        },
        { url: '/book/12/bb', id: '', hash: 'h', title: '缺 id' },
        { url: '', id: '13', hash: 'h', title: '缺 url' },
      ],
    });
    const { eapi, transport } = build(() => ({ code: 200, body }));
    const books = await eapi.search('三体', '1lib.sk');
    expect(transport.specs[0]?.url).toBe('https://1lib.sk/eapi/book/search');
    expect(Object.fromEntries((transport.specs[0]?.formFields ?? []).map((f) => [f.name, f.value]))).toEqual({
      message: '三体',
      limit: '30',
    });
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: 'book/11/aa',
      sourceId: 'zlibrary',
      title: '三体',
      author: '刘慈欣',
      cover: 'https://cdn/x.jpg',
      format: 'epub',
      language: 'chinese',
      size: 1024,
      downloadUrl: 'https://1lib.sk/dl/11/aa',
      eapiId: '11',
      eapiHash: 'haa',
    });
  });

  it('search() returns an empty list when not logged in and never calls out', async () => {
    const { eapi, transport } = build(() => ({ code: 200, body: '{"success":1,"books":[]}' }), false);
    expect(await eapi.search('x', '1lib.sk')).toEqual([]);
    expect(transport.specs).toHaveLength(0);
  });

  it('getBookInfo() falls back to /book/{id}/{hash} and strips HTML from the description', async () => {
    const body = JSON.stringify({
      success: 1,
      book: {
        title: '书名',
        author: '作者',
        extension: 'MOBI',
        description: '<p>简介 <b>加粗</b></p>',
        dl: '/dl/11/aa',
      },
    });
    const { eapi, transport } = build(() => ({ code: 200, body }));
    const info = await eapi.getBookInfo('11', 'haa', '1lib.sk');
    expect(transport.specs[0]?.url).toBe('https://1lib.sk/eapi/book/11/haa');
    expect(transport.specs[0]?.referer).toBe('https://1lib.sk/');
    expect(info).toMatchObject({
      id: 'book/11/haa',
      format: 'mobi',
      description: '简介 加粗',
      downloadUrl: 'https://1lib.sk/dl/11/aa',
      eapiId: '11',
      eapiHash: 'haa',
    });
  });

  it('getBookInfo() only prefixes a NON-protocol-relative dl, unlike getDownloadLinkResult()', async () => {
    // Kotlin L181: `dl?.let { if (it.startsWith("http")) it else "https://$domain$it" }`
    // — the `//host` form is NOT special-cased here (only `file` does that at L248-253), so a
    // protocol-relative dl is glued onto the domain. Pinned because it looks like a bug.
    const body = JSON.stringify({ success: 1, book: { title: '书', dl: '//dln1.example/file' } });
    const { eapi } = build(() => ({ code: 200, body }));
    expect((await eapi.getBookInfo('11', 'haa', '1lib.sk'))?.downloadUrl).toBe(
      'https://1lib.sk//dln1.example/file',
    );
  });

  it('getFormats() de-duplicates by extension and keeps the first variant', async () => {
    const body = JSON.stringify({
      success: 1,
      books: [
        { extension: 'EPUB', filesize: 100, filesizeString: '100 B', id: '1', hash: 'a' },
        { extension: 'epub', filesize: 999, id: '2', hash: 'b' },
        { extension: '', id: '3', hash: 'c' },
        { extension: 'MOBI', filesize: 0, filesizeString: '' },
      ],
    });
    const { eapi } = build(() => ({ code: 200, body }));
    const formats = await eapi.getFormats('11', 'haa', '1lib.sk');
    expect(formats).toHaveLength(2);
    expect(formats[0]).toMatchObject({
      format: 'epub',
      size: 100,
      sizeText: '100 B',
      eapiId: '1',
      eapiHash: 'a',
    });
    expect(formats[1]).toMatchObject({ format: 'mobi', size: null, sizeText: null });
  });

  it('getDownloadLinkResult() normalises protocol-relative and bare paths', async () => {
    const rel = build(() => ({ code: 200, body: JSON.stringify({ success: 1, file: { downloadLink: '//dln1.example/f' } }) }));
    expect((await rel.eapi.getDownloadLinkResult('1', 'h', '1lib.sk')).url).toBe('https://dln1.example/f');
    const bare = build(() => ({ code: 200, body: JSON.stringify({ success: 1, file: { downloadLink: '/dl/1/f' } }) }));
    expect((await bare.eapi.getDownloadLinkResult('1', 'h', '1lib.sk')).url).toBe('https://1lib.sk/dl/1/f');
    const absolute = build(() => ({ code: 200, body: JSON.stringify({ success: 1, file: { downloadLink: 'https://cdn/f' } }) }));
    expect((await absolute.eapi.getDownloadLinkResult('1', 'h', '1lib.sk')).url).toBe('https://cdn/f');
  });

  it('getDownloadLinkResult() returns the daily-limit message when the download is blocked', async () => {
    const blocked = build(() => ({
      code: 200,
      body: JSON.stringify({
        success: 1,
        file: { allowDownload: false, disallowDownloadMessage: '<p>今日  <b>下载</b>已达上限</p>' },
      }),
    }));
    const result = await blocked.eapi.getDownloadLinkResult('1', 'h', '1lib.sk');
    expect(result.url).toBeNull();
    expect(result.disallowMessage).toBe('今日 下载已达上限');

    const empty = build(() => ({
      code: 200,
      body: JSON.stringify({ success: 1, file: { allowDownload: false, disallowDownloadMessage: '' } }),
    }));
    expect((await empty.eapi.getDownloadLinkResult('1', 'h', '1lib.sk')).disallowMessage).toBe(
      '今日下载次数已达上限，请等待额度重置或提升下载额度',
    );
  });

  it('returns an empty result for a non-1 success flag or a missing file object', async () => {
    const bad = build(() => ({ code: 200, body: '{"success":0}' }));
    expect(await bad.eapi.getDownloadLinkResult('1', 'h', 'd')).toEqual({ url: null, disallowMessage: null });
    const noFile = build(() => ({ code: 200, body: '{"success":1}' }));
    expect(await noFile.eapi.getDownloadLinkResult('1', 'h', 'd')).toEqual({ url: null, disallowMessage: null });
  });
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

describe('md5Hex (eapi protocol requirement — Web Crypto has no MD5)', () => {
  it('matches the RFC 1321 test vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'd174ab98d277d9f5a5611c2c9f419d9f',
    );
  });

  it('handles multi-byte UTF-8 and inputs longer than one 64-byte block', () => {
    expect(md5Hex('三体')).toBe(md5Hex('三体')); // deterministic
    expect(md5Hex('三体')).toHaveLength(32);
    expect(md5Hex('x'.repeat(1000))).toHaveLength(32);
    expect(md5Hex('x'.repeat(64))).not.toBe(md5Hex('x'.repeat(63)));
  });
});

describe('javaUrlEncode / peekBody', () => {
  it('reproduces java.net.URLEncoder form encoding (space → "+", uppercase hex)', () => {
    expect(javaUrlEncode('三体')).toBe('%E4%B8%89%E4%BD%93');
    expect(javaUrlEncode('a b')).toBe('a+b');
    expect(javaUrlEncode('a+b')).toBe('a%2Bb');
    expect(javaUrlEncode("a!'()~*-._")).toBe('a%21%27%28%29%7E*-._');
  });

  it('the search path replaces "+" with "%20" but the WebView URL does not', () => {
    expect(javaUrlEncode('sci fi').replace(/\+/g, '%20')).toBe('sci%20fi');
    expect(javaUrlEncode('sci fi')).toBe('sci+fi');
  });

  it('peekBody truncates by BYTES, not by UTF-16 code units', () => {
    expect(peekBody('abc', 1024)).toBe('abc');
    expect(peekBody('abcdef', 3)).toBe('abc');
    // 三 is 3 UTF-8 bytes, so a 3-byte cap keeps exactly one character
    expect(peekBody('三体', 3)).toBe('三');
    expect(peekBody('三体', 6)).toBe('三体');
  });
});

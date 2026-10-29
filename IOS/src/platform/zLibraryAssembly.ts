import { ZLibrarySource, type WebViewSearchLike } from '@core/source/zlibrary/zLibrarySource';
import { ZLibraryCredentialStorage, createEncryptedSecretStoreAdapter } from '@core/source/zlibrary/zLibraryCredentialStorage';
import { EncryptedCookieJar } from '@core/source/zlibrary/encryptedCookieJar';
import { ZLibraryHttpClient, applyDefaultHeaders, type ZLibraryHttpTransport, type ZLibraryHttpRequestSpec } from '@core/source/zlibrary/network/zLibraryHttpClient';
import { ZLibrarySessionManager } from '@core/source/zlibrary/network/zLibrarySessionManager';
import { ZLibraryEapiClient } from '@core/source/zlibrary/zLibraryEapiClient';
import { ZLibraryDomainResolver } from '@core/source/zlibrary/zLibraryDomainResolver';
import { ZLibraryEndpointProvider } from '@core/source/zlibrary/zLibraryEndpointProvider';
import { RemoteEndpointProvider } from '@core/source/zlibrary/remoteEndpointProvider';
import { EndpointHealthChecker } from '@core/source/zlibrary/endpointHealthChecker';
import { DiamWallInterceptor } from '@core/source/zlibrary/diamWallInterceptor';
import { JsCookieJar } from '@core/source/js/jsCookieJar';
import { ZLibraryParserManager } from '@core/source/zlibrary/parser/zLibraryParserManager';
import { ZLibraryNodeManager, createNodeManagerPort, createNodeStore, type ZLibraryNodeStore, type ZLibraryNodeProbe } from '@core/library/zLibraryNodeManager';
import { createNodeConfigPort } from '@core/library/zLibraryNodeConfig';
import { zLibraryNovelMetadata } from '@core/library/zLibraryNovelMetadata';
import type { ZLibraryPrefsStore } from '@core/source/zlibrary/zLibraryHost';
import type { SourceManager } from '@core/source/sourceManager';
import type { PlatformBundle } from '@platform/index';
import { checkSourceUrl } from '@core/source/networkCalls';
import { verifySourceWebsite } from './ios-native/websiteVerification';

export interface AppZLibrary {
  source: ZLibrarySource;
  nodes: ZLibraryNodeStore;
  probe: ZLibraryNodeProbe;
  domain(): string;
  http: ZLibraryHttpClient;
}
const services = new WeakMap<SourceManager, AppZLibrary>();
export function getAppZLibrary(manager: SourceManager): AppZLibrary | undefined { return services.get(manager); }

function prefs(platform: PlatformBundle, namespace: string): ZLibraryPrefsStore {
  return { getString: async (key) => platform.keyValue.get(`${namespace}.${key}`),
    putString: async (key, value) => value === null ? platform.keyValue.remove(`${namespace}.${key}`) : platform.keyValue.set(`${namespace}.${key}`, value),
    remove: async (key) => platform.keyValue.remove(`${namespace}.${key}`) };
}

export async function installAppZLibrary(manager: SourceManager, platform: PlatformBundle): Promise<AppZLibrary> {
  const existing = services.get(manager);
  if (existing) return existing;
  const scopedSecure = { get: (key: string) => platform.secure.get(`zlibrary.${key}`),
    set: (key: string, value: string) => platform.secure.set(`zlibrary.${key}`, value),
    remove: (key: string) => platform.secure.remove(`zlibrary.${key}`) };
  const credentials = new ZLibraryCredentialStorage(createEncryptedSecretStoreAdapter(scopedSecure));
  const nodeConfig = createNodeConfigPort();
  const nodeManager = new ZLibraryNodeManager(prefs(platform, 'zlib_node_manager'), nodeConfig);
  await nodeManager.hydrate();
  await nodeManager.restoreSelection();
  const cookieJar = new EncryptedCookieJar(credentials, nodeConfig);
  let cookieWrites = Promise.resolve();
  const raw: ZLibraryHttpTransport = { async send(spec, signal) {
    checkSourceUrl(spec.url);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const headers = applyDefaultHeaders(spec.extraHeaders);
    if (spec.referer !== null) headers.Referer = spec.referer;
    const cookies = await cookieJar.loadForRequest(new URL(spec.url));
    if (cookies.length) headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const body = spec.formFields === null ? undefined : new URLSearchParams(spec.formFields.map(({ name, value }) => [name, value])).toString();
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await platform.http.request({ url: spec.url, method: spec.method, headers,
      redirect: 'manual', timeoutMs: spec.callTimeoutMs ?? 12_000, ...(body === undefined ? {} : { body }) });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const setCookies = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1]?.split(/,(?=\s*[^;,=\s]+\s*=)/) ?? [];
    const parsed = setCookies.flatMap((header) => {
      const cookie = JsCookieJar.parseSetCookie(response.url, header, Date.now());
      return cookie ? [cookie] : [];
    });
    cookieWrites = cookieWrites.catch(() => {}).then(() => cookieJar.saveFromResponse(new URL(response.url), parsed));
    await cookieWrites;
    return { code: response.status, url: response.url, headers: response.headers, setCookies,
      body: new TextDecoder().decode(response.body), isSuccessful: response.status >= 200 && response.status < 300, close() {} };
  } };
  const transport: ZLibraryHttpTransport = { async send(spec, signal) {
    if (spec.method === 'GET') {
      return new DiamWallInterceptor({ cookieJar, defaultHeaders: spec.extraHeaders,
        transport: { send: (next, nextSignal) => raw.send({ ...next, callTimeoutMs: spec.callTimeoutMs ?? next.callTimeoutMs }, nextSignal) },
      }).intercept(spec, signal);
    }
    let response = await raw.send(spec, signal);
    for (let count = 0; count < 8 && response.code >= 300 && response.code < 400; count++) {
      const location = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'location')?.[1];
      if (!location) break;
      const next = new URL(location, response.url).toString();
      const headers = new URL(next).origin === new URL(spec.url).origin ? spec.extraHeaders : {};
      const follow: ZLibraryHttpRequestSpec = { ...spec, url: next, method: response.code === 307 || response.code === 308 ? spec.method : 'GET',
        formFields: response.code === 307 || response.code === 308 ? spec.formFields : null, extraHeaders: headers };
      response.close(); response = await raw.send(follow, signal);
    }
    return response;
  } };
  const http = new ZLibraryHttpClient(credentials, cookieJar, transport);
  const dns = { async lookup(hostname: string): Promise<string[]> {
    const response = await platform.http.request({ url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=A`, timeoutMs: 4000 });
    if (response.status !== 200) throw new Error('DNS 查询失败');
    const data = JSON.parse(new TextDecoder().decode(response.body)) as { Answer?: Array<{ type: number; data: string }> };
    return data.Answer?.filter((record) => record.type === 1).map((record) => record.data) ?? [];
  } };
  const health = new EndpointHealthChecker(transport, dns);
  const domainResolver = new ZLibraryDomainResolver(new ZLibraryEndpointProvider(prefs(platform, 'zlib_domain_cache'), nodeConfig,
    createNodeManagerPort(nodeManager), health, new RemoteEndpointProvider(prefs(platform, 'zlib_remote_config'), transport), transport, credentials), health);
  const webViewSearch = async (node: string, keyword: string): Promise<WebViewSearchLike> => {
    const url = `https://${node}/s/${encodeURIComponent(keyword)}`;
    const result = await verifySourceWebsite(url, navigator.userAgent, true);
    if (!result.verified) return { books: [], cookies: null, pageHasZlibMarkers: false, stillChallenged: true };
    const cookie = result.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
    if (cookie) await cookieJar.syncFromRawCookieString(cookie, node);
    const html = result.html ?? '';
    return { books: ZLibraryParserManager.parseSearchPage(html, new URL(result.url ?? url).origin, 'zlibrary'), cookies: cookie,
      pageHasZlibMarkers: /z-bookcard|book-item|zlibrary\.js|Z-Library/i.test(html), stillChallenged: /Just a moment|Checking your browser/i.test(html) };
  };
  const source = new ZLibrarySource({ credentialStorage: credentials, cookieJar, nodeConfig,
    nodeManager: createNodeManagerPort(nodeManager), httpClient: http, sessionManager: new ZLibrarySessionManager(http, credentials),
    eapiClient: new ZLibraryEapiClient(http, credentials), domainResolver, novelMetadata: zLibraryNovelMetadata,
    webViewSearch, webViewCookies: null });
  const service: AppZLibrary = { source, http, domain: () => nodeConfig.nodeDomain(), nodes: createNodeStore(nodeManager, transport),
    probe: { async search(node, keyword) {
      const response = await http.get(`https://${node}/s/${encodeURIComponent(keyword)}`, `https://${node}/`);
      return { httpStatus: response.code, finalPath: new URL(response.url).pathname, html: response.body,
        books: ZLibraryParserManager.parseSearchPage(response.body, new URL(response.url).origin, 'zlibrary') };
    }, searchViaWebView: webViewSearch } };
  await manager.registerSource(source);
  services.set(manager, service);
  return service;
}

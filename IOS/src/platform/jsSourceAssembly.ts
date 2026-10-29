import { JsComicSource } from '@core/source/js/jsComicSource';
import { JsSourceRepo, mapWithConcurrency, type JsSourceRepoDeps, type PortableJsSource } from '@core/source/js/jsSourceRepo';
import { JsCookieJar } from '@core/source/js/jsCookieJar';
import type { HttpClient as SourceHttp } from '@core/source/js/jsPlatform';
import type { DialogHostPort } from '@core/source/js/jsUiDialogs';
import type { SourceManager } from '@core/source/sourceManager';
import { checkSourceUrl } from '@core/source/networkCalls';
import type { PlatformBundle } from '@platform/index';
import { getPlatformKind } from '@platform/index';
import { EnginePreferences, SourceWorkerEngine, decodeImage } from './sourceWorker/engine';
import { preferencePort, sourceFileStorage } from './sourceWorker/storage';
import { createWorkerDomParser } from './sourceWorker/dom';
import { createWorkerImageBackend } from './sourceWorker/bitmap';
import { verifySourceWebsite } from './ios-native/websiteVerification';
import { showSourceInput } from '@ui/sourceDialogs';

const ASSETS = ['js_safety/acorn.js', 'js_safety/instrument.js', 'venera/_venera_.js',
  'venera/comic_metadata.js', 'venera/discover_bridge.js', ...['bilimanga', 'vomic', 'pufei', 'aimanhua', 'nineteen', 'xipi'].map((key) => `js_extra/${key}.js`)];
const REPOSITORY = 'https://raw.githubusercontent.com/venera-app/venera-configs/main/index.json';

export interface AppJsSources {
  refresh(onStatus?: (status: string) => void): Promise<void>;
  exportPortable(warnings: string[]): Promise<PortableJsSource[]>;
  importPortable(scripts: unknown, replace: boolean): Promise<void>;
  withDefinitionLease<T>(operation: (definitions: JsDefinitionLease) => Promise<T>): Promise<T>;
}
export interface JsDefinitionLease {
  exportPortable(warnings: string[]): Promise<PortableJsSource[]>;
  importPortable(scripts: unknown, replace: boolean): Promise<void>;
}
const services = new WeakMap<SourceManager, AppJsSources>();
export function getAppJsSources(manager: SourceManager): AppJsSources | undefined { return services.get(manager); }

/** Load bundled/cache sources without network; engines start only when a source is used. */
export async function installAppJsSources(manager: SourceManager, platform: PlatformBundle): Promise<AppJsSources> {
  const existing = services.get(manager);
  if (existing) return existing;
  const assets = Object.fromEntries(await Promise.all(ASSETS.map(async (path) => {
    const response = await platform.http.request({ url: `/${path}`, method: 'GET' });
    if (response.status !== 200) throw new Error(`书源资源加载失败：${path}`);
    return [path, new TextDecoder().decode(response.body)] as const;
  })));
  let files = await sourceFileStorage(platform.fs, assets);
  const meta = new EnginePreferences(platform.secure, 'js_source_meta');
  const verification = new EnginePreferences(platform.secure, 'js_source_website_verification');
  await Promise.all([meta.load(), verification.load()]);
  const stores = new Map<string, EnginePreferences>();
  const http: SourceHttp = { async execute(request) {
    checkSourceUrl(request.url);
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await platform.http.request({ url: request.url,
      method: request.method as 'GET' | 'POST', headers: request.headers,
      ...(request.body == null ? {} : { body: request.body }), timeoutMs: request.timeouts?.callMs ?? 30_000,
      maxResponseBytes: 32 * 1024 * 1024, ...(request.signal ? { signal: request.signal } : {}) });
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const setCookie = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1];
    return { status: response.status, finalUrl: response.url, headers: response.headers, body: response.body,
      setCookies: setCookie?.split(/,(?=\s*[^;,=\s]+\s*=)/) ?? [] };
  } };
  const dialogs: DialogHostPort = {
    showInput: ({ title, imageBase64 }) => showSourceInput(title, imageBase64),
    showWebView: () => { throw new Error('站点验证请使用原生验证窗口'); },
    densityOf: () => 1, heightPixelsOf: () => window.innerHeight,
    defaultUserAgent: () => navigator.userAgent,
  };
  let deps: JsSourceRepoDeps = {
    files, http, metaPrefs: preferencePort(meta),
    systemDns: { lookup: async () => [] }, // URLSession performs system DNS and proxy resolution.
    proxy: { http, systemProxy: { resolve: () => null }, monotonicClock: () => performance.now(),
      schedulePoll: (tick, interval) => { const timer = setInterval(tick, interval); return () => clearInterval(timer); },
      log: (level, message) => { if (level === 'w') console.warn('[JsRepo]', message); },
      solveCloudflare: async (url, ua) => (await verifySourceWebsite(url, ua)).verified,
      isChallengeResponse: (status) => status === 403 || status === 503,
      cookieHeader: () => '', isCancelled: () => false, closeResponse() {} },
    createSource(params) {
      let store = stores.get(params.sourceKey);
      if (!store) { store = new EnginePreferences(platform.secure, `js_source_data.${params.sourceKey}`); stores.set(params.sourceKey, store); }
      const sourcePrefs = store;
      const cookies = JsCookieJar.open(preferencePort(sourcePrefs));
      const verify = async (url: string, userAgent: string): Promise<boolean> => {
        checkSourceUrl(url);
        const result = await verifySourceWebsite(url, userAgent);
        for (const cookie of result.cookies) {
          const domain = cookie.domain.replace(/^\./, '');
          cookies.saveSetCookies(`${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`, [
            `${cookie.name}=${cookie.value}; Domain=${domain}; Path=${cookie.path}${cookie.secure ? '; Secure' : ''}${cookie.expires ? `; Expires=${new Date(cookie.expires).toUTCString()}` : ''}`,
          ]);
        }
        await sourcePrefs.flush();
        return result.verified;
      };
      return new JsComicSource({ files, dialogs, verificationPrefs: preferencePort(verification),
        dom: createWorkerDomParser(), elapsedRealtime: () => performance.now(),
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        veneraRuntime: () => assets['venera/_venera_.js']!, verifyWebsite: verify, solveCloudflare: verify,
        cookieHeader: (url) => cookies.cookieHeader(url),
        imageProbe: { async loadBitmap(url, headers) {
          const response = await http.execute({ url, headers, method: 'GET' });
          if (response.status !== 200 || response.body === null) return null;
          const backend = createWorkerImageBackend();
          backend.prepare(response.body, await decodeImage(response.body));
          return backend.decode(response.body);
        } },
        createEngine: (runtimeJs, script, sourceKey, insecureTls) => new SourceWorkerEngine(platform,
          { sourceKey, runtimeJs, script, insecureTls, assets }, sourcePrefs, showSourceInput),
      }, params.sourceKey, params.name, params.version, params.script, params.insecureTls, params.loginRequired);
    },
  };
  const register = async (sources: JsComicSource[]): Promise<void> => {
    const loaded = await mapWithConcurrency(4, sources, async (source) => {
      try { await stores.get(source.sourceKey)?.load(); return source; }
      catch { console.warn('[sources] 单个书源的私有状态无法读取，已保留其他书源', source.sourceKey); return null; }
    });
    for (const source of loaded) if (source) await manager.registerSource(source);
    await Promise.all([files.flush(), meta.flush(), verification.flush()]);
  };
  await register(await JsSourceRepo.loadCached(deps, true));
  let refreshing: Promise<void> | null = null;
  let sourceWrites: Promise<unknown> = Promise.resolve();
  let reloadDefinitions = false;
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const task = sourceWrites.catch(() => {}).then(async () => {
      if (reloadDefinitions) { files = await sourceFileStorage(platform.fs, assets); deps = { ...deps, files }; reloadDefinitions = false; }
      return operation();
    }); sourceWrites = task.catch(() => {}); return task;
  };
  const service: AppJsSources = { refresh(onStatus) {
    if (refreshing) return refreshing;
    refreshing = serial(async () => {
      const sources = await JsSourceRepo.install(deps, REPOSITORY, true, onStatus);
      if (!sources.some((source) => !['bilimanga', 'vomic', 'pufei', 'aimanhua', 'nineteen', 'xipi'].includes(source.sourceKey)))
        throw new Error('源仓库更新失败，已保留现有书源，请检查网络后重试。');
      await register(sources);
    }).finally(() => { refreshing = null; });
    return refreshing;
  },
  exportPortable: (warnings) => serial(async () => { await files.flush(); return JsSourceRepo.exportPortable(deps, warnings); }),
  importPortable: (scripts, replace) => serial(async () => { await JsSourceRepo.importPortable(deps, scripts, replace); await register(await JsSourceRepo.loadCached(deps, true)); }),
  withDefinitionLease: (operation) => serial(async () => {
    await files.flush();
    // An isolated cache prevents rolled-back definitions from surviving in the
    // live repository's synchronous file mirror. Acquire this lease before the
    // SourceManager lease, matching refresh -> register's lock order.
    const scoped = { ...deps, files: await sourceFileStorage(platform.fs, assets) }; let active = true;
    const check = () => { if (!active) throw new Error('书源定义事务已结束'); };
    try { return await operation({ exportPortable: async (warnings) => { check(); return JsSourceRepo.exportPortable(scoped, warnings); }, importPortable: async (scripts, replace) => { check(); await JsSourceRepo.importPortable(scoped, scripts, replace); } }); }
    finally { active = false; reloadDefinitions = true; }
  }),
  };
  services.set(manager, service);
  // Keep cached/bundled sources immediately usable while repairing stale or
  // incomplete repositories. Failure preserves the installed sources for retry.
  if (getPlatformKind() === 'ios-native' && JsSourceRepo.needsRepair(deps, true)) void service.refresh().catch((error: unknown) => console.warn('[sources] 书源后台修复失败，已保留现有书源', error instanceof Error ? error.message : error));
  return service;
}

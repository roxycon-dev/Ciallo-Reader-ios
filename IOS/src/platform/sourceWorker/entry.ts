import { gunzipSync } from 'fflate';
import iconv from 'iconv-lite';
import { Buffer } from 'buffer';
import { JsSourceEngine } from '@core/source/js/jsSourceEngine';
import { JsMessageHandler, installImageBackend } from '@core/source/js/jsMessageHandler';
import { JsHtmlStore } from '@core/source/js/jsHtmlStore';
import { JsCookieJar } from '@core/source/js/jsCookieJar';
import type { KeyValueStorage, HttpResponseSpec } from '@core/source/js/jsPlatform';
import { createWorkerDomParser } from './dom';
import { sourceWorkerCrypto } from './crypto';
import { createWorkerLocalRuntime } from './runtime';
import { createWorkerImageBackend } from './bitmap';
import type { HostRequest, SourceWorkerRequest, SourceWorkerResponse } from './protocol';
import type { WebsiteVerificationResult } from '@platform/ios-native/websiteVerification';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const send = worker.postMessage.bind(worker) as (message: SourceWorkerResponse) => void;
let sequence = 0;
const hostCalls = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
const callHost = (request: HostRequest): Promise<unknown> => new Promise((resolve, reject) => {
  const id = ++sequence;
  hostCalls.set(id, { resolve, reject });
  send({ type: 'host', id, request });
});
let engine: JsSourceEngine | null = null;
let preferences: Record<string, string> = {};
const prefs: KeyValueStorage = {
  getString: (key) => preferences[key] ?? null,
  getBoolean: (key, fallback) => key in preferences ? preferences[key] === 'true' : fallback,
  getInt: (key, fallback) => key in preferences ? Number(preferences[key]) : fallback,
  putString: (key, value) => { preferences[key] = value; persist(); },
  putBoolean: (key, value) => { preferences[key] = String(value); persist(); },
  putInt: (key, value) => { preferences[key] = String(value); persist(); },
  remove: (key) => { delete preferences[key]; persist(); },
  clear: () => { preferences = {}; persist(); },
};
let persistenceQueued = false;
function persist(): void {
  if (persistenceQueued) return;
  persistenceQueued = true;
  queueMicrotask(() => { persistenceQueued = false; send({ type: 'preferences', values: { ...preferences } }); });
}
const images = createWorkerImageBackend();
installImageBackend(images);
let operations = Promise.resolve();

const receive = (event: MessageEvent<SourceWorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'hostResult') {
    const pending = hostCalls.get(message.id);
    hostCalls.delete(message.id);
    if (message.ok) pending?.resolve(message.value);
    else pending?.reject(new Error(message.error ?? '书源宿主调用失败'));
    return;
  }
  if (message.type === 'boot') {
    const boot = message.boot;
    preferences = { ...boot.preferences };
    const cookies = JsCookieJar.open(prefs);
    const handler = new JsMessageHandler({
      dataPrefs: prefs, htmlStore: new JsHtmlStore(createWorkerDomParser()), crypto: sourceWorkerCrypto,
      http: { execute: async ({ signal: _signal, ...request }) =>
        await callHost({ method: 'http', request }) as HttpResponseSpec },
      cookies,
      sourceProxy: { matches: () => false, rememberProxySuccess() {}, forgetRoute() {} },
      solveCloudflare: async (url, userAgent) => {
        const result = JSON.parse(String(await callHost({ method: 'verify', url, userAgent }))) as WebsiteVerificationResult;
        for (const cookie of result.cookies) {
          const domain = cookie.domain.replace(/^\./, '');
          cookies.saveSetCookies(`${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`, [
            `${cookie.name}=${cookie.value}; Domain=${domain}; Path=${cookie.path}${cookie.secure ? '; Secure' : ''}${cookie.expires ? `; Expires=${new Date(cookie.expires).toUTCString()}` : ''}`,
          ]);
        }
        return result.verified;
      }, isChallengeResponse: (status) => status === 403 || status === 503,
      systemProxy: () => null, gunzipIfNeeded: (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes,
      timeouts: { connectMs: 20_000, readMs: 30_000, callMs: 60_000 },
      decodeCharset: (label, bytes) => iconv.decode(Buffer.from(bytes), label),
      encodeCharset: (label, value) => new Uint8Array(iconv.encode(value, label)),
      decodeUtf8: (bytes) => new TextDecoder().decode(bytes), encodeUtf8: (value) => new TextEncoder().encode(value),
      decodeLatin1: (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''),
      elapsedRealtime: () => performance.now(), wallClock: () => Date.now(), maxMemory: () => images.maxMemory,
      startPolling: (interval, tick) => { const timer = setInterval(tick, interval); return () => clearInterval(timer); },
      sleep: (milliseconds) => { const end = performance.now() + Math.min(milliseconds, 45_000); while (performance.now() < end) { /* Worker only */ } },
      showInputDialog: async (title, image) => String(await callHost({ method: 'input', title, image })),
    }, boot.sourceKey, boot.insecureTls);
    engine = new JsSourceEngine(boot.runtimeJs, boot.script, boot.sourceKey, {
      runtime: createWorkerLocalRuntime(), readAsset: (path) => boot.assets[path] ?? '',
      elapsedRealtime: () => performance.now(), handler,
    }, boot.insecureTls);
    send({ type: 'ready' });
    return;
  }
  if (message.type !== 'operation') return;
  operations = operations.then(async () => {
    try {
      if (engine === null) throw new Error('书源引擎尚未初始化');
      const operation = message.operation;
      let value: unknown = null;
      if (operation.method === 'call') value = await engine.call(operation.code);
      else if (operation.method === 'imageBytes') value = await engine.fetchImageBytes(operation.url, operation.headers);
      else if (operation.method === 'transform') {
        images.prepare(operation.bytes, operation.bitmap);
        value = await engine.transformImageBlocking(operation.code, operation.bytes);
      } else engine.setLoggedIn(operation.logged);
      send({ type: 'result', id: message.id, ok: true, value, logged: engine.isLoggedIn() });
    } catch (error) {
      send({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : '书源执行失败', logged: engine?.isLoggedIn() ?? false });
    }
  });
};
worker.addEventListener('message', receive);
// The native channel is held only in module closures. Source code must use the
// validated Network/UI bridges and cannot forge host messages or access app storage.
for (const name of ['postMessage', 'onmessage', 'onmessageerror', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'Worker',
  'SharedWorker', 'importScripts', 'indexedDB', 'caches', 'close']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}

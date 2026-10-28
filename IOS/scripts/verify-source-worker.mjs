import { createServer } from 'vite';
import { chromium, webkit } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const keys = ['bilimanga', 'vomic', 'pufei', 'aimanhua', 'nineteen', 'xipi'];
const paths = ['js_safety/acorn.js', 'js_safety/instrument.js', 'venera/_venera_.js', 'venera/comic_metadata.js', 'venera/discover_bridge.js'];
const assets = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(new URL(`public/${path}`, root), 'utf8')])));
const scripts = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await readFile(new URL(`public/js_extra/${key}.js`, root), 'utf8')])));
const server = await createServer({ root: fileURLToPath(root), server: { port: 0, host: '127.0.0.1' } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const useChrome = Boolean(process.env.SOURCE_WORKER_CHROME);
  browser = await (useChrome ? chromium : webkit).launch(useChrome ? { executablePath: process.env.SOURCE_WORKER_CHROME } : {});
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const results = await page.evaluate(async ({ assets, scripts }) => {
    const { EnginePreferences, SourceWorkerEngine } = await import('/src/platform/sourceWorker/engine.ts');
    const values = new Map();
    const secure = { get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, remove: async (key) => { values.delete(key); } };
    const platform = { secure, http: { request: async (request) => ({ status: 200, url: request.url, headers: {}, body: new TextEncoder().encode('{}') }) } };
    const out = [];
    for (const [sourceKey, script] of Object.entries(scripts)) {
      const prefs = new EnginePreferences(secure, sourceKey);
      const engine = new SourceWorkerEngine(platform, { sourceKey, script, runtimeJs: assets['venera/_venera_.js'], assets, insecureTls: false }, prefs, async () => '验证码');
      try {
        const raw = await engine.call(`({key:src.key,name:src.name,search:typeof src.search?.load,
          html:new HtmlDocument('<div class="x"><a href="/a">漫画 &amp; 小说</a></div>').querySelector('a').text,
          hash:Convert.hexEncode(Convert.md5(Convert.encodeUtf8('abc'))),storage:(src.saveData('acceptance','持久化'),src.loadData('acceptance')),
          isolated:typeof document==='undefined' && typeof postMessage==='undefined' && typeof fetch==='undefined',
          charset:Convert.decodeGbk(Convert.encodeGbk('中文'))})`);
        const network = JSON.parse(await engine.call(`Network.get('https://example.com/worker-test').then(r=>r.status)`));
        if (!network.ok || network.data !== 200) throw new Error(`network: ${JSON.stringify(network)}`);
        const dynamicImport = JSON.parse(await engine.call(`import('https://example.com/forbidden.js')`));
        if (dynamicImport.ok || !dynamicImport.error.includes('外部模块')) throw new Error('dynamic import isolation failed');
        const catalog = JSON.parse(await engine.call(`(() => { ${assets['venera/discover_bridge.js']}; return __cialloDiscover(src, {catalogOnly:true, resolveDynamic:false}); })()`));
        if (!catalog.ok || !Array.isArray(catalog.data?.feeds) || !Array.isArray(catalog.data?.categories)) throw new Error(`discovery: ${JSON.stringify(catalog)}`);
        out.push({ sourceKey, raw, discovery: { feeds: catalog.data.feeds.length, categories: catalog.data.categories.length }, stored: await secure.get(sourceKey) });
      } catch (error) { out.push({ sourceKey, error: String(error) }); }
      engine.reset();
    }
    return out;
  }, { assets, scripts });
  for (const result of results) {
    console.log(JSON.stringify(result));
    assert.equal(result.error, undefined, result.sourceKey);
    const envelope = JSON.parse(result.raw);
    assert.equal(envelope.ok, true, result.raw);
    assert.equal(envelope.data.search, 'function');
    assert.equal(envelope.data.html, '漫画 & 小说');
    assert.equal(envelope.data.hash, '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(envelope.data.storage, '持久化');
    assert.equal(envelope.data.charset, '中文');
    assert.equal(envelope.data.isolated, true);
    assert.match(result.stored, /持久化/);
  }
  console.log(`Original source Worker verification passed: ${results.length}/${keys.length}`);
} finally {
  await browser?.close();
  await server.close();
}

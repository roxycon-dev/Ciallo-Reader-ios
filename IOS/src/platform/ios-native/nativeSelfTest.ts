import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PlatformBundle } from '@platform/index';
import { PrivacyService } from '@core/privacy/privacyService';
import { EnginePreferences, SourceWorkerEngine } from '@platform/sourceWorker/engine';
import { bytesToBase64 } from './capacitorHttpClient';

interface Check { name: string; passed: boolean; detail: string }
interface Diagnostics { testConfiguration(): Promise<{ enabled: boolean }>; reportCapabilities(value: { checks: Check[] }): Promise<void> }
function assert(value: unknown, detail: string): asserts value { if (!value) throw new Error(detail); }
function onePagePdf(): Uint8Array {
  const text = 'BT /F1 18 Tf 20 100 Td (Native PDF acceptance) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Debug simulator only, activated by the native CI process environment, with isolated keys/files. */
export async function runNativeSelfTests(platform: PlatformBundle): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const diagnostics = registerPlugin<Diagnostics>('ReaderDevice');
  if (!(await diagnostics.testConfiguration()).enabled) return;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const checks: Check[] = [], prefix = `ci-selftest-${nonce}`;
  const check = async (name: string, operation: () => Promise<void>, timeoutMs = 20_000): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${timeoutMs / 1000} second timeout`)), timeoutMs); })]); checks.push({ name, passed: true, detail: '' }); }
    catch (error) { checks.push({ name, passed: false, detail: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) }); }
    finally { clearTimeout(timer); await diagnostics.reportCapabilities({ checks }); }
  };
  await check('Keychain and persisted PIN verification', async () => {
    const secure = { get: (key: string) => platform.secure.get(`${prefix}.${key}`), set: (key: string, value: string) => platform.secure.set(`${prefix}.${key}`, value), remove: (key: string) => platform.secure.remove(`${prefix}.${key}`) };
    try {
      const service = new PrivacyService(secure); assert(await service.enable('123456'), 'PIN setup failed');
      const restored = new PrivacyService(secure); assert((await restored.ready()).enabled, 'PIN did not persist');
      assert(!(await restored.verify('654321')), 'Wrong PIN was accepted'); assert(await restored.verify('123456'), 'Correct PIN rejected');
      assert(await restored.change('123456', '654321'), 'PIN change failed'); assert(await restored.disable('654321'), 'PIN disable failed');
    } finally { await secure.remove('privacy.pin.v1'); }
  });
  await check('Binary filesystem append and cleanup', async () => {
    const path = `${prefix}/bytes.bin`;
    try { await platform.fs.writeFile(path, new Uint8Array([0, 1, 127, 128, 255])); assert(platform.fs.appendFile, 'Native append not bound'); await platform.fs.appendFile(path, new Uint8Array([255, 0, 42])); assert(Array.from(await platform.fs.readFile(path)).join(',') === '0,1,127,128,255,255,0,42', 'Binary append changed data'); }
    finally { await platform.fs.delete(path); }
    assert(!(await platform.fs.exists(path)), 'Deleted binary still exists');
  });
  await check('PDFKit renders actual PDF bytes to a readable JPEG', async () => {
    const path = `${prefix}/input.pdf`; let pages: string[] = [];
    try {
      await platform.fs.writeFile(path, onePagePdf());
      const documents = registerPlugin<{ renderPdf(value: { path: string }): Promise<{ pages: string[] }> }>('ReaderDocuments');
      pages = (await documents.renderPdf({ path })).pages; assert(pages.length === 1, 'Expected one PDF page');
      const jpeg = await platform.fs.readFile(pages[0]!); assert(jpeg.length > 100 && jpeg[0] === 255 && jpeg[1] === 216, 'PDF page is not JPEG data');
    } finally { for (const page of pages) await platform.fs.delete(page); await platform.fs.delete(path); }
  });
  await check('Native speech voices, speak, pause, resume and stop settle', async () => {
    const voices = await platform.tts.getVoices(); assert(voices.length > 0 && voices.every((voice) => voice.identifier && voice.language), 'No valid native speech voices');
    const speaking = platform.tts.speak('Ciallo native speech acceptance test.', { lang: 'en-US' });
    try { await new Promise((resolve) => setTimeout(resolve, 300)); await platform.tts.pause(); await platform.tts.resume(); } finally { await platform.tts.stop(); }
    await speaking;
  }, 120_000); // A fresh simulator may need to initialize the system voice database.
  await check('Native storage and screen-awake bridge', async () => {
    const stats = await platform.storageStats.volumeStats(); assert(stats.totalBytes > 0 && stats.freeBytes >= 0, 'Invalid native volume capacity');
    try { await platform.screenAwake.setEnabled(true); } finally { await platform.screenAwake.setEnabled(false); }
    assert((await platform.appInfo.versionName()).length > 0, 'Missing app version');
  });
  await check('Native mutual TLS device-transfer identities and streamed loopback', async () => {
    const transfer = registerPlugin<{ selfTest(): Promise<{ detail: string }> }>('ReaderTransfer');
    const result = await transfer.selfTest(); assert(result.detail.includes('streamed bytes verified'), result.detail);
  }, 40_000);
  await check('Native streamed ZIP imports Android and preserves archive bytes', async () => {
    const fixture = await platform.http.request({ url: '/native-fixtures/transfer-deflated.zip', method: 'GET', timeoutMs: 10_000 });
    assert(fixture.status === 200, 'Missing actual JDK ZIP fixture');
    const archive = registerPlugin<{ selfTest(options: { data: string }): Promise<{ detail: string }> }>('ReaderTransferArchive');
    const result = await archive.selfTest({ data: bytesToBase64(fixture.body) }); assert(result.detail.includes('roundtrip verified'), result.detail);
  }, 40_000);
  await check('Native import journal snapshots and isolated SQLite rollback', async () => {
    const archive = registerPlugin<{ journalSelfTest(): Promise<{ detail: string }> }>('ReaderTransferArchive');
    const result = await archive.journalSelfTest(); assert(result.detail.includes('symlink rejection verified'), result.detail);
    const transaction = platform.db.transaction; assert(transaction, 'Managed SQLite transaction not installed');
    const table = `ci_tx_${nonce}`;
    try {
      await transaction(async (tx) => { await tx.execute(`CREATE TEMP TABLE "${table}" (id INTEGER PRIMARY KEY,value TEXT NOT NULL)`); await tx.execute(`INSERT INTO "${table}" VALUES (1,?)`, ['committed']); });
      let rolledBack = false;
      try { await transaction(async (tx) => { await tx.execute(`INSERT INTO "${table}" VALUES (2,?)`, ['must roll back']); throw new Error('intentional rollback'); }); }
      catch (error) { assert(error instanceof Error && error.message === 'intentional rollback', String(error)); rolledBack = true; }
      const rows = await platform.db.query<{ id: number; value: string }>(`SELECT id,value FROM "${table}" ORDER BY id`);
      assert(rolledBack && rows.length === 1 && rows[0]!.value === 'committed', 'Native SQLite rollback exposed uncommitted data');
    } finally { await platform.db.execute(`DROP TABLE IF EXISTS "${table}"`); }
  }, 40_000);
  const keys = ['bilimanga', 'vomic', 'pufei', 'aimanhua', 'nineteen', 'xipi'];
  const paths = ['js_safety/acorn.js', 'js_safety/instrument.js', 'venera/_venera_.js', 'venera/comic_metadata.js', 'venera/discover_bridge.js', ...keys.map((key) => `js_extra/${key}.js`)];
  const assets = Object.fromEntries(await Promise.all(paths.map(async (path) => { const response = await platform.http.request({ url: `/${path}`, method: 'GET' }); assert(response.status === 200, `Missing asset ${path}`); return [path, new TextDecoder().decode(response.body)]; })));
  for (const key of keys) await check(`Native Worker original source: ${key}`, async () => {
    const prefsKey = `${prefix}.worker.${key}`, prefs = new EnginePreferences(platform.secure, prefsKey);
    const engine = new SourceWorkerEngine(platform, { sourceKey: key, script: assets[`js_extra/${key}.js`]!, runtimeJs: assets['venera/_venera_.js']!, assets, insecureTls: false }, prefs, async () => { throw new Error('Unexpected interactive prompt'); });
    try {
      const raw = await engine.call(`({html:new HtmlDocument('<p>漫画 &amp; 小说</p>').querySelector('p').text, hash:Convert.hexEncode(Convert.md5(Convert.encodeUtf8('abc'))), charset:Convert.decodeGbk(Convert.encodeGbk('中文')), storage:(src.saveData('acceptance','持久化'),src.loadData('acceptance')), isolated:typeof document==='undefined' && typeof postMessage==='undefined' && typeof fetch==='undefined', search:typeof src.search?.load})`);
      const result = JSON.parse(raw ?? '{}') as { ok?: boolean; error?: string; data?: Record<string, unknown> };
      assert(result.ok && result.data, result.error ?? 'Worker failed'); assert(result.data.html === '漫画 & 小说' && result.data.charset === '中文' && result.data.hash === '900150983cd24fb0d6963f7d28e17f72' && result.data.storage === '持久化' && result.data.isolated === true && result.data.search === 'function', `Worker capabilities failed: ${raw}`);
      const stored = await platform.secure.get(prefsKey); assert(stored?.includes('持久化'), 'Worker storage was not committed');
      const catalog = JSON.parse(await engine.call(`(() => { ${assets['venera/discover_bridge.js']}; return __cialloDiscover(src,{catalogOnly:true,resolveDynamic:false}); })()`) ?? '{}') as { ok?: boolean; data?: { feeds?: unknown; categories?: unknown } };
      assert(catalog.ok && Array.isArray(catalog.data?.feeds) && Array.isArray(catalog.data?.categories), 'Native discovery bridge failed');
    } finally { engine.dispose(); await prefs.flush(); await platform.secure.remove(prefsKey); }
  });
  const failed = checks.filter((item) => !item.passed);
  if (failed.length) throw new Error(`Native capabilities: ${failed.map((item) => `${item.name}: ${item.detail}`).join(' / ')}`);
}

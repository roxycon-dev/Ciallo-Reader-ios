import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { JsSourceRepo, type JsSourceRepoDeps, type PortableJsSource } from '@core/source/js/jsSourceRepo';
import { createMemoryKeyValueStorage } from '@core/source/js/jsPlatform';
import { sourceFileStorage } from '@platform/sourceWorker/storage';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';

const script = (label: string) => `class Demo extends ComicSource { name = ${JSON.stringify(label)}; }\n/*${'padding'.repeat(160)}*/`;
async function setup() {
  const fs = new MemoryFileSystem(), files = await sourceFileStorage(fs, {});
  const deps: JsSourceRepoDeps = { files, http: { execute: async () => { throw new Error('Portable definitions must not access the network'); } }, metaPrefs: createMemoryKeyValueStorage(), proxy: {} as never, createSource: (params) => ({ params } as never), systemDns: { lookup: async () => [] } };
  return { fs, files, deps };
}
function source(key = 'portable', body = script('正文脚本')): PortableJsSource { return { key, name: '便携源', fileName: 'sender.js', version: '1', script: body }; }
describe('portable JS source definitions', () => {
  it('exports only definitions and rejects quoted authentication constants without touching account storage', async () => {
    const { fs, files, deps } = await setup();
    await fs.writeFile('account/private.json', new TextEncoder().encode('receiver-cookie-do-not-export'));
    files.writeText('/js_sources/index.json', JSON.stringify([{ key: 'public', name: '公开源', fileName: 'public.js' }, { key: 'private', name: '认证源', fileName: 'private.js' }]));
    files.writeText('/js_sources/public.js', script('公开源'));
    files.writeText('/js_sources/private.js', script('认证源') + '\nconst credentials = {"password": "secret-password"};'); await files.flush();
    const warnings: string[] = [], output = JsSourceRepo.exportPortable(deps, warnings);
    expect(output.map((item) => item.key)).toEqual(['public']); expect(warnings).toHaveLength(1);
    expect(JSON.stringify(output)).not.toMatch(/secret-password|receiver-cookie/);
    expect(new TextDecoder().decode(await fs.readFile('account/private.json'))).toBe('receiver-cookie-do-not-export');
  });
  it.each(['const headers = {"Authorization": "Bearer private"};', "const cookie = 'session=private';"] )('does not accept an ambiguous auth constant in imported code: %s', (auth) => {
    expect(() => JsSourceRepo.validatePortable([source('private', script('private') + auth)])).toThrow('认证常量');
  });
  it('uses Android-compatible SHA-256 local names and preserves existing definitions when merging', async () => {
    const { fs, files, deps } = await setup();
    files.writeText('/js_sources/index.json', JSON.stringify([{ key: 'existing', fileName: 'old.js', name: '原有源', version: '0' }])); files.writeText('/js_sources/old.js', script('旧脚本')); await files.flush();
    const incoming = source('../../跨设备键');
    await JsSourceRepo.importPortable(deps, [incoming, source('existing', script('替换脚本'))], false);
    const name = `transfer_${createHash('sha256').update(incoming.key).digest('hex')}.js`;
    expect(new TextDecoder().decode(await fs.readFile(`js_sources/${name}`))).toBe(incoming.script);
    const definitions = JSON.parse(files.readText('/js_sources/index.json')!) as Array<{ key: string; fileName: string }>;
    expect(definitions.find((item) => item.key === 'existing')?.fileName).toBe('old.js'); expect(definitions.find((item) => item.key === incoming.key)?.fileName).toBe(name);
    await JsSourceRepo.importPortable(deps, [source('existing', script('新脚本'))], true);
    const loaded = await JsSourceRepo.loadCached(deps, true);
    const current = loaded.find((item) => (item as unknown as { params: { sourceKey: string } }).params.sourceKey === 'existing') as unknown as { params: { script: string } };
    expect(current.params.script).toBe(script('新脚本'));
  });
  it('validates the entire input before writing and enforces UTF-8 byte and combined budgets', async () => {
    const { files, deps } = await setup(); files.writeText('/js_sources/index.json', '[]'); await files.flush();
    await expect(JsSourceRepo.importPortable(deps, [source(), { ...source('unsafe'), fileName: '../escape.js' }], true)).rejects.toThrow();
    expect(files.readText('/js_sources/index.json')).toBe('[]'); expect(files.listFiles('/js_sources')).toHaveLength(1);
    expect(() => JsSourceRepo.validatePortable([source('wide', '中'.repeat(200_000))])).toThrow('容量');
    expect(() => JsSourceRepo.validatePortable(Array.from({ length: 14 }, (_, index) => source(`large-${index}`, 'x'.repeat(500_000))))).toThrow('容量');
  });
  it('retains the old index if native script persistence fails, then commits after retry', async () => {
    const { fs, files, deps } = await setup(); files.writeText('/js_sources/index.json', '[]'); await files.flush();
    const write = fs.writeFile.bind(fs); let fail = true;
    fs.writeFile = async (path, bytes) => { if (fail && path.includes('transfer_')) throw new Error('disk full'); await write(path, bytes); };
    await expect(JsSourceRepo.importPortable(deps, [source()], true)).rejects.toThrow('disk full'); expect(new TextDecoder().decode(await fs.readFile('js_sources/index.json'))).toBe('[]');
    fail = false; await JsSourceRepo.importPortable(deps, [source()], true); expect(JSON.parse(new TextDecoder().decode(await fs.readFile('js_sources/index.json')))).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { sourceFileStorage } from '@platform/sourceWorker/storage';

describe('persisted script-cache writes', () => {
  it('leaves the previous index intact on a disk error and permits a real later retry', async () => {
    const fs = new MemoryFileSystem(); await fs.writeFile('js_sources/index.json', new TextEncoder().encode('old-index'));
    const write = fs.writeFile.bind(fs); let fail = true;
    fs.writeFile = async (path, bytes) => { if (fail && path.endsWith('new.js')) throw new Error('disk full'); await write(path, bytes); };
    const cache = await sourceFileStorage(fs, {});
    cache.writeText('js_sources/new.js', 'new-script'); cache.writeText('js_sources/index.json', 'new-index');
    await expect(cache.flush()).rejects.toThrow('disk full'); expect(new TextDecoder().decode(await fs.readFile('js_sources/index.json'))).toBe('old-index');
    fail = false; cache.writeText('js_sources/new.js', 'new-script'); cache.writeText('js_sources/index.json', 'new-index'); await cache.flush();
    expect(new TextDecoder().decode(await fs.readFile('js_sources/index.json'))).toBe('new-index');
  });
  it('captures binary values at write time and never exposes mutable cache storage', async () => {
    const fs = new MemoryFileSystem(), cache = await sourceFileStorage(fs, {}), bytes = new Uint8Array([1, 2, 3]);
    cache.writeBytes('js_sources/bytes.js', bytes); bytes[0] = 99;
    cache.readBytes('js_sources/bytes.js')![1] = 88; await cache.flush();
    expect([...await fs.readFile('js_sources/bytes.js')]).toEqual([1, 2, 3]);
  });
  it('skips a missing/oversized cache entry while retaining other sources', async () => {
    const fs = new MemoryFileSystem(); await fs.writeFile('js_sources/good.js', new TextEncoder().encode('valid')); await fs.writeFile('js_sources/large.js', new Uint8Array(512 * 1024 + 1));
    const list = fs.list.bind(fs); fs.list = async (path) => [...await list(path), 'missing.js'];
    const cache = await sourceFileStorage(fs, {}); expect(cache.readText('js_sources/good.js')).toBe('valid'); expect(cache.exists('js_sources/large.js')).toBe(false);
  });
});

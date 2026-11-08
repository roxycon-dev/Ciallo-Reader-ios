import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceManager } from '@core/source/sourceManager';
import { installAppJsSources, type JsDefinitionLease } from '@platform/jsSourceAssembly';
import { createWebMockPlatform } from '@platform/web-mock';
import { MemoryFileSystem } from '@platform/web-mock/memoryFileSystem';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';

describe('app JS definition lease and repository cache recovery', () => {
  it('serializes public source work, invalidates scoped facades and rereads disk after rollback', async () => {
    const platform = { ...createWebMockPlatform(), fs: new MemoryFileSystem(), secure: new MemorySecureStore() };
    platform.http = { request: async (request) => ({ url: request.url, status: 200, headers: {}, body: new Uint8Array(readFileSync(resolve('public', request.url.slice(1)))) }) };
    await platform.fs.writeFile('js_sources/index.json', new TextEncoder().encode('[{"key":"portable","name":"本机源","fileName":"portable.js","version":"1"}]'));
    await platform.fs.writeFile('js_sources/portable.js', new TextEncoder().encode(`class Demo extends ComicSource { name = '本机源'; }\n/*${'padding'.repeat(160)}*/`));
    const service = await installAppJsSources(new SourceManager(), platform);
    const oldIndex = await platform.fs.readFile('js_sources/index.json');
    let release!: () => void, entered!: () => void, scoped: JsDefinitionLease | undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; }), hold = new Promise<void>((resolve) => { release = resolve; });
    const lease = service.withDefinitionLease(async (definitions) => {
      scoped = definitions; await platform.fs.writeFile('js_sources/index.json', new TextEncoder().encode('[]')); entered(); await hold;
      // Simulate NativeImportJournal restoring the receiver's prior definition directory.
      await platform.fs.writeFile('js_sources/index.json', oldIndex); throw new Error('rolled back');
    }); await started;
    let exported = false; const exportPending = service.exportPortable([]).then((value) => { exported = true; return value; }); await Promise.resolve(); expect(exported).toBe(false);
    release(); await expect(lease).rejects.toThrow('rolled back'); const restored = await exportPending;
    expect(restored.length).toBeGreaterThan(0); await expect(scoped!.exportPortable([])).rejects.toThrow('已结束');
  });
});

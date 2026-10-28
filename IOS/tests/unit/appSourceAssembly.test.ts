import { describe, expect, it, vi } from 'vitest';
import { createAppSourceManager, registerAppBuiltinSources } from '@platform/sourceAssembly';
import type { SourceStorage } from '@core/source/sourceManager';
import type { HttpClient } from '@platform/interfaces';
import { createSourceManagementIo } from '@ui/sourceManagementRuntime';
import { JSON_TEMPLATE } from '@ui/components/help/JsonSourceGuideCard';
import { resolveComicSource } from '@core/comic/comicChapters';

function fixture() {
  const states: Record<string, boolean> = {};
  const configs: Record<string, string> = {};
  let active: string | null = 'mangadex';
  const storage: SourceStorage = {
    getSourceStates: async () => ({ ...states }),
    saveSourceState: async (id, enabled) => {
      states[id] = enabled;
    },
    getActiveSourceId: async () => active,
    saveActiveSourceId: async (id) => {
      active = id;
    },
    getCustomSourceJsons: async () => ({ ...configs }),
    saveCustomSourceJson: async (id, json) => {
      configs[id] = json;
    },
    removeCustomSourceJson: async (id) => {
      delete configs[id];
    },
  };
  const http: HttpClient = {
    request: vi.fn(async (request) => ({
      status: 200,
      url: request.url,
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode(
        '<ul class="list"><li class="item"><a class="book-name" href="/book/1">接力样书</a><span class="author">样例作者</span></li></ul>',
      ),
    })),
  };
  return { storage, http, states, configs };
}

describe('production source wiring', () => {
  it('registers real builtins without network calls and restores the saved active source', async () => {
    const { storage, http } = fixture();
    const manager = createAppSourceManager(storage, http);
    await registerAppBuiltinSources(manager, http);
    expect(manager.allSources.value).toHaveLength(4);
    expect(manager.activeSource.value?.id).toBe('mangadex');
    expect(http.request).not.toHaveBeenCalled();
    expect(await resolveComicSource('mangadex')).not.toBeNull();
  });

  it('source-management enable changes immediately affect library availability and survive restart', async () => {
    const { storage, http } = fixture();
    const manager = createAppSourceManager(storage, http);
    await registerAppBuiltinSources(manager, http);
    const io = createSourceManagementIo(manager, http);
    await io.disableSource('mangadex');
    expect(manager.availableSources.value.some((source) => source.id === 'mangadex')).toBe(false);
    const restored = createAppSourceManager(storage, http);
    await registerAppBuiltinSources(restored, http);
    expect(restored.isSourceEnabled('mangadex')).toBe(false);
  });

  it('imports, persists and restores a searchable custom source using the native HTTP port', async () => {
    const { storage, http } = fixture();
    const manager = createAppSourceManager(storage, http);
    await registerAppBuiltinSources(manager, http);
    const io = createSourceManagementIo(manager, http);
    await io.importSourceFromJsonString(JSON_TEMPLATE);
    expect(await io.importStatus()).toContain('1');
    expect(manager.isCustomSource('example_comic')).toBe(true);
    const restored = createAppSourceManager(storage, http);
    await registerAppBuiltinSources(restored, http);
    const result = await restored.getSource('example_comic')!.search('样书');
    expect(result.kind).toBe('success');
    if (result.kind === 'success') expect(result.data[0]?.title).toBe('接力样书');
    expect(http.request).toHaveBeenCalled();
  });

  it('reports a missing Venera integration instead of claiming it refreshed successfully', async () => {
    const { storage, http } = fixture();
    const manager = createAppSourceManager(storage, http);
    await expect(createSourceManagementIo(manager, http).refreshJsSources()).rejects.toThrow(
      '尚未初始化',
    );
  });
});

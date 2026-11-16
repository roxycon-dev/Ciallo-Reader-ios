import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { bootstrapLibrary, useAppStore } from '@ui/state/appStore';
import { LibraryPage } from '@ui/pages/LibraryPage';
import { updateLibraryPageMemory } from '@ui/pages/librarySearchSessions';
import { App } from '../../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
const mounted: Array<{ host: HTMLDivElement; root: Root }> = [];

beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/')) throw new Error(`测试不联网：${url}`);
    return {
      status: 200,
      ok: true,
      url,
      headers: { forEach: () => undefined },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      dispatchEvent: () => false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
  await bootstrapLibrary();
});

afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
});

describe('standalone library search prefill', () => {
  it('fills the query box from the opened search request', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    act(() => root.render(<App />));
    act(() => {
      useAppStore.setState({ route: 'main', activeTab: 'library', routeHistory: [] });
    });
    let sessionId: string | null = null;
    act(() => {
      sessionId = useAppStore.getState().openLibrarySearch('总裁X总裁', true);
    });
    expect(sessionId).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>('.lib-search__input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('总裁X总裁');
    expect(host.querySelector('[data-route^="librarySearch/"]')).not.toBeNull();
  });

  it('ignores an empty page-memory entry when the route carries a keyword', () => {
    updateLibraryPageMemory('prefill-memory-test', { searchQuery: '' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    act(() =>
      root.render(
        <LibraryPage
          sessionId="prefill-memory-test"
          searchRequest={{ keyword: '三体', textMode: false }}
          standalone
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>('.lib-search__input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('三体');
  });
});

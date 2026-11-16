/**
 * Parity tests for the two source-UI defects fixed in the Settings/Source module review.
 *
 * 1. `src/ui/components/source/sourceCapabilities.ts` — `PRESET_SOURCE_URLS`
 *    Kotlin `com.example.source.importer.SourceImporter.PRESET_SOURCE_URLS` (L38–43).
 *    The UI mirror had drifted to three completely different community URLs and three
 *    invented Chinese labels. It is asserted here against BOTH the Kotlin literals and the
 *    already-correct `@core/source/importer/sourceImporter` list, so the two copies can
 *    never silently diverge again.
 *
 * 2. `src/ui/components/source/ZLibraryNodeManagementScreen.tsx` — the initial node-table
 *    read. Kotlin L70–72 reads `getScrapedNodes()` / `getCustomNodes()` /
 *    `getSelectedNode()` inside the initial `remember`s, so the screen already shows the
 *    persisted node table when it appears. The port had the `useState`s but never called
 *    the store, so it opened empty (bare `当前节点：`). This mounts the screen and asserts
 *    the three reads happen and drive the render.
 */

import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PRESET_SOURCE_URLS } from '../../src/ui/components/source/sourceCapabilities';
import { PRESET_SOURCE_URLS as CORE_PRESET_SOURCE_URLS } from '../../src/core/source/importer/sourceImporter';
import {
  ZLibraryNodeManagementScreen,
  type ZLibraryNodeProbe,
  type ZLibraryNodeStore,
} from '../../src/ui/components/source/ZLibraryNodeManagementScreen';

/* ── Kotlin `SourceImporter.PRESET_SOURCE_URLS` (L38–43), literal ── */

const KOTLIN_PRESET_SOURCE_URLS: ReadonlyArray<readonly [string, string]> = [
  ['https://raw.ixnic.net/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（镜像）'],
  ['https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan', 'XIU2 精品书源（CDN）'],
  ['https://raw.githubusercontent.com/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（GitHub 直连）'],
];

describe('PRESET_SOURCE_URLS (the 网络导入书源 quick-pick list)', () => {
  it('matches the Kotlin SourceImporter literals exactly', () => {
    expect(PRESET_SOURCE_URLS).toEqual(KOTLIN_PRESET_SOURCE_URLS);
  });

  it('stays identical to the @core/source importer copy', () => {
    expect(PRESET_SOURCE_URLS).toEqual(CORE_PRESET_SOURCE_URLS);
  });

  it('uses the /shuyuan path (not sources.json) — that is what the importer converts', () => {
    for (const [url] of PRESET_SOURCE_URLS) {
      expect(url.endsWith('/shuyuan')).toBe(true);
    }
  });
});

/* ── the Z-Library node-management screen's initial node-table read ── */

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return { root, host };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
  });
  m.host.remove();
}

interface StoreCalls {
  scraped: number;
  custom: number;
  selected: number;
}

function createStore(
  scraped: string[],
  custom: string[],
  selected: string,
  calls: StoreCalls,
): ZLibraryNodeStore {
  return {
    DEFAULT_NODE: '1lib.sk',
    VERIFIED_LIVE_NODES: ['z-lib.gd'],
    async getScrapedNodes(): Promise<string[]> {
      calls.scraped += 1;
      return scraped;
    },
    async saveScrapedNodes(): Promise<void> {},
    async getCustomNodes(): Promise<string[]> {
      calls.custom += 1;
      return custom;
    },
    async addCustomNode(): Promise<boolean> {
      return false;
    },
    async removeCustomNode(): Promise<void> {},
    async getSelectedNode(): Promise<string> {
      calls.selected += 1;
      return selected;
    },
    async selectNode(): Promise<void> {},
    async scrapeNodes(): Promise<string[]> {
      return [];
    },
  };
}

const NULL_PROBE: ZLibraryNodeProbe = {
  search: async () => ({ httpStatus: 0, finalPath: '', html: '', books: [] }),
  searchViaWebView: async () => ({ books: [], pageHasZlibMarkers: false, stillChallenged: false }),
};

describe('ZLibraryNodeManagementScreen — the initial node-table read (Kotlin L70–72)', () => {
  it('reads scraped/custom/selected from the store on mount', async () => {
    const calls: StoreCalls = { scraped: 0, custom: 0, selected: 0 };
    const store = createStore(['z-lib.gd'], ['my.mirror'], 'z-lib.gd', calls);
    const m = await mount(
      createElement(ZLibraryNodeManagementScreen, {
        onBack: () => {},
        store,
        probe: NULL_PROBE,
      }),
    );
    expect(calls.scraped).toBe(1);
    expect(calls.custom).toBe(1);
    expect(calls.selected).toBe(1);
    await unmount(m);
  });

  it('shows the persisted 当前节点 and both node groups', async () => {
    const calls: StoreCalls = { scraped: 0, custom: 0, selected: 0 };
    const store = createStore(['z-lib.gd'], ['my.mirror'], 'z-lib.gd', calls);
    const m = await mount(
      createElement(ZLibraryNodeManagementScreen, {
        onBack: () => {},
        store,
        probe: NULL_PROBE,
      }),
    );

    // Kotlin L247: `Text("当前节点：$selectedNode")`
    const info = m.host.querySelector('.zlib-node-card--info .zlib-node-card__name');
    expect(info?.textContent).toBe('当前节点：z-lib.gd');

    const names = [...m.host.querySelectorAll('.zlib-node-card__name')].map(
      (el) => el.textContent,
    );
    // builtinNodes = distinct([DEFAULT_NODE, ...scrapedNodes]) → 1lib.sk + z-lib.gd
    expect(names).toContain('1lib.sk');
    expect(names).toContain('z-lib.gd');
    // customNodeList = customNodes minus builtinNodes → my.mirror
    expect(names).toContain('my.mirror');

    await unmount(m);
  });

  it('marks the selected node 当前使用 and uses the 已验证可用 label', async () => {
    const calls: StoreCalls = { scraped: 0, custom: 0, selected: 0 };
    const store = createStore(['z-lib.gd'], [], 'z-lib.gd', calls);
    const m = await mount(
      createElement(ZLibraryNodeManagementScreen, {
        onBack: () => {},
        store,
        probe: NULL_PROBE,
      }),
    );
    const selected = m.host.querySelector('.zlib-node-card--selected');
    expect(selected?.querySelector('.zlib-node-card__current')?.textContent).toBe('当前使用');
    // Kotlin L296-301: VERIFIED_LIVE_NODES → 已验证可用; DEFAULT_NODE → 默认节点
    const statuses = [...m.host.querySelectorAll('.zlib-node-card__status')].map(
      (el) => el.textContent,
    );
    expect(statuses.some((s) => s?.includes('默认节点 · 未测试'))).toBe(true);
    expect(statuses.some((s) => s?.includes('已验证可用 · 未测试'))).toBe(true);
    await unmount(m);
  });

  it('does not double-read the node table on re-render', async () => {
    const calls: StoreCalls = { scraped: 0, custom: 0, selected: 0 };
    const store = createStore(['z-lib.gd'], [], '1lib.sk', calls);
    const m = await mount(
      createElement(ZLibraryNodeManagementScreen, {
        onBack: () => {},
        store,
        probe: NULL_PROBE,
      }),
    );
    await act(async () => {
      m.root.render(
        createElement(ZLibraryNodeManagementScreen, { onBack: () => {}, store, probe: NULL_PROBE }),
      );
    });
    expect(calls.scraped).toBe(1);
    expect(calls.custom).toBe(1);
    expect(calls.selected).toBe(1);
    await unmount(m);
  });
});
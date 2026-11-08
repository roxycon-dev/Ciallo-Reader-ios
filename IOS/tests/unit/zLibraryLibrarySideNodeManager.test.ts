/**
 * Unit tests for `src/core/library/zLibraryNodeManager.ts`
 * (the port of `com.example.library.ZLibraryNodeManager.kt`).
 *
 * Covers the pure logic the Android file encodes in its tables and helpers:
 *  - `cleanNode` host normalisation (the `substringAfter`/`substringBefore` chain),
 *  - the scraped/custom/selected preference parsing rules (retired filter + `ifEmpty` fallback),
 *  - node-table ranking (`VERIFIED_LIVE_NODES` labels, retired filtering),
 *  - failover ordering (`MIGRATED_NODES`, the scan candidate order),
 *  - the scrape parser (the `#official-urls` table + the whole-page domain-regex fallback),
 *  - the store round-trip (merge-not-replace, custom add/remove, select, restore/migrate).
 */

import { describe, expect, it } from 'vitest';
import {
  cleanNode,
  createNodeManagerPort,
  createNodeStore,
  createZLibraryNodeManager,
  DEFAULT_NODE,
  type ZLibraryNodeStore as ZLibraryNodeStoreShape,
  failoverCandidateOrder,
  filterRetired,
  INITIAL_SCRAPED_NODES,
  isBlank,
  isVerifiedLiveNode,
  KEY_CUSTOM_NODES,
  KEY_SCRAPED_NODES,
  KEY_SELECTED_NODE,
  MIGRATED_NODES,
  mergeScrapedNodes,
  migrateNode,
  nodeLabelFor,
  NODE_PROBE_KEYWORD,
  parseCustomNodes,
  parseScrapedNodes,
  parseSelectedNode,
  PREFS_NAME,
  RETIRED_NODES,
  SCRAPE_ACCEPT,
  SCRAPE_CONFIG,
  SCRAPE_URL,
  scrapeFallbackDomains,
  VERIFIED_LIVE_NODES,
} from '../../src/core/library/zLibraryNodeManager';
import type {
  ZLibraryHttpRequestSpec,
  ZLibraryHttpResponse,
  ZLibraryHttpTransport,
} from '../../src/core/source/zlibrary/network/zLibraryHttpClient';
import type { ZLibraryPrefsStore } from '../../src/core/source/zlibrary/zLibraryHost';
import {
  nodeDomain,
  setNodeDomain,
  ZLibraryNodeConfig,
} from '../../src/core/library/zLibraryNodeConfig';
// Type-only import: asserts (at compile time) that `createNodeStore` still satisfies the interface
// the already-ported UI screen declares. The screen file itself is never modified.
import type { ZLibraryNodeStore } from '../../src/ui/components/source/ZLibraryNodeManagementScreen';

/* ── test doubles ─────────────────────────────────────────────────────── */

function createPrefs(initial: Record<string, string> = {}): {
  map: Map<string, string>;
  writes: Array<[string, string]>;
  store: ZLibraryPrefsStore;
} {
  const map = new Map<string, string>(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  return {
    map,
    writes,
    store: {
      async getString(key: string): Promise<string | null> {
        return map.get(key) ?? null;
      },
      async putString(key: string, value: string | null): Promise<void> {
        if (value === null) {
          map.delete(key);
        } else {
          map.set(key, value);
        }
        writes.push([key, value ?? '']);
      },
      async remove(key: string): Promise<void> {
        map.delete(key);
      },
    },
  };
}

function createTransport(response: {
  code: number;
  body: string;
}): {
  transport: ZLibraryHttpTransport;
  specs: ZLibraryHttpRequestSpec[];
  closeCount: () => number;
} {
  const specs: ZLibraryHttpRequestSpec[] = [];
  let closeCount = 0;
  const transport: ZLibraryHttpTransport = {
    async send(spec: ZLibraryHttpRequestSpec): Promise<ZLibraryHttpResponse> {
      specs.push(spec);
      return {
        code: response.code,
        url: spec.url,
        headers: {},
        setCookies: [],
        body: response.body,
        isSuccessful: response.code >= 200 && response.code <= 299,
        close(): void {
          closeCount += 1;
        },
      };
    },
  };
  return { transport, specs, closeCount: () => closeCount };
}

function createThrowingTransport(): ZLibraryHttpTransport {
  return {
    async send(): Promise<ZLibraryHttpResponse> {
      throw new Error('connect failed');
    },
  };
}

/* ── Kotlin L224-230 cleanNode ─────────────────────────────────────────── */

describe('cleanNode', () => {
  it('keeps a bare host', () => {
    expect(cleanNode('1lib.sk')).toBe('1lib.sk');
  });

  it('strips the scheme, path, query and fragment, and lower-cases', () => {
    expect(cleanNode('https://Z-Lib.By/')).toBe('z-lib.by');
    expect(cleanNode('http://zh.z-lib.by/s/三体?q=1#frag')).toBe('zh.z-lib.by');
    expect(cleanNode('  HTTPS://Example.COM/path  ')).toBe('example.com');
  });

  it('trims around the host', () => {
    expect(cleanNode(' https://1lib.sk/ ')).toBe('1lib.sk');
  });

  it('returns null for blank input and for a scheme with no host', () => {
    expect(cleanNode('')).toBeNull();
    expect(cleanNode('   ')).toBeNull();
    expect(cleanNode('://')).toBeNull();
    expect(cleanNode('https://')).toBeNull();
  });

  it('keeps a non-URL table cell verbatim (Kotlin only strips after :// , / , ? and #)', () => {
    // The Kotlin does NOT validate the host shape or collapse inner spaces, so a text-only
    // navigation-table cell survives as-is. Preserved verbatim on purpose.
    expect(cleanNode('not a url')).toBe('not a url');
    expect(cleanNode('two words?x=1')).toBe('two words');
  });
});

describe('isBlank', () => {
  it('matches Kotlin String.isBlank()', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('  \t\n ')).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });
});

/* ── Kotlin L88-127 preference parsing ─────────────────────────────────── */

describe('parseScrapedNodes', () => {
  it('falls back to INITIAL_SCRAPED_NODES when the key is absent', () => {
    expect(parseScrapedNodes(null)).toEqual([...INITIAL_SCRAPED_NODES]);
  });

  it('splits on newlines, trims, drops blanks and retired domains', () => {
    expect(parseScrapedNodes('  a.example \n\n z-lib.id \n b.example\n')).toEqual([
      'a.example',
      'b.example',
    ]);
  });

  it('falls back to INITIAL_SCRAPED_NODES when everything was filtered away', () => {
    expect(parseScrapedNodes('z-lib.is\nz-library.se')).toEqual([...INITIAL_SCRAPED_NODES]);
  });

  it('keeps the built-in list verbatim even where it overlaps the migration table', () => {
    // `INITIAL_SCRAPED_NODES` legitimately contains `z-library.co`, which is also a
    // `MIGRATED_NODES` key — the migration only fires for the *stored selection*.
    expect(MIGRATED_NODES.has('z-library.co')).toBe(true);
    expect([...INITIAL_SCRAPED_NODES]).toContain('z-library.co');
  });
});

describe('parseCustomNodes / parseSelectedNode', () => {
  it('returns an empty list when the key is absent', () => {
    expect(parseCustomNodes(null)).toEqual([]);
  });

  it('splits on newlines and drops blanks, keeping retired custom entries', () => {
    expect(parseCustomNodes(' my.mirror \n\n z-lib.id\n')).toEqual(['my.mirror', 'z-lib.id']);
  });

  it('falls back to DEFAULT_NODE for a blank/trimmed selection', () => {
    expect(parseSelectedNode(null)).toBe(DEFAULT_NODE);
    expect(parseSelectedNode('   ')).toBe(DEFAULT_NODE);
    expect(parseSelectedNode(' z-lib.by ')).toBe('z-lib.by');
  });
});

/* ── Kotlin L98 merge-not-replace + node ranking ───────────────────────── */

describe('mergeScrapedNodes', () => {
  it('keeps the built-ins first and appends only new cleaned hosts', () => {
    const merged = mergeScrapedNodes(['https://New.Node/', ' 1LIB.SK ', '   ']);
    expect(merged.slice(0, INITIAL_SCRAPED_NODES.length)).toEqual([...INITIAL_SCRAPED_NODES]);
    expect(merged[merged.length - 1]).toBe('new.node');
    // duplicates (case-insensitively, after cleanNode) are dropped
    expect(merged.filter((it) => it === '1lib.sk')).toHaveLength(1);
    expect(merged).toHaveLength(INITIAL_SCRAPED_NODES.length + 1);
  });

  it('does NOT apply the retired filter (Kotlin L98 only cleans and de-duplicates)', () => {
    // The retired filter runs on READ (L91) and after a scrape (L218), not on this merge.
    expect(mergeScrapedNodes(['z-lib.id'])).toContain('z-lib.id');
    // …and the retired entry is dropped again on the next read.
    expect(parseScrapedNodes(mergeScrapedNodes(['z-lib.id']).join('\n'))).not.toContain('z-lib.id');
  });
});

describe('retired node filtering', () => {
  it('drops every retired domain and keeps everything else in order', () => {
    expect(filterRetired(['a.example', 'z-lib.id', 'b.example', 'zlib.ch'])).toEqual([
      'a.example',
      'b.example',
    ]);
  });

  it('retired table matches the Kotlin literal', () => {
    expect([...RETIRED_NODES].sort()).toEqual(
      [
        'tw.101k.by',
        'z-lib.cc',
        'z-lib.id',
        'z-lib.is',
        'z-lib.li',
        'z-library.se',
        'zlib.bz',
        'zlib.ch',
        'zlib.re',
        'zh.101k.by',
        'zh.101z.by',
        'zh.z-lib.rest',
        'zh.z-library.by',
      ].sort(),
    );
  });
});

describe('node ranking / labels', () => {
  it('verified-live table matches the Kotlin literal', () => {
    expect([...VERIFIED_LIVE_NODES]).toEqual([
      '1lib.sk',
      'z-lib.by',
      'z-library.sk',
      'zh.z-lib.by',
      'zh.z-library.sk',
      'en.z-lib.by',
    ]);
  });

  it('ranks the four label buckets in the Kotlin order', () => {
    expect(nodeLabelFor(DEFAULT_NODE)).toBe('默认节点');
    expect(nodeLabelFor('zh.z-lib.by')).toBe('已验证可用');
    expect(nodeLabelFor('z-lib.sk')).toBe('硬挑战·留池');
    expect(nodeLabelFor('z-library.co')).toBe('导航站节点');
  });

  it('a custom default node wins over the verified-live label', () => {
    expect(nodeLabelFor('z-lib.by', 'z-lib.by')).toBe('默认节点');
    expect(isVerifiedLiveNode('z-lib.by')).toBe(true);
    expect(isVerifiedLiveNode('z-library.co')).toBe(false);
  });
});

/* ── Kotlin L149-174 failover migration ───────────────────────────────── */

describe('migrateNode (failover ordering)', () => {
  it('maps every migrated domain to the default node', () => {
    expect(MIGRATED_NODES.size).toBe(18);
    for (const [, target] of MIGRATED_NODES) {
      expect(target).toBe(DEFAULT_NODE);
    }
  });

  it('migrates the old default zh.101k.by that 301-redirected to zlib.bz', () => {
    expect(migrateNode('zh.101k.by')).toBe(DEFAULT_NODE);
    expect(migrateNode('zlib.bz')).toBe(DEFAULT_NODE);
  });

  it('leaves the 2026-09-04 23:30 revivals alone', () => {
    expect(migrateNode('z-lib.sk')).toBeNull();
    expect(migrateNode('z-library.sk')).toBeNull();
    expect(migrateNode('z-lib.by')).toBeNull();
    expect(migrateNode('1lib.sk')).toBeNull();
  });

  it('returns null for a missing selection', () => {
    expect(migrateNode(null)).toBeNull();
  });

  it('orders failover candidates scraped-first, custom-second, first-seen wins', () => {
    expect(failoverCandidateOrder(['a.example', 'b.example'], ['b.example', 'c.example'])).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
  });

  it('drops empty candidates', () => {
    expect(failoverCandidateOrder(['', 'a.example'], [])).toEqual(['a.example']);
  });
});

/* ── Kotlin L206-216 scrape fallback ──────────────────────────────────── */

const FALLBACK_HTML = [
  '<html><body>',
  '<a href="https://1lib.sk/">official</a>',
  '<a href="http://Z-Lib.By/s/三体">mirror</a>',
  '<a href="https://z-library.sk/">revived</a>',
  '<a href="https://zh.z-lib.by/">chinese</a>',
  '<a href="https://z-lib.is/">retired</a>',
  '<a href="https://zlib.ch/">retired2</a>',
  '<img src="https://covers.zlibrary.net/logo.png">',
  '<script src="https://cdn.zlib.re/bundle.js"></script>',
  '</body></html>',
].join('');

describe('scrapeFallbackDomains', () => {
  it('sweeps zlib-family hosts, lower-cases and de-duplicates them', () => {
    const found = scrapeFallbackDomains(FALLBACK_HTML);
    expect(found).toContain('1lib.sk');
    expect(found).toContain('z-lib.by');
    expect(found).toContain('z-library.sk');
    expect(found).toContain('zh.z-lib.by');
  });

  it('drops non-dotted matches, .png/.js assets and retired hosts', () => {
    const found = scrapeFallbackDomains(FALLBACK_HTML);
    expect(found.some((it) => !it.includes('.'))).toBe(false);
    expect(found.some((it) => it.endsWith('.png') || it.endsWith('.js'))).toBe(false);
    expect(found).not.toContain('z-lib.is');
    expect(found).not.toContain('zlib.ch');
  });

  it('de-duplicates repeated hosts', () => {
    const found = scrapeFallbackDomains('<p>https://1lib.sk/ https://1lib.sk/x</p>');
    expect(found.filter((it) => it === '1lib.sk')).toHaveLength(1);
  });
});

/* ── Kotlin L176-222 scrapeNodes ──────────────────────────────────────── */

const OFFICIAL_HTML = [
  '<html><body>',
  '<div id="official-urls">',
  '<table>',
  '<tr><td><a href="https://1lib.sk/">1lib.sk</a></td></tr>',
  '<tr><td><a href="https://z-lib.by/">z-lib.by</a></td></tr>',
  '<tr><td><a href="https://Z-Library.SK/">zh</a></td></tr>',
  '<tr><td><a href="https://z-lib.id/">retired</a></td></tr>',
  '<tr><td><a href="   ">junk</a></td></tr>',
  '</table>',
  '</div>',
  '<div id="other"><table><tr><td><a href="https://not-official.example/">x</a></td></tr></table></div>',
  '</body></html>',
].join('');

describe('scrapeNodes', () => {
  it('parses the #official-urls table, cleans the hrefs and filters retired domains', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const { transport, specs, closeCount } = createTransport({ code: 200, body: OFFICIAL_HTML });
    const nodes = await manager.scrapeNodes(transport);
    expect(nodes).toEqual(['1lib.sk', 'z-lib.by', 'z-library.sk']);
    expect(closeCount()).toBe(1);
    expect(specs[0]?.url).toBe(SCRAPE_URL);
    expect(specs[0]?.extraHeaders['Accept']).toBe(SCRAPE_ACCEPT);
    expect(specs[0]?.callTimeoutMs).toBe(SCRAPE_CONFIG.connectTimeoutMs);
  });

  it('only reads the #official-urls table, not other tables on the page', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const { transport } = createTransport({ code: 200, body: OFFICIAL_HTML });
    expect(await manager.scrapeNodes(transport)).not.toContain('not-official.example');
  });

  it('falls back to the whole-page regex when the table selector matches nothing', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const { transport } = createTransport({
      code: 200,
      body: '<html><body><a href="https://z-lib.by/">mirror</a></body></html>',
    });
    expect(await manager.scrapeNodes(transport)).toEqual(['z-lib.by']);
  });

  it('returns an empty list for a non-2xx response', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const { transport } = createTransport({ code: 500, body: OFFICIAL_HTML });
    expect(await manager.scrapeNodes(transport)).toEqual([]);
  });

  it('returns an empty list for a blank body', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const { transport } = createTransport({ code: 200, body: '   ' });
    expect(await manager.scrapeNodes(transport)).toEqual([]);
  });

  it('returns an empty list when the transport throws (Kotlin catch → emptyList)', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    expect(await manager.scrapeNodes(createThrowingTransport())).toEqual([]);
  });
});

/* ── the store round-trip ─────────────────────────────────────────────── */

describe('ZLibraryNodeManager persistence', () => {
  it('uses the Kotlin preference keys and file name', () => {
    expect(PREFS_NAME).toBe('zlib_node_manager');
    expect(KEY_SCRAPED_NODES).toBe('scraped_nodes');
    expect(KEY_CUSTOM_NODES).toBe('custom_nodes');
    expect(KEY_SELECTED_NODE).toBe('selected_node');
  });

  it('saveScrapedNodes merges into the built-ins instead of replacing them', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.saveScrapedNodes(['https://fresh.example/']);
    const stored = prefs.map.get(KEY_SCRAPED_NODES) ?? '';
    expect(stored.split('\n').slice(0, INITIAL_SCRAPED_NODES.length)).toEqual([
      ...INITIAL_SCRAPED_NODES,
    ]);
    expect(stored.endsWith('fresh.example')).toBe(true);
    expect(await manager.getScrapedNodes()).toHaveLength(INITIAL_SCRAPED_NODES.length + 1);
  });

  it('addCustomNode rejects junk and de-duplicates, lower-casing the host', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    expect(await manager.addCustomNode('   ')).toBe(false);
    expect(await manager.addCustomNode('https://My.Mirror/')).toBe(true);
    expect(await manager.addCustomNode('my.mirror')).toBe(true);
    expect(await manager.getCustomNodes()).toEqual(['my.mirror']);
  });

  it('removeCustomNode deletes the row and falls back to the default selection', async () => {
    setNodeDomain('');
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.addCustomNode('my.mirror');
    await manager.selectNode('my.mirror');
    expect(nodeDomain()).toBe('my.mirror');
    await manager.removeCustomNode('my.mirror');
    expect(await manager.getCustomNodes()).toEqual([]);
    expect(await manager.getSelectedNode()).toBe(DEFAULT_NODE);
    expect(nodeDomain()).toBe(DEFAULT_NODE);
    setNodeDomain('');
  });

  it('selectNode ignores junk and publishes the clean host to ZLibraryNodeConfig', async () => {
    setNodeDomain('');
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.selectNode('  ');
    expect(nodeDomain()).toBe('');
    await manager.selectNode('https://Z-Lib.By/');
    expect(nodeDomain()).toBe('z-lib.by');
    expect(ZLibraryNodeConfig.domain).toBe('z-lib.by');
    setNodeDomain('');
  });

  it('restoreSelection migrates a dead stored node in place', async () => {
    setNodeDomain('');
    const prefs = createPrefs({ [KEY_SELECTED_NODE]: 'zh.101k.by' });
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.hydrate();
    await manager.restoreSelection();
    expect(prefs.map.get(KEY_SELECTED_NODE)).toBe(DEFAULT_NODE);
    expect(nodeDomain()).toBe(DEFAULT_NODE);
    setNodeDomain('');
  });

  it('restoreSelection keeps a live stored node untouched', async () => {
    setNodeDomain('');
    const prefs = createPrefs({ [KEY_SELECTED_NODE]: ' z-lib.by ' });
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.hydrate();
    await manager.restoreSelection();
    expect(nodeDomain()).toBe('z-lib.by');
    setNodeDomain('');
  });

  it('restoreSelection with no stored value lands on the default node', async () => {
    setNodeDomain('');
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    await manager.hydrate();
    await manager.restoreSelection();
    expect(nodeDomain()).toBe(DEFAULT_NODE);
    setNodeDomain('');
  });

  it('hydrate() makes the synchronous ZLibraryNodeManagerPort usable', async () => {
    const prefs = createPrefs({
      [KEY_SCRAPED_NODES]: 'a.example\nz-lib.id',
      [KEY_CUSTOM_NODES]: 'my.mirror',
    });
    const manager = createZLibraryNodeManager(prefs.store);
    const port = createNodeManagerPort(manager);
    expect(port.defaultNode).toBe(DEFAULT_NODE);
    // before hydration the mirror is empty → the Kotlin "no stored value" branch
    expect(port.getScrapedNodes()).toEqual([...INITIAL_SCRAPED_NODES]);
    await manager.hydrate();
    expect(manager.isHydrated).toBe(true);
    expect(port.getScrapedNodes()).toEqual(['a.example']);
    expect(port.getCustomNodes()).toEqual(['my.mirror']);
  });

  it('a write through the async API is visible to the sync port immediately', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const port = createNodeManagerPort(manager);
    await manager.saveScrapedNodes(['a.example']);
    expect(port.getScrapedNodes()[INITIAL_SCRAPED_NODES.length]).toBe('a.example');
  });

  it('satisfies the already-ported screen\'s ZLibraryNodeStore interface', async () => {
    const prefs = createPrefs();
    const manager = createZLibraryNodeManager(prefs.store);
    const store: ZLibraryNodeStore = createNodeStore(manager, createThrowingTransport());
    // the same object must also satisfy the screen's own declaration
    const asScreenStore: ZLibraryNodeStoreShape = store;
    expect(store.DEFAULT_NODE).toBe('1lib.sk');
    expect([...store.VERIFIED_LIVE_NODES]).toEqual([...VERIFIED_LIVE_NODES]);
    expect(await store.scrapeNodes()).toEqual([]);
    expect(await store.getCustomNodes()).toEqual([]);
    expect(await asScreenStore.getSelectedNode()).toBe(DEFAULT_NODE);
    expect(await store.addCustomNode('my.mirror')).toBe(true);
    expect(await store.getCustomNodes()).toEqual(['my.mirror']);
    await store.selectNode('my.mirror');
    expect(await store.getSelectedNode()).toBe('my.mirror');
    await store.removeCustomNode('my.mirror');
    expect(await store.getCustomNodes()).toEqual([]);
    await store.saveScrapedNodes(['a.example']);
    expect(await store.getScrapedNodes()).toHaveLength(INITIAL_SCRAPED_NODES.length + 1);
    setNodeDomain('');
  });
});

describe('node probe constants', () => {
  it('uses the Kotlin probe keyword verbatim', () => {
    expect(NODE_PROBE_KEYWORD).toBe('三体');
  });

  it('uses the Kotlin scrape URL verbatim', () => {
    expect(SCRAPE_URL).toBe('https://zlib.wwkejishe.top/');
  });
});

describe('zLibraryNodeConfig slot', () => {
  it('starts empty ("尚未恢复用户选择") and round-trips writes', () => {
    setNodeDomain('');
    expect(ZLibraryNodeConfig.domain).toBe('');
    setNodeDomain('z-lib.by');
    expect(ZLibraryNodeConfig.domain).toBe('z-lib.by');
    setNodeDomain('');
  });
});
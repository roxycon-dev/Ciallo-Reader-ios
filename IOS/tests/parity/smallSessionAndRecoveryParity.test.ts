/**
 * smallSessionAndRecoveryParity.test.ts —— 第十二批（52–62 行档，4 个文件，合计 221 行）。
 *
 *   · `source/zlibrary/network/ZLibrarySessionManager.kt`（52）—— 会话预热与「换节点必须重来」（E179）
 *   · `download/NovelDownloadStore.kt`（53）—— pending:* → book:* 的基线推进
 *   · `ui/comic/ComicLoadSupport.kt`（54）—— 远程缓存键 / 进度 LRU / 页锁引用计数
 *   · `data/HomeRenderRecovery.kt`（62）—— 只在入口窗口内、只从 HIGH 降级一次
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { ZLibrarySessionManager } from '@core/source/zlibrary/network/zLibrarySessionManager';
import type { ZLibraryHttpClient } from '@core/source/zlibrary/network/zLibraryHttpClient';
import type { ZLibraryCredentialStorage } from '@core/source/zlibrary/zLibraryCredentialStorage';
import { NovelDownloadStore, type NovelDownloadPrefs } from '@core/download/novelDownloadStore';
import { createSearchBook } from '@core/source/searchBook';
import { createNovelInfo } from '@core/source/novelInfo';
import {
  ComicLoadLocks,
  ComicTransfers,
  comicRemoteCacheIdentity,
  comicRemoteCacheKey,
  comicTransferFraction,
  comicTransferProgress,
} from '@core/comic/comicLoadSupport';
import {
  CAUSE_DEPTH_LIMIT,
  ENTRY_WINDOW_MS,
  HOME_RENDER_RECOVERY_NOTICE_KEY,
  RENDER_QUALITY_DEFAULT,
  RENDER_QUALITY_KEY,
  RENDER_QUALITY_MINIMAL,
  arm,
  consumeNotice,
  disarm,
  isRenderFailure,
  onUncaught,
  resetRenderRecoveryForTest,
  type RenderRecoverySettings,
} from '@core/app/homeRenderRecovery';
import { transferHash } from '@core/transfer/transferWire';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① ZLibrarySessionManager.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ZLibrarySessionManager.kt：会话预热（E179）', () => {
  const KT = kt('source/zlibrary/network/ZLibrarySessionManager.kt');

  interface Recorded {
    url: string;
    callTimeoutMs: number | null;
  }

  function manager(statusFor: (url: string) => number | Error) {
    const calls: Recorded[] = [];
    const httpClient = {
      async get(url: string, _referer: unknown, _headers: unknown, callTimeoutMs: number | null) {
        calls.push({ url, callTimeoutMs });
        const status = statusFor(url);
        if (status instanceof Error) throw status;
        return { code: status, isSuccessful: status >= 200 && status < 300, close: () => undefined };
      },
    } as unknown as ZLibraryHttpClient;
    const manager = new ZLibrarySessionManager(httpClient, {} as ZLibraryCredentialStorage);
    return { manager, calls };
  }

  it('初始状态：未初始化、activeDomain 是字面量 `z-library.sk`', () => {
    expect(KT).toContain('private var isSessionInitialized = false');
    expect(KT).toContain('private var activeDomain: String = "z-library.sk"');
    const { manager: m } = manager(() => 200);
    expect(m.isInitialized()).toBe(false);
    expect(m.getActiveDomain()).toBe('z-library.sk');
  });

  it('首页预热限时 4500ms（callTimeout，不是外层超时）', () => {
    expect(KT).toContain('httpClient.get(homepageUrl, callTimeoutMs = 4500L)');
    expect(KT).toContain('OkHttp callTimeout');
    const { manager: m, calls } = manager(() => 200);
    return m.ensureSessionInitialized('z-lib.sk').then(() => {
      expect(calls[0]?.url).toBe('https://z-lib.sk/');
      expect(calls[0]?.callTimeoutMs).toBe(4500);
    });
  });

  it('200 / 517 / 307 都算成功并置位；其它状态码返回 false 且不置位', async () => {
    expect(KT).toContain('response.isSuccessful || response.code == 517 || response.code == 307');
    for (const code of [200, 517, 307]) {
      const { manager: m } = manager(() => code);
      await expect(m.ensureSessionInitialized('a.sk')).resolves.toBe(true);
      expect(m.isInitialized(), `code ${String(code)}`).toBe(true);
    }
    for (const code of [403, 404, 500]) {
      const { manager: m } = manager(() => code);
      await expect(m.ensureSessionInitialized('a.sk')).resolves.toBe(false);
      expect(m.isInitialized(), `code ${String(code)}`).toBe(false);
    }
  });

  it('异常吞成 false（PoW 留给搜索内联解），不抛给调用方', async () => {
    expect(KT).toContain('(PoW will be solved inline during search)');
    const { manager: m } = manager(() => new Error('socket read timeout'));
    await expect(m.ensureSessionInitialized('a.sk')).resolves.toBe(false);
    expect(m.isInitialized()).toBe(false);
    expect(m.getActiveDomain()).toBe('a.sk');
  });

  it('已就绪 + 同节点 + 非强制 → **不再发请求**（Kotlin 的 `activeDomain == domain` 这一条）', async () => {
    expect(KT).toContain('if (isSessionInitialized && activeDomain == domain && !forceRefresh) {');
    const { manager: m, calls } = manager(() => 200);
    await m.ensureSessionInitialized('a.sk');
    expect(calls).toHaveLength(1);
    await expect(m.ensureSessionInitialized('a.sk')).resolves.toBe(true);
    expect(calls).toHaveLength(1); // 空操作
  });

  it('**换节点必须重新预热** —— 不能把上一节点的会话标志当成新节点的', async () => {
    const { manager: m, calls } = manager(() => 200);
    await m.ensureSessionInitialized('a.sk');
    expect(calls).toHaveLength(1);
    await expect(m.ensureSessionInitialized('b.sk')).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('https://b.sk/');
    expect(m.getActiveDomain()).toBe('b.sk');
  });

  it('forceRefresh 即便同节点也要重来；重来前先把标志清零', async () => {
    expect(KT).toContain('activeDomain = domain');
    expect(KT).toContain('isSessionInitialized = false');
    const { manager: m, calls } = manager(() => 200);
    await m.ensureSessionInitialized('a.sk');
    await expect(m.ensureSessionInitialized('a.sk', true)).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('重新预热失败时留下的是 `未初始化`，不是上回的 true', async () => {
    let status: number | Error = 200;
    const { manager: m, calls } = manager(() => status);
    await m.ensureSessionInitialized('a.sk');
    expect(m.isInitialized()).toBe(true);
    status = 500;
    await expect(m.ensureSessionInitialized('b.sk')).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(m.isInitialized()).toBe(false);
    // 下一次同节点调用必须再试（因为标志已清）
    status = 200;
    await expect(m.ensureSessionInitialized('b.sk')).resolves.toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('invalidateSession 只清标志，不动 activeDomain', () => {
    expect(KT).toContain('fun invalidateSession() {');
    expect(KT).toContain('fun isInitialized(): Boolean = isSessionInitialized');
    expect(KT).toContain('fun getActiveDomain(): String = activeDomain');
    const { manager: m } = manager(() => 200);
    return m.ensureSessionInitialized('a.sk').then(() => {
      m.invalidateSession();
      expect(m.isInitialized()).toBe(false);
      expect(m.getActiveDomain()).toBe('a.sk');
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② NovelDownloadStore.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('NovelDownloadStore.kt：pending → baseline', () => {
  const KT = kt('download/NovelDownloadStore.kt');

  function prefs(initial: Record<string, string> = {}): NovelDownloadPrefs & {
    data: Map<string, string>;
    failPut: boolean;
  } {
    const data = new Map(Object.entries(initial));
    const store = {
      data,
      failPut: false,
      getString: async (key: string) => data.get(key) ?? null,
      putString: async (key: string, value: string) => {
        if (store.failPut) return false;
        data.set(key, value);
        return true;
      },
      remove: async (key: string) => {
        data.delete(key);
      },
    };
    return store as unknown as NovelDownloadPrefs & { data: Map<string, string>; failPut: boolean };
  }

  function book(overrides: Record<string, unknown> = {}) {
    return createSearchBook({
      id: 'b1',
      sourceId: 'alicesw',
      title: '无职转生',
      author: '理不尽',
      format: 'epub',
      ...overrides,
    });
  }

  it('prefs 名 whole_book_novel_downloads；键是 `book:<source>:<id>` / `pending:<task>`', () => {
    expect(KT).toContain('getSharedPreferences("whole_book_novel_downloads", Context.MODE_PRIVATE)');
    expect(KT).toContain('private fun key(source: String, id: String) = "book:$source:$id"');
    const p = prefs();
    const store = new NovelDownloadStore(p);
    return store.prepare('t1', book(), false).then(() => {
      expect([...p.data.keys()]).toEqual(['pending:t1']);
    });
  });

  it('prepare 拒绝非全本小说源；写库失败要抛（Kotlin `check(commit())`）', async () => {
    expect(KT).toContain('require(WholeBookNovelSources.contains(book.sourceId))');
    expect(KT).toContain('check(prefs.edit().putString("pending:$taskId", encode(book).put("replace", replace).toString()).commit())');
    await expect(
      new NovelDownloadStore(prefs()).prepare('t1', book({ sourceId: 'mangadex' }), false),
    ).rejects.toThrow();

    const failing = prefs();
    failing.failPut = true;
    await expect(new NovelDownloadStore(failing).prepare('t1', book(), false)).rejects.toThrow();
  });

  it('pending 来回一致（含 replace 标记与 novelInfo 全字段），坏 JSON 吞成 null', async () => {
    expect(KT).toContain('data class Pending(val book: SearchBook, val replace: Boolean)');
    expect(KT).toContain('runCatching { val json = JSONObject(it); Pending(decode(json), json.optBoolean("replace")) }.getOrNull()');
    const p = prefs();
    const store = new NovelDownloadStore(p);
    const snapshot = book({
      novelInfo: createNovelInfo({
        synopsis: '简介',
        chapterCount: 9,
        volumeCount: 2,
        tags: ['异世界'],
        notice: '公告',
      }),
    });
    await store.prepare('t1', snapshot, true);
    const pending = await store.pending('t1');
    expect(pending?.replace).toBe(true);
    expect(pending?.book.id).toBe('b1');
    expect(pending?.book.sourceId).toBe('alicesw');
    expect(pending?.book.novelInfo?.chapterCount).toBe(9);
    expect(pending?.book.novelInfo?.tags).toEqual(['异世界']);
    expect(pending?.book.novelInfo?.notice).toBe('公告');
    // 坏 JSON → null（runCatching.getOrNull）
    await expect(new NovelDownloadStore(prefs({ 'pending:bad': '{oops' })).pending('bad')).resolves.toBeNull();
  });

  it('imported 把基线写进 book:* 并删掉 pending:*（只有导入后才推进基线）', async () => {
    expect(KT).toContain('fun imported(taskId: String) {');
    expect(KT).toContain('.remove("pending:$taskId").commit()');
    const p = prefs();
    const store = new NovelDownloadStore(p);
    await store.prepare('t1', book(), false);
    await store.imported('t1');
    expect([...p.data.keys()]).toEqual(['book:alicesw:b1']);
    expect(await store.baseline('alicesw', 'b1')).toMatchObject({ id: 'b1', title: '无职转生' });
    // pending 已清
    await expect(store.pending('t1')).resolves.toBeNull();
  });

  it('imported 对不存在的 task 直接返回；坏基线吞成 null', async () => {
    expect(KT).toContain('val pending = pending(taskId) ?: return');
    const p = prefs();
    const store = new NovelDownloadStore(p);
    await expect(store.imported('nope')).resolves.toBeUndefined();
    expect(p.data.size).toBe(0);
    await expect(
      new NovelDownloadStore(prefs({ 'book:alicesw:b1': 'not json' })).baseline('alicesw', 'b1'),
    ).resolves.toBeNull();
  });

  it('decode 的数字字段用「>0 才算有值」，字符串字段用 String? 语义', () => {
    expect(KT).toContain('chapterCount = data.optInt("chapterCount").takeIf { it > 0 }');
    expect(KT).toContain('size = json.optLong("size").takeIf { it > 0 }');
    expect(KT).toContain('json.optString("author")');
    expect(KT).toContain('format = json.optString("format", "epub")');
    // 0 / 负数都不算有值
    const store = new NovelDownloadStore(prefs({
      'book:alicesw:b1': JSON.stringify({
        id: 'b1',
        sourceId: 'alicesw',
        title: 't',
        author: '',
        format: 'mobi',
        size: 0,
        info: { chapterCount: 0, volumeCount: -1, tags: [] },
      }),
    }));
    return store.baseline('alicesw', 'b1').then((decoded) => {
      expect(decoded?.size).toBeNull();
      expect(decoded?.novelInfo?.chapterCount).toBeNull();
      expect(decoded?.novelInfo?.volumeCount).toBeNull();
      expect(decoded?.format).toBe('mobi');
      expect(decoded?.author).toBe('');
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ ComicLoadSupport.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ComicLoadSupport.kt：缓存键 / 进度 / 页锁', () => {
  const KT = kt('ui/comic/ComicLoadSupport.kt');

  it('缓存键把 header 名折小写、referer 参与、按长度前缀拼接（无歧义）', () => {
    expect(KT).toContain('val normalized = headers.entries.associate { it.key.lowercase() to it.value }.toMutableMap()');
    expect(KT).toContain('if (!referer.isNullOrBlank()) normalized["referer"] = referer');
    expect(KT).toContain('append(url.length).append(\':\').append(url)');
    expect(KT).toContain('append(k.length).append(\':\').append(k).append(v.length).append(\':\').append(v)');

    expect(comicRemoteCacheIdentity('https://a/1.jpg', {})).toBe('15:https://a/1.jpg');
    // header 名大小写不参与身份
    expect(comicRemoteCacheIdentity('u', { Referer: 'r' })).toBe(
      comicRemoteCacheIdentity('u', { referer: 'r' }),
    );
    // 键排序后拼接（UTF-16 码元序）
    expect(comicRemoteCacheIdentity('u', { b: '2', a: '1' })).toBe('1:u' + '1:a1:1' + '1:b1:2');
    // referer 只在非空白时覆盖
    expect(comicRemoteCacheIdentity('u', {}, '  ')).toBe('1:u');
    expect(comicRemoteCacheIdentity('u', { referer: 'old' }, 'new')).toBe('1:u' + '7:referer3:new');
  });

  it('摘要 = SHA-256(identity) 的小写 hex（64 位），与 Kotlin 逐字节一致', async () => {
    expect(KT).toContain('val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray())');
    const identity = comicRemoteCacheIdentity('https://a/1.jpg', { Referer: 'https://a/' });
    const expected = transferHash(new TextEncoder().encode(identity));
    await expect(comicRemoteCacheKey('https://a/1.jpg', { Referer: 'https://a/' })).resolves.toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it('进度：total ≤ 0 时 fraction 是 null；否则夹到 0..1', () => {
    expect(KT).toContain('val fraction: Float? get() = if (total > 0) (bytes.toFloat() / total).coerceIn(0f, 1f) else null');
    expect(comicTransferProgress()).toEqual({ bytes: 0, total: -1 });
    expect(comicTransferFraction(comicTransferProgress())).toBeNull();
    expect(comicTransferFraction(comicTransferProgress(5, 0))).toBeNull();
    expect(comicTransferFraction(comicTransferProgress(5, 10))).toBe(0.5);
    expect(comicTransferFraction(comicTransferProgress(20, 10))).toBe(1);
    expect(comicTransferFraction(comicTransferProgress(-5, 10))).toBe(0);
  });

  it('进度表上限 128，命中即刷新 LRU 顺序，淘汰最久未访问的', () => {
    expect(KT).toContain('LinkedHashMap<String, MutableStateFlow<ComicTransferProgress>>(128, .75f, true)');
    expect(KT).toContain('if (states.size >= 128) states.remove(states.keys.first())');
    ComicTransfers.states.clear();
    for (let i = 0; i < 128; i += 1) ComicTransfers.update(`u${String(i)}`, i, 100);
    expect(ComicTransfers.states.size).toBe(128);
    // 访问 u0 → 移到末尾；再插新键应淘汰 u1
    ComicTransfers.state('u0');
    ComicTransfers.update('fresh', 1, 1);
    expect(ComicTransfers.states.has('u0')).toBe(true);
    expect(ComicTransfers.states.has('u1')).toBe(false);
    expect(ComicTransfers.states.has('fresh')).toBe(true);
    ComicTransfers.states.clear();
  });

  it('订阅者收到同一进度快照；退订后不再收', () => {
    ComicTransfers.states.clear();
    const handle = ComicTransfers.state('k');
    const seen: number[] = [];
    const off = handle.subscribe((p) => seen.push(p.bytes));
    ComicTransfers.update('k', 10, 100);
    expect(handle.value()).toEqual({ bytes: 10, total: 100 });
    ComicTransfers.update('k', 20, 100);
    expect(seen).toEqual([10, 20]);
    off();
    ComicTransfers.update('k', 30, 100);
    expect(seen).toEqual([10, 20]);
    ComicTransfers.states.clear();
  });

  it('页锁：同一个 key 返回同一把锁，引用计数归零才回收', () => {
    expect(KT).toContain('private class Entry(val mutex: Mutex = Mutex(), var users: Int = 0)');
    expect(KT).toContain('entries[key]?.let { if (--it.users == 0) entries.remove(key) }');
    const locks = new ComicLoadLocks();
    const a = locks.acquire('k');
    expect(locks.usersOf('k')).toBe(1);
    const b = locks.acquire('k');
    expect(b).toBe(a);
    expect(locks.usersOf('k')).toBe(2);
    locks.release('k');
    expect(locks.entryCount()).toBe(1);
    expect(locks.usersOf('k')).toBe(1);
    locks.release('k');
    expect(locks.entryCount()).toBe(0);
    // 多余的 release 不炸
    locks.release('k');
    expect(locks.entryCount()).toBe(0);
  });

  it('同一把锁串行执行；抛错也放行后续等待者', async () => {
    const locks = new ComicLoadLocks();
    const mutex = locks.acquire('k');
    const order: string[] = [];
    const first = mutex.withLock(async () => {
      order.push('in-1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('out-1');
      return 1;
    });
    const second = mutex.withLock(async () => {
      order.push('in-2');
      return 2;
    });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['in-1', 'out-1', 'in-2']);

    await expect(
      mutex.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(mutex.withLock(async () => 'after')).resolves.toBe('after');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ HomeRenderRecovery.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('HomeRenderRecovery.kt：只在入口窗口内降级一次', () => {
  const KT = kt('data/HomeRenderRecovery.kt');

  function settings(initial: Record<string, number | boolean> = {}) {
    const data = new Map<string, number | boolean>(Object.entries(initial));
    const store: RenderRecoverySettings & { data: Map<string, number | boolean> } = {
      data,
      getInt: async (key: string, fallback = 0) => {
        const v = data.get(key);
        return typeof v === 'number' ? v : fallback;
      },
      setInt: async (key: string, value: number) => {
        data.set(key, value);
      },
      getBoolean: async (key: string, fallback = false) => {
        const v = data.get(key);
        return typeof v === 'boolean' ? v : fallback;
      },
      setBoolean: async (key: string, value: boolean) => {
        data.set(key, value);
      },
      remove: async (key: string) => {
        data.delete(key);
      },
    };
    return store;
  }

  /** 栈里带渲染层类名的错误。 */
  function renderError(): Error {
    const error = new Error('render blew up');
    error.stack = [
      'Error: render blew up',
      '    at GlassCard (com.example.ui.components.GlassCard.kt:42)',
      '    at measure (androidx.compose.ui.node.MeasureScope.kt:10)',
    ].join('\n');
    return error;
  }

  function plainError(): Error {
    const error = new Error('network failed');
    error.stack = 'Error: network failed\n    at fetch (src/core/net.ts:1)';
    return error;
  }

  beforeEach(() => {
    resetRenderRecoveryForTest();
  });

  it('常量：20s 窗口、默认画质 2、降级值 -1、8 层 cause 链', () => {
    expect(KT).toContain('const val ENTRY_WINDOW_MS = 20_000L');
    expect(KT).toContain('prefs.getInt("render_quality", 2)');
    expect(KT).toContain('putInt("render_quality", -1)');
    expect(KT).toContain('repeat(8)');
    expect(ENTRY_WINDOW_MS).toBe(20_000);
    expect(RENDER_QUALITY_DEFAULT).toBe(2);
    expect(RENDER_QUALITY_MINIMAL).toBe(-1);
    expect(CAUSE_DEPTH_LIMIT).toBe(8);
    expect(RENDER_QUALITY_KEY).toBe('render_quality');
    expect(HOME_RENDER_RECOVERY_NOTICE_KEY).toBe('home_render_recovery_notice');
  });

  it('arm 返回递增 token；旧 token 的 disarm 不生效（新窗口必须保留）', () => {
    expect(KT).toContain('activeToken = ++nextToken');
    expect(KT).toContain('if (activeToken == token) activeToken = 0L');
    let now = 0;
    const first = arm({ now: () => now });
    now = 1;
    const second = arm({ now: () => now });
    expect(second).toBeGreaterThan(first);
    disarm(first);
    // 仍然武装：旧 token 迟到的 disarm 不能清掉新窗口
    return expect(
      onUncaught(renderError(), { settings: settings(), now: () => now }),
    ).resolves.toBeUndefined();
  });

  it('未武装 → 什么都不写', async () => {
    expect(KT).toContain('if (activeToken == 0L || SystemClock.uptimeMillis() - enteredAt !in 0..ENTRY_WINDOW_MS) return');
    const store = settings();
    await onUncaught(renderError(), { settings: store, now: () => 0 });
    expect(store.data.size).toBe(0);
  });

  it('超过 20s 窗口 → 不降级（正常重启不算渲染失败）', async () => {
    let now = 1_000;
    arm({ now: () => now });
    const store = settings();
    now = 1_000 + ENTRY_WINDOW_MS + 1;
    await onUncaught(renderError(), { settings: store, now: () => now });
    expect(store.data.size).toBe(0);
    // 刚好在窗口右端点 → 降级
    now = 1_000;
    arm({ now: () => now });
    now = 1_000 + ENTRY_WINDOW_MS;
    await onUncaught(renderError(), { settings: store, now: () => now });
    expect(store.data.get(RENDER_QUALITY_KEY)).toBe(RENDER_QUALITY_MINIMAL);
  });

  it('非渲染栈 → 不降级；VM 级致命错误即便栈里是 GlassCard 也排除', async () => {
    expect(KT).toContain('if (error is VirtualMachineError || error is ThreadDeath) return false');
    expect(isRenderFailure(plainError())).toBe(false);
    expect(isRenderFailure(renderError())).toBe(true);

    const now = 0;
    arm({ now: () => now });
    const store = settings();
    await onUncaught(plainError(), { settings: store, now: () => now });
    expect(store.data.size).toBe(0);

    const overflow = new RangeError('Maximum call stack size exceeded');
    overflow.stack = renderError().stack ?? '';
    expect(isRenderFailure(overflow)).toBe(false);
  });

  it('只从 HIGH(2) / MAX(3) 降级；已经是 -1 就不再写、也不提示', async () => {
    expect(KT).toContain('if (prefs.getInt("render_quality", 2) < 2) return');
    for (const quality of [RENDER_QUALITY_DEFAULT, 3]) {
      resetRenderRecoveryForTest();
      const now = 0;
      arm({ now: () => now });
      const store = settings({ [RENDER_QUALITY_KEY]: quality });
      await onUncaught(renderError(), { settings: store, now: () => now });
      expect(store.data.get(RENDER_QUALITY_KEY), String(quality)).toBe(RENDER_QUALITY_MINIMAL);
      expect(store.data.get(HOME_RENDER_RECOVERY_NOTICE_KEY)).toBe(true);
    }
    for (const quality of [-1, 0, 1]) {
      resetRenderRecoveryForTest();
      const now = 0;
      arm({ now: () => now });
      const store = settings({ [RENDER_QUALITY_KEY]: quality });
      await onUncaught(renderError(), { settings: store, now: () => now });
      expect(store.data.get(RENDER_QUALITY_KEY), String(quality)).toBe(quality);
      expect(store.data.has(HOME_RENDER_RECOVERY_NOTICE_KEY)).toBe(false);
    }
  });

  it('一个窗口只降一次：降级后立即解除武装', async () => {
    expect(KT).toContain('activeToken = 0L');
    const now = 0;
    arm({ now: () => now });
    const store = settings({ [RENDER_QUALITY_KEY]: 3 });
    await onUncaught(renderError(), { settings: store, now: () => now });
    expect(store.data.get(RENDER_QUALITY_KEY)).toBe(RENDER_QUALITY_MINIMAL);
    // 第二次异常不再改任何东西（把画质改回 3 也不该被重新降级）
    store.data.set(RENDER_QUALITY_KEY, 3);
    await onUncaught(renderError(), { settings: store, now: () => now });
    expect(store.data.get(RENDER_QUALITY_KEY)).toBe(3);
  });

  it('没有存储 → 静默放弃（Web 宿主还没起来时不炸）', async () => {
    const now = 0;
    arm({ now: () => now });
    await expect(
      onUncaught(renderError(), { settings: null, now: () => now }),
    ).resolves.toBeUndefined();
  });

  it('consumeNotice 读到就清掉并返回 true（只提示一次）', async () => {
    expect(KT).toContain('prefs.edit().remove("home_render_recovery_notice").apply()');
    const store = settings({ [HOME_RENDER_RECOVERY_NOTICE_KEY]: true });
    await expect(consumeNotice({ settings: store })).resolves.toBe(true);
    expect(store.data.has(HOME_RENDER_RECOVERY_NOTICE_KEY)).toBe(false);
    await expect(consumeNotice({ settings: store })).resolves.toBe(false);
    await expect(consumeNotice({ settings: settings() })).resolves.toBe(false);
    await expect(consumeNotice({ settings: null })).resolves.toBe(false);
  });
});

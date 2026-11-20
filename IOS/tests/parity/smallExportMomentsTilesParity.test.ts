/**
 * smallExportMomentsTilesParity.test.ts —— 第十三批（58–64 行档，4 个文件，合计 245 行）。
 *
 *   · `ui/components/StartupDiagnosticsExportButton.kt`（58）—— 导出流程的四条分支
 *   · `god/GodMomentViewModel.kt`（60）—— 共享 `all` + `chapterMapOf` + 三个删除范围（E181）
 *   · `ui/comic/MangaJaNaiTiles.kt`（63）—— 瓦片 LRU 与**边缘复制**（E182）
 *   · `source/zlibrary/ZLibraryCredentialStorage.kt`（64）—— 凭据四键 + 登录判定（E180）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  StartupDiagnosticsExportButton,
  startupDiagnosticFileName,
  type StartupDiagnosticsExportPorts,
} from '@ui/components/StartupDiagnosticsExportButton';
import { GodMomentDashboard, type GodMomentRow } from '@core/god/moments';
import { MangaJaNaiTileCache, intArrayHashCode, readMangaJaNaiTile } from '@core/comic/mangaJaNaiTiles';
import {
  DEFAULT_DOMAIN,
  ZLibraryCredentialStorage,
  createEncryptedSecretStoreAdapter,
  type ZLibraryCredentialStore,
} from '@core/source/zlibrary/zLibraryCredentialStorage';
import { DEFAULT_NODE } from '@core/library/zLibraryNodeManager';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① StartupDiagnosticsExportButton.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('StartupDiagnosticsExportButton.kt：导出流程', () => {
  const KT = kt('ui/components/StartupDiagnosticsExportButton.kt');

  it('文件名格式 `Ciallo-Reader-diagnostic-<版本>-<毫秒>.txt`', () => {
    expect(KT).toContain('"Ciallo-Reader-diagnostic-${BuildConfig.VERSION_NAME}-${System.currentTimeMillis()}.txt"');
    expect(startupDiagnosticFileName('1.6.4', 1_700_000_000_000)).toBe(
      'Ciallo-Reader-diagnostic-1.6.4-1700000000000.txt',
    );
  });

  it('四条分支：取消 / 面板打不开 / 写成功 / 写失败（顺序与文案逐字）', () => {
    expect(KT).toContain('ActivityResultContracts.CreateDocument("text/plain")');
    expect(KT).toContain('if (uri != null) {');
    expect(KT).toContain('AppToast.makeText(context, "诊断日志已保存", Toast.LENGTH_SHORT).show()');
    expect(KT).toContain('AppToast.makeText(context, "无法保存诊断日志，请重新选择保存位置", Toast.LENGTH_LONG).show()');
    expect(KT).toContain('AppToast.makeText(context, "无法打开文件保存窗口", Toast.LENGTH_LONG).show()');
    // 失败要先 record 再提示
    expect(KT).toContain('StartupDiagnostics.record(context, "diagnostic-export", failure)');
    expect(KT).toContain('StartupDiagnostics.record(context, "diagnostic-picker", failure)');
    // finally 复位
    expect(KT).toContain('} finally { exporting = false }');
  });

  it('按钮文案与禁用态：导出中显示「正在导出…」且不可再点', () => {
    expect(KT).toContain('text = if (exporting) "正在导出…" else "导出启动诊断"');
    expect(KT).toContain('enabled = !exporting');
    expect(KT).toContain('modifier = modifier.testTag("export_startup_diagnostics_button")');
    expect(KT).toContain('variant = AppButtonVariant.Secondary');
    expect(KT).toContain('fullWidth = true');
  });

  it('端口形状：五个注入点齐全（readReport / recordFailure / openPicker / writeTarget / version）', () => {
    const ports: StartupDiagnosticsExportPorts = {
      readReport: async () => 'report',
      recordFailure: async () => undefined,
      openPicker: async () => 'target',
      writeTarget: async () => undefined,
      version: '1.6.4',
    };
    expect(Object.keys(ports).sort()).toEqual(
      ['openPicker', 'readReport', 'recordFailure', 'version', 'writeTarget'].sort(),
    );
    expect(StartupDiagnosticsExportButton).toBeTypeOf('function');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② GodMomentViewModel.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GodMomentViewModel.kt：共享 all / chapterMapOf / 三个删除范围（E181）', () => {
  const KT = kt('god/GodMomentViewModel.kt');

  function row(chapterId: string, bookId = 1): GodMomentRow {
    return {
      id: 1,
      bookId,
      chapterId,
      chapterTitle: `第 ${chapterId} 章`,
      quote: 'q',
      note: null,
      rating: 5,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  function repository(initial: GodMomentRow[] = []) {
    const rows = [...initial];
    const calls: string[] = [];
    return {
      rows,
      calls,
      async all() {
        calls.push('all');
        return [...rows];
      },
      async observeChapterMap(bookId: string) {
        calls.push(`map:${bookId}`);
        return rows.filter((r) => String(r.bookId) === bookId);
      },
      async save(moment: GodMomentRow) {
        calls.push('save');
        const id = rows.length + 100;
        rows.push({ ...moment, id });
        return id;
      },
      async delete(id: number) {
        calls.push(`delete:${String(id)}`);
        const at = rows.findIndex((r) => r.id === id);
        if (at >= 0) rows.splice(at, 1);
      },
      async deleteForBook(bookId: string) {
        calls.push(`book:${bookId}`);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (String(rows[i]?.bookId) === bookId) rows.splice(i, 1);
        }
      },
      async deleteForChapter(bookId: string, chapterId: string) {
        calls.push(`chapter:${bookId}:${chapterId}`);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const r = rows[i];
          if (r !== undefined && String(r.bookId) === bookId && r.chapterId === chapterId) {
            rows.splice(i, 1);
          }
        }
      },
    };
  }

  it('KDoc：排行榜与编辑窗口监听同一个 all（不存在「改了排行榜不更新」）', () => {
    expect(KT).toContain('排行榜（统计页 / 全屏页）与编辑窗口监听**同一个** [all] StateFlow');
    expect(KT).toContain('增删改后两处自动刷新');
    expect(KT).toContain('val all: StateFlow<List<GodMomentEntity>> = repository.observeAll()');
    expect(KT).toContain('.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())');
  });

  it('all 是**共享**快照：两个订阅者收到同一份，refresh 后都能看到', async () => {
    const repo = repository([row('c1')]);
    const dashboard = new GodMomentDashboard(repo);
    expect(dashboard.all.value()).toEqual([]); // 初始 emptyList()
    const a: number[] = [];
    const b: number[] = [];
    const offA = dashboard.all.subscribe((list) => a.push(list.length));
    const offB = dashboard.all.subscribe((list) => b.push(list.length));
    await dashboard.all.refresh();
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(dashboard.all.value()).toHaveLength(1);
    await dashboard.save(row('c2'));
    await dashboard.all.refresh();
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
    offA();
    await dashboard.all.refresh();
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2, 2]);
    offB();
  });

  it('chapterMapOf：空 id 给空表且**不查库**；否则按 chapterId 建表', async () => {
    expect(KT).toContain('if (id.isBlank()) flowOf(emptyMap()) else repository.observeChapterMap(id)');
    const repo = repository([row('c1'), row('c2')]);
    const dashboard = new GodMomentDashboard(repo);
    const out: Map<string, GodMomentRow>[] = [];
    for await (const map of dashboard.chapterMapOf(['  ', '1'])) out.push(map);
    expect(out[0]?.size).toBe(0);
    expect([...(out[1]?.keys() ?? [])]).toEqual(['c1', 'c2']);
    expect(repo.calls).toEqual(['map:1']); // 空 id 没查库
  });

  it('chapterMapOf 是 flatMapLatest：慢的旧分支不能覆盖新书', async () => {
    expect(KT).toContain('bookIdFlow.flatMapLatest { id ->');
    const rows = [row('old', 1), row('new', 2)];
    const repo = {
      all: async () => rows,
      async observeChapterMap(bookId: string) {
        // book 1 慢、book 2 快
        if (bookId === '1') await new Promise((resolve) => setTimeout(resolve, 20));
        return rows.filter((r) => String(r.bookId) === bookId);
      },
      save: async () => 1,
      delete: async () => undefined,
      deleteForBook: async () => undefined,
      deleteForChapter: async () => undefined,
    };
    const dashboard = new GodMomentDashboard(repo);
    const seen: string[][] = [];
    for await (const map of dashboard.chapterMapOf(['1', '2'])) {
      seen.push([...map.keys()]);
    }
    // 「1」那支作废（后到者胜），只剩「2」的结果
    expect(seen).toEqual([['new']]);
  });

  it('save 返回 id 并回调一次；三个删除范围各自转调 repository', async () => {
    expect(KT).toContain('fun save(entity: GodMomentEntity, onDone: (Long) -> Unit = {})');
    expect(KT).toContain('fun delete(id: Long)');
    expect(KT).toContain('fun deleteForBook(bookId: String)');
    expect(KT).toContain('fun deleteForChapter(bookId: String, chapterId: String)');
    const repo = repository([row('c1'), row('c2')]);
    const dashboard = new GodMomentDashboard(repo);
    const ids: number[] = [];
    const id = await dashboard.save(row('c3'), (value) => ids.push(value));
    expect(id).toBe(102);
    expect(ids).toEqual([102]);
    // 默认回调不炸
    await expect(dashboard.save(row('c4'))).resolves.toBe(103);

    await dashboard.delete(100);
    await dashboard.deleteForBook('1');
    await dashboard.deleteForChapter('1', 'c2');
    expect(repo.calls).toEqual([
      'save',
      'save',
      'delete:100',
      'book:1',
      'chapter:1:c2',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ MangaJaNaiTiles.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('MangaJaNaiTiles.kt：瓦片 LRU 与边缘复制（E182）', () => {
  const KT = kt('ui/comic/MangaJaNaiTiles.kt');

  it('缓存只认**完全相同**的输入；命中即移到末尾（LRU）', () => {
    expect(KT).toContain('val index = entries.indexOfFirst { it.hash == hash && it.input.contentEquals(input) }');
    expect(KT).toContain('val entry = entries.removeAt(index)');
    const cache = new MangaJaNaiTileCache(2);
    expect(cache.size).toBe(0);
    const a = new Int32Array([1, 2, 3]);
    const b = new Int32Array([4, 5, 6]);
    expect(cache.find(a)).toBeNull();
    cache.put(a, new Float32Array([9]));
    expect(cache.size).toBe(1);
    expect([...(cache.find(new Int32Array([1, 2, 3])) as Float32Array)]).toEqual([9]);
    cache.put(b, new Float32Array([8]));
    expect(cache.size).toBe(2);
    // 访问 a → a 不再是「最旧」，插入 c 时淘汰 b
    cache.find(new Int32Array([1, 2, 3]));
    cache.put(new Int32Array([7, 8, 9]), new Float32Array([7]));
    expect(cache.find(new Int32Array([4, 5, 6]))).toBeNull();
    expect(cache.find(new Int32Array([1, 2, 3]))).not.toBeNull();
  });

  it('capacity ≤ 0 时 put 直接丢；满仓时**原位复用**最旧条目并校验尺寸', () => {
    expect(KT).toContain('if (capacity <= 0) return');
    expect(KT).toContain('require(it.input.size == input.size && it.output.size == output.size)');
    const disabled = new MangaJaNaiTileCache(0);
    disabled.put(new Int32Array([1]), new Float32Array([1]));
    expect(disabled.size).toBe(0);

    const cache = new MangaJaNaiTileCache(1);
    cache.put(new Int32Array([1, 2]), new Float32Array([1]));
    expect(() => cache.put(new Int32Array([1, 2, 3]), new Float32Array([1]))).toThrow();
    cache.put(new Int32Array([3, 4]), new Float32Array([2]));
    expect(cache.size).toBe(1);
    expect([...(cache.find(new Int32Array([3, 4])) as Float32Array)]).toEqual([2]);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('hash 是 Kotlin `IntArray.contentHashCode()` 的 31 进制累加', () => {
    expect(KT).toContain('val hash = input.contentHashCode()');
    // Kotlin Arrays.hashCode: result = 1; result = 31*result + e
    expect(intArrayHashCode(new Int32Array([]))).toBe(1);
    expect(intArrayHashCode(new Int32Array([1]))).toBe(31 + 1);
    expect(intArrayHashCode(new Int32Array([1, 2]))).toBe(((31 * (31 + 1)) | 0) + 2);
  });

  it('readMangaJaNaiTile：一次原生读取 + 左右边缘按行复制 + 上下整行复制', () => {
    expect(KT).toContain('source.getPixels(target, dy * side + dx, side, left, top, width, height)');
    expect(KT).toContain('target.copyInto(target, row * side, dy * side, (dy + 1) * side)');
    expect(KT).toContain('target.copyInto(target, row * side, (dy + height - 1) * side, (dy + height) * side)');

    // 8×8 源、tileSize=4、halo=1 → side=6；取 (0,0)：左/上被裁，dx=dy=1
    const sourceWidth = 8;
    const sourceHeight = 8;
    const side = 6;
    const target = new Int32Array(side * side).fill(-1);
    const pixel = (x: number, y: number): number => y * 100 + x;
    const calls: number[][] = [];
    readMangaJaNaiTile(
      (dst, dstOffset, dstStride, srcLeft, srcTop, width, height) => {
        calls.push([dstOffset, dstStride, srcLeft, srcTop, width, height]);
        for (let row = 0; row < height; row += 1) {
          for (let col = 0; col < width; col += 1) {
            dst[dstOffset + row * dstStride + col] = pixel(srcLeft + col, srcTop + row);
          }
        }
      },
      sourceWidth,
      sourceHeight,
      0,
      0,
      target,
      4,
      1,
    );
    // 只有一次原生读取，且参数与 Kotlin 一致（left=0 top=0 w=5 h=5）
    expect(calls).toEqual([[1 * side + 1, side, 0, 0, 5, 5]]);

    const at = (col: number, row: number): number => target[row * side + col] as number;
    // 有效区（1..5, 1..5）就是源像素
    expect(at(1, 1)).toBe(pixel(0, 0));
    expect(at(5, 5)).toBe(pixel(4, 4));
    // 左侧 x=0 复制自 x=1（同行）
    expect(at(0, 1)).toBe(at(1, 1));
    expect(at(0, 5)).toBe(at(1, 5));
    // 顶部整行复制自第 1 行
    for (let col = 0; col < side; col += 1) expect(at(col, 0)).toBe(at(col, 1));
    // 底部整行复制自最后有效行（dy+height-1 = 5）
    for (let col = 0; col < side; col += 1) expect(at(col, 7 - 2)).toBe(at(col, 5));
  });

  it('右下角取瓦片时右/下边缘同样镜像', () => {
    const side = 6;
    const target = new Int32Array(side * side).fill(-1);
    const pixel = (x: number, y: number): number => y * 100 + x;
    readMangaJaNaiTile(
      (dst, dstOffset, dstStride, srcLeft, srcTop, width, height) => {
        for (let row = 0; row < height; row += 1) {
          for (let col = 0; col < width; col += 1) {
            dst[dstOffset + row * dstStride + col] = pixel(srcLeft + col, srcTop + row);
          }
        }
      },
      8,
      8,
      6,
      6,
      target,
      4,
      1,
    );
    const at = (col: number, row: number): number => target[row * side + col] as number;
    // (6,6) 起：left=5 top=5 right=8 bottom=8 → dx=0 dy=0 w=3 h=3
    expect(at(0, 0)).toBe(pixel(5, 5));
    expect(at(2, 2)).toBe(pixel(7, 7));
    // 右侧 x=3..5 复制自 x=2
    for (let col = 3; col < side; col += 1) expect(at(col, 1)).toBe(at(2, 1));
    // 下方整行复制自第 2 行
    for (let col = 0; col < side; col += 1) expect(at(col, 5)).toBe(at(col, 2));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ ZLibraryCredentialStorage.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ZLibraryCredentialStorage.kt：凭据四键与登录判定（E180）', () => {
  const KT = kt('source/zlibrary/ZLibraryCredentialStorage.kt');

  function store(available = true): ZLibraryCredentialStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      available,
      getString: async (key: string) => data.get(key) ?? null,
      putString: async (key: string, value: string | null) => {
        if (value === null) data.delete(key);
        else data.set(key, value);
      },
      clear: async () => {
        data.clear();
      },
    };
  }

  it('DEFAULT_DOMAIN 必须等于 `ZLibraryNodeManager.DEFAULT_NODE`，不能写死旧域名', () => {
    expect(KT).toContain('const val DEFAULT_DOMAIN = com.example.library.ZLibraryNodeManager.DEFAULT_NODE');
    const nodeManager = kt('library/ZLibraryNodeManager.kt');
    expect(nodeManager).toContain('const val DEFAULT_NODE = "z-lib.sk"');
    expect(DEFAULT_NODE).toBe('z-lib.sk');
    expect(DEFAULT_DOMAIN).toBe(DEFAULT_NODE);
    expect(DEFAULT_DOMAIN).not.toBe('1lib.sk');
  });

  it('四个键逐字：userId / userKey / domain / cookies', () => {
    expect(KT).toContain('private const val KEY_USER_ID = "userId"');
    expect(KT).toContain('private const val KEY_USER_KEY = "userKey"');
    expect(KT).toContain('private const val KEY_DOMAIN = "domain"');
    expect(KT).toContain('private const val KEY_COOKIES = "cookies"');
    const s = store();
    const storage = new ZLibraryCredentialStorage(s);
    return storage.saveCredentials({ userId: 'u1', userKey: 'k1', cookies: 'remix_userkey=abc' }).then(() => {
      expect([...s.data.keys()].sort()).toEqual(['cookies', 'domain', 'userKey', 'userId'].sort());
    });
  });

  it('saveCredentials：domain 空串回落 DEFAULT_DOMAIN；传 null 的键被删除', async () => {
    expect(KT).toContain('.putString(KEY_DOMAIN, domain.ifBlank { DEFAULT_DOMAIN })');
    const s = store();
    const storage = new ZLibraryCredentialStorage(s);
    await storage.saveCredentials({ userId: 'u1', userKey: 'k1', domain: '   ', cookies: 'c' });
    expect(s.data.get('domain')).toBe(DEFAULT_DOMAIN);
    await storage.saveCredentials({});
    expect(s.data.has('userId')).toBe(false);
    expect(s.data.has('cookies')).toBe(false);
    expect(s.data.get('domain')).toBe(DEFAULT_DOMAIN);
  });

  it('安全存储不可用时 save 抛 Kotlin 原文（不是 EncryptedSecretStore 的 API 密钥文案）', () => {
    expect(KT).toContain('error("系统安全存储不可用，无法保存登录凭据，请修复系统密钥后重试")');
    const storage = new ZLibraryCredentialStorage(store(false));
    return expect(storage.saveCredentials({ userId: 'u' })).rejects.toThrow(
      '系统安全存储不可用，无法保存登录凭据，请修复系统密钥后重试',
    );
  });

  it('读方法都吞异常：坏存储 → null / DEFAULT_DOMAIN', async () => {
    expect(KT).toContain('runCatching { prefs?.getString(KEY_DOMAIN, DEFAULT_DOMAIN) }.getOrNull() ?: DEFAULT_DOMAIN');
    const broken: ZLibraryCredentialStore = {
      available: true,
      getString: async () => {
        throw new Error('keystore broken');
      },
      putString: async () => undefined,
      clear: async () => undefined,
    };
    const storage = new ZLibraryCredentialStorage(broken);
    await expect(storage.getUserId()).resolves.toBeNull();
    await expect(storage.getUserKey()).resolves.toBeNull();
    await expect(storage.getCookies()).resolves.toBeNull();
    await expect(storage.getDomain()).resolves.toBe(DEFAULT_DOMAIN);
    await expect(storage.isLoggedIn()).resolves.toBe(false);
  });

  it('isLoggedIn：cookie 含 remix_userkey/remix_userid 且非空白，或 userKey 非空白', async () => {
    expect(KT).toContain('cookies.contains("remix_userkey") || cookies.contains("remix_userid")');
    const storage = new ZLibraryCredentialStorage(store());
    await expect(storage.isLoggedIn()).resolves.toBe(false);
    await storage.saveCredentials({ cookies: 'remix_userkey=abc' });
    await expect(storage.isLoggedIn()).resolves.toBe(true);
    await storage.saveCredentials({ cookies: 'remix_userid=42' });
    await expect(storage.isLoggedIn()).resolves.toBe(true);
    await storage.saveCredentials({ cookies: 'other=1' });
    await expect(storage.isLoggedIn()).resolves.toBe(false);
    await storage.saveCredentials({ cookies: '   ' });
    await expect(storage.isLoggedIn()).resolves.toBe(false);
    await storage.saveCredentials({ userKey: 'k' });
    await expect(storage.isLoggedIn()).resolves.toBe(true);
    await storage.saveCredentials({ userKey: '  ' });
    await expect(storage.isLoggedIn()).resolves.toBe(false);
  });

  it('clear 清空四键；适配器把 null 值映射成删除', async () => {
    expect(KT).toContain('prefs?.edit()?.clear()?.apply()');
    const s = store();
    const storage = new ZLibraryCredentialStorage(s);
    await storage.saveCredentials({ userId: 'u', userKey: 'k', cookies: 'c' });
    await storage.clear();
    expect(s.data.size).toBe(0);

    const inner = new Map<string, string>();
    const adapter = createEncryptedSecretStoreAdapter(
      {
        get: async (key: string) => inner.get(key) ?? null,
        set: async (key: string, value: string) => {
          inner.set(key, value);
        },
        remove: async (key: string) => {
          inner.delete(key);
        },
      },
      null,
    );
    expect(adapter.available).toBe(true);
    await adapter.putString('k', 'v');
    expect(inner.get('k')).toBe('v');
    await adapter.putString('k', null);
    expect(inner.has('k')).toBe(false);
    // SecureStore 为 null → available=false（对应 Kotlin 的 prefs 为 null）
    expect(createEncryptedSecretStoreAdapter(null).available).toBe(false);
  });
});

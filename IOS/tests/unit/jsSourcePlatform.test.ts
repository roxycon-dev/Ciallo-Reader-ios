/**
 * JS 书源平台适配层单元测试。
 *
 * 重点验证与 Android 等价的安全语义：
 *  - JsRuntime 的 30 MiB / 512 KiB / 45s 限额常量（Q8 已批准 45s guard）
 *  - tick 预算能打断死循环；同步 evaluate 与异步 Worker 两条路径
 *  - KeyValueStorage 的损坏数据回落（SharedPreferences 不崩）
 *  - FileStoragePort 的 filesDir/cacheDir/toFileUrl/readAsset
 *  - HttpClient 合并 header、返回全部 Set-Cookie、失败时抛（调用方转 HttpFailure）
 *  - Bitmap 像素读写 / 90° 旋转 / blit
 *  - CryptoPort 缺实现时显式报错而不是返回假结果
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  JS_RUNTIME_BUDGET_MS,
  JS_RUNTIME_MAX_STACK,
  JS_RUNTIME_MEMORY_LIMIT,
  JS_RUNTIME_MEMORY_MB,
  JS_RUNTIME_TICK_NAME,
  b64,
  createCanvasBitmap,
  createFetchJsHttpClient,
  createWebCryptoPort,
  createWebFileStorage,
  createWebImageProbe,
  createWebJsRuntime,
  createWebKeyValueStorage,
  monotonicClock,
  sniffImageMime,
  unb64,
  wallClock,
  type WebJsRuntime,
} from '@platform/web/jsSourcePlatform';
import { createNodeSandboxTransport } from './helpers/jsSandboxTestHarness';

describe('clocks', () => {
  it('wallClock advances with Date.now', () => {
    const a = wallClock();
    expect(typeof a).toBe('number');
    expect(a).toBeGreaterThan(1_600_000_000_000);
  });

  it('monotonicClock returns a float ms value', () => {
    expect(typeof monotonicClock()).toBe('number');
  });
});

/**
 * 2026-10-11（SECURITY_AUDIT P0-1~P0-4）：inline 路径已移除，`evaluate` 一律走
 * 真 Worker 沙箱（node:vm 传输，见 helpers/jsSandboxTestHarness.ts）。原
 * `forceInlineFallback` 用例按审计 P0-1 修法 7 改为断言「无沙箱显式抛错」与
 * 「程序完成值语义」；死循环 / 隔离 / RPC 桥的完整回归在 jsSandbox.test.ts。
 */
function createTestRuntime(overrides: { budgetMs?: number; memoryLimit?: number } = {}): WebJsRuntime {
  return createWebJsRuntime({
    createSandbox: createNodeSandboxTransport,
    ...overrides,
  }) as WebJsRuntime;
}

describe('JsRuntime limits (QuickJS parity, Q8)', () => {
  it('exposes the Android limits', () => {
    expect(JS_RUNTIME_MEMORY_MB).toBe(30);
    expect(JS_RUNTIME_MEMORY_LIMIT).toBe(30 * 1024 * 1024);
    expect(JS_RUNTIME_MAX_STACK).toBe(512 * 1024);
    expect(JS_RUNTIME_BUDGET_MS).toBe(45_000);
    expect(JS_RUNTIME_TICK_NAME).toBe('__cialloTick');
  });

  it('reports memoryLimit / maxStackSize on the instance', () => {
    const rt = createTestRuntime();
    expect(rt.memoryLimit).toBe(JS_RUNTIME_MEMORY_LIMIT);
    expect(rt.maxStackSize).toBe(JS_RUNTIME_MAX_STACK);
    rt.dispose();
  });

  it('isolation is always the worker sandbox (inline removed, P0-1)', () => {
    const rt = createTestRuntime();
    expect(rt.isolationLevel).toBe('worker');
    rt.dispose();
  });

  it('throws loudly when no sandbox backend is available instead of falling back to inline (P0-1 fix 6)', () => {
    expect(() => createWebJsRuntime({ createSandbox: () => null })).toThrow(
      /不支持 Worker 沙箱/,
    );
  });

  it('evaluate returns the program completion value without a caller-side return (P0-2)', async () => {
    const rt = createTestRuntime();
    await expect(rt.evaluate('1 + 1;', 't.js')).resolves.toBe('2');
    await expect(rt.evaluate('"hi";', 't.js')).resolves.toBe('hi');
    await expect(rt.evaluate('var unused = 5;', 't.js')).resolves.toBeNull();
    rt.dispose();
  });

  it('dispose makes every later evaluation reject', async () => {
    const rt = createTestRuntime();
    rt.dispose();
    await expect(rt.evaluate('1 + 1;', 't.js')).rejects.toThrow(/已释放/);
  });

  it('acquire serialises evaluations (Mutex parity)', async () => {
    const rt = createTestRuntime();
    const order: number[] = [];
    const releaseA = await rt.acquire();
    const waiter = (async () => {
      const releaseB = await rt.acquire();
      order.push(2);
      releaseB();
    })();
    order.push(1);
    releaseA();
    await waiter;
    expect(order).toEqual([1, 2]);
    rt.dispose();
  });
});

describe('createWebKeyValueStorage (SharedPreferences)', () => {
  it('round-trips strings', () => {
    const s = createWebKeyValueStorage('test_kv_1');
    s.clear();
    expect(s.getString('a')).toBeNull();
    s.putString('a', '1');
    expect(s.getString('a')).toBe('1');
    s.remove('a');
    expect(s.getString('a')).toBeNull();
  });

  it('round-trips booleans with the fallback contract', () => {
    const s = createWebKeyValueStorage('test_kv_2');
    s.clear();
    expect(s.getBoolean('flag', true)).toBe(true);
    s.putBoolean('flag', false);
    expect(s.getBoolean('flag', true)).toBe(false);
    s.putBoolean('flag', true);
    expect(s.getBoolean('flag', false)).toBe(true);
    s.clear();
  });

  it('round-trips ints and falls back on garbage', () => {
    const s = createWebKeyValueStorage('test_kv_3');
    s.clear();
    expect(s.getInt('n', 7)).toBe(7);
    s.putInt('n', 42);
    expect(s.getInt('n', 7)).toBe(42);
    s.putString('bad', 'not-a-number');
    expect(s.getInt('bad', 3)).toBe(3);
    s.clear();
  });

  it('falls back to an empty map on corrupt JSON', () => {
    window.localStorage.setItem('test_kv_4', '{not json');
    const s = createWebKeyValueStorage('test_kv_4');
    expect(s.getString('anything')).toBeNull();
    window.localStorage.removeItem('test_kv_4');
  });

  it('survives a non-object payload', () => {
    window.localStorage.setItem('test_kv_5', '[1,2,3]');
    const s = createWebKeyValueStorage('test_kv_5');
    expect(s.getString('x')).toBeNull();
    window.localStorage.removeItem('test_kv_5');
  });

  it('persists across instances', () => {
    const a = createWebKeyValueStorage('test_kv_6');
    a.clear();
    a.putString('k', 'v');
    const b = createWebKeyValueStorage('test_kv_6');
    expect(b.getString('k')).toBe('v');
    b.clear();
  });
});

describe('createWebFileStorage (filesDir / cacheDir / assets)', () => {
  it('exposes the two Android dirs', () => {
    const fs = createWebFileStorage();
    expect(typeof fs.filesDir()).toBe('string');
    expect(fs.cacheDir()).not.toBe(fs.filesDir());
  });

  it('honours custom dirs', () => {
    const fs = createWebFileStorage({ filesDir: 'f', cacheDir: 'c' });
    expect(fs.filesDir()).toBe('f');
    expect(fs.cacheDir()).toBe('c');
  });

  it('text + bytes round-trip', () => {
    const fs = createWebFileStorage();
    fs.writeText('files/a.js', 'content-a');
    expect(fs.readText('files/a.js')).toBe('content-a');
    expect(fs.exists('files/a.js')).toBe(true);
    const bytes = new Uint8Array([1, 2, 3, 250]);
    fs.writeBytes('files/b.bin', bytes);
    expect(Array.from(fs.readBytes('files/b.bin') ?? [])).toEqual([1, 2, 3, 250]);
    fs.delete('files/b.bin');
    expect(fs.exists('files/b.bin')).toBe(false);
  });

  it('toFileUrl matches Uri.fromFile semantics', () => {
    const fs = createWebFileStorage();
    expect(fs.toFileUrl('files/a.js')).toBe('file://files/a.js');
  });

  it('readAsset delegates to the injected reader', () => {
    const fs = createWebFileStorage({ readAsset: (p) => (p === 'ok' ? 'CONTENT' : null) });
    expect(fs.readAsset('ok')).toBe('CONTENT');
    expect(fs.readAsset('missing')).toBeNull();
  });

  it('listFiles filters by directory prefix', () => {
    const fs = createWebFileStorage();
    fs.writeText('files/x/1.js', 'a');
    fs.writeText('files/x/2.js', 'b');
    fs.writeText('files/y.js', 'c');
    expect(fs.listFiles('files/x').sort()).toEqual(['files/x/1.js', 'files/x/2.js']);
  });

  it('mkdirs is a no-op and length reports stored length', () => {
    const fs = createWebFileStorage();
    expect(() => fs.mkdirs('files/new')).not.toThrow();
    fs.writeText('files/z.js', '12345');
    expect(fs.length('files/z.js')).toBe(5);
    expect(fs.length('files/missing')).toBe(0);
  });
});

describe('b64 / unb64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(unb64(b64(bytes)))).toEqual(Array.from(bytes));
  });

  it('handles empty input', () => {
    expect(Array.from(unb64(b64(new Uint8Array(0))))).toEqual([]);
  });
});

describe('createFetchJsHttpClient (Cronet / OkHttp)', () => {
  it('merges base headers and returns status/headers/body', async () => {
    const original = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
      Object.entries(init?.headers ?? {}).forEach(([k, v]) => seen.push(`${k}=${v}`));
      return new Response(new Uint8Array([7, 8]), { status: 200, headers: { 'x-b': '2' } });
    }) as typeof fetch;
    try {
      const client = createFetchJsHttpClient({ baseHeaders: { 'user-agent': 'Ciallo' } });
      const res = await client.execute({
        method: 'GET',
        url: 'https://example.com',
        headers: { accept: '*/*' },
        hasBody: false,
      });
      expect(res.status).toBe(200);
      expect(res.headers['x-b']).toBe('2');
      expect(Array.from(res.body ?? [])).toEqual([7, 8]);
      expect(seen).toContain('user-agent=Ciallo');
      expect(seen).toContain('accept=*/*');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('propagates network failure to the caller (Kotlin throws IOException)', async () => {
    const client = createFetchJsHttpClient();
    await expect(
      client.execute({
        method: 'GET',
        url: 'http://127.0.0.1:1/none',
        headers: {},
        hasBody: false,
      }),
    ).rejects.toThrow();
  });
});

describe('image backend (BitmapFactory)', () => {
  it('sniffs jpeg / png / webp signatures', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(
      sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    // WebP = "RIFF" + 4B size + "WEBP"
    expect(
      sniffImageMime(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
  });

  it('unknown bytes fall back to octet-stream', () => {
    expect(sniffImageMime(new Uint8Array([1, 2, 3, 4, 5]))).toBe('application/octet-stream');
  });
});

describe('CanvasBitmap', () => {
  it('allocates ARGB_8888 sized buffers', () => {
    const bmp = createCanvasBitmap(4, 3);
    expect(bmp.width).toBe(4);
    expect(bmp.height).toBe(3);
    expect(bmp.allocationByteCount).toBe(4 * 3 * 4);
  });

  it('getPixels clips out-of-bounds reads to transparent black', () => {
    const bmp = createCanvasBitmap(2, 2);
    const px = bmp.getPixels(-1, -1, 4, 4);
    expect(px).toHaveLength(4 * 4 * 4);
    expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('createBitmapFrom crops', () => {
    const src = createCanvasBitmap(4, 4);
    const crop = src.createBitmapFrom(src, 1, 1, 2, 2);
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
  });

  it('createRotated90 swaps dimensions', () => {
    const src = createCanvasBitmap(3, 5);
    const rot = src.createRotated90(src);
    expect(rot.width).toBe(5);
    expect(rot.height).toBe(3);
  });

  it('recycle zeroes the buffer', () => {
    const bmp = createCanvasBitmap(2, 2);
    bmp.recycle();
    expect(bmp.allocationByteCount).toBe(0);
  });
});

describe('createWebImageProbe (coil)', () => {
  it('returns null for a non-ok response instead of throwing', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array([1]), { status: 404 })) as typeof fetch;
    try {
      const probe = createWebImageProbe();
      await expect(probe.loadBitmap('https://example.com/x.png', {})).resolves.toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('returns null when fetch throws', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      const probe = createWebImageProbe();
      await expect(probe.loadBitmap('https://example.com/x.png', {})).resolves.toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('createWebCryptoPort', () => {
  it('reports a missing sync digest loudly instead of faking it', () => {
    const port = createWebCryptoPort();
    expect(() => port.digest('MD5', new Uint8Array([1]))).toThrow(/同步 MD5/);
  });

  it('AES 不再要求原生实现：未注入时回落纯 TS 实现（E34/E41 已关闭）', () => {
    // 本条原先断言「未注入原生实现就抛错」。E34/E41 关闭后行为已变更：
    // AES 是纯数学算法、不依赖任何平台能力，故 `src/core/crypto/aes.ts`
    // 提供了完整实现，`createWebCryptoPort` 在未注入时**自动回落**到它。
    // 仍然显式抛错的只剩参数非法（对齐 javax.crypto 的异常语义）。
    const port = createWebCryptoPort();
    // ECB 全零密钥 + 全零明文：合法输入，必须成功返回而不抛「原生实现」。
    expect(() =>
      port.aesDecrypt('AES/ECB/NoPadding', new Uint8Array(16), null, new Uint8Array(16)),
    ).not.toThrow();
    // 参数非法仍要抛错 —— 绝不能因为「有回落实现」就变成静默返回垃圾
    expect(() =>
      port.aesDecrypt('AES/ECB/NoPadding', new Uint8Array(7), null, new Uint8Array(16)),
    ).toThrow(/密钥长度非法/);
  });

  it('注入原生实现时优先走注入（便于与 Java Cipher 逐字节对照）', () => {
    const port = createWebCryptoPort({
      aesDecrypt: () => new Uint8Array([0xaa]),
    });
    expect(Array.from(port.aesDecrypt('AES/ECB/NoPadding', new Uint8Array(16), null, new Uint8Array(16))))
      .toEqual([0xaa]);
  });

  it('handleConvert 的 rsa 分支恒返回 null（与 Kotlin 的 else -> null 对齐）', () => {
    // 这才是真正的 parity 契约所在。Kotlin `handleConvert`（L323-378）的 `when`
    // 没有 `rsa` 分支，`else -> null`，所以 `Convert.decryptRsa` 在 Android 上
    // 恒返回 null。iOS 侧必须同样无条件返回 null —— 这样书源脚本无论宿主注入
    // 与否都拿不到 Android 从不产出的值。
    //
    // 本条用源码静态断言而非构造完整 handler：`JsMessageHandlerDeps` 有 20+ 个
    // 字段，为一条断言搭全套 stub 既脆弱又无信息量。真正需要守护的不变量是
    // 「`case 'rsa'` 分支体内不得出现对 `crypto.rsaDecrypt` 的调用」——
    // 只要它还在调用，注入原生实现就会让本端产出 Android 永不产生的值。
    // vitest 的 root 固定为项目根，用 `process.cwd()` 定位源码；
    // 不能用 `import.meta.url` —— 经 vite 转换后它不再是 file scheme。
    const src = readFileSync(
      join(process.cwd(), 'src/core/source/js/jsMessageHandler.ts'),
      'utf8',
    );
    const body = /case 'rsa':\s*\{([\s\S]*?)\n\s{8}\}/u.exec(src);
    expect(body).not.toBeNull();
    expect(body?.[1] ?? '').toContain('return null');
    expect(body?.[1] ?? '').not.toContain('rsaDecrypt');
  });

  it('randomInt is a half-open interval like Kotlin nextInt(min,max)', () => {
    const port = createWebCryptoPort();
    for (let i = 0; i < 200; i += 1) {
      const v = port.randomInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
    }
  });

  it('randomDouble stays within bounds', () => {
    const port = createWebCryptoPort();
    const v = port.randomDouble(1.5, 2.5);
    expect(v).toBeGreaterThanOrEqual(1.5);
    expect(v).toBeLessThan(2.5);
  });

  it('randomUUID has the canonical shape', () => {
    const port = createWebCryptoPort();
    expect(port.randomUUID()).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('vi is usable in this environment', () => {
  it('spies work', () => {
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});